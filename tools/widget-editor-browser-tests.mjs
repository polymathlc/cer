// Real app editor rendering, full portal CSS, and the shipped opaque iframe.
// No Firebase or paid AI calls. Optional WIDGET_SAMPLE_HTML exercises a local
// teacher-supplied HTML file without copying that file into the repository.
// Set WIDGET_PLAYWRIGHT_MODULE / WIDGET_BROWSER_EXECUTABLE when needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'test-results', 'widget-editor');
fs.mkdirSync(output, { recursive: true });
const moduleName = process.env.WIDGET_PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = [...index.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');
function cut(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, 'Find real editor code: ' + from);
  return source.slice(start, end);
}
assert.match(source, /window\.widgetPreview\s*=\s*widgetPreview\s*;/, 'Preview pasted app inline handler is exported from the app module');
const functions = [
  cut('const WIDGET_HTML_MAX =', 'const _widgetPublishing ='),
  cut('function widgetSetTokenLimit(', '// Public snapshots contain app content only.'),
  cut('function renderWidgetBlockEditor(', '// The question as it stands in the editor,'),
  cut('function saveBlockField(', '// Working-space "annotation area" toggle')
].join('\n');
const fixtureCode = `
  const AI_THINK_MIN = 'low';
  let blocks = [{id:'app-one',type:'widget',title:'Explore respiration',html:'',engine:'gemini',effort:'standard',height:560}];
  const currentUser = {uid:'fixture-author'};
  const _canAuthor = () => true;
  const escapeHtml = value => QuestionApps.escapeHtml(value);
  const showToast = (message,kind) => { window.fixtureToasts.push({message,kind}); };
  window.fixtureToasts = [];
  ${functions}
  function renderBlocks() { document.getElementById('blocksList').innerHTML = '<div class="block-card">' + renderWidgetBlockEditor(blocks[0]) + '</div>'; }
  window.fixtureBlock = () => JSON.parse(JSON.stringify(blocks[0]));
  window.fixtureReset = () => { blocks[0].html=''; delete blocks[0].maxTokens; renderBlocks(); };
  window.widgetSetTokenLimit = widgetSetTokenLimit;
  window.widgetPreview = widgetPreview;
  window.widgetSetHtml = widgetSetHtml;
  window.widgetImportHtml = widgetImportHtml;
  window.saveBlockField = saveBlockField;
  window.saveBlockNum = saveBlockNum;
  window.renderBlocks = renderBlocks;
  // These controls are rendered but paid generation and publication are tested
  // separately. Accidentally triggering either fails the browser test.
  window.widgetGenerate = window.widgetIterate = window.widgetPublish = () => { throw new Error('Unexpected external action'); };
  renderBlocks();
`;
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Question app editor test</title><style>${css}</style><script src="/vendor/qrcode-generator.js"></script><script src="/question-apps.js"></script></head><body><main class="page active" id="page-create"><div class="page-body" style="max-width:1100px;margin:auto"><h1 style="font-size:22px;margin-bottom:14px">Interactive app</h1><div id="blocksList"></div></div></main><script src="/fixture.js"></script></body></html>`;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fixture); return; }
  if (pathname === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); response.end(fixtureCode); return; }
  if (!['/question-apps.js', '/vendor/qrcode-generator.js'].includes(pathname)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
  response.end(fs.readFileSync(path.join(root, pathname.slice(1))));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const executablePath = process.env.WIDGET_BROWSER_EXECUTABLE || process.env.CHROME_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const results = [];

const syntheticHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font:16px system-ui;margin:0;padding:20px;color:#183753;background:#edf5fd;box-sizing:border-box}*{box-sizing:border-box}button{font:inherit;padding:12px 18px;min-height:44px}label{display:block;margin:16px 0}input{max-width:100%}#checks{font-size:13px;overflow-wrap:anywhere}
  </style></head><body><h1>Respiration lab</h1><p>Move the slider and compare the ink drop.</p><label>Oxygen used <input aria-label="Oxygen used" id="oxygen" type="range" min="0" max="10" value="0" oninput="document.getElementById('drop').textContent=this.value"></label><p>Drop moved: <output id="drop">0</output> mm</p><button id="reset" onclick="document.getElementById('oxygen').value=0;document.getElementById('drop').textContent='0'">Reset</button><p id="checks">Checking sandbox</p><script>
  const checks={};
  try{parent.document.title='Compromised';checks.parent='allowed';}catch(_){checks.parent='blocked';}
  try{localStorage.setItem('widget-leak','yes');checks.localStorage='allowed';}catch(_){checks.localStorage='blocked';}
  try{sessionStorage.setItem('widget-leak','yes');checks.sessionStorage='allowed';}catch(_){checks.sessionStorage='blocked';}
  fetch('https://example.invalid/widget-leak').then(()=>checks.network='allowed').catch(()=>checks.network='blocked').finally(()=>{document.getElementById('checks').textContent=JSON.stringify(checks);document.body.dataset.checked='true';});
  </script></body></html>`;

