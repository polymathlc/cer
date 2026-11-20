// ✉️ Email sign-up, sign-in, password reset and email verification, in a real Chromium,
// with the REAL Firebase JavaScript SDK (served from npm packages) talking to a stand-in
// of Firebase Auth's REST API (identitytoolkit / securetoken) and of Firestore REST.
//
//   https://polymathlc.github.io/<app>/   stand-in app pages that sign in like the real apps:
//                                          "compat" (window.firebase 10.12.2, like Answer Keys,
//                                          Study Buddy, Rewards) or "modular" (11.10.0, like Math,
//                                          English, Chinese, Mind Map …), each with a Google button
//   https://polymathlc.github.io/cer/…    this repository (the gate + email-sign-in.js)
//   https://polymathlc.com.sg/…           this repository too (the real pages, for pictures)
//
// It does what a new parent does:
//   1. a signed-out page shows "✉️ Sign in with email" right after its Google button;
//   2. Create account with mistakes → every mistake is named; with good answers → the account
//      is made, the name saved, and the access gate shows "Confirm your email address" with
//      ONE verification email sent (no enrolment form yet, nothing sent to the centre);
//   3. "I have opened the link" before opening it → "we cannot see it yet";
//      after the link is opened → the enrolment form appears by itself;
//   4. the same email again on "Create account" → "already has an account" + "Set a password";
//      a wrong password → plain-words error + "Reset my password";
//   5. Forgot password → the reset email is sent (with the page as the way back) → "Check your inbox";
//   6. on a MODULAR page the same account signs in; the email button hides once signed in;
//   7. an existing email account that is not verified but already APPROVED is never asked to verify;
//   8. a page with <meta name="polymath-email-sign-in" content="off"> gets no button.
//
//   FIREBASE_SDK_DIR=<dir with firebase-11.10.0/ and firebase-10.12.2/ package folders>
//   PW=/path/to/playwright/index.mjs node tools/email-sign-in-browser.mjs
//   EMAIL_SCREENSHOTS=artifacts/email-sign-in saves pictures (phone and desktop).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.EMAIL_SCREENSHOTS || '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const SDK_DIR = process.env.FIREBASE_SDK_DIR || '';
const SDKS = { '11.10.0': path.join(SDK_DIR, 'firebase-11.10.0'), '10.12.2': path.join(SDK_DIR, 'firebase-10.12.2') };
for (const [version, dir] of Object.entries(SDKS)) {
  if (!fs.existsSync(path.join(dir, 'firebase-auth.js'))) throw new Error('Firebase SDK ' + version + ' not found in ' + dir + ' — set FIREBASE_SDK_DIR');
}

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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
const json = (status, body) => ({ status, headers: { 'content-type': 'application/json', ...cors }, body: JSON.stringify(body) });

/* ───────────── the stand-in Firebase Auth (identitytoolkit + securetoken) ───────────── */
const auth = { users: new Map(), outbox: [], seq: 0 };
const b64url = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
function jwtFor(user) {
  const now = Math.floor(Date.now() / 1000);
  const providers = user.providers;
  return [b64url({ alg: 'RS256', kid: 'test', typ: 'JWT' }), b64url({
    iss: 'https://securetoken.google.com/mathgen--app', aud: 'mathgen--app', auth_time: now, user_id: user.localId, sub: user.localId,
    iat: now, exp: now + 3600, email: user.email, email_verified: !!user.emailVerified, name: user.displayName || undefined,
    firebase: { identities: Object.fromEntries(providers.map(p => [p === 'password' ? 'email' : p, [user.email]])), sign_in_provider: providers[0] }
  }), 'c2ln'].join('.');
}
function userFromToken(token) {
  try { const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); return [...auth.users.values()].find(u => u.localId === payload.user_id) || null; }
  catch { return null; }
}
function addUser({ email, password = null, emailVerified = false, displayName = '', providers = ['password'] }) {
  const user = { localId: 'u' + (++auth.seq) + 'x' + Math.random().toString(36).slice(2, 8), email: email.toLowerCase(), password, emailVerified, displayName, providers, createdAt: String(Date.now()) };
  auth.users.set(user.email, user);
  return user;
}
function tokenAnswer(user, extra = {}) {
  return { kind: 'identitytoolkit#Response', localId: user.localId, email: user.email, displayName: user.displayName || '', idToken: jwtFor(user), refreshToken: 'refresh-' + user.localId, expiresIn: '3600', ...extra };
}
function lookupUser(user) {
  return {
    localId: user.localId, email: user.email, emailVerified: !!user.emailVerified, displayName: user.displayName || undefined,
    providerUserInfo: user.providers.map(p => ({ providerId: p, email: user.email, federatedId: user.email, rawId: user.email, displayName: user.displayName || undefined })),
    passwordHash: user.password ? 'UkVEQUNURUQ=' : undefined, passwordUpdatedAt: Date.now(), validSince: String(Math.floor(Date.now() / 1000) - 10),
    lastLoginAt: String(Date.now()), createdAt: user.createdAt, lastRefreshAt: new Date().toISOString()
  };
}
const fail = message => json(400, { error: { code: 400, message, errors: [{ message, domain: 'global', reason: 'invalid' }] } });

