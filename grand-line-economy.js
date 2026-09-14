// Purchases use the portal's existing reward-point wallet. The iframe cannot
// choose its card, price, odds, ownership or balance, and receives no ledger.
import { CHARACTERS, CHARACTER_BY_ID, currentCharacterId, createCollection, normalizeCollection, addCard, setTeam } from './grand-line-core.js?v=1.2.0';

const token = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const number = (value, max = 1000000) => Number.isSafeInteger(value) && value >= 0 ? Math.min(max, value) : 0;
const clone = value => JSON.parse(JSON.stringify(value));
const rejected = message => Object.assign(new Error(message), { confirmedNoCharge: true });
// Ordinary practice can finish while a purchase is awaiting persistence. Its
// reward still updates the shared state, but must not persist a provisional
// purchase receipt. Flush that ordinary save after the purchase settles.
export function createGrandLineRpgSaveGate(env) {
  let active = null;
  return {
    defer() {
      if (!active || env.getUser()?.uid !== active.uid) return false;
      active.requested = true; return true;
    },
    begin(uid) {
      if (active) throw new Error('A wallet save is already pending.');
      const entry = active = { uid, requested: false };
      return () => {
        if (active !== entry) return;
        active = null;
        // A new account must never receive the previous account's queued save.
        if (entry.requested && env.getUser()?.uid === uid) {
          try { env.flush(); } catch (error) { env.onError?.(error); }
        }
      };
    }
  };
}
export function createGrandLineRpgCommit(env) {
  return async (next, previous, ctx) => {
    if (!env.isCurrent(ctx) || env.getState() !== previous) throw new Error('Your wallet changed. Reopen the game.');
    const uid = env.getUser().uid, proposedGold = next.gold;
    next.updatedAt = new Date().toISOString();
    const releaseSave = env.saveGate?.begin(uid);
    env.setState(next);
    try { await env.writeState(next, uid); }
    catch (_) {
      if (env.getState() === next) {
        // Preserve unrelated points earned while the save was pending.
        next.gold += previous.gold - proposedGold;
        if (previous.grandLine === undefined) delete next.grandLine; else next.grandLine = previous.grandLine;
        env.render?.();
      }
      throw new Error('Your purchase or crew change could not be saved. Your points were restored. Retry safely.');
    } finally { releaseSave?.(); }
    if (env.getState() === next && env.getUser()?.uid === uid) env.render?.();
  };
}
export function createGrandLineEconomy(env) {
  let saving = false;
  function current(ctx) {
    if (!ctx?.profileKey || !env.isCurrent(ctx)) throw new Error('Your learning profile changed. Reopen Grand Line Chronicles.');
    const state = env.getState();
    if (!state || !Number.isFinite(state.gold) || state.gold < 0) throw new Error('Your saved reward points are not ready. Reopen the game once the portal has loaded.');
    return state;
  }
  function offers() {
    return env.getPacks().filter(p => ['spark', 'nova', 'galaxy'].includes(p.id) && Number.isSafeInteger(p.cost) && p.cost > 0)
      .map(p => ({ id: p.id, name: p.name, cost: p.cost, odds: { ...(p.bonusOdds || p.odds) } }));
  }
  const record = (state, ctx) => state.grandLine?.profiles?.[ctx.profileKey] || {};
  function snapshot(ctx) {
    if (saving) throw new Error('Your wallet is still saving. Retry in a moment.');
    const state = current(ctx), saved = record(state, ctx);
    return { wallet: { available: true, balance: Math.floor(state.gold), currency: 'points', offers: offers() },
      collection: normalizeCollection(saved.collection || createCollection()) };
  }
  async function commit(ctx, original, saved, balance = original.gold) {
    if (saving) throw new Error('Another purchase or save is still finishing. Retry in a moment.');
    if (current(ctx) !== original) throw new Error('Your wallet changed. Retry with the refreshed balance.');
    const next = clone(original);
    next.gold = balance;
    next.grandLine = { version: 1, profiles: { ...(next.grandLine?.profiles || {}), [ctx.profileKey]: saved } };
    saving = true;
    try { await env.commit(next, original, ctx); }
    finally { saving = false; }
    current(ctx); return snapshot(ctx);
  }
  return {
    getSnapshot: snapshot,
    async buyPack({ purchaseId, packId }, ctx) {
      if (saving) throw new Error('Your wallet is still saving. Retry with the same purchase request.');
      if (!token(purchaseId) || !token(packId)) throw rejected('Invalid purchase request.');
      const state = current(ctx), offer = offers().find(p => p.id === packId);
      if (!offer) throw rejected('This booster pack is unavailable.');
      const saved = record(state, ctx), ledger = saved.purchases || {};
      if (Object.hasOwn(ledger, purchaseId)) {
        if (ledger[purchaseId].packId !== packId) throw new Error('That purchase request already belongs to another pack.');
        const result = snapshot(ctx), grant = { ...ledger[purchaseId].grant };
        const id = currentCharacterId(grant.characterId);
        if (!id || !result.collection.cards[id]) throw new Error('This saved purchase could not be loaded. Reopen the game to retry the same receipt.');
        // Keep the original durable receipt as evidence that it was charged.
        // A replay only presents its migrated card; it never grants or saves.
        if (id !== grant.characterId) Object.assign(grant, { characterId: id, stars: CHARACTER_BY_ID[id].stars, copies: result.collection.cards[id].copies });
        return { ...result, grant, replayed: true };
      }
      if (Object.keys(ledger).length >= 10000) throw rejected('This collection has reached its purchase limit.');
      if (state.gold < offer.cost) throw rejected(`This pack costs ${offer.cost} reward points. Answer more questions to earn points.`);
      const weighted = Object.entries(offer.odds).filter(([stars, weight]) => Number(stars) >= 1 && Number(stars) <= 7 && Number.isFinite(weight) && weight > 0);
      const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
      if (!total) throw rejected('This pack has no available characters.');
      const random = () => Math.max(0, Math.min(0.99999999999, Number((env.random || Math.random)()) || 0));
      let ticket = random() * total, stars = Number(weighted.at(-1)[0]);
      for (const [star, weight] of weighted) { ticket -= weight; if (ticket < 0) { stars = Number(star); break; } }
      const pool = CHARACTERS.filter(c => c.stars === stars);
      if (!pool.length) throw rejected('This pack has no available characters.');
      const collection = normalizeCollection(saved.collection), character = pool[Math.floor(random() * pool.length)];
      const added = addCard(collection, character.id);
      collection.stats.packsOpened = number(collection.stats.packsOpened) + 1;
      const grant = { characterId: character.id, copies: added.copies, duplicate: added.duplicate, stars };
      const next = { ...saved, collection, purchases: { ...ledger, [purchaseId]: { packId, cost: offer.cost, grant, at: new Date().toISOString() } } };
      return { ...await commit(ctx, state, next, state.gold - offer.cost), grant, replayed: false };
    },
    async saveCollection({ team, progress }, ctx) {
      if (saving) throw new Error('Your wallet is still saving. Retry in a moment.');
      const state = current(ctx), saved = record(state, ctx), collection = normalizeCollection(saved.collection);
      if (team !== undefined && !setTeam(collection, team)) throw new Error('Choose five different characters that you own.');
      // Battle progression is non-financial. Never accept cards, pack balances,
      // purchase counts, points or arbitrary properties from the game frame.
      if (progress && typeof progress === 'object' && !Array.isArray(progress)) {
        collection.unlockedEncounter = Math.max(collection.unlockedEncounter, Math.max(1, number(progress.unlockedEncounter, 9)));
        const completed = Array.isArray(progress.completed) ? progress.completed.filter(n => Number.isInteger(n) && n >= 1 && n <= 9) : [];
        collection.completed = [...new Set([...collection.completed, ...completed])].sort((a, b) => a - b);
        for (const key of ['victories', 'correctAnswers']) collection.stats[key] = Math.max(collection.stats[key] || 0, number(progress.stats?.[key]));
      }
      return commit(ctx, state, { ...saved, collection });
    }
  };
}
