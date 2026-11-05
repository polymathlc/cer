'use strict';

// Free diagnostic tests on polymathlc.com.sg/diagnostic.
//
// A parent books a free diagnostic test (worth $100) for their child at any open
// Master Class session on the /schedule timetable (schedule_config/main, slots of
// type 'master'), on a date from 7 December 2026 onwards. The test is sat at the
// centre during that session.
//
//   bookDiagnostic   the page posts the session (slot id + date), the parent's
//                    name and email, and the student's name, subject and level.
//                    Everything is checked again HERE against the timetable as it
//                    is in Firestore now: the slot must still be an open Master
//                    Class, the date must fall on that slot's weekday, on or after
//                    DIAGNOSTIC_FIRST_DAY, not on a public holiday and not too soon.
//                    The booking is written to schedule_bookings/{code} with
//                    kind:'diagnostic', so it shows in the /schedule admin's
//                    bookings list as well as on /diagnostic/#admin, and the centre
//                    and the parent are emailed in the same transaction.
//
// No payment is involved, so nothing here touches Stripe. The functions use the
// Admin SDK, so no Firestore rule has to change. Like the card checkouts, the
// bookings count against a per-IP hourly limit and a daily limit (kept in
// shop_checkout_limits and swept by the shop's own cleanup), and the same student
// booked twice for the same session is answered with the first booking instead
// of a second one.
const { createHash } = require('node:crypto');
const { ShopError, newOrderCode } = require('./service');
const { slotLabel, readSlot, isMaster } = require('./booking');
const { SENDER_EMAIL, SENDER_NAME, escapeHtml, validEmail } = require('./receipt');

const DIAGNOSTIC_KIND = 'diagnostic';
const DIAGNOSTIC_COLLECTION = 'schedule_bookings';
const DIAGNOSTIC_FIRST_DAY = '2026-12-07';
// What the test would cost; it is free. Shown on the page and in the emails.
const DIAGNOSTIC_WORTH = 100;
// A booking must be made at least this many days before the session (Singapore days),
// so the centre has time to prepare the paper. Booked on the 1st, the earliest is the 3rd.
const DIAGNOSTIC_NOTICE_DAYS = 2;
// How far ahead a session can be booked. The page shows the same window.
const DIAGNOSTIC_HORIZON_DAYS = 182;
const DIAGNOSTIC_LIMITS = Object.freeze({ perIpHour: 10, globalDay: 150 });
const DIAGNOSTIC_SUBJECTS = Object.freeze(['Math', 'Science']);
const DIAGNOSTIC_LEVELS = Object.freeze(['Primary 3', 'Primary 4', 'Primary 5', 'Primary 6']);
const DIAGNOSTIC_MAIL_PREFIX = 'polymath-diagnostic-';
const NOTIFICATION_EMAILS = Object.freeze(['chungzhikai@gmail.com', 'admin@polymathlc.com.sg']);
const WHATSAPP_NUMBER = '6596450588';
const WHATSAPP_DISPLAY = '+65 9645 0588';
const DIAGNOSTIC_URL = 'https://polymathlc.com.sg/diagnostic/';
const LOGO_URL = 'https://dl.dropboxusercontent.com/scl/fi/h40yjlyg8ldefwfaa3dib/polymath-logo-sticker.png?rlkey=o1ra4taqy79gt9t8u096v82zj';
const LIMIT_COLLECTION = 'shop_checkout_limits';
const HOUR = 3600000, DAY = 86400000;
const SG_OFFSET = 8 * HOUR;

