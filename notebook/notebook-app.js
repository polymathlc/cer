/* ═══════════════════════════════════════════════════════════════════════════
   📒 MY MISTAKE NOTEBOOK — the page (notebook-app.js v1.0.0, 20 Nov 2026)

   polymathlc.com.sg/notebook. Every question a student got wrong in a
   worksheet (marked by Study Buddy) or in a live lesson (marked by the
   teacher in Ans Key's live class) is collected here automatically, and a
   short "redo your mistakes" quiz comes out of it every Monday.

   The page holds no data of its own: everything comes from the server
   (shop-function/functions/notebook.js, mistakeNotebook) with the student's
   own sign-in. The answer to a mistake that is still open is not sent until
   the student has had a go at it (or taps Show answer).

   Pure helpers are on NotebookApp.pure (tools/notebook-page-tests.mjs runs
   them under node). Everything a question or an answer says is put on the
   page escaped, never as markup.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var ENDPOINT = 'https://us-central1-mathgen--app.cloudfunctions.net/mistakeNotebook';
  var STUDENT_HOME = 'https://polymathlc.com.sg/student/';
  var STUDENT_USERNAME_DOMAIN = 'students.sciencequest.app';
  var RESET_SUFFIX_MAX = 9;
  var PREFS_KEY = 'polymath-notebook-v1';
  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo',
    authDomain: 'mathgen--app.firebaseapp.com',
    projectId: 'mathgen--app',
    storageBucket: 'mathgen--app.firebasestorage.app',
    messagingSenderId: '165654161198',
    appId: '1:165654161198:web:16c8bd60eb3a2aa7edbcbf'
  };
  var STATUS_WORDS = { open: 'To redo', fixed: 'Fixed', mastered: 'Mastered' };
  var STATUS_ICON = { open: '✏️', fixed: '✅', mastered: '🏆' };
  var VERDICT_WORDS = { wrong: 'Got it wrong', partial: 'Partly right', skipped: 'Left it blank' };
  var SOURCE_WORDS = { live: 'Live lesson', worksheet: 'Worksheet' };
  var KIND_WORDS = { mcq: 'Multiple choice', blank: 'Short answer', cloze: 'Fill in the keywords', open: 'Written answer' };
  var ERRORS = {
    'sign-in-required': 'Please sign in again.',
    'not-approved': 'Your account is waiting for the centre to approve it. Your notebook opens as soon as it is approved.',
    'access-paused': 'Your access is paused. Please contact the centre.',
    'child-not-found': 'That notebook could not be found.',
    'mistake-not-found': 'That question is no longer in the notebook. Refresh the page.',
    'image-not-found': 'The picture of this question could not be found.',
    'admins-only': 'Only the centre\'s admins can do that.',
    'temporarily-unavailable': 'The notebook could not be reached just now. Please try again in a minute.',
    'origin-not-allowed': 'Please open the notebook at polymathlc.com.sg/notebook.'
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ================================================================
     PURE HELPERS
     ================================================================ */
  function str(v) { return v == null ? '' : String(v); }
  function esc(v) {
    return str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Escaped, with the line breaks a question was written with.
  function escLines(v) { return esc(v).replace(/\n/g, '<br>'); }
  function letter(i) { return String.fromCharCode(65 + i); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function sgDate(ms) {
    ms = Number(ms) || 0;
    if (!ms) return '';
    var d = new Date(ms + 8 * 3600000);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }
  // "today", "yesterday", "3 days ago", or the date.
  function whenWords(ms, now) {
    ms = Number(ms) || 0;
    if (!ms) return '';
    var day = function (t) { return Math.floor((t + 8 * 3600000) / 86400000); };
    var diff = day(now) - day(ms);
    if (diff <= 0) return 'today';
    if (diff === 1) return 'yesterday';
    if (diff < 7) return diff + ' days ago';
    return sgDate(ms);
  }
  // Days left in this week's quiz (the quiz turns over on Monday, Singapore time).
  function daysLeft(endsAt, now) {
    var ms = (Number(endsAt) || 0) - (Number(now) || 0);
    if (ms <= 0) return 0;
    return Math.ceil(ms / 86400000);
  }
  function loginCandidates(raw) {
    var s = str(raw).trim();
    if (!s) return [];
    if (s.indexOf('@') >= 0) return [s];
    var u = s.toLowerCase(), out = [u + '@' + STUDENT_USERNAME_DOMAIN];
    for (var n = 2; n <= RESET_SUFFIX_MAX; n++) out.push(u + '.r' + n + '@' + STUDENT_USERNAME_DOMAIN);
    return out;
  }
  // The notebook's list, narrowed the way the chips say.
  function filterItems(items, f) {
    var filt = f || {};
    return (Array.isArray(items) ? items : []).filter(function (it) {
      if (filt.status === 'removed') return it.hidden;
      if (it.hidden) return false;
      if (filt.status && filt.status !== 'all' && it.status !== filt.status) return false;
      if (filt.src && filt.src !== 'all' && it.src !== filt.src) return false;
      if (filt.sub && filt.sub !== 'all' && it.sub !== filt.sub) return false;
      return true;
    });
  }
  function counts(items) {
    var c = { all: 0, open: 0, fixed: 0, mastered: 0, removed: 0, live: 0, worksheet: 0, math: 0, science: 0 };
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (it.hidden) { c.removed++; return; }
      c.all++;
      if (c[it.status] != null) c[it.status]++;
      if (c[it.src] != null) c[it.src]++;
      if (it.sub && c[it.sub] != null) c[it.sub]++;
    });
    return c;
  }
  // Where this week's quiz stands: the next question not yet done.
  function quizState(week, items) {
    var w = week || { ids: [], done: {} };
    var have = {};
    (items || []).forEach(function (it) { if (!it.hidden) have[it.id] = it; });
    var ids = (w.ids || []).filter(function (id) { return have[id]; });
    var done = ids.filter(function (id) { return w.done && (id in w.done); });
    var right = done.filter(function (id) { return w.done[id] === 1; });
    var next = ids.filter(function (id) { return !(w.done && (id in w.done)); });
    return { ids: ids, size: ids.length, done: done.length, right: right.length, next: next, finished: ids.length > 0 && next.length === 0 };
  }
  // A fill-in-the-keywords sentence: the text pieces, and an input per gap.
  function clozeHtml(parts, prefix, values, disabled) {
    return (parts || []).map(function (p) {
      if (typeof p !== 'number') return '<span>' + escLines(p) + '</span>';
      var v = values && values[p] != null ? values[p] : '';
      return '<input class="gap" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-gap="' + p + '" aria-label="Blank ' + (p + 1) + '" id="' + prefix + p + '" value="' + esc(v) + '"' + (disabled ? ' disabled' : '') + '>';
    }).join('');
  }
  // The right answer, as words a student can read.
  function answerWords(item, key) {
    var k = key || {};
    if (!item) return '';
    if (item.kind === 'mcq' && k.answerText) return k.answerText;
    if (item.kind === 'cloze' && k.full) return k.full;
    if (item.kind === 'blank' && k.accepted && k.accepted.length) return k.accepted[0];
    return k.model || '';
  }
  function friendlyError(code) { return ERRORS[code] || 'Something went wrong. Please try again.'; }
  function encouragement(stats) {
    var s = stats || {};
    if (!s.total) return '';
    if (s.weekSize && s.weekDone >= s.weekSize) return 'This week\'s quiz is done. Well done!';
    if (s.fixedThisWeek >= 3) return plural(s.fixedThisWeek, 'mistake') + ' fixed this week. Keep going!';
    if (s.mastered > 0) return plural(s.mastered, 'mistake') + ' mastered for good.';
    return 'Every mistake fixed here is one that will not happen again.';
  }

  var pure = {
    VERSION: VERSION, ENDPOINT: ENDPOINT, esc: esc, escLines: escLines, letter: letter, plural: plural, sgDate: sgDate, whenWords: whenWords,
    daysLeft: daysLeft, loginCandidates: loginCandidates, filterItems: filterItems, counts: counts, quizState: quizState,
    clozeHtml: clozeHtml, answerWords: answerWords, friendlyError: friendlyError, encouragement: encouragement,
    STATUS_WORDS: STATUS_WORDS, VERDICT_WORDS: VERDICT_WORDS, SOURCE_WORDS: SOURCE_WORDS
  };

  /* ================================================================
     THE PAGE
     ================================================================ */
  function start(doc, win) {
    var $ = function (id) { return doc.getElementById(id); };
    var app = $('app');
    var sheet = $('sheet');
    var fb = win.firebase;
    var auth = null;
    var S = {
      user: null, phase: 'starting', data: null, child: '', as: '', roster: null, error: '', notice: '',
      filter: { status: 'open', src: 'all', sub: 'all' }, loginMode: 'google', loginBusy: false, loginError: '',
      images: {}, revealed: {}, confirmHide: '', busy: false, quiz: null
    };
    (function loadPrefs() {
      try {
        var p = JSON.parse(win.localStorage.getItem(PREFS_KEY) || '{}');
        if (p && typeof p === 'object') {
          if (p.child) S.child = String(p.child);
          if (p.filter && typeof p.filter === 'object') ['status', 'src', 'sub'].forEach(function (k) { if (typeof p.filter[k] === 'string') S.filter[k] = p.filter[k]; });
          if (p.as) S.as = String(p.as);
        }
      } catch (e) { /* private window: the defaults */ }
    })();
    function savePrefs() {
      try { win.localStorage.setItem(PREFS_KEY, JSON.stringify({ child: S.child, filter: S.filter, as: S.as })); } catch (e) { /* ignore */ }
    }
    function now() { return Date.now(); }
    function itemById(id) {
      var list = S.data && S.data.notebook ? S.data.notebook.items : [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }
    function replaceItem(item) {
      if (!item || !S.data) return;
      var list = S.data.notebook.items;
      for (var i = 0; i < list.length; i++) if (list[i].id === item.id) { list[i] = item; return; }
    }

    /* ---------- the server ---------- */
    function api(action, body) {
      if (!S.user) return Promise.reject({ code: 'sign-in-required' });
      return S.user.getIdToken().then(function (token) {
        var payload = Object.assign({ action: action }, body || {});
        if (S.as && !payload.as && action === 'load') payload.as = S.as;
        if (action !== 'load' && action !== 'roster' && S.data && !payload.child) payload.child = S.data.child;
        if (S.as && action !== 'load' && action !== 'roster') payload.as = S.as;
        return win.fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(payload)
        });
      }).then(function (res) {
        return res.json().catch(function () { return { ok: false, error: 'temporarily-unavailable' }; }).then(function (json) {
          if (!res.ok || !json || json.ok === false) throw { code: (json && json.error) || 'temporarily-unavailable', status: res.status };
          return json;
        });
      }, function (e) {
        if (e && e.code) throw e;
        throw { code: 'temporarily-unavailable' };
      });
    }
    function load(quiet) {
      if (!quiet) { S.phase = 'loading'; render(); }
      var body = {};
      if (S.child && !S.as) body.child = S.child;
      return api('load', body).then(function (json) {
        S.data = json;
        S.child = json.child;
        S.phase = 'ready';
        S.error = '';
        savePrefs();
        render();
      }).catch(function (e) {
        // A remembered child that is no longer on the account: open the first.
        if (e && e.code === 'child-not-found' && (S.child || S.as)) { S.child = ''; S.as = ''; savePrefs(); return load(quiet); }
        S.phase = 'error';
        S.error = e && e.code ? e.code : 'temporarily-unavailable';
        render();
      });
    }
    function loadRoster() {
      api('roster').then(function (json) { S.roster = json.children || []; render(); }).catch(function () { S.roster = []; render(); });
    }

    /* ---------- signing in ---------- */
    function authError(error) {
      var code = error && error.code;
      var map = {
        'auth/user-not-found': 'No account with that username or email.',
        'auth/wrong-password': 'That password is not right. Please try again.',
        'auth/invalid-credential': 'That username or password is not right. Please try again.',
        'auth/invalid-login-credentials': 'That username or password is not right. Please try again.',
        'auth/invalid-email': 'Please type a username or a full email address.',
        'auth/too-many-requests': 'Too many tries. Please wait a few minutes and try again.',
        'auth/network-request-failed': 'No connection. Please check the internet and try again.',
        'auth/popup-closed-by-user': '',
        'auth/cancelled-popup-request': ''
      };
      return code in map ? map[code] : 'Sign-in did not work. Please try again.';
    }
    function signInGoogle() {
      S.loginBusy = true; S.loginError = ''; render();
      var provider = new fb.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      auth.signInWithPopup(provider).catch(function (error) {
        if (error && (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment')) return auth.signInWithRedirect(provider);
        S.loginError = authError(error);
      }).then(function () { S.loginBusy = false; render(); });
    }
    function signInPassword(form) {
      var id = form.querySelector('[name="loginId"]').value;
      var pass = form.querySelector('[name="loginPass"]').value;
      var candidates = loginCandidates(id);
      if (!candidates.length || !pass) { S.loginError = 'Please type your username (or email) and password.'; render(); return; }
      S.loginBusy = true; S.loginError = ''; render();
      var i = 0;
      (function next(firstError) {
        if (i >= candidates.length) { S.loginBusy = false; S.loginError = authError(firstError); render(); return; }
        auth.signInWithEmailAndPassword(candidates[i++], pass).then(function () { S.loginBusy = false; S.loginError = ''; })
          .catch(function (error) {
            var code = error && error.code;
            var keepTrying = code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials' || code === 'auth/wrong-password';
            if (!keepTrying) { S.loginBusy = false; S.loginError = authError(error); render(); return; }
            next(firstError || error);
          });
      })(null);
    }

    /* ---------- drawing ---------- */
    function render() {
      if (!app) return;
      if (S.phase === 'starting' || (S.phase === 'loading' && !S.data)) { app.innerHTML = loadingHtml(); return; }
      if (S.phase === 'signed-out') { app.innerHTML = signedOutHtml(); return; }
      if (S.phase === 'error' && !S.data) { app.innerHTML = errorHtml(); return; }
      app.innerHTML = notebookHtml();
      paintImages();
    }
    function loadingHtml() {
      return '<section class="card center" aria-busy="true"><div class="spinner" aria-hidden="true"></div><p class="muted">Opening your mistake notebook…</p></section>';
    }
    function heroHtml(small) {
      return '<section class="hero' + (small ? ' is-small' : '') + '">' +
        '<div class="hero-icon" aria-hidden="true">📒</div>' +
        '<div><p class="eyebrow">Polymath Learning Centre</p><h1>My Mistake Notebook</h1>' +
        '<p class="lead">Every question you get wrong in your worksheets and live lessons comes here by itself. ' +
        'Redo them in a short quiz every week, so the same mistake never happens twice.</p></div></section>';
    }
    function signedOutHtml() {
      var form = S.loginMode === 'password'
        ? '<form class="signin-form" data-form="password">' +
            '<label>Username or email<input type="text" name="loginId" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>' +
            '<label>Password<input type="password" name="loginPass" autocomplete="current-password" required></label>' +
            '<div class="row"><button type="submit" class="btn btn-main"' + (S.loginBusy ? ' disabled' : '') + '>' + (S.loginBusy ? 'Signing in…' : 'Sign in') + '</button>' +
            '<button type="button" class="btn" data-act="use-google">Use Google instead</button></div></form>'
        : '<div class="row center-row"><button type="button" class="btn btn-main btn-big" data-act="google"' + (S.loginBusy ? ' disabled' : '') + '>' +
            '<span class="g" aria-hidden="true">G</span>' + (S.loginBusy ? 'Signing in…' : 'Sign in with Google') + '</button>' +
            '<button type="button" class="btn" data-act="use-password">Use a username and password</button></div>';
      return heroHtml(false) +
        '<section class="card center"><h2>Sign in to open your notebook</h2>' +
        '<p class="muted">Use the same sign-in as My Polymath. You only need to sign in once on this device.</p>' + form +
        (S.loginError ? '<p class="error" role="alert">' + esc(S.loginError) + '</p>' : '') + '</section>' + howHtml();
    }
    function errorHtml() {
      var waiting = S.error === 'not-approved' || S.error === 'access-paused';
      return heroHtml(true) + '<section class="card center"><div class="big-emoji" aria-hidden="true">' + (waiting ? '⏳' : '⚠️') + '</div>' +
        '<h2>' + (waiting ? 'Not open yet' : 'The notebook could not open') + '</h2>' +
        '<p class="muted">' + esc(friendlyError(S.error)) + '</p>' +
        '<div class="row center-row">' + (waiting ? '<a class="btn btn-main" href="' + STUDENT_HOME + '">Go to My Polymath</a>' : '<button type="button" class="btn btn-main" data-act="retry">Try again</button>') +
        '<button type="button" class="btn" data-act="sign-out">Sign out</button></div></section>';
    }
    function howHtml() {
      return '<section class="how" aria-labelledby="howTitle"><h2 id="howTitle">How it works</h2><ol class="steps">' +
        '<li><span class="step-n">1</span><div><b>Mistakes are collected for you.</b> When Study Buddy marks a worksheet, or your teacher marks your answer in a live lesson, every question you got wrong, partly right or left blank goes into your notebook.</div></li>' +
        '<li><span class="step-n">2</span><div><b>A short quiz every Monday.</b> Up to 8 of your mistakes come back to redo. The ones you missed again come first.</div></li>' +
        '<li><span class="step-n">3</span><div><b>Fixed, then mastered.</b> Get it right and the mistake is fixed. Two weeks later it comes back once more as a check-up. Right again, and it is mastered for good.</div></li>' +
        '</ol></section>';
    }
    function pickerHtml() {
      var d = S.data;
      var out = '';
      if (d.me && d.me.admin) {
        var opts = '<option value="">' + (S.roster ? 'Choose a student…' : 'Loading the class list…') + '</option>';
        (S.roster || []).forEach(function (c) {
          opts += '<option value="' + esc(c.key) + '"' + (S.as === c.key ? ' selected' : '') + '>' + esc((c.level ? c.level + ' · ' : '') + c.name + (c.family ? ' (' + c.family + ')' : '')) + '</option>';
        });
        out += '<section class="admin-bar"><label for="asPick"><b>Admin:</b> view a student\'s notebook</label>' +
          '<select id="asPick" data-act="as">' + opts + '</select>' +
          (S.as ? '<button type="button" class="btn btn-small" data-act="as-clear">Back to my own</button>' : '') + '</section>';
      }
      if (!d.viewing && d.children && d.children.length > 1) {
        out += '<div class="kids" role="tablist" aria-label="Whose notebook">' + d.children.map(function (c) {
          var on = c.key === d.child;
          return '<button type="button" role="tab" class="kid' + (on ? ' is-on' : '') + '" aria-selected="' + on + '" data-act="child" data-key="' + esc(c.key) + '">' +
            '<span class="kid-name">' + esc(c.name) + '</span>' + (c.level ? '<span class="kid-level">' + esc(c.level) + '</span>' : '') + '</button>';
        }).join('') + '</div>';
      }
      return out;
    }
    function statsHtml(st) {
      var tile = function (n, label, cls, sub) {
        return '<div class="stat ' + cls + '"><div class="stat-n">' + n + '</div><div class="stat-label">' + label + '</div>' + (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>';
      };
      return '<section class="stats" aria-label="Your notebook in numbers">' +
        tile(st.open, 'To redo', 'is-open', '') +
        tile(st.fixed, 'Fixed', 'is-fixed', st.fixed ? 'check-up later' : '') +
        tile(st.mastered, 'Mastered', 'is-mastered', st.mastered ? 'for good' : '') +
        tile(st.streak, 'Week streak', 'is-streak', st.streak ? '🔥' : '') + '</section>';
    }
    function weekHtml() {
      var d = S.data, nb = d.notebook, st = nb.stats;
      var q = quizState(nb.week, nb.items);
      var left = daysLeft(nb.week.endsAt, now());
      var pct = q.size ? Math.round(q.done / q.size * 100) : 0;
      var head = '<div class="week-head"><div><p class="eyebrow">' + esc(nb.week.label || 'This week') + '</p><h2>This week\'s redo quiz</h2></div>' +
        '<span class="pill">' + (left <= 1 ? 'New quiz on Monday' : left + ' days left') + '</span></div>';
      if (!q.size) {
        return '<section class="card week is-empty">' + head +
          '<p class="muted">' + (st.total ? 'Nothing to redo this week: every mistake in your notebook is fixed. A check-up comes back two weeks after each fix.' :
            'No mistakes to redo yet. When a worksheet is marked in Study Buddy, or your teacher marks your answers in a live lesson, the questions you got wrong come here.') + '</p></section>';
      }
      var dots = q.ids.map(function (id) {
        var r = nb.week.done[id];
        return '<span class="dot ' + (r === 1 ? 'is-right' : r === 0 ? 'is-wrong' : '') + '" title="' + (r === 1 ? 'Right' : r === 0 ? 'Not yet' : 'To do') + '"></span>';
      }).join('');
      var btn = q.finished
        ? '<p class="done-line">🎉 Done! ' + q.right + ' of ' + q.size + ' right' + (q.right === q.size ? '. Perfect week!' : '. The ones you missed come back next week.') + '</p>'
        : '<button type="button" class="btn btn-main btn-big" data-act="quiz">' + (q.done ? 'Continue the quiz' : 'Start the quiz') + ' <span aria-hidden="true">→</span></button>';
      return '<section class="card week">' + head +
        '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + q.size + '" aria-valuenow="' + q.done + '" aria-label="Quiz progress"><span style="width:' + pct + '%"></span></div>' +
        '<div class="week-row"><div class="dots" aria-hidden="true">' + dots + '</div><span class="muted small">' + q.done + ' of ' + plural(q.size, 'question') + ' done</span></div>' +
        btn + (encouragement(st) ? '<p class="muted small cheer">' + esc(encouragement(st)) + '</p>' : '') + '</section>';
    }
    function chipsHtml() {
      var items = S.data.notebook.items;
      var c = counts(items);
      var chip = function (group, value, label, n) {
        var on = S.filter[group] === value;
        return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-act="filter" data-group="' + group + '" data-value="' + value + '">' +
          esc(label) + (n != null ? ' <span class="chip-n">' + n + '</span>' : '') + '</button>';
      };
      var out = '<div class="chips" aria-label="Show">' + chip('status', 'open', 'To redo', c.open) + chip('status', 'fixed', 'Fixed', c.fixed) +
        chip('status', 'mastered', 'Mastered', c.mastered) + chip('status', 'all', 'All', c.all) + (c.removed ? chip('status', 'removed', 'Removed', c.removed) : '') + '</div>';
      var src = (c.live && c.worksheet) ? chip('src', 'all', 'Everywhere') + chip('src', 'worksheet', '📄 Worksheets', c.worksheet) + chip('src', 'live', '🔴 Live lessons', c.live) : '';
      var sub = (c.math && c.science) ? chip('sub', 'all', 'Both subjects') + chip('sub', 'math', 'Math', c.math) + chip('sub', 'science', 'Science', c.science) : '';
      if (src || sub) out += '<div class="chips chips-2">' + src + (src && sub ? '<span class="chip-gap"></span>' : '') + sub + '</div>';
      return out;
    }
    function itemCardHtml(it) {
      var key = it.key || S.revealed[it.id];
      var img = it.image ? (S.images[it.id] && S.images[it.id] !== 'failed'
        ? '<img class="q-img" alt="The question as it was printed" src="' + esc(S.images[it.id]) + '">'
        : S.images[it.id] === 'failed' ? '<p class="muted small">The picture could not be loaded.</p>'
        : S.images[it.id] === 'loading' ? '<p class="muted small">Loading the picture…</p>'
        : '<button type="button" class="btn btn-small btn-quiet" data-act="img" data-id="' + esc(it.id) + '">🖼 Show the question\'s picture</button>') : '';
      var text = it.kind === 'cloze' ? '<p class="q-text">' + esc(it.text) + '</p><p class="q-text cloze-read">' + clozeRead(it.parts) + '</p>' : (it.text ? '<p class="q-text">' + escLines(it.text) + '</p>' : '');
      var opts = it.kind === 'mcq' && it.options ? '<ol class="opts-read">' + it.options.map(function (o, i) {
        var right = key && key.answer === i;
        return '<li class="' + (right ? 'is-right' : '') + '"><span class="opt-l">' + letter(i) + '</span>' + esc(o) + (right ? ' <span class="tick" aria-label="right answer">✓</span>' : '') + '</li>';
      }).join('') + '</ol>' : '';
      var yours = it.verdict === 'skipped' ? '<p class="yours"><span class="tag tag-skip">Left blank</span></p>'
        : it.yours ? '<p class="yours"><span class="tag tag-' + (it.verdict === 'partial' ? 'part' : 'wrong') + '">' + esc(VERDICT_WORDS[it.verdict] || 'Wrong') + '</span> You wrote: <span class="yours-text">' + escLines(it.yours) + '</span></p>' : '';
      var ans = key ? '<div class="answer"><b>Answer:</b> ' + escLines(answerWords(it, key) || 'Ask your teacher.') + (key.explain ? '<p class="explain">' + escLines(key.explain) + '</p>' : '') +
        (it.kind === 'cloze' && key.full ? '' : (key.model && answerWords(it, key) !== key.model ? '<p class="explain">' + escLines(key.model) + '</p>' : '')) + '</div>' : '';
      var tries = it.tries ? '<span class="muted small">Redone ' + plural(it.tries, 'time') + (it.last ? ' · last time ' + (it.last === 'right' ? 'right' : 'not yet') : '') + '</span>' : '';
      var checkup = it.status === 'fixed' && it.checkupDue ? '<span class="muted small">Check-up from ' + esc(sgDate(it.checkupDue)) + '</span>' : '';
      var actions = it.hidden
        ? '<button type="button" class="btn btn-small" data-act="unhide" data-id="' + esc(it.id) + '">Put it back</button>'
        : '<button type="button" class="btn btn-small btn-main" data-act="redo" data-id="' + esc(it.id) + '">' + (it.status === 'open' ? 'Redo it' : 'Practise again') + '</button>' +
          (key ? '' : '<button type="button" class="btn btn-small" data-act="reveal" data-id="' + esc(it.id) + '">Show answer</button>') +
          (S.confirmHide === it.id
            ? '<span class="confirm">Remove it from your quizzes? <button type="button" class="link" data-act="hide" data-id="' + esc(it.id) + '">Yes, remove</button> <button type="button" class="link" data-act="hide-cancel">Keep</button></span>'
            : '<button type="button" class="link small" data-act="hide-ask" data-id="' + esc(it.id) + '">Remove</button>');
      return '<article class="item is-' + it.status + (it.hidden ? ' is-hidden' : '') + '" id="item-' + esc(it.id) + '">' +
        '<header class="item-head"><span class="badge badge-' + it.status + '">' + STATUS_ICON[it.status] + ' ' + STATUS_WORDS[it.status] + '</span>' +
        '<span class="src">' + (it.src === 'live' ? '🔴 ' : '📄 ') + esc(it.where || SOURCE_WORDS[it.src]) + '</span>' +
        '<span class="when">' + esc(whenWords(it.at, now())) + '</span></header>' +
        (it.topic ? '<p class="topic">' + esc(it.topic) + '</p>' : '') + text + img + opts + yours + ans +
        '<footer class="item-foot">' + actions + '<span class="item-meta">' + tries + checkup + '</span></footer></article>';
    }
    function clozeRead(parts) {
      return (parts || []).map(function (p) { return typeof p === 'number' ? '<span class="gap-read">' + (p + 1) + '</span>' : esc(p); }).join('');
    }
    function listHtml() {
      var items = filterItems(S.data.notebook.items, S.filter);
      var c = counts(S.data.notebook.items);
      var empty = '';
      if (!items.length) {
        empty = '<div class="empty"><div class="big-emoji" aria-hidden="true">' + (c.all ? '🌟' : '📭') + '</div><p>' +
          (!c.all ? 'Your notebook is empty for now. Mistakes from Study Buddy worksheets and live lessons will appear here by themselves.'
            : S.filter.status === 'open' ? 'Nothing left to redo. Every mistake here is fixed!' : 'Nothing here with these choices.') + '</p></div>';
      }
      return '<section class="list" aria-labelledby="listTitle"><div class="list-head"><h2 id="listTitle">My mistakes</h2>' +
        '<span class="muted small">' + plural(c.all, 'question') + ' collected</span></div>' + chipsHtml() +
        '<div class="items">' + items.map(itemCardHtml).join('') + '</div>' + empty + '</section>';
    }
    function sourcesNote() {
      var src = S.data.notebook.sources || {};
      var bits = [];
      if (src.problems && src.problems.length) bits.push('Some lessons or worksheets could not be read just now; refresh in a minute to see them.');
      return bits.length ? '<p class="note">' + esc(bits.join(' ')) + '</p>' : '';
    }
    function notebookHtml() {
      var d = S.data;
      var who = d.viewing ? '<p class="viewing">👀 Viewing <b>' + esc((d.children[0] || {}).name || 'a student') + '</b>\'s notebook as an admin. Redoing here counts for them.</p>' : '';
      return heroHtml(true) + pickerHtml() + who + statsHtml(d.notebook.stats) + weekHtml() + sourcesNote() + listHtml() + howHtml() +
        '<p class="signed-in muted small">Signed in' + (d.me && d.me.signedInAs ? ' as ' + esc(d.me.signedInAs) : '') + ' · <button type="button" class="link" data-act="sign-out">Sign out</button></p>';
    }
    function paintImages() { /* pictures are drawn by render() from S.images */ }

    /* ---------- the quiz / redo sheet ---------- */
    function openQuiz(ids, how) {
      if (!ids.length) return;
      S.quiz = { ids: ids, i: 0, how: how, result: null, busy: false, values: {}, summary: { right: 0, wrong: 0 } };
      drawSheet();
      sheet.hidden = false;
      doc.body.classList.add('sheet-open');
      var first = sheet.querySelector('input, textarea, button.opt');
      if (first) try { first.focus(); } catch (e) { /* ignore */ }
    }
    function closeQuiz() {
      S.quiz = null;
      sheet.hidden = true;
      sheet.innerHTML = '';
      doc.body.classList.remove('sheet-open');
      render();
    }
    function currentItem() { return S.quiz ? itemById(S.quiz.ids[S.quiz.i]) : null; }
    function drawSheet() {
      var Q = S.quiz;
      if (!Q) return;
      if (Q.i >= Q.ids.length) { sheet.innerHTML = sheetFrame(finishHtml()); return; }
      var it = currentItem();
      if (!it) { Q.i++; drawSheet(); return; }
      if (it.image && !S.images[it.id]) fetchImage(it.id, true);
      var nb = S.data.notebook;
      var isCheckup = Q.how === 'quiz' && nb.week.checkups && nb.week.checkups.indexOf(it.id) >= 0;
      var head = '<div class="sheet-top"><span class="muted small">' + (Q.how === 'quiz' ? 'Question ' + (Q.i + 1) + ' of ' + Q.ids.length : 'Redo') + '</span>' +
        '<button type="button" class="x" data-q="close" aria-label="Close">✕</button></div>' +
        (Q.how === 'quiz' ? '<div class="progress thin"><span style="width:' + Math.round(Q.i / Q.ids.length * 100) + '%"></span></div>' : '');
      var meta = '<p class="q-where">' + (it.src === 'live' ? '🔴 ' : '📄 ') + esc(it.where) + (isCheckup ? ' <span class="badge badge-fixed">Check-up</span>' : '') + '</p>';
      var img = it.image ? '<div class="img-slot" data-img-slot="' + esc(it.id) + '">' + sheetImgHtml(it.id) + '</div>' : '';
      var done = !!Q.result;
      var input = '';
      var val = Q.values[it.id];
      if (it.kind === 'mcq') {
        input = '<div class="opts" role="radiogroup" aria-label="Choose an answer">' + it.options.map(function (o, i) {
          var picked = val === i;
          var cls = 'opt' + (picked ? ' is-picked' : '');
          if (done && Q.result.key && Q.result.key.answer === i) cls += ' is-right';
          if (done && picked && Q.result.right === false) cls += ' is-wrong';
          return '<button type="button" role="radio" aria-checked="' + picked + '" class="' + cls + '" data-q="pick" data-i="' + i + '"' + (done ? ' disabled' : '') + '><span class="opt-l">' + letter(i) + '</span><span>' + esc(o) + '</span></button>';
        }).join('') + '</div>';
      } else if (it.kind === 'cloze') {
        input = (it.text ? '<p class="q-text">' + escLines(it.text) + '</p>' : '') + '<p class="cloze">' + clozeHtml(it.parts, 'gap-' , val, done) + '</p>';
      } else if (it.kind === 'blank') {
        input = '<label class="answer-label" for="ans">Your answer</label><input id="ans" class="answer-input" type="text" autocomplete="off" value="' + esc(val || '') + '"' + (done ? ' disabled' : '') + '>';
      } else {
        input = '<label class="answer-label" for="ans">Your answer</label><textarea id="ans" class="answer-input" rows="4"' + (done ? ' disabled' : '') + '>' + esc(val || '') + '</textarea>';
      }
      var body = meta + (it.kind !== 'cloze' && it.text ? '<p class="q-text big">' + escLines(it.text) + '</p>' : '') + img + input;
      var foot = '';
      if (!done) {
        foot = '<div class="sheet-foot"><button type="button" class="btn btn-main btn-big" data-q="check"' + (Q.busy ? ' disabled' : '') + '>' + (Q.busy ? 'Checking…' : 'Check my answer') + '</button>' +
          (Q.how === 'quiz' ? '<button type="button" class="link" data-q="skip">Skip for now</button>' : '') + '</div>';
      } else {
        foot = resultHtml(it, Q.result);
      }
      sheet.innerHTML = sheetFrame(head + '<div class="sheet-body">' + body + '</div>' + foot);
    }
    // The picture inside the redo sheet. When it arrives only this slot is
    // redrawn, so an answer being typed keeps its place and its focus.
    function sheetImgHtml(id) {
      var v = S.images[id];
      if (v && v !== 'failed' && v !== 'loading') return '<img class="q-img" alt="The question as it was printed" src="' + esc(v) + '">';
      return v === 'failed' ? '<p class="muted small">The picture could not be loaded.</p>' : '<p class="muted small">Loading the picture…</p>';
    }
    function sheetFrame(inner) { return '<div class="sheet-card" role="dialog" aria-modal="true" aria-label="Redo your mistake">' + inner + '</div>'; }
    function resultHtml(it, r) {
      var Q = S.quiz;
      var key = r.key || {};
      var ans = answerWords(it, key);
      var explain = key.explain ? '<p class="explain">' + escLines(key.explain) + '</p>' : '';
      var model = key.model && key.model !== ans ? '<p class="explain">' + escLines(key.model) + '</p>' : '';
      var last = it.yours ? '<p class="muted small">Last time you wrote: ' + escLines(it.yours) + '</p>' : '';
      var nextBtn = '<button type="button" class="btn btn-main btn-big" data-q="next">' + (Q.i + 1 < Q.ids.length ? 'Next question →' : (Q.how === 'quiz' ? 'Finish' : 'Done')) + '</button>';
      if (r.right === true) {
        var words = r.status === 'mastered' ? '🏆 Mastered! You got it right at the check-up too.' : r.before === 'open' ? '✅ Fixed! That mistake will not happen again.' : '✅ Right again!';
        return '<div class="result is-right" role="status"><p class="result-title">' + words + '</p>' + (ans ? '<p><b>Answer:</b> ' + escLines(ans) + '</p>' : '') + explain + '</div><div class="sheet-foot">' + nextBtn + '</div>';
      }
      if (r.right === false) {
        return '<div class="result is-wrong" role="status"><p class="result-title">Not yet. Here is the right answer:</p>' +
          (ans ? '<p class="answer-line">' + escLines(ans) + '</p>' : '<p>Ask your teacher about this one.</p>') + model + explain + last +
          '<p class="muted small">It stays in your notebook and comes back next week.</p></div><div class="sheet-foot">' + nextBtn + '</div>';
      }
      if (r.self) {
        return '<div class="result ' + (r.self === 'right' ? 'is-right' : 'is-wrong') + '" role="status"><p class="result-title">' +
          (r.self === 'right' ? (r.status === 'mastered' ? '🏆 Mastered!' : '✅ Fixed! Well done.') : 'Thanks for being honest. It comes back next week.') + '</p></div><div class="sheet-foot">' + nextBtn + '</div>';
      }
      // Compare with the answer and say.
      return '<div class="result is-compare" role="status"><p class="result-title">Compare with the answer</p>' +
        (ans ? '<p class="answer-line">' + escLines(ans) + '</p>' : '<p>There is no written answer for this one. Ask your teacher, then say how you did.</p>') + model + explain +
        '<p class="ask">Was your answer the same (in your own words is fine)?</p></div>' +
        '<div class="sheet-foot two"><button type="button" class="btn btn-good btn-big" data-q="self-right"' + (Q.busy ? ' disabled' : '') + '>Yes, I got it</button>' +
        '<button type="button" class="btn btn-big" data-q="self-wrong"' + (Q.busy ? ' disabled' : '') + '>No, not yet</button></div>';
    }
    function finishHtml() {
      var Q = S.quiz, nb = S.data.notebook;
      var q = quizState(nb.week, nb.items);
      var title = Q.how === 'quiz' ? (q.finished ? '🎉 Quiz finished!' : 'Good work!') : 'Done';
      var line = Q.how === 'quiz'
        ? (q.finished ? 'You got ' + q.right + ' of ' + q.size + ' right this week.' + (q.right < q.size ? ' The ones you missed come back next week.' : ' A perfect week!') : q.done + ' of ' + q.size + ' done. Come back to finish the rest any time this week.')
        : '';
      return '<div class="sheet-top"><span></span><button type="button" class="x" data-q="close" aria-label="Close">✕</button></div>' +
        '<div class="finish"><div class="big-emoji" aria-hidden="true">' + (q.finished && q.right === q.size ? '🏆' : '📒') + '</div><h2>' + title + '</h2><p>' + esc(line) + '</p>' +
        '<p class="muted">' + esc(encouragement(nb.stats)) + '</p>' +
        '<button type="button" class="btn btn-main btn-big" data-q="close">Back to my notebook</button></div>';
    }
    function readValue(it) {
      if (it.kind === 'mcq') return S.quiz.values[it.id];
      if (it.kind === 'cloze') {
        var gaps = sheet.querySelectorAll('input.gap'), out = [];
        for (var g = 0; g < gaps.length; g++) out[Number(gaps[g].getAttribute('data-gap'))] = gaps[g].value;
        for (var k = 0; k < out.length; k++) if (out[k] == null) out[k] = '';
        return out;
      }
      var el = sheet.querySelector('#ans');
      return el ? el.value : '';
    }
    function applyResult(json) {
      if (json.item) replaceItem(json.item);
      if (json.stats) S.data.notebook.stats = json.stats;
      if (json.week) S.data.notebook.week = json.week;
    }
    function check() {
      var Q = S.quiz, it = currentItem();
      if (!Q || !it || Q.busy) return;
      var value = readValue(it);
      Q.values[it.id] = value;
      var empty = value == null || value === '' || (Array.isArray(value) && !value.some(function (w) { return str(w).trim(); }));
      if (empty) { flash(it.kind === 'mcq' ? 'Choose an answer first.' : 'Type your answer first.'); return; }
      Q.busy = true; drawSheet();
      api('answer', { id: it.id, value: value, how: Q.how }).then(function (json) {
        Q.busy = false;
        applyResult(json);
        Q.result = { right: json.right, key: json.key, status: json.status, before: json.before };
        if (json.right === true) Q.summary.right++;
        if (json.right === false) Q.summary.wrong++;
        drawSheet();
      }).catch(function (e) { Q.busy = false; drawSheet(); flash(friendlyError(e && e.code)); });
    }
    function selfMark(right) {
      var Q = S.quiz, it = currentItem();
      if (!Q || !it || Q.busy) return;
      Q.busy = true; drawSheet();
      api('self', { id: it.id, right: right, how: Q.how }).then(function (json) {
        Q.busy = false;
        applyResult(json);
        Q.result = Object.assign({}, Q.result, { self: right ? 'right' : 'wrong', status: json.status });
        if (right) Q.summary.right++; else Q.summary.wrong++;
        drawSheet();
      }).catch(function (e) { Q.busy = false; drawSheet(); flash(friendlyError(e && e.code)); });
    }
    function next() { var Q = S.quiz; if (!Q) return; Q.i++; Q.result = null; drawSheet(); var f = sheet.querySelector('input, textarea, button.opt'); if (f) try { f.focus(); } catch (e) { /* ignore */ } }
    function fetchImage(id, inSheet) {
      if (S.images[id] && S.images[id] !== 'failed') return;
      S.images[id] = 'loading';
      if (!inSheet) render();
      api('image', { id: id }).then(function (json) { S.images[id] = json.image; })
        .catch(function () { S.images[id] = 'failed'; })
        .then(function () {
          var slots = sheet.querySelectorAll('[data-img-slot]');
          for (var i = 0; i < slots.length; i++) if (slots[i].getAttribute('data-img-slot') === id) slots[i].innerHTML = sheetImgHtml(id);
          render();
        });
    }
    var flashTimer = null;
    function flash(text) {
      var el = $('toast');
      if (!el) return;
      el.textContent = text;
      el.hidden = false;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () { el.hidden = true; }, 3800);
    }

    /* ---------- taps ---------- */
    app.addEventListener('click', function (event) {
      var t = event.target.closest ? event.target.closest('[data-act]') : null;
      if (!t || t.tagName === 'SELECT') return;
      var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
      if (act === 'google') signInGoogle();
      else if (act === 'use-password') { S.loginMode = 'password'; S.loginError = ''; render(); var f = app.querySelector('[name="loginId"]'); if (f) f.focus(); }
      else if (act === 'use-google') { S.loginMode = 'google'; S.loginError = ''; render(); }
      else if (act === 'sign-out') { S.data = null; S.as = ''; S.child = ''; savePrefs(); auth.signOut(); }
      else if (act === 'retry') load();
      else if (act === 'child') { S.child = t.getAttribute('data-key'); S.images = {}; S.revealed = {}; savePrefs(); load(); }
      else if (act === 'as-clear') { S.as = ''; S.images = {}; S.revealed = {}; savePrefs(); load(); }
      else if (act === 'filter') { S.filter[t.getAttribute('data-group')] = t.getAttribute('data-value'); savePrefs(); render(); }
      else if (act === 'quiz') { var q = quizState(S.data.notebook.week, S.data.notebook.items); openQuiz(q.next, 'quiz'); }
      else if (act === 'redo') openQuiz([id], 'redo');
      else if (act === 'img') fetchImage(id, false);
      else if (act === 'reveal') {
        api('reveal', { id: id }).then(function (json) { S.revealed[id] = json.key; render(); }).catch(function (e) { flash(friendlyError(e && e.code)); });
      }
      else if (act === 'hide-ask') { S.confirmHide = id; render(); }
      else if (act === 'hide-cancel') { S.confirmHide = ''; render(); }
      else if (act === 'hide' || act === 'unhide') {
        S.confirmHide = '';
        api('hide', { id: id, hidden: act === 'hide' }).then(function (json) {
          replaceItem(json.item); S.data.notebook.stats = json.stats; render();
          flash(act === 'hide' ? 'Removed. It will not come up in your quizzes.' : 'Put back in your notebook.');
        }).catch(function (e) { flash(friendlyError(e && e.code)); });
      }
    });
    app.addEventListener('change', function (event) {
      var t = event.target;
      if (t && t.getAttribute('data-act') === 'as') { S.as = t.value; S.images = {}; S.revealed = {}; savePrefs(); load(); }
    });
    app.addEventListener('submit', function (event) {
      var form = event.target;
      if (form && form.getAttribute('data-form') === 'password') { event.preventDefault(); signInPassword(form); }
    });
    sheet.addEventListener('click', function (event) {
      if (event.target === sheet) { closeQuiz(); return; }
      var t = event.target.closest ? event.target.closest('[data-q]') : null;
      if (!t) return;
      var a = t.getAttribute('data-q');
      if (a === 'close') closeQuiz();
      else if (a === 'pick') { S.quiz.values[currentItem().id] = Number(t.getAttribute('data-i')); drawSheet(); }
      else if (a === 'check') check();
      else if (a === 'next') next();
      else if (a === 'skip') { S.quiz.ids.push(S.quiz.ids.splice(S.quiz.i, 1)[0]); if (S.quiz.ids.length === 1) { closeQuiz(); return; } S.quiz.result = null; drawSheet(); }
      else if (a === 'self-right') selfMark(true);
      else if (a === 'self-wrong') selfMark(false);
    });
    sheet.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeQuiz();
      if (event.key === 'Enter' && event.target && event.target.tagName === 'INPUT' && S.quiz && !S.quiz.result) { event.preventDefault(); check(); }
    });
    sheet.addEventListener('input', function (event) {
      var it = currentItem();
      if (it && event.target && event.target.id === 'ans') S.quiz.values[it.id] = event.target.value;
    });

    /* ---------- go ---------- */
    if (!fb || !fb.initializeApp) { S.phase = 'error'; S.error = 'temporarily-unavailable'; render(); return { S: S }; }
    var fbApp = (fb.apps && fb.apps.length) ? fb.app() : fb.initializeApp(FIREBASE_CONFIG);
    auth = fbApp.auth ? fbApp.auth() : fb.auth();
    render();
    auth.onAuthStateChanged(function (user) {
      if (!user || user.isAnonymous) { S.user = null; S.data = null; S.phase = 'signed-out'; render(); return; }
      S.user = user;
      load().then(function () { if (S.data && S.data.me && S.data.me.admin && !S.roster) loadRoster(); });
    });
    // Back on the tab after a while (a worksheet marked meanwhile): read again.
    var hiddenAt = 0;
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) { hiddenAt = Date.now(); return; }
      if (S.user && S.phase === 'ready' && !S.quiz && hiddenAt && Date.now() - hiddenAt > 5 * 60000) load(true);
    });
    return { S: S, render: render, load: load };
  }

  var api = { version: VERSION, pure: pure, start: start };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotebookApp = api;
  if (root.document && root.document.getElementById && root.document.getElementById('app')) {
    var go = function () { root.NotebookApp.instance = start(root.document, root); };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', go); else go();
  }
})(typeof window !== 'undefined' ? window : globalThis);
