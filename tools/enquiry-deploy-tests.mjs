// The one-button redeploy of the enquiry server (.github/workflows/deploy-enquiry.yml).
//
// Every failure here is silent until a parent presses Send: a smoke check that passes
// against a server refusing polymathlc.com.sg reports a broken form as live; a setup
// step that prints a secret publishes the centre's inboxes in a public log; and a
// workflow that deploys more than the enquiry codebase can take down another app's
// functions or overwrite the Firestore rules every Polymath app shares.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight, smokeProblems, smokeCheck, summaryText, REFUSED_PROBE } from './enquiry-smoke.mjs';
import { readServiceAccount, readRecipients, envFileText, prepare, SetupError, ENV_FILE, PROJECT } from './enquiry-deploy-setup.mjs';

const require = createRequire(import.meta.url);
const { createService, ORIGINS } = require('../enquiry-function/functions/service.js');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW = await readFile(join(ROOT, '.github/workflows/deploy-enquiry.yml'), 'utf8');
const SERVICE_CI = await readFile(join(ROOT, '.github/workflows/enquiry-service.yml'), 'utf8');

// ── The smoke check, against the REAL request handler ────────────────────────────
// The endpoint below is the handler the function runs, behind a plain HTTP server,
// so a preflight is answered exactly as the deployed code answers it.
async function liveHandlerServer({ refuse = [] } = {}) {
  const seen = [];
  const service = createService({
    repository: { reserve: async () => { throw new Error('the smoke check must never reach the repository'); } },
    recipients: ['centre-one@example.test', 'centre-two@example.test'], report: () => {}
  });
  const server = createServer((req, res) => {
    seen.push(req.method);
    const out = { status: 200, headers: {} };
    const finish = body => res.writeHead(out.status, out.headers).end(body);
    const response = {
      set(key, value) { out.headers[key] = value; return this; },
      status(code) { out.status = code; return this; },
      json(value) { out.headers['Content-Type'] = 'application/json'; finish(JSON.stringify(value)); return this; },
      send(value) { finish(String(value ?? '')); return this; }
    };
    // `refuse` stands in for an older deploy whose list was missing an origin —
    // the exact state the live form was in when polymathlc.com.sg stopped working.
    const origin = refuse.includes(req.headers.origin) ? 'https://refused-by-an-older-deploy.invalid' : req.headers.origin;
    const headers = { ...req.headers, origin };
    service.handler({ method: req.method, body: undefined, rawBody: Buffer.alloc(0), ip: '192.0.2.10',
      get: name => headers[name.toLowerCase()] }, response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, seen, endpoint: `http://127.0.0.1:${server.address().port}/submitPolymathEnquiry` };
}

test('the smoke check passes against the handler that is in the source', async () => {
  const { server, seen, endpoint } = await liveHandlerServer();
  try {
    assert.deepEqual(await smokeProblems({ endpoint }), []);
    const result = await smokeCheck({ endpoint, sleep: async () => assert.fail('a passing round must not wait'), log: () => {} });
    assert.equal(result.ok, true);
    assert.equal(result.attempt, 1);
    // Every page origin, then the refused probe, twice over — and nothing but OPTIONS.
    assert.equal(seen.length, 2 * (ORIGINS.length + 1));
    assert.deepEqual([...new Set(seen)], ['OPTIONS']);
  } finally { server.close(); }
});

test('it reports the reported bug: a live server that refuses polymathlc.com.sg', async () => {
  const { server, endpoint } = await liveHandlerServer({ refuse: ['https://polymathlc.com.sg'] });
  try {
    const problems = await smokeProblems({ endpoint });
    assert.ok(problems.length >= 2, 'the status and the missing CORS header are both named');
    assert.ok(problems.every(problem => problem.startsWith('https://polymathlc.com.sg:')), problems.join('\n'));
    assert.ok(problems.some(problem => /expected 204.*got 403/.test(problem)));
    assert.ok(problems.some(problem => /Access-Control-Allow-Origin was "\(none\)"/.test(problem)));
    const naps = [];
    const result = await smokeCheck({ endpoint, attempts: 3, waitMs: 1234, sleep: async ms => naps.push(ms), log: () => {} });
    assert.equal(result.ok, false);
    assert.deepEqual(naps, [1234, 1234], 'retried between attempts, never after the last');
    assert.match(summaryText(result), /❌/);
    assert.match(summaryText(result), /polymathlc\.com\.sg/);
  } finally { server.close(); }
});

// A fake endpoint for the answers the real handler can never give.
function fakeFetch(answer) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, origin: init.headers.Origin });
    const { status, headers = {} } = answer(init.headers.Origin, calls.length);
    return new Response(status === 204 ? null : '{}', { status, headers });
  };
  return { fetchImpl, calls };
}
const good = origin => origin === REFUSED_PROBE ? { status: 403 }
  : { status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } };

