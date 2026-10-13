// Offline checks for tools/online-rules.mjs: the patch is narrow, idempotent
// and refuses rules it does not recognise; the publisher never writes in read
// or test mode and never publishes over rules that changed underneath it.
// The permission expectations themselves run against Google's Rules API in
// .github/workflows/online-rules.yml before anything is published.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addOnlineRules, ONLINE_RULE, onlineRuleTests, onlinePreservedTests, publishOnlineRules, setupCredentials } from './online-rules.mjs';
import { addEnquiryRules } from './enquiry-rules.mjs';

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
const PREDICATE = ' && !isPolymathOnlinePath()';

test('the patch adds one block and one predicate, on either shape of the catch-all', () => {
  for (const source of [original, withEnquiry]) {
    const updated = addOnlineRules(source);
    assert.notEqual(updated, source);
    assert.equal(updated.replace(ONLINE_RULE, '').replace(PREDICATE + ';', ';'), source);
    assert.equal((updated.match(/BEGIN polymath-online-v1/g) || []).length, 1);
    assert.match(updated, /&& !isPolymathOnlinePath\(\);\n    \}/);
    // The block sits inside the documents match, before the history block.
    assert.ok(updated.indexOf(ONLINE_RULE) < updated.indexOf('// BEGIN permanent-student-question-history-v1'));
    assert.ok(updated.indexOf(ONLINE_RULE) > updated.indexOf('match /databases/{database}/documents'));
  }
});

test('installing twice changes nothing', () => {
  for (const source of [original, withEnquiry]) {
    const once = addOnlineRules(source);
    assert.equal(addOnlineRules(once), once);
  }
});

test('the enquiry protection can still be installed after this one', () => {
  // The enquiry tool looks for the catch-all without our predicate, so it
  // refuses rather than guessing; the order on the live project is enquiry first.
  assert.throws(() => addEnquiryRules(addOnlineRules(original)));
  assert.equal(addOnlineRules(withEnquiry).includes('isPolymathEnquiryServerPath()' + PREDICATE + ';'), true);
});

test('unrecognised, partial and duplicate rules fail closed', () => {
  const installed = addOnlineRules(original);
  for (const value of [null, '', 'service cloud.storage {}',
    original.replace('!isLiveServerPath()', 'true'),
    original.replace("'cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'", "'other'"),
    original.replace('// BEGIN permanent', '// BEGIN polymath-online-v1\n    // BEGIN permanent'),
    original.replace('function isLiveServerPath', 'function isOnlineAdmin() { return true; }\n    function isLiveServerPath'),
    original.replace('    // BEGIN permanent-student-question-history-v1\n', ''),
    original.replace('match /{document=**} {', 'match /{document=**} {\n    }\n    match /{other=**} {'),
    installed.replace(ONLINE_RULE, () => ONLINE_RULE + ONLINE_RULE),
    installed.replace(PREDICATE, '')])
    assert.throws(() => addOnlineRules(value), String(value).slice(0, 80));
});

test('the rule names exactly the three admins, the four collections and the mail prefix', () => {
  for (const email of ['chungzhikai@gmail.com', 'elsielcr@gmail.com', 'admin@polymathlc.com.sg']) assert.ok(ONLINE_RULE.includes(`'${email}'`));
  for (const name of ['onlineCourses', 'onlineInvites', 'onlineMembers', 'onlineSettings']) assert.ok(ONLINE_RULE.includes(`'${name}'`));
  assert.ok(ONLINE_RULE.includes("'^polymath-online-.*$'"));
  assert.ok(ONLINE_RULE.includes("email_verified', false) == true"));
  // Every brace and parenthesis in the block is balanced.
  const opens = s => (ONLINE_RULE.match(new RegExp('\\' + s, 'g')) || []).length;
  assert.equal(opens('{'), opens('}'));
  assert.equal(opens('('), opens(')'));
});

test('permission cases are well formed and cover every collection for every kind of visitor', () => {
  const cases = onlineRuleTests();
  assert.ok(cases.length > 100);
  for (const c of cases) {
    assert.ok(['ALLOW', 'DENY'].includes(c.expectation));
    assert.ok(c.request.path.startsWith('/databases/(default)/documents/'));
    assert.ok(['get', 'list', 'create', 'update', 'delete'].includes(c.request.method));
    if (c.request.method === 'create') assert.equal(c.resource, undefined);
    if (['create', 'update'].includes(c.request.method)) assert.ok(c.request.resource.data);
  }
  const seen = key => cases.some(c => c.request.path.includes(key));
  for (const key of ['onlineCourses/', 'onlineInvites/', 'onlineMembers/', 'onlineSettings/', 'mail/polymath-online-']) assert.ok(seen(key), key);
  // Signed-out visitors are denied everything.
  assert.ok(cases.filter(c => c.request.auth === null).every(c => c.expectation === 'DENY'));
  // Students can never write a class.
  assert.ok(cases.filter(c => c.request.path.includes('onlineCourses/') && c.request.auth?.uid === 'online-test-student' && c.request.method !== 'get' && c.request.method !== 'list')
    .every(c => c.expectation === 'DENY'));
});

