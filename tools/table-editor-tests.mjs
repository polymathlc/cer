// Regression tests for the TABLE BLOCK — the position-remapping engine and
// the screenshot reader. Run with:
//     node tools/table-editor-tests.mjs            all cases
//     node tools/table-editor-tests.mjs <name>     one case
//
// It loads the REAL functions out of app.js.
//
// Every failure here is SILENT and the table still renders. Everything about
// a table except its text is keyed BY POSITION — cellStyles["2_3"],
// rowHeights[2], colWidths[3] and every merge rectangle — so a row inserted
// at the top without carrying those along leaves the author's shading one row
// out, on a screen that looks completely right. On the reading side, a spec
// that is not clamped and padded produces a ragged block.data that the
// renderer walks by block.cols: cells simply go missing, with no error
// anybody can act on, and an unfiltered cell string is arbitrary HTML written
// into a contenteditable and printed onto a worksheet.
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

const section = [
  // The whole engine, from the first remapper to the grip helpers.
  cut('function _tblRemapCellKeys', 'function tableSelectWholeRow', 'table engine'),
  // The style presets the header-row branch of _tblFromAi reads.
  cut('function _tblColName', '\n}\n', 'column names') + '\n}\n',
  cut('const TABLE_FONTS', 'function _tblShotZoneHtml', 'fonts'),
  cut('const TBL_AI_MAX_SIDE', 'function tblShotPaste', 'screenshot reader'),
  cut("// ── ONE serialiser for a cell's look", 'function renderTableReadonly', 'cell css'),
  // Stubs for the editor plumbing the engine calls back into.
  'let blocks = [];',
  'let _toasts = [];',
  'function showToast(m, k) { _toasts.push([m, k]); }',
  'function renderBlocks() {}',
  'let _sel = {};',
  'function getTableSelectedCells(id) { if (!_sel[id]) _sel[id] = new Set(); return _sel[id]; }',
  'function tableClearSelection(id) { getTableSelectedCells(id).clear(); }',
  'function updateTableCellSelection() {}',
  'let activeTableBlockId = null;',
  'const document = { querySelector: () => null, querySelectorAll: () => [] };',
].join('\n');

