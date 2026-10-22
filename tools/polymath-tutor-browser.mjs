// 🧠 The Polymath — the SHIPPED page (polymath.html + polymath-tutor.js +
// polymath-tutor-core.mjs) in Chromium, with the four Firebase modules it
// imports from gstatic replaced by local fakes. No account, no real model.
//   PLAYWRIGHT_MODULE=/path/to/playwright node tools/polymath-tutor-browser.mjs
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as core from '../polymath-tutor-core.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const QA_DIR = process.env.POLYMATH_QA_DIR || '';

const PAPER = core.normalizeTutorPaper({
  title: 'PSLE 2019 Science — Heat',
  questions: [
    { label: 'Question 1 — PSLE 2019 Q4', source: 'PSLE 2019 Q4', items: [
      { t: 'text', text: 'Which material is the best conductor of heat?' },
      { t: 'img', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAAYCAIAAAApowkFAAAANElEQVR4nO3OUQkAIBBAsevf0X9baAyfMFiAzdrnO/N8IB0mLS0dIC0tHSAtLR0gLS0dcAET9I9iZMlIjAAAAABJRU5ErkJggg==', caption: 'Four spoons' },
      { t: 'mcq', id: 's1', options: [{ label: '1', text: 'Wood' }, { label: '2', text: 'Plastic' }, { label: '3', text: 'Steel' }, { label: '4', text: 'Rubber' }] },
    ], mcq: { s1: '3' }, key: [{ label: 'Answer', text: '3. Steel' }] },
    { label: 'Question 2', marks: 2, items: [
      { t: 'text', text: 'Explain why the ice cube melted faster on the metal tray.', part: '(a)' },
      { t: 'table', rows: [{ c: ['Tray', 'Time (min)'] }, { c: ['Metal', '4'] }, { c: ['Plastic', '9'] }] },
      { t: 'write', id: 's1', lines: 3, part: '(a)' },
      { t: 'fill', id: 's2', segments: [{ text: 'Heat flows from a ' }, { blank: true }, { text: ' object to a colder one.' }] },
    ], key: [{ part: '(a)', text: 'Metal is a good conductor of heat, so the ice gained heat faster from the tray.' }] },
  ],
});
const ID = core.tutorPaperId(PAPER);

// The fakes stand in for the exact gstatic URLs polymath.html imports.
const FAKES = {
  'firebase-app.js': 'export function initializeApp(c){ window.__fb.config = c; return { name: "app" }; }',
  'firebase-app-check.js': 'export class ReCaptchaV3Provider { constructor(k){ this.key = k; } } export function initializeAppCheck(app, o){ window.__fb.appCheck = o.provider.key; return {}; }',
  'firebase-firestore.js': `export function getFirestore(){ return {}; }
    export function doc(db, col, id){ return { col, id }; }
    export async function getDoc(ref){ window.__fb.reads.push(ref); const p = window.__fb.papers[ref.col + '/' + ref.id]; return { exists: () => !!p, data: () => JSON.parse(JSON.stringify(p)) }; }`,
  'firebase-ai.js': `export class GoogleAIBackend {}
    export function getAI(){ return {}; }
    export function getGenerativeModel(ai, o){ window.__fb.model = o.model; return { async generateContent(req){
      const parts = req.contents[0].parts; const prompt = parts[0].text;
      window.__fb.asks.push({ prompt, images: parts.length - 1, json: req.generationConfig.responseMimeType === 'application/json' });
      let text = 'Think about which material lets heat pass through easily.';
      if (window.__fb.fail) throw new Error('[429] quota exceeded');
      if (req.generationConfig.responseMimeType === 'application/json') text = /CORRECT/.test(prompt) ? '{"verdict":"incorrect","feedback":"Great choice! Steel conducts heat well.","nextStep":""}' : '{"verdict":"partial","feedback":"You noticed the metal tray. **Good.**","nextStep":"What does the metal do with heat?"}';
      else if (/teach the full answer/.test(prompt)) text = 'Metal is a good conductor of heat. Model answer: the ice gained heat faster.';
      else if (/^Student:/m.test(prompt)) text = 'A conductor lets heat flow through it quickly.';
      return { response: { text: () => text } };
    } }; }`,
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (type, body, status = 200) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (url.pathname === '/fixture.svg') return send('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120" fill="#eef"/><text x="10" y="60">spoons</text></svg>');
  const file = ROOT + url.pathname.replace(/^\/+/, '');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send('text/plain', 'missing', 404);
  const type = /\.html$/.test(file) ? 'text/html; charset=utf-8' : /\.m?js$/.test(file) ? 'text/javascript' : /\.png$/.test(file) ? 'image/png' : 'application/octet-stream';
  send(type, fs.readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok - ' + name); }
  catch (e) { failed++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); }
}
async function open(hash, width = 390, papers) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://www.gstatic.com/firebasejs/**', route => {
    const name = route.request().url().split('/').pop();
    if (!FAKES[name]) return route.abort();
    route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKES[name] });
  });
  await page.addInitScript(([papers]) => { window.__fb = { papers, reads: [], asks: [] }; }, [papers || { ['polymathTutorPapers/' + ID]: PAPER }]);
  await page.goto(origin + '/polymath.html' + hash);
  return { context, page, errors };
}
const shot = async (page, name) => { if (QA_DIR) { fs.mkdirSync(QA_DIR, { recursive: true }); await page.screenshot({ path: QA_DIR + '/' + name + '.png', fullPage: true }); } };

