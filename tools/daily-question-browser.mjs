// The Free Question of the Day in a real browser: /question (today, yesterday, the
// past week, sign-up, the confirm / unsubscribe / manage links, the admin list), the
// home page box and the emails, against the REAL dailyQuestion service running in
// this process on an in-memory Firestore. Nothing touches the live project.
//
//   node tools/daily-question-browser.mjs                 checks only
//   SHOTS=<dir> node tools/daily-question-browser.mjs     checks, and saves screenshots
//
// Needs Playwright with Chromium (pre-installed in the cloud sessions).
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { createHttp, hash } = require('../shop-function/functions/service.js');
const core = require('../shop-function/functions/daily-question-core.js');
const { createDailyQuestionStore } = require('../shop-function/functions/daily-question-store.js');
const { createDailyQuestionService } = require('../shop-function/functions/daily-question.js');
const { chromium } = require('playwright');

const SHOTS = process.env.SHOTS || '';
// Sunday 22 November 2026, 9:00 a.m. Singapore: two days in, so there is a yesterday and a past week.
let clock = Date.UTC(2026, 10, 22, 1, 0);
const ADMIN_TOKEN = 'browser-admin-token-0000000000';

/* ─── In-memory Firestore (nested collections, transactions) ─── */
function database() {
  const rows = new Map();
  const clone = v => (v === undefined ? undefined : structuredClone(v));
  const merge = (a, b) => Object.assign({}, a || {}, b);
  const snap = ref => ({ exists: rows.has(ref.path), id: ref.id, ref, data: () => clone(rows.get(ref.path)) });
  const kids = prefix => [...rows.keys()].filter(p => p.startsWith(prefix + '/') && p.slice(prefix.length + 1).split('/').length === 1);
  const doc = path => ({ path, id: path.split('/').at(-1), collection: name => col(path + '/' + name), get: async function () { return snap(this); },
    set: async (d, o) => { rows.set(path, clone(o && o.merge ? merge(rows.get(path), d) : d)); },
    create: async d => { if (rows.has(path)) { const e = new Error('exists'); e.code = 6; throw e; } rows.set(path, clone(d)); },
    update: async d => { rows.set(path, clone(merge(rows.get(path), d))); }, delete: async () => { rows.delete(path); } });
  const col = (path, order = null, max = Infinity) => ({ doc: id => doc(path + '/' + id), orderBy: (f, dir) => col(path, { f, dir }, max), limit: n => col(path, order, n),
    get: async () => {
      let docs = kids(path).map(p => snap(doc(p)));
      if (order) docs.sort((a, b) => (a.data()[order.f] < b.data()[order.f] ? -1 : 1) * (order.dir === 'desc' ? -1 : 1));
      docs = docs.slice(0, max);
      return { docs, empty: !docs.length };
    } });
  return {
    rows, collection: name => col(name), getAll: async (...refs) => refs.map(snap),
    runTransaction: async action => {
      const writes = [];
      const result = await action({ get: async r => snap(r), getAll: async (...r) => r.map(snap), set: (r, d, o) => writes.push([r, d, o, 'set']),
        create: (r, d) => writes.push([r, d, null, 'create']), update: (r, d) => writes.push([r, d, null, 'update']), delete: r => writes.push([r, null, null, 'delete']) });
      for (const [r, d, o, t] of writes) {
        if (t === 'delete') rows.delete(r.path);
        else if (t === 'update' || (o && o.merge)) rows.set(r.path, clone(merge(rows.get(r.path), d)));
        else rows.set(r.path, clone(d));
      }
      return result;
    }
  };
}

const db = database();
const store = createDailyQuestionStore(db, null);
const service = createDailyQuestionService({
  store, http: createHttp(() => {}), hashIp: hash, now: () => clock,
  verifyIdToken: async token => { if (token === ADMIN_TOKEN) return { email: 'admin@polymathlc.com.sg', email_verified: true }; throw new Error('bad'); }
});
async function callService(body, headers = {}) {
  const h = Object.assign({ origin: 'https://polymathlc.com.sg', 'content-type': 'application/json' }, headers);
  const req = { method: 'POST', body, ip: '192.0.2.9', query: {}, get: name => h[name.toLowerCase()] };
  const res = { status_: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.status_ = c; return this; },
    json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; }, type() { return this; }, redirect() { return this; } };
  await service.dailyQuestion(req, res);
  return res;
}
const mails = () => [...db.rows.entries()].filter(([p]) => p.startsWith('mail/')).map(([p, d]) => Object.assign({ id: p.slice(5) }, d));
const keyIn = (text, param) => new RegExp('[?]' + param + '=([0-9a-f]{24}\\.[A-Za-z0-9_-]{32})').exec(text)[1];