// The schedule page's SG_PUBLIC_HOLIDAYS (schedule/index.html). No session is
// offered on these days. A year that is not listed has no holidays skipped.
const SG_PUBLIC_HOLIDAYS = Object.freeze({
  2026: ['2026-01-01', '2026-02-17', '2026-02-18', '2026-03-21', '2026-04-03', '2026-05-01', '2026-05-27',
    '2026-05-31', '2026-06-01', '2026-08-09', '2026-08-10', '2026-11-08', '2026-11-09', '2026-12-25'],
  2027: ['2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-03-10', '2027-03-26', '2027-05-01',
    '2027-05-17', '2027-05-20', '2027-08-09', '2027-10-28', '2027-12-25']
});
const WEEKDAY_OF_CODE = Object.freeze({ SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 });
const SLOT_ID = /^(MON|TUE|WED|THU|FRI|SAT)-([123])$/;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EMAIL_PATTERN = /^[^\s@<>(),;:\\"]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;

// ─── Singapore day keys ('YYYY-MM-DD'), whatever the server's clock zone ───
const sgDayKey = ms => new Date(ms + SG_OFFSET).toISOString().slice(0, 10);
function dayKeyTime(key) {
  const match = DAY_KEY.exec(key || '');
  if (!match) return NaN;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(y, m - 1, d);
  const date = new Date(time);
  // 2026-02-30 is not a day.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return NaN;
  return time;
}
const validDayKey = key => Number.isFinite(dayKeyTime(key));
const addDays = (key, n) => new Date(dayKeyTime(key) + n * DAY).toISOString().slice(0, 10);
const weekdayOfKey = key => new Date(dayKeyTime(key)).getUTCDay();
function isPublicHoliday(key) {
  const list = SG_PUBLIC_HOLIDAYS[String(key).slice(0, 4)];
  return !!list && list.includes(key);
}
// 'Tuesday 1 December 2026'
function fmtDayKey(key) {
  if (!validDayKey(key)) return '';
  const [y, m, d] = key.split('-').map(Number);
  return WD_LONG[weekdayOfKey(key)] + ' ' + d + ' ' + MONTH_LONG[m - 1] + ' ' + y;
}
// The time of day of a slot: 'MON-1' → '3:00pm – 4:45pm'.
function slotTime(id) {
  const label = slotLabel(id);
  return label.slice(label.indexOf(' ') + 1);
}
const sessionLabel = (slot, date) => fmtDayKey(date) + ', ' + slotTime(slot);

// The first and last day a session may be booked for, as seen at `now`.
function bookingWindow(now) {
  const today = sgDayKey(now);
  const soonest = addDays(today, DIAGNOSTIC_NOTICE_DAYS);
  return {
    today,
    first: soonest > DIAGNOSTIC_FIRST_DAY ? soonest : DIAGNOSTIC_FIRST_DAY,
    last: addDays(today, DIAGNOSTIC_HORIZON_DAYS)
  };
}

// A slot a diagnostic can be booked at: an open Master Class with a level and subject.
function diagnosticSlot(config, id) {
  if (!SLOT_ID.test(id)) return null;
  const slot = readSlot(config, id);
  if (!isMaster(slot) || slot.status !== 'open' || !slot.level || !slot.subject) return null;
  return slot;
}

// Every bookable session from `from` to `to` inclusive, in date order then slot
// order. The page has a copy of this (diagnosticSessions), and both are tested.
function diagnosticSessions(config, from, to) {
  const slots = config && config.slots && typeof config.slots === 'object' ? Object.keys(config.slots) : [];
  const ids = slots.filter(id => diagnosticSlot(config, id)).sort((a, b) => {
    const da = WEEKDAY_OF_CODE[a.split('-')[0]], db = WEEKDAY_OF_CODE[b.split('-')[0]];
    return da - db || a.localeCompare(b);
  });
  const sessions = [];
  if (!validDayKey(from) || !validDayKey(to) || from > to) return sessions;
  for (let key = from; key <= to; key = addDays(key, 1)) {
    if (isPublicHoliday(key)) continue;
    const weekday = weekdayOfKey(key);
    for (const id of ids) {
      if (WEEKDAY_OF_CODE[id.split('-')[0]] !== weekday) continue;
      const slot = readSlot(config, id);
      sessions.push({ slot: id, date: key, label: sessionLabel(id, key), level: slot.level, subject: slot.subject });
    }
  }
  return sessions;
}

// ─── Validation ───
function fail(code = 'invalid-booking') { throw new ShopError(400, code); }
function oneLine(value, max, min = 0) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) fail();
  const result = value.trim().replace(/\s+/g, ' ');
  if (result.length < min || result.length > max) fail();
  return result;
}

