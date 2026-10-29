// 🤖 Polymath Office — the monthly autopilot.
//
// Runs every morning from GitHub Actions (.github/workflows/office-autopilot.yml,
// 09:07 Singapore time) with the repository's FIREBASE_SERVICE_ACCOUNT. It does
// NOTHING unless Settings → Autopilot is switched on at polymathlc.com.sg/office:
//
//   off     writes a heartbeat and stops
//   review  on the invoice day: prepares every billable family's invoice for the
//           month (exactly what "Prepare invoices" does) and emails the office a
//           summary to check and send
//   send    on the invoice day: prepares them AND emails every family that has
//           an email address (QR inline and attached, Save-QR button); families
//           without email are listed in the summary for the WhatsApp queue
//
// Safety rails, all of them deliberate:
//   • It prepares a month ONCE (officeSettings/autopilot.lastPeriod), and only
//     within AUTOPILOT_WINDOW_DAYS of the invoice day — a family added on the 20th
//     is never billed by a machine for a month they may already have paid at
//     enrolment.
//   • Invoice ids are family_month, created in a transaction, so a run racing the
//     admin can never make a second invoice; it only ever SENDS invoices still in
//     draft that it created itself on this run.
//   • It never touches payments, never reminds anybody, never deletes.
//   • --dry-run reads everything, prints what it would do, and writes nothing.
//
// Invoices come from office/office-core.mjs — the same buildInvoice the page uses.
//
//   node tools/office-autopilot.mjs [--dry-run]       (needs GOOGLE_APPLICATION_CREDENTIALS)
//   OFFICE_DEPS=<dir with node_modules/firebase-admin and qrcode>
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as C from '../office/office-core.mjs';

export const AUTOPILOT_WINDOW_DAYS = 3;
const random = n => Array.from({ length: n }, () => randomBytes(4).readUInt32LE(0));

// What today's run should do, decided from the settings and the calendar alone.
export function autopilotPlan(settings, state, todayKey) {
  const s = C.normalizeSettings(settings);
  const period = todayKey.slice(0, 7);
  const day = Number(todayKey.slice(8, 10));
  if (s.autopilot === 'off') return { act: false, period, why: 'Autopilot is off.' };
  if (state && state.lastPeriod === period) return { act: false, period, why: C.periodLabel(period) + ' was already prepared.' };
  if (day < s.invoiceDay) return { act: false, period, why: 'Waiting for day ' + s.invoiceDay + '.' };
  if (day > s.invoiceDay + AUTOPILOT_WINDOW_DAYS) return { act: false, period, why: 'Past the invoice-day window for ' + C.periodLabel(period) + ' — prepare it from the office if it is still needed.' };
  return { act: true, period, mode: s.autopilot, why: 'Invoice day for ' + C.periodLabel(period) + '.' };
}

