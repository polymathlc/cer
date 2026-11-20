// 🔴 polymathlc.com.sg/live — the student's door to Ans Key's live class (v1.0.0).
// Run: node --test tools/live-page-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const page = fs.readFileSync(new URL('../live/index.html', import.meta.url), 'utf8');
const script = page.match(/<script>\n([\s\S]*?)<\/script>/)[1];
function load() {
  const sandbox = { window: {}, console };
  vm.runInNewContext(script, sandbox);
  return sandbox.window.PolymathLive;
}
const L = load();
const H = L.helpers;
const CODE = 'famA_sA1.2.AbCdEfGhIjKlMnOp';

test('the page is a hidden student page with its version shown', () => {
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.equal(L.version, 'v1.1.0');
  assert.match(page, /id="version">v1\.1\.0</);
  const sitemap = fs.readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8');
  assert.doesNotMatch(sitemap, /polymathlc\.com\.sg\/live/, 'not in the sitemap');
});

test('Join opens Ans Key\'s live class on its own origin, even with JavaScript off', () => {
  assert.equal(H.ANSKEY_LIVE, 'https://polymathlc.github.io/anskey/?live');
  assert.match(page, /id="joinButton" href="https:\/\/polymathlc\.github\.io\/anskey\/\?live"/);
  assert.match(page, /id="pinButton" href="https:\/\/polymathlc\.github\.io\/anskey\/\?live&amp;pin"/);
  assert.equal(H.joinUrl(''), 'https://polymathlc.github.io/anskey/?live');
  assert.equal(H.joinUrl(CODE), 'https://polymathlc.github.io/anskey/?live=' + encodeURIComponent(CODE));
  assert.equal(H.joinUrl('not a code'), 'https://polymathlc.github.io/anskey/?live');
  assert.equal(H.pinUrl(), 'https://polymathlc.github.io/anskey/?live&pin');
});

test('a personal link code is read from ?c=, ?live=, ?code= or #, and nothing else', () => {
  assert.equal(H.codeFrom('?c=' + CODE, ''), CODE);
  assert.equal(H.codeFrom('?x=1&live=' + encodeURIComponent(CODE), ''), CODE);
  assert.equal(H.codeFrom('?code=' + CODE, ''), CODE);
  assert.equal(H.codeFrom('', '#' + CODE), CODE);
  assert.equal(H.codeFrom('?c=<script>', ''), '');
  assert.equal(H.codeFrom('?c=famA_sA1.2.short', ''), '', 'the MAC part must be 16 characters');
  assert.equal(H.codeFrom('?live', ''), '');
  assert.equal(H.cleanCode('%E0%A4%A'), '', 'a broken escape is not a code');
});

test('the "live now" dot reads the public mirror and decides nothing', () => {
  const doc = { fields: { open: { booleanValue: true }, slot: { stringValue: 'WED-2' }, startedAt: { integerValue: '5' }, letIn: { booleanValue: false } } };
  assert.deepEqual(JSON.parse(JSON.stringify(H.mirrorState(doc))), { open: true, slot: 'WED-2', letIn: false });
  assert.equal(H.mirrorState(null).open, false);
  assert.equal(H.fieldOf(doc, 'startedAt'), 5);
  assert.equal(H.slotWords('WED-2'), 'Wednesday lesson');
  assert.equal(H.slotWords(''), '');
  assert.match(page, /documents\/liveClassRooms\/main\?key=/);
});

test('the page says both Live and Zoom work, and what Live tracks', () => {
  assert.match(page, /Both get you into the same lesson with the same teacher/);
  for (const w of ['Attendance', 'Answers', 'Answer speed', 'Focus']) assert.ok(page.includes('<b>' + w + '</b>'), w);
  // Zoom's link (and its passcode) stays on My Polymath, behind the approval.
  assert.doesNotMatch(page, /zoom\.us/);
});

test('My Polymath links here', () => {
  const account = fs.readFileSync(new URL('../student/student-account.js', import.meta.url), 'utf8');
  assert.match(account, /var LIVE_LESSON_URL = 'https:\/\/polymathlc\.com\.sg\/live\/';/);
});

