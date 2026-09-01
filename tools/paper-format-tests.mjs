// Regression tests for 📋 FORMAT CHECK — every past-paper question dressed
// for the paper.
// Run with:
//     node tools/paper-format-tests.mjs            all cases
//     node tools/paper-format-tests.mjs <name>     one case
//
// It loads the REAL `pf*` section out of app.js, together with the real part
// vocabulary and marks reader it leans on, and runs them against stubs.
//
// EVERY FAILURE HERE IS SILENT. A question that fails one of the three checks
// still builds, renders and prints — the gap is found by whoever is holding
// the printed key in front of a class. So the report has to be right in BOTH
// directions:
//
//  • Too timid and a real gap is reported as complete, which is the paper
//    printed with a part the key has nothing to say about, or no number to
//    budget by, or no keywords for the drill to punch out.
//  • Too eager and it raises a finding nobody can act on — "no keywords" on a
//    multiple-choice question with nowhere to put one — and that is the row
//    that makes the real ones get clicked past.
//  • "Marks on a part" means the part's OWN text or a text UNDER it, and only a
//    TEXT block: an answer box never counts.
//  • A question with nothing attached is NAMED, never dropped — a report that
//    quietly leaves it out reads as a clean paper.
//  • It is plain code and it reads only. No AI, no write.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b);
};

const PRELUDE = `
let questionBank = [];
let paperMap = {};
let ppData = { questions: [] };
let currentUser = { role: 'admin' };
const HOOK = { toasts: [], edited: [], em: null, closed: 0 };
function stripHtml(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, ''); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showToast(msg, kind) { HOOK.toasts.push({ msg, kind }); }
function generateBlockId() { return 'g' + Math.random().toString(36).slice(2, 8); }
function _docQById(id) { return questionBank.find(q => q.id === id); }
function ppQuestions() { return ppData.questions; }
function ppBankQ(id) { const b = paperMap[id]; return b ? questionBank.find(q => q.id === b) : null; }
function ppIsAdmin() { return !!(currentUser && currentUser.role === 'admin'); }
function ppHoverHide() {}
function editQuestionFromPapers(bankId, ppId) { HOOK.edited.push([bankId, ppId]); }
function emOpenPaper(items, missing, title) { HOOK.em = { items, missing, title }; }
// Keywords: the real gate asks kwBlockTakesKeywords + qKwIndices; here a
// block "takes" keywords when it is an answer box, and "has" them when the
// question's answerKeywords map names it.
function kwBlockTakesKeywords(b) { return !!b && (b.type === 'plainanswer' || b.type === 'answer'); }
function qHasKeywords(q) {
  const kw = (q && q.answerKeywords) || {};
  return ((q && q.blocks) || []).some(b => kwBlockTakesKeywords(b) && Object.keys(kw).some(k => k.indexOf(String(b.id)) === 0 && Object.keys(kw[k] || {}).length));
}
const document = { getElementById: () => null };
// The report painter needs a DOM and has its own eyes on it; here it only has
// to exist.
function pfRender() {}
`;

const section =
  cut('const QPART_LETTERS', 'function qPartsUsed', 'part core') +
  cut('function qPartsUsed', 'function qPartOf(map, block)', 'part spans') +
  cut('function qPartOf(map, block)', '\n// The next unused letter', 'partOf + opens') +
  cut('function qMarksOf(b) {', '// The bracket convention', 'marks reader') +
  cut('function qPartsWithoutExplanation(blocks) {', '\n// "(a) … <br> (b) …"', 'parts without explanation') +
  cut('const PF_KINDS = [', '\n// ── The report', 'format check');

