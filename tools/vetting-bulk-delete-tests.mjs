// Regression tests for DELETING SEVERAL VETTING QUESTIONS AT ONCE.
// Run with:
//     node tools/vetting-bulk-delete-tests.mjs            all cases
//     node tools/vetting-bulk-delete-tests.mjs <name>     one case
//
// It loads the REAL bulk-delete block out of app.js and runs it against a
// shimmed page. This is the most destructive button in the app — one press
// can clear the whole vetting list — and every way it can go wrong is silent:
//
//  • "DELETE ALL" MUST MEAN WHAT IS ON SCREEN. The search box narrows the
//    list, so the visible set and `vettingList` are not the same thing.
//    Delete-all reading `vettingList` destroys questions the author had
//    filtered away and never saw — nothing errors, nothing on screen says a
//    thing, and they are only missed weeks later.
//  • A QUESTION MUST LEAVE THE LIST ONLY ONCE ITS DOCUMENT REALLY WENT. Drop
//    it from `vettingList` on a failed delete and the page looks perfectly
//    tidy while the database still holds it — it is back at the next sign-in,
//    which reads as the delete button not working.
//  • THE TICKS MUST BE PRUNED. A question approved into the bank while ticked
//    is no longer a thing to delete, and a stale id in the selection is how
//    "3 selected" outlives the cards it counted.
//  • THE CONFIRM MUST SAY WHICH SET IT IS DELETING. The whole list and the
//    filtered view are one button, so the sentence is the only thing telling
//    the author which of the two they are about to lose.
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

// The page these tests run against. Everything the real block reaches out to
// is here and nothing else, so a change to the block is the only thing that
// can move a result.
const FIXTURE = `
let vettingList = [];
let _rapidJustAdded = new Set();
let searchBoxValue = '';
let renders = 0, counts = 0;
const toasts = [];
const confirms = [];
// Whichever ids this holds refuse to delete — the "Firestore said no" case.
let refuse = new Set();
const deleted = [];

const document = {
  getElementById(id) {
    if (id === 'vettingSearch') return { value: searchBoxValue };
    return null;                       // no bulk bar: the tests read state, not html
  }
};
function parseSearchTokens(s) {
  return String(s || '').toLowerCase().split(/\\s+/).filter(Boolean);
}
function extractQuestionSearchText(q) {
  return String((q && q.title) || '').toLowerCase();
}
function _vetAddedAt(q) { return (q && q.addedAt) || ''; }
async function deleteVettingDocAwait(id) {
  if (refuse.has(id)) return false;
  deleted.push(id);
  return true;
}
function renderVettingList() { renders++; }
function updateCounts() { counts++; }
function showToast(msg, kind) { toasts.push({ msg, kind }); }
// Auto-confirms, so a case can assert on the sentence AND on what it did.
function showConfirm(title, message, onConfirm) {
  confirms.push({ title, message });
  onConfirm();
}
`;

const block = cut(
  '// Ticked ids. Deliberately not a flag on the question objects',
  '\n// =====================================================================\n// AI AUTO-VET',
  'bulk delete block'
);

