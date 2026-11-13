// 🛟 Polymath backup — restore a nightly backup zip into a Firebase project.
//
// The nightly emails (tools/firebase-backup.mjs) carry zips of JSON, one file
// per Firestore collection. This puts them back:
//
//   GOOGLE_APPLICATION_CREDENTIALS=key.json node tools/firebase-restore.mjs --project <id> <zip> [<zip> …]
//       checks the zips and says what it would write — writes nothing
//   … --apply                 actually writes (each document is replaced as it was)
//   … --only a,b,c            only these collections (top-level ids; their subcollections come too)
//   … --skip-existing         leave documents that already exist untouched
//   … --auth                  also recreate the sign-in accounts from auth/users.json
//                             (without passwords: Google sign-in works as before,
//                             email/password users choose a new password)
//
// Needs `npm install firebase-admin@12` (or FIREBASE_DEPS=<dir with it>).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as B from './firebase-backup-core.mjs';

export function parseArgs(argv) {
  const o = { project: '', apply: false, only: null, skipExisting: false, auth: false, zips: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') o.project = argv[++i] || '';
    else if (a === '--apply') o.apply = true;
    else if (a === '--only') o.only = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--skip-existing') o.skipExisting = true;
    else if (a === '--auth') o.auth = true;
    else if (a.startsWith('--')) throw new Error('Unknown option ' + a);
    else o.zips.push(a);
  }
  if (!o.project) throw new Error('Say which Firebase project to restore into: --project <project-id>');
  if (!o.zips.length) throw new Error('Give at least one backup zip.');
  return o;
}

// Every collection file and the auth file in the given zips. When two zips hold
// the same collection (they never should), the later zip wins and it is reported.
export function collectFromZips(zips) {
  const collections = new Map();
  let auth = null;
  const warnings = [];
  for (const z of zips) {
    for (const f of B.readZip(z.buffer)) {
      if (f.name.startsWith('firestore/') && f.name.endsWith('.json')) {
        const body = JSON.parse(f.data.toString('utf8'));
        if (!body || typeof body.collection !== 'string' || !Array.isArray(body.documents)) { warnings.push(z.name + ': ' + f.name + ' is not a collection file'); continue; }
        if (collections.has(body.collection)) warnings.push(body.collection + ' appears in more than one zip; using ' + z.name);
        collections.set(body.collection, body.documents);
      } else if (f.name === 'auth/users.json') {
        auth = JSON.parse(f.data.toString('utf8')).users || [];
      }
    }
  }
  return { collections, auth, warnings };
}

export function selectCollections(collections, only) {
  const paths = [...collections.keys()].sort();
  return only ? paths.filter(p => only.includes(B.rootId(p))) : paths;
}

async function restore(o) {
  const require = createRequire(process.env.FIREBASE_DEPS ? join(process.env.FIREBASE_DEPS, 'noop.js') : join(process.cwd(), 'noop.js'));
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: o.project });
  const db = admin.firestore();
  const make = {
    timestamp: (s, n) => new admin.firestore.Timestamp(s, n),
    geopoint: (lat, lng) => new admin.firestore.GeoPoint(lat, lng),
    ref: path => db.doc(path),
    bytes: buf => buf
  };

  const zips = o.zips.map(p => ({ name: basename(p), buffer: readFileSync(p) }));
  const { collections, auth, warnings } = collectFromZips(zips);
  warnings.forEach(w => console.warn('⚠️ ' + w));
  const paths = selectCollections(collections, o.only);
  const total = paths.reduce((a, p) => a + collections.get(p).length, 0);
  console.log((o.apply ? 'Restoring' : 'Would restore') + ' ' + total + ' documents in ' + paths.length + ' collections into ' + o.project + ':');
  paths.forEach(p => console.log('  ' + p + ': ' + collections.get(p).length));
  if (o.auth) console.log((o.apply ? 'Restoring' : 'Would restore') + ' ' + (auth ? auth.length : 0) + ' sign-in accounts.');
  if (!o.apply) { console.log('\nNothing written. Add --apply to write.'); return; }

  const writer = db.bulkWriter();
  let written = 0, skipped = 0, failed = 0;
  writer.onWriteError(err => { if (err.failedAttempts < 5) return true; failed++; console.error('  failed ' + err.documentRef.path + ': ' + err.message); return false; });
  for (const p of paths) {
    const col = db.collection(p);
    for (const d of collections.get(p)) {
      const ref = col.doc(d.id);
      if (o.skipExisting && (await ref.get()).exists) { skipped++; continue; }
      writer.set(ref, B.decodeValue(d.data, make)).then(() => { written++; }, () => {});
    }
  }
  await writer.close();
  console.log('Wrote ' + written + ' documents' + (skipped ? ', left ' + skipped + ' existing ones alone' : '') + (failed ? ', ' + failed + ' FAILED' : '') + '.');

  if (o.auth && auth && auth.length) {
    const users = auth.map(u => {
      const rec = { uid: u.uid, email: u.email || undefined, emailVerified: !!u.emailVerified, displayName: u.displayName || undefined, photoURL: u.photoURL || undefined, phoneNumber: u.phoneNumber || undefined, disabled: !!u.disabled, customClaims: u.customClaims || undefined };
      rec.providerData = (u.providerData || []).filter(p => p.providerId !== 'password' && p.providerId !== 'phone').map(p => ({ uid: p.uid, providerId: p.providerId, email: p.email || undefined, displayName: p.displayName || undefined, photoURL: p.photoURL || undefined }));
      if (u.metadata) rec.metadata = { creationTime: u.metadata.creationTime, lastSignInTime: u.metadata.lastSignInTime };
      Object.keys(rec).forEach(k => rec[k] === undefined && delete rec[k]);
      return rec;
    });
    let ok = 0, bad = 0;
    for (let i = 0; i < users.length; i += 1000) {
      const res = await admin.auth().importUsers(users.slice(i, i + 1000));
      ok += res.successCount; bad += res.failureCount;
      res.errors.forEach(e => console.error('  account ' + users[i + e.index].uid + ': ' + e.error.message));
    }
    console.log('Accounts: ' + ok + ' restored' + (bad ? ', ' + bad + ' failed' : '') + '.');
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await restore(parseArgs(process.argv.slice(2))); }
  catch (e) { console.error(String(e && e.message || e)); process.exitCode = 1; }
}
