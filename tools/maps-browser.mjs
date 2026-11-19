// Mr Chung's Maps (/maps) — a real-browser check of the library page, with the sign-in
// replaced by tools/maps-fixtures/stub-services.js and the mapsLibrary function answered
// by a fake here, so it needs no account, no network and never reaches Stripe.
//   npm install --no-save playwright && npx playwright install chromium && node tools/maps-browser.mjs
// MAPS_SCREENSHOTS=<dir> saves screenshots.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tools', 'maps-fixtures');
const shots = process.env.MAPS_SCREENSHOTS || '';
const scale = Number(process.env.MAPS_SCALE || 1);
if (shots) fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const ENDPOINT = 'https://us-central1-mathgen--app.cloudfunctions.net/mapsLibrary';
const DAY = 86400000;
const NOW = Date.now();

// ---------------------------------------------------------------- sample library
const teasers = [
  { id: 'heat', title: 'Heat and temperature', publishedAtMs: NOW - 2 * DAY, topics: ['Heat flow', 'Conductors', 'Insulators', 'Expansion', 'Thermometers'], counts: { items: 14, topics: 8, notes: 3, questions: 2, pictures: 0, apps: 1 } },
  { id: 'plants', title: 'Plant transport system', publishedAtMs: NOW - 9 * DAY, topics: ['Roots', 'Xylem', 'Phloem', 'Leaves'], counts: { items: 11, topics: 7, notes: 2, questions: 2, pictures: 0, apps: 0 } },
  { id: 'fractions', title: 'Fractions: the big picture', publishedAtMs: NOW - 30 * DAY, topics: ['Equivalent', 'Adding', 'Of a set', 'Word problems'], counts: { items: 12, topics: 9, notes: 2, questions: 1, pictures: 0, apps: 0 } },
  { id: 'magnets', title: 'Magnets', publishedAtMs: NOW - 45 * DAY, topics: ['Poles', 'Magnetic materials', 'Making magnets'], counts: { items: 9, topics: 6, notes: 2, questions: 1, pictures: 0, apps: 0 } },
  { id: 'light', title: 'Light and shadows', publishedAtMs: NOW - 60 * DAY, topics: ['Sources', 'Reflection', 'Shadows', 'Transparent'], counts: { items: 10, topics: 7, notes: 1, questions: 2, pictures: 0, apps: 0 } },
  { id: 'cycles', title: 'Life cycles', publishedAtMs: NOW - 70 * DAY, topics: ['Butterfly', 'Mosquito', 'Frog', 'Chicken', 'Beetle'], counts: { items: 13, topics: 10, notes: 2, questions: 1, pictures: 0, apps: 0 } }
];
const heatMap = {
  id: 'heat', title: 'Heat and temperature', rootId: 'r', links: [{ id: 'l1', from: 'cond', to: 'ins', label: 'opposite' }], view: { x: 0, y: 0, zoom: 1 },
  nodes: [
    { id: 'r', type: 'topic', parentId: '', text: 'Heat', color: 'orange', shape: 'pill' },
    { id: 'flow', type: 'topic', parentId: 'r', text: 'Heat flow', color: 'blue', side: 'right' },
    { id: 'f1', type: 'note', parentId: 'flow', text: 'Remember', note: 'Heat always flows from a hotter place to a colder place, until both are at the same temperature.', color: 'blue' },
    { id: 'f2', type: 'topic', parentId: 'flow', text: 'Gain heat → temperature rises', color: 'blue' },
    { id: 'cond', type: 'topic', parentId: 'r', text: 'Good conductors', color: 'green', side: 'left' },
    { id: 'c1', type: 'topic', parentId: 'cond', text: 'Metals: steel, copper, aluminium', color: 'green' },
    { id: 'ins', type: 'topic', parentId: 'r', text: 'Poor conductors (insulators)', color: 'purple', side: 'left' },
    { id: 'i1', type: 'topic', parentId: 'ins', text: 'Wood, plastic, air, styrofoam', color: 'purple' },
    { id: 'exp', type: 'topic', parentId: 'r', text: 'Expansion', color: 'coral', side: 'right' },
    { id: 'q1', type: 'question', parentId: 'exp', color: 'white', question: { title: '', topic: 'Heat', level: 'P5', marks: '1', width: 340, snap: 2,
      blocks: [{ type: 'text', content: '<p>A metal lid is stuck on a glass jar. Which is the best way to open it?</p>' },
        { type: 'mcq', correctId: 'b', options: [{ id: 'a', text: 'Put the jar in the fridge' }, { id: 'b', text: 'Run hot water over the metal lid' }, { id: 'c', text: 'Run cold water over the lid' }, { id: 'd', text: 'Shake the jar' }] },
        { type: 'explanation', content: '<p>The metal lid gains heat and expands more than the glass, so it loosens.</p>' }] } },
    { id: 'app', type: 'code', parentId: 'flow', color: 'white', code: { title: 'Mix hot and cold water', width: 300, height: 170,
      html: '<p style="margin:0 0 8px">Hot water: <b id="t">80</b> °C</p><input type="range" min="20" max="100" value="80" oninput="t.textContent=this.value;m.textContent=Math.round((+this.value+20)/2)"><p>Mixed with 20 °C water: <b id="m">50</b> °C</p>' } }
  ]
};

