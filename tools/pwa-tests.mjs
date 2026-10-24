// 📲 Installable app: the manifest, the icons, the service worker's rules and
// pwa-install.js's pure core. Run: node --test tools/pwa-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const require = createRequire(import.meta.url);
const Core = require(path.join(root, 'pwa-install.js'));
const INDEX = read('index.html');
const APP_VERSION = read('app.js').match(/const APP_VERSION = 'v([^']+)'/)[1];
const manifest = JSON.parse(read('manifest.webmanifest'));

function pngSize(file) {
  const b = fs.readFileSync(path.join(root, file));
  assert.equal(b.toString('latin1', 1, 4), 'PNG', file + ' is a PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('the manifest makes the app installable from either address', () => {
  assert.equal(manifest.name, 'Polymath Learning Centre');
  assert.ok(manifest.short_name && manifest.short_name.length <= 12, 'short_name fits under a home-screen icon');
  // Relative, so the same file works at polymathlc.github.io/cer/ and at the root of polymathlc.com.sg.
  for (const k of ['id', 'start_url', 'scope']) assert.equal(manifest[k], './', k + ' is relative to the manifest');
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  const any = manifest.icons.filter(i => i.purpose === 'any').map(i => i.sizes);
  const mask = manifest.icons.filter(i => i.purpose === 'maskable').map(i => i.sizes);
  assert.ok(any.includes('192x192') && any.includes('512x512'), 'Chrome needs 192 and 512 icons');
  assert.ok(mask.includes('512x512'), 'Android gets a maskable icon');
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/'), icon.src + ' is relative');
    const [w, h] = pngSize(icon.src);
    assert.equal(`${w}x${h}`, icon.sizes, icon.src + ' is the size it claims');
  }
});

test('index.html links the manifest, the iPhone icon and the installer', () => {
  assert.ok(INDEX.includes('<link rel="manifest" href="manifest.webmanifest">'));
  assert.ok(INDEX.includes('<link rel="apple-touch-icon" href="assets/app-icons/apple-touch-icon.png">'));
  assert.deepEqual(pngSize('assets/app-icons/apple-touch-icon.png'), [180, 180]);
  assert.ok(INDEX.includes('<meta name="apple-mobile-web-app-capable" content="yes">'));
  assert.ok(INDEX.includes(`<meta name="theme-color" content="${manifest.theme_color}">`), 'theme colour matches the manifest');
  assert.ok(INDEX.includes(`<script defer src="pwa-install.js?v=${APP_VERSION}"></script>`), 'installer loads at the release version');
  // Every control starts hidden, and the hiding rule is in the page itself (before pwa-install.js runs).
  const controls = INDEX.replace(/<!--[\s\S]*?-->/g, "").match(/<[a-z][^>]*\sdata-pwa-install[\s>][^>]*>?/g) || [];
  assert.ok(controls.length >= 2, 'a control in the app sidebar and on the home page');
  for (const c of controls) assert.ok(c.includes('data-pwa-hidden'), 'starts hidden: ' + c);
  assert.ok(INDEX.includes('[data-pwa-install][data-pwa-hidden]{display:none!important}'));
  // The sidebar control is for everyone, not inside an admin-only group.
  const at = INDEX.indexOf('class="nav-item nav-install"');
  const groupOpen = INDEX.lastIndexOf('<details', at), groupClose = INDEX.lastIndexOf('</details>', at);
  assert.ok(groupClose > groupOpen, 'Install app sits outside every collapsible (admin) group');
});

test('the home page header is left alone', () => {
  const header = INDEX.slice(INDEX.indexOf('<header'), INDEX.indexOf('</header>'));
  assert.ok(!header.includes('data-pwa-install'), 'install lives in the footer and the sidebar, never the public header');
});

test('the service worker only answers same-origin GET page loads', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes(`const SW_VERSION = '${APP_VERSION}'`), 'sw.js version follows APP_VERSION so a release replaces the worker');
  const listeners = {};
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, location: { origin: 'https://polymathlc.com.sg' } };
  vm.runInNewContext(sw, { self, URL, caches: {}, fetch() {}, Request: class {}, Response: class {} });
  const { handles, PRECACHE, OFFLINE_URL } = self.__pwaSw;
  const o = 'https://polymathlc.com.sg';
  assert.equal(handles({ method: 'GET', mode: 'navigate', url: o + '/' }, o), true);
  assert.equal(handles({ method: 'GET', mode: 'navigate', url: o + '/online/?x=1' }, o), true);
  assert.equal(handles({ method: 'POST', mode: 'navigate', url: o + '/' }, o), false, 'never a POST');
  assert.equal(handles({ method: 'GET', mode: 'cors', url: o + '/app.js?v=1' }, o), false, 'never scripts');
  assert.equal(handles({ method: 'GET', mode: 'no-cors', url: o + '/video.mp4' }, o), false, 'never media');
  assert.equal(handles({ method: 'GET', mode: 'navigate', url: 'https://accounts.google.com/x' }, o), false, 'never another origin');
  assert.equal(handles(null, o), false);
  assert.ok(PRECACHE.includes(OFFLINE_URL));
  for (const f of PRECACHE) assert.ok(fs.existsSync(path.join(root, f)), f + ' exists');
  for (const ev of ['install', 'activate', 'fetch']) assert.equal(typeof listeners[ev], 'function', ev + ' listener');
  // It must never cache the app itself: no cache.put, and the only cache writes are the precache list.
  assert.ok(!/\.put\(/.test(sw), 'no runtime caching');
});

