// The schedule page in a real browser: the 🗓 weekly timetable and the 📅
// 3-business-day trial notice, at desktop and phone widths.
//
// The SHIPPED schedule/index.html is served as it is. Firebase, the QR library
// and Google Fonts are replaced by small stand-ins, so the page renders a
// fixed published schedule and nothing leaves the machine: no booking, upload
// or email is ever sent. The clock is fixed to Thursday 8 October 2026, 10am
// in Singapore, so every date the page prints is known in advance.
//
//   node tools/schedule-timetable-browser.mjs
//   SCHEDULE_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/schedule-timetable-browser.mjs
//   SCHEDULE_SCREENSHOTS=artifacts/schedule node tools/schedule-timetable-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.SCHEDULE_PLAYWRIGHT_MODULE || process.env.PW || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const shots = process.env.SCHEDULE_SCREENSHOTS || '';
if (shots) fs.mkdirSync(shots, { recursive: true });

const NOW = '2026-10-08T10:00:00+08:00';            // Thursday
const NOW_UNLISTED = '2027-12-29T10:00:00+08:00';   // the 3 business days run into 2028

// Every kind of cell at least once: open, full, closed, Master Class, a note.
const CONFIG = {
  trialTitle: 'Book a Trial Class',
  trialDetails: 'Experience a full lesson with us.\n\nSmall groups, online or at our Clementi centre.',
  trialPrice: 30, trialPriceOnline: 25, monthlyFee: 240, monthlyFeeOnline: 200,
  masterTrialPrice: 45, masterMonthlyFee: 360, masterTitle: 'Master Class', masterDetails: 'Our premium programme.',
  slots: {
    'MON-1': { level: 'P5', subject: 'Science', mode: 'Both', status: 'open', type: 'regular' },
    'MON-2': { level: 'P6', subject: 'Math', mode: 'Physical', status: 'open', type: 'regular' },
    'TUE-3': { level: 'P4', subject: 'Science', mode: 'Online', status: 'full', type: 'regular' },
    'WED-2': { level: 'P5', subject: 'Math', mode: 'Both', status: 'open', type: 'regular', note: 'Bring a calculator' },
    'THU-1': { level: 'P3', subject: 'Science', mode: 'Both', status: 'closed', type: 'regular' },
    'FRI-3': { level: 'P6', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' },
    'SAT-1': { level: 'P5', subject: 'Science', mode: 'Physical', status: 'open', type: 'regular' },
    'SAT-2': { level: 'P3', subject: 'Math', mode: 'Both', status: 'open', type: 'regular' }
  }
};
const LIVE = ['MON-1', 'MON-2', 'TUE-3', 'WED-2', 'FRI-3', 'SAT-1', 'SAT-2'];

// firebase-app-compat.js stand-in: the four compat namespaces the page uses.
// Writes are recorded on window.__store instead of being sent anywhere.
const FIREBASE_STUB = `(function () {
  var fx = window.__SCHEDULE_FIXTURE__ || {};
  var store = window.__store = { bookings: [], mail: [], uploads: [] };
  function later(fn) { setTimeout(fn, 0); }
  function snap(data) { return { exists: !!data, data: function () { return data; } }; }
  function query() {
    var q = {
      orderBy: function () { return q; }, where: function () { return q; }, limit: function () { return q; },
      onSnapshot: function (cb) { later(function () { cb({ docs: [], forEach: function () {} }); }); return function () {}; },
      get: function () { return Promise.resolve({ docs: [], empty: true, forEach: function () {} }); }
    };
    return q;
  }
  function collection(name) {
    var q = query();
    q.doc = function (id) {
      var data = function () { return name === 'schedule_config' ? fx.config : null; };
      return {
        id: id || 'doc',
        onSnapshot: function (cb) { later(function () { cb(snap(data())); }); return function () {}; },
        get: function () { return Promise.resolve(snap(data())); },
        set: function () { return Promise.resolve(); },
        update: function () { return Promise.resolve(); },
        delete: function () { return Promise.resolve(); }
      };
    };
    q.add = function (doc) {
      var copy = JSON.parse(JSON.stringify(doc));
      if (name === 'mail') store.mail.push(copy);
      else if (name === 'schedule_bookings') store.bookings.push(copy);
      return Promise.resolve({ id: name + '-' + (store.mail.length + store.bookings.length) });
    };
    return q;
  }
  var user = fx.admin ? { email: 'chungzhikai@gmail.com', uid: 'admin', getIdToken: function () { return Promise.resolve('t'); } } : null;
  function firestore() { return { collection: collection }; }
  firestore.FieldValue = { serverTimestamp: function () { return '__server_time__'; }, increment: function (n) { return n; }, delete: function () { return null; } };
  function auth() {
    return {
      currentUser: user,
      onAuthStateChanged: function (cb) { later(function () { cb(user); }); return function () {}; },
      signInWithPopup: function () { return Promise.resolve({ user: user }); },
      signOut: function () { return Promise.resolve(); }
    };
  }
  auth.GoogleAuthProvider = function () {};
  function storage() {
    return { ref: function (p) { return {
      put: function () { store.uploads.push(p); return Promise.resolve(); },
      getDownloadURL: function () { return Promise.resolve('https://receipts.invalid/' + p); }
    }; } };
  }
  window.firebase = { initializeApp: function () {}, firestore: firestore, auth: auth, storage: storage, apps: [] };
})();`;

const QR_STUB = `window.QRCode = function (el, opts) {
  var c = document.createElement('canvas'); c.width = opts.width || 120; c.height = opts.height || 120; el.appendChild(c);
}; window.QRCode.CorrectLevel = { M: 0 };`;

// A 1×1 PNG, for the PayNow screenshot the booking form insists on.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n' + (e && e.stack || e)); process.exitCode = 1; }
}

