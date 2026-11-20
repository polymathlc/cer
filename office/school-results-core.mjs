/* ═══════════════════════════════════════════════════════════════════════════
   📊 SCHOOL RESULTS — the rules (school-results-core.mjs)

   Parents enter each school test and exam result of their child (Maths and
   Science) on their own link, polymathlc.com.sg/results/?f=<family>&k=<key>,
   and the office can enter or correct them in the Office's Results tab. This
   file decides every NUMBER and SENTENCE about them, for both pages and the
   tests (tools/school-results-tests.mjs):

     • what a result is (subject, exam, date, marks out of, grade) and how a
       typed-in one is cleaned
     • the grade a result counts as: the AL band for primary (AL1 best … AL8),
       A1 … F9 for secondary; taken from the grade the parent chose, or worked
       out from the marks with the same cut-offs schools use
     • for each child and subject: the last result BEFORE they joined Polymath
       against their latest one since, in marks and in grades
     • the headline numbers for the centre ("8 in 10 of our students improved by
       at least one grade after joining Polymath"), with the sentences ready to
       copy
     • the chart (an SVG string: marks over time, the joining date marked)
     • the email and WhatsApp asking a parent for results

   Storage (Firestore, CER project mathgen--app). One document per family in
   the admin-only officeSettings collection, so saving a family in the Office can
   never overwrite a result a parent entered meanwhile, and no Firestore rule has
   to change:
     officeSettings/results-<familyId>
       kind       'school-results'
       familyId   the officeFamilies id
       token      the random key in the parent's link (the parent page never
                  reads Firestore; shop-function/functions/school-results.js
                  checks the key with the Admin SDK)
       students   { <studentId>: [ result, … ] }
       parentUpdatedAt  when a parent last added or changed a result (ms)
       linkSentAt / linkSentVia   when the office last sent the link
   A result: { id, subject, exam, label, date, mark, max, grade, by, at }
     subject  'Math' | 'Science'
     exam     a key of EXAMS ('WA1', 'SA2', 'PSLE', 'Test', …)
     label    the parent's own name for a 'Test' or 'Other' (optional)
     date     YYYY-MM-DD (a typical date for the exam is filled in)
     mark/max the marks, e.g. 72 out of 100 (mark may be empty when only a
              grade is known, e.g. PSLE)
     grade    'AL1' … 'AL8' or 'A1' … 'F9', or '' (worked out from the marks)
     by       'parent' | 'office'
     at       when it was saved (ms)

   No Firestore, no DOM, no network: plain functions, so Node can test them.
   Keep EXAMS, GRADES and LIMITS equal to shop-function/functions/school-results.js
   (a test checks).
   ═══════════════════════════════════════════════════════════════════════════ */

export const RESULTS_VERSION = '1.0.0';
export const RESULTS_KIND = 'school-results';
export const RESULTS_DOC_PREFIX = 'results-';
export const SITE = 'https://polymathlc.com.sg';
export const RESULTS_PATH = '/results/';
export const SUBJECTS = Object.freeze(['Math', 'Science']);
export const SUBJECT_LABEL = Object.freeze({ Math: 'Maths', Science: 'Science' });
// The line colours of the chart: the centre's own teal and pink.
export const SUBJECT_COLOUR = Object.freeze({ Math: '#056c76', Science: '#ec008c' });

// The exams of a Singapore school year, with a typical date that is filled in
// for the parent (they can change it). month/day: when results usually come back.
export const EXAMS = Object.freeze([
  Object.freeze({ key: 'WA1', label: 'WA1 (Weighted Assessment 1)', short: 'WA1', month: 3, day: 1 }),
  Object.freeze({ key: 'WA2', label: 'WA2 (Weighted Assessment 2)', short: 'WA2', month: 5, day: 1 }),
  Object.freeze({ key: 'SA1', label: 'Mid-year exam (SA1)', short: 'Mid-year', month: 5, day: 20 }),
  Object.freeze({ key: 'WA3', label: 'WA3 (Weighted Assessment 3)', short: 'WA3', month: 8, day: 10 }),
  Object.freeze({ key: 'Prelim', label: 'Prelim exam', short: 'Prelim', month: 8, day: 31 }),
  Object.freeze({ key: 'SA2', label: 'End-of-year exam (SA2)', short: 'End-of-year', month: 10, day: 25 }),
  Object.freeze({ key: 'PSLE', label: 'PSLE', short: 'PSLE', month: 11, day: 25 }),
  Object.freeze({ key: 'Test', label: 'Class test or quiz', short: 'Test', month: 0, day: 0 }),
  Object.freeze({ key: 'Other', label: 'Other', short: 'Other', month: 0, day: 0 })
]);
export const EXAM_KEYS = Object.freeze(EXAMS.map(e => e.key));

