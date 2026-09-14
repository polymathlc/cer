/* Pirate Rift: deterministic, browser-independent combat simulation. */
export const VERSION = '1.0.0';

export const CHARACTERS = [
  {
    id: 'luffy', name: 'Monkey D. Luffy', title: 'The Sun God', color: '#ffb657',
    description: 'Stretch across the battlefield. Build momentum with rubber punches, then unleash Gear Five.',
    abilities: [
      { name: 'Gum-Gum Pistol', key: 'LMB', cooldown: 0.36, description: 'A long rubber punch. Each hit restores Spirit.' },
      { name: 'Gum-Gum Gatling', key: 'E', cooldown: 4.5, cost: 26, description: 'Five rapid punches rain on your cursor position. Costs 26 Spirit.' },
      { name: 'Gear Five', key: 'Q', cooldown: 17, cost: 70, description: 'A giant impact at your cursor; gain 7 seconds of speed and damage. Costs 70 Spirit.' },
    ],
  },
  {
    id: 'zoro', name: 'Roronoa Zoro', title: 'King of Hell', color: '#84dfae',
    description: 'Cut through enemies with three swords. Onigiri grants a brief window of invulnerability.',
    abilities: [
      { name: 'Three-Sword Cut', key: 'LMB', cooldown: 0.38, description: 'A wide, close-range sword arc. Each hit restores Spirit.' },
      { name: 'Onigiri', key: 'E', cooldown: 4.3, cost: 28, description: 'Dash toward your cursor and cut through the path. Costs 28 Spirit.' },
      { name: 'Three Thousand Worlds', key: 'Q', cooldown: 17, cost: 70, description: 'A whirlwind of blades at your cursor; leaves a cutting vortex. Costs 70 Spirit.' },
    ],
  },
  {
    id: 'whitebeard', name: 'Whitebeard', title: 'The World Shaker', color: '#b5d8ff',
    description: 'A mighty bisento and earth-shattering tremors. Slower strikes, enormous reach and stagger.',
    abilities: [
      { name: 'Bisento Cleave', key: 'LMB', cooldown: 0.55, description: 'A heavy sweeping cleave with exceptional reach. Restores Spirit on hit.' },
      { name: 'Seaquake', key: 'E', cooldown: 5, cost: 30, description: 'Shatter the ground at your cursor and stagger enemies. Costs 30 Spirit.' },
      { name: 'Worldbreaker', key: 'Q', cooldown: 18, cost: 75, description: 'Two colossal quakes at your cursor. The second wave reaches farther. Costs 75 Spirit.' },
    ],
  },
  {
    id: 'shanks', name: 'Red-Haired Shanks', title: 'The Haki Emperor', color: '#fa758d',
    description: 'Precise saber strikes, piercing Haki, and the overwhelming presence of an Emperor.',
    abilities: [
      { name: 'Gryphon Slash', key: 'LMB', cooldown: 0.32, description: 'A swift saber arc with a high critical chance. Restores Spirit on hit.' },
      { name: 'Divine Departure', key: 'E', cooldown: 4.3, cost: 27, description: 'Launch piercing red Haki toward your cursor. Costs 27 Spirit.' },
      { name: 'Conqueror’s Haki', key: 'Q', cooldown: 17, cost: 70, description: 'Crush enemies around your cursor and stun the survivors. Costs 70 Spirit.' },
    ],
  },
];

const BASE = {
  luffy: { hp: 240, damage: 35, speed: 238, crit: 0.08, armor: 0.04, energyRegen: 6.5 },
  zoro: { hp: 230, damage: 43, speed: 244, crit: 0.13, armor: 0.05, energyRegen: 6 },
  whitebeard: { hp: 310, damage: 60, speed: 208, crit: 0.07, armor: 0.14, energyRegen: 6.5 },
  shanks: { hp: 235, damage: 39, speed: 248, crit: 0.19, armor: 0.05, energyRegen: 6 },
};

const ROOMS = [
  ['Smuggler’s Landing', 'harbor'], ['The Broken Docks', 'harbor'], ['Stormwatch Anchorage', 'harbor'],
  ['The Drowned Causeway', 'ruins'], ['Echoes of the Void', 'ruins'], ['The Ancient Crucible', 'ruins'],
  ['The Emperor’s Gate', 'citadel'], ['The Scarlet Ascent', 'citadel'], ['Throne of the Last Storm', 'citadel'],
];
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const RARITY_COLORS = { common: '#c8c5bb', rare: '#6ab9ff', epic: '#c093ff', legendary: '#ffd17d' };
const UPGRADE_POOL = [
  { key: 'power', name: 'Emperor’s Strength', description: '+18% damage to all attacks.', max: 5 },
  { key: 'vitality', name: 'Unbreakable Will', description: '+45 maximum health and restore 45 health.', max: 5 },
  { key: 'haste', name: 'Instinct', description: 'Abilities recharge 8% faster. Move 5% faster.', max: 4 },
  { key: 'spirit', name: 'Awakened Spirit', description: '+15 maximum Spirit and +2 Spirit per second.', max: 4 },
  { key: 'crit', name: 'Observation Haki', description: '+8% critical chance. Critical hits deal double damage.', max: 4 },
  { key: 'leech', name: 'Fighting Spirit', description: 'Heal for 3% of damage dealt.', max: 3 },
  { key: 'guard', name: 'Armament Haki', description: 'Reduce incoming damage by an additional 7%.', max: 3 },
  { key: 'reach', name: 'Legendary Presence', description: 'Increase attack reach and area by 12%.', max: 3 },
];

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const hypot = Math.hypot;
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const distance = (a, b) => hypot(a.x - b.x, a.y - b.y);
const active = g => g.status === 'playing';
const random = g => clamp(finite(g.rng(), 0.5), 0, 0.999999999);
const between = (g, a, b) => a + random(g) * (b - a);
const choose = (g, array) => array[Math.floor(random(g) * array.length)];

function record(g, text) {
  g.log.unshift(text);
  g.log.length = Math.min(g.log.length, 6);
}

function effect(g, kind, x, y, radius, color, life = 0.45, extra = {}) {
  g.effects.push({ kind, x, y, radius, color, life, maxLife: life, ...extra });
  if (g.effects.length > 160) g.effects.splice(0, g.effects.length - 160);
}