function identityAnswer(request) {
  const url = new URL(request.url());
  if (request.method() === 'OPTIONS') return { status: 204, headers: cors };
  let body = {};
  try { body = JSON.parse(request.postData() || '{}'); } catch { body = {}; }
  const op = url.pathname.split('accounts:')[1] || url.pathname;
  if (url.hostname === 'securetoken.googleapis.com') {
    const params = new URLSearchParams(request.postData() || '');
    const uid = String(params.get('refresh_token') || body.refresh_token || '').replace(/^refresh-/, '');
    const user = [...auth.users.values()].find(u => u.localId === uid);
    if (!user) return fail('INVALID_REFRESH_TOKEN');
    const id = jwtFor(user);
    return json(200, { access_token: id, id_token: id, refresh_token: 'refresh-' + uid, expires_in: '3600', token_type: 'Bearer', user_id: uid, project_id: '165654161198' });
  }
  if (op === 'signUp') {
    if (!body.email) return fail('MISSING_EMAIL');
    if (auth.users.has(String(body.email).toLowerCase())) return fail('EMAIL_EXISTS');
    if (String(body.password || '').length < 6) return fail('WEAK_PASSWORD : Password should be at least 6 characters');
    return json(200, tokenAnswer(addUser({ email: body.email, password: body.password })));
  }
  if (op === 'signInWithPassword') {
    const user = auth.users.get(String(body.email || '').toLowerCase());
    if (!user || user.password !== body.password) return fail('INVALID_LOGIN_CREDENTIALS');
    return json(200, tokenAnswer(user, { registered: true }));
  }
  if (op === 'lookup') {
    const user = userFromToken(body.idToken);
    if (!user) return fail('INVALID_ID_TOKEN');
    return json(200, { kind: 'identitytoolkit#GetAccountInfoResponse', users: [lookupUser(user)] });
  }
  if (op === 'update') {
    const user = userFromToken(body.idToken);
    if (!user) return fail('INVALID_ID_TOKEN');
    if ('displayName' in body) user.displayName = body.displayName;
    return json(200, { ...tokenAnswer(user), providerUserInfo: lookupUser(user).providerUserInfo, passwordHash: 'UkVEQUNURUQ=' });
  }
  if (op === 'sendOobCode') {
    const user = body.idToken ? userFromToken(body.idToken) : auth.users.get(String(body.email || '').toLowerCase());
    // Like Firebase with email enumeration protection: a reset for an unknown address still "succeeds".
    auth.outbox.push({ type: body.requestType, email: user ? user.email : String(body.email || ''), continueUrl: body.continueUrl || null, known: !!user });
    return json(200, { kind: 'identitytoolkit#GetOobConfirmationCodeResponse', email: user ? user.email : body.email });
  }
  if (op.startsWith('getProjectConfig') || url.pathname.includes('/projects')) return json(200, { projectId: 'mathgen--app', authorizedDomains: ['polymathlc.com.sg', 'polymathlc.github.io', 'localhost'] });
  if (op === 'getRecaptchaConfig' || url.pathname.includes('recaptchaConfig')) return json(200, { recaptchaKey: '', recaptchaEnforcementState: [] });
  return json(404, { error: { code: 404, message: 'NOT_FOUND ' + op } });
}

