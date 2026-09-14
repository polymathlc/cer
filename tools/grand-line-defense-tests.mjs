import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const dataUrl = moduleUrl(await readFile(new URL('../grand-line-data.js', import.meta.url), 'utf8'));
const replaceImport = (source, name, url) => source.replace(new RegExp(`(['"])\\./${name}\\.js(?:\\?v=[^'"]+)?\\1`, 'g'), JSON.stringify(url));
const coreUrl = moduleUrl(replaceImport(await readFile(new URL('../grand-line-core.js', import.meta.url), 'utf8'), 'grand-line-data', dataUrl));
const source = replaceImport(replaceImport(await readFile(new URL('../grand-line-defense.js', import.meta.url), 'utf8'), 'grand-line-data', dataUrl), 'grand-line-core', coreUrl);
const { createCollection, addCard, setTeam } = await import(coreUrl);
const { CHARACTERS, DEFENSE_PATH, DEFENSE_PADS, DEFENSE_STAGES, createDefense, placeDefender, startDefenseWave,
  advanceDefense, completeDefenseLearning, defenseSkillCooldown, defenseStatusDuration, defensePointAt, getDefenseTargets } = await import(moduleUrl(source));

function collectionWith(ids = []) {
  const collection = createCollection();
  for (const id of ids) if (!collection.cards[id]) addCard(collection, id);
  assert.equal(setTeam(collection, [...new Set([...ids, ...collection.team])].slice(0, 5)), true);
  return collection;
}
function step(b, seconds) {
  for (let i = 0; i < Math.round(seconds / 0.05); i++) advanceDefense(b, 0.05);
}
function fixture(id = 'luffy') {
  const b = createDefense(collectionWith([id]), { seed: 918 });
  startDefenseWave(b); step(b, 0.6); b.rng = () => 0.5;
  b.spawned = b.spawnTotal; b.remainingToSpawn = 0; b.effects = [];
  const actor = b.allies.find(unit => unit.characterId === id), enemy = b.enemies[0];
  for (const unit of b.allies) {
    unit.x = 260; unit.y = 200; unit.hp = unit.maxHp; unit.shield = 0; unit.statuses = [];
    unit.actionTimer = 0; unit.energy = 100; unit.cooldowns = {};
    if (unit !== actor) unit.skills = [];
  }
  Object.assign(enemy, { hp: 100000, maxHp: 100000, shield: 0, defense: 0, progress: 0.18, moveSpeed: 0,
    range: 240, statuses: [], skills: [], passive: { type: 'none', value: 0 }, escaped: false, alive: true });
  Object.assign(enemy, defensePointAt(enemy.progress));
  return { b, actor, enemy };
}
function forceGate(b) {
  assert.equal(b.status, 'running');
  b.spawned = b.spawnTotal; b.remainingToSpawn = 0;
  for (const enemy of b.enemies) { enemy.hp = 0; enemy.alive = false; }
  advanceDefense(b, 0.05);
  assert.equal(b.status, 'learning');
}
function voyage(collection, encounter = 1, seed = 1, correct = 3) {
  const b = createDefense(collection, { encounter, seed }), waves = [];
  for (let tick = 0; tick < 5000 && !['victory', 'defeat'].includes(b.status); tick++) {
    if (b.status === 'setup') assert.equal(startDefenseWave(b), true);
    if (b.status === 'running') advanceDefense(b, 0.05);
    if (b.status === 'learning') {
      waves.push(b.waveTime);
      assert.ok(completeDefenseLearning(b, { round: b.round, total: 3, correct }));
    }
  }
  return { b, waves };
}

