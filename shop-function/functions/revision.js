'use strict';

// 📚 Exam countdown revision packs (polymathlc.com.sg/revision, sold on /products too).
//
// Zhi Kai, 19 Nov 2026: a paid add-on, such as a PSLE or year-end plan with a
// countdown, timed practice papers, answer key videos and AI mind maps per topic,
// that anyone can buy (not only Polymath students).
//
// Everything in a pack is content the centre already has; nothing is made up here:
//   • worksheets       pdfAnnotator/{id} (the Ans Key app's worksheets, the ones
//                      /online classes teach), streamed as PDFs by this function
//   • answer keys      the newest annotated key Ans Key filed on the worksheet
//                      (answerKeys['YYYY-MM-DD'].url → pdf-annotator/lesson-key-…pdf)
//   • lesson videos    the worksheet's own video page (anskey/videos.html?<code>,
//                      the same page as the QR code printed on the worksheet)
//   • mind maps        Mr Chung's published maps (mindmaps/{id}, published: true),
//                      shown on the pack page as an outline of their topics
//
// The admin builds each pack on /revision/#admin: title, exam name and date, price,
// and a list of topics, each holding worksheets and mind maps picked from /online
// classes and Mr Chung's Maps. The first time anybody opens the catalogue, two
// starter packs (P6 Maths and P6 Science) are made from the /online P6 classes, so
// there is something to sell straight away; the admin then edits or hides them.
//
// Buying:
//   card     Stripe Checkout on the shop's account, keys and webhook (service.js
//            hands a paid session with metadata.source 'polymath-revision' to
//            handlePaidSession here). The admin's "Hide card payment" switch on
//            /products (shop_settings/config.cardPayments) covers packs too.
//   PayNow   the page shows the same SGQR as /products with the order's reference;
//            the order waits as 'pending' until an admin taps Mark paid.
// Once paid, the order gets an 8-character ACCESS CODE (shown as ABCD-EFGH), which
// is emailed to the buyer from admin@ with a one-tap link, and shown on the page at
// once after a card payment. The code opens the pack on any device until the exam
// is over (exam date + accessDaysAfterExam), or for accessDays when there is no
// exam date.
//
// Where it is kept: under trialSettings/revisionPacks (packs, orders, access).
// trialSettings/** is already closed to every browser by the /trial rules
// (tools/trial-rules.mjs, isPolymathTrialPath matches the top collection), so
// buyers' names, emails and access codes need no new Firestore rule. Only these
// functions (Admin SDK) read or write them.
const { randomBytes, createHmac, timingSafeEqual, randomInt } = require('node:crypto');
const { ShopError, ORIGINS, CURRENCY, LIMITS: SHOP_LIMITS, SESSION_MS, newOrderCode, validCode, paymentFromSession, toCents } = require('./service');
const { StripeError } = require('./stripe');
const { SENDER_EMAIL, SENDER_NAME, UEN, escapeHtml, validEmail } = require('./receipt');
const { TRIAL_ADMINS, NOTIFICATION_EMAILS, trialAdminFrom } = require('./trial');

const REVISION_SOURCE = 'polymath-revision';
const REVISION_ROOT = Object.freeze(['trialSettings', 'revisionPacks']);
const PACKS = 'packs';
const ORDERS = 'orders';
const ACCESS = 'access';
const COURSES = 'onlineCourses';
const SHEETS = 'pdfAnnotator';
const MINDMAPS = 'mindmaps';
const MAIL_PREFIX = 'polymath-revision-';
const PAGE_URL = 'https://polymathlc.com.sg/revision/';
const ANSKEY_BASE = 'https://polymathlc.com.sg/anskey/';
const FUNCTIONS_BASE = 'https://us-central1-mathgen--app.cloudfunctions.net/';
const FILE_ENDPOINT = FUNCTIONS_BASE + 'revisionPack';
const LOGO_URL = 'https://dl.dropboxusercontent.com/scl/fi/h40yjlyg8ldefwfaa3dib/polymath-logo-sticker.png?rlkey=o1ra4taqy79gt9t8u096v82zj';
const WHATSAPP_NUMBER = '6596450588';
const WHATSAPP_DISPLAY = '+65 9645 0588';
const MERCHANT_NAME = 'POLYMATH LEARNING';
// Where the pack page is served on the allowed origins. Stripe sends the buyer back here.
const REVISION_RETURN_PATH = /^\/(?:cer\/)?revision\/(?:index\.html)?$/;

const HOUR = 3600000, DAY = 86400000;
const SG_OFFSET = 8 * HOUR;
const LEVELS = Object.freeze(['P3', 'P4', 'P5', 'P6']);
const SUBJECTS = Object.freeze(['math', 'science', 'both']);
const STATUSES = Object.freeze(['open', 'pending', 'paid', 'cancelled']);
// Access codes: 8 characters with no look-alikes (the /trial codes' alphabet).
const ACCESS_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ACCESS_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
const PACK_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

const LIMITS = Object.freeze({
  topics: 40, worksheetsPerTopic: 30, mindmapsPerTopic: 10, packs: 30,
  minPrice: 1, maxPrice: 2000,
  minMinutes: 5, maxMinutes: 240,
  checkoutPerIpHour: 10, checkoutPerDay: 200,
  wrongCodePerIpHour: 20, openPerIpHour: 120, filePerIpHour: 300,
  mapNodes: 400
});
// Placeholders the admin is told to check (the starter packs and new packs).
const DEFAULTS = Object.freeze({ price: 49, minutes: 60, accessDaysAfterExam: 30, accessDays: 365 });
// Links on the pack page work for a day (the page makes fresh ones every visit).
const PAGE_LINK_MS = DAY;
// "Resend access email" twice by accident sends one email.
const RESEND_GAP_MS = 60000;

// ─── Small helpers ───
function fail(code = 'invalid-request') { throw new ShopError(400, code); }
function checkKeys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  if (Object.keys(body).some(key => !allowed.includes(key))) fail();
}
function text(value, max, { min = 0, lines = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail();
  let result = value.replace(/\r\n?/g, '\n').trim();
  if (!lines) {
    if (/\n/.test(result)) fail();
  } else {
    result = result.replace(/\n{3,}/g, '\n\n');
  }
  if (result.length < min || result.length > max) fail();
  return result;
}
const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
function toMillis(value, fallback = 0) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value._seconds === 'number') return value._seconds * 1000;
  if (value && typeof value.seconds === 'number') return value.seconds * 1000;
  return fallback;
}
const money = value => '$' + (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
const subjectName = subject => (subject === 'math' ? 'Maths' : subject === 'science' ? 'Science' : subject === 'both' ? 'Maths & Science' : '');
const levelName = level => String(level || '').replace(/^P(\d)$/, 'Primary $1');

// ─── Days in Singapore ───
function realDayKey(key) {
  if (typeof key !== 'string' || !DAY_KEY.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2020 && y < 2100;
}
// Midnight at the START of a Singapore day, in UTC milliseconds.
function sgDayStart(key) { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) - SG_OFFSET; }
function sgDayKey(ms) { const d = new Date(ms + SG_OFFSET); return d.toISOString().slice(0, 10); }
function fmtDay(ms) {
  if (!Number.isFinite(ms) || !ms) return '';
  return new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms));
}
function fmtMoment(ms) {
  if (!Number.isFinite(ms) || !ms) return '';
  return new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}
