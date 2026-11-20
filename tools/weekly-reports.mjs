// 📈 Polymath weekly parent progress reports — the sender.
//
// Run every half hour from GitHub Actions (.github/workflows/weekly-parent-reports.yml)
// with the repository's FIREBASE_SERVICE_ACCOUNT. Each check is cheap: it reads
// officeSettings/weeklyReports and, almost always, stops there. It acts when
//
//   • the office pressed "Email me this week's reports" or "Email parents now"
//     on polymathlc.com.sg/office/#reports (a request in weeklyReports.request), or
//   • it is Sunday 6 PM (Singapore) to Monday noon and that week has not been
//     done yet: 'review' → the office gets one preview email; 'send' → every
//     family gets its own report.
//
// What it reads (all with the Admin SDK, nothing written to any of them):
//   officeFamilies, officeSettings/config, schedule_config/main   who, and how emails look
//   onlineCourses + pdfAnnotator (names only)                     the worksheets each class did
//   users/*/liveClassProgress/main                                the Ans Key live-lesson progress book
//   studentProfiles (officeId, name, level, tutorGaps)            Study Buddy's marked worksheets
//   studentAccess (parentEmail, email, children)                  which account is whose child
//   officeSettings/attend-<day>                                   🙋 who was absent (attendance-core.mjs)
// What it writes:
//   mail/polymath-office-weekly-<Sunday>-<familyId>               one per family per week, create-only
//   mail/polymath-office-weekly-preview-<Sunday>-<time>           the office's preview / copy
//   officeSettings/weekly-<Sunday>-<preview|send>                 the week's log (counts, who)
//   officeSettings/weeklyfam-<Sunday>-<familyId>                  each report as built (Reports tab preview)
//   officeSettings/weeklyReports                                  heartbeat, lastAutoWeek, lastRequestDone
//
// The Actions log of this PUBLIC repository is public, so it prints COUNTS only:
// never a name, an email address or an id.
//
//   node tools/weekly-reports.mjs [--dry-run] [--force-preview]
//   OFFICE_DEPS=<dir with node_modules/firebase-admin>, GOOGLE_APPLICATION_CREDENTIALS set
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as C from '../office/office-core.mjs';
import * as W from '../office/weekly-report-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const localRequire = createRequire(import.meta.url);
export const CONCEPT_TAGS_URL = 'https://polymathlc.github.io/anskey/concept-tags.js';

/** online/lesson-clock.js — the same rule Polymath Online and Ans Key use. */
export function lessonClock() { return localRequire(join(here, '..', 'online', 'lesson-clock.js')); }

/** Ans Key's concept-tags.js (names each slip and what to do about it), or null. */
export async function loadConceptTags(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(CONCEPT_TAGS_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const source = await res.text();
    const sandbox = { module: { exports: {} } };
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(source, sandbox, { timeout: 2000 });
    const api = sandbox.module.exports;
    return api && typeof api.label === 'function' ? api : null;
  } catch (e) { return null; }
}

const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

/** Everything the reports are built from. */
export async function gather(db, { fetchImpl } = {}) {
  const COL = C.COLLECTIONS;
  const [famSnap, setSnap, schedSnap, courseSnap, progSnap, profSnap, accSnap] = await Promise.all([
    db.collection(COL.families).get(),
    db.collection(COL.settings).doc('config').get(),
    db.collection('schedule_config').doc('main').get(),
    db.collection('onlineCourses').get(),
    db.collectionGroup('liveClassProgress').get(),
    db.collection('studentProfiles').select('officeId', 'name', 'level', 'tutorGaps').get(),
    db.collection('studentAccess').select('parentEmail', 'email', 'children', 'status').get()
  ]);
  const families = famSnap.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
  const settings = C.normalizeSettings(setSnap.exists ? setSnap.data() : {});
  const schedule = Object.assign({ slots: {} }, schedSnap.exists ? schedSnap.data() : {});
  const courses = courseSnap.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
  const books = [];
  progSnap.docs.forEach(d => {
    const x = d.data() || {};
    try { books.push(x.json ? JSON.parse(x.json) : x); } catch (e) { /* a broken book is skipped */ }
  });
  const profiles = profSnap.docs.map(d => ({ uid: d.id, data: d.data() || {} }));
  const access = {};
  accSnap.docs.forEach(d => { access[d.id] = d.data() || {}; });

  // The names of the worksheets the classes use (names only, never the pages).
  const ids = [...new Set(courses.flatMap(c => (Array.isArray(c.worksheetIds) ? c.worksheetIds : [])).filter(id => typeof id === 'string' && id))];
  const docNames = {};
  for (const group of chunk(ids, 100)) {
    const refs = group.map(id => db.collection('pdfAnnotator').doc(id));
    const snaps = await db.getAll(...refs, { fieldMask: ['name'] });
    snaps.forEach(s => { if (s.exists) docNames[s.id] = String((s.data() || {}).name || ''); });
  }
  const tags = await loadConceptTags(fetchImpl);
  return {
    families, settings, schedule, courses, docNames, tags,
    live: W.liveRowsByRoster(books),
    practice: W.practiceByRoster(profiles, access, families),
    counts: { families: families.length, courses: courses.length, worksheets: ids.length, books: books.length, profiles: profiles.length, tags: !!tags }
  };
}

