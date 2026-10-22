/* =====================================================================
   📝 CONSULT ANSWER — the teacher answers a question a student LEFT,
   with a recorded video, in Study Buddy, Ans Key, the Science portal and
   the Maths portal alike (v1.65.0 Study Buddy, v1.151.0 Ans Key; the two
   portals since v1.445.0 Science and v1.106.0 Maths).

   THIS FILE IS BYTE FOR BYTE THE SAME IN polymathlc/tutor,
   polymathlc/anskey, polymathlc/cer AND polymathlc/math. Each
   repository's test compares its copy with every sibling checked out
   beside it; a fix in any of them copies straight across rather than
   being re-derived.

   🌐 Study Buddy and Ans Key run the COMPAT Firebase SDK and this file
   reads their globals (`db`, `storage`, `currentUser`, `isAdmin`,
   `toast`). The two portals run the MODULAR SDK, so they set
   `window.ConsultEnv` first and this file reads EVERYTHING through it —
   who is signed in, whether they are the teacher, the database (wrapped
   into the compat shape by consult-bridge.js), the toast. With a
   ConsultEnv the page's own globals are never consulted: a portal's
   `isAdmin` or `openWorksheet` means something else there.

   How a question gets here:

   ① A student presses 🙋 Consult. If the teacher is away — or is here
     but busy and presses "Not now — ask for a question" on the pop-up
     (`askLater`, status `later`) — the student's panel in Study Buddy
     asks them to tap the page, or drag a box round the part, and type
     or SAY what they want to ask. That goes up as status `question`
     with `question: { text, page, ws, box, at }` on the consult and the
     picture of the page, box drawn on it, at `frames/question`.
   ② The teacher's pop-up (here, and in Ans Key) shows "📝 … left a
     question". Answer opens THIS window (`open`): the question, the
     picture, three pens, the camera, the microphone. ⏺ records the
     picture with the teacher's writing appearing on it as it is drawn,
     the camera in the corner and the voice — one file.
   ③ Send uploads it to the one folder the shared rules guard
     (`pdf-annotator/lesson-consult-*`, readable by anybody, writable
     only by the verified teacher), then writes `status: 'answered'`
     and `reply: { url, path, mime, ms, note, at }` in ONE transaction.
     The student's Study Buddy picks it up and plays it.
   ④ 📚 Nothing is lost afterwards (v1.66.0 / v1.152.0). `openLog` is the
     teacher's list of EVERY call and question — waiting, missed, talked,
     answered — with Join, 📝 Answer and ▶ Watch on the row; `openLibrary`
     is the student's shelf of every answer they have been sent. Both are
     LIVE queries that come down when the window closes; the only write
     either makes is the student's own `replySeen` when they press ▶ —
     and the teacher's 🗑 Delete (v1.68.0 Study Buddy, v1.154.0 Ans Key),
     asked twice on the row itself, which takes the consult, its ink, its
     pictures and its video answer out of the cloud for good
     (`deleteConsult`).

   The rules this file keeps:

   - IT IS THE TEACHER'S ALONE, ASKED IN EVERY HANDLER (`teacherHere`):
     the window, ⏺, Send and `askLater` all ask, because a hidden
     button has never been the lock.
   - NOTHING HERE WRITES `annotations`. The writing lives on this
     window's own canvas and goes into the video, nowhere else — the
     rule the live consult's ink already carries.
   - NO `getDisplayMedia(`. The video is a canvas this window draws,
     so nothing else on the teacher's screen is ever recorded.
   - THE CAMERA IS NEVER MIRRORED IN THE FILE; only the live preview is.
   - EVERY WORD A STUDENT WROTE IS PAINTED WITH textContent.
   - A REPLY LINK IS A FIREBASE STORAGE LINK OR NOTHING (`replyUrlOk`):
     it ends up in a <video src> on a child's screen, and a consult is a
     document another client can write.
   - THE FILES GO IN `pdf-annotator/` FIRST; `tutor-worksheets/` is
     tried only on a REFUSAL by the rules — a dropped network is a
     retry, never a different folder.
   - THE WRITE IS A TRANSACTION THAT RE-READS: a consult the student
     cancelled while the teacher was recording is not answered over.
   - THE CAMERA AND THE MICROPHONE COME DOWN on close, on Escape, on
     pagehide and on an account change (`stop`), every time.
   ===================================================================== */
