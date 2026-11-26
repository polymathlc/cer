// Narrow migration of the CURRENT shared Firestore rules for the /cc page
// (Caius and Caris's Robux quest board). Like the trial, Office and Shop Guard
// tools it never replaces the shared rules: it inserts one block and adds one
// predicate to the existing catch-all, so every other app keeps exactly the
// permissions it has today.
//
// WHY. The shared catch-all is OPEN (read and write) for any collection no app
// has claimed. Without this block anybody holding the public web config could
// add quests, mark them done, or wipe the Robux ledger.
//
// What it does (everything else is untouched):
//   ccQuests/**    the quests, each child's result (success / failed / open)
//   ccLedger/**    Robux paid out (redeemed) and bonus / penalty adjustments
//   ccSettings/**  each child's savings goal and display settings
// Anyone may READ them (the children open the page without signing in).
// Only Zhi Kai's verified Google accounts may create, change or delete them.
//
//   node tools/cc-rules.mjs --firebase-tools <dir> --read   is it installed?
//   node tools/cc-rules.mjs --firebase-tools <dir>          test only, change nothing
//   node tools/cc-rules.mjs --firebase-tools <dir> --apply  test, then publish
//   node tools/cc-rules.mjs --setup                         write the CI key file
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describeRules, setupCredentials } from './online-rules.mjs';
import { trialPreservedTests, trialRuleTests } from './trial-rules.mjs';
import { withSignedOutLock } from './signed-out-lock-core.mjs';