/* ───────────── the stand-in Firestore REST (just studentAccess, like the live rules) ───────────── */
const db = { studentAccess: new Map(), mail: new Map() };
function encode(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, encode(v)])) } };
}
function firestoreAnswer(request) {
  const url = new URL(request.url());
  if (request.method() === 'OPTIONS') return { status: 204, headers: cors };
  const rest = decodeURIComponent(url.pathname.split('/documents/')[1] || '');
  const who = userFromToken((request.headers().authorization || '').replace(/^Bearer /, ''));
  const [collection, id] = rest.split('/');
  if (collection === 'studentAccess') {
    if (!who || who.localId !== id) return json(403, { error: { status: 'PERMISSION_DENIED' } });
    if (request.method() === 'GET') return db.studentAccess.has(id) ? json(200, { fields: encode(db.studentAccess.get(id)).mapValue.fields }) : json(404, { error: { status: 'NOT_FOUND' } });
    if (request.method() === 'PATCH') { db.studentAccess.set(id, { status: 'pending' }); return json(200, { fields: {} }); }
  }
  if (rest.startsWith('mail')) { db.mail.set(url.searchParams.get('documentId'), true); return json(200, {}); }
  // Anything else the real pages read: an empty answer.
  return json(200, request.method() === 'POST' ? [] : { documents: [] });
}

/* ───────────── stand-in apps ───────────── */
function standInApp(name, kind, { optOut = false } = {}) {
  const gate = `<script defer src="${APPS}/cer/student/access-gate.js?v=1.2.0" data-app="${name}"></script>`;
  const config = `{ apiKey: 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo', authDomain: 'mathgen--app.firebaseapp.com', projectId: 'mathgen--app' }`;
  const signIn = kind === 'compat'
    ? `<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
       <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
       <script>firebase.initializeApp(${config}); firebase.auth().onAuthStateChanged(function (u) {
         document.getElementById('who').textContent = u ? 'Signed in: ' + u.email : 'Signed out';
         document.getElementById('google').style.display = u ? 'none' : ''; });</script>`
    : `<script type="module">
         import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
         import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
         const auth = getAuth(initializeApp(${config}));
         onAuthStateChanged(auth, u => { document.getElementById('who').textContent = u ? 'Signed in: ' + u.email : 'Signed out';
           document.getElementById('google').style.display = u ? 'none' : ''; });
       </script>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title>
    ${optOut ? '<meta name="polymath-email-sign-in" content="off">' : ''}
    <style>body{font-family:system-ui,sans-serif;margin:0;background:#F6F7F4}.card{max-width:380px;margin:48px auto;background:#fff;border-radius:18px;padding:28px;box-shadow:0 6px 24px rgba(0,0,0,.08);text-align:center}
    .g{display:flex;width:100%;justify-content:center;gap:8px;padding:12px;border-radius:999px;border:1px solid #ccc;background:#fff;font:600 15px system-ui;cursor:pointer}</style></head>
    <body><div class="card"><h1 id="appTitle" style="font-size:22px">The ${name} app</h1><p id="who">…</p>
    <button id="google" class="g" onclick="window.__google=(window.__google||0)+1"><img alt="" width="18" height="18" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='20' fill='%234285F4'/%3E%3C/svg%3E"> Sign in with Google</button>
    </div>${signIn}${gate}</body></html>`;
}

