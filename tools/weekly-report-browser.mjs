// 📈 The weekly parent progress reports in a real browser.
//
//   node tools/weekly-report-browser.mjs            (needs `playwright` resolvable, or PW=<its index.mjs>)
//   CONCEPT_TAGS_FILE=<anskey checkout>/concept-tags.js   name the slips as Ans Key does (optional)
//
// 1. Builds the sample centre's reports (tools/weekly-report-fixtures.mjs) with the
//    real rules and photographs a parent's email on a phone and on a computer.
// 2. Opens the SHIPPED office page at #reports with Firebase replaced by
//    tools/office-fake-firebase.js, seeded with those reports as the sender
//    would leave them, and drives the tab: the mode (with its confirmation),
//    "Email me this week's reports", "Email parents now" (with its
//    confirmation), the centre's note, taking a family off the list, and the
//    👁 preview of one family's report.
// Screenshots go to WEEKLY_SHOTS (default artifacts/weekly-reports). Nothing is sent anywhere.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as C from '../office/office-core.mjs';
import * as W from '../office/weekly-report-core.mjs';
import { buildReports } from './weekly-reports.mjs';
import * as F from './weekly-report-fixtures.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.WEEKLY_SHOTS || join(ROOT, 'artifacts', 'weekly-reports');
mkdirSync(OUT, { recursive: true });
const { chromium } = process.env.PW ? await import(process.env.PW) : createRequire(import.meta.url)('playwright');