// The grades, best first. Primary: the PSLE Achievement Levels. Secondary: the
// O-level grades. A lower number is ALWAYS better.
export const GRADES = Object.freeze({
  AL: Object.freeze(['AL1', 'AL2', 'AL3', 'AL4', 'AL5', 'AL6', 'AL7', 'AL8']),
  SEC: Object.freeze(['A1', 'A2', 'B3', 'B4', 'C5', 'C6', 'D7', 'E8', 'F9'])
});
// The lowest percentage for each grade (the same cut-offs as PSLE and the O levels).
export const GRADE_CUTS = Object.freeze({
  AL: Object.freeze([90, 85, 80, 75, 65, 45, 20, 0]),
  SEC: Object.freeze([75, 70, 65, 60, 55, 50, 45, 40, 0])
});
// Where a result with a grade but no marks sits on the chart (the band's middle).
const GRADE_MIDDLE = Object.freeze({
  AL: [95, 87, 82, 77, 70, 55, 32, 10],
  SEC: [87, 72, 67, 62, 57, 52, 47, 42, 20]
});
export const LIMITS = Object.freeze({ label: 40, perStudent: 60, maxMarks: 500, students: 8 });
// A result taken up to this many days after joining still shows where the child
// started: hardly any teaching has happened yet.
export const SETTLE_DAYS = 21;
// The latest result counts as "since joining" only from this many days in.
export const AFTER_DAYS = 30;
// Fewer students than this and the headline carries a warning before it is used.
export const MIN_SAMPLE = 10;

