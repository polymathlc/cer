'use strict';

// Free Question of the Day: everything that does not touch Firestore or HTTP.
//
// Shared by the dailyQuestion function (daily-question.js, which serves the page
// at polymathlc.com.sg/question and the home page box, and handles sign-ups) and
// by the GitHub Actions sender (tools/daily-question-send.mjs, which emails the
// questions every morning). Keeping the rotation, the links and the emails in one
// place means the page, the welcome email and the morning email always agree.
//
// THE QUESTIONS. Each Singapore day has one Maths and one Science question from
// daily-question-bank.js. The first time a day is asked for, its pair is written
// to trialSettings/dailyQuestion/days/{day}, so the question a day showed never
// changes later, even when new questions are added to the bank. The worked answer
// is only shown from the next day.
//
// THE SUBSCRIBERS live in trialSettings/dailyQuestion/subscribers/{id}, where id is
// a hash of the email address. trialSettings/** is closed to every browser by the
// /trial Firestore rules, so only the function and the sender can read them.
// Sign-up is double opt-in: nothing is sent except the confirmation email until
// the parent clicks the link in it. Every email carries a one-click unsubscribe.
const { createHash, randomBytes } = require('node:crypto');
const { MATH, SCIENCE } = require('./daily-question-bank');
const pool = require('./daily-question-pool');

const SENDER_EMAIL = 'admin@polymathlc.com.sg';
const SENDER_NAME = 'Polymath Learning Centre';
const NOTIFICATION_EMAILS = Object.freeze(['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg']);
// Who may open polymathlc.com.sg/question/#admin. Keep equal to ACCESS_ADMINS in student/access-gate.js.
const QOTD_ADMINS = Object.freeze(['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg']);

const ROOT = Object.freeze(['trialSettings', 'dailyQuestion']);
const SUBSCRIBERS = 'subscribers';
const DAYS = 'days';
const RUNS = 'runs';
const MAIL_COLLECTION = 'mail';
const LIMIT_COLLECTION = 'shop_checkout_limits';

const SITE = 'https://polymathlc.com.sg';
const PAGE_URL = SITE + '/question/';
const FUNCTION_URL = 'https://us-central1-mathgen--app.cloudfunctions.net/dailyQuestion';
const DIAGNOSTIC_URL = SITE + '/diagnostic/';
const SCHEDULE_URL = SITE + '/schedule/';
const LOGO_URL = 'https://dl.dropboxusercontent.com/scl/fi/h40yjlyg8ldefwfaa3dib/polymath-logo-sticker.png?rlkey=o1ra4taqy79gt9t8u096v82zj';
const WHATSAPP_NUMBER = '6596450588';
const WHATSAPP_DISPLAY = '+65 9645 0588';

// The first day of the Question of the Day. Days before it have no question.
const START_DAY = '2026-11-20';
// The rotation steps through each list with a stride that shares no factor with
// its length, so every question is used once before any repeats, and the levels
// and topics are mixed from day to day. Checked by the tests whenever the bank grows.
const STRIDES = Object.freeze({ math: 17, science: 11 });
const OFFSETS = Object.freeze({ math: 0, science: 5 });

const SUBJECTS = Object.freeze(['math', 'science']);
const SUBJECT_LABEL = Object.freeze({ math: 'Maths', science: 'Science' });
const BANK = Object.freeze({ math: MATH, science: SCIENCE });
const FREQUENCIES = Object.freeze(['daily', 'weekly']);
const CHILD_LEVELS = Object.freeze(['', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'Secondary', 'Other']);
// A new sign-up must give a level we set questions for, so nobody is sent one above their child.
const SIGNUP_LEVELS = Object.freeze(['P3', 'P4', 'P5', 'P6']);
// The level the page shows before a visitor picks one.
const DEFAULT_PAGE_LEVEL = 'P5';
const STATUSES = Object.freeze(['pending', 'active', 'unsubscribed']);
// The weekly digest goes out on Saturday (Singapore), with the past seven days.
const WEEKLY_WEEKDAY = 6;
// Gmail limits. The Trigger Email extension signs in to a Gmail account to send
// every Polymath email (invoices, receipts, reports, these). A regular Gmail
// account may send to about 500 recipients a day and a Google Workspace account
// about 2,000. The question emails stop at the daily cap so the rest of the day's
// emails always get through. The admin page shows it and can change it.
const DEFAULT_DAILY_CAP = 200;
const MAX_DAILY_CAP = 1800;
const GMAIL_LIMITS = Object.freeze({ gmail: 500, workspace: 2000 });
// Sign-up limits: per IP an hour, all sign-up emails a day, and per address.
const LIMITS = Object.freeze({ perIpHour: 8, globalDay: 300, addressGapMs: 3 * 60000, addressMails: 6, adminTestGapMs: 30000 });
const CONSENT_TEXT = 'I agree to receive the Free Question of the Day and occasional news about Polymath classes by email from Polymath Learning Centre. I can unsubscribe at any time.';
const CONSENT_VERSION = 'qotd-consent-v1';

