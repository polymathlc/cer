import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.PIRATE_RIFT_SCREENSHOTS || path.join(root, 'test-results', 'pirate-rift');
fs.mkdirSync(shots, { recursive: true });
const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(runtime) ? pathToFileURL(runtime).href : runtime);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !mime[path.extname(file)]) { res.writeHead(404).end(); return; }
  try { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', mime[path.extname(file)]); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
const errors = [], failedResources = [], layoutIssues = [];
const observe = page => {
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failedResources.push(response.status() + ' ' + response.url()); });
  page.on('requestfailed', request => { if (!request.failure()?.errorText.includes('ERR_ABORTED')) failedResources.push(request.url() + ': ' + request.failure()?.errorText); });
};
const frames = (page, count = 8) => page.evaluate(count => new Promise(resolve => {
  function tick() { if (--count <= 0) resolve(); else requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
}), count);
const shot = (page, name) => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
async function ready(page, query = 'subject=math&profile=browser-a&test=1') {
  await page.goto(origin + '/pirate-rift.html?' + query);
  await page.locator('.crew-card').last().waitFor();
  await page.evaluate(async () => { const image = new Image(); image.src = './assets/pirate-rift/crew.png'; await image.decode(); });
  assert.equal(await page.locator('.crew-card').count(), 4);
}
async function protect(page) {
  await page.evaluate(() => {
    const g = __pirateRift.game; g.rng = () => .5; g.player.invulnerable = 9999;
    g.player.xp = 0; g.player.xpNext = 1000000;
    for (const enemy of g.enemies) { enemy.stun = 9999; enemy.telegraph = null; }
  });
}
async function startCrew(page, id) {
  await page.locator('.crew-card[data-character="' + id + '"]').click();
  assert.equal(await page.locator('.crew-card[aria-pressed="true"]').getAttribute('data-character'), id);
  assert.equal(await page.locator('.selected-skill').count(), 3);
  await page.locator('#begin-button').click();
  await page.waitForFunction(id => __pirateRift.game?.characterId === id && !__pirateRift.dialog, id);
  await protect(page); await frames(page, 3);
}
async function noOverflow(page, selectors = []) {
  const results = await page.evaluate(selectors => {
    const report = [{ label: 'document', scroll: document.documentElement.scrollWidth, width: innerWidth }];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node && !node.hidden) report.push({ label: selector, scroll: node.scrollWidth, width: node.clientWidth });
    }
    return report;
  }, selectors);
  for (const result of results) assert.ok(result.scroll <= result.width + 2, result.label + ' overflows horizontally: ' + JSON.stringify(result));
}
async function controlsFit(page) {
  const boxes = await page.evaluate(() => ['#touch-pad', '[data-slot="0"]', '[data-slot="1"]', '[data-slot="2"]', '#dodge-button', '#potion-button', '#inventory-button', '#pause-button'].map(selector => {
    const node = document.querySelector(selector), rect = node.getBoundingClientRect();
    return { selector, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, vw: innerWidth, vh: innerHeight };
  }));
  for (const box of boxes) if (!(box.x >= -1 && box.y >= -1 && box.right <= box.vw + 1 && box.bottom <= box.vh + 1 && box.width >= 28 && box.height >= 28)) layoutIssues.push(box);
  const pad = boxes[0];
  for (const skill of boxes.slice(1, 6)) assert.ok(pad.right <= skill.x || skill.right <= pad.x || pad.bottom <= skill.y || skill.bottom <= pad.y, 'Movement pad overlaps ' + skill.selector);
}
async function castAtCursor(page, slot, point) {
  await page.evaluate(slot => { const g = __pirateRift.game; g.player.energy = g.player.maxEnergy; g.player.cooldowns[slot] = 0; g.player.dodgeTime = 0; }, slot);
  await page.mouse.move(point.x, point.y);
  await page.evaluate(({ point, slot }) => {
    // Capture before the real key handler, while its camera transform is current.
    window.addEventListener('keydown', () => { window.castExpected = __pirateRift.renderer.screenToWorld(point.x, point.y); }, { capture: true, once: true });
    // Read immediately after the real handler, before the next camera frame.
    window.addEventListener('keydown', () => {
      const g = __pirateRift.game;
      window.castResult = { aim: { ...g.aim }, expected: window.castExpected, cooldown: g.player.cooldowns[slot], energy: g.player.energy, max: g.player.maxEnergy };
      window.castEffect = g.effects.findLast(effect => Math.hypot(effect.x - g.aim.x, effect.y - g.aim.y) < .01);
    }, { once: true });
  }, { point, slot });
  await page.keyboard.press(slot === 1 ? 'e' : 'q');
  const result = await page.evaluate(() => window.castResult);
  assert.ok(result.cooldown > 0 && result.energy < result.max, 'Cast spends Spirit and starts cooldown');
  assert.ok(Math.hypot(result.aim.x - result.expected.x, result.aim.y - result.expected.y) < .01, 'Cast must use the cursor position at keydown');
  return result.aim;
}
async function clearRoom(page) {
  await page.evaluate(() => {
    const api = __pirateRift, g = api.game;
    g.enemies = []; g.reinforcements = []; g.player.xp = 0; g.pendingLevels = 0; g.roomRewarded = false; g.status = 'playing';
    api.updateGame(g, 1 / 60, {});
  });
  await page.locator('#next-room').waitFor();
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await desktop.newPage(); observe(page); await ready(page);
  await noOverflow(page, ['#crew-screen']); await shot(page, 'desktop-crew');
  const signatures = new Set();
  for (const id of ['luffy', 'zoro', 'whitebeard', 'shanks']) {
    await startCrew(page, id);
    signatures.add(await page.locator('[data-slot="1"] strong').textContent());
    const before = await page.evaluate(() => ({ x: __pirateRift.game.player.x, y: __pirateRift.game.player.y }));
    await page.keyboard.down('d'); await frames(page, 12); await page.keyboard.up('d');
    const after = await page.evaluate(() => ({ x: __pirateRift.game.player.x, y: __pirateRift.game.player.y }));
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 12, id + ' moves with keyboard input');
    await castAtCursor(page, 1, { x: 985, y: 420 });
    const ultimate = await castAtCursor(page, 2, { x: 875, y: 490 });
    await page.mouse.move(520, 600);
    const fixedAim = await page.evaluate(() => window.castEffect ? ({ x: window.castEffect.x, y: window.castEffect.y }) : null);
    assert.ok(fixedAim, 'Ultimate creates a visual effect at its cast point');
    assert.ok(Math.hypot(fixedAim.x - ultimate.x, fixedAim.y - ultimate.y) < .01, 'Moving the pointer does not retarget a completed cast');
    await noOverflow(page); await shot(page, 'desktop-combat-' + id);
    await page.locator('#pause-button').click();
    const paused = await page.evaluate(() => __pirateRift.game.time); await frames(page, 8);
    assert.equal(await page.evaluate(() => __pirateRift.game.time), paused, 'Pause stops simulation time');
    await page.getByRole('button', { name: 'Choose another legend', exact: true }).click();
  }
  assert.equal(signatures.size, 4, 'Each of the four crew members has a distinct signature');

  await startCrew(page, 'luffy');
  await page.mouse.move(700, 500); await page.mouse.down(); await page.keyboard.down('w');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => __pirateRift.dialog === 'pause');
  assert.deepEqual(await page.evaluate(() => [__pirateRift.keys.size, __pirateRift.held.size]), [0, 0]);
  const blurTime = await page.evaluate(() => __pirateRift.game.time); await frames(page, 6);
  assert.equal(await page.evaluate(() => __pirateRift.game.time), blurTime);
  await page.mouse.up(); await page.keyboard.up('w');
  await page.getByRole('button', { name: 'Resume expedition', exact: true }).click();
  await page.keyboard.press('j');
  assert.ok(await page.evaluate(() => __pirateRift.game.player.cooldowns[0] > 0), 'Strike key fires after resuming');
  await page.evaluate(() => { const g = __pirateRift.game; g.player.hp = 20; g.player.potions = 2; });
  await page.keyboard.press('r');
  assert.ok(await page.evaluate(() => __pirateRift.game.player.hp > 20 && __pirateRift.game.player.potions === 1), 'Healing spends one potion');

  const statsBefore = await page.evaluate(() => {
    const g = __pirateRift.game;
    g.inventory.push({ id: 'browser-blade', name: 'Grand Line Test Blade', slot: 'weapon', rarity: 'legendary', damage: .5, health: 40, crit: .08, armor: .05, speed: .05, description: '+50% damage, +40 life and +8% critical chance.' });
    return __pirateRift.getStats(g);
  });
  await page.locator('#inventory-button').click();
  assert.equal(await page.evaluate(() => __pirateRift.dialog), 'inventory');
  const inventoryTime = await page.evaluate(() => __pirateRift.game.time); await frames(page, 6);
  assert.equal(await page.evaluate(() => __pirateRift.game.time), inventoryTime);
  await page.locator('.item-row').filter({ hasText: 'Grand Line Test Blade' }).getByRole('button', { name: 'Equip', exact: true }).click();
  const statsAfter = await page.evaluate(() => __pirateRift.getStats(__pirateRift.game));
  assert.ok(statsAfter.damage > statsBefore.damage && statsAfter.maxHp === statsBefore.maxHp + 40 && statsAfter.crit > statsBefore.crit);
  assert.equal(await page.locator('.stat-row b').first().textContent(), String(statsAfter.damage), 'Equipment view shows derived damage');
  assert.equal(await page.locator('.item-row').filter({ hasText: 'Grand Line Test Blade' }).getByRole('button', { name: 'Equipped', exact: true }).isDisabled(), true);
  await noOverflow(page, ['#dialog-panel']); await shot(page, 'desktop-equipment');
  await page.getByRole('button', { name: 'Return to the fight', exact: true }).click();

  await page.evaluate(() => { const api = __pirateRift, g = api.game; g.player.xp = g.player.xpNext; api.updateGame(g, 1 / 60, {}); });
  await page.locator('.upgrade-card').first().waitFor();
  const power = await page.evaluate(() => __pirateRift.game.choices[0].key);
  assert.equal(await page.locator('.upgrade-card').count(), 3);
  await shot(page, 'desktop-upgrade');
  await page.locator('.upgrade-card').first().click();
  assert.equal(await page.evaluate(power => __pirateRift.game.upgrades[power], power), 1);
  assert.equal(await page.evaluate(() => __pirateRift.dialog), '');
  await clearRoom(page); await page.locator('#next-room').click();
  assert.equal(await page.evaluate(() => __pirateRift.game.room), 2); await protect(page);
  await clearRoom(page); await page.locator('#next-room').click(); await protect(page);
  await page.locator('#boss-status').waitFor();
  assert.equal(await page.evaluate(() => __pirateRift.game.room), 3);
  assert.ok(await page.evaluate(() => __pirateRift.game.enemies.some(enemy => enemy.boss && enemy.hp > 0)));
  await shot(page, 'desktop-boss');

  await page.evaluate(() => {
    const api = __pirateRift, g = api.game; g.player.hp = 1; g.player.invulnerable = 0; g.player.dodgeTime = 0;
    g.projectiles = [{ x: g.player.x, y: g.player.y, vx: 0, vy: 0, radius: 10, hostile: true, damage: 99999, life: 1 }];
    api.updateGame(g, 1 / 60, {});
  });
  await page.getByRole('heading', { name: 'Every legend rises again.' }).waitFor();
  assert.equal(await page.evaluate(() => __pirateRift.game.status), 'dead');
  await page.getByRole('button', { name: 'Sail again', exact: true }).click();
  assert.equal(await page.evaluate(() => __pirateRift.game.room), 1); await protect(page);
  await page.evaluate(() => {
    const api = __pirateRift, g = api.game;
    g.room = 9; g.act = 3; g.enemies = []; g.reinforcements = []; g.pendingLevels = 0; g.player.xp = 0; g.roomRewarded = false; g.status = 'playing';
    api.updateGame(g, 1 / 60, {});
  });
  await page.getByRole('heading', { name: 'A legend of the Grand Line.' }).waitFor();
  assert.equal(await page.evaluate(() => __pirateRift.game.status), 'victory'); await shot(page, 'desktop-victory');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(__pirateRift.storageKey)));
  assert.equal(saved.records.luffy.wins, 1); assert.equal(saved.records.luffy.room, 9);
  await frames(page, 5);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(__pirateRift.storageKey)).records.luffy.wins), 1, 'An ending records one victory only');
  await page.getByRole('button', { name: 'Choose another legend', exact: true }).click();
  await page.reload(); await page.locator('.crew-card').last().waitFor();
  assert.match(await page.locator('#best-record').textContent(), /encounter 9\/9.*1 victor/);
  await ready(page, 'subject=math&profile=browser-b&test=1');
  assert.match(await page.locator('#best-record').textContent(), /legend begins/);
  await ready(page, 'subject=science&profile=browser-a&test=1');
  assert.match(await page.locator('#best-record').textContent(), /legend begins/);
  await page.close(); await desktop.close();

  for (const [name, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const mobile = await context.newPage(); observe(mobile); await ready(mobile, 'subject=math&profile=mobile-' + name + '&test=1');
    await noOverflow(mobile, ['#crew-screen']); await shot(mobile, 'mobile-' + name + '-crew');
    await startCrew(mobile, 'shanks'); await controlsFit(mobile); await noOverflow(mobile);
    const pad = await mobile.locator('#touch-pad').boundingBox();
    const client = await context.newCDPSession(mobile), x = pad.x + pad.width / 2, y = pad.y + pad.height / 2;
    const startPoint = await mobile.evaluate(() => ({ x: __pirateRift.game.player.x, y: __pirateRift.game.player.y }));
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + pad.width * .3, y, id: 1 }] });
    await frames(mobile, 10);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const moved = await mobile.evaluate(() => ({ x: __pirateRift.game.player.x, y: __pirateRift.game.player.y }));
    assert.ok(Math.hypot(moved.x - startPoint.x, moved.y - startPoint.y) > 10, 'Touch joystick moves the hero in ' + name);
    assert.equal(await mobile.locator('#stick-knob').evaluate(el => el.style.transform), '');
    const strike = await mobile.locator('[data-slot="0"]').boundingBox();
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: strike.x + strike.width / 2, y: strike.y + strike.height / 2, id: 2 }] });
    assert.equal(await mobile.evaluate(() => __pirateRift.held.has('attack')), true);
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert.equal(await mobile.evaluate(() => __pirateRift.held.size), 0, 'A cancelled touch releases held attacks');
    await mobile.locator('[data-slot="1"]').tap();
    assert.ok(await mobile.evaluate(() => __pirateRift.game.player.cooldowns[1] > 0), 'Touch signature fires in ' + name);
    await mobile.locator('#dodge-button').tap();
    await frames(mobile, 3);
    assert.ok(await mobile.evaluate(() => __pirateRift.game.player.dodgeCooldown > 0), 'Touch dodge starts cooldown');
    await shot(mobile, 'mobile-' + name + '-combat');
    await mobile.locator('#pause-button').tap();
    await noOverflow(mobile, ['#dialog-panel']);
    assert.deepEqual(await mobile.evaluate(() => [__pirateRift.keys.size, __pirateRift.held.size]), [0, 0]);
    await mobile.getByRole('button', { name: 'Resume expedition', exact: true }).tap();
    await mobile.locator('#inventory-button').tap(); await noOverflow(mobile, ['#dialog-panel']);
    await mobile.getByRole('button', { name: 'Return to the fight', exact: true }).tap();
    await client.detach(); await context.close();
  }

  const blockedContext = await browser.newContext({ viewport: { width: 1000, height: 760 } });
  const blocked = await blockedContext.newPage(); observe(blocked);
  await blocked.addInitScript(() => { Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new DOMException('Storage is blocked', 'SecurityError'); }; });
  await ready(blocked, 'subject=math&profile=storage-blocked&test=1'); await startCrew(blocked, 'zoro');
  await blocked.locator('#pause-button').click();
  await blocked.getByRole('button', { name: 'Choose another legend', exact: true }).click();
  await ready(blocked, 'subject=math&profile=production');
  assert.equal(await blocked.evaluate(() => typeof window.__pirateRift), 'undefined', 'Production URL does not expose the test harness');
  await blockedContext.close();
  assert.deepEqual(errors, [], 'Game pages must have no unhandled runtime errors');
  assert.deepEqual(failedResources, [], 'Game assets must load successfully');
  assert.deepEqual(layoutIssues, [], 'Touch controls must fit the viewport and remain large enough to tap');
  console.log('Pirate Rift browser checks passed: four crew, cursor casts, movement, pause/focus, equipment stats, upgrades, rooms/boss/death/victory, saved records, account/subject isolation, blocked storage and portrait/landscape touch controls.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
