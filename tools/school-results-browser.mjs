// 📊 School results, end to end, in a real browser.
//
//   PW=/path/to/playwright/index.mjs node tools/school-results-browser.mjs
//
// Serves the SHIPPED office/ and results/ pages. The Office runs on
// tools/office-fake-firebase.js; the parent's page talks to the REAL
// schoolResults function (shop-function/functions/school-results.js) running
// here in Node on the same in-memory Firestore its unit tests use. Nothing is
// sent anywhere. It is Friday 20 Nov 2026, noon in Singapore. As the admin:
//   the Results tab: the headline numbers and sentences, every child's chart →
//   filters (Maths, P5) → copy a sentence → open a child, add a result, change
//   it, remove one → a family's link (copy, email, WhatsApp) → email every
//   family without results → the CSV.
// As a parent, with the link the office made: their children and charts → add
// a result → a wrong one is refused with the reason → change and remove their
// own → a result the centre entered cannot be changed → back in the Office it
// shows as 🆕 new. Then both pages on a phone.
// Screenshots go to RESULTS_SHOTS (default artifacts/school-results).
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as S from '../office/school-results-core.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.RESULTS_SHOTS || join(ROOT, 'artifacts', 'school-results');
if (!process.env.PW) throw new Error('Set PW (playwright index.mjs).');
mkdirSync(OUT, { recursive: true });
const { chromium, devices } = await import(process.env.PW);
const require = createRequire(import.meta.url);
const SR = require('../shop-function/functions/school-results.js');
const { createHttp } = require('../shop-function/functions/service.js');
const { database } = require('../shop-function/functions/test/fakes.js');
const SG = 8 * 3600 * 1000;
const NOW = new Date(Date.UTC(2026, 10, 20, 12, 0) - SG);   // Fri 20 Nov 2026, 12:00 in Singapore

const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, p);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('missing'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const FAKE_FB = readFileSync(join(ROOT, 'tools', 'office-fake-firebase.js'), 'utf8');
const QR_STUB = 'window.QRCode = function (el, o) { var c = document.createElement("canvas"); c.width = c.height = (o && o.width) || 200; (el.appendChild ? el : document.body).appendChild(c); this._el = c; }; window.QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 }; window.QRCode.prototype.clear = function () {}; window.QRCode.prototype.makeCode = function () {};';

/* ─── The server side of the parent's page: the real function, in memory ─── */
const serverDb = database({});
let ids = 0;
const fn = SR.createSchoolResultsService({ store: SR.createSchoolResultsStore(serverDb), http: createHttp(() => {}), now: () => NOW.getTime(), makeId: () => 'rweb' + String(++ids).padStart(6, '0') });
const calls = [];
async function callFunction(body) {
  calls.push(body);
  const headers = { origin: 'https://polymathlc.com.sg', 'content-type': 'application/json' };
  const req = { method: 'POST', body, get: name => headers[name.toLowerCase()] };
  const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
  await fn.schoolResults(req, res);
  return res;
}

const chats = [];
async function routeOutside(context) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const url = route.request().url();
    if (url.startsWith('https://www.gstatic.com/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: url.includes('app-compat') ? FAKE_FB : '' });
    if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.includes('qrcode')) return route.fulfill({ contentType: 'text/javascript', body: QR_STUB });
    if (url.includes('officeSettings/config')) return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    if (url === 'https://us-central1-mathgen--app.cloudfunctions.net/schoolResults') {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
      const res = await callFunction(JSON.parse(route.request().postData() || 'null'));
      return route.fulfill({ status: res.statusCode, headers: cors, contentType: 'application/json', body: JSON.stringify(res.body) });
    }
    if (url.startsWith('https://web.whatsapp.com/') || url.startsWith('https://wa.me/')) {
      chats.push(url);
      return route.fulfill({ contentType: 'text/html', body: '<title>WhatsApp stand-in</title><p>WhatsApp would open here.</p>' });
    }
    return route.abort();
  });
}

