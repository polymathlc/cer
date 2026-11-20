'use strict';
// 📊 The parent's school results page (school-results.js), through the real
// store against the in-memory Firestore.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHttp } = require('../service');
const R = require('../school-results');
const { database } = require('./fakes');

const ORIGIN = 'https://polymathlc.com.sg';
const TOKEN = 'k3yForTheResults_12345678';
const NOW = Date.UTC(2026, 10, 20, 4, 0);   // 20 Nov 2026, 12:00 in Singapore
const FAMILY = {
  code: 'TAN2AA', parentName: 'Mrs Tan', email: 'tan@example.com', email2: '', whatsapp: '6591110001', address: '1 Secret Road',
  status: 'active', students: [
    { id: 'k1', name: 'Ethan Tan', level: 'P5', status: 'active', startDate: '2026-03-01' },
    { id: 'k2', name: 'Chloe Tan', level: 'P3', status: 'active', startDate: '2026-06-01' },
    { id: 'k3', name: 'Old Tan', level: 'P6', status: 'left' }
  ]
};
const OFFICE_RESULT = { id: 'roffice001', subject: 'Math', exam: 'SA1', label: '', date: '2026-05-20', mark: 61, max: 100, grade: '', by: 'office', at: 1 };
const PARENT_RESULT = { id: 'rparent001', subject: 'Math', exam: 'WA1', label: '', date: '2026-02-27', mark: 24, max: 40, grade: '', by: 'parent', at: 2 };
const DOC = { kind: 'school-results', familyId: 'tanfam', token: TOKEN, students: { k1: [OFFICE_RESULT, PARENT_RESULT] } };

function harness(rows, opts = {}) {
  const db = database(rows), logs = [];
  let n = 0;
  const service = R.createSchoolResultsService({
    store: R.createSchoolResultsStore(db), http: createHttp(code => logs.push(code)),
    now: () => opts.now || NOW, makeId: () => 'rnew' + String(++n).padStart(4, '0')
  });
  async function call(body, overrides = {}) {
    const headers = { origin: ORIGIN, 'content-type': 'application/json', ...overrides.headers };
    const req = { method: 'POST', body, ...overrides, get: name => headers[name.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; },
      send(value) { this.body = value; return this; } };
    await service.schoolResults(req, res);
    return res;
  }
  return { db, logs, call };
}
const seeded = () => harness({ 'officeFamilies/tanfam': FAMILY, 'officeSettings/results-tanfam': DOC });

test('the right link lists the children and their results, and nothing private', async () => {
  const { call } = seeded();
  const res = await call({ action: 'load', family: 'tanfam', token: TOKEN });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.parentName, 'Mrs Tan');
  assert.equal(res.body.today, '2026-11-20');
  assert.deepEqual(res.body.students.map(s => s.name), ['Ethan Tan', 'Chloe Tan'], 'a child who left with no results is not listed');
  assert.deepEqual(res.body.students[0].results.map(r => r.id), ['rparent001', 'roffice001'], 'oldest first');
  assert.equal(res.body.students[0].joined, '2026-03-01');
  assert.deepEqual(Object.keys(res.body.students[0]).sort(), ['id', 'joined', 'level', 'name', 'results']);
  assert.equal(res.body.students[0].results[1].by, 'office');
  const text = JSON.stringify(res.body);
  for (const secret of [TOKEN, 'tan@example.com', '6591110001', '1 Secret Road', 'TAN2AA'])
    assert.ok(!text.includes(secret), 'never sends ' + secret);
});

test('a wrong key, family, a switched-off link or no link at all look the same', async () => {
  const off = Object.assign({}, DOC, { disabled: true });
  const { call } = harness({ 'officeFamilies/tanfam': FAMILY, 'officeSettings/results-tanfam': DOC, 'officeFamilies/offfam': FAMILY,
    'officeSettings/results-offfam': off, 'officeFamilies/nonefam': FAMILY, 'officeSettings/results-gonefam': DOC });
  for (const body of [
    { action: 'load', family: 'tanfam', token: TOKEN.slice(0, -1) + 'X' },
    { action: 'load', family: 'nobody', token: TOKEN },
    { action: 'load', family: 'offfam', token: TOKEN },
    { action: 'load', family: 'nonefam', token: TOKEN },
    { action: 'load', family: 'gonefam', token: TOKEN },
    { action: 'load', family: 'tanfam', token: 'short' },
    { action: 'save', family: 'tanfam', token: TOKEN.slice(0, -1) + 'X', studentId: 'k1', result: { subject: 'Math', exam: 'WA2', date: '2026-05-01', mark: 30, max: 40 } }
  ]) {
    const res = await call(body);
    assert.equal(res.statusCode, 404, JSON.stringify(body));
    assert.deepEqual(res.body, { ok: false, error: 'link-not-found' });
  }
});

