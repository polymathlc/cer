import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const dataUrl = moduleUrl(await readFile(new URL('../grand-line-data.js', import.meta.url), 'utf8'));
const replaceImport = (source, name, url) => source.replace(new RegExp(`(['"])\\./${name}\\.js(?:\\?v=[^'"]+)?\\1`, 'g'), JSON.stringify(url));
const coreUrl = moduleUrl(replaceImport(await readFile(new URL('../grand-line-core.js', import.meta.url), 'utf8'), 'grand-line-data', dataUrl));
const profilesUrl = moduleUrl(await readFile(new URL('../grand-line-defense-profiles.js', import.meta.url), 'utf8'));
const source = replaceImport(replaceImport(replaceImport(await readFile(new URL('../grand-line-defense.js', import.meta.url), 'utf8'), 'grand-line-data', dataUrl), 'grand-line-core', coreUrl), 'grand-line-defense-profiles', profilesUrl);
const { createCollection, addCard, setTeam } = await import(coreUrl);
const { CHARACTERS, DEFENSE_PATH, DEFENSE_PADS, DEFENSE_STAGES, createDefense, placeDefender, startDefenseWave,
  advanceDefense, completeDefenseLearning, defenseSkillCooldown, defenseStatusDuration, defensePointAt, defenseEnemyPointAt, getDefenseTargets,
  getDefenseProfile, getDefenseSkillProfile, getDefenseWavePreview, getDefenseAreaTargets, getDefenseAttackPreview,
  summonDefender, recallDefender, upgradeDefender, specializeDefender, setDefensePriority } = await import(moduleUrl(source));

function collectionWith(ids = []) {
  const collection = createCollection();
  for (const id of ids) if (!collection.cards[id]) addCard(collection, id);
  assert.equal(setTeam(collection, [...new Set([...ids, ...collection.team])].slice(0, 5)), true);
  return collection;
}
function step(b, seconds) {
  for (let i = 0; i < Math.round(seconds / 0.05); i++) advanceDefense(b, 0.05);
}
function settleProjectiles(b) {
  for (let i = 0; i < 160 && b.projectiles.length; i++) advanceDefense(b, 0.05);
  assert.equal(b.projectiles.length, 0, 'Every launched attack resolves within eight simulated seconds');
}
function castOnce(f) {
  advanceDefense(f.b, 0.05);
  const effects = [...f.b.effects];
  for (const unit of [...f.b.allies, ...f.b.enemies]) unit.skills = [];
  settleProjectiles(f.b);
  return effects;
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
  for (let tick = 0; tick < 12000 && !['victory', 'defeat'].includes(b.status); tick++) {
    if (b.status === 'setup') {
      for (const ally of [...b.allies].sort((a, z) => a.level - z.level)) {
        if (ally.level < 5 && b.trainingPoints >= ally.level) upgradeDefender(b, ally.id);
        if (ally.level >= 3 && !ally.specialization) specializeDefender(b, ally.id, 'power');
      }
      assert.equal(startDefenseWave(b), true);
    }
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
  assert.equal(b.status, 'setup'); assert.equal(b.waveCount, 6); assert.equal(b.round, 1);
  assert.equal(b.supplies, 100); assert.equal(b.trainingPoints, 0); assert.deepEqual(b.projectiles, []);
  assert.equal(b.allies.length, 5); assert.equal(new Set(b.allies.map(unit => unit.padId)).size, 5);
  assert.equal(DEFENSE_STAGES.length, 9); assert.equal(DEFENSE_PADS.length, 10);
  assert.ok(DEFENSE_STAGES.every(stage => stage.waveCount === 6));
  assert.ok(b.allies.every(ally => ally.level === 1 && ally.specialization === null && ally.priority === 'first'));
  for (const point of [...DEFENSE_PATH, ...DEFENSE_PADS]) assert.ok(point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 600);
  assert.deepEqual(defensePointAt(0), DEFENSE_PATH[0]); assert.deepEqual(defensePointAt(1), DEFENSE_PATH.at(-1));
  assert.deepEqual(collection, before);
  assert.equal(createDefense({ ...collection, team: ['luffy', 'luffy', 'nami', 'usopp', 'chopper'] }), null);
  assert.equal(createDefense({ ...collection, team: ['kaido', 'zoro', 'nami', 'usopp', 'chopper'] }), null);
  assert.equal(createDefense(collection, { encounter: 2 }), null);
  assert.equal(createDefense(collection, { encounter: 10 }), null);
});

