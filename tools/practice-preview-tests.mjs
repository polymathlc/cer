// The home page's "Your next lightbulb moment" card and the schedule page's Sample Materials tab
// show ONE question, rendered by practice-preview.js. These pin that neither page grows its own copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PP = require('../practice-preview.js');
const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sched = readFileSync(new URL('../schedule/index.html', import.meta.url), 'utf8');

test('the card renders the shared question and its steps', () => {
  const html = PP.render();
  for (const line of PP.PREVIEW.question) assert.ok(html.includes(line), line);
  assert.equal((html.match(/lp-cer-row/g) || []).length, PP.PREVIEW.steps.length);
  assert.ok(PP.renderFloat().includes(PP.PREVIEW.float.text));
});

test('text is escaped', () => {
  const html = PP.render({ ...PP.PREVIEW, topic: '<b>x</b>', question: ['a & b'] });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;') && html.includes('a &amp; b'));
});

test('neither page hard-codes the question', () => {
  for (const [name, src] of [['home', home], ['schedule', sched]]) {
    assert.ok(!src.includes(PP.PREVIEW.question[0]), name + ' carries its own copy of the question');
    assert.ok(!src.includes(PP.PREVIEW.float.text), name + ' carries its own copy of the note');
  }
});

test('both pages mount the shared module', () => {
  assert.match(home, /data-practice-preview>/);
  assert.match(home, /data-practice-float>/);
  assert.match(home, /<script src="practice-preview\.js"><\/script>/);
  assert.match(sched, /data-practice-preview>/);
  assert.match(sched, /data-practice-float>/);
  assert.match(sched, /<script src="\.\.\/practice-preview\.js"><\/script>/);
});

test('both pages tilt the card the same way', () => {
  assert.match(home, /\.lp-preview \{[^}]*rotate\(var\(--pp-tilt/);
  assert.match(sched, /\.lp-preview \{[^}]*rotate\(var\(--pp-tilt/);
  assert.match(PP.TILT, /^-?\d+(\.\d+)?deg$/);
});

// ── The live Sample Materials questions (the teacher picks them on the schedule page) ──
const MCQ = { id: 'q1', title: 'Which material is the best conductor of heat?', level: 'P5', topic: 'Heat',
  blocks: [{ type: 'mcq', options: [{ id: 'a', text: 'Wood' }, { id: 'b', text: 'Copper' }, { id: 'c', text: 'Plastic' }] },
    { type: 'image', url: 'https://example.com/fig.png', caption: 'Figure 1' }] };
const CER = { id: 'q2', title: 'Why did the ice melt faster?', level: 'P4', topic: 'Matter', blocks: [{ type: 'cer' }] };

test('a live sample renders as the tilted card, numbered and with its options', () => {
  const html = PP.renderSample(MCQ, { index: 1, count: 3, href: '#x' });
  assert.ok(html.includes('Sample question 2 of 3'));
  assert.ok(html.includes('best conductor of heat'));
  for (const t of ['Wood', 'Copper', 'Plastic']) assert.ok(html.includes(t), t);
  assert.equal((html.match(/data-pp-go=/g) || []).length, 3);
  assert.ok(html.includes('Multiple choice'));
  assert.ok(html.includes('https://example.com/fig.png'));
  assert.ok(html.includes('More sample questions'));
});

test('a CER sample shows Claim, Evidence and Reasoning', () => {
  const html = PP.renderSample(CER);
  assert.ok(/Claim/.test(html) && /Evidence/.test(html) && /Reasoning/.test(html));
  assert.ok(html.includes('Sample question 1 of 1'));
  assert.ok(!html.includes('data-pp-go'), 'one question needs no dots');
});

test('a sample is escaped, and only https pictures are drawn', () => {
  const html = PP.renderSample({ title: '<script>alert(1)</script>', blocks: [{ type: 'image', url: 'javascript:alert(1)' }] });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('javascript:'));
});

test('usable keeps real questions, at most five', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: 'q' + i, title: 'Question ' + i, blocks: [] }));
  assert.equal(PP.usable(many).length, 5);
  assert.equal(PP.usable([null, {}, 'x']).length, 0);
  assert.equal(PP.usable(undefined).length, 0);
});

test('loadLive reads science first, falls back to math, and survives a dead network', async () => {
  const saved = globalThis.fetch;
  try {
    PP._reset();
    const asked = [];
    globalThis.fetch = async (url, init) => {
      const subject = JSON.parse(init.body).subject; asked.push(subject);
      return { ok: true, json: async () => ({ questions: subject === 'math' ? [MCQ] : [] }) };
    };
    const got = await PP.loadLive();
    assert.deepEqual(asked, ['science', 'math']);
    assert.equal(got.length, 1);

    PP._reset();
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.deepEqual(await PP.loadLive(), []);
  } finally { globalThis.fetch = saved; PP._reset(); }
});