(function (global) {
  'use strict';

  var COLLECTION = 'tutorConsults';
  var QUESTION_MAX = 500;
  var NOTE_MAX = 300;
  var NAME_MAX = 60;
  var TITLE_MAX = 120;
  var QUESTION_FRESH_MS = 14 * 24 * 60 * 60 * 1000;
  var REC_MAX_MS = 10 * 60 * 1000;
  var REC_SLACK_MS = 1500;
  var STAGE_LONG = 1280;
  var VIDEO_BPS = 2500000;
  var AUDIO_BPS = 96000;
  var STROKE_W = 4;
  var PIP_SHARE = 0.24;
  var PIP_GAP = 0.022;
  var DIRS = ['pdf-annotator', 'tutor-worksheets'];
  var URL_PREFIX = 'https://firebasestorage.googleapis.com/';
  // 📚 The archive. A call rings by Study Buddy's own rule (WAIT_FRESH_MS /
  // SEEN_FRESH_MS there); a Join opens Study Buddy's room by its own link.
  var CALL_FRESH_MS = 30 * 60 * 1000;
  var CALL_SEEN_MS = 2 * 60 * 1000;
  var LOG_MAX = 300;
  var JOIN_BASE = 'https://polymathlc.github.io/tutor/';
  var LOG_LABELS = {
    ringing: 'Calling now', live: 'In a call', later: 'Asked to leave a question',
    question: 'Question waiting', answered: 'Answered', watched: 'Answered · watched',
    talked: 'Talked on a call', missed: 'Missed call', cancelled: 'Cancelled', other: 'Consult'
  };
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PENS = [
    { key: 'red', name: 'Red', c: '#E5484D' },
    { key: 'blue', name: 'Blue', c: '#2563EB' },
    { key: 'black', name: 'Black', c: '#111827' }
  ];
  var MIMES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  /* ===================================================================
     The pure half — no DOM, no Firebase. The harness runs these alone.
     =================================================================== */
  function consultIdOk(id) { return typeof id === 'string' && /^[A-Za-z0-9]{12,40}$/.test(id); }
  function consultLink(id) { return consultIdOk(id) ? JOIN_BASE + '?consult=' + encodeURIComponent(id) : ''; }
  function cleanText(s, max) {
    if (typeof s !== 'string') return '';
    var t = s.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max).trim() : t;
  }
  function cleanLong(s, max) {
    // A question may run over several lines; keep the line breaks, fold the rest.
    if (typeof s !== 'string') return '';
    var t = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]+/g, ' ');
    t = t.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).join('\n');
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    return t.length > max ? t.slice(0, max).trim() : t;
  }
  function stampMs(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v instanceof Date) { var t = v.getTime(); return isFinite(t) ? t : 0; }
    if (typeof v.toMillis === 'function') { try { var m = v.toMillis(); return isFinite(m) ? m : 0; } catch (e) { return 0; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6);
    return 0;
  }
  function subjectWord(s) {
    if (s === 'math') return 'Maths';
    if (s === 'science') return 'Science';
    if (s === 'both') return 'Maths & Science';
    return '';
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  // A box is [x0, y0, x1, y1] in 0..1 of the PAGE, corners in order, and
  // big enough to mean something. Anything else is "the whole page".
  function cleanQBox(b) {
    if (!Array.isArray(b) || b.length !== 4) return null;
    for (var i = 0; i < 4; i++) if (typeof b[i] !== 'number' || !isFinite(b[i])) return null;
    var x0 = clamp01(Math.min(b[0], b[2])), x1 = clamp01(Math.max(b[0], b[2]));
    var y0 = clamp01(Math.min(b[1], b[3])), y1 = clamp01(Math.max(b[1], b[3]));
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return null;
    return [round4(x0), round4(y0), round4(x1), round4(y1)];
  }

  function cleanQuestion(q) {
    if (!q || typeof q !== 'object') return null;
    var text = cleanLong(q.text, QUESTION_MAX);
    var page = (typeof q.page === 'number' && isFinite(q.page) && q.page >= 1 && q.page <= 999) ? Math.round(q.page) : 0;
    var box = cleanQBox(q.box);
    if (!text && !page) return null;
    return { text: text, page: page, ws: cleanText(q.ws, TITLE_MAX), box: box, at: stampMs(q.at) };
  }

  function replyUrlOk(u) {
    return typeof u === 'string' && u.length < 2000 && u.indexOf(URL_PREFIX) === 0 && !/[\s"'<>\\]/.test(u);
  }
  function replyPathOk(p) {
    if (typeof p !== 'string') return false;
    return DIRS.some(function (d) {
      return p.indexOf(d + '/lesson-consult-') === 0 && /^[a-z-]+\/lesson-consult-[A-Za-z0-9]{12,40}-\d{6,16}\.(mp4|webm)$/.test(p);
    });
  }
  function cleanReply(r) {
    if (!r || typeof r !== 'object' || !replyUrlOk(r.url)) return null;
    var mime = typeof r.mime === 'string' && /^video\/(mp4|webm)/.test(r.mime) ? r.mime.split(';')[0] : 'video/webm';
    var ms = (typeof r.ms === 'number' && isFinite(r.ms) && r.ms > 0) ? Math.min(Math.round(r.ms), REC_MAX_MS + 60000) : 0;
    return {
      url: r.url,
      path: replyPathOk(r.path) ? r.path : '',
      mime: mime,
      ms: ms,
      note: cleanLong(r.note, NOTE_MAX),
      at: stampMs(r.at)
    };
  }

  // 🗑 What a delete takes with it, read off the document alone: the
  // consult, the two sub-collections Study Buddy writes under it (`ink`, the
  // teacher's strokes; `frames`, the page pictures) and the video answer in
  // Storage. Only a path `replyPathOk` accepts is ever handed to Storage, so a
  // consult another client wrote cannot point the delete at somebody else's
  // file. A call that is still open is NOT refused — a room that crashed
  // leaves `live` behind for ever, and an entry that can never be deleted is
  // the one thing this button exists to clear — but the question it asks
  // says the student's call ends with it (`deleteAsk`).
  var DELETE_SUBS = ['ink', 'frames'];
  function deletePlan(id, d) {
    if (!consultIdOk(id)) return null;
    var data = d && typeof d === 'object' ? d : {};
    var files = [];
    var r = data.reply;
    if (r && typeof r === 'object' && replyPathOk(r.path)) files.push(r.path);
    return { id: id, subs: DELETE_SUBS.slice(), files: files };
  }
  // The words on the row while it asks. A reader acts on these, so they say
  // exactly what goes: the entry for everyone, and the video when there is one.
  function deleteAsk(row) {
    var r = row || {};
    var what = 'Delete this consult for good?';
    if (r.state === 'ringing' || r.state === 'live') return what + ' The call is still open — it ends for ' + (r.who || 'the student') + ' too.';
    if (r.reply) return what + ' The video answer goes too, and ' + (r.who || 'the student') + ' can no longer watch it.';
    return what + ' It cannot be undone.';
  }
  function extFor(mime) { return /mp4/i.test(mime || '') ? 'mp4' : 'webm'; }
  function storagePath(dir, id, ts, mime) {
    if (DIRS.indexOf(dir) < 0 || !consultIdOk(id)) return '';
    var t = Math.max(0, Math.round(Number(ts) || 0));
    return dir + '/lesson-consult-' + id + '-' + String(t).padStart(6, '0') + '.' + extFor(mime);
  }
  function pickMime(isOk) {
    var test = typeof isOk === 'function' ? isOk : function () { return false; };
    for (var i = 0; i < MIMES.length; i++) {
      try { if (test(MIMES[i])) return MIMES[i]; } catch (e) {}
    }
    return '';
  }
  // The largest w × h of the given ratio inside maxW × maxH.
  function fit(srcW, srcH, maxW, maxH) {
    if (!(srcW > 0) || !(srcH > 0) || !(maxW > 0) || !(maxH > 0)) return { w: 0, h: 0 };
    var s = Math.min(maxW / srcW, maxH / srcH);
    return { w: Math.max(1, Math.floor(srcW * s)), h: Math.max(1, Math.floor(srcH * s)) };
  }
  // The recording canvas: the picture's own shape, long side STAGE_LONG,
  // and even sides (an encoder refuses an odd one).
  function stageSize(srcW, srcH) {
    var f = fit(srcW || 4, srcH || 3, STAGE_LONG, STAGE_LONG);
    return { w: Math.max(2, f.w - (f.w % 2)), h: Math.max(2, f.h - (f.h % 2)) };
  }
  function pipRect(W, H, camW, camH) {
    if (!(W > 0) || !(H > 0) || !(camW > 0) || !(camH > 0)) return null;
    var w = Math.round(Math.min(W, H) * PIP_SHARE * (camW >= camH ? 1.25 : 1));
    var h = Math.round(w * camH / camW);
    var gap = Math.round(Math.min(W, H) * PIP_GAP);
    return { x: W - w - gap, y: H - h - gap, w: w, h: h };
  }
  function fmtClock(ms) {
    var s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function questionFresh(d, t) {
    if (!d || d.status !== 'question') return false;
    var q = d.question || {};
    var at = stampMs(q.at) || stampMs(d.at);
    if (!at) return false;
    var nowMs = typeof t === 'number' ? t : Date.now();
    return nowMs - at < QUESTION_FRESH_MS && at - nowMs < 5 * 60 * 1000;
  }
  function questionWords(d) {
    var who = cleanText(d && d.studentName, NAME_MAX) || 'A student';
    var q = cleanQuestion(d && d.question);
    var bits = [];
    // q.ws is the worksheet's ID (what "Open the worksheet" opens); the
    // NAME is on the consult itself, which sendQuestion re-points at the
    // worksheet the question was asked on.
    var ws = cleanText(d && d.worksheetName, TITLE_MAX);
    if (ws) bits.push(ws);
    if (q && q.page) bits.push('page ' + q.page + (q.box ? ' (a part of it)' : ''));
    var subj = [cleanText(d && d.level, 12), subjectWord(d && d.subject)].filter(Boolean).join(' ');
    if (subj) bits.push(subj);
    return { who: who, title: who + ' left a question', where: bits.join(' · '), text: q ? q.text : '' };
  }
  // How long ago a question was left, in words. A question waits for up
  // to QUESTION_FRESH_MS (two weeks), so this has to go past hours: "35
  // hours ago" is a number nobody reads as "yesterday". A stamp a little
  // in the future (another device's clock) is "just now", never "-3 min".
  function questionAgo(ms) {
    var v = Number(ms);
    if (!isFinite(v) || v < 60000) return 'just now';
    var min = Math.floor(v / 60000);
    if (min < 60) return min === 1 ? '1 min ago' : min + ' min ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr === 1 ? '1 hour ago' : hr + ' hours ago';
    var day = Math.floor(hr / 24);
    if (day < 2) return 'yesterday';
    return day + ' days ago';
  }
  // What "✋ Not now" says, by what the transaction found. "That call has
  // already ended" was said for every status but `waiting`, which was
  // wrong four times out of five: a call another screen has just opened,
  // a student already asked, a question already left and a question
  // already answered are four different things to be told, and only one
  // of them means the student has gone.
  function laterSaid(outcome) {
    switch (outcome) {
      case 'ok': return 'Asked them to show you the question — it will come to you here to answer.';
      case 'live': return 'That call is already open on another screen — join it there, or end it first.';
      case 'later': return 'They have already been asked to show you the question.';
      case 'question': return 'They have already left their question — it is in your list to answer.';
      case 'answered': return 'That question has already been answered.';
      case 'offline': return 'Not connected yet — try again in a moment.';
      case 'failed': return 'Could not reach them just now — try again.';
      default: return 'That call has already ended.';
    }
  }
  // A stroke the pens drew: a colour off the list, a width in canvas
  // thousandths, and points in 0..1. The only shape the renderer reads.
  function cleanPenStroke(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.p)) return null;
    var pen = PENS.filter(function (p) { return p.c === s.c; })[0];
    if (!pen) return null;
    var pts = [];
    for (var i = 0; i < s.p.length && pts.length < 4000; i++) {
      var q = s.p[i];
      if (!Array.isArray(q) || typeof q[0] !== 'number' || typeof q[1] !== 'number' || !isFinite(q[0]) || !isFinite(q[1])) continue;
      pts.push([round4(clamp01(q[0])), round4(clamp01(q[1]))]);
    }
    if (!pts.length) return null;
    var w = (typeof s.w === 'number' && s.w >= 1 && s.w <= 20) ? s.w : STROKE_W;
    return { c: pen.c, w: w, p: pts };
  }

  /* ---- 📚 The archive: every consult, kept (v1.66.0 / v1.152.0) ----
     The teacher's list of every call and question, and the student's
     shelf of every answer they have been sent. Both read documents that
     are already there; nothing here invents a status. */
  // A call is "ringing" by exactly the rule the pop-up uses (Study Buddy's
  // consultFresh): asked within half an hour and the student's panel still
  // beating within two minutes. A waiting consult older than that is a call
  // nobody took.
  function callRinging(d, t) {
    if (!d || d.status !== 'waiting') return false;
    var nowMs = typeof t === 'number' ? t : Date.now();
    var at = Math.min(stampMs(d.at), nowMs);
    if (!at) return false;
    var seen = Math.min(stampMs(d.seen) || at, nowMs);
    return nowMs - at < CALL_FRESH_MS && nowMs - seen < CALL_SEEN_MS;
  }
  // ONE word for where a consult stands, read off the document alone.
  function logState(d, t) {
    var s = d && d.status;
    if (s === 'waiting') return callRinging(d, t) ? 'ringing' : 'missed';
    if (s === 'live') return 'live';
    if (s === 'later') return 'later';
    if (s === 'question') return 'question';
    if (s === 'answered') return d.replySeen ? 'watched' : 'answered';
    if (s === 'ended') return d.joinedAt ? 'talked' : 'missed';
    if (s === 'cancelled') return 'cancelled';
    return 'other';
  }
  function logLabel(state) { return LOG_LABELS[state] || 'Consult'; }
  /* 🌐 WHICH APP A CONSULT WAS ASKED IN (v1.69.0 Study Buddy, v1.156.0 Ans
     Key, v1.445.0 Science, v1.106.0 Maths). The four apps write the same
     `tutorConsults` collection, so the teacher's log and the student's
     shelf say where each one came from. `app` rides on the DOCUMENT and is
     never part of the request body (the server reads `{ consultId }` and
     nothing else). A consult with NO `app` is Study Buddy's: until v1.69.0
     it was the only app that could start one, and its own consults still
     carry none. A word this build does not know names nothing rather than
     guessing — the row simply does not say where it was asked. */
  var APP_WORDS = { tutor: 'Study Buddy', anskey: 'Ans Key', cer: 'the Science portal', math: 'the Maths portal' };
  function appKey(app) {
    if (app == null) return 'tutor';
    return typeof app === 'string' && Object.prototype.hasOwnProperty.call(APP_WORDS, app) ? app : '';
  }
  function appWord(app) { var k = appKey(app); return k ? APP_WORDS[k] : ''; }
  function logRow(id, d, t) {
    if (!consultIdOk(id) || !d || typeof d !== 'object') return null;
    var q = cleanQuestion(d.question);
    var state = logState(d, t);
    var reply = (state === 'answered' || state === 'watched') ? cleanReply(d.reply) : null;
    return {
      id: id,
      state: state,
      label: logLabel(state),
      who: cleanText(d.studentName, NAME_MAX) || 'A student',
      ws: cleanText(d.worksheetName, TITLE_MAX),
      wsId: (q && consultIdOk(q.ws) ? q.ws : '') || (consultIdOk(d.worksheetId) ? d.worksheetId : ''),
      subj: [cleanText(d.level, 12), subjectWord(d.subject)].filter(Boolean).join(' '),
      app: appKey(d.app), appWord: appWord(d.app),
      page: q ? q.page : 0,
      text: q ? q.text : '',
      asked: !!q,
      at: stampMs(d.at) || stampMs(d.createdAt),
      answeredAt: reply ? (reply.at || stampMs(d.answeredAt)) : 0,
      reply: reply
    };
  }
  var LOG_FILTERS = {
    todo: ['ringing', 'live', 'later', 'question'],
    answered: ['answered', 'watched'],
    calls: ['ringing', 'live', 'talked', 'missed', 'cancelled', 'later']
  };
  function logSearchWords(s) {
    return cleanText(s, 80).toLowerCase().split(' ').filter(Boolean);
  }
  function logHit(row, words) {
    if (!words.length) return true;
    var hay = [row.who, row.ws, row.text, row.subj, row.label, row.appWord, row.reply && row.reply.note].join(' ').toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) >= 0; });
  }
  // `f` narrows by state and EVERY word searched for has to appear, so a
  // second word narrows rather than widens.
  function logFilter(rows, f, search) {
    var want = LOG_FILTERS[f] || null;
    var words = logSearchWords(search);
    return (rows || []).filter(function (r) {
      return r && (!want || want.indexOf(r.state) >= 0) && logHit(r, words);
    });
  }
  function logCounts(rows) {
    var c = { todo: 0, answered: 0, calls: 0, all: 0 };
    (rows || []).forEach(function (r) {
      if (!r) return;
      c.all++;
      Object.keys(LOG_FILTERS).forEach(function (k) { if (LOG_FILTERS[k].indexOf(r.state) >= 0) c[k]++; });
    });
    return c;
  }
  // What sorts to the top of the teacher's list: what is waiting on them,
  // then everything else newest first.
  function logSort(rows) {
    var rank = { ringing: 0, live: 1, question: 2, later: 3 };
    return (rows || []).slice().sort(function (a, b) {
      var ra = rank[a.state] != null ? rank[a.state] : 9, rb = rank[b.state] != null ? rank[b.state] : 9;
      if (ra !== rb) return ra - rb;
      return (b.at || 0) - (a.at || 0);
    });
  }
  // The student's shelf: every answer with a link that will play, newest
  // answer first, and the questions still waiting for one.
  function libraryRows(docs, t) {
    var answers = [], waiting = [];
    (docs || []).forEach(function (x) {
      var r = x && logRow(x.id, x.data, t);
      if (!r) return;
      if (r.reply) { r.fresh = r.state === 'answered'; answers.push(r); }
      else if (r.state === 'question' || r.state === 'later') waiting.push(r);
    });
    answers.sort(function (a, b) { return (b.answeredAt || b.at || 0) - (a.answeredAt || a.at || 0); });
    waiting.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return { answers: answers, waiting: waiting };
  }
  // When, in words a reader acts on: today and yesterday by name, the last
  // week by weekday, then the date (with the year once it is not this one).
  // A stamp that will not read is EMPTY, never 1 January 1970.
  function whenText(ms, t) {
    var v = Number(ms);
    if (!isFinite(v) || v <= 0) return '';
    var nowMs = typeof t === 'number' ? t : Date.now();
    var d = new Date(v), n = new Date(nowMs);
    var hh = d.getHours(), mm = d.getMinutes();
    var clock = ((hh % 12) || 12) + ':' + (mm < 10 ? '0' : '') + mm + (hh < 12 ? ' am' : ' pm');
    var day0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    var dd0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var days = Math.round((day0 - dd0) / 86400000);
    if (days <= 0) return 'Today ' + clock;
    if (days === 1) return 'Yesterday ' + clock;
    if (days < 7) return WEEKDAYS[d.getDay()] + ' ' + clock;
    var date = d.getDate() + ' ' + MONTHS[d.getMonth()];
    return d.getFullYear() === n.getFullYear() ? date : date + ' ' + d.getFullYear();
  }

  /* ✍️ ASKING FROM THE ARCHIVE WINDOW (v1.69.0 Study Buddy, v1.156.0 Ans Key,
     v1.445.0 Science, v1.106.0 Maths). Study Buddy asks with its own 🙋
     Consult button, on the page the student is working on. Ans Key and the
     two portals have no such page, so the student's window there carries a
     box instead: type the question, add a photo of the work if there is one,
     send. It becomes the SAME kind of consult Study Buddy leaves — status
     `question`, the picture at `frames/question` — so the teacher answers it
     with 📝 Answer from any of the four apps and the email is the same email.
     `askDoc` is the one place that document is shaped. */
  var ASK_APPS = ['anskey', 'cer', 'math'];
  var ASK_IMG_LONG = 1400;
  var ASK_IMG_MAX = 700000;   // a Firestore document dies at a megabyte
  var ASK_SUBJECTS = ['math', 'science', 'both'];
  var ENDPOINT = 'https://us-central1-mathgen--app.cloudfunctions.net/studyBuddyConsult';
  function askAppOk(app) { return typeof app === 'string' && ASK_APPS.indexOf(app) >= 0; }
  function askDoc(o) {
    o = o || {};
    if (!o.uid || typeof o.uid !== 'string' || !askAppOk(o.app)) return null;
    var text = cleanLong(o.text, QUESTION_MAX);
    if (!text) return null;
    var t = typeof o.now === 'number' && isFinite(o.now) ? o.now : Date.now();
    var subject = ASK_SUBJECTS.indexOf(o.subject) >= 0 ? o.subject : '';
    var title = cleanText(o.title, TITLE_MAX);
    return {
      v: 1, status: 'question', app: o.app,
      studentUid: o.uid, studentName: cleanText(o.name, NAME_MAX) || 'A student',
      worksheetId: '', worksheetName: title, level: cleanText(o.level, 12), subject: subject,
      question: { text: text, page: 0, ws: title, box: null, at: t },
      photo: !!o.photo,
      at: t, seen: t, createdAt: o.stamp != null ? o.stamp : t,
      rev: 0, offer: null, answer: null, arev: null, tc: [], sc: []
    };
  }
  // What the student is told after Send, from the server's answer. The
  // question is saved before the email is asked for, so every one of these
  // still means the teacher will see it under 🙋 Consults.
  function askSaid(code, who) {
    who = who || 'Mr Chung';
    switch (code) {
      case 'queued': case 'already': return '📨 Sent — ' + who + ' has been emailed and will answer with a video here.';
      case 'too_soon': return '📨 Saved — ' + who + ' was emailed a moment ago, so this one waits under 🙋 Consults for him.';
      case 'daily_limit': return '📨 Saved — today’s emails are used up, but ' + who + ' will still see it under 🙋 Consults.';
      default: return '📨 Saved — the email did not go out just now, but ' + who + ' will still see it under 🙋 Consults.';
    }
  }
  // The longest side and the JPEG steps a photo is shrunk through until it
  // fits in a Firestore document. Pure, so the harness can check the sizes.
  function askImgSize(w, h, long) {
    long = long || ASK_IMG_LONG;
    w = Number(w) || 0; h = Number(h) || 0;
    if (!(w > 0 && h > 0)) return null;
    var k = Math.min(1, long / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  var ASK_JPEG_STEPS = [0.82, 0.66, 0.5, 0.36];

  var pure = {
    COLLECTION: COLLECTION, QUESTION_MAX: QUESTION_MAX, NOTE_MAX: NOTE_MAX, QUESTION_FRESH_MS: QUESTION_FRESH_MS,
    REC_MAX_MS: REC_MAX_MS, STAGE_LONG: STAGE_LONG, DIRS: DIRS, URL_PREFIX: URL_PREFIX, PENS: PENS, MIMES: MIMES,
    consultIdOk: consultIdOk, cleanText: cleanText, cleanLong: cleanLong, stampMs: stampMs, subjectWord: subjectWord,
    cleanQBox: cleanQBox, cleanQuestion: cleanQuestion, replyUrlOk: replyUrlOk, replyPathOk: replyPathOk,
    cleanReply: cleanReply, extFor: extFor, storagePath: storagePath, pickMime: pickMime, fit: fit,
    stageSize: stageSize, pipRect: pipRect, fmtClock: fmtClock, questionFresh: questionFresh,
    questionWords: questionWords, questionAgo: questionAgo, cleanPenStroke: cleanPenStroke,
    laterSaid: laterSaid,
    CALL_FRESH_MS: CALL_FRESH_MS, CALL_SEEN_MS: CALL_SEEN_MS, LOG_MAX: LOG_MAX, LOG_FILTERS: LOG_FILTERS,
    callRinging: callRinging, logState: logState, logLabel: logLabel, logRow: logRow, logFilter: logFilter,
    logCounts: logCounts, logSort: logSort, libraryRows: libraryRows, whenText: whenText, consultLink: consultLink,
    DELETE_SUBS: DELETE_SUBS, deletePlan: deletePlan, deleteAsk: deleteAsk,
    APP_WORDS: APP_WORDS, appKey: appKey, appWord: appWord,
    ASK_APPS: ASK_APPS, ASK_IMG_LONG: ASK_IMG_LONG, ASK_IMG_MAX: ASK_IMG_MAX, ASK_JPEG_STEPS: ASK_JPEG_STEPS, ENDPOINT: ENDPOINT,
    askAppOk: askAppOk, askDoc: askDoc, askSaid: askSaid, askImgSize: askImgSize
  };

  if (!global.document) { global.ConsultAnswer = { pure: pure }; return; }

  /* ===================================================================
     The app around this file — read lazily, so the harness can load the
     pure half with none of it present.

     🌐 A HOST ON THE MODULAR SDK SAYS SO THROUGH `window.ConsultEnv`
     (v1.69.0 Study Buddy, v1.156.0 Ans Key, v1.445.0 Science, v1.106.0
     Maths). Study Buddy and Ans Key run the compat SDK and hand this file
     `currentUser` / `db` / `storage` / `firebase` as plain globals, which
     is what every accessor below reads when there is no ConsultEnv — so
     those two apps are byte for byte what they were. The Science portal
     and the Maths portal run the MODULAR SDK, so they set ConsultEnv
     instead: `user`, `isTeacher`, `db`, `storage`, `serverStamp`, `toast`,
     `teacherName`, `openWorksheet`, `usageNote`, every one optional, and
     `db` / `storage` are ConsultBridge's compat-shaped wrappers over the
     modular functions (consult-bridge.js).

     WHO IS THE TEACHER IS DECIDED BY THE HOST AND NOBODY ELSE. With a
     ConsultEnv present `teacherHere()` is `isTeacher() === true` and
     nothing more — it does NOT fall back to an `isAdmin` it happens to
     find, because a portal's own `isAdmin` means "any admin of that
     portal", which is a wider set of people than the one teacher who
     answers consults. A host that forgets `isTeacher`, or one that throws,
     is a host with no teacher in it: the safe way round, because every
     teacher handler here refuses on it.

     `openWorksheet` and `usageNote` are the same rule from the other side:
     with a ConsultEnv present ONLY the host's own versions are used. A
     global of that name in a portal is that portal's own function, about
     that portal's own worksheets, and handing it a Study Buddy worksheet id
     opens the wrong thing or nothing at all.
     =================================================================== */
  function hostEnv() {
    try { var E = global.ConsultEnv; return E && typeof E === 'object' ? E : null; } catch (e) { return null; }
  }
  function envFn(k) {
    var E = hostEnv();
    var f;
    try { f = E ? E[k] : undefined; } catch (e) { f = undefined; }
    return typeof f === 'function' ? f : null;
  }
  function user() {
    var f = envFn('user');
    if (f) { try { return f() || null; } catch (e) { return null; } }
    return global.currentUser || null;
  }
  function teacherHere() {
    if (hostEnv()) {
      var f = envFn('isTeacher');
      if (!f) return false;
      try { return f() === true; } catch (e) { return false; }
    }
    var u = user();
    try {
      if (!u || typeof global.isAdmin !== 'function' || !global.isAdmin(u)) return false;
      if (global.actingStudent) return false;
      if (global.CentreAdmin && global.CentreAdmin.isPractice && global.CentreAdmin.isPractice()) return false;
      return true;
    } catch (e) { return false; }
  }
  function teacherName() {
    var f = envFn('teacherName');
    if (f) { try { var n = cleanText(f(), NAME_MAX); if (n) return n; } catch (e) {} }
    try { if (typeof global.setterName === 'function') return global.setterName() || 'Mr Chung'; } catch (e) {}
    return 'Mr Chung';
  }
  function db() {
    var f = envFn('db');
    if (f) { try { return f() || null; } catch (e) { return null; } }
    return global.db || null;
  }
  function store() {
    var f = envFn('storage');
    if (f) { try { return f() || null; } catch (e) { return null; } }
    return global.storage || null;
  }
  function fv() { try { return global.firebase && global.firebase.firestore && global.firebase.firestore.FieldValue || null; } catch (e) { return null; } }
  function serverStamp() {
    var f = envFn('serverStamp');
    if (f) { try { var s = f(); if (s != null) return s; } catch (e) {} return Date.now(); }
    var F = fv(); return F && F.serverTimestamp ? F.serverTimestamp() : Date.now();
  }
  function ref(id) { var d = db(); return d && consultIdOk(id) ? d.collection(COLLECTION).doc(id) : null; }
  function toast(msg, ms) {
    var f = envFn('toast');
    if (f) { try { f(msg, ms || 5000); } catch (e) {} return; }
    try { if (typeof global.toast === 'function') global.toast(msg, ms || 5000); } catch (e) {}
  }
  /* A usage line, and opening a worksheet: the host's own when it has a
     ConsultEnv, the page's globals when it does not — never a portal's
     global of the same name (see above). */
  function usage(key, detail) {
    var f = hostEnv() ? envFn('usageNote') : (typeof global.usageNote === 'function' ? global.usageNote : null);
    if (!f) return;
    try { f(key, detail); } catch (e) {}
  }
  function worksheetOpener() {
    if (hostEnv()) return envFn('openWorksheet');
    return typeof global.openWorksheet === 'function' ? global.openWorksheet : null;
  }
  function el(tag, cls, text) {
    var n = global.document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(text, cls, onClick, title) {
    var b = el('button', 'btn btnSm' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.addEventListener('click', onClick);
    return b;
  }

  /* ===================================================================
     "Not now — ask for a question": the teacher is here but cannot take
     the call. The student's panel sees `later` and asks for the page.
     =================================================================== */
  // One press at a time per consult: a double-tap on "Not now" must not
  // run two transactions, the second of which would then toast "they have
  // already been asked" over the first one's success.
  var laterBusy = {};

  async function askLater(id) {
    if (!teacherHere()) { toast('Only the teacher can do that.'); return false; }
    if (!consultIdOk(id)) return false;
    if (laterBusy[id]) return false;
    var r = ref(id), d = db();
    if (!r || !d || typeof d.runTransaction !== 'function') { toast(laterSaid('offline'), 4500); return false; }
    laterBusy[id] = true;
    var outcome = 'failed';
    try {
      outcome = await d.runTransaction(async function (tx) {
        var snap = await tx.get(r);
        if (!snap.exists) return 'gone';
        var x = snap.data() || {};
        // Only a call that is still RINGING can be turned into a question.
        // A call already open (`live`) belongs to whoever opened it, and
        // writing `later` over it would cut that call off mid-sentence.
        if (x.status !== 'waiting') return typeof x.status === 'string' ? x.status : 'gone';
        tx.update(r, { status: 'later', laterAt: serverStamp(), offer: null, answer: null, tc: [], sc: [] });
        return 'ok';
      });
    } catch (e) {
      console.warn('consult: "not now" could not be written', e);
      outcome = 'failed';
    } finally {
      delete laterBusy[id];
    }
    toast(laterSaid(outcome), outcome === 'ok' ? 5000 : 4500);
    return outcome === 'ok';
  }

  /* ===================================================================
     The answer window.
     =================================================================== */
  var A = null;  // the open window's state, or null

  function blank() {
    return {
      id: '', ref: null, data: null, gen: 0,
      root: null, stageWrap: null, canvas: null, ctx: null,
      img: null, W: 0, H: 0,
      strokes: [], cur: null, pen: PENS[0].c, drawing: false, pointerId: null,
      cam: null, camOn: false, camVideo: null, mic: null,
      rec: null, recStream: null, chunks: [], recMime: '', recStart: 0, recMs: 0, recTimer: 0,
      blob: null, blobUrl: '', raf: 0, busy: false, sent: false,
      els: {}
    };
  }

  async function open(id) {
    if (!teacherHere()) { toast('Only the teacher can answer a question.'); return false; }
    if (!consultIdOk(id)) { toast('That question link is not valid.'); return false; }
    // The same question pressed again (its card, the email's link, Ans Key's
    // pop-up) is the window already open: bring it forward rather than
    // closing it and opening it again, which would throw away whatever is
    // half recorded in it.
    if (A && A.id === id) {
      try { if (A.root && typeof A.root.focus === 'function') A.root.focus(); } catch (e) {}
      return true;
    }
    // Another question is open. Closing it may be DECLINED — there is a
    // recording in it nobody has sent — and then this one must not open over
    // it: the old window would be orphaned on the page with its camera still
    // running and nothing left holding it.
    if (A) {
      close();
      if (A) return false;
    }
    var r = ref(id);
    if (!r) { toast('Not connected yet — try again in a moment.'); return false; }
    var s = blank();
    s.id = id; s.ref = r; s.gen = Date.now();
    A = s;
    var snap = null, frame = null;
    try {
      snap = await r.get();
      if (A !== s) return false;
      if (!snap.exists) { toast('That question has been taken away.'); A = null; return false; }
      try { frame = await r.collection('frames').doc('question').get(); } catch (e) { frame = null; }
      if (A !== s) return false;
    } catch (e) {
      if (A === s) A = null;
      toast('Could not open that question — try again.');
      return false;
    }
    s.data = snap.data() || {};
    if (['question', 'answered'].indexOf(s.data.status) < 0) {
      A = null;
      toast('There is no question waiting on that consult.');
      return false;
    }
    var img = frame && frame.exists ? (frame.data() || {}).img : '';
    s.img = await loadImage(typeof img === 'string' && img.indexOf('data:image/') === 0 ? img : '');
    if (A !== s) return false;
    build(s);
    return true;
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var im = new global.Image();
      im.onload = function () { resolve(im.naturalWidth > 0 ? im : null); };
      im.onerror = function () { resolve(null); };
      im.src = src;
    });
  }

  function build(s) {
    var d = s.data;
    var words = questionWords(d);
    var root = el('div', 'caBack');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', words.title);
    // Focusable, so Escape reaches the window the moment it opens and the
    // same question pressed again can bring it forward — a plain div cannot
    // take focus, and then neither of those does anything.
    root.tabIndex = -1;
    var card = el('div', 'caCard');
    root.appendChild(card);

    var head = el('div', 'caHead');
    var who = el('div', 'caWho');
    who.appendChild(el('div', 'caTitle', '📝 ' + words.title));
    if (words.where) who.appendChild(el('div', 'caWhere', words.where));
    head.appendChild(who);
    head.appendChild(btn('✕', 'caClose', function () { close(); }, 'Close'));
    card.appendChild(head);

    var body = el('div', 'caBody');
    card.appendChild(body);

    var side = el('div', 'caSide');
    body.appendChild(side);
    var qBox = el('div', 'caQuestion');
    qBox.appendChild(el('div', 'caLabel', 'Their question'));
    qBox.appendChild(el('div', 'caQText', words.text || 'They marked the part of the page below and did not type anything.'));
    side.appendChild(qBox);

    var prev = cleanReply(d.reply);
    if (d.status === 'answered' && prev) {
      var done = el('div', 'caDone');
      done.appendChild(el('div', 'caLabel', 'Already answered'));
      done.appendChild(el('div', 'caHint', d.replySeen ? 'They have watched it. Record again to send a new answer.' : 'Not watched yet. Record again to replace it.'));
      side.appendChild(done);
    }

    var tools = el('div', 'caTools');
    side.appendChild(tools);
    tools.appendChild(el('div', 'caLabel', 'Write on it'));
    var pens = el('div', 'caPens');
    PENS.forEach(function (p) {
      var b = btn('', 'caPen', function () { s.pen = p.c; syncPens(s); }, p.name + ' pen');
      b.style.setProperty('--pen', p.c);
      b.dataset.c = p.c;
      pens.appendChild(b);
    });
    pens.appendChild(btn('↶ Undo', 'caUndo', function () { s.strokes.pop(); paint(s); }, 'Undo the last line'));
    pens.appendChild(btn('Clear', 'caClear', function () { s.strokes = []; paint(s); }, 'Rub everything out'));
    tools.appendChild(pens);

    var camRow = el('div', 'caCamRow');
    var camBtn = btn('📷 Camera: off', 'caCamBtn', function () { toggleCam(s); }, 'Put you in the corner of the video');
    camRow.appendChild(camBtn);
    tools.appendChild(camRow);

    var noteLab = el('label', 'caLabel', 'A note with it (optional)');
    var note = el('textarea', 'caNote');
    note.maxLength = NOTE_MAX;
    note.rows = 2;
    note.placeholder = 'e.g. Try question 5 again after watching.';
    noteLab.appendChild(note);
    tools.appendChild(noteLab);

    var recRow = el('div', 'caRecRow');
    var recBtn = btn('⏺ Record', 'btnPrimary caRec', function () { recToggle(s); }, 'Record your answer');
    var clock = el('span', 'caClock', '0:00');
    recRow.appendChild(recBtn);
    recRow.appendChild(clock);
    tools.appendChild(recRow);

    var review = el('div', 'caReview');
    review.hidden = true;
    var video = el('video', 'caPlayback');
    video.controls = true;
    video.playsInline = true;
    review.appendChild(video);
    var revRow = el('div', 'caRecRow');
    var again = btn('↺ Record again', '', function () { discard(s); }, 'Throw this one away');
    var send = btn('📨 Send to ' + words.who, 'btnPrimary caSend', function () { sendReply(s); }, 'Send it to the student');
    revRow.appendChild(again);
    revRow.appendChild(send);
    review.appendChild(revRow);
    tools.appendChild(review);

    var status = el('div', 'caStatus', 'Write and talk it through — ⏺ records the page, your writing, your voice and (if on) your camera.');
    status.setAttribute('aria-live', 'polite');
    tools.appendChild(status);

    var stageWrap = el('div', 'caStageWrap');
    body.appendChild(stageWrap);
    var canvas = el('canvas', 'caStage');
    var size = stageSize(s.img ? s.img.naturalWidth : 4, s.img ? s.img.naturalHeight : 3);
    canvas.width = size.w; canvas.height = size.h;
    s.W = size.w; s.H = size.h;
    stageWrap.appendChild(canvas);
    var camVideo = el('video', 'caCamPreview');
    camVideo.muted = true; camVideo.playsInline = true; camVideo.autoplay = true;
    camVideo.hidden = true;
    stageWrap.appendChild(camVideo);

    s.root = root; s.canvas = canvas; s.ctx = canvas.getContext('2d'); s.stageWrap = stageWrap; s.camVideo = camVideo;
    s.els = { camBtn: camBtn, recBtn: recBtn, clock: clock, review: review, video: video, send: send, again: again, status: status, note: note, pens: pens };

    bindDraw(s);
    root.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    root.addEventListener('keyup', function (e) { e.stopPropagation(); });
    root.addEventListener('keypress', function (e) { e.stopPropagation(); });
    global.document.body.appendChild(root);
    syncPens(s);
    paint(s);
    loop(s);
    try { if (typeof root.focus === 'function') root.focus(); } catch (e) {}
  }

  function syncPens(s) {
    var bs = s.els.pens ? s.els.pens.querySelectorAll('.caPen') : [];
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].dataset.c === s.pen);
  }
  function say(s, text) { if (s && s.els.status) s.els.status.textContent = text; }

  /* ---- Drawing: pointer events in 0..1 of the canvas ---- */
  function bindDraw(s) {
    var c = s.canvas;
    function pt(e) {
      var r = c.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return null;
      return [round4(clamp01((e.clientX - r.left) / r.width)), round4(clamp01((e.clientY - r.top) / r.height))];
    }
    c.addEventListener('pointerdown', function (e) {
      if (s.blob || s.busy) return;
      if (e.button > 0) return;
      if (s.drawing) return;
      var p = pt(e);
      if (!p) return;
      e.preventDefault();
      s.drawing = true; s.pointerId = e.pointerId;
      try { c.setPointerCapture(e.pointerId); } catch (err) {}
      s.cur = { c: s.pen, w: STROKE_W, p: [p] };
      s.strokes.push(s.cur);
      paint(s);
    });
    c.addEventListener('pointermove', function (e) {
      if (!s.drawing || e.pointerId !== s.pointerId || !s.cur) return;
      var list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      if (!list || !list.length) list = [e];
      for (var i = 0; i < list.length; i++) {
        var p = pt(list[i]);
        if (p && s.cur.p.length < 4000) s.cur.p.push(p);
      }
      paint(s);
    });
    function end(e) {
      if (!s.drawing || (e && e.pointerId !== s.pointerId)) return;
      s.drawing = false; s.pointerId = null; s.cur = null;
      paint(s);
    }
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
  }

  function paint(s) {
    if (!s || !s.ctx) return;
    var ctx = s.ctx, W = s.W, H = s.H;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    if (s.img) {
      ctx.drawImage(s.img, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#6B6B66';
      ctx.font = Math.round(H / 24) + 'px sans-serif';
      ctx.fillText('No picture came with this question — write your working here.', Math.round(W * 0.05), Math.round(H * 0.1));
    }
    var k = W / 1000;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var i = 0; i < s.strokes.length; i++) {
      var st = s.strokes[i];
      if (!st || !st.p.length) continue;
      ctx.strokeStyle = st.c;
      ctx.fillStyle = st.c;
      ctx.lineWidth = Math.max(1.5, st.w * k);
      if (st.p.length === 1) {
        ctx.beginPath();
        ctx.arc(st.p[0][0] * W, st.p[0][1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(st.p[0][0] * W, st.p[0][1] * H);
      for (var j = 1; j < st.p.length; j++) ctx.lineTo(st.p[j][0] * W, st.p[j][1] * H);
      ctx.stroke();
    }
    // The camera goes INTO the picture only while recording; the live
    // preview beside it is the mirrored one, and the file never is.
    if (s.camOn && s.cam && s.rec && s.camVideo && s.camVideo.videoWidth > 0) {
      var r = pipRect(W, H, s.camVideo.videoWidth, s.camVideo.videoHeight);
      if (r) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
        ctx.drawImage(s.camVideo, r.x, r.y, r.w, r.h);
      }
    }
    ctx.restore();
  }

  // The canvas must keep producing frames while recording, even when
  // nothing is being drawn, or captureStream hands the encoder nothing.
  function loop(s) {
    if (A !== s) return;
    if (s.rec) {
      paint(s);
      s.recMs = Date.now() - s.recStart;
      if (s.els.clock) s.els.clock.textContent = fmtClock(s.recMs) + ' / ' + fmtClock(REC_MAX_MS);
      if (s.recMs >= REC_MAX_MS - REC_SLACK_MS) { say(s, 'That is the ten-minute limit — stopped.'); recStop(s); }
    }
    s.raf = global.requestAnimationFrame ? global.requestAnimationFrame(function () { loop(s); }) : 0;
  }

  /* ---- The camera ---- */
  async function toggleCam(s) {
    if (!teacherHere() || A !== s || s.busy) return;
    if (s.rec) { say(s, 'Stop recording first to change the camera.'); return; }
    if (s.camOn) { stopCam(s); syncCam(s); return; }
    var md = global.navigator && global.navigator.mediaDevices;
    if (!md || !md.getUserMedia) { say(s, 'This browser cannot open a camera.'); return; }
    s.els.camBtn.disabled = true;
    try {
      var cam = await md.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (A !== s) { cam.getTracks().forEach(function (t) { t.stop(); }); return; }
      s.cam = cam; s.camOn = true;
      s.camVideo.srcObject = cam;
      s.camVideo.hidden = false;
      try { await s.camVideo.play(); } catch (e) {}
    } catch (e) {
      say(s, 'The camera would not open — check the browser’s permission.');
    } finally {
      if (s.els.camBtn) s.els.camBtn.disabled = false;
      syncCam(s);
    }
  }
  function stopCam(s) {
    if (s.cam) { try { s.cam.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    s.cam = null; s.camOn = false;
    if (s.camVideo) { try { s.camVideo.srcObject = null; } catch (e) {} s.camVideo.hidden = true; }
  }
  function syncCam(s) {
    if (!s.els.camBtn) return;
    s.els.camBtn.textContent = s.camOn ? '📷 Camera: on' : '📷 Camera: off';
    s.els.camBtn.classList.toggle('on', !!s.camOn);
  }

  /* ---- Recording ---- */
  function recToggle(s) { if (s.rec) recStop(s); else recStart(s); }

  async function recStart(s) {
    if (!teacherHere()) { toast('Only the teacher can record an answer.'); return; }
    if (A !== s || s.rec || s.busy || s.blob) return;
    var MR = global.MediaRecorder;
    if (!MR || !s.canvas.captureStream) { say(s, 'This browser cannot record video — try Chrome, Edge or Safari.'); return; }
    var md = global.navigator && global.navigator.mediaDevices;
    s.busy = true;
    s.els.recBtn.disabled = true;
    var mic = null;
    try {
      if (md && md.getUserMedia) {
        mic = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      }
    } catch (e) { mic = null; }
    if (A !== s) { if (mic) mic.getTracks().forEach(function (t) { t.stop(); }); return; }
    if (!mic) say(s, 'No microphone — recording the writing without your voice.');
    var stream;
    try {
      var vs = s.canvas.captureStream(30);
      stream = new global.MediaStream();
      vs.getVideoTracks().forEach(function (t) { stream.addTrack(t); });
      if (mic) mic.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
    } catch (e) {
      if (mic) mic.getTracks().forEach(function (t) { t.stop(); });
      s.busy = false; s.els.recBtn.disabled = false;
      say(s, 'Could not start the recording.');
      return;
    }
    var mime = pickMime(function (m) { return MR.isTypeSupported && MR.isTypeSupported(m); });
    var rec;
    try {
      rec = mime ? new MR(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS })
                 : new MR(stream, { videoBitsPerSecond: VIDEO_BPS });
    } catch (e) {
      try { rec = new MR(stream); } catch (e2) { rec = null; }
    }
    if (!rec) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      if (mic) mic.getTracks().forEach(function (t) { t.stop(); });
      s.busy = false; s.els.recBtn.disabled = false;
      say(s, 'This browser refused to record.');
      return;
    }
    s.mic = mic; s.recStream = stream; s.rec = rec; s.chunks = [];
    s.recMime = rec.mimeType || mime || 'video/webm';
    rec.ondataavailable = function (e) { if (e.data && e.data.size) s.chunks.push(e.data); };
    rec.onstop = function () { recDone(s); };
    s.recStart = Date.now(); s.recMs = 0;
    try { rec.start(1000); } catch (e) {
      recRelease(s); s.rec = null; s.busy = false; s.els.recBtn.disabled = false;
      say(s, 'The recording would not start.');
      return;
    }
    s.busy = false;
    s.els.recBtn.disabled = false;
    s.els.recBtn.textContent = '⏹ Stop';
    s.els.recBtn.classList.add('recording');
    s.root.classList.add('caRecording');
    say(s, mic ? 'Recording — talk it through and write on the page.' : 'Recording (no microphone).');
  }

  function recStop(s) {
    if (!s.rec) return;
    s.recMs = Date.now() - s.recStart;
    try { if (s.rec.state !== 'inactive') s.rec.stop(); else recDone(s); } catch (e) { recDone(s); }
  }

  function recRelease(s) {
    if (s.recStream) { try { s.recStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    if (s.mic) { try { s.mic.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    s.recStream = null; s.mic = null;
  }

  async function recDone(s) {
    if (!s.rec) return;
    var ms = Math.max(1, s.recMs || (Date.now() - s.recStart));
    s.rec = null;
    recRelease(s);
    if (s.root) s.root.classList.remove('caRecording');
    if (s.els.recBtn) { s.els.recBtn.textContent = '⏺ Record'; s.els.recBtn.classList.remove('recording'); }
    paint(s);
    if (A !== s) return;
    var mime = (s.recMime || 'video/webm').split(';')[0];
    var blob = new global.Blob(s.chunks, { type: mime });
    s.chunks = [];
    if (!blob.size) { say(s, 'Nothing was recorded — try again.'); return; }
    say(s, 'Getting it ready…');
    blob = await finalize(blob, ms, mime);
    if (A !== s) return;
    s.blob = blob; s.recMs = ms;
    s.blobUrl = global.URL.createObjectURL(blob);
    s.els.video.src = s.blobUrl;
    s.els.review.hidden = false;
    s.els.recBtn.hidden = true;
    s.els.clock.textContent = fmtClock(ms);
    say(s, 'Watch it back, then send it — or record again.');
  }

  // A recorder's file has no length and, for MP4, no index; the apps'
  // own finalizers put both in. One that refuses or throws keeps the
  // recording as it was: a video that plays is better than none.
  async function finalize(blob, ms, mime) {
    try {
      if (/mp4/i.test(mime) && global.LessonMp4Finalize && typeof global.LessonMp4Finalize.finalize === 'function') {
        return (await global.LessonMp4Finalize.finalize(blob)) || blob;
      }
      if (/webm/i.test(mime) && global.LessonAudioFinalize && typeof global.LessonAudioFinalize.finalize === 'function') {
        return (await global.LessonAudioFinalize.finalize(blob, Math.max(1, Math.round(ms)))) || blob;
      }
    } catch (e) {}
    return blob;
  }

  function discard(s) {
    if (s.busy) return;
    if (s.blobUrl) { try { global.URL.revokeObjectURL(s.blobUrl); } catch (e) {} }
    s.blob = null; s.blobUrl = '';
    if (s.els.video) { try { s.els.video.removeAttribute('src'); s.els.video.load(); } catch (e) {} }
    s.els.review.hidden = true;
    s.els.recBtn.hidden = false;
    s.els.clock.textContent = '0:00';
    say(s, 'Ready to record again. Your writing is still on the page.');
  }

  /* ---- Sending ---- */
  function storageRefused(e) {
    var c = e && (e.code || '');
    return c === 'storage/unauthorized' || c === 'storage/unauthenticated' || /permission|unauthori[sz]ed/i.test(String(e && e.message || ''));
  }
  function putOnce(st, path, blob, mime, onPct) {
    return new Promise(function (resolve, reject) {
      var task;
      try {
        task = st.ref(path).put(blob, { contentType: mime, cacheControl: 'public, max-age=31536000' });
      } catch (e) { reject(e); return; }
      task.on('state_changed', function (snap) {
        if (snap && snap.totalBytes) onPct(Math.round(snap.bytesTransferred / snap.totalBytes * 100));
      }, reject, function () { resolve(task.snapshot); });
    });
  }
  async function upload(s, blob, mime) {
    var st = store();
    if (!st) throw new Error('Storage is not ready.');
    var ts = Date.now();
    var lastErr = null;
    for (var i = 0; i < DIRS.length; i++) {
      var path = storagePath(DIRS[i], s.id, ts, mime);
      for (var attempt = 0; attempt < 3; attempt++) {
        try {
          var snap = await putOnce(st, path, blob, mime, function (p) { say(s, 'Sending… ' + p + '%'); });
          var url = await snap.ref.getDownloadURL();
          return { url: url, path: path };
        } catch (e) {
          lastErr = e;
          if (storageRefused(e)) break;               // try the other folder
          if (A !== s) throw e;
          await new Promise(function (r) { setTimeout(r, 1500 * (attempt + 1)); });
        }
      }
      if (!storageRefused(lastErr)) break;            // a dropped network is not a reason to change folder
    }
    throw lastErr || new Error('Upload failed.');
  }

  async function sendReply(s) {
    if (!teacherHere()) { toast('Only the teacher can send an answer.'); return; }
    if (A !== s || !s.blob || s.busy || s.sent) return;
    s.busy = true;
    s.els.send.disabled = true; s.els.again.disabled = true;
    var mime = (s.blob.type || s.recMime || 'video/webm').split(';')[0];
    var prevPath = '';
    var gone = false;
    try {
      var up = await upload(s, s.blob, mime);
      if (!replyUrlOk(up.url)) throw new Error('The saved video came back with a link that is not Firebase Storage.');
      var reply = { url: up.url, path: up.path, mime: mime, ms: Math.round(s.recMs), note: cleanLong(s.els.note.value, NOTE_MAX), at: Date.now() };
      var ok = await db().runTransaction(async function (tx) {
        var snap = await tx.get(s.ref);
        if (!snap.exists) { gone = true; return false; }
        var x = snap.data() || {};
        if (['question', 'answered'].indexOf(x.status) < 0) { gone = true; return false; }
        var old = cleanReply(x.reply);
        prevPath = old && old.path ? old.path : '';
        tx.update(s.ref, { status: 'answered', reply: reply, answeredAt: serverStamp(), replySeen: null });
        return true;
      });
      if (!ok) {
        try { await store().ref(up.path).delete(); } catch (e) {}
        throw new Error(gone ? 'The student took that question back, so it was not sent.' : 'Could not save the answer.');
      }
      if (prevPath && prevPath !== up.path) { try { await store().ref(prevPath).delete(); } catch (e) {} }
      s.sent = true;
      usage('consultAnswer', cleanText(s.data && s.data.worksheetName, 80));
      toast('📨 Sent — ' + (cleanText(s.data && s.data.studentName, NAME_MAX) || 'the student') + ' will see it under 🙋 Consults, in whichever app they open.', 5000);
      // Only THIS window: the teacher may have closed it while the answer was
      // uploading and opened the next question, which must stay open.
      if (A === s) close();
    } catch (e) {
      s.busy = false;
      if (s.els.send) s.els.send.disabled = false;
      if (s.els.again) s.els.again.disabled = false;
      say(s, 'Not sent: ' + cleanText(String(e && e.message || e), 200));
    }
  }

  /* ===================================================================
     📚 THE ARCHIVE — the teacher's list of every call and question
     (`openLog`) and the student's shelf of every answer (`openLibrary`).
     Both are windows over a LIVE query that comes down when they close;
     both are READS, except the one field a student owns: `replySeen`,
     written when they press ▶ on an answer.
     =================================================================== */
  var L = null;   // the teacher's log window
  var B = null;   // the student's library window
  var P = null;   // the player both of them open

  function archiveWin(cls, title, onClose) {
    var root = el('div', 'caLogBack ' + cls);
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', title);
    root.tabIndex = -1;
    var card = el('div', 'caLogCard');
    root.appendChild(card);
    var head = el('div', 'caHead');
    var who = el('div', 'caWho');
    who.appendChild(el('div', 'caTitle', title));
    head.appendChild(who);
    head.appendChild(btn('✕', 'caClose', onClose, 'Close'));
    card.appendChild(head);
    // Every key typed in here stops here, or a letter in the search box
    // fires one of the page's one-letter tool shortcuts.
    root.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') { if (P) closePlayer(); else onClose(); }
    });
    root.addEventListener('click', function (e) { if (e.target === root) onClose(); });
    global.document.body.appendChild(root);
    try { root.focus(); } catch (e) {}
    return { root: root, card: card, who: who };
  }

  /* ---- The player ---- */
  function closePlayer() {
    var p = P;
    P = null;
    if (!p) return;
    try { var m = p.root.querySelector('video,audio'); if (m) { m.pause(); m.removeAttribute('src'); } } catch (e) {}
    if (p.root.parentNode) p.root.parentNode.removeChild(p.root);
    // Focus goes back to the list it was opened from, or the next Escape
    // reaches the page instead of closing the list.
    var back = (B && B.win) || (L && L.win);
    if (back) { try { back.root.focus(); } catch (e) {} }
  }
  function play(row, onPlayed) {
    closePlayer();
    var rep = row && cleanReply(row.reply);
    if (!rep) { toast('That answer cannot be played.'); return false; }
    var root = el('div', 'caPlayBack');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', teacherName() + '’s answer');
    root.tabIndex = -1;
    var card = el('div', 'caPlayCard');
    root.appendChild(card);
    var head = el('div', 'caHead');
    var who = el('div', 'caWho');
    who.appendChild(el('div', 'caTitle', '🎬 ' + teacherName() + '’s answer'));
    var where = [row.ws, row.page ? 'page ' + row.page : '', whenText(row.answeredAt)].filter(Boolean).join(' · ');
    if (where) who.appendChild(el('div', 'caWhere', where));
    head.appendChild(who);
    head.appendChild(btn('✕', 'caClose', closePlayer, 'Close'));
    card.appendChild(head);
    var media = global.document.createElement(/^audio\//i.test(rep.mime) ? 'audio' : 'video');
    media.className = 'caPlayMedia';
    media.controls = true;
    media.setAttribute('playsinline', ''); media.playsInline = true;
    media.preload = 'auto';
    media.src = rep.url;
    card.appendChild(media);
    if (row.text) card.appendChild(el('p', 'caPlayQ', (row.mine ? 'You asked: “' : 'They asked: “') + row.text + '”'));
    if (rep.note) card.appendChild(el('p', 'caPlayNote', rep.note));
    root.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') closePlayer(); });
    root.addEventListener('click', function (e) { if (e.target === root) closePlayer(); });
    var told = false;
    media.addEventListener('play', function () {
      if (told) return;
      told = true;
      if (typeof onPlayed === 'function') { try { onPlayed(row); } catch (e) {} }
    });
    global.document.body.appendChild(root);
    P = { id: row.id, root: root };
    try { root.focus(); } catch (e) {}
    try { var pr = media.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    return true;
  }

  /* ---- The teacher's log ---- */
  function logJoin(id) {
    if (!teacherHere()) { toast('Only the teacher can join a consult.'); return; }
    // The room opens over the page, so the list steps out of its way.
    var j = L && L.join;
    if (typeof j === 'function') { closeLog(); try { j(id); return; } catch (e) {} }
    var link = consultLink(id);
    if (!link) return;
    try { global.open(link, '_blank', 'noopener'); } catch (e) {}
  }
  /* ---- 🗑 Deleting a consult (the teacher's, asked twice) ----
     🗑 Delete on a row turns that row's buttons into the question and a
     Cancel, so one stray tap never removes anything. Yes, delete:
       ① the consult document — FIRST, so a delete the rules refuse takes
          nothing else with it, and the entry the teacher asked to remove is
          the part that is sure to go;
       ② its `ink` and `frames` sub-collections, which a document delete
          leaves behind in Firestore;
       ③ the video answer in Storage, by a path `replyPathOk` accepts.
     ② and ③ are best effort: the entry is gone either way, and a leftover
     stroke or file is invisible where a half-deleted entry would not be.
     Study Buddy already copes with a consult that vanishes: the student's
     panel ends the call, the room says "The consult was removed". */
  var deleteBusy = {};
  async function deleteConsult(id) {
    if (!teacherHere()) { toast('Only the teacher can delete a consult.'); return false; }
    var x = ref(id);
    if (!x) return false;
    if (A && A.id === id) { toast('Close the answer window for this consult first.'); return false; }
    if (deleteBusy[id]) return false;
    deleteBusy[id] = true;
    try {
      var snap = null;
      try { snap = await x.get(); } catch (e) {
        toast('Could not reach that consult — nothing was deleted.', 6000);
        return false;
      }
      // The teacher can hand the device over while the read is in flight.
      if (!teacherHere()) return false;
      if (!snap || !snap.exists) return true;
      var plan = deletePlan(id, snap.data() || {});
      if (!plan) return false;
      try { await x.delete(); } catch (e) {
        console.warn('consult: could not delete', e);
        toast('Could not delete that consult: ' + cleanText(String(e && e.message || e), 160), 7000);
        return false;
      }
      for (var i = 0; i < plan.subs.length; i++) {
        try {
          var qs = await x.collection(plan.subs[i]).get();
          await Promise.all((qs.docs || []).map(function (doc) { return doc.ref.delete(); }));
        } catch (e) { console.warn('consult: left ' + plan.subs[i] + ' behind', e); }
      }
      var st = store();
      plan.files.forEach(function (path) {
        if (!st) return;
        try {
          var pr = st.ref(path).delete();
          if (pr && pr.catch) pr.catch(function (e) {
            if (!e || e.code !== 'storage/object-not-found') console.warn('consult: left the video behind', e);
          });
        } catch (e) {}
      });
      toast('🗑 Deleted.', 3000);
      return true;
    } finally {
      delete deleteBusy[id];
    }
  }
  function openLog(opts) {
    if (!teacherHere()) { toast('Only the teacher can see the consults.'); return false; }
    var o = opts || {};
    if (L) { try { L.win.root.focus(); } catch (e) {} if (typeof o.join === 'function') L.join = o.join; return true; }
    var d = db();
    if (!d) { toast('Not connected yet — try again in a moment.'); return false; }
    var s = { win: null, unsub: null, docs: [], filter: 'todo', search: '', join: typeof o.join === 'function' ? o.join : null, loaded: false, failed: false, els: {},
      asking: '', deleting: {} };
    L = s;
    s.win = archiveWin('caLogTeacher', '🙋 Consults — every call and question', closeLog);
    var bar = el('div', 'caLogBar');
    var chips = el('div', 'caChips');
    bar.appendChild(chips);
    var search = el('input', 'caSearch');
    search.type = 'search';
    search.placeholder = 'Search a name, a worksheet or a question';
    search.setAttribute('aria-label', 'Search the consults');
    search.addEventListener('input', function () { s.search = search.value; renderLogList(s); });
    bar.appendChild(search);
    s.win.card.appendChild(bar);
    var list = el('div', 'caLogList');
    s.win.card.appendChild(list);
    s.els = { chips: chips, list: list, search: search };
    renderLog(s);
    try {
      s.unsub = d.collection(COLLECTION).orderBy('at', 'desc').limit(LOG_MAX).onSnapshot(function (qs) {
        if (L !== s) return;
        s.docs = (qs.docs || []).map(function (doc) { return { id: doc.id, data: doc.data() || {} }; });
        s.loaded = true; s.failed = false;
        renderLog(s);
      }, function (err) {
        if (L !== s) return;
        console.warn('consult: the log', err);
        s.failed = true;
        renderLog(s);
      });
    } catch (e) { s.failed = true; renderLog(s); }
    return true;
  }
  function logRows(s) {
    var t = Date.now();
    return logSort(s.docs.map(function (x) { return logRow(x.id, x.data, t); }).filter(Boolean));
  }
  function renderLog(s) {
    if (!s || L !== s) return;
    var rows = logRows(s);
    var c = logCounts(rows);
    var chips = s.els.chips;
    while (chips.firstChild) chips.removeChild(chips.firstChild);
    [['todo', 'To do'], ['answered', 'Answered'], ['calls', 'Calls'], ['all', 'All']].forEach(function (f) {
      var b = btn(f[1] + ' (' + c[f[0]] + ')', 'caChip' + (s.filter === f[0] ? ' on' : ''), function () {
        s.filter = f[0];
        renderLog(s);
      });
      b.setAttribute('aria-pressed', s.filter === f[0] ? 'true' : 'false');
      chips.appendChild(b);
    });
    renderLogList(s, rows);
  }
  function renderLogList(s, rows) {
    if (!s || L !== s) return;
    var list = s.els.list;
    while (list.firstChild) list.removeChild(list.firstChild);
    if (s.failed && !s.loaded) { list.appendChild(el('p', 'caEmpty', 'Could not read the consults just now — close this and try again.')); return; }
    if (!s.loaded) { list.appendChild(el('p', 'caEmpty', 'Loading…')); return; }
    var show = logFilter(rows || logRows(s), s.filter, s.search);
    if (!show.length) {
      list.appendChild(el('p', 'caEmpty', s.search ? 'Nothing matches that search.'
        : s.filter === 'todo' ? 'Nothing is waiting for you — every call and question has been dealt with.'
        : 'Nothing here yet.'));
      return;
    }
    show.forEach(function (r) { list.appendChild(logRowNode(r, s)); });
  }
  // The row's two-step delete. The question lives on `s.asking` (one row at
  // a time) so a live snapshot redrawing the list mid-question keeps it.
  function logAskDelete(s, id) {
    if (!teacherHere() || L !== s) return;
    s.asking = id;
    renderLogList(s);
  }
  function logCancelDelete(s) {
    if (L !== s) return;
    s.asking = '';
    renderLogList(s);
  }
  async function logDelete(s, id) {
    if (L !== s || s.deleting[id]) return;
    s.deleting[id] = true;
    renderLogList(s);
    var ok = false;
    try { ok = await deleteConsult(id); } catch (e) { ok = false; }
    if (L !== s) return;
    delete s.deleting[id];
    if (s.asking === id) s.asking = '';
    // The live query drops the row by itself; drop it here as well, so a
    // slow snapshot never shows a deleted consult for a second longer.
    if (ok) s.docs = s.docs.filter(function (x) { return x.id !== id; });
    renderLog(s);
  }
  function logRowNode(r, s) {
    var row = el('div', 'caLogRow caState-' + r.state);
    var top = el('div', 'caLogTop');
    top.appendChild(el('span', 'caLogWho', r.who));
    top.appendChild(el('span', 'caPill caPill-' + r.state, r.label));
    top.appendChild(el('span', 'caLogWhen', whenText(r.at)));
    row.appendChild(top);
    var where = [r.ws, r.page ? 'page ' + r.page : '', r.subj, r.appWord ? 'in ' + r.appWord : ''].filter(Boolean).join(' · ');
    if (where) row.appendChild(el('div', 'caLogWhere', where));
    if (r.text) row.appendChild(el('div', 'caLogQ', '“' + r.text + '”'));
    else if (r.asked) row.appendChild(el('div', 'caLogQ caMuted', 'They marked part of the page and did not type anything.'));
    if (r.reply && r.reply.note) row.appendChild(el('div', 'caLogNote', 'Your note: ' + r.reply.note));
    var acts = el('div', 'caLogActs');
    if (r.state === 'ringing' || r.state === 'live') acts.appendChild(btn('Join', 'btnPrimary', function () { logJoin(r.id); }));
    // The recorder opens over the page, so the list steps out of its way.
    if (r.state === 'question') acts.appendChild(btn('📝 Answer', 'btnPrimary', function () { closeLog(); open(r.id); }));
    if (r.reply) {
      acts.appendChild(btn('▶ Watch', 'btnPrimary', function () { play(r); }));
      acts.appendChild(btn('📝 Answer again', 'btnGhost', function () { closeLog(); open(r.id); }, 'Record a new answer in place of this one'));
    }
    if (r.state === 'later') acts.appendChild(el('span', 'caMuted', 'Waiting for them to leave the question.'));
    if (s) {
      if (s.deleting[r.id]) {
        while (acts.firstChild) acts.removeChild(acts.firstChild);
        acts.appendChild(el('span', 'caMuted', 'Deleting…'));
      } else if (s.asking === r.id) {
        while (acts.firstChild) acts.removeChild(acts.firstChild);
        row.className += ' caAsking';
        acts.appendChild(el('span', 'caDelAsk', deleteAsk(r)));
        acts.appendChild(btn('Cancel', 'btnGhost', function () { logCancelDelete(s); }));
        acts.appendChild(btn('🗑 Yes, delete', 'caDelYes', function () { logDelete(s, r.id); }, 'Delete this consult for good'));
      } else {
        acts.appendChild(btn('🗑 Delete', 'btnGhost caDel', function () { logAskDelete(s, r.id); }, 'Delete this consult'));
      }
    }
    if (acts.firstChild) row.appendChild(acts);
    return row;
  }
  function closeLog() {
    var s = L;
    L = null;
    if (!s) return;
    if (s.unsub) { try { s.unsub(); } catch (e) {} }
    if (s.win && s.win.root.parentNode) s.win.root.parentNode.removeChild(s.win.root);
    closePlayer();
  }

  /* ---- The student's library ---- */
  function openLibrary(opts) {
    var o = opts || {};
    var u = user();
    if (!u || !u.uid) { toast('Sign in to see the answers you have been sent.'); return false; }
    if (B) { try { B.win.root.focus(); } catch (e) {} return true; }
    var d = db();
    if (!d) { toast('Not connected yet — try again in a moment.'); return false; }
    var s = { uid: u.uid, win: null, unsub: null, docs: [], loaded: false, failed: false, list: null, ask: null };
    B = s;
    var app = askApp(o);
    s.win = archiveWin('caLib', (app ? '🙋 Ask ' : '🎬 My answers from ') + teacherName(), closeLibrary);
    s.win.who.appendChild(el('div', 'caWhere', app
      ? 'Leave ' + teacherName() + ' a question. He answers with a video, kept here with every answer he has sent you.'
      : 'Every video ' + teacherName() + ' has recorded for a question you left, kept here.'));
    if (app) s.ask = buildAsk(s, app, o);
    s.list = el('div', 'caLogList');
    s.win.card.appendChild(s.list);
    renderLibrary(s);
    try {
      s.unsub = d.collection(COLLECTION).where('studentUid', '==', s.uid).onSnapshot(function (qs) {
        if (B !== s) return;
        s.docs = (qs.docs || []).map(function (doc) { return { id: doc.id, data: doc.data() || {} }; });
        s.loaded = true; s.failed = false;
        renderLibrary(s);
      }, function (err) {
        if (B !== s) return;
        console.warn('consult: the library', err);
        s.failed = true;
        renderLibrary(s);
      });
    } catch (e) { s.failed = true; renderLibrary(s); }
    return true;
  }
  function renderLibrary(s) {
    if (!s || B !== s) return;
    var list = s.list;
    while (list.firstChild) list.removeChild(list.firstChild);
    if (s.failed && !s.loaded) { list.appendChild(el('p', 'caEmpty', 'Could not read your answers just now — close this and try again.')); return; }
    if (!s.loaded) { list.appendChild(el('p', 'caEmpty', 'Loading…')); return; }
    var lib = libraryRows(s.docs, Date.now());
    if (!lib.answers.length && !lib.waiting.length) {
      list.appendChild(el('p', 'caEmpty', 'No answers yet. When you leave ' + teacherName() + ' a question under 🙋 Consult, the video answer will be kept here — in Study Buddy, Ans Key, the Science portal and the Maths portal alike.'));
      return;
    }
    if (lib.waiting.length) {
      list.appendChild(el('div', 'caLibHead', 'Waiting for an answer'));
      lib.waiting.forEach(function (r) { list.appendChild(libraryRowNode(r, s)); });
    }
    if (lib.answers.length) {
      list.appendChild(el('div', 'caLibHead', 'Answers (' + lib.answers.length + ')'));
      lib.answers.forEach(function (r) { list.appendChild(libraryRowNode(r, s)); });
    }
  }
  function libraryRowNode(r, s) {
    r.mine = true;
    var row = el('div', 'caLogRow' + (r.fresh ? ' caFresh' : ''));
    var top = el('div', 'caLogTop');
    top.appendChild(el('span', 'caLogWho', r.ws || (r.wsId ? 'Your worksheet' : 'Your question')));
    if (r.fresh) top.appendChild(el('span', 'caPill caPill-answered', 'New'));
    else if (!r.reply) top.appendChild(el('span', 'caPill caPill-question', r.state === 'later' ? 'Leave your question' : 'Sent'));
    top.appendChild(el('span', 'caLogWhen', whenText(r.reply ? (r.answeredAt || r.at) : r.at)));
    row.appendChild(top);
    var where = [r.page ? 'page ' + r.page : '', r.subj, r.appWord ? 'asked in ' + r.appWord : ''].filter(Boolean).join(' · ');
    if (where) row.appendChild(el('div', 'caLogWhere', where));
    if (r.text) row.appendChild(el('div', 'caLogQ', 'You asked: “' + r.text + '”'));
    if (r.reply && r.reply.note) row.appendChild(el('div', 'caLogNote', r.reply.note));
    var acts = el('div', 'caLogActs');
    if (r.reply) acts.appendChild(btn('▶ Watch', 'btnPrimary', function () { play(r, function () { markSeen(s, r); }); }));
    var openWs = r.wsId ? worksheetOpener() : null;
    if (openWs) {
      acts.appendChild(btn('Open the worksheet', 'btnGhost', function () {
        closeLibrary();
        try { openWs(r.wsId); } catch (e) {}
      }));
    }
    if (acts.firstChild) row.appendChild(acts);
    return row;
  }
  // The ONE write the library makes: the student's own "I have seen it",
  // on their own consult, and only the first time.
  function markSeen(s, r) {
    if (!r || !r.fresh || !s || B !== s) return;
    var u = user();
    if (!u || u.uid !== s.uid) return;
    var x = ref(r.id);
    if (!x) return;
    r.fresh = false;
    try { var pr = x.update({ replySeen: Date.now() }); if (pr && pr.catch) pr.catch(function (e) { console.warn('consult: could not mark the answer seen', e); }); } catch (e) {}
  }
  function closeLibrary() {
    var s = B;
    B = null;
    if (!s) return;
    if (s.unsub) { try { s.unsub(); } catch (e) {} }
    if (s.win && s.win.root.parentNode) s.win.root.parentNode.removeChild(s.win.root);
    closePlayer();
  }
  function archiveStop() { closeLog(); closeLibrary(); closePlayer(); }

  /* ---- Closing ---- */
  // `force` is the way out that asks nothing: an account change or the page
  // going away, where a question nobody can answer would only be in the way.
  // Every other close asks first when there is work in the window that has
  // not gone anywhere — a recording still RUNNING as much as one finished and
  // not sent, because stopping a recording half way through is losing it.
  // A send already on its way is never asked about: it finishes by itself.
  function closeWin(force) {
    var s = A;
    if (!s) return true;
    var unsent = !s.sent && !s.busy && (!!s.blob || !!(s.rec && s.rec.state && s.rec.state !== 'inactive'));
    if (!force && unsent && global.confirm && !global.confirm('Close without sending this recording?')) return false;
    A = null;
    if (s.rec) { try { s.rec.onstop = null; s.rec.ondataavailable = null; if (s.rec.state !== 'inactive') s.rec.stop(); } catch (e) {} s.rec = null; }
    recRelease(s);
    stopCam(s);
    if (s.raf && global.cancelAnimationFrame) { try { global.cancelAnimationFrame(s.raf); } catch (e) {} }
    if (s.blobUrl) { try { global.URL.revokeObjectURL(s.blobUrl); } catch (e) {} }
    if (s.root && s.root.parentNode) s.root.parentNode.removeChild(s.root);
    return true;
  }
  // The window's own ✕, Escape and the send: ask first when it would lose work.
  function close() { return closeWin(false); }
  // Everything down, no questions asked: an account change or the page going.
  function stop() { archiveStop(); return closeWin(true); }

  /* ---- ✍️ Asking (Ans Key and the two portals) ---- */
  // Which app this window asks for: the host's word when it has a ConsultEnv
  // (the portals), the caller's otherwise (Ans Key). Study Buddy passes none,
  // so its window has no box — it asks with its own 🙋 Consult button.
  function askApp(o) {
    var E = hostEnv();
    var a = E ? E.app : (o && o.ask);
    try { return askAppOk(a) ? a : ''; } catch (e) { return ''; }
  }
  function envText(k) {
    var f = envFn(k);
    if (!f) return '';
    try { return f() || ''; } catch (e) { return ''; }
  }
  function studentNameOf(u) {
    var n = cleanText(envText('studentName'), NAME_MAX);
    if (n) return n;
    try { n = cleanText(u.displayName || String(u.email || '').split('@')[0], NAME_MAX); } catch (e) { n = ''; }
    return n || 'A student';
  }
  function buildAsk(s, app, o) {
    var box = el('div', 'caAsk');
    var ta = global.document.createElement('textarea');
    ta.className = 'caAskText';
    ta.maxLength = QUESTION_MAX;
    ta.rows = 3;
    ta.placeholder = 'What are you stuck on? Say which question and what you tried.';
    ta.setAttribute('aria-label', 'Your question');
    box.appendChild(ta);
    var row = el('div', 'caAskRow');
    var file = global.document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
    var pick = btn('📷 Add a photo', 'btnGhost', function () { try { file.click(); } catch (e) {} },
      'A photo or screenshot of the question and your working');
    var thumb = el('span', 'caAskThumb');
    var send = btn('📨 Send to ' + teacherName(), 'btnPrimary', function () { sendAsk(s); });
    row.appendChild(pick); row.appendChild(file); row.appendChild(thumb); row.appendChild(send);
    box.appendChild(row);
    var said = el('div', 'caAskSaid');
    said.setAttribute('aria-live', 'polite');
    box.appendChild(said);
    s.win.card.appendChild(box);
    var a = { app: app, ta: ta, file: file, thumb: thumb, send: send, said: said, img: '', busy: false,
      subject: cleanText(o && o.subject, 12) || envText('subject'), title: cleanText(o && o.title, TITLE_MAX) || cleanText(envText('title'), TITLE_MAX) };
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      a.said.textContent = 'Getting the photo ready…';
      photoData(f).then(function (url) {
        if (B !== s) return;
        a.img = url || '';
        while (thumb.firstChild) thumb.removeChild(thumb.firstChild);
        if (a.img) {
          var im = global.document.createElement('img');
          im.src = a.img; im.alt = 'Your photo';
          thumb.appendChild(im);
          thumb.appendChild(btn('✕', 'caAskDrop', function () { a.img = ''; while (thumb.firstChild) thumb.removeChild(thumb.firstChild); }, 'Take the photo off'));
          a.said.textContent = '';
        } else {
          a.said.textContent = 'That photo could not be read — try another, or send the question on its own.';
        }
      });
    });
    return a;
  }
  // A photo, shrunk until it fits in one Firestore document, as a JPEG data
  // URL. Empty when it cannot be read or will not fit.
  function photoData(f) {
    return new Promise(function (resolve) {
      if (!f || !/^image\//.test(f.type || '')) { resolve(''); return; }
      var url = '';
      try { url = global.URL.createObjectURL(f); } catch (e) { resolve(''); return; }
      var im = new global.Image();
      im.onload = function () {
        var out = '';
        try {
          var size = askImgSize(im.naturalWidth, im.naturalHeight);
          if (size) {
            var c = global.document.createElement('canvas');
            c.width = size.w; c.height = size.h;
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(im, 0, 0, c.width, c.height);
            for (var i = 0; i < ASK_JPEG_STEPS.length; i++) {
              out = c.toDataURL('image/jpeg', ASK_JPEG_STEPS[i]);
              if (out.length <= ASK_IMG_MAX) break;
            }
          }
        } catch (e) { out = ''; }
        try { global.URL.revokeObjectURL(url); } catch (e) {}
        resolve(out && out.length <= ASK_IMG_MAX && out.indexOf('data:image/') === 0 ? out : '');
      };
      im.onerror = function () { try { global.URL.revokeObjectURL(url); } catch (e) {} resolve(''); };
      im.src = url;
    });
  }
  async function sendAsk(s) {
    var a = s && s.ask;
    if (!a || a.busy || B !== s) return;
    var u = user(), d = db();
    if (!u || !u.uid || u.uid !== s.uid) { toast('Sign in again to ask.'); return; }
    if (teacherHere()) { toast('This is where students ask you — your own list is under 🙋 Consults.'); return; }
    if (!d) { toast('Not connected yet — try again in a moment.'); return; }
    var doc = askDoc({ uid: u.uid, name: studentNameOf(u), app: a.app, text: a.ta.value, subject: a.subject,
      title: a.title, photo: !!a.img, now: Date.now(), stamp: serverStamp() });
    if (!doc) { a.said.textContent = 'Type your question first.'; try { a.ta.focus(); } catch (e) {} return; }
    a.busy = true; a.send.disabled = true;
    a.said.textContent = 'Sending…';
    var id = '';
    try {
      var r = d.collection(COLLECTION).doc();
      id = r.id;
      // The picture first: the teacher's 📝 Answer reads it the moment the
      // question appears, so it must already be there.
      if (a.img) {
        try { await r.collection('frames').doc('question').set({ img: a.img, at: Date.now() }); }
        catch (e) { console.warn('consult: the photo did not save', e); doc.photo = false; }
      }
      await r.set(doc);
    } catch (e) {
      console.warn('consult: could not leave the question', e);
      a.busy = false; a.send.disabled = false;
      a.said.textContent = 'Could not send that just now: ' + cleanText(String(e && e.message || e), 160);
      return;
    }
    usage('consult', cleanText(a.title || a.app, 80));
    a.ta.value = ''; a.img = '';
    while (a.thumb.firstChild) a.thumb.removeChild(a.thumb.firstChild);
    var result = await notifyTeacher(u, id);
    if (B !== s) { toast(askSaid(result.code, teacherName()), 6000); return; }
    a.said.textContent = askSaid(result.code, teacherName());
    a.busy = false; a.send.disabled = false;
  }
  // The email, asked of the server with `{ consultId }` and nothing more —
  // the server reads everything else off the document it already trusts.
  async function notifyTeacher(u, id) {
    if (!consultIdOk(id)) return { code: 'invalid' };
    var getAc = envFn('appCheckToken') || (typeof global.liveAppCheckToken === 'function' ? global.liveAppCheckToken : null);
    if (!getAc || typeof global.fetch !== 'function') return { code: 'app_check' };
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 15000);
    try {
      var tokens = await Promise.all([u.getIdToken(), getAc()]);
      if (!tokens[1]) return { code: 'app_check' };
      var res = await global.fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[0], 'X-Firebase-AppCheck': tokens[1] },
        body: JSON.stringify({ consultId: id }),
        signal: controller ? controller.signal : undefined
      });
      var body = null;
      try { body = await res.json(); } catch (e) { body = null; }
      if (res.ok) return { code: (body && body.status) || 'queued' };
      return { code: (body && body.error && body.error.code) || ('http_' + res.status) };
    } catch (e) {
      return { code: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    global.addEventListener('pagehide', function () { stop(); });
  } catch (e) {}

  global.ConsultAnswer = {
    pure: pure,
    open: open,
    askLater: askLater,
    close: close,
    stop: stop,
    // With an id: is THAT question the one open. Without: is any.
    isOpen: function (id) { return !!A && (id == null || A.id === id); },
    openLog: openLog,
    closeLog: closeLog,
    deleteConsult: deleteConsult,
    openLibrary: openLibrary,
    closeLibrary: closeLibrary,
    play: play,
    closePlayer: closePlayer,
    archiveOpen: function () { return { log: !!L, library: !!B, player: !!P }; },
    _internals: { state: function () { return A; }, paint: paint, teacherHere: teacherHere,
      log: function () { return L; }, library: function () { return B; } }
  };
})(typeof window !== 'undefined' ? window : globalThis);
