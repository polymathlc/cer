// Fullscreen the document so portal-owned sanctuary dialogs stay above the game.
export function installHadesDisplay({ container, button, window: win = window }) {
  const doc = win.document;
  if (!doc.getElementById('hades-display-style')) {
    const style = doc.createElement('style'); style.id = 'hades-display-style';
    style.textContent = `
.hades-display-toolbar{display:flex;justify-content:flex-end;padding:8px;background:#11182a}
#hadesFrame{height:100vh;height:100svh;min-height:480px}
#hadesFrame[hidden]{display:none}
[data-hades-expanded]{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;margin:0!important;z-index:100000;display:flex!important;flex-direction:column;background:#080e1c}
[data-hades-expanded] #hadesFrame{flex:1;min-height:0;height:0}
[data-hades-expanded] .hades-display-toolbar{flex:none}
`;
    doc.head.append(style);
  }
  let expanded = false, ownsFullscreen = false, previousOverflow = '', disposed = false;
  function setExpanded(value) {
    if (expanded === value) return;
    expanded = value;
    if (value) { previousOverflow = doc.body.style.overflow; doc.body.style.overflow = 'hidden'; }
    else doc.body.style.overflow = previousOverflow;
    container.toggleAttribute('data-hades-expanded', value);
    button.textContent = value ? 'Exit fullscreen' : 'Fullscreen';
    button.setAttribute('aria-pressed', String(value));
  }
  async function toggle() {
    if (expanded) {
      setExpanded(false);
      if (ownsFullscreen && doc.fullscreenElement) await doc.exitFullscreen().catch(() => {});
      ownsFullscreen = false;
      button.focus();
      return;
    }
    setExpanded(true);
    // Browsers without the Fullscreen API still get an expanded play area.
    if (!doc.fullscreenElement && doc.documentElement.requestFullscreen) {
      try {
        await doc.documentElement.requestFullscreen();
        ownsFullscreen = true;
        if (disposed || !expanded) { await doc.exitFullscreen(); ownsFullscreen = false; }
      } catch (_) { /* Keep the usable viewport-sized fallback. */ }
    }
  }
  const change = () => { if (!doc.fullscreenElement) { ownsFullscreen = false; setExpanded(false); } };
  const key = event => { if (event.key === 'Escape' && expanded && !doc.fullscreenElement) { event.preventDefault(); toggle(); } };
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', toggle);
  doc.addEventListener('fullscreenchange', change);
  doc.addEventListener('keydown', key);
  return { destroy() {
    disposed = true; setExpanded(false);
    if (ownsFullscreen && doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
    button.removeEventListener('click', toggle);
    doc.removeEventListener('fullscreenchange', change);
    doc.removeEventListener('keydown', key);
  } };
}
