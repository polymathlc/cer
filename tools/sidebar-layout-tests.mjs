// 🧩 Sidebar layout (v1.451.0). Run: node --test tools/sidebar-layout-tests.mjs
//
// The pure half (sidebar-layout-core.mjs) against a small inventory, plus the
// wiring in index.html and app.js that every silent failure would hide behind:
// a hide written as inline style is undone by the next late show; a sync that
// does not read the hide class leaves a tab head over nothing; a navigateTo
// without the block lets a student follow a Home tile into a page the admin
// switched off; a layout applied before the role lets a layout "show" an
// admin item to a student.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NAV_LAYOUT_TOP, NAV_LAYOUT_LIMITS, cleanText, cleanIcon, cleanUrl, emptyAudienceLayout, emptyLayout, isEmptyAudienceLayout,
  normalizeAudienceLayout, normalizeLayout, normalizeInventory, planSidebar, materializeLayout, canonicalLayout,
  layoutLocate, layoutMove, layoutNudge, layoutSetHidden, layoutShowAll, layoutSetLabel, layoutSetIcon, layoutAddGroup,
  layoutRemoveGroup, layoutAddLink, layoutUpdateLink, layoutRemoveLink, layoutSetLockHidden, planSummary, sameLayout
} from '../sidebar-layout-core.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// A sidebar shaped like the real one: top items, an admin-only tab, a shared
// tab with role-split items, a student-only tab, the games, the tools.
const INV = {
  groups: [
    { id: 'questions', label: 'Questions', icon: '✏️', audience: 'admin' },
    { id: 'papers', label: 'Papers & Worksheets', icon: '📄', audience: 'both' },
    { id: 'practice', label: 'Practice', icon: '✍️', audience: 'student' },
    { id: 'learn', label: 'Syllabus & Papers', icon: '📚', audience: 'both' },
    { id: 'games', label: 'Games', icon: '🎮', audience: 'both' },
    { id: 'tools', label: 'Tools & Settings', icon: '⚙️', audience: 'admin' }
  ],
  items: [
    { key: 'page:home@student', label: 'Home', icon: '🏠', audience: 'student', group: null, page: 'home' },
    { key: 'page:community', label: 'Community', icon: '🏛️', audience: 'both', group: null, page: 'community' },
    { key: 'page:create@admin', label: 'Create Question', audience: 'admin', group: 'questions', page: 'create' },
    { key: 'page:bank@admin', label: 'Question Bank', audience: 'admin', group: 'questions', page: 'bank' },
    { key: 'page:worksheet@admin', label: 'Create Worksheet', audience: 'admin', group: 'papers', page: 'worksheet' },
    { key: 'page:worksheet@student', label: 'Create Worksheet', audience: 'student', group: 'papers', page: 'worksheet' },
    { key: 'page:myworksheets@student', label: 'My Worksheets', audience: 'student', group: 'papers', page: 'myworksheets' },
    { key: 'page:quickpractice@student', label: 'Quick Practice', audience: 'student', group: 'practice', page: 'quickpractice' },
    { key: 'page:flashcards@student', label: 'Flashcards', audience: 'student', group: 'practice', page: 'flashcards' },
    { key: 'page:mistakes@student', label: 'Learn from Mistakes', audience: 'student', group: 'practice', page: 'mistakes' },
    { key: 'page:textbooks', label: 'Textbooks', audience: 'both', group: 'learn', page: 'textbooks' },
    { key: 'page:psle', label: 'Science PSLE', icon: '🎓', audience: 'both', group: 'learn', page: 'psle' },
    { key: 'page:papers', label: 'PSLE Papers', audience: 'both', group: 'learn', page: 'papers' },
    { key: 'page:arcade', label: 'Arcade', icon: '🕹️', audience: 'both', group: 'games', page: 'arcade' },
    { key: 'page:tcg', label: 'Realm of Embers', icon: '🃏', audience: 'both', group: 'games', page: 'tcg' },
    { key: 'id:navFps', label: 'Science Strike', icon: '🔫', audience: 'both', group: 'games', page: '' },
    { key: 'page:photoedit@admin', label: 'Photo Editor', audience: 'admin', group: 'tools', page: 'photoedit' },
    { key: 'page:navlayout@admin', label: 'Sidebar Layout', audience: 'admin', group: 'tools', page: 'navlayout' },
    { key: 'install', label: 'Install app', audience: 'both', group: null, page: '' }
  ],
  top: ['i:page:home@student', 'i:page:community', 'g:questions', 'g:papers', 'g:practice', 'g:learn', 'g:games', 'g:tools', 'i:install']
};
const seq = () => { let n = 0; return () => ((n++ % 36) + 0.5) / 36; };
const flat = plan => plan.top.flatMap(r => r[0] === 'g' ? [r, ...plan.groups[r.slice(2)].items.map(x => '  ' + x)] : [r]);