const M = new Function(PRELUDE + section + `
return { HOOK, PF_KINDS,
  partsWithoutMarks: pfPartsWithoutMarks, partsWithoutExplanation: pfPartsWithoutExplanation,
  check: pfCheckQuestion, items: pfCheckItems, summary: pfSummary,
  checkYear: pfCheckYear, checkAll: pfCheckAll, editOne: pfEditOne, editFlagged: pfEditFlagged,
  setBank: v => { questionBank = v; }, setMap: v => { paperMap = v; }, setPapers: v => { ppData = { questions: v }; },
  setRole: r => { currentUser = { role: r }; },
  rows: () => _pfRows,
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};

let n = 0;
const text = (part, marks, content) => Object.assign({ id: 'b' + (++n), type: 'text', content: content || '<p>Ask.</p>' }, part ? { part } : {}, marks ? { marks } : {});
const ans = () => ({ id: 'b' + (++n), type: 'plainanswer', content: 'Because.' });
const mcq = () => ({ id: 'b' + (++n), type: 'mcq', options: [{ id: 'o1', text: 'x' }, { id: 'o2', text: 'y' }], correctId: 'o1' });
const expl = (part, content) => Object.assign({ id: 'b' + (++n), type: 'explanation', content: content == null ? 'A note.' : content }, part ? { part } : {});
const Q = (blocks, extra) => Object.assign({ id: 'q' + (++n), title: 'A question', blocks }, extra || {});
const kw = (q, block) => { q.answerKeywords = Object.assign(q.answerKeywords || {}, { [block.id]: { 2: true } }); return q; };
const kinds = r => r.issues.map(i => i.kind);

// ---- marks -----------------------------------------------------------------
test('a part is marked when its OWN text carries the marks', () => {
  eq(M.partsWithoutMarks([text('a', 2), ans(), text('b', 3), ans()]), [], 'both parts marked');
});
test('…or when a text block UNDER it does', () => {
  // The part opens on one text and the marks are printed on the sentence
  // below it — the commonest shape on a PSLE paper.
  eq(M.partsWithoutMarks([text('a'), text('', 2), ans(), text('b'), text('', 1), ans()]), [], 'marks on the text under each opener');
});
test('a part with marks nowhere is named', () => {
  eq(M.partsWithoutMarks([text('a', 2), ans(), text('b'), ans(), text('c'), text('', 1), ans()]), ['b'], 'only (b) is bare');
});
test('an answer box never counts as marks — it is not a question', () => {
  const box = Object.assign(ans(), { marks: 2 });
  eq(M.partsWithoutMarks([text('a'), box]), ['a'], 'marks on the answer box do not dress part (a)');
});
test('a mark on a roman sub-part counts for its letter', () => {
  // (b)(i) carries the number; (b) is covered — that is what qPartKeyIn is for.
  const sub = Object.assign(text('', 2), { subPart: 'i' });
  eq(M.partsWithoutMarks([text('a', 1), ans(), text('b'), sub, ans()]), [], '(b) is marked through (b)(i)');
});
test('a question with no parts is one part, and any marked text will do', () => {
  eq(M.partsWithoutMarks([text('', 3), ans()]), [], 'marked');
  eq(M.partsWithoutMarks([text(), ans()]), [''], 'not marked — reported as the whole question');
});
test('a zero or a nonsense marks value is not a mark', () => {
  eq(M.partsWithoutMarks([text('', 0), ans()]), [''], 'zero');
  eq(M.partsWithoutMarks([Object.assign(text(), { marks: 'two' }), ans()]), [''], 'not a number');
});

// ---- explanations ----------------------------------------------------------
test('every part needs its own explanation', () => {
  eq(M.partsWithoutExplanation([text('a'), ans(), expl('a'), text('b'), ans()]), ['b'], '(b) has none');
  eq(M.partsWithoutExplanation([text('a'), ans(), expl('a'), text('b'), ans(), expl('b')]), [], 'both do');
});
test('a note about the WHOLE question does not stand in for a part', () => {
  // QPART_NONE files a note under no part — it is not what a pupil reads
  // under (b). qPartsWithoutExplanation is the filler's own rule.
  eq(M.partsWithoutExplanation([text('a'), ans(), text('b'), ans(), expl('-')]), ['a', 'b'], 'both parts still bare');
});
test('an EMPTY explanation box is no explanation', () => {
  eq(M.partsWithoutExplanation([text('a'), ans(), expl('a', '<p> </p>')]), ['a'], 'blank note');
});
test('a question with no parts needs one note about the whole', () => {
  eq(M.partsWithoutExplanation([text(), ans(), expl()]), [], 'has one');
  eq(M.partsWithoutExplanation([text(), ans()]), [''], 'has none');
});

// ---- keywords --------------------------------------------------------------
test('a written answer with no keywords is flagged', () => {
  const q = Q([text('', 2), ans(), expl()]);
  eq(kinds(M.check(q)), ['keywords'], 'the one thing missing');
});
test('…and the same question with keywords is complete', () => {
  const a = ans();
  const q = kw(Q([text('', 2), a, expl()]), a);
  eq(M.check(q).ok, true, 'complete');
  eq(kinds(M.check(q)), [], 'nothing flagged');
});
test('a multiple-choice question with no written box is NOT flagged for keywords', () => {
  // There is nowhere to put one, so a finding here is a row nobody could ever
  // clear — the row that makes the real ones get clicked past. It is
  // reported as skipped instead, so the report still says why.
  const q = Q([text('', 2), mcq(), expl()]);
  const r = M.check(q);
  eq(kinds(r), [], 'no keyword finding');
  eq(r.skipped.map(s => s.kind), ['keywords'], 'said to be skipped');
  eq(r.ok, true, 'and the question is complete');
});

// ---- the whole verdict -----------------------------------------------------
test('one question can be short of all three, and each is named with its parts', () => {
  const q = Q([text('a'), ans(), text('b', 2), ans(), expl('b')]);
  const r = M.check(q);
  eq(kinds(r), ['explanation', 'keywords', 'marks'], 'all three');
  eq(r.issues[0].parts, ['a'], 'the explanation missing is (a)');
  eq(r.issues[2].parts, ['a'], 'the marks missing are on (a)');
  ok(/\(a\)/.test(r.issues[0].text) && /\(a\)/.test(r.issues[2].text), 'the wording names the part');
});
test('a fully dressed question with parts is complete', () => {
  const a1 = ans(), a2 = ans();
  const q = kw(Q([text('a', 2), a1, expl('a'), text('b'), text('', 3), a2, expl('b')]), a1);
  eq(M.check(q).ok, true, 'complete');
});

// ---- the report over a paper -----------------------------------------------
test('a question with nothing attached is NAMED, never dropped', () => {
  const a = ans();
  const good = kw(Q([text('', 2), a, expl()]), a);
  M.setBank([good]);
  M.setMap({ p1: good.id });
  const rows = M.items([{ id: 'p1', year: '2019', n: 1 }, { id: 'p2', year: '2019', n: 2 }]);
  eq(rows.length, 2, 'both questions are rows');
  eq(rows[1].attached, false, 'the second has no question attached');
  const s = M.summary(rows);
  eq([s.total, s.attached, s.unattached, s.ok, s.flagged], [2, 1, 1, 1, 0], 'the tally');
});
test('the summary counts each kind of gap once per question', () => {
  const bad = Q([text('a'), ans(), text('b'), ans()]);          // no expl, no kw, no marks
  const half = Q([text('', 2), ans(), expl()]);                 // only keywords missing
  M.setBank([bad, half]);
  M.setMap({ p1: bad.id, p2: half.id });
  const s = M.summary(M.items([{ id: 'p1', year: '2019', n: 1 }, { id: 'p2', year: '2019', n: 2 }]));
  eq([s.flagged, s.explanation, s.keywords, s.marks, s.ok], [2, 1, 2, 1, 0], 'per kind');
});
test('a year is checked in paper order, and the labels name the paper', () => {
  const q1 = Q([text(), ans()]), q2 = Q([text(), ans()]);
  M.setBank([q1, q2]);
  M.setMap({ p12: q1.id, p3: q2.id });
  M.setPapers([{ id: 'p12', year: '2018', n: 12 }, { id: 'p3', year: '2018', n: 3 }, { id: 'px', year: '2017', n: 1 }]);
  M.checkYear('2018');
  eq(M.rows().map(r => r.label), ['PSLE 2018 Q3', 'PSLE 2018 Q12'], 'sorted by number, 2017 left out');
});

// ---- every row leads somewhere ---------------------------------------------
test('✏️ on a row opens THAT question and returns to its chip', () => {
  M.HOOK.edited = [];
  const q = Q([text(), ans()]);
  M.setBank([q]);
  M.editOne(q.id, 'p9');
  eq(M.HOOK.edited, [[q.id, 'p9']], 'the page\'s own return-to-chip door');
});
test('a question that has left the bank cannot be opened', () => {
  M.HOOK.edited = []; M.HOOK.toasts = [];
  M.setBank([]);
  M.editOne('gone', 'p1');
  eq(M.HOOK.edited, [], 'nothing opened');
  ok(M.HOOK.toasts.length === 1, 'and it says so');
});
test('✏️ Fix them all opens every FLAGGED question in editing mode, and only those', () => {
  const bad = Q([text(), ans()]);
  const a = ans(); const good = kw(Q([text('', 2), a, expl()]), a);
  M.setBank([bad, good]);
  M.setMap({ p1: bad.id, p2: good.id });
  M.setPapers([{ id: 'p1', year: '2020', n: 1 }, { id: 'p2', year: '2020', n: 2 }, { id: 'p3', year: '2020', n: 3 }]);
  M.HOOK.em = null;
  M.checkYear('2020');
  M.editFlagged();
  ok(M.HOOK.em, 'editing mode was opened');
  eq(M.HOOK.em.items.map(i => i.bq.id), [bad.id], 'the complete one and the unattached one stay out');
  eq(M.HOOK.em.items[0].refs, ['PSLE 2020 Q1'], 'labelled by the paper');
});
test('a non-admin is turned away', () => {
  M.setRole('student'); M.HOOK.toasts = [];
  M.setPapers([{ id: 'p1', year: '2020', n: 1 }]);
  M.checkYear('2020');
  ok(M.HOOK.toasts.some(t => t.kind === 'error'), 'refused');
  M.setRole('admin');
});

// ---- the source itself -----------------------------------------------------
test('it is plain code that reads only — no AI, no write', () => {
  const s = cut('const PF_KINDS = [', '\n// ── The report', 'format check');
  ok(!/askGemini|saveQuestion|setDoc|updateDoc/.test(s), 'nothing asked of a model and nothing written');
});
test('it reads the SAME helpers the key is built from', () => {
  const s = cut('const PF_KINDS = [', '\n// ── The report', 'format check');
  ok(/qPartsWithoutExplanation\(/.test(s), 'the filler\'s own definition of a bare part');
  ok(/qHasKeywords\(/.test(s), 'the fill-in-the-blanks gate');
  ok(/qMarksOf\(/.test(s), 'the number the printed [2] comes from');
  ok(/qPartFind\(/.test(s), 'and the part walker, so (b)(i) counts for (b)');
});
test('the buttons are on the page and the year button only shows with something attached', () => {
  ok(/pfCheckYear\('\$\{escapeHtml\(y\)\}'\)/.test(src), 'a per-year button');
  ok(/pfCheckAll\(\)/.test(src), 'an every-paper button');
  ok(/const formatBtn = \(!edit && admin && yAssigned\)/.test(src), 'nothing to check on a year with nothing attached');
});

// ---- runner ----------------------------------------------------------------
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && !c.name.includes(only)) continue;
  try { c.fn(); pass++; console.log('  ✓ ' + c.name); }
  catch (e) { fail++; console.log('  ✗ ' + c.name + '\n      ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
