'use strict';
// The parent's diagnostic report page (diagnostic-report.js), through the real
// repository against the in-memory Firestore.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createHttp } = require('../service');
const { createDiagnosticReportService, publicReport, sameKey, validateRequest, LIMITS } = require('../diagnostic-report');
const { database, repositoryFor } = require('./fakes');

const ORIGIN = 'https://polymathlc.com.sg';
const TOKEN = 'k3y_for-the-report-1234';
const REPORT = {
  version: 1, code: 'ABC234', studentName: 'Ava Tan', parentName: 'Test Parent', email: 'parent@example.test',
  level: 'Primary 5', subject: 'Math', testDate: '2026-12-08', topicSet: 'Primary 5|Math',
  topics: [
    { name: 'Fractions', score: 4, max: 10, note: 'Mixes up numerator and denominator' },
    { name: 'Percentage', score: 9, max: 10, note: '' }
  ],
  comment: 'Ava did well.\n\nKeep going.',
  plan: { weeks: 8, steps: [{ when: 'Weeks 1–2', focus: 'Fractions', tasks: ['Re-learn fractions'] }] },
  recommended: { slot: 'THU-3', label: 'Thursday 7:00pm – 8:45pm', level: 'P5', subject: 'Math', type: 'master', mode: 'Physical', why: 'Fits.' },
  teacher: 'Mr Chung'
};
const BOOKING = {
  code: 'ABC234', kind: 'diagnostic', childName: 'Ava Tan', parentName: 'Test Parent', email: 'parent@example.test',
  whatsapp: '91234567', paymentRef: 'DIAG ABC234', status: 'attended',
  diagnosticReport: REPORT, reportToken: TOKEN, reportSentAt: 1795000000000
};

function harness(rows) {
  const db = database(rows), logs = [];
  const service = createDiagnosticReportService({ repository: repositoryFor(db), http: createHttp(code => logs.push(code)) });
  async function call(body, overrides = {}) {
    const headers = { origin: ORIGIN, 'content-type': 'application/json', ...overrides.headers };
    const req = { method: 'POST', body, ...overrides, get: name => headers[name.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; },
      send(value) { this.body = value; return this; } };
    await service.diagnosticReport(req, res);
    return res;
  }
  return { db, logs, call };
}

test('the right code and key return the report, and nothing else from the booking', async () => {
  const { call } = harness({ 'schedule_bookings/ABC234': BOOKING });
  const res = await call({ code: 'abc234', token: TOKEN });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.sentAt, 1795000000000);
  assert.equal(res.body.report.studentName, 'Ava Tan');
  assert.equal(res.body.report.topics.length, 2);
  assert.equal(res.body.report.recommended.slot, 'THU-3');
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('91234567'), 'no WhatsApp number');
  assert.ok(!text.includes(TOKEN), 'the key is not echoed');
  assert.ok(!text.includes('DIAG ABC234'), 'no payment reference');
});

test('a wrong key, a wrong code, an unsent or a taken-back report all look the same', async () => {
  const unsent = Object.assign({}, BOOKING, { code: 'UNSENT', reportSentAt: null });
  const withdrawn = Object.assign({}, BOOKING, { code: 'GONE22', reportToken: '' });
  const booking = Object.assign({}, BOOKING, { code: 'TRIAL2', kind: 'booking' });
  const { call } = harness({ 'schedule_bookings/ABC234': BOOKING, 'schedule_bookings/UNSENT': unsent,
    'schedule_bookings/GONE22': withdrawn, 'schedule_bookings/TRIAL2': booking });
  for (const body of [
    { code: 'ABC234', token: TOKEN.slice(0, -1) + 'X' },
    { code: 'ZZZ999', token: TOKEN },
    { code: 'UNSENT', token: TOKEN },
    { code: 'GONE22', token: TOKEN },
    { code: 'TRIAL2', token: TOKEN },
    { code: 'ABC234', token: 'short' }
  ]) {
    const res = await call(body);
    assert.equal(res.statusCode, 404, JSON.stringify(body));
    assert.deepEqual(res.body, { ok: false, error: 'report-not-found' });
  }
});

test('only the page\'s origins, by POST with JSON, with exactly code and token', async () => {
  const { call } = harness({ 'schedule_bookings/ABC234': BOOKING });
  assert.equal((await call({ code: 'ABC234', token: TOKEN }, { headers: { origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await call({ code: 'ABC234', token: TOKEN }, { method: 'GET' })).statusCode, 405);
  assert.equal((await call({ code: 'ABC234', token: TOKEN, extra: 1 })).statusCode, 400);
  assert.equal((await call(['ABC234'])).statusCode, 400);
  assert.equal((await call({ code: 'ABC234', token: TOKEN }, { method: 'OPTIONS' })).statusCode, 204);
});

test('the report is trimmed: lengths, counts and unknown values', () => {
  const long = 'x'.repeat(5000);
  const report = publicReport({ code: 'ABC234', childName: 'Fallback Name', diagnosticReport: {
    studentName: '', level: 'Primary 9', subject: 'Art', testDate: 'soon',
    topics: Array.from({ length: 40 }, (_, i) => ({ name: 'T' + i, score: '3.26', max: 'x', note: long })),
    comment: long + '\u0007',
    plan: { weeks: 7, steps: Array.from({ length: 10 }, () => ({ when: long, focus: 'F', tasks: Array(9).fill(long) })) },
    recommended: { slot: 'SUN-9', label: 'x' }
  } });
  assert.equal(report.studentName, 'Fallback Name');
  assert.equal(report.level, '');
  assert.equal(report.subject, '');
  assert.equal(report.testDate, '');
  assert.equal(report.topics.length, LIMITS.topics);
  assert.equal(report.topics[0].score, 3.5, 'marks to the nearest half');
  assert.equal(report.topics[0].max, null);
  assert.equal(report.topics[0].note.length, LIMITS.note);
  assert.equal(report.comment.length, LIMITS.comment);
  assert.equal(report.plan.weeks, 8);
  assert.equal(report.plan.steps.length, LIMITS.steps);
  assert.equal(report.plan.steps[0].tasks.length, LIMITS.tasks);
  assert.equal(report.recommended, null, 'not a real slot');
});

test('keys compare exactly', () => {
  assert.equal(sameKey('abc', 'abc'), true);
  assert.equal(sameKey('abc', 'abd'), false);
  assert.equal(sameKey('abc', ''), false);
  assert.equal(sameKey(undefined, 'abc'), false);
  assert.throws(() => validateRequest({ code: 'ABC234' }), /report-not-found/);
});

test('the limits match the report core the pages use', () => {
  const core = require(path.join(__dirname, '..', '..', '..', 'diagnostic', 'report-core.js'));
  for (const key of Object.keys(LIMITS)) assert.equal(core.LIMITS[key], LIMITS[key], key);
  assert.ok(readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8').includes('exports.diagnosticReport'));
});
