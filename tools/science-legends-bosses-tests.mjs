import test from 'node:test';
import assert from 'node:assert/strict';
import bosses from '../science-legends-bosses.js';
import variety from '../science-legends-variety.js';

const STEP = 1 / 120;

function encounter(id, position = {}) {
  const spec = bosses.get(id);
  const enemy = {
    ...spec, kind: 'boss', bossId: id, boss: true, x: 100, y: 100,
    hp: spec.hp, maxHp: spec.hp, fx: 1, fy: 0, ...position
  };
  const player = { x: 255, y: 100, hp: 1000, r: 16 };
  const shots = [];
  const hazards = [];
  const hits = [];
  const brood = [];
  const cues = [];
  const ctx = {
    time: 0, world: { w: 2300, h: 2300 }, player,
    shoot: shot => shots.push(shot),
    hazard: hazard => hazards.push(hazard),
    strike: (target, damage) => hits.push({ target, damage }),
    spawnChild: spec => brood.push(spec),
    cue: text => cues.push(text)
  };
  variety.initialize(enemy);
  function tick(dt = STEP, target = player) {
    ctx.time += dt;
    if (!bosses.advance(enemy, dt, target, ctx)) variety.advance(enemy, dt, target, ctx);
  }
  function until(condition) {
    for (let frame = 0; frame < 1800 && !condition(); frame++) tick();
    assert.ok(condition(), 'boss reaches the expected state');
  }
  return { enemy, player, ctx, shots, hazards, hits, brood, cues, tick, until };
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);
}

test('milestone bosses cycle in atlas column order, including a delayed milestone spawn', () => {
  const milestones = [5, 10, 15, 20, 25, 30].map(bosses.forWave);
  assert.deepEqual(milestones.map(boss => boss.id), ['tyrant', 'prism', 'mire', 'storm', 'tyrant', 'prism']);
  assert.deepEqual(milestones.map(boss => boss.column), [0, 1, 2, 3, 0, 1]);
  assert.equal(bosses.forWave(12), milestones[1]);
  assert.equal(bosses.get('constructor'), null);
  const tyrant = encounter('tyrant');
  assert.equal(bosses.advance(tyrant.enemy, STEP, tyrant.player, tyrant.ctx), false);
  tyrant.until(() => tyrant.hazards.length > 0);
  assert.equal(tyrant.hazards[0].kind, 'tyrant');
  assert.equal(bosses.intelligence(tyrant.enemy), null);
});

test('Prism Regent bolts follow the telegraphed lanes after the target moves', () => {
  const f = encounter('prism');
  f.until(() => f.enemy.variety.phase === 'windup');
  let segment;
  const strokes = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {},
    moveTo: (x, y) => { segment = [x, y]; },
    lineTo: (x, y) => segment.push(x, y),
    stroke: () => strokes.push(segment)
  };
  const before = JSON.stringify(f.enemy.variety);
  assert.equal(bosses.drawTelegraphs(ctx, f.enemy, f.ctx.time), true);
  assert.equal(JSON.stringify(f.enemy.variety), before);
  assert.equal(f.shots.length, 0);
  f.player.x -= 130;
  f.player.y += 185;
  f.until(() => f.enemy.variety.phase === 'recovery');
  assert.equal(f.shots.length, 3);
  assert.equal(strokes.length, 6);
  f.shots.forEach((shot, index) => {
    const [x, y, endX, endY] = strokes[index * 2];
    near(shot.x, x);
    near(shot.y, y);
    near(endX - x, shot.vx * shot.life);
    near(endY - y, shot.vy * shot.life);
  });
  assert.equal(f.shots[1].vy, 0, 'the central ray kept its locked aim');
  f.tick(.25);
  assert.equal(f.shots.length, 3);
  assert.equal(f.enemy.variety.phase, 'recovery');
});

