// 🧩 Sidebar layout, in a real Chromium (v1.451.0).
//
// Builds a page from index.html's own styles and the REAL sidebar markup and
// #page-navlayout, the SHIPPED bookmarks / collapsible groups / sidebar
// layout block cut out of app.js, and the real sidebar-layout-core.mjs, over
// a small in-memory Firestore (doc / onSnapshot / setDoc). Then it plays the
// admin: hides a function, adds a tab, files functions under it (by the
// "Which tab" box AND by dragging), renames, adds a link, edits their own
// menu (which changes their sidebar as they go), and saves. Then it plays a
// student signing in to that saved document, and a save arriving live while
// the student is already signed in, and an employee, who keeps the original
// menu. On a computer and on a phone.
//
//   PW=/path/to/playwright/index.mjs node tools/sidebar-layout-browser.mjs
//   NAV_LAYOUT_SCREENSHOTS=artifacts/navlayout saves a picture of each step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const CORE = fs.readFileSync(path.join(root, 'sidebar-layout-core.mjs'), 'utf8');
const SHOTS = process.env.NAV_LAYOUT_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function loadPlaywright() {
  for (const candidate of [process.env.PW, process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/npm-tools/node_modules/playwright/index.mjs', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(candidate); } catch (error) { /* next */ }
  }
  throw new Error('Playwright not found — set PW=/path/to/playwright/index.mjs');
}
const { chromium } = await loadPlaywright();

const slice = (from, to) => {
  const start = APP.indexOf(from); const end = APP.indexOf(to, start);
  assert.ok(start >= 0 && end > start, 'app.js still has ' + from);
  return APP.slice(start, end);
};
const markup = (from, to) => {
  const start = INDEX.indexOf(from); const end = INDEX.indexOf(to, start);
  assert.ok(start >= 0 && end > start, 'index.html still has ' + from);
  return INDEX.slice(start, end + to.length);
};
const styles = [...INDEX.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[0]).join('\n');
const sidebarHtml = markup('<aside class="sidebar" id="sidebar">', '</aside>');
const pageHtml = markup('<div class="page" id="page-navlayout">', '<div id="nlRoot"></div>\n      </div>\n    </div>');
const shipped = slice('function _navBmKey()', "// Every admin account's uid");
const importLine = /import \{([^}]*)\} from '\.\/sidebar-layout-core\.mjs[^']*';/.exec(APP);
assert.ok(importLine, 'app.js imports the core');

const harness = (role, seed) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${styles}
<style>body{margin:0} .app-wrapper{display:flex !important}</style></head>
<body><div id="appWrapper" class="app-wrapper">${sidebarHtml}<main class="main-content" style="flex:1;min-width:0;">${pageHtml.replace('class="page" id="page-navlayout"', 'class="page active" id="page-navlayout"')}</main></div>
<script type="module">
import {${importLine[1]}} from './sidebar-layout-core.mjs';
// ---- a small Firestore: one map of documents, live listeners --------------
const store = window.__store = new Map(Object.entries(${JSON.stringify(seed || {})}));
const listeners = [];
const db = {};
const doc = (_db, ...p) => ({ path: p.join('/') });
const snapOf = ref => ({ exists: () => store.has(ref.path), data: () => store.has(ref.path) ? JSON.parse(JSON.stringify(store.get(ref.path))) : undefined });
function onSnapshot(ref, cb) { const l = { ref, cb }; listeners.push(l); setTimeout(() => cb(snapOf(ref)), 0); return () => listeners.splice(listeners.indexOf(l), 1); }
async function setDoc(ref, data) { window.__writes = (window.__writes || 0) + 1; store.set(ref.path, JSON.parse(JSON.stringify(data))); listeners.filter(l => l.ref.path === ref.path).forEach(l => setTimeout(() => l.cb(snapOf(ref)), 0)); }
window.__push = (path, data) => { if (data == null) store.delete(path); else store.set(path, data); listeners.filter(l => l.ref.path === path).forEach(l => l.cb(snapOf(l.ref))); };
// ---- the rest of the app this block leans on ------------------------------
let currentUser = { uid: 'u-${role}', role: '${role}', email: '${role}@example.com' };
const _isAdmin = () => currentUser.role === 'admin';
const _isEmployee = () => currentUser.role === 'employee';
const EMPLOYEE_PAGES = ['create', 'bank', 'vetting', 'worksheet', 'myworksheets'];
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.__toasts = [];
const showToast = (m, kind) => window.__toasts.push(m);
const rpgHomePage = () => currentUser.role === 'admin' ? 'create' : 'home';
window.__nav = [];
function navigateTo(page) { window.__nav.push(page); }
window.navigateTo = navigateTo;
window.confirm = () => true;
${shipped}
// ---- configureSidebarForRole, the part that matters here --------------------
function signIn(role) {
  const adminItems = document.querySelectorAll('.admin-only');
  const studentItems = document.querySelectorAll('.student-only');
  if (role === 'employee') {
    studentItems.forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(el => { el.style.display = EMPLOYEE_PAGES.indexOf(el.dataset.page || '') >= 0 ? '' : 'none'; });
  } else if (role === 'admin') { adminItems.forEach(el => el.style.display = ''); studentItems.forEach(el => el.style.display = 'none'); }
  else { adminItems.forEach(el => el.style.display = 'none'); studentItems.forEach(el => el.style.display = ''); }
  // A late show, the way rpgApplyVisibility turns the game items on seconds later.
  document.querySelectorAll('.rpg-el, #navFps, #navTcg').forEach(el => { if (role !== 'employee') el.style.display = ''; });
  navLayoutInit();
  navBookmarksInit();
  navGroupsRestore(); navGroupsWatch();
}
signIn('${role}');
window.__customAtInit = !!document.querySelector('details.nav-group-custom');
if ('${role}' === 'admin') nlOpen();
Object.assign(window, { navLayoutBlocks, nlRender, navLayoutApply, navBookmarksRender, _nl, signIn,
  lateShow: () => document.querySelectorAll('.nav-item').forEach(el => { el.style.display = ''; }) });
