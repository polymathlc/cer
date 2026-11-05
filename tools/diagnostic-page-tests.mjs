// 🩺 The /diagnostic page's session list must be exactly what bookDiagnostic accepts.
// The page carries a copy of the date maths in shop-function/functions/diagnostic.js
// (between BEGIN DIAGNOSTIC DATES and END DIAGNOSTIC DATES); this cuts it out, runs
// it, and checks it against the server's own functions for many timetables and days.
//   node --test tools/diagnostic-page-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const server = require('../shop-function/functions/diagnostic.js');
const html = readFileSync(new URL('../diagnostic/index.html', import.meta.url), 'utf8');

function pageDates() {
  const block = html.match(/\/\/ BEGIN DIAGNOSTIC DATES[\s\S]*?\/\/ END DIAGNOSTIC DATES/);
  assert.ok(block, 'the page marks its date maths');
  const context = {};
  vm.createContext(context);
  vm.runInContext(block[0] + `
    ;globalThis.api = { DIAGNOSTIC_FIRST_DAY, DIAGNOSTIC_NOTICE_DAYS, DIAGNOSTIC_HORIZON_DAYS, SG_PUBLIC_HOLIDAYS,
      sgDayKey, fmtDayKey, sessionLabel, bookingWindow, diagnosticSlot, diagnosticSessions };`, context);
  return context.api;
}
const page = pageDates();
const plain = value => JSON.parse(JSON.stringify(value));

// The live timetable on 5 Nov 2026, plus edge cases.
const LIVE = { slots: {
  'TUE-1': { level: 'P5', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' },
  'TUE-3': { level: 'P6', subject: 'Math', mode: 'Physical', status: 'open', type: 'master', fee: '400' },
  'WED-3': { level: 'P6', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' },
  'THU-3': { level: 'P5', subject: 'Math', mode: 'Physical', status: 'open', type: 'master', fee: '400' },
  'MON-2': { level: 'P6', subject: 'Math', mode: 'Both', status: 'open' },
  'FRI-3': { level: '', subject: '', mode: 'Both', status: 'open', type: 'master' },
  'SAT-2': { level: 'P4', subject: 'Science', mode: 'Online', status: 'full', type: 'master' },
  'SAT-3': { level: 'P4', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' },
  'SUN-1': { level: 'P4', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' }
} };

test('the page and the server agree on the rules', () => {
  assert.equal(page.DIAGNOSTIC_FIRST_DAY, server.DIAGNOSTIC_FIRST_DAY);
  assert.equal(page.DIAGNOSTIC_FIRST_DAY, '2026-12-07', 'sessions start on 7 December 2026');
  assert.equal(page.DIAGNOSTIC_NOTICE_DAYS, server.DIAGNOSTIC_NOTICE_DAYS);
  assert.equal(page.DIAGNOSTIC_HORIZON_DAYS, server.DIAGNOSTIC_HORIZON_DAYS);
  assert.deepEqual(plain(page.SG_PUBLIC_HOLIDAYS), plain(server.SG_PUBLIC_HOLIDAYS));
});

test('the holiday list is the schedule page\'s own', () => {
  const schedule = readFileSync(new URL('../schedule/index.html', import.meta.url), 'utf8');
  const block = schedule.match(/const SG_PUBLIC_HOLIDAYS = (\{[\s\S]*?\});/);
  assert.ok(block);
  const list = vm.runInNewContext('(' + block[1] + ')');
  assert.deepEqual(plain(list), plain(server.SG_PUBLIC_HOLIDAYS));
});

test('the page lists exactly the sessions the server takes, day after day', () => {
  let day = Date.UTC(2026, 10, 1, 1);
  for (let i = 0; i < 120; i++, day += 3 * 86400000 + 3600000) {
    const pw = page.bookingWindow(day), sw = server.bookingWindow(day);
    assert.deepEqual(plain(pw), plain(sw));
    const pageList = plain(page.diagnosticSessions(LIVE, pw.first, pw.last));
    const serverList = plain(server.diagnosticSessions(LIVE, sw.first, sw.last));
    assert.deepEqual(pageList, serverList);
    for (const session of pageList.slice(0, 6)) {
      assert.doesNotThrow(() => server.checkSession(server.validateDiagnostic({ slot: session.slot, date: session.date,
        parentName: 'P', email: 'p@example.test', studentName: 'S', subject: 'Math', level: 'Primary 5' }), LIVE, day),
        session.slot + ' on ' + session.date + ' is accepted');
    }
  }
});

test('only open Master Classes with a class set are offered', () => {
  const list = page.diagnosticSessions(LIVE, '2026-12-01', '2026-12-31');
  assert.deepEqual([...new Set(list.map(s => s.slot))].sort(), ['SAT-3', 'THU-3', 'TUE-1', 'TUE-3', 'WED-3']);
  assert.ok(list.every(s => s.date >= '2026-12-01'));
  assert.ok(!list.some(s => s.date === '2026-12-25'));
  assert.equal(list[0].label, 'Tuesday 1 December 2026, 3:00pm – 4:45pm');
  assert.equal(page.sessionLabel('SAT-3', '2026-12-05'), 'Saturday 5 December 2026, 1:00pm – 2:45pm');
});

test('the page has what search and link previews need, and calls the right function', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<link rel="canonical" href="https:\/\/polymathlc\.com\.sg\/diagnostic\/">/);
  assert.match(head, /<meta name="description" content="[^"]{50,}"/);
  assert.match(head, /\$100/);
  assert.match(html, /const BOOK_URL = 'https:\/\/us-central1-mathgen--app\.cloudfunctions\.net\/bookDiagnostic';/);
  assert.match(html, /const DIAGNOSTIC_PAGE_VERSION = 'v\d+\.\d+\.\d+';/);
  for (const id of ['f-parent', 'f-email', 'f-student', 'f-level', 'subject-chips']) assert.ok(html.includes('id="' + id + '"'), id);
  const sitemap = readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8');
  assert.ok(sitemap.includes('<loc>https://polymathlc.com.sg/diagnostic/</loc>'), 'the page is in the sitemap');
});
