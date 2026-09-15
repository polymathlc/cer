// Purchases use the portal's existing reward-point wallet. The iframe cannot
// choose its card, price, odds, ownership or balance, and receives no ledger.
import { CHARACTERS, CHARACTER_BY_ID, currentCharacterId, createCollection, normalizeCollection, addCard, setTeam } from './grand-line-core.js?v=3.5.0';

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
  // Only the host's current authenticated user and trusted context can grant
  // administrator privileges. A stored flag never authorizes a student.
  function adminUid(ctx) {
    const user = env.getUser?.();
    return user?.uid && user.role === 'admin' && ctx?.admin === true && env.isCurrent(ctx) ? user.uid : null;
  }
  function requireAdmin(ctx, expectedUid) {
    const uid = adminUid(ctx);
    if (!uid || expectedUid !== undefined && uid !== expectedUid) throw rejected('Administrator access changed or is unavailable. Reopen the game.');
    return uid;
  }
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
    const available = !!adminUid(ctx), unlimitedGold = available && state.grandLine?.admin?.unlimitedGold === true;
    return { wallet: { available: true, balance: Math.floor(state.gold), currency: 'points', offers: offers(), unlimitedGold, maxPackQuantity: 50 },
      admin: { available, unlimitedGold },
      collection: normalizeCollection(saved.collection || createCollection()) };
  }
  async function commit(ctx, original, saved, balance = original.gold, { adminPatch, authority } = {}) {
    if (saving) throw new Error('Another purchase or save is still finishing. Retry in a moment.');
    if (current(ctx) !== original) throw new Error('Your wallet changed. Retry with the refreshed balance.');
    if (authority !== undefined) requireAdmin(ctx, authority);
    const next = clone(original);
    next.gold = balance;
    const profiles = { ...(next.grandLine?.profiles || {}) };
    if (saved !== undefined) profiles[ctx.profileKey] = saved;
    next.grandLine = { ...(next.grandLine || {}), version: 1, profiles };
    if (adminPatch) next.grandLine.admin = { ...(next.grandLine.admin || {}), ...adminPatch };
    saving = true;
    try { await env.commit(next, original, ctx); }
    finally { saving = false; }
    if (authority !== undefined) requireAdmin(ctx, authority);
    current(ctx); return snapshot(ctx);
  }
  return {
    getSnapshot: snapshot,
    async buyPack({ purchaseId, packId, quantity = 1 } = {}, ctx) {
      if (saving) throw new Error('Your wallet is still saving. Retry with the same purchase request.');
      if (!token(purchaseId) || !token(packId)) throw rejected('Invalid purchase request.');
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) throw rejected('Choose between 1 and 50 packs.');
      const state = current(ctx);
      const saved = record(state, ctx), ledger = saved.purchases || {};
      if (Object.hasOwn(ledger, purchaseId)) {
        const receipt = ledger[purchaseId], receiptQuantity = receipt?.quantity === undefined ? 1 : receipt.quantity;
        if (receipt?.packId !== packId) throw new Error('That purchase request already belongs to another pack.');
        if (receiptQuantity !== quantity) throw new Error('That purchase request already belongs to another quantity of packs.');
        const result = snapshot(ctx), originalGrants = receipt.grants === undefined && quantity === 1 ? [receipt.grant] : receipt.grants;
        if (!Array.isArray(originalGrants) || originalGrants.length !== quantity) throw new Error('This saved purchase could not be loaded. Reopen the game to retry the same receipt.');
        const grants = originalGrants.map(original => {
          const grant = { ...original }, id = currentCharacterId(grant.characterId);
          if (!id || !result.collection.cards[id]) throw new Error('This saved purchase could not be loaded. Reopen the game to retry the same receipt.');
          if (id !== grant.characterId) Object.assign(grant, { characterId: id, stars: CHARACTER_BY_ID[id].stars, copies: result.collection.cards[id].copies });
          return grant;
        });
        // Keep the original durable receipt as evidence that it was charged.
        // Replay presents each migrated card without changing counts or saving.
        return { ...result, quantity, grants, ...(quantity === 1 ? { grant: grants[0] } : {}), replayed: true };
      }
      const offer = offers().find(p => p.id === packId);
      if (!offer) throw rejected('This booster pack is unavailable.');
      if (Object.keys(ledger).length >= 10000) throw rejected('This collection has reached its purchase limit.');
      const normalCost = offer.cost * quantity;
      if (!Number.isSafeInteger(normalCost)) throw rejected('This pack quantity has an invalid total price.');
      const authority = state.grandLine?.admin?.unlimitedGold === true ? adminUid(ctx) : null;
      const cost = authority ? 0 : normalCost;
      if (state.gold < cost) throw rejected(`${quantity === 1 ? 'This pack costs' : `These ${quantity} packs cost`} ${normalCost} reward points. Answer more questions to earn points.`);
      const weighted = Object.entries(offer.odds).filter(([stars, weight]) => Number.isInteger(Number(stars)) && Number(stars) >= 1 && Number(stars) <= 7 && Number.isFinite(weight) && weight > 0);
      const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
      if (!Number.isFinite(total) || !total) throw rejected('This pack has no available characters.');
      const pools = new Map(weighted.map(([stars]) => [Number(stars), CHARACTERS.filter(c => c.stars === Number(stars))]));
      if ([...pools.values()].some(pool => !pool.length)) throw rejected('This pack has no available characters.');
      const random = () => Math.max(0, Math.min(0.99999999999, Number((env.random || Math.random)()) || 0));
      const collection = normalizeCollection(saved.collection), grants = [];
      for (let index = 0; index < quantity; index++) {
        let ticket = random() * total, stars = Number(weighted.at(-1)[0]);
        for (const [star, weight] of weighted) { ticket -= weight; if (ticket < 0) { stars = Number(star); break; } }
        const pool = pools.get(stars), character = pool[Math.floor(random() * pool.length)];
        const added = addCard(collection, character.id);
        grants.push({ characterId: character.id, copies: added.copies, duplicate: added.duplicate, stars });
      }
      collection.stats.packsOpened = number(collection.stats.packsOpened) + quantity;
      const compatibleGrant = quantity === 1 ? { grant: grants[0] } : {};
      const next = { ...saved, collection, purchases: { ...ledger, [purchaseId]: { packId, quantity, cost,
        ...(authority ? { normalCost, adminUnlimited: true } : {}), grants: clone(grants),
        ...(quantity === 1 ? { grant: { ...grants[0] } } : {}), at: new Date().toISOString() } } };
      return { ...await commit(ctx, state, next, state.gold - cost, authority ? { authority } : {}), quantity, grants, ...compatibleGrant, replayed: false };
    },
    async adminAction(request, ctx) {
      if (saving) throw new Error('Your wallet is still saving. Retry in a moment.');
      const authority = requireAdmin(ctx), state = current(ctx);
      if (request?.action === 'set-unlimited-gold') {
        if (typeof request.enabled !== 'boolean') throw rejected('Choose whether unlimited gold is enabled.');
        const changed = (state.grandLine?.admin?.unlimitedGold === true) !== request.enabled;
        if (!changed) return { ...snapshot(ctx), action: request.action, changed: false };
        return { ...await commit(ctx, state, undefined, state.gold, { authority, adminPatch: { unlimitedGold: request.enabled } }),
          action: request.action, changed: true };
      }
      if (request?.action === 'unlock-all') {
        const saved = record(state, ctx), collection = normalizeCollection(saved.collection);
        let unlockedCount = 0;
        for (const character of CHARACTERS) if (!collection.cards[character.id]) { addCard(collection, character.id); unlockedCount++; }
        if (!unlockedCount) return { ...snapshot(ctx), action: request.action, unlockedCount: 0, changed: false };
        return { ...await commit(ctx, state, { ...saved, collection }, state.gold, { authority }),
          action: request.action, unlockedCount, changed: true };
      }
      throw rejected('Unknown administrator action.');
    },
    async saveCollection({ team, progress }, ctx) {
      if (saving) throw new Error('Your wallet is still saving. Retry in a moment.');
      const state = current(ctx), saved = record(state, ctx), collection = normalizeCollection(saved.collection);
      if (team !== undefined && !setTeam(collection, team)) throw new Error('Choose one to seven different characters that you own.');
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
