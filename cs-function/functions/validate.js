// Pure rules for the polymathlc.com.sg/cs download gate. No Firebase here, so
// every rule is unit-tested in isolation (test/validate.test.js) and the page
// can mirror the same wording without guessing what the server will accept.
//
// The server is the authority: the page validates for the visitor's comfort,
// and everything is validated AGAIN here before a lead is stored or a download
// is unlocked. A field that does not pass is refused with a sentence a visitor
// can act on, never with a bare "invalid".
import { createHash } from 'node:crypto';

// ───────────────────────────── Consent ─────────────────────────────
// The consent sentence is the SERVER'S, and the visitor's tick is recorded
// against this exact text and version. The page shows the text it was given
// by csListFiles and sends the version back; a page holding an older version
// is refused (failed-precondition) and reloads the text, so nobody is ever
// recorded as agreeing to words they were not shown.
//
// Changing a single word here means bumping CONSENT_VERSION.
export const CONSENT_VERSION = 'cs-marketing-v1';
export const CONSENT_CHANNELS = Object.freeze(['email', 'whatsapp']);
export const CONSENT_TEXT =
  'I agree that Polymath Learning Centre may send me marketing materials — news about classes and programmes, ' +
  'promotions, events and free learning resources — by email and by WhatsApp, using the name, email address and ' +
  'WhatsApp number I have given. I can withdraw my consent at any time by replying STOP to any WhatsApp message ' +
  'or "unsubscribe" to any email from Polymath Learning Centre.';

// ───────────────────────────── Limits ─────────────────────────────
export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const EMAIL_MAX = 120;
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 600;
export const FILE_NAME_MAX = 120;
export const HEADLINE_MAX = 120;
export const INTRO_MAX = 800;
export const THANKS_MAX = 300;
export const FILE_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
export const LEAD_ID_RE = /^L[0-9a-f]{32}$/;
// A grant key is 32 random bytes in base64url: exactly 43 characters.
export const GRANT_KEY_RE = /^[A-Za-z0-9_-]{43}$/;
// The fastest a real person fills the form in. A submission quicker than this
// is a script, and is refused with the ordinary "please try again".
export const MIN_FILL_MS = 1200;
// Every uploaded file lives under this prefix, one folder per file id.
export const STORAGE_PREFIX = 'cs-files/';
// 100 MB. Downloads are streamed (chunked), so Cloud Run's 32 MiB response
// cap does not apply; this is a sanity bound, not a transport limit.
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

// ───────────────────────────── Helpers ─────────────────────────────
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Plain text, one line: control characters out, whitespace folded, trimmed. */
export function cleanLine(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim();
}

