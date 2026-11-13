// Offline checks for the student access approval:
//   • tools/student-access-rules.mjs — the Firestore patch is narrow, idempotent,
//     composes with every other app's protection and refuses rules it does not
//     recognise; the publisher never writes in read or test mode.
//   • student/access-gate.js — the enrolment pop-up's logic (who is asked, what
//     the form accepts, the record and the email it writes) agrees with the rules.
//   • student/student-account.js — the admin dashboard's helpers.
//   • every Science-repo page a student opens loads the gate.
// The permission expectations themselves run against Google's Rules API in
// .github/workflows/student-access.yml before anything is published.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  addStudentAccessRules, accessRuleFor, ACCESS_RULE, ACCESS_ADMINS, ACCESS_MAIL, FORM_FIELDS, MAX_CHILDREN, PREDICATE,
  accessRuleTests, accessPreservedTests, publishStudentAccessRules, sampleForm, sampleMail
} from './student-access-rules.mjs';
import { addEnquiryRules } from './enquiry-rules.mjs';
import { addOnlineRules } from './online-rules.mjs';
import { addCsRules } from './cs-rules.mjs';
import { addOfficeRules } from './office-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE_SOURCE = fs.readFileSync(path.join(root, 'student', 'access-gate.js'), 'utf8');
const ACCOUNT_SOURCE = fs.readFileSync(path.join(root, 'student', 'student-account.js'), 'utf8');
const DASHBOARD = fs.readFileSync(path.join(root, 'student', 'index.html'), 'utf8');

/** Run access-gate.js in a sandbox with no DOM and no fetch: only the pure core is built. */
function loadGate() {
  const sandbox = { setTimeout() {}, clearTimeout() {} };
  sandbox.window = sandbox;
  vm.runInNewContext(GATE_SOURCE, sandbox);
  return sandbox.PolymathAccess;
}
function loadAccount() {
  const sandbox = { setTimeout() {}, clearTimeout() {}, Date };
  sandbox.window = sandbox;
  vm.runInNewContext(ACCOUNT_SOURCE, sandbox);
  return sandbox.MyPolymathAccount;
}

/* ───────────────────────────── the rules patch ───────────────────────────── */

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
// The live project has the enquiry, Online, /cs and Office protections already, in that order.
const withEnquiry = addEnquiryRules(original);
const live = addOfficeRules(addCsRules(addOnlineRules(withEnquiry)));

test('the patch adds one block and one predicate, on every shape of the catch-all', () => {
  for (const source of [original, withEnquiry, live]) {
    const updated = addStudentAccessRules(source);
    assert.notEqual(updated, source);
    assert.equal(updated.replace(ACCESS_RULE, '').replace(PREDICATE + ';', ';'), source);
    assert.equal((updated.match(/BEGIN polymath-student-access-v1/g) || []).length, 1);
    assert.match(updated, /&& !isPolymathStudentAccessPath\(\);\n    \}/);
    assert.ok(updated.includes(ACCESS_RULE + '    match /{document=**} {'), 'right above the catch-all');
    assert.ok(updated.indexOf(ACCESS_RULE) > updated.indexOf('match /databases/{database}/documents'));
  }
});

test('the other apps\' protections stay exactly as they were, and theirs still install on top of ours', () => {
  const updated = addStudentAccessRules(live);
  for (const marker of ['polymath-enquiry-server-only-v1', 'polymath-online-v1', 'polymath-cs-server-only-v1', 'polymath-office-v1'])
    assert.equal((updated.match(new RegExp('BEGIN ' + marker, 'g')) || []).length, 1, marker);
  assert.ok(updated.includes('!isPolymathOnlinePath() && !isPolymathCsPath() && !isPolymathOfficePath() && !isPolymathStudentAccessPath();'));
  // The Office patch still reads its own block as installed with ours after it.
  assert.equal(addOfficeRules(updated), updated);
  // Ours first, then another narrow patch on top: still installed.
  const later = addStudentAccessRules(original).replace('!isPolymathStudentAccessPath();', '!isPolymathStudentAccessPath() && !isLaterPath();');
  assert.equal(addStudentAccessRules(later), later);
});

