import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrandLineEconomy, createGrandLineRpgCommit, createGrandLineRpgSaveGate } from '../grand-line-economy.js';
import { CHARACTERS, STARTER_IDS, RETIRED_CHARACTER_REPLACEMENTS, createCollection } from '../grand-line-core.js';

const offers = [
  { id: 'spark', name: 'Bronze', cost: 120, odds: { 1: 40, 2: 30, 3: 17, 4: 8, 5: 3.5, 6: 1.2, 7: 0.3 } },
  { id: 'nova', name: 'Silver', cost: 320, bonusOdds: { 3: 62, 4: 25, 5: 9, 6: 3, 7: 1 } },
  { id: 'galaxy', name: 'Gold', cost: 750, bonusOdds: { 4: 68, 5: 22, 6: 8, 7: 2 } },
];
const copies = collection => Object.values(collection.cards).reduce((sum, card) => sum + card.copies, 0);
function fixture({ role = 'admin', gold = 0, enabled = false, trustedAdmin = true, random = () => 0 } = {}) {
  let user = { uid: 'account-a', role }, profileKey = 'learner-a';
  let state = { gold, inventory: { existing: 4 }, grandLine: { version: 1, accountNote: 'keep me',
    admin: { unlimitedGold: enabled, anotherPreference: 'keep too' }, profiles: {
      [profileKey]: { collection: createCollection(), purchases: {}, savedPreference: 'profile setting' },
      'other-learner': { collection: createCollection(), purchases: { other: { untouched: true } } },
    } } };
  let durable = structuredClone(state), holding = false, failing = false, settle;
  const writes = [], ordinaryWrites = [];
  const ctx = { profileKey, identity: 'account-a:learner-a:P6', admin: trustedAdmin, level: 'P6' };
  const env = { getUser: () => user, getState: () => state, setState: value => { state = value; },
    isCurrent: context => user?.uid === 'account-a' && context.profileKey === profileKey,
    getPacks: () => offers, random,
    writeState: async (next, uid) => {
      const snapshot = structuredClone(next);
      if (holding) await new Promise((resolve, reject) => { settle = { resolve, reject }; });
      if (failing) throw new Error('storage unavailable');
      durable = snapshot; writes.push({ uid, state: snapshot });
    } };
  const saveGate = createGrandLineRpgSaveGate({ getUser: env.getUser, flush: () => {
    durable = structuredClone(state); ordinaryWrites.push(structuredClone(state));
  } });
  env.saveGate = saveGate; env.commit = createGrandLineRpgCommit(env);
  return { env, ctx, economy: createGrandLineEconomy(env), writes, ordinaryWrites,
    state: () => state, durable: () => durable, user: () => user,
    setState: value => { state = value; }, setUser: value => { user = value; }, setProfile: value => { profileKey = value; },
    hold: () => { holding = true; }, settle: () => settle, noHold: () => { holding = false; }, fail: value => { failing = value; },
    earn: amount => { state.gold += amount; assert.equal(saveGate.defer(), true); } };
}

test('administrator availability requires the authenticated role, a real uid and the trusted current context', async () => {
  for (const role of ['student', 'employee', 'unknown', undefined]) {
    const f = fixture({ role, enabled: true });
    f.user().role = role;
    assert.deepEqual(f.economy.getSnapshot(f.ctx).admin, { available: false, unlimitedGold: false });
    assert.equal(f.economy.getSnapshot(f.ctx).wallet.unlimitedGold, false);
    const before = structuredClone(f.state());
    await assert.rejects(f.economy.adminAction({ action: 'unlock-all', admin: true, role: 'admin' }, f.ctx), /Administrator/);
    await assert.rejects(f.economy.adminAction({ action: 'set-unlimited-gold', enabled: true }, f.ctx), /Administrator/);
    await assert.rejects(f.economy.buyPack({ purchaseId: 'forged', packId: 'spark', admin: true, unlimitedGold: true, cost: 0 }, f.ctx), /120/);
    assert.deepEqual(f.state(), before); assert.equal(f.writes.length, 0);
  }
  const untrusted = fixture({ trustedAdmin: false, enabled: true });
  assert.equal(untrusted.economy.getSnapshot(untrusted.ctx).admin.available, false);
  await assert.rejects(untrusted.economy.adminAction({ action: 'unlock-all' }, untrusted.ctx), /Administrator/);
  const signedOut = fixture(); signedOut.setUser({ role: 'admin' });
  await assert.rejects(signedOut.economy.adminAction({ action: 'unlock-all' }, signedOut.ctx), /Administrator/);
  const missingHostIdentity = fixture(); delete missingHostIdentity.env.getUser;
  await assert.rejects(missingHostIdentity.economy.adminAction({ action: 'unlock-all' }, missingHostIdentity.ctx), /Administrator/);
  const stale = fixture(); stale.setProfile('another-learner');
  await assert.rejects(stale.economy.adminAction({ action: 'unlock-all' }, stale.ctx), /Administrator/);
});

