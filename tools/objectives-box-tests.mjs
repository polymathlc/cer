// Regression tests for the 🎯 LEARNING-OBJECTIVES BOX — the blank rounded
// rectangle a PUPIL writes their own learning objectives in. Run with:
//     node tools/objectives-box-tests.mjs            all cases
//     node tools/objectives-box-tests.mjs <name>     one case
//
// It loads the REAL objBox* helpers out of app.js, and reads the two print
// builders, the block editor and index.html as text to pin the wiring around
// them.
//
// Every failure here is silent and the sheet still prints. The two that matter
// most are opposites of each other:
//
//   • THE TWO PRINT BUILDERS DRIFTING APART. `doPrintWorksheetOpen` and
//     `buildWorksheetHtml` had already drifted once over the MCQ answer, and a
//     box that appears on a worksheet printed from the bank and not on the same
//     worksheet printed from 📄 My Worksheets is that fault wearing a new hat.
//
//   • THE BOX REACHING THE ANSWER KEY. There is no right answer to "what did
//     you learn", so a key row against a reflection box is a row a teacher
//     cannot mark and reads as a printing fault.
//
// …and a third that is quieter still: the switch promising ONE box per question
// and printing TWO on a question the author had already given one.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const HTML = new URL('../index.html', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const html = fs.readFileSync(HTML, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

// The REAL helpers, cut straight out of the file.
const section = [
  "function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }",
  cut('const OBJBOX_DEFAULT_LINES', '\nfunction createBlock(type) {', 'objBox constants + helpers'),
  cut('// ---- 🎯 the learning-objectives box, drawn', '\n// Used as the `default` branch', 'objBox renderers'),
].join('\n');

