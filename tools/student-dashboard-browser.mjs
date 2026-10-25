// 🧭 My Polymath (student/, v1.2.0) and the site's 404 forwarder (404.html) — in a real Chromium,
// on a stand-in for GitHub Pages that answers BOTH domains the way they really answer:
//
//   https://polymathlc.com.sg/…        this repository (the website mirror), with GitHub Pages' rules:
//                                      a file; a folder → 301 to its slash; a bare /name → name.html;
//                                      otherwise 404.html with status 404.
//   https://polymathlc.github.io/<repo>/  the seven app repositories. Each front door is a stand-in page that
//                                      says which app it is; /cer/<missing> is cer's own Pages 404 (this
//                                      repo's 404.html again), which is how a forwarding loop would show.
//
// Nothing leaves the machine: every other host is cut off. Then it does what a student does:
//   1. taps every tile on the dashboard and checks the app that opens (the v1.1 tiles all hit GitHub's 404);
//   2. taps the 🔒 Worksheets tile and checks nothing opens and the reason is shown;
//   3. types every address on the printed sheet — with and without the trailing slash — and checks the app;
//   4. types the names a child would (/science, /psle, /maths, /studybuddy) and a deep link with a #hash;
//   5. opens /cer/student/ and lands on the one dashboard;
//   6. opens a page that does not exist: a friendly "not found" with a way back, nothing wider than a phone;
//   7. opens a missing page under polymathlc.github.io/cer/ and checks it STAYS (no loop);
//   8. opens math.html by its own name and checks it is still the Math Practice page;
//   9. stalls a forward and checks the page says where it is going, with a working button (not "not found").
//
//   PW=/path/to/playwright/index.mjs node tools/student-dashboard-browser.mjs
//   STUDENT_SCREENSHOTS=artifacts/student-apps/dashboard saves a picture of the dashboard and the 404 page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadPlaywright() {
  const candidates = [process.env.PW, 'playwright', '/opt/npm-tools/node_modules/playwright/index.mjs', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const candidate of candidates) {
    try { return await import(candidate); } catch (error) { /* try the next one */ }
  }
  throw new Error('Playwright not found — set PW=/path/to/playwright/index.mjs');
}
const { chromium } = await loadPlaywright();

const SITE = 'https://polymathlc.com.sg';
const APPS = 'https://polymathlc.github.io';
const APP_REPOS = { cer: 'Science', math: 'Math', anskey: 'Answer Keys', tutor: 'Study Buddy', rewards: 'Rewards', chinese: 'Chinese', english: 'English' };
// Deep pages inside an app that the checks open on purpose (anything else in an app repo is that repo's 404).
const APP_DEEP_PAGES = { cer: ['/polymath.html'] };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const GITHUB_404 = '<!DOCTYPE html><title>Page not found · GitHub Pages</title><h1>404</h1><p>File not found</p>';

function fileResponse(file, status = 200) {
  return { status, headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }, body: fs.readFileSync(file) };
}
function isFile(file) { return fs.existsSync(file) && fs.statSync(file).isFile(); }

// GitHub Pages' answer for one path of a site whose files are `siteRoot` (null → the app stand-ins).
function pagesAnswer(siteRoot, pathname, notFoundFile) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (error) { decoded = pathname; }
  const file = path.join(siteRoot, decoded);
  if (!file.startsWith(siteRoot)) return { status: 400, body: 'bad path' };
  if (decoded.endsWith('/')) {
    if (isFile(path.join(file, 'index.html'))) return fileResponse(path.join(file, 'index.html'));
  } else {
    if (isFile(file)) return fileResponse(file);
    if (isFile(path.join(file, 'index.html'))) return { status: 301, headers: { location: pathname + '/' }, body: '' };
    if (isFile(file + '.html')) return fileResponse(file + '.html');
  }
  return notFoundFile && isFile(notFoundFile)
    ? fileResponse(notFoundFile, 404)
    : { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' }, body: GITHUB_404 };
}

