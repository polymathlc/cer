import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the production combat functions with deterministic shot randomness.
// Targets, obstacles and audio are isolated; collision/cadence/aim are shipped code.
const source = fs.readFileSync(new URL('../fps.html', import.meta.url), 'utf8');
const combat = source.slice(source.indexOf('function effDmg('), source.indexOf('function damageEnemy('));
function fixture({ obstacle = () => null } = {}) {
  const hits = [], beams = [], sounds = [];
  const math = Object.create(Math); math.random = () => 0.5;
  const weapon = { arch: { key: 'blaster', proj: 'bullet', speed: 34 },
    dmg: 16, rof: 9.5, mag: 1000, reload: 1, pellets: 1, spread: 0,
    bloom: 1, kick: 1, element: 'none' };
  const c = vm.createContext({ Math: math, Number, Set, console, REND_W: 960, REND_H: 540,
    // Intentionally stale renderer values: production shots must ignore these.
    HOR: 70, ZOOM: 4, ENEMY_INDEX: { dummy: { crit: [0.08, 0.22] } },
    G: { weapon, player: { x: 0, y: 0, dir: 0, pitch: 0, hp: 100, maxHp: 100, dmgMult: 1 },
      ammo: 1000, reloading: 0, fireCd: 0, bloomNow: 0, ads: 0, viewKick: 0, yawKick: 0,
      mods: {}, pProj: [], enemies: [], particles: [], casings: [] },
    skillLv: () => 0, classMods: () => ({ dmg: 1, rof: 1, range: 24, spread: 1, critMult: 2 }),
    obstacleAt: obstacle, lineOfSight: () => true, updateHud() {}, magSize: () => 1000,
    mouseDown: false, sfx: new Proxy({}, { get: (_, key) => () => sounds.push(key) }),
    wrapAngle: angle => Math.atan2(Math.sin(angle), Math.cos(angle)),
    spawnBeam: (...args) => beams.push(args),
    damageEnemy: (e, dmg, w, effects, crit) => { e.hp -= dmg; hits.push({ e, dmg, crit }); },
  });
  vm.runInContext(combat, c);
  const target = (x, { y = 0, size = 1, hp = 1000 } = {}) => {
    const e = { x, y, size, hp, maxHp: hp, type: 'dummy' }; c.G.enemies.push(e); return e;
  };
  const aimAtFraction = (e, fraction) => {
    const scale = 540 / e.x, height = scale * 0.95 * e.size;
    c.G.player.pitch = -scale * 0.48 + height * (1 - fraction);
  };
  return { c, hits, beams, sounds, target, aimAtFraction, weapon };
}

test('shots capture current camera aim and scope instead of stale render state', () => {
  const { c, weapon } = fixture();
  c.G.player.pitch = 14; c.G.viewKick = 8; c.G.yawKick = 0.02;
  weapon.arch.scope = 3; c.G.ads = 0.5;
  const aim = c.strikeShotAim();
  assert.equal(aim.hor, 292); assert.equal(aim.dir, 0.02); assert.equal(aim.zoom, 2);
  c.spawnBullet(aim.dir, weapon, 'bullet', aim);
  assert.equal(c.G.pProj[0].aim.hor, 292);
  assert.equal(c.G.pProj[0].ox, 0, 'a close target is not skipped by muzzle offset');
});

test('ballistic rounds travel quickly while crossbow and plasma retain their identities', () => {
  const { c, weapon } = fixture();
  assert.equal(c.bulletSpeed(weapon), 119);
  assert.equal(c.bulletSpeed({ arch: { proj: 'bolt', speed: 18 } }), 18);
  assert.equal(c.bulletSpeed({ arch: { proj: 'stream', speed: 10 } }), 10);
});

test('a swept fast projectile hits the nearest enemy regardless of array order', () => {
  const { c, hits, target, weapon } = fixture();
  const far = target(10), near = target(5);
  c.spawnBullet(0, weapon, 'bullet'); c.updatePProj(0.12);
  assert.equal(hits.length, 1); assert.equal(hits[0].e, near);
  assert.equal(far.hp, 1000); assert.equal(c.G.pProj.length, 0);
});

test('small minion headshots do not depend on where a frame step lands', () => {
  for (const dt of [1 / 144, 1 / 30, 0.05]) {
    const { c, hits, target, aimAtFraction, weapon } = fixture();
    const e = target(5, { size: 0.25 }); aimAtFraction(e, 0.15);
    c.spawnBullet(0, weapon, 'bullet');
    // Moving the camera after the trigger must not redirect a shot in flight.
    c.G.player.pitch = 140;
    for (let t = 0; t < 0.15 && c.G.pProj.length; t += dt) c.updatePProj(dt);
    assert.equal(hits.length, 1); assert.equal(hits[0].crit, true);
    assert.equal(hits[0].dmg, 32);
  }
});

