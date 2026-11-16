/* Polymath Online — the lesson video player's rules (watch.html, v1.0.0).
   ---------------------------------------------------------------------
   A Video button on the class timeline used to open the whole Ans Key app
   in a window, which showed a student the teacher's tools, the worksheet
   list and, for a worksheet that had not reached their own class yet, "That
   worksheet has not been released to your class yet". It now opens a page
   of its own: online/watch.html, a media player that

     • plays EVERY lesson recorded on the worksheet, one after another, in
       the order they were taught (oldest first), by itself,
     • marks the timeline with the QUESTION being explained ("Q3") and the
       PAGE on screen ("p2"), so a student jumps straight to the part they
       need, and lists the same marks as chapters under the player,
     • replays the teacher's writing on the worksheet beside a camera or
       voice lesson (a window recording already has it in its picture).

   Where the marks come from — nothing new is recorded for them:
     • Questions: since Ans Key's "⏱ Lesson steps", every recording's
       manifest carries `steps: [{ t, label, page, y }]`, one each time the
       teacher starts writing on a new question ("Q3", or "Page 2" on a page
       with no question numbers, and "Start" at 0).
     • Pages: the manifest's timeline records the teacher's view (`view`
       events with `page`), so every time the lesson moves to another page
       is known. Pages flicked past while scrolling (shown for less than
       PAGE_DWELL_MS) are not marks.
   A recording with neither (very old lessons) simply has no marks.

   This file holds no state and touches no DOM, so tools/online-portal-tests
   pins every rule in Node. watch.js is the page. */
