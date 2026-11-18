// Offline checks for tools/private-data-rules.mjs (the signed-out lock):
// the patch is narrow, idempotent, undoable byte for byte, lives beside every
// other narrow protection in either order, refuses rules it does not
// recognise, and the publisher never writes in read or test mode and never
// publishes over rules that changed underneath it. The permission
// expectations themselves run against Google's Rules API in
// .github/workflows/private-data-rules.yml before anything is published.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPrivateDataRules, removePrivateDataRules, LOCK_RULE, LOCK_RULE_V1, SIGNED_OUT_LOCKED_COLLECTIONS,
  SIGNED_OUT_CREATE_ONLY_COLLECTIONS,
  lockRuleTests, lockPreservedTests, lockedPaths, uniqueCases, publishPrivateDataRules,
  probeStranger, STILL_OPEN, PROBE_COLLECTIONS, SIGNED_IN
} from './private-data-rules.mjs';
import { withSignedOutLock, topCollectionOf, hasSignedOutLock, signedOutLockVersion, V1_LOCKED } from './signed-out-lock-core.mjs';
import { addEnquiryRules } from './enquiry-rules.mjs';
import { addOnlineRules } from './online-rules.mjs';
import { addCsRules, csPreservedTests } from './cs-rules.mjs';
import { addTrialRules, trialPreservedTests } from './trial-rules.mjs';
import { preservedRuleTests } from './cer-live-server-rules.mjs';
import { officePreservedTests } from './office-rules.mjs';

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
const withOnline = addOnlineRules(withEnquiry);
const withCs = addCsRules(withOnline);
const PREDICATE = ' && !isSignedOutPrivatePath()';

test('the patch adds one block and one predicate, whatever is already on the catch-all', () => {
  for (const source of [original, withEnquiry, withOnline, withCs]) {
    const updated = addPrivateDataRules(source);
    assert.notEqual(updated, source);
    assert.equal(updated.replace(LOCK_RULE, '').replace(PREDICATE, ''), source);
    assert.equal((updated.match(/BEGIN polymath-signed-out-lock-v2/g) || []).length, 1);
    assert.ok(!updated.includes('polymath-signed-out-lock-v1'));
    assert.match(updated, /&& !isSignedOutPrivatePath\(\);\n    \}/);
    assert.ok(updated.includes(LOCK_RULE + '    match /{document=**} {'), 'right above the catch-all');
    assert.ok(hasSignedOutLock(updated));
    assert.ok(!hasSignedOutLock(source));
  }
});

test('installing twice changes nothing, and undo gives back the exact original', () => {
  for (const source of [original, withEnquiry, withOnline, withCs]) {
    const once = addPrivateDataRules(source);
    assert.equal(addPrivateDataRules(once), once);
    assert.equal(removePrivateDataRules(once), source, 'byte for byte');
    assert.equal(removePrivateDataRules(source), source, 'undo of nothing is nothing');
  }
});

test('a later app\'s predicate does not confuse it, and the others can still install after it', () => {
  const locked = addPrivateDataRules(withEnquiry);
  const later = locked.replace('!isSignedOutPrivatePath();', '!isSignedOutPrivatePath() && !isLaterPath();');
  assert.equal(addPrivateDataRules(later), later, 'still reads as installed');
  assert.ok(!removePrivateDataRules(later).includes('isSignedOutPrivatePath'));
  assert.ok(removePrivateDataRules(later).includes('!isLaterPath();'), 'the later predicate stays');
  const thenOnline = addOnlineRules(locked);
  assert.ok(thenOnline.includes('!isSignedOutPrivatePath() && !isPolymathOnlinePath();'));
  assert.equal(addPrivateDataRules(thenOnline), thenOnline);
  const thenCs = addCsRules(thenOnline);
  const thenTrial = addTrialRules(thenCs);
  assert.equal(addPrivateDataRules(thenTrial), thenTrial);
  assert.ok(thenTrial.includes('!isSignedOutPrivatePath() && !isPolymathOnlinePath() && !isPolymathCsPath() && !isPolymathTrialPath();'));
});

