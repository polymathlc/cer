'use strict';

// Online trial lessons on polymathlc.com.sg/trial (a page that is not linked from
// anywhere on the site and opens only with a password).
//
// Two ways in:
//   1. Book a date. The parent unlocks the page with a ONE-TIME ACCESS CODE that an
//      admin made on /trial/#admin (or, only if the admins switch it on there, the
//      shared trial password, default 'plctrial'), picks a level, then a
//      date and time from the /schedule timetable (schedule_config/main: open
//      classes that run online), and leaves the student's name, their own name,
//      email and (optionally) WhatsApp. The booking is written to
//      trialBookings/{code}; the centre and the parent are emailed in the same
//      transaction. A code is used up by that one booking and never opens the page
//      again. tools/trial-reminders.mjs (a scheduled GitHub Action)
//      emails the parent again the afternoon before the lesson, once.
//   2. A class link. An admin makes a link for one class slot on /trial/#admin.
//      Whoever opens it is asked for an email and WhatsApp number, then sees that
//      class's Zoom link and worksheets straight away, with no password and no
//      date. A link works for LINK_DAYS (one week) and then stops, here on the
//      server. Each use is saved in trialBookings with kind 'link', so the admins
//      see who used it.
//
// What the parent or student then sees, live every time the page asks:
//   - the Zoom link for the class (trialSettings/main: zoom[slot] or zoomDefault)
//   - the class's Current worksheet and Next worksheet, exactly as the Ans Key app
//     and /online show them (onlineCourses/{id}: worksheetIds + currentIndex, the
//     same rule as online/portal-core.js ansKeyAt), so they follow the class's
//     progress. The PDFs are streamed by trialMaterial, only to someone holding a
//     booking's access key (or a link visit's, while the link lasts).
//
// trialSettings, trialBookings and trialLinks are private: only these functions
// (the Admin SDK) read or write them. tools/trial-rules.mjs keeps every browser
// out of them in the shared Firestore rules.
const { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } = require('node:crypto');
const { ShopError, newOrderCode } = require('./service');
const { slotLabel, readSlot, isMaster, slotModes } = require('./booking');
const { SENDER_EMAIL, SENDER_NAME, escapeHtml, validEmail } = require('./receipt');
// ⏰ The lesson clock (a copy of online/lesson-clock.js, kept identical by the
// tests): a class moves one worksheet on at the end of each of its lessons.
const LessonClock = require('./lesson-clock');

