import assert from 'node:assert/strict';
import {withBrowser, preparePage} from './hades-browser-harness.mjs';

function closeTo(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 0.001, `${label}: expected ${expected}, got ${actual}`);
}

// Observe real ability calls, without bypassing pointer/keyboard input handlers.
async function startFixture(browser, url, options = {}) {
  const fixture = await preparePage(browser, {viewport: {width: 1100, height: 800}, ...options});
  const {page} = fixture;
  await page.goto(url);
  await page.waitForFunction(() => gameRuntime.ready);
  if (options.hasTouch) await page.locator('#runtime-start').tap();
  else await page.locator('#runtime-start').click();
  await page.evaluate(() => {
    player.iFrames = 1e6;
    player.magick = player.maxMagick;
    gameState.equippedBoons = [];
    gameState.pendingActions = [];
    gameState.doors = [];
    const enemy = new Enemy(-180, -220, 'shade_wretch');
    enemy.update = () => {};
    enemy.hp = 1e6;
    gameState.enemies = [enemy];
    gameRuntime.settings.reducedMotion = true;
    screenShake = 0;
    window.cursorCastCalls = [];
    const cast = player.triggerCast;
    player.triggerCast = function(...args) {
      const rect = canvas.getBoundingClientRect();
      const evidence = {
        camera: {...gameState.camera}, shake: {...gameRuntime.viewShake},
        rect: {left: rect.left, top: rect.top, width: rect.width, height: rect.height},
        width: canvas.width, height: canvas.height,
        before: this.castActive ? {...this.castActive} : null,
        magickBefore: this.magick,
      };
      const result = cast.apply(this, args);
      evidence.after = this.castActive ? {...this.castActive} : null;
      evidence.magickAfter = this.magick;
      window.cursorCastCalls.push(evidence);
      return result;
    };
  });
  return fixture;
}

async function lastCast(page) {
  return page.evaluate(() => window.cursorCastCalls.at(-1));
}

function assertPointerCast(call, pointer, label) {
  assert.equal(call.before, null, `${label}: this press summons a new circle`);
  assert.ok(call.after, `${label}: circle exists`);
  const x = (pointer.x - call.rect.left) * call.width / call.rect.width + call.camera.x - call.width / 2 - call.shake.x;
  const y = (pointer.y - call.rect.top) * call.height / call.rect.height + call.camera.y - call.height / 2 - call.shake.y;
  closeTo(call.after.x, x, `${label}: world x`);
  closeTo(call.after.y, y, `${label}: world y`);
  closeTo(call.magickBefore - call.magickAfter, 15, `${label}: one cast cost`);
}

