// 📖 The embedded apps (Study Buddy, Ans Key, the Interactive textbook) end AT
// the bottom of the window, in a real browser, at every window size (v1.451.2).
//
// Before this, an embed page was "page header + a frame of min-height
// calc(100vh - 92px)". The header is 92px only on a wide window whose
// subtitle fits on one line; on a laptop, a phone, or the installed app pinned
// to the taskbar (a shorter window, the subtitle on two lines) the frame ran
// 30–150px below the bottom of the window. Study Buddy sizes itself to its
// frame, so the bottom of the worksheet, its toolbar and the buddy dock were
// simply cut off there — exactly what was reported after a 📖 export.
//
// The SHIPPED index.html is served from a local server; every request to
// another host (Firebase, fonts, CDNs) is refused, so the portal never signs in
// and the check shows the app shell itself, the way a signed-in user sees it.
//
//   node tools/embed-fit-browser-check.mjs
//   PW=/path/to/playwright/index.mjs node tools/embed-fit-browser-check.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.PW || process.env.PLAYWRIGHT_MODULE || 'playwright';
let chromium;
try {
  const mod = await import(PW.startsWith('.') || PW.startsWith('/') ? pathToFileURL(path.resolve(PW)).href : PW);
  chromium = mod.chromium || (mod.default && mod.default.chromium);
  if (!chromium) throw new Error('no chromium export in ' + PW);
} catch (e) {
  console.log('SKIP embed-fit-browser-check: Playwright not available (' + e.message + ')');
  process.exit(0);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, u.endsWith('/') ? u + 'index.html' : u);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

// Window sizes that matter: a wide desktop, a laptop, the installed taskbar
// app on a 1366×768 screen (no browser bar, the Windows taskbar below), a
// small window, a tablet and a phone.
const SIZES = [[1920, 1000], [1440, 760], [1366, 680], [1100, 560], [820, 1100], [390, 700]];
const PAGES = ['tutor', 'anskey', 'itextbook'];

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log('✓ ' + name);
  else { failed++; console.log('✗ ' + name + (detail ? ' — ' + detail : '')); }
};

const browser = await chromium.launch();
try {
  for (const [w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.route('**/*', r => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
    await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    for (const id of PAGES) {
      const m = await page.evaluate((id) => {
        // The app shell the way a signed-in user has it (the landing and sign-in
        // pages are what the portal shows before Firebase answers).
        for (const x of ['landingPage', 'loginPage', 'registerPage']) { const e = document.getElementById(x); if (e) e.style.display = 'none'; }
        document.querySelectorAll('[class*="preload"]').forEach(e => { e.style.display = 'none'; });
        const wrap = document.getElementById('appWrapper'); if (wrap) wrap.style.display = 'flex';
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const pg = document.getElementById('page-' + id);
        if (!pg) return null;
        pg.classList.add('active');
        window.scrollTo(0, 0);
        const f = document.getElementById('appEmbedFrame-' + id);
        const hd = pg.querySelector('.page-header').getBoundingClientRect();
        const fr = f.getBoundingClientRect();
        return { vh: window.innerHeight, headerBottom: hd.bottom, top: fr.top, bottom: fr.bottom, height: fr.height };
      }, id);
      const tag = `${id} at ${w}×${h}`;
      if (!m) { ok(tag + ': the page exists', false); continue; }
      ok(tag + ': the frame starts right under the header', Math.abs(m.top - m.headerBottom) <= 1, `frame top ${m.top}, header bottom ${m.headerBottom}`);
      ok(tag + ': the frame ends at the bottom of the window, not below it', Math.abs(m.bottom - m.vh) <= 1, `frame bottom ${Math.round(m.bottom)}, window ${m.vh}`);
      ok(tag + ': the frame has real room to work in', m.height >= 200, `frame ${Math.round(m.height)}px tall`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (failed) { console.log(`\n✗ ${failed} embed fit check(s) failed`); process.exit(1); }
console.log('\n✓ every embedded app fits the window at every size');