function fakeService() {
  const state = { users: {}, calls: [] };
  const statusFor = uid => {
    const u = state.users[uid] || { access: 'none', subscription: null };
    return { ok: true, access: u.access, admin: !!u.admin, subscription: u.subscription || null, price: state.price };
  };
  state.price = { cents: 990, currency: 'sgd', label: 'S$9.90 / month' };
  async function handle(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization' } });
    const body = JSON.parse(req.postData() || '{}');
    const auth = req.headers().authorization || '';
    const uid = (/^Bearer token-(\w+)-/.exec(auth) || [])[1] || '';
    state.calls.push([body.action, uid]);
    const send = (status, json) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(json) });
    const u = state.users[uid] || (state.users[uid] = { access: 'none' });
    switch (body.action) {
      case 'catalogue': return send(200, { ok: true, maps: teasers, price: state.price });
      case 'status': return uid ? send(200, statusFor(uid)) : send(401, { ok: false, error: 'sign-in-required' });
      case 'subscribe':
        assert.equal(body.returnUrl, base + '/maps/');
        return send(200, { ok: true, url: base + '/maps/?subscribed=1&session=cs_test_a1b2c3d4e5' });
      case 'confirm':
        assert.equal(body.sessionId, 'cs_test_a1b2c3d4e5');
        Object.assign(u, { access: 'subscriber', subscription: { status: 'active', open: true, cancelAtPeriodEnd: false, currentPeriodEnd: NOW + 30 * DAY, amountCents: 990, currency: 'sgd' } });
        return send(200, statusFor(uid));
      case 'open':
        if (!['subscriber', 'student', 'staff'].includes(u.access)) return send(402, { ok: false, error: 'subscription-required' });
        return send(200, { ok: true, access: u.access, map: Object.assign({}, heatMap, { id: body.mapId, title: (teasers.find(t => t.id === body.mapId) || heatMap).title }) });
      case 'cancel': u.subscription = Object.assign({}, u.subscription, { cancelAtPeriodEnd: true }); return send(200, statusFor(uid));
      case 'resume': u.subscription = Object.assign({}, u.subscription, { cancelAtPeriodEnd: false }); return send(200, statusFor(uid));
      case 'manage': return send(503, { ok: false, error: 'portal-unavailable' });
      case 'admin':
        if (!u.admin) return send(403, { ok: false, error: 'admin-only' });
        return send(200, { ok: true, price: state.price, priceFromStripe: false, defaultPrice: state.price, limits: { minimumCents: 100, maximumCents: 20000 },
          subscribers: [
            { email: 'parent@example.com', name: 'Mrs Tan', status: 'active', open: true, cancelAtPeriodEnd: false, currentPeriodEnd: NOW + 20 * DAY, createdAt: NOW - 10 * DAY, amountCents: 990 },
            { email: 'lim.family@example.com', name: 'Mr Lim', status: 'active', open: true, cancelAtPeriodEnd: true, currentPeriodEnd: NOW + 5 * DAY, createdAt: NOW - 25 * DAY, amountCents: 990 },
            { email: 'wong@example.com', name: '', status: 'past_due', open: false, cancelAtPeriodEnd: false, currentPeriodEnd: NOW - DAY, createdAt: NOW - 40 * DAY, amountCents: 990 }
          ] });
      case 'admin-price':
        state.price = { cents: body.cents, currency: 'sgd', label: 'S$' + (body.cents / 100).toFixed(2) + ' / month' };
        return send(200, { ok: true, price: state.price, changed: true });
      default: return send(400, { ok: false, error: 'unknown-action' });
    }
  }
  return { state, handle };
}

