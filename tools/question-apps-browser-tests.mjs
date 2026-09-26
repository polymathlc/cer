import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const token = 'c33f87fa-93cb-4447-9b21-ed35f103ec3a';
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const target = path.join(root, pathname);
  if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
  response.end(fs.readFileSync(target));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
const page = await browser.newPage({viewport:{width:390,height:844}});
let responseBody = '', requests = [];
await page.route('https://firebasestorage.googleapis.com/**', async route => {
  requests.push(route.request().url());
  await route.fulfill({status:200, contentType:'application/json', body:responseBody});
});
const payload = html => JSON.stringify({version:1,title:'Grasshopper <lab>',html,height:560});
const digest = source => createHash('sha256').update(source).digest('hex');
const open = async (body, id = digest(body)) => {
  responseBody = body;
  requests = [];
  await page.goto(origin + '/question-app.html#id=' + id + '&token=' + token);
  // Fragments alone do not reload an already-open page.
  await page.reload();
};
try {
  const html = `<html><head><style>body{font-family:system-ui}button{padding:15px}</style></head><body><button id="change" onclick="this.textContent='Changed'">Try a control</button><p id="security">Checking…</p><script>
    let access='blocked';try{parent.document.title='Compromised';access='allowed'}catch(_){}
    document.getElementById('security').textContent=access;
    fetch('https://example.invalid/leak').then(()=>document.body.dataset.network='allowed').catch(()=>document.body.dataset.network='blocked');
    </script></body></html>`;
  await open(payload(html));
  await page.locator('#app-content iframe').waitFor();
  const frame = page.frameLocator('#app-content iframe');
  await frame.locator('#change').click();
  assert.equal(await frame.locator('#change').textContent(), 'Changed');
  assert.equal(await frame.locator('#security').textContent(), 'blocked');
  await frame.locator('body[data-network="blocked"]').waitFor();
  assert.equal(await page.title(), 'Grasshopper <lab> · Polymath');
  assert.equal(await page.locator('#app-title').textContent(), 'Grasshopper <lab>');
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  assert.ok(requests.length >= 1);
  assert.ok(requests.every(url => url.startsWith('https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/cer-images%2Fquestion-app-')));
  await open(payload('<p>Tampered</p>'), '0'.repeat(64));
  await page.locator('#app-status.error').waitFor();
  assert.match(await page.locator('#app-status').textContent(), /changed since/);
  assert.equal(await page.locator('iframe').count(), 0);
  await open('x'.repeat(600001));
  await page.locator('#app-status.error').waitFor();
  assert.match(await page.locator('#app-status').textContent(), /too large/);
  await open('not-json');
  await page.locator('#app-status.error').waitFor();
  assert.match(await page.locator('#app-status').textContent(), /could not be read/);
  requests = [];
  await page.goto(origin + '/question-app.html#id=../../private&token=' + token);
  await page.reload();
  await page.locator('#app-status.error').waitFor();
  assert.match(await page.locator('#app-status').textContent(), /incomplete/);
  assert.equal(requests.length, 0);
  if (process.env.QUESTION_APP_SAMPLE) {
    await open(payload(fs.readFileSync(process.env.QUESTION_APP_SAMPLE, 'utf8')));
    await page.locator('#app-content iframe').waitFor();
    const sample = page.frameLocator('#app-content iframe');
    await sample.locator('#mainStartButton').click();
    await sample.locator('#mainReadingsBody tr:not(.empty-row)').first().waitFor();
    await sample.locator('#mainResetButton').click();
    await sample.locator('label.switch:has(#mainSubstanceSwitch)').click();
    assert.equal(await sample.locator('#mainSubstanceSwitch').isChecked(), false);
    assert.equal(await sample.locator('#mainSubstanceLabel').textContent(), 'No substance M');
    await sample.locator('#compareStartButton').click();
    await sample.locator('#compareWithDrop').filter({hasText:/[1-9]/}).waitFor();
    assert.match(await sample.locator('#compareWithoutDrop').textContent(), /^0/);
    if (process.env.QUESTION_APP_SCREENSHOT) await page.screenshot({path:process.env.QUESTION_APP_SCREENSHOT});
    console.log('Attached grasshopper lab: simulation readings, reset, substance toggle and with/without comparison passed.');
  }
  await page.evaluate(async () => { await import('/vendor/qrcode-generator.js'); });
  assert.equal(await page.evaluate(() => typeof window.qrcode), 'function', 'QR generator also works through the production ES-module import');
  if (process.env.JSQR_SCRIPT) {
    await page.addScriptTag({path:process.env.JSQR_SCRIPT});
    const decoded = await page.evaluate(async ({id, token}) => {
      const apps = window.QuestionApps;
      const block = {html:'<p>Try this experiment</p>', title:'QR scan test', appUrl:apps.viewerUrl(id, token)};
      block.appSourceHash = apps.sourceHash(block);
      const host = document.createElement('div');
      host.innerHTML = apps.printBlock(block);
      document.body.appendChild(host);
      const svg = host.querySelector('svg');
      const image = new Image();
      image.src = 'data:image/svg+xml;base64,' + btoa(svg.outerHTML);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, 256, 256);
      const pixels = context.getImageData(0, 0, 256, 256);
      return {url:apps.viewerUrl(id, token), decoded:window.jsQR(pixels.data, pixels.width, pixels.height)?.data, printWidth:svg.getAttribute('width')};
    }, {id:'ab'.repeat(32), token});
    assert.equal(decoded.decoded, decoded.url);
    assert.equal(decoded.printWidth, '128');
    console.log('Worksheet QR: generated SVG rasterized at 2× and independently decoded back to the exact viewer link.');
  }
  console.log('Question app viewer: interactive controls, opaque sandbox, blocked network, scoped fetching, digest verification, oversized/malformed data and invalid links passed.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