const M = new Function(section + `
return { OBJBOX_DEFAULT_LINES, OBJBOX_LINES_MIN, OBJBOX_LINES_MAX, OBJBOX_LABEL,
         objBoxLines, objBoxLabel, objBoxPrintHtml, objBoxScreenHtml,
         objBoxPreviewHtml, objBoxAutoHtml };`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
};
// The closing quote matters: `print-objectives-lines` is the WRAPPER, and
// counting it inflates every measurement here by one — which reads as the box
// having one more line than it does, on a test whose whole subject is how many
// lines the box has.
const countLines = h => (h.match(/(?:print|ws)-objectives-line"/g) || []).length;

// ---- the default the whole block exists for --------------------------------
test('the default is TWO lines', () => {
  eq(M.OBJBOX_DEFAULT_LINES, 2, 'OBJBOX_DEFAULT_LINES');
  eq(M.objBoxLines({ type: 'objectivesBox' }), 2, 'a block with no lines field');
  eq(countLines(M.objBoxPrintHtml({})), 2, 'printed lines');
});

test('one line is allowed — "can be changed to ONE or more"', () => {
  eq(M.objBoxLines({ lines: 1 }), 1, 'one line');
  eq(countLines(M.objBoxPrintHtml({ lines: 1 })), 1, 'printed lines');
  eq(M.OBJBOX_LINES_MIN, 1, 'OBJBOX_LINES_MIN');
});

test('more lines are allowed, and asked for', () => {
  eq(M.objBoxLines({ lines: 6 }), 6, 'six lines');
  eq(countLines(M.objBoxPrintHtml({ lines: 6 })), 6, 'printed lines');
  eq(countLines(M.objBoxScreenHtml({ lines: 6 })), 6, 'screen lines');
});

// ---- junk must never make the box unusable ---------------------------------
test('a junk line count falls back to the default, never to zero', () => {
  // A box with no lines in it is a box a pupil cannot write in, and it renders
  // perfectly — so every one of these has to land on the default.
  for (const v of [0, -3, NaN, null, undefined, '', 'two', {}, []]) {
    eq(M.objBoxLines({ lines: v }), 2, 'lines=' + JSON.stringify(v));
  }
  ok(countLines(M.objBoxPrintHtml({ lines: 0 })) === 2, 'a zero-line box must still print lines');
});

test('an absurd line count is capped rather than believed', () => {
  eq(M.objBoxLines({ lines: 500 }), M.OBJBOX_LINES_MAX, 'capped');
  ok(M.OBJBOX_LINES_MAX <= 24, 'the cap must stay well under a sheet, got ' + M.OBJBOX_LINES_MAX);
});

test('a fractional line count is rounded, not truncated to nothing', () => {
  eq(M.objBoxLines({ lines: 3.4 }), 3, '3.4');
  eq(M.objBoxLines({ lines: 0.6 }), 1, '0.6 rounds to a real line');
});

// ---- the heading -----------------------------------------------------------
test('a block with no label at all takes the default heading', () => {
  eq(M.objBoxLabel({ type: 'objectivesBox' }), M.OBJBOX_LABEL, 'absent label');
  ok(M.objBoxPrintHtml({}).indexOf('print-objectives-label') >= 0, 'no heading printed');
});

test('an author who CLEARS the heading gets a truly blank box', () => {
  // `|| OBJBOX_LABEL` would put the heading back on the box they had just
  // emptied — the box is "blank" by request, and this is the half of it that
  // is easiest to undo by accident.
  eq(M.objBoxLabel({ label: '' }), '', 'cleared label');
  eq(M.objBoxLabel({ label: '   ' }), '', 'whitespace-only label');
  const h = M.objBoxPrintHtml({ label: '' });
  ok(h.indexOf('print-objectives-label') < 0, 'a cleared heading still printed: ' + h);
  ok(h.indexOf('print-objectives-line') >= 0, 'the lines went with it: ' + h);
  ok(M.objBoxScreenHtml({ label: '' }).indexOf('Learning objectives') < 0, 'screen kept the heading');
});

test("the heading is ESCAPED — it is text an author typed", () => {
  const h = M.objBoxPrintHtml({ label: '<script>x</script> & "co"' });
  ok(h.indexOf('<script>') < 0, 'unescaped markup reached the sheet: ' + h);
  ok(h.indexOf('&amp;') >= 0, 'ampersand not escaped: ' + h);
  ok(M.objBoxScreenHtml({ label: '<b>x</b>' }).indexOf('<b>x</b>') < 0, 'screen skin does not escape');
});

// ---- the box is rounded, which is what was asked for -----------------------
test('the box is a ROUNDED rectangle on both skins', () => {
  ok(/border-radius/.test(M.objBoxScreenHtml({})), 'screen box is not rounded');
  const printCss = html.slice(html.indexOf('@media print {'));
  const rule = printCss.slice(printCss.indexOf('.print-objectives-box {'));
  ok(/border-radius/.test(rule.slice(0, 400)), 'the printed box is not rounded');
});

// ---- 🎯 ONE box in every question ------------------------------------------
test('the switch off changes nothing at all', () => {
  eq(M.objBoxAutoHtml({ blocks: [] }, false), '', 'off');
  eq(M.objBoxAutoHtml({ blocks: [] }, undefined), '', 'undefined');
  eq(M.objBoxAutoHtml(null, false), '', 'no question');
});

test('the switch on puts a DEFAULT box on a question that has none', () => {
  const h = M.objBoxAutoHtml({ blocks: [{ type: 'text' }] }, true);
  ok(h.indexOf('print-objectives-box') >= 0, 'no box: ' + h);
  eq(countLines(h), M.OBJBOX_DEFAULT_LINES, 'the automatic box is the default size');
});

test('a question that ALREADY has a box does not get a second one', () => {
  // "ONE learning objective box into each question" — a question the author
  // already gave a box would otherwise print two, the second at a size they
  // never chose.
  const q = { blocks: [{ type: 'text' }, { type: 'objectivesBox', lines: 5 }] };
  eq(M.objBoxAutoHtml(q, true), '', 'a second box was added');
});

test('a question with no blocks array at all does not throw', () => {
  ok(typeof M.objBoxAutoHtml({}, true) === 'string', 'threw or returned non-string');
  ok(typeof M.objBoxAutoHtml(undefined, true) === 'string', 'threw on undefined');
});

// ---- the two print builders must not drift ---------------------------------
const builderBody = (fn, end) => cut('function ' + fn, end, fn);

test('BOTH print builders carry an explicit case, through the ONE helper', () => {
  for (const [fn, end] of [
    ['doPrintWorksheetOpen(whyNotes) {', '\n// ===== PRINT PLANNER'],
    ['buildWorksheetHtml(selected, worksheetTitle, opts) {', '\n// One AI call per MCQ is a real wait'],
  ]) {
    const body = src.slice(src.indexOf('function ' + fn));
    const stop = body.indexOf(end);
    const arm = stop < 0 ? body : body.slice(0, stop);
    ok(arm.indexOf("case 'objectivesBox':") >= 0, fn + ' has no explicit objectivesBox case');
    ok(arm.indexOf('objBoxPrintHtml(block)') >= 0, fn + ' does not use the shared print helper');
  }
});

test('BOTH print builders append the automatic box, through the ONE helper', () => {
  for (const fn of ['function doPrintWorksheetOpen', 'function buildWorksheetHtml']) {
    const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 40000);
    ok(/objBoxAutoHtml\(q, objBoxAll\)/.test(body), fn + ' does not append the automatic box');
  }
});

test('the automatic box is appended INSIDE the question chunk', () => {
  // Emitted after the chunk's closing </div> it belongs to no question at all,
  // and the print planner measures it against the wrong page.
  for (const fn of ['function doPrintWorksheetOpen', 'function buildWorksheetHtml']) {
    const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 40000);
    const auto = body.indexOf('objBoxAutoHtml(q, objBoxAll)');
    const close = body.indexOf('qHtml += `</div>`;', auto);
    ok(auto >= 0 && close > auto, fn + ': the box is not appended before the chunk closes');
  }
});

