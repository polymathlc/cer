// Regression tests for 🅐 ✍️ ONE HALF OF A PAPER — practising and printing just
// the MCQ, or just the open-ended questions, of a past year paper.
// Run with:
//     node tools/paper-halves-tests.mjs            all cases
//     node tools/paper-halves-tests.mjs <name>     one case
//
// It loads the REAL `ppKind*` section out of app.js, together with the REAL
// `qIsMcqOnly` it leans on and the REAL `ppPracticeYear` / `ppPrintYear` /
// `ppAttachedBankQs` / `ppPaperHitIds` / `ppCollectPrintable` that read it.
//
// EVERY FAILURE HERE IS SILENT. The button works, a sheet comes out and a
// practice session starts — it is simply the wrong half:
//
//  • READING THE PAPER ROW'S BOOKLET instead of the attached bank question's
//    blocks hands a child an open-ended question behind ▶ Practise the multiple
//    choice, because a Booklet A row can perfectly well have an open-ended
//    question attached to it. The button looks as though it worked.
//  • A SECOND READING drifts from the first, and the tier then says "28
//    questions" over a sheet that prints 30 — found only after the printing.
//  • AN UNKNOWN KIND must mean the WHOLE portion, never nothing: a stray kind
//    can then only print more than was asked for, rather than a button that
//    silently does nothing at all.
//  • `ppPrintYear('')` must mean EVERY paper, or the All-years tiers print
//    nothing and report an empty paper.
//  • `missing` is carried through UNFILTERED — a row with nothing attached
//    belongs to neither half, and dropping it would hide a real gap.
//  • The order must stay paper order, and must be the SAME order the practice
//    queue runs in.
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
const HOOK = { toasts: [], practised: null, printed: null, previewed: null };
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showToast(msg, kind) { HOOK.toasts.push({ msg, kind }); }
function ppQuestions() { return ppData.questions; }
function ppFindQ(id) { return ppData.questions.find(q => q.id === id) || null; }
function ppBankQ(id) { const b = paperMap[id]; return b ? (questionBank.find(q => q.id === b) || null) : null; }
function ppHoverHide() {}
// The ONE practice door. Here it only has to record what it was handed — the
// release / lock / syllabus gates inside it are pinned by their own harnesses.
function launchWorksheetPractice(qs, mode, opts) { HOOK.practised = { qs, mode, opts }; }
function ppPreview(items, missing, title, opts) { HOOK.previewed = { items, missing, title, opts }; }
function ppDoPrint(items, missing, title, opts) { HOOK.printed = { items, missing, title, opts }; }
function emOpenPaper(items, missing, title, opts) { HOOK.printed = { items, missing, title, opts, edit: true }; }
`;

const section =
  cut('function qIsMcqOnly(blocks) {', '// Take a printed marks marker back out', 'qIsMcqOnly') +
  cut('function ppCollectPrintable(hitIds){', '// Cover sheet for a past-paper print', 'collect printable') +
  cut('const PP_KINDS = [', '\n// -------- printing: concepts & whole years --------', 'the halves') +
  cut('function _ppGo(go){', 'function ppPrintConcept(id, go){', 'go dispatch') +
  cut('// `y` is one year, or \'\' for EVERY past paper.', 'function ppPrintSelected(go){', 'print year') +
  cut('// Unique attached bank questions for a year', 'function ppYearLabel(year){', 'attached bank qs') +
  cut('// `kind` is \'mcq\' / \'oeq\' to run just that half', '\n// Model answer of an open-ended', 'practice year');

const M = new Function(PRELUDE + section + `
return { HOOK, PP_KINDS,
  kindDef: ppKindDef, kindOf: ppKindOf, kindFilter: ppKindFilter,
  kindBankQs: ppKindBankQs, kindCounts: ppKindCounts, kindTitle: ppKindTitle,
  hitIds: ppPaperHitIds, attached: ppAttachedBankQs,
  practiceYear: ppPracticeYear, printYear: ppPrintYear,
  setBank(b) { questionBank = b; }, setMap(m) { paperMap = m; }, setPaper(p) { ppData = { questions: p }; },
  reset() { HOOK.toasts.length = 0; HOOK.practised = null; HOOK.printed = null; HOOK.previewed = null; } };
