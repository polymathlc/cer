// Offline checks for tools/cs-storage-rules.mjs. The live behaviour is proved
// against Google's Rules API in the workflow before anything is published;
// these pin the patch's shape and the publisher's refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidate, csExpectations, describeStorageRules, isInstalled, locateCatchAll, MARKER, patchCatchAll,
  predicateCandidates, preservationProbes, publishCsStorageRules } from './cs-storage-rules.mjs';

const open = `rules_version = '2';
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
const signedIn = open.replace('allow read, write: if true;', "allow read;\n      allow write: if request.auth != null\n        && request.resource.size < 50 * 1024 * 1024;");

test('the catch-all is found, with its wildcard name', () => {
  const where = locateCatchAll(open);
  assert.equal(where.variable, 'allPaths');
  assert.ok(where.block.trimStart().startsWith('match /{allPaths=**} {') && where.block.trimEnd().endsWith('}'));
});

test('every allow in the catch-all gets the predicate, with or without a condition', () => {
  const where = locateCatchAll(signedIn);
  const out = patchCatchAll(where.block, 'P()');
  assert.match(out, /allow read: if P\(\);/);
  assert.match(out, /allow write: if \(request\.auth != null\n\s+&& request\.resource\.size < 50 \* 1024 \* 1024\) && P\(\);/);
  assert.match(patchCatchAll(locateCatchAll(open).block, 'P()'), /allow read, write: if \(true\) && P\(\);/);
});

test('a candidate adds one block above the catch-all and changes nothing else', () => {
  for (const source of [open, signedIn]) {
    const pred = predicateCandidates('allPaths')[0];
    const out = buildCandidate(source, pred);
    assert.equal((out.match(new RegExp('BEGIN ' + MARKER, 'g')) || []).length, 1);
    assert.ok(out.indexOf('BEGIN ' + MARKER) < out.indexOf('match /{allPaths=**}'));
    assert.ok(out.includes('match /shop-orders/{orderId}/{file} {\n      allow create: if request.resource.size < 10 * 1024 * 1024;'), 'other blocks untouched');
    assert.match(out, /match \/cs-files\/\{csFileId\}\/\{csFileName\} \{/);
    assert.match(out, /request\.auth\.token\.email == 'chungzhikai@gmail\.com'/);
    assert.ok(isInstalled(out));
    assert.ok(!isInstalled(source));
    const braces = s => [(s.match(/\{/g) || []).length, (s.match(/\}/g) || []).length];
    assert.deepEqual(braces(out)[0], braces(out)[1]);
  }
});

test('unrecognised Storage rules fail closed', () => {
  for (const bad of [null, '', 'service cloud.firestore {}',
    open.replace('match /{allPaths=**} {', 'match /{allPaths=**} {}\n    match /{other=**} {'),
    open.replace('match /b/{bucket}/o {', 'match /b/{bucket}/x {'),
    open.replace('allow read, write: if true;', '')])
    assert.throws(() => buildCandidate(bad, 'P()'), String(bad).slice(0, 60));
});

test('the /cs expectations close the folder to everyone but the admin\'s upload', () => {
  const cases = csExpectations();
  const allowed = cases.filter(c => c.expectation === 'ALLOW');
  assert.equal(allowed.length, 2);
  assert.ok(allowed.every(c => c.request.auth?.token?.email === 'chungzhikai@gmail.com' && c.request.auth.token.email_verified));
  assert.ok(allowed.every(c => ['create', 'update'].includes(c.request.method)));
  assert.ok(cases.some(c => c.request.method === 'list' && c.request.auth === null && c.expectation === 'DENY'));
  assert.ok(cases.some(c => c.request.method === 'get' && c.request.auth?.token?.email === 'chungzhikai@gmail.com' && c.expectation === 'DENY'),
    'even the admin downloads through the server, never straight from Storage');
  for (const c of cases) assert.match(c.request.path, /^\/b\/mathgen--app\.firebasestorage\.app\/o\/cs-files/);
});

test('the preservation probes cover other folders, near-miss names and the root', () => {
  const keys = preservationProbes().map(p => p.key);
  for (const path of ['shop-orders/', 'cer-images/', 'cs-previews/', 'cs-filesx/', 'other/cs-files/', 'top-level.txt'])
    assert.ok(keys.some(k => k.startsWith(path)), path);
  assert.ok(keys.length >= 150);
});

test('the outline shows structure but no string values', () => {
  const o = describeStorageRules(open.replace('true', "request.auth.token.email == 'secret@example.com'"));
  assert.ok(o.lines.some(l => l.startsWith('match /{allPaths=**}')));
  assert.ok(!JSON.stringify(o).includes('secret@example.com'));
});

function fakeApi({ content = open, allowAllToday = true, goodPredicateIndex = 0, change = false } = {}) {
  const log = { published: null, created: [], reads: 0 };
  const preds = predicateCandidates('allPaths');
  const request = async (path, options = {}) => {
    if (path.includes('releases/firebase.storage')) {
      if (options.method === 'PATCH') { log.published = options.body.release.rulesetName; return {}; }
      log.reads++;
      if (log.published) return { rulesetName: log.published, updateTime: 'later' };
      return { rulesetName: 'projects/mathgen--app/rulesets/' + (change && log.reads > 1 ? 'moved' : 'current'), updateTime: change && log.reads > 1 ? '2' : '1' };
    }
    if (path.endsWith(':test')) {
      const src = options.body.source.files[0].content;
      const cases = options.body.testSuite.testCases;
      if (src === content) return { testResults: cases.map(c => ({ state: (c.expectation === 'ALLOW') === allowAllToday ? 'SUCCESS' : 'FAILURE' })) };
      const works = src.includes(preds[goodPredicateIndex]);
      return { testResults: cases.map(() => ({ state: works ? 'SUCCESS' : 'FAILURE' })) };
    }
    if (options.method === 'POST') { log.created.push(options.body.source.files[0].content); return { name: 'projects/mathgen--app/rulesets/candidate' }; }
    return { source: { files: [{ name: 'storage.rules', content }] } };
  };
  return { request, log, preds };
}

test('read mode only reads; test mode picks a candidate and publishes nothing', async () => {
  const a = fakeApi();
  const read = await publishCsStorageRules({ request: a.request, readOnly: true });
  assert.equal(read.changeNeeded, true);
  assert.equal(a.log.created.length, 0);
  const b = fakeApi({ goodPredicateIndex: 1 });
  const t = await publishCsStorageRules({ request: b.request });
  assert.equal(t.mode, 'test');
  assert.equal(t.predicate, b.preds[1], 'the first spelling that keeps everything is chosen');
  assert.equal(t.tried.length, 2);
  assert.equal(b.log.published, null);
  assert.equal(b.log.created.length, 0);
});

test('apply publishes the chosen candidate; no good candidate or a race publishes nothing', async () => {
  const a = fakeApi({ goodPredicateIndex: 2 });
  const r = await publishCsStorageRules({ request: a.request, deploy: true });
  assert.equal(r.changed, true);
  assert.equal(a.log.published, 'projects/mathgen--app/rulesets/candidate');
  assert.ok(a.log.created[0].includes(a.preds[2]));
  const none = fakeApi({ goodPredicateIndex: 99 });
  await assert.rejects(publishCsStorageRules({ request: none.request, deploy: true }), /No candidate/);
  assert.equal(none.log.published, null);
  const race = fakeApi({ change: true });
  await assert.rejects(publishCsStorageRules({ request: race.request, deploy: true }), /changed during validation/);
  assert.equal(race.log.published, null);
});

test('installed rules are recognised and only checked', async () => {
  const installed = buildCandidate(open, predicateCandidates('allPaths')[0]);
  const a = fakeApi({ content: installed });
  const r = await publishCsStorageRules({ request: a.request, deploy: true });
  assert.equal(r.installed, true);
  assert.equal(r.changeNeeded, false);
  assert.equal(a.log.published, null);
});
