// Narrow migration of the CURRENT shared Firestore rules for Shop Guard
// (shopguard/, the shop camera recorder and AI watch). Like the Polymath Office
// tool it never replaces the shared rules: it inserts one block of Shop Guard
// rules and adds one predicate to the existing catch-all, so every other app
// keeps exactly the permissions it has today.
//
// WHY. The shared catch-all is OPEN for any collection no app has claimed.
// Without this block the shop's Telegram bot token (in the settings document),
// every alert with its AI description and thumbnail, and every clip record would
// be readable by anybody holding the public web config. The page checks this on
// load (a signed-out read of shopguard/{shop} must be refused) and refuses to
// record or save settings until it is.
//
// What it protects (everything else is untouched):
//   shopguard/{shopId}                 settings          owners only
//   shopguard/{shopId}/{anything}/...  cameras, alerts,  owners only
//                                      segments, daily,
//                                      activity, diagnostics
//
//   node tools/shopguard-rules.mjs --firebase-tools <dir> --read   is it installed?
//   node tools/shopguard-rules.mjs --firebase-tools <dir>          test only, change nothing
//   node tools/shopguard-rules.mjs --firebase-tools <dir> --apply  test, then publish
//   node tools/shopguard-rules.mjs --setup                         write the CI key file
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { officePreservedTests, officeRuleTests } from './office-rules.mjs';
import { describeRules, setupCredentials } from './online-rules.mjs';

