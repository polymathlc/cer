// 💬 Polymath Office — parent WhatsApp lesson updates, end to end, in a real browser.
//
//   PW=/path/to/playwright/index.mjs node tools/office-lessons-browser.mjs
//
// Serves the SHIPPED office/ page with Firebase replaced by
// tools/office-fake-firebase.js and WhatsApp replaced by a stand-in page, so
// nothing is sent anywhere. It is Saturday 21 Nov 2026, 11:30 in Singapore: the
// 9am P5 Science lesson is over and the 11am P6 Maths lesson is on. As the admin:
//   the Lessons tab shows both classes, what each covered, and every family with
//   the message written → one family's message → the class's homework typed once
//   (every message follows) → 💬 Send opens WhatsApp Web with the text typed in and
//   marks the family sent → undo → an edited message → ▶ Send to everyone (the
//   queue) → a family taken off the list → the settings (focus on) → another day →
//   the tab on a phone (the WhatsApp app link, wa.me) → 🙋 attendance: an absent
//   child's message, "not joined yet" during a lesson, and hand corrections.
// Screenshots go to OFFICE_SHOTS (default artifacts/office-lessons).
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as C from '../office/office-core.mjs';
import * as L from '../office/lesson-updates-core.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.OFFICE_SHOTS || join(ROOT, 'artifacts', 'office-lessons');
if (!process.env.PW) throw new Error('Set PW (playwright index.mjs).');
mkdirSync(OUT, { recursive: true });
const { chromium, devices } = await import(process.env.PW);
const SG = 8 * 3600 * 1000;
const sg = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - SG;
const NOW = new Date(sg(2026, 11, 21, 11, 30));   // Saturday 21 Nov 2026, 11:30 in Singapore

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
const chats = [];   // every WhatsApp URL opened
async function routeOutside(context) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const url = route.request().url();
    if (url.startsWith('https://www.gstatic.com/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: url.includes('app-compat') ? FAKE_FB : '' });
    if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.includes('qrcode')) return route.fulfill({ contentType: 'text/javascript', body: QR_STUB });
    if (url.includes('officeSettings/config')) return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    if (url.startsWith('https://web.whatsapp.com/') || url.startsWith('https://wa.me/') || url.startsWith('https://api.whatsapp.com/')) {
      chats.push(url);
      return route.fulfill({ contentType: 'text/html', body: '<title>WhatsApp stand-in</title><p>WhatsApp would open here.</p>' });
    }
    return route.abort();
  });
}

