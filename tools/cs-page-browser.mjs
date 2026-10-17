// Browser check for polymathlc.com.sg/cs (cs/index.html).
//
// The REAL page runs in Chromium; Firebase is replaced by a tiny stub whose
// callables are answered, in this Node process, by the REAL service.js from
// cs-function/ over the in-memory fakes. So this exercises the whole loop —
// upload, booklet pages drawn by pdf.js, publish, unlock with consent, the
// streamed download, leads, hide/show — without touching the real project.
//
//   PW=/path/to/playwright/index.mjs PDFJS_DIR=/path/to/pdfjs-dist@3.11.174 \
//   PDFLIB=/path/to/pdf-lib JSQR=/path/to/jsqr node tools/cs-page-browser.mjs
//
// pdf.js 3.11.174 (the version the page loads from cdnjs) and pdf-lib are only
// needed for the PDF half; without them the PDF steps are skipped and said so.
// jsQR is only needed to scan the QR code off the finished 🖼 social picture —
// without it that one check is skipped and said so. The pictures themselves
// are saved to test-results/cs-page/ to be looked at.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'test-results', 'cs-page');
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const PDFJS_DIR = process.env.PDFJS_DIR || '';
const PDFLIB = process.env.PDFLIB || '';
const JSQR = process.env.JSQR || '';
const { chromium } = await import(pathToFileURL(PW).href);
const jsQR = JSQR ? await import(pathToFileURL(join(JSQR, 'dist/jsQR.js')).href).then(m => (m.default && m.default.default) || m.default) : null;
const { createService, COLLECTIONS } = await import(pathToFileURL(join(ROOT, 'cs-function/functions/service.js')).href);
const { FakeFirestore, FakeBucket } = await import(pathToFileURL(join(ROOT, 'cs-function/functions/test/fakes.js')).href);
const { leadIdFor, CONSENT_TEXT } = await import(pathToFileURL(join(ROOT, 'cs-function/functions/validate.js')).href);

