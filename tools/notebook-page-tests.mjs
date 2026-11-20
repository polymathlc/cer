// 📒 The mistake notebook page (notebook/notebook-app.js): its pure helpers, and the
// page's promises — the access gate, the endpoint it talks to, the server's own copy
// of the admin list.
//   node --test tools/notebook-page-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const App = require('../notebook/notebook-app.js');
const P = App.pure;
const HTML = fs.readFileSync(path.join(root, 'notebook/index.html'), 'utf8');
const SERVER = require('../shop-function/functions/notebook.js');
const { ORIGINS } = require('../shop-function/functions/service.js');
const T0 = Date.UTC(2026, 10, 20, 5, 0, 0);
const DAY = 86400000;

test('escaping: a question can never write markup into the page', () => {
  assert.equal(P.esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(P.escLines('a\n<b>'), 'a<br>&lt;b&gt;');
  const html = P.clozeHtml(['Plants make ', 0, ' "food"'], 'g', ['<x>'], false);
  assert.ok(html.includes('value="&lt;x&gt;"'));
  assert.ok(html.includes('&quot;food&quot;'));
  assert.ok(!/<x>/.test(html));
});

test('dates in Singapore time, and the days left in the week', () => {
  assert.equal(P.sgDate(T0), '20 Nov');
  assert.equal(P.whenWords(T0, T0), 'today');
  assert.equal(P.whenWords(T0 - DAY, T0), 'yesterday');
  assert.equal(P.whenWords(T0 - 3 * DAY, T0), '3 days ago');
  assert.equal(P.whenWords(T0 - 10 * DAY, T0), '10 Nov');
  assert.equal(P.daysLeft(T0 + 2.5 * DAY, T0), 3);
  assert.equal(P.daysLeft(T0 - 1, T0), 0);
});

test('usernames sign in the same way as My Polymath', () => {
  assert.deepEqual(P.loginCandidates(''), []);
  assert.deepEqual(P.loginCandidates('a@b.com'), ['a@b.com']);
  const list = P.loginCandidates('AmyT');
  assert.equal(list[0], 'amyt@students.sciencequest.app');
  assert.equal(list.length, 9);
});

const ITEMS = [
  { id: 'L-1-a', status: 'open', src: 'live', sub: 'science' },
  { id: 'W-b', status: 'fixed', src: 'worksheet', sub: 'math' },
  { id: 'W-c', status: 'mastered', src: 'worksheet', sub: 'science' },
  { id: 'W-d', status: 'open', src: 'worksheet', sub: '', hidden: true }
];
test('the chips narrow the list; removed mistakes only show under Removed', () => {
  assert.deepEqual(P.filterItems(ITEMS, { status: 'open' }).map(i => i.id), ['L-1-a']);
  assert.deepEqual(P.filterItems(ITEMS, { status: 'all' }).map(i => i.id), ['L-1-a', 'W-b', 'W-c']);
  assert.deepEqual(P.filterItems(ITEMS, { status: 'all', src: 'worksheet' }).map(i => i.id), ['W-b', 'W-c']);
  assert.deepEqual(P.filterItems(ITEMS, { status: 'all', sub: 'science' }).map(i => i.id), ['L-1-a', 'W-c']);
  assert.deepEqual(P.filterItems(ITEMS, { status: 'removed' }).map(i => i.id), ['W-d']);
  const c = P.counts(ITEMS);
  assert.equal(c.all, 3); assert.equal(c.removed, 1); assert.equal(c.open, 1); assert.equal(c.worksheet, 2);
});

test('the quiz picks up where it was left, and knows when it is finished', () => {
  const week = { ids: ['L-1-a', 'W-b', 'W-c', 'gone'], done: { 'W-b': 1 } };
  const q = P.quizState(week, ITEMS);
  assert.equal(q.size, 3, 'a mistake no longer in the notebook is not counted');
  assert.equal(q.done, 1);
  assert.deepEqual(q.next, ['L-1-a', 'W-c']);
  assert.equal(q.finished, false);
  const all = P.quizState({ ids: ['W-b'], done: { 'W-b': 0 } }, ITEMS);
  assert.equal(all.finished, true);
  assert.equal(all.right, 0);
  assert.equal(P.quizState({ ids: [], done: {} }, ITEMS).finished, false);
});

test('the right answer in words, for every kind of question', () => {
  assert.equal(P.answerWords({ kind: 'mcq' }, { answerText: 'B. Root' }), 'B. Root');
  assert.equal(P.answerWords({ kind: 'cloze' }, { full: 'Plants make food.' }), 'Plants make food.');
  assert.equal(P.answerWords({ kind: 'blank' }, { accepted: ['18'] }), '18');
  assert.equal(P.answerWords({ kind: 'open' }, { model: 'Because…' }), 'Because…');
  assert.equal(P.answerWords({ kind: 'open' }, {}), '');
});

test('every server refusal has words a child can read', () => {
  for (const code of ['sign-in-required', 'not-approved', 'access-paused', 'child-not-found', 'mistake-not-found', 'temporarily-unavailable']) {
    assert.ok(P.friendlyError(code).length > 10, code);
  }
  assert.match(P.friendlyError('???'), /try again/);
});

test('the page talks to the deployed function, and the function lets this page in', () => {
  assert.equal(P.ENDPOINT, 'https://us-central1-mathgen--app.cloudfunctions.net/mistakeNotebook');
  assert.ok(ORIGINS.includes('https://polymathlc.com.sg'));
  assert.ok(ORIGINS.includes('https://polymathlc.github.io'));
  const index = fs.readFileSync(path.join(root, 'shop-function/functions/index.js'), 'utf8');
  assert.match(index, /exports\.mistakeNotebook = onRequest\(/);
});

test('the page loads Firebase sign-in, its script, and the access gate last', () => {
  assert.ok(HTML.includes('<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>'));
  assert.ok(HTML.includes('<script src="notebook-app.js?v=' + App.version + '"></script>'));
  assert.match(HTML, /<script defer src="\.\.\/student\/access-gate\.js\?v=1\.1\.0" data-app="notebook"><\/script>\s*<\/body>/);
  assert.ok(HTML.includes('<meta name="robots" content="noindex">'));
  assert.ok(HTML.includes('v' + App.version));
});

test('the server\'s admins and staff are the same people as the access gate\'s', () => {
  const gate = fs.readFileSync(path.join(root, 'student/access-gate.js'), 'utf8');
  const admins = JSON.parse(gate.match(/var ACCESS_ADMINS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.deepEqual([...SERVER.ACCESS_ADMINS], admins);
  for (const e of SERVER.STAFF) assert.ok(gate.includes("'" + e + "'"), e);
});
