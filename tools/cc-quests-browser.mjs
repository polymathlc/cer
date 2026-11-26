// Browser check for the /cc Robux Quest Board, at desktop and phone widths.
// It serves the repository locally and swaps the Firebase scripts for a small
// in-memory stand-in (below), so nothing touches the real database. It then
// plays through what Dad and the children do: look at the board, sign in,
// add a quest, mark it Success and Failed, undo, pay out Robux, set a goal,
// and check the balances on screen match the maths in cc/cc-core.mjs.
//
//   node tools/cc-quests-browser.mjs                 (needs playwright)
//   CC_SCREENSHOTS=dir node tools/cc-quests-browser.mjs   also saves screenshots
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.CC_SCREENSHOTS || '';

const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------------- The Firebase stand-in (runs inside the page) ---------------- */
const FAKE_FIREBASE = String.raw`
(function () {
  const seed = window.__CC_SEED || {};
  const store = { ccQuests: {}, ccLedger: {}, ccSettings: {} };
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) store[c][id] = JSON.parse(JSON.stringify(d));
  const listeners = [];
  let counter = 0;
  const newId = () => 'id' + (++counter).toString(36) + Math.random().toString(36).slice(2, 6);
  const DELETE = { __delete: true };
  function emit() {
    setTimeout(() => { for (const l of listeners) l(); }, 0);
  }
  function setPath(obj, path, value) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] && typeof o[parts[i]] === 'object' ? o[parts[i]] : {}; o = o[parts[i]]; }
    if (value && value.__delete) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
  }
  function guard() {
    const u = window.__ccFakeAuth.user;
    const ok = u && u.emailVerified && ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg'].includes(String(u.email).toLowerCase());
    window.__ccWrites = (window.__ccWrites || 0) + 1;
    if (!ok) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
  }
  function docRef(col, id) {
    return {
      id,
      async set(data, opts) { guard(); store[col][id] = opts && opts.merge ? { ...(store[col][id] || {}), ...JSON.parse(JSON.stringify(data)) } : JSON.parse(JSON.stringify(data)); emit(); },
      async update(data) { guard(); if (!store[col][id]) { const e = new Error('No document'); e.code = 'not-found'; throw e; }
        for (const [k, v] of Object.entries(data)) setPath(store[col][id], k, v); emit(); },
      async delete() { guard(); delete store[col][id]; emit(); },
      onSnapshot(next) {
        const fire = () => next({ exists: !!store[col][id], data: () => store[col][id] && JSON.parse(JSON.stringify(store[col][id])) });
        listeners.push(fire); setTimeout(fire, 30); return () => {};
      },
      _col: col
    };
  }
  function collection(col) {
    return {
      doc(id) { return docRef(col, id || newId()); },
      async add(data) { guard(); const id = newId(); store[col][id] = JSON.parse(JSON.stringify(data)); emit(); return docRef(col, id); },
      onSnapshot(next) {
        const fire = () => next({ docs: Object.entries(store[col]).map(([id, d]) => ({ id, data: () => JSON.parse(JSON.stringify(d)) })) });
        listeners.push(fire); setTimeout(fire, 30); return () => {};
      }
    };
  }
  function batch() {
    const ops = [];
    return {
      set(ref, data) { ops.push(() => { store[ref._col][ref.id] = JSON.parse(JSON.stringify(data)); }); },
      update(ref, data) { ops.push(() => { for (const [k, v] of Object.entries(data)) setPath(store[ref._col][ref.id], k, v); }); },
      delete(ref) { ops.push(() => { delete store[ref._col][ref.id]; }); },
      async commit() { guard(); ops.forEach(f => f()); emit(); }
    };
  }
  const authListeners = [];
  window.__ccFakeAuth = {
    user: null,
    setUser(u) { this.user = u; authListeners.forEach(f => f(u)); }
  };
  const authObj = {
    onAuthStateChanged(f) { authListeners.push(f); setTimeout(() => f(window.__ccFakeAuth.user), 10); return () => {}; },
    async signInWithPopup() { window.__ccFakeAuth.setUser(window.__CC_LOGIN || { email: 'chungzhikai@gmail.com', emailVerified: true }); return { user: window.__ccFakeAuth.user }; },
    async signInWithRedirect() {},
    async getRedirectResult() { return null; },
    async signOut() { window.__ccFakeAuth.setUser(null); }
  };
  function GoogleAuthProvider() { this.setCustomParameters = () => {}; }
  const firestoreFn = () => ({ collection, batch, enablePersistence: () => Promise.resolve() });
  firestoreFn.FieldValue = { delete: () => DELETE };
  window.__ccStore = store;
  window.firebase = {
    initializeApp() {},
    firestore: firestoreFn,
    auth: Object.assign(() => authObj, { GoogleAuthProvider })
  };
})();
`;

