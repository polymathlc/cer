import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, CHARACTER_BY_ID, RETIRED_CHARACTER_REPLACEMENTS, STARTER_IDS,
  createCollection, normalizeCollection, addCard, setTeam, createBattle } from '../grand-line-core.js';
import { createDefense } from '../grand-line-defense.js';

const replacements = Object.entries(RETIRED_CHARACTER_REPLACEMENTS);
test('all twelve retired cards convert paid copies one-for-one and preserve progress without free packs', () => {
  assert.equal(replacements.length, 12);
  const raw = { ...createCollection(), version: 1, cards: { ...createCollection().cards },
    team: replacements.slice(0, 5).map(([id]) => id), packs: 0, unlockedEncounter: 6,
    completed: [1, 2, 3], stats: { packsOpened: 20, victories: 3, correctAnswers: 18 } };
  for (const [index, [oldId]] of replacements.entries()) raw.cards[oldId] = { copies: index + 2 };
  const untouched = structuredClone(raw), migrated = normalizeCollection(raw);
  assert.deepEqual(raw, untouched, 'normalizing a snapshot must not mutate stored ownership');
  for (const [index, [oldId, newId]] of replacements.entries()) {
    assert.equal(migrated.cards[oldId], undefined);
    assert.equal(migrated.cards[newId].copies, index + 2);
    assert.ok(CHARACTER_BY_ID[newId]); assert.equal(CHARACTER_BY_ID[oldId], undefined);
  }
  assert.deepEqual(migrated.team, replacements.slice(0, 5).map(([, id]) => id));
  assert.ok(createBattle(migrated), 'converted ownership supports a real battle');
  for (const key of ['packs', 'unlockedEncounter', 'completed', 'stats']) assert.deepEqual(migrated[key], raw[key]);
  assert.deepEqual(normalizeCollection(migrated), migrated, 'repeat loading never adds copies');
});

test('four legacy IDs merge paid copies and trim an old ten-member defense to its first seven exactly once', () => {
  const entries=[['ace','bellamy'],['sabo','gin'],['law','mr3'],['king','kuro']];
  const raw=createCollection();raw.cards.kaido={copies:1};
  for(const [i,[oldId,newId]] of entries.entries()){raw.cards[oldId]={copies:2**(i+1)};raw.cards[newId]={copies:i+1};}
  raw.team=[...entries.map(([id])=>id),...STARTER_IDS,'kaido'];raw.stats={packsOpened:47,victories:2,correctAnswers:18};raw.completed=[1,2];raw.unlockedEncounter=3;
  const original=structuredClone(raw),once=normalizeCollection(raw),twice=normalizeCollection(once);
  assert.deepEqual(raw,original);assert.deepEqual(twice,once);
  assert.deepEqual(once.team,[...entries.map(([,id])=>id),...STARTER_IDS,'kaido'].slice(0,7));assert.equal(once.team.length,7);
  for(const [i,[oldId,newId]]of entries.entries()){assert.equal(once.cards[oldId],undefined);assert.equal(once.cards[newId].copies,2**(i+1)+i+1);}
  assert.deepEqual(once.stats,raw.stats);assert.deepEqual(once.completed,raw.completed);assert.equal(once.packs,0);
  for(const id of [...STARTER_IDS,'kaido'])assert.deepEqual(once.cards[id],raw.cards[id],'Trimming team slots never removes copies');
  assert.equal(once.cards.sabo7,undefined,'An old Sabo card does not unlock his new seven-star edition');
  const defense=createDefense(once,{seed:41});assert.equal(defense.allies.length,7);assert.deepEqual(defense.allies.map(a=>a.characterId),once.team);
  assert.ok(defense.allies.every(a=>!entries.some(([id])=>a.characterId===id)));
});

test('old and replacement copies merge, duplicate team slots repair, and every slot stays owned', () => {
  const c = createCollection();
  c.cards.shanks = { copies: 7 }; c.cards.wyper = { copies: 3 };
  c.cards.blackbeard = { copies: 2 }; c.cards.kaku = { copies: 4 };
  c.team = ['shanks', 'wyper', 'blackbeard', 'zoro', 'nami'];
  const result = normalizeCollection(c);
  assert.equal(result.cards.wyper.copies, 10); assert.equal(result.cards.kaku.copies, 6);
  assert.deepEqual(result.team, ['wyper', 'kaku', 'zoro', 'nami', 'luffy']);
  assert.equal(new Set(result.team).size, 5);
  assert.ok(result.team.every(id => result.cards[id].copies >= 1));
  assert.deepEqual(normalizeCollection(result), result);
});

test('merged valid legacy copy counts survive normalization and the next paid grant', () => {
  const c = normalizeCollection({ cards: { shanks: { copies: 1000000000 }, wyper: { copies: 1000000000 } } });
  assert.equal(c.cards.wyper.copies, 2000000000);
  assert.deepEqual(normalizeCollection(c), c);
  assert.equal(addCard(c, 'wyper').copies, 2000000001);
  assert.deepEqual(normalizeCollection(c), c);
});

test('retirement does not unlock unowned cards or permit legacy grants and teams', () => {
  const c = normalizeCollection({ cards: { shanks: { copies: -1 }, blackbeard: { copies: Infinity }, bigmom: { copies: '9' } }, team: ['shanks', 'blackbeard'] });
  assert.deepEqual(c, createCollection());
  for (const [id, replacement] of replacements) {
    assert.equal(CHARACTERS.some(card => card.id === id), false);
    assert.equal(addCard(c, id), null); assert.equal(c.cards[replacement], undefined);
    assert.equal(setTeam(c, [id, ...STARTER_IDS.slice(1)]), false);
  }
  assert.equal(addCard(c, '__proto__'), null);
  assert.deepEqual(normalizeCollection({ cards: JSON.parse('{"__proto__":{"copies":99}}') }), createCollection());
});
