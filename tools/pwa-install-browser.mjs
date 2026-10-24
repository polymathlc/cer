// 📲 Polymath install kit (v2.0.0) — the checks in a real Chromium.
//
// Serves the repository on localhost with the internet cut off (Firebase and
// fonts fail, which every app survives) and, for each app folder in APP_DIRS,
// checks what a student gets:
//   1. Chrome reads the manifest and finds the page installable; sw.js takes
//      control with the app folder as its scope.
//   2. With no connection, the installed app shows offline.html.
//   3. An "Install app" control is on screen — the app's own, or the floating one.
//   4. On a computer with no prompt yet it shows the Chrome steps; with the
//      browser's prompt available it uses the prompt and then hides.
//   5. On an iPhone it shows Share → Add to Home Screen, and the card fits.
//   6. Opened from the home screen (installed) there is no install control at all.
//   7. The floating button's × hides it, and it stays hidden after a reload.
//
//   PW=/path/to/playwright/index.mjs node tools/pwa-install-browser.mjs
//   PWA_SCREENSHOTS=artifacts/pwa saves a picture of each step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIRS = ['online', 'student'];

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
async function loadPlaywright() {
  const candidates = [process.env.PW, 'playwright', '/opt/npm-tools/node_modules/playwright/index.mjs', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const candidate of candidates) {
    try { return await import(candidate); } catch (error) { /* try the next one */ }
  }
  throw new Error('Playwright not found — set PW=/path/to/playwright/index.mjs');
}
const { chromium } = await loadPlaywright();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = http.createServer((request, response) => {
  let relative = decodeURIComponent(request.url.split('?')[0]);
  if (relative.endsWith('/')) relative += 'index.html';
  const file = path.join(repoRoot, relative);
  if (!file.startsWith(repoRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
// "localhost" (not 127.0.0.1) is a secure context for service workers in every browser.
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const screenshots = process.env.PWA_SCREENSHOTS;
if (screenshots) fs.mkdirSync(screenshots, { recursive: true });

const IPHONE = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true
};

/** The first install control a student can actually see and press (the app's own first, else the floating one). */
async function visibleControl(page) {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[data-pwa-install]'));
    const visible = element => !element.closest('[hidden]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
    const own = all.find(element => !element.closest('[data-pwa-floating]') && visible(element));
    const floating = all.find(element => element.closest('[data-pwa-floating]') && visible(element));
    const chosen = own || floating;
    if (!chosen) return null;
    chosen.setAttribute('data-pwa-test-target', '');
    return own ? 'own' : 'floating';
  });
}

for (const dir of APP_DIRS) {
  const folder = dir === '.' ? '/' : '/' + dir.replace(/^\/|\/$/g, '') + '/';
  const label = dir === '.' ? 'app' : dir;
  const shot = async (page, name) => { if (screenshots) await page.screenshot({ path: path.join(screenshots, label.replace(/\W+/g, '-') + '-' + name + '.png'), animations: 'disabled' }); };

  async function open(options = {}, initScript) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'allow', ...options });
    await context.route(/^https?:\/\/(?!localhost)/, route => route.abort());   // no internet: local files only
    if (initScript) await context.addInitScript(initScript);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { if (/pwa|PwaInstall|serviceWorker/i.test(error.message + error.stack)) errors.push(error.message); });
    await page.goto(base + folder, { waitUntil: 'load' });
    await page.waitForFunction(() => window.PwaInstall && document.readyState === 'complete');
    await page.waitForTimeout(1500);   // the installer's first look for the page's own controls
    await page.evaluate(() => window.PwaInstall.refresh());
    return { context, page, errors };
  }

  // 1–4. A computer running Chrome.
  {
    const { context, page, errors } = await open();
    const config = await page.evaluate(() => window.PwaInstall.config);
    const cdp = await context.newCDPSession(page);
    const { url, errors: manifestErrors, data } = await cdp.send('Page.getAppManifest');
    assert.ok(url.endsWith(folder + 'manifest.webmanifest'), label + ': manifest found at ' + url);
    assert.deepEqual(manifestErrors.filter(error => error.critical), [], label + ': the manifest parses cleanly');
    assert.equal(JSON.parse(data).name, config.appName, label + ': the served manifest is this app\'s');

    const registration = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      return { scope: ready.scope, script: ready.active && ready.active.scriptURL };
    });
    assert.equal(registration.scope, base + folder, label + ': the worker\'s scope is the app folder');
    assert.ok(registration.script.endsWith(folder + 'sw.js'));
    await page.reload({ waitUntil: 'load' });
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), label + ': the worker controls the page after a reload');
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installabilityErrors.map(error => error.errorId), [], label + ': Chrome finds the page installable');

    // 2. No connection → the offline page; back online → the real page.
    await context.setOffline(true);
    await page.goto(base + folder + '?offline-check', { waitUntil: 'load' });
    assert.equal((await page.textContent('h1')).trim(), "You're offline", label + ': offline page');
    assert.ok(await page.$eval('main img', image => image.complete && image.naturalWidth > 0), label + ': the offline page shows its icon with no connection');
    await shot(page, 'offline');
    await context.setOffline(false);
    await page.goto(base + folder, { waitUntil: 'load' });
    await page.waitForFunction(() => window.PwaInstall);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.PwaInstall.refresh());

    // 3. Something to press.
    const which = await visibleControl(page);
    assert.ok(which, label + ': an Install app control is on screen');
    console.log(`  ${label}: install control = ${which}`);
    await shot(page, 'desktop');

    // 4a. No prompt yet → the steps for Chrome on a computer.
    await page.click('[data-pwa-test-target]');
    await page.waitForSelector('.pwa-sheet[role="dialog"]');
    const steps = await page.$$eval('.pwa-sheet li', items => items.map(item => item.textContent));
    assert.ok(steps[0].includes('address bar'), label + ': Chrome desktop steps: ' + steps[0]);
    assert.ok((await page.textContent('.pwa-sheet h2')).includes(config.appName), label + ': the card names the app');
    await shot(page, 'desktop-steps');
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.pwa-sheet'), null, label + ': Escape closes the card');

    // 4b. With the browser's prompt available, the button uses it, then hides.
    const outcome = await page.evaluate(async () => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      let prompted = 0;
      event.prompt = () => { prompted++; return Promise.resolve(); };
      event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
      window.dispatchEvent(event);
      const ready = document.querySelector('[data-pwa-test-target]').getAttribute('data-pwa-ready');
      const result = await window.PwaInstall.install();
      return { prompted, defaultPrevented: event.defaultPrevented, ready, result };
    });
    assert.deepEqual(outcome, { prompted: 1, defaultPrevented: true, ready: 'prompt', result: 'accepted' }, label + ': the browser prompt is used');
    assert.equal(await page.$('.pwa-sheet'), null, label + ': no help card when the browser prompts');
    assert.equal(await visibleControl(page), null, label + ': accepted → every install control hides');
    assert.deepEqual(errors, [], label + ': no installer errors');
    await context.close();
  }

  // 5. iPhone Safari: Share → Add to Home Screen.
  {
    const { context, page, errors } = await open(IPHONE);
    const which = await visibleControl(page);
    assert.ok(which, label + ': an Install app control on the iPhone');
    await page.locator('[data-pwa-test-target]').scrollIntoViewIfNeeded();
    await page.tap('[data-pwa-test-target]');
    await page.waitForSelector('.pwa-sheet');
    const steps = await page.$$eval('.pwa-sheet li', items => items.map(item => item.textContent));
    assert.ok(steps[0].includes('Share'), label + ': starts at the Share button');
    assert.ok(steps.some(step => step.includes('Add to Home Screen')), label + ': Add to Home Screen');
    const box = await page.$eval('.pwa-sheet', element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, bottom: rect.bottom }; });
    assert.ok(box.left >= 0 && box.right <= 390 && box.bottom <= 844, label + ': the card fits the phone');
    await shot(page, 'iphone-steps');
    await page.click('.pwa-sheet-actions button');
    assert.equal(await page.$('.pwa-sheet'), null, label + ': Got it closes the card');
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 6. Opened from the iPhone home screen: no install control anywhere.
  {
    const { context, page, errors } = await open(IPHONE, () => Object.defineProperty(navigator, 'standalone', { get: () => true }));
    assert.equal(await visibleControl(page), null, label + ': nothing to install inside the installed app');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('pwa-standalone')));
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 7. The floating button can be put away, and stays away.
  {
    const { context, page } = await open();
    const forced = await page.evaluate(() => {
      // Hide the page's own controls so the floating one is the only way in.
      document.querySelectorAll('[data-pwa-install]').forEach(element => { if (!element.closest('[data-pwa-floating]')) element.style.setProperty('display', 'none', 'important'); });
      window.PwaInstall.refresh();
      const floating = document.querySelector('[data-pwa-floating]');
      return !!floating && !floating.hidden;
    });
    if (floatingEnabled(await page.evaluate(() => window.PwaInstall.config.floating))) {
      assert.ok(forced, label + ': the floating button appears when the page shows no control of its own');
      await shot(page, 'floating');
      await page.click('.pwa-fab-close');
      assert.ok(await page.evaluate(() => document.querySelector('[data-pwa-floating]').hidden), label + ': × hides it');
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.PwaInstall);
      await page.evaluate(() => {
        document.querySelectorAll('[data-pwa-install]').forEach(element => { if (!element.closest('[data-pwa-floating]')) element.style.setProperty('display', 'none', 'important'); });
        window.PwaInstall.refresh();
      });
      assert.ok(await page.evaluate(() => { const floating = document.querySelector('[data-pwa-floating]'); return !floating || floating.hidden; }), label + ': still hidden after a reload');
    }
    await context.close();
  }

  // 8. Inside another page's frame (Ans Key inside Polymath Online, say): no install controls at all.
  {
    // A second little server on another port hosts the outer page: another origin, like a real embed.
    const hostServer = http.createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><title>host</title><iframe id="embedded" src="${base + folder}" style="width:1000px;height:700px"></iframe>`);
    });
    await new Promise(resolve => hostServer.listen(0, '127.0.0.1', resolve));
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'allow' });
    await context.route(/^https?:\/\/(?!localhost)/, route => route.abort());
    const page = await context.newPage();
    await page.goto(`http://localhost:${hostServer.address().port}/`, { waitUntil: 'load' });
    const frame = await (await page.waitForSelector('#embedded')).contentFrame();
    await frame.waitForFunction(() => window.PwaInstall && document.readyState === 'complete');
    await frame.waitForTimeout(1500);
    const visibleInFrame = await frame.evaluate(() => {
      window.PwaInstall.refresh();
      return Array.from(document.querySelectorAll('[data-pwa-install]')).filter(element => !element.closest('[hidden]') && element.getClientRects().length > 0).length;
    });
    assert.equal(visibleInFrame, 0, label + ': no install control inside a frame');
    await context.close();
    hostServer.close();
  }

  console.log(`  ${label}: all install checks passed`);
}

function floatingEnabled(mode) { return mode !== 'never'; }

await browser.close();
server.close();
console.log('pwa-install-browser: all checks passed');