test('summons use any owned card independently of the saved five and reject duplicate, invalid, occupied or unaffordable choices', () => {
  const collection = createCollection(); addCard(collection, 'ace'); addCard(collection, 'kaido');
  const before = structuredClone(collection), b = createDefense(collection), empty = DEFENSE_PADS[5];
  const cost = 20 + 5 * CHARACTERS.find(c => c.id === 'ace').stars;
  for (const [id, pad] of [['mihawk', empty.id], ['marco', empty.id], ['__proto__', empty.id], ['ace', '__proto__'], ['ace', b.allies[0].padId]]) {
    assert.equal(summonDefender(b, id, pad), false);
  }
  assert.equal(b.supplies, 100); assert.equal(b.allies.length, 5);
  assert.equal(summonDefender(b, 'ace', empty.id), true);
  const summoned = b.allies.find(ally => ally.characterId === 'ace');
  assert.ok(summoned); assert.equal(summoned.padId, empty.id); assert.equal(summoned.summonCost, cost);
  assert.equal(b.supplies, 100 - cost); assert.equal(summoned.level, 1); assert.equal(summoned.specialization, null);
  assert.equal(summonDefender(b, 'ace', DEFENSE_PADS[6].id), false);
  b.supplies = 0; assert.equal(summonDefender(b, 'kaido', DEFENSE_PADS[6].id), false);
  assert.equal(b.allies.length, 6); assert.deepEqual(collection, before);
  assert.equal(startDefenseWave(b), true); b.supplies = 100;
  assert.equal(summonDefender(b, 'kaido', DEFENSE_PADS[6].id), false);
  assert.equal(recallDefender(b, summoned.id), false);
  forceGate(b); assert.equal(summonDefender(b, 'kaido', DEFENSE_PADS[6].id), false);
});

test('all ten pads can be filled, recalls refund only a bounded paid cost and repeated recalls cannot mint supplies', () => {
  const collection = createCollection();
  const extras = CHARACTERS.filter(c => !collection.cards[c.id]).slice(0, 6);
  for (const c of extras) addCard(collection, c.id);
  const b = createDefense(collection); b.supplies = 1000;
  for (let i = 0; i < 5; i++) assert.equal(summonDefender(b, extras[i].id, DEFENSE_PADS[i + 5].id), true);
  assert.equal(b.allies.length, 10); assert.equal(new Set(b.allies.map(a => a.padId)).size, 10);
  assert.equal(summonDefender(b, extras[5].id, DEFENSE_PADS[9].id), false);
  const free = b.allies[0], paid = b.allies.at(-1), paidPad = paid.padId, funds = b.supplies;
  assert.equal(recallDefender(b, free.id), true); assert.equal(b.supplies, funds, 'The initial free deployment has no refund');
  assert.equal(recallDefender(b, free.id), false); assert.equal(b.supplies, funds);
  assert.equal(recallDefender(b, paid.id), true); const refund = b.supplies - funds;
  assert.ok(refund > 0 && refund <= paid.summonCost);
  assert.equal(recallDefender(b, paid.id), false); assert.equal(b.supplies, funds + refund);
  const before = b.supplies; assert.equal(summonDefender(b, paid.characterId, paidPad), true);
  assert.ok(b.supplies < before); assert.equal(recallDefender(b, paid.id), true); assert.ok(b.supplies <= before);
});

