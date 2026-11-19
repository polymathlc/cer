/* ═══════════════════════════════════════════════════════════════════════════
   📈 WEEKLY PARENT PROGRESS REPORTS — the rules (weekly-report-core.mjs v1.0.0)

   Zhi Kai, 19 Nov 2026: build the weekly parent progress report, so the centre
   can say "Know exactly how your child is doing, every week".

   Every Sunday evening (6 PM, Singapore) each family gets ONE email from
   admin@polymathlc.com.sg covering every child of theirs who did something that
   week. For each child it says:

     • THIS WEEK AT A GLANCE   lessons in class, questions answered in the live
                               lesson, how many were right, practice worksheets
                               marked at home
     • IN CLASS                the worksheets their class worked through this
                               week (from Polymath Online and the lesson clock),
                               and the worksheet coming up next
     • LIVE LESSONS            one line per live lesson: answered, correct, focus
                               (the Ans Key live class's own progress book)
     • PRACTICE AT HOME        each worksheet Study Buddy marked this week, with
                               its score
     • DOING WELL / NEEDS WORK strong and weak topics: worksheets and lessons
                               scored high or low, and the child's recurring
                               slips (Study Buddy's concept tags, with their
                               trend: improving / still there / getting worse)
     • WHAT TO PRACTISE NEXT   at most three concrete things to do this week

   Nothing here is guessed. Every number comes from something the child did:
   a live lesson the teacher marked, a worksheet Study Buddy marked, or the
   class's own place in its worksheet list. A child with nothing at all this
   week is left out, and a family with nobody to report on gets no email.

   PURE: no Firebase, no DOM, no network. The Sunday sender
   (tools/weekly-reports.mjs, run by .github/workflows/weekly-parent-reports.yml)
   gathers the data and calls these; the office's 📈 Reports tab
   (office/weekly-reports.mjs) reads the settings and the log with the same
   rules; tools/weekly-report-tests.mjs tests every one of them offline.

   The settings live in officeSettings/weeklyReports:
     mode     'off'     nothing is built or sent
              'review'  every Sunday the reports are built and emailed to the
                        office ONLY (one preview email), so they can be checked
              'send'    every Sunday each family is emailed its own report
     note     an optional line from the centre at the top of every report
     optOut   { familyId: true } families who asked not to get the report
     request  { id, kind: 'preview' | 'send', at, by } a "do it now" from the
              office's Reports tab, picked up by the next half-hourly check
   ═══════════════════════════════════════════════════════════════════════════ */
import {
  SITE, CENTRE_NAME, OFFICE_ADMINS, COLLECTIONS, MAIL_PREFIX,
  escapeHtml, normalizeFamily, familyEmails, familyStateIn, normalizeSettings,
  emailShell, officeMail, scheduleSlot, slotParts, slotShortLabel, levelLabel,
  subjectKey, firstName, listJoin, plural, nameTokens, cleanEmail, isEmail
} from './office-core.mjs';

export const WEEKLY_VERSION = '1.0.0';
export const WEEKLY_DOC = 'weeklyReports';              // officeSettings/weeklyReports
export const WEEKLY_LOG_KIND = 'weekly-report';          // officeSettings/weekly-<weekKey>  (the week's log)
export const WEEKLY_FAMILY_KIND = 'weekly-family';       // officeSettings/weekly-<weekKey>-<familyId> (one report, for the preview)
export const WEEKLY_MODES = Object.freeze(['off', 'review', 'send']);
export const WEEKLY_MODE_META = Object.freeze({
  off: Object.freeze({ title: 'Off', text: 'No weekly reports are built or sent.' }),
  review: Object.freeze({ title: 'Email me a preview each Sunday', text: 'Every Sunday at 6 PM the reports are built and emailed to the office only, so you can see exactly what parents would get.' }),
  send: Object.freeze({ title: 'Email parents every Sunday', text: 'Every Sunday at 6 PM each family gets its own report by email, from admin@polymathlc.com.sg.' })
});
export const SEND_WEEKDAY = 0;          // Sunday (Singapore)
export const SEND_HOUR = 18;            // 6 PM (Singapore)
export const CATCH_UP_HOURS = 18;       // a run missed on Sunday evening is still made until Monday noon
export const REQUEST_MAX_AGE_MS = 2 * 24 * 3600 * 1000;   // a "now" request older than two days is stale
export const NOTE_MAX = 600;
export const PREVIEW_MAX_FAMILIES_FULL = 25;               // reports shown in full in the office's preview email
export const PREVIEW_HTML_BUDGET = 700000;                 // a mail document must stay under Firestore's 1 MB
export const STRONG_PCT = 80;
export const WEAK_PCT = 60;
export const ONLINE_URL = SITE + '/online/';
export const STUDY_BUDDY_URL = SITE + '/student/';

const SG_OFFSET_MS = 8 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ─────────────────────────── 1. Small helpers ─────────────────────────── */
function str(v, max) { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return max ? s.slice(0, max) : s; }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : null; }
function sgParts(ms) {
  const d = new Date(num(ms) + SG_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
export function sgDay(ms) { const p = sgParts(ms); return p.y + '-' + pad2(p.m + 1) + '-' + pad2(p.d); }
// Midnight (Singapore) of a 'YYYY-MM-DD', as a moment.
export function sgMidnight(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - SG_OFFSET_MS;
}
export function dayShort(ms) { const p = sgParts(ms); return DAYS_SHORT[p.wd] + ' ' + p.d + ' ' + MONTHS_SHORT[p.m]; }
export function dateShort(ms) { const p = sgParts(ms); return p.d + ' ' + MONTHS_SHORT[p.m]; }
export function clockText(ms) { const p = sgParts(ms); return (p.h % 12 || 12) + ':' + pad2(p.min) + (p.h < 12 ? 'am' : 'pm'); }
function subjectWord(sub) { const k = subjectKey(sub); return k === 'math' ? 'Maths' : k === 'science' ? 'Science' : str(sub); }
function scoreColour(v) { return v == null ? '#10303a' : v >= STRONG_PCT ? '#0b7a50' : v >= WEAK_PCT ? '#b26a00' : '#b3261e'; }
function stampMs(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v instanceof Date) return v.getTime() || 0;
  if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (e) { return 0; } }
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  const p = Date.parse(v);
  return isFinite(p) ? p : 0;
}
export { stampMs };

