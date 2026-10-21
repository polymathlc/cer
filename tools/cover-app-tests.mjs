import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return app.slice(from, to);
}
function harness() {
  const nodes = {
    wsTitle: { value: 'Heat and matter' }, wsIncludeCover: { checked: true }, wsIncludeFields: { checked: true },
    mwIncludeCover: { checked: true }, mwIncludeFields: { checked: true },
    wsPreviewOverlay: { classList: { contains: () => false } }, printOutput: { innerHTML: '' }
  };
  const calls = { render: [], edit: [], print: [], writes: [], toasts: [] };
  const state = {
    window: { WorksheetCover: {
      render(options) { calls.render.push({ ...options }); return '<div class="print-front-page print-cover-page wc-cover">' + options.title + '</div>'; },
      async edit(options) { calls.edit.push({ ...options }); return state.result; },
      decoration(subject, options) { return `<div class="cover-artwork" data-subject="${subject}" data-scale="${options.scale}"></div>`; },
      logoUrl: 'http://localhost/assets/worksheet-covers/polymath-logo.png'
    } },
    result: { title: 'Edited cover', fields: false, subject: 'science', footer: 'Practice' },
    document: { getElementById: id => nodes[id] || null },
    currentUser: { uid: 'owner' }, savedWorksheets: [{ id: 'saved', title: 'Original title', questionIds: ['q1'] }],
    questionBank: [{ id: 'q1' }], wsSelectedIds: new Set(['q1']), wsArtwork: [],
    _wsPreviewSaved: null, _wsPreviewPaper: null, _wsPreviewAdhoc: null,
    _wsRef: id => id, updateDoc: async (...args) => calls.writes.push(args),
    showToast: (...args) => calls.toasts.push(args), renderWsPreview() {},
    _wsSavedQuestions: () => [{ id: 'q1' }], _wsLockedQuestions: () => [],
    _wnyRunPrepare: async () => null, wnyPrintOn: () => false, akxPrintOn: () => false, objBoxPrintOn: () => false,
    doPrintStudentWorksheet: async (...args) => calls.print.push(args),
    cpbIsWorksheet: () => false, cpbEditCovers: async () => true,
    _cpbOutputOpts: () => ({ frontHtml: '<div>Edited A</div>', buildOpts: { paper: { pageHtmlById: { q1: 'Edited B' } } }, forcedBreakIds: new Set(['q1']) }),
    _ppCoverHtml: title => '<div>' + title + '</div>',
    escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    _cpbMetaGet: key => ({ org: 'Polymath', exam: 'Mock exam', subject: 'SCIENCE', year: '2026', level: 'P6', duration: '1 h 45 min', code: '', coverScale: 1, coverOpacity: .72 })[key],
    CPB_MCQ_MARKS: 2,
    console
  };
  vm.createContext(state);
  vm.runInContext([
    cut('let wsCoverSettings = null;', '// Blank Name / Date / Class lines print'),
    cut('function _wsStudentFieldsOn(where)', '// Worksheet title banner'),
    cut('async function reprintWorksheet(id)', '// The questions of a saved worksheet'),
    cut('async function generateSyllabusPdf()', '// WORKSHEET LIVE PREVIEW'),
    cut('function _cpbIndexGridHtml()', '// The paper keeps its index grid'),
    cut('// The ruled identity box both covers open with.', '// The line that opens each booklet')
  ].join('\n'), state);
  return { state, nodes, calls };
}

test('main science covers use the shared renderer and explicit science defaults', () => {
  const { state, calls } = harness();
  state._wsCoverHtml('Plants', undefined, undefined, false);
  assert.equal(calls.render[0].subject, 'science');
  assert.equal(calls.render[0].footer, 'Primary Science');
  assert.equal(calls.render[0].className, 'print-front-page print-cover-page');
  state._wsCoverHtml('Plants', '', '', true, { fields: true });
  assert.equal(calls.render[1].fields, false, 'the existing global fields switch remains authoritative');
  assert.doesNotMatch(cut('let wsCoverSettings = null;', '// Blank Name / Date / Class lines print'), /<svg|<text[^>]*>π/);
});

test('saved cover edits persist with the worksheet and carry into the actual print', async () => {
  const { state, calls, nodes } = harness();
  await state.reprintWorksheet('saved');
  assert.equal(calls.edit.length, 1);
  assert.equal(calls.writes[0][0], 'saved');
  assert.equal(calls.writes[0][1].cover.title, 'Edited cover');
  assert.equal(state.savedWorksheets[0].cover.title, 'Edited cover');
  assert.equal(nodes.mwIncludeFields.checked, false);
  assert.equal(calls.print.length, 1);
  assert.equal(calls.print[0][3], true, 'body student fields track the cover editor');
  assert.equal(calls.render.at(-1).title, 'Edited cover');
});

