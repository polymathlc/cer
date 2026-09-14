import { CHARACTERS, CHARACTER_BY_ID, STARTER_IDS, PACK_ODDS, ENCOUNTERS, LORE_SOURCES, RETIRED_CHARACTER_REPLACEMENTS } from './grand-line-data.js?v=1.2.0';
export { CHARACTERS, CHARACTER_BY_ID, STARTER_IDS, PACK_ODDS, ENCOUNTERS, LORE_SOURCES, RETIRED_CHARACTER_REPLACEMENTS };

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const integer = (v, fallback = 0, max = 1000000) => Number.isFinite(v) ? clamp(Math.floor(v), 0, max) : fallback;
const living = unit => unit.hp > 0;
const allUnits = b => [...b.allies, ...b.enemies];
const side = (b, unit) => unit.side === 'ally' ? b.allies : b.enemies;
const opponents = (b, unit) => unit.side === 'ally' ? b.enemies : b.allies;
const negative = new Set(['stun', 'freeze', 'burn', 'poison', 'weaken', 'slow']);
const roll = rng => clamp(Number(rng()) || 0, 0, 0.999999999999);
const validTeam = c => Array.isArray(c?.team) && c.team.length === 5 && new Set(c.team).size === 5 && c.team.every(id => typeof id === 'string' && CHARACTER_BY_ID[id] && c.cards?.[id]?.copies >= 1);
const rankFor = copies => Math.min(10, Math.floor(Math.log2(Math.max(1, integer(copies, 1, 1000000000)))));
const maxCopies = Number.MAX_SAFE_INTEGER;

export function currentCharacterId(id) {
  if (typeof id !== 'string') return null;
  const current = Object.hasOwn(RETIRED_CHARACTER_REPLACEMENTS, id) ? RETIRED_CHARACTER_REPLACEMENTS[id] : id;
  return Object.hasOwn(CHARACTER_BY_ID, current) ? current : null;
}

export function createCollection() {
  return { version: 2, cards: Object.fromEntries(STARTER_IDS.map(id => [id, { copies: 1 }])), team: [...STARTER_IDS],
    packs: 0, unlockedEncounter: 1, completed: [], stats: { packsOpened: 0, victories: 0, correctAnswers: 0 } };
}

export function normalizeCollection(raw) {
  const c = createCollection();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return c;
  const owned = {};
  // Convert paid copies, never grant replacements merely because a card was
  // retired. Summing first also preserves saves containing both card IDs.
  for (const [oldId, card] of Object.entries(raw.cards && typeof raw.cards === 'object' && !Array.isArray(raw.cards) ? raw.cards : {})) {
    const id = currentCharacterId(oldId), copies = integer(card?.copies, 0, maxCopies);
    if (id && copies > 0) owned[id] = Math.min(maxCopies, (owned[id] || 0) + copies);
  }
  for (const [id, copies] of Object.entries(owned)) c.cards[id] = { copies };
  c.packs = integer(raw.packs, 0);
  c.unlockedEncounter = clamp(integer(raw.unlockedEncounter, 1), 1, 9);
  c.completed = Array.isArray(raw.completed) ? [...new Set(raw.completed.filter(n => Number.isInteger(n) && n >= 1 && n <= 9))].sort((a, b) => a - b) : [];
  const team = Array.isArray(raw.team) ? raw.team.map(currentCharacterId).filter(id => id && c.cards[id]) : [];
  c.team = [...new Set(team)].slice(0, 5);
  for (const id of STARTER_IDS) if (c.team.length < 5 && !c.team.includes(id)) c.team.push(id);
  for (const key of Object.keys(c.stats)) c.stats[key] = integer(raw.stats?.[key]);
  return c;
}

export function addCard(collection, id) {
  // Only normalization converts legacy ownership. A retired ID is never a
  // valid new grant, even when an old page still tries to use it.
  if (typeof id !== 'string' || Object.hasOwn(RETIRED_CHARACTER_REPLACEMENTS, id)) return null;
  const character = CHARACTER_BY_ID[id];
  if (!character || !collection?.cards || typeof collection.cards !== 'object') return null;
  const oldCopies = integer(collection.cards[id]?.copies, 0, maxCopies);
  const copies = Math.min(maxCopies, oldCopies + 1);
  collection.cards[id] = { copies };
  return { character, card: collection.cards[id], copies, rank: rankFor(copies), duplicate: oldCopies > 0 };
}