test('NOTHING about the box reaches the answer key', () => {
  // There is no right answer to "what did you learn". A key row here is one a
  // teacher cannot mark, and a gap the placeholder would fill with
  // "No answer recorded for this question".
  ok(src.indexOf("case 'objectivesBox':\n      _push") < 0, 'a key push crept in');
  const pusher = cut('function _pushBlockAnswerKey', '\n// A question with no answer-bearing block', '_pushBlockAnswerKey');
  ok(pusher.indexOf('objectivesBox') < 0, '_pushBlockAnswerKey knows about the box — it must not');
  // …and the explicit print cases must not push either.
  for (const fn of ['function doPrintWorksheetOpen', 'function buildWorksheetHtml']) {
    const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 40000);
    const at = body.indexOf("case 'objectivesBox': {");
    const arm = body.slice(at, body.indexOf('case ', at + 30));
    ok(arm.indexOf('_pushBlockAnswerKey') < 0 && arm.indexOf('_pushAnswerKeySection') < 0,
      fn + "'s objectivesBox case pushes onto the answer key");
  }
});

// ---- the block is reachable and renders everywhere -------------------------
test('the block can be created, and is offered in the insert menu', () => {
  const mk = cut('function createBlock(type) {', '\nfunction addBlock(type)', 'createBlock');
  ok(mk.indexOf("case 'objectivesBox':") >= 0, 'createBlock has no objectivesBox case');
  ok(mk.indexOf('OBJBOX_DEFAULT_LINES') >= 0, 'createBlock does not use the default');
  ok(src.indexOf(`addBlockAt('objectivesBox'`) >= 0, 'the insert menu does not offer it');
});

test('the block card carries a badge, an editor and a live preview', () => {
  ok(/case 'objectivesBox':badgeClass/.test(src), 'no badge — the card header would be blank');
  const ed = cut("    case 'objectivesBox': {", "    case 'workingSpace':", 'editor card');
  ok(ed.indexOf("saveBlockNum('${id}','lines'") >= 0, 'no line-count control');
  ok(ed.indexOf("saveBlockField('${id}','label'") >= 0, 'no heading control');
  ok(ed.indexOf('objBoxPreviewHtml(block)') >= 0, 'the editor describes the box instead of drawing it');
});

