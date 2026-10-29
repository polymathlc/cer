// 🏢 Polymath Office — the whole month, end to end, in a real browser.
//
//   PW=/path/to/playwright/index.mjs OFFICE_LIBS=/path/to/node_modules node tools/office-browser.mjs
//
// OFFICE_LIBS must hold qrcodejs@1.0.0, jsqr@1.4.0, pdfjs-dist@3.11.174, xlsx@0.18.5,
// pdf-lib and pngjs (the CDN files the pages load are served from there).
// It serves the SHIPPED office/ and pay/ pages with Firebase replaced by
// tools/office-fake-firebase.js and every other outside request answered locally
// or refused, so nothing is emailed, stored or charged. Then, as the admin:
//   import a sheet of families → fix a class → prepare November invoices → email
//   them (QR inline + attached) → WhatsApp the family without email → upload a PDF
//   bank statement (read by a stand-in ChatGPT) → apply → upload it AGAIN (all
//   skipped) → a CSV statement → reminders → the parent's /pay page on a phone.
// Every PayNow QR it meets is decoded with jsQR and held against the payload.
// Screenshots go to OFFICE_SHOTS (default artifacts/office).
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as C from '../office/office-core.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIBS = process.env.OFFICE_LIBS;
const OUT = process.env.OFFICE_SHOTS || join(ROOT, 'artifacts', 'office');
if (!process.env.PW || !LIBS) throw new Error('Set PW (playwright index.mjs) and OFFICE_LIBS (node_modules with the page libraries).');
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(process.env.PW);
const { PDFDocument, StandardFonts } = await import(join(LIBS, 'pdf-lib', 'cjs', 'index.js'));
const { PNG } = await import(join(LIBS, 'pngjs', 'lib', 'png.js'));
const jsQR = (await import(join(LIBS, 'jsqr', 'dist', 'jsQR.js'))).default;
const NOW = new Date('2026-11-03T02:00:00Z');   // Tuesday 3 Nov 2026, 10:00 in Singapore

/* ─── a static server for the repo ─── */
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

/* ─── the outside world, answered locally ─── */
const LIB = {
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js': join(LIBS, 'qrcodejs', 'qrcode.min.js'),
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js': join(LIBS, 'pdfjs-dist', 'build', 'pdf.min.js'),
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js': join(LIBS, 'pdfjs-dist', 'build', 'pdf.worker.min.js'),
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js': join(LIBS, 'xlsx', 'dist', 'xlsx.full.min.js'),
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js': join(LIBS, 'jsqr', 'dist', 'jsQR.js')
};
const FAKE_FB = readFileSync(join(ROOT, 'tools', 'office-fake-firebase.js'), 'utf8');
let linkDocs = {};   // token → data, for the parent's page
let lockStatus = 403;
const outside = [];
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') { const f = {}; Object.keys(v).forEach(k => { f[k] = toFs(v[k]); }); return { mapValue: { fields: f } }; }
  return { nullValue: null };
}
async function routeOutside(context) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const url = route.request().url();
    if (url.startsWith('https://www.gstatic.com/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: url.includes('app-compat') ? FAKE_FB : '' });
    if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (LIB[url]) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(LIB[url]) });
    if (url.startsWith('https://web.whatsapp.com/') || url.startsWith('https://wa.me/')) return route.fulfill({ contentType: 'text/html', body: '<title>WhatsApp stand-in</title>' });
    if (url.startsWith('https://firestore.googleapis.com/')) {
      const m = url.match(/officeLinks\/([A-Za-z0-9]+)/);
      if (m) {
        const d = linkDocs[m[1]];
        return d ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: toFs(d).mapValue.fields }) }) : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      }
      if (url.includes('officeSettings/config')) return route.fulfill({ status: lockStatus, contentType: 'application/json', body: '{}' });
    }
    outside.push(url);
    return route.abort();
  });
}