test('a wildcard or a lax server is not a pass', async () => {
  const wildcard = fakeFetch(origin => ({ ...good(origin), headers: { ...good(origin).headers, 'Access-Control-Allow-Origin': '*' } }));
  assert.ok((await smokeProblems({ endpoint: 'https://example.test/x', fetchImpl: wildcard.fetchImpl })).length >= ORIGINS.length);
  const lax = fakeFetch(origin => origin === REFUSED_PROBE
    ? { status: 204, headers: { 'Access-Control-Allow-Origin': origin } } : good(origin));
  const laxProblems = await smokeProblems({ endpoint: 'https://example.test/x', fetchImpl: lax.fetchImpl });
  assert.equal(laxProblems.length, 2);
  assert.ok(laxProblems.every(problem => /unlisted origin/.test(problem)));
  const noPost = fakeFetch(origin => origin === REFUSED_PROBE ? { status: 403 }
    : { status: 204, headers: { ...good(origin).headers, 'Access-Control-Allow-Methods': 'GET' } });
  assert.equal((await smokeProblems({ endpoint: 'https://example.test/x', fetchImpl: noPost.fetchImpl })).length, ORIGINS.length);
});

test('a new revision that takes a moment to start is waited for, not failed', async () => {
  const perRound = ORIGINS.length + 1;
  const warming = fakeFetch((origin, n) => n <= 2 * perRound ? { status: 503 } : good(origin));
  const logs = [];
  const result = await smokeCheck({ endpoint: 'https://example.test/x', fetchImpl: warming.fetchImpl,
    sleep: async () => {}, log: line => logs.push(line) });
  assert.equal(result.ok, true);
  assert.equal(result.attempt, 3);
  assert.equal(logs.length, 2);
  assert.ok(warming.calls.every(call => call.method === 'OPTIONS'));
});

test('a network failure is a named problem, not a crash', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed'); };
  const problems = await smokeProblems({ endpoint: 'https://example.test/x', fetchImpl });
  assert.equal(problems.length, ORIGINS.length + 1);
  assert.ok(problems.every(problem => /did not complete \(fetch failed\)/.test(problem)));
});

