// Offline checks for tools/office-rules.mjs: the patch is narrow, idempotent,
// composes with every other app's protection, and refuses rules it does not
// recognise; the publisher never writes in read or test mode and never publishes
// over rules that changed underneath it. The permission expectations themselves
// run against Google's Rules API in .github/workflows/office-rules.yml before
// anything is published.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addOfficeRules, OFFICE_RULE, officeRuleTests, officePreservedTests, publishOfficeRules, OFFICE_ADMINS, OFFICE_COLLECTIONS } from './office-rules.mjs';
import { addEnquiryRules } from './enquiry-rules.mjs';
import { addOnlineRules } from './online-rules.mjs';
import { addCsRules } from './cs-rules.mjs';

const original = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isLiveServerPath() {
      return request.path[3] in ['cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'];
    }
    // BEGIN permanent-student-question-history-v1
    function isPermanentStudentHistoryPath() { return false; }
    match /{document=**} {
      allow read, write: if !isPermanentStudentHistoryPath() && !isLiveServerPath();
    }
  }
}`;
// The live project has the enquiry, Online and /cs protections already, in that order.
const withEnquiry = addEnquiryRules(original);
const live = addCsRules(addOnlineRules(withEnquiry));
const PREDICATE = ' && !isPolymathOfficePath()';

test('the patch adds one block and one predicate, on every shape of the catch-all', () => {
  for (const source of [original, withEnquiry, live]) {
    const updated = addOfficeRules(source);
    assert.notEqual(updated, source);
    assert.equal(updated.replace(OFFICE_RULE, '').replace(PREDICATE + ';', ';'), source);
    assert.equal((updated.match(/BEGIN polymath-office-v1/g) || []).length, 1);
    assert.match(updated, /&& !isPolymathOfficePath\(\);\n    \}/);
    assert.ok(updated.includes(OFFICE_RULE + '    match /{document=**} {'), 'right above the catch-all');
    assert.ok(updated.indexOf(OFFICE_RULE) > updated.indexOf('match /databases/{database}/documents'));
  }
});

test('the other apps\' protections stay exactly as they were', () => {
  const updated = addOfficeRules(live);
  for (const marker of ['polymath-enquiry-server-only-v1', 'polymath-online-v1', 'polymath-cs-server-only-v1'])
    assert.equal((updated.match(new RegExp('BEGIN ' + marker, 'g')) || []).length, 1, marker);
  assert.ok(updated.includes('!isPolymathOnlinePath() && !isPolymathCsPath() && !isPolymathOfficePath();'));
  // Installing ours first, then another narrow patch on top, still reads as installed.
  const later = addOfficeRules(original).replace('!isPolymathOfficePath();', '!isPolymathOfficePath() && !isLaterPath();');
  assert.equal(addOfficeRules(later), later);
});

test('installing twice changes nothing', () => {
  for (const source of [original, withEnquiry, live]) {
    const once = addOfficeRules(source);
    assert.equal(addOfficeRules(once), once);
  }
});

test('unrecognised, partial and duplicate rules fail closed', () => {
  const installed = addOfficeRules(original);
  for (const value of [null, '', 'service cloud.storage {}',
    original.replace('!isLiveServerPath()', 'true'),
    original.replace("'cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'", "'other'"),
    original.replace('// BEGIN permanent', '// BEGIN polymath-office-v1\n    // BEGIN permanent'),
    original.replace('function isLiveServerPath', 'function isOfficeAdmin() { return true; }\n    function isLiveServerPath'),
    original.replace('// BEGIN permanent', 'match /officeFamilies/{x} { allow read: if true; }\n    // BEGIN permanent'),
    original.replace('match /{document=**} {', 'match /{document=**} {\n    }\n    match /{other=**} {'),
    installed.replace(OFFICE_RULE, () => OFFICE_RULE + OFFICE_RULE),
    installed.replace(PREDICATE, '')])
    assert.throws(() => addOfficeRules(value), String(value).slice(0, 80));
});

test('the rule names exactly the three admins, the six collections and the mail prefix', () => {
  assert.deepEqual(OFFICE_ADMINS, ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'elsielcr@gmail.com']);
  for (const email of OFFICE_ADMINS) assert.ok(OFFICE_RULE.includes(`'${email}'`));
  for (const name of OFFICE_COLLECTIONS) assert.ok(OFFICE_RULE.includes(`'${name}'`), name);
  for (const name of ['officeFamilies', 'officeInvoices', 'officePayments', 'officeStatements', 'officeSettings'])
    assert.ok(OFFICE_RULE.includes(`match /${name}/{docId} {\n      allow read, write: if isOfficeAdmin();`), name);
  assert.ok(OFFICE_RULE.includes("'^polymath-office-.*$'"));
  assert.ok(OFFICE_RULE.includes("email_verified', false) == true"));
  assert.ok(OFFICE_RULE.includes('allow get: if token.size() >= 20;'));
  assert.ok(!/allow list[^;]*if true/.test(OFFICE_RULE), 'nothing is ever listable by the public');
  const opens = s => (OFFICE_RULE.match(new RegExp('\\' + s, 'g')) || []).length;
  assert.equal(opens('{'), opens('}'));
  assert.equal(opens('('), opens(')'));
});

test('permission cases: nobody but the admins reaches a family, an invoice or a payment', () => {
  const cases = officeRuleTests();
  assert.ok(cases.length > 300);
  for (const c of cases) {
    assert.ok(['ALLOW', 'DENY'].includes(c.expectation));
    assert.ok(c.request.path.startsWith('/databases/(default)/documents/'));
    assert.ok(['get', 'list', 'create', 'update', 'delete'].includes(c.request.method));
    if (c.request.method === 'create') assert.equal(c.resource, undefined);
    if (['create', 'update'].includes(c.request.method)) assert.ok(c.request.resource.data);
  }
  const privateRoots = ['officeFamilies/', 'officeInvoices/', 'officePayments/', 'officeStatements/', 'officeSettings/'];
  const admins = ['office-test-admin', 'office-test-admin-caps', 'office-test-admin-three'];
  for (const root of privateRoots) {
    const forRoot = cases.filter(c => c.request.path.includes('/documents/' + root));
    assert.ok(forRoot.length > 20, root);
    assert.ok(forRoot.filter(c => !admins.includes(c.request.auth?.uid)).every(c => c.expectation === 'DENY'), root + ' is admin-only');
  }
  // Signed out: only a parent's own invoice link, by its full token.
  const signedOut = cases.filter(c => c.request.auth === null && c.expectation === 'ALLOW');
  assert.ok(signedOut.length >= 1);
  assert.ok(signedOut.every(c => /\/officeLinks\/[A-Za-z0-9]{24}$/.test(c.request.path) && c.request.method === 'get'));
  // An unverified address that LOOKS like the admin's is nobody.
  assert.ok(cases.filter(c => c.request.auth?.uid === 'office-test-unverified').every(c => c.expectation === 'DENY' || /officeLinks\/[A-Za-z0-9]{24}$/.test(c.request.path)));
  assert.ok(cases.some(c => c.request.path.includes('mail/polymath-office-') && c.expectation === 'ALLOW' && c.request.method === 'create'));
  assert.ok(cases.some(c => c.request.path.includes('mail/polymath-office-') && c.expectation === 'DENY' && c.request.method === 'update' && admins.includes(c.request.auth?.uid)), 'nobody rewrites a queued email');
});

test('preserved cases keep the unrelated paths open and carry every installed protection', () => {
  const plain = officePreservedTests(original), full = officePreservedTests(live);
  const allowed = (cases, path) => cases.some(c => c.request.path.endsWith('/documents/' + path) && c.expectation === 'ALLOW');
  for (const path of ['studentProfiles/probe', 'pdfAnnotator/probe', 'mail/unrelated-existing-mail', 'users/probe/officeFamilies/item', 'schedule_config/main', 'office/probe'])
    assert.ok(allowed(plain, path) && allowed(full, path), path);
  assert.ok(plain.some(c => c.request.path.endsWith('/documents/mail') && c.request.method === 'list' && c.expectation === 'ALLOW'));
  assert.ok(!full.some(c => c.request.path.endsWith('/documents/mail') && c.request.method === 'list' && c.expectation === 'ALLOW'));
  assert.ok(full.some(c => c.request.path.includes('polymathEnquiryRequests')));
  assert.ok(full.some(c => c.request.path.includes('onlineInvites')));
  assert.ok(full.some(c => c.request.path.includes('csLeads')));
});

function fakeApi({ content = live, changeDuringValidation = false, failPermissions = false } = {}) {
  const log = { writes: [], tests: 0, published: null, reads: 0 };
  const request = async (path, options = {}) => {
    if (path.endsWith('releases/cloud.firestore')) {
      if (options.method === 'PATCH') { log.published = options.body.release.rulesetName; return {}; }
      log.reads++;
      if (log.published) return { rulesetName: log.published, updateTime: 'later' };
      const changed = changeDuringValidation && log.reads > 1;
      return { rulesetName: 'projects/mathgen--app/rulesets/' + (changed ? 'changed' : 'current'), updateTime: changed ? '2' : '1' };
    }
    if (path.endsWith(':test')) {
      log.tests += options.body.testSuite.testCases.length;
      return { testResults: options.body.testSuite.testCases.map(() => ({ state: failPermissions ? 'FAILURE' : 'SUCCESS' })) };
    }
    if (options.method === 'POST') { log.writes.push(options.body.source.files[0].content); return { name: 'projects/mathgen--app/rulesets/candidate' }; }
    return { source: { files: [{ name: 'firestore.rules', content }] } };
  };
  return { request, log };
}

test('read mode only reads', async () => {
  const { request, log } = fakeApi();
  assert.equal((await publishOfficeRules({ request, readOnly: true })).changeNeeded, true);
  assert.equal(log.tests, 0); assert.equal(log.writes.length, 0); assert.equal(log.published, null);
  const installed = fakeApi({ content: addOfficeRules(live) });
  assert.equal((await publishOfficeRules({ request: installed.request, readOnly: true })).changeNeeded, false);
});

test('test mode validates every case and publishes nothing', async () => {
  const { request, log } = fakeApi();
  const result = await publishOfficeRules({ request });
  assert.equal(result.mode, 'test'); assert.equal(result.changeNeeded, true);
  assert.ok(log.tests > result.validated, 'today\'s rules were checked too');
  assert.equal(log.writes.length, 0); assert.equal(log.published, null);
});

test('apply mode publishes the patched rules once every case passes', async () => {
  const { request, log } = fakeApi();
  const result = await publishOfficeRules({ request, deploy: true });
  assert.equal(result.changed, true);
  assert.equal(log.published, 'projects/mathgen--app/rulesets/candidate');
  assert.equal(log.writes[0], addOfficeRules(live));
});

test('failed permission cases or concurrent changes publish nothing', async () => {
  const failing = fakeApi({ failPermissions: true });
  await assert.rejects(publishOfficeRules({ request: failing.request, deploy: true }), /Rules tests failed/);
  assert.equal(failing.log.published, null);
  const racing = fakeApi({ changeDuringValidation: true });
  await assert.rejects(publishOfficeRules({ request: racing.request, deploy: true }), /changed during validation/);
  assert.equal(racing.log.published, null);
});
