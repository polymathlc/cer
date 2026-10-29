// Narrow migration of the CURRENT shared Firestore rules for Polymath Office
// (office/ and pay/). It never replaces the shared rules: it inserts one block of
// office rules and adds one predicate to the existing catch-all, so every other
// app keeps exactly the permissions it has today.
//
// WHY THIS MUST BE PUBLISHED BEFORE ANY FAMILY IS ADDED. The shared catch-all is
// `allow read, write: if !A() && !B() …` — OPEN to the whole internet for any
// collection it does not name. Without this block, every parent's name, email,
// WhatsApp number and home address in `officeFamilies`, and every payment in
// `officePayments`, would be readable by anybody holding the public web config
// (which is in every page of the site). The office page checks this itself on
// load (a signed-out read of officeSettings must be refused) and refuses to save
// anything until it is.
//
// What it protects (everything else is untouched):
//   officeFamilies    parents and their students            admins only
//   officeInvoices    every invoice                         admins only
//   officePayments    every bank credit applied             admins only
//   officeStatements  uploaded statements and their reading admins only
//   officeSettings    the office's settings and heartbeat   admins only
//   officeLinks       a parent's invoice page               GET by anyone holding the
//                                                           24-character link; never listed;
//                                                           written by admins only
//   mail/polymath-office-*  invoice, reminder and receipt   only the admins can queue
//                           emails                          them or read their delivery state
//
//   node tools/office-rules.mjs --firebase-tools <dir> --read   is it installed?
//   node tools/office-rules.mjs --firebase-tools <dir>          test only, change nothing
//   node tools/office-rules.mjs --firebase-tools <dir> --apply  test, then publish
//   node tools/office-rules.mjs --setup                         write the CI key file
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preservedRuleTests, liveRuleTests } from './cer-live-server-rules.mjs';
import { enquiryRuleTests } from './enquiry-rules.mjs';
import { onlineRuleTests, describeRules, setupCredentials } from './online-rules.mjs';
import { csRuleTests } from './cs-rules.mjs';

