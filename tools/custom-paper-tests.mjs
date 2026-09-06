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

  const run = cut('async function _cpbRunBuild(mode) {', '\nfunction cpbCancel', 'the read');
  ok('the page uses the ONE shared screenshot-run reader', /readQuestionRun\(shots, \{/.test(run),
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


/* ------------------------------------------------------------------ *
 * 🖼 THE FIGURES — cropped, and REDRAWN in clean black and white.      *
 *                                                                     *
 * "Auto enhanced black and white and clean" is one image-model call    *
 * per picture, so it is the CALLER's decision and the default is off:  *
 * the exam paper builder and the bulk import would spend dozens of     *
 * them on an imported paper. Both directions are silent — no budget    *
 * and every figure on this page stays a grey photograph of print, one  *
 * that is per-CALL rather than per-RUN and a forty-question paper has  *
 * no cap at all.                                                       *
 * ------------------------------------------------------------------ */
const fill = cut('async function _fillBlocksFromAiBoxes(', '// Editor flow: crop the AI-selected', '_fillBlocksFromAiBoxes');
ok('each re-render is reported, so a caller can hold a budget across calls',
  /if \(onEnhance\) onEnhance\(\);/.test(fill));
ok('…and onEnhance fires INSIDE the enhancement branch, never per crop',
  fill.indexOf('if (onEnhance) onEnhance();') > fill.indexOf('enhanced < maxEnhance'));
ok('the default is still 3, so no existing caller moved',
  /Number\.isFinite\(opts\.maxEnhance\)\) \? opts\.maxEnhance : 3/.test(fill));

const cropInto = cut('async function _epCropInto(', '// ---- Reading the question screenshots', '_epCropInto');
ok('_epCropInto takes a budget rather than a hard 0', /_epCropInto\(imgBlocks, qd, shots, onStatus, budget\)/.test(cropInto));
ok('…and defaults to NO enhancement when it is not given',
  /Number\.isFinite\(budget\.left\)\) \? Math\.max\(0, budget\.left\) : 0/.test(cropInto));
ok('…and decrements the SHARED object, not a local copy',
  /onEnhance: \(\) => \{ if \(budget\) budget\.left = Math\.max\(0, \(budget\.left \|\| 0\) - 1\); \}/.test(cropInto));

const run = cut('async function readQuestionRun(', '\nasync function _epRunBuild(', 'readQuestionRun');
ok('ONE budget for the whole run', /const enhance = \{ left: Math\.max\(0, Number\(opt\.enhance\) \|\| 0\) \};/.test(run));
ok('…and it reaches BOTH crop calls — the question and the continuation',
  (run.match(/enhance\);/g) || []).length === 2);

const epRun = cut('async function _epRunBuild(', '\nasync function epReadKey(', '_epRunBuild');
ok('the exam paper builder still asks for none — an imported paper is dozens of calls',
  !/enhance:/.test(epRun));

const cpbRun = cut('async function _cpbRunBuild(mode) {', '\n// ---- The list: order, booklet', '_cpbRunBuild');
ok('Custom Paper asks for the run-wide budget', /enhance: _cpbMetaGet\('enhance'\) \? CPB_ENHANCE_MAX : 0/.test(cpbRun));
ok('…and the switch is ON by default — the figures are the paper',
  /\n  enhance: true,/.test(cut('const CPB_META_DEFAULTS = {', '};', 'CPB_META_DEFAULTS')));
ok('…and the setup card offers it', /cpbSetMeta\('enhance', this\.checked\)/.test(src));

// The crop's own promise: no question wording on the figure, and no label off it.
const refine = cut('async function _aiRefineCrop(', '\n// Fill a question\'s image blocks', '_aiRefineCrop');
ok('the refine pass KEEPS everything belonging to the figure',
  /INCLUDE everything that belongs to the figure/.test(refine) && /axis titles/.test(refine));
ok('…and cuts the question sentences that came with it',
  /EXCLUDE full sentences \/ paragraphs of question/.test(refine));
ok('…and never cuts through one of the figure\'s own words',
  /Never cut through a word that belongs to the figure/.test(refine));

