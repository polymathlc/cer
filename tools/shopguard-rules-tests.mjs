// Offline checks for Shop Guard's two rules tools and its page. The live
// permission cases run against Google's Rules API in
// .github/workflows/shopguard-rules.yml before anything is published; these pin
// the shape of both patches, their refusals, the publishers' safety (never write
// in read or test mode, never publish over rules that changed underneath), and
// that the page, the Firestore rule and the Storage rule name the same owners.
//
//   node --test tools/shopguard-rules-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  addShopGuardRules, SHOPGUARD_RULE, SHOPGUARD_OWNERS, shopGuardRuleTests, shopGuardPreservedTests,
  publishShopGuardRules, OWNER_UIDS, SHOPGUARD_DOC_PATHS
} from './shopguard-rules.mjs';
import {
  buildCandidate, isInstalled, MARKER, predicateCandidates, shopGuardStorageExpectations, preservationProbes,
  publishShopGuardStorageRules, SHOPGUARD_OWNERS as STORAGE_OWNERS, MAX_BYTES
} from './shopguard-storage-rules.mjs';
import { addOfficeRules } from './office-rules.mjs';
import { addEnquiryRules } from './enquiry-rules.mjs';
import { addOnlineRules } from './online-rules.mjs';
import { addCsRules } from './cs-rules.mjs';
import { buildCandidate as buildCsCandidate, predicateCandidates as csPredicates } from './cs-storage-rules.mjs';

const root = new URL('..', import.meta.url);
const read = rel => readFileSync(new URL(rel, root), 'utf8');

/* ============================== Firestore ============================== */
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
const live = addCsRules(addOnlineRules(addEnquiryRules(original)));
const liveWithOffice = addOfficeRules(live);
const PREDICATE = ' && !isShopGuardPath()';

test('Firestore: one block and one predicate, on every shape of the catch-all', () => {
  for (const source of [original, live, liveWithOffice]) {
    const updated = addShopGuardRules(source);
    assert.notEqual(updated, source);
    assert.equal(updated.replace(SHOPGUARD_RULE, '').replace(PREDICATE + ';', ';'), source);
    assert.equal((updated.match(/BEGIN polymath-shopguard-v1/g) || []).length, 1);
    assert.match(updated, /&& !isShopGuardPath\(\);\n    \}/);
    assert.ok(updated.includes(SHOPGUARD_RULE + '    match /{document=**} {'), 'right above the catch-all');
  }
});

test('Firestore: other apps\' protections stay, and theirs still install on top of ours', () => {
  const updated = addShopGuardRules(liveWithOffice);
  for (const marker of ['polymath-enquiry-server-only-v1', 'polymath-online-v1', 'polymath-cs-server-only-v1', 'polymath-office-v1'])
    assert.equal((updated.match(new RegExp('BEGIN ' + marker, 'g')) || []).length, 1, marker);
  assert.ok(updated.includes('!isPolymathOfficePath() && !isShopGuardPath();'));
  // Office installed AFTER Shop Guard still reads as one clean patch each.
  const officeAfter = addOfficeRules(addShopGuardRules(live));
  assert.equal(addOfficeRules(officeAfter), officeAfter);
  assert.equal(addShopGuardRules(officeAfter), officeAfter);
});

test('Firestore: installing twice changes nothing', () => {
  for (const source of [original, live, liveWithOffice]) {
    const once = addShopGuardRules(source);
    assert.equal(addShopGuardRules(once), once);
  }
});

test('Firestore: unrecognised, partial and duplicate rules fail closed', () => {
  const installed = addShopGuardRules(original);
  for (const value of [null, '', 'service cloud.storage {}',
    original.replace('!isLiveServerPath()', 'true'),
    original.replace("'cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'", "'other'"),
    original.replace('// BEGIN permanent', '// BEGIN polymath-shopguard-v1\n    // BEGIN permanent'),
    original.replace('function isLiveServerPath', 'function isShopGuardOwner() { return true; }\n    function isLiveServerPath'),
    original.replace('// BEGIN permanent', 'match /shopguard/{x} { allow read: if true; }\n    // BEGIN permanent'),
    original.replace('match /{document=**} {', 'match /{document=**} {\n    }\n    match /{other=**} {'),
    installed.replace(SHOPGUARD_RULE, () => SHOPGUARD_RULE + SHOPGUARD_RULE),
    installed.replace(PREDICATE, '')])
    assert.throws(() => addShopGuardRules(value), String(value).slice(0, 80));
});

