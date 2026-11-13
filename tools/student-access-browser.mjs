// 🔐 Student access approval, in a real Chromium, on stand-ins for GitHub Pages, Firebase Auth and Firestore.
//
//   https://polymathlc.com.sg/student/…       this repository's student/ folder (the dashboard, the gate)
//   https://polymathlc.github.io/cer/…        this repository (Science, Worksheets …)
//   https://polymathlc.github.io/<app>/       a stand-in app page that signs in like that app does:
//                                              "compat" (window.firebase, like Answer Keys / Study Buddy / Rewards)
//                                              or "modular" (11.10.0 ES modules, like Math / English / Chinese)
//   https://www.gstatic.com/firebasejs/…      a fake Firebase SDK: auth from localStorage, Firestore from the
//                                              stand-in below (so the admin dashboard sees what the gate wrote)
//   https://firestore.googleapis.com/…        a stand-in Firestore REST API that applies the SAME permissions as
//                                              tools/student-access-rules.mjs (own record only; only "pending";
//                                              admins approve) — or, before the rules are "published", the open catch-all
//
// Then it does what a family and the centre do:
//   1. before the rules are published, a signed-in student sees NO pop-up (nothing collected, nothing blocked);
//   2. after: a new student in a compat app gets the pop-up; an empty form names every missing answer;
//      two children are filled in → "Waiting for approval"; the record and the centre's email are written;
//   3. taking the pop-up out of the page puts it straight back;
//   4. the same account in a MODULAR app (polymathlc.github.io/math/) is blocked too, with the same screen;
//   5. a staff account and a signed-out visitor see no pop-up;
//   6. an admin opens polymathlc.com.sg/student/#admin, sees the request, approves it;
//   7. the waiting student's app unlocks by itself; the approval is remembered on the device;
//   8. the admin pauses access → the student is blocked again and may update the details and ask again.
//
//   PW=/path/to/playwright/index.mjs node tools/student-access-browser.mjs
//   ACCESS_SCREENSHOTS=artifacts/student-access saves pictures of the pop-up and the admin dashboard.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.ACCESS_SCREENSHOTS || '';
if (shots) fs.mkdirSync(shots, { recursive: true });

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
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/mathgen--app/databases/(default)/documents';
const ADMINS = ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

/* ───────────── the stand-in database (shared by REST and the fake SDK) ───────────── */
const db = { studentAccess: new Map(), mail: new Map(), protectedRules: false };
const USERS = {
  student: { uid: 'stu1', email: 'tan.kid@gmail.com', emailVerified: true, displayName: 'Tan Kid' },
  staff: { uid: 'staff1', email: 'elsielcr@gmail.com', emailVerified: true, displayName: 'Elsie' },
  admin: { uid: 'adm1', email: 'chungzhikai@gmail.com', emailVerified: true, displayName: 'Zhi Kai' }
};
const byUid = Object.fromEntries(Object.values(USERS).map(u => [u.uid, u]));

