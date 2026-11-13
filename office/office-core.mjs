/* ═══════════════════════════════════════════════════════════════════════════
   🏢 POLYMATH OFFICE — THE SHARED CORE (office-core.mjs)

   Pure logic, no DOM and no Firebase. Three places import this one file, so
   the three can never disagree about a fee, a reference code or a sentence:

     office/index.html       the admin app at polymathlc.com.sg/office
     pay/index.html          the parent's invoice page at polymathlc.com.sg/pay
     tools/office-autopilot.mjs   the monthly invoice run (GitHub Actions)

   and tools/office-core-tests.mjs runs every function here under node --test.

   What lives here, in the order a month actually happens:
     1. The timetable and its fees — read from the SAME schedule_config/main
        document polymathlc.com.sg/schedule edits, priced by the SAME rule
        (monthlyFeeFor is that page's function, given the config as an argument).
     2. Reference codes — one permanent 6-character code per family, printed in
        every PayNow QR as the bill reference ("PLC K7M2QX NOV26"), which is what
        lets a bank statement be matched back to a family without anybody reading it.
     3. The PayNow SGQR payload — byte for byte the products page's encoder
        (tlv / crc16 / buildPayNow), so a QR from the shop and a QR from an
        invoice are the same kind of thing.
     4. Invoices — lines from each student's classes, a standing family
        discount, credit carried over from an overpayment, due dates, states.
        Custom invoices too: one written by hand (any parent, any lines, any
        dates), and the choice of QR every invoice carries — the exact amount
        and reference, a generic PayNow QR to the centre, or none at all.
     5. Bank statements — rows from Excel/CSV, positioned text from a PDF, the
        ChatGPT prompts and the checks run on what ChatGPT answers.
     6. Matching — reference code first, a remembered payer name second, names
        and amounts as suggestions, and the allocation of a payment across a
        family's unpaid months.
     7. Words — the invoice, reminder and receipt emails, the WhatsApp texts,
        and the `mail` documents the Trigger Email extension sends.
     8. Importing a spreadsheet of families and students.
     9. Family records — the confirmed sign-ups as one record each: status, the
        family's ONE email (its account ID), each child's primary school, start
        date, type of lesson (online regular / physical regular / masterclass)
        and slots on the schedule, and the payment record (months paid, last
        payment, last PayNow screenshot the parent sent).
   ═══════════════════════════════════════════════════════════════════════════ */

export const OFFICE_CORE_VERSION = '1.10.0';

/* ─────────────────────────── The centre ─────────────────────────── */
export const SITE = 'https://polymathlc.com.sg';
export const PAY_URL = SITE + '/pay/';
export const OFFICE_URL = SITE + '/office/';
export const PAYNOW_UEN = 'T16LL2365E';
export const MERCHANT_NAME = 'POLYMATH LEARNING';
export const CENTRE_NAME = 'Polymath Learning Centre';
export const CENTRE_WHATSAPP = '6596450588';
export const CENTRE_PHONE = '+65 9645 0588';
// Every office email is sent AS the centre, whichever admin pressed the button,
// exactly like Polymath Online's invitations (online/portal-core.js).
export const SENDER_EMAIL = 'admin@polymathlc.com.sg';
export const SENDER_NAME = 'Polymath Learning Centre';
// The same three accounts that administer Polymath Online. tools/office-rules.mjs
// installs exactly this list into the shared Firestore rules; keep them equal.
export const OFFICE_ADMINS = ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'elsielcr@gmail.com', 'support@polymathlc.com.sg'];

export const COLLECTIONS = Object.freeze({
  families: 'officeFamilies',
  invoices: 'officeInvoices',
  payments: 'officePayments',
  statements: 'officeStatements',
  settings: 'officeSettings',
  links: 'officeLinks'
});
// Office emails are `mail/polymath-office-<kind>-<key>-<time>` — never the
// protected `polymath-enquiry-*` ids, never Polymath Online's.
export const MAIL_PREFIX = 'polymath-office-';

/* ─────────────────────────── 1. The timetable ───────────────────────────
   These are polymathlc.com.sg/schedule's own constants (schedule/index.html,
   WEEKDAY_TIMES / SATURDAY_TIMES / DAYS). The slot ids "MON-1" … "SAT-3" are the
   keys of schedule_config/main.slots, so a student's class is just a slot id. */
export const WEEKDAY_TIMES = [
  { n: 1, label: '3:00pm – 4:45pm' },
  { n: 2, label: '5:00pm – 6:45pm' },
  { n: 3, label: '7:00pm – 8:45pm' }
];
export const SATURDAY_TIMES = [
  { n: 1, label: '9:00am – 10:45am' },
  { n: 2, label: '11:00am – 12:45pm' },
  { n: 3, label: '1:00pm – 2:45pm' }
];
export const DAYS = [
  { code: 'MON', name: 'Monday', short: 'Mon', times: WEEKDAY_TIMES },
  { code: 'TUE', name: 'Tuesday', short: 'Tue', times: WEEKDAY_TIMES },
  { code: 'WED', name: 'Wednesday', short: 'Wed', times: WEEKDAY_TIMES },
  { code: 'THU', name: 'Thursday', short: 'Thu', times: WEEKDAY_TIMES },
  { code: 'FRI', name: 'Friday', short: 'Fri', times: WEEKDAY_TIMES },
  { code: 'SAT', name: 'Saturday', short: 'Sat', times: SATURDAY_TIMES }
];
// The schedule page offers P3–P6; the centre also teaches Secondary 1 Science,
// so a student's own level may be any of these (a class's level comes from the slot).
export const LEVELS = ['P3', 'P4', 'P5', 'P6', 'S1'];
export const SUBJECTS = ['Math', 'Science'];
export const MODES = ['Physical', 'Online'];
// How a child takes ONE class (v1.9.0): physical, online, or as a Master class.
// A child can mix them across classes, so there is no type per child any more.
// A Master Class slot of the schedule is always taken as a Master class.
export const CLASS_MODES = ['Physical', 'Online', 'Master'];
export const CLASS_MODE_META = Object.freeze({
  Physical: Object.freeze({ key: 'physical', label: 'Physical', long: 'Physical regular', icon: '🏫' }),
  Online: Object.freeze({ key: 'online', label: 'Online', long: 'Online regular', icon: '💻' }),
  Master: Object.freeze({ key: 'master', label: 'Master class', long: 'Master class', icon: '⭐' })
});
export function classModeLabel(mode) { const m = CLASS_MODE_META[mode]; return m ? m.icon + ' ' + m.label : String(mode || ''); }
export const STUDENT_STATUSES = ['active', 'paused', 'left'];

export function slotId(dayCode, n) { return dayCode + '-' + n; }
export function slotParts(id) {
  const [code, n] = String(id || '').split('-');
  const day = DAYS.find(d => d.code === code) || null;
  const time = day ? (day.times.find(t => String(t.n) === String(n)) || null) : null;
  return { day, time, code, n };
}
export function slotLabel(id) {
  const { day, time } = slotParts(id);
  return day && time ? day.name + ' ' + time.label : String(id || '');
}
export function slotShortLabel(id) {
  const { day, time } = slotParts(id);
  if (!day || !time) return String(id || '');
  return day.short + ' ' + time.label.split(/\s*[–—-]\s*/)[0];
}
export function isValidSlotId(id) { const p = slotParts(id); return !!(p.day && p.time); }
export function allSlotIds() {
  const out = [];
  DAYS.forEach(d => d.times.forEach(t => out.push(slotId(d.code, t.n))));
  return out;
}
// '3:00pm – 4:45pm' → 900 (minutes after midnight). Unreadable → end of day.
export function timeStartMin(label) {
  const m = String(label || '').match(/(\d{1,2}):(\d{2})\s*([ap])\.?m/i);
  if (!m) return 24 * 60;
  return (Number(m[1]) % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + Number(m[2]);
}
// The schedule page's timetable model: one row per distinct lesson time,
// earliest first (Saturday mornings above the weekday after-school lessons),
// each holding the slot every day runs at that time.
export function timetableRows() {
  const rows = [];
  DAYS.forEach(day => day.times.forEach(t => {
    let row = rows.find(r => r.label === t.label);
    if (!row) { row = { label: t.label, start: timeStartMin(t.label), cells: {} }; rows.push(row); }
    row.cells[day.code] = { id: slotId(day.code, t.n), day, time: t };
  }));
  return rows.sort((a, b) => a.start - b.start);
}

/* ── Fees — the schedule page's own pricing rule ──
   A fee left blank means "not set". A slot can carry its own monthly fee per mode
   (fee = physical, feeOnline = online); otherwise the page-wide defaults apply.
   The Master Class is physical only and has its own default. A blank Online
   price falls back to the Physical one. */
export function feeNum(v) { const n = parseFloat(v); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; }
export function isMaster(slot) { return !!slot && slot.type === 'master'; }
export function slotModeSetting(slot) { return isMaster(slot) ? 'Physical' : (slot && slot.mode) || 'Physical'; }
export function slotModes(slot) {
  const m = slot ? slotModeSetting(slot) : '';
  return m === 'Both' ? ['Physical', 'Online'] : [m === 'Online' ? 'Online' : 'Physical'];
}
export function monthlyFeeFor(slot, mode, config) {
  const cfg = config || {};
  const own = k => (slot ? feeNum(slot[k]) : 0);
  if (isMaster(slot)) return own('fee') || feeNum(cfg.masterMonthlyFee);
  const phys = own('fee') || feeNum(cfg.monthlyFee);
  // A regular slot taken as a Master class: the schedule's Master Class fee.
  if (mode === 'Master') return feeNum(cfg.masterMonthlyFee) || phys;
  if ((mode || slotModes(slot)[0]) === 'Online') return own('feeOnline') || feeNum(cfg.monthlyFeeOnline) || phys;
  return phys;
}
// The slot as the office reads it: always an object, with the defaults the
// schedule page's admin editor assumes for a slot nobody has touched.
export function scheduleSlot(schedule, id) {
  const src = (schedule && schedule.slots) || {};
  return Object.assign({ level: '', subject: '', mode: 'Both', status: 'closed', note: '', type: 'regular', fee: '', feeOnline: '' }, src[id] || {});
}
export function slotHasClass(slot) { return !!slot && !!slot.level && !!slot.subject; }
// The options a child has for one slot: a Master Class slot only as a Master
// class; a regular slot in the modes it runs, or as a Master class.
export function slotClassModes(slot) { return isMaster(slot) ? ['Master'] : [...slotModes(slot), 'Master']; }
// How a child takes a class, as the office reads it.
export function classMode(cls, schedule) {
  const c = cls || {};
  if (!c.custom && c.slotId && isMaster(scheduleSlot(schedule, c.slotId))) return 'Master';
  return CLASS_MODES.includes(c.mode) ? c.mode : 'Physical';
}
export function classModeKey(cls, schedule) { return CLASS_MODE_META[classMode(cls, schedule)].key; }
export function slotTitle(slot) {
  if (!slotHasClass(slot)) return 'No class';
  return (isMaster(slot) ? 'Master Class · ' : '') + levelLabel(slot.level) + ' ' + slot.subject;
}
export function levelLabel(level) {
  const v = String(level || '').trim();
  if (/^P[1-6]$/i.test(v)) return 'P' + v.slice(1);
  if (/^S(ec)?\s*\d$/i.test(v)) return 'Sec ' + v.replace(/\D/g, '');
  return v;
}
export function normalizeLevel(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/\./g, '');
  if (!v) return '';
  let m = v.match(/^(?:p|pri|primary)\s*([1-6])\b/);
  if (m) return 'P' + m[1];
  m = v.match(/^(?:s|sec|secondary)\s*([1-4])\b/);
  if (m) return 'S' + m[1];
  m = v.match(/^([1-6])$/);
  if (m) return 'P' + m[1];
  return String(raw || '').trim().toUpperCase();
}
export function subjectKey(subject) {
  const s = String(subject || '').toLowerCase();
  if (s.startsWith('math')) return 'math';
  if (s.startsWith('sci')) return 'science';
  return s ? 'other' : '';
}

/* ─────────────────────────── Money and dates ─────────────────────────── */
export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
export function money(n) {
  const v = round2(n);
  const sign = v < 0 ? '-' : '';
  return sign + '$' + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export function moneyPlain(n) { return round2(n).toFixed(2); }
// "S$1,234.50", "1234.5", "(12.00)", "12.00 CR", "-5" → numbers. Blank → NaN.
export function parseMoney(v) {
  if (typeof v === 'number') return isFinite(v) ? round2(v) : NaN;
  let s = String(v == null ? '' : v).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\bDR\b/i.test(s)) neg = true;
  s = s.replace(/\b(CR|DR|SGD|S\$)\b/gi, '').replace(/[S$\s,]/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = round2(parseFloat(s));
  return neg ? -n : n;
}
export function sameMoney(a, b) { return Math.abs(round2(a) - round2(b)) < 0.005; }

export const SG_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3).toUpperCase());

// Singapore's calendar day as YYYY-MM-DD, whatever the device's time zone says.
export function sgDayKey(now) {
  const t = now == null ? Date.now() : (now instanceof Date ? now.getTime() : Number(now));
  return new Date(t + SG_UTC_OFFSET_MS).toISOString().slice(0, 10);
}
export function sgMonthKey(now) { return sgDayKey(now).slice(0, 7); }
export function isDayKey(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
export function isPeriod(v) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || '')); }
export function dayKeyTime(key) { const p = String(key).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
export function addDays(key, n) { return new Date(dayKeyTime(key) + n * DAY_MS).toISOString().slice(0, 10); }
export function daysBetween(fromKey, toKey) { return Math.round((dayKeyTime(toKey) - dayKeyTime(fromKey)) / DAY_MS); }
export function addMonths(period, n) {
  const [y, m] = String(period).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function periodLabel(period) {
  if (!isPeriod(period)) return String(period || '');
  const [y, m] = period.split('-').map(Number);
  return MONTHS[m - 1] + ' ' + y;
}
export function periodShort(period) {
  const [y, m] = String(period).split('-').map(Number);
  return MONTHS_SHORT[m - 1] + String(y).slice(2);
}
export function periodFromShort(mon, yy) {
  const i = MONTHS_SHORT.indexOf(String(mon || '').toUpperCase());
  if (i < 0) return '';
  const y = 2000 + Number(yy);
  return y + '-' + String(i + 1).padStart(2, '0');
}
export function daysInMonth(period) {
  const [y, m] = String(period).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
// The day of the month invoices go out on, clamped to the month (31 → 30 in November).
export function issueDayKey(period, invoiceDay) {
  const d = Math.min(Math.max(1, Math.round(Number(invoiceDay) || 1)), daysInMonth(period));
  return period + '-' + String(d).padStart(2, '0');
}
export function prettyDate(key) {
  if (!isDayKey(key)) return String(key || '');
  const [y, m, d] = key.split('-').map(Number);
  return d + ' ' + MONTHS[m - 1].slice(0, 3) + ' ' + y;
}
export function prettyDateShort(key) {
  if (!isDayKey(key)) return String(key || '');
  const [, m, d] = key.split('-').map(Number);
  return d + ' ' + MONTHS[m - 1].slice(0, 3);
}
// Dates the way bank statements print them. `hintYear` fills in a missing year;
// a "31 Dec" read from a January statement belongs to the year before.
export function parseDateLoose(input, hintYear, hintMonth) {
  if (input instanceof Date && !isNaN(input)) {
    // A spreadsheet date cell is midnight LOCAL time on the computer that read it.
    return input.getFullYear() + '-' + String(input.getMonth() + 1).padStart(2, '0') + '-' + String(input.getDate()).padStart(2, '0');
  }
  if (typeof input === 'number' && input > 20000 && input < 80000) {
    // An Excel serial day number (days since 1899-12-30).
    return new Date(Date.UTC(1899, 11, 30) + Math.round(input) * DAY_MS).toISOString().slice(0, 10);
  }
  const s = String(input == null ? '' : input).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return fmtYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]*(\d{2,4})?/);
  if (m) {
    const mon = monthIndex(m[2]);
    if (mon >= 0) return fmtYmd(yearFrom(m[3], hintYear, hintMonth, mon + 1), mon + 1, +m[1]);
  }
  m = s.match(/^([A-Za-z]{3,9})[ .-]+(\d{1,2})(?:,?\s*(\d{2,4}))?/);
  if (m) {
    const mon = monthIndex(m[1]);
    if (mon >= 0) return fmtYmd(yearFrom(m[3], hintYear, hintMonth, mon + 1), mon + 1, +m[2]);
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/);
  if (m) return fmtYmd(yearFrom(m[3], hintYear, hintMonth, +m[2]), +m[2], +m[1]);   // Singapore writes day first
  return '';
}
function monthIndex(word) { return MONTHS_SHORT.indexOf(String(word || '').slice(0, 3).toUpperCase()); }
function yearFrom(raw, hintYear, hintMonth, month) {
  if (raw) { const n = Number(raw); return n < 100 ? 2000 + n : n; }
  const y = Number(hintYear) || new Date().getUTCFullYear();
  if (hintMonth && month && month - Number(hintMonth) > 6) return y - 1;   // "Dec" on a January statement
  return y;
}
function fmtYmd(y, m, d) {
  if (!(y > 1990 && y < 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return '';
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/* ─────────────────────────── Text ─────────────────────────── */
export function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Lower-case letters and digits, single spaces. "TAN  Shy-Woan (Mdm)" → "tan shy woan mdm".
export function normText(v) {
  return String(v == null ? '' : v).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const NAME_NOISE = new Set(['mr', 'mrs', 'ms', 'mdm', 'miss', 'dr', 'the', 'and', 'bin', 'binte', 'binti', 'bte', 'a', 'o', 'd', 's', 'al', 'ap', 'de', 'sgd', 'pte', 'ltd']);
export function nameTokens(v) {
  return normText(v).split(' ').filter(t => t.length >= 2 && !NAME_NOISE.has(t) && !/^\d+$/.test(t));
}
export function firstName(full) {
  const t = String(full || '').trim().split(/\s+/);
  return t[0] || '';
}
export function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
export function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
export function listJoin(items) {
  const a = (items || []).filter(Boolean);
  if (a.length <= 1) return a.join('');
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

/* ── Phone numbers and emails ──
   WhatsApp needs the full international number with no '+'. An 8-digit number
   starting 3/6/8/9 is a Singapore number and gets 65 in front. */
export function normalizeWhatsapp(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8 && /^[3689]/.test(d)) return '65' + d;
  if (d.length === 10 && d.startsWith('65')) return d;
  return d.length >= 8 ? d : '';
}
export function displayPhone(norm) {
  const d = String(norm || '');
  if (d.length === 10 && d.startsWith('65')) return '+65 ' + d.slice(2, 6) + ' ' + d.slice(6);
  return d ? '+' + d : '';
}
export function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()); }
export function cleanEmail(v) { return String(v || '').trim().toLowerCase(); }
// A cell may hold two addresses ("a@x.com / b@y.com"); every one is kept.
export function splitEmails(v) {
  return String(v || '').split(/[\s,;/]+/).map(cleanEmail).filter(isEmail).filter((e, i, a) => a.indexOf(e) === i);
}

/* ─────────────────────────── 2. Reference codes ───────────────────────────
   One permanent code per family, from the products page's own alphabet (no I,
   L, O, 0 or 1, so nothing can be misread off a phone screen). Every code has at
   least one letter AND at least one digit: that is what makes it safe to spot a
   bare code inside a bank line — no English word or surname can ever be one. */
export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const REF_PREFIX = 'PLC';
const CODE_RE_SRC = '[' + CODE_CHARS + ']{' + CODE_LENGTH + '}';
export function isCode(v) {
  const s = String(v || '');
  return new RegExp('^' + CODE_RE_SRC + '$').test(s) && /\d/.test(s) && /[A-Z]/.test(s);
}
// `random(n)` returns n random 32-bit integers (crypto.getRandomValues in the
// browser, crypto.randomBytes in Node); `taken` is the set of codes in use.
export function newCode(random, taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = random(CODE_LENGTH);
    const code = Array.from(r, n => CODE_CHARS[n % CODE_CHARS.length]).join('');
    if (isCode(code) && !used.has(code)) return code;
  }
  throw new Error('Could not find a free reference code.');
}
export function newToken(random, length = 24) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(random(length), n => chars[n % chars.length]).join('');
}
export function familyReference(code) { return REF_PREFIX + ' ' + code; }
export function invoiceReference(code, period) { return REF_PREFIX + ' ' + code + ' ' + periodShort(period); }
export function invoiceNumber(code, period) { return REF_PREFIX + '-' + String(period).slice(2, 4) + String(period).slice(5, 7) + '-' + code; }
export function invoiceDocId(familyId, period) { return familyId + '_' + period; }
// Every family code that appears in a bank line, with the invoice month when it
// is printed after the code ("PLC K7M2QX NOV26"). Banks squeeze, truncate and
// re-space references, so the search runs on the text with the spaces taken out
// AND on whole tokens; only codes that belong to a family count.
export function findCodes(text, knownCodes) {
  const known = knownCodes instanceof Set ? knownCodes : new Set(knownCodes || []);
  const raw = String(text || '').toUpperCase();
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  const found = new Map();
  const add = (code, after) => {
    if (!known.has(code)) return;
    const pm = String(after || '').match(/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})/);
    const period = pm ? periodFromShort(pm[1], pm[2]) : '';
    const prev = found.get(code);
    if (!prev || (!prev.period && period)) found.set(code, { code, period });
  };
  const withPrefix = new RegExp(REF_PREFIX + '(' + CODE_RE_SRC + ')', 'g');
  let m;
  while ((m = withPrefix.exec(compact))) add(m[1], compact.slice(m.index + REF_PREFIX.length + CODE_LENGTH));
  // A bare code as its own word (the bank kept the code but dropped "PLC").
  const tokens = raw.split(/[^A-Z0-9]+/);
  tokens.forEach((t, i) => {
    if (t.length === CODE_LENGTH && isCode(t)) add(t, (tokens[i + 1] || '') + (tokens[i + 2] || ''));
    // "PLCK7M2QX" glued, or "K7M2QXNOV26" glued on the other side.
    if (t.length > CODE_LENGTH && t.startsWith(REF_PREFIX)) add(t.slice(3, 3 + CODE_LENGTH), t.slice(3 + CODE_LENGTH));
    if (t.length === CODE_LENGTH + 5 && isCode(t.slice(0, CODE_LENGTH))) add(t.slice(0, CODE_LENGTH), t.slice(CODE_LENGTH));
  });
  return Array.from(found.values());
}