window.__ready = true;
</script></body></html>`;

const ORIGIN = 'http://cer.test';
async function open(browser, role, seed, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });   // the logo and fonts are not served here
  await page.route(ORIGIN + '/**', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/sidebar-layout-core.mjs') return route.fulfill({ status: 200, contentType: 'text/javascript', body: CORE });
    if (u.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: harness(role, seed) });
    if (u.pathname.startsWith('/assets/')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(50);
  return { page, ctx, errors };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); };
// What a sidebar shows, as the eye reads it: top-level lines and tab lines.
const sidebarText = page => page.evaluate(() => {
  const vis = el => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
  const words = el => { const c = el.cloneNode(true); c.querySelectorAll('.ico, svg, .badge, .nav-star, .nav-beta, .nav-link-out, .nav-tcg-sub').forEach(n => n.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
  const out = [];
  for (const el of document.querySelectorAll('.sidebar-nav > .nav-item, .sidebar-nav > details.nav-group, .sidebar-nav > #consultLogBtn')) {
    if (!vis(el)) continue;
    if (el.matches('details')) {
      out.push('# ' + el.querySelector('.nav-group-label').textContent.trim());
      el.open = true;
      el.querySelectorAll('.nav-group-body > .nav-item, .nav-group-body > .nav-tcg-wrap > .nav-item').forEach(i => { if (vis(i)) out.push('  ' + words(i)); });
    } else out.push(words(el));
  }
  return out;
});
const rowOf = (page, label) => page.locator('#nlRoot .nl-row').filter({ has: page.locator(`input[value="${label}"], .nl-label-fixed:text-is("${label}")`) }).first();
// A real mouse drag: press on the source, move in steps, release on the
// target. The window is first made as tall as the page, so nothing scrolls
// between picking up and dropping (Playwright's dragTo scrolls the TARGET into
// view after the press, and Chromium then picks up whatever is under the
// pointer).
async function drag(page, source, target, targetPos) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const vp = page.viewportSize();
  if (h > vp.height) await page.setViewportSize({ width: vp.width, height: Math.min(h + 40, 12000) });
  await page.evaluate(() => window.scrollTo(0, 0));
  const a = await source.boundingBox(), b = await target.boundingBox();
  const tx = b.x + (targetPos ? targetPos.x : b.width / 2), ty = b.y + (targetPos ? targetPos.y : b.height / 2);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 6, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.mouse.up();
  await page.setViewportSize(vp);
}
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const browser = await chromium.launch();
let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
try {
  // =================================================== the admin edits ======
  const A = await open(browser, 'admin', {});
  const a = A.page;
  ok(await a.locator('#nlRoot .nl-seg button.on').textContent().then(t => t.includes('Students')), 'the students\' menu is edited first');
  let pv = await a.locator('#nlRoot .nl-pv').innerText();
  ok(pv.includes('Quick Practice') && pv.includes('Revision Cards') && pv.includes('Home'), 'the preview is the students\' menu');
  ok(!pv.includes('Create Question') && !pv.includes('Photo Editor') && !pv.includes('Sidebar Layout'), 'no admin function is on the students\' menu');
  ok(await a.locator('#nlRoot .nl-group[data-nl-ref="g:questions"]').count() === 0, 'no admin-only tab is offered for students');
  await shot(a, '01-admin-editor');

  // Hide Flashcards.
  await rowOf(a, 'Revision Cards').locator('[data-nl-act="hide"]').click();
  ok(await rowOf(a, 'Revision Cards').evaluate(el => el.classList.contains('is-hidden')), 'a hidden function is shown struck through');
  pv = await a.locator('#nlRoot .nl-pv').innerText();
  ok(!pv.includes('Revision Cards'), 'and is gone from the preview');
  ok(await a.locator('#nlRoot .nl-savebar').evaluate(el => el.classList.contains('is-dirty')), 'the save bar says there is something to save');
  ok(await a.evaluate(() => window.__writes || 0) === 0, 'nothing is written before Save');

  // A new tab.
  await a.click('#nlRoot [data-nl-act="addgroup"]');
  await a.fill('#nlFormIcon', '⭐');
  await a.fill('#nlFormLabel', 'Weekly Review');
  await a.click('#nlRoot [data-nl-act="formok"]');
  const rev = a.locator('#nlRoot .nl-group.is-custom');
  ok(await rev.count() === 1, 'the new tab is there');
  ok(await rev.locator('.nl-empty').count() === 1, 'empty, and says how to fill it');
  const revRef = await rev.getAttribute('data-nl-ref');
  // File Science PSLE under it with the "Which tab" box.
  await rowOf(a, 'Science PSLE').locator('select[data-nl-input="move"]').selectOption(revRef.slice(2));
  ok(await rev.locator('.nl-row').count() === 1, 'the function moved into the tab');
  // …and Textbooks by dragging it onto the tab's head.
  await drag(a, rowOf(a, 'Textbooks & Syllabus').locator('.nl-grip'), rev.locator('.nl-group-head .nl-count'));
  ok(await rev.locator('.nl-row').count() === 2, 'a function can be dragged into a tab');
  const inRev = await rev.locator('.nl-row input[data-nl-input="label"]').evaluateAll(els => els.map(e => e.value));
  ok(inRev[1] === 'Textbooks & Syllabus', 'and lands at its end: ' + inRev.join(' | '));
  // Drag the tab up above Syllabus & Papers.
  await drag(a, rev.locator('.nl-group-head > .nl-grip'), a.locator('#nlRoot .nl-group[data-nl-ref="g:papers"] .nl-group-head'), { x: 20, y: 4 });
  const order = await a.$$eval('#nlRoot .nl-top > [data-nl-ref]', els => els.map(e => e.getAttribute('data-nl-ref')));
  ok(order.indexOf(revRef) < order.indexOf('g:papers'), 'a tab can be dragged among the tabs: ' + order.join(' '));
  // Rename Quick Practice.
  const qp = rowOf(a, 'Quick Practice').locator('input[data-nl-input="label"]');
  await qp.fill('Practice now');
  await qp.blur();
  ok((await a.locator('#nlRoot .nl-pv').innerText()).includes('Practice now'), 'a rename shows in the preview');
  ok((await rowOf(a, 'Practice now').locator('input[data-nl-input="label"]').getAttribute('title')).includes('originally “Quick Practice”'), 'and the row says what it was called');
  // A link, refused first.
  await a.click('#nlRoot [data-nl-act="addlink"]');
  await a.fill('#nlFormLabel', 'Class Drive');
  await a.fill('#nlFormUrl', 'javascript:alert(1)');
  await a.click('#nlRoot [data-nl-act="formok"]');
  ok((await a.locator('#nlRoot .nl-form-err').innerText()).includes('web link'), 'a javascript: address is refused');
  await a.fill('#nlFormUrl', 'drive.google.com/class');
  await a.selectOption('#nlFormWhere', revRef.slice(2));
  await a.click('#nlRoot [data-nl-act="formok"]');
  ok(await rev.locator('.nl-row .nl-tag-link').count() === 1, 'the link is in the tab');
  // The lock is on by default.
  ok(await a.locator('#nlRoot input[data-nl-input="lock"]').isChecked(), 'hidden pages are switched off by default');
  await shot(a, '02-admin-students-edited');
  ok(await noSideScroll(a), 'the editor fits the screen');

  // ---- the admin's own menu: it changes as they edit ----
  const before = await sidebarText(a);
  ok(before.includes('# Questions') && before.some(l => l.includes('Photo Editor')), 'the admin\'s sidebar starts as index.html has it');
  await a.click('#nlRoot [data-nl-aud="admin"]');
  ok((await a.locator('#nlRoot .nl-pv').innerText()).includes('Create Question'), 'the admin menu holds the admin\'s functions');
  ok(await rowOf(a, 'Sidebar Layout').locator('[data-nl-act="hide"]').count() === 0 && await rowOf(a, 'Sidebar Layout').locator('.nl-eye[disabled]').count() === 1, 'the editor\'s own door cannot be hidden');
  await rowOf(a, 'Photo Editor').locator('[data-nl-act="hide"]').click();
  ok(!(await sidebarText(a)).some(l => l.includes('Photo Editor')), 'hiding on the admin menu changes the admin\'s sidebar at once');
  await a.locator('#nlRoot .nl-group[data-nl-ref="g:tools"] .nl-group-head [data-nl-act="hide"]').click();
  let side = await sidebarText(a);
  ok(!side.includes('# Tools & Settings'), 'a hidden tab leaves the sidebar');
  ok(side.includes('Sidebar Layout'), 'but Sidebar Layout moves to the top level rather than vanish: ' + side.join(' | '));
  await a.locator('#nlRoot .nl-group[data-nl-ref="g:tools"] .nl-group-head [data-nl-act="hide"]').click();
  // Rename the admin's Games tab.
  const games = a.locator('#nlRoot .nl-group[data-nl-ref="g:games"] input[data-nl-input="glabel"]');
  await games.fill('Play');
  await games.blur();
  side = await sidebarText(a);
  ok(side.includes('# Play') && !side.includes('# Games'), 'renaming a tab renames it on the sidebar');
  await shot(a, '03-admin-own-menu');

  // ---- save ----
  await a.click('#nlRoot [data-nl-act="save"]');
  await a.waitForFunction(() => window.__store.has('config/sidebarLayout'));
  await a.waitForTimeout(50);
  const saved = await a.evaluate(() => window.__store.get('config/sidebarLayout'));
  ok(saved.version === 1 && saved.updatedBy === 'admin@example.com' && saved.updatedAt, 'the save says who and when');
  ok(saved.student.hidden.includes('i:page:flashcards@student'), 'the students\' hidden function is saved');
  ok(saved.admin.hidden.includes('i:fn:openMarkingSettings@admin') === false && saved.admin.hidden.includes('i:page:photoedit@admin'), 'the admin\'s hidden function is saved, nothing else');
  ok(Object.values(saved.student.links).some(k => k.url === 'https://drive.google.com/class'), 'the link is saved with a clean address');
  ok(!(await a.locator('#nlRoot .nl-savebar').evaluate(el => el.classList.contains('is-dirty'))), 'after saving there is nothing left to save');
  ok((await a.evaluate(() => window.__toasts.join('|'))).includes('Saved'), 'the admin is told it went out');
  ok(A.errors.length === 0, 'no errors on the admin page: ' + A.errors.join(' / '));
  await shot(a, '04-admin-saved');

  // ---- phone ----
  await a.setViewportSize({ width: 390, height: 844 });
  await a.evaluate(() => window.nlRender());
  await a.waitForTimeout(150);   // let the phone layout settle after the resize
  ok(await noSideScroll(a), 'the editor fits a phone');
  const wide = await a.evaluate(() => [...document.querySelectorAll('#nlRoot *')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().right > window.innerWidth + 1).map(e => e.tagName + '.' + e.className));
  ok(wide.length === 0, 'nothing in the editor runs off a phone\'s screen: ' + wide.slice(0, 6).join(', '));
  await shot(a, '05-admin-phone');
  await A.ctx.close();

  // =================================================== a student signs in ======
  const S = await open(browser, 'student', { 'config/sidebarLayout': saved });
  const s = S.page;
  await s.waitForTimeout(80);
  let st = await sidebarText(s);
  ok(!st.some(l => l.includes('Revision Cards')), 'the student does not see the hidden function: ' + st.join(' | '));
  ok(st.includes('# Weekly Review'), 'the new tab is on the student\'s menu');
  const revAt = st.indexOf('# Weekly Review');
  ok(st[revAt + 1] === '  Science PSLE' && st[revAt + 2] === '  Textbooks & Syllabus' && st[revAt + 3] === '  Class Drive', 'with the functions filed under it, in order: ' + st.slice(revAt, revAt + 4).join(' | '));
  ok(st.indexOf('# Weekly Review') < st.indexOf('# Papers & Worksheets'), 'in the place the admin dragged it to');
  ok(st.includes('  Practice now') && !st.includes('  Quick Practice'), 'the rename reached the student');
  ok(!st.some(l => /Create Question|Photo Editor|Sidebar Layout/.test(l)), 'no admin function reaches a student');
  ok(st.includes('# Games') && !st.includes('# Play'), 'the admin\'s own renames stay on the admin\'s menu');
  const link = await s.locator('a.nav-link-custom').first();
  ok(await link.getAttribute('href') === 'https://drive.google.com/class' && await link.getAttribute('target') === '_blank' && (await link.getAttribute('rel')).includes('noopener'), 'the link opens safely in a new tab');
  ok(await s.evaluate(() => navLayoutBlocks('flashcards')) === true, 'the hidden page is switched off for the student');
  ok(await s.evaluate(() => navLayoutBlocks('home') || navLayoutBlocks('psle') || navLayoutBlocks('community')) === false, 'Home and the moved pages are not');
  // A late show (rpgApplyVisibility, the TCG and Strike doors) cannot bring a hidden item back.
  await s.evaluate(() => window.lateShow());
  await s.waitForTimeout(40);
  ok(await s.locator('.nav-item[data-page="flashcards"]').evaluate(el => getComputedStyle(el).display) === 'none', 'a late inline show cannot undo a hide');
  // A bookmark of a hidden item does not come back through the ⭐ band.
  await s.evaluate(() => { localStorage.setItem('navBookmarks:u-student', JSON.stringify(['flashcards', 'psle'])); navBookmarksRender(); });
  const bm = await s.locator('#navBookmarksList .nav-item').allInnerTexts();
  ok(bm.length === 1 && bm[0].includes('Science PSLE'), 'a bookmark cannot resurrect a hidden item: ' + bm.join(' | '));
  await shot(s, '06-student-menu');

  // ---- the admin saves again while the student is signed in ----
  await s.evaluate(() => window.__push('config/sidebarLayout', { version: 1, student: { hidden: ['i:page:psle'] }, admin: {} }));
  await s.waitForTimeout(60);
  st = await sidebarText(s);
  ok(!st.includes('# Weekly Review') && await s.locator('a.nav-link-custom').count() === 0, 'a live save takes the old tab and link away');
  ok(st.some(l => l.includes('Revision Cards')) && st.some(l => l.includes('Quick Practice')), 'and puts the original names and functions back');
  ok(!st.some(l => l.includes('Science PSLE')), 'and hides what the new save hides');
  ok(await s.evaluate(() => navLayoutBlocks('flashcards')) === false && await s.evaluate(() => navLayoutBlocks('psle')) === true, 'the switched-off pages follow the live save');
  ok(await s.locator('details.nav-group-custom').count() === 0, 'no empty custom tab is left behind');
  // …and the original menu once the layout is deleted.
  await s.evaluate(() => window.__push('config/sidebarLayout', null));
  await s.waitForTimeout(40);
  ok((await sidebarText(s)).some(l => l.includes('Science PSLE')), 'no document means index.html\'s menu');
  ok(await noSideScroll(s), 'the student page fits');
  ok(S.errors.length === 0, 'no errors on the student page: ' + S.errors.join(' / '));
  await S.ctx.close();

  // =================================================== an employee ======
  const E = await open(browser, 'employee', { 'config/sidebarLayout': saved });
  const e = E.page;
  await e.waitForTimeout(60);
  const et = await sidebarText(e);
  ok(!et.some(l => /Weekly Review|Class Drive|Play/.test(l)), 'an employee keeps the original menu: ' + et.join(' | '));
  ok(et.some(l => l.includes('Create Question')), 'with their own pages');
  ok(await e.evaluate(() => navLayoutBlocks('flashcards')) === false, 'and nothing is switched off by a layout for them');
  ok(E.errors.length === 0, 'no errors on the employee page: ' + E.errors.join(' / '));
  await E.ctx.close();

  // =================================================== a cached layout, offline ======
  const C = await open(browser, 'student', {});
  await C.page.evaluate(saved => { localStorage.setItem('navLayout:v1', JSON.stringify(saved)); }, saved);
  await C.page.reload();
  await C.page.waitForFunction(() => window.__ready === true);
  // Before the (empty) live document lands, the cached layout is what shows.
  const cachedFirst = await C.page.evaluate(() => window.__customAtInit);
  ok(cachedFirst, 'the last layout this device saw is applied at once, with no flash of the full menu');
  await C.ctx.close();
} finally {
  await browser.close();
}
console.log(`✓ ${pass} sidebar-layout browser checks passed`);
