// TEMPORARY: measures what a Firestore backup of mathgen--app would hold.
// Prints collection names, document counts and byte sizes only, never data
// (this repository and its Actions logs are public).
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { appendFileSync } from 'node:fs';

const require = createRequire(join(process.env.BACKUP_DEPS, 'noop.js'));
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'mathgen--app' });
const db = admin.firestore();
const rows = [];
const started = Date.now();
async function measure(col, depth) {
  let count = 0, bytes = 0; const chunks = []; const subs = new Map();
  let last = null; let truncated = false;
  for (;;) {
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const s = JSON.stringify(d.data()); count++; bytes += s.length;
      if (chunks.length < 4000) chunks.push(s);
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 500) break;
    if (Date.now() - started > 20 * 60 * 1000) { truncated = true; break; }
  }
  // subcollections: check the first 30 documents
  if (depth < 3) {
    const refs = await col.listDocuments();
    for (const r of refs.slice(0, 30)) for (const c of await r.listCollections()) subs.set(c.id, (subs.get(c.id) || 0) + 1);
    rows.push({ path: col.path, count, bytes, gz: gzipSync(chunks.join('\n')).length, sampled: chunks.length, docRefs: refs.length, subs: [...subs.keys()].join(' '), truncated });
    for (const r of refs.slice(0, 3)) for (const c of await r.listCollections()) await measure(c, depth + 1);
  } else rows.push({ path: col.path, count, bytes, gz: 0, sampled: 0, docRefs: 0, subs: '', truncated });
}
for (const c of await db.listCollections()) {
  try { await measure(c, 0); } catch (e) { rows.push({ path: c.path, error: String(e.message).slice(0, 100) }); }
}
const kb = n => (n / 1024).toFixed(1);
const lines = ['| collection | docs | JSON KB | gzip KB (sampled docs) | doc refs | subcollections |', '|---|---|---|---|---|---|',
  ...rows.map(r => r.error ? `| ${r.path} | error: ${r.error} |||||` : `| ${r.path} | ${r.count}${r.truncated ? '+' : ''} | ${kb(r.bytes)} | ${kb(r.gz)} (${r.sampled}) | ${r.docRefs} | ${r.subs} |`)];
const total = rows.reduce((a, r) => a + (r.bytes || 0), 0);
lines.push('', `Total JSON ${kb(total)} KB in ${rows.length} collections, ${Math.round((Date.now() - started) / 1000)}s`);
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