test('unlimited mode persists as a flag, survives reload and toggles without changing real gold', async () => {
  const f = fixture({ gold: 37 });
  assert.deepEqual(f.economy.getSnapshot(f.ctx).admin, { available: true, unlimitedGold: false });
  const on = await f.economy.adminAction({ action: 'set-unlimited-gold', enabled: true }, f.ctx);
  assert.equal(on.changed, true); assert.equal(on.wallet.balance, 37); assert.equal(on.wallet.unlimitedGold, true);
  assert.deepEqual(on.admin, { available: true, unlimitedGold: true });
  assert.equal(f.state().grandLine.admin.unlimitedGold, true);
  assert.equal(f.state().gold, 37); assert.equal(Number.isFinite(f.state().gold), true);
  f.setState(structuredClone(f.durable()));
  const reopened = createGrandLineEconomy(f.env);
  assert.equal(reopened.getSnapshot(f.ctx).wallet.unlimitedGold, true);
  const repeated = await reopened.adminAction({ action: 'set-unlimited-gold', enabled: true }, f.ctx);
  assert.equal(repeated.changed, false); assert.equal(f.writes.length, 1);
  const off = await reopened.adminAction({ action: 'set-unlimited-gold', enabled: false }, f.ctx);
  assert.equal(off.admin.unlimitedGold, false); assert.equal(off.wallet.balance, 37); assert.equal(f.state().gold, 37);
  assert.equal(f.writes.length, 2);
  await assert.rejects(reopened.buyPack({ purchaseId: 'paid-again', packId: 'spark' }, f.ctx), /120/);
  assert.equal(JSON.stringify(f.durable()).includes('Infinity'), false);
});

test('zero-gold administrators buy each real pack tier with unchanged odds and exactly one durable card', async () => {
  for (const [index, packId] of ['spark', 'nova', 'galaxy'].entries()) {
    const f = fixture({ enabled: true });
    const before = f.economy.getSnapshot(f.ctx), purchaseId = `free-${packId}`;
    const result = await f.economy.buyPack({ purchaseId, packId }, f.ctx);
    assert.equal(result.wallet.balance, 0); assert.equal(result.wallet.unlimitedGold, true);
    assert.equal(result.grant.stars, [1, 3, 4][index]);
    assert.equal(copies(result.collection), copies(before.collection) + 1);
    assert.equal(result.collection.stats.packsOpened, 1); assert.equal(result.collection.packs, 0);
    assert.deepEqual(result.wallet.offers.map(offer => offer.cost), [120, 320, 750]);
    const receipt = f.state().grandLine.profiles[f.ctx.profileKey].purchases[purchaseId];
    assert.equal(receipt.cost, 0); assert.equal(receipt.normalCost, [120, 320, 750][index]); assert.equal(receipt.adminUnlimited, true);
    assert.equal(f.writes.length, 1); assert.equal(f.durable().gold, 0);
  }
});

test('unlimited packs still merge duplicates and can draw ordinary seven-star odds', async () => {
  const f = fixture({ enabled: true, random: () => 0.9999999999 });
  const first = await f.economy.buyPack({ purchaseId: 'apex-one', packId: 'spark' }, f.ctx);
  const second = await f.economy.buyPack({ purchaseId: 'apex-two', packId: 'spark' }, f.ctx);
  assert.equal(first.grant.stars, 7); assert.equal(second.grant.characterId, first.grant.characterId);
  assert.equal(second.grant.copies, 2); assert.equal(second.grant.duplicate, true);
  assert.equal(second.collection.stats.packsOpened, 2); assert.equal(second.wallet.balance, 0);
});