test('a parent adds a result: cleaned, stamped as theirs, and kept in date order', async () => {
  const { call, db } = seeded();
  const res = await call({ action: 'save', family: 'tanfam', token: TOKEN, studentId: 'k1',
    result: { subject: 'Math', exam: 'WA3', date: '2026-08-12', mark: '33.5', max: '40', grade: 'al3', label: 'ignored', by: 'office', id: '' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.result, { id: 'rnew0001', subject: 'Math', exam: 'WA3', label: '', date: '2026-08-12', mark: 33.5, max: 40, grade: 'AL3', by: 'parent', at: NOW });
  const stored = db.rows.get('officeSettings/results-tanfam');
  assert.deepEqual(stored.students.k1.map(r => r.id), ['rparent001', 'roffice001', 'rnew0001']);
  assert.equal(stored.parentUpdatedAt, NOW);
  assert.deepEqual(stored.parentChanged, { k1: NOW });
  assert.equal(stored.token, TOKEN, 'the key stays');
  assert.deepEqual(stored.parentWrites, { day: '2026-11-20', n: 1 });
  assert.equal(res.body.students[0].results.length, 3);
});

test('a parent changes and removes their own result, but not one the centre entered', async () => {
  const { call, db } = seeded();
  let res = await call({ action: 'save', family: 'tanfam', token: TOKEN, studentId: 'k1',
    result: { id: 'rparent001', subject: 'Math', exam: 'WA1', date: '2026-02-27', mark: 26, max: 40 } });
  assert.equal(res.statusCode, 200);
  assert.equal(db.rows.get('officeSettings/results-tanfam').students.k1.find(r => r.id === 'rparent001').mark, 26);
  res = await call({ action: 'save', family: 'tanfam', token: TOKEN, studentId: 'k1',
    result: { id: 'roffice001', subject: 'Math', exam: 'SA1', date: '2026-05-20', mark: 99, max: 100 } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'entered-by-centre');
  res = await call({ action: 'remove', family: 'tanfam', token: TOKEN, studentId: 'k1', resultId: 'roffice001' });
  assert.equal(res.statusCode, 403);
  res = await call({ action: 'remove', family: 'tanfam', token: TOKEN, studentId: 'k1', resultId: 'rparent001' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.rows.get('officeSettings/results-tanfam').students.k1.map(r => r.id), ['roffice001']);
  res = await call({ action: 'remove', family: 'tanfam', token: TOKEN, studentId: 'k1', resultId: 'rparent001' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'result-not-found');
  res = await call({ action: 'save', family: 'tanfam', token: TOKEN, studentId: 'k1',
    result: { id: 'rmissing01', subject: 'Math', exam: 'WA1', date: '2026-02-27', mark: 26, max: 40 } });
  assert.equal(res.statusCode, 404, 'an id that is not there is not created');
});

test('results that make no sense are refused with the reason', async () => {
  const { call, db } = seeded();
  const cases = [
    [{ subject: 'English', exam: 'WA1', date: '2026-02-27', mark: 20 }, 'subject'],
    [{ subject: 'Math', exam: 'Quiz9', date: '2026-02-27', mark: 20 }, 'exam'],
    [{ subject: 'Math', exam: 'WA1', date: '2026-02-30', mark: 20 }, 'date'],
    [{ subject: 'Math', exam: 'WA1', date: '2027-03-01', mark: 20 }, 'date-future'],
    [{ subject: 'Math', exam: 'WA1', date: '2010-03-01', mark: 20 }, 'date-old'],
    [{ subject: 'Math', exam: 'WA1', date: '2026-02-27', mark: 41, max: 40 }, 'mark'],
    [{ subject: 'Math', exam: 'WA1', date: '2026-02-27', mark: 20, max: 0 }, 'max'],
    [{ subject: 'Math', exam: 'PSLE', date: '2026-11-19' }, 'mark-or-grade'],
    ['nope', 'result']
  ];
  for (const [result, reason] of cases) {
    const res = await call({ action: 'save', family: 'tanfam', token: TOKEN, studentId: 'k1', result });
    assert.equal(res.statusCode, 400, reason);
    assert.deepEqual(res.body, { ok: false, error: 'invalid-result', problems: [reason] });
  }
  // A PSLE with only the AL is fine.
  const res = await call({ action: 'save', family: 'tanfam', token: TOKEN, studentId: 'k1', result: { subject: 'Science', exam: 'PSLE', date: '2026-11-19', grade: 'AL2' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.mark, null);
  assert.equal(res.body.result.grade, 'AL2');
  assert.equal(db.rows.get('officeSettings/results-tanfam').students.k1.length, 3);
});

test('a child of another family, odd fields and a flood of changes are refused', async () => {
  const { call, db } = seeded();
  let res = await call({ action: 'save', family: 'tanfam', token: TOKEN, studentId: 'someone', result: { subject: 'Math', exam: 'WA1', date: '2026-02-27', mark: 20, max: 40 } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'student-not-found');
  res = await call({ action: 'load', family: 'tanfam', token: TOKEN, extra: 1 });
  assert.equal(res.statusCode, 400);
  res = await call({ action: 'delete-all', family: 'tanfam', token: TOKEN });
  assert.equal(res.statusCode, 400);
  db.rows.get('officeSettings/results-tanfam').parentWrites = { day: '2026-11-20', n: R.PARENT_WRITES_PER_DAY };
  res = await call({ action: 'save', family: 'tanfam', token: TOKEN, studentId: 'k2', result: { subject: 'Math', exam: 'WA1', date: '2026-02-27', mark: 20, max: 40 } });
  assert.equal(res.statusCode, 429);
  // A new day starts a new count.
  const next = harness({ 'officeFamilies/tanfam': FAMILY, 'officeSettings/results-tanfam': Object.assign({}, DOC, { parentWrites: { day: '2026-11-19', n: 999 } }) });
  res = await next.call({ action: 'save', family: 'tanfam', token: TOKEN, studentId: 'k2', result: { subject: 'Math', exam: 'WA1', date: '2026-02-27', mark: 20, max: 40 } });
  assert.equal(res.statusCode, 200);
});

test('a child keeps at most 60 results', async () => {
  const many = Array.from({ length: R.LIMITS.perStudent }, (_, i) => ({ id: 'rmany' + String(i).padStart(3, '0'), subject: 'Math', exam: 'Test', date: '2026-01-' + String(1 + (i % 28)).padStart(2, '0'), mark: 5, max: 10, by: 'parent', at: i }));
  const { call } = harness({ 'officeFamilies/tanfam': FAMILY, 'officeSettings/results-tanfam': Object.assign({}, DOC, { students: { k1: many } }) });
  const res = await call({ action: 'save', family: 'tanfam', token: TOKEN, studentId: 'k1', result: { subject: 'Math', exam: 'WA1', date: '2026-02-27', mark: 20, max: 40 } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'too-many-results');
});

test('only the site may call it, by POST with JSON', async () => {
  const { call } = seeded();
  let res = await call({ action: 'load', family: 'tanfam', token: TOKEN }, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.statusCode, 403);
  res = await call({ action: 'load', family: 'tanfam', token: TOKEN }, { method: 'GET' });
  assert.equal(res.statusCode, 405);
  res = await call(null, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('the server and the office agree on subjects, exams, grades and limits', async () => {
  const core = await import(pathToFileURL(path.join(__dirname, '..', '..', '..', 'office', 'school-results-core.mjs')).href);
  assert.deepEqual(R.SUBJECTS, [...core.SUBJECTS]);
  assert.deepEqual(R.EXAM_KEYS, [...core.EXAM_KEYS]);
  assert.deepEqual(R.GRADES.AL, [...core.GRADES.AL]);
  assert.deepEqual(R.GRADES.SEC, [...core.GRADES.SEC]);
  assert.deepEqual(Object.assign({}, R.LIMITS), Object.assign({}, core.LIMITS));
  assert.equal(R.RESULTS_KIND, core.RESULTS_KIND);
  // A result the server cleaned reads back the same in the office.
  const clean = R.cleanResult({ subject: 'Science', exam: 'SA2', date: '2026-10-25', mark: 71, max: 100, grade: 'AL5' }, '2026-11-20');
  const back = core.normalizeResult(Object.assign({}, clean, { id: 'rabc1234', by: 'parent', at: 5 }));
  assert.equal(back.mark, 71);
  assert.equal(back.grade, 'AL5');
  assert.equal(back.by, 'parent');
});
