import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {findRapidDuplicates, rapidDuplicateSimilarity, rapidDuplicateFingerprint, rapidDuplicatePairCurrent, rapidDuplicateThreshold} from '../rapid-duplicates.js';

const stem = 'A metal ball was placed in the container of warm water. Explain what happens to the size of the ball.';
function record(id, patch = {}) {
  const q = {id, text: stem};
  return {key: 'vetting:' + id, id, where: 'vetting', removable: true, title: id,
    createdAt: '2026-01-01', question: q, fingerprint: rapidDuplicateFingerprint(q), shape: {text: stem}, ...patch};
}
function changed(id, text, extras = {}) { return record(id, {shape: {text, ...extras}}); }
test('threshold is an explicit whole percentage from 50 through 100', () => {
  assert.equal(rapidDuplicateThreshold('90'), 90);
  for (const value of [49, 101, '', 'hello', 89.5, NaN]) assert.throws(() => rapidDuplicateThreshold(value));
});
test('published bank questions are always keepers, even when newer', () => {
  const bank = record('bank', {key: 'bank:bank', where: 'bank', removable: false, createdAt: '2026-09-16'});
  const result = findRapidDuplicates([record('one'), bank, record('two')], 100);
  assert.equal(result.pairs.length, 2);
  assert.ok(result.pairs.every(pair => pair.keep === bank && pair.remove.where === 'vetting'));
  const marked = {...bank, removable: true};
  assert.ok(findRapidDuplicates([record('one'), marked, {...marked, key: 'bank:another'}], 100).pairs.every(pair => pair.remove.where === 'vetting'));
});
test('all matching vetting copies are removed except one stable oldest keeper', () => {
  const old = record('original', {createdAt: '2025-01-01'});
  const result = findRapidDuplicates([record('second'), record('third'), old], 100);
  assert.deepEqual(result.pairs.map(pair => pair.remove.id), ['second', 'third']);
  assert.ok(result.pairs.every(pair => pair.keep.id === 'original'));
});
test('session scope can compare against older vetting but never remove it', () => {
  const outside = record('outside', {removable: false});
  const result = findRapidDuplicates([record('incoming'), outside], 90);
  assert.equal(result.pairs.length, 1); assert.equal(result.pairs[0].keep.id, 'outside');
});
test('near match obeys chosen percentage including its exact boundary', () => {
  const a = changed('a', 'red green blue yellow orange purple black white gray brown');
  const b = changed('b', 'red green blue yellow orange purple black white pink cyan');
  const score = rapidDuplicateSimilarity(a, b);
  assert.ok(score > 70 && score < 90);
  assert.equal(findRapidDuplicates([a, b], 70).pairs.length, 1);
  assert.equal(findRapidDuplicates([a, b], 90).pairs.length, 0);
  assert.equal(findRapidDuplicates([record('a'), record('b')], 100).pairs.length, 1);
});
test('similarity chains never delete a question that does not match its surviving keeper', () => {
  const a = changed('a', 'red green blue yellow orange purple black white gray brown');
  const b = changed('b', 'red green blue yellow orange purple black white pink cyan');
  const c = changed('c', 'red green blue yellow orange purple silver gold pink cyan');
  assert.ok(rapidDuplicateSimilarity(a, b) >= 65 && rapidDuplicateSimilarity(b, c) >= 65 && rapidDuplicateSimilarity(a, c) < 65);
  const result = findRapidDuplicates([a, b, c], 65);
  assert.deepEqual(result.pairs.map(pair => pair.remove.id), ['b']);
  assert.deepEqual(result.keepers.map(q => q.id), ['a', 'c']);
});
test('changed numbers, decimal precision, fractions and units never qualify solely from prose', () => {
  for (const [a, b] of [['24 g', '24 kg'], ['24 g', '25 g'], ['0.4 cm', '0.5 cm'], ['1/2 m', '1/3 m'], ['20 °C', '30 °C']]) {
    assert.equal(rapidDuplicateSimilarity(changed('a', stem + ' The reading is ' + a), changed('b', stem + ' The reading is ' + b)), 0);
  }
});
test('negation and opposing scientific directions remain separate questions', () => {
  for (const [a, b] of [['is a conductor', 'is not a conductor'], ['increases', 'decreases'], ['least', 'most'], ['before', 'after'], ['hot', 'cold']]) {
    assert.equal(rapidDuplicateSimilarity(changed('a', stem + ' ' + a), changed('b', stem + ' ' + b)), 0);
  }
});
test('quantity order is significant even when the token bags are identical', () => {
  assert.equal(rapidDuplicateSimilarity(changed('a', stem + ' A is 20 g and B is 30 g'), changed('b', stem + ' A is 30 g and B is 20 g')), 0);
});
test('different diagrams, options, correct answers or levels stay for manual review', () => {
  for (const field of ['images', 'options', 'answers', 'level']) {
    assert.equal(rapidDuplicateSimilarity(changed('a', stem, {[field]: ['A']}), changed('b', stem, {[field]: ['B']})), 0);
  }
});
test('short labels, titles alone, unknown formats and empty diagrams are not deletion evidence', () => {
  for (const shape of [{text: ''}, {text: 'explain this question'}, {text: stem, safe: false}]) {
    assert.equal(findRapidDuplicates([record('a', {shape}), record('b', {shape})], 50).pairs.length, 0);
  }
});
test('repeated records cannot cause self-deletion and all declared keepers survive', () => {
  const a = record('a');
  assert.equal(findRapidDuplicates([a, a], 90).pairs.length, 0);
  const result = findRapidDuplicates([a, record('b'), record('c')], 90);
  const removed = new Set(result.pairs.map(pair => pair.remove.key));
  assert.ok(result.pairs.every(pair => !removed.has(pair.keep.key)));
});
test('review fingerprints ignore key order but detect every saved change', () => {
  assert.equal(rapidDuplicateFingerprint({a: 1, b: {x: 2}}), rapidDuplicateFingerprint({b: {x: 2}, a: 1}));
  const pair = findRapidDuplicates([record('a'), record('b')], 90).pairs[0];
  assert.equal(rapidDuplicatePairCurrent(pair, pair.remove, pair.keep, 90), true);
  assert.equal(rapidDuplicatePairCurrent(pair, {...pair.remove, fingerprint: 'edited'}, pair.keep, 90), false);
  assert.equal(rapidDuplicatePairCurrent(pair, pair.remove, {...pair.keep, fingerprint: 'edited'}, 90), false);
  assert.equal(rapidDuplicatePairCurrent(pair, null, pair.keep, 90), false);
  assert.equal(rapidDuplicatePairCurrent(pair, pair.remove, null, 90), false);
  assert.equal(rapidDuplicatePairCurrent(pair, {...pair.remove, where: 'bank'}, pair.keep, 90), false);
});
test('the final pair must still directly meet the selected minimum', () => {
  const pair = findRapidDuplicates([record('a'), record('b')], 90).pairs[0];
  assert.equal(rapidDuplicatePairCurrent(pair, {...pair.remove, shape: {text: 'A completely different question about plants and sunlight.'}}, pair.keep, 90), false);
});

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const parserAt = source.indexOf('function _docQParts(q) {');
const recordAt = source.indexOf('function _rapidDuplicateRecord(q, where, uid, removable) {');
const recordAdapter = new Function('rapidDuplicateFingerprint', 'stripHtml',
  source.slice(parserAt, source.indexOf('// Clip long text', parserAt)) +
  source.slice(recordAt, source.indexOf('async function _rapidDuplicateRecords', recordAt)) +
  '\nreturn _rapidDuplicateRecord;')(rapidDuplicateFingerprint, s => String(s).replace(/<[^>]*>/g, ' '));