test('training is earned only after exactly three grades, once per wave, and buys levels one through five without touching collection currency', () => {
  for (let correct = 0; correct <= 3; correct++) {
    const collection = createCollection(), before = structuredClone(collection), b = createDefense(collection), ally = b.allies[0];
    assert.equal(upgradeDefender(b, ally.id), false); assert.equal(b.trainingPoints, 0);
    startDefenseWave(b); forceGate(b);
    for (const result of [{ round: 1, total: 2, correct }, { round: 1, total: 3, correct: 4 }, { round: 0, total: 3, correct }]) {
      assert.equal(completeDefenseLearning(b, result), false); assert.equal(b.trainingPoints, 0);
    }
    assert.ok(completeDefenseLearning(b, { round: 1, total: 3, correct })); assert.equal(b.trainingPoints, 1 + correct);
    assert.equal(completeDefenseLearning(b, { round: 1, total: 3, correct }), false); assert.equal(b.trainingPoints, 1 + correct);
    b.trainingPoints = 10; const originalAttack = ally.attack;
    for (let level = 1; level < 5; level++) {
      const funds = b.trainingPoints; assert.equal(upgradeDefender(b, ally.id), true);
      assert.equal(ally.level, level + 1); assert.equal(b.trainingPoints, funds - level);
    }
    assert.ok(ally.attack > originalAttack); assert.equal(b.trainingPoints, 0);
    b.trainingPoints = 100; assert.equal(upgradeDefender(b, ally.id), false); assert.equal(b.trainingPoints, 100);
    assert.equal(upgradeDefender(b, 'missing'), false);
    assert.deepEqual(collection.cards, before.cards); assert.deepEqual(collection.team, before.team); assert.equal(collection.packs, 0);
    const next = createDefense(collection); assert.equal(next.trainingPoints, 0); assert.ok(next.allies.every(a => a.level === 1 && a.specialization === null));
  }
});