test('the check sends preflights and never a POST', async () => {
  const seen = fakeFetch(good);
  await preflight('https://example.test/x', ORIGINS[0], seen.fetchImpl);
  assert.equal(seen.calls[0].method, 'OPTIONS');
  const source = await readFile(join(ROOT, 'tools/enquiry-smoke.mjs'), 'utf8');
  assert.doesNotMatch(source, /method:\s*['"]POST['"]/, 'a POST queues a real enquiry email to the centre');
  assert.doesNotMatch(source, /\bbody\s*:/, 'a preflight carries no body');
  // The origins are the service's own list, not a copy that could drift from it.
  assert.match(source, /require\('\.\.\/enquiry-function\/functions\/service\.js'\)/);
  assert.doesNotMatch(source, /['"]https:\/\/polymathlc\.com\.sg['"]/);
  assert.match(summaryText({ ok: true, problems: [] }), /No email was sent/);
});

// ── The setup step: two secrets in, two private files out, nothing printed ────────
const MARK = 'zz-secret-marker-zz';
const KEY = { type: 'service_account', project_id: PROJECT, client_email: 'deployer@mathgen--app.iam.gserviceaccount.com',
  private_key: `-----BEGIN PRIVATE KEY-----\n${MARK}\n-----END PRIVATE KEY-----\n` };

test('the service-account key is read as pasted, padded or base64', () => {
  const raw = JSON.stringify(KEY);
  assert.deepEqual(readServiceAccount(raw), KEY);
  assert.deepEqual(readServiceAccount(`\n  ${raw}\n`), KEY);
  assert.deepEqual(readServiceAccount(Buffer.from(raw).toString('base64')), KEY);
});

test('a missing or wrong key is refused by name, without echoing any of it', () => {
  const cases = [undefined, '', '   ', `not json ${MARK}`, JSON.stringify({ note: MARK }), JSON.stringify([MARK]),
    JSON.stringify({ ...KEY, type: 'authorized_user' }), JSON.stringify({ ...KEY, private_key: MARK })];
  for (const value of cases) {
    assert.throws(() => readServiceAccount(value), error => {
      assert.ok(error instanceof SetupError);
      assert.match(error.message, /FIREBASE_SERVICE_ACCOUNT/);
      assert.ok(!error.message.includes(MARK), 'the secret must never appear in the message');
      return true;
    });
  }
});

test('the recipients are checked by the service\'s own rule, and never echoed', () => {
  assert.deepEqual([...readRecipients(' centre-one@example.test , centre-two@example.test\n')],
    ['centre-one@example.test', 'centre-two@example.test']);
  const bad = [undefined, '', `${MARK}@example.test`, `${MARK}@example.test,${MARK}@example.test`,
    `one@example.test,two@example.test,${MARK}@example.test`, `one@example.test,two@example.test\r\nBcc: ${MARK}@example.test`,
    `"${MARK}"@example.test,two@example.test`];
  for (const value of bad) {
    assert.throws(() => readRecipients(value), error => {
      assert.ok(error instanceof SetupError);
      assert.match(error.message, /POLYMATH_ENQUIRY_RECIPIENTS/);
      assert.ok(!error.message.includes(MARK), 'an address must never appear in the message');
      return true;
    });
  }
});

test('the env file is one quoted line the Firebase CLI reads whole', () => {
  const text = envFileText(readRecipients('a#1@example.test, b@example.test'));
  assert.equal(text, 'POLYMATH_ENQUIRY_RECIPIENTS="a#1@example.test,b@example.test"\n');
  // Unquoted, the CLI's .env parser would end the value at the "#".
  assert.equal(text.split('\n').length, 2);
});

test('prepare writes the key and the recipients to private files and points the CLI at the key', () => {
  const temp = mkdtempSync(join(tmpdir(), 'enquiry-deploy-'));
  try {
    const writes = new Map(), appends = [];
    const result = prepare({
      env: { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(KEY), POLYMATH_ENQUIRY_RECIPIENTS: 'one@example.test,two@example.test',
        RUNNER_TEMP: temp, GITHUB_ENV: join(temp, 'github-env') },
      root: '/repo',
      write: (path, text, options) => writes.set(path, { text, mode: options.mode }),
      append: (path, text) => appends.push({ path, text })
    });
    assert.equal(result.sameProject, true);
    assert.equal(result.envFile, ENV_FILE);
    assert.equal(ENV_FILE, 'enquiry-function/functions/.env.mathgen--app');
    const key = writes.get(join(temp, 'firebase-sa.json'));
    assert.deepEqual(JSON.parse(key.text), KEY);
    assert.equal(key.mode, 0o600);
    const envFile = writes.get('/repo/enquiry-function/functions/.env.mathgen--app');
    assert.equal(envFile.text, 'POLYMATH_ENQUIRY_RECIPIENTS="one@example.test,two@example.test"\n');
    assert.equal(envFile.mode, 0o600);
    assert.deepEqual(appends, [{ path: join(temp, 'github-env'), text: `GOOGLE_APPLICATION_CREDENTIALS=${join(temp, 'firebase-sa.json')}\n` }]);
    // Outside GitHub Actions it refuses rather than writing into the working copy.
    assert.throws(() => prepare({ env: { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(KEY),
      POLYMATH_ENQUIRY_RECIPIENTS: 'one@example.test,two@example.test' }, write: () => assert.fail('wrote a file') }), SetupError);
    // Written for real, both files are private to the runner's own user.
    const root = join(temp, 'checkout');
    mkdirSync(join(root, 'enquiry-function/functions'), { recursive: true });
    prepare({ env: { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(KEY), POLYMATH_ENQUIRY_RECIPIENTS: 'one@example.test,two@example.test',
      RUNNER_TEMP: temp, GITHUB_ENV: join(temp, 'github-env') }, root });
    assert.equal(statSync(join(temp, 'firebase-sa.json')).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, ENV_FILE)).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(root, ENV_FILE), 'utf8'), 'POLYMATH_ENQUIRY_RECIPIENTS="one@example.test,two@example.test"\n');
    assert.match(readFileSync(join(temp, 'github-env'), 'utf8'), /^GOOGLE_APPLICATION_CREDENTIALS=.*firebase-sa\.json$/m);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('run as a step with a bad secret, it fails loudly and prints none of it', () => {
  const run = spawnSync(process.execPath, [join(ROOT, 'tools/enquiry-deploy-setup.mjs')], {
    env: { PATH: process.env.PATH, FIREBASE_SERVICE_ACCOUNT: `oops ${MARK}`, POLYMATH_ENQUIRY_RECIPIENTS: `${MARK}@example.test` },
    encoding: 'utf8'
  });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /^::error::The FIREBASE_SERVICE_ACCOUNT secret is not a JSON key\./m);
  assert.ok(!(run.stdout + run.stderr).includes(MARK));
});

// ── The workflow: deploys the enquiry codebase and nothing else ───────────────────
const deployLines = WORKFLOW.split('\n').filter(line => /\bfirebase\s+deploy\b/.test(line) && !line.trim().startsWith('#'));

test('it deploys exactly the polymath-enquiry codebase, from its own config', () => {
  assert.equal(deployLines.length, 1);
  assert.match(deployLines[0], /--config enquiry-function\/firebase\.json/);
  assert.match(deployLines[0], /--only functions:polymath-enquiry(\s|$)/);
  assert.match(deployLines[0], /--non-interactive/);
  assert.match(deployLines[0], /--project "\$FIREBASE_PROJECT"/);
  assert.match(WORKFLOW, /FIREBASE_PROJECT: mathgen--app/);
  // --force deletes functions missing from the source; the shared rules belong to every app.
  assert.doesNotMatch(WORKFLOW, /--force/);
  assert.doesNotMatch(WORKFLOW, /--only[^\n]*\b(firestore|storage|hosting|extensions)\b/);
  const config = JSON.parse(readFileSync(join(ROOT, 'enquiry-function/firebase.json'), 'utf8'));
  assert.equal(config.functions.length, 1);
  assert.equal(config.functions[0].codebase, 'polymath-enquiry');
  assert.ok(config.functions[0].ignore.includes('.env*'), 'the recipients file is never uploaded with the source');
  assert.ok(!('firestore' in config) && !('storage' in config), 'this config must not be able to deploy shared rules');
});

test('only reviewed code on main deploys, and merging a docs change deploys nothing', () => {
  assert.match(WORKFLOW, /if: github\.repository == 'polymathlc\/cer' && github\.ref == 'refs\/heads\/main'/);
  const push = WORKFLOW.slice(WORKFLOW.indexOf('  push:'), WORKFLOW.indexOf('  workflow_dispatch:'));
  assert.deepEqual([...push.matchAll(/^\s+- '([^']+)'$/gm)].map(match => match[1]),
    ['enquiry-function/functions/**', 'enquiry-function/firebase.json']);
  assert.match(WORKFLOW, /^permissions:\n  contents: read$/m);
  assert.match(WORKFLOW, /persist-credentials: false/);
  assert.doesNotMatch(WORKFLOW, /pull_request/);
});

test('the secrets reach one step, and are never echoed', () => {
  assert.equal(WORKFLOW.match(/\$\{\{\s*secrets\./g).length, 2);
  const prepareStep = WORKFLOW.slice(WORKFLOW.indexOf('- name: Prepare credentials and recipients'), WORKFLOW.indexOf('- name: Install the Firebase CLI'));
  assert.match(prepareStep, /FIREBASE_SERVICE_ACCOUNT: \$\{\{ secrets\.FIREBASE_SERVICE_ACCOUNT \}\}/);
  assert.match(prepareStep, /POLYMATH_ENQUIRY_RECIPIENTS: \$\{\{ secrets\.POLYMATH_ENQUIRY_RECIPIENTS \}\}/);
  assert.match(prepareStep, /run: node tools\/enquiry-deploy-setup\.mjs/);
  assert.doesNotMatch(WORKFLOW, /(echo|printf|cat)[^\n]*(FIREBASE_SERVICE_ACCOUNT|POLYMATH_ENQUIRY_RECIPIENTS|firebase-sa\.json|\.env\.mathgen)/);
  const cleanup = WORKFLOW.slice(WORKFLOW.indexOf('- name: Remove the key and the recipients from the runner'));
  assert.match(cleanup, /if: always\(\)/);
  assert.match(cleanup, /firebase-sa\.json/);
  assert.match(cleanup, /\.env\.mathgen--app/);
});

test('the shared rules change only on a manual run with the box ticked, before they are reported', () => {
  const applies = WORKFLOW.split('\n').filter(line => /enquiry-rules\.mjs[^\n]*--apply/.test(line));
  assert.equal(applies.length, 1);
  const applyStep = WORKFLOW.slice(WORKFLOW.indexOf('- name: Install the enquiry-mail protection (only when asked)'),
    WORKFLOW.indexOf('- name: Check the enquiry-mail protection in the shared rules'));
  assert.match(applyStep, /github\.event_name == 'workflow_dispatch' && inputs\.protect_rules/);
  assert.match(applyStep, /--apply/);
  assert.match(WORKFLOW, /protect_rules:\n\s+description: [^\n]+\n\s+type: boolean\n\s+default: false/);
  // The check reads the rules AFTER any install, so the summary states the final state.
  assert.ok(WORKFLOW.indexOf('--apply') < WORKFLOW.indexOf('--read'));
  const smoke = WORKFLOW.slice(WORKFLOW.indexOf('- name: Prove the live service answers every page'));
  assert.match(smoke, /^\s+if: always\(\) && steps\.prepare\.outcome == 'success'$/m);
  assert.match(smoke, /run: node tools\/enquiry-smoke\.mjs/);
});

test('the tests run before anything is deployed, and on every pull request that touches them', () => {
  assert.ok(WORKFLOW.indexOf('npm test --prefix enquiry-function/functions') < WORKFLOW.indexOf('firebase deploy --project'));
  assert.ok(WORKFLOW.indexOf('node tools/enquiry-deploy-tests.mjs') < WORKFLOW.indexOf('node tools/enquiry-deploy-setup.mjs'));
  for (const path of ['tools/enquiry-deploy-setup.mjs', 'tools/enquiry-smoke.mjs', 'tools/enquiry-deploy-tests.mjs',
    '.github/workflows/deploy-enquiry.yml'])
    assert.ok(SERVICE_CI.split('\n').filter(line => line.includes('paths:')).every(line => line.includes(`'${path}'`)), path);
  assert.match(SERVICE_CI, /run: node tools\/enquiry-deploy-tests\.mjs/);
});