test('piercing shots hit in depth order once each, with damage falloff', () => {
  const { c, hits, target, weapon } = fixture();
  weapon.arch.pierce = 2;
  const far = target(8), near = target(5);
  c.spawnBullet(0, weapon, 'bullet');
  for (let n = 0; n < 4; n++) c.updatePProj(0.03);
  assert.deepEqual(hits.map(h => h.e), [near, far]);
  assert.deepEqual(hits.map(h => h.dmg), [16, 11]);
});

test('tree trunks stop fast rounds before enemies and do not play enemy-hit audio', () => {
  const { c, hits, sounds, target, weapon } = fixture({ obstacle: x => x === 3 ? 'tree' : null });
  c.G.player.y = 0.5; target(5, { y: 0.5 });
  c.spawnBullet(0, weapon, 'bullet'); c.updatePProj(0.1);
  assert.equal(hits.length, 0); assert.equal(c.G.pProj.length, 0);
  assert.equal(sounds.includes('hit'), false);
});

test('projectiles stop at their exact maximum range even on a long update', () => {
  const { c, hits, target, weapon } = fixture(); target(25);
  c.spawnBullet(0, weapon, 'bullet'); const shot = c.G.pProj[0];
  c.updatePProj(1);
  assert.equal(hits.length, 0); assert.equal(c.G.pProj.length, 0);
  assert.ok(Math.abs(shot.x - 24) < 1e-10);
});

test('laser and ballistic rounds agree on visible head and body aim', () => {
  for (const fraction of [0.15, 0.6]) {
    const { c, hits, target, aimAtFraction, weapon } = fixture();
    const e = target(7); aimAtFraction(e, fraction);
    c.spawnBullet(0, weapon, 'bullet'); c.updatePProj(0.1);
    c.fireBeam(0, weapon);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].crit, fraction === 0.15); assert.equal(hits[1].crit, hits[0].crit);
  }
});

test('continuous fire preserves cadence across 30, 60 and 144fps', () => {
  const counts = [];
  for (const fps of [30, 60, 144]) {
    const { c } = fixture(); c.mouseDown = true;
    for (let n = 0; n < fps * 2; n++) c.strikeUpdateWeapon(1 / fps);
    counts.push(1000 - c.G.ammo);
  }
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, counts.join(','));
  assert.ok(counts.every(count => Math.abs(count - 19) <= 1), counts.join(','));
});

test('a press and release between frames is consumed once and queued taps expire', () => {
  const { c } = fixture(); c.G.triggerQueued = 0.16;
  c.strikeUpdateWeapon(1 / 60); c.strikeUpdateWeapon(1 / 60);
  assert.equal(c.G.ammo, 999); assert.equal(c.G.triggerQueued, 0);
  c.G.triggerQueued = 0.16; c.G.reloading = 0.8;
  for (let n = 0; n < 60; n++) c.strikeUpdateWeapon(1 / 60);
  assert.equal(c.G.ammo, 1000, 'a tap during a long reload never fires much later');
});

test('held fire resumes on reload completion without an extra frame delay', () => {
  const { c, sounds } = fixture();
  c.mouseDown = true; c.G.reloading = 0.01; c.G.ammo = 0;
  c.strikeUpdateWeapon(0.02);
  assert.equal(c.G.ammo, 999); assert.equal(c.G.reloading, 0);
  assert.deepEqual(sounds.slice(0, 2), ['reloadEnd', 'shoot']);
});

test('shotgun pellet fan spreads consistently and recoil never permanently drifts aim', () => {
  const { c, weapon } = fixture();
  weapon.pellets = 8; weapon.spread = 5; weapon.arch.key = 'scatter';
  c.G.player.dir = 0.1; c.shoot();
  const angles = c.G.pProj.map(p => Math.atan2(p.dy, p.dx));
  assert.equal(new Set(angles).size, 8);
  assert.ok(angles.every((angle, i) => i === 0 || angle > angles[i - 1]));
  assert.ok(Math.abs(angles.reduce((a, b) => a + b, 0) / 8 - 0.1) < 1e-12);
  assert.equal(c.G.player.dir, 0.1);
});

