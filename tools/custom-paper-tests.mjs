// Regression tests for 🗂️ CUSTOM PAPER — a mock paper built from screenshots.
// Run with:  node tools/custom-paper-tests.mjs
//
// The page does three things and every one of them fails silently:
//
//  • THE BOOKLET SPLIT decides whether a child is given ruled lines to write
//    on. A question in the wrong booklet is answerable in the wrong place, and
//    that is found in the exam hall. `qIsMcqOnly` is the ONE test — the print
//    packer and the MCQ answer bracket read it too — so a second reading of it
//    is a question printed in Booklet A whose key files it under Booklet B.
//  • THE NUMBERING runs straight through both booklets. Numbered per booklet
//    instead, Booklet B starts again at 1 and every answer on the key is
//    against the wrong question. Numbered by POSITION IN THE LIST rather than
//    within the booklet, a paper whose questions are interleaved comes out
//    numbered at random — and it still prints perfectly.
//  • THE HOLD-BACK is the whole reason the page can be used on a live bank. It
//    is folded into `qReleased`, the ONE predicate every student-facing pool
//    already asks, so every pool gained it without being told. Lift it out
//    into a gate of its own and the next pool somebody writes serves next
//    week's paper to the class sitting it.
//
// …and one that fails loudly but only in front of a class: THE BOOKLET B
// COVER. Front matter is lifted out of the document and put back at the top,
// so a cover that does not name the question it belongs before prints on top
// of Booklet A's.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const HTML = new URL('../index.html', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const html = fs.readFileSync(HTML, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from.slice(0, 46) + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

let fails = 0, ran = 0;
function ok(name, cond, extra) {
  ran++;
  if (cond) return;
  fails++;
  console.error('FAIL: ' + name + (extra ? '\n      ' + extra : ''));
}
const eq = (name, got, want) => ok(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));

/* ------------------------------------------------------------------ *
 * The REAL booklet model, run as itself.                              *
 * ------------------------------------------------------------------ */
const shape = cut(
  '// 🅐 IS THIS QUESTION MULTIPLE CHOICE, AND NOTHING ELSE?',
  'function qStripTailMarks(',
  'qIsMcqOnly');
const marks = cut('function qMarksOf(b) {', 'function qMarksBracket(', 'qMarksOf');
const model = cut(
  '// ---- Which booklet a question belongs in ---------------------------------',
  '\n// ---- The draft survives the window',
  'booklet model');

// The REAL target block too, so the arithmetic the progress bar shows is the
// arithmetic that is tested rather than a stub that cannot disagree with it.
const target = cut(
  '// 🎯 THE SHAPE A PAPER IS BUILT TO',
  '\nlet _cpbShots = [];',
  'paper target');

const shim = `
  const CPB_MCQ_MARKS = 2, CPB_OPEN_DEFAULT_MARKS = 2, QMARKS_MAX = 99;
  let _cpbQuestions = [];
  let _cpbMeta = {};
  const cpbRender = () => {};
  ${target}
  const CPB_META_DEFAULTS = { targetMcq: CPB_TARGET_MCQ, targetOpen: CPB_TARGET_OPEN_MARKS };
  function _cpbMetaGet(k) { const v = _cpbMeta[k]; return v === undefined || v === null ? CPB_META_DEFAULTS[k] : v; }
  ${marks}
  ${shape}
  ${model}
  return {
    qIsMcqOnly, cpbBookOf, cpbSetBook, cpbBooklets, cpbMarks, cpbQuestionMarks,
    cpbGapLabel, cpbGapClass, _cpbTargetNum,
    CPB_TARGET_MCQ, CPB_TARGET_OPEN_MARKS,
    set: qs => { _cpbQuestions = qs; },
    get: () => _cpbQuestions,
    setMeta: m => { _cpbMeta = m || {}; },
  };
`;
let api;
try { api = new Function(shim)(); }
catch (e) { console.error('FAIL: the booklet model does not even load\n      ' + e.message); process.exit(1); }

const mcq = (id, extra) => Object.assign({ id, title: id, blocks: [{ type: 'text', content: 'x' }, { type: 'mcq', options: [{}, {}] }] }, extra || {});
const open = (id, m) => ({ id, title: id, blocks: [{ type: 'text', content: 'x', marks: m }, { type: 'plainanswer', content: 'a' }] });

/* ---------- ① the split ---------- */
ok('an MCQ with no writing box is Booklet A', api.cpbBookOf(mcq('q1')) === 'a');
ok('a written answer is Booklet B', api.cpbBookOf(open('q2', 2)) === 'b');
ok('a question with NO blocks at all is Booklet B — it needs somewhere to write',
   api.cpbBookOf({ id: 'q', blocks: [] }) === 'b');
ok('nothing at all is Booklet B rather than a crash', api.cpbBookOf(null) === 'b');
// The load-bearing half. A question carrying an MCQ *and* a box to write in
// needs the box, so it is open-ended — the safe direction, whose worst case is
// ruled lines nobody uses.
ok('an MCQ that ALSO has a writing box is Booklet B',
   api.cpbBookOf({ id: 'q', blocks: [{ type: 'mcq', options: [{}] }, { type: 'plainanswer', content: 'a' }] }) === 'b');