function decode(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
  throw new Error('value ' + JSON.stringify(v));
}
function encode(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, encode(v)])) } };
}
const FORM_FIELDS = ['uid', 'email', 'status', 'enrolled', 'parentName', 'parentEmail', 'childCount', 'children', 'submittedAt', 'app', 'submissions'];
function isOwnForm(uid, data) {
  const keys = Object.keys(data).sort();
  return keys.join() === [...FORM_FIELDS].sort().join() && data.uid === uid && data.status === 'pending' && data.enrolled === true
    && data.parentName.length >= 2 && /^[^@ ]+@[^@ ]+[.][^@ ]+$/.test(data.parentEmail)
    && data.childCount >= 1 && data.childCount <= 8 && data.children.length === data.childCount;
}
const json = (status, body) => ({ status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

function firestoreAnswer(request) {
  const url = new URL(request.url());
  const method = request.method();
  if (method === 'OPTIONS') return { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH' } };
  const rest = decodeURIComponent(url.pathname.slice('/v1/projects/mathgen--app/databases/(default)/documents/'.length));
  const auth = (request.headers().authorization || '').replace(/^Bearer tok-/, '');
  const who = byUid[auth] || null;
  const isAdmin = !!(who && who.emailVerified && ADMINS.includes(who.email));
  const [collection, id] = rest.split('/');
  if (collection === 'studentAccess') {
    if (!db.protectedRules) {   // the open catch-all: anybody reads anything
      return db.studentAccess.has(id) ? json(200, { fields: encode(db.studentAccess.get(id)).mapValue.fields }) : json(404, { error: { status: 'NOT_FOUND' } });
    }
    if (method === 'GET') {
      if (!who || (who.uid !== id && !isAdmin)) return json(403, { error: { status: 'PERMISSION_DENIED' } });
      return db.studentAccess.has(id) ? json(200, { fields: encode(db.studentAccess.get(id)).mapValue.fields }) : json(404, { error: { status: 'NOT_FOUND' } });
    }
    if (method === 'PATCH') {
      const data = decode({ mapValue: JSON.parse(request.postData()) });
      const existing = db.studentAccess.get(id);
      const ok = isAdmin || (who && who.uid === id && isOwnForm(id, data) && (!existing || ['pending', 'revoked'].includes(existing.status)));
      if (!ok) return json(403, { error: { status: 'PERMISSION_DENIED' } });
      db.studentAccess.set(id, data);
      return json(200, { fields: encode(data).mapValue.fields });
    }
  }
  if (rest === 'mail' && method === 'POST') {
    const id = url.searchParams.get('documentId');
    const data = decode({ mapValue: JSON.parse(request.postData()) });
    const ok = who && new RegExp('^polymath-access-' + who.uid + '-[1-9]$').test(id)
      && JSON.stringify(data.to) === '["admin@polymathlc.com.sg"]' && JSON.stringify(data.cc) === '["support@polymathlc.com.sg"]';
    if (!ok) return json(403, { error: { status: 'PERMISSION_DENIED' } });
    if (db.mail.has(id)) return json(409, { error: { status: 'ALREADY_EXISTS' } });
    db.mail.set(id, data);
    return json(200, {});
  }
  return json(404, { error: { status: 'NOT_FOUND' } });
}

/* ───────────── the fake Firebase SDKs ───────────── */
// Auth: the signed-in user is whatever the test put in localStorage['fake-user'].
const FAKE_AUTH_CORE = `
  function fakeUser() {
    try { var raw = localStorage.getItem('fake-user'); if (!raw) return null; var u = JSON.parse(raw);
      u.isAnonymous = false; u.getIdToken = function () { return Promise.resolve('tok-' + u.uid); }; return u; } catch (e) { return null; }
  }
  var authListeners = [];
  var authObject = {
    get currentUser() { return fakeUser(); },
    onAuthStateChanged: function (fn) { authListeners.push(fn); setTimeout(function () { fn(fakeUser()); }, 30); return function () {}; },
    signOut: function () { localStorage.removeItem('fake-user'); authListeners.forEach(function (fn) { fn(null); }); return Promise.resolve(); },
    signInWithPopup: function () { return Promise.resolve(); }, signInWithRedirect: function () { return Promise.resolve(); },
    signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/invalid-credential' }); }
  };`;
const FAKE_COMPAT_APP = `(function () {
  ${FAKE_AUTH_CORE}
  var apps = [];
  function GoogleAuthProvider() {} GoogleAuthProvider.prototype.setCustomParameters = function () {};
  var auth = function () { return authObject; }; auth.GoogleAuthProvider = GoogleAuthProvider;
  // The admin dashboard's Firestore: reads/writes the test's database over a private channel.
  function call(op, body) { return fetch('${SITE}/__db/' + op, { method: 'POST', body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); }); }
  function firestore() {
    return { collection: function (name) {
      return {
        onSnapshot: function (next) {
          var stop = false;
          (function tick() { if (stop) return; call('list', { collection: name }).then(function (docs) {
            next({ docs: docs.map(function (d) { return { id: d.id, data: function () { return d.data; } }; }) });
            setTimeout(tick, 300); }); })();
          return function () { stop = true; };
        },
        doc: function (id) { return {
          update: function (data) { return call('update', { collection: name, id: id, data: data }); },
          set: function (data) { return call('set', { collection: name, id: id, data: data }); },
          delete: function () { return call('delete', { collection: name, id: id }); }
        }; }
      };
    } };
  }
  firestore.FieldValue = { serverTimestamp: function () { return '__now__'; } };
  window.firebase = { apps: apps, initializeApp: function (c) { apps.push({ name: '[DEFAULT]', options: c }); return apps[0]; }, auth: auth, firestore: firestore };
})();`;
const FAKE_MODULAR_APP = `var apps = [];
export function getApps() { return apps.slice(); }
export function initializeApp(c, name) { var a = { name: name || '[DEFAULT]', options: c }; apps.push(a); return a; }`;
const FAKE_MODULAR_AUTH = `${FAKE_AUTH_CORE}
export function getAuth() { return authObject; }
export function onAuthStateChanged(auth, fn) { return auth.onAuthStateChanged(fn); }
export function signOut(auth) { return auth.signOut(); }`;

function standInApp(name, kind) {
  const gate = `<script defer src="${APPS}/cer/student/access-gate.js?v=1.0.0" data-app="${name}"></script>`;
  const signIn = kind === 'compat'
    ? `<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
       <script>firebase.initializeApp({ projectId: 'mathgen--app' }); firebase.auth().onAuthStateChanged(function (u) { document.getElementById('who').textContent = u ? u.email : 'signed out'; });</script>`
    : `<script type="module">
         import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
         import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
         const app = initializeApp({ projectId: 'mathgen--app' }); const auth = getAuth(app);
         onAuthStateChanged(auth, u => { document.getElementById('who').textContent = u ? u.email : 'signed out'; });
       </script>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title></head>
    <body><h1 id="appTitle">The ${name} app</h1><p id="who">…</p><button id="appButton" onclick="window.__clicked=(window.__clicked||0)+1">Practise</button>${signIn}${gate}</body></html>`;
}

function fileAnswer(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { status: 404, body: 'missing' };
  return { status: 200, headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }, body: fs.readFileSync(file) };
}

async function route(r) {
  const request = r.request();
  const url = new URL(request.url());
  if (url.origin === 'https://firestore.googleapis.com') return r.fulfill(firestoreAnswer(request));
  if (url.href.startsWith('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js')) return r.fulfill({ status: 200, headers: { 'content-type': 'text/javascript' }, body: FAKE_COMPAT_APP });
  if (url.href.startsWith('https://www.gstatic.com/firebasejs/10.12.2/')) return r.fulfill({ status: 200, headers: { 'content-type': 'text/javascript' }, body: '/* part of the fake compat SDK */' });
  if (url.href === 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js') return r.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: FAKE_MODULAR_APP });
  if (url.href === 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js') return r.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: FAKE_MODULAR_AUTH });
  if (url.origin === SITE && url.pathname.startsWith('/__db/')) {
    const op = url.pathname.slice(6), body = JSON.parse(request.postData() || '{}');
    const store = db[body.collection];
    const now = v => (v === '__now__' ? new Date().toISOString() : v);
    const clean = data => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, now(v)]));
    if (op === 'list') return r.fulfill(json(200, [...store.entries()].map(([id, data]) => ({ id, data }))));
    if (op === 'update') store.set(body.id, { ...store.get(body.id), ...clean(body.data) });
    if (op === 'set') store.set(body.id, clean(body.data));
    if (op === 'delete') store.delete(body.id);
    return r.fulfill(json(200, {}));
  }
  if (url.origin === SITE && url.pathname.startsWith('/student/')) return r.fulfill(fileAnswer(path.join(repoRoot, url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname)));
  if (url.origin === APPS && url.pathname.startsWith('/cer/student/')) return r.fulfill(fileAnswer(path.join(repoRoot, url.pathname.slice(4))));
  if (url.origin === APPS) {
    const name = url.pathname.split('/')[1];
    const kind = ['math', 'english', 'chinese'].includes(name) ? 'modular' : 'compat';
    return r.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: standInApp(name, kind) });
  }
  return r.abort();
}

