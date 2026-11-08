// v1.454.1 — games never wait on, or run dry of, class questions.
// Covers the bridge look-ahead (prefetch/ready), retries that keep the
// question on screen, and the portal's last-resort pool in _sdQuestionsPayload.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const bridgeSource = read('science-feed-bridge.js'), app = read('app.js');
const row = (id = 'a') => ({ id, q: 'A science question ' + id, options: ['One', 'Two'], answer: 0 });
const cutFn = (source, head) => {
  const start = source.indexOf(head); assert.ok(start >= 0, head);
  const end = source.indexOf('\n}\n', start); assert.ok(end > start, head);
  return source.slice(start, end + 3);
};

function bridgeFixture(createOptions = {}) {
  const messages = [], pools = [], listeners = [], timers = new Map(); let timerId = 0;
  const clock = { setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) };
  const parent = { postMessage: data => messages.push(data) };
  const window = { parent, location: { origin: 'https://school.example' }, addEventListener: (name, fn) => listeners.push(fn) };
  const c = vm.createContext({ window, Map, Date, Promise, Number, String, Array, Math, ...clock });
  vm.runInContext(bridgeSource, c);
  const bridge = window.ScienceFeedBridge.create({ onPool: rows => pools.push(rows), ...createOptions });
  const event = data => { listeners.forEach(fn => fn({ data, source: parent, origin: window.location.origin })); };
  const reply = (extra = {}) => event({ type: 'SD_QUESTIONS', feedPolicyVersion: 1, requestId: messages.at(-1)?.requestId,
    studentKey: 'child-a', studentLevel: 'P4', questions: [row()], ...extra });
  const runAll = delay => { for (const [id, t] of [...timers]) if (delay == null || t.delay === delay) { timers.delete(id); t.fn(); } };
  return { bridge, messages, pools, timers, reply, runAll };
}

test('look-ahead: taking a question immediately fetches the next one in the background', async () => {
  const f = bridgeFixture({ prefetch: true });
  const first = f.bridge.ready(); f.reply({ questions: [row('one')] }); assert.equal(await first, true);
  const q = f.bridge.stamp(f.bridge.take()); assert.equal(q.id, 'one');
  assert.equal(f.messages.length, 1, 'prefetch is deferred, not synchronous');
  f.runAll(0);
  assert.equal(f.messages.length, 2, 'the next question was requested while this one is on screen');
  f.reply({ questions: [row('two')] });
  assert.equal(f.bridge.current(q), true, 'the prefetch response never drops the question being answered');
  let resolved = false; const next = f.bridge.ready().then(v => { resolved = v; });
  await next; assert.equal(resolved, true);
  assert.equal(f.messages.length, 2, 'ready() used the waiting question without another round trip');
  assert.equal(f.bridge.take().id, 'two');
});

test('without the prefetch option a game keeps the old one-request-per-question flow', async () => {
  const f = bridgeFixture();
  const first = f.bridge.refresh(); f.reply({ questions: [row('one')] }); await first;
  assert.equal(f.bridge.take().id, 'one'); f.runAll(0);
  assert.equal(f.messages.length, 1);
});

test('a timeout or empty reply retries quickly and never clears the question on screen', async () => {
  const f = bridgeFixture({ prefetch: true });
  const first = f.bridge.ready(); f.reply({ questions: [row('shown')] }); await first;
  const q = f.bridge.stamp(f.bridge.take()); f.runAll(0);
  // The prefetch request times out…
  const timeout = [...f.timers.values()].find(t => t.delay === 6000); assert.ok(timeout, 'requests time out after 6s');
  f.runAll(6000);
  assert.equal(f.bridge.current(q), true, 'a timeout does not invalidate the question being answered');
  f.runAll(0); const retried = f.messages.length; assert.equal(retried, 3, 'a timeout retries at once');
  // …and an empty startup-style reply backs off only briefly.
  f.reply({ questions: [] });
  const delays = [...f.timers.values()].map(t => t.delay);
  assert.ok(delays.length && Math.max(...delays) <= 3000, 'retry backoff stays at or under 3 seconds: ' + delays);
  assert.equal(f.bridge.current(q), true);
});

test('backoff is capped at 3 seconds even after many empty replies', async () => {
  const f = bridgeFixture();
  const first = f.bridge.refresh(); f.reply({ questions: [] }); await first;
  const seen = [];
  for (let i = 0; i < 8; i++) {
    const [id, t] = [...f.timers][0]; seen.push(t.delay); f.timers.delete(id); t.fn();
    f.reply({ questions: [] });
  }
  assert.deepEqual(seen.slice(0, 4), [500, 1000, 2000, 3000]);
  assert.ok(seen.every(d => d <= 3000));
});