test('installing twice changes nothing', () => {
  for (const source of [original, withEnquiry, live]) {
    const once = addStudentAccessRules(source);
    assert.equal(addStudentAccessRules(once), once);
  }
});

test('unrecognised, partial, duplicate or tampered rules fail closed', () => {
  const installed = addStudentAccessRules(original);
  for (const value of [null, '', 'service cloud.storage {}',
    original.replace('!isLiveServerPath()', 'true'),
    original.replace("'cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'", "'other'"),
    original.replace('// BEGIN permanent', '// BEGIN polymath-student-access-v1\n    // BEGIN permanent'),
    original.replace('function isLiveServerPath', 'function isStudentAccessAdmin() { return true; }\n    function isLiveServerPath'),
    original.replace('// BEGIN permanent', 'match /studentAccess/{x} { allow read: if true; }\n    // BEGIN permanent'),
    original.replace('match /{document=**} {', 'match /{document=**} {\n    }\n    match /{other=**} {'),
    installed.replace(ACCESS_RULE, () => ACCESS_RULE + ACCESS_RULE),
    installed.replace(ACCESS_RULE, () => accessRuleFor(['someone@example.com'])),
    installed.replace(PREDICATE, '')])
    assert.throws(() => addStudentAccessRules(value), String(value).slice(0, 80));
});