async function openPage({ width = 1280, height = 900, mobile = false, admin = false, hash = '', now = NOW } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    if (u.hostname === 'www.gstatic.com' && u.pathname.endsWith('/firebase-app-compat.js')) {
      return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    }
    if (u.hostname === 'www.gstatic.com') return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.includes('qrcode')) {
      return route.fulfill({ contentType: 'text/javascript', body: QR_STUB });
    }
    if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(fixture => { window.__SCHEDULE_FIXTURE__ = fixture; }, { config: CONFIG, admin });
  await page.clock.setFixedTime(new Date(now));
  await page.goto(base + '/schedule/' + hash);
  await page.waitForFunction(() => {
    const grid = document.getElementById('schedule-grid');
    return grid && !grid.querySelector('.empty') && document.querySelector('#trial-notice b');
  });
  return { context, page, errors };
}

async function shot(page, name, opts = {}) {
  if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), ...opts });
}

// Nothing may push the page sideways, and the table must fit its card.
async function assertFits(page, label) {
  const m = await page.evaluate(() => {
    const table = document.querySelector('table.tt');
    const card = document.querySelector('.tt-card');
    const scroller = document.querySelector('.tt-scroll');
    const toggle = document.querySelector('.view-toggle');
    const clipped = [...document.querySelectorAll('.tt-class')]
      .filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.dataset.slot);
    const squeezedButtons = [...document.querySelectorAll('.view-toggle button')]
      .filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.id);
    const cardBox = card.getBoundingClientRect();
    return {
      page: document.documentElement.scrollWidth, viewport: window.innerWidth,
      tableRight: table.getBoundingClientRect().right, cardRight: cardBox.right,
      scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
      toggleRight: toggle.getBoundingClientRect().right, finderRight: document.querySelector('.finder').getBoundingClientRect().right,
      clipped, squeezedButtons
    };
  });
  assert.ok(m.page <= m.viewport, `${label}: the page scrolls sideways (${m.page}px wide in a ${m.viewport}px viewport).`);
  assert.ok(m.tableRight <= m.cardRight + 0.5, `${label}: the timetable runs out of its card.`);
  assert.ok(m.scrollerOverflow <= 0, `${label}: the timetable needs scrolling sideways (${m.scrollerOverflow}px).`);
  assert.ok(m.toggleRight <= m.finderRight + 0.5, `${label}: the view switch runs out of its card.`);
  assert.deepEqual(m.clipped, [], `${label}: a class block's content does not fit it.`);
  assert.deepEqual(m.squeezedButtons, [], `${label}: a view button's label does not fit it.`);
}