function fileAnswer(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { status: 404, headers: cors, body: 'missing' };
  return { status: 200, headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', ...cors }, body: fs.readFileSync(file) };
}

async function route(r) {
  const request = r.request();
  const url = new URL(request.url());
  if (url.hostname === 'identitytoolkit.googleapis.com' || url.hostname === 'securetoken.googleapis.com') return r.fulfill(identityAnswer(request));
  if (url.hostname === 'firestore.googleapis.com') return r.fulfill(firestoreAnswer(request));
  const sdk = /^\/firebasejs\/(\d+\.\d+\.\d+)\/(firebase-[a-z-]+\.js)$/.exec(url.pathname);
  if (url.hostname === 'www.gstatic.com' && sdk) {
    const dir = SDKS[sdk[1]] || SDKS['11.10.0'];
    return r.fulfill(fileAnswer(path.join(dir, sdk[2])));
  }
  // Pictures of the real pages only: libraries some apps need before they draw (CDN_DIR=pdfjs-dist/pdf-lib packages).
  if (url.hostname === 'cdnjs.cloudflare.com' && process.env.CDN_DIR) {
    const m = /\/ajax\/libs\/(pdf\.js|pdf-lib)\/[^/]+\/(.+)$/.exec(url.pathname);
    if (m) return r.fulfill(fileAnswer(path.join(process.env.CDN_DIR, m[1] === 'pdf.js' ? 'pdfjs/package/build' : 'pdflib/package/dist', m[2])));
  }
  if (url.origin === APPS && /^\/(compat-app|modular-app|optout-app)\/?$/.test(url.pathname)) {
    const name = url.pathname.split('/')[1];
    return r.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: standInApp(name, name === 'modular-app' ? 'modular' : 'compat', { optOut: name === 'optout-app' }) });
  }
  if (url.origin === APPS && url.pathname.startsWith('/cer/')) {
    const rel = url.pathname.slice(5);
    return r.fulfill(fileAnswer(path.join(repoRoot, rel.endsWith('/') || rel === '' ? rel + 'index.html' : rel)));
  }
  if (url.origin === SITE) {
    const rel = url.pathname.slice(1);
    return r.fulfill(fileAnswer(path.join(repoRoot, rel.endsWith('/') || rel === '' ? rel + 'index.html' : rel)));
  }
  if (url.origin === APPS && process.env.OTHER_REPOS) {
    // polymathlc.github.io/<repo>/… from local clones (OTHER_REPOS=/dir/with/clones) — pictures only.
    const [, repo, ...restParts] = url.pathname.split('/');
    const rel = restParts.join('/');
    const file = path.join(process.env.OTHER_REPOS, repo, rel === '' || rel.endsWith('/') ? rel + 'index.html' : rel);
    return r.fulfill(fileAnswer(file));
  }
  return r.abort();
}

/* ───────────── helpers ───────────── */
const browser = await chromium.launch();
async function newPage(viewport = { width: 1280, height: 860 }, extra = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', ...extra });
  await context.route('**/*', route);
  const page = await context.newPage();
  page.on('pageerror', error => { if (process.env.DEBUG) console.log('[page error]', error.message); });
  return { context, page };
}
const dlg = page => page.locator('#polymath-email-sign-in');
const gate = page => page.locator('#polymath-access-gate');
async function shot(page, name) { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); }
async function waitText(locator, text, timeout = 15000) {
  await locator.getByText(text, { exact: false }).first().waitFor({ timeout });
}
async function fill(page, name, value) { await dlg(page).locator(`input[name="${name}"]`).fill(value); }
const outboxOf = type => auth.outbox.filter(m => m.type === type);

let passed = 0;
async function step(name, fn) {
  if (process.env.REAL_ONLY) return;   // pictures of the real pages only
  await fn(); passed++; console.log('✓ ' + name);
}

/* ───────────── 1–5: a new parent on a compat app ───────────── */
await step('signed out: "Sign in with email" sits right after the Google button', async () => {
  const { page, context } = await newPage();
  await page.goto(APPS + '/compat-app/');
  await page.locator('polymath-email-button').first().waitFor({ timeout: 15000 });
  const order = await page.evaluate(() => document.getElementById('google').nextElementSibling.tagName);
  assert.equal(order, 'POLYMATH-EMAIL-BUTTON');
  assert.ok(await page.locator('polymath-email-button').isVisible());
  await shot(page, 'stand-in-desktop-button');
  await context.close();
});

