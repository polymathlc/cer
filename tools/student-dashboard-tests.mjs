// 🧭 My Polymath — the student dashboard (student/, v1.2.0) and the site's 404
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
  assert.equal(api.version, 'v1.2.0');
  assert.equal(elements.versionBadge.textContent, 'v1.2.0', 'the badge shows the version');
  assert.ok(page.includes('id="versionBadge" aria-hidden="true">v1.2.0<'), 'the badge is right before script runs too');
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
