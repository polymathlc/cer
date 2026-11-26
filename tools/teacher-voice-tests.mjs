// node --test tools/teacher-voice-tests.mjs
//
// 📖 THE ANSWER BOOK (teacher-voice.js), shared byte for byte by Ans Key,
// Study Buddy (polymathlc/tutor), the Science portal (polymathlc/cer) and Scan
// (polymathlc/scan). These tests pin the matching, the store's shape, the
// reader and — the part that matters — that the teacher's OWN answer reaches
// the prompt word for word, for the right question and never another's.
//
// It runs the same in every repo: the Ans Key census only runs where
// index.html holds the answer book's glue, and the sibling comparison only
// runs where a sibling is checked out beside this one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const TV = require(path.join(root, 'teacher-voice.js'));
const P = TV.pure;

/* ------------------------------------------------------------ fixtures */
const PUDDLE_Q = 'The puddle of water on the floor became smaller after a few hours. Explain why.';
const PUDDLE_A = 'The water in the puddle gained heat from the surroundings and evaporated into water vapour.';
const APPLES_Q = 'Ali had 24 apples. He gave 1/3 of them to his sister. How many apples did he have left?';
const APPLES_A = '1/3 of 24 = 8\n24 - 8 = 16\nAns: 16 apples';
const APPLES36_Q = 'Ali had 36 apples. He gave 1/3 of them to his sister. How many apples did he have left?';
const MAGNET_Q = 'Why does the steel paper clip stick to the magnet but the copper coin does not?';
const MAGNET_A = 'Steel is a magnetic material so it is attracted to the magnet. Copper is a non-magnetic material.';

function entry(o) {
  return P.cleanEntry(Object.assign({
    k: P.slotKey(o.doc || 'doc1', o.ref || ('p1:q' + (o.n || '1'))),
    src: 'typed', lvl: 'P5', sub: 'science', ws: 'Heat test', doc: o.doc || 'doc1', page: 1,
    at: '2026-11-20T10:00:00.000Z'
  }, o));
}

/* A Firestore of plain objects, addressed the way the reader asks. */
function fakeStore(entries) {
  const docs = {};
  const owner = 'teacher-uid';
  const buckets = {};
  const rowsBy = {};
  entries.forEach(e => {
    docs[['users', owner, TV.COLL, TV.BOOK_DOC, TV.ENTRIES, e.id].join('/')] = e;
    (rowsBy[e.bucket] = rowsBy[e.bucket] || []).push(P.rowOf(e));
  });
  Object.keys(rowsBy).forEach(b => {
    docs[['users', owner, TV.COLL, P.indexDocId(b)].join('/')] = { v: 1, bucket: b, rows: P.upsertRows([], rowsBy[b], []) };
    buckets[b] = { n: rowsBy[b].length };
  });
  docs[['users', owner, TV.COLL, TV.INDEX_DOC].join('/')] = { v: 1, buckets };
  const reads = [];
  return {
    owner, docs, reads,
    env(ownerFn) {
      return {
        owner: ownerFn || (() => owner),
        getDoc: segs => { const k = segs.join('/'); reads.push(k); return Promise.resolve(docs[k] || null); },
        log: () => {}
      };
    }
  };
}

/* ------------------------------------------------------------ matching */
test('the same question, worded a little differently, is the same', () => {
  assert.equal(P.relation(PUDDLE_Q, 'A puddle of water on the floor became smaller after some hours. Explain why. [2]'), 'same');
});
test('the same words with different numbers is a question LIKE it, never the same', () => {
  assert.equal(P.relation(APPLES_Q, APPLES36_Q), 'similar');
  assert.equal(P.sameNumbers(APPLES_Q, APPLES36_Q), false);
});
test('an unrelated question is neither', () => {
  assert.equal(P.relation(PUDDLE_Q, MAGNET_Q), '');
});
test('a mark in brackets is not a number in the question', () => {
  assert.equal(P.numbersOf('Explain why. [2]').length, 0);
  assert.equal(P.numbersOf('Explain why. (2 marks)').length, 0);
});
test('word endings fold (evaporates / evaporation)', () => {
  assert.equal(P.stem('evaporates'), P.stem('evaporation'));
});
test('a short label can never match anything', () => {
  assert.equal(P.relation('Q1', 'Q2'), '');
  assert.equal(P.relation('Explain.', 'Explain why the water evaporated so fast.'), '');
});

