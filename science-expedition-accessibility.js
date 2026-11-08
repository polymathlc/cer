// Shared keyboard and screen-reader support for the two expedition games.
// Presentation-only: learning gates, combat state and rewards remain game-owned.
(function () {
  'use strict';
  var overlays = Array.from(document.querySelectorAll('.overlay'));
  if (!overlays.length) return;
  var active = null, previous = [], inerted = new Map(), lastFocus = null;
  var focusable = 'button:not(:disabled),a[href],summary,input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])';
  function visible(node) { return !!node && node.isConnected && !node.closest('[inert]') && node.getClientRects().length > 0; }
  function choices(overlay) { return Array.from(overlay.querySelectorAll(focusable)).filter(visible); }
  function focus(node) { if (node && typeof node.focus === 'function') node.focus({ preventScroll: true }); }
  function annotate() {
    overlays.forEach(function (overlay) {
      overlay.setAttribute('role', 'dialog');
      overlay.tabIndex = -1;
      var heading = overlay.querySelector('h1,h2,.q-title');
      if (heading) {
        if (!heading.id) heading.id = overlay.id + '-heading';
        overlay.setAttribute('aria-labelledby', heading.id);
      }
    });
    document.querySelectorAll('.icon-btn[title]').forEach(function (button) {
      button.setAttribute('aria-label', button.title);
    });
    document.querySelectorAll('.fol-pill').forEach(function (button) {
      button.setAttribute('aria-pressed', button.classList.contains('sel') ? 'true' : 'false');
    });
    var toasts = document.getElementById('toastWrap');
    if (toasts) { toasts.setAttribute('role', 'status'); toasts.setAttribute('aria-live', 'polite'); }
    var explanation = document.getElementById('qExplain');
    if (explanation) { explanation.setAttribute('role', 'status'); explanation.setAttribute('aria-live', 'polite'); }
  }
  function releaseInert() {
    inerted.forEach(function (wasInert, node) { node.inert = wasInert; });
    inerted.clear();
  }
  function contain(overlay) {
    // Inert only siblings along the dialog's ancestor chain, never its ancestors.
    for (var node = overlay; node && node !== document.body; node = node.parentElement) {
      Array.from(node.parentElement.children).forEach(function (sibling) {
        if (sibling === node || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) return;
        inerted.set(sibling, sibling.inert);
        sibling.inert = true;
      });
    }
  }
  function sync(records) {
    annotate();
    var shown = overlays.filter(function (overlay) { return overlay.classList.contains('show'); });
    // Newly opened dialogs go above a still-visible menu, independent of DOM order.
    var next = shown.find(function (overlay) { return previous.indexOf(overlay) < 0; }) ||
      (shown.indexOf(active) >= 0 ? active : shown[shown.length - 1]) || null;
    previous = shown;
    overlays.forEach(function (overlay) { overlay.setAttribute('aria-modal', overlay === next ? 'true' : 'false'); });
    if (next === active) {
      // Selecting a class/follower rerenders its card; retain the keyboard position.
      if (active && lastFocus && !lastFocus.node.isConnected && document.activeElement === document.body) {
        var replacements = active.querySelectorAll(lastFocus.selector);
        focus(replacements[lastFocus.index]);
      }
      return;
    }
    var old = active;
    var nestedReturn = old && old.__expeditionReturnFocus;
    var closing = next && nestedReturn && next.contains(nestedReturn);
    if (next && !closing) next.__expeditionReturnFocus = old && old.__expeditionLastFocus || document.activeElement;
    releaseInert();
    active = next;
    if (next) {
      contain(next);
      // Focus the dialog title first so a long menu never jumps to its footer.
      focus(closing && visible(nestedReturn) ? nestedReturn : next);
    } else if (old) {
      var restore = old.__expeditionReturnFocus;
      if (visible(restore)) focus(restore);
    }
  }
  document.addEventListener('focusin', function (event) {
    if (active && !active.contains(event.target)) { focus(active); return; }
    if (!active) return;
    active.__expeditionLastFocus = event.target;
    var card = event.target.closest('.class-card,.fol-pill');
    if (card) {
      var selector = card.classList.contains('class-card') ? '.class-card' : '.fol-pill';
      lastFocus = { node: card, selector: selector, index: Array.from(active.querySelectorAll(selector)).indexOf(card) };
    } else lastFocus = null;
  });
  document.addEventListener('keydown', function (event) {
    if (!active || event.key !== 'Tab') return;
    var nodes = choices(active), first = nodes[0], last = nodes[nodes.length - 1];
    if (!first) { event.preventDefault(); focus(active); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === active)) {
      event.preventDefault(); focus(last);
    } else if (!event.shiftKey && (document.activeElement === last || !active.contains(document.activeElement))) {
      event.preventDefault(); focus(first);
    }
  }, true);
  var observer = new MutationObserver(sync);
  overlays.forEach(function (overlay) {
    observer.observe(overlay, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
  sync();
})();
