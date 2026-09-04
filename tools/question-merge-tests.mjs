// Regression tests for 🔗 MERGING TWO QUESTIONS THAT ARE REALLY ONE — the
// page-break stitch in ⚡ Rapid add, and 🔗 Merge selected in the vetting list.
// Run with:
//     node tools/question-merge-tests.mjs            all cases
//     node tools/question-merge-tests.mjs <name>     one case
//
// It loads the REAL part vocabulary and the REAL `qMerge*` core out of app.js.
//
// A question printed across a page break comes out of the PDF importer as TWO
// questions — the stem, the figure and parts (a) and (b) from one page, part
// (c) from the next — and NEITHER can be answered on its own. Joining them
// back up is easy to do and very easy to do wrong, and every way it goes wrong
// is silent: the merged question renders, saves and prints perfectly however
// badly it was stitched.
//
//  • THE ORDER IS THE CALLER'S. Blocks are concatenated in the order given, so
//    page 1 then page 2. The vetting dialog sorts oldest-first for exactly
//    this reason — the list itself is newest-first, so taking the order off
//    the screen puts page 2 above page 1 every time.
//  • BLOCK IDS MUST NOT COLLIDE. Two questions built in the same millisecond
//    can carry the same ids, and every keyword and blank map is keyed by one,
//    so a collision silently hands one block another's blanks.
//  • PART LETTERS ARE FIXED ONLY WHEN THEY ARE BROKEN. (a)(b) + (c)(d) already
//    reads in order and must be left BYTE FOR BYTE alone; (a)(b) + (a)(b) must
//    not, because qPartMap then opens a second span keyed (a) and the answer
//    key prints two "(a)" headings.
//  • A RE-LETTERED BLOCK IS STRIPPED FIRST, while the OLD letter is still on
//    it — the only moment a marker that merely repeats it can be recognised.
//    Miss it and the paper reads "(c) (b) Explain why…".
//  • THE HOST KEEPS ITS ID, so the merged question replaces the first source
//    in place — and so the write is to a document that already exists.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

// Every cut ends with a NEWLINE. A window that stops mid-comment glues the
// next window's first line onto a `//`, which comments the declaration out and
// surfaces a thousand lines later as "X is not defined".
const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b) + '\n';
};

const mergeSection = cut('const QMERGE_MAX = 8;', '\n// The compact "Part" control', 'merge core');

// The world the merge runs in. `qScopeExplanations` is stubbed and COUNTED —
// what it does is pinned by its own harness; what matters here is that the
// merge calls it, because both halves' parts are only all known once they are
// together.
const preamble = `
const HOOK = { scoped: 0, warned: [] };
let _idSeq = 0;
function generateBlockId() { return 'gen_' + (++_idSeq); }
function kwFieldKey(blockId, field) {
  const f = String(field || 'content');
  return (f === 'content' || f === 'text') ? String(blockId) : String(blockId) + '_' + f;
}
function qScopeExplanations(blocks) { HOOK.scoped++; }
const console = { warn: (...a) => HOOK.warned.push(a.join(' ')), error: (...a) => HOOK.warned.push(a.join(' ')) };
`;

