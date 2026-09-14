import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// A data URL also works in the repositories that do not declare ESM globally.
const source = await readFile(new URL('../pirate-rift-core.js', import.meta.url), 'utf8');
const { CHARACTERS, createGame, updateGame, useAbility, chooseUpgrade, equipItem, usePotion, nextRoom, restartGame, getStats } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function seeded(seed = 847) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function game(id = 'luffy') {
  const g = createGame(id, { rng: seeded() });
  g.obstacles = [];
  g.player.x = 0;
  g.player.y = 0;
  g.player.invulnerable = 0;
  return g;
}

function enemy(g, x, y, overrides = {}) {
  return { ...g.enemies[0], id: `test-${x}-${y}`, x, y, hp: 1000, maxHp: 1000, cooldown: 100,
    radius: 18, speed: 0, stun: 0, slow: 0, telegraph: null, ...overrides };
}

function advance(g, seconds, input = {}) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) updateGame(g, 1 / 60, input);
}

test('four characters have independent, complete kits and deterministic rooms', () => {
  assert.deepEqual(CHARACTERS.map(c => c.id), ['luffy', 'zoro', 'whitebeard', 'shanks']);
  for (const c of CHARACTERS) {
    assert.equal(c.abilities.length, 3);
    assert.equal(createGame(c.id).characterId, c.id);
  }
  const a = createGame('zoro', { rng: seeded(99) });
  const b = createGame('zoro', { rng: seeded(99) });
  assert.deepEqual(a.enemies, b.enemies);
  assert.deepEqual(a.obstacles, b.obstacles);
  assert.equal(createGame('unknown').characterId, 'luffy');
});

test('basic attacks face the supplied cursor and reject enemies behind the player', () => {
  for (const c of CHARACTERS) {
    const g = game(c.id);
    const ahead = enemy(g, 80, 0);
    const behind = enemy(g, -100, 0);
    g.enemies = [ahead, behind];
    assert.equal(useAbility(g, 0, { x: 300, y: 0 }), true);
    assert.ok(ahead.hp < 1000, `${c.id} hits ahead`);
    assert.equal(behind.hp, 1000, `${c.id} does not hit behind`);
    assert.equal(g.player.facing, 0);
    assert.equal(useAbility(g, 0, { x: 300, y: 0 }), false);
  }
});

test('rubber punch reaches distant targets while sword attacks require proximity', () => {
  const luffy = game();
  luffy.enemies = [enemy(luffy, 215, 0)];
  useAbility(luffy, 0, { x: 400, y: 0 });
  assert.ok(luffy.enemies[0].hp < 1000);
  const zoro = game('zoro');
  zoro.enemies = [enemy(zoro, 215, 0)];
  useAbility(zoro, 0, { x: 400, y: 0 });
  assert.equal(zoro.enemies[0].hp, 1000);
});

test('Gatling snapshots its exact cursor position for every delayed strike', () => {
  const g = game();
  const fixedTarget = { x: 310, y: -145 };
  g.enemies = [enemy(g, fixedTarget.x, fixedTarget.y)];
  assert.equal(useAbility(g, 1, fixedTarget), true);
  const pulsePositions = g.pending.map(p => ({ x: p.x, y: p.y }));
  assert.deepEqual(pulsePositions, Array(5).fill(fixedTarget));
  fixedTarget.x = -300;
  g.player.x = -300;
  advance(g, 0.8, { target: { x: -450, y: 250 } });
  assert.ok(g.enemies[0].hp < 900);
  const gatling = g.effects.filter(e => e.kind === 'gatling');
  assert.ok(gatling.every(e => e.x === 310 && e.y === -145));
});