// Some real-looking subscribers for the admin list (all addresses are example.test).
async function seedSubscribers() {
  const people = [
    ['Mrs Lim', 'lim.family@example.test', 'P5', ['math', 'science'], 'daily'], ['Mr Tan', 'tan.kw@example.test', 'P6', ['math'], 'daily'],
    ['Mdm Wong', 'wong.home@example.test', 'P4', ['science'], 'weekly'], ['', 'parent.ng@example.test', 'P3', ['science'], 'daily'],
    ['Mrs Rajan', 'rajan.p@example.test', 'P6', ['math', 'science'], 'weekly']
  ];
  for (const [name, email, level, subjects, frequency] of people) {
    await callService({ action: 'subscribe', email, name, level, subjects, frequency, consent: true, source: 'home-page' }, { });
  }
  for (const m of mails().filter(m => m.polymathQotd.kind === 'confirm').slice(0, 4)) await callService({ action: 'confirm', key: keyIn(m.message.text, 'c') });
}

/* ─── A static server for the site, with the function answered in-process ─── */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(resolve => server.listen(0, resolve));
const BASE = 'http://127.0.0.1:' + server.address().port;

// A stand-in for the Firebase scripts: signed in as an admin when ?asAdmin is in the address.
const FIREBASE_STUB = `window.firebase = (function () {
  var admin = /asAdmin/.test(location.search);
  var user = admin ? { email: 'admin@polymathlc.com.sg', emailVerified: true, getIdToken: function () { return Promise.resolve(${JSON.stringify(ADMIN_TOKEN)}); } } : null;
  var a = { currentUser: user, onAuthStateChanged: function (cb) { setTimeout(function () { cb(user); }, 0); return function () {}; }, signOut: function () {}, signInWithPopup: function () { return Promise.reject({ code: 'auth/popup-closed-by-user' }); } };
  var f = { apps: [], initializeApp: function () { f.apps.push({}); }, auth: function () { return a; } };
  f.auth.GoogleAuthProvider = function () {};
  return f;
})();`;