const TRIAL_SETTINGS_DOC = Object.freeze(['trialSettings', 'main']);
const TRIAL_BOOKINGS = 'trialBookings';
const TRIAL_LINKS = 'trialLinks';
const TRIAL_CODES = 'trialCodes';
// One-time access codes: 8 characters with no look-alikes, shown as ABCD-EFGH.
const ACCESS_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ACCESS_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
// Unused codes stop working after this many days.
const ACCESS_CODE_DAYS = 60;
const MAX_CODES_AT_ONCE = 30;
const COURSES = 'onlineCourses';
const SHEETS = 'pdfAnnotator';
const LIMIT_COLLECTION = 'shop_checkout_limits';
const DEFAULT_PASSWORD = 'plctrial';
// The accounts that may run /trial/#admin: the same admins as Polymath Office
// and Polymath Online (office/office-core.mjs OFFICE_ADMINS, online/portal.js).
const TRIAL_ADMINS = Object.freeze(['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'elsielcr@gmail.com', 'support@polymathlc.com.sg']);
const NOTIFICATION_EMAILS = Object.freeze(['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg']);
const TRIAL_URL = 'https://polymathlc.com.sg/trial/';
const FUNCTIONS_BASE = 'https://us-central1-mathgen--app.cloudfunctions.net/';
const MATERIAL_ENDPOINT = FUNCTIONS_BASE + 'trialMaterial';
const LOGO_URL = 'https://dl.dropboxusercontent.com/scl/fi/h40yjlyg8ldefwfaa3dib/polymath-logo-sticker.png?rlkey=o1ra4taqy79gt9t8u096v82zj';
const WHATSAPP_NUMBER = '6596450588';
const WHATSAPP_DISPLAY = '+65 9645 0588';
const MAIL_PREFIX = 'polymath-trial-';

const HOUR = 3600000, DAY = 86400000;
const SG_OFFSET = 8 * HOUR;
// A trial can be booked from tomorrow (Singapore) up to this many days ahead.
const TRIAL_HORIZON_DAYS = 56;
// A class link works for one week from when it is made.
const LINK_DAYS = 7;
// Worksheet download links in emails work for one week from when the email is
// written; the page's own links for a day (the page makes fresh ones each visit).
const MAIL_LINK_DAYS = 7;
const PAGE_LINK_MS = DAY;
// A booking's page (and its worksheets) keeps working this long after the lesson.
const BOOKING_ACCESS_DAYS_AFTER = 7;
const LIMITS = Object.freeze({
  bookPerIpHour: 10, bookGlobalDay: 200,
  wrongPasswordPerIpHour: 25,
  // 🔑 Wrong admin passwords: a few per connection an hour, and a cap for everyone a day.
  adminPasswordPerIpHour: 5, adminPasswordGlobalDay: 30,
  linkOpenPerIpHour: 30,
  materialPerIpHour: 120
});
const STATUSES = Object.freeze(['booked', 'attended', 'no-show', 'cancelled']);
const LEVELS = Object.freeze(['P3', 'P4', 'P5', 'P6']);

// The schedule page's SG_PUBLIC_HOLIDAYS (schedule/index.html, also diagnostic.js).
const SG_PUBLIC_HOLIDAYS = Object.freeze({
  2026: ['2026-01-01', '2026-02-17', '2026-02-18', '2026-03-21', '2026-04-03', '2026-05-01', '2026-05-27',
    '2026-05-31', '2026-06-01', '2026-08-09', '2026-08-10', '2026-11-08', '2026-11-09', '2026-12-25'],
  2027: ['2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-03-10', '2027-03-26', '2027-05-01',
    '2027-05-17', '2027-05-20', '2027-08-09', '2027-10-28', '2027-12-25']
});
const WEEKDAY_OF_CODE = Object.freeze({ SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 });
const DAY_NAMES = Object.freeze({ MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' });
// When each session starts, for the reminder email ("tomorrow at 3:00pm").
const WEEKDAY_STARTS = ['3:00pm', '5:00pm', '7:00pm'];
const SATURDAY_STARTS = ['9:00am', '11:00am', '1:00pm'];
const SLOT_ID = /^(MON|TUE|WED|THU|FRI|SAT)-([123])$/;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EMAIL_PATTERN = /^[^\s@<>(),;:\\"]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;
const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const ACCESS_PATTERN = /^([A-Z2-9]{6})-([A-Za-z2-9]{20,40})$/;
const LINK_PATTERN = /^[A-Za-z2-9]{20,40}$/;

// ─── Singapore day keys ('YYYY-MM-DD') ───
const sgDayKey = ms => new Date(ms + SG_OFFSET).toISOString().slice(0, 10);
function dayKeyTime(key) {
  const match = DAY_KEY.exec(key || '');
  if (!match) return NaN;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(y, m - 1, d);
  const date = new Date(time);
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
function fmtDayKey(key) {
  if (!validDayKey(key)) return '';
  const [y, m, d] = key.split('-').map(Number);
  return WD_LONG[weekdayOfKey(key)] + ' ' + d + ' ' + MONTH_LONG[m - 1] + ' ' + y;
}
// 'MON-1' → '3:00pm – 4:45pm'
function slotTime(id) {
  const label = slotLabel(id);
  return label.slice(label.indexOf(' ') + 1);
}
function slotStart(id) {
  const match = SLOT_ID.exec(id || '');
  if (!match) return '';
  return (match[1] === 'SAT' ? SATURDAY_STARTS : WEEKDAY_STARTS)[Number(match[2]) - 1];
}
const sessionLabel = (slot, date) => fmtDayKey(date) + ', ' + slotTime(slot);
const levelName = code => String(code || '').replace(/^P(\d)$/, 'Primary $1');
const subjectName = subject => (subject === 'Math' ? 'Maths' : String(subject || ''));
const className = slot => (levelName(slot.level) + ' ' + subjectName(slot.subject)).trim();
// 1 Dec 2026, 3:00pm in Singapore → milliseconds (UTC).
function fmtMoment(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms + SG_OFFSET);
  const hours = d.getUTCHours(), minutes = d.getUTCMinutes();
  const h12 = hours % 12 || 12;
  return WD_LONG[d.getUTCDay()].slice(0, 3) + ' ' + d.getUTCDate() + ' ' + MONTH_LONG[d.getUTCMonth()].slice(0, 3) + ' '
    + d.getUTCFullYear() + ', ' + h12 + ':' + String(minutes).padStart(2, '0') + (hours < 12 ? 'am' : 'pm');
}

// The first and last day a trial may be booked for, as seen at `now`.
function bookingWindow(now) {
  const today = sgDayKey(now);
  return { today, first: addDays(today, 1), last: addDays(today, TRIAL_HORIZON_DAYS) };
}

// A slot a trial can be booked at: an open regular class with a level and a
// subject that runs online (Online or Both). Master Classes are centre-only.
function trialSlot(config, id) {
  if (!SLOT_ID.test(id || '')) return null;
  const slot = readSlot(config, id);
  if (isMaster(slot) || slot.status !== 'open' || !LEVELS.includes(slot.level) || !slot.subject) return null;
  if (!slotModes(slot).includes('Online')) return null;
  return slot;
}
function trialSlotIds(config) {
  const slots = config && config.slots && typeof config.slots === 'object' ? Object.keys(config.slots) : [];
  return slots.filter(id => trialSlot(config, id)).sort((a, b) => {
    const da = WEEKDAY_OF_CODE[a.split('-')[0]], db = WEEKDAY_OF_CODE[b.split('-')[0]];
    return da - db || a.localeCompare(b);
  });
}

// Every bookable lesson from `from` to `to` inclusive, in date order then slot
// order. The page has a copy of this (trialSessions) and a test compares them.
function trialSessions(config, from, to) {
  const ids = trialSlotIds(config);
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

// The lesson's start, in milliseconds, for a booked date and slot.
function lessonStart(date, slot) {
  const start = slotStart(slot);
  const match = /^(\d{1,2}):(\d{2})(am|pm)$/.exec(start);
  if (!match || !validDayKey(date)) return NaN;
  let hours = Number(match[1]) % 12;
  if (match[3] === 'pm') hours += 12;
  return dayKeyTime(date) - SG_OFFSET + hours * HOUR + Number(match[2]) * 60000;
}

// ─── The class's worksheets, as Ans Key and /online show them ───
function num(value, fallback) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function courseIds(course) { return course && Array.isArray(course.worksheetIds) ? course.worksheetIds.filter(id => typeof id === 'string' && id) : []; }
// online/portal-core.js ansKeyAt: the worksheet the class is on and has yet to
// finish (worksheet 1 before the first lesson), or -1 for an empty class.
// ⏰ Since portal v1.15.0 the class as it stands now: one worksheet on for
// every lesson that is over since its place was written (lesson-clock.js).
function ansKeyAt(course, now) {
  course = course ? LessonClock.courseNow(course, now) : course;
  const ids = courseIds(course);
  if (!ids.length) return -1;
  const cur = num(course && course.currentIndex, -1);
  if (cur < 0) return 0;
  return Math.min(Math.floor(cur), ids.length - 1);
}
function currentAndNext(course, now) {
  const ids = courseIds(course), at = ansKeyAt(course, now);
  return { current: at >= 0 ? ids[at] : '', next: at >= 0 && at + 1 < ids.length ? ids[at + 1] : '' };
}
const courseSlotIndex = course => {
  const value = typeof course.slot === 'string' && course.slot !== '' ? Number(course.slot) : course.slot;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
// The /online class that teaches this timetable slot: the admin's choice on
// /trial/#admin if there is one, otherwise the class with the same level,
// subject, day and session (the one with the most worksheets if several).
function courseForSlot(courses, id, slot, override) {
  const list = Array.isArray(courses) ? courses : [];
  if (override === 'none') return null;
  if (override) {
    const chosen = list.find(course => course.id === override);
    if (chosen) return chosen;
  }
  const match = SLOT_ID.exec(id || '');
  if (!match || !slot) return null;
  const day = DAY_NAMES[match[1]], index = Number(match[2]) - 1;
  const subject = String(slot.subject || '').toLowerCase();
  const found = list.filter(course => course && course.level === slot.level && String(course.subject || '').toLowerCase() === subject
    && course.day === day && courseSlotIndex(course) === index);
  found.sort((a, b) => courseIds(b).length - courseIds(a).length || String(a.id).localeCompare(String(b.id)));
  return found[0] || null;
}
function courseTitle(course) {
  if (!course) return '';
  if (course.title) return String(course.title);
  const index = courseSlotIndex(course);
  const times = course.day === 'Saturday' || course.day === 'Sunday' ? SATURDAY_STARTS : WEEKDAY_STARTS;
  return [levelName(course.level), course.subject === 'math' ? 'Maths' : course.subject === 'science' ? 'Science' : '',
    course.day ? course.day + (index !== null && times[index] ? ' ' + times[index] : '') : ''].filter(Boolean).join(' ');
}
function sheetInfo(id, sheets) {
  const sheet = id && sheets ? sheets[id] : null;
  if (!id || !sheet) return null;
  return { id, name: String(sheet.name || 'Worksheet').slice(0, 160), pages: Number(sheet.pageCount) || 0, available: !!sheet.storagePath };
}
// What the page and the emails say about a slot's materials.
function materialsFor(course, sheets) {
  if (!course) return { linked: false, className: '', current: null, next: null };
  const { current, next } = currentAndNext(course);
  return { linked: true, className: courseTitle(course), current: sheetInfo(current, sheets), next: sheetInfo(next, sheets) };
}

// ─── Settings: the password, the Zoom links and the class each slot follows ───
function readSettings(data) {
  const d = data && typeof data === 'object' ? data : {};
  const map = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  return {
    zoomDefault: typeof d.zoomDefault === 'string' ? d.zoomDefault : '',
    zoomDefaultNote: typeof d.zoomDefaultNote === 'string' ? d.zoomDefaultNote : '',
    zoom: map(d.zoom), zoomNote: map(d.zoomNote), courseFor: map(d.courseFor),
    passwordHash: typeof d.passwordHash === 'string' ? d.passwordHash : '',
    passwordSalt: typeof d.passwordSalt === 'string' ? d.passwordSalt : '',
    passwordSetAt: num(d.passwordSetAt, 0), passwordSetBy: typeof d.passwordSetBy === 'string' ? d.passwordSetBy : '',
    // Off unless an admin turns it on: one-time codes are the way in.
    passwordEnabled: d.passwordEnabled === true
  };
}
function zoomFor(settings, slot) {
  const s = readSettings(settings);
  const own = typeof s.zoom[slot] === 'string' ? s.zoom[slot].trim() : '';
  if (own) return { url: own, note: typeof s.zoomNote[slot] === 'string' ? s.zoomNote[slot] : '' };
  return { url: s.zoomDefault.trim(), note: s.zoomDefault.trim() ? s.zoomDefaultNote : '' };
}

// The password is not case-sensitive and ignores spaces around it, so a phone
// that capitalises the first letter still gets in.
const normalPassword = value => String(value || '').trim().toLowerCase();
function hashPassword(password, salt) {
  return scryptSync(normalPassword(password), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function samePassword(a, b) {
  const x = createHash('sha256').update(String(a)).digest(), y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}
function passwordMatches(settings, password) {
  const s = readSettings(settings);
  if (typeof password !== 'string' || !password.trim() || password.length > 100) return false;
  if (!s.passwordHash || !s.passwordSalt) return samePassword(normalPassword(password), DEFAULT_PASSWORD);
  return samePassword(hashPassword(password, s.passwordSalt), s.passwordHash);
}
function newPasswordFields(password, by, now, random = randomBytes) {
  const clean = normalPassword(password);
  if (clean.length < 4 || clean.length > 64 || /[\u0000-\u001f\u007f]/.test(clean)) throw new ShopError(400, 'weak-password');
  if (clean === DEFAULT_PASSWORD) return { passwordHash: '', passwordSalt: '', passwordSetAt: now, passwordSetBy: by };
  const salt = random(16).toString('hex');
  return { passwordHash: hashPassword(clean, salt), passwordSalt: salt, passwordSetAt: now, passwordSetBy: by };
}

// ─── 🔑 Admin password (Zhi Kai, 20 Nov 2026) ───
// "An admin login at the bottom that logs in with a password if the email is not
// an admin email." Anyone (signed in with any Google account, or not signed in at
// all) can open /trial/#admin with this password. It is checked ONLY here, never
// in the page: the page sends what was typed to trialAdmin { action: 'adminLogin' }
// and gets back a session token that lasts ADMIN_SESSION_HOURS. Every admin call
// after that sends the token instead of a Google ID token, and is checked again
// here against the server's own signing key (trialSettings/main adminSessionKey,
// readable by no browser), so the token cannot be made up or stretched.
//
// This repository is public, so the password itself is NOT in it: only a salted
// scrypt hash of the starting password (the one Zhi Kai chose). A Google admin can
// change it on the Password tab, which stores a new salted hash in
// trialSettings/main and signs every password session out.
//
// Unlike the parents' shared password, this one IS case-sensitive (spaces around
// it are ignored), and wrong guesses are limited per connection and per day for
// everyone (LIMITS.adminPasswordPerIpHour, adminPasswordGlobalDay); once a limit
// is full even the right password waits, so the limit cannot be guessed past.
const ADMIN_PASSWORD_SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const DEFAULT_ADMIN_PASSWORD = Object.freeze({
  salt: '006c19e2cb0bb2ced1b92af6bb181d41',
  hash: '5006275ee0a2af0b3f054c14cb73df172e5689fb319b24dbe49b2f622470434c'
});
const ADMIN_SESSION_HOURS = 12;
const ADMIN_SESSION_PREFIX = 'trialpw.';
const ADMIN_SESSION_PATTERN = /^trialpw\.(\d{13})\.([A-Za-z2-9]{16,40})\.([A-Za-z0-9_-]{43})$/;
// Who did it, in the admin lists (createdBy, statusSetBy, …) for a password session.
const ADMIN_PASSWORD_LABEL = 'Admin password';
const ADMIN_PASSWORD_MIN = 8, ADMIN_PASSWORD_MAX = 64;

const cleanAdminPassword = value => (typeof value === 'string' ? value.trim() : '');
function hashAdminPassword(password, salt) {
  return scryptSync(cleanAdminPassword(password), salt, 32, ADMIN_PASSWORD_SCRYPT).toString('hex');
}
// The hash and salt in use: an admin's own (Password tab) or the starting one.
function adminPasswordRecord(settings) {
  const d = settings && typeof settings === 'object' ? settings : {};
  const own = typeof d.adminPasswordHash === 'string' && /^[0-9a-f]{64}$/.test(d.adminPasswordHash)
    && typeof d.adminPasswordSalt === 'string' && /^[0-9a-f]{32}$/.test(d.adminPasswordSalt);
  return own ? { salt: d.adminPasswordSalt, hash: d.adminPasswordHash, isDefault: false } : { ...DEFAULT_ADMIN_PASSWORD, isDefault: true };
}
function adminPasswordMatches(settings, password) {
  const clean = cleanAdminPassword(password);
  if (!clean || clean.length > 100) return false;
  const record = adminPasswordRecord(settings);
  return samePassword(hashAdminPassword(clean, record.salt), record.hash);
}
function newAdminPasswordFields(password, by, now, random = randomBytes) {
  const clean = cleanAdminPassword(password);
  if (clean.length < ADMIN_PASSWORD_MIN || clean.length > ADMIN_PASSWORD_MAX || /[\u0000-\u001f\u007f]/.test(clean))
    throw new ShopError(400, 'weak-admin-password');
  const salt = random(16).toString('hex');
  return { adminPasswordHash: hashAdminPassword(clean, salt), adminPasswordSalt: salt, adminPasswordSetAt: now, adminPasswordSetBy: by,
    // A new signing key: every password session made with the old password ends now.
    adminSessionKey: random(32).toString('hex') };
}
function adminSessionMac(key, body) { return createHmac('sha256', String(key)).update(body).digest('base64url'); }
function adminSessionToken(key, expiresAtMs, nonce) {
  const body = ADMIN_SESSION_PREFIX + expiresAtMs + '.' + nonce;
  return body + '.' + adminSessionMac(key, body);
}
// Whether a password session token is ours, unaltered and not yet over.
function adminSessionValid(token, key, now) {
  if (typeof key !== 'string' || key.length < 32) return false;
  const match = ADMIN_SESSION_PATTERN.exec(String(token || ''));
  if (!match) return false;
  const expiresAtMs = Number(match[1]);
  if (!(expiresAtMs > now) || expiresAtMs > now + ADMIN_SESSION_HOURS * HOUR + 60000) return false;
  const body = ADMIN_SESSION_PREFIX + match[1] + '.' + match[2];
  return samePassword(adminSessionMac(key, body), match[3]);
}

// ─── One-time access codes ───
// 'abcd-efgh ' → 'ABCDEFGH' (or '' when it cannot be a code).
function normalAccessCode(value) {
  const clean = String(value || '').toUpperCase().replace(/[\s-]+/g, '');
  return ACCESS_CODE_PATTERN.test(clean) ? clean : '';
}
const showAccessCode = code => code.slice(0, 4) + '-' + code.slice(4);
function newAccessCode(random = randomBytes) {
  const bytes = random(32);
  let out = '';
  for (let i = 0; i < bytes.length && out.length < 8; i++)
    if (bytes[i] < 256 - (256 % ACCESS_CODE_CHARS.length)) out += ACCESS_CODE_CHARS[bytes[i] % ACCESS_CODE_CHARS.length];
  return out.length === 8 ? out : newAccessCode(random);
}
function accessCodeState(record, now) {
  if (!record) return 'unknown';
  if (record.revoked) return 'revoked';
  if (record.usedAtMs) return 'used';
  if (!(now < num(record.expiresAtMs, Infinity))) return 'expired';
  return 'active';
}
function publicAccessCode(record, now) {
  return {
    code: record.code, display: showAccessCode(record.code), label: record.label || '', state: accessCodeState(record, now),
    createdAtMs: num(record.createdAtMs, 0), createdBy: record.createdBy || '', expiresAtMs: num(record.expiresAtMs, 0),
    checks: num(record.checks, 0), firstCheckedAtMs: num(record.firstCheckedAtMs, 0), lastCheckedAtMs: num(record.lastCheckedAtMs, 0),
    usedAtMs: num(record.usedAtMs, 0), usedFor: record.usedFor || '', usedSummary: record.usedSummary || ''
  };
}

// Random keys for booking pages and class links.
function randomToken(length = 24, random = randomBytes) {
  const bytes = random(length * 2);
  let out = '';
  for (let i = 0; i < bytes.length && out.length < length; i++) {
    // Rejection sampling keeps every character equally likely.
    if (bytes[i] < 256 - (256 % TOKEN_CHARS.length)) out += TOKEN_CHARS[bytes[i] % TOKEN_CHARS.length];
  }
  return out.length === length ? out : randomToken(length, random);
}
const hashKey = value => createHash('sha256').update(value).digest('hex').slice(0, 32);
const accessFor = booking => booking.code + '-' + booking.viewToken;
function parseAccess(value) {
  const match = ACCESS_PATTERN.exec(typeof value === 'string' ? value.trim() : '');
  return match ? { code: match[1], token: match[2] } : null;
}
// A worksheet download link names the booking, the worksheet and when the link
// stops working, signed with the booking's own secret linkKey (never sent to
// anyone), so a link's expiry cannot be stretched by editing it.
function materialSignature(booking, id, expiresAtMs) {
  const key = booking.linkKey || ('legacy:' + booking.viewToken);
  return createHmac('sha256', key).update([booking.code, id, expiresAtMs].join('|')).digest('base64url').slice(0, 32);
}
function materialUrl(booking, id, expiresAtMs) {
  return MATERIAL_ENDPOINT + '?a=' + encodeURIComponent(accessFor(booking)) + '&d=' + encodeURIComponent(id)
    + '&x=' + expiresAtMs + '&s=' + materialSignature(booking, id, expiresAtMs);
}
// The download links an email carries: one week from `now`.
function emailSheetLinks(booking, materials, now) {
  const until = now + MAIL_LINK_DAYS * DAY;
  const link = info => info && info.available ? materialUrl(booking, info.id, until) : '';
  return { until, current: link(materials && materials.current), next: link(materials && materials.next) };
}
const bookingPageUrl = access => TRIAL_URL + '#b=' + access;

// ─── 🎟 The trial's own live-lesson link (trial page v1.5.0, 20 Nov 2026, Zhi Kai) ───
// Every booking (and every class-link visit) has ONE link into the live lesson
// in Ans Key, for its own lesson:  polymathlc.com.sg/live/?trial=<CODE>.<mac>.
// The page there waits for the lesson and then opens
// polymathlc.github.io/anskey/?live&trial=<CODE>.<mac>, where the live class
// server (polymathlc/anskey functions/live-class.js) checks the same mac,
// the lesson day and that the class on now is this booking's class, and lets
// the child in as a Trial student named from the booking. The parent is told
// to use it first; the Zoom link stays as the backup.
// The mac is an HMAC of the booking code keyed with the booking's own secret
// (linkKey; 'legacy:' + viewToken for the oldest bookings), so the link opens
// the lesson and nothing else: not the trial page and not the worksheets.
// anskey's trialLiveMac must give the same answer (both test one fixed example).
// "One use" is one LESSON: a refresh or another device still works during it.
const LIVE_PAGE_URL = 'https://polymathlc.com.sg/live/';
const ANSKEY_LIVE_URL = 'https://polymathlc.github.io/anskey/?live';
const TRIAL_LIVE_INFO = 'live-lesson-v1|';
const LIVE_PATTERN = /^([A-Z2-9]{6})\.([A-Za-z0-9_-]{16})$/;
// The /live page forwards to the lesson this early, and calls a lesson over
// this long after it starts (lessons are 1h45; a lesson may run over).
const LIVE_EARLY_MS = 15 * 60000;
const LIVE_LATE_MS = 3 * HOUR;
function trialLiveMac(booking, code) {
  const b = booking && typeof booking === 'object' ? booking : {};
  const key = typeof b.linkKey === 'string' && b.linkKey ? b.linkKey : 'legacy:' + String(b.viewToken || '');
  return createHmac('sha256', key).update(TRIAL_LIVE_INFO + String(code || '')).digest('base64url').slice(0, 16);
}
function trialLiveCode(booking) {
  const code = String(booking && booking.code || '');
  return /^[A-Z2-9]{6}$/.test(code) && (booking.linkKey || booking.viewToken) ? code + '.' + trialLiveMac(booking, code) : '';
}
function parseLive(value) {
  const match = LIVE_PATTERN.exec(typeof value === 'string' ? value.trim() : '');
  return match ? { code: match[1], mac: match[2] } : null;
}
const liveLessonUrl = booking => { const c = trialLiveCode(booking); return c ? LIVE_PAGE_URL + '?trial=' + c : ''; };
const anskeyTrialUrl = live => ANSKEY_LIVE_URL + '&trial=' + live;
// The lesson a live link is for, as seen at `now`: when it starts, when the
// /live page forwards to it, when it is over, and which of those it is.
// A booking has its one date; a class-link visit has the next lesson of its
// class (today's while it lasts) before the class link ends.
function liveWindow(booking, link, now) {
  const b = booking || {};
  const out = { state: 'ended', startsAtMs: 0, opensAtMs: 0, closesAtMs: 0, sessionLabel: b.sessionLabel || slotLabel(b.slot) };
  if (b.status === 'cancelled') return Object.assign(out, { state: 'cancelled' });
  const at = start => Object.assign(out, { startsAtMs: start, opensAtMs: start - LIVE_EARLY_MS, closesAtMs: start + LIVE_LATE_MS,
    state: now < start - LIVE_EARLY_MS ? 'early' : now <= start + LIVE_LATE_MS ? 'open' : 'ended' });
  if (b.kind === 'link') {
    if (!link || link.revoked) return out;
    const until = Math.min(num(link.expiresAtMs, 0), num(b.accessUntilMs, Infinity));
    if (!(now < until) || !SLOT_ID.test(b.slot || '')) return out;
    const today = sgDayKey(now);
    for (let i = 0; i <= LINK_DAYS + 1; i++) {
      const day = addDays(today, i);
      if (weekdayOfKey(day) !== WEEKDAY_OF_CODE[b.slot.split('-')[0]] || isPublicHoliday(day)) continue;
      const start = lessonStart(day, b.slot);
      if (!Number.isFinite(start) || now > start + LIVE_LATE_MS) continue;
      if (start - LIVE_EARLY_MS >= until) break;
      at(start);
      out.sessionLabel = sessionLabel(b.slot, day);
      return out;
    }
    return out;
  }
  const start = num(b.lessonStartMs, lessonStart(b.lessonDate, b.slot));
  return Number.isFinite(start) ? at(start) : out;
}
const linkPageUrl = token => TRIAL_URL + '#l=' + token;

// ─── Validation ───
function fail(code = 'invalid-request') { throw new ShopError(400, code); }
function oneLine(value, max, min = 0) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) fail();
  const result = value.trim().replace(/\s+/g, ' ');
  if (result.length < min || result.length > max) fail();
  return result;
}
function cleanEmail(value) {
  const email = oneLine(value, 120, 1).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) fail('invalid-email');
  return email;
}
// A Singapore mobile (8 digits from 8 or 9, +65 allowed) or an international
// number with its country code. Stored as digits; Singapore ones without 65.
function cleanWhatsapp(value, required) {
  const raw = oneLine(value, 24);
  if (!raw) { if (required) fail('invalid-whatsapp'); return ''; }
  if (!/^[+\d\s()-]+$/.test(raw)) fail('invalid-whatsapp');
  const digits = raw.replace(/\D/g, '');
  const local = digits.length === 10 && digits.startsWith('65') ? digits.slice(2) : digits;
  if (/^[89]\d{7}$/.test(local)) return local;
  if (raw.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return '+' + digits;
  fail('invalid-whatsapp');
}
function checkKeys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  const keys = new Set(allowed);
  if (Object.keys(body).some(key => !keys.has(key))) fail();
}
function validateBook(body) {
  checkKeys(body, ['action', 'code', 'slot', 'date', 'parentName', 'email', 'studentName', 'whatsapp', 'pageVersion']);
  const slot = oneLine(body.slot, 8, 1);
  if (!SLOT_ID.test(slot)) fail('unknown-session');
  const date = oneLine(body.date, 10, 10);
  if (!validDayKey(date)) fail('unknown-session');
  return {
    slot, date,
    parentName: oneLine(body.parentName, 80, 1),
    studentName: oneLine(body.studentName, 80, 1),
    email: cleanEmail(body.email),
    whatsapp: cleanWhatsapp(body.whatsapp, false),
    pageVersion: oneLine(body.pageVersion, 20)
  };
}
function validateLinkOpen(body) {
  checkKeys(body, ['action', 'link', 'email', 'whatsapp', 'studentName', 'pageVersion']);
  return {
    link: oneLine(body.link, 40, 20),
    email: cleanEmail(body.email),
    whatsapp: cleanWhatsapp(body.whatsapp, true),
    studentName: oneLine(body.studentName, 80),
    pageVersion: oneLine(body.pageVersion, 20)
  };
}
// Checks the lesson against the timetable as it is now.
function checkSession(request, config, now) {
  const slot = trialSlot(config || {}, request.slot);
  if (!slot) throw new ShopError(409, 'session-unavailable');
  const window = bookingWindow(now);
  if (request.date < window.first) throw new ShopError(409, 'too-soon');
  if (request.date > window.last) throw new ShopError(409, 'too-far');
  if (WEEKDAY_OF_CODE[request.slot.split('-')[0]] !== weekdayOfKey(request.date)) throw new ShopError(409, 'session-unavailable');
  if (isPublicHoliday(request.date)) throw new ShopError(409, 'public-holiday');
  return slot;
}

// ─── Records ───
function bookingRecord(request, slot, code, viewToken, now, gate) {
  return {
    code, kind: 'booking', viewToken,
    // How the page was opened: the one-time code used (and so used up), or the shared password.
    accessCode: gate && gate.accessCode ? gate.accessCode : '', via: gate && gate.via ? gate.via : '',
    slot: request.slot, slotLabel: slotLabel(request.slot),
    lessonDate: request.date, sessionLabel: sessionLabel(request.slot, request.date),
    lessonStartMs: lessonStart(request.date, request.slot),
    classLevel: slot.level, classSubject: slot.subject, mode: 'Online',
    parentName: request.parentName, studentName: request.studentName,
    email: request.email, whatsapp: request.whatsapp,
    status: 'booked',
    accessUntilMs: dayKeyTime(request.date) - SG_OFFSET + (BOOKING_ACCESS_DAYS_AFTER + 1) * DAY,
    createdAtMs: now,
    pageVersion: request.pageVersion
  };
}
function linkVisitRecord(request, link, slot, code, viewToken, now) {
  return {
    code, kind: 'link', viewToken,
    linkToken: link.token, linkLabel: link.label || '',
    slot: link.slot, slotLabel: slotLabel(link.slot),
    lessonDate: '', sessionLabel: slotLabel(link.slot),
    classLevel: slot ? slot.level : (link.level || ''), classSubject: slot ? slot.subject : (link.subject || ''), mode: 'Online',
    parentName: '', studentName: request.studentName,
    email: request.email, whatsapp: request.whatsapp,
    status: 'booked',
    accessUntilMs: link.expiresAtMs,
    createdAtMs: now, lastOpenedAtMs: now, opens: 1,
    pageVersion: request.pageVersion
  };
}
// Whether a booking's page and worksheets still open.
function accessOpen(booking, link, now) {
  if (!booking || booking.status === 'cancelled') return false;
  if (booking.kind === 'link') {
    if (!link || link.revoked) return false;
    return now < Math.min(num(link.expiresAtMs, 0), num(booking.accessUntilMs, Infinity));
  }
  return now < num(booking.accessUntilMs, Infinity);
}
function linkState(link, now) {
  if (!link) return 'unknown';
  if (link.revoked) return 'revoked';
  if (!(now < num(link.expiresAtMs, 0))) return 'expired';
  return 'active';
}

// What the page may show about a booking, with its live Zoom link and worksheets.
function publicBooking(booking, extras) {
  const access = accessFor(booking);
  const zoom = extras.zoom || { url: '', note: '' };
  const materials = extras.materials || { linked: false, className: '', current: null, next: null };
  const accessUntil = num(extras.accessUntilMs, num(booking.accessUntilMs, Infinity));
  const linkUntil = Math.min(num(extras.now, Date.now()) + PAGE_LINK_MS, accessUntil);
  const sheet = info => info ? Object.assign({}, info, { url: info.available ? materialUrl(booking, info.id, linkUntil) : '' }) : null;
  return {
    code: booking.code, kind: booking.kind, access, pageUrl: bookingPageUrl(access), liveUrl: liveLessonUrl(booking),
    slot: booking.slot, date: booking.lessonDate || '', sessionLabel: booking.sessionLabel || slotLabel(booking.slot),
    time: slotTime(booking.slot), level: booking.classLevel, subject: booking.classSubject,
    className: (levelName(booking.classLevel) + ' ' + subjectName(booking.classSubject)).trim(),
    parentName: booking.parentName || '', studentName: booking.studentName || '', email: booking.email,
    status: booking.status || 'booked',
    zoomUrl: zoom.url || '', zoomNote: zoom.note || '',
    materials: { linked: materials.linked, className: materials.className,
      current: sheet(materials.current), next: sheet(materials.next) },
    accessUntil: num(extras.accessUntilMs, num(booking.accessUntilMs, 0)),
    confirmationSent: !!booking.confirmationSentTo,
    materialsSent: !!(booking.confirmationSentTo || booking.materialsSentTo)
  };
}

// ─── Emails, through the `mail` collection (the Trigger Email extension sends them) ───
const FROM = SENDER_NAME + ' <' + SENDER_EMAIL + '>';
function rowsHtml(rows) {
  return '<table style="border-collapse:collapse;font-size:14px;width:100%;">' + rows.map(([k, v, html]) =>
    '<tr><td style="padding:8px 12px;border:1px solid #e5e5e5;background:#f5f5f5;font-weight:700;width:38%;vertical-align:top;">' + escapeHtml(k)
    + '</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">' + (html || escapeHtml(v)) + '</td></tr>').join('') + '</table>';
}
const rowsText = rows => rows.map(([k, v]) => k + ': ' + v).join('\n');
const linkHtml = (url, label) => '<a href="' + escapeHtml(url) + '" style="color:#056c76;font-weight:700">' + escapeHtml(label || url) + '</a>';
function sheetLine(info) { return info ? info.name + (info.pages ? ' (' + info.pages + ' pages)' : '') : ''; }

const LIVE_ROW_NOTE = 'Opens the lesson in the browser at the lesson time. Use Zoom only if it does not work.';
// The words that tell the parent which link to use (the live link first, Zoom as the backup).
function liveFirstLine(booking, zoom) {
  const live = liveLessonUrl(booking);
  if (!live) return null;
  const zoomWords = zoom && zoom.url ? ' If it does not work, join on Zoom instead (the backup): ' : ' If it does not work, use the Zoom link (the backup).';
  return {
    text: 'Please join with the live lesson link first, a few minutes early: ' + live + ' It opens the lesson in the browser (phone, tablet or computer) '
      + 'with the worksheet and questions on screen, and lets ' + (booking.studentName || 'your child') + ' in when the lesson starts.'
      + zoomWords + (zoom && zoom.url ? zoom.url + (zoom.note ? ' (' + zoom.note + ')' : '') : ''),
    html: '<b>Please join with the live lesson link first</b>, a few minutes early: ' + linkHtml(live, 'Join the live lesson')
      + '. It opens the lesson in the browser (phone, tablet or computer) with the worksheet and questions on screen, and lets '
      + escapeHtml(booking.studentName || 'your child') + ' in when the lesson starts.' + escapeHtml(zoomWords)
      + (zoom && zoom.url ? linkHtml(zoom.url) + (zoom.note ? ' (' + escapeHtml(zoom.note) + ')' : '') : '')
  };
}

function lessonRows(booking, zoom, materials, links) {
  const rows = [
    ['Booking code', booking.code],
    booking.lessonDate ? ['Lesson', booking.sessionLabel] : ['Class time', slotLabel(booking.slot) + ' (every week)'],
    ['Class', (levelName(booking.classLevel) + ' ' + subjectName(booking.classSubject)).trim() + ' (online, on Zoom)'],
  ];
  if (booking.studentName) rows.push(['Student', booking.studentName]);
  if (booking.parentName) rows.push(['Parent', booking.parentName]);
  rows.push(['Email', booking.email]);
  if (booking.whatsapp) rows.push(['WhatsApp', booking.whatsapp]);
  const live = liveLessonUrl(booking);
  if (live) rows.push(['Live lesson link (use this first)', live + '\n' + LIVE_ROW_NOTE,
    linkHtml(live, 'Join the live lesson') + '<br><span style="color:#5C5C5C;font-size:13px">' + escapeHtml(LIVE_ROW_NOTE) + '</span>']);
  const zoomLabel = live ? 'Zoom link (backup)' : 'Zoom link';
  rows.push(zoom && zoom.url ? [zoomLabel, zoom.url, linkHtml(zoom.url) + (zoom.note ? '<br>' + escapeHtml(zoom.note) : '')]
    : [zoomLabel, 'We will send it before the lesson']);
  const sheetRow = (label, info, url) => {
    if (!info) return;
    if (!url) return rows.push([label, sheetLine(info)]);
    rows.push([label, sheetLine(info) + '\nDownload (link works until ' + fmtMoment(links.until) + '): ' + url,
      escapeHtml(sheetLine(info)) + '<br>' + linkHtml(url, 'Download the PDF') + ' <span style="color:#8A8A8A;font-size:12px">(link works until '
      + escapeHtml(fmtMoment(links.until)) + ')</span>']);
  };
  sheetRow('Current worksheet', materials && materials.current, links && links.current);
  sheetRow('Next worksheet', materials && materials.next, links && links.next);
  return rows;
}
function parentShell(paragraphs, rows, button) {
  return '<div style="font-family:\'Century Gothic\',CenturyGothic,AppleGothic,Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1A1A1A">'
    + '<img src="' + LOGO_URL + '" alt="Polymath Learning Centre" height="56" style="height:56px;margin-bottom:24px">'
    + paragraphs.map(p => '<p style="font-size:16px;line-height:1.6;margin:0 0 14px">' + p + '</p>').join('')
    + (button ? '<p style="margin:18px 0 22px"><a href="' + escapeHtml(button.url) + '" style="display:inline-block;background:#ec008c;color:#fff;'
      + 'text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">' + escapeHtml(button.label) + '</a></p>' : '')
    + rowsHtml(rows)
    + '<p style="font-size:14px;line-height:1.6;color:#5C5C5C;margin:24px 0 0">Need a different time? Reply to this email or WhatsApp us at '
    + '<a href="https://wa.me/' + WHATSAPP_NUMBER + '" style="color:#056c76">' + WHATSAPP_DISPLAY + '</a>.</p>'
    + '<p style="font-size:15px;line-height:1.6;margin:24px 0 0">Thank you,<br>' + SENDER_NAME + '</p>'
    + '</div>';
}

function parentConfirmationMail(booking, zoom, materials, now) {
  if (!validEmail(booking.email)) return null;
  const access = accessFor(booking);
  const links = emailSheetLinks(booking, materials, now);
  const rows = lessonRows(booking, zoom, materials, links);
  const greeting = 'Dear ' + (booking.parentName || 'Parent') + ',';
  const lead = 'Thank you for booking an online trial lesson for ' + booking.studentName + ' on ' + booking.sessionLabel + '.';
  const what = 'The Zoom link and the worksheets ' + booking.studentName + ' will use are below, so please keep this email. '
    + 'The worksheet download links work for one week. The worksheets follow the class, so the reminder we email the afternoon before the lesson '
    + 'brings the latest worksheets with fresh links, and your trial page always has them too.';
  const page = bookingPageUrl(access);
  const first = liveFirstLine(booking, zoom);
  return {
    to: [booking.email],
    from: FROM, replyTo: SENDER_EMAIL,
    message: {
      subject: 'Trial lesson booked: ' + booking.sessionLabel,
      html: parentShell([escapeHtml(greeting), escapeHtml(lead)].concat(first ? [first.html] : [], [escapeHtml(what)]), rows, { url: page, label: 'Open your trial page' }),
      text: [greeting, '', lead, ''].concat(first ? [first.text, ''] : [], [what, '', 'Your trial page: ' + page, '', rowsText(rows), '',
        'Need a different time? Reply to this email or WhatsApp us at ' + WHATSAPP_DISPLAY + '.', '', 'Thank you,', SENDER_NAME]).join('\n')
    },
    polymathTrial: { code: booking.code, kind: 'trial-parent' }
  };
}

function reminderMail(booking, zoom, materials, now) {
  if (!validEmail(booking.email)) return null;
  const access = accessFor(booking);
  const links = emailSheetLinks(booking, materials, now);
  const rows = lessonRows(booking, zoom, materials, links);
  const greeting = 'Dear ' + (booking.parentName || 'Parent') + ',';
  const lead = 'A reminder that ' + booking.studentName + "'s online trial lesson is tomorrow, " + booking.sessionLabel + '.';
  const join = zoom && zoom.url ? 'Join on Zoom a few minutes early: ' + zoom.url : 'We will send the Zoom link before the lesson.';
  const prepare = materials && (materials.current || materials.next)
    ? 'Please have the worksheets ready (printed, or open on a tablet). Their download links are below and work for one week.'
    : 'Your trial page has everything for the lesson.';
  const page = bookingPageUrl(access);
  const first = liveFirstLine(booking, zoom);
  return {
    to: [booking.email],
    from: FROM, replyTo: SENDER_EMAIL,
    message: {
      subject: 'Reminder: trial lesson tomorrow at ' + slotStart(booking.slot) + ' (' + fmtDayKey(booking.lessonDate) + ')',
      html: parentShell([escapeHtml(greeting), escapeHtml(lead),
        first ? first.html : zoom && zoom.url ? 'Join on Zoom a few minutes early: ' + linkHtml(zoom.url) + (zoom.note ? ' (' + escapeHtml(zoom.note) + ')' : '') : escapeHtml(join),
        escapeHtml(prepare)], rows, { url: page, label: 'Open your trial page and worksheets' }),
      text: [greeting, '', lead, '', first ? first.text : join + (zoom && zoom.note ? ' (' + zoom.note + ')' : ''), '', prepare, 'Your trial page: ' + page, '',
        rowsText(rows), '', 'Need a different time? Reply to this email or WhatsApp us at ' + WHATSAPP_DISPLAY + '.', '', 'Thank you,', SENDER_NAME].join('\n')
    },
    polymathTrial: { code: booking.code, kind: 'trial-reminder' }
  };
}

// The Zoom link and worksheets, by email: sent to everyone who opens a class
// link, and by an admin's "Email Zoom + worksheets" for any booking, so nobody
// has to send them again by hand when a file or link is lost.
function materialsMail(booking, zoom, materials, now, { resend = false } = {}) {
  if (!validEmail(booking.email)) return null;
  const access = accessFor(booking);
  const links = emailSheetLinks(booking, materials, now);
  const rows = lessonRows(booking, zoom, materials, links);
  const name = (levelName(booking.classLevel) + ' ' + subjectName(booking.classSubject)).trim();
  const greeting = booking.parentName ? 'Dear ' + booking.parentName + ',' : 'Hello' + (booking.studentName ? ' ' + booking.studentName : '') + ',';
  const lead = (resend ? 'As requested, here again are ' : 'Here are ') + 'the Zoom link and worksheets for the Polymath ' + name + ' class'
    + (booking.lessonDate ? ' on ' + booking.sessionLabel : ' (' + slotLabel(booking.slot) + ')') + '. Please keep this email.';
  const join = zoom && zoom.url ? 'Join on Zoom: ' + zoom.url + (zoom.note ? ' (' + zoom.note + ')' : '') : 'We will send the Zoom link before the lesson.';
  const until = 'The worksheet download links work for one week, until ' + fmtMoment(links.until) + '.';
  const page = bookingPageUrl(access);
  const first = liveFirstLine(booking, zoom);
  return {
    to: [booking.email],
    from: FROM, replyTo: SENDER_EMAIL,
    message: {
      subject: 'Zoom link and worksheets: Polymath ' + name + ' class' + (booking.lessonDate ? ' (' + fmtDayKey(booking.lessonDate) + ')' : ''),
      html: parentShell([escapeHtml(greeting), escapeHtml(lead),
        first ? first.html : zoom && zoom.url ? 'Join on Zoom: ' + linkHtml(zoom.url) + (zoom.note ? ' (' + escapeHtml(zoom.note) + ')' : '') : escapeHtml(join),
        escapeHtml(until)], rows, { url: page, label: 'Open the class page' }),
      text: [greeting, '', lead, '', first ? first.text : join, '', until, 'Class page: ' + page, '', rowsText(rows), '',
        'Questions? Reply to this email or WhatsApp us at ' + WHATSAPP_DISPLAY + '.', '', 'Thank you,', SENDER_NAME].join('\n')
    },
    polymathTrial: { code: booking.code, kind: resend ? 'trial-materials-resend' : 'trial-materials' }
  };
}

function adminBookingMail(booking, zoom, materials) {
  const rows = lessonRows(booking, zoom, materials);
  const warnings = [];
  if (!zoom || !zoom.url) warnings.push('No Zoom link is set for this class yet. Add one on the trial admin page so the reminder carries it.');
  if (!materials || !materials.linked) warnings.push('No Polymath Online class is linked to this time slot, so no worksheets were shown.');
  return {
    to: NOTIFICATION_EMAILS.slice(),
    from: FROM,
    replyTo: validEmail(booking.email) ? booking.email : SENDER_EMAIL,
    message: {
      subject: 'New TRIAL (online): ' + booking.studentName + ' (' + levelName(booking.classLevel) + ' ' + subjectName(booking.classSubject) + ') — ' + booking.sessionLabel,
      html: '<div style="font-family:Arial,sans-serif;color:#171717;max-width:640px;">'
        + '<h2>New Online Trial Lesson Booking</h2>'
        + '<p>Booked on the password-protected trial page. Reply to this email to reach the parent directly.</p>'
        + warnings.map(w => '<p style="color:#b45309;font-weight:700">' + escapeHtml(w) + '</p>').join('')
        + rowsHtml(rows)
        + '<p style="margin-top:16px;"><a href="' + TRIAL_URL + '#admin">See all trial bookings</a></p></div>',
      text: 'New online trial lesson booking.\n\n' + warnings.map(w => w + '\n').join('') + rowsText(rows) + '\n\nAll trial bookings: ' + TRIAL_URL + '#admin'
    },
    polymathTrial: { code: booking.code, kind: 'trial-admin' }
  };
}

// Bookings whose lesson is tomorrow (Singapore), still on, not yet reminded.
function dueReminders(bookings, now) {
  const tomorrow = addDays(sgDayKey(now), 1);
  return (bookings || []).filter(b => b && b.kind === 'booking' && b.lessonDate === tomorrow
    && b.status !== 'cancelled' && !b.reminderSentAtMs && validEmail(b.email));
}
const mailIdFor = (code, kind, random = randomBytes) => MAIL_PREFIX + code + '-' + kind + '-' + random(6).toString('hex');

// ─── The admin's view ───
function adminSlotRows(config, settings, courses, sheets) {
  const s = readSettings(settings);
  return trialSlotIds(config).map(id => {
    const slot = readSlot(config, id);
    const course = courseForSlot(courses, id, slot, s.courseFor[id]);
    return {
      slot: id, label: slotLabel(id), level: slot.level, subject: slot.subject, mode: slot.mode,
      zoom: typeof s.zoom[id] === 'string' ? s.zoom[id] : '', zoomNote: typeof s.zoomNote[id] === 'string' ? s.zoomNote[id] : '',
      effectiveZoom: zoomFor(s, id).url,
      courseChoice: typeof s.courseFor[id] === 'string' ? s.courseFor[id] : '',
      courseId: course ? course.id : '', materials: materialsFor(course, sheets)
    };
  });
}
function publicLink(link, now) {
  return {
    token: link.token, url: linkPageUrl(link.token), slot: link.slot, label: link.label || '',
    slotLabel: slotLabel(link.slot), level: link.level || '', subject: link.subject || '',
    createdAtMs: num(link.createdAtMs, 0), expiresAtMs: num(link.expiresAtMs, 0), createdBy: link.createdBy || '',
    opens: num(link.opens, 0), people: num(link.people, 0), state: linkState(link, now)
  };
}
function adminBooking(b) {
  const out = {};
  for (const key of ['code', 'kind', 'slot', 'slotLabel', 'lessonDate', 'sessionLabel', 'classLevel', 'classSubject', 'parentName',
    'studentName', 'email', 'whatsapp', 'status', 'createdAtMs', 'reminderSentAtMs', 'reminderSentTo', 'confirmationSentTo',
    'linkToken', 'linkLabel', 'accessCode', 'via', 'materialsSentAtMs', 'materialsSentTo', 'opens', 'lastOpenedAtMs', 'accessUntilMs', 'pageVersion']) if (b[key] !== undefined) out[key] = b[key];
  if (b.viewToken) out.pageUrl = bookingPageUrl(accessFor(b));
  const live = liveLessonUrl(b);
  if (live) out.liveUrl = live;
  return out;
}

// ─── Admin sign-in (the Firebase ID token from "Authorization: Bearer …") ───
async function trialAdminFrom(req, verifyIdToken) {
  const header = String(req.get('authorization') || '');
  const match = /^Bearer\s+(\S{20,4096})$/.exec(header);
  if (!match) throw new ShopError(401, 'sign-in-required');
  let claims;
  try { claims = await verifyIdToken(match[1]); } catch { throw new ShopError(401, 'sign-in-required'); }
  const email = claims && typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  if (!email || claims.email_verified !== true || !TRIAL_ADMINS.includes(email)) throw new ShopError(403, 'admin-only');
  return email;
}

// ─── The HTTP handlers ───
function createTrialService({ store, http, hashIp, verifyIdToken = async () => { throw new Error('no auth'); },
  now = Date.now, random, randomBytesImpl = randomBytes, report = () => {} }) {
  const ipOf = req => String(req.ip || req.socket?.remoteAddress || 'unknown');
  const hourQuota = (name, req, at, maximum) => {
    const hour = Math.floor(at / HOUR);
    return { id: 'trial-' + name + '-' + hashIp(ipOf(req)) + '-' + hour, maximum, expiresAt: (hour + 1) * HOUR + DAY };
  };

  // The live Zoom link and worksheets for a slot.
  async function extrasFor(slotId, context) {
    const ctx = context || await store.loadContext();
    const slot = readSlot(ctx.config, slotId);
    const settings = readSettings(ctx.settings);
    const courses = await store.loadCourses();
    const course = courseForSlot(courses, slotId, slot.level ? slot : null, settings.courseFor[slotId]);
    const { current, next } = currentAndNext(course);
    const sheets = await store.loadSheets([current, next].filter(Boolean));
    return { zoom: zoomFor(settings, slotId), materials: materialsFor(course, sheets), course, sheets, now: now() };
  }

  // The way in for booking a date: an unused one-time code (checked here, used
  // up by the booking's transaction), or the shared password when the admins
  // have switched it on. A wrong guess counts against the connection's hourly limit.
  async function requireGate(req, value, at, { record = false, allowUsed = false } = {}) {
    const ctx = await store.loadContext();
    if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new ShopError(403, 'wrong-code');
    const code = normalAccessCode(value);
    if (code) {
      const state = await store.checkAccessCode(code, at, record);
      // A used code may still reach the booking's transaction, which hands back
      // the booking it was used for (the same student booked twice) or refuses.
      if (state === 'active' || (allowUsed && state === 'used')) return { ctx, gate: { via: 'code', accessCode: code } };
      if (state !== 'unknown') throw new ShopError(403, 'code-' + state);
    }
    if (readSettings(ctx.settings).passwordEnabled && passwordMatches(ctx.settings, value))
      return { ctx, gate: { via: 'password', accessCode: '' } };
    await store.countAttempts([hourQuota('pw', req, at, LIMITS.wrongPasswordPerIpHour)], 'too-many-attempts');
    throw new ShopError(403, 'wrong-code');
  }

  // 🔑 Who is calling trialAdmin: a Google admin (their email) or someone holding
  // a live admin-password session (ADMIN_PASSWORD_LABEL).
  async function adminFrom(req, at) {
    const header = String(req.get('authorization') || '');
    const match = /^Bearer\s+(\S{20,4096})$/.exec(header);
    if (match && match[1].startsWith(ADMIN_SESSION_PREFIX)) {
      const settings = await store.loadSettings();
      if (adminSessionValid(match[1], settings.adminSessionKey, at)) return ADMIN_PASSWORD_LABEL;
      throw new ShopError(401, 'admin-session-ended');
    }
    return trialAdminFrom(req, verifyIdToken);
  }
  const adminPasswordQuotas = (req, at) => [hourQuota('adminpw', req, at, LIMITS.adminPasswordPerIpHour),
    { id: 'trial-adminpw-day-' + sgDayKey(at), maximum: LIMITS.adminPasswordGlobalDay, expiresAt: at + 2 * DAY }];
  // { action: 'adminLogin', password } → { token, expiresAtMs }. Needs no sign-in.
  async function adminLogin(req, res, body, at) {
    checkKeys(body, ['action', 'password']);
    const quotas = adminPasswordQuotas(req, at);
    await store.checkAttempts(quotas, 'too-many-attempts');
    const settings = await store.loadSettings();
    if (typeof body.password !== 'string' || !adminPasswordMatches(settings, body.password)) {
      await store.countAttempts(quotas, 'too-many-attempts');
      throw new ShopError(403, 'wrong-admin-password');
    }
    const key = await store.ensureAdminSessionKey(() => randomBytesImpl(32).toString('hex'));
    const expiresAtMs = at + ADMIN_SESSION_HOURS * HOUR;
    return res.status(200).json({ ok: true, admin: ADMIN_PASSWORD_LABEL, expiresAtMs,
      token: adminSessionToken(key, expiresAtMs, randomToken(24, randomBytesImpl)) });
  }

  async function bookingAccess(access, at) {
    const parsed = parseAccess(access);
    if (!parsed) throw new ShopError(404, 'booking-not-found');
    const booking = await store.getBooking(parsed.code);
    if (!booking || !booking.viewToken || !samePassword(booking.viewToken, parsed.token)) throw new ShopError(404, 'booking-not-found');
    const link = booking.kind === 'link' ? await store.getLink(booking.linkToken) : null;
    if (!accessOpen(booking, link, at)) {
      if (booking.status === 'cancelled') throw new ShopError(410, 'booking-cancelled');
      throw new ShopError(410, booking.kind === 'link' ? 'link-expired' : 'booking-ended');
    }
    return { booking, link };
  }

  // POST /trialBooking  { action: 'unlock' | 'book' | 'view' | 'linkInfo' | 'linkOpen', … }
  async function trialBooking(req, res) {
    if (!http.cors(req, res)) return;
    try {
      const at = now();
      const body = req.body;
      const action = body && typeof body === 'object' ? body.action : '';
      if (action === 'unlock') {
        checkKeys(body, ['action', 'code']);
        const { gate } = await requireGate(req, body.code, at, { record: true });
        return res.status(200).json({ ok: true, via: gate.via });
      }
      if (action === 'book') {
        const request = validateBook(body);
        const { ctx, gate } = await requireGate(req, body.code, at, { allowUsed: true });
        const slot = checkSession(request, ctx.config || {}, at);
        const extras = await extrasFor(request.slot, ctx);
        const day = Math.floor(at / DAY);
        const result = await store.reserveBooking(code => ({
          code, now: at,
          duplicate: { id: 'trial-dup-' + hashKey([request.email, request.studentName.toLowerCase(), request.slot, request.date].join('|')),
            expiresAt: dayKeyTime(request.date) - SG_OFFSET + 2 * DAY },
          quotas: [hourQuota('book', req, at, LIMITS.bookPerIpHour),
            { id: 'trial-book-global-' + day, maximum: LIMITS.bookGlobalDay, expiresAt: (day + 2) * DAY }],
          accessCode: gate.accessCode,
          booking: Object.assign(bookingRecord(request, slot, code, randomToken(24, randomBytesImpl), at, gate),
            { linkKey: randomToken(32, randomBytesImpl) }),
          mails: booking => [
            { id: mailIdFor(code, 'admin', randomBytesImpl), mail: adminBookingMail(booking, extras.zoom, extras.materials) },
            { id: mailIdFor(code, 'parent', randomBytesImpl), mail: parentConfirmationMail(booking, extras.zoom, extras.materials, at), confirmation: true }
          ]
        }), () => newOrderCode(random));
        const live = result.already ? await extrasFor(result.booking.slot) : extras;
        return res.status(result.already ? 200 : 201).json({ ok: true, already: !!result.already, booking: publicBooking(result.booking, live) });
      }
      if (action === 'view') {
        checkKeys(body, ['action', 'access']);
        const { booking, link } = await bookingAccess(body.access, at);
        const extras = await extrasFor(booking.slot);
        if (link) extras.accessUntilMs = Math.min(num(link.expiresAtMs, 0), num(booking.accessUntilMs, Infinity));
        return res.status(200).json({ ok: true, booking: publicBooking(booking, extras) });
      }
      // 🎟 The /live page: whose live link this is, and when its lesson is.
      // It shows only what that page needs (no email, no page access key).
      if (action === 'live') {
        checkKeys(body, ['action', 'live']);
        const parsed = parseLive(body.live);
        const booking = parsed ? await store.getBooking(parsed.code) : null;
        if (!booking || !samePassword(trialLiveMac(Object.assign({}, booking, { code: parsed.code }), parsed.code), parsed.mac))
          throw new ShopError(404, 'live-link-unknown');
        const link = booking.kind === 'link' ? await store.getLink(booking.linkToken) : null;
        const win = liveWindow(booking, link, at);
        const { zoom } = await extrasFor(booking.slot);
        const live = parsed.code + '.' + parsed.mac;
        return res.status(200).json({ ok: true, live: {
          code: parsed.code, kind: booking.kind, state: win.state, now: at,
          startsAtMs: win.startsAtMs, opensAtMs: win.opensAtMs, closesAtMs: win.closesAtMs,
          sessionLabel: win.sessionLabel, slot: booking.slot, time: slotTime(booking.slot),
          studentName: booking.studentName || '', className: (levelName(booking.classLevel) + ' ' + subjectName(booking.classSubject)).trim(),
          joinUrl: win.state === 'cancelled' ? '' : anskeyTrialUrl(live), zoomUrl: zoom.url || '', zoomNote: zoom.note || '' } });
      }
      if (action === 'linkInfo') {
        checkKeys(body, ['action', 'link']);
        const token = oneLine(body.link, 40, 1);
        const link = LINK_PATTERN.test(token) ? await store.getLink(token) : null;
        const state = linkState(link, at);
        if (state !== 'active') throw new ShopError(state === 'unknown' ? 404 : 410, 'link-' + state);
        const { config } = await store.loadContext();
        const slot = readSlot(config, link.slot);
        return res.status(200).json({ ok: true, link: {
          slot: link.slot, slotLabel: slotLabel(link.slot), level: slot.level || link.level || '', subject: slot.subject || link.subject || '',
          className: className(slot.level ? slot : { level: link.level, subject: link.subject }), expiresAtMs: link.expiresAtMs } });
      }
      if (action === 'linkOpen') {
        const request = validateLinkOpen(body);
        if (!LINK_PATTERN.test(request.link)) throw new ShopError(404, 'link-unknown');
        await store.countAttempts([hourQuota('link', req, at, LIMITS.linkOpenPerIpHour)], 'too-many-attempts');
        const ctx = await store.loadContext();
        const first = await store.getLink(request.link);
        const firstState = linkState(first, at);
        if (firstState !== 'active') throw new ShopError(firstState === 'unknown' ? 404 : 410, 'link-' + firstState);
        let extras = await extrasFor(first.slot, ctx);
        const result = await store.openLink(request.link, at, (link, code) => {
          const slot = readSlot(ctx.config, link.slot);
          return {
            duplicateId: 'trial-linkuse-' + hashKey([link.token, request.email].join('|')),
            visit: Object.assign(linkVisitRecord(request, link, slot.level ? slot : null, code, randomToken(24, randomBytesImpl), at),
              { linkKey: randomToken(32, randomBytesImpl) }),
            // Everyone who opens a class link gets the Zoom link and worksheets by email.
            mail: visit => ({ id: mailIdFor(code, 'materials', randomBytesImpl),
              mail: link.slot === first.slot ? materialsMail(visit, extras.zoom, extras.materials, at) : null })
          };
        }, () => newOrderCode(random));
        if (result.state !== 'active') throw new ShopError(result.state === 'unknown' ? 404 : 410, 'link-' + result.state);
        if (result.visit.slot !== first.slot) extras = await extrasFor(result.visit.slot, ctx);
        extras.accessUntilMs = Math.min(num(result.link.expiresAtMs, 0), num(result.visit.accessUntilMs, Infinity));
        return res.status(result.already ? 200 : 201).json({ ok: true, booking: publicBooking(result.visit, extras) });
      }
      fail('unknown-action');
    } catch (error) {
      return http.answerError(res, error, 'trial-request-failed');
    }
  }

  // GET /trialMaterial?a=<access>&d=<worksheet>&x=<expires ms>&s=<signature> — the worksheet PDF.
  // Refused once the link's time is up (a week for emailed links, a day for the
  // page's), when the signature does not match, when the booking or its class
  // link has ended, or when the worksheet is no longer in the class's list.
  async function trialMaterial(req, res) {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    const page = (status, message) => res.status(status).type('html').send('<!doctype html><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Polymath trial worksheet</title>'
      + '<body style="font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#10303a">'
      + '<h1 style="font-size:20px">Worksheet not available</h1><p>' + escapeHtml(message) + '</p>'
      + '<p>Please open your trial page again, or WhatsApp us at <a href="https://wa.me/' + WHATSAPP_NUMBER + '">' + WHATSAPP_DISPLAY + '</a>.</p></body>');
    if (req.method !== 'GET' && req.method !== 'HEAD') return page(405, 'This address only opens worksheets.');
    try {
      const at = now();
      const q = req.query || {};
      const id = typeof q.d === 'string' && /^[\w-]{1,80}$/.test(q.d) ? q.d : '';
      const until = typeof q.x === 'string' && /^\d{12,15}$/.test(q.x) ? Number(q.x) : NaN;
      const signature = typeof q.s === 'string' && /^[\w-]{32}$/.test(q.s) ? q.s : '';
      if (!id || !Number.isFinite(until) || !signature) return page(404, 'This worksheet link is not valid.');
      await store.countAttempts([hourQuota('pdf', req, at, LIMITS.materialPerIpHour)], 'too-many-attempts');
      const { booking } = await bookingAccess(q.a, at);
      if (!samePassword(materialSignature(booking, id, until), signature)) return page(404, 'This worksheet link is not valid.');
      if (!(at < until)) return page(410, 'This download link has expired. Worksheet links in our emails work for one week. '
        + 'Open your trial page for fresh links, or WhatsApp us and we will help.');
      const extras = await extrasFor(booking.slot);
      if (!courseIds(extras.course).includes(id)) return page(404, 'This worksheet is no longer in the class.');
      const sheet = (await store.loadSheets([id]))[id];
      if (!sheet || !sheet.storagePath) return page(404, 'This worksheet has no file right now.');
      const name = String(sheet.name || 'Worksheet').replace(/[^\w .,()&+-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Worksheet';
      const file = await store.openPdf(sheet.storagePath);
      if (!file) return page(404, 'This worksheet file could not be found.');
      res.status(200);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'inline; filename="' + name + '.pdf"');
      if (file.size) res.set('Content-Length', String(file.size));
      if (req.method === 'HEAD') return res.end();
      await new Promise((resolve) => {
        file.stream.on('error', () => { report('trial-material-stream-failed'); if (!res.headersSent) page(502, 'The worksheet could not be sent.'); else res.end(); resolve(); });
        file.stream.on('end', resolve);
        file.stream.pipe(res);
      });
    } catch (error) {
      if (error instanceof ShopError) {
        const words = {
          'booking-not-found': 'This worksheet link is not valid.',
          'booking-cancelled': 'This trial booking was cancelled.',
          'booking-ended': 'This trial booking has ended.',
          'link-expired': 'The class link this came from has expired (links last one week).',
          'too-many-attempts': 'Too many downloads from this connection. Please try again in an hour.'
        };
        return page(error.status, words[error.code] || 'This worksheet is not available.');
      }
      report('trial-material-failed');
      return page(503, 'Something went wrong. Please try again in a moment.');
    }
  }

  // POST /trialAdmin (signed-in admins, or an admin-password session)  { action, … }
  // { action: 'adminLogin', password } is the one call that needs neither.
  async function trialAdmin(req, res) {
    if (!http.cors(req, res)) return;
    try {
      const at = now();
      const body = req.body;
      if (body && typeof body === 'object' && !Array.isArray(body) && body.action === 'adminLogin') return await adminLogin(req, res, body, at);
      const email = await adminFrom(req, at);
      const byPassword = email === ADMIN_PASSWORD_LABEL;
      const action = body && typeof body === 'object' ? body.action : '';
      if (action === 'load') {
        checkKeys(body, ['action']);
        const [{ config, settings }, courses, bookings, links, codes] = await Promise.all([store.loadContext(), store.loadCourses(),
          store.listBookings(), store.listLinks(), store.listAccessCodes()]);
        const s = readSettings(settings);
        const wanted = new Set();
        trialSlotIds(config).forEach(id => {
          const { current, next } = currentAndNext(courseForSlot(courses, id, readSlot(config, id), s.courseFor[id]));
          if (current) wanted.add(current); if (next) wanted.add(next);
        });
        const sheets = await store.loadSheets([...wanted]);
        const adminPassword = adminPasswordRecord(settings);
        return res.status(200).json({ ok: true, admin: email, byPassword, now: at,
          settings: { zoomDefault: s.zoomDefault, zoomDefaultNote: s.zoomDefaultNote, passwordIsDefault: !s.passwordHash,
            passwordSetAt: s.passwordSetAt, passwordSetBy: s.passwordSetBy, passwordEnabled: s.passwordEnabled,
            adminPasswordIsDefault: adminPassword.isDefault, adminPasswordSetAt: num(settings && settings.adminPasswordSetAt, 0),
            adminPasswordSetBy: settings && typeof settings.adminPasswordSetBy === 'string' ? settings.adminPasswordSetBy : '' },
          codes: codes.map(c => publicAccessCode(c, at)).sort((a, b) => b.createdAtMs - a.createdAtMs || a.code.localeCompare(b.code)),
          slots: adminSlotRows(config, settings, courses, sheets),
          courses: courses.map(c => ({ id: c.id, title: courseTitle(c), level: c.level || '', subject: c.subject || '', day: c.day || '',
            slot: courseSlotIndex(c), worksheets: courseIds(c).length }))
            .sort((a, b) => String(a.level).localeCompare(String(b.level)) || String(a.title).localeCompare(String(b.title))),
          bookings: bookings.map(adminBooking).sort((a, b) => num(b.createdAtMs, 0) - num(a.createdAtMs, 0)),
          links: links.map(link => publicLink(link, at)).sort((a, b) => b.createdAtMs - a.createdAtMs) });
      }
      if (action === 'saveSettings') {
        checkKeys(body, ['action', 'zoomDefault', 'zoomDefaultNote', 'zoom', 'zoomNote', 'courseFor']);
        const url = value => {
          const v = oneLine(value, 400);
          if (!v) return '';
          let parsed;
          try { parsed = new URL(v); } catch { fail('invalid-zoom-link'); }
          if (parsed.protocol !== 'https:') fail('invalid-zoom-link');
          return parsed.href;
        };
        const map = (value, clean) => {
          const out = {};
          if (value === undefined) return out;
          if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
          for (const [key, v] of Object.entries(value)) {
            if (!SLOT_ID.test(key)) fail();
            const cleaned = clean(v);
            if (cleaned) out[key] = cleaned;
          }
          return out;
        };
        const patch = {
          zoomDefault: url(body.zoomDefault), zoomDefaultNote: oneLine(body.zoomDefaultNote, 200),
          zoom: map(body.zoom, url), zoomNote: map(body.zoomNote, v => oneLine(v, 200)),
          courseFor: map(body.courseFor, v => { const id = oneLine(v, 80); if (id && !/^[\w-]+$/.test(id)) fail(); return id; }),
          updatedAtMs: at, updatedBy: email
        };
        await store.saveSettings(patch);
        return res.status(200).json({ ok: true });
      }
      if (action === 'setPassword') {
        checkKeys(body, ['action', 'password', 'enabled']);
        const patch = {};
        if (body.password !== undefined && body.password !== '') {
          if (typeof body.password !== 'string') fail('weak-password');
          Object.assign(patch, newPasswordFields(body.password, email, at, randomBytesImpl));
        }
        if (body.enabled !== undefined) {
          if (typeof body.enabled !== 'boolean') fail();
          patch.passwordEnabled = body.enabled;
        }
        if (!Object.keys(patch).length) fail();
        await store.saveSettings(patch);
        return res.status(200).json({ ok: true });
      }
      // 🔑 Change the admin password (and sign out every password session). Only a
      // Google admin may, so someone holding the password cannot lock the admins out.
      if (action === 'setAdminPassword') {
        checkKeys(body, ['action', 'password']);
        if (byPassword) throw new ShopError(403, 'google-admin-only');
        await store.saveSettings(newAdminPasswordFields(body.password, email, at, randomBytesImpl));
        return res.status(200).json({ ok: true });
      }
      if (action === 'createCodes') {
        checkKeys(body, ['action', 'count', 'label']);
        const count = Number(body.count);
        if (!Number.isInteger(count) || count < 1 || count > MAX_CODES_AT_ONCE) fail('invalid-count');
        const label = oneLine(body.label, 80);
        const made = await store.createAccessCodes(count, () => newAccessCode(randomBytesImpl), code => ({
          code, label, createdAtMs: at, createdBy: email, expiresAtMs: at + ACCESS_CODE_DAYS * DAY,
          checks: 0, usedAtMs: 0, usedFor: '', revoked: false
        }));
        return res.status(201).json({ ok: true, codes: made.map(c => publicAccessCode(c, at)) });
      }
      if (action === 'revokeCode') {
        checkKeys(body, ['action', 'code']);
        const code = normalAccessCode(body.code);
        if (!code || !(await store.updateAccessCode(code, { revoked: true, revokedAtMs: at, revokedBy: email }))) throw new ShopError(404, 'code-unknown');
        return res.status(200).json({ ok: true });
      }
      if (action === 'createLink') {
        checkKeys(body, ['action', 'slot', 'label']);
        const slotId = oneLine(body.slot, 8, 1);
        const { config } = await store.loadContext();
        const slot = trialSlot(config, slotId);
        if (!slot) throw new ShopError(409, 'session-unavailable');
        // Who the link is for (Zhi Kai, 17 Nov 2026): required, so every link in the admin list is told
        // apart by the parent or student it was made for, not only by its class.
        const label = oneLine(typeof body.label === 'string' ? body.label : '', 80);
        if (label.length < 2) throw new ShopError(400, 'link-name-required');
        const link = { token: randomToken(24, randomBytesImpl), slot: slotId, level: slot.level, subject: slot.subject,
          label, createdAtMs: at, expiresAtMs: at + LINK_DAYS * DAY, createdBy: email,
          opens: 0, people: 0, revoked: false };
        await store.createLink(link);
        return res.status(201).json({ ok: true, link: publicLink(link, at) });
      }
      if (action === 'revokeLink') {
        checkKeys(body, ['action', 'token']);
        const token = oneLine(body.token, 40, 20);
        if (!(await store.updateLink(token, { revoked: true, revokedAtMs: at, revokedBy: email }))) throw new ShopError(404, 'link-unknown');
        return res.status(200).json({ ok: true });
      }
      if (action === 'setStatus') {
        checkKeys(body, ['action', 'code', 'status']);
        if (!STATUSES.includes(body.status)) fail();
        if (!(await store.updateBooking(oneLine(body.code, 6, 6), { status: body.status, statusSetAtMs: at, statusSetBy: email })))
          throw new ShopError(404, 'booking-not-found');
        return res.status(200).json({ ok: true });
      }
      if (action === 'deleteBooking') {
        checkKeys(body, ['action', 'code']);
        if (!(await store.deleteBooking(oneLine(body.code, 6, 6)))) throw new ShopError(404, 'booking-not-found');
        return res.status(200).json({ ok: true });
      }
      if (action === 'sendReminder') {
        checkKeys(body, ['action', 'code']);
        const code = oneLine(body.code, 6, 6);
        const booking = await store.getBooking(code);
        if (!booking || booking.kind !== 'booking') throw new ShopError(404, 'booking-not-found');
        const extras = await extrasFor(booking.slot);
        const result = await store.sendReminder(code, b => reminderMail(b, extras.zoom, extras.materials, at),
          mailIdFor(code, 'reminder', randomBytesImpl), at, { force: true, by: email });
        if (!result.sent) throw new ShopError(409, result.reason || 'not-sent');
        return res.status(200).json({ ok: true, to: result.to });
      }
      if (action === 'emailMaterials') {
        checkKeys(body, ['action', 'code']);
        const code = oneLine(body.code, 6, 6);
        const booking = await store.getBooking(code);
        if (!booking) throw new ShopError(404, 'booking-not-found');
        const extras = await extrasFor(booking.slot);
        const result = await store.sendMaterials(code, b => materialsMail(b, extras.zoom, extras.materials, at, { resend: true }),
          mailIdFor(code, 'materials', randomBytesImpl), at, email);
        if (!result.sent) throw new ShopError(409, result.reason || 'not-sent');
        return res.status(200).json({ ok: true, to: result.to });
      }
      fail('unknown-action');
    } catch (error) {
      return http.answerError(res, error, 'trial-admin-failed');
    }
  }

  return { trialBooking, trialMaterial, trialAdmin, extrasFor };
}

module.exports = {
  TRIAL_SETTINGS_DOC, TRIAL_BOOKINGS, TRIAL_LINKS, TRIAL_CODES, ACCESS_CODE_DAYS, MAX_CODES_AT_ONCE,
  normalAccessCode, showAccessCode, newAccessCode, accessCodeState, publicAccessCode, COURSES, SHEETS, LIMIT_COLLECTION, DEFAULT_PASSWORD, TRIAL_ADMINS, NOTIFICATION_EMAILS,
  TRIAL_URL, MATERIAL_ENDPOINT, TRIAL_HORIZON_DAYS, LINK_DAYS, BOOKING_ACCESS_DAYS_AFTER, LIMITS, STATUSES, SG_PUBLIC_HOLIDAYS, MAIL_PREFIX,
  sgDayKey, validDayKey, addDays, fmtDayKey, fmtMoment, slotTime, slotStart, sessionLabel, bookingWindow, trialSlot, trialSlotIds, trialSessions,
  lessonStart, ansKeyAt, currentAndNext, courseForSlot, courseTitle, materialsFor, readSettings, zoomFor,
  LIVE_PAGE_URL, ANSKEY_LIVE_URL, LIVE_EARLY_MS, LIVE_LATE_MS, trialLiveMac, trialLiveCode, parseLive, liveLessonUrl, anskeyTrialUrl, liveWindow, liveFirstLine,
  normalPassword, hashPassword, passwordMatches, newPasswordFields,
  DEFAULT_ADMIN_PASSWORD, ADMIN_SESSION_HOURS, ADMIN_SESSION_PREFIX, ADMIN_PASSWORD_LABEL, adminPasswordRecord, adminPasswordMatches,
  newAdminPasswordFields, adminSessionToken, adminSessionValid, randomToken, accessFor, parseAccess, materialUrl, bookingPageUrl, linkPageUrl,
  validateBook, validateLinkOpen, checkSession, cleanWhatsapp, bookingRecord, linkVisitRecord, accessOpen, linkState, publicBooking,
  parentConfirmationMail, reminderMail, adminBookingMail, materialsMail, emailSheetLinks, materialSignature, MAIL_LINK_DAYS, dueReminders, mailIdFor, adminSlotRows, publicLink, adminBooking, trialAdminFrom,
  createTrialService
};
