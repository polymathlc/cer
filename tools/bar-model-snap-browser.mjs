/* ✨ Hold-to-snap in the Bar Model Studio's pen, in a REAL browser: real mouse
   events, a real hold, the real stored element. The vm tests prove the logic;
   only this proves that a held stroke really becomes a clean shape on screen.
   Run: PW=/path/to/playwright/index.mjs node tools/bar-model-snap-browser.mjs
   (defaults to the playwright in this sandbox / on PATH). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { rng, make } from './shape-snap-fixtures.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));

const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());     // offline: only the local files
await page.goto(`${base}/bar-model.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.ShapeSnap === 'object' && typeof appState === 'object');
await page.evaluate(() => document.getElementById('drawingCanvas').scrollIntoView({ block: 'center' }));
await page.click('[data-tool="pen"]');
const measure = () => page.evaluate(() => { const r = document.getElementById('drawingCanvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
/* The page's layout drifts for a moment after load (fonts, async panels). Wait
   until the canvas has stopped moving, or the pen draws somewhere the test did not aim. */
async function settle(pg = page) {
  let prev = null, still = 0;
  for (let i = 0; i < 40 && still < 3; i++) {
    const r = await pg.evaluate(() => { const b = document.getElementById('drawingCanvas').getBoundingClientRect(); return Math.round(b.y * 10); });
    still = r === prev ? still + 1 : 0; prev = r;
    await pg.waitForTimeout(150);
  }
}
await settle();
let box = await measure();

/* Draw `pts` (canvas-relative CSS px) with the real mouse; optionally hold, then drag on. */
async function draw(pts, { hold = 0, then = [] } = {}) {
  box = await measure();
  const at = (p) => [box.x + p.x, box.y + p.y];
  await page.mouse.move(...at(pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...at(p), { steps: 1 });
  if (hold) await page.waitForTimeout(hold);
  for (const p of then) await page.mouse.move(...at(p), { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(40);
}
const last = () => page.evaluate(() => { const e = appState.elements[appState.elements.length - 1]; return e && { type: e.type, sharp: !!e.sharp, n: e.points && e.points.length, points: e.points }; });
const count = () => page.evaluate(() => appState.elements.length);
const place = (pts, dx, dy) => pts.map((p) => ({ x: p.x - Math.min(...pts.map((q) => q.x)) + dx, y: p.y - Math.min(...pts.map((q) => q.y)) + dy }));

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok   ' + name); };

await check('a held straight stroke becomes exactly one straight segment, kept sharp', async () => {
  await draw(place(make.line(rng(1), 260, 3), 80, 80), { hold: 800 });
  const e = await last();
  assert.equal(e.type, 'pen'); assert.equal(e.n, 2); assert.equal(e.sharp, true);
  assert.ok(Math.abs(e.points[0].y - e.points[1].y) < 0.05, 'a near-level line is made level');
});
await check('a held circle becomes a closed, smooth, round outline', async () => {
  await draw(place(make.circle(rng(2), 190), 420, 60), { hold: 800 });
  const e = await last();
  assert.equal(e.sharp, true); assert.ok(e.n >= 80, `points: ${e.n}`);
  const xs = e.points.map((p) => p.x), ys = e.points.map((p) => p.y);
  assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) - (Math.max(...ys) - Math.min(...ys))) < 3, 'round');
  assert.deepEqual(e.points[0], e.points[e.points.length - 1], 'closed');
});
await check('a held rectangle keeps square corners (no smoothing through midpoints)', async () => {
  await draw(place(make.rect(rng(3), 230, 130, 0), 80, 220), { hold: 800 });
  const e = await last();
  assert.equal(e.n, 5); assert.equal(e.sharp, true);
  const xs = [...new Set(e.points.map((p) => p.x))], ys = [...new Set(e.points.map((p) => p.y))];
  assert.equal(xs.length, 2); assert.equal(ys.length, 2);
  const d = await page.evaluate(() => document.querySelector('#drawingCanvas [data-type="pen"]:last-of-type path').getAttribute('d'));
  assert.ok(!/Q/.test(d), 'rendered with straight segments: ' + d);
});
await check('a held triangle is closed with three corners', async () => {
  await draw(place(make.regular(rng(4), 3, 190, 20), 420, 250), { hold: 800 });
  const e = await last(); assert.equal(e.n, 4); assert.equal(e.sharp, true);
});
await check('after the snap, dragging on adjusts the shape and lifting keeps it', async () => {
  const before = await count();
  const circle = place(make.circle(rng(5), 120), 700, 60);
  const cx = circle.reduce((a, p) => a + p.x, 0) / circle.length;
  await draw(circle, { hold: 800, then: [{ x: circle[circle.length - 1].x + 40, y: circle[circle.length - 1].y }, { x: circle[circle.length - 1].x + 70, y: circle[circle.length - 1].y }] });
  assert.equal(await count(), before + 1, 'one element, not two');
  const e = await last();
  const xs = e.points.map((p) => p.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 160, `the radius followed the pen: width ${(Math.max(...xs) - Math.min(...xs)).toFixed(0)}`);
});
await check('the same shapes drawn WITHOUT a hold stay freehand, untouched', async () => {
  await draw(place(make.circle(rng(6), 150), 80, 380), { hold: 0 });
  const e = await last();
  assert.equal(e.sharp, false); assert.ok(e.n > 10 && e.n < 900);
});
await check('a held zig-zag is not a shape, so it stays ink', async () => {
  await draw(place(make.zigzag(rng(7), 240), 420, 380), { hold: 800 });
  const e = await last(); assert.equal(e.sharp, false);
});
await check('undo takes a snapped stroke back as ONE step', async () => {
  const n = await count();
  await draw(place(make.line(rng(8), 200, 80), 700, 300), { hold: 800 });
  assert.equal(await count(), n + 1);
  await page.evaluate(() => { const b = document.querySelector('[data-action="undo"], #undoBtn, button[title*="ndo"]'); if (b) b.click(); });
  assert.equal(await count(), n, 'one undo removes the whole snapped stroke');
});
await check('without shape-snap.js the pen still draws (graceful degradation)', async () => {
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await p2.route(/shape-snap\.js/, (r) => r.abort());
  await p2.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await p2.goto(`${base}/bar-model.html`, { waitUntil: 'load' });
  await p2.evaluate(() => document.getElementById('drawingCanvas').scrollIntoView({ block: 'center' }));
  await p2.click('[data-tool="pen"]');
  await settle(p2);
  const b = await p2.evaluate(() => { const r = document.getElementById('drawingCanvas').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  const pts = place(make.line(rng(9), 200, 10), 100, 100);
  await p2.mouse.move(b.x + pts[0].x, b.y + pts[0].y); await p2.mouse.down();
  for (const q of pts.slice(1)) await p2.mouse.move(b.x + q.x, b.y + q.y);
  await p2.waitForTimeout(800); await p2.mouse.up();
  const e = await p2.evaluate(() => { const e = appState.elements[appState.elements.length - 1]; return e && { n: e.points.length, sharp: !!e.sharp }; });
  assert.ok(e && e.n > 5 && !e.sharp);
  await p2.close();
});

console.log(`\n${passed} browser checks passed`);
await browser.close();
server.close();
