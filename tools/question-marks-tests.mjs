// Regression tests for [2] — HOW MANY MARKS A QUESTION IS WORTH.
// Run with:
//     node tools/question-marks-tests.mjs            all cases
//     node tools/question-marks-tests.mjs <name>     one case
//
// It loads the REAL helpers out of app.js, including `qPartBodyHtml` — the ONE
// renderer every surface puts a text block through — and the print path's own
// `escapeHtmlKeepLines`, so what a sheet actually shows is pinned end to end.
//
// The marks are a FIELD on the block, drawn at render, exactly like the part
// letter beside them. Every way that goes wrong is silent, and each one shows
// up on a printed sheet in front of a class:
//
//  • APPENDED TO THE END OF THE STRING instead of inside the last tag.
//    `block.content` is authored HTML that nearly always ends "…point A.</p>",
//    so gluing "[2]" on after it puts the marks on a line of their own. It
//    still prints; it just looks wrong on every question at once.
//  • THE LABEL TWICE. The wording of an imported past-paper question often
//    already ends "[2]". The field is the source of truth, so a marker left in
//    the text as well prints "… at point A. [2] [2]".
//  • EATING SOMETHING THAT IS NOT MARKS. "[see Diagram 1]" is prose and
//    "[2]" in the middle of a sentence is a reference, not a mark total.
//    Stripping either silently deletes part of the question.
//  • TOUCHING A QUESTION THAT HAS NO MARKS SET. The overwhelming majority of
//    the bank has none, and every one of them must render byte for byte what
//    it rendered before.
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

const SHIM = `
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
`;

const M = new Function(SHIM +
  cut('const QPART_LETTERS', 'function qPartsUsed', 'part core + marks') +
  // _keepParagraphGaps is what keeps the author's blank lines; cut in rather
  // than re-written, so this harness cannot drift from the real one.
  cut('function _keepParagraphGaps(lines) {', '\nfunction escapeHtmlKeepLines', 'para gaps') + '\n' +
  cut('function escapeHtmlKeepLines(content) {', '\n// A repeated message stacks', 'print text') + `
return { marksOf: qMarksOf, label: qMarksLabel, strip: qStripTailMarks,
         append: qMarksAppendHtml, body: qPartBodyHtml, printText: escapeHtmlKeepLines,
         MAX: QMARKS_MAX };`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
};

const txt = (content, extra) => Object.assign({ id: 'b1', type: 'text', content }, extra || {});
// What the PRINTED sheet shows for this block — the same two calls both print
// paths make.
const printed = b => M.printText(M.body(b));

// ── what counts as a marks value ────────────────────────────────────────────

test('a whole number from 1 to the cap is marks; anything else is none', () => {
  eq(M.marksOf({ marks: 2 }), 2, 'two');
  eq(M.marksOf({ marks: '3' }), 3, 'a string from the number input');
  eq(M.marksOf({ marks: M.MAX }), M.MAX, 'the cap itself');
  eq(M.marksOf({ marks: 0 }), 0, 'zero is not a mark');
  eq(M.marksOf({ marks: -2 }), 0, 'negative');
  eq(M.marksOf({ marks: M.MAX + 1 }), 0, 'over the cap');
  eq(M.marksOf({ marks: 'two' }), 0, 'not a number');
  eq(M.marksOf({}), 0, 'no field at all');
  eq(M.marksOf(null), 0, 'no block at all');
});

test('the label is the exam convention and nothing else', () => {
  eq(M.label({ marks: 2 }), '[2]', 'two marks');
  eq(M.label({ marks: 12 }), '[12]', 'twelve');
  eq(M.label({}), '', 'none');
});

// ── where the marker goes ───────────────────────────────────────────────────

test('it goes INSIDE the last closing tag, right after the full stop', () => {
  // The whole point. Appended to the end of the string it would sit outside the
  // </p> and print on a line of its own, on every question at once.
  eq(M.append('<p>Explain why the bulb lit up at point A.</p>', 2),
    '<p>Explain why the bulb lit up at point A. <span class="q-marks">[2]</span></p>',
    'inside the paragraph');
});

