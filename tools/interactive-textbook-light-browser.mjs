// Drive the shipped Light and Shadows lesson, with local assets and no remote requests.
// TEXTBOOK_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/interactive-textbook-light-browser.mjs
// TEXTBOOK_CHROMIUM=/path/to/chromium TEXTBOOK_SCREENSHOTS=artifacts/light node tools/interactive-textbook-light-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.TEXTBOOK_PLAYWRIGHT_MODULE || process.env.PW || 'playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const shots = process.env.TEXTBOOK_SCREENSHOTS || '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const sections = ['light-help', 'natural', 'man-made', 'seeing', 'shadows', 'straight-lines', 'blocking', 'shadow-size', 'sun-shadows', 'shadow-shape', 'apply', 'learnt'];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
const missing = [];
const server = http.createServer((request, response) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(request.url, 'http://local').pathname); }
  catch { response.writeHead(400); response.end('invalid path'); return; }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.resolve(root, `.${urlPath}`);
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    missing.push(urlPath);
    response.writeHead(404); response.end('not found'); return;
  }
  response.writeHead(200, { 'content-type': types[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.TEXTBOOK_CHROMIUM ? { executablePath: process.env.TEXTBOOK_CHROMIUM } : {});

async function openPage(width, height, mobile = false, extra = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, ...extra });
  const page = await context.newPage();
  const errors = [];
  const outside = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (new URL(url).origin === origin) return route.continue();
    outside.push(url);
    return route.abort();
  });
  return { context, page, errors, outside };
}

async function openLesson(page) {
  await page.goto(`${origin}/interactive-textbook/light/`);
  await page.waitForFunction(() => window.LightLesson?.ready);
}

async function noSideScroll(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `${label}: sideways overflow is ${overflow}px`);
}

async function setRange(page, id, value) {
  await page.locator(id).fill(String(value));
  await page.locator(id).dispatchEvent('input');
}

async function setToggle(page, id, on) {
  // The checkbox sits under its styled track, so press the label like a pupil would.
  if ((await page.locator(id).isChecked()) !== on) await page.locator(`label.toggle:has(${id})`).click();
  assert.equal(await page.locator(id).isChecked(), on, `${id} is ${on ? 'on' : 'off'}`);
}

async function healthyPage({ errors, outside, page }, label) {
  assert.deepEqual(errors, [], `${label}: no browser errors`);
  assert.deepEqual(outside, [], `${label}: no requests leave the machine`);
  assert.deepEqual(await page.evaluate(() => window.LightLesson.startErrors), [], `${label}: every widget started`);
}

async function doneCount(page) {
  return page.evaluate(() => window.LightLesson.progress.sections.filter((id) => window.LightLesson.progress.isDone(id)).length);
}