function validateDiagnostic(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  const keys = new Set(['slot', 'date', 'parentName', 'email', 'studentName', 'subject', 'level', 'pageVersion']);
  if (Object.keys(body).some(key => !keys.has(key))) fail();
  const slot = oneLine(body.slot, 8, 1);
  if (!SLOT_ID.test(slot)) fail('unknown-session');
  const date = oneLine(body.date, 10, 10);
  if (!validDayKey(date)) fail('unknown-session');
  const parentName = oneLine(body.parentName, 80, 1);
  const studentName = oneLine(body.studentName, 80, 1);
  const email = oneLine(body.email, 120, 1).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) fail('invalid-email');
  if (!DIAGNOSTIC_SUBJECTS.includes(body.subject)) fail('invalid-subject');
  if (!DIAGNOSTIC_LEVELS.includes(body.level)) fail('invalid-level');
  return { slot, date, parentName, email, studentName, subject: body.subject, level: body.level,
    pageVersion: oneLine(body.pageVersion, 20) };
}

// Checks the session against the timetable as it is now. A Master Class that has
// closed, filled or stopped being a Master Class since the page loaded, a date
// on the wrong weekday, a holiday, a date before 7 December or too soon, are each
// refused with a code the page turns into words.
function checkSession(request, config, now) {
  const slot = diagnosticSlot(config || {}, request.slot);
  if (!slot) throw new ShopError(409, 'session-unavailable');
  const window = bookingWindow(now);
  if (request.date < DIAGNOSTIC_FIRST_DAY) throw new ShopError(409, 'before-december');
  if (request.date < window.first) throw new ShopError(409, 'too-soon');
  if (request.date > window.last) throw new ShopError(409, 'too-far');
  if (WEEKDAY_OF_CODE[request.slot.split('-')[0]] !== weekdayOfKey(request.date)) throw new ShopError(409, 'session-unavailable');
  if (isPublicHoliday(request.date)) throw new ShopError(409, 'public-holiday');
  return slot;
}

const hashKey = value => createHash('sha256').update(value).digest('hex').slice(0, 32);
// The same student (by name and email) booked for the same session again.
const duplicateKey = request => hashKey([request.email, request.studentName.toLowerCase(), request.slot, request.date].join('|'));
const referenceFor = code => 'DIAG ' + code;
const diagnosticMailId = (code, who) => DIAGNOSTIC_MAIL_PREFIX + code + '-' + who;

// The booking as it is stored in schedule_bookings/{code}. The fields the /schedule
// admin list already reads (slot, slotLabel, classType, mode, parentName,
// childName, childLevel2027, email, price, paymentRef, status) mean what they mean
// there; the rest describe the diagnostic itself.
function diagnosticFields(request, slot, code) {
  return {
    code,
    kind: DIAGNOSTIC_KIND,
    slot: request.slot,
    slotLabel: slotLabel(request.slot),
    diagnosticDate: request.date,
    sessionLabel: sessionLabel(request.slot, request.date),
    classType: 'master',
    classLevel: slot.level,
    classSubject: slot.subject,
    slotMode: 'Physical', mode: 'Physical',
    subject: request.subject,
    level: request.level,
    childLevel2027: request.level,
    parentName: request.parentName,
    childName: request.studentName,
    email: request.email,
    whatsapp: '',
    price: 0, worth: DIAGNOSTIC_WORTH, payment: 'free',
    monthlyFee: null,
    paymentRef: referenceFor(code),
    receiptURL: '', receiptFilename: '',
    status: 'pending',
    pageVersion: request.pageVersion
  };
}