test('defense starts with five unique owned defenders, nine harbors and valid route geometry', () => {
  const collection = createCollection(), before = structuredClone(collection), b = createDefense(collection, { seed: 7 });
  assert.equal(b.status, 'setup'); assert.equal(b.waveCount, 3); assert.equal(b.round, 1);
  assert.equal(b.allies.length, 5); assert.equal(new Set(b.allies.map(unit => unit.padId)).size, 5);
  assert.equal(DEFENSE_STAGES.length, 9); assert.ok(DEFENSE_PADS.length >= 5);
  for (const point of [...DEFENSE_PATH, ...DEFENSE_PADS]) assert.ok(point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 600);
  assert.deepEqual(defensePointAt(0), DEFENSE_PATH[0]); assert.deepEqual(defensePointAt(1), DEFENSE_PATH.at(-1));
  assert.deepEqual(collection, before);
  assert.equal(createDefense({ ...collection, team: ['luffy', 'luffy', 'nami', 'usopp', 'chopper'] }), null);
  assert.equal(createDefense({ ...collection, team: ['kaido', 'zoro', 'nami', 'usopp', 'chopper'] }), null);
  assert.equal(createDefense(collection, { encounter: 2 }), null);
  assert.equal(createDefense(collection, { encounter: 10 }), null);
});

test('placement swaps occupied pads, rejects invalid choices, and locks during action', () => {
  const b = createDefense(createCollection()), [a, z] = b.allies, old = a.padId;
  assert.equal(placeDefender(b, a.id, z.padId), true); assert.equal(z.padId, old);
  assert.equal(new Set(b.allies.map(unit => unit.padId)).size, 5);
  assert.equal(placeDefender(b, 'unowned', a.padId), false);
  assert.equal(placeDefender(b, a.id, '__proto__'), false);
  assert.equal(startDefenseWave(b), true); assert.equal(startDefenseWave(b), false);
  assert.equal(placeDefender(b, a.id, old), false);
  forceGate(b); assert.equal(placeDefender(b, a.id, old), true);
});

test('time advances only while running and large or invalid deltas cannot jump a wave', () => {
  const b = createDefense(createCollection());
  assert.equal(advanceDefense(b, 1), false); assert.equal(b.elapsed, 0);
  startDefenseWave(b);
  for (const invalid of [NaN, Infinity, -1, 0, '1']) assert.equal(advanceDefense(b, invalid), false);
  assert.equal(advanceDefense(b, 99), true); assert.ok(Math.abs(b.elapsed - 0.25) < 1e-9);
  forceGate(b); const elapsed = b.elapsed; assert.equal(advanceDefense(b, 0.25), false); assert.equal(b.elapsed, elapsed);
});

test('fixed-step seeded movement and combat are independent of render delta partitions', () => {
  const a = createDefense(createCollection(), { seed: 61 }), z = createDefense(createCollection(), { seed: 61 });
  startDefenseWave(a); startDefenseWave(z);
  for (let i = 0; i < 100; i++) advanceDefense(a, 0.05);
  for (let i = 0; i < 20; i++) advanceDefense(z, 0.25);
  assert.deepEqual(a.enemies, z.enemies); assert.deepEqual(a.allies, z.allies); assert.deepEqual(a.stats, z.stats);
  assert.deepEqual(a.effects, z.effects);
  assert.ok(a.enemies.some(enemy => enemy.progress > 0 && enemy.x !== DEFENSE_PATH[0].x));
});

test('hostile area attacks and friendly support obey each defender’s actual range', () => {
  const f = fixture('luffy');
  f.actor.skills = [f.actor.skills[2]];
  const distant = structuredClone(f.enemy); distant.id += '-far'; distant.progress = 0.8; Object.assign(distant, defensePointAt(distant.progress)); f.b.enemies.push(distant);
  advanceDefense(f.b, 0.05);
  assert.ok(f.enemy.hp < f.enemy.maxHp); assert.equal(distant.hp, distant.maxHp);
  const h = fixture('chopper'), ally = h.b.allies[1]; h.actor.skills = [h.actor.skills[1]];
  ally.x = 900; ally.y = 500; ally.hp = 10;
  assert.equal(getDefenseTargets(h.b, h.actor, h.actor.skills[0]).includes(ally), false);
  advanceDefense(h.b, 0.05); assert.equal(ally.hp, 10);
});

