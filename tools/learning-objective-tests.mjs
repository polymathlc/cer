// =====================================================================
// 🎯 THE LEARNING-OBJECTIVE BOX — the harness
//
// Every failure here is SILENT: the sheet still prints, the question still
// renders, and the box is simply the wrong shape, in the wrong place, or on a
// sheet nobody asked for it on. The two that would actually hurt are
//   (1) the box becoming an ANSWER — pushed onto the key, counted by one of
//       the "does this question have an answer" predicates, or added through
//       `addAnswer` — because then a child is marked on their own reflection;
//   (2) the sheet-wide switch defaulting ON, which grows a blank box on every
//       question of every worksheet this app has ever printed.
// Both are pinned below, together with the preview/print agreement, because a
// preview showing a different sheet from the PDF is the one thing a preview
// must never be.
//
//   node tools/learning-objective-tests.mjs
// =====================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appjs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond) {
  if (cond) pass++;
  else fails.push(name);
}

// ---------------------------------------------------------------------
// ① THE REAL FUNCTIONS, cut out of app.js and run
// ---------------------------------------------------------------------
function cut(from, to, label) {
  const a = appjs.indexOf(from);
  if (a < 0) throw new Error('learning-objective harness: cannot find ' + label + ' start');
  const b = appjs.indexOf(to, a);
  if (b < 0) throw new Error('learning-objective harness: cannot find ' + label + ' end');
  return appjs.slice(a, b);
}
const core = cut('const LOBOX_LINES = 2;', '\n// A printed MCQ needs somewhere to WRITE THE ANSWER.', 'the core block');

const shimPath = path.join(root, 'tools', '.lo-shim.mjs');
fs.writeFileSync(shimPath, `
function escapeHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
export const _boxes = {};
const document = { getElementById: id => (id in _boxes ? { checked: _boxes[id] } : null) };
${core}
export { LOBOX_LINES, LOBOX_LINES_MAX, LOBOX_LABEL, loBoxLabel, loBoxLines, loBoxLines0,
         loBoxPrintHtml, qHasLoBox, loBoxSheetHtml, LOB_SWITCHES, lobPrintLines };
`);
const M = await import('file://' + shimPath);
try { fs.unlinkSync(shimPath); } catch {}

// --- the default is TWO LINES, which is what was asked for
ok('the default is two lines', M.LOBOX_LINES === 2);
ok('a block with no line count gets the default', M.loBoxLines(undefined) === 2);
// A box with no rules in it is a rounded rectangle nobody can write in, and it
// renders perfectly — so a missing/º0 count is the DEFAULT here, never zero.
ok('0 lines on a block is the default, not an empty box', M.loBoxLines(0) === 2);
ok('junk on a block is the default', M.loBoxLines('x') === 2);
ok('one line is allowed ("one or more lines")', M.loBoxLines(1) === 1);
ok('a chosen count is kept', M.loBoxLines(7) === 7);
// The cap is FAR below PRINT_LINES_MANUAL_MAX because the sheet-wide switch
// multiplies this box by every question on the paper.
ok('the count is capped', M.loBoxLines(999) === M.LOBOX_LINES_MAX);
ok('the cap is well below the answer-box cap', M.LOBOX_LINES_MAX <= 12);

// --- …but the SHEET-WIDE reading must keep 0 meaning OFF
ok('sheet-wide: absent is OFF', M.loBoxLines0(undefined) === 0);
ok('sheet-wide: 0 is OFF', M.loBoxLines0(0) === 0);
ok('sheet-wide: junk is OFF', M.loBoxLines0('x') === 0);
ok('sheet-wide: false is OFF', M.loBoxLines0(false) === 0);
ok('sheet-wide: a real count survives', M.loBoxLines0(3) === 3);
ok('sheet-wide: capped too', M.loBoxLines0(999) === M.LOBOX_LINES_MAX);

