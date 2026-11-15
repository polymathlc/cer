// Bring every Ans Key roster row in line with polymathlc.com.sg/student
// (My Polymath v1.9.0).
//
// The Ans Key app (polymathlc/anskey) used to keep its own, self-picked level
// in studentProfiles/{uid}, and the /student approval (studentAccess/{uid})
// was never read there. Both sides now follow the approval live, but a row is
// only corrected when its student opens Ans Key or an admin opens
// /student/#admin. This corrects every existing row at once, with the SAME
// rule the dashboard uses (ansKeyProfilePatch in student/student-account.js,
// loaded from that file so the two can never differ):
//   • only APPROVED accounts, only rows that EXIST, only level and subject;
//   • name, class days, time slot and the student's one change are untouched.
//
// It prints COUNTS only — never a name, an email or a uid, because the Actions
// log of this public repository is public.
//
//   node tools/anskey-level-sync.mjs           report what would change (dry run)
//   node tools/anskey-level-sync.mjs --apply   write the corrections
// (GOOGLE_APPLICATION_CREDENTIALS set, IMPACT_DEPS=<dir with node_modules/firebase-admin>)
//
// The arithmetic is planAnsKeyFixes() below, tested offline in student-access-tests.mjs.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

export const PROJECT = 'mathgen--app';
const here = dirname(fileURLToPath(import.meta.url));

/** The dashboard's own helpers, out of student/student-account.js. */
export function dashboardHelpers() {
  const source = readFileSync(join(here, '..', 'student', 'student-account.js'), 'utf8');
  const sandbox = { setTimeout() {}, clearTimeout() {}, Date };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.MyPolymathAccount.helpers;
}

/**
 * records: [{ id, data }] from studentAccess; profiles: { uid: studentProfiles row }.
 * → { fixes: [{ id, patch }], counts }
 * Staff never count (their requests are not students).
 */
export function planAnsKeyFixes(records, profiles, helpers = dashboardHelpers()) {
  const counts = { records: 0, approved: 0, withRow: 0, alreadyRight: 0, toFix: 0, noAnsKeyLevel: 0, staffSkipped: 0, levelChanges: 0, subjectOnly: 0 };
  const fixes = [];
  for (const { id, data } of records || []) {
    counts.records++;
    if (helpers.isStaffRecord && helpers.isStaffRecord(data)) { counts.staffSkipped++; continue; }
    if (helpers.statusOf(data) !== 'approved') continue;
    counts.approved++;
    const row = profiles[id];
    if (!row) continue;
    counts.withRow++;
    const levels = helpers.ansKeyLevels(data);
    if (!Object.keys(levels).length) { counts.noAnsKeyLevel++; continue; }
    const patch = helpers.ansKeyProfilePatch(data, row);
    if (!patch) { counts.alreadyRight++; continue; }
    counts.toFix++;
    if (patch.level !== row.level) counts.levelChanges++; else counts.subjectOnly++;
    fixes.push({ id, patch: { level: patch.level, subject: patch.subject, levelSource: patch.levelSource } });
  }
  return { fixes, counts };
}

export function planLines(c, applied) {
  return [
    `Approved accounts: ${c.approved} of ${c.records} records (${c.staffSkipped} staff skipped); ${c.withRow} have an Ans Key profile.`,
    `Already matching /student: ${c.alreadyRight}. No child at an Ans Key level (P3–P6, S1): ${c.noAnsKeyLevel}.`,
    `Out of step with /student: ${c.toFix} (wrong level ${c.levelChanges}, right level but wrong subject ${c.subjectOnly}).`,
    applied ? `Corrected: ${applied}.` : 'Dry run: nothing written (run with --apply to correct them).'
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes('--apply');
  const deps = process.env.IMPACT_DEPS;
  if (!deps) throw new Error('Set IMPACT_DEPS to a folder with node_modules/firebase-admin.');
  const require = createRequire(join(deps, 'package.json'));
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT });
  const db = admin.firestore();
  const snap = await db.collection('studentAccess').get();
  const records = snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
  const ids = records.map(r => r.id);
  const profiles = {};
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map(id => db.collection('studentProfiles').doc(id));
    if (!refs.length) continue;
    for (const doc of await db.getAll(...refs)) if (doc.exists) profiles[doc.id] = doc.data();
  }
  const { fixes, counts } = planAnsKeyFixes(records, profiles);
  let applied = 0;
  if (apply && fixes.length) {
    for (let i = 0; i < fixes.length; i += 400) {
      const batch = db.batch();
      for (const { id, patch } of fixes.slice(i, i + 400)) {
        batch.set(db.collection('studentProfiles').doc(id),
          { ...patch, levelSyncedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
      await batch.commit();
      applied += Math.min(400, fixes.length - i);
    }
  }
  console.log(JSON.stringify({ ...counts, applied }));
  for (const line of planLines(counts, apply ? applied || '0' : 0)) console.log(line);
}