ok('…and so is one with a CER answer',
   api.cpbBookOf({ id: 'q', blocks: [{ type: 'mcq', options: [{}] }, { type: 'answer', claim: 'c' }] }) === 'b');
ok('…and one with a fill-in-the-blank',
   api.cpbBookOf({ id: 'q', blocks: [{ type: 'mcq', options: [{}] }, { type: 'fillblank', text: 'a [[b]]' }] }) === 'b');
ok('qIsMcqOnly takes a QUESTION as well as a block list — both call sites pass a list',
   api.qIsMcqOnly(mcq('q').blocks) === true && api.qIsMcqOnly(mcq('q')) === true);

/* ---------- ② the override ---------- */
{
  api.set([mcq('q1')]);
  api.cpbSetBook('q1', 'b');
  ok('a question moved by hand goes where it was put', api.cpbBookOf(api.get()[0]) === 'b');
  api.cpbSetBook('q1', 'a');
  ok('…and back again', api.cpbBookOf(api.get()[0]) === 'a');
  api.cpbSetBook('q1', 'nonsense');
  ok('a booklet that is neither is refused, not stored', api.cpbBookOf(api.get()[0]) === 'a');
}

/* ---------- ③ the numbering ---------- */
{
  // Interleaved on the page, exactly as they come off a real pile of
  // screenshots. Numbering by position in the LIST would give 1, 2, 3, 4, 5;
  // the paper needs A first, then B carrying straight on.
  api.set([mcq('a1'), open('b1', 2), mcq('a2'), open('b2', 3), mcq('a3')]);
  const bk = api.cpbBooklets();
  eq('Booklet A holds every MCQ', bk.a.map(q => q.id).join(','), 'a1,a2,a3');
  eq('Booklet B holds the rest', bk.b.map(q => q.id).join(','), 'b1,b2');
  eq('Booklet A is numbered from 1', [bk.numbers.a1, bk.numbers.a2, bk.numbers.a3].join(','), '1,2,3');
  eq('Booklet B carries straight on from it, never restarting at 1',
     [bk.numbers.b1, bk.numbers.b2].join(','), '4,5');
  ok('every question on the paper has a number',
     Object.keys(bk.numbers).length === 5 && Object.values(bk.numbers).every(n => n && /^\d+$/.test(n)));
}
{
  // A paper of one kind only still numbers from 1 and prints no empty booklet.
  api.set([mcq('a1'), mcq('a2')]);
  const bk = api.cpbBooklets();
  eq('an all-MCQ paper numbers 1..n', [bk.numbers.a1, bk.numbers.a2].join(','), '1,2');
  ok('…and Booklet B is empty', bk.b.length === 0);
  api.set([open('b1', 1), open('b2', 1)]);
  const bk2 = api.cpbBooklets();
  eq('an all-open paper starts at 1 too, because Booklet A is empty',
     [bk2.numbers.b1, bk2.numbers.b2].join(','), '1,2');
}
{
  api.set([]);
  const bk = api.cpbBooklets();
  ok('an empty paper is two empty booklets rather than a crash', bk.a.length === 0 && bk.b.length === 0);
}

/* ---------- ④ the marks on the cover ---------- */
{
  api.set([mcq('a1'), mcq('a2'), open('b1', 3), open('b2', 0)]);
  const m = api.cpbMarks();
  eq('Booklet A is 2 marks a question', m.a, 4);
  // b1 prints 3; b2 prints nothing, so it counts as the default rather than as
  // nothing — a cover that silently understates the paper is worse than one
  // that says how many it had to assume.
  eq('Booklet B sums what is printed, and counts an unmarked question as 2', m.b, 5);
  eq('the total is the two together', m.total, 9);
  eq('…and the page is told how many were assumed', m.guessed, 1);
  eq('a question with marks on several parts adds them up',
     api.cpbQuestionMarks({ blocks: [{ type: 'text', marks: 1 }, { type: 'text', marks: 2 }] }), 3);
  eq('a question with none is zero, so cpbMarks can tell it apart from a real 0',
     api.cpbQuestionMarks({ blocks: [{ type: 'text' }] }), 0);
}
{
  api.set([mcq('a1')]);
  eq('a paper with no open questions guesses nothing', api.cpbMarks().guessed, 0);
}

