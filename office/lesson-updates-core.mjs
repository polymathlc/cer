/* ═══════════════════════════════════════════════════════════════════════════
   💬 PARENT WHATSAPP LESSON UPDATES — the rules (lesson-updates-core.mjs v1.0.0)

   Zhi Kai, 20 Nov 2026: "Implement 1" — the one-tap WhatsApp update after each
   lesson. After a lesson the office opens 💬 Lesson updates, sees every parent
   of that class with the message already written, and taps Send beside each
   one: WhatsApp (on a phone) or WhatsApp Web (on a computer) opens the chat
   with the text typed in, and they press send. Nothing is sent by a robot and
   no WhatsApp Business account is needed; it comes from the centre's own
   number. It extends the office's WhatsApp queue for invoices and reminders
   (the same C.whatsappLink, the same "polymath_whatsapp" window, the same
   Send ▶ Next flow) to lesson updates.

   Each message says, for ONE class on ONE day:
     • which class and when
     • what was covered     the worksheet the class worked on in that lesson,
                            from Polymath Online and the lesson clock
     • how the child did    the Ans Key live class's own progress book: the
                            questions answered and how many the teacher marked
                            right, and focus (left out when there is no record)
     • 🙋 v1.1.0: a child who was ABSENT (the live class took attendance, or
                            the office marked them by hand) is never given a
                            "how they did" line: the message says they were
                            absent, and how to catch up (attendance-core.mjs)
     • homework             what the office typed for the class that day, or
                            the default line from the settings
     • next lesson          the date and the next worksheet
     • where the answer key and the lesson video are (Polymath Online)
   Siblings in the same class get ONE message to their parent.

   Nothing here is guessed: a line with no data behind it is left out, and the
   office sees which messages have no live-lesson record before sending.

   PURE: no Firebase, no DOM, no network. office/lesson-updates.mjs (the tab)
   reads the data and calls these; tools/office-lessons-tests.mjs tests them.

   Firestore (officeSettings, admins only, like the rest of the office):
     officeSettings/lessonUpdates          the settings (homework default line,
                                           which lines to include, sign-off,
                                           families taken off the list)
     officeSettings/lessonupd-YYYY-MM-DD   one day: the homework/note typed per
                                           class, edited messages, and who was
                                           sent what and when
   ═══════════════════════════════════════════════════════════════════════════ */
import {
  SITE, CENTRE_NAME, scheduleSlot, slotHasClass, slotParts, slotTitle, slotShortLabel, levelLabel,
  subjectKey, firstName, listJoin, plural, normalizeWhatsapp, displayPhone, whatsappLink, isMaster
} from './office-core.mjs?v=1.16.0';
import { courseForSlot, slotCourseKey, cleanLiveRow, liveScore, dayShort, clockText, sgDay } from './weekly-report-core.mjs?v=1.1.0';
import { childAttendance, isAbsent, absentLine, catchUpLine, notJoinedMessage, normalizeAttendDay } from './attendance-core.mjs?v=1.0.0';

export const LU_VERSION = '1.1.0';
export const LU_SETTINGS_DOC = 'lessonUpdates';          // officeSettings/lessonUpdates
export const LU_DAY_KIND = 'lesson-updates-day';         // officeSettings/lessonupd-<day>
export const ONLINE_URL = SITE + '/online/';
export const HOMEWORK_MAX = 400;
export const NOTE_MAX = 400;
export const MESSAGE_MAX = 2000;
export const STRONG_PCT = 80;
export const WEAK_PCT = 60;
// A live-lesson row belongs to a lesson when it started up to an hour before
// the lesson and before an hour after its release (a late start, a long class).
export const ROW_EARLY_MS = 60 * 60 * 1000;
export const ROW_LATE_MS = 60 * 60 * 1000;

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function str(v, max) { const s = String(v == null ? '' : v).replace(/\r/g, '').trim(); return max ? s.slice(0, max) : s; }
function oneLine(v, max) { return str(v, max).replace(/\s+/g, ' '); }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function isDay(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
function stampMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = Date.parse(v);
  return isFinite(t) ? t : 0;
}

