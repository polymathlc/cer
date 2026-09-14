const CSS = `
.pirate-rift-portal{position:fixed;inset:0;z-index:100001;display:flex;flex-direction:column;background:#090d15;color:#f5e8cb;font:14px/1.4 system-ui,sans-serif;isolation:isolate}
.pirate-rift-portal header{display:flex;align-items:center;gap:12px;padding:10px 18px;border-bottom:1px solid #80653d;background:#111824}
.pirate-rift-portal h2{flex:1;margin:0;font:700 18px Georgia,serif;letter-spacing:.04em}.pirate-rift-portal h2 small{display:inline-block;margin-left:8px;color:#ddbc77;font:700 10px system-ui,sans-serif;letter-spacing:.12em}
.pirate-rift-portal button{border:1px solid #8f7449;border-radius:6px;min-height:44px;padding:8px 14px;background:#1c2532;color:#fff3d6;font:600 13px system-ui,sans-serif;cursor:pointer}.pirate-rift-portal button:hover{background:#303748}.pirate-rift-portal button:focus-visible{outline:3px solid #77dfdb;outline-offset:2px}
.pirate-rift-portal iframe{display:block;flex:1;width:100%;min-height:0;border:0;background:#090d15}.pirate-rift-portal .pirate-rift-status{margin:0;padding:6px 18px;color:#e6c886;background:#111824}
@media(max-width:580px){.pirate-rift-portal header{gap:8px;padding:7px 10px;flex-wrap:wrap}.pirate-rift-portal h2{font-size:15px;min-width:100%}.pirate-rift-portal button{flex:1;min-height:40px}}
`;

// A stable opaque storage namespace, not an authentication token. The account
// and active learner never appear verbatim in a frame URL or referrer.
export function pirateRiftScope(identity) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (const char of String(identity)) {
    const code = char.codePointAt(0);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return 'p' + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function installPirateRiftPortal(env) {
  const win = env.window || window, doc = win.document;
  const subject = env.subject === 'science' ? 'science' : 'math';
  let overlay = null, frame = null, priorFocus = null, sessionIdentity = '', priorOverflow = '';
  let inertElements = [];
  const allowed = () => {
    const user = env.getUser();
    return !!user?.uid && ['admin', 'student'].includes(user.role);
  };
  const identity = () => {
    const user = env.getUser();
    return allowed() ? JSON.stringify([subject, user.uid, user.role, env.getProfileKey?.() || '', env.getLevel?.() || '']) : '';
  };
  function close() {
    if (!overlay) return;
    const currentOverlay = overlay;
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('fullscreenchange', onFullscreenChange);
    win.removeEventListener('focus', sync);
    doc.removeEventListener('visibilitychange', sync);
    if (doc.fullscreenElement && currentOverlay.contains(doc.fullscreenElement)) {
      try { Promise.resolve(doc.exitFullscreen?.()).catch(() => {}); } catch (_) {}
    }
    // Removing the frame ends its simulation, listeners and audio context.
    frame?.remove(); frame = null;
    currentOverlay.remove(); overlay = null; sessionIdentity = '';
    for (const [element, wasInert] of inertElements) element.inert = wasInert;
    inertElements = []; doc.body.style.overflow = priorOverflow;
    if (priorFocus?.isConnected && !priorFocus.inert) priorFocus.focus();
    priorFocus = null;
  }
  function sync() {
    if (overlay && identity() !== sessionIdentity) close();
  }
  function onKeyDown(event) {
    if (event.key === 'Escape' && overlay?.contains(event.target)) { event.preventDefault(); close(); }
    if (event.key !== 'Tab' || !overlay) return;
    const first = overlay.querySelector('[data-fullscreen]');
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); frame?.focus(); }
  }
  function onFullscreenChange() {
    const button = overlay?.querySelector('[data-fullscreen]');
    if (button) button.textContent = doc.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  }
  async function fullscreen() {
    sync(); if (!overlay) return;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else if (overlay.requestFullscreen) await overlay.requestFullscreen();
      else throw new Error('Fullscreen unavailable');
    } catch (_) {
      const status = overlay?.querySelector('[role="status"]');
      if (status) { status.hidden = false; status.textContent = 'Browser fullscreen is unavailable. You can keep playing in this window.'; }
    }
  }
  function open() {
    if (!allowed()) { close(); env.notify?.('Sign in as a student or administrator to play Pirate Rift.'); return false; }
    close(); env.beforeOpen?.(); priorFocus = doc.activeElement; sessionIdentity = identity();
    if (!doc.getElementById('pirate-rift-portal-style')) {
      const style = doc.createElement('style'); style.id = 'pirate-rift-portal-style'; style.textContent = CSS; doc.head.append(style);
    }
    overlay = doc.createElement('section'); overlay.className = 'pirate-rift-portal';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'One Piece: Pirate Rift');
    overlay.innerHTML = '<header><h2>ONE PIECE: PIRATE RIFT <small>BETA</small></h2><button type="button" data-fullscreen>Fullscreen</button><button type="button" data-close aria-label="Close Pirate Rift">Close</button></header><p class="pirate-rift-status" role="status" hidden></p>';
    overlay.querySelector('[data-close]').onclick = close;
    overlay.querySelector('[data-fullscreen]').onclick = fullscreen;
    frame = doc.createElement('iframe'); frame.title = 'One Piece: Pirate Rift action RPG';
    frame.setAttribute('allow', 'fullscreen; autoplay'); frame.setAttribute('referrerpolicy', 'no-referrer');
    const url = new URL('./pirate-rift.html', win.location.href);
    url.searchParams.set('v', '1.0.0'); url.searchParams.set('subject', subject); url.searchParams.set('profile', pirateRiftScope(sessionIdentity));
    frame.src = url.href; overlay.append(frame);
    inertElements = [...doc.body.children].map(element => [element, element.inert]);
    for (const [element] of inertElements) element.inert = true;
    priorOverflow = doc.body.style.overflow; doc.body.style.overflow = 'hidden'; doc.body.append(overlay);
    doc.addEventListener('keydown', onKeyDown); doc.addEventListener('fullscreenchange', onFullscreenChange);
    win.addEventListener('focus', sync); doc.addEventListener('visibilitychange', sync);
    frame.addEventListener('load', sync); frame.focus(); return true;
  }
  return { open, close, sync, allowed };
}
