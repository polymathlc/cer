import test from 'node:test';
import assert from 'node:assert/strict';
import { CC_ADMINS, normaliseQuest, computeStats } from '../cc/cc-core.mjs';
import { ARCADE_STORAGE_PREFIX, GAMES, ITEMS, WIN_REWARD, createArcadeStore, receiptFor, arcadeLedgerEntry } from '../cc/cc-arcade-core.mjs';

const start = Date.parse('2026-11-26T15:59:59Z'); // 23:59:59 Singapore time
const parent = CC_ADMINS[0];
class MemoryStorage {
  entries = new Map();
  get length() { return this.entries.size; }
  key(i) { return [...this.entries.keys()][i] ?? null; }
  getItem(k) { return this.entries.get(k) ?? null; }
  setItem(k, v) { this.entries.set(k, v); }
}
function makeQuest(id, caius = 'success', caris = 'open', extra = {}) {
  return normaliseQuest({
    kids: ['caius', 'caris'], title: id,
    results: { caius: { status: caius }, caris: { status: caris } }, ...extra
  }, id);
}

test('each assigned successful quest earns its child exactly one draw, including archived and older quests', () => {
  const store = createArcadeStore(new MemoryStorage());
  const archived = makeQuest('old', 'success', 'failed', { archived: true });
  const shared = makeQuest('shared', 'success', 'success');
  const open = makeQuest('future', 'open', 'open');
  const unassigned = makeQuest('one', 'success', 'success', { kids: ['caris'] });
  const quests = [archived, shared, open, shared, unassigned];
  assert.deepEqual(store.draws('caius', quests).map(d => d.questId), ['old', 'shared']);
  assert.deepEqual(store.draws('caris', quests).map(d => d.questId), ['shared', 'one']);
  assert.equal(store.reveal('caris', archived), null);
  assert.equal(store.reveal('caius', open), null);
  assert.deepEqual(store.draws('outsider', quests), []);
});

test('draw identity survives quest edits, undo then success, a tab reload and a second device', () => {
  const storage = new MemoryStorage();
  const first = createArcadeStore(storage);
  const secondTab = createArcadeStore(storage);
  const otherDevice = createArcadeStore(new MemoryStorage());
  const quest = makeQuest('school/test:1', 'success', 'success');
  const [unopened] = first.draws('caius', [quest]);
  assert.equal(unopened.revealed, false);
  const opened = first.reveal('caius', quest);
  assert.equal(opened.persisted, true);
  assert.equal(opened.revealed, true);
  assert.equal(first.reveal('caius', quest).item, opened.item);
  assert.equal(secondTab.draws('caius', [quest])[0].revealed, true);
  assert.equal(first.draws('caris', [quest])[0].revealed, false);
  const [elsewhere] = otherDevice.draws('caius', [quest]);
  assert.equal(elsewhere.item, opened.item);
  assert.equal(elsewhere.revealed, false);
  const undone = makeQuest(quest.id, 'open', 'success');
  assert.deepEqual(first.draws('caius', [undone]), []);
  const edited = makeQuest(quest.id, 'success', 'success', { title: 'Replacement title', archived: true, reward: 123 });
  assert.deepEqual(first.draws('caius', [edited])[0], { ...unopened, title: 'Replacement title', revealed: true });
});

test('catalogue gives all twelve generated items a reachable, stable probability', () => {
  assert.equal(new Set(ITEMS.map(item => item.id)).size, 12);
  assert.deepEqual([...new Set(ITEMS.map(item => item.rarity))], ['Common', 'Rare', 'Epic', 'Legendary']);
  assert.equal(ITEMS.reduce((sum, item) => sum + item.weight, 0), 100);
  for (const item of ITEMS) {
    assert.equal(item.image, './assets/relics/' + item.id + '.webp');
    assert.ok(item.name && item.description && Number.isInteger(item.weight) && item.weight > 0);
  }
  const store = createArcadeStore(new MemoryStorage());
  const generated = store.draws('caris', Array.from({ length: 1800 }, (_, i) => makeQuest('q' + i, 'open', 'success')));
  assert.equal(new Set(generated.map(draw => draw.item.id)).size, ITEMS.length);
  // Changing this edition's draw algorithm would replace previously earned collectibles.
  assert.deepEqual(generated.slice(0, 5).map(draw => draw.item.id), ['cloud-boots', 'fox-fan', 'kitsune-mask', 'smoke-vial', 'smoke-vial']);
});

