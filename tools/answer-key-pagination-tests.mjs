// Regression tests for THE PAGINATED ANSWER KEY.
// Run with:
//     node tools/answer-key-pagination-tests.mjs            all cases
//     node tools/answer-key-pagination-tests.mjs <name>     one case
//
// The answer key used to be measured as ONE pre-built page: a key too tall to
// shrink readably was marked `tall` and left to flow. On screen that is a
// single sheet several pages long with the rows running off the bottom of it
// (the "Pages 22–23 of 23" bug), and in the PDF it is a page box that is a
// fixed height with visible overflow. A twenty-three-question key is the
// ordinary case, not an edge one.
//
// The rows are packed into sheets now, the way the questions already were.
// Every way that goes wrong is silent and lands on paper:
//
//  • THE HEADING IS ON EVERY SHEET, so it has to come out of EVERY sheet's
//    budget. Charged once, sheet two onwards is over the bar by a heading.
//  • A ROW TALLER THAN A SHEET must still get a sheet of its own rather than
//    being dropped or looped on forever — a long CER answer with an
//    explanation under it really can be that tall.
//  • THE TWO CONSUMERS MUST BUILD FROM THE ONE BUILDER. The printer and the
//    live preview assemble the sheets separately; if either stops calling
//    `_printAkPageEl`, the preview paginates differently from the PDF and the
//    teacher checks a layout they will not get.
//  • THE ROWS MUST GO BACK IN INDEX ORDER after measuring. The live preview
//    plans against the very DOM it then rebuilds from, so a re-query in
//    shuffled order hands sheet one the rows of sheet three — every answer
//    under the wrong question number, and nothing anywhere saying so.
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

const M = new Function(
  cut('function _packAkRows(rowHs, headH, budget) {', '\nfunction _printPlanAkPages', 'packer') +
  cut('function _akPageTitle(base, gi) {', '\nfunction _printAkPageEl', 'title') + `
return { pack: _packAkRows, title: _akPageTitle };`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
};
const deep = (got, want, what) => eq(JSON.stringify(got), JSON.stringify(want), what);

// ── the packing decision ────────────────────────────────────────────────────

test('a key that fits stays ONE sheet', () => {
  deep(M.pack([100, 100, 100], 40, 800), [[0, 1, 2]], 'one sheet');
});

test('a key that does not fit is split, in reading order', () => {
  // 40 heading + 3×100 = 340 fits; the fourth would make 440 > 400.
  deep(M.pack([100, 100, 100, 100, 100], 40, 400), [[0, 1, 2], [3, 4]], 'two sheets');
});

test('the heading is charged to EVERY sheet, not just the first', () => {
  // With the heading charged once, sheet two would take three rows (300 ≤ 400)
  // and print a heading-and-three-rows page that is over the bar.
  const groups = M.pack([100, 100, 100, 100, 100, 100], 150, 400);
  groups.forEach((g, i) => ok(150 + g.length * 100 <= 400 || g.length === 1,
    'sheet ' + (i + 1) + ' is over the budget with its heading on it'));
});

test('a row taller than a whole sheet gets a sheet to itself', () => {
  // …and is never dropped, and never loops. The verify pass then decides
  // whether that sheet shrinks or is let flow.
  deep(M.pack([100, 5000, 100], 40, 400), [[0], [1], [2]], 'one each');
});

test('the very first row always lands somewhere, however tall', () => {
  deep(M.pack([9999], 40, 400), [[0]], 'a single enormous row');
});

test('every row appears exactly once, in order, whatever the heights', () => {
  const hs = [80, 220, 45, 900, 130, 60, 310, 75];
  const flat = M.pack(hs, 55, 500).flat();
  deep(flat, hs.map((_, i) => i), 'no row lost, none repeated, none reordered');
});

test('an empty key packs to nothing rather than an empty sheet', () => {
  deep(M.pack([], 40, 400), [], 'no groups');
  deep(M.pack(null, 40, 400), [], 'and no throw on nothing at all');
});

// ── the heading on each sheet ───────────────────────────────────────────────

test('sheet two onwards says it is a continuation', () => {
  eq(M.title('Answer Key', 0), 'Answer Key', 'the first sheet');
  eq(M.title('Answer Key', 1), 'Answer Key (continued)', 'the second');
  eq(M.title('Answer Key', 4), 'Answer Key (continued)', 'the fifth');
});

test('a missing heading still names the page', () => {
  eq(M.title('', 0), 'Answer Key', 'empty');
  eq(M.title(null, 1), 'Answer Key (continued)', 'absent');
});

// ── the two consumers cannot drift ──────────────────────────────────────────

test('BOTH the printer and the preview build sheets through _printAkPageEl', () => {
  const printer = src.slice(src.indexOf('function doScaleAndPrint('), src.indexOf('function doScaleAndPrint(') + 4000);
  ok(/_printAkPageEl\(/.test(printer), 'doScaleAndPrint builds its own key sheets');
  const pi = src.indexOf('function _wsPreviewPack(');
  const preview = src.slice(pi, src.indexOf('\nfunction ', pi + 10));
  ok(/_printAkPageEl\(/.test(preview), '_wsPreviewPack builds its own key sheets');
});

test('the planner hands the rows back in INDEX order', () => {
  const fn = src.slice(src.indexOf('function _printPlanAkPages('), src.indexOf('\nfunction _printPlanIn('));
  ok(/rows\.forEach\(r => ak\.appendChild\(r\)\);/.test(fn),
    'the restore pass is gone — the preview would rebuild from a shuffled DOM');
});

// ── the explanation is set apart from the answer ────────────────────────────

test('every explanation section built anywhere is tagged as one', () => {
  // The whole object literal around each one, so the two fields may be written
  // in either order — what matters is that `kind` is there.
  const hits = [];
  let at = -1;
  while ((at = src.indexOf("label: 'Explanation'", at + 1)) >= 0) {
    const open = src.lastIndexOf('{', at);
    const close = src.indexOf('}', at);
    hits.push(src.slice(open, close + 1));
  }
  ok(hits.length >= 3, 'found the pushers (' + hits.length + ')');
  hits.forEach((h, i) => ok(/kind: 'explanation'/.test(h),
    'explanation section #' + (i + 1) + ' is not tagged, so the key runs it on under the answer:\n           ' + h));
});

test('the renderer keys the separation off `kind`, never the label text', () => {
  const fn = src.slice(src.indexOf('function _akSectionsHtml('), src.indexOf('function _akSectionsHtml(') + 1400);
  ok(/sec\.kind === 'explanation'/.test(fn), 'matched on kind');
  ok(!/sec\.label === 'Explanation'/.test(fn), 'not on the wording');
});

test('the print CSS sets the explanation apart, inside @media print', () => {
  const a = html.indexOf('@media print');
  ok(a >= 0, 'the print block exists');
  let depth = 0, i = html.indexOf('{', a), end = i;
  for (; end < html.length; end++) {
    if (html[end] === '{') depth++;
    else if (html[end] === '}') { depth--; if (depth === 0) break; }
  }
  const block = html.slice(a, end);
  ok(/\.ak-sublabel\.ak-expl/.test(block), 'the explanation label has its own rule');
  ok(/border-top/.test(block.slice(block.indexOf('.ak-sublabel.ak-expl'), block.indexOf('.ak-sublabel.ak-expl') + 400)),
    'and a rule above it, so the two do not read as one block of text');
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
