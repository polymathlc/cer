// The Interactive textbook in a real browser: the topic list
// (interactive-textbook/index.html) and the "Water and its 3 states" lesson
// (interactive-textbook/water-states/index.html), at desktop and phone widths.
//
// The SHIPPED pages are served as they are, from a local server. Nothing leaves
// the machine: any request to another host is refused, and the check fails if
// the page tried to make one. Every hands-on widget is driven at least once,
// every quick check is answered, Let's Apply is completed, and the saved
// progress must then show as 12 / 12 on the topic list.
//
//   node tools/interactive-textbook-browser.mjs
//   PW=/path/to/playwright/index.mjs node tools/interactive-textbook-browser.mjs
//   TEXTBOOK_SCREENSHOTS=artifacts/textbook node tools/interactive-textbook-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.TEXTBOOK_PLAYWRIGHT_MODULE || process.env.PW || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const shots = process.env.TEXTBOOK_SCREENSHOTS || '';
if (shots) fs.mkdirSync(shots, { recursive: true });

// ---- the home page links to the textbook (static check; the home page itself needs Firebase) ----
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const navLinks = home.slice(home.indexOf('<div class="lp-nav-links">'), home.indexOf('</div>', home.indexOf('<div class="lp-nav-links">')));
assert.match(navLinks, /<a class="lp-page-link" href="interactive-textbook\/">Interactive textbook<\/a>/, 'home page header links to the Interactive textbook');
assert.ok(navLinks.indexOf('products/') < navLinks.indexOf('interactive-textbook/'), 'Interactive textbook sits after Products');

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((request, response) => {
  let urlPath = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(root, urlPath);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404); response.end('not found'); return;
  }
  response.writeHead(200, { 'content-type': types[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const launchOptions = {};
if (process.env.TEXTBOOK_CHROMIUM) launchOptions.executablePath = process.env.TEXTBOOK_CHROMIUM;
const browser = await chromium.launch(launchOptions);
const failures = [];

async function openPage(width, height, isMobile) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: !!isMobile, hasTouch: !!isMobile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  const outside = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    outside.push(url);
    return route.abort();
  });
  return { context, page, errors, outside };
}

async function noSideScroll(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `${label}: page scrolls sideways by ${overflow}px`);
}

