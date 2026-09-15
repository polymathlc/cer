import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, CHARACTER_BY_ID, CREWS, MAX_CREW_SIZE, STARTER_IDS, createCollection, normalizeCollection,
  addCard, setTeam, statsFor, getCrewSynergies, getCaptainAuras, createBattle, act } from '../grand-line-core.js';
import { createDefense, DEFENSE_PADS, getMazePlacementPreview, summonDefender, recallDefender,
  upgradeDefender, specializeDefender, startDefenseWave, advanceDefense, defensePointAt } from '../grand-line-defense.js';

function collectionWith(ids) {
  const collection = createCollection();
  for (const id of ids) if (!collection.cards[id]) assert.ok(addCard(collection, id));
  assert.equal(setTeam(collection, ids), true);
  return collection;
}
function openPad(battle) {
  return DEFENSE_PADS.find(pad => getMazePlacementPreview(battle, pad.id, { kind: 'crew' }).valid).id;
}
function defenseFixture(ids = ['yasopp', 'bigmom7', 'whitebeard', 'kaido', 'garp7', 'sabo7']) {
  const battle = createDefense(collectionWith(ids), { seed: 791 });
  assert.equal(startDefenseWave(battle), true);
  for (let i = 0; i < 12; i++) advanceDefense(battle, .05);
  battle.rng = () => .5;
  battle.spawned = battle.spawnTotal;
  battle.remainingToSpawn = 0;
  battle.effects = [];
  battle.projectiles = [];
  const enemy = battle.enemies[0];
  Object.assign(enemy, { hp: 100000, maxHp: 100000, shield: 0, defense: 0, armor: 0, progress: .15,
    moveSpeed: 0, statuses: [], skills: [], passive: { type: 'none', value: 0 }, escaped: false, alive: true });
  Object.assign(enemy, defensePointAt(enemy.progress, battle));
  battle.enemies = [enemy];
  for (const ally of battle.allies) Object.assign(ally, { x: enemy.x - 30, y: enemy.y, skills: [],
    statuses: [], shield: 0, actionTimer: 1, energy: 100, cooldowns: {}, attacksMade: 0 });
  const actor = battle.allies.find(ally => ally.characterId === 'yasopp');
  if (actor) {
    actor.attack = 100;
    actor.passive = { type: 'none', value: 0 };
    actor.skills = [CHARACTER_BY_ID.yasopp.skills[0]];
  }
  return { battle, actor, enemy };
}
function oneShot(fixture) {
  fixture.actor.actionTimer = 0;
  advanceDefense(fixture.battle, .05);
  fixture.actor.skills = [];
  for (let i = 0; i < 100 && fixture.battle.projectiles.length; i++) advanceDefense(fixture.battle, .05);
  assert.equal(fixture.battle.projectiles.length, 0);
  return fixture.enemy.maxHp - fixture.enemy.hp;
}

test('all hundred cards have valid allegiance metadata and historical captains are marked accurately', () => {
  assert.equal(CHARACTERS.length, 100);
  for (const character of CHARACTERS) {
    assert.ok(character.allegiances.length, `${character.id} needs an allegiance`);
    assert.equal(new Set(character.allegiances).size, character.allegiances.length);
    for (const id of character.allegiances) assert.equal(CREWS[id].id, id);
    assert.ok(character.captainOf.every(id => character.allegiances.includes(id)));
  }
  assert.deepEqual(CHARACTER_BY_ID.kaido.captainOf, ['beasts']);
  assert.deepEqual(CHARACTER_BY_ID.bigmom7.captainOf, ['bigmom']);
  assert.deepEqual(CHARACTER_BY_ID.whitebeard.captainOf, ['whitebeard']);
  assert.deepEqual(CHARACTER_BY_ID.garp7.captainOf, [], 'Vice admiral is not a pirate captain');
  assert.deepEqual(CHARACTER_BY_ID.sabo7.captainOf, [], 'Chief of staff is not a pirate captain');
  assert.ok(CHARACTER_BY_ID.oden.allegiances.includes('roger'));
  assert.ok(CHARACTER_BY_ID.oden.allegiances.includes('whitebeard'));
  assert.ok(CHARACTER_BY_ID.kaido.allegiances.includes('rocks'));
  assert.ok(CHARACTER_BY_ID.bigmom7.allegiances.includes('rocks'));
});