/* ─────────────────────────── 2. Settings ─────────────────────────── */
export const DEFAULT_WEEKLY = Object.freeze({ mode: 'review', note: '', optOut: Object.freeze({}), request: null });
export function normalizeWeekly(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {
    mode: WEEKLY_MODES.includes(r.mode) ? r.mode : DEFAULT_WEEKLY.mode,
    note: String(r.note == null ? '' : r.note).replace(/\r/g, '').trim().slice(0, NOTE_MAX),
    optOut: {},
    request: null,
    lastAutoWeek: /^\d{4}-\d{2}-\d{2}$/.test(String(r.lastAutoWeek || '')) ? String(r.lastAutoWeek) : '',
    lastRequestDone: str(r.lastRequestDone, 60),
    lastRunAt: stampMs(r.lastRunAt),
    lastResult: str(r.lastResult, 300)
  };
  if (r.optOut && typeof r.optOut === 'object') {
    Object.keys(r.optOut).forEach(id => { if (r.optOut[id] === true && /^[A-Za-z0-9_-]{1,80}$/.test(id)) out.optOut[id] = true; });
  }
  const q = r.request;
  if (q && typeof q === 'object' && /^[A-Za-z0-9_-]{4,60}$/.test(String(q.id || '')) && (q.kind === 'preview' || q.kind === 'send')) {
    out.request = { id: String(q.id), kind: q.kind, at: stampMs(q.at), by: str(q.by, 120) };
  }
  return out;
}
export function familyOptedOut(weekly, familyId) { return !!(weekly && weekly.optOut && weekly.optOut[familyId] === true); }
// A "do it now" from the office: { id, kind, at, by }.
export function newRequest(kind, by, now, random) {
  const r = typeof random === 'function' ? random() : Math.random();
  const id = 'r' + Number(now || Date.now()).toString(36) + Math.floor(r * 1e9).toString(36);
  return { id: id.slice(0, 40), kind: kind === 'send' ? 'send' : 'preview', at: Number(now) || Date.now(), by: str(by, 120) };
}

/* ─────────────────────────── 3. The week ───────────────────────────
   A report's week is named by the SUNDAY it ends on (its "week key"). The
   automatic run is made on that Sunday at 6 PM and covers the seven days
   before it. A report asked for by hand in the middle of the week covers the
   seven days before the moment it was asked, and carries the coming Sunday's
   key — so the automatic run on that Sunday never sends the same family a
   second report. */
export function weekKeyFor(now) {
  const p = sgParts(now);
  const today = Date.UTC(p.y, p.m, p.d);
  const ahead = (7 - p.wd) % 7;                    // days to Sunday (0 on a Sunday)
  return new Date(today + ahead * DAY_MS).toISOString().slice(0, 10);
}
export function weekSendAt(weekKey) { return sgMidnight(weekKey) + SEND_HOUR * HOUR_MS; }
export function weekWindow(weekKey, now) {
  const sendAt = weekSendAt(weekKey);
  const end = isFinite(sendAt) ? Math.min(num(now) || sendAt, sendAt) : num(now);
  return { weekKey, start: end - WEEK_MS, end };
}
export function weekLabel(win) {
  if (!win) return '';
  const a = sgParts(win.start + 1), b = sgParts(win.end - 1);
  if (a.y !== b.y) return a.d + ' ' + MONTHS_SHORT[a.m] + ' ' + a.y + ' – ' + b.d + ' ' + MONTHS_SHORT[b.m] + ' ' + b.y;
  if (a.m !== b.m) return a.d + ' ' + MONTHS_SHORT[a.m] + ' – ' + b.d + ' ' + MONTHS_SHORT[b.m] + ' ' + b.y;
  return a.d + ' – ' + b.d + ' ' + MONTHS_SHORT[b.m] + ' ' + b.y;
}
// The Sunday whose 6 PM run this moment belongs to, if it is inside the
// sending window (Sunday 6 PM → Monday noon); '' otherwise.
export function dueWeekKey(now) {
  const n = num(now);
  const p = sgParts(n);
  // The Sunday on or before today.
  const sunday = new Date(Date.UTC(p.y, p.m, p.d) - p.wd * DAY_MS).toISOString().slice(0, 10);
  const at = weekSendAt(sunday);
  return n >= at && n < at + CATCH_UP_HOURS * HOUR_MS ? sunday : '';
}

/* What this check should do: a "now" request first, then the Sunday run.
   → { act, kind: 'preview' | 'send', why, weekKey, auto, requestId } */
export function weeklyPlan(rawWeekly, now) {
  const w = normalizeWeekly(rawWeekly);
  const n = num(now) || Date.now();
  const q = w.request;
  if (q && q.id !== w.lastRequestDone) {
    if (n - q.at > REQUEST_MAX_AGE_MS) return { act: false, why: 'A request from ' + dayShort(q.at) + ' is too old to act on; ask again from the Reports tab.', staleRequest: q.id };
    if (q.kind === 'send' && w.mode === 'off') return { act: false, why: 'Weekly reports are switched off, so the request to email parents was not carried out.', staleRequest: q.id };
    return { act: true, kind: q.kind, auto: false, requestId: q.id, weekKey: weekKeyFor(n),
      why: q.kind === 'send' ? 'Asked from the office: email this week\'s reports to parents.' : 'Asked from the office: email this week\'s reports to the office.' };
  }
  if (w.mode === 'off') return { act: false, why: 'Weekly reports are off.' };
  const due = dueWeekKey(n);
  if (!due) return { act: false, why: 'Waiting for Sunday 6 PM.' };
  if (w.lastAutoWeek === due) return { act: false, why: 'The week ending ' + dateShort(sgMidnight(due) + 12 * HOUR_MS) + ' was already done.' };
  return { act: true, kind: w.mode === 'send' ? 'send' : 'preview', auto: true, weekKey: due,
    why: (w.mode === 'send' ? 'Sunday: emailing' : 'Sunday: previewing') + ' the week ending ' + dateShort(sgMidnight(due) + 12 * HOUR_MS) + '.' };
}

/* ─────────────────────────── 4. Matching a child to their classes ─────────────────────────── */
export function rosterIdOf(family, student) { return String(family && family.id || '') + '_' + String(student && student.id || ''); }

