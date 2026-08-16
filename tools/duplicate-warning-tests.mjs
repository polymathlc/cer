// Regression tests for THE DUPLICATE WARNING.
// Run with:
//     node tools/duplicate-warning-tests.mjs            all cases
//     node tools/duplicate-warning-tests.mjs <name>     one case
//
// It loads the REAL matcher out of app.js and runs it over synthetic
// questions. Every way this can break is silent — the app works perfectly
// either way, and the only symptom is the same question sitting in the bank
// twice with nobody able to say when it got there:
//
//  • TOO TIGHT AND IT NEVER FIRES. A question re-read from the same paper is
//    never worded byte-for-byte the same (a different crop, a stray page
//    number, one option retyped), so an exact-match check catches nothing at
//    all while looking like it works.
//  • TOO LOOSE AND IT ALWAYS FIRES. Two questions on one topic share most of
//    their words; a warning that appears on every save is a warning nobody
//    reads, and the real duplicate goes through with it.
//  • THE VETTING LIST MUST BE SEARCHED TOO. The commonest duplicate of all is
//    the same screenshot read twice in one sitting — and both copies are then
//    in vetting, where a bank-only search sees neither.
//  • A QUESTION MUST NOT MATCH ITSELF. Re-saving an edit would otherwise warn
//    every time, against the very question being edited.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

// Only what the matcher itself reaches for. `_docQParts` / `_docNorm` are the
// Question Doctor's own normalisation and are stubbed to something equivalent
// but fixed, so a change to the Doctor cannot move these results.
const FIXTURE = `
let questionBank = [];
let vettingList = [];
function _docNorm(s) {
  return String(s || '').toLowerCase().replace(/<[^>]*>/g, ' ').replace(/[^a-z0-9\\s]/g, ' ').replace(/\\s+/g, ' ').trim();
}
function _docQParts(q) {
  const blocks = (q && q.blocks) || [];
  const text = blocks.filter(b => b && b.type === 'text').map(b => b.content || '').join(' ');
  const mcq = blocks.find(b => b && b.type === 'mcq') || null;
  return { title: (q && q.title) || '', text, mcq: mcq ? { options: mcq.options || [] } : null };
}
`;

const block = cut('function _dupTokenSet(q) {', '\n// Stamp q._dupOf', 'matcher');

