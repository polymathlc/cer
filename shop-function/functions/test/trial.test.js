'use strict';
// The /trial page (trial.js + trial-store.js), through the real store against the
// in-memory Firestore: one-time codes, bookings, class links that last a week,
// the live Zoom link and worksheets, the worksheet download, the admin panel and
// the afternoon-before reminder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHttp, hash } = require('../service');
const T = require('../trial');
const { createTrialStore } = require('../trial-store');
const { SENDER_EMAIL } = require('../receipt');
const { database } = require('./fakes');

const NOW = Date.UTC(2026, 10, 15, 3);   // Sunday 15 Nov 2026, 11am in Singapore
const ORIGIN = 'https://polymathlc.com.sg';
const DAY = 86400000;

// The live timetable's shape (schedule_config/main on 15 Nov 2026).
const CONFIG = {
  slots: {
    'MON-1': { level: 'P4', subject: 'Math', mode: 'Both', status: 'closed', type: 'regular' },
    'MON-2': { level: 'P6', subject: 'Math', mode: 'Both', status: 'open' },
    'MON-3': { level: 'P6', subject: 'Science', mode: 'Both', status: 'open', type: 'regular' },
    'TUE-1': { level: 'P5', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' },
    'TUE-2': { level: 'P6', subject: 'Science', mode: 'Both', status: 'open' },
    'WED-2': { level: 'P5', subject: 'Math', mode: 'Both', status: 'open', type: 'regular' },
    'THU-3': { level: 'P5', subject: 'Math', mode: 'Physical', status: 'open', type: 'master' },
    'FRI-1': { level: 'P5', subject: 'Science', mode: 'Both', status: 'open', type: 'regular' },
    'FRI-3': { level: '', subject: '', mode: 'Both', status: 'open', type: 'regular' },
    'SAT-1': { level: 'P6', subject: 'Science', mode: 'Online', status: 'open', type: 'regular' },
    'SAT-3': { level: 'P5', subject: 'Science', mode: 'Online', status: 'open', type: 'regular' },
    'WED-3': { level: 'P6', subject: 'Science', mode: 'Physical', status: 'open', type: 'regular' }
  }
};
const COURSE_P6_SCI_MON = { title: 'P6 Science Monday 7:00pm', level: 'P6', subject: 'science', day: 'Monday', slot: 2,
  worksheetIds: ['ws1', 'ws2', 'ws3'], currentIndex: 1, releasedThrough: 2 };
const COURSE_P5_MATH_WED = { level: 'P5', subject: 'math', day: 'Wednesday', slot: 1, worksheetIds: ['wa', 'wb'], currentIndex: -1, releasedThrough: -1 };
const seed = () => ({
  'schedule_config/main': structuredClone(CONFIG),
  'onlineCourses/c-mon': structuredClone(COURSE_P6_SCI_MON),
  'onlineCourses/c-wed': structuredClone(COURSE_P5_MATH_WED),
  'onlineCourses/c-other': { level: 'P6', subject: 'science', day: 'Tuesday', slot: 1, worksheetIds: ['zz'], currentIndex: 0 },
  'pdfAnnotator/ws1': { name: 'P6 Science WS 1 Cells', storagePath: 'pdf-annotator/ws1.pdf', pageCount: 10, annotations: '[big]' },
  'pdfAnnotator/ws2': { name: 'P6 Science WS 2 Energy', storagePath: 'pdf-annotator/ws2.pdf', pageCount: 12 },
  'pdfAnnotator/ws3': { name: 'P6 Science WS 3 Forces', storagePath: 'pdf-annotator/ws3.pdf', pageCount: 8 },
  'pdfAnnotator/wa': { name: 'P5 Maths WS A Fractions', storagePath: 'pdf-annotator/wa.pdf', pageCount: 6 },
  'pdfAnnotator/wb': { name: 'P5 Maths WS B Ratio', storagePath: '', pageCount: 5 },
  'trialSettings/main': { zoomDefault: 'https://us02web.zoom.us/j/1111111111', zoom: { 'MON-3': 'https://us02web.zoom.us/j/3333333333' },
    zoomNote: { 'MON-3': 'Passcode 2027' } },
  'trialCodes/ABCD2345': { code: 'ABCD2345', label: 'Mrs Tan', createdAtMs: NOW - DAY, createdBy: 'admin@polymathlc.com.sg',
    expiresAtMs: NOW + 59 * DAY, checks: 0, usedAtMs: 0, usedFor: '', revoked: false },
  'trialCodes/WXYZ6789': { code: 'WXYZ6789', label: '', createdAtMs: NOW - DAY, createdBy: 'admin@polymathlc.com.sg',
    expiresAtMs: NOW + 59 * DAY, checks: 0, usedAtMs: 0, usedFor: '', revoked: false },
  'trialCodes/XPRD2345': { code: 'XPRD2345', createdAtMs: NOW - 70 * DAY, expiresAtMs: NOW - 10 * DAY, usedAtMs: 0, revoked: false }
});

// The Storage bucket: every worksheet path holds a tiny PDF.
const fakeBucket = () => ({
  file(path) {
    const body = Buffer.from('%PDF-1.4 ' + path);
    return {
      async exists() { return [path.startsWith('pdf-annotator/')]; },
      async getMetadata() { return [{ size: String(body.length) }]; },
      createReadStream() { return Readable.from([body]); }
    };
  }
});

const ADMIN_TOKEN = 'admin-token-'.padEnd(40, 'x');
const STRANGER_TOKEN = 'stranger-token-'.padEnd(40, 'x');
async function verifyIdToken(token) {
  if (token === ADMIN_TOKEN) return { email: 'Admin@PolymathLC.com.sg', email_verified: true };
  if (token === STRANGER_TOKEN) return { email: 'someone@example.com', email_verified: true };
  throw new Error('bad token');
}

function harness(rows = seed()) {
  const db = database(rows), logs = [];
  let clock = NOW;
  const report = code => logs.push(code);
  const store = createTrialStore(db, { fromMillis: value => value }, { bucket: fakeBucket() });
  const service = T.createTrialService({ store, http: createHttp(report), hashIp: hash, verifyIdToken,
    now: () => clock, random: max => Math.floor(Math.random() * max), report });
  const response = () => ({ headers: {}, statusCode: 200, chunks: [], ended: false, headersSent: false,
    set(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; }, type(t) { this.headers['content-type'] = t; return this; },
    json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; },
    write(chunk) { this.headersSent = true; this.chunks.push(Buffer.from(chunk)); return true; },
    end(chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)); this.ended = true; if (this._done) this._done(); return this; },
    on() { return this; }, once() { return this; }, emit() { return true; }, removeListener() { return this; } });
  async function post(handler, body, { headers = {}, ip = '192.0.2.30' } = {}) {
    const all = { origin: ORIGIN, 'content-type': 'application/json', ...headers };
    const req = { method: 'POST', body, ip, get: name => all[name.toLowerCase()] };
    const res = response();
    await service[handler](req, res);
    return res;
  }
  const call = (body, options) => post('trialBooking', body, options);
  const admin = (body, token = ADMIN_TOKEN) => post('trialAdmin', body, { headers: { authorization: 'Bearer ' + token } });
  async function material(url, ip = '192.0.2.31') {
    const query = Object.fromEntries(new URL(url, 'https://x.test/').searchParams);
    const req = { method: 'GET', query, ip, get: () => undefined };
    const res = response();
    await service.trialMaterial(req, res);
    return res;
  }
  return { db, logs, store, service, call, admin, material, advance: ms => { clock += ms; }, now: () => clock };
}
const rowsUnder = (db, prefix) => [...db.rows.entries()].filter(([path]) => path.startsWith(prefix + '/'));
const book = (overrides = {}) => ({ action: 'book', code: 'abcd-2345', slot: 'MON-3', date: '2026-11-23',
  parentName: 'Mrs Tan', email: 'Parent@Example.test', studentName: 'Ava Tan', whatsapp: '9123 4567', pageVersion: 'v1.0.0', ...overrides });

