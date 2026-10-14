/* The "Your next lightbulb moment" card on the home page and the schedule page's Sample Materials tab.
   It shows the SAME questions the teacher picked under Sample Materials, fetched live from the sample
   service, so changing the selection there changes this card too. The built-in CER example below is
   only the first paint and the fallback when the service cannot be reached.
   Loaded as a plain (non-deferred) <script> straight after its [data-practice-preview] element, so
   the card is filled before first paint; it also exports itself for node tests. */
(function (root) {
  'use strict';

  var API = 'https://us-central1-mathgen--app.cloudfunctions.net/studyBuddySample';
  var SUBJECTS = ['science', 'math'];
  var TIMEOUT_MS = 20000;
  var MAX_ROWS = 4;
  var MAX_QUESTIONS = 5;

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
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function inline(parts) {
    return parts.map(function (part) {
      return typeof part === 'string' ? esc(part) : '<mark>' + esc(part.mark) + '</mark>';
    }).join('');
  }

  // Short plain text: whitespace folded, clipped on a word.
  function clip(value, max) {
    var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    var cut = text.slice(0, max);
    var space = cut.lastIndexOf(' ');
    return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '') + '…';
  }

  // Escape FIRST, then turn \frac{a}{b}, ^(x) and _(x) into markup, so nothing the bank stored runs.
  function mathHtml(value) {
    return esc(value)
      .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1⁄$2')
      .replace(/\^\(([^()]+)\)/g, '<sup>$1</sup>')
      .replace(/_\(([^()]+)\)/g, '<sub>$1</sub>');
  }

  // The same option label rule the Sample Materials page uses, so (B) here is (B) there.
  function optionLabel(q, index, text) {
    var style = q.labelStyle || q.mcqLabels;
    var letters = style === 'letters' || (!style && /^(?:sec|secondary|s[1-5]\b)/i.test(q.level || ''));
    var label = letters ? String.fromCharCode(65 + index) : String(index + 1);
    var copy = String(text || '');
    var bare = copy.match(/^\s*\(\s*([1-9]|[A-Ha-h])\s*\)\s*$/);
    var number = bare && (/^[a-h]$/i.test(bare[1]) ? bare[1].toUpperCase().charCodeAt(0) - 64 : Number(bare[1]));
    return { label: label, text: !copy || number === index + 1 ? '' : copy };
  }

  function safeImage(url) {
    return /^https:\/\//i.test(String(url || '')) ? String(url) : '';
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

  function blocksOf(q) {
    return Array.isArray(q && q.blocks) ? q.blocks.filter(function (b) { return b && typeof b === 'object'; }) : [];
  }

  function methodOf(q) {
    var types = blocksOf(q).map(function (b) { return b.type; });
    if (types.indexOf('cer') >= 0) return 'Claim. Evidence. Reasoning.';
    if (types.indexOf('mcq') >= 0) return 'Multiple choice';
    if (types.indexOf('fillblank') >= 0) return 'Fill in the blanks';
    return 'Short answer';
  }

  // The words the question asks with: its title, else its first text block.
  function headingOf(q) {
    if (q.title && String(q.title).trim()) return clip(q.title, 120);
    var first = blocksOf(q).filter(function (b) { return (b.type === 'text' || b.type === 'part') && b.text; })[0];
    return first ? clip(first.text, 120) : 'Sample question';
  }

  // Up to MAX_ROWS rows in the card's own C/E/R row shape: options, CER steps or the parts.
  function rowsOf(q) {
    var rows = [];
    var heading = headingOf(q);
    blocksOf(q).forEach(function (b) {
      if (rows.length >= MAX_ROWS) return;
      if (b.type === 'mcq' && Array.isArray(b.options)) {
        b.options.forEach(function (o, i) {
          if (rows.length >= MAX_ROWS) return;
          var lab = optionLabel(q, i, o && o.text);
          rows.push({ letter: lab.label, label: 'Option', text: lab.text ? clip(lab.text, 90) : 'See the picture' });
        });
      } else if (b.type === 'cer') {
        [['C', 'Make a claim'], ['E', 'Use the evidence'], ['R', 'Connect the science']].forEach(function (s) {
          if (rows.length < MAX_ROWS) rows.push({ letter: s[0], label: s[1], text: 'Your answer goes here' });
        });
      } else if ((b.type === 'text' || b.type === 'part') && b.text && b.label) {
        var t = clip(b.text, 90);
        if (t && t !== heading) rows.push({ letter: clip(String(b.label).replace(/[()]/g, ''), 4), label: 'Part', text: t });
      } else if (b.type === 'fillblank' && Array.isArray(b.segments)) {
        var words = b.segments.map(function (s) { return typeof s === 'string' ? s : (s && s.text) || '____'; }).join(' ');
        if (words.trim()) rows.push({ letter: '…', label: 'Fill in the blanks', text: clip(words, 90) });
      } else if (b.type === 'response' && b.label) {
        rows.push({ letter: clip(String(b.label).replace(/[()]/g, ''), 4), label: 'Your answer', text: clip(b.text || 'Write your answer', 90) });
      }
    });
    return rows;
  }

  function firstImage(q) {
    var img = blocksOf(q).filter(function (b) { return b.type === 'image' && safeImage(b.url); })[0];
    return img ? { url: safeImage(img.url), alt: clip(img.caption || img.label || 'Question diagram', 80) } : null;
  }

  function tryHref(el) {
    var inSchedule = el && el.closest && el.closest('#tab-sample-materials');
    if (inSchedule) return '#sample-materials-content';
    var path = (root.location && root.location.pathname) || '';
    return /\/schedule\//.test(path) ? '#sample-materials-content' : 'schedule/#sample-materials';
  }

  // One live sample question, drawn in the card's own classes so the card keeps its look.
  function renderSample(q, opts) {
    opts = opts || {};
    var index = opts.index || 0;
    var count = opts.count || 1;
    var meta = [q.level, q.topic].filter(function (v) { return v && String(v).trim(); }).map(function (v) { return clip(v, 40); }).join(' · ');
    var image = firstImage(q);
    var dots = '';
    if (count > 1) {
      for (var i = 0; i < count; i++) {
        dots += '<button type="button" data-pp-go="' + i + '" aria-label="Show sample question ' + (i + 1) + '"' +
          (i === index ? ' aria-current="true"' : '') +
          ' style="width:22px;height:22px;border-radius:999px;border:1px solid currentColor;margin-left:4px;font:inherit;font-size:10px;line-height:1;cursor:pointer;background:' +
          (i === index ? 'currentColor' : 'transparent') + ';color:inherit;padding:0">' +
          '<span style="' + (i === index ? 'filter:invert(1)' : '') + '">' + (i + 1) + '</span></button>';
      }
    }
    return '<div class="lp-preview-top"><span>' + BOOK + ' Your next lightbulb moment</span>' +
        '<span class="lp-preview-label">Sample question ' + (index + 1) + ' of ' + count + '</span></div>' +
      '<div class="lp-preview-content">' +
        '<div class="lp-preview-meta"><span>' + esc(meta || 'Sample question') + '</span><span>' + esc(methodOf(q)) + '</span></div>' +
        '<h2>' + mathHtml(headingOf(q)) + '</h2>' +
        (image ? '<img src="' + esc(image.url) + '" alt="' + esc(image.alt) + '" loading="lazy" style="display:block;max-width:100%;max-height:110px;object-fit:contain;margin:6px 0 8px">' : '') +
        rowsOf(q).map(function (row) {
          return '<div class="lp-cer-row"><b>' + esc(row.letter) + '</b><div><small>' + esc(row.label) + '</small>' + mathHtml(row.text) + '</div></div>';
        }).join('') +
      '</div>' +
      '<div class="lp-preview-foot"><span>Teacher-selected sample · no account needed' + (dots ? '<span style="display:inline-flex;margin-left:6px;vertical-align:middle">' + dots + '</span>' : '') + '</span>' +
        '<b><a href="' + esc(opts.href || 'schedule/#sample-materials') + '" style="color:inherit">Try it yourself</a></b></div>';
  }

  function renderFloat(preview) {
    var f = (preview || PREVIEW).float;
    return SPARK + '<div>' + esc(f.text) + '<small>' + esc(f.small) + '</small></div>';
  }

  // Plain text of the question, for labels and tests.
  function questionText(preview) {
    return (preview || PREVIEW).question.join(' ');
  }

  // Keep only questions that have something to show.
  function usable(list) {
    return (Array.isArray(list) ? list : []).filter(function (q) {
      return q && typeof q === 'object' && (String(q.title || '').trim() || blocksOf(q).length);
    }).slice(0, MAX_QUESTIONS);
  }

  var live = null;       // the questions once loaded
  var loading = null;    // the one request for this page

  function request(subject) {
    var body = JSON.stringify({ action: 'questions', subject: subject });
    var init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(TIMEOUT_MS);
    return fetch(API, init).then(function (r) {
      if (!r.ok) throw new Error('sample service ' + r.status);
      return r.json();
    }).then(function (d) { return usable(d && d.questions); });
  }

  // Science first (the card is a CER card); Math only if Science has no questions selected.
  function loadLive() {
    if (live) return Promise.resolve(live);
    if (loading) return loading;
    if (typeof fetch !== 'function') return Promise.resolve([]);
    loading = SUBJECTS.reduce(function (chain, subject) {
      return chain.then(function (found) {
        if (found.length) return found;
        return request(subject).catch(function () { return []; });
      });
    }, Promise.resolve([])).then(function (found) {
      live = found.length ? found : null;
      return found;
    });
    return loading;
  }

  function show(el, index) {
    if (!live || !live.length) return;
    var i = ((index % live.length) + live.length) % live.length;
    el.innerHTML = renderSample(live[i], { index: i, count: live.length, href: tryHref(el) });
    el.setAttribute('data-pp-index', String(i));
    el.setAttribute('data-pp-live', '1');
    el.style.setProperty('--pp-tilt', TILT);
  }

  function bind(el) {
    if (el.getAttribute('data-pp-bound')) return;
    el.setAttribute('data-pp-bound', '1');
    el.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-pp-go]');
      if (!btn) return;
      e.preventDefault();
      show(el, Number(btn.getAttribute('data-pp-go')) || 0);
    });
  }

  function mount(el) {
    if (!el || el.getAttribute('data-practice-preview-ready')) return;
    el.innerHTML = render();
    el.style.setProperty('--pp-tilt', TILT);
    el.setAttribute('data-practice-preview-ready', '1');
    bind(el);
    loadLive().then(function () { show(el, 0); }, function () { /* keep the built-in example */ });
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

  var api = {
    API: API, PREVIEW: PREVIEW, TILT: TILT, render: render, renderSample: renderSample, renderFloat: renderFloat,
    questionText: questionText, mount: mount, mountAll: mountAll, loadLive: loadLive, usable: usable,
    optionLabel: optionLabel, mathHtml: mathHtml, esc: esc,
    _reset: function () { live = null; loading = null; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PracticePreview = api;

  mountAll();
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  }
})(typeof window !== 'undefined' ? window : globalThis);
