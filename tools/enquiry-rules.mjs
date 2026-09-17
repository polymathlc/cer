// Narrow migration of CURRENT shared rules: no app-local rules replacement.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preservedRuleTests, liveRuleTests } from './cer-live-server-rules.mjs';

export const ENQUIRY_RULE = `    // BEGIN polymath-enquiry-server-only-v1
    // Enquiry contacts, email payloads and admission limits are server-only.
    function isPolymathEnquiryServerPath() {
      return request.path[3] in ['polymathEnquiryRequests', 'polymathEnquiryLimits']
        || (request.path[3] == 'mail'
          && (request.path == /databases/$(request.path[1])/documents/mail
            || request.path[4].matches('^polymath-enquiry-.*$')));
    }
    // END polymath-enquiry-server-only-v1

`;
const BEFORE = 'allow read, write: if !isPermanentStudentHistoryPath() && !isLiveServerPath();';
const AFTER = 'allow read, write: if !isPermanentStudentHistoryPath() && !isLiveServerPath() && !isPolymathEnquiryServerPath();';
const ANCHOR = '    // BEGIN permanent-student-question-history-v1';
export function addEnquiryRules(source) {
  if (typeof source !== 'string' || !source.includes('service cloud.firestore {')
      || (source.match(/match\s+\/databases\/\{\w+\}\/documents\s*\{/g) || []).length !== 1
      || (source.match(/match\s+\/\{\w+=\*\*\}/g) || []).length !== 1
      || !source.includes("'cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'"))
    throw new Error('Unrecognized current shared rules; no rules changed.');
  const installed = source.includes(ENQUIRY_RULE) && source.includes(AFTER);
  if (installed) {
    if ((source.match(/BEGIN polymath-enquiry-server-only-v1/g) || []).length !== 1
        || (source.match(/function isPolymathEnquiryServerPath/g) || []).length !== 1)
      throw new Error('Ambiguous existing enquiry protection.');
    return source;
  }
  if (!source.includes(BEFORE) || source.includes('polymath-enquiry-server-only-v1')
      || source.includes('isPolymathEnquiryServerPath') || !source.includes(ANCHOR))
    throw new Error('Expected the existing shared protection; review changed rules first.');
  const updated = source.replace(ANCHOR, () => ENQUIRY_RULE + ANCHOR).replace(BEFORE, AFTER);
  if (updated.replace(ENQUIRY_RULE, '').replace(AFTER, BEFORE) !== source)
    throw new Error('Unrelated rules would change.');
  return updated;
}
function permission(path, method, expected, uid = null) {
  const data = { test: true };
  return { expectation: expected, request: {
    path: '/databases/(default)/documents/' + path, method,
    auth: uid ? { uid, token: { sub: uid, admin: uid === 'enquiry-admin' } } : null,
    ...(['create', 'update'].includes(method) ? { resource: { data } } : {})
  }, ...(method !== 'create' ? { resource: { data } } : {}) };
}
export function enquiryRuleTests() {
  const protectedPaths = [
    'polymathEnquiryRequests/probe', 'polymathEnquiryRequests/probe/nested/child',
    'polymathEnquiryLimits/probe', 'polymathEnquiryLimits/probe/nested/child',
    'mail/polymath-enquiry-1234', 'mail/polymath-enquiry-1234/nested/child'
  ];
  return [null, 'enquiry-student', 'enquiry-admin'].flatMap(uid => [
    ...protectedPaths.flatMap(path => ['get', 'create', 'update', 'delete'].map(method => permission(path, method, 'DENY', uid))),
    ...['polymathEnquiryRequests', 'polymathEnquiryLimits', 'mail', 'mail/polymath-enquiry-1234/nested']
      .map(path => permission(path, 'list', 'DENY', uid))
  ]);
}
export function enquiryPreservedTests(source) {
  return [...preservedRuleTests(source), ...liveRuleTests(),
    ...['mail/unrelated-existing-mail', 'mail/unrelated-existing-mail/nested/child',
      'polymathEnquiryRequestsArchive/probe', 'users/probe/polymathEnquiryRequests/item']
      .flatMap(path => ['get', 'create', 'update', 'delete'].map(method => permission(path, method, 'ALLOW')))
  ];
}
async function validate(request, project, source, tests) {
  for (let offset = 0; offset < tests.length; offset += 100) {
    const batch = tests.slice(offset, offset + 100);
    const result = await request(`projects/${project}:test`, { method: 'POST', body: { source, testSuite: { testCases: batch } } });
    const failed = (result.testResults || []).flatMap((test, index) => test.state === 'SUCCESS' ? [] : [offset + index]);
    if (result.testResults?.length !== batch.length || failed.length || (result.issues || []).some(issue => issue.severity === 'ERROR'))
      throw new Error('Rules tests failed; active rules unchanged: ' + JSON.stringify({ failed, expected: batch.length, received: result.testResults?.length || 0,
        issues: (result.issues || []).filter(issue => issue.severity === 'ERROR').map(issue => ({ description: issue.description, sourcePosition: issue.sourcePosition })) }));
  }
}
export async function publishEnquiryRules({ request, deploy = false, readOnly = false }) {
  if (deploy && readOnly) throw new Error('Read and apply modes are exclusive.');
  const project = 'mathgen--app', releasePath = `projects/${project}/releases/cloud.firestore`;
  const previous = await request(releasePath);
  const valid = name => typeof name === 'string' && name.startsWith(`projects/${project}/rulesets/`) && !name.slice(`projects/${project}/rulesets/`.length).includes('/');
  if (!valid(previous.rulesetName)) throw new Error('Unexpected current ruleset.');
  const production = await request(previous.rulesetName), files = production.source?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Unexpected current rules files.');
  const original = files[0].content, content = addEnquiryRules(original), changed = original !== content;
  const sourceSha256 = createHash('sha256').update(content).digest('hex');
  if (readOnly) return { mode: 'read', changeNeeded: changed, ruleset: previous.rulesetName, sourceSha256 };
  const source = { files: [{ ...files[0], content }] }, preserved = enquiryPreservedTests(original);
  await validate(request, project, production.source, preserved);
  const tests = [...preserved, ...enquiryRuleTests()];
  await validate(request, project, source, tests);
  if (!deploy || !changed) return { mode: deploy ? 'apply' : 'test', changed: false, changeNeeded: changed, validated: tests.length, ruleset: previous.rulesetName, sourceSha256 };
  const candidate = await request(`projects/${project}/rulesets`, { method: 'POST', body: { source } });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime)
    throw new Error('Active rules changed during validation; retry against current rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Cannot verify published enquiry protection.');
  return { mode: 'apply', changed: true, validated: tests.length, previousRuleset: previous.rulesetName, ruleset: candidate.name, sourceSha256 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2), index = flags.indexOf('--firebase-tools');
  const cliRoot = index >= 0 ? flags.splice(index, 2)[1] : null;
  if (!cliRoot || cliRoot.startsWith('--') || flags.length > 1 || flags.some(flag => !['--read', '--apply'].includes(flag)))
    throw new Error('Use --firebase-tools <installed-package-directory>, optionally --read or --apply.');
  const require = createRequire(import.meta.url), cli = name => require(resolve(cliRoot, 'lib', name));
  const { Command } = cli('command'), { requireAuth } = cli('requireAuth'), { logger } = cli('logger'), { Client } = cli('apiv2');
  logger.silent = true;
  const command = new Command('enquiry:rules').before(requireAuth).action(async () => {
    const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
    const request = async (path, options = {}) => {
      try { return (await client.request({ method: options.method || 'GET', path, ...(options.body ? { body: options.body } : {}),
        skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } })).body; }
      catch (error) { throw new Error('Rules API failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ').'); }
    };
    console.log(JSON.stringify(await publishEnquiryRules({ request, deploy: flags.includes('--apply'), readOnly: flags.includes('--read') }), null, 2));
  });
  await command.runner()({ project: 'mathgen--app', projectId: 'mathgen--app', projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
}
