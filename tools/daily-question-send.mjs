// The Free Question of the Day: the morning emails (polymathlc.com.sg/question).
//
// Run by .github/workflows/daily-question.yml every morning at about 6 a.m.
// Singapore time, with two later backup runs in case GitHub starts a scheduled
// run late or skips one. It:
//   1. reads the settings (trialSettings/dailyQuestion): paused → nothing is sent;
//   2. pins today's questions (the same ones the website shows);
//   3. emails every active daily subscriber today's question(s) and yesterday's
//      worked answer(s), and on Saturdays every weekly subscriber the week's
//      questions with answers, within the daily cap (Gmail limits; see the core);
//   4. emails the centre one note listing parents who confirmed since the last one;
//   5. writes what it did to trialSettings/dailyQuestion/runs/{day}.
//
// Every email has an id that can only be written once a day per subscriber
// (polymath-qotd-daily-{day}-{id}), so the backup runs and manual runs can never
// send anybody the same email twice. The emails go through the `mail` collection
// and the Trigger Email extension, from admin@polymathlc.com.sg.
//
// This repository is public: the log shows counts only, never an address.
//
//   node tools/daily-question-send.mjs              send (between 6 a.m. and 9 p.m. Singapore time)
//   node tools/daily-question-send.mjs --dry-run    build every email from the real data, write and send nothing
//   node tools/daily-question-send.mjs --check      say what would happen, send nothing
//   OFFICE_DEPS=<dir with node_modules/firebase-admin>, GOOGLE_APPLICATION_CREDENTIALS set
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const localRequire = createRequire(import.meta.url);
const core = localRequire('../shop-function/functions/daily-question-core.js');
const { createDailyQuestionStore } = localRequire('../shop-function/functions/daily-question-store.js');

const {
  START_DAY, sgDayKey, sgHour, addDays, publicPair, planRun, readCap, dailyMail, weeklyMail, adminSummaryMail, mailId, stats, millis
} = core;

// The window in which a run may send: a run that GitHub starts very late must not
// send "today's" question in the middle of the night.
export const FIRST_HOUR = 6;
export const LAST_HOUR = 21;
// A short pause between emails, so the mail server is not handed hundreds at once.
export const GAP_MS = 250;

// The emails for one subscriber on one day, or null when there is nothing to send.
export function buildFor(entry, day, pairs) {
  const { sub, kind } = entry;
  if (kind === 'daily') {
    const yesterday = addDays(day, -1);
    return dailyMail(sub, day, pairs[day], yesterday >= START_DAY ? pairs[yesterday] : null);
  }
  const week = [];
  for (let i = 7; i >= 1; i--) {
    const d = addDays(day, -i);
    if (d >= START_DAY && pairs[d]) week.push({ day: d, pair: pairs[d] });
  }
  if (!week.length) return null;
  return weeklyMail(sub, day, week);
}

