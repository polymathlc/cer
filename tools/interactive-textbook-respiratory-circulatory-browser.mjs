// Drive the shipped Plant Transport, Respiratory and Circulatory Systems lesson,
// with local assets and no remote requests.
// TEXTBOOK_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/interactive-textbook-respiratory-circulatory-browser.mjs
// TEXTBOOK_CHROMIUM=/path/to/chromium TEXTBOOK_SCREENSHOTS=artifacts/systems node tools/interactive-textbook-respiratory-circulatory-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.TEXTBOOK_PLAYWRIGHT_MODULE || process.env.PW || 'playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const shots = process.env.TEXTBOOK_SCREENSHOTS || '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const sections = ['plant-why', 'plant-tubes', 'plant-removed', 'air', 'respiratory', 'air-data', 'gas-exchange', 'circulatory', 'compare', 'systems', 'apply', 'learnt'];
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
  await page.goto(`${origin}/interactive-textbook/respiratory-circulatory/`);
  await page.waitForFunction(() => window.SystemsLesson?.ready);
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
  assert.deepEqual(await page.evaluate(() => window.SystemsLesson.startErrors), [], `${label}: every widget started`);
}

async function doneCount(page) {
  return page.evaluate(() => window.SystemsLesson.progress.sections.filter((id) => window.SystemsLesson.progress.isDone(id)).length);
}

