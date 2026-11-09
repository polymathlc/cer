// Exercise the real cold launch with controlled image delivery and portal identity.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {})
});
const portal = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style>
<iframe id="legends" src="/science-legends.html"></iframe><script>
  window.starts = [];
  let learner = 'student-a', level = 'P4', serial = 0;
  const frame = document.getElementById('legends');
  addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
    const data = event.data;
    if (data.type === 'SD_PLAY_START') starts.push(data);
    if (data.type === 'SD_REQUEST_QUESTIONS') {
      event.source.postMessage({type:'SD_QUESTIONS', feedPolicyVersion:1, requestId:data.requestId,
        studentKey:learner, studentLevel:level, playsLeft:{legends:10},
        questions:[{id:'qa-'+(++serial), q:'Which material lets light pass?',
          options:['Clear glass','Wood'], answer:0, topic:'Light'}]}, location.origin);
    }
    if (data.type === 'LEGENDS_REQUEST_META') {
      event.source.postMessage({type:'LEGENDS_META',meta:{inv:[],eq:{},loadout:{},pts:0},gold:0},location.origin);
    }
  });
  window.switchLearner = () => {
    learner = 'student-b'; level = 'P3';
    frame.contentWindow.postMessage({type:'SD_FEED_INVALIDATE',studentKey:learner,studentLevel:level},location.origin);
  };
  window.setSurface = active => {
    frame.style.display = active ? 'block' : 'none';
    frame.contentWindow.postMessage({type:'SD_GAME_VISIBILITY',mode:'legends',active},location.origin);
  };