const HOUR = 3600000, DAY_MS = 86400000, SG_OFFSET = 8 * HOUR;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EMAIL_PATTERN = /^[^\s@<>(),;:\\"]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;
const ID_PATTERN = /^[0-9a-f]{24}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const LETTERS = ['A', 'B', 'C', 'D'];

class QotdError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (code = 'invalid-request', status = 400) => { throw new QotdError(status, code); };

/* ══════════════ Singapore days ══════════════ */
const sgDayKey = ms => new Date(ms + SG_OFFSET).toISOString().slice(0, 10);
const sgHour = ms => new Date(ms + SG_OFFSET).getUTCHours();
function dayKeyTime(key) {
  const match = DAY_KEY.exec(typeof key === 'string' ? key : '');
  if (!match) return NaN;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(y, m - 1, d);
  const date = new Date(time);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return NaN;
  return time;
}
const validDayKey = key => Number.isFinite(dayKeyTime(key));
const addDays = (key, n) => new Date(dayKeyTime(key) + n * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = key => new Date(dayKeyTime(key)).getUTCDay();
const dayIndex = key => Math.round((dayKeyTime(key) - dayKeyTime(START_DAY)) / DAY_MS);
// 'Friday 20 November 2026'
function fmtDay(key) {
  if (!validDayKey(key)) return '';
  const [y, m, d] = key.split('-').map(Number);
  return WD_LONG[weekdayOf(key)] + ' ' + d + ' ' + MONTH_LONG[m - 1] + ' ' + y;
}
// 'Fri 20 Nov'
function fmtDayShort(key) {
  if (!validDayKey(key)) return '';
  const [, m, d] = key.split('-').map(Number);
  return WD_LONG[weekdayOf(key)].slice(0, 3) + ' ' + d + ' ' + MONTH_SHORT[m - 1];
}

/* ══════════════ The rotation ══════════════ */
// Since v2 every day has one question per subject PER LEVEL (P3 to P6), so no child
// is given a question above their level. A day's slots are filled from the centre's
// own material (the pool, daily-question-pool.js) when a ready question is waiting,
// and otherwise from the hand-written bank below, by level. A level with nothing at
// all (the bank has no P3 Maths) stays empty, and a child at that level gets the
// nearest question BELOW it, or none.
const mod = (a, n) => ((a % n) + n) % n;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// The smallest stride from `base` up that shares no factor with n.
function strideFor(n, base) {
  let k = Math.max(1, base);
  while (n > 1 && gcd(k, n) !== 1) k++;
  return k;
}
const BANK_BY_LEVEL = Object.freeze(Object.fromEntries(SUBJECTS.map(subject => [subject,
  Object.freeze(Object.fromEntries(pool.LEVELS.map(level => [level, Object.freeze(BANK[subject].filter(q => q.level === level))])))])));
function questionById(id) {
  if (typeof id !== 'string') return null;
  for (const subject of SUBJECTS) {
    const found = BANK[subject].find(q => q.id === id);
    if (found) return { subject, question: found };
  }
  return null;
}
function emptySlots() {
  const picks = {};
  for (const subject of SUBJECTS) { picks[subject] = {}; for (const level of pool.LEVELS) picks[subject][level] = ''; }
  return picks;
}
// The bank's question for one subject and level on a day ('' when the bank has none).
function bankPick(day, subject, level) {
  const list = BANK_BY_LEVEL[subject][level];
  if (!list.length) return '';
  const index = dayIndex(day);
  const stride = strideFor(list.length, STRIDES[subject]);
  return list[mod(index * stride + OFFSETS[subject] + pool.LEVELS.indexOf(level) * 3, list.length)].id;
}
// The slots a day gets when nobody has asked for it yet and no pool question waits.
function defaultPick(day) {
  const picks = emptySlots();
  for (const subject of SUBJECTS) for (const level of pool.LEVELS) picks[subject][level] = bankPick(day, subject, level);
  return { v: 2, picks, items: {} };
}
const validPoolItem = (item, subject, level) => !!(item && pool.ID_PATTERN.test(item.id || '') && item.subject === subject && item.level === level
  && typeof item.q === 'string' && item.q && typeof item.answer === 'string'
  && (item.kind !== 'mcq' || (Array.isArray(item.options) && item.options.length === 4 && Number.isInteger(item.answerIndex) && item.answerIndex >= 0 && item.answerIndex < 4)));
// A day's slots: the stored ones when they are valid, the bank's otherwise.
// A day stored before v2 ({ math: id, science: id }) keeps its two bank questions in
// the slot of their own level, so a parent who answered that day sees the same one.
function pickForDay(day, stored) {
  const fallback = defaultPick(day);
  const out = { v: 2, picks: emptySlots(), items: {} };
  const items = stored && stored.items && typeof stored.items === 'object' ? stored.items : {};
  for (const subject of SUBJECTS) {
    for (const level of pool.LEVELS) {
      const id = stored && stored.picks && stored.picks[subject] ? stored.picks[subject][level] : undefined;
      if (typeof id === 'string' && id) {
        if (validPoolItem(items[id], subject, level)) { out.picks[subject][level] = id; out.items[id] = items[id]; continue; }
        const found = questionById(id);
        if (found && found.subject === subject && found.question.level === level) { out.picks[subject][level] = id; continue; }
      }
      if (stored && stored.picks && stored.picks[subject] && stored.picks[subject][level] === '') { out.picks[subject][level] = ''; continue; }
      out.picks[subject][level] = fallback.picks[subject][level];
    }
    // Before v2: one bank question per subject, put in the slot of its own level.
    const legacy = stored && !stored.picks && typeof stored[subject] === 'string' ? questionById(stored[subject]) : null;
    if (legacy && legacy.subject === subject && pool.LEVELS.includes(legacy.question.level)) out.picks[subject][legacy.question.level] = legacy.question.id;
  }
  return out;
}
const imageUrl = (id, day) => FUNCTION_URL + '?img=' + encodeURIComponent(id) + '&d=' + encodeURIComponent(day);
// A question as the page or an email may show it. The answer only when asked for.
function publicQuestion(id, day, withAnswer, pick) {
  const item = pick && pick.items ? pick.items[id] : null;
  if (item) return pool.publicOpen(item, day, withAnswer, { imageUrl, dayLabel: fmtDay(day), dayShort: fmtDayShort(day) });
  const found = questionById(id);
  if (!found) return null;
  const q = found.question;
  const out = {
    id: q.id, kind: 'mcq', source: 'bank', subject: found.subject, subjectLabel: SUBJECT_LABEL[found.subject], level: q.level, topic: q.topic,
    q: q.q, options: q.options.slice(), images: [], day, dayLabel: fmtDay(day), dayShort: fmtDayShort(day)
  };
  if (withAnswer) Object.assign(out, { answer: q.answer, answerLetter: LETTERS[q.answer], steps: q.steps.slice(), idea: q.idea });
  return out;
}
// The slot for a child at `level`: their own level's question, else the nearest one below.
function slotFor(pick, subject, level) {
  for (const l of pool.levelsAtOrBelow(level)) {
    const id = pick && pick.picks && pick.picks[subject] ? pick.picks[subject][l] : '';
    if (id) return id;
  }
  return '';
}
// The questions one child sees on a day. `levels` is a level ('P5') or one per
// subject ({ math: 'P5', science: 'P4' }); a subject with no question at or below the
// level is null.
function publicPair(day, pick, withAnswer, levels = DEFAULT_PAGE_LEVEL) {
  const normal = pick && pick.v === 2 ? pick : pickForDay(day, pick);
  const out = {};
  for (const subject of SUBJECTS) {
    const level = typeof levels === 'string' ? levels : levels && levels[subject];
    const id = slotFor(normal, subject, level);
    out[subject] = id ? publicQuestion(id, day, withAnswer, normal) : null;
    if (out[subject]) out[subject].forLevel = pool.questionLevelFor(level);
  }
  return out;
}
// Every slot of a day, for the admin page.
function publicAll(day, pick, withAnswer) {
  const normal = pick && pick.v === 2 ? pick : pickForDay(day, pick);
  const out = {};
  for (const subject of SUBJECTS) {
    out[subject] = {};
    for (const level of pool.LEVELS) {
      const id = normal.picks[subject][level];
      out[subject][level] = id ? publicQuestion(id, day, withAnswer, normal) : null;
    }
  }
  return out;
}
// The levels a subscriber gets questions at: the /student enrolment when the
// family is approved there (familyLevels), else the level the parent chose.
function subscriberLevels(sub, family) {
  if (family) return { math: family.math || '', science: family.science || '' };
  const level = pool.questionLevelFor(sub && sub.level);
  return { math: level, science: level };
}

/* ══════════════ Subscribers ══════════════ */
const normaliseEmail = value => String(value || '').trim().toLowerCase();
const subscriberId = email => createHash('sha256').update('qotd|' + normaliseEmail(email)).digest('hex').slice(0, 24);
const newToken = (bytes = randomBytes) => bytes(24).toString('base64url').slice(0, 32);
const keyOf = sub => sub.id + '.' + sub.token;
function parseKey(value) {
  if (typeof value !== 'string' || value.length > 64) fail('invalid-link');
  const [id, token, extra] = value.split('.');
  if (extra !== undefined || !ID_PATTERN.test(id || '') || !TOKEN_PATTERN.test(token || '')) fail('invalid-link');
  return { id, token };
}
// The address with most of the name hidden, for a page anyone holding the link sees.
function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return '';
  const shown = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
  return shown + '•••@' + domain;
}

function oneLine(value, max, min = 0) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f<>]/.test(value)) fail();
  const result = value.trim().replace(/\s+/g, ' ');
  if (result.length < min || result.length > max) fail();
  return result;
}
function readSubjects(value) {
  if (!Array.isArray(value) || !value.length || value.length > 2) fail('choose-subject');
  const list = [...new Set(value)];
  if (list.some(s => !SUBJECTS.includes(s))) fail('choose-subject');
  return SUBJECTS.filter(s => list.includes(s));
}
function readFrequency(value) {
  if (!FREQUENCIES.includes(value)) fail('invalid-frequency');
  return value;
}
function readLevel(value) {
  const level = value === undefined || value === null ? '' : value;
  if (!CHILD_LEVELS.includes(level)) fail('invalid-level');
  return level;
}
// A sign-up (and a settings change) must name a level we set questions for.
function readSignupLevel(value) {
  if (!SIGNUP_LEVELS.includes(value)) fail('choose-level');
  return value;
}
function checkKeys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  if (Object.keys(body).some(key => !allowed.includes(key))) fail();
}