const M = new Function(section + `
return {
  _tblInsertRow, _tblDeleteRow, _tblInsertCol, _tblDeleteCol, _tblNormalise,
  _tblSelRows, _tblSelCols, _tblColName, _tblCellCss,
  tableInsertRow, tableInsertCol, tableDeleteRows, tableDeleteCols,
  tableAddRow, tableAddCol, tableRemoveRow, tableRemoveCol,
  tableDistribute, tableClearFormatting, tableApplyStyle, tableSetFontWeight,
  TABLE_STYLE_PRESETS, TABLE_FONTS,
  _tblFromAi, _tblAiCleanCell, _tblAiPrompt, TBL_AI_MAX_ROWS, TBL_AI_MAX_COLS,
  __setBlocks: b => { blocks = b; },
  __toasts: () => _toasts,
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error((what || '') + '\n        got  ' + g + '\n        want ' + w);
};
const ok = (cond, what) => { if (!cond) throw new Error(what); };

// A 3x3 table whose every position-keyed structure is filled in, so a
// remapper that forgets one of them cannot pass.
const table = () => ({
  id: 't1', type: 'table', rows: 3, cols: 3,
  data: [['a0', 'a1', 'a2'], ['b0', 'b1', 'b2'], ['c0', 'c1', 'c2']],
  merges: [],
  cellStyles: { '0_0': { backgroundColor: '#eee' }, '2_2': { color: '#f00' } },
  cellPadding: { '2_0': { top: 4, right: 4, bottom: 4, left: 4 } },
  rowHeights: { 2: 40 },
  colWidths: [null, 80, null],
});

// ── inserting a row ─────────────────────────────────────────────────────
test('a row inserted at the top carries the shading down with it', () => {
  const b = table();
  M._tblInsertRow(b, 0);
  eq(b.rows, 4, 'row count');
  eq(b.data[0], ['', '', ''], 'the new row is blank');
  eq(b.data[1], ['a0', 'a1', 'a2'], 'the old first row moved down');
  ok(!b.cellStyles['0_0'], 'the old 0_0 shading must not stay at the top');
  eq(b.cellStyles['1_0'], { backgroundColor: '#eee' }, 'shading followed its cell');
  eq(b.cellStyles['3_2'], { color: '#f00' }, 'the last row followed too');
  eq(b.cellPadding['3_0'], { top: 4, right: 4, bottom: 4, left: 4 }, 'padding followed');
  eq(b.rowHeights, { 3: 40 }, 'row height followed');
});

test('a row inserted below everything appends and moves nothing', () => {
  const b = table();
  M._tblInsertRow(b, 3);
  eq(b.rows, 4, 'row count');
  eq(b.cellStyles['0_0'], { backgroundColor: '#eee' }, 'nothing above it moved');
  eq(b.rowHeights, { 2: 40 }, 'nothing above it moved');
});

test('a merge the new row lands inside GROWS; one below it moves down', () => {
  const b = table();
  b.merges = [{ sr: 0, sc: 0, er: 1, ec: 0 }, { sr: 2, sc: 1, er: 2, ec: 2 }];
  M._tblInsertRow(b, 1);
  eq(b.merges[0], { sr: 0, sc: 0, er: 2, ec: 0 }, 'the straddled merge grew to keep covering its cells');
  eq(b.merges[1], { sr: 3, sc: 1, er: 3, ec: 2 }, 'the merge below moved down');
});

// ── deleting a row ──────────────────────────────────────────────────────
test('a deleted row takes its own formatting and renumbers what is under it', () => {
  const b = table();
  b.cellStyles['1_1'] = { color: '#00f' };
  M._tblDeleteRow(b, 1);
  eq(b.rows, 2, 'row count');
  eq(b.data, [['a0', 'a1', 'a2'], ['c0', 'c1', 'c2']], 'the middle row went');
  ok(!b.cellStyles['1_1'], "the deleted row's own style went with it");
  eq(b.cellStyles['1_2'], { color: '#f00' }, 'the row below moved up and kept its colour');
  eq(b.rowHeights, { 1: 40 }, 'row height moved up');
});

test('the last row is never deleted — a table with no rows cannot be edited', () => {
  const b = table();
  b.rows = 1; b.data = [['x', 'y', 'z']];
  eq(M._tblDeleteRow(b, 0), false, 'it refuses');
  eq(b.rows, 1, 'and changes nothing');
});

test('a merge that only covered the deleted row is dropped, not left dangling', () => {
  const b = table();
  b.merges = [{ sr: 1, sc: 0, er: 1, ec: 2 }, { sr: 0, sc: 0, er: 2, ec: 0 }];
  M._tblDeleteRow(b, 1);
  eq(b.merges.length, 1, 'the one-row merge went');
  eq(b.merges[0], { sr: 0, sc: 0, er: 1, ec: 0 }, 'the straddling merge shrank by one');
});

// ── columns ─────────────────────────────────────────────────────────────
test('a column inserted at the left carries widths and shading across', () => {
  const b = table();
  M._tblInsertCol(b, 0);
  eq(b.cols, 4, 'col count');
  eq(b.data[0], ['', 'a0', 'a1', 'a2'], 'the new column is blank');
  eq(b.colWidths, [null, null, 80, null], 'the hand-set width followed its column');
  eq(b.cellStyles['0_1'], { backgroundColor: '#eee' }, 'shading followed');
  eq(b.cellPadding['2_1'], { top: 4, right: 4, bottom: 4, left: 4 }, 'padding followed');
});

test('a deleted column takes its width and its formatting', () => {
  const b = table();
  M._tblDeleteCol(b, 1);
  eq(b.cols, 2, 'col count');
  eq(b.data[0], ['a0', 'a2'], 'the middle column went');
  eq(b.colWidths, [null, null], 'the deleted width went with it');
  eq(b.cellStyles['2_1'], { color: '#f00' }, 'the column to its right moved left');
});

test('the last column is never deleted', () => {
  const b = table();
  b.cols = 1; b.data = [['x'], ['y'], ['z']]; b.colWidths = [null];
  eq(M._tblDeleteCol(b, 0), false, 'it refuses');
});

// ── the buttons on the toolbar ──────────────────────────────────────────
test('Insert above / below read the SELECTION, not the end of the table', () => {
  const b = table();
  M.__setBlocks([b]);
  // Nothing selected: "above" means the very top and "below" means the end,
  // so a table nobody has clicked in still behaves the way + Row always did.
  M.tableInsertRow('t1', 'above');
  eq(b.rows, 4, 'a row was added');
  eq(b.data[0], ['', '', ''], 'above with no selection goes to the top');
  eq(b.data[1], ['a0', 'a1', 'a2'], 'and pushed the old first row down');
  M.tableInsertRow('t1', 'below');
  eq(b.rows, 5, 'a second row');
  eq(b.data[4], ['', '', ''], 'below with no selection goes to the end');
});

test('+ Row still appends, and goes through the same engine', () => {
  const b = table();
  M.__setBlocks([b]);
  M.tableAddRow('t1');
  eq(b.rows, 4, 'appended');
  eq(b.data[3], ['', '', ''], 'the new row is at the bottom');
  eq(b.cellStyles['0_0'], { backgroundColor: '#eee' }, 'nothing moved');
});

test('deleting rows works from the BOTTOM up, or the indexes renumber under it', () => {
  const b = table();
  b.rows = 4;
  b.data = [['0'], ['1'], ['2'], ['3']].map(r => [r[0], r[0], r[0]]);
  M.__setBlocks([b]);
  M._tblDeleteRow(b, 2);
  M._tblDeleteRow(b, 0);
  eq(b.data.map(r => r[0]), ['1', '3'], 'rows 0 and 2 went — not 0 and 3');
});

// ── styles ──────────────────────────────────────────────────────────────
test('a table style writes REAL cell colours, so it prints as it looks', () => {
  const b = table();
  M.__setBlocks([b]);
  M.tableApplyStyle('t1', 'banded');
  eq(b.cellStyles['0_0'].backgroundColor, M.TABLE_STYLE_PRESETS.banded.head.backgroundColor, 'heading row');
  eq(b.cellStyles['0_0'].fontWeight, '700', 'heading row is bold');
  eq(b.cellStyles['2_0'].backgroundColor, M.TABLE_STYLE_PRESETS.banded.band, 'the band');
  ok(!b.cellStyles['1_0'] || !b.cellStyles['1_0'].backgroundColor, 'the row between is untinted');
});

test('a style leaves an alignment the author set by hand alone', () => {
  const b = table();
  b.cellStyles['1_1'] = { textAlign: 'center', backgroundColor: '#123456' };
  M.__setBlocks([b]);
  M.tableApplyStyle('t1', 'header');
  eq(b.cellStyles['1_1'].textAlign, 'center', 'their alignment survived');
  ok(!b.cellStyles['1_1'].backgroundColor, 'the colour a style owns was reset');
});

test('Clear formatting leaves the TEXT — it is not a delete', () => {
  const b = table();
  M.__setBlocks([b]);
  M.tableClearFormatting('t1');
  eq(b.data[0], ['a0', 'a1', 'a2'], 'every word is still there');
  eq(b.cellStyles, {}, 'the styles went');
  eq(b.cellPadding, {}, 'the padding went');
});

test('Distribute evenly clears the hand-set sizes', () => {
  const b = table();
  M.__setBlocks([b]);
  M.tableDistribute('t1', 'cols');
  eq(b.colWidths, [null, null, null], 'every column is back on an equal share');
  M.tableDistribute('t1', 'rows');
  eq(b.rowHeights, {}, 'every row is back to its natural height');
});

// ── one serialiser for the look ─────────────────────────────────────────
test('the shared serialiser writes the font FACE — the print path reads it too', () => {
  const css = M._tblCellCss({ fontFamily: 'Georgia, serif', fontSize: '11pt', fontWeight: '700' }, null, null);
  ok(/font-family:Georgia, serif;/.test(css), 'face: ' + css);
  ok(/font-size:11pt;/.test(css), 'size: ' + css);
  ok(/font-weight:700;/.test(css), 'weight: ' + css);
});

test('the shared serialiser writes nothing for a cell nobody has styled', () => {
  eq(M._tblCellCss({}, null, null), '', 'an unstyled cell must render byte for byte as it always did');
});

// ── the screenshot reader ───────────────────────────────────────────────
test('a short row is PADDED to the declared width', () => {
  const b = M._tblFromAi({ rows: 2, cols: 3, data: [['a'], ['x', 'y', 'z']] });
  eq(b.data[0], ['', '', ''].map((_, i) => (i === 0 ? 'a' : '')), 'the short row was filled out');
  eq(b.data[0].length, 3, 'every row is exactly cols wide');
});

test('a long row is CUT to the declared width', () => {
  const b = M._tblFromAi({ rows: 1, cols: 2, data: [['a', 'b', 'c', 'd']] });
  eq(b.data[0], ['a', 'b'], 'trimmed');
});

test('cols is worked out from the data when the model forgot to say', () => {
  const b = M._tblFromAi({ rows: 2, data: [['a', 'b'], ['c', 'd']] });
  eq(b.cols, 2, 'cols');
});

test('a reply with no table at all is an ERROR, never an empty table', () => {
  let threw = false;
  try { M._tblFromAi({ rows: 0, cols: 0, data: [] }); } catch (e) { threw = true; }
  ok(threw, 'an empty table would read as a screenshot that worked');
});

test('a merge outside the grid is dropped rather than hiding real cells', () => {
  const b = M._tblFromAi({
    rows: 2, cols: 2, data: [['a', 'b'], ['c', 'd']],
    merges: [{ sr: 0, sc: 0, er: 9, ec: 9 }, { sr: 0, sc: 0, er: 0, ec: 1 }]
  });
  eq(b.merges, [{ sr: 0, sc: 0, er: 0, ec: 1 }], 'only the real one survived');
});

test('a one-cell "merge" is dropped — it is not a merge', () => {
  const b = M._tblFromAi({ rows: 2, cols: 2, data: [['a', 'b'], ['c', 'd']], merges: [{ sr: 1, sc: 1, er: 1, ec: 1 }] });
  eq(b.merges, [], 'nothing to merge');
});

test('two overlapping merges cannot both be honoured — the first wins', () => {
  const b = M._tblFromAi({
    rows: 3, cols: 3, data: [['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i']],
    merges: [{ sr: 0, sc: 0, er: 1, ec: 1 }, { sr: 1, sc: 1, er: 2, ec: 2 }]
  });
  eq(b.merges.length, 1, 'one merge');
});

test('only the handful of safe tags survive a cell', () => {
  eq(M._tblAiCleanCell('25 cm<sup>3</sup>'), '25 cm<sup>3</sup>', 'a unit keeps its superscript');
  eq(M._tblAiCleanCell('H<sub>2</sub>O'), 'H<sub>2</sub>O', 'a formula keeps its subscript');
  eq(M._tblAiCleanCell('a<br>b'), 'a<br>b', 'a line break survives');
  eq(M._tblAiCleanCell('<script>alert(1)</script>hi'), 'alert(1)hi', 'a script tag is stripped');
  eq(M._tblAiCleanCell('<b onclick="x()">bold</b>'), '<b>bold</b>', 'an attribute never rides in');
  eq(M._tblAiCleanCell('<img src=x onerror=y>'), '', 'a remote image is stripped');
  eq(M._tblAiCleanCell('<div style="color:red">x</div>'), 'x', 'a style is stripped');
});

test('the row and column counts are clamped', () => {
  const wide = M._tblFromAi({ rows: 999, cols: 999, data: [['a']] });
  ok(wide.rows <= M.TBL_AI_MAX_ROWS, 'rows clamped: ' + wide.rows);
  ok(wide.cols <= M.TBL_AI_MAX_COLS, 'cols clamped: ' + wide.cols);
});

test('a heading row is given the SAME look the Header row style gives it', () => {
  const b = M._tblFromAi({ rows: 2, cols: 2, headerRow: true, data: [['h', 'h'], ['a', 'b']] });
  eq(b.cellStyles['0_0'].backgroundColor, M.TABLE_STYLE_PRESETS.header.head.backgroundColor, 'one map, one appearance');
  ok(!b.cellStyles['1_0'], 'the body rows are untouched');
});

test('alignment comes across cell for cell', () => {
  const b = M._tblFromAi({
    rows: 1, cols: 3, data: [['a', 'b', 'c']],
    align: [['left', 'center', 'right']]
  });
  ok(!b.cellStyles['0_0'], 'left is the default and is not written out');
  eq(b.cellStyles['0_1'], { textAlign: 'center' }, 'centre');
  eq(b.cellStyles['0_2'], { textAlign: 'right' }, 'right');
});

test('the prompt tells the model to TRANSCRIBE and not to improve', () => {
  const p = M._tblAiPrompt();
  ok(/TRANSCRIBE, do not improve/.test(p), 'the transcription rule is the reason this is not grounded in the notes');
  ok(/never fill a blank cell in/i.test(p), 'a blank cell must stay blank');
  ok(/Return ONLY JSON/.test(p), 'JSON only');
});

// ── grips ───────────────────────────────────────────────────────────────
test('column grips are named the way a spreadsheet names them', () => {
  eq([0, 1, 25, 26, 27].map(M._tblColName), ['A', 'B', 'Z', 'AA', 'AB'], 'names');
});

// ── run ─────────────────────────────────────────────────────────────────
const only = process.argv[2];
let pass = 0, fail = 0;
cases.filter(c => !only || c.name.indexOf(only) >= 0).forEach(c => {
  try { c.fn(); pass++; console.log('  ✓ ' + c.name); }
  catch (e) { fail++; console.log('  ✗ ' + c.name + '\n      ' + e.message); }
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
