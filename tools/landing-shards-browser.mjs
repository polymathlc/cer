// Logo shards on the public home page, in a real browser (landing-motion.js).
// Serves the repository locally, offline, and checks what a visitor would see:
// the strips are exactly the side gutters and sit above the section bands but
// under the header; marks build themselves; scrolling breaks them; every
// animation finishes and the loop then sleeps; narrow screens and reduced
// motion get nothing. Run after touching landing-motion.js or the landing layout:
//   PW=/path/to/playwright/index.mjs node tools/landing-shards-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });

async function open(width, height, reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());       // offline: only the local files
  await page.addInitScript(() => {                                           // count animation frames asked for
    const raf = window.requestAnimationFrame.bind(window);
    window.__frames = 0;
    window.requestAnimationFrame = cb => { window.__frames++; return raf(cb); };
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
  return { page, errors };
}
const look = page => page.evaluate(() => {
  const wrap = document.querySelector('#landingPage main .lp-wrap').getBoundingClientRect();
  return {
    content: [wrap.left, wrap.right], vw: document.documentElement.clientWidth,
    strips: [...document.querySelectorAll('#landingPage .lp-shards')].map(c => {
      const r = c.getBoundingClientRect(), cs = getComputedStyle(c);
      let painted = 0;
      if (cs.display !== 'none') {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i]) painted++;
      }
      return { side: c.classList.contains('lp-shards-l') ? 'l' : 'r', shown: cs.display !== 'none', left: r.left, right: r.right, z: cs.zIndex, events: cs.pointerEvents, painted };
    })
  };
});
async function asleep(page) {
  const before = await page.evaluate(() => window.__frames);
  await page.waitForTimeout(900);
  return (await page.evaluate(() => window.__frames)) === before;
}

try {
  for (const [width, height] of [[1440, 900], [1920, 1080], [1280, 800]]) {
    const { page, errors } = await open(width, height);
    await page.waitForTimeout(3300);
    const at = await look(page);
    assert.equal(at.strips.length, 2, `${width}: two strips`);
    for (const s of at.strips) {
      assert.ok(s.shown, `${width}: the ${s.side} strip shows`);
      assert.equal(s.z, '2'); assert.equal(s.events, 'none');
      const gutter = s.side === 'l' ? [0, Math.floor(at.content[0])] : [at.vw - Math.floor(at.vw - at.content[1]), at.vw];
      assert.deepEqual([s.left, s.right], gutter, `${width}: the ${s.side} strip is exactly the gutter`);
      assert.ok(s.painted > 0, `${width}: marks built themselves in the ${s.side} gutter`);
    }
    assert.ok(await asleep(page), `${width}: nothing animates once the marks are built`);
    const still = at.strips.map(s => s.painted).join();
    await page.evaluate(async () => {
      for (let i = 0; i < 90; i++) { window.scrollBy(0, 10); await new Promise(r => requestAnimationFrame(r)); }
    });
    await page.waitForTimeout(250);
    assert.notEqual((await look(page)).strips.map(s => s.painted).join(), still, `${width}: scrolling moves the marks`);
    await page.waitForTimeout(4300);
    assert.ok(await asleep(page), `${width}: every fall finishes and the loop sleeps again`);
    assert.deepEqual(errors, [], `${width}: no page errors`);
    await page.close();
    console.log(`ok ${width}x${height}: gutters ${Math.floor(at.content[0])}px, marks built, scroll breaks them, then idle`);
  }
  for (const [width, height] of [[1024, 768], [390, 844]]) {
    const { page, errors } = await open(width, height);
    await page.waitForTimeout(1200);
    assert.ok((await look(page)).strips.every(s => !s.shown), `${width}: no side margins, no marks`);
    assert.ok(await asleep(page), `${width}: no animation loop`);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`ok ${width}x${height}: no room in the margins, nothing shown`);
  }
  {
    const { page, errors } = await open(1440, 900, 'reduce');
    await page.waitForTimeout(1200);
    assert.equal((await look(page)).strips.length, 0, 'reduced motion: no strips at all');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('ok reduced motion: nothing inserted');
  }
} finally {
  await browser.close();
  server.close();
}
console.log('landing shards: real-browser checks passed');