function validateSubscribe(body) {
  checkKeys(body, ['action', 'email', 'name', 'level', 'subjects', 'frequency', 'consent', 'pageVersion', 'source', 'website']);
  const email = normaliseEmail(oneLine(body.email, 120, 3));
  if (!EMAIL_PATTERN.test(email)) fail('invalid-email');
  if (body.consent !== true) fail('consent-required');
  const source = oneLine(body.source === undefined ? 'question-page' : body.source, 20);
  if (!['question-page', 'home-page'].includes(source)) fail();
  return {
    email,
    name: oneLine(body.name, 80),
    level: readSignupLevel(body.level),
    subjects: readSubjects(body.subjects === undefined ? SUBJECTS.slice() : body.subjects),
    frequency: readFrequency(body.frequency === undefined ? 'daily' : body.frequency),
    pageVersion: oneLine(body.pageVersion, 20),
    source,
    // The hidden field a person never sees: a robot that fills it is told "check your email" and nothing happens.
    robot: typeof body.website === 'string' && body.website.trim() !== ''
  };
}
function validatePreferences(body) {
  checkKeys(body, ['action', 'key', 'name', 'level', 'subjects', 'frequency']);
  const key = parseKey(body.key);
  const patch = {};
  if (body.subjects !== undefined) patch.subjects = readSubjects(body.subjects);
  if (body.frequency !== undefined) patch.frequency = readFrequency(body.frequency);
  if (body.level !== undefined) patch.level = readSignupLevel(body.level);
  if (body.name !== undefined) patch.name = oneLine(body.name, 80);
  if (!Object.keys(patch).length) fail();
  return { key, patch };
}