// Whole days from today (Singapore) to the exam day: 0 on the day itself.
function daysUntil(examDate, now) {
  if (!realDayKey(examDate)) return null;
  return Math.round((sgDayStart(examDate) - sgDayStart(sgDayKey(now))) / DAY);
}

// ─── Codes ───
function newAccessCode(random = randomInt) {
  let code = '';
  for (let i = 0; i < 8; i++) code += ACCESS_CODE_CHARS[random(ACCESS_CODE_CHARS.length)];
  return code;
}
// What people type: "abcd-efgh", "ABCD EFGH", "abcdefgh" all mean ABCDEFGH.
function normalAccessCode(value) {
  if (typeof value !== 'string' || value.length > 40) return '';
  const code = value.toUpperCase().replace(/[\s-]+/g, '');
  return ACCESS_CODE_PATTERN.test(code) ? code : '';
}
const showAccessCode = code => (code && code.length === 8 ? code.slice(0, 4) + '-' + code.slice(4) : String(code || ''));
const referenceFor = code => 'PLC RV ' + code;
const accessLink = code => PAGE_URL + '?access=' + encodeURIComponent(code);
const randomKey = () => randomBytes(24).toString('base64url');
function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ─── Packs ───
function slugify(value) {
  const slug = String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug.length >= 2 ? slug : 'pack';
}
function cleanIds(list, max, pattern = DOC_ID) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > max) fail('too-many-items');
  const out = [];
  for (const id of list) {
    if (typeof id !== 'string' || !pattern.test(id)) fail();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
function cleanMinutes(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < LIMITS.minMinutes || n > LIMITS.maxMinutes) fail('invalid-minutes');
  return n;
}
function cleanTopic(topic, index) {
  checkKeys(topic, ['id', 'title', 'note', 'worksheetIds', 'mindmapIds', 'minutes']);
  const id = topic.id === undefined || topic.id === '' ? 't' + (index + 1) + '-' + randomBytes(3).toString('hex') : text(topic.id, 40, { min: 1 });
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) fail();
  return {
    id,
    title: text(topic.title, 120, { min: 1 }),
    note: text(topic.note, 500, { lines: true }),
    worksheetIds: cleanIds(topic.worksheetIds, LIMITS.worksheetsPerTopic),
    mindmapIds: cleanIds(topic.mindmapIds, LIMITS.mindmapsPerTopic),
    minutes: cleanMinutes(topic.minutes, DEFAULTS.minutes)
  };
}
// A pack as the admin saves it, checked field by field.
function cleanPack(input) {
  checkKeys(input, ['id', 'title', 'tagline', 'description', 'level', 'subject', 'examName', 'examDate', 'price', 'active',
    'accessDaysAfterExam', 'accessDays', 'sort', 'topics']);
  const title = text(input.title, 120, { min: 1 });
  const id = input.id === undefined || input.id === '' ? '' : text(input.id, 48, { min: 2 });
  if (id && !PACK_ID.test(id)) fail('invalid-pack-id');
  const level = input.level === undefined || input.level === '' ? '' : input.level;
  if (level && !LEVELS.includes(level)) fail('invalid-level');
  const subject = input.subject === undefined || input.subject === '' ? '' : input.subject;
  if (subject && !SUBJECTS.includes(subject)) fail('invalid-subject');
  const examDate = input.examDate === undefined || input.examDate === null || input.examDate === '' ? '' : input.examDate;
  if (examDate && !realDayKey(examDate)) fail('invalid-exam-date');
  const price = Math.round(Number(input.price) * 100) / 100;
  if (!Number.isFinite(price) || price < LIMITS.minPrice || price > LIMITS.maxPrice) fail('invalid-price');
  const whole = (value, fallback, min, max) => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < min || n > max) fail('invalid-access-days');
    return n;
  };
  if (input.topics !== undefined && (!Array.isArray(input.topics) || input.topics.length > LIMITS.topics)) fail('too-many-topics');
  const topics = (input.topics || []).map(cleanTopic);
  const ids = new Set();
  topics.forEach(topic => { if (ids.has(topic.id)) topic.id += '-' + randomBytes(2).toString('hex'); ids.add(topic.id); });
  return {
    id, title,
    tagline: text(input.tagline, 200),
    description: text(input.description, 2000, { lines: true }),
    level, subject,
    examName: text(input.examName, 40),
    examDate,
    price,
    active: input.active === true,
    accessDaysAfterExam: whole(input.accessDaysAfterExam, DEFAULTS.accessDaysAfterExam, 0, 365),
    accessDays: whole(input.accessDays, DEFAULTS.accessDays, 7, 1100),
    sort: whole(input.sort, 0, -1000, 1000),
    topics
  };
}
// A stored pack, read tolerantly (old fields, hand edits in the console).
function readPack(id, data) {
  const d = data && typeof data === 'object' ? data : {};
  const topics = Array.isArray(d.topics) ? d.topics : [];
  return {
    id,
    title: String(d.title || 'Revision pack').slice(0, 120),
    tagline: String(d.tagline || '').slice(0, 200),
    description: String(d.description || '').slice(0, 2000),
    level: LEVELS.includes(d.level) ? d.level : '',
    subject: SUBJECTS.includes(d.subject) ? d.subject : '',
    examName: String(d.examName || '').slice(0, 40),
    examDate: realDayKey(d.examDate) ? d.examDate : '',
    price: Math.round(num(d.price, 0) * 100) / 100,
    active: d.active === true,
    accessDaysAfterExam: Math.max(0, Math.round(num(d.accessDaysAfterExam, DEFAULTS.accessDaysAfterExam))),
    accessDays: Math.max(1, Math.round(num(d.accessDays, DEFAULTS.accessDays))),
    sort: Math.round(num(d.sort, 0)),
    starter: d.starter === true,
    topics: topics.filter(t => t && typeof t === 'object').slice(0, LIMITS.topics).map((t, i) => ({
      id: typeof t.id === 'string' && t.id ? t.id.slice(0, 40) : 't' + (i + 1),
      title: String(t.title || 'Topic ' + (i + 1)).slice(0, 120),
      note: String(t.note || '').slice(0, 500),
      worksheetIds: (Array.isArray(t.worksheetIds) ? t.worksheetIds : []).filter(x => typeof x === 'string' && DOC_ID.test(x)).slice(0, LIMITS.worksheetsPerTopic),
      mindmapIds: (Array.isArray(t.mindmapIds) ? t.mindmapIds : []).filter(x => typeof x === 'string' && DOC_ID.test(x)).slice(0, LIMITS.mindmapsPerTopic),
      minutes: Math.min(LIMITS.maxMinutes, Math.max(LIMITS.minMinutes, Math.round(num(t.minutes, DEFAULTS.minutes))))
    })),
    updatedAtMs: toMillis(d.updatedAt, 0),
    updatedBy: String(d.updatedBy || '')
  };
}
const packSheetIds = pack => [...new Set(pack.topics.flatMap(t => t.worksheetIds))];
const packMapIds = pack => [...new Set(pack.topics.flatMap(t => t.mindmapIds))];
const packTitleFull = pack => pack.title;
// A pack may be sold when it is switched on, has a price and the exam is not over.
function packOnSale(pack, now) {
  if (!pack || !pack.active || !(pack.price >= LIMITS.minPrice) || !pack.topics.length) return false;
  const left = daysUntil(pack.examDate, now);
  return left === null || left >= 0;
}
// When a buyer's access ends: the end of the exam day + accessDaysAfterExam,
// or accessDays after payment when the pack has no exam date.
function accessEndsAt(pack, paidAt) {
  if (pack && pack.examDate) return sgDayStart(pack.examDate) + (pack.accessDaysAfterExam + 1) * DAY;
  return paidAt + (pack ? pack.accessDays : DEFAULTS.accessDays) * DAY;
}

