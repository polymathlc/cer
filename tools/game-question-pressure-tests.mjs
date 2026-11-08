import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pressure = require('../game-question-pressure.js');

test('consecutive wrong grades escalate and the fifth defeats even a fully healed run', () => {
  const run = pressure.create();
  const hits = [];
  for (let i = 0; i < 5; i++) {
    const result = pressure.answer(run, false, 100);
    hits.push(result.damage);
    const hp = result.fatal ? 0 : Math.max(0, 100 - result.damage);
    assert.equal(hp > 0, i < 4);
    assert.equal(result.streak, i + 1);
  }
  assert.deepEqual(hits, [8, 16, 28, 45, 100]);
  assert.equal(run.failed, true);
});

test('a correct grade breaks the consecutive streak, and the next miss starts at eight percent', () => {
  const run = pressure.create();
  for (let i = 0; i < 4; i++) pressure.answer(run, false, 100);
  const reset = pressure.answer(run, true, 100);
  assert.equal(reset.reset, true);
  assert.equal(reset.damage, 0);
  assert.equal(run.wrongStreak, 0);
  assert.match(reset.message, /streak reset/);
  assert.equal(pressure.answer(run, false, 100).damage, 8);
});

test('pressure is isolated to its run and a restart has no old failure state', () => {
  const old = pressure.create(), other = pressure.create();
  for (let i = 0; i < 5; i++) pressure.answer(old, false, 80);
  assert.deepEqual(other, { wrongStreak: 0, failed: false });
  assert.equal(pressure.answer(other, false, 80).damage, 7);
  assert.deepEqual(pressure.create(), { wrongStreak: 0, failed: false });
});

test('small base-health pools lose at least one point and penalties use maximum rather than remaining health', () => {
  const run = pressure.create();
  assert.deepEqual(Array.from({ length: 4 }, () => pressure.answer(run, false, 20).damage), [2, 4, 6, 9]);
  assert.equal(pressure.answer(pressure.create(), false, 1).damage, 1);
  assert.equal(pressure.answer(pressure.create(), false, 0.5).damage, 1);
});

test('terminal pressure cannot reset or charge additional damage from a late answer', () => {
  const run = pressure.create();
  for (let i = 0; i < 5; i++) pressure.answer(run, false, 100);
  for (const grade of [true, false]) {
    const result = pressure.answer(run, grade, 100);
    assert.equal(result.applied, false);
    assert.equal(result.damage, 0);
    assert.equal(result.fatal, true);
    assert.equal(run.wrongStreak, 5);
  }
});

test('ungraded or malformed events fail before mutating the run', () => {
  const run = pressure.create();
  for (const grade of [null, undefined, 'false', 0]) assert.throws(() => pressure.answer(run, grade, 100), TypeError);
  for (const max of [0, -1, NaN, Infinity, undefined]) assert.throws(() => pressure.answer(run, false, max), RangeError);
  assert.deepEqual(run, { wrongStreak: 0, failed: false });
});

test('browser pages and CommonJS consumers receive the same immutable policy', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../game-question-pressure.js', import.meta.url), 'utf8'), { window });
  assert.deepEqual(Array.from(window.GameQuestionPressure.rates), Array.from(pressure.rates));
  assert.equal(window.GameQuestionPressure.answer(window.GameQuestionPressure.create(), false, 100).damage, 8);
  assert.ok(Object.isFrozen(window.GameQuestionPressure));
  assert.ok(Object.isFrozen(pressure.rates));
  assert.match(pressure.rules, /fifth ends the run/);
});