function statEquipment(g, field) {
  return Object.values(g.equipment).reduce((sum, item) => sum + (item?.[field] || 0), 0);
}

export function getStats(g) {
  const b = BASE[g.characterId];
  const u = g.upgrades;
  const level = g.player.level - 1;
  const damageMultiplier = (1 + level * 0.075 + (u.power || 0) * 0.18 + statEquipment(g, 'damage'))
    * (g.player.empowered > 0 ? 1.3 : 1);
  return {
    damage: Math.round(b.damage * damageMultiplier), damageMultiplier,
    maxHp: b.hp + level * 18 + (u.vitality || 0) * 45 + statEquipment(g, 'health'),
    maxEnergy: 100 + (u.spirit || 0) * 15,
    speed: b.speed * (1 + (u.haste || 0) * 0.05 + statEquipment(g, 'speed') + (g.player.empowered > 0 ? 0.2 : 0)),
    crit: Math.min(0.8, b.crit + (u.crit || 0) * 0.08 + statEquipment(g, 'crit')),
    armor: Math.min(0.65, b.armor + (u.guard || 0) * 0.07 + statEquipment(g, 'armor')),
    energyRegen: b.energyRegen + (u.spirit || 0) * 2,
    cooldownMultiplier: Math.max(0.5, 1 - (u.haste || 0) * 0.08),
    reach: 1 + (u.reach || 0) * 0.12,
    lifesteal: (u.leech || 0) * 0.03,
  };
}

function syncStats(g, grantDifference = false) {
  const s = getStats(g);
  const p = g.player;
  if (grantDifference) p.hp += Math.max(0, s.maxHp - p.maxHp);
  p.maxHp = s.maxHp;
  p.hp = clamp(p.hp, 0, p.maxHp);
  p.maxEnergy = s.maxEnergy;
  p.energy = clamp(p.energy, 0, p.maxEnergy);
  return s;
}

export function createGame(characterId = 'luffy', options = {}) {
  const character = CHARACTERS.find(c => c.id === characterId) || CHARACTERS[0];
  const g = {
    characterId: character.id, character, rng: typeof options.rng === 'function' ? options.rng : Math.random,
    seed: options.seed, version: VERSION,
    player: {
      x: 0, y: 290, radius: 21, hp: BASE[character.id].hp, maxHp: BASE[character.id].hp,
      energy: 100, maxEnergy: 100, level: 1, xp: 0, xpNext: 110,
      cooldowns: [0, 0, 0], dodgeCooldown: 0, dodgeTime: 0, dodgeX: 0, dodgeY: -1,
      facing: -Math.PI / 2, invulnerable: 0, potions: 3, empowered: 0, hitFlash: 0,
    },
    room: 1, act: 1, status: 'playing', time: 0, roomTime: 0,
    worldBounds: { minX: -620, minY: -480, maxX: 620, maxY: 480 },
    obstacles: [], enemies: [], projectiles: [], effects: [], loot: [], inventory: [],
    equipment: { weapon: null, coat: null, charm: null }, upgrades: {}, choices: [],
    stats: { kills: 0, damageDealt: 0, damageTaken: 0, gold: 0, bestRoom: 1, bosses: 0, roomsCleared: 0 },
    log: [], portal: { x: 0, y: -355, radius: 48 },
    nextId: 1, pending: [], pendingLevels: 0, roomRewarded: false, aim: { x: 0, y: 0 },
    wave: 1, totalWaves: 3, reinforcements: [], waveDelay: 0,
  };
  buildRoom(g);
  record(g, `${character.name} enters the Pirate Rift.`);
  return g;
}

function makeEnemy(g, type, x, y, bossName) {
  const scale = 1 + (g.room - 1) * 0.115;
  const spec = {
    marine: { hp: 132, damage: 15, speed: 93, radius: 18, color: '#a5bbc5', name: 'Marine Raider', xp: 15 },
    gunner: { hp: 110, damage: 13, speed: 78, radius: 17, color: '#d6a275', name: 'Flintlock Corsair', xp: 18 },
    brute: { hp: 250, damage: 27, speed: 67, radius: 29, color: '#ae847a', name: 'Ironjaw Enforcer', xp: 27 },
    captain: { hp: 300, damage: 23, speed: 108, radius: 22, color: '#ab85c2', name: 'Haki Captain', xp: 32 },
    boss: { hp: 2400 + g.act * 450, damage: 31, speed: 70, radius: 48, color: ['#eab56e', '#80ccdd', '#ee779b'][g.act - 1], name: bossName, xp: 130 },
  }[type];
  const hp = Math.round(spec.hp * scale);
  return {
    id: `enemy-${g.nextId++}`, x, y, radius: spec.radius, hp, maxHp: hp, type,
    name: spec.name, color: spec.color, boss: type === 'boss',
    damage: spec.damage * (1 + (g.room - 1) * 0.07), speed: spec.speed * (1 + g.act * 0.04),
    xp: spec.xp, cooldown: between(g, 0.8, 1.8), telegraph: null,
    hitFlash: 0, stun: 0, slow: 0, phase: 1, attackCount: 0, knockedX: 0, knockedY: 0,
  };
}

