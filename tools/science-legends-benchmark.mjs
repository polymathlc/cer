// Advisory controlled benchmark, not a machine-specific CI pass/fail threshold.
// PLAYWRIGHT_BROWSER_CHANNEL=msedge node tools/science-legends-benchmark.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.GAME_SCREENSHOTS || path.join(root, 'test-results/legends-50-benchmark');
const requestedCadence = process.env.LEGENDS_BENCH_CADENCE === '60' ? 60 : 120;
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
const results = [];
try {
  for (const cfg of [{ label: 'desktop', width: 1280, height: 900, dpr: 1, throttle: 1, paintCadence: requestedCadence }, { label: 'mobile-cpu4', width: 390, height: 844, dpr: 2, throttle: 4, paintCadence: requestedCadence }]) {
    const context = await browser.newContext({ viewport: { width: cfg.width, height: cfg.height }, deviceScaleFactor: cfg.dpr, hasTouch: cfg.width < 600 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.__longTasks = [];
      try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'legends-eval.test') return route.abort();
      const file = path.join(root, decodeURIComponent(url.pathname));
      return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.abort();
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cfg.throttle });
    await page.goto('http://legends-eval.test/science-legends.html');
    await page.waitForFunction(() => LegendsModels.allReady() && ['fx-barb', 'fx-sorc', 'fx-beast', 'fx-pala', 'fx-ama', 'whirlwind'].every(s => LegendsActions.ready(s)), null, { timeout: 30000 });
    await page.evaluate(cadence => { if (typeof setPaintCadence === 'function') setPaintCadence(cadence); }, cfg.paintCadence);
    const load = await page.evaluate(() => ({ now: performance.now(), tasks: __longTasks.slice(), images: performance.getEntriesByType('resource').filter(r => /\.webp|\.png/.test(r.name)).map(r => ({ name: r.name.split('/').at(-1), size: r.encodedBodySize, duration: r.duration })), heap: performance.memory?.usedJSHeapSize }));
    await page.evaluate(() => {
      window.__stats = {};
      for (const name of ['update', 'draw', 'updateBars', 'updateSkillCds', 'updateCombatReadability', 'drawActors', 'drawArenaLandmarks', 'drawAtmosphere', 'updateEnemies', 'updatePets', 'updateProjectiles', 'buildGrid', 'pickEnemyAt', 'updateTargetPanel']) {
        const real = window[name]; if (typeof real !== 'function') continue;
        window[name] = function (...args) { const t = performance.now(); try { return real.apply(this, args); } finally { const s = __stats[name] || (__stats[name] = { calls: 0, ms: 0, max: 0 }); const dt = performance.now() - t; s.calls++; s.ms += dt; s.max = Math.max(s.max, dt); } };
      }
      window.__canvasStats = {};
      for (const name of ['drawImage', 'fillText', 'strokeText', 'createRadialGradient', 'getImageData']) {
        const real = CanvasRenderingContext2D.prototype[name];
        CanvasRenderingContext2D.prototype[name] = function (...args) { __canvasStats[name] = (__canvasStats[name] || 0) + 1; return real.apply(this, args); };
      }
      window.__mutationStats = { attrs: 0, text: 0, child: 0 };
      new MutationObserver(records => { for (const record of records) { if (record.type === 'attributes') __mutationStats.attrs++; else if (record.type === 'characterData') __mutationStats.text++; else __mutationStats.child++; } }).observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
      window.__measure = async function (label, ms) {
        __stats = {}; __canvasStats = {}; __mutationStats = { attrs: 0, text: 0, child: 0 };
        const times = [], start = performance.now(); let last = 0;
        await new Promise(resolve => { function step(t) { if (last) times.push(t - last); last = t; if (t - start >= ms) return resolve(); requestAnimationFrame(step); } requestAnimationFrame(step); });
        times.sort((a, b) => a - b);
        return { label, elapsed: performance.now() - start, frames: times.length, medianFrame: times[Math.floor(times.length * .5)], p95Frame: times[Math.floor(times.length * .95)], longFrames: times.filter(t => t > 25).length, longTasks:__longTasks.filter(t=>t.start>=start), stats: __stats, canvas: __canvasStats, mutations: __mutationStats, heap: performance.memory?.usedJSHeapSize };
      };
    });
    const menu = await page.evaluate(() => __measure('menu', 1200));
    await page.locator('.class-card').nth(1).click();
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => G && G.time > .05);
    await page.evaluate(() => { G.enemies = []; G.pets = []; G.spawnT = 999; G.qTimer = -1000; G.player.hp = G.player.maxHp = 1e8; });
    const empty = await page.evaluate(() => __measure('empty-combat', 1600));
    await page.evaluate(() => {
      G.enemies = []; G.pets = []; G.projs = []; G.eprojs = []; G.actions = []; G.fx = []; G.zones = []; G.texts = []; G.spawnT = 999; G.qTimer = -1000; G.wave = 8; G.waveT = 12;
      const p = G.player; p.hp = p.maxHp = 1e8;
      const kinds = ['slime', 'imp', 'mite', 'brute', 'spitter', 'charger'];
      // This deliberately reconstructs the same100-actor legacy stress scene
      // used before encounter quotas existed. Quotas must not turn a renderer
      // comparison into an easier scene with fewer enemies/ranged actors.
      var fixedEnemies=[];
      for (let i = 0; i < 100; i++) { G.enemies=[];const a = i * 2.3999632297, radius = 100 + Math.sqrt(i / 100) * 360, e = spawnEnemy(kinds[i % 6], i % 11 === 0); Object.assign(e, { x: p.x + Math.cos(a) * radius, y: p.y + Math.sin(a) * radius, hp: 1e8, maxHp: 1e8, speed: 20, dmg: 1, fx: -Math.cos(a), fy: -Math.sin(a) });fixedEnemies.push(e); }G.enemies=fixedEnemies;G.enemySpatialDirty=true;
      for (const kind of ['wolf', 'bear', 'boarpet', 'hydra']) spawnPet(kind, {});
      for (const pet of G.pets) pet.hp = pet.maxHp = 1e8;
      G.slots = ['fireball', 'chain', 'nova', 'orb'];
      for (const sid of G.slots) { G.stats.unlocked[sid] = true; G.stats.rank[sid] = 3; }
      G.cds = {}; for (let i = 0; i < 4; i++) castSkill(i); mouse.active = false;
    });
    const profileDense=process.env.LEGENDS_BENCH_PROFILE==='1'&&cfg.throttle>1;
    if(profileDense){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
    const dense = await page.evaluate(async () => { const result=await __measure('100-enemies-mixed-skills', 2000);result.enemyCount=G.enemies.length;result.petCount=G.pets.length;return result; });
    if(profileDense){const profile=await cdp.send('Profiler.stop');fs.writeFileSync(path.join(output,cfg.label+'-dense.cpuprofile'),JSON.stringify(profile.profile));await cdp.send('Profiler.disable');}
    await page.screenshot({ path: path.join(output, cfg.label + '-dense.png') });
    await page.evaluate(() => show('pauseOverlay'));
    const paused = await page.evaluate(() => __measure('paused-dense', 1200));
    await page.evaluate(() => { hide('pauseOverlay'); toggleTree(); });
    const tree = await page.evaluate(() => __measure('skill-tree-dense', 1200));
    await page.screenshot({ path: path.join(output, cfg.label + '-tree.png') });
    results.push({ cfg, load, menu, empty, dense, paused, tree, errors });
    await context.close();
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(output, 'benchmark.json'), JSON.stringify(results, null, 2));
for (const result of results) console.log(JSON.stringify({ cfg: result.cfg, loadMs: result.load.now, startupLongTasks: result.load.tasks.length, startupMaxLongTask: Math.max(...result.load.tasks.map(t => t.duration)), imageBytes: result.load.images.reduce((sum, image) => sum + image.size, 0), phases: ['menu', 'empty', 'dense', 'paused', 'tree'].map(key => ({ phase: key, ...result[key], stats: Object.fromEntries(Object.entries(result[key].stats).map(([name, stats]) => [name, { calls: stats.calls, ms: Math.round(stats.ms), max: Math.round(stats.max) }])) })), errors: result.errors }));
