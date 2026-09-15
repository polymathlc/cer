import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const dataSource = await readFile(new URL('../grand-line-data.js', import.meta.url), 'utf8');
const dataUrl = `data:text/javascript;base64,${Buffer.from(dataSource).toString('base64')}`;
const source = (await readFile(new URL('../grand-line-core.js', import.meta.url), 'utf8')).replace(/(['"])\.\/grand-line-data\.js(?:\?v=[^'"]+)?\1/, `'${dataUrl}'`);
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { CHARACTERS, CHARACTER_BY_ID, PACK_ODDS, STARTER_IDS, ENCOUNTERS, createCollection, normalizeCollection, openPack, addCard, setTeam, statsFor,
  createBattle, act, advanceBattle, chooseDefend, completeLearning, grantLearningReward, getActiveUnit, getValidTargets } = api;

function collectionWith(ids) {
  const c = createCollection();
  for (const id of ids) if (!c.cards[id]) addCard(c, id);
  const team = [...new Set([...ids, ...STARTER_IDS])].slice(0, 5);
  assert.equal(setTeam(c, team), true);
  return c;
}
function fixture(id = 'luffy') {
  const b = createBattle(collectionWith([id]), { seed: 918 });
  b.rng = () => 0.5;
  for (const e of b.enemies) { e.hp = e.maxHp = 10000; e.passive = { type: 'none', value: 0 }; }
  forceTurn(b, b.allies.find(u => u.characterId === id));
  return b;
}
function forceTurn(b, actor) {
  b.status = actor.side === 'ally' ? 'player' : 'enemy';
  b.activeId = actor.id;
  b.turnOrder = [actor.id, ...[...b.allies, ...b.enemies].filter(u => u !== actor && u.hp > 0).map(u => u.id)];
  b.turnIndex = 0;
  actor.turnsStarted++;
  actor.energy = 100;
  actor.cooldowns = Object.fromEntries(actor.skills.map(s => [s.id, 0]));
}
function finishRound(b, limit = 100) {
  for (let i = 0; i < limit && ['player', 'enemy'].includes(b.status); i++) {
    if (b.status === 'player') chooseDefend(b); else advanceBattle(b);
  }
  assert.equal(b.status, 'learning');
}

test('catalog contains exactly one hundred unique characters, 300 distinct moves, and six apex cards', () => {
  assert.equal(CHARACTERS.length, 100);
  assert.equal(new Set(CHARACTERS.map(c => c.id)).size, 100);
  assert.deepEqual(CHARACTERS.filter(c => c.stars === 7).map(c => c.name), ['Kaido the Beast', 'Whitebeard', 'Admiral Akainu', 'Charlotte Linlin · Big Mom', 'Monkey D. Garp', 'Sabo']);
  const skills = CHARACTERS.flatMap(c => c.skills);
  assert.equal(skills.length, 300);
  assert.equal(new Set(skills.map(s => s.id)).size, 300);
  assert.equal(new Set(skills.map(s => s.animation)).size, 300);
  for (const character of CHARACTERS) {
    assert.ok(character.stars >= 1 && character.stars <= 7);
    assert.equal(character.skills[0].cost, 0);
    assert.ok(character.passive.description.length > 15);
    assert.ok(character.skills.every(s => s.description.length > 10 && s.name && s.kind && s.color));
  }
});

test('pack odds sum to one, every tier is populated, and each boundary chooses the correct tier', () => {
  assert.equal(PACK_ODDS.reduce((n, e) => n + e.probability, 0), 1);
  let cumulative = 0;
  for (const entry of PACK_ODDS) {
    assert.ok(CHARACTERS.some(c => c.stars === entry.stars));
    const c = createCollection();
    c.packs = 3; // Already-purchased packs supplied by the host.
    let calls = 0;
    const result = openPack(c, () => calls++ ? 0.5 : cumulative + entry.probability / 2);
    assert.equal(result.character.stars, entry.stars);
    assert.equal(c.packs, 2);
    assert.equal(c.stats.packsOpened, 1);
    cumulative += entry.probability;
  }
});

test('single-card packs cannot be opened without charges or consume unrelated cards', () => {
  const c = createCollection();
  assert.equal(c.packs, 0);
  assert.equal(openPack(c, () => 0), null);
  c.packs = 3;
  const before = Object.values(c.cards).reduce((n, e) => n + e.copies, 0);
  for (let i = 0; i < 3; i++) assert.ok(openPack(c, () => 0));
  assert.equal(Object.values(c.cards).reduce((n, e) => n + e.copies, 0), before + 3);
  assert.equal(openPack(c, () => 0), null);
  assert.equal(c.packs, 0);
});

test('duplicate cards auto-merge at powers of two with a finite rank cap', () => {
  const c = createCollection();
  assert.equal(statsFor('luffy', 1).rank, 0);
  assert.equal(addCard(c, 'luffy').rank, 1);
  assert.equal(addCard(c, 'luffy').rank, 1);
  assert.equal(addCard(c, 'luffy').rank, 2);
  assert.equal(c.cards.luffy.copies, 4);
  assert.ok(statsFor('luffy', 4).attack > statsFor('luffy', 1).attack);
  assert.equal(statsFor('luffy', 1024).rank, 10);
  assert.deepEqual(statsFor('luffy', 1024), statsFor('luffy', 1000000));
  assert.equal(addCard(c, '__proto__'), null);
});

test('normalization rejects malformed saves, bounds counters, and repairs a five-hero team', () => {
  for (const bad of [null, 'bad', 2, [], false]) assert.deepEqual(normalizeCollection(bad), createCollection());
  const c = normalizeCollection({ cards: { kaido: { copies: 16 }, luffy: { copies: Infinity }, hacked: { copies: 100 } }, team: ['kaido', 'kaido', '__proto__'], packs: -20,
    learningProgress: 8, unlockedEncounter: 300, completed: [1, 1, 9, 10, '2'], stats: { wins: 900, correctAnswers: 4 } });
  assert.equal(c.packs, 0);
  assert.equal(c.learningProgress, undefined);
  assert.equal(c.cards.kaido.copies, 16);
  assert.equal(c.cards.luffy.copies, 1);
  assert.equal(c.cards.hacked, undefined);
  assert.equal(new Set(c.team).size, 5);
  assert.equal(c.unlockedEncounter, 9);
  assert.deepEqual(c.completed, [1, 9]);
  assert.equal(c.stats.correctAnswers, 4);
});

test('team selection accepts one to seven different owned heroes and rejects a locked campaign', () => {
  const c = createCollection();
  assert.equal(setTeam(c, ['luffy', 'luffy', 'zoro', 'nami', 'chopper']), false);
  assert.equal(setTeam(c, ['wyper', 'zoro', 'nami', 'usopp', 'chopper']), false);
  assert.equal(setTeam(c, []), false);
  assert.equal(setTeam(c, ['luffy']), true);
  assert.deepEqual(normalizeCollection(c).team, ['luffy']);
  assert.equal(createBattle(c, { encounter: 2 }), null);
  assert.equal(createBattle(c, { encounter: 10 }), null);
  addCard(c, 'wyper');
  assert.equal(setTeam(c, ['wyper', 'zoro', 'nami', 'usopp', 'chopper']), true);
  assert.ok(createBattle(c, { seed: 42 }));
  for (const hero of CHARACTERS.slice(0, 8)) addCard(c, hero.id);
  const seven = CHARACTERS.slice(0, 7).map(hero => hero.id);
  assert.equal(setTeam(c, seven), true);
  assert.deepEqual(normalizeCollection(c).team, seven, 'All seven saved members survive normalization');
  const before = structuredClone(c);
  assert.equal(setTeam(c, CHARACTERS.slice(0, 8).map(hero => hero.id)), false);
  assert.deepEqual(c, before, 'An eighth member cannot mutate the saved crew');
});

test('battle initiative and units are reproducible and snapshot owned-card stats', () => {
  const c = createCollection();
  const b = createBattle(c, { seed: 2026 });
  const other = createBattle(createCollection(), { seed: 2026 });
  assert.deepEqual(b.turnOrder, other.turnOrder);
  assert.deepEqual(b.allies, other.allies);
  const before = b.allies[0].attack;
  for (let i = 0; i < 20; i++) addCard(c, 'luffy');
  assert.equal(b.allies[0].attack, before);
  assert.ok(createBattle(c, { seed: 2026 }).allies[0].attack > before);
});

test('only the active ally may act; invalid target, energy and cooldown failures spend nothing', () => {
  const b = fixture();
  const actor = getActiveUnit(b);
  const target = b.enemies[0];
  const before = actor.energy;
  assert.equal(act(b, 'zoro-1', target.id), false);
  assert.equal(act(b, actor.skills[1].id, actor.id), false);
  assert.equal(actor.energy, before);
  actor.energy = 2;
  assert.equal(act(b, actor.skills[1].id, target.id), false);
  actor.energy = 100;
  actor.cooldowns[actor.skills[1].id] = 1;
  assert.equal(act(b, actor.skills[1].id, target.id), false);
  actor.cooldowns[actor.skills[1].id] = 0;
  assert.equal(act(b, actor.skills[1].id, target.id), true);
  assert.ok(target.hp < target.maxHp);
  assert.equal(actor.cooldowns[actor.skills[1].id], 2);
});

test('basic attacks restore Spirit and defending adds shield and advances initiative', () => {
  const b = fixture('zoro');
  const actor = getActiveUnit(b);
  actor.energy = 10;
  act(b, actor.skills[0].id, b.enemies[0].id);
  assert.equal(actor.energy, 30);
  forceTurn(b, actor);
  actor.energy = 10;
  assert.equal(chooseDefend(b), true);
  assert.equal(actor.energy, 35);
  assert.ok(actor.shield > 0);
  assert.ok(actor.statuses.some(s => s.type === 'guard'));
  assert.notEqual(b.activeId, actor.id);
});

test('cooldowns count only the owner’s turns and become ready on the stated turn', () => {
  const b = fixture('zoro');
  const actor = getActiveUnit(b);
  const skill = actor.skills[1];
  act(b, skill.id, b.enemies[0].id);
  assert.equal(actor.cooldowns[skill.id], 2);
  finishRound(b);
  assert.equal(actor.cooldowns[skill.id], 2);
  completeLearning(b, { correct: 2, total: 3 });
  for (let i = 0; i < 20 && b.activeId !== actor.id; i++) b.status === 'player' ? chooseDefend(b) : advanceBattle(b);
  assert.equal(b.activeId, actor.id);
  assert.equal(actor.cooldowns[skill.id], 1);
  assert.equal(act(b, skill.id, b.enemies[0].id), false);
  chooseDefend(b);
  finishRound(b);
  completeLearning(b, { correct: 2, total: 3 });
  for (let i = 0; i < 20 && b.activeId !== actor.id; i++) b.status === 'player' ? chooseDefend(b) : advanceBattle(b);
  assert.equal(actor.cooldowns[skill.id], 0);
});

test('Luffy and Brook survive a knockout once, then correctly fall on the next lethal hit', () => {
  for (const id of ['luffy', 'brook']) {
    const b = fixture(id);
    const hero = getActiveUnit(b);
    const attacker = b.enemies[0];
    for (const ally of b.allies) if (ally !== hero) { ally.hp = 0; ally.alive = false; }
    hero.hp = 1;
    attacker.attack = 10000;
    attacker.skills = [attacker.skills[0]];
    forceTurn(b, attacker);
    advanceBattle(b);
    assert.ok(hero.hp > 0);
    assert.equal(hero.passiveUsed, true);
    forceTurn(b, attacker);
    advanceBattle(b);
    assert.equal(hero.hp, 0);
    assert.equal(hero.alive, false);
    assert.equal(b.status, 'learning');
    assert.equal(b.pendingOutcome, 'defeat');
  }
});

test('one enemy advances per call and a full round always stops at the three-question gate', () => {
  const b = createBattle(createCollection(), { seed: 18 });
  const order = [...b.turnOrder];
  const hpBefore = b.allies.map(u => u.hp);
  finishRound(b);
  assert.equal(b.round, 1);
  assert.equal(b.stats.rounds, 1);
  assert.equal(b.learning.required, 3);
  assert.ok(b.stats.turns >= order.length);
  assert.equal(advanceBattle(b), false);
  assert.equal(chooseDefend(b), false);
  assert.equal(act(b, 'luffy-0', b.enemies[0].id), false);
  assert.ok(b.allies.some((u, i) => u.hp <= hpBefore[i]));
});

test('learning requires exactly three graded answers, tracks them once and never grants packs', () => {
  const c = createCollection();
  const b = createBattle(c, { seed: 44 });
  finishRound(b);
  for (const answer of [{ correct: 3, total: 2 }, { correct: 4, total: 3 }, { correct: 1.5, total: 3 }, { correct: -1, total: 3 }, { correct: 3, total: 3, round: 0 }]) {
    assert.equal(completeLearning(b, answer), false);
  }
  assert.equal(c.packs, 0);
  assert.equal(completeLearning(b, { correct: 2, total: 3 }).packsEarned, 0);
  assert.equal(c.learningProgress, undefined);
  assert.equal(completeLearning(b, { correct: 2, total: 3 }), false);
  finishRound(b);
  const result = grantLearningReward(b, { correct: 2, total: 3, round: 2 });
  assert.equal(result.packsEarned, 0);
  assert.equal(c.learningProgress, undefined);
  assert.equal(c.packs, 0);
  assert.equal(result.energyGranted, 6);
  assert.deepEqual(b.rewardedRounds, [1, 2]);
  assert.equal(c.stats.correctAnswers, 4);
});

test('a terminal victory still requires learning before unlock, outcome or victory count', () => {
  const b = fixture('zoro');
  b.enemies.forEach(e => { e.hp = 0; e.alive = false; });
  b.enemies[0].hp = 1;
  const actor = getActiveUnit(b);
  act(b, actor.skills[0].id, b.enemies[0].id);
  assert.equal(b.status, 'learning');
  assert.equal(b.pendingOutcome, 'victory');
  assert.equal(b.collection.stats.victories, 0);
  assert.equal(b.collection.unlockedEncounter, 1);
  assert.equal(completeLearning(b, { correct: 3, total: 3 }).outcome, 'victory');
  assert.equal(b.status, 'victory');
  assert.equal(b.collection.unlockedEncounter, 2);
  assert.equal(b.collection.stats.victories, 1);
  assert.equal(b.collection.packs, 0);
  assert.equal(completeLearning(b, { correct: 3, total: 3 }), false);
  assert.equal(b.collection.packs, 0);
});

test('defeat round still requires learning without granting packs or unlocking encounters', () => {
  const b = createBattle(createCollection(), { seed: 77 });
  const actor = b.enemies[0];
  b.allies.forEach(u => { u.hp = 0; u.alive = false; u.passive = { type: 'none' }; });
  b.allies[0].hp = 1;
  forceTurn(b, actor);
  actor.attack = 5000;
  advanceBattle(b);
  assert.equal(b.status, 'learning');
  assert.equal(b.pendingOutcome, 'defeat');
  completeLearning(b, { correct: 3, total: 3 });
  assert.equal(b.status, 'defeat');
  assert.equal(b.collection.packs, 0);
  assert.equal(b.collection.unlockedEncounter, 1);
  assert.equal(b.collection.stats.victories, 0);
});

test('burn and poison tick at the victim’s turn; stun and freeze each skip a turn and expire', () => {
  const b = fixture();
  const actor = getActiveUnit(b);
  const target = b.allies.find(u => u !== actor);
  target.statuses = [{ type: 'burn', amount: 12, duration: 1 }, { type: 'poison', amount: 9, duration: 1 }, { type: 'freeze', amount: 0, duration: 1 }];
  const before = target.hp;
  b.turnOrder = [actor.id, target.id, ...b.enemies.map(e => e.id)];
  chooseDefend(b);
  assert.equal(target.hp, before - 21);
  assert.equal(target.statuses.length, 0);
  assert.notEqual(b.activeId, target.id);
  forceTurn(b, actor);
  target.statuses = [{ type: 'stun', amount: 0, duration: 1 }];
  b.turnOrder = [actor.id, target.id, ...b.enemies.map(e => e.id)];
  chooseDefend(b);
  assert.ok(!target.statuses.some(s => s.type === 'stun'));
});

test('healing respects maximum health and cleanses; revive targets only knocked-out allies', () => {
  const b = fixture('chopper');
  const actor = getActiveUnit(b);
  const target = b.allies.find(u => u !== actor);
  target.hp = target.maxHp - 20;
  target.statuses = [{ type: 'poison', amount: 20, duration: 3 }];
  act(b, actor.skills[1].id, target.id);
  assert.equal(target.hp, target.maxHp);
  assert.equal(target.statuses.length, 0);
  forceTurn(b, actor);
  assert.equal(act(b, actor.skills[2].id, target.id), false);
  target.hp = 0; target.alive = false;
  assert.deepEqual(getValidTargets(b, actor.skills[2].id).map(u => u.id), [target.id]);
  assert.equal(act(b, actor.skills[2].id, target.id), true);
  assert.equal(target.alive, true);
  assert.ok(target.hp >= Math.round(target.maxHp * 0.36));
});

test('shield absorbs direct damage; taunt restricts single-target attacks but not area skills', () => {
  const b = fixture('nami');
  const actor = getActiveUnit(b);
  const target = b.enemies[0];
  target.shield = 500;
  const hp = target.hp;
  act(b, actor.skills[0].id, target.id);
  assert.equal(target.hp, hp);
  assert.ok(target.shield < 500);
  forceTurn(b, actor);
  target.statuses = [{ type: 'taunt', duration: 2, amount: 0 }];
  assert.deepEqual(getValidTargets(b, actor.skills[0].id).map(u => u.id), [target.id]);
  assert.equal(act(b, actor.skills[0].id, b.enemies[1].id), false);
  assert.equal(getValidTargets(b, actor.skills[2].id).length, b.enemies.length);
});

test('burn, poison and freeze immunities apply to the matching canonical power users', () => {
  for (const [attacker, immuneId, status] of [['sanji', 'akainu', 'burn'], ['akainu', 'akainu', 'burn'], ['magellan', 'magellan', 'poison'], ['aokiji', 'aokiji', 'freeze']]) {
    const b = fixture(attacker);
    const actor = getActiveUnit(b);
    const immune = b.enemies[0];
    immune.passive = CHARACTER_BY_ID[immuneId].passive;
    assert.ok(actor.skills[1].effects.some(effect => effect.type === status), `${attacker} skill applies ${status}`);
    assert.equal(act(b, actor.skills[1].id, immune.id), true);
    assert.ok(!immune.statuses.some(s => s.type === status), `${immuneId} resists ${status}`);
  }
});

test('every catalog active skill executes with a valid target and emits its unique animation', () => {
  for (const character of CHARACTERS) for (let index = 0; index < 3; index++) {
    const b = fixture(character.id);
    const actor = getActiveUnit(b);
    const skill = actor.skills[index];
    if (skill.target === 'fallen-ally') { const ally = b.allies.find(u => u !== actor); ally.hp = 0; ally.alive = false; }
    const valid = getValidTargets(b, skill.id);
    assert.ok(valid.length, `${skill.name} has a valid target`);
    assert.equal(act(b, skill.id, valid[0].id), true, `${character.name}: ${skill.name}`);
    assert.ok(b.effects.some(e => e.animation === skill.animation), skill.name);
    assert.ok([...b.allies, ...b.enemies].every(u => Number.isFinite(u.hp) && Number.isFinite(u.energy) && u.hp >= 0 && u.energy >= 0));
  }
});

test('campaign has nine valid encounters, replay is allowed, and final unlock is capped at nine', () => {
  assert.equal(ENCOUNTERS.length, 9);
  for (const encounter of ENCOUNTERS) assert.ok(encounter.enemies.every(id => CHARACTER_BY_ID[id]));
  const c = createCollection(); c.unlockedEncounter = 9;
  assert.ok(createBattle(c, { encounter: 1, seed: 1 }));
  const b = createBattle(c, { encounter: 9, seed: 1 });
  b.status = 'learning'; b.learning = { required: 3, round: 1, completed: false }; b.pendingOutcome = 'victory';
  completeLearning(b, { correct: 0, total: 3 });
  assert.equal(c.unlockedEncounter, 9);
  assert.equal(c.packs, 0);
  assert.deepEqual(c.completed, [9]);
});

function learningFixture(correct) {
  const b = fixture('nami');
  // Keep this fixture about graded-answer multipliers; aura combat has its own tests.
  b.allies = b.allies.filter(unit => !CHARACTER_BY_ID[unit.characterId].aura);
  for (const u of [...b.allies, ...b.enemies]) { u.passive = { type: 'none', value: 0 }; u.shield = 0; u.statuses = []; }
  b.status = 'learning'; b.learning = { round: b.round, required: 3, completed: false };
  const result = completeLearning(b, { correct, total: 3, round: b.round });
  forceTurn(b, b.allies.find(u => u.characterId === 'nami'));
  return { b, result, actor: getActiveUnit(b) };
}

test('each correct answer tier grants exactly the next-round damage, critical and defense bonuses without changing base stats', () => {
  for (let correct = 0; correct <= 3; correct++) {
    const { b, result, actor } = learningFixture(correct), enemy = b.enemies[0];
    actor.attack = 100; enemy.defense = 20;
    const before = { attack: actor.attack, defense: actor.defense, enemyDefense: enemy.defense };
    if (correct === 0) assert.equal(b.learningBoost, null);
    else {
      assert.equal(b.learningBoost.correct, correct);
      assert.equal(b.learningBoost.round, 2);
      assert.ok(Math.abs(b.learningBoost.attackMultiplier - (1 + correct * 0.1)) < 1e-10);
      assert.ok(Math.abs(b.learningBoost.critBonus - correct * 0.05) < 1e-10);
      assert.ok(Math.abs(b.learningBoost.defenseMultiplier - (1 + correct * 0.08)) < 1e-10);
      assert.deepEqual(result.boost, b.learningBoost);
      assert.notEqual(result.boost, b.learningBoost, 'Reward history retains an independent snapshot');
    }
    const hp = enemy.hp, base = 100 * actor.skills[0].power - 20 * 0.48;
    assert.equal(act(b, actor.skills[0].id, enemy.id), true);
    assert.equal(hp - enemy.hp, Math.round(base * (1 + correct * 0.1)));
    assert.deepEqual({ attack: actor.attack, defense: actor.defense, enemyDefense: enemy.defense }, before);
    assert.equal(b.collection.packs, 0);
  }
});

test('learning defense tiers reduce enemy direct damage without strengthening enemy attacks', () => {
  for (let correct = 0; correct <= 3; correct++) {
    const { b, actor: target } = learningFixture(correct), enemy = b.enemies[0];
    b.allies = [target]; target.hp = target.maxHp = 10000; target.defense = 100;
    enemy.attack = 100; enemy.skills = [{ ...enemy.skills[0], power: 1, effects: [] }];
    forceTurn(b, enemy);
    const hp = target.hp;
    assert.equal(advanceBattle(b), true);
    assert.equal(hp - target.hp, Math.round(100 - 100 * (1 + correct * 0.08) * 0.48));
    assert.equal(target.defense, 100);
  }
});

test('each learning tier adds five percentage points of deterministic critical chance and respects passive bonuses and the cap', () => {
  for (let correct = 0; correct <= 3; correct++) for (const critical of [false, true]) {
    const { b, actor } = learningFixture(correct);
    b.rng = () => 0.07 + correct * 0.05 + (critical ? -0.001 : 0.001);
    act(b, actor.skills[0].id, b.enemies[0].id);
    assert.equal(b.effects.some(e => e.critical), critical, `${correct}/3 correct has the expected crit threshold`);
  }
  for (const [passive, rollValue, expected] of [[0.2, 0.3, true], [0.2, 0.5, false], [1, 0.74, true], [1, 0.76, false]]) {
    const { b, actor } = learningFixture(3);
    actor.passive = { type: 'crit', value: passive }; b.rng = () => rollValue;
    act(b, actor.skills[0].id, b.enemies[0].id);
    assert.equal(b.effects.some(e => e.critical), expected);
  }
});

test('learning boosts expire at the next question gate, cannot stack or replay, and never carry between battles', () => {
  const { b } = learningFixture(3);
  assert.equal(b.learningBoost.correct, 3);
  assert.equal(completeLearning(b, { correct: 3, total: 3, round: 1 }), false);
  assert.equal(b.learningBoost.attackMultiplier, 1.3);
  finishRound(b);
  assert.equal(b.learningBoost, null);
  assert.equal(completeLearning(b, { correct: 3, total: 3, round: 1 }), false);
  assert.equal(b.learningBoost, null);
  const next = completeLearning(b, { correct: 1, total: 3, round: 2 });
  assert.equal(next.boost.correct, 1); assert.equal(next.boost.round, 3);
  assert.equal(b.learningBoost.attackMultiplier, 1.1);
  finishRound(b); completeLearning(b, { correct: 0, total: 3, round: 3 });
  assert.equal(b.learningBoost, null);
  assert.equal(createBattle(b.collection, { seed: 1 }).learningBoost, null);
});

test('a terminal question gate records answers but cannot grant a nonexistent next-round boost', () => {
  for (const outcome of ['victory', 'defeat']) {
    const { b } = learningFixture(3);
    b.status = 'learning'; b.learningBoost = null; b.learning = { round: b.round, required: 3, completed: false }; b.pendingOutcome = outcome;
    const result = completeLearning(b, { correct: 3, total: 3, round: b.round });
    assert.equal(result.boost, null); assert.equal(b.learningBoost, null); assert.equal(b.status, outcome); assert.equal(b.collection.packs, 0);
  }
});

test('a self-revival cleanses the remaining damage-over-time ticks in the same turn', () => {
  for (const id of ['luffy', 'brook']) {
    const b = fixture(id), hero = b.allies.find(u => u.characterId === id), enemy = b.enemies[0];
    hero.hp = 1; hero.shield = 0;
    hero.statuses = ['burn', 'poison'].map(type => ({ type, duration: 2, amount: 1000, appliedTurn: -1, sourceId: enemy.id }));
    enemy.skills = [{ ...enemy.skills[0], power: 0, effects: [] }];
    forceTurn(b, enemy); b.turnOrder = [enemy.id, hero.id, b.enemies[1].id];
    advanceBattle(b);
    assert.equal(hero.hp, Math.max(1, Math.round(hero.maxHp * hero.passive.value)), `${id}'s cleansed poison cannot tick after revival`);
    assert.equal(hero.alive, true); assert.deepEqual(hero.statuses, []);
  }
});
