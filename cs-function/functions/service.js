// The polymathlc.com.sg/cs download gate: what the three callables and the
// download endpoint actually do. Firestore and Storage are INJECTED, so the
// whole flow runs in test/service.test.js against in-memory fakes and no test
// can ever touch the real project.
//
// Everything here runs as the Admin SDK, which bypasses the shared Firestore
// rules. That is the point: csFiles, csLeads, csLimits, csGrants and
// csSettings are SERVER-ONLY collections (tools/cs-rules.mjs locks the
// browser out of all five), so a visitor's contact details are never readable
// by another visitor and a file's storage path never reaches the public page.
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import {
  CONSENT_CHANNELS, CONSENT_TEXT, CONSENT_VERSION, FILE_ID_RE, GRANT_KEY_RE, LEAD_ID_RE, MAX_FILE_BYTES,
  STORAGE_PREFIX, clip, cleanLine, contentDisposition, fileExtension, leadIdFor, safeFileName,
  servedContentType, settingsWithDefaults, sha256Hex, storagePathOk, validateFileText, validateSettings,
  validateUnlock
} from './validate.js';

export const COLLECTIONS = Object.freeze({
  files: 'csFiles', leads: 'csLeads', limits: 'csLimits', grants: 'csGrants', settings: 'csSettings'
});
export const UNLOCKS_SUB = 'unlocks';
export const ADMIN_EMAILS = Object.freeze(['chungzhikai@gmail.com']);
export const DOWNLOAD_URL = 'https://us-central1-mathgen--app.cloudfunctions.net/csDownload';
export const PAGE_URL = 'https://polymathlc.com.sg/cs/';

// ── The booklet mock-up. A few pages of an uploaded PDF are rendered to JPEG
//    in the ADMIN's browser and stored here, PUBLICLY readable through a
//    download-token URL, because their whole job is to show a parent what the
//    cheat sheet is before they hand over their details. They live in their
//    own folder, never beside the file itself, so the file stays gated.
export const PREVIEW_PREFIX = 'cs-previews/';
export const PREVIEW_MAX_PAGES = 8;
export const PREVIEW_MAX_BYTES = 450 * 1024;
export const PREVIEW_MAX_SIDE = 1600;

// One fixed window per hour. Bounded so a bot cannot use the form as a free
// way to fill the centre's lead list, and so one leaked link cannot be turned
// into a public mirror of a file.
export const LIMITS = Object.freeze({
  unlockPerIpHour: 30,
  unlockPerEmailHour: 20,
  unlockGlobalHour: 2000,
  grantUses: 6,
  grantTtlMs: 24 * 60 * 60 * 1000,
  adminGrantUses: 5,
  adminGrantTtlMs: 60 * 60 * 1000,
  cleanupBatch: 200,
  leadsPage: 500,
  leadsMax: 10000,
  historyMax: 100,
  fileIdsKept: 200,
  filesMax: 200,
  chunkMaxBytes: 3 * 1024 * 1024,
  composeMax: 32
});
const HOUR_MS = 60 * 60 * 1000;

export class ServiceError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
const err = (code, message, details) => new ServiceError(code, message, details);

/** Admin = a VERIFIED Google email on the list. The page's own check is not a lock. */
export function isAdminToken(auth) {
  const token = auth && auth.token;
  if (!token || token.email_verified !== true || typeof token.email !== 'string') return false;
  return ADMIN_EMAILS.includes(token.email.toLowerCase());
}

/** The visitor's address as Google's front end reports it; first hop only. */
export function clientIp(rawRequest) {
  const headers = (rawRequest && rawRequest.headers) || {};
  const forwarded = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || (rawRequest && rawRequest.ip) || '';
  return clip(String(ip).replace(/^::ffff:/, ''), 64) || 'unknown';
}

function uniqueTail(list, max) {
  const seen = new Set(), out = [];
  for (let i = list.length - 1; i >= 0 && out.length < max; i--) {
    const item = list[i];
    if (item === undefined || item === null || item === '' || seen.has(item)) continue;
    seen.add(item); out.unshift(item);
  }
  return out;
}

/** Only well-formed preview entries in this file's own preview folder survive. */
export function cleanPreviews(list, fileId, bucketName) {
  if (!Array.isArray(list)) return [];
  const prefix = 'https://firebasestorage.googleapis.com/v0/b/' + bucketName + '/o/' +
    encodeURIComponent(PREVIEW_PREFIX + fileId + '/');
  return list.filter(p => p && typeof p.url === 'string' && p.url.startsWith(prefix))
    .slice(0, PREVIEW_MAX_PAGES)
    .map(p => ({
      url: p.url,
      w: Math.max(1, Math.min(PREVIEW_MAX_SIDE, Math.round(Number(p.w) || 0))) || 1,
      h: Math.max(1, Math.min(PREVIEW_MAX_SIDE * 2, Math.round(Number(p.h) || 0))) || 1,
      page: Math.max(1, Math.round(Number(p.page) || 1))
    }));
}

function fileForPublic(id, d, bucketName) {
  return {
    id,
    title: d.title || 'Untitled',
    description: d.description || '',
    fileName: d.fileName || 'download',
    ext: fileExtension(d.fileName),
    size: Number(d.size) || 0,
    contentType: d.contentType || '',
    updatedAt: Number(d.updatedAt) || 0,
    pageCount: Math.max(0, Math.round(Number(d.pageCount) || 0)),
    previews: cleanPreviews(d.previews, id, bucketName),
    featured: d.featured === true
  };
}

