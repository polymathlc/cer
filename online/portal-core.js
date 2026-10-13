/* Polymath Online — the portal's rules, with no Firebase and no page in them.
   Loaded by online/index.html before portal.js (as window.PolymathOnlineCore)
   and by tools/online-portal-tests.mjs (through vm), so every rule that
   decides what a student sees is tested on its own.

   The release rule itself lives in the Ans Key app (polymathlc/anskey,
   `onlineWorksheetOpened`): opening worksheet n of a class moves the class
   to n and releases up to n + RELEASE_AHEAD. This file only ever READS it,
   except for the admin's own "set progress" control, which goes through
   `progressUpdate` so it obeys the same arithmetic. */
(function (root) {
  'use strict';

  var RELEASE_AHEAD = 5;          // on worksheet n, students have up to n + 5 (3 → 8)
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
  function releasedThrough(course) { return Math.min(num(course && course.releasedThrough, -1), courseIds(course).length - 1); }
  function releasedCount(course) { return Math.max(0, releasedThrough(course) + 1); }
  function lockedCount(course) { return Math.max(0, courseIds(course).length - releasedCount(course)); }
  function worksheetState(course, index) {
    var cur = currentIndex(course), rel = releasedThrough(course);
    if (index === cur) return 'current';
    if (index > cur && index <= cur + NEXT_COUNT && index <= rel && cur >= 0) return 'next';
    if (index <= rel) return 'released';
    return 'locked';
  }
  // What a student is shown: released worksheets, in teaching order.
  function releasedWorksheets(course) {
    var ids = courseIds(course), rel = releasedThrough(course), out = [];
    for (var i = 0; i <= rel && i < ids.length; i++) out.push({ id: ids[i], seq: i, state: worksheetState(course, i) });
    return out;
  }
  // The next two after where the class is — released only, because a
  // student must never be told the name of a worksheet that is not out yet.
  function nextWorksheets(course, count) {
    var ids = courseIds(course), cur = currentIndex(course), rel = releasedThrough(course), out = [];
    var n = count || NEXT_COUNT;
    for (var i = cur + 1; i <= cur + n && i < ids.length; i++) {
      if (i <= rel) out.push({ id: ids[i], seq: i });
    }
    return out;
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
  function memberSees(member, course) {
    if (!member || !course) return false;
    if (course.archived) return false;
    if (!member.level || course.level !== member.level) return false;
    var subjects = cleanSubjects(member.level, member.subjects);
    return subjects.indexOf(course.subject) >= 0;
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
  // The timeline of one class: every released worksheet in teaching order,
  // with its state, its last-edited time and its recorded lessons.
  function timelineItems(course, docs, recordings) {
    docs = docs || {}; recordings = recordings || {};
    return releasedWorksheets(course).map(function (w) {
      var d = docs[w.id] || null;
      return {
        id: w.id, seq: w.seq, state: w.state,
        name: d && d.name ? String(d.name) : 'Worksheet ' + (w.seq + 1),
        edited: editedMillis(d),
        // Written on in Ans Key yet? Before that, the date is just the upload.
        marked: !!(d && (d.annotationsPath || parseAnnotations(d.annotations).length)),
        pages: d && d.pageCount ? Number(d.pageCount) : 0,
        recordings: recordings[w.id] || [],
        loading: !d
      };
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

  var api = {
    RELEASE_AHEAD: RELEASE_AHEAD, NEXT_COUNT: NEXT_COUNT, LEVELS: LEVELS, SUBJECTS: SUBJECTS, DAYS: DAYS, ROLES: ROLES,
    SLOTS_WEEKDAY: SLOTS_WEEKDAY, SLOTS_WEEKEND: SLOTS_WEEKEND,
    levelSubjects: levelSubjects, subjectLabel: subjectLabel, cleanSubjects: cleanSubjects, profileSubjectFor: profileSubjectFor,
    slotsForDay: slotsForDay, slotLabel: slotLabel, courseTitle: courseTitle, autoCourseTitle: autoCourseTitle,
    normalizeEmail: normalizeEmail, isEmail: isEmail, escapeHtml: escapeHtml, initials: initials,
    naturalCompare: naturalCompare, worksheetNameFromFile: worksheetNameFromFile,
    courseIds: courseIds, currentIndex: currentIndex, releasedThrough: releasedThrough, releasedCount: releasedCount, lockedCount: lockedCount,
    worksheetState: worksheetState, releasedWorksheets: releasedWorksheets, nextWorksheets: nextWorksheets, progressUpdate: progressUpdate, percent: percent,
    memberSees: memberSees, coursesForMember: coursesForMember, compareCourses: compareCourses,
    moveItem: moveItem, remapProgress: remapProgress,
    toMillis: toMillis, editedMillis: editedMillis, formatDay: formatDay, formatClock: formatClock, parseAnnotations: parseAnnotations,
    lessonRecordings: lessonRecordings, formatDuration: formatDuration, anskeyLink: anskeyLink, timelineItems: timelineItems,
    SENDER_EMAIL: SENDER_EMAIL, SENDER_NAME: SENDER_NAME, portalMail: portalMail,
    inviteLink: inviteLink, inviteEmail: inviteEmail, mailtoLink: mailtoLink, inviteStatusLabel: inviteStatusLabel,
    timeAgo: timeAgo, chunk: chunk, safeFileName: safeFileName
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PolymathOnlineCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