/* ─────────────────────────── 3. PayNow SGQR ───────────────────────────
   Byte for byte products/index.html's encoder: a static PayNow QR to the
   centre's UEN, the amount NOT editable (01 = 2 means "UEN"; 03 = 0 means the
   payer cannot change the amount), the reference in the bill-number field 62/05.
   The amount and the reference are therefore filled in for the parent.
   opts.editable (a "generic" QR) is the one exception: 03 = 1, so the parent
   types the amount in their banking app, and with no amount there is no tag 54
   at all — the centre's UEN and the reference are still filled in. */
export function tlv(tag, value) { return tag + String(value.length).padStart(2, '0') + value; }
export function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) { crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1; crc &= 0xFFFF; }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
export function cleanRef(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25); }
export function buildPayNow(amount, reference, opts) {
  const o = opts || {};
  const uen = o.uen || PAYNOW_UEN;
  const merchant = (o.merchant || MERCHANT_NAME).slice(0, 25);
  const editable = !!o.editable;
  const amt = Number(amount);
  const withAmount = !editable || (isFinite(amt) && amt > 0);
  const mai = tlv('00', 'SG.PAYNOW') + tlv('01', '2') + tlv('02', uen) + tlv('03', editable ? '1' : '0');
  const p = tlv('00', '01') + tlv('01', editable && !withAmount ? '11' : '12') + tlv('26', mai) + tlv('52', '0000') + tlv('53', '702')
    + (withAmount ? tlv('54', amt.toFixed(2)) : '') + tlv('58', 'SG') + tlv('59', merchant) + tlv('60', 'Singapore')
    + tlv('62', tlv('05', cleanRef(reference) || 'POLYMATH')) + '6304';
  return p + crc16(p);
}
// Reads a payload back into its fields (used by the tests and the QR self-check).
export function readPayNow(payload) {
  const out = {};
  const walk = (s, into) => {
    let i = 0;
    while (i + 4 <= s.length) {
      const tag = s.slice(i, i + 2), len = Number(s.slice(i + 2, i + 4));
      const val = s.slice(i + 4, i + 4 + len);
      into[tag] = val;
      i += 4 + len;
    }
  };
  walk(String(payload || ''), out);
  const mai = {}; walk(out['26'] || '', mai);
  const add = {}; walk(out['62'] || '', add);
  const body = String(payload || '').slice(0, -4);
  return {
    amount: Number(out['54'] || 0), uen: mai['02'] || '', editable: mai['03'] === '1', merchant: out['59'] || '',
    reference: add['05'] || '', crcOk: crc16(body) === String(payload || '').slice(-4)
  };
}
export function qrFileName(reference) { return 'PayNow-' + cleanRef(reference).replace(/\s+/g, '-') + '.png'; }

/* ─────────────────────────── 4. Families, students, invoices ─────────────────────────── */
export function normalizeStudent(raw) {
  const s = Object.assign({ id: '', name: '', level: '', school: '', status: 'active', startDate: '', classes: [], monthlyFee: '', notes: '' }, raw || {});
  s.name = String(s.name || '').trim();
  s.school = String(s.school || '').trim();
  s.notes = String(s.notes || '');
  // v1.9.0: no "type of lesson" per child — each class says physical, online
  // or Master class, and a Master Class slot always reads as a Master class.
  // An older stored choice is dropped: online / physical had already been set
  // on the classes, so nothing it said is lost, and billing does not change.
  delete s.lessonType;
  if (s.startDate && !isDayKey(s.startDate)) s.startDate = parseDateLoose(s.startDate) || '';
  s.level = normalizeLevel(s.level);
  if (!STUDENT_STATUSES.includes(s.status)) s.status = 'active';
  s.classes = (Array.isArray(s.classes) ? s.classes : []).map(c => Object.assign({ slotId: '', mode: 'Physical', rate: '', custom: false, label: '' }, c || {}))
    .filter(c => (c.custom ? (c.label || feeNum(c.rate)) : isValidSlotId(c.slotId)));
  s.classes.forEach(c => { if (!CLASS_MODES.includes(c.mode)) c.mode = 'Physical'; });
  return s;
}
export function normalizeFamily(raw) {
  const f = Object.assign({
    id: '', code: '', parentName: '', email: '', email2: '', whatsapp: '', address: '', signUpDate: '', notes: '',
    status: 'active', payerNames: [], credit: 0, discount: null, students: [], preferWhatsapp: false,
    paidMonths: [], screenshots: [],
    hardcopy: false, paymentType: 'monthly', packageStart: '', packageEnd: '', withdrawn: false, lastMonth: '',
    pauseFrom: '', pauseUntil: ''
  }, raw || {});
  f.parentName = String(f.parentName || '').trim();
  f.email = cleanEmail(f.email);
  f.email2 = cleanEmail(f.email2);
  f.whatsapp = normalizeWhatsapp(f.whatsapp);
  f.payerNames = (Array.isArray(f.payerNames) ? f.payerNames : []).map(normText).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  f.credit = Math.max(0, round2(f.credit));
  f.students = (Array.isArray(f.students) ? f.students : []).map(normalizeStudent);
  if (f.discount && !(feeNum(f.discount.value) > 0)) f.discount = null;
  f.paidMonths = normalizePaidMonths(f.paidMonths);
  f.screenshots = normalizeScreenshots(f.screenshots);
  // Hardcopy subscription (posted to `address`), how the family pays, and withdrawal.
  f.hardcopy = f.hardcopy === true || f.hardcopy === 'yes';
  f.address = String(f.address || '').trim();
  f.paymentType = PAYMENT_TYPE_KEYS.includes(f.paymentType) ? f.paymentType : 'monthly';
  f.packageStart = isDayKey(f.packageStart) ? f.packageStart : (parseDateLoose(f.packageStart) || '');
  f.packageEnd = isDayKey(f.packageEnd) ? f.packageEnd : (parseDateLoose(f.packageEnd) || '');
  const monthOf = v => isPeriod(v) ? v : (isDayKey(v) ? v.slice(0, 7) : '');
  f.lastMonth = monthOf(f.lastMonth);
  f.pauseFrom = monthOf(f.pauseFrom);
  f.pauseUntil = monthOf(f.pauseUntil);
  // Status: active / paused / withdrawn (v1.8.0). The older "Not active"
  // ('inactive') reads as withdrawn, and so does the older Withdrawal = Yes;
  // `withdrawn` is kept in step with the status for anything that reads it.
  const was = String(f.status || '').toLowerCase();
  const wd = f.withdrawn === true || f.withdrawn === 'yes';
  f.status = FAMILY_STATUS_KEYS.includes(was) ? was : (was === 'inactive' ? 'withdrawn' : 'active');
  if (wd && f.status === 'active') f.status = 'withdrawn';
  f.withdrawn = f.status === 'withdrawn';
  if (f.status !== 'paused') { f.pauseFrom = ''; f.pauseUntil = ''; }
  return f;
}
export function familyEmails(f) { return [f.email, f.email2].filter(isEmail).filter((e, i, a) => a.indexOf(e) === i); }
export function activeStudents(f) { return (f.students || []).filter(s => s.status === 'active'); }
// Billable at all; and, given a month, billable for THAT month: not after the
// last month of a family that has withdrawn, and not inside a paid package.
export function familyIsBillable(f, period) {
  if (!(f && activeStudents(f).length > 0)) return false;
  const n = normalizeFamily(f);
  if (familyStateIn(n, isPeriod(period) ? period : sgMonthKey()) !== 'active') return false;
  if (isPeriod(period) && packageCovers(n, period)) return false;
  return true;
}
/* ── Family status: active / paused / withdrawn ──
   Active: billed every month. Paused: tuition stopped for some months —
   from `pauseFrom` up to and including `pauseUntil` (no end month: paused
   until somebody changes it); those months are not invoiced, and the family
   is active again before and after them. Withdrawn: left the centre; with a
   `lastMonth` it is billed up to and including that month, without one it is
   not billed at all. familyStateIn() says which applies in a given month. */
export const FAMILY_STATUSES = Object.freeze([
  Object.freeze({ key: 'active', label: 'Active', icon: '✅', tone: 'green', help: 'Billed every month' }),
  Object.freeze({ key: 'paused', label: 'Paused', icon: '⏸', tone: 'amber', help: 'Not billed for the paused months' }),
  Object.freeze({ key: 'withdrawn', label: 'Withdrawn', icon: '👋', tone: 'grey', help: 'Not billed after the last month' })
]);
export const FAMILY_STATUS_KEYS = Object.freeze(FAMILY_STATUSES.map(x => x.key));
export function familyStatusMeta(key) { return FAMILY_STATUSES.find(x => x.key === key) || FAMILY_STATUSES[0]; }
export function familyStateIn(family, period) {
  const f = normalizeFamily(family);
  const p = isPeriod(period) ? period : sgMonthKey();
  if (f.status === 'withdrawn') return f.lastMonth && p <= f.lastMonth ? 'active' : 'withdrawn';
  if (f.status === 'paused') {
    if (f.pauseFrom && p < f.pauseFrom) return 'active';
    if (f.pauseUntil && p > f.pauseUntil) return 'active';
    return 'paused';
  }
  return 'active';
}
// A family still with the centre (active or paused) this month — not one that has left.
export function familyIsCurrent(family, period) { return familyStateIn(family, period) !== 'withdrawn'; }
export function pauseText(f) {
  if (!f || f.status !== 'paused') return '';
  const from = f.pauseFrom ? monthShort(f.pauseFrom) + ' ' + f.pauseFrom.slice(0, 4) : '';
  const to = f.pauseUntil ? monthShort(f.pauseUntil) + ' ' + f.pauseUntil.slice(0, 4) : '';
  if (from && to) return 'Paused ' + (from === to ? from : from + ' – ' + to);
  if (from) return 'Paused from ' + from;
  if (to) return 'Paused until ' + to;
  return 'Paused';
}
// "Active", "Paused Dec 2026 – Jan 2027", "Withdrawn · last month March 2027".
export function familyStatusText(f) {
  if (!f) return 'Active';
  if (f.status === 'paused') return pauseText(f);
  if (f.status === 'withdrawn') return withdrawalText(f);
  return 'Active';
}
export function familyDisplayName(f) {
  // Full names: in Chinese and Malay names the first word is not the given name.
  const kids = activeStudents(f).map(s => s.name).filter(Boolean);
  return (f.parentName || 'Parent') + (kids.length ? ' (' + kids.join(', ') + ')' : '');
}

// The invoice lines for one family in one month, priced from the live schedule.
// `issues` explains every line that could not be priced, so the review screen
// can say WHY a total looks wrong instead of letting $0 slip out to a parent.
export function buildInvoiceLines(family, schedule) {
  const f = normalizeFamily(family);
  const lines = [], issues = [];
  activeStudents(f).forEach(st => {
    const own = feeNum(st.monthlyFee);
    if (own) {
      // A student on a package or a special arrangement: one line, their own monthly total.
      const what = st.classes.map(c => c.custom ? c.label : slotTitle(scheduleSlot(schedule, c.slotId))).filter(Boolean);
      lines.push({ studentId: st.id, studentName: st.name, desc: 'Monthly tuition fees', detail: what.join(', '), amount: own, kind: 'student-fee' });
      return;
    }
    if (!st.classes.length) { issues.push(st.name + ' is not in any class yet.'); return; }
    st.classes.forEach(c => {
      if (c.custom) {
        const amount = feeNum(c.rate);
        lines.push({ studentId: st.id, studentName: st.name, desc: c.label || 'Lessons', detail: c.mode, amount, kind: 'custom' });
        if (!amount) issues.push(st.name + ': "' + (c.label || 'Lessons') + '" has no fee.');
        return;
      }
      const slot = scheduleSlot(schedule, c.slotId);
      const override = feeNum(c.rate);
      const amount = override || monthlyFeeFor(slot, c.mode, schedule);
      const desc = slotHasClass(slot) ? slotTitle(slot) : 'Class';
      lines.push({
        studentId: st.id, studentName: st.name, desc, detail: slotShortLabel(c.slotId) + ' · ' + CLASS_MODE_META[classMode(c, schedule)].label,
        amount, slotId: c.slotId, mode: classMode(c, schedule), kind: 'class', custom: !!override
      });
      if (!slotHasClass(slot)) issues.push(st.name + ': ' + slotLabel(c.slotId) + ' has no class in the schedule any more.');
      if (!amount) issues.push(st.name + ': no monthly fee is set for ' + slotTitle(slot) + ' (' + CLASS_MODE_META[classMode(c, schedule)].label + ') in the schedule.');
    });
  });
  return { lines, issues };
}

// One family's invoice for one month. Pure: the caller stores it (and, when
// `creditUsed` > 0, takes that much off the family's credit in the same write).
export function buildInvoice(family, period, ctx) {
  const c = ctx || {};
  const f = normalizeFamily(family);
  const settings = normalizeSettings(c.settings);
  const issueDate = c.issueDate || (isDayKey(c.today) && c.today.slice(0, 7) === period ? c.today : issueDayKey(period, settings.invoiceDay));
  const { lines, issues } = buildInvoiceLines(f, c.schedule || {});
  const subtotal = round2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  let running = subtotal;
  if (f.discount && subtotal > 0) {
    const d = f.discount;
    const off = d.kind === 'percent' ? round2(subtotal * Math.min(100, feeNum(d.value)) / 100) : Math.min(subtotal, feeNum(d.value));
    if (off > 0) {
      lines.push({ studentId: '', studentName: '', desc: d.label || 'Discount', detail: d.kind === 'percent' ? feeNum(d.value) + '% off' : '', amount: -off, kind: 'discount' });
      running = round2(running - off);
    }
  }
  let creditUsed = 0;
  if (f.credit > 0 && running > 0) {
    creditUsed = round2(Math.min(f.credit, running));
    lines.push({ studentId: '', studentName: '', desc: 'Credit from an earlier payment', detail: '', amount: -creditUsed, kind: 'credit' });
    running = round2(running - creditUsed);
  }
  const total = Math.max(0, running);
  return {
    id: invoiceDocId(f.id, period),
    familyId: f.id, period, code: f.code,
    number: invoiceNumber(f.code, period),
    reference: invoiceReference(f.code, period),
    parentName: f.parentName, emails: familyEmails(f), whatsapp: f.whatsapp,
    students: activeStudents(f).map(s => s.name),
    lines, subtotal, creditUsed, total, paid: 0,
    issueDate, dueDate: addDays(issueDate, settings.dueDays),
    status: 'draft', issues, payments: [], reminders: [], sends: []
  };
}
// After the admin edits lines on the review screen.
export function recomputeInvoice(inv) {
  const lines = (inv.lines || []).map(l => Object.assign({}, l, { amount: round2(l.amount) }));
  const total = Math.max(0, round2(lines.reduce((s, l) => s + l.amount, 0)));
  const subtotal = round2(lines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0));
  return Object.assign({}, inv, { lines, total, subtotal });
}
export function invoiceOutstanding(inv) {
  if (!inv || inv.status === 'void') return 0;
  return Math.max(0, round2((Number(inv.total) || 0) - (Number(inv.paid) || 0)));
}
// The ONE place an invoice's state is decided. Every screen colours from this.
export const STATE_META = {
  draft: { label: 'Not sent yet', tone: 'grey', icon: '📝' },
  waiting: { label: 'Waiting for payment', tone: 'amber', icon: '⏳' },
  part: { label: 'Part paid', tone: 'amber', icon: '◐' },
  overdue: { label: 'Overdue', tone: 'red', icon: '⚠️' },
  paid: { label: 'Paid', tone: 'green', icon: '✅' },
  void: { label: 'Cancelled', tone: 'grey', icon: '✕' },
  free: { label: 'Nothing to pay', tone: 'green', icon: '✅' }
};
export function invoiceState(inv, todayKey) {
  if (!inv) return Object.assign({ key: 'draft', daysOverdue: 0 }, STATE_META.draft);
  if (inv.status === 'void') return Object.assign({ key: 'void', daysOverdue: 0 }, STATE_META.void);
  const out = invoiceOutstanding(inv);
  if (!(Number(inv.total) > 0)) return Object.assign({ key: 'free', daysOverdue: 0 }, STATE_META.free);
  if (out <= 0) return Object.assign({ key: 'paid', daysOverdue: 0 }, STATE_META.paid);
  const sent = !!inv.sentAt || (inv.sends || []).length > 0;
  if (!sent && !(Number(inv.paid) > 0)) return Object.assign({ key: 'draft', daysOverdue: 0 }, STATE_META.draft);
  const today = todayKey || sgDayKey();
  const late = isDayKey(inv.dueDate) && today > inv.dueDate ? daysBetween(inv.dueDate, today) : 0;
  if (late > 0) return Object.assign({ key: 'overdue', daysOverdue: late }, STATE_META.overdue, Number(inv.paid) > 0 ? { label: 'Overdue · part paid' } : {});
  if (Number(inv.paid) > 0) return Object.assign({ key: 'part', daysOverdue: 0 }, STATE_META.part);
  return Object.assign({ key: 'waiting', daysOverdue: 0 }, STATE_META.waiting);
}
export function invoiceStatusField(inv) {
  if (!inv || inv.status === 'void') return 'void';
  if (invoiceOutstanding(inv) <= 0 && Number(inv.total) > 0) return 'paid';
  if (Number(inv.paid) > 0) return 'part';
  return (inv.sentAt || (inv.sends || []).length) ? 'sent' : 'draft';
}
// Totals for the Home page and the invoice list header.
export function periodSummary(invoices, todayKey) {
  const s = { count: 0, billed: 0, collected: 0, outstanding: 0, draft: 0, waiting: 0, overdue: 0, paid: 0, part: 0, families: new Set() };
  (invoices || []).forEach(inv => {
    if (!inv || inv.status === 'void') return;
    const st = invoiceState(inv, todayKey).key;
    s.count++;
    s.billed = round2(s.billed + (Number(inv.total) || 0));
    s.collected = round2(s.collected + Math.min(Number(inv.paid) || 0, Number(inv.total) || 0));
    s.outstanding = round2(s.outstanding + invoiceOutstanding(inv));
    if (st === 'draft') s.draft++;
    else if (st === 'waiting') s.waiting++;
    else if (st === 'overdue') s.overdue++;
    else if (st === 'part') s.part++;
    else if (st === 'paid' || st === 'free') s.paid++;
    s.families.add(inv.familyId);
  });
  s.families = s.families.size;
  s.percent = s.billed > 0 ? Math.round(s.collected / s.billed * 100) : 0;
  return s;
}
// What the parent's link shows — and nothing else. officeLinks is readable by
// anyone holding the 24-character token, so no email, phone or address goes in.
export function publicInvoiceDoc(inv, settings) {
  const st = normalizeSettings(settings);
  return {
    invoiceId: inv.id, number: inv.number, period: inv.period, periodLabel: periodLabel(inv.period),
    // A title only when the invoice has its own (a monthly one keeps "<Month> fees").
    title: inv.custom || String(inv.title || '').trim() ? invoiceTitle(inv) : '', custom: !!inv.custom, qrMode: invoiceQrMode(inv),
    parentName: inv.parentName,
    // The child's full name: the parent knows it, and a first word is often a surname.
    lines: (inv.lines || []).map(l => ({ studentName: String(l.studentName || ''), desc: l.desc, detail: l.detail || '', amount: round2(l.amount) })),
    total: round2(inv.total), paid: round2(inv.paid), outstanding: invoiceOutstanding(inv),
    reference: inv.reference, uen: st.uen, merchant: st.merchant,
    dueDate: inv.dueDate, issueDate: inv.issueDate,
    status: invoiceOutstanding(inv) <= 0 && inv.total > 0 ? 'paid' : (inv.status === 'void' ? 'void' : 'due'),
    centreWhatsapp: st.centreWhatsapp, note: String(inv.note || '').trim() || st.payNote || ''
  };
}

/* ─── The QR an invoice carries, and custom invoices ───
   Every invoice (monthly or custom) carries one of three QRs, chosen on the
   invoice itself and honoured everywhere it is shown — the office, the picture
   pasted into WhatsApp, the email and the parent's /pay page:
     exact    the amount still owed and the reference, both filled in (the default)
     generic  a PayNow QR to Polymath Learning Centre's UEN with the reference;
              the parent types the amount (for deposits, part payments, or a
              parent whose bank app will not take a fixed-amount QR)
     none     no QR at all (cash, cheque, or an invoice that is only a record) */
