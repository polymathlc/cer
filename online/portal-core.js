/* Polymath Online — the portal's rules, with no Firebase and no page in them.
   Loaded by online/index.html before portal.js (as window.PolymathOnlineCore)
   and by tools/online-portal-tests.mjs (through vm), so every rule that
   decides what a student sees is tested on its own.

   The release rule (v1.12.0, Zhi Kai, 15 Nov 2026): a class is always
   RELEASE_AHEAD = 3 worksheets ahead of the one it is on. On worksheet n,
   students have every worksheet up to n + 3: the Next worksheet and the two
   after it. `releasedThrough(course)` works that out from the class's
   position every time it is read, so a worksheet added to the end of the
   list later is out at once when it falls within the three; it no longer
   waits locked for the class to move. The stored `releasedThrough` only
   adds to it (the admin can release further ahead by hand; a release is
   never taken back). The Ans Key app (polymathlc/anskey, `onlineReleased`)
   and the video page (watch-core.js `releasedTo`) apply the same rule. */
(function (root) {
  'use strict';

  /* ⏰ v1.15.0 (Zhi Kai, 16 Nov 2026): the lesson clock (lesson-clock.js).
     A class moves one worksheet on when each of its lessons is over (at the
     next lesson time: 5pm for 3 to 4:45pm), and a class day's answer key
     and videos reach students at that same moment. `courseNow` gives the
     class as it stands now; the page keeps every class through it. */
  var Clock = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('./lesson-clock.js') : root.PolymathLessonClock;
  function courseNow(course, now) { return Clock && course ? Clock.courseNow(course, now) : course; }

  var RELEASE_AHEAD = 3;          // on worksheet n, students have up to n + 3 (2 → 5): the next one and the two after it
  var NEXT_COUNT = 2;             // "the next two worksheets"
  var LEVELS = ['P3', 'P4', 'P5', 'P6'];
  var SUBJECTS = [
    { value: 'math', label: 'Mathematics', short: 'Maths' },
    { value: 'science', label: 'Science', short: 'Science' }
  ];
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  // The same three sessions a day as the Ans Key app's SLOTS_WEEKDAY / SLOTS_WEEKEND.
  var SLOTS_WEEKDAY = ['3:00pm', '5:00pm', '7:00pm'];
  var SLOTS_WEEKEND = ['9:00am', '11:00am', '1:00pm'];
  var ROLES = [
    { value: 'student', label: 'Student' },
    { value: 'parent', label: 'Parent' }
  ];

  // P3 is Science only at the centre — the Ans Key app's `levelSubjects`.
  function levelSubjects(level) {
    return level === 'P3' ? ['science'] : SUBJECTS.map(function (s) { return s.value; });
  }
  function subjectLabel(value, short) {
    for (var i = 0; i < SUBJECTS.length; i++) {
      if (SUBJECTS[i].value === value) return short ? SUBJECTS[i].short : SUBJECTS[i].label;
    }
    return value === 'both' ? (short ? 'Maths & Science' : 'Mathematics & Science') : String(value || '');
  }
  function cleanSubjects(level, subjects) {
    var allowed = levelSubjects(level);
    var out = [];
    (Array.isArray(subjects) ? subjects : [subjects]).forEach(function (s) {
      if (s === 'both') { allowed.forEach(function (a) { if (out.indexOf(a) < 0) out.push(a); }); return; }
      if (allowed.indexOf(s) >= 0 && out.indexOf(s) < 0) out.push(s);
    });
    return out.sort();
  }
  // The single subject field the Ans Key app's studentProfiles row expects.
  function profileSubjectFor(subjects) {
    var list = Array.isArray(subjects) ? subjects : [];
    if (list.indexOf('math') >= 0 && list.indexOf('science') >= 0) return 'both';
    return list[0] || '';
  }
  function isWeekend(day) { return day === 'Saturday' || day === 'Sunday'; }
  function slotsForDay(day) { return isWeekend(day) ? SLOTS_WEEKEND : SLOTS_WEEKDAY; }
  function slotLabel(day, slot) {
    if (!(slot === 0 || slot === 1 || slot === 2)) return '';
    return slotsForDay(day)[slot];
  }
  function courseTitle(course) {
    if (!course) return '';
    if (course.title) return course.title;
    return autoCourseTitle(course.level, course.subject, course.day, course.slot);
  }
  /* 📅 v1.16.0: what the big day band at the top left of each class segment
     shows. `key` picks the day's colour (mon … sun, or none). `className` is
     the class without its day and time when the title is the automatic one
     ("P6 Science"), or the admin's own title as typed. */
  var DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  function dayBand(course) {
    course = course || {};
    var at = DAYS.indexOf(course.day);
    var day = at >= 0 ? DAYS[at] : '';
    var time = day ? slotLabel(day, course.slot) : '';
    var auto = !course.title || course.title === autoCourseTitle(course.level, course.subject, course.day, course.slot);
    var className = auto
      ? (String(course.level || '').trim() + ' ' + subjectLabel(course.subject)).trim()
      : String(course.title);
    if (!className) className = 'Your class';
    return {
      key: at >= 0 ? DAY_KEYS[at] : 'none',
      day: day,
      dayUpper: day.toUpperCase(),
      time: time,
      className: className,
      sentence: day ? day + ' class' + (time ? ' · ' + time : '') : 'No class day set yet'
    };
  }
  function autoCourseTitle(level, subject, day, slot) {
    var bits = [String(level || '').trim() + ' ' + subjectLabel(subject)];
    if (day) bits.push(day + (slotLabel(day, slot) ? ' ' + slotLabel(day, slot) : ''));
    return bits.join(' · ').trim();
  }

  function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
  function isEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim()); }
  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function initials(name, email) {
    var source = String(name || '').trim() || String(email || '').split('@')[0];
    var parts = source.split(/[\s._-]+/).filter(Boolean);
    var first = parts[0] ? parts[0][0] : '?';
    var second = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + second).toUpperCase();
  }

  // "Worksheet 2" before "Worksheet 10", the way a person numbers files.
  function naturalCompare(a, b) {
    var ax = String(a || '').toLowerCase().match(/(\d+|\D+)/g) || [];
    var bx = String(b || '').toLowerCase().match(/(\d+|\D+)/g) || [];
    for (var i = 0; i < Math.max(ax.length, bx.length); i++) {
      var x = ax[i], y = bx[i];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      var nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) {
        var d = Number(x) - Number(y);
        if (d) return d;
        if (x.length !== y.length) return x.length - y.length;
      } else if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  function worksheetNameFromFile(fileName) {
    return String(fileName || 'Worksheet').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Worksheet';
  }

  /* ---- A class's progress ---- */
  function num(value, fallback) { return typeof value === 'number' && isFinite(value) ? value : fallback; }
  function courseIds(course) { return course && Array.isArray(course.worksheetIds) ? course.worksheetIds : []; }
  function currentIndex(course) { return Math.min(num(course && course.currentIndex, -1), courseIds(course).length - 1); }
  // How far the class is released: never less than RELEASE_AHEAD past the
  // worksheet the class is on (once it has started), plus anything the
  // admin released further by hand. Worked out on every read, so it holds
  // for old classes and for worksheets added to the list afterwards.
  function releaseFloor(course) {
    var cur = num(course && course.currentIndex, -1);
    return cur >= 0 ? Math.floor(cur) + RELEASE_AHEAD : -1;
  }
  function releasedThrough(course) {
    var stored = num(course && course.releasedThrough, -1);
    return Math.min(Math.max(stored, releaseFloor(course)), courseIds(course).length - 1);
  }
  function releasedCount(course) { return Math.max(0, releasedThrough(course) + 1); }
  // The worksheets still to come for students: not released yet, and not
  // archived (an archived worksheet will not "appear later in the term").
  function lockedCount(course) {
    var ids = courseIds(course), rel = releasedThrough(course), n = 0;
    for (var i = rel + 1; i < ids.length; i++) if (!isArchived(course, ids[i])) n += 1;
    return n;
  }

  /* ---- 🗄 Archived for students (v1.13.0) ----
     Zhi Kai, 15 Nov 2026: "allow me to archive items on the worksheet
     timeline as sometimes I don't want students to see them anymore but am
     afraid I need those entries at a later date."

     Two kinds of item can be archived, per class:
       a whole worksheet          course.archivedWorksheets: [worksheetId]
       one class day of one       course.archivedDays: ['worksheetId|YYYY-MM-DD']
         worksheet (that day's lesson videos and that day's answer key PDF)

     Nothing is deleted or moved. The worksheet keeps its place in the class
     list, so the class position (Current / Next in Ans Key), the release
     arithmetic and the worksheet numbers are exactly as before; archiving
     only takes the item out of what STUDENTS are shown, by the same rules
     that decide what is released: the timeline, the Worksheets / Answer keys
     / Videos tabs, Up next, "This lesson's answer key", the lesson video page
     (watch-core.js `releasedTo` / `lessonsOf`) and the Ans Key app's student
     list (anskey `onlineReleased`). Restoring takes the id back out of the
     list and everything shows again as it was. */
  var ARCHIVE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
  var ARCHIVE_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  function archivedWorksheetIds(course) {
    var list = course && Array.isArray(course.archivedWorksheets) ? course.archivedWorksheets : [];
    return list.filter(function (id) { return typeof id === 'string' && ARCHIVE_ID_RE.test(id); });
  }
  function isArchived(course, id) {
    return !!id && archivedWorksheetIds(course).indexOf(String(id)) >= 0;
  }
  function dayArchiveKey(id, key) {
    if (!ARCHIVE_ID_RE.test(String(id || '')) || !ARCHIVE_DAY_RE.test(String(key || ''))) return '';
    return String(id) + '|' + String(key);
  }
  // Every archived class day of a class: [{ id, key }], in stored order.
  function archivedDayList(course) {
    var list = course && Array.isArray(course.archivedDays) ? course.archivedDays : [];
    var out = [], seen = {};
    list.forEach(function (entry) {
      if (typeof entry !== 'string' || seen[entry]) return;
      var at = entry.lastIndexOf('|');
      if (at <= 0) return;
      var id = entry.slice(0, at), key = entry.slice(at + 1);
      if (!dayArchiveKey(id, key)) return;
      seen[entry] = true;
      out.push({ id: id, key: key });
    });
    return out;
  }
  // The archived class days of one worksheet in one class: ['YYYY-MM-DD'].
  function archivedDaysOf(course, id) {
    return archivedDayList(course).filter(function (d) { return d.id === id; }).map(function (d) { return d.key; });
  }
  function isDayArchived(course, id, key) {
    var k = dayArchiveKey(id, key);
    if (!k) return false;
    return archivedDayList(course).some(function (d) { return d.id === id && d.key === key; });
  }
  // How many items are archived in a class (worksheets + class days).
  function archivedCount(course) {
    return archivedWorksheetIds(course).length + archivedDayList(course).length;
  }
  // The field to write for an Archive or Restore tap: { field, value }, or
  // null when there is nothing to change. Pure, so the page writes the whole
  // new list in one transaction with the live document.
  //   kind 'worksheet' → archivedWorksheets, kind 'day' → archivedDays.
  function archiveUpdate(course, kind, id, key, archive) {
    if (kind === 'worksheet') {
      if (!ARCHIVE_ID_RE.test(String(id || ''))) return null;
      var ids = archivedWorksheetIds(course);
      var has = ids.indexOf(id) >= 0;
      if (archive === has) return null;
      // Only a worksheet that is in this class can be archived in it.
      if (archive && courseIds(course).indexOf(id) < 0) return null;
      return { field: 'archivedWorksheets', value: archive ? ids.concat([id]) : ids.filter(function (x) { return x !== id; }) };
    }
    if (kind === 'day') {
      var k = dayArchiveKey(id, key);
      if (!k) return null;
      var days = archivedDayList(course).map(function (d) { return d.id + '|' + d.key; });
      var hasDay = days.indexOf(k) >= 0;
      if (archive === hasDay) return null;
      if (archive && courseIds(course).indexOf(id) < 0) return null;
      return { field: 'archivedDays', value: archive ? days.concat([k]) : days.filter(function (x) { return x !== k; }) };
    }
    return null;
  }
  // Recorded lessons a student may see on one worksheet of one class: the
  // ones not taught on an archived class day.
  // ⏰ v1.15.0: and only lessons that are over (see lesson-clock.js). The
  // admin's page passes `opts.all` to see everything at once.
  function visibleRecordings(course, id, recordings, now, opts) {
    var hidden = archivedDaysOf(course, id);
    var list = Array.isArray(recordings) ? recordings : [];
    var all = !!(opts && opts.all) || !Clock;
    return list.filter(function (r) {
      if (!r) return false;
      if (hidden.length && hidden.indexOf(lessonDayKey(r.at)) >= 0) return false;
      return all || Clock.recordingOpen(course, r.at, now);
    });
  }
  // A worksheet's answer key PDFs a student may see in one class, newest first.
  function visibleAnswerKeys(course, id, doc, now, opts) {
    var hidden = archivedDaysOf(course, id);
    var all = !!(opts && opts.all) || !Clock;
    return answerKeysOf(doc, now).filter(function (k) {
      return hidden.indexOf(k.key) < 0 && (all || Clock.dayOpen(course, k.key, now));
    });
  }
  // What the admin's Archived list shows for a class: the archived
  // worksheets in teaching order, then the archived class days, newest day
  // first. A worksheet that has left the class list is still listed, so its
  // archive entry can be cleared.
  function archivedItems(course, docs, now) {
    docs = docs || {};
    var ids = courseIds(course);
    var nameOf = function (id) {
      var d = docs[id];
      var seq = ids.indexOf(id);
      return d && d.name ? String(d.name) : seq >= 0 ? 'Worksheet ' + (seq + 1) : 'A worksheet no longer in this class';
    };
    var worksheets = archivedWorksheetIds(course).map(function (id) {
      var seq = ids.indexOf(id);
      return { kind: 'worksheet', id: id, seq: seq, name: nameOf(id), inClass: seq >= 0, released: seq >= 0 && seq <= releasedThrough(course) };
    }).sort(function (p, q) { return (p.seq < 0 ? 1e9 : p.seq) - (q.seq < 0 ? 1e9 : q.seq); });
    var days = archivedDayList(course).map(function (d) {
      var seq = ids.indexOf(d.id);
      return { kind: 'day', id: d.id, key: d.key, seq: seq, name: nameOf(d.id), label: formatDay(dayNoon(d.key), now), inClass: seq >= 0, worksheetArchived: isArchived(course, d.id) };
    }).sort(function (p, q) { return p.key < q.key ? 1 : p.key > q.key ? -1 : (p.seq - q.seq); });
    return { worksheets: worksheets, days: days, count: worksheets.length + days.length };
  }
  /* ---- 🔗 Shared answer keys and videos (v1.17.0) ----
     Zhi Kai, 16 Nov 2026: the three P6 Science classes (Monday 7pm, Tuesday
     5pm, Saturday 9am) do the same worksheets, but the answer key and the
     lesson videos made in one class only showed in that class, so Tuesday
     and Saturday had "No lesson videos yet". "Have an option to set one
     class's answer key for other classes, as they may have slower
     progression or something happened to the pdf or video recordings."

     A class can now use another class's answer key PDFs and lesson videos.
     Nothing is copied and nothing is deleted: the class only POINTS at the
     other class, so whatever that class records later shows here too, and
     taking the setting off puts everything back as it was. Three settings
     on the class (onlineCourses/{id}):

       shareFrom: '<class id>'   follow that class. Each worksheet of this
                                 class is matched with the same worksheet
                                 there (`shareMatch`: a copy of the same
                                 original, or the same name).
       shareMode: 'fill'         (default) only where this class has no
                                 videos / no answer key PDF of its own, so
                                 its own lessons always win;
                  'replace'      always that class's, instead of its own.
       sharedKeys: { '<worksheet id>': { course, ws } }
                                 one worksheet set by hand to one worksheet
                                 of any class (always used instead of its
                                 own), or { own: true } to keep its own even
                                 while the class follows another.

     When students see a shared answer key or video (the lesson clock rule):
     only once THEIR OWN class has finished that worksheet (`sharedOpen`), so
     a slower class never sees the answers before its own lesson, and each
     item only once it was out in the class it comes from. This class's own
     archive (whole worksheet or class day) still hides it here: archiving
     stays per class. Admins see everything. */
  var SHARE_MODES = ['fill', 'replace'];
  function shareMode(course) { return course && course.shareMode === 'replace' ? 'replace' : 'fill'; }
  function courseById(courses, id) {
    if (!courses || !id) return null;
    if (Array.isArray(courses)) { for (var i = 0; i < courses.length; i++) if (courses[i] && courses[i].id === id) return courses[i]; return null; }
    var c = courses[id];
    return c ? (c.id ? c : Object.assign({ id: id }, c)) : null;
  }
  function sharedEntries(course) {
    var map = course && course.sharedKeys && typeof course.sharedKeys === 'object' && !Array.isArray(course.sharedKeys) ? course.sharedKeys : {};
    var out = {};
    Object.keys(map).forEach(function (id) {
      var e = map[id];
      if (!ARCHIVE_ID_RE.test(id) || !e || typeof e !== 'object') return;
      if (e.own === true) { out[id] = { own: true }; return; }
      var c = String(e.course || ''), ws = String(e.ws || '');
      if (ARCHIVE_ID_RE.test(c) && ARCHIVE_ID_RE.test(ws) && !(ws === id && c === (course && course.id))) out[id] = { course: c, ws: ws };
    });
    return out;
  }
  function followedCourseId(course) {
    var id = course && typeof course.shareFrom === 'string' ? course.shareFrom : '';
    return ARCHIVE_ID_RE.test(id) && id !== (course && course.id) ? id : '';
  }
  // A worksheet name as two classes would both write it: case, spaces,
  // punctuation and "Worksheet"/"WS" do not matter.
  function shareNameKey(name) {
    return String(name || '').toLowerCase().replace(/\.pdf$/, '').replace(/\bworksheets?\b/g, 'ws')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /* The worksheet of `source` that is the same as `wsId` of `course`: the
     same id, a copy of the same original (Duplicate class, Browse Ans Key),
     or the same name. With several, the one at the same place in the list. */
  function shareMatch(course, wsId, source, docs) {
    var ids = courseIds(source);
    if (!ids.length || !wsId) return '';
    if (ids.indexOf(wsId) >= 0) return wsId;
    docs = docs || {};
    var seq = courseIds(course).indexOf(wsId);
    function pick(list) {
      if (!list.length) return '';
      if (seq >= 0 && list.indexOf(ids[seq]) >= 0) return ids[seq];
      return list[0];
    }
    if (docs[wsId]) {
      var root = copyRoot(wsId, docs);
      var family = ids.filter(function (id) { return copyRoot(id, docs) === root; });
      if (family.length) return pick(family);
    }
    var key = docs[wsId] && !docs[wsId].missing ? shareNameKey(docs[wsId].name) : '';
    if (!key) return '';
    return pick(ids.filter(function (id) { return docs[id] && !docs[id].missing && shareNameKey(docs[id].name) === key; }));
  }
  /* Where one worksheet of a class takes its shared answer key and videos
     from: { course, ws, mode: 'fill'|'replace', pinned }, or null. */
  function shareSourceOf(course, wsId, courses, docs) {
    if (!course || !wsId) return null;
    var entry = sharedEntries(course)[wsId];
    if (entry && entry.own) return null;
    if (entry) {
      var pinnedCourse = courseById(courses, entry.course);
      if (pinnedCourse && courseIds(pinnedCourse).indexOf(entry.ws) >= 0) return { course: pinnedCourse, ws: entry.ws, mode: 'replace', pinned: true };
      return null;
    }
    var followed = courseById(courses, followedCourseId(course));
    if (!followed) return null;
    var ws = shareMatch(course, wsId, followed, docs);
    return ws ? { course: followed, ws: ws, mode: shareMode(course), pinned: false } : null;
  }
  // Every worksheet a class's students need read for its shared items.
  function shareSourceIds(course, courses, docs) {
    var out = [];
    var followed = courseById(courses, followedCourseId(course));
    if (followed) courseIds(followed).forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
    var entries = sharedEntries(course);
    Object.keys(entries).forEach(function (id) { var e = entries[id]; if (e.ws && out.indexOf(e.ws) < 0) out.push(e.ws); });
    return out;
  }
  // Students of `course` see the shared items of worksheet `seq` once their
  // class has finished it (moved past it, by the lesson clock or Finished).
  function sharedOpen(course, seq) {
    var cur = currentIndex(course);
    return seq >= 0 && cur >= 0 && seq < cur;
  }
  /* What one worksheet shows, own and shared together:
       { recordings, answerKeys, shared: null | { courseId, courseTitle, ws,
         videos: bool, keys: bool, pinned, mode, waiting } }
     `opts.all` (admins): every item at once. */
  function sharedView(course, w, docs, recordings, courses, opts) {
    docs = docs || {}; recordings = recordings || {};
    var now = opts && opts.now, all = !!(opts && opts.all);
    var d = docs[w.id] || null;
    var ownRecs = visibleRecordings(course, w.id, recordings[w.id] || [], now, opts);
    var ownKeys = visibleAnswerKeys(course, w.id, d, now, opts);
    var src = shareSourceOf(course, w.id, courses, docs);
    if (!src) return { recordings: ownRecs, answerKeys: ownKeys, shared: null };
    var hidden = archivedDaysOf(course, w.id);
    // "Has its own": anything of its own at all, out yet or not, so the
    // class's own lesson is never swapped for another class's mid-lesson.
    var hasOwnRecs = (recordings[w.id] || []).some(function (r) { return r && hidden.indexOf(lessonDayKey(r.at)) < 0; });
    var hasOwnKeys = answerKeysOf(d, now).some(function (k) { return hidden.indexOf(k.key) < 0; });
    var takeRecs = src.mode === 'replace' || !hasOwnRecs;
    var takeKeys = src.mode === 'replace' || !hasOwnKeys;
    var open = all || sharedOpen(course, w.seq);
    var srcRecs = (recordings[src.ws] || []).filter(function (r) {
      if (!r || hidden.indexOf(lessonDayKey(r.at)) >= 0) return false;
      return all || (open && (!Clock || Clock.recordingOpen(src.course, r.at, now)));
    });
    var srcKeys = answerKeysOf(docs[src.ws], now).filter(function (k) {
      if (hidden.indexOf(k.key) >= 0) return false;
      return all || (open && (!Clock || Clock.dayOpen(src.course, k.key, now)));
    });
    var usedRecs = takeRecs && srcRecs.length;
    var usedKeys = takeKeys && srcKeys.length;
    var waiting = !all && !open && ((takeRecs && (recordings[src.ws] || []).length) || (takeKeys && answerKeysOf(docs[src.ws], now).length)) ? true : false;
    return {
      recordings: usedRecs ? srcRecs : ownRecs,
      answerKeys: usedKeys ? srcKeys : ownKeys,
      shared: (usedRecs || usedKeys || waiting) ? {
        courseId: src.course.id, courseTitle: courseTitle(src.course), ws: src.ws,
        videos: !!usedRecs, keys: !!usedKeys, pinned: src.pinned, mode: src.mode, waiting: waiting
      } : null
    };
  }
  /* The admin's list for the Shared answer keys section of a class: every
     worksheet of the class with what it uses. */
  function shareRows(course, courses, docs, recordings) {
    docs = docs || {}; recordings = recordings || {};
    var entries = sharedEntries(course);
    return courseIds(course).map(function (id, seq) {
      var src = shareSourceOf(course, id, courses, docs);
      var ownRecs = (recordings[id] || []).length;
      var ownKeys = answerKeysOf(docs[id]).length;
      var srcRecs = src ? (recordings[src.ws] || []).length : 0;
      var srcKeys = src ? answerKeysOf(docs[src.ws]).length : 0;
      var uses = !src ? 'own' : src.mode === 'replace' ? 'shared' : (!ownRecs && srcRecs) || (!ownKeys && srcKeys) ? 'shared' : 'own';
      return {
        id: id, seq: seq, name: docs[id] && docs[id].name ? String(docs[id].name) : 'Worksheet ' + (seq + 1),
        kept: !!(entries[id] && entries[id].own), pinned: !!(src && src.pinned),
        source: src ? { courseId: src.course.id, courseTitle: courseTitle(src.course), ws: src.ws, seq: courseIds(src.course).indexOf(src.ws),
          name: docs[src.ws] && docs[src.ws].name ? String(docs[src.ws].name) : 'Worksheet ' + (courseIds(src.course).indexOf(src.ws) + 1) } : null,
        ownVideos: ownRecs, ownKeys: ownKeys, sourceVideos: srcRecs, sourceKeys: srcKeys, uses: uses,
        open: sharedOpen(course, seq)
      };
    });
  }
  // Worksheets of the followed class that this class does not have at all,
  // in that class's order: they can be added here (as copies of the PDF).
  function shareMissing(course, courses, docs) {
    var followed = courseById(courses, followedCourseId(course));
    if (!followed) return [];
    var matched = {};
    courseIds(course).forEach(function (id) { var m = shareMatch(course, id, followed, docs); if (m) matched[m] = true; });
    return courseIds(followed).filter(function (id) { return !matched[id] && docs && docs[id] && !docs[id].missing; });
  }
  // Other classes this one can follow, the same level and subject first.
  function shareChoices(course, courses) {
    var list = Array.isArray(courses) ? courses.slice() : Object.keys(courses || {}).map(function (k) { return courseById(courses, k); });
    return list.filter(function (c) { return c && c.id && c.id !== course.id; }).map(function (c) {
      return { id: c.id, title: courseTitle(c), same: c.level === course.level && c.subject === course.subject, count: courseIds(c).length, archived: !!c.archived };
    }).sort(function (p, q) {
      if (p.same !== q.same) return p.same ? -1 : 1;
      if (p.archived !== q.archived) return p.archived ? 1 : -1;
      return compareCourses(courseById(courses, p.id), courseById(courses, q.id));
    });
  }
  /* The fields to write for a sharing change (one transaction with the
     live class), or null when nothing changes.
       { kind: 'follow', from: '<class id>'|'', mode }
       { kind: 'mode', mode }
       { kind: 'pin', ws, from: { course, ws } }
       { kind: 'own', ws }        keep this worksheet's own
       { kind: 'clear', ws }      back to the class setting */
  function shareUpdate(course, change) {
    if (!course || !change) return null;
    if (change.kind === 'follow') {
      var from = String(change.from || '');
      if (from && (!ARCHIVE_ID_RE.test(from) || from === course.id)) return null;
      var mode = SHARE_MODES.indexOf(change.mode) >= 0 ? change.mode : shareMode(course);
      if (from === followedCourseId(course) && mode === shareMode(course)) return null;
      return { shareFrom: from, shareMode: mode };
    }
    if (change.kind === 'mode') {
      if (SHARE_MODES.indexOf(change.mode) < 0 || change.mode === shareMode(course)) return null;
      return { shareMode: change.mode };
    }
    var ws = String(change.ws || '');
    if (!ARCHIVE_ID_RE.test(ws) || courseIds(course).indexOf(ws) < 0) return null;
    var map = sharedEntries(course), had = JSON.stringify(map[ws] || null);
    if (change.kind === 'pin') {
      var f = change.from || {};
      if (!ARCHIVE_ID_RE.test(String(f.course || '')) || !ARCHIVE_ID_RE.test(String(f.ws || ''))) return null;
      if (f.ws === ws && f.course === course.id) return null;
      map[ws] = { course: String(f.course), ws: String(f.ws) };
    } else if (change.kind === 'own') map[ws] = { own: true };
    else if (change.kind === 'clear') delete map[ws];
    else return null;
    if (JSON.stringify(map[ws] || null) === had) return null;
    return { sharedKeys: map };
  }
  // Is `srcWs` really where `course` shares worksheet `wsId` from? The video
  // page checks a link with it before playing another class's lessons.
  function shareAllows(course, wsId, srcWs, courses) {
    if (!course || !wsId || !srcWs) return null;
    var entry = sharedEntries(course)[wsId];
    if (entry && entry.own) return null;
    if (entry) return entry.ws === srcWs ? courseById(courses, entry.course) : null;
    var followed = courseById(courses, followedCourseId(course));
    return followed && courseIds(followed).indexOf(srcWs) >= 0 ? followed : null;
  }

  function worksheetState(course, index) {
    var cur = currentIndex(course), rel = releasedThrough(course);
    if (index === cur) return 'current';
    if (index > cur && index <= cur + NEXT_COUNT && index <= rel && cur >= 0) return 'next';
    if (index <= rel) return 'released';
    return 'locked';
  }
  // What a student is shown: released worksheets, in teaching order.
  // 🗄 v1.13.0: an archived worksheet is never shown, released or not. It
  // keeps its number (seq) and the class keeps its position.
  function releasedWorksheets(course) {
    var ids = courseIds(course), rel = releasedThrough(course), out = [];
    for (var i = 0; i <= rel && i < ids.length; i++) {
      if (isArchived(course, ids[i])) continue;
      out.push({ id: ids[i], seq: i, state: worksheetState(course, i) });
    }
    return out;
  }
  // The next two after where the class is — released only, because a
  // student must never be told the name of a worksheet that is not out yet.
  function nextWorksheets(course, count) {
    var ids = courseIds(course), cur = currentIndex(course), rel = releasedThrough(course), out = [];
    var n = count || NEXT_COUNT;
    for (var i = cur + 1; i <= cur + n && i < ids.length; i++) {
      if (i <= rel && !isArchived(course, ids[i])) out.push({ id: ids[i], seq: i });
    }
    return out;
  }
  /* ---- 📌 What Ans Key shows: Current worksheet and Next worksheet ----
     The same rule as the Ans Key app's `onlineQueueState` (anskey v1.176.0).
     The class list here is the queue. Ans Key shows each class's CURRENT
     worksheet (the one the class is on and has yet to finish; worksheet 1
     before the first lesson) and its NEXT worksheet in the lesson, and keeps
     the rest queued. The next one loads by itself when the class moves on:
     the teacher opens the Next worksheet, or taps Finished. */
  function ansKeyAt(course) {
    var ids = courseIds(course);
    if (!ids.length) return -1;
    var cur = num(course && course.currentIndex, -1);
    if (cur < 0) return 0;
    return Math.min(Math.floor(cur), ids.length - 1);
  }
  // 'done' | 'current' | 'next' | 'queued', or '' outside the list.
  function ansKeyState(course, index) {
    var ids = courseIds(course);
    if (!(index >= 0 && index < ids.length)) return '';
    var at = ansKeyAt(course);
    if (index === at) return 'current';
    if (index === at + 1) return 'next';
    if (index < at) return 'done';
    return 'queued';
  }
  // "Finished": the class moves from its current worksheet to the next one,
  // releasing as far ahead as opening it in Ans Key would. Null on the last.
  function finishUpdate(course) {
    var ids = courseIds(course);
    var at = ansKeyAt(course);
    if (at < 0 || at + 1 >= ids.length) return null;
    var update = progressUpdate(course, at + 1);
    if (!update) return null;
    update.lastFinishedIndex = at;
    update.lastFinishedDocId = ids[at];
    return update;
  }

  // The same arithmetic the Ans Key app uses when the teacher opens a sheet.
  function progressUpdate(course, seq, options) {
    var ids = courseIds(course);
    var opts = options || {};
    if (!(seq >= 0 && seq < ids.length)) return null;
    var cur = num(course.currentIndex, -1), rel = num(course.releasedThrough, -1);
    // `force` is the admin putting the class back where it really is: the
    // position may move backwards, but what students already have stays out.
    var nextCur = opts.force ? seq : Math.max(cur, seq);
    var nextRel = Math.max(rel, Math.min(ids.length - 1, seq + RELEASE_AHEAD));
    return { currentIndex: nextCur, currentDocId: ids[nextCur], releasedThrough: nextRel };
  }
  function percent(part, whole) { return whole > 0 ? Math.round(100 * Math.max(0, Math.min(part, whole)) / whole) : 0; }

  /* ---- Who sees which class ---- */
  // A member's (level, subjects) pairs. Since November 2026 the approval at
  // polymathlc.com.sg/student decides them: each approved child adds its own
  // level and subjects (`access`), so a family with a P4 Science child and a
  // P6 Math child sees P4 Science and P6 Math — never P6 Science. A member row
  // without `access` (an invitation from before) is its one level + subjects.
  function accessPairs(member) {
    if (!member) return [];
    var out = [];
    function add(level, subjects) {
      if (LEVELS.indexOf(level) < 0) return;
      var clean = cleanSubjects(level, subjects);
      if (!clean.length) return;
      for (var i = 0; i < out.length; i++) {
        if (out[i].level === level) {
          clean.forEach(function (s) { if (out[i].subjects.indexOf(s) < 0) out[i].subjects.push(s); });
          out[i].subjects.sort();
          return;
        }
      }
      out.push({ level: level, subjects: clean });
    }
    if (Array.isArray(member.access)) {
      member.access.forEach(function (pair) { if (pair) add(pair.level, pair.subjects); });
      return out;
    }
    if (member.level) add(member.level, member.subjects);
    return out;
  }
  function memberSees(member, course) {
    if (!member || !course) return false;
    if (course.archived) return false;
    return accessPairs(member).some(function (pair) {
      return pair.level === course.level && pair.subjects.indexOf(course.subject) >= 0;
    });
  }

  /* ---- The approval at polymathlc.com.sg/student (studentAccess/{uid}) ---- */
  function studentAccessStatus(record) {
    if (!record) return 'none';
    var s = String(record.status || '').toLowerCase();
    return s === 'approved' || s === 'revoked' ? s : 'pending';
  }
  // Each approved child → its Online (level, subjects): "both" opens Maths and
  // Science, P3 stays Science only, and levels Online has no classes for
  // (P1, P2, secondary) add nothing.
  function accessFromStudentAccess(record) {
    var children = record && Array.isArray(record.children) ? record.children : [];
    return accessPairs({ access: children.map(function (child) {
      return child ? { level: child.level, subjects: child.subjects === 'both' ? ['both'] : [child.subjects] } : null;
    }) });
  }
  // The member the portal works with for an approved account: the approval's
  // levels and subjects, over whatever an older invitation said.
  function memberFromStudentAccess(record, existing, user) {
    var access = accessFromStudentAccess(record);
    var names = (record && Array.isArray(record.children) ? record.children : [])
      .map(function (c) { return c && c.name ? String(c.name) : ''; }).filter(Boolean);
    var base = {};
    Object.keys(existing || {}).forEach(function (key) { base[key] = existing[key]; });
    base.uid = (user && user.uid) || base.uid || (record && record.uid) || '';
    base.email = base.email || (user && user.email) || (record && record.email) || '';
    base.name = base.name || names.join(' & ') || (user && user.displayName) || '';
    base.role = base.role === 'parent' ? 'parent' : 'student';
    base.access = access;
    base.level = access.length ? access[0].level : '';
    base.subjects = access.length ? access[0].subjects.slice() : [];
    base.source = 'student-access';
    delete base.revoked;
    delete base.revokedAt;
    return base;
  }
  // Every level an approved account asked for, Online or not (for the "no
  // classes" note: a Secondary 1 child has no Online worksheets yet).
  function studentAccessLevels(record) {
    var out = [];
    (record && Array.isArray(record.children) ? record.children : []).forEach(function (c) {
      if (c && c.level && out.indexOf(c.level) < 0) out.push(String(c.level));
    });
    return out;
  }
  function coursesForMember(courses, member) {
    var list = Array.isArray(courses) ? courses : Object.keys(courses || {}).map(function (k) { return courses[k]; });
    return list.filter(function (c) { return memberSees(member, c); }).sort(compareCourses);
  }
  function compareCourses(a, b) {
    var la = LEVELS.indexOf(a.level), lb = LEVELS.indexOf(b.level);
    if (la !== lb) return la - lb;
    if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
    var da = DAYS.indexOf(a.day), db = DAYS.indexOf(b.day);
    if (da !== db) return (da < 0 ? 99 : da) - (db < 0 ? 99 : db);
    var sa = num(a.slot, 9), sb = num(b.slot, 9);
    if (sa !== sb) return sa - sb;
    return naturalCompare(courseTitle(a), courseTitle(b));
  }

  /* ---- List editing ---- */
  function moveItem(list, from, to) {
    var copy = list.slice();
    if (from < 0 || from >= copy.length || to < 0 || to >= copy.length || from === to) return copy;
    var item = copy.splice(from, 1)[0];
    copy.splice(to, 0, item);
    return copy;
  }
  // After a reorder or a removal the class keeps pointing at the SAME
  // worksheet it was on, wherever that worksheet now sits; how many are
  // released stays a count, so a reorder never releases or hides anything.
  function remapProgress(course, newIds) {
    var oldIds = courseIds(course);
    var cur = currentIndex(course);
    var curId = cur >= 0 ? oldIds[cur] : null;
    var newCur = curId ? newIds.indexOf(curId) : -1;
    var rel = releasedThrough(course);
    var newRel = Math.min(newIds.length - 1, rel);
    if (newCur > newRel) newRel = newCur;
    return { currentIndex: newCur, currentDocId: newCur >= 0 ? newIds[newCur] : null, releasedThrough: newRel };
  }

  /* ---- The invitation ---- */
  function inviteLink(base, inviteId) {
    return String(base || '').replace(/\/?$/, '/') + '?invite=' + encodeURIComponent(inviteId);
  }
  /* ---- The student timeline ----
     Each released worksheet, in teaching order, with the date the teacher
     last changed it in Ans Key (`updatedAt`, written on every Ans Key save)
     and the lessons recorded on it (video annotations carrying
     `lessonRecording`, stored inside the worksheet's own annotations). */
  function toMillis(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    if (typeof value.toMillis === 'function') { try { return value.toMillis(); } catch (e) { return 0; } }
    if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
    if (typeof value._seconds === 'number') return value._seconds * 1000;
    var parsed = Date.parse(value);
    return isFinite(parsed) ? parsed : 0;
  }
  function editedMillis(doc) { return doc ? toMillis(doc.updatedAt) || toMillis(doc.createdAt) : 0; }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // "Mon 13 Oct 2026" — the year only when it is not this year.
  function formatDay(ms, now) {
    if (!ms) return '';
    var d = new Date(ms), today = new Date(now || Date.now());
    return WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : '');
  }
  // "4:05 pm"
  function formatClock(ms) {
    if (!ms) return '';
    var d = new Date(ms), hour = d.getHours(), minute = d.getMinutes();
    return ((hour % 12) || 12) + ':' + (minute < 10 ? '0' : '') + minute + (hour < 12 ? ' am' : ' pm');
  }
  function parseAnnotations(json) {
    if (Array.isArray(json)) return json;
    if (typeof json !== 'string' || !json) return [];
    try { var list = JSON.parse(json); return Array.isArray(list) ? list : []; } catch (e) { return []; }
  }
  // The recorded lessons on a worksheet, newest first.
  function lessonRecordings(annotations) {
    return parseAnnotations(annotations).filter(function (a) {
      return a && a.type === 'video' && a.url && a.lessonRecording;
    }).map(function (a) {
      var rec = a.lessonRecording || {};
      var duration = Number(rec.duration) || 0;
      return {
        id: String(a.id || ''),
        // Ans Key keeps the length in milliseconds; this is seconds.
        title: String(rec.title || (rec.video ? 'Video lesson' : 'Lesson recording')).slice(0, 80),
        at: Number(a.ts) || 0,
        duration: Math.round(duration / 1000),
        video: !!rec.video,
        page: Number(a.page) || 1
      };
    }).filter(function (r) { return r.id; }).sort(function (p, q) { return q.at - p.at; });
  }
  // "12:04" or "1:02:09", from seconds.
  function formatDuration(seconds) {
    seconds = Math.max(0, Math.round(Number(seconds) || 0));
    var hrs = Math.floor(seconds / 3600), mins = Math.floor(seconds / 60) % 60, secs = seconds % 60;
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return hrs ? hrs + ':' + two(mins) + ':' + two(secs) : mins + ':' + two(secs);
  }
  // What the Ans Key link does once the worksheet is open (anskey ≥ v1.132.0).
  function anskeyLink(base, id, action, rec) {
    var url = base + '?ws=' + encodeURIComponent(id);
    if (['play', 'print-answers', 'print-worksheet'].indexOf(action) >= 0) url += '&do=' + action;
    if (action === 'play' && rec) url += '&rec=' + encodeURIComponent(rec);
    return url;
  }
  /* ---- 🎬 The lesson video player, a page of its own (portal v1.11.0) ----
     The Video buttons open online/watch.html — every lesson on the worksheet,
     oldest first, one after another, with the questions and pages marked on
     its timeline (watch-core.js) — never the Ans Key app. `day` starts at
     that class day's first lesson; `course` says which class it is watched
     from. Byte for byte watch-core.js's own watchLink (the tests compare). */
  var WATCH_WS_RE = /^[A-Za-z0-9_-]{1,128}$/;
  function watchLink(wsId, opts) {
    if (!WATCH_WS_RE.test(String(wsId || ''))) return '';
    opts = opts || {};
    var url = 'watch.html?ws=' + encodeURIComponent(wsId);
    if (opts.day && /^\d{4}-\d{2}-\d{2}$/.test(opts.day)) url += '&day=' + encodeURIComponent(opts.day);
    if (opts.rec && /^[A-Za-z0-9_-]{1,120}$/.test(String(opts.rec))) url += '&rec=' + encodeURIComponent(opts.rec);
    if (opts.t > 0) url += '&t=' + Math.floor(opts.t);
    if (opts.course && WATCH_WS_RE.test(String(opts.course))) url += '&c=' + encodeURIComponent(opts.course);
    // 🔗 v1.17.0: the lessons are another class's (shared), on worksheet `src`.
    if (opts.src && opts.src !== wsId && WATCH_WS_RE.test(String(opts.src))) url += '&src=' + encodeURIComponent(opts.src);
    return url;
  }
  /* ---- 🎬 The worksheet's video page: the SAME page as the QR code ----
     Ans Key (v1.196.0) files every worksheet's videos as one hosted list
     after each save and each lesson it records, and keeps its address on
     the worksheet as `videoPlaylist: {hash, token, n, at}`. Page 1 of the
     printed worksheet carries a QR code to `anskey/videos.html?<code>`;
     this portal opens exactly that page beside the worksheet, so the paper
     and the class timeline can never show two different lists. The code is
     packed the way Ans Key packs it (video-playlist.js `packCode`, byte for
     byte — tools/online-portal-tests.mjs compares them when anskey is
     checked out beside this repo). The page itself checks the file against
     the hash, so a wrong code here can only fail, never mislead. */
  var VIDEO_PAGE = 'videos.html';
  var VP_HASH_RE = /^vp1-\d{1,7}-[0-9a-f]{1,8}$/;
  var VP_TOKEN_RE = /^[0-9A-Za-z-]{16,80}$/;
  var VP_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var VP_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  function vpBytesToB64u(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function videoPackCode(hash, token) {
    if (!VP_HASH_RE.test(String(hash || '')) || typeof token !== 'string' || !VP_UUID_RE.test(token)) return '';
    var parts = hash.split('-');
    var len = Number(parts[1]), hv = parseInt(parts[2], 16);
    if (!(len >= 0 && len < 16777216) || !(hv >= 0 && hv <= 4294967295)) return '';
    var bytes = [(len >>> 16) & 255, (len >>> 8) & 255, len & 255,
      (hv >>> 24) & 255, (hv >>> 16) & 255, (hv >>> 8) & 255, hv & 255];
    var hex = token.replace(/-/g, '');
    for (var i = 0; i < 32; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    return vpBytesToB64u(bytes);
  }
  // The worksheet's filed list, checked, or null.
  function videoPlaylistOf(doc) {
    var p = doc && doc.videoPlaylist;
    if (!p || typeof p !== 'object') return null;
    if (!VP_HASH_RE.test(String(p.hash || '')) || !VP_TOKEN_RE.test(String(p.token || ''))) return null;
    var n = Math.max(0, Math.floor(Number(p.n) || 0));
    return { hash: String(p.hash), token: String(p.token), n: n, at: toMillis(p.at) };
  }
  // The page's address: Ans Key's videos.html with the same code the QR
  // carries, and `#day-YYYY-MM-DD` to start at one lesson day.
  function videoPageLink(anskeyBase, playlist, dayKey) {
    if (!playlist || !VP_HASH_RE.test(String(playlist.hash || '')) || !VP_TOKEN_RE.test(String(playlist.token || ''))) return '';
    var base = String(anskeyBase || '').split('#')[0].split('?')[0];
    if (base && !/\/$/.test(base)) base += '/';
    var code = videoPackCode(playlist.hash, playlist.token);
    var url = base + VIDEO_PAGE + '?' + (code || 'p=' + encodeURIComponent(playlist.hash) + '&t=' + encodeURIComponent(playlist.token));
    if (dayKey && VP_DAY_RE.test(dayKey)) url += '#day-' + dayKey;
    return url;
  }
  // Is the filed list up to date with the lessons on the worksheet? A
  // lesson recorded after the list was filed (or more lessons than the
  // list holds videos) means it is not yet — the old chooser is used then,
  // so a student never misses the newest lesson.
  function videoPlaylistCurrent(playlist, recordings) {
    if (!playlist || !playlist.n) return false;
    var recs = Array.isArray(recordings) ? recordings : [];
    if (recs.length > playlist.n) return false;
    if (!playlist.at) return true;
    return !recs.some(function (r) { return r && r.at && r.at > playlist.at + 1000; });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // The calendar day a lesson was recorded on, as videos.html reads it.
  function lessonDayKey(ms) {
    var n = Number(ms);
    if (!(n >= Date.UTC(2020, 0, 1) && n < Date.UTC(2100, 0, 1))) return '';
    var d = new Date(n);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  // The recorded lessons grouped by the day of the class they were taught
  // in, first lesson first: [{ key, label, at, count, seconds, ids }].
  // Lessons with no recorded time (very old ones) are left out of the days.
  function recordingDays(recordings, now) {
    var byKey = {}, out = [];
    (Array.isArray(recordings) ? recordings : []).forEach(function (r) {
      var key = r ? lessonDayKey(r.at) : '';
      if (!key) return;
      if (!byKey[key]) {
        byKey[key] = { key: key, label: formatDay(r.at, now), at: r.at, count: 0, seconds: 0, ids: [] };
        out.push(byKey[key]);
      }
      var g = byKey[key];
      if (r.at < g.at) g.at = r.at;
      g.count += 1;
      g.seconds += Number(r.duration) || 0;
      g.ids.push(r.id);
    });
    return out.sort(function (p, q) { return p.key < q.key ? -1 : p.key > q.key ? 1 : 0; });
  }

  /* 📄 The answer key as it stood after each class day. Ans Key exports the
     annotated answer key (with the video QR code) after every lesson and files
     it on the worksheet as `answerKeys: { 'YYYY-MM-DD': { url, at, pages,
     videos } }` (answer-key-online.js there). A link is used only when it is
     Firebase Storage's own, for a key file, with a token: never a URL that
     merely sits on the document. */
  var AK_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function answerKeyUrlOk(url) {
    var m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[A-Za-z0-9._-]+\/o\/([^?#]+)\?(.*)$/.exec(String(url || ''));
    if (!m) return false;
    var name;
    try { name = decodeURIComponent(m[1]); } catch (e) { return false; }
    if (!/^pdf-annotator\/lesson-key-[A-Za-z0-9_-]{1,80}-\d{4}-\d{2}-\d{2}\.pdf$/.test(name)) return false;
    var q = m[2].split('&');
    return q.indexOf('alt=media') >= 0 && q.some(function (kv) { return kv.indexOf('token=') === 0 && AK_TOKEN_RE.test(kv.slice(6)); });
  }
  function realDay(key) {
    if (!VP_DAY_RE.test(String(key || ''))) return false;
    var p = String(key).split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2] && p[0] >= 2020 && p[0] < 2100;
  }
  // A day key → the time at noon that day, for formatDay.
  function dayNoon(key) { var p = String(key).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12).getTime(); }
  // [{ key, label, url, at, pages, videos }], NEWEST class day first.
  function answerKeysOf(doc, now) {
    var map = doc && doc.answerKeys;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
    var out = [];
    Object.keys(map).forEach(function (key) {
      var e = map[key];
      if (!realDay(key) || !e || typeof e !== 'object' || !answerKeyUrlOk(e.url)) return;
      out.push({
        key: key, label: formatDay(dayNoon(key), now), url: String(e.url), at: toMillis(e.at),
        pages: Math.max(0, Math.floor(Number(e.pages) || 0)), videos: Math.max(0, Math.floor(Number(e.videos) || 0))
      });
    });
    return out.sort(function (p, q) { return p.key < q.key ? 1 : p.key > q.key ? -1 : 0; }).slice(0, 200);
  }
  /* Every class day of one worksheet, NEWEST first: that day's recorded
     lessons (from recordingDays) beside that day's answer key. A day with
     only one of them still shows. */
  function classDays(days, keys, now) {
    var byKey = {}, out = [];
    function slot(key) {
      if (!byKey[key]) { byKey[key] = { key: key, label: formatDay(dayNoon(key), now), video: null, answerKey: null }; out.push(byKey[key]); }
      return byKey[key];
    }
    (Array.isArray(days) ? days : []).forEach(function (d) { if (d && realDay(d.key)) slot(d.key).video = d; });
    (Array.isArray(keys) ? keys : []).forEach(function (k) { if (k && realDay(k.key)) slot(k.key).answerKey = k; });
    return out.sort(function (p, q) { return p.key < q.key ? 1 : p.key > q.key ? -1 : 0; });
  }

  // The timeline of one class: every released worksheet in teaching order,
  // with its state, its last-edited time and its recorded lessons.
  // 🗄 v1.13.0: archived worksheets are left out (releasedWorksheets) and so
  // are the lesson videos and answer keys of archived class days, so every
  // tab built from these items (Worksheets, Answer keys, Videos, Timeline)
  // hides them alike.
  // 🔗 v1.17.0: `ctx` = { courses, now, all } also brings in the answer
  // keys and videos a class shares from another (sharedView).
  function timelineItems(course, docs, recordings, ctx) {
    docs = docs || {}; recordings = recordings || {};
    return releasedWorksheets(course).map(function (w) {
      var d = docs[w.id] || null;
      var view = sharedView(course, w, docs, recordings, ctx && ctx.courses, ctx);
      var recs = view.recordings;
      var keys = view.answerKeys;
      return {
        shared: view.shared,
        id: w.id, seq: w.seq, state: w.state,
        name: d && d.name ? String(d.name) : 'Worksheet ' + (w.seq + 1),
        edited: editedMillis(d),
        // Written on in Ans Key yet? Before that, the date is just the upload.
        marked: !!(d && (d.annotationsPath || parseAnnotations(d.annotations).length)),
        pages: d && d.pageCount ? Number(d.pageCount) : 0,
        recordings: recs,
        // 🎬 The worksheet's video page (Ans Key's, the QR code's), and the
        // recorded lessons by the day of the class.
        playlist: videoPlaylistOf(d),
        days: recordingDays(recs),
        // 📄 The answer key PDF of every class day, newest first, and the
        // days themselves (videos and key side by side).
        answerKeys: keys,
        classDays: classDays(recordingDays(recs), keys),
        // How many class days of this worksheet are archived in this class.
        archivedDays: archivedDaysOf(course, w.id).length,
        loading: !d
      };
    });
  }

  /* ---- 🗂 The student's three tabs (v1.12.0) ----
     Zhi Kai, 15 Nov 2026: students were lost among the many buttons and
     could not find the worksheets. A student now lands on a Worksheets tab
     (the worksheets only, in neat rows to download or print), with an
     Answer keys tab and a Videos tab beside it; the full class timeline
     stays as a fourth tab. These group one class's timeline items for
     them, so the page only lays rows out.

     STUDENT_TABS: [value, label, icon]. Worksheets is the default. */
  var STUDENT_TABS = [
    ['worksheets', 'Worksheets', '📄'],
    ['answers', 'Answer keys', '🔑'],
    ['videos', 'Videos', '▶'],
    ['timeline', 'Timeline', '🗓']
  ];
  function studentTab(value) {
    var v = String(value || '').replace(/^#/, '').toLowerCase();
    for (var i = 0; i < STUDENT_TABS.length; i++) if (STUDENT_TABS[i][0] === v) return v;
    return 'worksheets';
  }
  // Worksheets tab: `now` is the one the class is on and the ones released
  // ahead of it, in teaching order (Current first); `earlier` the ones done,
  // the latest first. Before the first lesson, everything out is `now`.
  // Each row says which lesson it is for in plain words (`when`).
  function worksheetRows(course, items) {
    var cur = currentIndex(course);
    var now = [], earlier = [];
    (items || []).forEach(function (it) {
      if (cur >= 0 && it.seq < cur) earlier.push(Object.assign({}, it, { when: 'done', whenLabel: 'Done' }));
      else now.push(it);
    });
    var ahead = 0;
    now = now.map(function (it) {
      var when, label;
      if (cur >= 0 && it.seq === cur) { when = 'current'; label = 'This lesson'; }
      else if (cur < 0) { when = 'ready'; label = 'Ready'; }
      else { ahead += 1; when = ahead === 1 ? 'next' : 'ahead'; label = ahead === 1 ? 'Next lesson' : 'Coming up'; }
      return Object.assign({}, it, { when: when, whenLabel: label });
    });
    earlier.reverse();
    return { now: now, earlier: earlier };
  }
  // Answer keys tab: every released worksheet that has an answer key PDF,
  // the one the class is on first, then the rest newest key first. The
  // worksheet the class is on shows even before its key is out, so a
  // student knows it comes after the lesson.
  function answerKeyRows(course, items) {
    var cur = currentIndex(course);
    var rows = [];
    (items || []).forEach(function (it) {
      var keys = it.answerKeys || [];
      if (keys.length || (cur >= 0 && it.seq === cur)) {
        rows.push({ id: it.id, seq: it.seq, name: it.name, current: it.seq === cur, latest: keys[0] || null, earlier: keys.slice(1),
          shared: it.shared && it.shared.keys ? it.shared : null });
      }
    });
    return rows.sort(function (p, q) {
      if (p.current !== q.current) return p.current ? -1 : 1;
      var pk = p.latest ? p.latest.key : '', qk = q.latest ? q.latest.key : '';
      if (pk !== qk) return pk < qk ? 1 : -1;
      return q.seq - p.seq;
    });
  }
  // Videos tab: every released worksheet with recorded lessons, the one the
  // class is on first, then the latest lesson first. `days` is each class
  // day with its videos, newest first, for "start from this day".
  function videoRows(course, items) {
    var cur = currentIndex(course);
    var rows = [];
    (items || []).forEach(function (it) {
      var recs = it.recordings || [];
      if (!recs.length) return;
      var seconds = recs.reduce(function (n, r) { return n + (Number(r.duration) || 0); }, 0);
      var last = recs.reduce(function (n, r) { return Math.max(n, Number(r.at) || 0); }, 0);
      var days = (it.days || []).slice().reverse();
      rows.push({ id: it.id, seq: it.seq, name: it.name, current: it.seq === cur, count: recs.length, seconds: seconds, last: last, days: days,
        // 🔗 v1.17.0: videos another class shares: the video page plays that worksheet.
        shared: it.shared && it.shared.videos ? it.shared : null });
    });
    return rows.sort(function (p, q) {
      if (p.current !== q.current) return p.current ? -1 : 1;
      if (p.last !== q.last) return q.last - p.last;
      return q.seq - p.seq;
    });
  }

  // Every Polymath Online email goes out as the centre's own address, whichever
  // admin pressed the button. The Trigger Email extension reads `from` and
  // `replyTo` from each mail document, so replies land in the same inbox.
  var SENDER_EMAIL = 'admin@polymathlc.com.sg';
  var SENDER_NAME = 'Polymath Learning Centre';
  function portalMail(to, message, meta) {
    return {
      to: (Array.isArray(to) ? to : [to]).filter(Boolean),
      from: SENDER_NAME + ' <' + SENDER_EMAIL + '>',
      replyTo: SENDER_EMAIL,
      message: message,
      polymathOnline: Object.assign({ sender: SENDER_EMAIL }, meta || {})
    };
  }
  function inviteEmail(invite, link, fromName) {
    var who = String(invite.name || '').trim();
    var greeting = who ? 'Hi ' + who + ',' : 'Hello,';
    var subjects = (invite.subjects || []).map(function (s) { return subjectLabel(s); }).join(' and ');
    var forWhom = invite.role === 'parent' ? 'to follow your child\'s ' : 'for your ';
    var subject = 'Your Polymath Online invitation';
    var lines = [
      greeting,
      '',
      (fromName || 'Polymath Learning Centre') + ' has invited you to Polymath Online ' + forWhom + invite.level + ' ' + subjects + ' worksheets and answer keys.',
      '',
      'Join here: ' + link,
      '',
      'Sign in with a Google account to join. New worksheets appear on their own as the class goes, so there is nothing to download in advance.',
      '',
      'See you in class,',
      'Polymath Learning Centre'
    ];
    var html =
      '<div style="font-family:\'Century Gothic\',CenturyGothic,AppleGothic,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1A1A1A">' +
      '<img src="https://dl.dropboxusercontent.com/scl/fi/h40yjlyg8ldefwfaa3dib/polymath-logo-sticker.png?rlkey=o1ra4taqy79gt9t8u096v82zj" alt="Polymath Learning Centre" height="56" style="height:56px;margin-bottom:24px">' +
      '<p style="font-size:16px;line-height:1.6;margin:0 0 16px">' + escapeHtml(greeting) + '</p>' +
      '<p style="font-size:16px;line-height:1.6;margin:0 0 24px">' + escapeHtml(fromName || 'Polymath Learning Centre') + ' has invited you to <b>Polymath Online</b> ' + escapeHtml(forWhom) + '<b>' + escapeHtml(invite.level + ' ' + subjects) + '</b> worksheets and answer keys.</p>' +
      '<p style="margin:0 0 28px"><a href="' + escapeHtml(link) + '" style="display:inline-block;background:#FFE0B2;color:#3d2a08;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:12px;border:1px solid #FFB74D">Join Polymath Online</a></p>' +
      '<p style="font-size:14px;line-height:1.6;color:#5C5C5C;margin:0 0 8px">Sign in with a Google account to join. New worksheets appear on their own as the class goes.</p>' +
      '<p style="font-size:12px;line-height:1.6;color:#8A8A8A;margin:24px 0 0">If the button does not work, open this link: <br><a href="' + escapeHtml(link) + '" style="color:#8A5A12">' + escapeHtml(link) + '</a></p>' +
      '</div>';
    return { subject: subject, text: lines.join('\n'), html: html };
  }
  function mailtoLink(invite, link) {
    var mail = inviteEmail(invite, link);
    return 'mailto:' + encodeURIComponent(invite.email || '') + '?subject=' + encodeURIComponent(mail.subject) + '&body=' + encodeURIComponent(mail.text);
  }
  function inviteStatusLabel(invite) {
    if (!invite) return '';
    if (invite.status === 'joined') return 'Joined';
    if (invite.status === 'revoked') return 'Revoked';
    return 'Invited';
  }

  function timeAgo(ms, now) {
    if (!ms) return '';
    var s = Math.max(0, Math.round(((now || Date.now()) - ms) / 1000));
    if (s < 60) return 'just now';
    var m = Math.round(s / 60); if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24); if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
    var mo = Math.round(d / 30); return mo + (mo === 1 ? ' month ago' : ' months ago');
  }
  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }
  function safeFileName(name) {
    return String(name || 'Worksheet').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) + '.pdf';
  }

  // Whether a focused field is something being typed in, so a re-render puts
  // the text back. A file picker, tick box or button never is.
  function keepsTyping(tagName, type) {
    var tag = String(tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    return /^(|text|search|email|url|tel|number|password|date|time|datetime-local|month|week)$/i.test(String(type || ''));
  }
  // The words beside each file while a batch uploads.
  function uploadStateLabel(state) {
    var s = String(state || '');
    if (s === 'waiting') return 'queued';
    if (s === 'reading') return 'reading…';
    if (s === 'uploading') return 'uploading…';
    if (s === 'added') return '✓ added';
    return s;
  }
  // The line above the list: how many are done, and one bar for the batch.
  function uploadSummary(items) {
    var list = items || [], n = list.length;
    var added = list.filter(function (u) { return u.state === 'added'; }).length;
    var failed = list.filter(function (u) { return /^failed/.test(String(u.state || '')); }).length;
    var finished = added + failed;
    var pct = n ? Math.round(list.reduce(function (sum, u) {
      return sum + (u.state === 'added' || /^failed/.test(String(u.state || '')) ? 100 : Math.max(0, Math.min(100, Number(u.pct) || 0)));
    }, 0) / n) : 0;
    var label;
    if (!n) label = '';
    else if (finished < n) label = 'Uploading ' + (finished + 1) + ' of ' + n + '…';
    else if (!failed) label = n === 1 ? 'Uploaded' : 'All ' + n + ' uploaded';
    else label = added + ' of ' + n + ' uploaded, ' + failed + ' failed';
    return { total: n, added: added, failed: failed, pct: pct, label: label };
  }

  /* ---- Duplicating a class ---- */
  // The new class: same level and subject, no day or session yet (so its name
  // follows the day once one is chosen), not started and nothing released.
  function duplicateCourseData(course, by) {
    return {
      title: autoCourseTitle(course.level, course.subject, '', null),
      level: course.level, subject: course.subject,
      day: '', slot: null,
      worksheetIds: [], currentIndex: -1, releasedThrough: -1,
      copiedFrom: course.id || '', createdBy: by || ''
    };
  }
  // A copied worksheet keeps the teacher's answer key but not the lesson
  // recordings: those are the original class's lessons, and Ans Key only
  // replays a recording on the worksheet it was made on.
  function stripLessonRecordings(json) {
    var list;
    try { list = JSON.parse(json || '[]'); } catch (e) { return { json: '[]', removed: 0, kept: 0 }; }
    if (!Array.isArray(list)) return { json: '[]', removed: 0, kept: 0 };
    var kept = list.filter(function (a) { return !(a && a.lessonRecording); });
    return { json: JSON.stringify(kept), removed: list.length - kept.length, kept: kept.length };
  }
  // The fields of a copied worksheet, apart from its PDF, annotations and
  // timestamps, which the portal fills in as it copies them.
  function worksheetCopy(doc, opts) {
    var d = doc || {}, o = opts || {};
    var out = {
      name: String(d.name || 'Worksheet').slice(0, 120),
      level: o.level || d.level || '', subject: o.subject || d.subject || '',
      wsDay: '', wsSlot: null,
      hidden: false,
      storagePath: o.storageDir + '/' + o.id + '.pdf',
      starPages: Array.isArray(d.starPages) ? d.starPages.slice() : [],
      onlineCourseId: o.courseId, onlineSeq: o.seq, listOrder: o.seq,
      onlineCopiedFrom: o.fromId || '',
      onlineUploadedBy: o.by || '',
      ownerEmail: d.ownerEmail || o.teacherEmail || ''
    };
    if (d.ownerUid) out.ownerUid = d.ownerUid;
    if (d.pageCount) out.pageCount = d.pageCount;
    return out;
  }

  /* ---- 📂 Browse Ans Key (portal v1.10.0) ----
     The admin picks worksheets straight out of the Ans Key app's library
     (every `pdfAnnotator` document) instead of uploading files again:
       · as PREVIOUS worksheets: lessons the class has already had. They go
         in before the worksheet the class is on, count as done, and are
         released to students straight away;
       · as FUTURE worksheets: lessons still to come, at the end of the list,
         queued like any upload.
     For each one the admin chooses what comes with it: its ANSWER KEY (the
     teacher's writing on it in Ans Key, and the answer key PDFs Ans Key
     filed after each lesson) and its VIDEO RECORDINGS (the lessons recorded
     on it). A worksheet in no class, taken whole, joins the class as it is;
     anything else is copied, so the original and its class never change.
     A worksheet already in the class can also take its answer key and
     videos from another Ans Key worksheet ("From Ans Key" on its row). */

  // What a worksheet in the library carries, read from its document alone.
  // An answer key kept in Storage (`annotationsPath`) is too big to read for
  // a list, so it counts as written on; its videos are then known from the
  // video page Ans Key filed (`videoPlaylist.n`).
  function libraryInfo(doc) {
    var d = doc || {};
    var answers = 0, videos = 0;
    if (d.annotationsPath) {
      answers = 1;
      var vp = videoPlaylistOf(d);
      videos = vp ? vp.n : 0;
    } else {
      parseAnnotations(d.annotations).forEach(function (a) {
        if (!a) return;
        if (a.lessonRecording) { if (a.type === 'video' && a.url) videos++; }
        else answers++;
      });
    }
    return {
      answers: answers > 0,
      big: !!d.annotationsPath,
      videos: videos,
      keys: answerKeysOf(d).length,
      inClass: d.onlineCourseId ? String(d.onlineCourseId) : '',
      pages: d.pageCount ? Number(d.pageCount) || 0 : 0,
      hidden: !!d.hidden,
      hasPdf: !!d.storagePath
    };
  }
  // Does a library worksheet belong in the list being browsed? `scope` is
  // 'class' (the class's level and subject) or 'all'; `query` matches the
  // name, day and date, every word of it, in any order.
  function libraryMatches(doc, course, scope, query) {
    var d = doc || {};
    if (!d.storagePath) return false;
    if (scope !== 'all' && course) {
      if (d.level !== course.level) return false;
      if (d.subject !== course.subject && d.subject !== 'both') return false;
    }
    var words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    var hay = [d.name, d.wsDay, d.wsDate, d.level, subjectLabel(d.subject)].filter(Boolean).join(' ').toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) >= 0; });
  }
  // The library in the order it is browsed: newest lesson date first (the
  // date Ans Key files a worksheet under, else when it was made), then by name.
  function libraryOrder(list) {
    function when(item) {
      var d = item && item.data || {};
      if (d.wsDate && VP_DAY_RE.test(d.wsDate)) return dayNoon(d.wsDate);
      return toMillis(d.createdAt) || toMillis(d.updatedAt) || 0;
    }
    return (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
      var wa = when(a), wb = when(b);
      if (wa !== wb) return wb - wa;
      return naturalCompare(a && a.data && a.data.name, b && b.data && b.data.name);
    });
  }
  // Can a picked worksheet join the class as it is, or must it be copied?
  // Only one in no class, with everything it carries wanted, joins as it is.
  function libraryNeedsCopy(doc, bring, courseId) {
    var d = doc || {}, b = bring || {};
    if (d.onlineCourseId && d.onlineCourseId !== courseId) return true;
    if (d.onlineCourseId === courseId) return false;
    var info = libraryInfo(d);
    if (info.answers && !b.answers) return true;
    if (info.videos && !b.videos) return true;
    if (info.keys && !b.answers) return true;
    return false;
  }
  // Where the picked worksheets go and where the class then stands.
  //   'future':   at the end; the class stays exactly where it is.
  //   'previous': just before the worksheet the class is on (at the start of
  //               a class not started yet). They are done: the class moves
  //               past them, and they are released to students. A class not
  //               started yet is then on the first worksheet after them.
  // Ids already in the class are left where they are, not added twice.
  function placeWorksheets(course, addIds, mode) {
    var ids = courseIds(course).slice();
    var add = [];
    (Array.isArray(addIds) ? addIds : []).forEach(function (id) {
      if (id && ids.indexOf(id) < 0 && add.indexOf(id) < 0) add.push(id);
    });
    var cur = currentIndex(course), rel = releasedThrough(course);
    var k = add.length;
    if (mode !== 'previous') {
      var tail = ids.concat(add);
      return {
        worksheetIds: tail, insertedAt: ids.length, added: k,
        currentIndex: cur, currentDocId: cur >= 0 ? tail[cur] : null, releasedThrough: rel
      };
    }
    var at = cur >= 0 ? cur : 0;
    var out = ids.slice(0, at).concat(add, ids.slice(at));
    var nextCur;
    if (cur >= 0) nextCur = cur + k;
    else nextCur = k ? Math.min(k, out.length - 1) : -1;
    // Released stays released (shifted with its worksheets), and every
    // previous worksheet is out.
    var nextRel = rel >= 0 ? (rel >= at ? rel + k : rel) : -1;
    nextRel = Math.max(nextRel, at + k - 1);
    if (nextCur >= 0 && cur >= 0) nextRel = Math.max(nextRel, nextCur);
    nextRel = Math.min(nextRel, out.length - 1);
    return {
      worksheetIds: out, insertedAt: at, added: k,
      currentIndex: nextCur, currentDocId: nextCur >= 0 ? out[nextCur] : null, releasedThrough: nextRel
    };
  }
  // A worksheet's annotations with another one's answer key and/or videos.
  //   answers: the source's writing REPLACES the target's (one answer key).
  //   videos:  the source's recorded lessons are ADDED beside the target's
  //            own, once each (a lesson already there is not doubled).
  // The target keeps whatever was not asked for. Returns the new JSON and
  // how many of each came across.
  function mergeAnnotations(targetJson, sourceJson, bring) {
    var b = bring || {};
    var target = parseAnnotations(targetJson), source = parseAnnotations(sourceJson);
    var isRec = function (a) { return !!(a && a.lessonRecording); };
    var keepAnswers = target.filter(function (a) { return a && !isRec(a); });
    var keepVideos = target.filter(isRec);
    var srcAnswers = source.filter(function (a) { return a && !isRec(a); });
    var srcVideos = source.filter(function (a) { return isRec(a) && a.type === 'video' && a.url; });
    var have = {};
    keepVideos.forEach(function (a) { if (a.id) have[a.id] = true; if (a.url) have['url:' + a.url] = true; });
    var addVideos = b.videos ? srcVideos.filter(function (a) { return !(a.id && have[a.id]) && !have['url:' + a.url]; }) : [];
    var answers = b.answers ? srcAnswers : keepAnswers;
    return {
      json: JSON.stringify(answers.concat(keepVideos, addVideos)),
      answers: b.answers ? srcAnswers.length : 0,
      videos: addVideos.length,
      replacedAnswers: b.answers ? keepAnswers.length : 0
    };
  }
  // Only what was asked for, for a copy: the answer key, the videos, both or
  // neither (a clean worksheet).
  function pickAnnotations(sourceJson, bring) {
    return mergeAnnotations('[]', sourceJson, bring);
  }
  // The answer key PDFs filed per class day: the target's own days win, the
  // source's fill the days the target has none for. Only real, checked
  // entries are carried (answerKeysOf's rule).
  function mergeAnswerKeyMaps(target, source) {
    var out = {};
    var add = function (doc) {
      var map = doc && doc.answerKeys;
      if (!map || typeof map !== 'object' || Array.isArray(map)) return;
      Object.keys(map).forEach(function (key) {
        var e = map[key];
        if (out[key] || !realDay(key) || !e || typeof e !== 'object' || !answerKeyUrlOk(e.url)) return;
        out[key] = e;
      });
    };
    add(target);
    add(source);
    return out;
  }
  // The words for what a worksheet brings, e.g. "answer key · 3 videos".
  function libraryBringLabel(info, bring) {
    var b = bring || {}, bits = [];
    if (b.answers && info && info.answers) bits.push('answer key');
    if (b.answers && info && info.keys) bits.push(info.keys + ' answer key PDF' + (info.keys === 1 ? '' : 's'));
    if (b.videos && info && info.videos) bits.push(info.videos + ' video' + (info.videos === 1 ? '' : 's'));
    return bits.length ? bits.join(' · ') : 'the worksheet only';
  }

  /* ---- 🔁 Replacing a worksheet's PDF ----
     The new file goes to the SAME storage path: Ans Key writes that path back
     on every save, so a new path would be undone by the next save. What
     changes is `pdfVersion` (milliseconds), and every cache of the file (this
     portal's and Ans Key's) keys on path plus version, so nobody is handed the
     old file. The answer key, name and place in the class stay as they are. */
  function pdfCacheKey(doc) {
    if (!doc || !doc.storagePath) return '';
    return doc.storagePath + (doc.pdfVersion ? '#v' + doc.pdfVersion : '');
  }
  // Worksheets copied by Duplicate class point back at their original
  // (`onlineCopiedFrom`). The family is every worksheet that leads back to the
  // same first original, wherever it sits; a missing original still ties its
  // copies together by its id.
  function copyRoot(id, docs) {
    var path = [], at = id;
    while (at && path.indexOf(at) < 0 && path.length < 50) {
      path.push(at);
      var d = docs && docs[at];
      if (!d || !d.onlineCopiedFrom) return at;
      at = d.onlineCopiedFrom;
    }
    // A loop (which Duplicate class never makes) still gives one answer
    // for every worksheet on it: the smallest id in the loop.
    var loop = at ? path.slice(path.indexOf(at)) : path;
    return loop.slice().sort()[0] || id;
  }
  function copyFamily(id, docs) {
    if (!docs || !docs[id]) return [id];
    var root = copyRoot(id, docs);
    var out = Object.keys(docs).filter(function (other) {
      var d = docs[other];
      return other !== id && d && !d.missing && d.storagePath && copyRoot(other, docs) === root;
    }).sort(function (a, b) {
      return naturalCompare(String(docs[a].onlineCourseId || ''), String(docs[b].onlineCourseId || '')) || naturalCompare(a, b);
    });
    return [id].concat(out);
  }
  // One line per copy for the Replace window: its class and place in it.
  function copyTargets(id, docs, courses) {
    return copyFamily(id, docs).slice(1).map(function (other) {
      var d = docs[other] || {};
      var course = courses && d.onlineCourseId ? courses[d.onlineCourseId] : null;
      var at = course ? courseIds(course).indexOf(other) : -1;
      return {
        id: other,
        name: d.name || 'Untitled worksheet',
        courseId: d.onlineCourseId || '',
        where: course ? courseTitle(course) + (at >= 0 ? ' · worksheet ' + (at + 1) : '') : (d.onlineCourseId ? 'A class no longer listed' : 'Ans Key only, in no class')
      };
    });
  }
  // What a replacement writes on each worksheet it reaches. `updatedAt` moves
  // too: the student timeline's date is "last changed", and this is a change.
  function replacementUpdate(opts) {
    var o = opts || {};
    var out = {
      pdfVersion: Number(o.version) || Date.now(),
      pdfFileName: String(o.fileName || '').slice(0, 160),
      pdfReplacedBy: o.by || ''
    };
    if (o.pageCount > 0) out.pageCount = o.pageCount;
    return out;
  }
  // A plain sentence when the page count changes, as the answer key is
  // written on page numbers. '' when it does not, or nothing is known.
  function pageChangeNote(oldCount, newCount) {
    var a = Number(oldCount) || 0, b = Number(newCount) || 0;
    if (!a || !b || a === b) return '';
    var pages = function (n) { return n + (n === 1 ? ' page' : ' pages'); };
    if (b < a) return 'The new PDF has ' + pages(b) + ' and the old one ' + pages(a) + '. Answers written on page ' + (b + 1) + (a - b > 1 ? ' to ' + a : '') + ' will have no page to sit on.';
    return 'The new PDF has ' + pages(b) + ' and the old one ' + pages(a) + '. The answer key stays on the same page numbers, so check that the pages are still in the same order.';
  }
  function replaceSummary(done, failed) {
    var n = done.length;
    if (!n && failed.length) return 'The PDF could not be replaced. ' + failed[0];
    var text = n === 1 ? 'Worksheet PDF replaced.' : 'PDF replaced in ' + n + ' worksheets.';
    return failed.length ? text + ' ' + failed.length + ' could not be replaced. ' + failed[0] : text + ' Answer keys are kept.';
  }

  var api = {
    Clock: Clock, courseNow: courseNow,
    nextChange: function (courses, now) { return Clock ? Clock.nextChange(courses, now) : 0; },
    dayOpen: function (course, key, now) { return !Clock || Clock.dayOpen(course, key, now); },
    recordingOpen: function (course, at, now) { return !Clock || Clock.recordingOpen(course, at, now); },
    releaseFloor: releaseFloor, RELEASE_AHEAD: RELEASE_AHEAD, NEXT_COUNT: NEXT_COUNT, LEVELS: LEVELS, SUBJECTS: SUBJECTS, DAYS: DAYS, ROLES: ROLES,
    SLOTS_WEEKDAY: SLOTS_WEEKDAY, SLOTS_WEEKEND: SLOTS_WEEKEND,
    levelSubjects: levelSubjects, subjectLabel: subjectLabel, cleanSubjects: cleanSubjects, profileSubjectFor: profileSubjectFor,
    slotsForDay: slotsForDay, slotLabel: slotLabel, courseTitle: courseTitle, dayBand: dayBand, DAY_KEYS: DAY_KEYS, autoCourseTitle: autoCourseTitle,
    normalizeEmail: normalizeEmail, isEmail: isEmail, escapeHtml: escapeHtml, initials: initials,
    naturalCompare: naturalCompare, worksheetNameFromFile: worksheetNameFromFile,
    watchLink: watchLink, VIDEO_PAGE: VIDEO_PAGE, videoPackCode: videoPackCode, videoPlaylistOf: videoPlaylistOf, videoPageLink: videoPageLink,
    videoPlaylistCurrent: videoPlaylistCurrent, lessonDayKey: lessonDayKey, recordingDays: recordingDays,
    answerKeyUrlOk: answerKeyUrlOk, answerKeysOf: answerKeysOf, classDays: classDays,
    libraryInfo: libraryInfo, libraryMatches: libraryMatches, libraryOrder: libraryOrder, libraryNeedsCopy: libraryNeedsCopy,
    placeWorksheets: placeWorksheets, mergeAnnotations: mergeAnnotations, pickAnnotations: pickAnnotations,
    mergeAnswerKeyMaps: mergeAnswerKeyMaps, libraryBringLabel: libraryBringLabel,
    courseIds: courseIds, currentIndex: currentIndex, releasedThrough: releasedThrough, releasedCount: releasedCount, lockedCount: lockedCount,
    worksheetState: worksheetState, releasedWorksheets: releasedWorksheets, nextWorksheets: nextWorksheets, progressUpdate: progressUpdate, percent: percent,
    ansKeyAt: ansKeyAt, ansKeyState: ansKeyState, finishUpdate: finishUpdate,
    memberSees: memberSees, coursesForMember: coursesForMember, compareCourses: compareCourses,
    accessPairs: accessPairs, studentAccessStatus: studentAccessStatus, accessFromStudentAccess: accessFromStudentAccess,
    memberFromStudentAccess: memberFromStudentAccess, studentAccessLevels: studentAccessLevels,
    moveItem: moveItem, remapProgress: remapProgress,
    toMillis: toMillis, editedMillis: editedMillis, formatDay: formatDay, formatClock: formatClock, parseAnnotations: parseAnnotations,
    archivedWorksheetIds: archivedWorksheetIds, isArchived: isArchived, dayArchiveKey: dayArchiveKey, archivedDayList: archivedDayList,
    archivedDaysOf: archivedDaysOf, isDayArchived: isDayArchived, archivedCount: archivedCount, archiveUpdate: archiveUpdate,
    visibleRecordings: visibleRecordings, visibleAnswerKeys: visibleAnswerKeys, archivedItems: archivedItems,
    STUDENT_TABS: STUDENT_TABS, studentTab: studentTab, worksheetRows: worksheetRows, answerKeyRows: answerKeyRows, videoRows: videoRows,
    lessonRecordings: lessonRecordings, formatDuration: formatDuration, anskeyLink: anskeyLink, timelineItems: timelineItems,
    SENDER_EMAIL: SENDER_EMAIL, SENDER_NAME: SENDER_NAME, portalMail: portalMail,
    inviteLink: inviteLink, inviteEmail: inviteEmail, mailtoLink: mailtoLink, inviteStatusLabel: inviteStatusLabel,
    timeAgo: timeAgo, chunk: chunk, safeFileName: safeFileName,
    keepsTyping: keepsTyping, uploadStateLabel: uploadStateLabel, uploadSummary: uploadSummary,
    duplicateCourseData: duplicateCourseData, stripLessonRecordings: stripLessonRecordings, worksheetCopy: worksheetCopy,
    pdfCacheKey: pdfCacheKey, copyRoot: copyRoot, copyFamily: copyFamily, copyTargets: copyTargets,
    replacementUpdate: replacementUpdate, pageChangeNote: pageChangeNote, replaceSummary: replaceSummary,
    SHARE_MODES: SHARE_MODES, shareMode: shareMode, sharedEntries: sharedEntries, followedCourseId: followedCourseId, shareNameKey: shareNameKey,
    shareMatch: shareMatch, shareSourceOf: shareSourceOf, shareSourceIds: shareSourceIds, sharedOpen: sharedOpen, sharedView: sharedView,
    shareRows: shareRows, shareMissing: shareMissing, shareChoices: shareChoices, shareUpdate: shareUpdate, shareAllows: shareAllows
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PolymathOnlineCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
