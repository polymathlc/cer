// 🧭 My Polymath — the student dashboard (student/, v1.3.0) and the site's 404
// forwarder (404.html, forward v1.0.0). Holds every tile to the address its app
// is ACTUALLY published at and to its icon, and every short address the
// dashboard prints to the tile it belongs to — so a renamed folder, a missing
// picture or a link that only exists on paper is caught here rather than by a
// student tapping a tile and landing on GitHub's "404 File not found" (which is
// exactly what every tile did in v1.1: they linked /math/, /cer/ … on
// polymathlc.com.sg, where no app has ever been published).
//
//   node --test tools/student-dashboard-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboardDir = path.join(root, 'student');
const HTML = fs.readFileSync(path.join(dashboardDir, 'index.html'), 'utf8');
const page = HTML.replace(/<!--[\s\S]*?-->/g, '');
const NOT_FOUND = fs.readFileSync(path.join(root, '404.html'), 'utf8');
const MATH_PAGE = fs.readFileSync(path.join(root, 'math.html'), 'utf8');

// Where the student apps are published: each by its own repository, on GitHub Pages' own domain.
// polymathlc.com.sg is the custom domain of polymathlc/website (the mirror of THIS repo) and nothing else.
const APP_ORIGIN = 'https://polymathlc.github.io';
const SITE = 'polymathlc.com.sg';

// The apps, in the order the owner listed them, with Science PSLE beside Science.
// `repo` is the repository that publishes the app; `address` is what the printed sheet tells a student to type.
const EXPECTED = [
  { app: 'science', name: 'Science', href: APP_ORIGIN + '/cer/', repo: 'cer', address: SITE + '/cer' },
  { app: 'psle', name: 'Science PSLE', href: APP_ORIGIN + '/cer/#psle', repo: 'cer', address: SITE + '/cer/#psle' },
  { app: 'math', name: 'Math', href: APP_ORIGIN + '/math/', repo: 'math', address: SITE + '/math' },
  { app: 'anskey', name: 'Answer Keys', href: APP_ORIGIN + '/anskey/', repo: 'anskey', address: SITE + '/anskey' },
  { app: 'tutor', name: 'Study Buddy', href: APP_ORIGIN + '/tutor/', repo: 'tutor', address: SITE + '/tutor' },
  { app: 'rewards', name: 'Rewards', href: APP_ORIGIN + '/rewards/', repo: 'rewards', address: SITE + '/rewards' },
  { app: 'online', name: 'Worksheets', href: 'https://' + SITE + '/online/', repo: null, address: 'Coming soon' },
  { app: 'chinese', name: 'Chinese', href: APP_ORIGIN + '/chinese/', repo: 'chinese', address: SITE + '/chinese' },
  { app: 'english', name: 'English', href: APP_ORIGIN + '/english/', repo: 'english', address: SITE + '/english' }
];

// Apps not open to students yet: their tile has no href (nothing to follow, with or without script),
// keeps its address in data-href and says why when tapped. Opening one is a markup change.
const LOCKED = ['online'];

function tiles() {
  return [...page.matchAll(/<a class="app-tile( is-locked)?" data-app="([^"]+)" (?:href|data-href)="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => ({
    locked: !!match[1],
    tag: match[0].slice(0, match[0].indexOf('>') + 1),
    app: match[2],
    href: match[3],
    name: (match[4].match(/<span class="tile-name">([^<]+)<\/span>/) || [])[1],
    blurb: (match[4].match(/<span class="tile-blurb">([^<]+)<\/span>/) || [])[1],
    icon: (match[4].match(/<img class="tile-icon" src="([^"]+)"/) || [])[1],
    address: (match[4].match(/<span class="print-address">([^<]+)<\/span>/) || [])[1],
    lockBadge: /<span class="tile-lock">/.test(match[4]),
    style: (match[0].match(/style="([^"]+)"/) || [])[1] || ''
  }));
}