function buildRoom(g) {
  const roomInfo = ROOMS[g.room - 1];
  g.roomName = roomInfo[0];
  g.roomTheme = roomInfo[1];
  g.act = Math.ceil(g.room / 3);
  g.roomTime = 0;
  g.roomRewarded = false;
  g.pending = [];
  g.enemies = [];
  g.projectiles = [];
  g.effects = [];
  g.loot = [];
  g.choices = [];
  g.wave = 1;
  g.totalWaves = g.room % 3 === 0 ? 2 : 3;
  g.reinforcements = [];
  g.waveDelay = 0;
  g.player.x = 0;
  g.player.y = 290;
  g.player.dodgeTime = 0;
  g.player.invulnerable = 1.25;
  g.obstacles = [];
  // Keep a generous central route and the entrance/portal clear in every seed.
  const obstacleCount = g.room % 3 === 0 ? 4 : 5 + g.act;
  for (let i = 0; i < obstacleCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const candidate = { x: side * between(g, 240, 510), y: between(g, -320, 280), radius: between(g, 30, 51) };
    if (g.obstacles.every(o => distance(o, candidate) > o.radius + candidate.radius + 65)) g.obstacles.push(candidate);
  }
  const bossRoom = g.room % 3 === 0;
  const count = bossRoom ? 5 + g.act : 8 + g.room + g.act;
  for (let i = 0; i < count; i++) {
    let point = { x: 0, y: 0 };
    for (let attempt = 0; attempt < 50; attempt++) {
      point = { x: between(g, -515, 515), y: between(g, -355, 145) };
      if (distance(point, g.player) > 220 && g.obstacles.every(o => distance(o, point) > o.radius + 50)
          && g.enemies.every(e => distance(e, point) > e.radius + 54)) break;
    }
    const type = i % 5 === 4 ? 'brute' : i % 4 === 2 ? 'gunner' : g.room > 3 && i % 5 === 3 ? 'captain' : 'marine';
    const enemy = makeEnemy(g, type, point.x, point.y);
    resolvePosition(g, enemy);
    if (i < Math.ceil(count / g.totalWaves)) g.enemies.push(enemy);
    else g.reinforcements.push(enemy);
  }
  if (bossRoom) {
    g.enemies.push(makeEnemy(g, 'boss', 0, -190, ['Commodore Ironwake', 'The Drowned Warden', 'The Crimson Sovereign'][g.act - 1]));
    record(g, `${g.enemies[g.enemies.length - 1].name} guards this passage.`);
  }
}

function updateReinforcements(g, dt) {
  if (!g.reinforcements.length) return;
  const bossRoom = g.room % 3 === 0;
  const living = g.enemies.filter(e => e.hp > 0);
  const ready = bossRoom ? g.roomTime >= 13 || !living.length : living.length <= 1 && g.roomTime >= (g.wave * 7);
  if (!ready) { g.waveDelay = 0; return; }
  g.waveDelay += dt;
  if (g.waveDelay < 0.85) return;
  g.wave++;
  g.waveDelay = 0;
  const count = Math.ceil(g.reinforcements.length / Math.max(1, g.totalWaves - g.wave + 1));
  const arriving = g.reinforcements.splice(0, count);
  for (const enemy of arriving) {
    // Spawn outside immediate striking distance and give all arrivals a grace period.
    if (distance(enemy, g.player) < 200) {
      const startAngle = Math.atan2(enemy.y - g.player.y, enemy.x - g.player.x) || Math.PI;
      for (let attempt = 0; attempt < 12; attempt++) {
        const angle = startAngle + attempt * Math.PI / 6;
        enemy.x = g.player.x + Math.cos(angle) * 260;
        enemy.y = g.player.y + Math.sin(angle) * 260;
        resolvePosition(g, enemy);
        if (distance(enemy, g.player) >= 200) break;
      }
    }
    enemy.cooldown = Math.max(enemy.cooldown, 1.4);
    enemy.stun = 0.65;
    effect(g, 'haki', enemy.x, enemy.y, 42, '#b993dd', 0.85);
    g.enemies.push(enemy);
  }
  record(g, `Reinforcements! Wave ${g.wave} of ${g.totalWaves}.`);
}

function resolvePosition(g, unit) {
  const b = g.worldBounds;
  for (let pass = 0; pass < 3; pass++) {
    unit.x = clamp(unit.x, b.minX + unit.radius, b.maxX - unit.radius);
    unit.y = clamp(unit.y, b.minY + unit.radius, b.maxY - unit.radius);
    for (const o of g.obstacles) {
      const dx = unit.x - o.x;
      const dy = unit.y - o.y;
      const d = hypot(dx, dy);
      const minimum = unit.radius + o.radius;
      if (d < minimum) {
        unit.x = o.x + (d > 0.001 ? dx / d : 1) * minimum;
        unit.y = o.y + (d > 0.001 ? dy / d : 0) * minimum;
      }
    }
  }
  unit.x = clamp(unit.x, b.minX + unit.radius, b.maxX - unit.radius);
  unit.y = clamp(unit.y, b.minY + unit.radius, b.maxY - unit.radius);
}

function moveUnit(g, unit, dx, dy) {
  const steps = Math.max(1, Math.ceil(hypot(dx, dy) / 13));
  for (let i = 0; i < steps; i++) {
    unit.x += dx / steps;
    unit.y += dy / steps;
    resolvePosition(g, unit);
  }
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return hypot(px - ax - t * dx, py - ay - t * dy);
}