test('replaying a committed free receipt after reload or turning the mode off never grants or charges twice', async () => {
  const f = fixture({ enabled: true }), request = { purchaseId: 'durable-free', packId: 'galaxy' };
  const first = await f.economy.buyPack(request, f.ctx);
  f.setState(structuredClone(f.durable()));
  const reopened = createGrandLineEconomy(f.env);
  await reopened.adminAction({ action: 'set-unlimited-gold', enabled: false }, f.ctx);
  const before = structuredClone(f.state()), again = await reopened.buyPack(request, f.ctx);
  assert.equal(again.replayed, true); assert.deepEqual(again.grant, first.grant);
  assert.equal(again.wallet.balance, 0); assert.equal(again.wallet.unlimitedGold, false);
  assert.deepEqual(f.state(), before); assert.equal(f.writes.length, 2);
  await assert.rejects(reopened.buyPack({ ...request, packId: 'spark' }, f.ctx), /another pack/);
});

test('unlock-all grants only missing current cards and preserves copies, team, progression, receipts and pack counters', async () => {
  const f = fixture({ gold: 91 }), profile = f.state().grandLine.profiles[f.ctx.profileKey];
  profile.collection.cards.luffy.copies = 16;
  profile.collection.cards.kaido = { copies: 8 };
  profile.collection.team = ['kaido', 'zoro', 'nami', 'usopp', 'chopper'];
  profile.collection.packs = 2; profile.collection.stats.packsOpened = 7;
  profile.collection.stats.victories = 4; profile.collection.stats.correctAnswers = 27;
  profile.collection.unlockedEncounter = 5; profile.collection.completed = [1, 2, 3, 4];
  profile.purchases.paid = { packId: 'galaxy', cost: 750, grant: { characterId: 'kaido', copies: 8 } };
  const before = structuredClone(profile), result = await f.economy.adminAction({ action: 'unlock-all' }, f.ctx);
  assert.equal(result.unlockedCount, 94); assert.equal(result.changed, true);
  assert.equal(Object.keys(result.collection.cards).length, 100);
  assert.deepEqual(Object.keys(result.collection.cards).sort(), CHARACTERS.map(character => character.id).sort());
  for (const id of Object.keys(RETIRED_CHARACTER_REPLACEMENTS)) assert.equal(result.collection.cards[id], undefined);
  assert.equal(result.collection.cards.luffy.copies, 16); assert.equal(result.collection.cards.kaido.copies, 8);
  for (const id of Object.keys(result.collection.cards)) if (!before.collection.cards[id]) assert.equal(result.collection.cards[id].copies, 1);
  assert.deepEqual(result.collection.team, before.collection.team); assert.deepEqual(result.collection.stats, before.collection.stats);
  assert.deepEqual(result.collection.completed, before.collection.completed); assert.equal(result.collection.unlockedEncounter, 5);
  assert.equal(result.collection.packs, 2); assert.deepEqual(f.state().grandLine.profiles[f.ctx.profileKey].purchases, before.purchases);
  assert.equal(result.wallet.balance, 91); assert.equal(result.wallet.unlimitedGold, false);
  const state = structuredClone(f.state()), repeated = await f.economy.adminAction({ action: 'unlock-all' }, f.ctx);
  assert.equal(repeated.unlockedCount, 0); assert.equal(repeated.changed, false); assert.deepEqual(f.state(), state); assert.equal(f.writes.length, 1);
});