const mk = () => new Function(FIXTURE + block + `
return {
  state: () => ({ vettingList, deleted, toasts, confirms, renders, counts,
                  selected: Array.from(_vetSelected), busy: _vetBulkBusy }),
  seed(list, search) { vettingList = list; searchBoxValue = search || ''; },
  refuse(ids) { refuse = new Set(ids); },
  visible: () => _vetVisibleQuestions(),
  prune: _vetPruneSelection,
  pick: id => _vetSelected.add(id),
  selToggle: vetSelToggle, selAll: vetSelAllVisible, selClear: vetSelClear,
  deleteMany: _vetDeleteMany,
  deleteSelected: vetDeleteSelected,
  deleteAll: vetDeleteAllVisible,
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};
const q = (id, title, addedAt) => ({ id, title: title || id, addedAt: addedAt || '' });
// The two buttons fire the batch from inside the confirm callback and do not
// await it — the real confirm dialog's onclick is synchronous. So a test that
// presses a button has to let the batch finish before it looks.
const settle = () => new Promise(r => setTimeout(r, 0));
const ids = list => list.map(x => x.id);

// A tick or two apart, so "newest first" has something to sort on.
const seedThree = M => M.seed([
  q('a', 'alpha photosynthesis', '2026-01-01T00:00:00Z'),
  q('b', 'bravo magnets',        '2026-01-02T00:00:00Z'),
  q('c', 'charlie magnets',      '2026-01-03T00:00:00Z'),
]);

// ── what "all of them" means ────────────────────────────────────────────────

test('the visible set is the whole list when nothing is searched for', () => {
  const M = mk(); seedThree(M);
  eq(ids(M.visible()).sort(), ['a', 'b', 'c'], 'the visible set');
});

test('the visible set is NEWEST FIRST — the order the cards are in', () => {
  const M = mk(); seedThree(M);
  eq(ids(M.visible()), ['c', 'b', 'a'], 'the visible order');
});

test('the search box narrows the visible set', () => {
  const M = mk(); seedThree(M);
  M.seed(M.state().vettingList, 'magnets');
  eq(ids(M.visible()).sort(), ['b', 'c'], 'a search did not narrow the list');
});

test('DELETE ALL deletes only what the search is showing', async () => {
  // The headline case. Reading `vettingList` here instead of the visible set
  // destroys the question the author had filtered away and never saw.
  const M = mk(); seedThree(M);
  M.seed(M.state().vettingList, 'magnets');
  M.deleteAll(); await settle();
  eq(M.state().deleted.sort(), ['b', 'c'], 'delete all reached past the filter');
  eq(ids(M.state().vettingList), ['a'], 'the filtered-away question did not survive');
});

test('the confirm SAYS a filter is on, and how many are being spared', () => {
  const M = mk(); seedThree(M);
  M.seed(M.state().vettingList, 'magnets');
  M.deleteAll();
  const msg = M.state().confirms[0].message;
  ok(/\b2\b/.test(msg), 'the confirm does not say how many go: ' + msg);
  ok(/other 1/.test(msg), 'the confirm does not say how many stay: ' + msg);
});

test('with no filter on, the confirm does not invent one', () => {
  const M = mk(); seedThree(M);
  M.deleteAll();
  const msg = M.state().confirms[0].message;
  ok(!/other/.test(msg), 'the confirm mentions questions being spared when none are: ' + msg);
  ok(/\b3\b/.test(msg), 'the confirm does not say how many go: ' + msg);
});

test('delete all on an empty list confirms nothing and deletes nothing', () => {
  const M = mk(); M.seed([]);
  M.deleteAll();
  eq(M.state().confirms.length, 0, 'an empty list still opened a confirm');
  eq(M.state().deleted, [], 'an empty list deleted something');
});

// ── a question leaves the list only once its document went ──────────────────

test('a delete Firestore REFUSED leaves the question in the list', () => {
  const M = mk(); seedThree(M);
  M.refuse(['b']);
  return M.deleteMany(['a', 'b', 'c']).then(() => {
    eq(M.state().deleted.sort(), ['a', 'c'], 'the deletes that went through');
    eq(ids(M.state().vettingList), ['b'], 'a question the database still holds was dropped from the list');
    ok(M.state().toasts.some(t => t.kind === 'error'), 'a refused delete was reported as a success');
  });
});

test('a batch that fails ENTIRELY changes nothing and says so', () => {
  const M = mk(); seedThree(M);
  M.refuse(['a', 'b', 'c']);
  return M.deleteMany(['a', 'b', 'c']).then(() => {
    eq(ids(M.state().vettingList).sort(), ['a', 'b', 'c'], 'the list');
    ok(!M.state().toasts.some(t => t.kind === 'success'), 'a batch that deleted nothing claimed success');
  });
});

test('the busy flag is cleared even when every delete fails', async () => {
  const M = mk(); seedThree(M);
  M.refuse(['a', 'b', 'c']);
  await M.deleteMany(['a', 'b', 'c']);
  eq(M.state().busy, null, 'the page was left stuck on "Deleting…"');
});

// ── the selection ───────────────────────────────────────────────────────────

test('DELETE SELECTED deletes exactly the ticked questions', async () => {
  const M = mk(); seedThree(M);
  M.selToggle('a', true); M.selToggle('c', true);
  M.deleteSelected(); await settle();
  eq(M.state().deleted.sort(), ['a', 'c'], 'the deleted set');
  eq(ids(M.state().vettingList), ['b'], 'an unticked question was deleted');
});

test('DELETE SELECTED with nothing ticked deletes nothing', () => {
  const M = mk(); seedThree(M);
  M.deleteSelected();
  eq(M.state().confirms.length, 0, 'an empty selection opened a confirm');
  eq(M.state().deleted, [], 'an empty selection deleted something');
});

test('a tick on a question the filter hides is NOT deleted by Delete selected', async () => {
  // Ticked, then searched away. The button says "delete selected", and the
  // author can only see one of them — so only what is on screen may go.
  const M = mk(); seedThree(M);
  M.selToggle('a', true); M.selToggle('c', true);
  M.seed(M.state().vettingList, 'magnets');
  M.deleteSelected(); await settle();
  eq(M.state().deleted, ['c'], 'delete selected reached past the filter');
});

test('SELECT ALL ticks the visible set, and only that', () => {
  const M = mk(); seedThree(M);
  M.seed(M.state().vettingList, 'magnets');
  M.selAll(true);
  eq(M.state().selected.sort(), ['b', 'c'], 'select all ticked a hidden question');
  M.selAll(false);
  eq(M.state().selected, [], 'unticking select all left ticks behind');
});

test('Clear drops every tick', () => {
  const M = mk(); seedThree(M);
  M.selAll(true);
  M.selClear();
  eq(M.state().selected, [], 'the selection survived Clear');
});

test('a tick on a question that has LEFT the list is pruned', () => {
  // Approved into the bank, edited away, auto-vetted — every route ends here.
  // A stale id is how "3 selected" outlives the cards it counted.
  const M = mk(); seedThree(M);
  M.selAll(true);
  M.seed([q('a'), q('b')]);
  M.prune();
  eq(M.state().selected.sort(), ['a', 'b'], 'a tick outlived its question');
});

test('a deleted question is dropped from the selection too', async () => {
  const M = mk(); seedThree(M);
  M.selAll(true);
  await M.deleteMany(['a']);
  ok(!M.state().selected.includes('a'), 'a deleted question stayed ticked');
});

// ── guards ──────────────────────────────────────────────────────────────────

test('a second press while a batch is running is ignored', async () => {
  const M = mk(); seedThree(M);
  const first = M.deleteMany(['a', 'b']);
  await M.deleteMany(['c']);          // fired mid-batch
  await first;
  ok(!M.state().deleted.includes('c'), 'a second batch ran on top of the first');
});

test('the list and the counts are redrawn when a batch ends', async () => {
  const M = mk(); seedThree(M);
  await M.deleteMany(['a']);
  ok(M.state().renders > 0, 'the list was never redrawn');
  ok(M.state().counts > 0, 'the sidebar count was never refreshed');
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