test('plain text with no markup at all', () => {
  eq(M.append('Explain why.', 2), 'Explain why. <span class="q-marks">[2]</span>', 'at the end');
});

test('several paragraphs: after the LAST text, not the first', () => {
  eq(M.append('<p>A.</p><p>B.</p>', 3),
    '<p>A.</p><p>B. <span class="q-marks">[3]</span></p>', 'the last paragraph');
});

test('a trailing <br> does not push the marker onto the next line', () => {
  eq(M.append('Explain why.<br>', 2), 'Explain why. <span class="q-marks">[2]</span><br>', 'before the break');
});

test('no marks means the wording is handed back untouched', () => {
  eq(M.append('<p>Explain why.</p>', 0), '<p>Explain why.</p>', 'byte for byte');
});

// ── taking a printed marker back out ────────────────────────────────────────

test('a marker already in the wording comes out, inside the tag or not', () => {
  eq(M.strip('<p>Explain why. [2]</p>'), '<p>Explain why.</p>', 'inside the paragraph');
  eq(M.strip('Explain why. [2]'), 'Explain why.', 'plain text');
  eq(M.strip('Explain why.&nbsp;[2]'), 'Explain why.', 'after a non-breaking space');
  eq(M.strip('<p>Explain why. [ 12 ]</p>'), '<p>Explain why.</p>', 'spaced brackets');
});

test('a bracket that is NOT the marks is left exactly where it is', () => {
  eq(M.strip('<p>[see Diagram 1] Explain why.</p>'), '<p>[see Diagram 1] Explain why.</p>', 'a reference, not a mark');
  eq(M.strip('<p>Look at [2] and say why.</p>'), '<p>Look at [2] and say why.</p>', 'mid-sentence');
  eq(M.strip('<p>Explain why.</p>'), '<p>Explain why.</p>', 'nothing to strip');
});

// ── the ONE renderer every surface goes through ─────────────────────────────

test('a question with marks prints them once, after the full stop', () => {
  eq(printed(txt('<p>Explain why the bulb lit up when the iron ball was at point A.</p>', { marks: 2 })),
    'Explain why the bulb lit up when the iron ball was at point A. [2]',
    'what comes off the printer');
});

test('a wording that ALREADY printed its marks does not print them twice', () => {
  // The imported past-paper case: the model transcribed "[2]" into the text and
  // the teacher then set the field. Exactly one marker must survive.
  const out = printed(txt('<p>Explain why. [2]</p>', { marks: 2 }));
  eq(out, 'Explain why. [2]', 'one marker');
  eq((out.match(/\[2\]/g) || []).length, 1, 'and only one');
});

test('the FIELD wins when the two disagree', () => {
  // Unlike a part letter there is nothing to disagree about — "[2]" at the end
  // of a question can only be its marks, and there is one marks field. So the
  // number the author just typed replaces whatever the wording said.
  eq(printed(txt('<p>Explain why. [2]</p>', { marks: 5 })), 'Explain why. [5]', 'the field');
});

test('the part marker still comes off, and the marks still go on', () => {
  eq(printed(txt('<p>(a) Explain why.</p>', { part: 'a', marks: 2 })),
    'Explain why. [2]', 'neither label printed twice');
});

test('a block with NO marks renders byte for byte what it always did', () => {
  const html = '<p>(a) Explain why the bulb lit up.</p>';
  eq(M.body(txt(html)), html, 'no part, no marks — untouched');
  eq(M.body(txt(html, { part: 'a' })), '<p>Explain why the bulb lit up.</p>', 'part stripped, nothing added');
});

test('the marker never survives into the block itself', () => {
  // qPartBodyHtml renders; it must not write. An author still sees exactly what
  // they typed in the editor box.
  const b = txt('<p>Explain why.</p>', { marks: 2 });
  M.body(b);
  eq(b.content, '<p>Explain why.</p>', 'the stored wording');
  eq(b.marks, 2, 'and the field');
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
