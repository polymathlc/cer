// 🩺 Books a free diagnostic test on /diagnostic in a real browser, at desktop and
// phone widths, with the timetable and the booking function stood in for:
//   node tools/diagnostic-browser.mjs            (DIAGNOSTIC_SCREENSHOTS=dir to keep pictures)
// It checks that the Master Class sessions from December are listed by month, that
// the form posts exactly the fields bookDiagnostic takes, that refusals are shown in
// words, and that nothing scrolls sideways on a phone.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.DIAGNOSTIC_SCREENSHOTS || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const fields = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? { stringValue: v } : { integerValue: String(v) }]));
const slot = s => ({ mapValue: { fields: fields(s) } });
const TIMETABLE = { name: 'schedule_config/main', fields: {
  masterTrialPrice: { integerValue: '100' },
  slots: { mapValue: { fields: {
    'TUE-1': slot({ level: 'P5', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' }),
    'TUE-3': slot({ level: 'P6', subject: 'Math', mode: 'Physical', status: 'open', type: 'master', fee: '400' }),
    'WED-3': slot({ level: 'P6', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' }),
    'THU-3': slot({ level: 'P5', subject: 'Math', mode: 'Physical', status: 'open', type: 'master', fee: '400' }),
    'MON-2': slot({ level: 'P6', subject: 'Math', mode: 'Both', status: 'open', type: 'regular' })
  } } }
} };

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

async function openPage(viewport, answer) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  // 5 Nov 2026, 11am in Singapore.
  await page.clock.install({ time: new Date(Date.UTC(2026, 10, 5, 3)) });
  const posts = [];
  await page.route(/firestore\.googleapis\.com/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TIMETABLE) }));
  await page.route(/gstatic\.com|fonts\.(googleapis|gstatic)\.com/, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route(/cloudfunctions\.net\/bookDiagnostic/, async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    posts.push(body);
    const [status, json] = answer(body);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/diagnostic/');
  return { context, page, posts, errors };
}
const booked = body => [201, { ok: true, already: false, booking: { code: 'ABC234', slot: body.slot, date: body.date,
  sessionLabel: 'Tuesday 8 December 2026, 3:00pm – 4:45pm', parentName: body.parentName, studentName: body.studentName,
  email: body.email, subject: body.subject, level: body.level, worth: 100, confirmationSent: true } }];

for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  await check(label + ': the December Master Class sessions are listed and a booking goes through', async () => {
    const { context, page, posts, errors } = await openPage(viewport, booked);
    await page.waitForSelector('.session');
    const months = await page.$$eval('.month-tab', els => els.map(e => e.textContent));
    assert.equal(months[0], 'December 2026', 'the first month is December');
    const days = await page.$$eval('.session-day h4', els => els.map(e => e.textContent));
    assert.equal(days[0], 'Tuesday 8 December 2026', 'the first session is the first Master Class from 7 December');
    assert.ok(!days.some(d => /Monday/.test(d)), 'regular classes are not offered');
    const first = await page.$$eval('.session', els => els.map(e => e.dataset.slot + ' ' + e.dataset.date).slice(0, 4));
    assert.deepEqual(first, ['TUE-1 2026-12-08', 'TUE-3 2026-12-08', 'WED-3 2026-12-09', 'THU-3 2026-12-10']);
    if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, 'diagnostic-' + label + '.png'), fullPage: true }); }

    // Submitting without a subject is refused in words.
    await page.click('#submit-btn');
    assert.match(await page.textContent('#toast'), /Maths or Science/);

    await page.click('#subject-chips [data-subject="Science"]');
    await page.selectOption('#f-level', 'Primary 5');
    await page.check('#match-only');
    const matching = await page.$$eval('.session', els => [...new Set(els.map(e => e.dataset.slot))]);
    assert.deepEqual(matching, ['TUE-1'], 'only Primary 5 Science Master Classes when asked');
    await page.uncheck('#match-only');
    await page.click('.session[data-slot="TUE-1"][data-date="2026-12-08"]');
    assert.match(await page.textContent('#chosen'), /Tuesday 8 December 2026, 3:00pm – 4:45pm/);
    await page.fill('#f-parent', 'Test Parent');
    await page.fill('#f-email', 'parent@example.test');
    await page.fill('#f-student', 'Ava Tan');
    await page.click('#submit-btn');
    await page.waitForSelector('#book-success:not(.hidden)');
    assert.deepEqual(posts[0], { slot: 'TUE-1', date: '2026-12-08', parentName: 'Test Parent', email: 'parent@example.test',
      studentName: 'Ava Tan', subject: 'Science', level: 'Primary 5', pageVersion: posts[0].pageVersion });
    assert.match(posts[0].pageVersion, /^v\d+\.\d+\.\d+$/);
    assert.match(await page.textContent('#success-summary'), /ABC234/);
    assert.match(await page.textContent('#success-text'), /confirmation is on its way to parent@example\.test/);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(sideways, false, 'nothing scrolls sideways');
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'diagnostic-' + label + '-booked.png'), fullPage: false });
    assert.deepEqual(errors, []);
    await context.close();
  });
}

await check('a session that has gone is refused in words and let go', async () => {
  const { context, page } = await openPage({ width: 1280, height: 900 }, () => [409, { ok: false, error: 'session-unavailable' }]);
  await page.waitForSelector('.session');
  await page.click('#subject-chips [data-subject="Math"]');
  await page.selectOption('#f-level', 'Primary 6');
  await page.click('.session[data-slot="TUE-3"]');
  await page.fill('#f-parent', 'P'); await page.fill('#f-email', 'p@example.test'); await page.fill('#f-student', 'S');
  await page.click('#submit-btn');
  await page.waitForFunction(() => /no longer available/.test(document.getElementById('toast').textContent));
  assert.ok(await page.isHidden('#chosen'), 'the gone session is no longer chosen');
  assert.ok(await page.isHidden('#book-success'));
  await context.close();
});

await browser.close();
server.close();
console.log('# pass ' + passed);