await withBrowser(async ({browser, url}) => {
  const {page, errors} = await startFixture(browser, url);
  const firstPointer = {x: 760, y: 510};
  await page.mouse.move(firstPointer.x, firstPointer.y);
  await page.keyboard.down('q');
  const first = await lastCast(page);
  assertPointerCast(first, firstPointer, 'Q with a nearer enemy elsewhere');
  assert.equal(await page.evaluate(() => gameRuntime.aimAssist), false);
  await page.keyboard.down('q');
  assert.equal(await page.evaluate(() => window.cursorCastCalls.length), 1, 'repeated keydown does not detonate or charge again');
  await page.keyboard.up('q');
  console.log('PASS real mouse + Q casts at the cursor, preserves mouse aim and ignores key repeat');

  await page.keyboard.down('d');
  await page.waitForTimeout(180);
  await page.keyboard.up('d');
  const anchored = await page.evaluate(() => ({cast: {...player.castActive}, playerX: player.x, cameraX: gameState.camera.x}));
  closeTo(anchored.cast.x, first.after.x, 'moving player leaves world x fixed');
  closeTo(anchored.cast.y, first.after.y, 'moving player leaves world y fixed');
  assert.ok(anchored.playerX > 20 && anchored.cameraX > first.camera.x, 'real movement also moves the camera');
  await page.keyboard.press('e');
  const detonated = await lastCast(page);
  assert.equal(detonated.after, null, 'E detonates the existing cast');
  closeTo(detonated.before.x, first.after.x, 'detonation keeps the original world x');
  closeTo(detonated.before.y, first.after.y, 'detonation keeps the original world y');
  closeTo(detonated.magickBefore, detonated.magickAfter, 'detonation is free');

  await page.keyboard.press('e');
  const cameraCast = await lastCast(page);
  assertPointerCast(cameraCast, firstPointer, 'E after camera movement without moving cursor');
  assert.notEqual(cameraCast.after.x, first.after.x, 'new casts use the camera at the new press');
  console.log('PASS movement leaves an existing cast anchored; E detonates there and re-casts under the stationary cursor');

  await page.keyboard.press('q');
  const secondPointer = {x: 410, y: 490};
  await page.mouse.move(secondPointer.x, secondPointer.y);
  for (const action of ['j', 'k', 'f', 'Space']) await page.keyboard.press(action);
  await page.keyboard.press('e');
  assertPointerCast(await lastCast(page), secondPointer, 'E after pointer change and other abilities');
  assert.equal(await page.evaluate(() => gameRuntime.aimAssist), false, 'other keyboard abilities do not steal pointer intent');
  console.log('PASS moving the pointer changes the next cast and strike, special, Hex and dash preserve that aim');

  await page.evaluate(() => {
    player.castActive = null;
    player.magick = player.maxMagick;
    gameRuntime.settings.reducedMotion = false;
    screenShake = 40;
  });
  await page.waitForFunction(() => Math.hypot(gameRuntime.viewShake.x, gameRuntime.viewShake.y) > 1);
  await page.keyboard.press('q');
  const shaken = await lastCast(page);
  assert.ok(Math.hypot(shaken.shake.x, shaken.shake.y) > 0, 'press occurs during a rendered shake');
  assertPointerCast(shaken, secondPointer, 'visible floor position during screen shake');
  await page.evaluate(() => { gameRuntime.settings.reducedMotion = true; screenShake = 0; });
  await page.waitForFunction(() => gameRuntime.viewShake.x === 0 && gameRuntime.viewShake.y === 0);
  console.log('PASS screen shake is inverted when mapping the visible floor under the cursor');

  await page.evaluate(() => {
    player.castActive = null;
    player.magick = player.maxMagick;
    player.isDashing = false;
    canvas.style.cssText = 'position:fixed;left:70px;top:130px;width:800px;height:500px;';
  });
  const scaledPointer = {x: 670, y: 480};
  await page.mouse.move(scaledPointer.x, scaledPointer.y);
  await page.keyboard.press('q');
  const scaled = await lastCast(page);
  assertPointerCast(scaled, scaledPointer, 'offset, CSS-scaled canvas');
  assert.notEqual(scaled.rect.width, scaled.width, 'test exercises a different canvas backing scale');

  await page.evaluate(() => {
    player.castActive = null;
    player.magick = player.maxMagick;
    canvas.style.left = '105px';
    canvas.style.top = '160px';
    canvas.style.width = '720px';
  });
  await page.keyboard.press('e');
  assertPointerCast(await lastCast(page), scaledPointer, 'layout shift with a stationary pointer');
  await page.evaluate(() => { player.castActive = null; player.magick = player.maxMagick; });
  await page.setViewportSize({width: 1200, height: 850});
  await page.keyboard.press('q');
  const resized = await lastCast(page);
  assertPointerCast(resized, scaledPointer, 'viewport resize with a stationary pointer');
  assert.equal(resized.width, 720, 'real resize refreshes backing dimensions');
  assert.deepEqual(errors, []);
  await page.close();
  console.log('PASS casts remain accurate with offset/scaled canvas, layout changes and resize without a new mouse event');

  const keyboard = await startFixture(browser, url);
  await keyboard.page.keyboard.press('q');
  const assisted = await lastCast(keyboard.page);
  assert.equal(assisted.after.x, -180);
  assert.equal(assisted.after.y, -220);
  assert.equal(await keyboard.page.evaluate(() => gameRuntime.aimAssist), true);
  await keyboard.page.evaluate(() => { player.castActive = null; player.magick = player.maxMagick; gameState.enemies = []; });
  await keyboard.page.keyboard.down('ArrowRight');
  await keyboard.page.waitForTimeout(60);
  await keyboard.page.keyboard.up('ArrowRight');
  await keyboard.page.keyboard.press('e');
  const fallback = await keyboard.page.evaluate(() => ({cast: window.cursorCastCalls.at(-1).after, playerX: player.x, playerY: player.y}));
  closeTo(fallback.cast.x, fallback.playerX + 220, 'keyboard fallback aims in the last movement direction');
  closeTo(fallback.cast.y, fallback.playerY, 'keyboard fallback height');
  assert.deepEqual(keyboard.errors, []);
  await keyboard.page.close();
  console.log('PASS keyboard-only casting targets nearby foes and falls back to the last movement direction');

  const mobile = await startFixture(browser, url, {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  await mobile.page.locator('[data-action="cast"]').tap();
  const touch = await lastCast(mobile.page);
  assert.equal(touch.after.x, -180);
  assert.equal(touch.after.y, -220);
  assert.equal(await mobile.page.evaluate(() => gameRuntime.aimAssist), true);
  await mobile.page.locator('[data-action="cast"]').tap();
  assert.equal((await lastCast(mobile.page)).after, null);
  assert.equal(await mobile.page.evaluate(() => window.cursorCastCalls.length), 2, 'each touch tap performs exactly one action');
  assert.deepEqual(mobile.errors, []);
  await mobile.page.close();
  console.log('PASS real touch Cast retains assisted aim and a second tap detonates exactly once');
});
