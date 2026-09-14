import { CHARACTERS, CHARACTER_BY_ID, ENCOUNTERS } from './grand-line-data.js?v=1.2.1';
import { statsFor } from './grand-line-core.js?v=1.2.1';

export const DEFENSE_PATH = Object.freeze([
  { x: 20, y: 110 }, { x: 250, y: 110 }, { x: 250, y: 300 },
  { x: 545, y: 300 }, { x: 545, y: 485 }, { x: 925, y: 485 },
]);
export const DEFENSE_PADS = Object.freeze([
  { id: 'lookout', x: 140, y: 230, name: 'Lookout' },
  { id: 'crossroads', x: 350, y: 195, name: 'Crossroads' },
  { id: 'inner-bend', x: 445, y: 405, name: 'Inner bend' },
  { id: 'ship-watch', x: 765, y: 380, name: 'Ship watch' },
  { id: 'medical-post', x: 320, y: 425, name: 'Central post' },
  { id: 'entrance', x: 125, y: 65, name: 'Harbor entrance' },
  { id: 'high-ground', x: 415, y: 85, name: 'High ground' },
  { id: 'east-bank', x: 665, y: 205, name: 'East bank' },
  { id: 'last-bend', x: 630, y: 570, name: 'Last bend' },
  { id: 'dock', x: 930, y: 365, name: 'Final dock' },
]);
export const DEFENSE_STAGES = Object.freeze(ENCOUNTERS.map(encounter => ({
  ...encounter, waveCount: 3, description: `Defend the ship through three waves at ${encounter.name}. Position your crew, stop the raiders, and answer three questions after every wave.`,
})));