test('Firestore: the block names exactly the owners, needs a verified email, and is balanced', () => {
  for (const email of SHOPGUARD_OWNERS) assert.ok(SHOPGUARD_RULE.includes(`'${email}'`));
  assert.ok(SHOPGUARD_RULE.includes("email_verified', false) == true"));
  assert.ok(SHOPGUARD_RULE.includes(".lower() in ['chungzhikai@gmail.com']"));
  assert.ok(!/if true/.test(SHOPGUARD_RULE), 'nothing is open to the public');
  const n = s => (SHOPGUARD_RULE.match(new RegExp('\\' + s, 'g')) || []).length;
  assert.equal(n('{'), n('}'));
  assert.equal(n('('), n(')'));
});

test('Firestore: permission cases — only the owners reach any Shop Guard document', () => {
  const cases = shopGuardRuleTests();
  assert.ok(cases.length > 150);
  for (const c of cases) {
    assert.ok(['ALLOW', 'DENY'].includes(c.expectation));
    assert.ok(c.request.path.startsWith('/databases/(default)/documents/shopguard'));
    if (c.request.method === 'create') assert.equal(c.resource, undefined);
  }
  assert.ok(cases.filter(c => !OWNER_UIDS.includes(c.request.auth?.uid)).every(c => c.expectation === 'DENY'));
  assert.ok(cases.filter(c => OWNER_UIDS.includes(c.request.auth?.uid)).every(c => c.expectation === 'ALLOW'));
  for (const path of SHOPGUARD_DOC_PATHS)
    assert.ok(cases.some(c => c.request.path.endsWith('/documents/' + path) && c.request.auth === null && c.expectation === 'DENY'), path);
  // The office admin is not a Shop Guard owner.
  assert.ok(cases.filter(c => c.request.auth?.uid === 'sg-test-office-admin').every(c => c.expectation === 'DENY'));
});

test('Firestore: preserved cases keep look-alike paths open and carry Office when installed', () => {
  const plain = shopGuardPreservedTests(live), withOffice = shopGuardPreservedTests(liveWithOffice);
  for (const path of ['shopguardx/probe', 'users/probe/shopguard/item', 'studentProfiles/probe'])
    assert.ok(plain.some(c => c.request.path.endsWith('/documents/' + path) && c.expectation === 'ALLOW'), path);
  assert.ok(!plain.some(c => c.request.path.includes('officeFamilies/probe') && c.expectation === 'DENY'));
  assert.ok(withOffice.some(c => c.request.path.includes('officeFamilies/probe') && c.expectation === 'DENY'));
});