// A new or returning sign-up. `existing` is the stored subscriber or null.
// Returns what to store and which email (if any) to send:
//   new / pending / unsubscribed → pending, a confirmation email
//   already active               → preferences kept, an "already subscribed" email
// Repeated sign-ups for one address are throttled, and the page is told the same
// thing every time, so it can never be used to learn who has signed up.
function planSubscribe(request, existing, at, makeToken) {
  const id = subscriberId(request.email);
  const recent = existing && existing.lastMailAt && at - Number(existing.lastMailAt) < LIMITS.addressGapMs;
  const tooMany = existing && Number(existing.mailCount) >= LIMITS.addressMails && existing.status !== 'active'
    && at - Number(existing.lastMailAt || 0) < DAY_MS;
  if (existing && existing.status === 'active') {
    if (recent) return { id, record: null, mail: null };
    return { id, mail: 'already', record: { lastMailAt: at, mailCount: (Number(existing.mailCount) || 0) + 1, lastSignupAt: at } };
  }
  if (recent || tooMany) return { id, record: null, mail: null };
  const token = existing && TOKEN_PATTERN.test(existing.token || '') ? existing.token : makeToken();
  const record = {
    email: request.email, name: request.name, level: request.level, subjects: request.subjects, frequency: request.frequency,
    status: 'pending', token, source: request.source, pageVersion: request.pageVersion,
    consent: { text: CONSENT_TEXT, version: CONSENT_VERSION, at },
    createdAt: existing && existing.createdAt ? existing.createdAt : at,
    lastSignupAt: at, lastMailAt: at,
    // The daily count of confirmation emails starts again after a quiet day.
    mailCount: existing && at - Number(existing.lastMailAt || 0) < DAY_MS ? (Number(existing.mailCount) || 0) + 1 : 1,
    sentCount: existing ? Number(existing.sentCount) || 0 : 0
  };
  if (existing && existing.status === 'unsubscribed') record.resubscribedAt = at;
  return { id, mail: 'confirm', record };
}

// Is this subscriber due an email on `day`? daily → once a day; weekly → Saturdays.
function dueKind(sub, day) {
  if (!sub || sub.status !== 'active' || !validEmail(sub.email)) return null;
  if (!Array.isArray(sub.subjects) || !sub.subjects.some(s => SUBJECTS.includes(s))) return null;
  if (sub.frequency === 'weekly') return weekdayOf(day) === WEEKLY_WEEKDAY && sub.lastWeeklyDay !== day ? 'weekly' : null;
  return sub.lastDailyDay !== day ? 'daily' : null;
}
const millis = value => (value && typeof value.toMillis === 'function' ? value.toMillis() : Number(value) || 0);
// Who gets an email this run, in order, within the cap: daily subscribers who
// joined first, then the weekly ones. Returns the plan and what was held back.
function planRun(subscribers, day, cap) {
  const due = [];
  for (const sub of subscribers) {
    const kind = dueKind(sub, day);
    if (kind) due.push({ sub, kind });
  }
  due.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'daily' ? -1 : 1)
    || millis(a.sub.confirmedAt) - millis(b.sub.confirmedAt) || String(a.sub.id).localeCompare(String(b.sub.id)));
  const limit = Math.max(0, Math.min(MAX_DAILY_CAP, Number.isFinite(Number(cap)) ? Math.floor(Number(cap)) : DEFAULT_DAILY_CAP));
  return { send: due.slice(0, limit), heldBack: due.slice(limit), cap: limit };
}
function readCap(settings) {
  const cap = settings && Number(settings.dailyCap);
  return Number.isFinite(cap) && cap >= 0 ? Math.min(MAX_DAILY_CAP, Math.floor(cap)) : DEFAULT_DAILY_CAP;
}

function stats(subscribers, now) {
  const out = { total: subscribers.length, active: 0, pending: 0, unsubscribed: 0, daily: 0, weekly: 0, math: 0, science: 0,
    newThisWeek: 0, levels: {}, sources: {} };
  const weekAgo = now - 7 * DAY_MS;
  for (const s of subscribers) {
    if (STATUSES.includes(s.status)) out[s.status]++;
    if (s.status !== 'active') continue;
    out[s.frequency === 'weekly' ? 'weekly' : 'daily']++;
    for (const subject of s.subjects || []) if (SUBJECTS.includes(subject)) out[subject]++;
    if (millis(s.confirmedAt) >= weekAgo) out.newThisWeek++;
    const level = s.level || 'Not given';
    out.levels[level] = (out.levels[level] || 0) + 1;
    const source = s.source || 'question-page';
    out.sources[source] = (out.sources[source] || 0) + 1;
  }
  return out;
}

/* ══════════════ Links ══════════════ */
const confirmUrl = sub => PAGE_URL + '?c=' + keyOf(sub);
const manageUrl = sub => PAGE_URL + '?m=' + keyOf(sub);
const unsubscribeUrl = sub => PAGE_URL + '?u=' + keyOf(sub);
// The List-Unsubscribe header: mail apps POST here for one click unsubscribe.
const oneClickUrl = sub => FUNCTION_URL + '?u=' + keyOf(sub);
const tryUrl = (day, subject, level) => PAGE_URL + '?d=' + day + (level ? '&l=' + level : '') + '#' + subject;

/* ══════════════ Emails ══════════════ */
function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const validEmail = value => typeof value === 'string' && EMAIL_PATTERN.test(value.trim());
const html = value => escapeHtml(value).replace(/\n/g, '<br>');
const FONT = "'Century Gothic',CenturyGothic,AppleGothic,Arial,sans-serif";
const COLOURS = Object.freeze({ ink: '#10303a', deep: '#056c76', teal: '#2e9ca6', aqua: '#56c4d0', pink: '#ec008c', plum: '#b51f6b',
  paper: '#f2f9fa', line: '#d1eaee', muted: '#5e6d6f', math: '#1d4ed8', mathBg: '#eff6ff', sci: '#15803d', sciBg: '#f0fdf4' });
const greetingFor = sub => 'Dear ' + (sub.name ? sub.name : 'Parent') + ',';