// --- the caption. `|| DEFAULT` would bring a cleared one back on every render.
ok('an untouched block gets the default caption', M.loBoxLabel({}) === M.LOBOX_LABEL);
ok('a cleared caption stays cleared', M.loBoxLabel({ label: '' }) === '');
ok('a caption of spaces is cleared', M.loBoxLabel({ label: '   ' }) === '');
ok("the author's own caption is kept", M.loBoxLabel({ label: 'Today I learned' }) === 'Today I learned');

// --- the printed box
const h2 = M.loBoxPrintHtml({});
const rules = s => (s.match(/class="print-lo-line"/g) || []).length;
ok('printed: two rules by default', rules(h2) === 2);
ok('printed: it is the rounded box', h2.includes('class="print-lo-box"'));
ok('printed: the caption is drawn', h2.includes('class="print-lo-label"'));
ok('printed: five rules when five are asked for', rules(M.loBoxPrintHtml({ lines: 5 })) === 5);
ok('printed: a cleared caption prints nothing at all', !M.loBoxPrintHtml({ label: '' }).includes('print-lo-label'));
ok('printed: the caption is escaped', M.loBoxPrintHtml({ label: '<b>x</b>' }).includes('&lt;b&gt;'));
ok('printed: nothing leaks undefined / NaN', !/undefined|NaN|\[object/.test(h2 + M.loBoxPrintHtml({ lines: 5, label: 'x' })));

// --- the sheet-wide box
const qPlain = { blocks: [{ type: 'text' }] };
const qOwn = { blocks: [{ type: 'text' }, { type: 'learningObjectives', lines: 6 }] };
ok('switch off: no box at all', M.loBoxSheetHtml(qPlain, 0) === '');
ok('switch absent: no box at all', M.loBoxSheetHtml(qPlain, undefined) === '');
ok('switch on: a box', M.loBoxSheetHtml(qPlain, 2).includes('print-lo-box'));
// Two identical empty boxes under one question read as a printing fault, and
// the author's own line count is the one that looks wrong.
ok('a question with its own box is never given a second one', M.loBoxSheetHtml(qOwn, 2) === '');
ok('qHasLoBox finds one', M.qHasLoBox(qOwn) === true);
ok('qHasLoBox does not invent one', M.qHasLoBox(qPlain) === false);
ok('qHasLoBox survives junk', M.qHasLoBox(null) === false && M.qHasLoBox({}) === false);

// --- the surfaces. An unknown one must be OFF, never another page's checkbox.
ok('three surfaces, named', Object.keys(M.LOB_SWITCHES).sort().join(',') === 'bank,builder,saved');
ok('an unknown surface is OFF', M.lobPrintLines('paper') === 0 && M.lobPrintLines('nope') === 0 && M.lobPrintLines(undefined) === 0);
M._boxes['wsIncludeLo'] = false;
ok('unticked is OFF', M.lobPrintLines('builder') === 0);
M._boxes['wsIncludeLo'] = true;
ok('ticked gives the default line count', M.lobPrintLines('builder') === M.LOBOX_LINES);
ok('one page\'s tick does not leak to another page', M.lobPrintLines('bank') === 0);

// ---------------------------------------------------------------------
// ② IT IS NOT AN ANSWER — the failure that would reach a child
// ---------------------------------------------------------------------
// `_pushBlockAnswerKey` is the ONE pusher both print paths call. A case here
// would print a "correct" learning objective on the teacher's key.
const pusher = cut('function _pushBlockAnswerKey(sections, block, part, why)', '\n// A question with no answer-bearing block at all', 'the answer-key pusher');
ok('the answer-key pusher has no learningObjectives case', !pusher.includes('learningObjectives'));

// Every "does this question have an answer" list. The type is ABSENT from all
// of them rather than present-and-filtered — an omission cannot be
// half-forgotten the way a filter can.
[
  ["the answery predicate", "const answery = b => b && ['answer', 'plainanswer', 'answerLine', 'openLines', 'workingSpace', 'fillblank', 'mcq'].indexOf(b.type) >= 0;"],
  ["the hasOpen predicate", "const hasOpen = blocks.some(b => ['answer', 'plainanswer', 'openLines', 'workingSpace', 'answerLine', 'fillblank'].indexOf(b.type) >= 0);"],
].forEach(([name, line]) => {
  ok(name + ' is unchanged', appjs.includes(line));
  ok(name + ' does not list the box', !line.includes('learningObjectives'));
});
const kwFields = cut('function kwBlockFields(block)', '\n// Can this block hold keywords at all?', 'kwBlockFields');
ok('a learning objective can never hold 🔑 keywords', !kwFields.includes('learningObjectives'));
const mcqOnly = cut('function qIsMcqOnly(blocks)', '\n// Take a printed marks marker', 'qIsMcqOnly');
ok('the box does not change what counts as an MCQ-only question', !mcqOnly.includes('learningObjectives'));

// On screen it goes through `add`, NEVER `addAnswer`: the section it sits in
// must not be counted as carrying an answer.
const openBody = cut("      case 'learningObjectives': {\n        const lon = loBoxLines(block.lines);\n        const lolab = loBoxLabel(block);\n        add(", "      default:\n        add(renderImportedBlockStudent(block, q));", 'the buildOpenBody case');
ok('on screen the box is added with `add`, never `addAnswer`', !openBody.includes('addAnswer'));
ok('on screen nothing about it is pushed to the marker', !openBody.includes('items.push'));

// ---------------------------------------------------------------------
// ③ THE TWO PRINT PATHS, which had already drifted over the MCQ answer once
// ---------------------------------------------------------------------
const pathA = cut('function doPrintWorksheetOpen(whyNotes)', '\n// One AI call per MCQ is a real wait', 'doPrintWorksheetOpen');
const pathB = cut('function buildWorksheetHtml(selected, worksheetTitle, opts)', '\n// One AI call per MCQ is a real wait', 'buildWorksheetHtml');
[['doPrintWorksheetOpen', pathA], ['buildWorksheetHtml', pathB]].forEach(([name, body]) => {
  ok(name + ' has an explicit learningObjectives case', /case 'learningObjectives'/.test(body));
  ok(name + ' builds it through the ONE builder', body.includes('loBoxPrintHtml(block)'));
  ok(name + ' appends the sheet-wide box', body.includes('loBoxSheetHtml(q,'));
});
// One builder, so a box inserted by hand and a box the sheet gave every
// question are the same box.
ok('there is exactly one printed-box builder', (appjs.match(/function loBoxPrintHtml\(/g) || []).length === 1);
ok('the bank print reads its OWN page\'s switch', pathA.includes("loBoxSheetHtml(q, lobPrintLines('bank'))"));
ok('the shared builder takes the count from its caller', pathB.includes('loBoxSheetHtml(q, loBoxEvery)'));
ok('…and that count is read through the 0-means-off reader', pathB.includes('loBoxLines0(opts && opts.loBox)'));

// The static render both print paths' read-only surfaces use must NOT be the
// interactive one — a textarea printed onto paper is a grey rectangle.
const stu = cut("    case 'learningObjectives': {\n      const lon = loBoxLines(block.lines);\n      const lolab = loBoxLabel(block);\n      return `<div class=\"lo-box\">`", "    case 'fillblank':", 'the static student render');
ok('the shared static render draws ruled lines, not a textarea', stu.includes('lo-box-line') && !stu.includes('textarea'));

// ---------------------------------------------------------------------
// ④ THE PREVIEW IS THE PRINT
// ---------------------------------------------------------------------
const ctx = cut('function _wsPreviewCtx()', '\nfunction openWorksheetPreview()', 'the preview context');
ok('every preview context decides the box', (ctx.match(/loBox:/g) || []).length === 4);
ok('a past paper never grows one', /A past paper always prints its explanations[\s\S]*?loBox: 0/.test(ctx));
ok('the saved-worksheet preview reads its own switch', ctx.includes("loBox: lobPrintLines('saved')"));
ok('the builder preview reads its own switch', ctx.includes("loBox: lobPrintLines('builder')"));
ok('the ad-hoc preview reads the print picker\'s switch', ctx.includes("loBox: lobPrintLines('bank')"));
const renderPrev = cut('async function renderWsPreview()', '\n// Shared by the full exported view', 'renderWsPreview');
ok('the preview passes the box to the builder', renderPrev.includes('loBox: ctx.loBox || 0'));
// buildOpts is assigned OVER the base, which is what lets Custom Paper turn it
// off for the preview and the PDF with one value.
ok('buildOpts still wins over the base', renderPrev.indexOf('loBox: ctx.loBox') < renderPrev.indexOf('ctx.buildOpts || {}'));

// 🗂️ Custom Paper: explicitly OFF on both modes. Without it the PREVIEW would
// grow a box on every question that its PDF does not have.
const cpbPaper = cut('function _cpbPaperOpts()', '\nfunction _cpbWorksheetOpts()', 'the Custom Paper paper opts');
const cpbWs = cut('function _cpbWorksheetOpts()', '\n// THE ONE DOOR the printer', 'the Custom Paper worksheet opts');
ok('Custom Paper turns the box off explicitly in paper mode', cpbPaper.includes('loBox: 0,'));
ok('…and in worksheet mode', cpbWs.includes('loBox: 0,'));

// The three printers all pass their own page's switch.
[
  ["reprintWorksheet", "akxPrintOn('saved'), lobPrintLines('saved'));"],
  ["printStudentWorksheet", "akxPrintOn('builder'), lobPrintLines('builder'));"],
  ["printQuestionsDirect", "akxPrintOn('bank'), lobPrintLines('bank'));"],
].forEach(([name, frag]) => ok(name + ' passes its own switch', appjs.includes(frag)));
ok('the 👁 hover honours the same bank switch as the full preview', appjs.includes("loBox: lobPrintLines('bank')\n      });"));

// ---------------------------------------------------------------------
// ⑤ THE WIRING — a block type nobody can insert is a block type nobody has
// ---------------------------------------------------------------------
ok('the block factory gives it two lines and a caption', /case 'learningObjectives':\s*\n\s*block\.lines = LOBOX_LINES;\s*\n\s*block\.label = LOBOX_LABEL;/.test(appjs));
ok('it has an editor card', appjs.includes("case 'learningObjectives': {\n      const lon = loBoxLines(block.lines);"));
ok('it has a badge', /case 'learningObjectives': badgeClass/.test(appjs));
ok('it is on the insert-between menu', appjs.includes("addBlockAt('learningObjectives'"));
ok('it is on the main Add block bar', html.includes("addBlock('learningObjectives')"));
ok('the ✎ Questions drawer names it', appjs.includes("case 'learningObjectives': return 'Learning-objective box"));
ok('the read-only preview names it', appjs.includes("case 'learningObjectives': {\n        const lon = loBoxLines(block.lines);\n        html +="));

// The three checkboxes, and the CSS the box is drawn with.
['printIncludeLo', 'wsIncludeLo', 'mwIncludeLo'].forEach(id =>
  ok('the ' + id + ' checkbox exists', html.includes('id="' + id + '"')));
['.print-lo-box', '.print-lo-label', '.print-lo-line', '.lo-box{', '.lo-box-label{', '.lo-box-line{', '.lo-box-write{'].forEach(sel =>
  ok('CSS for ' + sel, html.includes(sel)));
// A box taller than a sheet cannot honour `break-inside: avoid`: Chrome jumps
// it whole to a fresh sheet, finds it still does not fit, and fragments it —
// leaving the sheet it came from mostly blank.
ok('the box avoids breaking', /\.print-lo-box \{[\s\S]*?break-inside: avoid;/.test(html));
ok('…and is released on a page that is already flowing', html.includes('.print-chunk-tall .print-lo-box') && html.includes('.print-page-tall .print-lo-box'));

// ---------------------------------------------------------------------
console.log((fails.length ? '❌ ' : '✅ ') + pass + ' passed, ' + fails.length + ' failed');
fails.forEach(f => console.log('   ✗ ' + f));
process.exit(fails.length ? 1 : 0);