/* ─────────────────────────── 1. Settings ─────────────────────────── */
export const DEFAULT_HOMEWORK = 'Finish any questions left on today\'s worksheet and check them with the answer key.';
export const DEFAULT_SIGNOFF = 'Any questions, just reply here. Thank you! 🙏';
export const DEFAULT_LU = Object.freeze({
  homeworkDefault: DEFAULT_HOMEWORK,
  signoff: DEFAULT_SIGNOFF,
  showScore: true,      // "How Ethan did" from the live lesson
  showFocus: false,     // focus % from the live lesson (off by default: it can read as a telling-off)
  showNext: true,       // the next lesson's date and worksheet
  showLink: true,       // where the answer key and video are
  optOut: Object.freeze({})
});
export function normalizeLu(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const bool = (v, d) => (v === true || v === false ? v : d);
  const optOut = {};
  if (r.optOut && typeof r.optOut === 'object') Object.keys(r.optOut).forEach(k => { if (r.optOut[k] === true && /^[A-Za-z0-9_-]{1,80}$/.test(k)) optOut[k] = true; });
  return {
    homeworkDefault: typeof r.homeworkDefault === 'string' ? str(r.homeworkDefault, HOMEWORK_MAX) : DEFAULT_HOMEWORK,
    signoff: typeof r.signoff === 'string' ? str(r.signoff, 200) : DEFAULT_SIGNOFF,
    showScore: bool(r.showScore, true),
    showFocus: bool(r.showFocus, false),
    showNext: bool(r.showNext, true),
    showLink: bool(r.showLink, true),
    optOut
  };
}
export function familyOptedOut(lu, familyId) { return !!(lu && lu.optOut && lu.optOut[familyId] === true); }

/* ─────────────────────────── 2. One day's record ─────────────────────────── */
export function dayDocId(day) { return 'lessonupd-' + (isDay(day) ? day : 'invalid'); }
export function sendKey(slotId, familyId) { return String(slotId || '').replace(/[^A-Za-z0-9-]/g, '') + '__' + String(familyId || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80); }
export function normalizeDay(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const notes = {}, sent = {}, edits = {};
  if (r.notes && typeof r.notes === 'object') Object.keys(r.notes).forEach(slotId => {
    const n = r.notes[slotId] || {};
    notes[slotId] = { homework: typeof n.homework === 'string' ? str(n.homework, HOMEWORK_MAX) : null, note: str(n.note, NOTE_MAX) };
  });
  if (r.sent && typeof r.sent === 'object') Object.keys(r.sent).forEach(k => {
    const s = r.sent[k];
    if (s && typeof s === 'object' && stampMs(s.at) > 0) sent[k] = { at: stampMs(s.at), by: str(s.by, 120), phone: str(s.phone, 20) };
  });
  if (r.edits && typeof r.edits === 'object') Object.keys(r.edits).forEach(k => { if (typeof r.edits[k] === 'string' && r.edits[k].trim()) edits[k] = str(r.edits[k], MESSAGE_MAX); });
  return { notes, sent, edits };
}

/* ─────────────────────────── 3. Days and lessons ─────────────────────────── */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function sgToday(now) { return sgDay(now == null ? Date.now() : now); }
export function addDays(day, n) {
  if (!isDay(day)) return day;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}