// One run. Everything outside (Firestore, the clock, the pause, the log) is passed
// in, so tools/daily-question-tests.mjs runs it against an in-memory store.
export async function runSend({ store, now = Date.now(), dryRun = false, check = false, force = false,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log, gapMs = GAP_MS }) {
  const day = sgDayKey(now), hour = sgHour(now);
  const summary = { day, sent: 0, daily: 0, weekly: 0, already: 0, heldBack: 0, failed: 0, skipped: '', adminNote: 0 };
  if (!force && (hour < FIRST_HOUR || hour >= LAST_HOUR)) {
    summary.skipped = 'outside-hours';
    log(`It is ${hour}:00 in Singapore; the questions are only sent between ${FIRST_HOUR}:00 and ${LAST_HOUR}:00. Nothing sent.`);
    return summary;
  }
  const settings = await store.getSettings();
  if (settings.mode === 'paused') {
    summary.skipped = 'paused';
    log('The Question of the Day emails are paused on the admin page. Nothing sent.');
    if (!dryRun && !check) await store.saveRun(day, { paused: true, checkedAt: now });
    return summary;
  }
  // Today's pair is pinned (written) by the website on the first visit; a dry run only reads.
  const todayPick = dryRun || check ? (await store.getDays([day]))[day] : await store.ensureDay(day, now);
  const earlier = [];
  for (let i = 1; i <= 7; i++) { const d = addDays(day, -i); if (d >= START_DAY) earlier.push(d); }
  const stored = earlier.length ? await store.getDays(earlier) : {};
  const pairs = { [day]: publicPair(day, todayPick, false) };
  for (const d of earlier) pairs[d] = publicPair(d, stored[d], true);

  const subscribers = await store.listSubscribers();
  const cap = readCap(settings);
  const plan = planRun(subscribers, day, cap);
  summary.heldBack = plan.heldBack.length;
  const totals = stats(subscribers, now);
  log(`${day}: ${totals.active} active subscriber(s) (${totals.daily} daily, ${totals.weekly} weekly), ${totals.pending} waiting to confirm. `
    + `${plan.send.length} due now, cap ${plan.cap}${plan.heldBack.length ? `, ${plan.heldBack.length} over the cap` : ''}.`);
  if (check) return Object.assign(summary, { due: plan.send.length });

  const startedAt = now;
  for (const entry of plan.send) {
    const message = buildFor(entry, day, pairs);
    if (!message) continue;
    if (dryRun) { summary[entry.kind]++; summary.sent++; continue; }
    const field = entry.kind === 'weekly' ? 'lastWeeklyDay' : 'lastDailyDay';
    try {
      const created = await store.createMailOnce(mailId(entry.kind, day, entry.sub.id), message);
      const patch = { [field]: day };
      if (created) {
        Object.assign(patch, { sentCount: (Number(entry.sub.sentCount) || 0) + 1, lastSentAt: Date.now() });
        summary[entry.kind]++;
        summary.sent++;
      } else summary.already++;
      await store.patchSubscriber(entry.sub.id, patch);
    } catch (error) {
      summary.failed++;
      log('One email could not be queued (' + String(error && error.code || 'error') + ').');
    }
    if (gapMs) await sleep(gapMs);
  }

  // The centre's note about new subscribers (they agreed to hear about classes).
  const fresh = subscribers.filter(s => s.status === 'active' && s.adminNotified === false);
  if (fresh.length) {
    summary.adminNote = fresh.length;
    if (!dryRun) {
      fresh.sort((a, b) => millis(a.confirmedAt) - millis(b.confirmedAt));
      await store.createMailOnce(mailId('admin', day, String(Math.floor(now / 60000))), adminSummaryMail(fresh, totals, day));
      for (const s of fresh) await store.patchSubscriber(s.id, { adminNotified: true });
    }
  }

  if (!dryRun) {
    const previous = (await store.getRun(day)) || {};
    await store.saveRun(day, {
      sent: (Number(previous.sent) || 0) + summary.sent, daily: (Number(previous.daily) || 0) + summary.daily,
      weekly: (Number(previous.weekly) || 0) + summary.weekly, heldBack: summary.heldBack, failed: (Number(previous.failed) || 0) + summary.failed,
      active: totals.active, cap, paused: false, startedAt: previous.startedAt || startedAt, finishedAt: Date.now(),
      questions: { math: todayPick.math, science: todayPick.science }
    });
  }
  log(`${dryRun ? 'Dry run: would send' : 'Sent'} ${summary.sent} email(s): ${summary.daily} daily, ${summary.weekly} weekly. `
    + `${summary.already} already sent earlier today. ${summary.failed} failed. ${summary.adminNote} new subscriber(s) in the centre's note.`);
  if (summary.heldBack) log(`::warning::${summary.heldBack} subscriber(s) did not get today's email because of the daily cap of ${cap}. Raise it on polymathlc.com.sg/question/#admin if the Gmail account allows.`);
  return summary;
}

async function openStore() {
  const require = createRequire(process.env.OFFICE_DEPS ? join(process.env.OFFICE_DEPS, 'noop.js') : import.meta.url);
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'mathgen--app' });
  return createDailyQuestionStore(admin.firestore(), admin.firestore.Timestamp);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (flags.some(flag => !['--dry-run', '--check', '--force'].includes(flag))) throw new Error('Use --dry-run, --check or --force.');
  const store = await openStore();
  const result = await runSend({ store, dryRun: flags.includes('--dry-run'), check: flags.includes('--check'), force: flags.includes('--force') });
  if (result.failed) process.exitCode = 1;
}
