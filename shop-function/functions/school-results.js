'use strict';

// 📊 School results: the parent's own page, polymathlc.com.sg/results/?f=<family>&k=<key>.
//
// Parents add each school test and exam result of their child (Maths and
// Science). The office emails or WhatsApps the link from the Office's Results
// tab, which also writes the key. Everything is kept in ONE admin-only document
// per family, which the parent's page cannot read, so it posts here instead:
//
//   officeSettings/results-<familyId>
//     { kind: 'school-results', familyId, token, students: { <studentId>: [result] },
//       parentUpdatedAt, parentWrites: { day, n }, … }
//   officeFamilies/<familyId>   read only: the children's names and levels
//
//   schoolResults  POST { action: 'load',   family, token }
//                    → { ok, parentName, students: [{ id, name, level, results }], today }
//                  POST { action: 'save',   family, token, studentId, result }
//                    → { ok, result, students }      a new result, or one of the
//                                                    parent's own changed (same id)
//                  POST { action: 'remove', family, token, studentId, resultId }
//                    → { ok, students }               one of the parent's own results
//   A wrong family, a wrong key, or a link the office switched off all answer
//   404 'link-not-found'. A result the office entered cannot be changed here
//   (403 'entered-by-centre'). The answer never carries the family's email,
//   WhatsApp, address, invoices or the key.
//
// No Stripe, no email, no Firestore rule changes (Admin SDK). The rules for
// what a result is are office/school-results-core.mjs's; the copies below are
// kept equal by a test (test/school-results.test.js).
const { timingSafeEqual, randomBytes } = require('node:crypto');
const { ShopError } = require('./service');

const RESULTS_KIND = 'school-results';
const SETTINGS = 'officeSettings';
const FAMILIES = 'officeFamilies';
const FAMILY_ID = /^[A-Za-z0-9_-]{4,64}$/;
const STUDENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RESULT_ID = /^[A-Za-z0-9_-]{4,40}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
// Keep equal to office/school-results-core.mjs (a test checks).
const SUBJECTS = ['Math', 'Science'];
const EXAM_KEYS = ['WA1', 'WA2', 'SA1', 'WA3', 'Prelim', 'SA2', 'PSLE', 'Test', 'Other'];
const GRADES = {
  AL: ['AL1', 'AL2', 'AL3', 'AL4', 'AL5', 'AL6', 'AL7', 'AL8'],
  SEC: ['A1', 'A2', 'B3', 'B4', 'C5', 'C6', 'D7', 'E8', 'F9']
};
const LIMITS = Object.freeze({ label: 40, perStudent: 60, maxMarks: 500, students: 8 });
// A family typing results in for every child after every exam stays far below this.
const PARENT_WRITES_PER_DAY = 120;

function oneLine(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 2) / 2 : null;
}
function isDayKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [y, m, d] = String(value).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function sgDay(ms) { return new Date(ms + 8 * 3600e3).toISOString().slice(0, 10); }
function addDays(key, n) { return new Date(Date.parse(key + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10); }
function cleanGrade(grade) {
  const g = String(grade || '').toUpperCase().replace(/\s+/g, '');
  return GRADES.AL.includes(g) || GRADES.SEC.includes(g) ? g : '';
}
function millis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}
function sameKey(given, stored) {
  if (typeof given !== 'string' || typeof stored !== 'string' || !stored) return false;
  const a = Buffer.from(given), b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}
function newResultId() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  return 'r' + Array.from(randomBytes(10), n => chars[n % chars.length]).join('');
}

// A typed-in result, cleaned; throws 400 with a reason the page shows.
function cleanResult(raw, today) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const bad = reason => { throw new ShopError(400, 'invalid-result', [reason]); };
  if (!r) bad('result');
  const subject = SUBJECTS.includes(r.subject) ? r.subject : bad('subject');
  const exam = EXAM_KEYS.includes(r.exam) ? r.exam : bad('exam');
  const date = isDayKey(r.date) ? r.date : bad('date');
  if (date > addDays(today, 7)) bad('date-future');
  if (date < '2015-01-01') bad('date-old');
  const max = numberOrNull(r.max) == null ? 100 : numberOrNull(r.max);
  if (!(max > 0) || max > LIMITS.maxMarks) bad('max');
  const mark = numberOrNull(r.mark);
  if (mark != null && (mark < 0 || mark > max)) bad('mark');
  const grade = cleanGrade(r.grade);
  if (mark == null && !grade) bad('mark-or-grade');
  return {
    id: RESULT_ID.test(String(r.id || '')) ? String(r.id) : '',
    subject, exam, label: exam === 'Test' || exam === 'Other' ? oneLine(r.label, LIMITS.label) : '',
    date, mark, max, grade
  };
}
// A stored result as the page may see it.
function publicResult(r) {
  return {
    id: String(r.id || ''), subject: r.subject, exam: r.exam, label: oneLine(r.label, LIMITS.label), date: r.date,
    mark: r.mark == null ? null : Number(r.mark), max: Number(r.max) || 100, grade: cleanGrade(r.grade),
    by: r.by === 'office' ? 'office' : 'parent', at: millis(r.at)
  };
}
function storedList(doc, studentId) {
  const s = doc && doc.students && typeof doc.students === 'object' ? doc.students[studentId] : null;
  return (Array.isArray(s) ? s : []).filter(r => r && RESULT_ID.test(String(r.id || '')) && SUBJECTS.includes(r.subject) && isDayKey(r.date));
}
function sortList(list) {
  return list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : millis(a.at) - millis(b.at)));
}
// The children the page lists: everyone who has not left, plus anyone who
// already has results (so nothing a parent typed disappears).
function pageStudents(family, doc) {
  const kids = (Array.isArray(family.students) ? family.students : []).filter(s => s && s.id && s.name && STUDENT_ID.test(String(s.id)));
  return kids.filter(s => s.status !== 'left' || storedList(doc, s.id).length).slice(0, LIMITS.students).map(s => ({
    id: String(s.id), name: oneLine(s.name, 80), level: oneLine(s.level, 4),
    results: sortList(storedList(doc, s.id)).map(publicResult)
  }));
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ShopError(400, 'invalid-request');
  const allowed = new Set(['action', 'family', 'token', 'studentId', 'result', 'resultId']);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new ShopError(400, 'invalid-request');
  const action = ['load', 'save', 'remove'].includes(body.action) ? body.action : '';
  if (!action) throw new ShopError(400, 'invalid-request');
  const family = typeof body.family === 'string' ? body.family.trim() : '';
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!FAMILY_ID.test(family) || !TOKEN.test(token)) throw new ShopError(404, 'link-not-found');
  const out = { action, family, token };
  if (action !== 'load') {
    out.studentId = typeof body.studentId === 'string' && STUDENT_ID.test(body.studentId) ? body.studentId : '';
    if (!out.studentId) throw new ShopError(400, 'invalid-request');
  }
  if (action === 'remove') {
    out.resultId = typeof body.resultId === 'string' && RESULT_ID.test(body.resultId) ? body.resultId : '';
    if (!out.resultId) throw new ShopError(400, 'invalid-request');
  }
  if (action === 'save') out.result = body.result;
  return out;
}

