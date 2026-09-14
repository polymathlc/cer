import { scienceTcgSignaturePlan } from './science-tcg-identity.js';

export function scienceTcgBrandedDamage(target, amount) {
  const mark = target._signatureBrand;
  if (!mark || amount <= 0) return amount;
  delete target._signatureBrand;
  return mark.flat ? amount + mark.amount : amount * (1 + mark.amount);
}

// Run-local statuses: nothing here writes a card, wallet, reward or save.
export function applyScienceTcgSignature(mode, { card, actor, allies, enemies, power, damage, restore, feedback = () => {}, attackCap = 99 }) {
  const state = actor._signature || (actor._signature = {});
  const plan = scienceTcgSignaturePlan(card, actor, allies, enemies, state, { power, mode });
  for (const action of plan) {
    if (actor.dead || actor.hp <= 0) break;
    const t = action.target;
    if (t.dead || t.hp <= 0) continue;
    const n = Math.max(1, Math.round(action.amount));
    switch (action.type) {
      case 'damage': damage(t, n); break;
      case 'cost': t.hp = Math.max(1, t.hp - n); break;
      case 'heal': if (!t.curse) { if (restore) restore(t,n); else t.hp = Math.min(t.maxHp, t.hp + n); } break;
      case 'shield':
        if (mode === 'duel') t.shield = true;
        else if (mode === 'siege') t._signatureShield = Math.max(t._signatureShield || 0, Math.min(t.maxHp * .4, (t._signatureShield || 0) + n));
        else { t.shield = Math.max(t.shield || 0, Math.min(t.maxHp * .4, (t.shield || 0) + n)); if (mode === 'legends') t.shieldT = Math.max(t.shieldT || 0, 6); }
        break;
      case 'delay':
        if (t.wardStatus) break;
        if (mode === 'arena') t.chargeSlow = Math.max(t.chargeSlow || 0, 1);
        else if (mode === 'duel') { t.frozen = Math.max(t.frozen || 0, 1); t.canAttack = false; }
        else if (mode === 'siege') { t.slow = Math.max(t.slow || 0, .4); t.slowT = Math.max(t.slowT || 0, 2); }
        else t.stun = Math.max(t.stun || 0, 1);
        break;
      case 'charge':
        if (mode === 'arena') t.charge = Math.min(t.skillThresh || 3, (t.charge || 0) + 1);
        else if (mode === 'duel') t.atk = Math.max(t.atk, Math.min(attackCap, t.atk + 1));
        else if (mode === 'siege') t.cool = Math.max(0, (t.cool || 0) - 1.5);
        else Object.keys(t.cds || {}).forEach(id => { t.cds[id] = Math.max(0, t.cds[id] - 2); });
        break;
      case 'cleanse':
        t.poison = null; t.poisonT = 0; t.curse = null; t.cursed = 0; t.stun = 0; t.frozen = 0; t.slow = 0; t.slowT = 0; t.chargeSlow = 0; delete t._signatureBrand;
        // Duel consumes the freeze counter at turn start but keeps the attack
        // locked. Restore readiness without granting a second attack or Rush.
        if (mode === 'duel') {
          const keywords = t.ab?.kw || [];
          t.canAttack = !t.attacked && (!t.justPlayed || keywords.includes('charge') || keywords.includes('rush'));
        }
        break;
      case 'brand': if (!t.wardStatus) t._signatureBrand = { amount: action.amount, flat: mode === 'duel' }; break;
    }
    feedback(action);
  }
  return plan;
}

export function scienceTcgAbsorbBarrier(target, damage) {
  const absorbed = Math.min(Math.max(0, target._signatureShield || 0), Math.max(0, damage));
  target._signatureShield = Math.max(0, (target._signatureShield || 0) - absorbed);
  return Math.max(0, damage - absorbed);
}