test('unlock-all converts four retired editions, preserves paid copies and unlocks new cards only once', async () => {
  const f=fixture(),profile=f.state().grandLine.profiles[f.ctx.profileKey],entries=[['ace','bellamy'],['sabo','gin'],['law','mr3'],['king','kuro']];
  for(const [i,[oldId,newId]]of entries.entries()){profile.collection.cards[oldId]={copies:8+i};profile.collection.cards[newId]={copies:2};}
  profile.collection.cards.kaido={copies:1};profile.collection.team=[...entries.map(([id])=>id),...STARTER_IDS,'kaido'];profile.collection.stats.packsOpened=29;
  const result=await f.economy.adminAction({action:'unlock-all'},f.ctx);
  assert.equal(Object.keys(result.collection.cards).length,100);assert.equal(result.unlockedCount,90);assert.equal(result.wallet.balance,0);
  assert.deepEqual(result.collection.team,[...entries.map(([,id])=>id),...STARTER_IDS,'kaido'].slice(0,7));assert.equal(result.collection.stats.packsOpened,29);
  for(const id of ['bigmom7','garp7','sabo7'])assert.equal(result.collection.cards[id].copies,1,'Admin action explicitly unlocks each new edition once');
  for(const [i,[oldId,newId]]of entries.entries()){assert.equal(result.collection.cards[oldId],undefined);assert.equal(result.collection.cards[newId].copies,10+i);}
  for(const id of Object.keys(RETIRED_CHARACTER_REPLACEMENTS))assert.equal(result.collection.cards[id],undefined);
  const again=await f.economy.adminAction({action:'unlock-all'},f.ctx);assert.deepEqual(again.collection,result.collection);assert.equal(again.changed,false);assert.equal(f.writes.length,1);
});

test('account-wide flags and unrelated metadata survive profile saves and ordinary paid purchases', async () => {
  const f = fixture({ gold: 500, enabled: true });
  const other = structuredClone(f.state().grandLine.profiles['other-learner']);
  await f.economy.saveCollection({ team: [...STARTER_IDS].reverse() }, f.ctx);
  assert.equal(f.state().grandLine.admin.unlimitedGold, true);
  assert.equal(f.state().grandLine.admin.anotherPreference, 'keep too'); assert.equal(f.state().grandLine.accountNote, 'keep me');
  f.setProfile('other-learner'); const otherCtx = { ...f.ctx, profileKey: 'other-learner' };
  assert.equal(f.economy.getSnapshot(otherCtx).wallet.unlimitedGold, true);
  f.user().role = 'student'; otherCtx.admin = false;
  const paid = await f.economy.buyPack({ purchaseId: 'ordinary', packId: 'spark' }, otherCtx);
  assert.equal(paid.wallet.balance, 380); assert.equal(paid.admin.available, false);
  assert.equal(f.state().grandLine.admin.unlimitedGold, true); assert.equal(f.state().grandLine.accountNote, 'keep me');
  assert.deepEqual(f.state().grandLine.profiles['other-learner'].purchases.other, other.purchases.other);
  assert.deepEqual(f.state().grandLine.profiles['learner-a'].collection.team, [...STARTER_IDS].reverse());
});

test('unlocking one learner does not grant cards to another learner and toggling gold stays account-wide', async () => {
  const f = fixture(); await f.economy.adminAction({ action: 'unlock-all' }, f.ctx);
  f.setProfile('other-learner'); const otherCtx = { ...f.ctx, profileKey: 'other-learner' };
  assert.equal(Object.keys(f.economy.getSnapshot(otherCtx).collection.cards).length, 5);
  await f.economy.adminAction({ action: 'set-unlimited-gold', enabled: true }, otherCtx);
  f.setProfile('learner-a');
  assert.equal(Object.keys(f.economy.getSnapshot(f.ctx).collection.cards).length, 100);
  assert.equal(f.economy.getSnapshot(f.ctx).wallet.unlimitedGold, true);
});

test('malformed admin actions and fake state fields cannot alter the wallet or roster', async () => {
  const f = fixture(), before = structuredClone(f.state());
  for (const request of [null, {}, { action: 'set-gold', gold: Infinity }, { action: 'unlock-all-future' },
    { action: 'set-unlimited-gold', enabled: 1 }, { action: 'set-unlimited-gold', enabled: 'true' }, { action: 'set-unlimited-gold' }]) {
    await assert.rejects(f.economy.adminAction(request, f.ctx));
  }
  assert.deepEqual(f.state(), before); assert.equal(f.writes.length, 0);
  const result = await f.economy.adminAction({ action: 'set-unlimited-gold', enabled: true, gold: Infinity, cards: { shanks: { copies: 999 } } }, f.ctx);
  assert.equal(result.wallet.balance, 0); assert.equal(Object.keys(result.collection.cards).length, 5);
});

