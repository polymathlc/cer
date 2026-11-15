// Offline checks for the /trial page: the page's date maths matches the server's,
// the page stays hidden (noindex, not in the sitemap, not linked from the site),
// the Firestore rules patch for its private collections, and the afternoon-before
// reminder run.
//
//   node --test tools/trial-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { addTrialRules, TRIAL_RULE, TRIAL_COLLECTIONS, trialRuleTests, trialPreservedTests, publishTrialRules } from './trial-rules.mjs';
import { addShopGuardRules } from './shopguard-rules.mjs';
import { addOfficeRules } from './office-rules.mjs';
import { addEnquiryRules } from './enquiry-rules.mjs';
import { addOnlineRules } from './online-rules.mjs';
import { addCsRules } from './cs-rules.mjs';
import { runReminders, summary } from './trial-reminders.mjs';
import { ESSENTIAL_COLLECTIONS } from './firebase-backup-core.mjs';

const require = createRequire(import.meta.url);
const T = require('../shop-function/functions/trial.js');
const root = new URL('..', import.meta.url);
const read = rel => readFileSync(new URL(rel, root), 'utf8');
const page = read('trial/index.html');

/* ============================== The page ============================== */
function pageDates() {
  const block = page.match(/\/\/ BEGIN TRIAL DATES[\s\S]*?\/\/ END TRIAL DATES/);
  assert.ok(block, 'the page has its TRIAL DATES block');
  const context = { LEVELS: ['P3', 'P4', 'P5', 'P6'] };
  vm.createContext(context);
  vm.runInContext(block[0] + '\n;globalThis.__t = { TRIAL_HORIZON_DAYS, SG_PUBLIC_HOLIDAYS, trialSlotIds, trialSessions, bookingWindow, sessionLabel, slotLabel };', context);
  return context.__t;
}
const CONFIGS = [
  { slots: {
    'MON-1': { level: 'P4', subject: 'Math', mode: 'Both', status: 'closed', type: 'regular' },
    'MON-2': { level: 'P6', subject: 'Math', mode: 'Both', status: 'open' },
    'MON-3': { level: 'P6', subject: 'Science', mode: 'Both', status: 'open', type: 'regular' },
    'TUE-1': { level: 'P5', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' },
    'TUE-3': { level: 'P6', subject: 'Math', mode: 'Both', status: 'open', type: 'master' },
    'WED-3': { level: 'P6', subject: 'Science', mode: 'Physical', status: 'open', type: 'regular' },
    'FRI-1': { level: 'P5', subject: 'Science', mode: 'Both', status: 'open', type: 'regular' },
    'FRI-3': { level: '', subject: '', mode: 'Both', status: 'open', type: 'regular' },
    'SAT-1': { level: 'P6', subject: 'Science', mode: 'Online', status: 'open', type: 'regular' },
    'SAT-2': { level: 'P4', subject: 'Science', mode: 'Online', status: 'open' },
    'SUN-1': { level: 'P4', subject: 'Science', mode: 'Online', status: 'open' },
    'THU-2': { level: 'P7', subject: 'Math', mode: 'Both', status: 'open' }
  } },
  { slots: {} }, {}, null
];

test('the page lists exactly the lessons the server accepts', () => {
  const p = pageDates();
  assert.equal(p.TRIAL_HORIZON_DAYS, T.TRIAL_HORIZON_DAYS);
  assert.deepEqual(JSON.parse(JSON.stringify(p.SG_PUBLIC_HOLIDAYS)), JSON.parse(JSON.stringify(T.SG_PUBLIC_HOLIDAYS)));
  for (const now of [Date.UTC(2026, 10, 15, 3), Date.UTC(2026, 11, 20, 17), Date.UTC(2027, 0, 31, 15, 59)]) {
    assert.deepEqual(JSON.parse(JSON.stringify(p.bookingWindow(now))), T.bookingWindow(now));
    for (const config of CONFIGS) {
      assert.deepEqual([...p.trialSlotIds(config)], T.trialSlotIds(config));
      const w = T.bookingWindow(now);
      assert.deepEqual(JSON.parse(JSON.stringify(p.trialSessions(config, w.first, w.last))), T.trialSessions(config, w.first, w.last));
    }
  }
  assert.equal(p.slotLabel('SAT-2'), 'Saturday 11:00am – 12:45pm');
});

test('the page and the server name the same admins', () => {
  const list = page.match(/const ADMIN_EMAILS = (\[[^\]]*\]);/);
  assert.ok(list);
  assert.deepEqual(JSON.parse(list[1].replace(/'/g, '"')), [...T.TRIAL_ADMINS]);
  const office = read('office/office-core.mjs').match(/export const OFFICE_ADMINS = (\[[^\]]*\]);/);
  assert.deepEqual(JSON.parse(office[1].replace(/'/g, '"')), [...T.TRIAL_ADMINS], 'the same admins as Polymath Office');
});

test('the page calls the trial functions and holds nothing private', () => {
  assert.match(page, /const BOOK_URL = API \+ 'trialBooking';/);
  assert.match(page, /const ADMIN_URL = API \+ 'trialAdmin';/);
  assert.match(page, /const TRIAL_PAGE_VERSION = 'v\d+\.\d+\.\d+';/);
  assert.ok(!/plctrial['"]\s*[;,)]/.test(page.replace(/The password is the default \(plctrial\)/, '')), 'the password is never checked in the page');
  assert.ok(!/firestore-compat|collection\(['"]trial/.test(page), 'the page never reads Firestore trial data directly');
  for (const view of ['gate-view', 'book-view', 'link-view', 'lesson-view', 'admin-section']) assert.ok(page.includes('id="' + view + '"'), view);
});

test('the page stays hidden: noindex, not in the sitemap or llms.txt, linked from no other page', () => {
  assert.match(page.slice(0, page.indexOf('</head>')), /<meta name="robots" content="noindex">/);
  assert.ok(!read('sitemap.xml').includes('/trial'), 'not in the sitemap');
  assert.ok(!read('llms.txt').includes('/trial'), 'not in llms.txt');
  assert.ok(!read('robots.txt').includes('/trial'), 'robots.txt does not name it either');
  const linking = [];
  const walk = dir => {
    for (const name of readdirSync(new URL(dir, root))) {
      if (['.git', 'node_modules', 'tools', 'trial', 'vendor', '.github', '.claude'].includes(name)) continue;
      const rel = dir + name;
      let stat;
      try { stat = statSync(new URL(rel, root)); } catch { continue; }
      if (stat.isDirectory()) walk(rel + '/');
      else if (/\.(html|js|mjs)$/.test(name) && !rel.includes('-function/') && stat.size < 4e6) {
        const text = readFileSync(new URL(rel, root), 'utf8');
        if (/href=["'][^"']*\/trial\/?["'#]|polymathlc\.com\.sg\/trial/.test(text)) linking.push(rel);
      }
    }
  };
  walk('');
  assert.deepEqual(linking, []);
});

/* ============================== Rules ============================== */
const original = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isLiveServerPath() {
      return request.path[3] in ['cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'];
    }
    // BEGIN permanent-student-question-history-v1
    function isPermanentStudentHistoryPath() { return false; }
    match /{document=**} {
      allow read, write: if !isPermanentStudentHistoryPath() && !isLiveServerPath();
    }
  }
}`;
const live = addShopGuardRules(addOfficeRules(addCsRules(addOnlineRules(addEnquiryRules(original)))));
const PREDICATE = ' && !isPolymathTrialPath()';

test('rules: one block and one predicate, on every shape of the catch-all', () => {
  for (const source of [original, live]) {
    const updated = addTrialRules(source);
    assert.notEqual(updated, source);
    assert.equal(updated.replace(TRIAL_RULE, '').replace(PREDICATE + ';', ';'), source);
    assert.match(updated, /&& !isPolymathTrialPath\(\);\n    \}/);
    assert.ok(updated.includes(TRIAL_RULE + '    match /{document=**} {'));
    assert.equal(addTrialRules(updated), updated, 'installing twice changes nothing');
  }
  for (const name of TRIAL_COLLECTIONS) assert.ok(TRIAL_RULE.includes("'" + name + "'"));
});

test('rules: the other tools still install over ours, and ours over theirs', () => {
  const ours = addTrialRules(addEnquiryRules(original));
  const theirs = addShopGuardRules(addOfficeRules(addCsRules(addOnlineRules(ours))));
  assert.equal(addTrialRules(theirs), theirs);
  assert.ok(theirs.includes('!isPolymathTrialPath()'));
});

test('rules: unrecognised, partial and duplicate rules fail closed', () => {
  assert.throws(() => addTrialRules('nonsense'), /Unrecognized/);
  assert.throws(() => addTrialRules(original.replace('allow read, write: if', 'allow read: if')), /catch-all/);
  assert.throws(() => addTrialRules(original.replace('match /{document=**}', 'match /trialCodes/{x} { allow read: if true; }\n    match /{document=**}')), /partial/);
  const installed = addTrialRules(original);
  assert.throws(() => addTrialRules(installed.replace('// END polymath-trial-v1', '// END polymath-trial-v1\n    // BEGIN polymath-trial-v1')), /Ambiguous/);
});

test('rules: every trial path is closed to everyone, and look-alikes keep their access', () => {
  const cases = trialRuleTests();
  assert.ok(cases.length >= 100);
  assert.ok(cases.every(c => c.expectation === 'DENY'));
  assert.ok(TRIAL_COLLECTIONS.every(name => cases.some(c => c.request.path.endsWith('/' + name) && c.request.method === 'list')));
  const preserved = trialPreservedTests(live);
  assert.ok(preserved.some(c => c.request.path.endsWith('/trial_bookings/probe') && c.expectation === 'ALLOW'));
});

test('rules: test and read modes never publish', async () => {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push([options.method || 'GET', path]);
    if (path.endsWith('/releases/cloud.firestore')) return { rulesetName: 'projects/mathgen--app/rulesets/abc', updateTime: 't1' };
    if (path === 'projects/mathgen--app/rulesets/abc') return { source: { files: [{ name: 'firestore.rules', content: live }] } };
    if (path.endsWith(':test')) return { testResults: options.body.testSuite.testCases.map(() => ({ state: 'SUCCESS' })) };
    throw new Error('unexpected ' + path);
  };
  const read = await publishTrialRules({ request, readOnly: true });
  assert.equal(read.changeNeeded, true);
  const dry = await publishTrialRules({ request });
  assert.equal(dry.changed, false);
  assert.ok(dry.validated > 100);
  assert.ok(calls.every(([method, path]) => method === 'GET' || path.endsWith(':test')));
});

test('the nightly backup keeps the trial records with the business records', () => {
  for (const name of TRIAL_COLLECTIONS) assert.ok(ESSENTIAL_COLLECTIONS.includes(name), name);
});

/* ============================== Reminders ============================== */
function fakeStore(bookings) {
  const sent = [];
  return {
    sent,
    async listBookings() { return bookings; },
    async loadContext() { return { config: { slots: { 'MON-3': { level: 'P6', subject: 'Science', mode: 'Both', status: 'open' } } },
      settings: { zoomDefault: 'https://zoom.us/j/123' } }; },
    async loadCourses() { return [{ id: 'c', level: 'P6', subject: 'science', day: 'Monday', slot: 2, worksheetIds: ['a', 'b'], currentIndex: 0 }]; },
    async loadSheets(ids) { return Object.fromEntries(ids.map(id => [id, { name: 'Worksheet ' + id, storagePath: 'pdf-annotator/' + id + '.pdf', pageCount: 3 }])); },
    async sendReminder(code, build, mailId, now) {
      const b = bookings.find(x => x.code === code);
      if (b.reminderSentAtMs) return { sent: false, reason: 'already-sent' };
      const mail = build(b);
      sent.push({ code, mailId, mail });
      b.reminderSentAtMs = now;
      return { sent: true, to: mail.to[0] };
    }
  };
}
const booking = (code, date, extra = {}) => ({ code, kind: 'booking', viewToken: 'v'.repeat(24), slot: 'MON-3', lessonDate: date,
  sessionLabel: T.sessionLabel('MON-3', date), classLevel: 'P6', classSubject: 'Science', parentName: 'P', studentName: 'S',
  email: code.toLowerCase() + '@example.test', status: 'booked', ...extra });

test('the reminder run emails tomorrow\'s lessons once, with the Zoom link and worksheets, and logs counts only', async () => {
  const now = Date.UTC(2026, 10, 22, 6, 7);   // Sunday 22 Nov, 2:07pm in Singapore
  const bookings = [booking('AAAAAA', '2026-11-23'), booking('BBBBBB', '2026-11-30'), booking('CCCCCC', '2026-11-23', { status: 'cancelled' }),
    booking('DDDDDD', '2026-11-23', { reminderSentAtMs: 1 }), { code: 'EEEEEE', kind: 'link', slot: 'MON-3', email: 'x@example.test', lessonDate: '' }];
  const store = fakeStore(bookings);
  const logs = [];
  const result = await runReminders({ store, now, log: line => logs.push(line) });
  assert.deepEqual(result, { tomorrow: '2026-11-23', checked: 5, due: 1, sent: 1, skipped: 0, failed: 0, noZoom: 0, dryRun: false });
  assert.equal(store.sent.length, 1);
  const { mail, mailId } = store.sent[0];
  assert.match(mailId, /^polymath-trial-AAAAAA-reminder-[0-9a-f]{12}$/);
  assert.equal(mail.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.match(mail.message.text, /https:\/\/zoom\.us\/j\/123/);
  assert.match(mail.message.text, /Current worksheet: Worksheet a/);
  assert.match(mail.message.text, /Next worksheet: Worksheet b/);
  assert.equal((await runReminders({ store, now: now + 9000000 })).sent, 0, 'the 4:30pm run sends nothing again');
  assert.equal(logs.length, 0);
  assert.ok(!summary(result).includes('@'));
  assert.equal((await runReminders({ store: fakeStore([booking('FFFFFF', '2026-11-23')]), now, dryRun: true })).sent, 0);
});
