import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const shared = fs.readFileSync(new URL('worksheet-cover.js', root), 'utf8');
const science = fs.existsSync(new URL('app.js', root));
const src = fs.readFileSync(new URL(science ? 'app.js' : 'index.html', root), 'utf8');
function cut(from, to) {
  const start = src.indexOf(from), end = src.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, from);
  return src.slice(start, end);
}
function setup() {
  const context = vm.createContext({ URL });
  vm.runInContext(shared, context);
  return context;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('normalization keeps deliberate blanks, rejects arbitrary markup properties and caps text', () => {
  const { WorksheetCover: c } = setup();
  assert.deepEqual(plain(c.normalize({ subtitle: '', org: '', seed: Infinity, subject: 'javascript:', extraHtml: '<script>', title: 'X'.repeat(300) })),
    { title: 'X'.repeat(120), org: '', subtitle: '' });
  assert.equal(c.resolve({ subtitle: '' }).subtitle, '');
  assert.equal(c.resolve({ title: '' }).title, 'Worksheet');
});

test('science and maths use different pixel sprites, deterministic layouts and local logo', () => {
  const { WorksheetCover: c } = setup();
  const s = c.render({ subject: 'science' }), m = c.render({ subject: 'math' });
  assert.match(s, /data-icon="tube"/);
  assert.match(s, /data-icon="flask"/);
  assert.doesNotMatch(s, /data-icon="calculator"/);
  assert.match(m, /data-icon="calculator"/);
  assert.match(m, /data-icon="pi"/);
  assert.doesNotMatch(m, /data-icon="tube"/);
  assert.match(m, /shape-rendering="crispEdges"/);
  assert.match(s, /assets\/branding\/polymath-learning-centre.png/);
  assert.equal(s, c.render({ subject: 'science' }));
  assert.notEqual(s, c.render({ subject: 'science', seed: 1 }));
});

test('text is escaped and disabled student fields leave no personal details on the cover', () => {
  const { WorksheetCover: c } = setup();
  const s = c.render({ title: '<img onerror="bad()">', org: '<script>', name: 'Student detail', subtitle: '& test' }, { noFields: true });
  assert.match(s, /&lt;img onerror=&quot;bad/);
  assert.doesNotMatch(s, /<script>|Student detail/);
  assert.match(s, /&amp; test/);
});

if (science) {
  function scienceSetup() {
    const c = setup();
    let editor, writeError = false;
    const writes = [];
    const fields = { wsTitle: { value: 'Original' }, wsIncludeCover: { checked: true }, mwIncludeCover: { checked: true } };
    const sheet = { id: 's1', title: 'Saved original', questionIds: [], coverDesign: { subtitle: 'Saved subtitle' } };
    Object.assign(c, {
      window: { WorksheetCover: { ...c.WorksheetCover, open: (value, opts) => { editor = { value, opts }; } } },
      document: { getElementById: id => fields[id] || null },
      currentUser: { uid: 'owner' }, wsCoverDesign: { subtitle: 'Draft subtitle' },
      _wsPreviewSaved: null, _wsPreviewPaper: null, _wsPreviewAdhoc: null,
      savedWorksheets: [sheet], wsArtwork: [], questionBank: [], wsSelectedIds: new Set(),
      _wsSavedQuestions: () => [], _wsStudentFieldsOn: () => true,
      akxPrintOn: () => false, objBoxPrintOn: () => false, renderSavedWorksheets() {}, renderWsPreview() {}, showToast() {},
      _wsRef: id => ({ uid: c.currentUser.uid, id }),
      setDoc: async (ref, data) => { if (writeError) throw Error('Offline'); writes.push({ ref, data: plain(data) }); }
    });
    vm.runInContext(cut('function _wsCoverHtml(', '// Blank Name / Date / Class lines') +
      cut('function _wsPreviewCtx()', '\nfunction openWorksheetPreview()') +
      cut('async function _wsFrontHtml(', '\nasync function printStudentWorksheet()'), c);
    return { c, sheet, fields, writes, editor: () => editor, fail: () => { writeError = true; } };
  }
  test('Science draft edits update the generated cover and stay separate from saved covers', async () => {
    const { c, fields, editor, sheet } = scienceSetup();
    c.wsEditCover();
    await editor().opts.onSave(c.WorksheetCover.resolve({ title: 'Changed', subtitle: 'Heat & light', name: 'Ada' }));
    assert.equal(fields.wsTitle.value, 'Changed');
    assert.match(await c._wsFrontHtml([], 'Changed'), /Heat &amp; light/);
    c._wsPreviewSaved = { id: 's1' };
    assert.equal(c._wsPreviewCtx().coverDesign.subtitle, sheet.coverDesign.subtitle);
  });
  test('Science persists a saved cover, and a rejected write keeps the old cover', async () => {
    const fixture = scienceSetup(), { c, sheet, writes, editor } = fixture;
    c._wsPreviewSaved = { id: 's1' };
    c.wsEditCover();
    const next = c.WorksheetCover.resolve({ title: 'New title', subtitle: 'Energy', seed: 3 });
    await editor().opts.onSave(next);
    assert.equal(writes[0].ref.uid, 'owner');
    assert.equal(writes[0].data.coverDesign.seed, 3);
    assert.equal(sheet.title, 'New title');
    fixture.fail();
    await assert.rejects(editor().opts.onSave({ ...next, title: 'Failed title' }), /Offline/);
    assert.equal(sheet.title, 'New title');
  });
  test('Science blocks account changes and does not offer worksheet controls on exam or question previews', async () => {
    const { c, editor, writes } = scienceSetup();
    c.wsEditCover();
    c.currentUser = { uid: 'another' };
    await assert.rejects(editor().opts.onSave({ title: 'Bad' }), /account changed/);
    assert.equal(writes.length, 0);
    c._wsPreviewPaper = { title: 'Paper' };
    c._ppCoverHtml = () => '';
    assert.equal(c.wsEditCover(), undefined);
  });
} else {
  test('Math renderer preserves editable header fields, stored cover data and the worksheet QR', () => {
    const c = setup();
    Object.assign(c, {
      window: { WorksheetCover: c.WorksheetCover }, WS_HEADER_ORG: 'Polymath Learning Centre',
      escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    });
    vm.runInContext(cut('function wsHeadFieldHtml(', '// The footer that prints'), c);
    const html = c.wsCoverHtml('Fractions', '8 questions', false, '<svg data-test-qr></svg>', '', true,
      { title: 'Stale title', subtitle: '', name: 'Ada', seed: 2 });
    assert.match(html, /data-ws-edit="title"/);
    assert.match(html, /data-ws-edit="org"/);
    assert.match(html, /Fractions/);
    assert.doesNotMatch(html, /Stale title|8 questions/);
    assert.match(html, /data-test-qr/);
    assert.match(html, /Ada/);
  });
}