test('failed administrator saves restore modes and cards while retaining ordinary earnings', async () => {
  for (const action of [{ action: 'set-unlimited-gold', enabled: true }, { action: 'unlock-all' }]) {
    const f = fixture({ gold: 23 }), previous = structuredClone(f.state().grandLine);
    f.hold(); const pending = f.economy.adminAction(action, f.ctx);
    f.earn(17); f.settle().reject(new Error('offline'));
    await assert.rejects(pending, /could not be saved/);
    assert.equal(f.state().gold, 40); assert.deepEqual(f.state().grandLine, previous);
    assert.equal(f.durable().gold, 40); assert.deepEqual(f.durable().grandLine, previous); assert.equal(f.ordinaryWrites.length, 1);
    f.noHold(); const retry = await f.economy.adminAction(action, f.ctx);
    assert.equal(retry.changed, true); assert.equal(retry.wallet.balance, 40);
  }
});

test('ordinary earnings flush after a successful admin save without losing metadata or granting extra cards', async () => {
  const f = fixture({ gold: 11 }); f.hold();
  const pending = f.economy.adminAction({ action: 'unlock-all' }, f.ctx); f.earn(29);
  f.settle().resolve(); const result = await pending;
  assert.equal(result.wallet.balance, 40); assert.equal(f.durable().gold, 40);
  assert.equal(Object.keys(f.durable().grandLine.profiles[f.ctx.profileKey].collection.cards).length, 100);
  assert.equal(f.durable().grandLine.accountNote, 'keep me'); assert.equal(f.ordinaryWrites.length, 1);
});

test('failed and concurrent free purchases stay atomic and retry with the same receipt', async () => {
  const f = fixture({ enabled: true }); f.hold(); const request = { purchaseId: 'free-held', packId: 'nova' };
  const pending = f.economy.buyPack(request, f.ctx);
  assert.throws(() => f.economy.getSnapshot(f.ctx), /still saving/);
  await assert.rejects(f.economy.adminAction({ action: 'unlock-all' }, f.ctx), /still saving/);
  await assert.rejects(f.economy.saveCollection({ team: STARTER_IDS }, f.ctx), /still saving/);
  await assert.rejects(f.economy.buyPack(request, f.ctx), /still saving/);
  f.earn(9); f.settle().reject(new Error('offline')); await assert.rejects(pending, /could not be saved/);
  assert.equal(f.state().gold, 9); assert.equal(f.state().grandLine.profiles[f.ctx.profileKey].purchases['free-held'], undefined);
  assert.equal(f.economy.getSnapshot(f.ctx).collection.stats.packsOpened, 0);
  f.noHold(); const retry = await f.economy.buyPack(request, f.ctx);
  assert.equal(retry.wallet.balance, 9); assert.equal(retry.collection.stats.packsOpened, 1);
  assert.equal(f.state().grandLine.profiles[f.ctx.profileKey].purchases['free-held'].cost, 0);
});

test('an administrator role lost during a pending write suppresses the reply and the stored flag gives no later benefit', async () => {
  for (const operation of ['toggle', 'purchase', 'unlock']) {
    const f = fixture({ enabled: operation === 'purchase' }); f.hold();
    const pending = operation === 'purchase' ? f.economy.buyPack({ purchaseId: 'role-change', packId: 'galaxy' }, f.ctx)
      : f.economy.adminAction(operation === 'toggle' ? { action: 'set-unlimited-gold', enabled: true } : { action: 'unlock-all' }, f.ctx);
    f.user().role = 'student'; f.settle().resolve();
    await assert.rejects(pending, /Administrator/);
    assert.equal(f.economy.getSnapshot(f.ctx).admin.available, false);
    assert.equal(f.economy.getSnapshot(f.ctx).wallet.unlimitedGold, false);
    await assert.rejects(f.economy.buyPack({ purchaseId: 'student-new', packId: 'spark' }, f.ctx), /120/);
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].uid, 'account-a');
  }
});

