import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountInterfaceStudio } from '../interface-studio.mjs';

// Only the DOM/storage boundary is mocked; every case runs the shipped module.
function setup({ saved = new Map(), blockedStorage = false, withPrizes = true } = {}) {
  const created = [], reads = [], writes = [];
  function element(tag = 'div') {
    const classes = new Set(), attributes = new Map(), listeners = new Map();
    return {
      tagName: tag.toUpperCase(), children: [], dataset: {}, open: false, clicks: 0,
      className: '', textContent: '', tabIndex: -1,
      classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute: name => attributes.get(name), hasAttribute: name => attributes.has(name),
      append(...items) { this.children.push(...items); }, before(item) { this.beforeNode = item; },
      addEventListener(type, handler) { listeners.set(type, handler); },
      dispatch(type, event) { listeners.get(type)?.(event); },
      click() { this.clicks++; this.dispatch('click', { target: this }); }
    };
  }
  const body = element('body'), sidebar = element('nav'), prize = withPrizes ? element() : null;
  const plainNav = element(), existingNav = element();
  existingNav.setAttribute('tabindex', '3'); existingNav.tabIndex = 3;
  existingNav.setAttribute('role', 'link');
  globalThis.document = {
    body,
    createElement(tag) { const node = element(tag); created.push(node); return node; },
    querySelector(selector) {
      if (selector === '.sidebar-nav') return sidebar;
      if (selector === '#page-leaderboard .rpg-prize-banner') return prize;
      throw Error(`Unexpected DOM query: ${selector}`);
    },
    querySelectorAll(selector) {
      assert.equal(selector, '.nav-item[data-page]:not(button):not(a)');
      return [plainNav, existingNav];
    }
  };
  const storage = {
    getItem(key) { reads.push(key); if (blockedStorage) throw Error('Storage unavailable'); return saved.get(key); },
    setItem(key, value) { writes.push([key, value]); if (blockedStorage) throw Error('Storage unavailable'); saved.set(key, value); }
  };
  const controller = mountInterfaceStudio({ subject: 'Math', storage });
  return { controller, body, sidebar, prize, created, reads, writes, plainNav, existingNav,
    motion: created.find(node => node.className === 'arcade-motion-control'),
    details: created.find(node => node.className === 'arcade-prize-details') };
}

test('every signed-in role gets the new interface immediately without a release setting', () => {
  const t = setup();
  for (const role of ['student', 'employee', 'admin']) {
    t.controller.setUser({ uid: role, role });
    assert.equal(t.body.classList.contains('arcade-ui'), true, role);
    assert.equal(t.body.dataset.arcadeSubject, 'math');
  }
  assert.deepEqual(t.writes, []);
});

test('sign-out clears the app theme and signing back in restores it', () => {
  const t = setup();
  assert.equal(t.body.classList.contains('arcade-ui'), false);
  t.controller.setUser({ uid: 'student', role: 'student' });
  t.controller.setUser(null);
  assert.equal(t.body.classList.contains('arcade-ui'), false);
  t.controller.setUser({ uid: 'other-student', role: 'student' });
  assert.equal(t.body.classList.contains('arcade-ui'), true);
});

test('old admin preview preferences cannot restore the former interface', () => {
  const t = setup({ saved: new Map([['preview:admin', 'current']]) });
  t.controller.setUser({ uid: 'admin', role: 'admin' });
  assert.equal(t.body.classList.contains('arcade-ui'), true);
  assert.deepEqual(t.reads, ['calm']);
  assert.deepEqual(Object.keys(t.controller), ['setUser']);
});

test('mounting creates no rollout banner or release dialog', () => {
  const t = setup();
  t.controller.setUser({ uid: 'admin', role: 'admin' });
  assert.equal(t.created.some(node => node.tagName === 'SECTION' || node.tagName === 'DIALOG'), false);
  assert.deepEqual(t.body.children, []);
  assert.equal(t.sidebar.children.length, 1);
});