test('the rule names exactly the three admins, the collection, the form fields and the one email', () => {
  assert.deepEqual(ACCESS_ADMINS, ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg']);
  for (const email of ACCESS_ADMINS) assert.ok(ACCESS_RULE.includes(`'${email}'`), email);
  assert.ok(!ACCESS_RULE.includes('elsielcr@gmail.com'), 'only the three named admins approve');
  assert.ok(ACCESS_RULE.includes('match /studentAccess/{uid} {'));
  assert.ok(ACCESS_RULE.includes("request.resource.data.status == 'pending'"), 'a student can only ever ask');
  assert.ok(ACCESS_RULE.includes("email_verified', false) == true"));
  for (const field of FORM_FIELDS) assert.ok(ACCESS_RULE.includes(`'${field}'`), field);
  assert.ok(ACCESS_RULE.includes(`childCount <= ${MAX_CHILDREN}`));
  assert.ok(ACCESS_RULE.includes("'^polymath-access-' + request.auth.uid + '-[1-9]$'"));
  assert.ok(ACCESS_RULE.includes(`request.resource.data.to == ['admin@polymathlc.com.sg']`));
  assert.ok(ACCESS_RULE.includes(`request.resource.data.cc == ['support@polymathlc.com.sg']`));
  assert.ok(!/allow (read|list)[^;]*if true/.test(ACCESS_RULE), 'nothing is ever readable by the public');
  const opens = s => (ACCESS_RULE.match(new RegExp('\\' + s, 'g')) || []).length;
  assert.equal(opens('{'), opens('}'));
  assert.equal(opens('('), opens(')'));
  assert.equal(opens('['), opens(']'));
});

test('permission cases: a student only ever reads their own record and asks; only the three admins approve', () => {
  const cases = accessRuleTests();
  assert.ok(cases.length > 80);
  for (const c of cases) {
    assert.ok(['ALLOW', 'DENY'].includes(c.expectation), JSON.stringify(c).slice(0, 120));
    assert.ok(c.request.path.startsWith('/databases/(default)/documents/'));
    assert.ok(['get', 'list', 'create', 'update', 'delete'].includes(c.request.method));
    if (c.request.method === 'create') assert.equal(c.resource, undefined);
    if (['create', 'update'].includes(c.request.method)) assert.ok(c.request.resource.data);
  }
  const admins = ['access-test-admin', 'access-test-admin-caps', 'access-test-admin-support'];
  // Nobody but an admin ever writes "approved".
  for (const c of cases.filter(c => ['create', 'update'].includes(c.request.method) && c.expectation === 'ALLOW' && c.request.path.includes('/studentAccess/')))
    if (c.request.resource.data.status !== 'pending') assert.ok(admins.includes(c.request.auth?.uid), JSON.stringify(c.request).slice(0, 160));
  // Signed out: nothing at all.
  assert.ok(cases.filter(c => c.request.auth === null).every(c => c.expectation === 'DENY'));
  // Listing is admin-only.
  assert.ok(cases.filter(c => c.request.method === 'list' && c.expectation === 'ALLOW').every(c => admins.includes(c.request.auth?.uid)));
  // The office's fourth admin (and an unverified look-alike) cannot approve.
  for (const uid of ['access-test-office-only', 'access-test-unverified'])
    assert.ok(cases.filter(c => c.request.auth?.uid === uid).every(c => c.expectation === 'DENY'), uid);
  // The sample form is exactly the fields the rule allows.
  assert.deepEqual(Object.keys(sampleForm('x')).sort(), [...FORM_FIELDS].sort());
});

test('preserved cases keep the unrelated paths open and carry every installed protection', () => {
  const plain = accessPreservedTests(original), full = accessPreservedTests(live);
  const allowed = (cases, p) => cases.some(c => c.request.path.endsWith('/documents/' + p) && c.expectation === 'ALLOW');
  for (const p of ['studentProfiles/probe', 'pdfAnnotator/probe', 'mail/unrelated-existing-mail', 'users/probe/studentAccess/item', 'studentAccessArchive/probe', 'schedule_config/main'])
    assert.ok(allowed(plain, p) && allowed(full, p), p);
  assert.ok(full.some(c => c.request.path.includes('polymathEnquiryRequests')));
  assert.ok(full.some(c => c.request.path.includes('onlineInvites')));
  assert.ok(full.some(c => c.request.path.includes('officeFamilies')), 'the Office protection is re-tested too');
});

/* ───────────────────────────── the publisher ───────────────────────────── */

function fakeRules(content, { changeDuringValidation = false } = {}) {
  const calls = [];
  let release = { rulesetName: 'projects/mathgen--app/rulesets/current', updateTime: '1' };
  const request = async (p, options = {}) => {
    calls.push({ path: p, method: options.method || 'GET' });
    if (p === 'projects/mathgen--app/releases/cloud.firestore' && !options.method) {
      const answer = { ...release };
      if (changeDuringValidation && calls.filter(c => c.path === p).length === 2) answer.updateTime = '2';
      return answer;
    }
    if (p === 'projects/mathgen--app/rulesets/current') return { source: { files: [{ name: 'firestore.rules', content }] } };
    if (p === 'projects/mathgen--app:test') return { testResults: options.body.testSuite.testCases.map(() => ({ state: 'SUCCESS' })) };
    if (p === 'projects/mathgen--app/rulesets' && options.method === 'POST') return { name: 'projects/mathgen--app/rulesets/candidate' };
    if (options.method === 'PATCH') { release = { rulesetName: options.body.release.rulesetName, updateTime: '3' }; return release; }
    throw new Error('unexpected ' + p);
  };
  return { request, calls };
}

test('the publisher reads, tests or publishes — and only publishes when asked', async () => {
  const read = fakeRules(live);
  const answer = await publishStudentAccessRules({ request: read.request, readOnly: true });
  assert.equal(answer.changeNeeded, true);
  assert.ok(read.calls.every(c => c.method === 'GET'));

  const dry = fakeRules(live);
  const tested = await publishStudentAccessRules({ request: dry.request });
  assert.equal(tested.changed, false);
  assert.equal(tested.changeNeeded, true);
  assert.ok(!dry.calls.some(c => c.method === 'PATCH' || (c.method === 'POST' && c.path.endsWith('/rulesets'))), 'test mode never writes');

  const real = fakeRules(live);
  const published = await publishStudentAccessRules({ request: real.request, deploy: true });
  assert.equal(published.changed, true);
  assert.equal(published.ruleset, 'projects/mathgen--app/rulesets/candidate');

  const already = fakeRules(addStudentAccessRules(live));
  const again = await publishStudentAccessRules({ request: already.request, deploy: true });
  assert.equal(again.changed, false);
  assert.ok(!already.calls.some(c => c.method === 'PATCH'));

  const racing = fakeRules(live, { changeDuringValidation: true });
  await assert.rejects(publishStudentAccessRules({ request: racing.request, deploy: true }), /changed during validation/);
  await assert.rejects(publishStudentAccessRules({ request: real.request, deploy: true, readOnly: true }), /exclusive/);
});

/* ───────────────────────────── the gate's logic ───────────────────────────── */

test('the gate, the dashboard and the rules name the same three admins and the same email', () => {
  const gate = loadGate();
  assert.equal(gate.version, '1.0.0');
  assert.deepEqual([...gate.core.ACCESS_ADMINS], ACCESS_ADMINS);
  assert.deepEqual(JSON.parse(JSON.stringify(gate.core.ACCESS_MAIL)), ACCESS_MAIL);
  assert.equal(gate.core.MAX_CHILDREN, MAX_CHILDREN);
  const account = loadAccount();
  assert.deepEqual([...account.helpers.ACCESS_ADMINS], ACCESS_ADMINS);
  for (const admin of ACCESS_ADMINS) assert.ok(gate.core.STAFF.includes(admin), admin + ' is never locked out');
});

test('who is asked: every real account except verified staff; never a guest or nobody', () => {
  const { needsGate, isStaff, isAccessAdmin } = loadGate().core;
  assert.equal(needsGate(null), false, 'signed out: the app shows its own sign-in');
  assert.equal(needsGate({ uid: 'a', isAnonymous: true }), false, 'share-link / QR guests are not students');
  assert.equal(needsGate({ uid: 'a', email: 'kid@gmail.com', emailVerified: true }), true);
  assert.equal(needsGate({ uid: 'a', email: 'tan.wei@students.sciencequest.app', emailVerified: false }), true, 'centre usernames too');
  for (const email of ['chungzhikai@gmail.com', 'Admin@PolymathLC.com.sg', 'support@polymathlc.com.sg', 'elsielcr@gmail.com', 'abigail.yew@stanfordmanpower.com', 'pkeertana21@gmail.com'])
    assert.equal(needsGate({ uid: 'a', email, emailVerified: true }), false, email + ' is staff');
  assert.equal(needsGate({ uid: 'a', email: 'chungzhikai@gmail.com', emailVerified: false }), true, 'an unverified look-alike is asked');
  assert.equal(isStaff('elsielcr@gmail.com', true), true);
  assert.equal(isAccessAdmin('elsielcr@gmail.com', true), false, 'staff, but does not approve');
  assert.equal(isAccessAdmin('ADMIN@polymathlc.com.sg', true), true);
});

const user = { uid: 'uid123', email: 'Kid@Gmail.com', emailVerified: true };
const good = {
  enrolled: true, parentName: '  Mdm   Tan  Siew Ling ', parentEmail: 'Tan.SL@Gmail.com', childCount: '2',
  children: [{ name: 'Tan Wei Ming', level: 'P5', subjects: 'both' }, { name: 'Tan Wei Ling', level: 'P3', subjects: 'math' }, { name: 'extra', level: 'P1', subjects: 'science' }]
};

test('the form: a complete answer becomes exactly the record the rules accept', () => {
  const { validateForm } = loadGate().core;
  const now = new Date('2026-11-13T10:00:00Z');
  const result = validateForm(good, user, { app: 'math', now, previousSubmissions: 0 });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const r = result.record;
  assert.deepEqual(Object.keys(r).sort(), [...FORM_FIELDS].sort(), 'no field more, none fewer');
  assert.equal(r.uid, 'uid123');
  assert.equal(r.email, 'kid@gmail.com');
  assert.equal(r.status, 'pending');
  assert.equal(r.enrolled, true);
  assert.equal(r.parentName, 'Mdm Tan Siew Ling', 'spaces tidied');
  assert.equal(r.parentEmail, 'tan.sl@gmail.com');
  assert.equal(r.childCount, 2);
  assert.equal(r.children.length, 2, 'only as many children as the parent said');
  assert.deepEqual(JSON.parse(JSON.stringify(r.children)), [{ name: 'Tan Wei Ming', level: 'P5', subjects: 'both' }, { name: 'Tan Wei Ling', level: 'P3', subjects: 'math' }]);
  assert.equal(r.app, 'math');
  assert.equal(r.submissions, 1);
  assert.equal(r.submittedAt.toISOString(), now.toISOString());
  assert.equal(validateForm(good, user, { previousSubmissions: 4 }).record.submissions, 5, 'asking again counts up');
});

test('the form: every missing or wrong answer is named, and nothing is written', () => {
  const { validateForm } = loadGate().core;
  const cases = [
    [{ enrolled: false }, 'enrolled'],
    [{ parentName: 'X' }, 'parentName'],
    [{ parentEmail: 'tan at gmail' }, 'parentEmail'],
    [{ childCount: '0' }, 'childCount'],
    [{ childCount: String(MAX_CHILDREN + 1) }, 'childCount'],
    [{ children: [{ name: '', level: 'P5', subjects: 'both' }, good.children[1]] }, 'child0name'],
    [{ children: [{ name: 'Tan Wei Ming', level: 'P9', subjects: 'both' }, good.children[1]] }, 'child0level'],
    [{ children: [good.children[0], { name: 'Tan Wei Ling', level: 'P3', subjects: 'english' }] }, 'child1subjects']
  ];
  for (const [change, field] of cases) {
    const result = validateForm({ ...good, ...change }, user);
    assert.equal(result.ok, false, field);
    assert.ok(result.errors[field], field + ' is named');
    assert.equal(result.record, null);
  }
  assert.equal(validateForm({}, user).ok, false);
  assert.equal(validateForm(good, null).record, null, 'no account, no record');
});

test('the subjects are exactly Math only, Science only and Both Math and Science', () => {
  const { SUBJECTS, subjectsLabel, LEVELS } = loadGate().core;
  assert.deepEqual(JSON.parse(JSON.stringify(SUBJECTS)), [['math', 'Math only'], ['science', 'Science only'], ['both', 'Both Math and Science']]);
  assert.equal(subjectsLabel('both'), 'Both Math and Science');
  assert.ok(LEVELS.some(l => l[0] === 'P6') && LEVELS.some(l => l[0] === 'S1'));
});

test('the centre\'s email: to admin@, copied to support@, plain text, an id the rules accept', () => {
  const { validateForm, buildMail } = loadGate().core;
  const record = validateForm(good, user, { app: 'tutor' }).record;
  const mail = buildMail(record);
  assert.equal(mail.id, 'polymath-access-uid123-1');
  assert.match(mail.id, new RegExp('^polymath-access-' + user.uid + '-[1-9]$'));
  const expected = sampleMail({ replyTo: 'tan.sl@gmail.com', message: mail.data.message });
  assert.deepEqual(JSON.parse(JSON.stringify(mail.data)), JSON.parse(JSON.stringify(expected)));
  assert.deepEqual(Object.keys(mail.data.message).sort(), ['subject', 'text']);
  assert.ok(mail.data.message.subject.length <= 200 && mail.data.message.text.length <= 6000);
  assert.match(mail.data.message.text, /Tan Wei Ming — Primary 5 — Both Math and Science/);
  assert.match(mail.data.message.text, /polymathlc\.com\.sg\/student\/#admin/);
  assert.equal(buildMail({ ...record, submissions: 10 }), null, 'never a tenth email for one account');
});

test('Firestore REST values round-trip', () => {
  const { encodeFields, decodeFields } = loadGate().core;
  const record = loadGate().core.validateForm(good, user, { now: new Date('2026-11-13T10:00:00Z') }).record;
  const encoded = encodeFields(record);
  assert.equal(encoded.childCount.integerValue, '2');
  assert.equal(encoded.enrolled.booleanValue, true);
  assert.equal(encoded.submittedAt.timestampValue, '2026-11-13T10:00:00.000Z');
  assert.equal(encoded.children.arrayValue.values[0].mapValue.fields.subjects.stringValue, 'both');
  const back = decodeFields(JSON.parse(JSON.stringify(encoded)));
  assert.equal(back.childCount, 2);
  assert.equal(back.children[1].name, 'Tan Wei Ling');
  assert.equal(back.submittedAt, '2026-11-13T10:00:00.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(encodeFields({ list: [] }))), { list: { arrayValue: {} } });
});

test('a parent\'s typing never becomes markup in the pop-up', () => {
  const { escapeHtml } = loadGate().core;
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>"\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
  assert.ok(!/innerHTML\s*=\s*[^;]*\b(record|draft|child)\.(name|parentName)/.test(GATE_SOURCE));
});

test('the gate stays off until the rules are published (a signed-out read must be refused)', () => {
  assert.ok(GATE_SOURCE.includes("if (answer.status === 403 || answer.status === 401)"));
  assert.ok(GATE_SOURCE.includes("if (!isProtected) return setPhase('inactive');"));
  assert.ok(!/BLOCKING = \{[^}]*inactive/.test(GATE_SOURCE), 'inactive never blocks');
});

/* ───────────────────────────── the dashboard ───────────────────────────── */

test('dashboard helpers: usernames, sorting, search, counts and the admin edit', () => {
  const h = loadAccount().helpers;
  assert.deepEqual([...h.loginCandidates('Tan.Wei')].slice(0, 2), ['tan.wei@students.sciencequest.app', 'tan.wei.r2@students.sciencequest.app']);
  assert.deepEqual([...h.loginCandidates('kid@gmail.com')], ['kid@gmail.com']);
  assert.equal(h.accountLabel('tan.wei.r3@students.sciencequest.app'), 'username tan.wei');
  assert.equal(h.isAdmin({ email: 'support@polymathlc.com.sg', emailVerified: true }), true);
  assert.equal(h.isAdmin({ email: 'support@polymathlc.com.sg', emailVerified: false }), false);
  assert.equal(h.isAdmin({ email: 'elsielcr@gmail.com', emailVerified: true }), false);
  const list = [
    { _id: 'a', status: 'approved', submittedAt: '2026-11-10T00:00:00Z', parentName: 'A' },
    { _id: 'b', status: 'pending', submittedAt: '2026-11-11T00:00:00Z', parentName: 'B', children: [{ name: 'Lim Jia Hui', level: 'P4', subjects: 'science' }] },
    { _id: 'c', status: 'pending', submittedAt: '2026-11-12T00:00:00Z', parentName: 'C' },
    { _id: 'd', status: 'revoked', submittedAt: '2026-11-13T00:00:00Z', parentName: 'D' }
  ];
  assert.deepEqual(h.sortRecords(list).map(r => r._id), ['c', 'b', 'd', 'a'], 'waiting first, newest first');
  assert.deepEqual(JSON.parse(JSON.stringify(h.counts(list))), { all: 4, pending: 2, approved: 1, revoked: 1 });
  assert.equal(h.matches(list[1], 'jia hui'), true);
  assert.equal(h.matches(list[1], 'science only'), true);
  assert.equal(h.matches(list[0], 'jia hui'), false);
  assert.equal(h.sgTime('2026-11-13T10:32:00Z').includes('6:32'), true, 'Singapore time');
  const edited = h.editedRecord({ uid: 'u', status: 'pending', submittedAt: 'x', childCount: 1, children: [] },
    { parentName: ' Mr  Lim ', parentEmail: 'LIM@X.COM', status: 'approved', adminNote: ' ok ',
      children: [{ name: 'Lim Jia Hui', level: 'P4', subjects: 'science' }, { name: '  ', level: '', subjects: '' }] });
  assert.equal(edited.uid, 'u');
  assert.equal(edited.submittedAt, 'x', 'what the admin did not touch stays');
  assert.equal(edited.parentName, 'Mr Lim');
  assert.equal(edited.parentEmail, 'lim@x.com');
  assert.equal(edited.childCount, 1, 'an empty row is dropped');
  assert.equal(edited.status, 'approved');
  assert.equal(edited.adminNote, 'ok');
});

test('/student signs in, shows the admin dashboard and loads the very same gate as every app', () => {
  assert.ok(DASHBOARD.includes('<div class="account-card" id="accountCard" hidden aria-live="polite"></div>'));
  assert.ok(DASHBOARD.includes('<section class="admin-view" id="adminView" hidden aria-labelledby="adminTitle"></section>'));
  assert.ok(DASHBOARD.includes('<script src="student-account.js?v=1.4.0"></script>'));
  assert.ok(DASHBOARD.includes('<script defer src="access-gate.js?v=1.0.0" data-app="student"></script>'));
  const at = text => DASHBOARD.indexOf(text);
  assert.ok(at('<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js">') < at('<script src="student-account.js'), 'the SDK first');
  assert.ok(at('<script src="student-account.js') < at('<script defer src="access-gate.js'));
  assert.ok(/id="adminButton" href="#admin" hidden/.test(DASHBOARD), 'the admin button is hidden until an admin signs in');
});

// Every page of THIS repository a student opens. (math, anskey, tutor, rewards,
// english and chinese load the same file from https://polymathlc.github.io/cer/student/
// — each of those repositories checks its own pages.)
const SCIENCE_PAGES = {
  'index.html': ['student/access-gate.js?v=1.0.0', 'science'],
  'math.html': ['student/access-gate.js?v=1.0.0', 'science-math'],
  'mistakes.html': ['student/access-gate.js?v=1.0.0', 'science-mistakes'],
  'polymath.html': ['student/access-gate.js?v=1.0.0', 'science-polymath'],
  'fps.html': ['student/access-gate.js?v=1.0.0', 'science-strike'],
  'bar-model.html': ['student/access-gate.js?v=1.0.0', 'bar-model'],
  'video-review.html': ['student/access-gate.js?v=1.0.0', 'lesson-replay'],
  'online/index.html': ['../student/access-gate.js?v=1.0.0', 'online']
};

test('every student page here loads the gate, once, at the end of the page', () => {
  for (const [file, [src, app]] of Object.entries(SCIENCE_PAGES)) {
    const page = fs.readFileSync(path.join(root, file), 'utf8');
    const tags = page.match(/<script defer src="[^"]*access-gate\.js[^"]*"[^>]*><\/script>/g) || [];
    assert.equal(tags.length, 1, file);
    assert.equal(tags[0], `<script defer src="${src}" data-app="${app}"></script>`, file);
    const at = page.lastIndexOf(tags[0]);
    // fps.html carries it at the end of <head>: its game test splices into the page's LAST </script>.
    assert.ok(/^\s*<\/(body|head)>/.test(page.slice(at + tags[0].length)), file + ': right before </body> (or </head>)');
  }
});
