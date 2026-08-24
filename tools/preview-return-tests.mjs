// Regression tests for GOING BACK TO THE PREVIEW YOU CAME FROM.
// Run with:
//     node tools/preview-return-tests.mjs            all cases
//     node tools/preview-return-tests.mjs <name>     one case
//
// It loads the REAL functions out of app.js — the snapshot, the reopener, the
// "← Back" label and the navigate-afterwards step — and runs them against
// stubs for the three previews and the pages behind them.
//
// Every failure here is silent: the app saves the question, the toast says so,
// and the teacher simply ends up somewhere they did not ask to be.
//
//  • A PSLE PAPER PREVIEW that does not come back is the whole bug this
//    fixes: the way back by hand is the Past Papers page, then the year or
//    the concept, then Preview — every single time one question is fixed,
//    which is how a wrong answer noticed on the sheet ends up unfixed.
//  • THE SNAPSHOT MUST BE TAKEN BEFORE THE OVERLAY CLOSES.
//    closeWorksheetPreview() clears both preview slots, so a snapshot taken
//    after it is always null and the return silently stops working — while
//    every other thing about the edit still behaves perfectly.
//  • A STALE SNAPSHOT is the same fault pointing the other way: an edit
//    started somewhere else must not bounce to whatever preview was last left
//    set, which would send somebody to a sheet they have never opened.
//  • THE WRONG SHEET. A paper and a saved worksheet are reopened completely
//    differently — one from the arguments it was previewed with, the other by
//    id — and both land on `papers`/`myworksheets`, so the DESTINATION cannot
//    decide it. Only the snapshot's kind can.
//  • THE LABEL. A paper preview returns to `papers`, which is also where the
//    Past Papers assign panel returns to. A button that promises the page and
//    delivers the preview (or the reverse) is a button nobody trusts twice.
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

// Everything the two regions reach that is not in them. The log is what the
// cases assert on: which page was navigated to, and which preview reopened.
const SHIM = `
const log = [];
let _editReturnPage = null;
let _wsQeReturn = null;
let _wsQeQid = null;
let _wsPreviewPaper = null;
let _wsPreviewSaved = null;
let wsSelectedIds = new Set();
let savedWorksheets = [];
let btn = { style: {}, innerHTML: '', title: '' };
const document = { getElementById: () => btn };
function navigateTo(p) { log.push({ nav: p }); }
function _vetFocusScroll() { log.push({ vetScroll: true }); }
function ppPreview(items, missing, title, opts) { log.push({ preview: 'paper', items, missing, title, opts }); }
function previewSavedWorksheet(id) { log.push({ preview: 'saved', id }); }
function openWorksheetPreview() { log.push({ preview: 'builder' }); }
function closeWsQuickEdit() { log.push({ closed: 'drawer' }); }
function closeWorksheetPreview() {
  log.push({ closed: 'preview' });
  _wsPreviewPaper = null; _wsPreviewSaved = null;   // exactly what the real one does
}
function editQuestion(id) {
  log.push({ edit: id });
  _editReturnPage = null;   // the real editQuestion resets both…
  _wsQeReturn = null;       // …and this is the guard against a stale snapshot
}
`;

