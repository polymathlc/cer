import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createGrandLineEconomy, createGrandLineRpgCommit, createGrandLineRpgSaveGate } from '../grand-line-economy.js';
import { CHARACTERS, CHARACTER_BY_ID, RETIRED_CHARACTER_REPLACEMENTS, STARTER_IDS, createCollection } from '../grand-line-core.js';

const root = new URL('../', import.meta.url), science = fs.existsSync(new URL('app.js', root));
const app = fs.readFileSync(new URL(science ? 'app.js' : 'index.html', root), 'utf8');
const packs = JSON.parse(JSON.stringify(vm.runInNewContext(app.match(/const TCG_PACKS = (\[[\s\S]*?\n\]);/)[1])));
function fixture(extra = {}) {
  let state = { gold: 2000, inventory: { existing: 2 } }, uid = 'fixture-account', profile = 'p-child-a';
  const writes = []; let failure = false;
  const ctx = { profileKey: profile, identity: 'account:child:P6', admin: false, level: 'P6' };
  const env = { getUser: () => ({ uid, role: 'student' }), getState: () => state, setState: value => { state = value; },
    isCurrent: c => uid === 'fixture-account' && profile === c.profileKey, getPacks: () => packs, random: () => 0,
    writeState: async (next, owner) => { if (failure) throw new Error('storage failed'); writes.push({ state: structuredClone(next), owner }); }, ...extra };
  env.commit = createGrandLineRpgCommit(env);
  const economy = createGrandLineEconomy(env);
  return { economy, env, ctx, writes, state: () => state, fail: value => { failure = value; },
    setProfile: value => { profile = value; }, setUid: value => { uid = value; }, setState: value => { state = value; } };
}
const totalCopies = c => Object.values(c.cards).reduce((sum, card) => sum + card.copies, 0);
test('offers use the actual portal Bronze 120, Silver 320 and Gold 750 rates and guarantee odds', () => {
  const f = fixture(), initial = f.economy.getSnapshot(f.ctx);
  assert.deepEqual(initial.wallet.offers.map(p => p.cost), [120, 320, 750]);
  assert.deepEqual(initial.wallet.offers.map(p => Object.keys(p.odds)[0]), ['1', '3', '4']);
  assert.deepEqual(initial.collection.team, STARTER_IDS); assert.equal(initial.collection.packs, 0);
  assert.equal(initial.wallet.balance, 2000); assert.equal(f.writes.length, 0, 'reading never spends points');
  assert.ok(!JSON.stringify(initial).includes('purchases'));
});
test('each tier debits its existing price and grants exactly one character in the same durable document', async () => {
  for (const [i, packId] of ['spark', 'nova', 'galaxy'].entries()) {
    const f = fixture(), before = f.economy.getSnapshot(f.ctx);
    const result = await f.economy.buyPack({ packId, purchaseId: 'purchase-1' }, f.ctx);
    assert.equal(result.wallet.balance, 2000 - [120, 320, 750][i]);
    assert.equal(result.grant.stars, [1, 3, 4][i]); assert.equal(totalCopies(result.collection), totalCopies(before.collection) + 1);
    assert.equal(result.collection.stats.packsOpened, 1); assert.equal(f.writes.length, 1);
    const saved = f.writes[0].state; assert.equal(saved.gold, result.wallet.balance);
    assert.equal(saved.grandLine.profiles[f.ctx.profileKey].collection.cards[result.grant.characterId].copies, result.grant.copies);
    assert.deepEqual(saved.inventory, { existing: 2 }); assert.equal(saved.grandLine.profiles[f.ctx.profileKey].purchases['purchase-1'].cost, [120, 320, 750][i]);
  }
});
test('each pack can reach a seven-star apex and duplicates strengthen the same owned character', async () => {
  const f = fixture({ random: () => 0.9999999999 });
  const first = await f.economy.buyPack({ packId: 'spark', purchaseId: 'one' }, f.ctx);
  const second = await f.economy.buyPack({ packId: 'spark', purchaseId: 'two' }, f.ctx);
  assert.equal(first.grant.stars, 7); assert.equal(second.grant.characterId, first.grant.characterId);
  assert.equal(second.grant.copies, first.grant.copies + 1); assert.equal(second.grant.duplicate, true);
});
test('durable purchase IDs make retries and reopened sessions idempotent', async () => {
  const f = fixture(), request = { packId: 'spark', purchaseId: 'persisted-id' };
  const first = await f.economy.buyPack(request, f.ctx);
  f.setState(structuredClone(f.writes[0].state)); const reopened = createGrandLineEconomy(f.env);
  const again = await reopened.buyPack(request, f.ctx);
  assert.equal(f.writes.length, 1); assert.equal(again.replayed, true); assert.deepEqual(again.grant, first.grant);
  assert.equal(again.wallet.balance, first.wallet.balance);
  await assert.rejects(reopened.buyPack({ ...request, packId: 'nova' }, f.ctx), /another pack/);
});