export const PROJECT = 'mathgen--app';
export const CC_COLLECTIONS = Object.freeze(['ccQuests', 'ccLedger', 'ccSettings']);
// Kept in step with CC_ADMINS in cc/cc-core.mjs (the tests check it).
export const CC_ADMINS = Object.freeze(['chungzhikai@gmail.com', 'admin@polymathlc.com.sg']);
const list = a => JSON.stringify(a).replace(/"/g, "'").replace(/,/g, ', ');

function collectionBlock(name) {
  return `    match /${name}/{ccDoc=**} {
      allow read: if true;
      allow write: if isPolymathCcAdmin();
    }
`;
}

export const CC_RULE = `    // BEGIN polymath-cc-quests-v1
    // Caius and Caris's Robux quest board (polymathlc.com.sg/cc). Anyone may
    // read it (the children open it without signing in); only Zhi Kai's
    // verified Google accounts may write. The catch-all below skips these paths.
    function isPolymathCcPath() {
      return request.path[3] in ${list(CC_COLLECTIONS)};
    }
    function isPolymathCcAdmin() {
      return request.auth != null
        && request.auth.token.get('email_verified', false) == true
        && request.auth.token.get('email', '').lower() in ${list(CC_ADMINS)};
    }
${CC_COLLECTIONS.map(collectionBlock).join('')}    // END polymath-cc-quests-v1

`;

// The same catch-all shape the other narrow patches recognise. Only
// " && !isPolymathCcPath()" is added to its end.
const CATCH_ALL = /allow read, write: if !isPermanentStudentHistoryPath\(\) && !isLiveServerPath\(\)((?: && !\w+\(\))*);/g;
const CATCH_ALL_MATCH = /^([ \t]*)match\s+\/\{\w+=\*\*\}\s*\{/m;
const PREDICATE = ' && !isPolymathCcPath()';

function count(source, pattern) { return (source.match(pattern) || []).length; }

export function addCcRules(source) {
  if (typeof source !== 'string' || !source.includes('service cloud.firestore {')
      || count(source, /match\s+\/databases\/\{\w+\}\/documents\s*\{/g) !== 1
      || count(source, /match\s+\/\{\w+=\*\*\}/g) !== 1)
    throw new Error('Unrecognized current shared rules; no rules changed.');
  const lines = source.match(CATCH_ALL) || [];
  if (lines.length !== 1)
    throw new Error('Expected one shared catch-all line; review changed rules first.');
  const installed = lines[0].includes(PREDICATE + ';') || lines[0].includes(PREDICATE + ' &&');
  if (installed) {
    if (!source.includes(CC_RULE) || count(source, /BEGIN polymath-cc-quests-v1/g) !== 1
        || count(source, /function isPolymathCcPath/g) !== 1 || count(source, /isPolymathCcPath\(\)/g) !== 2)
      throw new Error('Ambiguous existing cc quest protection.');
    return source;
  }
  if (source.includes('polymath-cc-quests-v1') || source.includes('isPolymathCcPath') || source.includes('isPolymathCcAdmin')
      || CC_COLLECTIONS.some(name => new RegExp(`match\\s+/${name}/`).test(source)))
    throw new Error('A partial cc quest protection is already there; review changed rules first.');
  const updated = source.replace(CATCH_ALL_MATCH, whole => CC_RULE + whole)
    .replace(CATCH_ALL, line => line.slice(0, -1) + PREDICATE + ';');
  if (updated.replace(CC_RULE, '').replace(PREDICATE + ';', ';') !== source)
    throw new Error('Unrelated rules would change.');
  return updated;
}

/* ================= Permission tests (run by the Rules API) ================= */
const TOKENS = {
  'cc-test-owner': { email: 'chungzhikai@gmail.com', email_verified: true },
  'cc-test-owner-caps': { email: 'ChungZhiKai@Gmail.com', email_verified: true },
  'cc-test-admin': { email: 'admin@polymathlc.com.sg', email_verified: true },
  'cc-test-owner-unverified': { email: 'chungzhikai@gmail.com', email_verified: false },
  'cc-test-staff': { email: 'support@polymathlc.com.sg', email_verified: true },
  'cc-test-stranger': { email: 'stranger@example.com', email_verified: true },
  'cc-test-anon-provider': {}
};
export const WRITERS = ['cc-test-owner', 'cc-test-owner-caps', 'cc-test-admin'];
export const NOT_WRITERS = [null, 'cc-test-owner-unverified', 'cc-test-staff', 'cc-test-stranger', 'cc-test-anon-provider'];
export const EVERYONE = [...NOT_WRITERS, ...WRITERS];

export function ccCase(path, method, expectation, uid = null, { data = { test: true } } = {}) {
  const test = { expectation, request: {
    path: '/databases/(default)/documents/' + path, method,
    auth: uid ? { uid, token: { sub: uid, ...(TOKENS[uid] || {}) } } : null,
    ...(['create', 'update'].includes(method) ? { resource: { data } } : {})
  } };
  if (method !== 'create') test.resource = { data };
  return test;
}

export const CC_DOC_PATHS = ['ccQuests/q123', 'ccLedger/l123', 'ccSettings/main', 'ccQuests/q123/notes/one'];

export function ccRuleTests() {
  const cases = [];
  const data = { title: 'Read 20 minutes', reward: 50, kids: ['caius'] };
  for (const path of CC_DOC_PATHS) {
    for (const uid of EVERYONE) cases.push(ccCase(path, 'get', 'ALLOW', uid, { data }));
    for (const method of ['create', 'update', 'delete']) {
      for (const uid of WRITERS) cases.push(ccCase(path, method, 'ALLOW', uid, { data }));
      for (const uid of NOT_WRITERS) cases.push(ccCase(path, method, 'DENY', uid, { data }));
    }
  }
  for (const name of CC_COLLECTIONS)
    for (const uid of EVERYONE) cases.push(ccCase(name, 'list', 'ALLOW', uid));
  return cases;
}

// Everything around the cc collections keeps its current permissions: the
// trial tool's preserved set (which carries Shop Guard's, Office's and every
// earlier protection), the trial's own cases when it is installed, and
// look-alike paths next to ours, which stay as open as the catch-all leaves them.
export function ccPreservedTests(source) {
  const cases = [...trialPreservedTests(source)];
  if (source.includes('polymath-trial-v1')) cases.push(...trialRuleTests());
  for (const path of ['ccQuestsX/probe', 'cc/probe', 'users/probe/ccQuests/item', 'cc_quests/probe'])
    for (const method of ['get', 'create', 'update', 'delete']) cases.push(ccCase(path, method, 'ALLOW'));
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

export async function publishCcRules({ request, deploy = false, readOnly = false }) {
  if (deploy && readOnly) throw new Error('Read and apply modes are exclusive.');
  const releasePath = `projects/${PROJECT}/releases/cloud.firestore`;
  const previous = await request(releasePath);
  const valid = name => typeof name === 'string' && name.startsWith(`projects/${PROJECT}/rulesets/`) && !name.slice(`projects/${PROJECT}/rulesets/`.length).includes('/');
  if (!valid(previous.rulesetName)) throw new Error('Unexpected current ruleset.');
  const production = await request(previous.rulesetName), files = production.source?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Unexpected current rules files.');
  const original = files[0].content;
  let content;
  try { content = addCcRules(original); }
  catch (error) { error.message += ' Current rules outline: ' + JSON.stringify(describeRules(original)); throw error; }
  const changed = original !== content;
  const sourceSha256 = createHash('sha256').update(content).digest('hex');
  if (readOnly) return { mode: 'read', changeNeeded: changed, ruleset: previous.rulesetName, sourceSha256 };
  const source = { files: [{ ...files[0], content }] }, preserved = ccPreservedTests(original);
  // The preserved expectations must already hold on today's rules, so a surprise
  // in the live rules stops here instead of being "fixed" by us.
  if (changed) await validate(request, PROJECT, production.source, preserved);
  const tests = [...preserved, ...ccRuleTests()];
  await validate(request, PROJECT, source, tests);
  if (!deploy || !changed) return { mode: deploy ? 'apply' : 'test', changed: false, changeNeeded: changed, validated: tests.length, ruleset: previous.rulesetName, sourceSha256 };
  const candidate = await request(`projects/${PROJECT}/rulesets`, { method: 'POST', body: { source } });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime)
    throw new Error('Active rules changed during validation; retry against current rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Cannot verify published cc quest protection.');
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
    const command = new Command('cc:rules').before(requireAuth).action(async () => {
      const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
      const request = async (path, options = {}) => {
        try { return (await client.request({ method: options.method || 'GET', path, ...(options.body ? { body: options.body } : {}),
          skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } })).body; }
        catch (error) { throw new Error('Rules API failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ') on ' + (options.method || 'GET') + ' ' + path.replace(/rulesets\/[\w-]+/, 'rulesets/…') + ': ' + String(error.context?.body?.error?.message || error.message || '').slice(0, 400)); }
      };
      console.log(JSON.stringify(await publishCcRules({ request, deploy: flags.includes('--apply'), readOnly: flags.includes('--read') }), null, 2));
    });
    await command.runner()({ project: PROJECT, projectId: PROJECT, projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
  }
}