// ---- cleaning -------------------------------------------------------------------
test('text is plain and short, and an emoji is never cut in half', () => {
  assert.equal(cleanText('  My\n\ttab\u0000  ', 40), 'My tab');
  assert.equal(cleanText(42, 40), '');
  assert.equal(cleanText('😀😀😀', 2), '😀😀');
  assert.equal(cleanText('a'.repeat(100), NAV_LAYOUT_LIMITS.label).length, NAV_LAYOUT_LIMITS.label);
  assert.equal(cleanIcon(' 📁 '), '📁');
  assert.equal(cleanIcon('👨‍👩‍👧'), '👨‍👩‍👧');
  assert.ok(Array.from(cleanIcon('abcdefghijkl')).length <= NAV_LAYOUT_LIMITS.icon);
});
test('a link is http(s) or nothing', () => {
  assert.equal(cleanUrl('https://drive.google.com/x?y=1'), 'https://drive.google.com/x?y=1');
  assert.equal(cleanUrl('polymathlc.com.sg/online/'), 'https://polymathlc.com.sg/online/');
  assert.equal(cleanUrl('javascript:alert(1)'), '');
  assert.equal(cleanUrl('JAVASCRIPT:alert(1)'), '');
  assert.equal(cleanUrl('data:text/html,<b>x</b>'), '');
  assert.equal(cleanUrl('ftp://x.com'), '');
  assert.equal(cleanUrl('https://user:pw@x.com'), '');
  assert.equal(cleanUrl(''), '');
  assert.equal(cleanUrl('https://' + 'a'.repeat(600) + '.com'), '');
});

// ---- normalizing ----------------------------------------------------------------
test('anything stored comes out as a well-formed layout', () => {
  for (const junk of [null, undefined, 7, 'x', [], { top: 'x', groups: [], hidden: {}, labels: [], links: 5 }]) {
    const L = normalizeAudienceLayout(junk);
    assert.deepEqual(L, emptyAudienceLayout());
  }
  const L = normalizeAudienceLayout({
    top: ['g:papers', 'g:papers', 'x:bad', 'i:page:psle', 'g:../etc', 7],
    groups: {
      papers: { items: ['i:page:psle', 'g:learn', 'l:abc123'], label: '  Worksheets  ', hidden: true },
      'c-abc123': { custom: true, label: '', items: [] },
      'c-zzzzzz': { label: 'not custom without the flag', items: [] },
      'BAD ID': { items: [] }
    },
    hidden: ['i:page:psle', 'g:papers', 'i:page:psle'],
    labels: { 'page:psle': '  PSLE  ', 'bad key!': 'x', 'page:x': '' },
    links: { abc123: { label: 'Drive', url: 'drive.google.com' }, bad: { label: 'x', url: 'javascript:1' }, nolabel: { url: 'https://x.com' } },
    lockHidden: 'yes'
  });
  assert.deepEqual(L.top, ['g:papers', 'i:page:psle']);
  assert.deepEqual(L.groups.papers, { items: ['i:page:psle', 'l:abc123'], label: 'Worksheets', hidden: true });
  assert.equal(L.groups['c-abc123'].label, 'New tab');
  assert.equal(L.groups['c-zzzzzz'].custom, undefined);
  assert.ok(!L.groups['BAD ID']);
  assert.deepEqual(L.hidden, ['i:page:psle']);
  assert.deepEqual(L.labels, { 'page:psle': 'PSLE' });
  assert.deepEqual(Object.keys(L.links), ['abc123']);
  assert.equal(L.links.abc123.url, 'https://drive.google.com/');
  assert.equal(L.links.abc123.icon, '🔗');
  assert.equal(L.lockHidden, true, 'only an explicit false turns the lock off');
  assert.equal(normalizeAudienceLayout({ lockHidden: false }).lockHidden, false);
});
test('the document holds both menus and who saved it', () => {
  const D = normalizeLayout({ student: { hidden: ['i:page:psle'] }, admin: null, updatedAt: '2026-10-29T10:00:00Z', updatedBy: 'chungzhikai@gmail.com', extra: 1 });
  assert.deepEqual(D.student.hidden, ['i:page:psle']);
  assert.deepEqual(D.admin, emptyAudienceLayout());
  assert.equal(D.updatedBy, 'chungzhikai@gmail.com');
  assert.ok(!('extra' in D));
  assert.deepEqual(normalizeLayout(null), emptyLayout());
});
test('caps: custom tabs and links cannot grow without end', () => {
  const groups = {}, links = {};
  for (let i = 0; i < 40; i++) { groups['c-g' + String(i).padStart(3, '0')] = { custom: true, label: 'T' + i, items: [] }; links['l' + String(i).padStart(3, '0')] = { label: 'L' + i, url: 'https://x.com/' + i }; }
  const L = normalizeAudienceLayout({ groups, links });
  assert.equal(Object.keys(L.groups).length, NAV_LAYOUT_LIMITS.groups);
  assert.equal(Object.keys(L.links).length, NAV_LAYOUT_LIMITS.links);
});