test('area abilities preserve the exact clicked point', () => {
  for (const id of ['whitebeard', 'shanks', 'luffy', 'zoro']) {
    const g = game(id);
    const point = { x: 287, y: -139 };
    g.enemies = [enemy(g, point.x, point.y)];
    assert.equal(useAbility(g, 2, point), true);
    assert.ok(g.effects.some(e => e.x === point.x && e.y === point.y && e.kind !== 'damage'));
    assert.deepEqual(g.aim, point);
  }
});

test('Divine Departure pierces enemies once each and preserves its launch direction', () => {
  const g = game('shanks');
  const near = enemy(g, 170, 0);
  const far = enemy(g, 360, 0);
  const wrong = enemy(g, 0, 180);
  g.enemies = [near, far, wrong];
  useAbility(g, 1, { x: 500, y: 0 });
  assert.equal(g.projectiles[0].vy, 0);
  advance(g, 0.6, { target: { x: 0, y: 500 } });
  assert.ok(near.hp < 1000 && far.hp < 1000);
  assert.equal(wrong.hp, 1000);
  assert.ok(near.hp >= 698, 'projectile cannot damage the same target every frame');
});

test('signature and ultimate costs, cooldowns, regeneration, and basic Spirit restoration', () => {
  const g = game('zoro');
  g.enemies = [enemy(g, 70, 0)];
  g.player.energy = 27;
  assert.equal(useAbility(g, 1, { x: 150, y: 0 }), false);
  assert.equal(g.player.cooldowns[1], 0);
  g.player.energy = 70;
  assert.equal(useAbility(g, 2, { x: 70, y: 0 }), true);
  assert.equal(g.player.energy, 0);
  assert.equal(useAbility(g, 2, { x: 70, y: 0 }), false);
  advance(g, 1);
  assert.ok(g.player.energy >= 5.9 && g.player.energy < 7);
  assert.ok(g.player.cooldowns[2] > 15);
  const before = g.player.energy;
  useAbility(g, 0, { x: 70, y: 0 });
  assert.ok(g.player.energy >= before + 8);
});

test('movement normalizes diagonals, remains in bounds, and cannot tunnel through obstacles', () => {
  const a = game();
  const b = game();
  advance(a, 0.3, { moveX: 1, moveY: 0 });
  advance(b, 0.3, { moveX: 1, moveY: 1 });
  assert.ok(Math.abs(Math.hypot(a.player.x, a.player.y) - Math.hypot(b.player.x, b.player.y)) < 0.01);
  const c = game();
  c.obstacles = [{ x: 95, y: 0, radius: 35 }];
  advance(c, 1, { moveX: 1 });
  assert.ok(c.player.x <= 95 - 35 - c.player.radius + 0.001);
  updateGame(c, 0.1, { moveX: 1, dodge: true });
  assert.ok(c.player.x <= 95 - 35 - c.player.radius + 0.001);
  c.player.x = 599;
  c.player.y = 400;
  advance(c, 1, { moveX: 1, moveY: 1 });
  assert.ok(c.player.x <= c.worldBounds.maxX - c.player.radius);
  assert.ok(c.player.y <= c.worldBounds.maxY - c.player.radius);
});

test('Onigiri damages only its reachable path and stops at physical cover', () => {
  const g = game('zoro');
  g.obstacles = [{ x: 160, y: 0, radius: 35 }];
  const near = enemy(g, 60, 0);
  const far = enemy(g, 250, 0);
  g.enemies = [near, far];
  useAbility(g, 1, { x: 400, y: 0 });
  assert.ok(g.player.x <= 160 - 35 - g.player.radius + 0.001);
  assert.ok(near.hp < 1000);
  assert.equal(far.hp, 1000);
  assert.ok(g.player.invulnerable >= 0.39);
});