function appStandIn(repo, url) {
  const body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${APP_REPOS[repo]} (stand-in)</title></head>` +
    `<body data-app-repo="${repo}"><h1>${APP_REPOS[repo]}</h1><p>polymathlc/${repo} front door — ${url.pathname}</p></body></html>`;
  return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body };
}

// polymathlc.github.io: /<repo>/ is that app; /cer/<missing> is cer's own 404 (this repo's 404.html).
function appsAnswer(url) {
  const match = /^\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!match || !Object.prototype.hasOwnProperty.call(APP_REPOS, match[1])) return { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' }, body: GITHUB_404 };
  const repo = match[1];
  const rest = match[2] || '';
  if (!rest) return { status: 301, headers: { location: '/' + repo + '/' }, body: '' };
  if (rest === '/' || rest === '/index.html' || (APP_DEEP_PAGES[repo] || []).includes(rest)) return appStandIn(repo, url);
  if (repo === 'cer') return fileResponse(path.join(repoRoot, '404.html'), 404);
  return { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' }, body: GITHUB_404 };
}

const screenshots = process.env.STUDENT_SCREENSHOTS;
if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
const shot = async (page, name) => { if (screenshots) await page.screenshot({ path: path.join(screenshots, name + '.png'), fullPage: true, animations: 'disabled' }); };

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const PHONE = { viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// `override(url)` may answer a request itself (return an answer) instead of the stand-in Pages.
async function open(options = {}, override) {
  // Service workers are blocked: the kit's worker only ever passes page loads through, and this check is about
  // where those page loads GO. tools/pwa-install-browser.mjs checks the workers themselves.
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', ...options });
  const served = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    let answer = override ? override(url) : null;
    if (answer) { served.push({ url: url.href, status: answer.status }); return route.fulfill(answer); }
    if (/^(www\.)?polymathlc\.com\.sg$/.test(url.hostname)) answer = pagesAnswer(repoRoot, url.pathname, path.join(repoRoot, '404.html'));
    else if (url.hostname === 'polymathlc.github.io') answer = appsAnswer(url);
    else return route.abort();   // no internet: fonts, the Dropbox logo, Firebase — every page survives without them
    served.push({ url: url.href, status: answer.status });
    return route.fulfill(answer);
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error && error.message || error)));
  return { context, page, errors, served };
}

// The address a student ends up at after typing `address` (forwards and redirects followed).
async function typeAddress(page, address, expectUrl) {
  await page.goto(address, { waitUntil: 'commit' });
  if (expectUrl) await page.waitForURL(expectUrl, { timeout: 10000 });
  await page.waitForLoadState('domcontentloaded');
  return page.url();
}

let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };
const same = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };

// ─────────────────────────────────────────────────────────────── 1–2. The dashboard's tiles
{
  const { context, page, errors } = await open();
  await page.goto(SITE + '/student/');
  await page.waitForSelector('#tileGrid .app-tile');
  same(await page.textContent('#versionBadge'), 'v1.2.0', 'the dashboard is the new version');
  await shot(page, 'dashboard-computer');

  const tiles = await page.$$eval('#tileGrid .app-tile', links => links.map(link => ({
    app: link.dataset.app,
    name: link.querySelector('.tile-name').textContent,
    href: link.getAttribute('href'),
    locked: link.classList.contains('is-locked')
  })));
  same(tiles.length, 9, 'nine tiles');

  for (const tile of tiles.filter(tile => !tile.locked)) {
    const expectedRepo = new URL(tile.href).pathname.split('/')[1];
    await page.click(`.app-tile[data-app="${tile.app}"]`);
    await page.waitForURL(tile.href, { timeout: 10000 });
    same(page.url(), tile.href, tile.name + ' tile opens ' + tile.href);
    same(await page.getAttribute('body', 'data-app-repo'), expectedRepo, tile.name + ' tile opens the ' + APP_REPOS[expectedRepo] + ' app, not GitHub\'s 404');
    ok(!(await page.content()).includes('File not found'), tile.name + ': no "File not found"');
    await page.goBack();
    await page.waitForURL(SITE + '/student/');
  }

  // The tile just opened is remembered and marked, so returning is one tap.
  await page.reload();
  const lastBadge = await page.$eval('.app-tile[data-app="english"] .tile-badge', badge => !badge.hidden);
  ok(lastBadge, 'the last app opened wears "Last opened"');

  // 🔒 Worksheets: nothing to follow; it says why.
  const before = page.url();
  // force: Playwright will not click an aria-disabled element on its own, but a student's finger will.
  await page.click('.app-tile[data-app="online"]', { force: true });
  await page.waitForSelector('.locked-note');
  same(page.url(), before, 'the locked Worksheets tile opens nothing');
  ok(/Worksheets open soon/.test(await page.textContent('.locked-note')), 'and says why');

  same(errors.length, 0, 'no script errors on the dashboard: ' + errors.join(' | '));
  await context.close();
}

// The same tiles on a phone (the grid is two across there).
{
  const { context, page } = await open(PHONE);
  await page.goto(SITE + '/student/');
  await page.waitForSelector('#tileGrid .app-tile');
  await shot(page, 'dashboard-phone');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll on a phone');
  await page.tap('.app-tile[data-app="math"]');
  await page.waitForURL(APPS + '/math/');
  same(await page.getAttribute('body', 'data-app-repo'), 'math', 'tapping Math on a phone opens Math');
  await context.close();
}

// ─────────────────────────────────────────────────────────────── 3. Every address on the printed sheet
{
  const { context, page } = await open();
  await page.goto(SITE + '/student/');
  const sheet = await page.$$eval('#tileGrid .app-tile:not(.is-locked)', links => links.map(link => ({
    name: link.querySelector('.tile-name').textContent,
    href: link.getAttribute('href'),
    address: link.querySelector('.print-address').textContent
  })));
  for (const row of sheet) {
    const typed = 'https://' + row.address;
    same(await typeAddress(page, typed, row.href), row.href, 'typing ' + row.address + ' opens ' + row.name);
    if (!/[#?]/.test(row.address) && !row.address.endsWith('/')) {
      same(await typeAddress(page, typed + '/', row.href), row.href, 'typing ' + row.address + '/ opens ' + row.name + ' too');
    }
    if (!/[#?]/.test(row.address)) {
      same(await typeAddress(page, 'https://www.' + row.address, row.href), row.href, 'www.' + row.address + ' opens ' + row.name);
    }
  }
  await context.close();
}

// ─────────────────────────────────────────────────────────────── 4–5. Typed names, deep links, the second dashboard
{
  const { context, page } = await open();
  const cases = [
    [SITE + '/science', APPS + '/cer/'],
    [SITE + '/psle', APPS + '/cer/#psle'],
    [SITE + '/maths', APPS + '/math/'],
    [SITE + '/studybuddy', APPS + '/tutor/'],
    [SITE + '/Answers/', APPS + '/anskey/'],
    [SITE + '/MATH/', APPS + '/math/'],
    [SITE + '/cer/polymath.html#abc123/4', APPS + '/cer/polymath.html#abc123/4'],
    [SITE + '/tutor/?ws=7#q2', APPS + '/tutor/?ws=7#q2']
  ];
  for (const [typed, expected] of cases) same(await typeAddress(page, typed, expected), expected, typed + ' → ' + expected);

  same(await typeAddress(page, SITE + '/cer/student/', SITE + '/student/'), SITE + '/student/', '/cer/student/ steps over to the one dashboard');
  await page.waitForSelector('#tileGrid .app-tile');
  ok(true, 'and it is the dashboard');
  await context.close();
}

// ─────────────────────────────────────────────────────────────── 6. A page that does not exist
for (const [label, options] of [['computer', {}], ['phone', PHONE]]) {
  const { context, page, errors, served } = await open(options);
  const response = await page.goto(SITE + '/no-such-page/here');
  same(response.status(), 404, 'a missing page is still a 404 to the browser (' + label + ')');
  await page.waitForTimeout(400);
  same(page.url(), SITE + '/no-such-page/here', 'and it stays put (' + label + ')');
  ok(await page.isVisible('text=We couldn\'t find that page'), 'it says so in plain words (' + label + ')');
  ok(!(await page.isVisible('.forwarding')), 'the "Opening…" card is not shown (' + label + ')');
  same(await page.textContent('#missingAddress'), 'polymathlc.com.sg/no-such-page/here', 'it shows the address that was asked for (' + label + ')');
  ok(await page.evaluate(() => {
    const mark = document.querySelector('.mark');
    return mark.complete && mark.naturalWidth > 0;
  }), 'the Polymath mark shows with no other file fetched (' + label + ')');
  same(served.length, 1, 'the page needs nothing but itself (' + label + '): ' + served.map(row => row.url).join(', '));
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'nothing wider than the screen (' + label + ')');
  await shot(page, 'not-found-' + label);
  await page.click('text=My Polymath — all your apps');
  await page.waitForURL(SITE + '/student/');
  ok(true, 'the way back opens the dashboard (' + label + ')');
  same(errors.length, 0, 'no script errors on the 404 page (' + label + '): ' + errors.join(' | '));
  await context.close();
}

// The address is only ever text: markup in it is shown, never run.
{
  const { context, page } = await open();
  await page.goto(SITE + '/%3Cimg%20src=x%20onerror=window.__pwned=1%3E');
  await page.waitForTimeout(300);
  same(await page.evaluate(() => window.__pwned), undefined, 'markup in the address never runs');
  same(await page.$$eval('main img', images => images.length), 1, 'and never becomes a picture');
  await context.close();
}

// ─────────────────────────────────────────────────────────────── 7. No loop on polymathlc.github.io
{
  const { context, page, served } = await open();
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations += 1; });
  const response = await page.goto(APPS + '/cer/no-such-page');
  same(response.status(), 404, 'github.io/cer/<missing> is cer\'s own 404');
  await page.waitForTimeout(800);
  same(page.url(), APPS + '/cer/no-such-page', 'and it stays there');
  same(navigations, 1, 'exactly one page load — no bouncing');
  same(served.length, 1, 'one request, not a loop');
  ok(await page.isVisible('text=We couldn\'t find that page'), 'with the friendly page');
  await context.close();
}

// ─────────────────────────────────────────────────────────────── 8. math.html by its own name
{
  const { context, page } = await open();
  await page.goto(SITE + '/math.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  same(page.url(), SITE + '/math.html', 'math.html opened by name stays');
  same(await page.title(), 'Math Practice — Polymath Learning Centre', 'and it is still the Math Practice page');
  await context.close();
}

// ─────────────────────────────────────────────────────────────── 9. A forward that does not get through
// The app's server answers 204 No Content: the browser makes the request (so the page DID send the student on)
// but stays where it is — exactly what a student on a stalled school connection is left looking at. They must
// see where they were going and a button that gets them there, never "page not found".
{
  let appAnswers = false;
  const { context, page, served } = await open({}, url => (url.hostname === 'polymathlc.github.io' && !appAnswers ? { status: 204, body: '' } : null));
  // The forward starts at DOMContentLoaded, so Playwright never sees this page's own load events: wait on the request.
  await page.goto(SITE + '/anskey/', { waitUntil: 'commit' });
  for (let tries = 0; tries < 50 && !served.some(row => row.status === 204); tries += 1) await page.waitForTimeout(100);
  await page.waitForTimeout(200);
  ok(served.some(row => row.url === APPS + '/anskey/' && row.status === 204), 'the page sent the student on to Answer Keys by itself');
  same(page.url(), SITE + '/anskey/', 'the stalled forward leaves the student on this page…');
  ok(await page.isVisible('.forwarding'), '…looking at the "Opening…" card');
  same(await page.textContent('#forwardName'), 'Answer Keys', 'which names the app it is opening');
  same(await page.getAttribute('#forwardLink', 'href'), APPS + '/anskey/', 'with a button to the same place');
  ok(!(await page.isVisible('.not-found')), 'and no "not found" message');
  ok(!(await page.isVisible('text=We couldn\'t find that page')), 'anywhere');
  await shot(page, 'forwarding');
  appAnswers = true;
  await page.click('#forwardLink');
  await page.waitForURL(APPS + '/anskey/');
  same(await page.getAttribute('body', 'data-app-repo'), 'anskey', 'the button opens the app once it answers');
  await context.close();
}

await browser.close();
console.log(`✓ My Polymath tiles and the 404 forwarder: ${checks} checks passed in Chromium`);