/* ───────────── helpers ───────────── */
const browser = await chromium.launch();
let failures = 0;
async function step(name, fn) {
  try { await fn(); console.log('✓ ' + name); }
  catch (error) { failures++; console.log('✗ ' + name + '\n   ' + String(error && error.stack || error).split('\n').slice(0, 6).join('\n   ')); }
}
async function newPage(who, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: shots ? 2 : 1 });
  await context.route('**/*', route);
  await context.addInitScript(user => { if (user) localStorage.setItem('fake-user', JSON.stringify(user)); }, who || null);
  const page = await context.newPage();
  page.on('pageerror', error => console.log('   [page error] ' + error.message));
  return page;
}
const gateText = page => page.evaluate(() => {
  const host = document.getElementById('polymath-access-gate');
  return host && host.isConnected && host.shadowRoot ? host.shadowRoot.textContent : '';
});
async function waitGate(page, text, timeout = 8000) {
  await page.waitForFunction(t => {
    const host = document.getElementById('polymath-access-gate');
    return !!(host && host.isConnected && host.shadowRoot && host.shadowRoot.textContent.includes(t));
  }, text, { timeout });
}
async function waitNoGate(page, timeout = 8000) {
  await page.waitForFunction(() => {
    const host = document.getElementById('polymath-access-gate');
    return !(host && host.isConnected) && window.PolymathAccess && ['approved', 'staff', 'idle', 'inactive', 'guest'].includes(window.PolymathAccess.state.phase);
  }, null, { timeout });
}
const inGate = (page, selector) => page.locator('#polymath-access-gate').locator(selector);

