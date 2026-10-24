/* 📲 Polymath install kit — pwa-install.js (kit v2.0.0)
 *
 * ONE file, shared byte for byte by every Polymath app (the student dashboard,
 * Maths, Ans Key, Study Buddy, Rewards, Chinese, English and Polymath Online).
 * It grew out of the Science portal's own installer (polymathlc/cer,
 * pwa-install.js v1.449.1) and keeps its rules; what is new is that the app's
 * name, icon and colour come from the <script> tag, so the same file serves
 * every app, and that an app with no install control of its own gets a small
 * floating "Install app" button instead of nothing.
 *
 * Load it with <script defer> and describe the app on the tag:
 *
 *   <script defer src="pwa-install.js?v=2.0.0"
 *     data-app-name="Polymath Maths"            shown in the steps and messages
 *     data-app-key="math"                       remembers a dismissed floating button
 *     data-app-icon="assets/app-icons/icon-192.png"
 *     data-accent="#2E7D32"                     the steps' numbers and buttons
 *     data-sw="sw.js"                           "none" = do not register a worker
 *     data-floating="auto"></script>            auto | always | never
 *
 * Four jobs:
 *   1. Register sw.js (the offline fallback worker) on a secure page that is
 *      not inside a frame, after `load` so it never competes with first paint.
 *   2. Turn every element marked [data-pwa-install] into an "Install app"
 *      control. It is shown only while the app is NOT already running
 *      installed (and not inside another page's frame), and hidden again the
 *      moment it is installed.
 *   3. When pressed: on Chrome / Edge (PC, Mac, Chromebook) and Chrome on
 *      Android use the browser's own install prompt (beforeinstallprompt).
 *      Other Android browsers are sent to Chrome, because their self-built app
 *      packages trip Play Protect's "built for an older version of Android"
 *      warning. Where there is no prompt (every iPhone and iPad browser,
 *      Safari on a Mac, Firefox) a short step-by-step card for that exact
 *      browser is shown instead.
 *   4. With data-floating="auto", a page that shows no [data-pwa-install]
 *      control of its own (a sign-in screen, an app still loading) gets a
 *      small floating button at the bottom right. It can be dismissed (×) for
 *      DISMISS_DAYS, and it never shows inside the installed app.
 *
 * The pure half (`PwaInstallCore`) has no DOM and is tested by
 * tools/pwa-install-tests.mjs; the browser half is driven by
 * tools/pwa-install-browser.mjs. Everything is written with textContent,
 * never innerHTML, so an app name can never inject markup.
 */
