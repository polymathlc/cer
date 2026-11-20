/* ═══════════════════════════════════════════════════════════════════════════
   🙋 ATTENDANCE — the rules (attendance-core.mjs v1.0.0)

   Zhi Kai, 20 Nov 2026: "Attendance is taken from the live lesson, and a
   parent gets a message if their child has not joined ten minutes in, plus a
   catch-up link afterwards. When a student is absent, any reports sent to
   parents show that."

   Where attendance comes from
   ───────────────────────────
   The Ans Key live class (polymathlc/anskey, ansKeyLiveClass) is the only
   thing that SEES a child in a lesson: a child counts as here once they joined
   it, on a computer, a tablet or a Zoom answer phone. A child who is in the
   Zoom meeting alone is not seen by anything, so:
     • the live class's server writes, for every class it ran, the class list
       and who joined (`live`) and every email it sent (`alerts`);
     • the teacher (in the live class) and the office (💬 Lesson updates) can
       mark any child here or absent by hand (`marks`), and a hand mark always
       wins.
   A lesson the live class did not run, with no hand mark, is "not taken":
   nothing is said about attendance and the messages read as before.

   The record of one day (officeSettings, admins only like the rest of the office):
     officeSettings/attend-YYYY-MM-DD = {
       kind: 'attendance-day', day,
       live:   { [slotId]: { epoch, slot, label, start, end, release, startedAt,
                             dueAt, checkedAt, closedAt, expected: {rosterId: name},
                             joined: {rosterId: first join ms}, final } },
       alerts: { [slotId__rosterId]: { late: {at, to, id}, catchup: {at, to, id} } },
       marks:  { [slotId__rosterId]: { s: 'here' | 'absent', by, at, start, label } },
       wa:     { [slotId__rosterId]: { at, by } }      // "not joined yet" WhatsApps opened
     }

   PURE: no Firebase, no DOM, no network. Used by 💬 Lesson updates
   (lesson-updates-core.mjs), the weekly parent reports (weekly-report-core.mjs)
   and tested by tools/attendance-tests.mjs.
   ═══════════════════════════════════════════════════════════════════════════ */

export const ATT_VERSION = '1.0.0';
export const ATTEND_KIND = 'attendance-day';
export const ATTEND_PREFIX = 'attend-';
export const SITE_URL = 'https://polymathlc.com.sg';
export const LIVE_URL = SITE_URL + '/live/';
export const ONLINE_URL = SITE_URL + '/online/';
// A child who joined more than this long after the start is "late".
export const LATE_AFTER_MS = 10 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9-]{1,60}_[A-Za-z0-9-]{1,60}$/;
const SLOT_RE = /^[A-Z]{3}-\d$/;

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function str(v, max) { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return max ? s.slice(0, max) : s; }
function isDay(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
function stampMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = Date.parse(v);
  return isFinite(t) ? t : 0;
}

export function attendDocId(day) { return ATTEND_PREFIX + (isDay(day) ? day : 'invalid'); }
export function attendKey(slotId, rosterId) { return String(slotId || '') + '__' + String(rosterId || ''); }
export function splitKey(key) {
  const k = String(key || '');
  const i = k.indexOf('__');
  if (i < 1) return null;
  const slotId = k.slice(0, i), rosterId = k.slice(i + 2);
  return SLOT_RE.test(slotId) && ID_RE.test(rosterId) ? { slotId, rosterId } : null;
}