// A class's day and lesson time, the way Polymath Online stores them.
export function slotCourseKey(slotId) {
  const p = slotParts(slotId);
  if (!p.day || !p.time) return null;
  return { day: p.day.name, slot: Number(p.n) - 1 };
}
/* The Polymath Online class a child's timetable slot is taught from: same
   day, same lesson time, same subject; the same level if there is one with
   it. Archived classes never count. */
export function courseForSlot(courses, schedule, slotId, childLevel) {
  const key = slotCourseKey(slotId);
  if (!key) return null;
  const slot = scheduleSlot(schedule, slotId);
  const subject = subjectKey(slot.subject);
  const level = String(slot.level || childLevel || '').toUpperCase();
  const list = (Array.isArray(courses) ? courses : []).filter(c => c && !c.archived && c.day === key.day && Number(c.slot) === key.slot
    && (!subject || subjectKey(c.subject) === subject));
  if (!list.length) return null;
  return list.find(c => String(c.level || '').toUpperCase() === level) || (list.length === 1 ? list[0] : null);
}

/* The worksheets a class worked through in the window, from where it is now:
   every lesson released inside the window moved the class one worksheet on,
   so the k worksheets before today's place are the ones taught in those k
   lessons (oldest first), and today's place is the next lesson's.
   `clock` is online/lesson-clock.js. */
export function classCoverage(course, win, clock, docNames) {
  if (!course || !clock) return null;
  const ids = Array.isArray(course.worksheetIds) ? course.worksheetIds : [];
  if (!ids.length) return null;
  const nowCourse = clock.courseNow(course, win.end) || course;
  const at = typeof nowCourse.currentIndex === 'number' ? Math.floor(nowCourse.currentIndex) : -1;
  if (at < 0) return { lessons: [], taught: [], next: null, started: false };
  const lessons = clock.lessonsBetween(course.day, course.slot, win.start, win.end) || [];
  const k = Math.min(lessons.length, at);
  const names = docNames || {};
  const nameOf = idx => str(names[ids[idx]], 90) || 'Worksheet ' + (idx + 1);
  const taught = [];
  for (let i = 0; i < k; i++) {
    const idx = at - k + i;
    const lesson = lessons[lessons.length - k + i];
    taught.push({ id: ids[idx], n: idx + 1, name: nameOf(idx), date: lesson ? lesson.start : 0 });
  }
  let next = null;
  if (at < ids.length) {
    const rel = clock.nextRelease ? clock.nextRelease(course.day, course.slot, win.end) : 0;
    next = { id: ids[at], n: at + 1, name: nameOf(at), date: rel > 0 ? rel - 2 * HOUR_MS : 0 };
  }
  return { lessons, taught, next, started: true };
}

/* ─────────────────────────── 5. The live lessons ───────────────────────────
   The Ans Key live class keeps a progress book per teacher
   (users/{teacher}/liveClassProgress/main), one short row per child per lesson:
     { e epoch, d startedAt, l slot label, m minutes, q asked, a answered,
       r right, h partly right, k marked by the teacher, s answer secs, f focus % }
   (-1 = not measured). A roster child's key is 'r:' + familyId_childId. */
export function cleanLiveRow(x) {
  if (!x || typeof x !== 'object') return null;
  const e = Math.floor(num(x.e));
  if (!(e > 0)) return null;
  const n = (v, max) => { v = Math.floor(num(v)); return Math.max(-1, Math.min(max, v)); };
  return { e, d: Math.max(0, num(x.d)), l: str(x.l, 60), m: n(x.m, 1000), q: n(x.q, 500), a: n(x.a, 500), r: n(x.r, 500), h: n(x.h, 500), k: n(x.k, 500), s: n(x.s, 1800), f: n(x.f, 100) };
}
// Every teacher's book → { rosterId: [rows…] }, a lesson counted once.
export function liveRowsByRoster(books) {
  const out = {};
  (Array.isArray(books) ? books : [books]).forEach(book => {
    const students = book && book.students && typeof book.students === 'object' ? book.students : {};
    Object.keys(students).forEach(identity => {
      const m = /^r:([A-Za-z0-9-]{1,60}_[A-Za-z0-9-]{1,60})$/.exec(identity);
      if (!m) return;
      const rows = (Array.isArray(students[identity].rows) ? students[identity].rows : []).map(cleanLiveRow).filter(Boolean);
      const list = out[m[1]] || (out[m[1]] = []);
      rows.forEach(r => { if (!list.some(x => x.e === r.e)) list.push(r); });
    });
  });
  Object.keys(out).forEach(k => out[k].sort((a, b) => a.e - b.e));
  return out;
}
export function liveScore(row) { return row && row.k > 0 ? Math.round((row.r + 0.5 * row.h) / row.k * 100) : null; }

/* ─────────────────────────── 6. Practice at home (Study Buddy) ───────────────────────────
   Study Buddy files one entry per worksheet it marked on the child's roster
   row (studentProfiles/{uid}.tutorGaps.{worksheetId}):
     { ws name, sub, lvl, at, n attempted, w wrong, tags: [{ t, q, why, v, top }] }
   and Ans Key's concept-tags.js names each tag ('label') and says what to do
   about it ('fix'). `tags` is that file's API when it could be loaded; without
   it a tag still reads sensibly from its id. */
export function cleanSheet(id, e) {
  if (!e || typeof e !== 'object' || !(num(e.at) > 0)) return null;
  return {
    id: str(id, 120), ws: str(e.ws, 90) || 'Worksheet', sub: subjectKey(e.sub), lvl: str(e.lvl, 8), at: num(e.at),
    n: Math.max(0, Math.floor(num(e.n))), w: Math.max(0, Math.floor(num(e.w))),
    tags: (Array.isArray(e.tags) ? e.tags : []).filter(t => t && typeof t.t === 'string').slice(0, 40)
      .map(t => ({ t: str(t.t, 60), q: str(t.q, 16), why: str(t.why, 160), v: t.v === 'partial' ? 'partial' : 'wrong', top: str(t.top, 70) }))
  };
}
export function sheetsOf(map) {
  const out = [];
  if (!map || typeof map !== 'object') return out;
  Object.keys(map).forEach(id => { const s = cleanSheet(id, map[id]); if (s) out.push(s); });
  return out.sort((a, b) => a.at - b.at);
}
export function sheetScore(s) { return s && s.n > 0 ? Math.max(0, Math.round((s.n - s.w) / s.n * 100)) : null; }
export function tagLabel(tags, id) {
  if (tags && typeof tags.label === 'function' && tags.label(id)) return tags.label(id);
  const words = String(id || '').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'A recurring slip';
}
export function tagFix(tags, id) { return tags && typeof tags.fix === 'function' ? str(tags.fix(id), 240) : ''; }