function createSchoolResultsStore(db) {
  const resultsRef = family => db.collection(SETTINGS).doc('results-' + family);
  const familyRef = family => db.collection(FAMILIES).doc(family);
  return {
    async read(family) {
      const [r, f] = await Promise.all([resultsRef(family).get(), familyRef(family).get()]);
      return { doc: r.exists ? r.data() || {} : null, family: f.exists ? f.data() || {} : null };
    },
    // change(doc, family) → { doc } to write, inside one transaction.
    transact(family, change) {
      return db.runTransaction(async t => {
        const [r, f] = [await t.get(resultsRef(family)), await t.get(familyRef(family))];
        const doc = r.exists ? r.data() || {} : null;
        const fam = f.exists ? f.data() || {} : null;
        const out = change(doc, fam);
        if (out && out.write) t.set(resultsRef(family), out.write);
        return out;
      });
    }
  };
}

function createSchoolResultsService({ store, http, now = Date.now, makeId = newResultId, report = () => {} }) {
  function check(doc, family, req) {
    if (!doc || doc.kind !== RESULTS_KIND || doc.disabled === true || !family || !sameKey(req.token, doc.token))
      throw new ShopError(404, 'link-not-found');
  }
  async function schoolResults(req, res) {
    if (!http.cors(req, res)) return;
    try {
      const q = validateRequest(req.body);
      if (q.action === 'load') {
        const { doc, family } = await store.read(q.family);
        check(doc, family, q);
        return res.status(200).json({ ok: true, parentName: oneLine(family.parentName, 80), students: pageStudents(family, doc), today: sgDay(now()) });
      }
      const at = now();
      const today = sgDay(at);
      const clean = q.action === 'save' ? cleanResult(q.result, today) : null;
      const out = await store.transact(q.family, (doc, family) => {
        check(doc, family, q);
        const kids = Array.isArray(family.students) ? family.students : [];
        if (!kids.some(s => s && String(s.id) === q.studentId)) throw new ShopError(404, 'student-not-found');
        const writes = doc.parentWrites && doc.parentWrites.day === today ? Number(doc.parentWrites.n) || 0 : 0;
        if (writes >= PARENT_WRITES_PER_DAY) throw new ShopError(429, 'too-many-changes');
        const list = storedList(doc, q.studentId);
        let saved = null;
        let next;
        if (q.action === 'save') {
          const old = clean.id ? list.find(r => r.id === clean.id) : null;
          if (clean.id && !old) throw new ShopError(404, 'result-not-found');
          if (old && old.by === 'office') throw new ShopError(403, 'entered-by-centre');
          if (!old && list.length >= LIMITS.perStudent) throw new ShopError(409, 'too-many-results');
          saved = Object.assign({}, clean, { id: old ? old.id : makeId(), by: 'parent', at });
          next = sortList(list.filter(r => r.id !== saved.id).concat([saved]));
        } else {
          const old = list.find(r => r.id === q.resultId);
          if (!old) throw new ShopError(404, 'result-not-found');
          if (old.by === 'office') throw new ShopError(403, 'entered-by-centre');
          next = list.filter(r => r.id !== q.resultId);
        }
        const students = Object.assign({}, doc.students && typeof doc.students === 'object' ? doc.students : {});
        students[q.studentId] = next;
        const write = Object.assign({}, doc, { students, parentUpdatedAt: at, updatedAt: at, updatedBy: 'parent',
          parentWrites: { day: today, n: writes + 1 } });
        return { write, saved, family, doc: write };
      });
      const body = { ok: true, students: pageStudents(out.family, out.doc) };
      if (out.saved) body.result = publicResult(out.saved);
      return res.status(200).json(body);
    } catch (error) {
      return http.answerError(res, error, 'school-results-failed');
    }
  }
  return { schoolResults };
}

module.exports = {
  RESULTS_KIND, SUBJECTS, EXAM_KEYS, GRADES, LIMITS, PARENT_WRITES_PER_DAY,
  cleanResult, publicResult, pageStudents, validateRequest, sameKey,
  createSchoolResultsStore, createSchoolResultsService
};