/* ─── Small helpers ─── */
export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function isDayKey(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return false;
  const [y, m, d] = String(v).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
export function dayMs(key) {
  if (!isDayKey(key)) return NaN;
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function addDays(key, n) {
  const t = dayMs(key);
  return Number.isFinite(t) ? new Date(t + n * 86400e3).toISOString().slice(0, 10) : '';
}
export function daysBetween(a, b) { return Math.round((dayMs(b) - dayMs(a)) / 86400e3); }
// Singapore's calendar day, whatever the device's time zone says.
export function sgToday(now) {
  const t = now == null ? Date.now() : (now instanceof Date ? now.getTime() : Number(now));
  return new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayLabel(key) {
  if (!isDayKey(key)) return '';
  const [y, m, d] = key.split('-').map(Number);
  return d + ' ' + MONTHS[m - 1] + ' ' + y;
}
export function monthLabel(key) {
  if (!isDayKey(key)) return '';
  const [y, m] = key.split('-').map(Number);
  return MONTHS[m - 1] + ' ' + y;
}
function oneLine(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function round1(n) { return Math.round(n * 10) / 10; }
function numberOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 2) / 2 : null;
}
export function listJoin(items) {
  const a = (items || []).filter(Boolean);
  if (a.length <= 1) return a.join('');
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}
export function firstName(full) { return String(full || '').trim().split(/\s+/)[0] || ''; }
export function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/* ─── Exams and grades ─── */
export function examOf(key) { return EXAMS.find(e => e.key === key) || null; }
// The secondary scale for S1 and up; the AL bands for primary.
export function scaleFor(level) { return /^S/i.test(String(level || '').trim()) ? 'SEC' : 'AL'; }
export function gradesFor(level) { return GRADES[scaleFor(level)]; }
export function scaleOfGrade(grade) {
  const g = String(grade || '').toUpperCase();
  if (GRADES.AL.includes(g)) return 'AL';
  if (GRADES.SEC.includes(g)) return 'SEC';
  return '';
}
export function cleanGrade(grade) {
  const g = String(grade || '').toUpperCase().replace(/\s+/g, '');
  return scaleOfGrade(g) ? g : '';
}
// 1 is the best grade on either scale.
export function gradeRank(grade) {
  const g = cleanGrade(grade);
  const s = scaleOfGrade(g);
  return s ? GRADES[s].indexOf(g) + 1 : null;
}
export function gradeFromPercent(scale, pct) {
  if (pct == null || !Number.isFinite(pct)) return '';
  const cuts = GRADE_CUTS[scale] || GRADE_CUTS.AL;
  const i = cuts.findIndex(c => pct >= c - 1e-9);
  return GRADES[scale in GRADES ? scale : 'AL'][i < 0 ? cuts.length - 1 : i];
}
// The usual date for an exam in a given year (the parent can change it).
export function defaultExamDate(examKey, year) {
  const e = examOf(examKey);
  const y = Number(year);
  if (!e || !e.month || !(y >= 2000 && y <= 2100)) return '';
  return y + '-' + String(e.month).padStart(2, '0') + '-' + String(e.day).padStart(2, '0');
}
export function examName(r) {
  if (!r) return '';
  const e = examOf(r.exam);
  if (r.label && (r.exam === 'Test' || r.exam === 'Other')) return r.label;
  return e ? e.short : String(r.exam || '');
}
export function examLongName(r) {
  if (!r) return '';
  const e = examOf(r.exam);
  if (r.label && (r.exam === 'Test' || r.exam === 'Other')) return r.label;
  return e ? e.label : String(r.exam || '');
}

/* ─── One result ─── */
// Cleans a typed-in result. Returns { result } or { error } — the error is a
// sentence for the parent. `opts`: { by, at, id, today }.
export function validateResult(raw, opts) {
  const o = opts || {};
  const r = raw && typeof raw === 'object' ? raw : {};
  const subject = SUBJECTS.includes(r.subject) ? r.subject : '';
  if (!subject) return { error: 'Choose Maths or Science.' };
  const exam = EXAM_KEYS.includes(r.exam) ? r.exam : '';
  if (!exam) return { error: 'Choose which test or exam it was.' };
  const label = oneLine(r.label, LIMITS.label);
  const date = isDayKey(r.date) ? r.date : '';
  if (!date) return { error: 'Choose the date of the test (roughly is fine).' };
  const today = isDayKey(o.today) ? o.today : sgToday();
  if (date > addDays(today, 7)) return { error: 'That date is in the future.' };
  if (date < '2015-01-01') return { error: 'That date is too long ago.' };
  let mark = numberOrNull(r.mark);
  let max = numberOrNull(r.max);
  if (max == null) max = 100;
  if (!(max > 0) || max > LIMITS.maxMarks) return { error: 'The total marks should be between 1 and ' + LIMITS.maxMarks + '.' };
  if (mark != null && (mark < 0 || mark > max)) return { error: 'The marks should be between 0 and ' + max + '.' };
  const grade = cleanGrade(r.grade);
  if (mark == null && !grade) return { error: 'Type the marks, or choose the grade (AL), or both.' };
  const id = /^[A-Za-z0-9_-]{4,40}$/.test(String(r.id || '')) ? String(r.id) : (o.id || '');
  return {
    result: {
      id, subject, exam, label: (exam === 'Test' || exam === 'Other') ? label : '', date,
      mark, max, grade,
      by: o.by === 'office' ? 'office' : (r.by === 'office' ? 'office' : 'parent'),
      at: Number.isFinite(Number(o.at)) && o.at ? Number(o.at) : (Number(r.at) || 0)
    }
  };
}
// A stored result, read leniently (never throws, drops what cannot be used).
export function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const v = validateResult(raw, { today: '2100-01-01', by: raw.by, at: raw.at, id: raw.id });
  return v.result && v.result.id ? v.result : null;
}
export function resultPercent(r) {
  if (!r || r.mark == null || !(r.max > 0)) return null;
  return round1(r.mark / r.max * 100);
}
// The grade a result counts as, on the scale of the child's level: the grade
// chosen if there is one, otherwise worked out from the marks.
export function resultGrade(r, level) {
  if (!r) return { grade: '', scale: '', rank: null, worked: false };
  if (r.grade) return { grade: r.grade, scale: scaleOfGrade(r.grade), rank: gradeRank(r.grade), worked: false };
  const pct = resultPercent(r);
  if (pct == null) return { grade: '', scale: '', rank: null, worked: false };
  const scale = scaleFor(level);
  const g = gradeFromPercent(scale, pct);
  return { grade: g, scale, rank: gradeRank(g), worked: true };
}
// Where the result sits on a 0–100 chart: its percentage, or its band's middle.
export function resultPlotValue(r, level) {
  const pct = resultPercent(r);
  if (pct != null) return pct;
  const g = resultGrade(r, level);
  if (!g.scale) return null;
  return GRADE_MIDDLE[g.scale][g.rank - 1];
}
export function resultText(r, level) {
  if (!r) return '';
  const pct = resultPercent(r);
  const g = resultGrade(r, level);
  const marks = r.mark != null ? (r.max === 100 ? r.mark + '%' : r.mark + '/' + r.max + ' (' + Math.round(pct) + '%)') : '';
  return [marks, g.grade ? (g.worked ? '≈' + g.grade : g.grade) : ''].filter(Boolean).join(' · ');
}
export function sortResults(list) {
  return (list || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at || 0) - (b.at || 0)));
}
export function newResultId(random) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const r = typeof random === 'function' ? random(10) : Array.from({ length: 10 }, () => Math.floor(Math.random() * 1e9));
  return 'r' + Array.from(r, n => chars[n % chars.length]).join('');
}