/** Plain text that may keep paragraph breaks (descriptions, intro text). */
export function cleanBlock(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_RE, '')
    .split('\n').map(line => line.replace(/[ \t\f\v]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cut on a character boundary that does not split a surrogate pair. */
export function clip(text, max) {
  const chars = Array.from(String(text ?? ''));
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
}

export function charLength(text) { return Array.from(String(text ?? '')).length; }

export function sha256Hex(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

/** A stable, private id for a lead: the same email always lands on one row. */
export function leadIdFor(email) {
  return 'L' + sha256Hex('polymath-cs-lead|' + String(email).toLowerCase()).slice(0, 32);
}

function fail(field, message) { return { ok: false, field, message }; }
function pass(value, extra = {}) { return { ok: true, value, ...extra }; }

// ───────────────────────────── Name ─────────────────────────────
export function normaliseName(raw) {
  const value = cleanLine(raw);
  if (!value) return fail('name', 'Please enter your name.');
  const length = charLength(value);
  if (length < NAME_MIN) return fail('name', 'Please enter your full name.');
  if (length > NAME_MAX) return fail('name', 'Please keep your name under ' + NAME_MAX + ' characters.');
  if (!/\p{L}/u.test(value)) return fail('name', 'Please enter your name in letters.');
  if (/[<>{}\[\]\\]/.test(value)) return fail('name', 'Please leave symbols such as < > { } out of your name.');
  if (/(https?:\/\/|www\.|\.[a-z]{2,6}\/)/i.test(value)) return fail('name', 'Please enter your name, not a web address.');
  if (value.includes('@')) return fail('name', 'That looks like an email address — please put your name here.');
  // A run of the same character, or a long run of digits, is not a name.
  if (/(.)\1{5,}/u.test(value)) return fail('name', 'Please enter your real name.');
  if (/\d{5,}/.test(value)) return fail('name', 'Please enter your name — your number goes in the WhatsApp box.');
  return pass(value);
}

// ───────────────────────────── Email ─────────────────────────────
const EMAIL_LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const EMAIL_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_TLD_RE = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{1,59})$/;

export function normaliseEmail(raw) {
  const value = cleanLine(raw).toLowerCase().replace(/^mailto:/, '');
  if (!value) return fail('email', 'Please enter your email address.');
  if (charLength(value) > EMAIL_MAX) return fail('email', 'That email address is too long.');
  const at = value.lastIndexOf('@');
  if (at <= 0 || at !== value.indexOf('@')) return fail('email', 'Please enter a valid email address, like name@example.com.');
  const local = value.slice(0, at), domain = value.slice(at + 1);
  if (!local || local.length > 64 || !EMAIL_LOCAL_RE.test(local))
    return fail('email', 'Please check the part of your email before the @.');
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => !EMAIL_LABEL_RE.test(label)) || !EMAIL_TLD_RE.test(labels[labels.length - 1]))
    return fail('email', 'Please check the part of your email after the @.');
  return pass(value);
}

// The handful of misspellings that account for most bounced addresses. The
// page offers the correction ("Did you mean …?"); the server never rewrites
// what a visitor typed, because a real domain can look like a typo.
const EMAIL_TYPOS = Object.freeze({
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmai.com': 'gmail.com',
  'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gnail.com': 'gmail.com',
  'gamil.com': 'gmail.com', 'gmail.comm': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'hotmai.com': 'hotmail.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahooo.com': 'yahoo.com',
  'yahoo.com.sgg': 'yahoo.com.sg', 'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com', 'iclod.com': 'icloud.com',
  'icloud.con': 'icloud.com', 'live.con': 'live.com'
});

export function emailSuggestion(email) {
  const at = String(email || '').lastIndexOf('@');
  if (at <= 0) return '';
  const domain = email.slice(at + 1).toLowerCase();
  const fixed = EMAIL_TYPOS[domain];
  return fixed ? email.slice(0, at + 1) + fixed : '';
}

// ───────────────────────────── WhatsApp ─────────────────────────────
// Stored in E.164 (+6591234567). A Singapore mobile may be typed without the
// country code; anything else must carry one, because "0123456789" could be
// half a dozen countries and a wrong guess sends marketing to a stranger.
export function normaliseWhatsApp(raw) {
  const typed = cleanLine(raw);
  if (!typed) return fail('whatsapp', 'Please enter your WhatsApp number.');
  if (/[a-z]/i.test(typed)) return fail('whatsapp', 'Please enter numbers only, for example 9123 4567.');
  let text = typed.replace(/[\s().\-\u2010-\u2015\/]/g, '');
  let international = false;
  if (text.startsWith('+')) { international = true; text = text.slice(1); }
  else if (text.startsWith('00')) { international = true; text = text.slice(2); }
  if (!/^\d+$/.test(text)) return fail('whatsapp', 'Please enter numbers only, for example 9123 4567.');

  // Singapore: +65 then eight digits. Mobiles start with 8 or 9; 3 is used by
  // some VoIP numbers that do run WhatsApp. 6 is a landline and cannot.
  const sg = international ? (text.startsWith('65') ? text.slice(2) : null)
    : (text.length === 8 ? text : (text.length === 10 && text.startsWith('65') ? text.slice(2) : null));
  if (sg !== null) {
    if (sg.length !== 8) return fail('whatsapp', 'A Singapore number has 8 digits after +65.');
    if (/^6/.test(sg)) return fail('whatsapp', 'That looks like a landline. Please enter the mobile number you use for WhatsApp.');
    if (!/^[389]/.test(sg)) return fail('whatsapp', 'Please check your number — Singapore mobile numbers start with 8 or 9.');
    return pass('+65' + sg, { display: '+65 ' + sg.slice(0, 4) + ' ' + sg.slice(4), country: 'SG' });
  }
  if (!international) {
    return fail('whatsapp', 'For a number outside Singapore, please start with + and the country code, for example +60 12 345 6789.');
  }
  if (text.startsWith('0')) return fail('whatsapp', 'After the +, start with the country code (not 0).');
  if (text.length < 8 || text.length > 15) return fail('whatsapp', 'Please check your number — it should have 8 to 15 digits including the country code.');
  return pass('+' + text, { display: '+' + text, country: '' });
}

