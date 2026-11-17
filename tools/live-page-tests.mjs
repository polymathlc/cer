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
  assert.equal(L.version, 'v1.0.0');
  assert.match(page, /id="version">v1\.0\.0</);
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
