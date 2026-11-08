// Compare actual shipped query/projectile/retaliation paths with exact rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url()); if (url.hostname !== 'legends-spatial.test') return route.abort();
    const file = path.join(root, decodeURIComponent(url.pathname)); return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.abort();
  });
  await page.goto('http://legends-spatial.test/science-legends.html');
  await page.locator('#startBtn').click(); await page.waitForFunction(() => G && G.time > .05);
  const result = await page.evaluate(() => {
    newGame('barb'); hide('menuOverlay'); G.state = 'qa-manual'; G.enemies = []; G.pets = []; G.projs = []; G.eprojs = []; G.spawnT = 999; G.qTimer = -1000; G.time = 1;
    G.player.hp = G.player.maxHp = 1e8; G.stats.mods = {}; G.stats.crit = 0;
    let seed = 7941; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 140; i++) { const e = spawnEnemy('slime', false); Object.assign(e, { x: 50 + (i % 14) * 150, y: 50 + Math.floor(i / 14) * 150, hp: 10000, maxHp: 10000, speed: 0, dmg: 0, r: 4 + random() * 60, _qaIndex: i }); }
    const radiusMismatches = [], arcMismatches = [], projectileMismatches = [];
    const ids = list => list.map(e => e._qaIndex).join(',');
    for (let n = 0; n < 250; n++) {
      const x = random() * 2300, y = random() * 2300, radius = random() * 400, angle = random() * Math.PI * 2, arc = random() * Math.PI * 2;
      const live = G.enemies.filter(e => !e.dead && e.hp > 0);
      const exactRadius = live.filter(e => (e.x - x) ** 2 + (e.y - y) ** 2 <= (radius + e.r) ** 2);
      const exactArc = live.filter(e => Math.hypot(e.x - x, e.y - y) <= radius + e.r && Math.abs(((Math.atan2(e.y - y, e.x - x) - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) <= arc / 2);
      if (ids(enemiesInRadius(x, y, radius)) !== ids(exactRadius)) radiusMismatches.push(n);
      if (ids(enemiesInArc(x, y, angle, radius, arc)) !== ids(exactArc)) arcMismatches.push(n);
    }
    const candidateSizes = [], exact = LegendsCombat.sweepHits, damage = dealDamage;
    LegendsCombat.sweepHits = function (p, x, y, enemies) { candidateSizes.push(enemies.length); return exact(p, x, y, enemies); };
    try {
      for (let n = 0; n < 20; n++) {
        const x = 40 + random() * 2100, y = 40 + random() * 1500, endX = Math.min(2250, x + 100 + random() * 500), endY = Math.min(2200, y + random() * 150 - 75);
        for (const e of G.enemies) { e.hp = e.maxHp = 10000; e.dead = false; }
        const p = { kind: 'skillproj', sid: 'axes', x, y, vx: (endX - x) * 120, vy: (endY - y) * 120, r: 5, dmg: 2, life: 1, pierce: 1000 };
        const expected = exact(p, endX, endY, G.enemies).map(hit => hit.enemy._qaIndex), actual = [];
        window.dealDamage = function (e, ...args) { actual.push(e._qaIndex); return damage(e, ...args); };
        G.projs = [p]; updateProjectiles(1 / 120);
        if (actual.join(',') !== expected.join(',')) projectileMismatches.push({ n, expected, actual });
      }
    } finally { LegendsCombat.sweepHits = exact; window.dealDamage = damage; }
    // Native order is observable when equally close homing targets lie on
    // opposite sides. The first target must still win the strict-distance tie.
    const a = G.enemies[0], b = G.enemies[1];
    Object.assign(a, { x: 100, y: 300, hp: 10000, dead: false }); Object.assign(b, { x: 100, y: 100, hp: 10000, dead: false }); G.enemies = [a, b];
    const homing = { kind: 'skillproj', sid: 'axes', x: 0, y: 200, vx: 1000, vy: 0, r: 3, dmg: 1, life: 1, pierce: 2, homing: true };
    G.projs = [homing]; updateProjectiles(1 / 120); const tieDirection = homing.vy;

    // A secondary area query can happen inside movement when a shield breaks.
    // Stress a multi-cell movement to expose stale buckets hidden by small
    // scenes' conservative full-bucket fallback.
    G.enemies = []; G.pets = []; G.projs = [];
    Object.assign(G.player, { x: 1000, y: 1000, hp: 100, maxHp: 100, shield: 1, dashT: 0, evadeT: 0 });
    G.stats.armor = 0; G.stats.dmg = 1; G.stats.mods = { 'pw.guardian': true };
    for (let i = 0; i < 139; i++) { const e = spawnEnemy('slime', false); Object.assign(e, { x: 50 + (i % 14) * 150, y: 50 + Math.floor(i / 14) * 150, hp: 1000, maxHp: 1000, stun: 100, speed: 0, dmg: 0 }); }
    const incoming = spawnEnemy('mite', false); Object.assign(incoming, { x: 1500, y: 1000, hp: 1000, maxHp: 1000, speed: 60000, dmg: 2, hitCd: 0 });
    enemiesInRadius(1000, 1000, 10); updateEnemies(1 / 120);
    return { radiusMismatches, arcMismatches, projectileMismatches, candidateSizes, tieDirection, incoming: { x: incoming.x, hp: incoming.hp }, player: { hp: G.player.hp, shield: G.player.shield } };
  });
  check(result.radiusMismatches.length === 0, '250 actual radius queries preserve brute-force targets and order');
  check(result.arcMismatches.length === 0, '250 actual arc queries preserve brute-force angle/range rules and order');
  check(result.projectileMismatches.length === 0, '20 actual fast projectile updates preserve the exact swept hit order: ' + JSON.stringify(result.projectileMismatches));
  check(result.candidateSizes.length >= 20 && result.candidateSizes.reduce((sum, size) => sum + size, 0) / result.candidateSizes.length < 35, 'actual projectile sweeps receive a small local subset rather than all140 enemies');
  check(result.tieDirection > 0, 'homing retains the original first-enemy tie order');
  check(result.incoming.x === 1000 && result.incoming.hp === 940 && result.player.shield === 0, 'guardian retaliation inside enemy movement sees the newly moved foe rather than stale spatial buckets');
  check(errors.length === 0, 'actual spatial scenarios leave no browser errors: ' + errors.join(', '));
  console.log(JSON.stringify({ candidateMean: result.candidateSizes.reduce((sum, size) => sum + size, 0) / result.candidateSizes.length, candidateMax: Math.max(...result.candidateSizes), incoming: result.incoming }));
  console.log(`Science Legends spatial browser: ${checks} checks passed`);
} finally { await browser.close(); }