/* ─────────────────────────── 1. One day's record, cleaned ─────────────────────────── */
function cleanLive(x) {
  if (!x || typeof x !== 'object') return null;
  const expected = {}, joined = {};
  if (x.expected && typeof x.expected === 'object') Object.keys(x.expected).forEach(id => { if (ID_RE.test(id)) expected[id] = str(x.expected[id], 80) || 'Student'; });
  if (x.joined && typeof x.joined === 'object') Object.keys(x.joined).forEach(id => { const t = num(x.joined[id]); if (ID_RE.test(id) && t > 0) joined[id] = t; });
  return {
    epoch: num(x.epoch), slot: str(x.slot, 12), label: str(x.label, 80),
    start: num(x.start), end: num(x.end), release: num(x.release), startedAt: num(x.startedAt),
    dueAt: num(x.dueAt), checkedAt: num(x.checkedAt), closedAt: num(x.closedAt),
    expected, joined, final: x.final === true
  };
}
function cleanStamp(x) {
  if (!x || typeof x !== 'object') return null;
  const at = stampMs(x.at);
  if (!(at > 0)) return null;
  return { at, to: Array.isArray(x.to) ? x.to.map(t => str(t, 254)).filter(Boolean).slice(0, 4) : [], id: str(x.id, 160) };
}
export function normalizeAttendDay(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const live = {}, alerts = {}, marks = {}, wa = {};
  if (r.live && typeof r.live === 'object') Object.keys(r.live).forEach(slot => { const l = cleanLive(r.live[slot]); if (l && SLOT_RE.test(slot)) live[slot] = l; });
  if (r.alerts && typeof r.alerts === 'object') Object.keys(r.alerts).forEach(k => {
    if (!splitKey(k)) return;
    const a = r.alerts[k] || {};
    const late = cleanStamp(a.late), catchup = cleanStamp(a.catchup);
    if (late || catchup) alerts[k] = { late, catchup };
  });
  if (r.marks && typeof r.marks === 'object') Object.keys(r.marks).forEach(k => {
    const m = r.marks[k];
    if (!splitKey(k) || !m || (m.s !== 'here' && m.s !== 'absent')) return;
    marks[k] = { s: m.s, by: str(m.by, 120), at: stampMs(m.at), start: num(m.start), label: str(m.label, 80), note: str(m.note, 120) };
  });
  if (r.wa && typeof r.wa === 'object') Object.keys(r.wa).forEach(k => { const t = stampMs(r.wa[k] && r.wa[k].at); if (splitKey(k) && t > 0) wa[k] = { at: t, by: str(r.wa[k].by, 120) }; });
  return { day: isDay(r.day) ? r.day : '', live, alerts, marks, wa };
}
// { 'YYYY-MM-DD': normalized } from a list of documents ({ id, ...data }).
export function attendanceByDay(docs) {
  const out = {};
  (Array.isArray(docs) ? docs : []).forEach(d => {
    if (!d) return;
    const day = isDay(d.day) ? d.day : String(d.id || '').startsWith(ATTEND_PREFIX) ? String(d.id).slice(ATTEND_PREFIX.length) : '';
    if (isDay(day) && (d.kind === undefined || d.kind === ATTEND_KIND)) out[day] = normalizeAttendDay(Object.assign({}, d, { day }));
  });
  return out;
}

/* ─────────────────────────── 2. One child at one lesson ───────────────────────────
   ctx: { att: normalizeAttendDay(...) | null, slotId, rosterId,
          lesson: { start, end, release } | null, row: the child's live-lesson
          row for that lesson | null, now }
   → { s, how, joinedAt, late, lateAlert, catchupAlert, wa, mark, taken }
     s:   'here'      in the lesson (joined the live class, or marked here)
          'absent'    not there (the lesson is over, or marked absent)
          'missing'   the lesson is on and they have not joined, past the check
          'waiting'   the lesson is on, not joined yet, the check not due yet
          'upcoming'  the lesson has not started
          'unknown'   attendance was not taken for this lesson
     how: 'mark' (by hand) | 'live' (the live class) | '' */
