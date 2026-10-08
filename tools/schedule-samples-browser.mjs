// Exercise the shipped schedule page's Sample Materials tab in Chromium.
// Firebase and the external sample apps are stubbed: nothing is published,
// booked, uploaded or sent to a tutor. The frames retain an editable field so
// we can distinguish an intact practice session from a silently reloaded one.
//
// node tools/schedule-samples-browser.mjs
// SCHEDULE_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/schedule-samples-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.SCHEDULE_PLAYWRIGHT_MODULE || process.env.PW || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const shots = process.env.SCHEDULE_SCREENSHOTS || '';
if (shots) fs.mkdirSync(shots, { recursive: true });

const MATERIALS = {
  math: { questionIds: ['math-one', 'math-two'], worksheet: { title: 'Math worksheet', url: 'https://worksheets.invalid/math.pdf' } },
  science: { questionIds: ['science-one'], worksheet: { title: 'Science worksheet', url: 'https://worksheets.invalid/science.pdf' } }
};
const CONFIG = {
  trialTitle: 'Book a Trial Class', trialPrice: 30, monthlyFee: 240,
  slots: { 'MON-1': { level: 'P5', subject: 'Science', mode: 'Both', status: 'open', type: 'regular' } },
  sampleMaterials: MATERIALS
};

const FIREBASE_STUB = `(function () {
  var fx = window.__SCHEDULE_FIXTURE__ || {};
  var listeners = [];
  window.__store = { writes: [] };
  function later(fn) { setTimeout(fn, 0); }
  function snap(data) { return { exists: !!data, data: function () { return data; } }; }
  window.__emitScheduleConfig = function (materials) {
    fx.config.sampleMaterials = materials;
    listeners.forEach(function (cb) { cb(snap(fx.config)); });
  };
  function query() {
    var q = {
      orderBy: function () { return q; }, where: function () { return q; }, limit: function () { return q; },
      onSnapshot: function (cb) { later(function () { cb({ docs: [], forEach: function () {} }); }); return function () {}; },
      get: function () { return Promise.resolve({ docs: [], empty: true, forEach: function () {} }); }
    };
    return q;
  }
  function collection(name) {
    var q = query();
    q.doc = function (id) {
      return {
        id: id || 'doc',
        onSnapshot: function (cb) {
          if (name === 'schedule_config') {
            listeners.push(cb);
            if (!fx.deferConfig) later(function () { cb(snap(fx.config)); });
          } else later(function () { cb(snap(null)); });
          return function () {};
        },
        get: function () { return Promise.resolve(snap(name === 'schedule_config' ? fx.config : null)); },
        set: function (doc) { window.__store.writes.push(doc); return Promise.resolve(); },
        update: function (doc) { window.__store.writes.push(doc); return Promise.resolve(); },
        delete: function () { window.__store.writes.push('delete'); return Promise.resolve(); }
      };
    };
    q.add = function (doc) { window.__store.writes.push(doc); return Promise.resolve({ id: 'fake' }); };
    return q;
  }
  function firestore() { return { collection: collection }; }
  firestore.FieldValue = { serverTimestamp: function () { return '__server_time__'; }, increment: function (n) { return n; }, delete: function () { return null; } };
  function auth() { return {
    currentUser: null, onAuthStateChanged: function (cb) { later(function () { cb(null); }); return function () {}; },
    signOut: function () { return Promise.resolve(); }
  }; }
  auth.GoogleAuthProvider = function () {};
  function storage() { return { ref: function () { return {}; } }; }
  window.firebase = { initializeApp: function () {}, firestore: firestore, auth: auth, storage: storage, apps: [] };
})();`;
const QR_STUB = 'window.QRCode = function () {}; window.QRCode.CorrectLevel = { M: 0 };';
const FRAME_STUB = '<!doctype html><html><meta charset="utf-8"><title>Sample app fixture</title><body><main><h1>Interactive sample fixture</h1><label>Your working <input id="working"></label></main></body></html>';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(root, '.' + p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n' + (e && e.stack || e)); process.exitCode = 1; }
}