test('level-three specialization is one choice per battle; setup locks and priority values are enforced', () => {
  for (const branch of ['power', 'reach']) {
    const b = createDefense(createCollection()), ally = b.allies[0]; b.trainingPoints = 20;
    assert.equal(specializeDefender(b, ally.id, branch), false);
    assert.equal(upgradeDefender(b, ally.id), true); assert.equal(specializeDefender(b, ally.id, branch), false);
    assert.equal(upgradeDefender(b, ally.id), true);
    const before = { attack: ally.attack, range: ally.range, points: b.trainingPoints };
    assert.equal(specializeDefender(b, ally.id, 'unknown'), false); assert.equal(specializeDefender(b, ally.id, branch), true);
    assert.equal(ally.specialization, branch); assert.equal(b.trainingPoints, before.points);
    assert.ok(branch === 'power' ? ally.attack > before.attack : ally.range > before.range);
    const after = { attack: ally.attack, range: ally.range };
    for (const second of ['power', 'reach']) assert.equal(specializeDefender(b, ally.id, second), false);
    assert.deepEqual({ attack: ally.attack, range: ally.range }, after);
    for (const priority of ['first', 'strongest', 'cluster']) { assert.equal(setDefensePriority(b, ally.id, priority), true); assert.equal(ally.priority, priority); }
    assert.equal(setDefensePriority(b, ally.id, 'random'), false); assert.equal(setDefensePriority(b, 'missing', 'first'), false);
    startDefenseWave(b); assert.equal(upgradeDefender(b, ally.id), false); assert.equal(specializeDefender(b, ally.id, branch), false);
    assert.equal(setDefensePriority(b, ally.id, 'first'), true);
    forceGate(b); assert.equal(upgradeDefender(b, ally.id), false);
  }
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

test('enemies in a dense burst use distinct actual road lanes instead of unreadable overlapping positions', () => {
  const b = createDefense(createCollection(), { seed: 7 });
  b.allies.forEach(ally => { ally.skills = []; }); startDefenseWave(b); step(b, .6);
  assert.ok(b.enemies.length >= 4);
  assert.equal(new Set(b.enemies.map(e => `${e.x},${e.y}`)).size, b.enemies.length);
  for (const enemy of b.enemies) {
    assert.ok(Math.abs(enemy.laneOffset) <= 16);
    const position = defenseEnemyPointAt(enemy.progress, enemy.laneOffset);
    assert.ok(Math.abs(enemy.x - position.x) < 1e-8 && Math.abs(enemy.y - position.y) < 1e-8);
  }
});

test('every current character has three explicit usable attack footprints and accurate preview metadata', () => {
  const shapes = new Set();
  for (const character of CHARACTERS) {
    const profile = getDefenseProfile(character.id); assert.ok(profile?.label && profile.description);
    assert.ok(profile.range > 0); assert.equal(profile.skills.length, 3);
    const b = createDefense(collectionWith([character.id])), actor = b.allies[0];
    for (const skill of character.skills) {
      const geometry = getDefenseSkillProfile(actor, skill), preview = getDefenseAttackPreview(b, actor, skill);
      assert.ok(['single', 'line', 'cone', 'radial', 'splash', 'chain', 'support'].includes(geometry.shape), skill.id);
      assert.ok(geometry.speed > 0 && geometry.rangeMultiplier > 0); shapes.add(geometry.shape);
      assert.equal(preview.shape, geometry.shape); assert.deepEqual(preview.source, { x: actor.x, y: actor.y });
      assert.ok(Number.isFinite(preview.target.x) && Number.isFinite(preview.target.y));
    }
  }
  assert.equal(shapes.size, 7);
});

function areaFixture(id, index, points, range = 400) {
  const f = fixture(id); Object.assign(f.actor, { x: 100, y: 100, range });
  f.actor.skills = [CHARACTERS.find(c => c.id === id).skills[index]];
  f.b.enemies = points.map(([name, x, y], i) => ({ ...structuredClone(f.enemy), id: name, x, y, progress: i / 10 }));
  return f;
}
test('line, cone, self-centered radius, target-centered splash and bounded chains hit only their real footprint', () => {
  const cases = [
    ['zoro', 0, [['aim',250,100],['inside',320,110],['side',250,140],['behind',80,100],['far',600,100]], ['aim','inside']],
    ['luffy', 1, [['aim',250,100],['inside',200,150],['side',200,200],['behind',80,100],['far',600,100]], ['aim','inside']],
    ['luffy', 2, [['aim',250,100],['behind',50,100],['near-aim-only',340,100],['outside',100,290]], ['aim','behind']],
    ['usopp', 1, [['aim',350,100],['near-impact',410,100],['near-source',120,100],['outside',480,100]], ['aim','near-impact']],
    ['nami', 2, [['aim',200,100],['hop-two',290,100],['hop-three',380,100],['broken-chain',500,100],['side',200,240]], ['aim','hop-two','hop-three']],
    ['nami', 0, [['aim',160,100],['hop-two',220,100],['over-hop-limit',280,100]], ['aim','hop-two']],
  ];
  for (const [id, index, points, expected] of cases) {
    const f = areaFixture(id, index, points), skill = f.actor.skills[0];
    assert.deepEqual(getDefenseAreaTargets(f.b, f.actor, skill, f.b.enemies[0]).map(e => e.id), expected, `${id}-${index}`);
  }
});

test('first, strongest and cluster priorities choose materially different valid targets', () => {
  const f = areaFixture('usopp', 1, [['first',350,100],['strongest',100,350],['cluster-a',220,130],['cluster-b',235,130],['cluster-c',230,145]]);
  f.b.enemies.forEach(e => { e.maxHp = e.hp = 100; });
  f.b.enemies[0].progress = .9; f.b.enemies[1].maxHp = f.b.enemies[1].hp = 1000;
  const skill = f.actor.skills[0];
  for (const [priority, expected] of [['first','first'], ['strongest','strongest']]) {
    assert.equal(setDefensePriority(f.b, f.actor.id, priority), true);
    assert.equal(getDefenseAttackPreview(f.b, f.actor, skill).aimTargetId, expected);
  }
  assert.equal(setDefensePriority(f.b, f.actor.id, 'cluster'), true);
  const preview = getDefenseAttackPreview(f.b, f.actor, skill);
  assert.match(preview.aimTargetId, /^cluster-/); assert.equal(preview.targetIds.length, 3);
  assert.ok(preview.targetIds.every(id => id.startsWith('cluster-')));
});

test('projectile travel is authoritative: distant enemies keep full life until the moving attack reaches them', () => {
  const f = fixture('zoro'); f.b.enemies = [f.enemy]; f.b.projectiles = [];
  Object.assign(f.actor, { x: 20, y: 110 }); f.actor.skills = [f.actor.skills[0]];
  f.enemy.progress = .13; Object.assign(f.enemy, defensePointAt(f.enemy.progress));
  const hp = f.enemy.hp; advanceDefense(f.b, .05);
  assert.ok(f.b.projectiles.length > 0); assert.equal(f.enemy.hp, hp, 'Launching is not an immediate hit');
  const projectile = f.b.projectiles[0], start = { x: projectile.x, y: projectile.y };
  f.actor.skills = []; advanceDefense(f.b, .05);
  assert.equal(f.enemy.hp, hp); assert.ok(projectile.x !== start.x || projectile.y !== start.y);
  settleProjectiles(f.b); assert.ok(f.enemy.hp < hp, 'Impact applies actual damage after travel');
});

test('dense waves keep thirty-plus enemies, varied threats and an actual area-damage advantage over one-target shots', () => {
  const b = createDefense(createCollection()), counts = [32,40,48,56,64,72], types = new Set();
  for (let wave = 1; wave <= 6; wave++) {
    const preview = getDefenseWavePreview(b); assert.equal(preview.total, counts[wave - 1]);
    assert.equal(preview.groups.reduce((sum, g) => sum + g.count, 0), preview.total);
    preview.groups.forEach(g => types.add(g.type)); startDefenseWave(b);
    assert.equal(b.spawnTotal, preview.total); forceGate(b); completeDefenseLearning(b, { round: wave, total: 3, correct: 3 });
  }
  for (const type of ['swarm','runner','armored','captain']) assert.ok(types.has(type));
  const crowdDamage = (id, index) => {
    const f = fixture(id); f.b.projectiles = []; Object.assign(f.actor, { x: 20, y: 110, attack: 100, range: 300, priority: 'strongest' });
    f.actor.skills = [{ ...CHARACTERS.find(c => c.id === id).skills[index], power: 1, effects: [], cost: 0 }];
    f.b.enemies = Array.from({ length: 32 }, (_, i) => {
      const e = structuredClone(f.enemy); Object.assign(e, { id: 'crowd-'+i, hp: 10000, maxHp: 10000, progress: .045 + i * .0025 });
      return Object.assign(e, defensePointAt(e.progress));
    });
    const outside = Object.assign(structuredClone(f.enemy), { id: 'outside-footprint', hp: 9000, maxHp: 9000, progress: .24 });
    Object.assign(outside, defensePointAt(outside.progress)); f.b.enemies.push(outside);
    castOnce(f); assert.equal(outside.hp, outside.maxHp, `${id}-${index} leaves an enemy outside the real footprint unharmed`);
    return { hits: f.b.enemies.filter(e => e.hp < e.maxHp).length, damage: f.b.enemies.reduce((sum,e) => sum + e.maxHp - e.hp, 0) };
  };
  const single = crowdDamage('usopp', 0), line = crowdDamage('zoro', 0), splash = crowdDamage('usopp', 1);
  assert.equal(single.hits, 1); assert.ok(line.hits >= 20 && splash.hits >= 12);
  assert.ok(line.damage >= single.damage * 10 && splash.damage >= single.damage * 10);
});

test('recalling a trained specialist preserves the paid battle investment without refreshing life or minting another grant', () => {
  const b = createDefense(createCollection()), ally = b.allies[0], pad = ally.padId;
  b.trainingPoints = 3; upgradeDefender(b, ally.id); upgradeDefender(b, ally.id); specializeDefender(b, ally.id, 'power');
  ally.hp = 1; ally.passiveUsed = true;
  const before = { attack: ally.attack, points: b.trainingPoints, supplies: b.supplies };
  assert.equal(recallDefender(b, ally.id), true); assert.equal(b.supplies, before.supplies);
  assert.equal(summonDefender(b, ally.characterId, pad), true);
  const returned = b.allies.find(a => a.characterId === ally.characterId);
  assert.equal(returned.level, 3); assert.equal(returned.specialization, 'power'); assert.equal(returned.attack, before.attack);
  assert.equal(returned.hp, 1); assert.equal(returned.passiveUsed, true); assert.equal(b.trainingPoints, before.points);
});

test('hostile area attacks and friendly support obey each defender’s actual range', () => {
  const f = fixture('luffy');
  f.actor.skills = [f.actor.skills[2]];
  const distant = structuredClone(f.enemy); distant.id += '-far'; distant.progress = 0.8; Object.assign(distant, defensePointAt(distant.progress)); f.b.enemies.push(distant);
  castOnce(f);
  assert.ok(f.enemy.hp < f.enemy.maxHp); assert.equal(distant.hp, distant.maxHp);
  const h = fixture('chopper'), ally = h.b.allies[1]; h.actor.skills = [h.actor.skills[1]];
  ally.x = 900; ally.y = 500; ally.hp = 10;
  assert.equal(getDefenseTargets(h.b, h.actor, h.actor.skills[0]).includes(ally), false);
  castOnce(h); assert.equal(ally.hp, 10);
});

test('all fifty characters use all 150 catalog abilities with real effects and world animation positions', () => {
  const animations = new Set();
  for (const character of CHARACTERS) for (const skill of character.skills) {
    const f = fixture(character.id); f.actor.skills = [skill];
    for (const ally of f.b.allies) { ally.hp = Math.max(1, Math.round(ally.maxHp * 0.45)); ally.energy = 65; }
    f.actor.energy = 100;
    if (skill.target === 'fallen-ally') { f.b.allies[1].hp = 0; f.b.allies[1].alive = false; }
    const castEffects = castOnce(f);
    const effect = [...castEffects, ...f.b.effects].find(entry => entry.sourceId === f.actor.id && entry.skillId === skill.id);
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
  castOnce(f); assert.ok(ally.hp > 20); assert.deepEqual(ally.statuses, []);
  const revive = fixture('marco'), fallen = revive.b.allies[1]; revive.actor.skills = [revive.actor.skills[2]];
  fallen.hp = 0; fallen.alive = false; castOnce(revive);
  assert.ok(fallen.hp > 0); assert.equal(fallen.alive, true);
  const protectedCrew = fixture('paulie'); protectedCrew.actor.skills = [protectedCrew.actor.skills[1]];
  castOnce(protectedCrew); assert.ok(protectedCrew.b.allies.some(unit => unit.shield > 0));
  const shot = fixture(); shot.actor.skills = []; shot.actor.shield = 100;
  shot.b.allies.slice(1).forEach(unit => { unit.x = 950; unit.y = 550; });
  shot.enemy.skills = [CHARACTERS[1].skills[0]]; shot.enemy.attack = 50; shot.enemy.actionTimer = 0;
  const hp = shot.actor.hp; const hostileSkill = shot.enemy.skills[0]; castOnce(shot);
  assert.equal(shot.actor.hp, hp); assert.ok(shot.actor.shield < 100);
  shot.actor.shield = 0; shot.enemy.actionTimer = 0; shot.enemy.skills = [hostileSkill]; castOnce(shot); assert.ok(shot.actor.hp < hp);
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
  castOnce(poison);
  const hp = poison.enemy.hp; step(poison.b, 1); assert.ok(poison.enemy.hp < hp);
  assert.equal(defenseStatusDuration({ duration: 3 }), 6);
});

test('burn immunity and once-per-voyage self-revival remain active in real-time defense', () => {
  const immune = fixture('ace');
  immune.actor.skills = []; immune.enemy.skills = [CHARACTERS.find(c => c.id === 'akainu').skills[0]];
  immune.b.allies.slice(1).forEach(unit => { unit.x = 950; unit.y = 550; }); immune.enemy.actionTimer = 0;
  castOnce(immune); assert.equal(immune.actor.statuses.some(status => status.type === 'burn'), false);
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
  for (let round = 1; round <= 6; round++) {
    startDefenseWave(b); forceGate(b);
    assert.equal(b.round, round); assert.equal(startDefenseWave(b), false);
    assert.equal(collection.stats.victories, 0); assert.equal(collection.unlockedEncounter, 1);
    assert.equal(completeDefenseLearning(b, { correct: 4, total: 3, round }), false);
    assert.equal(completeDefenseLearning(b, { correct: 2.5, total: 3, round }), false);
    const result = completeDefenseLearning(b, { correct: 3, total: 3, round }); assert.ok(result);
    assert.equal(result.packsEarned, 0); assert.equal(collection.packs, 0);
    assert.equal(completeDefenseLearning(b, { correct: 3, total: 3, round }), false);
    if (round < 6) { assert.equal(b.status, 'setup'); assert.equal(b.round, round + 1); assert.equal(b.learningBoost.round, round + 1); }
  }
  assert.equal(b.status, 'victory'); assert.equal(collection.stats.victories, 1); assert.equal(collection.stats.correctAnswers, 18);
  assert.deepEqual(collection.completed, [1]); assert.equal(collection.unlockedEncounter, 2); assert.equal(b.roundResults.length, 6);
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
    const effects = castOnce(f); return { damage: hp - target.hp, critical: [...effects, ...f.b.effects].some(effect => effect.critical) };
  };
  const base = damageAt(0).damage;
  for (let correct = 1; correct <= 3; correct++) {
    assert.ok(Math.abs(damageAt(correct).damage / base - (1 + correct * 0.1)) < 0.03);
    assert.ok(damageAt(correct, 0.5, true).damage < damageAt(0, 0.5, true).damage);
  }
  assert.equal(damageAt(0, 0.1).critical, false); assert.equal(damageAt(1, 0.1).critical, true);
});

test('natural starter voyages are winnable with useful wave pacing and stronger crews can defend late harbors', () => {
  for (const encounter of [1]) for (const seed of [1, 7, 19]) {
    const collection = createCollection(); collection.unlockedEncounter = 9;
    const { b, waves } = voyage(collection, encounter, seed);
    assert.equal(b.status, 'victory', `starter harbor ${encounter}, seed ${seed}`);
    assert.equal(waves.length, 6); assert.ok(waves.every(seconds => seconds >= 10 && seconds < 100));
    assert.ok(b.stats.damageDealt > 0 && b.stats.skillsUsed > 0 && b.stats.kills > 0);
    assert.ok(b.effects.length <= 80 && b.log.length <= 14);
  }
  const collection = collectionWith(['kaido', 'whitebeard', 'akainu', 'law', 'marco']); collection.unlockedEncounter = 9;
  for (const id of collection.team) collection.cards[id].copies = 4;
  const { b } = voyage(collection, 9, 11);
  assert.equal(b.status, 'victory'); assert.equal(collection.unlockedEncounter, 9);
  assert.match(b.log[0], /All nine harbors/);
});