/* ─── The centre on Saturday 21 Nov 2026 ─── */
const SCHEDULE = {
  monthlyFee: 220, monthlyFeeOnline: 180,
  slots: {
    'SAT-1': { level: 'P5', subject: 'Science', mode: 'Both', status: 'open', type: 'regular' },
    'SAT-2': { level: 'P6', subject: 'Math', mode: 'Both', status: 'open', type: 'regular' },
    'FRI-1': { level: 'P4', subject: 'Math', mode: 'Both', status: 'open', type: 'regular' }
  }
};
const kid = (id, name, level, slots, mode) => ({ id, name, level, status: 'active', startDate: '2026-09-01', classes: slots.map(s => ({ slotId: s, mode: mode || 'Physical' })) });
const FAMILIES = {
  'officeFamilies/tan': { code: 'TAN2AA', parentName: 'Mrs Tan', email: 'tan@example.com', whatsapp: '91110001', status: 'active', students: [kid('k1', 'Ethan Tan', 'P5', ['SAT-1']), kid('k2', 'Chloe Tan', 'P5', ['SAT-1'], 'Online')] },
  'officeFamilies/lim': { code: 'LIM3BB', parentName: 'Mr Lim', email: '', whatsapp: '91110002', status: 'active', students: [kid('k3', 'Ryan Lim', 'P5', ['SAT-1'])] },
  'officeFamilies/goh': { code: 'GOH4CC', parentName: 'Ms Goh', email: 'goh@example.com', whatsapp: '', status: 'active', students: [kid('k4', 'Zoe Goh', 'P5', ['SAT-1'])] },
  'officeFamilies/raj': { code: 'RAJ5DD', parentName: 'Mr Rajesh Kumar', email: 'raj@example.com', whatsapp: '91110004', status: 'active', students: [kid('k5', 'Arjun Kumar', 'P5', ['SAT-1'], 'Online'), kid('k6', 'Priya Kumar', 'P6', ['SAT-2'])] },
  'officeFamilies/ong': { code: 'ONG6EE', parentName: 'Mdm Ong', email: 'ong@example.com', whatsapp: '91110005', status: 'active', students: [kid('k7', 'Ivan Ong', 'P6', ['SAT-2'])] },
  'officeFamilies/chua': { code: 'CHU8GG', parentName: 'Mrs Chua', email: 'chua@example.com', whatsapp: '91110007', status: 'active', students: [kid('k9', 'Megan Chua', 'P4', ['FRI-1'])] },
  'officeFamilies/left': { code: 'LEF7FF', parentName: 'Mr Left', email: 'left@example.com', whatsapp: '91110006', status: 'withdrawn', lastMonth: '2026-09', students: [kid('k8', 'Gone Kid', 'P5', ['SAT-1'])] }
};
const COURSES = {
  // Plant Transport was current; the 9am lesson (released 11am) moved it on.
  'onlineCourses/sci5': { level: 'P5', subject: 'science', day: 'Saturday', slot: 0, worksheetIds: ['w1', 'w2', 'w3', 'w4', 'w5'], currentIndex: 2, clockAt: sg(2026, 11, 14, 11) },
  // The 11am P6 Maths lesson is on now, on Ratio 2.
  'onlineCourses/math6': { level: 'P6', subject: 'math', day: 'Saturday', slot: 1, worksheetIds: ['m1', 'm2', 'm3'], currentIndex: 1, clockAt: sg(2026, 11, 14, 13) }
};
const NAMES = {
  'pdfAnnotator/w3': { name: 'Plant Transport System' }, 'pdfAnnotator/w4': { name: 'Human Circulatory System' },
  'pdfAnnotator/m2': { name: 'Ratio 2: Changing Ratios' }, 'pdfAnnotator/m3': { name: 'Percentage 1' }
};
const row = (e, h, mi, q, a, r, hh, k, f) => ({ e, d: sg(2026, 11, 21, h, mi), l: 'Sat', m: 100, q, a, r, h: hh, k, s: 40, f });
const BOOK = { v: 1, students: {
  'r:tan_k1': { name: 'Ethan Tan', rows: [row(1800, 9, 1, 10, 10, 9, 0, 10, 96)] },
  'r:tan_k2': { name: 'Chloe Tan', rows: [row(1800, 9, 3, 10, 8, 5, 1, 8, 81)] },
  'r:lim_k3': { name: 'Ryan Lim', rows: [row(1800, 9, 2, 10, 9, 7, 0, 9, 92)] },
  'r:raj_k5': { name: 'Arjun Kumar', rows: [row(1800, 9, 4, 10, 6, 2, 1, 6, 64)] },
  'r:ong_k7': { name: 'Ivan Ong', rows: [row(1900, 11, 2, 4, 4, 3, 0, 4, 99)] }
} };
const SEED = Object.assign({
  'schedule_config/main': SCHEDULE,
  'officeSettings/config': { invoiceDay: 1, dueDays: 7, combinedMonths: [] },
  'users/teacherUid/liveClassProgress/main': { json: JSON.stringify(BOOK) }
}, FAMILIES, COURSES, NAMES);