test('every SCREEN surface draws the real box', () => {
  // renderImportedBlockStudent is the default branch of every practice render
  // switch, so this one case covers practice, quick practice and topical.
  const imp = cut('function renderImportedBlockStudent(block, q) {', '\n// Visual feedback when a student picks', 'renderImportedBlockStudent');
  ok(imp.indexOf("case 'objectivesBox':") >= 0, 'practice does not render the box');
  ok(imp.indexOf('objBoxScreenHtml(block)') >= 0, 'practice does not use the shared screen helper');
  const prev = cut('function renderQuestionBodyPreviewHtml(q) {', '\nfunction questionHasMarkableAnswer', 'preview');
  ok(prev.indexOf('objBoxScreenHtml(block)') >= 0, 'the question preview does not draw the box');
});

// ---- the switches ----------------------------------------------------------
test('there is a switch per surface, and an unknown surface is FALSE', () => {
  // A default that fell through to another page's checkbox would honour a
  // switch set somewhere else, on a print started from here, with nothing on
  // the screen able to explain it.
  const sw = cut('const OBJBOX_SWITCHES', '\n// Every MCQ block on the sheet', 'OBJBOX_SWITCHES');
  for (const k of ['builder', 'saved', 'bank']) ok(sw.indexOf(k + ':') >= 0, 'no ' + k + ' switch');
  ok(sw.indexOf('paper:') < 0, 'a past paper must not get the box — it is somebody else\'s sheet');
  ok(/if \(!id\) return false;/.test(sw), 'an unknown surface does not return false');
});

test('each switch names a checkbox that really exists in index.html', () => {
  const ids = [...cut('const OBJBOX_SWITCHES', '\nfunction objBoxPrintOn', 'OBJBOX_SWITCHES')
    .matchAll(/'([A-Za-z]+IncludeObjBox)'/g)].map(m => m[1]);
  ok(ids.length === 3, 'expected 3 switch ids, got ' + JSON.stringify(ids));
  for (const id of ids) {
    ok(html.indexOf('id="' + id + '"') >= 0, id + ' has no checkbox — the switch can never be turned on');
  }
});

