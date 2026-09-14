import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { STRIKE_DEFAULT_OBJECTIVES, strikeQuestionQualityOptions, strikeAttemptProgress } from '../science-strike-feed.js';
import { buildScienceFeedContext, planScienceQuestions } from '../science-feed-core.js';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function cut(start, end) {
  const at = source.indexOf(start), stop = source.indexOf(end, at + start.length);
  assert.ok(at >= 0 && stop > at, 'the real portal source section exists');
  return source.slice(at, stop);
}
const portal = vm.createContext({ console });
vm.runInContext(cut('function _aiHash(str) {', 'async function askGeminiCached(')
  + 'const TL_SIG_HEAD = 4000; const _tlCache = new Map();\n'
  + cut('function tlSig(q) {', 'function tlFresh(q) {')
  + cut('function sutCredit(a) {', '// Right / part right / wrong'), portal);
const plain = value => JSON.parse(JSON.stringify(value));
const now = Date.parse('2026-09-15T04:00:00Z');
const question = (id, extra = {}) => ({ id, title: 'Question ' + id, topic: 'Plant Systems',
  blocks: [{ type: 'text', content: 'Which plant part absorbs water in this observation ' + id + '?' },
    { type: 'mcq', options: [{ id: 'a', text: 'Roots' }, { id: 'b', text: 'Flowers' }], correctId: 'a' }], ...extra });
const attempt = (extra = {}) => ({ questionId: 'q1', displayName: 'Ada', timestamp: now - 1000, totalBlanks: 1, score: 1, ...extra });