await mkdir(OUT, { recursive: true });
const db = new FakeFirestore();
const bucket = new FakeBucket();
let PORT = 0;
const service = createService({ db, bucket, downloadUrl: 'http://127.0.0.1:__PORT__/__dl' });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = join(ROOT, decodeURIComponent(url.pathname).replace(/\/$/, '/index.html'));
  if (!path.startsWith(ROOT) || !existsSync(path)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
  res.end(await readFile(path));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
PORT = server.address().port;
const BASE = 'http://127.0.0.1:' + PORT;

// ── The Firebase stub the page gets instead of gstatic's SDK ──
const FIREBASE_STUB = `
(function(){
  if (window.firebase) return;
  var user = null, listeners = [];
  function fire(){ listeners.forEach(function(cb){ setTimeout(function(){ cb(user); }, 0); }); }
  var authObj = {
    get currentUser(){ return user; },
    onAuthStateChanged: function(cb){ listeners.push(cb); setTimeout(function(){ cb(user); }, 0); return function(){}; },
    signInWithPopup: function(){ user = window.__nextUser || { uid: 'admin-uid', email: 'chungzhikai@gmail.com', emailVerified: true }; fire(); return Promise.resolve({ user: user }); },
    signInWithRedirect: function(){ return authObj.signInWithPopup(); },
    getRedirectResult: function(){ return Promise.resolve({ user: null }); },
    signOut: function(){ user = null; fire(); return Promise.resolve(); }
  };
  function GoogleAuthProvider(){ this.setCustomParameters = function(){}; }
  function callable(name){
    return function(data){
      return fetch('/__fn/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: data || {}, auth: user ? { uid: user.uid, token: { email: user.email, email_verified: !!user.emailVerified } } : null }) })
        .then(function(r){ return r.json(); })
        .then(function(j){
          if (j.error) { var e = new Error(j.error.message); e.code = 'functions/' + j.error.status; e.details = j.error.details; throw e; }
          return { data: j.result };
        });
    };
  }
  function ref(path){
    return { put: function(file, meta){
      var handlers = null;
      var task = { on: function(evt, progress, error, complete){ handlers = { progress: progress, error: error, complete: complete };
        file.arrayBuffer().then(function(buf){
          progress && progress({ bytesTransferred: buf.byteLength / 2, totalBytes: buf.byteLength });
          return fetch('/__storage?path=' + encodeURIComponent(path) + '&type=' + encodeURIComponent((meta && meta.contentType) || ''), { method: 'POST', body: buf });
        }).then(function(r){
          if (window.__storageRefuses) { var e = new Error('denied'); e.code = 'storage/unauthorized'; throw e; }
          if (!r.ok) throw new Error('upload failed');
          progress && progress({ bytesTransferred: 1, totalBytes: 1 }); complete && complete();
        }).catch(function(e){ error && error(e); });
      } };
      return task;
    } };
  }
  var app = { functions: function(){ return { httpsCallable: callable }; } };
  window.firebase = {
    initializeApp: function(){ return app; },
    app: function(){ return app; },
    auth: Object.assign(function(){ return authObj; }, { GoogleAuthProvider: GoogleAuthProvider }),
    storage: function(){ return { ref: ref }; }
  };
})();`;

const fnRequests = [];
async function handleFn(name, body) {
  const auth = body.auth;
  fnRequests.push(name + (body.data && body.data.action ? ':' + body.data.action : ''));
  try {
    let result;
    if (name === 'csListFiles') result = await service.listFiles();
    else if (name === 'csUnlock') result = await service.unlock(body.data, { ip: '127.0.0.1', userAgent: 'harness' });
    else if (name === 'csAdmin') result = await service.admin(body.data, auth);
    else throw Object.assign(new Error('No such function'), { code: 'not-found' });
    return JSON.parse(JSON.stringify(result).replace(/__PORT__/g, String(PORT)));
  } catch (error) {
    const status = String(error.code || 'internal').toUpperCase().replace(/-/g, '_');
    return { __error: { message: error.message, status: String(error.code || 'internal'), details: error.details || null, upper: status } };
  }
}

const browser = await chromium.launch();
const consoleErrors = [];
async function newPage(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB }));
  await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 404, body: '' }));
  await page.route('https://us-central1-mathgen--app.cloudfunctions.net/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const body = JSON.parse(route.request().postData() || '{"data":{}}');
    const out = await handleFn(name, { data: body.data, auth: null });
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(out.__error ? { error: out.__error } : { result: out }) });
  });
  await page.route('**/__fn/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const out = await handleFn(name, JSON.parse(route.request().postData() || '{}'));
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(out.__error ? { error: out.__error } : { result: out }) });
  });
  await page.route('**/__storage**', async route => {
    const u = new URL(route.request().url());
    bucket.put(u.searchParams.get('path'), route.request().postDataBuffer() || Buffer.alloc(0), u.searchParams.get('type') || 'application/octet-stream');
    route.fulfill({ status: 200, body: 'ok' });
  });
  await page.route('**/__dl**', async route => {
    const key = new URL(route.request().url()).searchParams.get('k');
    try {
      const opened = await service.openDownload(key, { method: route.request().method() });
      const chunks = [];
      for await (const c of opened.object.createReadStream()) chunks.push(Buffer.from(c));
      route.fulfill({ status: 200, headers: { ...opened.headers, 'Access-Control-Allow-Origin': BASE }, body: Buffer.concat(chunks) });
    } catch (error) {
      route.fulfill({ status: (error.details && error.details.status) || 500, contentType: 'text/html', body: '<h1>' + error.message + '</h1>' });
    }
  });
  await page.route('https://firebasestorage.googleapis.com/**', route => {
    const u = new URL(route.request().url());
    const path = decodeURIComponent(u.pathname.split('/o/')[1] || '');
    const o = bucket.objects.get(path);
    if (!o) { route.fulfill({ status: 404, body: '' }); return; }
    route.fulfill({ status: 200, contentType: (o.metadata && o.metadata.contentType) || 'image/jpeg', body: o.bytes });
  });
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/**', async route => {
    const file = route.request().url().split('/').pop();
    if (!PDFJS_DIR) { route.fulfill({ status: 404, body: '' }); return; }
    route.fulfill({ contentType: 'text/javascript', body: await readFile(join(PDFJS_DIR, 'build', file)) });
  });
  await page.route('https://wa.me/**', route => route.fulfill({ status: 200, body: 'wa' }));
  return { context, page };
}

async function makePdf(pages) {
  const { PDFDocument, rgb, StandardFonts } = await import(pathToFileURL(join(PDFLIB, 'cjs/index.js')).href).then(m => m.default || m);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const colours = [rgb(1, 0.88, 0.7), rgb(0.78, 0.9, 0.79), rgb(0.73, 0.87, 0.98), rgb(0.82, 0.77, 0.91), rgb(1, 0.8, 0.82), rgb(1, 0.95, 0.6), rgb(0.9, 0.9, 0.9)];
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawRectangle({ x: 40, y: 600, width: 515, height: 200, color: colours[i % colours.length] });
    p.drawText('Heat cheat sheet', { x: 60, y: 740, size: 30, font, color: rgb(0.1, 0.1, 0.1) });
    p.drawText('Page ' + (i + 1), { x: 60, y: 690, size: 54, font, color: rgb(0.2, 0.2, 0.2) });
    for (let l = 0; l < 14; l++) p.drawRectangle({ x: 60, y: 540 - l * 34, width: 380 + (l % 3) * 40, height: 12, color: rgb(0.88, 0.88, 0.86) });
  }
  return Buffer.from(await doc.save());
}

const step = async (label, fn) => { process.stdout.write('• ' + label + ' … '); await fn(); console.log('ok'); };
const settle = ms => new Promise(r => setTimeout(r, ms));

/** Width and height out of a PNG's IHDR chunk. */
function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('latin1'), 'PNG', 'the saved file is a PNG');
  return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
}

