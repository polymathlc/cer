// 🛟 Polymath daily backup — the pure parts (no Firebase, no network).
//
// tools/firebase-backup.mjs reads every Firestore collection of mathgen--app
// from GitHub Actions at about 12 AM Singapore time and emails two backups to
// BACKUP_RECIPIENTS from admin@polymathlc.com.sg:
//
//   1. "Office & bookings backup" — the business records (office families,
//      invoices, payments, schedule, bookings, shop orders, student access,
//      profiles, enquiries, registrations, sign-in accounts) as a zip of JSON
//      plus spreadsheet-friendly CSVs. Small, so it travels inside the email
//      itself and always arrives.
//   2. "Full data backup" — everything else worth keeping (learning history,
//      question banks, classroom games …) as one zip. It is too big for the
//      1 MiB limit of a Firestore `mail` document, so it is uploaded to Cloud
//      Storage for a few hours and the mailer attaches it from a signed link;
//      after delivery the copy in Storage is deleted.
//
// Everything here is plain functions so it can be tested with `node --test`
// (tools/firebase-backup-tests.mjs): the value encoding that makes the JSON
// restorable, a small zip writer and reader, the CSV maker, the rules that sort
// collections into the two emails, the packer that keeps each email under its
// size limit, and the email bodies.
//
// The repository is public and so are its Actions logs: nothing in this file
// ever logs data, only collection names, counts and sizes.
import { deflateRawSync, inflateRawSync } from 'node:zlib';

/* ─────────────────────────── 0. Settings ─────────────────────────── */
export const PROJECT_ID = 'mathgen--app';
export const STORAGE_BUCKET = 'mathgen--app.firebasestorage.app';
export const BACKUP_RECIPIENTS = Object.freeze(['admin@polymathlc.com.sg', 'chungzhikai@gmail.com']);
export const SENDER = 'Polymath Learning Centre <admin@polymathlc.com.sg>';
export const REPLY_TO = 'admin@polymathlc.com.sg';
// mail/polymath-backup-<kind>-<date>-<time> — never the protected
// polymath-enquiry-* ids, never the office's polymath-office-* ids.
export const MAIL_PREFIX = 'polymath-backup-';
export const STORAGE_PREFIX = 'backups/daily/';
export const SG_OFFSET_MS = 8 * 60 * 60 * 1000;

// A Firestore document is at most 1 MiB, and the inline email carries its
// attachments base64-encoded inside one. Keep well clear of the limit.
export const INLINE_BASE64_BUDGET = 880 * 1024;
// Gmail and Google Workspace accept 25 MB messages; base64 adds a third.
export const LINKED_ZIP_LIMIT = 17 * 1024 * 1024;
// When Storage is unavailable the full backup is split into inline parts.
export const FALLBACK_PART_LIMIT = 640 * 1024;
export const FALLBACK_MAX_PARTS = 6;
// The signed link only has to live until the mailer has fetched it.
export const SIGNED_URL_HOURS = 12;
// Leftover copies in Storage older than this are removed on the next run.
export const STORAGE_KEEP_HOURS = 48;

/* ───────────────────── 1. Which collection goes where ───────────────────── */
// The business records: email 1. Matched against the top-level collection id;
// subcollections follow their parent.
export const ESSENTIAL_COLLECTIONS = Object.freeze([
  'officeFamilies', 'officeInvoices', 'officePayments', 'officeStatements', 'officeSettings', 'officeLinks',
  'schedule_config', 'schedule_bookings',
  'shop_orders', 'shop_checkouts', 'shop_products', 'shop_settings',
  'studentAccess', 'students', 'studentProfiles', 'userProfiles', 'enUserProfiles', 'zhUserProfiles',
  'polymathEnquiryRequests', 'csLeads', 'csGrants',
  'onlineInvites', 'onlineCourses', 'onlineSettings',
  'adminSettings', 'app_settings', 'config', 'enConfig', 'zhConfig',
  'psleRoadRegistrations', 'psleRoadVideoConsents', 'psleRoadNotificationPrefs', 'psleRoadEvents', 'psleRoadCalendarUpdates',
  'prizeClaims', 'claims'
]);
export const ESSENTIAL_PATTERNS = Object.freeze([/registrations$/i, /^office/]);

