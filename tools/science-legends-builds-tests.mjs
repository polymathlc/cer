import test from 'node:test';
import assert from 'node:assert/strict';
import builds from '../science-legends-builds.js';

test('Barbarian ultimates choose distinct damage affinities and override the item’s default fire spin', () => {
  const profiles = builds.profiles('barb', 'spin', 'physical', {bleed: .38}, true);
  assert.deepEqual(profiles.map(profile => profile.kind), ['fire', 'physical', 'fire', 'bleed']);
  assert.equal(builds.scale(profiles[3], {}, 100), 138);
  assert.equal(builds.scale(profiles[2], {}, 100), 100);
  assert.equal(builds.choices('barb', 'buff', 'physical'), null);
});

test('bleed and burn preserve their split damage over time and coexist', () => {
  const [, physical, fire, bleed] = builds.profiles('barb', 'arc', 'physical', {}, false);
  const enemy = {};
  assert.equal(builds.apply(physical, enemy, 100, 0), 100);
  assert.equal(builds.apply(fire, enemy, 100, 0), 60);
  assert.equal(builds.apply(bleed, enemy, 100, 0), 25);
  assert.equal(builds.tick(enemy, 1), 41);
  assert.equal(builds.tick(enemy, 2), 74);
  assert.equal(enemy.afflictions, null);
});

test('repeated bleeding hits stay bounded and rupture consumes the remaining damage once', () => {
  const bleed = builds.profiles('barb', 'spin', 'physical', {}, false)[3];
  const enemy = {};
  for (let index = 0; index < 25; index++) builds.apply(bleed, enemy, 100, 0);
  assert.equal(enemy.afflictions.bleed.length, 8);
  assert.equal(builds.tick(enemy, 1), 200);
  assert.equal(builds.rupture(enemy), 480);
  assert.equal(builds.rupture(enemy), 0);
  assert.equal(builds.tick(enemy, 2), 0);
});

test('Frost Fireball gains damage on chilled enemies and builds a bounded freeze', () => {
  const frost = builds.profiles('sorc', 'proj', 'fire', {frost: .22}, false)[2];
  const enemy = {};
  assert.equal(frost.kind, 'frost');
  assert.equal(builds.scale(frost, enemy, 100), 122);
  builds.apply(frost, enemy, 100, 0);
  assert.ok(Math.abs(builds.scale(frost, enemy, 100) - 158.6) < 1e-8);
  builds.apply(frost, enemy, 100, .1);
  assert.equal(enemy.frozen, undefined);
  builds.apply(frost, enemy, 100, .2);
  assert.equal(enemy.frozen, 1.25);
  const boss = {boss: true};
  for (let index = 0; index < 8; index++) builds.apply(frost, boss, 100, index * .1);
  assert.equal(boss.frozen, undefined);
  assert.equal(boss.chillT, 2);
});