/* ─── A family's document ─── */
export function resultsDocId(familyId) { return RESULTS_DOC_PREFIX + String(familyId || ''); }
export function stampMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}
export function normalizeResultsDoc(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const students = {};
  const src = d.students && typeof d.students === 'object' && !Array.isArray(d.students) ? d.students : {};
  Object.keys(src).forEach(sid => {
    const list = (Array.isArray(src[sid]) ? src[sid] : []).map(normalizeResult).filter(Boolean);
    if (list.length) students[sid] = sortResults(list).slice(-LIMITS.perStudent);
  });
  return {
    familyId: String(d.familyId || ''),
    token: typeof d.token === 'string' ? d.token : '',
    students,
    parentUpdatedAt: stampMs(d.parentUpdatedAt),
    officeSeenAt: stampMs(d.officeSeenAt),
    linkSentAt: stampMs(d.linkSentAt),
    linkSentVia: String(d.linkSentVia || ''),
    updatedAt: stampMs(d.updatedAt)
  };
}
export function resultsLink(familyId, token) {
  return SITE + RESULTS_PATH + '?f=' + encodeURIComponent(familyId) + '&k=' + encodeURIComponent(token);
}
// The list after adding or replacing one result (same id → replaced).
export function upsertResult(list, result) {
  const out = (list || []).filter(r => r.id !== result.id);
  out.push(result);
  return sortResults(out).slice(-LIMITS.perStudent);
}
export function removeResult(list, id) { return (list || []).filter(r => r.id !== id); }
export function resultCount(doc) {
  const s = (doc && doc.students) || {};
  return Object.keys(s).reduce((n, k) => n + (s[k] || []).length, 0);
}

/* ─── Before and after joining ─── */
// The day the child started with us: "With us since" on the child, else the
// family's sign-up date.
export function joinDateOf(student, family) {
  if (student && isDayKey(student.startDate)) return student.startDate;
  if (family && isDayKey(family.signUpDate)) return family.signUpDate;
  return '';
}
// For one child and one subject: the last result before joining (or, failing
// that, one taken in the first SETTLE_DAYS) against the latest one taken at
// least AFTER_DAYS after joining.
export function compareSubject(results, joinDate, level) {
  const list = sortResults((results || []).filter(Boolean));
  const out = { count: list.length, before: null, after: null, pctBefore: null, pctAfter: null, pctDelta: null,
    gradeBefore: '', gradeAfter: '', gradeDelta: null, scale: '', comparable: false, reason: '' };
  if (!list.length) { out.reason = 'no-results'; return out; }
  if (!isDayKey(joinDate)) { out.reason = 'no-join-date'; return out; }
  const pre = list.filter(r => r.date < joinDate);
  const settle = list.filter(r => r.date >= joinDate && daysBetween(joinDate, r.date) <= SETTLE_DAYS);
  out.before = pre.length ? pre[pre.length - 1] : (settle[0] || null);
  const post = list.filter(r => daysBetween(joinDate, r.date) >= AFTER_DAYS && (!out.before || r.date > out.before.date));
  out.after = post.length ? post[post.length - 1] : null;
  if (!out.before) { out.reason = 'no-before'; return out; }
  if (!out.after) { out.reason = 'no-after'; return out; }
  out.comparable = true;
  out.pctBefore = resultPercent(out.before);
  out.pctAfter = resultPercent(out.after);
  if (out.pctBefore != null && out.pctAfter != null) out.pctDelta = round1(out.pctAfter - out.pctBefore);
  const gb = resultGrade(out.before, level), ga = resultGrade(out.after, level);
  out.gradeBefore = gb.grade; out.gradeAfter = ga.grade;
  if (gb.scale && gb.scale === ga.scale) { out.scale = gb.scale; out.gradeDelta = gb.rank - ga.rank; }
  return out;
}
export const REASON_TEXT = Object.freeze({
  'no-results': 'No results yet',
  'no-join-date': 'No joining date: set "With us since" in Families',
  'no-before': 'No result from before joining',
  'no-after': 'Waiting for a result since joining'
});
// "▲ 2 grades", "▼ 1 grade", "same grade", "+12 marks".
export function changeText(cmp) {
  if (!cmp || !cmp.comparable) return '';
  const bits = [];
  if (cmp.gradeDelta != null) {
    const n = Math.abs(cmp.gradeDelta);
    bits.push(cmp.gradeDelta > 0 ? '▲ ' + plural(n, 'grade') : cmp.gradeDelta < 0 ? '▼ ' + plural(n, 'grade') : 'same grade');
  }
  if (cmp.pctDelta != null) bits.push((cmp.pctDelta > 0 ? '+' : cmp.pctDelta < 0 ? '−' : '±') + Math.abs(Math.round(cmp.pctDelta)) + ' marks');
  return bits.join(' · ');
}
export function changeTone(cmp) {
  if (!cmp || !cmp.comparable) return 'none';
  const d = cmp.gradeDelta != null ? cmp.gradeDelta : (cmp.pctDelta != null ? Math.sign(Math.round(cmp.pctDelta)) : 0);
  return d > 0 ? 'up' : d < 0 ? 'down' : 'same';
}

