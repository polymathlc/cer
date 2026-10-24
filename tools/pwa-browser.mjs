// 📲 Installable app, in a real Chromium: serves the repository locally and checks
// what a visitor gets — Chrome reads the manifest and finds the page installable,
// sw.js takes control, the offline page appears with no connection, the
// "Install the app" control shows step-by-step help where there is no prompt
// (an iPhone, Safari), uses the browser's prompt where there is one, and hides
// itself inside the installed app. Run after touching sw.js, pwa-install.js,
// manifest.webmanifest or the icons:
//   PW=/path/to/playwright/index.mjs node tools/pwa-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
// "localhost" (not 127.0.0.1) is a secure context for service workers in every browser.
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const shots = process.env.PWA_SCREENSHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

async function open(options = {}, initScript) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'allow', ...options });
  // Offline from the internet: only the local files load (Firebase etc. fail, which the landing page survives).
  await context.route(/^https?:\/\/(?!localhost)/, r => r.abort());
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => { if (/pwa|PwaInstall|serviceWorker/i.test(e.message + e.stack)) errors.push(e.message); });
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.PwaInstall && document.readyState === 'complete');
  return { context, page, errors };
}
const footerLink = '#landingPage .lp-footer [data-pwa-install]';
const shown = (page, sel) => page.$eval(sel, el => getComputedStyle(el).display !== 'none');

// 1. Chrome reads the manifest and sees an installable app; the worker takes control.
{
  const { context, page, errors } = await open();
  const cdp = await context.newCDPSession(page);
  const { url, errors: manifestErrors, data } = await cdp.send('Page.getAppManifest');
  assert.ok(url.endsWith('/manifest.webmanifest'), 'manifest found: ' + url);
  assert.deepEqual(manifestErrors.filter(e => e.critical), [], 'manifest parses cleanly');
  assert.equal(JSON.parse(data).name, 'Polymath Learning Centre', 'the served manifest is ours');
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, script: r.active && r.active.scriptURL };
  });
  assert.equal(reg.scope, base + '/', 'worker scope is the app folder');
  assert.ok(reg.script.endsWith('/sw.js'));
  await page.reload({ waitUntil: 'load' });
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the worker controls the page after a reload');
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors.map(e => e.errorId), [], 'Chrome finds the page installable');
  const cached = await page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('polymath-app-shell-')));
  assert.equal(cached.length, 1, 'one versioned cache');

  // 2. Scripts and styles still come straight from the network (the worker never answers them).
  const appJsViaSw = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => /app\.js/.test(e.name)).map(e => e.workerStart > 0 && e.deliveryType === 'cache'));
  assert.ok(!appJsViaSw.includes(true), 'app.js is never served from the worker cache');

  // 3. No connection → the offline page, then back online → the real page.
  await context.setOffline(true);
  await page.goto(`${base}/index.html?offline-check`, { waitUntil: 'load' });
  assert.equal(await page.textContent('h1'), "You're offline");
  if (shots) await page.screenshot({ path: path.join(shots, 'offline.png') });
  await context.setOffline(false);
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  assert.ok(await page.$('#landingPage'), 'online again: the real page');

  // 4. Desktop Chrome with no prompt yet → the help card for Chrome on a computer.
  await page.waitForFunction(() => window.PwaInstall);
  assert.ok(await shown(page, footerLink), 'the home page offers Install the app');
  await page.click(footerLink);
  await page.waitForSelector('.pwa-sheet[role="dialog"]');
  const desktop = await page.$$eval('.pwa-sheet li', li => li.map(x => x.textContent));
  assert.ok(desktop[0].includes('address bar'), 'Chrome desktop steps: ' + desktop[0]);
  assert.ok(!page.url().includes('#install-app'), 'the link does not jump the page');
  if (shots) await page.screenshot({ path: path.join(shots, 'desktop-steps.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  assert.equal(await page.$('.pwa-sheet'), null, 'Escape closes the card');

  // 5. With the browser's prompt available, the button uses it.
  const outcome = await page.evaluate(async () => {
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    let prompted = 0;
    ev.prompt = () => { prompted++; return Promise.resolve(); };
    ev.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    window.dispatchEvent(ev);
    const ready = document.querySelector('[data-pwa-install]').getAttribute('data-pwa-ready');
    const result = await window.PwaInstall.install();
    return { prompted, defaultPrevented: ev.defaultPrevented, ready, result };
  });
  assert.deepEqual(outcome, { prompted: 1, defaultPrevented: true, ready: 'prompt', result: 'accepted' });
  assert.equal(await page.$('.pwa-sheet'), null, 'no help card when the browser prompts');
  assert.equal(await shown(page, footerLink), false, 'accepted → the control hides');
  assert.deepEqual(errors, []);
  await context.close();
}

// 6. iPhone Safari: no prompt exists, so the Share → Add to Home Screen steps.
{
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const { context, page, errors } = await open(iphone);
  assert.ok(await shown(page, footerLink));
  await page.$eval(footerLink, el => el.scrollIntoView());
  await page.tap(footerLink);
  await page.waitForSelector('.pwa-sheet');
  const steps = await page.$$eval('.pwa-sheet li', li => li.map(x => x.textContent));
  assert.ok(steps[0].includes('Share'), 'starts at the Share button');
  assert.ok(steps.some(s => s.includes('Add to Home Screen')));
  const box = await page.$eval('.pwa-sheet', el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; });
  assert.ok(box.left >= 0 && box.right <= 390 && box.bottom <= 844, 'the card fits the phone');
  if (shots) await page.screenshot({ path: path.join(shots, 'iphone-steps.png'), animations: 'disabled' });
  await page.click('.pwa-sheet button');
  assert.equal(await page.$('.pwa-sheet'), null, 'Got it closes the card');
  assert.deepEqual(errors, []);
  await context.close();
}

// 7. Opened from the iPhone home screen (navigator.standalone): no install control anywhere.
{
  const { context, page, errors } = await open({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    () => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  assert.equal(await shown(page, footerLink), false, 'hidden inside the installed app');
  assert.equal(await page.$eval('.nav-install', el => getComputedStyle(el).display), 'none', 'sidebar control hidden too');
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('pwa-standalone')));
  assert.deepEqual(errors, []);
  await context.close();
}

await browser.close();
server.close();
console.log('pwa-browser: all checks passed');
