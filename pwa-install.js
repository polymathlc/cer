/* 📲 Installable app (v1.449.0) — see CLAUDE.md → "Installable app".
 *
 * Loaded with <script defer> by index.html. Three jobs:
 *   1. Register sw.js (the offline fallback worker) on a secure page that is
 *      not inside a frame.
 *   2. Turn every element marked [data-pwa-install] into an "Install app"
 *      control. It is shown only while the app is NOT already running
 *      installed, and is hidden again once the app is installed.
 *   3. When pressed: on Chrome / Edge / Android / Samsung Internet use the
 *      browser's own install prompt (beforeinstallprompt). Where there is no
 *      prompt (every iPhone and iPad browser, Safari on a Mac, Firefox) show
 *      a short step-by-step card for that exact browser instead.
 *
 * The pure half (`PwaInstallCore`) has no DOM and is tested by
 * tools/pwa-tests.mjs; the browser half is driven by tools/pwa-browser.mjs.
 * Everything is written with textContent, never innerHTML.
 */
(function (root) {
  'use strict';

  // ───────────────────────── pure core ─────────────────────────

  /** Which family of device this is: 'ios' (iPhone, iPad incl. iPadOS that claims to be a Mac), 'android' or 'desktop'. */
  function platformOf(ua, maxTouchPoints, navPlatform) {
    ua = String(ua || '');
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    // iPadOS 13+ reports a desktop Safari UA; a Mac has no touch screen.
    if (/Macintosh/i.test(ua) && Number(maxTouchPoints) > 1) return 'ios';
    if (/MacIntel/i.test(String(navPlatform || '')) && Number(maxTouchPoints) > 1) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  }

  /** Which browser, as far as installing goes. Order matters: Edge and Opera also say "Chrome". */
  function browserOf(ua) {
    ua = String(ua || '');
    if (/CriOS/i.test(ua)) return 'chrome';             // Chrome on iPhone / iPad
    if (/FxiOS/i.test(ua)) return 'firefox';            // Firefox on iPhone / iPad
    if (/EdgiOS|Edg\//i.test(ua)) return 'edge';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    if (/OPR\/|Opera/i.test(ua)) return 'opera';
    if (/Firefox\//i.test(ua)) return 'firefox';
    if (/Chrome\//i.test(ua) || /Chromium\//i.test(ua)) return 'chrome';
    if (/Safari\//i.test(ua)) return 'safari';
    return 'other';
  }

  /** In-app browsers (WhatsApp, Instagram, Facebook, Line, WeChat…) cannot install anything. */
  function inAppBrowser(ua) {
    return /FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp|; wv\)|GSA\//i.test(String(ua || ''));
  }

  /** Is the page already running as an installed app? */
  function isStandalone(displayModeStandalone, navigatorStandalone, displayModeOther) {
    return !!(displayModeStandalone || navigatorStandalone === true || displayModeOther);
  }

  /** May this page register a service worker? Secure origin, top window, the API present. */
  function canRegister(env) {
    if (!env || !env.hasServiceWorker || !env.isTop) return false;
    if (env.protocol === 'https:') return true;
    return env.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(String(env.hostname || ''));
  }

  /**
   * What pressing "Install app" should do.
   *   { kind: 'prompt' }                       — call the browser's own prompt
   *   { kind: 'installed', title, steps: [] }  — already installed; nothing to do
   *   { kind: 'steps', title, steps: [..] }    — show these steps
   */
  function plan(ctx) {
    ctx = ctx || {};
    const platform = ctx.platform || 'desktop';
    const browser = ctx.browser || 'other';
    if (ctx.standalone) {
      return { kind: 'installed', title: 'The Polymath app is installed', steps: ['You are already using the installed app. Find it on your home screen, dock or Start menu next time.'] };
    }
    if (ctx.hasPrompt) return { kind: 'prompt' };
    if (ctx.inApp) {
      return { kind: 'steps', title: 'Open this page in your browser first', steps: [
        'This page is open inside another app (such as WhatsApp or Instagram), which cannot install apps.',
        platform === 'ios' ? 'Tap ⋯ or the compass icon and choose "Open in Safari".' : 'Tap ⋮ and choose "Open in Chrome" (or "Open in browser").',
        'Then press "Install app" again.'
      ] };
    }
    if (platform === 'ios') {
      const shareWhere = browser === 'safari'
        ? 'Tap the Share button (the square with an arrow pointing up) in the toolbar.'
        : browser === 'chrome' ? 'Tap the Share button (the square with an arrow) at the right of the address bar.'
        : browser === 'firefox' ? 'Tap the menu (☰), then tap Share.'
        : browser === 'edge' ? 'Tap the menu (⋯), then tap Share.'
        : 'Tap the Share button (the square with an arrow pointing up).';
      return { kind: 'steps', title: 'Add Polymath to your Home Screen', steps: [
        shareWhere,
        'Scroll down and tap "Add to Home Screen". (Not there? Tap "Edit Actions…" and add it, or open this page in Safari.)',
        'Make sure "Open as Web App" is on, then tap Add.',
        'Open Polymath from its new icon on your Home Screen.'
      ] };
    }
    if (platform === 'android') {
      const menu = browser === 'firefox' ? 'Tap the menu (⋮) and choose "Install" (or "Add to Home screen").'
        : browser === 'samsung' ? 'Tap the menu (☰) and choose "Add page to" → "Home screen".'
        : 'Tap the menu (⋮) at the top right and choose "Install app" (or "Add to Home screen").';
      return { kind: 'steps', title: 'Install Polymath on this phone', steps: [
        menu,
        'Tap Install to confirm.',
        'Open Polymath from your home screen or app drawer.'
      ] };
    }
    // Desktop without a prompt.
    if (browser === 'safari') {
      return { kind: 'steps', title: 'Add Polymath to your Dock', steps: [
        'In the menu bar, choose File → "Add to Dock…" (Safari 17 or later on macOS Sonoma).',
        'Click Add.',
        'Open Polymath from the Dock or Launchpad like any other app.'
      ] };
    }
    if (browser === 'firefox') {
      return { kind: 'steps', title: 'Install Polymath on this computer', steps: [
        'Firefox on a computer cannot install web apps yet.',
        'Open this page in Chrome or Microsoft Edge, then press "Install app" again — or use the install icon (⊕) at the right of the address bar.'
      ] };
    }
    return { kind: 'steps', title: 'Install Polymath on this computer', steps: [
      browser === 'edge'
        ? 'Click the menu (⋯) → Apps → "Install this site as an app" (or the app icon at the right of the address bar).'
        : 'Click the install icon (⊕, a screen with a down arrow) at the right of the address bar, or open the menu (⋮) → "Cast, save and share" → "Install page as app…".',
      'Click Install.',
      'Polymath opens in its own window and gets a Start menu / Dock / desktop icon.'
    ] };
  }

  const PwaInstallCore = { platformOf, browserOf, inAppBrowser, isStandalone, canRegister, plan };
  root.PwaInstallCore = PwaInstallCore;
  if (typeof module === 'object' && module.exports) module.exports = PwaInstallCore;

  // ───────────────────────── browser half ─────────────────────────
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const SW_URL = 'sw.js';
  let deferredPrompt = null;
  let installedNow = false;

  function mq(q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } }
  function standaloneNow() {
    return installedNow || isStandalone(mq('(display-mode: standalone)'), window.navigator.standalone,
      mq('(display-mode: minimal-ui)') || mq('(display-mode: fullscreen)') || mq('(display-mode: window-controls-overlay)'));
  }
  function context() {
    const nav = window.navigator || {};
    return {
      platform: platformOf(nav.userAgent, nav.maxTouchPoints, nav.platform),
      browser: browserOf(nav.userAgent),
      inApp: inAppBrowser(nav.userAgent),
      standalone: standaloneNow(),
      hasPrompt: !!deferredPrompt
    };
  }

  // Show the controls unless the app is already running installed.
  function refresh() {
    const hide = standaloneNow();
    document.querySelectorAll('[data-pwa-install]').forEach(el => {
      if (hide) el.setAttribute('data-pwa-hidden', '');
      else el.removeAttribute('data-pwa-hidden');
      el.setAttribute('data-pwa-ready', deferredPrompt ? 'prompt' : 'steps');
    });
    document.documentElement.classList.toggle('pwa-standalone', hide);
  }

  function injectStyles() {
    if (document.getElementById('pwaInstallStyles')) return;
    const s = document.createElement('style');
    s.id = 'pwaInstallStyles';
    s.textContent = [
      '[data-pwa-install][data-pwa-hidden]{display:none!important}',
      '.pwa-sheet-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(9,20,17,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px;animation:pwaFade .18s ease-out}',
      '@media (min-width:640px){.pwa-sheet-backdrop{align-items:center}}',
      '.pwa-sheet{width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#12302a;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.28);padding:22px 20px 18px;font:15px/1.5 "DM Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:pwaRise .22s ease-out}',
      '.pwa-sheet-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}',
      '.pwa-sheet-head img{width:48px;height:48px;border-radius:12px;border:1px solid #d9e4e0;flex-shrink:0}',
      '.pwa-sheet h2{font-size:1.08rem;margin:0;line-height:1.3}',
      '.pwa-sheet-sub{margin:2px 0 0;color:#5b6f69;font-size:.84rem}',
      '.pwa-sheet ol{margin:6px 0 16px;padding:0;list-style:none;counter-reset:pwa}',
      '.pwa-sheet li{counter-increment:pwa;position:relative;padding:8px 0 8px 38px;border-top:1px solid #eef3f1}',
      '.pwa-sheet li:first-child{border-top:0}',
      '.pwa-sheet li::before{content:counter(pwa);position:absolute;left:0;top:8px;width:26px;height:26px;border-radius:50%;background:#e6f2ee;color:#0b6b4f;font-weight:700;font-size:.82rem;display:flex;align-items:center;justify-content:center}',
      '.pwa-sheet-actions{display:flex;justify-content:flex-end;gap:8px}',
      '.pwa-sheet button{font:inherit;font-weight:600;border-radius:10px;padding:10px 18px;cursor:pointer;border:0;background:#0b6b4f;color:#fff}',
      '.pwa-sheet button:focus-visible{outline:3px solid #12302a;outline-offset:2px}',
      '.pwa-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100001;background:#12302a;color:#fff;padding:10px 18px;border-radius:999px;font:600 14px/1.4 "DM Sans",system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:calc(100vw - 32px);text-align:center}',
      '@keyframes pwaFade{from{opacity:0}to{opacity:1}}',
      '@keyframes pwaRise{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}',
      '@media (prefers-reduced-motion:reduce){.pwa-sheet-backdrop,.pwa-sheet{animation:none}}',
      '@media (prefers-color-scheme:dark){.pwa-sheet{background:#13211d;color:#e8f1ee}.pwa-sheet-sub{color:#9db3ac}.pwa-sheet li{border-top-color:#24352f}.pwa-sheet li::before{background:#1d3a31;color:#7fdcb9}.pwa-sheet-head img{border-color:#24352f}.pwa-sheet button{background:#1f9a74}}',
      '@media print{.pwa-sheet-backdrop,.pwa-toast{display:none!important}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function toast(text) {
    const t = document.createElement('div');
    t.className = 'pwa-toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3600);
  }

  let openSheet = null;
  function closeSheet() {
    if (!openSheet) return;
    const { backdrop, returnFocus, onKey } = openSheet;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    openSheet = null;
    if (returnFocus && typeof returnFocus.focus === 'function') { try { returnFocus.focus(); } catch (e) { /* gone */ } }
  }

  function showSheet(p) {
    closeSheet();
    injectStyles();
    const backdrop = document.createElement('div');
    backdrop.className = 'pwa-sheet-backdrop';
    const sheet = document.createElement('div');
    sheet.className = 'pwa-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'pwaSheetTitle');

    const head = document.createElement('div');
    head.className = 'pwa-sheet-head';
    const icon = document.createElement('img');
    icon.src = 'assets/app-icons/icon-192.png';
    icon.alt = '';
    const words = document.createElement('div');
    const h = document.createElement('h2');
    h.id = 'pwaSheetTitle';
    h.textContent = p.title;
    const sub = document.createElement('p');
    sub.className = 'pwa-sheet-sub';
    sub.textContent = 'Polymath Learning Centre · free, no app store needed';
    words.append(h, sub);
    head.append(icon, words);

    const list = document.createElement('ol');
    p.steps.forEach(step => { const li = document.createElement('li'); li.textContent = step; list.appendChild(li); });

    const actions = document.createElement('div');
    actions.className = 'pwa-sheet-actions';
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Got it';
    done.addEventListener('click', closeSheet);
    actions.appendChild(done);

    sheet.append(head, list, actions);
    backdrop.appendChild(sheet);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeSheet(); });
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); } };
    document.addEventListener('keydown', onKey, true);
    openSheet = { backdrop, returnFocus: document.activeElement, onKey };
    document.body.appendChild(backdrop);
    done.focus();
  }

  async function install() {
    const p = plan(context());
    if (p.kind !== 'prompt') { showSheet(p); return p.kind; }
    const ev = deferredPrompt;
    deferredPrompt = null;            // a prompt can be used only once
    try {
      await ev.prompt();
      const choice = ev.userChoice ? await ev.userChoice : null;
      if (choice && choice.outcome === 'accepted') { installedNow = true; toast('Installing Polymath…'); }
      refresh();
      return choice ? choice.outcome : 'prompted';
    } catch (e) {
      // The browser refused (already used, or not allowed now): fall back to the steps.
      showSheet(plan(Object.assign(context(), { hasPrompt: false })));
      return 'steps';
    }
  }

  function wire() {
    injectStyles();
    document.addEventListener('click', e => {
      const el = e.target && e.target.closest && e.target.closest('[data-pwa-install]');
      if (!el) return;
      e.preventDefault();
      install();
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target && e.target.closest && e.target.closest('[data-pwa-install]');
      if (!el || el.tagName === 'BUTTON' || el.tagName === 'A') return;   // those already click on Enter
      e.preventDefault();
      install();
    });
    refresh();
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();               // keep the mini-infobar away; our button asks instead
    deferredPrompt = e;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    installedNow = true;
    deferredPrompt = null;
    refresh();
    closeSheet();
    toast('Polymath is installed — find it on your home screen or desktop.');
  });
  try {
    const m = window.matchMedia && window.matchMedia('(display-mode: standalone)');
    if (m && m.addEventListener) m.addEventListener('change', refresh);
  } catch (e) { /* old browser */ }

  function register() {
    let isTop = true;
    try { isTop = window.top === window.self; } catch (e) { isTop = false; }
    const ok = canRegister({ hasServiceWorker: 'serviceWorker' in navigator, isTop, protocol: location.protocol, hostname: location.hostname });
    if (!ok) return;
    navigator.serviceWorker.register(SW_URL).catch(() => { /* installability is a bonus; never break the page */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  // Register after load so the worker never competes with the first paint.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);

  window.PwaInstall = { install, refresh, context, plan: () => plan(context()), close: closeSheet };
})(typeof globalThis !== 'undefined' ? globalThis : this);