/* ─── The reports, built with the real rules ─── */
let tags = null;
if (process.env.CONCEPT_TAGS_FILE && existsSync(process.env.CONCEPT_TAGS_FILE)) {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(process.env.CONCEPT_TAGS_FILE, 'utf8'), sandbox);
  tags = sandbox.module.exports;
}
const NOW = F.SUNDAY_6PM + 4 * 60e3;
const weekKey = W.weekKeyFor(F.SUNDAY_6PM);
const win = W.weekWindow(weekKey, NOW);
const weekly = W.normalizeWeekly({ mode: 'review', note: 'No lessons from 14 Dec to 3 Jan. Happy holidays, and see you in the new year!' });
const reports = buildReports(F.data({ tags }), weekly, win, NOW, F.clock);
const tan = reports.find(r => r.familyId === 'famA');
const email = W.weeklyEmail(tan, {}, weekly, win);
writeFileSync(join(OUT, 'sample-email.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + C.escapeHtml(email.subject) + '</title><body style="margin:0">' + email.html + '</body>');

/* ─── A static server for the repo ─── */
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = p.startsWith('/__out/') ? join(OUT, p.slice(7)) : join(ROOT, p);
  if (!existsSync(file)) { res.writeHead(404); res.end('missing'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const FAKE_FB = readFileSync(join(ROOT, 'tools', 'office-fake-firebase.js'), 'utf8');
const outside = [];
async function routeOutside(context) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const url = route.request().url();
    if (url.startsWith('https://www.gstatic.com/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: url.includes('app-compat') ? FAKE_FB : '' });
    if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (url === C.EMAIL_LOGO_URL) return route.fulfill({ contentType: 'image/png', body: readFileSync(join(ROOT, 'assets', 'branding', 'polymath-logo-email.png')) });
    if (url.startsWith('https://firestore.googleapis.com/')) return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    outside.push(url);
    return route.abort();
  });
}

const errors = [];
function watch(page, label) {
  page.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
  // (The harness's own seed script is offered to the sandboxed preview frame too, which rightly refuses it.)
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED|Blocked script execution in 'about:srcdoc'/.test(m.text())) errors.push(label + ' console: ' + m.text()); });
  page.on('dialog', d => { errors.push(label + ' unexpected browser dialog: ' + d.message()); d.dismiss(); });
}
const store = page => page.evaluate(() => Object.fromEntries([...window.__fakeStore.entries()]));
const browser = await chromium.launch();
try {
  /* ════════ 1. The parent's email ════════ */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await routeOutside(phone);
  const pp = await phone.newPage();
  watch(pp, 'email-phone');
  await pp.goto(BASE + '/__out/sample-email.html');
  await pp.waitForTimeout(300);
  await pp.screenshot({ path: join(OUT, 'email-phone.png'), fullPage: true });
  const pageWidth = await pp.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(pageWidth <= 392, 'the email fits a phone without sideways scrolling (' + pageWidth + 'px)');
  const desk = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
  await routeOutside(desk);
  const dp = await desk.newPage();
  watch(dp, 'email-desktop');
  await dp.goto(BASE + '/__out/sample-email.html');
  await dp.waitForTimeout(300);
  await dp.screenshot({ path: join(OUT, 'email-desktop.png'), fullPage: true });
  const text = await dp.locator('body').innerText();
  for (const want of ['Ethan Tan', 'Chloe Tan', 'In class this week', 'Plant Transport', 'Next: Human Circulatory System', 'Live lessons', 'Practice at home', 'Doing well', 'Needs more work', 'What to practise this week', 'No lessons from 14 Dec']) {
    assert.ok(text.toLowerCase().includes(want.toLowerCase()), 'the email shows "' + want + '"');
  }

  /* ════════ 2. The office's Reports tab ════════ */
  const docs = { 'schedule_config/main': F.schedule, 'officeSettings/config': {} };
  F.families.forEach(f => { docs['officeFamilies/' + f.id] = f; });
  docs['officeSettings/' + W.WEEKLY_DOC] = { mode: 'review', note: weekly.note, lastResult: 'Emailed the office a preview of 1 report for ' + W.weekLabel(win) + '.', lastRunAt: NOW, lastCheckAt: NOW };
  docs['officeSettings/' + W.weekLogId(weekKey, 'preview')] = W.weekLog(weekKey, win, reports, { kind: 'preview', auto: true, at: NOW });
  reports.filter(r => !r.empty).forEach(r => {
    const m = W.weeklyEmail(r, {}, weekly, win);
    docs['officeSettings/' + W.familyLogId(weekKey, r.familyId)] = { kind: W.WEEKLY_FAMILY_KIND, weekKey, familyId: r.familyId, parentName: r.parentName, to: r.to, subject: m.subject, html: m.html, builtAt: NOW, runKind: 'preview' };
  });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-SG', timezoneId: 'Asia/Singapore' });
  await routeOutside(ctx);
  const page = await ctx.newPage();
  watch(page, 'office');
  await page.clock.setFixedTime(new Date(NOW + 3600e3));
  await page.addInitScript(d => { window.__fakeSeed = { docs: d }; }, docs);
  await page.goto(BASE + '/office/#reports');
  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForSelector('text=Weekly progress reports');
  await page.waitForSelector('text=Recent weeks');
  assert.ok(await page.locator('#tabs .tab[data-view="reports"].active').count(), 'the Reports tab is open from #reports');
  assert.ok(await page.locator('text=Mrs Tan').first().isVisible());
  await page.screenshot({ path: join(OUT, 'office-reports.png'), fullPage: true });

  // 👁 Preview one family's report.
  await page.click('[data-wr="preview"][data-f="famA"]');
  await page.waitForSelector('#wr-overlay iframe');
  const inFrame = await page.frameLocator('#wr-overlay iframe').locator('body').innerText();
  assert.ok(inFrame.includes('Ethan Tan') && /what to practise this week/i.test(inFrame));
  await page.screenshot({ path: join(OUT, 'office-preview.png') });
  await page.click('[data-wr="closePreview"]');
  await page.waitForSelector('#wr-overlay', { state: 'detached' });

  // "Email me this week's reports" writes a preview request.
  await page.click('[data-wr="askPreview"]');
  await page.waitForSelector('text=Emailing you the reports');
  let all = await store(page);
  assert.equal(all['officeSettings/weeklyReports'].request.kind, 'preview');
  assert.equal(all['officeSettings/weeklyReports'].request.by, 'chungzhikai@gmail.com');
  assert.ok(await page.locator('[data-wr="askSend"][disabled]').count(), 'one request at a time');
  // The sender takes it (as tools/weekly-reports.mjs does).
  await page.evaluate(() => { const s = window.__fakeStore; const d = s.get('officeSettings/weeklyReports'); window.firebase.firestore().collection('officeSettings').doc('weeklyReports').set({ lastRequestDone: d.request.id }, { merge: true }); });
  await page.waitForSelector('[data-wr="askSend"]:not([disabled])');

  // "Email parents now" asks first.
  await page.click('[data-wr="askSend"]');
  await page.waitForSelector('text=Email this week\'s report to parents now?');
  await page.click('[data-wr="askSendNo"]');
  all = await store(page);
  assert.equal(all['officeSettings/weeklyReports'].request.kind, 'preview', 'Cancel sends nothing');
  await page.click('[data-wr="askSend"]');
  await page.click('[data-wr="askSendYes"]');
  await page.waitForSelector('text=Emailing parents');
  all = await store(page);
  assert.equal(all['officeSettings/weeklyReports'].request.kind, 'send');

  // The mode: "Email parents every Sunday" asks first; Off is immediate.
  await page.check('input[name="wr-mode"][value="send"]');
  await page.waitForSelector('text=Email every family their report each Sunday?');
  await page.screenshot({ path: join(OUT, 'office-mode-confirm.png'), fullPage: false });
  await page.click('[data-wr="modeSendYes"]');
  await page.waitForTimeout(200);
  all = await store(page);
  assert.equal(all['officeSettings/weeklyReports'].mode, 'send');
  await page.check('input[name="wr-mode"][value="off"]');
  await page.waitForTimeout(200);
  all = await store(page);
  assert.equal(all['officeSettings/weeklyReports'].mode, 'off');

  // The centre's note.
  await page.fill('#wr-note', 'Exam week: bring two pencils.');
  await page.click('[data-wr="saveNote"]');
  await page.waitForTimeout(200);
  all = await store(page);
  assert.equal(all['officeSettings/weeklyReports'].note, 'Exam week: bring two pencils.');

  // Take a family off the list, then put them back.
  await page.uncheck('input[data-wr="optToggle"][data-f="famA"]');
  await page.waitForTimeout(200);
  all = await store(page);
  assert.deepEqual(all['officeSettings/weeklyReports'].optOut, { famA: true });
  await page.check('input[data-wr="optToggle"][data-f="famA"]');
  await page.waitForTimeout(200);
  all = await store(page);
  assert.deepEqual(all['officeSettings/weeklyReports'].optOut, {});

  // On a phone, the tab still fits.
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-SG', timezoneId: 'Asia/Singapore' });
  await routeOutside(pctx);
  const ph = await pctx.newPage();
  watch(ph, 'office-phone');
  await ph.clock.setFixedTime(new Date(NOW + 3600e3));
  await ph.addInitScript(d => { window.__fakeSeed = { docs: d }; }, docs);
  await ph.goto(BASE + '/office/#reports');
  await ph.waitForSelector('text=Recent weeks');
  await ph.screenshot({ path: join(OUT, 'office-reports-phone.png'), fullPage: true });
  const w2 = await ph.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w2 <= 400, 'the Reports tab fits a phone (' + w2 + 'px)');

  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('Weekly reports browser check passed. Screens in ' + OUT + (outside.length ? ' (refused: ' + [...new Set(outside)].length + ' outside requests)' : ''));
} finally {
  await browser.close();
  server.close();
}