const parent = { name: 'Mdm Tan Siew Ling', email: 'tan.siewling@example.com', password: 'Polymath2026!' };
let created = null;
{
  const { page, context } = await newPage({ width: 390, height: 844 }, { deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(APPS + '/compat-app/');
  await page.locator('polymath-email-button button').first().click();

  await step('the dialog opens on "Sign in" with tabs, forgot password and create account', async () => {
    await waitText(dlg(page), 'Sign in with email');
    await waitText(dlg(page), 'Forgot your password?');
    await shot(page, 'phone-1-sign-in');
  });

  await step('Create account with mistakes names every one of them', async () => {
    await dlg(page).getByRole('tab', { name: 'Create account' }).click();
    await waitText(dlg(page), 'Create your Polymath account');
    await fill(page, 'email', 'tan.siewling@example');
    await fill(page, 'password', 'short');
    await fill(page, 'confirm', 'different');
    await dlg(page).getByRole('button', { name: 'Create account', exact: true }).click();
    await waitText(dlg(page), 'Type your name');
    await waitText(dlg(page), 'does not look right');
    await waitText(dlg(page), 'at least 8 characters');
    assert.equal(auth.users.size, 0, 'nothing was created');
    await shot(page, 'phone-2-create-mistakes');
  });

  await step('a good Create account makes the account and the gate asks to confirm the email (one email sent)', async () => {
    await fill(page, 'name', parent.name);
    await fill(page, 'email', parent.email);
    await fill(page, 'password', parent.password);
    await fill(page, 'confirm', parent.password);
    await shot(page, 'phone-3-create-filled');
    await dlg(page).getByRole('button', { name: 'Create account', exact: true }).click();
    await waitText(gate(page), 'Confirm your email address');
    created = auth.users.get(parent.email);
    assert.ok(created, 'account created');
    assert.equal(created.displayName, parent.name);
    await page.waitForTimeout(1500);
    const sent = outboxOf('VERIFY_EMAIL');
    assert.equal(sent.length, 1, 'exactly one verification email: ' + JSON.stringify(sent));
    assert.equal(sent[0].email, parent.email);
    assert.equal(sent[0].continueUrl, APPS + '/compat-app/');
    assert.equal(await dlg(page).count(), 0, 'the dialog has closed');
    assert.equal(db.mail.size, 0, 'nothing reached the centre yet');
    assert.equal(db.studentAccess.size, 0);
    await shot(page, 'phone-4-confirm-email');
  });

  await step('"I have opened the link" too early says so; after opening it the enrolment form appears by itself', async () => {
    await gate(page).getByRole('button', { name: 'I have opened the link' }).click();
    await waitText(gate(page), 'cannot see the confirmation yet');
    await gate(page).getByRole('button', { name: 'Send the email again' }).click();
    await waitText(gate(page), 'Sent again');
    assert.equal(outboxOf('VERIFY_EMAIL').length, 2);
    created.emailVerified = true;                      // the parent taps the link in the email
    await waitText(gate(page), 'Please confirm your enrolment', 20000);
    const nameValue = await gate(page).locator('input[name="parentName"]').inputValue();
    assert.equal(nameValue, parent.name, 'the name typed at sign-up is filled in');
    await shot(page, 'phone-5-enrolment-form');
  });
  await context.close();
}

await step('the same email on "Create account" → "already has an account" with "Set a password"; wrong password → plain words', async () => {
  const { page, context } = await newPage();
  await page.goto(APPS + '/compat-app/');
  await page.locator('polymath-email-button button').first().click();
  await dlg(page).getByRole('tab', { name: 'Create account' }).click();
  await fill(page, 'name', 'Someone Else');
  await fill(page, 'email', parent.email.toUpperCase());
  await fill(page, 'password', 'AnotherPass99');
  await fill(page, 'confirm', 'AnotherPass99');
  await dlg(page).getByRole('button', { name: 'Create account', exact: true }).click();
  await waitText(dlg(page), 'already has a Polymath account');
  await dlg(page).getByRole('button', { name: 'Set a password' }).waitFor();
  assert.equal(auth.users.size, 1, 'still one account for that email');
  await shot(page, 'desktop-already-has-account');
  await dlg(page).getByRole('tab', { name: 'Sign in' }).click();
  await fill(page, 'email', parent.email);
  await fill(page, 'password', 'wrong-password');
  await dlg(page).getByRole('button', { name: 'Sign in', exact: true }).click();
  await waitText(dlg(page), 'is not right');
  await dlg(page).getByRole('button', { name: 'Reset my password' }).waitFor();
  await shot(page, 'desktop-wrong-password');
  await context.close();
});

await step('Forgot password sends the reset email and shows "Check your inbox"', async () => {
  const { page, context } = await newPage({ width: 390, height: 844 }, { deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(APPS + '/compat-app/');
  await page.locator('polymath-email-button button').first().click();
  await dlg(page).getByRole('button', { name: 'Forgot your password?' }).click();
  await waitText(dlg(page), 'Reset your password');
  await fill(page, 'email', parent.email);
  await shot(page, 'phone-6-reset');
  await dlg(page).getByRole('button', { name: 'Email me a reset link' }).click();
  await waitText(dlg(page), 'Check your inbox');
  const resets = outboxOf('PASSWORD_RESET');
  assert.equal(resets.length, 1);
  assert.equal(resets[0].email, parent.email);
  assert.equal(resets[0].continueUrl, APPS + '/compat-app/');
  await shot(page, 'phone-7-reset-sent');
  await context.close();
});

/* ───────────── 6: the same account on a modular app ───────────── */
await step('on a modular (11.10.0) app the same account signs in; the email button hides once signed in', async () => {
  const { page, context } = await newPage();
  await page.goto(APPS + '/modular-app/');
  await page.locator('polymath-email-button button').first().click();
  await fill(page, 'email', parent.email);
  await fill(page, 'password', parent.password);
  await dlg(page).getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText('Signed in: ' + parent.email).waitFor({ timeout: 15000 });
  await dlg(page).waitFor({ state: 'detached', timeout: 10000 });
  await page.waitForTimeout(1300);
  assert.equal(await page.locator('polymath-email-button').isVisible(), false, 'button hidden when signed in');
  // Verified now and no record yet → the enrolment form (no second verify screen).
  await waitText(gate(page), 'Please confirm your enrolment');
  assert.equal(outboxOf('VERIFY_EMAIL').length, 2, 'no new verification email for a verified account');
  await context.close();
});

/* ───────────── 7: nobody who had access before is asked ───────────── */
await step('an older email account that is NOT verified but already approved opens the app (never asked to verify)', async () => {
  const old = addUser({ email: 'old.parent@example.com', password: 'OldPass2025', emailVerified: false, displayName: 'Old Parent' });
  db.studentAccess.set(old.localId, { status: 'approved', uid: old.localId, children: [{ name: 'Kid', level: 'P5', subjects: 'both' }] });
  const { page, context } = await newPage();
  await page.goto(APPS + '/compat-app/');
  await page.locator('polymath-email-button button').first().click();
  await fill(page, 'email', old.email);
  await fill(page, 'password', 'OldPass2025');
  await dlg(page).getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText('Signed in: ' + old.email).waitFor({ timeout: 15000 });
  await page.waitForTimeout(2500);
  assert.equal(await gate(page).count(), 0, 'no gate screen at all');
  assert.equal(outboxOf('VERIFY_EMAIL').filter(m => m.email === old.email).length, 0);
  await context.close();
});

/* ───────────── 8: pages with their own email form ───────────── */
await step('a page that opts out gets no email button (but still the verification step)', async () => {
  const { page, context } = await newPage();
  await page.goto(APPS + '/optout-app/');
  await page.getByText('Signed out').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('polymath-email-button').count(), 0);
  assert.equal(await page.evaluate(() => !!(window.PolymathEmailSignIn && window.PolymathEmailSignIn.version)), true, 'the script is there for PolymathEmailSignIn.open()');
  await context.close();
});

/* ───────────── pictures of the real pages (signed out) ───────────── */
if (shots && process.env.REAL_PAGES) {
  const pages = process.env.REAL_PAGES.split(',').map(s => s.trim()).filter(Boolean);
  for (const target of pages) {
    // name=url or name=url|text of a button to tap first (e.g. a "Log In" that opens the sign-in box)
    const [name, rest] = [target.slice(0, target.indexOf('=')), target.slice(target.indexOf('=') + 1)];
    const [href, tap] = rest.split('|');
    for (const [label, viewport, extra] of [['desktop', { width: 1280, height: 860 }, {}], ['phone', { width: 390, height: 844 }, { deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
      const { page, context } = await newPage(viewport, extra);
      try {
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(6000);
        if (tap) {
          const css = tap.startsWith('css:') ? tap.slice(4) : null;
          const target = css ? page.locator(css).first() : page.getByText(tap, { exact: true }).filter({ visible: true }).first();
          await target.click({ timeout: 8000 }).catch(error => console.log('  (could not tap ' + tap + ': ' + error.message.split('\n')[0] + ')'));
          await page.waitForTimeout(1500);
        }
        if (process.env.REAL_EVAL) console.log('  eval:', String(await page.evaluate(process.env.REAL_EVAL).catch(e => 'error ' + e.message)).slice(0, 600));
        const count = await page.locator('polymath-email-button').count();
        const visible = count ? await page.locator('polymath-email-button').evaluateAll(list => list.filter(el => el.getClientRects().length && getComputedStyle(el).display !== 'none').length) : 0;
        console.log(`  ${name} (${label}): ${count} email button(s), ${visible} visible`);
        const first = page.locator('polymath-email-button').filter({ visible: true }).first();
        if (visible) await first.scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: path.join(shots, `real-${name}-${label}.png`) });
      } catch (error) { console.log(`  ${name} (${label}): could not open (${error.message.split('\n')[0]})`); }
      await context.close();
    }
  }
}

await browser.close();
console.log(`\nAll ${passed} email sign-in checks passed.`);