/* ------------------------------------------------------------ the store */
test('an entry is keyed by WHERE it is, so a rewrite replaces it', () => {
  const a = entry({ n: '3', q: PUDDLE_Q, a: PUDDLE_A });
  const b = entry({ n: '3', q: PUDDLE_Q, a: 'Rewritten: the water evaporated.' });
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, entry({ n: '4', q: PUDDLE_Q, a: PUDDLE_A }).id);
});
test('the bucket is level and subject', () => {
  assert.equal(P.bucketOf('P5', 'science'), 'p5-science');
  assert.equal(P.bucketOf('', ''), 'any-any');
});
test('an entry is refused without an answer and capped in length', () => {
  assert.equal(P.cleanEntry({ k: 'x', q: 'q', a: '' }), null);
  const e = P.cleanEntry({ k: 'x', q: 'q', a: 'a'.repeat(TV.A_CHARS * 2) });
  assert.ok(e.a.length <= TV.A_CHARS);
});
test('an index row carries the question and NEVER the answer', () => {
  const r = P.rowOf(entry({ q: PUDDLE_Q, a: PUDDLE_A }));
  assert.equal(r.a, undefined);
  assert.ok(!JSON.stringify(r).includes('gained heat'));
});
test('upsertRows replaces by id, removes, and caps', () => {
  const e = entry({ q: PUDDLE_Q, a: PUDDLE_A });
  let rows = P.upsertRows([], [P.rowOf(e)], []);
  rows = P.upsertRows(rows, [P.rowOf(e)], []);
  assert.equal(rows.length, 1);
  assert.equal(P.upsertRows(rows, [], [e.id]).length, 0);
  const many = Array.from({ length: TV.ROWS_MAX + 30 }, (_, i) => P.rowOf(entry({ n: String(i), ref: 'q' + i, q: 'Question number ' + i + ' about heat and light and plants', a: 'x y' })));
  assert.equal(P.upsertRows([], many, []).length, TV.ROWS_MAX);
});

/* ------------------------------------------------------------ the block */
test('THE TEACHER\'S OWN ANSWER reaches the prompt word for word', () => {
  const e = entry({ q: PUDDLE_Q, a: PUDDLE_A });
  const picked = P.pick([e], { q: 'A puddle of water on the floor became smaller after some hours. Explain why.', sub: 'science' });
  assert.equal(picked.same.length, 1);
  const b = P.block('answer', picked);
  assert.ok(b.includes(PUDDLE_A), b);
  assert.ok(b.includes('THE TEACHER HAS ALREADY ANSWERED THIS QUESTION'));
});
test('every kind gets its own instruction, and writing a question gets none', () => {
  const picked = P.pick([entry({ q: PUDDLE_Q, a: PUDDLE_A })], { q: PUDDLE_Q });
  assert.match(P.block('mark', picked), /model answer/);
  assert.match(P.block('teach', picked), /their steps/);
  assert.match(P.block('hint', picked), /NEVER state its final answer/);
  assert.equal(P.block('gen', picked), '');
  assert.match(P.block('something-new', picked), /model answer/, 'an unknown kind is treated as marking');
});
test('a question like it lends its METHOD and is told its numbers are another question\'s', () => {
  const picked = P.pick([entry({ sub: 'math', q: APPLES_Q, a: APPLES_A })], { q: APPLES36_Q, sub: 'math' });
  assert.equal(picked.same.length, 0);
  assert.equal(picked.similar.length, 1);
  const b = P.block('answer', picked);
  assert.ok(b.includes('A QUESTION LIKE THIS ONE'));
  assert.match(b, /never copy them/);
});
test('another subject\'s answer is never used', () => {
  const picked = P.pick([entry({ sub: 'math', q: PUDDLE_Q, a: PUDDLE_A })], { q: PUDDLE_Q, sub: 'science' });
  assert.equal(picked.same.length + picked.similar.length, 0);
});
test('an excluded answer is held out (the Voice check\'s rule)', () => {
  const e = entry({ q: PUDDLE_Q, a: PUDDLE_A });
  assert.equal(P.pick([e], { q: PUDDLE_Q, exclude: [e.id] }).same.length, 0);
});
test('nothing to say costs nothing', () => {
  assert.equal(P.block('answer', P.pick([], { q: PUDDLE_Q })), '');
});
test('the block is bounded', () => {
  const list = Array.from({ length: 40 }, (_, i) => entry({ n: String(i + 1), ref: 'q' + i, q: 'Question ' + (i + 1) + ' on page about plants and water ' + i, a: 'word '.repeat(300) }));
  const b = P.block('answer', { same: [], similar: [], paper: list });
  assert.ok(b.length <= TV.BLOCK_CHARS);
});