try {
  // ─── Desktop ───
  await check('desktop: the notice states the rule and the earliest trial date', async () => {
    const { context, page, errors } = await openPage();
    const text = await page.textContent('#trial-notice');
    assert.match(text, /Trial slots must be booked at least 3 business days in advance/);
    assert.match(text, /Monday to Friday, excluding public holidays/);
    assert.match(text, /earliest possible trial date is Tue 13 Oct\./, text);
    assert.equal(await page.getAttribute('#view-level', 'aria-pressed'), 'true', 'Parents still start on the level view.');
    assert.equal(await page.isVisible('#page-version'), false, 'The version is for the teacher only.');
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('desktop: the timetable lays every class out by day and time', async () => {
    const { context, page, errors } = await openPage();
    await page.click('#view-week');
    assert.equal(await page.getAttribute('#view-week', 'aria-pressed'), 'true');
    assert.deepEqual(await page.$$eval('.tt thead th .tt-dl', els => els.map(e => e.textContent)),
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    assert.deepEqual(await page.$$eval('.tt tbody th .tt-t1', els => els.map(e => e.textContent)),
      ['9:00am', '11:00am', '1:00pm', '3:00pm', '5:00pm', '7:00pm']);
    assert.deepEqual((await page.$$eval('.tt-class', els => els.map(e => e.dataset.slot))).sort(), [...LIVE].sort());
    assert.equal(await page.locator('.tt-blank').count(), 18 - LIVE.length, 'Every other lesson time shows an empty square.');
    assert.equal(await page.locator('td.tt-off').count(), 18, 'Six days × six times, minus the 18 real lesson times.');
    // Each block sits under its own day and beside its own time.
    const misplaced = await page.evaluate(() => [...document.querySelectorAll('.tt-class')].filter(btn => {
      const td = btn.closest('td'), tr = td.parentElement;
      const col = [...tr.children].indexOf(td);
      const day = document.querySelectorAll('.tt thead th')[col - 1].querySelector('.tt-dl').textContent;
      return slotLabel(btn.dataset.slot) !== day + ' ' + tr.querySelector('th').title;
    }).map(b => b.dataset.slot));
    assert.deepEqual(misplaced, []);
    assert.match(await page.textContent('.tt-class[data-slot="MON-1"]'), /P5.*Science.*Online & Physical/);
    assert.ok(await page.locator('.tt-class[data-slot="FRI-3"].master').count(), 'The Master Class is gold.');
    assert.match(await page.textContent('.tt-class[data-slot="TUE-3"]'), /Full/);
    assert.equal(await page.locator('.tt-class[data-slot="THU-1"]').count(), 0, 'A closed class is never shown.');
    assert.match(await page.textContent('.tt-sum'), /7 classes/);
    assert.match(await page.textContent('.tt-legend'), /Math.*Science.*Master Class.*Full.*No lessons/);
    await assertFits(page, 'desktop');
    await shot(page, 'timetable-desktop', { fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('desktop: a level chip fades every other class, and the count says so', async () => {
    const { context, page, errors } = await openPage();
    await page.click('#view-week');
    await page.click('.lv-chip:has-text("Primary 5")');
    assert.deepEqual((await page.$$eval('.tt-class:not(.dim)', els => els.map(e => e.dataset.slot))).sort(), ['MON-1', 'SAT-1', 'WED-2']);
    assert.equal(await page.locator('.tt-class.dim').count(), 4);
    assert.match(await page.textContent('.tt-sum'), /3 of 7 classes/);
    await page.selectOption('#f-subject', 'Math');
    assert.deepEqual(await page.$$eval('.tt-class:not(.dim)', els => els.map(e => e.dataset.slot)), ['WED-2']);
    await page.selectOption('#f-type', 'master');
    assert.equal(await page.locator('.tt-class:not(.dim)').count(), 0);
    assert.match(await page.textContent('.tt-sum'), /None of the 7 classes match your selection/);
    assert.match(await page.textContent('.tt-empty-note'), /No classes match your selection yet/);
    await shot(page, 'timetable-desktop-filtered', { fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('desktop: a class opens its details, Escape closes them and focus comes back', async () => {
    const { context, page, errors } = await openPage();
    await page.click('#view-week');
    await page.click('.tt-class[data-slot="MON-1"]');
    assert.ok(await page.isVisible('#tt-modal'));
    assert.match(await page.textContent('#tt-m-title'), /Primary 5 Science/);
    assert.match(await page.textContent('#tt-m-body'), /Monday\s*3:00pm – 4:45pm/);
    const note = await page.textContent('#tt-m-body .trial-note');
    assert.match(note, /Trial slots must be booked at least 3 business days in advance/);
    assert.match(note, /earliest possible trial for this Monday class is Mon 19 Oct\./, note);
    assert.match(await page.evaluate(() => document.activeElement.textContent), /^Book trial · from \$25\.00$/,
      'The keyboard lands on Book trial; the class runs online and physically, so the cheaper online price leads.');
    await shot(page, 'details-desktop');
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#tt-modal'), false);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.slot), 'MON-1', 'Focus returns to the class.');
    // Clicking the dimmed backdrop closes it too.
    await page.click('.tt-class[data-slot="SAT-1"]');
    assert.match(await page.textContent('#tt-m-body .trial-note'), /Saturday class is Sat 17 Oct\./);
    await page.mouse.click(8, 8);
    assert.equal(await page.isVisible('#tt-modal'), false);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('desktop: a full class and a Master Class say the right things', async () => {
    const { context, page, errors } = await openPage();
    await page.click('#view-week');
    await page.click('.tt-class[data-slot="TUE-3"]');
    assert.match(await page.textContent('#tt-m-body'), /This class is full/);
    assert.equal(await page.locator('#tt-m-body .tt-m-actions').count(), 0, 'A full class cannot be booked.');
    await page.click('#tt-m .close');
    await page.click('.tt-class[data-slot="FRI-3"]');
    assert.ok(await page.locator('#tt-m.master').count());
    assert.equal(await page.textContent('#tt-m-body .tt-m-actions .btn'), 'Book trial · $45.00');
    assert.match(await page.textContent('#tt-m-body'), /\$360\.00\s*\/ month/);
    assert.match(await page.textContent('#tt-m-body .trial-note'), /Friday class is Fri 16 Oct\./);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('desktop: booking a trial from the timetable — the form, the confirmation and both emails', async () => {
    const { context, page, errors } = await openPage();
    await page.click('#view-week');
    await page.click('.tt-class[data-slot="MON-1"]');
    await page.click('#tt-m-body .tt-m-actions .btn:not(.enrol)');
    assert.equal(await page.isVisible('#tt-modal'), false, 'The details make way for the booking form.');
    assert.ok(await page.isVisible('#booking-modal'));
    assert.equal(await page.textContent('#booking-title'), 'Book a trial class');
    assert.ok(await page.isVisible('#trial-note'));
    assert.match(await page.textContent('#trial-note'), /3 business days in advance.*Monday class is Mon 19 Oct\./);
    assert.equal(await page.isVisible('#enrol-note'), false);
    await shot(page, 'booking-desktop');
    await page.fill('#b-parent', 'Tan Mei Ling');
    await page.fill('#b-child', 'Ethan');
    await page.selectOption('#b-level', 'Primary 5');
    await page.fill('#b-email', 'parent@example.com');
    await page.fill('#b-wa', '9123 4567');
    await page.setInputFiles('#b-file', { name: 'paynow.png', mimeType: 'image/png', buffer: PNG });
    await page.click('#booking-submit');
    await page.waitForSelector('#booking-success:not(.hidden)');
    assert.match(await page.textContent('#booking-success-text'),
      /has been received\. .*As trial slots need 3 business days' notice, the earliest possible trial date is Monday 19 October\./);
    const store = await page.evaluate(() => window.__store);
    assert.equal(store.bookings.length, 1);
    assert.deepEqual(Object.keys(store.bookings[0]).sort(), [
      'childLevel2027', 'childName', 'classLevel', 'classType', 'createdAt', 'email', 'kind', 'mode', 'monthlyFee',
      'parentName', 'paymentRef', 'price', 'receiptFilename', 'receiptURL', 'slot', 'slotLabel', 'slotMode', 'status',
      'subject', 'whatsapp'
    ], 'The booking document keeps exactly the fields it always had.');
    assert.equal(store.bookings[0].kind, 'trial');
    assert.equal(store.mail.length, 2);
    const [centre, parent] = store.mail;
    assert.match(centre.message.html, /Earliest possible trial date<\/td><td[^>]*>Monday 19 October 2026 \(3 business days&#39; notice\)/);
    assert.match(parent.message.html, /<b>Your trial date:<\/b> Trial slots must be booked at least 3 business days in advance/);
    assert.match(parent.message.html, /earliest possible trial date for this class is Monday 19 October 2026\./);
    assert.match(parent.message.text, /Trial slots must be booked at least 3 business days in advance.*Monday 19 October 2026/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('desktop: enrolling skips the trial notice', async () => {
    const { context, page, errors } = await openPage();
    await page.click('#view-week');
    await page.click('.tt-class[data-slot="WED-2"]');
    assert.match(await page.textContent('#tt-m-body'), /Bring a calculator/);
    await page.click('#tt-m-body .btn.enrol');
    assert.equal(await page.textContent('#booking-title'), 'Enrol in this class');
    assert.equal(await page.isVisible('#trial-note'), false);
    assert.ok(await page.isVisible('#enrol-note'));
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('the choice of view is remembered, and #timetable opens it', async () => {
    const { context, page, errors } = await openPage({ hash: '#timetable' });
    assert.equal(await page.getAttribute('#view-week', 'aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => location.hash), '', 'The link tidies its own hash away.');
    await page.reload();
    await page.waitForSelector('table.tt');
    assert.equal(await page.getAttribute('#view-week', 'aria-pressed'), 'true');
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('the teacher previews the timetable and sees the page version', async () => {
    const { context, page, errors } = await openPage({ admin: true });
    assert.equal(await page.getAttribute('#view-day', 'aria-pressed'), 'true', 'The teacher still starts on the editing view.');
    assert.equal(await page.textContent('#page-version'), 'Schedule page v1.2.0');
    assert.ok(await page.isVisible('#page-version'));
    await page.click('#view-week');
    assert.match(await page.textContent('#schedule-grid'), /This is the weekly timetable parents see/);
    await page.click('.tt-class[data-slot="MON-1"]');
    assert.equal(await page.isDisabled('#tt-m-body .tt-m-actions .btn'), true, 'A preview, not a booking.');
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('beyond the holiday list the rule is stated with no date', async () => {
    const { context, page, errors } = await openPage({ now: NOW_UNLISTED, hash: '#timetable' });
    const text = await page.textContent('#trial-notice');
    assert.match(text, /Trial slots must be booked at least 3 business days in advance/);
    assert.doesNotMatch(text, /Booking today/, 'No date it cannot vouch for.');
    await page.click('.tt-class[data-slot="MON-1"]');
    const note = await page.textContent('#tt-m-body .trial-note');
    assert.match(note, /3 business days in advance/);
    assert.doesNotMatch(note, /earliest possible trial/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // ─── Phones ───
  for (const [w, h] of [[390, 844], [360, 740], [320, 640]]) {
    await check(`phone ${w}px: the whole week fits, and a tap opens a class`, async () => {
      const { context, page, errors } = await openPage({ width: w, height: h, mobile: true, hash: '#timetable' });
      assert.equal(await page.getAttribute('#view-week', 'aria-pressed'), 'true');
      assert.deepEqual(await page.$$eval('.tt thead th .tt-ds', els => els.map(e => e.textContent)),
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
      assert.equal(await page.isVisible('.tt-class[data-slot="MON-1"] .tt-sbn'), false, 'A phone shows the level and an icon.');
      await assertFits(page, `${w}px`);
      await page.locator('.tt-card').scrollIntoViewIfNeeded();
      await shot(page, `timetable-phone-${w}`, { fullPage: true });
      if (shots) await page.locator('.tt-card').screenshot({ path: path.join(shots, `timetable-card-${w}.png`) });
      await page.tap('.tt-class[data-slot="SAT-1"]');
      assert.ok(await page.isVisible('#tt-modal'));
      const box = await page.locator('#tt-m').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= w + 0.5, 'The details sheet fits the screen.');
      await shot(page, `details-phone-${w}`);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${passed} schedule timetable browser checks passed` + (process.exitCode ? ' — and some FAILED.' : '.'));