test('account and learner changes suppress pending admin replies without touching the new account', async () => {
  const f = fixture(); f.hold(); const pending = f.economy.adminAction({ action: 'unlock-all' }, f.ctx);
  f.setUser({ uid: 'account-b', role: 'admin' }); f.setState({ gold: 99, marker: 'new account' });
  f.settle().resolve(); await assert.rejects(pending, /Administrator/);
  assert.deepEqual(f.state(), { gold: 99, marker: 'new account' }); assert.equal(f.writes[0].uid, 'account-a');
  const p = fixture(); p.hold(); const changed = p.economy.adminAction({ action: 'unlock-all' }, p.ctx);
  p.setProfile('other-learner'); p.settle().resolve(); await assert.rejects(changed, /Administrator/);
  const fresh = p.economy.getSnapshot({ ...p.ctx, profileKey: 'other-learner' });
  assert.equal(Object.keys(fresh.collection.cards).length, 5); assert.equal(Object.keys(p.durable().grandLine.profiles['learner-a'].collection.cards).length, 100);
});

test('a role change after pack selection is checked again before any zero-cost mutation', async () => {
  const f = fixture({ enabled: true }), before = structuredClone(f.state());
  f.env.random = () => { f.user().role = 'student'; return 0; };
  await assert.rejects(f.economy.buyPack({ purchaseId: 'no-longer-admin', packId: 'galaxy' }, f.ctx), /Administrator/);
  assert.deepEqual(f.state(), before); assert.equal(f.writes.length, 0);
  assert.equal(f.economy.getSnapshot(f.ctx).wallet.unlimitedGold, false);
});

test('unlimited administrators open fifty one-card packs at each tier in one atomic zero-cost batch', async () => {
  for (const [index, packId] of ['spark', 'nova', 'galaxy'].entries()) {
    let rolls = 0; const f = fixture({ enabled: true, random: () => { rolls++; return .9999999999; } });
    const result = await f.economy.buyPack({ purchaseId: 'free-fifty', packId, quantity: 50 }, f.ctx);
    assert.equal(result.quantity, 50); assert.equal(result.grants.length, 50); assert.equal(result.grant, undefined);
    assert.equal(result.wallet.balance, 0); assert.equal(result.collection.stats.packsOpened, 50);
    assert.equal(copies(result.collection), STARTER_IDS.length + 50); assert.equal(rolls, 100);
    assert.deepEqual(result.grants.map(g => g.copies), Array.from({ length: 50 }, (_, n) => n + 1));
    assert.ok(result.grants.every(g => g.stars === 7)); assert.equal(result.grants[0].duplicate, false);
    assert.ok(result.grants.slice(1).every(g => g.duplicate));
    const receipt = f.durable().grandLine.profiles[f.ctx.profileKey].purchases['free-fifty'];
    assert.equal(receipt.cost, 0); assert.equal(receipt.normalCost, [120, 320, 750][index] * 50);
    assert.equal(receipt.adminUnlimited, true); assert.equal(receipt.quantity, 50);
    assert.deepEqual(receipt.grants, result.grants); assert.equal(f.writes.length, 1);
    assert.equal(f.durable().gold, 0); assert.equal(f.durable().grandLine.accountNote, 'keep me');
  }
});

test('a free batch receipt replays unchanged after unlimited mode is disabled and rejects quantity substitution', async () => {
  let rolls = 0; const f = fixture({ enabled: true, random: () => { rolls++; return 0; } });
  const request = { purchaseId: 'replay-free-batch', packId: 'galaxy', quantity: 10 };
  const first = await f.economy.buyPack(request, f.ctx);
  await f.economy.adminAction({ action: 'set-unlimited-gold', enabled: false }, f.ctx);
  f.setState(structuredClone(f.durable())); const before = structuredClone(f.state());
  const replay = await createGrandLineEconomy(f.env).buyPack(request, f.ctx);
  assert.equal(replay.replayed, true); assert.equal(replay.quantity, 10); assert.deepEqual(replay.grants, first.grants);
  assert.equal(replay.wallet.balance, 0); assert.equal(replay.admin.unlimitedGold, false);
  assert.equal(rolls, 20); assert.equal(f.writes.length, 2); assert.deepEqual(f.state(), before);
  await assert.rejects(f.economy.buyPack({ ...request, quantity: 50 }, f.ctx), /another quantity/);
  await assert.rejects(f.economy.buyPack({ ...request, quantity: undefined }, f.ctx), /another quantity/);
  assert.equal(rolls, 20); assert.equal(f.writes.length, 2); assert.deepEqual(f.state(), before);
});