test('all fifty characters use all 150 catalog abilities with real effects and world animation positions', () => {
  const animations = new Set();
  for (const character of CHARACTERS) for (const skill of character.skills) {
    const f = fixture(character.id); f.actor.skills = [skill];
    for (const ally of f.b.allies) { ally.hp = Math.max(1, Math.round(ally.maxHp * 0.45)); ally.energy = 65; }
    f.actor.energy = 100;
    if (skill.target === 'fallen-ally') { f.b.allies[1].hp = 0; f.b.allies[1].alive = false; }
    advanceDefense(f.b, 0.05);
    const effect = f.b.effects.find(entry => entry.sourceId === f.actor.id && entry.skillId === skill.id);
    assert.ok(effect, `Ability did not execute: ${skill.id}`);
    assert.equal(effect.animation, skill.animation); animations.add(effect.animation);
    assert.deepEqual(effect.source, { x: f.actor.x, y: f.actor.y });
    assert.ok(effect.targets.length && effect.targets.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    if (skill.power && ['enemy', 'all-enemies'].includes(skill.target)) assert.ok(f.enemy.hp < f.enemy.maxHp, `${skill.id} damage`);
  }
  assert.equal(animations.size, 150);
});

test('cooldowns use seconds, Spirit is spent once, and basics restore the stated twelve Spirit', () => {
  const f = fixture('zoro'), skill = f.actor.skills[1]; f.actor.skills = [skill];
  advanceDefense(f.b, 0.05);
  assert.equal(defenseSkillCooldown(skill), 5); assert.equal(f.actor.cooldowns[skill.id], 5);
  assert.equal(f.actor.energy, 70);
  const count = f.actor.attacksMade; step(f.b, 4.9); assert.equal(f.actor.attacksMade, count);
  step(f.b, 0.15); assert.equal(f.actor.attacksMade, count + 1);
  const basic = fixture('zoro'); basic.actor.skills = [basic.actor.skills[0]]; basic.actor.energy = 10;
  advanceDefense(basic.b, 0.05); assert.equal(basic.actor.energy, 22.2);
});

test('doctors heal and cleanse, revive only nearby fallen crew, and shields absorb ranged pressure', () => {
  const f = fixture('chopper'), ally = f.b.allies[1]; f.actor.skills = [f.actor.skills[1]];
  ally.hp = 20; ally.statuses = [{ type: 'poison', amount: 1, duration: 5, tickTimer: 1 }];
  advanceDefense(f.b, 0.05); assert.ok(ally.hp > 20); assert.deepEqual(ally.statuses, []);
  const revive = fixture('marco'), fallen = revive.b.allies[1]; revive.actor.skills = [revive.actor.skills[2]];
  fallen.hp = 0; fallen.alive = false; advanceDefense(revive.b, 0.05);
  assert.ok(fallen.hp > 0); assert.equal(fallen.alive, true);
  const protectedCrew = fixture('paulie'); protectedCrew.actor.skills = [protectedCrew.actor.skills[1]];
  advanceDefense(protectedCrew.b, 0.05); assert.ok(protectedCrew.b.allies.some(unit => unit.shield > 0));
  const shot = fixture(); shot.actor.skills = []; shot.actor.shield = 100;
  shot.b.allies.slice(1).forEach(unit => { unit.x = 950; unit.y = 550; });
  shot.enemy.skills = [CHARACTERS[1].skills[0]]; shot.enemy.attack = 50; shot.enemy.actionTimer = 0;
  const hp = shot.actor.hp; advanceDefense(shot.b, 0.05);
  assert.equal(shot.actor.hp, hp); assert.ok(shot.actor.shield < 100);
  shot.actor.shield = 0; shot.enemy.actionTimer = 0; advanceDefense(shot.b, 0.05); assert.ok(shot.actor.hp < hp);
});

test('stun and freeze stop route movement, slow reduces speed, and poison deals timed damage', () => {
  for (const type of ['stun', 'freeze']) {
    const f = fixture(); f.actor.skills = []; f.enemy.moveSpeed = 75;
    f.enemy.statuses = [{ type, amount: 0, duration: 0.5 }];
    const progress = f.enemy.progress; step(f.b, 0.4); assert.equal(f.enemy.progress, progress);
    step(f.b, 0.2); assert.ok(f.enemy.progress > progress);
  }
  const a = fixture(), z = fixture(); a.actor.skills = []; z.actor.skills = []; a.enemy.moveSpeed = z.enemy.moveSpeed = 75;
  z.enemy.statuses = [{ type: 'slow', amount: 0.5, duration: 5 }];
  step(a.b, 1); step(z.b, 1);
  assert.ok(Math.abs((z.enemy.progress - 0.18) / (a.enemy.progress - 0.18) - 0.5) < 1e-9);
  const poison = fixture('magellan'); poison.actor.skills = [poison.actor.skills[1]];
  advanceDefense(poison.b, 0.05); poison.actor.skills = [];
  const hp = poison.enemy.hp; step(poison.b, 1); assert.ok(poison.enemy.hp < hp);
  assert.equal(defenseStatusDuration({ duration: 3 }), 6);
});

test('burn immunity and once-per-voyage self-revival remain active in real-time defense', () => {
  const immune = fixture('ace');
  immune.actor.skills = []; immune.enemy.skills = [CHARACTERS.find(c => c.id === 'akainu').skills[0]];
  immune.b.allies.slice(1).forEach(unit => { unit.x = 950; unit.y = 550; }); immune.enemy.actionTimer = 0;
  advanceDefense(immune.b, 0.05); assert.equal(immune.actor.statuses.some(status => status.type === 'burn'), false);
  const revive = fixture('luffy'); revive.actor.skills = []; revive.actor.hp = 1;
  revive.actor.statuses = [{ type: 'burn', duration: 4, amount: 999, tickTimer: 0.05 }, { type: 'poison', duration: 4, amount: 999, tickTimer: 0.05 }];
  advanceDefense(revive.b, 0.05); assert.ok(revive.actor.hp > 0); assert.equal(revive.actor.passiveUsed, true); assert.deepEqual(revive.actor.statuses, []);
});

test('escaped raiders damage the ship and defeat still requires exactly three graded questions', () => {
  const f = fixture(); f.actor.skills = []; f.enemy.progress = 0.9999; f.enemy.moveSpeed = 75; f.enemy.leakDamage = 400;
  const before = structuredClone(f.b.collection);
  advanceDefense(f.b, 0.05);
  assert.equal(f.b.ship.hp, 0); assert.equal(f.b.status, 'learning'); assert.equal(f.b.pendingOutcome, 'defeat');
  assert.equal(f.b.stats.leaks, 1); assert.equal(f.enemy.escaped, true); assert.deepEqual(f.b.collection, before);
  assert.equal(completeDefenseLearning(f.b, { correct: 2, total: 2, round: 1 }), false);
  assert.equal(completeDefenseLearning(f.b, { correct: 3, total: 3, round: 0 }), false);
  assert.equal(completeDefenseLearning(f.b, { correct: 3, total: 3 }), false);
  assert.ok(completeDefenseLearning(f.b, { correct: 2, total: 3, round: 1 }));
  assert.equal(f.b.status, 'defeat'); assert.equal(f.b.collection.stats.correctAnswers, 2);
  assert.equal(f.b.collection.unlockedEncounter, 1); assert.equal(f.b.collection.stats.victories, 0);
});

test('every wave gates once, placement resumes after grading, and only the final grade commits victory', () => {
  const collection = createCollection(), b = createDefense(collection);
  for (let round = 1; round <= 3; round++) {
    startDefenseWave(b); forceGate(b);
    assert.equal(b.round, round); assert.equal(startDefenseWave(b), false);
    assert.equal(collection.stats.victories, 0); assert.equal(collection.unlockedEncounter, 1);
    assert.equal(completeDefenseLearning(b, { correct: 4, total: 3, round }), false);
    assert.equal(completeDefenseLearning(b, { correct: 2.5, total: 3, round }), false);
    const result = completeDefenseLearning(b, { correct: 3, total: 3, round }); assert.ok(result);
    assert.equal(result.packsEarned, 0); assert.equal(collection.packs, 0);
    assert.equal(completeDefenseLearning(b, { correct: 3, total: 3, round }), false);
    if (round < 3) { assert.equal(b.status, 'setup'); assert.equal(b.round, round + 1); assert.equal(b.learningBoost.round, round + 1); }
  }
  assert.equal(b.status, 'victory'); assert.equal(collection.stats.victories, 1); assert.equal(collection.stats.correctAnswers, 9);
  assert.deepEqual(collection.completed, [1]); assert.equal(collection.unlockedEncounter, 2); assert.equal(b.roundResults.length, 3);
  assert.equal(b.learningBoost, null); assert.equal(advanceDefense(b, 0.25), false);
});

test('answer tiers provide nonstacking next-wave attack, critical and defense bonuses and no currency', () => {
  for (let correct = 0; correct <= 3; correct++) {
    const b = createDefense(createCollection()); b.collection.gold = 77; startDefenseWave(b); forceGate(b);
    const stats = b.allies.map(unit => [unit.attack, unit.defense]);
    const result = completeDefenseLearning(b, { total: 3, correct, round: 1 });
    assert.equal(b.collection.gold, 77); assert.equal(b.collection.packs, 0);
    assert.deepEqual(b.allies.map(unit => [unit.attack, unit.defense]), stats);
    if (!correct) assert.equal(result.boost, null);
    else assert.deepEqual(result.boost, { correct, round: 2, attackMultiplier: 1 + correct * 0.1, critBonus: correct * 0.05, defenseMultiplier: 1 + correct * 0.08 });
    startDefenseWave(b); forceGate(b); assert.equal(b.learningBoost, null);
    assert.equal(completeDefenseLearning(b, { total: 3, correct: 3, round: 1 }), false);
  }
  const damageAt = (correct, rng = 0.5, enemyShot = false) => {
    const f = fixture('zoro'); f.b.rng = () => rng;
    f.b.learningBoost = { round: 1, attackMultiplier: 1 + correct * 0.1, critBonus: correct * 0.05, defenseMultiplier: 1 + correct * 0.08 };
    f.actor.skills = [f.actor.skills[0]];
    if (enemyShot) {
      f.actor.skills = []; f.enemy.skills = [CHARACTERS[1].skills[0]]; f.enemy.attack = 60; f.enemy.actionTimer = 0;
      f.b.allies.slice(1).forEach(unit => { unit.x = 950; unit.y = 550; });
    }
    const target = enemyShot ? f.actor : f.enemy, hp = target.hp;
    advanceDefense(f.b, 0.05); return { damage: hp - target.hp, critical: f.b.effects.some(effect => effect.critical) };
  };
  const base = damageAt(0).damage;
  for (let correct = 1; correct <= 3; correct++) {
    assert.ok(Math.abs(damageAt(correct).damage / base - (1 + correct * 0.1)) < 0.03);
    assert.ok(damageAt(correct, 0.5, true).damage < damageAt(0, 0.5, true).damage);
  }
  assert.equal(damageAt(0, 0.1).critical, false); assert.equal(damageAt(1, 0.1).critical, true);
});

test('natural starter voyages are winnable with useful wave pacing and stronger crews can defend late harbors', () => {
  for (const encounter of [1, 2, 3]) for (const seed of [1, 7, 19]) {
    const collection = createCollection(); collection.unlockedEncounter = 9;
    const { b, waves } = voyage(collection, encounter, seed);
    assert.equal(b.status, 'victory', `starter harbor ${encounter}, seed ${seed}`);
    assert.equal(waves.length, 3); assert.ok(waves.every(seconds => seconds >= 19 && seconds < 48));
    assert.ok(waves.reduce((sum, seconds) => sum + seconds, 0) / 3 < 35);
    assert.ok(b.stats.damageDealt > 0 && b.stats.skillsUsed > 0 && b.stats.kills > 0);
    assert.ok(b.effects.length <= 80 && b.log.length <= 14);
  }
  const collection = collectionWith(['kaido', 'whitebeard', 'akainu', 'law', 'marco']); collection.unlockedEncounter = 9;
  for (const id of collection.team) collection.cards[id].copies = 4;
  const { b } = voyage(collection, 9, 11);
  assert.equal(b.status, 'victory'); assert.equal(collection.unlockedEncounter, 9);
  assert.match(b.log[0], /All nine harbors/);
});