export const PROJECT = 'mathgen--app';
// Keep equal to OFFICE_ADMINS in office/office-core.mjs (a test checks).
export const OFFICE_ADMINS = ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'elsielcr@gmail.com'];
export const OFFICE_PRIVATE = ['officeFamilies', 'officeInvoices', 'officePayments', 'officeStatements', 'officeSettings'];
export const OFFICE_COLLECTIONS = [...OFFICE_PRIVATE, 'officeLinks'];
export const OFFICE_MAIL_PREFIX = 'polymath-office-';
const list = a => JSON.stringify(a).replace(/"/g, "'").replace(/,/g, ', ');

export const OFFICE_RULE = `    // BEGIN polymath-office-v1
    // Polymath Office (polymathlc.com.sg/office and /pay): families, invoices,
    // payments, bank statements, settings, parents' invoice links and the
    // office's emails. The catch-all below skips these paths.
    function isPolymathOfficePath() {
      return request.path[3] in ${list(OFFICE_COLLECTIONS)}
        || (request.path[3] == 'mail'
          && request.path != /databases/$(request.path[1])/documents/mail
          && request.path[4].matches('^${OFFICE_MAIL_PREFIX}.*$'));
    }
    function isOfficeAdmin() {
      return request.auth != null
        && request.auth.token.get('email_verified', false) == true
        && request.auth.token.get('email', '').lower() in ${list(OFFICE_ADMINS)};
    }
${OFFICE_PRIVATE.map(c => `    match /${c}/{docId} {
      allow read, write: if isOfficeAdmin();
    }`).join('\n')}
    // A parent's invoice page: read by whoever holds the long random link,
    // never listed (so no link can be found without being given it).
    match /officeLinks/{token} {
      allow get: if token.size() >= 20;
      allow list, write: if isOfficeAdmin();
    }
    match /mail/{mailId} {
      allow create, get: if mailId.matches('^${OFFICE_MAIL_PREFIX}.*$') && isOfficeAdmin();
    }
    // END polymath-office-v1

`;

// The shared catch-all is one `allow read, write: if !A() && !B() …;` line.
// Other apps append their own `&& !isXPath()` predicates, so any number of them
// is accepted; only " && !isPolymathOfficePath()" is added to the end.
// The block goes right above the catch-all's `match /{document=**}`.
const CATCH_ALL = /allow read, write: if !isPermanentStudentHistoryPath\(\) && !isLiveServerPath\(\)((?: && !\w+\(\))*);/g;
const CATCH_ALL_MATCH = /^([ \t]*)match\s+\/\{\w+=\*\*\}\s*\{/m;
const PREDICATE = ' && !isPolymathOfficePath()';

function count(source, pattern) { return (source.match(pattern) || []).length; }

export function addOfficeRules(source) {
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
    if (!source.includes(OFFICE_RULE) || count(source, /BEGIN polymath-office-v1/g) !== 1
        || count(source, /function isPolymathOfficePath/g) !== 1 || count(source, /isPolymathOfficePath\(\)/g) !== 2)
      throw new Error('Ambiguous existing Polymath Office protection.');
    return source;
  }
  if (source.includes('polymath-office-v1') || source.includes('isPolymathOfficePath')
      || /function\s+isOfficeAdmin\b/.test(source) || /match\s+\/office(Families|Invoices|Payments|Statements|Settings|Links)\//.test(source))
    throw new Error('A partial Polymath Office protection is already there; review changed rules first.');
  const updated = source.replace(CATCH_ALL_MATCH, whole => OFFICE_RULE + whole)
    .replace(CATCH_ALL, line => line.slice(0, -1) + PREDICATE + ';');
  if (updated.replace(OFFICE_RULE, '').replace(PREDICATE + ';', ';') !== source)
    throw new Error('Unrelated rules would change.');
  return updated;
}

/* ================= Permission tests (run by the Rules API) ================= */
const PARENT = 'office-test-parent', STRANGER = 'office-test-stranger', ADMIN = 'office-test-admin';
const TOKENS = {
  [PARENT]: { email: 'parent@example.com', email_verified: true },
  [STRANGER]: { email: 'stranger@example.com', email_verified: true },
  [ADMIN]: { email: 'chungzhikai@gmail.com', email_verified: true },
  'office-test-admin-caps': { email: 'Admin@PolymathLC.com.sg', email_verified: true },
  'office-test-admin-three': { email: 'elsielcr@gmail.com', email_verified: true },
  'office-test-unverified': { email: 'chungzhikai@gmail.com', email_verified: false },
  'office-test-anon-provider': {}
};
const ADMINS = [ADMIN, 'office-test-admin-caps', 'office-test-admin-three'];
const NOT_ADMINS = [null, PARENT, STRANGER, 'office-test-unverified', 'office-test-anon-provider'];
const TOKEN = 'Ab3dEf7hJk9mNp2qRs4tUv6w';   // 24 characters, like a real link

export function officeCase(path, method, expectation, uid = null, { data = { test: true } } = {}) {
  const test = { expectation, request: {
    path: '/databases/(default)/documents/' + path, method,
    auth: uid ? { uid, token: { sub: uid, ...(TOKENS[uid] || {}) } } : null,
    ...(['create', 'update'].includes(method) ? { resource: { data } } : {})
  } };
  if (method !== 'create') test.resource = { data };
  return test;
}

export function officeRuleTests() {
  const cases = [];
  const all = ['get', 'list', 'create', 'update', 'delete'];
  const family = { parentName: 'Probe Parent', email: 'probe@example.com', whatsapp: '6591234567', address: '1 Probe Road' };
  // The private collections: the three admins do everything, nobody else anything.
  for (const root of OFFICE_PRIVATE) {
    for (const path of [root + '/probe', root + '/probe/nested/child']) {
      for (const uid of NOT_ADMINS) for (const method of all) cases.push(officeCase(path, method, 'DENY', uid, { data: family }));
      const nested = path.includes('/nested/');
      for (const uid of ADMINS) for (const method of all) cases.push(officeCase(path, method, nested ? 'DENY' : 'ALLOW', uid, { data: family }));
    }
    for (const uid of NOT_ADMINS) cases.push(officeCase(root, 'list', 'DENY', uid));
  }
  // A parent's invoice link: anybody may GET one by its long token, nobody but
  // the admins may list them or write them, and a short guess is refused.
  for (const uid of [...NOT_ADMINS, ...ADMINS]) cases.push(officeCase('officeLinks/' + TOKEN, 'get', 'ALLOW', uid));
  for (const uid of NOT_ADMINS) {
    cases.push(officeCase('officeLinks/short', 'get', 'DENY', uid));
    for (const method of ['list', 'create', 'update', 'delete']) cases.push(officeCase('officeLinks/' + TOKEN, method, 'DENY', uid));
    cases.push(officeCase('officeLinks/' + TOKEN + '/nested/child', 'get', 'DENY', uid));
  }
  for (const uid of ADMINS) for (const method of all) cases.push(officeCase('officeLinks/' + TOKEN, method, 'ALLOW', uid));
  // The office's emails: only the admins queue them and read their delivery state.
  const mail = 'mail/polymath-office-invoice-fam_2026-11-1730000000000';
  for (const uid of NOT_ADMINS) for (const method of ['get', 'create', 'update', 'delete']) cases.push(officeCase(mail, method, 'DENY', uid));
  for (const uid of ADMINS) {
    cases.push(officeCase(mail, 'create', 'ALLOW', uid), officeCase(mail, 'get', 'ALLOW', uid));
    cases.push(officeCase(mail, 'update', 'DENY', uid), officeCase(mail, 'delete', 'DENY', uid));
  }
  return cases;
}

// Everything around Polymath Office keeps its current permissions.
export function officePreservedTests(source) {
  const open = ['studentProfiles/probe', 'pdfAnnotator/probe', 'mail/unrelated-existing-mail',
    'officeFamiliesArchive/probe', 'office/probe', 'users/probe/officeFamilies/item', 'users/probe/officeLinks/item',
    'mail/not-polymath-office-x', 'mailbox/polymath-office-x', 'schedule_config/main', 'shop_orders/probe'];
  const cases = [...preservedRuleTests(source), ...liveRuleTests(),
    ...open.flatMap(path => ['get', 'create', 'update', 'delete'].map(method => officeCase(path, method, 'ALLOW')))];
  // Other apps' narrow protections, if they are installed, must still hold.
  if (source.includes('polymath-enquiry-server-only-v1')) cases.push(...enquiryRuleTests());
  else cases.push(officeCase('mail', 'list', 'ALLOW'));
  if (source.includes('polymath-online-v1')) cases.push(...onlineRuleTests());
  if (source.includes('polymath-cs-server-only-v1')) cases.push(...csRuleTests());
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

export async function publishOfficeRules({ request, deploy = false, readOnly = false }) {
  if (deploy && readOnly) throw new Error('Read and apply modes are exclusive.');
  const releasePath = `projects/${PROJECT}/releases/cloud.firestore`;
  const previous = await request(releasePath);
  const valid = name => typeof name === 'string' && name.startsWith(`projects/${PROJECT}/rulesets/`) && !name.slice(`projects/${PROJECT}/rulesets/`.length).includes('/');
  if (!valid(previous.rulesetName)) throw new Error('Unexpected current ruleset.');
  const production = await request(previous.rulesetName), files = production.source?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Unexpected current rules files.');
  const original = files[0].content;
  let content;
  try { content = addOfficeRules(original); }
  catch (error) { error.message += ' Current rules outline: ' + JSON.stringify(describeRules(original)); throw error; }
  const changed = original !== content;
  const sourceSha256 = createHash('sha256').update(content).digest('hex');
  if (readOnly) return { mode: 'read', changeNeeded: changed, ruleset: previous.rulesetName, sourceSha256 };
  const source = { files: [{ ...files[0], content }] }, preserved = officePreservedTests(original);
  // The preserved expectations must already hold on today's rules, so a surprise
  // in the live rules stops here instead of being "fixed" by us.
  if (changed) await validate(request, PROJECT, production.source, preserved);
  const tests = [...preserved, ...officeRuleTests()];
  await validate(request, PROJECT, source, tests);
  if (!deploy || !changed) return { mode: deploy ? 'apply' : 'test', changed: false, changeNeeded: changed, validated: tests.length, ruleset: previous.rulesetName, sourceSha256 };
  const candidate = await request(`projects/${PROJECT}/rulesets`, { method: 'POST', body: { source } });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime)
    throw new Error('Active rules changed during validation; retry against current rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Cannot verify published Polymath Office protection.');
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
    const command = new Command('office:rules').before(requireAuth).action(async () => {
      const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
      const request = async (path, options = {}) => {
        try { return (await client.request({ method: options.method || 'GET', path, ...(options.body ? { body: options.body } : {}),
          skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } })).body; }
        catch (error) { throw new Error('Rules API failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ') on ' + (options.method || 'GET') + ' ' + path.replace(/rulesets\/[\w-]+/, 'rulesets/…') + ': ' + String(error.context?.body?.error?.message || error.message || '').slice(0, 400)); }
      };
      console.log(JSON.stringify(await publishOfficeRules({ request, deploy: flags.includes('--apply'), readOnly: flags.includes('--read') }), null, 2));
    });
    await command.runner()({ project: PROJECT, projectId: PROJECT, projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
  }
}