function button(href, label, colour = COLOURS.deep) {
  return '<a href="' + escapeHtml(href) + '" style="display:inline-block;background:' + colour + ';color:#ffffff;font-weight:700;font-size:15px;'
    + 'text-decoration:none;padding:12px 22px;border-radius:10px;font-family:' + FONT + '">' + escapeHtml(label) + '</a>';
}
function tag(q) {
  const math = q.subject === 'math';
  return '<span style="display:inline-block;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:'
    + (math ? COLOURS.mathBg : COLOURS.sciBg) + ';color:' + (math ? COLOURS.math : COLOURS.sci) + ';border:1px solid '
    + (math ? '#bfdbfe' : '#bbf7d0') + '">' + escapeHtml(q.level + ' ' + q.subjectLabel) + '</span> '
    + '<span style="font-size:12px;color:' + COLOURS.muted + '">' + escapeHtml(q.topic) + '</span>';
}
function optionsHtml(q, { reveal = false } = {}) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0 6px">'
    + q.options.map((option, index) => {
      const right = reveal && index === q.answer;
      return '<tr><td style="width:34px;vertical-align:top"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;'
        + 'border-radius:50%;font-weight:700;font-size:13px;background:' + (right ? COLOURS.sci : COLOURS.paper) + ';color:' + (right ? '#fff' : COLOURS.deep)
        + ';border:1px solid ' + (right ? COLOURS.sci : COLOURS.line) + '">' + LETTERS[index] + '</span></td>'
        + '<td style="font-size:15px;line-height:1.5;padding:2px 0;color:' + COLOURS.ink + (right ? ';font-weight:700' : '') + '">'
        + html(option) + (right ? ' &nbsp;✓' : '') + '</td></tr>';
    }).join('') + '</table>';
}
// Fractions as a parent would write them: 3/4 → ³⁄₄ style, 2 1/4 → 2 ¹⁄₄ (email-safe HTML).
function mathHtml(text) {
  return html(text).replace(/(^|[^\d/.])(\d{1,3})\/(\d{1,3})(?![\d/])/g,
    (m, before, n, d) => before + '<span style="white-space:nowrap"><sup style="font-size:75%">' + n + '</sup>&frasl;<sub style="font-size:75%">' + d + '</sub></span>');
}
function imagesHtml(q) {
  return (q.images || []).map(img => {
    const width = Math.min(540, Math.round(img.w / 2) || 540);
    return '<div style="margin:0 0 12px;text-align:center"><img src="' + escapeHtml(img.url) + '" alt="' + escapeHtml(img.alt) + '" width="' + width + '"'
      + ' style="display:inline-block;width:100%;max-width:' + width + 'px;height:auto;border:1px solid ' + COLOURS.line + ';border-radius:8px;background:#ffffff"></div>';
  }).join('');
}
function questionCardHtml(q, { heading, reveal = false, link = '' } = {}) {
  const open = q.kind === 'open';
  let out = '<div style="border:1px solid ' + COLOURS.line + ';border-radius:14px;padding:18px 18px 16px;margin:0 0 18px;background:#ffffff">';
  if (heading) out += '<div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:' + COLOURS.deep + ';margin:0 0 8px">' + escapeHtml(heading) + '</div>';
  out += '<div style="margin:0 0 10px">' + tag(q) + '</div>';
  out += '<p style="font-size:16px;line-height:1.6;margin:0 0 12px;color:' + COLOURS.ink + ';font-weight:600">' + mathHtml(q.q) + '</p>';
  out += imagesHtml(q);
  if (!open) out += optionsHtml(q, { reveal });
  if (reveal && open) {
    out += '<div style="margin:14px 0 0;padding:14px 16px;border-radius:10px;background:' + COLOURS.paper + '">'
      + '<div style="font-size:14px;font-weight:700;color:' + COLOURS.sci + ';margin:0 0 6px">Answer: ' + mathHtml(q.answer) + '</div>'
      + (q.answerType === 'explain' || q.model !== q.answer ? '<div style="font-size:14px;line-height:1.6;margin:0 0 8px;color:' + COLOURS.ink + '"><b>Model answer:</b> ' + mathHtml(q.model) + '</div>' : '')
      + '<ol style="margin:0;padding:0 0 0 20px;font-size:14px;line-height:1.6;color:' + COLOURS.ink + '">'
      + q.steps.map(step => '<li style="margin:0 0 4px">' + mathHtml(step) + '</li>').join('') + '</ol>'
      + '<div style="margin:10px 0 0;font-size:14px;line-height:1.5;color:' + COLOURS.plum + '"><b>Key idea:</b> ' + mathHtml(q.idea) + '</div></div>';
  } else if (reveal) {
    out += '<div style="margin:14px 0 0;padding:14px 16px;border-radius:10px;background:' + COLOURS.paper + '">'
      + '<div style="font-size:14px;font-weight:700;color:' + COLOURS.sci + ';margin:0 0 6px">Answer: ' + escapeHtml(q.answerLetter) + '. ' + html(q.options[q.answer]) + '</div>'
      + '<ol style="margin:0;padding:0 0 0 20px;font-size:14px;line-height:1.6;color:' + COLOURS.ink + '">'
      + q.steps.map(step => '<li style="margin:0 0 4px">' + html(step) + '</li>').join('') + '</ol>'
      + '<div style="margin:10px 0 0;font-size:14px;line-height:1.5;color:' + COLOURS.plum + '"><b>Key idea:</b> ' + html(q.idea) + '</div></div>';
  }
  if (link) {
    out += open
      ? '<div style="margin:14px 0 0">' + button(link, 'Type your answer: Chung GPT marks it', COLOURS.teal) + '</div>'
        + '<div style="font-size:12px;color:' + COLOURS.muted + ';margin:6px 0 0">Your child types the answer on our website and gets instant feedback. The worked answer comes tomorrow.</div>'
      : '<div style="margin:14px 0 0">' + button(link, 'Try it on our website', COLOURS.teal) + '</div>';
  }
  return out + '</div>';
}
function questionText(q, { heading, reveal = false, link = '' } = {}) {
  const lines = [];
  const open = q.kind === 'open';
  if (heading) lines.push(heading.toUpperCase());
  lines.push(q.level + ' ' + q.subjectLabel + ' · ' + q.topic, '', q.q, '');
  if ((q.images || []).length) lines.push('(' + q.images.length + ' picture' + (q.images.length > 1 ? 's' : '') + ': see the email or the website)', '');
  if (!open) q.options.forEach((option, index) => lines.push('  ' + LETTERS[index] + '. ' + option + (reveal && index === q.answer ? '   ✓' : '')));
  if (reveal) {
    if (open) lines.push('', 'Answer: ' + q.answer, 'Model answer: ' + q.model, 'Worked answer:');
    else lines.push('', 'Answer: ' + q.answerLetter + '. ' + q.options[q.answer], 'Worked answer:');
    q.steps.forEach((step, index) => lines.push('  ' + (index + 1) + '. ' + step));
    lines.push('Key idea: ' + q.idea);
  }
  if (link) lines.push('', (open ? 'Type your answer (Chung GPT marks it): ' : 'Try it on our website: ') + link);
  return lines.join('\n');
}
function ctaHtml() {
  return '<div style="margin:6px 0 20px;padding:18px;border-radius:14px;background:linear-gradient(135deg,' + COLOURS.deep + ',' + COLOURS.teal + ');color:#ffffff">'
    + '<div style="font-size:17px;font-weight:700;margin:0 0 6px">Want to know exactly where your child stands?</div>'
    + '<div style="font-size:14px;line-height:1.6;margin:0 0 12px">Book a <b>free diagnostic test</b> (worth $100) at our Clementi centre. '
    + 'You get a personal report with marks for every topic, a study plan and the class we recommend.</div>'
    + button(DIAGNOSTIC_URL, 'Book a free diagnostic test', COLOURS.pink)
    + '<div style="font-size:13px;margin:10px 0 0">Or <a href="' + SCHEDULE_URL + '" style="color:#ffffff">see our class schedule and book a trial lesson</a>.</div></div>';
}
const CTA_TEXT = 'Want to know exactly where your child stands? Book a free diagnostic test (worth $100): ' + DIAGNOSTIC_URL
  + '\nOr see our class schedule and book a trial lesson: ' + SCHEDULE_URL;

