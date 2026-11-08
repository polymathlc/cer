// Observe actual worker traffic, canonical pixels and late-publication behavior.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.GAME_SCREENSHOTS || path.join(root, 'test-results/legends-worker');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
async function setup(mode) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'legends-worker.test') return route.abort();
    if (mode === 'blocked' && url.pathname.endsWith('/science-legends-atlas-worker.js')) return route.abort();
    const file = path.join(root, decodeURIComponent(url.pathname));
    return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.abort();
  });
  await page.addInitScript(mode => {
    const stats = window.__workerStats = { made: 0, posted: 0, replies: 0, terminated: 0, errors: 0, mainExtracts: 0, mainReadbacks: 0 };
    const read = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...args) { stats.mainReadbacks++; return read.apply(this, args); };
    let atlas;
    Object.defineProperty(window, 'LegendsAtlas', { configurable: true, get: () => atlas, set: value => { atlas = value; const extract = value.extract; value.extract = function (...args) { stats.mainExtracts++; return extract.apply(this, args); }; } });
    window.__startupTasks = [];
    try { new PerformanceObserver(list => { for (const entry of list.getEntries()) __startupTasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
    if (mode === 'unsupported') { window.Worker = undefined; return; }
    if (mode === 'bitmap-reject') window.createImageBitmap = () => Promise.reject(new Error('Synthetic bitmap decode rejection'));
    if (mode === 'bitmap-throw') window.createImageBitmap = () => { throw new Error('Synthetic bitmap decode throw'); };
    if (mode === 'rgba-only') window.OffscreenCanvas = undefined;
    const ActualWorker = Worker;
    window.__heldAtlasMessages = [];
    window.Worker = class extends ActualWorker {
      constructor(...args) { super(...args); this.__ended = false; stats.made++; this.addEventListener('message', () => stats.replies++); this.addEventListener('error', () => stats.errors++); }
      postMessage(...args) { stats.posted++; if (mode === 'post-throw') throw new Error('Synthetic blocked worker transfer'); const send = () => super.postMessage(...args); if (mode === 'held' && !window.__releaseAtlasMessages) return __heldAtlasMessages.push(send); return send(); }
      terminate() { if (!this.__ended) { this.__ended = true; stats.terminated++; } return super.terminate(); }
    };
  }, mode);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('http://legends-worker.test/science-legends.html', { waitUntil: 'domcontentloaded' });
  return { context, page, errors };
}
const summaries = [];
try {
  let canonical;
  for (const mode of ['normal', 'unsupported', 'blocked', 'post-throw', 'bitmap-reject', 'bitmap-throw', 'rgba-only']) {
    const { context, page, errors } = await setup(mode);
    await page.waitForFunction(() => LegendsModels.allReady(), null, { timeout: 30000 });
    const frames = await page.evaluate(() => {
      const readyAt = performance.now(), profile = LegendsModels.snapshot(), result = [], preparationStats = { ...__workerStats };
      for (const key of ['hero', 'enemy', 'companion', 'heroRear', 'enemyRear', 'companionRear']) {
        const sheet = profile[key];
        sheet.frames.forEach((rows, column) => rows.forEach((frame, row) => {
          const pixels = frame.texture.getContext('2d').getImageData(0, 0, frame.w, frame.h).data;
          let hash = 2166136261, painted = 0;
          for (let i = 0; i < pixels.length; i++) { hash = Math.imul(hash ^ pixels[i], 16777619); if (i % 4 === 3 && pixels[i] > 64) painted++; }
          result.push({ key, column, row, w: frame.w, h: frame.h, anchor: frame.anchor, hash: hash >>> 0, painted });
        }));
      }
      return { readyAt, frames: result, stats: preparationStats, maxStartupTask: Math.max(0, ...__startupTasks.filter(t => t.start < readyAt).map(t => t.duration)) };
    });
    check(frames.frames.length === 120 && frames.frames.every(f => f.painted > 0), `${mode}: all120 critical actor frames are complete and nonempty`);
    if (mode === 'normal') {
      check(frames.stats.mainExtracts === 0 && frames.stats.replies >= 6, 'normal: heavy extraction actually executes in the worker, not a silent synchronous fallback');
      check(frames.stats.mainReadbacks === 0, 'normal: actor-atlas input pixels are read back in the worker rather than stalling the main thread');
      canonical = frames.frames;
    } else {
      if (['bitmap-reject', 'bitmap-throw', 'rgba-only'].includes(mode)) check(frames.stats.mainExtracts === 0 && frames.stats.mainReadbacks >= 6 && frames.stats.replies >= 6, `${mode}: bitmap incompatibility keeps the worker through the canonical RGBA-transfer fallback`);
      else check(frames.stats.mainExtracts >= 6, `${mode}: an unavailable worker actually runs the canonical synchronous fallback`);
      check(JSON.stringify(frames.frames) === JSON.stringify(canonical), `${mode}: fallback preserves exact source pixels, dimensions and foot anchors for all120frames`);
    }
    await page.waitForTimeout(800);
    const idle = await page.evaluate(() => ({ ...__workerStats }));
    check(idle.made === idle.terminated, `${mode}: idle or failed workers terminate after preparation (${idle.made} made/${idle.terminated} terminated)`);
    check(errors.length === 0, `${mode}: worker success/failure leaves no uncaught game errors: ${errors.join(', ')}`);
    summaries.push({ mode, readyAt: frames.readyAt, maxStartupTask: frames.maxStartupTask, preparation: frames.stats, workerLifetime: { made: idle.made, posted: idle.posted, replies: idle.replies, terminated: idle.terminated, errors: idle.errors } });
    await context.close();
  }

  const { context, page, errors } = await setup('held');
  await page.waitForFunction(() => __heldAtlasMessages.length >= 6);
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => G && G.time > .05);
  const initial = await page.evaluate(() => {
    G.enemies = []; G.pets = []; G.spawnT = 999; G.qTimer = -1000; show('pauseOverlay');
    window.__heroSource = function () {
      const image = ctx.drawImage, hero = drawHeroModel; let inside = false, source;
      window.drawHeroModel = function (...args) { inside = true; try { return hero.apply(this, args); } finally { inside = false; } };
      ctx.drawImage = function (texture, ...args) { if (inside) source = texture; return image.call(this, texture, ...args); };
      try { draw(); return source; } finally { ctx.drawImage = image; window.drawHeroModel = hero; }
    };
    window.__firstHeroSource = __heroSource();
    return { source: !!__firstHeroSource, pinnedFallback: G.presentation.models.hero === null };
  });
  check(initial.source && initial.pinnedFallback, 'held: the run begins with a real pinned fallback while worker messages wait');
  await page.evaluate(() => { __releaseAtlasMessages = true; for (const send of __heldAtlasMessages) send(); __heldAtlasMessages = []; });
  await page.waitForFunction(() => LegendsModels.allReady(), null, { timeout: 30000 });
  check(await page.evaluate(() => __heroSource() === __firstHeroSource && G.presentation.models.hero === null), 'held: late worker publication does not replace the active hero texture or run profile');
  check(await page.evaluate(() => { newGame('barb'); G.enemies = []; G.pets = []; return G.presentation.models.hero !== null && __heroSource() !== __firstHeroSource; }), 'held: a genuinely new run adopts the newly prepared model');
  check(errors.length === 0, 'held: delayed worker publication leaves no game errors');
  await context.close();
  fs.writeFileSync(path.join(output, 'worker-preparation.json'), JSON.stringify(summaries, null, 2));
  console.log(JSON.stringify(summaries));
  console.log(`Science Legends worker browser: ${checks} checks passed`);
} finally { await browser.close(); }