async function setup(mobile = false) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 1050 } });
  const errors = [], outbound = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    outbound.push(route.request().url());
    return route.abort();
  });
  await page.goto(origin);
  await page.getByLabel('App HTML code').waitFor();
  return { page, errors, outbound };
}
async function pasteAndPreview(page, html) {
  await page.getByLabel('App HTML code').fill(html);
  assert.equal(await page.evaluate(() => fixtureBlock().html), html);
  assert.match(await page.locator('[role="status"]').textContent(), /HTML updated/);
  await page.getByRole('button', { name: 'Preview pasted app', exact: true }).click();
  await page.locator('.question-app-frame').scrollIntoViewIfNeeded();
  await page.locator('.question-app-frame').waitFor();
  return page.frameLocator('.question-app-frame');
}
async function assertNoOverflow(page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth }));
  assert.ok(sizes.page <= sizes.width + 1, 'Editor must fit the viewport: ' + JSON.stringify(sizes));
}
async function run(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS', name); }
  catch (error) {
    // Playwright includes full fill() input in failure logs; never echo a
    // teacher's complete optional sample file to a test log.
    const message = String(error.message).split('Call log:')[0].trim();
    results.push({ name, passed: false, error: message }); console.error('FAIL', name, message);
  }
}

try {
  for (const mobile of [false, true]) {
    await run((mobile ? 'mobile' : 'desktop') + ': paste a complete app, interact and preserve the sandbox', async () => {
      const { page, errors, outbound } = await setup(mobile);
      try {
        assert.equal(await page.getByLabel('Maximum output tokens').inputValue(), '4096');
        const frame = await pasteAndPreview(page, syntheticHtml);
        await frame.locator('body[data-checked="true"]').waitFor();
        await frame.getByLabel('Oxygen used').fill('7');
        assert.equal(await frame.locator('#drop').textContent(), '7');
        await frame.getByRole('button', { name: 'Reset', exact: true }).click();
        assert.equal(await frame.locator('#drop').textContent(), '0');
        const checks = JSON.parse(await frame.locator('#checks').textContent());
        assert.deepEqual(checks, { parent: 'blocked', localStorage: 'blocked', sessionStorage: 'blocked', network: 'blocked' });
        assert.equal(await page.title(), 'Question app editor test');
        assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
        assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'), 'no-referrer');
        assert.equal(await page.evaluate(() => localStorage.getItem('widget-leak')), null);
        assert.deepEqual(outbound, [], 'CSP blocks external requests before they leave the frame');
        await assertNoOverflow(page);
        await page.screenshot({ path: path.join(output, mobile ? 'editor-mobile.png' : 'editor-desktop.png'), fullPage: true });
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  }
  await run('token field clamps at 1,024–32,000 and an empty value restores 4,096', async () => {
    const { page, errors } = await setup();
    try {
      const field = page.getByLabel('Maximum output tokens');
      for (const [input, expected] of [['1', 1024], ['999999', 32000], ['5000.9', 5000], ['', 4096]]) {
        await field.fill(input);
        await field.press('Tab');
        assert.equal(await field.inputValue(), String(expected));
        assert.equal(await page.evaluate(() => fixtureBlock().maxTokens), expected);
      }
      await page.evaluate(() => renderBlocks());
      assert.equal(await page.getByLabel('Maximum output tokens').inputValue(), '4096');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await run('HTML file import uses the same editable document and live preview', async () => {
    const { page, errors } = await setup();
    try {
      await page.locator('input[type="file"]').setInputFiles({ name: 'respiration.html', mimeType: 'text/html', buffer: Buffer.from(syntheticHtml) });
      await page.locator('.question-app-frame').scrollIntoViewIfNeeded();
      await page.frameLocator('.question-app-frame').getByRole('heading', { name: 'Respiration lab' }).waitFor();
      assert.equal(await page.evaluate(() => fixtureBlock().html), syntheticHtml);
      assert.match(await page.evaluate(() => fixtureToasts.at(-1).message), /HTML imported/);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  if (process.env.WIDGET_SAMPLE_HTML) {
    const sample = fs.readFileSync(process.env.WIDGET_SAMPLE_HTML, 'utf8');
    for (const mobile of [false, true]) {
      await run((mobile ? 'mobile' : 'desktop') + ': teacher sample imports and its simulator runs', async () => {
        const { page, errors, outbound } = await setup(mobile);
        try {
          await page.locator('input[type="file"]').setInputFiles({ name: 'teacher-sample.html', mimeType: 'text/html', buffer: Buffer.from(sample) });
          await page.locator('.question-app-frame').scrollIntoViewIfNeeded();
          const frame = page.frameLocator('.question-app-frame');
          await frame.locator('#mainStartButton').click();
          await frame.locator('#mainStartButton').filter({ hasText: 'Pause' }).waitFor();
          const liveFrame = await page.locator('.question-app-frame').elementHandle().then(handle => handle.contentFrame());
          await liveFrame.waitForFunction(() => Number(document.getElementById('mainOxygenTaken').textContent) > 0);
          await frame.locator('#mainResetButton').click();
          assert.match(await frame.locator('#mainStartButton').textContent(), /Start/);
          assert.equal(Number(await frame.locator('#mainOxygenTaken').textContent()), 0);
          await assertNoOverflow(page);
          await page.locator('.question-app-frame').screenshot({ path: path.join(output, mobile ? 'teacher-sample-mobile.png' : 'teacher-sample-desktop.png') });
          assert.deepEqual(outbound, []);
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
    }
  } else {
    console.log('SKIP teacher-supplied sample (set WIDGET_SAMPLE_HTML to a local HTML file)');
  }
} finally {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
if (results.some(result => !result.passed)) process.exitCode = 1;