export function openPack(collection, rng = Math.random) {
  if (!collection || !Number.isInteger(collection.packs) || collection.packs < 1 || typeof rng !== 'function') return null;
  let ticket = roll(rng);
  let stars = 7;
  for (const entry of PACK_ODDS) {
    ticket -= entry.probability;
    if (ticket < 0) { stars = entry.stars; break; }
  }
  const pool = CHARACTERS.filter(c => c.stars === stars);
  const character = pool[Math.floor(roll(rng) * pool.length)];
  const result = addCard(collection, character.id);
  if (!result) return null;
  collection.packs--;
  collection.stats.packsOpened++;
  return result;
}

export function setTeam(collection, ids) {
  if (!Array.isArray(ids) || ids.length !== 5 || new Set(ids).size !== 5 || !ids.every(id => typeof id === 'string' && CHARACTER_BY_ID[id] && collection?.cards?.[id]?.copies >= 1)) return false;
  collection.team = [...ids];
  return true;
}

export function statsFor(characterId, copies = 1, level = 1) {
  const c = CHARACTER_BY_ID[characterId];
  if (!c) return null;
  const rank = rankFor(copies);
  const growth = 1 + rank * 0.12 + (clamp(integer(level, 1), 1, 20) - 1) * 0.035;
  const roleHp = c.role === 'Guardian' ? 1.18 : c.role === 'Healer' ? 0.96 : c.role === 'Controller' ? 0.98 : 1;
  const roleAttack = c.role === 'Healer' ? 0.9 : c.role === 'Guardian' ? 0.96 : 1;
  const hp = Math.round((140 + c.stars * 18) * roleHp * growth);
  return { hp, maxHp: hp, attack: Math.round((27 + c.stars * 4) * roleAttack * growth), defense: Math.round((8 + c.stars * 2 + (c.role === 'Guardian' ? 7 : 0)) * growth),
    speed: Math.round((42 + c.stars * 2 + (['Controller', 'Trickster'].includes(c.role) ? 8 : c.role === 'Healer' ? 4 : 0)) * (c.passive.type === 'speed' ? 1 + c.passive.value : 1)),
    rank, maxEnergy: 100 };
}

