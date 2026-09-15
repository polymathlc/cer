import { CHARACTERS, CHARACTER_BY_ID, ENCOUNTERS } from './grand-line-data.js?v=3.0.0';
import { statsFor } from './grand-line-core.js?v=3.0.0';
import { getDefenseProfile, getDefenseSkillProfile } from './grand-line-defense-profiles.js?v=3.0.0';
export { getDefenseProfile, getDefenseSkillProfile } from './grand-line-defense-profiles.js?v=3.0.0';
import { DEFENSE_GRID, DEFENSE_PATH, DEFENSE_PADS, DEFENSE_DEFAULT_PADS, DEFENSE_TERRAIN, defenseCell,
  pointOnDefenseRoute, commitDefenseRoute, planDefenseRoute, getMazePlacementPreview,
  MAZE_TOWER_COST, MAZE_TOWER_REFUND, MAX_MAZE_TOWERS } from './grand-line-defense-grid.js?v=3.0.0';
export { DEFENSE_GRID, DEFENSE_PATH, DEFENSE_PADS, DEFENSE_DEFAULT_PADS, DEFENSE_TERRAIN,
  getDefenseRoute, getMazePlacementPreview, MAZE_TOWER_COST, MAZE_TOWER_REFUND, MAX_MAZE_TOWERS } from './grand-line-defense-grid.js?v=3.0.0';
export const DEFENSE_STAGES = Object.freeze(ENCOUNTERS.map(encounter => ({
  ...encounter, waveCount: 6, description: `Build a maze at ${encounter.name}. Slow the swarm, summon your collection and train your crew after three questions each wave.`,
})));

