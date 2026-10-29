// 🧩 Sidebar layout — the pure half (v1.451.0). See CLAUDE.md → "Sidebar layout".
//
// The admin decides what the left menu holds, for two audiences: the students'
// menu and the admin's own. A layout says, per audience, which tabs (groups)
// exist and in what order, which functions (nav items) sit in which tab, which
// are hidden, what anything is renamed to, and any extra link tabs. It is ONE
// document, `config/sidebarLayout`, read by every signed-in student, so a save
// reaches every account at once.
//
// Nothing in here touches the DOM, Firebase or the clock. The app builds an
// INVENTORY of what the sidebar really holds (from index.html's markup, once,
// before anything is moved), and this module turns inventory + layout into a
// PLAN: the exact order of every container and what is hidden. The editor's
// operations are pure functions over a layout, too, so every one of them is
// tested in tools/sidebar-layout-tests.mjs without a browser.
//
// References. A top-level entry or a tab's entry is a REF string:
//   'g:<groupId>'  a tab (only ever at top level — tabs never nest)
//   'i:<itemKey>'  a function that ships in index.html (key from the app)
//   'l:<linkId>'   a link tab the admin added
// An item the layout does not mention goes where index.html puts it, which is
// what lets a future release add a nav item without anyone re-saving.

export const NAV_LAYOUT_VERSION = 1;
export const NAV_LAYOUT_AUDIENCES = ['student', 'admin'];
export const NAV_LAYOUT_TOP = '__top__';
export const NAV_LAYOUT_LIMITS = Object.freeze({ groups: 24, links: 30, label: 40, icon: 8, url: 500, refs: 400 });
// Items that may be moved and renamed but never hidden, per audience: the door
// back into this editor must always be on the admin's menu.
export const NAV_LAYOUT_LOCKED = Object.freeze({ admin: ['page:navlayout@admin'], student: [] });
// Pages a hidden item never switches off. A child must always have somewhere
// to land, and Home / Community are where every bounce goes.
export const NAV_LAYOUT_NEVER_BLOCK = Object.freeze(['home', 'community']);

const GROUP_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const CUSTOM_ID_RE = /^c-[a-z0-9]{3,16}$/;
const LINK_ID_RE = /^[a-z0-9]{3,16}$/;
const ITEM_KEY_RE = /^[A-Za-z0-9:@_-]{1,80}$/;

const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- cleaning ------------------------------------------------------------

