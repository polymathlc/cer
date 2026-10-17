// Narrow migration of the CURRENT shared Firestore rules for the
// polymathlc.com.sg/cs download gate (cs/ + cs-function/). It never replaces
// the shared rules: it inserts one small block and adds one predicate to the
// existing catch-all, so every other app keeps exactly the permissions it has.
//
// Why it exists: the shared catch-all is OPEN, so without this anybody on the
// internet could read every parent's name, email and WhatsApp number straight
// out of csLeads with the public web config. These five collections are
// written and read ONLY by the cs-function Cloud Functions through the Admin
// SDK (which bypasses rules), so the browser — signed in or not, admin or not —
// is refused all of them.
//
//   csFiles     the files on the page (titles, storage paths, counters)
//   csLeads     people who unlocked a download, with their recorded consent
//               (and csLeads/{id}/unlocks/{event}, their download history)
//   csLimits    hourly rate-limit counters
//   csGrants    download links (stored only as hashes of the key)
//   csSettings  the page's own text
//
//   node tools/cs-rules.mjs --firebase-tools <dir> --read   is it installed?
//   node tools/cs-rules.mjs --firebase-tools <dir>          test only, change nothing
//   node tools/cs-rules.mjs --firebase-tools <dir> --apply  test, then publish
//   node tools/cs-rules.mjs --setup                         write the CI key file
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preservedRuleTests, liveRuleTests } from './cer-live-server-rules.mjs';
import { enquiryRuleTests } from './enquiry-rules.mjs';
import { PROJECT, describeRules, onlineRuleTests, setupCredentials } from './online-rules.mjs';

export const CS_COLLECTIONS = Object.freeze(['csFiles', 'csLeads', 'csLimits', 'csGrants', 'csSettings']);

export const CS_RULE = `    // BEGIN polymath-cs-server-only-v1
    // polymathlc.com.sg/cs: files, leads (contact details and marketing
    // consent), rate limits, download links and page text. Only the
    // cs-function Cloud Functions touch these, through the Admin SDK; the
    // catch-all below skips them, so every browser is refused.
    function isPolymathCsPath() {
      return request.path[3] in ${JSON.stringify(CS_COLLECTIONS).replace(/"/g, "'").replace(/,/g, ', ')};
    }
    // END polymath-cs-server-only-v1

`;

// The shared catch-all is one `allow read, write: if !A() && !B() …;` line.
// Other apps append their own `&& !isXPath()` predicates, so any number of
// them is accepted; only " && !isPolymathCsPath()" is added, at the end.
const CATCH_ALL = /allow read, write: if !isPermanentStudentHistoryPath\(\) && !isLiveServerPath\(\)((?: && !\w+\(\))*);/g;
const CATCH_ALL_MATCH = /^([ \t]*)match\s+\/\{\w+=\*\*\}\s*\{/m;
const PREDICATE = ' && !isPolymathCsPath()';

function count(source, pattern) { return (source.match(pattern) || []).length; }

export function addCsRules(source) {
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
    if (!source.includes(CS_RULE) || count(source, /BEGIN polymath-cs-server-only-v1/g) !== 1
        || count(source, /function isPolymathCsPath/g) !== 1 || count(source, /isPolymathCsPath\(\)/g) !== 2)
      throw new Error('Ambiguous existing /cs protection.');
    return source;
  }
  if (source.includes('polymath-cs-server-only-v1') || source.includes('isPolymathCsPath'))
    throw new Error('A partial /cs protection is already there; review changed rules first.');
  // A collection of the same name already covered by some other block would
  // mean somebody else owns it: refuse rather than guess.
  for (const name of CS_COLLECTIONS)
    if (new RegExp("['\"/]" + name + "['\"/]").test(source))
      throw new Error('The rules already mention ' + name + '; review changed rules first.');
  const updated = source.replace(CATCH_ALL_MATCH, whole => CS_RULE + whole)
    .replace(CATCH_ALL, line => line.slice(0, -1) + PREDICATE + ';');
  if (updated.replace(CS_RULE, '').replace(PREDICATE + ';', ';') !== source)
    throw new Error('Unrelated rules would change.');
  return updated;
}

/* ================= Permission tests (run by the Rules API) ================= */
const TOKENS = {
  'cs-test-visitor': { email: 'parent@example.com', email_verified: true },
  'cs-test-admin': { email: 'chungzhikai@gmail.com', email_verified: true },
  'cs-test-claim': { email: 'staff@example.com', email_verified: true, admin: true },
  'cs-test-anon': {}
};