/* The recurring slips across ALL the child's marked worksheets (not only this
   week's), newest weighing most, each with its trend. Uses concept-tags.js's
   own `summarize` when it is there, so the report says what the gap view says. */
export function gapsOf(sheets, tags, now, limit) {
  const max = limit || 3;
  if (!sheets.length) return [];
  if (tags && typeof tags.summarize === 'function') {
    const map = {};
    sheets.forEach(s => { map[s.id] = { ws: s.ws, sub: s.sub, lvl: s.lvl, at: s.at, n: s.n, w: s.w, tags: s.tags }; });
    try {
      const sum = tags.summarize(map, { now, limit: max });
      return (sum.gaps || []).map(g => ({ tag: g.tag, label: g.label || tagLabel(tags, g.tag), fix: g.fix || tagFix(tags, g.tag), n: g.n, trend: g.trend || 'steady',
        topics: [...new Set((g.mistakes || []).map(m => m.top).filter(Boolean))].slice(0, 2) }));
    } catch (e) { /* fall through to the simple count */ }
  }
  const by = {};
  sheets.forEach(s => s.tags.forEach(t => {
    const g = by[t.t] || (by[t.t] = { tag: t.t, label: tagLabel(tags, t.t), fix: tagFix(tags, t.t), n: 0, last: 0, trend: 'steady', topics: [] });
    g.n++; g.last = Math.max(g.last, s.at);
    if (t.top && !g.topics.includes(t.top) && g.topics.length < 2) g.topics.push(t.top);
  }));
  return Object.keys(by).map(k => by[k]).sort((a, b) => b.n - a.n || b.last - a.last).slice(0, max);
}

/* Which Study Buddy rows belong to which office child.
   profiles: [{ uid, data }]  (studentProfiles), access: { uid: studentAccess row }
   1. A row the live class made for the child carries officeId = familyId_childId.
   2. Otherwise the account's /student approval names the parent's email: the
      office family with that email, and the child of theirs whose name (or,
      with one child, level) fits. Rows that fit nobody are left out.
   → { rosterId: [sheets…] } */
export function practiceByRoster(profiles, access, families) {
  const out = {};
  const fams = (families || []).map(f => normalizeFamily(f));
  const byEmail = new Map();
  fams.forEach(f => familyEmails(f).forEach(e => { if (!byEmail.has(e)) byEmail.set(e, f); }));
  const add = (rosterId, sheets) => {
    const list = out[rosterId] || (out[rosterId] = []);
    sheets.forEach(s => { if (!list.some(x => x.id === s.id)) list.push(s); });
    list.sort((a, b) => a.at - b.at);
  };
  (profiles || []).forEach(p => {
    const data = p && p.data || {};
    const sheets = sheetsOf(data.tutorGaps);
    if (!sheets.length) return;
    const officeId = String(data.officeId || '');
    if (/^[A-Za-z0-9-]{1,60}_[A-Za-z0-9-]{1,60}$/.test(officeId)) { add(officeId, sheets); return; }
    const rec = access && access[p.uid];
    if (!rec) return;
    const emails = [rec.parentEmail, rec.email].map(cleanEmail).filter(isEmail);
    const fam = emails.map(e => byEmail.get(e)).find(Boolean);
    if (!fam) return;
    const kids = (fam.students || []).filter(s => s.status !== 'left');
    const child = matchChild(kids, [data.name, ...(Array.isArray(rec.children) ? rec.children.map(c => c && c.name) : [])], data.level);
    if (child) add(rosterIdOf(fam, child), sheets);
  });
  return out;
}
export function matchChild(kids, names, level) {
  const list = kids || [];
  for (const raw of names || []) {
    const want = nameTokens(raw);
    if (!want.length) continue;
    const hits = list.filter(k => { const have = nameTokens(k.name); return want.some(t => have.includes(t)); });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      const exact = hits.filter(k => nameTokens(k.name).join(' ') === want.join(' '));
      if (exact.length === 1) return exact[0];
    }
  }
  if (list.length === 1) return list[0];
  const lv = String(level || '').toUpperCase();
  const byLevel = lv ? list.filter(k => String(k.level || '').toUpperCase() === lv) : [];
  return byLevel.length === 1 ? byLevel[0] : null;
}

/* ─────────────────────────── 7. One child's week ─────────────────────────── */
/* ctx: { schedule, courses, docNames, live: {rosterId: rows}, practice: {rosterId: sheets},
          tags, clock, win: {start, end}, now } */