/* ------------------------------------------------------------------ *
 * ✏️ EDIT ONE QUESTION — the SAME editor, and back to the same place.  *
 *                                                                     *
 * A paper question is in NEITHER `questionBank` nor `vettingList`, so  *
 * every ordinary save in that editor is wrong for it: `editQuestion`   *
 * would find nothing at all, and a save would file one question into   *
 * the bank early — leaving the paper and the bank each holding half    *
 * the truth, with nothing on any screen reporting it.                  *
 * ------------------------------------------------------------------ */
const loader = cut('function _editorLoadQuestion(q) {', '\nfunction duplicateQuestion(', '_editorLoadQuestion');
ok('the loader takes the OBJECT, so a question outside the bank can be opened',
  /function _editorLoadQuestion\(q\) \{/.test(loader));
ok('…and never looks one up itself', !/questionBank\.find|vettingList\.find/.test(loader));
const eq_ = cut('function editQuestion(id) {', '\n// PUT ONE QUESTION INTO THE BLOCK EDITOR', 'editQuestion');
ok('editQuestion is the lookup and calls that ONE loader', /_editorLoadQuestion\(q\);/.test(eq_));
ok('…and clears the paper question, or a bank edit would be written into a paper',
  /_cpbEdit = null;/.test(eq_));

const edit = cut('function cpbEditQuestion(id) {', '\n// =====================================================================\n// 📁 SAVED PAPERS', 'cpbEditQuestion');
ok('the paper edit comes back to this page', /_editReturnPage = 'custompaper';/.test(edit));
ok('…on the same question', /_cpbEditFocus = q\.id;/.test(edit));
ok('…and it opens the shared editor rather than one of its own', /_editorLoadQuestion\(q\)/.test(edit));
ok('the save writes into the PAPER and nowhere else',
  /_cpbQuestions\[at\] = q;/.test(edit) && !/saveQuestion\(/.test(edit));
ok('a question that has since left the paper is SAID, not silently appended',
  /no longer on the paper/.test(edit));
ok('the carry-over reads the SAME allowlist carryOverQuestionMeta reads',
  /EDITOR_OWNED_QUESTION_FIELDS\.has\(k\)/.test(edit));
ok('…so the teacher\'s own ⇄ booklet override survives an edit',
  !/_cpbBook/.test(cut('function _cpbCarryOver(', '\nfunction cpbEditSave', '_cpbCarryOver')));

// Every bank-writing door refuses while a paper question is open.
['function saveEditedQuestion() {', 'function saveEditToBank() {', 'function moveEditToVetting() {'].forEach(fn => {
  const head = src.slice(src.indexOf(fn), src.indexOf(fn) + 700);
  ok(fn.replace(/function | \{/g, '') + ' routes a paper question back to the paper',
    /_cpbEditActive\(\)\) \{ cpbEditSave\(\); return; \}/.test(head));
});
ok('📅 Schedule release refuses outright — there is nothing in the bank to date',
  /_cpbEditActive\(\)\) \{ showToast\('Send the paper to the bank first/.test(src));
ok('…and its save path refuses too',
  /async function saveEditorRelease\(\) \{\n  if \(_cpbEditActive\(\)\) return false;/.test(src));

// Leaving the editor by ANY route ends the paper edit.
const sem = cut('function setEditMode(isEditing) {', '\nfunction addToBank()', 'setEditMode');
ok('setEditMode(false) clears the paper question — the one route out they all take',
  /_cpbEdit = null;\n  \}/.test(sem));
ok('…and the ordinary edit row is swapped for the paper one', /cpbEditActions/.test(sem));
ok('the paper row exists in the markup', /id="cpbEditActions"/.test(html));
ok('…and it offers exactly one save, back to the paper', /onclick="cpbEditSave\(\)"/.test(html));
ok('…and never a bank one', (() => {
  const at = html.indexOf('id="cpbEditActions"');
  const row = html.slice(at, html.indexOf('</div>', html.indexOf('cpb-edit-note', at)));
  return !/saveEditToBank|addToBank|moveEditToVetting|openEditorRelease/.test(row);
})());

ok('the row is put back under the teacher on return', /_cpbFocusScroll\(\);/.test(cut('function cpbRender() {', '\nfunction _cpbLibHtml(', 'cpbRender')));
ok('…and the row carries the id to find it by', /data-qid="\$\{escapeHtml\(String\(q\.id\)\)\}"/.test(src));
ok('…spent on use, so a later render does not drag the page about',
  /_cpbEditFocus = '';/.test(cut('function _cpbFocusScroll() {', '\n// =====================================================================\n// 📁 SAVED PAPERS', '_cpbFocusScroll')));

/* ------------------------------------------------------------------ *
 * 📁 SAVED PAPERS — a paper is a thing you come back to.               *
 *                                                                     *
 * The per-tab IndexedDB draft is a CRASH NET, not a library: keyed by  *
 * tab, one paper per window, gone the moment the next one starts.      *
 * ------------------------------------------------------------------ */
const lib = cut('const CPB_LIB_MAX = 60;', '\nfunction cpbSetMeta(', 'library');
ok('a paper is saved under the bank OWNER, like every other authored thing',
  /collection\(db, 'users', _bankOwnerUid\(\), 'customPapers'\)/.test(lib));
ok('the SCREENSHOTS are not saved — a document dies at 1 MB and they are megabytes',
  !/questions: _cpbQuestions,[\s\S]{0,200}shots/.test(lib) && /questions: _cpbQuestions,/.test(lib));
ok('…and a paper too big is refused BEFORE the write, naming the size',
  /bytes > CPB_LIB_MAX_BYTES/.test(lib) && /Math\.round\(bytes \/ 1024\)/.test(lib));
ok('a paper with no name is refused — the name is what it is listed under',
  /Give the paper a name/.test(lib));
ok('opening REPLACES the page, so it asks first',
  /showConfirm\('Open /.test(lib) && /It replaces the paper on this page/.test(lib));
ok('…and says outright when what is on the page has never been saved',
  /has never been saved/.test(lib));
ok('an opened paper is NOT dirty — there are no screenshots for it to be out of step with',
  /_cpbDirty = false;/.test(lib));
ok('deleting the paper does not touch the questions already in the bank',
  /stays there<\/b> — this is the paper, not the questions/.test(lib));
ok('a failed load does not have every render trying again',
  /_cpbLibLoaded = true;\n  try \{/.test(lib));
ok('a denied write is NAMED — it is a one-line rules fix',
  /permission-denied/.test(lib));
ok('✚ New paper lets GO of the saved one rather than deleting it',
  /_cpbLibId = '';/.test(cut('function cpbNewPaper() {', '\nfunction cpbSetMeta(', 'cpbNewPaper')));

const commit = cut('async function _cpbCommit() {', '\nfunction cpbRender(', '_cpbCommit');
ok('a SAVED paper is not cleared by a send — the shelf was for coming back to it',
  /if \(_cpbLibId\) _cpbLibMarkSent\(\)/.test(commit));
ok('…and an unsaved one still clears, exactly as before', /else \{\n      _cpbQuestions = \[\];/.test(commit));
ok('the send warns when the paper is about to be cleared unsaved',
  /This paper is not saved\./.test(src));
ok('the sent stamp is best effort — the questions really are in the bank either way',
  /a toast saying the send failed would be untrue/.test(src));

// Every handler the page's own markup calls has to be on window.
['cpbEditQuestion','cpbEditSave','cpbSavePaper','cpbLibOpen','cpbLibDelete','cpbNewPaper'].forEach(fn => {
  ok('window.' + fn + ' is exported — the page is inline on* handlers',
    new RegExp('window\\.' + fn + ' = ').test(src));
});


/* ------------------------------------------------------------------ *
 * 📸 READING ONLY WHAT HAS NOT BEEN READ.                             *
 *                                                                     *
 * A paper is assembled over an afternoon, so the ordinary press must   *
 * read the screenshots just pasted in and APPEND. Every failure here   *
 * is silent in one direction or the other: the append re-reading the   *
 * whole pile is minutes of AI calls and the teacher's own order and    *
 * booklet moves thrown away, while a JOIN made where the screenshots   *
 * are not adjacent grafts two unrelated questions into one.            *
 * ------------------------------------------------------------------ */
const unreadFns = cut(
  '// 📸 READING ONLY THE SCREENSHOTS THAT HAVE NOT BEEN READ',
  '\nfunction _cpbId()',
  'unread helpers');

const inc = new Function(`
  let _cpbShots = [], _cpbQuestions = [], _cpbLastRead = '';
  ${unreadFns}
  return {
    _cpbUnread, _cpbUnreadIsTail, _cpbSeedQuestion,
    set: (shots, qs, last) => { _cpbShots = shots; _cpbQuestions = qs || []; _cpbLastRead = last || ''; },
  };
`)();

const shot = (id, status) => ({ id, status: status || 'new' });
const done = id => shot(id, 'done');

// ---- which screenshots count as unread
inc.set([done('s1'), done('s2'), shot('s3'), shot('s4')], [], '');
eq('the unread set is the ones never read', inc._cpbUnread().map(s => s.id).join(','), 's3,s4');
inc.set([done('s1'), shot('s2', 'empty')], [], '');
eq('a screenshot that held nothing is READ, not unread', inc._cpbUnread().length, 0);
inc.set([done('s1'), shot('s2', 'error')], [], '');
eq('…but one that FAILED is unread, so the same button retries it',
   inc._cpbUnread().map(s => s.id).join(','), 's2');

// ---- the seed, and the one case it must refuse
const q1 = { id: 'q1' }, q2 = { id: 'q2' };
inc.set([done('s1'), done('s2'), shot('s3')], [q1, q2], 'q2');
ok('the unread screenshots at the END of the pile are a tail', inc._cpbUnreadIsTail());
ok('…so the run carries on from the question the last read finished on',
   inc._cpbSeedQuestion() === q2);
inc.set([done('s1'), shot('s2'), done('s3')], [q1, q2], 'q2');
ok('an unread screenshot in the MIDDLE is not a tail', !inc._cpbUnreadIsTail());
ok('…so nothing is joined — those pages are not adjacent to the last question read',
   inc._cpbSeedQuestion() === null,
   'joined anyway, a retried failure from the middle is grafted onto a question from the end');
inc.set([shot('s1'), shot('s2')], [], '');
ok('a pile where NOTHING has been read is not a tail either — there is nothing before it',
   !inc._cpbUnreadIsTail() && inc._cpbSeedQuestion() === null);
inc.set([done('s1'), done('s2')], [q1, q2], 'q2');
ok('a pile with nothing unread offers no seed', inc._cpbSeedQuestion() === null);
inc.set([done('s1'), shot('s2')], [q1, q2], 'gone');
ok('a join point whose question has since been removed seeds nothing',
   inc._cpbSeedQuestion() === null,
   'a stale id must fall back to filing the entry as its own question, never throw');
inc.set([done('s1'), shot('s2')], [q1, q2], '');
ok('…and so does a paper that has never been read', inc._cpbSeedQuestion() === null);

// ---- the reader carries a seed across two runs
const readerSrc = cut('async function readQuestionRun(shots, o) {', '\nasync function _epRunBuild', 'seeded reader');
ok('`last` starts as the caller\'s seed, so an appended run can continue a question',
   /let last = opt\.seed \|\| null;/.test(readerSrc));
ok('…and the seed is never pushed into the run\'s own questions',
   readerSrc.indexOf('opt.onExtend(last)') < readerSrc.indexOf('questions.push(q)'),
   'pushed, an extended question is added to the paper a second time');

// ---- the two buttons
const buildFn = cut('function cpbBuild() {', '\nfunction cpbRebuild()', 'cpbBuild');
ok('the ordinary press appends', /_cpbRunBuild\('append'\)/.test(buildFn));
ok('…asks nothing, because it destroys nothing', !/showConfirm/.test(buildFn));
ok('…and says so rather than doing nothing when everything has been read',
   /Every screenshot has been read/.test(buildFn));
const rebuildFn = cut('function cpbRebuild() {', '\n// mode \'append\' reads', 'cpbRebuild');
ok('🔁 Read everything again is a SEPARATE button', /_cpbRunBuild\('all'\)/.test(rebuildFn));
ok('…and it asks first, because it replaces the paper', /showConfirm\(/.test(rebuildFn));
ok('…and points at the other button, so nobody presses this one to add three questions',
   /Read<\/b> instead/.test(rebuildFn));

const runFn = cut('async function _cpbRunBuild(mode) {', '\nfunction cpbCancel', 'the run');
ok('an APPEND reads only the unread screenshots', /const shots = append \? _cpbUnread\(\) : _cpbShots;/.test(runFn));
ok('…and keeps every question already on the paper',
   /if \(!append\) \{\n    _cpbQuestions = \[\];/.test(runFn),
   'clearing them is the teacher\'s order and booklet moves thrown away by the ordinary button');
ok('an append with NO questions yet is just an ordinary read',
   /mode === 'append' && _cpbQuestions\.length > 0/.test(runFn));
ok('the seed is taken BEFORE the run resets any status',
   runFn.indexOf('_cpbSeedQuestion()') < runFn.indexOf('_cpbBusy = true'),
   'read after, `_cpbUnreadIsTail` is asked about a pile that has just been wiped');
ok('a retried failure starts clean, or its red card outlives the retry',
   /shots\.forEach\(s => \{ s\.status = 'new'; s\.err = ''/.test(runFn));
ok('the join point is recorded on every question the run finishes',
   /_cpbLastRead = q\.id/.test(runFn));
ok('…and a full re-read clears it first', /_cpbLastRead = '';/.test(runFn));
ok('the JOIN is a fact the run reports, not arithmetic',
   /if \(seed && q === seed\) joined = true;/.test(runFn),
   'an extended question is never added, so counting the totals can never see it');
ok('an append does NOT clear the removed-screenshot warning',
   /if \(!append && !_cpbCancel && !res\.failed\) _cpbDirty = false;/.test(runFn),
   'it adds questions and answers nothing about a screenshot that was removed after being read');

// ---- the dirty rule moved: ADDING is ordinary, REMOVING is the warning
const addFn = cut('async function _cpbAddFiles(files) {', '\nfunction cpbPick()', '_cpbAddFiles');
ok('adding a screenshot no longer nags for a full re-read', !/_cpbDirty = true/.test(addFn),
   'it arrives unread and the ordinary button reads it — nagging sends the teacher to the destructive one');
const rmFn = cut('function cpbRemove(id) {', '\nfunction cpbClearShots()', 'cpbRemove');
ok('removing an UNREAD screenshot changes nothing about the paper',
   /gone\.status !== 'new' && _cpbQuestions\.length/.test(rmFn));
ok('…and removing a READ one raises the warning', /_cpbDirty = true/.test(rmFn));
const clearFn = cut('function cpbClearShots() {', '\n// Bound ONCE on the document', 'cpbClearShots');
ok('clearing raises it only when a READ screenshot went',
   /const anyRead = _cpbShots\.some\(s => s && s\.status !== 'new'\);/.test(clearFn));

// ---- the join point is cleared wherever the paper changes underneath it
ok('a question taken off the paper stops being the join point',
   /if \(_cpbLastRead === id\) _cpbLastRead = '';/.test(src));
ok('opening a saved paper clears it — its screenshots are not here',
   /_cpbDirty = false;\n      \/\/ No screenshots came with it/.test(src));
ok('a full send clears it with the paper', /_cpbDirty = false;\n      _cpbLastRead = '';/.test(src));
ok('✚ New paper clears it', /_cpbDirty = false;\n    _cpbLastRead = '';/.test(src));
ok('the draft carries it, so a reload picks the pile up where it was',
   /lastRead: _cpbLastRead, questions: _cpbQuestions/.test(src)
   && /_cpbLastRead = String\(\(work && work\.lastRead\) \|\| ''\);/.test(src));

// ---- the card says which of the two states it is in
const zoneFn = cut('function _cpbZoneHtml() {', '\n// One row of the paper', 'the screenshot card');
ok('the unread count is on the heading', /cpb-pill-new/.test(zoneFn));
ok('the button names how many it will read', /Read the \$\{unread\} new/.test(zoneFn));
ok('…and is disabled when there is nothing unread', /\$\{n && unread \? '' : 'disabled'\}/.test(zoneFn));
ok('the two lines are different states, never both', /!_cpbDirty && built && unread/.test(zoneFn),
   'the amber warning and the blue "more to read" note say opposite things');
ok('the warning now names the REMOVAL, which is the only thing it still means',
   /A screenshot the paper was built from has been removed/.test(zoneFn));
ok('the blue note is styled apart from the amber one',
   /\.cpb-new-line \{[^}]*#eff6ff/.test(html) && /\.cpb-pill-new \{/.test(html),
   'read as the same thing, a teacher presses the button that throws their paper away');
ok('window.cpbRebuild is exported — the page is inline on* handlers',
   /window\.cpbRebuild = cpbRebuild;/.test(src));

console.log((fails ? '✗ ' : '✓ ') + (ran - fails) + '/' + ran + ' checks passed');
process.exit(fails ? 1 : 0);