function angleDifference(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function damageEnemy(g, enemy, damage, options = {}) {
  if (enemy.hp <= 0 || g.status === 'dead' || g.status === 'victory') return 0;
  const s = getStats(g);
  const critical = options.crit !== false && random(g) < s.crit;
  const amount = Math.round(damage * s.damageMultiplier * (critical ? 2 : 1));
  const actual = Math.min(enemy.hp, amount);
  enemy.hp = Math.max(0, enemy.hp - amount);
  enemy.hitFlash = 0.12;
  if (options.stun) {
    enemy.stun = Math.max(enemy.stun, options.stun * (enemy.boss ? 0.35 : 1));
    if (!enemy.boss) enemy.telegraph = null;
  }
  if (options.slow) enemy.slow = Math.max(enemy.slow, options.slow);
  if (options.knockback && !enemy.boss) {
    const origin = options.origin || g.player;
    const d = distance(enemy, origin) || 1;
    moveUnit(g, enemy, (enemy.x - origin.x) / d * options.knockback, (enemy.y - origin.y) / d * options.knockback);
  }
  g.stats.damageDealt += actual;
  if (s.lifesteal) g.player.hp = Math.min(g.player.maxHp, g.player.hp + actual * s.lifesteal);
  effect(g, 'damage', enemy.x, enemy.y - enemy.radius, critical ? 21 : 15, critical ? '#ffe59c' : '#f4eee1', 0.7, { text: `${amount}${critical ? '!' : ''}` });
  if (enemy.hp <= 0) killEnemy(g, enemy);
  return actual;
}

function killEnemy(g, enemy) {
  g.stats.kills++;
  if (enemy.boss) g.stats.bosses++;
  g.player.xp += enemy.xp;
  effect(g, 'burst', enemy.x, enemy.y, enemy.radius * 1.8, enemy.color, 0.55);
  g.loot.push({ id: `loot-${g.nextId++}`, x: enemy.x, y: enemy.y, type: 'gold', rarity: 'common', name: 'Berries', amount: enemy.boss ? 150 + g.room * 20 : 9 + g.room * 2, radius: 8 });
  if (enemy.boss || random(g) < 0.13) {
    const item = makeItem(g, enemy.boss);
    g.loot.push({ ...item, x: enemy.x + 18, y: enemy.y + 8, type: 'item', radius: 14 });
  }
  if (!enemy.boss && random(g) < 0.12) g.loot.push({ id: `loot-${g.nextId++}`, x: enemy.x - 12, y: enemy.y, type: 'heal', rarity: 'common', name: 'Meat', amount: 28 + g.act * 7, radius: 11 });
  if (enemy.boss) record(g, `${enemy.name} defeated!`);
}

function areaDamage(g, x, y, radius, damage, options = {}) {
  let hits = 0;
  for (const enemy of g.enemies) {
    if (enemy.hp > 0 && hypot(enemy.x - x, enemy.y - y) <= radius + enemy.radius) {
      damageEnemy(g, enemy, damage, { ...options, origin: { x, y } });
      hits++;
    }
  }
  return hits;
}

function lineDamage(g, ax, ay, bx, by, width, damage, options = {}) {
  let hits = 0;
  for (const enemy of g.enemies) {
    if (enemy.hp > 0 && segmentDistance(enemy.x, enemy.y, ax, ay, bx, by) <= width + enemy.radius) {
      damageEnemy(g, enemy, damage, options);
      hits++;
    }
  }
  return hits;
}

function coneDamage(g, x, y, angle, radius, arc, damage, options = {}) {
  let hits = 0;
  for (const enemy of g.enemies) {
    const d = hypot(enemy.x - x, enemy.y - y);
    const allowance = Math.asin(Math.min(1, enemy.radius / Math.max(1, d)));
    if (enemy.hp > 0 && d <= radius + enemy.radius && Math.abs(angleDifference(Math.atan2(enemy.y - y, enemy.x - x), angle)) <= arc / 2 + allowance) {
      damageEnemy(g, enemy, damage, options);
      hits++;
    }
  }
  return hits;
}

function castTarget(g, target) {
  return {
    x: finite(target?.x, g.player.x + Math.cos(g.player.facing) * 140),
    y: finite(target?.y, g.player.y + Math.sin(g.player.facing) * 140),
  };
}

function scheduleArea(g, delay, target, radius, damage, kind, options = {}) {
  g.pending.push({ remaining: delay, x: target.x, y: target.y, radius, damage, kind, color: g.character.color, options });
}

export function useAbility(g, slot, target) {
  if (!active(g) || !Number.isInteger(slot) || slot < 0 || slot > 2 || g.player.hp <= 0) return false;
  const p = g.player;
  const ability = g.character.abilities[slot];
  if (p.cooldowns[slot] > 0 || p.dodgeTime > 0 || p.energy < (ability.cost || 0)) return false;
  const point = castTarget(g, target);
  const angle = Math.atan2(point.y - p.y, point.x - p.x);
  const s = getStats(g);
  p.facing = angle;
  g.aim = { ...point };
  p.energy -= ability.cost || 0;
  p.cooldowns[slot] = ability.cooldown * s.cooldownMultiplier;
  const c = g.character.color;
  const reach = s.reach;
  if (slot === 0) {
    let hits = 0;
    if (g.characterId === 'luffy') {
      const length = 235 * reach;
      const endX = p.x + Math.cos(angle) * length;
      const endY = p.y + Math.sin(angle) * length;
      hits = lineDamage(g, p.x, p.y, endX, endY, 22 * reach, BASE.luffy.damage, { knockback: 6 });
      effect(g, 'punch', p.x, p.y, 27, c, 0.2, { angle, length });
    } else {
      const radius = (g.characterId === 'whitebeard' ? 169 : g.characterId === 'zoro' ? 132 : 143) * reach;
      const arc = g.characterId === 'whitebeard' ? 2.25 : g.characterId === 'zoro' ? 1.95 : 1.75;
      hits = coneDamage(g, p.x, p.y, angle, radius, arc, BASE[g.characterId].damage,
        { knockback: g.characterId === 'whitebeard' ? 17 : 4, stun: g.characterId === 'whitebeard' ? 0.15 : 0 });
      effect(g, g.characterId === 'zoro' ? 'swords' : 'slash', p.x, p.y, radius, c, 0.22, { angle, arc });
    }
    if (hits) p.energy = Math.min(p.maxEnergy, p.energy + 8 + Math.min(3, hits - 1) * 2);
  } else if (slot === 1) {
    if (g.characterId === 'luffy') {
      for (let i = 0; i < 5; i++) scheduleArea(g, i * 0.12, point, 137 * reach, 28, 'gatling', { knockback: 3 });
      effect(g, 'gatling', point.x, point.y, 137 * reach, c, 0.8, { angle });
    } else if (g.characterId === 'zoro') {
      const start = { x: p.x, y: p.y };
      const length = Math.min(distance(p, point), 300 * reach);
      moveUnit(g, p, Math.cos(angle) * length, Math.sin(angle) * length);
      lineDamage(g, start.x, start.y, p.x, p.y, 48 * reach, 124, { stun: 0.55 });
      p.invulnerable = Math.max(p.invulnerable, 0.4);
      effect(g, 'swords', start.x, start.y, 52, c, 0.45, { angle, length: distance(start, p) });
    } else if (g.characterId === 'whitebeard') {
      areaDamage(g, point.x, point.y, 180 * reach, 132, { stun: 1.05, slow: 2.5, knockback: 25 });
      effect(g, 'quake', point.x, point.y, 180 * reach, c, 0.85, { angle });
    } else {
      g.projectiles.push({ id: `projectile-${g.nextId++}`, x: p.x, y: p.y,
        vx: Math.cos(angle) * 850, vy: Math.sin(angle) * 850, radius: 29 * reach,
        color: c, hostile: false, damage: 151, life: 0.86 * reach, pierced: [], kind: 'haki', angle });
      effect(g, 'slash', p.x, p.y, 100, c, 0.25, { angle });
    }
  } else {
    if (g.characterId === 'luffy') {
      areaDamage(g, point.x, point.y, 230 * reach, 236, { stun: 1.35, knockback: 58 });
      p.empowered = 7;
      effect(g, 'shockwave', point.x, point.y, 230 * reach, '#fff1bc', 1.1, { angle });
      record(g, 'Gear Five! Damage and speed increased for 7 seconds.');
    } else if (g.characterId === 'zoro') {
      areaDamage(g, point.x, point.y, 218 * reach, 189, { stun: 0.8 });
      for (let i = 1; i <= 4; i++) scheduleArea(g, i * 0.4, point, 218 * reach, 28, 'swords', { slow: 1.5 });
      effect(g, 'swords', point.x, point.y, 218 * reach, c, 1.8, { angle });
    } else if (g.characterId === 'whitebeard') {
      areaDamage(g, point.x, point.y, 290 * reach, 160, { stun: 1.4, knockback: 30 });
      scheduleArea(g, 0.7, point, 420 * reach, 160, 'shockwave', { stun: 0.7, knockback: 30 });
      effect(g, 'quake', point.x, point.y, 420 * reach, c, 1.5, { angle });
    } else {
      areaDamage(g, point.x, point.y, 295 * reach, 253, { stun: 3, slow: 4, knockback: 25 });
      effect(g, 'haki', point.x, point.y, 295 * reach, c, 1.4, { angle });
      effect(g, 'lightning', point.x, point.y, 295 * reach, '#ffbcc4', 0.8, { angle });
    }
  }
  settleCombat(g);
  return true;
}

function beginDodge(g, input, s) {
  const p = g.player;
  if (p.dodgeCooldown > 0 || p.dodgeTime > 0) return false;
  let dx = finite(input.moveX);
  let dy = finite(input.moveY);
  let d = hypot(dx, dy);
  if (d < 0.01) {
    const target = castTarget(g, input.target);
    dx = target.x - p.x;
    dy = target.y - p.y;
    d = hypot(dx, dy);
  }
  p.dodgeX = d > 0.01 ? dx / d : Math.cos(p.facing);
  p.dodgeY = d > 0.01 ? dy / d : Math.sin(p.facing);
  p.dodgeTime = 0.26;
  p.dodgeCooldown = 1.55 * s.cooldownMultiplier;
  p.invulnerable = Math.max(p.invulnerable, 0.32);
  effect(g, 'dodge', p.x, p.y, 32, g.character.color, 0.4, { angle: Math.atan2(p.dodgeY, p.dodgeX), length: 120 });
  return true;
}

function damagePlayer(g, amount, origin) {
  const p = g.player;
  if (!active(g) || p.hp <= 0 || p.invulnerable > 0 || p.dodgeTime > 0) return false;
  const actual = Math.round(amount * (1 - getStats(g).armor));
  p.hp = Math.max(0, p.hp - actual);
  p.hitFlash = 0.16;
  // Short hit protection prevents overlapping swarms from erasing a full health bar.
  p.invulnerable = 0.18;
  g.stats.damageTaken += actual;
  effect(g, 'damage', p.x, p.y - 26, 17, '#ff767f', 0.75, { text: `−${actual}` });
  if (origin) {
    const d = distance(p, origin) || 1;
    moveUnit(g, p, (p.x - origin.x) / d * 9, (p.y - origin.y) / d * 9);
  }
  if (p.hp <= 0) {
    g.status = 'dead';
    g.pending = [];
    g.choices = [];
    record(g, 'Your voyage ends here. Rise again with a new resolve.');
  }
  return true;
}

function startTelegraph(g, enemy) {
  const p = g.player;
  const angle = Math.atan2(p.y - enemy.y, p.x - enemy.x);
  let telegraph;
  if (enemy.type === 'gunner') {
    telegraph = { type: 'line', x: enemy.x, y: enemy.y, radius: 16, width: 21, length: 750, angle, duration: 0.9, remaining: 0.9, attack: 'shot' };
  } else if (enemy.boss) {
    enemy.attackCount++;
    const pattern = enemy.attackCount % (enemy.phase === 2 ? 4 : 3);
    if (pattern === 0) {
      telegraph = { type: 'circle', x: p.x, y: p.y, radius: 130 + g.act * 14, duration: 1.05, remaining: 1.05, attack: 'bombard' };
    } else if (pattern === 1) {
      telegraph = { type: 'cone', x: enemy.x, y: enemy.y, radius: 225, angle, arc: 1.8, duration: 0.85, remaining: 0.85, attack: 'cleave' };
    } else if (pattern === 2) {
      telegraph = { type: 'circle', x: enemy.x, y: enemy.y, radius: 275, duration: 1.2, remaining: 1.2, attack: 'nova' };
    } else {
      telegraph = { type: 'line', x: enemy.x, y: enemy.y, radius: 52, width: 58, length: 550, angle, duration: 0.85, remaining: 0.85, attack: 'charge' };
    }
  } else if (enemy.type === 'brute') {
    telegraph = { type: 'circle', x: enemy.x, y: enemy.y, radius: 111, duration: 0.9, remaining: 0.9, attack: 'slam' };
  } else if (enemy.type === 'captain') {
    telegraph = { type: 'cone', x: enemy.x, y: enemy.y, radius: 142, angle, arc: 1.35, duration: 0.65, remaining: 0.65, attack: 'cleave' };
  } else {
    telegraph = { type: 'cone', x: enemy.x, y: enemy.y, radius: 85, angle, arc: 1.5, duration: 0.62, remaining: 0.62, attack: 'cleave' };
  }
  enemy.telegraph = telegraph;
}

function telegraphContains(t, p) {
  if (t.type === 'circle') return hypot(p.x - t.x, p.y - t.y) <= t.radius + p.radius;
  if (t.type === 'line') return segmentDistance(p.x, p.y, t.x, t.y, t.x + Math.cos(t.angle) * t.length, t.y + Math.sin(t.angle) * t.length) <= (t.width || t.radius) + p.radius;
  const d = hypot(p.x - t.x, p.y - t.y);
  return d <= t.radius + p.radius && Math.abs(angleDifference(Math.atan2(p.y - t.y, p.x - t.x), t.angle)) <= (t.arc || 1.5) / 2 + Math.asin(Math.min(1, p.radius / Math.max(1, d)));
}

function enemyProjectile(g, enemy, angle, speed, damage) {
  g.projectiles.push({ id: `projectile-${g.nextId++}`, x: enemy.x, y: enemy.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    radius: enemy.boss ? 12 : 7, color: enemy.boss ? '#ff647c' : '#ffcc83', hostile: true, damage, life: 3.5, kind: 'shot', angle });
}

function releaseTelegraph(g, enemy) {
  const t = enemy.telegraph;
  enemy.telegraph = null;
  enemy.cooldown = enemy.boss ? (enemy.phase === 2 ? 1.35 : 1.75) : enemy.type === 'gunner' ? 1.65 : enemy.type === 'brute' ? 1.5 : 1.1;
  if (t.attack === 'shot') {
    enemyProjectile(g, enemy, t.angle, 340 + g.act * 20, enemy.damage);
    effect(g, 'burst', enemy.x, enemy.y, 21, '#ffce86', 0.15);
  } else if (t.attack === 'nova') {
    if (telegraphContains(t, g.player)) damagePlayer(g, enemy.damage * 1.15, enemy);
    const count = 8 + g.act * 2;
    for (let i = 0; i < count; i++) enemyProjectile(g, enemy, i / count * Math.PI * 2 + enemy.attackCount * 0.2, 195, enemy.damage * 0.65);
    effect(g, 'shockwave', t.x, t.y, t.radius, '#ff718b', 0.65);
  } else if (t.attack === 'charge') {
    // Charge uses the locked warning segment and stops at physical cover.
    const from = { x: enemy.x, y: enemy.y };
    moveUnit(g, enemy, Math.cos(t.angle) * t.length, Math.sin(t.angle) * t.length);
    if (segmentDistance(g.player.x, g.player.y, from.x, from.y, enemy.x, enemy.y) <= t.width + g.player.radius) damagePlayer(g, enemy.damage * 1.3, from);
    effect(g, 'slash', from.x, from.y, t.width, '#ff718b', 0.45, { angle: t.angle, length: distance(from, enemy) });
  } else {
    if (telegraphContains(t, g.player)) damagePlayer(g, enemy.damage * (t.attack === 'bombard' ? 1.3 : 1), { x: t.x, y: t.y });
    effect(g, t.type === 'cone' ? 'slash' : 'quake', t.x, t.y, t.radius, '#ff7b83', 0.45, { angle: t.angle, arc: t.arc });
  }
}

function updateEnemies(g, dt) {
  const p = g.player;
  for (const enemy of g.enemies) {
    if (enemy.hp <= 0 || !active(g)) continue;
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    enemy.slow = Math.max(0, enemy.slow - dt);
    enemy.stun = Math.max(0, enemy.stun - dt);
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);
    if (enemy.boss && enemy.hp < enemy.maxHp * 0.5 && enemy.phase === 1) {
      enemy.phase = 2;
      record(g, `${enemy.name} unleashes a second phase!`);
      effect(g, 'haki', enemy.x, enemy.y, 120, enemy.color, 0.9);
    }
    if (enemy.stun > 0) continue;
    if (enemy.telegraph) {
      enemy.telegraph.remaining -= dt;
      if (enemy.telegraph.remaining <= 0) releaseTelegraph(g, enemy);
      continue;
    }
    const dx = p.x - enemy.x;
    const dy = p.y - enemy.y;
    const d = hypot(dx, dy) || 1;
    const range = enemy.boss ? 235 : enemy.type === 'gunner' ? 470 : enemy.type === 'brute' ? 95 : enemy.type === 'captain' ? 119 : 70;
    if (d < range && enemy.cooldown <= 0) {
      startTelegraph(g, enemy);
      continue;
    }
    let motion = d > (enemy.type === 'gunner' ? 330 : range * 0.82) ? 1 : 0;
    if (enemy.type === 'gunner' && d < 205) motion = -0.7;
    const speed = enemy.speed * (enemy.slow > 0 ? 0.58 : 1) * (enemy.boss && enemy.phase === 2 ? 1.15 : 1);
    // Local separation prevents enemies stacking into one unreadable hitbox.
    let sx = 0;
    let sy = 0;
    for (const other of g.enemies) {
      if (enemy === other || other.hp <= 0) continue;
      const separation = distance(enemy, other);
      const desired = enemy.radius + other.radius + 8;
      if (separation > 0.01 && separation < desired) {
        const push = (desired - separation) / desired * 68;
        sx += (enemy.x - other.x) / separation * push;
        sy += (enemy.y - other.y) / separation * push;
      }
    }
    const mx = dx / d * speed * motion + sx;
    const my = dy / d * speed * motion + sy;
    const old = { x: enemy.x, y: enemy.y };
    moveUnit(g, enemy, mx * dt, my * dt);
    // Slide around cover instead of getting permanently wedged on its centerline.
    if (motion && distance(old, enemy) < speed * dt * 0.35) {
      const sign = Number(enemy.id.split('-')[1]) % 2 ? 1 : -1;
      moveUnit(g, enemy, -dy / d * speed * dt * sign, dx / d * speed * dt * sign);
    }
  }
}