/* ─── The centre on 20 Nov 2026 ─── */
const SCHEDULE = { monthlyFee: 220, slots: {
  'SAT-1': { level: 'P5', subject: 'Science', mode: 'Both', status: 'open', type: 'regular' },
  'SAT-2': { level: 'P6', subject: 'Math', mode: 'Both', status: 'open', type: 'regular' },
  'FRI-1': { level: 'P5', subject: 'Math', mode: 'Both', status: 'open', type: 'regular' },
  'THU-1': { level: 'P4', subject: 'Math', mode: 'Both', status: 'open', type: 'regular' }
} };
const kid = (id, name, level, startDate, slots) => ({ id, name, level, status: 'active', startDate, classes: slots.map(s => ({ slotId: s, mode: 'Physical' })) });
const fam = (code, parentName, email, whatsapp, students, extra) => Object.assign({ code, parentName, email, whatsapp, status: 'active', students }, extra || {});
const FAMILIES = {
  'officeFamilies/tanfam': fam('TAN2AA', 'Mrs Tan', 'tan@example.com', '91110001', [kid('k1', 'Ethan Tan', 'P5', '2026-06-01', ['FRI-1', 'SAT-1']), kid('k2', 'Chloe Tan', 'P4', '2026-06-01', ['THU-1'])]),
  'officeFamilies/limfam': fam('LIM3BB', 'Mr Lim', 'lim@example.com', '91110002', [kid('k3', 'Ryan Lim', 'P6', '2026-02-02', ['SAT-2'])]),
  'officeFamilies/gohfam': fam('GOH4CC', 'Ms Goh', 'goh@example.com', '', [kid('k4', 'Zoe Goh', 'P5', '2026-03-02', ['FRI-1'])]),
  'officeFamilies/rajfam': fam('RAJ5DD', 'Mr Rajesh Kumar', 'raj@example.com', '91110004', [kid('k5', 'Arjun Kumar', 'P5', '2026-01-12', ['SAT-1']), kid('k6', 'Priya Kumar', 'P6', '2026-01-12', ['SAT-2'])]),
  'officeFamilies/ongfam': fam('ONG6EE', 'Mdm Ong', 'ong@example.com', '91110005', [kid('k7', 'Ivan Ong', 'P6', '2026-04-06', ['SAT-2'])]),
  'officeFamilies/chuafam': fam('CHU8GG', 'Mrs Chua', 'chua@example.com', '91110007', [kid('k9', 'Megan Chua', 'P4', '', ['THU-1'])]),
  'officeFamilies/wongfam': fam('WON9HH', 'Mr Wong', 'wong@example.com', '91110008', [kid('k10', 'Lucas Wong', 'P5', '2026-07-01', ['FRI-1'])]),
  'officeFamilies/newfam': fam('NEW2JJ', 'Ms Neo', 'neo@example.com', '91110009', [kid('k11', 'Hannah Neo', 'P3', '2026-10-05', ['THU-1'])]),
  'officeFamilies/leftfam': fam('LEF7FF', 'Mr Left', 'left@example.com', '91110006', [kid('k8', 'Gone Kid', 'P5', '2026-01-05', ['SAT-1'])], { status: 'withdrawn', lastMonth: '2026-09' })
};
let n = 0;
const res = (subject, exam, date, mark, max = 100, grade = '', by = 'parent') => ({ id: 'rseed' + String(++n).padStart(4, '0'), subject, exam, label: '', date, mark, max, grade, by, at: Date.UTC(2026, 10, 1) });
const doc = (fid, token, students, extra) => Object.assign({ kind: S.RESULTS_KIND, familyId: fid, token, students, linkSentAt: Date.UTC(2026, 10, 2, 3), linkSentVia: 'email' }, extra || {});
const TOKEN_TAN = 'tanTokenForResults0123456';
const RESULTS = {
  'officeSettings/results-tanfam': doc('tanfam', TOKEN_TAN, {
    k1: [res('Math', 'WA1', '2026-02-27', 22, 40), res('Math', 'SA1', '2026-05-20', 58), res('Math', 'WA3', '2026-08-12', 29, 40), res('Math', 'SA2', '2026-10-26', 81, 100, '', 'office'),
      res('Science', 'SA1', '2026-05-20', 61), res('Science', 'SA2', '2026-10-26', 77)] }),
  'officeSettings/results-limfam': doc('limfam', 'limTokenForResults0123456', {
    k3: [res('Math', 'SA2', '2025-10-24', 49), res('Math', 'WA1', '2026-03-02', 26, 40), res('Math', 'SA1', '2026-05-18', 66), res('Math', 'Prelim', '2026-08-31', 74), res('Math', 'PSLE', '2026-11-19', null, 100, 'AL4')] }),
  'officeSettings/results-gohfam': doc('gohfam', 'gohTokenForResults0123456', {
    k4: [res('Math', 'SA2', '2025-10-27', 78), res('Math', 'SA1', '2026-05-20', 74), res('Math', 'SA2', '2026-10-26', 76)] }),
  'officeSettings/results-rajfam': doc('rajfam', 'rajTokenForResults0123456', {
    k5: [res('Science', 'SA2', '2025-10-24', 52), res('Science', 'SA1', '2026-05-20', 63), res('Science', 'SA2', '2026-10-26', 71)],
    k6: [res('Math', 'SA2', '2025-10-24', 60), res('Math', 'SA1', '2026-05-20', 68), res('Math', 'Prelim', '2026-08-31', 79), res('Science', 'SA2', '2025-10-24', 70), res('Science', 'Prelim', '2026-08-31', 82)] }),
  'officeSettings/results-ongfam': doc('ongfam', 'ongTokenForResults0123456', {
    k7: [res('Math', 'WA1', '2026-03-03', 18, 40), res('Math', 'SA1', '2026-05-19', 57), res('Math', 'Prelim', '2026-08-31', 64)] }, { parentUpdatedAt: Date.UTC(2026, 10, 19, 6), parentChanged: { k7: Date.UTC(2026, 10, 19, 6) } })
};
const SEED = Object.assign({ 'schedule_config/main': SCHEDULE, 'officeSettings/config': { invoiceDay: 1, dueDays: 7, combinedMonths: [], signature: 'Warm regards,\nMr Chung\nPolymath Learning Centre' } }, FAMILIES, RESULTS);