/* ─── The timetable ─── */

test('only open classes that run online can be booked, never Master Classes, closed or empty slots', () => {
  assert.deepEqual(T.trialSlotIds(CONFIG), ['MON-2', 'MON-3', 'TUE-2', 'WED-2', 'FRI-1', 'SAT-1', 'SAT-3']);
  assert.equal(T.trialSlot(CONFIG, 'TUE-1'), null, 'Master Class');
  assert.equal(T.trialSlot(CONFIG, 'MON-1'), null, 'closed');
  assert.equal(T.trialSlot(CONFIG, 'WED-3'), null, 'centre only');
  assert.equal(T.trialSlot(CONFIG, 'FRI-3'), null, 'no class yet');
  assert.equal(T.trialSlot(CONFIG, 'SUN-1'), null);
});

test('lessons run from tomorrow for eight weeks, on the slot weekday, skipping public holidays', () => {
  const w = T.bookingWindow(NOW);
  assert.deepEqual(w, { today: '2026-11-15', first: '2026-11-16', last: '2027-01-10' });
  const sessions = T.trialSessions(CONFIG, w.first, w.last);
  assert.ok(sessions.length > 40);
  assert.deepEqual(sessions.slice(0, 2).map(s => s.slot + ' ' + s.date), ['MON-2 2026-11-16', 'MON-3 2026-11-16']);
  assert.ok(!sessions.some(s => s.date === '2026-12-25'), 'Christmas is skipped');
  assert.ok(sessions.every(s => ({ MON: 1, TUE: 2, WED: 3, FRI: 5, SAT: 6 })[s.slot.slice(0, 3)] === new Date(s.date + 'T00:00:00Z').getUTCDay()));
  assert.equal(sessions[0].label, 'Monday 16 November 2026, 5:00pm – 6:45pm');
  assert.equal(T.lessonStart('2026-11-16', 'MON-3'), Date.UTC(2026, 10, 16, 11));
  assert.equal(T.lessonStart('2026-11-21', 'SAT-1'), Date.UTC(2026, 10, 21, 1));
});