`)();

// ── fixtures ────────────────────────────────────────────────────────────────
const mcqBlocks  = () => [{ id: 't1', type: 'text', content: 'Which one?' },
                          { id: 'm1', type: 'mcq', options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }], correctId: 'o1' }];
const openBlocks = () => [{ id: 't2', type: 'text', content: 'Explain why.' },
                          { id: 'a1', type: 'plainanswer', content: 'Because the water evaporated.' }];
// An MCQ that ALSO has somewhere to write — `qIsMcqOnly`'s "and nothing else"
// half, which makes this an open-ended question.
const bothBlocks = () => mcqBlocks().concat([{ id: 'a2', type: 'plainanswer', content: 'Explain your choice.' }]);

function world() {
  // 2017: Q1 MCQ (Booklet A), Q2 MCQ (Booklet A), Q30 open (Booklet B),
  //       Q31 a Booklet A row whose attached question is OPEN-ENDED,
  //       Q32 nothing attached at all.
  // 2018: Q1 open (Booklet B).
  M.setPaper([
    { id: 'p1', year: '2017', n: 1,  bk: 'A', type: 'recall',      marks: 2 },
    { id: 'p2', year: '2017', n: 2,  bk: 'A', type: 'application', marks: 2 },
    { id: 'p3', year: '2017', n: 30, bk: 'B', type: 'open',        marks: 4 },
    { id: 'p4', year: '2017', n: 31, bk: 'A', type: 'recall',      marks: 2 },
    { id: 'p5', year: '2017', n: 32, bk: 'B', type: 'open',        marks: 3 },
    { id: 'p6', year: '2018', n: 1,  bk: 'B', type: 'open',        marks: 4 }
  ]);
  M.setBank([
    { id: 'b1', title: 'Shadow',   blocks: mcqBlocks() },
    { id: 'b2', title: 'Magnets',  blocks: mcqBlocks() },
    { id: 'b3', title: 'Heat',     blocks: openBlocks() },
    { id: 'b4', title: 'Circuits', blocks: bothBlocks() },
    { id: 'b6', title: 'Plants',   blocks: openBlocks() }
  ]);
  M.setMap({ p1: 'b1', p2: 'b2', p3: 'b3', p4: 'b4', p6: 'b6' });   // p5 unattached
  M.reset();
}

// ── cases ───────────────────────────────────────────────────────────────────
const T = {};
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m + '\n  got      ' + JSON.stringify(a) + '\n  expected ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// THE HALF IS READ OFF THE BANK QUESTION'S BLOCKS.
T['kindOf reads the blocks'] = () => {
  world();
  eq(M.kindOf({ blocks: mcqBlocks() }), 'mcq', 'an options-only question is the multiple-choice half');
  eq(M.kindOf({ blocks: openBlocks() }), 'oeq', 'a writing box is the open-ended half');
  eq(M.kindOf({ blocks: [] }), 'oeq', 'a question with no blocks is not multiple choice');
  eq(M.kindOf(null), 'oeq', 'nothing at all must not be counted as multiple choice');
};

// THE ONE FAILURE THAT LOOKS LIKE SUCCESS: the paper says Booklet A, the
// attached question has a writing box in it. The half is the question's.
T['a Booklet A row with an open question attached is OPEN-ENDED'] = () => {
  world();
  const mcq = M.kindBankQs('2017', 'mcq').map(q => q.id);
  const oeq = M.kindBankQs('2017', 'oeq').map(q => q.id);
  eq(mcq, ['b1', 'b2'], 'Q31 is Booklet A on the paper and must NOT be offered as multiple choice');
  ok(oeq.indexOf('b4') >= 0, 'Q31 belongs to the open-ended half, because that is what a child will meet');
  eq(oeq, ['b3', 'b4'], 'the open-ended half is every attached question that is not options-only');
};

// AND THE TWO HALVES ARE THE WHOLE PORTION — nothing is dropped, nothing is
// counted twice.
T['the two halves partition the portion'] = () => {
  world();
  ['', '2017', '2018'].forEach(y => {
    const all = M.attached(y).map(q => q.id).sort();
    const split = M.kindBankQs(y, 'mcq').concat(M.kindBankQs(y, 'oeq')).map(q => q.id).sort();
    eq(split, all, 'the halves of ' + (y || 'every paper') + ' must add back up to the whole portion');
  });
};

// THE COUNT AND THE SHEET READ THE SAME FUNCTION.
T['the counts agree with the lists'] = () => {
  world();
  eq(M.kindCounts('2017'), { mcq: 2, oeq: 2 }, '2017 has two of each attached');
  eq(M.kindCounts('2018'), { mcq: 0, oeq: 1 }, 'a paper with no attached MCQ still reports the key');
  eq(M.kindCounts(''), { mcq: 2, oeq: 3 }, 'every paper');
  ['', '2017', '2018'].forEach(y => {
    const c = M.kindCounts(y);
    M.PP_KINDS.forEach(k => eq(c[k.kind], M.kindBankQs(y, k.kind).length,
      'the ' + k.kind + ' count for ' + (y || 'every paper') + ' must be the length of the list it labels'));
  });
};

// AN UNKNOWN KIND IS THE WHOLE PORTION, never nothing.
T['no kind, or a stray kind, means all of it'] = () => {
  world();
  const all = M.attached('2017').map(q => q.id);
  [undefined, '', null, 'MCQ', 'booklet-a', 'open'].forEach(k => {
    eq(M.kindBankQs('2017', k).map(q => q.id), all,
      JSON.stringify(k) + ' must leave the portion untouched rather than filtering it away');
  });
  eq(M.kindFilter(null, 'mcq'), [], 'nothing in, nothing out — never a throw');
};

// PAPER ORDER, and the SAME order practice runs in.
T['order is paper order, and print matches practice'] = () => {
  world();
  eq(M.hitIds('2017'), ['p1', 'p2', 'p3', 'p4', 'p5'], 'one year sorts by question number');
  eq(M.hitIds(''), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], "'' is EVERY year, oldest paper first");
  M.printYear('', '', 'oeq');
  const printed = M.HOOK.printed.items.map(it => it.bq.id);
  const practise = (M.reset(), M.practiceYear('', 'oeq'), M.HOOK.practised.qs.map(q => q.id));
  eq(printed, practise, 'the sheet and the practice queue must run in the same order');
};

// `ppPrintYear('')` IS EVERY PAPER — the All-years tiers depend on it.
T['printYear with no year prints every paper'] = () => {
  world();
  M.printYear('');
  eq(M.HOOK.printed.items.map(it => it.bq.id), ['b1', 'b2', 'b3', 'b4', 'b6'], 'every attached question, every year');
  ok(/every past paper/i.test(M.HOOK.printed.title), 'the title must say it is every paper: ' + M.HOOK.printed.title);
  M.reset();
  M.printYear('2017');
  eq(M.HOOK.printed.items.map(it => it.bq.id), ['b1', 'b2', 'b3', 'b4'], 'one year is unchanged by the new argument');
  eq(M.HOOK.printed.title, 'PSLE Science 2017', 'a whole-year print keeps exactly the title it always had');
  eq(M.HOOK.printed.opts.coverTitle, 'PSLE 2017 Science Paper', '…and exactly the cover it always had');
};

// A HALF-PAPER PRINT NAMES THE HALF, and never names a booklet it did not read.
T['a half print is titled by its half'] = () => {
  world();
  M.printYear('2017', '', 'mcq');
  eq(M.HOOK.printed.title, 'PSLE Science 2017 — Multiple choice', 'the sheet says which half it is');
  eq(M.HOOK.printed.opts.coverTitle, 'PSLE 2017 Science Paper — Multiple choice', 'and so does the cover');
  ok(!/Booklet/i.test(M.HOOK.printed.title + M.HOOK.printed.opts.coverTitle),
    'it must not claim a booklet: the half was read off the questions, not off the paper');
  eq(M.kindTitle('X', undefined), 'X', 'no kind leaves a title alone');
  eq(M.kindTitle('X', 'nope'), 'X', 'a stray kind leaves a title alone');
};

// `missing` IS CARRIED THROUGH UNFILTERED.
T['a row with nothing attached is still reported'] = () => {
  world();
  M.printYear('2017', '', 'mcq');
  eq(M.HOOK.printed.missing, ['2017 Q32'], 'an unattached row belongs to neither half and is still named');
  M.reset();
  M.printYear('2017');
  eq(M.HOOK.printed.missing, ['2017 Q32'], 'the whole-paper print reports the same gap');
};

// AN EMPTY HALF SAYS SO, and starts nothing.
T['an empty half refuses and says which half'] = () => {
  world();
  M.printYear('2018', '', 'mcq');
  ok(!M.HOOK.printed, 'nothing may be printed when the half is empty');
  ok(/multiple choice/i.test(M.HOOK.toasts.map(t => t.msg).join(' ')),
    'the refusal must name the half: ' + JSON.stringify(M.HOOK.toasts));
  ok(/2018/.test(M.HOOK.toasts.map(t => t.msg).join(' ')), 'and the paper');
  M.reset();
  M.practiceYear('2018', 'mcq');
  ok(!M.HOOK.practised, 'nor may a practice session start on an empty half');
  ok(/multiple choice/i.test(M.HOOK.toasts.map(t => t.msg).join(' ')), 'and it says which half again');
};

// PRACTICE GOES THROUGH THE ONE DOOR, with the past papers' own allowRetired.
T['practice goes through launchWorksheetPractice with allowRetired'] = () => {
  world();
  M.practiceYear('2017', 'oeq');
  ok(M.HOOK.practised, 'a half must be practised through the one worksheet door');
  eq(M.HOOK.practised.qs.map(q => q.id), ['b3', 'b4'], 'just that half');
  eq(M.HOOK.practised.opts, { allowRetired: true }, 'past papers reproduce retired topics — the flag must survive');
  eq(M.HOOK.practised.mode, undefined, 'and the mode is left alone');
};

// PREVIEW AND PRINT ARE THE SAME COLLECTION — a preview assembled any other way
// is a preview of a different sheet.
T['preview and print collect the identical sheet'] = () => {
  world();
  M.printYear('2017', 'preview', 'oeq');
  const prev = M.HOOK.previewed;
  ok(prev, 'preview must be reachable for a half');
  M.reset();
  M.printYear('2017', '', 'oeq');
  eq(prev.items.map(i => i.bq.id), M.HOOK.printed.items.map(i => i.bq.id), 'same questions');
  eq(prev.title, M.HOOK.printed.title, 'same title');
  eq(prev.opts.coverTitle, M.HOOK.printed.opts.coverTitle, 'same cover');
  eq(prev.missing, M.HOOK.printed.missing, 'same skipped list');
};

// THE SAME QUESTION ATTACHED TO TWO PAPERS IS PRINTED ONCE.
T['a question on two papers prints once'] = () => {
  world();
  M.setMap({ p1: 'b1', p2: 'b1', p3: 'b3', p4: 'b4', p6: 'b6' });
  M.reset();
  M.printYear('2017', '', 'mcq');
  eq(M.HOOK.printed.items.length, 1, 'one bank question, one printed question');
  eq(M.HOOK.printed.items[0].refs, ['2017 Q1', '2017 Q2'], 'but both paper references on its title');
};

// ── the ONE test rule, pinned in the source ─────────────────────────────────
T['the half is decided in exactly one place'] = () => {
  const body = cut('const PP_KINDS = [', '\n// -------- printing: concepts & whole years --------', 'the halves');
  const uses = (src.match(/qIsMcqOnly\(/g) || []).length;
  ok((body.match(/qIsMcqOnly\(/g) || []).length === 1,
    'ppKindOf must be the only place in this section that asks qIsMcqOnly');
  ok(uses >= 2, 'qIsMcqOnly is still the app-wide test');
  // Nothing in the halves section may read the paper row's booklet or skill:
  // that is the silent failure this whole section exists to avoid.
  ok(!/\.bk\b/.test(body), 'the halves must not read the paper row\'s booklet letter');
  ok(!/type\s*===\s*'open'/.test(body), 'nor its skill');
  // Every helper in the section narrows THROUGH ppKindOf. A filter that asked
  // the blocks itself would be the second reading, one edit away from drifting
  // from the count printed beside it.
  ok(/filter\(bq => ppKindOf\(bq\) === kind\)/.test(body), 'ppKindFilter must narrow with ppKindOf');
  ok(/const k = ppKindOf\(bq\)/.test(body), 'ppKindCounts must count with ppKindOf');
  ok(!/b\.type\s*===\s*'mcq'/.test(body), 'nothing in the section may read a block type for itself');
  // …and the two callers must narrow through the shared helpers rather than
  // filtering with a reading of their own.
  const py = cut('// `y` is one year, or \'\' for EVERY past paper.', 'function ppPrintSelected(go){', 'print year');
  const pr = cut('// `kind` is \'mcq\' / \'oeq\' to run just that half', '\n// Model answer of an open-ended', 'practice year');
  ok(/ppKindOf\(it\.bq\)/.test(py), 'ppPrintYear must narrow with ppKindOf');
  ok(!/qIsMcqOnly/.test(py) && !/\.bk\b/.test(py), 'ppPrintYear must not read the question a second way');
  ok(/ppKindBankQs\(/.test(pr), 'ppPracticeYear must narrow with ppKindBankQs');
  ok(!/qIsMcqOnly/.test(pr) && !/\.bk\b/.test(pr), 'ppPracticeYear must not read the question a second way');
};

// ── the buttons really exist, for students too ──────────────────────────────
T['every half gets practice, preview and print — for students as well'] = () => {
  const i = src.indexOf("  const practiceRows = pRows.map(r => {");
  ok(i > 0, 'the practice rows must still be built here');
  const rows = src.slice(i, src.indexOf("\n  }).join('');", i));
  // The tiers are generated FROM PP_KINDS rather than writing 'mcq' / 'oeq'
  // out by hand, so a half added to that table gets its buttons without being
  // told — and a half can never be on the table and missing from the card.
  ok(/PP_KINDS\.filter\(/.test(rows), 'the tiers must be generated from PP_KINDS');
  ok(!/'mcq'|'oeq'/.test(rows), 'no half may be named by hand in the card');
  ok(/ppPracticeYear\('\$\{escapeHtml\(r\.y\)\}','\$\{k\.kind\}'\)/.test(rows), 'a tier must offer ▶ Practice');
  ok(/ppPrintYear\('\$\{escapeHtml\(r\.y\)\}','preview','\$\{k\.kind\}'\)/.test(rows), 'a tier must offer 👁 Preview');
  ok(/ppPrintYear\('\$\{escapeHtml\(r\.y\)\}','','\$\{k\.kind\}'\)/.test(rows), 'a tier must offer 🖨 Print');
  // The tiers are inside no role test of their own: a student prints past
  // papers today and must be able to print one half of one.
  const tier = rows.slice(rows.indexOf('const kindTiers'), rows.indexOf("    }).join('');", rows.indexOf('const kindTiers')));
  ok(!/_canAuthor|_isAdmin|ppIsAdmin/.test(tier), 'the tiers must not be gated — students print these too');
  // A half with nothing in it gets no tier at all: a row of disabled buttons is
  // the row that makes the live ones get scrolled past.
  ok(/PP_KINDS\.filter\(k => counts\[k\.kind\]\)/.test(tier), 'an empty half must not draw a tier');
  // …and the breakdown still names every half, so an empty one is not hidden.
  ok(/PP_KINDS\.map\(k => counts\[k\.kind\]/.test(rows), 'the breakdown line must name every half, zeros included');
};

// ── runner ──────────────────────────────────────────────────────────────────
const only = process.argv[2];
const names = Object.keys(T).filter(n => !only || n.indexOf(only) >= 0);
let pass = 0, fail = 0;
for (const n of names) {
  try { T[n](); console.log('  ✓ ' + n); pass++; }
  catch (e) { console.log('  ✗ ' + n + '\n      ' + String(e.message).split('\n').join('\n      ')); fail++; }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed' + (only ? ' (filter: ' + only + ')' : ''));
process.exit(fail ? 1 : 0);
