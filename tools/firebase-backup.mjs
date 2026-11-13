// 🛟 Polymath daily backup — the runner.
//
// Runs from GitHub Actions (.github/workflows/firebase-backup.yml) at about
// 12 AM Singapore time with the repository's FIREBASE_SERVICE_ACCOUNT, reads
// every Firestore collection of mathgen--app (plus the sign-in accounts and a
// list of the files in Cloud Storage) and emails two backups to
// admin@polymathlc.com.sg and chungzhikai@gmail.com through the same `mail`
// collection every other Polymath email uses:
//
//   1. Office & bookings — business records, inline zip + family-records CSV.
//   2. Full data — everything else, one zip attached from a short-lived signed
//      Storage link (split into inline parts if Storage is unavailable).
//
// Then it waits for the mailer to report each email delivered, removes the
// backup copies from the `mail` documents and from Storage (so the personal
// data does not pile up inside the very Firebase this protects against), and
// fails the workflow if an email did not go out — GitHub then emails the
// repository owner.
//
//   node tools/firebase-backup.mjs [--dry-run]      (needs GOOGLE_APPLICATION_CREDENTIALS)
//   BACKUP_DEPS=<dir with node_modules/firebase-admin>
//
// --dry-run reads everything, builds both zips, reports the sizes and sends
// and writes nothing. Logs only ever show collection names, counts and sizes:
// this repository and its Actions logs are public.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as B from './firebase-backup-core.mjs';

export const PAGE_SIZE = 1000;
export const SUBCOLLECTION_SCAN_MAX = 3000;   // list every document's subcollections up to this many docs
export const SUBCOLLECTION_SAMPLE = 50;       // above it, look at a sample
export const MAX_DEPTH = 5;
export const DELIVERY_WAIT_MS = 8 * 60 * 1000;

const log = (...a) => console.log(...a);

/* ─────────────────────────── Reading Firestore ─────────────────────────── */
export async function readCollection(col, FieldPath, types) {
  const docs = [];
  let last = null;
  for (;;) {
    let q = col.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) docs.push({ id: d.id, data: B.encodeValue(d.data(), types) });
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return docs;
}

// Walks a collection and all its subcollections. `found` gets one item per
// collection path that has documents; `notes` collects anything worth saying.
//
// Looking for subcollections costs one call per document, so: every document
// of a top-level collection up to SUBCOLLECTION_SCAN_MAX documents (a sample
// above that), and below the top level an evenly spread sample of
// NESTED_SCAN_SAMPLE parents. A subcollection name found under several parents
// (users/<uid>/settings …) is then read in one collection-group query, which
// reaches every parent that has it, sampled or not.
export async function walkCollection(col, ctx, depth, found, notes) {
  const docs = await readCollection(col, ctx.FieldPath, ctx.types);
  if (docs.length) found.push({ path: col.path, docs });
  let refs;
  if (docs.length <= SUBCOLLECTION_SCAN_MAX) {
    // listDocuments also returns "missing" parents that only hold subcollections.
    refs = await col.listDocuments();
  } else {
    refs = spread(docs, SUBCOLLECTION_SAMPLE).map(d => col.doc(d.id));
    notes.push(col.path + ': ' + docs.length + ' documents, subcollections looked for on a sample of ' + SUBCOLLECTION_SAMPLE);
  }
  await walkUnder(refs, col.path, ctx, depth + 1, found, notes);
}

export const NESTED_SCAN_SAMPLE = 200;
export const GROUP_READ_FROM = 4; // parents sharing a subcollection name before a group query is used

function spread(list, n) {
  if (list.length <= n) return list.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.floor(i * list.length / n)]);
  return out;
}

async function walkUnder(parentRefs, scopePath, ctx, depth, found, notes) {
  if (depth > MAX_DEPTH || !parentRefs.length) return;
  const sample = depth > 1 ? spread(parentRefs, NESTED_SCAN_SAMPLE) : parentRefs;
  const lists = await B.mapLimit(sample, 32, ref => ref.listCollections());
  const byName = new Map();
  sample.forEach((ref, i) => lists[i].forEach(c => { if (!byName.has(c.id)) byName.set(c.id, []); byName.get(c.id).push(c); }));
  for (const [name, cols] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sampled = sample.length < parentRefs.length;
    if (!sampled && cols.length < GROUP_READ_FROM) {
      for (const c of cols) await walkCollection(c, ctx, depth, found, notes);
      continue;
    }
    // One collection-group query for every <scopePath>/…/<name> at this depth.
    const segments = sample[0].path.split('/').length + 1; // path segments of such a collection
    const groups = await readGroup(ctx.db.collectionGroup(name), scopePath + '/', segments, ctx);
    const childRefs = [];
    for (const [path, docs] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      found.push({ path, docs });
      for (const d of docs) childRefs.push(ctx.db.collection(path).doc(d.id));
    }
    if (depth < MAX_DEPTH) await walkUnder(childRefs, scopePath, ctx, depth + 1, found, notes);
  }
}