// ---- the inventory ----------------------------------------------------------------
test('the inventory keeps the first of a duplicate and puts every orphan somewhere', () => {
  const inv = normalizeInventory({ groups: [{ id: 'a', label: 'A' }, { id: 'a' }], items: [{ key: 'x', group: 'a' }, { key: 'x' }, { key: 'y', group: 'missing' }], top: ['g:a', 'i:nope'] });
  assert.equal(inv.groups.length, 1);
  assert.equal(inv.items.length, 2);
  assert.equal(inv.items[1].group, null);
  assert.deepEqual(inv.top, ['g:a', 'i:y']);
});

// ---- the plan ----------------------------------------------------------------------
test('with no layout, each audience gets exactly what index.html has, and only what it can see', () => {
  const s = planSidebar(INV, null, 'student');
  assert.deepEqual(s.top, ['i:page:home@student', 'i:page:community', 'g:papers', 'g:practice', 'g:learn', 'g:games', 'i:install']);
  assert.deepEqual(s.groups.papers.items, ['i:page:worksheet@student', 'i:page:myworksheets@student']);
  assert.ok(!s.groups.questions && !s.groups.tools, 'admin tabs are not on the students\' menu');
  assert.ok(!s.items['page:create@admin']);
  assert.deepEqual(s.blockedPages, []);
  const a = planSidebar(INV, emptyAudienceLayout(), 'admin');
  assert.deepEqual(a.top, ['i:page:community', 'g:questions', 'g:papers', 'g:learn', 'g:games', 'g:tools', 'i:install']);
  assert.ok(!a.groups.practice);
  assert.equal(a.items['page:navlayout@admin'].locked, true);
});
test('hiding a function hides it and switches its page off; hiding a tab hides what is in it', () => {
  let L = layoutSetHidden(emptyAudienceLayout(), 'i:page:flashcards@student', true);
  let p = planSidebar(INV, L, 'student');
  assert.equal(p.items['page:flashcards@student'].hidden, true);
  assert.deepEqual(p.blockedPages, ['flashcards']);
  L = layoutSetHidden(L, 'g:learn', true);
  p = planSidebar(INV, L, 'student');
  assert.equal(p.groups.learn.hidden, true);
  assert.equal(p.items['page:psle'].hidden, false, 'its own switch is untouched…');
  assert.equal(p.items['page:psle'].effectiveHidden, true, '…but the tab hides it');
  assert.deepEqual(p.blockedPages.sort(), ['flashcards', 'papers', 'psle', 'textbooks']);
  // Untick the lock: still hidden in the menu, but nothing is switched off.
  p = planSidebar(INV, layoutSetLockHidden(L, false), 'student');
  assert.deepEqual(p.blockedPages, []);
  assert.equal(p.items['page:psle'].effectiveHidden, true);
});
test('Home and Community are never switched off, and one visible door keeps a shared page open', () => {
  let L = layoutSetHidden(emptyAudienceLayout(), 'i:page:home@student', true);
  L = layoutSetHidden(L, 'i:page:community', true);
  const p = planSidebar(INV, L, 'student');
  assert.equal(p.items['page:home@student'].hidden, true);
  assert.deepEqual(p.blockedPages, []);
  // The admin's own Create Worksheet hidden: the page is the admin's anyway,
  // but the plan for the admin never blocks (navigateTo never asks for an admin).
  const a = planSidebar(INV, layoutSetHidden(emptyAudienceLayout(), 'i:page:worksheet@admin', true), 'admin');
  assert.deepEqual(a.blockedPages, ['worksheet']);
});
test('the editor\'s door can never be hidden from the admin\'s menu, nor vanish with its tab', () => {
  let L = layoutSetHidden(emptyAudienceLayout(), 'i:page:navlayout@admin', true);
  let p = planSidebar(INV, L, 'admin');
  assert.equal(p.items['page:navlayout@admin'].hidden, false);
  L = layoutSetHidden(emptyAudienceLayout(), 'g:tools', true);
  p = planSidebar(INV, L, 'admin');
  assert.equal(p.items['page:navlayout@admin'].container, null);
  assert.equal(p.items['page:navlayout@admin'].effectiveHidden, false);
  assert.ok(p.top.includes('i:page:navlayout@admin'));
  assert.ok(!p.groups.tools.items.includes('i:page:navlayout@admin'));
  assert.equal(p.items['page:photoedit@admin'].effectiveHidden, true);
});
test('a function filed under another tab moves there, in the order given', () => {
  const L = { top: ['g:learn', 'i:page:home@student'], groups: { learn: { items: ['i:page:quickpractice@student', 'i:page:psle'] } } };
  const p = planSidebar(INV, L, 'student');
  assert.equal(p.top[0], 'g:learn');
  assert.ok(p.top.indexOf('i:page:home@student') < p.top.indexOf('i:page:community'));
  assert.deepEqual(p.groups.learn.items, ['i:page:quickpractice@student', 'i:page:textbooks', 'i:page:psle', 'i:page:papers'],
    'what the layout did not mention slots in beside its index.html neighbours');
  assert.deepEqual(p.groups.practice.items, ['i:page:flashcards@student', 'i:page:mistakes@student']);
  assert.equal(p.items['page:quickpractice@student'].container, 'learn');
});
test('an item a layout never mentions (a new release) goes home, beside its neighbour', () => {
  const inv = JSON.parse(JSON.stringify(INV));
  // The saved layout predates "Snap & Mark", which a release adds after Quick Practice.
  const saved = canonicalLayout(INV, layoutSetHidden(emptyAudienceLayout(), 'i:page:flashcards@student', true), 'student');
  inv.items.splice(8, 0, { key: 'page:snapmark@student', label: 'Snap & Mark', audience: 'student', group: 'practice', page: 'snapmark' });
  const p = planSidebar(inv, saved, 'student');
  assert.deepEqual(p.groups.practice.items, ['i:page:quickpractice@student', 'i:page:snapmark@student', 'i:page:flashcards@student', 'i:page:mistakes@student']);
  assert.equal(p.items['page:snapmark@student'].hidden, false);
  // A tab added by a release goes where index.html has it.
  inv.groups.splice(4, 0, { id: 'reading', label: 'Reading', icon: '📖', audience: 'both' });
  inv.top.splice(6, 0, 'g:reading');
  const q = planSidebar(inv, saved, 'student');
  assert.equal(q.top.indexOf('g:reading'), q.top.indexOf('g:learn') + 1);
});
test('a layout naming things that no longer exist is not upset by them', () => {
  const L = { top: ['g:gone', 'i:page:gone', 'l:abc123', 'g:papers'], groups: { gone: { items: ['i:page:psle'] }, papers: { items: ['i:page:nope'] } }, hidden: ['i:page:nope'], links: {} };
  const p = planSidebar(INV, L, 'student');
  assert.ok(!p.top.includes('g:gone') && !p.top.includes('i:page:gone') && !p.top.includes('l:abc123'));
  assert.ok(p.top.indexOf('g:papers') < p.top.indexOf('g:practice'));
  assert.equal(p.items['page:psle'].container, 'learn', 'an item in a tab that is gone goes home');
});
test('a function only the other audience sees cannot be pulled into this menu', () => {
  const L = { top: ['i:page:create@admin'], groups: { papers: { items: ['i:page:bank@admin'] } } };
  const p = planSidebar(INV, L, 'student');
  assert.ok(!p.top.includes('i:page:create@admin'));
  assert.ok(!p.groups.papers.items.includes('i:page:bank@admin'));
  // …and a student item cannot be filed into an admin-only tab on the students' menu.
  const q = planSidebar(INV, { groups: { questions: { items: ['i:page:flashcards@student'] } } }, 'student');
  assert.equal(q.items['page:flashcards@student'].container, 'practice');
});
test('renames: a function, a built-in tab and its icon', () => {
  let L = layoutSetLabel(emptyAudienceLayout(), 'i:page:psle', 'PSLE');
  L = layoutSetLabel(L, 'g:learn', 'Revise');
  L = layoutSetIcon(L, 'g:learn', '🧠');
  const p = planSidebar(INV, L, 'student');
  assert.equal(p.items['page:psle'].label, 'PSLE');
  assert.equal(p.items['page:psle'].defaultLabel, 'Science PSLE');
  assert.equal(p.groups.learn.label, 'Revise');
  assert.equal(p.groups.learn.icon, '🧠');
  // Clearing a name puts the original back.
  const back = planSidebar(INV, layoutSetLabel(layoutSetIcon(layoutSetLabel(L, 'i:page:psle', '  '), 'g:learn', ''), 'g:learn', ''), 'student');
  assert.equal(back.items['page:psle'].label, 'Science PSLE');
  assert.equal(back.groups.learn.label, 'Syllabus & Papers');
  assert.equal(back.groups.learn.icon, '📚');
});