test('enemy strikes resolve after readable warnings, with locked positions', () => {
  const g = game();
  const e = enemy(g, 50, 0, { cooldown: 0, damage: 20 });
  g.enemies = [e];
  updateGame(g, 1 / 60, {});
  assert.ok(e.telegraph);
  assert.ok(e.telegraph.duration >= 0.6);
  const hp = g.player.hp;
  advance(g, 0.3);
  assert.equal(g.player.hp, hp);
  advance(g, 0.4);
  assert.ok(g.player.hp < hp);
  const escaped = game();
  const attacker = enemy(escaped, 50, 0, { cooldown: 0, damage: 20 });
  escaped.enemies = [attacker];
  updateGame(escaped, 1 / 60);
  const angle = attacker.telegraph.angle;
  advance(escaped, 0.7, { moveY: 1 });
  assert.equal(escaped.player.hp, escaped.player.maxHp);
  assert.ok(Number.isFinite(angle));
});

test('dodge grants invulnerability, observes a cooldown, and has bounded travel', () => {
  const g = game();
  const e = enemy(g, 60, 0, { telegraph: { x: 0, y: 0, type: 'circle', radius: 300, duration: 0.5, remaining: 0.04, attack: 'slam' }, damage: 90 });
  g.enemies = [e];
  updateGame(g, 0.1, { dodge: true, moveX: 1 });
  assert.equal(g.player.hp, g.player.maxHp);
  assert.ok(g.player.dodgeCooldown > 1.3);
  advance(g, 0.18);
  assert.ok(g.player.x >= 180 && g.player.x <= 190);
  const before = g.player.dodgeCooldown;
  updateGame(g, 1 / 60, { dodge: true, moveY: 1 });
  assert.equal(g.player.dodgeTime, 0);
  assert.ok(g.player.dodgeCooldown < before);
});

test('hostile projectiles collide with cover and use swept collision at high speed', () => {
  const g = game();
  g.enemies = [enemy(g, -300, -300)];
  g.obstacles = [{ x: 80, y: 0, radius: 22 }];
  g.projectiles.push({ x: 150, y: 0, vx: -10000, vy: 0, radius: 7, hostile: true, damage: 80, life: 2 });
  updateGame(g, 1 / 60);
  assert.equal(g.player.hp, g.player.maxHp);
  assert.equal(g.projectiles.length, 0);
  g.obstacles = [];
  g.projectiles.push({ x: 150, y: 0, vx: -10000, vy: 0, radius: 7, hostile: true, damage: 80, life: 2 });
  updateGame(g, 1 / 60);
  assert.ok(g.player.hp < g.player.maxHp);
});

test('room advancement is gated by enemies and upgrade selections; rewards happen once', () => {
  const g = game();
  assert.equal(nextRoom(g), false);
  g.reinforcements = [];
  const e = enemy(g, 50, 0, { hp: 1, maxHp: 1, xp: 110 });
  g.enemies = [e];
  assert.equal(useAbility(g, 0, { x: 50, y: 0 }), true);
  assert.equal(g.status, 'upgrade');
  assert.equal(g.player.level, 2);
  assert.equal(g.choices.length, 3);
  assert.equal(nextRoom(g), false);
  assert.equal(chooseUpgrade(g, 'fake'), false);
  assert.equal(chooseUpgrade(g, g.choices[0].key), true);
  assert.equal(g.status, 'cleared');
  assert.equal(g.stats.roomsCleared, 1);
  const gold = g.stats.gold;
  const potions = g.player.potions;
  advance(g, 2);
  assert.equal(g.stats.gold, gold);
  assert.equal(g.player.potions, potions);
  assert.ok(g.inventory.length >= 1);
  assert.equal(nextRoom(g), true);
  assert.equal(g.room, 2);
  assert.equal(g.status, 'playing');
  assert.ok(g.enemies.length > 0);
});

