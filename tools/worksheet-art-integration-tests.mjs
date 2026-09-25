import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start, end) {
  const from = src.indexOf(start), to = src.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'app function boundaries must exist');
  return src.slice(from, to);
}
const artwork = [
  { kind: 'character', character: 'orbit', text: 'Start reminder.', beforeQuestionId: '' },
  { kind: 'character', character: 'nova', text: 'Compare these measurements.', beforeQuestionId: 'q2' },
  { kind: 'character', character: 'pip', text: 'Unavailable question hint.', beforeQuestionId: 'locked' }
];
function setup() {
  const q1 = { id: 'q1', title: 'First', blocks: [] }, q2 = { id: 'q2', title: 'Second', blocks: [] };
  const elements = {
    wsTitle: { value: 'Builder worksheet' }, wsArtworkCount: { textContent: '' },
    wsPreviewOverlay: { classList: { contains: x => x === 'show' } }
  };
  const state = {
    window: {}, URL, location: { href: 'https://polymathlc.com.sg/' },
    document: {
      currentScript: null, getElementById: id => elements[id] || null,
      createElement: () => ({}), head: { appendChild() {} }, querySelectorAll: () => []
    },
    wsArtwork: artwork, _wsArtworkOwner: 'owner', currentUser: { uid: 'owner' },
    wsSelectedIds: new Set(['q1', 'q2']), questionBank: [q1, q2],
    savedWorksheets: [{ id: 'saved', title: 'Saved worksheet', questionIds: ['q1', 'q2'], artwork: [artwork[1]] }],
    _wsPreviewSaved: null, _wsPreviewPaper: null, _wsPreviewAdhoc: null,
    _cpbMeta: { artwork, wsFields: true, wsIntro: '' },
    _cpbMetaGet: key => state._cpbMeta[key], cpbLayout: () => ({ list: [q1, q2] }), cpbMarks: () => ({ total: 0 }),
    _wsSavedQuestions: () => [q1, q2], _wsAdhocQuestions: a => a.questions,
    _wsStudentFieldsOn: () => true, akxPrintOn: () => false, objBoxPrintOn: () => false,
    _wnyCachedNotes: () => null, wnyPrintOn: () => false, _wsCoverHtml: () => '', _ppCoverHtml: () => '',
    pvsAllowed: () => true, pvsPoolOf: x => x || '', PVS_POOL_CPB: 'cpb',
    escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x])),
    qIsMcqOnly: () => false, imgQuestionNeedsBig: () => false, _wsHeaderHtml: () => '<header>Worksheet</header>',
    qPartMap: () => new Map(), objBoxAutoHtml: () => '', _qAnswerKeyExtraSection: () => null,
    _qFallbackKeySection: () => null, _canAuthor: () => true, _cpbPrintOrder: () => [q1, q2], _cpbPaperTitle: () => 'Custom worksheet',
    worksheetArtAskAI: () => {}, setDoc: async () => {}, _wsRef: id => ({ uid: state.currentUser.uid, id }),
    cpbRender: () => {}, renderSavedWorksheets: () => {}, showToast: () => {}, renderWsPreview: () => {}
  };
  const context = vm.createContext(state);
  for (const name of ['worksheet-art.js', 'worksheet-art-editor.js']) vm.runInContext(readFileSync(new URL('../' + name, import.meta.url), 'utf8'), context);
  vm.runInContext([
    cut('function buildWorksheetHtml(selected, worksheetTitle, opts) {', '\n// One AI call per MCQ is a real wait'),
    cut('function _wsPreviewCtx() {', '\nfunction openWorksheetPreview()'),
    cut('function _wsPreviewBuildHtml(ctx, opts) {', '\n// Shared by the full exported view'),
    cut('function _tsendCtxSaved(id) {', '\n// ---- The three doors'),
    cut('function _cpbWorksheetOpts() {', '\n// THE ONE DOOR'),
    cut('function wsArtEdit(scope, id) {', '\nasync function worksheetArtAskAI('),
    cut('function wsArtResetForUser(user) {', '\n// Art belongs to a worksheet')
  ].join('\n'), context);
  return { state, context, elements, q1, q2 };
}

test('real worksheet builder puts art inside measured question chunks, exactly once at its placement', () => {
  const { context, q1, q2 } = setup();
  const out = context.buildWorksheetHtml([q1, q2], 'Worksheet', { plainNumbers: true, artwork });
  const second = out.indexOf('data-qid="q2"');
  assert.ok(out.indexOf('data-qid="q1"') < out.indexOf('Start reminder.'));
  assert.ok(out.indexOf('Start reminder.') < second);
  assert.ok(second < out.indexOf('Compare these measurements.'));
  assert.equal(out.split('Start reminder.').length - 1, 1);
  assert.doesNotMatch(out, /Unavailable question hint/);
  assert.doesNotMatch(context.buildWorksheetHtml([q1, q2], 'Unrelated'), /wa-element|Start reminder/);
});