function buildDiagnostic(request, slot, code, ip, now, hashIp) {
  const hour = Math.floor(now / HOUR), day = Math.floor(now / DAY);
  // The duplicate guard lasts until the day after the session, then is swept.
  const sessionDayEnd = dayKeyTime(request.date) - SG_OFFSET + 2 * DAY;
  return {
    code, now,
    duplicate: { id: 'diagnostic-dup-' + duplicateKey(request), expiresAt: sessionDayEnd },
    quotas: [
      { id: 'diagnostic-ip-' + hashIp(ip) + '-' + hour, maximum: DIAGNOSTIC_LIMITS.perIpHour, expiresAt: (hour + 1) * HOUR + DAY },
      { id: 'diagnostic-global-' + day, maximum: DIAGNOSTIC_LIMITS.globalDay, expiresAt: (day + 2) * DAY }
    ],
    booking: diagnosticFields(request, slot, code)
  };
}

// What the page may show the parent about their booking.
function publicDiagnostic(booking) {
  return {
    code: booking.code, slot: booking.slot, date: booking.diagnosticDate, sessionLabel: booking.sessionLabel,
    parentName: booking.parentName, studentName: booking.childName, email: booking.email,
    subject: booking.subject, level: booking.level, worth: booking.worth || DIAGNOSTIC_WORTH,
    confirmationSent: !!booking.confirmationSentTo
  };
}

// ─── Emails, through the `mail` collection (the Trigger Email extension sends them) ───
function diagnosticRows(b) {
  return [
    ['Booking', 'Free diagnostic test (worth $' + (b.worth || DIAGNOSTIC_WORTH) + ')'],
    ['Booking code', b.code],
    ['Session', b.sessionLabel],
    ['Where', 'Polymath Learning Centre, Clementi (during the ' + String(b.classLevel || '').replace('P', 'Primary ') + ' '
      + (b.classSubject || '') + ' Master Class)'],
    ['Student', b.childName],
    ['Subject', b.subject],
    ["Student's level in 2027", b.level],
    ['Parent', b.parentName],
    ['Email', b.email],
    ['Fee', 'Free']
  ];
}
function rowsHtml(rows) {
  return '<table style="border-collapse:collapse;font-size:14px;width:100%;">' + rows.map(([k, v]) =>
    '<tr><td style="padding:8px 12px;border:1px solid #e5e5e5;background:#f5f5f5;font-weight:700;width:38%;">' + escapeHtml(k)
    + '</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">' + escapeHtml(v) + '</td></tr>').join('') + '</table>';
}
const rowsText = rows => rows.map(([k, v]) => k + ': ' + v).join('\n');

function adminDiagnosticMail(b) {
  const rows = diagnosticRows(b);
  return {
    to: NOTIFICATION_EMAILS.slice(),
    from: SENDER_NAME + ' <' + SENDER_EMAIL + '>',
    replyTo: validEmail(b.email) ? b.email : SENDER_EMAIL,
    message: {
      subject: 'New FREE DIAGNOSTIC: ' + b.childName + ' (' + b.level + ' ' + b.subject + ') — ' + b.sessionLabel,
      html: '<div style="font-family:Arial,sans-serif;color:#171717;max-width:640px;">'
        + '<h2>New Free Diagnostic Test Booking</h2>'
        + '<p>Please prepare a ' + escapeHtml(b.level + ' ' + b.subject) + ' diagnostic paper and confirm the session with the parent. '
        + 'Reply to this email to reach the parent directly.</p>'
        + rowsHtml(rows)
        + '<p style="margin-top:16px;"><a href="' + DIAGNOSTIC_URL + '#admin">See all diagnostic bookings</a></p></div>',
      text: 'New free diagnostic test booking.\n\n' + rowsText(rows) + '\n\nAll diagnostic bookings: ' + DIAGNOSTIC_URL + '#admin'
    },
    polymathDiagnostic: { code: b.code, kind: 'diagnostic-admin' }
  };
}