test('every print entry point passes the switch through', () => {
  // A call site that forgets it is a surface whose checkbox silently does
  // nothing, on a page where it is plainly ticked.
  // `[^)]*` stops at the first `)`, which on the saved-worksheet call site is
  // inside `_wsCoverHtml(...)` — so match to the end of the STATEMENT instead.
  const calls = [...src.matchAll(/await doPrintStudentWorksheet\(.*\);/g)].map(m => m[0]);
  ok(calls.length >= 3, 'expected at least 3 call sites, got ' + calls.length);
  for (const c of calls) ok(/objBoxPrintOn\('/.test(c), 'a call site does not pass the switch: ' + c);
  ok(/objectivesBoxAll: !!objBoxAll/.test(src), 'doPrintStudentWorksheet does not forward it to the builder');
});

test('the LIVE A4 preview shows what will print', () => {
  // A preview that ignores the switch is a preview of a different sheet.
  const ctx = cut('function _wsPreviewCtx() {', '\nfunction openWorksheetPreview', '_wsPreviewCtx');
  for (const w of ['bank', 'saved', 'builder']) {
    ok(ctx.indexOf("objBoxPrintOn('" + w + "')") >= 0, 'the ' + w + ' preview ignores the switch');
  }
  ok(/objBoxAll: false/.test(ctx), 'the past-paper preview must be explicitly off, not merely absent');
  ok(/objectivesBoxAll: !!ctx\.objBoxAll/.test(src), 'renderWsPreview does not pass it to the builder');
});

// ---- the CSS the box is nothing without ------------------------------------
test('the print CSS defines the box, inside @media print', () => {
  const a = html.indexOf('@media print {');
  const b = html.indexOf('========== PRINT MODE SELECTION', a);
  const printCss = html.slice(a, b < 0 ? html.length : b);
  for (const sel of ['.print-objectives-box', '.print-objectives-label', '.print-objectives-line']) {
    ok(printCss.indexOf(sel + ' {') >= 0 || printCss.indexOf(sel + ',') >= 0,
      sel + ' is not defined inside @media print — the box prints as bare text');
  }
  ok(html.indexOf('.ws-objectives-line{') >= 0, 'the screen box has no ruled lines');
});

test('a question tall enough to flow releases the box with it', () => {
  // .print-chunk-tall opens the page box; a box that keeps break-inside:avoid
  // on a flowing page does not flow, it overflows — over the next question.
  ok(html.indexOf('.print-chunk-tall .print-objectives-box,') >= 0, 'no chunk-tall release');
  ok(html.indexOf('.print-page-tall .print-objectives-box,') >= 0, 'no page-tall release');
});

// ---- the box is somewhere a pupil WRITES -----------------------------------
test('a question carrying a box is not "MCQ only"', () => {
  // On 🗂️ Custom Paper that decides the booklet, and Booklet A is answered on a
  // separate answer sheet — a reflection box there is one nobody can fill in.
  const fn = cut('function qIsMcqOnly(blocks) {', '\n// Take a printed marks marker back out', 'qIsMcqOnly');
  ok(fn.indexOf("'objectivesBox'") >= 0, 'qIsMcqOnly counts a box-carrying MCQ as MCQ-only');
});

// ---- THE PREVIEW IS THE PRINT ----------------------------------------------
// Both of these are the same fault wearing two hats: a surface that shows a
// proof of a sheet and reads a DIFFERENT set of switches from the printer that
// makes it. Neither throws, and both look like a working preview.
test('🗂️ Custom Paper turns the box off explicitly, in both modes', () => {
  // `cpbPrint` calls buildWorksheetHtml with these `buildOpts` and would get
  // false by default — but the PREVIEW goes through _wsPreviewCtx's adhoc
  // branch, which reads the 🖨 print picker's own printIncludeObjBox, and
  // buildOpts is assigned OVER that base. Without an explicit false a teacher
  // with that box ticked sees a 🎯 box on every question of the preview that
  // the exported paper does not have.
  const paperOpts = cut('function _cpbPaperOpts() {', '\nfunction _cpbWorksheetOpts()', 'the paper opts');
  const wsOpts = cut('function _cpbWorksheetOpts() {', '\n// THE ONE DOOR the printer', 'the worksheet opts');
  ok(paperOpts.indexOf('objectivesBoxAll: false') >= 0, 'paper mode does not turn the box off');
  ok(wsOpts.indexOf('objectivesBoxAll: false') >= 0, 'worksheet mode does not turn the box off');
});

test('the 👁 Vetting hover reads the same bank switches as the full preview', () => {
  // The hover's own "Open full preview" opens previewOneQuestionPrint on the
  // SAME question, which reads objBoxPrintOn('bank') through the adhoc
  // context. Left out here, the two proofs of one question differ.
  const peek = cut('const html = buildWorksheetHtml([copy]', '_wsWritePreview(frame, html', 'the hover build');
  ok(peek.indexOf("wnyPrintOn('bank')") >= 0, 'the hover stopped reading the why switch');
  ok(peek.indexOf("akxPrintOn('bank')") >= 0, 'the hover stopped reading the explanations switch');
  ok(peek.indexOf("objectivesBoxAll: objBoxPrintOn('bank')") >= 0,
     'the hover does not read the 🎯 switch the full preview reads');
});

// ---- run -------------------------------------------------------------------
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name.indexOf(only) < 0) continue;
  try { c.fn(); pass++; console.log('  ok   ' + c.name); }
  catch (e) { fail++; console.log('  FAIL ' + c.name + '\n       ' + e.message); }
}
console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
