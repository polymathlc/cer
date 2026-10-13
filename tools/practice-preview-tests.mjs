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