/* ------------------------------------------------------------ the reader */
test('a paper opened on a student\'s device fetches the teacher\'s answers to ITS questions only', async () => {
  const mine = entry({ n: '1', q: PUDDLE_Q, a: PUDDLE_A });
  const other = entry({ n: '2', ref: 'p1:q2', q: MAGNET_Q, a: MAGNET_A });
  const store = fakeStore([mine, other]);
  const r = TV.reader(store.env());
  const page = '1. ' + PUDDLE_Q + ' ____________ 2. Name two things that are living.';
  const n = await r.primePaper([page], { key: 'docX', lvl: 'P5', sub: 'science' });
  assert.equal(n, 1);
  const b = r.block('mark', { key: 'docX' });
  assert.ok(b.includes(PUDDLE_A));
  assert.ok(!b.includes(MAGNET_A), 'an answer to a question not on this paper');
  assert.equal(r.block('mark', { key: 'another paper' }), '', 'another paper never gets this one\'s answers');
  assert.ok(store.reads.every(k => k.startsWith('users/teacher-uid/aiTraining/')));
});
test('one question asked about on a student\'s device is answered from the book', async () => {
  const store = fakeStore([entry({ q: PUDDLE_Q, a: PUDDLE_A })]);
  const r = TV.reader(store.env());
  await r.primeQuestion(PUDDLE_Q, { lvl: 'P5', sub: 'science' });
  assert.ok(r.block('teach', { q: PUDDLE_Q, sub: 'science' }).includes(PUDDLE_A));
});
test('a P5 paper set to a P6 class still finds the P5 answer (same subject, any level)', async () => {
  const store = fakeStore([entry({ q: PUDDLE_Q, a: PUDDLE_A, lvl: 'P5' })]);
  const r = TV.reader(store.env());
  await r.primeQuestion(PUDDLE_Q, { lvl: 'P6', sub: 'science' });
  assert.ok(r.block('answer', { q: PUDDLE_Q, sub: 'science' }).includes(PUDDLE_A));
});
test('ANOTHER ACCOUNT on the device drops every answer the last one fetched', async () => {
  let who = 'teacher-uid';
  const store = fakeStore([entry({ q: PUDDLE_Q, a: PUDDLE_A })]);
  const r = TV.reader(store.env(() => who));
  await r.primeQuestion(PUDDLE_Q, { sub: 'science' });
  assert.equal(r.count(), 1);
  who = 'someone-else';
  assert.equal(r.count(), 0);
  assert.equal(r.block('answer', { q: PUDDLE_Q }), '');
});
test('a refused read is not an error worth throwing', async () => {
  const r = TV.reader({ owner: () => 'u', getDoc: () => Promise.reject(new Error('permission-denied')) });
  assert.equal(await r.primePaper(['anything'], { key: 'k' }), 0);
  assert.equal(r.block('answer', { key: 'k' }), '');
});
test('the teacher\'s own device can load everything at once', async () => {
  const r = TV.reader({ owner: () => 'u', getDoc: () => Promise.resolve(null), listEntries: () => Promise.resolve([entry({ q: PUDDLE_Q, a: PUDDLE_A })]) });
  assert.equal(await r.loadAll(), 1);
  assert.ok(r.block('answer', { q: PUDDLE_Q }).includes(PUDDLE_A));
});

