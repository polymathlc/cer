// 🩺 The diagnostic report, end to end in a real browser, with Firebase and the
// functions stood in for:
//   node tools/diagnostic-report-browser.mjs     (DIAGNOSTIC_SCREENSHOTS=dir keeps pictures)
//
// 1. On /diagnostic/#admin the teacher opens 📝 Results on a booking, types the
//    marks off the paper, drafts the note, builds the plan, picks a class from the
//    timetable and sends. The booking gets the report and a key; one mail document
//    from admin@ goes to the parent.
// 2. The parent's page /diagnostic/report/?c=…&t=… shows that report, at desktop
//    and phone widths, and says so in words when the link is wrong.
// 3. The report's Enrol button opens that class's booking form on /schedule with
//    the parent's details filled in.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const R = require('../diagnostic/report-core.js');
const { publicReport } = require('../shop-function/functions/diagnostic-report.js');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.DIAGNOSTIC_SCREENSHOTS || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const SLOTS = {
  'TUE-1': { level: 'P5', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' },
  'THU-3': { level: 'P5', subject: 'Math', mode: 'Physical', status: 'open', type: 'master', fee: '400' },
  'MON-2': { level: 'P5', subject: 'Math', mode: 'Both', status: 'open', type: 'regular', fee: '280', feeOnline: '260' },
  'TUE-3': { level: 'P6', subject: 'Math', mode: 'Physical', status: 'open', type: 'master', fee: '400' }
};
const fields = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { stringValue: String(v) }]));
const TIMETABLE = { name: 'schedule_config/main', fields: { masterTrialPrice: { integerValue: '100' },
  slots: { mapValue: { fields: Object.fromEntries(Object.entries(SLOTS).map(([id, s]) => [id, { mapValue: { fields: fields(s) } }])) } } } };
const BOOKING = { code: 'ABC234', kind: 'diagnostic', slot: 'THU-3', diagnosticDate: '2026-12-10',
  sessionLabel: 'Thursday 10 December 2026, 7:00pm – 8:45pm', classLevel: 'P5', classSubject: 'Math',
  subject: 'Math', level: 'Primary 5', parentName: 'Mdm Lim', childName: 'Ava Tan', email: 'parent@example.test', status: 'confirmed' };

