// Verify observed combat-clock progress through real sustained critical hits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.GAME_SCREENSHOTS || path.join(root, 'test-results/legends-impact-budget');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'legends-impact.test') return route.abort();
    const file = path.join(root, decodeURIComponent(url.pathname));
    return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.abort();
  });
  await page.goto('http://legends-impact.test/science-legends.html');
  await page.waitForFunction(() => LegendsModels.allReady());
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => G && G.time > .05);
  const result = await page.evaluate(async () => {
    const rows = [];
    for (const reduced of [false, true]) {
      newGame('barb'); hide('menuOverlay'); lowMotion = reduced;
      G.enemies = []; G.pets = []; G.spawnT = 999; G.qTimer = -1000;
      G.player.hp = G.player.maxHp = 1e8; G.stats.crit = 1; G.stats.rank.whirlwind = 5;
      G.stats.unlocked.whirlwind = true; G.slots = ['whirlwind'];
      const p = G.player;
      for (let i = 0; i < 30; i++) { const e = spawnEnemy('brute', false), angle = i * 2.3999; Object.assign(e, { x: p.x + Math.cos(angle) * 80, y: p.y + Math.sin(angle) * 80, hp: 1e8, maxHp: 1e8, speed: 0, dmg: 0, stun: 100 }); }
      G.cds = {}; castSkill(0);
      const start = performance.now(), before = G.time;
      await new Promise(resolve => setTimeout(resolve, 2500));
      const wall = (performance.now() - start) / 1000, simulation = G.time - before;
      rows.push({ reduced, wall, simulation, ratio: simulation / wall, damagedFoes: G.enemies.filter(e => e.hp < e.maxHp).length });
    }
    return rows;
  });
  for (const row of result) {
    check(row.damagedFoes === 30, `${row.reduced ? 'Reduced' : 'Normal'} motion: real sustained skill still damages every nearby foe`);
    check(row.ratio >= .95 && row.ratio <= 1.04, `${row.reduced ? 'Reduced' : 'Normal'} motion: sustained critical hits keep at least95% real-time simulation progress (${row.ratio.toFixed(3)})`);
  }
  check(Math.abs(result[0].ratio - result[1].ratio) < .04, 'normal and reduced motion no longer have materially different combat-clock speed');
  check(errors.length === 0, 'impact-budget scenario leaves no browser errors: ' + errors.join(', '));
  fs.writeFileSync(path.join(output, 'impact-clock.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  console.log(`Science Legends impact budget browser: ${checks} checks passed`);
} finally { await browser.close(); }