// ---- materialize ---------------------------------------------------------------------
test('canonical form names everything, keeps only real renames, and is stable', () => {
  const L = canonicalLayout(INV, layoutSetLabel(emptyAudienceLayout(), 'i:page:psle', 'PSLE'), 'student');
  assert.deepEqual(L.labels, { 'page:psle': 'PSLE' });
  assert.deepEqual(L.top, planSidebar(INV, null, 'student').top);
  assert.deepEqual(L.groups.practice.items, ['i:page:quickpractice@student', 'i:page:flashcards@student', 'i:page:mistakes@student']);
  assert.ok(!('label' in L.groups.practice), 'an unrenamed tab carries no label');
  assert.deepEqual(canonicalLayout(INV, L, 'student'), L, 'canonical of canonical is itself');
  assert.ok(sameLayout(canonicalLayout(INV, null, 'student'), canonicalLayout(INV, emptyAudienceLayout(), 'student')));
  assert.ok(!sameLayout(L, canonicalLayout(INV, null, 'student')));
});
test('editing one menu never wipes what the other menu set on a tab it cannot see', () => {
  const prev = { groups: { questions: { label: 'Authoring', items: [] } } };
  const L = materializeLayout(planSidebar(INV, prev, 'student'), prev);
  assert.equal(L.groups.questions.label, 'Authoring');
});
test('an empty layout is empty, and a layout with anything in it is not', () => {
  assert.ok(isEmptyAudienceLayout(null));
  assert.ok(isEmptyAudienceLayout(emptyAudienceLayout()));
  assert.ok(!isEmptyAudienceLayout({ hidden: ['i:page:psle'] }));
});