/** Wait until the 🖼 social picture has its real pages and its words drawn. */
async function socialReady(page) {
  await page.waitForSelector('#socialOverlay:not([hidden])');
  await page.waitForFunction(() => {
    const c = document.getElementById('socialCanvas');
    return c && c.dataset.state === 'ready' && document.getElementById('socialBusy').hidden;
  }, null, { timeout: 40000 });
  await settle(250);
}

/** Every box the layout placed lies inside the picture, and the words never sit on the pages or the button. */
async function socialLayoutHolds(page) {
  const problems = await page.evaluate(() => {
    const p = Social.lastPlan();
    const out = [];
    const inside = (b, label) => { if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > p.w + 0.5 || b.y + b.h > p.h + 0.5) out.push(label + ' leaves the picture'); };
    const apart = (a, b, label) => { if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(label + ' overlap'); };
    inside(p.header, 'the header'); inside(p.block, 'the words'); inside(p.visual, 'the pages'); inside(p.cta, 'the button card');
    apart(p.block, p.cta, 'the words and the button card');
    apart(p.block, p.visual, 'the words and the pages');
    if (p.sticker) inside({ x: p.sticker.cx - p.sticker.r, y: p.sticker.cy - p.sticker.r, w: p.sticker.r * 2, h: p.sticker.r * 2 }, 'the sticker');
    return out;
  });
  assert.deepEqual(problems, []);
}

/** Read the QR code back off the finished picture, as a phone would. */
async function socialQrText(page) {
  const region = await page.evaluate(() => {
    const q = Social.lastPlan().cta.qr;
    if (!q) return null;
    const d = document.getElementById('socialCanvas').getContext('2d').getImageData(q.x, q.y, q.size, q.size);
    return { w: d.width, h: d.height, data: Array.from(d.data) };
  });
  if (!region) return null;
  const found = jsQR(Uint8ClampedArray.from(region.data), region.w, region.h);
  return found ? found.data : '';
}