test('upgrades alter real combat stats and pause the simulation while choosing', () => {
  const g = game();
  g.pendingLevels = 1;
  g.status = 'upgrade';
  g.choices = [{ key: 'power', name: 'Power', description: '' }];
  const stats = getStats(g);
  const time = g.time;
  const position = { x: g.player.x, y: g.player.y };
  updateGame(g, 0.1, { moveX: 1, attack: true, dodge: true });
  assert.equal(g.time, time);
  assert.equal(g.player.x, position.x);
  assert.equal(useAbility(g, 1, { x: 0, y: 0 }), false);
  assert.equal(chooseUpgrade(g, 'power'), true);
  assert.ok(getStats(g).damage > stats.damage);
  assert.equal(g.status, 'playing');
});

test('multiple earned levels require every choice before combat can resume', () => {
  const g = game();
  g.player.xp = 110 + 162 + 214;
  updateGame(g, 1 / 60);
  assert.equal(g.player.level, 4);
  assert.equal(g.pendingLevels, 3);
  const pausedAt = g.time;
  for (let remaining = 3; remaining > 0; remaining--) {
    assert.equal(g.status, 'upgrade');
    assert.equal(g.pendingLevels, remaining);
    assert.equal(g.choices.length, 3);
    updateGame(g, 0.1, { moveX: 1, attack: true });
    assert.equal(g.time, pausedAt);
    assert.equal(chooseUpgrade(g, g.choices[0].key), true);
  }
  assert.equal(g.status, 'playing');
  assert.equal(g.choices.length, 0);
  assert.equal(Object.values(g.upgrades).reduce((sum, rank) => sum + rank, 0), 3);
});

test('equipping loot changes stats without allowing repeated health restoration', () => {
  const g = game();
  const strong = { id: 'coat-strong', name: 'Strong coat', slot: 'coat', rarity: 'epic', health: 90, damage: 0, crit: 0, speed: 0 };
  const weak = { id: 'coat-weak', name: 'Weak coat', slot: 'coat', rarity: 'common', health: 30, damage: 0, crit: 0, speed: 0 };
  g.inventory.push(strong, weak);
  g.player.hp = 100;
  assert.equal(equipItem(g, strong.id), true);
  assert.equal(g.player.maxHp, 330);
  assert.equal(g.player.hp, 100);
  assert.equal(equipItem(g, weak.id), true);
  assert.equal(equipItem(g, strong.id), true);
  assert.equal(g.player.hp, 100);
  assert.equal(equipItem(g, 'not-found'), false);
  assert.equal(equipItem(g, strong.id), false);
});

test('potions heal and consume charges only when useful', () => {
  const g = game();
  assert.equal(usePotion(g), false);
  assert.equal(g.player.potions, 3);
  g.player.hp = 40;
  assert.equal(usePotion(g), true);
  assert.equal(g.player.potions, 2);
  assert.equal(g.player.hp, 148);
  g.player.potions = 0;
  assert.equal(usePotion(g), false);
});

test('death stops abilities, motion, potions, upgrades and simulation; restart fully resets', () => {
  const g = game();
  g.player.hp = 1;
  g.projectiles.push({ x: 0, y: 0, vx: 1, vy: 0, radius: 8, hostile: true, damage: 999, life: 1 });
  updateGame(g, 1 / 60);
  assert.equal(g.status, 'dead');
  const time = g.time;
  const x = g.player.x;
  assert.equal(useAbility(g, 0, { x: 50, y: 0 }), false);
  assert.equal(usePotion(g), false);
  assert.equal(nextRoom(g), false);
  assert.equal(chooseUpgrade(g, 'power'), false);
  advance(g, 1, { moveX: 1, attack: true, dodge: true });
  assert.equal(g.time, time);
  assert.equal(g.player.x, x);
  assert.equal(restartGame(g), g);
  assert.equal(g.status, 'playing');
  assert.equal(g.player.hp, g.player.maxHp);
  assert.equal(g.room, 1);
  assert.equal(g.stats.kills, 0);
});