function updateProjectiles(g, dt) {
  for (const projectile of g.projectiles) {
    if (projectile.life <= 0) continue;
    const old = { x: projectile.x, y: projectile.y };
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.life -= dt;
    if (projectile.hostile) {
      if (g.obstacles.some(o => segmentDistance(o.x, o.y, old.x, old.y, projectile.x, projectile.y) < o.radius + projectile.radius)) {
        projectile.life = 0;
      } else if (segmentDistance(g.player.x, g.player.y, old.x, old.y, projectile.x, projectile.y) <= projectile.radius + g.player.radius) {
        damagePlayer(g, projectile.damage, old);
        projectile.life = 0;
      }
    } else {
      for (const enemy of g.enemies) {
        if (enemy.hp > 0 && !projectile.pierced.includes(enemy.id) && segmentDistance(enemy.x, enemy.y, old.x, old.y, projectile.x, projectile.y) <= projectile.radius + enemy.radius) {
          projectile.pierced.push(enemy.id);
          damageEnemy(g, enemy, projectile.damage, { stun: 0.6, knockback: 12, origin: old });
        }
      }
    }
    const b = g.worldBounds;
    if (projectile.x < b.minX - 100 || projectile.x > b.maxX + 100 || projectile.y < b.minY - 100 || projectile.y > b.maxY + 100) projectile.life = 0;
  }
  g.projectiles = g.projectiles.filter(p => p.life > 0);
}

