// node --test tools/cer-voice-tests.mjs
//
// 📖 The Science portal READS the answer book Ans Key writes (teacher-voice.js,
// byte for byte Ans Key's). These checks pin the glue in app.js: every AI kind
// but `gen` is grounded with the teacher's own answer, the cache follows the
// account, only the teacher lists every entry, and nothing here writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const APP = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const TV = require(path.join(root, 'teacher-voice.js'));
const P = TV.pure;

function section() {
  const s = APP.indexOf("📖 THE ANSWER BOOK — the teacher's own answers");
  const e = APP.indexOf('End answer book', s);
  assert.ok(s > 0 && e > s, 'the answer book glue is marked');
  const open = APP.lastIndexOf('\n', s);
  return APP.slice(open, APP.indexOf('\n', e));
}
function fnBody(name) {
  const s = APP.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(s >= 0, name + ' exists');
  const open = APP.indexOf('{', s);
  let d = 0;
  for (let i = open; i < APP.length; i++) {
    if (APP[i] === '{') d++;
    else if (APP[i] === '}') { d--; if (!d) return APP.slice(open, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

test('teacher-voice.js loads before app.js, with the release version', () => {
  const v = (APP.match(/const APP_VERSION = 'v([\d.]+)'/) || [])[1];
  assert.ok(v, 'APP_VERSION');
  const tag = INDEX.indexOf('<script src="teacher-voice.js?v=' + v + '"></script>');
  const app = INDEX.indexOf('<script type="module" src="app.js?v=' + v + '"></script>');
  assert.ok(tag > 0, 'teacher-voice.js is loaded at ?v=' + v);
  assert.ok(app > tag, 'and before the app module');
});

test('aiGrounding appends the teacher\'s own answer to every kind but gen', () => {
  const b = fnBody('aiGrounding');
  assert.match(b, /_tvBlock\(kind, topic, q\)/);
  const gen = b.indexOf("if (kind === 'gen')");
  const voice = b.indexOf('_tvBlock(');
  assert.ok(gen > 0 && gen < voice, 'gen returns before the book is asked');
  for (const k of ['answer', 'teach', 'check']) {
    assert.match(b, new RegExp("kind === '" + k + "'\\) return [^;]*\\+ voice;"), k + ' carries the voice');
  }
  assert.match(b, /return _notesMarkingBlock\(topic \|\| ''\) \+ style \+ voice;/, 'marking (and an unknown kind) carries it too');
});

test('the cache follows the account, and the teacher\'s device lists the book', () => {
  assert.match(fnBody('stopTeachingNotes'), /_tvReset\(\)/);
  assert.match(APP, /loadTeachingNotes\(\);[^\n]*\n\s*try \{ _tvLoadAll\(\); \} catch \(e\) \{\}/);
});

test('nothing here writes to the answer book', () => {
  const s = section();
  assert.ok(!/setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction|\.set\(|\.update\(/.test(s), 'the glue only reads');
  assert.ok(!/innerHTML/.test(s));
});

test('only the teacher lists every entry; anyone else reads question by question', () => {
  const s = section();
  assert.match(s, /!_isAdmin\(\) \|\| o !== currentUser\.uid/);
  assert.match(fnBody('_tvLoadAll'), /!_isAdmin\(\)/);
});

/* ---- The glue, run against the real teacher-voice.js and a fake Firestore ---- */
function harness({ admin, docs }) {
  const reads = [];
  const ctx = {
    window: { TeacherVoice: TV }, console: { warn() {}, error() {} },
    db: {}, adminUid: 'T',
    currentUser: admin ? { uid: 'T', role: 'admin' } : { uid: 'S', role: 'student' },
    _isAdmin: () => !!admin,
    doc: (_db, ...segs) => segs.join('/'),
    collection: (_db, ...segs) => segs.join('/'),
    getDoc: async (p) => { reads.push(p); const d = docs[p]; return { exists: () => !!d, data: () => d }; },
    getDocs: async (p) => { reads.push(p); const list = docs[p] || []; return { forEach: (f) => list.forEach((x) => f({ data: () => x })) }; },
    getTopicLevel: () => 'P5',
    stripHtml: (s) => String(s || '').replace(/<[^>]*>/g, ''),
    setTimeout, clearTimeout, Promise
  };
  vm.createContext(ctx);
  const src = section().replace(/^let /gm, 'var ');
  vm.runInContext(src, ctx);
  return { ctx, reads };
}

function bookFor(entries) {
  const docs = {};
  const rows = entries.map((e) => P.cleanEntry(e)).filter(Boolean);
  const byBucket = {};
  rows.forEach((r) => { (byBucket[r.bucket] = byBucket[r.bucket] || []).push(r); });
  const base = 'users/T/' + TV.COLL + '/' + TV.BOOK_DOC;
  docs['users/T/' + TV.COLL + '/' + TV.INDEX_DOC] = { v: 1, buckets: Object.fromEntries(Object.keys(byBucket).map((k) => [k, byBucket[k].length])) };
  Object.keys(byBucket).forEach((b) => { docs['users/T/' + TV.COLL + '/' + P.indexDocId(b)] = { v: 1, rows: byBucket[b].map(P.rowOf) }; });
  rows.forEach((r) => { docs[base + '/' + TV.ENTRIES + '/' + r.id] = r; });
  docs[base + '/' + TV.ENTRIES] = rows;
  return docs;
}

const Q = 'A metal spoon left in a cup of hot soup became hot. Explain why.';
const ENTRY = { k: P.slotKey('d', 'p1:q5'), n: '5', q: Q, a: 'Metal is a good conductor of heat. The spoon gained heat from the hotter soup.', src: 'typed', lvl: 'P5', sub: 'science', ws: 'Heat', doc: 'd', page: 1, at: '2026-11-01T00:00:00Z' };

test('a student: a question asked once is answered from the book the next time', async () => {
  const { ctx } = harness({ admin: false, docs: bookFor([ENTRY]) });
  const first = vm.runInContext('_tvBlock("teach", "Heat", ' + JSON.stringify(Q) + ')', ctx);
  assert.equal(typeof first, 'string');
  await new Promise((r) => setTimeout(r, 30));
  const second = vm.runInContext('_tvBlock("teach", "Heat", ' + JSON.stringify(Q) + ')', ctx);
  assert.match(second, /good conductor of heat/);
  vm.runInContext('_tvReset()', ctx);
  assert.ok(!/good conductor/.test(vm.runInContext('_tvBlock("teach", "Heat", "x")', ctx)), 'an account change drops the cache');
});

test('tvPrimeFor fetches ahead, so the FIRST ask is grounded', async () => {
  const { ctx } = harness({ admin: false, docs: bookFor([ENTRY]) });
  await vm.runInContext('tvPrimeFor(' + JSON.stringify(Q) + ', "Heat", 1000)', ctx);
  assert.match(vm.runInContext('_tvBlock("answer", "Heat", ' + JSON.stringify(Q) + ')', ctx), /good conductor of heat/);
});

test('a question object is read through its blocks', async () => {
  const { ctx } = harness({ admin: false, docs: bookFor([ENTRY]) });
  ctx.QOBJ = { blocks: [{ type: 'text', content: '<p>' + Q + '</p>' }, { type: 'answer', content: 'secret' }] };
  await vm.runInContext('tvPrimeFor(QOBJ, "Heat", 1000)', ctx);
  assert.match(vm.runInContext('_tvBlock("mark", "Heat", QOBJ)', ctx), /good conductor of heat/);
});

test('the teacher lists every science entry once', async () => {
  const { ctx, reads } = harness({ admin: true, docs: bookFor([ENTRY]) });
  vm.runInContext('_tvLoadAll(); _tvLoadAll();', ctx);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(reads.filter((p) => p.endsWith('/' + TV.ENTRIES)).length, 1, 'listed once per owner');
  assert.match(vm.runInContext('_tvBlock("teach", "Heat", ' + JSON.stringify(Q) + ')', ctx), /good conductor of heat/);
});

test('a student never lists the book', async () => {
  const { ctx, reads } = harness({ admin: false, docs: bookFor([ENTRY]) });
  vm.runInContext('_tvLoadAll()', ctx);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!reads.some((p) => p.endsWith('/' + TV.ENTRIES)));
});

test('no question in hand, no block', () => {
  const { ctx } = harness({ admin: false, docs: {} });
  assert.equal(vm.runInContext('_tvBlock("teach", "Heat", "")', ctx), '');
});