/* ---------- ⑤ the shape the paper is built to ---------- */
{
  // The current syllabus: 30 multiple choice at 2 marks each and 40 marks of
  // open-ended, 100 in all. It was 28 and 44 before it changed, which is why
  // these are stated once rather than read off a past paper.
  eq('the Booklet A target is 30 questions', api.CPB_TARGET_MCQ, 30);
  eq('…which is 60 marks at 2 a question', api.CPB_TARGET_MCQ * 2, 60);
  eq('the Booklet B target is 40 marks', api.CPB_TARGET_OPEN_MARKS, 40);

  api.setMeta({});
  api.set([]);
  const empty = api.cpbMarks();
  eq('an empty paper knows what it is aiming at', empty.wantTotal, 100);
  eq('…and how far off it is', empty.needMcq, 30);
  eq('…on both counts', empty.needOpen, 40);

  // A full paper: 30 MCQs and 40 marks of open-ended.
  const full = [];
  for (let i = 1; i <= 30; i++) full.push(mcq('m' + i));
  for (let i = 1; i <= 10; i++) full.push(open('o' + i, 4));
  api.set(full);
  const m = api.cpbMarks();
  eq('30 multiple choice is 60 marks', m.a, 60);
  eq('…and the target is met', m.needMcq, 0);
  eq('40 marks of open-ended meets Booklet B', m.b, 40);
  eq('…and its target too', m.needOpen, 0);
  eq('the paper is 100 marks', m.total, 100);
  eq('…which is what it was built to', m.wantTotal, 100);
  eq('the question counts are reported beside the marks', m.nA + '/' + m.nB, '30/10');

  // Short of the target — the ordinary state while a paper is being built.
  api.set(full.slice(0, 24).concat(open('ox', 6)));
  const short = api.cpbMarks();
  eq('24 of 30 multiple choice is 6 to go', short.needMcq, 6);
  ok('…and it is SAID, not just coloured', api.cpbGapLabel(short.needMcq, 'question') === '6 questions to go');
  // Booklet A is measured in QUESTIONS and Booklet B in MARKS, and the two
  // chips sit side by side — a bare "26 to go" on each is two different
  // quantities wearing the same words.
  ok('…and it names its unit', api.cpbGapLabel(6, 'mark') === '6 marks to go');
  ok('…which is singular when it is one', api.cpbGapLabel(1, 'question') === '1 question to go');
  ok('…and a gap with no unit still reads', api.cpbGapLabel(6) === '6 to go');
  ok('…and marked as under', api.cpbGapClass(short.needMcq) === ' cpb-under');

  // Over the target, which is just as wrong and must not read as "done".
  const over = [];
  for (let i = 1; i <= 33; i++) over.push(mcq('x' + i));
  api.set(over);
  const o = api.cpbMarks();
  eq('33 multiple choice is 3 over', o.needMcq, -3);
  ok('…and says so', api.cpbGapLabel(o.needMcq, 'question') === '3 questions over');
  ok('…in its own colour, never the same one as under',
     api.cpbGapClass(o.needMcq) === ' cpb-over' && api.cpbGapClass(-1) !== api.cpbGapClass(1));
  ok('on target is its own state again', api.cpbGapLabel(0, 'mark') === '✓' && api.cpbGapClass(0) === ' cpb-on-target');

  // A TARGET OF 0 IS NO TARGET. A short topical paper is a real thing to
  // build, and a page nagging that it is 22 questions short of a PSLE paper
  // is a page whose warnings stop being read.
  api.setMeta({ targetMcq: 0, targetOpen: 0 });
  api.set([mcq('a1'), open('b1', 3)]);
  const none = api.cpbMarks();
  ok('a target of 0 measures nothing', none.needMcq === null && none.needOpen === null);
  eq('…and the totals are still counted', none.total, 2 + 3);
  eq('…and no total is claimed', none.wantTotal, 0);
  ok('nothing is said about a gap that does not exist', api.cpbGapLabel(null) === '');

  // A paper can be built to its own shape.
  api.setMeta({ targetMcq: 12, targetOpen: 20 });
  api.set([mcq('a1'), mcq('a2')]);
  const custom = api.cpbMarks();
  eq('a custom target is honoured', custom.wantMcq, 12);
  eq('…in marks as well as questions', custom.wantA, 24);
  eq('…and in the whole-paper total', custom.wantTotal, 44);
  eq('…and the gap is measured against it', custom.needMcq, 10);

  // Junk in the field must never make the page unusable.
  eq('a blank target falls back to the syllabus shape', api._cpbTargetNum('', 30), 30);
  eq('…and so does a word', api._cpbTargetNum('thirty', 30), 30);
  eq('…and a negative number', api._cpbTargetNum(-5, 30), 30);
  eq('a real 0 is kept, because 0 means no target', api._cpbTargetNum(0, 30), 0);
  eq('…and an absurd one is capped rather than believed', api._cpbTargetNum(99999, 30), 999);
  api.setMeta({});
}