function updatePending(g, dt) {
  for (const pulse of g.pending) {
    pulse.remaining -= dt;
    if (pulse.remaining <= 0) {
      areaDamage(g, pulse.x, pulse.y, pulse.radius, pulse.damage, pulse.options);
      effect(g, pulse.kind, pulse.x, pulse.y, pulse.radius, pulse.color, 0.5);
    }
  }
  g.pending = g.pending.filter(p => p.remaining > 0);
}

function makeItem(g, boss = false) {
  const roll = random(g);
  const rarityIndex = boss ? (g.act === 3 || roll < 0.26 ? 3 : 2) : roll < 0.045 ? 3 : roll < 0.22 ? 2 : roll < 0.62 ? 1 : 0;
  const rarity = RARITIES[rarityIndex];
  const slot = choose(g, ['weapon', 'coat', 'charm']);
  const tier = 1 + rarityIndex * 0.47 + g.act * 0.22;
  const bases = {
    weapon: g.characterId === 'luffy' ? ['Dawn Gauntlets', 'Freedom Wraps', 'Sunfire Knuckles'] : g.characterId === 'whitebeard' ? ['Quake-forged Bisento', 'Tidal Naginata', 'Emperor’s Bisento'] : g.characterId === 'zoro' ? ['Demon-forged Blades', 'Ashura’s Edge', 'Emerald Wado'] : ['Crimson Gryphon', 'Emperor’s Saber', 'Haki-forged Edge'],
    coat: ['Voyager’s Coat', 'Captain’s Mantle', 'Stormguard Cloak'],
    charm: ['Vivre Card', 'Dawnstone Pendant', 'Sea King’s Sigil'],
  };
  const item = {
    id: `item-${g.nextId++}`, name: `${['Weathered', 'Resolute', 'Sovereign', 'Mythic'][rarityIndex]} ${choose(g, bases[slot])}`,
    slot, rarity, level: g.act, damage: 0, health: 0, crit: 0, speed: 0, armor: 0,
    description: '', color: RARITY_COLORS[rarity], power: 0,
  };
  if (slot === 'weapon') {
    item.damage = Math.round((0.07 * tier + between(g, 0, 0.025)) * 100) / 100;
    item.crit = rarityIndex > 0 ? Math.round(0.018 * tier * 100) / 100 : 0;
  } else if (slot === 'coat') {
    item.health = Math.round(24 * tier + between(g, 0, 12));
    item.armor = Math.round(0.016 * tier * 100) / 100;
  } else {
    item.crit = Math.round(0.035 * tier * 100) / 100;
    item.speed = Math.round(0.026 * tier * 100) / 100;
    if (rarityIndex >= 2) item.damage = Math.round(0.027 * tier * 100) / 100;
  }
  const text = [];
  if (item.damage) text.push(`+${Math.round(item.damage * 100)}% damage`);
  if (item.health) text.push(`+${item.health} health`);
  if (item.crit) text.push(`+${Math.round(item.crit * 100)}% critical chance`);
  if (item.speed) text.push(`+${Math.round(item.speed * 100)}% speed`);
  if (item.armor) text.push(`+${Math.round(item.armor * 100)}% protection`);
  item.description = text.join(' · ');
  item.power = Math.round(item.damage * 300 + item.health * 0.6 + item.crit * 250 + item.speed * 180 + item.armor * 300);
  return item;
}

