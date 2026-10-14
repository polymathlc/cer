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
  assert.ok(html.includes('Try it yourself'));
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
