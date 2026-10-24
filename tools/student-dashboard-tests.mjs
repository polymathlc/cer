// 🧭 My Polymath — the student dashboard (student/, v1.0.0). Holds every tile
// to its app's address and its icon, so a renamed folder or a missing picture
// is caught here rather than by a student tapping a tile that goes nowhere.
//
//   node --test tools/student-dashboard-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboardDir = path.join(root, 'student');
const HTML = fs.readFileSync(path.join(dashboardDir, 'index.html'), 'utf8');
const page = HTML.replace(/<!--[\s\S]*?-->/g, '');

// The apps, in the order the owner listed them, with Science PSLE beside Science.
const EXPECTED = [
  { app: 'science', name: 'Science', href: '/cer/' },
  { app: 'psle', name: 'Science PSLE', href: '/cer/#psle' },
  { app: 'math', name: 'Math', href: '/math/' },
  { app: 'anskey', name: 'Answer Keys', href: '/anskey/' },
  { app: 'tutor', name: 'Study Buddy', href: '/tutor/' },
  { app: 'rewards', name: 'Rewards', href: '/rewards/' },
  { app: 'online', name: 'Worksheets', href: '/online/' },
  { app: 'chinese', name: 'Chinese', href: '/chinese/' },
  { app: 'english', name: 'English', href: '/english/' }
];

function tiles() {
  return [...page.matchAll(/<a class="app-tile" data-app="([^"]+)" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => ({
    app: match[1],
    href: match[2],
    name: (match[3].match(/<span class="tile-name">([^<]+)<\/span>/) || [])[1],
    blurb: (match[3].match(/<span class="tile-blurb">([^<]+)<\/span>/) || [])[1],
    icon: (match[3].match(/<img class="tile-icon" src="([^"]+)"/) || [])[1],
    address: (match[3].match(/<span class="print-address">([^<]+)<\/span>/) || [])[1],
    style: (match[0].match(/style="([^"]+)"/) || [])[1] || ''
  }));
}

function pngSize(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('latin1', 1, 4), 'PNG', file + ' is a PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('one square tile per app, in the owner\'s order, each going to that app', () => {
  const found = tiles();
  assert.deepEqual(found.map(tile => ({ app: tile.app, name: tile.name, href: tile.href })), EXPECTED);
  for (const tile of found) {
    assert.ok(tile.href.startsWith('/'), tile.name + ' links by its absolute address on polymathlc.com.sg');
    assert.ok(tile.blurb && tile.blurb.length <= 48, tile.name + ' has a short line under it');
    assert.match(tile.style, /--tile-wash:#[0-9A-F]{6};--tile-ink:#[0-9A-F]{6}/i, tile.name + ' has its colours');
    assert.equal(tile.address, 'polymathlc.com.sg' + tile.href.replace(/\/$/, ''), tile.name + ' prints its address');
  }
});

test('every tile icon is a real picture next to the page', () => {
  for (const tile of tiles()) {
    const file = path.join(dashboardDir, tile.icon);
    assert.ok(fs.existsSync(file), tile.icon + ' exists');
    assert.deepEqual(pngSize(file), [192, 192], tile.icon + ' is 192 × 192');
  }
});

test('a tile is a plain link: the page works with no script at all', () => {
  assert.ok(!/onclick=/.test(page.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline handlers on the tiles');
  assert.ok(!/firebase/i.test(page), 'no sign-in on the dashboard itself — every app signs the student in');
  assert.equal((page.match(/<li style="--order:\d+">/g) || []).length, EXPECTED.length, 'each tile staggers in by its order');
});

test('one dashboard: the copy at /cer/student/ steps over to /student/ on polymathlc.com.sg only', () => {
  const redirect = page.match(/<script>\s*([\s\S]*?location\.replace[\s\S]*?)<\/script>/);
  assert.ok(redirect, 'the redirect runs before anything else');
  const run = (hostname, pathname) => {
    let target = null;
    const location = { hostname, pathname, search: '?a=1', hash: '#x', replace: url => { target = url; } };
    vm.runInNewContext(redirect[1], { location });
    return target;
  };
  assert.equal(run('polymathlc.com.sg', '/cer/student/'), '/student/?a=1#x');
  assert.equal(run('www.polymathlc.com.sg', '/cer/student/index.html'), '/student/?a=1#x');
  assert.equal(run('polymathlc.com.sg', '/student/'), null, 'already home');
  assert.equal(run('polymathlc.github.io', '/cer/student/'), null, 'github.io has no /student/ to go to');
});

test('the greeting reads Singapore time, and the version is on the page', () => {
  const script = page.match(/<script>\s*(\/\* My Polymath[\s\S]*?)<\/script>/);
  assert.ok(script, 'the page script');
  const elements = {};
  const sandbox = {
    window: { localStorage: { getItem: () => null, setItem() {} }, print() {} },
    document: {
      getElementById: id => (elements[id] = elements[id] || { textContent: '', addEventListener() {} }),
      querySelectorAll: () => []
    },
    Date
  };
  vm.runInNewContext(script[1], sandbox);
  const api = sandbox.window.MyPolymath;
  assert.equal(api.version, 'v1.0.0');
  assert.equal(elements.versionBadge.textContent, 'v1.0.0', 'the badge shows the version');
  assert.equal(api.singaporeHour(new Date(Date.UTC(2026, 9, 25, 0, 0))), 8, '00:00 UTC is 8 am in Singapore');
  assert.equal(api.greetingFor(8), 'Good morning');
  assert.equal(api.greetingFor(14), 'Good afternoon');
  assert.equal(api.greetingFor(21), 'Good evening');
  assert.equal(api.greetingFor(2), 'Good evening');
});

test('the dashboard is an installable app of its own, and says how to install the others', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dashboardDir, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'My Polymath');
  assert.equal(manifest.scope, './');
  const controls = page.match(/<button[^>]*data-pwa-install[^>]*>/g) || [];
  assert.ok(controls.length >= 2, 'an Install button in the header and in the help card');
  assert.ok(/Every app has its own <b>📲 Install app<\/b> button/.test(page), 'the help card says every app has its own');
});