const STEP = 0.05;
const negative = new Set(['stun', 'freeze', 'burn', 'poison', 'weaken', 'slow']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const alive = unit => unit.hp > 0 && !unit.escaped;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const teamOf = (b, unit) => unit.side === 'ally' ? b.allies : b.enemies;
const foesOf = (b, unit) => unit.side === 'ally' ? b.enemies : b.allies;
const has = (unit, type) => unit.statuses.some(status => status.type === type && status.duration > 0);
const valueOf = (unit, type) => unit.statuses.filter(status => status.type === type && status.duration > 0).reduce((max, status) => Math.max(max, status.amount || 0), 0);
const pointOf = unit => ({ x: unit.x, y: unit.y });
const random = b => clamp(Number(b.rng()) || 0, 0, 0.999999999999);

export const defenseSkillCooldown = skill => skill.cooldown ? Math.max(2.5, skill.cooldown * 2.5) : 0;
export const defenseStatusDuration = effect => Math.max(0, Number(effect.duration) || 0) * 2;
export function defensePointAt(progress, battle) { return pointOnDefenseRoute(progress, battle); }
export function defenseEnemyPointAt(progress, laneOffset = 0, battle) {
  const point = defensePointAt(progress, battle);
  if (!laneOffset) return point;
  const before = defensePointAt(progress - .001, battle), after = defensePointAt(progress + .001, battle);
  const length = distance(before, after) || 1;
  return { x: point.x - (after.y - before.y) / length * laneOffset,
    y: point.y + (after.x - before.x) / length * laneOffset };
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
  const profile = getDefenseProfile(characterId), range = profile.range;
  return { id: `ally-${characterId}`, characterId, name: character.name, stars: character.stars, role: character.role,
    side, color: character.color, ...stats, hp: stats.maxHp, energy: 45, maxEnergy: 100, shield: 0,
    x: 0, y: 0, padId: null, range, radius: 22, skills: character.skills,
    profile, level: 1, specialization: null, priority: 'first', summonCost: 20 + character.stars * 5,
    paidSupplies: 0, baseStats: { ...stats }, baseRange: range,
    passive: character.passive, passiveUsed: false, attacksMade: 0, alive: true, statuses: [],
    cooldowns: Object.fromEntries(character.skills.map(skill => [skill.id, 0])),
    attackInterval: clamp(1.5 - (stats.speed - 42) * 0.014, 0.95, 1.5), actionTimer: 0,
    regenerationTimer: 0, progress: 0, escaped: false };
}

export function createDefense(collection, options = {}) {
  const encounterId = options.encounter ?? 1;
  if (!collection?.cards || !Array.isArray(collection?.team) || collection.team.length < 1 || collection.team.length > 10 || new Set(collection.team).size !== collection.team.length ||
      !collection.team.every(id => typeof id === 'string' && Object.hasOwn(CHARACTER_BY_ID, id) && collection.cards?.[id]?.copies >= 1) ||
      !Number.isInteger(encounterId) || encounterId < 1 || encounterId > 9 || encounterId > collection.unlockedEncounter) return null;
  const seed = options.seed ?? 1;
  const b = { id: `crew-defense-${encounterId}-${seed}`, seed, rng: seeded(seed), collection,
    encounter: DEFENSE_STAGES[encounterId - 1], round: 1, waveCount: 6, status: 'setup',
    allies: collection.team.map(id => makeUnit(id, 'ally', collection.cards[id].copies)), enemies: [],
    ship: { id: 'ship', x: 1100, y: 310, hp: 360, maxHp: 360, color: '#e1c087' },
    mazeTowers: [], terrain: [...DEFENSE_TERRAIN[encounterId - 1]], route: [], routeCellIds: [], routeRevision: 0,
    elapsed: 0, waveTime: 0, accumulator: 0, spawnTotal: 80, spawned: 0, remainingToSpawn: 80,
    spawnTimer: 0, defeatedThisWave: 0, leakedThisWave: 0, waveProgress: 0,
    effects: [], projectiles: [], supplies: 100, trainingPoints: 0, reserve: {}, log: [], eventSequence: 0, pendingOutcome: null, learning: null, learningBoost: null,
    rewardedRounds: [], roundResults: [], outcomeCommitted: false,
    stats: { damageDealt: 0, kills: 0, leaks: 0, skillsUsed: 0, turns: 0, waves: 0, rounds: 0, simulatedSeconds: 0 } };
  for (let i = 0; i < b.allies.length; i++) Object.assign(b.allies[i], pointOf(DEFENSE_DEFAULT_PADS[i]), { padId: DEFENSE_DEFAULT_PADS[i].id });
  if (!commitDefenseRoute(b)) return null;
  for (const unit of b.allies) {
    if (unit.passive.type === 'shield-start') unit.shield += Math.round(unit.maxHp * unit.passive.value);
    if (['all-shield', 'apex-whitebeard'].includes(unit.passive.type)) for (const ally of b.allies) ally.shield += Math.round(ally.maxHp * unit.passive.value);
  }
  log(b, 'Build 5-supply towers to bend the enemy route. Your saved crew deploys free; every placement must leave an exit.');
  return b;
}

const editable = b => b?.status === 'setup' && !b.pendingOutcome;
export function summonDefender(b, characterId, padId) {
  if (!editable(b) || !Object.hasOwn(CHARACTER_BY_ID, characterId) || !(b.collection.cards?.[characterId]?.copies >= 1) ||
      b.allies.length >= 10 || b.allies.some(unit => unit.characterId === characterId || unit.padId === padId)) return false;
  const pad = DEFENSE_PADS.find(entry => entry.id === padId), cost = 20 + CHARACTER_BY_ID[characterId].stars * 5;
  if (!pad || b.supplies < cost || !getMazePlacementPreview(b, padId, { kind: 'crew' }).valid) return false;
  const previous = b.reserve[characterId], unit = previous || makeUnit(characterId, 'ally', b.collection.cards[characterId].copies);
  delete b.reserve[characterId];
  Object.assign(unit, pointOf(pad), { padId, paidSupplies: cost });
  b.supplies -= cost;
  if (!previous) {
    if (unit.passive.type === 'shield-start') unit.shield += Math.round(unit.maxHp * unit.passive.value);
    for (const ally of b.allies) if (['all-shield', 'apex-whitebeard'].includes(ally.passive.type)) unit.shield += Math.round(unit.maxHp * ally.passive.value);
    if (['all-shield', 'apex-whitebeard'].includes(unit.passive.type)) for (const ally of [...b.allies, unit]) ally.shield = Math.min(ally.maxHp, ally.shield + Math.round(ally.maxHp * unit.passive.value));
  }
  b.allies.push(unit);
  commitDefenseRoute(b);
  log(b, `${unit.name} summoned for ${cost} supplies.`);
  return true;
}
export function recallDefender(b, allyId) {
  if (!editable(b)) return false;
  const index = b.allies.findIndex(unit => unit.id === allyId);
  if (index < 0) return false;
  const [unit] = b.allies.splice(index, 1), refund = Math.floor(unit.paidSupplies / 2);
  b.supplies += refund; unit.padId = null; unit.paidSupplies = 0; b.reserve[unit.characterId] = unit;
  commitDefenseRoute(b);
  log(b, `${unit.name} recalled. ${refund} supplies returned; training is kept for this defense.`);
  return true;
}
export function buildMazeTower(b, cellId) {
  const preview = getMazePlacementPreview(b, cellId);
  if (!preview.valid) return false;
  const cell = preview.cell;
  b.mazeTowers.push({ id: `maze-${cellId}`, cellId, padId: cellId, x: cell.x, y: cell.y, name: 'Disruptor tower',
    side: 'ally', characterId: null, isMazeTower: true, color: '#9bb7a6', hp: 100, maxHp: 100, shield: 0,
    attack: 5, defense: 0, range: 108, attackInterval: 2.8, actionTimer: 0, slow: .12, statuses: [],
    passive: { type: 'none', value: 0 }, attacksMade: 0, energy: 0, alive: true, escaped: false,
    paidSupplies: MAZE_TOWER_COST, attackGeometry: { shape: 'single', speed: 380, rangeMultiplier: 1, width: 8, radius: 8 },
    towerSkill: { id: 'maze-bolt', name: 'Disruptor bolt', kind: 'wind', animation: 'maze-bolt', power: 1,
      effects: [{ type: 'slow', amount: .12, duration: .65 }] } });
  b.supplies -= MAZE_TOWER_COST; commitDefenseRoute(b);
  log(b, `Basic tower built for 5 supplies. Enemy route: ${b.routeCellIds.length} cells.`);
  return true;
}
export function sellMazeTower(b, cellId) {
  if (!getMazePlacementPreview(b, cellId, { remove: true }).valid) return false;
  const index = b.mazeTowers.findIndex(tower => tower.cellId === cellId);
  b.mazeTowers.splice(index, 1); b.supplies += MAZE_TOWER_REFUND; commitDefenseRoute(b);
  log(b, 'Basic tower sold. 3 supplies returned.'); return true;
}
function refreshTrainingStats(unit) {
  const base = unit.baseStats, healthRatio = unit.hp / unit.maxHp;
  unit.attack = Math.round(base.attack * (1 + (unit.level - 1) * .2) * (unit.specialization === 'power' ? 1.25 : 1));
  unit.maxHp = Math.round(base.maxHp * (1 + (unit.level - 1) * .15));
  unit.hp = Math.max(1, Math.round(unit.maxHp * healthRatio));
  unit.defense = Math.round(base.defense * (1 + (unit.level - 1) * .1));
  unit.range = Math.round(unit.baseRange * (unit.specialization === 'reach' ? 1.15 : 1));
  unit.attackInterval = clamp(1.5 - (base.speed - 42) * .014, .95, 1.5) * (unit.specialization === 'reach' ? .85 : 1);
}
export function upgradeDefender(b, allyId) {
  if (!editable(b)) return false;
  const unit = b.allies.find(ally => ally.id === allyId);
  if (!unit || unit.level >= 5 || b.trainingPoints < unit.level) return false;
  b.trainingPoints -= unit.level; unit.level++; refreshTrainingStats(unit);
  log(b, `${unit.name} trained to level ${unit.level}${unit.level === 3 ? ': choose Power or Reach' : ''}.`);
  return true;
}
export function specializeDefender(b, allyId, specialization) {
  if (!editable(b) || !['power', 'reach'].includes(specialization)) return false;
  const unit = b.allies.find(ally => ally.id === allyId);
  if (!unit || unit.level < 3 || unit.specialization) return false;
  unit.specialization = specialization; refreshTrainingStats(unit);
  log(b, `${unit.name} specializes in ${specialization === 'power' ? 'Power: damage and armor penetration' : 'Reach: range, wider attacks and faster skills'}.`);
  return true;
}
export function setDefensePriority(b, allyId, priority) {
  if (!b || !['setup', 'running'].includes(b.status) || !['first', 'strongest', 'cluster'].includes(priority)) return false;
  const unit = b.allies.find(ally => ally.id === allyId);
  if (!unit) return false;
  unit.priority = priority; return true;
}

const WAVE_PLANS = Object.freeze([
  { name: 'Landing party', pattern: ['swarm', 'swarm', 'swarm', 'raider', 'runner'], count: 80, tip: 'Build a detour beside your crew. Piercing lines and splash attacks clear the packed landing party.' },
  { name: 'Runner rush', pattern: ['runner', 'runner', 'swarm', 'swarm', 'raider'], count: 105, tip: 'Lengthen the route and use disruptor towers, slow or freeze to catch runners.' },
  { name: 'Iron convoy', pattern: ['armored', 'swarm', 'swarm', 'swarm', 'raider'], count: 130, tip: 'Keep armored enemies beside your Power specialists. Basic towers delay them but barely penetrate armor.' },
  { name: 'Crowded assault', pattern: ['swarm', 'swarm', 'swarm', 'runner', 'swarm', 'armored'], count: 160, tip: 'Create a winding corridor through radial and splash coverage. Leave a complete exit route.' },
  { name: 'Siege crossfire', pattern: ['armored', 'runner', 'swarm', 'raider', 'swarm'], count: 190, tip: 'Separate armor-breaking and cluster-clearing duties, with healers behind the maze.' },
  { name: 'Captain’s armada', pattern: ['armored', 'swarm', 'runner', 'swarm', 'raider'], count: 230, tip: 'A huge escort protects the captain. Aim Strongest at the captain and keep the maze inside your area attacks.' },
]);
function typeForWave(round, index, count) {
  if (round === 6 && index === Math.floor(count * .55)) return 'captain';
  const plan = WAVE_PLANS[round - 1]; return plan.pattern[index % plan.pattern.length];
}
export function getDefenseWavePreview(b) {
  if (!b || !Number.isInteger(b.round) || b.round < 1 || b.round > 6) return null;
  const plan = WAVE_PLANS[b.round - 1], counts = { swarm: 0, runner: 0, armored: 0, raider: 0, captain: 0 };
  for (let i = 0; i < plan.count; i++) counts[typeForWave(b.round, i, plan.count)]++;
  const labels = { swarm: 'Swarm', runner: 'Runners', armored: 'Armored', raider: 'Raiders', captain: 'Captain' };
  const groups = Object.entries(counts).filter(([, count]) => count).map(([type, count]) => ({ type, label: labels[type], count }));
  return { round: b.round, waveCount: 6, name: plan.name, title: plan.name, total: plan.count, count: plan.count, counts, tip: plan.tip,
    enemies: groups, groups };
}

export function placeDefender(b, allyId, padId) {
  if (!editable(b) || !getMazePlacementPreview(b, padId, { kind: 'crew', allyId }).valid) return false;
  const unit = b.allies.find(ally => ally.id === allyId), pad = DEFENSE_PADS.find(entry => entry.id === padId);
  if (!unit || !pad) return false;
  const occupied = b.allies.find(ally => ally !== unit && ally.padId === padId);
  if (occupied) {
    const previous = DEFENSE_PADS.find(entry => entry.id === unit.padId);
    if (!previous) return false;
    Object.assign(occupied, pointOf(previous), { padId: previous.id });
  }
  Object.assign(unit, pointOf(pad), { padId: pad.id });
  commitDefenseRoute(b);
  return true;
}

export function startDefenseWave(b) {
  if (!b || b.status !== 'setup' || b.ship.hp <= 0 || b.round > b.waveCount || b.allies.length < 1 || b.allies.length > 10 ||
      new Set(b.allies.map(unit => unit.padId)).size !== b.allies.length ||
      !b.allies.every(unit => DEFENSE_PADS.some(pad => pad.id === unit.padId))) return false;
  if (!planDefenseRoute(b) || !commitDefenseRoute(b)) return false;
  b.status = 'running'; b.waveTime = 0; b.accumulator = 0; b.spawned = 0;
  b.spawnTotal = getDefenseWavePreview(b).total; b.remainingToSpawn = b.spawnTotal;
  b.spawnTimer = 0.6; b.enemies = []; b.projectiles = []; b.defeatedThisWave = 0; b.leakedThisWave = 0; b.waveProgress = 0;
  b.learning = null; b.pendingOutcome = null;
  for (const unit of b.allies) {
    unit.actionTimer = 0; unit.regenerationTimer = 0;
    if (unit.passive.type === 'all-regen' && alive(unit)) for (const ally of b.allies.filter(alive)) heal(b, unit, ally, ally.maxHp * unit.passive.value);
    if (unit.passive.type === 'all-energy' && alive(unit)) for (const ally of b.allies.filter(alive)) ally.energy = Math.min(100, ally.energy + unit.passive.value);
  }
  log(b, `Wave ${b.round} of ${b.waveCount}: ${b.spawnTotal} enemies incoming${b.round === 6 ? ', including the captain' : ''}.`);
  return true;
}

function spawnEnemy(b) {
  // The captain leads the last reinforcements, so the final wave does not
  // become a long wait for one slow boss after every ordinary raider is gone.
  const index = b.spawned, enemyType = typeForWave(b.round, index, b.spawnTotal), boss = enemyType === 'captain';
  const roster = b.encounter.enemies;
  const id = boss ? roster[0] : roster[(index + b.round - 1) % roster.length];
  const unit = makeUnit(id, 'enemy');
  const scale = b.encounter.scale * (1 + (b.round - 1) * 0.18);
  unit.id = `raider-${b.round}-${index}-${id}`;
  unit.maxHp = unit.hp = Math.round(unit.maxHp * scale * ({ swarm: .19, runner: .27, armored: .95, raider: .42, captain: 4.2 }[enemyType]));
  unit.attack = Math.round(unit.attack * scale * (boss ? .32 : enemyType === 'raider' ? .07 : .025));
  unit.defense = Math.round(unit.defense * scale * (enemyType === 'armored' ? 4 : boss ? 2 : .5));
  unit.armor = enemyType === 'armored' ? .42 : boss ? .2 : 0;
  unit.range = boss ? 195 : enemyType === 'raider' ? 120 : 65;
  unit.attackInterval = boss ? 2.8 : 4.2;
  unit.actionTimer = 0.7; unit.energy = boss ? 65 : 30;
  unit.moveSpeed = ({ swarm: 70, runner: 112, armored: 48, raider: 63, captain: 40 }[enemyType]) * (1 + (b.encounter.id - 1) * .012);
  unit.boss = boss; unit.enemyType = unit.archetype = enemyType; unit.radius = boss ? 12 : enemyType === 'swarm' ? 5 : 7;
  unit.laneOffset = boss ? 0 : [-7, 4, -4, 7, 0][index % 5];
  unit.leakDamage = boss ? 95 : enemyType === 'armored' ? 10 : enemyType === 'runner' ? 5 : 3;
  unit.suppliesReward = boss ? 15 : enemyType === 'armored' ? 2 : 1;
  Object.assign(unit, defenseEnemyPointAt(0, unit.laneOffset, b));
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
  if (unit.side === 'enemy') { b.stats.kills++; b.defeatedThisWave++; b.supplies += unit.suppliesReward || 1; }
  emit(b, 'knockout', source, [unit], unit.side === 'enemy' ? 'Stopped' : 'Crew down');
}
function damage(b, source, target, amount, direct = true) {
  if (!alive(target) || target.isMazeTower) return 0;
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
  const pierce = Math.min(1, (skill.effects.some(effect => effect.type === 'pierce') ? 1 : actor.passive.type === 'pierce' ? actor.passive.value : 0) + (actor.specialization === 'power' ? .35 : 0));
  const bonus = boostOf(b), criticalChance = Math.min(0.75, 0.07 + (actor.passive.type === 'crit' ? actor.passive.value : 0) + (actor.side === 'ally' ? bonus?.critBonus || 0 : 0));
  const critical = random(b) < criticalChance;
  const defense = target.defense * (target.side === 'ally' ? bonus?.defenseMultiplier || 1 : 1);
  let amount = Math.max(3, actor.attack * skill.power * multiplier - defense * (1 - pierce) * 0.45);
  amount *= 1 - (target.armor || 0) * (1 - pierce);
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
  const geometry = getDefenseSkillProfile(actor, skill), range = actor.range * (!friendly ? geometry?.rangeMultiplier || 1 : 1);
  let targets = (friendly ? teamOf(b, actor) : foesOf(b, actor)).filter(unit =>
    (skill.target === 'fallen-ally' ? unit.hp <= 0 && !unit.escaped : alive(unit)) && distance(actor, unit) <= range + 0.00001);
  if (!friendly && skill.target === 'enemy') {
    const taunting = targets.filter(target => has(target, 'taunt'));
    if (taunting.length) targets = taunting;
  }
  return targets;
}

function direction(source, aim) {
  const length = distance(source, aim) || 1;
  return { x: (aim.x - source.x) / length, y: (aim.y - source.y) / length };
}
function inFootprint(unit, origin, aim, geometry, range) {
  const dx = unit.x - origin.x, dy = unit.y - origin.y, d = Math.hypot(dx, dy);
  if (geometry.shape === 'radial') return d <= Math.min(range, geometry.radius) + 1e-6;
  if (geometry.shape === 'splash') return distance(unit, aim) <= geometry.radius + 1e-6;
  const axis = direction(origin, aim), along = dx * axis.x + dy * axis.y;
  if (geometry.shape === 'line') return along >= 0 && along <= range + 1e-6 && Math.abs(dx * axis.y - dy * axis.x) <= geometry.width / 2 + 1e-6;
  if (geometry.shape === 'cone') return d <= range + 1e-6 && along >= d * Math.cos(geometry.angle) - 1e-6;
  return false;
}
function areaTargets(b, actor, skill, aim) {
  const geometry = getDefenseSkillProfile(actor, skill);
  if (!aim || !geometry) return [];
  const candidates = foesOf(b, actor).filter(alive), range = actor.range * geometry.rangeMultiplier;
  if (geometry.shape === 'single') return candidates.includes(aim) ? [aim] : [];
  if (geometry.shape === 'chain') {
    if (!candidates.includes(aim)) return [];
    const chain = [aim];
    while (chain.length < geometry.bounces) {
      const previous = chain.at(-1), next = candidates.filter(unit => !chain.includes(unit) && distance(unit, previous) <= geometry.chainRange)
        .sort((a, z) => distance(a, previous) - distance(z, previous) || a.id.localeCompare(z.id))[0];
      if (!next) break;
      chain.push(next);
    }
    return chain;
  }
  return candidates.filter(unit => inFootprint(unit, actor, aim, geometry, range));
}
function priorityTarget(b, actor, skill, valid = getDefenseTargets(b, actor, skill)) {
  const ordered = [...valid];
  if (actor.priority === 'strongest') ordered.sort((a, z) => z.maxHp - a.maxHp || z.progress - a.progress);
  else if (actor.priority === 'cluster') ordered.sort((a, z) => areaTargets(b, actor, skill, z).length - areaTargets(b, actor, skill, a).length || z.progress - a.progress);
  else ordered.sort((a, z) => (z.progress || 0) - (a.progress || 0) || a.id.localeCompare(z.id));
  return ordered[0] || null;
}
export function getDefenseAreaTargets(b, actor, skill, aimTarget) {
  if (!b || !actor || !skill) return [];
  if (['self', 'ally', 'all-allies', 'fallen-ally'].includes(skill.target)) {
    const valid = getDefenseTargets(b, actor, skill);
    return skill.target === 'all-allies' ? valid : aimTarget && valid.includes(aimTarget) ? [aimTarget] : valid.slice(0, 1);
  }
  return areaTargets(b, actor, skill, aimTarget || priorityTarget(b, actor, skill));
}
export function getDefenseAttackPreview(b, actor, skill = actor?.skills?.[0]) {
  if (!b || !actor || !skill) return null;
  const geometry = getDefenseSkillProfile(actor, skill), source = pointOf(actor);
  const aim = priorityTarget(b, actor, skill) || actor.lastAim || [...(b.route || DEFENSE_PATH)].sort((a, z) => distance(a, actor) - distance(z, actor))[0];
  return { shape: geometry.shape, geometry, source, target: pointOf(aim), aimTargetId: aim.id || null, range: actor.range * geometry.rangeMultiplier,
    width: geometry.width, radius: Math.min(actor.range * geometry.rangeMultiplier, geometry.radius), angle: geometry.angle,
    targetIds: getDefenseAreaTargets(b, actor, skill, aim).map(unit => unit.id) };
}

function chooseSkill(b, actor) {
  let best = null;
  for (const skill of actor.skills) {
    if (actor.energy < skill.cost || (actor.cooldowns[skill.id] || 0) > 0) continue;
    const valid = getDefenseTargets(b, actor, skill), friendly = ['self', 'ally', 'all-allies', 'fallen-ally'].includes(skill.target);
    const anchors = friendly ? valid : [priorityTarget(b, actor, skill, valid)].filter(Boolean);
    for (const target of anchors) {
      const targets = friendly ? skill.target.startsWith('all-') ? valid : [target] : areaTargets(b, actor, skill, target);
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
      if (!best || score > best.score) best = { skill, targets, aim: target, score };
    }
  }
  return best && best.score > 0 ? best : null;
}
function attack(b, actor) {
  const action = chooseSkill(b, actor);
  if (!action) return false;
  const { skill, targets, aim } = action;
  actor.energy -= skill.cost; actor.cooldowns[skill.id] = defenseSkillCooldown(skill) * (actor.specialization === 'reach' ? .85 : 1); actor.actionTimer = actor.attackInterval;
  if (skill.power && !['self', 'ally', 'all-allies', 'fallen-ally'].includes(skill.target)) {
    launchProjectile(b, actor, skill, aim); actor.attacksMade++;
  } else {
    emit(b, skill.kind, actor, targets, skill.name, { skillId: skill.id, animation: skill.animation, color: skill.color });
    for (const effect of skill.effects) applyEffect(b, actor, targets, effect, 0);
  }
  if (skill.id.endsWith('-0')) actor.energy = Math.min(100, actor.energy + 12);
  b.stats.skillsUsed++; b.stats.turns++;
  return true;
}

function launchProjectile(b, actor, skill, target) {
  const geometry = actor.attackGeometry || getDefenseSkillProfile(actor, skill), start = pointOf(actor), axis = direction(start, target);
  const range = actor.range * geometry.rangeMultiplier;
  const end = ['line', 'cone'].includes(geometry.shape) ? { x: start.x + axis.x * range, y: start.y + axis.y * range } : pointOf(target);
  const travel = geometry.shape === 'radial' ? Math.min(range, geometry.radius) : distance(start, end);
  const p = { id: `${b.id}-projectile-${++b.eventSequence}`, sourceId: actor.id, characterId: actor.characterId,
    skillId: skill.id, kind: skill.kind, animation: skill.animation, color: skill.color || actor.color, mazeTower: !!actor.isMazeTower,
    ...geometry, geometry, start, end, x: start.x, y: start.y, age: 0, duration: Math.max(.12, travel / geometry.speed),
    range, targetId: target.id, hitIds: [], actor, skill, damageTotal: 0, finished: false };
  actor.lastAim = pointOf(target); b.projectiles.push(p);
  emit(b, skill.kind, actor, [target], skill.name, { projectileId: p.id, skillId: skill.id, animation: skill.animation, color: p.color, life: .6 });
}
function tickMazeTowers(b) {
  for (const tower of b.mazeTowers) {
    tower.actionTimer = Math.max(0, tower.actionTimer - STEP);
    if (tower.actionTimer > 1e-9) continue;
    let target = null;
    for (const enemy of b.enemies) if (alive(enemy) && distance(tower, enemy) <= tower.range && (!target || enemy.progress > target.progress)) target = enemy;
    if (!target) continue;
    tower.actionTimer = tower.attackInterval; tower.attacksMade++;
    launchProjectile(b, tower, tower.towerSkill, target);
  }
}
function projectileHit(b, p, targets) {
  const fresh = targets.filter(target => alive(target) && !p.hitIds.includes(target.id));
  if (!fresh.length) return;
  for (const target of fresh) {
    p.hitIds.push(target.id);
    const amount = directDamage(b, p.actor, target, p.skill); p.damageTotal += amount;
    for (const effect of p.skill.effects) if (!['self', 'all-allies'].includes(effect.scope) && effect.type !== 'lifesteal') applyEffect(b, p.actor, [target], effect, amount);
  }
  emit(b, 'impact', p.actor, fresh, p.skill.name, { characterId: p.characterId, skillId: p.skillId, attackKind: p.kind,
    shape: p.shape, geometry: p.geometry, animation: p.animation, color: p.color, origin: p.start, end: p.end,
    center: p.shape === 'radial' ? p.start : p.end, life: .45 });
}
function finishProjectile(b, p) {
  for (const effect of p.skill.effects) if (['self', 'all-allies'].includes(effect.scope) || effect.type === 'lifesteal') applyEffect(b, p.actor, [], effect, p.damageTotal);
  p.finished = true;
}
function tickProjectiles(b) {
  for (const p of b.projectiles) {
    const previousProgress = p.age / p.duration;
    p.age = Math.min(p.duration, p.age + STEP);
    const progress = p.age / p.duration;
    if (['single', 'splash', 'chain'].includes(p.shape)) {
      const target = foesOf(b, p.actor).find(unit => unit.id === p.targetId && alive(unit));
      if (target) p.end = pointOf(target);
    }
    p.x = p.start.x + (p.end.x - p.start.x) * progress;
    p.y = p.start.y + (p.end.y - p.start.y) * progress;
    const candidates = foesOf(b, p.actor).filter(alive);
    if (p.shape === 'line') {
      // Test the segment swept by this frame's moving slash. A later enemy
      // cannot be damaged by the empty trail behind an already passed blade.
      const axis = direction(p.start, p.end), previousFront = p.range * previousProgress;
      projectileHit(b, p, candidates.filter(unit => inFootprint(unit, p.start, p.end, p.geometry, p.range * progress) &&
        (unit.x - p.start.x) * axis.x + (unit.y - p.start.y) * axis.y >= previousFront - 4));
    } else if (p.shape === 'cone' || p.shape === 'radial') {
      const reached = (p.shape === 'radial' ? Math.min(p.range, p.radius) : p.range) * progress;
      const previousFront = (p.shape === 'radial' ? Math.min(p.range, p.radius) : p.range) * previousProgress;
      projectileHit(b, p, candidates.filter(unit => inFootprint(unit, p.start, p.end, p.geometry, reached) && distance(unit, p.start) >= previousFront - 4));
    } else if (progress >= 1 - 1e-9) {
      const target = candidates.find(unit => unit.id === p.targetId);
      if (p.shape === 'splash') projectileHit(b, p, candidates.filter(unit => distance(unit, p.end) <= p.radius));
      else if (p.shape === 'chain' && target) {
        const chain = [target];
        while (chain.length < p.bounces) {
          const last = chain.at(-1), next = candidates.filter(unit => !chain.includes(unit) && distance(last, unit) <= p.chainRange)
            .sort((a, z) => distance(a, last) - distance(z, last) || a.id.localeCompare(z.id))[0];
          if (!next) break;
          chain.push(next);
        }
        projectileHit(b, p, chain);
      } else if (target) projectileHit(b, p, [target]);
    }
    if (progress >= 1 - 1e-9) finishProjectile(b, p);
  }
  b.projectiles = b.projectiles.filter(p => !p.finished);
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
        const source = [...b.allies, ...b.mazeTowers, ...b.enemies].find(candidate => candidate.id === status.sourceId);
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
    // Closely spaced volleys create actual clusters for area damage instead
    // of feeding one isolated enemy to the crew every few seconds.
    for (let i = 0; i < 8 && b.spawned < b.spawnTotal; i++) {
      spawnEnemy(b);
      const enemy = b.enemies.at(-1);
      enemy.progress = i * 3 / b.routeLength;
      Object.assign(enemy, defenseEnemyPointAt(enemy.progress, enemy.laneOffset, b));
    }
    b.spawnTimer += b.round === 2 ? .32 : .38;
  }
  for (const unit of [...b.allies, ...b.enemies]) tickUnit(b, unit);
  for (const enemy of b.enemies.filter(alive)) {
    if (has(enemy, 'stun') || has(enemy, 'freeze')) continue;
    enemy.progress = Math.min(1, enemy.progress + enemy.moveSpeed * (1 - Math.min(0.8, valueOf(enemy, 'slow'))) * STEP / b.routeLength);
    Object.assign(enemy, defenseEnemyPointAt(enemy.progress, enemy.moveSpeed > 0 ? enemy.laneOffset : 0, b));
    if (enemy.progress >= 1) {
      enemy.escaped = true; enemy.alive = false;
      b.ship.hp = Math.max(0, b.ship.hp - enemy.leakDamage); b.stats.leaks++; b.leakedThisWave++;
      emit(b, 'leak', enemy, [b.ship], `Ship −${enemy.leakDamage}`, { amount: enemy.leakDamage });
      if (b.ship.hp <= 0) { gate(b, 'defeat'); return; }
    }
  }
  tickProjectiles(b);
  tickMazeTowers(b);
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
  const trainingGranted = 1 + answer.correct, suppliesGranted = 20 + answer.correct * 5;
  b.trainingPoints += trainingGranted; b.supplies += suppliesGranted;
  b.learningBoost = !b.pendingOutcome && answer.correct > 0 ? {
    correct: answer.correct, round: b.round + 1, attackMultiplier: 1 + answer.correct * 0.1,
    critBonus: answer.correct * 0.05, defenseMultiplier: 1 + answer.correct * 0.08,
  } : null;
  const result = { round: b.round, correct: answer.correct, total: 3, packsEarned: 0,
    outcome: b.pendingOutcome, boost: b.learningBoost ? { ...b.learningBoost } : null,
    recovery: 0.25 + answer.correct * 0.04, energyGranted: answer.correct * 3, trainingGranted, suppliesGranted };
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
  for (const unit of [...b.allies, ...Object.values(b.reserve)]) {
    unit.hp = Math.min(unit.maxHp, Math.max(unit.hp, unit.maxHp * 0.35) + Math.round(unit.maxHp * result.recovery));
    unit.alive = true; unit.statuses = []; unit.energy = Math.min(100, Math.max(45, unit.energy) + result.energyGranted);
    unit.cooldowns = Object.fromEntries(unit.skills.map(skill => [skill.id, 0]));
  }
  b.ship.hp = Math.min(b.ship.maxHp, b.ship.hp + answer.correct * 6);
  b.round++; b.status = 'setup'; b.accumulator = 0; b.learning = null;
  b.spawnTotal = getDefenseWavePreview(b).total; b.remainingToSpawn = b.spawnTotal; b.spawned = 0; b.waveProgress = 0;
  log(b, `${answer.correct}/3 correct: +${trainingGranted} training and +${suppliesGranted} supplies. Train, summon and reposition before wave ${b.round}.`);
  return result;
}

export { CHARACTERS, CHARACTER_BY_ID };