export const QR_MODES = ['exact', 'generic', 'none'];
export const QR_MODE_META = Object.freeze({
  exact: { label: 'PayNow QR with the amount filled in', hint: 'The amount still owed and the reference are filled in for the parent.', short: 'QR with amount' },
  generic: { label: 'Generic PayNow QR to Polymath Learning Centre', hint: 'Pays the centre\'s UEN with the reference filled in; the parent types the amount.', short: 'Generic QR' },
  none: { label: 'No QR on this invoice', hint: 'Nothing to scan — for cash, cheque, or a record of something already arranged.', short: 'No QR' }
});
export function invoiceQrMode(inv) {
  const m = inv && inv.qrMode;
  return QR_MODES.includes(m) ? m : 'exact';
}
// What the invoice is for, in a few words: a custom invoice's own title, or the month's fees.
export function invoiceTitle(inv) {
  const t = String((inv && inv.title) || '').trim();
  if (t) return t.slice(0, 120);
  return isPeriod(inv && inv.period) ? periodLabel(inv.period) + ' tuition fees' : 'Invoice';
}
// The PayNow payload to print on this invoice, or '' when there is none to show
// (nothing owed, cancelled, or the invoice says "no QR").
export function invoiceQrPayload(inv, settings) {
  const s = normalizeSettings(settings);
  const owe = invoiceOutstanding(inv);
  const mode = invoiceQrMode(inv);
  if (!(owe > 0) || mode === 'none') return '';
  if (mode === 'generic') return buildPayNow(0, inv.reference, { uen: s.uen, merchant: s.merchant, editable: true });
  return buildPayNow(owe, inv.reference, { uen: s.uen, merchant: s.merchant });
}
// The centre's own PayNow QR with nothing filled in but the UEN (and a
// reference if one is given) — the one to print on a poster or a notice.
export function genericPayNow(settings, reference) {
  const s = normalizeSettings(settings);
  return buildPayNow(0, reference || 'POLYMATH', { uen: s.uen, merchant: s.merchant, editable: true });
}