/** 🙋 The week's attendance records: { day: normalized } (missing days are simply absent). */
export async function loadAttendance(db, win) {
  const ids = W.weekAttendanceIds(win);
  const refs = ids.map(id => db.collection(C.COLLECTIONS.settings).doc(id));
  let snaps;
  try { snaps = typeof db.getAll === 'function' ? await db.getAll(...refs) : await Promise.all(refs.map(r => r.get())); }
  catch (e) { snaps = await Promise.all(refs.map(r => r.get())); }
  const docs = [];
  snaps.forEach(s => { if (s && s.exists) docs.push(Object.assign({}, s.data() || {}, { id: s.id })); });
  return W.attendanceDocs(docs);
}

/** Every family's report for a week. */
export function buildReports(data, weekly, win, now, clock = lessonClock()) {
  const ctx = { schedule: data.schedule, courses: data.courses, docNames: data.docNames, live: data.live, practice: data.practice,
    tags: data.tags, clock, win, now, weekly, attendance: data.attendance || {} };
  return data.families.map(f => W.familyReport(f, ctx));
}

/** One check. Returns a summary (counts only). */
export async function runWeekly({ db, FieldValue, now = Date.now(), dryRun = false, forcePreview = false, log = console.log, fetchImpl, clock }) {
  const COL = C.COLLECTIONS;
  const ref = db.collection(COL.settings).doc(W.WEEKLY_DOC);
  const snap = await ref.get();
  const raw = snap.exists ? snap.data() : {};
  const weekly = W.normalizeWeekly(raw);
  let plan = W.weeklyPlan(raw, now);
  if (forcePreview) plan = { act: true, kind: 'preview', auto: false, weekKey: W.weekKeyFor(now), why: 'Preview run by hand from GitHub Actions.' };
  const stamp = async (extra) => {
    if (dryRun) return;
    await ref.set(Object.assign({ lastCheckAt: FieldValue.serverTimestamp() }, extra || {}), { merge: true });
  };
  log('Weekly reports: ' + plan.why);
  if (!plan.act) {
    // A request that cannot be carried out is closed, so it is not retried every half hour.
    await stamp(plan.staleRequest ? { lastRequestDone: plan.staleRequest, lastResult: plan.why, lastRunAt: FieldValue.serverTimestamp() } : {});
    return { plan };
  }
  // Mark a "now" request as taken before the slow part, so two checks never both act on it.
  if (plan.requestId && !dryRun) {
    const taken = await db.runTransaction(async t => {
      const s = await t.get(ref);
      const cur = W.normalizeWeekly(s.exists ? s.data() : {});
      if (cur.lastRequestDone === plan.requestId) return false;
      t.set(ref, { lastRequestDone: plan.requestId, requestTakenAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!taken) { log('That request was already taken by another check.'); return { plan, skipped: true }; }
  }

  const win = W.weekWindow(plan.weekKey, now);
  const data = await gather(db, { fetchImpl });
  data.attendance = await loadAttendance(db, win);
  const reports = buildReports(data, weekly, win, now, clock || lessonClock());
  const withReport = reports.filter(r => !r.empty);
  const ready = withReport.filter(r => r.to.length);
  log('Read ' + data.counts.families + ' families, ' + data.counts.courses + ' classes, ' + data.counts.books + ' live-lesson books, '
    + data.counts.profiles + ' Study Buddy rows' + (data.counts.tags ? '' : ' (concept tags not loaded: plain names used)') + '.');
  log(withReport.length + ' families have something to report; ' + ready.length + ' have an email address.');

  const sent = [], already = [], failed = [];
  if (plan.kind === 'send') {
    for (const r of ready) {
      const msg = W.weeklyEmail(r, data.settings, weekly, win);
      const id = W.weeklyMailId(plan.weekKey, r.familyId);
      if (dryRun) { sent.push(r.familyId); continue; }
      try {
        await db.collection('mail').doc(id).create(W.weeklyMail(r, msg, data.settings, { weekKey: plan.weekKey, sentBy: plan.auto ? 'weekly-auto' : 'weekly-office' }));
        sent.push(r.familyId);
      } catch (e) {
        // ALREADY_EXISTS: this family was already sent this week's report.
        if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) already.push(r.familyId);
        else failed.push(r.familyId + ': ' + String(e && e.message || e).slice(0, 120));
      }
    }
    log('Emailed ' + sent.length + ' families; ' + already.length + ' already had this week\'s report; ' + failed.length + ' failed.');
  }

  if (!dryRun) {
    // Each report as built, for the office's 👁 preview, and the week's log.
    const writes = [];
    withReport.forEach(r => {
      const msg = W.weeklyEmail(r, data.settings, weekly, win);
      writes.push([db.collection(COL.settings).doc(W.familyLogId(plan.weekKey, r.familyId)), {
        kind: W.WEEKLY_FAMILY_KIND, weekKey: plan.weekKey, familyId: r.familyId, parentName: r.parentName, to: r.to,
        subject: msg.subject, html: msg.html, builtAt: now, runKind: plan.kind,
        sent: sent.includes(r.familyId) || already.includes(r.familyId)
      }]);
    });
    writes.push([db.collection(COL.settings).doc(W.weekLogId(plan.weekKey, plan.kind)),
      W.weekLog(plan.weekKey, win, reports, { kind: plan.kind, auto: plan.auto, by: plan.auto ? 'weekly-auto' : (weekly.request && weekly.request.by) || 'office', at: now, sent, already, failed })]);
    for (const group of chunk(writes, 400)) {
      const batch = db.batch();
      group.forEach(([docRef, value]) => batch.set(docRef, value));
      await batch.commit();
    }
    // The office's copy: a preview, or a record of what went out.
    const copy = plan.kind === 'send'
      ? W.previewEmail(reports, data.settings, weekly, win, { mode: 'sent', sentCount: sent.length, already: already.length, failed: failed.length })
      : W.previewEmail(reports, data.settings, weekly, win, { mode: weekly.mode });
    if (plan.kind === 'preview' || sent.length || failed.length) {
      await db.collection('mail').doc(W.previewMailId(plan.weekKey, now)).set(
        C.officeMail(W.previewRecipients(data.settings), { subject: copy.subject, html: copy.html, text: copy.text },
          { kind: 'weekly-preview', weekKey: plan.weekKey, sentBy: plan.auto ? 'weekly-auto' : 'weekly-office' }, Object.assign({}, data.settings, { copyAdmin: false })));
    }
  }
  const result = plan.kind === 'send'
    ? 'Emailed ' + sent.length + ' famil' + (sent.length === 1 ? 'y' : 'ies') + ' their report for ' + W.weekLabel(win) + (already.length ? ' (' + already.length + ' already had it)' : '') + (failed.length ? '; ' + failed.length + ' failed' : '') + '.'
    : 'Emailed the office a preview of ' + ready.length + ' report' + (ready.length === 1 ? '' : 's') + ' for ' + W.weekLabel(win) + '.';
  await stamp(Object.assign({ lastRunAt: FieldValue.serverTimestamp(), lastResult: result, lastWeek: plan.weekKey, lastKind: plan.kind },
    plan.auto ? { lastAutoWeek: plan.weekKey } : {}));
  log(result.replace(/for .*?\./, 'this week.'));
  return { plan, reports, sent, already, failed, result };
}

/* ─── Command line (GitHub Actions) ─── */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const forcePreview = process.argv.includes('--force-preview');
  const require = createRequire(process.env.OFFICE_DEPS ? join(process.env.OFFICE_DEPS, 'noop.js') : import.meta.url);
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'mathgen--app' });
  const db = admin.firestore();
  try {
    const res = await runWeekly({ db, FieldValue: admin.firestore.FieldValue, dryRun, forcePreview });
    const summary = (dryRun ? '**Dry run — nothing written or sent.** ' : '') + res.plan.why + (res.reports ? ' ' + res.reports.filter(r => !r.empty).length + ' families with a report; emailed ' + (res.sent || []).length + '.' : '');
    if (process.env.GITHUB_STEP_SUMMARY) { const { appendFileSync } = await import('node:fs'); appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n'); }
    console.log(summary);
  } catch (e) {
    console.error('Weekly reports failed: ' + String(e && e.message || e).slice(0, 300));
    try { await db.collection(C.COLLECTIONS.settings).doc(W.WEEKLY_DOC).set({ lastRunAt: admin.firestore.FieldValue.serverTimestamp(), lastResult: 'Failed: ' + String(e && e.message || e).slice(0, 200) }, { merge: true }); } catch (x) { /* nothing more to do */ }
    process.exitCode = 1;
  }
}