export function childAttendance(ctx) {
  const c = ctx || {};
  const att = c.att || null;
  const key = attendKey(c.slotId, c.rosterId);
  const mark = att && att.marks[key] ? att.marks[key] : null;
  const live = att && att.live[c.slotId] ? att.live[c.slotId] : null;
  const alerts = att && att.alerts[key] ? att.alerts[key] : null;
  const now = num(c.now) || Date.now();
  const lesson = c.lesson || (live ? { start: live.start, end: live.end, release: live.release } : null);
  const joinedAt = (live && live.joined[c.rosterId]) || 0;
  const base = {
    joinedAt, late: !!(joinedAt && lesson && joinedAt > lesson.start + LATE_AFTER_MS),
    lateAlert: alerts && alerts.late ? alerts.late.at : 0, catchupAlert: alerts && alerts.catchup ? alerts.catchup.at : 0,
    wa: att && att.wa[key] ? att.wa[key].at : 0, mark: mark ? mark.s : '', taken: !!(live || mark)
  };
  if (mark) return Object.assign(base, { s: mark.s, how: 'mark' });
  if (joinedAt || c.row) return Object.assign(base, { s: 'here', how: 'live', taken: true });
  if (!live) {
    if (lesson && now < lesson.start) return Object.assign(base, { s: 'upcoming', how: '' });
    return Object.assign(base, { s: 'unknown', how: '' });
  }
  // The live class ran this lesson. Only the children it expected count as
  // missing: a child added to the class later is not blamed for it.
  if (!Object.prototype.hasOwnProperty.call(live.expected, c.rosterId)) return Object.assign(base, { s: 'unknown', how: '' });
  const over = live.final || (lesson && now >= lesson.end);
  if (over) return Object.assign(base, { s: 'absent', how: 'live' });
  if (lesson && now < lesson.start) return Object.assign(base, { s: 'upcoming', how: '' });
  if (live.dueAt && now < live.dueAt) return Object.assign(base, { s: 'waiting', how: 'live' });
  return Object.assign(base, { s: 'missing', how: 'live' });
}
export function isAbsent(a) { return !!(a && (a.s === 'absent' || a.s === 'missing')); }
export const STATUS_META = Object.freeze({
  here: { label: 'Here', pill: 'green', icon: '✅' },
  absent: { label: 'Absent', pill: 'red', icon: '❌' },
  missing: { label: 'Not joined yet', pill: 'amber', icon: '⏳' },
  waiting: { label: 'Not joined yet', pill: 'grey', icon: '⏳' },
  upcoming: { label: 'Lesson not started', pill: 'grey', icon: '' },
  unknown: { label: 'Not taken', pill: 'grey', icon: '' }
});

/* ─────────────────────────── 3. The words parents read ─────────────────────────── */
// "Ethan was absent from today's lesson." (WhatsApp lesson update line)
export function absentLine(names, many) {
  return (names || 'Your child') + (many ? ' were' : ' was') + ' absent from today\'s lesson.';
}
// "📚 To catch up: …" — the worksheet missed and where the key and video are.
export function catchUpLine(worksheetName, releaseText) {
  return '📚 To catch up: ' + (worksheetName ? 'work through "' + worksheetName + '" and ' : '') + 'check it with the answer key and lesson video on Polymath Online'
    + (releaseText ? ' (from ' + releaseText + ')' : '') + ': ' + ONLINE_URL;
}
// The "not joined yet" WhatsApp the office can open in one tap during a lesson.
export function notJoinedMessage(m) {
  const kids = (m && m.children) || [];
  const names = kids.length > 1 ? kids.slice(0, -1).join(', ') + ' and ' + kids[kids.length - 1] : (kids[0] || 'your child');
  const p = str(m && m.parentName, 80);
  const hi = 'Hi ' + (p && p.toLowerCase() !== 'parent' ? p : 'there') + ',';
  return hi + ' ' + names + (kids.length > 1 ? ' have' : ' has') + ' not joined today\'s ' + str(m && m.classTitle, 60) + ' lesson yet (it started at ' + str(m && m.startText, 20) + ').'
    + '\n\nJoin here: ' + LIVE_URL
    + '\n\nIf ' + (kids.length > 1 ? 'they are' : names + ' is') + ' already in the lesson on Zoom, or away today, no worries: we will send the worksheet, answer key and lesson video to catch up afterwards. 🙏';
}
// For the office: one child's attendance in words.
export function statusWords(a, clockText) {
  if (!a) return '';
  const ck = typeof clockText === 'function' ? clockText : (t => new Date(t).toISOString().slice(11, 16));
  if (a.s === 'here') return a.how === 'mark' ? 'Here (marked by hand)' : a.joinedAt ? 'Joined ' + ck(a.joinedAt) + (a.late ? ' (late)' : '') : 'In the live lesson';
  if (a.s === 'absent') return a.how === 'mark' ? 'Absent (marked by hand)' : 'Absent' + (a.catchupAlert ? ' · catch-up emailed ' + ck(a.catchupAlert) : '');
  if (a.s === 'missing') return 'Not joined yet' + (a.lateAlert ? ' · parent emailed ' + ck(a.lateAlert) : '');
  if (a.s === 'waiting') return 'Not joined yet';
  if (a.s === 'upcoming') return 'Lesson not started';
  return 'Attendance not taken (no live class)';
}
