import test from 'node:test';
import assert from 'node:assert/strict';
import loot from '../science-legends-loot.js';

test('one of 10,000 equally spaced rolls yields the class Mythic Unique', () => {
  let rolls = 0;
  let ordinary = 0;
  let uniqueIds = 0;
  let mythics = 0;
  for (let i = 0; i < 10000; i++) {
    const item = loot.rollBossItem('barb', () => {
      rolls++;
      return i / 10000;
    }, () => {
      ordinary++;
      return { r: 'rare' };
    }, () => 'mythic-' + ++uniqueIds);
    if (item.r === 'mythic') {
      mythics++;
      assert.equal(item.signature, 'worldbreaker');
    }
  }
  assert.deepEqual({ rolls, ordinary, uniqueIds, mythics }, { rolls: 10000, ordinary: 9999, uniqueIds: 1, mythics: 1 });
});

test('each Mythic Unique only equips on its class with the expected physical slot', () => {
  const cases = [
    ['barb', 'worldbreaker', 'mainhand'], ['sorc', 'astral-heart', 'offhand'],
    ['beast', 'primeval-pact', 'offhand'], ['pala', 'sunward', 'offhand'], ['ama', 'skyspike', 'mainhand']
  ];
  for (const [classId, signature, slot] of cases) {
    const item = loot.rollBossItem(classId, () => 0, () => assert.fail('Expected signature drop'), () => signature);
    assert.equal(item.signature, signature);
    const meta = { inv: [item], eq: { [slot]: item.id } };
    assert.equal(loot.activeGear(meta, classId)[slot], item);
    for (const [other] of cases.filter(entry => entry[0] !== classId)) {
      assert.equal(loot.activeGear(meta, other)[slot], undefined);
      assert.equal(loot.planEquip(meta, item, slot, other).issue, 'class');
    }
  }
});

test('one-handed setups keep an offhand and two-handed setups return it to the bag', () => {
  const sword = { id: 'sword', slot: 'onehand' };
  const shield = { id: 'shield', slot: 'shield' };
  const poleaxe = { id: 'poleaxe', slot: 'twohand' };
  const meta = { inv: [sword, shield, poleaxe], eq: { mainhand: sword.id, offhand: shield.id } };
  assert.deepEqual(loot.activeGear(meta, 'pala'), { mainhand: sword, offhand: shield });
  const result = loot.planEquip(meta, poleaxe, 'mainhand', 'pala');
  assert.deepEqual(result.equipment, { mainhand: 'poleaxe', offhand: null });
  assert.equal(result.movedOffhand, true);
  assert.deepEqual(meta.inv, [sword, shield, poleaxe]);
  assert.equal(loot.planEquip({ ...meta, eq: result.equipment }, shield, 'offhand', 'pala').issue, 'hand');
  assert.equal(loot.activeGear({ ...meta, eq: { mainhand: poleaxe.id, offhand: shield.id } }, 'pala').offhand, undefined);
});

test('legacy Mythic rings remain valid and moving a ring leaves one active copy', () => {
  const first = { id: 'legacy', slot: 'ring', r: 'mythic', pw: 'echoring', af: { hp: 10 } };
  const second = { id: 'second', slot: 'ring', r: 'rare' };
  const meta = { inv: [first, second], eq: { ring1: first.id } };
  assert.equal(loot.signature(first), null);
  assert.equal(loot.activeGear(meta, 'sorc').ring1, first);
  assert.deepEqual(loot.planEquip(meta, second, undefined, 'sorc').equipment, { ring1: first.id, ring2: second.id });
  assert.deepEqual(loot.planEquip(meta, first, 'ring2', 'sorc').equipment, { ring1: null, ring2: first.id });
  assert.deepEqual(loot.activeGear({ ...meta, eq: { ring1: first.id, ring2: first.id } }, 'sorc'), { ring1: first });
});

test('new gear affinity is class appropriate and only rolls on Rare, Legendary and Unique gear', () => {
  assert.deepEqual(loot.rollAffinity({ slot: 'helm', r: 'rare' }, 'sorc', () => 0), { affinity: 'frost', affinityPower: 4 });
  assert.deepEqual(loot.rollAffinity({ slot: 'orb', r: 'unique' }, 'barb', () => .9999), { affinity: 'lightning', affinityPower: 16 });
  assert.equal(loot.rollAffinity({ slot: 'helm', r: 'magic' }, 'sorc', () => assert.fail('Unexpected Magic affinity')), null);
  const mythic = loot.rollBossItem('barb', () => 0, () => assert.fail('Expected Worldbreaker'), () => 'mythic');
  assert.equal(mythic.affinity, 'bleed');
  assert.equal(mythic.affinityPower, 22);
});
