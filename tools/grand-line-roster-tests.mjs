import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dataSource = await readFile(new URL('../grand-line-data.js', import.meta.url), 'utf8');
const dataUrl = `data:text/javascript;base64,${Buffer.from(dataSource).toString('base64')}`;
const data = await import(dataUrl);
const coreSource = (await readFile(new URL('../grand-line-core.js', import.meta.url), 'utf8'))
  .replace(/(['"])\.\/grand-line-data\.js(?:\?v=[^'"]+)?\1/, `'${dataUrl}'`);
const { createCollection, addCard, setTeam, createBattle, act } = await import(`data:text/javascript;base64,${Buffer.from(coreSource).toString('base64')}`);
const { CHARACTERS, CHARACTER_BY_ID, STARTER_IDS, ENCOUNTERS, RETIRED_CHARACTER_REPLACEMENTS, FUTURE_EXPANSION_CHARACTERS } = data;
const replacements = {
  shanks: 'wyper', blackbeard: 'kaku', bigmom: 'wapol', kizaru: 'hina',
  sengoku: 'paulie', garp: 'donkrieg', mihawk: 'hatchan', hancock: 'kalifa',
};
const replacementIds = Object.values(replacements);

function fixture(id) {
  const collection = createCollection();
  addCard(collection, id);
  assert.equal(setTeam(collection, [...new Set([id, ...STARTER_IDS])].slice(0, 5)), true);
  const battle = createBattle(collection, { seed: 918 });
  battle.rng = () => 0.5;
  const actor = battle.allies.find(unit => unit.characterId === id);
  for (const enemy of battle.enemies) {
    enemy.hp = enemy.maxHp = 100000;
    enemy.shield = 0;
    enemy.statuses = [];
    enemy.passive = { type: 'none', value: 0 };
  }
  battle.status = 'player';
  battle.activeId = actor.id;
  // The next ally can prepare normally without consuming the target's statuses.
  battle.turnOrder = [actor.id, ...battle.allies.filter(unit => unit !== actor).map(unit => unit.id), ...battle.enemies.map(unit => unit.id)];
  battle.turnIndex = 0;
  actor.turnsStarted++;
  actor.energy = 100;
  actor.cooldowns = Object.fromEntries(actor.skills.map(skill => [skill.id, 0]));
  return { battle, actor, target: battle.enemies[0] };
}
function use(fixture, index, target = fixture.target) {
  assert.equal(act(fixture.battle, fixture.actor.skills[index].id, target.id), true);
}
const status = (unit, type) => unit.statuses.find(effect => effect.type === type);

test('v1.1 reserves precisely eight future apex cards outside the fifty-card obtainable roster', () => {
  assert.equal(data.VERSION, '1.2.1');
  assert.deepEqual(RETIRED_CHARACTER_REPLACEMENTS, replacements);
  assert.equal(CHARACTERS.length, 50);
  assert.equal(new Set(CHARACTERS.map(character => character.id)).size, 50);
  assert.equal(FUTURE_EXPANSION_CHARACTERS.length, 8);
  assert.deepEqual(FUTURE_EXPANSION_CHARACTERS.map(character => character.id).sort(), Object.keys(replacements).sort());
  for (const future of FUTURE_EXPANSION_CHARACTERS) {
    assert.equal(future.stars, 7);
    assert.ok(future.name.length > 2);
    assert.deepEqual(Object.keys(future).sort(), ['id', 'name', 'stars']);
    assert.equal(CHARACTER_BY_ID[future.id], undefined);
  }
  assert.deepEqual(CHARACTERS.filter(character => character.stars === 7).map(character => character.id), ['kaido', 'whitebeard', 'akainu']);
  assert.deepEqual(replacementIds.map(id => CHARACTER_BY_ID[id].stars), [4, 4, 2, 3, 3, 3, 2, 3]);
});

test('all nine encounters use obtainable enemies and introduce every replacement', () => {
  assert.equal(ENCOUNTERS.length, 9);
  const introduced = new Set();
  for (const encounter of ENCOUNTERS) {
    for (const id of encounter.enemies) {
      assert.ok(CHARACTER_BY_ID[id], `${encounter.name}: missing ${id}`);
      assert.equal(Object.hasOwn(replacements, id), false);
      introduced.add(id);
    }
    assert.doesNotMatch(`${encounter.name} ${encounter.description}`, /Shanks|Teach|Linlin|Kizaru|Sengoku|Garp|Mihawk|Hancock/i);
  }
  for (const id of replacementIds) assert.ok(introduced.has(id), `${id} has no campaign appearance`);
});

test('each replacement has a specific official primary profile and a documented reservation', async () => {
  const expectedSlugs = { wyper: 'Wyper', kaku: 'Kaku', wapol: 'Wapol', hina: 'Hina', paulie: 'Paulie', donkrieg: 'Don_Krieg', hatchan: 'Hacchan', kalifa: 'Kalifa' };
  const lore = await readFile(new URL('../LORE-SOURCES.md', import.meta.url), 'utf8');
  for (const [id, slug] of Object.entries(expectedSlugs)) {
    assert.equal(CHARACTER_BY_ID[id].source, `https://one-piece.com/character/${slug}/index.html`);
    assert.ok(lore.includes(CHARACTER_BY_ID[id].source));
    assert.ok(lore.includes(`| ${CHARACTER_BY_ID[id].name} |`));
  }
  assert.match(lore, /future seven-star expansions, with no release dates announced/);
});

test('all twenty-four new moves execute and emit a distinct supported animation', () => {
  const supportedKinds = new Set(['punch', 'slash', 'fire', 'water', 'wind', 'earth', 'explosion', 'string', 'shield', 'poison']);
  const animations = new Set();
  for (const id of replacementIds) {
    assert.equal(CHARACTER_BY_ID[id].skills.length, 3);
    for (let index = 0; index < 3; index++) {
      const f = fixture(id);
      const skill = f.actor.skills[index];
      const target = skill.target === 'self' ? f.actor : skill.target === 'ally' ? f.battle.allies.find(unit => unit !== f.actor) : f.target;
      const before = target.hp;
      use(f, index, target);
      const effect = f.battle.effects.find(effect => effect.skillId === skill.id);
      assert.ok(effect, `${skill.name} did not emit its animation`);
      assert.equal(effect.animation, skill.animation);
      assert.ok(supportedKinds.has(effect.kind), `${skill.name}: unsupported ${effect.kind}`);
      assert.match(skill.color, /^#[\da-f]{6}$/i);
      assert.ok(skill.description.length > 10);
      animations.add(effect.animation);
      if (skill.power > 0) assert.ok(target.hp < before, `${skill.name} did not deal damage`);
      else assert.ok(target.shield > 0, `${skill.name} did not protect its target`);
    }
  }
  assert.equal(animations.size, 24);
});

test('Wyper burns the enemy group and pays a recoil penalty for Reject Dial', () => {
  const flame = fixture('wyper');
  use(flame, 1);
  for (const target of flame.battle.enemies) assert.equal(status(target, 'burn').amount, flame.actor.attack * 0.2);
  const dial = fixture('wyper');
  dial.target.defense = 10000;
  use(dial, 2);
  assert.ok(dial.target.maxHp - dial.target.hp > 100);
  assert.equal(status(dial.actor, 'weaken').amount, 0.3);
  assert.equal(status(dial.actor, 'weaken').duration, 1);
  assert.equal(status(dial.target, 'weaken'), undefined);
  assert.equal(dial.actor.energy, 35);
});

test('Kalifa washes away strength and drains Spirit; Golden Hour can restrain the group', () => {
  const wash = fixture('kalifa');
  wash.target.energy = 60;
  use(wash, 1);
  assert.equal(status(wash.target, 'weaken').amount, 0.3);
  assert.equal(wash.target.energy, 45);
  assert.equal(wash.actor.energy, 85);
  const golden = fixture('kalifa');
  golden.battle.rng = () => 0.4;
  use(golden, 2);
  for (const target of golden.battle.enemies) {
    assert.equal(status(target, 'slow').amount, 0.25);
    assert.equal(status(target, 'stun').duration, 1);
  }
});

test('Hatchan obscures the group with ink and uses six swords to slow a single foe', () => {
  const ink = fixture('hatchan');
  use(ink, 1);
  for (const target of ink.battle.enemies) assert.equal(status(target, 'weaken').amount, 0.22);
  const swords = fixture('hatchan');
  use(swords, 2);
  assert.equal(status(swords.target, 'slow').amount, 0.2);
  assert.equal(swords.battle.enemies[1].hp, swords.battle.enemies[1].maxHp);
});

test('Don Krieg applies persistent poison to the group and burns with his explosive spear', () => {
  const gas = fixture('donkrieg');
  use(gas, 2);
  for (const target of gas.battle.enemies) {
    assert.equal(status(target, 'poison').amount, gas.actor.attack * 0.32);
    assert.equal(status(target, 'poison').duration, 3);
  }
  assert.equal(gas.actor.cooldowns['donkrieg-2'], 4);
  const spear = fixture('donkrieg');
  use(spear, 1);
  assert.equal(status(spear.target, 'burn').amount, spear.actor.attack * 0.2);
});

test('Paulie protects his crew at deployment and can rescue an ally or bind the enemy group', () => {
  const rescue = fixture('paulie');
  for (const ally of rescue.battle.allies) assert.equal(ally.shield, Math.round(ally.maxHp * 0.06));
  const ally = rescue.battle.allies.find(unit => unit !== rescue.actor);
  const before = ally.shield;
  use(rescue, 1, ally);
  assert.equal(ally.shield, before + Math.round(rescue.actor.attack * 1.8));
  assert.equal(status(ally, 'guard').amount, 0.2);
  const bind = fixture('paulie');
  bind.battle.rng = () => 0.4;
  use(bind, 2);
  for (const target of bind.battle.enemies) {
    assert.equal(status(target, 'slow').amount, 0.2);
    assert.equal(status(target, 'stun').duration, 1);
  }
});

test('Hina locks a foe in Black Cage with a once-per-battle extended restraint', () => {
  const cage = fixture('hina');
  use(cage, 1);
  assert.equal(status(cage.target, 'stun').duration, 2);
  assert.equal(cage.actor.passiveUsed, true);
  const used = fixture('hina');
  used.actor.passiveUsed = true;
  use(used, 1);
  assert.equal(status(used.target, 'stun').duration, 1);
});

test('Kaku can stun with his giraffe strike and cut through armor across the group', () => {
  const strike = fixture('kaku');
  use(strike, 1);
  assert.equal(status(strike.target, 'stun').duration, 1);
  const unarmored = fixture('kaku');
  const armored = fixture('kaku');
  for (const enemy of unarmored.battle.enemies) enemy.defense = 0;
  for (const enemy of armored.battle.enemies) enemy.defense = 10000;
  use(unarmored, 2);
  use(armored, 2);
  assert.deepEqual(armored.battle.enemies.map(enemy => enemy.hp), unarmored.battle.enemies.map(enemy => enemy.hp));
  assert.ok(armored.battle.enemies.every(enemy => enemy.hp < enemy.maxHp));
});

test('Wapol gains health and scrap protection from a bite and constructs his own armor', () => {
  const bite = fixture('wapol');
  bite.actor.hp -= 50;
  const before = bite.actor.hp;
  use(bite, 0);
  assert.ok(bite.actor.hp > before);
  assert.equal(bite.actor.shield, Math.round(bite.actor.attack * 0.1));
  const factory = fixture('wapol');
  use(factory, 1, factory.actor);
  assert.equal(factory.actor.shield, Math.round(factory.actor.attack * 1.6));
  assert.equal(status(factory.actor, 'attack-up').amount, 0.2);
  assert.equal(factory.actor.energy, 75);
});