/* ------------------------------------------------------------------ *
 * The REAL front-sheet placement, run as itself.                      *
 * ------------------------------------------------------------------ */
{
  const place = cut('function _printFrontAnchor(f) {', 'function _printPlanIn(', 'front placement');
  const api2 = new Function(place + '\nreturn { _printFrontAnchor, _printFrontRestarts, _printFrontPlacement };')();
  const F = (anchor, restart) => ({
    _a: anchor, _r: restart,
    getAttribute(k) {
      if (k === 'data-front-before') return this._a || '';
      if (k === 'data-front-restart') return this._r || null;
      return null;
    },
  });
  const C = qid => ({ dataset: { qid } });
  const chunks = [C('q1'), C('q2'), C('q3')];
  const groups = [[0], [1, 2]];

  const cover = F('');
  const bookB = F('q2', '1');
  const got = api2._printFrontPlacement([cover, bookB], groups, chunks);
  ok('an UNANCHORED front sheet still leads the document — every cover ever printed',
     got.leading.length === 1 && got.leading[0] === cover);
  ok('an anchored one is placed before the page that carries its question',
     got.before.get(1) && got.before.get(1)[0] === bookB);
  ok('…and nowhere else', !got.before.get(0));

  // The failure that must never be silent: an anchor naming a question that is
  // not on the sheet. Dropped, the booklet cover simply vanishes and nobody
  // notices; leading, it is visibly in the wrong place.
  const orphan = F('nope');
  const got2 = api2._printFrontPlacement([orphan], groups, chunks);
  ok('an anchor naming no question falls back to leading, never to being dropped',
     got2.leading.length === 1 && got2.before.size === 0);

  // Two sheets on the same anchor keep their document order — the answer sheet
  // is emitted before Booklet B's cover and has to print before it.
  const first = F('q2'), second = F('q2');
  const got3 = api2._printFrontPlacement([first, second], groups, chunks);
  ok('two sheets on one anchor keep the order they were written in',
     got3.before.get(1)[0] === first && got3.before.get(1)[1] === second);

  ok('a sheet is asked whether it restarts the numbering',
     api2._printFrontRestarts(bookB) === true && api2._printFrontRestarts(cover) === false);
  ok('an element that answers nothing is not a crash',
     api2._printFrontAnchor(null) === '' && api2._printFrontRestarts(null) === false);
  // A question in TWO groups (a tall one that flowed) anchors to the first.
  const got4 = api2._printFrontPlacement([F('q1')], [[0], [0, 1]], chunks);
  ok('a question that appears twice anchors to the FIRST page carrying it',
     !!got4.before.get(0) && !got4.before.get(1));
}

/* ------------------------------------------------------------------ *
 * 🔒 HELD BACK — folded into the ONE predicate, not bolted beside it.  *
 * ------------------------------------------------------------------ */
{
  const rel = cut('function qReleaseOn(q) {', 'function qReleaseLabel(', 'release gate');
  const api3 = new Function(
    'const RELEASE_DAY_RE = /^\\d{4}-\\d{2}-\\d{2}$/;\n' +
    'const releaseToday = () => "2026-09-06";\n' +
    'const _canAuthor = () => false;\n' + rel +
    '\nreturn { qHeldBack, qReleased, qScheduled, qAvailableToViewer };')();

  ok('a held-back question is NOT released', api3.qReleased({ holdBack: true }) === false);
  ok('an ordinary question is', api3.qReleased({ title: 'x' }) === true);
  ok('nothing at all is', api3.qReleased(null) === true);
  ok('held back AND scheduled is still held back',
     api3.qReleased({ holdBack: true, releaseOn: '2020-01-01' }) === false);
  // STRICT, and deliberately not the fail-open rule `qReleaseOn` follows: the
  // field has exactly two writers and neither can produce a truthy non-true
  // value, so there is no third state to be lenient about.
  ok('only true holds it back — a stray string does not', api3.qReleased({ holdBack: 'yes' }) === true);
  ok('…nor a 1', api3.qReleased({ holdBack: 1 }) === true);
  ok('…nor false', api3.qReleased({ holdBack: false }) === true);
  ok('qHeldBack answers for nothing at all', api3.qHeldBack(null) === false);
  // The teacher has to be able to print and check the paper they are holding.
  const api4 = new Function(
    'const RELEASE_DAY_RE = /^\\d{4}-\\d{2}-\\d{2}$/;\n' +
    'const releaseToday = () => "2026-09-06";\n' +
    'const _canAuthor = () => true;\n' + rel +
    '\nreturn { qAvailableToViewer };')();
  ok('an author can still see a held-back question', api4.qAvailableToViewer({ holdBack: true }) === true);
  ok('…and a student cannot', api3.qAvailableToViewer({ holdBack: true }) === false);
}