/* ------------------------------------------------------------ the score */
test('the Voice check score: the same answer is 100, a stranger\'s answer is low', () => {
  assert.equal(P.compare(PUDDLE_A, PUDDLE_A).score, 100);
  const near = P.compare(PUDDLE_A, 'The water gained heat from the surroundings and evaporated.').score;
  const far = P.compare(PUDDLE_A, 'Because of the weather the floor dried.').score;
  assert.ok(near > 60, 'near ' + near);
  assert.ok(far < 30, 'far ' + far);
  assert.ok(near > far);
});
test('the Voice check samples real questions, across buckets', () => {
  const list = [
    entry({ q: PUDDLE_Q, a: PUDDLE_A }),
    entry({ ref: 'm', sub: 'math', q: APPLES_Q, a: APPLES_A }),
    entry({ ref: 'x', q: 'Q1', a: 'yes' })
  ];
  const s = P.checkSample(list, 8, 0);
  assert.equal(s.length, 2);
  assert.deepEqual(new Set(s.map(e => e.bucket)), new Set(['p5-science', 'p5-math']));
});

/* ------------------------------------------------------------ siblings */
const SIBLINGS = ['anskey', 'tutor', 'cer', 'scan'];
test('teacher-voice.js is byte for byte the same in every app checked out beside this one', () => {
  const mine = fs.readFileSync(path.join(root, 'teacher-voice.js'), 'utf8');
  let compared = 0;
  for (const name of SIBLINGS) {
    for (const base of [path.resolve(root, '..', name), path.resolve(root, '..', 'polymathlc', name)]) {
      const f = path.join(base, 'teacher-voice.js');
      if (path.resolve(base) === root || !fs.existsSync(f)) continue;
      assert.equal(fs.readFileSync(f, 'utf8'), mine, f + ' has drifted');
      compared++;
      break;
    }
  }
  if (!compared) console.log('  (no sibling checked out — nothing to compare)');
});