test('every retired paid receipt replays its replacement without charges, grants or writes', async () => {
  for (const [oldId, newId] of Object.entries(RETIRED_CHARACTER_REPLACEMENTS)) {
    const f = fixture(), c = createCollection();
    c.version = 1; c.cards[oldId] = { copies: 4 }; c.cards[newId] = { copies: 2 };
    c.team = [oldId, ...STARTER_IDS.slice(1)]; c.stats.packsOpened = 9;
    const receipt = { packId: 'galaxy', cost: 750, at: '2026-09-14T12:00:00.000Z',
      grant: { characterId: oldId, copies: 4, duplicate: true, stars: 6 } };
    f.state().grandLine = { version: 1, profiles: { [f.ctx.profileKey]: { collection: c, purchases: { 'legacy-paid': receipt } } } };
    f.state().gold = 19; // Replay works even when another purchase is unaffordable.
    const original = structuredClone(f.state()), request = { purchaseId: 'legacy-paid', packId: 'galaxy' };
    const first = await f.economy.buyPack(request, f.ctx);
    assert.equal(first.replayed, true); assert.equal(first.wallet.balance, 19);
    assert.deepEqual(first.grant, { characterId: newId, copies: 6, duplicate: true, stars: CHARACTER_BY_ID[newId].stars });
    assert.equal(first.collection.cards[oldId], undefined); assert.equal(first.collection.cards[newId].copies, 6);
    assert.deepEqual(first.collection.team, [newId, ...STARTER_IDS.slice(1)]);
    assert.equal(first.collection.stats.packsOpened, 9); assert.equal(first.collection.packs, 0);
    assert.equal(f.writes.length, 0); assert.deepEqual(f.state(), original);
    const reopened = createGrandLineEconomy(f.env), again = await reopened.buyPack(request, f.ctx);
    assert.deepEqual(again, first); assert.equal(f.writes.length, 0);
    await assert.rejects(reopened.buyPack({ ...request, packId: 'spark' }, f.ctx), /another pack/);
    const saved = await reopened.saveCollection({ team: first.collection.team }, f.ctx);
    assert.equal(f.writes.length, 1); assert.equal(saved.wallet.balance, 19);
    assert.deepEqual(f.state().grandLine.profiles[f.ctx.profileKey].purchases['legacy-paid'], receipt);
    f.setState(structuredClone(f.writes[0].state));
    const persisted = await createGrandLineEconomy(f.env).buyPack(request, f.ctx);
    assert.deepEqual(persisted, first); assert.equal(f.writes.length, 1);
  }
});

