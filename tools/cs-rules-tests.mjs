// Offline checks for tools/cs-rules.mjs: the patch is narrow, idempotent,
// lives happily beside the enquiry and Polymath Online protections, refuses
// rules it does not recognise, and the publisher never writes in read or test
// mode and never publishes over rules that changed underneath it. The
// permission expectations themselves run against Google's Rules API in
// .github/workflows/cs-rules.yml before anything is published.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addCsRules, CS_RULE, CS_COLLECTIONS, csRuleTests, csPreservedTests, publishCsRules } from './cs-rules.mjs';
import { addEnquiryRules } from './enquiry-rules.mjs';
import { addOnlineRules } from './online-rules.mjs';

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
const withEnquiry = addEnquiryRules(original);
const withBoth = addOnlineRules(withEnquiry);
const PREDICATE = ' && !isPolymathCsPath()';

test('the patch adds one block and one predicate, whatever is already on the catch-all', () => {
  for (const source of [original, withEnquiry, withBoth]) {
    const updated = addCsRules(source);
    assert.notEqual(updated, source);
    assert.equal(updated.replace(CS_RULE, '').replace(PREDICATE + ';', ';'), source);
    assert.equal((updated.match(/BEGIN polymath-cs-server-only-v1/g) || []).length, 1);
    assert.match(updated, /&& !isPolymathCsPath\(\);\n    \}/);
    assert.ok(updated.includes(CS_RULE + '    match /{document=**} {'), 'right above the catch-all');
    assert.ok(updated.indexOf(CS_RULE) > updated.indexOf('match /databases/{database}/documents'));
  }
});

test('installing twice changes nothing, and a later app\'s predicate does not confuse it', () => {
  for (const source of [original, withEnquiry, withBoth]) {
    const once = addCsRules(source);
    assert.equal(addCsRules(once), once);
    const later = once.replace('!isPolymathCsPath();', '!isPolymathCsPath() && !isLaterPath();');
    assert.equal(addCsRules(later), later);
  }
});

test('Polymath Online can still be installed after this one, and it after Online', () => {
  const csFirst = addCsRules(withEnquiry);
  const thenOnline = addOnlineRules(csFirst);
  assert.ok(thenOnline.includes('!isPolymathCsPath() && !isPolymathOnlinePath();'));
  assert.equal(addCsRules(thenOnline), thenOnline, 'still reads as installed');
  const onlineFirst = addCsRules(withBoth);
  assert.ok(onlineFirst.includes('!isPolymathOnlinePath() && !isPolymathCsPath();'));
  assert.equal(addOnlineRules(onlineFirst), onlineFirst, 'Online still reads as installed');
});

test('unrecognised, partial, duplicate and clashing rules fail closed', () => {
  const installed = addCsRules(withEnquiry);
  for (const value of [null, '', 'service cloud.storage {}',
    original.replace('!isLiveServerPath()', 'true'),
    original.replace("'cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'", "'other'"),
    original.replace('// BEGIN permanent', '// BEGIN polymath-cs-server-only-v1\n    // BEGIN permanent'),
    original.replace('match /{document=**} {', 'match /{document=**} {\n    }\n    match /{other=**} {'),
    original.replace('// BEGIN permanent', "match /csLeads/{id} { allow read: if true; }\n    // BEGIN permanent"),
    installed.replace(CS_RULE, () => CS_RULE + CS_RULE),
    installed.replace(PREDICATE, '')])
    assert.throws(() => addCsRules(value), String(value).slice(0, 80));
});

test('the block names exactly the five server-only collections and balances', () => {
  assert.deepEqual(CS_COLLECTIONS, ['csFiles', 'csLeads', 'csLimits', 'csGrants', 'csSettings']);
  for (const name of CS_COLLECTIONS) assert.ok(CS_RULE.includes(`'${name}'`), name);
  const n = s => (CS_RULE.match(new RegExp('\\' + s, 'g')) || []).length;
  assert.equal(n('{'), n('}'));
  assert.equal(n('('), n(')'));
  assert.equal(n('['), n(']'));
});

test('every browser is refused every /cs path — the admin included', () => {
  const cases = csRuleTests();
  assert.ok(cases.length >= 300);
  assert.ok(cases.every(c => c.expectation === 'DENY'));
  for (const name of CS_COLLECTIONS) {
    for (const method of ['get', 'list', 'create', 'update', 'delete'])
      assert.ok(cases.some(c => c.request.path.includes('/' + name) && c.request.method === method), name + ' ' + method);
    assert.ok(cases.some(c => c.request.path.includes('/' + name) && c.request.auth?.token?.email === 'chungzhikai@gmail.com'));
    assert.ok(cases.some(c => c.request.path.includes('/' + name) && c.request.auth === null));
  }
  assert.ok(cases.some(c => c.request.path.endsWith('csLeads/probe/unlocks/event')), 'the download history too');
  for (const c of cases) {
    assert.ok(c.request.path.startsWith('/databases/(default)/documents/'));
    if (c.request.method === 'create') assert.equal(c.resource, undefined);
    if (['create', 'update'].includes(c.request.method)) assert.ok(c.request.resource.data);
  }
});

