"""Exercise deployment stop conditions without credentials or cloud mutations."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SHIM = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
tool = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
scenario = os.environ['RAPID_TEST_SCENARIO']
with open(os.environ['RAPID_TEST_LOG'], 'a') as log:
    log.write(json.dumps([tool, *args]) + '\n')
if tool == 'node':
    installed = 'node_modules/node/bin' in str(pathlib.Path(sys.argv[0]).parent)
    old_node = (scenario.startswith('node-') and not installed) or scenario == 'node-wrong-version'
    print('20' if old_node else '22')
elif tool == 'npm':
    if args[0] == 'exec':
        # Reproduce a shell that keeps selecting the old Node after npm exec.
        # Bound the old script's recursion so a failing regression cannot hang.
        attempts = int(os.environ.get('RAPID_TEST_RESTARTS', '0'))
        if attempts >= 2: sys.exit('Repeated setup restart')
        os.environ['RAPID_TEST_RESTARTS'] = str(attempts + 1)
        os.execvp('bash', ['bash', args[-1]])
    if args[0] == 'install':
        if scenario == 'node-install-fail': sys.exit(1)
        if scenario != 'node-missing-binary':
            target = pathlib.Path(args[args.index('--prefix') + 1]) / 'node_modules/node/bin/node'
            target.parent.mkdir(parents=True)
            target.write_text(pathlib.Path(sys.argv[0]).read_text())
            target.chmod(0o755)
    if args[0] in ['ci', 'test']:
        import shutil
        selected = shutil.which('node')
        with open(os.environ['RAPID_TEST_LOG'], 'a') as log:
            log.write(json.dumps(['selected-node', selected]) + '\n')
    if scenario == 'tests-fail' and args[0] == 'test': sys.exit(1)
elif tool == 'npx':
    if scenario in ['deploy-fail', 'node-deploy-fail'] and 'deploy' in args: sys.exit(1)
elif tool == 'gcloud':
    if args[:2] == ['auth', 'list']:
        print('' if scenario == 'no-auth' else 'owner@example.com')
    elif args[:2] == ['projects', 'describe']: print('mathgen--app')
    elif args[:3] == ['billing', 'projects', 'describe']:
        print('False' if scenario == 'no-billing' else 'True')
    elif args[:3] == ['secrets', 'versions', 'describe']:
        print('DISABLED' if scenario == 'disabled-secret' else 'ENABLED')
    elif args[:2] == ['functions', 'describe']:
        if args[-1] == '--format=value(state)':
            print('FAILED' if scenario == 'inactive-function' else 'ACTIVE')
        elif args[-1] == '--format=value(serviceConfig.serviceAccountEmail)':
            print('worker@mathgen--app.iam.gserviceaccount.com')
        elif args[-1] == '--format=value(serviceConfig.service)':
            project = 'unrelated' if scenario == 'wrong-service' else 'mathgen--app'
            print(f'projects/{project}/locations/us-central1/services/rapidimportpage')
        else: sys.exit('Unexpected function lookup')
    elif args[:3] == ['tasks', 'queues', 'describe']:
        print('PAUSED' if scenario == 'paused-queue' else 'RUNNING')
    elif args[:2] == ['services', 'enable'] or 'add-iam-policy-binding' in args: pass
    else: sys.exit('Unexpected gcloud operation: ' + repr(args))
elif tool == 'curl':
    response = pathlib.Path(args[args.index('--output') + 1])
    response.write_text(json.dumps({'error': {'status': 'INTERNAL' if scenario == 'bad-response' else 'UNAUTHENTICATED'}}))
    print('200' if scenario == 'public-status' else '401', end='')
else: sys.exit('Unexpected command')
'''


class DeployTests(unittest.TestCase):
    def run_setup(self, scenario):
        with tempfile.TemporaryDirectory() as temp:
            temp = Path(temp)
            for tool in ['gcloud', 'node', 'npm', 'npx', 'curl']:
                script = temp / tool
                script.write_text(SHIM)
                script.chmod(0o755)
            log = temp / 'commands.jsonl'
            result = subprocess.run(
                ['bash', str(ROOT / 'rapid-import/deploy-cloud-shell.sh')],
                env={**os.environ, 'PATH': str(temp) + os.pathsep + os.environ['PATH'],
                     'RAPID_TEST_SCENARIO': scenario, 'RAPID_TEST_LOG': str(log)},
                capture_output=True, text=True, timeout=15)
            commands = [json.loads(line) for line in log.read_text().splitlines()]
            return result, commands

    def test_old_node_is_replaced_once_without_restarting_setup(self):
        result, commands = self.run_setup('node-old')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.count('Checking Google access'), 1)
        installs = [c for c in commands if c[:2] == ['npm', 'install']]
        self.assertEqual(len(installs), 1)
        self.assertIn('node@22', installs[0])
        runtime = Path(installs[0][installs[0].index('--prefix') + 1])
        selected = [c[1] for c in commands if c[0] == 'selected-node']
        self.assertEqual(selected, [str(runtime / 'node_modules/node/bin/node')] * 2)
        self.assertFalse(runtime.exists(), 'Temporary Node installation was not cleaned up')
        self.assertEqual(sum(c[0] == 'npx' and 'deploy' in c for c in commands), 1)

    def test_node_selection_failures_stop_without_cloud_mutations(self):
        for scenario in ['node-install-fail', 'node-missing-binary', 'node-wrong-version']:
            with self.subTest(scenario=scenario):
                result, commands = self.run_setup(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout.count('Checking Google access'), 1)
                self.assertFalse(any('deploy' in c or 'enable' in c or 'add-iam-policy-binding' in c for c in commands))
                self.assertNotIn('Deployment checks passed', result.stdout)
                installs = [c for c in commands if c[:2] == ['npm', 'install']]
                self.assertEqual(len(installs), 1)
                self.assertFalse(Path(installs[0][installs[0].index('--prefix') + 1]).exists())

    def test_temporary_runtime_is_cleaned_up_after_deploy_failure(self):
        result, commands = self.run_setup('node-deploy-fail')
        self.assertNotEqual(result.returncode, 0)
        installs = [c for c in commands if c[:2] == ['npm', 'install']]
        self.assertEqual(len(installs), 1)
        self.assertFalse(Path(installs[0][installs[0].index('--prefix') + 1]).exists())
        self.assertFalse(any('add-iam-policy-binding' in c for c in commands))
        self.assertNotIn('Deployment checks passed', result.stdout)

    def test_prerequisites_fail_before_cloud_mutations(self):
        for scenario in ['no-auth', 'no-billing', 'disabled-secret', 'tests-fail']:
            with self.subTest(scenario=scenario):
                result, commands = self.run_setup(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any('deploy' in c or 'enable' in c or 'add-iam-policy-binding' in c for c in commands))
                self.assertNotIn('Deployment checks passed', result.stdout)

    def test_failed_or_inactive_deployment_never_changes_iam(self):
        for scenario in ['deploy-fail', 'inactive-function', 'wrong-service']:
            with self.subTest(scenario=scenario):
                result, commands = self.run_setup(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any('add-iam-policy-binding' in c for c in commands))
                self.assertNotIn('Deployment checks passed', result.stdout)

    def test_queue_and_endpoint_failures_cannot_report_success(self):
        for scenario in ['paused-queue', 'public-status', 'bad-response']:
            with self.subTest(scenario=scenario):
                result, _ = self.run_setup(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('Deployment checks passed', result.stdout)

    def test_success_is_scoped_and_still_requires_live_acceptance(self):
        result, commands = self.run_setup('success')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(c[:2] == ['npm', 'install'] for c in commands))
        deploys = [c for c in commands if c[0] == 'npx' and 'deploy' in c]
        self.assertEqual(len(deploys), 1)
        self.assertIn('functions:cer-rapid-import', deploys[0])
        self.assertIn('mathgen--app', deploys[0])
        self.assertNotIn('--force', deploys[0])
        self.assertEqual(sum('--format=value(state)' in c and c[1:3] == ['functions', 'describe'] for c in commands), 7)
        bindings = [c for c in commands if 'add-iam-policy-binding' in c]
        self.assertEqual(len(bindings), 3)
        self.assertTrue(all('projects' not in c and '--member=allUsers' not in c for c in bindings))
        self.assertIn('rapidImportPage', bindings[0])
        self.assertIn('worker@mathgen--app.iam.gserviceaccount.com', bindings[1])
        self.assertIn('rapidimportpage', bindings[2])
        self.assertFalse(any('access' in c and 'secrets' in c for c in commands))
        self.assertIn('not end-to-end verified', result.stdout)


if __name__ == '__main__':
    unittest.main()