export function childReport(family, student, ctx) {
  const c = ctx || {};
  const win = c.win;
  const rosterId = rosterIdOf(family, student);
  const inWin = t => t > win.start && t <= win.end;

  // In class: each of the child's timetable classes, from Polymath Online.
  const classes = [];
  (student.classes || []).filter(k => k && !k.custom && k.slotId).forEach(k => {
    const slot = scheduleSlot(c.schedule, k.slotId);
    const course = courseForSlot(c.courses, c.schedule, k.slotId, student.level);
    const cov = course ? classCoverage(course, win, c.clock, c.docNames) : null;
    classes.push({
      slotId: k.slotId,
      title: (slot.level ? levelLabel(slot.level) + ' ' : '') + (slot.subject ? subjectWord(slot.subject) : 'Class'),
      when: slotShortLabel(k.slotId),
      subject: subjectKey(slot.subject),
      online: !!course,
      taught: cov ? cov.taught : [],
      next: cov ? cov.next : null
    });
  });

  // Live lessons this week.
  const live = (c.live && c.live[rosterId] || []).filter(r => inWin(r.d || 0)).map(r => {
    const topic = classes.reduce((found, cl) => found || (cl.taught.find(t => t.date && sgDay(t.date) === sgDay(r.d)) || null), null);
    return Object.assign({}, r, { score: liveScore(r), answeredPct: pct(r.a, r.q), topic: topic ? topic.name : '' });
  });

  // Practice at home this week, and the slips across all their marked work.
  const allSheets = (c.practice && c.practice[rosterId]) || [];
  const practice = allSheets.filter(s => inWin(s.at)).map(s => Object.assign({}, s, { score: sheetScore(s) }));
  const gaps = gapsOf(allSheets, c.tags, c.now || win.end, 3);

  // Totals.
  const asked = live.reduce((t, r) => t + Math.max(0, r.q), 0);
  const answered = live.reduce((t, r) => t + Math.max(0, r.a), 0);
  const marked = live.reduce((t, r) => t + Math.max(0, r.k), 0);
  const right = live.reduce((t, r) => t + Math.max(0, r.r) + 0.5 * Math.max(0, r.h), 0);
  const focusRows = live.filter(r => r.f >= 0);
  const pracQ = practice.reduce((t, s) => t + s.n, 0);
  const pracRight = practice.reduce((t, s) => t + Math.max(0, s.n - s.w), 0);
  const taughtCount = classes.reduce((t, cl) => t + cl.taught.length, 0);
  const totals = {
    lessons: Math.max(live.length, 0), classWorksheets: taughtCount,
    asked, answered, answeredPct: pct(answered, asked),
    marked, correctPct: marked > 0 ? Math.round(right / marked * 100) : null,
    focusPct: focusRows.length ? Math.round(focusRows.reduce((t, r) => t + r.f, 0) / focusRows.length) : null,
    practiceSheets: practice.length, practiceQuestions: pracQ, practicePct: pct(pracRight, pracQ)
  };

  // Doing well / needs work.
  const strong = [], weak = [];
  practice.forEach(s => {
    if (s.score == null || s.n < 3) return;
    const label = s.ws + (s.sub ? ' (' + subjectWord(s.sub) + ')' : '');
    if (s.score >= STRONG_PCT) strong.push({ what: label, why: s.score + '% on practice', score: s.score });
    else if (s.score < WEAK_PCT) weak.push({ what: label, why: s.score + '% on practice', score: s.score });
  });
  live.forEach(r => {
    if (r.score == null || r.k < 2) return;
    const label = r.topic || 'Live lesson on ' + dayShort(r.d);
    if (r.score >= STRONG_PCT) strong.push({ what: label, why: r.score + '% right in the live lesson', score: r.score });
    else if (r.score < WEAK_PCT) weak.push({ what: label, why: r.score + '% right in the live lesson', score: r.score });
  });
  gaps.forEach(g => {
    if (g.trend === 'improving') strong.push({ what: g.label, why: 'fewer of these slips than before', score: 100, gap: true });
    else weak.push({ what: g.label, why: plural(g.n, 'time') + ' in marked work' + (g.trend === 'worse' ? ', more often lately' : g.trend === 'new' ? ', new this week' : ''), score: 0, gap: true, topics: g.topics });
  });
  strong.sort((a, b) => b.score - a.score);
  weak.sort((a, b) => a.score - b.score);

  // What to practise next: at most three, most useful first.
  const next = [];
  gaps.filter(g => g.trend !== 'improving' && g.fix).slice(0, 2).forEach(g => next.push(g.fix + (g.topics && g.topics.length ? ' (seen in ' + listJoin(g.topics) + ')' : '')));
  const weakSheet = practice.filter(s => s.score != null && s.score < WEAK_PCT).sort((a, b) => a.score - b.score)[0];
  if (weakSheet && next.length < 3) next.push('Redo the questions marked wrong in “' + weakSheet.ws + '” from Study Buddy\'s mistake book, without looking at the answers first.');
  const weakLesson = live.filter(r => r.score != null && r.score < WEAK_PCT).sort((a, b) => a.score - b.score)[0];
  if (weakLesson && next.length < 3) next.push('Go through the answer key and lesson video for ' + (weakLesson.topic ? '“' + weakLesson.topic + '”' : 'the ' + dayShort(weakLesson.d) + ' lesson') + ' on Polymath Online.');
  const upcoming = classes.find(cl => cl.next);
  if (upcoming && next.length < 3) next.push('Look over “' + upcoming.next.name + '” before the next ' + upcoming.title + ' lesson' + (upcoming.next.date ? ' (' + dayShort(upcoming.next.date) + ')' : '') + ' — reading it first makes the lesson stick.');
  if (!practice.length && next.length < 3) next.push('Try one practice worksheet in Study Buddy this week: it marks the work straight away and shows exactly where marks were lost.');
  const missedTime = live.filter(r => r.f >= 0 && r.f < 75).length;
  if (missedTime && next.length < 3) next.push('Keep the class screen open for the whole live lesson — focus was lower than usual this week.');

  const active = !!(live.length || practice.length || taughtCount);
  return {
    rosterId, name: student.name, first: firstName(student.name) || student.name, level: student.level,
    classes, live, practice, gaps, totals, strong: strong.slice(0, 4), weak: weak.slice(0, 4), next: next.slice(0, 3), active
  };
}

/* One family's report: every child of theirs who did something this week.
   → { familyId, parentName, to, children, empty, reason } */
export function familyReport(rawFamily, ctx) {
  const f = normalizeFamily(rawFamily);
  const c = ctx || {};
  const month = sgDay(c.win.end).slice(0, 7);
  const base = { familyId: f.id, parentName: f.parentName, code: f.code, to: familyEmails(f), children: [], empty: true, reason: '' };
  const state = familyStateIn(f, month);
  if (state !== 'active') return Object.assign(base, { reason: state === 'paused' ? 'paused' : 'withdrawn' });
  if (familyOptedOut(c.weekly, f.id)) return Object.assign(base, { reason: 'opted out' });
  const kids = (f.students || []).filter(s => s.status === 'active');
  if (!kids.length) return Object.assign(base, { reason: 'no active children' });
  const children = kids.map(s => childReport(f, s, c)).filter(r => r.active);
  if (!children.length) return Object.assign(base, { reason: 'nothing this week' });
  return Object.assign(base, { children, empty: false, reason: base.to.length ? '' : 'no email' });
}

