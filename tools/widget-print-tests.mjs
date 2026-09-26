// Apps used to be deliberately omitted from paper. Exercise the real print
// builders so a new worksheet/export path cannot silently drop the QR card.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function cut(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, 'Find print function: ' + from);
  return source.slice(start, end);
}
const functions = [
  cut('function doPrintWorksheetOpen(', '// ===== SHARED: Auto-scale pages'),
  cut('function buildWorksheetHtml(', '// One AI call per MCQ'),
  cut('function _wsPreviewBuildHtml(', '// Shared by the full exported view'),
  cut('function _wsQeBlockSummary(', 'function _wsQeRender(')
].join('\n');

const appBlock = { id: 'lab', type: 'widget', title: 'Respirometer', html: '<script>experiment()</script>', appUrl: 'https://example.test/app.html#public-app' };
const question = { id: 'question-1', title: 'Grasshopper', category: 'P5', topic: 'Respiration', blocks: [appBlock] };

function harness(block = appBlock) {
  const selected = [{ ...question, blocks: [block] }];
  const output = { innerHTML: '' };
  const calls = [];
  const api = new Function('selected', 'output', 'calls', `
    const questionBank = selected, printSelectedIds = new Set(selected.map(q => q.id));
    const document = { getElementById: () => output };
    const window = { QuestionApps: { printBlock(block) {
      calls.push(block);
      return block.appUrl ? '<div class="app-qr-card">QR:' + block.appUrl + '</div>' : '<div class="app-qr-pending">Publish app before printing QR</div>';
    } } };
    const escapeHtml = s => String(s ?? '');
    const qIsMcqOnly = () => false, imgQuestionNeedsBig = () => false;
    const objBoxPrintOn = () => false, objBoxAutoHtml = () => '';
    const qPartMap = () => ({}), qPartOf = () => '';
    const _pushAnnotAnswerKey = () => {}, autoscaleAndPrint = () => {};
    const _qAnswerKeyExtraSection = () => null, _qFallbackKeySection = () => null;
    const _wsHeaderHtml = () => '<header>Worksheet</header>', pvsPoolOf = s => s || '';
    const pvoWrapOpen = () => '<div class="preview-order-wrap">';
    const _wnyCachedNotes = () => null, wnyPrintOn = () => false, pvsAllowed = () => true;
    function renderImportedBlockStudent() { throw new Error('App fell through to screen rendering'); }
    ${functions}
    return { doPrintWorksheetOpen, buildWorksheetHtml, _wsPreviewBuildHtml, _wsQeBlockSummary };
  `)(selected, output, calls);
  return { api, output, calls, selected };
}

test('direct bank printing includes each app card exactly once', () => {
  const h = harness();
  h.api.doPrintWorksheetOpen(null);
  assert.match(h.output.innerHTML, /QR:https:\/\/example\.test\/app\.html#public-app/);
  assert.deepEqual(h.calls, [appBlock]);
  assert.doesNotMatch(h.output.innerHTML, /experiment\(\)|<iframe|<script/);
});

test('saved/custom worksheets and custom papers keep the same QR card', () => {
  for (const options of [{}, { plainNumbers: true }, { paper: { numbers: { 'question-1': '29' }, noBracketIds: new Set(['question-1']) } }]) {
    const h = harness();
    const html = h.api.buildWorksheetHtml(h.selected, 'Worksheet', options);
    assert.match(html, /class="app-qr-card"/);
    assert.deepEqual(h.calls, [appBlock]);
    assert.doesNotMatch(html, /<script|<iframe/);
  }
});

test('A4 preview and Study Buddy export both preserve the card', () => {
  for (const noTags of [false, true]) {
    const h = harness();
    const html = h.api._wsPreviewBuildHtml({ selected: h.selected, title: 'Worksheet', frontHtml: '', where: 'saved' }, { noTags });
    assert.match(html, /class="app-qr-card"/);
    assert.equal(html.includes('preview-order-wrap'), !noTags);
    assert.deepEqual(h.calls, [appBlock]);
  }
  const exportPath = cut('function _tsendRenderPages(', 'async function tsendSend(');
  assert.match(exportPath, /_wsPreviewBuildHtml\(ctx,\s*\{\s*noTags:\s*true\s*\}\)/);
});

test('an unpublished app shows a publishing instruction instead of disappearing', () => {
  const h = harness({ ...appBlock, appUrl: '' });
  const html = h.api.buildWorksheetHtml(h.selected, 'Worksheet', {});
  assert.match(html, /Publish app before printing QR/);
  assert.doesNotMatch(html, /class="app-qr-card"/);
});

test('quick edit describes the printed QR rather than claiming the app is omitted', () => {
  const h = harness();
  assert.match(h.api._wsQeBlockSummary(appBlock), /QR/);
  assert.doesNotMatch(h.api._wsQeBlockSummary(appBlock), /not printed|screen-only/);
});

function printEntry(publish, calls) {
  const code = cut('async function doPrintStudentWorksheet(', '// =====================================================================\n// SYLLABUS-GROUPED PDF');
  return new Function('_widgetEnsurePublished', 'calls', `
    const document = { getElementById: () => ({ innerHTML: '' }) };
    const wsManualBreaks = new Set(), wsMergeUp = new Set();
    const buildWorksheetHtml = () => { calls.push('build'); return 'sheet'; };
    const autoscaleAndPrint = () => calls.push('print');
    const _printProgressHide = () => calls.push('hide-progress');
    const showToast = (message, kind) => calls.push({ message, kind });
    ${code}
    return doPrintStudentWorksheet;
  `)(publish, calls);
}

test('explicit printing waits for public app storage before building a QR sheet', async () => {
  const calls = [];
  let finish;
  const publish = selected => {
    assert.deepEqual(selected, [question]);
    calls.push('publish');
    return new Promise(resolve => { finish = resolve; });
  };
  const run = printEntry(publish, calls)([question], 'Worksheet');
  assert.deepEqual(calls, ['publish'], 'no layout or printing while the app is unavailable');
  finish();
  await run;
  assert.deepEqual(calls, ['publish', 'build', 'print']);
});

test('a failed app publication cancels printing and gives a useful error', async () => {
  const calls = [];
  const publish = async () => { throw new Error('Storage unavailable'); };
  await printEntry(publish, calls)([question], 'Worksheet');
  assert.deepEqual(calls, ['hide-progress', { message: 'Could not publish app QR: Storage unavailable', kind: 'error' }]);
});

test('print/export doors publish, while opening a preview does not', () => {
  for (const [start, end] of [
    ['async function printWorksheet()', '// Helper: generate dotted'],
    ['async function cpbPrint()', 'function cpbPreview()'],
    ['async function generateSyllabusPdf()', '// ====================================================================='],
    ['async function ppDoPrint(', '// Each of the three past-paper'],
    ['async function loPrint(', '// ---------- attach questions'],
    ['async function tsendSend()', '// A fresh Firestore document id']
  ]) {
    assert.match(cut(start, end), /await _widgetEnsurePublished\(/, start);
  }
  assert.doesNotMatch(cut('async function renderWsPreview()', '// The sheet a preview CONTEXT'), /_widgetEnsurePublished/);
  assert.doesNotMatch(cut('function _vetPrintPeekRender(', 'function vetPrintPeekShow('), /_widgetEnsurePublished/);
});