/** The wa.me link the admin panel uses to open a chat with a lead. */
export function waLink(e164) {
  const digits = String(e164 || '').replace(/\D/g, '');
  return digits ? 'https://wa.me/' + digits : '';
}

// ───────────────────────────── Unlock request ─────────────────────────────
/**
 * Validate everything a visitor sends to unlock one file.
 * Returns { ok:true, value:{ fileId, name, email, whatsapp, whatsappDisplay } }
 * or { ok:false, code, field, message } — `code` is the HttpsError code.
 */
export function validateUnlock(data, { now = Date.now() } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { ok: false, code: 'invalid-argument', field: '', message: 'Please fill in the form and try again.' };
  // Honeypot: a field no person can see. Anything in it is a script.
  if (typeof data.website === 'string' && data.website.trim())
    return { ok: false, code: 'invalid-argument', field: '', message: 'Please try again.' };
  const elapsed = Number(data.elapsedMs);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS)
    return { ok: false, code: 'invalid-argument', field: '', message: 'Please try again.' };
  const fileId = typeof data.fileId === 'string' ? data.fileId.trim() : '';
  if (!FILE_ID_RE.test(fileId))
    return { ok: false, code: 'invalid-argument', field: 'fileId', message: 'Please choose a file to download.' };

  const name = normaliseName(data.name);
  if (!name.ok) return { ok: false, code: 'invalid-argument', field: name.field, message: name.message };
  const email = normaliseEmail(data.email);
  if (!email.ok) return { ok: false, code: 'invalid-argument', field: email.field, message: email.message };
  const whatsapp = normaliseWhatsApp(data.whatsapp);
  if (!whatsapp.ok) return { ok: false, code: 'invalid-argument', field: whatsapp.field, message: whatsapp.message };

  // Consent must be an explicit true, against the text this server holds now.
  if (data.consent !== true)
    return { ok: false, code: 'invalid-argument', field: 'consent', message: 'Please tick the box to agree before downloading.' };
  if (data.consentVersion !== CONSENT_VERSION)
    return { ok: false, code: 'failed-precondition', field: 'consent', message: 'The consent wording has been updated. Please read it again and tick the box.' };

  return { ok: true, value: {
    fileId, name: name.value, email: email.value,
    whatsapp: whatsapp.value, whatsappDisplay: whatsapp.display,
    at: now
  } };
}

// ───────────────────────────── Files ─────────────────────────────
const UNSAFE_NAME_RE = /[\/\\:*?"<>|#%{}^~`\[\]]/g;

/** A file name that is safe as a Storage object name and as a download name. */
export function safeFileName(raw) {
  let name = cleanLine(raw).replace(UNSAFE_NAME_RE, '_').replace(/_{2,}/g, '_').replace(/^[.\s_]+/, '');
  if (!name) name = 'download';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).slice(0, 12) : '';
  let stem = dot > 0 ? name.slice(0, dot) : name;
  stem = clip(stem, FILE_NAME_MAX - ext.length).replace(/[.\s]+$/, '') || 'download';
  return stem + ext.toLowerCase();
}