// ── Answering in the card ──────────────────────────────────────────────────────────────────────
const LIVE = { id: 'q9', title: 'Which material conducts heat best?', level: 'P5', topic: 'Heat',
  blocks: [{ type: 'mcq', id: 'm1', options: [{ id: 'a', text: 'Wood' }, { id: 'b', text: 'Copper' }, { id: 'c', text: 'Plastic' }] }] };
const REVIEW = { mcq: [{ blockId: 'm1', correctId: 'b', options: [{ id: 'a', why: 'Wood is a poor conductor of heat.' }, { id: 'c', why: 'Plastic is an insulator.' }] }],
  explanation: 'Metals conduct heat well.', modelAnswer: 'Copper.' };

test('the loading state keeps the card shape and shows no old question', () => {
  const html = PP.renderLoading();
  assert.ok(html.includes('Loading a sample question'));
  assert.ok(html.includes('pp-skel'));
  assert.ok(html.includes('role="status"'));
  for (const line of PP.PREVIEW.question) assert.ok(!html.includes(line), 'old example leaked: ' + line);
});

test('a one-tap MCQ can be answered in the card', () => {
  assert.equal(PP.oneTap(LIVE), true);
  const html = PP.renderSample(LIVE, { index: 0, count: 2 });
  assert.equal((html.match(/data-pp-opt=/g) || []).length, 3);
  assert.ok(html.includes('Tap an answer to check it.'));
});

test('a wrong answer shows the correct one and why the others are not', () => {
  const state = { responses: { m1: 'a' }, pending: false, result: { verdict: 'incorrect', feedback: 'Copper is a metal.', review: REVIEW } };
  const html = PP.renderSample(LIVE, { index: 0, count: 2, state });
  assert.ok(html.includes('Not quite.'));
  assert.ok(html.includes('Correct answer'));
  assert.ok(html.includes('Why not 1:') && html.includes('poor conductor'));
  assert.ok(html.includes('Why not 3:') && html.includes('insulator'));
  assert.ok(html.includes('Explanation') && html.includes('Metals conduct heat well.'));
  assert.ok(html.includes('data-pp-retry'));
  assert.ok(html.includes('Next question'));
});

test('a right answer is marked and still explains the others', () => {
  const state = { responses: { m1: 'b' }, pending: false, result: { verdict: 'correct', feedback: '', review: REVIEW } };
  const html = PP.renderSample(LIVE, { state });
  assert.ok(html.includes('Correct, well done.'));
  assert.ok(html.includes('Your answer · correct'));
  assert.ok(html.includes('Why not 1:'));
});

test('an uncertain verdict shows no review', () => {
  const state = { responses: { m1: 'a' }, pending: false, result: { verdict: 'uncertain', feedback: 'We could not mark that.', review: REVIEW } };
  const html = PP.renderSample(LIVE, { state });
  assert.ok(!html.includes('Why not'));
  assert.ok(!html.includes('Explanation'));
  assert.ok(!html.includes('data-pp-retry'));
});

test('checkAnswer asks the service exactly as Sample Materials does', async () => {
  const saved = globalThis.fetch;
  try {
    PP._reset();
    const bodies = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body); bodies.push(body);
      if (body.action === 'questions') return { ok: true, json: async () => ({ token: 'tok', questions: [LIVE] }) };
      return { ok: true, json: async () => ({ verdict: 'correct', review: REVIEW }) };
    };
    const r = await PP.checkAnswer(LIVE, { m1: 'b' });
    assert.equal(r.verdict, 'correct');
    const check = bodies.find(b => b.action === 'check');
    assert.deepEqual(check, { action: 'check', subject: 'science', token: 'tok', questionId: 'q9', responses: { m1: 'b' } });
  } finally { globalThis.fetch = saved; PP._reset(); }
});

test('the questions are remembered in the browser for an instant next visit', async () => {
  const savedFetch = globalThis.fetch, savedLs = globalThis.localStorage;
  const store = {};
  try {
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    PP._reset();
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ token: 'tok', questions: [LIVE] }) });
    await PP.loadLive();
    assert.ok(store[PP.CACHE_KEY], 'nothing was written');
    const c = PP.readCache();
    assert.equal(c.questions.length, 1);
    assert.equal(c.token, 'tok');
    assert.equal(c.fresh, false);
  } finally { globalThis.fetch = savedFetch; globalThis.localStorage = savedLs; PP._reset(); }
});

test('both pages start the sample fetch from the head', () => {
  for (const [name, src] of [['home', home], ['schedule', sched]]) {
    assert.ok(src.includes('window.__ppEarly='), name + ' has no early fetch');
    assert.match(src, /<link rel="preconnect" href="https:\/\/us-central1-mathgen--app\.cloudfunctions\.net"/);
  }
});
