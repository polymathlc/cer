'use strict';

// The parent's diagnostic report page, polymathlc.com.sg/diagnostic/report/.
//
// After the free diagnostic test the teacher enters the marks on /diagnostic/#admin
// and sends the report. That writes, on schedule_bookings/{code}:
//   diagnosticReport   the report (topics and marks, teacher's note, study plan,
//                      recommended class), in the shape diagnostic/report-core.js
//                      builds and renders
//   reportToken        a random key, put in the link the parent is emailed
//   reportSentAt       when it was last sent to the parent
// Bookings are readable only by the admin, so the parent's page cannot read the
// booking itself. It posts { code, token } here instead and gets back the report
// alone, trimmed to the fields the page shows: never the booking's other fields,
// and nothing at all without the right key or before the report was sent.
//
//   diagnosticReport   POST { code, token } → { ok, report, sentAt }
//                      404 'report-not-found' for a wrong code, a wrong key, a
//                      report not sent yet or one the teacher took back
//
// Read-only, no Stripe, no email, no Firestore rule changes (Admin SDK).
const { timingSafeEqual } = require('node:crypto');
const { ShopError } = require('./service');

const CODE = /^[A-Z0-9-]{4,20}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const SLOT = /^(MON|TUE|WED|THU|FRI|SAT)-([123])$/;
const LEVELS = ['Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'];
const SUBJECTS = ['Math', 'Science'];
const MODES = ['Physical', 'Online', 'Both'];
const PLAN_WEEKS = [4, 6, 8, 12];
// Keep equal to LIMITS in diagnostic/report-core.js (a test checks).
const LIMITS = Object.freeze({ name: 80, topic: 60, note: 160, comment: 1500, why: 400, task: 220, tasks: 5, steps: 6,
  topics: 16, teacher: 60, when: 30, focus: 120, label: 80 });

function oneLine(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function paragraph(value, max) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
function number(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 2) / 2 : null;
}
function millis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

// What the parent's page may see: the report and the booking's own code. The
// parent's email is kept so the enrol button can fill it in for them; it is the
// address the link was sent to.
function publicReport(booking) {
  const r = booking && booking.diagnosticReport && typeof booking.diagnosticReport === 'object' ? booking.diagnosticReport : {};
  const plan = r.plan && typeof r.plan === 'object' ? r.plan : {};
  const rec = r.recommended && typeof r.recommended === 'object' && SLOT.test(r.recommended.slot || '') ? r.recommended : null;
  return {
    version: 1,
    code: booking.code || '',
    studentName: oneLine(r.studentName || booking.childName, LIMITS.name),
    parentName: oneLine(r.parentName || booking.parentName, LIMITS.name),
    email: oneLine(r.email || booking.email, 120),
    level: LEVELS.includes(r.level) ? r.level : '',
    subject: SUBJECTS.includes(r.subject) ? r.subject : '',
    testDate: DAY_KEY.test(r.testDate || '') ? r.testDate : '',
    topicSet: oneLine(r.topicSet, 30),
    topics: (Array.isArray(r.topics) ? r.topics : []).slice(0, LIMITS.topics).map(t => ({
      name: oneLine(t && t.name, LIMITS.topic), score: number(t && t.score), max: number(t && t.max), note: oneLine(t && t.note, LIMITS.note)
    })).filter(t => t.name),
    comment: paragraph(r.comment, LIMITS.comment),
    plan: {
      weeks: PLAN_WEEKS.includes(Number(plan.weeks)) ? Number(plan.weeks) : 8,
      steps: (Array.isArray(plan.steps) ? plan.steps : []).slice(0, LIMITS.steps).map(step => ({
        when: oneLine(step && step.when, LIMITS.when),
        focus: oneLine(step && step.focus, LIMITS.focus),
        tasks: (Array.isArray(step && step.tasks) ? step.tasks : []).slice(0, LIMITS.tasks).map(x => oneLine(x, LIMITS.task)).filter(Boolean)
      })).filter(step => step.focus || step.tasks.length)
    },
    recommended: rec ? {
      slot: rec.slot, label: oneLine(rec.label, LIMITS.label),
      level: /^P[3-6]$/.test(rec.level || '') ? rec.level : '',
      subject: SUBJECTS.includes(rec.subject) ? rec.subject : '',
      type: rec.type === 'master' ? 'master' : 'regular',
      mode: MODES.includes(rec.mode) ? rec.mode : 'Physical',
      why: paragraph(rec.why, LIMITS.why)
    } : null,
    teacher: oneLine(r.teacher, LIMITS.teacher)
  };
}

function sameKey(given, stored) {
  if (typeof given !== 'string' || typeof stored !== 'string' || !stored) return false;
  const a = Buffer.from(given), b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ShopError(400, 'invalid-request');
  const keys = new Set(['code', 'token']);
  if (Object.keys(body).some(key => !keys.has(key))) throw new ShopError(400, 'invalid-request');
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!CODE.test(code) || !TOKEN.test(token)) throw new ShopError(404, 'report-not-found');
  return { code, token };
}

function createDiagnosticReportService({ repository, http }) {
  async function diagnosticReport(req, res) {
    if (!http.cors(req, res)) return;
    try {
      const { code, token } = validateRequest(req.body);
      const booking = await repository.getBooking(code);
      if (!booking || booking.kind !== 'diagnostic' || !booking.diagnosticReport || !booking.reportSentAt
        || !sameKey(token, booking.reportToken)) throw new ShopError(404, 'report-not-found');
      return res.status(200).json({ ok: true, report: publicReport(booking), sentAt: millis(booking.reportSentAt) });
    } catch (error) {
      return http.answerError(res, error, 'diagnostic-report-failed');
    }
  }
  return { diagnosticReport };
}

module.exports = { LIMITS, publicReport, sameKey, validateRequest, createDiagnosticReportService };
