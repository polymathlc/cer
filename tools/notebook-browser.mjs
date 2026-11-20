// 📒 The mistake notebook in a real browser, end to end, with no account and no network:
// the page as shipped (notebook/), the REAL server code (shop-function/functions/notebook.js
// and notebook-core.js) answering its calls from an in-memory store of sample mistakes
// (a Study Buddy worksheet and a live lesson), and a stand-in for Firebase sign-in.
//
//   node tools/notebook-browser.mjs [--shots <dir>]
//
// It signs in, opens the notebook, does this week's quiz (a multiple-choice ✗, a short
// answer ✓, a written answer compared and self-marked), checks the counts move, opens a
// picture, removes a mistake and puts it back, switches child, and on a phone checks
// nothing is wider than the screen. With --shots it saves screenshots.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createNotebookService } = require('../shop-function/functions/notebook.js');
const N = require('../shop-function/functions/notebook-core.js');
const { fitState } = require('../shop-function/functions/notebook-store.js');
const { createHttp } = require('../shop-function/functions/service.js');
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const DAY = 86400000;
const NOW = Date.now();
const ROSTER = 'fam1_kid1';
const IDENT = 'r:' + ROSTER;
const TOKEN = 'tok-parent-tan-0000000000';
const EPOCH1 = NOW - 2 * DAY, EPOCH2 = NOW - 6 * DAY;
const PIC = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64');
const PNG = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'student/assets/apps/notebook.png')).toString('base64');