test('preserved cases keep the unrelated paths open and add the enquiry cases when present', () => {
  const plain = onlinePreservedTests(original), enquiry = onlinePreservedTests(withEnquiry);
  const allowed = (cases, path) => cases.some(c => c.request.path.endsWith('/documents/' + path) && c.expectation === 'ALLOW');
  for (const path of ['studentProfiles/probe', 'pdfAnnotator/probe', 'mail/unrelated-existing-mail', 'users/probe/onlineCourses/item'])
    assert.ok(allowed(plain, path) && allowed(enquiry, path), path);
  assert.ok(plain.some(c => c.request.path.endsWith('/documents/mail') && c.request.method === 'list' && c.expectation === 'ALLOW'));
  assert.ok(!enquiry.some(c => c.request.path.endsWith('/documents/mail') && c.request.method === 'list' && c.expectation === 'ALLOW'));
  assert.ok(enquiry.some(c => c.request.path.includes('polymathEnquiryRequests')));
});

function fakeApi({ content = withEnquiry, changeDuringValidation = false, failPermissions = false } = {}) {
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
  const result = await publishOnlineRules({ request, readOnly: true });
  assert.equal(result.changeNeeded, true);
  assert.equal(log.tests, 0); assert.equal(log.writes.length, 0); assert.equal(log.published, null);
  const installed = fakeApi({ content: addOnlineRules(withEnquiry) });
  assert.equal((await publishOnlineRules({ request: installed.request, readOnly: true })).changeNeeded, false);
});

test('test mode validates every case and publishes nothing', async () => {
  const { request, log } = fakeApi();
  const result = await publishOnlineRules({ request });
  assert.equal(result.mode, 'test'); assert.equal(result.changeNeeded, true);
  assert.ok(log.tests > result.validated); // today's rules were checked too
  assert.equal(log.writes.length, 0); assert.equal(log.published, null);
});

test('apply mode publishes the patched rules once every case passes', async () => {
  const { request, log } = fakeApi();
  const result = await publishOnlineRules({ request, deploy: true });
  assert.equal(result.changed, true);
  assert.equal(log.published, 'projects/mathgen--app/rulesets/candidate');
  assert.equal(log.writes[0], addOnlineRules(withEnquiry));
});

test('failed permission cases or concurrent changes publish nothing', async () => {
  const failing = fakeApi({ failPermissions: true });
  await assert.rejects(publishOnlineRules({ request: failing.request, deploy: true }), /Rules tests failed/);
  assert.equal(failing.log.published, null);
  const racing = fakeApi({ changeDuringValidation: true });
  await assert.rejects(publishOnlineRules({ request: racing.request, deploy: true }), /changed during validation/);
  assert.equal(racing.log.published, null);
});

test('credentials setup accepts raw or base64 JSON and never echoes it', () => {
  const key = { type: 'service_account', client_email: 'x@y.iam.gserviceaccount.com', private_key: 'secret', project_id: 'mathgen--app' };
  for (const value of [JSON.stringify(key), Buffer.from(JSON.stringify(key)).toString('base64')]) {
    const files = {}, env = {};
    const keyFile = setupCredentials({ env: { FIREBASE_SERVICE_ACCOUNT: value, RUNNER_TEMP: '/tmp/r', GITHUB_ENV: '/tmp/env' },
      write: (path, text) => { files[path] = text; }, append: (path, text) => { env[path] = text; } });
    assert.equal(keyFile, '/tmp/r/firebase-sa.json');
    assert.deepEqual(JSON.parse(files[keyFile]), key);
    assert.equal(env['/tmp/env'], 'GOOGLE_APPLICATION_CREDENTIALS=/tmp/r/firebase-sa.json\n');
  }
  for (const value of ['', 'nope', JSON.stringify({ a: 1 })])
    assert.throws(() => setupCredentials({ env: { FIREBASE_SERVICE_ACCOUNT: value, RUNNER_TEMP: '/t', GITHUB_ENV: '/e' }, write() {}, append() {} }),
      error => !String(error.message).includes('secret"') && !String(error.message).includes(value || '\u0000'));
});
