// 🔢 Question numbers — run with: node --test tools/question-numbers-tests.mjs
// Loads the REAL pure section out of app.js and checks the rules every
// number lives by: given once, never changed by an edit, never shared, and
// found exactly by "#123" in every search box that uses parseSearchTokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cut = (from, to) => {
  const a = src.indexOf(from); const b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, 'section not found: ' + from);
  return src.slice(a, b);
};
const pure = cut('/* ================= 🔢 Question numbers =================', '/* ================= End question numbers (pure)');
const parse = cut('function parseSearchTokens(raw) {', '\n}\n') + '\n}\n';
const ctx = {};
vm.createContext(ctx);
vm.runInContext(pure + parse + ';this.api={qNoValid,qNoLabel,qNoSearchText,qNoParseToken,qNoPick,qNoPlanBackfill,parseSearchTokens};', ctx);
const A = ctx.api;
const plain = v => JSON.parse(JSON.stringify(v));

test('a number is a positive whole number, shown as #N', () => {
  assert.ok(A.qNoValid(1) && A.qNoValid(123));
  for (const bad of [0, -1, 1.5, '3', null, undefined, NaN, 1e9]) assert.ok(!A.qNoValid(bad), String(bad));
  assert.equal(A.qNoLabel({ qno: 42 }), '#42');
  assert.equal(A.qNoLabel({}), '');
  assert.equal(A.qNoSearchText({ qno: 42 }), '#42#');
});

test('"#12" searches for number 12 exactly, never #123', () => {
  assert.equal(A.qNoParseToken('#12'), 12);
  assert.equal(A.qNoParseToken('Q#12'), 12);
  assert.equal(A.qNoParseToken('12'), null, 'a bare number stays a word search');
  assert.equal(A.qNoParseToken('#x'), null);
  const tokens = plain(A.parseSearchTokens('#12 heat'));
  assert.deepEqual(tokens, ['#12#', 'heat']);
  assert.ok(!'#123# heat'.includes(tokens[0]));
  assert.ok('#12# heat'.includes(tokens[0]));
});

test('a new question takes the next number after everything in use', () => {
  const bank = [{ id: 'a', qno: 1 }, { id: 'b', qno: 7 }, { id: 'c' }];
  assert.equal(A.qNoPick({ id: 'n' }, null, bank, []), 8);
  assert.equal(A.qNoPick({ id: 'n' }, null, bank, [9]), 10, 'numbers already handed out this session are skipped');
  assert.equal(A.qNoPick({ id: 'n' }, null, [], []), 1);
});

test('an edit keeps its number, and a copy never shares its source’s', () => {
  const bank = [{ id: 'a', qno: 5 }, { id: 'b', qno: 6 }];
  // An edit rebuilt from the editor has no number: the stored copy's is kept.
  assert.equal(A.qNoPick({ id: 'a' }, { id: 'a', qno: 5 }, bank.filter(o => o.id !== 'a'), []), 5);
  // A clone of b arrives carrying 6, which b holds.
  assert.equal(A.qNoPick({ id: 'clone', qno: 6 }, null, bank, []), 7);
  // A question carrying a free number keeps it.
  assert.equal(A.qNoPick({ id: 'z', qno: 40 }, null, bank, []), 40);
});

test('the backfill numbers the rest oldest first, and the oldest keeps a clashing number', () => {
  const t = q => q.t;
  const list = [
    { id: 'new', t: 300 },
    { id: 'old', t: 100 },
    { id: 'numbered', t: 50, qno: 3 },
    { id: 'clashOld', t: 10, qno: 9 },
    { id: 'clashNew', t: 400, qno: 9 },
    { id: 'mid', t: 200 },
  ];
  const plan = plain(A.qNoPlanBackfill(list, t));
  assert.deepEqual(plan, [
    { id: 'old', qno: 10 }, { id: 'mid', qno: 11 }, { id: 'new', qno: 12 }, { id: 'clashNew', qno: 13 },
  ]);
  assert.deepEqual(plain(A.qNoPlanBackfill([{ id: 'a', qno: 1 }, { id: 'b', qno: 2 }], t)), [], 'nothing to do');
  // The same question in the bank and in vetting is ONE question, not a clash.
  assert.deepEqual(plain(A.qNoPlanBackfill([{ id: 'a', qno: 4, t: 1 }, { id: 'a', qno: 4, t: 1 }], t)), []);
  assert.deepEqual(plain(A.qNoPlanBackfill([{ id: 'a', t: 1 }, { id: 'a', t: 1 }], t)), [{ id: 'a', qno: 1 }]);
});

test('the app gives, keeps, shows and searches the number', () => {
  assert.match(src, /async function saveQuestion\(q, opts\) \{\n  if \(!currentUser\) return false;\n  migrateDecisionsReviewState\(q\);\n  qNoEnsure\(q\);/,
    'saveQuestion numbers the question before it copies it');
  assert.match(src, /async function saveVettingQuestion\(q, opts\) \{[\s\S]{0,120}qNoEnsure\(q\);/);
  assert.match(src, /parts\.push\(qNoSearchText\(q\)\);/, 'the shared search text carries the number');
  assert.match(src, /qNoBackfill\(\);/, 'a load numbers the questions without one');
  assert.ok((src.match(/\$\{qNoChipHtml\(q\)\}/g) || []).length >= 3, 'bank card, bank tile and vetting card show it');
  assert.ok(!/EDITOR_OWNED_QUESTION_FIELDS = new Set\(\[[^\]]*'qno'/.test(src), 'qno is carried over on an edit, never owned by the editor');
  assert.match(html, /\.qb-qno \{/);
  assert.match(html, /#123 for a question number/);
});
