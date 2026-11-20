// Polymath Homework Helper — the page in a real browser, with the Firebase/AI services and the access gate
// replaced by fixtures (tools/homework-fixtures/), so it needs no account and no network.
//   npm install --no-save playwright && npx playwright install chromium && node tools/homework-browser.mjs
// HOMEWORK_SCREENSHOTS=<dir> saves screenshots (desktop and phone).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tools', 'homework-fixtures');
const shots = process.env.HOMEWORK_SCREENSHOTS || '';
const scale = Number(process.env.HOMEWORK_SCALE || 1);
if (shots) fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const SAMPLE = path.join(fixtures, 'sample-question.png');
const LOGO = path.join(root, 'assets', 'branding', 'polymath-learning-centre.png');

let checks = 0;
const ok = (cond, what) => { assert.ok(cond, what); checks += 1; };
const same = (a, b, what) => { assert.equal(a, b, what); checks += 1; };

async function open(browser, cfg = {}, { phone = false } = {}) {
  const ctx = await browser.newContext(phone ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.addInitScript(c => { window.__hw = c; window.__asStaff = !!c.staff; }, cfg);
  await page.route('**/homework/homework-services.js*', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(fixtures, 'stub-services.js'), 'utf8') }));
  await page.route('**/student/access-gate.js*', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(fixtures, 'stub-gate.js'), 'utf8') }));
  await page.route(/^https:\/\//, r => /polymath-logo-sticker/.test(r.request().url())
    ? r.fulfill({ contentType: 'image/png', body: fs.readFileSync(LOGO) })
    : r.fulfill({ status: 404, body: '' }));
  await page.goto(base + '/homework/');
  return { page, errors, ctx };
}
const shot = async (page, name, fullPage = false) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage }); };
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const browser = await chromium.launch();
try {
  // ── 1. A student on a computer: photo → hints one at a time → checks → solved ──
  {
    const { page, errors, ctx } = await open(browser, {});
    await page.waitForSelector('#app:not([hidden]) #takePhotoButton');
    same(await page.isVisible('#signinScreen'), false, 'signed in: no sign-in card');
    same(await page.textContent('h1.hero-title'), 'Stuck on a question?', 'the big question');
    ok(/not<\/b> tell you the answer/.test(await page.innerHTML('.promise')), 'it promises hints, not answers');
    await page.waitForTimeout(400);
    await shot(page, 'ask-desktop');
    await page.setInputFiles('#fileInput', SAMPLE);
    await page.waitForSelector('#preview:not([hidden])');
    ok((await page.getAttribute('#previewImage', 'src')).startsWith('data:image/jpeg;base64,'), 'the photo is shrunk to a JPEG');
    same(await page.isVisible('#childField'), false, 'one child: no "who is asking"');
    same(await page.isVisible('#levelField'), false, 'a student does not pick a level');
    same(await page.textContent('#allowanceLine'), '15 photo questions left today');
    await page.fill('#noteInput', 'Question 5. I tried adding.');
    await shot(page, 'photo-ready-desktop');
    await page.click('#getHintsButton');
    await page.waitForSelector('#coachView:not([hidden])');
    const calls = await page.evaluate(() => window.__hwCalls);
    const startCall = calls.find(c => c.mode === 'start');
    same(startCall.note, 'Question 5. I tried adding.', 'the note goes with the photo');
    same(startCall.photo, 'data:image/jpeg;base64,', 'a JPEG is sent');
    ok(startCall.length < 6 * 1024 * 1024, 'well under the server limit');
    ok((await page.textContent('#questionText')).includes('4 boxes of pencils'), 'the question as read is shown');
    same(await page.textContent('#subjectChip'), '➗ Maths');
    same(await page.$$eval('.step', els => els.length), 2, 'two steps');
    same(await page.$$eval('.step[data-step="1"] .hint', els => els.length), 1, 'the first hint is open straight away, only one');
    ok((await page.textContent('.step[data-step="2"] .step-goal')).startsWith('Opens when you finish step 1'), 'step 2 waits its turn');
    same(await page.textContent('#allowanceLine'), '14 photo questions left today', 'the allowance counts down');
    await shot(page, 'coach-desktop', true);

    await page.click('.step[data-step="1"] .btn-hint');
    same(await page.$$eval('.step[data-step="1"] .hint', els => els.length), 2, 'a second hint, only when asked');
    // A wrong try, then the first step, then the answer.
    await page.fill('#replyInput', '4 + 18 = 22');
    await page.click('#replyButton');
    await page.waitForSelector('.turn.coach.v-not-yet');
    ok((await page.textContent('.turn.coach.v-not-yet')).includes('Not yet, look again'), 'a wrong try is gently flagged');
    await page.fill('#replyInput', '4 × 18 = 72');
    await page.click('#replyButton');
    await page.waitForSelector('.turn.coach.v-on-track');
    ok(await page.$eval('.step[data-step="1"]', el => el.classList.contains('is-done')), 'the helper moves the steps along with the student');
    ok(await page.$eval('.step[data-step="2"]', el => el.classList.contains('is-current')), 'step 2 is now open');
    const replyCall = (await page.evaluate(() => window.__hwCalls)).filter(c => c.mode === 'reply')[1];
    same(replyCall.history, 2, 'the conversation so far goes with each reply');
    same(replyCall.hintsSeen, 2, 'and how many hints were opened');
    await shot(page, 'checking-desktop', true);
    await page.fill('#replyInput', '72 - 25 = 47');
    await page.click('#replyButton');
    await page.waitForSelector('#solvedCard:not([hidden])');
    ok((await page.textContent('#solvedCard h2')).includes('You solved it yourself'), 'solved!');
    await page.waitForTimeout(900);
    await shot(page, 'solved-desktop');

    // Back to the start: the question waits in "recent questions".
    await page.click('#solvedNext');
    await page.waitForSelector('#recentCard:not([hidden])');
    ok((await page.textContent('#recentList')).includes('✅ Solved'), 'the solved question is in the recent list');
    await page.click('.recent-item');
    await page.waitForSelector('#coachView:not([hidden])');
    same(await page.$$eval('.turn', els => els.length), 6, 'the conversation comes back');
    same(errors.length, 0, 'no script errors: ' + errors.join(' | '));
    await ctx.close();
  }

  // ── 2. A family with two children, on a phone ──
  {
    const { page, errors, ctx } = await open(browser, { twoChildren: true }, { phone: true });
    await page.waitForSelector('#app:not([hidden]) #takePhotoButton');
    await page.waitForTimeout(400);
    await shot(page, 'ask-phone');
    ok(await noSideways(page), 'no sideways scroll on a phone');
    await page.setInputFiles('#cameraInput', SAMPLE);
    await page.waitForSelector('#preview:not([hidden])');
    ok(await page.isVisible('#childField'), 'two children: "who is asking"');
    await page.tap('#childChips .chip:nth-child(2)');
    same(await page.getAttribute('#childChips .chip:nth-child(2)', 'aria-pressed'), 'true', 'Ben is picked');
    await shot(page, 'photo-ready-phone');
    await page.tap('#getHintsButton');
    await page.waitForSelector('#coachView:not([hidden])');
    same((await page.evaluate(() => window.__hwCalls)).find(c => c.mode === 'start').childIndex, 1, 'Ben\'s level is used');
    await page.waitForTimeout(500);
    await shot(page, 'coach-phone');
    await page.fill('#replyInput', 'Just tell me the answer');
    await page.tap('#replyButton');
    await page.waitForSelector('.turn.coach.v-question');
    await page.$eval('#chatCard', el => el.scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(400);
    await shot(page, 'ask-for-answer-phone');
    ok(await noSideways(page), 'no sideways scroll while coaching');
    same(errors.length, 0, 'no script errors on the phone: ' + errors.join(' | '));
    await ctx.close();
  }

  // ── 3. Not approved: the server's refusal is shown, no photo buttons ──
  {
    const { page, errors, ctx } = await open(browser, { refuse: 'pending' });
    await page.waitForSelector('#accessNotice:not([hidden])');
    ok((await page.textContent('#accessNoticeText')).includes('waiting for approval'), 'a pending account is told why');
    same(await page.isVisible('#takePhotoButton'), false, 'no photo buttons for a refused account');
    same(errors.length, 0, 'no script errors: ' + errors.join(' | '));
    await ctx.close();
  }

  // ── 4. Staff may pick a level to try it out ──
  {
    const { page, ctx } = await open(browser, { staff: true });
    await page.waitForSelector('#app:not([hidden]) #takePhotoButton');
    await page.setInputFiles('#fileInput', SAMPLE);
    await page.waitForSelector('#preview:not([hidden])');
    ok(await page.isVisible('#levelField'), 'staff see the level picker');
    await ctx.close();
  }

  // ── 5. Signed out: the sign-in card ──
  {
    const { page, ctx } = await open(browser, { signedOut: true });
    await page.waitForSelector('#signinScreen:not([hidden])');
    same(await page.isVisible('#app'), false, 'nothing of the app before sign-in');
    await shot(page, 'signin-desktop');
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('✓ Homework Helper page: ' + checks + ' checks passed in Chromium');