function questionRecord(id, extras = {}, extraBlocks = []) {
  return recordAdapter({id, blocks: [{id: 'stem-' + id, type: 'text', content: stem}, ...extraBlocks], ...extras}, 'vetting', 'teacher', true);
}
test('real adapter excludes question and block annotation answer content from bulk deletion', () => {
  for (const extras of [{annotation: true}, {answerKeyImage: 'answer.png'}, {answerKeyNote: 'Mark the upper label'}]) {
    assert.equal(findRapidDuplicates([questionRecord('a', extras), questionRecord('b', extras)], 50).pairs.length, 0);
  }
  for (const type of ['image', 'workingSpace']) for (const patch of [{annotate: true}, {answerImg: 'answer.png'}, {answerKey: 'Mark the upper label'}]) {
    const blocks = [{id: 'diagram', type, url: 'shared.png', ...patch}];
    assert.equal(findRapidDuplicates([questionRecord('a', {}, blocks), questionRecord('b', {}, blocks)], 50).pairs.length, 0);
  }
});
test('real adapter keeps every nested image property exact while ignoring only copy block IDs', () => {
  const a = questionRecord('a', {}, [{id: 'image-a', type: 'image', url: 'shared.png', crop: {x: 1}, overlay: {labels: ['X']}}]);
  const same = questionRecord('b', {}, [{id: 'image-b', type: 'image', url: 'shared.png', crop: {x: 1}, overlay: {labels: ['X']}}]);
  assert.equal(rapidDuplicateSimilarity(a, same), 100);
  for (const patch of [{crop: {x: 2}}, {overlay: {labels: ['Y']}}, {box_2d: [0, 0, 100, 100]}, {rotation: 90}]) {
    const b = questionRecord('b', {}, [{id: 'image-b', type: 'image', url: 'shared.png', crop: {x: 1}, overlay: {labels: ['X']}, ...patch}]);
    assert.equal(rapidDuplicateSimilarity(a, b), 0);
  }
});
test('Rapid Add offers an initially hidden admin-only preview and an explicit delete action', () => {
  assert.match(html, /id="rapidDuplicates"[^>]*hidden/);
  assert.match(html, /id="rapidDuplicatePercent"[^>]*min="50"[^>]*max="100"[^>]*value="90"/);
  assert.match(html, /All vetting questions/);
  assert.match(html, /This Rapid Add session/);
  assert.match(html, /onclick="rapidDuplicateDelete\(\)" hidden/);
});
test('both handlers enforce effective and real admin identity', () => {
  assert.match(source, /return _isAdmin\(\) && !_practiceAs.*auth\.currentUser\?\.uid === currentUser\.uid/);
  assert.match(source, /async function rapidDuplicateScan\(\) \{\s*if \(!_rapidDuplicatesAdmin\(\)/);
  assert.match(source, /async function rapidDuplicateDelete\(\)[\s\S]{0,240}_rapidDuplicatesAdmin\(plan.uid\)/);
});
test('deletion rechecks both snapshots atomically and only deletes a vetting reference', () => {
  const from = source.indexOf('async function rapidDuplicateDelete()');
  const deletion = source.slice(from, source.indexOf('window.rapidDuplicateScan', from));
  assert.match(deletion, /runTransaction\(db/);
  assert.match(deletion, /transaction\.get\(removeRef\).*transaction\.get\(keepRef\)/);
  assert.match(deletion, /rapidDuplicatePairCurrent\(pair, remove, keep, plan.minimum\)/);
  assert.match(deletion, /const removeRef = doc\(db, 'users', plan.uid, 'vetting', pair.remove.id\)/);
  assert.equal((deletion.match(/transaction\.delete\(/g) || []).length, 1);
  assert.match(deletion, /transaction\.delete\(removeRef\)/);
  assert.ok(deletion.indexOf('if (removed)') < deletion.indexOf('vettingList = vettingList.filter'));
});
