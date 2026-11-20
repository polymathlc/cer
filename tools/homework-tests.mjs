// Polymath Homework Helper — tests of the server's pure logic (homework-function/functions/core.js)
// and of the page's own helpers (homework/homework-core.mjs).
//   node --test tools/homework-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../homework-function/functions/core.js';
import * as page from '../homework/homework-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/* ───────────── who may use it ───────────── */

const token = (extra) => ({ uid: 'u1', email: 'kid@example.com', email_verified: true, firebase: { sign_in_provider: 'password' }, ...extra });
const record = (status, children) => ({ status, children: children || [{ name: 'Ann Tan', level: 'P5', subjects: 'both' }] });

test('only approved students, staff and the self-test may use the helper', () => {
  assert.equal(core.accessDecision(null, null).allowed, false);
  assert.equal(core.accessDecision(token(), null).reason, 'not-enrolled');
  assert.equal(core.accessDecision(token(), record('pending')).reason, 'pending');
  assert.equal(core.accessDecision(token(), record('revoked')).reason, 'paused');
  assert.equal(core.accessDecision(token(), record('weird')).allowed, false);
  const ok = core.accessDecision(token(), record('approved'));
  assert.equal(ok.allowed, true);
  assert.equal(ok.kind, 'student');
  assert.deepEqual(ok.children, [{ name: 'Ann Tan', level: 'P5', subjects: ['math', 'science'] }]);
  assert.equal(core.accessDecision(token({ firebase: { sign_in_provider: 'anonymous' } }), record('approved')).reason, 'guest');
});

test('staff need a verified email on the staff list', () => {
  assert.equal(core.accessDecision(token({ email: 'admin@polymathlc.com.sg' }), null).kind, 'staff');
  assert.equal(core.accessDecision(token({ email: 'Admin@PolymathLC.com.sg' }), null).kind, 'staff');
  assert.equal(core.accessDecision(token({ email: 'admin@polymathlc.com.sg', email_verified: false }), null).allowed, false);
  assert.equal(core.accessDecision(token({ email: 'someone@polymathlc.com.sg' }), null).allowed, false);
});

