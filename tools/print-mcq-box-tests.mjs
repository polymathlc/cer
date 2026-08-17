// Regression tests for the PRINTED MCQ ANSWER BOX. Run with:
//     node tools/print-mcq-box-tests.mjs            all cases
//     node tools/print-mcq-box-tests.mjs <name>     one case
//
// It loads the REAL `_printMcqBlockHtml` / `_printMcqAnswerBoxHtml` out of
// app.js, and reads the two print builders as text to pin that both of them
// go through that one helper.
//
// Every failure here is found in front of a class, not at a keyboard. A sheet
// that prints without the box sends thirty students to write their answer in
// the margin; a box printed on a question with no options is a mark nobody can
// earn; and the failure this file exists for is the SILENT one — the two print
// paths drifting apart, so the answer box appears on a worksheet printed from
// the bank and not on the same worksheet printed from 📄 My Worksheets. Those
// two switches had already drifted once over the answer KEY.
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

const section = [
  "const QPART_ASSIGN = " + /const QPART_ASSIGN = ('[a-z]*')/.exec(src)[1] + ';',
  cut('function qPartNormalize', '// The part each block belongs to', 'part helpers'),
  "function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }",
  // The student rendering is shared with practice and is not what is under
  // test here; the shim stands in for it so a change to an option's markup
  // cannot fail this file.
  "function renderImportedBlockStudent(b) { return '<div class=\"mcq-block\">' + ((b.options || []).map((o, i) => '<span>' + (i + 1) + '. ' + o.text + '</span>').join('')) + '</div>'; }",
  cut('function _printMcqBlockHtml', '\n// ===== OPEN ENDED MODE =====', 'printed MCQ helpers')
].join('\n');

const M = new Function(section + '\nreturn { _printMcqBlockHtml, _printMcqAnswerBoxHtml };')();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
};

const mcq = (n = 4) => ({
  type: 'mcq', id: 'b1', correctId: 'o2',
  options: Array.from({ length: n }, (_, i) => ({ id: 'o' + (i + 1), text: 'Option ' + (i + 1) }))
});

// ---- the box exists at all -------------------------------------------------
test('a printed MCQ gets an answer box', () => {
  const h = M._printMcqBlockHtml(mcq());
  ok(h.indexOf('print-mcq-answer-slot') >= 0, 'no answer slot in: ' + h);
  ok(h.indexOf('Answer') >= 0, 'no Answer label in: ' + h);
});

test('the options are still printed, and BEFORE the box', () => {
  const h = M._printMcqBlockHtml(mcq());
  ok(h.indexOf('Option 3') >= 0, 'options missing: ' + h);
  ok(h.indexOf('Option 4') < h.indexOf('print-mcq-answer'),
    'the box must come after the options a student is choosing from: ' + h);
});

// ---- and only where it can be earned ---------------------------------------
test('an MCQ with NO options gets no box', () => {
  // Nothing to choose, so nothing to write — a box here is a mark the student
  // can never earn, and an empty bracket on a blank question reads as a
  // printing fault.
  const h = M._printMcqBlockHtml({ type: 'mcq', id: 'b1', options: [] });
  ok(h.indexOf('print-mcq-answer') < 0, 'boxed an empty MCQ: ' + h);
  const h2 = M._printMcqBlockHtml({ type: 'mcq', id: 'b1' });
  ok(h2.indexOf('print-mcq-answer') < 0, 'boxed an MCQ with no options array: ' + h2);
});

// ---- parts -----------------------------------------------------------------
test('a part letter is printed ON the box', () => {
  // Three unlabelled boxes down one sheet is exactly the confusion parts
  // exist to prevent.
  const h = M._printMcqBlockHtml(mcq(), 'b');
  ok(h.indexOf('Answer (b):') >= 0, 'the box does not name its part: ' + h);
});

test('a question with no parts gets a plain Answer label', () => {
  const h = M._printMcqAnswerBoxHtml('');
  ok(h.indexOf('Answer:') >= 0, 'plain label missing: ' + h);
  ok(h.indexOf('()') < 0 && h.indexOf('Answer :') < 0, 'stray empty label: ' + h);
});

test('an unknown part is not printed as a label', () => {
  // qPartNormalize is the ONE gate; a junk value must not reach the paper.
  const h = M._printMcqAnswerBoxHtml('not-a-part');
  eq(h.indexOf('not-a-part'), -1, 'junk part printed on the box');
});

// ---- the silent one: the two print paths -----------------------------------
const builder = (fnName) => {
  const a = src.indexOf('function ' + fnName);
  if (a < 0) throw new Error(fnName + ' not found in app.js');
  const b = src.indexOf('\nfunction ', a + 10);
  return src.slice(a, b < 0 ? src.length : b);
};

test('BOTH print paths carry an explicit case for mcq', () => {
  for (const fn of ['doPrintWorksheetOpen', 'buildWorksheetHtml']) {
    const body = builder(fn);
    ok(/case 'mcq':/.test(body), fn + ' has no explicit `case \'mcq\'` — it falls '
      + 'through to the shared student rendering, which has no answer box');
  }
});

test('BOTH print paths build the MCQ through the shared helper', () => {
  // A path that hand-rolled its own bracket is a path free to drift, which is
  // the whole reason this helper exists.
  for (const fn of ['doPrintWorksheetOpen', 'buildWorksheetHtml']) {
    const body = builder(fn);
    ok(body.indexOf('_printMcqBlockHtml(') >= 0, fn + ' does not call _printMcqBlockHtml');
    ok(body.indexOf('print-mcq-answer') < 0, fn + ' writes its own answer-box markup');
  }
});

test('BOTH print paths still put the MCQ answer on the printed key', () => {
  // The explicit case took the MCQ out of the `default` branch, which is where
  // `_pushBlockAnswerKey` was called — a key that omits a question prints
  // perfectly and looks tidy.
  for (const fn of ['doPrintWorksheetOpen', 'buildWorksheetHtml']) {
    const body = builder(fn);
    const i = body.indexOf("case 'mcq':");
    const j = body.indexOf('default:', i);
    const arm = body.slice(i, j < 0 ? body.length : j);
    ok(arm.indexOf('_pushBlockAnswerKey(') >= 0,
      fn + "'s `case 'mcq'` does not push the answer onto the key");
  }
});

// ---- the CSS the box is nothing without ------------------------------------
test('the print CSS defines the box, inside @media print', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url).pathname, 'utf8');
  const a = html.indexOf('@media print {');
  ok(a >= 0, 'no @media print block in index.html');
  // The block runs to the "PRINT MODE SELECTION" section that follows it.
  const b = html.indexOf('========== PRINT MODE SELECTION', a);
  const printCss = html.slice(a, b < 0 ? html.length : b);
  for (const sel of ['.print-mcq-answer', '.print-mcq-answer-label', '.print-mcq-answer-slot']) {
    ok(printCss.indexOf(sel + ' {') >= 0 || printCss.indexOf(sel + ',') >= 0,
      sel + ' is not defined inside @media print — the box prints as bare text');
  }
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