/* ---------------- Seed data: a few weeks of quests ---------------- */
const DAY = 86400000;
const NOW = Date.now();
const sgDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date(ms));
const SEED = {
  ccQuests: {
    q1: { title: 'Finish the P5 maths worksheet', icon: '🧮', category: 'study', reward: 50, penalty: 0, kids: ['caius'],
      results: { caius: { status: 'open', at: 0 } }, due: sgDate(NOW + DAY), repeat: '', createdAt: NOW - DAY },
    q2: { title: 'Read for 30 minutes', icon: '📖', category: 'study', reward: 15, penalty: 0, kids: ['caius', 'caris'],
      results: { caius: { status: 'open', at: 0 }, caris: { status: 'open', at: 0 } }, due: sgDate(NOW), repeat: 'daily', createdAt: NOW - 2 * DAY },
    q3: { title: 'Tidy your room before dinner', icon: '🧹', category: 'chores', reward: 20, penalty: 10, kids: ['caris'],
      details: 'Toys in the box, clothes in the basket, bed made.', results: { caris: { status: 'open', at: 0 } }, due: sgDate(NOW - 2 * DAY), repeat: '', createdAt: NOW - 3 * DAY },
    q4: { title: 'Full marks on spelling', icon: '💯', category: 'study', reward: 100, penalty: 0, kids: ['caius', 'caris'],
      results: { caius: { status: 'success', at: NOW - 3 * DAY }, caris: { status: 'success', at: NOW - 3 * DAY } }, due: '', repeat: '', createdAt: NOW - 9 * DAY },
    q5: { title: 'Be kind to your sibling all day', icon: '💛', category: 'kindness', reward: 25, penalty: 0, kids: ['caius', 'caris'],
      results: { caius: { status: 'failed', at: NOW - 6 * DAY }, caris: { status: 'success', at: NOW - 6 * DAY } }, due: '', repeat: '', createdAt: NOW - 10 * DAY },
    q6: { title: 'Swim 10 laps', icon: '🏊', category: 'health', reward: 40, penalty: 0, kids: ['caius'],
      results: { caius: { status: 'success', at: NOW - 12 * DAY } }, due: '', repeat: '', createdAt: NOW - 14 * DAY },
    q7: { title: 'Practise piano 20 minutes', icon: '🎹', category: 'habit', reward: 20, penalty: 0, kids: ['caris'],
      results: { caris: { status: 'success', at: NOW - 15 * DAY } }, due: '', repeat: '', createdAt: NOW - 16 * DAY }
  },
  ccLedger: {
    l1: { kid: 'caius', type: 'redeem', amount: 80, note: 'Game pass', at: NOW - 2 * DAY },
    l2: { kid: 'caris', type: 'bonus', amount: 30, note: 'Helped Grandma', at: NOW - 5 * DAY }
  },
  ccSettings: { main: { goals: { caris: { label: 'Fox pet bundle', amount: 400 } } } }
};
// Expected from the seed: Caius earned 100 + 40 = 140, redeemed 80 → 60.
// Caris earned 100 + 25 + 20 = 145, bonus 30 → 175.

const browser = await chromium.launch();
const failures = [];
async function run(name, viewport, fn, { isMobile = false } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1, isMobile, hasTouch: isMobile });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  // Later routes win in Playwright, so the catch-all for the other Firebase scripts goes first.
  await page.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE_FIREBASE }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.addInitScript(seed => { window.__CC_SEED = seed; try { localStorage.clear(); } catch (e) {} }, SEED);
  try {
    await page.goto(BASE + '/cc/', { waitUntil: 'load' });
    await page.waitForSelector('[data-balance="caius"]');
    await fn(page);
    assert.deepEqual(errors, [], 'no page errors');
    console.log('ok  ' + name);
  } catch (e) {
    failures.push(name);
    console.log('FAIL ' + name + '\n' + (e.stack || e));
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'FAIL-' + name.replace(/\W+/g, '-') + '.png'), fullPage: true }).catch(() => {});
  }
  await context.close();
}
const shot = async (page, file, full = true) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, file), fullPage: full }); };
const text = (page, sel) => page.locator(sel).first().innerText();
if (SHOTS) await mkdir(SHOTS, { recursive: true });

