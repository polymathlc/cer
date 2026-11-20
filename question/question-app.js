/* Free Question of the Day — polymathlc.com.sg/question
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
  var PAGE_VERSION = 'v1.0.0';
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
    'invalid-cap': 'The cap must be a whole number from 0 to 1800.'
  };

  var params = new URLSearchParams(location.search);
  var state = {
    data: null, todaySubject: location.hash === '#science' ? 'science' : 'math', ySubject: 'math',
    key: '', admin: null, adminFilter: 'active', adminSearch: '', adminSort: 'date'
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
  // mode: 'today' (pick, answer tomorrow) · 'try' (pick, then see the answer) · 'answer' (shown)
  function questionHtml(q, mode) {
    if (!q) return '<div class="state">This question is not available.</div>';
    var pick = getPick(q);
    var revealed = mode === 'answer' || (mode === 'try' && pick !== null && typeof q.answer === 'number');
    var html = '<div class="q ' + q.subject + '" data-qid="' + esc(q.id) + '">';
    html += '<div class="q-tags"><span class="tag ' + q.subject + '">' + esc(q.level + ' ' + q.subjectLabel) + '</span><span class="q-topic">' + esc(q.topic) + '</span></div>';
    html += '<p class="q-text">' + esc(q.q) + '</p><div class="opts" role="group" aria-label="Answer options">';
    q.options.forEach(function (option, index) {
      var cls = 'opt';
      if (revealed) {
        if (index === q.answer) cls += ' right';
        else if (index === pick) cls += ' wrong';
      } else if (index === pick) cls += ' picked';
      var locked = revealed || (mode === 'today' && pick !== null);
      html += '<button type="button" class="' + cls + '"' + (locked ? ' disabled' : '') + ' data-day="' + esc(q.day) + '" data-subject="' + q.subject
        + '" data-index="' + index + '" data-mode="' + mode + '" aria-pressed="' + (index === pick) + '"><span class="letter">' + LETTERS[index] + '</span><span>'
        + esc(option) + '</span></button>';
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
      html += '<div class="working"><h4>Worked answer</h4><ol>' + q.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'
        + '<div class="idea"><b>Key idea:</b> ' + esc(q.idea) + '</div></div>';
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

  function loadQuestions() {
    var day = params.get('d');
    var early = window.__qotdEarly && (!day || /^\d{4}-\d{2}-\d{2}$/.test(day)) ? window.__qotdEarly : null;
    var request = early ? early.then(function (r) { return r || api(day ? { action: 'today', day: day } : { action: 'today' }); })
      : api(day ? { action: 'today', day: day } : { action: 'today' });
    return request.then(function (r) {
      if (r.status === 404 && day) {
        // A day in the future or before the start: show today instead.
        history.replaceState(null, '', location.pathname + location.hash);
        params.delete('d');
        return api({ action: 'today' });
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
    $('j-level').value = store('qotd-level') || '';
    $('join-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var email = $('j-email').value.trim();
      showJoinError('');
      if (!EMAIL_PATTERN.test(email)) { showJoinError(ERRORS['invalid-email']); $('j-email').focus(); return; }
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
    var levels = ['', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'Secondary', 'Other'];
    return '<div class="card" id="manage" style="margin-top:-6px"><h2>Your Question of the Day settings</h2><p class="lead">For ' + esc(sub.email) + '</p>'
      + '<div class="grid-2"><div class="field"><span class="label">Subjects</span><div class="chips" id="m-subjects">'
      + chip('math', '🔢 Maths', subjects.indexOf('math') >= 0) + chip('science', '🔬 Science', subjects.indexOf('science') >= 0) + '</div></div>'
      + '<div class="field"><span class="label">How often</span><div class="chips" id="m-frequency">'
      + chip('daily', 'Every morning', sub.frequency !== 'weekly', 'radio') + chip('weekly', 'Saturdays only', sub.frequency === 'weekly', 'radio') + '</div></div></div>'
      + '<div class="grid-2"><div class="field"><label for="m-name">Your name</label><input id="m-name" maxlength="80" value="' + esc(sub.name) + '"></div>'
      + '<div class="field"><label for="m-level">Your child\'s level</label><select id="m-level">' + levels.map(function (l) {
        return '<option value="' + l + '"' + (l === sub.level ? ' selected' : '') + '>' + (l || 'Not given') + '</option>';
      }).join('') + '</select></div></div>'
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
      api({ action: 'update', key: state.key, subjects: chipValues('m-subjects'), frequency: chipValues('m-frequency')[0] || 'daily',
        level: $('m-level').value, name: $('m-name').value.trim() }).then(function (r) {
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
  function renderAdmin() {
    var a = state.admin, st = a.stats, set = a.settings;
    var dailyLoad = st.daily + (new Date().getDay() === 6 ? st.weekly : 0);
    var pct = set.dailyCap ? Math.min(100, Math.round(dailyLoad / set.dailyCap * 100)) : 100;
    var tiles = [['Active', st.active], ['Every morning', st.daily], ['Saturdays', st.weekly], ['Maths', st.math], ['Science', st.science], ['New this week', st.newThisWeek],
      ['Waiting to confirm', st.pending], ['Unsubscribed', st.unsubscribed]];
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
      + '<span class="fineprint" style="margin:0">Sent to ' + esc(auth.currentUser.email) + '.</span></div>';
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
            + '<td>' + esc(s.level || '—') + '</td>'
            + '<td>' + s.subjects.map(function (x) { return SUBJECT_ICON[x] + ' ' + SUBJECT_LABEL[x]; }).join('<br>') + '<br><small>' + (s.frequency === 'weekly' ? 'Saturdays' : 'Every morning') + '</small></td>'
            + '<td><span class="badge ' + s.status + '">' + (s.status === 'pending' ? 'Waiting' : s.status === 'active' ? 'Active' : 'Unsubscribed') + '</span>'
            + (s.source === 'home-page' ? '<br><small>Home page</small>' : '') + '</td>'
            + '<td class="opt-col">' + esc(fmtDate(s.confirmedAt || s.createdAt)) + '</td>'
            + '<td class="opt-col">' + s.sentCount + '</td>'
            + '<td style="white-space:nowrap">' + (s.status === 'pending' ? '<button class="btn small ghost" type="button" data-resend="' + s.id + '">Resend</button> ' : '')
            + '<button class="btn small danger" type="button" data-delete="' + s.id + '" data-email="' + esc(s.email) + '">Delete</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '<h3 style="margin:22px 0 8px;color:var(--deep)">The next 7 days</h3><div class="upcoming">' + a.upcoming.map(function (u, i) {
      var m = u.questions.math, s = u.questions.science;
      return '<div class="row"><b>' + esc((i === 0 ? 'Today · ' : '') + m.dayShort) + '</b> — 🔢 ' + esc(m.level + ' ' + m.topic) + ' (answer ' + m.answerLetter + ')'
        + ' · 🔬 ' + esc(s.level + ' ' + s.topic) + ' (answer ' + s.answerLetter + ')</div>';
    }).join('') + '</div>';
    if (a.runs.length) {
      html += '<h3 style="margin:22px 0 8px;color:var(--deep)">Recent mornings</h3><table class="runs"><tr><th>Day</th><th>Sent</th><th>Daily</th><th>Weekly</th><th>Over cap</th><th>Failed</th></tr>'
        + a.runs.map(function (r) {
          return '<tr><td>' + esc(r.day) + '</td><td>' + (r.paused ? 'Paused' : r.sent) + '</td><td>' + r.daily + '</td><td>' + r.weekly + '</td><td>' + r.heldBack + '</td><td>' + r.failed + '</td></tr>';
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
        adminCall({ action: 'adminTest', kind: b.getAttribute('data-test') }).then(function (r) {
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
