// The Free Question of the Day in a real browser: /question (today at a chosen level,
// a typed answer marked by a stand-in for Chung GPT, yesterday, the past week, sign-up,
// the confirm / unsubscribe / manage links, the admin list and its 7-day preview with
// Skip and Restore), the home page box and the emails, against the REAL dailyQuestion
// service running in this process on an in-memory Firestore, with a question pool
// seeded the way the prepare run fills it. Nothing touches the live project.
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
  const col = (path, order = null, max = Infinity, filters = []) => ({ doc: id => doc(path + '/' + id),
    orderBy: (f, dir) => col(path, { f, dir }, max, filters), limit: n => col(path, order, n, filters),
    where: (f, op, v) => col(path, order, max, filters.concat([[f, op, v]])),
    get: async () => {
      let docs = kids(path).map(p => snap(doc(p)));
      docs = docs.filter(d => filters.every(([f, op, v]) => op === '==' ? d.data()[f] === v : op === 'in' ? v.includes(d.data()[f]) : true));
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
// A stand-in for Chung GPT's marking: right when the answer has the key number,
// nearly there when it has a number, else not yet. Never gives the answer away.
const aiCalls = [];
const ai = {
  async ask(prompt, options) {
    aiCalls.push(options && options.system ? 'mark' : 'other');
    const typed = (/The child's answer: (.*)$/m.exec(prompt) || [, ''])[1];
    if (/\b26\b/.test(typed)) return { verdict: 'correct', feedback: 'Well done! You added all four sides and kept the units.' };
    if (/\d/.test(typed)) return { verdict: 'partial', feedback: 'Good start. Check that you added every side of the rectangle, not just two of them.' };
    return { verdict: 'wrong', feedback: 'Have another look at what the question asks for. Which sides make up the distance all the way round?' };
  }
};
const service = createDailyQuestionService({
  store, http: createHttp(() => {}), hashIp: hash, now: () => clock, ai,
  verifyIdToken: async token => { if (token === ADMIN_TOKEN) return { email: 'admin@polymathlc.com.sg', email_verified: true }; throw new Error('bad'); }
});
async function callPicture(query) {
  const req = { method: 'GET', body: null, ip: '192.0.2.9', query, get: () => undefined };
  const res = { status_: 200, headers: {}, contentType: 'text/plain', set(k, v) { this.headers[k] = v; return this; }, status(c) { this.status_ = c; return this; },
    json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; }, type(t) { this.contentType = t; return this; }, redirect() { return this; } };
  await service.dailyQuestion(req, res);
  return res;
}
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

/* ─── A question pool, as the prepare run leaves it ─── */
// The picture is drawn here (a rectangle with its labels), the way a cropped worksheet
// figure looks: white, the figure only, no question text.
const canvasRequire = createRequire(join(ROOT, 'rapid-import/functions/noop.js'));
const { createCanvas } = canvasRequire('@napi-rs/canvas');
function rectanglePicture() {
  const c = createCanvas(720, 420), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 720, 420);
  g.strokeStyle = '#111'; g.lineWidth = 4; g.strokeRect(110, 70, 500, 280);
  g.fillStyle = '#111'; g.font = 'bold 30px sans-serif';
  g.fillText('A', 78, 66); g.fillText('B', 620, 66); g.fillText('C', 620, 382); g.fillText('D', 78, 382);
  g.font = '28px sans-serif'; g.fillText('8 cm', 325, 52); g.fillText('5 cm', 625, 220);
  return { data: c.toBuffer('image/jpeg', 90).toString('base64'), w: 720, h: 420 };
}
async function seedPool() {
  const pic = rectanglePicture();
  const items = [
    { source: 'anskey', subject: 'math', level: 'P5', topic: 'Perimeter', group: 'g1',
      q: 'The figure shows a rectangle ABCD. AB is 8 cm and BC is 5 cm.\nWhat is the perimeter of the rectangle ABCD?',
      answerType: 'number', answer: '26 cm', accepted: ['26'], model: '26 cm',
      steps: ['A rectangle has two lengths of 8 cm and two breadths of 5 cm.', 'Perimeter = 8 + 5 + 8 + 5 = 26 cm'], idea: 'The perimeter is the distance all the way round a figure.',
      images: [{ alt: 'Rectangle ABCD with AB = 8 cm and BC = 5 cm' }], origin: { label: 'P5 Maths worksheet 12', page: 2, number: '4(a)' } },
    { source: 'anskey', subject: 'math', level: 'P5', topic: 'Area', group: 'g1',
      q: 'The figure shows a rectangle ABCD. AB is 8 cm and BC is 5 cm.\nWhat is the area of the rectangle ABCD?',
      answerType: 'number', answer: '40 cm²', accepted: ['40', '40 cm2'], model: '40 cm²',
      steps: ['Area of a rectangle = length × breadth', '= 8 × 5 = 40 cm²'], idea: 'Area is length times breadth, in square units.',
      images: [{ alt: 'Rectangle ABCD with AB = 8 cm and BC = 5 cm' }], origin: { label: 'P5 Maths worksheet 12', page: 2, number: '4(b)' } },
    { source: 'cer', subject: 'science', level: 'P5', topic: 'Water cycle',
      q: 'Ali left a glass of ice water on the table. After a few minutes, water droplets formed on the outside of the glass.\nExplain how the water droplets formed.',
      answerType: 'explain', answer: 'Warm water vapour in the air touched the cold glass, lost heat and condensed into water droplets.',
      model: 'Water vapour in the surrounding air came into contact with the cold outer surface of the glass. It lost heat to the glass and condensed into water droplets.',
      keywords: ['water vapour', 'lost heat', 'condensed'], steps: ['The ice water makes the outer surface of the glass cold.', 'Water vapour in the warmer air touches it and loses heat.', 'It condenses into tiny water droplets.'],
      idea: 'Condensation: water vapour loses heat and changes into liquid water.', images: [], origin: { label: 'CER Science bank', page: 0, number: '' } },
    { source: 'anskey', subject: 'science', level: 'P4', topic: 'Magnets',
      q: 'Mei Ling placed a magnet near a steel paper clip, a copper coin and a plastic ruler.\nWhich object was attracted to the magnet? Give a reason.',
      answerType: 'explain', answer: 'The steel paper clip, because steel is a magnetic material.', model: 'The steel paper clip. Steel is a magnetic material, so it is attracted to a magnet.',
      keywords: ['steel', 'magnetic material'], steps: ['Only magnetic materials are attracted to magnets.', 'Steel is magnetic; copper and plastic are not.'],
      idea: 'Iron, steel, nickel and cobalt are magnetic materials.', images: [], origin: { label: 'P4 Science worksheet 7', page: 3, number: '2' } }
  ];
  // Its options were printed as a table on the paper (option-table.js draws them as one).
  items.push({ source: 'cer', subject: 'science', level: 'P6', topic: 'Seed dispersal', kind: 'mcq',
    q: 'The table shows the characteristics of fruits X, Y and Z. The diagram shows their dispersal patterns. Which option correctly matches each fruit to the shapes representing its parent plant and young plants in the diagram?',
    options: ['Circle: X; triangle: Y; square: Z', 'Circle: Y; triangle: Z; square: X', 'Circle: Z; triangle: X; square: Y', 'Circle: Y; triangle: X; square: Z'], answerIndex: 4,
    model: 'Y is dispersed by water, X by wind and Z by animals.', steps: ['Y has a fibrous husk, so it floats and is dispersed by water.', 'X has wing-like structures, so it is dispersed by wind.'],
    idea: 'The way a fruit is dispersed matches its characteristics.', images: [{ alt: 'Dispersal of fruits X, Y and Z' }], origin: { label: 'CER Science bank', page: 0, number: '' } });
  const queue = core.pool.emptyQueue();
  for (const [n, raw] of items.entries()) {
    const id = core.pool.itemId(raw.source, 'browser-' + n);
    const pictures = raw.images.map((img, k) => Object.assign({ id: core.pool.imageId(id, k), mime: 'image/jpeg' }, pic));
    const item = Object.assign(core.pool.cleanItem(Object.assign({}, raw, { id, images: raw.images.map((img, k) => ({ id: pictures[k].id, w: pic.w, h: pic.h, alt: img.alt })) })),
      { status: 'ready', group: raw.group || id, origin: raw.origin, check: { score: 5, solvedAnswer: raw.answer }, createdAt: clock });
    await store.savePoolItem(item, pictures);
    queue[item.subject][item.level].push(id);
  }
  await store.saveQueue(queue, clock);
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
  await page.route(/^https:\/\/us-central1-mathgen--app\.cloudfunctions\.net\/dailyQuestion(\?.*)?$/, async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      const query = Object.fromEntries(new URL(request.url()).searchParams);
      const result = await callPicture(query);
      return route.fulfill({ status: result.status_, contentType: result.contentType, body: result.body });
    }
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
await seedPool();
await seedSubscribers();

/* 1. The page, desktop: today's question, then pick an answer. */
{
  const page = await newPage(DESKTOP);
  await page.goto(BASE + '/question/');
  await page.waitForSelector('#today-body .answer-box textarea');
  const today = (await callService({ action: 'today', level: 'P5' })).body;
  assert.equal(today.questions.math.kind, 'open', "today's P5 Maths is the worksheet question");
  assert.equal(await page.textContent('#today-day'), today.questions.math.dayLabel);
  assert.ok((await page.textContent('#today-body')).includes('What is the perimeter of the rectangle ABCD?'));
  assert.equal(await page.locator('#today-body .working').count(), 0, 'no answer for today');
  // The picture loads from the function, for today only.
  await page.waitForFunction(() => { const img = document.querySelector('#today-body .q-figs img'); return img && img.complete && img.naturalWidth > 0; });
  await shot(page, 'page-desktop-today', { clip: { x: 0, y: 0, width: 1280, height: 900 } });
  // A partly right answer: Chung GPT says nearly there, with a hint and no answer.
  await page.fill('#today-body textarea', '13 cm');
  await page.click('#today-body [data-check]');
  await page.waitForSelector('#today-body .mark.partial');
  assert.doesNotMatch(await page.textContent('#today-body .mark'), /26/);
  // Then the right answer, typed exactly: checked against the key, no AI call.
  const callsBefore = aiCalls.length;
  await page.fill('#today-body textarea', '26 cm');
  await page.click('#today-body [data-check]');
  await page.waitForSelector('#today-body .mark.correct');
  assert.equal(aiCalls.length, callsBefore, 'an exact answer needs no AI');
  await page.locator('#today').scrollIntoViewIfNeeded();
  await shot(page, 'page-desktop-marked', { clip: await page.locator('#today').boundingBox() });
  // A P3 child: there is no P3 Maths question in the pool, and the bank has no P3
  // Maths, so nothing above P3 is ever shown.
  await page.click('#level-pick .lvl[data-level=P3]');
  await page.waitForFunction(() => !document.querySelector('#today-body .spin'));
  const p3 = (await callService({ action: 'today', level: 'P3' })).body;
  if (p3.questions.math) assert.ok(['P3'].includes(p3.questions.math.level), 'never above P3');
  await page.locator('#today').scrollIntoViewIfNeeded();
  await shot(page, 'page-desktop-p3', { clip: await page.locator('#today').boundingBox() });
  // P6 on a multiple-choice day: the Science question is a picture MCQ.
  await page.click('#level-pick .lvl[data-level=P6]');
  await page.click('#today .tab.science');
  await page.waitForSelector('#today-body .opt');
  await page.waitForFunction(() => { const img = document.querySelector('#today-body .q-figs img'); return img && img.complete && img.naturalWidth > 0; });
  assert.equal(await page.locator('#today-body .opt').count(), 4);
  // Options printed as a table show as a table: the printed headings, then one row each.
  assert.deepEqual(await page.locator('#today-body .ot-head span').allTextContents(), ['', 'Circle', 'Triangle', 'Square']);
  assert.deepEqual(await page.locator('#today-body .opt >> nth=3').locator('.ot-cell').allTextContents(), ['Y', 'X', 'Z']);
  await page.click('#today-body .opt >> nth=3');
  await page.waitForSelector('#today-body .locked');
  await page.locator('#today').scrollIntoViewIfNeeded();
  await shot(page, 'page-desktop-picture-mcq', { clip: await page.locator('#today').boundingBox() });
  await page.click('#today .tab.math');
  await page.click('#level-pick .lvl[data-level=P5]');
  await page.waitForSelector('#today-body .answer-box textarea, #today-body .mark');
  // Yesterday's answer, with the working.
  await page.waitForSelector('#yesterday-body .working');
  await page.locator('#yesterday').scrollIntoViewIfNeeded();
  await shot(page, 'page-desktop-yesterday-answer', { clip: await page.locator('#yesterday').boundingBox() });
  // Science tab.
  await page.click('#today .tab.science');
  assert.ok((await page.textContent('#today-body')).includes('water droplets formed'));
  // The past week.
  assert.equal(await page.locator('details.past').count(), 1);
  await page.close();
}

/* 2. The page on a phone, and signing up. */
{
  const page = await newPage(PHONE, true);
  await page.goto(BASE + '/question/');
  await page.waitForSelector('#today-body .answer-box textarea');
  await page.waitForFunction(() => { const img = document.querySelector('#today-body .q-figs img'); return img && img.complete && img.naturalWidth > 0; });
  await shot(page, 'page-phone-today');
  await page.fill('#today-body textarea', 'I added 8 and 5');
  await page.click('#today-body [data-check]');
  await page.waitForSelector('#today-body .mark');
  await page.locator('#today').scrollIntoViewIfNeeded();
  await shot(page, 'page-phone-marked', { clip: await page.locator('#today').boundingBox() });
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
  assert.match(await page.textContent('#j-error'), /level/i, 'a level is required');
  await page.selectOption('#j-level', 'P4');
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
  // The 7-day preview at P5: today's worksheet question, then tomorrow's (part b).
  await page.waitForSelector('.pv-day');
  assert.equal(await page.locator('.pv-day').count(), 7);
  assert.match(await page.textContent('.pv-day >> nth=0'), /perimeter/);
  assert.match(await page.textContent('.pv-day >> nth=1'), /area of the rectangle/);
  // Pictures load by themselves, with no click.
  await page.waitForSelector('.pv-day >> nth=1 >> .pv-q img');
  const preview = page.locator('.pv-day >> nth=1');
  await preview.scrollIntoViewIfNeeded();
  await shot(page, 'admin-preview-day', { clip: await preview.boundingBox() });
  // Skip tomorrow's: it leaves the preview and the queue, and can be restored.
  await page.click('.pv-day >> nth=1 >> [data-skip]');
  await page.click('.pv-day >> nth=1 >> [data-skip]');
  await page.waitForSelector('[data-restore]');
  assert.doesNotMatch(await page.textContent('.pv-day >> nth=1'), /area of the rectangle/);
  await page.locator('[data-restore]').scrollIntoViewIfNeeded();
  await shot(page, 'admin-skipped', { clip: await page.locator('[data-restore] >> xpath=../..').boundingBox() });
  await page.click('[data-restore]');
  await page.waitForFunction(() => !document.querySelector('[data-restore]'));
  // The P4 tab: the P4 Science magnet question, and the bank for Maths.
  await page.click('[data-admin-level=P4]');
  assert.match(await page.textContent('.pv-day >> nth=0'), /magnet/);
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
  await page.waitForSelector('#lp-qotd .qd-answer', { timeout: 15000 });
  await page.waitForFunction(() => { const img = document.querySelector('#lp-qotd .qd-fig img'); return img && img.complete && img.naturalWidth > 0; });
  await page.fill('#lp-qotd .qd-answer', '26');
  await page.click('#lp-qotd .qd-check');
  await page.waitForSelector('#lp-qotd .qd-mark.correct');
  await shot(page, name, { clip: await page.locator('#lp-qotd').boundingBox() });
  // A P4 visitor gets the P4 Science question, and no Maths above P4.
  await page.click('#lp-qotd .qd-lvl[data-l=P4]');
  await page.waitForSelector('#lp-qotd .qd-q');
  if (!mobile) {
    await page.click('#lp-qotd .qd-tab.science');
    assert.match(await page.textContent('#lp-qotd .qd-q'), /magnet/);
    await page.fill('#qd-email', 'home.parent@example.test');
    await page.selectOption('#qd-level', '');
    await page.click('#lp-qotd button[type=submit]');
    assert.match(await page.textContent('#lp-qotd [data-qotd-note]'), /level/);
    await page.selectOption('#qd-level', 'P4');
    await page.check('#lp-qotd [name=consent]');
    await page.click('#lp-qotd button[type=submit]');
    await page.waitForSelector('#lp-qotd .qd-done');
    assert.ok(mails().some(m => m.to[0] === 'home.parent@example.test'));
    const homeSub = db.rows.get('trialSettings/dailyQuestion/subscribers/' + core.subscriberId('home.parent@example.test'));
    assert.equal(homeSub.source, 'home-page');
    assert.equal(homeSub.level, 'P4');
  }
  await page.close();
}

/* 7. The emails, as a mail app would show them. */
{
  const day = core.sgDayKey(clock);
  const sub = { id: 'a'.repeat(24), token: 'b'.repeat(32), email: 'lim.family@example.test', name: 'Mrs Lim', level: 'P5', subjects: ['math', 'science'], frequency: 'daily', consent: { at: clock } };
  const stored = await store.getDays([day, core.addDays(day, -1), core.addDays(day, -2)]);
  const daily = core.dailyMail(sub, day, core.publicPair(day, stored[day], false, 'P5'), core.publicPair(core.addDays(day, -1), stored[core.addDays(day, -1)], true, 'P5'));
  assert.match(daily.message.html, /perimeter/, "the morning email has today's worksheet question");
  assert.doesNotMatch(daily.message.html, /26 cm/, 'and not its answer');
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
