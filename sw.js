// 📲 The installable app's service worker (v1.449.1). See CLAUDE.md → "Installable app".
//
// It exists so the browser offers "Install" and so an installed app opened
// without a connection shows offline.html instead of the browser's dinosaur.
// It deliberately does NOT cache the app itself: every release reaches phones
// through the ?v= query strings in index.html, and a cached index.html would
// pin students to an old build. So:
//   • page loads (navigations) on this origin go to the network first; only
//     when the network fails is the offline page shown;
//   • everything else (scripts, Firebase, Storage, videos, POSTs, Range
//     requests, other origins) is never touched: no respondWith at all.
// Its scope is the folder it is served from: /cer/ on polymathlc.github.io and
// the whole site on polymathlc.com.sg (the website mirror), so it must stay
// harmless for every page under it — /online/, /cs/, /schedule/ included.
'use strict';

const SW_VERSION = '1.449.1';
const CACHE = 'polymath-app-shell-' + SW_VERSION;
const CACHE_PREFIX = 'polymath-app-shell-';
const OFFLINE_URL = 'offline.html';
const PRECACHE = [OFFLINE_URL, 'assets/app-icons/icon-192.png'];

// Pure: should this request be answered by the worker? Only same-origin GET
// page loads. Exported for tools/pwa-tests.mjs through `self.__pwaSw`.
function handles(request, origin) {
  if (!request || request.method !== 'GET') return false;
  if (request.mode !== 'navigate') return false;
  try { return new URL(request.url).origin === origin; } catch (e) { return false; }
}

async function precache() {
  const cache = await caches.open(CACHE);
  // { cache: 'reload' } skips the HTTP cache, so a new version never stores a stale offline page.
  await cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })));
}

async function dropOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k)));
}

async function pageOrOffline(event) {
  try {
    // Navigation preload (where supported) starts the request while the worker boots.
    const preloaded = event.preloadResponse ? await event.preloadResponse : null;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch (err) {
    const cache = await caches.open(CACHE);
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('install', event => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await dropOldCaches();
    if (self.registration && self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) { /* not supported: fine */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (!handles(event.request, self.location.origin)) return;   // the browser handles it exactly as without a worker
  event.respondWith(pageOrOffline(event));
});

self.__pwaSw = { SW_VERSION, CACHE, OFFLINE_URL, PRECACHE, handles };