function pngSize(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('latin1', 1, 4), 'PNG', file + ' is a PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

// The 404 page's forwarder, run exactly as shipped: the FIRST inline script, in <head>, before anything is drawn.
// The document records its DOMContentLoaded listeners so a test can say when parsing "finishes".
function loadForwarder(location = { hostname: 'polymathlc.github.io', pathname: '/cer/nowhere', search: '', hash: '', replace() {} }) {
  const scripts = [...NOT_FOUND.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length >= 2, '404.html has its forwarding script in <head> and its card script at the end of <body>');
  const listeners = [];
  const document = {
    documentElement: { className: '' },
    addEventListener: (type, listener) => { if (type === 'DOMContentLoaded') listeners.push(listener); }
  };
  const sandbox = { window: { location, document } };
  vm.runInNewContext(scripts[0], sandbox);
  sandbox.window.domContentLoaded = () => listeners.forEach(listener => listener());
  return sandbox.window;
}

// Where a browser would land: a forward if the 404 page sends it on, else the 404 page itself.
function visit(hostname, pathname, search = '', hash = '') {
  let landed = null;
  const location = { hostname, pathname, search, hash, replace: url => { landed = url; } };
  const win = loadForwarder(location);
  win.domContentLoaded();
  return { landed, target: win.PolymathForward.target, className: win.document.documentElement.className };
}

// "polymathlc.com.sg/cer/#psle" → the parts a browser's location would hold.
function parseAddress(address) {
  const url = new URL('https://' + address);
  return { hostname: url.hostname, pathname: url.pathname, search: url.search, hash: url.hash };
}

test('one square tile per app, in the owner\'s order, each going to the address its app is published at', () => {
  const found = tiles();
  assert.deepEqual(found.map(tile => ({ app: tile.app, name: tile.name, href: tile.href })),
    EXPECTED.map(({ app, name, href }) => ({ app, name, href })));
  for (const tile of found) {
    assert.ok(tile.blurb && tile.blurb.length <= 48, tile.name + ' has a short line under it');
    assert.match(tile.style, /--tile-wash:#[0-9A-F]{6};--tile-ink:#[0-9A-F]{6}/i, tile.name + ' has its colours');
    const expected = EXPECTED.find(row => row.app === tile.app);
    assert.equal(tile.address, expected.address, tile.name + ' prints the address a student should type');
  }
});

test('regression (v1.1): no tile links root-relative — polymathlc.com.sg has no app folders, so "/math/" was a 404', () => {
  for (const tile of tiles()) {
    assert.ok(!tile.href.startsWith('/'), tile.name + ' (' + tile.href + ') must not be root-relative');
    assert.match(tile.href, /^https:\/\//, tile.name + ' links by an absolute https address');
    const url = new URL(tile.href);
    const expected = EXPECTED.find(row => row.app === tile.app);
    if (expected.repo) {
      assert.equal(url.origin, APP_ORIGIN, tile.name + ' opens on the apps\' own origin (one origin = one sign-in)');
      assert.equal(url.pathname, '/' + expected.repo + '/', tile.name + ' opens the front page of polymathlc/' + expected.repo);
    } else {
      assert.equal(url.hostname, SITE, tile.name + ' is published on the website itself');
      const folder = url.pathname.replace(/^\/|\/$/g, '');
      assert.ok(fs.existsSync(path.join(root, folder, 'index.html')),
        tile.name + ': ' + folder + '/index.html is in this repo, so the website sync really puts it at ' + url.pathname);
    }
  }
  assert.ok(!/href="\/(cer|math|anskey|tutor|rewards|chinese|english)\//.test(page), 'no root-relative app link survives anywhere on the page');
});

test('every app tile goes to a repository the 404 forwarder knows, and the names agree', () => {
  const forward = loadForwarder().PolymathForward;
  assert.equal(forward.appOrigin, APP_ORIGIN, 'the tiles and the forwarder point at the same origin');
  const repos = new Set(EXPECTED.filter(row => row.repo).map(row => row.repo));
  assert.deepEqual([...repos].sort(), Object.keys(forward.appRepos).sort(), 'one forwarder entry per app repository, no more, no fewer');
  for (const row of EXPECTED.filter(row => row.repo && row.app !== 'psle')) {
    assert.equal(forward.appRepos[row.repo], row.name, row.repo + ' is called the same thing on the tile and on the way there');
  }
});

// What GitHub Pages answers a bare /name with: name.html when this repo has one (then THAT page must forward),
// otherwise nothing — so 404.html. The trailing-slash form /name/ only ever finds name/index.html, then 404.html.
function landsOn(hostname, pathname, search = '', hash = '') {
  const bare = /^\/([^/]+)$/.exec(pathname);
  if (bare && fs.existsSync(path.join(root, bare[1] + '.html'))) {
    assert.equal(bare[1], 'math', bare[1] + '.html would answer ' + pathname + ' and only math.html carries a forward');
    return mathPageForward(hostname, pathname, search, hash);
  }
  return visit(hostname, pathname, search, hash).landed;
}

test('🖨 every short address on the printed sheet really opens its app (through 404.html, or math.html for /math)', () => {
  for (const tile of tiles().filter(tile => !tile.locked)) {
    const { hostname, pathname, search, hash } = parseAddress(tile.address);
    const forwarded = landsOn(hostname, pathname, search, hash);
    assert.equal(forwarded, tile.href, tile.address + ' lands on ' + tile.name);
    // …and typed with a trailing slash, as half the class will.
    if (!hash && !pathname.endsWith('/')) {
      assert.equal(visit(hostname, pathname + '/', search, hash).landed, tile.href, tile.address + '/ lands on ' + tile.name + ' too');
    }
  }
});

test('404 forwarder: each app\'s short address, deep links, ?queries and #hashes, on both spellings of the domain', () => {
  const cases = [
    ['polymathlc.com.sg', '/cer/', '', '', APP_ORIGIN + '/cer/'],
    ['polymathlc.com.sg', '/cer', '', '', APP_ORIGIN + '/cer/'],
    ['polymathlc.com.sg', '/cer/', '', '#psle', APP_ORIGIN + '/cer/#psle'],
    ['polymathlc.com.sg', '/cer/polymath.html', '', '#abc123/4', APP_ORIGIN + '/cer/polymath.html#abc123/4'],
    ['polymathlc.com.sg', '/math/', '', '', APP_ORIGIN + '/math/'],
    ['polymathlc.com.sg', '/MATH/', '', '', APP_ORIGIN + '/math/'],
    ['polymathlc.com.sg', '/anskey/', '?ws=abc&do=view', '', APP_ORIGIN + '/anskey/?ws=abc&do=view'],
    ['polymathlc.com.sg', '/tutor', '', '#ws=1', APP_ORIGIN + '/tutor/#ws=1'],
    ['polymathlc.com.sg', '/rewards/', '', '', APP_ORIGIN + '/rewards/'],
    ['polymathlc.com.sg', '/chinese/', '', '', APP_ORIGIN + '/chinese/'],
    ['polymathlc.com.sg', '/english/lesson.html', '?u=2', '#top', APP_ORIGIN + '/english/lesson.html?u=2#top'],
    ['www.polymathlc.com.sg', '/math/', '', '', APP_ORIGIN + '/math/'],
    ['POLYMATHLC.COM.SG', '/english/', '', '', APP_ORIGIN + '/english/'],
    ['polymathlc.com.sg.', '/math/', '', '', APP_ORIGIN + '/math/']
  ];
  for (const [hostname, pathname, search, hash, expected] of cases) {
    const result = visit(hostname, pathname, search, hash);
    assert.equal(result.landed, expected, hostname + pathname + search + hash);
    assert.match(result.className, /is-forwarding/, 'the page says where it is going while it goes');
    assert.equal(result.target.sameSite, false);
  }
});

test('404 forwarder: decides in <head> but leaves only once the page is parsed, so a slow connection shows "Opening Math…"', () => {
  // A navigation started from <head> makes the browser abandon the rest of the document: the card in <body>
  // would never be drawn and a student on a slow connection would see a blank page.
  const replaced = [];
  const location = { hostname: SITE, pathname: '/math/', search: '', hash: '', replace: url => replaced.push(url) };
  const win = loadForwarder(location);
  assert.deepEqual(replaced, [], 'nothing navigates while <head> is still being read');
  assert.match(win.document.documentElement.className, /is-forwarding/, 'but the "Opening…" card is already chosen over "not found"');
  assert.equal(win.PolymathForward.target.name, 'Math');
  win.domContentLoaded();
  assert.deepEqual(replaced, [APP_ORIGIN + '/math/'], 'then it goes, once');
  win.PolymathForward.go();
  win.domContentLoaded();
  assert.deepEqual(replaced, [APP_ORIGIN + '/math/'], 'go() is safe to call again (end-of-body script and DOMContentLoaded both call it)');

  // The script at the end of <body> fills the card from the target and calls go().
  const bodyScript = [...NOT_FOUND.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).pop();
  assert.match(bodyScript, /api\.go\(\)/, 'the end of <body> sends the student on as soon as the card is filled');
  assert.match(bodyScript, /forwardName'\)\.textContent = api\.target\.name/, 'the card names the app as text');
  assert.ok(NOT_FOUND.indexOf(bodyScript) > NOT_FOUND.indexOf('id="forwardLink"'), 'and it runs after the card exists');
});

test('404 forwarder: the names a child types (/science, /psle, /maths, /studybuddy …) go to the front door', () => {
  const cases = [
    ['/science', APP_ORIGIN + '/cer/'],
    ['/Science/', APP_ORIGIN + '/cer/'],
    ['/psle', APP_ORIGIN + '/cer/#psle'],
    ['/maths', APP_ORIGIN + '/math/'],
    ['/answers', APP_ORIGIN + '/anskey/'],
    ['/answer-keys', APP_ORIGIN + '/anskey/'],
    ['/studybuddy', APP_ORIGIN + '/tutor/'],
    ['/study-buddy/', APP_ORIGIN + '/tutor/'],
    ['/reward', APP_ORIGIN + '/rewards/'],
    ['/maths/some/page', APP_ORIGIN + '/math/']
  ];
  for (const [pathname, expected] of cases) assert.equal(visit(SITE, pathname).landed, expected, pathname);
  const psle = visit(SITE, '/psle');
  assert.equal(psle.target.name, 'Science PSLE', 'the forwarding card names the page, not just the app');
  assert.equal(visit(SITE, '/psle', '', '#other').landed, APP_ORIGIN + '/cer/#other', 'a hash the student typed wins over the alias\'s own');
});

test('404 forwarder: the dashboard\'s second copy at /cer/student/ steps over to its one address on the same domain', () => {
  assert.equal(visit(SITE, '/cer/student').landed, '/student/');
  assert.equal(visit(SITE, '/cer/student/').landed, '/student/');
  assert.equal(visit(SITE, '/cer/student/', '?a=1', '#x').landed, '/student/?a=1#x');
  assert.equal(visit(SITE, '/cer/student/offline.html').landed, '/student/offline.html');
  assert.equal(visit(SITE, '/cer/student/').target.sameSite, true);
  assert.equal(visit(SITE, '/cer/students/').landed, APP_ORIGIN + '/cer/students/', 'only the real folder name, not a lookalike');
});

test('404 forwarder: never forwards off polymathlc.github.io (the next 404 there is this page again — a loop)', () => {
  for (const pathname of ['/cer/missing', '/cer/math/', '/math/missing.html', '/cer/student/', '/cer/psle', '/']) {
    const result = visit('polymathlc.github.io', pathname);
    assert.equal(result.landed, null, 'github.io' + pathname + ' stays put');
    assert.equal(result.target, null);
    assert.doesNotMatch(result.className, /is-forwarding/);
  }
  for (const hostname of ['localhost', 'evil.example', 'polymathlc.com.sg.evil.example', 'notpolymathlc.com.sg']) {
    assert.equal(visit(hostname, '/math/').landed, null, hostname + ' is not this site');
  }
});

test('404 forwarder: anything that is not an app is a plain "page not found", and every forward stays on a fixed host', () => {
  for (const pathname of ['/', '/mathematics/', '/matheus', '/no-such-page', '/student/missing', '/online/missing', '/constructor/', '/__proto__/', '/hasOwnProperty']) {
    assert.equal(visit(SITE, pathname).landed, null, pathname + ' is not an app');
  }
  // The host is never taken from the address, so no path can turn this into an open redirect.
  for (const pathname of ['/math//evil.example/x', '/cer/%2F%2Fevil.example', '/tutor/@evil.example', '/science//evil.example']) {
    const landed = visit(SITE, pathname).landed;
    assert.equal(new URL(landed, 'https://' + SITE).origin, APP_ORIGIN, pathname + ' still lands on ' + APP_ORIGIN);
  }
});

test('404 forwarder: no short address is shadowed by a real file the website already serves', () => {
  const forward = loadForwarder().PolymathForward;
  const names = [...Object.keys(forward.appRepos), ...Object.keys(forward.appAliases)];
  for (const name of names) {
    // A folder of that name would answer /name/ itself and the forward would silently never happen.
    assert.ok(!fs.existsSync(path.join(root, name)), name + '/ must not exist at the top of this repo (the website root)');
    // A name.html would answer a bare /name — only math.html does, and it carries its own forward (next test).
    if (name !== 'math') assert.ok(!fs.existsSync(path.join(root, name + '.html')), name + '.html must not exist at the top of this repo');
  }
});

// math.html's guard, run exactly as shipped: GitHub Pages answers a bare /math with math.html, not with 404.html.
function mathPageForward(hostname, pathname, search = '', hash = '') {
  const guard = MATH_PAGE.match(/<script>\s*(\/\/ 🔀[\s\S]*?)<\/script>/);
  assert.ok(guard, 'math.html carries its forward');
  let landed = null;
  vm.runInNewContext(guard[1], { location: { hostname, pathname, search, hash, replace: url => { landed = url; } } });
  return landed;
}

test('math.html: the bare /math on the custom domain opens the Math app; math.html itself, and github.io, stay put', () => {
  assert.ok(MATH_PAGE.indexOf('// 🔀') < MATH_PAGE.indexOf('<title>'), 'the guard runs before the page draws anything');
  assert.equal(mathPageForward(SITE, '/math'), APP_ORIGIN + '/math/');
  assert.equal(mathPageForward(SITE, '/math/'), APP_ORIGIN + '/math/');
  assert.equal(mathPageForward('www.' + SITE, '/math', '?x=1', '#y'), APP_ORIGIN + '/math/?x=1#y');
  assert.equal(mathPageForward(SITE, '/math.html'), null, 'math-worksheet.html links math.html: that page must still open');
  assert.equal(mathPageForward('polymathlc.github.io', '/cer/math'), null, 'github.io is never forwarded');
  assert.equal(mathPageForward('polymathlc.github.io', '/cer/math.html'), null);
  assert.ok(MATH_PAGE.includes("'" + APP_ORIGIN + "/math/'"), 'the same origin as the tiles and the 404 page');
});

test('the 404 page works at any depth: self-contained, every link absolute, and the address shown as text only', () => {
  const body = NOT_FOUND.replace(/<!--[\s\S]*?-->/g, '');
  for (const [, attr, value] of body.matchAll(/\s(href|src)="([^"]*)"/g)) {
    assert.match(value, /^(https:\/\/|data:image\/png;base64,)/, attr + '="' + value.slice(0, 40) + '" must be absolute or inline');
  }
  assert.ok(!/<link\b/i.test(body), 'no stylesheets or fonts from elsewhere');
  assert.ok(!/<script\s+src=/i.test(body), 'no scripts from elsewhere');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(body), 'the visitor\'s address never becomes markup');
  assert.ok(/<meta name="robots" content="noindex">/.test(body), 'search engines do not list the 404 page');
  assert.ok(body.includes('href="https://polymathlc.com.sg/student/"'), 'a way back to every app');
  assert.ok(body.includes('href="https://polymathlc.com.sg/"'), 'and to the home page');
});

test('a tile is a plain link: the page works with no script at all', () => {
  assert.ok(!/onclick=/.test(page.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline handlers on the tiles');
  assert.ok(!/firebase/i.test(page), 'no sign-in on the dashboard itself — every app signs the student in');
  assert.equal((page.match(/<li style="--order:\d+">/g) || []).length, EXPECTED.length, 'each tile staggers in by its order');
  assert.ok(/<link rel="preconnect" href="https:\/\/polymathlc\.github\.io">/.test(page), 'the apps\' origin is warmed up while the student picks a tile');
});

test('🔒 Worksheets is locked until every level\'s worksheets are uploaded', () => {
  const found = tiles();
  assert.deepEqual(found.filter(tile => tile.locked).map(tile => tile.app), LOCKED, 'exactly these tiles are locked');
  for (const tile of found) {
    if (tile.locked) {
      assert.ok(!/\shref="/.test(tile.tag), tile.name + ': no href, so there is nothing to follow even without script');
      assert.ok(/data-href="https:\/\/polymathlc\.com\.sg\/online\/"/.test(tile.tag), tile.name + ': its address is kept for the day it opens');
      assert.ok(/aria-disabled="true"/.test(tile.tag) && /data-locked="[^"]+"/.test(tile.tag), tile.name + ': says it is not open, and why');
      assert.ok(tile.lockBadge, tile.name + ': wears the 🔒 Coming soon badge');
      assert.equal(tile.address, 'Coming soon', tile.name + ': the printed sheet does not hand out an address that is shut');
    } else {
      assert.ok(/\shref="https:\/\//.test(tile.tag), tile.name + ': an open tile is a real link');
      assert.ok(!tile.lockBadge, tile.name + ': no lock');
    }
  }
});

test('every tile icon is a real picture next to the page', () => {
  for (const tile of tiles()) {
    const file = path.join(dashboardDir, tile.icon);
    assert.ok(fs.existsSync(file), tile.icon + ' exists');
    assert.deepEqual(pngSize(file), [192, 192], tile.icon + ' is 192 × 192');
  }
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
  assert.equal(api.version, 'v1.3.0');
  assert.equal(elements.versionBadge.textContent, 'v1.3.0', 'the badge shows the version');
  assert.ok(page.includes('id="versionBadge" aria-hidden="true">v1.3.0<'), 'the badge is right before script runs too');
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

// ───────────── 📲 the install icon is the Polymath logo (My Polymath v1.3.0) ─────────────
//
// The dashboard installs as "My Polymath" with the official Polymath sticker
// (assets/branding/polymath-learning-centre.png) on a tile in the logo's own two
// teals, drawn by tools/my-polymath-icons.py. v1.0–v1.2 installed with a grid of
// four coloured squares the kit drew; rerunning the kit's icon maker would put
// that grid straight back, and nothing else would notice — so these tests decode
// the PNGs and hold them to the generator's rules. The colours and the safe-zone
// radius are READ from the generator, so the two can never drift apart.

const ICON_DIR = path.join(dashboardDir, 'assets', 'app-icons');
const GENERATOR = fs.readFileSync(path.join(root, 'tools', 'my-polymath-icons.py'), 'utf8');

/** A Python constant from the generator: a number, or an (r, g, b) tuple of hex/decimal ints. */
function generatorConstant(name) {
  const line = GENERATOR.match(new RegExp('^' + name + '\\s*=\\s*(.+?)\\s*(?:#.*)?$', 'm'));
  assert.ok(line, 'tools/my-polymath-icons.py defines ' + name);
  const value = line[1].trim();
  if (value.startsWith('(')) return value.slice(1, -1).split(',').map(part => Number(part.trim()));
  return Number(value);
}
const TEAL_LIGHT = generatorConstant('TEAL_LIGHT');
const TEAL_DEEP = generatorConstant('TEAL_DEEP');
const BLEND_DOWN = generatorConstant('BLEND_DOWN');
const BLEND_ACROSS = generatorConstant('BLEND_ACROSS');
const SAFE_RADIUS = generatorConstant('SAFE_RADIUS');
const WORK = generatorConstant('WORK');

/**
 * A small, dependency-free PNG decoder: 8-bit, non-interlaced, any colour type,
 * all five row filters. Returns RGBA pixels. Enough for the icons this repo
 * writes (Pillow's optimize=True keeps RGB / RGBA), and strict about anything else.
 */
function decodePng(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('latin1', 1, 4), 'PNG', path.basename(file) + ' is a PNG');
  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const data = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colourType: body[9], interlace: body[12] };
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      transparency = body;
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  assert.ok(header, path.basename(file) + ' has a header');
  assert.equal(header.depth, 8, path.basename(file) + ' is 8 bits a channel');
  assert.equal(header.interlace, 0, path.basename(file) + ' is not interlaced');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colourType];
  assert.ok(channels, path.basename(file) + ' has a known colour type');
  const { width, height } = header;
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  assert.equal(raw.length, height * (stride + 1), path.basename(file) + ' holds exactly its pixels');
  const rows = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = rows.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toUpLeft = Math.abs(estimate - upLeft);
        value += toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
      } else assert.equal(filter, 0, path.basename(file) + ': row filter ' + filter + ' is one of the five');
      current[i] = value & 255;
    }
    previous = current;
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const source = rows.subarray(p * channels, (p + 1) * channels);
    let pixel;
    if (header.colourType === 6) pixel = [source[0], source[1], source[2], source[3]];
    else if (header.colourType === 2) pixel = [source[0], source[1], source[2], 255];
    else if (header.colourType === 4) pixel = [source[0], source[0], source[0], source[1]];
    else if (header.colourType === 0) pixel = [source[0], source[0], source[0], 255];
    else {
      const index = source[0];
      pixel = [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], transparency && index < transparency.length ? transparency[index] : 255];
    }
    rgba.set(pixel, p * 4);
  }
  return {
    width,
    height,
    colourType: header.colourType,
    rgba,
    at: (x, y) => [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
  };
}

/** What the tile alone looks like at (x, y) of a size × size icon: the generator's blend, sampled at the pixel's centre. */
function tileColour(x, y, size) {
  const toWork = coordinate => Math.min(WORK - 1, Math.max(0, (coordinate + 0.5) * WORK / size - 0.5));
  const t = (toWork(y) / (WORK - 1)) * BLEND_DOWN + (toWork(x) / (WORK - 1)) * BLEND_ACROSS;
  return TEAL_LIGHT.map((light, channel) => light * (1 - t) + TEAL_DEEP[channel] * t);
}

const TILE_TOLERANCE = 4;          // per channel: a downsampled linear blend is still the blend, give or take rounding
const isTile = (pixel, x, y, size) => tileColour(x, y, size).every((value, channel) => Math.abs(pixel[channel] - value) <= TILE_TOLERANCE);
const isStickerWhite = pixel => pixel[0] >= 235 && pixel[1] >= 235 && pixel[2] >= 235;
// The M mark's bright magenta face (#EC008C). The wordmark's magenta is the darker #B5196A, so this is the mark itself.
const isLogoMagenta = pixel => pixel[0] >= 200 && pixel[1] <= 60 && pixel[2] >= 100 && pixel[2] <= 180;

const LOGO_ICONS = [
  { file: 'icon-192.png', size: 192, purpose: 'any' },
  { file: 'icon-512.png', size: 512, purpose: 'any' },
  { file: 'maskable-192.png', size: 192, purpose: 'maskable' },
  { file: 'maskable-512.png', size: 512, purpose: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, purpose: 'apple' }
];

/** Count pixels matching a predicate, and the bounding box of those that do. */
function survey(image, predicate) {
  let count = 0;
  let left = image.width, right = -1, top = image.height, bottom = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (!predicate(image.at(x, y), x, y)) continue;
      count++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return { count, share: count / (image.width * image.height), left, right, top, bottom };
}

test('the install icons are the Polymath logo on the teal tile — every size, opaque, edge to edge', () => {
  for (const icon of LOGO_ICONS) {
    const image = decodePng(path.join(ICON_DIR, icon.file));
    assert.deepEqual([image.width, image.height], [icon.size, icon.size], icon.file + ' is ' + icon.size + ' × ' + icon.size);
    // Opaque everywhere: iOS paints a transparent pixel black, and a maskable icon must be full-bleed.
    const seeThrough = survey(image, pixel => pixel[3] !== 255);
    assert.equal(seeThrough.count, 0, icon.file + ' is opaque');
    // The tile shows in all four corners (the v1.0–v1.2 grid sat on white, so this alone tells them apart).
    for (const [x, y] of [[1, 1], [icon.size - 2, 1], [1, icon.size - 2], [icon.size - 2, icon.size - 2]]) {
      assert.ok(isTile(image.at(x, y), x, y, icon.size), `${icon.file}: the teal tile at (${x}, ${y}), got ${image.at(x, y).slice(0, 3)} for ${tileColour(x, y, icon.size).map(Math.round)}`);
    }
    // The sticker: its white body, and the M mark's bright magenta, in the middle of the tile.
    const white = survey(image, isStickerWhite);
    const magenta = survey(image, isLogoMagenta);
    assert.ok(white.share >= (icon.purpose === 'maskable' ? 0.12 : 0.2), `${icon.file}: the white sticker covers ${(white.share * 100).toFixed(1)} % of the tile`);
    assert.ok(magenta.share >= 0.004, `${icon.file}: the logo's magenta is there (${(magenta.share * 100).toFixed(2)} %)`);
    const middle = (white.left + white.right) / 2;
    assert.ok(Math.abs(middle - (icon.size - 1) / 2) <= icon.size * 0.03, icon.file + ': the sticker is centred left to right');
    assert.ok(magenta.left > white.left && magenta.right < white.right && magenta.top > white.top && magenta.bottom < white.bottom, icon.file + ': the M sits on the sticker');
  }
});

test('an "any" icon fills the tile with the logo, and keeps an edge of plain tile round it', () => {
  for (const icon of LOGO_ICONS.filter(entry => entry.purpose !== 'maskable')) {
    const image = decodePng(path.join(ICON_DIR, icon.file));
    const white = survey(image, isStickerWhite);
    assert.ok((white.right - white.left + 1) / icon.size >= 0.8, `${icon.file}: the sticker spans ${(((white.right - white.left + 1) / icon.size) * 100).toFixed(0)} % of the width — big enough to read POLYMATH on a home screen`);
    // A band of plain tile 4 % deep all the way round: the logo never touches the edge, and iOS's rounded corners never clip it.
    const band = Math.max(2, Math.round(icon.size * 0.04));
    const offTile = survey(image, (pixel, x, y) => (x < band || y < band || x >= icon.size - band || y >= icon.size - band) && !isTile(pixel, x, y, icon.size));
    assert.equal(offTile.count, 0, `${icon.file}: only tile in the outer ${band} px (first stray pixel at ${offTile.left},${offTile.top})`);
  }
});

test('a maskable icon keeps the whole sticker inside the safe circle, so no launcher can crop the logo', () => {
  for (const icon of LOGO_ICONS.filter(entry => entry.purpose === 'maskable')) {
    const image = decodePng(path.join(ICON_DIR, icon.file));
    const centre = icon.size / 2;
    // One pixel of slack for the resampling's soft edge; everything beyond it is tile and nothing else.
    const limit = SAFE_RADIUS * icon.size + 1;
    const outside = survey(image, (pixel, x, y) => Math.hypot(x + 0.5 - centre, y + 0.5 - centre) > limit && !isTile(pixel, x, y, icon.size));
    assert.equal(outside.count, 0, `${icon.file}: nothing but tile outside the ${SAFE_RADIUS * 100} % safe circle (first stray pixel at ${outside.left},${outside.top})`);
    const white = survey(image, isStickerWhite);
    assert.ok((white.right - white.left + 1) / icon.size >= 0.55, icon.file + ': and the sticker still uses the circle, not a corner of it');
  }
  assert.equal(SAFE_RADIUS, 0.4, 'the W3C maskable safe zone is a circle of radius 40 %');
});

test('the tab icon is the M mark alone, on transparent', () => {
  const image = decodePng(path.join(ICON_DIR, 'favicon-32.png'));
  assert.deepEqual([image.width, image.height], [32, 32]);
  for (const [x, y] of [[0, 0], [31, 0], [0, 31], [31, 31]]) assert.equal(image.at(x, y)[3], 0, `favicon-32.png: corner (${x}, ${y}) is see-through`);
  assert.ok(survey(image, isLogoMagenta).count >= 8, 'favicon-32.png: the magenta face of the M');
  assert.ok(survey(image, pixel => pixel[3] > 200 && pixel[2] > pixel[0] + 40 && pixel[1] > pixel[0] + 40).count >= 8, 'favicon-32.png: the teal face of the M');
  assert.equal(survey(image, pixel => pixel[3] > 200 && isStickerWhite(pixel)).count, 0, 'favicon-32.png: no white sticker body (no wordmark survives 32 px)');
});

test('the offline page carries the very same icon, and the install dialog and iPhone use the logo files', () => {
  const offline = fs.readFileSync(path.join(dashboardDir, 'offline.html'), 'utf8');
  const inline = offline.match(/<img src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
  assert.ok(inline, 'offline.html has its inline icon');
  assert.ok(Buffer.from(inline[1], 'base64').equals(fs.readFileSync(path.join(ICON_DIR, 'icon-192.png'))), 'offline.html shows icon-192.png byte for byte — rerun tools/my-polymath-icons.py, which writes both');
  assert.ok(/<script defer src="pwa-install\.js[^"]*"[^>]*data-app-icon="assets\/app-icons\/icon-192\.png"/.test(page), 'the install dialog shows the logo icon');
  assert.ok(/<link rel="apple-touch-icon" href="assets\/app-icons\/apple-touch-icon\.png">/.test(page), 'the iPhone / iPad icon is the logo icon');
  assert.ok(/<link rel="icon" type="image\/png" sizes="32x32" href="assets\/app-icons\/favicon-32\.png">/.test(page), 'the tab icon');
  const manifest = JSON.parse(fs.readFileSync(path.join(dashboardDir, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual(
    manifest.icons.map(icon => icon.src + ' ' + icon.purpose).sort(),
    LOGO_ICONS.filter(icon => icon.purpose !== 'apple').map(icon => 'assets/app-icons/' + icon.file + ' ' + (icon.purpose === 'maskable' ? 'maskable' : 'any')).sort(),
    'the manifest lists exactly the four logo icons'
  );
  const sw = fs.readFileSync(path.join(dashboardDir, 'sw.js'), 'utf8');
  assert.match(sw, /^const SW_VERSION = '2\.0\.2';/m, 'the worker moved on with the offline page, so installed copies re-cache the new icon');
});

test('My Polymath never installs with the Science portal\'s icon (a student with both would see two identical icons)', () => {
  for (const file of ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png']) {
    const ours = fs.readFileSync(path.join(ICON_DIR, file));
    const science = path.join(root, 'assets', 'app-icons', file);
    if (fs.existsSync(science)) assert.ok(!ours.equals(fs.readFileSync(science)), file + ' differs from the Science portal\'s');
  }
  const science = decodePng(path.join(root, 'assets', 'app-icons', 'icon-512.png'));
  const ours = decodePng(path.join(ICON_DIR, 'icon-512.png'));
  assert.ok(!isTile(science.at(1, 1), 1, 1, 512), 'the Science portal sits on white');
  assert.ok(isTile(ours.at(1, 1), 1, 1, 512), 'My Polymath sits on the teal tile');
});

test('the icons are made by tools/my-polymath-icons.py from the official logo, which is still there', () => {
  assert.ok(fs.existsSync(path.join(root, 'assets', 'branding', 'polymath-learning-centre.png')), 'the official logo the icons are cut from');
  assert.match(GENERATOR, /LOGO = REPO \/ 'assets' \/ 'branding' \/ 'polymath-learning-centre\.png'/, 'the generator reads the official logo');
  assert.match(HTML, /tools\/my-polymath-icons\.py/, 'the page says where its icon comes from');
  for (const colour of [TEAL_LIGHT, TEAL_DEEP]) {
    assert.equal(colour.length, 3);
    for (const channel of colour) assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255);
  }
  assert.ok(Math.abs(BLEND_DOWN + BLEND_ACROSS - 1) < 1e-9, 'the blend runs corner to corner');
});