test('a failed migration save keeps the paid receipt and retries without another grant', async () => {
  const f = fixture(), c = createCollection(); c.version = 1; c.cards.shanks = { copies: 3 };
  c.team = ['shanks', ...STARTER_IDS.slice(1)];
  f.state().grandLine = { version: 1, profiles: { [f.ctx.profileKey]: { collection: c,
    purchases: { old: { packId: 'spark', cost: 120, grant: { characterId: 'shanks', copies: 3, stars: 6, duplicate: true } } } } } };
  const snapshot = f.economy.getSnapshot(f.ctx); f.fail(true);
  await assert.rejects(f.economy.saveCollection({ team: snapshot.collection.team }, f.ctx), /could not be saved/);
  assert.equal(f.state().grandLine.profiles[f.ctx.profileKey].collection.cards.shanks.copies, 3);
  f.fail(false); const result = await f.economy.buyPack({ packId: 'spark', purchaseId: 'old' }, f.ctx);
  assert.equal(result.replayed, true); assert.equal(result.wallet.balance, 2000);
  assert.equal(result.collection.cards.wyper.copies, 3); assert.equal(f.writes.length, 0);
});
test('a failed durable save restores the wallet and collection and never reports a grant', async () => {
  const f = fixture(), initial = f.economy.getSnapshot(f.ctx); f.fail(true);
  await assert.rejects(f.economy.buyPack({ packId: 'galaxy', purchaseId: 'retry-safe' }, f.ctx), /could not be saved/);
  assert.deepEqual(f.economy.getSnapshot(f.ctx), initial); assert.equal(f.writes.length, 0);
  f.fail(false); const result = await f.economy.buyPack({ packId: 'galaxy', purchaseId: 'retry-safe' }, f.ctx);
  assert.equal(result.wallet.balance, 1250); assert.equal(f.writes.length, 1);
});
test('pending saves cannot expose provisional grants or allow another debit', async () => {
  let finish; const f = fixture({ writeState: () => new Promise(resolve => { finish = resolve; }) });
  const running = f.economy.buyPack({ packId: 'spark', purchaseId: 'held' }, f.ctx);
  assert.throws(() => f.economy.getSnapshot(f.ctx), /still saving/);
  await assert.rejects(f.economy.buyPack({ packId: 'spark', purchaseId: 'held' }, f.ctx), /still saving/);
  await assert.rejects(f.economy.saveCollection({ team: STARTER_IDS }, f.ctx), /still saving/);
  finish(); const result = await running; assert.equal(result.wallet.balance, 1880); assert.equal(result.collection.stats.packsOpened, 1);
});
test('failure rollback preserves unrelated points earned while saving', async () => {
  let fail; const f = fixture({ writeState: () => new Promise((_, reject) => { fail = reject; }) });
  const running = f.economy.buyPack({ packId: 'spark', purchaseId: 'held' }, f.ctx);
  f.state().gold += 15; fail(new Error('offline')); await assert.rejects(running);
  assert.equal(f.state().gold, 2015); assert.equal(f.state().grandLine, undefined);
});
test('profile and account changes suppress replies; completed writes remain with the captured account', async () => {
  let finish, writtenOwner; const f = fixture({ writeState: (_, owner) => { writtenOwner = owner; return new Promise(resolve => { finish = resolve; }); } });
  const running = f.economy.buyPack({ packId: 'spark', purchaseId: 'held' }, f.ctx);
  f.setUid('another-account'); finish(); await assert.rejects(running, /profile changed/); assert.equal(writtenOwner, 'fixture-account');
  await assert.rejects(f.economy.buyPack({ packId: 'spark', purchaseId: 'new' }, f.ctx), /profile changed/);
});
test('profiles have separate collections while sharing only their existing account wallet', async () => {
  const f = fixture(); await f.economy.buyPack({ packId: 'spark', purchaseId: 'one' }, f.ctx);
  f.setProfile('p-child-b'); const sibling = { ...f.ctx, profileKey: 'p-child-b' };
  const snapshot = f.economy.getSnapshot(sibling); assert.equal(snapshot.collection.stats.packsOpened, 0); assert.equal(snapshot.wallet.balance, 1880);
  await f.economy.buyPack({ packId: 'spark', purchaseId: 'one' }, sibling);
  assert.equal(Object.keys(f.state().grandLine.profiles).length, 2);
});
test('ten owned crew members save and reload without granting cards or changing the wallet', async () => {
  const f = fixture(), snapshot = f.economy.getSnapshot(f.ctx), team = CHARACTERS.slice(0, 10).map(c => c.id);
  for (const id of team) snapshot.collection.cards[id] = { copies: 1 };
  f.state().grandLine = { profiles: { [f.ctx.profileKey]: { collection: snapshot.collection } } };
  const result = await f.economy.saveCollection({ team }, f.ctx);
  assert.deepEqual(result.collection.team, team);
  assert.deepEqual(f.economy.getSnapshot(f.ctx).collection.team, team);
  assert.equal(result.wallet.balance, 2000);
  const before = JSON.stringify(f.state());
  await assert.rejects(f.economy.saveCollection({ team: [...team, CHARACTERS[10].id] }, f.ctx), /ten/);
  await assert.rejects(f.economy.saveCollection({ team: [...team.slice(0, 9), team[0]] }, f.ctx), /ten/);
  assert.equal(JSON.stringify(f.state()), before);
});