// A Firestore and Auth with the calls the pages make, kept in window.__fake.
const FAKE_FIREBASE = (seed, user) => `
(function(){
  const rows = ${JSON.stringify(seed)};
  const listeners = [];
  const writes = [];
  const now = () => ({ toDate: () => new Date(), toMillis: () => Date.now() });
  const ts = v => v && v.__ts ? now() : v;
  function apply(path, data, merge) {
    const old = merge ? Object.assign({}, rows[path] || {}) : {};
    for (const k in data) {
      const v = data[k];
      if (v && v.__del) delete old[k];
      else if (v && v.__inc) old[k] = (old[k] || 0) + v.__inc;
      else old[k] = ts(v);
    }
    rows[path] = old;
  }
  function notify() { listeners.forEach(l => l()); }
  function snapDoc(path) { const id = path.split('/').pop(); return { id, exists: path in rows, data: () => rows[path] && JSON.parse(JSON.stringify(rows[path], (k, v) => v && v.toDate ? v.toDate().toISOString() : v), (k, v) => typeof v === 'string' && /^\\d{4}-\\d{2}-\\d{2}T/.test(v) ? { toDate: () => new Date(v) } : v) }; }
  function query(name, filters) {
    const q = {
      where(f, op, v) { return query(name, filters.concat([[f, v]])); },
      orderBy() { return q; }, limit() { return q; },
      onSnapshot(cb) {
        const fire = () => cb({ docs: Object.keys(rows).filter(p => p.startsWith(name + '/') && p.split('/').length === 2)
          .filter(p => filters.every(([f, v]) => rows[p][f] === v)).map(snapDoc) });
        listeners.push(fire); setTimeout(fire, 0); return () => {};
      },
      async get() { return { docs: [] }; },
      doc(id) { const path = name + '/' + (id || ('auto' + Math.random().toString(36).slice(2))); return {
        id: path.split('/').pop(), __path: path,
        onSnapshot(cb) { const fire = () => cb(snapDoc(path)); listeners.push(fire); setTimeout(fire, 0); return () => {}; },
        async get() { return snapDoc(path); },
        async update(d) { writes.push(['update', path, d]); apply(path, d, true); notify(); },
        async set(d, o) { writes.push(['set', path, d]); apply(path, d, !!(o && o.merge)); notify(); },
        async delete() { writes.push(['delete', path]); delete rows[path]; notify(); }
      }; },
      async add(d) { const path = name + '/auto' + writes.length; writes.push(['set', path, d]); apply(path, d, false); notify(); return { id: path.split('/').pop() }; }
    };
    return q;
  }
  const db = { collection: name => query(name, []), batch() { const ops = []; return {
    update(ref, d) { ops.push(['update', ref.__path, d]); }, set(ref, d) { ops.push(['set', ref.__path, d]); },
    async commit() { ops.forEach(o => { writes.push(o); apply(o[1], o[2], o[0] === 'update'); }); notify(); } }; } };
  const currentUser = ${JSON.stringify(user)};
  const auth = { currentUser, onAuthStateChanged(cb) { setTimeout(() => cb(currentUser), 0); return () => {}; },
    async signInWithPopup() { return { user: currentUser }; }, async signOut() {} };
  const storage = { ref() { return { child() { return this; }, async put() {}, async getDownloadURL() { return ''; } }; } };
  window.firebase = { initializeApp() {}, apps: [], auth: () => auth, firestore: () => db, storage: () => storage };
  window.firebase.auth.GoogleAuthProvider = function () {};
  window.firebase.firestore.FieldValue = { serverTimestamp: () => ({ __ts: 1 }), increment: n => ({ __inc: n }), delete: () => ({ __del: 1 }) };
  window.firebase.firestore.Timestamp = { now };
  window.__fake = { rows, writes };
})();`;

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) throw new Error('outside');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('ok - ' + name); }
async function shot(page, name, options = {}) {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot(Object.assign({ path: join(SHOTS, name + '.png') }, options));
}