test('preserved cases keep neighbouring paths open and carry the other apps\' protections', () => {
  const plain = csPreservedTests(original), both = csPreservedTests(withBoth);
  const allowed = (cases, path) => cases.some(c => c.request.path.endsWith('/documents/' + path) && c.expectation === 'ALLOW');
  for (const path of ['csFilesArchive/probe', 'users/probe/csLeads/item', 'cs/probe', 'leads/probe', 'studentProfiles/probe'])
    assert.ok(allowed(plain, path) && allowed(both, path), path);
  assert.ok(!plain.some(c => c.request.path.includes('polymathEnquiryRequests')));
  assert.ok(both.some(c => c.request.path.includes('polymathEnquiryRequests')));
  assert.ok(both.some(c => c.request.path.includes('onlineCourses/')));
});

function fakeApi({ content = withBoth, changeDuringValidation = false, failPermissions = false } = {}) {
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
  assert.equal((await publishCsRules({ request, readOnly: true })).changeNeeded, true);
  assert.equal(log.tests, 0); assert.equal(log.writes.length, 0); assert.equal(log.published, null);
  const installed = fakeApi({ content: addCsRules(withBoth) });
  assert.equal((await publishCsRules({ request: installed.request, readOnly: true })).changeNeeded, false);
});

test('test mode validates every case, today\'s rules included, and publishes nothing', async () => {
  const { request, log } = fakeApi();
  const result = await publishCsRules({ request });
  assert.equal(result.mode, 'test'); assert.equal(result.changeNeeded, true);
  assert.ok(log.tests > result.validated);
  assert.equal(log.writes.length, 0); assert.equal(log.published, null);
});

test('apply mode publishes the patched rules once every case passes', async () => {
  const { request, log } = fakeApi();
  const result = await publishCsRules({ request, deploy: true });
  assert.equal(result.changed, true);
  assert.equal(log.published, 'projects/mathgen--app/rulesets/candidate');
  assert.equal(log.writes[0], addCsRules(withBoth));
  // Already installed: apply is a no-op.
  const again = fakeApi({ content: addCsRules(withBoth) });
  const second = await publishCsRules({ request: again.request, deploy: true });
  assert.equal(second.changed, false);
  assert.equal(again.log.published, null);
});

test('failed permission cases or concurrent changes publish nothing', async () => {
  const failing = fakeApi({ failPermissions: true });
  await assert.rejects(publishCsRules({ request: failing.request, deploy: true }), /Rules tests failed/);
  assert.equal(failing.log.published, null);
  const racing = fakeApi({ changeDuringValidation: true });
  await assert.rejects(publishCsRules({ request: racing.request, deploy: true }), /changed during validation/);
  assert.equal(racing.log.published, null);
  await assert.rejects(publishCsRules({ request: fakeApi().request, deploy: true, readOnly: true }), /exclusive/);
});

test('the Storage check only reads, and says plainly whether the form can be gone round', async () => {
  const { storageExposure, storageCases } = await import('./cs-rules.mjs');
  const cases = storageCases();
  assert.deepEqual(cases.map(c => c.key), ['strangerCanRead', 'strangerCanList', 'signedInCanRead', 'adminCanUpload', 'previewsReadable']);
  for (const c of cases) assert.match(c.test.request.path, /^\/b\/mathgen--app\.firebasestorage\.app\/o\/cs-(files|previews)\//);
  const calls = [];
  const fake = states => async (path, options = {}) => {
    calls.push((options.method || 'GET') + ' ' + path);
    if (path.includes('releases/firebase.storage')) return { rulesetName: 'projects/mathgen--app/rulesets/storage1' };
    if (path.endsWith(':test')) return { testResults: states.map(state => ({ state })) };
    return { source: { files: [{ name: 'storage.rules', content: 'service firebase.storage {}' }] } };
  };
  const open = await storageExposure({ request: fake(['SUCCESS', 'SUCCESS', 'SUCCESS', 'SUCCESS', 'SUCCESS']) });
  assert.equal(open.gateCanBeBypassed, true);
  assert.equal(open.adminCanUpload, true);
  const shut = await storageExposure({ request: fake(['FAILURE', 'FAILURE', 'FAILURE', 'SUCCESS', 'SUCCESS']) });
  assert.equal(shut.gateCanBeBypassed, false);
  assert.ok(calls.every(c => c.startsWith('GET ') || c.endsWith(':test')), 'nothing but reads and a dry-run test');
});
