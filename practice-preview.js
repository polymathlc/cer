/* The "Your next lightbulb moment" practice preview — ONE source for the home page card and the
   schedule page's Sample Materials tab. Change the question here and both pages change together.
   Loaded as a plain (non-deferred) <script> straight after its [data-practice-preview] element, so
   the card is filled before first paint; it also exports itself for node tests. */
(function (root) {
  'use strict';

  var PREVIEW = {
    topic: 'ENERGY · HEAT',
    method: 'Claim. Evidence. Reasoning.',
    question: ['Why does ice melt faster', 'on a metal tray?'],
    steps: [
      { letter: 'C', label: 'Make a claim', text: ['Metal is a ', { mark: 'better conductor of heat' }, ' than wood.'] },
      { letter: 'E', label: 'Use the evidence', text: ['The ice on the metal tray ', { mark: 'melts in less time' }, '.'] },
      { letter: 'R', label: 'Connect the science', text: ['Heat transfers from the warmer tray to the ice ', { mark: 'more quickly' }, '.'] }
    ],
    note: 'Same-sized ice cubes. Trays at room temperature.',
    outcome: 'One clear explanation.',
    // The dark note that floats under the card.
    float: { text: 'Learn the thinking behind the answer.', small: 'Guided keywords → independent explanations' }
  };

  // The card's slight tilt. Both pages read it through --pp-tilt, so it cannot drift either.
  var TILT = '-1.5deg';

  var BOOK = '<svg class="lp-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 6v15m0-15C9 3 5 3 2 4v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-3-1-7-1-10 2Z"/></svg>';

  var SPARK = '<svg class="lp-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Zm7-2v4m-2-2h4"/></svg>';

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function inline(parts) {
    return parts.map(function (part) {
      return typeof part === 'string' ? esc(part) : '<mark>' + esc(part.mark) + '</mark>';
    }).join('');
  }

  function render(preview) {
    var p = preview || PREVIEW;
    return '<div class="lp-preview-top"><span>' + BOOK + ' Your next lightbulb moment</span><span class="lp-preview-label">Practice preview</span></div>' +
      '<div class="lp-preview-content">' +
        '<div class="lp-preview-meta"><span>' + esc(p.topic) + '</span><span>' + esc(p.method) + '</span></div>' +
        '<h2>' + p.question.map(esc).join('<br>') + '</h2>' +
        p.steps.map(function (step) {
          return '<div class="lp-cer-row"><b>' + esc(step.letter) + '</b><div><small>' + esc(step.label) + '</small>' + inline(step.text) + '</div></div>';
        }).join('') +
      '</div>' +
      '<div class="lp-preview-foot"><span>' + esc(p.note) + '</span><b>' + esc(p.outcome) + '</b></div>';
  }

  function renderFloat(preview) {
    var f = (preview || PREVIEW).float;
    return SPARK + '<div>' + esc(f.text) + '<small>' + esc(f.small) + '</small></div>';
  }

  // Plain text of the question, for labels and tests.
  function questionText(preview) {
    return (preview || PREVIEW).question.join(' ');
  }

  function mount(el) {
    if (!el || el.getAttribute('data-practice-preview-ready')) return;
    el.innerHTML = render();
    el.style.setProperty('--pp-tilt', TILT);
    el.setAttribute('data-practice-preview-ready', '1');
  }

  function mountAll() {
    if (typeof document === 'undefined') return;
    var nodes = document.querySelectorAll('[data-practice-preview]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
    var floats = document.querySelectorAll('[data-practice-float]');
    for (var j = 0; j < floats.length; j++) {
      if (floats[j].getAttribute('data-practice-preview-ready')) continue;
      floats[j].innerHTML = renderFloat();
      floats[j].setAttribute('data-practice-preview-ready', '1');
    }
  }

  var api = { PREVIEW: PREVIEW, TILT: TILT, render: render, renderFloat: renderFloat, questionText: questionText, mount: mount, mountAll: mountAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PracticePreview = api;

  mountAll();
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  }
})(typeof window !== 'undefined' ? window : globalThis);
