// Collapsible sidebar groups (v1.409.0). Every failure here is silent and the
// sidebar still paints: a game left OUTSIDE the 🎮 Games group is the mess this
// was asked to end; a bookmark selector still written as a DIRECT child of
// .sidebar-nav finds nothing once the items sit inside a group, so every star
// vanishes and every bookmark band empties; an empty group that keeps its head
// is a heading standing over nothing; and a navigateTo that stops revealing the
// group leaves the active page behind a closed head.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('✗ ' + name); } }

// ---- the markup ----------------------------------------------------------
const navStart = html.indexOf('<nav class="sidebar-nav">');
const nav = html.slice(navStart, html.indexOf('</nav>', navStart));
ok('the sidebar exists', navStart > 0);
// Which group each nav item sits in, by walking the <details> blocks.
const groups = {};
const detailsRe = /<details class="nav-group[^"]*" data-group="([^"]+)"([^>]*)>([\s\S]*?)<\/details>/g;
let m;
while ((m = detailsRe.exec(nav))) groups[m[1]] = { attrs: m[2], body: m[3] };
const inGroup = (needle, gid) => !!groups[gid] && groups[gid].body.includes(needle);
const GAMES = ['data-page="character"', 'data-page="leaderboard"', 'data-page="adventure"', 'data-page="arcade"',
  'data-page="hades"', 'data-page="pirate-rift"', 'data-page="grand-line"', 'id="navTcgWrap"', 'id="navTcgHome"',
  'id="navFps"', 'data-page="gameassets"', 'id="rpgHideToggle"'];
for (const g of GAMES) ok('🎮 Games holds ' + g, inGroup(g, 'games'));
const QUESTIONS = ['create', 'bank', 'vetting', 'checkq', 'flagged', 'doctor', 'ansreview', 'answerkeys', 'mistakebank', 'scheduled'];
for (const q of QUESTIONS) ok('✏️ Questions holds ' + q, inGroup('data-page="' + q + '"', 'questions'));
ok('the Questions group is admin-only', /<details class="nav-group admin-only" data-group="questions"/.test(nav));
ok('the Games group is open to every role', /<details class="nav-group" data-group="games"/.test(nav));
// Every page item is either a top-level landing item or inside a group.
const TOP = new Set(['home', 'community']);
const itemRe = /<div class="nav-item[^"]*" (?:id="[^"]+" )?data-page="([^"]+)"/g;
const allPages = new Set();
while ((m = itemRe.exec(nav))) allPages.add(m[1]);
for (const p of allPages) {
  const inside = Object.keys(groups).some(g => groups[g].body.includes('data-page="' + p + '"'));
  ok('nav item ' + p + ' is top-level or grouped', TOP.has(p) || inside);
}
ok('no flat section label survives in the sidebar', !/nav-section-label/.test(nav));
ok('groups are closed by default except the student Practice group',
  !/<details class="nav-group[^>]*\sopen[\s>]/.test(nav) && /data-group="practice" data-default-open="1"/.test(nav)
  && Object.keys(groups).filter(g => groups[g].attrs.includes('data-default-open')).length === 1);
ok('every group has a head with a label, a badge and a chevron',
  Object.keys(groups).every(g => /<summary class="nav-group-head">/.test(nav.split('data-group="' + g + '"')[1].split('</summary>')[0])
    && groups[g].body.length > 0)
  && (nav.match(/nav-group-badge/g) || []).length === Object.keys(groups).length
  && (nav.match(/nav-group-chev/g) || []).length === Object.keys(groups).length);
ok('the Realm of Embers door is parked at its anchor inside Games',
  groups.games.body.indexOf('id="navTcgHome"') < groups.games.body.indexOf('id="navTcgWrap"'));
// Nav items the other harnesses pin by their exact class strings are untouched.
ok('item markup is unchanged', /class="nav-item admin-only" data-page="custompaper"/.test(nav)
  && /class="nav-item" data-page="hades"/.test(nav) && /class="nav-item student-only" data-page="mistakes"/.test(nav));

