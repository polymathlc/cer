// 🚨 Red light fixer in a real browser: the real page markup and CSS from
// index.html, the real `rlf*` section from app.js, scripted checks and repairs.
// Desktop and phone width. Nothing here opens an account or spends a cent.
//
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node tools/red-light-fixer-browser.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { harnessState, harnessSource } from './red-light-fixer-tests.mjs';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const executablePath = process.env.CHROME_PATH || undefined;
const browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const output = process.env.RED_LIGHT_QA_DIR || fileURLToPath(new URL('../../red-light-qa/', import.meta.url));
fs.mkdirSync(output, { recursive: true });

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const costSource = fs.readFileSync(new URL('../ai-cost-core.mjs', import.meta.url), 'utf8');
const css = [...html.slice(0, html.indexOf('</head>')).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
const cut = (from, to) => {
  const a = html.indexOf(from), b = html.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, 'markup found: ' + from.slice(0, 40));
  return html.slice(a, b);
};
const pageMarkup = cut('<div class="page" id="page-redlights">', '<div class="page" id="page-checkq">');
const priceMarkup = cut('<div class="tl-overlay aip-overlay" id="aiPriceOverlay"', '<div class="tl-overlay" id="tlOverlay"');
const shell = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css
  + ' .page{display:block !important}</style></head><body><main class="main">' + pageMarkup + '</main>' + priceMarkup + '</body></html>';

async function fixture(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/*', route => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/ai-cost-core.mjs')) return route.fulfill({ contentType: 'text/javascript', body: costSource });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: shell });
  });
  await page.goto('https://red-light.test/');
  await page.evaluate(async ({ stateSrc, harness }) => {
    const cost = await import('/ai-cost-core.mjs');
    const clone = v => JSON.parse(JSON.stringify(v));
    const harnessState = new Function('clone', 'return ' + stateSrc)(clone);
    const mcq = (id, extra = {}) => ({ id, title: 'Which material conducts heat best — question ' + id, topic: id > 'q6' ? 'Matter' : 'Heat', category: 'MCQ', qno: Number(id.slice(1)),
      blocks: [{ id: id + '_b1', type: 'text', content: 'Stem ' + id }], ...extra });
    const high = t => ({ severity: 'high', title: t, ai: true });
    const H = harnessState({
      bank: Array.from({ length: 12 }, (_, i) => mcq('q' + (i + 1))),
      aiCostPerCheck: 3500,
      checkFor: q => {
        const fixed = /^Fixed/.test(q.blocks[0].content);
        const n = Number(q.id.slice(1));
        if (fixed) return n % 3 === 0 ? { verdict: 'red', findings: [high('The diagram still shows the wrong beam height')] } : { verdict: n % 2 ? 'green' : 'amber', findings: n % 2 ? [] : [{ severity: 'med', title: 'Wording could be clearer' }] };
        return n <= 6 ? { verdict: 'red', findings: [high('The marked option is not the correct answer'), high('Option 3 repeats the table'), { severity: 'med', title: 'The stem is ambiguous about the container' }] } : { verdict: 'green', findings: [] };
      },
    });
    window.H = H;
    window.qa = new Function('cost', 'H', 'clone', harness)(cost, H, clone);
    window.tlClick = () => {};
    Object.assign(window, qa);
    qa.renderRedLightsPage();
  }, { stateSrc: harnessState.toString(), harness: harnessSource({ browser: true }) });
  return { page, errors, close: () => context.close() };
}

const noOverflow = async (page, what) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  assert.ok(o.sw <= o.w + 1, what + ': no sideways scroll (' + o.sw + ' > ' + o.w + ')');
};

try {
  for (const width of [1280, 390]) {
    const f = await fixture(width), page = f.page, tag = width > 500 ? 'desktop' : 'phone';
    try {
      await page.waitForSelector('#rlfBody .rlf-scope');
      assert.match(await page.locator('.rlf-scope-est').innerText(), /12 questions in scope/);
      await page.screenshot({ path: path.join(output, tag + '-1-start.png'), fullPage: true });
      await page.locator('button', { hasText: 'Launch checker' }).click();
      await page.waitForFunction(() => qa.rlf && qa.rlf.stage === 'idle' && qa.rlf.check && qa.rlf.check.endedAt);
      await page.evaluate(() => qa.rlfPaint());
      assert.equal(await page.locator('#rlfBody .rlf-list').first().locator('.rlf-row').count(), 6, 'six reds listed');
      assert.match(await page.locator('#rlfCost .rlf-cost-total').innerText(), /^\$0\.\d+/);
      assert.match(await page.locator('#rlfBody .rlf-list-head h3').innerText(), /6 red questions/);
      await noOverflow(page, tag + ' after the check');
      await page.screenshot({ path: path.join(output, tag + '-2-reds.png'), fullPage: true });
      await page.locator('#rlfBody .rlf-list-head button', { hasText: 'Fix' }).click();
      await page.waitForFunction(() => qa.rlf && qa.rlf.stage === 'idle' && qa.rlf.roundStats && qa.rlf.roundStats.endedAt);
      await page.evaluate(() => qa.rlfPaint());
      assert.match(await page.locator('#rlfBody .rlf-list-head h3').innerText(), /2 red questions/, 'only the ones still red remain');
      assert.match(await page.locator('#rlfBody .rlf-list-head button.rlf-again').innerText(), /Fix further — round 2/);
      assert.match(await page.locator('.rlf-fixed summary').innerText(), /4 left the red list/);
      assert.match(await page.locator('.rlf-last').innerText(), /Round 1: 4 left the red list/);
      await noOverflow(page, tag + ' after round 1');
      await page.screenshot({ path: path.join(output, tag + '-3-round1.png'), fullPage: true });
      await page.evaluate(() => qa.aiPriceDialogOpen());
      assert.equal(await page.locator('#aiPriceBody input[data-aip-key]').count() > 8, true);
      await noOverflow(page, tag + ' price dialog');
      await page.screenshot({ path: path.join(output, tag + '-4-prices.png') });
      assert.deepEqual(f.errors, []);
      console.log('PASS ' + tag + ' check → red list → round 1 → prices');
    } finally { await f.close(); }
  }
} finally { await browser.close(); }
console.log('Screenshots in ' + output);