/* ------------------------------------------------------------ Ans Key's glue */
const html = fs.existsSync(path.join(root, 'index.html')) ? fs.readFileSync(path.join(root, 'index.html'), 'utf8') : '';
const isAnsKey = html.includes('function abHarvestOnSave(');
const ak = isAnsKey ? test : test.skip;
function fnBody(name) {
  const s = html.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(s >= 0, name + ' exists');
  const open = html.indexOf('{', s);
  let d = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') d++;
    else if (html[i] === '}' && --d === 0) return html.slice(s, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

ak('Ans Key loads the shared file before its script', () => {
  const tag = html.indexOf('<script src="teacher-voice.js');
  assert.ok(tag > 0);
  assert.ok(tag < html.indexOf('var APP_VERSION'));
});
ak('aiGrounding appends the answer book for every kind', () => {
  const g = fnBody('aiGrounding');
  assert.match(g, /abGroundingBlock\(kind, opts\)/);
  assert.match(g, /!guide && !notes && !style && !voice/);
  assert.match(g, /guide \+ notes \+ style \+ voice \+ authority/);
});
ak('BOTH save paths file the typed answers, after the annotations are written', () => {
  for (const name of ['performSave', 'autoSave']) {
    const b = fnBody(name);
    const w = b.indexOf('writeAnnotations(');
    const h = b.indexOf('abHarvestOnSave()');
    assert.ok(w > 0 && h > w, name);
  }
});
ak('both read paths file the handwriting they read', () => {
  assert.match(fnBody('styleLearnOpenWorksheet'), /abFileRead\(pairs/);
  assert.match(fnBody('autoLearnRunJob'), /abFileRead\(got\.pairs/);
});
ak('a page built primes the book, and an account change clears it', () => {
  assert.match(fnBody('buildPagesFromBytes'), /abPrimeSoon\(\)/);
  assert.match(fnBody('stopTeachingNotes'), /abRoleChanged\(\)/);
});
ak('only the teacher writes, never as a handed-over device', () => {
  assert.match(fnBody('abFile'), /isAdmin\(currentUser\) \|\| actingStudent/);
  assert.match(fnBody('abHarvestOnSave'), /styleHarvestAllowed\(\)/);
  assert.match(fnBody('abFileRead'), /styleHarvestAllowed\(\)/);
});
ak('a deliberate mistake and a living question are never filed as an answer', () => {
  const b = fnBody('abTypedEntries');
  assert.match(b, /annHoldsMistake\(a\)/);
  assert.match(b, /annLivingQuestion/);
});
ak('the window writes with textContent only', () => {
  const s = html.indexOf('📖 THE ANSWER BOOK — the teacher');
  const e = html.indexOf('End answer book', s);
  assert.ok(e > s);
  assert.ok(!/innerHTML/.test(html.slice(s, e)));
});
ak('THE VOICE CHECK HIDES THE ANSWER IT IS SCORING from the book AND the style', () => {
  const b = fnBody('abVoiceCheck');
  assert.match(b, /ground\(true, true\)/);
  assert.match(b, /ground\(twins, true\)/);
  assert.match(fnBody('styleExemplarsFor'), /styleHeldOut\(s\)/);
  assert.match(fnBody('styleRecentEdits'), /styleHeldOut\(e\)/);
  assert.match(fnBody('abGroundingBlock'), /abExcludeNow === true/);
});
ak('the reading prompts ask for the question number and the question as printed', () => {
  const read = html.slice(html.indexOf('var STYLE_READ_SYS'), html.indexOf('async function styleLearnOpenWorksheet'));
  assert.match(read, /"n":"the question number/);
  const auto = html.slice(html.indexOf('var AUTO_READ_SYS'), html.indexOf('async function autoLearnRunJob'));
  assert.match(auto, /\{"n":"","q":"","a":""\}/);
});

/* abQuestionAt, run for real out of the page. */
ak('a typed answer is matched to the question printed above it', () => {
  const src = ['var AB_QNUM_BELOW', 'var AB_SUBPART_RE', 'function abLinesOf', 'function abQuestionAt'].map(m => {
    const s = html.indexOf(m);
    assert.ok(s >= 0, m);
    if (m.startsWith('var')) return html.slice(s, html.indexOf('\n', s));
    return fnBody(m.slice(9));
  }).join('\n');
  const ctx = {};
  vm.runInNewContext(src + '\nthis.f = abQuestionAt;', ctx);
  const items = [
    { str: '1.', x: 40, y: 100 }, { str: 'The puddle became smaller. Explain why.', x: 60, y: 100 },
    { str: '2.', x: 40, y: 300 }, { str: 'Ali had 24 apples.', x: 60, y: 300 },
    { str: '(a)', x: 60, y: 330 }, { str: 'How many left?', x: 80, y: 330 },
    { str: '(b)', x: 60, y: 400 }, { str: 'How many given?', x: 80, y: 400 },
    { str: '1.5 kg', x: 40, y: 450 }
  ];
  const q1 = ctx.f(items, 160, 600);
  assert.equal(q1.n, '1');
  assert.match(q1.q, /puddle/);
  assert.equal(ctx.f(items, 350, 600).n, '2a');
  assert.equal(ctx.f(items, 420, 600).n, '2b');
  assert.equal(ctx.f(items, 470, 600).n, '2b', '"1.5 kg" is not question 1');
  assert.equal(ctx.f(items, 40, 600), null, 'above every question there is none');
});