/* ─────────────────────────── 8. The email ─────────────────────────── */
const P = 'font-size:15px;line-height:1.6;margin:0 0 10px;color:#10303a;';
function tileHtml(label, value, sub, colour) {
  return '<td style="width:25%;padding:4px;vertical-align:top;"><div style="background:#f2f9fa;border:1px solid #d1eaee;border-radius:12px;padding:10px 6px;text-align:center;">'
    + '<div style="font-size:11px;color:#3d5a61;text-transform:uppercase;letter-spacing:.05em;">' + escapeHtml(label) + '</div>'
    + '<div style="font-size:22px;font-weight:800;color:' + (colour || '#10303a') + ';margin-top:4px;">' + escapeHtml(value) + '</div>'
    + (sub ? '<div style="font-size:11px;color:#6b7f85;margin-top:2px;">' + escapeHtml(sub) + '</div>' : '') + '</div></td>';
}
function h3(text, colour) { return '<div style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:' + (colour || '#056c76') + ';margin:18px 0 6px;">' + escapeHtml(text) + '</div>'; }
function listHtml(items, colour, mark) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">' + items.map(it =>
    '<tr><td style="width:22px;vertical-align:top;padding:4px 0;color:' + colour + ';font-weight:700;">' + mark + '</td>'
    + '<td style="vertical-align:top;padding:4px 0;font-size:14px;line-height:1.5;color:#10303a;">' + it + '</td></tr>').join('') + '</table>';
}
function rowTable(head, rows) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">'
    + '<tr>' + head.map((x, i) => '<td style="padding:4px 6px;color:#6b7f85;font-size:11px;text-transform:uppercase;letter-spacing:.04em;' + (i ? 'text-align:right;' : '') + '">' + escapeHtml(x) + '</td>').join('') + '</tr>'
    + rows.map(r => '<tr>' + r.map((x, i) => '<td style="padding:6px;border-top:1px solid #e7eef0;vertical-align:top;' + (i ? 'text-align:right;white-space:nowrap;' : '') + '">' + x + '</td>').join('') + '</tr>').join('')
    + '</table>';
}
export function childSectionHtml(ch) {
  const t = ch.totals;
  const E = escapeHtml;
  let h = '<div style="margin:22px 0 0;padding:16px 16px 14px;border:1px solid #d1eaee;border-radius:14px;">';
  h += '<div style="font-size:19px;font-weight:800;color:#10303a;">' + E(ch.name) + (ch.level ? ' <span style="font-size:13px;font-weight:700;color:#056c76;background:#e3f4f6;border-radius:999px;padding:2px 9px;vertical-align:middle;">' + E(levelLabel(ch.level)) + '</span>' : '') + '</div>';
  // At a glance.
  const tiles = [
    tileHtml('Worksheets in class', String(t.classWorksheets), t.lessons ? plural(t.lessons, 'live lesson') : ''),
    tileHtml('Answered in class', t.asked ? t.answered + '/' + t.asked : '—', t.answeredPct == null ? 'live lessons' : t.answeredPct + '%', t.answeredPct == null ? '' : scoreColour(t.answeredPct)),
    tileHtml('Correct in class', t.correctPct == null ? '—' : t.correctPct + '%', t.correctPct == null ? 'not marked yet' : (t.focusPct == null ? 'teacher-marked' : 'focus ' + t.focusPct + '%'), scoreColour(t.correctPct)),
    tileHtml('Practice at home', String(t.practiceSheets), t.practicePct == null ? (t.practiceSheets ? '' : 'worksheets') : t.practicePct + '% right', t.practicePct == null ? '' : scoreColour(t.practicePct))
  ];
  h += '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:10px 0 0;"><tr>' + tiles.join('') + '</tr></table>';
  // In class.
  const withWork = ch.classes.filter(cl => cl.taught.length || cl.next);
  if (withWork.length) {
    h += h3('In class this week');
    withWork.forEach(cl => {
      h += '<div style="font-size:14px;line-height:1.55;margin:4px 0 8px;"><b>' + E(cl.title) + '</b> <span style="color:#6b7f85;">· ' + E(cl.when) + '</span>';
      if (cl.taught.length) h += '<br>' + cl.taught.map(w => '✓ ' + E(w.name) + (w.date ? ' <span style="color:#6b7f85;">(' + E(dayShort(w.date)) + ')</span>' : '')).join('<br>');
      if (cl.next) h += '<br><span style="color:#056c76;">→ Next: ' + E(cl.next.name) + (cl.next.date ? ' (' + E(dayShort(cl.next.date)) + ')' : '') + '</span>';
      h += '</div>';
    });
  }
  // Live lessons.
  if (ch.live.length) {
    h += h3('Live lessons');
    h += rowTable(['Lesson', 'Answered', 'Correct', 'Focus'], ch.live.map(r => [
      '<b>' + E(dayShort(r.d)) + '</b>' + (r.topic ? '<br><span style="color:#3d5a61;">' + E(r.topic) + '</span>' : r.l ? '<br><span style="color:#6b7f85;">' + E(r.l) + '</span>' : ''),
      E(r.q > 0 ? r.a + ' / ' + r.q : '—'),
      '<span style="color:' + scoreColour(r.score) + ';font-weight:700;">' + E(r.score == null ? '—' : r.score + '%') + '</span>',
      E(r.f >= 0 ? r.f + '%' : '—')
    ]));
  }
  // Practice at home.
  if (ch.practice.length) {
    h += h3('Practice at home (Study Buddy)');
    h += rowTable(['Worksheet', 'Questions', 'Score'], ch.practice.map(s => [
      E(s.ws) + '<br><span style="color:#6b7f85;">' + E(dayShort(s.at) + (s.sub ? ' · ' + subjectWord(s.sub) : '')) + '</span>',
      E(String(s.n)),
      '<span style="color:' + scoreColour(s.score) + ';font-weight:700;">' + E(s.score == null ? '—' : s.score + '%') + '</span>'
    ]));
  }
  // Doing well / needs work.
  if (ch.strong.length) {
    h += h3('Doing well', '#0b7a50');
    h += listHtml(ch.strong.map(x => '<b>' + E(x.what) + '</b> <span style="color:#3d5a61;">— ' + E(x.why) + '</span>'), '#0b7a50', '★');
  }
  if (ch.weak.length) {
    h += h3('Needs more work', '#b26a00');
    h += listHtml(ch.weak.map(x => '<b>' + E(x.what) + '</b> <span style="color:#3d5a61;">— ' + E(x.why) + (x.topics && x.topics.length ? ' (' + E(listJoin(x.topics)) + ')' : '') + '</span>'), '#b26a00', '!');
  }
  if (ch.next.length) {
    h += '<div style="margin:16px 0 0;padding:12px 14px;background:#f1f8f4;border-left:4px solid #0b7a50;border-radius:8px;">'
      + '<div style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0b7a50;margin:0 0 4px;">What to practise this week</div>'
      + listHtml(ch.next.map(E), '#0b7a50', '→') + '</div>';
  }
  h += '</div>';
  return h;
}
export function childSectionText(ch) {
  const t = ch.totals;
  const L = [];
  L.push('━━ ' + ch.name + (ch.level ? ' (' + levelLabel(ch.level) + ')' : '') + ' ━━');
  L.push('Worksheets in class: ' + t.classWorksheets + (t.lessons ? ' · Live lessons: ' + t.lessons : '')
    + (t.asked ? ' · Answered in class: ' + t.answered + '/' + t.asked : '')
    + (t.correctPct != null ? ' · Correct: ' + t.correctPct + '%' : '')
    + ' · Practice worksheets: ' + t.practiceSheets + (t.practicePct != null ? ' (' + t.practicePct + '% right)' : ''));
  const withWork = ch.classes.filter(cl => cl.taught.length || cl.next);
  if (withWork.length) {
    L.push('', 'In class this week:');
    withWork.forEach(cl => {
      L.push('  ' + cl.title + ' (' + cl.when + ')');
      cl.taught.forEach(w => L.push('    ✓ ' + w.name + (w.date ? ' (' + dayShort(w.date) + ')' : '')));
      if (cl.next) L.push('    → Next: ' + cl.next.name + (cl.next.date ? ' (' + dayShort(cl.next.date) + ')' : ''));
    });
  }
  if (ch.live.length) {
    L.push('', 'Live lessons:');
    ch.live.forEach(r => L.push('  ' + dayShort(r.d) + (r.topic ? ' — ' + r.topic : '') + ': answered ' + (r.q > 0 ? r.a + '/' + r.q : '—')
      + (r.score != null ? ', ' + r.score + '% correct' : '') + (r.f >= 0 ? ', focus ' + r.f + '%' : '')));
  }
  if (ch.practice.length) {
    L.push('', 'Practice at home (Study Buddy):');
    ch.practice.forEach(s => L.push('  ' + dayShort(s.at) + ' — ' + s.ws + ': ' + s.n + ' questions' + (s.score != null ? ', ' + s.score + '%' : '')));
  }
  if (ch.strong.length) { L.push('', 'Doing well:'); ch.strong.forEach(x => L.push('  ★ ' + x.what + ' — ' + x.why)); }
  if (ch.weak.length) { L.push('', 'Needs more work:'); ch.weak.forEach(x => L.push('  ! ' + x.what + ' — ' + x.why)); }
  if (ch.next.length) { L.push('', 'What to practise this week:'); ch.next.forEach(x => L.push('  → ' + x)); }
  return L.join('\n');
}
const HOW_WE_MEASURE = 'How we measure: "Correct in class" counts only answers your child\'s teacher marked in the live lesson. '
  + '"Practice at home" is the worksheets Study Buddy marked this week. "Worksheets in class" follows your child\'s class on Polymath Online. '
  + '"Focus" is how much of the live lesson the class screen stayed open in front of your child.';