/* ───────────── 1. before the rules are published ───────────── */
await step('before the rules are published the gate stays off: no pop-up, nothing collected', async () => {
  db.protectedRules = false;
  const page = await newPage(USERS.student);
  await page.goto(APPS + '/tutor/');
  await page.waitForFunction(() => window.PolymathAccess && window.PolymathAccess.state.phase === 'inactive', null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => !!document.getElementById('polymath-access-gate')?.isConnected), false);
  assert.equal(db.studentAccess.size, 0);
  await page.context().close();
});

db.protectedRules = true;

/* ───────────── 2. a new student in a compat app ───────────── */
let studentPage;
await step('a new student in Study Buddy (compat sign-in) gets the enrolment pop-up and cannot reach the app', async () => {
  studentPage = await newPage(USERS.student, { width: 390, height: 844 });
  await studentPage.goto(APPS + '/tutor/');
  await waitGate(studentPage, 'Please confirm your enrolment');
  const text = await gateText(studentPage);
  assert.match(text, /tan\.kid@gmail\.com/);
  assert.match(text, /Math only/); assert.match(text, /Science only/); assert.match(text, /Both Math and Science/);
  assert.equal(await studentPage.evaluate(() => document.body.hasAttribute('inert')), true, 'the app behind is inert');
  await studentPage.locator('#appButton').click({ force: true, timeout: 1500 }).catch(() => {});
  assert.equal(await studentPage.evaluate(() => window.__clicked || 0), 0, 'the app\'s own buttons do nothing');
  if (shots) await studentPage.screenshot({ path: path.join(shots, 'popup-phone.png'), fullPage: false });
});