/* ─── Every child ─── */
// One row per child (who has not left, unless includeLeft), with their results
// and the before/after of each subject.
//   families  normalized office families ({ id, parentName, students: [...] })
//   docs      { <familyId>: normalized results document }
//   opts      { includeLeft, level, subject, search }
export function childRows(families, docs, opts) {
  const o = opts || {};
  const rows = [];
  (families || []).forEach(f => {
    const doc = (docs && docs[f.id]) || null;
    const famLeft = f.status === 'withdrawn' || f.withdrawn === true || f.status === 'inactive';
    (f.students || []).forEach(s => {
      if (!s || !s.name) return;
      const left = famLeft || s.status === 'left';
      const results = (doc && doc.students && doc.students[s.id]) || [];
      if (left && !o.includeLeft) return;
      if (o.level && s.level !== o.level) return;
      const join = joinDateOf(s, f);
      const bySubject = {};
      SUBJECTS.forEach(sub => { bySubject[sub] = compareSubject(results.filter(r => r.subject === sub), join, s.level); });
      const row = {
        familyId: f.id, studentId: s.id, name: s.name, level: s.level || '', parentName: f.parentName || '',
        join, left, results, bySubject,
        subjects: SUBJECTS.filter(sub => results.some(r => r.subject === sub)),
        hasLink: !!(doc && doc.token), linkSentAt: doc ? doc.linkSentAt : 0,
        parentUpdatedAt: doc ? doc.parentUpdatedAt : 0
      };
      if (o.search) {
        const q = String(o.search).toLowerCase().trim();
        if (q && !(row.name + ' ' + row.parentName).toLowerCase().includes(q)) return;
      }
      rows.push(row);
    });
  });
  return rows;
}