test('booking checks: tomorrow at the earliest, eight weeks at the latest, right weekday, no holidays', () => {
  const check = (slot, date) => { try { T.checkSession({ slot, date }, CONFIG, NOW); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(check('MON-3', '2026-11-16'), 'ok');
  assert.equal(check('MON-3', '2026-11-09'), 'too-soon');
  assert.equal(check('SAT-1', '2026-11-14'), 'too-soon');
  assert.equal(check('MON-3', '2027-01-18'), 'too-far');
  assert.equal(check('MON-3', '2026-11-17'), 'session-unavailable');
  assert.equal(check('TUE-1', '2026-11-17'), 'session-unavailable');
  assert.equal(check('FRI-1', '2026-12-25'), 'public-holiday');
});

/* ─── Worksheets, as Ans Key shows them ─── */

test('Current and Next follow the class: worksheet 1 before the first lesson, then where the class is', () => {
  assert.deepEqual(T.currentAndNext(COURSE_P6_SCI_MON), { current: 'ws2', next: 'ws3' });
  assert.deepEqual(T.currentAndNext(COURSE_P5_MATH_WED), { current: 'wa', next: 'wb' });
  assert.deepEqual(T.currentAndNext({ worksheetIds: ['a', 'b'], currentIndex: 5 }), { current: 'b', next: '' });
  assert.deepEqual(T.currentAndNext({ worksheetIds: [] }), { current: '', next: '' });
  assert.equal(T.ansKeyAt(null), -1);
});

test('a timetable slot finds its /online class by level, subject, day and session, or the admin choice', () => {
  const courses = [{ id: 'c-mon', ...COURSE_P6_SCI_MON }, { id: 'c-wed', ...COURSE_P5_MATH_WED }, { id: 'c-x', level: 'P6', subject: 'math', day: 'Monday', slot: '1' }];
  assert.equal(T.courseForSlot(courses, 'MON-3', CONFIG.slots['MON-3']).id, 'c-mon');
  assert.equal(T.courseForSlot(courses, 'WED-2', CONFIG.slots['WED-2']).id, 'c-wed');
  assert.equal(T.courseForSlot(courses, 'MON-2', CONFIG.slots['MON-2']).id, 'c-x', 'a slot stored as text still matches');
  assert.equal(T.courseForSlot(courses, 'SAT-1', CONFIG.slots['SAT-1']), null);
  assert.equal(T.courseForSlot(courses, 'SAT-1', CONFIG.slots['SAT-1'], 'c-mon').id, 'c-mon');
  assert.equal(T.courseForSlot(courses, 'MON-3', CONFIG.slots['MON-3'], 'none'), null);
  assert.equal(T.courseTitle({ level: 'P5', subject: 'math', day: 'Wednesday', slot: 1 }), 'Primary 5 Maths Wednesday 5:00pm');
});

/* ─── One-time codes ─── */

test('codes are read loosely (case, spaces and dashes) and made without look-alike characters', () => {
  assert.equal(T.normalAccessCode(' abcd-2345 '), 'ABCD2345');
  assert.equal(T.normalAccessCode('ABCD 2345'), 'ABCD2345');
  assert.equal(T.normalAccessCode('plctrial'), '');
  assert.equal(T.normalAccessCode('ABCD234O'), '', 'O is never in a code');
  for (let i = 0; i < 50; i++) assert.match(T.newAccessCode(), /^[A-HJKMNP-Z2-9]{8}$/);
  assert.equal(T.showAccessCode('ABCD2345'), 'ABCD-2345');
});

test('an unused code opens the page and the admins see it was entered', async () => {
  const h = harness();
  const res = await h.call({ action: 'unlock', code: 'abcd 2345' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, via: 'code' });
  const code = h.db.rows.get('trialCodes/ABCD2345');
  assert.equal(code.checks, 1);
  assert.equal(code.firstCheckedAtMs, NOW);
  assert.equal(code.usedAtMs, 0, 'opening the page does not use the code up');
});

test('a wrong, expired or revoked code is refused, and so is the password while it is off', async () => {
  const h = harness();
  assert.equal((await h.call({ action: 'unlock', code: 'ZZZZ2222' })).body.error, 'wrong-code');
  assert.equal((await h.call({ action: 'unlock', code: 'XPRD2345' })).body.error, 'code-expired');
  assert.equal((await h.call({ action: 'unlock', code: 'plctrial' })).body.error, 'wrong-code');
  assert.equal((await h.call({ action: 'unlock', code: '' })).statusCode, 403);
  await h.admin({ action: 'revokeCode', code: 'WXYZ-6789' });
  assert.equal((await h.call({ action: 'unlock', code: 'WXYZ6789' })).body.error, 'code-revoked');
});

test('the shared password works only once an admin switches it on, and can be changed', async () => {
  const h = harness();
  assert.equal((await h.admin({ action: 'setPassword', enabled: true })).statusCode, 200);
  assert.deepEqual((await h.call({ action: 'unlock', code: ' PLCtrial ' })).body, { ok: true, via: 'password' });
  await h.admin({ action: 'setPassword', password: 'Sunflower7' });
  assert.equal((await h.call({ action: 'unlock', code: 'plctrial' })).body.error, 'wrong-code');
  assert.equal((await h.call({ action: 'unlock', code: 'sunflower7' })).body.via, 'password');
  const settings = h.db.rows.get('trialSettings/main');
  assert.ok(settings.passwordHash && settings.passwordSalt && !JSON.stringify(settings).includes('unflower'), 'only a salted hash is kept');
  assert.equal((await h.admin({ action: 'setPassword', password: 'ab' })).body.error, 'weak-password');
  await h.admin({ action: 'setPassword', enabled: false });
  assert.equal((await h.call({ action: 'unlock', code: 'sunflower7' })).body.error, 'wrong-code');
});

test('wrong guesses are limited per connection', async () => {
  const h = harness();
  for (let i = 0; i < T.LIMITS.wrongPasswordPerIpHour; i++) assert.equal((await h.call({ action: 'unlock', code: 'guess' + i })).statusCode, 403);
  const blocked = await h.call({ action: 'unlock', code: 'another' });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error, 'too-many-attempts');
  assert.equal((await h.call({ action: 'unlock', code: 'another' }, { ip: '198.51.100.9' })).statusCode, 403, 'another connection still tries');
});

/* ─── Booking a date ─── */

test('a booking uses up its code, emails the centre and the parent, and shows the Zoom link and live worksheets', async () => {
  const h = harness();
  const res = await h.call(book());
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const b = res.body.booking;
  assert.equal(b.sessionLabel, 'Monday 23 November 2026, 7:00pm – 8:45pm');
  assert.equal(b.className, 'Primary 6 Science');
  assert.equal(b.zoomUrl, 'https://us02web.zoom.us/j/3333333333');
  assert.equal(b.zoomNote, 'Passcode 2027');
  assert.equal(b.materials.className, 'P6 Science Monday 7:00pm');
  assert.equal(b.materials.current.name, 'P6 Science WS 2 Energy');
  assert.equal(b.materials.next.name, 'P6 Science WS 3 Forces');
  assert.match(b.materials.current.url, /^https:\/\/us-central1-mathgen--app\.cloudfunctions\.net\/trialMaterial\?a=[A-Z2-9]{6}-[A-Za-z2-9]{24}&d=ws2&x=\d+&s=[\w-]{32}$/);
  assert.equal(new URL(b.materials.current.url).searchParams.get('x'), String(NOW + DAY), 'the page links last a day');
  assert.equal(b.pageUrl, 'https://polymathlc.com.sg/trial/#b=' + b.access);
  assert.equal(b.confirmationSent, true);

  const [[, stored]] = rowsUnder(h.db, 'trialBookings');
  assert.equal(stored.accessCode, 'ABCD2345');
  assert.equal(stored.via, 'code');
  assert.equal(stored.email, 'parent@example.test');
  assert.equal(stored.whatsapp, '91234567');
  assert.equal(stored.lessonDate, '2026-11-23');
  assert.equal(stored.status, 'booked');
  const used = h.db.rows.get('trialCodes/ABCD2345');
  assert.equal(used.usedAtMs, NOW);
  assert.equal(used.usedFor, b.code);
  assert.match(used.usedSummary, /Ava Tan · P6 Science · Monday 23 November 2026/);

  const mails = rowsUnder(h.db, 'mail').map(([, m]) => m);
  assert.equal(mails.length, 2);
  for (const m of mails) assert.equal(m.from, 'Polymath Learning Centre <' + SENDER_EMAIL + '>');
  const admin = mails.find(m => m.polymathTrial.kind === 'trial-admin');
  assert.deepEqual(admin.to, ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg']);
  assert.equal(admin.replyTo, 'parent@example.test');
  const parent = mails.find(m => m.polymathTrial.kind === 'trial-parent');
  assert.deepEqual(parent.to, ['parent@example.test']);
  assert.match(parent.message.html, /zoom\.us\/j\/3333333333/);
  // The worksheets themselves are in the email, with links that last one week.
  const emailed = parent.message.text.match(/Current worksheet: P6 Science WS 2 Energy \(12 pages\)\nDownload \(link works until Sun 22 Nov 2026, 11:00am\): (\S+)/);
  assert.ok(emailed, parent.message.text);
  assert.equal(new URL(emailed[1]).searchParams.get('x'), String(NOW + 7 * DAY));
  assert.match(parent.message.text, /Next worksheet: P6 Science WS 3 Forces \(8 pages\)\nDownload/);
  assert.match(parent.message.html, /Download the PDF/);
  assert.equal((await h.material(emailed[1])).statusCode, 200);
  h.advance(7 * DAY);
  const expired = await h.material(emailed[1]);
  assert.equal(expired.statusCode, 410);
  assert.match(expired.body, /work for one week/);
  h.advance(-7 * DAY);
  assert.match(parent.message.text, /trial\/#b=/);
  assert.ok(rowsUnder(h.db, 'mail').every(([path]) => /^mail\/polymath-trial-[A-Z2-9]{6}-(admin|parent)-[0-9a-f]{12}$/.test(path)));
});

test('a used code cannot book again, but the same student booked twice gets the first booking back', async () => {
  const h = harness();
  const first = await h.call(book());
  assert.equal(first.statusCode, 201);
  const again = await h.call(book());
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.already, true);
  assert.equal(again.body.booking.code, first.body.booking.code);
  const other = await h.call(book({ studentName: 'Ben Tan' }));
  assert.equal(other.statusCode, 403);
  assert.equal(other.body.error, 'code-used');
  assert.equal((await h.call({ action: 'unlock', code: 'ABCD2345' })).body.error, 'code-used');
  assert.equal(rowsUnder(h.db, 'trialBookings').length, 1);
  assert.equal(rowsUnder(h.db, 'mail').length, 2);
  const second = await h.call(book({ code: 'WXYZ6789', studentName: 'Ben Tan' }));
  assert.equal(second.statusCode, 201);
});

test('a booking is refused for a lesson that is not on the timetable, or with bad details, and the code survives', async () => {
  const h = harness();
  assert.equal((await h.call(book({ slot: 'TUE-1', date: '2026-11-17' }))).body.error, 'session-unavailable');
  assert.equal((await h.call(book({ date: '2026-11-24' }))).body.error, 'session-unavailable');
  assert.equal((await h.call(book({ email: 'nope' }))).body.error, 'invalid-email');
  assert.equal((await h.call(book({ whatsapp: '12' }))).body.error, 'invalid-whatsapp');
  assert.equal((await h.call(book({ extra: 1 }))).statusCode, 400);
  assert.equal((await h.call(book({ code: 'ZZZZ2222' }))).body.error, 'wrong-code');
  assert.equal(h.db.rows.get('trialCodes/ABCD2345').usedAtMs, 0);
  assert.equal((await h.call(book({ whatsapp: '' }))).statusCode, 201, 'WhatsApp is optional when booking a date');
});

test('WhatsApp numbers: Singapore mobiles with or without +65, or international numbers with their code', () => {
  assert.equal(T.cleanWhatsapp('+65 9123 4567', true), '91234567');
  assert.equal(T.cleanWhatsapp('8123-4567', true), '81234567');
  assert.equal(T.cleanWhatsapp('+60 12-345 6789', true), '+60123456789');
  assert.throws(() => T.cleanWhatsapp('6123 4567', true));
  assert.throws(() => T.cleanWhatsapp('', true));
  assert.equal(T.cleanWhatsapp('', false), '');
});

test('the booking page reopens with its key, live, and refuses a wrong key', async () => {
  const h = harness();
  const { access } = (await h.call(book())).body.booking;
  // The class moves on: the page follows.
  h.db.rows.set('onlineCourses/c-mon', Object.assign({}, h.db.rows.get('onlineCourses/c-mon'), { currentIndex: 2 }));
  const view = await h.call({ action: 'view', access });
  assert.equal(view.statusCode, 200);
  assert.equal(view.body.booking.materials.current.name, 'P6 Science WS 3 Forces');
  assert.equal(view.body.booking.materials.next, null);
  assert.equal((await h.call({ action: 'view', access: access.slice(0, -1) + (access.endsWith('a') ? 'b' : 'a') })).statusCode, 404);
  assert.equal((await h.call({ action: 'view', access: 'nonsense' })).statusCode, 404);
  // A week after the lesson the page closes.
  h.advance(16 * DAY);
  assert.equal((await h.call({ action: 'view', access })).body.error, 'booking-ended');
});

test('the worksheet download streams the PDF only through a signed, unexpired link', async () => {
  const h = harness();
  const b = (await h.call(book())).body.booking;
  const current = await h.material(b.materials.current.url);
  assert.equal(current.statusCode, 200);
  assert.equal(current.headers['content-type'], 'application/pdf');
  assert.match(current.headers['content-disposition'], /inline; filename="P6 Science WS 2 Energy\.pdf"/);
  assert.equal(Buffer.concat(current.chunks).toString(), '%PDF-1.4 pdf-annotator/ws2.pdf');
  const next = await h.material(b.materials.next.url);
  assert.equal(Buffer.concat(next.chunks).toString(), '%PDF-1.4 pdf-annotator/ws3.pdf');
  // Stretching the expiry, or pointing at another worksheet, breaks the signature.
  const stretched = new URL(b.materials.current.url); stretched.searchParams.set('x', String(NOW + 400 * DAY));
  assert.equal((await h.material(stretched.href)).statusCode, 404);
  const other = new URL(b.materials.current.url); other.searchParams.set('d', 'ws1');
  assert.equal((await h.material(other.href)).statusCode, 404);
  const unsigned = new URL(b.materials.current.url); unsigned.searchParams.delete('s');
  assert.match((await h.material(unsigned.href)).body, /not valid/);
  assert.equal((await h.material('https://x.test/?a=nope&d=ws2')).statusCode, 404);
  // The page's own links last a day; reopening the page gives fresh ones.
  h.advance(DAY + 1);
  assert.equal((await h.material(b.materials.current.url)).statusCode, 410);
  const fresh = (await h.call({ action: 'view', access: b.access })).body.booking;
  assert.equal((await h.material(fresh.materials.current.url)).statusCode, 200);
  // A worksheet taken out of the class no longer downloads.
  h.db.rows.set('onlineCourses/c-mon', Object.assign({}, h.db.rows.get('onlineCourses/c-mon'), { worksheetIds: ['ws1', 'ws3'] }));
  assert.equal((await h.material(fresh.materials.current.url)).statusCode, 404);
});

test('a worksheet with no PDF yet is listed but not downloadable', async () => {
  const h = harness();
  const res = await h.call(book({ slot: 'WED-2', date: '2026-11-18' }));
  const m = res.body.booking.materials;
  assert.equal(m.current.name, 'P5 Maths WS A Fractions');
  assert.equal(m.next.available, false);
  assert.equal(m.next.url, '');
  assert.equal(res.body.booking.zoomUrl, 'https://us02web.zoom.us/j/1111111111', 'the default Zoom link');
  assert.equal(m.current.url.includes('&d=wa&'), true);
});

test('a class with no /online class or Zoom link still books, and the centre is told what is missing', async () => {
  const rows = seed();
  delete rows['trialSettings/main'];
  const h = harness(rows);
  const res = await h.call(book({ slot: 'SAT-1', date: '2026-11-21' }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.booking.zoomUrl, '');
  assert.equal(res.body.booking.materials.linked, false);
  const admin = rowsUnder(h.db, 'mail').map(([, m]) => m).find(m => m.polymathTrial.kind === 'trial-admin');
  assert.match(admin.message.text, /No Zoom link is set/);
  assert.match(admin.message.text, /No Polymath Online class is linked/);
});

/* ─── Class links ─── */

test('a class link asks for email and WhatsApp, then opens the class straight away, for one week only', async () => {
  const h = harness();
  const made = await h.admin({ action: 'createLink', slot: 'MON-3', label: 'Facebook group' });
  assert.equal(made.statusCode, 201);
  const link = made.body.link;
  assert.match(link.url, /^https:\/\/polymathlc\.com\.sg\/trial\/#l=[A-Za-z2-9]{24}$/);
  assert.equal(link.expiresAtMs, NOW + 7 * DAY);
  assert.equal(link.state, 'active');

  const info = await h.call({ action: 'linkInfo', link: link.token });
  assert.deepEqual(info.body.link, { slot: 'MON-3', slotLabel: 'Monday 7:00pm – 8:45pm', level: 'P6', subject: 'Science',
    className: 'Primary 6 Science', expiresAtMs: NOW + 7 * DAY });
  assert.equal((await h.call({ action: 'linkOpen', link: link.token, email: 'kid@example.test', whatsapp: '' })).body.error, 'invalid-whatsapp');
  assert.equal((await h.call({ action: 'linkOpen', link: link.token, email: '', whatsapp: '91234567' })).statusCode, 400);

  const open = await h.call({ action: 'linkOpen', link: link.token, email: 'Kid@Example.test', whatsapp: '+65 9123 4567', studentName: 'Cal Lim' });
  assert.equal(open.statusCode, 201);
  assert.equal(open.body.booking.kind, 'link');
  assert.equal(open.body.booking.zoomUrl, 'https://us02web.zoom.us/j/3333333333');
  assert.equal(open.body.booking.materials.current.name, 'P6 Science WS 2 Energy');
  assert.equal(open.body.booking.accessUntil, NOW + 7 * DAY);
  const visits = rowsUnder(h.db, 'trialBookings').map(([, v]) => v);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].whatsapp, '91234567');
  assert.equal(visits[0].linkLabel, 'Facebook group');
  // The Zoom link and the worksheets (one-week links) go to the visitor's email straight away.
  const mails = rowsUnder(h.db, 'mail').map(([, m]) => m);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ['kid@example.test']);
  assert.equal(mails[0].from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.match(mails[0].message.subject, /^Zoom link and worksheets: Polymath Primary 6 Science class$/);
  assert.match(mails[0].message.text, /Join on Zoom: https:\/\/us02web\.zoom\.us\/j\/3333333333 \(Passcode 2027\)/);
  assert.match(mails[0].message.text, /Current worksheet: P6 Science WS 2 Energy \(12 pages\)\nDownload \(link works until/);
  assert.equal(visits[0].materialsSentTo, 'kid@example.test');
  const mailedUrl = mails[0].message.text.match(/Download \(link works until [^)]*\): (\S+)/)[1];
  assert.equal((await h.material(mailedUrl)).statusCode, 200);

  // The same person again is the same visit, counted.
  h.advance(DAY);
  const again = await h.call({ action: 'linkOpen', link: link.token, email: 'kid@example.test', whatsapp: '91234567' });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.booking.code, open.body.booking.code);
  assert.equal(rowsUnder(h.db, 'trialBookings')[0][1].opens, 2);
  assert.equal(rowsUnder(h.db, 'mail').length, 1, 'opening again sends no second email');
  const stored = h.db.rows.get('trialLinks/' + link.token);
  assert.equal(stored.opens, 2);
  assert.equal(stored.people, 1);
  assert.equal((await h.material(again.body.booking.materials.current.url)).statusCode, 200, 'fresh page link');
  assert.equal((await h.material(mailedUrl)).statusCode, 200, 'the emailed link still works');

  // After a week the link, its page and its worksheets stop.
  h.advance(6 * DAY);
  assert.equal((await h.call({ action: 'linkInfo', link: link.token })).body.error, 'link-expired');
  assert.equal((await h.call({ action: 'linkOpen', link: link.token, email: 'new@example.test', whatsapp: '81234567' })).body.error, 'link-expired');
  assert.equal((await h.call({ action: 'view', access: open.body.booking.access })).body.error, 'link-expired');
  assert.equal((await h.material(mailedUrl)).statusCode, 410, 'the emailed link stops with the class link');
});

test('a revoked or unknown link opens nothing', async () => {
  const h = harness();
  const { link } = (await h.admin({ action: 'createLink', slot: 'SAT-3', label: 'Mrs Tan' })).body;
  const open = await h.call({ action: 'linkOpen', link: link.token, email: 'a@example.test', whatsapp: '91234567' });
  assert.equal(open.statusCode, 201);
  await h.admin({ action: 'revokeLink', token: link.token });
  assert.equal((await h.call({ action: 'linkInfo', link: link.token })).body.error, 'link-revoked');
  assert.equal((await h.call({ action: 'view', access: open.body.booking.access })).statusCode, 410);
  assert.equal((await h.call({ action: 'linkInfo', link: 'x'.repeat(24) })).body.error, 'link-unknown');
  assert.equal((await h.admin({ action: 'createLink', slot: 'TUE-1', label: 'Mrs Tan' })).body.error, 'session-unavailable');
  // Who the link is for is required, so staff never have to tell links apart by class alone
  for (const label of ['', ' ', 'A', undefined]) {
    const made = await h.admin(label === undefined ? { action: 'createLink', slot: 'SAT-3' } : { action: 'createLink', slot: 'SAT-3', label });
    assert.equal(made.statusCode, 400, JSON.stringify(label));
    assert.equal(made.body.error, 'link-name-required');
  }
});

/* ─── The admin panel ─── */

test('only the admins, signed in with a verified Google account, reach the admin panel', async () => {
  const h = harness();
  assert.equal((await h.admin({ action: 'load' }, STRANGER_TOKEN)).statusCode, 403);
  assert.equal((await h.admin({ action: 'load' }, 'garbage-token-garbage-token')).statusCode, 401);
  assert.equal((await h.call({ action: 'load' })).statusCode, 400, 'the public endpoint has no admin actions');
  const res = await h.admin({ action: 'load' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.admin, 'admin@polymathlc.com.sg');
  assert.equal(res.body.settings.passwordEnabled, false);
  assert.equal(res.body.settings.passwordIsDefault, true);
  const mon3 = res.body.slots.find(s => s.slot === 'MON-3');
  assert.equal(mon3.courseId, 'c-mon');
  assert.equal(mon3.materials.current.name, 'P6 Science WS 2 Energy');
  assert.equal(mon3.effectiveZoom, 'https://us02web.zoom.us/j/3333333333');
  assert.deepEqual(res.body.codes.map(c => c.display + ' ' + c.state), ['ABCD-2345 active', 'WXYZ-6789 active', 'XPRD-2345 expired']);
  assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
});

test('admins make codes in batches, and see every booking with the code it used', async () => {
  const h = harness();
  const made = await h.admin({ action: 'createCodes', count: 5, label: 'Open house' });
  assert.equal(made.statusCode, 201);
  assert.equal(made.body.codes.length, 5);
  assert.ok(made.body.codes.every(c => c.state === 'active' && c.label === 'Open house' && c.expiresAtMs === NOW + 60 * DAY));
  assert.equal(new Set(made.body.codes.map(c => c.code)).size, 5);
  assert.equal((await h.admin({ action: 'createCodes', count: 0, label: '' })).body.error, 'invalid-count');
  assert.equal((await h.admin({ action: 'createCodes', count: 31, label: '' })).body.error, 'invalid-count');
  const code = made.body.codes[0].display;
  await h.call(book({ code }));
  const load = (await h.admin({ action: 'load' })).body;
  assert.equal(load.bookings.length, 1);
  assert.equal(load.bookings[0].accessCode, code.replace('-', ''));
  assert.equal(load.bookings[0].lessonDate, '2026-11-23');
  assert.equal(load.bookings[0].classLevel, 'P6');
  assert.ok(load.bookings[0].pageUrl.includes('#b='));
  assert.equal(load.codes.find(c => c.display === code).state, 'used');
});

test('admins set Zoom links per class and which /online class a slot follows', async () => {
  const h = harness();
  const saved = await h.admin({ action: 'saveSettings', zoomDefault: '', zoomDefaultNote: '',
    zoom: { 'SAT-1': 'https://zoom.us/j/999', 'MON-3': '' }, zoomNote: { 'SAT-1': 'ID 999' }, courseFor: { 'SAT-1': 'c-mon' } });
  assert.equal(saved.statusCode, 200);
  const settings = h.db.rows.get('trialSettings/main');
  assert.deepEqual(settings.zoom, { 'SAT-1': 'https://zoom.us/j/999' }, 'a cleared link is really removed');
  assert.equal(settings.updatedBy, 'admin@polymathlc.com.sg');
  const slots = (await h.admin({ action: 'load' })).body.slots;
  assert.equal(slots.find(s => s.slot === 'SAT-1').materials.current.name, 'P6 Science WS 2 Energy');
  assert.equal(slots.find(s => s.slot === 'MON-3').effectiveZoom, '');
  assert.equal((await h.admin({ action: 'saveSettings', zoom: { 'SAT-1': 'http://zoom.us/j/1' } })).body.error, 'invalid-zoom-link');
  assert.equal((await h.admin({ action: 'saveSettings', zoom: { 'SUN-9': 'https://zoom.us/j/1' } })).statusCode, 400);
});

test('admins mark, cancel and delete bookings; a cancelled booking no longer opens', async () => {
  const h = harness();
  const b = (await h.call(book())).body.booking;
  assert.equal((await h.admin({ action: 'setStatus', code: b.code, status: 'attended' })).statusCode, 200);
  assert.equal(h.db.rows.get('trialBookings/' + b.code).status, 'attended');
  assert.equal((await h.admin({ action: 'setStatus', code: b.code, status: 'weird' })).statusCode, 400);
  await h.admin({ action: 'setStatus', code: b.code, status: 'cancelled' });
  assert.equal((await h.call({ action: 'view', access: b.access })).body.error, 'booking-cancelled');
  assert.equal((await h.admin({ action: 'deleteBooking', code: b.code })).statusCode, 200);
  assert.equal(rowsUnder(h.db, 'trialBookings').length, 0);
  assert.equal((await h.admin({ action: 'deleteBooking', code: b.code })).statusCode, 404);
});

/* ─── The afternoon-before reminder ─── */

test('reminders go to tomorrow\'s lessons only, once, with the Zoom link and worksheets', async () => {
  const h = harness();
  const b = (await h.call(book())).body.booking;                         // Monday 23 Nov
  await h.call(book({ code: 'WXYZ6789', slot: 'SAT-1', date: '2026-11-21', studentName: 'Dan' }));
  const sunday22 = Date.UTC(2026, 10, 22, 6, 7);                         // Sunday 22 Nov, 2:07pm in Singapore
  const due = T.dueReminders((await h.store.listBookings()), sunday22);
  assert.deepEqual(due.map(x => x.code), [b.code]);
  const extras = await h.service.extrasFor('MON-3');
  const first = await h.store.sendReminder(b.code, x => T.reminderMail(x, extras.zoom, extras.materials), 'polymath-trial-' + b.code + '-reminder-1', sunday22);
  assert.equal(first.sent, true);
  const second = await h.store.sendReminder(b.code, x => T.reminderMail(x, extras.zoom, extras.materials), 'polymath-trial-' + b.code + '-reminder-2', sunday22 + 7200000);
  assert.deepEqual(second, { sent: false, reason: 'already-sent' });
  assert.deepEqual(T.dueReminders(await h.store.listBookings(), sunday22 + 7200000), []);
  const mail = h.db.rows.get('mail/polymath-trial-' + b.code + '-reminder-1');
  assert.equal(mail.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.equal(mail.message.subject, 'Reminder: trial lesson tomorrow at 7:00pm (Monday 23 November 2026)');
  assert.match(mail.message.text, /Join on Zoom a few minutes early: https:\/\/us02web\.zoom\.us\/j\/3333333333 \(Passcode 2027\)/);
  assert.match(mail.message.text, /Current worksheet: P6 Science WS 2 Energy \(12 pages\)/);
  assert.match(mail.message.html, /Open your trial page and worksheets/);
});

test('cancelled bookings and class-link visits get no reminder; an admin can resend one', async () => {
  const h = harness();
  const b = (await h.call(book())).body.booking;
  const sunday22 = Date.UTC(2026, 10, 22, 6, 7);
  await h.admin({ action: 'setStatus', code: b.code, status: 'cancelled' });
  assert.deepEqual(T.dueReminders(await h.store.listBookings(), sunday22), []);
  await h.admin({ action: 'setStatus', code: b.code, status: 'booked' });
  const sent = await h.admin({ action: 'sendReminder', code: b.code });
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.body.to, 'parent@example.test');
  assert.equal((await h.admin({ action: 'sendReminder', code: b.code })).body.error, 'reminder-just-sent');
  assert.deepEqual(T.dueReminders(await h.store.listBookings(), sunday22), [], 'already reminded');
});

test('an admin can email the Zoom link and worksheets again, with fresh one-week links', async () => {
  const h = harness();
  const b = (await h.call(book())).body.booking;
  assert.equal((await h.admin({ action: 'emailMaterials', code: b.code })).body.error, 'materials-just-sent', 'not twice within a minute of the confirmation');
  h.advance(3 * DAY);
  const sent = await h.admin({ action: 'emailMaterials', code: b.code });
  assert.equal(sent.statusCode, 200);
  const mail = rowsUnder(h.db, 'mail').map(([, m]) => m).find(m => m.polymathTrial.kind === 'trial-materials-resend');
  assert.match(mail.message.text, /As requested, here again are the Zoom link and worksheets/);
  const url = mail.message.text.match(/Download \(link works until [^)]*\): (\S+)/)[1];
  assert.equal(new URL(url).searchParams.get('x'), String(NOW + 10 * DAY));
  assert.equal(h.db.rows.get('trialBookings/' + b.code).materialsCount, 1);
  assert.equal((await h.admin({ action: 'emailMaterials', code: 'ZZZZZZ' })).statusCode, 404);
});