try {
  // ── 1. An empty page reads as "coming soon", not as broken.
  let { page, context } = await newPage();
  await step('an empty page says new resources are coming', async () => {
    await page.goto(BASE + '/cs/');
    await page.waitForSelector('.empty-state');
    assert.match(await page.textContent('#showcaseTitle'), /on their way/);
    assert.equal(await page.isVisible('#versionBadge'), false, 'the version badge is for the admin only');
    assert.equal(await page.isVisible('#adminBar'), false);
  });

  // ── 2. The admin signs in and uploads a PDF; the booklet is drawn from its pages.
  await step('the admin signs in and sees the panel and the version', async () => {
    await page.click('#adminSignIn');
    await page.waitForSelector('#adminBar:not([hidden])');
    assert.match(await page.textContent('#versionBadge'), /^cs v\d+\.\d+\.\d+$/);
    await page.waitForSelector('#adminStats .stat');
  });

  const pdfReady = PDFJS_DIR && PDFLIB;
  if (pdfReady) {
    await step('uploading a 7-page PDF makes a downloadable file with a 6-page booklet', async () => {
      const pdf = await makePdf(7);
      await page.setInputFiles('#fileInput', { name: 'P6 Heat Cheat Sheet.pdf', mimeType: 'application/pdf', buffer: pdf });
      await page.waitForSelector('.upload-row .progress.done', { timeout: 30000 });
      const files = Object.values(db.dump(COLLECTIONS.files));
      assert.equal(files.length, 1);
      assert.equal(files[0].published, true);
      assert.equal(files[0].pageCount, 7);
      assert.deepEqual(files[0].previewPages, [1, 2, 3, 4, 5, 6]);
      assert.equal(files[0].title, 'P6 Heat Cheat Sheet');
      assert.ok([...bucket.objects.keys()].some(k => /^cs-files\/f[\w-]+\/P6 Heat Cheat Sheet\.pdf$/.test(k)));
      assert.equal([...bucket.objects.keys()].filter(k => k.startsWith('cs-previews/')).length, 6);
      await page.waitForSelector('.file-card');
      // 6 pages + a "more inside" page + the back cover = 8 faces = 4 leaves.
      await page.waitForFunction(() => document.querySelectorAll('#booklet .leaf').length === 4);
      const imgs = await page.$$eval('#booklet .face img', els => els.map(e => e.getAttribute('src')));
      assert.ok(imgs.filter(s => s.startsWith('https://firebasestorage.googleapis.com/')).length >= 6, 'the real pages are in the booklet');
      assert.match(await page.textContent('#booklet'), /\+ 1 more page in the download/);
    });

    await step('the booklet turns its pages by itself', async () => {
      await page.evaluate(() => document.getElementById('adminToggle').click());
      await page.locator('#showcase').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(OUT, 'desktop-closed.png') });
      await page.waitForFunction(() => document.querySelectorAll('#booklet .leaf.flipped').length >= 1, null, { timeout: 8000 });
      assert.equal(await page.getAttribute('#booklet', 'data-state'), 'open');
      await settle(1300);
      await page.locator('#showcase').screenshot({ path: join(OUT, 'desktop-open.png') });
      await page.click('#bookNext');
      await page.click('#bookNext');
      await page.click('#bookNext');
      await page.waitForFunction(() => document.getElementById('booklet').dataset.state === 'end', null, { timeout: 4000 });
      await settle(1300);
      await page.locator('#showcase').screenshot({ path: join(OUT, 'desktop-back-cover.png') });
      await page.click('#bookPlay');
      assert.equal(await page.getAttribute('#bookPlay', 'aria-label'), 'Play the page turning');
      await page.click('#bookPlay');
    });

    await step('redrawing the booklet from chosen pages fetches the stored file back', async () => {
      await page.evaluate(() => document.getElementById('adminToggle').click());
      const id = Object.keys(db.dump(COLLECTIONS.files))[0];
      await page.fill('#p-' + id, '2, 4-5');
      await page.click('.admin-file [data-act="redraw"]');
      await page.waitForFunction(fid => {
        const row = document.querySelector('.admin-file[data-id="' + fid + '"]');
        return row && /p\. 2, 4-5/.test(row.textContent);
      }, id, { timeout: 20000 });
      assert.deepEqual(db.dump(COLLECTIONS.files)[id].previewPages, [2, 4, 5]);
      assert.equal([...bucket.objects.keys()].filter(k => k.startsWith('cs-previews/')).length, 3, 'the old pages are removed');
    });

    await step('a clip of the booklet is recorded as a video', async () => {
      await page.click('.admin-file [data-act="clip"]');
      await page.waitForFunction(() => /Done/.test(document.getElementById('clipNotice').textContent), null, { timeout: 40000 });
      const src = await page.getAttribute('#clipVideo', 'src');
      assert.match(src, /^blob:/);
      assert.equal(await page.isVisible('#clipDownload'), true);
      await page.click('#clipOverlay [data-close]');
    });

    await step('🖼 a social post is drawn from the file\'s own pages and saved as a 1080 × 1080 PNG', async () => {
      const id = Object.keys(db.dump(COLLECTIONS.files))[0];
      await page.click('.admin-file[data-id="' + id + '"] [data-act="social"]');
      await socialReady(page);
      const info = await page.evaluate(() => {
        const c = document.getElementById('socialCanvas');
        let clean = true;
        try { c.toDataURL('image/png'); } catch (e) { clean = false; }
        const p = Social.lastPlan();
        return { w: c.width, h: c.height, clean, pages: p.pages.length, mode: p.mode, headline: document.getElementById('socialHeadline').value,
          caption: document.getElementById('socialCaption').value, pagesField: !document.getElementById('socialPagesField').hidden };
      });
      assert.deepEqual([info.w, info.h], [1080, 1080]);
      assert.equal(info.clean, true, 'the canvas is not tainted, so it can be saved');
      assert.equal(info.pages, 3, 'three of the booklet\'s pages are fanned out (pages 2, 4 and 5 were chosen)');
      assert.equal(info.mode, 'beside', 'a square puts the pages beside the words');
      assert.equal(info.headline, 'P6 Heat Cheat Sheet');
      assert.equal(info.pagesField, true);
      assert.match(info.caption, new RegExp('https://polymathlc\\.com\\.sg/cs/#file=' + id));
      await socialLayoutHolds(page);
      await page.screenshot({ path: join(OUT, 'social-dialog-desktop.png') });
      if (jsQR) assert.equal(await socialQrText(page), 'https://polymathlc.com.sg/cs/#file=' + id, 'the QR code opens this very resource');
      else console.log('(QR scan skipped: set JSQR) ', '');
      const [png] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#socialSave')]);
      assert.equal(png.suggestedFilename(), 'p6-heat-cheat-sheet-square.png');
      const bytes = await readFile(await png.path());
      assert.deepEqual(pngSize(bytes), { w: 1080, h: 1080 });
      await png.saveAs(join(OUT, 'social-square-sunrise.png'));
    });

    await step('🖼 the words, the size and the look change the picture, and stay as they were left', async () => {
      const id = Object.keys(db.dump(COLLECTIONS.files))[0];
      await page.fill('#socialHeadline', 'Everything about heat for the PSLE, on seven beautifully clear pages you can print tonight and keep for revision');
      await page.locator('#socialThemes label').filter({ hasText: 'Night' }).click();
      await page.locator('#socialFormats label').filter({ hasText: 'Story' }).click();
      await page.waitForFunction(() => document.getElementById('socialCanvas').height === 1920);
      await socialReady(page);
      await socialLayoutHolds(page);
      const story = await page.evaluate(() => {
        const p = Social.lastPlan();
        const head = p.block.items.find(i => i.type === 'headline');
        return { mode: p.mode, lines: head.lines.length, widest: Math.max(...head.widths), room: p.block.w,
          ctaBottom: p.cta.y + p.cta.h, headerTop: p.header.y };
      });
      assert.equal(story.mode, 'below', 'a story stacks the pages below the words');
      assert.ok(story.lines <= 4 && story.widest <= story.room + 1, 'a long title wraps inside its column');
      assert.ok(story.headerTop >= 210 && story.ctaBottom <= 1920 - 250, 'the story keeps clear of the bars drawn over it');
      if (jsQR) assert.equal(await socialQrText(page), 'https://polymathlc.com.sg/cs/#file=' + id, 'the QR code still scans on the dark look');
      const [png] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#socialSave')]);
      assert.deepEqual(pngSize(await readFile(await png.path())), { w: 1080, h: 1920 });
      await png.saveAs(join(OUT, 'social-story-night.png'));

      await page.locator('#socialFormats label').filter({ hasText: 'Portrait' }).click();
      await page.locator('#socialThemes label').filter({ hasText: 'Polymath teal' }).click();
      await page.fill('#socialHeadline', 'P6 Heat: the whole topic on seven pages');
      await page.waitForFunction(() => document.getElementById('socialCanvas').height === 1350);
      await socialReady(page);
      await socialLayoutHolds(page);
      const [portrait] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#socialSave')]);
      assert.deepEqual(pngSize(await readFile(await portrait.path())), { w: 1080, h: 1350 });
      await portrait.saveAs(join(OUT, 'social-portrait-teal.png'));

      // Closing and opening again brings back what was left, on this device.
      await page.click('#socialOverlay [data-close]');
      await page.click('.admin-file[data-id="' + id + '"] [data-act="social"]');
      await socialReady(page);
      assert.equal(await page.inputValue('#socialHeadline'), 'P6 Heat: the whole topic on seven pages');
      assert.equal(await page.isChecked('#socialFormats input[value="portrait"]'), true);
      // …and "put the words back" restores the file's own title.
      await page.click('#socialReset');
      await socialReady(page);
      assert.equal(await page.inputValue('#socialHeadline'), 'P6 Heat Cheat Sheet');
      await page.locator('#socialFormats label').filter({ hasText: 'Square' }).click();
      await page.locator('#socialThemes label').filter({ hasText: 'Berry' }).click();
      await page.selectOption('#socialLayout', 'below');
      await page.waitForFunction(() => document.getElementById('socialCanvas').height === 1080);
      await socialReady(page);
      await socialLayoutHolds(page);
      assert.equal(await page.evaluate(() => Social.lastPlan().mode), 'below');
      const [berry] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#socialSave')]);
      await berry.saveAs(join(OUT, 'social-square-berry-below.png'));
    });

    await step('🖼 "Save all three sizes" saves a square, a portrait and a story', async () => {
      const names = [];
      const sizes = [];
      const seen = new Promise(resolve => {
        const onDownload = async d => {
          names.push(d.suggestedFilename());
          sizes.push(pngSize(await readFile(await d.path())));
          if (names.length === 3) { page.off('download', onDownload); resolve(); }
        };
        page.on('download', onDownload);
      });
      await page.click('#socialSaveAll');
      await Promise.race([seen, settle(20000)]);
      assert.deepEqual(names, ['p6-heat-cheat-sheet-square.png', 'p6-heat-cheat-sheet-portrait.png', 'p6-heat-cheat-sheet-story.png']);
      assert.deepEqual(sizes, [{ w: 1080, h: 1080 }, { w: 1080, h: 1350 }, { w: 1080, h: 1920 }]);
      // "Copy picture" puts the PNG on the clipboard, ready to paste into WhatsApp Web or Facebook.
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
      await page.click('#socialCopy');
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.toast')).some(t => /Copied the picture|Could not copy/.test(t.textContent)), null, { timeout: 10000 });
      const pasted = await page.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        const blob = await item.getType('image/png');
        const bitmap = await createImageBitmap(blob);
        return { types: item.types, w: bitmap.width, h: bitmap.height };
      });
      assert.ok(pasted.types.includes('image/png'));
      assert.deepEqual([pasted.w, pasted.h], [1080, 1080]);
      await page.click('#socialOverlay [data-close]');
      assert.equal(await page.isVisible('#socialOverlay'), false);
    });
  } else {
    console.log('• (PDF steps skipped: set PDFJS_DIR and PDFLIB to run them)');
    await step('a non-PDF upload still becomes a downloadable file', async () => {
      await page.setInputFiles('#fileInput', { name: 'Notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK fake docx') });
      await page.waitForSelector('.upload-row .progress.done', { timeout: 15000 });
      await page.waitForSelector('.file-card');
    });
  }

  await step('when Storage refuses the browser, the upload goes through the server', async () => {
    await page.evaluate(() => { window.__storageRefuses = true; });
    await page.setInputFiles('#fileInput', { name: 'Light notes.txt', mimeType: 'text/plain', buffer: Buffer.from('light '.repeat(1000)) });
    // Finished rows fade away after a few seconds, so look for THIS row.
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.upload-row')).some(r =>
      /Light notes\.txt/.test(r.textContent) && r.querySelector('.progress.done')), null, { timeout: 15000 });
    const light = Object.values(db.dump(COLLECTIONS.files)).find(f => f.title === 'Light notes');
    assert.ok(light, 'the second file was created');
    assert.equal(bucket.objects.get(light.storagePath).bytes.toString(), 'light '.repeat(1000));
    assert.ok(fnRequests.includes('csAdmin:uploadChunk') && fnRequests.includes('csAdmin:uploadFinish'));
    await page.evaluate(() => { window.__storageRefuses = false; });
  });

  await step('🖼 a file with no pages to draw gets a made-up cover in its social post', async () => {
    const light = Object.entries(db.dump(COLLECTIONS.files)).find(([, f]) => f.title === 'Light notes')[0];
    await page.waitForSelector('.admin-file[data-id="' + light + '"]');
    await page.click('.admin-file[data-id="' + light + '"] [data-act="social"]');
    await socialReady(page);
    const info = await page.evaluate(() => ({ pages: Social.lastPlan().pages.length, pagesField: !document.getElementById('socialPagesField').hidden,
      notice: document.getElementById('socialNotice').textContent }));
    assert.equal(info.pages, 1);
    assert.equal(info.pagesField, false, 'there are no pages to choose from a text file');
    assert.equal(info.notice, '', 'a made-up cover is expected here, not an error');
    await socialLayoutHolds(page);
    await page.click('#socialOverlay [data-close]');
  });

  await step('🖼 one post for the whole page shows every downloadable file and links to the page', async () => {
    await page.click('#socialPageButton');
    await socialReady(page);
    const info = await page.evaluate(() => ({ pages: Social.lastPlan().pages.length, ticks: document.getElementById('socialTicks').value,
      headline: document.getElementById('socialHeadline').value, caption: document.getElementById('socialCaption').value }));
    const published = Object.values(db.dump(COLLECTIONS.files)).filter(f => f.published);
    assert.equal(info.pages, Math.min(4, published.length), 'one cover per downloadable file');
    for (const f of published) assert.ok(info.ticks.includes(f.title), f.title + ' is named on the post');
    assert.equal(info.headline, 'Free learning resources');
    assert.match(info.caption, /Download free: https:\/\/polymathlc\.com\.sg\/cs\/\n/);
    await socialLayoutHolds(page);
    if (jsQR) assert.equal(await socialQrText(page), 'https://polymathlc.com.sg/cs/', 'the QR code opens the page');
    const [png] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#socialSave')]);
    assert.deepEqual(pngSize(await readFile(await png.path())), { w: 1080, h: 1080 });
    await png.saveAs(join(OUT, 'social-whole-page.png'));
    await page.click('#socialOverlay [data-close]');
  });

  await step('the admin hides a file and it leaves the public list', async () => {
    const light = Object.entries(db.dump(COLLECTIONS.files)).find(([, f]) => f.title === 'Light notes')[0];
    await page.waitForSelector('.admin-file[data-id="' + light + '"]');
    await page.locator('.admin-file[data-id="' + light + '"] .toggle').click();
    await page.waitForFunction(fid => !document.querySelector('.file-card[data-id="' + fid + '"]'), light, { timeout: 8000 });
    assert.equal(db.dump(COLLECTIONS.files)[light].published, false);
  });

  await step('signing out hides every admin control', async () => {
    await page.click('#adminSignOut');
    await page.waitForSelector('#adminBar[hidden]', { state: 'attached' });
    assert.equal(await page.isVisible('#versionBadge'), false);
    assert.equal(await page.isVisible('#adminPanel'), false);
  });

  // ── 3. A parent unlocks the download.
  await step('the unlock form checks every field and requires the tick', async () => {
    await page.click('.file-card [data-unlock]');
    await page.waitForSelector('#unlockOverlay:not([hidden])');
    assert.equal(await page.isChecked('#inConsent'), false, 'the box is never ticked for anybody');
    await page.fill('#inName', 'Tan Wei Ming');
    await page.fill('#inEmail', 'mum@gmial.com');
    await page.locator('#inEmail').blur();
    await page.waitForSelector('#emailSuggest:not([hidden])');
    await page.click('#useSuggest');
    assert.equal(await page.inputValue('#inEmail'), 'mum@gmail.com');
    await page.fill('#inWhatsapp', '6123 4567');
    await page.click('#unlockSubmit');
    assert.match(await page.textContent('#err-whatsapp'), /landline/);
    assert.match(await page.textContent('#err-consent'), /tick the box/);
    assert.deepEqual(db.dump(COLLECTIONS.leads), {}, 'nothing is stored before the form is right');
    assert.equal(await page.textContent('#consentText'), CONSENT_TEXT, 'the server\'s own wording is shown');
  });

  await step('with the box ticked the download starts and ONE lead is recorded', async () => {
    await page.fill('#inWhatsapp', '9123 4567');
    await page.check('#inConsent');
    await settle(1300); // a real person takes longer than the bot guard
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#unlockSubmit')]);
    assert.match(download.suggestedFilename(), /\.pdf$|\.docx$/);
    await page.waitForSelector('#unlockDoneView:not([hidden])');
    const lead = db.dump(COLLECTIONS.leads)[leadIdFor('mum@gmail.com')];
    assert.ok(lead, 'the lead is stored');
    assert.equal(lead.whatsapp, '+6591234567');
    assert.equal(lead.consentActive, true);
    assert.equal(lead.consent.text, CONSENT_TEXT);
    await page.click('#unlockDoneView [data-close]');
    await page.waitForSelector('.file-card .chip.ok');
    assert.match(await page.textContent('.file-card [data-unlock]'), /Download again/);
  });

  await step('"Download again" reuses the unlocked link without a second form', async () => {
    const before = db.dump(COLLECTIONS.leads)[leadIdFor('mum@gmail.com')].unlockCount;
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('.file-card [data-unlock]')]);
    assert.ok(download);
    assert.equal(await page.isVisible('#unlockOverlay'), false);
    assert.equal(db.dump(COLLECTIONS.leads)[leadIdFor('mum@gmail.com')].unlockCount, before);
  });
  await context.close();

  // ── 4. The admin reads and exports the lead.
  ({ page, context } = await newPage());
  await step('the admin sees the person in Leads and can export them', async () => {
    await page.goto(BASE + '/cs/#admin');
    await page.waitForSelector('#adminBar:not([hidden])');
    await page.click('#tab-leads');
    await page.waitForSelector('#leadsBody tr[data-lead]');
    assert.match(await page.textContent('#leadsBody'), /Tan Wei Ming/);
    assert.match(await page.textContent('#leadsBody'), /\+65 9123 4567/);
    const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#leadsCsv')]);
    const text = (await readFile(await csv.path())).toString();
    assert.match(text, /"Tan Wei Ming","mum@gmail.com","\+6591234567","active","cs-marketing-v1"/);
    await page.click('#leadsBody [data-lead-act="history"]');
    await page.waitForSelector('#historyBody .consent-quote');
    assert.match(await page.textContent('#historyBody'), /Granted/);
    await page.click('#historyOverlay [data-close]');
    await page.screenshot({ path: join(OUT, 'admin-leads.png'), fullPage: false });
  });
  await context.close();

  // ── 4b. The social post dialog on a phone-sized screen.
  ({ page, context } = await newPage({ width: 390, height: 844 }));
  await step('🖼 the social post dialog fits a phone: preview above, words below, nothing sideways', async () => {
    await page.goto(BASE + '/cs/#admin');
    await page.waitForSelector('#adminBar:not([hidden])');
    await page.waitForSelector('.admin-file [data-act="social"]');
    await page.locator('.admin-file [data-act="social"]').first().click();
    await socialReady(page);
    const sizes = await page.evaluate(() => {
      const dialog = document.querySelector('#socialOverlay .dialog');
      const canvas = document.getElementById('socialCanvas').getBoundingClientRect();
      const form = document.getElementById('socialForm').getBoundingClientRect();
      return { over: dialog.scrollWidth - dialog.clientWidth, canvasW: canvas.width, below: form.top >= canvas.bottom - 1 };
    });
    assert.ok(sizes.over <= 1, 'the dialog scrolls sideways by ' + sizes.over + 'px');
    assert.ok(sizes.canvasW <= 390, 'the preview is ' + sizes.canvasW + 'px wide');
    assert.equal(sizes.below, true, 'on a phone the words come under the preview');
    await page.screenshot({ path: join(OUT, 'social-dialog-phone.png') });
  });
  await context.close();

  // ── 5. A phone.
  ({ page, context } = await newPage({ width: 360, height: 760 }));
  await step('at 360px nothing overflows sideways and the booklet fits', async () => {
    await page.goto(BASE + '/cs/');
    await page.waitForSelector('.file-card');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, 'horizontal overflow: ' + overflow + 'px');
    const box = await page.locator('#bookletStage').boundingBox();
    assert.ok(box.width <= 360, 'the booklet is ' + box.width + 'px wide');
    await settle(2600);
    await page.screenshot({ path: join(OUT, 'phone.png'), fullPage: true });
  });
  await context.close();

  assert.deepEqual(consoleErrors, [], 'no errors in the page');
  console.log('\nAll /cs browser checks passed. Screenshots in ' + OUT);
} catch (error) {
  console.error('\nFAILED:', error.message);
  if (consoleErrors.length) console.error('Page errors:', consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