function fileForAdmin(id, d, bucketName) {
  return {
    ...fileForPublic(id, d, bucketName),
    previewPages: Array.isArray(d.previewPages) ? d.previewPages.slice(0, PREVIEW_MAX_PAGES) : [],
    published: d.published === true,
    order: Number(d.order) || 0,
    storagePath: d.storagePath || '',
    createdAt: Number(d.createdAt) || 0,
    unlocks: Number(d.unlocks) || 0,
    downloads: Number(d.downloads) || 0,
    lastUnlockAt: Number(d.lastUnlockAt) || 0
  };
}

function sortFiles(list) {
  return list.sort((a, b) => (a.order - b.order) || (b.createdAt - a.createdAt) || a.id.localeCompare(b.id));
}

function leadForAdmin(id, d) {
  const consent = d.consent || {};
  return {
    id,
    name: d.name || '',
    email: d.email || '',
    whatsapp: d.whatsapp || '',
    whatsappDisplay: d.whatsappDisplay || d.whatsapp || '',
    consentActive: d.consentActive === true,
    consentVersion: consent.version || '',
    consentAt: Number(consent.at) || 0,
    consentLastAffirmedAt: Number(consent.lastAffirmedAt) || Number(consent.at) || 0,
    withdrawnAt: Number(consent.withdrawnAt) || 0,
    withdrawnBy: consent.withdrawnBy || '',
    firstAt: Number(d.firstAt) || 0,
    lastAt: Number(d.lastAt) || 0,
    unlockCount: Number(d.unlockCount) || 0,
    fileIds: Array.isArray(d.fileIds) ? d.fileIds.slice(-LIMITS.fileIdsKept) : [],
    lastFileTitle: d.lastFileTitle || '',
    nameHistory: Array.isArray(d.nameHistory) ? d.nameHistory : [],
    whatsappHistory: Array.isArray(d.whatsappHistory) ? d.whatsappHistory : [],
    emailHistory: Array.isArray(d.emailHistory) ? d.emailHistory : []
  };
}

/**
 * Build the service. Every dependency can be replaced in a test.
 *   db      a Firestore (Admin SDK) — or the fake in test/fakes.js
 *   bucket  a Storage bucket (Admin SDK) — or the fake
 *   now     () => ms
 *   random  (n) => Buffer of n random bytes
 */