// 🎟 A trial lesson's own link (v1.1.0)
const TRIAL = 'ABC234.CnXQrsTQ2yQ7Xyyk';
test('🎟 a trial link is read from ?trial= by shape only, and only Ans Key and Zoom links are opened', () => {
  assert.equal(H.trialFrom('?trial=' + TRIAL), TRIAL);
  assert.equal(H.trialFrom('?x=1&trial=' + TRIAL), TRIAL);
  assert.equal(H.trialFrom('?trial=abc234.CnXQrsTQ2yQ7Xyyk'), '');
  assert.equal(H.trialFrom('?trial=' + TRIAL + 'x'), '');
  assert.equal(H.trialFrom('?c=' + TRIAL), '');
  assert.equal(H.codeFrom('?trial=' + TRIAL, ''), '', 'never kept as a personal link');
  assert.equal(H.safeJoin('https://polymathlc.github.io/anskey/?live&trial=' + TRIAL), 'https://polymathlc.github.io/anskey/?live&trial=' + TRIAL);
  assert.equal(H.safeJoin('https://evil.example/?live&trial=' + TRIAL), '');
  assert.equal(H.safeJoin('javascript:alert(1)'), '');
  assert.equal(H.safeZoom('https://us02web.zoom.us/j/1111111111'), 'https://us02web.zoom.us/j/1111111111');
  assert.equal(H.safeZoom('https://zoom.us.evil.example/j/1'), '');
  assert.equal(H.TRIAL_ENDPOINT, 'https://us-central1-mathgen--app.cloudfunctions.net/trialBooking');
});

test('🎟 the trial view waits, then goes in at 15 minutes before; ended and cancelled say so', () => {
  const start = Date.UTC(2026, 10, 23, 11);   // Monday 23 Nov 2026, 7pm in Singapore
  const live = { state: 'early', startsAtMs: start, opensAtMs: start - 15 * 60000, closesAtMs: start + 3 * 3600000,
    sessionLabel: 'Monday 23 November 2026, 7:00pm – 8:45pm', joinUrl: 'https://polymathlc.github.io/anskey/?live&trial=' + TRIAL };
  const wait = H.trialView(live, start - 3600000);
  assert.equal(wait.mode, 'wait');
  assert.equal(wait.left, 45 * 60000);
  assert.match(wait.text, /starts at 7:00pm \(Singapore time\)\. This page opens it for you at 6:45pm/);
  assert.equal(H.trialView(live, start - 15 * 60000).mode, 'go', 'the clock, not the server state, opens it');
  assert.equal(H.trialView({ ...live, state: 'open' }, start + 60000).mode, 'go');
  assert.equal(H.trialView({ ...live, state: 'open' }, start + 3 * 3600000 + 1).mode, 'stop');
  assert.match(H.trialView({ ...live, state: 'ended' }, start).title, /has ended/);
  assert.match(H.trialView({ ...live, state: 'cancelled', joinUrl: '' }, start).title, /cancelled/);
  assert.equal(H.trialView({ ...live, joinUrl: 'https://evil.example/' }, start).mode, 'stop', 'a bad join link is never followed');
  assert.equal(H.untilWords(2 * 86400000 + 3 * 3600000), '2 days 3 h');
  assert.equal(H.untilWords(3600000 + 5 * 60000), '1 h 5 min');
  assert.equal(H.untilWords(4 * 60000 + 10000), '4 min 10 s');
  assert.equal(H.sgTime(start - 15 * 60000), '6:45pm');
});

test('🎟 the trial page shows the live link first and Zoom as the backup, and builds it without innerHTML from the server', () => {
  assert.match(page, /Use the live lesson link first/);
  assert.match(page, /Zoom is the backup/);
  assert.match(page, /action: 'live', live: code/);
  const flow = page.slice(page.indexOf('function startTrial'));
  assert.doesNotMatch(flow.replace(/getElementById\('(compareLead|stepJoin)'\)\.innerHTML = '[^']*'/g, ''), /innerHTML/, 'server words go in with textContent');
});
