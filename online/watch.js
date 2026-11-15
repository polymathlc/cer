/* Polymath Online — the lesson video player (watch.html). The rules are in
   watch-core.js; this is Firebase, the player and the buttons.

   watch.html?ws=<worksheet id>[&day=YYYY-MM-DD][&rec=<recording id>][&t=<seconds>][&c=<class id>]

   It plays every lesson recorded on the worksheet in the order they were
   taught, one after another, with the question and page marks on the
   timeline. A camera or voice lesson replays the teacher's writing on the
   worksheet beside it; a window recording already shows it. */
(function () {
  'use strict';

  var APP_VERSION = 'v1.0.0';
  var W = window.PolymathWatchCore;
  var Core = window.PolymathOnlineCore;

  var ONLINE_ADMINS = ['chungzhikai@gmail.com', 'elsielcr@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg'];
  var WORKSHEETS = 'pdfAnnotator';
  var COURSES = 'onlineCourses';
  var MEMBERS = 'onlineMembers';
  var STUDENT_ACCESS = 'studentAccess';
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var UP_NEXT_SECONDS = 4;
  var SPOT_EVERY_MS = 5000;
  var MANIFEST_MAX_BYTES = 40 * 1024 * 1024;

  firebase.initializeApp({
    apiKey: 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo',
    authDomain: 'mathgen--app.firebaseapp.com',
    projectId: 'mathgen--app',
    storageBucket: 'mathgen--app.firebasestorage.app',
    messagingSenderId: '165654161198',
    appId: '1:165654161198:web:16c8bd60eb3a2aa7edbcbf',
    measurementId: 'G-0MWZFG211D'
  });
  var db = firebase.firestore();
  var auth = firebase.auth();
  var storage = firebase.storage();

  var query = W.readQuery(location.search);
  var state = {
    user: null,
    doc: null,              // the worksheet's pdfAnnotator data
    lessons: [],
    index: -1,
    marks: {},              // lesson id → marks (once its manifest is read)
    manifests: {},          // lesson id → Promise<manifest|null>
    replays: {},            // lesson id → replay player
    knownMs: [],            // the real length of each lesson, once its media says
    found: null,            // { course, seq } — the class it is watched from
    follow: true,           // the page view follows the teacher
    swapped: false,         // camera big, page small
    upNextTimer: null,
    pendingSeek: 0,         // seconds to seek to once the media can
    playWhenReady: false
  };

  /* ================= Little helpers ================= */
  function $(id) { return document.getElementById(id); }
  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isAdminEmail(email) { return ONLINE_ADMINS.indexOf(String(email || '').trim().toLowerCase()) >= 0; }
  function toast(message) {
    var node = $('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { node.hidden = true; }, 3800);
  }
  function show(id, on) { var n = $(id); if (n) n.hidden = !on; }
  function setScreen(name) {
    ['scrLoading', 'scrSignIn', 'scrMessage', 'scrPlayer'].forEach(function (id) { show(id, id === name); });
  }
  function message(icon, title, text, opts) {
    opts = opts || {};
    $('msgIcon').textContent = icon;
    $('msgTitle').textContent = title;
    $('msgText').textContent = text;
    show('msgRetry', !!opts.retry);
    setScreen('scrMessage');
  }
  function storageGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* this visit only */ } }

  /* ================= Signing in ================= */
  function signIn() {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(provider).catch(function (err) {
      if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) return auth.signInWithRedirect(provider);
      if (err && err.code === 'auth/popup-closed-by-user') return;
      toast('Sign-in failed: ' + ((err && err.message) || err));
    });
  }
  $('signInBtn').addEventListener('click', signIn);
  $('msgRetry').addEventListener('click', function () { location.reload(); });

  if (!query.ws) {
    message('🎬', 'No worksheet chosen', 'Open a worksheet\'s Video button in Polymath Online to watch its lessons here.');
  } else {
    auth.onAuthStateChanged(function (user) {
      state.user = user && !user.isAnonymous ? user : null;
      $('who').textContent = state.user ? (state.user.displayName || state.user.email || '') : '';
      if (!state.user) { setScreen('scrSignIn'); return; }
      setScreen('scrLoading');
      start(state.user).catch(function (err) {
        console.error(err);
        message('⚠️', 'The videos could not be opened', 'Check your connection and try again. (' + ((err && err.message) || err) + ')', { retry: true });
      });
    });
  }

  /* ================= Who may watch ================= */
  async function memberOf(user) {
    var record = null;
    try {
      var snap = await db.collection(STUDENT_ACCESS).doc(user.uid).get();
      record = snap.exists ? (snap.data() || {}) : null;
    } catch (e) { record = null; }
    var status = Core.studentAccessStatus(record);
    var existing = null;
    try {
      var own = await db.collection(MEMBERS).doc(user.uid).get();
      if (own.exists) existing = own.data();
    } catch (e) { existing = null; }
    if (status === 'approved') return Core.memberFromStudentAccess(record, existing, user);
    if (status === 'pending' || status === 'revoked') return null;
    if (existing && !existing.revoked) return Object.assign({ uid: user.uid }, existing);
    return null;
  }
  async function classesFor(user, admin) {
    var snap = await db.collection(COURSES).get();
    var all = [];
    snap.forEach(function (doc) { all.push(Object.assign({ id: doc.id }, doc.data())); });
    if (admin) return all;
    var member = await memberOf(user);
    return member ? Core.coursesForMember(all, member) : null;
  }

  /* ================= Opening the worksheet ================= */
  async function start(user) {
    var admin = isAdminEmail(user.email);
    var courses = await classesFor(user, admin);
    if (!courses) {
      message('🔒', 'Your account is not in a class yet',
        'Open Polymath Online and join your class first. Once you are in, the videos play here.');
      return;
    }
    var found = W.releasedTo(courses, query.ws);
    if (!admin && !found.length) {
      message('🔒', 'This worksheet has not reached your class yet',
        'Its videos appear here once your class has the worksheet in Polymath Online.');
      return;
    }
    state.found = found.filter(function (f) { return f.course.id === query.course; })[0] || found[0] || null;
    var snap = await db.collection(WORKSHEETS).doc(query.ws).get();
    if (!snap.exists) { message('🗂', 'Worksheet not found', 'It may have been removed. Go back to Polymath Online and try another one.'); return; }
    state.doc = snap.data() || {};
    var annotations = await readAnnotations(state.doc);
    state.lessons = W.lessonsOf(annotations);
    renderHead();
    if (!state.lessons.length) {
      message('🎬', 'No lesson recorded yet', 'Lessons are recorded during class. Come back after the lesson to watch it here.');
      return;
    }
    setScreen('scrPlayer');
    buildPlayer();
    var spot = W.readSpot(storageGet(W.spotKey(query.ws)), state.lessons);
    var first = W.startIndex(state.lessons, query);
    var at = query.t;
    // Back where this device left off — unless the link asked for a place.
    if (!query.rec && !query.day && !query.t && spot) { first = spot.index; at = spot.t; }
    load(first, { at: at, play: true });
    preloadMarks();
  }
  // A big worksheet keeps its annotations in Storage, a small one inline.
  async function readAnnotations(d) {
    if (!d.annotationsPath) return d.annotations || '[]';
    var url = await storage.ref(d.annotationsPath).getDownloadURL();
    var resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.text();
  }
  function renderHead() {
    var d = state.doc || {};
    var name = d.name || 'Worksheet';
    document.title = 'Lesson videos · ' + name + ' | Polymath Online';
    $('wsName').textContent = name;
    var bits = [];
    if (state.found) {
      var c = state.found.course;
      bits.push(W.placeText(state.found));
      if (c.title) bits.push(c.title);
    }
    var n = state.lessons.length;
    if (n) bits.push(n + (n === 1 ? ' lesson' : ' lessons') + ' · ' + W.formatTime(W.totalSeconds(state.lessons)) + ' in all');
    $('wsSub').textContent = bits.filter(Boolean).join(' · ');

  }

  /* ================= The marks: each lesson's manifest ================= */
  function manifestOf(lesson) {
    if (!lesson.manifestUrl) return Promise.resolve(null);
    if (!state.manifests[lesson.id]) {
      state.manifests[lesson.id] = fetch(lesson.manifestUrl).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var size = Number(r.headers && r.headers.get ? r.headers.get('content-length') : 0) || 0;
        if (size > MANIFEST_MAX_BYTES) throw new Error('too large');
        return r.json();
      }).catch(function (err) {
        console.warn('Lesson marks could not be read', lesson.id, err);
        return null;
      });
    }
    return state.manifests[lesson.id];
  }
  function marksFor(lesson) {
    return manifestOf(lesson).then(function (m) {
      var marks = m ? W.marksOf(m, lesson.durationMs) : W.emptyMarks();
      state.marks[lesson.id] = marks;
      if (m && m.timeline && lesson.kind !== 'screen' && !state.replays[lesson.id]) {
        try { state.replays[lesson.id] = W.createReplay(m.timeline); } catch (e) { console.warn('Writing not replayable', e); }
      }
      return marks;
    });
  }
  // The other lessons' marks, one at a time, for the chapter lists.
  function preloadMarks() {
    var queue = state.lessons.slice();
    (function next() {
      var l = queue.shift();
      if (!l) return;
      marksFor(l).then(function () { renderList(); if (state.lessons[state.index] === l) renderBar(); }).then(function () { setTimeout(next, 150); });
    })();
  }

  /* ================= The player ================= */
  var media, inkCanvas, pageCanvas, pageWrap, pdfDoc = null, pdfLoading = null, pageShown = 0, pageSize = null, renderedRev = -1, renderedPage = -1;
  function buildPlayer() {
    media = $('media');
    inkCanvas = $('ink');
    pageCanvas = $('pagePic');
    pageWrap = $('pageWrap');
    media.addEventListener('timeupdate', onTime);
    media.addEventListener('play', onPlayState);
    media.addEventListener('pause', onPlayState);
    media.addEventListener('ended', onEnded);
    media.addEventListener('loadedmetadata', onMeta);
    media.addEventListener('durationchange', onMeta);
    media.addEventListener('waiting', function () { $('stage').classList.add('is-waiting'); });
    media.addEventListener('playing', function () { $('stage').classList.remove('is-waiting'); });
    media.addEventListener('canplay', function () { $('stage').classList.remove('is-waiting'); });
    media.addEventListener('error', function () {
      if (!media.getAttribute('src')) return;
      toast('This video could not be played. Trying the next one…');
      setTimeout(function () { var n = W.nextIndex(state.lessons, state.index); if (n >= 0) load(n, { play: true }); }, 1500);
    });
    $('bigPlay').addEventListener('click', togglePlay);
    $('playBtn').addEventListener('click', togglePlay);
    $('backBtn').addEventListener('click', function () { seekBy(-10); });
    $('fwdBtn').addEventListener('click', function () { seekBy(10); });
    $('prevBtn').addEventListener('click', function () { var p = W.prevIndex(state.lessons, state.index); if (p >= 0) load(p, { play: true }); });
    $('nextBtn').addEventListener('click', function () { var n = W.nextIndex(state.lessons, state.index); if (n >= 0) load(n, { play: true }); });
    $('speed').addEventListener('change', function () { media.playbackRate = Number($('speed').value) || 1; storageSet('polymath.watch.speed', $('speed').value); });
    var savedSpeed = Number(storageGet('polymath.watch.speed'));
    if (W.SPEEDS.indexOf(savedSpeed) >= 0) $('speed').value = String(savedSpeed);
    $('ccBtn').addEventListener('click', toggleCaptions);
    $('swapBtn').addEventListener('click', function () { state.swapped = !state.swapped; layoutStage(); });
    $('fullBtn').addEventListener('click', toggleFull);
    $('followBtn').addEventListener('click', function () { state.follow = true; show('followBtn', false); paintPage(true); });
    $('upNow').addEventListener('click', function () { goNext(); });
    $('upStay').addEventListener('click', cancelUpNext);
    pageWrap.addEventListener('wheel', userMovedPage, { passive: true });
    pageWrap.addEventListener('touchmove', userMovedPage, { passive: true });
    wireSeek();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', function () { renderedPage = -1; layoutStage(); renderBar(); });
    document.addEventListener('fullscreenchange', function () { renderedPage = -1; setTimeout(function () { layoutStage(); renderBar(); }, 60); });
    setInterval(saveSpot, SPOT_EVERY_MS);
    window.addEventListener('pagehide', saveSpot);
  }

  function lesson() { return state.lessons[state.index] || null; }
  function durationMs() {
    var l = lesson();
    var d = media && isFinite(media.duration) && media.duration > 0 ? media.duration * 1000 : 0;
    return d || (l ? l.durationMs : 0);
  }
  function nowMs() { return media ? (media.currentTime || 0) * 1000 : 0; }

  // Play lesson `i`, from `opts.at` seconds.
  function load(i, opts) {
    opts = opts || {};
    if (i < 0 || i >= state.lessons.length) return;
    cancelUpNext();
    saveSpot();
    state.index = i;
    var l = lesson();
    state.pendingSeek = opts.at > 0 ? opts.at : 0;
    state.playWhenReady = opts.play !== false;
    state.follow = true;
    show('followBtn', false);
    renderedRev = -1; renderedPage = -1;
    // Captions belong to one lesson: the old ones go.
    Array.prototype.slice.call(media.querySelectorAll('track')).forEach(function (t) { t.remove(); });
    media.removeAttribute('src');
    try { media.load(); } catch (e) {}
    media.src = l.url;
    media.playbackRate = Number($('speed').value) || 1;
    try { media.load(); } catch (e) {}
    if (l.captionsUrl) addCaptions(l);
    show('ccBtn', !!l.captionsUrl);
    $('ccBtn').setAttribute('aria-pressed', 'true');
    layoutStage();
    renderNow();
    renderList();
    renderBar();
    renderStrip();
    marksFor(l).then(function () {
      if (lesson() !== l) return;
      renderBar(); renderList(); renderNow();
      if (l.kind !== 'screen') paintPage(true);
    });
    if (l.kind !== 'screen') ensurePdf();
    try {
      var u = new URL(location.href);
      u.searchParams.set('rec', l.id);
      u.searchParams.delete('day'); u.searchParams.delete('t');
      history.replaceState(null, '', u.pathname + u.search);
    } catch (e) {}
    $('prevBtn').disabled = W.prevIndex(state.lessons, i) < 0;
    $('nextBtn').disabled = W.nextIndex(state.lessons, i) < 0;
  }
  function onMeta() {
    if (state.pendingSeek > 0 && isFinite(media.duration)) {
      try { media.currentTime = Math.min(state.pendingSeek, Math.max(0, media.duration - 1)); } catch (e) {}
      state.pendingSeek = 0;
    }
    var l = lesson();
    if (l && media.duration && isFinite(media.duration)) state.knownMs[state.index] = media.duration * 1000;
    if (state.playWhenReady) {
      state.playWhenReady = false;
      var p = media.play();
      if (p && p.catch) p.catch(function () { onPlayState(); });
    }
    renderBar(); renderStrip(); renderTime();
  }
  function togglePlay() {
    if (!media) return;
    if (media.paused || media.ended) {
      var p = media.play();
      if (p && p.catch) p.catch(function (err) { toast('Tap play again to start the video.'); console.warn(err); });
    } else media.pause();
  }
  function onPlayState() {
    var playing = media && !media.paused && !media.ended;
    $('playBtn').textContent = playing ? '❚❚' : '▶';
    $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    show('bigPlay', !playing && $('upNext').hidden);
    $('stage').classList.toggle('is-playing', playing);
    if (playing) requestAnimationFrame(frame);
    saveSpot();
  }
  function seekTo(seconds) {
    if (!media) return;
    var d = durationMs() / 1000;
    var s = Math.max(0, d ? Math.min(seconds, d - 0.2) : seconds);
    if (!isFinite(media.duration) && media.readyState < 1) { state.pendingSeek = s; return; }
    try { media.currentTime = s; } catch (e) { state.pendingSeek = s; }
    state.follow = true; show('followBtn', false);
    onTime();
  }
  function seekBy(delta) { seekTo((media.currentTime || 0) + delta); }

  /* The end of one lesson: the next one starts by itself after a short
     "Up next", or the set is done. */
  function onEnded() {
    saveSpot(true);
    var n = W.nextIndex(state.lessons, state.index);
    if (n < 0) {
      onPlayState();
      $('nowNote').textContent = 'That was the last lesson on this worksheet.';
      return;
    }
    var next = state.lessons[n];
    $('upTitle').textContent = next.name;
    var left = UP_NEXT_SECONDS;
    $('upCount').textContent = left;
    show('upNext', true);
    show('bigPlay', false);
    state.upNextTimer = setInterval(function () {
      left--;
      $('upCount').textContent = Math.max(0, left);
      if (left <= 0) goNext();
    }, 1000);
  }
  function goNext() {
    var n = W.nextIndex(state.lessons, state.index);
    cancelUpNext();
    if (n >= 0) load(n, { play: true });
  }
  function cancelUpNext() {
    if (state.upNextTimer) clearInterval(state.upNextTimer);
    state.upNextTimer = null;
    show('upNext', false);
    if (media) show('bigPlay', media.paused);
  }

  /* ================= Every frame while playing ================= */
  function frame() {
    if (!media || media.paused || media.ended) return;
    onTime();
    requestAnimationFrame(frame);
  }
  var lastTimeText = '';
  function onTime() {
    renderTime();
    var l = lesson();
    if (l && l.kind !== 'screen') paintPage(false);
  }
  function renderTime() {
    var t = nowMs(), d = durationMs();
    var pct = W.percentAt(t, d);
    $('seekFill').style.width = pct + '%';
    $('seekKnob').style.left = pct + '%';
    $('seek').setAttribute('aria-valuenow', String(Math.floor(t / 1000)));
    $('seek').setAttribute('aria-valuetext', W.formatTime(t / 1000) + ' of ' + W.formatTime(d / 1000));
    var text = W.formatTime(t / 1000) + ' / ' + W.formatTime(d / 1000);
    if (text !== lastTimeText) { $('time').textContent = text; lastTimeText = text; renderNow(); }
    if (media && media.buffered && media.buffered.length && d) {
      try { $('seekBuf').style.width = W.percentAt(media.buffered.end(media.buffered.length - 1) * 1000, d) + '%'; } catch (e) {}
    }
    var seg = $('stripNow');
    if (seg) seg.style.width = pct + '%';
  }
  // "Q3 · page 2" over the player, and the chapter list's highlight.
  var lastChapter = -2;
  function renderNow() {
    var l = lesson();
    if (!l) return;
    var marks = state.marks[l.id];
    var t = nowMs();
    var now = marks ? W.nowText(marks, t) : '';
    $('nowMark').textContent = now;
    show('nowMark', !!now);
    $('nowTitle').textContent = l.name;
    $('nowNote').textContent = l.kind === 'screen' ? '' : l.kind === 'camera' ? 'The teacher\'s writing plays on the worksheet as they talk.' : 'A voice lesson: the writing plays on the worksheet as the teacher talks.';
    var ch = marks ? W.chapterAt(marks.chapters, t) : -1;
    if (ch !== lastChapter) {
      lastChapter = ch;
      Array.prototype.forEach.call(document.querySelectorAll('.chap.is-now'), function (n) { n.classList.remove('is-now'); });
      var node = document.querySelector('.lesson.is-current .chap[data-ch="' + ch + '"]');
      if (node) node.classList.add('is-now');
    }
  }

  /* ================= The timeline with its marks ================= */
  function renderBar() {
    var l = lesson();
    var marks = l ? state.marks[l.id] : null;
    var d = durationMs();
    var bar = $('seek');
    var w = bar.clientWidth || 600;
    var qHtml = '', tickHtml = '', pageHtml = '';
    if (marks && d) {
      var show2 = W.labelled(marks.questions, d, w, 30);
      marks.questions.forEach(function (q, i) {
        var left = W.percentAt(q.t, d);
        tickHtml += '<span class="tick" style="left:' + left + '%"></span>';
        qHtml += '<button type="button" class="qmark' + (show2[i] ? '' : ' is-quiet') + '" style="left:' + left + '%" data-t="' + q.t + '" title="' + h(q.label + ' · ' + W.formatTime(q.t / 1000) + (q.page ? ' · page ' + q.page : '')) + '" aria-label="' + h('Jump to ' + q.label + ' at ' + W.formatTime(q.t / 1000)) + '">' + h(q.label) + '</button>';
      });
      marks.pages.forEach(function (p, i) {
        var left = W.percentAt(p.t, d), right = W.percentAt(p.until, d);
        var width = Math.max(0, right - left);
        pageHtml += '<button type="button" class="pmark' + (i % 2 ? ' is-alt' : '') + '" style="left:' + left + '%;width:' + width + '%" data-t="' + p.t + '" title="' + h('Page ' + p.page + ' · from ' + W.formatTime(p.t / 1000)) + '" aria-label="' + h('Jump to page ' + p.page + ' at ' + W.formatTime(p.t / 1000)) + '"><span>' + (width * w / 100 >= 26 ? 'p' + p.page : '') + '</span></button>';
      });
    }
    $('qRow').innerHTML = qHtml;
    $('seekTicks').innerHTML = tickHtml;
    $('pageRow').innerHTML = pageHtml;
    var none = !marks || (!marks.questions.length && !marks.pages.length);
    $('markNote').textContent = !marks ? 'Reading the question marks…' : none ? 'This lesson has no question marks.' : 'Tap a question or a page on the timeline to jump there.';
    $('seek').setAttribute('aria-valuemax', String(Math.floor(d / 1000)));
    renderTime();
  }
  function wireSeek() {
    var bar = $('seek'), dragging = false;
    function at(e) {
      var r = bar.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      return Math.max(0, Math.min(1, x / Math.max(1, r.width)));
    }
    function move(e) {
      if (!dragging) return;
      var f = at(e);
      $('seekFill').style.width = f * 100 + '%';
      $('seekKnob').style.left = f * 100 + '%';
      hover(f);
    }
    function hover(f) {
      var d = durationMs(), l = lesson(), marks = l ? state.marks[l.id] : null;
      var tip = $('seekTip');
      tip.hidden = false;
      tip.style.left = f * 100 + '%';
      var t = f * d;
      var label = marks ? W.nowText(marks, t) : '';
      tip.textContent = W.formatTime(t / 1000) + (label ? ' · ' + label : '');
    }
    bar.addEventListener('pointerdown', function (e) {
      dragging = true;
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      move(e);
    });
    bar.addEventListener('pointermove', function (e) { if (dragging) move(e); else hover(at(e)); });
    bar.addEventListener('pointerleave', function () { if (!dragging) $('seekTip').hidden = true; });
    bar.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      $('seekTip').hidden = true;
      seekTo(at(e) * durationMs() / 1000);
    });
    bar.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { seekBy(-5); e.preventDefault(); }
      if (e.key === 'ArrowRight') { seekBy(5); e.preventDefault(); }
      if (e.key === 'Home') { seekTo(0); e.preventDefault(); }
    });
    // The question chips and the page bands jump there.
    ['qRow', 'pageRow'].forEach(function (id) {
      $(id).addEventListener('click', function (e) {
        var b = e.target.closest('[data-t]');
        if (!b) return;
        seekTo(Number(b.dataset.t) / 1000);
        if (media.paused) togglePlay();
      });
    });
  }

  /* ================= All the lessons, as one strip ================= */
  function renderStrip() {
    var segs = W.strip(state.lessons, state.knownMs);
    $('strip').innerHTML = segs.map(function (s) {
      var l = state.lessons[s.index];
      var cur = s.index === state.index;
      var done = s.index < state.index;
      return '<button type="button" class="seg' + (cur ? ' is-current' : '') + (done ? ' is-done' : '') + '" style="width:' + s.width + '%" data-i="' + s.index + '" title="' + h(l.name + ' · ' + W.formatTime(s.length / 1000)) + '">' +
        (cur ? '<span class="seg-now" id="stripNow"></span>' : '') + '<span class="seg-label">' + h(l.dayLabel || 'Lesson ' + (s.index + 1)) + '</span></button>';
    }).join('');
    renderTime();
  }
  $('strip').addEventListener('click', function (e) {
    var b = e.target.closest('[data-i]');
    if (!b) return;
    var i = Number(b.dataset.i);
    if (i !== state.index) load(i, { play: true });
  });

  /* ================= The list of lessons and their chapters ================= */
  function renderList() {
    var html = '';
    var lastDay = null;
    state.lessons.forEach(function (l, i) {
      if (l.day !== lastDay) {
        lastDay = l.day;
        html += '<li class="day-head">' + h(l.dayLabel ? l.dayLabel + ' lesson' : 'Undated') + '</li>';
      }
      var cur = i === state.index;
      var marks = state.marks[l.id];
      var kind = l.kind === 'screen' ? '🖥 Recording' : l.kind === 'camera' ? '🎥 Video + writing' : '🎙 Voice + writing';
      html += '<li class="lesson' + (cur ? ' is-current' : '') + (i < state.index ? ' is-done' : '') + '">' +
        '<button type="button" class="lesson-btn" data-i="' + i + '">' +
          '<span class="lesson-num">' + (cur ? '▶' : i + 1) + '</span>' +
          '<span class="lesson-text"><b>' + h(l.title || (l.dayParts > 1 ? 'Part ' + l.dayPart + ' of ' + l.dayParts : 'Lesson ' + (i + 1))) + '</b>' +
            '<small>' + h([l.at ? W.formatClock(l.at) : '', W.formatTime((state.knownMs[i] || l.durationMs) / 1000), kind].filter(Boolean).join(' · ')) + '</small></span>' +
        '</button>';
      if (marks && marks.chapters.length) {
        html += '<ol class="chaps" aria-label="Questions and pages in this lesson">' + marks.chapters.map(function (c, k) {
          return '<li><button type="button" class="chap chap-' + c.kind + '" data-i="' + i + '" data-t="' + c.t + '" data-ch="' + k + '">' +
            '<span class="chap-label">' + h(c.label) + '</span>' +
            (c.kind === 'question' && c.page ? '<span class="chap-page">p' + c.page + '</span>' : '') +
            '<span class="chap-time">' + W.formatTime(c.t / 1000) + '</span></button></li>';
        }).join('') + '</ol>';
      } else if (!marks && l.manifestUrl) {
        html += '<div class="chaps-wait">Reading its questions…</div>';
      }
      html += '</li>';
    });
    $('lessonList').innerHTML = html;
    $('listCount').textContent = state.lessons.length + (state.lessons.length === 1 ? ' lesson' : ' lessons');
    lastChapter = -2;
    renderNow();
  }
  $('lessonList').addEventListener('click', function (e) {
    var chap = e.target.closest('.chap');
    if (chap) {
      var i = Number(chap.dataset.i), t = Number(chap.dataset.t) / 1000;
      if (i === state.index) { seekTo(t); if (media.paused) togglePlay(); }
      else load(i, { at: t, play: true });
      if (window.innerWidth < 900) $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    var b = e.target.closest('.lesson-btn');
    if (b) {
      var j = Number(b.dataset.i);
      if (j !== state.index) load(j, { play: true });
      else togglePlay();
    }
  });

  /* ================= Captions ================= */
  function addCaptions(l) {
    fetch(l.captionsUrl).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      if (lesson() !== l) return;
      var vtt = W.captionsVtt(data);
      if (!vtt) { show('ccBtn', false); return; }
      var tr = document.createElement('track');
      tr.kind = 'captions'; tr.srclang = 'en'; tr.label = 'English'; tr.default = true;
      tr.src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      media.appendChild(tr);
      setTimeout(function () { if (media.textTracks[0]) media.textTracks[0].mode = $('ccBtn').getAttribute('aria-pressed') === 'true' ? 'showing' : 'hidden'; }, 50);
    }).catch(function () { show('ccBtn', false); });
  }
  function toggleCaptions() {
    var on = $('ccBtn').getAttribute('aria-pressed') !== 'true';
    $('ccBtn').setAttribute('aria-pressed', String(on));
    Array.prototype.forEach.call(media.textTracks || [], function (t) { t.mode = on ? 'showing' : 'hidden'; });
  }

  /* ================= The stage: picture, page, or both ================= */
  function layoutStage() {
    var l = lesson();
    if (!l) return;
    var stage = $('stage');
    stage.classList.toggle('kind-screen', l.kind === 'screen');
    stage.classList.toggle('kind-camera', l.kind === 'camera');
    stage.classList.toggle('kind-voice', l.kind === 'voice');
    stage.classList.toggle('is-portrait', !!l.portrait);
    stage.classList.toggle('is-swapped', l.kind === 'camera' && state.swapped);
    show('swapBtn', l.kind === 'camera');
    show('pageWrap', l.kind !== 'screen');
    show('voiceBadge', l.kind === 'voice');
    if (l.kind !== 'screen') paintPage(true);
  }

  // pdf.js, once, then the worksheet's PDF, once.
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function ensurePdf() {
    if (pdfDoc || pdfLoading) return pdfLoading;
    var d = state.doc || {};
    if (!d.storagePath) { pdfLoading = Promise.resolve(null); return pdfLoading; }
    show('pageLoading', true);
    pdfLoading = (window.pdfjsLib ? Promise.resolve() : loadScript(PDFJS_URL)).then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return storage.ref(d.storagePath).getDownloadURL();
    }).then(function (url) {
      return window.pdfjsLib.getDocument({ url: url }).promise;
    }).then(function (doc) {
      pdfDoc = doc;
      show('pageLoading', false);
      renderedPage = -1;
      paintPage(true);
      return doc;
    }).catch(function (err) {
      console.warn('Worksheet PDF not loaded', err);
      show('pageLoading', false);
      $('pageMissing').hidden = false;
      return null;
    });
    return pdfLoading;
  }

  // The page the teacher had on screen, with the writing so far.
  var paintingPage = 0;
  function paintPage(force) {
    var l = lesson();
    if (!l || l.kind === 'screen') return;
    var replay = state.replays[l.id];
    var st = replay ? replay.stateAt(nowMs()) : null;
    var marks = state.marks[l.id];
    var page = st ? st.view.page : (marks && W.pageAt(marks.pages, nowMs())) || l.page || 1;
    if (page !== renderedPage || force) drawPdfPage(page);
    if (!pageSize) return;
    if (st && (st.revision !== renderedRev || force || inkCanvas.dataset.page !== String(page))) {
      drawInk(st.annotations, page);
      renderedRev = st.revision;
      inkCanvas.dataset.page = String(page);
    }
    if (state.follow && st) followView(st.view);
    $('pageLabel').textContent = 'Page ' + page + (pdfDoc ? ' of ' + Math.max(pdfDoc.numPages, page) : '');
  }
  function drawPdfPage(page) {
    renderedPage = page;
    if (!pdfDoc) { if (!pdfLoading) ensurePdf(); return; }
    var target = page;
    paintingPage = target;
    var width = Math.max(320, pageWrap.clientWidth || 640);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var get = page <= pdfDoc.numPages ? pdfDoc.getPage(page) : pdfDoc.getPage(pdfDoc.numPages).then(function (p) { return { blank: true, page: p }; });
    get.then(function (p) {
      if (paintingPage !== target) return;
      var real = p.blank ? p.page : p;
      var vp1 = real.getViewport({ scale: 1 });
      var scale = width / vp1.width;
      var vp = real.getViewport({ scale: scale * dpr });
      pageSize = { baseW: vp1.width, baseH: vp1.height, cssW: width, cssH: vp1.height * scale };
      [pageCanvas, inkCanvas].forEach(function (c) {
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        c.style.width = width + 'px'; c.style.height = pageSize.cssH + 'px';
      });
      $('pageSheet').style.height = pageSize.cssH + 'px';
      var ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      renderedRev = -1;
      if (p.blank) { paintPage(false); return; }   // a page added in Ans Key: blank paper
      return real.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { paintPage(false); });
    }).catch(function (err) { console.warn('Page not drawn', err); });
  }
  function drawInk(anns, page) {
    if (!pageSize) return;
    var ctx = inkCanvas.getContext('2d');
    ctx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    var kx = inkCanvas.width / pageSize.baseW, ky = inkCanvas.height / pageSize.baseH;
    W.onPage(anns, page).forEach(function (a) {
      ctx.save();
      var color = W.safeColor(a.color);
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1, (Number(a.width) || 2) * kx);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (a.rot && (a.type === 'rect' || a.type === 'ellipse' || a.type === 'text')) {
        var cx = (a.x + (a.w || 0) / 2) * kx, cy = (a.y + (a.h || 0) / 2) * ky;
        ctx.translate(cx, cy); ctx.rotate(a.rot * Math.PI / 180); ctx.translate(-cx, -cy);
      }
      if (a.type === 'pen' || a.type === 'highlight') {
        if (a.type === 'highlight') ctx.globalAlpha = 0.4;
        var pts = a.points || [];
        if (pts.length === 1) {
          ctx.beginPath(); ctx.arc(pts[0].x * kx, pts[0].y * ky, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
        } else if (pts.length) {
          ctx.beginPath(); ctx.moveTo(pts[0].x * kx, pts[0].y * ky);
          for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * kx, pts[i].y * ky);
          ctx.stroke();
        }
      } else if (a.type === 'rect') {
        if (a.fill && /^#[0-9a-f]{6}$/i.test(a.fill)) { ctx.globalAlpha = 0.35; ctx.fillStyle = a.fill; ctx.fillRect(a.x * kx, a.y * ky, a.w * kx, a.h * ky); ctx.globalAlpha = 1; }
        ctx.strokeRect(a.x * kx, a.y * ky, a.w * kx, a.h * ky);
        if (a.modelLabel) { ctx.font = Math.max(10, 13 * ky) + 'px sans-serif'; ctx.fillStyle = '#1A1A1A'; ctx.textAlign = 'center'; ctx.fillText(String(a.modelLabel), (a.x + a.w / 2) * kx, (a.y + a.h / 2 + 5) * ky); }
      } else if (a.type === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse((a.x + a.w / 2) * kx, (a.y + a.h / 2) * ky, Math.abs(a.w / 2 * kx), Math.abs(a.h / 2 * ky), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (a.type === 'line' || a.type === 'arrow') {
        ctx.beginPath(); ctx.moveTo(a.x1 * kx, a.y1 * ky); ctx.lineTo(a.x2 * kx, a.y2 * ky); ctx.stroke();
        if (a.type === 'arrow') {
          var heads = [[a.x1, a.y1, a.x2, a.y2]];
          if (a.heads === 'both' || a.heads === 'start') heads.push([a.x2, a.y2, a.x1, a.y1]);
          if (a.heads === 'start') heads.shift();
          heads.forEach(function (hd) {
            var hp = W.arrowHead(hd[0], hd[1], hd[2], hd[3], 8 + (Number(a.width) || 2) * 2);
            ctx.beginPath(); ctx.moveTo(hp[0].x * kx, hp[0].y * ky); ctx.lineTo(hd[2] * kx, hd[3] * ky); ctx.lineTo(hp[1].x * kx, hp[1].y * ky); ctx.stroke();
          });
        }
      } else if (a.type === 'text') {
        var fs = Math.max(6, (Number(a.fontSize) || 16) * ky);
        ctx.font = (a.italic ? 'italic ' : '') + (a.bold ? 'bold ' : '') + fs + 'px ' + (/^(arial|times new roman|courier new)$/i.test(a.fontFamily || '') ? '"' + a.fontFamily + '"' : 'sans-serif');
        var maxW = Math.max(40, (a.w || 200) * kx), x = a.x * kx, y = a.y * ky + fs;
        String(a.text || '').replace(/<[^>]*>/g, '').split('\n').forEach(function (para) {
          var line = '';
          para.split(/\s+/).forEach(function (word) {
            if (!word) return;
            var tryLine = line ? line + ' ' + word : word;
            if (ctx.measureText(tryLine).width > maxW && line) { ctx.fillText(line, x, y); line = word; y += fs * 1.35; }
            else line = tryLine;
          });
          ctx.fillText(line, x, y);
          y += fs * 1.35;
        });
      }
      ctx.restore();
    });
  }
  // Keep the part of the page the teacher was looking at in view.
  var programmaticScroll = false;
  function followView(view) {
    if (!pageSize || !view) return;
    var k = pageSize.cssW / pageSize.baseW;
    var target = view.y * k - pageWrap.clientHeight / 2;
    target = Math.max(0, Math.min(target, pageSize.cssH - pageWrap.clientHeight));
    if (Math.abs(pageWrap.scrollTop - target) < 2) return;
    programmaticScroll = true;
    pageWrap.scrollTop = pageWrap.scrollTop + (target - pageWrap.scrollTop) * (media && !media.paused ? 0.18 : 1);
    setTimeout(function () { programmaticScroll = false; }, 30);
  }
  function userMovedPage() {
    if (programmaticScroll) return;
    if (state.follow) { state.follow = false; show('followBtn', true); }
  }

  /* ================= Full screen and keys ================= */
  function toggleFull() {
    var box = $('playerBox');
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    var req = box.requestFullscreen || box.webkitRequestFullscreen;
    if (req) req.call(box);
    else if (media.webkitEnterFullscreen) media.webkitEnterFullscreen();   // iPhone: the video alone
  }
  function jumpQuestion(dir) {
    var l = lesson(), marks = l ? state.marks[l.id] : null;
    if (!marks || !marks.chapters.length) return;
    var t = nowMs(), list = marks.chapters;
    var target = null;
    if (dir > 0) target = list.filter(function (c) { return c.t > t + 500; })[0];
    else {
      var before = list.filter(function (c) { return c.t < t - 2500; });
      target = before[before.length - 1] || list[0];
    }
    if (target) seekTo(target.t / 1000);
  }
  function onKey(e) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === ' ' || k === 'k' || k === 'K') { togglePlay(); e.preventDefault(); }
    else if (k === 'ArrowLeft' && e.target.id !== 'seek') { seekBy(-5); e.preventDefault(); }
    else if (k === 'ArrowRight' && e.target.id !== 'seek') { seekBy(5); e.preventDefault(); }
    else if (k === 'j' || k === 'J') seekBy(-10);
    else if (k === 'l' || k === 'L') seekBy(10);
    else if (k === ']') jumpQuestion(1);
    else if (k === '[') jumpQuestion(-1);
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'n' || k === 'N') goNext();
  }

  /* ================= Where was I ================= */
  function saveSpot(ended) {
    var l = lesson();
    if (!l || !media || !query.ws) return;
    var t = ended === true ? 0 : media.currentTime || 0;
    var rec = l.id;
    if (ended === true) {
      var n = W.nextIndex(state.lessons, state.index);
      if (n >= 0) rec = state.lessons[n].id;
    }
    storageSet(W.spotKey(query.ws), JSON.stringify({ rec: rec, t: Math.floor(t), at: Date.now() }));
  }

  $('versionTag').textContent = APP_VERSION;
  window.__watch = { state: state, load: load, seekTo: seekTo };
})();