try {
  // ================= Desktop: the whole lesson =================
  {
    const { context, page, errors, outside } = await openPage(1280, 900);
    await page.goto(`${origin}/interactive-textbook/`);
    await page.waitForSelector('.topic-card[data-topic="water-states"]');
    assert.equal(await page.locator('.topic-card').count(), 1, 'one topic so far');
    assert.equal((await page.locator('.topic-card .topic-title').first().textContent()).trim(), 'Water and its 3 states');
    assert.equal((await page.locator('.progress-label').first().textContent()).trim(), '0 / 12');
    await page.fill('#topicSearch', 'boiling');
    assert.equal(await page.locator('.topic-card').count(), 1, 'search finds the topic by a section word');
    await page.fill('#topicSearch', 'volcano');
    assert.equal(await page.locator('.topic-card').count(), 0, 'search hides topics that do not match');
    assert.equal(await page.locator('#emptyState').isVisible(), true);
    await page.fill('#topicSearch', '');
    if (shots) await page.screenshot({ path: `${shots}/catalogue-desktop.png`, fullPage: true });

    await page.click('.topic-card[data-topic="water-states"]');
    await page.waitForFunction(() => window.WaterLesson && window.WaterLesson.ready);
    const sections = await page.evaluate(() => window.WaterLesson.progress.sections);
    assert.deepEqual(sections, ['states', 'changes', 'melting', 'freezing', 'boiling', 'condensation', 'evaporation', 'water-cycle', 'life', 'pollution', 'apply', 'learnt']);
    assert.equal(await page.locator('.nav-chip').count(), 12);

    // Textbook wording is present word for word (spot checks across the chapter).
    const text = await page.locator('main').innerText();
    for (const sentence of [
      'Water in the solid state is known as ice.',
      'Since water vapour is a colourless gas, we cannot see it.',
      'The temperature at which ice melts is called the melting point of ice.',
      'The heat lost by water causes it to freeze at 0°C.',
      'As water is boiling, its temperature remains constant at 100°C.',
      'This process of steam changing into water when it loses heat is called condensation.',
      'However, evaporation can take place at any temperature, unlike boiling. Boiling of water takes place only at 100°C.',
      'This continuous cycle of evaporation and condensation takes place naturally on the Earth at all times. This cycle is known as the water cycle.',
      'Water is found in blood. Blood transports oxygen and digested food to all body parts.',
      'When the other living things do not have sufficient oxygen, they will die.',
      'Which arrows show changes in the states of water?',
      'At which temperature would substance X have a fixed shape and a fixed volume?',
      'Which graph correctly shows the changes in the masses of the handkerchiefs over time?',
      'Chen observed mist forming when he opened the door of the freezer.',
      'Water pollution has a negative impact on living things and the environment.'
    ]) {
      if (!text.replace(/\s+/g, ' ').includes(sentence)) failures.push(`missing textbook sentence: ${sentence}`);
    }
    assert.equal(await page.locator('.apply-question[data-apply]').count(), 5, "all five Let's Apply questions");

    // Part 1: particle explorer and sorting.
    await page.evaluate(() => window.WaterLesson.particles.set(-10));
    assert.equal((await page.locator('#particleStatePill').textContent()).trim(), 'Solid');
    assert.equal((await page.locator('#particleNameValue').textContent()).trim(), 'ice');
    await page.evaluate(() => window.WaterLesson.particles.set(110));
    assert.equal((await page.locator('#particleStatePill').textContent()).trim(), 'Gas');
    await page.evaluate(() => window.WaterLesson.particles.set(0));
    assert.equal((await page.locator('#particleStatePill').textContent()).trim(), 'Solid + liquid');
    await page.evaluate(() => {
      const placements = { freezer: 'solid', snow: 'solid', iceberg: 'solid', tap: 'liquid', rain: 'liquid', seas: 'liquid', air: 'gas', steam: 'gas' };
      window.WaterLesson.sorting.place('rain', 'gas');   // a wrong answer first: must not count
      Object.entries(placements).forEach(([id, state]) => window.WaterLesson.sorting.place(id, state));
    });
    assert.equal(await page.evaluate(() => window.WaterLesson.sorting.placed()), 8);
    assert.match(await page.locator('#sortStatus').innerText(), /All sorted/);

    // Part 2: gain and lose heat around the cycle.
    await page.click('#cycleGainButton');
    assert.equal(await page.evaluate(() => window.WaterLesson.cycle.current()), 'gas');
    assert.match(await page.locator('#cycleStatus').innerText(), /Boiling/);
    await page.click('#cycleLoseButton');
    await page.click('#cycleLoseButton');
    assert.equal(await page.evaluate(() => window.WaterLesson.cycle.current()), 'solid');
    assert.match(await page.locator('#cycleStatus').innerText(), /Freezing/);

    // Parts 3–5: the data-logger models hold their plateaus.
    const plateaus = await page.evaluate(() => {
      const melting = window.WaterLesson.runLab('melting', {}, 24, 0.1);
      const freezing = window.WaterLesson.runLab('freezing', { salt: true }, 30, 0.1);
      const freezingSlow = window.WaterLesson.runLab('freezing', { salt: false }, 30, 0.1);
      const boiling = window.WaterLesson.runLab('boiling', { flame: 2 }, 24, 0.1);
      const boilingHigh = window.WaterLesson.runLab('boiling', { flame: 3 }, 24, 0.1);
      const firstAt = (points, test) => (points.find(test) || [null])[0];
      return {
        meltingWhileIce: melting.filter((point) => point[2] > 0).every((point) => point[1] === 0),
        meltingRisesAfter: melting[melting.length - 1][1] > 5,
        freezingWhileMixing: freezing.filter((point) => point[2] > 0 && point[2] < 1).every((point) => point[1] === 0),
        freezingStartsAt30: freezing[0][1] === 30,
        saltFaster: firstAt(freezing, (point) => point[2] >= 1) !== null && (firstAt(freezingSlow, (point) => point[2] >= 1) === null || firstAt(freezing, (point) => point[2] >= 1) < firstAt(freezingSlow, (point) => point[2] >= 1)),
        boilingMax: Math.max(...boiling.map((point) => point[1])),
        boilingHolds: boiling.filter((point) => point[0] > firstAt(boiling, (p) => p[1] >= 100)).every((point) => point[1] === 100),
        highFlameSooner: firstAt(boilingHigh, (point) => point[1] >= 100) < firstAt(boiling, (point) => point[1] >= 100)
      };
    });
    assert.deepEqual(plateaus, { meltingWhileIce: true, meltingRisesAfter: true, freezingWhileMixing: true, freezingStartsAt30: true, saltFaster: true, boilingMax: 100, boilingHolds: true, highFlameSooner: true });
    for (const lab of ['meltingLab', 'freezingLab', 'boilingLab']) {
      await page.click(`#${lab} .lab-start`);
    }
    await page.evaluate(() => { ['melting', 'freezing', 'boiling'].forEach((name) => window.WaterLesson.labs[name].fastForward(12)); });
    assert.match(await page.locator('#meltingLab .lab-temp').textContent(), /^0\.0°C$/);
    assert.match(await page.locator('#boilingLab .lab-temp').textContent(), /^100\.0°C$/);
    assert.match(await page.locator('#boilingLab .lab-status').innerText(), /During boiling/);

    // Heat flow explorer.
    await page.click('#heatFlowObject [data-object="water"]');
    await page.click('#heatFlowPlace [data-place="freezer"]');
    assert.match(await page.locator('#heatFlowStatus').innerText(), /lose heat[\s\S]*freeze at 0°C/);
    await page.click('#heatFlowPlace [data-place="table"]');
    assert.match(await page.locator('#heatFlowStatus').innerText(), /same temperature/);

    // Part 6–7: can droplets, drying race.
    await page.locator('#canTempRange').fill('5');
    await page.locator('#canTempRange').dispatchEvent('input');
    assert.match(await page.locator('#canStatus').innerText(), /loses heat/);
    await page.locator('#canTempRange').fill('40');
    await page.locator('#canTempRange').dispatchEvent('input');
    assert.match(await page.locator('#canStatus').innerText(), /No water droplets form/);
    assert.equal(await page.evaluate(() => window.WaterLesson.dryingHours({ wind: 2, temperature: 1, area: 1 }) < window.WaterLesson.dryingHours({ wind: 0, temperature: 1, area: 1 })), true);
    assert.equal(await page.evaluate(() => window.WaterLesson.dryingHours({ wind: 1, temperature: 0, area: 1 }) > window.WaterLesson.dryingHours({ wind: 1, temperature: 1, area: 1 })), true);
    assert.equal(await page.evaluate(() => window.WaterLesson.dryingHours({ wind: 1, temperature: 1, area: 0 }) > window.WaterLesson.dryingHours({ wind: 1, temperature: 1, area: 1 })), true);
    assert.match(await page.locator('#dryingStatus').innerText(), /fair test of wind/);
    await page.click('.drying-setup[data-line="B"] [data-factor="area"] [data-value="0"]');
    assert.match(await page.locator('#dryingStatus').innerText(), /not a fair test/);

    // Part 8: water cycle steps and the clean-water collector.
    await page.click('#waterCycleNextButton');
    assert.match(await page.locator('#waterCycleStatus').innerText(), /condenses/);
    for (const part of ['river', 'cup', 'sheet', 'stone', 'sun']) await page.click(`#stillParts [data-part="${part}"]`);
    assert.match(await page.locator('#stillStatus').innerText(), /evaporates/);

    // Part 10: pollution.
    await page.check('[data-pollution="chemicals"]', { force: true });
    assert.equal((await page.locator('#riverSafeValue').textContent()).trim(), 'No');
    assert.match(await page.locator('#riverStatus').innerText(), /algae/);
    assert.deepEqual(await page.evaluate(() => window.WaterLesson.lakeHealth({ rubbish: true, oil: true, chemicals: true }).fishAlive), 0);

    // Every quick check: one wrong answer, then the right one.
    const checks = await page.evaluate(() => Object.entries(window.WaterLesson.quickChecks).map(([id, question]) => [id, question.answer, question.options.length]));
    for (const [id, answer, count] of checks) {
      const wrong = (answer + 1) % count;
      await page.click(`[data-quick-check="${id}"] .choice[data-index="${wrong}"]`);
      assert.equal(await page.locator(`[data-quick-check="${id}"] .feedback.is-wrong`).count(), 1, `${id}: wrong answer shows feedback`);
      await page.click(`[data-quick-check="${id}"] .choice[data-index="${answer}"]`);
      assert.equal(await page.locator(`[data-quick-check="${id}"] .feedback.is-correct`).count(), 1, `${id}: right answer shows feedback`);
    }
    await page.waitForTimeout(900);
    for (const [id] of checks) assert.equal(await page.evaluate((sectionId) => window.WaterLesson.progress.isDone(sectionId), id), true, `${id} marked done`);

    // Let's Apply: the textbook answers are 1, 1, 4, 4 and (a) Liquid.
    const applyAnswers = { 1: 0, 2: 0, 3: 3, 4: 3 };
    for (const [number, index] of Object.entries(applyAnswers)) {
      await page.click(`.apply-question[data-apply="${number}"] .choice[data-index="${index}"]`);
      assert.equal(await page.locator(`.apply-question[data-apply="${number}"] .feedback.is-correct`).count(), 1, `Q${number} accepted`);
    }
    await page.click('.apply-question[data-apply="5"] .choice[data-index="1"]');
    await page.fill('#q5Answer', 'The warmer water vapour in the air lost heat to the cold freezer air and condensed into tiny water droplets.');
    assert.equal(await page.locator('.apply-question[data-apply="5"] .keyword.is-found').count(), 6, 'all six key ideas spotted');
    await page.click('#q5CheckButton');
    await page.click('[data-self-mark="yes"]');
    assert.equal((await page.locator('#applyScoreValue').textContent()).trim(), '5 / 5');

    // Concept map: one wrong placement, one right one, then reveal the rest.
    await page.evaluate(() => { window.WaterLesson.concept.select('ice'); window.WaterLesson.concept.place('Gas'); });
    assert.equal(await page.evaluate(() => window.WaterLesson.concept.state().filled.ice), undefined, 'a wrong word is refused');
    await page.evaluate(() => { window.WaterLesson.concept.select('ice'); window.WaterLesson.concept.place('Ice'); });
    assert.equal(await page.evaluate(() => window.WaterLesson.concept.state().filled.ice), 'Ice');
    await page.evaluate(() => { window.WaterLesson.concept.select('boiling'); window.WaterLesson.concept.place('Condensation'); });
    assert.equal(await page.evaluate(() => window.WaterLesson.concept.state().filled.boiling), 'Condensation', 'process boxes accept any process word');
    await page.click('#conceptShowButton');
    assert.match(await page.locator('#conceptStatus').innerText(), /complete/);
    await page.waitForTimeout(400);
    assert.match(await page.locator('#finishTitle').innerText(), /Topic complete/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.nav-chip.is-done').length), 12);

    if (shots) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${shots}/lesson-desktop-top.png` });
      for (const id of ['particleWidget', 'cycleWidget', 'meltingLab', 'boilingLab', 'potWidget', 'dryingWidget', 'waterCycleWidget', 'riverWidget', 'conceptMapWidget']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        await page.locator(`#${id}`).screenshot({ path: `${shots}/widget-${id}.png` });
      }
      await page.locator('.apply-question[data-apply="4"]').screenshot({ path: `${shots}/apply-q4.png` });
    }

    // Progress reaches the topic list.
    await page.goto(`${origin}/interactive-textbook/`);
    await page.waitForSelector('.topic-card');
    assert.equal((await page.locator('.progress-label').first().textContent()).trim(), '12 / 12');
    assert.equal((await page.locator('.topic-cta').first().textContent()).trim(), 'Review →');

    // Printing keeps the content and hides the controls.
    await page.goto(`${origin}/interactive-textbook/water-states/`);
    await page.waitForFunction(() => window.WaterLesson && window.WaterLesson.ready);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.lesson-bar').isVisible(), false, 'print hides the sticky bar');
    assert.equal(await page.locator('#printButton').isVisible(), false, 'print hides the print button');
    if (shots) await page.pdf({ path: `${shots}/lesson-print.pdf`, format: 'A4' });
    await page.emulateMedia({ media: 'screen' });

    assert.deepEqual(errors, [], 'no script errors on desktop');
    assert.deepEqual(outside, [], 'no requests leave the machine');
    await context.close();
  }

  // ================= Phone =================
  {
    const { context, page, errors, outside } = await openPage(360, 740, true);
    await page.goto(`${origin}/interactive-textbook/`);
    await page.waitForSelector('.topic-card');
    await noSideScroll(page, 'topic list at 360px');
    if (shots) await page.screenshot({ path: `${shots}/catalogue-phone.png`, fullPage: true });
    await page.goto(`${origin}/interactive-textbook/water-states/`);
    await page.waitForFunction(() => window.WaterLesson && window.WaterLesson.ready);
    await noSideScroll(page, 'lesson at 360px');
    // Tap-to-sort works with touch.
    const firstCard = page.locator('#sortPool .sort-card').first();
    const cardId = await firstCard.getAttribute('data-card');
    const state = { freezer: 'solid', snow: 'solid', iceberg: 'solid', tap: 'liquid', rain: 'liquid', seas: 'liquid', air: 'gas', steam: 'gas' }[cardId];
    await firstCard.tap();
    await page.locator(`.sort-bin[data-state="${state}"]`).tap();
    assert.equal(await page.evaluate(() => window.WaterLesson.sorting.placed()), 1, 'tap a card, tap a box');
    if (shots) {
      await page.screenshot({ path: `${shots}/lesson-phone-top.png` });
      for (const id of ['particleWidget', 'meltingLab', 'dryingWidget']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        await page.locator(`#${id}`).screenshot({ path: `${shots}/phone-${id}.png` });
      }
    }
    await noSideScroll(page, 'lesson at 360px after scrolling');
    assert.deepEqual(errors, [], 'no script errors on a phone');
    assert.deepEqual(outside, [], 'no requests leave the machine on a phone');
    await context.close();
  }

  // ================= Reduced motion still works =================
  {
    const { context, page, errors } = await openPage(1024, 800);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${origin}/interactive-textbook/water-states/`);
    await page.waitForFunction(() => window.WaterLesson && window.WaterLesson.ready);
    assert.equal(await page.locator('.prose').first().evaluate((element) => getComputedStyle(element).opacity), '1', 'text is visible without animation');
    assert.deepEqual(errors, [], 'no script errors with reduced motion');
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Interactive textbook: topic list and Water lesson pass at desktop and phone widths.');