const lesson = (epoch, label, qs, marks) => ({
  v: 1, epoch, slot: 'WED-2', slotLabel: label, startedAt: epoch, endedAt: epoch + 6000000,
  questions: qs.map((q, i) => Object.assign({ at: epoch + (i + 1) * 60000, to: 'all', open: false }, q)),
  answers: Object.fromEntries(Object.entries(marks).map(([id, e]) => [id, { [IDENT]: Object.assign({ aid: 'a' + id, at: epoch + 90000 }, e) }])),
  people: { [IDENT]: { identity: IDENT, name: 'Amy Tan', rosterId: ROSTER } }
});
const SESSIONS = {
  ['teach1/' + EPOCH1]: lesson(EPOCH1, 'Wed 5pm P5 Science', [
    { id: 'q1', kind: 'mcq', text: 'Which of these materials is the best conductor of heat?', options: ['Wood', 'Copper', 'Plastic', 'Rubber'], answer: 1 },
    { id: 'q2', kind: 'cloze', text: 'Fill in the keywords.', parts: ['Plants make their own food by ', 0, ' using ', 1, ' from the Sun.'], keys: [['photosynthesis'], ['light energy', 'sunlight']], model: 'Plants make their own food by photosynthesis using light energy from the Sun.' },
    { id: 'q3', kind: 'open', text: 'Ali put a wet towel in the sun. Explain why the towel became dry after some time.', model: 'The water in the towel gained heat from the Sun and evaporated into water vapour, which went into the surrounding air.' },
    { id: 'q4', kind: 'mcq', text: 'Which part of the plant takes in water?', options: ['Leaf', 'Root', 'Stem', 'Flower'], answer: 1 }
  ], { q1: { v: 0, ok: false }, q2: { v: ['eating', 'water'], ok: 'partial' }, q3: { v: 'because of the heat', ok: 'partial' }, q4: { v: 1, ok: true } }),
  ['teach1/' + EPOCH2]: lesson(EPOCH2, 'Sat 11am P5 Math', [
    { id: 'm1', kind: 'blank', text: 'What is 3/4 of 24?', accepted: ['18'] },
    { id: 'm2', kind: 'open', text: '', img: { ref: 'pic1', n: 1 }, model: 'Area = 1/2 × 8 × 6 = 24 cm²' }
  ], { m1: { v: '16', ok: false }, m2: { v: '48', ok: false } })
};
const BOOK = { v: 1, students: { [IDENT]: { name: 'Amy Tan', rows: [{ e: EPOCH1 }, { e: EPOCH2 }] } } };
const WORKSHEET = [
  { docId: 'ws12', docName: 'P5 Science WS 12 Heat', level: 'P5', subject: 'Science', number: '6', type: 'mcq',
    question: 'Which of the following will make the ice cube in a cup melt fastest?', options: [{ label: '1', text: 'Covering the cup with a wool cloth' }, { label: '2', text: 'Putting the cup in a metal tray in the sun' }, { label: '3', text: 'Putting the cup in the fridge' }, { label: '4', text: 'Wrapping the cup in newspaper' }],
    option: '2', studentAnswer: '1', answer: '(2) Putting the cup in a metal tray in the sun', explanation: 'Metal is a good conductor of heat, and the Sun is a source of heat, so the ice gains heat fastest.', verdict: 'wrong', topic: 'Heat', createdAt: NOW - 3 * DAY },
  { docId: 'ws7', docName: 'P5 Math Fractions WS 7', level: 'P5', subject: 'Math', number: '11', type: 'open',
    question: 'Mrs Lee baked 120 cookies. She sold 2/5 of them. How many cookies were left?', answer: '72', studentAnswer: '48', explanation: '2/5 of 120 = 48 sold, so 120 − 48 = 72 were left.', verdict: 'wrong', topic: 'Fractions', createdAt: NOW - 4 * DAY },
  { docId: 'ws12', docName: 'P5 Science WS 12 Heat', level: 'P5', subject: 'Science', number: '9', type: 'open',
    question: 'Explain why the metal spoon felt colder than the wooden spoon, although both were at room temperature.', answer: 'Metal is a better conductor of heat. It conducts heat away from the hand faster than wood, so the hand loses heat faster and it feels colder.', studentAnswer: 'metal is cold', verdict: 'partial', topic: 'Heat', createdAt: NOW - 3 * DAY, imagePath: 'tutor-mistakes/uidParent/ws12q9.jpg' },
  { docId: 'ws3', docName: 'P3 Science Living things', level: 'P3', subject: 'Science', number: '2', type: 'open', question: 'Name one characteristic of living things.', answer: 'They grow.', studentAnswer: '', skipped: true, verdict: '', createdAt: NOW - 5 * DAY }
];
const FAMILIES = [{ id: 'fam1', parentName: 'Mrs Tan', email: 'parent.tan@example.test', status: 'active',
  students: [{ id: 'kid1', name: 'Amy Tan', level: 'P5', status: 'active' }, { id: 'kid2', name: 'Ben Tan', level: 'P3', status: 'active' }] }];