export function createService({ db, bucket, now = () => Date.now(), random = nodeRandomBytes,
  downloadUrl = DOWNLOAD_URL, log = () => {} } = {}) {
  if (!db || !bucket) throw new Error('createService needs a db and a bucket.');
  const col = name => db.collection(COLLECTIONS[name]);
  const bucketName = bucket.name || 'mathgen--app.firebasestorage.app';
  const pub = (id, d) => fileForPublic(id, d, bucketName);
  const adm = (id, d) => fileForAdmin(id, d, bucketName);
  const fileRef = id => col('files').doc(id);
  const leadRef = id => col('leads').doc(id);
  const settingsRef = () => col('settings').doc('main');

  function newKey() { return random(32).toString('base64url'); }
  function newId(prefix = '') { return prefix + random(15).toString('base64url'); }
  function quotaRef(kind, value, hour) {
    return col('limits').doc(kind + '-' + sha256Hex('polymath-cs-quota|' + kind + '|' + value).slice(0, 32) + '-' + hour);
  }

  // ───────────────────────── Public: the list ─────────────────────────
  async function listFiles() {
    const [settingsSnap, filesSnap] = await Promise.all([
      settingsRef().get(),
      col('files').where('published', '==', true).limit(LIMITS.filesMax).get()
    ]);
    // Sorted by the admin's order; only the public half of each file leaves.
    const sorted = sortFiles(filesSnap.docs.map(doc => ({ ...adm(doc.id, doc.data()), _raw: doc.data() })));
    const files = sorted.map(f => pub(f.id, f._raw));
    // The booklet in the middle of the page shows the file the admin chose,
    // or else the first one that has pages to show.
    const featured = files.find(f => f.featured && f.previews.length)
      || files.find(f => f.previews.length) || files[0] || null;
    return {
      settings: settingsWithDefaults(settingsSnap.exists ? settingsSnap.data() : null),
      consent: { version: CONSENT_VERSION, text: CONSENT_TEXT, channels: CONSENT_CHANNELS.slice() },
      featuredId: featured ? featured.id : '',
      files
    };
  }

  // ───────────────────────── Public: unlock ─────────────────────────
  async function unlock(data, { ip = 'unknown', userAgent = '' } = {}) {
    const at = now();
    const checked = validateUnlock(data, { now: at });
    if (!checked.ok) {
      const details = { field: checked.field || '' };
      if (checked.code === 'failed-precondition') details.consent = { version: CONSENT_VERSION, text: CONSENT_TEXT };
      throw err(checked.code, checked.message, details);
    }
    const v = checked.value;
    const hour = Math.floor(at / HOUR_MS);
    const expiresAt = (hour + 2) * HOUR_MS;
    const leadId = leadIdFor(v.email);
    const ipHash = sha256Hex('polymath-cs-ip|' + ip).slice(0, 16);
    const refs = {
      file: fileRef(v.fileId),
      lead: leadRef(leadId),
      ipQuota: quotaRef('ip', ip, hour),
      emailQuota: quotaRef('email', v.email, hour),
      globalQuota: quotaRef('global', 'all', hour)
    };
    const key = newKey();
    const grantRef = col('grants').doc(sha256Hex(key));
    const eventRef = refs.lead.collection(UNLOCKS_SUB).doc(newId('U'));

    const result = await db.runTransaction(async tx => {
      const [fileSnap, leadSnap, ipSnap, emailSnap, globalSnap] =
        await tx.getAll(refs.file, refs.lead, refs.ipQuota, refs.emailQuota, refs.globalQuota);
      if (!fileSnap.exists || fileSnap.data().published !== true)
        throw err('not-found', 'That file is no longer available. Please refresh the page and choose another.', { field: 'fileId' });
      const file = fileSnap.data();
      if (!storagePathOk(v.fileId, file.storagePath))
        throw err('not-found', 'That file is not ready yet. Please try again later.', { field: 'fileId' });
      const counts = [ipSnap, emailSnap, globalSnap].map(s => (s.exists ? Number(s.data().count) || 0 : 0));
      if (counts[0] >= LIMITS.unlockPerIpHour || counts[1] >= LIMITS.unlockPerEmailHour || counts[2] >= LIMITS.unlockGlobalHour)
        throw err('resource-exhausted', 'Too many downloads in a short time. Please wait a while and try again.');

      const prev = leadSnap.exists ? leadSnap.data() : null;
      const prevConsent = (prev && prev.consent) || {};
      const sameConsent = prev && prev.consentActive === true && prevConsent.version === CONSENT_VERSION;
      const consentHistory = Array.isArray(prev && prev.consentHistory) ? prev.consentHistory.slice() : [];
      if (!sameConsent) consentHistory.push({ action: prev ? (prev.consentActive ? 'updated' : 'regranted') : 'granted',
        version: CONSENT_VERSION, at, by: 'visitor', fileId: v.fileId });
      const lead = {
        name: v.name,
        email: v.email,
        whatsapp: v.whatsapp,
        whatsappDisplay: v.whatsappDisplay,
        consentActive: true,
        consent: {
          granted: true,
          version: CONSENT_VERSION,
          text: CONSENT_TEXT,
          channels: CONSENT_CHANNELS.slice(),
          at: sameConsent ? (Number(prevConsent.at) || at) : at,
          lastAffirmedAt: at,
          withdrawnAt: 0,
          withdrawnBy: ''
        },
        consentHistory: consentHistory.slice(-20),
        firstAt: prev ? (Number(prev.firstAt) || at) : at,
        lastAt: at,
        unlockCount: (prev ? Number(prev.unlockCount) || 0 : 0) + 1,
        fileIds: uniqueTail([...(prev && Array.isArray(prev.fileIds) ? prev.fileIds : []), v.fileId], LIMITS.fileIdsKept),
        lastFileId: v.fileId,
        lastFileTitle: clip(file.title || '', 120),
        nameHistory: uniqueTail([...(prev && Array.isArray(prev.nameHistory) ? prev.nameHistory : []), v.name], 5),
        whatsappHistory: uniqueTail([...(prev && Array.isArray(prev.whatsappHistory) ? prev.whatsappHistory : []), v.whatsapp], 5),
        emailHistory: uniqueTail([...(prev && Array.isArray(prev.emailHistory) ? prev.emailHistory : []), v.email], 3),
        source: 'cs',
        userAgent: clip(cleanLine(userAgent), 160)
      };
      tx.set(refs.lead, lead);
      tx.set(eventRef, { fileId: v.fileId, fileTitle: clip(file.title || '', 120), at, name: v.name,
        whatsapp: v.whatsapp, consentVersion: CONSENT_VERSION, ipHash, userAgent: lead.userAgent });
      tx.set(refs.file, { ...file, unlocks: (Number(file.unlocks) || 0) + 1, lastUnlockAt: at });
      tx.set(refs.ipQuota, { kind: 'ip', count: counts[0] + 1, expiresAt });
      tx.set(refs.emailQuota, { kind: 'email', count: counts[1] + 1, expiresAt });
      tx.set(refs.globalQuota, { kind: 'global', count: counts[2] + 1, expiresAt });
      const grant = {
        fileId: v.fileId, leadId, storagePath: file.storagePath, fileName: file.fileName || 'download',
        contentType: file.contentType || '', size: Number(file.size) || 0,
        createdAt: at, expiresAt: at + LIMITS.grantTtlMs, uses: 0, maxUses: LIMITS.grantUses, admin: false
      };
      tx.set(grantRef, grant);
      return { file, grant, returning: !!prev };
    });

    log('unlock', { fileId: v.fileId, returning: result.returning });
    // Now and then, sweep expired counters and links, so the collections stay small.
    if (random(1)[0] < 6) cleanup().catch(() => {});
    return {
      downloadUrl: downloadUrl + '?k=' + key,
      expiresAt: result.grant.expiresAt,
      maxUses: result.grant.maxUses,
      fileId: v.fileId,
      fileName: result.grant.fileName,
      title: result.file.title || '',
      size: result.grant.size,
      returning: result.returning,
      visitor: { name: v.name, email: v.email, whatsapp: v.whatsapp, whatsappDisplay: v.whatsappDisplay }
    };
  }

  // ───────────────────────── Public: the download itself ─────────────────────────
  /**
   * Spend one use of a link and say what to stream. Throws a ServiceError
   * with an HTTP status on `details.status` when the link cannot be used.
   * A HEAD request is answered without spending a use.
   */
  async function openDownload(key, { method = 'GET' } = {}) {
    if (typeof key !== 'string' || !GRANT_KEY_RE.test(key))
      throw err('not-found', 'This download link is not valid.', { status: 404 });
    const ref = col('grants').doc(sha256Hex(key));
    const at = now();
    const counting = method !== 'HEAD';
    const grant = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw err('not-found', 'This download link is not valid.', { status: 404 });
      const g = snap.data();
      if (Number(g.expiresAt) <= at) throw err('deadline-exceeded', 'This download link has expired.', { status: 410 });
      if ((Number(g.uses) || 0) >= (Number(g.maxUses) || 1)) throw err('resource-exhausted', 'This download link has been used up.', { status: 410 });
      // A transaction may not read after it writes, so the file's download
      // counter is bumped separately below (best effort — a lost count is
      // harmless, a refused download is not).
      if (counting) tx.set(ref, { ...g, uses: (Number(g.uses) || 0) + 1, lastUsedAt: at });
      return g;
    });
    if (counting && !grant.admin) bumpDownloads(grant.fileId).catch(() => {});
    const object = bucket.file(grant.storagePath);
    const [exists] = await object.exists();
    if (!exists) throw err('not-found', 'This file has been removed.', { status: 410 });
    return {
      object,
      fileName: safeFileName(grant.fileName),
      headers: {
        'Content-Type': servedContentType(grant.contentType),
        'Content-Disposition': contentDisposition(grant.fileName),
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow'
      },
      size: Number(grant.size) || 0
    };
  }

  async function bumpDownloads(fileId) {
    if (!FILE_ID_RE.test(String(fileId || ''))) return;
    await db.runTransaction(async tx => {
      const ref = fileRef(fileId);
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const d = snap.data();
      tx.set(ref, { ...d, downloads: (Number(d.downloads) || 0) + 1, lastDownloadAt: now() });
    });
  }

  // ───────────────────────── Housekeeping ─────────────────────────
  async function cleanup() {
    const at = now();
    let removed = 0;
    for (const name of ['limits', 'grants']) {
      const snap = await col(name).where('expiresAt', '<=', at).limit(LIMITS.cleanupBatch).get();
      if (snap.empty) continue;
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      removed += snap.size;
    }
    return removed;
  }

  // ───────────────────────── Admin ─────────────────────────
  async function overview() {
    const [filesSnap, settingsSnap, leadsCount, activeCount] = await Promise.all([
      col('files').limit(LIMITS.filesMax).get(),
      settingsRef().get(),
      col('leads').count().get(),
      col('leads').where('consentActive', '==', true).count().get()
    ]);
    const files = sortFiles(filesSnap.docs.map(doc => adm(doc.id, doc.data())));
    let cleaned = 0;
    try { cleaned = await cleanup(); } catch { cleaned = 0; }
    return {
      files,
      settings: settingsWithDefaults(settingsSnap.exists ? settingsSnap.data() : null),
      consent: { version: CONSENT_VERSION, text: CONSENT_TEXT },
      stats: {
        leads: Number(leadsCount.data().count) || 0,
        consenting: Number(activeCount.data().count) || 0,
        unlocks: files.reduce((sum, f) => sum + f.unlocks, 0),
        downloads: files.reduce((sum, f) => sum + f.downloads, 0),
        filesTotal: files.length,
        filesVisible: files.filter(f => f.published).length
      },
      cleaned,
      limits: { maxFileBytes: MAX_FILE_BYTES, chunkMaxBytes: LIMITS.chunkMaxBytes, grantTtlMs: LIMITS.grantTtlMs, grantUses: LIMITS.grantUses },
      storagePrefix: STORAGE_PREFIX
    };
  }

  async function objectInfo(fileId, storagePath) {
    if (!storagePathOk(fileId, storagePath))
      throw err('invalid-argument', 'That upload is not in this file\'s folder.', { field: 'storagePath' });
    const object = bucket.file(storagePath);
    const [exists] = await object.exists();
    if (!exists) throw err('not-found', 'The upload has not finished. Please upload the file again.', { field: 'storagePath' });
    const [meta] = await object.getMetadata();
    const size = Number(meta && meta.size) || 0;
    if (!size) throw err('invalid-argument', 'That file is empty.', { field: 'storagePath' });
    if (size > MAX_FILE_BYTES) throw err('invalid-argument', 'That file is larger than ' + Math.round(MAX_FILE_BYTES / 1048576) + ' MB.', { field: 'storagePath' });
    return { size, contentType: String((meta && meta.contentType) || '').slice(0, 120) };
  }

  async function createFile(data) {
    const fileId = String(data.fileId || '');
    if (!FILE_ID_RE.test(fileId)) throw err('invalid-argument', 'Missing file id.', { field: 'fileId' });
    const text = validateFileText({ title: data.title, description: data.description ?? '', published: data.published ?? true });
    if (!text.ok) throw err('invalid-argument', text.message, { field: text.field });
    const info = await objectInfo(fileId, data.storagePath);
    const fileName = safeFileName(data.fileName || String(data.storagePath).split('/').pop());
    const at = now();
    const existingCount = await col('files').count().get();
    if ((Number(existingCount.data().count) || 0) >= LIMITS.filesMax)
      throw err('resource-exhausted', 'The page can hold ' + LIMITS.filesMax + ' files. Please delete one first.');
    const created = await db.runTransaction(async tx => {
      const ref = fileRef(fileId);
      const snap = await tx.get(ref);
      if (snap.exists) throw err('already-exists', 'A file with this id already exists. Please upload again.', { field: 'fileId' });
      const doc = {
        title: text.value.title, description: text.value.description || '', published: text.value.published !== false,
        fileName, storagePath: data.storagePath, size: info.size, contentType: info.contentType,
        order: Number.isFinite(Number(data.order)) ? Number(data.order) : -at / 1000,
        createdAt: at, updatedAt: at, unlocks: 0, downloads: 0
      };
      tx.set(ref, doc);
      return doc;
    });
    log('createFile', { fileId });
    return { file: adm(fileId, created) };
  }

  async function replaceFile(data) {
    const fileId = String(data.fileId || '');
    if (!FILE_ID_RE.test(fileId)) throw err('invalid-argument', 'Missing file id.', { field: 'fileId' });
    const info = await objectInfo(fileId, data.storagePath);
    const fileName = safeFileName(data.fileName || String(data.storagePath).split('/').pop());
    const at = now();
    const { before, after } = await db.runTransaction(async tx => {
      const ref = fileRef(fileId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw err('not-found', 'That file no longer exists.', { field: 'fileId' });
      const d = snap.data();
      const next = { ...d, fileName, storagePath: data.storagePath, size: info.size, contentType: info.contentType, updatedAt: at };
      tx.set(ref, next);
      return { before: d, after: next };
    });
    if (before.storagePath && before.storagePath !== after.storagePath)
      await bucket.file(before.storagePath).delete({ ignoreNotFound: true }).catch(() => {});
    log('replaceFile', { fileId });
    return { file: adm(fileId, after) };
  }

  async function updateFile(data) {
    const fileId = String(data.fileId || '');
    if (!FILE_ID_RE.test(fileId)) throw err('invalid-argument', 'Missing file id.', { field: 'fileId' });
    const patch = {};
    for (const k of ['title', 'description', 'published']) if (data[k] !== undefined) patch[k] = data[k];
    const text = validateFileText(patch, { requireTitle: patch.title !== undefined });
    if (!text.ok) throw err('invalid-argument', text.message, { field: text.field });
    const at = now();
    const after = await db.runTransaction(async tx => {
      const ref = fileRef(fileId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw err('not-found', 'That file no longer exists.', { field: 'fileId' });
      const next = { ...snap.data(), ...text.value, updatedAt: at };
      tx.set(ref, next);
      return next;
    });
    return { file: adm(fileId, after) };
  }

  async function reorder(data) {
    const ids = Array.isArray(data.ids) ? data.ids.filter(id => FILE_ID_RE.test(String(id))).slice(0, LIMITS.filesMax) : [];
    if (!ids.length) throw err('invalid-argument', 'Nothing to reorder.');
    const snaps = await Promise.all(ids.map(id => fileRef(id).get()));
    const batch = db.batch();
    let n = 0;
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      batch.set(fileRef(ids[i]), { ...snap.data(), order: i * 10 });
      n++;
    });
    if (n) await batch.commit();
    return { reordered: n };
  }

  async function deleteFile(data) {
    const fileId = String(data.fileId || '');
    if (!FILE_ID_RE.test(fileId)) throw err('invalid-argument', 'Missing file id.', { field: 'fileId' });
    const snap = await fileRef(fileId).get();
    // Every object in this file's own folder goes: the file, any replaced copy
    // left behind, and any half-finished server upload.
    const [[objects], [previews]] = await Promise.all([
      bucket.getFiles({ prefix: STORAGE_PREFIX + fileId + '/' }),
      bucket.getFiles({ prefix: PREVIEW_PREFIX + fileId + '/' })
    ]);
    const all = [...objects, ...previews];
    await Promise.all(all.map(o => o.delete({ ignoreNotFound: true }).catch(() => {})));
    if (snap.exists) await fileRef(fileId).delete();
    log('deleteFile', { fileId, objects: all.length });
    return { deleted: snap.exists, objectsRemoved: all.length };
  }

  async function adminLink(data) {
    const fileId = String(data.fileId || '');
    if (!FILE_ID_RE.test(fileId)) throw err('invalid-argument', 'Missing file id.', { field: 'fileId' });
    const snap = await fileRef(fileId).get();
    if (!snap.exists) throw err('not-found', 'That file no longer exists.');
    const d = snap.data();
    const key = newKey(), at = now();
    await col('grants').doc(sha256Hex(key)).set({
      fileId, leadId: '', storagePath: d.storagePath, fileName: d.fileName || 'download', contentType: d.contentType || '',
      size: Number(d.size) || 0, createdAt: at, expiresAt: at + LIMITS.adminGrantTtlMs, uses: 0,
      maxUses: LIMITS.adminGrantUses, admin: true
    });
    return { downloadUrl: downloadUrl + '?k=' + key, expiresAt: at + LIMITS.adminGrantTtlMs };
  }

  async function saveSettings(data) {
    const checked = validateSettings(data);
    if (!checked.ok) throw err('invalid-argument', checked.message, { field: checked.field });
    await settingsRef().set({ ...checked.value, updatedAt: now() });
    return { settings: settingsWithDefaults(checked.value) };
  }

  async function leads(data = {}) {
    const limit = Math.min(Math.max(Number(data.limit) || LIMITS.leadsPage, 1), LIMITS.leadsPage);
    let query = col('leads').orderBy('lastAt', 'desc').limit(limit);
    if (Number.isFinite(Number(data.before)) && Number(data.before) > 0) query = query.startAfter(Number(data.before));
    const snap = await query.get();
    const rows = snap.docs.map(doc => leadForAdmin(doc.id, doc.data()));
    return { leads: rows, more: rows.length === limit, next: rows.length ? rows[rows.length - 1].lastAt : 0 };
  }

  async function allLeads() {
    const out = [];
    let before = 0;
    for (;;) {
      const page = await leads({ before, limit: LIMITS.leadsPage });
      out.push(...page.leads);
      if (!page.more || out.length >= LIMITS.leadsMax || !page.next) break;
      before = page.next;
    }
    return out.slice(0, LIMITS.leadsMax);
  }

  async function leadHistory(data) {
    const leadId = String(data.leadId || '');
    if (!LEAD_ID_RE.test(leadId)) throw err('invalid-argument', 'Missing lead.');
    const [leadSnap, events] = await Promise.all([
      leadRef(leadId).get(),
      leadRef(leadId).collection(UNLOCKS_SUB).orderBy('at', 'desc').limit(LIMITS.historyMax).get()
    ]);
    if (!leadSnap.exists) throw err('not-found', 'That person is no longer on the list.');
    const lead = leadSnap.data();
    return {
      lead: leadForAdmin(leadId, lead),
      consentHistory: Array.isArray(lead.consentHistory) ? lead.consentHistory : [],
      consentText: (lead.consent && lead.consent.text) || '',
      unlocks: events.docs.map(doc => {
        const e = doc.data();
        return { id: doc.id, fileId: e.fileId || '', fileTitle: e.fileTitle || '', at: Number(e.at) || 0,
          name: e.name || '', whatsapp: e.whatsapp || '', consentVersion: e.consentVersion || '' };
      })
    };
  }

  async function setConsent(data, actorEmail) {
    const leadId = String(data.leadId || '');
    if (!LEAD_ID_RE.test(leadId)) throw err('invalid-argument', 'Missing lead.');
    const withdrawn = data.withdrawn === true;
    const at = now();
    const after = await db.runTransaction(async tx => {
      const ref = leadRef(leadId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw err('not-found', 'That person is no longer on the list.');
      const d = snap.data();
      const consent = { ...(d.consent || {}) };
      const history = Array.isArray(d.consentHistory) ? d.consentHistory.slice() : [];
      if (withdrawn) {
        if (d.consentActive === false) return d;
        consent.withdrawnAt = at; consent.withdrawnBy = 'admin';
        history.push({ action: 'withdrawn', at, by: 'admin', actor: clip(actorEmail || '', 120) });
      } else {
        // Only the admin's OWN marking can be undone here. A person who said
        // STOP is restored only by unlocking again and ticking the box.
        if (d.consentActive === true) return d;
        if (!consent.version) throw err('failed-precondition', 'There is no consent on record to restore.');
        consent.withdrawnAt = 0; consent.withdrawnBy = '';
        history.push({ action: 'withdrawal undone', at, by: 'admin', actor: clip(actorEmail || '', 120) });
      }
      const next = { ...d, consent, consentActive: !withdrawn, consentHistory: history.slice(-20) };
      tx.set(ref, next);
      return next;
    });
    return { lead: leadForAdmin(leadId, after) };
  }

  async function deleteLead(data) {
    const leadId = String(data.leadId || '');
    if (!LEAD_ID_RE.test(leadId)) throw err('invalid-argument', 'Missing lead.');
    let removed = 0;
    for (;;) {
      const snap = await leadRef(leadId).collection(UNLOCKS_SUB).limit(300).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      removed += snap.size;
      if (snap.size < 300) break;
    }
    await leadRef(leadId).delete();
    log('deleteLead', { events: removed });
    return { deleted: true, events: removed };
  }

  // ── Fallback upload, through the server, for when the browser cannot write
  //    to Storage directly. Chunks land in a hidden .parts/ folder inside the
  //    file's own folder and are composed into one object at the end.
  const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{8,24}$/;
  const partPath = (fileId, uploadId, index) => STORAGE_PREFIX + fileId + '/.parts/' + uploadId + '-' + String(index).padStart(4, '0');

  async function uploadChunk(data) {
    const fileId = String(data.fileId || ''), uploadId = String(data.uploadId || '');
    const index = Number(data.index), total = Number(data.total);
    if (!FILE_ID_RE.test(fileId) || !UPLOAD_ID_RE.test(uploadId)) throw err('invalid-argument', 'Bad upload id.');
    if (!Number.isInteger(total) || total < 1 || total * LIMITS.chunkMaxBytes > MAX_FILE_BYTES + LIMITS.chunkMaxBytes)
      throw err('invalid-argument', 'That file is too large.');
    if (!Number.isInteger(index) || index < 0 || index >= total) throw err('invalid-argument', 'Bad chunk number.');
    if (typeof data.data !== 'string' || !data.data) throw err('invalid-argument', 'Empty chunk.');
    const bytes = Buffer.from(data.data, 'base64');
    if (!bytes.length || bytes.length > LIMITS.chunkMaxBytes) throw err('invalid-argument', 'That chunk is too large.');
    await bucket.file(partPath(fileId, uploadId, index)).save(bytes, { resumable: false, contentType: 'application/octet-stream' });
    return { index, bytes: bytes.length };
  }

  async function uploadFinish(data) {
    const fileId = String(data.fileId || ''), uploadId = String(data.uploadId || '');
    const total = Number(data.total);
    if (!FILE_ID_RE.test(fileId) || !UPLOAD_ID_RE.test(uploadId)) throw err('invalid-argument', 'Bad upload id.');
    if (!Number.isInteger(total) || total < 1 || total > 64) throw err('invalid-argument', 'Bad chunk count.');
    const fileName = safeFileName(data.fileName || 'download');
    const contentType = String(data.contentType || 'application/octet-stream').slice(0, 120);
    const parts = [];
    for (let i = 0; i < total; i++) {
      const part = bucket.file(partPath(fileId, uploadId, i));
      const [exists] = await part.exists();
      if (!exists) throw err('failed-precondition', 'Part ' + (i + 1) + ' of the upload is missing. Please upload again.');
      parts.push(part);
    }
    const destPath = STORAGE_PREFIX + fileId + '/' + fileName;
    const dest = bucket.file(destPath);
    // Compose takes at most 32 sources a call, so a long upload is folded in rounds.
    let layer = parts, round = 0;
    const temps = [];
    while (layer.length > LIMITS.composeMax) {
      const next = [];
      for (let i = 0; i < layer.length; i += LIMITS.composeMax) {
        const group = layer.slice(i, i + LIMITS.composeMax);
        const temp = bucket.file(STORAGE_PREFIX + fileId + '/.parts/' + uploadId + '-r' + round + '-' + i);
        await bucket.combine(group, temp);
        temps.push(temp); next.push(temp);
      }
      layer = next; round++;
    }
    if (layer.length === 1 && !temps.length) await layer[0].copy(dest);
    else await bucket.combine(layer, dest);
    await dest.setMetadata({ contentType, cacheControl: 'private, max-age=0' });
    await Promise.all([...parts, ...temps].map(p => p.delete({ ignoreNotFound: true }).catch(() => {})));
    const info = await objectInfo(fileId, destPath).catch(async e => {
      await dest.delete({ ignoreNotFound: true }).catch(() => {});
      throw e;
    });
    return { storagePath: destPath, fileName, size: info.size, contentType: info.contentType };
  }

  // ── The booklet mock-up's pages ──
  function previewUrl(path, token) {
    return 'https://firebasestorage.googleapis.com/v0/b/' + bucketName + '/o/' + encodeURIComponent(path) +
      '?alt=media&token=' + token;
  }
  function newToken() {
    const h = random(16).toString('hex');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32);
  }

  async function savePreviews(data) {
    const fileId = String(data.fileId || '');
    if (!FILE_ID_RE.test(fileId)) throw err('invalid-argument', 'Missing file id.', { field: 'fileId' });
    const pages = Array.isArray(data.pages) ? data.pages : [];
    if (!pages.length) throw err('invalid-argument', 'There are no pages to show.');
    if (pages.length > PREVIEW_MAX_PAGES) throw err('invalid-argument', 'Show at most ' + PREVIEW_MAX_PAGES + ' pages in the booklet.');
    const decoded = pages.map((p, i) => {
      const bytes = Buffer.from(String((p && p.data) || ''), 'base64');
      if (bytes.length < 200 || bytes[0] !== 0xFF || bytes[1] !== 0xD8 || bytes[2] !== 0xFF)
        throw err('invalid-argument', 'Page ' + (i + 1) + ' of the booklet is not a JPEG picture.');
      if (bytes.length > PREVIEW_MAX_BYTES) throw err('invalid-argument', 'Page ' + (i + 1) + ' of the booklet is too large.');
      const w = Math.round(Number(p.w)), h = Math.round(Number(p.h));
      if (!(w >= 40 && w <= PREVIEW_MAX_SIDE && h >= 40 && h <= PREVIEW_MAX_SIDE * 2))
        throw err('invalid-argument', 'Page ' + (i + 1) + ' of the booklet has an odd size.');
      return { bytes, w, h, page: Math.max(1, Math.round(Number(p.page) || i + 1)) };
    });
    const snap = await fileRef(fileId).get();
    if (!snap.exists) throw err('not-found', 'That file no longer exists.', { field: 'fileId' });
    const stamp = now().toString(36);
    const saved = [];
    for (let i = 0; i < decoded.length; i++) {
      const path = PREVIEW_PREFIX + fileId + '/' + stamp + '-' + i + '.jpg';
      const token = newToken();
      await bucket.file(path).save(decoded[i].bytes, {
        resumable: false,
        metadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable',
          metadata: { firebaseStorageDownloadTokens: token } }
      });
      saved.push({ path, url: previewUrl(path, token), w: decoded[i].w, h: decoded[i].h, page: decoded[i].page });
    }
    const pageCount = Math.max(0, Math.min(100000, Math.round(Number(data.pageCount) || 0)));
    const after = await db.runTransaction(async tx => {
      const ref = fileRef(fileId);
      const s = await tx.get(ref);
      if (!s.exists) throw err('not-found', 'That file no longer exists.', { field: 'fileId' });
      const next = { ...s.data(), previews: saved.map(({ url, w, h, page }) => ({ url, w, h, page })),
        previewPages: saved.map(p => p.page), pageCount: pageCount || Number(s.data().pageCount) || 0,
        previewAt: now(), updatedAt: now() };
      tx.set(ref, next);
      return next;
    });
    // The pages this replaced are no longer pointed at by anything.
    const keep = new Set(saved.map(p => p.path));
    const [objects] = await bucket.getFiles({ prefix: PREVIEW_PREFIX + fileId + '/' });
    await Promise.all(objects.filter(o => !keep.has(o.name)).map(o => o.delete({ ignoreNotFound: true }).catch(() => {})));
    log('savePreviews', { fileId, pages: saved.length });
    return { file: adm(fileId, after) };
  }

  async function clearPreviews(data) {
    const fileId = String(data.fileId || '');
    if (!FILE_ID_RE.test(fileId)) throw err('invalid-argument', 'Missing file id.', { field: 'fileId' });
    const after = await db.runTransaction(async tx => {
      const ref = fileRef(fileId);
      const s = await tx.get(ref);
      if (!s.exists) throw err('not-found', 'That file no longer exists.', { field: 'fileId' });
      const next = { ...s.data(), previews: [], previewPages: [], previewAt: now() };
      tx.set(ref, next);
      return next;
    });
    const [objects] = await bucket.getFiles({ prefix: PREVIEW_PREFIX + fileId + '/' });
    await Promise.all(objects.map(o => o.delete({ ignoreNotFound: true }).catch(() => {})));
    return { file: adm(fileId, after) };
  }

  /** One file at most wears the booklet in the middle of the page. */
  async function setFeatured(data) {
    const fileId = String(data.fileId || '');
    const featured = data.featured !== false;
    if (!FILE_ID_RE.test(fileId)) throw err('invalid-argument', 'Missing file id.', { field: 'fileId' });
    const [target, current] = await Promise.all([
      fileRef(fileId).get(),
      col('files').where('featured', '==', true).limit(LIMITS.filesMax).get()
    ]);
    if (!target.exists) throw err('not-found', 'That file no longer exists.', { field: 'fileId' });
    const batch = db.batch();
    current.docs.forEach(doc => { if (doc.id !== fileId) batch.set(doc.ref, { ...doc.data(), featured: false }); });
    batch.set(fileRef(fileId), { ...target.data(), featured });
    await batch.commit();
    return { featuredId: featured ? fileId : '' };
  }

  async function exportLeads() {
    const rows = await allLeads();
    return { leads: rows, exportedAt: now(), consentVersion: CONSENT_VERSION };
  }

  const ADMIN_ACTIONS = {
    overview: () => overview(),
    createFile, replaceFile, updateFile, reorder, deleteFile, adminLink,
    savePreviews, clearPreviews, setFeatured,
    saveSettings,
    leads, exportLeads, leadHistory,
    setConsent, deleteLead,
    uploadChunk, uploadFinish,
    cleanup: async () => ({ removed: await cleanup() })
  };

  async function admin(data, auth) {
    if (!auth) throw err('unauthenticated', 'Please sign in as the admin.');
    if (!isAdminToken(auth)) throw err('permission-denied', 'This account is not the admin of this page.');
    const action = data && typeof data.action === 'string' ? data.action : '';
    const fn = Object.prototype.hasOwnProperty.call(ADMIN_ACTIONS, action) ? ADMIN_ACTIONS[action] : null;
    if (!fn) throw err('invalid-argument', 'Unknown admin action.');
    return fn(data, auth.token.email);
  }

  return { listFiles, unlock, openDownload, admin, cleanup, overview, isAdminToken,
    _internal: { quotaRef, allLeads, objectInfo, bumpDownloads } };
}