async function open(browser, service, { phone = false, user = null, hash = '' } = {}) {
  const ctx = await browser.newContext(phone ? { ...devices['iPhone 13'] } : { viewport: { width: 1360, height: 860 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  if (user) await page.addInitScript(u => { if (!sessionStorage.getItem('stub-user')) sessionStorage.setItem('stub-user', JSON.stringify(u)); }, user);
  // Nothing else leaves the machine. (Registered first: Playwright tries the newest route first.)
  await page.route(/^https:\/\/(?!us-central1-mathgen--app)/, r => r.fulfill({ status: 404, body: '' }));
  await page.route('**/mindmap/mindmap-services.js*', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(fixtures, 'stub-services.js'), 'utf8') }));
  await page.route(ENDPOINT, r => service.handle(r));
  // The Polymath logo and Google's button picture: a tiny transparent PNG, no network.
  // The Polymath logo: the centre's own logo file when MAPS_REAL_LOGO is set (for screenshots), else a blank picture.
  const blank = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="44"><rect width="120" height="44" rx="10" fill="#FFF3E0"/></svg>';
  await page.route(/^https:\/\/(dl\.dropboxusercontent\.com|www\.gstatic\.com\/firebasejs\/ui)/, r =>
    process.env.MAPS_REAL_LOGO && r.request().url().includes('dropbox') ? r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, 'assets/branding/polymath-learning-centre.png')) }) : r.fulfill({ contentType: 'image/svg+xml', body: blank }));
  await page.goto(base + '/maps/' + hash);
  await page.waitForSelector('.map-card', { timeout: 15000 });
  return { page, errors, ctx };
}
const shot = async (page, name, full = false) => { if (shots) { await page.waitForTimeout(800); } if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: full }); };