await check('the whole-paper code opens the paper list', async () => {
  const { context, page, errors } = await open('#' + ID);
  await page.getByRole('heading', { name: PAPER.title }).waitFor();
  assert.equal(await page.locator('.pt-qrow').count(), 2);
  assert.equal(await page.title(), 'The Polymath');
  assert.equal(await page.locator('.pt-brand-text strong').textContent(), 'The Polymath');
  const fb = await page.evaluate(() => window.__fb);
  assert.deepEqual(fb.reads, [{ col: 'polymathTutorPapers', id: ID }]);
  assert.equal(fb.config.projectId, 'mathgen--app');
  assert.ok(fb.appCheck, 'App Check is started');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, 'no sideways scroll on a phone');
  await shot(page, 'paper');
  await page.getByRole('button', { name: /Start with Question 1/ }).click();
  await page.waitForFunction(id => location.hash === '#' + id + '/1', ID);
  await page.getByRole('heading', { name: 'Question 1 — PSLE 2019 Q4' }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

await check('an MCQ is marked by the key, and the model explains', async () => {
  const { context, page, errors } = await open('#' + ID + '/1');
  await page.getByRole('heading', { name: 'Question 1 — PSLE 2019 Q4' }).waitFor();
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.getByText('Have a go first').waitFor();
  assert.equal((await page.evaluate(() => window.__fb.asks)).length, 0, 'no call for an empty answer');
  await page.getByRole('radio', { name: /Steel/ }).click();
  assert.equal(await page.getByRole('radio', { name: /Steel/ }).getAttribute('aria-checked'), 'true');
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.locator('.pt-feedback.pt-correct').waitFor();
  // The fake model said "incorrect"; the key said option 3 — the key wins.
  assert.match(await page.locator('.pt-feedback').textContent(), /Correct/);
  const ask = (await page.evaluate(() => window.__fb.asks))[0];
  assert.ok(ask.json, 'marking asks for JSON');
  assert.equal(ask.images, 1, 'the question\'s picture goes to the model');
  assert.match(ask.prompt, /You are The Polymath/);
  assert.match(ask.prompt, /Chose option \(3\)/);
  assert.ok(await page.getByRole('button', { name: '📘 Worked solution' }).isEnabled(), 'right answer unlocks the solution');
  // Progress is on the phone: reload and it is still there.
  await page.reload();
  await page.locator('.pt-feedback.pt-correct').waitFor();
  assert.equal(await page.locator('.pt-score b').textContent(), '1');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('an open question: hints step up, the solution stays locked until a real go, chat works', async () => {
  const { context, page, errors } = await open('#' + ID + '/2');
  await page.getByRole('heading', { name: 'Question 2' }).waitFor();
  assert.equal(await page.locator('.pt-table tr').count(), 3);
  assert.ok(await page.getByRole('button', { name: '🔒 Worked solution' }).isDisabled());
  await page.getByRole('button', { name: '💡 Hint 1 of 3' }).click();
  await page.locator('.pt-hint').first().waitFor();
  assert.match((await page.evaluate(() => window.__fb.asks)).at(-1).prompt, /SMALLEST/);
  await page.getByRole('textbox', { name: '(a) Your answer' }).fill('The metal tray was warmer.');
  await page.getByRole('textbox', { name: 'Blank 1' }).fill('hotter');
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.locator('.pt-feedback.pt-partial').waitFor();
  assert.match(await page.locator('.pt-feedback').textContent(), /You noticed the metal tray\. Good\./, 'markdown is stripped');
  const prompt = (await page.evaluate(() => window.__fb.asks)).at(-1).prompt;
  assert.match(prompt, /The metal tray was warmer\./);
  assert.match(prompt, /\(1\) hotter/);
  assert.match(prompt, /good conductor of heat/);
  assert.ok(await page.getByRole('button', { name: '🔒 Worked solution' }).isDisabled(), 'one try is not enough');
  await page.getByRole('button', { name: 'Check again' }).click();
  await page.getByText('try 2').waitFor();
  await page.getByRole('button', { name: '📘 Worked solution' }).click();
  await page.locator('.pt-solution').waitFor();
  await page.getByRole('textbox', { name: 'Message to The Polymath' }).fill('What is a conductor?');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.pt-bubble.pt-tutor').waitFor();
  assert.match(await page.locator('.pt-bubble.pt-tutor').textContent(), /lets heat flow/);
  await shot(page, 'question');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('nothing from the document is ever run as HTML', async () => {
  const evil = core.normalizeTutorPaper({ title: '<img src=x onerror="window.__pwned=1">', questions: [{ items: [{ t: 'text', text: '<script>window.__pwned=1</script><b>bold?</b>' }] }] });
  const id = core.tutorPaperId(evil);
  const { context, page } = await open('#' + id + '/1', 390, { ['polymathTutorPapers/' + id]: evil });
  await page.locator('.pt-text').waitFor();
  assert.match(await page.locator('.pt-text').textContent(), /<script>/);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  await context.close();
});

await check('a bad link and a missing paper each say what to do', async () => {
  let s = await open('#nope');
  await s.page.getByRole('alert').waitFor();
  assert.match(await s.page.getByRole('alert').textContent(), /not a Polymath link/);
  await s.context.close();
  s = await open('#pzzzzzzzzzz/1', 390, {});
  await s.page.getByRole('alert').waitFor();
  assert.match(await s.page.getByRole('alert').textContent(), /could not be found/);
  await s.context.close();
});

await check('a busy model is a message, not a crash', async () => {
  const { context, page, errors } = await open('#' + ID + '/2');
  await page.getByRole('heading', { name: 'Question 2' }).waitFor();
  await page.evaluate(() => { window.__fb.fail = true; });
  await page.getByRole('button', { name: '💡 Hint 1 of 3' }).click();
  await page.locator('.pt-inline-error').waitFor();
  assert.match(await page.locator('.pt-inline-error').textContent(), /very busy/);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all browser checks passed');