/* ------------------------------------------------------------------ *
 * Wiring that cannot be exercised without a DOM, read off the source. *
 * ------------------------------------------------------------------ */
{
  const gate = cut('function qReleased(q, today)', 'function qAvailableToViewer', 'qReleased body');
  ok('the hold-back is folded INTO qReleased rather than bolted beside it',
     /qHeldBack\(q\)/.test(gate) && /qScheduled\(q, today\)/.test(gate),
     'a gate of its own is one the next pool somebody writes forgets to ask');

  const chip = cut('function qReleaseChipHtml(q) {', '\n// ======', 'the chip');
  ok('a held-back question wears a badge on every management surface',
     /qHeldBack\(q\)/.test(chip) && /Not released/.test(chip),
     'one that looked ordinary is a paper somebody prints for Monday and cannot understand why no student sees it');
  ok('…and the badge beats the date, because it is the one that is true',
     chip.indexOf('qHeldBack') < chip.indexOf('qReleaseOn'));

  const owned = cut('const EDITOR_OWNED_QUESTION_FIELDS = new Set([', ']);', 'editor-owned fields');
  ok('holdBack is NOT editor-owned, so carryOverQuestionMeta keeps it across an edit',
     !/holdBack/.test(owned),
     'in that Set, an ordinary edit would release the whole paper');
  ok('…and neither is releaseOn, for the same reason', !/releaseOn/.test(owned));

  const commit = cut('async function _cpbCommit() {', '\n// ---- Rendering', 'the send');
  ok('every question sent from the page is held back', /clean\.holdBack = true/.test(commit));
  ok('…and it is AWAITED, so the count reported is the count that went',
     /await saveQuestion\(clean\)/.test(commit));
  ok('…and only joins the in-memory bank once the write landed',
     /if \(ok\) \{\s*\n?[\s\S]{0,400}questionBank/.test(commit),
     'a bank holding a question Firestore does not looks right until the next sign-in');
  ok('…and a re-send REPLACES rather than pushing a second copy of the same question',
     /questionBank\[at\] = clean; else questionBank\.push\(clean\)/.test(commit),
     'a part-failed send is tried again, and a blind push puts the question in the bank twice');
  ok('a part-failed send keeps the paper on the page',
     /if \(done && !failed\)/.test(commit),
     'clearing it loses the questions that could not be saved');
  ok('…and Send cannot be pressed twice while it runs', /if \(_cpbBusy\) return;/.test(commit));
  ok('page-local bookkeeping never reaches the bank', /delete clean\._cpbBook/.test(commit));

  const opts = cut('function _cpbPaperOpts() {', 'function _cpbPrintOrder', 'paper options');
  ok('Booklet B’s cover is anchored to the chunk that STARTS its page',
     /_cpbCoverB\(marks\.b, from, to, '__lo__' \+ b\[0\]\.id\)/.test(opts),
     'anchored to the question instead, the cover lands between the instruction line and question 1');
  ok('…and that chunk is forced onto a new page',
     /forced\.add\('__lo__' \+ b\[0\]\.id\)/.test(opts),
     'without it the instruction line sits at the foot of Booklet A’s last sheet');
  ok('Booklet A’s lead line is forced too', /forced\.add\('__lo__' \+ a\[0\]\.id\)/.test(opts));
  ok('Booklet A prints no answer bracket when it is answered on the answer sheet',
     /noBracketIds: onPaper \? null : new Set/.test(opts),
     'a bracket nobody writes in is a mark a child looks for and cannot find');
  ok('the answer sheet is only offered when there is somewhere else to answer',
     /const wantSheet = a\.length && !onPaper/.test(opts));

  const printer = cut('async function cpbPrint() {', 'function cpbPreview', 'the printer');
  ok('the paper goes through the ONE worksheet builder', /buildWorksheetHtml\(selected/.test(printer),
     'a second renderer is one the sheet a class sits drifts away from');
  ok('…and the ONE planner', /autoscaleAndPrint\(output/.test(printer));
  ok('the pictures are loaded before the pages are measured',
     printer.indexOf('_preloadImageUrls') < printer.indexOf('autoscaleAndPrint'),
     'an undecoded picture is measured as a line of text and the page overflows');

  const order = cut('function _cpbPrintOrder() {', 'function _cpbPaperTitle', 'print order');
  ok('the paper prints Booklet A then Booklet B, whatever order the list is in',
     /return a\.concat\(b\)/.test(order));

  const prompt = cut('function _cpbQuestionPrompt(n, from, total) {', '\nfunction cpbBuild()', 'the prompt');
  ok('the reader is asked which kind each question is', /"questionType"/.test(prompt));
  ok('…and told that a question offering options AND asking for working is open',
     /offers options AND asks for written working is "open"/.test(prompt));
  ok('…and that the two block kinds are never both present',
     /Never both\./.test(prompt));
  ok('it is grounded in the teaching notes like every other authoring prompt',
     /_genPreamble\(\)/.test(prompt));
  ok('a question spread over several screenshots is read as ONE',
     /ONE CONTINUOUS RUN/.test(prompt) && /"continuation"/.test(prompt));
  ok('the source paper’s own number never reaches the question',
     /NEVER write a question number inside a block/.test(prompt),
     'this paper numbers itself, so a number read off the old one is printed twice');
  ok('the marks a page prints are read off it', /include "marks" ONLY when/.test(prompt));

  const run = cut('async function _cpbRunBuild() {', '\nfunction cpbCancel', 'the read');
  ok('the page uses the ONE shared screenshot-run reader', /readQuestionRun\(_cpbShots/.test(run),
     'forked, it stops joining the screenshots that are one question and the other page keeps doing it');
  ok('the source paper’s numbering is stripped BEFORE the crop', /_epStripNumbering\(q\)/.test(run));
  ok('the batch level narrows the topics and is applied as a guard',
     /_rapidApplyLevel\(q, level\)/.test(run));
  ok('the level and the paper name are read ONCE, before the run',
     run.indexOf("const level = _cpbMetaGet('qLevel')") < run.indexOf('readQuestionRun'),
     'read inside the job, a forty-screenshot paper is filed at whatever the picker was moved to');

  const reader = cut('async function readQuestionRun(shots, o) {', '\nasync function _epRunBuild', 'shared reader');
  ok('a batch that fails does not sink the rest of the paper', /failed \+= batch\.length;\n      continue;/.test(reader));
  ok('a question continuing from the batch before is appended, never filed as half a question',
     /qd\.continuation === true && last/.test(reader));
  ok('…and only as the FIRST entry of a batch', /i === 0 && qd\.continuation/.test(reader),
     'any other entry continuing something is a reply that ignored the question');
  ok('the run can be stopped between questions', /stopped\(\)/.test(reader));
  ok('it leads with the authoring engine', /authoring: true/.test(reader));

  // Both callers, so the extraction really is shared rather than a copy.
  const epRun = cut('async function _epRunBuild() {', '\n// ---- Reading the answer key', 'ep run');
  ok('the exam paper builder calls the same reader', /readQuestionRun\(_epShots/.test(epRun),
     'two readers is two places for a question spread over three screenshots to stop being joined');
  eq('…and there is exactly ONE of them', (src.match(/^async function readQuestionRun\(/gm) || []).length, 1);

  const nav = cut('function navigateTo(page) {', 'document.querySelectorAll(\'.page\')', 'nav gate');
  ok('the page is shut to anyone but an admin, whatever route they arrive by',
     /page === 'custompaper' && !_isAdmin\(\)/.test(nav),
     'hiding a nav item is never on its own what keeps a page shut');
  const emp = cut('const EMPLOYEE_PAGES = [', '];', 'employee pages');
  ok('…and it is not on EMPLOYEE_PAGES', !/custompaper/.test(emp));

  const draft = cut('function _cpbDraftSave() {', 'async function _cpbDraftDrop', 'the draft');
  ok('the unsent paper is mirrored so a reload cannot take an afternoon with it',
     /_cpbDraftFlush/.test(draft));
  ok('…and the screenshots are only rewritten when the set really changed',
     /sig !== _cpbDraftSig/.test(draft),
     'rewriting megabytes on every keystroke is what makes a page feel broken');
  ok('…and a write that did not land is not remembered as one that did',
     /if \(!_epdFailed\) _cpbDraftSig = sig/.test(draft));

  const render = cut('function cpbRender() {', 'function _cpbIntroHtml', 'render');
  ok('the draft is mirrored from the ONE hook every mutation ends at',
     /_cpbDraftSave\(\)/.test(render));
  ok('a non-author is shown nothing to build with', /_canAuthor\(\)/.test(render));

  const preview = cut('function cpbPreview() {', '\n// ---- Sending the paper', 'preview');
  ok('the preview is handed the SAME arguments the printer uses',
     /buildOpts: o\.buildOpts/.test(preview) && /forcedBreakIds: o\.forcedBreakIds/.test(preview),
     'a preview assembled its own way is a preview of a different paper');
  ok('…and it clears the other two preview slots',
     /_wsPreviewSaved = null/.test(preview) && /_wsPreviewPaper = null/.test(preview));

  const fromPrev = cut('function printFromPreview() {', '\nasync function renderWsPreview', 'print from preview');
  ok('🖨 from inside the preview keeps the covers',
     /a\.source === 'custompaper'.*cpbPrint\(\)/s.test(fromPrev),
     'sent to printQuestionsDirect it comes out as a plain worksheet with both covers gone');

  const held = cut('function _bankHeldSectionHtml() {', '\n// ONE writer, for one question', 'held section');
  ok('a held-back paper is listed where it can be released', /bankUnholdPaper/.test(held));
  ok('…grouped by the paper it belongs to', /_bankHeldGroupKey/.test(held),
     'forty separate Release buttons is a list nobody works through');
  const setHold = cut('async function _bankSetHold(id, held) {', 'async function bankUnholdNow', 'hold writer');
  ok('releasing is a QUIET write — housekeeping, not a question authored',
     /\{ quiet: true \}/.test(setHold));
  ok('…and a write that failed changes nothing on screen',
     /if \(prev === undefined\) delete q\.holdBack; else q\.holdBack = prev;/.test(setHold),
     'a page that has released a question the database still holds back looks right until the next sign-in');
}

/* ---------- the markup and the print CSS ---------- */
{
  ok('the page exists', /id="page-custompaper"/.test(html));
  ok('…and its nav item is admin-only', /data-page="custompaper"[^>]*/.test(html)
     && /class="nav-item admin-only" data-page="custompaper"/.test(html));
  ok('the paste pad has somewhere to render into', /id="cpbBody"/.test(html));
  ok('the number in the gutter is taken out of the flow',
     /\.print-q-paper \.print-q-paper-num \{[^}]*position: absolute/.test(html),
     'in the flow it pushes the first line of every question down');
  ok('…and the chunk reserves the room for it',
     /\.print-question-chunk\.print-q-paper \{[^}]*padding-left/.test(html),
     'without the reserve the number prints over the first words of its own question');
  ok('the covers have their print styles', /\.cpb-cv-head \{/.test(html) && /\.cpb-cv-ins \{/.test(html));
  ok('…and they are inside the @media print block, where the planner unwraps them',
     html.indexOf('.cpb-cv-head {') > html.indexOf('@media print'));
  ok('the answer sheet has its grid', /\.cpb-as-grid \{/.test(html));
  ok('the switches draw a real checkbox despite Tailwind’s preflight',
     /\.cpb-switch input\[type="checkbox"\] \{[^}]*appearance: auto/.test(html),
     'preflight sets appearance:none, which leaves an invisible white square');
}

/* ---------- every inline handler is reachable from module scope ---------- */
{
  const page = html.slice(html.indexOf('id="page-custompaper"'), html.indexOf('</div>', html.indexOf('id="cpbBody"')));
  const handlers = new Set();
  const body = src;
  // Everything the module names in an onclick/onchange/oninput, from the page
  // shell AND from the HTML cpbRender builds.
  const rendered = src.slice(src.indexOf('function cpbRender()'), src.indexOf('// =====================================================================\n// MARK PAPER'));
  (page + rendered).replace(/on(?:click|change|input|dragover|drop)="([a-zA-Z_$][\w$]*)\(/g, (_, n) => { handlers.add(n); return _; });
  const missing = [...handlers].filter(n => !new RegExp('window\\.' + n + '\\s*=').test(body));
  ok('every function an inline handler names is on window',
     missing.length === 0,
     'the module has its own scope, so these are dead buttons: ' + missing.join(', '));
  ok('…and the census can still see them', handlers.size >= 10, 'found only ' + handlers.size);
}


/* ------------------------------------------------------------------ *
 * THE PAPER AS IT REALLY COMES OUT.                                   *
 *                                                                     *
 * `buildWorksheetHtml` is run for real, with its helpers stubbed, and  *
 * the HTML it produces is read back. Everything above this pins the    *
 * WIRING; this pins the SHEET — the cover in the right place, the      *
 * number in the gutter, no bracket under a Booklet A question, and the *
 * key numbered by the paper rather than by position. The last two      *
 * cases are the ones that matter most: with no `paper` option at all,  *
 * an ordinary worksheet must come out byte-for-byte as it always did.  *
 * ------------------------------------------------------------------ */
const bwh = cut('function buildWorksheetHtml(selected, worksheetTitle, opts) {', '\n// One AI call per MCQ is a real wait', 'buildWorksheetHtml');
const shapeFn = cut('function qIsMcqOnly(blocks) {', '\n// Take a printed marks marker back out', 'qIsMcqOnly');
const bwhStubs = `
  const escapeHtml = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const escapeHtmlKeepLines = s => escapeHtml(s);
  const stripHtml = s => String(s || '').replace(/<[^>]*>/g, '');
  const transformImageUrl = u => u;
  const imgQuestionNeedsBig = () => false;
  const imgPrintAttr = () => '';
  const imgSizeStyle = () => '';
  const openEndedLines = n => '<lines n="' + n + '">';
  const printAnswerLines = () => 2;
  const renderTableReadonly = () => '<table>';
  const _wsHeaderHtml = () => '<header>';
  const printPartBlockHtml = (lab, inner) => '<div class="print-text-block' + (lab ? ' print-has-part' : '') + '">' + (lab ? '<span class="print-part-label">' + lab + '</span>' : '') + inner + '</div>';
  const qPartMap = () => new Map();
  const qPartBodyHtml = b => b.content || '';
  const qPartOf = () => '';
  const qBlockOpensKey = () => '';
  const qPartLabel = p => p ? '(' + p + ')' : '';
  const qPartNormalize = p => p || '';
  const qKeyFieldHtml = (q, b, f) => escapeHtml(b[f] || '');
  const _fbHasBlanks = () => false;
  const _fbPrintHtml = () => '<fb>';
  const _fbAnswerKeyText = () => 'fbkey';
  const _pushAnnotAnswerKey = () => {};
  const _pushAnswerKeySection = (s, label, content) => { if (content) s.push({ label, content }); };
  const _explKeyContentHtml = b => escapeHtml(b.content || '');
  const _qAnswerKeyExtraSection = () => null;
  const _qFallbackKeySection = () => null;
  const _akQuestionSections = d => d.sections;
  const _akSectionsHtml = ss => ss.map(x => '<sec>' + (x.label || '') + ':' + x.content + '</sec>').join('');
  const renderImportedBlockStudent = b => b.type === 'mcq' ? '<div class="mcq-opts">' + (b.options||[]).map((o,i)=>'('+(i+1)+') '+escapeHtml(o.text)).join('') + '</div>' : '<blk>';
  const _printMcqBlockHtml = (b) => renderImportedBlockStudent(b) + '<div class="print-mcq-answer">BRACKET</div>';
  const _pushBlockAnswerKey = (s, b) => { if (b.type === 'mcq') { const c = (b.options||[]).find(o=>o.id===b.correctId); if (c) s.push({ label: 'Answer', content: escapeHtml(c.text) }); } };
  const qMarksOf = () => 0;
  ${shapeFn}
  ${bwh}
  return buildWorksheetHtml;
`;
const bwhBuild = new Function(bwhStubs)();

const rMcq = (id, t) => ({ id, title: t, category: 'C', topic: 'T', blocks: [
  { id: id+'t', type: 'text', content: '<p>' + t + '</p>' },
  { id: id+'m', type: 'mcq', options: [{id:'o1',text:'one'},{id:'o2',text:'two'},{id:'o3',text:'three'},{id:'o4',text:'four'}], correctId: 'o2' },
]});
const rOpen = (id, t) => ({ id, title: t, category: 'C', topic: 'T', blocks: [
  { id: id+'t', type: 'text', content: '<p>' + t + '</p>' },
  { id: id+'a', type: 'plainanswer', content: 'the model answer' },
]});

const rA = [rMcq('a1','Deforestation'), rMcq('a2','Life cycles')];
const rB = [rOpen('b1','Explain the melting'), rOpen('b2','Why did it rise')];
const rNumbers = { a1:'1', a2:'2', b1:'3', b2:'4' };
const paperHtml = bwhBuild(rA.concat(rB), 'Mock Paper', {
  frontHtml: '<div class="print-front-page print-cover-page cpb-cover">COVER A</div>',
  plainNumbers: true, noStudentFields: true, answerKeyExtras: true,
  sectionHtmlById: { a1: '<div class="cpb-lead">LEAD A</div>', b1: '<div class="cpb-lead">LEAD B</div>' },
  paper: {
    numbers: rNumbers,
    pageHtmlById: { b1: '<div class="print-front-page cpb-cover" data-front-before="__lo__b1" data-front-restart="1">COVER B</div>' },
    noBracketIds: new Set(['a1','a2']),
    tailHtml: '<div class="print-question-chunk cpb-answersheet">ANSWER SHEET</div>',
  },
});

ok('Booklet A cover leads the document', paperHtml.indexOf('COVER A') === 0 || paperHtml.indexOf('COVER A') < paperHtml.indexOf('LEAD A'));
ok('Booklet B cover is emitted BEFORE Booklet B, not at the front',
  paperHtml.indexOf('COVER B') > paperHtml.indexOf('a2') && paperHtml.indexOf('COVER B') < paperHtml.indexOf('LEAD B'),
  'idx COVER B=' + paperHtml.indexOf('COVER B') + ' LEAD B=' + paperHtml.indexOf('LEAD B'));
ok('…and it names the chunk it goes before', /data-front-before="__lo__b1"/.test(paperHtml));
ok('every question carries its paper number in the gutter',
  ['1','2','3','4'].every(n => paperHtml.includes('<span class="print-q-paper-num">' + n + '</span>')));
ok('…and the chunk reserves room for it', (paperHtml.match(/print-question-chunk print-q-paper/g)||[]).length === 4);
ok('no "Question N" heading is printed on a paper', !/print-q-header-plain/.test(paperHtml));
ok('Booklet A prints NO answer bracket', !/print-mcq-answer/.test(paperHtml));
ok('…but its options are still there', (paperHtml.match(/mcq-opts/g)||[]).length === 2);
ok('Booklet B prints its ruled answer box', (paperHtml.match(/print-open-answer-box/g)||[]).length === 2);
ok('the answer sheet is the last thing before the key',
  paperHtml.indexOf('ANSWER SHEET') > paperHtml.indexOf('b2') && paperHtml.indexOf('ANSWER SHEET') < paperHtml.indexOf('print-answer-key-page'));
ok('the key numbers its rows by the PAPER number, not by position',
  ['Question 1','Question 2','Question 3','Question 4'].every(s => paperHtml.includes('<h4>' + s + '</h4>')));
ok('…and every question is on it', (paperHtml.match(/print-ak-question/g)||[]).length === 4);
ok('the MCQ answer reaches the key', paperHtml.includes('Answer:two'));
ok('the open answer reaches the key', paperHtml.includes('the model answer'));

// …and with the bracket switched ON, which is the other half of the promise.
const html2 = bwhBuild(rA, 'Mock', { plainNumbers: true, paper: { numbers: rNumbers, noBracketIds: null } });
ok('with the bracket switched on it comes back', (html2.match(/print-mcq-answer/g)||[]).length === 2);
// …and with NO paper option at all, nothing about an ordinary worksheet moved.
const plain = bwhBuild(rA.concat(rB), 'Sheet', { plainNumbers: true });
ok('an ordinary worksheet is unchanged: "Question N" headings',
  (plain.match(/print-q-header-plain/g)||[]).length === 4 && !/print-q-paper/.test(plain));
ok('…and its MCQs keep their bracket', (plain.match(/print-mcq-answer/g)||[]).length === 2);

console.log((fails ? '✗ ' : '✓ ') + (ran - fails) + '/' + ran + ' checks passed');
process.exit(fails ? 1 : 0);