const STEP = 0.05;
const negative = new Set(['stun', 'freeze', 'burn', 'poison', 'weaken', 'slow']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const alive = unit => unit.hp > 0 && !unit.escaped;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const segments = DEFENSE_PATH.slice(1).map((point, index) => distance(point, DEFENSE_PATH[index]));
const routeLength = segments.reduce((sum, value) => sum + value, 0);
const teamOf = (b, unit) => unit.side === 'ally' ? b.allies : b.enemies;
const foesOf = (b, unit) => unit.side === 'ally' ? b.enemies : b.allies;
const has = (unit, type) => unit.statuses.some(status => status.type === type && status.duration > 0);
const valueOf = (unit, type) => unit.statuses.filter(status => status.type === type && status.duration > 0).reduce((max, status) => Math.max(max, status.amount || 0), 0);
const pointOf = unit => ({ x: unit.x, y: unit.y });
const random = b => clamp(Number(b.rng()) || 0, 0, 0.999999999999);

export const defenseSkillCooldown = skill => skill.cooldown ? Math.max(2.5, skill.cooldown * 2.5) : 0;
export const defenseStatusDuration = effect => Math.max(0, Number(effect.duration) || 0) * 2;
export function defensePointAt(progress) {
  let remaining = clamp(Number(progress) || 0, 0, 1) * routeLength;
  for (let i = 0; i < segments.length; i++) {
    if (remaining <= segments[i]) {
      const t = remaining / segments[i], a = DEFENSE_PATH[i], z = DEFENSE_PATH[i + 1];
      return { x: a.x + (z.x - a.x) * t, y: a.y + (z.y - a.y) * t };
    }
    remaining -= segments[i];
  }
  return { ...DEFENSE_PATH.at(-1) };
}

function seeded(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function log(b, message) {
  b.log.unshift(message);
  b.log.length = Math.min(14, b.log.length);
}
function emit(b, kind, source, targets, text, extra = {}) {
  b.effects.push({ id: `${b.id}-fx-${++b.eventSequence}`, kind, color: source?.color || '#efd696',
    sourceId: source?.id || null, targetIds: targets.map(target => target.id),
    source: source ? pointOf(source) : null, targets: targets.map(pointOf), text,
    animation: `${source?.characterId || 'defense'}-${kind}`, age: 0, life: 1.1, ...extra });
  if (b.effects.length > 80) b.effects.splice(0, b.effects.length - 80);
}
function makeUnit(characterId, side, copies = 1) {
  const character = CHARACTER_BY_ID[characterId], stats = statsFor(characterId, copies);
  const range = characterId === 'usopp' ? 280 : character.role === 'Healer' ? 275 : character.role === 'Controller' ? 240 : character.role === 'Guardian' ? 190 : 205;
  return { id: `ally-${characterId}`, characterId, name: character.name, stars: character.stars, role: character.role,
    side, color: character.color, ...stats, hp: stats.maxHp, energy: 45, maxEnergy: 100, shield: 0,
    x: 0, y: 0, padId: null, range, radius: 22, skills: character.skills,
    passive: character.passive, passiveUsed: false, attacksMade: 0, alive: true, statuses: [],
    cooldowns: Object.fromEntries(character.skills.map(skill => [skill.id, 0])),
    attackInterval: clamp(1.5 - (stats.speed - 42) * 0.014, 0.95, 1.5), actionTimer: 0,
    regenerationTimer: 0, progress: 0, escaped: false };
}

export function createDefense(collection, options = {}) {
  const encounterId = options.encounter ?? 1;
  if (!Array.isArray(collection?.team) || collection.team.length !== 5 || new Set(collection.team).size !== 5 ||
      !collection.team.every(id => typeof id === 'string' && Object.hasOwn(CHARACTER_BY_ID, id) && collection.cards?.[id]?.copies >= 1) ||
      !Number.isInteger(encounterId) || encounterId < 1 || encounterId > 9 || encounterId > collection.unlockedEncounter) return null;
  const seed = options.seed ?? 1;
  const b = { id: `crew-defense-${encounterId}-${seed}`, seed, rng: seeded(seed), collection,
    encounter: DEFENSE_STAGES[encounterId - 1], round: 1, waveCount: 3, status: 'setup',
    allies: collection.team.map(id => makeUnit(id, 'ally', collection.cards[id].copies)), enemies: [],
    ship: { id: 'ship', x: 950, y: 485, hp: 360, maxHp: 360, color: '#e1c087' },
    elapsed: 0, waveTime: 0, accumulator: 0, spawnTotal: 8, spawned: 0, remainingToSpawn: 8,
    spawnTimer: 0, defeatedThisWave: 0, leakedThisWave: 0, waveProgress: 0,
    effects: [], log: [], eventSequence: 0, pendingOutcome: null, learning: null, learningBoost: null,
    rewardedRounds: [], roundResults: [], outcomeCommitted: false,
    stats: { damageDealt: 0, kills: 0, leaks: 0, skillsUsed: 0, turns: 0, waves: 0, rounds: 0, simulatedSeconds: 0 } };
  for (let i = 0; i < b.allies.length; i++) Object.assign(b.allies[i], pointOf(DEFENSE_PADS[i]), { padId: DEFENSE_PADS[i].id });
  for (const unit of b.allies) {
    if (unit.passive.type === 'shield-start') unit.shield += Math.round(unit.maxHp * unit.passive.value);
    if (['all-shield', 'apex-whitebeard'].includes(unit.passive.type)) for (const ally of b.allies) ally.shield += Math.round(ally.maxHp * unit.passive.value);
  }
  log(b, 'Place your five crew members beside the route, then start wave 1.');
  return b;
}

export function placeDefender(b, allyId, padId) {
  if (!b || !['setup', 'learning'].includes(b.status) || b.pendingOutcome) return false;
  const unit = b.allies.find(ally => ally.id === allyId), pad = DEFENSE_PADS.find(entry => entry.id === padId);
  if (!unit || !pad) return false;
  const occupied = b.allies.find(ally => ally !== unit && ally.padId === padId);
  if (occupied) {
    const previous = DEFENSE_PADS.find(entry => entry.id === unit.padId);
    if (!previous) return false;
    Object.assign(occupied, pointOf(previous), { padId: previous.id });
  }
  Object.assign(unit, pointOf(pad), { padId: pad.id });
  return true;
}

export function startDefenseWave(b) {
  if (!b || b.status !== 'setup' || b.ship.hp <= 0 || b.round > b.waveCount || new Set(b.allies.map(unit => unit.padId)).size !== 5 ||
      !b.allies.every(unit => DEFENSE_PADS.some(pad => pad.id === unit.padId))) return false;
  b.status = 'running'; b.waveTime = 0; b.accumulator = 0; b.spawned = 0;
  b.spawnTotal = 6 + b.round * 2; b.remainingToSpawn = b.spawnTotal;
  b.spawnTimer = 0.6; b.enemies = []; b.defeatedThisWave = 0; b.leakedThisWave = 0; b.waveProgress = 0;
  b.learning = null; b.pendingOutcome = null;
  for (const unit of b.allies) {
    unit.actionTimer = 0; unit.regenerationTimer = 0;
    if (unit.passive.type === 'all-regen' && alive(unit)) for (const ally of b.allies.filter(alive)) heal(b, unit, ally, ally.maxHp * unit.passive.value);
    if (unit.passive.type === 'all-energy' && alive(unit)) for (const ally of b.allies.filter(alive)) ally.energy = Math.min(100, ally.energy + unit.passive.value);
  }
  log(b, `Wave ${b.round} of ${b.waveCount}: ${b.spawnTotal} raiders incoming${b.round === 3 ? ', including the captain' : ''}.`);
  return true;
}

function spawnEnemy(b) {
  // The captain leads the last reinforcements, so the final wave does not
  // become a long wait for one slow boss after every ordinary raider is gone.
  const index = b.spawned, boss = b.round === 3 && index === b.spawnTotal - 4;
  const roster = b.encounter.enemies;
  const id = boss ? roster[0] : roster[(index + b.round - 1) % roster.length];
  const unit = makeUnit(id, 'enemy');
  const scale = b.encounter.scale * (1 + (b.round - 1) * 0.12);
  unit.id = `raider-${b.round}-${index}-${id}`;
  unit.maxHp = unit.hp = Math.round(unit.maxHp * 1.7 * scale * (boss ? 2.3 : 1));
  unit.attack = Math.round(unit.attack * scale * (boss ? 0.68 : 0.37));
  unit.defense = Math.round(unit.defense * scale);
  unit.range = boss ? 245 : index % 3 === 1 ? 215 : 140;
  unit.attackInterval = boss ? 1.9 : 2.6;
  unit.actionTimer = 0.7; unit.energy = boss ? 65 : 30;
  unit.moveSpeed = (boss ? 54 : 72 + (index % 3) * 5) * (1 + (b.encounter.id - 1) * 0.012);
  unit.boss = boss; unit.leakDamage = boss ? 110 : 35;
  Object.assign(unit, defensePointAt(0));
  if (unit.passive.type === 'shield-start') unit.shield = Math.round(unit.maxHp * unit.passive.value);
  b.enemies.push(unit); b.spawned++; b.remainingToSpawn = Math.max(0, b.spawnTotal - b.spawned);
  if (boss) { log(b, `${unit.name} leads the final assault!`); emit(b, 'boss', unit, [unit], 'Captain incoming', { life: 2 }); }
}

function boostOf(b) {
  return b.learningBoost?.round === b.round && b.status === 'running' ? b.learningBoost : null;
}
function heal(b, source, target, amount) {
  if (!alive(target)) return 0;
  const restored = Math.min(target.maxHp - target.hp, Math.max(0, Math.round(amount)));
  target.hp += restored;
  if (restored) emit(b, 'heal', source, [target], `+${restored}`, { amount: restored });
  return restored;
}
function knockedOut(b, unit, source) {
  if (unit.hp > 0) return;
  if (!unit.passiveUsed && ['stubborn', 'revive-self'].includes(unit.passive.type)) {
    unit.passiveUsed = true; unit.hp = Math.max(1, Math.round(unit.maxHp * unit.passive.value));
    unit.alive = true; unit.statuses = [];
    emit(b, 'revive', unit, [unit], unit.passive.name);
    return;
  }
  unit.hp = 0; unit.alive = false; unit.shield = 0; unit.statuses = [];
  if (unit.side === 'enemy') { b.stats.kills++; b.defeatedThisWave++; }
  emit(b, 'knockout', source, [unit], unit.side === 'enemy' ? 'Stopped' : 'Crew down');
}
function damage(b, source, target, amount, direct = true) {
  if (!alive(target)) return 0;
  let total = Math.max(0, Math.round(amount * (source?.side === 'ally' ? boostOf(b)?.attackMultiplier || 1 : 1)));
  if (direct && target.shield > 0) {
    const absorbed = Math.min(total, target.shield); target.shield -= absorbed; total -= absorbed;
    if (absorbed) emit(b, 'shield', target, [target], `${absorbed} blocked`, { amount: absorbed });
  }
  const actual = Math.min(target.hp, total);
  target.hp = Math.max(0, target.hp - total);
  if (source?.side === 'ally' && target.side === 'enemy') b.stats.damageDealt += actual;
  if (actual) emit(b, 'damage', source, [target], `${actual}`, { amount: actual });
  if (target.hp <= 0) knockedOut(b, target, source);
  return actual;
}
function directDamage(b, actor, target, skill) {
  if (target.passive.type === 'evade' && random(b) < target.passive.value) { emit(b, 'wind', target, [target], 'Evaded'); return 0; }
  let multiplier = Math.max(0.1, 1 + valueOf(actor, 'attack-up') - valueOf(actor, 'weaken'));
  for (const ally of teamOf(b, actor).filter(alive)) if (ally.passive.type === 'all-attack' && distance(actor, ally) <= ally.range) multiplier += ally.passive.value;
  if (actor.passive.type === 'execute' && target.hp < target.maxHp * 0.5) multiplier *= 1 + actor.passive.value;
  if (actor.passive.type === 'focus') multiplier *= 1 + Math.min(6, actor.attacksMade) * actor.passive.value;
  if (actor.passive.type === 'apex-whitebeard' && actor.hp < actor.maxHp * 0.5) multiplier *= 1.2;
  if (actor.passive.type === 'apex-akainu' && has(target, 'burn')) multiplier *= 1 + actor.passive.value;
  const pierce = skill.effects.some(effect => effect.type === 'pierce') ? 1 : actor.passive.type === 'pierce' ? actor.passive.value : 0;
  const bonus = boostOf(b), criticalChance = Math.min(0.75, 0.07 + (actor.passive.type === 'crit' ? actor.passive.value : 0) + (actor.side === 'ally' ? bonus?.critBonus || 0 : 0));
  const critical = random(b) < criticalChance;
  const defense = target.defense * (target.side === 'ally' ? bonus?.defenseMultiplier || 1 : 1);
  let amount = Math.max(3, actor.attack * skill.power * multiplier - defense * (1 - pierce) * 0.45);
  if (critical) amount *= 1.55;
  amount *= 1 - valueOf(target, 'guard');
  if (['defense', 'apex-kaido'].includes(target.passive.type)) amount *= 1 - target.passive.value;
  if (target.passive.type === 'low-health-defense' && target.hp < target.maxHp * 0.5) amount *= 1 - target.passive.value;
  for (const ally of teamOf(b, target).filter(alive)) if (ally.passive.type === 'all-guard' && distance(ally, target) <= ally.range) amount *= 1 - ally.passive.value;
  const actual = damage(b, actor, target, amount);
  if (critical && actual) emit(b, 'light', actor, [target], 'Critical!', { critical: true });
  if (actor.passive.type === 'lifesteal') heal(b, actor, actor, actual * actor.passive.value);
  if (actor.passive.type === 'shield-on-hit' && actual) actor.shield = Math.min(actor.maxHp, actor.shield + Math.round(actor.attack * actor.passive.value));
  if (target.passive.type === 'counter' && actual && alive(actor) && alive(target)) damage(b, target, actor, target.attack * target.passive.value);
  return actual;
}

function addStatus(b, actor, target, descriptor) {
  if (!alive(target)) return;
  const type = descriptor.type;
  if (type === 'burn' && ['burn-immune', 'apex-akainu'].includes(target.passive.type) ||
      type === 'poison' && target.passive.type === 'poison-immune' || type === 'freeze' && target.passive.type === 'freeze-immune') return;
  if (descriptor.chance !== undefined && random(b) >= descriptor.chance) return;
  let duration = defenseStatusDuration(descriptor);
  if (negative.has(type) && actor.passive.type === 'debuff-duration' && !actor.passiveUsed && actor.side !== target.side) { duration += 2; actor.passiveUsed = true; }
  const amount = ['burn', 'poison', 'regen'].includes(type) ? actor.attack * descriptor.amount * 0.5 : descriptor.amount;
  const existing = target.statuses.find(status => status.type === type);
  if (existing) { existing.duration = Math.max(existing.duration, duration); existing.amount = Math.max(existing.amount, amount); existing.sourceId = actor.id; }
  else target.statuses.push({ type, amount, duration, tickTimer: 1, sourceId: actor.id });
  emit(b, type, actor, [target], type.replaceAll('-', ' '));
}
function effectRecipients(b, actor, targets, effect) {
  if (effect.scope === 'self') return [actor];
  if (effect.scope === 'all-allies') return teamOf(b, actor).filter(unit => alive(unit) && distance(actor, unit) <= actor.range);
  return targets;
}
function applyEffect(b, actor, targets, effect, damageTotal) {
  if (effect.type === 'pierce') return;
  if (effect.type === 'lifesteal') { heal(b, actor, actor, damageTotal * effect.amount); return; }
  for (const target of effectRecipients(b, actor, targets, effect)) {
    const healing = actor.passive.type === 'healing' ? 1 + actor.passive.value : 1;
    if (effect.type === 'revive') {
      if (alive(target) || target.escaped) continue;
      target.hp = Math.max(1, Math.min(target.maxHp, Math.round(target.maxHp * effect.amount * healing)));
      target.alive = true; target.statuses = []; target.actionTimer = 0.5;
      emit(b, 'revive', actor, [target], 'Back on your feet');
      continue;
    }
    if (!alive(target)) continue;
    if (effect.type === 'heal') heal(b, actor, target, actor.attack * effect.amount * healing);
    else if (effect.type === 'shield') {
      const amount = Math.min(target.maxHp - target.shield, Math.round(actor.attack * effect.amount));
      target.shield += amount;
      if (amount) emit(b, 'shield', actor, [target], `+${amount}`, { amount });
    } else if (effect.type === 'cleanse') { target.statuses = target.statuses.filter(status => !negative.has(status.type)); emit(b, 'heal', actor, [target], 'Cleansed'); }
    else if (effect.type === 'energy') target.energy = Math.min(100, target.energy + effect.amount);
    else if (effect.type === 'drain') { const amount = Math.min(target.energy, effect.amount); target.energy -= amount; actor.energy = Math.min(100, actor.energy + amount); }
    else addStatus(b, actor, target, effect);
  }
}

export function getDefenseTargets(b, actor, skill) {
  if (!b || !actor || !skill) return [];
  if (skill.target === 'self') return alive(actor) ? [actor] : [];
  const friendly = ['ally', 'all-allies', 'fallen-ally'].includes(skill.target);
  let targets = (friendly ? teamOf(b, actor) : foesOf(b, actor)).filter(unit =>
    (skill.target === 'fallen-ally' ? unit.hp <= 0 && !unit.escaped : alive(unit)) && distance(actor, unit) <= actor.range + 0.00001);
  if (!friendly && skill.target === 'enemy') {
    const taunting = targets.filter(target => has(target, 'taunt'));
    if (taunting.length) targets = taunting;
  }
  return targets;
}
function chooseSkill(b, actor) {
  let best = null;
  for (const skill of actor.skills) {
    if (actor.energy < skill.cost || (actor.cooldowns[skill.id] || 0) > 0) continue;
    const valid = getDefenseTargets(b, actor, skill);
    for (const target of valid) {
      const targets = skill.target.startsWith('all-') ? valid : [target];
      let score = 0;
      if (skill.power) for (const enemy of targets) {
        const expected = Math.max(3, actor.attack * skill.power - enemy.defense * 0.45);
        const hpDamage = Math.max(0, expected - enemy.shield);
        score += Math.min(enemy.hp + enemy.shield, expected) * (actor.side === 'ally' ? 1 + enemy.progress * 0.7 : 1);
        if (hpDamage >= enemy.hp) score += actor.attack;
      }
      for (const effect of skill.effects) for (const recipient of effectRecipients(b, actor, targets, effect)) {
        const sameSide = recipient.side === actor.side;
        if (effect.type === 'revive' && !alive(recipient)) score += 10000;
        if (effect.type === 'heal') score += Math.min(recipient.maxHp - recipient.hp, actor.attack * effect.amount) * (recipient.hp / recipient.maxHp < 0.4 ? 3 : 1.5);
        if (effect.type === 'cleanse') score += recipient.statuses.filter(status => negative.has(status.type)).length * actor.attack * 0.6;
        if (effect.type === 'shield' && foesOf(b, actor).some(enemy => alive(enemy) && distance(enemy, recipient) <= enemy.range + 50)) score += Math.max(0, Math.min(actor.attack * effect.amount, recipient.maxHp * 0.4 - recipient.shield)) * 0.9;
        if (['attack-up', 'guard', 'regen', 'taunt'].includes(effect.type) && !has(recipient, effect.type) && foesOf(b, actor).some(enemy => alive(enemy) && distance(actor, enemy) <= actor.range)) score += actor.attack * 0.4;
        if (negative.has(effect.type) && !has(recipient, effect.type)) score += actor.attack * (sameSide ? -0.35 : 0.25) * (effect.chance ?? 1);
        if (effect.type === 'energy') score += Math.min(effect.amount, 100 - recipient.energy) * 0.35;
        if (effect.type === 'pierce') score += recipient.defense * 0.35;
        if (effect.type === 'lifesteal') score += Math.min(actor.maxHp - actor.hp, actor.attack * skill.power * effect.amount);
      }
      score -= skill.cost * 0.12;
      if (!best || score > best.score) best = { skill, targets, score };
    }
  }
  return best && best.score > 0 ? best : null;
}
function attack(b, actor) {
  const action = chooseSkill(b, actor);
  if (!action) return false;
  const { skill, targets } = action;
  actor.energy -= skill.cost; actor.cooldowns[skill.id] = defenseSkillCooldown(skill); actor.actionTimer = actor.attackInterval;
  emit(b, skill.kind, actor, targets, skill.name, { skillId: skill.id, animation: skill.animation, color: skill.color });
  let total = 0;
  if (skill.power) {
    for (const target of targets) { if (!alive(actor)) break; total += directDamage(b, actor, target, skill); }
    actor.attacksMade++;
  }
  if (alive(actor)) for (const effect of skill.effects) applyEffect(b, actor, targets, effect, total);
  if (skill.id.endsWith('-0')) actor.energy = Math.min(100, actor.energy + 12);
  b.stats.skillsUsed++; b.stats.turns++;
  return true;
}

function tickUnit(b, unit) {
  if (!alive(unit)) return;
  unit.actionTimer = Math.max(0, unit.actionTimer - STEP);
  unit.energy = Math.min(100, unit.energy + STEP * (4 + (unit.passive.type === 'energy' ? unit.passive.value * 0.6 : 0)));
  for (const id of Object.keys(unit.cooldowns)) unit.cooldowns[id] = Math.max(0, unit.cooldowns[id] - STEP);
  unit.regenerationTimer += STEP;
  if (unit.regenerationTimer >= 4 - 1e-9) {
    unit.regenerationTimer -= 4;
    if (unit.passive.type === 'regen') heal(b, unit, unit, unit.maxHp * unit.passive.value);
    if (unit.passive.type === 'apex-kaido') heal(b, unit, unit, unit.maxHp * 0.04);
  }
  for (const status of [...unit.statuses]) {
    if (!unit.statuses.includes(status) || !alive(unit)) continue;
    status.duration -= STEP;
    if (['burn', 'poison', 'regen'].includes(status.type)) {
      status.tickTimer -= STEP;
      if (status.tickTimer <= 1e-9) {
        status.tickTimer += 1;
        const source = [...b.allies, ...b.enemies].find(candidate => candidate.id === status.sourceId);
        if (status.type === 'regen') heal(b, source || unit, unit, status.amount);
        else damage(b, source, unit, status.amount, false);
      }
    }
  }
  unit.statuses = unit.statuses.filter(status => status.duration > 1e-9);
}
function gate(b, outcome = null) {
  if (b.status !== 'running') return;
  b.status = 'learning'; b.pendingOutcome = outcome; b.learningBoost = null; b.accumulator = 0;
  b.learning = { round: b.round, required: 3, completed: false };
  b.stats.waves++; b.stats.rounds++; b.waveProgress = 1;
  log(b, `${outcome === 'defeat' ? 'The ship was overwhelmed.' : `Wave ${b.round} complete.`} Answer exactly three questions before continuing.`);
}
function fixedStep(b) {
  b.elapsed += STEP; b.waveTime += STEP; b.stats.simulatedSeconds += STEP;
  for (const effect of b.effects) effect.age += STEP;
  b.effects = b.effects.filter(effect => effect.age < effect.life);
  if (b.ship.hp <= 0) { gate(b, 'defeat'); return; }
  b.spawnTimer -= STEP;
  if (b.spawned < b.spawnTotal && b.spawnTimer <= 1e-9) {
    spawnEnemy(b);
    b.spawnTimer += [0, 2.5, 2.2, 1.85][b.round];
  }
  for (const unit of [...b.allies, ...b.enemies]) tickUnit(b, unit);
  for (const enemy of b.enemies.filter(alive)) {
    if (has(enemy, 'stun') || has(enemy, 'freeze')) continue;
    enemy.progress = Math.min(1, enemy.progress + enemy.moveSpeed * (1 - Math.min(0.8, valueOf(enemy, 'slow'))) * STEP / routeLength);
    Object.assign(enemy, defensePointAt(enemy.progress));
    if (enemy.progress >= 1) {
      enemy.escaped = true; enemy.alive = false;
      b.ship.hp = Math.max(0, b.ship.hp - enemy.leakDamage); b.stats.leaks++; b.leakedThisWave++;
      emit(b, 'leak', enemy, [b.ship], `Ship −${enemy.leakDamage}`, { amount: enemy.leakDamage });
      if (b.ship.hp <= 0) { gate(b, 'defeat'); return; }
    }
  }
  for (const unit of [...b.allies, ...b.enemies]) if (alive(unit) && unit.actionTimer <= 1e-9 && !has(unit, 'stun') && !has(unit, 'freeze')) attack(b, unit);
  b.remainingToSpawn = Math.max(0, b.spawnTotal - b.spawned);
  const resolved = b.enemies.filter(enemy => !alive(enemy)).length;
  b.waveProgress = Math.min(1, resolved / b.spawnTotal);
  if (b.spawned >= b.spawnTotal && !b.enemies.some(alive)) gate(b, b.round === b.waveCount ? 'victory' : null);
}

export function advanceDefense(b, deltaSeconds) {
  if (!b || b.status !== 'running' || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return false;
  b.accumulator += Math.min(0.25, deltaSeconds);
  let steps = 0;
  while (b.accumulator + 1e-9 >= STEP && b.status === 'running') {
    b.accumulator = Math.max(0, b.accumulator - STEP); fixedStep(b); steps++;
  }
  return steps > 0;
}

export function completeDefenseLearning(b, answer = {}) {
  if (!b || b.status !== 'learning' || !b.learning || b.learning.completed || b.rewardedRounds.includes(b.round) ||
      answer.total !== 3 || !Number.isInteger(answer.correct) || answer.correct < 0 || answer.correct > 3 ||
      answer.round !== b.round) return false;
  b.learning.completed = true; b.rewardedRounds.push(b.round);
  b.collection.stats.correctAnswers += answer.correct;
  b.learningBoost = !b.pendingOutcome && answer.correct > 0 ? {
    correct: answer.correct, round: b.round + 1, attackMultiplier: 1 + answer.correct * 0.1,
    critBonus: answer.correct * 0.05, defenseMultiplier: 1 + answer.correct * 0.08,
  } : null;
  const result = { round: b.round, correct: answer.correct, total: 3, packsEarned: 0,
    outcome: b.pendingOutcome, boost: b.learningBoost ? { ...b.learningBoost } : null,
    recovery: 0.25 + answer.correct * 0.04, energyGranted: answer.correct * 3 };
  b.roundResults.push(result);
  if (b.pendingOutcome) {
    b.status = b.pendingOutcome;
    if (!b.outcomeCommitted) {
      b.outcomeCommitted = true;
      if (b.status === 'victory') {
        const collection = b.collection;
        collection.stats.victories++;
        if (!collection.completed.includes(b.encounter.id)) collection.completed.push(b.encounter.id);
        collection.completed.sort((a, z) => a - z);
        collection.unlockedEncounter = Math.max(collection.unlockedEncounter, Math.min(9, b.encounter.id + 1));
        log(b, b.encounter.id === DEFENSE_STAGES.length ? 'The ship is safe. All nine harbors are defended!' : 'The ship is safe. The next harbor is unlocked.');
      } else log(b, 'Regroup your crew and try the harbor again.');
    }
    return result;
  }
  for (const unit of b.allies) {
    unit.hp = Math.min(unit.maxHp, Math.max(unit.hp, unit.maxHp * 0.35) + Math.round(unit.maxHp * result.recovery));
    unit.alive = true; unit.statuses = []; unit.energy = Math.min(100, Math.max(45, unit.energy) + result.energyGranted);
    unit.cooldowns = Object.fromEntries(unit.skills.map(skill => [skill.id, 0]));
  }
  b.ship.hp = Math.min(b.ship.maxHp, b.ship.hp + answer.correct * 6);
  b.round++; b.status = 'setup'; b.accumulator = 0; b.learning = null;
  b.spawnTotal = 6 + b.round * 2; b.remainingToSpawn = b.spawnTotal; b.spawned = 0; b.waveProgress = 0;
  log(b, `${answer.correct}/3 correct. Reposition your crew and start wave ${b.round}.`);
  return result;
}

export { CHARACTERS, CHARACTER_BY_ID };