const M = new Function(FIXTURE + block + `
return {
  find: findDuplicateCandidate,
  where: _dupWhereLabel,
  stillThere: _dupStillThere,
  MIN: DUP_MIN_SCORE,
  seed(bank, vetting) { questionBank = bank || []; vettingList = vetting || []; },
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};

const q = (id, title, text, options) => ({
  id, title,
  blocks: [{ type: 'text', content: text }].concat(options ? [{ type: 'mcq', options: options.map(t => ({ text: t })) }] : [])
});

// A real pair: the same question read off the paper twice, differing only in
// the ways a second read of the same page actually differs.
const ORIGINAL = q('a1', 'Photosynthesis and light',
  'A plant was placed in a dark cupboard for two days. Explain why the leaves turned yellow after this time.',
  ['it lost water', 'it could not make food', 'it grew too fast', 'it was too cold']);
const RE_READ = q('a2', 'Photosynthesis & light',
  '12. A plant was placed in a dark cupboard for two days. Explain why the leaves turned yellow after this time.',
  ['it lost water', 'it could not make food', 'it grew too fast', 'it was too cold']);
// Same topic, same vocabulary, genuinely different question.
const SIBLING = q('b1', 'Photosynthesis and water',
  'A plant was watered with salty water for two days. Explain why the leaves wilted after this time and what the plant needed instead.',
  ['it lost water', 'it made too much food', 'it grew too fast', 'the roots could not absorb water']);

// ── it fires when it should ─────────────────────────────────────────────────

test('the same question read twice is flagged', () => {
  M.seed([ORIGINAL], []);
  const d = M.find(RE_READ);
  ok(d, 'a re-read of the same question was not flagged');
  eq(d.id, 'a1', 'the twin it named');
  ok(d.pct >= 70, 'the reported match was under the threshold: ' + d.pct);
});

test('the match is reported as a PERCENTAGE the author can weigh', () => {
  M.seed([ORIGINAL], []);
  const d = M.find(RE_READ);
  ok(Number.isFinite(d.pct) && d.pct > 0 && d.pct <= 100, 'pct is not a sane percentage: ' + d.pct);
});

// ── it stays quiet when it should ───────────────────────────────────────────

test('two different questions on the SAME topic are not flagged', () => {
  // The false positive that matters: a warning on every save is one nobody
  // reads, and the real duplicate goes through behind it.
  M.seed([SIBLING], []);
  ok(!M.find(ORIGINAL), 'two genuinely different questions were called duplicates');
});

test('a question never matches ITSELF', () => {
  // Re-saving an edit would otherwise warn against the question being edited.
  M.seed([ORIGINAL], []);
  ok(!M.find(ORIGINAL), 'a question matched itself');
});

test('an explicit excludeId wins over the question own id', () => {
  M.seed([ORIGINAL], []);
  const copy = Object.assign({}, RE_READ, { id: null });
  ok(!M.find(copy, 'a1'), 'excludeId was ignored');
});

test('a question too short to judge is never flagged', () => {
  M.seed([ORIGINAL], []);
  ok(!M.find(q('z', 'Hi', 'ok')), 'a two-word question was matched on nothing');
});

test('an empty bank and an empty vetting list flag nothing', () => {
  M.seed([], []);
  ok(!M.find(RE_READ), 'something was found in two empty lists');
});

// ── the vetting list is searched too ────────────────────────────────────────

test('a twin waiting in VETTING is found', () => {
  // The headline gap: the same screenshot read twice in one sitting puts both
  // copies in vetting, where a bank-only search sees neither.
  M.seed([], [ORIGINAL]);
  const d = M.find(RE_READ);
  ok(d, 'a twin in the vetting list was not found');
  eq(d.where, 'vetting', 'where the twin was reported to be');
});

test('a twin in the BANK is reported as being in the bank', () => {
  M.seed([ORIGINAL], []);
  eq(M.find(RE_READ).where, 'bank', 'where the twin was reported to be');
});

test('the CLOSER of two twins wins, whichever list it is in', () => {
  const loose = q('c1', 'Photosynthesis and light',
    'A plant was placed in a dark cupboard for two days. Explain what happened to it.', ['a', 'b']);
  M.seed([loose], [ORIGINAL]);
  eq(M.find(RE_READ).id, 'a1', 'the closer twin did not win');
});

test('each list is named in words, and only vetting reads as vetting', () => {
  // The three messages that say it — badge, banner, save dialog — all come
  // through here, so they cannot drift apart.
  ok(/vetting/i.test(M.where({ where: 'vetting' })), 'a vetting twin is not described as being in vetting');
  ok(/bank/i.test(M.where({ where: 'bank' })), 'a bank twin is not described as being in the bank');
  ok(/bank/i.test(M.where(null)), 'an unknown origin should read as the bank, not blank');
});

// ── the suspected original has to still be there ────────────────────────────

test('a twin still in either list is still shown', () => {
  M.seed([ORIGINAL], []);
  ok(M.stillThere({ id: 'a1' }), 'a twin in the bank was treated as gone');
  M.seed([], [ORIGINAL]);
  ok(M.stillThere({ id: 'a1' }), 'a twin in vetting was treated as gone');
});

test('a twin that has been DELETED stops being shown', () => {
  // Otherwise the card points at a question that is not there any more, and
  // "See original" opens nothing.
  M.seed([], []);
  ok(!M.stillThere({ id: 'a1' }), 'a deleted twin was still shown');
  ok(!M.stillThere(null), 'a missing marker was treated as a live twin');
  ok(!M.stillThere({}), 'a marker with no id was treated as a live twin');
});

// ── the threshold ───────────────────────────────────────────────────────────

test('the threshold is a named constant, in the sane middle of the range', () => {
  ok(M.MIN > 0.5 && M.MIN < 0.95, 'DUP_MIN_SCORE is outside the useful range: ' + M.MIN);
});

// ── runner ───────────────────────────────────────────────────────────────────

const only = process.argv[2];
let passed = 0, failed = 0;
for (const c of cases) {
  if (only && c.name !== only) continue;
  try { await c.fn(); console.log('  ok   ' + c.name); passed++; }
  catch (err) { console.log('  FAIL ' + c.name + '\n         ' + err.message); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
