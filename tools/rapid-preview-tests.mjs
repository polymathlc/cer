import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function previewAllVetting() {');
const end = source.indexOf('// 👁 EXPORTED HOVER', start);
assert.ok(start > 0 && end > start);
const bridge = source.slice(start, end);

function harness({ embedded = true, author = true } = {}) {
  const sent = [], previews = [], navigation = [], listeners = {};
  const parent = { postMessage: (message, origin) => sent.push({ message, origin }) };
  const window = { parent, addEventListener: (event, fn) => { listeners[event] = fn; } };
  if (!embedded) window.parent = window;
  const location = { search: '?rapidPreview=1', origin: 'https://polymathlc.github.io' };
  const state = { author, user: { uid: 'admin' }, list: [{ id: 'v1' }, { id: 'v2' }], closed: 0 };
  const api = new Function('window', 'location', 'document', 'state', 'previews', 'navigation', `
    let currentUser = state.user, vettingList = state.list;
    const _canAuthor = () => state.author;
    const _vetVisibleQuestions = () => vettingList.slice(1);
    const navigateTo = name => navigation.push(name);
    const previewQuestionsPrint = (...args) => previews.push(args);
    const closeWorksheetPreview = () => state.closed++;
    ${bridge}
    return { rapidPreviewReady, rapidPreviewReset, rapidPreviewMessage, previewAllVetting,
      setList: list => { vettingList = list; }, signOut: () => { currentUser = null; state.author = false; rapidPreviewReset(); } };
  `)(window, location, { getElementById: () => null }, state, previews, navigation);
  const message = (data, overrides = {}) => api.rapidPreviewMessage({ data, source: parent, origin: location.origin, ...overrides });
  return { api, message, sent, previews, navigation, state, location, parent, listeners };
}

test('Preview all uses the visible vetting set and the shared exported renderer', () => {
  const h = harness(); h.api.previewAllVetting();
  assert.deepEqual(h.previews[0][0], [{ id: 'v2' }]);
  assert.equal(h.previews[0][2], 'vetting');
});
test('the embedded bridge waits for signed-in question loading and trusts only its same-origin parent', () => {
  const h = harness();
  h.message({ type: 'cer-rapid-preview', ids: ['v1'] });
  assert.equal(h.previews.length, 0);
  h.api.rapidPreviewReady();
  assert.deepEqual(h.navigation, ['vetting']);
  assert.equal(h.sent[0].message.type, 'cer-rapid-preview-ready');
  assert.equal(h.sent[0].origin, h.location.origin);
  h.message({ type: 'cer-rapid-preview', ids: ['v1'] }, { origin: 'https://untrusted.example' });
  h.message({ type: 'cer-rapid-preview', ids: ['v1'] }, { source: {} });
  assert.equal(h.previews.length, 0);
  h.message({ type: 'cer-rapid-preview', ids: ['v2', 'unknown', 'v1', 'v1'] });
  assert.deepEqual(h.previews[0][0], [{ id: 'v2' }, { id: 'v1' }]);
  assert.equal(h.previews[0][2], 'vetting');
});
test('invalid or oversized messages cannot open arbitrary content or trigger writes', () => {
  const h = harness(); h.api.rapidPreviewReady();
  for (const ids of [null, [], [42], ['x'.repeat(201)], Array(501).fill('v1')]) h.message({ type: 'cer-rapid-preview', ids });
  assert.equal(h.previews.length, 0);
  h.message({ type: 'cer-rapid-preview', ids: ['not-readable'] });
  assert.equal(h.sent.at(-1).message.type, 'cer-rapid-preview-error');
});
test('parent close requests use the preview flush path and reject forged origins', () => {
  const h = harness(); h.api.rapidPreviewReady();
  h.message({ type: 'cer-rapid-preview-close-request' }, { origin: 'https://untrusted.example' });
  assert.equal(h.state.closed, 0);
  h.message({ type: 'cer-rapid-preview-close-request' });
  assert.equal(h.state.closed, 1);
});
test('a student, signed-out session, or top-level page cannot accept Add preview requests', () => {
  for (const options of [{ author: false }, { embedded: false }]) {
    const h = harness(options); h.api.rapidPreviewReady();
    h.message({ type: 'cer-rapid-preview', ids: ['v1'] });
    assert.equal(h.previews.length, 0); assert.equal(h.sent.length, 0);
  }
  const h = harness(); h.api.rapidPreviewReady(); h.api.signOut();
  h.message({ type: 'cer-rapid-preview', ids: ['v1'] });
  assert.equal(h.previews.length, 0);
});
test('preview rerenders resolve the current vetting document after a server image edit', () => {
  const a = source.indexOf('function _wsAdhocQuestions(a) {'), b = source.indexOf('function previewQuestionsPrint(', a);
  const live = { id: 'v1', blocks: [{ url: 'new-image.png' }] };
  const run = new Function('vettingList', source.slice(a, b) + '; return _wsAdhocQuestions;')([live]);
  assert.equal(run({ source: 'vetting', questions: [{ id: 'v1', blocks: [{ url: 'old-scan.png' }] }] })[0], live);
});
test('embedded Close keeps the preview and unsaved edits until persistence succeeds', async () => {
  const a = source.indexOf('function closeWorksheetPreview() {'), b = source.indexOf('function wsBreakBefore(', a);
  const state = { fail: true, removed: 0, messages: [] };
  const api = new Function('state', `
    const _pvsDirty = new Map([['vetting|v1', 'vetting']]), _pvsReplanTimer = null;
    let _wsPreviewAdhoc = { source: 'vetting' }, _wsPreviewSaved = null, _wsPreviewPaper = null;
    const rapidPreviewEmbedded = () => true;
    const rapidPreviewPost = type => state.messages.push(type);
    const pvsFlushSettled = () => Promise.resolve();
    const pvsFlush = async () => { if (!state.fail) _pvsDirty.clear(); };
    const document = { getElementById: () => ({ classList: { remove: () => state.removed++ } }) };
    const closeWsQuickEdit = () => {}, closeAke = () => {};
    ${source.slice(a, b)}
    return { closeWorksheetPreview, context: () => _wsPreviewAdhoc };
  `)(state);
  api.closeWorksheetPreview(); await new Promise(setImmediate);
  assert.equal(state.removed, 0); assert.equal(api.context().source, 'vetting');
  assert.equal(state.messages.at(-1), 'cer-rapid-preview-error');
  state.fail = false; api.closeWorksheetPreview(); await new Promise(setImmediate);
  assert.equal(state.removed, 1); assert.equal(api.context(), null);
  assert.equal(state.messages.at(-1), 'cer-rapid-preview-close');
});