/* ─── The headline numbers ─── */
// Over the rows given (and one subject, or both): how many children can be
// compared, how many went up a grade, the average marks before and after, and
// the sentences to copy. A child in both subjects counts once for "students";
// each subject counts once for "results".
export function headline(rows, opts) {
  const o = opts || {};
  const subjects = o.subject ? [o.subject] : SUBJECTS.slice();
  const pairs = [];
  (rows || []).forEach(r => subjects.forEach(sub => {
    const c = r.bySubject && r.bySubject[sub];
    if (c && c.comparable) pairs.push({ row: r, subject: sub, cmp: c });
  }));
  const kids = new Map();
  pairs.forEach(p => {
    const k = p.row.familyId + '/' + p.row.studentId;
    if (!kids.has(k)) kids.set(k, { row: p.row, pairs: [] });
    kids.get(k).pairs.push(p);
  });
  const graded = [...kids.values()].filter(k => k.pairs.some(p => p.cmp.gradeDelta != null));
  const improvedKids = graded.filter(k => k.pairs.some(p => p.cmp.gradeDelta != null && p.cmp.gradeDelta >= 1));
  const marked = [...kids.values()].filter(k => k.pairs.some(p => p.cmp.pctDelta != null));
  const upKids = marked.filter(k => {
    const d = k.pairs.filter(p => p.cmp.pctDelta != null);
    return d.reduce((s, p) => s + p.cmp.pctDelta, 0) / d.length > 0;
  });
  const pctPairs = pairs.filter(p => p.cmp.pctDelta != null);
  const avg = a => a.length ? round1(a.reduce((s, x) => s + x, 0) / a.length) : null;
  const gradePairs = pairs.filter(p => p.cmp.gradeDelta != null);
  const best = gradePairs.slice().sort((a, b) => b.cmp.gradeDelta - a.cmp.gradeDelta || (b.cmp.pctDelta || 0) - (a.cmp.pctDelta || 0))[0] || null;
  const out = {
    subject: o.subject || '',
    children: (rows || []).length,
    withResults: (rows || []).filter(r => r.results.some(x => subjects.includes(x.subject))).length,
    results: (rows || []).reduce((n, r) => n + r.results.filter(x => subjects.includes(x.subject)).length, 0),
    compared: kids.size,
    pairs: pairs.length,
    pctPairsCount: pctPairs.length,
    graded: graded.length,
    improvedGrade: improvedKids.length,
    improvedGradePairs: gradePairs.filter(p => p.cmp.gradeDelta >= 1).length,
    gradePairs: gradePairs.length,
    marked: marked.length,
    marksUp: upKids.length,
    avgBefore: avg(pctPairs.map(p => p.cmp.pctBefore)),
    avgAfter: avg(pctPairs.map(p => p.cmp.pctAfter)),
    avgGain: avg(pctPairs.map(p => p.cmp.pctDelta)),
    avgGradeGain: avg(gradePairs.map(p => p.cmp.gradeDelta)),
    best: best && best.cmp.gradeDelta >= 1 ? { level: best.row.level, subject: best.subject, from: best.cmp.gradeBefore, to: best.cmp.gradeAfter, grades: best.cmp.gradeDelta } : null,
    small: kids.size < MIN_SAMPLE
  };
  out.sentences = headlineSentences(out);
  return out;
}
// "8 in 10", rounded to the nearest whole number of ten.
export function inTen(part, whole) {
  if (!(whole > 0)) return '';
  return Math.round(part / whole * 10) + ' in 10';
}
export function percentOf(part, whole) { return whole > 0 ? Math.round(part / whole * 100) : null; }
// The sentences for the home page or a flyer; none names a child.
export function headlineSentences(h) {
  const out = [];
  const subj = h.subject ? SUBJECT_LABEL[h.subject] + ' ' : '';
  if (h.graded > 0) {
    out.push({ key: 'grade', text: inTen(h.improvedGrade, h.graded) + ' of our students improved by at least one grade in ' + (h.subject ? SUBJECT_LABEL[h.subject] : 'school exams') + ' after joining Polymath.',
      basis: h.improvedGrade + ' of ' + plural(h.graded, 'student') + ' (' + percentOf(h.improvedGrade, h.graded) + '%)' });
  }
  if (h.avgBefore != null && h.avgAfter != null && h.pairs > 0) {
    out.push({ key: 'average', text: 'Our students\' average ' + subj + 'mark rose from ' + Math.round(h.avgBefore) + '% to ' + Math.round(h.avgAfter) + '% after joining Polymath.',
      basis: 'Average over ' + plural(h.pctPairsCount || h.pairs, 'result') + ', before joining and the latest since' });
  }
  if (h.marked > 0) {
    out.push({ key: 'marks', text: inTen(h.marksUp, h.marked) + ' of our students scored higher ' + subj + 'marks after joining Polymath.',
      basis: h.marksUp + ' of ' + plural(h.marked, 'student') + ' (' + percentOf(h.marksUp, h.marked) + '%)' });
  }
  if (h.best) {
    out.push({ key: 'best', text: 'One of our ' + (h.best.level || '') + ' students went from ' + h.best.from + ' to ' + h.best.to + ' in ' + SUBJECT_LABEL[h.best.subject] + '.',
      basis: 'The biggest jump (' + plural(h.best.grades, 'grade') + '). No name is used.' });
  }
  return out.map(s => Object.assign(s, { text: s.text.replace(/\s+/g, ' ') }));
}