// Never backed up, with the reason the email gives.
export const SKIP_RULES = Object.freeze([
  { test: id => id === 'mail', reason: 'the sent-email log (it also holds copies of these backups)' },
  { test: id => /loginEvents$/i.test(id), reason: 'sign-in logs' },
  { test: id => /limits$/i.test(id), reason: 'rate-limit counters, rebuilt automatically' },
  { test: id => id === 'worksheets', reason: 'the generated worksheet library (about 85 MB, far too large to email)' }
]);

export function rootId(path) { return String(path || '').split('/')[0]; }
export function skipReason(collectionId) {
  const rule = SKIP_RULES.find(r => r.test(String(collectionId || '')));
  return rule ? rule.reason : '';
}
export function isEssential(path) {
  const id = rootId(path);
  return ESSENTIAL_COLLECTIONS.includes(id) || ESSENTIAL_PATTERNS.some(p => p.test(id));
}
// Friendly names for the email's table; everything else shows its own id.
export const COLLECTION_LABELS = Object.freeze({
  officeFamilies: 'Office — families and students',
  officeInvoices: 'Office — invoices',
  officePayments: 'Office — payments',
  officeStatements: 'Office — bank statements',
  officeSettings: 'Office — settings',
  officeLinks: 'Office — parent pay links',
  schedule_config: 'Class schedule',
  schedule_bookings: 'Trial, enrolment and diagnostic bookings',
  shop_orders: 'Shop orders',
  shop_checkouts: 'Shop checkouts',
  shop_products: 'Shop products',
  shop_settings: 'Shop settings',
  studentAccess: 'Student access approvals',
  students: 'Students',
  studentProfiles: 'Student profiles',
  userProfiles: 'User profiles',
  polymathEnquiryRequests: 'Website enquiries',
  csLeads: 'Customer-service leads',
  onlineInvites: 'Polymath Online invitations',
  onlineCourses: 'Polymath Online courses',
  'auth/users': 'Sign-in accounts (Firebase Authentication)'
});
export function collectionLabel(path) {
  return COLLECTION_LABELS[path] || path;
}

/* ─────────────────── 2. Values that survive the round trip ─────────────────── */
// JSON has no timestamps, references, geo points or bytes, so those become
// small tagged objects that tools/firebase-restore.mjs turns back into the
// real Firestore types. A stored map that happens to have a "__type" key of its
// own is wrapped, so it can never be mistaken for a tag.
export const TYPE_KEY = '__type';