test('new seven-star edition IDs coexist with paid legacy replacements without a free legend upgrade', () => {
  const raw = createCollection();
  const editions = [['bigmom', 'wapol', 'bigmom7'], ['garp', 'donkrieg', 'garp7'], ['sabo', 'gin', 'sabo7']];
  for (const [oldId, replacement, edition] of editions) {
    raw.cards[oldId] = { copies: 8 };
    raw.cards[replacement] = { copies: 3 };
    if (edition !== 'sabo7') raw.cards[edition] = { copies: 2 };
  }
  raw.team = ['bigmom', 'bigmom7', 'garp', 'garp7', 'sabo'];
  const before = structuredClone(raw), once = normalizeCollection(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(once.team, ['wapol', 'bigmom7', 'donkrieg', 'garp7', 'gin']);
  for (const [oldId, replacement, edition] of editions) {
    assert.equal(once.cards[oldId], undefined);
    assert.equal(once.cards[replacement].copies, 11);
    assert.deepEqual(once.cards[edition], raw.cards[edition]);
  }
  assert.deepEqual(normalizeCollection(once), once);
  assert.ok(addCard(once, 'sabo7'));
  assert.equal(once.cards.sabo7.copies, 1);
  assert.equal(once.cards.gin.copies, 11);
});

test('old ten-member saves deterministically keep the first seven without losing any cards or progress', () => {
  const ids = CHARACTERS.slice(0, 10).map(character => character.id);
  const raw = { ...createCollection(), team: ids, cards: Object.fromEntries(ids.map((id, index) => [id, { copies: index + 2 }])),
    packs: 4, unlockedEncounter: 9, completed: [1, 3, 9], stats: { packsOpened: 29, victories: 8, correctAnswers: 72 } };
  const before = structuredClone(raw), migrated = normalizeCollection(raw);
  assert.equal(MAX_CREW_SIZE, 7);
  assert.deepEqual(raw, before);
  assert.deepEqual(migrated.team, ids.slice(0, 7));
  for (const key of ['cards', 'packs', 'unlockedEncounter', 'completed', 'stats']) assert.deepEqual(migrated[key], raw[key]);
  assert.deepEqual(normalizeCollection(migrated), migrated);
  assert.equal(createDefense(migrated).allies.length, 7);
  assert.equal(createBattle(migrated).allies.length, 7);
});

test('team selection, both battle engines, summoning and wave start enforce seven owned distinct members', () => {
  const ids = CHARACTERS.slice(0, 8).map(character => character.id), collection = collectionWith(ids.slice(0, 7));
  addCard(collection, ids[7]);
  const before = structuredClone(collection);
  assert.equal(setTeam(collection, ids), false);
  assert.deepEqual(collection, before);
  assert.equal(createBattle({ ...collection, team: ids }), null);
  assert.equal(createDefense({ ...collection, team: ids }), null);
  const battle = createDefense(collection), state = structuredClone({ allies: battle.allies, supplies: battle.supplies });
  battle.supplies = 1000;
  assert.equal(summonDefender(battle, ids[7], openPad(battle)), false);
  assert.deepEqual(battle.allies, state.allies);
  assert.equal(battle.supplies, 1000);
  battle.allies.push({ ...battle.allies[0], id: 'forged-eighth', padId: openPad(battle) });
  assert.equal(startDefenseWave(battle), false);
  assert.equal(battle.status, 'setup');
});

test('two, three and five matching members grant 6, 10 and 16 percent without requiring their captain', () => {
  const ids = ['zoro', 'nami', 'usopp', 'sanji', 'chopper', 'franky', 'brook'];
  for (const [count, bonus] of [[1, 0], [2, .06], [3, .1], [4, .1], [5, .16], [7, .16]]) {
    const summary = getCrewSynergies(ids.slice(0, count)), strawhats = summary.groups.find(group => group.id === 'strawhat');
    assert.equal(strawhats.count, count);
    assert.equal(strawhats.bonus, bonus);
    assert.equal(strawhats.active, count >= 2);
    assert.deepEqual(strawhats.captains, []);
    assert.equal(strawhats.nextThreshold, count < 2 ? 2 : count < 3 ? 3 : count < 5 ? 5 : null);
    for (const id of ids.slice(0, count)) assert.equal(summary.byCharacter[id].bonus, bonus);
  }
});

test('shared historical crews add only to matching cards, cap at thirty percent, and reject duplicate inflation', () => {
  const ids = ['kaido', 'bigmom7', 'whitebeard', 'marco', 'garp7'];
  const summary = getCrewSynergies(ids);
  assert.equal(summary.byCharacter.kaido.bonus, .1);
  assert.equal(summary.byCharacter.bigmom7.bonus, .1);
  assert.equal(summary.byCharacter.whitebeard.bonus, .16);
  assert.equal(summary.byCharacter.marco.bonus, .06);
  assert.equal(summary.byCharacter.garp7.bonus, 0);
  assert.deepEqual(summary.groups.find(group => group.id === 'rocks').captains, []);
  const stacked = ['oden', 'whitebeard', 'marco', 'izo', 'inuarashi', 'nekomamushi', 'rayleigh'];
  assert.equal(getCrewSynergies(stacked).byCharacter.oden.bonus, .3);
  assert.deepEqual(getCrewSynergies([...ids, ...ids, '__proto__', 'missing', null]), summary);
  assert.deepEqual(getCrewSynergies(null), { groups: [], byCharacter: {}, cap: .3 });
});

test('collection previews and both engines use the same HP, attack, defense and speed bonus without changing other stats', () => {
  const ids = ['zoro', 'nami', 'usopp'], collection = collectionWith(ids);
  collection.cards.zoro.copies = 8;
  const base = statsFor('zoro', 8), boosted = statsFor('zoro', 8, 1, ids);
  for (const key of ['hp', 'maxHp', 'attack', 'defense', 'speed']) assert.equal(boosted[key], Math.round(base[key] * 1.1));
  assert.equal(boosted.rank, base.rank);
  assert.equal(boosted.maxEnergy, base.maxEnergy);
  assert.equal(statsFor('kaido', 1, 1, ids).synergyBonus, 0);
  const turnBattle = createBattle(collection), realtime = createDefense(collection);
  for (const battle of [turnBattle, realtime]) {
    const actor = battle.allies[0];
    for (const key of ['maxHp', 'attack', 'defense', 'speed', 'rank']) assert.equal(actor[key], boosted[key]);
    assert.equal(actor.synergyBonus, .1);
    assert.deepEqual(battle.synergies, getCrewSynergies(ids));
  }
  const previous = realtime.allies[0].attack;
  addCard(collection, 'zoro');
  assert.equal(realtime.allies[0].attack, previous, 'A live fight snapshots owned copies');
});

test('leader aura range has an exact boundary, includes its owner and never powers enemy sprites or maze towers', () => {
  const { battle, actor } = defenseFixture(['yasopp', 'bigmom7']);
  const leader = battle.allies[1];
  Object.assign(leader, { x: 0, y: 0 }); Object.assign(actor, { x: 240, y: 0 });
  assert.equal(getCaptainAuras(battle, actor).attackBonus, .12);
  actor.x = 241;
  assert.equal(getCaptainAuras(battle, actor).attackBonus, 0);
  assert.equal(getCaptainAuras(battle, leader).attackBonus, .12);
  assert.equal(getCaptainAuras(battle, { ...actor, side: 'enemy', x: 0 }).attackBonus, 0);
  assert.equal(getCaptainAuras(battle, { ...actor, isMazeTower: true, x: 0 }).attackBonus, 0);
  actor.x = 0; actor.hp = 0;
  assert.deepEqual(getCaptainAuras(battle, actor), { attackBonus: 0, speedBonus: 0, sources: [] });
});

test('only the strongest attack and speed auras apply, and fallen or recalled leaders stop contributing', () => {
  const { battle, actor } = defenseFixture();
  assert.equal(getCaptainAuras(battle, actor).attackBonus, .12);
  assert.equal(getCaptainAuras(battle, actor).speedBonus, .1);
  battle.allies.find(unit => unit.characterId === 'bigmom7').hp = 0;
  assert.equal(getCaptainAuras(battle, actor).attackBonus, .1);
  battle.allies.find(unit => unit.characterId === 'kaido').hp = 0;
  assert.equal(getCaptainAuras(battle, actor).attackBonus, .1, 'Garp supplies the remaining aura');
  battle.allies.find(unit => unit.characterId === 'garp7').hp = 0;
  assert.equal(getCaptainAuras(battle, actor).attackBonus, 0);
  battle.allies.find(unit => unit.characterId === 'whitebeard').hp = 0;
  assert.equal(getCaptainAuras(battle, actor).speedBonus, .1, 'Sabo supplies the remaining speed aura');
  battle.status = 'setup';
  assert.equal(recallDefender(battle, 'ally-sabo7'), true);
  assert.equal(getCaptainAuras(battle, actor).speedBonus, 0);
});

test('proximity attack auras change actual projectile damage without changing the crew stat bonus', () => {
  const near = defenseFixture(['yasopp', 'bigmom7']), far = defenseFixture(['yasopp', 'bigmom7']);
  far.battle.allies[1].x = far.actor.x + 241;
  const nearStats = { attack: near.actor.attack, bonus: near.actor.synergyBonus };
  assert.equal(oneShot(far), 104);
  assert.equal(oneShot(near), 116);
  assert.deepEqual({ attack: near.actor.attack, bonus: near.actor.synergyBonus }, nearStats);
});

test('the turn-based engine uses the same strongest leader attack aura in its real damage calculation', () => {
  const damage = powered => {
    const battle = createBattle(collectionWith(['yasopp', 'bigmom7', 'kaido']), { seed: 79 });
    battle.rng = () => .5;
    const actor = battle.allies[0], target = battle.enemies[0];
    if (!powered) battle.allies.slice(1).forEach(unit => { unit.hp = 0; });
    Object.assign(actor, { attack: 100, energy: 100, passive: { type: 'none', value: 0 } });
    Object.assign(target, { hp: 10000, maxHp: 10000, shield: 0, defense: 0, passive: { type: 'none', value: 0 }, statuses: [] });
    battle.status = 'player'; battle.activeId = actor.id; battle.turnIndex = 0;
    battle.turnOrder = [actor.id, ...battle.enemies.map(unit => unit.id)];
    assert.equal(act(battle, actor.skills[0].id, target.id), true);
    return 10000 - target.hp;
  };
  assert.equal(damage(false), 104);
  assert.equal(damage(true), 116);
});

test('a nearby speed aura accelerates the real action clock and produces more attacks without stacking', () => {
  const near = defenseFixture(['yasopp', 'whitebeard', 'sabo7']), far = defenseFixture(['yasopp', 'whitebeard', 'sabo7']);
  for (const leader of far.battle.allies.slice(1)) leader.x = far.actor.x + 241;
  for (const fixture of [near, far]) { fixture.actor.attackInterval = 1; fixture.actor.actionTimer = 1; }
  advanceDefense(near.battle, .1); advanceDefense(far.battle, .1);
  assert.ok(Math.abs(near.actor.actionTimer - .89) < 1e-8);
  assert.ok(Math.abs(far.actor.actionTimer - .9) < 1e-8);
  for (let i = 0; i < 208; i++) { advanceDefense(near.battle, .05); advanceDefense(far.battle, .05); }
  assert.equal(near.actor.attacksMade, 11);
  assert.equal(far.actor.attacksMade, 10);
  assert.equal(near.actor.attackInterval, 1, 'Aura is queried dynamically instead of compounding the stored interval');
});

test('formation changes preserve levels and specializations while recalculating current allegiance bonuses', () => {
  const collection = collectionWith(['luffy', 'zoro']), battle = createDefense(collection), actor = battle.allies[1];
  addCard(collection, 'nami'); battle.supplies = 1000; battle.trainingPoints = 3;
  assert.equal(upgradeDefender(battle, actor.id), true);
  assert.equal(upgradeDefender(battle, actor.id), true);
  assert.equal(specializeDefender(battle, actor.id, 'power'), true);
  actor.hp = 14; actor.passiveUsed = true;
  const pad = openPad(battle);
  assert.equal(summonDefender(battle, 'nami', pad), true);
  assert.equal(actor.synergyBonus, .1); assert.equal(actor.level, 3); assert.equal(actor.specialization, 'power');
  assert.equal(actor.attack, Math.round(statsFor('zoro', 1, 1, ['luffy', 'zoro', 'nami']).attack * 1.4 * 1.25));
  assert.equal(actor.passiveUsed, true); assert.equal(battle.trainingPoints, 0);
  assert.ok(actor.hp < actor.maxHp / 2);
  assert.equal(recallDefender(battle, 'ally-nami'), true);
  assert.equal(actor.synergyBonus, .06); assert.equal(actor.hp, 14);
  assert.equal(actor.level, 3); assert.equal(actor.specialization, 'power');
});

test('repeatedly toggling a formation cannot heal integer rounding losses or revive a knocked-out defender', () => {
  const collection = collectionWith(['luffy', 'zoro', 'nami']), battle = createDefense(collection);
  const actor = battle.allies[1], teammate = battle.allies[2], pad = teammate.padId;
  battle.supplies = 1000000;
  // Fourteen HP exposed a one-point free heal when rounded fractions were recalculated.
  for (const hp of [14, 1, 81, actor.maxHp - 1, actor.maxHp, 0]) {
    actor.hp = hp;
    for (let i = 0; i < 12; i++) {
      assert.equal(recallDefender(battle, teammate.id), true);
      assert.equal(summonDefender(battle, teammate.characterId, pad), true);
      assert.equal(actor.hp, hp);
    }
  }
  assert.equal(actor.hp, 0);
  assert.equal(actor.synergyBonus, .1, 'A fallen member is still in the team; only its proximity aura stops');
});