</script>`;

let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }

async function open({ hold = [], block = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  const errors = [], heldFiles = new Set(hold), heldRoutes = new Map();
  page.on('pageerror', error => errors.push(error.message));
  function fulfill(route) {
    const url = new URL(route.request().url());
    const filename = path.join(root, decodeURIComponent(url.pathname));
    return fs.existsSync(filename) && fs.statSync(filename).isFile()
      ? route.fulfill({ path: filename }) : route.abort();
  }
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'legends-startup.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: portal });
    const asset = path.posix.basename(url.pathname);
    if (block.includes(asset)) return route.abort();
    if (heldFiles.has(asset)) {
      const routes = heldRoutes.get(asset) || [];
      routes.push(route);
      heldRoutes.set(asset, routes);
      return;
    }
    return fulfill(route);
  });
  await page.goto('http://legends-startup.test/', { waitUntil: 'domcontentloaded' });
  await page.frameLocator('#legends').locator('#startBtn').waitFor();
  const game = await (await page.locator('#legends').elementHandle()).contentFrame();
  await game.waitForFunction(() => _gameCreditsReady());
  await game.locator('.class-card[data-class="sorc"]').click();
  async function release(asset) {
    const routes = heldRoutes.get(asset);
    assert.ok(routes?.length, 'Browser actually requested held asset ' + asset);
    heldFiles.delete(asset);
    heldRoutes.delete(asset);
    for (const route of routes) await fulfill(route);
  }
  return { context, page, game, errors, release };
}

async function beginLoading(game) {
  await game.locator('#startBtn').click();
  await game.locator('#loadingOverlay').waitFor({ state: 'visible' });
}

async function waitForRun(game, page) {
  await game.waitForFunction(() => G?.state === 'play' && G.time > 0, null, { timeout: 20000 });
  await page.waitForFunction(() => starts.length > 0);
}

try {
  {
    const { context, page, game, errors, release } = await open({ hold: ['heroes-rear.webp', 'fx-sorc.webp'] });
    await game.evaluate(() => {
      const trace = window.startupDraws = { warmSources: new WeakSet(), calls: [], capturing: false };
      const original = ctx.drawImage;
      ctx.drawImage = function (source, ...coordinates) {
        if (G?.state !== 'play' && $('loadingOverlay').classList.contains('show')) trace.warmSources.add(source);
        if (trace.capturing) trace.calls.push({ source, coordinates });
        return original.call(this, source, ...coordinates);
      };
    });
    await beginLoading(game);
    await game.waitForFunction(() => LegendsModels.assetStates().filter(state => state === 'ready').length === LegendsModels.assetStates().length - 1
      && $('loadingProgress').value > 0);
    const before = await game.locator('#loadingProgress').evaluate(progress => ({
      native: progress instanceof HTMLProgressElement, value: progress.value, max: progress.max
    }));
    check(before.native && before.max === 100 && before.value < 100, 'The native loading bar reflects work completed while a model and skill effect are pending');
    await game.evaluate(() => { startRun(); startRun(); });
    check(await game.evaluate(() => (!G || (G.state !== 'play' && G.time === 0)) && _gPlaysLeft === 10),
      'Repeated Start during loading creates no active run or local credit charge');
    check(await page.evaluate(() => starts.length === 0), 'The portal receives no start while artwork is pending');

    await release('heroes-rear.webp');
    await game.waitForFunction(value => LegendsModels.ready('heroRear') && $('loadingProgress').value > value, before.value);
    check(await game.evaluate(() => (!G || (G.state !== 'play' && G.time === 0))
      && !LegendsActions.ready('fx-sorc') && $('loadingProgress').value < 100),
      'A completed model advances progress while the separately held spell effect still gates play');

    await release('fx-sorc.webp');
    await waitForRun(game, page);
    const painted = await game.evaluate(() => {
      const trace = window.startupDraws;
      const cls = CLASS_ORDER.indexOf(G.cls);
      const heroTextures = [G.presentation.models.hero, G.presentation.models.heroRear]
        .flatMap(sheet => sheet.frames[cls].map(frame => frame.texture));
      const cell = LegendsActions.atlasFrame('fireball', lowMotion ? 1 : 0, G.presentation.actions);
      const arcane = LegendsArt.images()[0];
      trace.capturing = true;
      try { castSkill(0); draw(); } finally { trace.capturing = false; }
      const warmedDraw = ({ source }) => trace.warmSources.has(source);
      const usesCrop = ([x, y, width, height]) => ({ coordinates }) =>
        coordinates.length === 8 && coordinates[0] === x && coordinates[1] === y
        && coordinates[2] === width && coordinates[3] === height;
      const preparedDraw = call => warmedDraw(call) && !(call.source instanceof HTMLImageElement);
      return {
        classId: G.cls,
        wave: G.wave,
        credits: _gPlaysLeft,
        warmHero: trace.calls.some(call => heroTextures.includes(call.source) && warmedDraw(call)),
        warmSkill: !!cell && trace.calls.filter(usesCrop([cell.x, cell.y, cell.w, cell.h])).some(preparedDraw),
        warmSharedEffect: trace.calls.filter(usesCrop([0, 0, arcane.naturalWidth / 4, arcane.naturalHeight / 2])).some(preparedDraw)
      };
    });
    check(painted.classId === 'sorc' && painted.wave === 1 && painted.credits === 9, 'The chosen class enters wave one and spends exactly one credit');
    check(painted.warmHero && painted.warmSkill && painted.warmSharedEffect, 'The real first Fireball and hero paint reuse the same model and prepared effect sources warmed before combat: ' + JSON.stringify(painted));
    check(!(await game.locator('#loadingOverlay').isVisible()), 'The loading cover closes when the run starts');
    check(await page.evaluate(() => starts.length === 1 && starts[0].studentKey === 'student-a' && starts[0].studentLevel === 'P4'),
      'Exactly one start carries the accepted learner and school level');
    check(!errors.length, 'Cold startup and first cast leave no browser errors: ' + errors.join(', '));
    await context.close();
  }

  {
    const { context, page, game, errors, release } = await open({ hold: ['fx-sorc.webp'] });
    await beginLoading(game);
    await game.locator('#cancelLoadingBtn').click();
    await game.locator('#menuOverlay').waitFor({ state: 'visible' });
    check(await game.evaluate(() => G === null && !pendingHunt && _gPlaysLeft === 10), 'Cancel returns to the menu without spending credit or leaving a pending run');
    check(await page.evaluate(() => starts.length === 0), 'Canceled loading records no portal start');

    await beginLoading(game);
    await page.evaluate(() => setSurface(false));
    await game.waitForFunction(() => !activeGameSurface() && !pendingHunt, null, { polling: 50 });
    await page.evaluate(() => setSurface(true));
    await game.waitForFunction(() => activeGameSurface());
    check(await game.evaluate(() => G === null && _gPlaysLeft === 10), 'Leaving the surface cancels loading, and returning creates no hidden run or credit charge');
    check(await page.evaluate(() => starts.length === 0), 'Leaving and returning records no portal start');

    await beginLoading(game);
    await page.evaluate(() => switchLearner());
    await game.waitForFunction(() => scienceFeed.context().studentKey === 'student-b' && !pendingHunt);
    await game.locator('#menuOverlay').waitFor({ state: 'visible' });
    await release('fx-sorc.webp');
    await game.waitForFunction(() => LegendsActions.ready('fx-sorc') && _gameCreditsReady());
    check(await game.evaluate(() => G === null && _gPlaysLeft === 10), 'Late artwork completion cannot start the previous learner’s run or consume the new learner’s credit');
    check(await page.evaluate(() => starts.length === 0), 'The portal sees no start after a learner changes during preflight');
    await game.locator('#startBtn').click();
    await waitForRun(game, page);
    check(await page.evaluate(() => starts.length === 1 && starts[0].studentKey === 'student-b' && starts[0].studentLevel === 'P3'),
      'A fresh Start works once for the new learner after cancellation');
    check(!errors.length, 'Canceled and replaced preflights leave no browser errors: ' + errors.join(', '));
    await context.close();
  }

  {
    const { context, page, game, errors, release } = await open({ hold: ['fx-sorc.webp'], block: ['enemies-rear.webp'] });
    await beginLoading(game);
    await game.waitForFunction(() => LegendsModels.assetStates().includes('failed'));
    await waitForRun(game, page);
    check(await game.evaluate(() => G.wave === 1 && !G.presentation.models.enemyRear
      && !LegendsActions.atlasFrame('fireball', 0, G.presentation.actions) && !LegendsActions.ready('fx-sorc')),
    'The bounded wait starts a playable run with fallback art for both a failed request and a still-held effect');
    await release('fx-sorc.webp');
    await game.waitForFunction(() => LegendsActions.ready('fx-sorc'));
    check(await game.evaluate(() => !LegendsActions.atlasFrame('fireball', 0, G.presentation.actions)),
      'An effect that arrives after the deadline does not swap into the live presentation');
    check(await page.evaluate(() => starts.length === 1), 'Fallback launch spends only one credit');
    check(!errors.length, 'Fallback artwork leaves no browser errors: ' + errors.join(', '));
    await context.close();
  }
  console.log('Science Legends startup browser: ' + checks + ' checks passed');
} finally {
  await browser.close();
}