// ---- portal side ----
function payloadFixture({ take = async () => [], bank = [], stats = {} } = {}) {
  const extract = q => q && q.blocks ? { id: q.id, q: 'Question ' + q.id, options: ['A', 'B'], answer: 0 } : null;
  const state = { key: 'child-a', level: 'P4', gq: {} };
  const context = { console, Math, Date, Map, Number, String, Array, Infinity,
    _scienceFeedKey: () => state.key, _scienceFeedGameLevel: () => state.level,
    _sdSeenStats: async () => stats, _scienceFeedEnsure: async () => false, _ppGameFrameMatches: () => false,
    buildDefenderQuestions: () => bank.map(extract).filter(Boolean), _gqFilterPool: () => [],
    _scienceFeedSources: () => bank, _scienceFeedTake: take, _scienceFeedIsRecycled: () => false,
    _scienceFeedGameMessage: () => 'history-loading', currentUser: { name: 'Learner', role: 'student' },
    _dailyCreditAllowance: () => 10, _playsLeftPayload: () => ({ legends: 10 }),
    questionBank: bank, SEC1_RETIRED: true, _isSec1Question: q => q.level === 'S1',
    qInSyllabus: q => !q.retired, qAvailableToViewer: () => true, _sdExtractMcq: extract,
    _scienceFeedStoreRead: () => ({ reported: { at: 1 } }), _scienceFeedQualityOptions: () => ({}),
    _scienceFeedImageFailures: new Map(),
    evaluateQuestionQuality: (q, opts) => ({ eligible: !opts.studentFlagged, tier: q.review ? 'review' : 'sound' }),
    questionHasUnresolvedStudentFlag: (q, flag) => !!flag, qWithinStudentLevel: q => q.level !== 'P6',
    _gqLoad: () => state.gq };
  vm.createContext(context);
  vm.runInContext([cutFn(app, 'function _sdLastResortRows(source) {'), 'const _sdLastResortServed = new Map();',
    cutFn(app, 'function _sdLastResortPick(entries, feedKey) {'), cutFn(app, 'async function _sdQuestionsPayload(source) {')].join('\n'), context);
  return { state, payload: () => context._sdQuestionsPayload({}) };
}
const bankQ = (id, extra = {}) => ({ id, level: 'P4', blocks: [{ type: 'mcq' }], ...extra });

test('when history cannot sync the game is still fed from the live bank, marked recycled', async () => {
  const f = payloadFixture({ bank: [bankQ('p4-a')] });
  const result = await f.payload();
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].id, 'p4-a');
  assert.equal(result.questions[0].recycled, true, 'the frame 15-minute guard lets it through');
});

test('the safety net never serves Sec 1, retired, reported or (while sound ones exist) review-tier questions', async () => {
  const bank = [bankQ('sec1', { level: 'S1' }), bankQ('retired', { retired: true }), bankQ('reported'),
    bankQ('review', { review: true }), bankQ('good')];
  const f = payloadFixture({ bank });
  for (let i = 0; i < 6; i++) assert.equal((await f.payload()).questions[0].id, 'good');
});

test('the safety net prefers the learner band and walks the whole pool before repeating', async () => {
  const bank = [bankQ('a'), bankQ('b'), bankQ('c'), bankQ('above', { level: 'P6' })];
  const f = payloadFixture({ bank });
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push((await f.payload()).questions[0].id);
  assert.deepEqual(new Set(ids.slice(0, 3)), new Set(['a', 'b', 'c']), 'every in-band question once before any repeat');
  assert.ok(!ids.includes('above'), 'in-band questions come first');
});

test('a learner switch mid-request withdraws the safety-net pick too', async () => {
  const f = payloadFixture({ bank: [bankQ('fallback')] });
  const pending = f.payload(); f.state.key = 'child-b';
  const result = await pending;
  assert.equal(result.questions.length, 0, 'the old learner request reserves nothing for the new one');
  assert.equal(result.studentKey, 'child-b');
});

test('a game level is never empty, so frames never drop the whole pool', () => {
  const source = cutFn(app, 'function _scienceFeedGameLevel(profile) {');
  const make = (user, child) => {
    const c = { currentUser: user, famActive: () => child, isLevelCode: v => /^(P[3-6]|S1)$/.test(String(v || '')),
      liveLevel: v => v === 'S1' ? 'P6' : v, LEVEL_MAX: 'S1', _scienceFeedLevel: () => '' };
    vm.createContext(c); vm.runInContext(source, c); return c._scienceFeedGameLevel();
  };
  assert.equal(make({ role: 'admin', level: '' }, null), 'P6', 'admin preview with no level');
  assert.equal(make({ role: 'student', level: '' }, null), 'P6', 'student whose level is not set yet');
  assert.equal(make({ role: 'admin', level: 'P4' }, null), 'P4');
  assert.equal(make({ role: 'parent' }, { level: 'P3' }), 'P3');
});