test('student flags and untrusted admin contexts cannot authorize free batches or reach randomness', async () => {
  for (const config of [{ role: 'student' }, { role: 'admin', trustedAdmin: false }]) {
    let rolls = 0; const f = fixture({ ...config, enabled: true, random: () => { rolls++; return 0; } });
    const before = structuredClone(f.state());
    await assert.rejects(f.economy.buyPack({ purchaseId: 'forged-batch', packId: 'galaxy', quantity: 50,
      unlimitedGold: true, admin: true, cost: 0, grants: Array(50).fill({ characterId: 'kaido' }) }, f.ctx), /37500/);
    assert.equal(rolls, 0); assert.equal(f.writes.length, 0); assert.deepEqual(f.state(), before);
  }
  const f = fixture({ enabled: true }), before = structuredClone(f.state());
  await assert.rejects(f.economy.buyPack({ purchaseId: 'too-many', packId: 'spark', quantity: 51 }, f.ctx), /1 and 50/);
  assert.deepEqual(f.state(), before); assert.equal(f.writes.length, 0);
});

test('a failed fifty-pack free batch restores every card and receipt while preserving ordinary earnings', async () => {
  const f = fixture({ enabled: true }), before = structuredClone(f.state().grandLine);
  const request = { purchaseId: 'failed-free-batch', packId: 'nova', quantity: 50 };
  f.hold(); const pending = f.economy.buyPack(request, f.ctx); f.earn(13);
  await assert.rejects(f.economy.buyPack(request, f.ctx), /still saving/);
  f.settle().reject(Error('offline')); await assert.rejects(pending, /could not be saved/);
  assert.equal(f.state().gold, 13); assert.equal(f.durable().gold, 13);
  assert.deepEqual(f.state().grandLine, before); assert.deepEqual(f.durable().grandLine, before);
  f.noHold(); const retry = await f.economy.buyPack(request, f.ctx);
  assert.equal(retry.wallet.balance, 13); assert.equal(retry.collection.stats.packsOpened, 50);
  assert.equal(retry.grants.length, 50); assert.equal(f.writes.length, 1);
  const receipt = f.durable().grandLine.profiles[f.ctx.profileKey].purchases[request.purchaseId];
  assert.equal(receipt.cost, 0); assert.equal(receipt.quantity, 50);
});

test('admin authority is rechecked around an entire batch rather than trusting its captured free price', async () => {
  const f = fixture({ enabled: true }), before = structuredClone(f.state()); let rolls = 0;
  f.env.random = () => { if (++rolls === 3) f.user().role = 'student'; return 0; };
  await assert.rejects(f.economy.buyPack({ purchaseId: 'lost-during-rolls', packId: 'spark', quantity: 10 }, f.ctx), /Administrator/);
  assert.deepEqual(f.state(), before); assert.equal(f.writes.length, 0);
  const held = fixture({ enabled: true }); held.hold();
  const pending = held.economy.buyPack({ purchaseId: 'lost-during-write', packId: 'spark', quantity: 10 }, held.ctx);
  held.user().role = 'student'; held.settle().resolve(); await assert.rejects(pending, /Administrator/);
  assert.equal(held.writes.length, 1); assert.equal(held.durable().grandLine.profiles[held.ctx.profileKey].purchases['lost-during-write'].quantity, 10);
  assert.equal(held.economy.getSnapshot(held.ctx).wallet.unlimitedGold, false);
  await assert.rejects(held.economy.buyPack({ purchaseId: 'student-next', packId: 'spark', quantity: 10 }, held.ctx), /1200/);
  assert.equal(held.writes.length, 1);
});
