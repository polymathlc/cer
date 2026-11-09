/* Persistent item categories, hand rules and the boss-exclusive loot roll. */
(function (root) {
  'use strict';

  const slots = [
    { id: 'mainhand', name: 'Main hand', icon: '⚔️' },
    { id: 'helm', name: 'Helm', icon: '🪖' },
    { id: 'offhand', name: 'Offhand', icon: '🛡️' },
    { id: 'gloves', name: 'Gloves', icon: '🧤' },
    { id: 'chest', name: 'Chest armour', icon: '🥋' },
    { id: 'amulet', name: 'Amulet', icon: '📿' },
    { id: 'ring1', name: 'Ring I', icon: '💍' },
    { id: 'pants', name: 'Pants', icon: '👖' },
    { id: 'ring2', name: 'Ring II', icon: '💍' },
    { id: 'greaves', name: 'Greaves', icon: '🥾' }
  ].map(Object.freeze);

  // Row-major layout of both generated 4 × 3 item atlases.
  const types = [
    ['helm', 'Helm', '🪖', ['helm']],
    ['chest', 'Chest armour', '🥋', ['chest']],
    ['gloves', 'Gloves', '🧤', ['gloves']],
    ['pants', 'Pants', '👖', ['pants']],
    ['greaves', 'Greaves', '🥾', ['greaves']],
    ['ring', 'Ring', '💍', ['ring1', 'ring2']],
    ['amulet', 'Amulet', '📿', ['amulet']],
    ['onehand', 'One-handed weapon', '⚔️', ['mainhand']],
    ['twohand', 'Two-handed weapon', '🪓', ['mainhand']],
    ['shield', 'Shield', '🛡️', ['offhand'], ['barb', 'pala']],
    ['focus', 'Focus', '📖', ['offhand'], ['beast', 'ama']],
    ['orb', 'Orb', '🔮', ['offhand'], ['sorc']]
  ];
  const categories = Object.freeze(Object.fromEntries(types.map(([id, name, icon, targets, classes], cell) => [
    id, Object.freeze({ name, icon, cell, slots: Object.freeze(targets), classes: classes && Object.freeze(classes) })
  ])));

  const mythicRate = 1 / 10000;
  const affinityNames = Object.freeze({
    physical: 'Physical', bleed: 'Bleed', frost: 'Frost', fire: 'Fire',
    lightning: 'Lightning', poison: 'Poison', holy: 'Holy'
  });
  const classAffinities = {
    barb: ['bleed', 'physical'], sorc: ['frost', 'fire', 'lightning'],
    beast: ['poison', 'physical'], pala: ['holy', 'lightning'],
    ama: ['physical', 'poison', 'lightning']
  };
  const affinityRanges = { rare: [4, 8], legendary: [7, 12], unique: [10, 16] };
  const signatures = Object.freeze({
    worldbreaker: Object.freeze({
      id: 'worldbreaker', name: 'Worldbreaker', classId: 'barb', slot: 'twohand',
      skill: 'whirlwind', damage: .35, area: .15, cd: 0, power: 'flamespin',
      affinity: 'bleed', affinityPower: 22,
      affixes: Object.freeze({ dmg: 16, critDmg: 24, area: 14, hp: 60 })
    }),
    'astral-heart': Object.freeze({
      id: 'astral-heart', name: 'Astral Heart', classId: 'sorc', slot: 'orb',
      skill: 'meteor', damage: .35, area: 0, cd: .15, power: 'meteorx2',
      affinity: 'frost', affinityPower: 22,
      affixes: Object.freeze({ cdr: 9, crit: 8, dmg: 14, hp: 44 })
    }),
    'primeval-pact': Object.freeze({
      id: 'primeval-pact', name: 'Primeval Pact', classId: 'beast', slot: 'focus',
      skill: 'wolf', damage: .35, area: 0, cd: .12, power: 'beastgod',
      affinity: 'poison', affinityPower: 20,
      affixes: Object.freeze({ petDmg: 25, regen: 1.4, hp: 54, armor: 8 })
    }),
    sunward: Object.freeze({
      id: 'sunward', name: 'Sunward', classId: 'pala', slot: 'shield',
      skill: 'consecrate', damage: .25, area: .20, cd: 0, power: 'guardian',
      affinity: 'holy', affinityPower: 20,
      affixes: Object.freeze({ armor: 12, hp: 70, regen: 1.5, area: 13 })
    }),
    skyspike: Object.freeze({
      id: 'skyspike', name: 'Skyspike', classId: 'ama', slot: 'twohand',
      skill: 'javelin', damage: .45, area: 0, cd: .15, power: 'windrunner',
      affinity: 'lightning', affinityPower: 20,
      affixes: Object.freeze({ dmg: 16, aspd: 13, crit: 8, critDmg: 22 })
    })
  });
  const byClass = Object.fromEntries(Object.values(signatures).map(item => [item.classId, item]));

  function category(base) {
    return Object.hasOwn(categories, base) ? categories[base] : null;
  }

  function signature(item) {
    if (!item || item.r !== 'mythic' || !Object.hasOwn(signatures, item.signature)) return null;
    const definition = signatures[item.signature];
    return definition.slot === item.slot ? definition : null;
  }

  function allowedClasses(item) {
    const named = signature(item);
    return named ? [named.classId] : category(item?.slot)?.classes;
  }

  function rollAffinity(item, classId, random) {
    if (!Object.hasOwn(affinityRanges, item.r)) return null;
    const allowed = allowedClasses(item);
    const target = allowed && !allowed.includes(classId) ? allowed[0] : classId;
    if (!Object.hasOwn(classAffinities, target)) return null;
    const pool = classAffinities[target];
    const [min, max] = affinityRanges[item.r];
    return {
      affinity: pool[Math.floor(random() * pool.length)],
      affinityPower: min + Math.floor(random() * (max - min + 1))
    };
  }

  function equipIssue(item, slot, classId, mainhand) {
    if (!category(item?.slot)?.slots.includes(slot)) return 'slot';
    const classes = allowedClasses(item);
    if (classes && !classes.includes(classId)) return 'class';
    if (slot === 'offhand' && mainhand?.slot === 'twohand') return 'hand';
    return '';
  }

  function activeGear(meta, classId) {
    const owned = new Map(meta.inv.map(item => [item?.id, item]));
    const gear = {};
    const used = new Set();
    for (const { id } of slots) {
      const item = owned.get(meta.eq[id]);
      if (item && !used.has(item.id) && !equipIssue(item, id, classId, gear.mainhand)) {
        gear[id] = item;
        used.add(item.id);
      }
    }
    return gear;
  }

  function planEquip(meta, item, slot, classId) {
    const targets = category(item?.slot)?.slots || [];
    const target = slot || targets.find(id => !meta.eq[id]) || targets[0];
    const mainhand = meta.inv.find(entry => entry?.id === meta.eq.mainhand);
    const issue = equipIssue(item, target, classId, mainhand);
    if (issue) return { issue };
    const equipment = { ...meta.eq };
    for (const { id } of slots) {
      if (equipment[id] === item.id) equipment[id] = null;
    }
    equipment[target] = item.id;
    const movedOffhand = item.slot === 'twohand' && !!equipment.offhand;
    if (movedOffhand) equipment.offhand = null;
    return { equipment, movedOffhand };
  }

  function rollBossItem(classId, random, rollOrdinary, makeId) {
    const mythic = random() < mythicRate;
    const named = Object.hasOwn(byClass, classId) && byClass[classId];
    if (!mythic || !named) return rollOrdinary();
    return {
      id: makeId(), slot: named.slot, r: 'mythic', name: named.name,
      signature: named.id, af: { ...named.affixes }, pw: named.power,
      affinity: named.affinity, affinityPower: named.affinityPower
    };
  }

  const api = Object.freeze({
    slots: Object.freeze(slots), categories, category, signature, allowedClasses,
    equipIssue, activeGear, planEquip, rollBossItem, mythicRate, affinityNames, rollAffinity
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LegendsLoot = api;
})(typeof window === 'object' ? window : globalThis);