test('default objective IDs and school levels exactly match the portal seed without copying question content', () => {
  const context = vm.createContext({});
  vm.runInContext(cut('const SYLLABUS_LO_TOPICS = [', '// The intro banner printed above each learning objective'), context);
  const expected = plain(context._flatSyllabusLOs()).map(({ id, level }) => ({ id, level }));
  const ordered = rows => rows.toSorted((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(ordered(STRIKE_DEFAULT_OBJECTIVES), ordered(expected));
  assert.ok(STRIKE_DEFAULT_OBJECTIVES.length > 50);
  assert.ok(STRIKE_DEFAULT_OBJECTIVES.every(row => Object.keys(row).length === 2));
  const q = question('seeded', { los: ['plant-parts'] });
  const options = { bank: [q], now, studentLevel: 'P4', topicLevels: { 'Plant Systems': 'P4' } };
  assert.equal(planScienceQuestions([q], { ...options, objectives: STRIKE_DEFAULT_OBJECTIVES }).questions.length, 1);
  assert.equal(planScienceQuestions([q], { ...options, objectives: [] }).questions.length, 0, 'a teacher-deleted objective stays deleted');
});

test('saved checker signatures and states match the actual portal without running a checker', () => {
  for (const state of ['red', 'amber', 'green', 'error']) {
    const q = question(state, { annotation: true, category: 'MCQ' });
    const sig = portal.tlSig(q);
    q.autoCheck = { state, sig, findings: [{ severity: 'high', title: 'Review' }], at: new Date(now).toISOString(), error: 'test' };
    const result = strikeQuestionQualityOptions(q);
    assert.equal(result.importSignature, sig);
    assert.deepEqual(result.checkedState, plain(portal.tlStateOf(q)));
  }
  assert.deepEqual(strikeQuestionQualityOptions(question('unchecked')).checkedState, plain(portal.tlStateOf(question('unchecked'))));
});

test('edits beyond the signature prefix invalidate stored checks while metadata-only changes do not', () => {
  const q = question('large'); q.blocks[0].content += 'A'.repeat(5000);
  q.autoCheck = { state: 'red', sig: portal.tlSig(q), findings: [] };
  q.level = 'P4'; q.difficulty = 1; q.los = ['teacher-defined-objective'];
  assert.equal(strikeQuestionQualityOptions(q).checkedState.state, 'red');
  q.blocks[0].content += 'B';
  assert.deepEqual(strikeQuestionQualityOptions(q).checkedState, plain(portal.tlStateOf(q)));
  assert.equal(strikeQuestionQualityOptions(q).checkedState.stale, true);
  assert.equal(strikeQuestionQualityOptions(null).importSignature, '');
  const circular = question('bad'); circular.blocks.push(circular);
  assert.equal(strikeQuestionQualityOptions(circular).importSignature, '');
});

test('fresh stored red and amber checks block feeding, while edited checks are not falsely reused', () => {
  const bank = ['red', 'amber', 'edited', 'clean'].map(id => question(id));
  for (const q of bank.slice(0, 3)) q.autoCheck = { state: q.id === 'amber' ? 'amber' : 'red', sig: portal.tlSig(q) };
  bank[2].blocks[0].content += ' A corrected observation.';
  const context = buildScienceFeedContext({ bank, now, studentLevel: 'P4', topicLevels: { 'Plant Systems': 'P4' },
    qualityOptions: strikeQuestionQualityOptions });
  assert.deepEqual(planScienceQuestions(bank, { context }).questions.map(q => q.id), ['edited', 'clean']);
});

test('progress isolates siblings and anonymous legacy attempts from the active named child', () => {
  const rows = [attempt({ displayName: 'Ben', questionId: 'ben' }), attempt({ displayName: '', questionId: 'unknown' }),
    attempt({ displayName: ' Ada ', questionId: 'ada' })];
  assert.deepEqual(Object.keys(strikeAttemptProgress(rows, 'Ada', {}, now)), ['ada']);
});

test('valid teacher overrides match the portal tracker and override equal-time local results', () => {
  for (const overrideScore of [0, 0.5, 1, 2, -1, '0.5']) {
    const row = attempt({ score: 1, override: { score: overrideScore, at: new Date(now).toISOString() } });
    const result = strikeAttemptProgress([row], 'Ada', { q1: { last: row.timestamp, latestFrac: 1 } }, now);
    assert.equal(result.q1.latestFrac, portal.sutCredit(row));
    assert.equal(result.q1.last, row.timestamp);
  }
});

test('the latest answer determines mastery rather than lifetime best or an old correction date', () => {
  const rows = [attempt({ score: 0, timestamp: now - 100 }),
    attempt({ score: 0, timestamp: now - 1000, override: { score: 1, at: new Date(now).toISOString() } })];
  assert.deepEqual(plain(strikeAttemptProgress(rows, 'Ada', {}, now)), { q1: { last: now - 100, latestFrac: 0 } });
  rows.reverse();
  assert.equal(strikeAttemptProgress(rows, 'Ada', {}, now).q1.latestFrac, 0);
  const local = { q1: { last: now - 50, latestFrac: 0.5 } };
  assert.deepEqual(plain(strikeAttemptProgress(rows, 'Ada', local, now)), local);
});

test('Firestore, numeric and ISO timestamps all contribute to cross-mode spacing', () => {
  const at = now - 1000;
  const times = [at, String(at), new Date(at).toISOString(), new Date(at), { toMillis: () => at }, { seconds: at / 1000, nanoseconds: 0 }];
  for (const timestamp of times) assert.deepEqual(plain(strikeAttemptProgress([attempt({ timestamp })], 'Ada', {}, now)),
    { q1: { last: at, latestFrac: 1 } });
  assert.deepEqual(plain(strikeAttemptProgress([attempt({ timestamp: { toMillis() { throw new Error('bad'); } } })], 'Ada', {}, now)), {});
});

test('malformed marks do not become false failure evidence or erase valid local progress', () => {
  for (const value of [null, undefined, '', ' ', false, true, NaN, Infinity, 'wrong', {}, []]) {
    assert.deepEqual(plain(strikeAttemptProgress([attempt({ score: value })], 'Ada', {}, now)), {}, String(value));
    assert.deepEqual(plain(strikeAttemptProgress([attempt({ totalBlanks: value })], 'Ada', {}, now)), {}, String(value));
    assert.equal(strikeAttemptProgress([attempt({ override: { score: value } })], 'Ada', {}, now).q1.latestFrac, 1);
  }
  assert.deepEqual(plain(strikeAttemptProgress([attempt({ timestamp: now + 100000 })], 'Ada', { q1: { last: now - 100, latestFrac: 0.5 } }, now)),
    { q1: { last: now - 100, latestFrac: 0.5 } });
});

test('correction ties are deterministic and invalid local cache shapes cannot supply mastery', () => {
  const rows = [attempt(), attempt({ override: { score: 0, at: new Date(now).toISOString() } })];
  assert.equal(strikeAttemptProgress(rows, 'Ada', {}, now).q1.latestFrac, 0);
  assert.equal(strikeAttemptProgress(rows.toReversed(), 'Ada', {}, now).q1.latestFrac, 0);
  assert.deepEqual(plain(strikeAttemptProgress([], 'Ada', [attempt()], now)), {});
  assert.deepEqual(plain(strikeAttemptProgress([], 'Ada', { bad: { last: now, latestFrac: '' }, future: { last: now + 1, latestFrac: 0 } }, now)), {});
  const unusual = strikeAttemptProgress([attempt({ questionId: '__proto__' })], 'Ada', {}, now);
  assert.equal(unusual.__proto__.latestFrac, 1);
});