test('generated enemy critical bands retain Hollow Point skill widening', () => {
  const { c } = fixture();
  c.strikeEnemyArtBand = () => [0.14, 0.32]; c.skillLv = key => key === 'hollowpoint' ? 2 : 0;
  const band = c.critBand({ type: 'dummy' });
  assert.ok(Math.abs(band[0] - 0.116) < 1e-12);
  assert.ok(Math.abs(band[1] - 0.344) < 1e-12);
});

test('later shotgun body pellets preserve stronger critical and elimination markers', () => {
  const { c } = fixture();
  c.tryMove = () => {}; c.addFloater = () => {};
  c.G.hitmark = { t: 0.25, kind: 'kill' };
  vm.runInContext(source.slice(source.indexOf('function damageEnemy('), source.indexOf('function onEnemyKilled(')), c);
  const enemy = { x: 5, y: 0, hp: 100, maxHp: 100 };
  c.damageEnemy(enemy, 5, null, true, false);
  assert.equal(c.G.hitmark.kind, 'kill');
  c.G.hitmark = { t: 0.25, kind: 'crit' };
  c.damageEnemy(enemy, 5, null, true, false);
  assert.equal(c.G.hitmark.kind, 'crit');
  c.G.hitmark.t = 0.05;
  c.damageEnemy(enemy, 5, null, true, false);
  assert.equal(c.G.hitmark.kind, 'hit');
});

test('fast impact traces survive a single-frame hit at the captured world height', () => {
  const { c, target, weapon } = fixture(); target(5);
  c.spawnBullet(0, weapon, 'bullet'); c.updatePProj(0.05);
  const trace = c.G.particles.find(p => p.kind === 'ballisticTrace');
  const spark = c.G.particles.find(p => p.kind === 'spark');
  assert.ok(trace); assert.equal(trace.t, 0.09); assert.equal(spark.z, 0.48);
  assert.equal(c.strikeShotHeight(trace.aim, trace.x1, trace.y1), 0.48);
  c.G.player.pitch = 100;
  assert.equal(c.strikeShotHeight(trace.aim, trace.x1, trace.y1), 0.48);
});

test('low-power ADS optics keep a crosshair while sniper scopes supply their own', () => {
  const { c, weapon } = fixture();
  let arms = 0;
  c.ctx = { fillRect: () => arms++ }; c.G.dmgDirs = []; c.G.ads = 1;
  vm.runInContext(source.slice(source.indexOf('function drawCrosshair('), source.indexOf('/* ---------- wave banner:')), c);
  for (const scope of [undefined, 1.5, 1.8, 2.3]) {
    weapon.arch.scope = scope; arms = 0; c.drawCrosshair(); assert.ok(arms > 0, String(scope));
  }
  weapon.arch.scope = 3; arms = 0; c.drawCrosshair(); assert.equal(arms, 0);
});

test('a forgiving graze over a small bug never steals a shot aimed at the enemy behind it', () => {
  const { c, hits, target, aimAtFraction, weapon } = fixture();
  const far = target(10, { size: 1 }), near = target(4, { size: 0.6 });
  aimAtFraction(far, 0.15);
  const nearBand = c.strikeShotBand(near, c.strikeShotAim());
  assert.ok(nearBand && nearBand.over, 'the shot only grazes over the small bug');
  c.spawnBullet(0, weapon, 'bullet'); c.updatePProj(0.5);
  assert.equal(hits[0].e, far); assert.equal(near.hp, 1000);
});

test('a level shot just over a small bug alone still counts as a body hit, never a crit', () => {
  const { c, hits, target, weapon } = fixture();
  const bug = target(4, { size: 0.6 });
  const band = c.strikeShotBand(bug, c.strikeShotAim());
  if (band && band.over) {
    c.spawnBullet(0, weapon, 'bullet'); c.updatePProj(0.3);
    assert.equal(hits[0].e, bug); assert.equal(hits[0].crit, false);
  } else assert.ok(band, 'a level shot reaches the bug');
});

test('aim assist leaves a clean hit alone, bends a near miss and ignores a wild one', () => {
  const { c, target, aimAtFraction } = fixture();
  const far = target(20, { size: 1 });   // far enough that its body is narrower than the assist window
  aimAtFraction(far, 0.5);
  assert.equal(c.aimAssist(0), 0, 'already on target: unchanged');
  const miss = 1.4 * Math.PI / 180;
  const bent = c.aimAssist(miss);
  assert.ok(Math.abs(bent) < miss * 0.5, 'a near miss is bent toward the target');
  assert.equal(c.aimAssist(4 * Math.PI / 180), 4 * Math.PI / 180, 'a wild miss stays a miss');
});