const errors = [];
async function shot(page, name, opts) {
  await page.waitForTimeout(250);
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('show'); });
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
const fam = (page, parent) => page.locator('.lu-fam', { hasText: parent });
const card = (page, title) => page.locator('.lu-class', { hasText: title });
const DAY = 'officeSettings/lessonupd-2026-11-21';
const textOf = url => new URL(url).searchParams.get('text');
// Waits until a part of the page does (or no longer does) match.
async function until(locator, re, gone) {
  for (let i = 0; i < 100; i++) {
    const t = await locator.innerText().catch(() => '');
    if (gone ? !re.test(t) : re.test(t)) return t;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for ' + re + (gone ? ' to go' : '') + ' in: ' + (await locator.innerText().catch(() => '')).slice(0, 600));
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'], locale: 'en-SG', timezoneId: 'Asia/Singapore' });
  await routeOutside(ctx);
  const page = await ctx.newPage();
  watch(page, 'office');
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(seed => { window.__fakeSeed = { docs: seed }; }, SEED);
  await page.goto(BASE + '/office/#lessons');
  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForSelector('.lu-class').catch(async e => { console.log('VIEW:', (await page.textContent('#view').catch(() => '')).slice(0, 800), errors); throw e; });
  await page.waitForFunction(() => /Plant Transport System/.test(document.getElementById('view').textContent), null, { timeout: 8000 })
    .catch(async e => { console.log('NAMES:', await page.evaluate(() => JSON.stringify([window.PolymathLessonUpdates.R.docNames, window.PolymathLessonUpdates.R.namesAsked, Object.keys(window.__fakeStore ? Object.fromEntries(window.__fakeStore) : {}).filter(k => k.startsWith('pdf'))])), errors); throw e; });

  /* 1. The day: both Saturday classes, in lesson order. */
  assert.equal(await page.locator('.lu-class').count(), 2);
  const titles = await page.locator('.lu-class h2').allInnerTexts();
  assert.match(titles[0], /P5 Science\s+Lesson over/);
  assert.match(titles[1], /P6 Maths\s+In the lesson now/);
  assert.match(await page.textContent('.lu-daybar'), /Today, Sat 21 Nov/);
  const sci = card(page, 'P5 Science');
  assert.match(await sci.innerText(), /Covered: Plant Transport System/);
  assert.match(await sci.innerText(), /Next: Human Circulatory System \(Sat 28 Nov\)/);
  assert.match(await card(page, 'P6 Maths').innerText(), /Covered: Ratio 2: Changing Ratios/);
  assert.equal(await sci.locator('.lu-fam').count(), 4, 'the withdrawn family is not listed');
  assert.match(await fam(page, 'Ms Goh').innerText(), /No WhatsApp number/);
  assert.equal(await fam(page, 'Ms Goh').locator('[data-lu="send"]').count(), 0);
  assert.equal(await fam(page, 'Ms Goh').locator('[data-act="openFamily"]').count(), 1, 'a link to add the number');
  assert.match(await fam(page, 'Mrs Tan').innerText(), /Ethan · 10\/10 answered\s*90%/);
  assert.match(await fam(page, 'Mrs Tan').innerText(), /Chloe · 8\/10 answered\s*69%/);
  assert.match(await sci.locator('[data-lu="queue"]').innerText(), /Send to 3 parents/);
  assert.equal((await page.textContent('[data-count="lessons"]')).trim(), '5', '3 in Science and 2 in Maths still to send');
  assert.equal(await page.locator('.lu-fam', { hasText: 'Mrs Chua' }).count(), 0, 'a Friday class is not on Saturday');
  await shot(page, '01-lessons-tab');
  ok('the Lessons tab shows each class of the day, what it covered and every family');

  /* 2. One family's message, written in full. */
  await fam(page, 'Mrs Tan').locator('[data-lu="toggle"]').click();
  const pre = () => fam(page, 'Mrs Tan').locator('pre').innerText();
  let t = await pre();
  assert.match(t, /^Hi Mrs Tan, here is Ethan and Chloe's lesson update from Polymath Learning Centre 😊/);
  assert.match(t, /📚 \*P5 Science\* · Sat 21 Nov, 9:00am/);
  assert.match(t, /✏️ Today: Plant Transport System/);
  assert.match(t, /⭐ How they did:\n• Ethan answered 10 of 10 questions; 9 of the 10 marked were right \(90%\)\. Excellent work! 🌟\n• Chloe answered 8 of 10 questions; 5 of the 8 marked were right and 1 partly right \(69%\)\. Good effort 👍/);
  assert.match(t, /📝 Homework: Finish any questions left on today's worksheet/);
  assert.match(t, /⏭ Next lesson \(Sat 28 Nov\): Human Circulatory System/);
  assert.match(t, /🔑 The answer key and lesson video are on Polymath Online: https:\/\/polymathlc\.com\.sg\/online\//);
  await shot(page, '02-message');
  ok('a family\'s message says what was covered, how each child did, the homework and what is next');

  /* 3. The class's homework, typed once, goes into every message. */
  await sci.locator('textarea[data-lu-in="hw"]').fill('Complete Q11 to Q20 of Plant Transport System.');
  await sci.locator('[data-lu="saveHw"]').click();
  await until(fam(page, 'Mrs Tan'), /Complete Q11 to Q20/);
  t = await pre();
  assert.match(t, /📝 Homework: Complete Q11 to Q20 of Plant Transport System\.\n/);
  let all = await store(page);
  assert.equal(all[DAY].notes['SAT-1'].homework, 'Complete Q11 to Q20 of Plant Transport System.');
  assert.equal(all[DAY].kind, 'lesson-updates-day');
  await sci.locator('textarea[data-lu-in="note"]').fill('Science test next Saturday on plant and human transport.');
  await sci.locator('[data-lu="saveNote"]').click();
  await until(fam(page, 'Mrs Tan'), /Science test next Saturday/);
  all = await store(page);
  assert.equal(all[DAY].notes['SAT-1'].homework, 'Complete Q11 to Q20 of Plant Transport System.', 'saving the note keeps the homework');
  assert.equal(all[DAY].notes['SAT-1'].note, 'Science test next Saturday on plant and human transport.');
  ok('the homework and a note are typed once for the class and every message follows');

  /* 4. 💬 Send: WhatsApp Web opens with the message typed in; the family is marked sent. */
  const sendLink = fam(page, 'Mrs Tan').locator('[data-lu="send"]');
  const href = await sendLink.getAttribute('href');
  assert.ok(href.startsWith('https://web.whatsapp.com/send?phone=6591110001&text='), href);
  assert.equal(await sendLink.getAttribute('target'), 'polymath_whatsapp', 'the same WhatsApp Web tab as the invoice queue');
  const [chat] = await Promise.all([ctx.waitForEvent('page'), sendLink.click()]);
  await chat.waitForLoadState();
  assert.equal(textOf(chat.url()), await pre());
  await page.bringToFront();
  await until(fam(page, 'Mrs Tan'), /Sent 11:30am/);
  all = await store(page);
  assert.equal(all[DAY].sent['SAT-1__tan'].by, 'chungzhikai@gmail.com');
  assert.equal(all[DAY].sent['SAT-1__tan'].phone, '6591110001');
  assert.match(await sci.locator('[data-lu="queue"]').innerText(), /Send to 2 parents/);
  await shot(page, '03-sent');
  // Undo.
  await fam(page, 'Mrs Tan').locator('[data-lu="unsend"]').click();
  await until(fam(page, 'Mrs Tan'), /Sent 11:30am/, true);
  all = await store(page);
  assert.equal(all[DAY].sent['SAT-1__tan'], undefined);
  assert.equal(all[DAY].notes['SAT-1'].note, 'Science test next Saturday on plant and human transport.', 'undo leaves the rest of the day alone');
  ok('💬 Send opens WhatsApp Web with the message typed in and marks the family sent (and it can be undone)');

  /* 5. An edited message. */
  await fam(page, 'Mrs Tan').locator('[data-lu="edit"]').click();
  const box = fam(page, 'Mrs Tan').locator('textarea[data-lu-in="edit"]');
  await box.fill((await box.inputValue()) + '\nPS: Chloe did very well on the diagram question!');
  await fam(page, 'Mrs Tan').locator('[data-lu="saveEdit"]').click();
  await until(fam(page, 'Mrs Tan').locator('pre'), /PS: Chloe did very well/);
  assert.match(decodeURIComponent(await fam(page, 'Mrs Tan').locator('[data-lu="send"]').getAttribute('href')), /PS: Chloe did very well/);
  all = await store(page);
  assert.match(all[DAY].edits['SAT-1__tan'], /PS: Chloe did very well/);
  assert.match(await fam(page, 'Mrs Tan').innerText(), /You edited this message/);
  await fam(page, 'Mrs Tan').locator('[data-lu="resetEdit"]').click();
  await until(fam(page, 'Mrs Tan').locator('pre'), /PS: Chloe/, true);
  all = await store(page);
  assert.equal(all[DAY].edits['SAT-1__tan'], undefined);
  await fam(page, 'Mrs Tan').locator('[data-lu="toggle"]').click();
  ok('a message can be edited before sending, and put back to the automatic one');

  /* 6. ▶ Send to everyone in the class: the WhatsApp queue. */
  await sci.locator('[data-lu="queue"]').click();
  await page.waitForSelector('#lu-overlay');
  assert.match(await page.textContent('#lu-overlay'), /P5 Science lesson updates — 1 of 3/);
  assert.match(await page.textContent('#lu-overlay'), /Mr Lim/);
  await shot(page, '04-queue', { fullPage: false });
  const opened = [];
  for (let i = 0; i < 3; i++) {
    const who = (await page.locator('#lu-overlay h3').innerText()).trim();
    const [p] = await Promise.all([ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null), page.click('#lu-overlay [data-lu="queueSend"]')]);
    opened.push(who);
    await page.waitForSelector('#lu-overlay .banner.green');
    if (i === 0) await shot(page, '05-queue-opened', { fullPage: false });
    if (p) await p.close().catch(() => {});
    await page.bringToFront();
    await page.click('#lu-overlay [data-lu="queueNext"]');
    await until(page.locator('#lu-overlay'), new RegExp((i + 2) + ' of 3|All done'));
  }
  assert.deepEqual(opened, ['Mr Lim', 'Mr Rajesh Kumar', 'Mrs Tan']);
  assert.match(await page.textContent('#lu-overlay'), /All done/);
  assert.match(await page.textContent('#lu-overlay'), /3 chats opened/);
  await page.click('#lu-overlay [data-lu="queueClose"]');
  all = await store(page);
  assert.deepEqual(Object.keys(all[DAY].sent).sort(), ['SAT-1__lim', 'SAT-1__raj', 'SAT-1__tan']);
  assert.match(await sci.innerText(), /✓ All sent/);
  assert.match(await sci.innerText(), /3 sent · 1 without a number/);
  const limChat = chats.find(u => u.includes('phone=6591110002'));
  assert.match(textOf(limChat), /^Hi Mr Lim, here is Ryan's lesson update/);
  assert.match(textOf(limChat), /How Ryan did: answered 9 of 10 questions; 7 of the 9 marked were right \(78%\)\. Good effort 👍/);
  await shot(page, '06-all-sent');
  ok('▶ Send to everyone walks through each parent in the WhatsApp queue and marks each one sent');

  /* 7. A family taken off the list. */
  const maths = card(page, 'P6 Maths');
  await fam(page, 'Mdm Ong').locator('[data-lu="toggle"]').click();
  await fam(page, 'Mdm Ong').locator('input[data-lu="optOut"]').check();
  await until(fam(page, 'Mdm Ong'), /Off the list/);
  all = await store(page);
  assert.equal(all['officeSettings/lessonUpdates'].optOut.ong, true);
  assert.match(await maths.locator('[data-lu="queue"]').innerText(), /Send to 1 parent$/);
  await fam(page, 'Mdm Ong').locator('input[data-lu="optOut"]').uncheck();
  await until(fam(page, 'Mdm Ong'), /Off the list/, true);
  all = await store(page);
  assert.equal((all['officeSettings/lessonUpdates'].optOut || {}).ong, undefined, 'back on the list really leaves the map');
  ok('a family can be taken off the list and put back');

  /* 8. Settings: the usual homework line, focus on. */
  await page.click('[data-lu="settingsOpen"]');
  await page.locator('input[data-lu="setChk"][data-k="showFocus"]').check();
  await page.locator('textarea[data-lu-in="set"][data-k="homeworkDefault"]').fill('Revise today\'s worksheet for 15 minutes.');
  await page.click('[data-lu="settingsSave"]');
  await page.waitForFunction(() => !document.querySelector('[data-lu="settingsSave"]'));
  all = await store(page);
  assert.equal(all['officeSettings/lessonUpdates'].showFocus, true);
  assert.equal(all['officeSettings/lessonUpdates'].homeworkDefault, 'Revise today\'s worksheet for 15 minutes.');
  await fam(page, 'Mdm Ong').locator('[data-lu="toggle"]').click().catch(() => {});
  if (!(await fam(page, 'Mdm Ong').locator('pre').count())) await fam(page, 'Mdm Ong').locator('[data-lu="toggle"]').click();
  t = await fam(page, 'Mdm Ong').locator('pre').innerText();
  assert.match(t, /How Ivan did: answered 4 of 4 questions; 3 of the 4 marked were right \(75%\), focus 99%\. Good effort 👍/);
  assert.match(t, /📝 Homework: Revise today's worksheet for 15 minutes\./, 'a class without its own line uses the usual one');
  assert.match(t, /on Polymath Online from 1:00pm/, 'the Maths lesson is still on: the answer key opens at 1pm');
  assert.equal(await sci.locator('textarea[data-lu-in="hw"]').inputValue(), 'Complete Q11 to Q20 of Plant Transport System.', 'the Science class keeps its own homework');
  await shot(page, '07-settings-applied');
  ok('the settings change every message: the usual homework line and the focus %');

  /* 9. Another day. */
  await page.click('[data-lu="dayPrev"]');
  await page.waitForFunction(() => /Yesterday, Fri 20 Nov/.test(document.querySelector('.lu-daybar').textContent));
  assert.match(await page.textContent('#view'), /P4 Maths/);
  assert.match(await page.textContent('#view'), /P4 Maths[\s\S]*Lesson over/);
  await page.click('[data-lu="dayPrev"]');
  await page.waitForFunction(() => /Thu 19 Nov/.test(document.querySelector('.lu-daybar').textContent));
  assert.match(await page.textContent('#view'), /No classes on Thu 19 Nov/);
  await page.click('[data-lu="dayToday"]');
  await page.waitForFunction(() => /Today, Sat 21 Nov/.test(document.querySelector('.lu-daybar').textContent));
  assert.match(await card(page, 'P5 Science').innerText(), /✓ All sent/, 'today still knows who was sent');
  ok('◀ ▶ moves between days and each day keeps its own record');

  /* 10. On a phone: the WhatsApp app link, everything stacked. */
  const phone = await browser.newContext(Object.assign({}, devices['iPhone 13'], { locale: 'en-SG', timezoneId: 'Asia/Singapore' }));
  await routeOutside(phone);
  const pp = await phone.newPage();
  watch(pp, 'phone');
  await pp.clock.setFixedTime(NOW);
  await pp.addInitScript(seed => { window.__fakeSeed = { docs: seed }; }, Object.assign({}, SEED, { [DAY]: { kind: 'lesson-updates-day', day: '2026-11-21', sent: { 'SAT-1__lim': { at: sg(2026, 11, 21, 11, 10), by: 'chungzhikai@gmail.com' } } } }));
  await pp.goto(BASE + '/office/#lessons');
  await pp.waitForSelector('.lu-class');
  await pp.waitForFunction(() => /Plant Transport System/.test(document.getElementById('view').textContent));
  const phref = await pp.locator('.lu-fam', { hasText: 'Mrs Tan' }).locator('[data-lu="send"]').getAttribute('href');
  assert.ok(phref.startsWith('https://wa.me/6591110001?text='), 'on a phone the link opens the WhatsApp app');
  const width = await pp.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390 + 1, 'nothing runs off the side of a phone (' + width + 'px)');
  await shot(pp, '08-phone', { fullPage: false });
  await pp.locator('.lu-fam', { hasText: 'Mrs Tan' }).locator('[data-lu="toggle"]').click();
  await pp.locator('.lu-fam', { hasText: 'Mrs Tan' }).locator('pre').waitFor();
  await pp.evaluate(() => { const el = [...document.querySelectorAll('.lu-fam')].find(x => /Mrs Tan/.test(x.textContent)); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); });
  await shot(pp, '09-phone-message', { fullPage: false });
  await pp.locator('.lu-class', { hasText: 'P5 Science' }).locator('[data-lu="queue"]').click();
  await pp.waitForSelector('#lu-overlay');
  await shot(pp, '10-phone-queue', { fullPage: false });
  await phone.close();
  ok('the Lessons tab works on a phone and opens the WhatsApp app');

  /* 11. 🙋 Attendance: the live class's record, an absent child's message, "not joined yet", a hand mark. */
  const ATT = 'officeSettings/attend-2026-11-21';
  const bookNoRyan = JSON.parse(JSON.stringify(BOOK));
  delete bookNoRyan.students['r:lim_k3'];
  const attSeed = Object.assign({}, SEED, {
    'users/teacherUid/liveClassProgress/main': { json: JSON.stringify(bookNoRyan) },
    [ATT]: { kind: 'attendance-day', day: '2026-11-21',
      live: {
        'SAT-1': { epoch: 1800, slot: 'SAT-1', label: 'Sat 9:00am · P5 Science', start: sg(2026, 11, 21, 9), end: sg(2026, 11, 21, 10, 45), release: sg(2026, 11, 21, 11),
          startedAt: sg(2026, 11, 21, 8, 50), dueAt: sg(2026, 11, 21, 9, 10), checkedAt: sg(2026, 11, 21, 10, 46), closedAt: sg(2026, 11, 21, 10, 46), final: true,
          expected: { tan_k1: 'Ethan Tan', tan_k2: 'Chloe Tan', lim_k3: 'Ryan Lim', goh_k4: 'Zoe Goh', raj_k5: 'Arjun Kumar' },
          joined: { tan_k1: sg(2026, 11, 21, 8, 58), tan_k2: sg(2026, 11, 21, 9, 3), goh_k4: sg(2026, 11, 21, 9, 1), raj_k5: sg(2026, 11, 21, 9, 4) } },
        'SAT-2': { epoch: 1900, slot: 'SAT-2', label: 'Sat 11:00am · P6 Maths', start: sg(2026, 11, 21, 11), end: sg(2026, 11, 21, 12, 45), release: sg(2026, 11, 21, 13),
          startedAt: sg(2026, 11, 21, 10, 55), dueAt: sg(2026, 11, 21, 11, 10), checkedAt: sg(2026, 11, 21, 11, 29), final: false,
          expected: { raj_k6: 'Priya Kumar', ong_k7: 'Ivan Ong' }, joined: { ong_k7: sg(2026, 11, 21, 11, 2) } }
      },
      alerts: {
        'SAT-1__lim_k3': { late: { at: sg(2026, 11, 21, 9, 11), to: [], id: 'x' }, catchup: { at: sg(2026, 11, 21, 10, 46), to: [], id: 'y' } },
        'SAT-2__raj_k6': { late: { at: sg(2026, 11, 21, 11, 11), to: ['raj@example.com'], id: 'z' } }
      } }
  });
  const actx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, locale: 'en-SG', timezoneId: 'Asia/Singapore' });
  await routeOutside(actx);
  const ap = await actx.newPage();
  watch(ap, 'attendance');
  await ap.clock.setFixedTime(NOW);
  await ap.addInitScript(seed => { window.__fakeSeed = { docs: seed }; }, attSeed);
  await ap.goto(BASE + '/office/#lessons');
  await ap.waitForSelector('.lu-class');
  await ap.waitForFunction(() => /Plant Transport System/.test(document.getElementById('view').textContent) && /Attendance:/.test(document.getElementById('view').textContent));
  const asci = card(ap, 'P5 Science');
  assert.match(await asci.locator('.lu-attline').innerText(), /Attendance: 4 here · 1 absent/);
  assert.match(await fam(ap, 'Mr Lim').innerText(), /Ryan\s*❌ Absent · catch-up emailed 10:46am/);
  assert.match(await fam(ap, 'Mrs Tan').innerText(), /Ethan · 10\/10 answered\s*90%\s*✅ Joined 8:58am/);
  await fam(ap, 'Mr Lim').locator('[data-lu="toggle"]').click();
  let at = await fam(ap, 'Mr Lim').locator('pre').innerText();
  assert.match(at, /⚠️ Ryan was absent from today's lesson\./);
  assert.match(at, /✏️ The class covered: Plant Transport System/);
  assert.match(at, /📚 To catch up: work through "Plant Transport System" and check it with the answer key and lesson video on Polymath Online: https:\/\/polymathlc\.com\.sg\/online\//);
  assert.doesNotMatch(at, /How Ryan did/);
  await shot(ap, '11-attendance-absent');
  // The P6 Maths lesson is on: Priya has not joined, her parent was emailed at 11:11, and the office can WhatsApp too.
  const amaths = card(ap, 'P6 Maths');
  assert.match(await amaths.locator('.lu-attline').innerText(), /Attendance: 1 here · 1 not joined yet/);
  const raj = amaths.locator('.lu-fam', { hasText: 'Mr Rajesh Kumar' });
  assert.match(await raj.innerText(), /Priya\s*⏳ Not joined yet · parent emailed 11:11am/);
  const nj = raj.locator('[data-lu="notJoined"]');
  const njHref = await nj.getAttribute('href');
  assert.match(decodeURIComponent(njHref), /Hi Mr Rajesh Kumar, Priya has not joined today's P6 Maths lesson yet \(it started at 11:00am\)/);
  const [njChat] = await Promise.all([actx.waitForEvent('page'), nj.click()]);
  await njChat.waitForLoadState();
  await njChat.close();
  await ap.bringToFront();
  await until(raj, /Not joined \(sent\)/);
  let astore = await store(ap);
  assert.ok(astore[ATT].wa['SAT-2__raj_k6'].at > 0, 'the tap is remembered');
  await ap.evaluate(() => { const el = document.querySelector('.lu-class:nth-of-type(2)') || [...document.querySelectorAll('.lu-class')][1]; if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); });
  await shot(ap, '12-attendance-not-joined', { fullPage: false });
  // Ryan was really on Zoom: ✓ Here puts it right, and his message is the usual one again.
  await fam(ap, 'Mr Lim').locator('[data-lu="attMark"][data-v="here"]').click();
  await until(fam(ap, 'Mr Lim'), /Here \(marked by hand\)/);
  at = await fam(ap, 'Mr Lim').locator('pre').innerText();
  assert.doesNotMatch(at, /absent/);
  astore = await store(ap);
  assert.equal(astore[ATT].marks['SAT-1__lim_k3'].s, 'here');
  assert.equal(astore[ATT].marks['SAT-1__lim_k3'].by, 'chungzhikai@gmail.com');
  assert.equal(astore[ATT].live['SAT-1'].final, true, 'the live class\'s record is left alone');
  // ✗ Absent by hand, then ↺ Auto back to what the live class saw.
  await fam(ap, 'Mrs Tan').locator('[data-lu="attMark"][data-r="tan_k2"][data-v="absent"]').click();
  await until(fam(ap, 'Mrs Tan'), /Absent \(marked by hand\)/);
  await fam(ap, 'Mrs Tan').locator('[data-lu="toggle"]').click();
  at = await fam(ap, 'Mrs Tan').locator('pre').innerText();
  assert.match(at, /⭐ How they did:\n• Ethan answered 10 of 10[^\n]*\n• Chloe was absent today/);
  await fam(ap, 'Mrs Tan').locator('[data-lu="attMark"][data-r="tan_k2"][data-v=""]').click();
  await until(fam(ap, 'Mrs Tan'), /Absent \(marked by hand\)/, true);
  astore = await store(ap);
  assert.equal((astore[ATT].marks || {})['SAT-1__tan_k2'], undefined, '↺ Auto removes the hand mark');
  await actx.close();
  // On a phone.
  const aphone = await browser.newContext(Object.assign({}, devices['iPhone 13'], { locale: 'en-SG', timezoneId: 'Asia/Singapore' }));
  await routeOutside(aphone);
  const app2 = await aphone.newPage();
  watch(app2, 'attendance phone');
  await app2.clock.setFixedTime(NOW);
  await app2.addInitScript(seed => { window.__fakeSeed = { docs: seed }; }, attSeed);
  await app2.goto(BASE + '/office/#lessons');
  await app2.waitForFunction(() => /Attendance:/.test((document.getElementById('view') || {}).textContent || ''));
  const w2 = await app2.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w2 <= 390 + 1, 'nothing runs off the side of a phone (' + w2 + 'px)');
  await app2.locator('.lu-fam', { hasText: 'Mr Lim' }).locator('[data-lu="toggle"]').click();
  await app2.evaluate(() => { const el = [...document.querySelectorAll('.lu-fam')].find(x => /Mr Lim/.test(x.textContent)); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); });
  await shot(app2, '13-attendance-phone', { fullPage: false });
  await aphone.close();
  ok('🙋 attendance: absent children are said to be absent with a catch-up, "not joined yet" is one tap, and the office can correct it');

  assert.deepEqual(errors, [], 'no page errors');
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + passed + ' lesson update browser checks passed. Screenshots in ' + OUT);
