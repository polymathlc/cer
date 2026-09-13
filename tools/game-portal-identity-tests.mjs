import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const helperStart = app.indexOf('function _scienceFeedGameMessageCurrent(');
const helper = app.slice(helperStart, app.indexOf('\n}', helperStart) + 2);
const bridgeStart = app.indexOf("window.addEventListener('message'", app.indexOf('async function _sdQuestionsPayload('));
const bridge = app.slice(bridgeStart, app.indexOf('\n});', bridgeStart) + 4);
assert.ok(helperStart > 0 && bridgeStart > 0);

function fixture() {
  const state = { key: 'child-a', level: 'P4', spent: 0, scores: [], resets: 0, replies: [], listeners: [] };
  const frame = { postMessage: data => state.replies.push(data) };
  const c = vm.createContext({
    document: { getElementById: id => id === 'defendersFrame' ? { contentWindow: frame } : null },
    window: { addEventListener: (_, listener) => state.listeners.push(listener) },
    _scienceFeedKey: () => state.key, _scienceFeedLevel: () => state.level,
    _spendCredit: () => { state.spent++; return true; },
    _sdRecordScore: data => state.scores.push(data), _gamePtsReset: () => state.resets++,
    _playsLeftPayload: () => ({ defenders: 2 }), _sdQuestionsPayload: async () => ({ type: 'SD_QUESTIONS' }),
  });
  vm.runInContext(helper + '\n' + bridge, c);
  return { state, frame, send(data, source = frame) { state.listeners[0]({ data, source }); } };
}

for (const type of ['SD_PLAY_START', 'SD_SCORE']) {
  test(type + ': queued previous-child, previous-level and untrusted messages have no side effects', async () => {
    const f = fixture();
    const queued = { type, studentKey: 'child-a', studentLevel: 'P4', mode: 'defenders', score: 500 };
    f.state.key = 'child-b'; f.send(queued);
    f.state.key = 'child-a'; f.state.level = 'P5'; f.send(queued);
    f.state.level = 'P4'; f.send(queued, {}); f.send({ type, mode: 'defenders' });
    await Promise.resolve();
    assert.equal(f.state.spent, 0); assert.equal(f.state.resets, 0);
    assert.equal(f.state.scores.length, 0); assert.equal(f.state.replies.length, 0);
  });
}

test('current embedded run still spends one credit, refreshes its pool and records its score', async () => {
  const f = fixture(), owner = { studentKey: 'child-a', studentLevel: 'P4', mode: 'defenders' };
  f.send({ type: 'SD_PLAY_START', ...owner });
  f.send({ type: 'SD_SCORE', ...owner, score: 500 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.spent, 1); assert.equal(f.state.resets, 1);
  assert.equal(f.state.scores.length, 1); assert.equal(f.state.scores[0].score, 500);
  assert.deepEqual(f.state.replies.map(reply => reply.type), ['SD_PLAYS_LEFT', 'SD_QUESTIONS']);
});
