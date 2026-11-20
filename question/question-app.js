/* Free Question of the Day — polymathlc.com.sg/question
 *
 * v2.0.0: the questions come from the centre's own Ans Key worksheets and CER Science
 * bank, one per subject PER LEVEL (P3–P6, the level picker; never above it). An open
 * question is answered by typing, and Chung GPT marks it at once with a hint (the
 * `mark` action); the worked answer still only comes the next day. When no checked
 * question is waiting for a level, the day uses the hand-written multiple-choice bank.
 *
 * Today's Maths and Science questions (try them: the pick is kept on this device),
 * yesterday's worked answers, the past week, the sign-up form, the pages behind the
 * emailed links (?c= confirm, ?u= unsubscribe, ?m= manage, ?d= a past day) and the
 * admin list at #admin. Everything comes from the dailyQuestion function
 * (shop-function/functions/daily-question.js); the answers to today's questions
 * never reach this page until tomorrow.
 */
(function () {
  'use strict';

  var API = 'https://us-central1-mathgen--app.cloudfunctions.net/dailyQuestion';
  var PAGE_VERSION = 'v2.0.0';
  var LEVELS = ['P3', 'P4', 'P5', 'P6'];
  // Keep equal to QOTD_ADMINS in shop-function/functions/daily-question-core.js.
  var ADMINS = ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg'];
  var LETTERS = ['A', 'B', 'C', 'D'];
  var SUBJECT_LABEL = { math: 'Maths', science: 'Science' };
  var SUBJECT_ICON = { math: '🔢', science: '🔬' };
  var EMAIL_PATTERN = /^[^\s@<>(),;:\\"]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;
  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo',
    authDomain: 'mathgen--app.firebaseapp.com',
    projectId: 'mathgen--app',
    storageBucket: 'mathgen--app.firebasestorage.app',
    messagingSenderId: '165654161198',
    appId: '1:165654161198:web:16c8bd60eb3a2aa7edbcbf'
  };
  var ERRORS = {
    'invalid-email': 'Please check your email address.',
    'consent-required': 'Please tick the box to agree to receive the emails.',
    'choose-subject': 'Please choose Maths, Science or both.',
    'too-many-signups': 'Too many sign-ups from this connection just now. Please try again in an hour.',
    'invalid-link': 'This link is not valid any more.',
    'temporarily-unavailable': 'Something went wrong on our side. Please try again in a minute.',
    'admin-only': 'This account is not an admin account.',
    'sign-in-required': 'Please sign in again.',
    'test-just-sent': 'A test was just sent. Please wait a minute.',
    'just-sent': 'A confirmation was sent a few minutes ago. Please wait a little.',
    'invalid-cap': 'The cap must be a whole number from 0 to 1800.',
    'choose-level': 'Please choose your child\'s level (P3 to P6).',
    'too-many-answers': 'That is a lot of answers for now. Please try again later.',
    'marking-unavailable': 'Chung GPT cannot mark just now. Please try again in a minute.',
    'empty-answer': 'Type an answer first.',
    'answer-too-long': 'That answer is too long. Keep it to a few sentences.',
    'not-open': 'This question is answered by picking an option.',
    'no-question-at-level': 'There is no question at that level today to put in a test.',
    'not-ready': 'That question is not waiting any more.',
    'not-skipped': 'That question is not skipped.'
  };

  var params = new URLSearchParams(location.search);
  function startLevel() {
    var fromLink = params.get('l');
    if (LEVELS.indexOf(fromLink) >= 0) return fromLink;
    var saved = null;
    try { saved = localStorage.getItem('qotd-level'); } catch (e) { saved = null; }
    return LEVELS.indexOf(saved) >= 0 ? saved : 'P5';
  }
  var state = {
    data: null, todaySubject: location.hash === '#science' ? 'science' : 'math', ySubject: 'math', level: startLevel(),
    key: '', admin: null, adminFilter: 'active', adminSearch: '', adminSort: 'date', adminLevel: 'P5', adminImages: {}, marking: {}
  };

  /* ───────────── Helpers ───────────── */
  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value === undefined || value === null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var toastTimer = null;
  function toast(message, isError) {
    var t = $('toast');
    t.textContent = message;
    t.className = 'toast show' + (isError ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast' + (isError ? ' err' : ''); }, 4200);
  }
  function errorText(body, fallback) {
    var code = body && body.error;
    return ERRORS[code] || fallback || 'Something went wrong. Please try again.';
  }
  function api(body, token) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(API, { method: 'POST', headers: headers, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); })
      .catch(function () { return { status: 0, body: { error: 'offline' } }; });
  }
  function store(key, value) {
    try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
    return null;
  }
  var pickKey = function (day, subject) { return 'qotd-pick-' + day + '-' + subject; };
  function getPick(q) {
    var raw = store(pickKey(q.day, q.subject));
    if (!raw) return null;
    var parts = raw.split(':');
    if (parts[0] !== q.id) return null;
    var n = Number(parts[1]);
    return n >= 0 && n < 4 ? n : null;
  }
  function setPick(q, index) { store(pickKey(q.day, q.subject), q.id + ':' + index); }
  function fmtTime(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function fmtDate(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ───────────── A question ───────────── */
  // Words with fractions drawn as fractions: 3/4 → a small stacked fraction.
  function mathText(text) {
    return esc(text).replace(/(^|[^\d\/.])(\d{1,3})\/(\d{1,3})(?![\d\/])/g, function (m, before, n, d) {
      return before + '<span class="frac" aria-label="' + n + ' over ' + d + '"><span>' + n + '</span><span>' + d + '</span></span>';
    }).replace(/\n/g, '<br>');
  }
  var answerKey = function (q) { return 'qotd-ans-' + q.day + '-' + q.subject + '-' + q.id; };
  function getAnswer(q) {
    try { var v = JSON.parse(store(answerKey(q)) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
  }
  function setAnswer(q, value) { store(answerKey(q), JSON.stringify(value)); }
  function levelNote(q) {
    if (!q || !q.forLevel || q.level === q.forLevel) return '';
    return '<p class="fineprint" style="text-align:left;margin:-4px 0 12px">There is no ' + esc(q.forLevel + ' ' + q.subjectLabel) + ' question today, so here is a '
      + esc(q.level) + ' one. We never show a question above the level you picked.</p>';
  }
  function markHtml(mark) {
    if (!mark || !mark.verdict) return '';
    var icon = mark.verdict === 'correct' ? '🎉' : mark.verdict === 'partial' ? '🟡' : '🤔';
    var head = mark.verdict === 'correct' ? 'Correct!' : mark.verdict === 'partial' ? 'Nearly there' : 'Not quite yet';
    return '<div class="mark ' + mark.verdict + '" role="status"><span class="ico" aria-hidden="true">' + icon + '</span><div><b>' + head + '</b>'
      + esc(mark.feedback || '') + '<div class="who">' + (mark.by === 'key' ? 'Checked against the answer' : 'Marked by Chung GPT, Mr Chung\'s marking assistant') + '</div></div></div>';
  }
  function solutionHtml(q) {
    return '<div class="working"><h4>Worked answer</h4>'
      + '<p class="model"><b>Answer:</b> ' + mathText(q.answer) + '</p>'
      + (q.model && q.model !== q.answer ? '<p class="model"><b>Model answer:</b> ' + mathText(q.model) + '</p>' : '')
      + '<ol>' + (q.steps || []).map(function (st) { return '<li>' + mathText(st) + '</li>'; }).join('') + '</ol>'
      + '<div class="idea"><b>Key idea:</b> ' + mathText(q.idea) + '</div></div>';
  }
  function openHtml(q, mode) {
    var saved = getAnswer(q) || {};
    var busy = state.marking[q.day + '|' + q.subject];
    var html = '<div class="q ' + q.subject + '" data-qid="' + esc(q.id) + '">';
    html += '<div class="q-tags"><span class="tag ' + q.subject + '">' + esc(q.level + ' ' + q.subjectLabel) + '</span><span class="q-topic">' + esc(q.topic) + '</span></div>';
    html += levelNote(q);
    html += '<p class="q-text">' + mathText(q.q) + '</p>';
    if (q.images && q.images.length) {
      html += '<div class="q-figs">' + q.images.map(function (img) {
        return '<img src="' + esc(img.url) + '" alt="' + esc(img.alt) + '" width="' + Math.round(img.w / 2) + '" height="' + Math.round(img.h / 2) + '" loading="lazy" decoding="async">';
      }).join('') + '</div>';
    }
    var revealed = mode === 'answer' || (mode === 'try' && revealedOnce[q.day + '|' + q.subject]);
    if (!revealed || saved.answer) {
      var key = esc(q.day) + '|' + q.subject;
      html += '<div class="answer-box"><label class="sr" for="ans-' + key + '">Your answer</label>'
        + '<textarea id="ans-' + key + '" data-answer="' + key + '" maxlength="600" placeholder="' + (q.answerType === 'explain' ? 'Type your answer in a sentence or two…' : 'Type your answer…') + '"'
        + (revealed ? ' readonly' : '') + '>' + esc(saved.answer || '') + '</textarea>';
      if (!revealed) {
        html += '<div class="answer-row"><button type="button" class="btn" data-check="' + key + '"' + (busy ? ' disabled' : '') + '>'
          + (busy ? '<span class="spin"></span>Chung GPT is marking…' : saved.verdict ? 'Check again' : 'Check my answer') + '</button>'
          + '<span class="fineprint">' + (mode === 'today' ? 'Chung GPT marks it now. The worked answer comes tomorrow.' : 'Chung GPT marks it, then you can see the worked answer.') + '</span></div>';
      }
      html += '</div>';
    }
    html += markHtml(saved);
    if (mode === 'today' && saved.verdict === 'correct') {
      html += '<div class="locked"><b>Well done!</b> The full worked answer is on this page tomorrow. <a href="#join">Get tomorrow\'s question by email</a>.</div>';
    }
    if (revealed) html += solutionHtml(q);
    else if (mode === 'try') html += '<button type="button" class="btn ghost small reveal-btn" data-reveal="' + esc(q.day) + '|' + q.subject + '">Show me the worked answer</button>';
    return html + '</div>';
  }
  // mode: 'today' (answer, worked answer tomorrow) · 'try' (answer, then see it) · 'answer' (shown)
  function questionHtml(q, mode) {
    if (!q) {
      return '<div class="none-here">There is no question at this level for this subject on this day. '
        + (state.level === 'P3' ? 'Today\'s Maths questions start at P4. ' : '') + 'Try the other subject, or another level.</div>';
    }
    if (q.kind === 'open') return openHtml(q, mode);
    var pick = getPick(q);
    var revealed = mode === 'answer' || (mode === 'try' && pick !== null && typeof q.answer === 'number');
    var html = '<div class="q ' + q.subject + '" data-qid="' + esc(q.id) + '">';
    html += '<div class="q-tags"><span class="tag ' + q.subject + '">' + esc(q.level + ' ' + q.subjectLabel) + '</span><span class="q-topic">' + esc(q.topic) + '</span></div>';
    html += levelNote(q);
    html += '<p class="q-text">' + mathText(q.q) + '</p><div class="opts" role="group" aria-label="Answer options">';
    q.options.forEach(function (option, index) {
      var cls = 'opt';
      if (revealed) {
        if (index === q.answer) cls += ' right';
        else if (index === pick) cls += ' wrong';
      } else if (index === pick) cls += ' picked';
      var locked = revealed || (mode === 'today' && pick !== null);
      html += '<button type="button" class="' + cls + '"' + (locked ? ' disabled' : '') + ' data-day="' + esc(q.day) + '" data-subject="' + q.subject
        + '" data-index="' + index + '" data-mode="' + mode + '" aria-pressed="' + (index === pick) + '"><span class="letter">' + LETTERS[index] + '</span><span>'
        + mathText(option) + '</span></button>';
    });
    html += '</div>';
    if (mode === 'today' && pick !== null) {
      html += '<div class="locked"><b>Locked in: ' + LETTERS[pick] + '.</b> The worked answer is on this page tomorrow. '
        + '<a href="#join">Get it in your inbox</a> so you do not forget.</div>';
    }
    if (mode === 'today' && pick === null) {
      html += '<p class="fineprint" style="text-align:left">Pick an answer. We will show you the worked answer tomorrow.</p>';
    }
    if (revealed) {
      if (pick === null) html += '<div class="verdict none">Answer: ' + LETTERS[q.answer] + '. ' + esc(q.options[q.answer]) + '</div>';
      else if (pick === q.answer) html += '<div class="verdict yes">🎉 You picked ' + LETTERS[pick] + '. That is correct!</div>';
      else html += '<div class="verdict no">You picked ' + LETTERS[pick] + '. The answer is ' + LETTERS[q.answer] + '. ' + esc(q.options[q.answer]) + '</div>';
      html += '<div class="working"><h4>Worked answer</h4><ol>' + q.steps.map(function (st) { return '<li>' + mathText(st) + '</li>'; }).join('') + '</ol>'
        + '<div class="idea"><b>Key idea:</b> ' + mathText(q.idea) + '</div></div>';
    } else if (mode === 'try') {
      html += '<button type="button" class="btn ghost small reveal-btn" data-reveal="' + esc(q.day) + '|' + q.subject + '">Just show me the answer</button>';
    }
    return html + '</div>';
  }
  function findQuestion(day, subject) {
    var d = state.data;
    if (!d) return null;
    if (d.day === day && d.questions) return d.questions[subject];
    if (d.previous && d.previous.day === day) return d.previous.questions[subject];
    for (var i = 0; i < (d.recent || []).length; i++) if (d.recent[i].day === day) return d.recent[i].questions[subject];
    return null;
  }
  var revealedOnce = {};

  /* ───────────── Rendering the page ───────────── */
  function setTabs(container, subject) {
    container.querySelectorAll('.tab').forEach(function (tab) {
      var on = tab.getAttribute('data-subject') === subject;
      tab.classList.toggle('on', on);
      tab.setAttribute('aria-selected', String(on));
    });
  }
  function renderToday() {
    var d = state.data;
    var q = d.questions[state.todaySubject];
    $('today-title').textContent = d.isToday ? 'Today\'s question' : 'Question for ' + (q ? q.dayLabel : d.day);
    $('today-day').textContent = d.isToday ? (q ? q.dayLabel : '') : 'With its worked answer. Today\'s question is one click away.';
    setLevelButtons();
    setTabs($('today'), state.todaySubject);
    var mode = d.isToday ? 'today' : (revealedOnce[d.day + '|' + state.todaySubject] ? 'answer' : 'try');
    var html = questionHtml(q, mode);
    if (!d.isToday) html += '<p style="margin-top:14px"><a class="btn ghost" href="./">See today\'s question</a></p>';
    $('today-body').innerHTML = html;
  }
  function renderYesterday() {
    var d = state.data;
    if (!d.previous) { $('yesterday').classList.add('hidden'); return; }
    $('yesterday').classList.remove('hidden');
    $('yesterday-title').textContent = d.isToday ? 'Yesterday\'s answer' : 'The day before';
    var q = d.previous.questions[state.ySubject];
    $('yesterday-day').textContent = q ? q.dayLabel : '';
    setTabs($('yesterday'), state.ySubject);
    $('yesterday-body').innerHTML = questionHtml(q, 'answer');
  }
  function renderArchive() {
    var d = state.data;
    var list = d.recent || [];
    if (!list.length) { $('archive').classList.add('hidden'); return; }
    $('archive').classList.remove('hidden');
    $('archive-body').innerHTML = list.map(function (entry) {
      var m = entry.questions.math, s = entry.questions.science;
      if (!m && !s) return '';
      var label = (m || s).dayLabel;
      var body = ['math', 'science'].map(function (subject) {
        var q = entry.questions[subject];
        return q ? questionHtml(q, revealedOnce[entry.day + '|' + subject] ? 'answer' : 'try') : '';
      }).join('');
      return '<details class="past" data-day="' + esc(entry.day) + '"><summary>' + esc(label) + ' <span class="muted">'
        + esc((m ? m.level + ' Maths · ' + m.topic : '') + (m && s ? '  |  ' : '') + (s ? s.level + ' Science · ' + s.topic : '')) + '</span></summary>'
        + '<div class="past-body">' + body + '</div></details>';
    }).join('');
  }
  function renderAll() {
    renderToday();
    renderYesterday();
    renderArchive();
  }
  function rerenderDay(day) {
    var d = state.data;
    if (d.day === day) renderToday();
    else if (d.previous && d.previous.day === day) renderYesterday();
    else {
      var open = {};
      document.querySelectorAll('details.past[open]').forEach(function (el) { open[el.getAttribute('data-day')] = true; });
      renderArchive();
      document.querySelectorAll('details.past').forEach(function (el) { if (open[el.getAttribute('data-day')]) el.open = true; });
    }
  }

  function todayBody(day) {
    var body = { action: 'today', level: state.level };
    if (day) body.day = day;
    return body;
  }
  function loadQuestions() {
    var day = params.get('d');
    var early = window.__qotdEarly && window.__qotdEarlyLevel === state.level && (!day || /^\d{4}-\d{2}-\d{2}$/.test(day)) ? window.__qotdEarly : null;
    window.__qotdEarly = null;
    var request = early ? early.then(function (r) { return r || api(todayBody(day)); }) : api(todayBody(day));
    return request.then(function (r) {
      if (r.status === 404 && day) {
        // A day in the future or before the start: show today instead.
        history.replaceState(null, '', location.pathname + location.hash);
        params.delete('d');
        return api(todayBody(null));
      }
      return r;
    }).then(function (r) {
      if (!r || r.status !== 200 || !r.body || !r.body.ok) {
        $('today-body').innerHTML = '<div class="state">We could not load today\'s question. <button class="btn small ghost" type="button" id="retry">Try again</button></div>';
        var retry = $('retry');
        if (retry) retry.onclick = function () { window.__qotdEarly = null; $('today-body').innerHTML = '<div class="state"><span class="spin"></span>Loading…</div>'; loadQuestions(); };
        return;
      }
      state.data = r.body;
      renderAll();
    });
  }

  /* ───────────── Clicks on answers and tabs ───────────── */
  document.addEventListener('click', function (event) {
    var opt = event.target.closest && event.target.closest('.opt');
    if (opt && !opt.disabled) {
      var day = opt.getAttribute('data-day'), subject = opt.getAttribute('data-subject');
      var q = findQuestion(day, subject);
      if (!q) return;
      setPick(q, Number(opt.getAttribute('data-index')));
      if (opt.getAttribute('data-mode') === 'today') toast('Locked in! Come back tomorrow for the worked answer.');
      rerenderDay(day);
      return;
    }
    var check = event.target.closest && event.target.closest('[data-check]');
    if (check && !check.disabled) { checkAnswer(check.getAttribute('data-check')); return; }
    var lvl = event.target.closest && event.target.closest('.lvl');
    if (lvl) { chooseLevel(lvl.getAttribute('data-level')); return; }
    var reveal = event.target.closest && event.target.closest('[data-reveal]');
    if (reveal) {
      revealedOnce[reveal.getAttribute('data-reveal')] = true;
      rerenderDay(reveal.getAttribute('data-reveal').split('|')[0]);
      return;
    }
    var tab = event.target.closest && event.target.closest('.tab');
    if (tab && state.data) {
      var section = tab.closest('section');
      if (section && section.id === 'today') { state.todaySubject = tab.getAttribute('data-subject'); renderToday(); }
      if (section && section.id === 'yesterday') { state.ySubject = tab.getAttribute('data-subject'); renderYesterday(); }
    }
  });

  /* ───────────── Levels and typed answers ───────────── */
  function setLevelButtons() {
    document.querySelectorAll('#level-pick .lvl').forEach(function (b) {
      var on = b.getAttribute('data-level') === state.level;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  function chooseLevel(level) {
    if (LEVELS.indexOf(level) < 0 || level === state.level) return;
    state.level = level;
    store('qotd-level', level);
    var select = $('j-level');
    if (select && !select.value) select.value = level;
    setLevelButtons();
    $('today-body').innerHTML = '<div class="state"><span class="spin"></span>Loading the ' + esc(level) + ' questions…</div>';
    loadQuestions();
  }
  function checkAnswer(key) {
    var parts = key.split('|'), day = parts[0], subject = parts[1];
    var q = findQuestion(day, subject);
    var box = document.querySelector('[data-answer="' + key + '"]');
    if (!q || !box) return;
    var answer = box.value.trim();
    if (!answer) { toast(ERRORS['empty-answer'], true); box.focus(); return; }
    state.marking[key] = true;
    setAnswer(q, Object.assign({}, getAnswer(q) || {}, { answer: answer }));
    rerenderDay(day);
    api({ action: 'mark', day: day, subject: subject, level: state.level, answer: answer }).then(function (r) {
      delete state.marking[key];
      if (r.status === 200 && r.body && r.body.ok) {
        setAnswer(q, { answer: answer, verdict: r.body.verdict, feedback: r.body.feedback, by: r.body.by, at: Date.now() });
        if (r.body.verdict === 'correct') toast('🎉 Correct! Well done.');
      } else toast(errorText(r.body, r.status === 0 ? 'No connection. Please check your internet and try again.' : null), true);
      rerenderDay(day);
    });
  }

  /* ───────────── Sign-up ───────────── */
  function chipValues(groupId) {
    return Array.prototype.map.call($(groupId).querySelectorAll('.chip.on'), function (c) { return c.getAttribute('data-value'); });
  }
  function wireChips(group, multiple) {
    group.addEventListener('click', function (event) {
      var chip = event.target.closest('.chip');
      if (!chip) return;
      if (multiple) {
        var on = !chip.classList.contains('on');
        // Never fewer than one subject.
        if (!on && group.querySelectorAll('.chip.on').length === 1) { toast('Choose at least one subject.'); return; }
        chip.classList.toggle('on', on);
        chip.setAttribute('aria-pressed', String(on));
      } else {
        group.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c === chip); c.setAttribute('aria-checked', String(c === chip)); });
      }
    });
  }
  function showJoinError(text) {
    var el = $('j-error');
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  }
  function wireJoin() {
    wireChips($('j-subjects'), true);
    wireChips($('j-frequency'), false);
    $('j-level').value = LEVELS.indexOf(store('qotd-level')) >= 0 ? store('qotd-level') : '';
    $('join-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var email = $('j-email').value.trim();
      showJoinError('');
      if (!EMAIL_PATTERN.test(email)) { showJoinError(ERRORS['invalid-email']); $('j-email').focus(); return; }
      if (LEVELS.indexOf($('j-level').value) < 0) { showJoinError(ERRORS['choose-level']); $('j-level').focus(); return; }
      if (!$('j-consent').checked) { showJoinError(ERRORS['consent-required']); return; }
      var button = $('j-submit');
      button.disabled = true;
      button.textContent = 'Sending…';
      var body = { action: 'subscribe', email: email, name: $('j-name').value.trim(), level: $('j-level').value,
        subjects: chipValues('j-subjects'), frequency: chipValues('j-frequency')[0] || 'daily', consent: true,
        pageVersion: PAGE_VERSION, source: 'question-page', website: $('j-website').value };
      api(body).then(function (r) {
        button.disabled = false;
        button.textContent = 'Send me the questions';
        if (r.status === 200 && r.body.ok) {
          store('qotd-level', body.level);
          $('join-done-email').textContent = email;
          $('join-form-wrap').classList.add('hidden');
          $('join-done').classList.remove('hidden');
          $('join').scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else showJoinError(errorText(r.body, r.status === 0 ? 'No connection. Please check your internet and try again.' : null));
      });
    });
    $('join-again').addEventListener('click', function () {
      $('join-done').classList.add('hidden');
      $('join-form-wrap').classList.remove('hidden');
      $('j-email').value = '';
      $('j-email').focus();
    });
  }

  /* ───────────── Emailed links: confirm, unsubscribe, manage ───────────── */
  function banner(kind, icon, title, text, actions) {
    $('status').innerHTML = '<div class="banner ' + kind + '" role="status"><div class="ico" aria-hidden="true">' + icon + '</div><div><h2>' + esc(title) + '</h2><p>' + text + '</p>'
      + (actions ? '<div class="acts">' + actions + '</div>' : '') + '</div></div>';
  }
  function badLink() {
    banner('bad', '⚠️', 'This link is not valid any more', 'It may have been copied only in part. You can sign up again below, or WhatsApp us at <a href="https://wa.me/6596450588">+65 9645 0588</a>.',
      '<a class="btn small" href="#join">Sign up again</a>');
  }
  function manageHtml(sub) {
    var subjects = sub.subjects || [];
    var chip = function (value, label, on, role) {
      return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-value="' + value + '"' + (role === 'radio' ? ' role="radio" aria-checked="' + on + '"' : ' aria-pressed="' + on + '"') + '>' + label + '</button>';
    };
    var levels = LEVELS.indexOf(sub.level) >= 0 ? LEVELS.slice() : [sub.level].concat(LEVELS);
    return '<div class="card" id="manage" style="margin-top:-6px"><h2>Your Question of the Day settings</h2><p class="lead">For ' + esc(sub.email) + '</p>'
      + '<div class="grid-2"><div class="field"><span class="label">Subjects</span><div class="chips" id="m-subjects">'
      + chip('math', '🔢 Maths', subjects.indexOf('math') >= 0) + chip('science', '🔬 Science', subjects.indexOf('science') >= 0) + '</div></div>'
      + '<div class="field"><span class="label">How often</span><div class="chips" id="m-frequency">'
      + chip('daily', 'Every morning', sub.frequency !== 'weekly', 'radio') + chip('weekly', 'Saturdays only', sub.frequency === 'weekly', 'radio') + '</div></div></div>'
      + '<div class="grid-2"><div class="field"><label for="m-name">Your name</label><input id="m-name" maxlength="80" value="' + esc(sub.name) + '"></div>'
      + '<div class="field"><label for="m-level">Your child\'s level</label><select id="m-level">' + levels.map(function (l) {
        return '<option value="' + l + '"' + (l === sub.level ? ' selected' : '') + (LEVELS.indexOf(l) < 0 ? ' disabled' : '') + '>' + (l || 'Choose a level') + '</option>';
      }).join('') + '</select>' + (LEVELS.indexOf(sub.level) < 0 ? '<span class="hint" style="color:var(--warn)">Please choose a level from P3 to P6: we only send questions at or below your child\'s level, so none are sent until it is set.</span>' : '')
      + '</div></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" id="m-save">Save</button>'
      + (sub.status === 'unsubscribed' ? '<button class="btn ghost" type="button" id="m-resub">Resubscribe</button>' : '<button class="btn danger" type="button" id="m-unsub">Unsubscribe</button>')
      + '</div></div>';
  }
  function showManage(sub) {
    var host = document.createElement('div');
    host.innerHTML = manageHtml(sub);
    var old = $('manage');
    if (old) old.remove();
    $('status').appendChild(host.firstChild);
    wireChips($('m-subjects'), true);
    wireChips($('m-frequency'), false);
    $('m-save').onclick = function () {
      var btn = this;
      btn.disabled = true;
      var patch = { action: 'update', key: state.key, subjects: chipValues('m-subjects'), frequency: chipValues('m-frequency')[0] || 'daily', name: $('m-name').value.trim() };
      if (LEVELS.indexOf($('m-level').value) >= 0) patch.level = $('m-level').value;
      api(patch).then(function (r) {
        btn.disabled = false;
        if (r.status === 200 && r.body.ok) toast('Saved. ' + (r.body.subscriber.frequency === 'weekly' ? 'See you on Saturday!' : 'See you tomorrow morning!'));
        else toast(errorText(r.body), true);
      });
    };
    var unsub = $('m-unsub');
    if (unsub) unsub.onclick = function () { doUnsubscribe(); };
    var resub = $('m-resub');
    if (resub) resub.onclick = function () { doResubscribe(); };
  }
  function doUnsubscribe() {
    banner('info', '⏳', 'Unsubscribing…', 'One moment.');
    api({ action: 'unsubscribe', key: state.key }).then(function (r) {
      if (r.status !== 200 || !r.body.ok) { if (r.status === 404 || r.status === 400) badLink(); else banner('bad', '⚠️', 'We could not unsubscribe you just now', esc(errorText(r.body)) + ' Please try the link again.'); return; }
      banner('ok', '👋', 'You are unsubscribed', 'You will not get any more Question of the Day emails at ' + esc(r.body.subscriber.email) + '. Today\'s question is still here whenever you want it.',
        '<button class="btn small" type="button" id="b-resub">Changed your mind? Resubscribe</button><button class="btn small ghost" type="button" id="b-weekly">Switch to Saturdays only instead</button>');
      $('b-resub').onclick = doResubscribe;
      $('b-weekly').onclick = function () {
        api({ action: 'resubscribe', key: state.key }).then(function () {
          return api({ action: 'update', key: state.key, frequency: 'weekly' });
        }).then(function (u) {
          if (u.status === 200 && u.body.ok && u.body.subscriber.status === 'active') banner('ok', '📅', 'Saturdays only it is', 'You will get one email each Saturday with the week\'s questions and answers.');
          else toast(errorText(u.body), true);
        });
      };
    });
  }
  function doResubscribe() {
    api({ action: 'resubscribe', key: state.key }).then(function (r) {
      if (r.status === 200 && r.body.ok && r.body.subscriber.status === 'active') {
        banner('ok', '🎉', 'Welcome back!', 'You are subscribed again. ' + (r.body.subscriber.frequency === 'weekly' ? 'Your next round-up arrives on Saturday.' : 'Your next question arrives tomorrow morning.'));
      } else if (r.status === 200) {
        banner('info', '✉️', 'Please sign up again', 'Your earlier sign-up was never confirmed, so please sign up again below.', '<a class="btn small" href="#join">Sign up</a>');
      } else badLink();
    });
  }
  function handleLink() {
    var kinds = [['c', 'confirm'], ['u', 'unsubscribe'], ['m', 'manage']];
    var found = null;
    kinds.forEach(function (k) { if (!found && params.get(k[0])) found = { kind: k[1], key: params.get(k[0]) }; });
    if (!found) return;
    state.key = found.key.trim();
    // Keep the private link out of the address bar, history and anything shared from here.
    var keep = new URLSearchParams(location.search);
    ['c', 'u', 'm'].forEach(function (k) { keep.delete(k); });
    history.replaceState(null, '', location.pathname + (keep.toString() ? '?' + keep.toString() : '') + location.hash);
    if (found.kind === 'confirm') {
      banner('info', '⏳', 'Confirming your email…', 'One moment.');
      api({ action: 'confirm', key: state.key }).then(function (r) {
        if (r.status !== 200 || !r.body.ok) { if (r.status === 404 || r.status === 400) badLink(); else banner('bad', '⚠️', 'We could not confirm just now', esc(errorText(r.body)) + ' Please click the link in the email again.'); return; }
        var sub = r.body.subscriber;
        banner('ok', '🎉', r.body.already ? 'You are already confirmed' : 'You are in! Welcome to the Question of the Day',
          (r.body.already ? 'Nothing more to do. ' : 'We have just emailed you today\'s question to start you off. ')
          + (sub.frequency === 'weekly' ? 'Your round-up arrives every Saturday morning.' : 'A new question arrives every morning, with the worked answer the next day.')
          + ' Subjects: ' + esc(sub.subjects.map(function (s) { return SUBJECT_LABEL[s]; }).join(' and ')) + '.',
          '<button class="btn small ghost" type="button" id="b-manage">Change settings</button><a class="btn small" href="#today">Try today\'s question</a>');
        $('b-manage').onclick = function () { showManage(sub); };
        $('join').classList.add('hidden');
      });
    } else if (found.kind === 'unsubscribe') {
      doUnsubscribe();
    } else {
      banner('info', '⏳', 'Opening your settings…', 'One moment.');
      api({ action: 'manage', key: state.key }).then(function (r) {
        if (r.status !== 200 || !r.body.ok) { badLink(); return; }
        var sub = r.body.subscriber;
        if (sub.status === 'pending') banner('info', '✉️', 'Please confirm your email first', 'Click "Yes, send me the questions" in the email we sent you. You can change your settings here meanwhile.');
        else if (sub.status === 'unsubscribed') banner('info', '👋', 'You are unsubscribed', 'You can resubscribe below.');
        else $('status').innerHTML = '';
        showManage(sub);
        $('join').classList.add('hidden');
      });
    }
  }

  /* ═════════════ Admin (#admin) ═════════════ */
  var auth = null;
  function firebaseReady() {
    if (auth) return true;
    if (!window.firebase || !firebase.initializeApp) return false;
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    auth.onAuthStateChanged(onAuth);
    return true;
  }
  function isAdminUser(user) { return !!(user && user.emailVerified !== false && ADMINS.indexOf(String(user.email || '').toLowerCase()) >= 0); }
  function adminSignIn() {
    if (!firebaseReady()) { toast('Sign-in is still loading. Please try again in a moment.', true); return; }
    auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).then(function (res) {
      if (!isAdminUser(res.user)) {
        var who = res.user ? res.user.email : 'This account';
        auth.signOut();
        toast(who + ' is not an admin account.', true);
      }
    }).catch(function (e) {
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
      if (e && e.code === 'auth/popup-blocked') { auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); return; }
      toast('Sign-in failed: ' + (e.message || e), true);
    });
  }
  function onAuth(user) {
    var admin = isAdminUser(user);
    $('admin-section').classList.toggle('hidden', !admin);
    $('admin-login-link').classList.toggle('hidden', admin);
    $('page-version').textContent = 'Question page ' + PAGE_VERSION;
    $('page-version').classList.toggle('hidden', !admin);
    $('admin-who').textContent = admin ? 'Admin: ' + user.email : '';
    if (admin) loadAdmin();
  }
  function adminCall(body) {
    return auth.currentUser.getIdToken().then(function (token) { return api(body, token); });
  }
  function loadAdmin() {
    $('admin-body').innerHTML = '<div class="state"><span class="spin"></span>Loading subscribers…</div>';
    adminCall({ action: 'admin' }).then(function (r) {
      if (r.status !== 200 || !r.body.ok) { $('admin-body').innerHTML = '<div class="state">' + esc(errorText(r.body, 'Could not load the subscribers.')) + '</div>'; return; }
      state.admin = r.body;
      renderAdmin();
    });
  }
  function filteredSubscribers() {
    var a = state.admin, q = state.adminSearch.toLowerCase();
    var list = a.subscribers.filter(function (s) {
      if (state.adminFilter !== 'all' && s.status !== state.adminFilter) return false;
      if (!q) return true;
      return (s.email + ' ' + s.name + ' ' + s.level).toLowerCase().indexOf(q) >= 0;
    });
    var by = state.adminSort;
    list.sort(function (x, y) {
      if (by === 'email') return x.email.localeCompare(y.email);
      if (by === 'level') return String(x.level).localeCompare(String(y.level)) || x.email.localeCompare(y.email);
      if (by === 'sent') return y.sentCount - x.sentCount;
      return (y.confirmedAt || y.createdAt) - (x.confirmedAt || x.createdAt);
    });
    return list;
  }
  function csvOf(list) {
    var cell = function (value) {
      var s = String(value === undefined || value === null ? '' : value);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var rows = [['Email', 'Name', 'Child level', 'Subjects', 'How often', 'Status', 'Signed up', 'Confirmed', 'Unsubscribed', 'Emails sent', 'Signed up on']];
    list.forEach(function (s) {
      rows.push([s.email, s.name, s.level, s.subjects.map(function (x) { return SUBJECT_LABEL[x] || x; }).join(' + '), s.frequency === 'weekly' ? 'Weekly' : 'Daily',
        s.status, fmtTime(s.createdAt), fmtTime(s.confirmedAt), fmtTime(s.unsubscribedAt), s.sentCount, s.source === 'home-page' ? 'Home page' : 'Question page']);
    });
    return rows.map(function (r) { return r.map(cell).join(','); }).join('\n') + '\n';
  }
  /* The admin preview: what each level sees on each of the next 7 days. */
  var SOURCE_LABEL = { anskey: 'Ans Key worksheet', cer: 'CER Science bank', bank: 'Built-in question bank' };
  function adminSlotHtml(q, subject, dayIndex) {
    if (!q) {
      return '<div class="pv-q"><b>' + SUBJECT_ICON[subject] + ' ' + SUBJECT_LABEL[subject] + '</b><p class="none-here" style="padding:10px;margin:6px 0 0">No question at or below '
        + esc(state.adminLevel) + '. Children at this level get no ' + SUBJECT_LABEL[subject] + ' question that day.</p></div>';
    }
    var html = '<div class="pv-q" data-slot="' + esc(q.id) + '">';
    html += '<b>' + SUBJECT_ICON[subject] + ' ' + esc(q.level + ' ' + q.subjectLabel) + '</b> · ' + esc(q.topic || '');
    if (q.level !== state.adminLevel) html += ' <small class="warn-text">(no ' + esc(state.adminLevel) + ' question, so the ' + esc(q.level) + ' one)</small>';
    html += '<div class="src">' + esc(SOURCE_LABEL[q.source] || q.source || '');
    if (q.from && q.from.label) html += ': ' + esc(q.from.label) + (q.from.page ? ', page ' + q.from.page : '') + (q.from.number ? ', Q' + esc(q.from.number) : '');
    if (q.check) html += ' · check score ' + q.check.score + '/5';
    html += '</div>';
    html += '<p style="margin:6px 0">' + mathText(q.q) + '</p>';
    if (q.kind === 'mcq') {
      html += '<ol type="A" style="margin:0 0 6px;padding-left:22px">' + q.options.map(function (o, i) {
        return '<li' + (i === q.answer ? ' class="ans"' : '') + '>' + mathText(o) + '</li>';
      }).join('') + '</ol>';
    } else {
      (q.images || []).forEach(function (img) {
        var cached = state.adminImages[img.id];
        html += cached ? '<img src="' + cached + '" alt="' + esc(img.alt || '') + '">'
          : '<button type="button" class="btn small ghost" data-img="' + esc(img.id) + '">Show picture</button> ';
      });
      html += '<p style="margin:6px 0"><span class="ans">Answer:</span> ' + mathText(q.answer || '') + '</p>';
      if (q.model && q.model !== q.answer) html += '<p style="margin:0 0 6px"><span class="ans">Model answer:</span> ' + mathText(q.model) + '</p>';
      if (q.steps && q.steps.length) html += '<details><summary>Worked steps</summary><ol>' + q.steps.map(function (st) { return '<li>' + mathText(st) + '</li>'; }).join('') + '</ol>'
        + (q.idea ? '<p><b>Key idea:</b> ' + mathText(q.idea) + '</p>' : '') + '</details>';
      if (q.check && q.check.solvedAnswer) html += '<div class="src">The independent check solved it as: ' + esc(q.check.solvedAnswer) + '</div>';
    }
    if (q.skippable) html += '<div style="margin-top:8px"><button type="button" class="btn small danger" data-skip="' + esc(q.id) + '">Skip this question</button></div>';
    else if (dayIndex === 0 && q.kind === 'open') html += '<div class="src" style="margin-top:6px">Already today\'s question.</div>';
    return html + '</div>';
  }
  function upcomingHtml(a) {
    var html = '<h3 style="margin:22px 0 4px;color:var(--deep)">The next 7 days</h3>'
      + '<p class="fineprint" style="text-align:left;margin:0 0 4px">What a child at each level sees. Questions come from Ans Key worksheets and the CER Science bank, and every one has passed the quality check. '
      + 'Skip any that look wrong: it is never shown and the next one moves up. When nothing is waiting, the built-in question bank fills the day.</p>';
    html += '<div class="lvl-tabs" role="tablist">' + (a.levels || LEVELS).map(function (l) {
      return '<button type="button" class="lvl' + (l === state.adminLevel ? ' on' : '') + '" data-admin-level="' + l + '" aria-pressed="' + (l === state.adminLevel) + '">' + l + '</button>';
    }).join('') + '</div>';
    html += a.upcoming.map(function (u, i) {
      var head = (u.today ? 'Today · ' : '') + fmtDayKey(u.day);
      return '<div class="pv-day"><h4>' + esc(head) + '</h4><div class="pv-grid">'
        + ['math', 'science'].map(function (s) {
          var level = state.adminLevel, q = null;
          var row = u.slots && u.slots[s] ? u.slots[s] : {};
          // The slot a child at this level gets: their level, else the nearest below.
          for (var k = LEVELS.indexOf(level); k >= 0 && !q; k--) q = row[LEVELS[k]] || null;
          return adminSlotHtml(q, s, i);
        }).join('') + '</div></div>';
    }).join('');
    return html;
  }
  function poolHtml(a) {
    var p = a.pool || {}, waiting = p.waiting || {};
    var html = '<h3 style="margin:22px 0 8px;color:var(--deep)">Questions waiting</h3><div class="pool-row">';
    ['math', 'science'].forEach(function (s) {
      LEVELS.forEach(function (l) {
        var n = waiting[s] && waiting[s][l] ? waiting[s][l] : 0;
        html += '<span class="' + (n < 3 ? 'low' : '') + '">' + SUBJECT_ICON[s] + ' ' + l + ': ' + n + '</span>';
      });
    });
    html += '</div><p class="fineprint" style="text-align:left;margin:6px 0 0">The prepare run tops these up every evening. An amber count means fewer than 3 days are ready, and the built-in bank covers any gap.</p>';
    if (p.skipped && p.skipped.length) {
      html += '<h3 style="margin:22px 0 8px;color:var(--deep)">Skipped questions</h3><div class="upcoming">' + p.skipped.map(function (x) {
        return '<div class="row">' + SUBJECT_ICON[x.subject] + ' <b>' + esc(x.level + ' ' + (x.topic || '')) + '</b> — ' + esc(x.q) + (x.q.length >= 160 ? '…' : '')
          + ' <button type="button" class="btn small ghost" data-restore="' + esc(x.id) + '">Restore</button></div>';
      }).join('') + '</div>';
    }
    if (p.runs && p.runs.length) {
      html += '<h3 style="margin:22px 0 8px;color:var(--deep)">Recent prepare runs</h3><table class="runs"><tr><th>When</th><th>Read</th><th>Made</th><th>Passed</th><th>Rejected</th><th>Why rejected</th></tr>'
        + p.runs.map(function (r) {
          var why = Object.keys(r.reasons || {}).sort(function (x, y) { return r.reasons[y] - r.reasons[x]; }).slice(0, 4).map(function (k) { return esc(k) + ' ' + r.reasons[k]; }).join(', ');
          return '<tr><td>' + esc(fmtTime(r.startedAt)) + (r.dryRun ? ' <small>(trial)</small>' : '') + '</td><td>' + r.read + '</td><td>' + r.made + '</td><td>' + r.passed + '</td><td>' + r.rejected + '</td><td>'
            + (r.error ? '<span class="warn-text">' + esc(r.error) + '</span>' : why || '—') + '</td></tr>';
        }).join('') + '</table>';
    }
    return html;
  }
  function fmtDayKey(day) {
    var d = new Date(day + 'T00:00:00+08:00');
    try { return d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Singapore' }); } catch (e) { return day; }
  }
  function renderAdmin() {
    var a = state.admin, st = a.stats, set = a.settings;
    var dailyLoad = st.daily + (new Date().getDay() === 6 ? st.weekly : 0);
    var pct = set.dailyCap ? Math.min(100, Math.round(dailyLoad / set.dailyCap * 100)) : 100;
    var tiles = [['Active', st.active], ['Every morning', st.daily], ['Saturdays', st.weekly], ['Maths', st.math], ['Science', st.science], ['New this week', st.newThisWeek],
      ['Waiting to confirm', st.pending], ['Unsubscribed', st.unsubscribed], ['Needs a level', st.needLevel || 0]];
    var html = '<div class="admin-stats">' + tiles.map(function (t) { return '<div class="stat"><b>' + t[1] + '</b><span>' + t[0] + '</span></div>'; }).join('') + '</div>';
    html += '<div class="gauge"><div class="bar"><div class="fill' + (pct >= 80 ? ' warn' : '') + '" style="width:' + pct + '%"></div></div>'
      + '<p><b>' + dailyLoad + '</b> question email' + (dailyLoad === 1 ? '' : 's') + ' a morning out of a cap of <b>' + set.dailyCap + '</b>. '
      + 'Every Polymath email goes out through one Gmail account, which may send about ' + a.gmailLimits.gmail + ' emails a day (about ' + a.gmailLimits.workspace
      + ' on Google Workspace), shared with invoices, receipts and reports. The cap keeps room for those.'
      + (pct >= 80 ? ' <b style="color:#dc2626">The list is close to the cap.</b>' : '') + '</p></div>';
    html += '<div class="settings-row"><b>Emails:</b> '
      + (set.mode === 'paused' ? '<span class="badge pending">Paused</span> <button class="btn small" type="button" id="a-resume">Resume emails</button>'
        : '<span class="badge active">On</span> <button class="btn small ghost" type="button" id="a-pause">Pause all emails</button>')
      + '<span style="margin-left:auto">Daily cap <input type="number" id="a-cap" min="0" max="' + set.maxCap + '" step="10" value="' + set.dailyCap + '"> '
      + '<button class="btn small ghost" type="button" id="a-cap-save">Save</button></span></div>';
    html += '<div class="settings-row"><b>Send me a test:</b> <button class="btn small ghost" type="button" data-test="daily">Morning email</button>'
      + '<button class="btn small ghost" type="button" data-test="weekly">Saturday email</button><button class="btn small ghost" type="button" data-test="confirm">Confirmation email</button>'
      + '<span class="fineprint" style="margin:0">At ' + esc(state.adminLevel) + ' (the level tab below), sent to ' + esc(auth.currentUser.email) + '.</span></div>';
    html += '<div class="admin-tools"><input type="search" id="a-search" placeholder="Search name, email or level" value="' + esc(state.adminSearch) + '">'
      + '<select id="a-filter">' + [['active', 'Active'], ['pending', 'Waiting to confirm'], ['unsubscribed', 'Unsubscribed'], ['all', 'Everyone']].map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === state.adminFilter ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>'
      + '<select id="a-sort">' + [['date', 'Newest first'], ['email', 'Email A–Z'], ['level', 'Child level'], ['sent', 'Most emails']].map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === state.adminSort ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>'
      + '<button class="btn small ghost" type="button" id="a-csv">Download CSV</button></div>';
    var list = filteredSubscribers();
    if (!list.length) html += '<div class="state">' + (a.subscribers.length ? 'Nobody matches.' : 'No subscribers yet. Share polymathlc.com.sg/question with parents!') + '</div>';
    else {
      html += '<div class="table-wrap"><table class="sub-table"><thead><tr><th>Parent</th><th>Child</th><th>Gets</th><th>Status</th><th class="opt-col">Joined</th><th class="opt-col">Sent</th><th></th></tr></thead><tbody>'
        + list.map(function (s) {
          return '<tr><td><b>' + esc(s.name || '—') + '</b><br><a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a></td>'
            + '<td>' + esc(s.level || '—') + (s.status === 'active' && !s.questionLevel ? '<br><small class="warn-text">No questions until a level P3–P6 is set</small>' : s.questionLevel && s.questionLevel !== s.level ? '<br><small>Gets ' + esc(s.questionLevel) + ' questions</small>' : '') + '</td>'
            + '<td>' + s.subjects.map(function (x) { return SUBJECT_ICON[x] + ' ' + SUBJECT_LABEL[x]; }).join('<br>') + '<br><small>' + (s.frequency === 'weekly' ? 'Saturdays' : 'Every morning') + '</small></td>'
            + '<td><span class="badge ' + s.status + '">' + (s.status === 'pending' ? 'Waiting' : s.status === 'active' ? 'Active' : 'Unsubscribed') + '</span>'
            + (s.source === 'home-page' ? '<br><small>Home page</small>' : '') + '</td>'
            + '<td class="opt-col">' + esc(fmtDate(s.confirmedAt || s.createdAt)) + '</td>'
            + '<td class="opt-col">' + s.sentCount + '</td>'
            + '<td style="white-space:nowrap">' + (s.status === 'pending' ? '<button class="btn small ghost" type="button" data-resend="' + s.id + '">Resend</button> ' : '')
            + '<button class="btn small danger" type="button" data-delete="' + s.id + '" data-email="' + esc(s.email) + '">Delete</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += upcomingHtml(a);
    html += poolHtml(a);
    if (a.runs.length) {
      html += '<h3 style="margin:22px 0 8px;color:var(--deep)">Recent mornings</h3><table class="runs"><tr><th>Day</th><th>Sent</th><th>Daily</th><th>Weekly</th><th>Over cap</th><th>No level</th><th>Failed</th></tr>'
        + a.runs.map(function (r) {
          return '<tr><td>' + esc(r.day) + '</td><td>' + (r.paused ? 'Paused' : r.sent) + '</td><td>' + r.daily + '</td><td>' + r.weekly + '</td><td>' + r.heldBack + '</td><td>' + (r.noLevel || 0) + '</td><td>' + r.failed + '</td></tr>';
        }).join('') + '</table>';
    }
    var levels = Object.keys(st.levels || {});
    if (levels.length) html += '<p class="fineprint" style="text-align:left;margin-top:14px">Active by child level: ' + levels.sort().map(function (l) { return esc(l) + ' ' + st.levels[l]; }).join(' · ') + '</p>';
    html += '<p class="fineprint" style="text-align:left">Consent each parent ticked: "' + esc(a.consentText) + '"</p>';
    $('admin-body').innerHTML = html;
    wireAdmin();
  }
  function wireAdmin() {
    var saveSettings = function (patch, done) {
      adminCall(Object.assign({ action: 'adminSettings' }, patch)).then(function (r) {
        if (r.status === 200 && r.body.ok) { state.admin.settings.mode = r.body.settings.mode; state.admin.settings.dailyCap = r.body.settings.dailyCap; renderAdmin(); toast(done); }
        else toast(errorText(r.body), true);
      });
    };
    if ($('a-pause')) $('a-pause').onclick = function () { saveSettings({ mode: 'paused' }, 'Paused. No question emails will go out until you resume.'); };
    if ($('a-resume')) $('a-resume').onclick = function () { saveSettings({ mode: 'on' }, 'Resumed. The next emails go out tomorrow morning.'); };
    $('a-cap-save').onclick = function () { saveSettings({ dailyCap: Math.round(Number($('a-cap').value)) }, 'Daily cap saved.'); };
    $('a-search').oninput = function () { state.adminSearch = this.value; var pos = this.selectionStart; renderAdmin(); var el = $('a-search'); el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { /* not a text field */ } };
    $('a-filter').onchange = function () { state.adminFilter = this.value; renderAdmin(); };
    $('a-sort').onchange = function () { state.adminSort = this.value; renderAdmin(); };
    $('a-csv').onclick = function () {
      var blob = new Blob(['﻿' + csvOf(filteredSubscribers())], { type: 'text/csv;charset=utf-8' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'question-of-the-day-subscribers-' + state.admin.today + '.csv';
      document.body.appendChild(link);
      link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 500);
    };
    $('admin-body').querySelectorAll('[data-test]').forEach(function (b) {
      b.onclick = function () {
        b.disabled = true;
        adminCall({ action: 'adminTest', kind: b.getAttribute('data-test'), level: state.adminLevel }).then(function (r) {
          b.disabled = false;
          if (r.status === 200 && r.body.ok) toast('Test sent to ' + r.body.sentTo + '. It can take a minute to arrive.');
          else toast(errorText(r.body), true);
        });
      };
    });
    $('admin-body').querySelectorAll('[data-resend]').forEach(function (b) {
      b.onclick = function () {
        adminCall({ action: 'adminResend', id: b.getAttribute('data-resend') }).then(function (r) {
          if (r.status === 200 && r.body.ok) toast('Confirmation email sent again.'); else toast(errorText(r.body), true);
        });
      };
    });
    $('admin-body').querySelectorAll('[data-delete]').forEach(function (b) {
      b.onclick = function () {
        if (b.getAttribute('data-sure') !== 'yes') { b.setAttribute('data-sure', 'yes'); b.textContent = 'Tap again to delete'; return; }
        adminCall({ action: 'adminDelete', id: b.getAttribute('data-delete') }).then(function (r) {
          if (r.status === 200 && r.body.ok) { toast('Deleted ' + b.getAttribute('data-email') + '.'); loadAdmin(); } else toast(errorText(r.body), true);
        });
      };
    });
    $('admin-body').querySelectorAll('[data-admin-level]').forEach(function (b) {
      b.onclick = function () { state.adminLevel = b.getAttribute('data-admin-level'); renderAdmin(); };
    });
    $('admin-body').querySelectorAll('[data-img]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-img');
        b.disabled = true; b.innerHTML = '<span class="spin"></span>Loading…';
        adminCall({ action: 'adminImage', id: id }).then(function (r) {
          if (r.status === 200 && r.body.ok && r.body.dataUrl) { state.adminImages[id] = r.body.dataUrl; renderAdmin(); }
          else { b.disabled = false; b.textContent = 'Show picture'; toast(errorText(r.body, 'Could not load the picture.'), true); }
        });
      };
    });
    $('admin-body').querySelectorAll('[data-skip]').forEach(function (b) {
      b.onclick = function () {
        if (b.getAttribute('data-sure') !== 'yes') { b.setAttribute('data-sure', 'yes'); b.textContent = 'Tap again to skip it'; return; }
        b.disabled = true;
        adminCall({ action: 'adminSkip', id: b.getAttribute('data-skip') }).then(function (r) {
          if (r.status === 200 && r.body.ok) { toast('Skipped. It will never be shown, and the next question moves up.'); loadAdmin(); } else { b.disabled = false; toast(errorText(r.body), true); }
        });
      };
    });
    $('admin-body').querySelectorAll('[data-restore]').forEach(function (b) {
      b.onclick = function () {
        b.disabled = true;
        adminCall({ action: 'adminRestore', id: b.getAttribute('data-restore') }).then(function (r) {
          if (r.status === 200 && r.body.ok) { toast('Restored. It joins the end of its queue.'); loadAdmin(); } else { b.disabled = false; toast(errorText(r.body), true); }
        });
      };
    });
  }
  function maybeAdminFromHash() {
    if (location.hash !== '#admin') return;
    if (!firebaseReady()) { setTimeout(maybeAdminFromHash, 300); return; }
    var off = auth.onAuthStateChanged(function (user) { off(); if (!isAdminUser(user)) adminSignIn(); });
  }

  /* ───────────── Start ───────────── */
  function start() {
    wireJoin();
    handleLink();
    loadQuestions();
    $('admin-login-link').onclick = adminSignIn;
    $('admin-refresh').onclick = loadAdmin;
    $('admin-out').onclick = function () { if (auth) auth.signOut(); };
    window.addEventListener('hashchange', maybeAdminFromHash);
    maybeAdminFromHash();
    // Firebase loads after this script on a slow phone; a returning admin is recognised once it does.
    if (!firebaseReady()) {
      var tries = 0;
      var wait = setInterval(function () { if (firebaseReady() || ++tries > 40) clearInterval(wait); }, 250);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