const errors = [];
async function shot(page, name, opts) {
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const t = document.getElementById('toast'); if (t) t.classList.remove('show');
    // A full-page picture would print the parent page's sticky bar halfway down.
    const bar = document.querySelector('.topbar'); if (bar) bar.style.position = 'static';
  });
  await page.screenshot(Object.assign({ path: join(OUT, name + '.png'), fullPage: true, animations: 'disabled' }, opts || {}));
}
const store = page => page.evaluate(() => Object.fromEntries([...window.__fakeStore.entries()]));
function watch(page, label) {
  page.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED/.test(m.text())) errors.push(label + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
}
let passed = 0;
const ok = name => { passed++; console.log('ok   ' + name); };
async function until(locator, re, gone) {
  for (let i = 0; i < 100; i++) {
    const t = await locator.innerText().catch(() => '');
    if (gone ? !re.test(t) : re.test(t)) return t;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for ' + re + (gone ? ' to go' : '') + ' in: ' + (await locator.innerText().catch(() => '')).slice(0, 800));
}
const kidCard = (page, name) => page.locator('.sr-kid', { hasText: name });

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'], locale: 'en-SG', timezoneId: 'Asia/Singapore' });
  await routeOutside(ctx);
  const page = await ctx.newPage();
  watch(page, 'office');
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(seed => { window.__fakeSeed = { docs: seed }; }, SEED);
  await page.goto(BASE + '/office/#results');
  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForSelector('.sr-kid').catch(async e => { console.log('VIEW:', (await page.textContent('#view').catch(() => '')).slice(0, 800), errors); throw e; });

  /* 1. The headline numbers, worked out from the seeded results. */
  const expected = S.headline(S.childRows(Object.entries(FAMILIES).map(([p, f]) => Object.assign({ id: p.split('/')[1] }, f)),
    Object.fromEntries(Object.entries(RESULTS).map(([p, d]) => [d.familyId, S.normalizeResultsDoc(d)]))));
  assert.equal(expected.compared, 6, 'Ethan, Ryan, Zoe, Arjun, Priya and Ivan');
  const head = page.locator('.sr-head-card');
  const ht = await head.innerText();
  assert.match(ht, new RegExp('Went up a grade\\s+' + S.inTen(expected.improvedGrade, expected.graded), 'i'));
  assert.match(ht, /Students compared\s+6/i);
  assert.equal(await page.locator('.sr-sentence').count(), expected.sentences.length);
  assert.match(ht, /of our students improved by at least one grade in school exams after joining Polymath/);
  assert.match(ht, /Only 6 students so far/);
  assert.equal(await page.locator('.sr-kid').count(), 6, 'every child with results, the withdrawn family left out');
  assert.match(await kidCard(page, 'Ethan Tan').innerText(), /Maths\s+Mid-year 58% · ≈AL6 → End-of-year 81% · ≈AL3 ▲ 3 grades · \+23 marks/);
  assert.match(await kidCard(page, 'Zoe Goh').innerText(), /same grade · −2 marks/);
  assert.match(await kidCard(page, 'Ivan Ong').innerText(), /🆕 New from parent/);
  assert.match(await kidCard(page, 'Ryan Lim').innerText(), /PSLE AL4/);
  assert.equal((await page.textContent('[data-count="results"]')).trim(), '1', 'one child has new results from a parent');
  const first = await page.locator('.sr-kid .sr-who b').first().innerText();
  assert.equal(first, 'Ethan Tan', 'the biggest improvement first');
  assert.equal(await page.locator('.sr-kid svg circle').count() > 20, true, 'every result is a dot');
  await shot(page, '01-results-tab');
  ok('the Results tab shows the headline numbers, sentences and every child\'s chart');

  /* 2. Filters: Maths only, then P5 only; a sentence copied. */
  await page.locator('[data-sr="subject"][data-v="Math"]').click();
  await until(head, /in Maths after joining Polymath/);
  assert.equal(await page.locator('.sr-kid').count(), 5, 'children with Maths results');
  await page.selectOption('select[data-sr-in="level"]', 'P5');
  await until(page.locator('.sr-grid'), /Ryan Lim/, true);
  assert.equal(await page.locator('.sr-kid').count(), 2, 'Ethan and Zoe in P5 Maths');
  await page.locator('.sr-sentence').first().locator('[data-sr="copySentence"]').click();
  await until(page.locator('.sr-sentence').first(), /✓ Copied/);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clip, '5 in 10 of our students improved by at least one grade in Maths after joining Polymath.');
  await shot(page, '02-maths-p5');
  await page.locator('[data-sr="subject"][data-v=""]').click();
  await page.selectOption('select[data-sr-in="level"]', '');
  await until(page.locator('.sr-grid'), /Arjun Kumar/);
  ok('the numbers follow the subject and level, and a sentence copies');

  /* 3. One child in full: add, change and remove results. */
  await kidCard(page, 'Ethan Tan').locator('[data-sr="open"]').click();
  const dlg = page.locator('.sr-dialog');
  await until(dlg, /With us since 1 Jun 2026/);
  assert.equal(await dlg.locator('table.sr-results tbody tr').count(), 6);
  assert.match(await dlg.innerText(), /Entered by[\s\S]*Centre/i);
  await shot(page, '03-child', { fullPage: false });
  await dlg.locator('[data-sr="addResult"]').click();
  await dlg.locator('[data-sr="formSubject"][data-v="Science"]').click();
  await dlg.locator('select[data-sr-in="exam"]').selectOption('WA3');
  await page.waitForFunction(() => { const i = document.querySelector('.sr-dialog input[data-sr-in="date"]'); return i && i.value; });
  assert.equal(await dlg.locator('input[data-sr-in="date"]').inputValue(), '2026-08-10', 'the usual WA3 date this year');
  await dlg.locator('input[data-sr-in="mark"]').fill('41');
  await dlg.locator('input[data-sr-in="max"]').fill('40');
  await dlg.locator('[data-sr="saveResult"]').click();
  await until(dlg, /The marks should be between 0 and 40/);
  await dlg.locator('input[data-sr-in="mark"]').fill('31');
  await shot(page, '04-child-add', { fullPage: false });
  await dlg.locator('[data-sr="saveResult"]').click();
  await until(dlg.locator('table.sr-results'), /WA3 \(Weighted Assessment 3\)[\s\S]*31\/40 \(78%\) · ≈AL4/);
  let all = await store(page);
  let ethan = all['officeSettings/results-tanfam'].students.k1;
  assert.equal(ethan.length, 7);
  const added = ethan.find(r => r.subject === 'Science' && r.exam === 'WA3');
  assert.equal(added.by, 'office');
  assert.equal(added.mark, 31);
  assert.equal(all['officeSettings/results-tanfam'].token, TOKEN_TAN, 'the family\'s link is kept');
  // Change it.
  await dlg.locator('tr', { hasText: '31/40' }).locator('[data-sr="editResult"]').click();
  await dlg.locator('input[data-sr-in="mark"]').fill('33');
  await dlg.locator('[data-sr="saveResult"]').click();
  await until(dlg.locator('table.sr-results'), /33\/40/);
  all = await store(page);
  assert.equal(all['officeSettings/results-tanfam'].students.k1.filter(r => r.exam === 'WA3' && r.subject === 'Science').length, 1, 'changed, not added again');
  // Remove the WA1.
  await dlg.locator('tr', { hasText: 'WA1' }).locator('[data-sr="removeResult"]').click();
  await until(dlg.locator('table.sr-results'), /WA1/, true);
  all = await store(page);
  assert.equal(all['officeSettings/results-tanfam'].students.k1.length, 6);
  await dlg.locator('[data-sr="close"]').click();
  ok('a child\'s results are added, corrected and removed in the Office');

  /* 4. A family's link: copy (made the first time), email, WhatsApp. */
  await page.locator('[data-sr="toggleWaiting"]').click();
  const wait = page.locator('table.sr-wait');
  await until(wait, /Lucas Wong/);
  assert.match(await wait.innerText(), /Megan Chua/);
  assert.match(await wait.innerText(), /Hannah Neo/);
  await wait.locator('tr', { hasText: 'Lucas Wong' }).locator('[data-sr="copyLink"]').click();
  await page.waitForFunction(() => window.__fakeStore.has('officeSettings/results-wongfam'));
  all = await store(page);
  const wong = all['officeSettings/results-wongfam'];
  assert.equal(wong.kind, 'school-results');
  assert.equal(wong.familyId, 'wongfam');
  assert.ok(/^[A-Za-z0-9]{24}$/.test(wong.token), 'a 24-character key');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://polymathlc.com.sg/results/?f=wongfam&k=' + wong.token);
  await wait.locator('tr', { hasText: 'Lucas Wong' }).locator('[data-sr="email"]').click();
  await page.waitForFunction(() => [...window.__fakeStore.keys()].some(k => k.startsWith('mail/polymath-office-results-wongfam-')));
  all = await store(page);
  const mailId = Object.keys(all).find(k => k.startsWith('mail/polymath-office-results-wongfam-'));
  const mail = all[mailId];
  assert.deepEqual(mail.to, ['wong@example.com']);
  assert.equal(mail.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.equal(mail.message.subject, 'Share Lucas\'s school results with Polymath');
  assert.ok(mail.message.html.includes('href="https://polymathlc.com.sg/results/?f=wongfam&amp;k=' + wong.token + '"'));
  assert.match(mail.message.text, /Mr Chung/);
  assert.equal(all['officeSettings/results-wongfam'].token, wong.token, 'the same link');
  assert.equal(all['officeSettings/results-wongfam'].linkSentVia, 'email');
  await until(wait.locator('tr', { hasText: 'Lucas Wong' }), /Link sent 20 Nov by email/);
  await wait.locator('tr', { hasText: 'Megan Chua' }).locator('[data-sr="whatsapp"]').click();
  await page.waitForTimeout(400);
  const chat = chats.find(u => u.includes('phone=6591110007'));
  assert.ok(chat && chat.startsWith('https://web.whatsapp.com/send?phone=6591110007&text='), 'WhatsApp Web with the message typed in');
  const wa = new URL(chat).searchParams.get('text');
  assert.match(wa, /^Hi Mrs Chua, this is Polymath Learning Centre/);
  assert.match(wa, /Megan's progress/);
  assert.match(wa, /https:\/\/polymathlc\.com\.sg\/results\/\?f=chuafam&k=[A-Za-z0-9]{24}/);
  await shot(page, '05-waiting-list');
  ok('a family\'s link is made once, copied, emailed and sent on WhatsApp');

  /* 5. Email every family without results. */
  const targets = await page.locator('[data-sr="bulkAsk"]').innerText();
  assert.match(targets, /\(1\)/, 'only Ms Neo: Mr Wong and Mrs Chua were just sent theirs, the others have results');
  await page.locator('[data-sr="bulkAsk"]').click();
  await until(page.locator('.sr-top'), /Email 1 family their results link\?/);
  await shot(page, '06-ask-all');
  await page.locator('[data-sr="bulkYes"]').click();
  await page.waitForFunction(() => [...window.__fakeStore.keys()].some(k => k.startsWith('mail/polymath-office-results-newfam-')));
  await until(page.locator('.sr-top'), /Emailed 1 of 1/);
  ok('every family without results is emailed their link in one go');

  /* 6. The CSV. */
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-sr="csv"]').click()]);
  assert.equal(download.suggestedFilename(), 'polymath-school-results-2026-11-20.csv');
  const csv = readFileSync(await download.path(), 'utf8');
  assert.match(csv.split('\n')[0], /^Student,Level,Parent,With us since,Subject/);
  assert.ok(csv.includes('Ethan Tan,P5,Mrs Tan,2026-06-01,Science,WA3 (Weighted Assessment 3),2026-08-10,33,40,82.5,AL3,yes,office'));
  ok('every result downloads as a CSV');

  /* 7. The parent's page, with the link the office made for the Tan family. */
  all = await store(page);
  serverDb.rows.set('officeFamilies/tanfam', structuredClone(FAMILIES['officeFamilies/tanfam']));
  serverDb.rows.set('officeSettings/results-tanfam', structuredClone(all['officeSettings/results-tanfam']));
  const parent = await ctx.newPage();
  watch(parent, 'parent');
  await parent.clock.setFixedTime(NOW);
  await parent.goto(BASE + '/results/?f=tanfam&k=' + TOKEN_TAN);
  await parent.waitForSelector('.kid');
  assert.match(await parent.textContent('.hero'), /Mrs Tan's family/);
  assert.equal(await parent.locator('.kid').count(), 2);
  const pe = parent.locator('.kid', { hasText: 'Ethan Tan' });
  assert.match(await pe.innerText(), /With Polymath since Jun 2026/);
  assert.match(await pe.innerText(), /MATHS SINCE JOINING\s*58% · ≈AL6 → 81% · ≈AL3 ▲ 3 grades · \+23 marks/i);
  assert.match(await pe.locator('.row', { hasText: '81%' }).innerText(), /Entered by the centre/);
  assert.equal(await pe.locator('svg.sr-chart circle').count(), 6);
  const pc = parent.locator('.kid', { hasText: 'Chloe Tan' });
  assert.match(await pc.innerText(), /No results yet/);
  const body = await parent.textContent('body');
  assert.ok(!body.includes('tan@example.com') && !body.includes('91110001'), 'no contact details on the page');
  await shot(parent, '07-parent-page');
  ok('the parent\'s link shows their children, the charts and before/after');

  // Add Chloe's first result; a wrong one first.
  await pc.locator('[data-a="add"]').click();
  await pc.locator('#f-exam').selectOption('SA2');
  assert.equal(await pc.locator('#f-date').inputValue(), '2026-10-25');
  await pc.locator('#f-mark').fill('88');
  await pc.locator('#f-max').fill('80');
  await pc.locator('[data-a="save"]').click();
  await until(pc, /The marks should be between 0 and 80/);
  await pc.locator('#f-max').fill('100');
  await pc.locator('#f-grade').selectOption('AL2');
  await shot(parent, '08-parent-add');
  await pc.locator('[data-a="save"]').click();
  await until(pc, /End-of-year exam \(SA2\)/);
  let srv = serverDb.rows.get('officeSettings/results-tanfam');
  assert.equal(srv.students.k2.length, 1);
  assert.equal(srv.students.k2[0].by, 'parent');
  assert.equal(srv.students.k2[0].grade, 'AL2');
  assert.equal(srv.parentUpdatedAt, NOW.getTime());
  // A PSLE-style result with only the grade, for Ethan's Science, then changed and removed.
  await pe.locator('[data-a="add"]').click();
  await pe.locator('.seg button.Science').click();
  await pe.locator('#f-exam').selectOption('Test');
  await pe.locator('#f-label').fill('Topical test: Forces');
  await pe.locator('#f-date').fill('2026-11-13');
  await pe.locator('#f-mark').fill('18');
  await pe.locator('#f-max').fill('20');
  await pe.locator('[data-a="save"]').click();
  await until(pe, /Topical test: Forces/);
  await pe.locator('.row', { hasText: 'Topical test: Forces' }).locator('[data-a="edit"]').click();
  await pe.locator('#f-mark').fill('19');
  await pe.locator('[data-a="save"]').click();
  await until(pe.locator('.row', { hasText: 'Topical test: Forces' }), /19 \/ 20/);
  srv = serverDb.rows.get('officeSettings/results-tanfam');
  assert.equal(srv.students.k1.filter(r => r.label === 'Topical test: Forces').length, 1);
  await pe.locator('.row', { hasText: 'Topical test: Forces' }).locator('[data-a="remove"]').click();
  await until(pe, /Topical test: Forces/, true);
  assert.equal(await pe.locator('.row', { hasText: '81%' }).locator('[data-a]').count(), 0, 'no buttons on a result the centre entered');
  // Even a hand-made request cannot change it.
  const forced = await callFunction({ action: 'remove', family: 'tanfam', token: TOKEN_TAN, studentId: 'k1', resultId: srv.students.k1.find(r => r.by === 'office').id });
  assert.equal(forced.statusCode, 403);
  ok('a parent adds, corrects and removes their own results; the centre\'s stay');

  // A broken link.
  const bad = await ctx.newPage();
  watch(bad, 'bad-link');
  await bad.goto(BASE + '/results/?f=tanfam&k=wrongwrongwrongwrongwrong');
  await bad.waitForSelector('.state h1');
  assert.match(await bad.textContent('.state'), /This link does not work[\s\S]*ask the centre for a new one/);
  await bad.close();
  ok('a wrong link says so, with a way to reach the centre');

  /* 8. Back in the Office, the parent's new result is marked 🆕. */
  const back = serverDb.rows.get('officeSettings/results-tanfam');
  await page.evaluate(d => firebase.firestore().collection('officeSettings').doc('results-tanfam').set(d), JSON.parse(JSON.stringify(back)));
  await until(kidCard(page, 'Chloe Tan'), /🆕 New from parent/);
  assert.match(await kidCard(page, 'Chloe Tan').innerText(), /End-of-year 88% · AL2/);
  assert.match(await kidCard(page, 'Ethan Tan').innerText(), /🆕 New from parent/, 'the parent changed Ethan\'s too');
  assert.equal((await page.textContent('[data-count="results"]')).trim(), '3', 'Ivan, Chloe and Ethan');
  await kidCard(page, 'Chloe Tan').locator('[data-sr="open"]').click();
  await page.waitForFunction(() => { const d = window.__fakeStore.get('officeSettings/results-tanfam'); return d && d.officeSeen && d.officeSeen.k2; });
  await page.locator('[data-sr="close"]').click();
  await until(kidCard(page, 'Chloe Tan'), /New from parent/, true);
  assert.match(await kidCard(page, 'Ethan Tan').innerText(), /🆕 New from parent/, 'still new until Ethan is opened');
  await until(page.locator('[data-count="results"]'), /^2$/);
  ok('a parent\'s new result reaches the Office and is marked new until opened');

  /* 9. On a phone: the parent's page and the Results tab. */
  const phone = await browser.newContext(Object.assign({}, devices['iPhone 13'], { locale: 'en-SG', timezoneId: 'Asia/Singapore' }));
  await routeOutside(phone);
  const pp = await phone.newPage();
  watch(pp, 'phone-parent');
  await pp.clock.setFixedTime(NOW);
  await pp.goto(BASE + '/results/?f=tanfam&k=' + TOKEN_TAN);
  await pp.waitForSelector('.kid');
  let width = await pp.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390 + 1, 'the parent page fits a phone (' + width + 'px)');
  await shot(pp, '09-phone-parent', { fullPage: false });
  await pp.locator('.kid', { hasText: 'Chloe Tan' }).locator('[data-a="add"]').click();
  await pp.locator('#f-exam').selectOption('WA3');
  await pp.locator('#form').scrollIntoViewIfNeeded();
  await shot(pp, '10-phone-parent-add', { fullPage: false });
  const po = await phone.newPage();
  watch(po, 'phone-office');
  await po.clock.setFixedTime(NOW);
  await po.addInitScript(seed => { window.__fakeSeed = { docs: seed }; }, SEED);
  await po.goto(BASE + '/office/#results');
  await po.waitForSelector('.sr-kid');
  width = await po.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390 + 1, 'the Results tab fits a phone (' + width + 'px)');
  await shot(po, '11-phone-office', { fullPage: false });
  await po.locator('.sr-kid', { hasText: 'Ethan Tan' }).scrollIntoViewIfNeeded();
  await shot(po, '12-phone-office-kids', { fullPage: false });
  await po.locator('.sr-kid', { hasText: 'Ethan Tan' }).locator('[data-sr="open"]').click();
  await po.waitForSelector('.sr-dialog');
  await shot(po, '13-phone-office-child', { fullPage: false });
  await phone.close();
  ok('both pages work on a phone');

  assert.deepEqual(errors, [], 'no page errors');
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + passed + ' school results browser checks passed. Screenshots in ' + OUT);