// weekly: normalizeWeekly(...); settings: the office's normalizeSettings(...).
export function weeklyEmail(report, settings, weekly, win) {
  const s = normalizeSettings(settings);
  const w = normalizeWeekly(weekly);
  const names = report.children.map(c => c.first || c.name);
  const subject = 'Weekly progress report: ' + listJoin(names) + ' · ' + weekLabel(win);
  const note = w.note;
  const inner = '<p style="' + P + '">Dear ' + escapeHtml(report.parentName || 'Parent') + ',</p>'
    + '<p style="' + P + '">Here is how ' + escapeHtml(listJoin(names)) + ' did this week (' + escapeHtml(weekLabel(win)) + ') — what was covered in class, how they did, and what to practise next.</p>'
    + (note ? '<div style="margin:12px 0 4px;padding:12px 14px;background:#fff8e6;border-left:4px solid #f0a500;border-radius:8px;font-size:14px;line-height:1.55;"><b>From the centre:</b> ' + escapeHtml(note).replace(/\n/g, '<br>') + '</div>' : '')
    + report.children.map(childSectionHtml).join('')
    + '<div style="margin:20px 0 0;text-align:center;">'
    + '<a href="' + ONLINE_URL + '" style="display:inline-block;background:#056c76;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:10px;margin:4px;">Worksheets, answer keys &amp; videos</a>'
    + '<a href="' + STUDY_BUDDY_URL + '" style="display:inline-block;background:#ffffff;color:#056c76;border:1px solid #056c76;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:10px;margin:4px;">Practise in Study Buddy</a></div>'
    + '<p style="font-size:12px;line-height:1.55;color:#6b7f85;margin:18px 0 0;">' + escapeHtml(HOW_WE_MEASURE) + ' Reply to this email if you would rather not receive the weekly report.</p>';
  const html = emailShell('Weekly progress report · ' + weekLabel(win), inner, s);
  const text = ['Dear ' + (report.parentName || 'Parent') + ',', '',
    'Here is how ' + listJoin(names) + ' did this week (' + weekLabel(win) + ').', '',
    note ? 'From the centre: ' + note + '\n' : '',
    report.children.map(childSectionText).join('\n\n'), '',
    'Worksheets, answer keys and videos: ' + ONLINE_URL,
    'Practise in Study Buddy: ' + STUDY_BUDDY_URL, '',
    HOW_WE_MEASURE, 'Reply to this email if you would rather not receive the weekly report.', '', s.signature].join('\n').replace(/\n{3,}/g, '\n\n');
  return { subject, html, text };
}

/* The office's preview: every family's report in ONE email, with a summary
   on top, so the reports can be checked before parents get them. */