function collectLoot(g, all = false) {
  const p = g.player;
  g.loot = g.loot.filter(loot => {
    if (!all && distance(p, loot) > (loot.type === 'gold' ? 100 : 67)) return true;
    if (loot.type === 'gold') g.stats.gold += loot.amount;
    if (loot.type === 'heal') {
      p.hp = Math.min(p.maxHp, p.hp + loot.amount);
      effect(g, 'heal', p.x, p.y, 35, '#92e8b4', 0.5, { text: `+${loot.amount}` });
    }
    if (loot.type === 'item') {
      const { x, y, type, radius, ...item } = loot;
      if (g.inventory.length >= 36) {
        const replaceable = g.inventory.filter(i => !Object.values(g.equipment).some(e => e?.id === i.id)).sort((a, b) => a.power - b.power)[0];
        if (replaceable && replaceable.power < item.power) {
          g.inventory = g.inventory.filter(i => i.id !== replaceable.id);
          g.stats.gold += 20 + RARITIES.indexOf(replaceable.rarity) * 15;
        } else {
          g.stats.gold += 20 + RARITIES.indexOf(item.rarity) * 15;
          record(g, `${item.name} salvaged into Berries (inventory full).`);
          return false;
        }
      }
      g.inventory.push(item);
      if (!g.equipment[item.slot]) {
        g.equipment[item.slot] = item;
        syncStats(g, true);
        record(g, `${item.name} equipped.`);
      } else record(g, `${item.rarity.toUpperCase()} loot: ${item.name}`);
      effect(g, 'loot', p.x, p.y, 45, RARITY_COLORS[item.rarity], 0.8, { text: item.name });
    }
    return false;
  });
}

function offerUpgrade(g) {
  const pool = UPGRADE_POOL.filter(u => (g.upgrades[u.key] || 0) < u.max);
  if (!pool.length) {
    g.pendingLevels = 0;
    return;
  }
  g.choices = [];
  while (g.choices.length < 3 && pool.length) {
    const index = Math.floor(random(g) * pool.length);
    const upgrade = pool.splice(index, 1)[0];
    g.choices.push({ key: upgrade.key, name: upgrade.name, description: upgrade.description, rank: (g.upgrades[upgrade.key] || 0) + 1 });
  }
  g.status = 'upgrade';
}