// One run. `db` is a Firestore (Admin SDK) instance; `FieldValue` its FieldValue;
// `qrPng(payload)` returns base64 PNG. Returns a summary and writes a heartbeat.
export async function runAutopilot({ db, FieldValue, now = Date.now(), dryRun = false, qrPng, log = console.log }) {
  const COL = C.COLLECTIONS;
  const todayKey = C.sgDayKey(now);
  const ts = () => FieldValue.serverTimestamp();
  const [setSnap, apSnap, schedSnap] = await Promise.all([
    db.collection(COL.settings).doc('config').get(),
    db.collection(COL.settings).doc('autopilot').get(),
    db.collection('schedule_config').doc('main').get()
  ]);
  const settings = C.normalizeSettings(setSnap.exists ? setSnap.data() : {});
  const state = apSnap.exists ? apSnap.data() : {};
  const schedule = Object.assign({ slots: {} }, schedSnap.exists ? schedSnap.data() : {});
  const plan = autopilotPlan(settings, state, todayKey);
  const heartbeat = async (extra) => {
    if (dryRun) return;
    await db.collection(COL.settings).doc('autopilot').set(Object.assign({ lastRunAt: ts(), lastRunDay: todayKey }, extra), { merge: true });
  };
  log('Autopilot ' + todayKey + ': ' + plan.why);
  if (!plan.act) { await heartbeat({ result: plan.why }); return { plan, created: [], sent: [], noEmail: [] }; }

  const period = plan.period;
  const famSnap = await db.collection(COL.families).get();
  const families = famSnap.docs.map(d => C.normalizeFamily(Object.assign({}, d.data(), { id: d.id })));
  const billable = families.filter(C.familyIsBillable);
  const created = [], skipped = [], issues = [];
  for (const fam of billable) {
    const ref = db.collection(COL.invoices).doc(C.invoiceDocId(fam.id, period));
    const preview = C.buildInvoice(fam, period, { schedule, settings, today: todayKey });
    if (!(preview.total > 0)) { skipped.push(fam.parentName + ': nothing to bill' + (preview.issues.length ? ' (' + preview.issues.join('; ') + ')' : '')); continue; }
    if (preview.issues.length) issues.push(fam.parentName + ': ' + preview.issues.join('; '));
    if (dryRun) { const exists = (await ref.get()).exists; if (!exists) created.push(preview); continue; }
    const token = C.newToken(random);
    const made = await db.runTransaction(async t => {
      const [iSnap, fSnap] = await Promise.all([t.get(ref), t.get(db.collection(COL.families).doc(fam.id))]);
      if (iSnap.exists || !fSnap.exists) return null;
      const inv = C.buildInvoice(Object.assign({}, fSnap.data(), { id: fSnap.id }), period, { schedule, settings, today: todayKey });
      if (!(inv.total > 0)) return null;
      t.set(ref, Object.assign({}, inv, { linkToken: token, createdAt: ts(), updatedAt: ts(), createdBy: 'autopilot' }));
      t.set(db.collection(COL.links).doc(token), Object.assign(C.publicInvoiceDoc(inv, settings), { updatedAt: ts() }));
      if (inv.creditUsed > 0) t.update(db.collection(COL.families).doc(fam.id), { credit: C.round2((Number(fSnap.data().credit) || 0) - inv.creditUsed), updatedAt: ts() });
      return Object.assign({}, inv, { linkToken: token });
    });
    if (made) created.push(made);
  }
  log('Prepared ' + created.length + ' invoice(s); ' + skipped.length + ' skipped.');

  const sent = [], noEmail = [], failed = [];
  if (plan.mode === 'send') {
    for (const inv of created) {
      const fam = families.find(f => f.id === inv.familyId);
      const to = fam ? C.familyEmails(fam) : [];
      if (!to.length) { noEmail.push(inv.parentName); continue; }
      if (dryRun) { sent.push(inv.parentName); continue; }
      try {
        const payUrl = C.payLink(inv.linkToken);
        const png = await qrPng(C.buildPayNow(inv.total, inv.reference, { uen: settings.uen, merchant: settings.merchant }));
        const msg = C.invoiceEmail(inv, settings, { payUrl, qrCid: 'paynowqr' });
        msg.attachments = [C.qrAttachment(png, inv.reference, 'paynowqr')];
        const id = C.mailDocId('invoice', inv.id, now);
        await db.collection('mail').doc(id).set(C.officeMail(to, msg, { kind: 'invoice', invoiceId: inv.id, familyId: inv.familyId, period, sentBy: 'autopilot' }, settings));
        await db.collection(COL.invoices).doc(inv.id).update({ sends: FieldValue.arrayUnion({ via: 'email', at: now, mailId: id, to, by: 'autopilot' }), sentAt: ts(), status: 'sent', updatedAt: ts() });
        sent.push(inv.parentName);
      } catch (e) { failed.push(inv.parentName + ': ' + (e.message || e)); }
    }
    log('Emailed ' + sent.length + '; ' + noEmail.length + ' have no email; ' + failed.length + ' failed.');
  } else {
    created.forEach(inv => { const fam = families.find(f => f.id === inv.familyId); if (!fam || !C.familyEmails(fam).length) noEmail.push(inv.parentName); });
  }

  const total = C.round2(created.reduce((s, i) => s + i.total, 0));
  const title = plan.mode === 'send'
    ? '🤖 ' + C.periodLabel(period) + ' invoices sent — ' + sent.length + ' emailed'
    : '🤖 ' + C.periodLabel(period) + ' invoices are ready for you to check';
  const lines = [
    created.length + ' invoice(s) prepared, ' + C.money(total) + ' in all.',
    plan.mode === 'send' ? sent.length + ' emailed to parents.' : 'Nothing has been sent to parents yet — open the office, check them, then press Email.',
    noEmail.length ? noEmail.length + ' without an email (send them from the WhatsApp queue): ' + noEmail.join(', ') : '',
    ...issues.map(i => 'Check: ' + i),
    ...skipped.map(i => 'Not billed: ' + i),
    ...failed.map(i => 'Failed: ' + i)
  ].filter(Boolean);
  if (!dryRun && created.length + skipped.length + failed.length > 0) {
    const to = [...new Set([C.OFFICE_ADMINS[0], settings.replyTo])];
    const summary = C.adminSummaryEmail({ title, intro: 'The autopilot ran on ' + C.prettyDate(todayKey) + '.', lines }, settings);
    await db.collection('mail').doc(C.mailDocId('autopilot', period, now)).set(C.officeMail(to, summary, { kind: 'autopilot', period, sentBy: 'autopilot' }, Object.assign({}, settings, { copyAdmin: false })));
  }
  await heartbeat({ result: title.replace(/^🤖 /, ''), lastPeriod: period, created: created.length, sent: sent.length, noEmail: noEmail.length, failed: failed.length });
  lines.forEach(l => log('  ' + l));
  return { plan, created, sent, noEmail, failed, skipped, issues };
}

/* ─── Command line (GitHub Actions) ─── */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const require = createRequire(process.env.OFFICE_DEPS ? join(process.env.OFFICE_DEPS, 'noop.js') : import.meta.url);
  const admin = require('firebase-admin');
  const QR = require('qrcode');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'mathgen--app' });
  const db = admin.firestore();
  const qrPng = async payload => (await QR.toBuffer(payload, { errorCorrectionLevel: 'M', margin: 4, width: 480, color: { dark: '#000000', light: '#ffffff' } })).toString('base64');
  try {
    const res = await runAutopilot({ db, FieldValue: admin.firestore.FieldValue, dryRun, qrPng });
    const summary = (dryRun ? '**Dry run — nothing written.** ' : '') + res.plan.why + ' Prepared ' + res.created.length + ', emailed ' + (res.sent || []).length + '.';
    if (process.env.GITHUB_STEP_SUMMARY) { const { appendFileSync } = await import('node:fs'); appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n'); }
    console.log(summary);
  } catch (e) {
    console.error('Autopilot failed: ' + (e && e.message || e));
    try { await db.collection(C.COLLECTIONS.settings).doc('autopilot').set({ lastRunAt: admin.firestore.FieldValue.serverTimestamp(), result: 'Failed: ' + String(e && e.message || e).slice(0, 200) }, { merge: true }); } catch (x) { /* nothing more to do */ }
    process.exitCode = 1;
  }
}