/* ─── the stand-in ChatGPT ─── */
const AI_SCRIPT = `
window.__fakeAi = function (prompt) {
  if (/Reply with JSON \\{"ok":true/.test(prompt)) return JSON.stringify({ ok: true, engine: 'gpt-fake' });
  if (/List EVERY money-IN transaction/.test(prompt)) return JSON.stringify({ credits: window.__fakeStatementCredits || [], from: '2026-11-01', to: '2026-11-30', bank: 'POSB' });
  if (/which family each one is from/.test(prompt)) {
    const roster = JSON.parse(prompt.split('\\n')[2]);
    const credits = JSON.parse(prompt.split('\\n')[4]);
    const matches = [];
    credits.forEach(c => {
      const sur = String(c.payer || '').split(/\\s+/).pop().toLowerCase();
      const fam = roster.find(f => sur.length > 2 && (f.students || []).some(s => s.toLowerCase().split(' ').includes(sur)));
      if (fam) matches.push({ tx: c.id, family: fam.id, confidence: 0.9, why: 'same surname as a student' });
    });
    return JSON.stringify({ matches });
  }
  return '{}';
};`;

/* ─── the families sheet (the centre's own column layout) ─── */
const SHEET = [
  ['Online/Physical', 'Student Name', 'Parent', 'Contact number', 'Email address', 'Level', 'Math (Day)', 'Science (Day)', 'Fee', 'Expiry/ Remark', 'Category'],
  ['Physical', 'Tan Jun Wei', 'Tan Mei Ling', '9111 0001', 'tan@example.com', 'P5', 'Friday', 'Monday', '', '', 'Old Batch'],
  ['Online', 'Arjun Kumar', 'Rajesh Kumar', '91110002', 'rajesh@example.com', 'P6', '', 'Saturday 9am', '', '', ''],
  ['Physical', 'Aisyah Rahman', 'Siti Rahman', '91110003', '', 'P5', '', 'Monday', '', '', ''],
  ['Physical', 'Lim Kai', 'Lim Wei Ming', '91110004', 'lim@example.com', 'P6', 'Tuesday', '', '', '', ''],
  ['Online', 'Lim Xin', 'Lim Wei Ming', '91110004', 'lim@example.com', 'P4', 'Wednesday', '', '', '', ''],
  ['Physical', 'Wong Mei', 'Wong Ah Hock', '91110005', 'wong@example.com', 'P5', 'Friday', '', '', '', ''],
  ['Physical', 'Chen Hao', 'Chen Li', '91110006', 'chen@example.com', 'P6', '', 'Thursday', '', '', '']
];
const SCHEDULE = {
  monthlyFee: 220, monthlyFeeOnline: 180, masterMonthlyFee: 320, trialPrice: 30,
  slots: {
    'MON-2': { level: 'P5', subject: 'Science', mode: 'Both', status: 'open', type: 'regular', fee: '', feeOnline: '' },
    'TUE-3': { level: 'P6', subject: 'Math', mode: 'Physical', status: 'open', type: 'regular', fee: 240, feeOnline: '' },
    'WED-1': { level: 'P4', subject: 'Math', mode: 'Online', status: 'open', type: 'regular', fee: '', feeOnline: '' },
    'FRI-2': { level: 'P5', subject: 'Math', mode: 'Both', status: 'open', type: 'regular', fee: '', feeOnline: '' },
    'SAT-1': { level: 'P6', subject: 'Science', mode: 'Both', status: 'open', type: 'regular', fee: '', feeOnline: '' },
    'SAT-2': { level: 'P6', subject: 'Science', mode: 'Physical', status: 'full', type: 'master', fee: '', feeOnline: '' },
    'THU-1': { level: 'P3', subject: 'Science', mode: 'Physical', status: 'closed', type: 'regular', fee: '', feeOnline: '' }
  }
};