test('insufficient funds and client-selected cards, costs or ownership cannot alter the wallet', async () => {
  const f = fixture(); f.state().gold = 119;
  await assert.rejects(f.economy.buyPack({ packId: 'spark', purchaseId: 'one', cost: 0, characterId: 'kaido' }, f.ctx), /120/);
  await assert.rejects(f.economy.buyPack({ packId: 'free', purchaseId: 'one' }, f.ctx), /unavailable/);
  await assert.rejects(f.economy.saveCollection({ team: ['kaido', ...STARTER_IDS.slice(1)] }, f.ctx), /own/);
  const before = f.economy.getSnapshot(f.ctx);
  const result = await f.economy.saveCollection({ team: [...STARTER_IDS].reverse(), cards: Object.fromEntries(CHARACTERS.map(c => [c.id, { copies: 999 }])), gold: 999999,
    progress: { unlockedEncounter: 1000, completed: [1, 1, -1, '2', 900], stats: { victories: 1, packsOpened: 999, correctAnswers: 3 }, cards: { kaido: { copies: 10 } } } }, f.ctx);
  assert.equal(result.wallet.balance, 119); assert.deepEqual(result.collection.cards, before.collection.cards); assert.equal(result.collection.stats.packsOpened, 0);
  assert.equal(result.collection.unlockedEncounter, 9); assert.deepEqual(result.collection.completed, [1]); assert.equal(result.collection.stats.correctAnswers, 3);
});
function concurrentSaveFixture() {
  let cloud = null, settle, hold = true, profile = 'p-fixture'; const ordinaryWrites = [];
  const context = vm.createContext({ currentUser: { uid: 'fixture-account' }, rpgState: { gold: 1000 },
    RPG_STORAGE_MODE: 'firestore', db: {}, doc: (...parts) => parts, rpgRenderSide() {}, rpgWriteLocal() {}, console,
    setDoc: async (ref, state) => { const accepted = { ref, state: structuredClone(state) }; ordinaryWrites.push(accepted); cloud = accepted.state; } });
  const saveGate = createGrandLineRpgSaveGate({ getUser: () => context.currentUser, flush: () => context.rpgSave() });
  context.grandLineRpgSaveGate = saveGate;
  const start = app.indexOf('function rpgSave() {'), end = app.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start); vm.runInContext(app.slice(start, end + 2), context);
  const env = { getUser: () => context.currentUser, getState: () => context.rpgState, setState: s => { context.rpgState = s; },
    isCurrent: ctx => context.currentUser?.uid === 'fixture-account' && ctx.profileKey === profile, getPacks: () => packs, random: () => 0, saveGate,
    writeState: async next => { const snapshot = structuredClone(next); if (hold) await new Promise((resolve, reject) => { settle = { resolve, reject }; }); cloud = snapshot; } };
  const economy = createGrandLineEconomy({ ...env, commit: createGrandLineRpgCommit(env) });
  return { context, economy, ordinaryWrites, cloud: () => cloud, settle: () => settle, noHold: () => { hold = false; },
    switchProfile: value => { profile = value; }, ctx: { profileKey: 'p-fixture' } };
}
test('actual ordinary RPG save defers provisional receipts, then flushes rollback and safely retries the same purchase', async () => {
  const f = concurrentSaveFixture(), request = { packId: 'spark', purchaseId: 'retry-after-failure' };
  const pending = f.economy.buyPack(request, f.ctx);
  f.context.rpgState.gold += 8; f.context.rpgSave();
  assert.equal(f.ordinaryWrites.length, 0, 'an ordinary grading save must not persist an unconfirmed debit or receipt');
  f.settle().reject(new Error('purchase save rejected')); await assert.rejects(pending, /could not be saved/);
  assert.equal(f.ordinaryWrites.length, 1); assert.equal(f.cloud().gold, 1008); assert.equal(f.cloud().grandLine, undefined);
  f.noHold(); const retried = await f.economy.buyPack(request, f.ctx);
  assert.equal(retried.wallet.balance, 888); assert.equal(f.cloud().gold, 888); assert.equal(retried.collection.stats.packsOpened, 1);
  assert.equal(f.cloud().grandLine.profiles[f.ctx.profileKey].purchases[request.purchaseId].cost, 120);
});
test('accepted purchases flush all ordinary rewards accumulated while saving', async () => {
  const f = concurrentSaveFixture(), pending = f.economy.buyPack({ packId: 'spark', purchaseId: 'accepted' }, f.ctx);
  f.context.rpgState.gold += 8; f.context.rpgSave(); f.context.rpgState.gold += 4; f.context.rpgSave();
  assert.equal(f.ordinaryWrites.length, 0); f.settle().resolve(); const result = await pending;
  assert.equal(f.ordinaryWrites.length, 1); assert.equal(result.wallet.balance, 892); assert.equal(f.cloud().gold, 892);
  assert.ok(f.cloud().grandLine.profiles[f.ctx.profileKey].purchases.accepted);
});
test('queued ordinary saves never flush into a different signed-in account', async () => {
  const f = concurrentSaveFixture(), pending = f.economy.buyPack({ packId: 'spark', purchaseId: 'old-account' }, f.ctx);
  f.context.rpgState.gold += 8; f.context.rpgSave();
  f.context.currentUser = { uid: 'new-account' }; f.context.rpgState = { gold: 50 }; f.context.rpgSave();
  assert.equal(f.ordinaryWrites.length, 1, 'the new account can save its own state normally');
  f.settle().reject(new Error('old purchase rejected')); await assert.rejects(pending);
  assert.equal(f.ordinaryWrites.length, 1); assert.equal(f.context.rpgState.gold, 50);
  assert.equal(f.ordinaryWrites[0].ref[2], 'new-account'); assert.equal(f.ordinaryWrites[0].state.grandLine, undefined);
});
test('same-account learner changes preserve ordinary points but keep the receipt in its original learner collection', async () => {
  const f = concurrentSaveFixture(), pending = f.economy.buyPack({ packId: 'spark', purchaseId: 'original-learner' }, f.ctx);
  f.switchProfile('p-sibling'); f.context.rpgState.gold += 8; f.context.rpgSave(); f.settle().resolve();
  await assert.rejects(pending, /profile changed/);
  assert.equal(f.cloud().gold, 888); assert.equal(f.ordinaryWrites.length, 1);
  assert.deepEqual(Object.keys(f.cloud().grandLine.profiles), ['p-fixture']);
  assert.ok(f.cloud().grandLine.profiles['p-fixture'].purchases['original-learner']);
});
