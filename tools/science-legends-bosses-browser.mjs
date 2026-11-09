import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
  : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {})
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'legends-bosses.test') return route.abort();
    const file = path.join(root, decodeURIComponent(url.pathname));
    return fs.existsSync(file) && fs.statSync(file).isFile()
      ? route.fulfill({ path: file })
      : route.abort();
  });
  await page.goto('http://legends-bosses.test/science-legends.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => G?.state === 'play', null, { timeout: 20000 });

  const results = await page.evaluate(() => {
    const step = 1 / 120;
    muted = true;
    function reset() {
      newGame('barb');
      G.enemies = [];
      G.pets = [];
      G.qTimer = -1000;
      G.spawnT = 999;
      Object.assign(G.player, { x: 1000, y: 1000, hp: 10000, maxHp: 10000 });
      G.stats.armor = 0;
      G.stats.regen = 0;
    }
    function milestone(wave) {
      reset();
      G.wave = wave - 1;
      G.waveT = 40 - step / 2;
      doSpawning(step);
      const boss = G.enemies.find(enemy => enemy.boss);
      if (!boss) throw new Error('Milestone did not spawn a boss');
      G.enemies = [boss];
      Object.assign(boss, { x: 1180, y: 1000 });
      boss.variety.cooldown = 0;
      G.atkTarget = boss;
      updateTargetPanel();
      return boss;
    }
    function tick() {
      G.time += step;
      updateEnemies(step);
    }
    function until(condition) {
      for (let i = 0; i < 900 && !condition(); i++) tick();
      if (!condition()) throw new Error('Boss did not finish the expected action');
    }

    const waves = [5, 10, 15, 20].map(wave => {
      const boss = milestone(wave);
      return { wave: G.wave, id: boss.bossId, bossWave: boss.bossWave, name: $('targetName').textContent, role: $('targetType').textContent };
    });
    reset();
    G.wave = 9;
    G.waveT = 40 - step / 2;
    G.enemies = Array.from({ length: MAX_ENEMIES }, () => ({ kind: 'mite', hp: 1 }));
    doSpawning(step);
    const queuedWave = G.pendingBoss;
    G.wave = 21;
    G.enemies = [];
    doSpawning(step);
    const delayed = { queuedWave, boss: G.enemies[0].bossId, bossWave: G.enemies[0].bossWave };

    const prism = milestone(10);
    until(() => prism.variety.phase === 'windup');
    const captions = [];
    const originalCaption = drawThreatCaption;
    window.drawThreatCaption = (x, y, text) => captions.push(text);
    try { drawEnemyTelegraphs(); }
    finally { window.drawThreatCaption = originalCaption; }
    G.player.y += 200;
    until(() => prism.variety.phase === 'recovery');
    const volley = G.eprojs.map(({ vx, vy, element }) => ({ vx, vy, element }));
    for (let i = 0; i < 160; i++) updateProjectiles(step);
    const prismHp = G.player.hp;

    const mire = milestone(15);
    mire.hp *= .5;
    until(() => G.hazards.length > 0);
    const mirePools = G.hazards.map(({ x, y, kind, warning }) => ({ x, y, kind, warning }));
    const brood = G.enemies.filter(enemy => enemy.parentKind === 'mire').map(({ noLoot, noXP }) => ({ noLoot, noXP }));
    Object.assign(G.player, { x: mirePools[0].x, y: mirePools[0].y });
    const beforeWarning = G.player.hp;
    updateHostileHazards(.05);
    const duringWarning = G.player.hp;
    updateHostileHazards(.1);
    const afterWarning = G.player.hp;
    const slowed = G.player.hazardSlowT > 0;

    const storm = milestone(20);
    until(() => storm.variety.phase === 'windup');
    const stormStart = storm.x;
    G.player.y += 110;
    until(() => storm.variety.phase === 'recovery');
    const dodge = { moved: stormStart - storm.x, hp: G.player.hp };
    const stormHit = milestone(20);
    until(() => stormHit.variety.phase === 'recovery');
    const strike = { actual: 10000 - G.player.hp, expected: stormHit.dmg * 1.12 };

    const rewardBoss = milestone(5);
    META.inv = [];
    killEnemy(rewardBoss, {});
    const item = META.inv[0];
    const persisted = JSON.parse(localStorage.getItem('legends_meta_' + studentKey)).inv;
    killEnemy(rewardBoss, {});
    const loot = { count: META.inv.length, persisted: persisted.some(saved => saved.id === item?.id), gold: G.gold };
    return { waves, delayed, captions, volley, prismHp, mirePools, brood, beforeWarning, duringWarning, afterWarning, slowed, dodge, strike, loot };
  });

  assert.deepEqual(results.waves.map(({ wave, id, bossWave, name }) => [wave, id, bossWave, name]), [
    [5, 'tyrant', 5, 'Core Tyrant'], [10, 'prism', 10, 'Prism Regent'],
    [15, 'mire', 15, 'Mire Matriarch'], [20, 'storm', 20, 'Storm Warden']
  ]);
  assert.ok(results.waves.every(wave => wave.role.startsWith('BOSS')));
  assert.deepEqual(results.delayed, { queuedWave: 10, boss: 'prism', bossWave: 10 });
  assert.ok(results.captions.includes('3 CRYSTAL LANES'), 'Prism windup appears in the arena caption layer');
  assert.equal(results.volley.length, 3);
  assert.ok(results.volley.every(shot => shot.element === 'prism' && shot.vx < 0));
  assert.ok(Math.abs(results.volley[1].vy) < 1e-8, 'Prism preserves its locked aim after a sidestep');
  assert.equal(results.prismHp, 10000, 'sidestepping the volley avoids every bolt');
  assert.ok(results.mirePools.length === 3 && results.mirePools.every(pool => pool.kind === 'mire' && pool.warning > 0));
  assert.ok(results.brood.length === 2 && results.brood.every(child => child.noLoot && child.noXP));
  assert.equal(results.beforeWarning, results.duringWarning);
  assert.ok(results.afterWarning < results.duringWarning && results.slowed);
  assert.ok(results.dodge.moved > 290 && results.dodge.hp === 10000, 'Storm moves along its warning corridor without chasing the dodge');
  assert.ok(Math.abs(results.strike.actual - results.strike.expected) < 1e-8, 'Storm lunge connects once');
  assert.deepEqual(results.loot, { count: 1, persisted: true, gold: 60 });
  assert.deepEqual(errors, []);
  console.log('Science Legends boss rotation, real encounters, and one-time persistent loot passed.');
} finally {
  await browser.close();
}