async function readGroup(query, prefix, segments, ctx) {
  const groups = new Map();
  let last = null;
  for (;;) {
    let q = query.orderBy(ctx.FieldPath.documentId()).limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) {
      const parentPath = d.ref.parent.path;
      if (!parentPath.startsWith(prefix) || parentPath.split('/').length !== segments) continue;
      if (!groups.has(parentPath)) groups.set(parentPath, []);
      groups.get(parentPath).push({ id: d.id, data: B.encodeValue(d.data(), ctx.types) });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return groups;
}

export async function readEverything(db, ctx) {
  const found = [], skipped = [], notes = [];
  const roots = (await db.listCollections()).sort((a, b) => a.id.localeCompare(b.id));
  for (const col of roots) {
    const reason = B.skipReason(col.id);
    if (reason) { skipped.push({ path: col.id, reason }); continue; }
    const started = Date.now();
    const before = found.length;
    await walkCollection(col, ctx, 0, found, notes);
    const got = found.slice(before);
    log('  read ' + col.id + ': ' + got.reduce((a, c) => a + c.docs.length, 0) + ' documents in ' + got.length + ' collection(s), ' + Math.round((Date.now() - started) / 100) / 10 + 's');
  }
  return { found, skipped, notes };
}

export async function readAuthUsers(auth) {
  const users = [];
  let token;
  do {
    const page = await auth.listUsers(1000, token);
    for (const u of page.users) {
      const j = u.toJSON();
      // Never email password hashes. Google sign-in accounts do not have one;
      // anybody else simply sets a new password after a restore.
      delete j.passwordHash;
      delete j.passwordSalt;
      delete j.tokensValidAfterTime;
      users.push(j);
    }
    token = page.pageToken;
  } while (token);
  return users;
}

export async function readStorageIndex(bucket) {
  const [files] = await bucket.getFiles({ autoPaginate: true });
  return files
    .filter(f => !f.name.startsWith(B.STORAGE_PREFIX))
    .map(f => ({ name: f.name, size: Number(f.metadata.size) || 0, contentType: f.metadata.contentType || '', updated: f.metadata.updated || '' }));
}

/* ─────────────────────────── The office spreadsheet ─────────────────────────── */
// The same rows as the Families table on polymathlc.com.sg/office, from the
// office's own code. If that code changes shape, the backup still goes out
// with the raw CSVs and says the table could not be made.
export async function familyRecordsCsv(byPath, nowMs) {
  const C = await import('../office/office-core.mjs');
  const plain = path => (byPath.get(path) || []).map(d => Object.assign({ id: d.id }, B.decodeValue(d.data)));
  const schedule = (byPath.get('schedule_config') || []).find(d => d.id === 'main');
  // The office's settings: months billed together (November–December 2026) show as one.
  const config = plain('officeSettings').find(d => d.id === 'config');
  const rows = C.familyRecordRows(plain('officeFamilies'), {
    settings: C.normalizeSettings ? C.normalizeSettings(config || {}) : undefined,
    invoices: plain('officeInvoices'),
    payments: plain('officePayments'),
    schedule: schedule ? B.decodeValue(schedule.data) : undefined,
    today: B.sgDateKey(nowMs),
    includeLeft: true
  });
  return '﻿' + C.familyRecordCsv(rows) + '\r\n';
}

/* ─────────────────────────── Building the emails ─────────────────────────── */
export async function buildBackup({ found, skipped, authUsers, storageIndex, nowMs, problems }) {
  const exportedAt = new Date(nowMs).toISOString();
  const dateKey = B.sgDateKey(nowMs);
  const byPath = new Map(found.map(c => [c.path, c.docs]));

  const collectionEntries = found.map(c => B.prepareEntry(
    B.collectionFileName(c.path),
    B.collectionJson(c.path, c.docs, exportedAt),
    { path: c.path, count: c.docs.length, essential: B.isEssential(c.path) }
  ));

  // Things that only belong with the office email.
  const extras = [];
  let familyCsv = null;
  try {
    if (byPath.has('officeFamilies')) familyCsv = await familyRecordsCsv(byPath, nowMs);
  } catch (e) {
    problems.push('The Families spreadsheet could not be made tonight (' + String(e && e.message || e).slice(0, 120) + '); the raw office CSVs and JSON are complete.');
  }
  if (familyCsv) extras.push(B.prepareEntry('csv/family-records.csv', familyCsv));
  if (authUsers) {
    extras.push(B.prepareEntry('auth/users.json', JSON.stringify({ format: 'polymath-auth-backup/1', project: B.PROJECT_ID, exportedAt, count: authUsers.length, users: authUsers }, null, 1),
      { path: 'auth/users', count: authUsers.length, essential: true }));
  }
  const familyAttachment = familyCsv ? B.base64Attachment('family-records-' + dateKey + '.csv', Buffer.from(familyCsv, 'utf8'), 'text/csv; charset=utf-8') : null;

  const plan = B.planEmails(collectionEntries, {
    extraInline: [...extras, B.prepareEntry('README.txt', B.readmeText({ nowMs, kind: 'office' }))],
    extraInlineBase64: familyAttachment ? familyAttachment.content.length + 4096 : 4096
  });

  // CSV copies of the office collections, while they fit.
  const csvEntries = plan.inline.map(e => B.prepareEntry('csv/' + e.meta.path.replace(/\//g, '__') + '.csv', B.documentsCsv(byPath.get(e.meta.path))));
  const inlineBase = () => [...plan.inline, ...extras];
  const fits = list => B.base64Length(B.zipSizeOf(list) + 8192) + (familyAttachment ? familyAttachment.content.length : 0) <= B.INLINE_BASE64_BUDGET;
  csvEntries.sort((a, b) => a.data.length - b.data.length);
  const keptCsv = [];
  for (const c of csvEntries) if (fits([...inlineBase(), ...keptCsv, c])) keptCsv.push(c);
  if (keptCsv.length < csvEntries.length) problems.push((csvEntries.length - keptCsv.length) + ' spreadsheet copies were left out of the office zip to keep the email small; the JSON files are complete.');

  const officeData = [...plan.inline, ...(authUsers ? [extras[extras.length - 1]] : [])];
  const officeTotals = { collections: plan.inline.length, documents: plan.inline.reduce((a, e) => a + e.meta.count, 0) };
  const officeZipEntries = [
    B.prepareEntry('README.txt', B.readmeText({ nowMs, kind: 'office', totals: officeTotals })),
    B.prepareEntry('backup-manifest.json', B.manifest(plan.inline, nowMs, { email: 'office', authUsers: authUsers ? authUsers.length : null })),
    ...plan.inline, ...extras, ...keptCsv.sort((a, b) => a.name.localeCompare(b.name))
  ];
  const officeZip = B.writeZip(officeZipEntries, nowMs);

  // The full data, in up to LINKED_MAX_PARTS zips of at most LINKED_PART_LIMIT.
  const storageEntry = storageIndex ? B.prepareEntry('storage/files.json', JSON.stringify({ note: 'Names and sizes of the files in Cloud Storage (photos, screenshots, uploads). The files themselves are not in this backup.', count: storageIndex.length, files: storageIndex }, null, 1)) : null;
  const headRoom = 256 * 1024 + (storageEntry ? B.entryZipBytes(storageEntry) : 0);
  const packed = B.packInlineParts(plan.linked, { partLimit: B.LINKED_PART_LIMIT - headRoom, maxParts: B.LINKED_MAX_PARTS });
  const leftOut = [...plan.leftOut, ...packed.leftOut];
  const fullParts = packed.parts.map((entries, i) => {
    const totals = { collections: entries.length, documents: entries.reduce((a, e) => a + e.meta.count, 0) };
    const head = [
      B.prepareEntry('README.txt', B.readmeText({ nowMs, kind: 'full', totals })),
      B.prepareEntry('backup-manifest.json', B.manifest(entries, nowMs, {
        email: 'full', part: i + 1, parts: packed.parts.length,
        leftOut: leftOut.map(e => ({ path: e.meta.path, documents: e.meta.count, bytes: e.size })),
        skipped
      }))
    ];
    if (i === 0 && storageEntry) head.push(storageEntry);
    return { entries, zip: B.writeZip([...head, ...entries], nowMs) };
  });

  return { plan, officeData, officeZip, familyAttachment, fullParts, leftOut, dateKey };
}

/* ─────────────────────────── Sending and checking ─────────────────────────── */
async function waitForDelivery(db, ids, timeoutMs) {
  const states = new Map(ids.map(id => [id, 'PENDING']));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snaps = await Promise.all(ids.map(id => db.collection('mail').doc(id).get()));
    snaps.forEach(s => {
      const d = s.data() || {};
      const state = d.delivery && d.delivery.state;
      const err = d.delivery && d.delivery.error;
      states.set(s.id, state ? state + (err ? ': ' + String(err).slice(0, 160) : '') : 'PENDING');
    });
    if ([...states.values()].every(v => /^(SUCCESS|ERROR)/.test(v))) break;
    await new Promise(r => setTimeout(r, 10000));
  }
  return states;
}

export async function runBackup({ admin, dryRun, nowMs = Date.now() }) {
  const db = admin.firestore();
  const ctx = { db, FieldPath: admin.firestore.FieldPath, types: { Timestamp: admin.firestore.Timestamp, GeoPoint: admin.firestore.GeoPoint, DocumentReference: admin.firestore.DocumentReference } };
  const problems = [];
  const report = [];

  log('Reading Firestore …');
  const { found, skipped, notes } = await readEverything(db, ctx);
  notes.forEach(n => report.push(n));

  let authUsers = null;
  try { authUsers = await readAuthUsers(admin.auth()); log('  read ' + authUsers.length + ' sign-in accounts'); }
  catch (e) { problems.push('The sign-in accounts could not be read (' + String(e && e.code || e && e.message || e).slice(0, 80) + ').'); }

  let bucket = null, storageIndex = null;
  try { bucket = admin.storage().bucket(B.STORAGE_BUCKET); storageIndex = await readStorageIndex(bucket); log('  listed ' + storageIndex.length + ' Storage files'); }
  catch (e) { report.push('Storage file list unavailable: ' + String(e && e.code || e && e.message || e).slice(0, 80)); }

  const built = await buildBackup({ found, skipped, authUsers, storageIndex, nowMs, problems });
  const { plan, officeData, officeZip, familyAttachment, fullParts, leftOut, dateKey } = built;
  B.summaryLines(Object.assign({}, plan, { leftOut }), { skipped }).forEach(l => report.push(l));
  report.push('Office zip ' + B.prettyBytes(officeZip.length) + '; full data in ' + fullParts.length + ' zip(s): ' + fullParts.map(p => B.prettyBytes(p.zip.length)).join(', ') + '.');

  if (dryRun) {
    report.unshift('**Dry run — nothing sent or written.**');
    return { report, problems, sent: [] };
  }

  const mails = [];
  // Email 2 first: decide between the linked zip and inline parts, so email 1 can say what follows.
  let full = [];
  const objectNames = [];
  if (bucket && fullParts.length) {
    try {
      for (let i = 0; i < fullParts.length; i++) {
        const part = fullParts[i];
        const suffix = fullParts.length > 1 ? '-part' + (i + 1) : '';
        const objectName = B.STORAGE_PREFIX + dateKey + '/polymath-full-backup-' + dateKey + suffix + '-' + nowMs + '.zip';
        const file = bucket.file(objectName);
        await file.save(part.zip, { resumable: false, contentType: 'application/zip', metadata: { cacheControl: 'private, max-age=0', metadata: { polymathBackup: dateKey } } });
        objectNames.push(objectName);
        const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: nowMs + B.SIGNED_URL_HOURS * 3600 * 1000 });
        const msg = B.fullEmail({ nowMs, entries: part.entries, leftOut, skipped, partIndex: i, partCount: fullParts.length, zipBytes: part.zip.length, linked: true });
        full.push({ kind: 'full' + (fullParts.length > 1 ? '-part' + (i + 1) : ''), msg, objectName, attachments: [{ filename: 'polymath-full-backup-' + dateKey + suffix + '.zip', path: url, contentType: 'application/zip' }] });
      }
    } catch (e) {
      full = [];
      for (const name of objectNames.splice(0)) { try { await bucket.file(name).delete(); } catch (x) { /* swept on the next run */ } }
      report.push('Storage upload unavailable (' + String(e && e.code || e && e.message || e).slice(0, 80) + '); sending the full backup in small parts.');
    }
  }
  if (!full.length && plan.linked.length) {
    const { parts, leftOut: notInParts } = B.packInlineParts(plan.linked);
    const allLeft = [...plan.leftOut, ...notInParts];
    parts.forEach((p, i) => {
      const zip = B.writeZip([B.prepareEntry('README.txt', B.readmeText({ nowMs, kind: 'full' })), B.prepareEntry('backup-manifest.json', B.manifest(p, nowMs, { email: 'full', part: i + 1, parts: parts.length })), ...p], nowMs);
      const msg = B.fullEmail({ nowMs, entries: p, leftOut: allLeft, skipped, partIndex: i, partCount: parts.length, zipBytes: zip.length, linked: false });
      full.push({ kind: 'full-part' + (i + 1), msg, attachments: [B.base64Attachment('polymath-full-backup-' + dateKey + (parts.length > 1 ? '-part' + (i + 1) : '') + '.zip', zip)] });
    });
    if (notInParts.length) report.push('Left out of the parts: ' + notInParts.map(e => e.meta.path).join(', '));
  }

  const officeAttachments = [B.base64Attachment('polymath-office-backup-' + dateKey + '.zip', officeZip)];
  if (familyAttachment) officeAttachments.push(familyAttachment);
  const otherEmail = full.length
    ? (full.length === 1 ? 'The full data backup (everything else) arrives in a second email.' : 'The full data backup (everything else) arrives in ' + full.length + ' more emails.')
    : '';
  const officeMsg = B.inlineEmail({ nowMs, entries: officeData, attachments: officeAttachments, otherEmail, problems });
  mails.push({ kind: 'office', msg: officeMsg, attachments: officeAttachments });
  mails.push(...full);

  const ids = [];
  for (const m of mails) {
    const id = B.mailDocId(m.kind, dateKey, nowMs);
    const doc = B.mailDoc({ message: m.msg, attachments: m.attachments, meta: { kind: m.kind, date: dateKey, storageObject: m.objectName || null } });
    const size = B.attachmentsBase64Size(m.attachments) + Buffer.byteLength(m.msg.html) + Buffer.byteLength(m.msg.text);
    if (size > 1000 * 1024) throw new Error('The ' + m.kind + ' email would be too large for a mail document (' + B.prettyBytes(size) + ').');
    await db.collection('mail').doc(id).set(Object.assign(doc, { createdAt: admin.firestore.FieldValue.serverTimestamp() }));
    ids.push(id);
    log('  queued ' + m.kind + ' email (' + B.prettyBytes(size) + ')');
  }

  log('Waiting for the mailer …');
  const states = await waitForDelivery(db, ids, DELIVERY_WAIT_MS);
  const sent = [];
  for (const id of ids) {
    const state = states.get(id);
    report.push(id.replace(B.MAIL_PREFIX, '') + ': ' + state);
    if (/^SUCCESS/.test(state)) {
      sent.push(id);
      // The email has gone; do not keep a second copy of the data in Firestore.
      await db.collection('mail').doc(id).update({ 'message.attachments': [], 'polymathBackup.attachmentsRemovedAt': admin.firestore.FieldValue.serverTimestamp() });
    } else {
      problems.push('Email ' + id + ' was not confirmed delivered (' + state + ').');
    }
  }
  // Each Storage copy goes as soon as its email is confirmed sent.
  for (const m of mails) {
    if (!m.objectName) continue;
    const id = B.mailDocId(m.kind, dateKey, nowMs);
    if (!sent.includes(id)) continue;
    try { await bucket.file(m.objectName).delete(); } catch (e) { report.push('Could not delete a Storage copy: ' + String(e && e.code || e)); }
  }
  if (bucket) {
    try {
      const [old] = await bucket.getFiles({ prefix: B.STORAGE_PREFIX });
      const cutoff = nowMs - B.STORAGE_KEEP_HOURS * 3600 * 1000;
      for (const f of old) if (!objectNames.includes(f.name) && Date.parse(f.metadata.timeCreated || f.metadata.updated || 0) < cutoff) await f.delete();
    } catch (e) { /* the next run tries again */ }
  }
  return { report, problems, sent, ids };
}

/* ─────────────────────────── Command line (GitHub Actions) ─────────────────────────── */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const require = createRequire(process.env.BACKUP_DEPS ? join(process.env.BACKUP_DEPS, 'noop.js') : import.meta.url);
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: B.PROJECT_ID, storageBucket: B.STORAGE_BUCKET });
  const started = Date.now();
  try {
    const res = await runBackup({ admin, dryRun });
    const lines = [...res.report, ...res.problems.map(p => '⚠️ ' + p), 'Took ' + Math.round((Date.now() - started) / 1000) + 's.'];
    lines.forEach(l => log(l));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Polymath daily backup\n\n' + lines.map(l => '- ' + l).join('\n') + '\n');
    if (!dryRun && res.ids && res.sent.length < res.ids.length) process.exitCode = 1;
  } catch (e) {
    console.error('Backup failed: ' + String(e && e.message || e).slice(0, 300));
    process.exitCode = 1;
  }
}