function fakeApi({ content = liveWithOffice, changeDuringValidation = false, failPermissions = false } = {}) {
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

test('Firestore publisher: read only reads, test publishes nothing, apply publishes once', async () => {
  const r = fakeApi();
  assert.equal((await publishShopGuardRules({ request: r.request, readOnly: true })).changeNeeded, true);
  assert.equal(r.log.tests, 0); assert.equal(r.log.writes.length, 0);
  const t = fakeApi();
  const tested = await publishShopGuardRules({ request: t.request });
  assert.equal(tested.mode, 'test'); assert.equal(t.log.published, null); assert.ok(t.log.tests > tested.validated);
  const a = fakeApi();
  const applied = await publishShopGuardRules({ request: a.request, deploy: true });
  assert.equal(applied.changed, true);
  assert.equal(a.log.writes[0], addShopGuardRules(liveWithOffice));
});

test('Firestore publisher: failed cases or concurrent changes publish nothing', async () => {
  const failing = fakeApi({ failPermissions: true });
  await assert.rejects(publishShopGuardRules({ request: failing.request, deploy: true }), /Rules tests failed/);
  assert.equal(failing.log.published, null);
  const racing = fakeApi({ changeDuringValidation: true });
  await assert.rejects(publishShopGuardRules({ request: racing.request, deploy: true }), /changed during validation/);
  assert.equal(racing.log.published, null);
});

/* ============================== Storage ============================== */
const openStorage = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /shop-orders/{orderId}/{file} {
      allow create: if request.resource.size < 10 * 1024 * 1024;
    }
    match /{allPaths=**} {
      allow read, write: if true;
    }
  }
}`;
const withCs = buildCsCandidate(openStorage, csPredicates('allPaths')[0]);

test('Storage: a candidate adds one owner-only block above the catch-all and changes nothing else', () => {
  for (const source of [openStorage, withCs]) {
    const out = buildCandidate(source, predicateCandidates('allPaths')[0]);
    assert.equal((out.match(new RegExp('BEGIN ' + MARKER, 'g')) || []).length, 1);
    assert.ok(out.indexOf('BEGIN ' + MARKER) < out.indexOf('match /{allPaths=**}'));
    assert.ok(out.includes('match /shop-orders/{orderId}/{file} {\n      allow create: if request.resource.size < 10 * 1024 * 1024;'));
    assert.match(out, /match \/shopguard\/\{shopGuardPath=\*\*\} \{/);
    assert.match(out, /request\.auth\.token\.email\.lower\(\) in \['chungzhikai@gmail\.com'\]/);
    assert.ok(out.includes(`request.resource.size <= ${MAX_BYTES}`));
    assert.ok(out.includes("contentType.matches('^(video|image|text)/.*$')"));
    assert.match(out, /allow read, write: if \(.+\) && !string\(allPaths\)\.matches\('\^\/\?shopguard\/\.\*'\);/);
    assert.ok(isInstalled(out));
    assert.ok(!isInstalled(source));
    const braces = s => [(s.match(/\{/g) || []).length, (s.match(/\}/g) || []).length];
    assert.equal(braces(out)[0], braces(out)[1]);
  }
  // The /cs block is still there, untouched.
  assert.ok(buildCandidate(withCs, 'P()').includes('BEGIN polymath-cs-storage-v1'));
});

test('Storage: duplicate or hand-pasted shopguard rules fail closed', () => {
  const once = buildCandidate(openStorage, 'P()');
  assert.throws(() => isInstalled(once.replace('// BEGIN ' + MARKER, '// BEGIN ' + MARKER + '\n// BEGIN ' + MARKER)));
  assert.throws(() => isInstalled(openStorage.replace('match /{allPaths=**} {', 'match /shopguard/{p=**} { allow read: if true; }\n    match /{allPaths=**} {')));
});

test('Storage: expectations close shopguard/ to everyone but the owner', () => {
  const cases = shopGuardStorageExpectations();
  assert.ok(cases.length > 60);
  const owners = ['sg-st-owner', 'sg-st-owner-caps'];
  assert.ok(cases.filter(c => !owners.includes(c.request.auth?.uid)).every(c => c.expectation === 'DENY'));
  assert.ok(cases.some(c => c.request.auth === null && c.request.method === 'get' && c.expectation === 'DENY'));
  assert.ok(cases.some(c => owners.includes(c.request.auth?.uid) && c.request.method === 'create' && c.expectation === 'DENY'), 'oversized or wrong type refused');
  assert.ok(cases.every(c => c.request.path.includes('/o/shopguard')));
  const probes = preservationProbes();
  assert.ok(probes.every(p => !p.key.startsWith('shopguard/')), 'probes never touch our own folder');
  assert.ok(probes.some(p => p.key.startsWith('shopguardx/')) && probes.some(p => p.key.startsWith('cs-files/')));
});

function fakeStorageApi({ content = openStorage, changeDuringValidation = false } = {}) {
  const log = { writes: [], tests: 0, published: null, reads: 0 };
  const request = async (path, options = {}) => {
    if (path.includes('/releases/firebase.storage/')) {
      if (options.method === 'PATCH') { log.published = options.body.release.rulesetName; return {}; }
      log.reads++;
      if (log.published) return { rulesetName: log.published, updateTime: 'later' };
      const changed = changeDuringValidation && log.reads > 1;
      return { rulesetName: 'projects/mathgen--app/rulesets/' + (changed ? 'changed' : 'current'), updateTime: changed ? '2' : '1' };
    }
    if (path.endsWith(':test')) {
      log.tests += options.body.testSuite.testCases.length;
      return { testResults: options.body.testSuite.testCases.map(() => ({ state: 'SUCCESS' })) };
    }
    if (options.method === 'POST') { log.writes.push(options.body.source.files[0].content); return { name: 'projects/mathgen--app/rulesets/candidate' }; }
    return { source: { files: [{ name: 'storage.rules', content }] } };
  };
  return { request, log };
}

test('Storage publisher: read only reads, test publishes nothing, apply publishes the first good candidate', async () => {
  const r = fakeStorageApi();
  assert.equal((await publishShopGuardStorageRules({ request: r.request, readOnly: true })).changeNeeded, true);
  assert.equal(r.log.tests, 0);
  const t = fakeStorageApi();
  assert.equal((await publishShopGuardStorageRules({ request: t.request })).mode, 'test');
  assert.equal(t.log.published, null); assert.equal(t.log.writes.length, 0);
  const a = fakeStorageApi();
  const applied = await publishShopGuardStorageRules({ request: a.request, deploy: true });
  assert.equal(applied.changed, true);
  assert.equal(a.log.writes[0], buildCandidate(openStorage, predicateCandidates('allPaths')[0]));
  const racing = fakeStorageApi({ changeDuringValidation: true });
  await assert.rejects(publishShopGuardStorageRules({ request: racing.request, deploy: true }), /changed during validation/);
  assert.equal(racing.log.published, null);
  const installed = fakeStorageApi({ content: buildCandidate(openStorage, 'P()') });
  assert.equal((await publishShopGuardStorageRules({ request: installed.request, deploy: true })).installed, true);
  assert.equal(installed.log.published, null);
});

/* ============================== The page ============================== */
const page = read('shopguard/index.html');

test('page: the owners match both rules, and the module parses', () => {
  const allowed = JSON.parse(page.match(/const ALLOWED_EMAILS = (\[[^\]]*\]);/)[1]);
  assert.deepEqual(allowed, SHOPGUARD_OWNERS);
  assert.deepEqual(STORAGE_OWNERS, SHOPGUARD_OWNERS);
  const script = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const dir = mkdtempSync(join(tmpdir(), 'shopguard-'));
  writeFileSync(join(dir, 'page.mjs'), script);
  execFileSync(process.execPath, ['--check', join(dir, 'page.mjs')]);
});

test('page: same project, App Check key and fallback model as the CER app', () => {
  const app = read('app.js');
  const key = app.match(/const RECAPTCHA_SITE_KEY = "([^"]+)"/)[1];
  assert.ok(page.includes(`const RECAPTCHA_SITE_KEY = "${key}"`));
  const model = app.match(/const AI_MODEL = "([^"]+)"/)[1];
  assert.ok(page.includes(`const FALLBACK_MODEL = "${model}"`), 'falls back to the CER model');
  assert.ok(page.includes('projectId: "mathgen--app"'));
  assert.ok(page.includes(`const SHOP_ID = "cc-collectibles"`));
});

test('page: stays out of search, shows its version, and refuses to record until private', () => {
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.match(page, /const APP_VERSION = "\d+\.\d+\.\d+"/);
  assert.ok(page.includes('$("brandSub").textContent = `Shop Guard v${APP_VERSION}`'));
  assert.ok(/async function arm\([^)]*\) \{[\s\S]{0,200}requirePrivate\("start guarding"\)/.test(page));
  assert.ok(/async function saveSettings\(\) \{\s*if \(!\(await requirePrivate\("save settings"\)\)\) return;/.test(page));
  // The signed-out probes read exactly the paths the two rules protect.
  assert.ok(page.includes('/documents/shopguard/${SHOP_ID}?key='));
  assert.ok(page.includes('encodeURIComponent(`shopguard/${SHOP_ID}/diagnostics/privacy-probe.txt`)'));
});
