'use strict';
// Free diagnostic tests on /diagnostic (diagnostic.js), through the real repository
// against the in-memory Firestore.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttp, hash } = require('../service');
const { createDiagnosticService, validateDiagnostic, checkSession, diagnosticSessions, bookingWindow, fmtDayKey,
  sessionLabel, adminDiagnosticMail, parentDiagnosticMail, diagnosticMailId, publicDiagnostic, buildDiagnostic,
  DIAGNOSTIC_FIRST_DAY, DIAGNOSTIC_LIMITS, NOTIFICATION_EMAILS } = require('../diagnostic');
const { SENDER_EMAIL } = require('../receipt');
const { database, repositoryFor } = require('./fakes');

const NOW = Date.UTC(2026, 10, 5, 3);   // Thursday 5 Nov 2026, 11am in Singapore
const ORIGIN = 'https://polymathlc.com.sg';

// The live timetable's shape: four Master Classes (one closed) among regular classes.
const CONFIG = {
  masterTrialPrice: 100,
  slots: {
    'TUE-1': { level: 'P5', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' },
    'TUE-3': { level: 'P6', subject: 'Math', mode: 'Physical', status: 'open', type: 'master', fee: '400' },
    'WED-3': { level: 'P6', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' },
    'THU-3': { level: 'P5', subject: 'Math', mode: 'Physical', status: 'open', type: 'master', fee: '400' },
    'FRI-2': { level: 'P4', subject: 'Math', mode: 'Physical', status: 'closed', type: 'master' },
    'MON-3': { level: 'P6', subject: 'Science', mode: 'Both', status: 'open', type: 'regular' },
    'SAT-1': { level: 'P6', subject: 'Science', mode: 'Online', status: 'open' }
  }
};
const seed = () => ({ 'schedule_config/main': structuredClone(CONFIG) });
const form = (overrides = {}) => ({
  slot: 'TUE-1', date: '2026-12-08',
  parentName: 'Test Parent', email: 'Parent@Example.test', studentName: 'Ava Tan',
  subject: 'Science', level: 'Primary 5', pageVersion: 'v1.0.0',
  ...overrides
});

function harness(seedRows = seed()) {
  const db = database(seedRows), logs = [];
  let clock = NOW;
  const random = max => Math.floor(Math.random() * max);
  const report = code => logs.push(code);
  const service = createDiagnosticService({ repository: repositoryFor(db), http: createHttp(report), hashIp: hash,
    now: () => clock, random, report });
  async function call(body, overrides = {}) {
    const headers = { origin: ORIGIN, 'content-type': 'application/json', ...overrides.headers };
    const req = { method: 'POST', body, ip: '192.0.2.20', ...overrides, get: name => headers[name.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; },
      send(value) { this.body = value; return this; } };
    await service.bookDiagnostic(req, res);
    return res;
  }
  return { db, logs, call, advance: ms => { clock += ms; } };
}
const bookingRows = db => [...db.rows.entries()].filter(([path]) => path.startsWith('schedule_bookings/'));
const mailRows = db => [...db.rows.entries()].filter(([path]) => path.startsWith('mail/'));

/* ─── Dates and sessions ─── */

test('day keys read as words, in Singapore time', () => {
  assert.equal(fmtDayKey('2026-12-01'), 'Tuesday 1 December 2026');
  assert.equal(fmtDayKey('2027-01-07'), 'Thursday 7 January 2027');
  assert.equal(fmtDayKey('2026-02-30'), '', 'not a day');
  assert.equal(sessionLabel('WED-3', '2026-12-02'), 'Wednesday 2 December 2026, 7:00pm – 8:45pm');
  // 11:30pm on 30 Nov UTC is already 1 Dec in Singapore.
  assert.equal(bookingWindow(Date.UTC(2026, 10, 30, 16, 30)).today, '2026-12-01');
});

test('the booking window opens on 7 December, or two days ahead after that', () => {
  assert.equal(bookingWindow(NOW).first, DIAGNOSTIC_FIRST_DAY);
  assert.equal(bookingWindow(Date.UTC(2026, 11, 10, 3)).first, '2026-12-12');
  assert.equal(bookingWindow(NOW).last, '2027-05-06');
});

test('sessions are the open Master Classes, on their own weekday, skipping holidays', () => {
  const december = diagnosticSessions(CONFIG, '2026-12-01', '2026-12-31');
  assert.deepEqual(december.slice(0, 4).map(s => s.slot + ' ' + s.date),
    ['TUE-1 2026-12-01', 'TUE-3 2026-12-01', 'WED-3 2026-12-02', 'THU-3 2026-12-03']);
  assert.ok(december.every(s => ['TUE-1', 'TUE-3', 'WED-3', 'THU-3'].includes(s.slot)), 'no regular, closed or empty slots');
  assert.equal(december.length, 5 * 2 + 5 + 5, 'five Tuesdays (two classes), five Wednesdays and five Thursdays');
  assert.equal(december[0].label, 'Tuesday 1 December 2026, 3:00pm – 4:45pm');
  assert.equal(december[0].level, 'P5');
  // Christmas 2027 falls on a Saturday, but a Thursday holiday is skipped:
  const october = diagnosticSessions(CONFIG, '2027-10-25', '2027-10-31');
  assert.ok(!october.some(s => s.date === '2027-10-28'), 'Deepavali 2027 (a Thursday) has no session');
  assert.deepEqual(diagnosticSessions({}, '2026-12-01', '2026-12-31'), []);
  assert.deepEqual(diagnosticSessions(CONFIG, '2026-12-31', '2026-12-01'), []);
});

/* ─── Validation ─── */

test('the form is checked field by field', () => {
  const codeOf = body => { try { validateDiagnostic(body); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(codeOf(form()), 'ok');
  assert.equal(validateDiagnostic(form()).email, 'parent@example.test', 'emails are lower-cased');
  assert.equal(validateDiagnostic(form({ studentName: '  Ava   Tan ' })).studentName, 'Ava Tan');
  assert.equal(codeOf(form({ email: 'nope' })), 'invalid-email');
  assert.equal(codeOf(form({ subject: 'English' })), 'invalid-subject');
  assert.equal(codeOf(form({ level: 'Secondary 1' })), 'invalid-level');
  assert.equal(codeOf(form({ slot: 'SUN-1' })), 'unknown-session');
  assert.equal(codeOf(form({ date: '2026-13-01' })), 'unknown-session');
  assert.equal(codeOf(form({ parentName: '' })), 'invalid-booking');
  assert.equal(codeOf(form({ studentName: 'x'.repeat(81) })), 'invalid-booking');
  assert.equal(codeOf(form({ price: 0 })), 'invalid-booking', 'unknown fields are refused');
  assert.equal(codeOf(form({ parentName: 'A\nB' })), 'invalid-booking');
  assert.equal(codeOf(null), 'invalid-booking');
});

test('the session is checked against the timetable as it is now', () => {
  const codeOf = (overrides, config = CONFIG, now = NOW) => {
    try { checkSession(validateDiagnostic(form(overrides)), config, now); return 'ok'; } catch (e) { return e.code; }
  };
  assert.equal(codeOf({}), 'ok');
  assert.equal(codeOf({ date: '2026-11-24' }), 'before-december');
  assert.equal(codeOf({ date: '2026-12-01' }), 'before-december', 'sessions start on 7 December');
  assert.equal(codeOf({ date: '2026-12-07', slot: 'MON-3' }), 'session-unavailable', 'the first day itself is allowed; MON-3 is regular');
  assert.equal(codeOf({ date: '2026-12-09' }), 'session-unavailable', 'a Tuesday class on a Wednesday');
  assert.equal(codeOf({ slot: 'MON-3', date: '2026-12-07' }), 'session-unavailable', 'a regular class');
  assert.equal(codeOf({ slot: 'FRI-2', date: '2026-12-04' }), 'session-unavailable', 'a closed Master Class');
  assert.equal(codeOf({ slot: 'SAT-1', date: '2026-12-05' }), 'session-unavailable');
  assert.equal(codeOf({ date: '2027-06-01' }), 'too-far');
  assert.equal(codeOf({ date: '2026-12-08' }, CONFIG, Date.UTC(2026, 11, 7, 3)), 'too-soon', 'booked on Monday for Tuesday');
  assert.equal(codeOf({ date: '2026-12-08' }, CONFIG, Date.UTC(2026, 11, 6, 3)), 'ok', 'booked on Sunday for Tuesday');
  const thursdayHoliday = { slots: { 'THU-3': CONFIG.slots['THU-3'] } };
  assert.equal(codeOf({ slot: 'THU-3', date: '2027-10-28' }, thursdayHoliday, Date.UTC(2027, 8, 1)), 'public-holiday');
  assert.equal(codeOf({}, {}), 'session-unavailable', 'no timetable at all');
});

/* ─── Booking end to end ─── */

test('a booking is written for the admin, and both emails go out once', async () => {
  const h = harness();
  const res = await h.call(form());
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.already, false);
  const shown = res.body.booking;
  assert.match(shown.code, /^[A-Z2-9]{6}$/);
  assert.equal(shown.sessionLabel, 'Tuesday 8 December 2026, 3:00pm – 4:45pm');
  assert.equal(shown.studentName, 'Ava Tan');
  assert.equal(shown.worth, 100);
  assert.equal(shown.confirmationSent, true);

  const rows = bookingRows(h.db);
  assert.equal(rows.length, 1);
  const [path, booking] = rows[0];
  assert.equal(path, 'schedule_bookings/' + shown.code);
  assert.equal(booking.kind, 'diagnostic');
  assert.equal(booking.status, 'pending');
  assert.equal(booking.payment, 'free');
  assert.equal(booking.price, 0);
  assert.equal(booking.diagnosticDate, '2026-12-08');
  assert.equal(booking.slotLabel, 'Tuesday 3:00pm – 4:45pm');
  assert.equal(booking.classType, 'master');
  assert.equal(booking.classLevel, 'P5');
  assert.equal(booking.classSubject, 'Science');
  assert.equal(booking.subject, 'Science');
  assert.equal(booking.level, 'Primary 5');
  assert.equal(booking.childName, 'Ava Tan');
  assert.equal(booking.parentName, 'Test Parent');
  assert.equal(booking.email, 'parent@example.test');
  assert.equal(booking.paymentRef, 'DIAG ' + shown.code);
  assert.equal(booking.createdAt, NOW);
  assert.equal(booking.confirmationSentTo, 'parent@example.test');

  const mails = mailRows(h.db);
  assert.equal(mails.length, 2);
  const admin = h.db.rows.get('mail/' + diagnosticMailId(shown.code, 'admin'));
  const parent = h.db.rows.get('mail/' + diagnosticMailId(shown.code, 'parent'));
  assert.deepEqual(admin.to, NOTIFICATION_EMAILS.slice());
  assert.equal(admin.replyTo, 'parent@example.test');
  assert.match(admin.message.subject, /^New FREE DIAGNOSTIC: Ava Tan \(Primary 5 Science\)/);
  assert.deepEqual(parent.to, ['parent@example.test']);
  assert.equal(parent.replyTo, SENDER_EMAIL);
  assert.match(parent.message.subject, /^Free diagnostic test booked — Tuesday 8 December 2026/);
  assert.match(parent.message.text, /worth \$100/);
  assert.match(parent.message.text, new RegExp(shown.code));
});

test('the same student booked twice for one session gets the first booking back', async () => {
  const h = harness();
  const first = await h.call(form());
  const again = await h.call(form({ email: 'parent@example.test', studentName: 'ava tan' }));
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.already, true);
  assert.equal(again.body.booking.code, first.body.booking.code);
  assert.equal(bookingRows(h.db).length, 1);
  assert.equal(mailRows(h.db).length, 2, 'no second pair of emails');
  // Another session, or a sibling, is a new booking.
  const other = await h.call(form({ slot: 'TUE-3', subject: 'Math', level: 'Primary 6' }));
  assert.equal(other.statusCode, 201);
  const sibling = await h.call(form({ studentName: 'Ben Tan' }));
  assert.equal(sibling.statusCode, 201);
  assert.equal(bookingRows(h.db).length, 3);
});

test('a first booking the admin deleted no longer blocks booking again', async () => {
  const h = harness();
  const first = await h.call(form());
  h.db.rows.delete('schedule_bookings/' + first.body.booking.code);
  const again = await h.call(form());
  assert.equal(again.statusCode, 201);
  assert.notEqual(again.body.booking.code, first.body.booking.code);
});

test('refusals reach the page as codes, and nothing is written', async () => {
  const h = harness();
  const cases = [
    [form({ date: '2026-11-24' }), 409, 'before-december'],
    [form({ date: '2026-12-01' }), 409, 'before-december'],
    [form({ date: '2026-12-09' }), 409, 'session-unavailable'],
    [form({ email: 'bad' }), 400, 'invalid-email'],
    [form({ level: 'K2' }), 400, 'invalid-level']
  ];
  for (const [body, status, code] of cases) {
    const res = await h.call(body);
    assert.equal(res.statusCode, status, code);
    assert.equal(res.body.error, code);
  }
  assert.equal(bookingRows(h.db).length, 0);
  assert.equal(mailRows(h.db).length, 0);
});

test('only the site may call, by POST with JSON', async () => {
  const h = harness();
  assert.equal((await h.call(form(), { headers: { origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await h.call(form(), { method: 'GET' })).statusCode, 405);
  assert.equal((await h.call(form(), { method: 'OPTIONS' })).statusCode, 204);
  assert.equal((await h.call(form(), { headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  assert.equal(bookingRows(h.db).length, 0);
});

test('one connection is limited per hour', async () => {
  const h = harness();
  for (let i = 0; i < DIAGNOSTIC_LIMITS.perIpHour; i++) {
    const res = await h.call(form({ studentName: 'Child ' + i }));
    assert.equal(res.statusCode, 201);
  }
  const blocked = await h.call(form({ studentName: 'One too many' }));
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error, 'too-many-bookings');
  h.advance(3600000);
  assert.equal((await h.call(form({ studentName: 'Next hour' }))).statusCode, 201);
});

test('a broken database answers "temporarily unavailable" without logging the parent', async () => {
  const h = harness();
  h.db.runTransaction = async () => { throw new Error('boom'); };
  const res = await h.call(form());
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'temporarily-unavailable');
  assert.deepEqual(h.logs, ['diagnostic-booking-failed']);
});

test('the emails escape what the parent typed', () => {
  const booking = buildDiagnostic(validateDiagnostic(form({ parentName: '<b>Mum</b>', studentName: 'A & B' })),
    CONFIG.slots['TUE-1'], 'ABC234', '1.2.3.4', NOW, hash).booking;
  const admin = adminDiagnosticMail(booking), parent = parentDiagnosticMail(booking);
  assert.ok(!admin.message.html.includes('<b>Mum</b>') && admin.message.html.includes('&lt;b&gt;Mum&lt;/b&gt;'));
  assert.ok(parent.message.html.includes('A &amp; B'));
  assert.equal(parentDiagnosticMail(Object.assign({}, booking, { email: 'broken' })), null);
  assert.deepEqual(Object.keys(publicDiagnostic(booking)).sort(),
    ['code', 'confirmationSent', 'date', 'email', 'level', 'parentName', 'sessionLabel', 'slot', 'studentName', 'subject', 'worth']);
});