test('calm mode restores the device preference and writes only that preference', () => {
  const t = setup({ saved: new Map([['calm', 'true']]) });
  assert.equal(t.body.classList.contains('arcade-calm'), true);
  assert.equal(t.motion.getAttribute('aria-pressed'), 'true');
  t.motion.click();
  assert.equal(t.body.classList.contains('arcade-calm'), false);
  assert.equal(t.motion.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(t.writes, [['calm', 'false']]);
  t.controller.setUser({ uid: 'admin', role: 'admin' });
  t.controller.setUser(null);
  assert.deepEqual(t.writes, [['calm', 'false']]);
});

test('blocked browser storage does not prevent signing in or changing motion', () => {
  const t = setup({ blockedStorage: true });
  t.controller.setUser({ uid: 'student', role: 'student' });
  t.motion.click();
  assert.equal(t.body.classList.contains('arcade-ui'), true);
  assert.equal(t.body.classList.contains('arcade-calm'), true);
});

test('prize rules collapse on sign-in without overriding the student opening them', () => {
  const t = setup();
  assert.equal(t.details.open, true);
  assert.ok(t.details.children.includes(t.prize));
  t.controller.setUser({ uid: 'student', role: 'student' });
  assert.equal(t.details.open, false);
  t.details.open = true;
  t.controller.setUser({ uid: 'student', role: 'student' });
  assert.equal(t.details.open, true);
  t.controller.setUser(null);
  assert.equal(t.details.open, true);
  t.controller.setUser({ uid: 'admin', role: 'admin' });
  assert.equal(t.details.open, false);
});

test('portals without a prize banner still mount safely', () => {
  const t = setup({ withPrizes: false });
  t.controller.setUser({ uid: 'employee', role: 'employee' });
  assert.equal(t.details, undefined);
  assert.equal(t.body.classList.contains('arcade-ui'), true);
});

test('keyboard navigation activates the existing handler once and ignores nested controls', () => {
  const t = setup();
  assert.equal(t.plainNav.tabIndex, 0);
  assert.equal(t.plainNav.getAttribute('role'), 'button');
  for (const key of ['Enter', ' ']) {
    let prevented = false;
    t.plainNav.dispatch('keydown', { target: t.plainNav, key, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  assert.equal(t.plainNav.clicks, 2);
  for (const [target, key] of [[{}, 'Enter'], [t.plainNav, 'ArrowDown']]) {
    t.plainNav.dispatch('keydown', { target, key, preventDefault() { assert.fail('Unrelated input intercepted'); } });
  }
  assert.equal(t.plainNav.clicks, 2);
  assert.equal(t.existingNav.tabIndex, 3);
  assert.equal(t.existingNav.getAttribute('role'), 'link');
});

test('integration retains auth cleanup, role synchronization and subject-isolated motion settings', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const science = html.includes('id="appWrapper"');
  const source = science ? readFileSync(new URL('../app.js', import.meta.url), 'utf8') : html;
  const sync = source.slice(source.indexOf('function syncInterfaceStudio()'), source.indexOf('interfaceStudio.setUser(currentUser);') + 'interfaceStudio.setUser(currentUser);'.length);
  assert.match(html, /href="arcade-ui\.css\?v=2"/);
  assert.match(source, /import \{ mountInterfaceStudio \} from "\.\/interface-studio\.mjs\?v=2"/);
  assert.match(source, /interfaceStudio\?\.setUser\(null\)/);
  assert.match(source, /syncInterfaceStudio\(\);/);
  assert.match(sync, /interfaceStudio\.setUser\(currentUser\)/);
  assert.match(sync, science ? /Science:interface:/ : /Math:interface:/);
  assert.doesNotMatch(sync, /onSnapshot|runTransaction|releaseRef|subscribe:|save:/);
  assert.match(source, /data-arcade-rank="\$\{rank\}"/);
});

test('rollout flags, subscriptions and rollback controls are absent from the shared module', () => {
  const source = readFileSync(new URL('../interface-studio.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createReleaseController|isReleased|arcadeUiBar|arcade-release-dialog|subscribe|releaseRef|data-release|preview:/);
});

test('subject themes stay screen-only and motion and print preferences remain supported', () => {
  const css = readFileSync(new URL('../arcade-ui.css', import.meta.url), 'utf8');
  assert.match(css, /@media screen\s*\{\s*body\.arcade-ui/);
  assert.match(css, /data-arcade-subject="science"/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /body\.arcade-ui\.arcade-calm/);
  assert.match(css, /@media print[^}]*arcade-motion-control[^}]*display:\s*none/);
  assert.doesNotMatch(css, /arcade-studio-bar|arcade-release-dialog/);
});