// ---- the editor's operations ------------------------------------------------------------
const base = () => canonicalLayout(INV, null, 'student');
test('move: into a tab, to the top level, to a position, and a tab only along the top', () => {
  let L = layoutMove(base(), 'i:page:psle', 'practice', 0);
  assert.deepEqual(layoutLocate(L, 'i:page:psle'), { container: 'practice', index: 0 });
  L = layoutMove(L, 'i:page:psle', NAV_LAYOUT_TOP, 0);
  assert.deepEqual(layoutLocate(L, 'i:page:psle'), { container: NAV_LAYOUT_TOP, index: 0 });
  L = layoutMove(L, 'i:page:psle', 'practice', Infinity);
  assert.equal(L.groups.practice.items.at(-1), 'i:page:psle');
  const before = JSON.stringify(L);
  assert.equal(JSON.stringify(layoutMove(L, 'g:games', 'practice', 0)), before, 'a tab cannot go inside a tab');
  assert.equal(JSON.stringify(layoutMove(L, 'i:page:psle', 'nowhere', 0)), before);
  // Moving down within one list lands where the pointer said.
  const top = canonicalLayout(INV, L, 'student').top;
  const M = layoutMove(L, top[0], NAV_LAYOUT_TOP, 3);
  assert.equal(M.top[2], top[0]);
  // The input is never changed.
  assert.equal(JSON.stringify(L), before);
});
test('nudge up and down, and not past either end', () => {
  const L = base();
  const first = L.groups.practice.items[0];
  const N = layoutNudge(L, first, 1);
  assert.equal(N.groups.practice.items[1], first);
  assert.deepEqual(layoutNudge(L, first, -1).groups.practice.items, L.groups.practice.items);
  const lastTop = L.top.at(-1);
  assert.deepEqual(layoutNudge(L, lastTop, 1).top, L.top);
  assert.equal(layoutNudge(L, 'g:games', -1).top.indexOf('g:games'), L.top.indexOf('g:games') - 1);
});
test('show everything brings back every hidden function and tab, keeping names and order', () => {
  let L = layoutSetHidden(base(), 'i:page:psle', true);
  L = layoutSetHidden(L, 'g:games', true);
  L = layoutSetLabel(L, 'i:page:psle', 'PSLE');
  L = layoutMove(L, 'g:games', NAV_LAYOUT_TOP, 0);
  const S = canonicalLayout(INV, layoutShowAll(L), 'student');
  const p = planSidebar(INV, S, 'student');
  assert.equal(planSummary(p).hidden, 0);
  assert.equal(p.items['page:psle'].label, 'PSLE');
  assert.equal(p.top[0], 'g:games');
});
test('a new tab: added at the end, filled, emptied of its functions when removed', () => {
  const r = layoutAddGroup(base(), { label: '  Revision  ', icon: '🧠' }, seq());
  assert.match(r.id, /^c-[a-z0-9]{6}$/);
  assert.equal(r.layout.top.at(-1), 'g:' + r.id);
  let L = layoutMove(r.layout, 'i:page:flashcards@student', r.id, 0);
  L = layoutMove(L, 'i:page:psle', r.id, 1);
  let p = planSidebar(INV, L, 'student');
  assert.deepEqual(p.groups[r.id].items, ['i:page:flashcards@student', 'i:page:psle']);
  assert.equal(p.groups[r.id].label, 'Revision');
  assert.equal(p.groups[r.id].custom, true);
  // A link filed in it moves to the top when the tab goes; the functions go home.
  const k = layoutAddLink(L, { label: 'Drive', url: 'https://drive.google.com' }, r.id, seq());
  L = layoutRemoveGroup(k.layout, r.id);
  p = planSidebar(INV, L, 'student');
  assert.ok(!p.groups[r.id]);
  assert.equal(p.items['page:flashcards@student'].container, 'practice');
  assert.equal(p.items['page:psle'].container, 'learn');
  assert.equal(p.links[k.id].container, null);
  assert.ok(p.top.includes('l:' + k.id));
  // A built-in tab cannot be removed.
  assert.ok(layoutRemoveGroup(L, 'learn').groups.learn);
  // A new tab before a given one.
  const b = layoutAddGroup(base(), { label: 'First' }, seq(), 'g:papers');
  assert.equal(b.layout.top.indexOf('g:' + b.id), base().top.indexOf('g:papers'));
});
test('the new tab id never collides', () => {
  let L = base();
  const ids = new Set();
  const same = () => 0.5;   // the same "random" every time
  for (let i = 0; i < 5; i++) { const r = layoutAddGroup(L, { label: 'T' + i }, same); ids.add(r.id); L = r.layout; }
  assert.equal(ids.size, 5);
});
test('links: added with a clean address, edited, refused when not a web link, removed', () => {
  const bad = layoutAddLink(base(), { label: 'Bad', url: 'javascript:alert(1)' });
  assert.equal(bad.id, '');
  assert.match(bad.error, /web link/);
  assert.match(layoutAddLink(base(), { label: '', url: 'https://x.com' }).error, /name/);
  const r = layoutAddLink(base(), { label: 'Class Drive', icon: '📂', url: 'drive.google.com/abc' }, NAV_LAYOUT_TOP, seq());
  assert.ok(r.id);
  let p = planSidebar(INV, r.layout, 'student');
  assert.deepEqual({ ...p.links[r.id], container: undefined, hidden: undefined, effectiveHidden: undefined }, { id: r.id, label: 'Class Drive', icon: '📂', url: 'https://drive.google.com/abc', container: undefined, hidden: undefined, effectiveHidden: undefined });
  const u = layoutUpdateLink(r.layout, r.id, { url: 'ftp://nope' });
  assert.match(u.error, /web link/);
  assert.equal(planSidebar(INV, u.layout, 'student').links[r.id].url, 'https://drive.google.com/abc', 'a refused edit changes nothing');
  const v = layoutUpdateLink(r.layout, r.id, { label: 'Drive', icon: '' , url: 'https://drive.google.com/new' });
  p = planSidebar(INV, v.layout, 'student');
  assert.equal(p.links[r.id].label, 'Drive');
  assert.equal(p.links[r.id].icon, '🔗');
  const h = planSidebar(INV, layoutSetHidden(v.layout, 'l:' + r.id, true), 'student');
  assert.equal(h.links[r.id].hidden, true);
  const gone = layoutRemoveLink(layoutSetHidden(v.layout, 'l:' + r.id, true), r.id);
  assert.ok(!gone.top.includes('l:' + r.id) && !gone.hidden.includes('l:' + r.id) && !gone.links[r.id]);
  assert.match(layoutUpdateLink(base(), 'nope', {}).error, /gone/);
});
test('the summary counts what the audience will see', () => {
  let L = layoutSetHidden(base(), 'i:page:psle', true);
  L = layoutSetHidden(L, 'g:games', true);
  const s = planSummary(planSidebar(INV, L, 'student'));
  // 3 visible tabs of the students' 4; hidden: psle + the 3 games = 4.
  assert.equal(s.tabs, 3);
  assert.equal(s.hidden, 4);
  assert.equal(s.shown + s.hidden, INV.items.filter(i => i.audience !== 'admin').length);
});
test('a long editing session ends where it should (round trip through canonical form)', () => {
  let L = base();
  const r = layoutAddGroup(L, { label: 'Daily', icon: '⭐' }, seq());
  L = r.layout;
  for (const key of ['i:page:quickpractice@student', 'i:page:flashcards@student', 'i:page:psle']) L = canonicalLayout(INV, layoutMove(L, key, r.id, Infinity), 'student');
  L = canonicalLayout(INV, layoutMove(L, 'g:' + r.id, NAV_LAYOUT_TOP, 1), 'student');
  L = canonicalLayout(INV, layoutSetHidden(L, 'g:games', true), 'student');
  L = canonicalLayout(INV, layoutSetHidden(L, 'i:page:papers', true), 'student');
  const p = planSidebar(INV, L, 'student');
  assert.deepEqual(flat(p), [
    'i:page:home@student',
    'g:' + r.id, '  i:page:quickpractice@student', '  i:page:flashcards@student', '  i:page:psle',
    'i:page:community',
    'g:papers', '  i:page:worksheet@student', '  i:page:myworksheets@student',
    'g:practice', '  i:page:mistakes@student',
    'g:learn', '  i:page:textbooks', '  i:page:papers',
    'g:games', '  i:page:arcade', '  i:page:tcg', '  i:id:navFps',
    'i:install'
  ]);
  assert.deepEqual(p.blockedPages.sort(), ['arcade', 'papers', 'tcg']);
  // Survives being stored and read back.
  assert.deepEqual(planSidebar(INV, normalizeLayout(JSON.parse(JSON.stringify({ student: L }))).student, 'student').top, p.top);
});