export function weekdayName(day) {
  if (!isDay(day)) return '';
  const [y, m, d] = day.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
export function dayLabel(day, now) {
  if (!isDay(day)) return String(day || '');
  const today = sgToday(now);
  const [y, m, d] = day.split('-').map(Number);
  const base = dayShort(Date.UTC(y, m - 1, d, 4));   // noon in Singapore
  if (day === today) return 'Today, ' + base;
  if (day === addDays(today, -1)) return 'Yesterday, ' + base;
  if (day === addDays(today, 1)) return 'Tomorrow, ' + base;
  return base;
}
/* The lesson of a timetable slot on a day, by the lesson clock: { start, end,
   release } or null when the slot is not on that day. */
export function lessonOf(slotId, day, clock) {
  const key = slotCourseKey(slotId);
  if (!key || !clock || typeof clock.lessonOn !== 'function') return null;
  return clock.lessonOn(key.day, key.slot, day) || null;
}
// 'upcoming' (not started), 'live' (in the lesson), 'ending' (lesson over, the
// answer key opens soon), 'over' (released: the answer key and video are out).
export function lessonState(lesson, now) {
  if (!lesson) return 'none';
  const n = num(now) || Date.now();
  if (n < lesson.start) return 'upcoming';
  if (n < lesson.end) return 'live';
  if (n < lesson.release) return 'ending';
  return 'over';
}
export const STATE_META = Object.freeze({
  upcoming: { label: 'Not started yet', pill: 'grey' },
  live: { label: 'In the lesson now', pill: 'amber' },
  ending: { label: 'Lesson just ended', pill: 'green' },
  over: { label: 'Lesson over', pill: 'green' },
  none: { label: '', pill: 'grey' }
});

/* Every timetable class on a day that has at least one current student, in
   lesson-time order. roster: C.slotRoster(...) (a Map slotId → rows). */
export function classesOn(day, schedule, roster) {
  const wd = weekdayName(day);
  if (!wd) return [];
  const out = [];
  const ids = roster && typeof roster.keys === 'function' ? [...roster.keys()] : Object.keys(roster || {});
  ids.forEach(id => {
    const p = slotParts(id);
    if (!p.day || !p.time || p.day.name !== wd) return;
    const rows = (roster.get ? roster.get(id) : roster[id]) || [];
    if (!rows.length) return;
    out.push(id);
  });
  return out.sort((a, b) => Number(slotParts(a).n) - Number(slotParts(b).n) || a.localeCompare(b));
}

/* ─────────────────────────── 4. What the class covered ───────────────────────────
   The worksheet the class worked on IN that lesson, and the one after it.
     · Before the lesson's release the class's place (courseNow) is the
       worksheet being taught — unless the teacher already pressed Finished in
       that lesson, which moved the place on; then it is the one before.
     · After the release, every later release moved the class one on, so the
       place right after this lesson is today's place minus those; the
       worksheet taught is the one before it.
   → { covered: {id, n, name} | null, next: {id, n, name} | null, started } */
export function lessonWorksheets(course, lesson, clock, now, docNames) {
  const none = { covered: null, next: null, started: false };
  if (!course || !lesson || !clock) return none;
  const ids = Array.isArray(course.worksheetIds) ? course.worksheetIds : [];
  if (!ids.length) return none;
  const n = num(now) || Date.now();
  const cur = clock.courseNow(course, n) || course;
  const at = typeof cur.currentIndex === 'number' ? Math.floor(cur.currentIndex) : -1;
  if (at < 0) return none;
  const names = docNames || {};
  const item = i => (i >= 0 && i < ids.length ? { id: ids[i], n: i + 1, name: oneLine(names[ids[i]], 90) || 'Worksheet ' + (i + 1) } : null);
  let covered;
  if (n < lesson.release) {
    const finished = stampMs(course.finishedAt);
    covered = finished && finished >= lesson.start && finished < lesson.release ? at - 1 : at;
  } else {
    const later = (clock.lessonsBetween(course.day, course.slot, lesson.release, n) || []).length;
    const placeAfter = at - later;
    covered = placeAfter - 1;
    // On the last worksheet of the list the class stays put: it was taught there.
    if (later === 0 && at === ids.length - 1 && !(cur.autoMoved > 0) && stampMs(course.clockAt) < lesson.release) covered = at;
  }
  if (covered < 0 || covered >= ids.length) return { covered: null, next: item(Math.max(0, covered + 1)), started: true };
  return { covered: item(covered), next: item(covered + 1), started: true };
}

/* ─────────────────────────── 5. How the child did ─────────────────────────── */
/* The child's row of that lesson from the live class's progress book: the
   one that started inside the lesson's window; with two (a reconnect), the
   one the teacher marked most in. */
export function liveRowFor(rows, lesson) {
  if (!lesson || !Array.isArray(rows)) return null;
  const from = lesson.start - ROW_EARLY_MS, to = lesson.release + ROW_LATE_MS;
  const hits = rows.map(r => (r && r.e ? r : cleanLiveRow(r))).filter(r => r && r.d >= from && r.d < to);
  if (!hits.length) return null;
  return hits.sort((a, b) => (b.k - a.k) || (b.a - a.a) || (b.d - a.d))[0];
}
export function praiseFor(score) {
  if (score == null) return '';
  if (score >= 90) return 'Excellent work! 🌟';
  if (score >= STRONG_PCT) return 'Very good! 👏';
  if (score >= WEAK_PCT) return 'Good effort 👍';
  return 'Some of today\'s ideas need more practice, and we will keep working on them together 💪';
}
/* "answered 7 of 8 questions, and 5 of the 7 marked were right (71%). Good
   effort 👍" — or '' when there is no record. */
export function performanceText(row, opts) {
  if (!row) return '';
  const o = opts || {};
  const bits = [];
  if (row.q > 0) bits.push('answered ' + Math.max(0, row.a) + ' of ' + plural(row.q, 'question'));
  const score = liveScore(row);
  if (row.k > 0 && score != null) {
    const right = Math.max(0, row.r), partly = Math.max(0, row.h);
    bits.push(right + ' of the ' + row.k + ' marked ' + (right === 1 ? 'was' : 'were') + ' right' + (partly > 0 ? ' and ' + partly + ' partly right' : '') + ' (' + score + '%)');
  }
  let text = bits.length ? bits.join('; ') : 'took part in the live lesson';
  if (o.focus && row.f >= 0) text += ', focus ' + row.f + '%';
  const praise = praiseFor(score);
  return text + '.' + (praise ? ' ' + praise : '');
}

/* ─────────────────────────── 6. The families of a class ─────────────────────────── */
/* The class's students (a slotRoster list) grouped by family, so siblings in
   the same class are ONE message to their parent. */
export function familiesOf(rows, families) {
  const byId = new Map((families || []).map(f => [f.id, f]));
  const out = new Map();
  (rows || []).forEach(r => {
    if (!r || r.status !== 'active') return;
    let g = out.get(r.familyId);
    if (!g) {
      const fam = byId.get(r.familyId) || r.family || {};
      g = { familyId: r.familyId, parentName: str(r.parentName || fam.parentName) || 'Parent', phone: normalizeWhatsapp(r.whatsapp || fam.whatsapp), children: [] };
      out.set(r.familyId, g);
    }
    if (!g.children.some(c => c.studentId === r.studentId)) g.children.push({ studentId: r.studentId, name: str(r.name) || 'your child', first: firstName(r.name) || str(r.name) || 'your child', level: r.level || '', mode: r.mode || '' });
  });
  return [...out.values()].sort((a, b) => a.parentName.localeCompare(b.parentName));
}

/* ─────────────────────────── 7. The message ───────────────────────────
   m: { parentName, children: [{ first, perf }], classTitle, when (e.g. "Thu 20 Nov,
        3:00pm"), covered, next, nextDate, homework, note, online, releaseText,
        showNext, showLink, signoff } */
export function greetingName(parentName) {
  const p = oneLine(parentName, 80);
  return p && p.toLowerCase() !== 'parent' ? p : 'there';
}
export function lessonMessage(m) {
  const kids = (m.children || []).filter(Boolean);
  const names = listJoin(kids.map(c => c.first));
  const away = kids.filter(c => c.absent);
  const allAway = away.length > 0 && away.length === kids.length;
  const L = [];
  L.push('Hi ' + greetingName(m.parentName) + ', here is ' + (names ? names + (/s$/i.test(names) ? '\'' : '\'s') : 'your child\'s') + ' lesson update from ' + CENTRE_NAME + ' 😊');
  L.push('');
  L.push('📚 *' + oneLine(m.classTitle, 80) + '* · ' + oneLine(m.when, 60));
  if (allAway) L.push('⚠️ ' + absentLine(listJoin(away.map(c => c.first)), away.length > 1));
  if (m.covered) L.push((allAway ? '✏️ The class covered: ' : '✏️ Today: ') + m.covered.name);
  const perf = kids.filter(c => c.perf && !c.absent);
  if (!away.length && perf.length === 1 && kids.length === 1) L.push('⭐ How ' + perf[0].first + ' did: ' + perf[0].perf);
  else if (!allAway && (perf.length || away.length)) {
    L.push('⭐ How they did:');
    kids.forEach(c => {
      if (c.absent) L.push('• ' + c.first + ' was absent today');
      else if (c.perf) L.push('• ' + c.first + ' ' + c.perf);
    });
  }
  const hw = str(m.homework, HOMEWORK_MAX);
  if (hw) L.push('📝 Homework: ' + hw);
  if (m.showNext !== false && (m.next || m.nextDate)) {
    L.push('⏭ Next lesson' + (m.nextDate ? ' (' + m.nextDate + ')' : '') + (m.next ? ': ' + m.next.name : ''));
  }
  if (away.length && m.online) L.push(catchUpLine(m.covered ? m.covered.name : '', m.releaseText));
  else if (m.showLink !== false && m.online) {
    L.push('🔑 The answer key and lesson video are on Polymath Online' + (m.releaseText ? ' from ' + m.releaseText : '') + ': ' + ONLINE_URL);
  }
  const note = str(m.note, NOTE_MAX);
  if (note) { L.push(''); L.push(note); }
  const sign = str(m.signoff, 200);
  if (sign) { L.push(''); L.push(sign); }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, MESSAGE_MAX);
}