const frameSelector = subject => '#sample-subject-' + subject + ' iframe.sample-frame';
const demoButton = (subject, kind) => `[data-subject="${subject}"][data-demo="${kind}"]`;
async function waitForFrame(page, subject, kind = 'questions') {
  await page.waitForSelector(frameSelector(subject));
  const locator = page.locator(frameSelector(subject));
  const src = new URL(await locator.getAttribute('src'));
  assert.equal(src.searchParams.get('subject'), subject);
  assert.equal(src.pathname, kind === 'worksheet' ? '/tutor/sample.html' : `/${subject === 'science' ? 'cer' : 'math'}/sample-materials.html`);
  assert.equal(await locator.getAttribute('title'), `${subject === 'math' ? 'Math' : 'Science'} ${kind === 'worksheet' ? 'worksheet & live tutor' : 'sample questions'}`);
  await page.frameLocator(frameSelector(subject)).locator('#working').waitFor();
}
async function openPage({ hash = '', materials = MATERIALS, deferConfig = false, width = 1280 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const requests = [];
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    if (u.hostname === 'www.gstatic.com' && u.pathname.endsWith('/firebase-app-compat.js')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    if (u.hostname === 'www.gstatic.com') return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.includes('qrcode')) return route.fulfill({ contentType: 'text/javascript', body: QR_STUB });
    if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
    if (u.hostname === 'polymathlc.github.io' && ['/math/sample-materials.html', '/cer/sample-materials.html', '/tutor/sample.html'].includes(u.pathname)) {
      requests.push({ path: u.pathname, subject: u.searchParams.get('subject') });
      return route.fulfill({ contentType: 'text/html', body: FRAME_STUB });
    }
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(fixture => { window.__SCHEDULE_FIXTURE__ = fixture; }, { config: { ...CONFIG, sampleMaterials: materials }, deferConfig });
  await page.clock.setFixedTime(new Date('2026-10-08T10:00:00+08:00'));
  await page.goto(base + '/schedule/' + hash);
  await page.waitForFunction(() => !!window.SampleMaterials);
  if (!deferConfig) await page.waitForSelector('#sample-subject-math', { state: 'attached' });
  return { context, page, errors, requests };
}
async function assertClean(page, errors) {
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__store.writes), [], 'Browsing samples does not write to Firebase.');
}

