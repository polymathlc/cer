/* Damage affinities change what a skill does, while its cast geometry stays intact. */
(function (root) {
  'use strict';

  const damageTypes = new Set(['arc', 'spin', 'dash', 'proj', 'chain', 'nova', 'target', 'zone', 'aura', 'orbit']);
  const kinds = Object.freeze({
    physical: {name:'Physical', color:'#ffd4a0', detail:'Delivers its damage on impact.'},
    bleed: {name:'Bleed', color:'#ff8190', detail:'Deals 25% on impact and 75% as up to 8 stacking wounds over 3 seconds.'},
    fire: {name:'Fire', color:'#ff9554', detail:'Deals 60% on impact and 40% as up to 5 stacking burns over 2.5 seconds.'},
    frost: {name:'Frost', color:'#a4eaff', detail:'Chills on hit, deals 30% more to chilled foes, and freezes after 3 hits. This buildup cannot freeze bosses.'},
    lightning: {name:'Lightning', color:'#fff18c', detail:'Delivers a lightning hit.'},
    arcane: {name:'Arcane', color:'#c0a4ff', detail:'Delivers an arcane hit.'},
    poison: {name:'Poison', color:'#afe782', detail:'Deals poison damage.'},
    holy: {name:'Holy', color:'#fff2a5', detail:'Deals holy damage.'},
    arrow: {name:'Physical', color:'#ffd4a0', detail:'Delivers its damage on impact.'}
  });
  const woundKinds = ['bleed','fire'];

  function choices(classId, type, native) {
    if (!damageTypes.has(type)) return null;
    if (classId === 'barb') return ['physical', 'fire', 'bleed'];
    if (classId === 'sorc') {
      if (native === 'frost') return ['frost', 'lightning', 'fire'];
      return [native, 'frost', native === 'fire' ? 'lightning' : 'fire'];
    }
    return null;
  }

  function profiles(classId, type, native, affinity, flameSpin) {
    if (!damageTypes.has(type)) return null;
    const variants = choices(classId, type, native);
    return [flameSpin ? 'fire' : native, ...(variants || [native, native, native])].map((kind, index) => {
      const converted = kind !== native;
      return {
        kind,
        converted,
        status: kind === 'frost' || ((kind === 'bleed' || kind === 'fire') && (converted || !!(index && variants))),
        multiplier: 1 + (affinity[kind === 'arrow' ? 'physical' : kind] || 0),
        color: kinds[kind]?.color
      };
    });
  }

  function gearAffinity(items) {
    const affinity = {};
    for (const item of items) {
      if (!Object.hasOwn(kinds, item.affinity) || !Number.isFinite(item.affinityPower)) continue;
      const kind = item.affinity;
      affinity[kind] = Math.min(1.5, (affinity[kind] || 0) + Math.min(30, Math.max(0, item.affinityPower)) / 100);
    }
    return affinity;
  }

  function scale(profile, enemy, amount) {
    if (!profile) return amount;
    const chilled = profile.kind === 'frost' && (enemy.chillT > 0 || enemy.frozen > 0);
    return amount * profile.multiplier * (chilled ? 1.3 : 1);
  }

  function addWound(enemy, kind, total, duration, cap) {
    const effects = enemy.afflictions || (enemy.afflictions = {});
    const wounds = effects[kind] || (effects[kind] = []);
    const wound = {time: duration, rate: total / duration};
    if (wounds.length < cap) {
      wounds.push(wound);
      return;
    }
    let weakest = 0;
    for (let index = 1; index < wounds.length; index++) {
      if (wounds[index].rate * wounds[index].time < wounds[weakest].rate * wounds[weakest].time) weakest = index;
    }
    if (wounds[weakest].rate * wounds[weakest].time <= total) wounds[weakest] = wound;
  }

  function apply(profile, enemy, amount, now) {
    if (!profile?.status || amount <= 0) return amount;
    if (profile.kind === 'bleed') {
      addWound(enemy, 'bleed', amount * .75, 3, 8);
      return amount * .25;
    }
    if (profile.kind === 'fire') {
      addWound(enemy, 'fire', amount * .4, 2.5, 5);
      return amount * .6;
    }
    if (profile.kind === 'frost') {
      enemy.chillHits = (enemy.chillT > 0 ? enemy.chillHits || 0 : 0) + 1;
      enemy.chillT = 2;
      enemy.slowT = Math.max(enemy.slowT || 0, enemy.boss ? .35 : .85);
      if (enemy.chillHits >= 3) {
        enemy.chillHits = 0;
        if (!enemy.boss && (enemy.freezeLock || 0) <= now) {
          enemy.frozen = Math.max(enemy.frozen || 0, enemy.elite ? .65 : 1.25);
          enemy.freezeLock = now + 2.7;
        }
      }
    }
    return amount;
  }

  function tick(enemy, dt) {
    if (enemy.chillT > 0) enemy.chillT = Math.max(0, enemy.chillT - dt);
    if (!enemy.afflictions) return 0;
    let damage = 0;
    for (const kind of woundKinds) {
      const wounds = enemy.afflictions[kind];
      if (!wounds) continue;
      for (let index = wounds.length - 1; index >= 0; index--) {
        const wound = wounds[index];
        damage += wound.rate * Math.min(dt, wound.time);
        wound.time -= dt;
        if (wound.time <= 0) wounds.splice(index, 1);
      }
      if (!wounds.length) delete enemy.afflictions[kind];
    }
    if (!enemy.afflictions.bleed && !enemy.afflictions.fire) enemy.afflictions = null;
    return damage;
  }

  function rupture(enemy) {
    const wounds = enemy.afflictions?.bleed;
    if (!wounds) return 0;
    const damage = wounds.reduce((total, wound) => total + wound.rate * wound.time, 0);
    delete enemy.afflictions.bleed;
    return damage * 1.2;
  }

  const api = {kinds, choices, profiles, gearAffinity, scale, apply, tick, rupture};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LegendsBuilds = api;
})(typeof window === 'object' ? window : globalThis);