await step('an empty form names every missing answer and writes nothing', async () => {
  assert.equal(await inGate(studentPage, 'input[name="parentEmail"]').inputValue(), 'tan.kid@gmail.com', 'the account\'s own email is offered');
  await inGate(studentPage, 'input[name="parentName"]').fill('');
  await inGate(studentPage, 'input[name="parentEmail"]').fill('');
  await inGate(studentPage, 'button[type="submit"]').click();
  const text = await gateText(studentPage);
  assert.match(text, /still enrolled/);
  assert.match(text, /parent's full name/i);
  assert.match(text, /email address/);
  assert.match(text, /this child's full name/);
  assert.match(text, /choose a level/);
  assert.match(text, /choose the subjects/);
  assert.equal(db.studentAccess.size, 0);
});

await step('two children filled in → "Waiting for approval", the record and the centre\'s email are written', async () => {
  const g = sel => inGate(studentPage, sel);
  await g('input[name="enrolled"]').check();
  await g('input[name="parentName"]').fill('Mdm Tan Siew Ling');
  await g('input[name="parentEmail"]').fill('tan.sl@gmail.com');
  await g('select[name="childCount"]').selectOption('2');
  await g('input[name="child0name"]').fill('Tan Wei Ming');
  await g('select[name="child0level"]').selectOption('P5');
  await g('input[name="child0subjects"][value="both"]').check({ force: true });
  await g('input[name="child1name"]').fill('Tan Wei Ling');
  await g('select[name="child1level"]').selectOption('P3');
  await g('input[name="child1subjects"][value="math"]').check({ force: true });
  assert.equal(await g('input[name="parentName"]').inputValue(), 'Mdm Tan Siew Ling', 'typing survives the child rows being redrawn');
  if (shots) await studentPage.screenshot({ path: path.join(shots, 'popup-filled-phone.png'), fullPage: false });
  await g('button[type="submit"]').click();
  await waitGate(studentPage, 'Waiting for approval');
  const record = db.studentAccess.get('stu1');
  assert.ok(record, 'saved');
  assert.equal(record.status, 'pending');
  assert.equal(record.childCount, 2);
  assert.deepEqual(record.children, [{ name: 'Tan Wei Ming', level: 'P5', subjects: 'both' }, { name: 'Tan Wei Ling', level: 'P3', subjects: 'math' }]);
  assert.equal(record.app, 'tutor');
  const mail = db.mail.get('polymath-access-stu1-1');
  assert.ok(mail, 'the centre is emailed');
  assert.match(mail.message.subject, /Mdm Tan Siew Ling \(2 children\)/);
  if (shots) await studentPage.screenshot({ path: path.join(shots, 'waiting-phone.png'), fullPage: false });
});

await step('taking the pop-up out of the page puts it straight back', async () => {
  await studentPage.evaluate(() => { document.getElementById('polymath-access-gate').remove(); document.body.removeAttribute('inert'); });
  await studentPage.waitForTimeout(100);
  assert.equal(await studentPage.evaluate(() => !!document.getElementById('polymath-access-gate')?.isConnected), true);
  assert.equal(await studentPage.evaluate(() => document.body.hasAttribute('inert')), true);
});

/* ───────────── 4. the same account in a modular app ───────────── */
await step('the same account at polymathlc.github.io/math/ (modular sign-in) is blocked with the same screen', async () => {
  const page = await newPage(USERS.student);
  await page.goto(APPS + '/math/');
  await waitGate(page, 'Waiting for approval');
  assert.match(await gateText(page), /Tan Wei Ming/);
  await page.context().close();
});

/* ───────────── 5. staff and signed-out ───────────── */
await step('a teacher (staff) and a signed-out visitor never see the pop-up', async () => {
  for (const [who, phase] of [[USERS.staff, 'staff'], [null, 'idle']]) {
    const page = await newPage(who);
    await page.goto(APPS + '/anskey/');
    await page.waitForFunction(() => window.PolymathAccess && window.PolymathAccess.state.phase !== 'checking');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.PolymathAccess.state.phase), phase);
    assert.equal(await page.evaluate(() => !!document.getElementById('polymath-access-gate')?.isConnected), false);
    await page.context().close();
  }
});

