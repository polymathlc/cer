// Independent observed-work checks: no production module's own counters are trusted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.GAME_SCREENSHOTS || path.join(root, 'test-results/legends-performance');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'legends-performance.test') return route.abort();
    const file = path.join(root, decodeURIComponent(url.pathname));
    return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.abort();
  });
  await page.goto('http://legends-performance.test/science-legends.html');
  await page.waitForFunction(() => LegendsModels.allReady() && ['fx-barb', 'fx-sorc', 'fx-beast', 'fx-pala', 'fx-ama', 'whirlwind'].every(s => LegendsActions.ready(s)));
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => G && G.time > .05);
  // Manual simulation remains legal. Set a test-only non-play state to exclude
  // unrelated animation-loop work while observing deterministic DOM writes.
  const stable = await page.evaluate(async () => {
    newGame('barb'); hide('menuOverlay');
    G.enemies = []; G.pets = []; G.spawnT = 999; G.qTimer = .05; G.waveT = .05;
    G.state = 'qa-manual'; mouse.active = false; G.stats.regen = 0;
    update(0); updateBars(); updateSkillCds(); updateCombatReadability(0);
    const records = [], observer = new MutationObserver(rs => records.push(...rs));
    const watched = ['healthBar', 'xpFill', 'pLevel', 'healthState', 'shieldState', 'insightState', 'qTimerN', 'battleStatus', 'evadeBtn', 'skillBar'];
    watched.forEach(id => { const node = document.getElementById(id); if (node) observer.observe(node, { subtree: true, attributes: true, childList: true, characterData: true }); });
    let queries = 0, closest = 0;
    const query = document.querySelectorAll, near = Element.prototype.closest;
    document.querySelectorAll = function (selector) { if (selector === '#skillBar .cd') queries++; return query.call(this, selector); };
    Element.prototype.closest = function (selector) { if (selector === '.skill-slot') closest++; return near.call(this, selector); };
    try { for (let i = 0; i < 80; i++) update(1 / 120); await Promise.resolve(); }
    finally { document.querySelectorAll = query; Element.prototype.closest = near; observer.disconnect(); }
    const changes = {};
    records.forEach(r => { const target = r.target.nodeType === 1 ? r.target : r.target.parentElement; const id = watched.find(id => { const n = document.getElementById(id); return n && (n === target || n.contains(target)); }) || 'other'; changes[id] = (changes[id] || 0) + 1; });
    return { changes, queries, closest, hp: G.player.hp, maxHp: G.player.maxHp };
  });
  check(stable.hp === stable.maxHp, 'R1: stable-health observation changes no real health');
  check(['healthBar', 'xpFill', 'pLevel', 'healthState', 'shieldState', 'insightState'].every(k => !stable.changes[k]), 'R1: unchanged health/XP/status fields produce no repeated DOM mutations');
  check(stable.queries === 0 && stable.closest === 0, 'R2: simulation substeps do not rediscover cooldown DOM nodes');
  check(!stable.changes.skillBar, 'R2: ready skills do not rewrite cooldown names, classes or ARIA on each substep');
  check(!stable.changes.qTimerN && !stable.changes.battleStatus && !stable.changes.evadeBtn, 'R3: an unchanged displayed second/wave/ready state emits no redundant timer/status mutations');
  const transitions = await page.evaluate(() => {
    hurtPlayer(20); const health = $('healthBar').getAttribute('aria-valuenow') === String(G.player.hp) && $('hpTxt').textContent.startsWith(String(G.player.hp));
    healPlayer(20); const healed = G.player.hp === G.player.maxHp && $('hpFill').style.transform === 'scaleX(1)';
    const sid = G.slots[0]; G.cds[sid] = 1.27; updateSkillCds(); const before = $('skillBar').querySelector('.cd-value').textContent;
    G.cds[sid] = .77; updateSkillCds(); const after = $('skillBar').querySelector('.cd-value').textContent;
    G.qTimer = 1.1; update(0); const timer = $('qTimerN').textContent;
    G.waveT = 39.1; G.player.evadeCd = .8; G.readabilityT = 0; updateCombatReadability(0);
    const status = $('battleStatus').textContent, evade = $('evadeBtn').disabled && $('evadeBtn').textContent.includes('0.8');
    G.player.evadeCd = 0; G.readabilityT = 0; updateCombatReadability(0); const ready = !$('evadeBtn').disabled;
    G.qTimer = .05; G.waveT = .05; G.cds[sid] = 0; updateSkillCds();
    return { health, healed, before, after, timer, status, evade, ready };
  });
  check(transitions.health && transitions.healed, 'R1: real damage/healing still update health text and ARIA immediately');
  check(transitions.before === '2' && transitions.after === '0.8', 'R2: a cached cooldown display follows actual changing cooldown values');
  check(transitions.timer === '19' && transitions.status.includes('Next wave in 1s') && transitions.evade && transitions.ready, 'R3: displayed timer, wave and evade transitions remain truthful');

  const target = await page.evaluate(async () => {
    G.state = 'play';
    const e = spawnEnemy('brute', true); Object.assign(e, { x: G.player.x + 60, y: G.player.y, hp: 500, maxHp: 500 });
    G.atkTarget = e; updateTargetPanel();
    const mutations = [], observer = new MutationObserver(rs => mutations.push(...rs));
    observer.observe($('targetPanel'), { subtree: true, attributes: true, childList: true, characterData: true });
    for (let i = 0; i < 30; i++) updateTargetPanel();
    await Promise.resolve(); observer.disconnect();
    e.hp = 123; e.frozen = 1; updateTargetPanel();
    const actual = $('targetHp').textContent, effects = $('targetEffects').textContent;
    const next = spawnEnemy('imp', false); G.atkTarget = next; updateTargetPanel();
    return { mutations: mutations.length, actual, effects, switched: $('targetName').textContent, visible: !$('targetPanel').hidden };
  });
  check(target.mutations === 0, 'R4: an unchanged target panel is not rebuilt on every readability tick');
  check(target.visible && target.actual.includes('123'), 'R4: actual target damage still refreshes immediately');
  check(target.effects.includes('FROZEN') && target.switched.includes('Ash Imp'), 'R4: status changes and target switches refresh immediately');

  const pick = await page.evaluate(() => {
    const actors = [{ x: 0, y: 1, r: 2, hp: 1 }, { x: 0, y: 9, r: 2, hp: 1 }, { x: 0, y: 9, r: 2, hp: 1 }, { x: 0, y: 50, r: 2, hp: 0 }];
    const realMap = Array.prototype.map, realSort = Array.prototype.sort; let maps = 0, sorts = 0;
    Array.prototype.map = function (...args) { maps++; return realMap.apply(this, args); };
    Array.prototype.sort = function (...args) { sorts++; return realSort.apply(this, args); };
    try { const hit = LegendsModels.pick(actors, 0, 0, () => ({ x: -5, y: -5, w: 10, h: 10 })); return { maps, sorts, correct: hit === actors[2] }; }
    finally { Array.prototype.map = realMap; Array.prototype.sort = realSort; }
  });
  check(pick.correct, 'R5: overlapping model selection preserves frontmost depth and original tie order');
  check(pick.maps === 0 && pick.sorts === 0, 'R5: a pointer pick avoids full-list map/sort allocation');

  const hover = await page.evaluate(() => {
    G.state = 'play'; G.enemies = []; G.pets = []; G.spawnT = 999; G.qTimer = -1000;
    Object.assign(mouse, { active: true, sx: VW / 2, sy: VH / 2, lDown: false, rDown: false });
    const actual = pickEnemyAt; let calls = 0;
    window.pickEnemyAt = function (...args) { calls++; return actual.apply(this, args); };
    try {
      for (let i = 0; i < 80; i++) update(1 / 120);
      const substepCalls = calls;
      const e = spawnEnemy('brute', false); Object.assign(e, { x: G.player.x, y: G.player.y + 100, speed: 0, hp: 500, maxHp: 500 });
      draw();
      const box = LegendsModels.enemyBounds(e, G.time, lowMotion, Math.max(40, e.r * 4), G.presentation.models);
      const point = LegendsView.worldToScreen(G.view, box.x + box.w / 2, box.y + box.h / 2), rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0, clientX: rect.left + point.x * rect.width / VW, clientY: rect.top + point.y * rect.height / VH }));
      return { substepCalls, clickCalls: calls - substepCalls, picked: G.atkTarget === e };
    } finally { window.pickEnemyAt = actual; clearCombatInput(); mouse.active = false; }
  });
  check(hover.substepCalls <= 1, 'R6: eighty simulation substeps do not recompute hover eighty times');
  check(hover.clickCalls >= 1 && hover.picked, 'R6: pointer-down still selects the actor at the new pointer position immediately');

  await page.evaluate(() => { G.state = 'play'; G.enemies = []; G.pets = []; G.spawnT = 999; G.qTimer = -1000; show('pauseOverlay'); });
  await page.waitForTimeout(100);
  const paused = await page.evaluate(async () => {
    const real = draw; let paints = 0; window.draw = function (...args) { paints++; return real.apply(this, args); };
    const before = G.time;
    try { await new Promise(r => setTimeout(r, 250)); return { paints, unchanged: G.time === before }; }
    finally { window.draw = real; }
  });
  check(paused.unchanged && paused.paints <= 1, 'R7: a frozen pause preserves simulation and does not repaint an unchanged world every RAF');
  await page.evaluate(() => { hide('pauseOverlay'); toggleTree(); });
  await page.waitForTimeout(100);
  const treePaints = await page.evaluate(async () => {
    const real = draw; let paints = 0; window.draw = function (...args) { paints++; return real.apply(this, args); };
    try { await new Promise(r => setTimeout(r, 200)); return paints; } finally { window.draw = real; }
  });
  check(treePaints <= 1, 'R7: an opaque skill tree does not repeatedly repaint its frozen battle');
  await page.evaluate(() => hide('treeOverlay'));
  const resumedAt = await page.evaluate(() => G.time);
  await page.waitForFunction(t => G.time > t, resumedAt);
  check(true, 'R7: closing the opaque overlay resumes simulation without an extra user action');

  const gradients = await page.evaluate(() => {
    G.state = 'qa-manual';
    const real = CanvasRenderingContext2D.prototype.createRadialGradient; let created = 0;
    CanvasRenderingContext2D.prototype.createRadialGradient = function (...args) { created++; return real.apply(this, args); };
    try {
      for (let i = 0; i < 20; i++) drawArenaLandmarks(G.camX, G.camY); const landmarks = created; created = 0;
      for (let i = 0; i < 20; i++) drawAtmosphere(); const atmosphere = created; created = 0;
      const width = VW, dpr = DPR; VW += 31; drawAtmosphere(); const resized = created; created = 0;
      DPR = dpr * .75; drawAtmosphere(); const changedDpr = created; VW = width; DPR = dpr; drawAtmosphere();
      return { landmarks, atmosphere, resized, changedDpr };
    }
    finally { CanvasRenderingContext2D.prototype.createRadialGradient = real; }
  });
  check(gradients.landmarks <= 2, 'R8: repeated landmark paints reuse cached static lighting rather than per-landmark gradients');
  check(gradients.atmosphere <= 1, 'R9: repeated atmosphere paints reuse the viewport gradient');
  check(gradients.resized === 1 && gradients.changedDpr === 1, 'R9: viewport size and DPR changes invalidate the cached atmosphere');

  const petCull = await page.evaluate(() => {
    G.enemies = []; G.pets = []; G.state = 'qa-manual'; spawnPet('wolf', {}); const pet = G.pets.at(-1); Object.assign(pet, { x: -10000, y: -10000, hp: 100, maxHp: 100 });
    const real = LegendsModels.drawCompanion; let draws = 0;
    LegendsModels.drawCompanion = function (...args) { if (args[1] === pet) draws++; return real.apply(this, args); };
    try { drawActors(G.camX, G.camY); return draws; } finally { LegendsModels.drawCompanion = real; }
  });
  check(petCull === 0, 'R10: a companion far beyond the view is culled before model drawing');
  check(errors.length === 0, 'performance checks leave no browser errors: ' + errors.join(', '));
  console.log(JSON.stringify({ stable, target, pick, hover, paused, treePaints, gradients, petCull }));
  console.log(`Science Legends observed performance browser: ${checks} checks passed`);
} finally { await browser.close(); }