const browser = await chromium.launch();
try {
  // ── An outsider: the catalogue is locked, Subscribe asks to sign in, Stripe, back, subscribed ──
  {
    const service = fakeService();
    const { page, errors, ctx } = await open(browser, service);
    assert.equal(await page.locator('.map-card').count(), teasers.length);
    assert.equal(await page.locator('.map-card .lock.is-open').count(), 0, 'every card is locked when signed out');
    assert.match(await page.textContent('#heroSubscribe'), /S\$9\.90/);
    await shot(page, 'landing-desktop');
    await shot(page, 'landing-desktop-full', true);
    await page.click('.map-card[data-map="heat"]');
    await page.waitForSelector('.modal');
    assert.match(await page.textContent('.modal'), /Subscribe for S\$9\.90 \/ month/);
    assert.match(await page.textContent('.modal'), /Heat flow/);
    await shot(page, 'paywall-desktop');
    await page.click('.modal [data-subscribe]');
    await page.waitForSelector('.modal [data-google]');
    await shot(page, 'sign-in-desktop');
    // Signing in carries on to the checkout by itself; the fake "Stripe" sends us straight back.
    await page.click('.modal [data-google]');
    await page.waitForURL(/\/maps\/(#.*)?$/, { timeout: 10000 });
    await page.waitForSelector('.account.is-open', { timeout: 8000 }).catch(async e => { console.log(service.state.calls, errors, page.url(), await page.textContent('#toasts')); throw e; });
    assert.deepEqual(service.state.calls.filter(c => c[0] !== 'catalogue').map(c => c[0]), ['status', 'subscribe', 'confirm']);
    assert.ok(!page.url().includes('session='), 'the checkout id is cleaned out of the address');
    assert.match(await page.textContent('#accountTitle'), /You are subscribed/);
    assert.equal(await page.locator('.map-card .lock.is-open').count(), teasers.length);
    await page.waitForTimeout(500);
    await shot(page, 'subscribed-desktop');

    // Open a map: nodes, branches, a question to answer and an app to use.
    await page.click('.map-card[data-map="heat"]');
    await page.waitForSelector('.viewer:not([hidden]) .mm-node.is-root');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.viewer .mm-node').count(), heatMap.nodes.length);
    assert.ok(await page.locator('.edges path.branch').count() >= heatMap.nodes.length - 1);
    await page.click('.mm-node.type-question [data-option-id="c"]');
    assert.match(await page.textContent('.mm-node.type-question'), /Not quite/);
    await page.click('.mm-node.type-question [data-act="q-reveal"]');
    assert.match(await page.textContent('.mm-node.type-question'), /expands more than the glass/);
    await page.click('.mm-node.type-code [data-act="code-use"]');
    assert.ok(await page.locator('.mm-node.type-code.is-live').count() === 1);
    const frame = page.frameLocator('.mm-node.type-code iframe');
    await frame.locator('input[type=range]').fill('100');
    assert.equal(await frame.locator('#m').textContent(), '60');
    await page.click('#zoomFit');
    await page.waitForTimeout(200);
    await shot(page, 'viewer-desktop');
    // Fold a branch, then everything.
    await page.click('#foldAll');
    assert.ok(await page.locator('.viewer .mm-node').count() < heatMap.nodes.length);
    await page.click('#foldAll');
    await page.click('#viewerClose');
    assert.ok(await page.locator('#viewer').isHidden());

    // Cancel at the end of the month, then keep it after all.
    await page.click('[data-act="cancel"]');
    await page.click('.modal [data-yes]');
    await page.waitForSelector('[data-act="resume"]');
    assert.match(await page.textContent('#accountTitle'), /ends on/);
    await shot(page, 'cancelled-desktop');
    await page.click('[data-act="resume"]');
    await page.waitForSelector('[data-act="cancel"]');
    // Update card without the Stripe portal set up: a clear message, no crash.
    await page.click('[data-act="manage"]');
    await page.waitForSelector('.toast.error');
    assert.match(await page.textContent('.toast.error'), /WhatsApp/);
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // ── A failed renewal pauses the library ──
  {
    const service = fakeService();
    service.state.users.outsider1 = { access: 'none', subscription: { status: 'past_due', open: false, cancelAtPeriodEnd: false, currentPeriodEnd: NOW - DAY, amountCents: 990 } };
    const { page, errors, ctx } = await open(browser, service, { user: { uid: 'outsider1', email: 'parent@example.com', displayName: 'Mrs Tan' } });
    await page.waitForSelector('.account.is-warn');
    assert.match(await page.textContent('#accountTitle'), /did not go through/);
    assert.equal(await page.locator('.map-card .lock.is-open').count(), 0);
    await shot(page, 'payment-failed-desktop');
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // ── An approved Polymath student: free, no Subscribe button ──
  {
    const service = fakeService();
    service.state.users.student1 = { access: 'student' };
    const { page, errors, ctx } = await open(browser, service, { user: { uid: 'student1', email: 'ally@students.sciencequest.app', displayName: 'ally' } });
    await page.waitForSelector('.account.is-open');
    assert.match(await page.textContent('#accountTitle'), /free/);
    assert.equal(await page.locator('[data-act="subscribe"]').count(), 0);
    assert.equal(await page.textContent('#heroSubscribe'), 'Open the library');
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // ── The admin: subscribers and the price ──
  {
    const service = fakeService();
    service.state.users.teacher = { access: 'staff', admin: true };
    const { page, errors, ctx } = await open(browser, service, { user: { uid: 'teacher', email: 'chungzhikai@gmail.com', displayName: 'Mr Chung' }, hash: '#admin' });
    await page.waitForSelector('.admin table tbody tr');
    assert.equal(await page.locator('.admin tbody tr').count(), 3);
    await page.fill('.admin input[name=price]', '12.90');
    await page.click('.admin [data-price] button[type=submit]');
    await page.waitForFunction(() => document.querySelector('#priceAmount').textContent === 'S$12.90');
    await page.locator('#adminSection').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'admin-desktop');
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // ── Phone: the landing page and a map ──
  {
    const service = fakeService();
    const { page, errors, ctx } = await open(browser, service, { phone: true });
    await shot(page, 'landing-phone');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, 'no sideways scrolling on a phone');
    await page.locator('#library').scrollIntoViewIfNeeded();
    await shot(page, 'library-phone');
    service.state.users.outsider1 = { access: 'subscriber', subscription: { status: 'active', open: true, cancelAtPeriodEnd: false, currentPeriodEnd: NOW + 12 * DAY, amountCents: 990 } };
    await page.click('#headerSignIn');
    await page.click('.modal [data-google]');
    await page.waitForSelector('.account.is-open');
    await page.click('.map-card[data-map="heat"]');
    await page.waitForSelector('.viewer:not([hidden]) .mm-node.is-root');
    await page.waitForTimeout(400);
    await shot(page, 'viewer-phone');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  console.log('maps-browser: all checks passed');
} finally {
  await browser.close();
  server.close();
}