export function fileExtension(fileName) {
  const name = String(fileName || '');
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase().slice(0, 10) : '';
}

/** Admin-entered title / description, cleaned and bounded. */
export function validateFileText(data, { requireTitle = true } = {}) {
  const out = {};
  if (data.title !== undefined || requireTitle) {
    const title = clip(cleanLine(data.title), TITLE_MAX);
    if (!title && requireTitle) return { ok: false, field: 'title', message: 'Please give the file a title.' };
    if (title) out.title = title;
  }
  if (data.description !== undefined) out.description = clip(cleanBlock(data.description), DESCRIPTION_MAX);
  if (data.published !== undefined) {
    if (typeof data.published !== 'boolean') return { ok: false, field: 'published', message: 'Downloadable must be on or off.' };
    out.published = data.published;
  }
  return { ok: true, value: out };
}

/** The object must live in this file's own folder: cs-files/{fileId}/{name}. */
export function storagePathFor(fileId, fileName) {
  return STORAGE_PREFIX + fileId + '/' + safeFileName(fileName);
}

export function storagePathOk(fileId, path) {
  if (typeof path !== 'string' || !FILE_ID_RE.test(fileId)) return false;
  const prefix = STORAGE_PREFIX + fileId + '/';
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return !!rest && !rest.includes('/') && !rest.startsWith('.') && !rest.includes('..') && rest.length <= FILE_NAME_MAX + 4;
}

// Types a browser could render as a page on the function's own origin. They
// are always served as plain bytes, so an uploaded .html or .svg can never run.
const ACTIVE_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript)/i;

export function servedContentType(contentType) {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (!type || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) || ACTIVE_TYPES.test(type)) return 'application/octet-stream';
  return type;
}

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 name. */
export function contentDisposition(fileName) {
  const name = safeFileName(fileName);
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '_').trim() || 'download';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encoded;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
  return (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
}

// ───────────────────────────── Page text ─────────────────────────────
export const DEFAULT_SETTINGS = Object.freeze({
  headline: 'Free learning resources',
  intro: 'Choose a resource below. Tell us where to send our updates, and your download unlocks straight away.',
  thankYou: 'Thank you! Your download has started. Browse the other resources below — they unlock with the same details.'
});

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ok: false, field: '', message: 'Nothing to save.' };
  const headline = clip(cleanLine(data.headline), HEADLINE_MAX);
  const intro = clip(cleanBlock(data.intro), INTRO_MAX);
  const thankYou = clip(cleanBlock(data.thankYou), THANKS_MAX);
  if (!headline) return { ok: false, field: 'headline', message: 'Please give the page a headline.' };
  return { ok: true, value: { headline, intro, thankYou } };
}

/** Settings as stored, with defaults standing in for anything missing. */
export function settingsWithDefaults(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    headline: typeof s.headline === 'string' && s.headline ? s.headline : DEFAULT_SETTINGS.headline,
    intro: typeof s.intro === 'string' ? s.intro : DEFAULT_SETTINGS.intro,
    thankYou: typeof s.thankYou === 'string' && s.thankYou ? s.thankYou : DEFAULT_SETTINGS.thankYou
  };
}

// ───────────────────────────── CSV ─────────────────────────────
/**
 * One CSV cell, quoted, with spreadsheet formula injection neutralised.
 * A phone number such as +6591234567 is left alone — it is a number, not a
 * formula, and an apostrophe in front of it would travel into whatever the
 * list is imported into next. Anything else opening with = + - @ is defused.
 */
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  const plainNumber = /^[+-]?[\d\s]+$/.test(text);
  if (!plainNumber && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function csvRow(cells) { return cells.map(csvCell).join(','); }