async function openWith(viewport, url, { seed = {}, user = null, report = null } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(Date.UTC(2026, 11, 11, 4)) });   // 11 Dec 2026, noon in Singapore
  await page.route(/firestore\.googleapis\.com/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TIMETABLE) }));
  await page.route(/fonts\.(googleapis|gstatic)\.com|dropboxusercontent\.com/, route => route.fulfill({ status: 200, body: '' }));
  await page.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_FIREBASE(seed, user) }));
  await page.route(/gstatic\.com\/firebasejs\/.*-compat\.js/, route => route.request().url().includes('firebase-app-compat')
    ? route.fallback() : route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const posts = [];
  await page.route(/cloudfunctions\.net\/diagnosticReport/, async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    posts.push(body);
    const ok = report && body.code === report.code && body.token === report.token;
    await route.fulfill({ status: ok ? 200 : 404, contentType: 'application/json',
      body: JSON.stringify(ok ? { ok: true, report: report.report, sentAt: Date.UTC(2026, 11, 11, 3) } : { ok: false, error: 'report-not-found' }) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + url);
  return { context, page, posts, errors };
}

const MARKS = { 'Whole numbers to 10 million': 9, Fractions: 3, Decimals: 8, Percentage: 7, Ratio: 4, Rate: 9,
  'Area of triangles': 5, 'Volume of cubes and cuboids': 10, 'Angles and geometry': 6, 'Word problems (heuristics)': 4 };
let sent = null;

await check('the teacher enters the marks, builds the report and sends it to the parent', async () => {
  const { context, page, errors } = await openWith({ width: 1366, height: 900 }, '/diagnostic/#admin', {
    seed: { 'schedule_bookings/ABC234': Object.assign({}, BOOKING, { createdAt: '2026-11-20T02:00:00.000Z' }) },
    user: { email: 'chungzhikai@gmail.com', uid: 'teacher' } });
  await page.waitForSelector('#admin-section:not(.hidden)');
  await page.click('#admin-filter [data-filter="all"]');
  await page.waitForSelector('text=📝 Results');
  await page.click('text=📝 Results');
  await page.waitForSelector('#rep-bg .topic-row');
  const names = await page.$$eval('#rep-topics [data-k="t-name"]', els => els.map(e => e.value));
  assert.deepEqual(names, R.topicsFor('Primary 5', 'Math'), 'the Primary 5 Maths topics to start from');
  await page.fill('#rep-allmax', '10');
  await page.click('[data-act="all-max"]');
  for (const [i, name] of names.entries()) await page.fill('[data-i="' + i + '"] [data-k="t-score"]', String(MARKS[name]));
  await page.fill('[data-i="1"] [data-k="t-note"]', 'Mixes up the numerator and denominator in word problems');
  assert.match(await page.textContent('#rep-total'), /65%.*65 \/ 100 marks/s);
  assert.match(await page.textContent('#rep-problems'), /Build the study plan/);
  await page.click('[data-act="draft-comment"]');
  assert.match(await page.inputValue('#rep-comment'), /^Ava scored 65% on the Maths diagnostic test/);
  await page.click('[data-act="build-plan"]');
  assert.equal(await page.$$eval('#rep-steps .step', els => els.length), 4);
  const classes = await page.$$eval('#rep-class option', els => els.map(e => e.value));
  assert.deepEqual(classes, ['', 'THU-3', 'MON-2', 'TUE-3'], 'Primary 5 Maths first, Master Class first');
  await page.selectOption('#rep-class', 'THU-3');
  assert.match(await page.inputValue('#rep-why'), /Primary 5 Maths Master Class is for Primary 5 in 2027/);
  await page.waitForFunction(() => /Primary 5 Maths Master Class/.test(document.getElementById('rep-preview').textContent));
  const preview = await page.textContent('#rep-preview');
  assert.match(preview, /Dear Mdm Lim/);
  assert.match(preview, /8-week study plan/);
  assert.equal(await page.textContent('#rep-problems'), '', 'nothing stops the send');
  await shot(page, 'admin-results-desktop');
  await page.click('[data-act="send"]');
  await page.waitForFunction(() => !document.getElementById('rep-bg'));
  const fake = await page.evaluate(() => window.__fake);
  const booking = fake.rows['schedule_bookings/ABC234'];
  assert.equal(booking.status, 'attended');
  assert.equal(booking.reportSentTo, 'parent@example.test');
  assert.equal(booking.reportSentCount, 1);
  assert.match(booking.reportToken, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(booking.diagnosticReport.topics.length, 10);
  assert.equal(booking.diagnosticReport.recommended.slot, 'THU-3');
  const mails = fake.writes.filter(w => w[1].startsWith('mail/'));
  assert.equal(mails.length, 1, 'one email');
  const mail = mails[0][2];
  assert.deepEqual(mail.to, ['parent@example.test']);
  assert.equal(mail.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.match(mail.message.subject, /Ava Tan's diagnostic report and study plan/);
  assert.ok(mail.message.html.includes('/diagnostic/report/?c=ABC234&amp;t=' + booking.reportToken));
  await page.waitForSelector('text=✉ Report sent');
  sent = { code: 'ABC234', token: booking.reportToken, mail,
    report: publicReport(Object.assign({}, BOOKING, booking, { reportSentAt: Date.now() })) };
  assert.deepEqual(errors, []);
  await context.close();
});

await check('phone: the results editor switches between entering results and the preview', async () => {
  const { context, page, errors } = await openWith({ width: 390, height: 844 }, '/diagnostic/#admin', {
    seed: { 'schedule_bookings/ABC234': Object.assign({}, BOOKING, { diagnosticReport: sent.report, reportToken: sent.token }) },
    user: { email: 'chungzhikai@gmail.com', uid: 'teacher' } });
  await page.waitForSelector('#admin-section:not(.hidden)');
  await page.click('#admin-filter [data-filter="all"]');
  await page.click('text=📝 Results');
  await page.waitForSelector('#rep-bg .topic-row');
  assert.equal(await page.inputValue('[data-i="1"] [data-k="t-score"]'), '3', 'the saved draft is loaded');
  assert.ok(await page.isHidden('.rep-preview'));
  await shot(page, 'admin-results-phone');
  await page.click('[data-act="view"][data-view="preview"]');
  assert.ok(await page.isVisible('.rep-preview'));
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(sideways, false, 'nothing scrolls sideways');
  assert.deepEqual(errors, []);
  await context.close();
});

for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  await check(label + ': the parent\'s report page shows the report', async () => {
    const { context, page, posts, errors } = await openWith(viewport, '/diagnostic/report/?c=ABC234&t=' + sent.token, { report: sent });
    await page.waitForSelector('#report:not(.hidden)');
    assert.deepEqual(posts[0], { code: 'ABC234', token: sent.token });
    const text = await page.textContent('#report');
    assert.match(text, /Ava Tan/);
    assert.match(text, /65%/);
    assert.match(text, /Teacher's note/);
    assert.match(text, /Results by topic/);
    assert.match(text, /8-week study plan/);
    assert.match(text, /Primary 5 Maths Master Class/);
    assert.ok(!/Dear Mdm Lim/.test(text), 'no letter greeting on the page');
    const enrol = await page.getAttribute('a:has-text("Enrol Ava now")', 'href');
    assert.ok(enrol.startsWith('https://polymathlc.com.sg/schedule/?book=THU-3&kind=enrol'), enrol);
    assert.equal(await page.title(), 'Ava Tan’s diagnostic report | Polymath Learning Centre');
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(sideways, false, 'nothing scrolls sideways');
    await shot(page, 'report-page-' + label, { fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  });
}

await check('a wrong or missing key is answered in words', async () => {
  const wrong = await openWith({ width: 390, height: 844 }, '/diagnostic/report/?c=ABC234&t=' + 'x'.repeat(24), { report: sent });
  await wrong.page.waitForSelector('text=Report not found');
  await wrong.context.close();
  const missing = await openWith({ width: 390, height: 844 }, '/diagnostic/report/?c=ABC234', { report: sent });
  await missing.page.waitForSelector('text=Report link incomplete');
  assert.equal(missing.posts.length, 0);
  await missing.context.close();
});

await check('the email renders as the parent sees it', async () => {
  const context = await browser.newContext({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route(/dropboxusercontent\.com|fonts\./, route => route.fulfill({ status: 200, body: '' }));
  await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0">' + sent.mail.message.html + '</body>');
  assert.match(await page.textContent('body'), /View and print this report online/);
  await shot(page, 'report-email', { fullPage: true });
  await context.close();
});

await check('Enrol from the report opens that class on /schedule with the parent\'s details', async () => {
  const enrol = new URL(R.enrolUrl(sent.report));
  const { context, page } = await openWith({ width: 1280, height: 900 }, '/schedule/' + enrol.search, {
    seed: { 'schedule_config/main': { slots: SLOTS, masterTrialPrice: 100 }, 'shop_settings/config': { cardPayments: true } } });
  await page.waitForSelector('#booking-modal.show');
  assert.equal(await page.inputValue('#b-parent'), 'Mdm Lim');
  assert.equal(await page.inputValue('#b-child'), 'Ava Tan');
  assert.equal(await page.inputValue('#b-email'), 'parent@example.test');
  assert.match(await page.textContent('#booking-title'), /Enrol in the Master Class/);
  assert.ok(!(await page.evaluate(() => location.search)), 'the address is cleaned');
  await shot(page, 'schedule-enrol-from-report');
  await context.close();
});

await browser.close();
server.close();
console.log('# pass ' + passed);
