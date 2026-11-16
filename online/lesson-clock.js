/* ⏰ Lesson clock — when a lesson is over and what that changes (portal v1.15.0)
 *
 * Zhi Kai, 16 Nov 2026: "any answer key and videos will also be updated right
 * after the lesson at the end of the lesson timing, for example 5pm for a 3pm
 * to 4.45pm lesson", and the Ans Key app must load the next two worksheets
 * (the new Current and Next) by itself once the lesson is over.
 *
 * Every lesson is 1 h 45 min long and starts on one of the three lesson times
 * of its day (the same as the Ans Key app's SLOTS_WEEKDAY / SLOTS_WEEKEND):
 *
 *     Monday to Friday    3:00pm  5:00pm  7:00pm
 *     Saturday, Sunday    9:00am 11:00am  1:00pm
 *
 * A lesson is OVER at the next lesson time, two hours after it started:
 * 3:00 to 4:45pm is over at 5:00pm, 9:00 to 10:45am at 11:00am. That moment
 * is the RELEASE of the lesson, always in Singapore time, whatever the clock
 * of the device reading it says.
 *
 * 1. THE CLASS MOVES ON BY ITSELF. Each release of a class's lesson that has
 *    passed since the class's position was last written moves the class one
 *    worksheet on: the Next worksheet becomes Current and the one after it
 *    becomes Next. Nothing is written and nothing is scheduled: every reader
 *    (Polymath Online, the lesson video page, the trial emails and the Ans
 *    Key app, which has the same rule) works it out from the stored place
 *    and the clock, `courseNow`. A device that does write the class's place
 *    (Finished, Make current, a reorder) writes the place as it is NOW and
 *    stamps `clockAt`, so the moves already counted are never counted twice.
 *      · A class that has not started (currentIndex -1) waits for the
 *        teacher to start it, as before: a class made weeks ahead must not
 *        run through its list on its own.
 *      · "Finished" pressed DURING a lesson is that lesson's move: the class
 *        does not move again when the lesson ends.
 *      · A Next worksheet set by hand in Ans Key (`nextIndex`) is where the
 *        first move goes.
 *      · An archived class, a class with no day or lesson time, and the last
 *        worksheet of a list stay where they are.
 * 2. ANSWER KEYS AND VIDEOS OF A LESSON ARE OUT AT ITS RELEASE. A student
 *    sees a class day's answer key PDF and the lesson videos recorded in a
 *    lesson only once that lesson is over (`dayOpen`, `recordingOpen`). The
 *    teacher and the admins see them at once.
 *
 * Pure: no Firebase, no DOM. Loaded by online/index.html and watch.html as
 * `PolymathLessonClock`, required by the trial service (a copy in
 * shop-function/functions/lesson-clock.js, kept identical by the tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PolymathLessonClock = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SG_OFFSET_MS = 8 * 3600 * 1000;      // Singapore: UTC+8, no summer time
  var HOUR_MS = 3600 * 1000;
  var DAY_MS = 24 * HOUR_MS;
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var START_HOURS_WEEKDAY = [15, 17, 19];   // 3pm, 5pm, 7pm
  var START_HOURS_WEEKEND = [9, 11, 13];    // 9am, 11am, 1pm
  var LESSON_MINUTES = 105;                 // 1 h 45 min
  var RELEASE_AFTER_MINUTES = 120;          // over at the next lesson time
  var MAX_LESSONS = 60;                     // more than a year of weekly lessons
  var LOOK_BACK_MS = 400 * DAY_MS;

  function stampMs(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v instanceof Date) { var t = v.getTime(); return isFinite(t) ? t : 0; }
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (e) { return 0; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    if (typeof v._seconds === 'number') return v._seconds * 1000;
    var parsed = Date.parse(v);
    return isFinite(parsed) ? parsed : 0;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dayIndex(day) { return DAYS.indexOf(String(day || '')); }
  function validSlot(slot) { return slot === 0 || slot === 1 || slot === 2; }
  function isWeekendIndex(i) { return i === 0 || i === 6; }
  // The hour (Singapore) a lesson time starts on a day of the week, or -1.
  function startHour(day, slot) {
    var i = dayIndex(day);
    if (i < 0 || !validSlot(slot)) return -1;
    return (isWeekendIndex(i) ? START_HOURS_WEEKEND : START_HOURS_WEEKDAY)[slot];
  }
  // 'YYYY-MM-DD' of a moment, in Singapore.
  function sgDayKey(ms) {
    var n = Number(ms);
    if (!isFinite(n) || n <= 0) return '';
    var d = new Date(n + SG_OFFSET_MS);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  // Midnight (Singapore) of a 'YYYY-MM-DD', as a moment; NaN if not a day.
  function sgMidnight(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = Date.UTC(y, mo - 1, d);
    var back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return NaN;
    return t - SG_OFFSET_MS;
  }
  // Day of the week (0 Sunday) of a 'YYYY-MM-DD'.
  function weekdayOf(key) {
    var t = sgMidnight(key);
    return isFinite(t) ? new Date(t + SG_OFFSET_MS).getUTCDay() : -1;
  }

  /* The lesson of a class (day + lesson time) on the date `key`, when the
     date falls on the class's day: { day, start, end, release } in ms, or
     null. */
  function lessonOn(day, slot, key) {
    var h = startHour(day, slot);
    if (h < 0 || weekdayOf(key) !== dayIndex(day)) return null;
    var start = sgMidnight(key) + h * HOUR_MS;
    return { day: key, start: start, end: start + LESSON_MINUTES * 60000, release: start + RELEASE_AFTER_MINUTES * 60000 };
  }

  /* Every lesson of a class whose release falls in (fromMs, toMs], oldest
     first (at most MAX_LESSONS, the newest kept). */
  function lessonsBetween(day, slot, fromMs, toMs) {
    var out = [];
    var i = dayIndex(day);
    if (i < 0 || !validSlot(slot)) return out;
    var to = Number(toMs), from = Math.max(Number(fromMs) || 0, to - LOOK_BACK_MS);
    if (!(isFinite(to) && to > from)) return out;
    // The first date on the class's day at or before `from`'s date.
    var first = sgMidnight(sgDayKey(from));
    var wd = new Date(first + SG_OFFSET_MS).getUTCDay();
    var t = first - ((wd - i + 7) % 7) * DAY_MS;
    for (; t <= to; t += 7 * DAY_MS) {
      var lesson = lessonOn(day, slot, sgDayKey(t + 12 * HOUR_MS));
      if (!lesson) continue;
      if (lesson.release > from && lesson.release <= to) out.push(lesson);
    }
    return out.length > MAX_LESSONS ? out.slice(out.length - MAX_LESSONS) : out;
  }

  /* The next release of a class after `now` (ms), or 0 when it has no day
     and lesson time. */
  function nextRelease(day, slot, now) {
    var n = Number(now) || Date.now();
    var list = lessonsBetween(day, slot, n, n + 8 * DAY_MS);
    return list.length ? list[0].release : 0;
  }

  /* ---- 1. Where the class is now ---- */
  function idsOf(course) { return course && Array.isArray(course.worksheetIds) ? course.worksheetIds : []; }
  function storedIndex(course) {
    var v = course && course.currentIndex;
    return typeof v === 'number' && isFinite(v) ? Math.floor(v) : -1;
  }
  // When the class's place was last written: `clockAt` (every writer of the
  // place since portal v1.15.0 / Ans Key v1.206.0), or for older data the
  // times the class was last moved by hand.
  function anchorOf(course) {
    if (!course) return 0;
    return Math.max(stampMs(course.clockAt), stampMs(course.progressAt), stampMs(course.focusAt));
  }
  /* The lessons over since the class's place was written, each of which
     moves it one worksheet on. [] when the class does not move by itself. */
  function lessonsOver(course, now) {
    if (!course || course.archived) return [];
    var ids = idsOf(course), cur = storedIndex(course);
    if (!ids.length || cur < 0) return [];
    if (!validSlot(course.slot) || dayIndex(course.day) < 0) return [];
    var anchor = anchorOf(course);
    if (!anchor) return [];
    var n = Number(now);
    if (!isFinite(n) || n <= 0) n = Date.now();
    var list = lessonsBetween(course.day, course.slot, anchor, n);
    // "Finished" pressed during a lesson already moved the class for it.
    var finished = stampMs(course.finishedAt);
    if (list.length && finished && finished >= list[0].start && finished < list[0].release) list = list.slice(1);
    return list;
  }
  // A manual Next (Ans Key's `nextIndex`) that is a real other place, or -1.
  function manualNext(course, at) {
    var ids = idsOf(course);
    var n = course && typeof course.nextIndex === 'number' && isFinite(course.nextIndex) ? Math.floor(course.nextIndex) : -1;
    return n >= 0 && n < ids.length && n !== at ? n : -1;
  }
  /* The class as it stands at `now`: the same object when no lesson has
     ended since its place was written, otherwise a copy with
       currentIndex, currentDocId   moved one per lesson over (last one stays)
       progressAt                   the release that moved it last (ms)
       nextIndex, nextDocId         gone (a manual Next is used up)
       autoMoved                    how many worksheets it moved
       storedIndex                  the place as written
     Idempotent: courseNow(courseNow(c, t), t) is the same place. */
  function courseNow(course, now) {
    var lessons = lessonsOver(course, now);
    if (!lessons.length) return course;
    var ids = idsOf(course);
    var at = Math.min(storedIndex(course), ids.length - 1);
    var from = at;
    var manual = manualNext(course, at);
    lessons.forEach(function (lesson, i) {
      if (i === 0 && manual >= 0) at = manual;
      else if (at + 1 < ids.length) at += 1;
    });
    if (at === from) return course;      // on the last worksheet: it stays
    var out = {};
    Object.keys(course).forEach(function (k) { out[k] = course[k]; });
    var last = lessons[lessons.length - 1].release;
    out.currentIndex = at;
    out.currentDocId = ids[at];
    out.progressAt = last;
    out.clockAt = last;
    out.finishedAt = null;
    delete out.nextIndex;
    delete out.nextDocId;
    out.autoMoved = at - from;
    out.autoMovedAt = last;
    out.storedIndex = storedIndex(course);
    return out;
  }
  // The soonest release after `now` among some classes, to redraw at (0: none).
  function nextChange(courses, now) {
    var n = Number(now) || Date.now(), best = 0;
    (Array.isArray(courses) ? courses : Object.keys(courses || {}).map(function (k) { return courses[k]; })).forEach(function (c) {
      if (!c || c.archived) return;
      var r = nextRelease(c.day, c.slot, n);
      if (r && (!best || r < best)) best = r;
    });
    return best;
  }

  /* ---- 2. Answer keys and videos ---- */
  /* When a class day's answer key and videos are out to the class's
     students: that day at the class's lesson time + 2 h (Singapore). A class
     with no lesson time puts them out at once (0). */
  function dayReleaseAt(course, key) {
    if (!course) return 0;
    var i = dayIndex(course.day);
    if (i < 0 || !validSlot(course.slot)) return 0;
    var mid = sgMidnight(key);
    if (!isFinite(mid)) return 0;
    var h = startHour(course.day, course.slot);
    return mid + h * HOUR_MS + RELEASE_AFTER_MINUTES * 60000;
  }
  function dayOpen(course, key, now) {
    var at = dayReleaseAt(course, key);
    return !at || (Number(now) || Date.now()) >= at;
  }
  /* A lesson video recorded at `at` (ms): out at the release of that day's
     lesson, or at once when it was recorded after it. */
  function recordingOpen(course, at, now) {
    var t = Number(at) || 0;
    if (!t) return true;
    var rel = dayReleaseAt(course, sgDayKey(t));
    return !rel || t >= rel || (Number(now) || Date.now()) >= rel;
  }

  return {
    SG_OFFSET_MS: SG_OFFSET_MS, DAYS: DAYS, START_HOURS_WEEKDAY: START_HOURS_WEEKDAY, START_HOURS_WEEKEND: START_HOURS_WEEKEND,
    LESSON_MINUTES: LESSON_MINUTES, RELEASE_AFTER_MINUTES: RELEASE_AFTER_MINUTES,
    stampMs: stampMs, sgDayKey: sgDayKey, startHour: startHour, lessonOn: lessonOn, lessonsBetween: lessonsBetween,
    nextRelease: nextRelease, anchorOf: anchorOf, lessonsOver: lessonsOver, courseNow: courseNow, nextChange: nextChange,
    dayReleaseAt: dayReleaseAt, dayOpen: dayOpen, recordingOpen: recordingOpen
  };
});
