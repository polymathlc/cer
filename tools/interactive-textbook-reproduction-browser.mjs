// Drive the shipped reproduction lesson, with local assets and no remote requests.
// TEXTBOOK_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/interactive-textbook-reproduction-browser.mjs
// TEXTBOOK_CHROMIUM=/path/to/chromium TEXTBOOK_SCREENSHOTS=artifacts/reproduction node tools/interactive-textbook-reproduction-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.TEXTBOOK_PLAYWRIGHT_MODULE || process.env.PW || 'playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const shots = process.env.TEXTBOOK_SCREENSHOTS || '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const sections = ['continuity', 'human-systems', 'human-development', 'flowers', 'pollination', 'fertilisation', 'dispersal', 'germination', 'spores', 'compare', 'apply', 'learnt'];
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

async function openPage(width, height, mobile = false) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
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
  await page.goto(`${origin}/interactive-textbook/reproduction/`);
  await page.waitForFunction(() => window.ReproductionLesson?.ready);
}

async function noSideScroll(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `${label}: sideways overflow is ${overflow}px`);
}

async function setRange(page, id, value) {
  await page.locator(id).fill(String(value));
  await page.locator(id).dispatchEvent('input');
}

async function healthyPage({ errors, outside }, label) {
  assert.deepEqual(errors, [], `${label}: no browser errors`);
  assert.deepEqual(outside, [], `${label}: no requests leave the machine`);
}