const browser = await chromium.launch();
const problems = [];
async function newPage(viewport, isMobile = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1, isMobile, hasTouch: isMobile });
  const page = await context.newPage();
  // The home page's own Firebase modules are stubbed out here, so their import errors are expected.
  page.on('pageerror', error => { if (!/gstatic\.com\/firebasejs/.test(error.message)) problems.push('page error: ' + error.message); });
  await page.route('https://us-central1-mathgen--app.cloudfunctions.net/dailyQuestion', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    const result = await callService(JSON.parse(request.postData() || '{}'), request.headers().authorization ? { authorization: request.headers().authorization } : {});
    await route.fulfill({ status: result.status_, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(result.body) });
  });
  // One route for both scripts (Playwright tries the newest route first).
  await page.route(/gstatic\.com\/firebasejs\/.*\.js/, route => route.fulfill({ contentType: 'text/javascript',
    body: /firebase-app-compat\.js/.test(route.request().url()) ? FIREBASE_STUB : '' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  return page;
}
async function shot(page, name, options = {}) {
  if (!SHOTS) return;
  await page.screenshot(Object.assign({ path: join(SHOTS, name + '.png') }, options));
  console.log('saved ' + name + '.png');
}

if (SHOTS) await mkdir(SHOTS, { recursive: true });
const DESKTOP = { width: 1280, height: 900 }, PHONE = { width: 390, height: 844 };

// Visit days 1 and 2 so they are pinned, as the live site would.
clock -= 2 * 86400000; await callService({ action: 'today' });
clock += 86400000; await callService({ action: 'today' });
clock += 86400000;
await seedSubscribers();

/* 1. The page, desktop: today's question, then pick an answer. */
{
  const page = await newPage(DESKTOP);
  await page.goto(BASE + '/question/');
  await page.waitForSelector('#today-body .opt');
  const today = (await callService({ action: 'today' })).body;
  assert.equal(await page.textContent('#today-day'), today.questions.math.dayLabel);
  assert.ok((await page.textContent('#today-body')).includes(today.questions.math.q.split('\n')[0]));
  assert.equal(await page.locator('#today-body .working').count(), 0, 'no answer for today');
  await shot(page, 'page-desktop-today', { clip: { x: 0, y: 0, width: 1280, height: 900 } });
  await page.click('#today-body .opt >> nth=1');
  await page.waitForSelector('#today-body .locked');
  assert.match(await page.textContent('#today-body .locked'), /Locked in: B/);
  // Yesterday's answer, with the working.
  await page.waitForSelector('#yesterday-body .working');
  await page.locator('#yesterday').scrollIntoViewIfNeeded();
  await shot(page, 'page-desktop-yesterday-answer', { clip: await page.locator('#yesterday').boundingBox() });
  // Science tab.
  await page.click('#today .tab.science');
  assert.ok((await page.textContent('#today-body')).includes(today.questions.science.q.split('\n')[0]));
  // The past week.
  assert.equal(await page.locator('details.past').count(), 1);
  await page.close();
}

/* 2. The page on a phone, and signing up. */
{
  const page = await newPage(PHONE, true);
  await page.goto(BASE + '/question/');
  await page.waitForSelector('#today-body .opt');
  await shot(page, 'page-phone-today');
  await page.click('#today-body .opt >> nth=2');
  await page.locator('#today').scrollIntoViewIfNeeded();
  await shot(page, 'page-phone-locked-in', { clip: await page.locator('#today').boundingBox() });
  await page.locator('#join').scrollIntoViewIfNeeded();
  await page.fill('#j-email', 'new.parent@example.test');
  await page.fill('#j-name', 'Mrs Chua');
  await page.selectOption('#j-level', 'P5');
  await shot(page, 'page-phone-signup-form', { clip: await page.locator('#join').boundingBox() });
  await page.check('#j-consent');
  await page.click('#j-submit');
  await page.waitForSelector('#join-done:not(.hidden)');
  assert.equal(await page.textContent('#join-done-email'), 'new.parent@example.test');
  assert.ok(mails().some(m => m.to[0] === 'new.parent@example.test' && m.polymathQotd.kind === 'confirm'));
  await page.close();
}
{
  // Consent is required.
  const page = await newPage(PHONE, true);
  await page.goto(BASE + '/question/');
  await page.fill('#j-email', 'other.parent@example.test');
  await page.click('#j-submit');
  assert.match(await page.textContent('#j-error'), /tick the box/);
  await page.check('#j-consent');
  await page.click('#j-submit');
  await page.waitForSelector('#join-done:not(.hidden)');
  await page.locator('#join').scrollIntoViewIfNeeded();
  await shot(page, 'page-phone-signup-done', { clip: await page.locator('#join').boundingBox() });
  await page.close();
}

/* 3. The confirmation email, the link in it, the welcome email. */
const confirmMail = mails().find(m => m.to[0] === 'other.parent@example.test');
assert.ok(confirmMail, 'a confirmation email was queued');
const key = keyIn(confirmMail.message.text, 'c');
{
  const page = await newPage(PHONE, true);
  await page.goto(BASE + '/question/?c=' + key);
  await page.waitForSelector('.banner.ok');
  assert.match(await page.textContent('.banner.ok'), /You are in/);
  assert.equal(new URL(page.url()).search, '', 'the private link leaves the address bar');
  await shot(page, 'page-phone-confirmed');
  await page.close();
}
const welcome = mails().find(m => m.to[0] === 'other.parent@example.test' && m.polymathQotd.kind === 'welcome');
assert.ok(welcome, 'the welcome email was queued');

/* 4. Manage, unsubscribe. */
{
  const page = await newPage(DESKTOP);
  await page.goto(BASE + '/question/?m=' + key);
  await page.waitForSelector('#manage');
  await page.click('#m-frequency .chip[data-value=weekly]');
  await page.click('#m-save');
  await page.waitForTimeout(300);
  assert.equal(db.rows.get('trialSettings/dailyQuestion/subscribers/' + key.split('.')[0]).frequency, 'weekly');
  await shot(page, 'page-desktop-manage', { clip: { x: 0, y: 0, width: 1280, height: 700 } });
  await page.goto(BASE + '/question/?u=' + key);
  await page.waitForSelector('.banner.ok');
  assert.match(await page.textContent('.banner.ok'), /unsubscribed/);
  assert.equal(db.rows.get('trialSettings/dailyQuestion/subscribers/' + key.split('.')[0]).status, 'unsubscribed');
  await shot(page, 'page-desktop-unsubscribed', { clip: { x: 0, y: 0, width: 1280, height: 560 } });
  await page.click('#b-resub');
  await page.waitForSelector('.banner.ok >> text=Welcome back');
  await page.close();
}

/* 5. The admin list. */
{
  const page = await newPage(DESKTOP);
  await page.goto(BASE + '/question/?asAdmin=1#admin');
  await page.waitForSelector('#admin-section:not(.hidden) .sub-table');
  const rowsShown = await page.locator('.sub-table tbody tr').count();
  assert.ok(rowsShown >= 4, 'active subscribers are listed');
  await page.locator('#admin-section').scrollIntoViewIfNeeded();
  await shot(page, 'admin-desktop', { clip: await page.locator('#admin-section').boundingBox() });
  await page.selectOption('#a-filter', 'pending');
  assert.ok(await page.locator('.sub-table tbody tr').count() >= 1);
  await page.close();
}
{
  const page = await newPage(PHONE, true);
  await page.goto(BASE + '/question/?asAdmin=1#admin');
  await page.waitForSelector('#admin-section:not(.hidden) .sub-table');
  await page.locator('#admin-section').scrollIntoViewIfNeeded();
  await shot(page, 'admin-phone', { clip: await page.locator('#admin-section').boundingBox() });
  await page.close();
}

/* 6. The home page box. */
for (const [viewport, name, mobile] of [[DESKTOP, 'home-desktop', false], [PHONE, 'home-phone', true]]) {
  const page = await newPage(viewport, mobile);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
    const url = route.request().url();
    if (url.includes('cloudfunctions.net/dailyQuestion') || url.includes('gstatic.com/firebasejs')) return route.fallback();
    return route.abort();
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('#lp-qotd').scrollIntoViewIfNeeded();
  await page.waitForSelector('#lp-qotd .qd-opt', { timeout: 15000 });
  await page.click('#lp-qotd .qd-opt >> nth=0');
  await page.waitForSelector('#lp-qotd .qd-locked');
  await shot(page, name, { clip: await page.locator('#lp-qotd').boundingBox() });
  if (!mobile) {
    await page.fill('#qd-email', 'home.parent@example.test');
    await page.check('#lp-qotd [name=consent]');
    await page.click('#lp-qotd button[type=submit]');
    await page.waitForSelector('#lp-qotd .qd-done');
    assert.ok(mails().some(m => m.to[0] === 'home.parent@example.test'));
    assert.equal(db.rows.get('trialSettings/dailyQuestion/subscribers/' + core.subscriberId('home.parent@example.test')).source, 'home-page');
  }
  await page.close();
}

/* 7. The emails, as a mail app would show them. */
{
  const day = core.sgDayKey(clock);
  const sub = { id: 'a'.repeat(24), token: 'b'.repeat(32), email: 'lim.family@example.test', name: 'Mrs Lim', subjects: ['math', 'science'], frequency: 'daily', consent: { at: clock } };
  const stored = await store.getDays([day, core.addDays(day, -1), core.addDays(day, -2)]);
  const daily = core.dailyMail(sub, day, core.publicPair(day, stored[day], false), core.publicPair(core.addDays(day, -1), stored[core.addDays(day, -1)], true));
  const pages = { 'email-daily': daily.message.html, 'email-confirm': confirmMail.message.html };
  for (const [name, html] of Object.entries(pages)) {
    for (const [viewport, suffix, mobile] of [[{ width: 760, height: 1000 }, 'desktop', false], [PHONE, 'phone', true]]) {
      const page = await newPage(viewport, mobile);
      await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0">' + html + '</body>');
      await page.waitForTimeout(200);
      await shot(page, name + '-' + suffix, { fullPage: name === 'email-daily' && suffix === 'phone' ? true : false });
      await page.close();
    }
  }
  if (SHOTS) await writeFile(join(SHOTS, 'email-daily.html'), daily.message.html);
}

await browser.close();
server.close();
if (problems.length) { console.log(problems.join('\n')); process.exitCode = 1; }
else console.log('Question of the Day browser checks passed.');