export function csCase(path, method, expectation, uid = null, data = { test: true }) {
  const test = { expectation, request: {
    path: '/databases/(default)/documents/' + path, method,
    auth: uid ? { uid, token: { sub: uid, ...(TOKENS[uid] || {}) } } : null,
    ...(['create', 'update'].includes(method) ? { resource: { data } } : {})
  } };
  if (method !== 'create') test.resource = { data };
  return test;
}

/** Nobody — signed out, signed in, the admin, or an admin claim — reaches /cs data from a browser. */
export function csRuleTests() {
  const lead = { name: 'Probe', email: 'probe@example.com', whatsapp: '+6591234567', consentActive: true };
  return CS_COLLECTIONS.flatMap(root => [null, ...Object.keys(TOKENS)].flatMap(uid => [
    ...[root + '/probe', root + '/probe/unlocks/event', root + '/probe/nested/child'].flatMap(path =>
      ['get', 'create', 'update', 'delete'].map(method => csCase(path, method, 'DENY', uid, root === 'csLeads' ? lead : { test: true }))),
    ...[root, root + '/probe/unlocks'].map(path => csCase(path, 'list', 'DENY', uid))
  ]));
}

/** Everything around /cs keeps its current permissions. */
export function csPreservedTests(source) {
  const open = ['csFilesArchive/probe', 'users/probe/csLeads/item', 'users/probe/csFiles/item',
    'cs/probe', 'csLead/probe', 'leads/probe', 'studentProfiles/probe', 'pdfAnnotator/probe', 'mail/unrelated-existing-mail'];
  const cases = [...preservedRuleTests(source), ...liveRuleTests(),
    ...open.flatMap(path => ['get', 'create', 'update', 'delete'].map(method => csCase(path, method, 'ALLOW')))];
  // Other apps' narrow protections, if they are installed, must still hold.
  if (source.includes('polymath-enquiry-server-only-v1')) cases.push(...enquiryRuleTests());
  if (source.includes('polymath-online-v1')) cases.push(...onlineRuleTests());
  return cases;
}

async function validate(request, source, tests) {
  for (let offset = 0; offset < tests.length; offset += 100) {
    const batch = tests.slice(offset, offset + 100);
    const result = await request(`projects/${PROJECT}:test`, { method: 'POST', body: { source, testSuite: { testCases: batch } } });
    const failed = (result.testResults || []).flatMap((test, index) => test.state === 'SUCCESS' ? [] : [offset + index]);
    if (result.testResults?.length !== batch.length || failed.length || (result.issues || []).some(issue => issue.severity === 'ERROR'))
      throw new Error('Rules tests failed; active rules unchanged: ' + JSON.stringify({ failed: failed.length, expected: batch.length, received: result.testResults?.length || 0,
        cases: failed.slice(0, 10).map(index => ({ path: tests[index].request.path, method: tests[index].request.method,
          expected: tests[index].expectation, uid: tests[index].request.auth?.uid || null })),
        issues: (result.issues || []).filter(issue => issue.severity === 'ERROR').map(issue => ({ description: issue.description, sourcePosition: issue.sourcePosition })) }));
  }
}

export async function publishCsRules({ request, deploy = false, readOnly = false }) {
  if (deploy && readOnly) throw new Error('Read and apply modes are exclusive.');
  const releasePath = `projects/${PROJECT}/releases/cloud.firestore`;
  const previous = await request(releasePath);
  const valid = name => typeof name === 'string' && name.startsWith(`projects/${PROJECT}/rulesets/`) && !name.slice(`projects/${PROJECT}/rulesets/`.length).includes('/');
  if (!valid(previous.rulesetName)) throw new Error('Unexpected current ruleset.');
  const production = await request(previous.rulesetName), files = production.source?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Unexpected current rules files.');
  const original = files[0].content;
  let content;
  try { content = addCsRules(original); }
  catch (error) { error.message += ' Current rules outline: ' + JSON.stringify(describeRules(original)); throw error; }
  const changed = original !== content;
  const sourceSha256 = createHash('sha256').update(content).digest('hex');
  if (readOnly) return { mode: 'read', changeNeeded: changed, ruleset: previous.rulesetName, sourceSha256 };
  const source = { files: [{ ...files[0], content }] }, preserved = csPreservedTests(original);
  // The preserved expectations must already hold on today's rules, so a
  // surprise in the live rules stops here instead of being "fixed" by us.
  if (changed) await validate(request, production.source, preserved);
  const tests = [...preserved, ...csRuleTests()];
  await validate(request, source, tests);
  if (!deploy || !changed) return { mode: deploy ? 'apply' : 'test', changed: false, changeNeeded: changed, validated: tests.length, ruleset: previous.rulesetName, sourceSha256 };
  const candidate = await request(`projects/${PROJECT}/rulesets`, { method: 'POST', body: { source } });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime)
    throw new Error('Active rules changed during validation; retry against current rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Cannot verify the published /cs protection.');
  return { mode: 'apply', changed: true, validated: tests.length, previousRuleset: previous.rulesetName, ruleset: candidate.name, sourceSha256 };
}