try {
  // Desktop: complete the chapter and carry the result back to the catalogue.
  {
    const session = await openPage(1280, 900);
    const { context, page } = session;
    await openLesson(page);
    assert.deepEqual(await page.evaluate(() => window.ReproductionLesson.progress.sections), sections);
    assert.equal(await page.evaluate(() => window.ReproductionLesson.progress.key), 'polymath_textbook_reproduction_progress');
    assert.deepEqual(await page.locator('section[data-section]').evaluateAll((nodes) => nodes.map((node) => node.dataset.section)), sections, 'all twelve chapter sections are present');
    await noSideScroll(page, 'desktop lesson');

    const imageInfo = await page.locator('img').evaluateAll(async (images) => {
      await Promise.all(images.map((image) => image.decode()));
      return images.map((image) => ({ src: image.currentSrc, loaded: image.complete && image.naturalWidth > 0, alt: image.alt }));
    });
    assert.ok(imageInfo.length > 0, 'the lesson includes its local illustration');
    assert.ok(imageInfo.every((image) => image.loaded && new URL(image.src).origin === origin), 'all illustrations load locally');
    assert.ok(imageInfo.every((image) => image.alt.trim()), 'illustrations have alternative text');

    // The pure models catch the most consequential science misconceptions.
    const modelResults = await page.evaluate(() => {
      const lesson = window.ReproductionLesson;
      const germination = [];
      for (const water of [false, true]) for (const oxygen of [false, true]) for (const warm of [false, true]) for (const light of [false, true]) {
        germination.push({ water, oxygen, warm, light, result: lesson.germinates({ water, oxygen, warm, light }) });
      }
      return {
        germination,
        seeds: [1, 4, 8].map((n) => lesson.seedCount(n)),
        classification: [
          lesson.classification({ flowers: false, pods: false, wings: false }),
          lesson.classification({ flowers: true, pods: false, wings: false }),
          lesson.classification({ flowers: true, pods: true, wings: false }),
          lesson.classification({ flowers: true, pods: true, wings: true })
        ]
      };
    });
    for (const test of modelResults.germination) assert.equal(test.result, test.water && test.oxygen && test.warm, 'germination requires water, oxygen and suitable temperature; light is not required');
    assert.deepEqual(modelResults.seeds, [1, 4, 8], 'each fertilised ovule can become one seed');
    assert.deepEqual(modelResults.classification, ['W', 'X', 'Y', 'Z']);

    for (const [view, wording] of [['cells', /microscope|magnified/i], ['information', /information.*parents|parents.*offspring/i], ['body', /body parts.*cells/i]]) {
      await page.click(`[data-cell="${view}"]`);
      assert.match(await page.locator('#cellStatus').innerText(), wording);
      assert.equal(await page.locator(`[data-cell="${view}"]`).getAttribute('aria-pressed'), 'true');
    }
    for (const [system, parts] of [['male', ['testes', 'penis']], ['female', ['ovaries', 'womb', 'vagina']]]) {
      await page.click(`[data-system="${system}"]`);
      assert.equal(await page.locator(`#${system}Diagram`).isVisible(), true);
      assert.equal(await page.locator(`#${system === 'male' ? 'female' : 'male'}Diagram`).isVisible(), false);
      for (const part of parts) {
        await page.click(`[data-human="${part}"]`);
        assert.match(await page.locator('#humanInfo').innerText(), new RegExp(part, 'i'));
      }
    }

    // Human development is also operable from the keyboard.
    const humanStages = [await page.locator('#humanStage').innerText()];
    await page.locator('#humanNext').focus();
    await page.keyboard.press('Enter');
    humanStages.push(await page.locator('#humanStage').innerText());
    for (let step = 0; step < 2; step++) {
      await page.click('#humanNext');
      humanStages.push(await page.locator('#humanStage').innerText());
    }
    assert.equal(new Set(humanStages).size, 4, 'four distinct stages explain human development');
    assert.equal(await page.locator('#humanNext').isDisabled(), true, 'the final human stage has no further step');
    await page.click('#humanRestart');
    assert.equal(await page.locator('#humanStage').getAttribute('data-stage'), '0');
    await page.click('[data-twins="identical"]');
    assert.match(await page.locator('#twinsStatus').innerText(), /one|same|single|1/i);
    const identicalStatus = await page.locator('#twinsStatus').innerText();
    await page.click('[data-twins="fraternal"]');
    assert.notEqual(await page.locator('#twinsStatus').innerText(), identicalStatus);
    assert.match(await page.locator('#twinsStatus').innerText(), /two|different|2/i);

    for (const part of ['anther', 'filament', 'stigma', 'style', 'ovary', 'ovule']) {
      await page.click(`[data-flower="${part}"]`);
      assert.match((await page.locator('#flowerInfo').innerText()).toLowerCase(), new RegExp(part), `flower explorer explains ${part}`);
    }
    for (const filter of ['male', 'female']) {
      await page.click(`[data-filter="${filter}"]`);
      assert.equal(await page.locator('#flowerDiagram').evaluate((node, expected) => node.classList.contains(`highlight-${expected}`), filter), true);
      const muted = filter === 'male' ? 'female' : 'male';
      assert.ok(await page.locator(`#flowerDiagram .flower-${muted}`).evaluate((node) => Number(getComputedStyle(node).opacity) < 1), 'the other flower structures are visually muted');
    }
    await page.click('[data-filter="all"]');
    assert.equal(await page.locator('#flowerDiagram').getAttribute('class'), 'diagram');
    await page.selectOption('#pollenSource', 'ovary');
    await page.selectOption('#pollenTarget', 'ovule');
    await page.click('#pollinateButton');
    const wrongPollination = await page.locator('#pollinationStatus').innerText();
    await page.selectOption('#pollenSource', 'anther');
    await page.selectOption('#pollenTarget', 'stigma');
    await page.click('#pollinateButton');
    assert.notEqual(await page.locator('#pollinationStatus').innerText(), wrongPollination, 'pollination distinguishes anther-to-stigma transfer from the wrong route');
    assert.match(await page.locator('#pollinationStatus').innerText(), /pollination|stigma|correct/i);
    const routes = (await page.locator('#pollenRoute option').allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim());
    for (let route = 0; route < routes.length; route++) {
      await page.selectOption('#pollenRoute', { index: route });
      await page.click('#pollinateButton');
      assert.ok((await page.locator('#pollinationStatus').innerText()).toLowerCase().includes(routes[route].toLowerCase()), 'each biologically valid pollen route is explained');
      assert.equal(await page.locator('#pollenDot').evaluate((node) => node.classList.contains('pollen-moving')), true);
    }
    await page.click('[data-carrier="wind"]');
    assert.match(await page.locator('#carrierStatus').innerText(), /anthers.*outside.*feathery stigmas/i);
    await page.click('[data-carrier="animal"]');
    assert.match(await page.locator('#carrierStatus').innerText(), /scent.*nectar.*pollen/i);

    assert.equal(await page.locator('#pollenTube').isVisible(), false, 'the pollen tube is absent before it grows');
    assert.equal(await page.locator('#maleCell').isVisible(), false, 'the travelling male cell is absent before its stage');
    const plantStages = [await page.locator('#plantStage').innerText()];
    for (let step = 0; step < 3; step++) {
      await page.click('#plantNext');
      plantStages.push(await page.locator('#plantStage').innerText());
      assert.equal(await page.locator('#pollenTube').isVisible(), true, 'the pollen tube is visible from stage 1');
      assert.equal(await page.locator('#maleCell').isVisible(), step >= 1, 'the male cell is visible from stage 2');
    }
    assert.equal(new Set(plantStages).size, 4, 'fertilisation explorer has four distinct stages');
    await page.click('#plantRestart');
    assert.equal(await page.locator('#pollenTube').isVisible(), false, 'restart hides the grown pollen tube');
    assert.equal(await page.locator('#maleCell').isVisible(), false, 'restart hides the travelling male cell');
    for (const count of [1, 6]) {
      await setRange(page, '#ovuleCount', count);
      assert.match(await page.locator('#seedCount').innerText(), new RegExp(`\\b${count}\\b`));
    }

    const specimens = [
      ['Maple', 'wings', 'wind'], ['Mango', 'flesh', 'animals'], ['Pong pong', 'husk', 'water'],
      ['Saga', 'pod', 'splitting'], ['Burdock', 'flesh', 'animals'], ['Dandelion', 'wings', 'wind']
    ];
    for (const [name, evidence, method] of specimens) {
      assert.match(await page.locator('#specimenName').innerText(), new RegExp(name));
      assert.equal(await page.locator('#specimenArt svg').isVisible(), true, `${name} has a rendered specimen`);
      await page.selectOption('#dispersalEvidence', evidence === 'husk' ? 'pod' : 'husk');
      await page.click(`[data-method="${method}"]`);
      assert.match(await page.locator('#dispersalStatus').innerText(), /^Try again\./, 'a correct method without matching structural evidence is rejected');
      await page.selectOption('#dispersalEvidence', evidence);
      await page.click(`[data-method="${method === 'wind' ? 'water' : 'wind'}"]`);
      assert.match(await page.locator('#dispersalStatus').innerText(), /^Try again\./, 'correct evidence with a wrong dispersal method is rejected');
      await page.click(`[data-method="${method}"]`);
      assert.match(await page.locator('#dispersalStatus').innerText(), /^Correct\./, `${name}: feature supports its dispersal mechanism`);
      await page.click('#dispersalNext');
    }
    assert.match(await page.locator('#specimenName').innerText(), /Maple/, 'specimens cycle back to the beginning');

    await page.check('#water');
    await page.check('#oxygen');
    await page.check('#warm');
    await setRange(page, '#dayRange', 2);
    assert.match(await page.locator('#trayBStatus').innerText(), /Root emerges first/);
    assert.ok(await page.locator('#trayB .root').evaluate((node) => parseFloat(node.style.height) > 0));
    assert.equal(await page.locator('#trayB .shoot').evaluate((node) => parseFloat(node.style.height)), 0, 'a root appears before the shoot');
    await setRange(page, '#dayRange', 4);
    assert.match(await page.locator('#trayBStatus').innerText(), /Shoot begins/);
    assert.ok(await page.locator('#trayB .shoot').evaluate((node) => parseFloat(node.style.height) > 0));
    assert.equal(await page.locator('#trayB').evaluate((node) => node.classList.contains('grown')), false, 'true leaves have not yet appeared');
    await setRange(page, '#dayRange', 6);
    assert.equal(await page.locator('#trayB').evaluate((node) => node.classList.contains('grown')), true, 'true leaves appear later');
    await page.uncheck('#light');
    await setRange(page, '#dayRange', 8);
    assert.match(await page.locator('#germinationStatus').innerText(), /germinat|seedling|leaves|young plant/i, 'germination can proceed without light');
    const healthyGermination = await page.locator('#germinationStatus').innerText();
    assert.match(await page.locator('#experimentStatus').innerText(), /One factor differs: light/);
    for (const condition of ['water', 'oxygen', 'warm']) {
      await page.uncheck(`#${condition}`);
      assert.notEqual(await page.locator('#germinationStatus').innerText(), healthyGermination, `missing ${condition} changes the result`);
      assert.match(await page.locator('#trayBStatus').innerText(), /No germination/);
      assert.equal(await page.locator('#trayB .root').evaluate((node) => parseFloat(node.style.height)), 0);
      assert.match(await page.locator('#experimentStatus').innerText(), /More than one factor differs/);
      await page.check(`#${condition}`);
    }
    assert.equal(await page.locator('#sporeCloud').isVisible(), false, 'spores begin inside the spore bags');
    const sporesBefore = await page.locator('#sporeStatus').innerText();
    await page.click('#sporeNext');
    assert.notEqual(await page.locator('#sporeStatus').innerText(), sporesBefore, 'spore explorer advances');
    assert.equal(await page.locator('#sporeCloud').isVisible(), true, 'released spores become visible');
    await page.click('#sporeNext');
    assert.match(await page.locator('#sporeStatus').innerText(), /favourable conditions.*new fern plants/i);
    await page.click('#sporeRestart');
    assert.equal(await page.locator('#sporeCloud').isVisible(), false, 'restart returns the spores to the starting view');
    for (const [event, process] of [['fusion', /Fertilisation.*both humans and flowering plants/i], ['pollen', /Pollination.*stigma/i], ['seed', /Dispersal.*water/i]]) {
      await page.click(`[data-compare="${event}"]`);
      assert.match(await page.locator('#compareStatus').innerText(), process);
    }
    for (const [plant, group] of [['fern', 'W'], ['tomato', 'X'], ['saga', 'Y'], ['tulip', 'Z']]) {
      await page.selectOption('#classPlant', plant);
      await page.click('#classifyButton');
      assert.match(await page.locator('#classificationStatus').innerText(), new RegExp(`^Group ${group}\\.`), 'classification UI follows the observed features');
    }

    // A wrong answer must supply feedback without marking the section complete.
    const checks = await page.evaluate(() => window.ReproductionLesson.questions.map(({ id, correct, choices }) => ({ id, correct, count: choices.length })));
    assert.deepEqual(checks.map((question) => question.id), sections.slice(0, 10));
    for (const { id, correct, count } of checks) {
      const fieldset = page.locator(`#quick-${id}`);
      assert.equal(await fieldset.locator('button[data-answer]').count(), count);
      await fieldset.locator(`button[data-answer="${(correct + 1) % count}"]`).click();
      assert.equal(await page.evaluate((section) => window.ReproductionLesson.progress.isDone(section), id), false, `${id}: incorrect choice earns no progress`);
      assert.match(await fieldset.locator('.feedback').innerText(), /^Try again\./, `${id}: an incorrect answer explains the idea`);
      await fieldset.locator(`button[data-answer="${correct}"]`).click();
      assert.equal(await page.evaluate((section) => window.ReproductionLesson.progress.isDone(section), id), true, `${id}: correct choice earns progress`);
      assert.match(await fieldset.locator('.feedback.good').innerText(), /^Correct\./, `${id}: a correct answer explains the idea`);
    }

    const apply = await page.evaluate(() => window.ReproductionLesson.applyQuestions.map(({ id, correct }) => ({ id, correct })));
    assert.ok(apply.length >= 7, 'the textbook application questions and subparts are included');
    assert.equal(await page.locator('#applyQuestions fieldset[data-question]').count(), apply.length);
    for (const { id, correct } of apply) await page.click(`#applyQuestions fieldset[data-question="${id}"] button[data-answer="${correct}"]`);
    assert.equal(await page.evaluate(() => window.ReproductionLesson.progress.isDone('apply')), true, 'complete application work marks its section done');

    // The concept map rejects a misplaced stage, then accepts the complete cycle.
    await page.click('#cyclePick button[data-stage="adult"]');
    assert.equal(await page.evaluate(() => window.ReproductionLesson.progress.isDone('learnt')), false, 'an incorrect first stage cannot finish the concept map');
    await page.click('#resetCycle');
    for (const stage of ['seed', 'young', 'adult', 'pollination', 'fertilisation', 'fruit', 'dispersal']) await page.click(`#cyclePick button[data-stage="${stage}"]`);
    assert.equal(await page.evaluate(() => window.ReproductionLesson.progress.isDone('learnt')), true);
    assert.match(await page.locator('#cycleStatus').innerText(), /complete|correct|well done/i);
    assert.equal(await page.evaluate(() => window.ReproductionLesson.progress.sections.filter((id) => window.ReproductionLesson.progress.isDone(id)).length), 12);
    if (shots) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(shots, 'reproduction-desktop.png') });
      for (const id of ['human-development', 'flowers', 'fertilisation', 'dispersal', 'germination', 'apply']) {
        await page.locator(`section[data-section="${id}"]`).screenshot({ path: path.join(shots, `reproduction-${id}.png`) });
      }
    }

    await page.reload();
    await page.waitForFunction(() => window.ReproductionLesson?.ready);
    assert.equal(await page.evaluate(() => window.ReproductionLesson.progress.sections.filter((id) => window.ReproductionLesson.progress.isDone(id)).length), 12, 'completion survives reload');
    await page.goto(`${origin}/interactive-textbook/`);
    const card = page.locator('.topic-card[data-topic="reproduction"]');
    await card.waitFor();
    assert.equal((await card.locator('.progress-label').innerText()).trim(), '12 / 12', 'catalogue reads the saved chapter progress');
    assert.match(await card.innerText(), /Review/);
    await card.click();
    await page.waitForFunction(() => window.ReproductionLesson?.ready);
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#resetProgress');
    assert.equal(await page.evaluate(() => window.ReproductionLesson.progress.sections.filter((id) => window.ReproductionLesson.progress.isDone(id)).length), 0, 'reset clears chapter completion');
    await page.reload();
    await page.waitForFunction(() => window.ReproductionLesson?.ready);
    assert.equal(await page.evaluate(() => window.ReproductionLesson.progress.sections.some((id) => window.ReproductionLesson.progress.isDone(id))), false, 'reset survives reload');
    await healthyPage(session, 'desktop');
    await context.close();
  }

  // Phone: touch controls, all sections, and no horizontal scrolling at 360px.
  {
    const session = await openPage(360, 740, true);
    const { context, page } = session;
    await openLesson(page);
    for (const id of sections) {
      await page.locator(`section[data-section="${id}"]`).scrollIntoViewIfNeeded();
      await noSideScroll(page, `${id} at 360px`);
    }
    const before = await page.locator('#humanStage').innerText();
    await page.locator('#humanNext').tap();
    assert.notEqual(await page.locator('#humanStage').innerText(), before, 'human development responds to touch');
    await page.locator('[data-flower="ovule"]').tap();
    assert.match(await page.locator('#flowerInfo').innerText(), /ovule/i);
    if (shots) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(shots, 'reproduction-phone.png') });
      await page.locator('section[data-section="germination"]').screenshot({ path: path.join(shots, 'reproduction-phone-germination.png') });
    }
    await healthyPage(session, 'phone');
    await context.close();
  }

  // Reduced motion keeps text visible and buttons functional.
  {
    const session = await openPage(1024, 800);
    const { context, page } = session;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openLesson(page);
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    const visibleSections = await page.locator('section[data-section]').evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === '1' && getComputedStyle(node).visibility === 'visible'));
    assert.equal(visibleSections, true, 'chapter content is visible without animation');
    const before = await page.locator('#plantStage').innerText();
    await page.locator('#plantNext').focus();
    await page.keyboard.press('Space');
    assert.notEqual(await page.locator('#plantStage').innerText(), before, 'keyboard interaction works with reduced motion');
    await healthyPage(session, 'reduced motion');
    await context.close();
  }
  assert.deepEqual(missing, [], 'all requested local assets exist');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log('Reproduction textbook: science models, chapter widgets, assessment, saved progress, catalogue, desktop, phone and reduced motion pass.');
