// Narrow migration of the CURRENT shared Firestore rules for the /trial page.
// Like the Office and Shop Guard tools it never replaces the shared rules: it
// inserts one block and adds one predicate to the existing catch-all, so every
// other app keeps exactly the permissions it has today.
//
// WHY. The shared catch-all is OPEN (read and write) for any collection no app
// has claimed. Without this block anybody holding the public web config could
// read every trial booking (parents' names, emails and WhatsApp numbers), list
// the unused one-time access codes, copy the class links and Zoom links, and
// read the trial password's hash.
//
// What it protects (everything else is untouched):
//   trialSettings/**   password hash, Zoom links, slot → class choices
//   trialBookings/**   bookings and class-link visits
//   trialCodes/**      one-time access codes
//   trialLinks/**      one-week class links
// No browser may read or write them at all, signed in or not, admin or not:
// the trialBooking / trialAdmin / trialMaterial functions (Admin SDK, which
// rules do not apply to) are the only way in, and they check the admin's
// Google sign-in themselves.
//
//   node tools/trial-rules.mjs --firebase-tools <dir> --read   is it installed?
//   node tools/trial-rules.mjs --firebase-tools <dir>          test only, change nothing
//   node tools/trial-rules.mjs --firebase-tools <dir> --apply  test, then publish
//   node tools/trial-rules.mjs --setup                         write the CI key file
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { shopGuardPreservedTests, shopGuardRuleTests } from './shopguard-rules.mjs';
import { describeRules, setupCredentials } from './online-rules.mjs';
import { withSignedOutLock } from './signed-out-lock-core.mjs';