// Plain text only: control characters out, whitespace collapsed, cut by code
// point (never through the middle of an emoji's surrogate pair). The zero-width
// JOINER stays: it is what holds a family or a profession emoji together.
export function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  const cps = Array.from(s);
  return (cps.length > max ? cps.slice(0, max).join('') : s).trim();
}
// An icon is a short piece of text — an emoji, a symbol, a letter or two.
// Joined emoji (a family, a flag) are several code points, hence 8.
export function cleanIcon(v) {
  const s = cleanText(v, NAV_LAYOUT_LIMITS.icon).replace(/\s+/g, '');
  return s;
}
// Only http(s). Anything else — javascript:, data:, a relative path — is no
// link at all, because a link tab is rendered as a real <a href>.
export function cleanUrl(v) {
  if (typeof v !== 'string') return '';
  let s = v.trim();
  if (!s || s.length > NAV_LAYOUT_LIMITS.url) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (_) { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  if (!u.hostname || u.username || u.password) return '';
  return u.href;
}
export function refType(ref) { return typeof ref === 'string' && /^[gil]:/.test(ref) ? ref[0] : ''; }
export function refId(ref) { return typeof ref === 'string' ? ref.slice(2) : ''; }
function validRef(ref) {
  const t = refType(ref), id = refId(ref);
  if (t === 'g') return GROUP_ID_RE.test(id);
  if (t === 'i') return ITEM_KEY_RE.test(id);
  if (t === 'l') return LINK_ID_RE.test(id);
  return false;
}
function cleanRefs(list, allow) {
  const out = [], seen = new Set();
  if (!Array.isArray(list)) return out;
  for (const r of list) {
    if (out.length >= NAV_LAYOUT_LIMITS.refs) break;
    if (!validRef(r) || seen.has(r) || (allow && !allow.includes(refType(r)))) continue;
    seen.add(r); out.push(r);
  }
  return out;
}

// ---- the layout ------------------------------------------------------------

export function emptyAudienceLayout() {
  return { top: [], groups: {}, hidden: [], labels: {}, links: {}, lockHidden: true };
}
export function emptyLayout() {
  return { version: NAV_LAYOUT_VERSION, student: emptyAudienceLayout(), admin: emptyAudienceLayout(), updatedAt: '', updatedBy: '' };
}
export function isEmptyAudienceLayout(L) {
  const n = normalizeAudienceLayout(L);
  return !n.top.length && !Object.keys(n.groups).length && !n.hidden.length && !Object.keys(n.labels).length && !Object.keys(n.links).length;
}

// Whatever arrives (an old document, a hand-edited one, the open catch-all's
// worst) comes out as a well-formed layout. Nothing here throws.
export function normalizeAudienceLayout(raw) {
  const L = emptyAudienceLayout();
  if (!isObj(raw)) return L;
  L.top = cleanRefs(raw.top);
  let customCount = 0;
  if (isObj(raw.groups)) {
    for (const id of Object.keys(raw.groups)) {
      if (!GROUP_ID_RE.test(id)) continue;
      const g = raw.groups[id];
      if (!isObj(g)) continue;
      const custom = CUSTOM_ID_RE.test(id) && g.custom === true;
      if (custom && ++customCount > NAV_LAYOUT_LIMITS.groups) continue;
      const out = { items: cleanRefs(g.items, ['i', 'l']) };
      const label = cleanText(g.label, NAV_LAYOUT_LIMITS.label);
      const icon = cleanIcon(g.icon);
      if (label) out.label = label;
      if (icon) out.icon = icon;
      if (g.hidden === true) out.hidden = true;
      if (custom) { out.custom = true; if (!out.label) out.label = 'New tab'; }
      L.groups[id] = out;
    }
  }
  L.hidden = cleanRefs(raw.hidden, ['i', 'l']);
  if (isObj(raw.labels)) {
    for (const k of Object.keys(raw.labels)) {
      if (!ITEM_KEY_RE.test(k)) continue;
      const v = cleanText(raw.labels[k], NAV_LAYOUT_LIMITS.label);
      if (v) L.labels[k] = v;
    }
  }
  if (isObj(raw.links)) {
    let n = 0;
    for (const id of Object.keys(raw.links)) {
      if (!LINK_ID_RE.test(id)) continue;
      const k = raw.links[id];
      if (!isObj(k)) continue;
      const url = cleanUrl(k.url);
      const label = cleanText(k.label, NAV_LAYOUT_LIMITS.label);
      if (!url || !label) continue;
      if (++n > NAV_LAYOUT_LIMITS.links) break;
      L.links[id] = { label, icon: cleanIcon(k.icon) || '🔗', url };
    }
  }
  L.lockHidden = raw.lockHidden !== false;
  return L;
}
export function normalizeLayout(raw) {
  const out = emptyLayout();
  if (!isObj(raw)) return out;
  out.student = normalizeAudienceLayout(raw.student);
  out.admin = normalizeAudienceLayout(raw.admin);
  out.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt.slice(0, 40) : '';
  out.updatedBy = cleanText(raw.updatedBy, 120);
  return out;
}

// ---- the inventory -----------------------------------------------------------
//
// { groups: [{ id, label, icon, audience }],
//   items:  [{ key, label, icon, audience, group: id|null, page }],
//   top:    ['i:…' | 'g:…', …]  — the top level of index.html, in order }
// audience is 'admin' | 'student' | 'both'.
export function visibleTo(audience, x) { return !!x && (x.audience === 'both' || x.audience === audience); }
export function normalizeInventory(inv) {
  const groups = [], items = [], top = [];
  const gSeen = new Set(), iSeen = new Set();
  for (const g of (inv && Array.isArray(inv.groups) ? inv.groups : [])) {
    if (!g || !GROUP_ID_RE.test(g.id) || gSeen.has(g.id)) continue;
    gSeen.add(g.id);
    groups.push({ id: g.id, label: cleanText(g.label, 80) || g.id, icon: cleanIcon(g.icon), audience: ['admin', 'student'].includes(g.audience) ? g.audience : 'both' });
  }
  for (const it of (inv && Array.isArray(inv.items) ? inv.items : [])) {
    if (!it || !ITEM_KEY_RE.test(it.key) || iSeen.has(it.key)) continue;
    iSeen.add(it.key);
    items.push({
      key: it.key, label: cleanText(it.label, 80) || it.key, icon: cleanIcon(it.icon),
      audience: ['admin', 'student'].includes(it.audience) ? it.audience : 'both',
      group: it.group && gSeen.has(it.group) ? it.group : null,
      page: typeof it.page === 'string' ? it.page : ''
    });
  }
  for (const r of (inv && Array.isArray(inv.top) ? inv.top : [])) {
    const t = refType(r);
    if ((t === 'g' && gSeen.has(refId(r))) || (t === 'i' && iSeen.has(refId(r)))) { if (!top.includes(r)) top.push(r); }
  }
  // Anything the top list forgot still has to be somewhere.
  for (const g of groups) if (!top.includes('g:' + g.id)) top.push('g:' + g.id);
  for (const it of items) if (!it.group && !top.includes('i:' + it.key)) top.push('i:' + it.key);
  return { groups, items, top };
}

// Insert `ref` into `list` where index.html would have it: right after the
// nearest entry that comes BEFORE it in `defaults` and is already in `list`.
function insertByDefault(list, ref, defaults) {
  const at = defaults.indexOf(ref);
  for (let i = at - 1; i >= 0; i--) {
    const j = list.indexOf(defaults[i]);
    if (j >= 0) { list.splice(j + 1, 0, ref); return; }
  }
  // Nothing before it survived here: it goes before the first entry that
  // comes AFTER it by default, or at the end.
  for (let i = at + 1; i < defaults.length; i++) {
    const j = list.indexOf(defaults[i]);
    if (j >= 0) { list.splice(j, 0, ref); return; }
  }
  list.push(ref);
}

// ---- the plan ------------------------------------------------------------------
//
// Inventory + one audience's layout → exactly what that audience's menu is:
// { audience, top: [ref…], groups: { id: { id, label, icon, defaultLabel,
//   defaultIcon, hidden, custom, items: [ref…] } }, items: { key: { … } },
//   links: { id: { … } }, blockedPages: [page…], lockHidden }
// Only what this audience can see is in it.
export function planSidebar(inventory, layout, audience) {
  const inv = normalizeInventory(inventory);
  const L = normalizeAudienceLayout(layout);
  const aud = NAV_LAYOUT_AUDIENCES.includes(audience) ? audience : 'student';
  const locked = NAV_LAYOUT_LOCKED[aud] || [];

  const groups = {};
  for (const g of inv.groups) {
    if (!visibleTo(aud, g)) continue;
    const o = L.groups[g.id] || {};
    groups[g.id] = { id: g.id, label: o.label || g.label, icon: o.icon || g.icon, defaultLabel: g.label, defaultIcon: g.icon, hidden: !!o.hidden, custom: false, items: [] };
  }
  for (const id of Object.keys(L.groups)) {
    const o = L.groups[id];
    if (!o.custom || groups[id] || inv.groups.some(g => g.id === id)) continue;
    groups[id] = { id, label: o.label || 'New tab', icon: o.icon || '📁', defaultLabel: '', defaultIcon: '', hidden: !!o.hidden, custom: true, items: [] };
  }
  const items = {};
  for (const it of inv.items) {
    if (!visibleTo(aud, it)) continue;
    const defaultGroup = it.group && groups[it.group] && !groups[it.group].custom ? it.group : null;
    items[it.key] = { key: it.key, page: it.page, label: L.labels[it.key] || it.label, defaultLabel: it.label, icon: it.icon, defaultGroup, container: null, hidden: false, effectiveHidden: false, locked: locked.includes(it.key) };
  }
  const links = {};
  for (const id of Object.keys(L.links)) links[id] = { id, ...L.links[id], container: null, hidden: false, effectiveHidden: false };

  const exists = ref => {
    const t = refType(ref), id = refId(ref);
    return t === 'g' ? !!groups[id] : t === 'i' ? !!items[id] : t === 'l' ? !!links[id] : false;
  };
  const placed = new Set();
  const top = [];
  for (const r of L.top) {
    if (placed.has(r) || !exists(r)) continue;
    placed.add(r); top.push(r);
  }
  // A tab that says what it holds, in the order the layout gives…
  for (const id of Object.keys(L.groups)) {
    if (!groups[id]) continue;
    for (const r of L.groups[id].items) {
      if (placed.has(r) || !exists(r) || refType(r) === 'g') continue;
      placed.add(r); groups[id].items.push(r);
    }
  }
  // …and every tab the layout never placed goes where index.html has it.
  for (const g of inv.groups) {
    const r = 'g:' + g.id;
    if (groups[g.id] && !placed.has(r)) { insertByDefault(top, r, inv.top); placed.add(r); }
  }
  for (const id of Object.keys(groups)) {
    const r = 'g:' + id;
    if (!placed.has(r)) { top.push(r); placed.add(r); }
  }
  // Functions the layout never mentions go back to their own tab, beside the
  // function that comes before them in index.html.
  const defaultOrderOf = gid => inv.items.filter(it => it.group === gid).map(it => 'i:' + it.key);
  for (const it of inv.items) {
    const r = 'i:' + it.key;
    if (!items[it.key] || placed.has(r)) continue;
    const gid = items[it.key].defaultGroup;
    if (gid) insertByDefault(groups[gid].items, r, defaultOrderOf(gid));
    else insertByDefault(top, r, inv.top);
    placed.add(r);
  }
  // A link the layout lost track of is still a link: it goes at the end.
  for (const id of Object.keys(links)) {
    const r = 'l:' + id;
    if (!placed.has(r)) { top.push(r); placed.add(r); }
  }
  // Where everything ended up.
  for (const r of top) {
    if (refType(r) === 'i') items[refId(r)].container = null;
    if (refType(r) === 'l') links[refId(r)].container = null;
  }
  for (const id of Object.keys(groups)) {
    for (const r of groups[id].items) {
      if (refType(r) === 'i') items[refId(r)].container = id;
      if (refType(r) === 'l') links[refId(r)].container = id;
    }
  }
  // What is hidden. A hidden tab hides what is in it.
  const hidden = new Set(L.hidden);
  for (const key of Object.keys(items)) {
    const x = items[key];
    x.hidden = hidden.has('i:' + key) && !x.locked;
    if (x.locked && x.container && groups[x.container].hidden) {
      // The editor's own door can never sit inside a hidden tab: it moves to
      // the top of the menu rather than vanish with the tab.
      const g = groups[x.container];
      g.items.splice(g.items.indexOf('i:' + key), 1);
      top.push('i:' + key);
      x.container = null;
    }
    x.effectiveHidden = x.hidden || !!(x.container && groups[x.container].hidden);
  }
  for (const id of Object.keys(links)) {
    const x = links[id];
    x.hidden = hidden.has('l:' + id);
    x.effectiveHidden = x.hidden || !!(x.container && groups[x.container].hidden);
  }
  // Pages switched off for this audience: every item that opens the page is
  // hidden. Two items can share a page (the admin's and the student's Create
  // Worksheet); one visible door keeps the page open.
  const blockedPages = [];
  if (L.lockHidden) {
    const byPage = {};
    for (const key of Object.keys(items)) {
      const x = items[key];
      if (!x.page) continue;
      (byPage[x.page] = byPage[x.page] || []).push(x);
    }
    for (const page of Object.keys(byPage)) {
      if (NAV_LAYOUT_NEVER_BLOCK.includes(page)) continue;
      if (byPage[page].every(x => x.effectiveHidden)) blockedPages.push(page);
    }
  }
  return { audience: aud, top, groups, items, links, blockedPages, lockHidden: L.lockHidden };
}

// The plan written back out as a layout that names everything explicitly:
// the editor works on this, and it is what a save stores. Labels and icons
// are kept only where they differ from index.html, so a renamed default
// still follows index.html if a later release renames it.
export function materializeLayout(plan, previous) {
  const prev = normalizeAudienceLayout(previous);
  const L = emptyAudienceLayout();
  L.top = plan.top.slice();
  for (const id of Object.keys(plan.groups)) {
    const g = plan.groups[id];
    const o = { items: g.items.slice() };
    if (g.custom) { o.custom = true; o.label = g.label; o.icon = g.icon; }
    else {
      if (g.label !== g.defaultLabel) o.label = g.label;
      if (g.icon !== g.defaultIcon) o.icon = g.icon;
    }
    if (g.hidden) o.hidden = true;
    L.groups[id] = o;
  }
  for (const key of Object.keys(plan.items)) {
    const x = plan.items[key];
    if (x.hidden) L.hidden.push('i:' + key);
    if (x.label !== x.defaultLabel) L.labels[key] = x.label;
  }
  for (const id of Object.keys(plan.links)) {
    const x = plan.links[id];
    L.links[id] = { label: x.label, icon: x.icon, url: x.url };
    if (x.hidden) L.hidden.push('l:' + id);
  }
  // Groups and labels that belong to items this audience never sees are kept
  // as they were, so editing one menu never wipes a note left on the other.
  for (const id of Object.keys(prev.groups)) if (!L.groups[id] && !prev.groups[id].custom) L.groups[id] = prev.groups[id];
  L.lockHidden = plan.lockHidden;
  return normalizeAudienceLayout(L);
}

// Plan + materialize in one: the canonical form of a layout for an audience.
export function canonicalLayout(inventory, layout, audience) {
  return materializeLayout(planSidebar(inventory, layout, audience), layout);
}

// ---- the editor's operations -----------------------------------------------------
// Every one takes a layout and returns a NEW layout (the input is never
// changed). Run the result through canonicalLayout before showing it.

function clone(L) { return normalizeAudienceLayout(JSON.parse(JSON.stringify(normalizeAudienceLayout(L)))); }

export function layoutLocate(layout, ref) {
  const L = normalizeAudienceLayout(layout);
  let i = L.top.indexOf(ref);
  if (i >= 0) return { container: NAV_LAYOUT_TOP, index: i };
  for (const id of Object.keys(L.groups)) {
    i = L.groups[id].items.indexOf(ref);
    if (i >= 0) return { container: id, index: i };
  }
  return null;
}
function listOf(L, container) {
  if (container === NAV_LAYOUT_TOP) return L.top;
  return L.groups[container] ? L.groups[container].items : null;
}
function detach(L, ref) {
  const at = layoutLocate(L, ref);
  if (!at) return null;
  listOf(L, at.container).splice(at.index, 1);
  return at;
}

// Move `ref` into `container` at `index` (clamped). A tab only ever moves
// along the top level; a function or link may go anywhere.
export function layoutMove(layout, ref, container, index) {
  const L = clone(layout);
  if (!validRef(ref)) return L;
  if (refType(ref) === 'g' && container !== NAV_LAYOUT_TOP) return L;
  const target = listOf(L, container);
  if (!target) return L;
  const from = detach(L, ref);
  let at = Number.isFinite(index) ? Math.max(0, Math.min(Math.floor(index), target.length)) : target.length;
  // Moving down inside one list: the slot it left shifts everything up by one.
  if (from && from.container === container && from.index < at) at = Math.max(0, at - 1);
  target.splice(at, 0, ref);
  return L;
}
// One step up or down inside its own list.
export function layoutNudge(layout, ref, delta) {
  const at = layoutLocate(layout, ref);
  if (!at) return clone(layout);
  const L = clone(layout);
  const list = listOf(L, at.container);
  const to = at.index + (delta < 0 ? -1 : 1);
  if (to < 0 || to >= list.length) return L;
  list.splice(at.index, 1);
  list.splice(to, 0, ref);
  return L;
}
export function layoutSetHidden(layout, ref, hidden) {
  const L = clone(layout);
  const t = refType(ref);
  if (t === 'g') {
    const g = L.groups[refId(ref)];
    if (!g) L.groups[refId(ref)] = { items: [], ...(hidden ? { hidden: true } : {}) };
    else if (hidden) g.hidden = true; else delete g.hidden;
    return L;
  }
  if (t !== 'i' && t !== 'l') return L;
  L.hidden = L.hidden.filter(r => r !== ref);
  if (hidden) L.hidden.push(ref);
  return L;
}
export function layoutShowAll(layout) {
  const L = clone(layout);
  L.hidden = [];
  for (const id of Object.keys(L.groups)) delete L.groups[id].hidden;
  return L;
}
export function layoutSetLabel(layout, ref, label) {
  const L = clone(layout);
  const t = refType(ref), id = refId(ref);
  const v = cleanText(label, NAV_LAYOUT_LIMITS.label);
  if (t === 'i') { if (v) L.labels[id] = v; else delete L.labels[id]; }
  else if (t === 'g') {
    const g = L.groups[id] || (L.groups[id] = { items: [] });
    if (v) g.label = v; else if (g.custom) g.label = 'New tab'; else delete g.label;
  } else if (t === 'l' && L.links[id] && v) L.links[id].label = v;
  return L;
}
export function layoutSetIcon(layout, ref, icon) {
  const L = clone(layout);
  const t = refType(ref), id = refId(ref);
  const v = cleanIcon(icon);
  if (t === 'g') {
    const g = L.groups[id] || (L.groups[id] = { items: [] });
    if (v) g.icon = v; else if (g.custom) g.icon = '📁'; else delete g.icon;
  } else if (t === 'l' && L.links[id]) L.links[id].icon = v || '🔗';
  return L;
}
function freshId(taken, rand, len) {
  const r = typeof rand === 'function' ? rand : Math.random;
  for (let tries = 0; tries < 50; tries++) {
    let s = '';
    while (s.length < len) s += Math.floor(r() * 36).toString(36);
    if (!taken.has(s)) return s;
  }
  // A random source that keeps repeating itself: count instead.
  for (let i = 0; ; i++) {
    const s = i.toString(36).padStart(len, '0');
    if (!taken.has(s)) return s;
  }
}
// A new tab, at the end of the menu (or before `beforeRef` when given).
export function layoutAddGroup(layout, { label, icon } = {}, rand, beforeRef) {
  const L = clone(layout);
  const customs = Object.keys(L.groups).filter(id => L.groups[id].custom);
  if (customs.length >= NAV_LAYOUT_LIMITS.groups) return { layout: L, id: '' };
  const id = 'c-' + freshId(new Set(Object.keys(L.groups).map(k => k.replace(/^c-/, ''))), rand, 6);
  L.groups[id] = { custom: true, label: cleanText(label, NAV_LAYOUT_LIMITS.label) || 'New tab', icon: cleanIcon(icon) || '📁', items: [] };
  const at = beforeRef ? L.top.indexOf(beforeRef) : -1;
  if (at >= 0) L.top.splice(at, 0, 'g:' + id); else L.top.push('g:' + id);
  return { layout: L, id };
}
// Taking a tab away: the functions in it go home to the tab index.html has
// them in (they become "unmentioned"), and any links in it move up to the
// top level where the tab was.
export function layoutRemoveGroup(layout, id) {
  const L = clone(layout);
  const g = L.groups[id];
  if (!g || !g.custom) return L;
  const at = L.top.indexOf('g:' + id);
  const links = g.items.filter(r => refType(r) === 'l');
  delete L.groups[id];
  L.top = L.top.filter(r => r !== 'g:' + id);
  L.top.splice(at >= 0 ? at : L.top.length, 0, ...links);
  return L;
}
export function layoutAddLink(layout, { label, icon, url } = {}, container, rand) {
  const L = clone(layout);
  const u = cleanUrl(url), name = cleanText(label, NAV_LAYOUT_LIMITS.label);
  if (!u || !name) return { layout: L, id: '', error: !name ? 'Give the link a name.' : 'That address is not a web link (it must start with https://).' };
  if (Object.keys(L.links).length >= NAV_LAYOUT_LIMITS.links) return { layout: L, id: '', error: 'There are already ' + NAV_LAYOUT_LIMITS.links + ' links.' };
  const id = freshId(new Set(Object.keys(L.links)), rand, 6);
  L.links[id] = { label: name, icon: cleanIcon(icon) || '🔗', url: u };
  const list = container && container !== NAV_LAYOUT_TOP && L.groups[container] ? L.groups[container].items : L.top;
  list.push('l:' + id);
  return { layout: L, id, error: '' };
}
export function layoutUpdateLink(layout, id, { label, icon, url } = {}) {
  const L = clone(layout);
  const k = L.links[id];
  if (!k) return { layout: L, error: 'That link is gone.' };
  if (url !== undefined) { const u = cleanUrl(url); if (!u) return { layout: clone(layout), error: 'That address is not a web link (it must start with https://).' }; k.url = u; }
  if (label !== undefined) { const v = cleanText(label, NAV_LAYOUT_LIMITS.label); if (!v) return { layout: clone(layout), error: 'Give the link a name.' }; k.label = v; }
  if (icon !== undefined) k.icon = cleanIcon(icon) || '🔗';
  return { layout: L, error: '' };
}
export function layoutRemoveLink(layout, id) {
  const L = clone(layout);
  delete L.links[id];
  const ref = 'l:' + id;
  L.top = L.top.filter(r => r !== ref);
  for (const g of Object.keys(L.groups)) L.groups[g].items = L.groups[g].items.filter(r => r !== ref);
  L.hidden = L.hidden.filter(r => r !== ref);
  return L;
}
export function layoutSetLockHidden(layout, on) {
  const L = clone(layout);
  L.lockHidden = !!on;
  return L;
}

// ---- summaries ---------------------------------------------------------------------

// What the audience will see, counted: shown on the editor and in the toast.
export function planSummary(plan) {
  const visibleGroups = Object.values(plan.groups).filter(g => !g.hidden);
  const shownItems = Object.values(plan.items).filter(x => !x.effectiveHidden).length + Object.values(plan.links).filter(x => !x.effectiveHidden).length;
  const hiddenItems = Object.values(plan.items).filter(x => x.effectiveHidden).length + Object.values(plan.links).filter(x => x.effectiveHidden).length;
  return { tabs: visibleGroups.length, shown: shownItems, hidden: hiddenItems, links: Object.keys(plan.links).length, custom: Object.values(plan.groups).filter(g => g.custom).length };
}
// Two layouts mean the same menu (used to tell "unsaved changes" honestly).
export function sameLayout(a, b) {
  return JSON.stringify(sortKeys(normalizeAudienceLayout(a))) === JSON.stringify(sortKeys(normalizeAudienceLayout(b)));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isObj(v)) return v;
  const o = {};
  for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
  return o;
}