function seeded(value) {
  let state = 2166136261;
  for (const c of String(value)) state = Math.imul(state ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function log(b, text) {
  b.log.unshift(text);
  b.log.length = Math.min(b.log.length, 12);
}

function emit(b, kind, source, targets, text, extra = {}) {
  b.effects.push({ id: `${b.id}-fx-${++b.eventSequence}`, kind, animation: `${source?.characterId || 'battle'}-${kind}`, color: CHARACTER_BY_ID[source?.characterId]?.color || '#dcc18b',
    sourceId: source?.id || null, targetIds: targets.map(t => t.id), text, ...extra });
  if (b.effects.length > 80) b.effects.splice(0, b.effects.length - 80);
}

function makeUnit(characterId, sideName, copies, scale, index = 0) {
  const c = CHARACTER_BY_ID[characterId];
  const stats = statsFor(characterId, copies);
  const hp = Math.round(stats.maxHp * scale);
  return { id: sideName === 'ally' ? `ally-${characterId}` : `enemy-${index}-${characterId}`, characterId, name: c.name, stars: c.stars, side: sideName,
    hp, maxHp: hp, attack: Math.round(stats.attack * scale), defense: Math.round(stats.defense * scale), speed: stats.speed,
    rank: stats.rank, energy: 45, maxEnergy: 100, shield: 0, statuses: [], cooldowns: Object.fromEntries(c.skills.map(s => [s.id, 0])),
    skills: c.skills, passive: c.passive, alive: true, color: c.color, turnsStarted: 0, passiveUsed: false, attacksMade: 0 };
}

export function createBattle(collection, options = {}) {
  const encounterId = options.encounter ?? 1;
  if (!validTeam(collection) || !Number.isInteger(encounterId) || encounterId < 1 || encounterId > 9 || encounterId > collection.unlockedEncounter) return null;
  const encounter = ENCOUNTERS[encounterId - 1];
  const seed = options.seed ?? Math.floor(Math.random() * 4294967296);
  const b = { id: `grand-line-${encounterId}-${seed}`, seed, rng: seeded(seed), collection, encounter, round: 1,
    status: 'player', allies: collection.team.map(id => makeUnit(id, 'ally', collection.cards[id].copies, 1)),
    enemies: encounter.enemies.map((id, i) => makeUnit(id, 'enemy', 1, encounter.scale, i)),
    turnOrder: [], activeId: null, log: [], effects: [], pendingOutcome: null, learning: null, learningBoost: null, rewardedRounds: [], roundResults: [],
    stats: { damageDealt: 0, turns: 0, rounds: 0 }, eventSequence: 0, turnIndex: 0, outcomeCommitted: false };
  for (const team of [b.allies, b.enemies]) {
    for (const unit of team) {
      if (unit.passive.type === 'shield-start') unit.shield += Math.round(unit.maxHp * unit.passive.value);
      if (['all-shield', 'apex-whitebeard'].includes(unit.passive.type)) for (const ally of team) ally.shield += Math.round(ally.maxHp * unit.passive.value);
    }
  }
  log(b, `${encounter.name}: your five-card crew is ready.`);
  startRound(b);
  return b;
}

export function getActiveUnit(battle) {
  return allUnits(battle).find(u => u.id === battle.activeId) || null;
}

function statusValue(unit, type) {
  return unit.statuses.filter(s => s.type === type && s.duration > 0).reduce((max, s) => Math.max(max, s.amount || 0), 0);
}

function hasStatus(unit, type) {
  return unit.statuses.some(s => s.type === type && s.duration > 0);
}

function heal(b, target, amount, source) {
  if (!living(target)) return 0;
  const value = Math.min(target.maxHp - target.hp, Math.max(0, Math.round(amount)));
  target.hp += value;
  if (value > 0) emit(b, 'heal', source, [target], `+${value}`, { amount: value });
  return value;
}

function knockedOut(b, target) {
  if (target.hp > 0) return;
  if (!target.passiveUsed && ['stubborn', 'revive-self'].includes(target.passive.type)) {
    target.passiveUsed = true;
    target.hp = Math.max(1, Math.round(target.maxHp * target.passive.value));
    target.alive = true;
    target.statuses = [];
    emit(b, 'revive', target, [target], target.passive.name);
    log(b, `${target.name}: ${target.passive.name}!`);
    return;
  }
  target.hp = 0;
  target.alive = false;
  target.shield = 0;
  target.statuses = [];
  log(b, `${target.name} is knocked out.`);
}

function activeLearningBoost(b) {
  return b.learningBoost?.round === b.round && ['player', 'enemy'].includes(b.status) ? b.learningBoost : null;
}

function rawDamage(b, target, amount, source, direct = false) {
  if (!living(target)) return 0;
  const learningAttack = source?.side === 'ally' ? activeLearningBoost(b)?.attackMultiplier || 1 : 1;
  let total = Math.max(0, Math.round(amount * learningAttack));
  if (direct && target.shield > 0) {
    const absorbed = Math.min(target.shield, total);
    target.shield -= absorbed;
    total -= absorbed;
    emit(b, 'shield', target, [target], `${absorbed} blocked`, { amount: absorbed });
  }
  const actual = Math.min(total, target.hp);
  target.hp = Math.max(0, target.hp - total);
  if (source?.side === 'ally' && target.side === 'enemy') b.stats.damageDealt += actual;
  if (total > 0) emit(b, 'damage', source, [target], `${total}`, { amount: total });
  if (!living(target)) knockedOut(b, target);
  return actual;
}

function directDamage(b, actor, target, skill) {
  if (!living(target)) return 0;
  if (target.passive.type === 'evade' && roll(b.rng) < target.passive.value) {
    emit(b, 'wind', target, [target], 'Evaded');
    return 0;
  }
  let multiplier = 1 + statusValue(actor, 'attack-up') - statusValue(actor, 'weaken');
  for (const ally of side(b, actor)) if (living(ally) && ally.passive.type === 'all-attack') multiplier += ally.passive.value;
  if (actor.passive.type === 'execute' && target.hp < target.maxHp * 0.5) multiplier *= 1 + actor.passive.value;
  if (actor.passive.type === 'focus') multiplier *= 1 + Math.min(6, actor.attacksMade) * actor.passive.value;
  if (actor.passive.type === 'apex-whitebeard' && actor.hp < actor.maxHp * 0.5) multiplier *= 1.2;
  if (actor.passive.type === 'apex-akainu' && hasStatus(target, 'burn')) multiplier *= 1 + actor.passive.value;
  const pierce = skill.effects.some(e => e.type === 'pierce') ? 1 : actor.passive.type === 'pierce' ? actor.passive.value : 0;
  const boost = activeLearningBoost(b);
  const critChance = Math.min(0.75, 0.07 + (actor.passive.type === 'crit' ? actor.passive.value : 0) + (actor.side === 'ally' ? boost?.critBonus || 0 : 0));
  const crit = roll(b.rng) < critChance;
  const defenseMultiplier = target.side === 'ally' ? boost?.defenseMultiplier || 1 : 1;
  let damage = Math.max(6, actor.attack * skill.power * multiplier - target.defense * defenseMultiplier * (1 - pierce) * 0.48);
  damage *= 0.96 + roll(b.rng) * 0.08;
  if (crit) damage *= 1.55;
  damage *= 1 - statusValue(target, 'guard');
  if (target.passive.type === 'defense' || target.passive.type === 'apex-kaido') damage *= 1 - target.passive.value;
  if (target.passive.type === 'low-health-defense' && target.hp < target.maxHp * 0.5) damage *= 1 - target.passive.value;
  for (const protector of side(b, target)) if (living(protector) && protector.passive.type === 'all-guard') damage *= 1 - protector.passive.value;
  const actual = rawDamage(b, target, damage, actor, true);
  if (crit && actual > 0) emit(b, 'light', actor, [target], 'Critical!', { critical: true });
  if (actor.passive.type === 'lifesteal') heal(b, actor, actual * actor.passive.value, actor);
  if (actor.passive.type === 'shield-on-hit') actor.shield = Math.min(actor.maxHp, actor.shield + Math.round(actor.attack * actor.passive.value));
  if (target.passive.type === 'counter' && actual > 0 && living(actor) && living(target)) rawDamage(b, actor, target.attack * target.passive.value, target, true);
  return actual;
}

function addStatus(b, actor, target, descriptor) {
  if (!living(target)) return;
  const type = descriptor.type;
  if (type === 'burn' && ['burn-immune', 'apex-akainu'].includes(target.passive.type)) return;
  if (type === 'poison' && target.passive.type === 'poison-immune') return;
  if (type === 'freeze' && target.passive.type === 'freeze-immune') return;
  if (descriptor.chance && roll(b.rng) >= descriptor.chance) return;
  let duration = descriptor.duration;
  if (actor.passive.type === 'debuff-duration' && negative.has(type) && !actor.passiveUsed) {
    duration += actor.passive.value;
    actor.passiveUsed = true;
  }
  const amount = ['burn', 'poison', 'regen'].includes(type) ? actor.attack * descriptor.amount : descriptor.amount;
  const old = target.statuses.find(s => s.type === type);
  if (old) { old.duration = Math.max(old.duration, duration); old.amount = Math.max(old.amount, amount); old.appliedTurn = target.turnsStarted; }
  else target.statuses.push({ type, amount, duration, appliedTurn: target.turnsStarted, sourceId: actor.id });
  emit(b, type, actor, [target], type.replaceAll('-', ' '));
}

function applyEffect(b, actor, targets, descriptor, damageTotal) {
  const recipients = descriptor.scope === 'self' ? [actor] : descriptor.scope === 'all-allies' ? side(b, actor).filter(living) : targets;
  if (descriptor.type === 'lifesteal') { heal(b, actor, damageTotal * descriptor.amount, actor); return; }
  if (descriptor.type === 'pierce') return;
  for (const target of recipients) {
    const healingMultiplier = actor.passive.type === 'healing' ? 1 + actor.passive.value : 1;
    if (descriptor.type === 'revive') {
      if (living(target)) continue;
      target.hp = Math.min(target.maxHp, Math.max(1, Math.round(target.maxHp * descriptor.amount * healingMultiplier)));
      target.alive = true;
      target.statuses = [];
      emit(b, 'revive', actor, [target], 'Back on your feet!');
      log(b, `${actor.name} revives ${target.name}.`);
      continue;
    }
    if (!living(target)) continue;
    if (descriptor.type === 'heal') heal(b, target, actor.attack * descriptor.amount * healingMultiplier, actor);
    else if (descriptor.type === 'shield') {
      const shield = Math.round(actor.attack * descriptor.amount);
      target.shield = Math.min(target.maxHp, target.shield + shield);
      emit(b, 'shield', actor, [target], `+${shield} shield`, { amount: shield });
    } else if (descriptor.type === 'cleanse') {
      target.statuses = target.statuses.filter(s => !negative.has(s.type));
      emit(b, 'heal', actor, [target], 'Cleansed');
    } else if (descriptor.type === 'energy') target.energy = Math.min(target.maxEnergy, target.energy + descriptor.amount);
    else if (descriptor.type === 'drain') {
      const stolen = Math.min(target.energy, descriptor.amount);
      target.energy -= stolen;
      actor.energy = Math.min(actor.maxEnergy, actor.energy + stolen);
    } else addStatus(b, actor, target, descriptor);
  }
}

export function getValidTargets(b, skillId) {
  const actor = getActiveUnit(b);
  const skill = actor?.skills.find(s => s.id === skillId);
  if (!actor || !skill) return [];
  if (skill.target === 'self') return [actor];
  if (skill.target === 'fallen-ally') return side(b, actor).filter(u => !living(u));
  if (skill.target === 'ally' || skill.target === 'all-allies') return side(b, actor).filter(living);
  const enemies = opponents(b, actor).filter(living);
  if (skill.target === 'all-enemies') return enemies;
  const taunts = enemies.filter(e => hasStatus(e, 'taunt'));
  return taunts.length ? taunts : enemies;
}

function roundGate(b) {
  if (b.status === 'learning' || ['victory', 'defeat'].includes(b.status)) return;
  b.pendingOutcome = !b.allies.some(living) ? 'defeat' : !b.enemies.some(living) ? 'victory' : null;
  b.status = 'learning';
  b.learningBoost = null;
  b.activeId = null;
  b.learning = { round: b.round, required: 3, completed: false };
  b.stats.rounds++;
  log(b, `Round ${b.round} complete. Answer exactly 3 questions before sailing on.`);
}

function expireStatuses(unit) {
  for (const status of unit.statuses) if ((status.appliedTurn ?? -1) < unit.turnsStarted) status.duration--;
  unit.statuses = unit.statuses.filter(s => s.duration > 0);
}

function prepareTurn(b, unit) {
  unit.turnsStarted++;
  for (const id of Object.keys(unit.cooldowns)) unit.cooldowns[id] = Math.max(0, unit.cooldowns[id] - 1);
  unit.energy = Math.min(unit.maxEnergy, unit.energy + 6 + (unit.passive.type === 'energy' ? unit.passive.value : 0));
  if (unit.passive.type === 'regen') heal(b, unit, unit.maxHp * unit.passive.value, unit);
  if (unit.passive.type === 'apex-kaido') heal(b, unit, unit.maxHp * 0.04, unit);
  for (const status of [...unit.statuses]) {
    // Self-revival may cleanse the remaining effects while a lethal tick runs.
    if (!unit.statuses.includes(status)) continue;
    if (status.type === 'burn' || status.type === 'poison') {
      if (status.type === 'burn' && ['burn-immune', 'apex-akainu'].includes(unit.passive.type)) continue;
      if (status.type === 'poison' && unit.passive.type === 'poison-immune') continue;
      const source = allUnits(b).find(u => u.id === status.sourceId);
      rawDamage(b, unit, status.amount, source);
      if (!living(unit)) break;
    }
    if (status.type === 'regen') heal(b, unit, status.amount, unit);
  }
  if (!living(unit)) return false;
  if (hasStatus(unit, 'stun') || hasStatus(unit, 'freeze')) {
    log(b, `${unit.name} loses this turn to ${hasStatus(unit, 'freeze') ? 'freeze' : 'stun'}.`);
    emit(b, hasStatus(unit, 'freeze') ? 'ice' : 'lightning', unit, [unit], 'Turn skipped');
    return false;
  }
  return true;
}

function selectNext(b) {
  while (b.turnIndex < b.turnOrder.length) {
    if (!b.allies.some(living) || !b.enemies.some(living)) { roundGate(b); return; }
    const unit = allUnits(b).find(u => u.id === b.turnOrder[b.turnIndex]);
    if (!unit || !living(unit)) { b.turnIndex++; continue; }
    b.activeId = unit.id;
    if (prepareTurn(b, unit)) { b.status = unit.side === 'ally' ? 'player' : 'enemy'; return; }
    expireStatuses(unit);
    b.stats.turns++;
    b.turnIndex++;
  }
  roundGate(b);
}

function startRound(b) {
  b.learning = null;
  b.pendingOutcome = null;
  b.status = 'player';
  b.turnIndex = 0;
  for (const team of [b.allies, b.enemies]) for (const unit of team.filter(living)) {
    if (unit.passive.type === 'all-regen') for (const ally of team.filter(living)) heal(b, ally, ally.maxHp * unit.passive.value, unit);
    if (unit.passive.type === 'all-energy') for (const ally of team.filter(living)) ally.energy = Math.min(ally.maxEnergy, ally.energy + unit.passive.value);
  }
  b.turnOrder = allUnits(b).filter(living).map(unit => ({ id: unit.id, speed: unit.speed * (1 - statusValue(unit, 'slow')), tie: roll(b.rng) }))
    .sort((a, z) => z.speed - a.speed || a.tie - z.tie).map(entry => entry.id);
  log(b, `Round ${b.round}: initiative set.`);
  selectNext(b);
}

function finishTurn(b, actor) {
  expireStatuses(actor);
  b.stats.turns++;
  b.turnIndex++;
  selectNext(b);
}

function perform(b, actor, skill, targetId) {
  const valid = getValidTargets(b, skill.id);
  let targets;
  if (skill.target === 'self') targets = [actor];
  else if (skill.target === 'all-enemies' || skill.target === 'all-allies') targets = valid;
  else targets = valid.filter(u => u.id === targetId);
  if (!targets.length || actor.energy < skill.cost || actor.cooldowns[skill.id] > 0) return false;
  b.effects = [];
  actor.energy -= skill.cost;
  actor.cooldowns[skill.id] = skill.cooldown;
  emit(b, skill.kind, actor, targets, skill.name, { animation: skill.animation, color: skill.color, skillId: skill.id });
  log(b, `${actor.name} uses ${skill.name}.`);
  let damageTotal = 0;
  if (skill.power > 0) {
    for (const target of targets) {
      if (!living(actor)) break;
      damageTotal += directDamage(b, actor, target, skill);
    }
    actor.attacksMade++;
  }
  if (living(actor)) for (const descriptor of skill.effects) applyEffect(b, actor, targets, descriptor, damageTotal);
  if (skill.id === actor.skills[0].id) actor.energy = Math.min(actor.maxEnergy, actor.energy + 20);
  finishTurn(b, actor);
  return true;
}

export function act(b, skillId, targetId) {
  if (!b || b.status !== 'player') return false;
  const actor = getActiveUnit(b);
  const skill = actor?.skills.find(s => s.id === skillId);
  if (!actor || !living(actor) || actor.side !== 'ally' || !skill) return false;
  return perform(b, actor, skill, targetId);
}

export function chooseDefend(b) {
  if (!b || b.status !== 'player') return false;
  const actor = getActiveUnit(b);
  if (!actor || !living(actor) || actor.side !== 'ally') return false;
  b.effects = [];
  actor.energy = Math.min(actor.maxEnergy, actor.energy + 25);
  actor.shield = Math.min(actor.maxHp, actor.shield + Math.round(actor.attack * 0.9));
  addStatus(b, actor, actor, { type: 'guard', amount: 0.3, duration: 1 });
  emit(b, 'shield', actor, [actor], 'Defend · +25 Spirit');
  log(b, `${actor.name} defends and gathers Spirit.`);
  finishTurn(b, actor);
  return true;
}

export function advanceBattle(b) {
  if (!b || b.status !== 'enemy') return false;
  const actor = getActiveUnit(b);
  if (!actor || !living(actor)) { b.turnIndex++; selectNext(b); return true; }
  const available = actor.skills.filter(s => actor.energy >= s.cost && !actor.cooldowns[s.id] && getValidTargets(b, s.id).length);
  const wounded = side(b, actor).filter(living).some(u => u.hp < u.maxHp * 0.52);
  const revive = available.find(s => s.target === 'fallen-ally');
  const healing = wounded ? available.find(s => s.effects.some(e => e.type === 'heal') && ['ally', 'all-allies'].includes(s.target)) : null;
  const offense = available.filter(s => s.power > 0).sort((a, z) => z.power * (z.target === 'all-enemies' ? 1.5 : 1) - a.power * (a.target === 'all-enemies' ? 1.5 : 1));
  const skill = revive || healing || (offense.length > 1 && roll(b.rng) < 0.22 ? actor.skills[0] : offense[0]) || available[0];
  if (!skill) { finishTurn(b, actor); return true; }
  const valid = getValidTargets(b, skill.id);
  let target;
  if (skill.target === 'ally') target = valid.sort((a, z) => a.hp / a.maxHp - z.hp / z.maxHp)[0];
  else if (skill.target === 'enemy') {
    // Spread pressure instead of always eliminating the same support character first.
    const weighted = valid.filter(u => u.hp >= u.maxHp * 0.25);
    const pool = weighted.length && roll(b.rng) < 0.68 ? weighted : valid;
    target = pool[Math.floor(roll(b.rng) * pool.length)];
  } else target = valid[0];
  return perform(b, actor, skill, target?.id);
}

export const autoEnemyTurn = advanceBattle;

export function completeLearning(b, answer = {}) {
  if (!b || b.status !== 'learning' || !b.learning || b.learning.completed || b.rewardedRounds.includes(b.round)) return false;
  if (answer.total !== 3 || !Number.isInteger(answer.correct) || answer.correct < 0 || answer.correct > 3) return false;
  if (answer.round !== undefined && answer.round !== b.round) return false;
  b.learning.completed = true;
  b.rewardedRounds.push(b.round);
  const c = b.collection;
  c.stats.correctAnswers += answer.correct;
  // Learning improves the next round only. Packs are purchased through
  // the host platform's existing reward-point economy and never awarded here.
  const recovery = answer.correct * 0.018;
  const energyGranted = answer.correct * 3;
  b.learningBoost = !b.pendingOutcome && answer.correct > 0 ? {
    correct: answer.correct, round: b.round + 1, attackMultiplier: 1 + answer.correct * 0.1,
    critBonus: answer.correct * 0.05, defenseMultiplier: 1 + answer.correct * 0.08
  } : null;
  if (!b.pendingOutcome) for (const ally of b.allies.filter(living)) {
    heal(b, ally, ally.maxHp * recovery, ally);
    ally.energy = Math.min(ally.maxEnergy, ally.energy + energyGranted);
  }
  const result = { packsEarned: 0, correct: answer.correct, total: 3, round: b.round, outcome: b.pendingOutcome, recovery, energyGranted, boost: b.learningBoost ? { ...b.learningBoost } : null };
  b.roundResults.push(result);
  log(b, `${answer.correct}/3 correct${b.learningBoost ? ` · next round: +${answer.correct * 10}% damage, +${answer.correct * 5} percentage points critical chance, +${answer.correct * 8}% defense` : ''}.`);
  if (b.pendingOutcome) {
    b.status = b.pendingOutcome;
    if (!b.outcomeCommitted) {
      b.outcomeCommitted = true;
      if (b.status === 'victory') {
        c.stats.victories++;
        if (!c.completed.includes(b.encounter.id)) c.completed.push(b.encounter.id);
        c.completed.sort((a, z) => a - z);
        c.unlockedEncounter = Math.max(c.unlockedEncounter, Math.min(9, b.encounter.id + 1));
        log(b, `${b.encounter.name} cleared. The next chapter opens.`);
      } else log(b, 'The crew rests. Regroup and try again.');
    }
    return result;
  }
  b.round++;
  startRound(b);
  return result;
}

export const grantLearningReward = completeLearning;