const M = new Function(
  preamble +
  cut('const QPART_LETTERS', 'function qPartsUsed', 'part core') +
  cut('function qPartsUsed(blocks) {', '\n// The run of blocks belonging to ONE part', 'partsUsed') +
  cut('function qPartOf(map, block)', '\n// 🔗 TWO QUESTIONS THAT ARE REALLY ONE', 'partOf + opens + openerTypes') +
  mergeSection + `
return {
  HOOK,
  QMERGE_MAX, QPART_ASSIGN,
  merge: qMergeQuestions,
  preview: qMergePartPreview,
  fixParts: qMergeFixParts,
  uniqueIds: qMergeUniqueIds,
  lettersOk: qMergeLettersOk,
  openerLetters: qMergeOpenerLetters,
  map: qPartMap, partOf: qPartOf, opens: qBlockOpensPart, partsUsed: qPartsUsed,
  label: qPartLabel,
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
  }
};

let n = 0;
const B = (o) => Object.assign({ id: 'b' + (++n) }, o);
const txt = (content, part) => ({ id: 'x', type: 'text', content, part: part || undefined });
// A question, as the vetting list holds one.
const Q = (id, blocks, extra) => Object.assign({
  id, title: 'Q ' + id, topic: 'Heat', category: 'PSLE - OEQ',
  blocks, blanks: {}, answerKeywords: {}, tags: [],
}, extra || {});
const keysOf = q => { const m = M.map(q.blocks); return q.blocks.map(b => M.partOf(m, b)); };
const reset = () => { M.HOOK.scoped = 0; M.HOOK.warned = []; };

// ── the reported case: a question that ran over a page break ────────────────
test('a question split over a page break comes back as ONE, in page order', () => {
  reset();
  const page1 = Q('q1', [
    { id: 's1', type: 'text', content: 'Ali set up the apparatus shown.' },
    { id: 's2', type: 'image', url: 'diagram.png' },
    { id: 's3', type: 'text', content: 'Name the process.', part: 'a' },
    { id: 's4', type: 'plainanswer', content: 'Evaporation.' },
    { id: 's5', type: 'text', content: 'Explain your answer.', part: 'b' },
    { id: 's6', type: 'plainanswer', content: 'The water gained heat.' },
  ]);
  const page2 = Q('q2', [
    { id: 't1', type: 'text', content: 'Suggest one improvement.', part: 'c' },
    { id: 't2', type: 'plainanswer', content: 'Cover the beaker.' },
  ]);
  const m = M.merge([page1, page2]);
  eq(m.id, 'q1', 'the HOST keeps its id — the merged question replaces it in place');
  eq(m.blocks.length, 8, 'every block of both halves');
  eq(m.blocks.map(b => b.type), ['text', 'image', 'text', 'plainanswer', 'text', 'plainanswer', 'text', 'plainanswer'], 'in page order');
  eq(M.partsUsed(m.blocks), ['a', 'b', 'c'], 'the parts read a, b, c');
  // Part (c)'s answer is filed under (c) — the whole point: on its own it had
  // no stem, no figure and no way to be marked.
  eq(keysOf(m).slice(-2), ['c', 'c'], 'the continuation is inside its own part');
});

test('a sequence that already reads in order is left BYTE FOR BYTE alone', () => {
  reset();
  const a = Q('q1', [txt('Stem.'), txt('One.', 'a'), txt('Two.', 'b')]);
  const b = Q('q2', [txt('Three.', 'c'), txt('Four.', 'd')]);
  const before = JSON.stringify(a.blocks.concat(b.blocks).map(x => x.part));
  const m = M.merge([a, b]);
  eq(m.blocks.map(x => x.part), JSON.parse(before), 'no letter moved');
  eq(M.partsUsed(m.blocks), ['a', 'b', 'c', 'd'], 'a b c d');
});

// ── the collision that makes the answer key lie ─────────────────────────────
test('two halves that BOTH start at (a) are re-lettered a b c d', () => {
  reset();
  // qPartMap would otherwise open a SECOND span keyed (a): the answer key
  // prints two "(a)" headings and anything keyed by part silently keeps one.
  const a = Q('q1', [txt('One.', 'a'), txt('Two.', 'b')]);
  const b = Q('q2', [txt('Three.', 'a'), txt('Four.', 'b')]);
  const m = M.merge([a, b]);
  eq(M.partsUsed(m.blocks), ['a', 'b', 'c', 'd'], 'the letters are re-issued in document order');
  eq(m.blocks.map(x => x.part), ['a', 'b', 'c', 'd'], 'on the blocks themselves');
});

test('a marker still typed in the wording comes off BEFORE the letter changes', () => {
  reset();
  // qPartBodyHtml hides a marker only while it matches the block's own part.
  // Re-letter (b) to (c) without stripping and the paper reads "(c) (b) …".
  const a = Q('q1', [txt('<p>(a) One.</p>', 'a'), txt('<p>(b) Two.</p>', 'b')]);
  const b = Q('q2', [txt('<p>(a) Three.</p>', 'a'), txt('<p>(b) Four.</p>', 'b')]);
  const m = M.merge([a, b]);
  m.blocks.forEach((blk, i) => {
    ok(!/^\s*<p>\s*\(/.test(blk.content), 'block ' + i + ' still carries a marker: ' + blk.content);
  });
  eq(m.blocks.map(x => x.part), ['a', 'b', 'c', 'd'], 'and the letters are right');
});

test('re-lettering is ALL or NOTHING — more parts than letters leaves them alone', () => {
  reset();
  const many = i => txt('Part ' + i, M.QPART_ASSIGN[i % M.QPART_ASSIGN.length]);
  const a = Q('q1', Array.from({ length: M.QPART_ASSIGN.length }, (_, i) => many(i)));
  const b = Q('q2', [txt('One more.', 'a')]);
  const before = a.blocks.concat(b.blocks).map(x => x.part);
  const m = M.merge([a, b]);
  // Half a re-lettering is worse than none: some parts renamed and some not is
  // a question whose answer key and whose paper disagree.
  eq(m.blocks.map(x => x.part), before, 'nothing moved');
});

// ── ids, keywords and blanks ────────────────────────────────────────────────
test('colliding block ids are re-keyed, carrying their keywords and blanks', () => {
  reset();
  const a = Q('q1', [{ id: 'b1', type: 'plainanswer', content: 'The water evaporated.' }], {
    answerKeywords: { b1: { 2: true } },
    blanks: { b1: { 1: true } },
  });
  const b = Q('q2', [{ id: 'b1', type: 'plainanswer', content: 'It condensed on the lid.' }], {
    answerKeywords: { b1: { 1: true } },
    blanks: { b1: { 3: true } },
  });
  const m = M.merge([a, b]);
  const ids = m.blocks.map(x => x.id);
  eq(new Set(ids).size, 2, 'two different ids: ' + ids.join(', '));
  eq(ids[0], 'b1', "the host's own id is kept");
  ok(ids[1] !== 'b1', 'the second is re-keyed');
  // …and the maps follow it, or one block silently wears the other's blanks.
  eq(m.answerKeywords[ids[0]], { 2: true }, "the host's keywords");
  eq(m.answerKeywords[ids[1]], { 1: true }, "the second block's keywords, under its NEW id");
  eq(m.blanks[ids[0]], { 1: true }, "the host's blanks");
  eq(m.blanks[ids[1]], { 3: true }, "the second block's blanks");
});

test('a CER block carries all three of its keyword fields across', () => {
  reset();
  const a = Q('q1', [{ id: 'b1', type: 'answer', claim: 'c', evidence: 'e', reasoning: 'r' }], {
    answerKeywords: { b1_claim: { 0: true }, b1_evidence: { 1: true }, b1_reasoning: { 2: true } },
  });
  const b = Q('q2', [{ id: 'b1', type: 'answer', claim: 'C', evidence: 'E', reasoning: 'R' }], {
    answerKeywords: { b1_claim: { 5: true }, b1_evidence: { 6: true }, b1_reasoning: { 7: true } },
  });
  const m = M.merge([a, b]);
  const second = m.blocks[1].id;
  eq(m.answerKeywords[second + '_claim'], { 5: true }, 'claim');
  eq(m.answerKeywords[second + '_evidence'], { 6: true }, 'evidence');
  eq(m.answerKeywords[second + '_reasoning'], { 7: true }, 'reasoning');
});

test('the sources themselves are never touched', () => {
  reset();
  const a = Q('q1', [txt('One.', 'a'), txt('Two.', 'b')]);
  const b = Q('q2', [txt('Three.', 'a')]);
  const snapA = JSON.stringify(a), snapB = JSON.stringify(b);
  M.merge([a, b]);
  eq(JSON.stringify(a), snapA, 'source 1 is untouched — a merge that fails must lose nothing');
  eq(JSON.stringify(b), snapB, 'source 2 is untouched');
});

// ── the `letter` option ─────────────────────────────────────────────────────
test('two unlettered questions merge straight through by default', () => {
  reset();
  const a = Q('q1', [txt('Stem, continued…')]);
  const b = Q('q2', [txt('…on the next page.')]);
  const m = M.merge([a, b]);
  eq(M.partsUsed(m.blocks), [], 'no parts invented — the second is the REST of the first');
});

test('…and become (a) and (b) when the author asks for it', () => {
  reset();
  const a = Q('q1', [txt('Name the process.'), { id: 'a1', type: 'plainanswer', content: 'Evaporation.' }]);
  const b = Q('q2', [txt('Explain your answer.'), { id: 'a2', type: 'plainanswer', content: 'It gained heat.' }]);
  const m = M.merge([a, b], { letter: true });
  eq(M.partsUsed(m.blocks), ['a', 'b'], 'one part each');
  eq(keysOf(m), ['a', 'a', 'b', 'b'], 'and each answer under its own');
});

test('the letter option follows on from a source that already HAS parts', () => {
  reset();
  const a = Q('q1', [txt('One.', 'a'), txt('Two.', 'b')]);
  const b = Q('q2', [txt('Three.')]);
  const m = M.merge([a, b], { letter: true });
  eq(M.partsUsed(m.blocks), ['a', 'b', 'c'], 'the unlettered half becomes (c), not a second (a)');
});

test('a source with nothing that may open a part is left to inherit', () => {
  reset();
  // QPART_OPENER_TYPES is text and nothing else: a picture opening a part
  // would print a heading on the answer key with nothing marking it on paper.
  const a = Q('q1', [txt('Ask something.')]);
  const b = Q('q2', [{ id: 'i1', type: 'image', url: 'x.png' }]);
  const m = M.merge([a, b], { letter: true });
  eq(M.partsUsed(m.blocks), ['a'], 'only the half that could carry one');
});

// ── the meta resolves the cautious way ──────────────────────────────────────
test('the merged question is filed no more confidently than its least sure half', () => {
  reset();
  const a = Q('q1', [txt('One.')], { topicConfidence: 'high', tags: ['heat'] });
  const b = Q('q2', [txt('Two.')], { topicConfidence: 'low', tags: ['heat', 'evaporation'] });
  const m = M.merge([a, b]);
  eq(m.topicConfidence, 'low', 'the "⚠ check topic" badge survives the merge');
  eq(m.tags, ['heat', 'evaporation'], 'tags are unioned, never one half thrown away');
});

test('every flag that asks a human to look survives, and the dup marker is dropped', () => {
  reset();
  const a = Q('q1', [txt('One.')], { _dupOf: { title: 'x', pct: 90 } });
  const b = Q('q2', [txt('Two.')], { diagramWhole: true, notInSyllabus: true, annotation: true });
  const m = M.merge([a, b]);
  eq(m.diagramWhole, true, '🖼 whole page — still needs cropping');
  eq(m.notInSyllabus, true, 'out of syllabus');
  eq(m.annotation, true, 'an annotation question');
  eq(m._dupOf, undefined, 'the suspicion was about a question that no longer exists in this shape');
});

test('two marking guides are joined, never one silently thrown away', () => {
  reset();
  const a = Q('q1', [txt('One.')], { markingGuide: 'Accept "evaporates".' });
  const b = Q('q2', [txt('Two.')], { markingGuide: 'Unit required.' });
  const m = M.merge([a, b]);
  eq(m.markingGuide, 'Accept "evaporates".\n\nUnit required.', 'both survive');
  // …and the same text twice is not printed twice.
  const c = Q('q3', [txt('Three.')], { markingGuide: 'Same note.' });
  const d = Q('q4', [txt('Four.')], { markingGuide: 'Same note.' });
  eq(M.merge([c, d]).markingGuide, 'Same note.', 'a repeat is not doubled');
});

test('the explanations are scoped again once both halves are together', () => {
  reset();
  const a = Q('q1', [txt('One.', 'a'), { id: 'e1', type: 'explanation', content: 'Because heat moves.' }]);
  const b = Q('q2', [txt('Two.', 'b')]);
  M.merge([a, b]);
  eq(M.HOOK.scoped, 1, 'a note written when only half the parts existed is re-read against all of them');
});

// ── guards ──────────────────────────────────────────────────────────────────
test('a merge of fewer than two questions is not a merge', () => {
  reset();
  eq(M.merge([Q('q1', [txt('One.')])]), null, 'one source');
  eq(M.merge([]), null, 'none');
  eq(M.merge(null), null, 'nothing at all');
});

test('three pages stitch into one question in order', () => {
  reset();
  const p1 = Q('q1', [txt('Stem.'), txt('One.', 'a')]);
  const p2 = Q('q2', [txt('Two.', 'b')]);
  const p3 = Q('q3', [txt('Three.', 'c')]);
  // The feeder stitches page by page, so page 3 merges into the RESULT of the
  // first stitch — never into the half that has already been merged away.
  const m = M.merge([M.merge([p1, p2]), p3]);
  eq(m.id, 'q1', 'still the first page\'s question');
  eq(M.partsUsed(m.blocks), ['a', 'b', 'c'], 'a b c');
  eq(m.blocks.length, 4, 'nothing duplicated by the second stitch');
});

// ── the preview the dialog prints ───────────────────────────────────────────
test('the preview says what the merged question will actually read', () => {
  reset();
  const a = Q('q1', [txt('One.', 'a'), txt('Two.', 'b')]);
  const b = Q('q2', [txt('Three.', 'a')]);
  eq(M.preview([a, b]), ['a', 'b', 'c'], 'the FIXED order, not the sources\' own');
  eq(M.preview([Q('q3', [txt('x')]), Q('q4', [txt('y')])]), [], 'no parts is an honest answer');
  // …and it must not have changed anything by looking.
  eq(a.blocks.map(x => x.part), ['a', 'b'], 'the preview is a read');
  eq(b.blocks.map(x => x.part), ['a'], 'on both sources');
});

test('a sub-part is carried through and still reads under its own letter', () => {
  reset();
  const a = Q('q1', [
    { id: 'p1', type: 'text', content: 'Give a reason.', part: 'b' },
    { id: 'p2', type: 'text', content: 'using similar beakers', subPart: 'i' },
  ]);
  const b = Q('q2', [{ id: 'p3', type: 'text', content: 'placing them together', subPart: 'ii' }]);
  const m = M.merge([a, b]);
  eq(keysOf(m), ['b', 'b.i', 'b.ii'], 'the continuation lands as (b)(ii), not a part of its own');
});

// ── the source itself ───────────────────────────────────────────────────────
test('the PDF stitch and the manual merge are the SAME merge', () => {
  // Two implementations is two chances to order the parts differently, and
  // the automatic one is the one nobody watches.
  ok(/_vetApplyMerge\(\[lastQ, qs\[0\]\]\)/.test(src), 'the PDF feeder stitches with the shared worker');
  const worker = cut('async function _vetApplyMerge(sources, opts) {', '\n// ── …and the same thing', 'apply worker');
  ok(/qMergeQuestions\(list, opts\)/.test(worker), 'and the worker builds it with the shared merge');
  const dialog = cut('async function qmConfirm()', '\n// ====', 'confirm');
  ok(/_vetApplyMerge\(sources/.test(dialog), '…and so does 🔗 Merge');
});

test('the merged question is WRITTEN before anything is deleted', () => {
  // The other order loses work outright: a delete that succeeds followed by a
  // save that fails takes both halves away for good. BOTH workers are pinned:
  // they sit apart in the file and this is the one thing that may never differ
  // between them.
  [
    ['vetting', cut('async function _vetApplyMerge(sources, opts) {', '\n// ── …and the same thing', 'vetting worker'),
      'saveVettingQuestion(merged)', 'deleteVettingDocAwait'],
    ['bank', cut('async function _bankApplyMerge(sources, opts) {', '\n// A merge says these questions', 'bank worker'),
      'saveQuestion(merged)', 'deleteQuestionDocAwait'],
  ].forEach(([where, worker, saveCall, delCall]) => {
    const save = worker.indexOf(saveCall);
    const del = worker.indexOf(delCall);
    ok(save > -1 && del > -1, where + ': both steps are there');
    ok(save < del, where + ': the save comes first');
    ok(/if \(!wrote\)/.test(worker), where + ': a save that did not land deletes NOTHING');
    ok(/qMergeQuestions\(list, opts\)/.test(worker), where + ': and it builds with the shared merge');
  });
});

test('🔗 Merge on the QUESTION BANK is the same merge and the same dialog', () => {
  // A second dialog for the bank would be a second place to get the part order
  // wrong in — on the surface whose whole job is showing that order before
  // anything is written.
  const open = cut('function bankMergeSelected() {', '\nfunction qmClose', 'bank opener');
  ok(/_qmDraft = \{ ids: order, letter: false, scope: 'bank' \}/.test(open), 'it opens the shared qm dialog in bank scope');
  ok(/qmRender\(\)/.test(open), 'and renders it');
  ok(/if \(!_canAuthor\(\)\) return;/.test(open), 'a student is refused in the HANDLER, not merely by a hidden button');
  ok(/QMERGE_MAX/.test(open), 'and the same cap applies');
  // Oldest first: the bank is shown newest-first, so taking the order off the
  // screen would put the second half of a question above the first every time.
  ok(/_questionRecency\(qa\) - _questionRecency\(qb\)/.test(open), 'the sources go in oldest first');
  const confirm = cut('async function qmConfirm()', '\n// ====', 'confirm');
  ok(/_bankApplyMerge\(sources/.test(confirm) && /_vetApplyMerge\(sources/.test(confirm),
     'and Confirm hands to the worker for the list it was opened on');
  ok(/_qmScope\(\) === 'bank'/.test(confirm), 'chosen by the draft’s own scope');
  // The bank worker deletes for good — this app has no bin — so the dialog has
  // to say so rather than reading like the vetting one.
  const render = cut('function qmRender() {', '\nfunction _qmSnippet', 'dialog render');
  ok(/deleted from the question bank/.test(render), 'the bank wording says the others are deleted');
  ok(/this app has no bin/.test(render), 'and that it is permanent');
  ok(/removed from the vetting list/.test(render), 'while the vetting wording is left as it was');
});

test('the bank merge repoints the worksheets that held a removed question', () => {
  // A merge says these questions are ONE now. A saved worksheet left pointing
  // at a source draws its "no longer in the bank" row — a sheet quietly broken
  // by a tidy-up that was never made on it.
  const fn = cut('function _bankMergeRepointWorksheets(hostId, goneIds) {', '\n// ── The dialog', 'repoint');
  ok(/ws\.questionIds = out/.test(fn), 'the list is rewritten');
  ok(/_wsPersistWorksheet\(ws\)/.test(fn), 'and persisted');
  ok(/if \(out\.indexOf\(to\) < 0\) out\.push\(to\)/.test(fn),
     'a sheet holding BOTH halves keeps the host once, at the earlier position');
  // The overrides are keyed by question id, so one left on a removed id would
  // sit on whatever question happened to follow it.
  ok(/wsManualBreaks\.delete\(id\)\) wsManualBreaks\.add\(host\)/.test(fn), 'a manual page break moves to the host');
  ok(/wsMergeUp\.delete\(id\)\) wsMergeUp\.add\(host\)/.test(fn), 'and so does a merge-up');
  const worker = cut('async function _bankApplyMerge(sources, opts) {', '\n// A merge says these questions', 'bank worker');
  ok(/_bankMergeRepointWorksheets\(hostId, gone\)/.test(worker), 'and only the sources that REALLY went are repointed');
});

test('a bank source that would not delete is kept on screen', () => {
  // Its content is inside the merged question either way, so a card taken off
  // a list the database still holds it in is the one state nobody can see.
  const worker = cut('async function _bankApplyMerge(sources, opts) {', '\n// A merge says these questions', 'bank worker');
  ok(/if \(await deleteQuestionDocAwait\(id\)\) \{/.test(worker), 'the delete is awaited and its answer read');
  ok(/else failed\.push\(id\)/.test(worker), 'a refusal is collected');
  ok(/could not be deleted from the bank/.test(worker), 'and said out loud');
});

test('a page is only asked about continuation when it HAS a page before it', () => {
  ok(/continuation: p > 1/.test(src), 'page 1 is never asked whether it continues something');
  const prompt = cut('function _aiBuildQuestionPrompt(', '\n// The lettered-parts rules', 'build prompt');
  ok(/wantCont/.test(prompt), 'the rule is opt-in');
  ok(/opts && opts\.continuation/.test(prompt), 'and comes from the caller, never assumed');
  // A pasted screenshot has no previous page: asking it is asking about
  // something that does not exist, and a model answers anyway.
  ok(/askGeminiVision\(_aiBuildQuestionPrompt\(isPdf, 1, batchLevel, \{ continuation: !!o\.continuation \}\)/.test(src),
     'the rapid job passes only what its caller gave it');
});

test('the continuation flag is per ENTRY, never inherited from the reply', () => {
  const fn = cut('function _aiQuestionPayloads(parsed) {', '\nfunction buildQuestionFromAi', 'payloads');
  ok(/continuation: x\.continuation === true/.test(fn), 'read off the entry');
  ok(!/pick\(x\.continuation/.test(fn), 'a whole-reply flag would mark every question on the page as a continuation');
});

test('the stitch happens at SETTLE time, which is the one place that is in page order', () => {
  const fn = cut('async function _rapidExpandPdf(file, level, release) {', '\nfunction startRapidJob', 'pdf feeder');
  const settle = fn.slice(fn.indexOf('const settle'), fn.indexOf('for (let p = 1'));
  ok(/_vetApplyMerge/.test(settle), 'the stitch is inside settle()');
  // A page that failed or held nothing leaves no question the page after it
  // could be carrying on from — attaching to the page before THAT one would
  // graft two unrelated questions together.
  ok(/failed\+\+; lastQ = null/.test(settle), 'a failed page clears the carry');
  ok(/blank\+\+; lastQ = null/.test(settle), 'and so does an empty one');
  ok(/qs\[0\] = merged/.test(settle), 'a third page carries on from the MERGED question');
});

test("a page's writes are durable before the feeder can delete one of them", () => {
  // The half that is merged away was already saved by its own page job. If
  // that write is still in flight when the stitch deletes it, the delete lands
  // first and the write puts the half straight back on the next sign-in.
  const fn = cut('async function processRapidJob(jobId, file, batchLevel, opts) {', '\nfunction _failRapidJob', 'rapid job');
  ok(/saves\.push\(saveVettingQuestion\(q\)\)/.test(fn), 'the writes are collected');
  const wait = fn.indexOf('await Promise.all(saves)');
  ok(wait > -1, 'and waited for');
  ok(wait < fn.indexOf('return { added: added.length'), 'before the job resolves');
});

// ── runner ──────────────────────────────────────────────────────────────────
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && !c.name.includes(only)) continue;
  try { await c.fn(); pass++; console.log('  ✓ ' + c.name); }
  catch (e) { fail++; console.log('  ✗ ' + c.name + '\n      ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
