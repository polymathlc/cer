// Count native WebAudio construction/lifetimes rather than internal budget stats.
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
    const url = new URL(route.request().url()); if (url.hostname !== 'legends-audio.test') return route.abort();
    const file = path.join(root, decodeURIComponent(url.pathname)); return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.abort();
  });
  await page.goto('http://legends-audio.test/science-legends.html');
  await page.locator('#startBtn').click(); await page.waitForFunction(() => G && G.time > .05);
  const result = await page.evaluate(async () => {
    newGame('sorc'); hide('menuOverlay'); G.enemies = []; G.pets = []; G.spawnT = 999; G.qTimer = -1000; G.state = 'qa-manual'; muted = false;
    const ac = _ctx(); await ac.resume();
    const oscillator = ac.createOscillator, gain = ac.createGain;
    const stats = { made: 0, gains: 0, active: 0, maxActive: 0, oscillatorDisconnects: 0, gainDisconnects: 0, types: [] };
    ac.createOscillator = function (...args) {
      const node = oscillator.apply(this, args), start = node.start, disconnect = node.disconnect; let active = false, closed = false;
      stats.made++;
      function retire() { if (active) { active = false; stats.active--; } }
      node.start = function (...args) { active = true; stats.active++; stats.maxActive = Math.max(stats.maxActive, stats.active); stats.types.push(node.type); return start.apply(this, args); };
      node.disconnect = function (...args) { retire(); if (!closed) { closed = true; stats.oscillatorDisconnects++; } return disconnect.apply(this, args); };
      node.addEventListener('ended', retire);
      return node;
    };
    ac.createGain = function (...args) { const node = gain.apply(this, args), disconnect = node.disconnect; let closed = false; stats.gains++; node.disconnect = function (...args) { if (!closed) { closed = true; stats.gainDisconnects++; } return disconnect.apply(this, args); }; return node; };
    try {
      for (let i = 0; i < 100; i++) { const e = spawnEnemy('brute', false); Object.assign(e, { x: G.player.x + Math.cos(i) * 40, y: G.player.y + Math.sin(i) * 40, hp: 10000, maxHp: 10000, stun: 100 }); }
      G.stats.unlocked.nova = true; G.slots = ['nova']; G.cds = {}; G.state = 'play'; castSkill(0); G.state = 'qa-manual';
      const burst = { made: stats.made, types: stats.types.slice(), damaged: G.enemies.filter(e => e.hp < e.maxHp).length };
      for (let i = 0; i < 30; i++) sfx('skill');
      const important = [];
      for (const kind of ['correct', 'wrong', 'death', 'level']) { const before = stats.made; sfx(kind); important.push({ kind, made: stats.made - before }); }
      muted = true; const beforeMute = stats.made; for (const kind of ['hit', 'hurt', 'skill', 'correct']) sfx(kind); const mutedCreates = stats.made - beforeMute; muted = false;
      await new Promise(resolve => setTimeout(resolve, 800));
      let randomCalls = 0; const random = Math.random;
      Math.random = function () { randomCalls++; return random(); };
      try { sfx('hit'); sfx('hurt'); } finally { Math.random = random; }
      await new Promise(resolve => setTimeout(resolve, 250));
      return { burst, important, mutedCreates, randomCalls, stats: { ...stats } };
    } finally { ac.createOscillator = oscillator; ac.createGain = gain; }
  });
  check(result.burst.damaged === 100, 'the actual Frost Nova still damages all100 nearby foes');
  check(result.burst.made >= 2 && result.burst.made <= 6, `a100-hit cast schedules a small bounded impact group (${result.burst.made} voices, formerly101)`);
  check(result.burst.types.includes('square') && result.burst.types.includes('sawtooth'), 'the cast retains both its skill cue and an impact cue');
  check(result.stats.maxActive <= 12, 'even repeated skills respect the total audible voice budget');
  check(result.important.every(cue => cue.made > 0), 'correct, wrong, defeat and level cues remain available under a saturated combat budget');
  check(result.mutedCreates === 0, 'muted feedback creates no new audio nodes');
  check(result.randomCalls === 0, 'impact pitch does not consume the gameplay random stream');
  check(result.stats.active === 0 && result.stats.oscillatorDisconnects === result.stats.made && result.stats.gainDisconnects === result.stats.gains, 'ended/evicted oscillators and gains actually disconnect without lingering audible voices');
  check(errors.length === 0, 'audio saturation and cleanup leave no browser errors: ' + errors.join(', '));
  console.log(JSON.stringify(result));
  console.log(`Science Legends audio browser: ${checks} checks passed`);
} finally { await browser.close(); }