/* ─── The chart ─── */
// Marks (%) over time for one child, one line per subject, the joining date as
// a dashed line with the time before it shaded. A result with only a grade is a
// hollow dot at its band's middle. Returns an SVG string that scales to its box.
//   opts: { join, level, subjects, width, height, labels, compact, today, title }
export function chartSvg(results, opts) {
  const o = opts || {};
  const W = o.width || 560, H = o.height || (o.compact ? 132 : 220);
  const padL = o.compact ? 30 : 38, padR = 14, padT = o.compact ? 12 : 22, padB = o.compact ? 22 : 30;
  const subjects = (o.subjects && o.subjects.length ? o.subjects : SUBJECTS).filter(s => SUBJECTS.includes(s));
  const list = sortResults((results || []).filter(r => r && subjects.includes(r.subject)));
  const pts = list.map(r => ({ r, v: resultPlotValue(r, o.level), t: dayMs(r.date) })).filter(p => p.v != null && Number.isFinite(p.t));
  const title = o.title ? '<title>' + esc(o.title) + '</title>' : '';
  if (!pts.length) {
    return '<svg class="sr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="No results yet" xmlns="http://www.w3.org/2000/svg">' + title
      + '<rect x="0.5" y="0.5" width="' + (W - 1) + '" height="' + (H - 1) + '" rx="12" fill="#f7fbfc" stroke="#d1eaee"/>'
      + '<text x="' + W / 2 + '" y="' + (H / 2 + 5) + '" text-anchor="middle" font-size="14" fill="#5c6b70" font-family="inherit">No results yet</text></svg>';
  }
  const joinT = isDayKey(o.join) ? dayMs(o.join) : NaN;
  let t0 = Math.min(...pts.map(p => p.t), Number.isFinite(joinT) ? joinT : Infinity);
  let t1 = Math.max(...pts.map(p => p.t), Number.isFinite(joinT) ? joinT : -Infinity);
  if (t1 - t0 < 60 * 86400e3) { const mid = (t0 + t1) / 2; t0 = mid - 30 * 86400e3; t1 = mid + 30 * 86400e3; }
  const span = t1 - t0;
  t0 -= span * 0.06; t1 += span * 0.06;
  const x = t => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
  const y = v => padT + (1 - v / 100) * (H - padT - padB);
  const parts = [];
  parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="12" fill="#ffffff"/>');
  if (Number.isFinite(joinT)) {
    const jx = x(joinT);
    parts.push('<rect x="' + padL + '" y="' + padT + '" width="' + Math.max(0, jx - padL).toFixed(1) + '" height="' + (H - padT - padB) + '" fill="#f1f4f5"/>');
  }
  [0, 25, 50, 75, 100].forEach(v => {
    if (o.compact && (v === 25 || v === 75)) return;
    parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="#e3eef0" stroke-width="1"/>');
    parts.push('<text x="' + (padL - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="' + (o.compact ? 10 : 11) + '" fill="#7a8b90" font-family="inherit">' + v + '</text>');
  });
  // Month ticks: at most 6 labels.
  const d0 = new Date(t0), d1 = new Date(t1);
  const months = [];
  for (let yy = d0.getUTCFullYear(), mm = d0.getUTCMonth() + 1; Date.UTC(yy, mm, 1) <= d1.getTime(); mm++) {
    if (mm > 11) { mm = 0; yy++; }
    const t = Date.UTC(yy, mm, 1);
    if (t >= t0 && t <= t1) months.push(t);
    if (months.length > 120) break;
  }
  const every = Math.max(1, Math.ceil(months.length / (o.compact ? 4 : 6)));
  months.forEach((t, i) => {
    if (i % every) return;
    const d = new Date(t);
    const lab = MONTHS[d.getUTCMonth()] + (d.getUTCMonth() === 0 || i === 0 ? ' ' + String(d.getUTCFullYear()).slice(2) : '');
    parts.push('<text x="' + x(t).toFixed(1) + '" y="' + (H - (o.compact ? 6 : 9)) + '" text-anchor="middle" font-size="' + (o.compact ? 10 : 11) + '" fill="#7a8b90" font-family="inherit">' + esc(lab) + '</text>');
  });
  if (Number.isFinite(joinT)) {
    const jx = x(joinT).toFixed(1);
    parts.push('<line x1="' + jx + '" x2="' + jx + '" y1="' + (padT - (o.compact ? 4 : 10)) + '" y2="' + (H - padB) + '" stroke="#10303a" stroke-width="1.5" stroke-dasharray="4 4"/>');
    parts.push('<text x="' + (Number(jx) + 5) + '" y="' + (padT - (o.compact ? -6 : 0)) + '" font-size="' + (o.compact ? 10 : 11) + '" font-weight="700" fill="#10303a" font-family="inherit">Joined Polymath</text>');
  }
  subjects.forEach(sub => {
    const sp = pts.filter(p => p.r.subject === sub);
    if (!sp.length) return;
    const col = SUBJECT_COLOUR[sub];
    if (sp.length > 1) parts.push('<polyline fill="none" stroke="' + col + '" stroke-width="' + (o.compact ? 2 : 2.5) + '" stroke-linejoin="round" stroke-linecap="round" points="' + sp.map(p => x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ') + '"/>');
    sp.forEach(p => {
      const hollow = resultPercent(p.r) == null;
      const tip = SUBJECT_LABEL[sub] + ' · ' + examName(p.r) + ' · ' + dayLabel(p.r.date) + ' · ' + resultText(p.r, o.level);
      parts.push('<circle cx="' + x(p.t).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="' + (o.compact ? 3.5 : 4.5) + '" fill="' + (hollow ? '#ffffff' : col) + '" stroke="' + col + '" stroke-width="2"><title>' + esc(tip) + '</title></circle>');
      if (o.labels !== false && !o.compact && sp.length <= 10) {
        const g = resultGrade(p.r, o.level);
        const lab = (resultPercent(p.r) != null ? Math.round(resultPercent(p.r)) : '') + (g.grade && !g.worked ? (resultPercent(p.r) != null ? ' ' : '') + g.grade : '');
        const above = p.v < 88;
        parts.push('<text x="' + x(p.t).toFixed(1) + '" y="' + (above ? y(p.v) - 9 : y(p.v) + 17).toFixed(1) + '" text-anchor="middle" font-size="11" font-weight="700" fill="' + col + '" font-family="inherit">' + esc(lab) + '</text>');
      }
    });
  });
  const aria = 'Marks over time' + (Number.isFinite(joinT) ? ', joined ' + dayLabel(o.join) : '');
  return '<svg class="sr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(aria) + '" xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">' + title + parts.join('') + '</svg>';
}

/* ─── Asking parents ─── */
export function requestWhatsappText(family, link, opts) {
  const o = opts || {};
  const kids = listJoin((family.students || []).filter(s => s.name && s.status !== 'left').map(s => firstName(s.name)));
  return 'Hi ' + (family.parentName || 'Parent') + ', this is Polymath Learning Centre 😊 '
    + 'To keep track of ' + (kids ? kids + '\'s' : 'your child\'s') + ' progress, could you share their school Maths and Science results with us? '
    + 'Each test and exam (WA, mid-year, end-of-year, prelim, PSLE) takes a few seconds to add here: ' + link
    + (o.short ? '' : ' Only the centre sees them. Thank you!');
}
// The email asking for results. `shell(title, innerHtml)` wraps it in the
// office's letterhead (office-core's emailShell); `signature` ends the text.
export function requestEmail(family, link, opts) {
  const o = opts || {};
  const kids = listJoin((family.students || []).filter(s => s.name && s.status !== 'left').map(s => firstName(s.name)));
  const who = kids ? kids + '\'s' : 'your child\'s';
  const shell = typeof o.shell === 'function' ? o.shell : ((t, inner) => inner);
  const inner = '<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">Dear ' + esc(family.parentName || 'Parent') + ',</p>'
    + '<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">We would love to see how ' + esc(who) + ' school results are coming along. '
    + 'Could you add their Maths and Science test and exam results on the page below? It takes a few seconds per result, and you can add more after every test.</p>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;"><tr><td align="center" style="padding:20px;background:#f2f9fa;border:1px solid #d1eaee;border-radius:14px;">'
    + '<div style="font-size:13px;color:#056c76;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px;">📊 ' + esc(kids ? kids + '\'s' : 'Your child\'s') + ' school results</div>'
    + '<a href="' + esc(link) + '" style="display:inline-block;background:#056c76;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;">Add school results</a>'
    + '<div style="font-size:12px;color:#5c6b70;margin-top:10px;word-break:break-all;">' + esc(link) + '</div>'
    + '</td></tr></table>'
    + '<p style="font-size:14px;line-height:1.6;margin:0 0 8px;color:#10303a;"><b>Why we ask</b></p>'
    + '<ul style="font-size:14px;line-height:1.7;margin:0 0 10px;padding-left:20px;color:#10303a;">'
    + '<li>We see each result next to what we teach, so we can spot a topic that needs more work early.</li>'
    + '<li>You get a chart of ' + esc(who) + ' marks over time, from before they joined us until now.</li>'
    + '<li>Only the centre sees the results. This link is for your family only, so please do not share it.</li>'
    + '</ul>';
  const html = shell('School results', inner);
  const text = [
    'Dear ' + (family.parentName || 'Parent') + ',', '',
    'We would love to see how ' + who + ' school results are coming along. Could you add their Maths and Science test and exam results here? It takes a few seconds per result:',
    link, '',
    'We see each result next to what we teach, and you get a chart of the marks over time. Only the centre sees the results; this link is for your family only.',
    '', o.signature || 'Polymath Learning Centre'
  ].join('\n');
  return { subject: 'Share ' + (kids ? kids + '\'s' : 'your child\'s') + ' school results with Polymath', html, text };
}

/* ─── A CSV of every result (for the office) ─── */
export function resultsCsv(rows) {
  const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['Student', 'Level', 'Parent', 'With us since', 'Subject', 'Exam', 'Date', 'Marks', 'Out of', 'Percent', 'Grade', 'Grade worked out', 'Entered by'].join(',')];
  (rows || []).forEach(r => r.results.forEach(x => {
    const g = resultGrade(x, r.level);
    lines.push([r.name, r.level, r.parentName, r.join, SUBJECT_LABEL[x.subject], examLongName(x), x.date, x.mark == null ? '' : x.mark, x.max,
      resultPercent(x) == null ? '' : resultPercent(x), g.grade, g.worked ? 'yes' : 'no', x.by].map(q).join(','));
  }));
  return lines.join('\n') + '\n';
}