// ---- the CSS ---------------------------------------------------------------
ok('an empty group is hidden by CLASS, with !important, never by inline style', /\.nav-group\.nav-group-empty\s*\{\s*display:\s*none\s*!important;/.test(html));
ok('a flattened group hides its head', /\.nav-group\.nav-flat > \.nav-group-head\s*\{\s*display:\s*none;/.test(html));
ok('the native marker is removed', /\.nav-group-head::-webkit-details-marker\s*\{\s*display:\s*none;/.test(html));
ok('a collapsed group holding the active page is marked', /\.nav-group\.has-active:not\(\[open\]\) > \.nav-group-head/.test(html));

// ---- the JS ----------------------------------------------------------------
ok('no bookmark selector still asks for a DIRECT child of .sidebar-nav', !/\.sidebar-nav > \.nav-item/.test(js));
ok('_navOriginals excludes the bookmark band', /function _navOriginals\(\)[\s\S]{0,200}#navBookmarksList/.test(js));
const cfg = js.slice(js.indexOf('function configureSidebarForRole('), js.indexOf('// SIDEBAR BOOKMARKS'));
ok('configureSidebarForRole restores the groups on BOTH the employee and the admin/student path', (cfg.match(/navGroupsRestore\(\)/g) || []).length === 2 && (cfg.match(/navGroupsWatch\(\)/g) || []).length === 2);
const navTo = js.slice(js.indexOf('function navigateTo(page)'), js.indexOf('function navigateTo(page)') + 6000);
ok('navigateTo opens the group around the page it lit up', /navItem\.classList\.add\('active'\);\s*\n\s*try \{ navGroupReveal\(navItem\); navGroupsSync\(\); \}/.test(navTo));
ok('the toggle listener is bound in CAPTURE (toggle does not bubble)', /addEventListener\('toggle', ev => \{[\s\S]*?\}, true\);/.test(js));
ok('a flattened group never records its forced open state', /if \(g\.classList\.contains\('nav-flat'\)\) return;/.test(js));
ok('the observer ignores its own writes', /if \(!records\.some\(r => !_navGroupsOwnMutation\(r\)\)\) return;/.test(js));
ok('the bank count is not summed onto a head', /NAV_GROUP_BADGE_SKIP = \['bankCount'\]/.test(js));
const place = js.slice(js.indexOf('function _tcgPlaceNavItem()'), js.indexOf('function _tcgPlaceNavItem()') + 400);
ok('the Realm of Embers door is no longer moved out of the Games group for a student', !/community/.test(place) && /home\.insertAdjacentElement\('afterend', wrap\)/.test(place));

// ---- navGroupsSync against a small fake DOM ---------------------------------
const secStart = js.indexOf('function _navOriginals()');
const secEnd = js.indexOf('function navGroupsWatch()', secStart);
const section = js.slice(secStart, secEnd);
function el(tag, attrs = {}) {
  const node = {
    tag, id: attrs.id || '', _cls: new Set((attrs.cls || '').split(/\s+/).filter(Boolean)), dataset: attrs.dataset || {},
    style: { display: attrs.display || '' }, children: [], parent: null, open: false, textContent: attrs.text || '',
    get classList() {
      const s = this._cls;
      return { contains: c => s.has(c), toggle: (c, f) => { if (f === undefined) f = !s.has(c); f ? s.add(c) : s.delete(c); return f; } };
    },
    append(...kids) { kids.forEach(k => { k.parent = this; this.children.push(k); }); return this; },
    descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); },
    querySelectorAll(sel) {
      if (sel === '.nav-item') return this.descendants().filter(n => n._cls.has('nav-item'));
      if (sel === '.badge') return this.descendants().filter(n => n._cls.has('badge'));
      if (sel === '.sidebar-nav details.nav-group') return this.descendants().filter(n => n.tag === 'details' && n._cls.has('nav-group'));
      if (sel === '.sidebar-nav .nav-item') return this.descendants().filter(n => n._cls.has('nav-item'));
      throw new Error('unexpected selector ' + sel);
    },
    querySelector(sel) {
      if (sel === ':scope > summary .nav-group-badge') { const s = this.children.find(c => c.tag === 'summary'); return s ? s.descendants().find(n => n._cls.has('nav-group-badge')) || null : null; }
      throw new Error('unexpected selector ' + sel);
    },
    closest(sel) { let n = this; while (n) { if (sel === '#navBookmarksList' ? n.id === 'navBookmarksList' : sel === 'details.nav-group' ? (n.tag === 'details' && n._cls.has('nav-group')) : false) return n; n = n.parent; } return null; },
    getAttribute(a) { return a === 'data-page' ? (this.dataset.page || null) : null; },
    hasAttribute(a) { return a === 'data-page' ? !!this.dataset.page : false; },
  };
  return node;
}
function build() {
  const doc = el('div');
  const mk = (gid, items, opts = {}) => {
    const badge = el('span', { cls: 'badge nav-group-badge', display: 'none', text: '0' });
    const g = el('details', { cls: 'nav-group', dataset: { group: gid, defaultOpen: opts.defaultOpen } });
    g.append(el('summary', { cls: 'nav-group-head' }).append(badge), el('div', { cls: 'nav-group-body' }).append(...items));
    return g;
  };
  const vet = el('div', { cls: 'nav-item', dataset: { page: 'vetting' } }).append(el('span', { cls: 'badge', id: 'vettingCount', text: '7' }));
  const bank = el('div', { cls: 'nav-item', dataset: { page: 'bank' } }).append(el('span', { cls: 'badge', id: 'bankCount', text: '3,412' }));
  const flagged = el('div', { cls: 'nav-item', dataset: { page: 'flagged' }, display: 'none' }).append(el('span', { cls: 'badge', id: 'flaggedCount', text: '5' }));
  const questions = mk('questions', [vet, bank, flagged]);
  const games = mk('games', [el('div', { cls: 'nav-item', dataset: { page: 'character' }, display: 'none' }), el('div', { cls: 'nav-item', dataset: { page: 'arcade' }, display: 'none' })]);
  const practice = mk('practice', [el('div', { cls: 'nav-item active', dataset: { page: 'quickpractice' } })], { defaultOpen: '1' });
  doc.append(questions, games, practice);
  return { doc, questions, games, practice, bank };
}
let storage = {};
function run(employee, savedJson) {
  const t = build();
  storage = savedJson ? { 'navGroups:u1': savedJson } : {};
  const ctx = {
    document: { querySelectorAll: s => t.doc.querySelectorAll(s), querySelector: () => null },
    localStorage: { getItem: k => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; } },
    currentUser: { uid: 'u1' }, _isEmployee: () => employee, requestAnimationFrame: () => 0, MutationObserver: undefined,
  };
  const fn = new Function(...Object.keys(ctx), section + '\nreturn { navGroupsRestore, navGroupsSync, navGroupReveal, _navOriginals };');
  const api = fn(...Object.values(ctx));
  return { ...t, api };
}
{
  const t = run(false, null);
  t.api.navGroupsRestore();
  ok('a group with every item hidden is marked empty', t.games.classList.contains('nav-group-empty'));
  ok('a group with a visible item is not', !t.questions.classList.contains('nav-group-empty'));
  ok('the badge on the head sums only VISIBLE badges and skips the bank count', t.questions.querySelector(':scope > summary .nav-group-badge').textContent === '7');
  ok('the head badge is shown when there is something to see', t.questions.querySelector(':scope > summary .nav-group-badge').style.display === '');
  ok('a group is closed by default', t.questions.open === false && t.games.open === false);
  ok('the default-open group is open', t.practice.open === true);
  ok('the group holding the active page is marked', t.practice.classList.contains('has-active'));
  ok('nothing is flattened for an admin', !t.questions.classList.contains('nav-flat'));
}
{
  const t = run(false, JSON.stringify({ questions: true, practice: false }));
  t.api.navGroupsRestore();
  ok('a remembered open state is restored', t.questions.open === true);
  ok('a remembered closed state beats the default', t.practice.open === true /* holds the ACTIVE page, so it is revealed regardless */);
  const t2 = run(false, JSON.stringify({ practice: false }));
  t2.practice.children[1].children[0]._cls.delete('active');
  t2.api.navGroupsRestore();
  ok('…and is honoured when the active page is elsewhere', t2.practice.open === false);
}
{
  const t = run(true, null);
  t.api.navGroupsRestore();
  ok('an employee gets flattened groups, forced open', t.questions.classList.contains('nav-flat') && t.questions.open === true);
  ok('a malformed store is treated as empty', (() => { storage = { 'navGroups:u1': '[1,2]' }; const u = run(false, '[1,2]'); u.api.navGroupsRestore(); return u.questions.open === false; })());
}

console.log(fail ? `✗ ${fail} failed, ${pass} passed` : `✓ ${pass}/${pass} nav-group checks passed`);
process.exit(fail ? 1 : 0);