test('Prism phase change cancels a commitment, warns once and releases five lanes', () => {
  const f = encounter('prism');
  f.until(() => f.enemy.variety.phase === 'windup');
  f.enemy.hp = f.enemy.maxHp * .55;
  f.tick();
  assert.equal(f.enemy.variety.phase, 'recovery');
  assert.equal(f.shots.length, 0);
  assert.equal(bosses.intelligence(f.enemy).name, 'Overcharged Prism Regent');
  f.until(() => f.shots.length > 0);
  assert.equal(f.shots.length, 5);
  assert.deepEqual(f.cues, ['PRISM OVERCHARGED']);
});

test('Mire beds hold their marked positions and its broods grant no rewards', () => {
  const f = encounter('mire');
  f.until(() => f.enemy.variety.phase === 'windup');
  const markedX = f.player.x;
  f.player.x += 100;
  f.player.y += 140;
  f.until(() => f.hazards.length > 0);
  assert.equal(f.hazards.length, 2);
  assert.equal(f.brood.length, 0);
  assert.ok(f.hazards.every(hazard => hazard.x === markedX && hazard.warning > 0 && hazard.slow > 0));
  assert.deepEqual(f.hazards.map(hazard => hazard.y), [47, 153]);
  f.player.x = markedX;
  f.player.y = 100;
  f.enemy.hp = f.enemy.maxHp * .5;
  f.until(() => f.hazards.length >= 11);
  assert.equal(f.hazards.length, 11, 'the new phase dropped three beds on each of three casts');
  assert.equal(f.brood.length, 4, 'the third cast cannot produce more hatchlings');
  assert.ok(f.brood.every(child => child.kind === 'mite' && child.noLoot && child.noXP && child.grace > 0));
});

test('Storm lunge hits a crossed target once and misses a sideways dodge', () => {
  const f = encounter('storm');
  f.player.x = 185;
  f.until(() => f.enemy.variety.phase === 'windup');
  f.until(() => f.enemy.variety.bossAttack?.active);
  assert.equal(f.hits.length, 0, 'the windup and release frame did not deal damage');
  f.tick(.25);
  assert.ok(f.enemy.x > f.player.x + f.player.r + f.enemy.r);
  assert.equal(f.hits.length, 1, 'swept collision catches the crossed target');
  f.player.x = f.enemy.x + 15;
  f.tick(.2);
  assert.equal(f.hits.length, 1, 'the same cast cannot hit its target again');
  f.until(() => f.enemy.variety.phase === 'recovery');

  const dodged = encounter('storm', { x: 2150, y: 100 });
  dodged.player.x = 2265;
  dodged.until(() => dodged.enemy.variety.phase === 'windup');
  dodged.player.y += 100;
  dodged.until(() => dodged.enemy.variety.phase === 'recovery');
  near(dodged.enemy.x, dodged.ctx.world.w - 20);
  assert.equal(dodged.hits.length, 0);
});

test('pause, control interruption and death prevent pending boss attacks from releasing', () => {
  for (const id of ['prism', 'mire', 'storm']) {
    const f = encounter(id);
    f.until(() => f.enemy.variety.phase === 'windup');
    const timer = f.enemy.variety.timer;
    f.ctx.paused = true;
    for (let i = 0; i < 8; i++) f.tick(.25);
    assert.equal(f.enemy.variety.timer, timer);
    f.ctx.paused = false;
    f.enemy.frozen = 1;
    f.tick(.25);
    assert.equal(f.enemy.variety.phase, 'recovery');
    assert.equal(f.enemy.modelAttackUntil, 0);
    f.enemy.frozen = 0;
    f.until(() => f.enemy.variety.phase === 'windup');
    f.enemy.dead = true;
    f.tick(.25);
    assert.equal(f.enemy.variety.phase, 'dead');
    assert.deepEqual([f.shots.length, f.hazards.length, f.hits.length], [0, 0, 0]);
  }

  const charging = encounter('storm');
  charging.until(() => charging.enemy.variety.bossAttack?.active);
  assert.equal(variety.interrupt(charging.enemy, 'stun', charging.ctx), true);
  const x = charging.enemy.x;
  charging.tick(.25);
  assert.equal(charging.enemy.x, x);
  assert.equal(charging.hits.length, 0);
});