test('the fetch handler leaves everything it does not handle to the browser', () => {
  const listeners = {};
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, location: { origin: 'https://polymathlc.github.io' } };
  vm.runInNewContext(read('sw.js'), { self, URL, caches: {}, fetch() {}, Request: class {}, Response: class {} });
  let responded = 0;
  const ev = request => ({ request, respondWith() { responded++; } });
  listeners.fetch(ev({ method: 'GET', mode: 'cors', url: 'https://firestore.googleapis.com/x' }));
  listeners.fetch(ev({ method: 'GET', mode: 'no-cors', url: 'https://polymathlc.github.io/cer/app.js' }));
  assert.equal(responded, 0);
  listeners.fetch(ev({ method: 'GET', mode: 'navigate', url: 'https://polymathlc.github.io/cer/' }));
  assert.equal(responded, 1);
});

test('offline.html stands on its own', () => {
  const html = read('offline.html');
  assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'loads nothing from the network');
  // Its one picture is INSIDE the file: the worker answers page loads only, so an icon file could never arrive offline (v1.450.1).
  assert.ok(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+"/.test(html), 'its one picture travels inside the file');
});

test('platform and browser detection', () => {
  const UA = {
    iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
    ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
    windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0',
    windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0',
    whatsapp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.1'
  };
  assert.equal(Core.platformOf(UA.iphoneSafari, 5), 'ios');
  assert.equal(Core.platformOf(UA.ipadOS, 5, 'MacIntel'), 'ios', 'an iPad that says it is a Mac');
  assert.equal(Core.platformOf(UA.ipadOS, 0, 'MacIntel'), 'desktop', 'a real Mac');
  assert.equal(Core.platformOf(UA.android, 5), 'android');
  assert.equal(Core.platformOf(UA.windowsEdge, 0), 'desktop');
  assert.equal(Core.browserOf(UA.iphoneSafari), 'safari');
  assert.equal(Core.browserOf(UA.iphoneChrome), 'chrome');
  assert.equal(Core.browserOf(UA.samsung), 'samsung');
  assert.equal(Core.browserOf(UA.windowsEdge), 'edge');
  assert.equal(Core.browserOf(UA.windowsChrome), 'chrome');
  assert.equal(Core.browserOf(UA.macFirefox), 'firefox');
  assert.equal(Core.inAppBrowser(UA.whatsapp), true);
  assert.equal(Core.inAppBrowser(UA.iphoneSafari), false);
});

test('what pressing Install does on each device', () => {
  assert.equal(Core.plan({ platform: 'android', browser: 'chrome', hasPrompt: true }).kind, 'prompt');
  assert.equal(Core.plan({ platform: 'desktop', browser: 'edge', hasPrompt: true }).kind, 'prompt');
  assert.equal(Core.plan({ standalone: true, hasPrompt: true }).kind, 'installed', 'already installed beats a prompt');
  const ios = Core.plan({ platform: 'ios', browser: 'safari' });
  assert.equal(ios.kind, 'steps');
  assert.ok(ios.steps.some(s => s.includes('Add to Home Screen')));
  assert.ok(ios.steps[0].includes('Share'));
  assert.ok(Core.plan({ platform: 'ios', browser: 'chrome' }).steps[0].includes('address bar'));
  assert.ok(Core.plan({ platform: 'ios', browser: 'safari', inApp: true }).steps.some(s => s.includes('Open in Safari')));
  const samsung = Core.plan({ platform: 'android', browser: 'samsung', hasPrompt: true });
  assert.equal(samsung.kind, 'steps', 'Samsung Internet is sent to Chrome even with its own prompt');
  assert.ok(samsung.steps.some(s => s.includes('Chrome')));
  assert.ok(samsung.steps.some(s => s.includes('Home screen')));
  for (const b of ['edge', 'opera', 'firefox', 'other']) {
    assert.equal(Core.plan({ platform: 'android', browser: b, hasPrompt: true }).kind, 'steps', `${b} on Android goes to Chrome`);
  }
  assert.ok(Core.plan({ platform: 'android', browser: 'whatever', inApp: true }).steps.some(s => s.includes('Open in Chrome')));
  assert.ok(Core.plan({ platform: 'desktop', browser: 'safari' }).steps[0].includes('Add to Dock'));
  assert.ok(Core.plan({ platform: 'desktop', browser: 'firefox' }).steps.some(s => s.includes('Chrome')));
  assert.ok(Core.plan({ platform: 'desktop', browser: 'chrome' }).steps[0].includes('address bar'));
  for (const p of ['ios', 'android', 'desktop']) for (const b of ['safari', 'chrome', 'firefox', 'edge', 'samsung', 'other']) {
    const r = Core.plan({ platform: p, browser: b });
    assert.ok(r.title && r.steps.length >= 2 && r.steps.every(s => typeof s === 'string' && s.length), `${p}/${b} has steps`);
  }
});

test('the worker registers only where browsers allow it', () => {
  const env = { hasServiceWorker: true, isTop: true };
  assert.equal(Core.canRegister({ ...env, protocol: 'https:', hostname: 'polymathlc.com.sg' }), true);
  assert.equal(Core.canRegister({ ...env, protocol: 'http:', hostname: 'localhost' }), true);
  assert.equal(Core.canRegister({ ...env, protocol: 'http:', hostname: 'polymathlc.com.sg' }), false, 'plain http waits for the https upgrade');
  assert.equal(Core.canRegister({ ...env, protocol: 'file:', hostname: '' }), false);
  assert.equal(Core.canRegister({ ...env, isTop: false, protocol: 'https:', hostname: 'x' }), false, 'never from inside an embed');
  assert.equal(Core.canRegister({ hasServiceWorker: false, isTop: true, protocol: 'https:' }), false);
  assert.equal(Core.isStandalone(false, true, false), true, 'iOS home-screen app');
  assert.equal(Core.isStandalone(true, undefined, false), true);
  assert.equal(Core.isStandalone(false, false, false), false);
});