// ─── Worksheets, answer keys, videos, mind maps ───
// online/portal-core.js answerKeyUrlOk: a Firebase Storage link, for a key file, with a token.
const KEY_OBJECT = /^pdf-annotator\/lesson-key-[A-Za-z0-9_-]{1,80}-\d{4}-\d{2}-\d{2}\.pdf$/;
function answerKeyObject(url) {
  const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[A-Za-z0-9._-]+\/o\/([^?#]+)\?(.*)$/.exec(String(url || ''));
  if (!m) return '';
  let name;
  try { name = decodeURIComponent(m[1]); } catch { return ''; }
  return KEY_OBJECT.test(name) ? name : '';
}
// The newest answer key filed on the worksheet: { day, path, pages } or null.
function latestAnswerKey(sheet) {
  const map = sheet && sheet.answerKeys;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  let best = null;
  for (const day of Object.keys(map)) {
    const entry = map[day];
    if (!realDayKey(day) || !entry || typeof entry !== 'object') continue;
    const path = answerKeyObject(entry.url);
    if (!path) continue;
    if (!best || day > best.day) best = { day, path, pages: Math.max(0, Math.floor(num(entry.pages, 0))), videos: Math.max(0, Math.floor(num(entry.videos, 0))) };
  }
  return best;
}
// online/portal-core.js videoPackCode / videoPageLink, byte for byte: the address
// of the worksheet's video page, the same one its printed QR code opens.
const VP_HASH_RE = /^vp1-\d{1,7}-[0-9a-f]{1,8}$/;
const VP_TOKEN_RE = /^[0-9A-Za-z-]{16,80}$/;
const VP_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function videoPackCode(hash, token) {
  if (!VP_HASH_RE.test(String(hash || '')) || typeof token !== 'string' || !VP_UUID_RE.test(token)) return '';
  const parts = hash.split('-');
  const len = Number(parts[1]), hv = parseInt(parts[2], 16);
  if (!(len >= 0 && len < 16777216) || !(hv >= 0 && hv <= 4294967295)) return '';
  const bytes = [(len >>> 16) & 255, (len >>> 8) & 255, len & 255, (hv >>> 24) & 255, (hv >>> 16) & 255, (hv >>> 8) & 255, hv & 255];
  const hex = token.replace(/-/g, '');
  for (let i = 0; i < 32; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return Buffer.from(bytes).toString('base64url');
}
function videoPage(sheet) {
  const p = sheet && sheet.videoPlaylist;
  if (!p || typeof p !== 'object' || !VP_HASH_RE.test(String(p.hash || '')) || !VP_TOKEN_RE.test(String(p.token || ''))) return null;
  const n = Math.max(0, Math.floor(num(p.n, 0)));
  if (!n) return null;
  const code = videoPackCode(p.hash, p.token);
  return { url: ANSKEY_BASE + 'videos.html?' + (code || 'p=' + encodeURIComponent(p.hash) + '&t=' + encodeURIComponent(p.token)), count: n };
}
// What a worksheet holds, without any link: for the catalogue and the admin.
function sheetSummary(id, sheet) {
  if (!sheet || sheet.hidden === true) return { id, name: '', missing: true };
  const key = latestAnswerKey(sheet), video = videoPage(sheet);
  return {
    id, name: String(sheet.name || 'Worksheet').slice(0, 160), pages: Math.max(0, Math.floor(num(sheet.pageCount, 0))),
    hasFile: !!sheet.storagePath, hasKey: !!key, keyDay: key ? key.day : '', videos: video ? video.count : 0
  };
}
// A mind map as an outline the pack page draws: the topics, notes, pictures and
// question titles, never code windows or the owner's details.
function mapOutline(id, data) {
  if (!data || data.published !== true) return null;
  const nodes = (Array.isArray(data.nodes) ? data.nodes : []).filter(n => n && typeof n.id === 'string').slice(0, LIMITS.mapNodes);
  const ids = new Set(nodes.map(n => n.id));
  const rootId = typeof data.rootId === 'string' && ids.has(data.rootId) ? data.rootId : (nodes.find(n => !n.parentId) || {}).id || '';
  const out = [];
  for (const n of nodes) {
    if (n.type === 'code') continue;
    const item = {
      id: n.id.slice(0, 64),
      parentId: n.id === rootId ? '' : (typeof n.parentId === 'string' && ids.has(n.parentId) ? n.parentId.slice(0, 64) : rootId),
      type: ['topic', 'note', 'image', 'question'].includes(n.type) ? n.type : 'topic',
      text: String(n.text || '').slice(0, 600),
      color: typeof n.color === 'string' && /^[a-z]{2,10}$/.test(n.color) ? n.color : 'white'
    };
    if (item.type === 'note') item.note = String(n.note || '').slice(0, 2000);
    if (item.type === 'image' && n.image && typeof n.image.url === 'string' && /^https:\/\//.test(n.image.url) && n.image.url.length < 2000)
      item.image = n.image.url;
    if (item.type === 'question') item.text = String(n.question && n.question.title || n.text || 'Practice question').slice(0, 200);
    out.push(item);
  }
  return { id, title: String(data.title || 'Mind map').slice(0, 120), rootId, nodes: out };
}

// ─── Signed file links: a worksheet or answer key PDF, for one order, for a day ───
function fileSignature(order, kind, id, until) {
  return createHmac('sha256', String(order.fileKey || '')).update([order.code, kind, id, until].join('|')).digest('base64url').slice(0, 32);
}
function fileUrl(order, kind, id, until) {
  return FILE_ENDPOINT + '?o=' + encodeURIComponent(order.code) + '&k=' + kind + '&d=' + encodeURIComponent(id)
    + '&x=' + until + '&s=' + fileSignature(order, kind, id, until);
}

// ─── Public views ───
function catalogueEntry(pack, sheets, now) {
  const ids = packSheetIds(pack);
  const summaries = ids.map(id => sheetSummary(id, sheets[id])).filter(s => !s.missing);
  return {
    id: pack.id, title: pack.title, tagline: pack.tagline, description: pack.description,
    level: pack.level, subject: pack.subject, subjectName: subjectName(pack.subject), levelName: levelName(pack.level),
    examName: pack.examName, examDate: pack.examDate, daysLeft: daysUntil(pack.examDate, now),
    price: pack.price,
    topics: pack.topics.map(t => ({ title: t.title, papers: t.worksheetIds.filter(id => sheets[id] && sheets[id].hidden !== true).length, maps: t.mindmapIds.length })),
    counts: {
      topics: pack.topics.length,
      papers: summaries.length,
      keys: summaries.filter(s => s.hasKey).length,
      videos: summaries.filter(s => s.videos > 0).length,
      maps: packMapIds(pack).length
    }
  };
}
// The pack as its buyer sees it: every topic with fresh links.
function buyerPack(pack, order, sheets, maps, now) {
  const until = now + PAGE_LINK_MS;
  return {
    id: pack.id, title: pack.title, tagline: pack.tagline, description: pack.description,
    level: pack.level, subject: pack.subject, subjectName: subjectName(pack.subject), levelName: levelName(pack.level),
    examName: pack.examName, examDate: pack.examDate, daysLeft: daysUntil(pack.examDate, now),
    topics: pack.topics.map(topic => ({
      id: topic.id, title: topic.title, note: topic.note, minutes: topic.minutes,
      papers: topic.worksheetIds.map(id => {
        const sheet = sheets[id];
        if (!sheet || sheet.hidden === true) return null;
        const key = latestAnswerKey(sheet), video = videoPage(sheet);
        return {
          id, name: String(sheet.name || 'Worksheet').slice(0, 160), pages: Math.max(0, Math.floor(num(sheet.pageCount, 0))),
          paper: sheet.storagePath ? fileUrl(order, 'ws', id, until) : '',
          key: key ? fileUrl(order, 'key', id, until) : '', keyDay: key ? key.day : '',
          videos: video ? video.url : '', videoCount: video ? video.count : 0
        };
      }).filter(Boolean),
      maps: topic.mindmapIds.map(id => maps[id]).filter(Boolean)
    }))
  };
}
function publicOrder(order) {
  return {
    code: order.code, reference: order.reference, status: order.status, payment: order.payment,
    packId: order.packId, packTitle: order.packTitle, total: order.total,
    accessCode: order.status === 'paid' ? showAccessCode(order.accessCode) : '',
    accessEndsAt: order.accessEndsAt || 0
  };
}
function adminOrder(order) {
  return {
    code: order.code, reference: order.reference, status: order.status, payment: order.payment || '',
    packId: order.packId, packTitle: order.packTitle, total: order.total,
    buyer: order.buyer || {}, accessCode: order.accessCode ? showAccessCode(order.accessCode) : '',
    createdAtMs: toMillis(order.createdAt, 0), paidAtMs: toMillis(order.paidAt, 0), accessEndsAt: order.accessEndsAt || 0,
    opens: num(order.opens, 0), lastOpenedAtMs: toMillis(order.lastOpenedAt, 0),
    mailCount: num(order.mailCount, 0), mailSentAtMs: toMillis(order.mailSentAt, 0),
    paidBy: order.paidBy || '', cancelledBy: order.cancelledBy || '', amountCheck: order.amountCheck || ''
  };
}

// ─── Buying ───
function validateBuyer(input) {
  checkKeys(input, ['name', 'email', 'phone', 'student']);
  const name = text(input.name, 80, { min: 1 });
  const email = text(input.email, 120, { min: 3 }).toLowerCase();
  if (!validEmail(email)) fail('invalid-email');
  const phone = text(input.phone, 24);
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    if (!/^\+?[0-9 ()-]+$/.test(phone) || digits.length < 8 || digits.length > 15) fail('invalid-phone');
  }
  return { name, email, phone, student: text(input.student, 80) };
}
function returnBase(value) {
  let url;
  try { url = new URL(text(value, 300, { min: 1 })); } catch (error) { if (error instanceof ShopError) throw error; fail(); }
  if (!ORIGINS.includes(url.origin) || !REVISION_RETURN_PATH.test(url.pathname)) fail('return-url-not-allowed');
  return url.origin + url.pathname;
}
function validateCheckout(body) {
  checkKeys(body, ['action', 'packId', 'method', 'buyer', 'returnUrl', 'pageVersion']);
  const packId = text(body.packId, 48, { min: 2 });
  if (!PACK_ID.test(packId)) fail('pack-not-found');
  if (!['card', 'paynow'].includes(body.method)) fail();
  return { packId, method: body.method, buyer: validateBuyer(body.buyer), returnBase: body.method === 'card' ? returnBase(body.returnUrl) : '',
    pageVersion: text(body.pageVersion, 20) };
}
function orderRecord(request, pack, code, now) {
  const totalCents = toCents(pack.price);
  return {
    code, reference: referenceFor(code), source: REVISION_SOURCE,
    status: request.method === 'card' ? 'open' : 'pending', payment: request.method,
    packId: pack.id, packTitle: pack.title, examDate: pack.examDate,
    total: totalCents / 100, totalCents, currency: CURRENCY,
    buyer: request.buyer, pageVersion: request.pageVersion, returnBase: request.returnBase,
    fileKey: randomKey(), accessCode: '', opens: 0, mailCount: 0,
    createdAt: now, sessionExpiresAt: request.method === 'card' ? now + SESSION_MS : 0
  };
}
function sessionParams(order) {
  const metadata = { source: REVISION_SOURCE, revision_code: order.code, reference: order.reference, pack: order.packId };
  const back = order.returnBase + '?order=' + order.code;
  return {
    mode: 'payment',
    payment_method_types: ['card'],
    submit_type: 'pay',
    client_reference_id: order.code,
    customer_email: order.buyer.email,
    line_items: [{ quantity: 1, price_data: { currency: CURRENCY, unit_amount: order.totalCents,
      product_data: { name: order.packTitle.slice(0, 200), description: 'Polymath exam countdown revision pack · instant access code by email' } } }],
    metadata,
    payment_intent_data: { description: 'Polymath revision pack ' + order.code + ' (' + order.reference + ')', metadata },
    success_url: back + '&session={CHECKOUT_SESSION_ID}',
    cancel_url: back + '&cancelled=1',
    expires_at: Math.floor(order.sessionExpiresAt / 1000)
  };
}
const sessionIsPaid = session => session && session.payment_status === 'paid' && (session.status === 'complete' || session.status === undefined);
const sessionIsRevision = session => !!(session && session.metadata && session.metadata.source === REVISION_SOURCE);
const sessionCode = session => session && (session.client_reference_id || (session.metadata && session.metadata.revision_code));

// ─── Emails (Trigger Email's `mail` collection, from admin@) ───
function emailShell(title, inner) {
  return '<!doctype html><html><body style="margin:0;background:#f2f9fa;font-family:Arial,Helvetica,sans-serif;color:#10303a">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f9fa;padding:24px 0"><tr><td align="center">'
    + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;border:1px solid #d1eaee">'
    + '<tr><td style="padding:22px 26px 6px"><img src="' + LOGO_URL + '" alt="Polymath" width="44" height="44" style="vertical-align:middle;border-radius:10px">'
    + '<span style="font-weight:bold;font-size:16px;margin-left:10px;vertical-align:middle">Polymath Learning Centre</span></td></tr>'
    + '<tr><td style="padding:6px 26px 24px"><h1 style="font-size:20px;margin:10px 0 12px">' + escapeHtml(title) + '</h1>' + inner + '</td></tr>'
    + '<tr><td style="padding:14px 26px;border-top:1px solid #e5f2f4;font-size:12px;color:#5b7780">Questions? Reply to this email or WhatsApp us at '
    + '<a href="https://wa.me/' + WHATSAPP_NUMBER + '" style="color:#056c76">' + WHATSAPP_DISPLAY + '</a>.</td></tr>'
    + '</table></td></tr></table></body></html>';
}
function accessMail(order, { resend = false } = {}) {
  const to = order.buyer && order.buyer.email;
  if (!validEmail(to)) return null;
  const code = showAccessCode(order.accessCode), link = accessLink(order.accessCode);
  const until = order.accessEndsAt ? fmtDay(order.accessEndsAt - 1) : '';
  const subject = (resend ? 'Again: ' : '') + 'Your revision pack access code: ' + code;
  const lines = [
    'Hi ' + (order.buyer.name || 'there') + ',', '',
    'Thank you for buying "' + order.packTitle + '". Your payment is received.', '',
    'Your access code: ' + code,
    'Open your pack: ' + link, '',
    'Order: ' + order.code + ' (' + order.reference + ')',
    'Paid: ' + money(order.total) + ' by ' + (order.payment === 'card' ? 'card' : 'PayNow'),
    until ? 'Your access lasts until: ' + until : '', '',
    'The code works on any phone, tablet or computer. Keep this email so you can find it again.', '',
    'Polymath Learning Centre', 'WhatsApp ' + WHATSAPP_DISPLAY
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '');
  const row = (label, value) => '<tr><td style="padding:4px 0;color:#5b7780;width:140px">' + escapeHtml(label) + '</td><td style="padding:4px 0;font-weight:bold">' + escapeHtml(value) + '</td></tr>';
  const html = emailShell('Your revision pack is ready', '<p style="margin:0 0 14px">Hi ' + escapeHtml(order.buyer.name || 'there') + ', thank you for buying <b>'
    + escapeHtml(order.packTitle) + '</b>. Your payment is received.</p>'
    + '<div style="text-align:center;background:#f2f9fa;border:1px dashed #2e9ca6;border-radius:12px;padding:16px;margin:0 0 16px">'
    + '<div style="font-size:12px;color:#5b7780;letter-spacing:.08em">YOUR ACCESS CODE</div>'
    + '<div style="font-size:30px;font-weight:bold;letter-spacing:.14em;font-family:Consolas,Menlo,monospace;color:#056c76;margin:4px 0 12px">' + escapeHtml(code) + '</div>'
    + '<a href="' + escapeHtml(link) + '" style="display:inline-block;background:#056c76;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">Open my revision pack</a></div>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;width:100%">'
    + row('Order', order.code + ' (' + order.reference + ')') + row('Paid', money(order.total) + ' by ' + (order.payment === 'card' ? 'card' : 'PayNow'))
    + (until ? row('Access until', until) : '') + '</table>'
    + '<p style="font-size:13px;color:#5b7780;margin:16px 0 0">The code works on any phone, tablet or computer. Keep this email so you can find it again.</p>');
  return { to: [to], from: SENDER_NAME + ' <' + SENDER_EMAIL + '>', replyTo: SENDER_EMAIL, message: { subject, text: lines.join('\n'), html } };
}
function adminMail(order, kind) {
  const buyer = order.buyer || {};
  const what = kind === 'pending' ? 'PayNow revision pack order to check' : 'Revision pack sold';
  const subject = what + ': ' + order.packTitle + ' · ' + money(order.total) + ' · ' + order.code;
  const lines = [
    what + '.', '',
    'Pack: ' + order.packTitle,
    'Amount: ' + money(order.total) + ' (' + (order.payment === 'card' ? 'card, paid' : 'PayNow, reference ' + order.reference) + ')',
    'Buyer: ' + (buyer.name || '') + ' <' + (buyer.email || '') + '>' + (buyer.phone ? ' · ' + buyer.phone : ''),
    buyer.student ? 'Student: ' + buyer.student : '',
    kind === 'pending' ? 'When the PayNow transfer shows in the bank, open ' + PAGE_URL + '#admin → Orders → Mark paid. The buyer then gets their access code by email.' : 'The buyer was emailed their access code.'
  ].filter(Boolean);
  const html = emailShell(what, lines.map(line => '<p style="margin:0 0 8px">' + escapeHtml(line) + '</p>').join(''));
  return { to: NOTIFICATION_EMAILS.slice(), from: SENDER_NAME + ' <' + SENDER_EMAIL + '>', replyTo: validEmail(buyer.email) ? buyer.email : SENDER_EMAIL,
    message: { subject, text: lines.join('\n'), html } };
}

// ─── The starter packs (made once, from the /online P6 classes) ───
const SCIENCE_WORDS = /\b(science|cells?|plants?|animals?|energy|forces?|light|heat|magnets?|electric\w*|circuits?|matter|water cycle|cycles?|systems?|reproduction|adaptations?|environment|food (?:chains?|webs?)|photosynthesis|respiration|digestive|interactions?)\b/i;
function guessSubject(title) { return SCIENCE_WORDS.test(String(title || '')) ? 'science' : 'math'; }
function courseSheetIds(course) { return course && Array.isArray(course.worksheetIds) ? course.worksheetIds.filter(id => typeof id === 'string' && DOC_ID.test(id)) : []; }
// The /online class each starter pack follows: P6 first, the one with the most worksheets.
function starterCourse(courses, subject) {
  const list = (courses || []).filter(c => c && c.subject === subject && courseSheetIds(c).length);
  const rank = c => (c.level === 'P6' ? 1000 : c.level === 'P5' ? 500 : 0) + courseSheetIds(c).length;
  return list.sort((a, b) => rank(b) - rank(a))[0] || null;
}
function starterPacks(courses, sheets, maps, now) {
  const year = new Date(now + SG_OFFSET).getUTCFullYear() + 1;
  const out = [];
  for (const subject of ['math', 'science']) {
    const course = starterCourse(courses, subject);
    if (!course) continue;
    const level = LEVELS.includes(course.level) ? course.level : 'P6';
    const ids = courseSheetIds(course).filter(id => sheets[id] && sheets[id].hidden !== true).slice(0, LIMITS.topics);
    if (!ids.length) continue;
    const topics = ids.map((id, i) => ({
      id: 't' + (i + 1), title: String(sheets[id].name || 'Practice paper ' + (i + 1)).slice(0, 120), note: '',
      worksheetIds: [id], mindmapIds: [], minutes: DEFAULTS.minutes
    }));
    const mapIds = maps.filter(m => guessSubject(m.title) === subject).map(m => m.id).slice(0, LIMITS.mindmapsPerTopic);
    if (mapIds.length && topics.length < LIMITS.topics)
      topics.push({ id: 'maps', title: 'Mind maps: the big picture', note: 'Mr Chung\'s mind maps for the whole syllabus. Open one before each practice paper.',
        worksheetIds: [], mindmapIds: mapIds, minutes: DEFAULTS.minutes });
    const exam = level === 'P6' ? 'PSLE' : 'Year-end exam';
    out.push({
      id: (level === 'P6' ? 'psle-' : 'year-end-') + level.toLowerCase() + '-' + subject + '-' + year,
      title: (level === 'P6' ? 'PSLE ' : 'Year-end ') + 'Countdown: ' + levelName(level) + ' ' + subjectName(subject),
      tagline: 'A week-by-week plan to ' + exam + ' day, with timed practice papers, answer keys, video explanations and mind maps.',
      description: 'Every practice paper here is one our ' + levelName(level) + ' ' + subjectName(subject) + ' students work through in class at Polymath. '
        + 'Each topic has a timed practice paper, the teacher\'s worked answer key, the lesson videos that explain it, and mind maps to revise from. '
        + 'The countdown spreads the topics over the weeks left, so you always know what to do this week.',
      level, subject, examName: exam,
      // A placeholder for the admin to set (shown as "please check" in admin).
      examDate: year + '-09-30',
      price: DEFAULTS.price, active: true,
      accessDaysAfterExam: DEFAULTS.accessDaysAfterExam, accessDays: DEFAULTS.accessDays, sort: out.length,
      starter: true, topics
    });
  }
  return out;
}

// ─── The service ───
function createRevisionService({ store, stripe, http, hashIp, verifyIdToken, cardConfigured = true, now = Date.now, random = randomInt, report = () => {} }) {
  const ipOf = req => String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown');
  const quota = (name, req, at, maximum) => {
    const hour = Math.floor(at / HOUR);
    return { id: 'revision-' + name + '-' + hashIp(ipOf(req)) + '-' + hour, maximum, expiresAt: (hour + 1) * HOUR + DAY };
  };
  const dayQuota = (name, at, maximum) => {
    const day = Math.floor(at / DAY);
    return { id: 'revision-' + name + '-' + day, maximum, expiresAt: (day + 2) * DAY };
  };

  // The starter packs, made the first time the catalogue or the admin opens.
  async function ensureStarterPacks(at) {
    const root = await store.getRoot();
    if (root && root.seededAt) return false;
    let packs = [];
    try {
      const courses = await store.loadCourses();
      const wanted = new Set();
      for (const subject of ['math', 'science']) courseSheetIds(starterCourse(courses, subject)).forEach(id => wanted.add(id));
      const [sheets, maps] = await Promise.all([store.loadSheets([...wanted]), store.listPublishedMaps()]);
      packs = starterPacks(courses, sheets, maps, at);
    } catch (error) {
      report('revision-starter-failed');
      return false;
    }
    return store.seed(packs, at);
  }

  async function loadPacks() {
    return (await store.listPacks()).map(p => readPack(p.id, p)).sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  }
  async function cardPaymentsOn() {
    const settings = await store.loadShopSettings();
    return !!cardConfigured && !(settings && settings.cardPayments === false);
  }

  async function catalogue(at) {
    await ensureStarterPacks(at);
    const packs = (await loadPacks()).filter(pack => packOnSale(pack, at));
    const sheets = await store.loadSheets([...new Set(packs.flatMap(packSheetIds))]);
    return { packs: packs.map(pack => catalogueEntry(pack, sheets, at)), cardPayments: await cardPaymentsOn(),
      paynow: { uen: UEN, merchant: MERCHANT_NAME } };
  }

  async function checkout(req, body, at) {
    const request = validateCheckout(body);
    const pack = await store.getPack(request.packId);
    const read = pack ? readPack(request.packId, pack) : null;
    if (!read || !packOnSale(read, at)) throw new ShopError(409, 'pack-unavailable');
    if (request.method === 'card' && !(await cardPaymentsOn())) throw new ShopError(503, 'card-payments-off');
    const cents = toCents(read.price);
    if (cents === null || cents < SHOP_LIMITS.minimumCents) throw new ShopError(409, 'price-not-set');
    await store.countAttempts([quota('buy', req, at, LIMITS.checkoutPerIpHour), dayQuota('buy', at, LIMITS.checkoutPerDay)], 'too-many-orders');
    const order = await store.createOrder(code => orderRecord(request, read, code, at), () => newOrderCode(random),
      request.method === 'paynow' ? record => adminMail(record, 'pending') : null);
    if (request.method === 'paynow')
      return { ok: true, method: 'paynow', code: order.code, reference: order.reference, total: order.total,
        paynow: { uen: UEN, merchant: MERCHANT_NAME } };
    const session = await stripe.createCheckoutSession(sessionParams(order), 'polymath-revision-' + order.code);
    if (!session || typeof session.url !== 'string' || typeof session.id !== 'string') throw new StripeError(502, 'stripe-error', 'no-session-url');
    await store.updateOrder(order.code, { sessionId: session.id });
    return { ok: true, method: 'card', code: order.code, reference: order.reference, total: order.total, url: session.url };
  }

  // Marks an order paid, gives it an access code and emails it, once.
  const markPaid = (code, payment, by, at) => store.markPaid(code, {
    at, by, payment,
    newCode: () => newAccessCode(random),
    endsAt: (order, pack) => accessEndsAt(pack ? readPack(order.packId, pack) : null, at),
    buildMails: order => [accessMail(order), order.payment === 'card' ? adminMail(order, 'paid') : null].filter(Boolean),
    mailId: (order, n) => MAIL_PREFIX + order.code + '-' + n
  });

  async function status(body, at) {
    checkKeys(body, ['action', 'code', 'sessionId']);
    const code = body.code, sessionId = body.sessionId;
    if (!validCode(code) || typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]{8,250}$/.test(sessionId)) fail();
    const order = await store.getOrder(code);
    // An unknown code and a wrong session look the same, so codes cannot be probed.
    if (!order || order.payment !== 'card' || order.sessionId !== sessionId) throw new ShopError(404, 'order-not-found');
    if (order.status === 'paid') return { ok: true, paid: true, order: publicOrder(order) };
    if (order.status === 'cancelled') return { ok: true, paid: false, state: 'cancelled' };
    const session = await stripe.retrieveCheckoutSession(sessionId);
    if (!sessionIsRevision(session) || sessionCode(session) !== code) throw new ShopError(404, 'order-not-found');
    if (!sessionIsPaid(session)) return { ok: true, paid: false, state: String(session.status || 'open') };
    const result = await markPaid(code, paymentFromSession(session), 'stripe', at);
    return { ok: true, paid: true, order: publicOrder(result.order) };
  }

  // The buyer's way in: their access code → the whole pack, with fresh links.
  async function open(req, body, at) {
    checkKeys(body, ['action', 'access']);
    await store.countAttempts([quota('open', req, at, LIMITS.openPerIpHour)], 'too-many-attempts');
    const access = normalAccessCode(body.access);
    const order = access ? await store.orderForAccess(access) : null;
    if (!order || order.status !== 'paid' || order.accessCode !== access) {
      await store.countAttempts([quota('wrong', req, at, LIMITS.wrongCodePerIpHour)], 'too-many-attempts');
      throw new ShopError(404, order && order.status === 'cancelled' ? 'access-cancelled' : 'access-not-found');
    }
    if (order.accessEndsAt && at >= order.accessEndsAt) throw new ShopError(410, 'access-ended');
    const raw = await store.getPack(order.packId);
    if (!raw) throw new ShopError(404, 'pack-removed');
    const pack = readPack(order.packId, raw);
    const [sheets, mapDocs] = await Promise.all([store.loadSheets(packSheetIds(pack)), store.loadMaps(packMapIds(pack))]);
    const maps = {};
    for (const [id, data] of Object.entries(mapDocs)) { const outline = mapOutline(id, data); if (outline) maps[id] = outline; }
    await store.noteOpen(order.code, at).catch(() => report('revision-open-note-failed'));
    return {
      ok: true, now: at,
      buyer: { name: (order.buyer && order.buyer.name) || '', student: (order.buyer && order.buyer.student) || '' },
      access: showAccessCode(order.accessCode), accessEndsAt: order.accessEndsAt || 0,
      pack: buyerPack(pack, order, sheets, maps, at)
    };
  }

  // POST /revisionPack  { action: catalogue | checkout | status | open }
  // GET  /revisionPack?o=<order>&k=ws|key&d=<worksheet>&x=<expires>&s=<signature>  a PDF
  async function revisionPack(req, res) {
    if (req.method === 'GET' || req.method === 'HEAD') return file(req, res);
    if (!http.cors(req, res)) return;
    try {
      const at = now();
      const body = req.body;
      const action = body && typeof body === 'object' && !Array.isArray(body) ? body.action : '';
      if (action === 'catalogue') { checkKeys(body, ['action']); return res.status(200).json(Object.assign({ ok: true, now: at }, await catalogue(at))); }
      if (action === 'checkout') return res.status(201).json(await checkout(req, body, at));
      if (action === 'status') return res.status(200).json(await status(body, at));
      if (action === 'open') return res.status(200).json(await open(req, body, at));
      fail('unknown-action');
    } catch (error) {
      return http.answerError(res, error, 'revision-request-failed');
    }
  }

  async function file(req, res) {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    const page = (code, message) => res.status(code).type('html').send('<!doctype html><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Polymath revision pack</title>'
      + '<body style="font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#10303a">'
      + '<h1 style="font-size:20px">Paper not available</h1><p>' + escapeHtml(message) + '</p>'
      + '<p>Please open your revision pack again at <a href="' + PAGE_URL + '">' + PAGE_URL + '</a>, or WhatsApp us at <a href="https://wa.me/' + WHATSAPP_NUMBER + '">' + WHATSAPP_DISPLAY + '</a>.</p></body>');
    try {
      const at = now();
      const q = req.query || {};
      const code = validCode(q.o) ? q.o : '';
      const kind = q.k === 'ws' || q.k === 'key' ? q.k : '';
      const id = typeof q.d === 'string' && DOC_ID.test(q.d) ? q.d : '';
      const until = typeof q.x === 'string' && /^\d{12,15}$/.test(q.x) ? Number(q.x) : NaN;
      const signature = typeof q.s === 'string' && /^[\w-]{32}$/.test(q.s) ? q.s : '';
      if (!code || !kind || !id || !Number.isFinite(until) || !signature) return page(404, 'This link is not valid.');
      await store.countAttempts([quota('file', req, at, LIMITS.filePerIpHour)], 'too-many-attempts');
      const order = await store.getOrder(code);
      if (!order || order.status !== 'paid' || !sameText(fileSignature(order, kind, id, until), signature)) return page(404, 'This link is not valid.');
      if (!(at < until)) return page(410, 'This link has expired. Open your revision pack again for fresh links.');
      if (order.accessEndsAt && at >= order.accessEndsAt) return page(410, 'Access to this revision pack has ended.');
      const raw = await store.getPack(order.packId);
      if (!raw || !packSheetIds(readPack(order.packId, raw)).includes(id)) return page(404, 'This paper is no longer in the pack.');
      const sheet = (await store.loadSheets([id]))[id];
      if (!sheet || sheet.hidden === true) return page(404, 'This paper is not available right now.');
      let path = '', name = String(sheet.name || 'Worksheet').replace(/[^\w .,()&+-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110) || 'Worksheet';
      if (kind === 'ws') path = sheet.storagePath;
      else { const key = latestAnswerKey(sheet); path = key ? key.path : ''; name += ' - answer key'; }
      const pdf = path ? await store.openPdf(path) : null;
      if (!pdf) return page(404, 'This file could not be found.');
      res.status(200);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'inline; filename="' + name + '.pdf"');
      if (pdf.size) res.set('Content-Length', String(pdf.size));
      if (req.method === 'HEAD') return res.end();
      await new Promise(resolve => {
        pdf.stream.on('error', () => { report('revision-file-stream-failed'); if (!res.headersSent) page(502, 'The file could not be sent.'); else res.end(); resolve(); });
        pdf.stream.on('end', resolve);
        pdf.stream.pipe(res);
      });
    } catch (error) {
      if (error instanceof ShopError && error.status === 429) return page(429, 'Too many downloads from this connection. Please try again in an hour.');
      report('revision-file-failed');
      return page(503, 'Something went wrong. Please try again in a moment.');
    }
  }

  // POST /revisionPackAdmin (signed-in admins only)  { action, … }
  async function revisionPackAdmin(req, res) {
    if (!http.cors(req, res)) return;
    try {
      const at = now();
      const email = await trialAdminFrom(req, verifyIdToken);
      const body = req.body;
      const action = body && typeof body === 'object' && !Array.isArray(body) ? body.action : '';
      if (action === 'load') {
        checkKeys(body, ['action']);
        await ensureStarterPacks(at);
        const [packs, orders, courses, maps, card] = await Promise.all([loadPacks(), store.listOrders(), store.loadCourses(),
          store.listPublishedMaps(), cardPaymentsOn()]);
        const sheets = await store.loadSheets([...new Set(packs.flatMap(packSheetIds))]);
        const summaries = {};
        Object.keys(sheets).forEach(id => { summaries[id] = sheetSummary(id, sheets[id]); });
        return res.status(200).json({ ok: true, admin: email, now: at, cardPayments: card,
          packs: packs.map(p => Object.assign({}, p, { onSale: packOnSale(p, at), daysLeft: daysUntil(p.examDate, at),
            sold: orders.filter(o => o.packId === p.id && o.status === 'paid').length })),
          sheets: summaries,
          orders: orders.filter(o => o.status !== 'open').map(adminOrder).sort((a, b) => b.createdAtMs - a.createdAtMs),
          courses: courses.filter(c => courseSheetIds(c).length).map(c => ({ id: c.id, title: String(c.title || [c.level, subjectName(c.subject), c.day].filter(Boolean).join(' ')).slice(0, 120),
            level: c.level || '', subject: c.subject || '', day: c.day || '', worksheets: courseSheetIds(c).length }))
            .sort((a, b) => String(a.level).localeCompare(String(b.level)) || String(a.subject).localeCompare(String(b.subject)) || a.title.localeCompare(b.title)),
          maps: maps.map(m => ({ id: m.id, title: m.title, nodeCount: m.nodeCount, subject: guessSubject(m.title) })) });
      }
      if (action === 'course') {
        checkKeys(body, ['action', 'courseId']);
        if (typeof body.courseId !== 'string' || !DOC_ID.test(body.courseId)) fail();
        const course = (await store.loadCourses()).find(c => c.id === body.courseId);
        if (!course) throw new ShopError(404, 'course-not-found');
        const ids = courseSheetIds(course);
        const sheets = await store.loadSheets(ids);
        return res.status(200).json({ ok: true, worksheets: ids.map(id => sheetSummary(id, sheets[id])).filter(s => !s.missing) });
      }
      if (action === 'savePack') {
        checkKeys(body, ['action', 'pack']);
        const pack = cleanPack(body.pack);
        const existing = await store.listPacks();
        let id = pack.id;
        if (!id) {
          const base = slugify(pack.title);
          id = base;
          for (let n = 2; existing.some(p => p.id === id); n++) id = base + '-' + n;
        }
        if (!existing.some(p => p.id === id) && existing.length >= LIMITS.packs) fail('too-many-packs');
        const saved = Object.assign({}, pack, { id, updatedAt: at, updatedBy: email });
        await store.savePack(id, saved);
        return res.status(200).json({ ok: true, pack: readPack(id, saved) });
      }
      if (action === 'deletePack') {
        checkKeys(body, ['action', 'packId']);
        if (typeof body.packId !== 'string' || !PACK_ID.test(body.packId)) fail();
        const orders = await store.listOrders();
        if (orders.some(o => o.packId === body.packId && o.status === 'paid')) throw new ShopError(409, 'pack-has-buyers');
        await store.deletePack(body.packId);
        return res.status(200).json({ ok: true });
      }
      if (['markPaid', 'resend', 'cancel'].includes(action)) {
        checkKeys(body, ['action', 'code']);
        if (!validCode(body.code)) fail();
        const order = await store.getOrder(body.code);
        if (!order) throw new ShopError(404, 'order-not-found');
        if (action === 'markPaid') {
          if (order.status !== 'pending') throw new ShopError(409, order.status === 'paid' ? 'already-paid' : 'order-not-pending');
          const result = await markPaid(order.code, null, email, at);
          return res.status(200).json({ ok: true, order: adminOrder(result.order) });
        }
        if (action === 'resend') {
          if (order.status !== 'paid') throw new ShopError(409, 'order-not-paid');
          const result = await store.resend(order.code, {
            at, gap: RESEND_GAP_MS, build: o => accessMail(o, { resend: true }), mailId: (o, n) => MAIL_PREFIX + o.code + '-' + n });
          return res.status(200).json({ ok: true, order: adminOrder(result.order), sentTo: result.to });
        }
        if (order.status === 'cancelled') throw new ShopError(409, 'already-cancelled');
        await store.updateOrder(order.code, { status: 'cancelled', cancelledAt: at, cancelledBy: email });
        return res.status(200).json({ ok: true, order: adminOrder(Object.assign({}, order, { status: 'cancelled', cancelledBy: email })) });
      }
      fail('unknown-action');
    } catch (error) {
      return http.answerError(res, error, 'revision-admin-failed');
    }
  }

  // Called by the shared Stripe webhook for a paid session marked as a revision pack.
  async function handlePaidSession(session) {
    const code = sessionCode(session);
    if (!validCode(code)) return { ignored: 'no-revision-code' };
    const order = await store.getOrder(code);
    if (!order) { report('stripe-webhook-unknown-revision'); return { ignored: 'unknown-revision' }; }
    const result = await markPaid(code, paymentFromSession(session), 'stripe', now());
    return { code, already: !!result.already };
  }

  return { revisionPack, revisionPackAdmin, handlePaidSession, ensureStarterPacks };
}

module.exports = {
  REVISION_SOURCE, REVISION_ROOT, PACKS, ORDERS, ACCESS, COURSES, SHEETS, MINDMAPS, MAIL_PREFIX, PAGE_URL, FILE_ENDPOINT,
  REVISION_RETURN_PATH, LIMITS, DEFAULTS, STATUSES, TRIAL_ADMINS, ACCESS_CODE_PATTERN,
  realDayKey, sgDayKey, daysUntil, newAccessCode, normalAccessCode, showAccessCode, referenceFor, accessLink,
  cleanPack, readPack, packOnSale, accessEndsAt, answerKeyObject, latestAnswerKey, videoPackCode, videoPage, sheetSummary, mapOutline,
  fileSignature, fileUrl, catalogueEntry, buyerPack, publicOrder, adminOrder, validateCheckout, orderRecord, sessionParams,
  accessMail, adminMail, guessSubject, starterCourse, starterPacks, fmtDay, fmtMoment,
  createRevisionService
};
