/* The Free Question of the Day box on the home page (index.html, #lp-qotd).
 *
 * Shows today's Maths or Science question at the level the visitor picks (P3 to P6,
 * remembered on this device and shared with polymathlc.com.sg/question), fetched when
 * the box comes into view so the home page itself loads no faster or slower.
 *
 * Most days the question is an open question from Mr Chung's own worksheets (Ans Key)
 * or the CER Science bank, with any picture it needs: the visitor types an answer and
 * Chung GPT marks it straight away, without giving the answer away. The worked answer
 * is on /question the next day. On a day with nothing ready the built-in multiple
 * choice question is shown instead, as before.
 *
 * The sign-up asks for the child's level too, because nobody is ever sent a question
 * above their child's level. The full page, with the choice of subjects and daily or
 * weekly, is /question/.
 */
(function () {
  'use strict';
  var API = 'https://us-central1-mathgen--app.cloudfunctions.net/dailyQuestion';
  var PAGE_VERSION = 'home-v2.1.0';
  var LETTERS = ['A', 'B', 'C', 'D'];
  var LEVELS = ['P3', 'P4', 'P5', 'P6'];
  var EMAIL_PATTERN = /^[^\s@<>(),;:\\"]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;
  var ERRORS = {
    'too-many-answers': 'That is a lot of answers for now. Please try again a little later.',
    'marking-unavailable': 'Chung GPT is busy right now. Please try again in a minute.',
    'answer-too-long': 'Please keep the answer shorter (600 characters at most).',
    'empty-answer': 'Please type an answer first.',
    'not-open': 'This question is not one Chung GPT marks. Pick an answer instead.'
  };
  var root = document.getElementById('lp-qotd');
  if (!root) return;
  var box = root.querySelector('[data-qotd-question]');
  var form = root.querySelector('[data-qotd-form]');
  var data = null, subject = 'math', loading = false, marking = false, loadedLevel = '';
  var level = savedLevel();

  /* ───────────── Helpers ───────────── */
  function esc(value) {
    return String(value === undefined || value === null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function store(key, value) {
    try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
    return null;
  }
  function savedLevel() {
    var saved = store('qotd-level');
    return LEVELS.indexOf(saved) >= 0 ? saved : 'P5';
  }
  // Words with fractions drawn as small stacked fractions, the way /question shows them.
  function mathText(text) {
    return esc(text).replace(/(^|[^\d\/.])(\d{1,3})\/(\d{1,3})(?![\d\/])/g, function (m, before, n, d) {
      return before + '<span class="qd-frac" aria-label="' + n + ' over ' + d + '"><span>' + n + '</span><span>' + d + '</span></span>';
    }).replace(/\n/g, '<br>');
  }
  function getPick(q) {
    var raw = store('qotd-pick-' + q.day + '-' + q.subject);
    if (!raw) return null;
    var parts = raw.split(':');
    return parts[0] === q.id && Number(parts[1]) >= 0 && Number(parts[1]) < 4 ? Number(parts[1]) : null;
  }
  // A typed answer and its marking, under the same key /question uses.
  function answerKey(q) { return 'qotd-ans-' + q.day + '-' + q.subject + '-' + q.id; }
  function getAnswer(q) {
    try { var v = JSON.parse(store(answerKey(q)) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
  }
  function setAnswer(q, value) { store(answerKey(q), JSON.stringify(value)); }
  function post(body) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); })
      .catch(function () { return { status: 0, body: {} }; });
  }
  function errorText(r) {
    if (r.status === 0) return 'No connection. Please check your internet and try again.';
    return (r.body && ERRORS[r.body.error]) || 'Something went wrong. Please try again.';
  }

  /* ───────────── The question card ───────────── */
  function headHtml(q) {
    var html = '<div class="qd-top"><div class="qd-tabs" role="tablist" aria-label="Subject">'
      + ['math', 'science'].map(function (s) {
        return '<button type="button" role="tab" class="qd-tab ' + s + (s === subject ? ' on' : '') + '" aria-selected="' + (s === subject) + '" data-s="' + s + '">'
          + (s === 'math' ? '🔢 Maths' : '🔬 Science') + '</button>';
      }).join('') + '</div>'
      + '<div class="qd-levels" role="radiogroup" aria-label="Your child\'s level">' + LEVELS.map(function (l) {
        return '<button type="button" role="radio" class="qd-lvl' + (l === level ? ' on' : '') + '" aria-checked="' + (l === level) + '" data-l="' + l + '">' + l + '</button>';
      }).join('') + '</div></div>';
    if (q) html += '<div class="qd-day">' + esc(q.dayShort) + '</div>';
    return html;
  }
  function figHtml(q) {
    if (!q.images || !q.images.length) return '';
    // The home box shows the first picture; the others are on /question.
    var img = q.images[0];
    var html = '<div class="qd-fig"><img src="' + esc(img.url) + '" alt="' + esc(img.alt || 'The picture for this question') + '" width="' + Math.round(img.w / 2)
      + '" height="' + Math.round(img.h / 2) + '" loading="lazy" decoding="async"></div>';
    if (q.images.length > 1) html += '<p class="qd-more-figs"><a href="question/">See all ' + q.images.length + ' pictures on the question page →</a></p>';
    return html;
  }
  function mcqHtml(q) {
    var pick = getPick(q);
    var html = figHtml(q) + '<div class="qd-opts">';
    q.options.forEach(function (o, i) {
      html += '<button type="button" class="qd-opt' + (i === pick ? ' picked' : '') + '"' + (pick !== null ? ' disabled' : '') + ' data-i="' + i + '">'
        + '<span class="qd-letter">' + LETTERS[i] + '</span><span>' + mathText(o) + '</span></button>';
    });
    html += '</div>';
    html += pick !== null
      ? '<div class="qd-locked"><b>Locked in: ' + LETTERS[pick] + '.</b> The worked answer is ready tomorrow. <a href="question/">See yesterday\'s answer →</a></div>'
      : '<div class="qd-foot"><span>Pick an answer. The worked answer comes tomorrow.</span><a href="question/">Yesterday\'s answer →</a></div>';
    return html;
  }
  function markHtml(saved) {
    if (!saved || !saved.verdict) return '';
    var icon = saved.verdict === 'correct' ? '🎉' : saved.verdict === 'partial' ? '🟡' : '🤔';
    var head = saved.verdict === 'correct' ? 'Correct!' : saved.verdict === 'partial' ? 'Nearly there' : 'Not quite yet';
    return '<div class="qd-mark ' + esc(saved.verdict) + '" role="status"><span aria-hidden="true">' + icon + '</span><div><b>' + head + '</b> ' + esc(saved.feedback || '')
      + '<small>' + (saved.by === 'key' ? 'Checked against the answer' : 'Marked by Chung GPT, Mr Chung\'s marking assistant') + '</small></div></div>';
  }
  function openHtml(q) {
    var saved = getAnswer(q) || {};
    var html = figHtml(q);
    html += '<label class="qd-sr" for="qd-answer">Your answer</label>'
      + '<textarea id="qd-answer" class="qd-answer" maxlength="600" rows="2" placeholder="' + (q.answerType === 'explain' ? 'Type your answer in a sentence or two…' : 'Type your answer…') + '">'
      + esc(saved.answer || '') + '</textarea>';
    html += '<div class="qd-check-row"><button type="button" class="lp-button qd-check"' + (marking ? ' disabled' : '') + '>'
      + (marking ? 'Chung GPT is marking…' : saved.verdict ? 'Check again' : 'Check my answer') + '</button>'
      + '<span>Chung GPT marks it now. The worked answer comes tomorrow.</span></div>';
    html += markHtml(saved);
    html += '<div class="qd-foot"><span>' + (saved.verdict === 'correct' ? 'Well done! See the full working tomorrow.' : 'Free, every day, P3 to P6.') + '</span><a href="question/">Yesterday\'s answer →</a></div>';
    return html;
  }
  function render() {
    if (!data) return;
    var q = data.questions ? data.questions[subject] : null;
    var html = headHtml(q);
    if (!q) {
      html += '<div class="qd-none">No ' + (subject === 'math' ? 'Maths' : 'Science') + ' question for ' + esc(level) + ' today. '
        + '<button type="button" class="qd-link" data-s="' + (subject === 'math' ? 'science' : 'math') + '">Try the ' + (subject === 'math' ? 'Science' : 'Maths') + ' one →</button></div>';
    } else {
      html += '<div class="qd-tags"><span class="qd-tag ' + q.subject + '">' + esc(q.level + ' ' + q.subjectLabel) + '</span> <span class="qd-topic">' + esc(q.topic) + '</span></div>';
      if (q.forLevel && q.level !== q.forLevel) html += '<p class="qd-lvlnote">No ' + esc(q.forLevel) + ' question today, so here is a ' + esc(q.level) + ' one. Never above your level.</p>';
      html += '<p class="qd-q">' + mathText(q.q) + '</p>';
      html += q.kind === 'open' ? openHtml(q) : mcqHtml(q);
    }
    box.innerHTML = html;
    box.setAttribute('aria-busy', 'false');
  }
  function load() {
    if (loading || (data && loadedLevel === level)) return;
    loading = true;
    var want = level;
    post({ action: 'today', level: want }).then(function (r) {
      loading = false;
      if (want !== level) { load(); return; }
      if (r.status === 200 && r.body && r.body.ok) {
        data = r.body; loadedLevel = want;
        // Show a subject that has a question at this level.
        if (data.questions && !data.questions[subject]) subject = data.questions.math ? 'math' : data.questions.science ? 'science' : subject;
        render();
      } else if (!data) box.innerHTML = '<div class="qd-foot"><span>Today\'s question is on its own page.</span><a href="question/">Open it →</a></div>';
      else render();
    });
  }
  function chooseLevel(l) {
    if (LEVELS.indexOf(l) < 0 || l === level) return;
    level = l;
    store('qotd-level', l);
    var select = form ? form.querySelector('[name=level]') : null;
    if (select && !select.value) select.value = l;
    box.setAttribute('aria-busy', 'true');
    box.innerHTML = headHtml(null) + '<div class="qd-skel" style="width:92%"></div><div class="qd-skel" style="width:70%"></div><div class="qd-skel" style="height:44px"></div>';
    load();
  }
  function check() {
    var q = data && data.questions ? data.questions[subject] : null;
    var field = box.querySelector('.qd-answer');
    if (!q || !field || marking) return;
    var answer = field.value.trim();
    if (!answer) { field.focus(); showNote(ERRORS['empty-answer']); return; }
    marking = true;
    setAnswer(q, Object.assign({}, getAnswer(q) || {}, { answer: answer }));
    render();
    post({ action: 'mark', day: q.day, subject: q.subject, level: level, answer: answer }).then(function (r) {
      marking = false;
      if (r.status === 200 && r.body && r.body.ok) setAnswer(q, { answer: answer, verdict: r.body.verdict, feedback: r.body.feedback, by: r.body.by, at: Date.now() });
      else showNote(errorText(r));
      render();
    });
  }
  function showNote(text) {
    var old = box.querySelector('.qd-err');
    if (old) old.remove();
    var p = document.createElement('p');
    p.className = 'qd-err';
    p.setAttribute('role', 'alert');
    p.textContent = text;
    var row = box.querySelector('.qd-check-row') || box.lastChild;
    if (row && row.parentNode) row.parentNode.insertBefore(p, row.nextSibling); else box.appendChild(p);
  }

  box.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-s]');
    if (tab) { subject = tab.getAttribute('data-s'); render(); return; }
    var lvl = e.target.closest('.qd-lvl');
    if (lvl) { chooseLevel(lvl.getAttribute('data-l')); return; }
    if (e.target.closest('.qd-check')) { check(); return; }
    var opt = e.target.closest('.qd-opt');
    if (opt && !opt.disabled && data) {
      var q = data.questions[subject];
      store('qotd-pick-' + q.day + '-' + q.subject, q.id + ':' + opt.getAttribute('data-i'));
      render();
    }
  });
  box.addEventListener('input', function (e) {
    if (!e.target.classList || !e.target.classList.contains('qd-answer') || !data) return;
    var q = data.questions[subject];
    if (q) setAnswer(q, Object.assign({}, getAnswer(q) || {}, { answer: e.target.value }));
  });
  box.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.classList && e.target.classList.contains('qd-answer')) { e.preventDefault(); check(); }
  });

  /* ───────────── Sign-up ───────────── */
  if (form) {
    var levelSelect = form.querySelector('[name=level]');
    if (levelSelect && store('qotd-level')) levelSelect.value = level;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.querySelector('[name=email]').value.trim();
      var consent = form.querySelector('[name=consent]').checked;
      var childLevel = levelSelect ? levelSelect.value : '';
      var note = form.querySelector('[data-qotd-note]');
      var button = form.querySelector('button[type=submit]');
      note.className = 'qd-note';
      if (!EMAIL_PATTERN.test(email)) { note.textContent = 'Please check your email address.'; note.className = 'qd-note err'; return; }
      if (LEVELS.indexOf(childLevel) < 0) {
        note.textContent = 'Please choose your child\'s level, so we never send a question above it.'; note.className = 'qd-note err';
        if (levelSelect) levelSelect.focus();
        return;
      }
      if (!consent) { note.textContent = 'Please tick the box to agree to receive the emails.'; note.className = 'qd-note err'; return; }
      button.disabled = true;
      post({ action: 'subscribe', email: email, level: childLevel, subjects: ['math', 'science'], frequency: 'daily', consent: true, pageVersion: PAGE_VERSION, source: 'home-page',
        website: form.querySelector('[name=website]').value }).then(function (r) {
        button.disabled = false;
        if (r.status === 200 && r.body.ok) {
          store('qotd-level', childLevel);
          form.innerHTML = '<div class="qd-done"><b>✉️ Almost done! Check your inbox.</b> Click "Yes, send me the questions" in the email we sent to '
            + esc(email) + '. <a href="question/#join">Prefer Saturdays only, or one subject?</a></div>';
        } else {
          note.textContent = r.status === 429 ? 'Too many sign-ups from this connection. Please try again later.'
            : r.body && r.body.error === 'choose-level' ? 'Please choose your child\'s level (P3 to P6).' : 'Something went wrong. Please try again.';
          note.className = 'qd-note err';
        }
      });
    });
  }

  if ('IntersectionObserver' in window) {
    var seen = new IntersectionObserver(function (entries) {
      if (entries.some(function (en) { return en.isIntersecting; })) { seen.disconnect(); load(); }
    }, { rootMargin: '600px 0px' });
    seen.observe(root);
  } else load();
})();