(function (root) {
  'use strict';

  const KIT_VERSION = '2.0.0';
  const DISMISS_DAYS = 21;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ───────────────────────── pure core ─────────────────────────

  /** Which family of device this is: 'ios' (iPhone, iPad incl. iPadOS that claims to be a Mac), 'android' or 'desktop'. */
  function platformOf(userAgent, maxTouchPoints, navigatorPlatform) {
    const ua = String(userAgent || '');
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    // iPadOS 13+ reports a desktop Safari user agent; a Mac has no touch screen.
    if (/Macintosh/i.test(ua) && Number(maxTouchPoints) > 1) return 'ios';
    if (/MacIntel/i.test(String(navigatorPlatform || '')) && Number(maxTouchPoints) > 1) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  }

  /** Which browser, as far as installing goes. Order matters: Edge and Opera also say "Chrome". */
  function browserOf(userAgent) {
    const ua = String(userAgent || '');
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

  /** In-app browsers (WhatsApp, Instagram, Facebook, Line, WeChat, the Google app…) cannot install anything. */
  function inAppBrowser(userAgent) {
    return /FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp|; wv\)|GSA\//i.test(String(userAgent || ''));
  }

  /** Is the page already running as an installed app? */
  function isStandalone(displayModeStandalone, navigatorStandalone, displayModeOther) {
    return !!(displayModeStandalone || navigatorStandalone === true || displayModeOther);
  }

  /** May this page register a service worker? Secure origin, top window, the API present. */
  function canRegister(environment) {
    if (!environment || !environment.hasServiceWorker || !environment.isTop) return false;
    if (environment.protocol === 'https:') return true;
    return environment.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(String(environment.hostname || ''));
  }

  /** A display name that is never empty and never absurdly long (it goes into headings). */
  function cleanAppName(name) {
    const trimmed = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!trimmed) return 'Polymath';
    return trimmed.length > 40 ? trimmed.slice(0, 40).trim() : trimmed;
  }

  /** The floating button's mode, from the tag; anything unknown means "auto". */
  function floatingMode(value) {
    const mode = String(value == null ? '' : value).trim().toLowerCase();
    return mode === 'always' || mode === 'never' ? mode : 'auto';
  }

  /**
   * Should the floating "Install app" button be on screen right now?
   *   mode          'auto' | 'always' | 'never'
   *   standalone    already running as the installed app
   *   framed        the page is inside another page's frame (it cannot be installed from there)
   *   hasOwnControl the page is showing a [data-pwa-install] control of its own
   *   dismissedAt   when the student last pressed × (ms), or 0
   *   now           the current time (ms)
   */
  function floatingWanted(state) {
    state = state || {};
    const mode = floatingMode(state.mode);
    if (mode === 'never' || state.standalone || state.framed) return false;
    const dismissedAt = Number(state.dismissedAt) || 0;
    const now = Number(state.now) || 0;
    if (dismissedAt > 0 && now - dismissedAt < DISMISS_DAYS * DAY_MS && now >= dismissedAt) return false;
    if (mode === 'always') return true;
    return !state.hasOwnControl;
  }

  /**
   * What pressing "Install app" should do.
   *   { kind: 'prompt' }                       — call the browser's own prompt
   *   { kind: 'installed', title, steps: [] }  — already installed; nothing to do
   *   { kind: 'steps', title, steps: [..] }    — show these steps
   * ctx: { platform, browser, inApp, standalone, hasPrompt, appName }
   */
  function plan(ctx) {
    ctx = ctx || {};
    const platform = ctx.platform || 'desktop';
    const browser = ctx.browser || 'other';
    const appName = cleanAppName(ctx.appName);

    if (ctx.standalone) {
      return { kind: 'installed', title: appName + ' is installed', steps: [
        'You are already using the installed app. Find it on your home screen, dock or Start menu next time.'
      ] };
    }

    // Android browsers other than Chrome (Samsung Internet, Edge, Opera, Firefox…) build their own
    // app package, which Google Play Protect flags as "built for an older version of Android" /
    // unsafe. Chrome's package comes signed through Google Play and installs cleanly, so steer to
    // Chrome even when this browser offers its own prompt.
    if (platform === 'android' && browser !== 'chrome' && !ctx.inApp) {
      return { kind: 'steps', title: 'Install ' + appName + ' with Chrome', steps: [
        'This browser makes an app package that Android warns is "built for an older version of Android". It is not harmful, but Chrome installs ' + appName + ' cleanly with no warning.',
        'Open this page in Google Chrome (copy the address, or tap ⋮ / ☰ → "Open in Chrome" if offered).',
        'In Chrome, press "Install app" again (or tap ⋮ → "Install app") and tap Install.',
        browser === 'samsung'
          ? 'Prefer to stay in Samsung Internet? Tap ☰ → "Add page to" → "Home screen" for a plain shortcut instead, which shows no warning.'
          : browser === 'firefox'
          ? 'Prefer to stay in Firefox? Tap ⋮ → "Add to Home screen" and choose the shortcut, which shows no warning.'
          : 'Prefer to stay in this browser? Add the page to your home screen as a shortcut instead, which shows no warning.'
      ] };
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
      return { kind: 'steps', title: 'Add ' + appName + ' to your Home Screen', steps: [
        shareWhere,
        'Scroll down and tap "Add to Home Screen". (Not there? Tap "Edit Actions…" and add it, or open this page in Safari.)',
        'Make sure "Open as Web App" is on, then tap Add.',
        'Open ' + appName + ' from its new icon on your Home Screen.'
      ] };
    }

    if (platform === 'android') {
      const menu = browser === 'firefox' ? 'Tap the menu (⋮) and choose "Install" (or "Add to Home screen").'
        : browser === 'samsung' ? 'Tap the menu (☰) and choose "Add page to" → "Home screen".'
        : 'Tap the menu (⋮) at the top right and choose "Install app" (or "Add to Home screen").';
      return { kind: 'steps', title: 'Install ' + appName + ' on this phone', steps: [
        menu,
        'Tap Install to confirm.',
        'Open ' + appName + ' from your home screen or app drawer.'
      ] };
    }

    // A computer without a prompt.
    if (browser === 'safari') {
      return { kind: 'steps', title: 'Add ' + appName + ' to your Dock', steps: [
        'In the menu bar, choose File → "Add to Dock…" (Safari 17 or later on macOS Sonoma).',
        'Click Add.',
        'Open ' + appName + ' from the Dock or Launchpad like any other app.'
      ] };
    }
    if (browser === 'firefox') {
      return { kind: 'steps', title: 'Install ' + appName + ' on this computer', steps: [
        'Firefox on a computer cannot install web apps yet.',
        'Open this page in Chrome or Microsoft Edge, then press "Install app" again — or use the install icon (⊕) at the right of the address bar.'
      ] };
    }
    return { kind: 'steps', title: 'Install ' + appName + ' on this computer', steps: [
      browser === 'edge'
        ? 'Click the menu (⋯) → Apps → "Install this site as an app" (or the app icon at the right of the address bar).'
        : 'Click the install icon (⊕, a screen with a down arrow) at the right of the address bar, or open the menu (⋮) → "Cast, save and share" → "Install page as app…".',
      'Click Install.',
      appName + ' opens in its own window and gets a Start menu / Dock / desktop icon.'
    ] };
  }

  /** Read the app's settings from the script tag's data-* attributes (pure: takes a plain object). */
  function readConfig(dataset) {
    dataset = dataset || {};
    const sw = String(dataset.sw == null ? 'sw.js' : dataset.sw).trim();
    return {
      appName: cleanAppName(dataset.appName),
      appKey: String(dataset.appKey || 'app').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'app',
      appIcon: String(dataset.appIcon || 'assets/app-icons/icon-192.png'),
      accent: /^#[0-9a-f]{3,8}$/i.test(String(dataset.accent || '')) ? String(dataset.accent) : '#0b6b4f',
      serviceWorkerUrl: sw === '' || sw.toLowerCase() === 'none' ? '' : sw,
      floating: floatingMode(dataset.floating)
    };
  }

  const PwaInstallCore = {
    KIT_VERSION, DISMISS_DAYS,
    platformOf, browserOf, inAppBrowser, isStandalone, canRegister,
    cleanAppName, floatingMode, floatingWanted, plan, readConfig
  };
  root.PwaInstallCore = PwaInstallCore;
  if (typeof module === 'object' && module.exports) module.exports = PwaInstallCore;

  // ───────────────────────── browser half ─────────────────────────
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (window.PwaInstall && window.PwaInstall.kitVersion) return;   // loaded twice: the first copy already runs everything

  // document.currentScript is set while a classic (defer) script runs; fall back to finding the tag.
  const ownTag = document.currentScript
    || document.querySelector('script[src*="pwa-install"][data-app-name]')
    || document.querySelector('script[src*="pwa-install"]');
  const config = readConfig(ownTag ? ownTag.dataset : {});
  const DISMISS_KEY = 'polymath-install-dismissed:' + config.appKey;

  let deferredPrompt = null;
  let installedNow = false;
  let floatingButton = null;

  function mediaMatches(query) {
    try { return !!(window.matchMedia && window.matchMedia(query).matches); } catch (error) { return false; }
  }
  // A page shown inside another page's frame (Ans Key inside Polymath Online, a lesson inside the
  // Science portal) cannot be installed from there — the browser only offers that to a top window —
  // so it shows no install controls at all; the page around it has its own.
  function framedNow() {
    try { return window.top !== window.self; } catch (error) { return true; }
  }
  function standaloneNow() {
    return installedNow || isStandalone(
      mediaMatches('(display-mode: standalone)'),
      window.navigator.standalone,
      mediaMatches('(display-mode: minimal-ui)') || mediaMatches('(display-mode: fullscreen)') || mediaMatches('(display-mode: window-controls-overlay)')
    );
  }
  function context() {
    const nav = window.navigator || {};
    return {
      platform: platformOf(nav.userAgent, nav.maxTouchPoints, nav.platform),
      browser: browserOf(nav.userAgent),
      inApp: inAppBrowser(nav.userAgent),
      standalone: standaloneNow(),
      hasPrompt: !!deferredPrompt,
      appName: config.appName
    };
  }

  // localStorage is shared by every app on polymathlc.com.sg, hence the per-app key. It can throw
  // (private mode, blocked storage, a sandboxed frame): then nothing is remembered and nothing breaks.
  function readDismissedAt() {
    try { return Number(window.localStorage.getItem(DISMISS_KEY)) || 0; } catch (error) { return 0; }
  }
  function writeDismissedAt(value) {
    try { window.localStorage.setItem(DISMISS_KEY, String(value)); } catch (error) { /* not remembered: fine */ }
  }

  /** Is the page showing an install control of its own (not the floating one), right now? */
  function pageHasOwnControl() {
    const controls = document.querySelectorAll('[data-pwa-install]');
    for (let index = 0; index < controls.length; index++) {
      const control = controls[index];
      if (floatingButton && floatingButton.contains(control)) continue;
      if (control.hasAttribute('data-pwa-hidden')) continue;
      if (control.getClientRects().length > 0) return true;   // laid out = actually on the page
    }
    return false;
  }

  function injectStyles() {
    if (document.getElementById('pwaInstallKitStyles')) return;
    const style = document.createElement('style');
    style.id = 'pwaInstallKitStyles';
    style.textContent = [
      // The "?" in the steps is drawn by Roboto / Arial, never Century Gothic (the house rule).
      "@font-face{font-family:'PwaKitQuestion';src:local('Roboto'),local('Roboto-Regular'),local('Arial'),local('Helvetica');unicode-range:U+003F}",
      ':root{--pwa-accent:' + config.accent + '}',
      '[data-pwa-install][data-pwa-hidden]{display:none!important}',
      '.pwa-sheet-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(20,24,22,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px;animation:pwaKitFade .18s ease-out}',
      '@media (min-width:640px){.pwa-sheet-backdrop{align-items:center}}',
      ".pwa-sheet{width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#1A1A1A;border-radius:16px;box-shadow:0 4px 6px rgba(0,0,0,.05),0 10px 30px rgba(0,0,0,.14);padding:22px 20px 18px;font:15px/1.55 'PwaKitQuestion','Century Gothic',CenturyGothic,AppleGothic,system-ui,sans-serif;animation:pwaKitRise .22s ease-out;text-align:left}",
      '.pwa-sheet-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}',
      '.pwa-sheet-head img{width:48px;height:48px;border-radius:12px;border:1px solid #E8E8E4;flex-shrink:0;object-fit:cover}',
      '.pwa-sheet h2{font-size:1.08rem;margin:0;line-height:1.3;font-weight:700;color:#1A1A1A}',
      '.pwa-sheet-sub{margin:2px 0 0;color:#5C5C5C;font-size:.84rem}',
      '.pwa-sheet ol{margin:6px 0 16px;padding:0;list-style:none;counter-reset:pwakit}',
      '.pwa-sheet li{counter-increment:pwakit;position:relative;padding:8px 0 8px 38px;border-top:1px solid #F0F0EC;color:#333}',
      '.pwa-sheet li:first-child{border-top:0}',
      '.pwa-sheet li::before{content:counter(pwakit);position:absolute;left:0;top:8px;width:26px;height:26px;border-radius:50%;background:#F0F2F1;background:color-mix(in srgb,var(--pwa-accent) 14%,#fff);color:var(--pwa-accent);font-weight:700;font-size:.82rem;display:flex;align-items:center;justify-content:center}',
      '.pwa-sheet-actions{display:flex;justify-content:flex-end;gap:8px}',
      '.pwa-sheet-actions button{font:inherit;font-weight:700;border-radius:10px;padding:10px 18px;cursor:pointer;border:0;background:var(--pwa-accent);color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.05),0 2px 8px rgba(0,0,0,.08)}',
      '.pwa-sheet-actions button:focus-visible{outline:3px solid #1A1A1A;outline-offset:2px}',
      ".pwa-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100001;background:#1A1A1A;color:#fff;padding:10px 18px;border-radius:999px;font:600 14px/1.4 'PwaKitQuestion','Century Gothic',CenturyGothic,AppleGothic,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:calc(100vw - 32px);text-align:center}",
      // The floating button: small, quiet, out of the way, and never inside the installed app.
      '.pwa-fab{position:fixed;right:max(14px,calc(env(safe-area-inset-right) + 10px));bottom:max(14px,calc(env(safe-area-inset-bottom) + 10px));z-index:9990;display:flex;align-items:center;gap:2px;background:#fff;border:1px solid #E8E8E4;border-radius:999px;padding:3px;box-shadow:0 2px 4px rgba(0,0,0,.06),0 6px 20px rgba(0,0,0,.12);animation:pwaKitRise .25s ease-out}',
      '.pwa-fab[hidden]{display:none!important}',
      ".pwa-fab-install{display:inline-flex;align-items:center;gap:7px;border:0;background:var(--pwa-accent);color:#fff;font:700 13.5px/1 'PwaKitQuestion','Century Gothic',CenturyGothic,AppleGothic,system-ui,sans-serif;padding:10px 14px;border-radius:999px;cursor:pointer;transition:transform .2s ease,filter .2s ease}",
      '.pwa-fab-install:hover{transform:translateY(-1px);filter:brightness(1.06)}',
      '.pwa-fab-install:active{transform:translateY(.5px)}',
      ".pwa-fab-close{width:30px;height:30px;border:0;background:transparent;color:#8A8A8A;font:400 20px/1 system-ui,sans-serif;border-radius:50%;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}",
      '.pwa-fab-close:hover{background:#F3F3F0;color:#1A1A1A}',
      '.pwa-fab button:focus-visible{outline:3px solid #1A1A1A;outline-offset:2px}',
      '@keyframes pwaKitFade{from{opacity:0}to{opacity:1}}',
      '@keyframes pwaKitRise{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}',
      '@media (prefers-reduced-motion:reduce){.pwa-sheet-backdrop,.pwa-sheet,.pwa-fab{animation:none}}',
      '@media print{.pwa-sheet-backdrop,.pwa-toast,.pwa-fab,[data-pwa-install]{display:none!important}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function toast(text) {
    const note = document.createElement('div');
    note.className = 'pwa-toast';
    note.setAttribute('role', 'status');
    note.textContent = text;
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 3600);
  }

  let openSheet = null;
  function closeSheet() {
    if (!openSheet) return;
    const { backdrop, returnFocus, onKey } = openSheet;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    openSheet = null;
    if (returnFocus && typeof returnFocus.focus === 'function') { try { returnFocus.focus(); } catch (error) { /* gone */ } }
  }

  function showSheet(steps) {
    closeSheet();
    injectStyles();
    const backdrop = document.createElement('div');
    backdrop.className = 'pwa-sheet-backdrop';
    const sheet = document.createElement('div');
    sheet.className = 'pwa-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'pwaKitSheetTitle');

    const head = document.createElement('div');
    head.className = 'pwa-sheet-head';
    const icon = document.createElement('img');
    icon.src = config.appIcon;
    icon.alt = '';
    icon.addEventListener('error', () => icon.remove());
    const words = document.createElement('div');
    const heading = document.createElement('h2');
    heading.id = 'pwaKitSheetTitle';
    heading.textContent = steps.title;
    const subtitle = document.createElement('p');
    subtitle.className = 'pwa-sheet-sub';
    subtitle.textContent = 'Polymath Learning Centre · free, no app store needed';
    words.append(heading, subtitle);
    head.append(icon, words);

    const list = document.createElement('ol');
    steps.steps.forEach(step => { const item = document.createElement('li'); item.textContent = step; list.appendChild(item); });

    const actions = document.createElement('div');
    actions.className = 'pwa-sheet-actions';
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Got it';
    done.addEventListener('click', closeSheet);
    actions.appendChild(done);

    sheet.append(head, list, actions);
    backdrop.appendChild(sheet);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closeSheet(); });
    const onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); closeSheet(); } };
    document.addEventListener('keydown', onKey, true);
    openSheet = { backdrop, returnFocus: document.activeElement, onKey };
    document.body.appendChild(backdrop);
    done.focus();
  }

  async function install() {
    const decision = plan(context());
    if (decision.kind !== 'prompt') { showSheet(decision); return decision.kind; }
    const promptEvent = deferredPrompt;
    deferredPrompt = null;            // a prompt can be used only once
    try {
      await promptEvent.prompt();
      const choice = promptEvent.userChoice ? await promptEvent.userChoice : null;
      if (choice && choice.outcome === 'accepted') { installedNow = true; toast('Installing ' + config.appName + '…'); }
      refresh();
      return choice ? choice.outcome : 'prompted';
    } catch (error) {
      // The browser refused (already used, or not allowed now): fall back to the steps.
      showSheet(plan(Object.assign(context(), { hasPrompt: false })));
      return 'steps';
    }
  }

  function buildFloatingButton() {
    if (floatingButton || !document.body) return floatingButton;
    const wrapper = document.createElement('div');
    wrapper.className = 'pwa-fab';
    wrapper.setAttribute('data-pwa-floating', '');
    wrapper.hidden = true;

    const installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.className = 'pwa-fab-install';
    installButton.setAttribute('data-pwa-install', '');
    installButton.title = 'Install ' + config.appName + ' as an app on this computer, phone or tablet — its own icon and window, no app store needed';
    const glyph = document.createElement('span');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = '📲';
    const label = document.createElement('span');
    label.textContent = 'Install app';
    installButton.append(glyph, label);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'pwa-fab-close';
    closeButton.setAttribute('aria-label', 'Hide the install button');
    closeButton.title = 'Hide this for ' + DISMISS_DAYS + ' days';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      writeDismissedAt(Date.now());
      updateFloatingButton();
    });

    wrapper.append(installButton, closeButton);
    document.body.appendChild(wrapper);
    floatingButton = wrapper;
    return wrapper;
  }

  function updateFloatingButton() {
    if (config.floating === 'never') return;
    const wanted = floatingWanted({
      mode: config.floating,
      standalone: standaloneNow(),
      framed: framedNow(),
      hasOwnControl: pageHasOwnControl(),
      dismissedAt: readDismissedAt(),
      now: Date.now()
    });
    if (!wanted) { if (floatingButton) floatingButton.hidden = true; return; }
    const wrapper = buildFloatingButton();
    if (wrapper) wrapper.hidden = false;
  }

  // Show the controls unless the app is already running installed.
  function refresh() {
    const hide = standaloneNow() || framedNow();
    document.querySelectorAll('[data-pwa-install]').forEach(control => {
      if (hide) control.setAttribute('data-pwa-hidden', '');
      else control.removeAttribute('data-pwa-hidden');
      control.setAttribute('data-pwa-ready', deferredPrompt ? 'prompt' : 'steps');
    });
    document.documentElement.classList.toggle('pwa-standalone', standaloneNow());
    updateFloatingButton();
  }

  // Apps draw their screens after load (sign-in, a dashboard, a game), so an install control can
  // appear or disappear at any time. A cheap, idle-time look every few seconds keeps the floating
  // button honest without watching every DOM change in a busy app.
  function scheduleChecks() {
    const idle = window.requestIdleCallback || (callback => setTimeout(callback, 1));
    setInterval(() => { if (!document.hidden) idle(() => refresh()); }, 4000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('resize', () => idle(() => refresh()));
  }

  function wire() {
    injectStyles();
    document.addEventListener('click', event => {
      const control = event.target && event.target.closest && event.target.closest('[data-pwa-install]');
      if (!control) return;
      event.preventDefault();
      install();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const control = event.target && event.target.closest && event.target.closest('[data-pwa-install]');
      if (!control || control.tagName === 'BUTTON' || control.tagName === 'A') return;   // those already click on Enter
      event.preventDefault();
      install();
    });
    refresh();
    scheduleChecks();
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();               // keep the mini-infobar away; our button asks instead
    deferredPrompt = event;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    installedNow = true;
    deferredPrompt = null;
    refresh();
    closeSheet();
    toast(config.appName + ' is installed — find it on your home screen or desktop.');
  });
  try {
    const standaloneQuery = window.matchMedia && window.matchMedia('(display-mode: standalone)');
    if (standaloneQuery && standaloneQuery.addEventListener) standaloneQuery.addEventListener('change', refresh);
  } catch (error) { /* old browser */ }

  function register() {
    if (!config.serviceWorkerUrl) return;
    let isTop = true;
    try { isTop = window.top === window.self; } catch (error) { isTop = false; }
    const allowed = canRegister({ hasServiceWorker: 'serviceWorker' in navigator, isTop, protocol: location.protocol, hostname: location.hostname });
    if (!allowed) return;
    navigator.serviceWorker.register(config.serviceWorkerUrl).catch(() => { /* installability is a bonus; never break the page */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  if (document.readyState === 'complete') { register(); setTimeout(refresh, 1200); }
  else window.addEventListener('load', () => { register(); setTimeout(refresh, 1200); });

  window.PwaInstall = {
    kitVersion: KIT_VERSION,
    config,
    install,
    refresh,
    context,
    plan: () => plan(context()),
    close: closeSheet
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
