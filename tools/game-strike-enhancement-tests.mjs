import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../fps.html', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function strikeMovementVector('), source.indexOf('/* ════════════════ SIM'));
function setup() {
  let ready = true;
  const hud = { textContent: '' };
  const c = vm.createContext({ Math, Number, keys: {}, G: { player: { dir: 0 }, dodgeCd: 0, projectiles: [] },
    combatReady: () => ready, $: () => hud });
  vm.runInContext(helpers, c);
  return { c, hud, setReady(value) { ready = value; } };
}

test('diagonal and straight movement have the same speed at every heading', () => {
  const { c } = setup();
  for (const dir of [0, Math.PI / 3, Math.PI, -Math.PI / 2]) {
    for (const [fwd, str] of [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1]]) {
      const v = c.strikeMovementVector(dir, fwd, str);
      assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-12);
    }
  }
  assert.equal(c.strikeMovementVector(0, 0, 0).x, 0);
});

test('quickstep fixes its direction, has a cooldown, and cannot fire while paused', () => {
  const { c, hud, setReady } = setup();
  c.keys.KeyD = true;
  assert.equal(c.strikeQuickstep(), true);
  assert.equal(c.G.dodgeVector.y, 1);
  assert.equal(c.G.dodgeT, 0.18);
  assert.equal(c.G.dodgeCd, 2.4);
  c.keys.KeyD = false; c.keys.KeyW = true;
  assert.equal(c.strikeQuickstep(), false);
  assert.equal(c.G.dodgeVector.y, 1);
  assert.match(hud.textContent, /2.4s/);
  c.G.dodgeCd = 0; setReady(false);
  assert.equal(c.strikeQuickstep(), false);
});

test('a stationary quickstep moves forward without granting invulnerability or changing health', () => {
  const { c } = setup();
  c.G.player.hp = 50; c.G.player.dir = Math.PI / 2;
  c.strikeQuickstep();
  assert.ok(Math.abs(c.G.dodgeVector.y - 1) < 1e-12);
  assert.equal(c.G.player.hp, 50);
  assert.equal(c.G.invulnerable, undefined);
});

test('charged shots follow the warned angle after the player has dodged', () => {
  const { c } = setup();
  const enemy = { x: 1, y: 1, dmg: 10 }, target = { x: 8, y: 1 };
  c.strikeBeginCharge(enemy, target);
  assert.equal(enemy.charge, 0.6);
  target.y = 6;
  c.strikeReleaseCharge(enemy);
  assert.equal(c.G.projectiles.length, 1);
  assert.equal(c.G.projectiles[0].dx, 5.5);
  assert.equal(c.G.projectiles[0].dy, 0);
  assert.equal(c.G.projectiles[0].dmg, 10);
  c.strikeReleaseCharge(enemy);
  assert.equal(c.G.projectiles.length, 1, 'released or cancelled aim cannot fire twice');
});

test('charge cancellation and the existing corrosive damage reduction remain effective', () => {
  const { c } = setup();
  const enemy = { x: 0, y: 0, dmg: 10, shred: 1 };
  c.strikeBeginCharge(enemy, { x: 0, y: 3 }); c.strikeReleaseCharge(enemy);
  assert.equal(c.G.projectiles[0].dmg, 8);
  enemy.chargeAim = null; c.strikeReleaseCharge(enemy);
  assert.equal(c.G.projectiles.length, 1);
});

test('all tree and rock variants render once into cached canvas sprites', () => {
  let paths = 0;
  const g = new Proxy({}, { get: (_, name) => (...args) => { if (name === 'fillRect') assert.ok(args.every(Number.isFinite)); paths++; }, set: () => true });
  const c = vm.createContext({ Math, sprCanvas: draw => { draw(g); return {}; }, cellHash: (x, y) => Math.abs(Math.sin(x * 3 + y)) });
  const start = source.indexOf('const obstacleSprites = {}');
  const end = source.indexOf('buildObstacleSprites();', start) + 'buildObstacleSprites();'.length;
  vm.runInContext(source.slice(start, end), c);
  assert.equal(vm.runInContext('obstacleSprites.tree.length', c), 3);
  assert.equal(vm.runInContext('obstacleSprites.rock.length', c), 3);
  assert.ok(paths > 100);
});

function collisionFixture(obstacleAt) {
  const c = vm.createContext({ Math, Number, obstacleAt });
  vm.runInContext(source.slice(source.indexOf('function strikePlayerBlocked('), source.indexOf('function lineOfSight(')), c);
  return c;
}

test('stacked-speed quicksteps cannot tunnel through a tree or rock cell', () => {
  const c = collisionFixture((x, y) => x === 1 && y === 0 ? 'tree' : null);
  const player = { x: 0.65, y: 0.5 };
  c.strikeMovePlayer(player, 3.1 * 1.8 * (1 + 25 * 0.08) * 0.04 * 2.7, 0, 0.22);
  assert.ok(player.x <= 0.78 && player.x >= 0.65);
  assert.equal(player.y, 0.5);
  player.x = 2.35;
  c.strikeMovePlayer(player, -1.80792, 0, 0.22);
  assert.ok(player.x >= 2.22 && player.x <= 2.35);
});

test('quickstep collision covers tile corners and still slides along walls', () => {
  const corner = collisionFixture((x, y) => x === 1 && y === 1 ? 'rock' : null);
  assert.equal(corner.strikePlayerBlocked(0.9, 0.9, 0.22), true);
  assert.equal(corner.strikePlayerBlocked(0.8, 0.8, 0.22), false);
  const c = collisionFixture(x => x === 1 ? 'rock' : null);
  const player = { x: 0.77, y: 0.5 };
  c.strikeMovePlayer(player, 1.8, 1.8, 0.22);
  assert.ok(player.x <= 0.78);
  assert.ok(Math.abs(player.y - 2.3) < 1e-12);
  const open = collisionFixture(() => null), free = { x: 0, y: 0 };
  open.strikeMovePlayer(free, 1.8, -1.8, 0.22);
  assert.ok(Math.abs(free.x - 1.8) < 1e-12 && Math.abs(free.y + 1.8) < 1e-12);
});