/* ─────────────────────────── 8. A whole day ───────────────────────────
   ctx: { day, now, schedule, roster (Map), families, courses, docNames,
          live: { rosterId: rows } | null (null = the progress book could not be read),
          clock, lu: normalizeLu(...), dayDoc: normalizeDay(...),
          att: normalizeAttendDay(...) of officeSettings/attend-<day> | null }
   → [{ slotId, title, subject, level, when, timeText, lesson, state, online,
        course, ws: {covered, next}, homework, homeworkIsDefault, note,
        families: [{ key, familyId, parentName, phone, children:[{…, row, perf}],
                     text, edited, sent, optedOut, hasLive }],
        counts: { families, ready, sent, noPhone, optedOut, noLive } }] */
export function dayClasses(ctx) {
  const c = ctx || {};
  const lu = c.lu || normalizeLu({});
  const dd = c.dayDoc || normalizeDay({});
  const now = num(c.now) || Date.now();
  return classesOn(c.day, c.schedule, c.roster).map(slotId => {
    const slot = scheduleSlot(c.schedule, slotId);
    const lesson = lessonOf(slotId, c.day, c.clock);
    const state = lessonState(lesson, now);
    const rows = (c.roster.get ? c.roster.get(slotId) : c.roster[slotId]) || [];
    const level = slot.level || (rows[0] && rows[0].level) || '';
    const course = courseForSlot(c.courses, c.schedule, slotId, level);
    const ws = course ? lessonWorksheets(course, lesson, c.clock, now, c.docNames) : { covered: null, next: null, started: false };
    const title = slotHasClass(slot) ? (isMaster(slot) ? 'Master Class · ' : '') + levelLabel(slot.level) + ' ' + (subjectKey(slot.subject) === 'math' ? 'Maths' : subjectKey(slot.subject) === 'science' ? 'Science' : slot.subject) : 'Lesson';
    const p = slotParts(slotId);
    const timeText = p.time ? p.time.label : '';
    const startText = lesson ? clockText(lesson.start) : (timeText.split(/\s*[–—-]\s*/)[0] || '');
    const when = dayShort(lesson ? lesson.start : Date.parse(c.day + 'T12:00:00+08:00')) + ', ' + startText;
    const n = dd.notes[slotId] || { homework: null, note: '' };
    const homeworkIsDefault = n.homework == null;
    const homework = homeworkIsDefault ? lu.homeworkDefault : n.homework;
    const nextDate = lesson ? dayShort(lesson.start + WEEK_MS) : '';
    const fams = familiesOf(rows, c.families).map(g => {
      const key = sendKey(slotId, g.familyId);
      const children = g.children.map(ch => {
        const rosterId = g.familyId + '_' + ch.studentId;
        const row = c.live ? liveRowFor(c.live[rosterId] || [], lesson) : null;
        const attendance = childAttendance({ att: c.att || null, slotId, rosterId, lesson, row, now });
        const absent = isAbsent(attendance);
        return Object.assign({}, ch, { rosterId, row, attendance, absent, perf: absent ? '' : lu.showScore ? performanceText(row, { focus: lu.showFocus }) : '' });
      });
      const auto = lessonMessage({
        parentName: g.parentName, children, classTitle: title, when, covered: ws.covered, next: ws.next, nextDate,
        homework, note: n.note, online: !!course, releaseText: lesson && now < lesson.release ? clockText(lesson.release) : '',
        showNext: lu.showNext, showLink: lu.showLink, signoff: lu.signoff
      });
      const edited = dd.edits[key] || '';
      // 🙋 During the lesson: the children past the check who have not joined,
      // and the one-tap "not joined yet" WhatsApp for their parent.
      const missing = children.filter(ch => ch.attendance.s === 'missing');
      const notJoined = missing.length ? notJoinedMessage({ parentName: g.parentName, children: missing.map(ch => ch.first), classTitle: title, startText }) : '';
      return {
        key, familyId: g.familyId, parentName: g.parentName, phone: g.phone, children,
        text: edited || auto, autoText: auto, edited: !!edited,
        sent: dd.sent[key] || null, optedOut: familyOptedOut(lu, g.familyId),
        hasLive: children.some(ch => !!ch.row || ch.absent),
        absent: children.filter(ch => ch.absent).length, missing: missing.length, notJoined
      };
    });
    const counts = {
      families: fams.length,
      ready: fams.filter(f => f.phone && !f.sent && !f.optedOut).length,
      sent: fams.filter(f => f.sent).length,
      noPhone: fams.filter(f => !f.phone && !f.optedOut).length,
      optedOut: fams.filter(f => f.optedOut).length,
      noLive: fams.filter(f => !f.hasLive && !f.optedOut).length
    };
    // 🙋 The class's attendance at a glance.
    const kidsAll = fams.reduce((t, f) => t.concat(f.children), []);
    const attendance = {
      taken: kidsAll.some(ch => ch.attendance.taken),
      live: !!(c.att && c.att.live && c.att.live[slotId]),
      here: kidsAll.filter(ch => ch.attendance.s === 'here').length,
      absent: kidsAll.filter(ch => ch.attendance.s === 'absent').length,
      missing: kidsAll.filter(ch => ch.attendance.s === 'missing' || ch.attendance.s === 'waiting').length,
      total: kidsAll.length
    };
    return { slotId, title, subject: subjectKey(slot.subject), level, when, timeText, shortWhen: slotShortLabel(slotId), lesson, state, online: !!course, course: course ? { id: course.id } : null,
      ws, homework, homeworkIsDefault, note: n.note, nextDate, families: fams, counts, attendance };
  });
}
// The families still to send in a class (or the whole day), in the order the
// office sees them: with a number, not sent, not taken off the list.
export function queueOf(classes, slotId) {
  const out = [];
  (classes || []).filter(cl => !slotId || cl.slotId === slotId).forEach(cl => cl.families.forEach(f => {
    if (f.phone && !f.sent && !f.optedOut) out.push({ slotId: cl.slotId, key: f.key });
  }));
  return out;
}
export function dayTotals(classes) {
  return (classes || []).reduce((t, cl) => {
    t.classes++; t.families += cl.counts.families; t.ready += cl.counts.ready; t.sent += cl.counts.sent; t.noPhone += cl.counts.noPhone;
    return t;
  }, { classes: 0, families: 0, ready: 0, sent: 0, noPhone: 0 });
}
// The chat link: WhatsApp Web on a computer, the WhatsApp app on a phone.
export function chatLink(phone, text, web) { return whatsappLink(phone, text, web); }
export { displayPhone, normalizeAttendDay };