function settleCombat(g) {
  if (g.status === 'dead' || g.status === 'victory') return;
  g.enemies = g.enemies.filter(e => e.hp > 0);
  const p = g.player;
  while (p.xp >= p.xpNext && p.level < 15) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = Math.round(110 + (p.level - 1) * 52);
    g.pendingLevels++;
    syncStats(g, true);
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.12);
    p.energy = p.maxEnergy;
    effect(g, 'burst', p.x, p.y, 110, '#ffd585', 1.1, { text: `LEVEL ${p.level}` });
    record(g, `Level ${p.level}! Choose a new power.`);
  }
  if (p.level >= 15) p.xp = Math.min(p.xp, p.xpNext - 1);
  if (!g.enemies.length && !g.reinforcements.length && !g.roomRewarded) {
    g.roomRewarded = true;
    g.pending = [];
    g.projectiles = [];
    g.stats.roomsCleared++;
    g.stats.gold += 50 + g.room * 15;
    collectLoot(g, true);
    // Every room provides at least one equipment decision even with unlucky drops.
    const item = makeItem(g, g.room % 3 === 0);
    g.loot.push({ ...item, type: 'item', x: p.x, y: p.y, radius: 14 });
    collectLoot(g, true);
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.22);
    p.energy = p.maxEnergy;
    p.potions = Math.min(5, p.potions + 1);
    record(g, `${g.roomName} cleared. Health restored; +1 potion.`);
    if (g.room === 9) {
      g.status = 'victory';
      g.choices = [];
      g.pendingLevels = 0;
      record(g, 'The Pirate Rift is conquered. A new legend rises!');
      return;
    }
  }
  if (g.pendingLevels > 0) {
    if (g.status !== 'upgrade') offerUpgrade(g);
  } else if (!g.enemies.length && !g.reinforcements.length) g.status = 'cleared';
}

export function chooseUpgrade(g, key) {
  if (g.status !== 'upgrade' || !g.choices.some(c => c.key === key)) return false;
  const spec = UPGRADE_POOL.find(u => u.key === key);
  if (!spec || (g.upgrades[key] || 0) >= spec.max) return false;
  g.upgrades[key] = (g.upgrades[key] || 0) + 1;
  syncStats(g, true);
  if (key === 'spirit') g.player.energy = g.player.maxEnergy;
  g.pendingLevels = Math.max(0, g.pendingLevels - 1);
  g.choices = [];
  record(g, `${spec.name} learned.`);
  if (g.pendingLevels) offerUpgrade(g);
  else g.status = g.enemies.length || g.reinforcements.length ? 'playing' : 'cleared';
  return true;
}

export function equipItem(g, itemId) {
  if (g.status === 'dead' || g.status === 'victory') return false;
  const item = g.inventory.find(i => i.id === itemId);
  if (!item || !Object.hasOwn(g.equipment, item.slot) || g.equipment[item.slot]?.id === item.id) return false;
  const before = g.player.maxHp;
  g.equipment[item.slot] = item;
  syncStats(g);
  // Swapping equipment cannot repeatedly heal the player.
  if (g.player.maxHp < before) g.player.hp = Math.min(g.player.hp, g.player.maxHp);
  record(g, `${item.name} equipped.`);
  return true;
}

export function usePotion(g) {
  if (!active(g) || g.player.hp <= 0 || g.player.potions <= 0 || g.player.hp >= g.player.maxHp) return false;
  const amount = Math.round(g.player.maxHp * 0.45);
  g.player.hp = Math.min(g.player.maxHp, g.player.hp + amount);
  g.player.potions--;
  effect(g, 'heal', g.player.x, g.player.y, 65, '#97e6a5', 0.8, { text: `+${amount}` });
  record(g, 'Restorative meat restores your strength.');
  return true;
}

export function nextRoom(g) {
  if (g.status !== 'cleared' || g.enemies.some(e => e.hp > 0) || g.reinforcements.length || g.room >= 9 || g.pendingLevels > 0) return false;
  g.room++;
  g.stats.bestRoom = Math.max(g.stats.bestRoom, g.room);
  g.status = 'playing';
  g.player.cooldowns = [0, 0, g.player.cooldowns[2]];
  g.player.dodgeCooldown = 0;
  buildRoom(g);
  record(g, `Act ${g.act}: ${g.roomName}`);
  return true;
}

export function restartGame(g) {
  const fresh = createGame(g.characterId, { rng: g.rng, seed: g.seed });
  for (const key of Object.keys(g)) delete g[key];
  Object.assign(g, fresh);
  return g;
}

export function updateGame(g, dt, input = {}) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  // Ignore tab suspension catch-up; subdivide normal frames for reliable collision.
  let remaining = Math.min(dt, 0.1);
  let dodge = Boolean(input.dodge);
  while (remaining > 0.000001) {
    if (g.status !== 'playing' && g.status !== 'cleared') break;
    const step = Math.min(remaining, 1 / 60);
    remaining -= step;
    g.time += step;
    g.roomTime += step;
    const p = g.player;
    const s = syncStats(g);
    p.cooldowns = p.cooldowns.map(cd => Math.max(0, cd - step));
    p.dodgeCooldown = Math.max(0, p.dodgeCooldown - step);
    p.invulnerable = Math.max(0, p.invulnerable - step);
    p.hitFlash = Math.max(0, p.hitFlash - step);
    p.empowered = Math.max(0, p.empowered - step);
    p.energy = Math.min(p.maxEnergy, p.energy + s.energyRegen * step);
    const target = castTarget(g, input.target);
    g.aim = { ...target };
    if (distance(p, target) > 1) p.facing = Math.atan2(target.y - p.y, target.x - p.x);
    if (dodge && active(g)) beginDodge(g, input, s);
    dodge = false;
    if (p.dodgeTime > 0) {
      const movingTime = Math.min(step, p.dodgeTime);
      moveUnit(g, p, p.dodgeX * 710 * movingTime, p.dodgeY * 710 * movingTime);
      p.dodgeTime = Math.max(0, p.dodgeTime - step);
    } else {
      let mx = finite(input.moveX);
      let my = finite(input.moveY);
      const length = hypot(mx, my);
      if (length > 1) { mx /= length; my /= length; }
      moveUnit(g, p, mx * s.speed * step, my * s.speed * step);
      if (input.attack && active(g)) useAbility(g, 0, target);
    }
    for (const visual of g.effects) visual.life -= step;
    g.effects = g.effects.filter(e => e.life > 0);
    if (active(g)) {
      updateReinforcements(g, step);
      updatePending(g, step);
      updateEnemies(g, step);
      if (active(g)) updateProjectiles(g, step);
      collectLoot(g);
      settleCombat(g);
    } else if (g.status === 'cleared') collectLoot(g);
  }
}