// A custom invoice's own short tag: 5 characters from the codes' alphabet, so
// it can never be mistaken for a 6-character family code inside a bank line.
export const CUSTOM_TAG_LENGTH = 5;
export function newCustomTag(random, taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  for (let attempt = 0; attempt < 200; attempt++) {
    const tag = Array.from(random(CUSTOM_TAG_LENGTH), n => CODE_CHARS[n % CODE_CHARS.length]).join('');
    if (/\d/.test(tag) && /[A-Z]/.test(tag) && !used.has(tag)) return tag;
  }
  throw new Error('Could not find a free invoice tag.');
}
export function customInvoiceDocId(tag) { return 'custom_' + tag; }
export function isCustomInvoiceId(id) { return /^custom_[A-Z0-9]{3,12}$/.test(String(id || '')); }
export function customInvoiceNumber(tag, issueDate) {
  const d = isDayKey(issueDate) ? issueDate : sgDayKey();
  return REF_PREFIX + '-' + d.slice(2, 4) + d.slice(5, 7) + '-' + tag;
}
// A family's custom invoice still starts with the family's code, so a payment
// with this reference is matched to the family like any other; the tag after it
// is not a month, so the payment is not pulled towards one month's invoice.
export function customInvoiceReference(tag, familyCode) {
  return cleanRef(REF_PREFIX + ' ' + (isCode(familyCode) ? familyCode + ' ' : '') + tag);
}
// A fresh custom invoice for the editor. `family` (optional) fills in the
// parent's name, contacts, code and children; every field stays editable.
export function blankCustomInvoice(ctx) {
  const c = ctx || {};
  const s = normalizeSettings(c.settings);
  const issueDate = isDayKey(c.today) ? c.today : sgDayKey();
  const tag = c.tag;
  const f = c.family ? normalizeFamily(c.family) : null;
  const kids = f ? activeStudents(f).map(st => st.name).filter(Boolean) : [];
  return {
    id: customInvoiceDocId(tag), tag, custom: true,
    familyId: f ? f.id : '', code: f ? f.code : '',
    parentName: f ? f.parentName : '',
    emails: f ? familyEmails(f).join(', ') : '',
    whatsapp: f && f.whatsapp ? displayPhone(f.whatsapp) : '',
    title: '',
    number: customInvoiceNumber(tag, issueDate),
    reference: customInvoiceReference(tag, f ? f.code : ''),
    issueDate, dueDate: addDays(issueDate, s.dueDays), period: issueDate.slice(0, 7),
    lines: [{ studentName: kids.length === 1 ? kids[0] : '', desc: '', detail: '', amount: '' }],
    note: '', qrMode: 'exact'
  };
}
// The editor's draft → the stored fields, or the reasons it cannot be saved.
// Used for new custom invoices AND for editing any invoice, monthly or custom.
export function invoiceFromDraft(draft) {
  const d = draft || {};
  const errors = [];
  const parentName = String(d.parentName || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!parentName) errors.push('Type the parent\'s name (who the invoice is for).');
  const emailText = Array.isArray(d.emails) ? d.emails.join(', ') : String(d.emails || '');
  const emails = splitEmails(emailText);
  const badEmails = emailText.split(/[\s,;/]+/).map(e => e.trim()).filter(Boolean).filter(e => !isEmail(e));
  if (badEmails.length) errors.push('This email does not look right: ' + badEmails[0]);
  const waText = String(d.whatsapp || '').trim();
  const whatsapp = normalizeWhatsapp(waText);
  if (waText && !whatsapp) errors.push('The WhatsApp number does not look right.');
  const number = String(d.number || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!number) errors.push('Give the invoice a number.');
  const issueDate = String(d.issueDate || '');
  if (!isDayKey(issueDate)) errors.push('Choose the invoice date.');
  const dueDate = String(d.dueDate || '');
  if (!isDayKey(dueDate)) errors.push('Choose the due date.');
  else if (isDayKey(issueDate) && dueDate < issueDate) errors.push('The due date is before the invoice date.');
  const period = isPeriod(d.period) ? d.period : (isDayKey(issueDate) ? issueDate.slice(0, 7) : sgMonthKey());
  const qrMode = QR_MODES.includes(d.qrMode) ? d.qrMode : 'exact';
  const reference = cleanRef(d.reference);
  if (qrMode !== 'none' && !reference) errors.push('Give the PayNow reference (it is how the payment is matched).');
  const lines = [];
  (d.lines || []).forEach((l, i) => {
    const desc = String(l.desc || '').trim().slice(0, 160);
    const studentName = String(l.studentName || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const detail = String(l.detail || '').trim().slice(0, 160);
    const rawAmt = l.amount;
    const blankAmt = rawAmt === '' || rawAmt == null;
    if (!desc && !studentName && !detail && (blankAmt || Number(rawAmt) === 0)) return;   // an empty row is just dropped
    const amount = blankAmt ? 0 : parseMoney(rawAmt);
    if (!isFinite(amount)) { errors.push('Line ' + (i + 1) + ': the amount is not a number.'); return; }
    if (!desc) errors.push('Line ' + (i + 1) + ': say what it is for.');
    lines.push(Object.assign({}, l, { studentName, desc, detail, amount: round2(amount), kind: l.kind || 'custom' }));
  });
  if (!lines.length) errors.push('Add at least one line.');
  const sum = round2(lines.reduce((s, l) => s + l.amount, 0));
  if (lines.length && !(sum > 0)) errors.push('The total must be more than $0.00.');
  const total = Math.max(0, sum);
  const subtotal = round2(lines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0));
  const students = lines.map(l => l.studentName).filter(Boolean).filter((n, i, a) => a.indexOf(n) === i);
  const fields = {
    parentName, emails, whatsapp, number, reference: reference || cleanRef(number), issueDate, dueDate, period,
    title: String(d.title || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    note: String(d.note || '').trim().slice(0, 600),
    qrMode, lines, total, subtotal, students, issues: []
  };
  return { ok: !errors.length, errors, fields };
}
// An existing invoice with the editor's fields laid over it: the money already
// received stays, and the state follows the new total.
export function applyInvoiceEdit(inv, fields) {
  const next = Object.assign({}, inv, fields);
  next.status = inv.status === 'void' ? 'void' : invoiceStatusField(next);
  return next;
}
// The editor's starting point for an invoice that already exists.
export function draftFromInvoice(inv) {
  return {
    id: inv.id, custom: !!inv.custom, familyId: inv.familyId || '', code: inv.code || '',
    parentName: inv.parentName || '', emails: (inv.emails || []).join(', '),
    whatsapp: inv.whatsapp ? displayPhone(inv.whatsapp) : '',
    title: inv.title || '', number: inv.number || '', reference: inv.reference || '',
    issueDate: inv.issueDate || '', dueDate: inv.dueDate || '', period: inv.period || '',
    lines: (inv.lines || []).map(l => Object.assign({}, l)), note: inv.note || '', qrMode: invoiceQrMode(inv),
    ownContacts: !!inv.ownContacts
  };
}
export function payLink(token, opts) {
  const o = opts || {};
  return (o.base || PAY_URL) + '?i=' + encodeURIComponent(token) + (o.save ? '&save=1' : '');
}

/* ─────────────────────────── Settings ─────────────────────────── */
export const DEFAULT_SETTINGS = Object.freeze({
  invoiceDay: 1,               // the day of the month invoices go out
  dueDays: 7,                  // days to pay after the invoice date
  reminderGapDays: 5,          // never remind the same invoice twice within this many days
  autopilot: 'off',            // 'off' | 'review' (prepare + tell the admin) | 'send' (prepare + email parents)
  uen: PAYNOW_UEN,
  merchant: MERCHANT_NAME,
  fromName: SENDER_NAME,
  replyTo: SENDER_EMAIL,
  copyAdmin: false,            // bcc the reply-to address on every parent email
  receipts: true,              // email a receipt when a payment is matched
  signature: 'Mr Chung\nPolymath Learning Centre',
  invoiceNote: 'Thank you for learning with us!',
  reminderNote: 'If you have already paid, thank you, and please ignore this message.',
  payNote: '',
  centreWhatsapp: CENTRE_WHATSAPP,
  useAi: true
});
export function normalizeSettings(raw) {
  const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  s.invoiceDay = Math.min(28, Math.max(1, Math.round(Number(s.invoiceDay) || 1)));
  s.dueDays = Math.min(60, Math.max(0, Math.round(Number(s.dueDays) || 0)));
  s.reminderGapDays = Math.min(60, Math.max(1, Math.round(Number(s.reminderGapDays) || 5)));
  if (!['off', 'review', 'send'].includes(s.autopilot)) s.autopilot = 'off';
  s.uen = String(s.uen || PAYNOW_UEN).trim().toUpperCase() || PAYNOW_UEN;
  s.merchant = String(s.merchant || MERCHANT_NAME).trim().toUpperCase().slice(0, 25) || MERCHANT_NAME;
  s.replyTo = isEmail(s.replyTo) ? cleanEmail(s.replyTo) : SENDER_EMAIL;
  s.fromName = String(s.fromName || SENDER_NAME).trim() || SENDER_NAME;
  s.centreWhatsapp = normalizeWhatsapp(s.centreWhatsapp) || CENTRE_WHATSAPP;
  return s;
}

/* ─────────────────────────── 5. Bank statements ─────────────────────────── */
// A transaction's fingerprint: the same credit read from two overlapping
// statements (or the same file uploaded twice) gets the same key, which is what
// stops a payment being counted twice. Built from what the BANK printed.
export function txKey(tx) {
  const desc = normText([tx.description, tx.reference, tx.payer].join(' ')).replace(/\s+/g, '').slice(0, 60);
  let h = 2166136261;
  for (let i = 0; i < desc.length; i++) { h ^= desc.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (tx.date || 'nodate') + '_' + moneyPlain(tx.amount).replace('.', '') + '_' + h.toString(36);
}

// Column names banks (and people) give their spreadsheet exports.
const COL_SYNONYMS = {
  date: ['transaction date', 'date', 'value date', 'posting date', 'txn date', 'trans date', 'book date', 'effective date'],
  credit: ['credit amount', 'credit', 'deposit', 'deposits', 'money in', 'amount in', 'cr', 'credit sgd', 'deposit amount', 'paid in'],
  debit: ['debit amount', 'debit', 'withdrawal', 'withdrawals', 'money out', 'amount out', 'dr', 'debit sgd', 'withdrawal amount', 'paid out'],
  amount: ['amount', 'transaction amount', 'amount sgd', 'sgd amount', 'value'],
  description: ['description', 'transaction description', 'details', 'transaction details', 'particulars', 'narrative', 'remarks', 'transaction type', 'type'],
  reference: ['reference', 'transaction ref1', 'transaction ref2', 'transaction ref3', 'ref1', 'ref2', 'ref3', 'client reference', 'payment details', 'other party reference', 'additional reference', 'bill reference', 'reference no'],
  payer: ['payer', 'payer name', 'counterparty', 'other party', 'counter party', 'sender', 'from', 'remitter', 'name'],
  balance: ['balance', 'running balance', 'ledger balance', 'available balance']
};
function colKind(header) {
  const h = normText(header);
  if (!h) return '';
  for (const kind of Object.keys(COL_SYNONYMS)) if (COL_SYNONYMS[kind].includes(h)) return kind;
  for (const kind of ['credit', 'debit', 'date', 'balance', 'reference', 'payer', 'description', 'amount']) {
    if (COL_SYNONYMS[kind].some(w => w.length > 3 && h.includes(w))) return kind;
  }
  return '';
}
// Rows from SheetJS (`sheet_to_json(ws, {header: 1, raw: true})`) → the credits.
// Returns null when no header row is recognisable, so the caller can ask ChatGPT.
export function parseStatementRows(rows, opts) {
  const o = opts || {};
  const table = (rows || []).map(r => Array.isArray(r) ? r : []);
  let headerAt = -1, cols = null, best = 0;
  for (let i = 0; i < Math.min(table.length, 40); i++) {
    const kinds = table[i].map(colKind);
    const score = (kinds.includes('date') ? 2 : 0) + (kinds.includes('credit') ? 2 : 0) + (kinds.includes('amount') ? 1 : 0)
      + (kinds.includes('description') || kinds.includes('reference') ? 1 : 0) + (kinds.includes('debit') ? 1 : 0);
    if (score > best && kinds.includes('date') && (kinds.includes('credit') || kinds.includes('amount'))) { best = score; headerAt = i; cols = kinds; }
  }
  if (headerAt < 0) return null;
  const idx = kind => cols.map((k, i) => k === kind ? i : -1).filter(i => i >= 0);
  const dateCol = idx('date')[0];
  const creditCol = idx('credit')[0];
  const debitCol = idx('debit')[0];
  const amountCol = idx('amount')[0];
  const textCols = [...idx('description'), ...idx('reference'), ...idx('payer')];
  const refCols = idx('reference'), payerCols = idx('payer');
  const hintYear = o.hintYear, hintMonth = o.hintMonth;
  const out = [];
  let last = null;
  for (let i = headerAt + 1; i < table.length; i++) {
    const r = table[i];
    if (!r.length || r.every(v => v === '' || v == null)) continue;
    const date = parseDateLoose(r[dateCol], hintYear, hintMonth);
    const text = textCols.map(c => r[c]).filter(v => v != null && String(v).trim()).map(v => String(v).trim()).join(' · ');
    if (!date) {
      // A wrapped description on the next row belongs to the row above.
      if (last && text) last.description = (last.description + ' · ' + text).trim();
      continue;
    }
    let amount = NaN;
    if (creditCol != null) amount = parseMoney(r[creditCol]);
    else if (amountCol != null) {
      const v = parseMoney(r[amountCol]);
      const deb = debitCol != null ? parseMoney(r[debitCol]) : NaN;
      amount = v > 0 && !(deb > 0) ? v : NaN;
    }
    if (!(amount > 0)) { last = null; continue; }
    last = {
      date, amount, description: text,
      reference: refCols.map(c => r[c]).filter(v => v != null && String(v).trim()).join(' · '),
      payer: payerCols.map(c => r[c]).filter(v => v != null && String(v).trim()).join(' · '),
      source: 'sheet'
    };
    out.push(last);
  }
  return { transactions: out.map(t => Object.assign(t, { key: txKey(t) })), headerRow: headerAt, columns: cols };
}

// Text out of a PDF, rebuilt into LINES from pdf.js' positioned items, with a
// column marker " | " wherever there is a wide gap — that is what lets both the
// quick reader below and ChatGPT tell the Deposit column from the Withdrawal one.
// `pages` = [[{str, x, y, w}], …] (y grows downwards).
export function pdfLines(pages) {
  const lines = [];
  (pages || []).forEach((items, pageNo) => {
    const rows = [];
    (items || []).filter(it => it && String(it.str || '').trim()).forEach(it => {
      let row = rows.find(r => Math.abs(r.y - it.y) <= 2.5);
      if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
      row.items.push(it);
    });
    rows.sort((a, b) => a.y - b.y).forEach(row => {
      row.items.sort((a, b) => a.x - b.x);
      let text = '', lastEnd = null;
      row.items.forEach(it => {
        const gap = lastEnd == null ? 0 : it.x - lastEnd;
        if (lastEnd != null) text += gap > 18 ? ' | ' : (gap > 1.5 ? ' ' : '');
        text += String(it.str);
        lastEnd = it.x + (Number(it.w) || String(it.str).length * 5);
      });
      lines.push({ page: pageNo + 1, y: row.y, text: text.replace(/\s+/g, ' ').trim(), items: row.items });
    });
  });
  return lines;
}
const MONEY_RE = /(?:^|[\s|])(\(?-?(?:S?\$)?\d{1,3}(?:,\d{3})*\.\d{2}\)?(?:\s?(?:CR|DR))?)(?=$|[\s|])/gi;
const DATE_START_RE = /^(\d{1,2}[ \-/.](?:[A-Za-z]{3,9}|\d{1,2})(?:[ \-/.]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/;
// The quick reader for PDF statements: no AI, so it is free and instant, and it
// is the fallback whenever ChatGPT is off or out of quota. It finds the column
// headings (Deposit / Credit / Withdrawal / Balance) by position, starts a new
// transaction at every line that opens with a date, and folds the lines under
// it (where DBS prints "OTHR PLC K7M2QX NOV26" and the payer's name) into it.
export function parseStatementLines(lines, opts) {
  const o = opts || {};
  const heads = { credit: null, debit: null, balance: null };
  const headWord = { credit: /\b(deposit|deposits|credit|credits|paid in|money in)\b/i, debit: /\b(withdrawal|withdrawals|debit|debits|paid out|money out)\b/i, balance: /\bbalance\b/i };
  const right = it => it.x + (Number(it.w) || String(it.str).length * 5);
  const out = [];
  let cur = null, prevBalance = null;
  const yearMatch = (lines || []).map(l => l.text).join(' ').match(/\b(20\d{2})\b/);
  const hintYear = o.hintYear || (yearMatch ? Number(yearMatch[1]) : undefined);
  (lines || []).forEach(line => {
    const items = line.items || [];
    // Column headings: remember where each column ENDS (amounts are right-aligned).
    if (/balance/i.test(line.text) && (/(deposit|credit)/i.test(line.text) || /(withdrawal|debit)/i.test(line.text))) {
      items.forEach(it => {
        for (const k of Object.keys(headWord)) if (headWord[k].test(it.str)) heads[k] = right(it);
      });
      return;
    }
    const dm = line.text.match(DATE_START_RE);
    const amounts = [];
    items.forEach(it => {
      const m = String(it.str).match(/^\(?-?(?:S?\$)?\d{1,3}(?:,\d{3})*\.\d{2}\)?(?:\s?(?:CR|DR))?$/i);
      if (m) amounts.push({ value: parseMoney(it.str), end: right(it), raw: it.str });
    });
    if (!items.length) {
      let mm; MONEY_RE.lastIndex = 0;
      while ((mm = MONEY_RE.exec(line.text))) amounts.push({ value: parseMoney(mm[1]), end: null, raw: mm[1] });
    }
    const date = dm ? parseDateLoose(dm[1], hintYear) : '';
    const textOnly = line.text.replace(DATE_START_RE, '').replace(MONEY_RE, ' ').replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (date && amounts.length) {
      let credit = NaN, balance = NaN;
      if (heads.credit != null && amounts.some(a => a.end != null)) {
        amounts.forEach(a => {
          const near = Object.keys(heads).filter(k => heads[k] != null)
            .map(k => ({ k, d: Math.abs(heads[k] - a.end) })).sort((x, y) => x.d - y.d)[0];
          if (near && near.d < 60) { if (near.k === 'credit') credit = a.value; if (near.k === 'balance') balance = a.value; }
        });
      } else if (amounts.length >= 2) {
        // No headings found: the last amount is the running balance; whether the
        // first one went IN is read from how the balance moved.
        const amt = amounts[0].value; balance = amounts[amounts.length - 1].value;
        if (prevBalance != null && sameMoney(prevBalance + amt, balance)) credit = amt;
      }
      // "Balance B/F 1,000.00" — the opening balance, not a transaction.
      if (amounts.length === 1 && /\b(balance|b\/f|brought forward|opening)\b/i.test(textOnly)) { prevBalance = amounts[0].value; cur = null; return; }
      if (isFinite(balance)) prevBalance = balance;
      cur = credit > 0 ? { date, amount: credit, description: textOnly, reference: '', payer: '', source: 'pdf', page: line.page } : null;
      if (cur) out.push(cur);
      return;
    }
    if (date && !amounts.length) { cur = null; return; }
    // A continuation line under a credit: more of its description.
    if (cur && textOnly && !/^(total|balance (b\/f|c\/f|brought|carried)|page \d)/i.test(textOnly)) {
      cur.description = (cur.description + ' · ' + textOnly).trim();
    }
  });
  return out.map(t => Object.assign(t, { key: txKey(t) }));
}

// ── ChatGPT, through the centre's own askOpenAi function (polymathlc/math) ──
export const AI_STATEMENT_SYSTEM = 'You read Singapore bank statements for a tuition centre and return strict JSON. You never invent transactions.';
export function statementPrompt(text, opts) {
  const o = opts || {};
  return [
    'Below is ' + (text ? 'the text of' : 'attached') + ' a Singapore bank statement' + (o.fileName ? ' ("' + o.fileName + '")' : '') + '.',
    'List EVERY money-IN transaction (deposits / credits, e.g. PayNow, FAST or GIRO transfers received). Leave out withdrawals, card spending, fees, interest, balance lines and totals.',
    'Reply with JSON only, in exactly this shape:',
    '{"credits":[{"date":"YYYY-MM-DD","amount":123.45,"payer":"","reference":"","description":""}],"from":"YYYY-MM-DD","to":"YYYY-MM-DD","bank":""}',
    'Rules:',
    '- amount: a positive number with no currency sign or commas.',
    '- payer: the name of the person or company who sent the money, exactly as printed, or "" if the statement does not show it.',
    '- reference: the payment reference / remarks / "OTHR" text exactly as printed (do NOT correct or complete it). Our references look like "PLC K7M2QX NOV26".',
    '- description: the whole transaction text as printed, all of its lines joined with " · ".',
    '- Statements print the day and month; take the year from the statement period.',
    text ? '\nSTATEMENT TEXT (columns are separated by " | "):\n' + String(text) : ''
  ].join('\n');
}
// Pulls the JSON out of whatever the model returned (it is asked for JSON mode,
// but a stray code fence or sentence must not throw the whole statement away).
export function parseAiJson(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch (e) { /* fall through */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* fall through */ } }
  return null;
}
// ChatGPT's list, checked against the statement it was read from. An amount that
// is not printed anywhere in the text is flagged `unverified` and is never matched
// automatically — a model that "helpfully" fills in a credit must not mark a
// family as paid.
export function cleanAiTransactions(json, sourceText, opts) {
  const o = opts || {};
  const list = Array.isArray(json && json.credits) ? json.credits : (Array.isArray(json) ? json : []);
  const hay = String(sourceText || '').replace(/[\s,]/g, '');
  const out = [];
  list.forEach(raw => {
    if (!raw) return;
    const amount = parseMoney(raw.amount);
    if (!(amount > 0)) return;
    const date = parseDateLoose(raw.date, o.hintYear) || '';
    const tx = {
      date, amount,
      payer: String(raw.payer || '').trim().slice(0, 120),
      reference: String(raw.reference || '').trim().slice(0, 140),
      description: String(raw.description || '').trim().slice(0, 400),
      source: 'ai'
    };
    if (sourceText) tx.unverified = !hay.includes(amount.toFixed(2));
    tx.key = txKey(tx);
    out.push(tx);
  });
  return out;
}
// The roster ChatGPT matches against: short ids, names and what is owed. No
// emails, phone numbers or addresses ever leave the browser.
export function rosterForAi(families, invoices) {
  const owing = new Map();
  (invoices || []).forEach(inv => {
    const out = invoiceOutstanding(inv);
    if (out > 0) { const a = owing.get(inv.familyId) || []; a.push(out); owing.set(inv.familyId, a); }
  });
  const ids = new Map();
  const roster = (families || []).map((f, i) => {
    const sid = 'F' + (i + 1);
    ids.set(sid, f.id);
    return {
      id: sid, parent: f.parentName, code: f.code,
      students: (f.students || []).map(s => s.name),
      bankNames: (f.payerNames || []).slice(0, 5),
      owes: (owing.get(f.id) || []).map(round2)
    };
  });
  return { roster, ids };
}
export function aiMatchPrompt(credits, roster) {
  return [
    'A tuition centre received these bank credits and needs to know which family each one is from.',
    'Families (id, parent, students, the names their bank has shown before, the amounts they owe, their reference code):',
    JSON.stringify(roster),
    'Credits not matched yet (id, date, amount, payer, reference, description):',
    JSON.stringify(credits),
    'Match a credit to a family only when the evidence is good: the payer\'s name is the parent, the other parent (same surname as a student), or a name that bank has shown before; the reference contains part of the family\'s code; or the payer name plus an exact owed amount agree.',
    'Reply with JSON only: {"matches":[{"tx":"T1","family":"F3","confidence":0.0,"why":"one short reason"}]}',
    'confidence is 0 to 1. Leave a credit out entirely when you are not at least 0.5 sure. Use only ids from the lists above; never invent one.'
  ].join('\n');
}

/* ─────────────────────────── 6. Matching ───────────────────────────
   Each credit gets a `match`:
     { familyId, how, confidence: 'high'|'medium'|'low', period, why, candidates }
   how = 'reference' (the family's code is in the bank line — certain),
         'alias'     (a payer name this family's bank has shown before — certain),
         'name+amount', 'name', 'amount', 'ai', 'manual'.
   'high' is ticked for applying automatically; everything else is a suggestion
   the admin ticks with one click. */
export function matchTransactions(transactions, families, invoices, opts) {
  const o = opts || {};
  const fams = (families || []).map(normalizeFamily);
  const byCode = new Map(fams.filter(f => f.code).map(f => [f.code, f]));
  const codes = new Set(byCode.keys());
  const owing = new Map();
  (invoices || []).forEach(inv => {
    const out = invoiceOutstanding(inv);
    if (out > 0) { const a = owing.get(inv.familyId) || []; a.push({ inv, out }); owing.set(inv.familyId, a); }
  });
  const totalOwed = id => round2((owing.get(id) || []).reduce((s, x) => s + x.out, 0));
  const amountFits = (id, amount) => {
    const list = owing.get(id) || [];
    return list.some(x => sameMoney(x.out, amount)) || sameMoney(totalOwed(id), amount);
  };
  const aliasIndex = [];
  fams.forEach(f => (f.payerNames || []).forEach(a => { if (a.length >= 4) aliasIndex.push({ alias: a, fam: f }); }));
  return (transactions || []).map(tx0 => {
    const tx = Object.assign({}, tx0);
    if (tx.match && tx.match.how === 'manual') return tx;
    const text = [tx.reference, tx.description, tx.payer].join(' ');
    const ntext = ' ' + normText(text) + ' ';
    const npayer = normText(tx.payer);
    // 1. Reference code.
    const hits = findCodes(text, codes);
    const famHits = [...new Set(hits.map(h => h.code))].map(c => byCode.get(c)).filter(Boolean);
    if (famHits.length === 1) {
      const h = hits.find(x => x.code === famHits[0].code);
      tx.match = { familyId: famHits[0].id, how: 'reference', confidence: 'high', period: h.period || '', why: 'Reference ' + familyReference(h.code) + (h.period ? ' ' + periodShort(h.period) : '') + ' is in the bank line', candidates: [] };
      return tx;
    }
    // 2. A payer name this family's bank has shown before.
    const aliasHits = aliasIndex.filter(a => (npayer && npayer === a.alias) || ntext.includes(' ' + a.alias + ' '));
    const aliasFams = [...new Set(aliasHits.map(a => a.fam.id))];
    if (aliasFams.length === 1) {
      tx.match = { familyId: aliasFams[0], how: 'alias', confidence: 'high', period: '', why: 'Paid from "' + aliasHits[0].alias.toUpperCase() + '" before', candidates: [] };
      return tx;
    }
    // 3. Names: the parent's full name, or a student's, inside the bank line.
    const toks = new Set(normText(text).split(' '));
    const scored = fams.map(f => {
      let best = 0, whose = '';
      const consider = (name, label) => {
        const t = nameTokens(name);
        if (t.length < 2) return;
        const n = t.filter(x => toks.has(x)).length;
        const score = n === t.length ? 3 : (n >= 2 ? 2 : 0);
        if (score > best) { best = score; whose = label + ' ' + name; }
      };
      consider(f.parentName, 'parent');
      (f.students || []).forEach(s => consider(s.name, 'student'));
      return { f, score: best, whose };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    const top = scored.length ? scored.filter(x => x.score === scored[0].score) : [];
    if (top.length === 1) {
      const f = top[0].f;
      const fits = amountFits(f.id, tx.amount);
      tx.match = {
        familyId: f.id, how: fits ? 'name+amount' : 'name', confidence: fits && top[0].score === 3 ? 'high' : 'medium', period: '',
        why: 'Name of ' + top[0].whose + (fits ? ', and the amount is what they owe' : ''), candidates: []
      };
      return tx;
    }
    // 4. Exactly one family owes exactly this amount.
    const byAmount = fams.filter(f => amountFits(f.id, tx.amount));
    const pool = top.length > 1 ? top.map(x => x.f).filter(f => byAmount.includes(f)) : byAmount;
    if (pool.length === 1) {
      tx.match = { familyId: pool[0].id, how: 'amount', confidence: top.length > 1 ? 'medium' : 'low', period: '', why: 'Only family that owes exactly ' + money(tx.amount), candidates: [] };
      return tx;
    }
    tx.match = { familyId: '', how: '', confidence: '', period: '', why: '', candidates: (top.length ? top.map(x => x.f.id) : byAmount.map(f => f.id)).slice(0, 6) };
    return tx;
  });
}
// ChatGPT's answers, folded into every credit that is not already CERTAIN (a
// reference code or a known payer). It fills the gaps, and it can confirm or
// overrule a guess made from a name or an amount alone; the guess it replaces
// stays in the candidates so the admin can still pick it.
export function applyAiMatches(transactions, aiJson, idMaps) {
  const famIds = idMaps.families, txIds = idMaps.transactions;
  const list = Array.isArray(aiJson && aiJson.matches) ? aiJson.matches : [];
  const byTx = new Map();
  list.forEach(m => {
    const key = txIds.get(String(m && m.tx));
    const fid = famIds.get(String(m && m.family));
    const conf = Number(m && m.confidence);
    if (!key || !fid || !(conf >= 0.5)) return;
    const prev = byTx.get(key);
    if (!prev || conf > prev.conf) byTx.set(key, { fid, conf, why: String(m.why || '').slice(0, 140) });
  });
  return transactions.map(tx => {
    const m = tx.match || {};
    if (m.familyId && (m.confidence === 'high' || m.how === 'manual')) return tx;
    const hit = byTx.get(tx.key);
    if (!hit) return tx;
    const agrees = !!m.familyId && m.familyId === hit.fid;
    const candidates = [m.familyId, ...(m.candidates || [])].filter(Boolean).filter((id, i, a) => id !== hit.fid && a.indexOf(id) === i).slice(0, 6);
    return Object.assign({}, tx, { match: {
      familyId: hit.fid, how: 'ai', confidence: hit.conf >= 0.85 ? 'medium' : 'low', aiConfidence: hit.conf, period: m.period || '',
      why: 'ChatGPT' + (agrees ? ' agrees' : '') + ': ' + (hit.why || 'likely match') + (agrees && m.why ? ' · ' + m.why : ''), candidates
    } });
  });
}
// Whether the review screen ticks a credit for applying. Certain matches are
// ticked; a sure ChatGPT match with the exact amount owed is ticked; an
// unverified amount (not printed in the statement) never is.
export function autoTick(tx, invoices) {
  const m = tx && tx.match;
  if (!m || !m.familyId || tx.unverified) return false;
  if (m.confidence === 'high') return true;
  if (m.how === 'ai' && (m.aiConfidence || 0) >= 0.85) {
    return (invoices || []).some(inv => inv.familyId === m.familyId && sameMoney(invoiceOutstanding(inv), tx.amount));
  }
  return false;
}
// How a payment is spread over a family's unpaid invoices: the month named in
// the reference first, then the OLDEST unpaid month, and anything left over is
// credit that the next invoice uses up.
export function allocatePayment(amount, familyInvoices, preferPeriod) {
  let left = round2(amount);
  const open = (familyInvoices || []).filter(inv => invoiceOutstanding(inv) > 0)
    .sort((a, b) => (a.period === preferPeriod ? -1 : b.period === preferPeriod ? 1 : String(a.period).localeCompare(String(b.period))));
  const allocations = [];
  open.forEach(inv => {
    if (left <= 0) return;
    const take = round2(Math.min(left, invoiceOutstanding(inv)));
    if (take > 0) { allocations.push({ invoiceId: inv.id, period: inv.period, amount: take }); left = round2(left - take); }
  });
  return { allocations, credit: Math.max(0, left) };
}
// The invoice after a payment lands on it (or comes off it, with a negative amount).
export function invoiceWithPayment(inv, amount, entry) {
  const paid = Math.max(0, round2((Number(inv.paid) || 0) + amount));
  const payments = (inv.payments || []).slice();
  if (amount > 0 && entry) payments.push(entry);
  if (amount < 0 && entry && entry.paymentId) {
    const i = payments.findIndex(p => p.paymentId === entry.paymentId);
    if (i >= 0) payments.splice(i, 1);
  }
  const next = Object.assign({}, inv, { paid, payments });
  next.status = invoiceStatusField(next);
  return next;
}
// A remembered payer name: the bank's account name the next statement will show again.
export function payerAliasFor(tx) {
  const p = normText(tx && tx.payer);
  if (p && p.length >= 4 && nameTokens(p).length >= 1 && !/^(paynow|transfer|fast|giro|ibg|inward|payment)/.test(p)) return p;
  return '';
}
// Families that still owe after a statement has been applied, for the reminder button.
export function stillOwing(invoices, todayKey, opts) {
  const o = opts || {};
  const today = todayKey || sgDayKey();
  return (invoices || []).filter(inv => {
    const st = invoiceState(inv, today);
    if (!['waiting', 'overdue', 'part'].includes(st.key)) return false;
    if (o.overdueOnly && st.key !== 'overdue' && !(isDayKey(inv.dueDate) && today > inv.dueDate)) return false;
    return true;
  });
}
// Whether this invoice may be reminded now (not twice within the gap).
export function canRemind(inv, todayKey, gapDays) {
  const today = todayKey || sgDayKey();
  const last = (inv.reminders || []).map(r => r && r.day).filter(isDayKey).sort().pop();
  if (!last) return true;
  return daysBetween(last, today) >= (Number(gapDays) || 1);
}

/* ─────────────────────────── 7. Words ─────────────────────────── */
function linesTableHtml(inv) {
  const row = (l) => '<tr>'
    + '<td style="padding:10px 12px;border-bottom:1px solid #e7eef0;color:#10303a;font-size:14px;">'
    + (l.studentName ? '<b>' + escapeHtml(l.studentName) + '</b><br>' : '')
    + escapeHtml(l.desc) + (l.detail ? '<br><span style="color:#6b7f85;font-size:12px;">' + escapeHtml(l.detail) + '</span>' : '')
    + '</td><td style="padding:10px 12px;border-bottom:1px solid #e7eef0;text-align:right;white-space:nowrap;font-size:14px;color:' + (l.amount < 0 ? '#16a34a' : '#10303a') + ';">'
    + money(l.amount) + '</td></tr>';
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:8px 0 4px;">'
    + (inv.lines || []).map(row).join('')
    + '<tr><td style="padding:12px;font-weight:700;font-size:15px;color:#10303a;">Total</td>'
    + '<td style="padding:12px;text-align:right;font-weight:700;font-size:18px;color:#056c76;white-space:nowrap;">' + money(inv.total) + '</td></tr>'
    + (Number(inv.paid) > 0 && invoiceOutstanding(inv) > 0
      ? '<tr><td style="padding:4px 12px;color:#6b7f85;font-size:13px;">Received so far</td><td style="padding:4px 12px;text-align:right;color:#16a34a;font-size:13px;">' + money(inv.paid) + '</td></tr>'
        + '<tr><td style="padding:4px 12px 12px;font-weight:700;color:#b45309;">Still to pay</td><td style="padding:4px 12px 12px;text-align:right;font-weight:700;color:#b45309;">' + money(invoiceOutstanding(inv)) + '</td></tr>'
      : '')
    + '</table>';
}
function qrBlockHtml(inv, o, amount) {
  const mode = invoiceQrMode(inv);
  if (mode === 'none' || !(amount > 0)) {
    // No QR on this invoice: just say how much, and how to ask.
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0 6px;"><tr><td align="center" style="padding:18px;background:#f2f9fa;border:1px solid #d1eaee;border-radius:14px;">'
      + '<div style="font-size:13px;color:#056c76;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">Amount to pay</div>'
      + '<div style="font-size:28px;font-weight:800;color:#10303a;">' + money(amount) + '</div>'
      + '<div style="font-size:13px;color:#3d5a61;margin-top:10px;line-height:1.6;">Please quote <b>' + escapeHtml(inv.number || inv.reference || '') + '</b> when you pay.</div>'
      + '</td></tr></table>';
  }
  const generic = mode === 'generic';
  const save = o.payUrl ? payLinkFrom(o.payUrl, true) : '';
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0 6px;"><tr><td align="center" style="padding:20px;background:#f2f9fa;border:1px solid #d1eaee;border-radius:14px;">'
    + '<div style="font-size:13px;color:#056c76;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">Scan to pay with PayNow</div>'
    + '<div style="font-size:28px;font-weight:800;color:#10303a;margin-bottom:12px;">' + money(amount) + '</div>'
    + (o.qrCid ? '<img src="cid:' + escapeHtml(o.qrCid) + '" width="220" height="220" alt="PayNow QR code' + (generic ? ' for Polymath Learning Centre' : ' for ' + money(amount)) + ', reference ' + escapeHtml(inv.reference) + '" style="display:block;margin:0 auto;width:220px;height:220px;border:8px solid #ffffff;border-radius:8px;">' : '')
    + '<div style="font-size:13px;color:#3d5a61;margin-top:12px;line-height:1.6;">'
    + (generic ? 'The reference <b>' + escapeHtml(inv.reference) + '</b> is already filled in — please type the amount, <b>' + money(amount) + '</b>.<br>'
      : 'The amount and the reference <b>' + escapeHtml(inv.reference) + '</b> are already filled in.<br>')
    + 'PayNow to UEN <b>' + escapeHtml(o.uen || PAYNOW_UEN) + '</b> (' + escapeHtml(o.merchant || MERCHANT_NAME) + ')</div>'
    + (save ? '<div style="margin-top:16px;"><a href="' + escapeHtml(save) + '" style="display:inline-block;background:#056c76;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:10px;">⬇&nbsp; Save the QR to my phone</a></div>'
      + '<div style="font-size:12px;color:#6b7f85;margin-top:10px;">On a phone? Save the QR, open your banking app, then <b>Scan QR → choose from gallery</b>.</div>' : '')
    + '</td></tr></table>';
}
function payLinkFrom(url, save) { return save ? url + (url.includes('?') ? '&' : '?') + 'save=1' : url; }
function emailShell(title, inner, s) {
  return '<div style="margin:0;padding:0;background:#eef5f6;">'
    + '<div style="max-width:600px;margin:0 auto;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#10303a;">'
    + '<div style="background:#10303a;border-radius:14px 14px 0 0;padding:18px 22px;">'
    + '<div style="color:#ffffff;font-weight:700;font-size:17px;letter-spacing:.04em;">POLYMATH LEARNING CENTRE</div>'
    + '<div style="color:#b8e4e8;font-size:13px;margin-top:2px;">' + escapeHtml(title) + '</div></div>'
    + '<div style="height:5px;background:linear-gradient(90deg,#2e9ca6,#56c4d0,#ec008c);"></div>'
    + '<div style="background:#ffffff;border-radius:0 0 14px 14px;padding:22px;border:1px solid #d1eaee;border-top:none;">' + inner
    + '<p style="font-size:14px;line-height:1.6;margin:18px 0 0;color:#10303a;">' + escapeHtml(s.signature).replace(/\n/g, '<br>') + '</p>'
    + '</div>'
    + '<p style="font-size:12px;color:#6b7f85;text-align:center;margin:14px 0 0;line-height:1.6;">Questions? WhatsApp us on ' + escapeHtml(displayPhone(s.centreWhatsapp))
    + ' · <a href="' + SITE + '" style="color:#056c76;">polymathlc.com.sg</a></p>'
    + '</div></div>';
}
function plainLines(inv) {
  return (inv.lines || []).map(l => '  ' + (l.studentName ? l.studentName + ' — ' : '') + l.desc + (l.detail ? ' (' + l.detail + ')' : '') + ': ' + money(l.amount)).join('\n');
}
// The PayNow lines of a plain-text email or a WhatsApp message, by QR choice.
function payTextLines(inv, s, owe, payUrl, short) {
  const mode = invoiceQrMode(inv);
  if (mode === 'none') return ['Amount to pay: ' + money(owe) + ' — please quote ' + (inv.number || inv.reference) + '.'];
  if (mode === 'generic') {
    return ['PayNow ' + money(owe) + ' to UEN ' + s.uen + ' (' + s.merchant + ')', 'Reference: ' + inv.reference + ' — please type the amount yourself.',
      payUrl ? (short ? 'Save the PayNow QR: ' : 'Save the PayNow QR (reference filled in): ') + payLinkFrom(payUrl, true) : ''];
  }
  return ['PayNow ' + money(owe) + ' to UEN ' + s.uen + ' (' + s.merchant + ')', 'Reference: ' + inv.reference,
    payUrl ? (short ? 'Save the PayNow QR: ' : 'Save the PayNow QR (amount and reference filled in): ') + payLinkFrom(payUrl, true) : ''];
}
// "tuition fees for <b>November 2026</b>" for a monthly invoice; a custom one's own title.
function invoiceWhatHtml(inv, kids) {
  if (inv.custom || String(inv.title || '').trim()) return '<b>' + escapeHtml(invoiceTitle(inv)) + '</b>';
  return (kids ? escapeHtml(kids) + '\'s ' : '') + 'tuition fees for <b>' + escapeHtml(periodLabel(inv.period)) + '</b>';
}
function invoiceWhatText(inv, kids) {
  if (inv.custom || String(inv.title || '').trim()) return invoiceTitle(inv);
  return (kids ? kids + '\'s ' : '') + 'tuition fees for ' + periodLabel(inv.period);
}
// opts: { payUrl, qrCid, today }
export function invoiceEmail(inv, settings, opts) {
  const s = normalizeSettings(settings), o = Object.assign({ uen: s.uen, merchant: s.merchant }, opts || {});
  const titled = !!(inv.custom || String(inv.title || '').trim());
  const month = periodLabel(inv.period);
  const owe = invoiceOutstanding(inv);
  const subject = titled ? 'Polymath invoice — ' + invoiceTitle(inv) + ' (' + money(owe) + ')' : 'Polymath tuition fees — ' + month + ' (' + money(owe) + ')';
  const kids = listJoin(inv.students || []);
  const note = String(inv.note || '').trim() || s.invoiceNote;
  const html = emailShell('Invoice ' + inv.number + ' · ' + (titled ? invoiceTitle(inv) : month),
    '<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">Dear ' + escapeHtml(inv.parentName || 'Parent') + ',</p>'
    + '<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">Here is the invoice for ' + invoiceWhatHtml(inv, kids) + '.'
    + (isDayKey(inv.dueDate) ? ' Kindly pay by <b>' + escapeHtml(prettyDate(inv.dueDate)) + '</b>.' : '') + '</p>'
    + linesTableHtml(inv) + qrBlockHtml(inv, o, owe)
    + (o.payUrl ? '<p style="font-size:13px;color:#3d5a61;text-align:center;margin:6px 0 0;"><a href="' + escapeHtml(o.payUrl) + '" style="color:#056c76;">View this invoice online</a></p>' : '')
    + (note ? '<p style="font-size:14px;line-height:1.6;margin:18px 0 0;">' + escapeHtml(note).replace(/\n/g, '<br>') + '</p>' : ''), s);
  const text = [
    'Dear ' + (inv.parentName || 'Parent') + ',', '',
    'Here is the invoice for ' + invoiceWhatText(inv, kids) + '.' + (isDayKey(inv.dueDate) ? ' Kindly pay by ' + prettyDate(inv.dueDate) + '.' : ''), '',
    'Invoice ' + inv.number, plainLines(inv), '  Total: ' + money(inv.total), (Number(inv.paid) > 0 ? '  Still to pay: ' + money(owe) : ''), '',
    ...payTextLines(inv, s, owe, o.payUrl, false), '',
    note, '', s.signature
  ].filter(v => v !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  return { subject, html, text };
}
// level: 1 = friendly, 2 = second, 3+ = final
export function reminderEmail(inv, settings, opts) {
  const s = normalizeSettings(settings), o = Object.assign({ uen: s.uen, merchant: s.merchant }, opts || {});
  const level = Math.max(1, Number(o.level) || ((inv.reminders || []).length + 1));
  const titled = !!(inv.custom || String(inv.title || '').trim());
  const month = titled ? invoiceTitle(inv) : periodLabel(inv.period);
  const what = titled ? 'the invoice for <b>' + escapeHtml(month) + '</b> (' + escapeHtml(inv.number || '') + ')' : 'the tuition fees for <b>' + escapeHtml(month) + '</b>';
  const What = what.charAt(0).toUpperCase() + what.slice(1);
  const owe = invoiceOutstanding(inv);
  const tone = level === 1 ? { title: 'A friendly reminder', open: 'This is a friendly reminder that ' + what + (titled ? ' is' : ' are') + ' still outstanding.' }
    : level === 2 ? { title: 'Second reminder', open: 'We have not yet received ' + what + '. We would be grateful if you could arrange payment soon.' }
      : { title: 'Final reminder', open: What + (titled ? ' remains' : ' remain') + ' unpaid. Please arrange payment as soon as possible, or WhatsApp us if there is anything we should know.' };
  const subject = (level >= 3 ? 'Final reminder' : 'Reminder') + ': ' + month + (titled ? '' : ' tuition fees') + ' (' + money(owe) + ' outstanding)';
  const html = emailShell(tone.title + ' · ' + month,
    '<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">Dear ' + escapeHtml(inv.parentName || 'Parent') + ',</p>'
    + '<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">' + tone.open
    + (isDayKey(inv.dueDate) ? ' (due ' + escapeHtml(prettyDate(inv.dueDate)) + ')' : '') + '</p>'
    + linesTableHtml(inv) + qrBlockHtml(inv, o, owe)
    + (s.reminderNote ? '<p style="font-size:14px;line-height:1.6;margin:18px 0 0;color:#3d5a61;">' + escapeHtml(s.reminderNote) + '</p>' : ''), s);
  const text = [
    'Dear ' + (inv.parentName || 'Parent') + ',', '',
    tone.open.replace(/<[^>]+>/g, ''), '',
    'Still to pay: ' + money(owe),
    ...(invoiceQrMode(inv) === 'exact'
      ? ['PayNow to UEN ' + s.uen + ', reference ' + inv.reference, o.payUrl ? 'Save the PayNow QR: ' + payLinkFrom(o.payUrl, true) : '']
      : payTextLines(inv, s, owe, o.payUrl, true).slice(invoiceQrMode(inv) === 'generic' ? 1 : 0)), '',
    s.reminderNote, '', s.signature
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  return { subject, html, text, level };
}
// payment: { amount, date }, allocations: [{ inv, amount }]
export function receiptEmail(family, payment, allocations, settings) {
  const s = normalizeSettings(settings);
  const forWhat = a => a.title ? String(a.title) : periodLabel(a.period) + ' fees';
  const rows = (allocations || []).map(a => '<tr><td style="padding:8px 12px;border-bottom:1px solid #e7eef0;">' + escapeHtml(forWhat(a))
    + (a.left > 0 ? '<br><span style="color:#b45309;font-size:12px;">' + money(a.left) + ' still to pay</span>' : '<br><span style="color:#16a34a;font-size:12px;">Fully paid ✓</span>')
    + '</td><td style="padding:8px 12px;border-bottom:1px solid #e7eef0;text-align:right;">' + money(a.amount) + '</td></tr>').join('');
  const credit = round2(payment.credit || 0);
  const html = emailShell('Payment received · thank you',
    '<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">Dear ' + escapeHtml(family.parentName || 'Parent') + ',</p>'
    + '<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">Thank you — we have received your payment of <b>' + money(payment.amount) + '</b>'
    + (isDayKey(payment.date) ? ' on ' + escapeHtml(prettyDate(payment.date)) : '') + '.</p>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">' + rows
    + (credit > 0 ? '<tr><td style="padding:8px 12px;">Kept as credit for your next invoice</td><td style="padding:8px 12px;text-align:right;color:#16a34a;">' + money(credit) + '</td></tr>' : '')
    + '</table>', s);
  const text = ['Dear ' + (family.parentName || 'Parent') + ',', '', 'Thank you — we have received your payment of ' + money(payment.amount) + (isDayKey(payment.date) ? ' on ' + prettyDate(payment.date) : '') + '.', '',
    ...(allocations || []).map(a => forWhat(a) + ': ' + money(a.amount) + (a.left > 0 ? ' (' + money(a.left) + ' still to pay)' : ' (fully paid)')),
    credit > 0 ? 'Kept as credit for your next invoice: ' + money(credit) : '', '', s.signature].join('\n').replace(/\n{3,}/g, '\n\n');
  return { subject: 'Payment received — thank you (' + money(payment.amount) + ')', html, text };
}
export function adminSummaryEmail(summary, settings) {
  const s = normalizeSettings(settings);
  const items = (summary.lines || []).map(l => '<li style="margin:4px 0;">' + escapeHtml(l) + '</li>').join('');
  const html = emailShell(summary.title,
    '<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">' + escapeHtml(summary.intro) + '</p>'
    + (items ? '<ul style="font-size:14px;line-height:1.6;padding-left:20px;">' + items + '</ul>' : '')
    + '<p style="margin:18px 0 0;"><a href="' + OFFICE_URL + '#invoices" style="display:inline-block;background:#056c76;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;">Open Polymath Office</a></p>', s);
  return { subject: summary.title, html, text: [summary.intro, '', ...(summary.lines || []).map(l => '- ' + l), '', OFFICE_URL + '#invoices'].join('\n') };
}
// The document the "Trigger Email from Firestore" extension sends.
export function officeMail(to, message, meta, settings) {
  const s = normalizeSettings(settings);
  const doc = {
    to: (Array.isArray(to) ? to : [to]).filter(isEmail),
    from: s.fromName + ' <' + SENDER_EMAIL + '>',
    replyTo: s.replyTo,
    message,
    polymathOffice: Object.assign({ sender: SENDER_EMAIL }, meta || {})
  };
  if (s.copyAdmin && isEmail(s.replyTo) && !doc.to.includes(s.replyTo)) doc.bcc = [s.replyTo];
  return doc;
}
export function mailDocId(kind, key, now) {
  const safe = String(key || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
  return MAIL_PREFIX + kind + '-' + safe + '-' + (now == null ? Date.now() : Number(now));
}
// The QR as an email attachment the HTML shows inline (cid) and the parent can save.
export function qrAttachment(base64Png, reference, cid) {
  return { filename: qrFileName(reference), content: String(base64Png || '').replace(/^data:image\/png;base64,/, ''), encoding: 'base64', contentType: 'image/png', cid: cid || 'paynowqr' };
}

// WhatsApp texts. The QR itself travels as the invoice IMAGE pasted into the chat;
// the link lets the parent save it again later from their phone.
export function whatsappInvoiceText(inv, settings, payUrl) {
  const s = normalizeSettings(settings);
  const owe = invoiceOutstanding(inv);
  const mode = invoiceQrMode(inv);
  const by = isDayKey(inv.dueDate) ? ' Kindly pay by ' + prettyDate(inv.dueDate) + '.' : '';
  const titled = !!(inv.custom || String(inv.title || '').trim());
  const note = String(inv.note || '').trim();
  return [
    'Hi ' + (inv.parentName || '') + ', this is Polymath Learning Centre 😊',
    '',
    '*' + (titled ? invoiceTitle(inv) : periodLabel(inv.period) + ' tuition fees') + ': ' + money(owe) + '*',
    plainLines(inv).replace(/^ {2}/gm, '• '),
    '',
    mode === 'none' ? 'Invoice ' + (inv.number || '') + '.' + by
      : mode === 'generic' ? 'PayNow ' + money(owe) + ' to UEN ' + s.uen + ' — scan the QR in the picture (the reference *' + inv.reference + '* is filled in) and type the amount.' + by
        : 'PayNow to UEN ' + s.uen + ' — the QR in the picture has the amount and reference *' + inv.reference + '* filled in.' + by,
    payUrl && mode !== 'none' ? '⬇ Save the QR to your phone: ' + payLinkFrom(payUrl, true) : (payUrl ? '🔗 The invoice online: ' + payUrl : ''),
    note ? '\n' + note : '',
    '',
    'Thank you!'
  ].filter(v => v !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}
export function whatsappReminderText(inv, settings, payUrl) {
  const s = normalizeSettings(settings);
  const owe = invoiceOutstanding(inv);
  return [
    'Hi ' + (inv.parentName || '') + ', a gentle reminder from Polymath Learning Centre 😊',
    '',
    (inv.custom || String(inv.title || '').trim())
      ? 'Invoice ' + (inv.number || '') + ' (' + invoiceTitle(inv) + ') of *' + money(owe) + '* is still outstanding.'
      : 'The ' + periodLabel(inv.period) + ' tuition fees of *' + money(owe) + '* are still outstanding.',
    invoiceQrMode(inv) === 'none' ? 'Please quote ' + (inv.number || inv.reference) + ' when you pay.'
      : 'PayNow to UEN ' + s.uen + ', reference *' + inv.reference + '*' + (invoiceQrMode(inv) === 'generic' ? ' (please type the amount).' : '.'),
    payUrl ? (invoiceQrMode(inv) === 'none' ? '🔗 The invoice: ' + payUrl : '⬇ Save the QR: ' + payLinkFrom(payUrl, true)) : '',
    '',
    s.reminderNote
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}
// WhatsApp Web opens straight into the chat with the text typed in; on a phone,
// wa.me hands over to the WhatsApp app.
export function whatsappLink(phone, text, web) {
  const n = normalizeWhatsapp(phone);
  const t = encodeURIComponent(String(text || ''));
  if (web) return 'https://web.whatsapp.com/send?phone=' + n + '&text=' + t;
  return 'https://wa.me/' + n + '?text=' + t;
}

/* ─────────────────────────── 8. Importing a spreadsheet ───────────────────────────
   The centre's own sheet (studentms) has the columns
     Online/Physical, Student Name, Parent, Contact number, Email address, Level,
     Math (Day), Science (Day), Fee, Expiry/ Remark, Category
   and any other sheet is mapped by header name. One family per WhatsApp number
   (or email, or parent name), students under it. */
export const IMPORT_FIELDS = [
  { key: 'parentName', label: 'Parent name', words: ['parent', 'parent name', 'parents name', 'guardian', 'account holder', 'father', 'mother', 'mum', 'dad', 'nok', 'contact person'] },
  { key: 'studentName', label: 'Student name', words: ['student name', 'student', 'child', 'child name', 'childs name', 'name of student', 'pupil', 'kid', 'name'] },
  { key: 'whatsapp', label: 'WhatsApp / phone', words: ['contact number', 'contact', 'whatsapp', 'whatsapp number', 'hp', 'hp no', 'mobile', 'phone', 'phone number', 'tel', 'handphone', 'parent contact'] },
  { key: 'email', label: 'Email', words: ['email address', 'email', 'e mail', 'parent email', 'emails'] },
  { key: 'address', label: 'Address', words: ['address', 'home address', 'postal address', 'mailing address'] },
  { key: 'signUpDate', label: 'Sign-up date', words: ['sign up date', 'signup date', 'date joined', 'joined', 'join date', 'start date', 'registered', 'registration date', 'date of sign up', 'enrolment date', 'enrollment date'] },
  { key: 'level', label: 'Level', words: ['level', 'class level', 'grade', 'primary', 'pri', 'standard'] },
  { key: 'mode', label: 'Online / Physical', words: ['online physical', 'mode', 'online or physical', 'class mode', 'type of class'] },
  { key: 'school', label: 'School', words: ['school', 'school name'] },
  { key: 'mathDay', label: 'Math day', words: ['math day', 'math', 'maths', 'mathematics', 'math class', 'maths day'] },
  { key: 'scienceDay', label: 'Science day', words: ['science day', 'science', 'sci', 'science class'] },
  { key: 'fee', label: 'Fee', words: ['fee', 'fees', 'monthly fee', 'monthly fees', 'rate', 'amount'] },
  { key: 'notes', label: 'Remarks', words: ['expiry remark', 'remark', 'remarks', 'notes', 'note', 'comments', 'expiry'] }
];
export function mapImportHeaders(headerRow) {
  const used = new Set();
  const map = {};
  const heads = (headerRow || []).map(h => normText(h));
  // Exact words first, then "contains", so "Math (Day)" goes to mathDay, not to a looser field.
  [true, false].forEach(exact => {
    IMPORT_FIELDS.forEach(f => {
      if (map[f.key] != null) return;
      const i = heads.findIndex((h, idx) => !used.has(idx) && h && (exact ? f.words.includes(h) : f.words.some(w => w.length >= 4 && h.includes(w))));
      if (i >= 0) { map[f.key] = i; used.add(i); }
    });
  });
  return map;
}
// "Monday", "mon", "tUESDAY", "Monday (Phy)", "Sat 9am" → { day: 'MON', mode, hour }
export function parseDayCell(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const m = s.match(/\b(mon|tue|wed|thu|fri|sat)[a-z]*/i);
  if (!m) return null;
  const day = m[1].toUpperCase();
  const mode = /\b(phy|physical|centre|center|f2f)\b/i.test(s) ? 'Physical' : (/\b(onl|online|zoom)\b/i.test(s) ? 'Online' : '');
  const tm = s.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m/i);
  const startMin = tm ? (Number(tm[1]) % 12 + (tm[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + Number(tm[2] || 0) : null;
  return { day, mode, startMin, raw: s };
}
// The slot a sheet's "Math (Day) = Monday" means, for a student at a level:
// the one class on that day for that level and subject. Two candidates → the
// time in the cell decides; still two → left for the admin to pick.
export function findSlotFor(schedule, dayInfo, level, subject) {
  if (!dayInfo) return { slotId: '', why: '' };
  const day = DAYS.find(d => d.code === dayInfo.day);
  if (!day) return { slotId: '', why: '' };
  const lv = normalizeLevel(level);
  const sk = subjectKey(subject);
  let cands = day.times.map(t => ({ id: slotId(day.code, t.n), t, slot: scheduleSlot(schedule, slotId(day.code, t.n)) }))
    .filter(c => subjectKey(c.slot.subject) === sk && (!lv || normalizeLevel(c.slot.level) === lv));
  if (cands.length > 1 && dayInfo.startMin != null) {
    const byTime = cands.filter(c => timeStartMin(c.t.label) === dayInfo.startMin);
    if (byTime.length) cands = byTime;
  }
  if (cands.length === 1) return { slotId: cands[0].id, why: '' };
  return { slotId: '', why: (cands.length ? 'More than one ' : 'No ') + (lv ? levelLabel(lv) + ' ' : '') + subject + ' class on ' + day.name + ' — pick the time' };
}
// rows: arrays (first row = headers). existing: families already stored.
// Returns families to write (new ones and changed existing ones) plus a report.
export function planImport(rows, opts) {
  const o = opts || {};
  const table = (rows || []).filter(r => Array.isArray(r) && r.some(v => String(v == null ? '' : v).trim()));
  if (table.length < 2) return { families: [], report: { rows: 0, newFamilies: 0, updatedFamilies: 0, students: 0, skipped: [], needsClass: [] } };
  const map = o.mapping || mapImportHeaders(table[0]);
  const get = (r, k) => map[k] == null ? '' : r[map[k]];
  const existing = (o.existing || []).map(f => normalizeFamily(f));
  const random = o.random;
  const taken = new Set(existing.map(f => f.code).filter(Boolean));
  const out = new Map();   // key → family
  const keyOf = (phone, email, parent) => phone || email || ('name:' + normText(parent));
  const findExisting = (phone, email, parent) => existing.find(f => (phone && f.whatsapp === phone) || (email && familyEmails(f).includes(email)))
    || (parent && !phone && !email ? existing.find(f => normText(f.parentName) === normText(parent)) : null);
  const report = { rows: 0, newFamilies: 0, updatedFamilies: 0, students: 0, skipped: [], needsClass: [] };
  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const studentName = String(get(r, 'studentName') || '').trim();
    if (!studentName) { report.skipped.push('Row ' + (i + 1) + ': no student name'); continue; }
    report.rows++;
    const phone = normalizeWhatsapp(get(r, 'whatsapp'));
    const emails = splitEmails(get(r, 'email'));
    const parent = String(get(r, 'parentName') || '').trim() || (studentName + "'s parent");
    const key = keyOf(phone, emails[0], parent);
    let fam = out.get(key);
    if (!fam) {
      const prev = findExisting(phone, emails[0], parent);
      fam = prev ? normalizeFamily(JSON.parse(JSON.stringify(prev))) : normalizeFamily({
        id: o.newId ? o.newId() : '', code: random ? newCode(random, taken) : '', parentName: parent,
        email: emails[0] || '', email2: emails[1] || '', whatsapp: phone, address: String(get(r, 'address') || '').trim(),
        signUpDate: parseDateLoose(get(r, 'signUpDate')) || o.today || '', notes: ''
      });
      fam._isNew = !prev;
      if (fam.code) taken.add(fam.code);
      if (prev) {
        // Fill in only what is missing; never overwrite what the admin already typed.
        if (!fam.email && emails[0]) fam.email = emails[0];
        if (!fam.email2 && emails[1] && emails[1] !== fam.email) fam.email2 = emails[1];
        if (!fam.whatsapp && phone) fam.whatsapp = phone;
        if (!fam.address && get(r, 'address')) fam.address = String(get(r, 'address')).trim();
      }
      out.set(key, fam);
    }
    if (fam.students.some(s => normText(s.name) === normText(studentName))) continue;   // already there
    const level = normalizeLevel(get(r, 'level'));
    const sheetMode = /phy/i.test(String(get(r, 'mode'))) ? 'Physical' : (/onl/i.test(String(get(r, 'mode'))) ? 'Online' : '');
    const classes = [];
    [['mathDay', 'Math'], ['scienceDay', 'Science']].forEach(([k, subject]) => {
      const cell = get(r, k);
      String(cell || '').split(/[,&/;+]|\band\b/i).map(x => x.trim()).filter(Boolean).forEach(part => {
        const info = parseDayCell(part);
        if (!info) return;
        const found = findSlotFor(o.schedule || {}, info, level, subject);
        const mode = info.mode || sheetMode || 'Physical';
        if (found.slotId) classes.push({ slotId: found.slotId, mode, rate: '' });
        else report.needsClass.push(studentName + ': ' + (found.why || subject + ' on ' + info.raw));
      });
    });
    const fee = feeNum(get(r, 'fee'));
    const notes = [String(get(r, 'notes') || '').trim(), fee && !o.useSheetFee ? 'Sheet fee: ' + money(fee) : ''].filter(Boolean).join(' · ');
    fam.students.push(normalizeStudent({
      id: o.newId ? o.newId() : 's' + (fam.students.length + 1), name: studentName, level, school: String(get(r, 'school') || '').trim(),
      status: 'active', startDate: parseDateLoose(get(r, 'signUpDate')) || o.today || '', classes,
      monthlyFee: o.useSheetFee && fee ? fee : '', notes
    }));
    fam._touched = true;
    report.students++;
  }
  const families = Array.from(out.values()).filter(f => f._touched);
  report.newFamilies = families.filter(f => f._isNew).length;
  report.updatedFamilies = families.length - report.newFamilies;
  families.forEach(f => { delete f._touched; });
  return { families, report, mapping: map };
}

/* ─────────────────────────── Helpers for tables ─────────────────────────── */
export function toCsv(rows) {
  return (rows || []).map(r => r.map(v => {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}
// Pasted from Google Sheets / Excel (tabs) or a CSV (commas, quotes).
export function parseDelimited(text) {
  const s = String(text || '').replace(/\r\n?/g, '\n');
  const firstLine = s.split('\n')[0] || '';
  const delim = (firstLine.match(/\t/g) || []).length >= (firstLine.match(/,/g) || []).length && firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim()));
}
// Every student, flattened for the Students table, the timetable and filters.
export function studentRows(families, schedule) {
  const out = [];
  (families || []).forEach(f0 => {
    const f = normalizeFamily(f0);
    f.students.forEach(st => {
      const classes = st.classes.map(c => {
        if (c.custom) return { slotId: '', title: c.label || 'Lessons', subject: '', level: st.level, mode: c.mode, custom: true, fee: feeNum(c.rate) };
        const slot = scheduleSlot(schedule, c.slotId);
        return { slotId: c.slotId, title: slotTitle(slot), subject: slot.subject || '', level: slot.level || '', mode: classMode(c, schedule), when: slotShortLabel(c.slotId), fee: feeNum(c.rate) || monthlyFeeFor(slot, c.mode, schedule) };
      });
      const famNow = familyStateIn(f, sgMonthKey());
      out.push({
        familyId: f.id, family: f, studentId: st.id, name: st.name, level: st.level, school: st.school,
        status: famNow === 'withdrawn' ? 'left' : (famNow === 'paused' && st.status === 'active' ? 'paused' : st.status),
        parentName: f.parentName, whatsapp: f.whatsapp, email: f.email, code: f.code, classes,
        subjects: [...new Set(classes.map(c => c.subject).filter(Boolean))],
        modes: [...new Set(classes.map(c => c.mode))],
        days: [...new Set(classes.map(c => (c.slotId || '').split('-')[0]).filter(Boolean))],
        monthly: feeNum(st.monthlyFee) || round2(classes.reduce((s, c) => s + (c.fee || 0), 0))
      });
    });
  });
  return out;
}
// Who sits in each timetable slot (active students only).
export function slotRoster(families, schedule) {
  const map = new Map();
  studentRows(families, schedule).forEach(r => {
    if (r.status !== 'active') return;
    r.classes.forEach(c => {
      if (!c.slotId) return;
      const list = map.get(c.slotId) || [];
      list.push(Object.assign({}, r, { mode: c.mode || 'Physical' }));
      map.set(c.slotId, list);
    });
  });
  return map;
}

/* ─────────────────────────── 9. Family records ───────────────────────────
   A confirmed sign-up is one family record. What the centre keeps on it:

     Status            active / paused (with the paused months) / withdrawn (with the last month)
     Email             ONE email per family — the family's account ID with the centre,
                       the same for every child. No two families may share it.
     Student name      each child (a family can have several)
     Parent name
     WhatsApp number
     Primary school    the child's `school`
     With us since     the child's `startDate` (the family's own `signUpDate` too)
     Type of lesson    online regular / physical regular / masterclass (`lessonType`)
     Slots             one or more slots of the live schedule (schedule_config/main),
                       e.g. Math on Tuesday AND Science on Saturday
     Payment record    which months are paid, the last payment, and the last time the
                       parent sent a PayNow screenshot
     Notes             anything

   Nothing here needs a migration: an older record simply has no `lessonType`
   (it is read from the child's classes until somebody picks one), no months
   marked paid by hand and no screenshots logged yet. */

export const LESSON_TYPES = Object.freeze([
  Object.freeze({ key: 'online', label: 'Online regular', short: 'Online', icon: '💻', mode: 'Online' }),
  Object.freeze({ key: 'physical', label: 'Physical regular', short: 'Physical', icon: '🏫', mode: 'Physical' }),
  Object.freeze({ key: 'master', label: 'Masterclass', short: 'Masterclass', icon: '⭐', mode: 'Physical' })
]);
export const LESSON_TYPE_KEYS = Object.freeze(LESSON_TYPES.map(t => t.key));
export function lessonTypeMeta(key) { return LESSON_TYPES.find(t => t.key === key) || null; }
export function lessonTypeLabel(key) { const t = lessonTypeMeta(key); return t ? t.label : ''; }
export const FAMILY_STATUS_LABEL = Object.freeze({ active: 'Active', paused: 'Paused', withdrawn: 'Withdrawn', inactive: 'Withdrawn' });
export function familyStatusLabel(status) { return FAMILY_STATUS_LABEL[status] || 'Active'; }

// The type of lesson a child's classes add up to, when nobody has chosen one:
// any Master Class slot → masterclass; every class online → online regular;
// otherwise physical regular. No classes at all → '' (not known yet).
export function derivedLessonType(student, schedule) {
  const types = studentLessonTypes(student, schedule);
  if (!types.length) return '';
  if (types.includes('master')) return 'master';
  return types.length === 1 ? types[0] : 'physical';
}
// Every kind of class a child takes (v1.9.0: a child can mix them).
export function studentLessonTypes(student, schedule) {
  const cls = ((student && student.classes) || []).filter(c => c && (c.custom || isValidSlotId(c.slotId)));
  const keys = new Set(cls.map(c => classModeKey(c, schedule)));
  return LESSON_TYPE_KEYS.filter(k => keys.has(k));
}
export function studentHasLessonType(student, type, schedule) { return !type || studentLessonTypes(student, schedule).includes(type); }
// Kept for older callers: the kinds read from the classes (never a stored choice).
export function studentLessonType(student, schedule) { return derivedLessonType(student, schedule); }
// Whether a schedule slot is one a child of this lesson type can be put in.
export function slotFitsLessonType(slot, type) {
  if (!slotHasClass(slot)) return false;
  if (!type) return true;
  if (type === 'master') return isMaster(slot);
  if (isMaster(slot)) return false;
  return slotModes(slot).includes(type === 'online' ? 'Online' : 'Physical');
}
// The mode a class should be taken in: the lesson type's, when the slot runs it.
export function modeForLessonType(slot, type, current) {
  if (isMaster(slot)) return 'Master';
  const modes = slotClassModes(slot);
  const want = type === 'online' ? 'Online' : type === 'physical' ? 'Physical' : type === 'master' ? 'Master' : (current || modes[0]);
  return modes.includes(want) ? want : modes[0];
}
// "Tue 7:00pm · Primary 6 Math" — how a slot reads in the picker and the table.
export function slotChoiceLabel(schedule, id) {
  const slot = scheduleSlot(schedule, id);
  return slotShortLabel(id) + ' · ' + (slotHasClass(slot) ? slotTitle(slot) : 'no class');
}
export function studentSlotIds(student) {
  return ((student && student.classes) || []).filter(c => c && !c.custom && isValidSlotId(c.slotId)).map(c => c.slotId)
    .filter((v, i, a) => a.indexOf(v) === i);
}

// The slot drop-down: every slot of the timetable, by day, with what the
// schedule has in it, whether it suits the child (lesson type, level), and
// how many students already sit in it. A slot with no class cannot be ticked,
// unless the child is already in it (so it can be unticked).
export function slotPickerGroups(schedule, opts) {
  const o = opts || {};
  const chosen = new Set(o.selected || []);
  const level = normalizeLevel(o.level);
  const type = LESSON_TYPE_KEYS.includes(o.lessonType) ? o.lessonType : '';
  return DAYS.map(day => ({
    code: day.code, name: day.name,
    options: day.times.map(t => {
      const id = slotId(day.code, t.n);
      const slot = scheduleSlot(schedule, id);
      const has = slotHasClass(slot);
      const isChosen = chosen.has(id);
      return {
        id, when: t.label, start: t.label.split(/\s*[–—-]\s*/)[0], has, chosen: isChosen,
        title: has ? slotTitle(slot) : 'No class',
        subject: has ? slot.subject : '', master: isMaster(slot),
        modes: has ? slotModes(slot) : [],
        fits: has && slotFitsLessonType(slot, type),
        levelMatch: has && !!level && normalizeLevel(slot.level) === level,
        status: slot.status || 'open',
        count: o.roster && o.roster.get ? (o.roster.get(id) || []).length : 0,
        disabled: !has && !isChosen
      };
    })
  }));
}

// Tick or untick one slot for a child. Ticking adds the class in the mode the
// lesson type asks for; unticking removes it. Never touches other classes.
export function toggleStudentSlot(student, id, schedule) {
  const s = Object.assign({}, student, { classes: ((student && student.classes) || []).map(c => Object.assign({}, c)) });
  const at = s.classes.findIndex(c => !c.custom && c.slotId === id);
  if (at >= 0) { s.classes.splice(at, 1); return s; }
  if (!isValidSlotId(id)) return s;
  const slot = scheduleSlot(schedule, id);
  if (!slotHasClass(slot)) return s;
  // A blank row left by "Add a class" is filled first, so nothing is left dangling.
  const blank = s.classes.findIndex(c => !c.custom && !c.slotId);
  const cls = { slotId: id, mode: modeForLessonType(slot, '', ''), rate: '', custom: false, label: '' };
  if (blank >= 0) s.classes[blank] = Object.assign(s.classes[blank], cls, { rate: s.classes[blank].rate || '' });
  else s.classes.push(cls);
  return s;
}
// Put every class of a child into one option at once (physical, online or
// Master class) where the slot allows it. Nothing is stored on the child.
export function applyLessonType(student, type, schedule) {
  const s = Object.assign({}, student, { classes: ((student && student.classes) || []).map(c => Object.assign({}, c)) });
  delete s.lessonType;
  if (!LESSON_TYPE_KEYS.includes(type)) return s;
  const mode = type === 'master' ? 'Master' : lessonTypeMeta(type).mode;
  s.classes.forEach(c => {
    if (c.custom || !c.slotId) { c.mode = mode; return; }
    const slot = scheduleSlot(schedule, c.slotId);
    if (slotClassModes(slot).includes(mode)) c.mode = mode;
  });
  return s;
}
// Older callers: with no type stored on a child there is nothing to disagree with.
export function lessonTypeIssues() { return []; }

/* ── The family's email: its account ID ──
   One email per family, whatever number of children. A second family may not
   be saved with an email another family already uses — the child belongs in
   that family instead. */
export function emailOwner(families, email, exceptId) {
  const e = cleanEmail(email);
  if (!isEmail(e)) return null;
  return (families || []).find(f => f && f.id !== exceptId && familyEmails(normalizeFamily(f)).includes(e)) || null;
}
// Families saved before the rule that share an email: email → [families].
export function sharedEmails(families) {
  const by = new Map();
  (families || []).forEach(f0 => {
    const f = normalizeFamily(f0);
    familyEmails(f).forEach(e => { const a = by.get(e) || []; if (!a.some(x => x.id === f.id)) a.push(f); by.set(e, a); });
  });
  return new Map([...by.entries()].filter(([, a]) => a.length > 1));
}
// Everything wrong with a family before it is saved, worst first.
// `families` is everybody else (for the account-ID check).
export function familyRecordProblems(family, families) {
  const f = normalizeFamily(family);
  const out = [];
  if (!f.parentName) out.push({ level: 'block', field: 'parentName', text: 'Type the parent\'s name.' });
  out.push(...extraFieldProblems(f));
  if (f.email && !isEmail(f.email)) out.push({ level: 'block', field: 'email', text: 'The email address does not look right.' });
  if (f.email2 && !isEmail(f.email2)) out.push({ level: 'block', field: 'email2', text: 'The second email does not look right.' });
  [f.email, f.email2].filter(isEmail).forEach(e => {
    const other = emailOwner(families, e, f.id);
    if (other) out.push({ level: 'block', field: 'email', text: e + ' is already the account email of ' + (normalizeFamily(other).parentName || 'another family') + '. One email is one family — add the child to that family instead.', familyId: other.id });
  });
  if (!f.email) out.push({ level: 'warn', field: 'email', text: 'No email yet. The email is the family\'s account ID with the centre — every child uses the same one.' });
  if (!f.whatsapp) out.push({ level: 'warn', field: 'whatsapp', text: 'No WhatsApp number yet.' });
  const kids = f.students.filter(s => s.name);
  if (!kids.length) out.push({ level: 'warn', field: 'students', text: 'No child yet.' });
  const names = kids.map(s => normText(s.name));
  if (names.some((n, i) => names.indexOf(n) !== i)) out.push({ level: 'warn', field: 'students', text: 'Two children have the same name.' });
  return out;
}

/* ── Payment record ──
   Months come from the family's MONTHLY invoices (a custom invoice — a holiday
   programme, a book — never pays a month's fees), plus months the admin marks
   paid by hand for payments from before the office existed, or paid in cash
   without an invoice. The last payment is the latest of: a payment applied to
   any of the family's invoices, a payment recorded for the family, a month
   marked paid by hand. Screenshots are the PayNow screenshots parents send on
   WhatsApp, logged with the day they came in. */
export const SCREENSHOT_LIMIT = 120;
// The payment record starts here: nothing before September 2026 is listed.
export const RECORD_START = '2026-09';
// …and runs to at least December 2027, so a year paid in advance can be ticked off.
export const RECORD_END = '2027-12';
export function normalizePaidMonths(list) {
  const seen = new Map();
  (Array.isArray(list) ? list : []).forEach(x => {
    const e = typeof x === 'string' ? { period: x } : Object.assign({}, x || {});
    if (!isPeriod(e.period)) return;
    seen.set(e.period, {
      period: e.period, date: isDayKey(e.date) ? e.date : '', amount: feeNum(e.amount) || '',
      note: String(e.note || '').trim().slice(0, 200), by: String(e.by || '').slice(0, 120)
    });
  });
  return [...seen.values()].sort((a, b) => a.period.localeCompare(b.period));
}
export function normalizeScreenshots(list) {
  return (Array.isArray(list) ? list : []).map(x => {
    const e = typeof x === 'string' ? { date: x } : Object.assign({}, x || {});
    if (!isDayKey(e.date)) return null;
    return {
      date: e.date, period: isPeriod(e.period) ? e.period : '', note: String(e.note || '').trim().slice(0, 200),
      by: String(e.by || '').slice(0, 120), at: Number(e.at) || 0
    };
  }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at).slice(0, SCREENSHOT_LIMIT);
}
// A screenshot just received: today, for this month unless told otherwise.
export function newScreenshot(opts) {
  const o = opts || {};
  const date = isDayKey(o.date) ? o.date : sgDayKey(o.now);
  return { date, period: isPeriod(o.period) ? o.period : date.slice(0, 7), note: String(o.note || '').trim().slice(0, 200), by: String(o.by || ''), at: Number(o.at) || Date.now() };
}
// Mark a month paid by hand, or take the mark off again.
export function togglePaidMonth(family, period, entry) {
  const f = Object.assign({}, family);
  const list = normalizePaidMonths(f.paidMonths);
  if (!isPeriod(period)) { f.paidMonths = list; return f; }
  const at = list.findIndex(p => p.period === period);
  if (at >= 0) list.splice(at, 1);
  else list.push(Object.assign({ period, date: '', amount: '', note: '', by: '' }, entry || {}, { period }));
  f.paidMonths = normalizePaidMonths(list);
  return f;
}
export const MONTH_STATE_META = Object.freeze({
  paid: { label: 'Paid', tone: 'green', icon: '✅' },
  hand: { label: 'Paid (marked by hand)', tone: 'green', icon: '✔︎' },
  package: { label: 'Covered by the package', tone: 'green', icon: '📦' },
  gone: { label: 'After the last month (withdrawn)', tone: 'grey', icon: '👋' },
  paused: { label: 'Paused (not billed)', tone: 'grey', icon: '⏸' },
  part: { label: 'Part paid', tone: 'amber', icon: '◐' },
  waiting: { label: 'Waiting for payment', tone: 'amber', icon: '⏳' },
  overdue: { label: 'Overdue', tone: 'red', icon: '⚠️' },
  draft: { label: 'Invoice not sent', tone: 'grey', icon: '📝' },
  none: { label: 'No invoice', tone: 'grey', icon: '·' }
});
export function monthShort(period) {
  if (!isPeriod(period)) return String(period || '');
  return MONTHS[Number(period.slice(5, 7)) - 1].slice(0, 3);
}
// "Sep, Oct, Nov 2026 · Jan 2027" — paid months, oldest first, grouped by year.
export function monthsText(periods) {
  const list = [...new Set((periods || []).filter(isPeriod))].sort();
  if (!list.length) return '';
  const years = new Map();
  list.forEach(p => { const y = p.slice(0, 4); const a = years.get(y) || []; a.push(monthShort(p)); years.set(y, a); });
  return [...years.entries()].map(([y, ms]) => ms.join(', ') + ' ' + y).join(' · ');
}
export function familyPaymentRecord(family, invoices, payments, opts) {
  const o = opts || {};
  const today = isDayKey(o.today) ? o.today : sgDayKey();
  const span = Math.max(1, Math.min(36, Number(o.months) || 12));
  const f = normalizeFamily(family);
  const invs = (invoices || []).filter(i => i && i.familyId === f.id && i.status !== 'void');
  const monthly = new Map();
  invs.filter(i => !i.custom && isPeriod(i.period)).forEach(i => { if (!monthly.has(i.period)) monthly.set(i.period, i); });
  const hand = new Map(f.paidMonths.map(p => [p.period, p]));
  const stateFor = period => {
    const inv = monthly.get(period);
    const h = hand.get(period);
    if (inv) {
      const st = invoiceState(inv, today).key;
      if (st === 'paid' || st === 'free') return { key: 'paid', inv, hand: h || null };
      if (h) return { key: 'hand', inv, hand: h };
      return { key: ['part', 'waiting', 'overdue', 'draft'].includes(st) ? st : 'draft', inv, hand: null };
    }
    if (h) return { key: 'hand', inv: null, hand: h };
    if (packageCovers(f, period)) return { key: 'package', inv: null, hand: null };
    const state = familyStateIn(f, period);
    if (state === 'withdrawn' && f.lastMonth) return { key: 'gone', inv: null, hand: null };
    if (state === 'paused') return { key: 'paused', inv: null, hand: null };
    return { key: 'none', inv: null, hand: null };
  };
  // The window: from the record's start (September 2026, or the last `span`
  // months once that is far behind) to December 2027 — or this month, or any
  // later month already invoiced or paid, whichever is latest.
  const thisMonth = today.slice(0, 7);
  const until = isPeriod(o.until) ? o.until : RECORD_END;
  let end = until > thisMonth ? until : thisMonth;
  [...monthly.keys(), ...hand.keys()].forEach(p => { if (p > end) end = p; });
  const months = [];
  const from = isPeriod(o.from) ? o.from : RECORD_START;
  let first = o.months ? addMonths(thisMonth, -(span - 1)) : from;
  if (first < from) first = from;
  for (let p = first; p <= end; p = addMonths(p, 1)) {
    const s = stateFor(p);
    const meta = MONTH_STATE_META[s.key];
    months.push({
      period: p, label: monthShort(p), year: p.slice(0, 4), key: s.key,
      stateLabel: meta.label, tone: meta.tone, icon: meta.icon,
      invoiceId: s.inv ? s.inv.id : '', total: s.inv ? round2(s.inv.total) : 0, paid: s.inv ? round2(s.inv.paid) : 0,
      outstanding: s.inv ? invoiceOutstanding(s.inv) : 0, handDate: s.hand ? s.hand.date : '', handAmount: s.hand ? s.hand.amount : '',
      current: p === thisMonth
    });
  }
  const fromDay = from + '-01';
  const paidPeriods = [...new Set([...monthly.keys(), ...hand.keys(), ...months.filter(m => m.key === 'package').map(m => m.period)])]
    .filter(p => p >= from && ['paid', 'hand', 'package'].includes(stateFor(p).key)).sort();
  // Every payment we know of, newest first.
  const seen = new Set();
  const all = [];
  invs.forEach(inv => (inv.payments || []).forEach(p => {
    if (!p || !isDayKey(p.date)) return;
    const key = (p.paymentId || '') + '|' + inv.id;
    if (seen.has(key)) return;
    seen.add(key);
    all.push({ date: p.date, amount: round2(p.amount), how: p.how || '', paymentId: p.paymentId || '', at: Number(p.at) || 0, period: inv.period || '', source: 'invoice' });
  }));
  const paymentIds = new Set(all.map(p => p.paymentId).filter(Boolean));
  (payments || []).filter(p => p && p.familyId === f.id && isDayKey(p.date)).forEach(p => {
    if (paymentIds.has(p.id)) {
      // Already counted per invoice; a payment kept whole as credit has no invoice entry.
      return;
    }
    all.push({ date: p.date, amount: round2(p.amount), how: p.how || p.method || '', paymentId: p.id || '', at: 0, period: '', source: 'payment' });
  });
  f.paidMonths.filter(p => p.date).forEach(p => all.push({ date: p.date, amount: feeNum(p.amount) || 0, how: 'hand', paymentId: '', at: 0, period: p.period, source: 'hand' }));
  // Nothing before the record starts.
  for (let i = all.length - 1; i >= 0; i--) if (all[i].date < fromDay) all.splice(i, 1);
  all.sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  // One payment spread over several invoices is still one payment.
  const merged = [];
  all.forEach(p => {
    const same = p.paymentId && merged.find(m => m.paymentId === p.paymentId);
    if (same) { same.amount = round2(same.amount + p.amount); if (p.period && !same.periods.includes(p.period)) same.periods.push(p.period); return; }
    merged.push(Object.assign({}, p, { periods: p.period ? [p.period] : [] }));
  });
  const lastPayment = merged[0] || null;
  const lastScreenshot = f.screenshots[0] || null;
  return {
    months, paidPeriods, paidText: monthsText(paidPeriods), paidCount: paidPeriods.length,
    thisMonthPaid: paidPeriods.includes(thisMonth),
    lastPayment, payments: merged.slice(0, 20),
    lastScreenshot, screenshots: f.screenshots,
    screenshotDaysAgo: lastScreenshot ? daysBetween(lastScreenshot.date, today) : null,
    paymentDaysAgo: lastPayment ? daysBetween(lastPayment.date, today) : null
  };
}
// "today", "yesterday", "5 days ago", "3 Nov"
export function daysAgoText(n, dayKey) {
  if (n == null || !isFinite(n)) return '';
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 14) return n + ' days ago';
  return dayKey ? prettyDate(dayKey) : n + ' days ago';
}

/* ── The records, one row per child, for the Families table and its CSV ── */
export function familyRecordRows(families, ctx) {
  const c = ctx || {};
  const out = [];
  (families || []).forEach(f0 => {
    const f = normalizeFamily(f0);
    const rec = familyPaymentRecord(f, c.invoices || [], c.payments || [], { today: c.today, months: c.months });
    const kids = f.students.filter(s => s.name && (c.includeLeft || s.status !== 'left'));
    (kids.length ? kids : [null]).forEach(st => {
      const types = st ? studentLessonTypes(st, c.schedule) : [];
      const type = types.length === 1 ? types[0] : '';
      const slots = st ? studentSlotIds(st) : [];
      out.push({
        familyId: f.id, studentId: st ? st.id : '', code: f.code,
        status: f.status, statusLabel: familyStatusLabel(f.status),
        studentStatus: st ? st.status : '',
        email: f.email, email2: f.email2,
        studentName: st ? st.name : '', parentName: f.parentName, whatsapp: f.whatsapp,
        school: st ? st.school : '', level: st ? st.level : '',
        since: (st && st.startDate) || f.signUpDate || '',
        lessonType: type, lessonTypes: types, lessonTypeLabel: types.map(lessonTypeLabel).join(' + '),
        slots: slots.map(id => { const cl = (st.classes || []).find(x => x.slotId === id) || {}; const md = classMode(cl, c.schedule); return { id, label: slotChoiceLabel(c.schedule, id), subject: scheduleSlot(c.schedule, id).subject || '', master: md === 'Master', mode: md, modeLabel: CLASS_MODE_META[md].label }; }),
        otherClasses: st ? st.classes.filter(x => x.custom).map(x => x.label || 'Other arrangement') : [],
        paidPeriods: rec.paidPeriods, paidText: rec.paidText, months: rec.months,
        thisMonthPaid: rec.thisMonthPaid,
        lastPayment: rec.lastPayment, lastScreenshot: rec.lastScreenshot,
        screenshotDaysAgo: rec.screenshotDaysAgo, paymentDaysAgo: rec.paymentDaysAgo,
        notes: [f.notes, st && st.notes].map(x => String(x || '').trim()).filter(Boolean).join(' · '),
        hardcopy: f.hardcopy, address: f.address,
        paymentType: f.paymentType, paymentTypeLabel: paymentTypeLabel(f.paymentType), packageStart: f.packageStart, packageEnd: f.packageEnd,
        withdrawn: f.withdrawn, lastMonth: f.lastMonth, pauseFrom: f.pauseFrom, pauseUntil: f.pauseUntil,
        statusText: familyStatusText(f)
      });
    });
  });
  return out;
}
export const FAMILY_RECORD_HEADERS = Object.freeze([
  'Status', 'Email (account ID)', 'Student name', 'Parent name', 'WhatsApp', 'Primary school', 'Level', 'With us since',
  'Slots (physical / online / master class)', 'Payment type', 'Package start', 'Package end', 'Months paid', 'Last payment', 'Last payment amount', 'Last screenshot',
  'Hardcopy subscription', 'Postal address', 'Withdrawal', 'Last month with us', 'Paused from', 'Paused until', 'Reference', 'Notes'
]);
export function familyRecordCsv(rows) {
  return toCsv([FAMILY_RECORD_HEADERS.slice(), ...(rows || []).map(r => [
    r.statusLabel, r.email, r.studentName, r.parentName, displayPhone(r.whatsapp), r.school, levelLabel(r.level), r.since,
    [...r.slots.map(s => s.label + ' (' + s.modeLabel + ')'), ...r.otherClasses].join('; '),
    r.paymentTypeLabel, r.paymentType === 'package' ? r.packageStart : '', r.paymentType === 'package' ? r.packageEnd : '', r.paidText,
    r.lastPayment ? r.lastPayment.date : '', r.lastPayment && r.lastPayment.amount ? moneyPlain(r.lastPayment.amount) : '',
    r.lastScreenshot ? r.lastScreenshot.date : '',
    r.hardcopy ? 'Yes' : 'No', r.hardcopy ? r.address : '', r.withdrawn ? 'Yes' : 'No', r.withdrawn && r.lastMonth ? periodLabel(r.lastMonth) : '',
    r.pauseFrom ? periodLabel(r.pauseFrom) : '', r.pauseUntil ? periodLabel(r.pauseUntil) : '',
    r.code ? familyReference(r.code) : '', r.notes
  ])]);
}

/* ── Hardcopy, payment type, withdrawal ──
   Hardcopy subscription: yes / no; yes needs a postal address (the family's
   `address`). Payment type: monthly payment, or a package with a start and an
   end date — the months a package covers are not invoiced monthly and count
   as paid. Withdrawal: yes / no; yes needs the last month with the centre,
   and nothing after it is invoiced. */
export const PAYMENT_TYPES = Object.freeze([
  Object.freeze({ key: 'monthly', label: 'Monthly payment' }),
  Object.freeze({ key: 'package', label: 'Package' })
]);
export const PAYMENT_TYPE_KEYS = Object.freeze(PAYMENT_TYPES.map(t => t.key));
export function paymentTypeLabel(key) { const t = PAYMENT_TYPES.find(x => x.key === key); return t ? t.label : 'Monthly payment'; }
// Whether a month falls inside the family's package (any day of it).
export function packageCovers(f, period) {
  if (!f || f.paymentType !== 'package' || !isPeriod(period)) return false;
  const start = isDayKey(f.packageStart) ? f.packageStart.slice(0, 7) : '';
  const end = isDayKey(f.packageEnd) ? f.packageEnd.slice(0, 7) : '';
  if (!start || !end) return false;
  return period >= start && period <= end;
}
export function packageText(f) {
  if (!f || f.paymentType !== 'package') return '';
  if (!f.packageStart && !f.packageEnd) return 'Package (dates not set)';
  return 'Package ' + (f.packageStart ? prettyDate(f.packageStart) : '?') + ' – ' + (f.packageEnd ? prettyDate(f.packageEnd) : '?');
}
export function withdrawalText(f) {
  if (!f || !f.withdrawn) return '';
  return 'Withdrawn' + (f.lastMonth ? ' · last month ' + periodLabel(f.lastMonth) : '');
}
// What these fields still need before the family can be saved.
export function extraFieldProblems(family) {
  const f = normalizeFamily(family);
  const out = [];
  if (f.hardcopy && !f.address) out.push({ level: 'block', field: 'address', text: 'Hardcopy subscription is Yes: type the postal address.' });
  if (f.paymentType === 'package') {
    if (!f.packageStart || !f.packageEnd) out.push({ level: 'block', field: 'package', text: 'Package: fill in the start date and the end date.' });
    else if (f.packageEnd < f.packageStart) out.push({ level: 'block', field: 'package', text: 'Package: the end date is before the start date.' });
  }
  if (f.withdrawn && !f.lastMonth) out.push({ level: 'warn', field: 'withdrawal', text: 'Withdrawn with no last month: not billed from now on. Choose the last month with us if they still have lessons to pay for.' });
  if (f.status === 'paused') {
    if (!f.pauseFrom) out.push({ level: 'block', field: 'pause', text: 'Paused: choose the first paused month.' });
    else if (f.pauseUntil && f.pauseUntil < f.pauseFrom) out.push({ level: 'block', field: 'pause', text: 'Paused: the last paused month is before the first.' });
  }
  return out;
}

// A few months around this one (for a card or a table row), from the full record.
export function monthsAround(months, period, before, after) {
  const list = months || [];
  const at = list.findIndex(m => m.period === period);
  if (at < 0) return list.slice(-(before + after + 1));
  return list.slice(Math.max(0, at - before), at + after + 1);
}

/* ── Sorting and filtering the families ──
   Level order is the centre's: P3, P4, P5, P6, S1, then children with no level.
   A family with children at different levels sorts by its YOUNGEST level
   (the lowest), and matches a level filter if ANY child is at that level —
   the table then shows only the children who match. Every filter combines
   with every other (all must hold). */
export const FAMILY_SORTS = Object.freeze([
  Object.freeze({ key: 'level', label: 'Level (P3 → S1)' }),
  Object.freeze({ key: 'level-desc', label: 'Level (S1 → P3)' }),
  Object.freeze({ key: 'parent', label: 'Parent name A–Z' }),
  Object.freeze({ key: 'student', label: 'Student name A–Z' }),
  Object.freeze({ key: 'school', label: 'Primary school A–Z' }),
  Object.freeze({ key: 'newest', label: 'Newest sign-up first' }),
  Object.freeze({ key: 'oldest', label: 'Oldest sign-up first' })
]);
export const FAMILY_SORT_KEYS = Object.freeze(FAMILY_SORTS.map(s => s.key));
export function levelRank(level) {
  const i = LEVELS.indexOf(normalizeLevel(level));
  return i < 0 ? LEVELS.length : i;
}
// The children who count: everyone except those who have left.
function currentKids(f) { return (f.students || []).filter(s => s.status !== 'left'); }
export function familyLevelRank(f, desc) {
  const ranks = currentKids(f).map(s => levelRank(s.level)).filter(r => r < LEVELS.length);
  if (!ranks.length) return desc ? -1 : LEVELS.length;
  return desc ? Math.max(...ranks) : Math.min(...ranks);
}
export function familyLevels(f) {
  return [...new Set(currentKids(f).map(s => normalizeLevel(s.level)).filter(Boolean))].sort((a, b) => levelRank(a) - levelRank(b));
}
const byText = (a, b) => String(a || '').localeCompare(String(b || ''), 'en', { sensitivity: 'base' });
const firstKidName = f => currentKids(f).map(s => s.name).filter(Boolean).sort(byText)[0] || '';
const firstSchool = f => currentKids(f).map(s => s.school).filter(Boolean).sort(byText)[0] || '';
const signedUp = f => f.signUpDate || currentKids(f).map(s => s.startDate).filter(Boolean).sort()[0] || '';
export function sortFamilies(families, key) {
  const k = FAMILY_SORT_KEYS.includes(key) ? key : 'level';
  const list = (families || []).slice();
  const cmp = {
    level: (a, b) => familyLevelRank(a) - familyLevelRank(b) || byText(a.parentName, b.parentName),
    'level-desc': (a, b) => familyLevelRank(b, true) - familyLevelRank(a, true) || byText(a.parentName, b.parentName),
    parent: (a, b) => byText(a.parentName, b.parentName),
    student: (a, b) => (!firstKidName(a)) - (!firstKidName(b)) || byText(firstKidName(a), firstKidName(b)) || byText(a.parentName, b.parentName),
    school: (a, b) => (!firstSchool(a)) - (!firstSchool(b)) || byText(firstSchool(a), firstSchool(b)) || byText(a.parentName, b.parentName),
    newest: (a, b) => byText(signedUp(b), signedUp(a)) || byText(a.parentName, b.parentName),
    oldest: (a, b) => (!signedUp(a)) - (!signedUp(b)) || byText(signedUp(a), signedUp(b)) || byText(a.parentName, b.parentName)
  }[k];
  return list.sort(cmp);
}
// The same order for the table's rows (one per child): by the child's own level.
export function sortRecordRows(rows, key) {
  const k = FAMILY_SORT_KEYS.includes(key) ? key : 'level';
  const list = (rows || []).slice();
  if (k === 'level' || k === 'level-desc') {
    const dir = k === 'level' ? 1 : -1;
    return list.sort((a, b) => {
      const ra = levelRank(a.level), rb = levelRank(b.level);
      const na = ra >= LEVELS.length, nb = rb >= LEVELS.length;
      if (na !== nb) return na ? 1 : -1;   // no level: always last
      return (ra - rb) * dir || byText(a.parentName, b.parentName) || byText(a.studentName, b.studentName);
    });
  }
  if (k === 'student') return list.sort((a, b) => byText(a.studentName, b.studentName));
  if (k === 'school') return list.sort((a, b) => (!a.school) - (!b.school) || byText(a.school, b.school) || byText(a.studentName, b.studentName));
  return list;   // parent / newest / oldest: the families' order, children kept together
}

export const EMPTY_FAMILY_FILTERS = Object.freeze({
  level: '', subject: '', mode: '', day: '', slot: '', school: '', lessonType: '',
  payment: '', hardcopy: '', withdrawn: '', month: '', paid: ''
});
export function cleanFamilyFilters(raw) {
  const out = Object.assign({}, EMPTY_FAMILY_FILTERS);
  Object.keys(out).forEach(k => { if (raw && raw[k] != null) out[k] = String(raw[k]); });
  return out;
}
export function activeFamilyFilters(F) {
  const f = cleanFamilyFilters(F);
  return Object.keys(f).filter(k => f[k] && !(k === 'month' && !f.paid));
}
// Child-level tests: a child matches when every child filter holds for them.
export function studentMatchesFilters(st, F, schedule) {
  const f = cleanFamilyFilters(F);
  if (!st || st.status === 'left') return false;
  if (f.level && normalizeLevel(st.level) !== f.level) return false;
  if (f.school && normText(st.school) !== normText(f.school)) return false;
  if (f.lessonType && !studentHasLessonType(st, f.lessonType, schedule)) return false;
  const cls = (st.classes || []).filter(c => c && (c.custom || isValidSlotId(c.slotId)));
  if (f.slot && !cls.some(c => !c.custom && c.slotId === f.slot)) return false;
  if (f.day && !cls.some(c => !c.custom && String(c.slotId).split('-')[0] === f.day)) return false;
  if (f.mode && !cls.some(c => classMode(c, schedule) === f.mode)) return false;
  if (f.subject && !cls.some(c => !c.custom && subjectKey(scheduleSlot(schedule, c.slotId).subject) === subjectKey(f.subject))) return false;
  return true;
}
export function hasChildFilters(F) {
  const f = cleanFamilyFilters(F);
  return !!(f.level || f.school || f.lessonType || f.slot || f.day || f.mode || f.subject);
}
// Family-level tests, then: at least one child matches the child filters.
// ctx: { schedule, invoices, payments, today } — for the month paid / not paid test.
export function familyMatchesFilters(family, F, ctx) {
  const f = cleanFamilyFilters(F);
  const c = ctx || {};
  const fam = normalizeFamily(family);
  if (f.payment && fam.paymentType !== f.payment) return false;
  if (f.hardcopy && fam.hardcopy !== (f.hardcopy === 'yes')) return false;
  if (f.withdrawn && fam.withdrawn !== (f.withdrawn === 'yes')) return false;
  if (f.paid) {
    const period = isPeriod(f.month) ? f.month : (c.today ? String(c.today).slice(0, 7) : sgMonthKey());
    const rec = c.record || familyPaymentRecord(fam, c.invoices || [], c.payments || [], { today: c.today });
    const mo = rec.months.find(m => m.period === period);
    const paid = !!mo && ['paid', 'hand', 'package'].includes(mo.key);
    if (f.paid === 'paid' && !paid) return false;
    if (f.paid === 'unpaid' && (paid || (mo && mo.key === 'gone'))) return false;
  }
  if (hasChildFilters(f)) return currentKids(fam).some(st => studentMatchesFilters(st, f, c.schedule));
  return true;
}
// The choices the filter drop-downs offer, from the families themselves.
export function familyFilterOptions(families, schedule) {
  const schools = new Map();
  (families || []).forEach(f => currentKids(f).forEach(s => {
    const name = String(s.school || '').trim();
    if (name && !schools.has(normText(name))) schools.set(normText(name), name);
  }));
  const used = new Set();
  (families || []).forEach(f => currentKids(f).forEach(s => (s.classes || []).forEach(c => { if (c && !c.custom && isValidSlotId(c.slotId)) used.add(c.slotId); })));
  const slots = allSlotIds().filter(id => slotHasClass(scheduleSlot(schedule, id)) || used.has(id))
    .map(id => ({ id, label: slotChoiceLabel(schedule, id) }));
  return { schools: [...schools.values()].sort(byText), slots };
}

/* ═══════════════ 📊 Families: key statistics (v1.6.0) ═══════════════
   The summary on top of the Families tab. Two money figures, never mixed:
     • Monthly fees — what ONE month of lessons is worth at today's schedule
       fees (a child's own fee or a class's own rate wins), for every child who
       is active in an active family that has not left by the month. Package
       families count too: the figure is the value of the enrolment, not what
       is invoiced. Sibling discounts are shown on their own line.
     • Collected — money recorded against that month's invoices (capped at
       each invoice's total), split over the invoice's lines in proportion.
   Categories: Math / Science by the class's subject; Online regular,
   Physical regular and Master class by the class itself (a Master Class slot,
   else its mode). A child counts once in each category they take a class in,
   so Math + Science can be more than the number of children. */
export const STAT_CATEGORIES = Object.freeze([
  Object.freeze({ key: 'math', group: 'subject', label: 'Math', icon: '➗' }),
  Object.freeze({ key: 'science', group: 'subject', label: 'Science', icon: '🔬' }),
  Object.freeze({ key: 'online', group: 'type', label: 'Online regular', icon: '💻' }),
  Object.freeze({ key: 'physical', group: 'type', label: 'Physical regular', icon: '🏫' }),
  Object.freeze({ key: 'master', group: 'type', label: 'Master class', icon: '⭐' })
]);
// Which categories one class (or one invoice line) belongs to.
export function classCategories(cls, schedule) {
  const c = cls || {};
  if (c.custom || (!c.slotId && c.label)) {
    const text = String(c.label || c.desc || '');
    const subject = /sci/i.test(text) ? 'science' : (/math/i.test(text) ? 'math' : '');
    const type = /master/i.test(text) || c.mode === 'Master' ? 'master' : (c.mode === 'Online' ? 'online' : 'physical');
    return { subject, type };
  }
  const slot = scheduleSlot(schedule, c.slotId);
  const sk = subjectKey(slot.subject);
  return {
    subject: sk === 'math' || sk === 'science' ? sk : '',
    type: classModeKey(c, schedule)
  };
}
// The child's classes that the statistics read (valid slots and custom classes).
function statClasses(st) {
  return (st.classes || []).filter(c => c && (c.custom || isValidSlotId(c.slotId)));
}
// One family's monthly fee lines, each with its categories. A child's own
// monthly fee is shared over their classes in proportion to the schedule fees
// (equally when the schedule has none); with no class it is 'unsorted'.
export function familyFeeParts(family, schedule, kidFilter) {
  const f = normalizeFamily(family);
  const parts = [];
  let discount = 0;
  const kids = activeStudents(f).filter(st => !kidFilter || kidFilter(st));
  kids.forEach(st => {
    const cls = statClasses(st);
    const own = feeNum(st.monthlyFee);
    const priced = cls.map(c => ({ c, amount: c.custom ? feeNum(c.rate) : (feeNum(c.rate) || monthlyFeeFor(scheduleSlot(schedule, c.slotId), c.mode, schedule)) }));
    if (own) {
      if (!priced.length) { parts.push({ studentId: st.id, amount: own, subject: '', type: '', unsorted: true }); return; }
      const sum = priced.reduce((s, p) => s + p.amount, 0);
      priced.forEach(p => parts.push(Object.assign({ studentId: st.id, amount: round2(own * (sum > 0 ? p.amount / sum : 1 / priced.length)) }, classCategories(p.c, schedule))));
      return;
    }
    priced.forEach(p => parts.push(Object.assign({ studentId: st.id, amount: p.amount }, classCategories(p.c, schedule))));
  });
  const gross = round2(parts.reduce((s, p) => s + p.amount, 0));
  if (f.discount && gross > 0) {
    const d = f.discount;
    discount = d.kind === 'percent' ? round2(gross * Math.min(100, feeNum(d.value)) / 100) : Math.min(gross, feeNum(d.value));
  }
  return { parts, gross, discount };
}
// An invoice's collected money, split over its positive lines.
export function invoiceCollectedParts(inv, schedule, kidOk) {
  if (!inv || inv.status === 'void') return [];
  const collected = Math.min(Number(inv.paid) || 0, Number(inv.total) || 0);
  if (!(collected > 0)) return [];
  const pos = (inv.lines || []).filter(l => Number(l.amount) > 0);
  const sum = pos.reduce((s, l) => s + Number(l.amount), 0);
  if (!(sum > 0)) return [{ studentId: '', amount: round2(collected), subject: '', type: '', unsorted: true }];
  return pos.filter(l => !kidOk || !l.studentId || kidOk(l.studentId))
    .map(l => {
      const amount = round2(collected * Number(l.amount) / sum);
      if (l.kind === 'class' || l.slotId) return Object.assign({ studentId: l.studentId || '', amount }, classCategories({ slotId: l.slotId, mode: l.mode }, schedule));
      if (l.kind === 'custom') return Object.assign({ studentId: l.studentId || '', amount }, classCategories({ custom: true, label: l.desc, mode: l.detail }, schedule));
      // A child's own monthly fee line, or a line typed by hand: read its words.
      const cat = classCategories({ custom: true, label: (l.desc || '') + ' ' + (l.detail || ''), mode: /online/i.test(l.detail || '') ? 'Online' : 'Physical' }, schedule);
      const known = /math|sci|master/i.test((l.desc || '') + ' ' + (l.detail || ''));
      return Object.assign({ studentId: l.studentId || '', amount }, known ? cat : { subject: '', type: '', unsorted: true });
    });
}
// A family counts in a month when it is active and has not left before it.
export function familyCurrentIn(f, period) {
  return familyStateIn(f, period) === 'active';
}
// ctx: { schedule, invoices, period, today, kidFilter(student) }
export function familyStats(families, ctx) {
  const c = ctx || {};
  const schedule = c.schedule || {};
  const period = isPeriod(c.period) ? c.period : (c.today ? String(c.today).slice(0, 7) : sgMonthKey());
  const cats = {};
  STAT_CATEGORIES.forEach(k => { cats[k.key] = { key: k.key, label: k.label, icon: k.icon, group: k.group, students: 0, families: 0, fees: 0, collected: 0 }; });
  const out = {
    period, families: 0, students: 0, paused: 0, pausedFamilies: 0, noClass: 0, both: 0,
    fees: 0, discounts: 0, net: 0, unsortedFees: 0,
    collected: 0, billed: 0, outstanding: 0, invoices: 0, unsortedCollected: 0,
    categories: cats
  };
  const famIds = new Set();
  (families || []).forEach(raw => {
    const f = normalizeFamily(raw);
    const state = familyStateIn(f, period);
    if (state === 'withdrawn') return;
    const kids = (f.students || []).filter(st => st.status !== 'left' && (!c.kidFilter || c.kidFilter(st)));
    // A paused family: its children are counted as paused, not in the totals.
    if (state === 'paused') { out.paused += kids.length; if (kids.length) out.pausedFamilies++; return; }
    const active = kids.filter(st => st.status === 'active');
    out.paused += kids.filter(st => st.status === 'paused').length;
    if (!active.length) return;
    out.families++;
    famIds.add(f.id);
    const famIn = new Set();
    active.forEach(st => {
      out.students++;
      const cls = statClasses(st);
      if (!cls.length) { out.noClass++; return; }
      const mine = new Set();
      cls.forEach(cl => { const k = classCategories(cl, schedule); if (k.subject) mine.add(k.subject); if (k.type) mine.add(k.type); });
      mine.forEach(k => { cats[k].students++; famIn.add(k); });
      if (mine.has('math') && mine.has('science')) out.both++;
    });
    famIn.forEach(k => { cats[k].families++; });
    const activeIds = new Set(active.map(st => st.id));
    const fee = familyFeeParts(f, schedule, st => activeIds.has(st.id));
    fee.parts.forEach(p => {
      if (p.unsorted) { out.unsortedFees = round2(out.unsortedFees + p.amount); return; }
      if (p.subject) cats[p.subject].fees = round2(cats[p.subject].fees + p.amount);
      if (p.type) cats[p.type].fees = round2(cats[p.type].fees + p.amount);
    });
    out.fees = round2(out.fees + fee.gross);
    out.discounts = round2(out.discounts + fee.discount);
  });
  out.net = round2(out.fees - out.discounts);
  // Collected for the month, from that month's invoices of the same families.
  const kidsById = new Map();
  (families || []).forEach(f => (f.students || []).forEach(st => kidsById.set((f.id || '') + '|' + st.id, st)));
  (c.invoices || []).forEach(inv => {
    if (!inv || inv.status === 'void' || inv.period !== period || !famIds.has(inv.familyId)) return;
    out.invoices++;
    out.billed = round2(out.billed + (Number(inv.total) || 0));
    out.outstanding = round2(out.outstanding + invoiceOutstanding(inv));
    const kidOk = c.kidFilter ? (sid => { const st = kidsById.get(inv.familyId + '|' + sid); return !st || c.kidFilter(st); }) : null;
    invoiceCollectedParts(inv, schedule, kidOk).forEach(p => {
      out.collected = round2(out.collected + p.amount);
      if (p.unsorted) { out.unsortedCollected = round2(out.unsortedCollected + p.amount); return; }
      if (p.subject) cats[p.subject].collected = round2(cats[p.subject].collected + p.amount);
      if (p.type) cats[p.type].collected = round2(cats[p.type].collected + p.amount);
    });
  });
  out.percent = out.billed > 0 ? Math.round(Math.min(out.collected, out.billed) / out.billed * 100) : 0;
  return out;
}

/* ═══════════════ 📣 Announcements to parents (v1.7.0) ═══════════════
   One email per family, to the family's own address(es) only — never a list
   of parents in To or Cc — from "Polymath Learning Centre <admin@…>".
   The admin writes a subject and a message; {parent} and {children} are
   filled in for each family. Who gets it: the same filters as Families, then
   a tick per family. Each send is logged in officeSettings (kind
   'announcement') with every family, address and mail id. */
export const ANNOUNCE_TOKENS = Object.freeze([
  Object.freeze({ token: '{parent}', label: 'Parent\'s name', example: 'Mrs Tan' }),
  Object.freeze({ token: '{children}', label: 'Children\'s names', example: 'Jun Wei and Mei' })
]);
export const ANNOUNCE_LIMITS = Object.freeze({ subject: 150, body: 10000, log: 400 });
export const ANNOUNCE_STATUSES = Object.freeze([
  Object.freeze({ key: 'active', label: 'Active families' }),
  Object.freeze({ key: 'paused', label: 'Paused' }),
  Object.freeze({ key: 'withdrawn', label: 'Withdrawn' }),
  Object.freeze({ key: 'all', label: 'Everyone' })
]);
export function emptyAnnouncement() {
  return { subject: '', body: '', greet: true };
}
export function cleanAnnouncement(raw) {
  const a = Object.assign(emptyAnnouncement(), raw || {});
  return {
    subject: String(a.subject || '').replace(/\s+/g, ' ').trim().slice(0, ANNOUNCE_LIMITS.subject),
    body: String(a.body || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, ANNOUNCE_LIMITS.body),
    greet: a.greet !== false && a.greet !== 'no'
  };
}
// The children who count for a family's greeting: everyone still with us
// (those who left are not named); when a filter is on, only those it shows.
export function announceChildren(family, kidFilter) {
  const kids = (family.students || []).filter(s => s.status !== 'left' && String(s.name || '').trim());
  const shown = kidFilter ? kids.filter(kidFilter) : kids;
  return (shown.length ? shown : kids).map(s => String(s.name).trim());
}
export function fillAnnouncement(text, family, kidFilter) {
  const f = family || {};
  const parent = String(f.parentName || '').trim() || 'Parent';
  const kids = listJoin(announceChildren(f, kidFilter)) || 'your child';
  return String(text || '').replace(/\{\s*parent\s*\}/gi, parent).replace(/\{\s*children\s*\}/gi, kids);
}
// {anything} the admin typed that is not one we fill in.
export function unknownTokens(text) {
  const known = ANNOUNCE_TOKENS.map(t => t.token.slice(1, -1));
  return [...new Set((String(text || '').match(/\{[^{}\n]{1,30}\}/g) || [])
    .filter(t => !known.includes(t.slice(1, -1).trim().toLowerCase())))];
}
export function announcementProblems(raw) {
  const a = cleanAnnouncement(raw);
  const out = [];
  if (!a.subject) out.push({ level: 'block', field: 'subject', text: 'Write a subject.' });
  if (!a.body) out.push({ level: 'block', field: 'body', text: 'Write the message.' });
  if (String((raw || {}).subject || '').trim().length > ANNOUNCE_LIMITS.subject) out.push({ level: 'warn', field: 'subject', text: 'The subject is cut to ' + ANNOUNCE_LIMITS.subject + ' characters.' });
  if (String((raw || {}).body || '').trim().length > ANNOUNCE_LIMITS.body) out.push({ level: 'warn', field: 'body', text: 'The message is cut to ' + ANNOUNCE_LIMITS.body + ' characters.' });
  const unk = unknownTokens(a.subject + '\n' + a.body);
  if (unk.length) out.push({ level: 'warn', field: 'body', text: unk.join(', ') + (unk.length === 1 ? ' is' : ' are') + ' not filled in — use {parent} or {children}, or it is sent as typed.' });
  if (a.greet && /^\s*(dear|hi|hello)\b/i.test(a.body)) out.push({ level: 'warn', field: 'body', text: 'The message starts with its own greeting and "Dear …," is added too. Untick "Start with Dear …" or remove one.' });
  return out;
}
// Text → safe HTML: paragraphs on blank lines, line breaks kept, web links
// and email addresses made clickable, **bold** kept as bold.
export function announcementBodyHtml(text) {
  const paras = String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const inline = s => escapeHtml(s)
    .replace(/\*\*([^*\n]{1,200})\*\*/g, '<b>$1</b>')
    .replace(/\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])/g, '<a href="$1" style="color:#056c76;">$1</a>')
    .replace(/(^|[\s(])((?:www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"']*[^\s<>"'.,;:!?)])?)/gi, '$1<a href="https://$2" style="color:#056c76;">$2</a>')
    .replace(/(^|[\s(])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1<a href="mailto:$2" style="color:#056c76;">$2</a>')
    .replace(/\n/g, '<br>');
  return paras.map(p => '<p style="font-size:15px;line-height:1.65;margin:0 0 14px;">' + inline(p) + '</p>').join('');
}
export function announcementEmail(raw, family, settings, opts) {
  const s = normalizeSettings(settings);
  const o = opts || {};
  const a = cleanAnnouncement(raw);
  const subject = fillAnnouncement(a.subject, family, o.kidFilter) || 'Polymath announcement';
  const body = fillAnnouncement(a.body, family, o.kidFilter);
  const parent = String((family || {}).parentName || '').trim() || 'Parent';
  const greet = a.greet ? 'Dear ' + parent + ',' : '';
  const html = emailShell(subject,
    (greet ? '<p style="font-size:15px;line-height:1.6;margin:0 0 14px;">' + escapeHtml(greet) + '</p>' : '')
    + announcementBodyHtml(body), s);
  const text = [greet, greet ? '' : null, body.replace(/\*\*([^*\n]{1,200})\*\*/g, '$1'), '', s.signature, '',
    'Questions? WhatsApp us on ' + displayPhone(s.centreWhatsapp) + ' · ' + SITE].filter(x => x !== null).join('\n');
  return { subject, html, text };
}
// Who gets it. sel: { status, type, search, filters, excluded:[familyId] }
// ctx: { schedule, invoices, payments, today, record(f), kidFilter(f) → (student → bool) }
// Every family that passes the filters gets a row; a row is SENT only when it
// is ticked and has an email that an earlier row has not already taken.
export function announceAudience(families, sel, ctx) {
  const s = Object.assign({ status: 'active', type: '', search: '', filters: {}, excluded: [] }, sel || {});
  const c = ctx || {};
  const F = cleanFamilyFilters(s.filters);
  const excluded = new Set(s.excluded || []);
  const words = normText(s.search).split(' ').filter(Boolean);
  const rows = [];
  const taken = new Map();   // email → parent who already gets it
  sortFamilies((families || []).map(normalizeFamily), 'parent').forEach(f => {
    // This month's state: a family that has withdrawn but still has a month to
    // go counts as active; a pause that has not started yet too.
    const want = s.status === 'inactive' ? 'withdrawn' : s.status;
    if (want !== 'all' && familyStateIn(f, c.today ? String(c.today).slice(0, 7) : sgMonthKey()) !== want) return;
    if (s.type && !(f.students || []).some(st => st.status !== 'left' && studentHasLessonType(st, s.type, c.schedule))) return;
    if (!familyMatchesFilters(f, F, { schedule: c.schedule, invoices: c.invoices, payments: c.payments, today: c.today, record: c.record ? c.record(f) : undefined })) return;
    if (words.length) {
      const hay = normText([f.parentName, f.email, f.email2, f.code, ...(f.students || []).map(st => st.name + ' ' + st.school)].join(' '));
      if (!words.every(w => hay.includes(w))) return;
    }
    const childOk = (hasChildFilters(F) || s.type)
      ? st => studentHasLessonType(st, s.type, c.schedule) && (!hasChildFilters(F) || studentMatchesFilters(st, F, c.schedule))
      : null;
    const emails = familyEmails(f);
    const ticked = !excluded.has(f.id);
    const fresh = emails.filter(e => !taken.has(e));
    const dupOf = emails.filter(e => taken.has(e)).map(e => taken.get(e));
    const row = {
      familyId: f.id, parentName: f.parentName || '', code: f.code || '',
      children: announceChildren(f, childOk), emails, to: ticked ? fresh : [],
      ticked, noEmail: !emails.length, dupOf: [...new Set(dupOf)], childOk
    };
    row.send = ticked && row.to.length > 0;
    if (row.send) row.to.forEach(e => taken.set(e, f.parentName || 'another family'));
    rows.push(row);
  });
  const sending = rows.filter(r => r.send);
  return {
    rows, sending,
    families: sending.length,
    addresses: sending.reduce((n, r) => n + r.to.length, 0),
    noEmail: rows.filter(r => r.noEmail).length,
    unticked: rows.filter(r => !r.ticked).length,
    shared: rows.filter(r => r.ticked && !r.noEmail && !r.send).length
  };
}
// Words for the log: what the filters were when it was sent.
export function audienceSummary(sel, schedule) {
  const s = Object.assign({ status: 'active', type: '', search: '', filters: {} }, sel || {});
  const F = cleanFamilyFilters(s.filters);
  const parts = [(ANNOUNCE_STATUSES.find(x => x.key === (s.status === 'inactive' ? 'withdrawn' : s.status)) || ANNOUNCE_STATUSES[0]).label];
  if (s.type) parts.push(lessonTypeLabel(s.type));
  if (F.level) parts.push(levelLabel(F.level));
  if (F.subject) parts.push(F.subject);
  if (F.mode) parts.push(CLASS_MODE_META[F.mode] ? CLASS_MODE_META[F.mode].label : F.mode);
  if (F.day) parts.push((DAYS.find(d => d.code === F.day) || { name: F.day }).name);
  if (F.slot) parts.push(slotChoiceLabel(schedule || {}, F.slot));
  if (F.school) parts.push(F.school);
  if (F.payment) parts.push(F.payment === 'package' ? 'Package' : 'Monthly');
  if (F.hardcopy) parts.push(F.hardcopy === 'yes' ? 'Hardcopy' : 'No hardcopy');
  if (F.withdrawn) parts.push(F.withdrawn === 'yes' ? 'Withdrawn' : 'Not withdrawn');
  if (F.paid) parts.push((F.paid === 'paid' ? 'Paid ' : 'Not paid ') + periodLabel(isPeriod(F.month) ? F.month : sgMonthKey()));
  if (String(s.search || '').trim()) parts.push('"' + String(s.search).trim() + '"');
  return parts.join(' · ');
}
export function announcementLogId(now) { return 'announcement-' + (now == null ? Date.now() : Number(now)); }
// The log document (officeSettings/<announcementLogId>).
export function announcementLog(raw, audience, meta) {
  const a = cleanAnnouncement(raw);
  const m = meta || {};
  return {
    kind: 'announcement',
    subject: a.subject, body: a.body, greet: a.greet,
    audience: String(m.audience || ''),
    sentBy: String(m.sentBy || ''), sentAtMs: Number(m.at) || Date.now(),
    families: (audience.sending || []).length,
    addresses: (audience.sending || []).reduce((n, r) => n + r.to.length, 0),
    recipients: (audience.sending || []).slice(0, ANNOUNCE_LIMITS.log).map(r => ({ familyId: r.familyId, parentName: r.parentName, to: r.to, mailId: r.mailId || '' })),
    failed: (m.failed || []).slice(0, 100).map(x => ({ parentName: String(x.parentName || ''), error: String(x.error || '').slice(0, 200) })),
    test: !!m.test
  };
}

/* ═══════════════ 📊 A statistics category, opened (v1.10.0) ═══════════════
   Clicking Math, Science, Online regular, Physical regular or Master class
   (or Students) on the statistics panel lists the children counted there —
   the same children familyStats counts, with the classes that put them in it.
   STAT_CATEGORY_FILTER says which Families filter picks the same families, so
   the list can be shown on the Families tab or handed to Announce. */
export const STAT_CATEGORY_FILTER = Object.freeze({
  math: Object.freeze({ subject: 'Math' }),
  science: Object.freeze({ subject: 'Science' }),
  online: Object.freeze({ mode: 'Online' }),
  physical: Object.freeze({ mode: 'Physical' }),
  master: Object.freeze({ mode: 'Master' }),
  all: Object.freeze({})
});
export function statCategoryLabel(key) {
  if (key === 'all') return 'All students';
  const k = STAT_CATEGORIES.find(x => x.key === key);
  return k ? k.label : '';
}
// ctx: { schedule, period, today, kidFilter(student) }
export function categoryStudents(families, key, ctx) {
  const c = ctx || {};
  const schedule = c.schedule || {};
  const period = isPeriod(c.period) ? c.period : (c.today ? String(c.today).slice(0, 7) : sgMonthKey());
  const rows = [];
  (families || []).forEach(raw => {
    const f = normalizeFamily(raw);
    if (familyStateIn(f, period) !== 'active') return;
    activeStudents(f).filter(st => !c.kidFilter || c.kidFilter(st)).forEach(st => {
      const cls = statClasses(st).map(cl => {
        const cat = classCategories(cl, schedule);
        const slot = cl.custom ? null : scheduleSlot(schedule, cl.slotId);
        const mode = cl.custom ? (CLASS_MODES.includes(cl.mode) ? cl.mode : 'Physical') : classMode(cl, schedule);
        return {
          slotId: cl.slotId || '', custom: !!cl.custom,
          label: cl.custom ? (cl.label || 'Other arrangement') : slotShortLabel(cl.slotId) + ' · ' + (slotHasClass(slot) ? levelLabel(slot.level) + ' ' + slot.subject : 'no class'),
          subject: cat.subject, type: cat.type, mode, modeLabel: CLASS_MODE_META[mode].label,
          fee: cl.custom ? feeNum(cl.rate) : (feeNum(cl.rate) || monthlyFeeFor(slot, mode, schedule))
        };
      });
      const hits = key === 'all' ? cls : cls.filter(x => x.subject === key || x.type === key);
      if (key !== 'all' && !hits.length) return;
      rows.push({
        familyId: f.id, parentName: f.parentName, code: f.code, emails: familyEmails(f), whatsapp: f.whatsapp,
        studentId: st.id, name: st.name, level: st.level, school: st.school,
        classes: hits, allClasses: cls,
        fees: round2(hits.reduce((n, x) => n + x.fee, 0))
      });
    });
  });
  return rows.sort((a, b) => levelRank(a.level) - levelRank(b.level) || byText(a.name, b.name) || byText(a.parentName, b.parentName));
}
// The Families filters that pick the same families as a category.
export function categoryFilters(key, base) {
  return cleanFamilyFilters(Object.assign({}, base || {}, STAT_CATEGORY_FILTER[key] || {}));
}
// One CSV of a category's children.
export function categoryCsv(rows) {
  return toCsv([['Student', 'Level', 'Primary school', 'Classes', 'Fees a month', 'Parent', 'Email', 'WhatsApp'],
    ...(rows || []).map(r => [r.name, levelLabel(r.level), r.school, r.classes.map(x => x.label + ' (' + x.modeLabel + ')').join('; '), moneyPlain(r.fees), r.parentName, r.emails.join('; '), displayPhone(r.whatsapp)])]);
}