async function scrollThrough(page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(25);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

try {
  // ================= Desktop: the whole lesson =================
  {
    const session = await openPage(1280, 900);
    const { context, page } = session;
    await openLesson(page);
    assert.deepEqual(await page.evaluate(() => window.SystemsLesson.progress.sections), sections);
    assert.equal(await page.evaluate(() => window.SystemsLesson.progress.key), 'polymath_textbook_respiratory_circulatory_progress');
    assert.deepEqual(await page.locator('section[data-section]').evaluateAll((nodes) => nodes.map((node) => node.dataset.section)), sections, 'all twelve parts are present');
    assert.equal(await page.locator('.nav-chip').count(), 12);
    assert.match(await page.title(), /Plant Transport, Respiratory and Circulatory Systems/);
    await noSideScroll(page, 'desktop lesson');
    await scrollThrough(page);

    // Textbook wording is kept word for word (spot checks across both chapters).
    const text = await page.locator('main').innerText();
    for (const sentence of [
      'When parts of the plant transport system are removed, the growth of the plant is affected.',
      'Air is necessary for the survival of living things. Air is a mixture of gases.',
      'Humidity is a measure of the amount of water vapour in the air.',
      'As air passes through the nose, dust is trapped by the tiny hairs in the nose. This filtered air is also warmed and moistened.',
      'Gaseous exchange occurs when oxygen in air enters the blood in the lungs, and carbon dioxide is removed from the blood.',
      'Oxygen moves from the air sacs into the blood, while carbon dioxide moves from the blood to the air sacs.',
      'The amount of nitrogen remains the same at 78% in inhaled and exhaled air.',
      'Fish live in water and take in oxygen that is dissolved in the water.',
      'The heart pumps all the time - even when we are sleeping!',
      'The first stethoscope was invented by a doctor, René Théophile Hyacinthe Laënnec, in 1816.',
      'However, plants transport these substances in separate food-carrying and water-carrying tubes.',
      'Different systems, such as the circulatory, respiratory and digestive systems, work together to help us carry out daily activities.'
    ]) assert.ok(text.includes(sentence), `textbook sentence present: ${sentence}`);

    // The pure models encode the science the widgets show.
    const models = await page.evaluate(() => {
      const m = window.SystemsLesson.models;
      return {
        supplyWorking: m.supply(true, 5),
        supplyBroken: m.supply(false, 3),
        dye: [m.dyeHeight(0), m.dyeHeight(60), m.dyeHeight(600), m.dyeCircles(120, 5), m.dyeCircles(30, 15)],
        water: [m.waterAbsorbed(0, 'balsam', 'shade'), m.waterAbsorbed(4, 'balsam', 'shade'), m.waterAbsorbed(8, 'balsam', 'shade')],
        ring: m.ringModel('ring', 8),
        deep: m.ringModel('deep', 6),
        fruit: [m.fruitSize(true, 10), m.fruitSize(false, 10)],
        silicaGel: m.silica(10, true),
        silicaNone: m.silica(10, false),
        airway: [m.airwayFlow(0, 0).flow, m.airwayFlow(6, 6).flow, m.airwayFlow(10, 10).flow],
        stoma: [m.stomaRate(0, false), m.stomaRate(3, false), m.stomaRate(10, false), m.stomaRate(10, true)],
        gill: [m.gillExchange(8, 'rest'), m.gillExchange(1, 'rest'), m.gillExchange(8, 'swim')],
        gillColours: [m.gillColour(0), m.gillColour(48)],
        blood: [m.bloodOxygen(0), m.bloodOxygen(1), m.bloodOxygen(5)],
        heartRate: [m.heartRate(20, 15), m.heartRate(40, 30), m.heartRate(75, 60), m.heartRateFromTimes([0, 0.8, 1.6, 2.4, 3.2])],
        run: [m.runStep(72, 18, true), m.runStep(150, 40, false)],
        vessel: [m.vesselFlow('balanced', 40).flow, m.vesselFlow('fatty', 40).flow, m.vesselFlow('fatty', 0).flow],
        wind: [m.windLift(0), m.windLift(30)]
      };
    });
    assert.ok(Object.values(models.supplyWorking).every((value) => value === 100), 'a working transport system supplies every part');
    assert.equal(models.supplyBroken.roots > models.supplyBroken.leaves, true, 'without transport, leaves (no water) suffer faster than roots (no food)');
    assert.deepEqual(models.dye, [0, 5, 20, 9, 0], 'coloured water rises 5 cm an hour up to the 20 cm stalk; slices above it show no colour');
    assert.ok(models.water[0] < models.water[1] && models.water[1] < models.water[2], 'more leaves, more water absorbed');
    assert.equal(models.ring.foodBelow, false, 'a ring of bark stops food passing down');
    assert.equal(models.ring.waterAbove, true, 'a ring of bark lets water pass up');
    assert.equal(models.ring.swell, 1, 'the stem above the ring swells');
    assert.equal(models.deep.waterAbove, false, 'a deep cut also removes the water-carrying tubes');
    assert.equal(models.deep.alive, false, 'with both tubes removed, the plant dies');
    assert.ok(models.fruit[0] > models.fruit[1], 'the ringed nectarine branch grows bigger fruit');
    assert.equal(models.silicaGel.biscuits, 'Crunchy', 'silica gel keeps biscuits crunchy');
    assert.equal(models.silicaNone.mould, true, 'without silica gel mould can grow');
    assert.ok(models.silicaGel.vapour < models.silicaNone.vapour, 'silica gel removes water vapour');
    assert.equal(models.airway[0], 100);
    assert.ok(models.airway[1] < 50 && models.airway[2] < models.airway[1], 'swelling and mucus narrow the airway');
    assert.equal(models.stoma[0], 0, 'a closed opening passes no gas');
    assert.ok(models.stoma[1] < models.stoma[2] && models.stoma[2] < models.stoma[3], 'a larger opening, and making food, means faster exchange');
    assert.equal(models.gill[0].enough, true);
    assert.equal(models.gill[1].enough, false, 'very little dissolved oxygen is not enough');
    assert.ok(models.gill[2].oxygenIn > models.gill[0].oxygenIn, 'a fast-swimming fish takes in more oxygen');
    assert.notEqual(models.gillColours[0], models.gillColours[1], 'gills darken over time');
    assert.deepEqual(models.blood, [70, 84, 98], 'blood leaving the lungs ends at 98% oxygen, as on the fitness tracker');
    assert.deepEqual(models.heartRate, [80, 80, 75, 75], 'heart rate is beats counted per minute');
    assert.ok(models.run[0].heart > 72 && models.run[0].breath > 18, 'running raises the heart and breathing rates');
    assert.ok(models.run[1].heart < 150 && models.run[1].breath < 40, 'resting brings them down again');
    assert.ok(models.vessel[0] > 85 && models.vessel[1] < 20 && models.vessel[2] === 100, 'fatty deposits narrow blood vessels');
    assert.deepEqual(models.wind, [0, 1]);

    // ---------- Part 1: why plants need a transport system ----------
    for (const part of ['roots', 'stem', 'leaves', 'flower', 'fruit']) await page.locator(`#needsSvg [data-part="${part}"]`).dispatchEvent('click');
    assert.match(await page.locator('#needsCount').innerText(), /5 of 5/);
    const sourceSorter = await page.evaluate(() => {
      const sorter = window.SystemsLesson.plant.sourceSorter;
      const wrong = sorter.place('water', 'leaves');
      ['water', 'salts', 'soil', 'up'].forEach((id) => sorter.place(id, 'roots'));
      ['food', 'light', 'down'].forEach((id) => sorter.place(id, 'leaves'));
      return { wrong, placed: sorter.placed(), total: sorter.total };
    });
    assert.equal(sourceSorter.wrong, false, 'water is not made in the leaves');
    assert.equal(sourceSorter.placed, sourceSorter.total);

    // ---------- Part 2: the tubes ----------
    const celery = await page.evaluate(() => { const c = window.SystemsLesson.plant.celery; for (let i = 0; i < c.total; i++) c.pick(i); return [c.found(), c.total]; });
    assert.deepEqual(celery, [10, 10]);
    await page.evaluate(() => { const t = window.SystemsLesson.plant.timeline; ['malpighi', 'hales', 'sachs'].forEach((id) => t.pick(id)); });
    assert.match(await page.locator('#timelineStatus').innerText(), /1675.*1727.*1875/);
    const lab = await page.evaluate(() => {
      const l = window.SystemsLesson.plant.lab;
      return [l.runInstant(2, 'balsam', 'shade'), l.runInstant(6, 'balsam', 'shade'), l.results().length];
    });
    assert.ok(lab[1] > lab[0] && lab[2] === 2, 'the virtual lab records more water absorbed with more leaves');
    assert.ok(await page.locator('#labTable tbody tr').count() >= 2, 'the lab table shows the results');

    // ---------- Part 3: removing parts of the transport system ----------
    await page.click('#ringCut [data-value="ring"]');
    await setRange(page, '#ringWeeks', 8);
    assert.match(await page.locator('#ringStatus').innerText(), /swell|swollen/i);
    await page.click('#ringCut [data-value="deep"]');
    assert.match(await page.locator('#ringStatus').innerText(), /die|wilt|water/i);

    // ---------- Part 4: air ----------
    await setRange(page, '#windSpeed', 25);
    assert.match(await page.locator('#windStatus').innerText(), /lifted|wind/i);
    await setToggle(page, '#windShowAir', true);
    assert.match(await page.locator('#windStatus').innerText(), /nitrogen/i);
    for (const part of ['temperature', 'rain', 'wind', 'humidity']) await page.click(`#forecastSvg [data-part="${part}"]`);
    assert.match(await page.locator('#forecastStatus').innerText(), /water vapour/i);
    await setRange(page, '#humiditySlider', 95);
    assert.equal((await page.locator('#humidityValue').innerText()).trim(), '95%');
    await page.click('#forecastQuiz [data-answer="wind"]');
    assert.equal(await page.evaluate(() => !!window.SystemsLesson.human.forecastAnswered), false);
    await page.click('#forecastQuiz [data-answer="humidity"]');
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.forecastAnswered), true);
    for (const gas of ['nitrogen', 'oxygen', 'co2', 'vapour']) {
      await page.click(`#airGasButtons [data-gas="${gas}"]`);
      assert.equal(await page.locator(`#airGasButtons [data-gas="${gas}"]`).getAttribute('aria-pressed'), 'true');
    }
    assert.match(await page.locator('#airJarStatus').innerText(), /mixture of gases/);
    const gasUse = await page.evaluate(() => {
      const s = window.SystemsLesson.human.gasUseSorter;
      const wrong = s.place('food', 'uses-oxygen');
      const either = s.place('warm', 'uses-vapour');
      [['survive', 'uses-oxygen'], ['breatheIn', 'uses-oxygen'], ['blood', 'uses-oxygen'], ['food', 'uses-co2'], ['bacteria', 'uses-nitrogen'], ['most', 'uses-nitrogen'], ['humidity', 'uses-vapour'], ['silica', 'uses-vapour']].forEach(([id, bin]) => s.place(id, bin));
      return { wrong, either, placed: s.placed(), total: s.total };
    });
    assert.equal(gasUse.wrong, false);
    assert.equal(gasUse.either, true, 'trapping heat is done by carbon dioxide and by water vapour');
    assert.equal(gasUse.placed, gasUse.total);
    await setToggle(page, '#silicaToggle', false);
    await setRange(page, '#silicaDays', 10);
    assert.match(await page.locator('#silicaBiscuits').innerText(), /Soggy|Soft/);
    await setToggle(page, '#silicaToggle', true);
    assert.equal((await page.locator('#silicaBiscuits').innerText()).trim(), 'Crunchy');
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.silicaCompared), true);
    await page.click('#silicaHomeButtons [data-home="no"] >> nth=0');
    assert.match(await page.locator('#silicaHomeNote').innerText(), /✗/);
    for (let index = 0; index < 4; index++) await page.click(`#silicaHomeButtons [data-home="yes"] >> nth=${index}`);
    assert.equal((await page.locator('#silicaHomeCount').innerText()).trim(), '4 found');

    // ---------- Part 5: the respiratory system ----------
    for (const part of ['nose', 'windpipe', 'lungs']) {
      await page.click(`#respSvg [data-part="${part}"] path >> nth=0`);
      assert.equal(await page.locator(`#respCards [data-part="${part}"]`).getAttribute('class').then((value) => value.includes('is-active')), true, `${part} links to its label`);
    }
    await page.click('#respCards [data-part="nose"]');
    assert.match(await page.locator('#respStatus').innerText(), /tiny hairs/);
    await page.click('#respMode [data-value="quiz"]');
    for (let step = 0; step < 3; step++) {
      const target = await page.evaluate(() => window.SystemsLesson.human.respSystem.quizTarget());
      const wrong = ['nose', 'windpipe', 'lungs'].find((part) => part !== target);
      assert.equal(await page.evaluate((part) => window.SystemsLesson.human.respSystem.quizAnswer(part), wrong), false, 'naming the wrong part is rejected');
      await page.click(`#respSvg [data-part="${target}"] path >> nth=0`);
    }
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.respQuizDone), true);
    const breathTemps = [];
    for (let step = 0; step < 5; step++) {
      await page.click('#breathNextButton');
      breathTemps.push(await page.locator('#breathTemp').innerText());
    }
    assert.equal(new Set(breathTemps).size, 5, 'each step of a breath shows the air changing');
    assert.match(await page.locator('#breathSteps li.is-current').innerText(), /exhaled air/);
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.breathDone), true);
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.airSac.breatheOut()), false, 'you cannot breathe out an empty air sac');
    await page.locator('#airSacWidget').scrollIntoViewIfNeeded();
    for (let breath = 0; breath < 2; breath++) {
      await page.click('#airSacBreatheIn');
      await page.waitForTimeout(150);
      await page.click('#airSacBreatheOut');
    }
    const airSac = await page.evaluate(() => window.SystemsLesson.human.airSac.state());
    assert.deepEqual([airSac.exchanges, airSac.oxygenIn, airSac.co2Out], [2, 6, 4], 'two breaths, two exchanges');
    assert.equal((await page.locator('#airSacBloodValue').innerText()).trim(), '98%');
    const journeyWrong = await page.evaluate(() => window.SystemsLesson.human.journeyOrder.pick('windpipe'));
    assert.equal(journeyWrong, false, 'air does not enter the windpipe first');
    await page.evaluate(() => ['nose', 'hairs', 'windpipe', 'sacs', 'blood'].forEach((id) => window.SystemsLesson.human.journeyOrder.pick(id)));
    assert.match(await page.locator('#journeyStatus').innerText(), /Nose → windpipe → lungs/);

    // ---------- Part 6: pie charts ----------
    assert.equal(await page.locator('#pieInhaled .pie-slice').count(), 4);
    assert.equal(await page.locator('#pieExhaled .pie-slice').count(), 4);
    await page.click('#pieInhaled .pie-slice[data-gas="oxygen"]');
    assert.match(await page.locator('#pieStatus').innerText(), /21%.*16%/);
    for (const gas of ['nitrogen', 'co2', 'other']) await page.click(`#pieGasButtons [data-gas="${gas}"]`);
    await page.click('#pieView [data-value="bar"]');
    assert.equal(await page.locator('#pieViewBar').isVisible(), true);
    assert.equal(await page.locator('#pieViewPie').isVisible(), false);
    await page.click('#pieView [data-value="table"]');
    assert.match(await page.locator('#pieTableBody').innerText(), /0\.04%/);
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.pieDone), true);
    const statements = await page.evaluate(() => window.SystemsLesson.human.pieTrue.statements.map(({ id, answer }) => ({ id, answer })));
    for (const { id, answer } of statements) {
      await page.click(`#pieTrueGrid [data-statement="${id}"] button[data-answer="${String(!answer)}"]`);
      await page.click(`#pieTrueGrid [data-statement="${id}"] button[data-answer="${String(answer)}"]`);
    }
    assert.match(await page.locator('#pieTrueStatus').innerText(), /All 6/);
    await setRange(page, '#asthmaSwell', 8);
    await setRange(page, '#asthmaMucus', 8);
    const narrowed = await page.evaluate(() => window.SystemsLesson.human.asthma.flow());
    assert.ok(narrowed < 20, 'an asthma attack narrows the airway');
    await page.click('#asthmaPanicButton');
    assert.match(await page.locator('#asthmaStatus').innerText(), /Panic and stress can worsen/);
    await page.click('#asthmaCalmButton');
    await page.evaluate(() => window.SystemsLesson.human.asthma.inhaler());
    await page.waitForFunction(() => window.SystemsLesson.human.asthma.flow() > 80, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.asthmaRescued), true);

    // ---------- Part 7: plants and fish ----------
    await setRange(page, '#stomaSize', 0);
    assert.equal((await page.locator('#stomaRate').innerText()).trim(), '0');
    await setRange(page, '#stomaSize', 10);
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.stomaCompared), true);
    await setToggle(page, '#stomaFoodToggle', true);
    assert.match(await page.locator('#stomaNet').innerText(), /CO₂ in/);
    await setRange(page, '#gillOxygen', 1);
    assert.match(await page.locator('#gillStatus').innerText(), /too little/);
    await setRange(page, '#gillOxygen', 9);
    await page.click('#gillActivity [data-value="swim"]');
    assert.match(await page.locator('#gillStatus').innerText(), /more water over its gills/);
    const exchange = await page.evaluate(() => {
      const s = window.SystemsLesson.human.exchangeSorter;
      const wrong = s.place('gills', 'human');
      [['openings', 'plant'], ['makeFood', 'plant'], ['vapour', 'plant'], ['dissolved', 'fish'], ['mouth', 'fish'], ['gills', 'fish'], ['nose', 'human'], ['airSacs', 'human'], ['hairs', 'human']].forEach(([id, bin]) => s.place(id, bin));
      return { wrong, placed: s.placed(), total: s.total };
    });
    assert.equal(exchange.wrong, false);
    assert.equal(exchange.placed, exchange.total);
    const fish = await page.evaluate(() => window.SystemsLesson.human.fishMarket.freshestIndex);
    const stale = fish === 0 ? 1 : 0;
    await page.click(`#fishGrid [data-fish="${stale}"]`);
    await page.click(`#fishGrid [data-fish="${stale}"]`);
    assert.match(await page.locator('#fishMarketStatus').innerText(), /darker/);
    await page.click(`#fishGrid [data-fish="${fish}"]`);
    await page.click(`#fishGrid [data-fish="${fish}"]`);
    assert.match(await page.locator('#fishMarketStatus').innerText(), /freshest/);

    // ---------- Part 8: the circulatory system ----------
    await page.click('#circSvg [data-part="heart"]');
    assert.match(await page.locator('#circStatus').innerText(), /pumps blood/);
    await page.click('#circCards [data-part="vessels"]');
    assert.match(await page.locator('#circStatus').innerText(), /rail tracks/);
    for (const destination of ['brain', 'arm', 'stomach', 'toes']) {
      await page.evaluate((name) => window.SystemsLesson.human.circ.send(name, { instant: true }), destination);
      await page.waitForFunction(() => !window.SystemsLesson.human.circ.busy());
    }
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.circ.delivered()), 4);
    assert.match(await page.locator('#circStatus').innerText(), /reached every part/);
    for (let tap = 0; tap < 10; tap++) await page.click('#heartButton');
    assert.equal((await page.locator('#pumpBeats').innerText()).trim(), '10');
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.pump.tapAt([0, 0.8, 1.6, 2.4, 3.2, 4.0])), 75, 'a tap every 0.8 s is 75 beats per minute');
    await page.click('#pulseDuration [data-value="15"]');
    await page.fill('#pulseCount', '20');
    await page.click('#pulseWorkButton');
    assert.match(await page.locator('#pulseStatus').innerText(), /80 beats per minute/);
    assert.equal(await page.locator('#pulseTable tbody tr').count(), 1);
    await page.fill('#pulseCount', '0');
    await page.click('#pulseWorkButton');
    assert.equal(await page.locator('#pulseTable tbody tr').count(), 1, 'an impossible count is not recorded');
    await page.click('#pulsePlace [data-value="neck"]');
    assert.match(await page.locator('#pulsePlaceSvg').innerHTML(), /side of the neck/);
    for (const tool of ['ear', 'wood', 'modern']) await page.click(`#stethoTool [data-value="${tool}"]`);
    await page.click('#stethoSpot [data-value="lung"]');
    assert.match(await page.locator('#stethoStatus').innerText(), /modern stethoscope/);
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.stethoDone), true);

    // ---------- Part 9: plants and humans compared ----------
    for (const substance of ['water', 'food', 'oxygen', 'co2']) await page.click(`#tubeVesselButtons [data-substance="${substance}"]`);
    assert.match(await page.locator('#tubeVesselStatus').innerText(), /separate tubes/);
    const compare = await page.evaluate(() => {
      const s = window.SystemsLesson.human.compareSorter;
      const wrong = s.place('gases', 'both');
      [['food', 'both'], ['water', 'both'], ['system', 'both'], ['gases', 'humans-only'], ['together', 'humans-only'], ['heart', 'humans-only'], ['separate', 'plants-only'], ['salts', 'plants-only']].forEach(([id, bin]) => s.place(id, bin));
      return { wrong, placed: s.placed(), total: s.total };
    });
    assert.equal(compare.wrong, false, 'plant tubes do not carry oxygen and carbon dioxide');
    assert.equal(compare.placed, compare.total);

    // ---------- Part 10: systems working together ----------
    assert.equal(await page.locator('#runStopButton').isDisabled(), true);
    await page.click('#runStartButton');
    await page.evaluate(() => window.SystemsLesson.human.run.fastForward(6));
    const running = await page.evaluate(() => window.SystemsLesson.human.run.state());
    assert.ok(running.heart > 120 && running.breath > 30, 'running raises Devi\'s heart and breathing rates');
    await page.click('#runStopButton');
    await page.evaluate(() => window.SystemsLesson.human.run.fastForward(12));
    const rested = await page.evaluate(() => window.SystemsLesson.human.run.state());
    assert.ok(rested.heart <= 76, 'after resting, her heart rate returns to the resting level');
    assert.match(await page.locator('#runStatus').innerText(), /resting level/);
    for (const activity of ['walking', 'excited', 'swimming', 'jumping', 'running']) await page.click(`#activityButtons [data-activity="${activity}"]`);
    assert.equal(await page.locator('#activitySystems .system-light').count(), 4);
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.activityOrder.pick('running')), false, 'running is not the lowest heart rate');
    await page.evaluate(() => ['resting', 'walking', 'running'].forEach((id) => window.SystemsLesson.human.activityOrder.pick(id)));
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.activityOrderDone), true);
    const systems = await page.evaluate(() => {
      const s = window.SystemsLesson.human.systemsSorter;
      const wrong = s.place('pumpFaster', 'respiratory');
      [['moreOxygen', 'respiratory'], ['moreCo2', 'respiratory'], ['breathRate', 'respiratory'], ['pumpFaster', 'circulatory'], ['toMuscles', 'circulatory'], ['toLungs', 'circulatory'], ['digest', 'digestive'], ['move', 'muscular-skeletal'], ['muscleCo2', 'muscular-skeletal']].forEach(([id, bin]) => s.place(id, bin));
      return { wrong, placed: s.placed(), total: s.total };
    });
    assert.equal(systems.wrong, false);
    assert.equal(systems.placed, systems.total);
    const vessels = await page.evaluate(() => [window.SystemsLesson.human.vessel.set('fatty', 40), window.SystemsLesson.human.vessel.set('balanced', 40)]);
    assert.ok(vessels[0] < vessels[1], 'a fatty diet leaves less room for blood');
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.vesselCompared), true);
    const habits = await page.evaluate(() => {
      const s = window.SystemsLesson.human.habitsSorter;
      const wrong = s.place('smoking', 'healthy');
      [['balanced', 'healthy'], ['jogging', 'healthy'], ['swimming', 'healthy'], ['noSmoke', 'healthy'], ['smoking', 'harmful'], ['fried', 'harmful'], ['inactive', 'harmful']].forEach(([id, bin]) => s.place(id, bin));
      return { wrong, placed: s.placed(), total: s.total };
    });
    assert.equal(habits.wrong, false);
    assert.equal(habits.placed, habits.total);

    // ---------- Quick checks: a wrong answer earns nothing, the right one finishes the part ----------
    const quick = await page.evaluate(() => Object.keys(window.SystemsLesson.quickChecks).map((id) => ({ id, answer: window.SystemsLesson.quickChecks[id].answer })));
    assert.equal(quick.length, 10, 'one quick check for each of the ten teaching parts');
    for (const { id, answer } of quick) {
      const wrong = answer === 0 ? 1 : 0;
      await page.click(`[data-quick-check="${id}"] .choice[data-index="${wrong}"]`);
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate((section) => window.SystemsLesson.progress.isDone(section), id), false, `${id}: a wrong choice earns no progress`);
      await page.click(`[data-quick-check="${id}"] .choice[data-index="${answer}"]`);
      await page.waitForFunction((section) => window.SystemsLesson.progress.isDone(section), id);
    }
    assert.equal(await doneCount(page), 10);

    // ---------- Let's Apply: all nine questions ----------
    const apply = await page.evaluate(() => window.SystemsLesson.applyQuestions.map(({ id, answer, naming, partA, written }) => ({ id, answer, naming: !!naming, partA: !!partA, written: !!written })));
    assert.deepEqual(apply.map((question) => question.id), ['p1', 'p2', 'p3', 'p4', 'h1', 'h2', 'h3', 'h4', 'h5']);
    assert.equal(await page.locator('.apply-question[data-apply]').count(), 9);
    assert.equal(await page.locator('#applyPlantQuestions .apply-question').count(), 4);
    assert.equal(await page.locator('#applyHumanQuestions .apply-question').count(), 5);
    for (const question of apply) {
      const card = page.locator(`.apply-question[data-apply="${question.id}"]`);
      if (question.naming) {
        await card.locator('[data-name-key="W"]').selectOption('circulatory');
        for (const key of ['X', 'Y', 'Z']) await card.locator(`[data-name-key="${key}"]`).selectOption({ index: 1 });
        await card.locator('[data-naming-check]').click();
        assert.match(await card.locator('.feedback').innerText(), /of 4 correct/);
        await card.locator('[data-name-key="W"]').selectOption('digestive');
        await card.locator('[data-name-key="X"]').selectOption('circulatory');
        await card.locator('[data-name-key="Y"]').selectOption('respiratory');
        await card.locator('[data-name-key="Z"]').selectOption('co2');
        await card.locator('[data-naming-check]').click();
        assert.match(await card.locator('.feedback').innerText(), /All correct/);
      } else if (question.partA) {
        await card.locator('[data-circle="1"]').click();
        await card.locator('textarea').fill('His heart rate decreased back to the resting level because he stopped exercising, so his muscles needed less oxygen and his heart pumped slower.');
        await card.locator('[data-written-check]').click();
        assert.ok(await card.locator('.keyword.is-found').count() >= 4, 'the key ideas in a good answer are recognised');
        await card.locator('[data-self-mark="yes"]').click();
      } else if (question.written) {
        await card.locator('textarea').fill('Food is made in the leaves. The food-carrying tubes were removed so food could not be transported below the cut. Excess food was stored at X so X swelled.');
        await card.locator('[data-written-check]').click();
        assert.equal(await card.locator('.model-answer.is-visible').count(), 1, 'checking a written answer shows the model answer');
        await card.locator('[data-self-mark="yes"]').click();
      } else {
        await card.locator(`.choice[data-index="${question.answer}"]`).click();
        assert.equal(await card.locator('.choice.is-correct').count(), 1, `${question.id}: the textbook answer is marked correct`);
      }
    }
    assert.equal(await page.evaluate(() => window.SystemsLesson.progress.isDone('apply')), true, 'answering all nine finishes Let\'s Apply');
    assert.equal((await page.locator('#applyScoreValue').innerText()).trim(), '8 / 9', 'Q4 of the human chapter was right only at the second try');

    // ---------- Concept maps: a wrong word is rejected, then both maps complete ----------
    const concept = await page.evaluate(() => {
      const { plant, human } = window.SystemsLesson.concept;
      const blank = plant.nodes.find((node) => node.blank);
      const other = human.nodes.find((node) => node.blank && node.text !== blank.text && !plant.nodes.some((p) => p.blank && p.text === node.text));
      plant.select(blank.id);
      const rejected = plant.place(other.text);
      plant.fillAll();
      const plantOnly = window.SystemsLesson.progress.isDone('learnt');
      human.fillAll();
      return { rejected, plantOnly, plantDone: plant.complete(), humanDone: human.complete() };
    });
    assert.equal(concept.rejected, false, 'a word from the wrong place is rejected');
    assert.equal(concept.plantOnly, false, 'one concept map alone does not finish the part');
    assert.equal(concept.plantDone && concept.humanDone, true);
    assert.equal(await page.evaluate(() => window.SystemsLesson.progress.isDone('learnt')), true);
    assert.equal(await doneCount(page), 12);
    assert.match(await page.locator('#finishText').innerText(), /finished every part/);
    await healthyPage(session, 'desktop lesson');

    if (shots) {
      await page.screenshot({ path: path.join(shots, 'systems-desktop.png') });
      for (const id of sections) await page.locator(`section[data-section="${id}"]`).screenshot({ path: path.join(shots, `systems-${id}.png`) });
    }

    // Progress survives a reload, and the catalogue reads it.
    await page.reload();
    await page.waitForFunction(() => window.SystemsLesson?.ready);
    assert.equal(await doneCount(page), 12, 'completion survives reload');
    await page.goto(`${origin}/interactive-textbook/`);
    const card = page.locator('.topic-card[data-topic="respiratory-circulatory"]');
    await card.waitFor();
    assert.equal((await card.locator('.topic-title').innerText()).trim(), 'Plant Transport, Respiratory and Circulatory Systems');
    assert.equal((await card.locator('.progress-label').innerText()).trim(), '12 / 12', 'catalogue reads the saved progress');
    for (const word of ['windpipe', 'stethoscope', 'water-carrying']) {
      await page.fill('#topicSearch', word);
      assert.equal(await page.locator('.topic-card').count(), 1, `search finds the topic by "${word}"`);
      assert.equal(await page.locator('.topic-card[data-topic="respiratory-circulatory"]').count(), 1);
    }
    await page.fill('#topicSearch', '');
    await card.click();
    await page.waitForFunction(() => window.SystemsLesson?.ready);
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#progressResetButton');
    await page.waitForFunction(() => window.SystemsLesson.progress.sections.every((id) => !window.SystemsLesson.progress.isDone(id)));
    await page.reload();
    await page.waitForFunction(() => window.SystemsLesson?.ready);
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
    await page.locator('#habitsWidget').scrollIntoViewIfNeeded();
    await page.locator('#habitsPool .sort-card[data-card="balanced"]').tap();
    await page.locator('#habitsWidget .sort-bin[data-bin="healthy"]').tap();
    assert.equal(await page.locator('#habitsWidget .sort-bin[data-bin="healthy"] .sort-card[data-card="balanced"]').count(), 1, 'tap a card, then tap a box');
    await page.locator('#heartButton').tap();
    assert.equal((await page.locator('#pumpBeats').innerText()).trim(), '1');
    await page.locator('#respSvg [data-part="lungs"] path >> nth=0').tap();
    assert.match(await page.locator('#respStatus').innerText(), /gaseous exchange/);
    await page.locator('#pieView [data-value="table"]').tap();
    await noSideScroll(page, 'pie table at 360px');
    await page.locator('[data-quick-check="air"] .choice').first().scrollIntoViewIfNeeded();
    const airAnswer = await page.evaluate(() => window.SystemsLesson.quickChecks.air.answer);
    await page.locator(`[data-quick-check="air"] .choice[data-index="${airAnswer}"]`).tap();
    await page.waitForFunction(() => window.SystemsLesson.progress.isDone('air'));
    if (shots) {
      await page.screenshot({ path: path.join(shots, 'systems-phone.png') });
      for (const id of ['plant-tubes', 'respiratory', 'air-data', 'circulatory', 'systems', 'apply', 'learnt']) {
        await page.locator(`section[data-section="${id}"]`).screenshot({ path: path.join(shots, `systems-phone-${id}.png`) });
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
    await page.evaluate(() => window.SystemsLesson.human.circ.send('brain'));
    await page.waitForFunction(() => window.SystemsLesson.human.circ.delivered() === 1, null, { timeout: 3000 });
    await page.click('#airSacBreatheIn');
    assert.equal(await page.evaluate(() => window.SystemsLesson.human.airSac.state().exchanges), 1, 'with reduced motion, gaseous exchange happens at once');
    await page.evaluate(() => window.SystemsLesson.human.asthma.set(9, 9));
    await page.click('#asthmaInhalerButton');
    assert.ok(await page.evaluate(() => window.SystemsLesson.human.asthma.flow()) > 80, 'the inhaler opens the airway at once');
    await healthyPage(session, 'reduced motion');
    await context.close();
  }

  assert.deepEqual(missing.filter((item) => !item.endsWith('favicon.ico')), [], 'every local file the lesson asks for exists');
} finally {
  await browser.close();
  server.close();
}

console.log('Plant Transport, Respiratory and Circulatory Systems textbook: science models, all chapter widgets, sorters and order games, quick checks, Let\'s Apply, concept maps, saved progress, catalogue, desktop, phone and reduced motion pass.');