test('unrecognised, partial, duplicate and clashing rules fail closed', () => {
  const installed = addPrivateDataRules(withEnquiry);
  for (const value of [null, '', 'service cloud.storage {}',
    original.replace('!isLiveServerPath()', 'true'),
    original.replace('// BEGIN permanent', '// BEGIN polymath-signed-out-lock-v1\n    // BEGIN permanent'),
    original.replace('// BEGIN permanent', 'function isSignedOutPrivatePath() { return false; }\n    // BEGIN permanent'),
    original.replace('match /{document=**} {', 'match /{document=**} {\n    }\n    match /{other=**} {'),
    installed.replace(LOCK_RULE, () => LOCK_RULE + LOCK_RULE),
    installed.replace(PREDICATE, '')]) {
    assert.throws(() => addPrivateDataRules(value), String(value).slice(0, 80));
  }
  for (const value of [installed.replace(PREDICATE, ''), installed.replace(LOCK_RULE, () => LOCK_RULE + LOCK_RULE)])
    assert.throws(() => removePrivateDataRules(value));
});

test('the block applies only to requests with no sign-in at all, and names exactly the locked collections', () => {
  assert.match(LOCK_RULE, /return request\.auth == null\n\s+&& \(request\.path\[3\] in \[/);
  const lists = [...LOCK_RULE.matchAll(/in \[([^\]]+)\]/g)].map(m => m[1].split(',').map(s => s.trim().replace(/'/g, '')));
  assert.equal(lists.length, 2);
  assert.deepEqual(lists[0], [...SIGNED_OUT_LOCKED_COLLECTIONS]);
  assert.deepEqual(lists[1], [...SIGNED_OUT_CREATE_ONLY_COLLECTIONS]);
  assert.match(LOCK_RULE, /\|\| \(request\.method != 'create'\n\s+&& request\.path\[3\] in \['schedule_bookings'/);
  const all = [...lists[0], ...lists[1]];
  assert.equal(new Set(all).size, all.length, 'no duplicates, and no collection is both');
  for (const name of V1_LOCKED) assert.ok(SIGNED_OUT_LOCKED_COLLECTIONS.includes(name), 'v2 keeps everything v1 locked: ' + name);
  for (const name of ['users', 'questionAttempts', 'loginEvents', 'messages', 'userProfiles', 'studentProfiles',
    'students', 'claims', 'awards', 'rewards', 'tutorWorksheets', 'scanPapers'])
    assert.ok(SIGNED_OUT_LOCKED_COLLECTIONS.includes(name), name);
  for (const name of ['schedule_bookings', 'june2026_registrations', 'sep2026_registrations'])
    assert.ok(SIGNED_OUT_CREATE_ONLY_COLLECTIONS.includes(name), name);
  // Public pages that read signed out must never be swept up.
  for (const name of ['schedule_config', 'officeLinks', 'shop_products', 'shop_settings', 'liveClassRooms', 'shopguard',
    'polymathTutorPapers', 'mail', 'pdfAnnotator', 'mindmaps', 'config'])
    assert.ok(!all.includes(name), name);
  for (const block of [LOCK_RULE, LOCK_RULE_V1]) {
    const n = s => (block.match(new RegExp('\\' + s, 'g')) || []).length;
    assert.equal(n('{'), n('}'));
    assert.equal(n('('), n(')'));
    assert.equal(n('['), n(']'));
  }
});

test('v1 rules are upgraded to v2 in place, and either version undoes byte for byte', () => {
  for (const source of [original, withEnquiry, withOnline, withCs]) {
    // What v1 published: its block above the catch-all and the one predicate.
    const v1 = source.replace(/^([ \t]*)match\s+\/\{\w+=\*\*\}\s*\{/m, whole => LOCK_RULE_V1 + whole)
      .replace(/(allow read, write: if !isPermanentStudentHistoryPath\(\) && !isLiveServerPath\(\)(?: && !\w+\(\))*);/, '$1' + PREDICATE + ';');
    assert.equal(signedOutLockVersion(v1), 1);
    assert.match(LOCK_RULE_V1, /in \['users', 'userProfiles'/);
    assert.ok(!LOCK_RULE_V1.includes("'students'"), 'v1 text is the published v1, not the new list');
    const v2 = addPrivateDataRules(v1);
    assert.equal(v2, addPrivateDataRules(source), 'upgrading v1 lands exactly where a fresh install does');
    assert.equal(signedOutLockVersion(v2), 2);
    assert.equal(addPrivateDataRules(v2), v2);
    assert.equal(removePrivateDataRules(v1), source, 'v1 undo');
    assert.equal(removePrivateDataRules(v2), source, 'v2 undo');
    assert.throws(() => addPrivateDataRules(v1.replace(LOCK_RULE_V1, () => LOCK_RULE_V1 + LOCK_RULE)), 'both blocks at once');
    assert.throws(() => addPrivateDataRules(v1.replace("'users', ", '')), 'an edited v1 block');
  }
});

test('every locked path is refused signed out and still allowed to every kind of signed-in account', () => {
  const cases = lockRuleTests();
  const { docs, lists } = lockedPaths();
  assert.ok(docs.length >= SIGNED_OUT_LOCKED_COLLECTIONS.length * 2);
  for (const c of cases) {
    const signedIn = !!c.request.auth, root = topCollectionOf(c);
    const createOnly = SIGNED_OUT_CREATE_ONLY_COLLECTIONS.includes(root);
    const want = signedIn || (createOnly && c.request.method === 'create') ? 'ALLOW' : 'DENY';
    assert.equal(c.expectation, want, c.request.path + ' ' + c.request.method);
    assert.ok(SIGNED_OUT_LOCKED_COLLECTIONS.includes(root) || createOnly, c.request.path);
  }
  for (const root of [...SIGNED_OUT_LOCKED_COLLECTIONS, ...SIGNED_OUT_CREATE_ONLY_COLLECTIONS]) {
    for (const method of ['get', 'list', 'create', 'update', 'delete']) {
      assert.ok(cases.some(c => topCollectionOf(c) === root && c.request.method === method && !c.request.auth), root + ' ' + method + ' signed out');
      for (const uid of SIGNED_IN)
        assert.ok(cases.some(c => topCollectionOf(c) === root && c.request.method === method && c.request.auth?.uid === uid), root + ' ' + method + ' ' + uid);
    }
  }
  // A parent can still book from the public form; nobody signed out reads a booking back.
  assert.ok(cases.some(c => topCollectionOf(c) === 'schedule_bookings' && c.request.method === 'create' && !c.request.auth && c.expectation === 'ALLOW'));
  assert.ok(cases.some(c => topCollectionOf(c) === 'schedule_bookings' && c.request.method === 'list' && !c.request.auth && c.expectation === 'DENY'));
  // v1's own suite (for rules still carrying v1) names only the v1 collections.
  for (const c of lockRuleTests(1)) assert.ok(V1_LOCKED.includes(topCollectionOf(c)), c.request.path);
  assert.ok(SIGNED_IN.includes('lock-test-anonymous'), 'an anonymous sign-in is a sign-in (Study Buddy voice, Ans Key guests)');
  assert.ok(lists.includes('users/probe/settings'));
});

test('the preserved set keeps every other app as it is, and adapts once the lock is live', () => {
  const before = lockPreservedTests(withCs);
  assert.ok(before.length > 100);
  for (const path of STILL_OPEN)
    assert.ok(before.some(c => c.request.path.endsWith('/documents/' + path) && c.expectation === 'ALLOW' && !c.request.auth), path);
  // Before the lock, the other tools still expect users/… open to a stranger.
  assert.ok(before.some(c => topCollectionOf(c) === 'users' && !c.request.auth && c.expectation === 'ALLOW'));
  const locked = addPrivateDataRules(withCs);
  const after = lockPreservedTests(locked);
  assert.equal(after.length, before.length);
  const touched = c => SIGNED_OUT_LOCKED_COLLECTIONS.includes(topCollectionOf(c))
    || (SIGNED_OUT_CREATE_ONLY_COLLECTIONS.includes(topCollectionOf(c)) && c.request.method !== 'create');
  for (const c of after) {
    if (!c.request.auth && touched(c))
      assert.equal(c.expectation, 'DENY', 'a stranger is refused ' + c.request.path);
  }
  // Nothing outside the locked collections changes expectation.
  before.forEach((c, i) => {
    if (!touched(c) || c.request.auth)
      assert.equal(after[i].expectation, c.expectation, c.request.path);
  });
});

test('every other rules tool corrects its own expectations once the lock is live', () => {
  const locked = addPrivateDataRules(withCs);
  for (const [name, fn] of [['live', preservedRuleTests], ['cs', csPreservedTests], ['office', officePreservedTests], ['trial', trialPreservedTests]]) {
    const before = fn(withCs), after = fn(locked);
    assert.ok(before.some(c => topCollectionOf(c) === 'users' && !c.request.auth && c.expectation === 'ALLOW'), name + ' tests users/ signed out');
    assert.ok(!after.some(c => SIGNED_OUT_LOCKED_COLLECTIONS.includes(topCollectionOf(c)) && !c.request.auth && c.expectation === 'ALLOW'), name);
  }
});

test('withSignedOutLock copies, never mutates, and leaves signed-in and DENY cases alone', () => {
  const locked = addPrivateDataRules(original);
  const cases = [
    { expectation: 'ALLOW', request: { path: '/databases/(default)/documents/users/x', method: 'get', auth: null } },
    { expectation: 'ALLOW', request: { path: '/databases/(default)/documents/users/x', method: 'get', auth: { uid: 'u' } } },
    { expectation: 'DENY', request: { path: '/databases/(default)/documents/users/x', method: 'get', auth: null } },
    { expectation: 'ALLOW', request: { path: '/databases/(default)/documents/usersX/x', method: 'get', auth: null } }
  ];
  const out = withSignedOutLock(locked, cases);
  assert.deepEqual(out.map(c => c.expectation), ['DENY', 'ALLOW', 'DENY', 'ALLOW']);
  assert.equal(cases[0].expectation, 'ALLOW', 'input untouched');
  assert.equal(withSignedOutLock(original, cases), cases, 'no lock, same array');
  assert.equal(topCollectionOf({ request: { path: '/databases/(default)/documents/a/b/c' } }), 'a');
  assert.equal(topCollectionOf({ request: { path: '/elsewhere' } }), '');
});

test('uniqueCases drops exact repeats only', () => {
  const a = { expectation: 'ALLOW', request: { path: '/p', method: 'get', auth: null } };
  const b = { expectation: 'DENY', request: { path: '/p', method: 'get', auth: null } };
  assert.equal(uniqueCases([a, { ...a }, b]).length, 2);
});

function fakeRules(content, { changeDuringValidation = false, failTests = false } = {}) {
  const calls = [];
  let release = { rulesetName: 'projects/mathgen--app/rulesets/current', updateTime: 't1' };
  const request = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET', body: options.body });
    if (path.endsWith(':test')) {
      const n = options.body.testSuite.testCases.length;
      return { testResults: Array.from({ length: n }, (_, i) => ({ state: failTests && i === 0 ? 'FAILURE' : 'SUCCESS' })) };
    }
    if (path === 'projects/mathgen--app/releases/cloud.firestore' && (options.method || 'GET') === 'GET') {
      const out = { ...release };
      if (changeDuringValidation && calls.filter(c => c.path === path).length === 2) out.updateTime = 't2';
      return out;
    }
    if (path === 'projects/mathgen--app/releases/cloud.firestore' && options.method === 'PATCH') {
      release = { rulesetName: options.body.release.rulesetName, updateTime: 't3' };
      return release;
    }
    if (path === 'projects/mathgen--app/rulesets' && options.method === 'POST') return { name: 'projects/mathgen--app/rulesets/candidate' };
    if (path === 'projects/mathgen--app/rulesets/current') return { source: { files: [{ name: 'firestore.rules', content }] } };
    throw new Error('unexpected ' + path);
  };
  return { request, calls };
}

test('read and test modes never write; apply publishes once; undo takes it out', async () => {
  for (const mode of ['read', 'test']) {
    const { request, calls } = fakeRules(withCs);
    const out = await publishPrivateDataRules({ request, mode });
    assert.equal(out.changeNeeded, true);
    assert.ok(!calls.some(c => c.method === 'POST' && c.path.endsWith('/rulesets')), mode);
    assert.ok(!calls.some(c => c.method === 'PATCH'), mode);
  }
  const apply = fakeRules(withCs);
  const out = await publishPrivateDataRules({ request: apply.request, mode: 'apply' });
  assert.equal(out.changed, true);
  assert.equal(out.previousRuleset, 'projects/mathgen--app/rulesets/current');
  const posted = apply.calls.find(c => c.method === 'POST' && c.path.endsWith('/rulesets')).body.source.files[0].content;
  assert.equal(posted, addPrivateDataRules(withCs));
  const tested = apply.calls.filter(c => c.path.endsWith(':test'));
  assert.ok(tested.length >= 2, 'today\'s rules and the candidate are both tested');

  const undo = fakeRules(addPrivateDataRules(withCs));
  const back = await publishPrivateDataRules({ request: undo.request, mode: 'undo' });
  assert.equal(back.changed, true);
  assert.equal(undo.calls.find(c => c.method === 'POST' && c.path.endsWith('/rulesets')).body.source.files[0].content, withCs);

  const again = fakeRules(addPrivateDataRules(withCs));
  const noop = await publishPrivateDataRules({ request: again.request, mode: 'apply' });
  assert.equal(noop.changed, false);
  assert.ok(!again.calls.some(c => c.method === 'PATCH'), 'already installed: nothing published');
});

test('a failed permission case or a rules change mid-run publishes nothing', async () => {
  const failing = fakeRules(withCs, { failTests: true });
  await assert.rejects(publishPrivateDataRules({ request: failing.request, mode: 'apply' }), /Rules tests failed/);
  assert.ok(!failing.calls.some(c => c.method === 'PATCH'));
  const racing = fakeRules(withCs, { changeDuringValidation: true });
  await assert.rejects(publishPrivateDataRules({ request: racing.request, mode: 'apply' }), /changed during validation/);
  assert.ok(!racing.calls.some(c => c.method === 'PATCH'));
  await assert.rejects(publishPrivateDataRules({ request: failing.request, mode: 'wipe' }), /Unknown mode/);
});

test('the stranger probe waits for the rules to spread, and reports honestly', async () => {
  let round = 0;
  const fetchImpl = async url => ({ status: round >= 2 ? 403 : (url.includes('/users?') ? 200 : 403) });
  const sleeps = [];
  const out = await probeStranger({ fetchImpl: async u => fetchImpl(u), attempts: 5, waitMs: 1, sleep: async ms => { sleeps.push(ms); round++; } });
  assert.equal(out.refused, true);
  assert.equal(out.attempts, 3);
  assert.deepEqual(Object.keys(out.statuses), PROBE_COLLECTIONS);
  const open = await probeStranger({ fetchImpl: async () => ({ status: 200 }), attempts: 2, waitMs: 1, sleep: async () => {} });
  assert.equal(open.refused, false);
  assert.equal(open.statuses.questionAttempts, 200);
  const urls = [];
  await probeStranger({ fetchImpl: async u => { urls.push(u); return { status: 403 }; }, attempts: 1 });
  for (const u of urls) assert.match(u, /\/documents\/\w+\?pageSize=1$/, 'a plain list read, nothing Firestore could reject as malformed');
});
