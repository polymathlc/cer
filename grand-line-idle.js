import {getActiveUnit, getValidTargets, act, chooseDefend, advanceBattle} from './grand-line-core.js?v=1.1.0';

export const IDLE_STRATEGIES = Object.freeze({
  balanced: {name: 'Balanced', description: 'Finish weakened enemies, heal injured allies, and use crew buffs.', healing: 1.7, support: 1.1},
  assault: {name: 'Assault', description: 'Prioritize damage and finishing blows; heal when allies are in danger.', healing: 0.85, support: 0.6},
  sustain: {name: 'Sustain', description: 'Prioritize healing, shields, and recovery to keep the crew sailing.', healing: 2.6, support: 1.8},
});
export const IDLE_SPEEDS = Object.freeze([1, 2, 4]);
export const idleActionDelay = speed => 1000 / (IDLE_SPEEDS.includes(speed) ? speed : 4);
const harmful = new Set(['stun', 'freeze', 'burn', 'poison', 'weaken', 'slow']);
const alive = unit => unit.hp > 0;

// Strategy chooses legal skills and targets; the battle engine remains the
// authority for damage, cooldowns, turn order, and the three-question gate.
export function chooseIdleAction(battle, strategy = 'balanced') {
  if (!battle || battle.status !== 'player') return null;
  const actor = getActiveUnit(battle);
  if (!actor || actor.side !== 'ally' || !alive(actor)) return null;
  const style = IDLE_STRATEGIES[strategy] || IDLE_STRATEGIES.balanced;
  const crew = battle.allies.filter(alive);
  let best = null;
  for (const skill of actor.skills) {
    if (actor.energy < skill.cost || actor.cooldowns[skill.id] > 0) continue;
    const valid = getValidTargets(battle, skill.id);
    for (const target of valid) {
      const targets = skill.target.startsWith('all-') ? valid : [target];
      let score = 0, reason = 'Build Spirit';
      if (skill.power > 0) {
        for (const enemy of targets) {
          const damage = Math.max(1, actor.attack * skill.power - enemy.defense * 0.5);
          const shield=Math.max(0,enemy.shield||0),healthDamage=Math.max(0,damage-shield);
          score += Math.min(enemy.hp,healthDamage) + Math.min(shield,damage)*0.3 + (healthDamage >= enemy.hp ? actor.attack * 1.25 : 0);
        }
        reason = targets.length > 1 ? 'Strike the opposing crew' : 'Focus a weakened enemy';
      }
      for (const effect of skill.effects) {
        const recipients = effect.scope === 'self' ? [actor] : effect.scope === 'all-allies' ? crew : targets;
        if (effect.type === 'revive') { score += 10000; reason = 'Revive a fallen crewmate'; }
        if (effect.type === 'heal') for (const ally of recipients) {
          const missing = Math.max(0, ally.maxHp - ally.hp);
          score += Math.min(missing, actor.attack * effect.amount) * style.healing * (ally.hp / ally.maxHp < 0.3 ? 2 : 1);
          if (missing > actor.attack * 0.3) reason = 'Heal an injured crewmate';
        }
        if (effect.type === 'cleanse') for (const ally of recipients) {
          const bad = ally.statuses.filter(s => harmful.has(s.type) && s.duration > 0).length;
          score += bad * actor.attack * 0.65 * style.support;
          if (bad) reason = 'Clear harmful effects';
        }
        if (effect.type === 'shield') for (const ally of recipients) {
          score += Math.max(0, Math.min(actor.attack * effect.amount, ally.maxHp * 0.35 - ally.shield)) * style.support * 0.6;
        }
        if (effect.type === 'energy') for (const ally of recipients) score += Math.min(effect.amount, Math.max(0, ally.maxEnergy - ally.energy)) * style.support * 0.5;
        if (['attack-up', 'defense-up', 'guard', 'regen', 'taunt'].includes(effect.type)) {
          for (const ally of recipients) if (!ally.statuses.some(s => s.type === effect.type && s.duration > 0)) score += actor.attack * 0.5 * style.support;
        }
        if (['stun', 'freeze', 'burn', 'poison', 'weaken', 'slow'].includes(effect.type)) {
          for (const recipient of recipients) if (!recipient.statuses.some(s => s.type === effect.type && s.duration > 0)) score += (recipient.side===actor.side?-1:1) * actor.attack * 0.22 * (effect.chance ?? 1);
        }
        if (effect.type === 'pierce') score += targets.reduce((sum, enemy) => sum + enemy.defense * 0.35, 0);
      }
      if (skill.id === actor.skills[0].id) score += Math.min(20, actor.maxEnergy - actor.energy) * 0.4;
      // Save expensive support abilities when everyone is healthy and buffed.
      score -= skill.cost * 0.1;
      if (!best || score > best.score) best = {kind: 'skill', skillId: skill.id, targetId: target.id, score, reason, name: skill.name};
    }
  }
  return best && best.score > 0 ? best : {kind: 'defend', reason: 'Recover Spirit and protect the crew', name: 'Defend'};
}

export function advanceIdleBattle(battle, strategy = 'balanced') {
  if (!battle || !['player', 'enemy'].includes(battle.status)) return null;
  if (battle.status === 'enemy') return advanceBattle(battle) ? {kind: 'enemy', reason: 'The opposing crew acts'} : null;
  const action = chooseIdleAction(battle, strategy);
  if (!action) return null;
  const completed = action.kind === 'defend' ? chooseDefend(battle) : act(battle, action.skillId, action.targetId);
  return completed ? action : null;
}