test('cancelling either worksheet cover editor stops export without changing its saved settings', async () => {
  const { state, calls } = harness();
  state.result = null;
  await state.printStudentWorksheet();
  await state.reprintWorksheet('saved');
  assert.equal(calls.print.length, 0);
  assert.equal(calls.writes.length, 0);
  assert.equal(state.savedWorksheets[0].cover, undefined);
});

test('worksheets without a cover keep the existing direct print flow', async () => {
  const { state, nodes, calls } = harness();
  nodes.wsIncludeCover.checked = false;
  await state.printStudentWorksheet();
  assert.equal(calls.edit.length, 0);
  assert.equal(calls.print[0][2], '');
});

test('cancelling a syllabus cover stops before AI classification or print progress', async () => {
  const { state, calls } = harness();
  state.result = null;
  state._printProgressShow = () => { throw new Error('classification must not begin after cancellation'); };
  await state.generateSyllabusPdf();
  assert.equal(calls.print.length, 0);
  assert.equal(calls.edit.length, 1);
});

test('Study Buddy prepares the edited cover and matching student field controls before photographing', async () => {
  const { state, calls } = harness();
  const ctx = { saved: true, savedId: 'saved', title: 'Saved', cover: true, noFields: false };
  assert.equal(await state._wsPrepareContextCover(ctx), true);
  assert.match(ctx.frontHtml, /Edited cover/);
  assert.equal(ctx.noFields, true);
  assert.equal(calls.render.at(-1).fields, false);
  const custom = { source: 'custompaper', cover: false };
  assert.equal(await state._wsPrepareContextCover(custom), true);
  assert.match(custom.frontHtml, /Edited A/);
  assert.equal(custom.buildOpts.paper.pageHtmlById.q1, 'Edited B');
});

test('late editor results cannot modify another signed-in account', async () => {
  const { state, calls } = harness();
  let finish;
  state.window.WorksheetCover.edit = () => new Promise(resolve => { finish = resolve; });
  const pending = state._wsEditCover('Saved', { where: 'saved', id: 'saved' });
  state.currentUser = { uid: 'another-owner' };
  finish(state.result);
  assert.equal(await pending, false);
  assert.equal(calls.writes.length, 0);
  assert.equal(state.savedWorksheets[0].cover, undefined);
});

test('past paper draft edits stay separate and clear on account changes', async () => {
  const { state } = harness();
  state.wsCoverResetForUser(state.currentUser);
  await state._wsEditCover('2017', { where: 'paper', id: '2017' });
  assert.equal(state._wsCoverSettingsFor('paper', '2017').title, 'Edited cover');
  assert.equal(state._wsCoverSettingsFor('paper', '2018').title, undefined);
  state.wsCoverResetForUser({ uid: 'next-user' });
  assert.equal(state._wsCoverSettingsFor('paper', '2017').title, undefined);
});

test('custom booklet covers keep their anchor, exam metadata and instructions while adding subject artwork', () => {
  const { state } = harness();
  const values = { subject: 'SCIENCE', org: 'Our Centre', coverInstructionsA: 'Keep & compare.\nDraw <carefully>.' };
  const a = state._cpbCoverA(12, 6, values);
  const b = state._cpbCoverB(8, 7, 10, '__lo__q7', values);
  assert.match(a, /data-subject="SCIENCE"/);
  assert.match(a, /Our Centre/);
  assert.match(a, /Keep &amp; compare/);
  assert.match(a, /Draw &lt;carefully&gt;/);
  assert.match(b, /data-front-before="__lo__q7" data-front-restart="1"/);
  assert.match(b, /Questions 7 to 10 are worth 8 marks/);
  assert.match(b, /cpb-cv-logo/);
});

test('all cover-bearing export doors await editing before their export work begins', () => {
  for (const [from, to] of [
    ['async function ppDoPrint(', '// Each of the three past-paper'],
    ['async function loPrint(', '// ---------- attach questions'],
    ['async function cpbPrint()', '\nfunction cpbPreview()'],
    ['async function tsendSend()', '\nfunction _wsPreviewCtx()']
  ]) {
    const source = cut(from, to);
    assert.match(source, /if \(!await (?:_wsEditCover|cpbEditCovers|_wsPrepareContextCover)\(/, from);
  }
  assert.match(html, /id="wsPreviewCoverBtn"/);
  const version = app.match(/const APP_VERSION = 'v([^']+)'/)[1];
  assert.ok(html.includes('worksheet-cover.js?v=' + version), 'cover runtime must use the shipped release version');
  assert.ok(app.includes('window.cpbEditCovers = cpbEditCovers;'));
});