test('builder, saved and Study Buddy contexts retain their own artwork without leaking into other previews', () => {
  const { context, state, q1 } = setup();
  assert.match(context._wsPreviewBuildHtml(context._wsPreviewCtx()), /Start reminder/);
  state._wsPreviewSaved = { id: 'saved' };
  assert.match(context._wsPreviewBuildHtml(context._wsPreviewCtx()), /Compare these measurements/);
  assert.doesNotMatch(context._wsPreviewBuildHtml(context._wsPreviewCtx()), /Start reminder/);
  assert.match(context._wsPreviewBuildHtml(context._tsendCtxSaved('saved'), { noTags: true }), /Compare these measurements/);
  state._wsPreviewPaper = { selected: [q1], title: 'Past paper' };
  assert.doesNotMatch(context._wsPreviewBuildHtml(context._wsPreviewCtx()), /wa-element/);
  state._wsPreviewPaper = null;
  state._wsPreviewAdhoc = { source: 'bank', title: 'Question proof', questions: [q1] };
  assert.doesNotMatch(context._wsPreviewBuildHtml(context._wsPreviewCtx()), /wa-element/);
});

test('custom Worksheet print options and full preview render identical art', () => {
  const { context, state, q1, q2 } = setup();
  const opts = context._cpbWorksheetOpts();
  const printed = context.buildWorksheetHtml([q1, q2], 'Custom worksheet', opts.buildOpts);
  state._wsPreviewAdhoc = { source: 'custompaper', title: 'Custom worksheet', questions: [q1, q2], buildOpts: opts.buildOpts, frontHtml: '' };
  const previewed = context._wsPreviewBuildHtml(context._wsPreviewCtx(), { noTags: true });
  assert.equal(previewed, printed);
  assert.match(printed, /Start reminder/);
});

test('saved art waits for confirmed persistence and refreshes the visible preview', async () => {
  const { context, state } = setup();
  let editor, written, refreshed = 0;
  state.window.WorksheetArtEditor.open = (_, opts) => { editor = opts; };
  state.setDoc = async (...args) => { written = args; };
  state.renderWsPreview = () => { refreshed++; };
  context.wsArtEdit('saved', 'saved');
  await editor.onSave([artwork[0]]);
  assert.equal(written[0].uid, 'owner');
  assert.equal(written[2].merge, true);
  assert.equal(state.savedWorksheets[0].artwork[0].text, 'Start reminder.');
  assert.equal(refreshed, 1);
  state.setDoc = async () => { throw new Error('offline'); };
  await assert.rejects(editor.onSave([]), /offline/);
  assert.equal(state.savedWorksheets[0].artwork.length, 1);
});

test('account changes clear unsaved art and block late editor callbacks from changing the next account', async () => {
  const { context, state, elements } = setup();
  let editor, closed = 0, renderCount = 0;
  state.window.WorksheetArtEditor.open = (_, opts) => { editor = opts; };
  state.document.querySelectorAll = () => [{ close: () => { closed++; } }];
  context.wsArtEdit('builder');
  context.wsArtResetForUser({ uid: 'next' });
  state.currentUser = { uid: 'next' };
  assert.equal(state.wsArtwork.length, 0);
  assert.equal(state.savedWorksheets.length, 0);
  assert.equal(elements.wsArtworkCount.textContent, '');
  assert.equal(closed, 1);
  await assert.rejects(editor.onSave(artwork), /account changed/);
  // The next owner's saved documents have now finished loading.
  state.savedWorksheets = [{ id: 'saved', title: 'Next worksheet', artwork: [] }];
  context.wsArtEdit('saved', 'saved');
  state.renderSavedWorksheets = () => { renderCount++; };
  state.setDoc = async () => { state.currentUser = { uid: 'another' }; };
  await editor.onSave([]);
  assert.equal(renderCount, 0);
});

test('the requested runtime and module preload use the same shipped version', () => {
  const preload = html.match(/<link rel="modulepreload" href="(app\.js[^\"]*)"/)[1];
  const runtime = html.match(/<script type="module" src="(app\.js[^\"]*)"/)[1];
  assert.equal(runtime, preload);
  assert.ok(runtime.endsWith(src.match(/const APP_VERSION = 'v([^']+)'/)[1]));
});