async function scrollThrough(page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(25);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Place every card of a sorter in its right bin, after one wrong try. */
async function sortAll(page, handle, wrongId, wrongBin) {
  return page.evaluate(({ handle, wrongId, wrongBin }) => {
    const [group, name] = handle.split('.');
    const sorter = window.LightLesson[group][name];
    const wrong = wrongId ? sorter.place(wrongId, wrongBin) : null;
    return { wrong, placed: sorter.placed(), total: sorter.total };
  }, { handle, wrongId, wrongBin });
}

try {
  // ================= Desktop: the whole lesson =================
  {
    const session = await openPage(1280, 900);
    const { context, page } = session;
    await openLesson(page);
    assert.deepEqual(await page.evaluate(() => window.LightLesson.progress.sections), sections);
    assert.equal(await page.evaluate(() => window.LightLesson.progress.key), 'polymath_textbook_light_progress');
    assert.deepEqual(await page.locator('section[data-section]').evaluateAll((nodes) => nodes.map((node) => node.dataset.section)), sections, 'all twelve parts are present');
    assert.equal(await page.locator('.nav-chip').count(), 12);
    assert.match(await page.title(), /Light and Shadows/);
    await noSideScroll(page, 'desktop lesson');
    await scrollThrough(page);

    // Textbook wording is kept word for word (spot checks across both chapters).
    const text = await page.locator('main').innerText();
    for (const sentence of [
      'Light helps us to see things. Without light, the surroundings look dark and we cannot see the things around us.',
      'The Sun, which is a star, is the main source of light on the Earth.',
      'Lightning is a flash of bright light in the sky. It usually happens during a thunderstorm.',
      'Some sources of light are made by man. Examples of these man-made sources of light are light bulbs and fireworks.',
      'Belle can see the pencil because light from the torch falls onto the pencil and is reflected into Belle\'s eyes.',
      'We can see the Moon because the light from the Sun falls onto the Moon and is reflected into our eyes.',
      'An object that does not allow any light to pass through it is called an opaque object.',
      'Shadows are dark areas formed on a surface when an opaque or a translucent object blocks light from falling onto a surface.',
      'Ali is able to see the light from the lighted candle through the holes only when the holes are lined up. This shows that light travels in straight lines.',
      'Do not look directly at a source of bright light such as the Sun. The bright light can damage your eyes.',
      'When the piece of cardboard is replaced by a frosted plastic sheet, the shadow formed on the tabletop will be less dark.',
      'As the source of light is placed further away from the object, the size of the shadow decreases.',
      'As the screen is placed further away from the object, the size of the shadow increases.',
      'By drawing light rays, we can predict that the shadow of the ball will be smaller when the ball is placed closer to the screen, and bigger when it is placed closer to the torch.',
      'Nearer to noon, our shadows are the shortest, as the Sun is directly above us.',
      'The shape of the shadow depends on the part of the object that light shines onto.',
      'Even if the tip of the cone faces the source of light, the shadow formed will be circular.'
    ]) assert.ok(text.includes(sentence), `textbook sentence present: ${sentence}`);
    assert.match(text, /pages 88 and 89|pp\. 88–89/i, 'the lesson says which textbook pages were missing from the scan');

    // The pure models encode the science the widgets show.
    const models = await page.evaluate(() => {
      const m = window.LightLesson.models;
      return {
        visibility: [m.visibility('none', 0), m.visibility('torch', 40), m.visibility('room', 999)],
        nightLight: [m.nightLight(30).good, m.nightLight(85).good, m.nightLight(5).good],
        sky: [m.sky(12, false).sunUp, m.sky(23, false).canSee, m.sky(23, true).canSee, m.sky(23, false).starsVisible],
        sea: [m.seaSeen(0).length, m.seaSeen(600)],
        firefly: [m.fireflyOn('double', 0), m.fireflyOn('double', 3)],
        room: [m.room('night', false).canSee, m.room('night', true).canSee, m.room('day', false).canSee],
        bulb: [m.bulbTest(2, 3, 'bamboo').ok, m.bulbTest(2, 3, 'paper').ok, m.bulbTest(5, 3, 'bamboo').ok],
        canSee: [m.canSee({ isSource: false, lit: false }), m.canSee({ isSource: false, lit: true }), m.canSee({ isSource: true }), m.canSee({ isSource: false, lit: true, pathClear: false })],
        scene: [m.scene('living', 'night', false, false).source, m.scene('living', 'night', true, false).source, m.scene('swing', 'day', false, false).source, m.scene('living', 'day', false, true).source],
        moon: [m.moonLit(0, true).seen, m.moonLit(0, false).seen, m.moonLit(180, true).seen],
        kinds: [m.materialKind(0), m.materialKind(45), m.materialKind(90)],
        materials: m.materials.length,
        size: [m.shadowSize(10, 90, 10), m.shadowSize(50, 50, 10), m.shadowSize(90, 10, 10)],
        holes: [m.holesAligned([0, 0, 0]), m.holesAligned([0, 24, 0]), m.lightStopsAt([0, 24, 0]), m.lightStopsAt([30, 0, 30])],
        hose: [m.hoseSeen(0), m.hoseSeen(30)],
        maze: [m.traceLaser(0, 170, 0).hit, m.traceLaser(0, 100, 0).hit, m.traceLaser(1, 260, -21).hit, m.traceLaser(2, 120, 18).hit],
        mazeImpossible: (() => {
          for (let y = 20; y <= 320; y += 4) for (let angle = -40; angle <= 40; angle += 1) if (m.traceLaser(3, y, angle).hit === 'sensor') return false;
          return true;
        })(),
        board: [m.boardBehind('wood', true), m.boardBehind('frosted', true), m.boardBehind('clear', true), m.boardBehind('clear', false)],
        table: [m.tableShadow(300, 6, 110).width < m.tableShadow(300, 28, 110).width, m.tableLightAt(300, 'cardboard', 300, 14), m.tableLightAt(300, 'frosted', 300, 14), m.tableLightAt(80, 'cardboard', 300, 14)],
        puppet: [m.puppetScale(100) > m.puppetScale(480)],
        sun: [m.sunShadow(8, 1.4), m.sunShadow(12, 1.4), m.sunShadow(16, 1.4), m.sunShadow(20, 1.4).length],
        sundial: [m.sundial(10, 'sunny').reading, m.sundial(22, 'sunny').works, m.sundial(10, 'rain').works, m.sundial(15, 'sunny').angle],
        cone: [m.coneShadow(0).shape, m.coneShadow(90).shape, m.coneShadow(180).shape, m.coneShadow(60).shape],
        hand: [m.handMatch(0), m.handMatch(90), m.handMatch(60)],
        solids: [m.solidShadowName('ball', 40), m.solidShadowName('cylinder', 0), m.solidShadowName('cylinder', 90), m.solidShadowName('cube', 90), m.solidShadowName('cone', 90), m.solidShadowName('pyramid', 0), m.solidShadowName('tblock', 0), m.solidShadowName('tblock', 90)],
        skyline: [m.skylineMatch(90), m.skylineMatch(120)],
        pieces: [m.twoPieces(20, 60).seen, m.twoPieces(60, 20).seen],
        walk: [m.walkShadow(0), m.walkShadow(3), m.walkShadow(-1.6)],
        rays: [m.rayShadowHeight(220), m.rayShadowHeight(400), m.rayShadowHeight(580)],
        hull: m.convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]]).length
      };
    });
    assert.deepEqual(models.visibility, [0, 1, 1], 'with no light nothing is seen; the torch beam lights what it falls on');
    assert.deepEqual(models.nightLight, [true, false, false], 'a dim night light lets us see and sleep; too bright or too dim does not');
    assert.deepEqual(models.sky, [true, false, true, true], 'starlight is too little to see by; lamps help at night');
    assert.equal(models.sea[0], 5);
    assert.deepEqual(models.sea[1], ['jellyfish', 'plant'], 'deep down, only the living things that give off light are seen');
    assert.deepEqual(models.firefly, [true, false]);
    assert.deepEqual(models.room, [false, true, true]);
    assert.deepEqual(models.bulb, [true, false, false], 'a bulb must be small, not too bright and long-lasting');
    assert.deepEqual(models.canSee, [false, true, true, false], 'we see an object only when light from a source falls on it and reaches our eyes');
    assert.deepEqual(models.scene, ['none', 'lamp', 'sun', 'none']);
    assert.deepEqual(models.moon, [true, false, false], 'without the Sun the Moon cannot be seen; between the Earth and the Sun its lit half faces away');
    assert.deepEqual(models.kinds, ['opaque', 'translucent', 'transparent']);
    assert.equal(models.materials, 10);
    assert.deepEqual(models.size.map((value) => Math.round(value * 10) / 10), [100, 20, 11.1], 'nearer the light, bigger the shadow');
    assert.deepEqual(models.holes, [true, false, 'B', 'C'], 'light is blocked by the first card out of line');
    assert.deepEqual(models.hose, [true, false]);
    assert.deepEqual(models.maze, ['sensor', 'block', 'sensor', 'sensor'], 'each solvable level has a straight-line answer');
    assert.equal(models.mazeImpossible, true, 'no straight beam reaches the boxed-in sensor');
    assert.deepEqual(models.board, [0, 40, 90, 0]);
    assert.deepEqual(models.table, [true, 0, 40, 100], 'the sheet nearer the lamp casts a bigger shadow; frosted plastic lets some light through');
    assert.deepEqual(models.puppet, [true], 'a puppet close to the lamp casts a bigger shadow');
    assert.equal(models.sun[0].direction, 'West', 'morning shadows point West');
    assert.equal(models.sun[2].direction, 'East', 'afternoon shadows point East');
    assert.ok(models.sun[1].length < 0.01 && models.sun[0].length > 1, 'shadows are shortest at noon');
    assert.equal(models.sun[3], null, 'no Sun, no shadow');
    assert.deepEqual(models.sundial, [10, false, false, 45], 'a sundial needs sunshine');
    assert.deepEqual(models.cone.slice(0, 3), ['circular', 'triangular', 'circular'], 'the three cone views from the textbook');
    assert.notEqual(models.cone[3], 'circular');
    assert.deepEqual(models.hand, [100, 0, 50]);
    assert.deepEqual(models.solids, ['circle', 'circle', 'rectangle', 'square', 'triangle', 'square', 'long rectangle', 'shorter rectangle']);
    assert.equal(models.skyline[0], 100);
    assert.ok(models.skyline[1] < 70, 'at the wrong angle the shadow art is a jumble');
    assert.deepEqual(models.pieces, ['square', 'circle'], 'question 2: one dark square');
    assert.deepEqual(models.walk.map((value) => Math.round(value * 10) / 10), [0, 3, 1.6]);
    assert.ok(models.rays[0] > models.rays[1] && models.rays[1] > models.rays[2], 'position B gives the biggest shadow and C the smallest');
    assert.equal(models.hull, 4, 'the convex hull drops the inside point');

    // ---------- Part 1: how light helps us ----------
    await page.click('#darkRoomMode [data-value="torch"]');
    const found = await page.evaluate(() => {
      const room = window.LightLesson.light.darkRoom;
      room.things.forEach((thing) => room.shineAt(thing.x, thing.y));
      return room.found().length;
    });
    assert.equal(found, 4, 'the torch finds every lost thing');
    assert.equal(await page.evaluate(() => window.LightLesson.light.nightLight.set(30).good), true);
    const walk = await page.evaluate(() => {
      const hazard = window.LightLesson.light.hazard;
      hazard.reset();
      ['up', 'up', 'right', 'up', 'up', 'left', 'left', 'left', 'left', 'left', 'left'].forEach((direction) => hazard.move(direction));
      return hazard.state();
    });
    assert.equal(walk.done, true, 'Belle reaches the door');
    assert.equal(walk.bumps, 0);
    assert.deepEqual(await sortAll(page, 'light.needLightSorter', 'music', 'need'), { wrong: false, placed: 0, total: 8 });
    await page.evaluate(() => [['read', 'need'], ['slippers', 'need'], ['colours', 'need'], ['puzzle', 'need'], ['music', 'dark'], ['smell', 'dark'], ['blanket', 'dark'], ['taste', 'dark']].forEach(([id, bin]) => window.LightLesson.light.needLightSorter.place(id, bin)));
    assert.equal(await page.evaluate(() => window.LightLesson.light.needLightSorter.placed()), 8);

    // ---------- Part 2: natural sources of light ----------
    assert.equal(await page.evaluate(() => window.LightLesson.light.sky.set(23, false).canSee), false);
    assert.equal(await page.evaluate(() => window.LightLesson.light.sky.set(23, true).canSee), true);
    assert.deepEqual(await page.evaluate(() => window.LightLesson.light.deepSea.set(600)), ['jellyfish', 'plant']);
    const firefly = await page.evaluate(() => {
      const game = window.LightLesson.light.firefly;
      const current = game.current();
      const wrongType = window.LightLesson.models.fireflyTypes.map((type) => type.id).find((id) => id !== current);
      return { wrong: game.answer(wrongType), right: game.answer(current), score: game.state().score };
    });
    assert.equal(firefly.wrong, false);
    assert.equal(firefly.right, true);
    assert.equal(firefly.score, 1);
    assert.equal(await page.evaluate(() => window.LightLesson.light.lightning.strike()), 1);
    await page.evaluate(() => [['sun', 'sun'], ['daylight', 'sun'], ['polaris', 'stars'], ['starfield', 'stars'], ['firefly', 'living'], ['jellyfish', 'living'], ['glowworm', 'living'], ['lightning', 'happening']].forEach(([id, bin]) => window.LightLesson.light.naturalSorter.place(id, bin)));
    assert.equal(await page.evaluate(() => window.LightLesson.light.naturalSorter.placed()), 8);

    // ---------- Part 3: man-made sources of light ----------
    assert.equal(await page.evaluate(() => window.LightLesson.light.lamp.set('night', false).canSee), false);
    assert.equal(await page.evaluate(() => window.LightLesson.light.lamp.set('night', true).canSee), true);
    assert.equal(await page.evaluate(() => { window.LightLesson.light.fireworks.launch(200, 100, 'ring'); return window.LightLesson.light.fireworks.launched(); }), 1);
    assert.equal(await page.evaluate(() => window.LightLesson.light.bulb.design(5, 3, 'paper').ok), false);
    assert.equal(await page.evaluate(() => window.LightLesson.light.bulb.design(2, 3, 'bamboo').ok), true, 'Edison\'s long-lasting bulb works');
    assert.match(await page.locator('main').innerText(), /88/, 'the missing pages are mentioned');
    await page.evaluate(() => [['sun', 'natural'], ['firefly', 'natural'], ['lightning', 'natural'], ['bulb', 'manmade'], ['fireworks', 'manmade'], ['torch', 'manmade'], ['moon', 'not'], ['mirror', 'not'], ['offbulb', 'not']].forEach(([id, bin]) => window.LightLesson.light.sourceSorter.place(id, bin)));
    assert.equal(await page.evaluate(() => window.LightLesson.light.sourceSorter.placed()), 9);

    // ---------- Part 4: how we see things ----------
    assert.equal(await page.evaluate(() => window.LightLesson.light.pencil.set(false, false)), false, 'no light, no pencil');
    assert.equal(await page.evaluate(() => window.LightLesson.light.pencil.set(true, false)), true);
    assert.equal(await page.evaluate(() => window.LightLesson.light.pencil.set(true, true)), false, 'blocking the reflected light hides the pencil');
    assert.ok((await page.evaluate(() => window.LightLesson.light.blackout.aimAt('cat'))).includes('cat'));
    assert.equal(await page.evaluate(() => window.LightLesson.light.pathOrder.pick('enters')), false);
    await page.evaluate(() => ['switch', 'falls', 'reflected', 'enters'].forEach((id) => window.LightLesson.light.pathOrder.pick(id)));
    assert.equal(await page.evaluate(() => window.LightLesson.light.pathOrder.placed()), 4);
    assert.equal(await page.evaluate(() => window.LightLesson.light.moon.set(180, false).seen), false);
    assert.equal(await page.evaluate(() => window.LightLesson.light.moon.set(0, true).seen), true);
    await page.evaluate(() => [['sun', 'gives'], ['lamp', 'gives'], ['fireworks', 'gives'], ['glowworm', 'gives'], ['moon', 'reflects'], ['sofa', 'reflects'], ['pencil', 'reflects'], ['swing', 'reflects']].forEach(([id, bin]) => window.LightLesson.light.seenSorter.place(id, bin)));
    assert.equal(await page.evaluate(() => window.LightLesson.light.seenSorter.placed()), 8);
    for (let index = 0; index < 6; index++) {
      const card = page.locator(`#mythGrid [data-card-index="${index}"]`);
      const answer = [false, false, true, false, true, false][index];
      await card.locator(`[data-pick="${answer}"]`).click();
    }
    assert.match(await page.locator('#mythStatus').innerText(), /6 of 6 answered, 6 right/);

    // ---------- Part 5: what are shadows? ----------
    for (const id of ['wood', 'cardboard', 'metal', 'cloth', 'tracing', 'frosted', 'tissue', 'wax', 'clearglass', 'clearplastic']) await page.click(`#materialGrid [data-material="${id}"]`);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.material.tested()), 10);
    assert.equal((await page.locator('#materialValue').innerText()).trim(), '85%');
    assert.match(await page.locator('#materialStatus').innerText(), /transparent/);
    await page.click('#materialGrid [data-material="tracing"]');
    assert.match(await page.locator('#materialKind').innerText(), /translucent/);
    const materialSort = await page.evaluate(() => {
      const sorter = window.LightLesson.shadow.materialSorter;
      const wrong = sorter.place('tracing', 'opaque');
      [['book', 'opaque'], ['door', 'opaque'], ['spoon', 'opaque'], ['tracing', 'translucent'], ['frosted', 'translucent'], ['shade', 'translucent'], ['window', 'transparent'], ['bottle', 'transparent'], ['water', 'transparent']].forEach(([id, bin]) => sorter.place(id, bin));
      return { wrong, placed: sorter.placed(), total: sorter.total };
    });
    assert.deepEqual(materialSort, { wrong: false, placed: 9, total: 9 });
    const projector = await page.evaluate(() => {
      const p = window.LightLesson.shadow.projector;
      return [p.set(10, false, 'chen'), p.set(10, true, 'chen'), p.set(90, true, 'chen'), p.set(50, false, 'tracing'), p.set(50, false, 'clear')];
    });
    assert.equal(projector[0].fraction, 0, 'sitting Chen does not block the beam');
    assert.ok(projector[1].fraction > projector[2].fraction && projector[2].fraction > 0, 'standing Chen blocks the light, more when near the projector');
    assert.equal(projector[1].darkness, 1);
    assert.ok(projector[3].darkness > 0.3 && projector[3].darkness < 0.8, 'tracing paper forms a lighter shadow');
    assert.ok(projector[4].darkness < 0.2, 'a clear file forms hardly any shadow');
    await page.click('#projectorBlocker [data-value="chen"]');
    await page.click('#projectorStandButton');
    assert.match(await page.locator('#projectorStatus').innerText(), /blocking the light|Nothing blocks|below the beam/);
    const wayang = await page.evaluate(() => {
      const w = window.LightLesson.shadow.wayang;
      return [w.set({ x: 100, material: 'leather', lamp: true }), w.set({ x: 480 }), w.set({ material: 'paper' }), w.set({ lamp: false })];
    });
    assert.ok(wayang[0].scale > wayang[1].scale, 'the puppet near the lamp casts the bigger shadow');
    assert.deepEqual(wayang.map((state) => state.darkness), [1, 1, 0.35, 0]);
    await page.click('#wayangWaveButton');
    for (const [index, answer] of [true, false, true, false, false, true].entries()) await page.click(`#isShadowGrid [data-card-index="${index}"] [data-pick="${answer}"]`);
    assert.match(await page.locator('#isShadowStatus').innerText(), /6 of 6 answered, 6 right/);

    // ---------- Part 6: light travels in straight lines ----------
    await setRange(page, '#laserShowMist', 0);
    assert.match(await page.locator('#laserShowStatus').innerText(), /hard to see/);
    await setToggle(page, '#laserShowSweep', true);
    await setRange(page, '#laserShowMist', 80);
    assert.match(await page.locator('#laserShowStatus').innerText(), /stays straight/);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.cards.set(18, -22, 10).aligned), false);
    assert.match(await page.locator('#cardsBadge').innerText(), /cannot see/);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.cards.set(0, 0, 0).aligned), true);
    assert.match(await page.locator('#cardsStatus').innerText(), /arranged in a straight line/);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.cards.set(0, 24, 0).stopAt), 'B');
    assert.match(await page.locator('#cardsStatus').innerText(), /When card B is moved out of place/);
    await page.click('#cardsLineButton');
    await page.waitForFunction(() => document.querySelector('#cardsBadge').classList.contains('yes'));
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.hose.set(30).seen), false);
    assert.match(await page.locator('#hoseStatus').innerText(), /cannot see the flame/);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.hose.set(0).seen), true);
    await page.click('#laserMazeLevels [data-level="1"]');
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.laserMaze.set(260, -21).hit), 'sensor');
    assert.match(await page.locator('#laserMazeStatus').innerText(), /Hit!/);
    await page.click('#laserMazeLevels [data-level="3"]');
    assert.equal(await page.locator('#laserMazeImpossible').isVisible(), true);
    await page.click('#laserMazeImpossible');
    assert.match(await page.locator('#laserMazeStatus').innerText(), /cannot be done/);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.laserMaze.solved()), 2);

    // ---------- Part 7: opaque and translucent objects; how shadows are formed ----------
    await page.click('#boardObject [data-value="frosted"]');
    assert.equal((await page.locator('#boardBehind').innerText()).trim(), '40%');
    assert.match(await page.locator('#boardStatus').innerText(), /allows only some light to pass through it/);
    await page.click('#boardObject [data-value="wood"]');
    assert.match(await page.locator('#boardCaption').innerText(), /light cannot pass through the wooden board/);
    await setToggle(page, '#boardTorch', false);
    assert.equal((await page.locator('#boardBehind').innerText()).trim(), '0%');
    await setToggle(page, '#boardTorch', true);
    const table = await page.evaluate(() => {
      const t = window.LightLesson.shadow.tableLamp;
      return [t.set('cardboard', 6, 300), t.set('cardboard', 28, 300), t.set('frosted', 14, 300), t.probe(520)];
    });
    assert.equal(table[0].under, 0);
    assert.ok(table[1].shadowWidth > table[0].shadowWidth, 'raising the cardboard towards the lamp makes the shadow bigger');
    assert.equal(table[2].under, 40);
    assert.match(await page.locator('#tableLampUnderLabel').innerText(), /less dark/);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.darkRank.pick('plastic')), false);
    await page.evaluate(() => ['cardboard', 'wax', 'tissue', 'plastic'].forEach((id) => window.LightLesson.shadow.darkRank.pick(id)));
    assert.match(await page.locator('#darkRankStatus').innerText(), /blocks light completely/);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.shadowSteps.pick('shadow')), false);
    await page.evaluate(() => ['travels', 'falls', 'blocked', 'shadow'].forEach((id) => window.LightLesson.shadow.shadowSteps.pick(id)));
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.shadowSteps.placed()), 4);

    // ---------- Part 8: the size of shadows ----------
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.treeFrames.count()), 3);
    await page.click('#benchMode [data-value="torch"]');
    await setRange(page, '#benchSlider', 0);
    assert.equal((await page.locator('#benchSize').innerText()).trim(), '20.0 cm');
    await setRange(page, '#benchSlider', 35);
    assert.match(await page.locator('#benchStatus').innerText(), /When the torch is placed closer to the ball, the size of the shadow increases\./);
    assert.match(await page.locator('#benchTrend').innerText(), /bigger/);
    await page.click('#benchRecordButton');
    await page.click('#benchMode [data-value="screen"]');
    await setRange(page, '#benchSlider', 100);
    await setRange(page, '#benchSlider', 45);
    assert.match(await page.locator('#benchStatus').innerText(), /When the screen is placed closer to the ball, the size of the shadow decreases\./);
    await page.click('#benchRecordButton');
    await page.click('#benchMode [data-value="ball"]');
    await setRange(page, '#benchSlider', 20);
    await setRange(page, '#benchSlider', 80);
    assert.match(await page.locator('#benchStatus').innerText(), /the ball is closer to the screen\. Hence, the size of the shadow decreases\./);
    assert.equal(await page.locator('#benchRecord tbody tr').count(), 2);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.sizeGraph.plot(20)), false, 'predict before plotting');
    await page.click('#sizeGraphPredict [data-shape="up"]');
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.sizeGraph.plot(20)), true);
    await page.click('#sizeGraphAllButton');
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.sizeGraph.count()), 9);
    assert.equal(await page.locator('#sizeGraphPredict [data-shape="down"].is-correct').count(), 1);
    assert.equal(await page.locator('#sizeGraphPredict [data-shape="up"].is-wrong').count(), 1);
    await page.click('#sizeGraphPredict [data-shape="down"]');
    assert.match(await page.locator('#sizeGraphStatus').innerText(), /prediction was right/);
    await page.click('#rayPredictPick [data-pos="C"]');
    await page.click('#rayPredictPick [data-pos="A"]');
    await page.click('#rayPredictPick [data-pos="B"]');
    assert.equal(await page.locator('#rayPredictSlots .prediction-slot.is-right').count(), 3);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.rayDraw.tryRay(0)), false, 'a ray through the middle of the ball is not an edge ray');
    for (let step = 0; step < 3; step++) {
      await page.evaluate(() => window.LightLesson.shadow.rayDraw.drawEdge('top'));
      await page.evaluate(() => window.LightLesson.shadow.rayDraw.drawEdge('bottom'));
    }
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.rayDraw.done()), true);
    assert.match(await page.locator('#rayDrawStatus').innerText(), /prediction was right/);
    // A real drag on the canvas draws a ray too.
    await page.click('#rayDrawResetButton');
    const rayBox = await page.locator('#rayDrawCanvas').boundingBox();
    const sx = rayBox.width / 760, sy = rayBox.height / 420;
    await page.mouse.move(rayBox.x + 72 * sx, rayBox.y + 210 * sy);
    await page.mouse.down();
    await page.mouse.move(rayBox.x + 400 * sx, rayBox.y + 180 * sy, { steps: 6 });
    await page.mouse.up();
    assert.match(await page.locator('#rayDrawStatus').innerText(), /passes the top of the ball/);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.puppetSize.answer(0, [0])), false, 'one right change is not all of them');
    assert.equal(await page.locator('#puppetSizeCards .is-missed').count(), 1);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.puppetSize.answer(0, [0, 1])), true);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.puppetSize.answer(1, [0, 1])), true);
    await page.click('#puppetSizeCards [data-problem="2"] [data-option="0"]');
    await page.click('#puppetSizeCards [data-check="2"]');
    assert.match(await page.locator('#puppetSizeStatus').innerText(), /3 of 3 solved/);

    // ---------- Part 9: our shadows through the day ----------
    await setRange(page, '#sunDayTime', 8);
    assert.equal((await page.locator('#sunDayDirection').innerText()).trim(), 'West');
    assert.match(await page.locator('#sunDayStatus').innerText(), /Early in the morning, the Sun is at its lowest position in the sky\. Therefore, our shadows look very long\./);
    await setRange(page, '#sunDayTime', 12);
    assert.equal((await page.locator('#sunDayDirection').innerText()).trim(), 'under him');
    await setRange(page, '#sunDayTime', 16);
    assert.equal((await page.locator('#sunDayDirection').innerText()).trim(), 'East');
    assert.equal(await page.locator('#sunDayTable tbody tr').count(), 3);
    await page.click('#sunDayClearButton');
    assert.equal(await page.locator('#sunDayTable tbody tr').count(), 1, 'clearing keeps only the current hour');
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.sundial.set(10, 'sunny').reading), 10);
    assert.equal((await page.locator('#sundialReading').innerText()).trim(), '10 a.m.');
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.sundial.set(22).works), false);
    await page.click('#sundialWeather [data-value="cloudy"]');
    await setRange(page, '#sundialTime', 14);
    assert.match(await page.locator('#sundialStatus').innerText(), /Thick clouds block the sunlight/);
    await page.click('[data-reveal-target="sundialAnswer"]');
    assert.equal(await page.locator('#sundialAnswer').isVisible(), true);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.sunOrder.pick('h12')), false);
    await page.evaluate(() => ['h8', 'h10', 'h12', 'h14', 'h16'].forEach((id) => window.LightLesson.shadow.sunOrder.pick(id)));
    assert.match(await page.locator('#sunOrderStatus').innerText(), /rises in the East and sets in the West/);

    // ---------- Part 10: the shape of shadows ----------
    for (const [angle, shape] of [['90', 'triangular'], ['180', 'circular'], ['0', 'circular']]) {
      await page.click(`#conePresets [data-angle="${angle}"]`);
      assert.equal((await page.locator('#coneShape').innerText()).trim(), shape);
    }
    assert.match(await page.locator('#coneStatus').innerText(), /Even if the tip of the cone faces the source of light/);
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.hand.set('bird', 80).match), 17);
    for (const shape of ['bird', 'dog', 'rabbit']) {
      await page.click(`#handShape [data-value="${shape}"]`);
      await setRange(page, '#handTurn', 0);
      assert.match(await page.locator('#handStatus').innerText(), /It works!/);
    }
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.hand.made()), 3);
    await page.click('#solidPick [data-value="cone"]');
    await setRange(page, '#solidTilt', 90);
    assert.match(await page.locator('#solidStatus').innerText(), /triangle/);
    await page.click('#solidPick [data-value="tblock"]');
    assert.match(await page.locator('#solidStatus').innerText(), /shorter rectangle/);
    assert.match(await page.locator('#solidShapes').innerText(), /triangle.*shorter rectangle/);
    const detective = await page.evaluate(() => {
      const d = window.LightLesson.shadow.detective;
      const results = [d.answer(['ball', 'can', 'cone'])];
      d.next(); results.push(d.answer(['cone']));
      d.next(); results.push(d.answer(['cube', 'pyramid']));
      d.next(); results.push(d.answer(['can', 'book']));
      return { results, solved: d.solved() };
    });
    assert.deepEqual(detective, { results: [true, false, true, true], solved: 3 });
    assert.match(await page.locator('#detectiveStatus').innerText(), /3 of 4 cases/);
    await setRange(page, '#shadowArtTurn', 90);
    assert.equal((await page.locator('#shadowArtMatch').innerText()).trim(), '100%');
    assert.match(await page.locator('#shadowArtStatus').innerText(), /city skyline/);

    // ---------- Quick checks: a wrong answer earns nothing, the right one finishes the part ----------
    const quick = await page.evaluate(() => Object.keys(window.LightLesson.quickChecks).map((id) => ({ id, answer: window.LightLesson.quickChecks[id].answer })));
    assert.deepEqual(quick.map((item) => item.id), sections.slice(0, 10), 'one quick check for each of the ten teaching parts');
    for (const { id, answer } of quick) {
      const wrong = answer === 0 ? 1 : 0;
      await page.click(`[data-quick-check="${id}"] .choice[data-index="${wrong}"]`);
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate((section) => window.LightLesson.progress.isDone(section), id), false, `${id}: a wrong choice earns no progress`);
      await page.click(`[data-quick-check="${id}"] .choice[data-index="${answer}"]`);
      await page.waitForFunction((section) => window.LightLesson.progress.isDone(section), id);
    }
    assert.equal(await doneCount(page), 10);

    // ---------- Let's Apply: all four questions, word for word ----------
    const apply = await page.evaluate(() => window.LightLesson.applyQuestions.map(({ id, answer, parts }) => ({ id, answer, parts: parts ? parts.length : 0 })));
    assert.deepEqual(apply.map((question) => question.id), ['q1', 'q2', 'q3', 'q4']);
    assert.equal(await page.locator('.apply-question[data-apply]').count(), 4);
    const applyText = await page.locator('#applyQuestions').innerText();
    for (const sentence of [
      'Jia Yi prepared a set-up below using a source of light and cardboards A, B and C to investigate a property of light.',
      'Ahmad has two wooden pieces of different shapes, A and B, as shown below.',
      'Roy wanted to investigate the shapes of shadows formed by two identical solid objects.',
      'Belle walked from position A to position C, and then to position B in a straight a line under a lamp.'
    ]) assert.ok(applyText.includes(sentence), `Let's Apply wording: ${sentence}`);
    const q1 = page.locator('.apply-question[data-apply="q1"]');
    await q1.locator('.choice[data-index="1"]').click();
    const written = q1.locator('.sub-part:has(textarea)');
    assert.equal(await written.count(), 2, 'question 1 has two written parts');
    await written.nth(0).locator('textarea').fill('The hole in A is not in a straight line with the holes in B and C and the source of light. Light travels in straight lines, so the light is blocked by cardboard A.');
    assert.equal(await written.nth(0).locator('.keyword.is-found').count(), 4, 'all four key ideas spotted in (b)');
    await written.nth(0).locator('[data-written-check]').click();
    assert.equal(await written.nth(0).locator('.model-answer.is-visible').count(), 1);
    await written.nth(0).locator('[data-self-mark="yes"]').click();
    await written.nth(1).locator('textarea').fill('Light travels in straight lines.');
    assert.equal(await written.nth(1).locator('.keyword.is-found').count(), 2);
    await written.nth(1).locator('[data-written-check]').click();
    await written.nth(1).locator('[data-self-mark="yes"]').click();
    for (const question of apply.filter((item) => !item.parts)) {
      const card = page.locator(`.apply-question[data-apply="${question.id}"]`);
      await card.locator(`.choice[data-index="${question.answer}"]`).click();
      assert.equal(await card.locator('.choice.is-correct').count(), 1, `${question.id}: the textbook answer is marked correct`);
    }
    assert.deepEqual(apply.filter((item) => !item.parts).map((item) => item.answer), [3, 1, 2], 'answers (4), (2) and (3)');
    assert.equal(await page.evaluate(() => window.LightLesson.progress.isDone('apply')), true, 'answering all four finishes Let\'s Apply');
    assert.equal((await page.locator('#applyScoreValue').innerText()).trim(), '4 / 4');

    // The models for questions 2 and 4, and the jumps for questions 1 and 3.
    assert.equal(await page.evaluate(() => window.LightLesson.shadow.twoPieces.set(20, 60).seen), 'square');
    assert.match(await page.locator('#twoPiecesStatus').innerText(), /answer \(4\)/);
    await setRange(page, '#twoPiecesB', 20);
    assert.equal(Number((await page.locator('#twoPiecesB').inputValue())), 20);
    const lengths = await page.evaluate(() => window.LightLesson.shadow.belleWalk.walkInstantly());
    const peak = lengths.indexOf(Math.max(...lengths));
    assert.ok(lengths[0] < 0.05 && Math.abs(lengths[peak] - 3) < 0.05, 'shortest at A, longest at C');
    assert.ok(Math.min(...lengths.slice(peak)) < 0.05, 'short again when she passes under the lamp');
    assert.ok(Math.abs(lengths[lengths.length - 1] - 1.6) < 0.05, 'longer again at B, but not as long as at C');
    await page.click('#belleWalkPlayButton');
    await page.waitForFunction(() => /graph \(3\)/.test(document.querySelector('#belleWalkStatus').textContent), null, { timeout: 15000 });
    await page.click('#applyJumpSolid');
    assert.match(await page.locator('#solidStatus').innerText(), /long rectangle/);
    await page.click('#applyJumpCards');
    assert.match(await page.locator('#cardsBadge').innerText(), /cannot see/);

    // More practice: it is optional and does not touch progress.
    await page.click('#extraPractice summary');
    assert.equal(await page.locator('#extraQuestions [data-extra]').count(), 10);
    const extraAnswers = await page.evaluate(() => window.LightLesson.extraQuestions ? window.LightLesson.extraQuestions.map((question) => question.answer) : null);
    if (extraAnswers) {
      for (const [index, answer] of extraAnswers.entries()) await page.click(`#extraQuestions [data-extra="${index}"] .choice[data-index="${answer}"]`);
      assert.match(await page.locator('#extraStatus').innerText(), /10 of 10 answered/);
    }

    // ---------- Concept maps: a wrong word is rejected, then both maps complete ----------
    const concept = await page.evaluate(() => {
      const { sources, shadow } = window.LightLesson.concept;
      const blank = sources.nodes.find((node) => node.blank);
      const other = shadow.nodes.find((node) => node.blank && node.text !== blank.text && !sources.nodes.some((p) => p.blank && p.text === node.text));
      sources.select(blank.id);
      const rejected = sources.place(other.text);
      sources.fillAll();
      const sourcesOnly = window.LightLesson.progress.isDone('learnt');
      shadow.fillAll();
      return { rejected, sourcesOnly, sourcesDone: sources.complete(), shadowDone: shadow.complete() };
    });
    assert.equal(concept.rejected, false, 'a word from the wrong place is rejected');
    assert.equal(concept.sourcesOnly, false, 'one concept map alone does not finish the part');
    assert.equal(concept.sourcesDone && concept.shadowDone, true);
    assert.equal(await page.evaluate(() => window.LightLesson.progress.isDone('learnt')), true);
    assert.equal(await doneCount(page), 12);
    assert.match(await page.locator('#finishText').innerText(), /finished every part of Light/);
    await healthyPage(session, 'desktop lesson');

    if (shots) {
      await page.screenshot({ path: path.join(shots, 'light-desktop.png') });
      for (const id of sections) await page.locator(`section[data-section="${id}"]`).screenshot({ path: path.join(shots, `light-${id}.png`) });
    }

    // Progress survives a reload, and the catalogue reads it.
    await page.reload();
    await page.waitForFunction(() => window.LightLesson?.ready);
    assert.equal(await doneCount(page), 12, 'completion survives reload');
    await page.goto(`${origin}/interactive-textbook/`);
    const card = page.locator('.topic-card[data-topic="light"]');
    await card.waitFor();
    assert.equal((await card.locator('.topic-title').innerText()).trim(), 'Light and Shadows');
    assert.equal((await card.locator('.progress-label').innerText()).trim(), '12 / 12', 'catalogue reads the saved progress');
    for (const word of ['translucent', 'sundial', 'wayang']) {
      await page.fill('#topicSearch', word);
      assert.equal(await page.locator('.topic-card').count(), 1, `search finds the topic by "${word}"`);
      assert.equal(await page.locator('.topic-card[data-topic="light"]').count(), 1);
    }
    await page.fill('#topicSearch', '');
    await card.click();
    await page.waitForFunction(() => window.LightLesson?.ready);
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#progressResetButton');
    await page.waitForFunction(() => window.LightLesson.progress.sections.every((id) => !window.LightLesson.progress.isDone(id)));
    await page.reload();
    await page.waitForFunction(() => window.LightLesson?.ready);
    assert.equal(await doneCount(page), 0, 'reset survives reload');
    await healthyPage(session, 'desktop after reset');
    await context.close();
  }

  // ================= Phone: touch, every part, no sideways scrolling at 360px =================
  {
    const session = await openPage(360, 740, true);
    const { context, page } = session;
    await openLesson(page);
    await noSideScroll(page, 'phone lesson');
    for (const id of sections) {
      await page.locator(`section[data-section="${id}"]`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(40);
      await noSideScroll(page, `${id} at 360px`);
    }
    // Tap-to-sort works with touch.
    await page.locator('#materialSortWidget').scrollIntoViewIfNeeded();
    await page.locator('#materialSortPool .sort-card[data-card="book"]').tap();
    await page.locator('#materialSortWidget .sort-bin[data-bin="opaque"]').tap();
    assert.equal(await page.locator('#materialSortWidget .sort-bin[data-bin="opaque"] .sort-card[data-card="book"]').count(), 1, 'tap a card, then tap a box');
    await page.locator('#materialGrid [data-material="wax"]').tap();
    assert.match(await page.locator('#materialKind').innerText(), /translucent/);
    await page.locator('#conePresets [data-angle="90"]').tap();
    assert.equal((await page.locator('#coneShape').innerText()).trim(), 'triangular');
    await page.locator('#detectivePicks [data-object-pick="ball"]').tap();
    assert.equal(await page.locator('#detectivePicks [data-object-pick="ball"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#sunDayWidget').scrollIntoViewIfNeeded();
    await noSideScroll(page, 'sun table at 360px');
    await page.locator('[data-quick-check="shadows"] .choice').first().scrollIntoViewIfNeeded();
    const shadowsAnswer = await page.evaluate(() => window.LightLesson.quickChecks.shadows.answer);
    await page.locator(`[data-quick-check="shadows"] .choice[data-index="${shadowsAnswer}"]`).tap();
    await page.waitForFunction(() => window.LightLesson.progress.isDone('shadows'));
    if (shots) {
      await page.screenshot({ path: path.join(shots, 'light-phone.png') });
      for (const id of ['natural', 'seeing', 'shadows', 'straight-lines', 'shadow-size', 'sun-shadows', 'shadow-shape', 'apply', 'learnt']) {
        await page.locator(`section[data-section="${id}"]`).screenshot({ path: path.join(shots, `light-phone-${id}.png`) });
      }
    }
    await healthyPage(session, 'phone lesson');
    await context.close();
  }

  // ================= Reduced motion: everything still works, nothing animates in the way =================
  {
    const session = await openPage(1024, 800, false, { reducedMotion: 'reduce' });
    const { context, page } = session;
    await openLesson(page);
    await page.click('#sunDayPlayButton');
    await page.waitForFunction(() => Number(document.querySelector('#sunDayTime').value) >= 18, null, { timeout: 4000 });
    assert.ok(await page.locator('#sunDayTable tbody tr').count() >= 10, 'playing the day fills the table');
    await page.click('#cardsLineButton');
    await page.waitForFunction(() => document.querySelector('#cardsBadge').classList.contains('yes'), null, { timeout: 2000 });
    await page.click('#belleWalkPlayButton');
    await page.waitForFunction(() => /graph \(3\)/.test(document.querySelector('#belleWalkStatus').textContent), null, { timeout: 3000 });
    await healthyPage(session, 'reduced motion');
    await context.close();
  }

  assert.deepEqual(missing.filter((item) => !item.endsWith('favicon.ico')), [], 'every local file the lesson asks for exists');
} finally {
  await browser.close();
  server.close();
}

console.log('Light and Shadows textbook: science models, all Chapter 4 and 5 widgets, sorters and order games, quick checks, Let\'s Apply with its models, concept maps, saved progress, catalogue, desktop, phone and reduced motion pass.');