const states = new Map();
const store = {
  async getAccess(uid) { return uid === 'uidParent' ? { status: 'approved', parentEmail: 'parent.tan@example.test', children: [{ name: 'Amy Tan', level: 'P5' }, { name: 'Ben Tan', level: 'P3' }] } : null; },
  async getProfile() { return null; },
  async listFamilies() { return FAMILIES; },
  async uidsForRoster() { return []; },
  async worksheetMistakes(uid) { return uid === 'uidParent' ? WORKSHEET.map((data, i) => ({ id: 'mk' + i, data })) : []; },
  async progressBooks() { return [{ teacher: 'teach1', book: BOOK }]; },
  async liveSession(t, e) { return SESSIONS[t + '/' + e] || null; },
  async livePhoto(t, e, r) { return r === 'pic1' ? PNG : ''; },
  async storageImage(p) { return p.endsWith('ws12q9.jpg') ? PNG : ''; },
  async getState(id) { return states.has(id) ? JSON.parse(states.get(id)) : N.emptyState(); },
  async updateState(id, fn) {
    const raw = states.has(id) ? JSON.parse(states.get(id)) : N.emptyState();
    const out = fn(raw);
    const fitted = fitState(out.state);
    if (out.changed) states.set(id, fitted.json);
    return { state: fitted.state };
  }
};
const service = createNotebookService({
  store, http: createHttp(c => { if (process.env.NB_DEBUG) console.log('report', c); }), report: c => { if (process.env.NB_DEBUG) console.log('report', c); },
  verifyIdToken: async token => { if (token !== TOKEN) throw new Error('bad'); return { uid: 'uidParent', email: 'parent.tan@example.test', email_verified: true, name: 'Mrs Tan' }; }
});
async function answerCall(request) {
  const headers = Object.assign({}, request.headers(), { origin: 'https://polymathlc.com.sg' });
  if (request.method() === 'OPTIONS') return { status: 204, body: '' };
  const req = { method: 'POST', body: request.postDataJSON(), get: name => headers[name.toLowerCase()] };
  const res = { statusCode: 200, body: null, set() { return this; }, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
  await service.mistakeNotebook(req, res);
  if (process.env.NB_DEBUG) console.log('call', request.method(), res.statusCode, JSON.stringify(res.body).slice(0, 200));
  return { status: res.statusCode, body: JSON.stringify(res.body) };
}

// Firebase compat, signed in as the parent (the page only uses auth).
const FIREBASE_STUB = `window.firebase = (function () {
  var user = { uid: 'uidParent', email: 'parent.tan@example.test', isAnonymous: false, getIdToken: function () { return Promise.resolve('${TOKEN}'); } };
  var listeners = [];
  var auth = { currentUser: user, onAuthStateChanged: function (cb) { listeners.push(cb); setTimeout(function () { cb(auth.currentUser); }, 30); return function () {}; },
    signOut: function () { auth.currentUser = null; listeners.forEach(function (cb) { cb(null); }); return Promise.resolve(); } };
  var app = { auth: function () { return auth; } };
  var fb = { apps: [], initializeApp: function () { fb.apps.push(app); return app; }, app: function () { return app; }, auth: function () { return auth; } };
  fb.auth.GoogleAuthProvider = function () { this.setCustomParameters = function () {}; };
  return fb;
})();`;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

async function wire(context) {
  // The LAST route added wins in Playwright: the catch-all first, the sign-in stand-in after it.
  await context.route(/gstatic\.com\/firebasejs\/.*\.js/, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, r => r.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB }));
  await context.route(/access-gate\.js/, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route(/pwa-install\.js/, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route(/dropboxusercontent\.com/, r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, 'student/assets/app-icons/icon-192.png')) }));
  await context.route(/fonts\.(googleapis|gstatic)\.com|firestore\.googleapis\.com/, r => r.fulfill({ status: 404, body: '' }));
  await context.route(/cloudfunctions\.net\/mistakeNotebook/, async r => {
    let out;
    try { out = await answerCall(r.request()); } catch (e) { console.log('route failed', e); throw e; }
    await r.fulfill({ status: out.status, contentType: 'application/json', body: out.body,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, Authorization' } });
  });
}
async function shot(page, name, opts) { if (SHOTS) await page.screenshot(Object.assign({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }, opts || {})); }
const errors = [];
const browser = await chromium.launch();
let passed = 0;
const ok = name => { passed++; console.log('ok - ' + name); };
try {
  /* ───────── desktop ───────── */
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: 'block' });
  await wire(desk);
  const page = await desk.newPage();
  if (process.env.NB_DEBUG) await page.addInitScript(() => { const f = window.fetch; window.fetch = function () { return f.apply(this, arguments).catch(e => { window.__fetchErr = String(e); throw e; }); }; });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (process.env.NB_DEBUG) console.log('console:', m.text()); });
  await page.goto(BASE + '/notebook/');
  if (process.env.NB_DEBUG) { await page.waitForTimeout(3000); console.log('STATE', await page.evaluate(() => JSON.stringify({ e: window.NotebookApp.instance.S.error, p: window.NotebookApp.instance.S.phase, u: !!window.NotebookApp.instance.S.user, f: String(window.__fetchErr || '') }))); }
  await page.waitForSelector('.week');
  const statOpen = await page.textContent('.stat.is-open .stat-n');
  // Amy: 3 P5 worksheet mistakes + 5 live (q4 was ✓ and is not collected); Ben's P3 sheet is his.
  assert.equal(statOpen.trim(), '8');
  assert.equal(await page.locator('.kid').count(), 2);
  assert.equal(await page.locator('.item').count(), 8);
  assert.ok((await page.textContent('.week')).includes('0 of 8 questions done'));
  ok('desktop: the notebook opens with Amy\'s 8 mistakes from worksheets and live lessons, and an 8-question quiz');
  await shot(page, 'desktop-notebook', { fullPage: false });
  await shot(page, 'desktop-notebook-full', { fullPage: true });

  // No answers on the cards until asked for; Show answer shows one (and the quiz still counts).
  assert.equal(await page.locator('.item .answer').count(), 0);
  await page.locator('[data-act="reveal"]').last().click();
  await page.waitForSelector('.item .answer');
  assert.equal(await page.locator('.item .answer').count(), 1);
  ok('Show answer shows the answer on that card only');
  await page.reload();
  await page.waitForSelector('.week');

  // The quiz: answer every question; the kinds decide what happens.
  await page.click('[data-act="quiz"]');
  await page.waitForSelector('.sheet-card');
  await shot(page, 'desktop-quiz-question');
  const seen = { mcq: 0, blank: 0, cloze: 0, open: 0 };
  for (let guard = 0; guard < 12; guard++) {
    if (await page.locator('.finish').count()) break;
    if (process.env.NB_DEBUG) console.log('Q', (await page.textContent('.sheet-card')).slice(0, 160).replace(/\s+/g, ' '));
    if (await page.locator('.opt').count()) {
      // Multiple choice: pick A (wrong for both live MCQs and for the worksheet one: B is right).
      await page.click('.opt >> nth=0');
      await page.click('[data-q="check"]');
      await page.waitForSelector('.result');
      if (!seen.mcq) { assert.ok(await page.locator('.result.is-wrong').count()); await shot(page, 'desktop-quiz-wrong'); }
      seen.mcq++;
    } else if (await page.locator('input.gap').count()) {
      await page.fill('input.gap >> nth=0', 'photosynthesis');
      await page.fill('input.gap >> nth=1', 'sunlight');
      await page.click('[data-q="check"]');
      await page.waitForSelector('.result.is-right');
      seen.cloze++;
    } else if (await page.locator('input#ans').count()) {
      const q = await page.textContent('.sheet-body');
      await page.fill('#ans', /3\/4 of 24/.test(q) ? '18' : '72');
      await page.click('[data-q="check"]');
      await page.waitForSelector('.result.is-right');
      if (!seen.blank) await shot(page, 'desktop-quiz-right');
      seen.blank++;
    } else {
      await page.fill('#ans', 'The water gained heat and evaporated.');
      await page.click('[data-q="check"]');
      await page.waitForSelector('.result.is-compare');
      if (!seen.open) await shot(page, 'desktop-quiz-compare');
      await page.click('[data-q="self-right"]');
      await page.waitForSelector('.result.is-right');
      seen.open++;
    }
    await page.click('[data-q="next"]');
  }
  await page.waitForSelector('.finish');
  await shot(page, 'desktop-quiz-finished');
  assert.deepEqual(seen, { mcq: 2, blank: 2, cloze: 1, open: 3 });
  ok('the quiz: 2 multiple choice marked ✗ at once, 2 short answers and the keywords ✓ by the key, 3 written answers compared and self-marked');
  await page.click('.finish [data-q="close"]');
  assert.equal((await page.textContent('.stat.is-fixed .stat-n')).trim(), '6');
  assert.equal((await page.textContent('.stat.is-open .stat-n')).trim(), '2');
  assert.ok((await page.textContent('.week')).includes('6 of 8 right'));
  ok('after the quiz: 6 fixed, 2 still to redo, and the week shows done');

  // The list: the open ones show; a picture loads; Show answer; remove and put back.
  await page.click('[data-act="filter"][data-value="all"][data-group="status"]');
  assert.equal(await page.locator('.item').count(), 8);
  // The quiz already fetched the pictures it showed; any other still waits for a tap.
  if (await page.locator('[data-act="img"]').count()) await page.locator('[data-act="img"]').first().click();
  await page.waitForSelector('.item .q-img');
  ok('a question\'s picture loads when asked for');
  await page.click('[data-act="filter"][data-value="open"][data-group="status"]');
  const before = await page.locator('.item').count();
  await page.locator('[data-act="hide-ask"]').first().click();
  await page.locator('[data-act="hide"]').first().click();
  await page.waitForFunction(n => document.querySelectorAll('.item').length === n - 1, before);
  await page.click('[data-act="filter"][data-value="removed"]');
  await page.click('[data-act="unhide"]');
  await page.waitForFunction(() => document.querySelectorAll('.item').length === 0);
  ok('a mistake can be removed from the quizzes and put back');
  await page.click('[data-act="filter"][data-value="open"][data-group="status"]');
  // Redo one from the list.
  await page.locator('.item [data-act="redo"]').first().click();
  await page.waitForSelector('.sheet-card');
  assert.ok((await page.textContent('.sheet-top')).includes('Redo'));
  await page.click('[data-q="close"]');
  ok('Redo it opens a single question');
  // Ben's notebook.
  await page.click('.kid >> nth=1');
  await page.waitForFunction(() => document.querySelector('.kid.is-on') && document.querySelector('.kid.is-on').textContent.includes('Ben'));
  await page.waitForSelector('.stat.is-open');
  assert.equal((await page.textContent('.stat.is-open .stat-n')).trim(), '1');
  ok('switching to the brother shows his own notebook (his P3 worksheet only)');
  await page.click('.kid >> nth=0');
  await page.waitForFunction(() => document.querySelector('.kid.is-on') && document.querySelector('.kid.is-on').textContent.includes('Amy'));
  await desk.close();

  /* ───────── phone ───────── */
  const phone = await browser.newContext(Object.assign({}, devices['iPhone 13'], { serviceWorkers: 'block' }));
  await wire(phone);
  const p2 = await phone.newPage();
  p2.on('pageerror', e => errors.push(String(e)));
  await p2.goto(BASE + '/notebook/');
  await p2.waitForSelector('.week');
  const wide = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(wide <= 0, 'nothing wider than the phone screen (' + wide + 'px)');
  await shot(p2, 'phone-notebook');
  await p2.evaluate(() => window.scrollTo(0, document.querySelector('.list').offsetTop - 60));
  await shot(p2, 'phone-list');
  // A redo of an open one on the phone: the sheet comes up from the bottom.
  await p2.locator('.item [data-act="redo"]').first().click();
  await p2.waitForSelector('.sheet-card');
  await shot(p2, 'phone-redo');
  const wide2 = await p2.evaluate(() => document.querySelector('.sheet-card').scrollWidth - document.querySelector('.sheet-card').clientWidth);
  assert.ok(wide2 <= 0, 'the redo sheet fits the phone');
  ok('phone: the notebook and the redo sheet fit the screen');
  await phone.close();

  /* ───────── My Polymath tile ───────── */
  const dash = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: 'block' });
  await wire(dash);
  const p3 = await dash.newPage();
  await p3.goto(BASE + '/student/');
  await p3.waitForSelector('[data-app="notebook"]');
  assert.equal(await p3.getAttribute('[data-app="notebook"]', 'href'), 'https://polymathlc.com.sg/notebook/');
  await p3.evaluate(() => document.querySelector('[data-section="self"]').scrollIntoView());
  await shot(p3, 'student-tile', { clip: await p3.evaluate(() => { const r = document.querySelector('[data-section="self"]').closest('section').getBoundingClientRect(); return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.width + 20, height: r.height + 20 }; }) });
  ok('My Polymath has the Mistake Notebook tile');
  await dash.close();

  assert.deepEqual(errors, []);
  ok('no page errors');
} finally {
  await browser.close();
  server.close();
}
console.log('# pass ' + passed);
