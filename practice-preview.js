/* The "Your next lightbulb moment" card on the home page and the schedule page's Sample Materials tab.
   It shows the SAME questions the teacher picked under Sample Materials, fetched live from the sample
   service, so changing the selection there changes this card too, and visitors can answer them right
   in the card: tap an option (or write an answer and press Check) and the service marks it, exactly as
   the Sample Materials player does, with why each wrong option is wrong.

   Speed: the page's <head> starts the Science request (window.__ppEarly) long before this script runs,
   and the last questions loaded are kept in this browser, so a repeat visit draws them instantly while
   a fresh copy loads behind them. A first visit shows a quiet loading card of the same size and tilt.
   The built-in CER example below is ONLY the fallback when the service cannot be reached at all.

   Loaded as a plain (non-deferred) <script> straight after its [data-practice-preview] element, so the
   card is filled before first paint; it also exports itself for node tests. Everything the bank stored
   is escaped before it is drawn. */
(function (root) {
  'use strict';

  var API = 'https://us-central1-mathgen--app.cloudfunctions.net/studyBuddySample';
  var SUBJECTS = ['science', 'math'];
  var TIMEOUT_MS = 20000;          // loading the questions
  var CHECK_TIMEOUT_MS = 110000;   // marking an answer (the same limit the Sample Materials player uses)
  var MAX_QUESTIONS = 5;
  var MAX_OPTIONS = 6;
  var MAX_IMAGES = 2;
  var MAX_TEXTS = 4;
  var CACHE_KEY = 'pp-samples-v1';
  var CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  // Review (right answer, reasons, explanation) is only shown for a real verdict, as on Sample Materials.
  var REVIEWED = ['correct', 'incorrect', 'partly-correct'];

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

  var FOOT_NOTE = 'Teacher-selected sample · no account needed';

  // ── Small text helpers ──────────────────────────────────────────────────────────────────────────

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

  // Longer text keeps its line breaks.
  function mathLines(value) {
    return String(value == null ? '' : value).split(/\n+/).map(function (line) {
      return mathHtml(line.trim());
    }).filter(Boolean).join('<br>');
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

  // ── The card's own styles, injected once so both pages share them without copying CSS ──────────
  // Each rule is written against "&" and expanded under both pages' card scopes, so it outranks the
  // pages' own .lp-cer-row rules (the home page scopes those under #landingPage).
  var SCOPES = ['#landingPage [data-practice-preview]', '.pp-stage [data-practice-preview]', '[data-practice-preview]'];
  var RULES = [
    '& .pp-opt { display:flex; width:100%; text-align:left; font:inherit; color:inherit; border:1px solid transparent; cursor:pointer; transition:border-color .15s, background-color .15s, transform .15s; -webkit-tap-highlight-color:transparent; }',
    '& .pp-opt:hover:not(:disabled) { border-color:#9fd3da; background:#eaf6f8; }',
    '& .pp-opt:active:not(:disabled) { transform:scale(.99); }',
    '& .pp-opt:focus-visible { outline:2px solid var(--lp-green,#0f6e7b); outline-offset:2px; }',
    '& .pp-opt:disabled { cursor:default; }',
    '& .pp-opt[data-state="chosen"] { border-color:var(--lp-green,#0f6e7b); background:#e6f4f6; }',
    '& .pp-opt[data-state="correct"] { border-color:#3d9a62; background:#e8f6ed; }',
    '& .pp-opt[data-state="correct"] > b { background:#3d9a62; color:#fff; }',
    '& .pp-opt[data-state="wrong"] { border-color:#d0645a; background:#fcecea; }',
    '& .pp-opt[data-state="wrong"] > b { background:#d0645a; color:#fff; }',
    '& .pp-opt-copy { display:block; flex:1; min-width:0; overflow-wrap:anywhere; }',
    '& .pp-opt[data-state="correct"] small { color:#2c7a4b; }',
    '& .pp-opt[data-state="wrong"] small { color:#b04a40; }',
    '& .pp-why { display:block; margin-top:6px; padding-top:6px; border-top:1px dashed #e3c2be; color:#7b3b34; font-size:10.5px; line-height:1.6; }',
    '& .pp-opt[data-state="correct"] .pp-why { border-top-color:#bfe0cb; color:#2c5e41; }',
    '& .pp-why strong { font-weight:700; }',
    '& .pp-text { font-size:12px; line-height:1.65; margin:0 0 10px; color:inherit; overflow-wrap:anywhere; }',
    '& .pp-text b { color:var(--lp-green,#0f6e7b); margin-right:4px; }',
    '& .pp-img { display:block; max-width:100%; max-height:150px; width:auto; height:auto; object-fit:contain; margin:6px 0 10px; border-radius:6px; }',
    '& .pp-table { overflow-x:auto; margin:4px 0 10px; }',
    '& .pp-table table { border-collapse:collapse; font-size:10.5px; }',
    '& .pp-table th, & .pp-table td { border:1px solid #d7ebee; padding:4px 7px; text-align:left; }',
    '& .pp-table th { background:#f3f9fa; }',
    '& .pp-field { display:block; margin-top:10px; font-size:9px; font-weight:700; letter-spacing:.6px; text-transform:uppercase; color:var(--lp-muted,#617173); }',
    '& .pp-field textarea, & .pp-blank { display:block; width:100%; box-sizing:border-box; margin-top:5px; padding:8px 10px; border:1px solid #cfe5e8; border-radius:7px; font:inherit; font-size:12px; font-weight:400; letter-spacing:0; text-transform:none; color:inherit; background:#fff; resize:vertical; }',
    '& .pp-field textarea { min-height:58px; }',
    '& .pp-field textarea:focus, & .pp-blank:focus { outline:2px solid #9fd3da; border-color:var(--lp-green,#0f6e7b); }',
    '& .pp-blanks { font-size:12px; line-height:2.2; overflow-wrap:anywhere; }',
    '& .pp-blank { display:inline-block; width:auto; min-width:90px; max-width:100%; margin:0 4px; padding:4px 8px; resize:none; }',
    '& .pp-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }',
    '& .pp-btn { font:inherit; font-size:12px; font-weight:700; border-radius:8px; padding:9px 14px; cursor:pointer; border:1px solid var(--lp-green,#0f6e7b); background:var(--lp-green,#0f6e7b); color:#fff; min-height:38px; }',
    '& .pp-btn.pp-ghost { background:transparent; color:var(--lp-green,#0f6e7b); }',
    '& .pp-btn:disabled { opacity:.6; cursor:default; }',
    '& .pp-btn:focus-visible { outline:2px solid #9fd3da; outline-offset:2px; }',
    '& .pp-status { display:flex; align-items:center; gap:8px; margin-top:12px; font-size:11.5px; color:var(--lp-muted,#617173); }',
    '& .pp-status::before { content:""; width:12px; height:12px; border-radius:50%; border:2px solid #cfe5e8; border-top-color:var(--lp-green,#0f6e7b); animation:pp-spin .8s linear infinite; flex-shrink:0; }',
    '& .pp-feedback { margin-top:12px; padding:10px 12px; border-radius:8px; font-size:11.5px; line-height:1.6; background:#f3f9fa; border:1px solid #d7ebee; }',
    '& .pp-feedback strong { display:block; font-size:12.5px; margin-bottom:2px; }',
    '& .pp-feedback[data-verdict="correct"] { background:#e8f6ed; border-color:#bfe0cb; color:#1f5a37; }',
    '& .pp-feedback[data-verdict="incorrect"] { background:#fcecea; border-color:#efc7c2; color:#7b3b34; }',
    '& .pp-feedback[data-verdict="partly-correct"] { background:#fff6e5; border-color:#f1d9a6; color:#7a5313; }',
    '& .pp-review { margin-top:10px; padding:10px 12px; border-radius:8px; background:#f7fbfc; border:1px solid #e1eff1; font-size:11.5px; line-height:1.65; }',
    '& .pp-review h3 { margin:0 0 4px; font-size:9px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--lp-muted,#617173); }',
    '& .pp-review img { display:block; max-width:100%; max-height:180px; margin-top:6px; border-radius:6px; }',
    '& .pp-note { margin-top:10px; font-size:11px; color:var(--lp-muted,#617173); }',
    '& .pp-note a { color:var(--lp-green,#0f6e7b); font-weight:700; }',
    '& .pp-dots { display:inline-flex; gap:4px; margin-left:6px; vertical-align:middle; }',
    '& .pp-dot { width:24px; height:24px; border-radius:999px; border:1px solid currentColor; font:inherit; font-size:10px; line-height:1; cursor:pointer; background:transparent; color:inherit; padding:0; }',
    '& .pp-dot[aria-current="true"] { background:var(--lp-green,#0f6e7b); border-color:var(--lp-green,#0f6e7b); color:#fff; }',
    '& .pp-skel { display:block; border-radius:5px; background:linear-gradient(90deg,#e7f2f4 0%,#f4fafb 50%,#e7f2f4 100%); background-size:200% 100%; animation:pp-shimmer 1.2s ease-in-out infinite; }',
    '& .pp-skel-row > b { background:#e7f2f4; }',
    '@media (max-width: 760px) { & .pp-field textarea, & .pp-blank { font-size:16px; } & .pp-text { font-size:13px; } & .pp-opt { min-height:48px; } }',
    '@media (prefers-reduced-motion: reduce) { & .pp-skel, & .pp-status::before { animation:none; } & .pp-opt { transition:none; } }'
  ];
  var KEYFRAMES = '@keyframes pp-spin { to { transform:rotate(360deg); } } @keyframes pp-shimmer { 0% { background-position:100% 0; } 100% { background-position:-100% 0; } }';

  function expandRule(rule) {
    var media = rule.match(/^(@media[^{]+)\{([\s\S]*)\}\s*$/);
    if (media) return media[1] + '{' + splitRules(media[2]).map(expandRule).join(' ') + '}';
    var brace = rule.indexOf('{');
    var selectors = rule.slice(0, brace).split(',').map(function (s) { return s.trim(); });
    var body = rule.slice(brace);
    var out = [];
    SCOPES.forEach(function (scope) {
      selectors.forEach(function (s) { out.push(s.replace(/&/g, scope)); });
    });
    return out.join(', ') + ' ' + body;
  }

  // Split "a { } b { }" into its rules (used inside @media blocks).
  function splitRules(css) {
    var rules = [], depth = 0, start = 0;
    for (var i = 0; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') { depth--; if (depth === 0) { rules.push(css.slice(start, i + 1).trim()); start = i + 1; } }
    }
    return rules.filter(Boolean);
  }

  function styles() {
    return KEYFRAMES + '\n' + RULES.map(expandRule).join('\n');
  }

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById('pp-style')) return;
    var style = document.createElement('style');
    style.id = 'pp-style';
    style.textContent = styles();
    (document.head || document.documentElement).appendChild(style);
  }

  // ── The built-in example (fallback only) and the loading card ───────────────────────────────────

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

  // Same header, same rows and roughly the same height as a real question, so nothing jumps when it lands.
  function renderLoading() {
    var row = '<div class="lp-cer-row pp-skel-row" aria-hidden="true"><b></b><div style="flex:1">' +
      '<span class="pp-skel" style="width:22%;height:8px;margin-top:3px"></span>' +
      '<span class="pp-skel" style="width:58%;height:12px;margin-top:8px"></span></div></div>';
    return '<div class="lp-preview-top"><span>' + BOOK + ' Your next lightbulb moment</span><span class="lp-preview-label">Sample question</span></div>' +
      '<div class="lp-preview-content">' +
        '<div class="lp-preview-meta"><span role="status">Loading a sample question…</span><span></span></div>' +
        '<span class="pp-skel" aria-hidden="true" style="width:88%;height:20px"></span>' +
        '<span class="pp-skel" aria-hidden="true" style="width:56%;height:20px;margin:8px 0 19px"></span>' +
        row + row + row + row +
      '</div>' +
      '<div class="lp-preview-foot"><span>' + FOOT_NOTE + '</span><b>Try it here</b></div>';
  }

  // ── Reading a live question ─────────────────────────────────────────────────────────────────────

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

  function hasId(b) {
    return b.id != null && String(b.id) !== '';
  }

  // The parts a visitor can answer here, in the field IDs the sample service marks.
  function answerable(q) {
    return blocksOf(q).filter(function (b) {
      if (!hasId(b)) return false;
      if (b.type === 'mcq') return Array.isArray(b.options) && b.options.length > 0;
      if (b.type === 'fillblank') return Array.isArray(b.segments) && b.segments.some(isBlank);
      return b.type === 'cer' || b.type === 'response';
    });
  }

  // One multiple-choice part and nothing else to write: a tap on an option is the answer.
  function oneTap(q) {
    var parts = answerable(q);
    return parts.length === 1 && parts[0].type === 'mcq';
  }

  // Drawing on a picture needs the full Sample Materials player.
  function needsPlayer(q) {
    return blocksOf(q).some(function (b) { return b.type === 'annotation' || (b.type === 'image' && b.annotate); });
  }

  function isBlank(segment) {
    return segment && typeof segment === 'object' && segment.type === 'blank';
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

  // The marked review, but only for a real verdict (never for "uncertain" or a failed check).
  function reviewOf(state) {
    var r = state && state.result;
    return r && REVIEWED.indexOf(r.verdict) >= 0 && r.review && typeof r.review === 'object' ? r.review : null;
  }

  function gradedFor(review, block) {
    if (!review || !Array.isArray(review.mcq)) return null;
    return review.mcq.filter(function (m) { return m && String(m.blockId) === String(block.id); })[0] || null;
  }

  // ── Drawing each part ──────────────────────────────────────────────────────────────────────────

  function textHtml(b) {
    return '<p class="pp-text">' + (b.label ? '<b>' + esc(clip(b.label, 12)) + '</b>' : '') + mathLines(clip(b.text, 420)) + '</p>';
  }

  function imageHtml(b) {
    var alt = clip(b.caption || b.label || 'Question diagram', 80);
    return '<img class="pp-img" src="' + esc(safeImage(b.url)) + '" alt="' + esc(alt) + '" decoding="async">';
  }

  function tableHtml(b) {
    var rows = b.rows.slice(0, 8);
    return '<div class="pp-table"><table>' + (b.caption ? '<caption>' + esc(clip(b.caption, 80)) + '</caption>' : '') +
      rows.map(function (row, r) {
        var tag = r === 0 && b.header ? 'th' : 'td';
        return '<tr>' + (Array.isArray(row) ? row : []).slice(0, 6).map(function (cell) {
          return '<' + tag + '>' + mathHtml(clip(cell, 60)) + '</' + tag + '>';
        }).join('') + '</tr>';
      }).join('') + '</table></div>';
  }

  function mcqHtml(q, b, state, review, interactive) {
    var graded = gradedFor(review, b);
    var reasons = graded && Array.isArray(graded.options) ? graded.options : [];
    var chosen = state.responses[String(b.id)];
    var pending = !!state.pending;
    return '<div class="pp-options" role="group" aria-label="Choose your answer">' +
      b.options.slice(0, MAX_OPTIONS).map(function (o, i) {
        var id = o && o.id != null ? String(o.id) : String(i);
        var lab = optionLabel(q, i, o && o.text);
        var picked = chosen === id;
        var stateName = '', tag = 'Option', why = '';
        if (graded) {
          var right = String(graded.correctId) === id;
          if (right) { stateName = 'correct'; tag = picked ? 'Your answer · correct' : 'Correct answer'; }
          else if (picked) { stateName = 'wrong'; tag = 'Your answer'; }
          var reason = reasons.filter(function (x) { return x && String(x.id) === id; })[0];
          if (reason && reason.why && !right) why = String(reason.why);
        } else if (picked) {
          stateName = 'chosen'; tag = pending ? 'Checking…' : 'Your answer';
        }
        var disabled = !interactive || pending;
        return '<button type="button" class="lp-cer-row pp-opt"' +
          (stateName ? ' data-state="' + stateName + '"' : '') +
          (interactive ? ' data-pp-opt="' + esc(id) + '" data-pp-block="' + esc(b.id) + '"' : '') +
          ' aria-pressed="' + (picked ? 'true' : 'false') + '"' + (disabled ? ' disabled' : '') + '>' +
          '<b>' + esc(lab.label) + '</b>' +
          '<span class="pp-opt-copy"><small>' + esc(tag) + '</small>' +
            (lab.text ? mathHtml(clip(lab.text, 220)) : 'See the picture') +
            (why ? '<span class="pp-why"><strong>Why not ' + esc(lab.label) + ':</strong> ' + mathHtml(clip(why, 400)) + '</span>' : '') +
          '</span></button>';
      }).join('') + '</div>';
  }

  function blanksHtml(b, state) {
    var n = 0;
    return '<div class="pp-blanks">' + b.segments.map(function (segment) {
      if (!isBlank(segment)) return mathHtml(typeof segment === 'string' ? segment : (segment && segment.text) || '');
      var field = String(b.id) + ':blank:' + n;
      n += 1;
      return '<input type="text" class="pp-blank" data-pp-field="' + esc(field) + '" value="' + esc(state.responses[field] || '') + '"' +
        ' aria-label="Blank ' + n + '" autocomplete="off" maxlength="500"' + (state.pending ? ' disabled' : '') + '>';
    }).join('') + '</div>';
  }

  function fieldHtml(field, label, state) {
    return '<label class="pp-field">' + esc(label) +
      '<textarea data-pp-field="' + esc(field) + '" rows="2" maxlength="5000"' + (state.pending ? ' disabled' : '') + '>' +
      esc(state.responses[field] || '') + '</textarea></label>';
  }

  function cerHtml(b, state) {
    return [['claim', 'Claim: what do you conclude?'], ['evidence', 'Evidence: what in the question supports it?'], ['reasoning', 'Reasoning: explain the science linking them.']]
      .map(function (part) { return fieldHtml(String(b.id) + ':' + part[0], part[1], state); }).join('');
  }

  function responseHtml(b, state) {
    return (b.text ? '<p class="pp-text">' + mathLines(clip(b.text, 420)) + '</p>' : '') +
      fieldHtml(String(b.id), clip(b.label || 'Your answer', 60), state);
  }

  function bodyHtml(q, state, heading) {
    var review = reviewOf(state);
    var images = 0, texts = 0;
    return blocksOf(q).map(function (b) {
      if ((b.type === 'text' || b.type === 'part') && b.text) {
        if (texts >= MAX_TEXTS || clip(b.text, 120) === heading) return '';
        texts += 1;
        return textHtml(b);
      }
      if (b.type === 'image' && safeImage(b.url)) {
        if (images >= MAX_IMAGES) return '';
        images += 1;
        return imageHtml(b);
      }
      if (b.type === 'table' && Array.isArray(b.rows) && b.rows.length) return tableHtml(b);
      if (b.type === 'mcq' && Array.isArray(b.options) && b.options.length) return mcqHtml(q, b, state, review, hasId(b));
      if (!hasId(b)) return '';
      if (b.type === 'fillblank' && Array.isArray(b.segments)) return blanksHtml(b, state);
      if (b.type === 'cer') return cerHtml(b, state);
      if (b.type === 'response') return responseHtml(b, state);
      return '';
    }).join('');
  }

  function diagramsHtml(title, list) {
    var urls = (Array.isArray(list) ? list : []).map(function (item) {
      return safeImage(item && typeof item === 'object' ? item.url : item);
    }).filter(Boolean).slice(0, 2);
    if (!urls.length) return '';
    return '<section class="pp-review"><h3>' + esc(title) + '</h3>' + urls.map(function (url) {
      return '<img src="' + esc(url) + '" alt="' + esc(title) + '" loading="lazy" decoding="async">';
    }).join('') + '</section>';
  }

  var VERDICT_TITLES = {
    correct: 'Correct, well done.',
    incorrect: 'Not quite.',
    'partly-correct': 'Partly correct.'
  };

  // What comes under the question after a check: the verdict, why, and the way to go again.
  function resultHtml(q, state, opts) {
    if (state.pending) return '<p class="pp-status" role="status">Checking your answer…</p>';
    var r = state.result;
    if (!r) return '';
    var review = reviewOf(state);
    var title = VERDICT_TITLES[r.verdict] || '';
    var html = '<div class="pp-feedback" role="status" data-verdict="' + esc(r.verdict || 'uncertain') + '">' +
      (title ? '<strong>' + esc(title) + '</strong>' : '') + (r.feedback ? mathLines(clip(r.feedback, 600)) : (title ? '' : 'Please try again.')) + '</div>';
    if (review) {
      if (review.explanation) html += '<section class="pp-review"><h3>Explanation</h3>' + mathLines(clip(review.explanation, 900)) + '</section>';
      if (review.modelAnswer) html += '<section class="pp-review"><h3>Model answer</h3>' + mathLines(clip(review.modelAnswer, 900)) + '</section>';
      html += diagramsHtml('Answer diagram', review.answerDiagrams) + diagramsHtml('Picture it', review.explanationDiagrams);
      if (review.reasonError) html += '<p class="pp-note" role="status">' + esc(clip(review.reasonError, 240)) + '</p>';
      if (Array.isArray(review.widgets) && review.widgets.length) {
        html += '<p class="pp-note">This question also has an interactive activity. <a href="' + esc(opts.href) + '">Open it on Sample Materials</a>.</p>';
      }
    }
    if (r.verdict === 'empty') return html;
    var count = opts.count || 1;
    return html + '<div class="pp-actions">' +
      (REVIEWED.indexOf(r.verdict) >= 0 ? '<button type="button" class="pp-btn pp-ghost" data-pp-retry>Try this question again</button>' : '') +
      (count > 1 ? '<button type="button" class="pp-btn" data-pp-go="' + (((opts.index || 0) + 1) % count) + '">Next question</button>' : '') +
      '</div>';
  }

  // One live sample question, drawn in the card's own classes so the card keeps its look, and
  // answerable in place. opts: { index, count, href, state }.
  function renderSample(q, opts) {
    opts = opts || {};
    var index = opts.index || 0;
    var count = opts.count || 1;
    var href = opts.href || 'schedule/#sample-materials';
    var state = opts.state || { responses: {}, result: null, pending: false };
    if (!state.responses) state.responses = {};
    var meta = [q.level, q.topic].filter(function (v) { return v && String(v).trim(); }).map(function (v) { return clip(v, 40); }).join(' · ');
    var heading = headingOf(q);
    var parts = answerable(q);
    var tap = oneTap(q);
    var dots = '';
    if (count > 1) {
      for (var i = 0; i < count; i++) {
        dots += '<button type="button" class="pp-dot" data-pp-go="' + i + '" aria-label="Show sample question ' + (i + 1) + '"' +
          (i === index ? ' aria-current="true"' : '') + '>' + (i + 1) + '</button>';
      }
    }
    var hint = '';
    if (!parts.length || needsPlayer(q)) {
      hint = '<p class="pp-note">' + (parts.length ? 'Part of this question is drawn on the picture.' : 'This question is answered in the full player.') +
        ' <a href="' + esc(href) + '">Try it on Sample Materials</a>.</p>';
    } else if (!state.result && !state.pending && tap) {
      hint = '<p class="pp-note">Tap an answer to check it.</p>';
    }
    var check = parts.length && !tap && !(state.result && state.result.verdict !== 'empty')
      ? '<div class="pp-actions"><button type="button" class="pp-btn" data-pp-check' + (state.pending ? ' disabled' : '') + '>' +
        (state.pending ? 'Checking your answer…' : 'Check my answer') + '</button></div>'
      : '';
    return '<div class="lp-preview-top"><span>' + BOOK + ' Your next lightbulb moment</span>' +
        '<span class="lp-preview-label">Sample question ' + (index + 1) + ' of ' + count + '</span></div>' +
      '<div class="lp-preview-content">' +
        '<div class="lp-preview-meta"><span>' + esc(meta || 'Sample question') + '</span><span>' + esc(methodOf(q)) + '</span></div>' +
        '<h2>' + mathHtml(heading) + '</h2>' +
        bodyHtml(q, state, heading) +
        hint +
        (state.pending && !tap ? '' : check) +
        resultHtml(q, state, { index: index, count: count, href: href }) +
      '</div>' +
      '<div class="lp-preview-foot"><span>' + FOOT_NOTE + (dots ? '<span class="pp-dots">' + dots + '</span>' : '') + '</span>' +
        '<b><a href="' + esc(href) + '" style="color:inherit">More sample questions</a></b></div>';
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

  // ── Talking to the sample service ──────────────────────────────────────────────────────────────

  function post(body, timeout) {
    var init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(timeout);
    return fetch(API, init).then(function (r) {
      return Promise.resolve(r.json()).catch(function () { return null; }).then(function (d) {
        if (!r.ok) {
          var message = d && (d.message || (d.error && d.error.message));
          var err = new Error(message || 'The sample questions are unavailable right now. Please try again.');
          err.status = r.status;
          throw err;
        }
        if (!d || typeof d !== 'object') throw new Error('The sample service did not reply. Please try again.');
        return d;
      });
    });
  }

  // The page's <head> may already have asked for the Science questions (window.__ppEarly); use that
  // answer once, and ask again normally if it failed.
  function fetchSet(subject) {
    var early = subject === 'science' && root.__ppEarly;
    var asked;
    if (early && typeof early.then === 'function') {
      root.__ppEarly = null;
      asked = Promise.resolve(early).then(function (d) {
        if (!d || typeof d !== 'object') throw new Error('empty early answer');
        return d;
      }).catch(function () { return post({ action: 'questions', subject: subject }, TIMEOUT_MS); });
    } else {
      asked = post({ action: 'questions', subject: subject }, TIMEOUT_MS);
    }
    return asked.then(function (d) {
      return { subject: subject, token: typeof d.token === 'string' ? d.token : '', questions: usable(d.questions), fresh: true };
    });
  }

  // ── Remembering the last questions in this browser ─────────────────────────────────────────────

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  function readCache() {
    var s = storage();
    if (!s) return null;
    try {
      var c = JSON.parse(s.getItem(CACHE_KEY) || 'null');
      if (!c || typeof c !== 'object' || !(Date.now() - Number(c.at) < CACHE_MAX_AGE_MS)) return null;
      var questions = usable(c.questions);
      if (!questions.length) return null;
      return {
        subject: SUBJECTS.indexOf(c.subject) >= 0 ? c.subject : SUBJECTS[0],
        token: typeof c.token === 'string' ? c.token : '',
        questions: questions,
        fresh: false
      };
    } catch (e) { return null; }
  }

  function writeCache(set) {
    var s = storage();
    if (!s) return;
    try {
      s.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), subject: set.subject, token: set.token, questions: set.questions }));
    } catch (e) { /* storage full or blocked: the card still works, just without the instant repeat visit */ }
  }

  function sameQuestions(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  var live = null;       // the fresh set { subject, token, questions } once loaded
  var loading = null;    // the one request for this page
  var cached;            // undefined until read; then the stored set or null

  function cachedSet() {
    if (cached === undefined) cached = readCache();
    return cached;
  }

  // Science first (the card started as a CER card); Math only if Science has no questions selected.
  function loadFresh() {
    if (live) return Promise.resolve(live);
    if (loading) return loading;
    if (typeof fetch !== 'function') return Promise.resolve(null);
    loading = SUBJECTS.reduce(function (chain, subject) {
      return chain.then(function (found) {
        if (found && found.questions.length) return found;
        return fetchSet(subject).catch(function () { return found || null; });
      });
    }, Promise.resolve(null)).then(function (set) {
      if (!set || !set.questions.length) { loading = null; return null; }
      live = set;
      writeCache(set);
      return set;
    });
    return loading;
  }

  // The questions, fresh from the service ([] when it cannot be reached).
  function loadLive() {
    return loadFresh().then(function (set) { return set ? set.questions : []; });
  }

  // The set to mark with: the fresh one (it carries a current token), else the stored one.
  function markingSet(q) {
    return loadFresh().then(function (set) {
      if (set && set.questions.some(function (x) { return x.id === q.id; })) return set;
      var c = cachedSet();
      if (c && c.questions.some(function (x) { return x.id === q.id; })) return c;
      if (set) return set;
      throw new Error('The sample service cannot be reached right now. Please try again in a moment.');
    });
  }

  // Ask the service to mark one answer, exactly as the Sample Materials player does.
  function checkAnswer(q, responses) {
    return markingSet(q).then(function (set) {
      return post({ action: 'check', subject: set.subject, token: set.token, questionId: q.id, responses: responses }, CHECK_TIMEOUT_MS);
    });
  }

  // ── Per-card state and drawing ─────────────────────────────────────────────────────────────────

  function cardState(el) {
    if (!el.__pp) el.__pp = { set: null, index: 0, attempts: {} };
    return el.__pp;
  }

  function keyOf(q, index) {
    return q && q.id != null ? 'id:' + q.id : 'at:' + index;
  }

  function attemptFor(el, q, index) {
    var card = cardState(el);
    var key = keyOf(q, index);
    if (!card.attempts[key]) card.attempts[key] = { responses: {}, result: null, pending: false };
    return card.attempts[key];
  }

  function touched(el) {
    var attempts = cardState(el).attempts;
    return Object.keys(attempts).some(function (k) {
      var a = attempts[k];
      return a.pending || a.result || Object.keys(a.responses).length;
    });
  }

  function currentQuestion(el) {
    var card = cardState(el);
    return card.set ? card.set.questions[card.index] : null;
  }

  function show(el, index) {
    var card = cardState(el);
    var questions = card.set && card.set.questions;
    if (!questions || !questions.length) return;
    var i = (((index == null ? card.index : index) % questions.length) + questions.length) % questions.length;
    card.index = i;
    el.innerHTML = renderSample(questions[i], { index: i, count: questions.length, href: tryHref(el), state: attemptFor(el, questions[i], i) });
    el.setAttribute('data-pp-index', String(i));
    el.setAttribute('data-pp-live', '1');
    el.removeAttribute('aria-busy');
    el.removeAttribute('data-pp-fallback');
    el.style.setProperty('--pp-tilt', TILT);
  }

  // Redraw, keeping the visitor's place in a text box.
  function redraw(el) {
    var active = typeof document !== 'undefined' ? document.activeElement : null;
    var field = active && el.contains(active) && active.getAttribute('data-pp-field');
    var caret = field && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    show(el);
    if (!field) return;
    var again = el.querySelector('[data-pp-field="' + String(field).replace(/["\\]/g, '\\$&') + '"]');
    if (!again || again.disabled) return;
    again.focus({ preventScroll: true });
    if (caret != null && again.setSelectionRange) { try { again.setSelectionRange(caret, caret); } catch (e) { /* not a text box */ } }
  }

  // Warm the browser's cache with the other questions' pictures, so stepping through them is instant.
  function warmImages(set) {
    if (typeof Image === 'undefined' || !set) return;
    setTimeout(function () {
      set.questions.forEach(function (q) {
        var img = firstImage(q);
        if (img) { var pre = new Image(); pre.decoding = 'async'; pre.src = img.url; }
      });
    }, 1200);
  }

  function display(el, set) {
    var card = cardState(el);
    card.set = set;
    if (card.index >= set.questions.length) card.index = 0;
    show(el, card.index);
    warmImages(set);
  }

  function check(el) {
    var card = cardState(el);
    var q = currentQuestion(el);
    if (!q) return;
    var index = card.index;
    var state = attemptFor(el, q, index);
    if (state.pending) return;
    var filled = Object.keys(state.responses).some(function (k) { return String(state.responses[k] || '').trim(); });
    if (!filled) {
      state.result = { verdict: 'empty', feedback: 'Write an answer or choose an option first.' };
      show(el);
      return;
    }
    var responses = {};
    Object.keys(state.responses).forEach(function (k) { responses[k] = state.responses[k]; });
    state.pending = true;
    state.result = null;
    show(el);
    checkAnswer(q, responses).then(function (result) {
      state.result = result && typeof result === 'object' ? result : { verdict: 'uncertain', feedback: 'Please try again.' };
    }, function (err) {
      state.result = { verdict: 'uncertain', feedback: (err && err.message) || 'Your answer could not be checked. Please try again.' };
    }).then(function () {
      state.pending = false;
      if (currentQuestion(el) !== q) return;
      show(el);
      var focus = el.querySelector('.pp-feedback');
      if (focus && focus.scrollIntoView && focus.getBoundingClientRect) {
        var box = focus.getBoundingClientRect();
        var height = root.innerHeight || 0;
        if (height && (box.bottom > height || box.top < 0)) focus.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  function choose(el, blockId, optionId) {
    var card = cardState(el);
    var q = currentQuestion(el);
    if (!q) return;
    var state = attemptFor(el, q, card.index);
    if (state.pending) return;
    state.responses[blockId] = optionId;
    state.result = null;
    if (oneTap(q)) check(el);
    else show(el);
  }

  function bind(el) {
    if (el.getAttribute('data-pp-bound')) return;
    el.setAttribute('data-pp-bound', '1');
    el.addEventListener('click', function (e) {
      var target = e.target && e.target.closest ? e.target : null;
      if (!target) return;
      var go = target.closest('[data-pp-go]');
      if (go) { e.preventDefault(); show(el, Number(go.getAttribute('data-pp-go')) || 0); return; }
      var opt = target.closest('[data-pp-opt]');
      if (opt) { e.preventDefault(); if (!opt.disabled) choose(el, opt.getAttribute('data-pp-block'), opt.getAttribute('data-pp-opt')); return; }
      if (target.closest('[data-pp-check]')) { e.preventDefault(); check(el); return; }
      if (target.closest('[data-pp-retry]')) {
        e.preventDefault();
        var q = currentQuestion(el);
        if (!q) return;
        var card = cardState(el);
        delete card.attempts[keyOf(q, card.index)];
        show(el);
        var first = el.querySelector('[data-pp-opt],[data-pp-field]');
        if (first) first.focus({ preventScroll: true });
      }
    });
    el.addEventListener('input', function (e) {
      var field = e.target && e.target.getAttribute && e.target.getAttribute('data-pp-field');
      if (!field) return;
      var q = currentQuestion(el);
      if (!q) return;
      var state = attemptFor(el, q, cardState(el).index);
      state.responses[field] = e.target.value;
      // A changed answer takes back the old marking, as on Sample Materials.
      if (state.result) { state.result = null; redraw(el); }
    });
    el.addEventListener('keydown', function (e) {
      // Ctrl/Cmd+Enter in a text box checks the answer.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target && e.target.getAttribute && e.target.getAttribute('data-pp-field')) {
        e.preventDefault();
        check(el);
      }
    });
  }

  function mount(el) {
    if (!el || el.getAttribute('data-practice-preview-ready')) return;
    injectStyle();
    el.style.setProperty('--pp-tilt', TILT);
    el.setAttribute('data-practice-preview-ready', '1');
    bind(el);
    var stored = live || cachedSet();
    if (stored) {
      display(el, stored);
    } else {
      el.innerHTML = renderLoading();
      el.setAttribute('aria-busy', 'true');
    }
    loadFresh().then(function (set) {
      var card = cardState(el);
      if (set) {
        // Swap to the fresh questions unless the visitor is already answering the stored ones.
        if (!card.set || (card.set !== set && !touched(el) && !sameQuestions(card.set.questions, set.questions))) display(el, set);
        else if (sameQuestions(card.set.questions, set.questions)) card.set = set;
      } else if (!card.set) {
        el.innerHTML = render();
        el.removeAttribute('aria-busy');
        el.setAttribute('data-pp-fallback', '1');
      }
    }, function () {
      if (!cardState(el).set) { el.innerHTML = render(); el.removeAttribute('aria-busy'); el.setAttribute('data-pp-fallback', '1'); }
    });
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
    API: API, PREVIEW: PREVIEW, TILT: TILT, CACHE_KEY: CACHE_KEY,
    render: render, renderLoading: renderLoading, renderSample: renderSample, renderFloat: renderFloat,
    questionText: questionText, mount: mount, mountAll: mountAll, loadLive: loadLive, usable: usable,
    optionLabel: optionLabel, mathHtml: mathHtml, esc: esc, styles: styles,
    answerable: answerable, oneTap: oneTap, checkAnswer: checkAnswer, readCache: readCache,
    _reset: function () { live = null; loading = null; cached = undefined; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PracticePreview = api;

  // In a page, start loading before anything is drawn (the <head> may already have started Science).
  if (typeof document !== 'undefined') loadFresh();
  mountAll();
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  }
})(typeof window !== 'undefined' ? window : globalThis);