await run('kids view (desktop)', { width: 1280, height: 900 }, async page => {
  assert.equal(await text(page, '[data-balance="caius"]'), '60');
  assert.equal(await text(page, '[data-balance="caris"]'), '175');
  assert.equal(await page.locator('#admin-actions').isHidden(), true, 'no admin buttons for the children');
  assert.equal(await page.locator('[data-action="mark"]').count(), 0);
  // Three active quests, one of them late.
  assert.equal(await page.locator('#active-list .quest').count(), 3);
  assert.equal(await page.locator('#active-list .quest.late').count(), 1);
  // Caris's goal bar.
  assert.match(await text(page, '[data-player="caris"] .goal'), /Fox pet bundle · 225 Robux to go/);
  await page.waitForTimeout(600);
  await shot(page, 'desktop-kids-view.png');
  // Filter to Caius only.
  await page.click('[data-player="caius"]');
  assert.equal(await page.locator('#active-list .quest').count(), 2);
  assert.equal(await page.locator('[data-player="caris"].dimmed').count(), 1);
  await page.click('#tabs [data-tab="history"]');
  const rows = await page.locator('#history-list .h-row').count();
  assert.equal(rows, 4, 'Caius: game pass, spelling, kindness (failed), swim');
  await shot(page, 'desktop-history-caius.png');
  await page.click('#kid-filter [data-kid=""]');
  await page.click('#tabs [data-tab="stats"]');
  assert.equal(await page.locator('.stat-card').count(), 2);
  await shot(page, 'desktop-stats.png');
});

await run('a signed-in stranger can only look', { width: 1280, height: 900 }, async page => {
  await page.evaluate(() => { window.__CC_LOGIN = { email: 'friend@example.com', emailVerified: true }; });
  await page.click('[data-action="sign-in"]');
  await page.waitForSelector('.toast');
  assert.match(await text(page, '.toast'), /can only look/);
  assert.equal(await page.locator('#admin-actions').isHidden(), true);
});

await run('dad adds, marks, undoes and pays out (desktop)', { width: 1280, height: 900 }, async page => {
  await page.click('[data-action="sign-in"]');
  await page.waitForSelector('#admin-actions:not(.hidden)');
  assert.ok(await page.locator('[data-action="mark"]').count() > 0, 'mark buttons appear for Dad');
  await shot(page, 'desktop-dad-view.png');

  // New quest from a template, for Caris only.
  await page.click('#admin-actions [data-action="new-quest"]');
  await page.waitForSelector('#quest-dialog[open]');
  await page.click('#templates [data-template="2"]'); // Full marks on a worksheet · 50
  await page.click('#q-kids [data-qkid="caius"]');    // untick Caius
  await page.fill('#q-reward', '75');
  await page.click('#due-presets [data-due="7"]');
  await shot(page, 'desktop-new-quest.png', false);
  await page.click('#quest-save');
  await page.waitForSelector('#quest-dialog:not([open])', { state: 'attached' });
  const card = page.locator('.quest', { hasText: 'Full marks on a worksheet' });
  await card.waitFor();
  assert.equal(await card.locator('.q-row').count(), 1);
  assert.match(await card.innerText(), /75/);

  // An empty quest name is refused with a message.
  await page.click('#admin-actions [data-action="new-quest"]');
  await page.fill('#q-title', '   ');
  await page.click('#quest-save');
  assert.match(await text(page, '#quest-errors'), /Give the quest a name/);
  await page.click('#quest-dialog [data-action="close-dialog"]');

  // Success → +75 for Caris.
  await card.locator('[data-status="success"]').click();
  await page.waitForFunction(() => document.querySelector('[data-balance="caris"]').textContent === '250');
  await page.locator('.toast.good', { hasText: '+75 Robux for Caris' }).waitFor();
  await shot(page, 'desktop-success-toast.png', false);
  // Undo puts it back.
  await page.locator('.toast.good', { hasText: '+75 Robux for Caris' }).locator('button', { hasText: 'Undo' }).click();
  await page.waitForFunction(() => document.querySelector('[data-balance="caris"]').textContent === '175');

  // Failed with a penalty: the late tidy-room quest (−10).
  const tidy = page.locator('.quest', { hasText: 'Tidy your room' });
  await tidy.locator('[data-status="failed"]').click();
  await page.waitForFunction(() => document.querySelector('[data-balance="caris"]').textContent === '165');

  // A daily quest rolls on once both children are marked.
  const read = page.locator('#active-list .quest', { hasText: 'Read for 30 minutes' });
  await read.locator('[data-kid="caius"][data-status="success"]').click();
  await page.waitForFunction(() => document.querySelector('[data-balance="caius"]').textContent === '75');
  await read.locator('[data-kid="caris"][data-status="success"]').click();
  await page.waitForFunction(() => Object.values(window.__ccStore.ccQuests).filter(q => q.title === 'Read for 30 minutes').length === 2);
  await page.waitForFunction(() => document.querySelector('[data-balance="caris"]').textContent === '180');

  // Pay out 50 Robux to Caius (balance 75 → 25), and a payout above the balance is refused.
  await page.click('#admin-actions [data-action="new-ledger"]');
  await page.waitForSelector('#ledger-dialog[open]');
  await page.fill('#l-amount', '500');
  await page.click('#ledger-save');
  assert.match(await text(page, '#ledger-errors'), /Only 75 Robux are available/);
  await page.fill('#l-amount', '50');
  await page.fill('#l-note', 'Roblox gift card');
  await shot(page, 'desktop-pay-out.png', false);
  await page.click('#ledger-save');
  await page.waitForFunction(() => document.querySelector('[data-balance="caius"]').textContent === '25');

  // A bonus for Caris.
  await page.click('#admin-actions [data-action="new-ledger"]');
  await page.click('#l-kids [data-lkid="caris"]');
  await page.click('#l-types [data-ltype="bonus"]');
  await page.fill('#l-amount', '20');
  await page.click('#ledger-save');
  await page.waitForFunction(() => document.querySelector('[data-balance="caris"]').textContent === '200');

  // History shows the payout, and removing it gives the Robux back.
  await page.click('#tabs [data-tab="history"]');
  const payout = page.locator('.h-row', { hasText: 'Roblox gift card' });
  await payout.waitFor();
  assert.match(await payout.innerText(), /−50/);
  await shot(page, 'desktop-dad-history.png');
  await payout.locator('[data-action="delete-ledger"]').click();
  await page.waitForSelector('#confirm-dialog[open]');
  await page.click('#confirm-yes');
  await page.waitForFunction(() => document.querySelector('[data-balance="caius"]').textContent === '75');

  // Savings goal for Caius.
  await page.click('#tabs [data-tab="stats"]');
  await page.click('[data-action="edit-goals"]');
  await page.fill('#g-label-caius', 'Dragon bundle');
  await page.fill('#g-amount-caius', '300');
  await page.click('#goals-form button[type="submit"]');
  await page.waitForSelector('[data-player="caius"] .goal:not(.hidden)');
  assert.match(await text(page, '[data-player="caius"] .goal'), /Dragon bundle · 225 Robux to go/);

  // Edit, archive and delete from the quest menu.
  await page.click('#tabs [data-tab="quests"]');
  const maths = page.locator('.quest', { hasText: 'Finish the P5 maths worksheet' });
  await maths.locator('[data-action="menu"]').click();
  await maths.locator('[data-action="edit"]').click();
  await page.fill('#q-title', 'Finish the P5 maths worksheet (both sides)');
  await page.click('#quest-save');
  await page.locator('.quest', { hasText: 'both sides' }).waitFor();
  const edited = page.locator('.quest', { hasText: 'both sides' });
  await edited.locator('[data-action="menu"]').click();
  await edited.locator('[data-action="delete"]').click();
  await page.click('#confirm-yes');
  await page.waitForFunction(() => !document.body.innerText.includes('both sides'));
  // Reset a finished result from the board.
  const swim = page.locator('.quest', { hasText: 'Swim 10 laps' });
  await swim.locator('[data-status="open"]').click();
  await page.waitForFunction(() => document.querySelector('[data-balance="caius"]').textContent === '35');
});