export const PROJECT = 'mathgen--app';
export const TRIAL_COLLECTIONS = Object.freeze(['trialSettings', 'trialBookings', 'trialCodes', 'trialLinks']);
const list = a => JSON.stringify(a).replace(/"/g, "'").replace(/,/g, ', ');

export const TRIAL_RULE = `    // BEGIN polymath-trial-v1
    // Online trial lessons (polymathlc.com.sg/trial): the password hash, Zoom
    // links, one-time access codes, class links and parents' bookings. Only the
    // trial functions (Admin SDK) use them; no browser may read or write them.
    // The catch-all below skips these paths, and nothing here allows them.
    function isPolymathTrialPath() {
      return request.path[3] in ${list(TRIAL_COLLECTIONS)};
    }
    // END polymath-trial-v1

`;

// The same catch-all shape the other narrow patches recognise. Only
// " && !isPolymathTrialPath()" is added to its end.
const CATCH_ALL = /allow read, write: if !isPermanentStudentHistoryPath\(\) && !isLiveServerPath\(\)((?: && !\w+\(\))*);/g;
const CATCH_ALL_MATCH = /^([ \t]*)match\s+\/\{\w+=\*\*\}\s*\{/m;
const PREDICATE = ' && !isPolymathTrialPath()';

function count(source, pattern) { return (source.match(pattern) || []).length; }

export function addTrialRules(source) {
  if (typeof source !== 'string' || !source.includes('service cloud.firestore {')
      || count(source, /match\s+\/databases\/\{\w+\}\/documents\s*\{/g) !== 1
      || count(source, /match\s+\/\{\w+=\*\*\}/g) !== 1)
    throw new Error('Unrecognized current shared rules; no rules changed.');
  const lines = source.match(CATCH_ALL) || [];
  if (lines.length !== 1)
    throw new Error('Expected one shared catch-all line; review changed rules first.');
  const installed = lines[0].includes(PREDICATE + ';') || lines[0].includes(PREDICATE + ' &&');
  if (installed) {
    if (!source.includes(TRIAL_RULE) || count(source, /BEGIN polymath-trial-v1/g) !== 1
        || count(source, /function isPolymathTrialPath/g) !== 1 || count(source, /isPolymathTrialPath\(\)/g) !== 2)
      throw new Error('Ambiguous existing trial protection.');
    return source;
  }
  if (source.includes('polymath-trial-v1') || source.includes('isPolymathTrialPath')
      || TRIAL_COLLECTIONS.some(name => new RegExp(`match\\s+/${name}/`).test(source)))
    throw new Error('A partial trial protection is already there; review changed rules first.');
  const updated = source.replace(CATCH_ALL_MATCH, whole => TRIAL_RULE + whole)
    .replace(CATCH_ALL, line => line.slice(0, -1) + PREDICATE + ';');
  if (updated.replace(TRIAL_RULE, '').replace(PREDICATE + ';', ';') !== source)
    throw new Error('Unrelated rules would change.');
  return updated;
}

/* ================= Permission tests (run by the Rules API) ================= */
const TOKENS = {
  'trial-test-admin': { email: 'admin@polymathlc.com.sg', email_verified: true },
  'trial-test-owner': { email: 'chungzhikai@gmail.com', email_verified: true },
  'trial-test-stranger': { email: 'stranger@example.com', email_verified: true },
  'trial-test-anon-provider': {}
};
export const EVERYONE = [null, ...Object.keys(TOKENS)];

export function trialCase(path, method, expectation, uid = null, { data = { test: true } } = {}) {
  const test = { expectation, request: {
    path: '/databases/(default)/documents/' + path, method,
    auth: uid ? { uid, token: { sub: uid, ...(TOKENS[uid] || {}) } } : null,
    ...(['create', 'update'].includes(method) ? { resource: { data } } : {})
  } };
  if (method !== 'create') test.resource = { data };
  return test;
}

export const TRIAL_DOC_PATHS = ['trialSettings/main', 'trialBookings/ABC234', 'trialCodes/ABCD2345', 'trialLinks/' + 'k'.repeat(24),
  'trialBookings/ABC234/notes/one'];
export const TRIAL_LISTS = ['trialSettings', 'trialBookings', 'trialCodes', 'trialLinks'];

export function trialRuleTests() {
  const cases = [];
  const data = { passwordHash: 'probe', email: 'parent@example.com', code: 'ABCD2345' };
  for (const path of TRIAL_DOC_PATHS)
    for (const method of ['get', 'create', 'update', 'delete'])
      for (const uid of EVERYONE) cases.push(trialCase(path, method, 'DENY', uid, { data }));
  for (const path of TRIAL_LISTS)
    for (const uid of EVERYONE) cases.push(trialCase(path, 'list', 'DENY', uid));
  return cases;
}

// Everything around the trial collections keeps its current permissions: the
// Shop Guard tool's preserved set (which carries Office's and every earlier
// protection), Shop Guard's own cases when it is installed, and look-alike
// paths next to ours, which stay as open as the catch-all leaves them.
export function trialPreservedTests(source) {
  const cases = [...shopGuardPreservedTests(source)];
  if (source.includes('polymath-shopguard-v1')) cases.push(...shopGuardRuleTests());
  for (const path of ['trialSettingsX/probe', 'trial/probe', 'users/probe/trialBookings/item', 'trial_bookings/probe'])
    for (const method of ['get', 'create', 'update', 'delete']) cases.push(trialCase(path, method, 'ALLOW'));
  return withSignedOutLock(source, cases);
}

async function validate(request, project, source, tests) {
  for (let offset = 0; offset < tests.length; offset += 100) {
    const batch = tests.slice(offset, offset + 100);
    const result = await request(`projects/${project}:test`, { method: 'POST', body: { source, testSuite: { testCases: batch } } });
    const failed = (result.testResults || []).flatMap((test, index) => test.state === 'SUCCESS' ? [] : [offset + index]);
    if (result.testResults?.length !== batch.length || failed.length || (result.issues || []).some(issue => issue.severity === 'ERROR'))
      throw new Error('Rules tests failed; active rules unchanged: ' + JSON.stringify({ failed: failed.length, expected: batch.length, received: result.testResults?.length || 0,
        cases: failed.slice(0, 10).map(index => ({ path: tests[index].request.path, method: tests[index].request.method,
          expected: tests[index].expectation, uid: tests[index].request.auth?.uid || null })),
        issues: (result.issues || []).filter(issue => issue.severity === 'ERROR').map(issue => ({ description: issue.description, sourcePosition: issue.sourcePosition })) }));
  }
}

export async function publishTrialRules({ request, deploy = false, readOnly = false }) {
  if (deploy && readOnly) throw new Error('Read and apply modes are exclusive.');
  const releasePath = `projects/${PROJECT}/releases/cloud.firestore`;
  const previous = await request(releasePath);
  const valid = name => typeof name === 'string' && name.startsWith(`projects/${PROJECT}/rulesets/`) && !name.slice(`projects/${PROJECT}/rulesets/`.length).includes('/');
  if (!valid(previous.rulesetName)) throw new Error('Unexpected current ruleset.');
  const production = await request(previous.rulesetName), files = production.source?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Unexpected current rules files.');
  const original = files[0].content;
  let content;
  try { content = addTrialRules(original); }
  catch (error) { error.message += ' Current rules outline: ' + JSON.stringify(describeRules(original)); throw error; }
  const changed = original !== content;
  const sourceSha256 = createHash('sha256').update(content).digest('hex');
  if (readOnly) return { mode: 'read', changeNeeded: changed, ruleset: previous.rulesetName, sourceSha256 };
  const source = { files: [{ ...files[0], content }] }, preserved = trialPreservedTests(original);
  // The preserved expectations must already hold on today's rules, so a surprise
  // in the live rules stops here instead of being "fixed" by us.
  if (changed) await validate(request, PROJECT, production.source, preserved);
  const tests = [...preserved, ...trialRuleTests()];
  await validate(request, PROJECT, source, tests);
  if (!deploy || !changed) return { mode: deploy ? 'apply' : 'test', changed: false, changeNeeded: changed, validated: tests.length, ruleset: previous.rulesetName, sourceSha256 };
  const candidate = await request(`projects/${PROJECT}/rulesets`, { method: 'POST', body: { source } });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime)
    throw new Error('Active rules changed during validation; retry against current rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Cannot verify published trial protection.');
  return { mode: 'apply', changed: true, validated: tests.length, previousRuleset: previous.rulesetName, ruleset: candidate.name, sourceSha256 };
}

export { setupCredentials };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (flags.length === 1 && flags[0] === '--setup') {
    setupCredentials();
    console.log('Service-account key ready (not shown).');
  } else {
    const index = flags.indexOf('--firebase-tools');
    const cliRoot = index >= 0 ? flags.splice(index, 2)[1] : null;
    if (!cliRoot || cliRoot.startsWith('--') || flags.length > 1 || flags.some(flag => !['--read', '--apply'].includes(flag)))
      throw new Error('Use --firebase-tools <installed-package-directory>, optionally --read or --apply; or --setup.');
    const require = createRequire(import.meta.url), cli = name => require(resolve(cliRoot, 'lib', name));
    const { Command } = cli('command'), { requireAuth } = cli('requireAuth'), { logger } = cli('logger'), { Client } = cli('apiv2');
    logger.silent = true;
    const command = new Command('trial:rules').before(requireAuth).action(async () => {
      const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
      const request = async (path, options = {}) => {
        try { return (await client.request({ method: options.method || 'GET', path, ...(options.body ? { body: options.body } : {}),
          skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } })).body; }
        catch (error) { throw new Error('Rules API failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ') on ' + (options.method || 'GET') + ' ' + path.replace(/rulesets\/[\w-]+/, 'rulesets/…') + ': ' + String(error.context?.body?.error?.message || error.message || '').slice(0, 400)); }
      };
      console.log(JSON.stringify(await publishTrialRules({ request, deploy: flags.includes('--apply'), readOnly: flags.includes('--read') }), null, 2));
    });
    await command.runner()({ project: PROJECT, projectId: PROJECT, projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
  }
}