function parentDiagnosticMail(b) {
  if (!validEmail(b.email)) return null;
  const rows = diagnosticRows(b);
  const greeting = 'Dear ' + b.parentName + ',';
  const lead = 'Thank you for booking a free diagnostic test for ' + b.childName + '. We look forward to seeing ' + b.childName
    + ' on ' + b.sessionLabel + ' at our Clementi centre.';
  const what = 'The test is a ' + b.level + ' ' + b.subject + ' paper, sat during the session. It is completely free (worth $'
    + (b.worth || DIAGNOSTIC_WORTH) + '). After the test, we will get in touch to share how ' + b.childName
    + ' did and where to focus next.';
  const change = 'Need a different date? Reply to this email or WhatsApp us at ' + WHATSAPP_DISPLAY + ' with your booking code ' + b.code + '.';
  const html =
    '<div style="font-family:\'Century Gothic\',CenturyGothic,AppleGothic,Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1A1A1A">'
    + '<img src="' + LOGO_URL + '" alt="Polymath Learning Centre" height="56" style="height:56px;margin-bottom:24px">'
    + '<p style="font-size:16px;line-height:1.6;margin:0 0 12px">' + escapeHtml(greeting) + '</p>'
    + '<p style="font-size:16px;line-height:1.6;margin:0 0 16px">' + escapeHtml(lead) + '</p>'
    + '<p style="font-size:15px;line-height:1.6;margin:0 0 20px">' + escapeHtml(what) + '</p>'
    + rowsHtml(rows)
    + '<p style="font-size:14px;line-height:1.6;color:#5C5C5C;margin:24px 0 0">' + escapeHtml(change).replace(WHATSAPP_DISPLAY,
      '<a href="https://wa.me/' + WHATSAPP_NUMBER + '" style="color:#056c76">' + WHATSAPP_DISPLAY + '</a>') + '</p>'
    + '<p style="font-size:15px;line-height:1.6;margin:24px 0 0">Thank you,<br>' + SENDER_NAME + '</p>'
    + '<p style="font-size:12px;line-height:1.6;color:#8A8A8A;margin:28px 0 0">' + SENDER_NAME
    + ' &middot; <a href="' + DIAGNOSTIC_URL + '" style="color:#056c76">polymathlc.com.sg/diagnostic</a></p>'
    + '</div>';
  const text = [greeting, '', lead, '', what, '', rowsText(rows), '', change, '', 'Thank you,', SENDER_NAME].join('\n');
  return {
    to: [b.email.trim()],
    from: SENDER_NAME + ' <' + SENDER_EMAIL + '>',
    replyTo: SENDER_EMAIL,
    message: { subject: 'Free diagnostic test booked — ' + b.sessionLabel, html, text },
    polymathDiagnostic: { code: b.code, kind: 'diagnostic-parent' }
  };
}

// ─── The HTTP handler ───
function createDiagnosticService({ repository, http, hashIp, now = Date.now, random, report = () => {} }) {
  async function bookDiagnostic(req, res) {
    if (!http.cors(req, res)) return;
    try {
      const at = now();
      const request = validateDiagnostic(req.body);
      const { config } = await repository.loadSchedule();
      const slot = checkSession(request, config || {}, at);
      const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
      const result = await repository.reserveDiagnostic(
        code => buildDiagnostic(request, slot, code, ip, at, hashIp),
        () => newOrderCode(random));
      return res.status(result.already ? 200 : 201).json({ ok: true, already: !!result.already, booking: publicDiagnostic(result.booking) });
    } catch (error) {
      return http.answerError(res, error, 'diagnostic-booking-failed');
    }
  }
  return { bookDiagnostic };
}

module.exports = {
  DIAGNOSTIC_KIND, DIAGNOSTIC_COLLECTION, DIAGNOSTIC_FIRST_DAY, DIAGNOSTIC_WORTH, DIAGNOSTIC_NOTICE_DAYS, DIAGNOSTIC_HORIZON_DAYS,
  DIAGNOSTIC_LIMITS, DIAGNOSTIC_SUBJECTS, DIAGNOSTIC_LEVELS, SG_PUBLIC_HOLIDAYS, LIMIT_COLLECTION, NOTIFICATION_EMAILS,
  sgDayKey, validDayKey, addDays, fmtDayKey, sessionLabel, bookingWindow, diagnosticSlot, diagnosticSessions,
  validateDiagnostic, checkSession, duplicateKey, referenceFor, diagnosticMailId, diagnosticFields, buildDiagnostic,
  publicDiagnostic, diagnosticRows, adminDiagnosticMail, parentDiagnosticMail, createDiagnosticService
};
