// 🎁 Polymath Office referral rewards, end to end, in a real browser.
//
//   PW=/path/to/playwright/index.mjs node tools/office-referrals-browser.mjs
//
// Serves the SHIPPED office/ page with Firebase replaced by
// tools/office-fake-firebase.js (nothing is emailed or stored anywhere), then,
// as the admin: the Referrals tab lists bookings that came through a family's
// link → confirm one (both families rewarded, thank-you emails written) → add the
// family behind another booking straight from it → mark one "not enrolled" →
// change the reward in Settings → email a family its link → prepare January's
// invoices (each reward is its own line) → cancel one (the reward comes back) →
// the family dialog's referral section → the Referrals tab on a phone.
// Screenshots go to OFFICE_SHOTS (default artifacts/office-referrals).
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as C from '../office/office-core.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.OFFICE_SHOTS || join(ROOT, 'artifacts', 'office-referrals');
if (!process.env.PW) throw new Error('Set PW (playwright index.mjs).');
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(process.env.PW);
const NOW = new Date('2027-01-05T02:00:00Z');   // Tuesday 5 Jan 2027, 10:00 in Singapore

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
async function routeOutside(context) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const url = route.request().url();
    if (url.startsWith('https://www.gstatic.com/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: url.includes('app-compat') ? FAKE_FB : '' });
    if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (url === C.EMAIL_LOGO_URL) return route.fulfill({ contentType: 'image/png', body: readFileSync(new URL('../assets/branding/polymath-logo-email.png', import.meta.url)) });
    if (url.includes('qrcode')) return route.fulfill({ contentType: 'text/javascript', body: QR_STUB });
    if (url.includes('officeSettings/config')) return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    if (url.startsWith('https://web.whatsapp.com/') || url.startsWith('https://wa.me/')) return route.fulfill({ contentType: 'text/html', body: '<title>WhatsApp stand-in</title>' });
    return route.abort();
  });
}

const SCHEDULE = {
  monthlyFee: 220, monthlyFeeOnline: 180, trialPrice: 30,
  slots: {
    'MON-2': { level: 'P5', subject: 'Science', mode: 'Both', status: 'open', type: 'regular' },
    'FRI-2': { level: 'P5', subject: 'Math', mode: 'Both', status: 'open', type: 'regular' },
    'TUE-3': { level: 'P6', subject: 'Math', mode: 'Physical', status: 'open', type: 'regular', fee: 240 }
  }
};
const kid = (id, name, level, slots) => ({ id, name, level, status: 'active', startDate: '2026-09-01', classes: slots.map(s => ({ slotId: s, mode: 'Physical' })) });
const FAMILIES = {
  'officeFamilies/tan': { code: 'TAN2AA', referralCode: 'K7M2QX', parentName: 'Tan Mei Ling', email: 'tan@example.com', whatsapp: '6591110001', signUpDate: '2026-09-01', status: 'active', students: [kid('t1', 'Tan Jun Wei', 'P5', ['MON-2', 'FRI-2'])] },
  'officeFamilies/lim': { code: 'LIM3BB', parentName: 'Lim Wei Jie', email: 'lim@example.com', whatsapp: '6591110002', signUpDate: '2026-12-20', status: 'active', students: [kid('l1', 'Lim Chloe', 'P5', ['MON-2'])] },
  'officeFamilies/wong': { code: 'WON4CC', parentName: 'Wong Ah Hock', email: 'wong@example.com', whatsapp: '6591110003', signUpDate: '2026-09-01', status: 'active', students: [kid('w1', 'Wong Mei', 'P6', ['TUE-3'])] }
};
const ts = ms => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 });
const BOOKINGS = {
  'schedule_bookings/BK1': { kind: 'enrol', slot: 'MON-2', slotLabel: 'Monday 3:00pm – 4:45pm', classLevel: 'P5', subject: 'Science', mode: 'Physical', classType: 'regular', parentName: 'Lim Wei Jie', childName: 'Lim Chloe', childLevel2027: 'Primary 5', email: 'Lim@Example.com', whatsapp: '91110002', price: 220, status: 'confirmed', referralCode: 'K7M2QX', createdAt: ts(Date.UTC(2026, 11, 18, 4)) },
  'schedule_bookings/BK2': { kind: 'trial', slot: 'FRI-2', slotLabel: 'Friday 3:00pm – 4:45pm', classLevel: 'P5', subject: 'Math', mode: 'Online', classType: 'regular', parentName: 'Someone Else', childName: 'Ryan', childLevel2027: 'Primary 5', email: 'ryan@example.com', whatsapp: '91110009', price: 25, status: 'pending', referralCode: 'ZZZ9ZZ', createdAt: ts(Date.UTC(2026, 11, 29, 4)) },
  'schedule_bookings/BK3': { kind: 'diagnostic', slot: 'TUE-3', sessionLabel: 'Tuesday 8 December 2026, 3:00pm – 4:45pm', classType: 'master', parentName: 'Ong Siew Lan', childName: 'Ong Kai Xin', childLevel2027: 'Primary 6', level: 'Primary 6', email: 'ong@example.com', whatsapp: '', price: 0, status: 'pending', referralCode: 'K7M2QX', createdAt: ts(Date.UTC(2027, 0, 3, 4)) },
  'schedule_bookings/BK4': { kind: 'trial', slot: 'MON-2', parentName: 'No Referral', childName: 'Plain', email: 'plain@example.com', createdAt: ts(Date.UTC(2027, 0, 4, 4)) }
};