test('all nine rooms and three bosses resolve to victory with complete rewards', () => {
  const g = game('whitebeard');
  const themes = new Set();
  let bosses = 0;
  for (let room = 1; room <= 9; room++) {
    assert.equal(g.room, room);
    assert.equal(g.act, Math.ceil(room / 3));
    themes.add(g.roomTheme);
    bosses += g.enemies.filter(e => e.boss).length;
    // Defeat every wave through the real kill/reinforcement/reward/upgrade flow.
    for (let wave = 0; wave < 4 && g.status !== 'cleared' && g.status !== 'victory'; wave++) {
      for (const e of g.enemies) { e.x = 30; e.y = 0; e.hp = 1; }
      g.player.x = 0;
      g.player.y = 0;
      g.player.cooldowns = [0, 0, 0];
      useAbility(g, 0, { x: 100, y: 0 });
      while (g.status === 'upgrade') chooseUpgrade(g, g.choices[0].key);
      if (g.reinforcements.length) advance(g, 8);
    }
    assert.equal(g.stats.roomsCleared, room);
    if (room < 9) {
      assert.equal(g.status, 'cleared');
      assert.equal(nextRoom(g), true);
    }
  }
  assert.equal(bosses, 3);
  assert.equal(themes.size, 3);
  assert.equal(g.status, 'victory');
  assert.equal(g.stats.bosses, 3);
  assert.ok(g.stats.gold > 1000);
  assert.ok(g.inventory.some(i => i.rarity === 'legendary'));
  assert.equal(nextRoom(g), false);
  assert.equal(useAbility(g, 0, { x: 100, y: 0 }), false);
});

test('reinforcement waves prevent premature clears and grant a readable arrival grace period', () => {
  const g = game();
  g.enemies = [enemy(g, 50, 0, { hp: 1, xp: 0 })];
  useAbility(g, 0, { x: 50, y: 0 });
  assert.equal(g.status, 'playing');
  assert.equal(nextRoom(g), false);
  assert.equal(g.stats.roomsCleared, 0);
  advance(g, 7.8);
  assert.equal(g.wave, 1);
  advance(g, 0.1);
  assert.equal(g.wave, 2);
  assert.ok(g.enemies.length > 0);
  assert.ok(g.enemies.every(e => e.cooldown > 1 && e.stun > 0));
  assert.ok(g.enemies.every(e => Math.hypot(e.x - g.player.x, e.y - g.player.y) > 150));
});

test('room rewards collect distant drops and cleared rooms allow remaining pickups', () => {
  const g = game();
  g.reinforcements = [];
  g.loot = [{ id: 'distant', x: -500, y: -400, type: 'gold', amount: 100, rarity: 'common', name: 'Berries' }];
  g.enemies = [enemy(g, 50, 0, { hp: 1, xp: 0 })];
  useAbility(g, 0, { x: 50, y: 0 });
  assert.equal(g.status, 'cleared');
  assert.ok(g.stats.gold >= 165);
  assert.equal(g.loot.length, 0);
  g.loot.push({ id: 'extra', x: 0, y: 0, type: 'gold', amount: 27, rarity: 'common', name: 'Berries' });
  const before = g.stats.gold;
  updateGame(g, 1 / 60);
  assert.equal(g.stats.gold, before + 27);
  assert.equal(g.loot.length, 0);
});

test('bad input and long frames cannot corrupt the simulation or cause catch-up damage', () => {
  const g = game();
  updateGame(g, NaN, { moveX: Infinity });
  assert.equal(g.time, 0);
  updateGame(g, -1);
  assert.equal(g.time, 0);
  updateGame(g, 60, { moveX: Infinity, moveY: NaN, target: { x: Infinity, y: NaN } });
  assert.ok(g.time <= 0.100001);
  assert.ok(Number.isFinite(g.player.x) && Number.isFinite(g.player.y) && Number.isFinite(g.player.facing));
  assert.equal(useAbility(g, 4, { x: 0, y: 0 }), false);
  assert.equal(useAbility(g, '1', { x: 0, y: 0 }), false);
});