/** The small page a broken or expired download link shows. No scripts, no outside resources. */
export function downloadErrorPage(status, message) {
  const safe = String(message || 'This download link cannot be used.').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hint = status === 410
    ? 'Download links last 24 hours. Go back to the resources page and unlock the file again — it only takes a moment.'
    : 'Please go back to the resources page and choose the file again.';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>Download link — Polymath Learning Centre</title>' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FAFAFA;color:#1A1A1A;' +
    "font-family:'Century Gothic',CenturyGothic,AppleGothic,sans-serif;line-height:1.6;padding:24px;box-sizing:border-box}" +
    '.card{max-width:440px;background:#fff;border-radius:16px;padding:40px 32px;text-align:center;' +
    'box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.06)}h1{font-size:1.35rem;margin:0 0 12px}' +
    'p{margin:0 0 24px;color:#5C5C5C}a{display:inline-block;background:#FFE0B2;color:#1A1A1A;text-decoration:none;' +
    'padding:12px 24px;border-radius:999px;font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.05),0 2px 8px rgba(0,0,0,.08)}' +
    'a:hover{background:#FFCC80}</style></head><body><main class="card"><h1>' + safe + '</h1><p>' + hint + '</p>' +
    '<a href="' + PAGE_URL + '">Back to the resources</a></main></body></html>';
}