const errors = [];
async function shot(page, name, opts) {
  await page.waitForTimeout(300);
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('show'); });
  const modal = await page.evaluate(() => !!document.querySelector('#modal.show'));
  await page.screenshot(Object.assign({ path: join(OUT, name + '.png'), fullPage: !modal, animations: 'disabled' }, opts || {}));
}
const store = page => page.evaluate(() => Object.fromEntries([...window.__fakeStore.entries()]));
const docsIn = (all, col) => Object.entries(all).filter(([k]) => k.startsWith(col + '/')).map(([k, v]) => Object.assign({ _id: k.split('/')[1] }, v));
const famOf = (all, id) => all['officeFamilies/' + id];
function watch(page, label) {
  page.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED/.test(m.text())) errors.push(label + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
}
let passed = 0;
const ok = name => { passed++; console.log('ok   ' + name); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'], locale: 'en-SG', timezoneId: 'Asia/Singapore' });
  await routeOutside(ctx);
  const page = await ctx.newPage();
  watch(page, 'office');
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(seed => { window.__fakeSeed = { docs: seed }; },
    Object.assign({ 'schedule_config/main': SCHEDULE, 'officeSettings/config': { invoiceDay: 1, dueDays: 7, combinedMonths: [] } }, FAMILIES, BOOKINGS));
  await page.goto(BASE + '/office/#referrals');
  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForSelector('text=Waiting for you to confirm');

  /* 1. The tab: three bookings came through a link, one did not. */
  assert.equal(await page.locator('.ref-row').count(), 3);
  assert.equal((await page.textContent('[data-count="referrals"]')).trim(), '3');
  assert.match(await page.textContent('#view'), /\$50\.00 off for the family who refers · \$50\.00 off for the new family/);
  assert.match(await page.textContent('#view'), /These are starting amounts/);
  assert.match(await page.locator('[data-ref-row="BK2"]').innerText(), /No family has code ZZZ9ZZ/);
  assert.equal(await page.inputValue('[data-ref-row="BK1"] select[data-k="from"]'), 'tan');
  assert.equal(await page.inputValue('[data-ref-row="BK1"] select[data-k="to"]'), 'lim', 'the new family is found by its email');
  assert.equal(await page.inputValue('[data-ref-row="BK3"] select[data-k="to"]'), '', 'Ong is not in the Office yet');
  assert.ok(await page.locator('[data-ref-row="BK3"] [data-act="refConfirm"]').isDisabled());
  await shot(page, '01-referrals-tab');
  ok('the Referrals tab lists the bookings that came through a link');

  /* 2. Confirm Tan → Lim. */
  await page.click('[data-ref-row="BK1"] [data-act="refConfirm"]');
  await page.waitForSelector('text=Confirm the referral');
  assert.match(await page.textContent('#modal'), /Tan Mei Ling \(Tan Jun Wei\) gets \$50\.00 off their next invoice, and Lim Wei Jie \(Lim Chloe\) gets \$50\.00 off theirs\./);
  await shot(page, '02-confirm-referral');
  await page.click('[data-act="refCommit"]');
  await page.waitForSelector('#modal:not(.show)', { state: 'attached' });
  await page.waitForTimeout(400);
  let all = await store(page);
  const tanR = C.normalizeRewards(famOf(all, 'tan').rewards);
  const limR = C.normalizeRewards(famOf(all, 'lim').rewards);
  assert.deepEqual(tanR.map(r => [r.kind, r.amount, r.otherFamilyId, r.bookingId, r.confirmedAt, r.confirmedBy]), [['referrer', 50, 'lim', 'BK1', '2027-01-05', 'chungzhikai@gmail.com']]);
  assert.deepEqual(limR.map(r => [r.kind, r.amount, r.otherFamilyId]), [['friend', 50, 'tan']]);
  assert.equal(famOf(all, 'lim').referredBy.familyId, 'tan');
  assert.ok(C.isCode(famOf(all, 'lim').referralCode), 'the new family gets its own link straight away');
  assert.equal(all['schedule_bookings/BK1'].referralStatus, 'confirmed');
  const thanks = docsIn(all, 'mail').filter(m => m._id.startsWith('polymath-office-referral-thanks-'));
  assert.equal(thanks.length, 2);
  assert.ok(thanks.every(m => m.from === 'Polymath Learning Centre <admin@polymathlc.com.sg>'));
  assert.deepEqual(thanks.map(m => m.to[0]).sort(), ['lim@example.com', 'tan@example.com']);
  assert.equal(await page.locator('.ref-row').count(), 2);
  assert.match(await page.textContent('#view'), /Confirmed referrals[\s\S]*Tan Mei Ling \(Tan Jun Wei\)[\s\S]*Next invoice[\s\S]*Lim Wei Jie \(Lim Chloe\)/);
  ok('confirming rewards both families once, and emails both');

  /* 3. Not enrolled, then put back, then not enrolled again. */
  await page.click('[data-ref-row="BK2"] [data-act="refDismiss"]');
  await page.waitForTimeout(300);
  all = await store(page);
  assert.equal(all['schedule_bookings/BK2'].referralStatus, 'dismissed');
  assert.equal(await page.locator('.ref-row').count(), 1);
  await page.click('.ref-dismissed summary');
  await page.click('[data-act="refUndismiss"][data-id="BK2"]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.ref-row').count(), 2);
  await page.click('[data-ref-row="BK2"] [data-act="refDismiss"]');
  await page.waitForTimeout(300);
  ok('a booking can be marked not enrolled and put back');

  /* 4. Add Ong's family straight from the diagnostic booking. */
  await page.click('[data-ref-row="BK3"] [data-act="refAddFamily"]');
  await page.waitForSelector('.modal .student-card');
  assert.equal(await page.inputValue('.modal input[data-k="parentName"]'), 'Ong Siew Lan');
  assert.equal(await page.inputValue('.modal input[data-k="email"]'), 'ong@example.com');
  assert.equal(await page.inputValue('.modal input[data-k="name"][data-s="0"]'), 'Ong Kai Xin');
  await page.click('[data-act="saveFamily"]');
  await page.waitForTimeout(500);
  const ong = docsIn(await store(page), 'officeFamilies').find(f => f.parentName === 'Ong Siew Lan');
  assert.ok(ong, 'Ong family added');
  assert.equal(await page.inputValue('[data-ref-row="BK3"] select[data-k="to"]'), ong._id, 'and found for the booking at once');
  ok('the family behind a booking is added from it in one step');

  /* 5. The reward in Settings. */
  await page.click('#tabs [data-view="settings"]');
  await page.waitForSelector('text=Referral rewards');
  await page.fill('#set-referralReward', '80');
  await page.fill('#set-referralFriendReward', '30');
  await page.locator('#set-referralReward').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, '03-settings-amounts.png'), animations: 'disabled' });
  await page.click('[data-act="saveSettings"]');
  await page.waitForTimeout(400);
  all = await store(page);
  assert.equal(all['officeSettings/config'].referralReward, 80);
  assert.equal(all['officeSettings/config'].referralFriendReward, 30);
  await page.click('#tabs [data-view="referrals"]');
  await page.waitForSelector('text=Waiting for you to confirm');
  assert.match(await page.textContent('#view'), /\$80\.00 off for the family who refers · \$30\.00 off for the new family/);
  assert.doesNotMatch(await page.textContent('#view'), /These are starting amounts/);
  // Confirm Tan → Ong at the new amounts, without emails.
  await page.click('[data-ref-row="BK3"] [data-act="refConfirm"]');
  await page.waitForSelector('text=Confirm the referral');
  assert.equal(await page.inputValue('input[data-k="amtFrom"]'), '80');
  await page.uncheck('input[data-ch="refMail"]');
  await page.click('[data-act="refCommit"]');
  await page.waitForTimeout(500);
  all = await store(page);
  assert.deepEqual(C.normalizeRewards(famOf(all, 'tan').rewards).map(r => r.amount), [50, 80]);
  assert.equal(C.normalizeRewards(famOf(all, ong._id).rewards)[0].amount, 30);
  assert.equal(docsIn(all, 'mail').filter(m => m._id.startsWith('polymath-office-referral-thanks-')).length, 2, 'no more thank-you emails when unticked');
  ok('the amounts come from Settings and can be changed');

  /* 6. Email Wong its link: the code is made on the way. */
  assert.equal(famOf(all, 'wong').referralCode, undefined);
  await page.click('tr:has-text("Wong Ah Hock") [data-act="refEmail"]');
  await page.waitForTimeout(500);
  all = await store(page);
  const wongCode = famOf(all, 'wong').referralCode;
  assert.ok(C.isCode(wongCode));
  assert.equal(famOf(all, 'wong').referralSentVia, 'email');
  const linkMail = docsIn(all, 'mail').find(m => m._id.startsWith('polymath-office-referral-wong-'));
  assert.ok(linkMail.message.html.includes('https://polymathlc.com.sg/schedule/?ref=' + wongCode));
  assert.match(linkMail.message.subject, /\$80\.00 off for every friend who joins/);
  assert.deepEqual(linkMail.to, ['wong@example.com']);
  writeFileSync(join(OUT, 'referral-email.html'), linkMail.message.html);
  await shot(page, '04-referrals-after');
  ok('a family is emailed its own link');

  /* 7. January invoices: each reward is its own line. */
  await page.click('#tabs [data-view="invoices"]');
  await page.click('.bulkbar [data-act="openPrepare"]');
  await page.waitForSelector('text=Prepare January 2027 invoices');
  await page.click('[data-act="prepareCommit"]');
  await page.waitForSelector('text=invoices prepared');
  all = await store(page);
  const invs = docsIn(all, 'officeInvoices');
  const tanInv = invs.find(i => i.familyId === 'tan');
  assert.deepEqual(tanInv.lines.filter(l => l.kind === 'reward').map(l => [l.desc, l.amount]), [['Referral reward', -50], ['Referral reward', -80]]);
  assert.equal(tanInv.total, 440 - 130);
  const limInv = invs.find(i => i.familyId === 'lim');
  assert.deepEqual(limInv.lines.filter(l => l.kind === 'reward').map(l => [l.desc, l.amount]), [['Welcome reward', -50]]);
  assert.equal(limInv.total, 170);
  assert.equal(C.familyRewardsLeft(famOf(all, 'tan')), 0);
  assert.equal(C.familyRewardsLeft(famOf(all, 'lim')), 0);
  const link = all['officeLinks/' + tanInv.linkToken];
  assert.ok(link.lines.some(l => l.desc === 'Referral reward' && l.amount === -80), 'the parent\'s invoice page shows the line');
  await page.click('[data-act="closeModal"]');
  await page.evaluate(id => window.PolymathOffice.ACT.openInvoice({ dataset: { id } }), tanInv.id);
  await page.waitForSelector('text=✕ Cancel this invoice');
  await shot(page, '05-invoice-with-reward');
  ok('January invoices take the rewards off as their own lines');

  /* 8. Cancel Tan's invoice: the rewards come back for the next one. */
  await page.click('[data-act="voidInvoice"]');
  await page.waitForTimeout(500);
  all = await store(page);
  assert.equal(all['officeInvoices/' + tanInv.id].status, 'void');
  assert.equal(C.familyRewardsLeft(famOf(all, 'tan')), 130);
  await page.click('[data-act="closeModal"]').catch(() => {});
  ok('cancelling an invoice gives its rewards back');

  /* 9. Undo is offered only while a reward is still unused. */
  await page.click('#tabs [data-view="referrals"]');
  await page.waitForSelector('text=Confirmed referrals');
  assert.equal(await page.locator('[data-act="refUndo"]').count(), 1, 'Tan → Ong is unused on both sides; Tan → Lim reached Lim\'s invoice');
  ok('a used referral cannot be undone');

  /* 10. The family dialog. */
  await page.click('tr:has-text("Tan Mei Ling") [data-act="openFamily"] >> nth=0');
  await page.waitForSelector('text=🎁 Referral link');
  await page.locator('text=🎁 Referral link').scrollIntoViewIfNeeded();
  assert.match(await page.textContent('#modal'), /K7M2QX/);
  assert.match(await page.textContent('#modal'), /Referral reward · Thank you for introducing Lim Wei Jie's family to Polymath/);
  await shot(page, '06-family-referral-section');
  // Saving the family keeps the rewards, whatever the dialog opened with.
  await page.click('[data-act="saveFamily"]');
  await page.waitForTimeout(400);
  all = await store(page);
  assert.equal(C.normalizeRewards(famOf(all, 'tan').rewards).length, 2);
  ok('the family dialog shows the link and rewards, and saving keeps them');

  /* 11. The email a family receives. */
  const ep = await ctx.newPage();
  await ep.setViewportSize({ width: 680, height: 900 });
  await ep.goto(BASE + '/404.html').catch(() => {});
  await ep.setContent(readFileSync(join(OUT, 'referral-email.html'), 'utf8'));
  await ep.waitForTimeout(300);
  await ep.screenshot({ path: join(OUT, '07-referral-email.png'), fullPage: true });
  await ep.close();

  /* 12. On a phone. */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-SG', timezoneId: 'Asia/Singapore' });
  await routeOutside(phone);
  const pp = await phone.newPage();
  watch(pp, 'phone');
  await pp.clock.setFixedTime(NOW);
  await pp.addInitScript(seed => { window.__fakeSeed = { docs: seed }; }, Object.assign({ 'schedule_config/main': SCHEDULE, 'officeSettings/config': { combinedMonths: [] } }, FAMILIES, BOOKINGS));
  await pp.goto(BASE + '/office/#referrals');
  await pp.waitForSelector('text=Waiting for you to confirm');
  if (process.env.REF_FONT) await pp.addStyleTag({ content: '* { font-family: "' + process.env.REF_FONT + '" !important; }' });
  const wide = await pp.evaluate(() => document.documentElement.scrollWidth);
  const over = wide > 392 ? await pp.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > 392 && !e.closest('.table-wrap')).slice(-8).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right))) : [];
  assert.ok(wide <= 392, 'the phone page does not scroll sideways (' + wide + ') ' + JSON.stringify(over));
  await pp.screenshot({ path: join(OUT, '08-referrals-phone.png'), animations: 'disabled' });
  await phone.close();
  ok('the Referrals tab fits a phone');

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + passed + ' referral browser checks passed.');