/* ───────────── 6. the admin approves ───────────── */
let adminPage;
await step('an admin opens /student/#admin, sees the request waiting and approves it', async () => {
  adminPage = await newPage(USERS.admin);
  await adminPage.goto(SITE + '/student/#admin');
  await adminPage.waitForSelector('#adminView:not([hidden]) .record');
  const card = adminPage.locator('.record', { hasText: 'Mdm Tan Siew Ling' });
  await assert.doesNotReject(card.waitFor());
  const text = await card.textContent();
  assert.match(text, /Tan Wei Ming/); assert.match(text, /Primary 5/); assert.match(text, /Both Math and Science/);
  assert.match(text, /Waiting/);
  assert.equal(await adminPage.locator('[data-apps-view]').first().isHidden(), true, 'the tiles step aside');
  assert.equal(await adminPage.evaluate(() => !!document.getElementById('polymath-access-gate')?.isConnected), false, 'an admin is never locked out');
  if (shots) await adminPage.screenshot({ path: path.join(shots, 'admin-dashboard.png'), fullPage: true });
  await card.locator('[data-admin="approve"]').click();
  await adminPage.waitForFunction(() => document.querySelector('.filter-chip.is-active span')?.textContent === '0');
  assert.equal(db.studentAccess.get('stu1').status, 'approved');
  assert.equal(db.studentAccess.get('stu1').decidedBy, 'chungzhikai@gmail.com');
});

/* ───────────── 7. the waiting student unlocks ───────────── */
await step('the waiting student\'s app unlocks (Check again), and opens at once next time', async () => {
  await inGate(studentPage, '[data-action="recheck"]').click();
  await waitNoGate(studentPage);
  assert.equal(await studentPage.evaluate(() => document.body.hasAttribute('inert')), false);
  await studentPage.locator('#appButton').click();
  assert.equal(await studentPage.evaluate(() => window.__clicked), 1, 'the app works');
  await studentPage.reload();
  await studentPage.waitForFunction(() => window.PolymathAccess && window.PolymathAccess.state.phase === 'approved');
  assert.equal(await studentPage.evaluate(() => !!document.getElementById('polymath-access-gate')?.isConnected), false);
});

/* ───────────── 8. the admin pauses access ───────────── */
await step('the admin pauses access → the student is blocked again and may ask again', async () => {
  await adminPage.locator('.filter-chip[data-filter="approved"]').click();
  const card = adminPage.locator('.record', { hasText: 'Mdm Tan Siew Ling' });
  await card.locator('[data-admin="revoke"]').click();
  await card.locator('[data-admin="revoke"]', { hasText: 'Tap again' }).click();
  await adminPage.waitForFunction(() => document.querySelector('.filter-chip[data-filter="revoked"] span')?.textContent === '1');
  assert.equal(db.studentAccess.get('stu1').status, 'revoked');
  await studentPage.reload();
  await waitGate(studentPage, 'Your access is paused');
  await inGate(studentPage, '[data-action="edit"]').click();
  await waitGate(studentPage, 'Update your details');
  assert.equal(await inGate(studentPage, 'input[name="child1name"]').inputValue(), 'Tan Wei Ling', 'the details come back filled in');
  await inGate(studentPage, 'input[name="enrolled"]').check();
  await inGate(studentPage, 'button[type="submit"]').click();
  await waitGate(studentPage, 'Waiting for approval');
  assert.equal(db.studentAccess.get('stu1').submissions, 2);
  assert.ok(db.mail.has('polymath-access-stu1-2'));
});

await step('/student for a signed-in student shows who they are and their status; signed out shows the sign-in card', async () => {
  const page = await newPage(USERS.student, { width: 390, height: 844 });
  await page.goto(SITE + '/student/');
  await waitGate(page, 'Waiting for approval');
  await page.context().close();
  const out = await newPage(null, { width: 390, height: 844 });
  await out.goto(SITE + '/student/');
  await out.waitForSelector('#accountCard:not([hidden]) [data-account="google"]');
  assert.equal(await out.locator('.tile-grid .app-tile').count() > 5, true, 'the tiles are still there');
  if (shots) await out.screenshot({ path: path.join(shots, 'student-signed-out-phone.png'), fullPage: false });
  const width = await out.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390, 'nothing wider than a phone (' + width + ')');
  await out.context().close();
});

await browser.close();
if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
console.log('All student access checks passed.');