// ---- the wiring ---------------------------------------------------------------------------
test('index.html: the editor\'s door, its page, and the hide rule by CLASS', () => {
  assert.match(html, /<div class="nav-item admin-only" data-page="navlayout" onclick="navigateTo\('navlayout'\)"/);
  const tools = html.slice(html.indexOf('data-group="tools"'), html.indexOf('</details>', html.indexOf('data-group="tools"')));
  assert.ok(tools.includes('data-page="navlayout"'), 'Sidebar Layout sits in ⚙️ Tools & Settings');
  assert.match(html, /<div class="page" id="page-navlayout">[\s\S]*?<div id="nlRoot"><\/div>/);
  assert.match(html, /\.sidebar-nav \.nav-layout-hidden \{ display: none !important; \}/);
});
test('app.js: the layout is applied after the role and before the stars and groups, on every path', () => {
  const cfg = js.slice(js.indexOf('function configureSidebarForRole('), js.indexOf('// SIDEBAR BOOKMARKS'));
  assert.equal((cfg.match(/navLayoutInit\(\)/g) || []).length, 2, 'employee path and admin/student path');
  const emp = cfg.slice(cfg.indexOf("if (role === 'employee')"), cfg.indexOf("if (role === 'admin')"));
  assert.ok(emp.indexOf('navLayoutInit()') < emp.indexOf('navBookmarksInit()'));
  const rest = cfg.slice(cfg.indexOf("if (role === 'admin')"));
  assert.ok(rest.indexOf('studentItems.forEach') < rest.indexOf('navLayoutInit()'), 'after the role gates');
  assert.ok(rest.indexOf('navLayoutInit()') < rest.indexOf('navBookmarksInit()'));
  assert.ok(rest.indexOf('navLayoutInit()') < rest.indexOf('navGroupsRestore()'));
});
test('app.js: hides are read everywhere an item\'s visibility is read', () => {
  assert.match(js, /const visible = items\.filter\(el => el\.style\.display !== 'none' && !\(el\.closest && el\.closest\('\.nav-layout-hidden'\)\)\);/);
  assert.match(js, /\.filter\(x => x\.el && x\.el\.style\.display !== 'none' && !x\.el\.closest\('\.nav-layout-hidden'\)\);/);
  // The applier never writes inline display.
  const blk = js.slice(js.indexOf('// 🧩 SIDEBAR LAYOUT (v1.451.0)'), js.indexOf('// 🧩 The editor (#page-navlayout'));
  assert.ok(blk.length > 1000);
  assert.ok(!/\.style\.display\s*=/.test(blk.replace("badge.style.display = 'none'", '')), 'hiding is by class only');
  assert.match(blk, /classList\.toggle\('nav-layout-hidden'/);
});
test('app.js: navigateTo switches hidden pages off for students and keeps the editor the admin\'s', () => {
  const navTo = js.slice(js.indexOf("function navigateTo(page)"), js.indexOf("function navigateTo(page)") + 3500);
  assert.match(navTo, /if \(navLayoutBlocks\(page\)\) \{[^}]*page = rpgHomePage\(\); \}/);
  assert.match(navTo, /if \(page === 'navlayout' && !_isAdmin\(\)\) page = rpgHomePage\(\);/);
  assert.ok(navTo.indexOf('EMPLOYEE_PAGES.indexOf(page) < 0') < navTo.indexOf('navLayoutBlocks(page)'));
  assert.match(js, /function navLayoutBlocks\(page\) \{\s*return !!page && !_isAdmin\(\) && !_isEmployee\(\) && _navLayoutBlocked\.has\(page\);/);
  assert.match(js, /if \(page === 'navlayout'\) nlOpen\(\);/);
});
test('app.js: one document, read live by everyone, written whole by the admin', () => {
  assert.match(js, /function _navLayoutRef\(\) \{ return doc\(db, 'config', 'sidebarLayout'\); \}/);
  assert.match(js, /_navLayoutStop = onSnapshot\(_navLayoutRef\(\)/);
  assert.match(js, /await setDoc\(_navLayoutRef\(\), out\);/);
  assert.ok(!/setDoc\(doc\(db, 'config', 'admin'\)[^;]*sidebar/i.test(js), 'never on config/admin (the bank pointer)');
  assert.match(js, /function nlSave\(\) \{\s*if \(!_isAdmin\(\) \|\| _nl\.busy\) return;/);
  assert.match(js, /navLayoutStopWatch\(\);/);
  assert.match(js, /from '\.\/sidebar-layout-core\.mjs\?v=1\.451\.0'/);
});
test('the version is bumped together', () => {
  const v = /const APP_VERSION = 'v([\d.]+)'/.exec(js)[1];
  assert.ok(html.includes('app.js?v=' + v));
  assert.ok(fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes("SW_VERSION = '" + v + "'"));
});