/* ================= Storage: READ-ONLY exposure check ================= */
// The files themselves live in Storage under cs-files/, and Storage rules are
// shared too. This never changes them: it asks the Rules API whether, under
// the LIVE Storage rules, a stranger could read or list a /cs file directly
// (going round the form), and whether the admin can upload from the page.
export const STORAGE_BUCKET = 'mathgen--app.firebasestorage.app';
export function storageCases() {
  const path = (p) => '/b/' + STORAGE_BUCKET + '/o/' + p;
  const auth = (uid, email) => (uid ? { uid, token: { sub: uid, email, email_verified: true } } : null);
  const file = { name: 'cs-files/probe1234/Notes.pdf', size: 1000, contentType: 'application/pdf', metadata: {} };
  const c = (key, method, p, who, data) => ({ key, test: { expectation: 'ALLOW', request: {
    path: path(p), method, auth: who, ...(method === 'create' ? { resource: data } : {}) },
    ...(method !== 'create' ? { resource: data || file } : {}) } });
  return [
    c('strangerCanRead', 'get', 'cs-files/probe1234/Notes.pdf', null),
    c('strangerCanList', 'list', 'cs-files/probe1234', null),
    c('signedInCanRead', 'get', 'cs-files/probe1234/Notes.pdf', auth('cs-probe-user', 'parent@example.com')),
    c('adminCanUpload', 'create', 'cs-files/probe1234/Notes.pdf', auth('cs-probe-admin', 'chungzhikai@gmail.com'), file),
    c('previewsReadable', 'get', 'cs-previews/probe1234/a-0.jpg', null, { name: 'cs-previews/probe1234/a-0.jpg', size: 100, contentType: 'image/jpeg', metadata: {} })
  ];
}

export async function storageExposure({ request }) {
  const releasePath = `projects/${PROJECT}/releases/firebase.storage/${STORAGE_BUCKET}`;
  const release = await request(releasePath);
  if (!release || typeof release.rulesetName !== 'string') return { known: false, reason: 'no Storage release found' };
  const ruleset = await request(release.rulesetName);
  const cases = storageCases();
  const result = await request(`projects/${PROJECT}:test`, { method: 'POST',
    body: { source: ruleset.source, testSuite: { testCases: cases.map(c => c.test) } } });
  const out = { known: true, ruleset: release.rulesetName };
  (result.testResults || []).forEach((r, i) => { out[cases[i].key] = r.state === 'SUCCESS'; });
  out.gateCanBeBypassed = !!(out.strangerCanRead || out.strangerCanList || out.signedInCanRead);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (flags.length === 1 && flags[0] === '--setup') {
    setupCredentials();
    console.log('Service-account key ready (not shown).');
  } else {
    const index = flags.indexOf('--firebase-tools');
    const cliRoot = index >= 0 ? flags.splice(index, 2)[1] : null;
    if (!cliRoot || cliRoot.startsWith('--') || flags.length > 1 || flags.some(flag => !['--read', '--apply', '--storage'].includes(flag)))
      throw new Error('Use --firebase-tools <installed-package-directory>, optionally --read, --apply or --storage; or --setup.');
    const require = createRequire(import.meta.url), cli = name => require(resolve(cliRoot, 'lib', name));
    const { Command } = cli('command'), { requireAuth } = cli('requireAuth'), { logger } = cli('logger'), { Client } = cli('apiv2');
    logger.silent = true;
    const command = new Command('cs:rules').before(requireAuth).action(async () => {
      const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
      const request = async (path, options = {}) => {
        try { return (await client.request({ method: options.method || 'GET', path, ...(options.body ? { body: options.body } : {}),
          skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } })).body; }
        catch (error) { throw new Error('Rules API failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ') on ' + (options.method || 'GET') + ' ' + path.replace(/rulesets\/[\w-]+/, 'rulesets/…') + ': ' + String(error.context?.body?.error?.message || error.message || '').slice(0, 400)); }
      };
      if (flags.includes('--storage')) console.log(JSON.stringify(await storageExposure({ request }), null, 2));
      else console.log(JSON.stringify(await publishCsRules({ request, deploy: flags.includes('--apply'), readOnly: flags.includes('--read') }), null, 2));
    });
    await command.runner()({ project: PROJECT, projectId: PROJECT, projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
  }
}
