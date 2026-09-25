// Real editor + artwork with the portal's complete CSS, without Firebase or paid AI calls.
// Optional WORKSHEET_PLAYWRIGHT_MODULE and WORKSHEET_BROWSER_EXECUTABLE.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'test-results', 'worksheet-art');
fs.mkdirSync(output, { recursive: true });
const moduleName = process.env.WORKSHEET_PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = [...index.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(x => x[1]).join('\n');
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><script src="/worksheet-art.js"></script><script src="/worksheet-art-editor.js"></script></head><body><button type="button" id="open-editor" style="margin:24px">Colour &amp; tutor characters</button><div id="printOutput"></div></body></html>`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fixture); return; }
  const allowed = ['/worksheet-art.js', '/worksheet-art-editor.js'].includes(pathname) || /^\/assets\/worksheet-characters\/[a-z-]+\.webp$/.test(pathname);
  if (!allowed) { res.writeHead(404); res.end(); return; }
  try {
    const data = fs.readFileSync(path.join(root, pathname.slice(1)));
    res.writeHead(200, { 'Content-Type': pathname.endsWith('.webp') ? 'image/webp' : 'text/javascript' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.WORKSHEET_BROWSER_EXECUTABLE || process.env.CHROME_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const failures = [], results = [];

async function setup({ items = [], mobile = false, mode = 'success', noAI = false } = {}) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 1050 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(({ items, mode, noAI }) => {
    window._fixtureItems = items;
    window._saved = null;
    window._saveCalls = 0;
    window._aiPrompts = [];
    window._aiMode = mode;
    window._open = () => WorksheetArtEditor.open(window._fixtureItems, {
      context: 'P5 Heat — comparing cooling rates',
      questions: [{ id: 'q1', title: 'Investigating hot water' }, { id: 'q2', title: 'Compare the temperatures after five minutes' }],
      onSave: async next => { window._saved = JSON.parse(JSON.stringify(next)); window._saveCalls++; },
      askAI: noAI ? undefined : async prompt => {
        window._aiPrompts.push(prompt);
        if (window._aiMode === 'failure') throw new Error('Service unavailable for this test.');
        if (window._aiMode === 'empty') return '';
        if (window._aiMode === 'deferred') return new Promise(resolve => { window._resolveAI = resolve; });
        return prompt.startsWith('Fix grammar') ? 'Compare both temperatures carefully.' : 'Compare the temperatures. What stayed the same?';
      }
    });
    document.querySelector('#open-editor').onclick = window._open;
  }, { items, mode, noAI });
  await page.locator('#open-editor').click();
  await page.locator('dialog[open]').waitFor();
  return { page, errors };
}
async function run(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS', name); }
  catch (error) { failures.push(name); results.push({ name, passed: false, error: error.message }); console.error('FAIL', name, error.stack); }
}
async function statusContains(page, text) {
  await page.waitForFunction(text => document.querySelector('.wa-status')?.textContent.includes(text), text);
}
async function imagesReady(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0));
}
const initialBubble = { id: 'tip-one', kind: 'character', character: 'orbit', pose: 'thinking', bubbleType: 'hint', size: 'medium', text: 'Use evidence.', beforeQuestionId: '' };

try {
  await run('science and Tutor choices, size, placement and saved reopening', async () => {
    const { page, errors } = await setup();
    try {
      await page.locator('[data-add="science"]').click();
      await page.locator('[data-add="character"]').click();
      const science = page.locator('.wa-card').nth(0), character = page.locator('.wa-card').nth(1);
      await science.locator('[data-pick="magnet"]').click();
      await science.locator('[data-field="size"]').selectOption('large');
      await science.locator('[data-field="beforeQuestionId"]').selectOption('q2');
      await character.locator('[data-pick="nova"]').click();
      await character.locator('[data-field="pose"]').selectOption('encourage');
      await character.locator('[data-field="bubbleType"]').selectOption('reminder');
      await character.locator('[data-field="text"]').fill('Include the units when you compare temperatures.');
      await imagesReady(page);
      assert.equal(await science.locator('.wa-preview svg').getAttribute('aria-label'), 'Magnet');
      assert.match(await character.locator('.wa-preview img').getAttribute('src'), /nova-encourage\.webp$/);
      assert.equal(await character.locator('.wa-speech-text').textContent(), 'Include the units when you compare temperatures.');
      await page.locator('dialog').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: path.join(output, 'editor-desktop.png'), fullPage: true });
      await page.locator('[data-save]').click();
      await page.waitForFunction(() => !document.querySelector('dialog'));
      const saved = await page.evaluate(() => window._saved);
      assert.equal(saved.length, 2);
      assert.equal(saved[0].artId, 'magnet');
      assert.equal(saved[0].size, 'large');
      assert.equal(saved[0].beforeQuestionId, 'q2');
      assert.equal(saved[1].character, 'nova');
      assert.equal(saved[1].pose, 'encourage');
      await page.evaluate(() => { window._fixtureItems = JSON.parse(JSON.stringify(window._saved)); });
      await page.locator('#open-editor').click();
      assert.equal(await science.locator('[data-field="beforeQuestionId"]').inputValue(), 'q2');
      assert.equal(await character.locator('[data-field="text"]').inputValue(), saved[1].text);
      assert.equal(await character.locator('[data-pick="nova"]').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await run('Fill in with AI and Improve grammar use their own prompts and keep text editable', async () => {
    const { page, errors } = await setup({ items: [{ ...initialBubble, text: '' }] });
    try {
      await page.locator('[data-ai="grammar"]').click();
      await statusContains(page, 'Type some text first');
      assert.equal(await page.evaluate(() => window._aiPrompts.length), 0);
      await page.locator('[data-ai="fill"]').click();
      await statusContains(page, 'Text updated');
      assert.equal(await page.locator('textarea').inputValue(), 'Compare the temperatures. What stayed the same?');
      await page.locator('textarea').fill('Compare both temperature careful.');
      await page.locator('[data-ai="grammar"]').click();
      await page.waitForFunction(() => document.querySelector('textarea').value === 'Compare both temperatures carefully.');
      const prompts = await page.evaluate(() => window._aiPrompts);
      assert.match(prompts[0], /P5 Heat/);
      assert.match(prompts[0], /without revealing the answer/);
      assert.match(prompts[1], /Preserve the exact meaning, science facts and keywords/);
      assert.match(prompts[1], /Compare both temperature careful\./);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await run('AI failure, empty output and unavailable connection preserve the teacher text', async () => {
    for (const mode of ['failure', 'empty', 'noAI']) {
      const { page, errors } = await setup({ items: [initialBubble], mode, noAI: mode === 'noAI' });
      try {
        await page.locator('[data-ai="fill"]').click();
        await statusContains(page, mode === 'noAI' ? 'type your own text' : 'AI could not update');
        assert.equal(await page.locator('textarea').inputValue(), initialBubble.text);
        assert.equal(await page.locator('[data-save]').isEnabled(), true);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  });

  await run('late AI output cannot overwrite typing, survive removal or apply after Cancel', async () => {
    for (const change of ['typing', 'remove', 'cancel']) {
      const { page, errors } = await setup({ items: [initialBubble], mode: 'deferred' });
      try {
        await page.locator('[data-ai="fill"]').click();
        await page.waitForFunction(() => typeof window._resolveAI === 'function');
        assert.equal(await page.locator('[data-save]').isDisabled(), true);
        assert.equal(await page.locator('[data-ai="grammar"]').isDisabled(), true);
        if (change === 'typing') await page.locator('textarea').fill('My newer instruction.');
        if (change === 'remove') await page.locator('[data-remove]').click();
        if (change === 'cancel') await page.locator('[data-cancel]').click();
        await page.evaluate(() => window._resolveAI('Outdated AI answer.'));
        if (change !== 'cancel') {
          await statusContains(page, 'Your edits were kept');
          assert.equal(await page.locator('[data-save]').isEnabled(), true);
          if (change === 'typing') assert.equal(await page.locator('textarea').inputValue(), 'My newer instruction.');
          else assert.equal(await page.locator('.wa-card').count(), 0);
        } else {
          await page.waitForFunction(() => !document.querySelector('dialog'));
          assert.equal(await page.evaluate(() => window._saveCalls), 0);
        }
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  });

  await run('Cancel leaves source data intact; reorder and remove commit only on Save', async () => {
    const items = [initialBubble, { id: 'leaf-two', kind: 'science', artId: 'leaf' }];
    const { page, errors } = await setup({ items });
    try {
      await page.locator('textarea').fill('An unsaved edit.');
      await page.locator('[data-cancel]').click();
      await page.waitForFunction(() => !document.querySelector('dialog'));
      assert.deepEqual(await page.evaluate(() => window._fixtureItems), items);
      assert.equal(await page.evaluate(() => window._saveCalls), 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'open-editor');
      await page.locator('#open-editor').click();
      await page.locator('.wa-card').nth(1).locator('[data-move="-1"]').click();
      assert.equal(await page.locator('.wa-card').first().locator('.wa-preview svg').getAttribute('aria-label'), 'Leaf');
      await page.locator('.wa-card').nth(1).locator('[data-remove]').click();
      await page.locator('[data-save]').click();
      await page.waitForFunction(() => window._saveCalls === 1);
      assert.deepEqual(await page.evaluate(() => window._saved.map(x => x.id)), ['leaf-two']);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await run('mobile dialog fits the viewport and long speech wraps', async () => {
    const { page, errors } = await setup({ mobile: true, items: [{ ...initialBubble, character: 'pip', size: 'large', text: 'Compare your observations. ' + 'science'.repeat(25) }] });
    try {
      await imagesReady(page);
      const widths = await page.locator('dialog').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, viewport: innerWidth }));
      await page.screenshot({ path: path.join(output, 'editor-mobile.png'), fullPage: true });
      assert.ok(widths.left >= 0 && widths.right <= widths.viewport, JSON.stringify(widths));
      const overflowing = await page.locator('dialog').evaluate(el => [...el.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > el.getBoundingClientRect().right).map(x => ({ tag: x.tagName, class: x.className, field: x.dataset.field, width: x.getBoundingClientRect().width })));
      assert.ok(widths.scroll <= widths.client + 1, 'Dialog must not scroll horizontally: ' + JSON.stringify({ ...widths, overflowing }));
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await run('print example retains colour, character dimensions and question placement under portal CSS', async () => {
    const { page, errors } = await setup();
    try {
      await page.locator('[data-cancel]').click();
      await page.evaluate(() => {
        const items = [
          { kind: 'science', artId: 'thermometer', size: 'small', beforeQuestionId: '' },
          { kind: 'character', character: 'orbit', pose: 'thinking', size: 'small', bubbleType: 'hint', text: 'What changed? What stayed the same?', beforeQuestionId: 'q1' },
          { kind: 'character', character: 'pip', pose: 'encourage', size: 'medium', bubbleType: 'reminder', text: 'Include the units in your measurements.', beforeQuestionId: 'q2' },
          { kind: 'character', character: 'nova', pose: 'welcome', size: 'large', bubbleType: 'tip', text: 'Use the results to support your claim.', beforeQuestionId: 'q2' }
        ];
        const output = document.querySelector('#printOutput');
        output.innerHTML = '<section class="print-question-page"><h1>Heat detectives</h1>' + WorksheetArtEditor.render(items, '') + '<div id="q1" class="print-text-block"><h2>1. Observe carefully</h2>' + WorksheetArtEditor.render(items, 'q1') + '<p>Describe one observation from the investigation.</p></div><div id="q2" class="print-text-block"><h2>2. Explain your evidence</h2>' + WorksheetArtEditor.render(items, 'q2') + '<p>Compare the results and explain what they show.</p></div></section>';
      });
      await imagesReady(page);
      await page.emulateMedia({ media: 'print' });
      assert.deepEqual(await page.locator('#printOutput .wa-character-image').evaluateAll(xs => xs.map(x => Math.round(x.getBoundingClientRect().width))), [80, 112, 152]);
      assert.equal(await page.locator('#q1 .wa-companion').count(), 1);
      assert.equal(await page.locator('#q2 .wa-companion').count(), 2);
      assert.equal(await page.locator('#printOutput .wa-science-svg').evaluate(x => getComputedStyle(x).printColorAdjust), 'exact');
      for (const block of await page.locator('.wa-companion').all()) {
        const box = await block.boundingBox();
        assert.ok(box.width > 0 && box.height > 0);
      }
      await page.screenshot({ path: path.join(output, 'print-example.png'), fullPage: true });
      await page.pdf({ path: path.join(output, 'print-example.pdf'), format: 'A4', printBackground: true });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
}
if (failures.length) { console.error(`${failures.length} worksheet art browser checks failed.`); process.exitCode = 1; }
else console.log(`All ${results.length} worksheet art browser checks passed. Screenshots: ${output}`);
