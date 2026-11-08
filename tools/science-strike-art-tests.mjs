import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../fps.html', import.meta.url), 'utf8');
const registry = source.slice(source.indexOf('const strikeWorldArt ='), source.indexOf('function sprCanvas('));

function setup() {
  const pending = [], draws = [];
  const makeContext = () => new Proxy({}, {
    get(_, key) {
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args) => {
        if (key === 'drawImage') {
          assert.ok(args.slice(1).every(Number.isFinite), 'all image geometry is finite');
          draws.push(args);
        }
      };
    },
    set() { return true; },
  });
  const fallback = { frames: ['procedural'] };
  const c = vm.createContext({ Math, Object, Number, enemySprites: { crawler: fallback },
    Image: class { constructor() { pending.push(this); } },
    document: { createElement: () => ({ getContext: makeContext }) },
    REND_W: 960, REND_H: 540, HOR: 270, ZOOM: 1, ctx: makeContext(),
  });
  vm.runInContext(registry, c);
  return { c, draws, pending, fallback, read: expr => vm.runInContext(expr, c) };
}

test('missing or undecodable art preserves playable procedural enemy sprites', () => {
  const { c, pending, fallback, read } = setup();
  assert.equal(c.strikeEnemySprite({ type: 'crawler' }), fallback);
  assert.equal(c.strikeEnemyArtBand({ type: 'crawler' }), null);
  c.strikeLoadWorldImage('stalker', 'missing.png', image => c.strikeInstallEnemyArt('stalker', image));
  pending[0].onerror();
  assert.equal(c.strikeEnemySprite({ type: 'crawler' }), fallback);
  assert.deepEqual(Array.from(read('strikeWorldArt.failed')), ['stalker']);
  assert.equal(read('strikeWorldArt.loaded.length'), 0);
});

test('successful decode installs cached high resolution frames without replacing unrelated enemies', () => {
  const { c, pending, read } = setup();
  c.strikeLoadWorldImage('sentinel', 'sentinel.png', image => c.strikeInstallEnemyArt('sentinel', image));
  Object.assign(pending[0], { naturalWidth: 1024, naturalHeight: 1536 });
  pending[0].onload();
  const sprite = c.strikeEnemySprite({ type: 'sentinel' });
  assert.equal(sprite.generated, true);
  assert.equal(sprite.frames.length, 2);
  assert.equal(sprite.white.length, 2);
  assert.equal(sprite.frames[0].width, 384);
  assert.equal(sprite.frames[0].height, 512);
  assert.equal(c.strikeEnemySprite({ type: 'siegegolem' }).generated, true);
  assert.equal(c.strikeEnemyArtBand({ type: 'warden' }), null);
  assert.deepEqual(Array.from(read('strikeWorldArt.loaded')), ['sentinel']);
});

test('generated critical bands include actual source aspect ratio and letterboxing', () => {
  const { c } = setup();
  const square = c.strikeGeneratedEnemy({ naturalWidth: 1024, naturalHeight: 1024 }, 0, 'stalker');
  const portrait = c.strikeGeneratedEnemy({ naturalWidth: 1024, naturalHeight: 1536 }, 0, 'sentinel');
  for (const sprite of [square, portrait]) {
    assert.ok(sprite.crit[0] > 0 && sprite.crit[1] < 1);
    assert.ok(sprite.crit[0] < sprite.crit[1]);
  }
  assert.ok(square.crit[0] > 0.5, 'letterboxed low stalker eyes remain near the ground');
  assert.ok(portrait.crit[1] < 0.35, 'portrait sentinel visor stays high on the body');
});

test('panorama bearing wraps continuously and supplies coverage when scoped or pitched', () => {
  const { c, draws, read } = setup();
  vm.runInContext(source.slice(source.indexOf('function drawStrikePanorama('), source.indexOf('function drawRidge(')), c);
  vm.runInContext('strikeWorldArt.panorama = { naturalWidth: 2048, naturalHeight: 1024 };', c);
  c.drawStrikePanorama({ dir: 0.7 });
  const first = draws.map(args => args.slice(1));
  draws.length = 0;
  c.drawStrikePanorama({ dir: 0.7 + Math.PI * 2 });
  assert.equal(draws.length, first.length);
  draws.forEach((args, i) => args.slice(1).forEach((value, j) => assert.ok(Math.abs(value - first[i][j]) < 1e-9)));
  draws.length = 0;
  vm.runInContext('ZOOM = 4.5; HOR = 495;', c);
  c.drawStrikePanorama({ dir: -Math.PI });
  assert.ok(draws.length > 0);
  assert.equal(read('strikeWorldArt.panorama.naturalWidth'), 2048);
});