function footerHtml(sub) {
  const signedUp = sub && sub.consent && sub.consent.at ? fmtDay(sgDayKey(millis(sub.consent.at))) : '';
  return '<p style="font-size:12px;line-height:1.6;color:#8a8a8a;margin:26px 0 0;border-top:1px solid ' + COLOURS.line + ';padding-top:14px">'
    + 'You are receiving this because ' + escapeHtml(sub.email) + ' signed up for the Free Question of the Day at polymathlc.com.sg'
    + (signedUp ? ' on ' + escapeHtml(signedUp) : '') + '.<br>'
    + '<a href="' + escapeHtml(manageUrl(sub)) + '" style="color:' + COLOURS.deep + '">Change subjects or how often</a> &middot; '
    + '<a href="' + escapeHtml(unsubscribeUrl(sub)) + '" style="color:' + COLOURS.deep + '">Unsubscribe</a><br>'
    + SENDER_NAME + ', Clementi, Singapore &middot; WhatsApp <a href="https://wa.me/' + WHATSAPP_NUMBER + '" style="color:' + COLOURS.deep + '">'
    + WHATSAPP_DISPLAY + '</a></p>';
}
function footerText(sub) {
  return ['—', 'You are receiving this because ' + sub.email + ' signed up for the Free Question of the Day at polymathlc.com.sg.',
    'Change subjects or how often: ' + manageUrl(sub), 'Unsubscribe: ' + unsubscribeUrl(sub),
    SENDER_NAME + ', Clementi, Singapore · WhatsApp ' + WHATSAPP_DISPLAY].join('\n');
}
function shell(preheader, body) {
  return '<div style="background:' + COLOURS.paper + ';padding:20px 0;margin:0">'
    + '<span style="display:none;max-height:0;overflow:hidden;opacity:0">' + escapeHtml(preheader) + '</span>'
    + '<div style="font-family:' + FONT + ';max-width:600px;margin:0 auto;padding:28px 22px;background:#ffffff;border-radius:16px;color:' + COLOURS.ink + '">'
    + '<table role="presentation" style="width:100%;margin:0 0 18px"><tr><td><img src="' + LOGO_URL + '" alt="Polymath Learning Centre" height="52" style="height:52px"></td>'
    + '<td style="text-align:right;font-size:12px;font-weight:700;letter-spacing:1.5px;color:' + COLOURS.pink + ';text-transform:uppercase">Question of the Day</td></tr></table>'
    + body + '</div></div>';
}
function mailDoc(to, subject, htmlBody, text, sub, meta) {
  const doc = {
    to: [to],
    from: SENDER_NAME + ' <' + SENDER_EMAIL + '>',
    replyTo: SENDER_EMAIL,
    message: { subject, html: htmlBody, text },
    polymathQotd: meta
  };
  if (sub && sub.id && sub.token) {
    doc.message.headers = {
      'List-Unsubscribe': '<' + oneClickUrl(sub) + '>, <mailto:' + SENDER_EMAIL + '?subject=Unsubscribe%20question%20of%20the%20day>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    };
  }
  return doc;
}
const p = text => '<p style="font-size:15px;line-height:1.6;margin:0 0 14px">' + text + '</p>';
const wanted = (sub, pair) => SUBJECTS.filter(s => (sub.subjects || SUBJECTS).includes(s) && pair && pair[s]);
const subjectsWords = list => list.map(s => SUBJECT_LABEL[s]).join(' and ');

function confirmMail(sub) {
  const subjects = subjectsWords(sub.subjects || SUBJECTS);
  const how = sub.frequency === 'weekly' ? 'every Saturday, with the week\'s questions and worked answers' : 'every morning at about 6 a.m., with the worked answer the next day';
  const body = p(escapeHtml(greetingFor(sub)))
    + p('Thank you for signing up for the Free Question of the Day from Polymath Learning Centre. Please confirm your email address to start receiving '
      + escapeHtml(subjects) + ' questions ' + escapeHtml(how) + '.')
    + '<div style="margin:6px 0 18px">' + button(confirmUrl(sub), 'Yes, send me the questions', COLOURS.pink) + '</div>'
    + p('<span style="font-size:13px;color:' + COLOURS.muted + '">If you did not sign up, simply ignore this email: you will not hear from us again.</span>')
    + '<p style="font-size:12px;color:#8a8a8a;margin:18px 0 0">' + SENDER_NAME + ' &middot; <a href="' + PAGE_URL + '" style="color:' + COLOURS.deep + '">polymathlc.com.sg/question</a></p>';
  const text = [greetingFor(sub), '', 'Thank you for signing up for the Free Question of the Day from Polymath Learning Centre. Please confirm your email address to start receiving '
    + subjects + ' questions ' + how + ':', '', confirmUrl(sub), '', 'If you did not sign up, simply ignore this email: you will not hear from us again.', '', SENDER_NAME].join('\n');
  return mailDoc(sub.email, 'Please confirm: Free Question of the Day', shell('One click to confirm and get your first question.', body), text, null, { id: sub.id, kind: 'confirm' });
}
function alreadyMail(sub) {
  const body = p(escapeHtml(greetingFor(sub)))
    + p('Someone (probably you) just signed up for the Free Question of the Day with this address. Good news: you are already subscribed, so there is nothing more to do.')
    + p('You can change your subjects, switch between daily and weekly, or unsubscribe here:')
    + '<div style="margin:6px 0 18px">' + button(manageUrl(sub), 'Manage my questions') + '</div>' + footerHtml(sub);
  const text = [greetingFor(sub), '', 'Someone (probably you) just signed up for the Free Question of the Day with this address. You are already subscribed, so there is nothing more to do.',
    '', 'Manage your questions: ' + manageUrl(sub), '', footerText(sub)].join('\n');
  return mailDoc(sub.email, 'You are already subscribed to the Question of the Day', shell('You are already on the list.', body), text, sub, { id: sub.id, kind: 'already' });
}

// The morning email: today's question(s) and yesterday's worked answer(s).
// The welcome email is the same, with a welcome at the top and no yesterday when
// the parent has not seen yesterday's question.
function dailyMail(sub, day, today, yesterday, { welcome = false, test = false } = {}) {
  const subjects = wanted(sub, today);
  const answers = yesterday ? wanted(sub, yesterday) : [];
  // Nothing at or below the child's level today: no email rather than a wrong one.
  if (!subjects.length) return null;
  const first = today[subjects[0]];
  const subject = (test ? '[Test] ' : '') + (welcome ? 'Welcome! Your first Question of the Day' : subjects.length > 1
    ? 'Today\'s questions: ' + subjects.map(s => today[s].level + ' ' + today[s].subjectLabel).join(' & ')
    : 'Question of the day: ' + first.level + ' ' + first.subjectLabel + ' · ' + first.topic);
  let body = p(escapeHtml(greetingFor(sub)));
  body += welcome
    ? p('Welcome to the Free Question of the Day! ' + (sub.frequency === 'weekly'
      ? 'Your weekly round-up arrives every Saturday morning. Here is today\'s question to start you off; its worked answer is on our website tomorrow.'
      : 'Every morning you will get a new question, and the next day its full worked answer. Here is today\'s, to start you off.'))
    : p('Here ' + (subjects.length > 1 ? 'are today\'s questions' : 'is today\'s question') + ' for ' + escapeHtml(fmtDay(day))
      + '. Let your child try ' + (subjects.length > 1 ? 'them' : 'it') + ' first; the worked answer comes tomorrow.');
  for (const s of subjects) body += questionCardHtml(today[s], { heading: 'Today · ' + today[s].subjectLabel, link: tryUrl(day, s, today[s].forLevel || today[s].level) });
  if (answers.length) {
    body += '<h3 style="font-size:17px;margin:24px 0 10px;color:' + COLOURS.deep + '">Yesterday\'s answer' + (answers.length > 1 ? 's' : '') + '</h3>';
    for (const s of answers) body += questionCardHtml(yesterday[s], { heading: 'Yesterday · ' + yesterday[s].subjectLabel, reveal: true });
  }
  body += ctaHtml() + footerHtml(sub);
  const textParts = [greetingFor(sub), '', welcome ? 'Welcome to the Free Question of the Day!' : 'Today\'s question' + (subjects.length > 1 ? 's' : '') + ' for ' + fmtDay(day) + ':', ''];
  for (const s of subjects) textParts.push(questionText(today[s], { heading: 'Today · ' + today[s].subjectLabel, link: tryUrl(day, s, today[s].forLevel || today[s].level) }), '');
  if (answers.length) {
    textParts.push('YESTERDAY\'S ANSWER' + (answers.length > 1 ? 'S' : ''), '');
    for (const s of answers) textParts.push(questionText(yesterday[s], { reveal: true }), '');
  }
  textParts.push(CTA_TEXT, '', footerText(sub));
  const preheader = first.level + ' ' + first.subjectLabel + ': ' + first.q.replace(/\s+/g, ' ').slice(0, 90);
  return mailDoc(sub.email, subject, shell(preheader, body), textParts.join('\n'), sub, { id: sub.id, kind: test ? 'test' : welcome ? 'welcome' : 'daily', day });
}

// The Saturday round-up: the past seven days' questions with their worked answers.
function weeklyMail(sub, day, week, { test = false } = {}) {
  const list = [];
  for (const entry of week) for (const s of wanted(sub, entry.pair)) list.push(entry.pair[s]);
  if (!list.length) return null;
  const subject = (test ? '[Test] ' : '') + 'This week\'s ' + list.length + ' questions, with worked answers';
  let body = p(escapeHtml(greetingFor(sub)))
    + p('Here are this week\'s Questions of the Day with their full worked answers. A good way to use them: cover the answer, let your child try, then go through the working together.');
  for (const q of list) body += questionCardHtml(q, { heading: q.dayShort + ' · ' + q.subjectLabel, reveal: true });
  body += '<div style="margin:0 0 18px">' + button(PAGE_URL, 'See today\'s question', COLOURS.teal) + '</div>' + ctaHtml() + footerHtml(sub);
  const textParts = [greetingFor(sub), '', 'This week\'s Questions of the Day with their worked answers.', ''];
  for (const q of list) textParts.push(questionText(q, { heading: q.dayShort + ' · ' + q.subjectLabel, reveal: true }), '');
  textParts.push('Today\'s question: ' + PAGE_URL, '', CTA_TEXT, '', footerText(sub));
  return mailDoc(sub.email, subject, shell(list.length + ' questions with worked answers.', body), textParts.join('\n'), sub,
    { id: sub.id, kind: test ? 'test' : 'weekly', day });
}

// The centre's morning note about new sign-ups (these are leads).
function adminSummaryMail(newSubs, totals, day) {
  const rows = newSubs.map(s => '<tr>' + [s.name || '—', s.email, s.level || '—', (s.subjects || []).map(x => SUBJECT_LABEL[x]).join(', '),
    s.frequency === 'weekly' ? 'Weekly' : 'Daily', s.source === 'home-page' ? 'Home page' : 'Question page']
    .map(v => '<td style="padding:6px 10px;border:1px solid #e5e5e5;font-size:13px">' + escapeHtml(v) + '</td>').join('') + '</tr>').join('');
  const head = ['Name', 'Email', 'Child\'s level', 'Subjects', 'How often', 'Signed up on']
    .map(v => '<th style="padding:6px 10px;border:1px solid #e5e5e5;background:#f5f5f5;font-size:13px;text-align:left">' + v + '</th>').join('');
  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#171717;max-width:720px">'
    + '<h2>' + newSubs.length + ' new Question of the Day subscriber' + (newSubs.length === 1 ? '' : 's') + '</h2>'
    + '<p>These parents confirmed their email address since the last note. They agreed to hear about Polymath classes, so they are good people to invite to a free diagnostic test or a trial.</p>'
    + '<table style="border-collapse:collapse;width:100%"><tr>' + head + '</tr>' + rows + '</table>'
    + '<p style="margin-top:16px">Now on the list: <b>' + totals.active + '</b> (' + totals.daily + ' daily, ' + totals.weekly + ' weekly). '
    + '<a href="' + PAGE_URL + '#admin">See every subscriber</a></p></div>';
  const text = newSubs.length + ' new Question of the Day subscribers:\n\n'
    + newSubs.map(s => [s.name || '—', s.email, s.level || '—', (s.subjects || []).join('+'), s.frequency].join(' · ')).join('\n')
    + '\n\nNow on the list: ' + totals.active + '. All subscribers: ' + PAGE_URL + '#admin';
  return {
    to: NOTIFICATION_EMAILS.slice(), from: SENDER_NAME + ' <' + SENDER_EMAIL + '>', replyTo: SENDER_EMAIL,
    message: { subject: 'Question of the Day: ' + newSubs.length + ' new subscriber' + (newSubs.length === 1 ? '' : 's') + ' (' + fmtDayShort(day) + ')', html: htmlBody, text },
    polymathQotd: { kind: 'admin-summary', day }
  };
}

const mailId = (kind, day, id) => 'polymath-qotd-' + kind + '-' + day + '-' + id;

// The subscriber list as CSV for the admin page's download (also used in tests).
function subscribersCsv(subscribers) {
  const cell = value => {
    const s = String(value === undefined || value === null ? '' : value);
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  };
  const when = value => { const ms = millis(value); return ms ? new Date(ms + SG_OFFSET).toISOString().slice(0, 16).replace('T', ' ') : ''; };
  const rows = [['Email', 'Name', 'Child level', 'Subjects', 'How often', 'Status', 'Signed up (SGT)', 'Confirmed (SGT)', 'Unsubscribed (SGT)', 'Emails sent', 'Source']];
  for (const s of subscribers) rows.push([s.email, s.name, s.level, (s.subjects || []).map(x => SUBJECT_LABEL[x] || x).join(' + '),
    s.frequency === 'weekly' ? 'Weekly' : 'Daily', s.status, when(s.createdAt), when(s.confirmedAt), when(s.unsubscribedAt), s.sentCount || 0, s.source || '']);
  return rows.map(row => row.map(cell).join(',')).join('\n') + '\n';
}

module.exports = {
  SENDER_EMAIL, SENDER_NAME, NOTIFICATION_EMAILS, QOTD_ADMINS, ROOT, SUBSCRIBERS, DAYS, RUNS, MAIL_COLLECTION, LIMIT_COLLECTION,
  PAGE_URL, FUNCTION_URL, DIAGNOSTIC_URL, SCHEDULE_URL, START_DAY, STRIDES, OFFSETS, SUBJECTS, SUBJECT_LABEL, BANK, FREQUENCIES, CHILD_LEVELS,
  STATUSES, WEEKLY_WEEKDAY, DEFAULT_DAILY_CAP, MAX_DAILY_CAP, GMAIL_LIMITS, LIMITS, CONSENT_TEXT, CONSENT_VERSION, LETTERS, DAY_MS,
  QotdError, sgDayKey, sgHour, validDayKey, addDays, weekdayOf, dayIndex, fmtDay, fmtDayShort, questionById, defaultPick, pickForDay,
  publicQuestion, publicPair, publicAll, slotFor, bankPick, strideFor, BANK_BY_LEVEL, SIGNUP_LEVELS, DEFAULT_PAGE_LEVEL, imageUrl, mathHtml,
  subscriberLevels, readSignupLevel, emptySlots, validPoolItem, pool, normaliseEmail, subscriberId, newToken, keyOf, parseKey, maskEmail, validateSubscribe, validatePreferences,
  planSubscribe, dueKind, planRun, readCap, stats, millis, confirmUrl, manageUrl, unsubscribeUrl, oneClickUrl, tryUrl, escapeHtml, validEmail,
  confirmMail, alreadyMail, dailyMail, weeklyMail, adminSummaryMail, mailId, subscribersCsv, questionText
};