/* ─── helpers ─── */
const errors = [];
const shots = [];
// A dialog is photographed as the screen shows it; a page in full.
async function shot(page, name) { await page.waitForTimeout(350); await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('show'); }); const f = join(OUT, name + '.png'); const modal = await page.evaluate(() => !!document.querySelector('#modal.show, #drawer.show')); await page.screenshot({ path: f, fullPage: !modal, animations: 'disabled' }); shots.push(f); }
const store = page => page.evaluate(() => Object.fromEntries([...window.__fakeStore.entries()]));
const docsIn = (all, col) => Object.entries(all).filter(([k]) => k.startsWith(col + '/')).map(([k, v]) => Object.assign({ _id: k.split('/')[1] }, v));
function decodePng(base64) {
  const png = PNG.sync.read(Buffer.from(base64, 'base64'));
  const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return res ? res.data : null;
}
function watch(page, label) {
  page.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED/.test(m.text())) errors.push(label + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
}
async function settle(page, ms = 250) { await page.waitForTimeout(ms); }

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
try {
  /* ════════ The office, on a computer ════════ */
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], locale: 'en-SG', timezoneId: 'Asia/Singapore' });
  await routeOutside(ctx);
  const page = await ctx.newPage();
  watch(page, 'office');
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ schedule }) => {
    window.__fakeSeed = { docs: { 'schedule_config/main': schedule, 'officeSettings/config': { invoiceDay: 1, dueDays: 7, receipts: true, useAi: true } } };
  }, { schedule: SCHEDULE });
  await page.addInitScript(AI_SCRIPT);
  await page.goto(BASE + '/office/');
  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForSelector('text=Next steps');
  assert.ok(await page.locator('text=Add your families').isVisible(), 'an empty office says what to do first');
  assert.equal(await page.locator('.banner.red').count(), 0, 'locked rules show no red banner');
  await shot(page, '01-home-empty');

  // Import the sheet by pasting it, as from Google Sheets.
  await page.click('[data-act="openImport"]');
  await page.fill('textarea[data-in="importPaste"]', SHEET.map(r => r.join('\t')).join('\n'));
  await page.click('[data-act="importPreview"]');
  await page.waitForSelector('text=Check the import');
  const statText = await page.locator('.modal .stats').innerText();
  assert.match(statText, /New families\s*6/i);
  assert.match(statText, /Students\s*7/i);
  assert.match(statText, /Need a class\s*1/i, 'Chen Hao\'s Thursday Science has no P6 class');
  await shot(page, '02-import-preview');
  await page.click('[data-act="importCommit"]');
  await page.waitForSelector('.fam-grid');
  let all = await store(page);
  let fams = docsIn(all, 'officeFamilies');
  assert.equal(fams.length, 6);
  assert.ok(fams.every(f => C.isCode(f.code)), 'every family has a reference code');
  assert.equal(new Set(fams.map(f => f.code)).size, 6, 'codes are unique');
  const lim = fams.find(f => f.parentName === 'Lim Wei Ming');
  assert.equal(lim.students.length, 2, 'one family, two children');
  assert.deepEqual(lim.students.map(s => s.classes.map(c => c.slotId + ':' + c.mode)), [['TUE-3:Physical'], ['WED-1:Online']]);
  await shot(page, '03-families');

  // Chen Hao needs a class: open the family, pick Saturday 11am, save.
  await page.click('text=Chen Li');
  await page.waitForSelector('.modal .student-card');
  await shot(page, '04-family-editor');
  await page.click('.modal [data-act="addClass"]');
  await page.selectOption('.modal .class-row select[data-ch="clsSlot"]', 'SAT-2');
  await page.fill('.modal input[data-in="fam"][data-k="address"], .modal textarea[data-in="fam"][data-k="address"]', '1 Clementi Road, Singapore 129000');
  await page.click('.modal [data-act="saveFamily"]');
  await page.waitForSelector('#modal.show', { state: 'detached' });
  all = await store(page);
  const chen = docsIn(all, 'officeFamilies').find(f => f.parentName === 'Chen Li');
  assert.deepEqual(chen.students[0].classes.map(c => c.slotId), ['SAT-2']);
  assert.equal(chen.address, '1 Clementi Road, Singapore 129000');

  // The timetable counts students per class.
  await page.click('#tabs [data-view="timetable"]');
  await page.waitForSelector('table.tt');
  const monCount = await page.locator('[data-act="openSlot"][data-id="MON-2"] .cnt').innerText();
  assert.match(monCount, /^2/, 'two P5 Science students on Monday 5pm');
  await shot(page, '05-timetable');
  await page.click('[data-act="openSlot"][data-id="MON-2"]');
  await page.waitForSelector('#drawer.show');
  assert.ok(await page.locator('#drawer >> text=Aisyah Rahman').isVisible());
  await shot(page, '06-timetable-class');
  await page.keyboard.press('Escape');

  // The students table filters by level and subject.
  await page.click('#tabs [data-view="students"]');
  await settle(page);
  assert.equal(await page.locator('#view table.t tbody tr').count(), 7, 'every student is listed');
  await page.click('[data-act="stuFilter"][data-k="level"][data-v="P6"]');
  await settle(page);
  assert.equal(await page.locator('#view table.t tbody tr').count(), 3, 'three P6 students');
  await page.click('[data-act="stuFilter"][data-k="subject"][data-v="Science"]');
  await settle(page);
  const p6sci = await page.locator('#view table.t tbody tr').count();
  assert.equal(p6sci, 2, 'Arjun and Chen Hao are the P6 Science students');
  await shot(page, '07-students-filtered');
  await page.click('[data-act="stuFilter"][data-k="level"][data-v=""]');
  await page.click('[data-act="stuFilter"][data-k="subject"][data-v=""]');

  // Prepare November's invoices.
  await page.click('#tabs [data-view="invoices"]');
  await page.click('.bulkbar [data-act="openPrepare"]');
  await page.waitForSelector('text=Prepare November 2026 invoices');
  await shot(page, '08-prepare');
  await page.click('[data-act="prepareCommit"]');
  await page.waitForSelector('text=invoices prepared');
  all = await store(page);
  let invs = docsIn(all, 'officeInvoices');
  assert.equal(invs.length, 6);
  const totalOf = name => invs.find(i => i.parentName === name).total;
  assert.equal(totalOf('Tan Mei Ling'), 440, 'P5 Science + P5 Math, physical, schedule defaults');
  assert.equal(totalOf('Lim Wei Ming'), 420, 'P6 Math at its own $240 + P4 Math online $180');
  assert.equal(totalOf('Rajesh Kumar'), 180, 'online');
  assert.equal(totalOf('Chen Li'), 320, 'Master Class');
  assert.ok(invs.every(i => i.reference === 'PLC ' + i.code + ' NOV26' && i.dueDate === '2026-11-10' && i.linkToken));
  assert.equal(docsIn(all, 'officeLinks').length, 6);
  const linkFlat = JSON.stringify(docsIn(all, 'officeLinks'));
  assert.ok(!linkFlat.includes('@example.com') && !linkFlat.includes('9111000') && !linkFlat.includes('Clementi'), 'no contact details on a parent link');

  // Email them all (5 have email).
  await page.click('.modal [data-act="emailDrafts"]');
  await page.waitForSelector('text=emails queued');
  all = await store(page);
  const mails = docsIn(all, 'mail');
  assert.equal(mails.length, 5);
  for (const m of mails) {
    assert.match(m._id, /^polymath-office-invoice-/);
    assert.equal(m.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
    assert.ok(m.message.html.includes('cid:paynowqr'));
    assert.ok(m.message.html.includes('/pay/?i='));
    const att = m.message.attachments[0];
    assert.equal(att.cid, 'paynowqr');
    const inv = docsIn(all, 'officeInvoices').find(i => i._id === m.polymathOffice.invoiceId);
    assert.equal(decodePng(att.content), C.buildPayNow(inv.total, inv.reference), 'the emailed QR scans to the right amount and reference');
  }
  await page.click('.modal [data-act="closeModal"]');
  invs = docsIn(await store(page), 'officeInvoices');
  assert.equal(invs.filter(i => i.status === 'sent').length, 5);
  await shot(page, '09-invoices-sent');

  // Siti has no email: the WhatsApp queue copies the picture and opens her chat.
  await page.click('.bulkbar [data-act="waQueueDrafts"]');
  await page.waitForSelector('text=Invoices by WhatsApp');
  await page.waitForFunction(() => { const i = document.querySelector('.waq img.preview'); return i && i.complete && i.naturalWidth > 0; });
  await shot(page, '10-whatsapp-queue');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-act="waSend"]')]);
  const waUrl = popup.url();
  await popup.close();
  assert.match(waUrl, /^https:\/\/web\.whatsapp\.com\/send\?phone=6591110003&text=/);
  assert.match(decodeURIComponent(waUrl), /PLC [A-Z0-9]{6} NOV26/);
  const clip = await page.evaluate(async () => { const items = await navigator.clipboard.read(); return items[0].types; });
  assert.ok(clip.includes('image/png'), 'the invoice picture is on the clipboard');
  await page.waitForSelector('text=Picture copied, chat opened');
  await page.click('.modal [data-act="closeModal"]');
  invs = docsIn(await store(page), 'officeInvoices');
  assert.ok(invs.find(i => i.parentName === 'Siti Rahman').sends.some(s => s.via === 'whatsapp'));

  // One invoice, opened: the preview, its QR, and the history.
  await page.click('.inv >> text=Wong Ah Hock');
  await page.waitForSelector('.modal .qr-box img');
  await shot(page, '11-invoice');
  await page.click('.modal [data-act="closeModal"]');

  /* ════════ A PDF bank statement ════════ */
  all = await store(page);
  fams = docsIn(all, 'officeFamilies');
  invs = docsIn(all, 'officeInvoices');
  const famBy = n => fams.find(f => f.parentName === n);
  const invBy = n => invs.find(i => i.parentName === n);
  const rows = [
    ['03 Nov', 'PAYNOW TRANSFER', '', invBy('Tan Mei Ling').total, ['OTHR PLC ' + famBy('Tan Mei Ling').code + ' NOV26', 'TAN MEI LING']],
    ['04 Nov', 'NETS FAIRPRICE CLEMENTI', 12.5, '', []],
    ['05 Nov', 'FAST PAYMENT', '', invBy('Lim Wei Ming').total, ['FROM LIM WEI MING']],
    ['06 Nov', 'PAYNOW TRANSFER', '', invBy('Rajesh Kumar').total, ['PRIYA KUMAR']],
    ['07 Nov', 'PAYNOW TRANSFER', '', 100, ['OTHR PLC' + famBy('Wong Ah Hock').code + 'NOV26', 'WONG AH HOCK']],
    ['08 Nov', 'INTEREST EARNED', '', 0.12, []]
  ];
  const pdf = await PDFDocument.create();
  const pg = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const txt = (s, x, y, size = 9) => pg.drawText(String(s), { x, y: 842 - y, size, font });
  const right = (s, xr, y) => txt(s, xr - font.widthOfTextAtSize(String(s), 9), y);
  txt('POSB eSavings Account  Statement of Account  01 Nov 2026 to 30 Nov 2026', 40, 50, 10);
  txt('Date', 40, 90); txt('Description', 100, 90); right('Withdrawal', 380, 90); right('Deposit', 460, 90); right('Balance', 550, 90);
  let y = 110, bal = 1000;
  txt('01 Nov', 40, y); txt('Balance Brought Forward', 100, y); right('1,000.00', 550, y); y += 16;
  rows.forEach(([d, desc, wd, dep, more]) => {
    bal = Math.round((bal - (wd || 0) + (dep || 0)) * 100) / 100;
    txt(d, 40, y); txt(desc, 100, y);
    if (wd) right(Number(wd).toFixed(2), 380, y);
    if (dep) right(Number(dep).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','), 460, y);
    right(bal.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','), 550, y);
    y += 14; more.forEach(l => { txt(l, 100, y); y += 14; }); y += 4;
  });
  const pdfPath = join(OUT, 'statement-nov.pdf');
  writeFileSync(pdfPath, await pdf.save());
  // What ChatGPT would read off it.
  const credits = rows.filter(r => r[3]).map(([d, desc, , dep, more]) => ({
    date: '2026-11-' + d.slice(0, 2), amount: dep, payer: (more[1] || (more[0] && !/OTHR/.test(more[0]) ? more[0].replace(/^FROM /, '') : '')) || '',
    reference: (more.find(l => /OTHR/.test(l)) || '').replace(/^OTHR /, ''), description: [desc, ...more].join(' · ')
  }));
  await page.evaluate(c => { window.__fakeStatementCredits = c; }, credits);
  await page.click('#tabs [data-view="payments"]');
  await shot(page, '12-payments-empty');
  await page.setInputFiles('#file-statement', pdfPath);
  await page.waitForFunction(() => { const r = window.PolymathOffice.S.review; return r && r.stage === 'review'; }, null, { timeout: 20000 });
  await page.waitForSelector('[data-act="rvApply"]');
  const calls = await page.evaluate(() => window.__fakeCalls.map(c => c.data.prompt.slice(0, 200)));
  assert.ok(calls.some(p => /bank statement/.test(p)), 'ChatGPT was asked to read the statement');
  assert.ok(calls.some(p => /needs to know which family/.test(p)), 'and to suggest the unmatched payer');
  const review = await page.evaluate(() => window.PolymathOffice.S.review.txs.map(t => ({ amt: t.amount, fam: t.familyId, how: t.match.how, tick: t.tick, dup: t.dup })));
  const famIdOf = n => famBy(n)._id;
  const rv = amt => review.find(r => r.amt === amt);
  assert.equal(review.length, 5, 'five money-in lines; the card spend is left out');
  assert.deepEqual([rv(invBy('Tan Mei Ling').total).fam, rv(invBy('Tan Mei Ling').total).how, rv(invBy('Tan Mei Ling').total).tick], [famIdOf('Tan Mei Ling'), 'reference', true]);
  assert.deepEqual([rv(100).fam, rv(100).how, rv(100).tick], [famIdOf('Wong Ah Hock'), 'reference', true], 'a squeezed reference still matches');
  assert.deepEqual([rv(invBy('Lim Wei Ming').total).fam, rv(invBy('Lim Wei Ming').total).how, rv(invBy('Lim Wei Ming').total).tick], [famIdOf('Lim Wei Ming'), 'name+amount', true]);
  assert.deepEqual([rv(invBy('Rajesh Kumar').total).fam, rv(invBy('Rajesh Kumar').total).how, rv(invBy('Rajesh Kumar').total).tick], [famIdOf('Rajesh Kumar'), 'ai', true], 'ChatGPT\'s sure match for the exact amount is ticked');
  assert.deepEqual([rv(0.12).fam, rv(0.12).tick], ['', false], 'interest is left alone');
  await shot(page, '13-statement-review');
  await page.click('[data-act="rvApply"]');
  await page.waitForSelector('text=/payments? recorded/');
  all = await store(page);
  invs = docsIn(all, 'officeInvoices');
  assert.equal(invBy('Tan Mei Ling') && invs.find(i => i.parentName === 'Tan Mei Ling').status, 'paid');
  assert.equal(invs.find(i => i.parentName === 'Lim Wei Ming').status, 'paid');
  assert.equal(invs.find(i => i.parentName === 'Rajesh Kumar').status, 'paid');
  const wong = invs.find(i => i.parentName === 'Wong Ah Hock');
  assert.deepEqual([wong.status, wong.paid], ['part', 100]);
  assert.equal(docsIn(all, 'officePayments').length, 4);
  assert.equal(docsIn(all, 'mail').filter(m => m._id.startsWith('polymath-office-receipt-')).length, 4, 'a receipt for each');
  assert.ok(docsIn(all, 'officeFamilies').find(f => f.parentName === 'Rajesh Kumar').payerNames.includes('priya kumar'), 'the new payer name is remembered');
  const wongLink = docsIn(all, 'officeLinks').find(l => l.invoiceId === wong._id);
  assert.deepEqual([wongLink.paid, wongLink.outstanding], [100, wong.total - 100], 'the parent\'s page follows the payment');
  await shot(page, '14-payments-applied');

  // The same statement again: nothing is counted twice.
  await page.setInputFiles('#file-statement', pdfPath);
  await page.waitForFunction(() => { const r = window.PolymathOffice.S.review; return r && r.stage === 'review'; }, null, { timeout: 20000 });
  await page.waitForSelector('text=Already recorded');
  const againTx = await page.evaluate(() => window.PolymathOffice.S.review.txs.map(t => ({ amt: t.amount, dup: t.dup, key: t.key })));
  const pays = docsIn(await store(page), 'officePayments').map(p => p._id);
  assert.equal(againTx.filter(t => !t.dup).length, 1, 'only the interest line is new: ' + JSON.stringify(againTx) + ' ' + JSON.stringify(pays));
  await page.click('[data-act="cancelReview"]');

  // A CSV export with Siti's reference — read with no ChatGPT at all.
  const siti = invs.find(i => i.parentName === 'Siti Rahman');
  const csvPath = join(OUT, 'statement-nov.csv');
  writeFileSync(csvPath, ['Account Details For:,POSB eSavings', '', 'Transaction Date,Reference,Debit Amount,Credit Amount,Transaction Ref1,Transaction Ref2,Transaction Ref3',
    '10 Nov 2026,ICT,,' + siti.total.toFixed(2) + ',PAYNOW TRANSFER,OTHR PLC ' + famBy('Siti Rahman').code + ' NOV26,SITI BTE RAHMAN', '11 Nov 2026,POS,5.00,,NTUC,,'].join('\n'));
  const before = (await page.evaluate(() => window.__fakeCalls.length));
  await page.setInputFiles('#file-statement', csvPath);
  await page.waitForFunction(() => { const r = window.PolymathOffice.S.review; return r && r.stage === 'review'; }, null, { timeout: 20000 });
  await page.waitForSelector('[data-act="rvApply"]');
  assert.equal(await page.evaluate(() => window.__fakeCalls.length), before, 'clear columns need no ChatGPT');
  await page.click('[data-act="rvApply"]');
  await page.waitForSelector('text=/payments? recorded/');
  assert.equal(docsIn(await store(page), 'officeInvoices').find(i => i.parentName === 'Siti Rahman').status, 'paid');

  // Reminders: Wong (part paid) and Chen (unpaid) still owe.
  await page.click('[data-act="openReminders"]');
  await page.waitForSelector('text=Payment reminders');
  assert.equal(await page.locator('.modal tbody tr').count(), 2);
  await shot(page, '15-reminders');
  await page.click('[data-act="remindEmail"]');
  await page.waitForSelector('text=emails queued');
  all = await store(page);
  const reminders = docsIn(all, 'mail').filter(m => m._id.startsWith('polymath-office-reminder-'));
  assert.equal(reminders.length, 2);
  const wongRem = reminders.find(m => m.polymathOffice.invoiceId === wong._id);
  assert.match(wongRem.message.subject, new RegExp('\\$' + (wong.total - 100).toFixed(2).replace('.', '\\.') + ' outstanding'));
  assert.equal(decodePng(wongRem.message.attachments[0].content), C.buildPayNow(wong.total - 100, wong.reference), 'a reminder\'s QR asks only for what is left');
  await page.click('.modal [data-act="closeModal"]');

  // Home now tells the story of the month.
  await page.click('#tabs [data-view="home"]');
  await page.waitForSelector('text=at a glance');
  await shot(page, '16-home-month');

  // Settings: the QR self-test scans a real QR.
  await page.click('#tabs [data-view="settings"]');
  await page.click('[data-act="qrSelfTest"]');
  await page.waitForFunction(() => /It scans|did not/.test(document.getElementById('qr-test-out').textContent));
  assert.match(await page.locator('#qr-test-out').innerText(), /✓ It scans: \$123\.45 to T16LL2365E/);
  await page.click('[data-act="aiTest"]');
  await page.waitForFunction(() => /answered|✕/.test(document.getElementById('ai-test-out').textContent));
  await shot(page, '17-settings');

  // An office whose rules are NOT published refuses to save.
  lockStatus = 404;
  await page.click('[data-act="recheckLock"]');
  await page.waitForSelector('.banner.red');
  await page.click('#tabs [data-view="families"]');
  await page.click('[data-act="newFamily"]');
  await page.fill('.modal input[data-k="parentName"]', 'Should Not Save');
  await page.click('.modal [data-act="saveFamily"]');
  await settle(page, 300);
  assert.equal(docsIn(await store(page), 'officeFamilies').length, 6, 'nothing is written while parent data would be readable');
  await shot(page, '18-unlocked-refuses');
  await page.keyboard.press('Escape');
  lockStatus = 403;

  /* ════════ The office on a phone ════════ */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-act="recheckLock"]');
  await page.click('#tabs [data-view="invoices"]');
  await settle(page);
  await shot(page, '19-phone-invoices');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone');
  await page.click('#tabs [data-view="home"]');
  await settle(page);
  await shot(page, '20-phone-home');

  /* ════════ The parent's page ════════ */
  linkDocs = Object.fromEntries(docsIn(await store(page), 'officeLinks').map(l => [l._id, l]));
  const wongToken = docsIn(await store(page), 'officeInvoices').find(i => i.parentName === 'Wong Ah Hock').linkToken;
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await routeOutside(phone);
  const pp = await phone.newPage();
  watch(pp, 'pay');
  await pp.clock.setFixedTime(NOW);
  await pp.goto(BASE + '/pay/?i=' + wongToken + '&save=1');
  await pp.waitForSelector('#qr img');
  const shown = await pp.locator('.amount').innerText();
  assert.equal(shown, C.money(wong.total - 100), 'the parent sees what is left to pay');
  assert.ok(await pp.locator('#save.pulse').isVisible(), 'the Save QR button is waiting for them');
  const qrPayload = await pp.evaluate(() => { const c = document.querySelector('#qr canvas'); return c.toDataURL('image/png').split(',')[1]; });
  assert.equal(decodePng(qrPayload), C.buildPayNow(wong.total - 100, wong.reference), 'the parent\'s QR scans');
  assert.ok(pp.url() && !(await pp.content()).includes('wong@example.com'));
  await shot(pp, '21-pay-phone');
  const tanToken = docsIn(await store(page), 'officeInvoices').find(i => i.parentName === 'Tan Mei Ling').linkToken;
  await pp.goto(BASE + '/pay/?i=' + tanToken);
  await pp.waitForSelector('text=Paid — thank you!');
  await shot(pp, '22-pay-paid');
  await pp.goto(BASE + '/pay/?i=NotARealTokenButLongEnough123');
  await pp.waitForSelector('text=Invoice not found');
  await pp.goto(BASE + '/pay/?i=short');
  await pp.waitForSelector('text=This link is not complete');

  const unexpected = outside.filter(u => !/fonts\.gstatic\.com/.test(u));
  assert.deepEqual(unexpected, [], 'no request left the machine');
  assert.deepEqual(errors, [], 'no errors on any page');
  console.log('✓ Polymath Office end to end: ' + shots.length + ' screenshots in ' + OUT);
} catch (e) {
  console.error(errors.join('\n'));
  for (const pg of browser.contexts().flatMap(c => c.pages())) { try { await pg.screenshot({ path: join(OUT, 'zz-failure-' + Math.random().toString(36).slice(2, 6) + '.png'), fullPage: true }); } catch (x) { /* closed */ } }
  throw e;
} finally {
  await browser.close();
  server.close();
}