export const PROJECT = 'mathgen--app';
// Keep equal to ALLOWED_EMAILS in shopguard/index.html and SHOPGUARD_OWNERS in
// tools/shopguard-storage-rules.mjs (a test checks).
export const SHOPGUARD_OWNERS = ['chungzhikai@gmail.com'];
export const SHOPGUARD_ROOT = 'shopguard';
const list = a => JSON.stringify(a).replace(/"/g, "'").replace(/,/g, ', ');

export const SHOPGUARD_RULE = `    // BEGIN polymath-shopguard-v1
    // Shop Guard (polymathlc.com.sg/shopguard): the shop camera's settings
    // (including the Telegram bot token), alerts, clip records, daily counts and
    // AI notes. Only the shop owner's verified Google accounts. The catch-all
    // below skips this path.
    function isShopGuardPath() {
      return request.path[3] == '${SHOPGUARD_ROOT}';
    }
    function isShopGuardOwner() {
      return request.auth != null
        && request.auth.token.get('email_verified', false) == true
        && request.auth.token.get('email', '').lower() in ${list(SHOPGUARD_OWNERS)};
    }
    match /${SHOPGUARD_ROOT}/{shopId} {
      allow read, write: if isShopGuardOwner();
    }
    match /${SHOPGUARD_ROOT}/{shopId}/{shopGuardDoc=**} {
      allow read, write: if isShopGuardOwner();
    }
    // END polymath-shopguard-v1

`;

// Same catch-all shape the other narrow patches recognise: one
// `allow read, write: if !isPermanentStudentHistoryPath() && !isLiveServerPath() && …;`
// line. Only " && !isShopGuardPath()" is added to its end.
const CATCH_ALL = /allow read, write: if !isPermanentStudentHistoryPath\(\) && !isLiveServerPath\(\)((?: && !\w+\(\))*);/g;
const CATCH_ALL_MATCH = /^([ \t]*)match\s+\/\{\w+=\*\*\}\s*\{/m;
const PREDICATE = ' && !isShopGuardPath()';

function count(source, pattern) { return (source.match(pattern) || []).length; }

export function addShopGuardRules(source) {
  if (typeof source !== 'string' || !source.includes('service cloud.firestore {')
      || count(source, /match\s+\/databases\/\{\w+\}\/documents\s*\{/g) !== 1
      || count(source, /match\s+\/\{\w+=\*\*\}/g) !== 1
      || !source.includes("'cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'"))
    throw new Error('Unrecognized current shared rules; no rules changed.');
  const lines = source.match(CATCH_ALL) || [];
  if (lines.length !== 1)
    throw new Error('Expected one shared catch-all line; review changed rules first.');
  const installed = lines[0].includes(PREDICATE + ';') || lines[0].includes(PREDICATE + ' &&');
  if (installed) {
    if (!source.includes(SHOPGUARD_RULE) || count(source, /BEGIN polymath-shopguard-v1/g) !== 1
        || count(source, /function isShopGuardPath/g) !== 1 || count(source, /isShopGuardPath\(\)/g) !== 2)
      throw new Error('Ambiguous existing Shop Guard protection.');
    return source;
  }
  if (source.includes('polymath-shopguard-v1') || source.includes('isShopGuardPath')
      || /function\s+isShopGuardOwner\b/.test(source) || new RegExp(`match\\s+/${SHOPGUARD_ROOT}/`).test(source))
    throw new Error('A partial Shop Guard protection is already there; review changed rules first.');
  const updated = source.replace(CATCH_ALL_MATCH, whole => SHOPGUARD_RULE + whole)
    .replace(CATCH_ALL, line => line.slice(0, -1) + PREDICATE + ';');
  if (updated.replace(SHOPGUARD_RULE, '').replace(PREDICATE + ';', ';') !== source)
    throw new Error('Unrelated rules would change.');
  return updated;
}

/* ================= Permission tests (run by the Rules API) ================= */
const OWNER = 'sg-test-owner', STRANGER = 'sg-test-stranger';
const TOKENS = {
  [OWNER]: { email: 'chungzhikai@gmail.com', email_verified: true },
  'sg-test-owner-caps': { email: 'ChungZhiKai@Gmail.com', email_verified: true },
  [STRANGER]: { email: 'stranger@example.com', email_verified: true },
  'sg-test-office-admin': { email: 'admin@polymathlc.com.sg', email_verified: true },
  'sg-test-unverified': { email: 'chungzhikai@gmail.com', email_verified: false },
  'sg-test-anon-provider': {}
};
export const OWNER_UIDS = [OWNER, 'sg-test-owner-caps'];
export const OTHER_UIDS = [null, STRANGER, 'sg-test-office-admin', 'sg-test-unverified', 'sg-test-anon-provider'];

export function shopGuardCase(path, method, expectation, uid = null, { data = { test: true } } = {}) {
  const test = { expectation, request: {
    path: '/databases/(default)/documents/' + path, method,
    auth: uid ? { uid, token: { sub: uid, ...(TOKENS[uid] || {}) } } : null,
    ...(['create', 'update'].includes(method) ? { resource: { data } } : {})
  } };
  if (method !== 'create') test.resource = { data };
  return test;
}

export const SHOPGUARD_DOC_PATHS = [
  'shopguard/cc-collectibles',
  'shopguard/cc-collectibles/cameras/counter_cam',
  'shopguard/cc-collectibles/alerts/2026-11-03_1793713924660_counter_cam',
  'shopguard/cc-collectibles/segments/counter_cam_1793713914708',
  'shopguard/cc-collectibles/daily/2026-11-03',
  'shopguard/cc-collectibles/activity/counter_cam_1793713917359',
  'shopguard/cc-collectibles/diagnostics/last-test',
  'shopguard/another-shop/alerts/probe'
];
// Lists the page makes (its queries are all inside one shop). The top-level
// shopguard collection is never listed by the page; the Rules API answers that
// with DENY even for the owner, so only the refusal for everyone else is pinned.
export const SHOPGUARD_LISTS = ['shopguard/cc-collectibles/alerts', 'shopguard/cc-collectibles/segments', 'shopguard/cc-collectibles/cameras', 'shopguard/cc-collectibles/activity'];

export function shopGuardRuleTests() {
  const cases = [];
  const data = { settings: { telegramBotToken: '123:probe', telegramChatId: '1' }, headline: 'probe' };
  for (const path of SHOPGUARD_DOC_PATHS) {
    for (const method of ['get', 'create', 'update', 'delete']) {
      for (const uid of OTHER_UIDS) cases.push(shopGuardCase(path, method, 'DENY', uid, { data }));
      for (const uid of OWNER_UIDS) cases.push(shopGuardCase(path, method, 'ALLOW', uid, { data }));
    }
  }
  for (const path of SHOPGUARD_LISTS) {
    for (const uid of OTHER_UIDS) cases.push(shopGuardCase(path, 'list', 'DENY', uid));
    for (const uid of OWNER_UIDS) cases.push(shopGuardCase(path, 'list', 'ALLOW', uid));
  }
  for (const uid of OTHER_UIDS) cases.push(shopGuardCase('shopguard', 'list', 'DENY', uid));
  return cases;
}

// Everything around Shop Guard keeps its current permissions: Polymath Office's
// preserved set (which already carries every installed protection), Office's own
// cases when it is installed, and look-alike paths next to shopguard/.
export function shopGuardPreservedTests(source) {
  const cases = [...officePreservedTests(source)];
  if (source.includes('polymath-office-v1')) cases.push(...officeRuleTests());
  for (const path of ['shopguardx/probe', 'shop_guard/probe', 'users/probe/shopguard/item', 'shopguard_archive/probe'])
    for (const method of ['get', 'create', 'update', 'delete']) cases.push(shopGuardCase(path, method, 'ALLOW'));
  return cases;
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

export async function publishShopGuardRules({ request, deploy = false, readOnly = false }) {
  if (deploy && readOnly) throw new Error('Read and apply modes are exclusive.');
  const releasePath = `projects/${PROJECT}/releases/cloud.firestore`;
  const previous = await request(releasePath);
  const valid = name => typeof name === 'string' && name.startsWith(`projects/${PROJECT}/rulesets/`) && !name.slice(`projects/${PROJECT}/rulesets/`.length).includes('/');
  if (!valid(previous.rulesetName)) throw new Error('Unexpected current ruleset.');
  const production = await request(previous.rulesetName), files = production.source?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Unexpected current rules files.');
  const original = files[0].content;
  let content;
  try { content = addShopGuardRules(original); }
  catch (error) { error.message += ' Current rules outline: ' + JSON.stringify(describeRules(original)); throw error; }
  const changed = original !== content;
  const sourceSha256 = createHash('sha256').update(content).digest('hex');
  if (readOnly) return { mode: 'read', changeNeeded: changed, ruleset: previous.rulesetName, sourceSha256 };
  const source = { files: [{ ...files[0], content }] }, preserved = shopGuardPreservedTests(original);
  // The preserved expectations must already hold on today's rules, so a surprise
  // in the live rules stops here instead of being "fixed" by us.
  if (changed) await validate(request, PROJECT, production.source, preserved);
  const tests = [...preserved, ...shopGuardRuleTests()];
  await validate(request, PROJECT, source, tests);
  if (!deploy || !changed) return { mode: deploy ? 'apply' : 'test', changed: false, changeNeeded: changed, validated: tests.length, ruleset: previous.rulesetName, sourceSha256 };
  const candidate = await request(`projects/${PROJECT}/rulesets`, { method: 'POST', body: { source } });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime)
    throw new Error('Active rules changed during validation; retry against current rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Cannot verify published Shop Guard protection.');
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
    const command = new Command('shopguard:rules').before(requireAuth).action(async () => {
      const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
      const request = async (path, options = {}) => {
        try { return (await client.request({ method: options.method || 'GET', path, ...(options.body ? { body: options.body } : {}),
          skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } })).body; }
        catch (error) { throw new Error('Rules API failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ') on ' + (options.method || 'GET') + ' ' + path.replace(/rulesets\/[\w-]+/, 'rulesets/…') + ': ' + String(error.context?.body?.error?.message || error.message || '').slice(0, 400)); }
      };
      console.log(JSON.stringify(await publishShopGuardRules({ request, deploy: flags.includes('--apply'), readOnly: flags.includes('--read') }), null, 2));
    });
    await command.runner()({ project: PROJECT, projectId: PROJECT, projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
  }
}