(function (root) {
  'use strict';

  var VERSION = '1.1.0';
  var BUCKETS = ['mathgen--app.firebasestorage.app', 'mathgen--app.appspot.com'];
  var STORAGE_HOST = 'firebasestorage.googleapis.com';
  var STORAGE_DIR = 'pdf-annotator/';
  var WS_RE = /^[A-Za-z0-9_-]{1,128}$/;
  var REC_RE = /^[A-Za-z0-9_-]{1,120}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var QUESTION_RE = /^Q(?:uestion)?\s*(\d{1,3})\b/i;
  var PAGE_LABEL_RE = /^Page\s+(\d{1,4})$/i;
  var MS_MAX = 8 * 60 * 60 * 1000;      // Ans Key's own ceiling on a recording
  var PAGE_DWELL_MS = 4000;             // a page shown for less than this was scrolled past
  var QUESTION_GAP_MS = 2500;           // the same question again this soon is the same mark
  var MARKS_MAX = 400;                  // per recording, after merging
  var TITLE_MAX = 80;
  var LABEL_MAX = 24;
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

  /* ================= Small helpers ================= */
  function str(v) { return v == null ? '' : String(v); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function clip(v, max) {
    var s = str(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1).trim() + '…' : s;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // "4:05" or "1:02:09", from seconds.
  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(num(seconds, 0)));
    var h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }
  // "Mon 16 Nov" — and the year when it is not this year.
  function formatDay(ms, now) {
    ms = num(ms, 0);
    if (!ms) return '';
    var d = new Date(ms), today = new Date(now || Date.now());
    return WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : '');
  }
  // "4:05 pm"
  function formatClock(ms) {
    ms = num(ms, 0);
    if (!ms) return '';
    var d = new Date(ms), h = d.getHours(), m = d.getMinutes();
    return ((h % 12) || 12) + ':' + pad2(m) + (h < 12 ? ' am' : ' pm');
  }
  // The calendar day of a lesson, as the timeline's "By class day" rows key it.
  function dayKey(ms) {
    ms = num(ms, 0);
    if (!(ms >= Date.UTC(2020, 0, 1) && ms < Date.UTC(2100, 0, 1))) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ================= Where a lesson's files may come from =================
     Every lesson's media, manifest and captions live in OUR bucket under
     pdf-annotator/ (Ans Key uploads them as pdf-annotator/lesson-…). Nothing
     else is ever played or fetched: a worksheet's annotations are data. */
  function storageUrlOk(u) {
    var p;
    try { p = new URL(str(u)); } catch (e) { return false; }
    if (p.protocol !== 'https:' || p.hostname !== STORAGE_HOST || p.username || p.password) return false;
    var m = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(p.pathname);
    if (!m || BUCKETS.indexOf(m[1]) < 0) return false;
    var name;
    try { name = decodeURIComponent(m[2]); } catch (e) { return false; }
    return name.indexOf(STORAGE_DIR) === 0 && name.indexOf('..') < 0;
  }

  /* ================= The lessons on a worksheet ================= */
  function parseAnnotations(json) {
    if (Array.isArray(json)) return json;
    if (typeof json !== 'string' || !json) return [];
    try { var list = JSON.parse(json); return Array.isArray(list) ? list : []; } catch (e) { return []; }
  }
  // One recorded lesson, from its video annotation — or null.
  function lessonFrom(a) {
    if (!a || a.type !== 'video' || !a.lessonRecording || typeof a.lessonRecording !== 'object') return null;
    var rec = a.lessonRecording;
    var id = str(a.id);
    if (!REC_RE.test(id) || !storageUrlOk(a.url)) return null;
    var durationMs = Math.max(0, Math.min(MS_MAX, num(rec.duration, 0)));
    var video = rec.video === true;
    var screen = video && rec.screen === true;
    return {
      id: id,
      title: clip(rec.title, TITLE_MAX),
      at: Math.max(0, num(a.ts, 0)),
      durationMs: durationMs,
      url: str(a.url),
      manifestUrl: storageUrlOk(rec.manifestUrl) ? str(rec.manifestUrl) : '',
      captionsUrl: storageUrlOk(rec.captionsUrl) ? str(rec.captionsUrl) : '',
      video: video,
      // A window recording's picture IS the worksheet with the writing on it.
      screen: screen,
      portrait: screen && rec.frame === 'portrait',
      // Where its button sits on the worksheet: the page it was started on.
      page: Math.max(1, Math.floor(num(a.page, 1))),
      // How the page shows it: 'screen' (the picture has it all), 'camera'
      // (the teacher's camera beside the replayed writing) or 'voice'.
      kind: screen ? 'screen' : video ? 'camera' : 'voice'
    };
  }
  // Every lesson, in the order it was taught: oldest first. A lesson with no
  // recorded time (very old) goes after the dated ones, in worksheet order.
  // `skipDays` (['YYYY-MM-DD']): class days archived for students in the
  // class it is watched from (portal-core.js `archivedDaysOf`); their lessons
  // are left out before the lessons are numbered.
  // ⏰ v1.15.0: `isOpen(at)`, when given, leaves out a lesson that is not
  // over yet (portal-core.js `recordingOpen`, the lesson clock): a student
  // gets a lesson's videos at the end of the lesson, as with the timeline.
  function lessonsOf(annotations, skipDays, isOpen) {
    var list = [], seen = {};
    var skip = Array.isArray(skipDays) ? skipDays : [];
    parseAnnotations(annotations).forEach(function (a, i) {
      var l = lessonFrom(a);
      if (!l || seen[l.id]) return;
      if (skip.length && skip.indexOf(dayKey(l.at)) >= 0) return;
      if (typeof isOpen === 'function' && !isOpen(l.at)) return;
      seen[l.id] = true;
      l.order = i;
      list.push(l);
    });
    list.sort(function (p, q) {
      if (!p.at !== !q.at) return p.at ? -1 : 1;
      if (p.at !== q.at) return p.at - q.at;
      return p.order - q.order;
    });
    var days = {};
    list.forEach(function (l, i) {
      l.index = i;
      l.day = dayKey(l.at);
      l.dayLabel = formatDay(l.at);
      days[l.day] = (days[l.day] || 0) + 1;
      l.dayPart = days[l.day];
    });
    // "Mon 16 Nov · part 2 of 3" where a class day has more than one.
    list.forEach(function (l) {
      l.dayParts = days[l.day];
      l.name = lessonName(l);
    });
    return list;
  }
  function lessonName(l) {
    var when = l.dayLabel || 'Lesson ' + (l.index + 1);
    var part = l.dayParts > 1 ? ' · part ' + l.dayPart + ' of ' + l.dayParts : '';
    return (l.title ? l.title + ' · ' : '') + when + part;
  }
  // Seconds of every lesson together (what is known before the files load).
  function totalSeconds(lessons) {
    return (lessons || []).reduce(function (n, l) { return n + (l.durationMs || 0) / 1000; }, 0);
  }

  /* Where the player starts: a named recording, else the first lesson of a
     class day (`day=YYYY-MM-DD` from the timeline's day buttons), else the
     first lesson. */
  function startIndex(lessons, opts) {
    lessons = lessons || [];
    opts = opts || {};
    if (!lessons.length) return -1;
    var rec = str(opts.rec);
    if (rec) for (var i = 0; i < lessons.length; i++) if (lessons[i].id === rec) return i;
    var day = str(opts.day);
    if (DAY_RE.test(day)) for (var j = 0; j < lessons.length; j++) if (lessons[j].day === day) return j;
    return 0;
  }
  function nextIndex(lessons, i) { return i + 1 < (lessons || []).length ? i + 1 : -1; }
  function prevIndex(lessons, i) { return i > 0 && (lessons || []).length ? i - 1 : -1; }

  /* ================= The marks on the timeline ================= */
  function questionNumber(label) {
    var m = QUESTION_RE.exec(str(label).trim());
    return m ? Number(m[1]) : 0;
  }
  // The question marks: one each time the lesson moves to another question.
  function questionMarks(steps, durationMs) {
    if (!Array.isArray(steps)) return [];
    var max = durationMs > 0 ? durationMs : MS_MAX;
    var list = steps.filter(function (s) {
      return s && typeof s === 'object' && isFinite(Number(s.t)) && Number(s.t) >= 0 && Number(s.t) <= max && typeof s.label === 'string';
    }).map(function (s) {
      var label = clip(s.label, LABEL_MAX);
      var q = questionNumber(label);
      var pageMatch = PAGE_LABEL_RE.exec(label);
      var page = Math.max(0, Math.floor(num(s.page, 0)));
      if (!page && pageMatch) page = Number(pageMatch[1]);
      return { t: Number(s.t), q: q, label: q ? 'Q' + q : label, page: page };
    }).filter(function (s) {
      return s.q > 0;
    }).sort(function (a, b) { return a.t - b.t; });
    var out = [];
    list.forEach(function (s) {
      var prev = out[out.length - 1];
      if (prev && prev.q === s.q) return;                            // still the same question
      if (prev && s.t - prev.t < QUESTION_GAP_MS && out.length > 1) {  // a flick past: the later one stands
        var before = out[out.length - 2];
        if (before && before.q === s.q) { out.pop(); return; }
      }
      out.push(s);
    });
    return out.slice(0, MARKS_MAX);
  }

  // The page on screen through the lesson, from the recorded view. Pages
  // shown for less than PAGE_DWELL_MS (scrolled past) are dropped, and the
  // page before carries on until the next one that stays.
  function pageMarks(timeline, durationMs, steps) {
    var raw = [];
    var t0 = timeline && timeline.initial && timeline.initial.view;
    var p0 = t0 ? Math.floor(num(t0.page, 0)) : 0;
    if (p0 >= 1) raw.push({ t: 0, page: p0 });
    var events = timeline && Array.isArray(timeline.events) ? timeline.events : [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e || e.type !== 'view' || !e.view) continue;
      var p = Math.floor(num(e.view.page, 0)), t = num(e.t, -1);
      if (p < 1 || t < 0) continue;
      if (raw.length && raw[raw.length - 1].page === p) continue;
      raw.push({ t: t, page: p });
    }
    // An old recording with no view in it: the question steps know their pages.
    if (!raw.length && Array.isArray(steps)) {
      steps.forEach(function (s) {
        var sp = s ? Math.floor(num(s.page, 0)) : 0, st = s ? num(s.t, -1) : -1;
        if (sp >= 1 && st >= 0 && (!raw.length || raw[raw.length - 1].page !== sp)) raw.push({ t: st, page: sp });
      });
    }
    var end = durationMs > 0 ? durationMs : (timeline && num(timeline.duration, 0)) || 0;
    var kept = [];
    raw.forEach(function (r, k) {
      var until = k + 1 < raw.length ? raw[k + 1].t : end;
      var stays = until - r.t >= PAGE_DWELL_MS || k + 1 === raw.length;
      if (!stays) return;
      var prev = kept[kept.length - 1];
      if (prev && prev.page === r.page) return;
      kept.push({ t: kept.length ? r.t : 0, page: r.page });
    });
    kept.forEach(function (k, j) { k.until = j + 1 < kept.length ? kept[j + 1].t : end; });
    return kept.slice(0, MARKS_MAX);
  }

  /* All the marks of one recording, from its manifest:
     { questions: [{t, q, label, page}], pages: [{t, page, until}],
       chapters: [{t, label, kind, q, page}] } — times in milliseconds.
     Chapters are what the list under the player shows: every question,
     with the page it is on, and a page of its own wherever the lesson
     turns to a page before any question on it is marked. */
  function marksOf(manifest, durationMs) {
    var timeline = manifest && manifest.timeline;
    var dur = durationMs > 0 ? durationMs : (timeline && num(timeline.duration, 0)) || 0;
    var steps = manifest && manifest.steps;
    var questions = questionMarks(steps, dur);
    var pages = pageMarks(timeline, dur, steps);
    questions.forEach(function (q) { if (!q.page) q.page = pageAt(pages, q.t); });
    var chapters = [];
    pages.forEach(function (p) {
      // A page opens a chapter only when no question mark lands within a
      // few seconds of turning to it (the question mark says it better).
      var soon = questions.some(function (q) { return q.page === p.page && q.t >= p.t - 500 && q.t - p.t < 8000; });
      if (!soon) chapters.push({ t: p.t, label: 'Page ' + p.page, kind: 'page', q: 0, page: p.page });
    });
    questions.forEach(function (q) { chapters.push({ t: q.t, label: q.label, kind: 'question', q: q.q, page: q.page }); });
    chapters.sort(function (a, b) { return a.t - b.t || (a.kind === 'page' ? -1 : 1); });
    return { questions: questions, pages: pages, chapters: chapters.slice(0, MARKS_MAX) };
  }
  function emptyMarks() { return { questions: [], pages: [], chapters: [] }; }

  // The page on screen at `t` (ms), or 0.
  function pageAt(pages, t) {
    var at = 0;
    (pages || []).forEach(function (p) { if (p.t <= t) at = p.page; });
    return at;
  }
  // The question being explained at `t` (ms), or null.
  function questionAt(questions, t) {
    var at = null;
    (questions || []).forEach(function (q) { if (q.t <= t) at = q; });
    return at;
  }
  // The chapter playing at `t` (ms): its index in `chapters`, or -1.
  function chapterAt(chapters, t) {
    var at = -1;
    (chapters || []).forEach(function (c, i) { if (c.t <= t + 250) at = i; });
    return at;
  }
  // "Q3 · page 2" — what the player says is on screen now.
  function nowText(marks, t) {
    if (!marks) return '';
    var q = questionAt(marks.questions, t), p = pageAt(marks.pages, t);
    if (q && p && q.page && q.page !== p) q = null;  // turned to another page since
    var parts = [];
    if (q) parts.push(q.label);
    if (p) parts.push('page ' + p);
    return parts.join(' · ');
  }
  // Where a mark sits along a bar, as a percentage.
  function percentAt(t, durationMs) {
    if (!(durationMs > 0)) return 0;
    return Math.max(0, Math.min(100, (t / durationMs) * 100));
  }
  /* Marks that would print on top of each other along a bar `widthPx` wide
     are thinned for the LABELS only (every mark keeps its tick): a label
     needs `labelPx` of room. */
  function labelled(marks, durationMs, widthPx, labelPx) {
    var room = Math.max(1, num(labelPx, 28));
    var w = Math.max(1, num(widthPx, 600));
    var lastX = -Infinity;
    return (marks || []).map(function (m) {
      var x = percentAt(m.t, durationMs) / 100 * w;
      var show = x - lastX >= room;
      if (show) lastX = x;
      return show;
    });
  }

  /* ================= Every lesson as one strip =================
     The strip above the player shows all the worksheet's lessons side by
     side, each as wide as it is long: where you are in the whole set. */
  function strip(lessons, knownMs) {
    var list = lessons || [];
    var lens = list.map(function (l, i) {
      var k = knownMs && knownMs[i];
      return k > 0 ? k : (l.durationMs > 0 ? l.durationMs : 60000);
    });
    var total = lens.reduce(function (a, b) { return a + b; }, 0) || 1;
    var at = 0;
    return list.map(function (l, i) {
      var seg = { index: i, start: at, length: lens[i], left: at / total * 100, width: lens[i] / total * 100 };
      at += lens[i];
      return seg;
    });
  }

  /* ================= Replaying the writing =================
     A lenient copy of Ans Key's LessonReplayCore player: the same events
     (upsert, append, remove, order, view), applied in order. Anything this
     page cannot use is skipped, never fatal — a student would rather see
     most of the writing than none of it. */
  var DRAWN = ['pen', 'highlight', 'rect', 'ellipse', 'line', 'arrow', 'text'];
  function copyAnn(a) {
    var out = {};
    Object.keys(a).forEach(function (k) {
      if (k === 'points') out.points = Array.isArray(a.points) ? a.points.map(function (p) { return { x: num(p && p.x, 0), y: num(p && p.y, 0) }; }) : [];
      else if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') out[k] = a[k];
    });
    return out;
  }
  function createReplay(timeline) {
    var initial = timeline && timeline.initial ? timeline.initial : {};
    var events = timeline && Array.isArray(timeline.events) ? timeline.events : [];
    var duration = Math.max(0, num(timeline && timeline.duration, 0));
    var base = (Array.isArray(initial.annotations) ? initial.annotations : []).filter(function (a) {
      return a && typeof a === 'object' && typeof a.id === 'string';
    });
    var baseView = initial.view && typeof initial.view === 'object' ? initial.view : { page: 1, x: 0, y: 0, zoom: 1 };
    var map, order, view, cursor, last, revision;
    function reset() {
      map = {}; order = [];
      base.forEach(function (a) { if (!map[a.id]) order.push(a.id); map[a.id] = copyAnn(a); });
      view = { page: Math.max(1, Math.floor(num(baseView.page, 1))), x: num(baseView.x, 0), y: num(baseView.y, 0), zoom: num(baseView.zoom, 1) };
      cursor = 0; last = -1; revision = 0;
    }
    function apply(e) {
      if (!e || typeof e !== 'object') return;
      if (e.type === 'upsert' && e.annotation && typeof e.annotation.id === 'string') {
        if (!map[e.annotation.id]) order.push(e.annotation.id);
        map[e.annotation.id] = copyAnn(e.annotation);
      } else if (e.type === 'append' && typeof e.id === 'string' && map[e.id] && Array.isArray(e.points)) {
        var a = map[e.id];
        if (!Array.isArray(a.points)) a.points = [];
        e.points.forEach(function (p) { if (p) a.points.push({ x: num(p.x, 0), y: num(p.y, 0) }); });
      } else if (e.type === 'remove' && typeof e.id === 'string' && map[e.id]) {
        delete map[e.id];
        var i = order.indexOf(e.id);
        if (i >= 0) order.splice(i, 1);
      } else if (e.type === 'order' && Array.isArray(e.ids)) {
        var next = e.ids.filter(function (id) { return map[id]; });
        order.forEach(function (id) { if (next.indexOf(id) < 0) next.push(id); });
        order = next;
      } else if (e.type === 'view' && e.view && typeof e.view === 'object') {
        var p = Math.floor(num(e.view.page, 0));
        if (p >= 1) view = { page: p, x: num(e.view.x, view.x), y: num(e.view.y, view.y), zoom: num(e.view.zoom, view.zoom) };
        return;
      } else return;
      revision++;
    }
    reset();
    return {
      duration: duration,
      // The writing and the view at `t` (ms). Going back starts again from
      // the beginning; going forward only applies what is new.
      stateAt: function (t) {
        t = Math.max(0, Math.min(duration || Infinity, num(t, 0)));
        if (t < last) reset();
        while (cursor < events.length && num(events[cursor].t, 0) <= t) apply(events[cursor++]);
        last = t;
        return {
          time: t,
          view: { page: view.page, x: view.x, y: view.y, zoom: view.zoom },
          revision: revision,
          annotations: order.map(function (id) { return map[id]; }).filter(function (a) { return a && DRAWN.indexOf(a.type) >= 0; })
        };
      }
    };
  }
  // Only what is on `page`, drawn in order.
  function onPage(annotations, page) {
    return (annotations || []).filter(function (a) { return a && Math.floor(num(a.page, 0)) === page; });
  }
  // A colour Ans Key could have written, or the ink default.
  function safeColor(c) {
    var s = str(c);
    return /^#[0-9a-f]{3,8}$/i.test(s) || /^rgba?\([\d\s.,%]+\)$/i.test(s) || /^[a-z]{3,20}$/i.test(s) ? s : '#1A1A1A';
  }
  // The two barbs of an arrowhead at (x2, y2), in page units.
  function arrowHead(x1, y1, x2, y2, size) {
    var ang = Math.atan2(y2 - y1, x2 - x1), s = Math.max(6, size || 12), spread = Math.PI / 7;
    return [
      { x: x2 - s * Math.cos(ang - spread), y: y2 - s * Math.sin(ang - spread) },
      { x: x2 - s * Math.cos(ang + spread), y: y2 - s * Math.sin(ang + spread) }
    ];
  }

  /* ================= Links and the remembered spot ================= */
  // The watch page's address, from the portal (same folder).
  function watchLink(wsId, opts) {
    if (!WS_RE.test(str(wsId))) return '';
    opts = opts || {};
    var url = 'watch.html?ws=' + encodeURIComponent(wsId);
    if (opts.day && DAY_RE.test(opts.day)) url += '&day=' + encodeURIComponent(opts.day);
    if (opts.rec && REC_RE.test(str(opts.rec))) url += '&rec=' + encodeURIComponent(opts.rec);
    if (opts.t > 0) url += '&t=' + Math.floor(opts.t);
    if (opts.course && WS_RE.test(str(opts.course))) url += '&c=' + encodeURIComponent(opts.course);
    return url;
  }
  // The page's own query: { ws, day, rec, t, course } — anything malformed is dropped.
  function readQuery(search) {
    var q;
    try { q = new URLSearchParams(str(search)); } catch (e) { q = { get: function () { return null; } }; }
    var ws = str(q.get('ws')), day = str(q.get('day')), rec = str(q.get('rec')), c = str(q.get('c'));
    var t = Math.floor(num(q.get('t'), 0));
    return {
      ws: WS_RE.test(ws) ? ws : '',
      day: DAY_RE.test(day) ? day : '',
      rec: REC_RE.test(rec) ? rec : '',
      t: t > 0 && t < MS_MAX / 1000 ? t : 0,
      course: /^[A-Za-z0-9_-]{1,128}$/.test(c) ? c : ''
    };
  }
  // "Where was I" on this device: { rec, t } per worksheet, kept small.
  function spotKey(wsId) { return 'polymath.watch.' + str(wsId); }
  function readSpot(raw, lessons) {
    var s;
    try { s = JSON.parse(str(raw)); } catch (e) { return null; }
    if (!s || typeof s !== 'object' || !REC_RE.test(str(s.rec))) return null;
    var hit = (lessons || []).filter(function (l) { return l.id === s.rec; })[0];
    if (!hit) return null;
    var t = num(s.t, 0);
    // Near the end counts as watched: start that one again from the top.
    if (!(t > 5) || (hit.durationMs && t * 1000 > hit.durationMs - 15000)) t = 0;
    return { rec: hit.id, index: hit.index, t: t };
  }

  /* ================= Who may watch =================
     The admins watch anything. Anyone else watches a worksheet that is
     released in one of the classes they see in Polymath Online — the same
     rule as the class timeline, so the page never shows more than it. */
  var RELEASE_AHEAD = 3;   // on worksheet n, students have up to n + 3
  function releasedTo(courses, wsId) {
    var out = [];
    (courses || []).forEach(function (c) {
      var ids = c && Array.isArray(c.worksheetIds) ? c.worksheetIds : [];
      var rel = c && typeof c.releasedThrough === 'number' && isFinite(c.releasedThrough) ? Math.floor(c.releasedThrough) : -1;
      // v1.12.0: a class is always RELEASE_AHEAD worksheets ahead of the one
      // it is on (portal-core.js `releasedThrough`, the same rule). ⏰ v1.15.0:
      // the page hands in each class as it stands now (Core.courseNow).
      var cur = c && typeof c.currentIndex === 'number' && isFinite(c.currentIndex) ? Math.floor(c.currentIndex) : -1;
      if (cur >= 0) rel = Math.max(rel, cur + RELEASE_AHEAD);
      var at = ids.indexOf(wsId);
      // 🗄 v1.13.0: a worksheet archived in a class is not shown from it.
      var archived = c && Array.isArray(c.archivedWorksheets) && c.archivedWorksheets.indexOf(wsId) >= 0;
      if (at >= 0 && at <= rel && !archived) out.push({ course: c, seq: at });
    });
    return out;
  }
  // 🗄 The class days of a worksheet archived in one class: ['YYYY-MM-DD'].
  // The same reading as portal-core.js `archivedDaysOf`.
  function archivedDaysIn(course, wsId) {
    var list = course && Array.isArray(course.archivedDays) ? course.archivedDays : [];
    var out = [];
    list.forEach(function (entry) {
      if (typeof entry !== 'string') return;
      var at = entry.lastIndexOf('|');
      if (at <= 0 || entry.slice(0, at) !== wsId) return;
      var key = entry.slice(at + 1);
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && out.indexOf(key) < 0) out.push(key);
    });
    return out;
  }
  // The worksheet's place in the class it is watched from, for the header.
  function placeText(found, total) {
    if (!found) return '';
    var t = total || (found.course && Array.isArray(found.course.worksheetIds) ? found.course.worksheetIds.length : 0);
    return 'Worksheet ' + (found.seq + 1) + (t ? ' of ' + t : '');
  }

  /* ================= Captions ================= */
  function vttTime(ms) {
    ms = Math.max(0, Math.round(ms));
    var h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s) + '.' + ('00' + r).slice(-3);
  }
  // Ans Key's caption file ({ cues: [{ t, s, e }] }, milliseconds) as WebVTT.
  function captionsVtt(data, maxCues) {
    var list = data && Array.isArray(data.cues) ? data.cues : [];
    var max = maxCues || 20000, last = -1, out = ['WEBVTT', ''], n = 0;
    for (var i = 0; i < list.length && n < max; i++) {
      var c = list[i];
      if (!c || typeof c.t !== 'string' || typeof c.s !== 'number' || typeof c.e !== 'number') continue;
      if (!isFinite(c.s) || !isFinite(c.e) || c.s < 0 || c.e <= c.s || c.s < last) continue;
      var t = c.t.replace(/[\u0000-\u001f]+/g, ' ').replace(/-->/g, '→').trim().slice(0, 300);
      if (!t) continue;
      out.push(vttTime(c.s) + ' --> ' + vttTime(c.e), t, '');
      last = c.s; n++;
    }
    return n ? out.join('\n') : '';
  }

  var api = {
    VERSION: VERSION, SPEEDS: SPEEDS, PAGE_DWELL_MS: PAGE_DWELL_MS,
    formatTime: formatTime, formatDay: formatDay, formatClock: formatClock, dayKey: dayKey,
    storageUrlOk: storageUrlOk, parseAnnotations: parseAnnotations, lessonFrom: lessonFrom, lessonsOf: lessonsOf,
    lessonName: lessonName, totalSeconds: totalSeconds, startIndex: startIndex, nextIndex: nextIndex, prevIndex: prevIndex,
    questionNumber: questionNumber, questionMarks: questionMarks, pageMarks: pageMarks, marksOf: marksOf, emptyMarks: emptyMarks,
    pageAt: pageAt, questionAt: questionAt, chapterAt: chapterAt, nowText: nowText, percentAt: percentAt, labelled: labelled,
    strip: strip, createReplay: createReplay, onPage: onPage, safeColor: safeColor, arrowHead: arrowHead,
    watchLink: watchLink, readQuery: readQuery, spotKey: spotKey, readSpot: readSpot,
    releasedTo: releasedTo, archivedDaysIn: archivedDaysIn, placeText: placeText, captionsVtt: captionsVtt
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PolymathWatchCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
