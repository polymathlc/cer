// 📲 Polymath install kit (v2.0.0) — the static checks.
//
// For every app folder in APP_DIRS: the manifest, the icons, index.html's head
// tags and installer tag, the service worker's rules and the offline page all
// agree with each other, and pwa-install.js's pure core decides what each
// browser should be shown. Run:
//
//   node --test tools/pwa-install-tests.mjs
//
// The same file ships in every repo that carries the kit; only APP_DIRS differs
// (a repo whose app is its root lists '.'; polymathlc/cer lists its two
// folders, 'online' and 'student').
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const APP_DIRS = ['online', 'student'];

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const fileIn = (dir, file) => path.join(repoRoot, dir, file);
const readIn = (dir, file) => fs.readFileSync(fileIn(dir, file), 'utf8');
const withoutComments = html => html.replace(/<!--[\s\S]*?-->/g, '');

function pngSize(absoluteFile) {
  const bytes = fs.readFileSync(absoluteFile);
  assert.equal(bytes.toString('latin1', 1, 4), 'PNG', absoluteFile + ' is a PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** The attributes of the <script> tag that loads pwa-install.js, as a plain object. */
function installerTag(html) {
  const tag = withoutComments(html).match(/<script\b[^>]*\bsrc="pwa-install\.js(?:\?v=([^"]*))?"[^>]*>/);
  assert.ok(tag, 'index.html loads pwa-install.js');
  const attributes = {};
  for (const [, name, value] of tag[0].matchAll(/\s([a-z-]+)(?:="([^"]*)")?/g)) attributes[name] = value === undefined ? true : value;
  return { raw: tag[0], version: tag[1] || '', attributes };
}

const Core = require(fileIn(APP_DIRS[0], 'pwa-install.js'));

// ───────────── the pure core ─────────────

test('platform and browser detection', () => {
  const iphoneSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const iphoneChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
  const ipadAsMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const androidChrome = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
  const samsung = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36';
  const windowsEdge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0';
  const whatsapp = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 WhatsApp/2.24';

  assert.equal(Core.platformOf(iphoneSafari, 5), 'ios');
  assert.equal(Core.platformOf(ipadAsMac, 5, 'MacIntel'), 'ios', 'iPadOS pretending to be a Mac is still an iPad');
  assert.equal(Core.platformOf(ipadAsMac, 0, 'MacIntel'), 'desktop', 'a real Mac has no touch screen');
  assert.equal(Core.platformOf(androidChrome, 5), 'android');
  assert.equal(Core.platformOf(windowsEdge, 0), 'desktop');

  assert.equal(Core.browserOf(iphoneSafari), 'safari');
  assert.equal(Core.browserOf(iphoneChrome), 'chrome');
  assert.equal(Core.browserOf(androidChrome), 'chrome');
  assert.equal(Core.browserOf(samsung), 'samsung');
  assert.equal(Core.browserOf(windowsEdge), 'edge');

  assert.equal(Core.inAppBrowser(whatsapp), true);
  assert.equal(Core.inAppBrowser(androidChrome), false);
});

test('what pressing Install app does, per platform and browser', () => {
  const appName = 'Polymath Test App';
  assert.deepEqual(Core.plan({ platform: 'desktop', browser: 'chrome', hasPrompt: true, appName }), { kind: 'prompt' });
  assert.deepEqual(Core.plan({ platform: 'android', browser: 'chrome', hasPrompt: true, appName }), { kind: 'prompt' });

  const samsung = Core.plan({ platform: 'android', browser: 'samsung', hasPrompt: true, appName });
  assert.equal(samsung.kind, 'steps', 'Samsung Internet never gets its own prompt (Play Protect warning)');
  assert.match(samsung.title, /with Chrome/);
  assert.ok(samsung.steps.some(step => step.includes('Add page to')));

  const iphone = Core.plan({ platform: 'ios', browser: 'safari', appName });
  assert.equal(iphone.kind, 'steps');
  assert.equal(iphone.title, 'Add Polymath Test App to your Home Screen', 'the app name is in the title');
  assert.ok(iphone.steps[0].includes('Share'));
  assert.ok(iphone.steps.some(step => step.includes('Add to Home Screen')));

  const inApp = Core.plan({ platform: 'ios', browser: 'safari', inApp: true, appName });
  assert.match(inApp.title, /browser first/);
  assert.ok(inApp.steps.some(step => step.includes('Open in Safari')));

  const macSafari = Core.plan({ platform: 'desktop', browser: 'safari', appName });
  assert.ok(macSafari.steps[0].includes('Add to Dock'));

  const firefoxDesktop = Core.plan({ platform: 'desktop', browser: 'firefox', appName });
  assert.ok(firefoxDesktop.steps[0].includes('cannot install'));

  const installed = Core.plan({ platform: 'ios', browser: 'safari', standalone: true, appName });
  assert.equal(installed.kind, 'installed');
  assert.equal(installed.title, 'Polymath Test App is installed');
});

test('app names and settings from the script tag are cleaned', () => {
  assert.equal(Core.cleanAppName(''), 'Polymath');
  assert.equal(Core.cleanAppName('  Polymath   Math  '), 'Polymath Math');
  assert.ok(Core.cleanAppName('x'.repeat(80)).length <= 40);

  const config = Core.readConfig({ appName: 'Polymath Math', appKey: 'math<script>', accent: 'red;}', sw: 'none', floating: 'sideways' });
  assert.equal(config.appKey, 'mathscript', 'the storage key keeps letters, digits, - and _ only');
  assert.equal(config.accent, '#0b6b4f', 'an accent that is not a hex colour falls back');
  assert.equal(config.serviceWorkerUrl, '', '"none" turns the worker off');
  assert.equal(config.floating, 'auto', 'an unknown floating mode means auto');
  assert.equal(Core.readConfig({}).serviceWorkerUrl, 'sw.js', 'the worker is sw.js by default');
});

test('the floating Install button appears only when it should', () => {
  const now = 1_800_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  assert.equal(Core.floatingWanted({ mode: 'auto', hasOwnControl: false, now }), true, 'no control of its own → float');
  assert.equal(Core.floatingWanted({ mode: 'auto', hasOwnControl: true, now }), false, 'the page has its own control → no float');
  assert.equal(Core.floatingWanted({ mode: 'always', hasOwnControl: true, now }), true);
  assert.equal(Core.floatingWanted({ mode: 'never', hasOwnControl: false, now }), false);
  assert.equal(Core.floatingWanted({ mode: 'always', standalone: true, now }), false, 'never inside the installed app');
  assert.equal(Core.floatingWanted({ mode: 'always', framed: true, now }), false, 'never inside another page\'s frame');
  assert.equal(Core.floatingWanted({ mode: 'auto', dismissedAt: now - day, now }), false, 'dismissed yesterday → still hidden');
  assert.equal(Core.floatingWanted({ mode: 'auto', dismissedAt: now - (Core.DISMISS_DAYS + 1) * day, now }), true, 'dismissed long ago → back');
  assert.equal(Core.floatingWanted({ mode: 'auto', dismissedAt: now + day, now }), true, 'a dismissal dated in the future (a wrong clock) does not hide it forever');
});

// ───────────── each app folder ─────────────

for (const dir of APP_DIRS) {
  const label = dir === '.' ? 'the app' : dir + '/';
  const html = readIn(dir, 'index.html');
  const manifest = JSON.parse(readIn(dir, 'manifest.webmanifest'));

  test(label + ': the manifest makes it installable', () => {
    assert.ok(manifest.name && manifest.name.length <= 45, 'a full name');
    assert.ok(manifest.short_name && manifest.short_name.length <= 12, 'short_name fits under a home-screen icon: ' + manifest.short_name);
    for (const key of ['id', 'start_url', 'scope']) assert.equal(manifest[key], './', key + ' is relative, so the same file works on polymathlc.com.sg and github.io');
    assert.equal(manifest.display, 'standalone');
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
    const anySizes = manifest.icons.filter(icon => icon.purpose === 'any').map(icon => icon.sizes);
    const maskableSizes = manifest.icons.filter(icon => icon.purpose === 'maskable').map(icon => icon.sizes);
    assert.ok(anySizes.includes('192x192') && anySizes.includes('512x512'), 'Chrome needs 192 and 512 icons');
    assert.ok(maskableSizes.includes('512x512'), 'Android gets a maskable icon');
    for (const icon of manifest.icons) {
      assert.ok(!icon.src.startsWith('/') && !/^https?:/.test(icon.src), icon.src + ' is relative and local');
      const [width, height] = pngSize(fileIn(dir, icon.src));
      assert.equal(`${width}x${height}`, icon.sizes, icon.src + ' is the size it claims');
    }
  });

  test(label + ': index.html links the manifest, the iPhone icon and the installer', () => {
    const page = withoutComments(html);
    assert.ok(page.includes('<link rel="manifest" href="manifest.webmanifest">'), 'manifest linked');
    const theme = page.match(/<meta name="theme-color" content="([^"]+)">/);
    assert.ok(theme, 'theme-color meta');
    assert.equal(theme[1].toLowerCase(), manifest.theme_color.toLowerCase(), 'theme colour matches the manifest');
    const touchIcon = page.match(/<link rel="apple-touch-icon"[^>]*href="([^"]+)"/);
    assert.ok(touchIcon, 'apple-touch-icon linked');
    assert.deepEqual(pngSize(fileIn(dir, touchIcon[1])), [180, 180], 'the iPhone icon is 180 × 180');
    const iosTitle = page.match(/<meta name="apple-mobile-web-app-title" content="([^"]+)">/);
    assert.ok(iosTitle, 'apple-mobile-web-app-title');
    assert.equal(iosTitle[1], manifest.short_name, 'the iPhone home-screen name matches short_name');
    assert.ok(page.includes('[data-pwa-install][data-pwa-hidden]{display:none!important}'), 'the hiding rule is in the head, before the installer runs');

    const tag = installerTag(html);
    assert.ok(tag.attributes.defer, 'pwa-install.js loads with defer');
    assert.equal(tag.version, Core.KIT_VERSION, 'the ?v= on the tag is the kit version, so a kit update reaches phones at once');
    assert.equal(tag.attributes['data-app-name'], manifest.name, 'data-app-name is the manifest name');
    assert.match(tag.attributes['data-app-key'] || '', /^[a-z0-9_-]+$/, 'data-app-key');
    assert.equal(tag.attributes['data-sw'], 'sw.js');
    assert.match(tag.attributes['data-accent'] || '', /^#[0-9a-f]{6}$/i, 'data-accent');
    assert.ok(['auto', 'always', 'never'].includes(tag.attributes['data-floating']), 'data-floating');
    const icon = tag.attributes['data-app-icon'];
    assert.ok(icon && fs.existsSync(fileIn(dir, icon)), 'data-app-icon exists: ' + icon);

    // Every control the page ships starts hidden (the installer shows it), so no flash inside the installed app.
    const controls = page.match(/<[a-z][^>]*\sdata-pwa-install[\s>=][^>]*>?/g) || [];
    for (const control of controls) assert.ok(control.includes('data-pwa-hidden'), 'starts hidden: ' + control);
  });

  test(label + ': the service worker only answers page loads, and only for this app', () => {
    const source = readIn(dir, 'sw.js');
    const sandbox = { self: { addEventListener() {}, location: { origin: 'https://polymathlc.com.sg' } }, URL, Response: class {}, Request: class {}, caches: {}, fetch() {} };
    vm.runInNewContext(source, sandbox);
    const sw = sandbox.self.__pwaSw;
    assert.ok(sw, 'sw.js exports its rules');
    const origin = 'https://polymathlc.com.sg';
    assert.equal(sw.handles({ method: 'GET', mode: 'navigate', url: origin + '/x/' }, origin), true, 'a page load');
    assert.equal(sw.handles({ method: 'GET', mode: 'no-cors', url: origin + '/x/app.js' }, origin), false, 'a script is left alone');
    assert.equal(sw.handles({ method: 'POST', mode: 'navigate', url: origin + '/x/' }, origin), false, 'a form post is left alone');
    assert.equal(sw.handles({ method: 'GET', mode: 'navigate', url: 'https://accounts.google.com/' }, origin), false, 'another origin is left alone');
    assert.match(sw.SW_VERSION, /^\d+\.\d+\.\d+$/);
    assert.match(sw.CACHE_PREFIX, /^polymath-[a-z0-9-]+-shell-$/, 'a cache prefix of its own');
    assert.notEqual(sw.CACHE_PREFIX, 'polymath-app-shell-', 'never the Science portal\'s prefix (same origin, shared Cache Storage)');
    assert.deepEqual(sw.staleCaches([sw.CACHE, sw.CACHE_PREFIX + '0.0.1', 'polymath-app-shell-1.0.0', 'other']), [sw.CACHE_PREFIX + '0.0.1'], 'only its own old caches are deleted');
    for (const file of sw.PRECACHE) assert.ok(fs.existsSync(fileIn(dir, file)), 'precached file exists: ' + file);
    const tag = installerTag(html);
    assert.ok(sw.CACHE_PREFIX.includes(tag.attributes['data-app-key']), 'the cache prefix names this app');
  });

  test(label + ': the offline page stands on its own', () => {
    const offline = readIn(dir, 'offline.html');
    assert.ok(!/<script[^>]+src=/.test(offline) && !/<link[^>]+stylesheet/.test(offline), 'no outside files (none can load offline)');
    const image = offline.match(/<img src="([^"]+)"/);
    assert.ok(image && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image[1]), 'its icon is inside the file — the worker answers page loads only, so an icon file could never arrive offline');
    assert.ok(offline.includes(manifest.name), 'it names the app');
  });
}

test('every folder carries the same pwa-install.js', () => {
  const hashes = new Set(APP_DIRS.map(dir => crypto.createHash('sha256').update(readIn(dir, 'pwa-install.js')).digest('hex')));
  assert.equal(hashes.size, 1, 'one kit, byte for byte');
  assert.match(readIn(APP_DIRS[0], 'pwa-install.js'), /const KIT_VERSION = '2\.0\.0';/);
});