test('the staff list matches the access gate', () => {
  const gate = read('student/access-gate.js');
  const admins = JSON.parse(gate.match(/var ACCESS_ADMINS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.deepEqual([...core.ACCESS_ADMINS], admins);
  for (const email of core.STAFF_EMAILS) assert.ok(gate.includes("'" + email + "'"), email + ' is staff in the gate too');
});

test('the self-test account only works with the minted claim AND its own uid', () => {
  assert.equal(core.accessDecision({ uid: core.SELF_TEST_UID, homeworkSelfTest: true }, null).kind, 'selftest');
  assert.equal(core.accessDecision({ uid: 'someone-else', homeworkSelfTest: true }, null).allowed, false);
  assert.equal(core.accessDecision({ uid: core.SELF_TEST_UID, homeworkSelfTest: 'true' }, null).allowed, false);
  assert.equal(core.accessDecision({ uid: core.SELF_TEST_UID }, null).allowed, false);
});

test('children are cleaned: unknown levels become Other, names are trimmed', () => {
  const kids = core.childrenOf({ children: [{ name: '  Ben   Lim ', level: 'P9', subjects: 'math' }, null, { level: 'S2', subjects: 'x' }] });
  assert.deepEqual(kids, [
    { name: 'Ben Lim', level: 'Other', subjects: ['math'] },
    { name: 'Student', level: 'Other', subjects: [] },
    { name: 'Student', level: 'S2', subjects: [] },
  ]);
});

/* ───────────── daily allowance ───────────── */

test('Singapore day rolls over at midnight Singapore time, not UTC', () => {
  assert.equal(core.singaporeDay(Date.parse('2026-11-20T15:59:59Z')), 20261120);
  assert.equal(core.singaporeDay(Date.parse('2026-11-20T16:00:00Z')), 20261121);
});

test('the counter document lives in a server-only collection, one per account per day', () => {
  assert.equal(core.USAGE_COLLECTION, 'polymathEnquiryLimits');
  assert.equal(core.usageDocId('abc/../x', 20261120), 'homework-helper-abcx-20261120');
  // The enquiry rules block keeps every browser out of this collection.
  const rules = read('tools/enquiry-rules.mjs');
  assert.match(rules, /'polymathEnquiryLimits'/);
});

test('allowance: photos and replies are counted separately and stop at the limit', () => {
  let usage = {};
  for (let i = 0; i < core.LIMITS.student.photos; i++) usage = core.takeUse('student', usage, 'photos');
  assert.equal(usage.photos, core.LIMITS.student.photos);
  assert.throws(() => core.takeUse('student', usage, 'photos'), (e) => e.status === 429 && e.code === 'daily-limit');
  // Replies still work after the photos are used up.
  usage = core.takeUse('student', usage, 'replies');
  assert.equal(usage.replies, 1);
  assert.deepEqual(core.allowanceView('student', usage), {
    photosLeft: 0, repliesLeft: core.LIMITS.student.replies - 1, photosLimit: core.LIMITS.student.photos, repliesLimit: core.LIMITS.student.replies,
  });
  assert.equal(core.giveBack({ photos: 0 }, 'photos').photos, 0);
  assert.equal(core.giveBack({ photos: 3 }, 'photos').photos, 2);
  assert.ok(core.LIMITS.staff.photos > core.LIMITS.student.photos);
  assert.ok(core.LIMITS.selftest.photos < core.LIMITS.student.photos);
});

/* ───────────── request checks ───────────── */

test('requests: a photo must be a real picture data URL of sensible size', () => {
  assert.throws(() => core.parseRequest(null), /JSON/);
  assert.throws(() => core.parseRequest({ mode: 'start' }), (e) => e.code === 'no-photo');
  assert.throws(() => core.parseRequest({ mode: 'start', imageDataUrl: 'data:text/html;base64,AAAA' }), (e) => e.code === 'not-a-photo');
  assert.throws(() => core.parseRequest({ mode: 'start', imageDataUrl: 'data:image/png;base64,' + 'A'.repeat(core.MAX_IMAGE_CHARS) }), (e) => e.status === 413);
  const ok = core.parseRequest({ mode: 'start', imageDataUrl: 'data:image/jpeg;base64,/9j/AAAA', note: 'Q3 please  ', childIndex: 1, level: 'P4' });
  assert.equal(ok.note, 'Q3 please');
  assert.equal(ok.childIndex, 1);
  assert.equal(core.parseRequest({ mode: 'start', imageDataUrl: 'data:image/png;base64,iVBOR', childIndex: 99 }).childIndex, 0);
  assert.equal(core.parseRequest({ mode: 'start', imageDataUrl: 'data:image/png;base64,iVBOR', level: 'P9' }).level, '');
  assert.throws(() => core.parseRequest({ mode: 'nope' }), (e) => e.code === 'bad-mode');
});

test('requests: a reply needs a session and a message; history is clipped', () => {
  assert.throws(() => core.parseRequest({ mode: 'reply', message: 'hi' }), (e) => e.code === 'no-session');
  assert.throws(() => core.parseRequest({ mode: 'reply', session: 'hw1.x', message: '   ' }), (e) => e.code === 'no-message');
  const history = Array.from({ length: 20 }, (_, i) => ({ who: i % 2 ? 'coach' : 'student', text: 'turn ' + i + ' ' + 'x'.repeat(2000) }));
  const r = core.parseRequest({ mode: 'reply', session: 'hw1.x', message: 'is it 12?', history, hintsSeen: '3' });
  assert.equal(r.history.length, core.MAX_HISTORY_TURNS);
  assert.ok(r.history.every((t) => t.text.length <= core.MAX_HISTORY_CHARS));
  assert.equal(r.history[0].text.startsWith('turn 12'), true);
  assert.equal(r.hintsSeen, 3);
});

test('bearer tokens', () => {
  assert.equal(core.bearerToken('Bearer abc.def.ghi-jkl_mnopqrstuvwxyz'), 'abc.def.ghi-jkl_mnopqrstuvwxyz');
  assert.equal(core.bearerToken('Basic abc'), '');
  assert.equal(core.bearerToken(''), '');
});

test('origins: the website, its www, the Pages origin and local tests only', () => {
  for (const o of ['https://polymathlc.com.sg', 'https://www.polymathlc.com.sg', 'https://polymathlc.github.io', 'http://127.0.0.1:5173', 'http://localhost']) assert.ok(core.originAllowed(o), o);
  for (const o of ['https://evil.example', 'https://polymathlc.com.sg.evil.example', '', 'null']) assert.equal(core.originAllowed(o), false, o);
});

/* ───────────── the prompts ───────────── */

test('the first prompt forbids the answer and asks for Singapore methods and JSON', () => {
  const body = core.buildStartBody({ imageDataUrl: 'data:image/png;base64,iVBOR', level: 'P4', note: 'Question 5', childName: 'Ann Tan' });
  assert.equal(body.model, core.DEFAULT_MODEL);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  const system = body.messages[0].content;
  assert.match(system, /Never give the final answer/);
  assert.match(system, /bar models/);
  assert.match(system, /Never use algebra with letters for Primary/);
  assert.match(system, /"answerTokens"/);
  const user = body.messages[1].content;
  assert.match(user[0].text, /Primary 4/);
  assert.match(user[0].text, /Question 5/);
  assert.match(user[0].text, /Their name is Ann\./, 'first name only');
  assert.equal(user[1].image_url.url, 'data:image/png;base64,iVBOR');
});

test('the reply prompt carries the secret answer to the AI, and tells it not to reveal it', () => {
  const session = { level: 'P3', subject: 'math', topic: 'Multiplication', question: 'A pen costs $3. How much do 4 pens cost?', finalAnswer: '$12', steps: [{ goal: 'Find the cost of 4 pens', hints: ['How much is one pen?'] }] };
  const body = core.buildReplyBody({ session, history: [{ who: 'coach', text: 'Try step 1.' }], message: 'just tell me', hintsSeen: 1 });
  const text = body.messages[1].content;
  assert.match(text, /SECRET correct answer \(do not reveal\): \$12/);
  assert.match(text, /Coach: Try step 1\./);
  assert.match(text, /"just tell me"/);
  assert.match(body.messages[0].content, /say kindly that you will not/);
});

/* ───────────── reading the AI and the answer guard ───────────── */

const AI_START = {
  needs: 'ok',
  subject: 'math',
  topic: 'Multiplication',
  question: 'A pen costs $3. How much do 4 pens cost?',
  encouragement: 'Great question, let us do it together!',
  steps: [
    { goal: 'Find the cost of 4 pens', hints: ['What does one pen cost?', 'Four pens means 4 groups of $3.', 'Work out 4 × 3. So the answer is $12.'] },
  ],
  checkIn: 'What is 4 groups of $3?',
  finalAnswer: '$12',
  answerTokens: ['12', '$12'],
};

test('cleaning: a good reply keeps its steps; a muddled one becomes "retake the photo"', () => {
  const clean = core.cleanStartReply(JSON.stringify(AI_START));
  assert.equal(clean.needs, 'ok');
  assert.equal(clean.steps.length, 1);
  assert.equal(clean.finalAnswer, '$12');
  const fenced = core.cleanStartReply('```json\n' + JSON.stringify(AI_START) + '\n```');
  assert.equal(fenced.question, AI_START.question);
  const empty = core.cleanStartReply({ needs: 'ok', steps: [] });
  assert.equal(empty.needs, 'unclear-photo');
  assert.match(empty.message, /take the photo again/);
  const several = core.cleanStartReply({ needs: 'pick-one' });
  assert.match(several.message, /more than one question/);
  assert.throws(() => core.cleanStartReply('not json at all'), /not readable/);
});

test('the answer guard blanks the final answer out of every hint, even when the AI slips', () => {
  const clean = core.cleanStartReply(AI_START);
  const { view, guarded } = core.studentView(clean);
  assert.equal(guarded, 1);
  assert.equal(view.steps[0].hints[2], 'Work out 4 × 3. So the answer is $?.');
  assert.ok(!JSON.stringify(view).includes('12'), 'no 12 anywhere the student sees');
  assert.equal(view.finalAnswer, undefined, 'the answer is not in the view');
  assert.equal(view.answerTokens, undefined);
  // Numbers given in the question are never hidden.
  assert.equal(view.steps[0].hints[1], 'Four pens means 4 groups of $3.');
});

test('the guard knows a number from a bigger number, decimals and fractions', () => {
  const pieces = core.guardPieces('12', ['12'], 'Some question');
  assert.equal(core.guardText('112 and 12.5 and 1.12 and 120', pieces).hits, 0);
  assert.equal(core.guardText('It is 12.', pieces).text, 'It is ?.');
  assert.equal(core.guardText('12 apples, (12)', pieces).text, '? apples, (?)');
  const frac = core.guardPieces('3/4', ['3/4'], 'Ali ate some cake');
  assert.equal(core.guardText('so you get 3 / 4 of it', frac).text, 'so you get ? of it');
  const money = core.guardPieces('$1,250.50', [], 'q');
  assert.equal(core.guardText('$1,250.50 left', money).text, '$? left');
});

test('the guard hides key words of a worded answer, but never words from the question', () => {
  const pieces = core.guardPieces('Evaporation', ['evaporation', 'water vapour'], 'Why does the puddle of water get smaller on a hot day?');
  assert.ok(pieces.includes('evaporation'));
  assert.ok(pieces.includes('water vapour'));
  assert.equal(core.guardText('This is called Evaporation, and the water vapour rises.', pieces).text, 'This is called …, and the … rises.');
  // "water" alone is in the question, so it is never hidden.
  assert.equal(core.guardText('Think about the water.', pieces).hits, 0);
  // Tiny or common words are never treated as the answer.
  assert.deepEqual(core.guardPieces('yes', ['the'], 'q'), []);
});

test('a reply: the answer is hidden unless the student wrote it themselves', () => {
  const session = { finalAnswer: '$12', answerTokens: ['12'], question: AI_START.question };
  const right = core.guardReply({ verdict: 'correct', message: 'Yes! $12 is right, because 4 × 3 = 12.', step: 1 }, session, 'I got $12');
  assert.equal(right.reply.verdict, 'correct');
  assert.match(right.reply.message, /\$12 is right/);
  const leak = core.guardReply({ verdict: 'not-yet', message: 'Not quite, the answer is 12.', step: 1 }, session, 'is it 10?');
  assert.equal(leak.reply.message, 'Not quite, the answer is ?.');
  assert.equal(leak.guarded, 1);
  // "Correct" without the student having written the number is not believed.
  const claimed = core.guardReply({ verdict: 'correct', message: 'Correct, it is 12!', step: 1 }, session, 'just tell me');
  assert.equal(claimed.reply.verdict, 'on-track');
  assert.equal(claimed.reply.message, 'Correct, it is ?!');
});

test('cleaning a reply keeps only known verdicts', () => {
  assert.equal(core.cleanReply('{"verdict":"correct","message":"Well done","step":2}').verdict, 'correct');
  assert.equal(core.cleanReply('{"verdict":"perfect","message":"ok"}').verdict, 'question');
  assert.throws(() => core.cleanReply('{"verdict":"correct"}'), /empty/);
});

/* ───────────── the sealed session ───────────── */

test('the session is sealed: unreadable, tamper-proof, tied to the account, and it expires', () => {
  const clean = core.cleanStartReply(AI_START);
  const payload = core.sessionPayload(clean, { uid: 'u1', level: 'P4', nowMs: 1000 });
  const sealed = core.sealSession(payload, 'server-secret');
  assert.match(sealed, /^hw1\.[A-Za-z0-9_-]+$/);
  assert.ok(!sealed.includes('12') || !Buffer.from(sealed.slice(4), 'base64url').toString('utf8').includes('$12'), 'the answer is not readable inside');
  const opened = core.openSession(sealed, 'server-secret', 'u1', 2000);
  assert.equal(opened.finalAnswer, '$12');
  assert.equal(opened.level, 'P4');
  assert.throws(() => core.openSession(sealed, 'server-secret', 'u2', 2000), (e) => e.code === 'bad-session', 'another account');
  assert.throws(() => core.openSession(sealed, 'other-secret', 'u1', 2000), (e) => e.code === 'bad-session', 'another key');
  assert.throws(() => core.openSession(sealed, 'server-secret', 'u1', 1000 + core.SESSION_TTL_MS + 1), (e) => e.code === 'bad-session', 'expired');
  const flipped = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A') + sealed.slice(-1);
  assert.throws(() => core.openSession(flipped, 'server-secret', 'u1', 2000), (e) => e.code === 'bad-session', 'tampered');
  assert.throws(() => core.openSession('nonsense', 'server-secret', 'u1', 2000), (e) => e.code === 'bad-session');
  assert.ok(sealed.length < core.MAX_SESSION_CHARS);
});

/* ───────────── the page's helpers ───────────── */

test('page: the allowance line reads naturally', () => {
  assert.equal(page.allowanceLine({ photosLeft: 15, photosLimit: 15 }), '15 photo questions left today');
  assert.equal(page.allowanceLine({ photosLeft: 1, photosLimit: 15 }), '1 photo question left today');
  assert.equal(page.allowanceLine({ photosLeft: 0, photosLimit: 15 }), 'No photo questions left today. It resets at midnight.');
  assert.equal(page.allowanceLine(null), '');
});

test('page: the picture is shrunk to fit, keeping its shape', () => {
  assert.deepEqual(page.fitSize(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(page.fitSize(1000, 3000, 1600), { width: 533, height: 1600 });
  assert.deepEqual(page.fitSize(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(page.fitSize(0, 0, 1600), { width: 1, height: 1 });
});

test('page: hint progress — one hint at a time, the next step opens after the last hint', () => {
  const steps = [{ goal: 'A', hints: ['a1', 'a2'] }, { goal: 'B', hints: ['b1'] }];
  let s = page.initialProgress(steps);
  assert.deepEqual(s, { step: 0, shown: [0, 0], done: [false, false] });
  s = page.revealHint(s, steps, 0);
  s = page.revealHint(s, steps, 0);
  s = page.revealHint(s, steps, 0);
  assert.deepEqual(s.shown, [2, 0], 'never more hints than there are');
  assert.equal(page.hintsSeen(s), 2);
  s = page.finishStep(s, steps, 0);
  assert.deepEqual(s, { step: 1, shown: [2, 0], done: [true, false] });
  s = page.finishStep(s, steps, 1);
  assert.equal(s.step, 1, 'the last step stays the current one');
  assert.equal(page.allStepsDone(s), true);
});

test('page: the conversation sent back is short and the right shape', () => {
  const turns = Array.from({ length: 12 }, (_, i) => ({ who: i % 2 ? 'coach' : 'student', text: 't' + i, verdict: 'x' }));
  const h = page.historyForServer(turns);
  assert.equal(h.length, 8);
  assert.deepEqual(h[0], { who: 'student', text: 't4' });
});

test('page: friendly words for each refusal', () => {
  assert.match(page.friendlyError({ code: 'pending' }), /waiting for approval/);
  assert.match(page.friendlyError({ status: 429, error: 'You have used today\'s 15 photo questions.' }), /15 photo questions/);
  assert.match(page.friendlyError(new TypeError('Failed to fetch')), /internet/);
  assert.match(page.friendlyError({}), /try again/i);
});

/* ───────────── wiring ───────────── */

test('the page calls the deployed function, and the deploy workflow checks the same address', () => {
  const services = read('homework/homework-services.js');
  const workflow = read('.github/workflows/deploy-homework.yml');
  const url = 'https://us-central1-mathgen--app.cloudfunctions.net/homeworkHelper';
  assert.ok(services.includes(url));
  assert.ok(workflow.includes(url));
  assert.ok(workflow.includes('--only functions:homework'));
  assert.match(read('homework-function/firebase.json'), /"codebase": "homework"/);
});

test('the function never adds a scheduled job (the deploy account cannot create one)', () => {
  const index = read('homework-function/functions/index.js');
  assert.ok(!/onSchedule|pubsub\.schedule/.test(index));
});

test('the page loads the access gate and stays out of search results', () => {
  const html = read('homework/index.html');
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.ok(html.includes('<script defer src="../student/access-gate.js?v=1.2.0" data-app="homework"></script>'));
});

test('the website sync leaves the function code behind', () => {
  assert.ok(read('.github/workflows/sync-website.yml').includes("--exclude='/homework-function/'"));
});