await run('a write without Dad\'s sign-in is refused', { width: 1280, height: 900 }, async page => {
  const before = await page.evaluate(() => JSON.stringify(window.__ccStore));
  // Even if someone calls the write path by hand, the (fake) rules refuse it.
  const refused = await page.evaluate(async () => {
    try { await window.firebase.firestore().collection('ccLedger').add({ kid: 'caius', type: 'bonus', amount: 9999 }); return false; }
    catch (e) { return e.code === 'permission-denied'; }
  });
  assert.equal(refused, true);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__ccStore)), before);
});

const PHONE = { width: 390, height: 844 };
await run('kids view (phone)', PHONE, async page => {
  assert.equal(await text(page, '[data-balance="caris"]'), '175');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, 'no sideways scrolling on a phone (' + overflow + 'px)');
  await page.waitForTimeout(600);
  await shot(page, 'phone-kids-view.png', false);
  await shot(page, 'phone-kids-full.png');
}, { isMobile: true });

await run('dad on a phone', PHONE, async page => {
  await page.click('[data-action="sign-in"]');
  await page.waitForSelector('#admin-actions:not(.hidden)');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, 'no sideways scrolling (' + overflow + 'px)');
  await page.locator('#active-list .quest').first().scrollIntoViewIfNeeded();
  await shot(page, 'phone-dad-quests.png', false);
  await page.click('#admin-actions [data-action="new-quest"]');
  await page.waitForSelector('#quest-dialog[open]');
  await shot(page, 'phone-new-quest.png', false);
  await page.click('#quest-dialog [data-action="close-dialog"]');
  await page.click('#admin-actions [data-action="new-ledger"]');
  await page.waitForSelector('#ledger-dialog[open]');
  await shot(page, 'phone-pay-out.png', false);
}, { isMobile: true });

await browser.close();
server.close();
if (failures.length) { console.log(`\n${failures.length} check(s) failed: ${failures.join(', ')}`); process.exit(1); }
console.log('\nAll /cc browser checks passed.');
