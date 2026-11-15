// The afternoon-before reminder for /trial bookings (polymathlc.com.sg/trial).
//
// Run by .github/workflows/trial-reminders.yml every afternoon in Singapore
// (about 2 PM, with a second run about 4:30 PM to catch late bookings and a late
// or missed first run). Each booking whose online trial lesson is TOMORROW
// (Singapore), that is not cancelled and has not been reminded, gets one email
// from Polymath Learning Centre <admin@polymathlc.com.sg> through the Trigger
// Email extension (`mail` collection), with the Zoom link, the time, and the
// class's Current and Next worksheets as they stand now.
//
// "Once" is kept in Firestore, not here: trial-store.js sendReminder writes the
// email and the booking's reminderSentAtMs in one transaction, so two runs (or a
// run and an admin's "Send reminder now") can never both send.
//
//   node tools/trial-reminders.mjs [--dry-run]     (needs GOOGLE_APPLICATION_CREDENTIALS)
//   TRIAL_DEPS=<dir with node_modules/firebase-admin>
//
// The Actions logs are public: only counts are printed, never names or emails.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const T = require('../shop-function/functions/trial.js');
const { createTrialStore } = require('../shop-function/functions/trial-store.js');

export const PROJECT_ID = 'mathgen--app';
export const STORAGE_BUCKET = 'mathgen--app.firebasestorage.app';

// Sends every reminder due at `now`. Returns counts only.
export async function runReminders({ store, now = Date.now(), dryRun = false, log = console.log }) {
  const service = T.createTrialService({ store, http: {}, hashIp: () => '' });
  const bookings = await store.listBookings();
  const due = T.dueReminders(bookings, now);
  const result = { tomorrow: T.addDays(T.sgDayKey(now), 1), checked: bookings.length, due: due.length, sent: 0, skipped: 0, failed: 0, noZoom: 0, dryRun };
  const extrasBySlot = new Map();
  for (const booking of due) {
    try {
      if (!extrasBySlot.has(booking.slot)) extrasBySlot.set(booking.slot, await service.extrasFor(booking.slot));
      const extras = extrasBySlot.get(booking.slot);
      if (!extras.zoom.url) result.noZoom++;
      if (dryRun) continue;
      const outcome = await store.sendReminder(booking.code, b => T.reminderMail(b, extras.zoom, extras.materials, now),
        T.mailIdFor(booking.code, 'reminder'), now, { force: false, by: 'schedule' });
      if (outcome.sent) result.sent++;
      else result.skipped++;
    } catch (error) {
      result.failed++;
      log('A reminder could not be queued: ' + String(error && error.message || error).slice(0, 200).replace(/\S+@\S+/g, '[email]'));
    }
  }
  return result;
}

export function summary(result) {
  return `Trial reminders for lessons on ${result.tomorrow}: ${result.due} due, ${result.sent} sent, ${result.skipped} already sent, `
    + `${result.failed} failed${result.noZoom ? `, ${result.noZoom} without a Zoom link (set one on /trial/#admin)` : ''}`
    + `${result.dryRun ? ' (dry run, nothing sent)' : ''}.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--dry-run')) throw new Error('Use: node tools/trial-reminders.mjs [--dry-run]');
  const deps = createRequire(process.env.TRIAL_DEPS ? join(process.env.TRIAL_DEPS, 'noop.js') : import.meta.url);
  const admin = deps('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });
  const store = createTrialStore(admin.firestore(), admin.firestore.Timestamp, { bucket: null });
  const result = await runReminders({ store, dryRun: flags.includes('--dry-run') });
  const text = summary(result);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### ' + text + '\n');
  if (result.noZoom) console.log('::warning title=Trial reminders::' + result.noZoom + ' reminder(s) went out without a Zoom link. Add the class Zoom links on polymathlc.com.sg/trial/#admin.');
  if (result.failed) { console.log('::error title=Trial reminders::' + result.failed + ' reminder(s) could not be queued.'); process.exit(1); }
}