export function previewEmail(reports, settings, weekly, win, opts) {
  const s = normalizeSettings(settings);
  const o = opts || {};
  const ready = reports.filter(r => !r.empty && r.to.length);
  const noEmail = reports.filter(r => !r.empty && !r.to.length);
  const quiet = reports.filter(r => r.empty && r.reason === 'nothing this week');
  const optedOut = reports.filter(r => r.reason === 'opted out');
  const sent = o.mode === 'sent';
  const lines = [
    sent ? plural(o.sentCount || 0, 'family', 'families') + ' were emailed their report' + (o.already ? ' (' + plural(o.already, 'family', 'families') + ' had already been sent this week\'s)' : '') + (o.failed ? '; ' + o.failed + ' could not be sent' : '') + '.'
      : plural(ready.length, 'family', 'families') + ' would get a report' + (o.mode === 'send' ? ' (these are emailed on Sunday at 6 PM)' : '') + '.',
    noEmail.length ? plural(noEmail.length, 'family', 'families') + ' have a report but no email address: ' + noEmail.map(r => r.parentName).join(', ') + '.' : '',
    quiet.length ? plural(quiet.length, 'family', 'families') + ' had nothing to report this week (no class worksheets, live lessons or practice).' : '',
    optedOut.length ? plural(optedOut.length, 'family', 'families') + ' asked not to get the report.' : ''
  ].filter(Boolean);
  let budget = PREVIEW_HTML_BUDGET;
  let shown = 0;
  let body = '';
  for (const r of ready.concat(noEmail)) {
    const part = '<div style="margin:26px 0 0;padding:10px 12px;background:#10303a;color:#ffffff;border-radius:10px;font-size:14px;"><b>' + escapeHtml(r.parentName || 'Family') + '</b>'
      + ' <span style="color:#b8e4e8;">→ ' + escapeHtml(r.to.length ? r.to.join(', ') : 'no email address') + '</span></div>'
      + r.children.map(childSectionHtml).join('');
    if (shown >= PREVIEW_MAX_FAMILIES_FULL || part.length > budget) break;
    body += part; budget -= part.length; shown++;
  }
  const more = ready.length + noEmail.length - shown;
  const inner = '<p style="' + P + '"><b>This week\'s parent progress reports (' + escapeHtml(weekLabel(win)) + ')</b></p>'
    + '<ul style="font-size:14px;line-height:1.6;padding-left:20px;margin:0 0 8px;">' + lines.map(l => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>'
    + '<p style="font-size:14px;line-height:1.6;margin:8px 0 0;color:#3d5a61;">' + escapeHtml(sent ? 'Below is a copy of every report that went out.'
      : o.mode === 'send' ? 'Weekly reports are set to email parents every Sunday at 6 PM.'
      : 'Nothing has been sent to parents. To send them, open Polymath Office → 📈 Reports and press "Email parents now", or choose "Email parents every Sunday".') + '</p>'
    + '<p style="margin:12px 0 0;"><a href="' + SITE + '/office/#reports" style="display:inline-block;background:#056c76;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px;">Open 📈 Reports</a></p>'
    + body
    + (more > 0 ? '<p style="font-size:13px;color:#6b7f85;margin:16px 0 0;">…and ' + plural(more, 'more family', 'more families') + ' (open 📈 Reports to see every one).</p>' : '');
  const html = emailShell((sent ? 'Weekly reports sent · ' : 'Weekly reports preview · ') + weekLabel(win), inner, s);
  const text = ['This week\'s parent progress reports (' + weekLabel(win) + ')', '', ...lines.map(l => '- ' + l), '', SITE + '/office/#reports'].join('\n');
  const subject = sent ? '📈 Weekly progress reports sent — ' + weekLabel(win) + ' (' + plural(o.sentCount || 0, 'family', 'families') + ')'
    : '📈 Weekly progress reports — preview, ' + weekLabel(win) + ' (' + plural(ready.length, 'family', 'families') + ')';
  return { subject, html, text, shown, more };
}

/* ─────────────────────────── 9. Mail documents and the log ─────────────────────────── */
// One family's report for one week has ONE mail document id, created only if
// it does not exist yet, so the same week can never reach a parent twice.
export function weeklyMailId(weekKey, familyId) { return MAIL_PREFIX + 'weekly-' + weekKey + '-' + String(familyId).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80); }
export function previewMailId(weekKey, now) { return MAIL_PREFIX + 'weekly-preview-' + weekKey + '-' + (now == null ? Date.now() : Number(now)); }
export function weeklyMail(report, message, settings, meta) {
  return officeMail(report.to, message, Object.assign({ kind: 'weekly-report', familyId: report.familyId }, meta || {}), Object.assign({}, normalizeSettings(settings), { copyAdmin: false }));
}
export function previewRecipients(settings) {
  const s = normalizeSettings(settings);
  return [...new Set([OFFICE_ADMINS[0], s.replyTo].filter(isEmail))];
}
// officeSettings/weekly-<Sunday>-preview and weekly-<Sunday>-send: the week's two logs.
export function weekLogId(weekKey, kind) { return 'weekly-' + weekKey + '-' + (kind === 'send' ? 'send' : 'preview'); }
// officeSettings/weeklyfam-<Sunday>-<familyId>: one family's report as built, for the Reports tab's preview.
export function familyLogId(weekKey, familyId) { return 'weeklyfam-' + weekKey + '-' + String(familyId).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80); }
// What the office's Reports tab lists for one family, without the email itself.
export function reportSummary(r) {
  return {
    familyId: r.familyId, parentName: str(r.parentName, 120), to: r.to.slice(0, 2), reason: r.reason || '', empty: !!r.empty,
    children: (r.children || []).map(c => ({
      name: str(c.name, 80), level: c.level || '', worksheets: c.totals.classWorksheets, lessons: c.totals.lessons,
      correctPct: c.totals.correctPct, practice: c.totals.practiceSheets, practicePct: c.totals.practicePct,
      strong: c.strong.length, weak: c.weak.length
    }))
  };
}
export function weekLog(weekKey, win, reports, meta) {
  const m = meta || {};
  const list = reports.map(reportSummary);
  return {
    kind: WEEKLY_LOG_KIND, weekKey, label: weekLabel(win), start: win.start, end: win.end, version: WEEKLY_VERSION,
    runKind: m.kind || 'preview', auto: !!m.auto, by: str(m.by, 120), at: Number(m.at) || Date.now(),
    counts: {
      families: reports.length,
      withReport: reports.filter(r => !r.empty).length,
      emailed: (m.sent || []).length,
      noEmail: reports.filter(r => !r.empty && !r.to.length).length,
      nothing: reports.filter(r => r.reason === 'nothing this week').length,
      optedOut: reports.filter(r => r.reason === 'opted out').length,
      already: (m.already || []).length,
      failed: (m.failed || []).length
    },
    sent: (m.sent || []).slice(0, 400), already: (m.already || []).slice(0, 400), failed: (m.failed || []).slice(0, 100).map(x => str(x, 200)),
    families: list.filter(x => !x.empty).slice(0, 400)
  };
}
export const COLLECTION = COLLECTIONS.settings;
export { CENTRE_NAME };
export { DAYS_LONG };