export function encodeValue(value, types) {
  const T = types || {};
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    return { [TYPE_KEY]: 'number', value: String(value) };
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return { [TYPE_KEY]: 'number', value: value.toString() };
  if (T.Timestamp && value instanceof T.Timestamp) {
    const seconds = Number(value.seconds), nanos = Number(value.nanoseconds) || 0;
    return { [TYPE_KEY]: 'timestamp', seconds, nanos, iso: isoFromSeconds(seconds, nanos) };
  }
  if (T.GeoPoint && value instanceof T.GeoPoint) {
    return { [TYPE_KEY]: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (T.DocumentReference && value instanceof T.DocumentReference) {
    return { [TYPE_KEY]: 'ref', path: value.path };
  }
  if (value instanceof Uint8Array) {
    return { [TYPE_KEY]: 'bytes', base64: Buffer.from(value).toString('base64') };
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return { [TYPE_KEY]: 'timestamp', seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1e6, iso: value.toISOString() };
  }
  if (Array.isArray(value)) return value.map(v => encodeValue(v, T));
  if (typeof value === 'object') {
    // Duck-typed timestamps (e.g. a Timestamp from another copy of the SDK).
    if (typeof value.toDate === 'function' && typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') {
      return { [TYPE_KEY]: 'timestamp', seconds: value.seconds, nanos: value.nanoseconds, iso: isoFromSeconds(value.seconds, value.nanoseconds) };
    }
    const out = {};
    for (const key of Object.keys(value)) out[key] = encodeValue(value[key], T);
    if (Object.prototype.hasOwnProperty.call(value, TYPE_KEY)) return { [TYPE_KEY]: 'map', value: out };
    return out;
  }
  return String(value);
}

function isoFromSeconds(seconds, nanos) {
  const ms = seconds * 1000 + Math.floor((nanos || 0) / 1e6);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

// The reverse. `make` builds the real types: { timestamp(seconds, nanos),
// geopoint(lat, lng), ref(path), bytes(buffer) }. Anything it leaves out stays
// as a plain value (an ISO string for times, the path for references).
export function decodeValue(value, make) {
  const M = make || {};
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(v => decodeValue(v, M));
  if (typeof value !== 'object') return value;
  const tag = value[TYPE_KEY];
  if (tag === 'timestamp') return M.timestamp ? M.timestamp(Number(value.seconds), Number(value.nanos) || 0) : value.iso;
  if (tag === 'geopoint') return M.geopoint ? M.geopoint(Number(value.latitude), Number(value.longitude)) : { latitude: value.latitude, longitude: value.longitude };
  if (tag === 'ref') return M.ref ? M.ref(String(value.path)) : String(value.path);
  if (tag === 'bytes') { const buf = Buffer.from(String(value.base64 || ''), 'base64'); return M.bytes ? M.bytes(buf) : buf; }
  if (tag === 'number') return Number(value.value);
  if (tag === 'map') {
    const out = {};
    const inner = value.value || {};
    for (const key of Object.keys(inner)) out[key] = decodeValue(inner[key], M);
    return out;
  }
  const out = {};
  for (const key of Object.keys(value)) out[key] = decodeValue(value[key], M);
  return out;
}

/* ─────────────────────────── 3. Collection files ─────────────────────────── */
// One JSON file per collection path, so a person can open just the one they
// need and the restore can put each back where it came from.
export function collectionFileName(path) {
  return 'firestore/' + String(path).split('/').map(safeSegment).join('/') + '.json';
}
function safeSegment(s) {
  // Firestore ids may hold characters a file system dislikes; keep it readable.
  const cleaned = String(s).replace(/[\\:*?"<>|\u0000-\u001f]/g, '_');
  return cleaned === '.' || cleaned === '..' ? '_' + cleaned : cleaned;
}
export function collectionFile(path, documents, exportedAt) {
  return {
    format: 'polymath-firestore-backup/1',
    project: PROJECT_ID,
    collection: path,
    exportedAt,
    count: documents.length,
    documents
  };
}
export function collectionJson(path, documents, exportedAt) {
  return JSON.stringify(collectionFile(path, documents, exportedAt), null, 1);
}

/* ─────────────────────────── 4. CSV for people ─────────────────────────── */
export function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(rows) {
  // A byte-order mark so Excel opens names in Chinese and other scripts properly.
  return '﻿' + (rows || []).map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
// Any collection as a table: one row per document, one column per top-level
// field (maps and lists as compact JSON, times as Singapore date-time).
export function documentsCsv(documents) {
  const docs = documents || [];
  const columns = [];
  for (const d of docs) for (const k of Object.keys(d.data || {})) if (!columns.includes(k)) columns.push(k);
  const rows = [['id', ...columns]];
  for (const d of docs) rows.push([d.id, ...columns.map(k => cellText((d.data || {})[k]))]);
  return toCsv(rows);
}
export function cellText(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  if (v[TYPE_KEY] === 'timestamp') return sgDateTime(v.seconds * 1000);
  if (v[TYPE_KEY] === 'ref') return v.path;
  if (v[TYPE_KEY] === 'geopoint') return v.latitude + ',' + v.longitude;
  if (v[TYPE_KEY] === 'bytes') return '(binary, ' + Math.round(String(v.base64 || '').length * 0.75) + ' bytes)';
  if (v[TYPE_KEY] === 'number') return v.value;
  const s = JSON.stringify(v);
  return s.length > 30000 ? s.slice(0, 30000) + '…' : s;
}

/* ─────────────────────────── 5. Dates (Singapore) ─────────────────────────── */
export function sgDateKey(nowMs) {
  return new Date(Number(nowMs) + SG_OFFSET_MS).toISOString().slice(0, 10);
}
export function sgDateTime(ms) {
  const d = new Date(Number(ms) + SG_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettySgDate(nowMs) {
  const d = new Date(Number(nowMs) + SG_OFFSET_MS);
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
export function prettySgTime(nowMs) {
  const d = new Date(Number(nowMs) + SG_OFFSET_MS);
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + m + ' ' + ampm;
}
export function prettyBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(v < 10 * 1024 ? 1 : 0) + ' KB';
  return (v / 1024 / 1024).toFixed(1) + ' MB';
}

/* ─────────────────────────── 6. A small zip writer ─────────────────────────── */
// Plain zip (deflate, UTF-8 names, no zip64) — opens on Windows, macOS, iOS and
// Android without extra apps. Entries are compressed once by prepareEntry so the
// packer can weigh them before deciding which zip they go in.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function prepareEntry(name, content, meta) {
  const raw = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  const deflated = deflateRawSync(raw, { level: 9 });
  const stored = deflated.length >= raw.length;
  return {
    name: String(name).replace(/^\/+/, ''),
    size: raw.length,
    crc: crc32(raw),
    method: stored ? 0 : 8,
    data: stored ? raw : deflated,
    meta: meta || {}
  };
}
export function entryZipBytes(e) {
  const nameLen = Buffer.byteLength(e.name, 'utf8');
  return 30 + nameLen + e.data.length + 46 + nameLen;
}
export function zipSizeOf(entries) {
  return (entries || []).reduce((a, e) => a + entryZipBytes(e), 22);
}

function dosDateTime(ms) {
  const d = new Date(Number(ms) + SG_OFFSET_MS); // local Singapore time, as people read it
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

export function writeZip(entries, nowMs) {
  const { time, date } = dosDateTime(nowMs == null ? Date.now() : nowMs);
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(e.method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, e.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by Unix, v3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(e.method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  const centralSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

// The reader the restore uses (and the tests). Handles the zips written above
// and ordinary deflate/stored zips from other tools.
export function readZip(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record).');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged zip central directory.');
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const compSize = b.readUInt32LE(p + 20);
    const size = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32);
    const localOffset = b.readUInt32LE(p + 42);
    const name = b.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = b.readUInt16LE(localOffset + 26), lExtraLen = b.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = b.slice(start, start + compSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error('Unsupported zip compression method ' + method + ' for ' + name);
    if (data.length !== size || crc32(data) !== crc) throw new Error('Checksum mismatch in ' + name);
    files.push({ name, data });
  }
  return files;
}

/* ─────────────────────────── 7. Packing the emails ─────────────────────────── */
// Takes every exported collection (each already turned into a prepared zip
// entry with meta { path, count, essential }) and decides what goes where.
//
//   inline   — email 1's zip; must fit the inline budget together with the
//              direct CSV attachments. If it would not, the largest business
//              collections move to the full backup until it does.
//   linked   — email 2's zip, sent from Storage; limited to LINKED_ZIP_LIMIT,
//              dropping the largest collections (listed as left out) to fit.
//
// Returns { inline, linked, leftOut, movedToFull } with entry lists.
export function base64Length(bytes) { return Math.ceil(Number(bytes) / 3) * 4; }

export function planEmails(collectionEntries, options) {
  const o = Object.assign({ inlineBudget: INLINE_BASE64_BUDGET, linkedLimit: LINKED_ZIP_LIMIT, extraInline: [], extraInlineBase64: 0 }, options || {});
  const essential = collectionEntries.filter(e => e.meta.essential);
  const rest = collectionEntries.filter(e => !e.meta.essential);
  const inline = essential.slice();
  const movedToFull = [];
  const inlineCost = () => base64Length(zipSizeOf([...inline, ...o.extraInline])) + o.extraInlineBase64;
  while (inline.length && inlineCost() > o.inlineBudget) {
    // Move the biggest one out; it still travels in the full backup.
    inline.sort((a, b) => b.data.length - a.data.length);
    movedToFull.push(inline.shift());
  }
  inline.sort((a, b) => a.name.localeCompare(b.name));
  const linked = [...rest, ...movedToFull].sort((a, b) => a.name.localeCompare(b.name));
  const leftOut = [];
  while (linked.length && zipSizeOf(linked) > o.linkedLimit) {
    let biggest = 0;
    for (let i = 1; i < linked.length; i++) if (linked[i].data.length > linked[biggest].data.length) biggest = i;
    leftOut.push(linked.splice(biggest, 1)[0]);
  }
  return { inline, linked, leftOut, movedToFull };
}

// When Storage cannot be used: split the full backup into inline parts, small
// collections first so the most collections arrive; whatever does not fit in
// FALLBACK_MAX_PARTS parts is listed as left out.
export function packInlineParts(entries, options) {
  const o = Object.assign({ partLimit: FALLBACK_PART_LIMIT, maxParts: FALLBACK_MAX_PARTS }, options || {});
  const sorted = entries.slice().sort((a, b) => a.data.length - b.data.length || a.name.localeCompare(b.name));
  const parts = [];
  const leftOut = [];
  for (const e of sorted) {
    if (zipSizeOf([e]) > o.partLimit) { leftOut.push(e); continue; }
    let part = parts.find(p => zipSizeOf([...p, e]) <= o.partLimit);
    if (!part) {
      if (parts.length >= o.maxParts) { leftOut.push(e); continue; }
      part = [];
      parts.push(part);
    }
    part.push(e);
  }
  parts.forEach(p => p.sort((a, b) => a.name.localeCompare(b.name)));
  return { parts, leftOut };
}

/* ─────────────────────────── 8. The README inside every zip ─────────────────────────── */
export function readmeText({ nowMs, kind, totals }) {
  const t = totals || {};
  return [
    'Polymath Learning Centre — ' + (kind === 'full' ? 'full data backup' : 'office & bookings backup'),
    'Taken ' + prettySgDate(nowMs) + ' at ' + prettySgTime(nowMs) + ' Singapore time from Firebase project ' + PROJECT_ID + '.',
    '',
    'WHAT IS IN HERE',
    '  firestore/<collection>.json   one file per Firestore collection (subcollections in folders)',
    kind === 'full' ? '' : '  csv/<collection>.csv          the same records as spreadsheets (open in Excel or Google Sheets)',
    kind === 'full' ? '' : '  csv/family-records.csv        the office Families table, one row per child',
    kind === 'full' ? '' : '  auth/users.json               sign-in accounts (no passwords)',
    '  backup-manifest.json          every collection with its document count',
    '',
    'Each JSON file holds { collection, count, documents: [ { id, data } ] }. Dates are',
    'objects like {"__type":"timestamp","iso":"2026-11-14T16:00:00.000Z"}; the "iso" value',
    'is the time in UTC (add 8 hours for Singapore).',
    '',
    'HOW TO RESTORE INTO FIREBASE',
    '  1. Get the polymathlc/cer code (tools/firebase-restore.mjs) and Node.js 22.',
    '  2. Download a service-account key for the Firebase project to restore into',
    '     (Firebase console > Project settings > Service accounts > Generate new private key).',
    '  3. npm install firebase-admin@12',
    '  4. Check first (writes nothing):',
    '       GOOGLE_APPLICATION_CREDENTIALS=key.json node tools/firebase-restore.mjs --project <project-id> <this-zip>',
    '  5. Then write it:',
    '       GOOGLE_APPLICATION_CREDENTIALS=key.json node tools/firebase-restore.mjs --project <project-id> --apply <this-zip>',
    '     Add --only officeFamilies,officeInvoices to restore just some collections, and',
    '     --auth to recreate the sign-in accounts too. Restore both zips of the same day',
    '     for a complete copy.',
    '',
    t.documents != null ? 'This zip: ' + t.collections + ' collections, ' + t.documents + ' documents.' : '',
    'Keep this file private: it holds parents\' and children\'s personal details.'
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\r\n') + '\r\n';
}

export function manifest(entries, nowMs, extra) {
  return JSON.stringify(Object.assign({
    format: 'polymath-firestore-backup/1',
    project: PROJECT_ID,
    takenAt: new Date(Number(nowMs)).toISOString(),
    collections: entries.map(e => ({ path: e.meta.path, file: e.name, documents: e.meta.count, bytes: e.size }))
  }, extra || {}), null, 1);
}

/* ─────────────────────────── 9. The emails ─────────────────────────── */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function table(rows) {
  const tr = rows.map(([a, b, c]) =>
    '<tr><td style="padding:4px 10px 4px 0;border-bottom:1px solid #eee">' + esc(a) + '</td>' +
    '<td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">' + esc(b) + '</td>' +
    '<td style="padding:4px 0 4px 10px;border-bottom:1px solid #eee;color:#666;white-space:nowrap">' + esc(c) + '</td></tr>').join('');
  return '<table style="border-collapse:collapse;font-size:14px;margin:8px 0 16px">' + tr + '</table>';
}
function frame(title, inner) {
  return '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:640px;line-height:1.5">' +
    '<h2 style="font-size:20px;margin:0 0 12px">' + esc(title) + '</h2>' + inner +
    '<p style="color:#888;font-size:12px;margin-top:24px">Sent automatically every night at about 12 AM by the Polymath daily backup ' +
    '(polymathlc/cer, .github/workflows/firebase-backup.yml). It holds parents\' and children\'s personal details: please do not forward it.</p></div>';
}
function rowsFor(entries) {
  return entries.map(e => [collectionLabel(e.meta.path), e.meta.count + (e.meta.count === 1 ? ' record' : ' records'), prettyBytes(e.size)]);
}
function leftOutList(leftOut, skipped) {
  const items = [
    ...skipped.map(s => '<li>' + esc(s.path) + ' — ' + esc(s.reason) + '</li>'),
    ...leftOut.map(e => '<li>' + esc(e.meta.path) + ' — ' + prettyBytes(e.size) + ', too large for today\'s email</li>')
  ];
  return items.length ? '<p style="margin:16px 0 4px"><b>Not included</b></p><ul style="margin:0 0 12px;padding-left:20px;font-size:14px">' + items.join('') + '</ul>' : '';
}

export function inlineEmail({ nowMs, entries, attachments, otherEmail, problems }) {
  const date = prettySgDate(nowMs);
  const records = entries.reduce((a, e) => a + (e.meta.count || 0), 0);
  const subject = '🛟 Polymath backup ' + sgDateKey(nowMs) + ' — office & bookings (' + records + ' records)';
  const intro = '<p>Tonight\'s backup of the office and booking records, taken ' + esc(date) + ' at ' + esc(prettySgTime(nowMs)) +
    ' Singapore time. Save the attached zip somewhere safe; it can rebuild these collections in a new Firebase project ' +
    '(instructions in README.txt inside it). The CSV files open in Excel or Google Sheets.</p>';
  const other = otherEmail ? '<p>' + esc(otherEmail) + '</p>' : '';
  const issues = (problems || []).length ? '<p style="color:#b45309"><b>Heads-up:</b> ' + problems.map(esc).join(' ') + '</p>' : '';
  const att = '<p style="margin:16px 0 4px"><b>Attached</b></p><ul style="margin:0 0 12px;padding-left:20px;font-size:14px">' +
    attachments.map(a => '<li>' + esc(a.filename) + '</li>').join('') + '</ul>';
  const html = frame('Daily backup — ' + date, intro + issues + table(rowsFor(entries)) + att + other);
  const text = 'Daily backup — ' + date + '\n\n' + entries.map(e => collectionLabel(e.meta.path) + ': ' + e.meta.count).join('\n') +
    '\n\n' + (otherEmail || '') + '\n\nThis email holds parents\' and children\'s personal details: please do not forward it.';
  return { subject, html, text };
}

export function fullEmail({ nowMs, entries, leftOut, skipped, partIndex, partCount, zipBytes, linked }) {
  const date = prettySgDate(nowMs);
  const records = entries.reduce((a, e) => a + (e.meta.count || 0), 0);
  const part = partCount > 1 ? ' — part ' + (partIndex + 1) + ' of ' + partCount : '';
  const subject = '🛟 Polymath backup ' + sgDateKey(nowMs) + ' — full data' + part + ' (' + records + ' records)';
  const intro = '<p>Tonight\'s full backup of the Polymath Firebase data' + esc(part) + ', taken ' + esc(date) + ' at ' + esc(prettySgTime(nowMs)) +
    ' Singapore time: the student learning history, question banks, classroom games and everything else not in the office & bookings email. ' +
    'The zip (' + prettyBytes(zipBytes) + ') can rebuild them in a new Firebase project; see README.txt inside.</p>' +
    (linked ? '' : '<p style="color:#b45309">Sent in parts tonight because the large-file route was unavailable.</p>');
  const shown = entries.slice().sort((a, b) => b.size - a.size);
  const top = shown.slice(0, 40);
  const more = shown.length > top.length ? '<p style="font-size:13px;color:#666">… and ' + (shown.length - top.length) + ' smaller collections (all listed in backup-manifest.json).</p>' : '';
  const html = frame('Full data backup — ' + date + part, intro + table(rowsFor(top)) + more + (partIndex ? '' : leftOutList(leftOut || [], skipped || [])));
  const text = 'Full data backup — ' + date + part + '\n\n' + shown.map(e => e.meta.path + ': ' + e.meta.count).join('\n');
  return { subject, html, text };
}

export function mailDoc({ to, message, attachments, meta }) {
  return {
    to: (to || BACKUP_RECIPIENTS).slice(),
    from: SENDER,
    replyTo: REPLY_TO,
    message: Object.assign({}, message, { attachments: attachments || [] }),
    polymathBackup: Object.assign({ sender: REPLY_TO }, meta || {})
  };
}
export function mailDocId(kind, dateKey, nowMs) {
  return MAIL_PREFIX + String(kind).replace(/[^a-z0-9-]/gi, '-') + '-' + dateKey + '-' + Number(nowMs);
}
export function base64Attachment(filename, buf, contentType) {
  return { filename, content: Buffer.from(buf).toString('base64'), encoding: 'base64', contentType: contentType || 'application/zip' };
}
export function attachmentsBase64Size(list) {
  return (list || []).reduce((a, x) => a + (x.content ? String(x.content).length : 0), 0);
}

/* ─────────────────────────── 10. Small helpers ─────────────────────────── */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
// What the step summary and logs may say: names, counts, sizes. Never data.
export function summaryLines(plan, extra) {
  const e = extra || {};
  const lines = [];
  lines.push('Office & bookings email: ' + plan.inline.length + ' collections, ' + plan.inline.reduce((a, x) => a + x.meta.count, 0) + ' documents.');
  lines.push('Full data email: ' + plan.linked.length + ' collections, ' + plan.linked.reduce((a, x) => a + x.meta.count, 0) + ' documents, zip ' + prettyBytes(zipSizeOf(plan.linked)) + '.');
  if (plan.movedToFull.length) lines.push('Moved to the full email to keep the first one small: ' + plan.movedToFull.map(x => x.meta.path).join(', '));
  if (plan.leftOut.length) lines.push('Left out (too large): ' + plan.leftOut.map(x => x.meta.path + ' ' + prettyBytes(x.size)).join(', '));
  if (e.skipped && e.skipped.length) lines.push('Skipped on purpose: ' + e.skipped.map(s => s.path).join(', '));
  return lines;
}