try {
  await check('the schedule never preloads hidden question or tutor frames', async () => {
    const { context, page, errors, requests } = await openPage();
    assert.equal(await page.locator('.sample-frame').count(), 0);
    assert.deepEqual(requests, []);
    await page.evaluate(() => window.__emitScheduleConfig({ ...window.__SCHEDULE_FIXTURE__.config.sampleMaterials }));
    assert.equal(await page.locator('.sample-frame').count(), 0);
    assert.deepEqual(requests, []);
    await assertClean(page, errors);
    await context.close();
  });

  await check('clicking Sample Materials automatically opens Math and Science together', async () => {
    const { context, page, errors, requests } = await openPage();
    await page.click('.tab[data-tab="sample-materials"]');
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    assert.equal(await page.locator('.sample-frame').count(), 2);
    assert.deepEqual(requests.map(r => r.subject).sort(), ['math', 'science']);
    assert.equal(requests.filter(r => r.path.startsWith('/tutor/')).length, 0, 'Microphone/tutor work remains a deliberate worksheet action.');
    assert.equal(await page.getAttribute('.tab[data-tab="sample-materials"]', 'aria-selected'), 'true');
    if (shots) await page.screenshot({ path: path.join(shots, 'sample-materials-desktop.png'), fullPage: true });
    await assertClean(page, errors);
    await context.close();
  });

  await check('#sample-materials opens both question previews on first visit', async () => {
    const { context, page, errors, requests } = await openPage({ hash: '#sample-materials' });
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    assert.equal(await page.isVisible('#tab-sample-materials'), true);
    assert.equal(requests.length, 2);
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'Automatic loading does not scroll past the tab heading.');
    await assertClean(page, errors);
    await context.close();
  });

  await check('activating before publication arrives opens both previews when config loads', async () => {
    const { context, page, errors, requests } = await openPage({ deferConfig: true });
    await page.click('.tab[data-tab="sample-materials"]');
    assert.equal(await page.locator('.sample-frame').count(), 0);
    assert.deepEqual(requests, []);
    await page.evaluate(materials => window.__emitScheduleConfig(materials), MATERIALS);
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    assert.equal(requests.length, 2);
    await assertClean(page, errors);
    await context.close();
  });

  await check('an initial Sample Materials hash also waits for delayed config', async () => {
    const { context, page, errors, requests } = await openPage({ hash: '#sample-materials', deferConfig: true });
    assert.equal(await page.isVisible('#tab-sample-materials'), true);
    assert.equal(await page.locator('.sample-frame').count(), 0);
    await page.evaluate(materials => window.__emitScheduleConfig(materials), MATERIALS);
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    assert.equal(requests.length, 2);
    await assertClean(page, errors);
    await context.close();
  });

  await check('repeated activation and unchanged publication preserve in-progress answers', async () => {
    const { context, page, errors, requests } = await openPage({ hash: '#sample-materials' });
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    await page.frameLocator(frameSelector('science')).locator('#working').fill('My claim and evidence');
    await page.evaluate(() => { window.SampleMaterials.setActive(true); window.SampleMaterials.setActive(true); });
    await page.click('.tab[data-tab="sample-materials"]');
    await page.evaluate(materials => window.__emitScheduleConfig(materials), MATERIALS);
    assert.equal(await page.frameLocator(frameSelector('science')).locator('#working').inputValue(), 'My claim and evidence');
    assert.equal(requests.length, 2);
    await assertClean(page, errors);
    await context.close();
  });

  await check('Close demo removes only that subject and explicit Try questions reopens it', async () => {
    const { context, page, errors, requests } = await openPage({ hash: '#sample-materials' });
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    await page.frameLocator(frameSelector('science')).locator('#working').fill('Keep my science answer');
    await page.click('#sample-subject-math .sample-embed-toolbar button');
    assert.equal(await page.locator(frameSelector('math')).count(), 0);
    assert.equal(await page.frameLocator(frameSelector('science')).locator('#working').inputValue(), 'Keep my science answer');
    await page.evaluate(() => window.SampleMaterials.setActive(true));
    assert.equal(await page.locator(frameSelector('math')).count(), 0, 'An already-active call respects Close demo.');
    await page.click(demoButton('math', 'questions'));
    await waitForFrame(page, 'math');
    assert.equal(requests.length, 3);
    await assertClean(page, errors);
    await context.close();
  });

  await check('a live publication change refreshes only its subject and preserves the other session', async () => {
    const { context, page, errors, requests } = await openPage({ hash: '#sample-materials' });
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    await page.frameLocator(frameSelector('science')).locator('#working').fill('Science answer survives a new Math sample');
    await page.evaluate(materials => window.__emitScheduleConfig(materials), {
      ...MATERIALS, math: { ...MATERIALS.math, questionIds: ['math-new'] }
    });
    await waitForFrame(page, 'math');
    assert.match(await page.textContent('#sample-subject-math'), /1 sample question ready to try/);
    assert.equal(await page.frameLocator(frameSelector('science')).locator('#working').inputValue(), 'Science answer survives a new Math sample');
    assert.equal(requests.filter(r => r.subject === 'science').length, 1);
    assert.equal(requests.filter(r => r.subject === 'math').length, 2);
    await page.click(demoButton('math', 'worksheet'));
    await waitForFrame(page, 'math', 'worksheet');
    await page.frameLocator(frameSelector('math')).locator('#working').fill('Worksheet annotations survive a new Science sample');
    await page.evaluate(() => window.__emitScheduleConfig({
      ...window.__SCHEDULE_FIXTURE__.config.sampleMaterials,
      science: { ...window.__SCHEDULE_FIXTURE__.config.sampleMaterials.science, questionIds: ['science-new'] }
    }));
    await waitForFrame(page, 'science');
    await waitForFrame(page, 'math', 'worksheet');
    assert.equal(await page.frameLocator(frameSelector('math')).locator('#working').inputValue(), 'Worksheet annotations survive a new Science sample');
    assert.equal(requests.filter(r => r.path.startsWith('/tutor/')).length, 1);
    await assertClean(page, errors);
    await context.close();
  });

  await check('publishing another subject respects an explicitly closed preview', async () => {
    const { context, page, errors, requests } = await openPage({ hash: '#sample-materials' });
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    await page.click('#sample-subject-math .sample-embed-toolbar button');
    await page.evaluate(materials => window.__emitScheduleConfig(materials), {
      ...MATERIALS, science: { ...MATERIALS.science, questionIds: ['science-new'] }
    });
    await waitForFrame(page, 'science');
    assert.equal(await page.locator(frameSelector('math')).count(), 0, 'An unchanged, explicitly closed preview stays closed.');
    assert.equal(requests.filter(r => r.subject === 'math').length, 1);
    await page.click('.tab[data-tab="schedule"]');
    await page.click('.tab[data-tab="sample-materials"]');
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    assert.equal(requests.filter(r => r.subject === 'math').length, 2, 'A fresh tab visit automatically opens all published previews.');
    await assertClean(page, errors);
    await context.close();
  });

  await check('leaving the tab closes every frame and returning reloads question previews', async () => {
    const { context, page, errors, requests } = await openPage({ hash: '#sample-materials' });
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    await page.click('.tab[data-tab="products"]');
    assert.equal(await page.locator('.sample-frame').count(), 0);
    assert.equal(await page.isVisible('#tab-sample-materials'), false);
    await page.click('.tab[data-tab="sample-materials"]');
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    assert.equal(requests.length, 4);
    await page.click('.tab[data-tab="schedule"]');
    assert.equal(await page.locator('.sample-frame').count(), 0);
    await assertClean(page, errors);
    await context.close();
  });

  await check('unpublished questions stay disabled and published updates auto-load only available subjects', async () => {
    const empty = { math: { worksheet: MATERIALS.math.worksheet }, science: { questionIds: [] } };
    const { context, page, errors, requests } = await openPage({ hash: '#sample-materials', materials: empty });
    assert.equal(await page.locator('.sample-frame').count(), 0);
    assert.equal(await page.isDisabled(demoButton('math', 'questions')), true);
    assert.equal(await page.isDisabled(demoButton('science', 'questions')), true);
    assert.equal(await page.isDisabled(demoButton('math', 'worksheet')), false);
    assert.deepEqual(requests, []);
    await page.evaluate(materials => window.__emitScheduleConfig(materials), { math: MATERIALS.math });
    await waitForFrame(page, 'math');
    assert.equal(await page.locator(frameSelector('science')).count(), 0);
    await page.evaluate(materials => window.__emitScheduleConfig(materials), MATERIALS);
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    await page.evaluate(() => window.__emitScheduleConfig({}));
    assert.equal(await page.locator('.sample-frame').count(), 0, 'Unpublishing removes the active previews.');
    assert.equal(await page.isDisabled(demoButton('science', 'questions')), true);
    await assertClean(page, errors);
    await context.close();
  });

  await check('worksheet sessions start only by request and replace only their own subject', async () => {
    const { context, page, errors, requests } = await openPage({ hash: '#sample-materials' });
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    await page.frameLocator(frameSelector('science')).locator('#working').fill('Keep science while using Math worksheet');
    assert.equal(requests.filter(r => r.path.startsWith('/tutor/')).length, 0);
    await page.click(demoButton('math', 'worksheet'));
    await waitForFrame(page, 'math', 'worksheet');
    assert.equal(await page.locator('.sample-frame').count(), 2);
    assert.equal(await page.frameLocator(frameSelector('science')).locator('#working').inputValue(), 'Keep science while using Math worksheet');
    assert.deepEqual(requests.filter(r => r.path.startsWith('/tutor/')), [{ path: '/tutor/sample.html', subject: 'math' }]);
    await page.evaluate(() => window.SampleMaterials.setActive(true));
    await waitForFrame(page, 'math', 'worksheet');
    assert.equal(requests.length, 3);
    await page.click('.tab[data-tab="schedule"]');
    assert.equal(await page.locator('.sample-frame').count(), 0);
    await page.click('.tab[data-tab="sample-materials"]');
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    assert.equal(requests.filter(r => r.path.startsWith('/tutor/')).length, 1, 'Returning does not automatically start the tutor.');
    await assertClean(page, errors);
    await context.close();
  });

  await check('phone: automatically loaded subject previews fit the page', async () => {
    const { context, page, errors } = await openPage({ hash: '#sample-materials', width: 390 });
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    const dimensions = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth,
      frames: [...document.querySelectorAll('.sample-frame')].map(frame => ({ left: frame.getBoundingClientRect().left, right: frame.getBoundingClientRect().right })) }));
    assert.ok(dimensions.page <= dimensions.width, 'Sample previews do not force horizontal page scrolling.');
    for (const frame of dimensions.frames) assert.ok(frame.left >= 0 && frame.right <= dimensions.width);
    if (shots) await page.screenshot({ path: path.join(shots, 'sample-materials-phone.png'), fullPage: true });
    await assertClean(page, errors);
    await context.close();
  });

  await check('leaving the document removes every active frame', async () => {
    const { context, page, errors } = await openPage({ hash: '#sample-materials' });
    await waitForFrame(page, 'math');
    await waitForFrame(page, 'science');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await page.locator('.sample-frame').count(), 0);
    await assertClean(page, errors);
    await context.close();
  });
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${passed} schedule sample-materials browser checks passed` + (process.exitCode ? ' — and some FAILED.' : '.'));