test('one win per game, child and Singapore day, including repeated calls, shared tabs and another device', () => {
  let time = start;
  const storage = new MemoryStorage();
  const tab = createArcadeStore(storage, () => time);
  const other = createArcadeStore(storage, () => time);
  const isolated = createArcadeStore(new MemoryStorage(), () => time);
  const win = tab.recordWin('caius', 'dash');
  assert.equal(win.newWin, true);
  assert.equal(win.persisted, true);
  assert.equal(win.receipt.day, '2026-11-26');
  assert.equal(other.recordWin('caius', 'dash').newWin, false);
  assert.equal(tab.won('caius', 'dash'), true);
  assert.equal(tab.won('caris', 'dash'), false);
  assert.equal(other.recordWin('caris', 'dash').newWin, true);
  assert.equal(other.recordWin('caius', 'signals').newWin, true);
  assert.equal(other.recordWin('caius', 'rush').newWin, true);
  assert.equal(tab.pending('caius').length, 3);
  assert.deepEqual(isolated.recordWin('caius', 'dash').receipt, win.receipt);
  assert.equal(isolated.recordWin('caius', 'dash', [win.receipt]).newWin, false);
  assert.equal(tab.pending('caius', [win.receipt]).length, 2);
  assert.equal(other.pending('caris', [win.receipt]).length, 1);
  time += 1000;
  assert.equal(tab.won('caius', 'dash'), false);
  const next = other.recordWin('caius', 'dash');
  assert.equal(next.newWin, true);
  assert.equal(next.receipt.day, '2026-11-27');
  assert.equal(tab.pending('caius').length, 4);
  assert.equal(tab.won('caius', 'dash', [], '2026-11-26'), true);
});

test('receipts require a real past or present day and a known player/game, and ignore malformed storage', () => {
  assert.deepEqual(GAMES.map(game => game.id), ['dash', 'signals', 'rush']);
  const good = receiptFor('caius', 'signals', '2024-02-29', start);
  assert.ok(good);
  for (const day of ['2026-11-27', '2026-02-29', '2026-04-31', '2026-13-30', 'x', 123, undefined]) {
    assert.equal(receiptFor('caius', 'signals', day, start), null);
  }
  assert.equal(receiptFor('Caius', 'signals', '2026-11-26', start), null);
  assert.equal(receiptFor('caius', 'spin', '2026-11-26', start), null);
  const storage = new MemoryStorage();
  const prefix = ARCADE_STORAGE_PREFIX + 'win:caius:';
  storage.setItem(prefix + 'signals:2026-11-26:fake', '1');
  storage.setItem(prefix + 'spin:2026-11-26', '1');
  storage.setItem(prefix + 'rush:2026-11-26', 'invalid');
  storage.setItem(prefix + 'rush:2026-12-01', '1');
  const store = createArcadeStore(storage, () => start);
  assert.deepEqual(store.pending('caius'), []);
  assert.deepEqual(store.recordWin('outsider', 'signals'), { receipt: null, newWin: false, persisted: false });
});

test('Dad can approve an old win for the fixed bonus, despite tampered amount, note or type', () => {
  const receipt = receiptFor('caris', 'signals', '2026-11-24', start);
  assert.equal(arcadeLedgerEntry(receipt, 'outsider@example.com', start), null);
  assert.equal(arcadeLedgerEntry({ ...receipt, id: 'other' }, parent, start), null);
  assert.equal(arcadeLedgerEntry({ ...receipt, kid: 'caius' }, parent, start), null);
  assert.equal(arcadeLedgerEntry({ ...receipt, day: '2026-11-25' }, parent, start), null);
  const entry = arcadeLedgerEntry({ ...receipt, amount: 999, type: 'redeem', note: 'fake' }, parent, start);
  assert.deepEqual(entry, { kid: 'caris', type: 'bonus', amount: 5, note: 'Smoke Signals win · 2026-11-24', at: start, by: parent });
  assert.equal(computeStats([], [entry]).caris.balance, WIN_REWARD);
});

test('denied device storage keeps the win and reveal in memory and reports that they are temporary', () => {
  const denied = { setItem() { throw new Error('quota'); }, getItem() { throw new Error('blocked'); }, get length() { throw new Error('blocked'); } };
  for (const storage of [denied, null]) {
    const store = createArcadeStore(storage, () => start);
    const quest = makeQuest('quest');
    const win = store.recordWin('caius', 'rush');
    assert.equal(win.newWin, true);
    assert.equal(win.persisted, false);
    assert.equal(store.recordWin('caius', 'rush').newWin, false);
    assert.deepEqual(store.pending('caius'), [win.receipt]);
    assert.equal(store.reveal('caius', quest).persisted, false);
    assert.equal(store.draws('caius', [quest])[0].revealed, true);
    assert.equal(store.won('caius', 'rush', [win.receipt]), true);
  }
});