const M = new Function(SHIM +
  cut('function _afterEditNavigate() {', '\n// The top-left "← Back to Past Papers"', 'navigate + back button') +
  cut('function _wsPreviewSnapshot() {', '\n// =====================================================================\n// ✏️ THE ANSWER KEY', 'snapshot + reopen') + `
return {
  log,
  snapshot: _wsPreviewSnapshot,
  openFull: wsQuickEditOpenFull,
  reopen: _wsQeReopenPreview,
  afterEdit: _afterEditNavigate,
  syncBtn: _syncBackToPapersBtn,
  btn,
  set(state) {
    _wsPreviewPaper = state.paper || null;
    _wsPreviewSaved = state.saved || null;
    wsSelectedIds = new Set(state.selected || []);
    savedWorksheets = state.sheets || [];
    _wsQeQid = state.qid || null;
    _wsQeReturn = 'ret' in state ? state.ret : null;
    _editReturnPage = 'dest' in state ? state.dest : null;
    log.length = 0;
  },
  ret() { return _wsQeReturn; },
  dest() { return _editReturnPage; }
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
};

const PAPER = { items: [{ id: 'p1' }, { id: 'p2' }], missing: [{ id: 'p3' }], title: 'PSLE Science 2019', coverTitle: 'PSLE 2019 Science Paper' };

// The reopen is deliberately deferred a beat, so the page behind it has
// rendered. Drain the timer rather than waiting on it.
const flush = () => new Promise(r => setTimeout(r, 90));

// ── the snapshot names the right preview ────────────────────────────────────

test('a PSLE paper preview snapshots as a paper, and lands on Past Papers', () => {
  M.set({ paper: PAPER });
  const s = M.snapshot();
  eq(s.kind, 'paper', 'kind');
  eq(s.page, 'papers', 'the page it returns to');
  eq(s.title, 'PSLE Science 2019', 'title carried');
  eq(s.coverTitle, 'PSLE 2019 Science Paper', 'cover title carried');
  eq(s.items.length, 2, 'the items it was previewed with');
  eq(s.missing.length, 1, 'and the ones it skipped, or Print loses them');
});

test('a saved worksheet snapshots by id', () => {
  M.set({ saved: { id: 'w7', title: 'Heat revision' } });
  const s = M.snapshot();
  eq(s.kind, 'saved', 'kind');
  eq(s.page, 'myworksheets', 'the page it returns to');
  eq(s.id, 'w7', 'the id it reopens from');
});

test("the builder's own preview snapshots as the builder", () => {
  M.set({ selected: ['q1', 'q2'] });
  const s = M.snapshot();
  eq(s.kind, 'builder', 'kind');
  eq(s.page, 'worksheet', 'the page it returns to');
});

test('nothing on screen, nothing to come back to', () => {
  M.set({});
  eq(M.snapshot(), null, 'no snapshot');
});

// ── the snapshot is taken BEFORE the overlay closes ─────────────────────────

test('opening the full editor from a paper preview keeps the way back', () => {
  M.set({ paper: PAPER, qid: 'bank9' });
  M.openFull();
  ok(M.ret(), 'a snapshot survived closeWorksheetPreview()');
  eq(M.ret().kind, 'paper', 'and it is the paper');
  eq(M.dest(), 'papers', 'the return page is set AFTER editQuestion cleared it');
  ok(M.log.some(e => e.edit === 'bank9'), 'the question was opened');
});

test('editQuestion clears a stale snapshot, so an unrelated edit stays put', () => {
  // Read out of app.js rather than stubbed, because this ONE line is the whole
  // guard: without it an edit started in the bank a week later would bounce to
  // whatever preview was last left set.
  const fn = src.slice(src.indexOf('function editQuestion(id) {'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  ok(/_wsQeReturn = null;/.test(body), 'editQuestion() clears _wsQeReturn');
  ok(body.indexOf('_wsQeReturn = null;') < body.indexOf('currentEditingQuestion = q.id'),
     'and clears it up front, where the other return state is cleared');

  // And the reopen spends it, so it can never fire a second time.
  M.set({ ret: { kind: 'builder', page: 'worksheet' }, selected: ['q1'] });
  M.reopen();
  eq(M.ret(), null, 'spent on use');
});

test('the full editor is opened only once a snapshot has been taken', () => {
  // closeWorksheetPreview() clears both preview slots, so a snapshot taken
  // after it is always null — and the return silently stops working while
  // everything else about the edit still behaves perfectly.
  const fn = src.slice(src.indexOf('function wsQuickEditOpenFull() {'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  ok(body.indexOf('const back = _wsPreviewSnapshot()') < body.indexOf('\n  closeWorksheetPreview();'),
     'the snapshot is taken BEFORE the overlay is closed');
  ok(body.indexOf('editQuestion(') < body.indexOf('_wsQeReturn = back'),
     'and stored AFTER editQuestion, which resets it');
});

// ── the reopen goes to the sheet it came from ───────────────────────────────

test('a paper reopens from its own arguments, quietly', async () => {
  M.set({ ret: { kind: 'paper', page: 'papers', items: PAPER.items, missing: PAPER.missing, title: PAPER.title, coverTitle: PAPER.coverTitle } });
  M.reopen();
  await flush();
  const e = M.log.find(x => x.preview === 'paper');
  ok(e, 'the paper preview reopened');
  eq(e.title, 'PSLE Science 2019', 'the same paper');
  eq(e.items.length, 2, 'the same questions');
  eq(e.opts.coverTitle, 'PSLE 2019 Science Paper', 'the same cover');
  ok(e.opts.quiet, 'quiet — the skipped-questions toast is news once, noise on every return');
  eq(M.ret(), null, 'the snapshot is spent, so it cannot fire twice');
});

test('a saved worksheet reopens by id — and never if it has since gone', async () => {
  M.set({ ret: { kind: 'saved', page: 'myworksheets', id: 'w7' }, sheets: [{ id: 'w7' }] });
  M.reopen(); await flush();
  ok(M.log.some(x => x.preview === 'saved' && x.id === 'w7'), 'reopened');
  M.set({ ret: { kind: 'saved', page: 'myworksheets', id: 'gone' }, sheets: [{ id: 'w7' }] });
  M.reopen(); await flush();
  ok(!M.log.some(x => x.preview), 'a deleted worksheet reopens nothing');
});

test('the builder reopens only while something is still ticked', async () => {
  M.set({ ret: { kind: 'builder', page: 'worksheet' }, selected: ['q1'] });
  M.reopen(); await flush();
  ok(M.log.some(x => x.preview === 'builder'), 'reopened');
  M.set({ ret: { kind: 'builder', page: 'worksheet' }, selected: [] });
  M.reopen(); await flush();
  ok(!M.log.some(x => x.preview), 'nothing selected, nothing to preview');
});

test('nothing stored reopens nothing at all', async () => {
  M.set({});
  M.reopen(); await flush();
  eq(M.log.length, 0, 'silent');
});

// ── after the edit: the page first, the preview on top of it ────────────────

test('saving a paper question lands on Past Papers and reopens the preview', async () => {
  M.set({ dest: 'papers', ret: { kind: 'paper', page: 'papers', items: PAPER.items, title: PAPER.title } });
  M.afterEdit();
  await flush();
  eq(M.log[0].nav, 'papers', 'the page behind the overlay is the one it belongs to');
  ok(M.log.some(x => x.preview === 'paper'), 'and the preview is back on top of it');
});

test('the Past Papers assign panel still just goes to the page', async () => {
  // Same destination, no snapshot — this is the OTHER thing that returns to
  // `papers`, and it has no preview to reopen.
  M.set({ dest: 'papers' });
  M.afterEdit();
  await flush();
  eq(M.log[0].nav, 'papers', 'navigated');
  ok(!M.log.some(x => x.preview), 'nothing reopened');
});

test('an ordinary bank edit returns to the bank and opens nothing', async () => {
  M.set({});
  M.afterEdit();
  await flush();
  eq(M.log[0].nav, 'bank', 'the default');
  ok(!M.log.some(x => x.preview), 'nothing reopened');
});

test('a vetting edit still restores the vetting view', async () => {
  M.set({ dest: 'vetting' });
  M.afterEdit();
  await flush();
  eq(M.log[0].nav, 'vetting', 'navigated');
  ok(M.log.some(x => x.vetScroll), 'and scrolled back to the card');
});

// ── the "← Back" button says which of the two ───────────────────────────────

test('the back button names the PREVIEW, not the page, for a paper', () => {
  M.set({ dest: 'papers', ret: { kind: 'paper', page: 'papers' } });
  M.syncBtn();
  ok(/paper preview/i.test(M.btn.innerHTML), 'names the preview: ' + M.btn.innerHTML);
  eq(M.btn.style.display, '', 'shown');
});

test('…and names the page when there is no preview behind it', () => {
  M.set({ dest: 'papers' });
  M.syncBtn();
  ok(/PSLE Papers/.test(M.btn.innerHTML), 'names the page: ' + M.btn.innerHTML);
});

test('a worksheet edit still says worksheet, and a plain bank edit hides it', () => {
  M.set({ dest: 'myworksheets', ret: { kind: 'saved', page: 'myworksheets', id: 'w7' } });
  M.syncBtn();
  ok(/worksheet/i.test(M.btn.innerHTML), 'names the worksheet: ' + M.btn.innerHTML);
  M.set({});
  M.syncBtn();
  eq(M.btn.style.display, 'none', 'hidden with nowhere to go back to');
});

// ── run ─────────────────────────────────────────────────────────────────────
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name.indexOf(only) < 0) continue;
  try { await c.fn(); pass++; console.log('  ✓ ' + c.name); }
  catch (e) { fail++; console.log('  ✗ ' + c.name + '\n      ' + e.message); }
}
console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ ' + pass + '/' + pass + ' checks passed');
process.exit(fail ? 1 : 0);
