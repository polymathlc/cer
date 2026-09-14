import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createGrandLineLearningController, grandLineLearningReward, validGrandLineQuestions } from '../grand-line-learning-parent.js';

const question = id => ({ id, html: '<p>Authored question ' + id + '</p>', options: ['A', 'B', 'C'], answer: 1 });
function fixture(extra = {}) {
  const messages = [], shown = [], records = []; let identity = 'private-account:child-a:P6', active = true;
  const source = { postMessage(data, origin) { messages.push({ data, origin }); } };
  const options = { origin: 'https://school.test', subject: 'Math', getFrame: () => ({ contentWindow: source }),
    getIdentity: () => identity, getProfileKey: () => 'p0123456789abcdef', isAllowed: () => true, isActive: () => active,
    makeSessionId: () => 'session-1', getQuestions: async () => [1, 2, 3, 4, 5].map(i => question('q' + i)),
    markShown: q => shown.push(q.id), recordAnswer: r => records.push(r),
    presentQuestions: async ({ questions, grade }) => { for (let i = 0; i < 3; i++) await grade(i, questions[i].answer, 2000); return true; }, ...extra };
  const controller = createGrandLineLearningController(options);
  const send = data => controller.handleMessage({ origin: options.origin, source, data });
  const hello = () => send({ type: 'GLTCG_HELLO', requestId: 'hello-1' });
  const round = (round = 1, requestId = 'round-' + round) => send({ type: 'GLTCG_ROUND_REQUEST', requestId, sessionId: 'session-1', round });
  return { options, controller, source, messages, shown, records, send, hello, round,
    setIdentity: value => { identity = value; }, setActive: value => { active = value; } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('only four scores exist and exactly three distinct complete records are admitted', () => {
  assert.deepEqual([0, 1, 2, 3].map(grandLineLearningReward), [0, 1, 2, 3].map(correct => ({ correct, total: 3 })));
  for (const score of [-1, 4, 1.5, '3', NaN]) assert.throws(() => grandLineLearningReward(score));
  const a = question('a');
  assert.equal(validGrandLineQuestions([a, a, { ...a, id: 'b', answer: -1 }, { ...a, id: 'c', options: [''] }]).length, 1);
  assert.equal(validGrandLineQuestions(Array.from({ length: 8 }, (_, i) => question(String(i)))).length, 3);
});
test('READY sends an opaque stable scope; neither handshake nor results expose questions or private identity', async () => {
  const f = fixture(); await f.hello(); await f.round();
  assert.deepEqual(f.messages[0].data, { type: 'GLTCG_READY', requestId: 'hello-1', sessionId: 'session-1', subject: 'Math', profileKey: 'p0123456789abcdef', questionCount: 3, available: true, reason: '' });
  const payload = JSON.stringify(f.messages);
  for (const secret of ['private-account', 'child-a', 'options', 'answer', 'Authored question']) assert.ok(!payload.includes(secret));
  assert.ok(f.messages.every(m => m.origin === 'https://school.test'));
});
test('all scores grade and reserve exactly three, even when the selector returns five', async () => {
  for (let score = 0; score <= 3; score++) {
    const f = fixture({ presentQuestions: async ({ grade }) => { for (let i = 0; i < 3; i++) await grade(i, i < score ? 1 : 0, 2000); return true; } });
    await f.hello(); await f.round();
    assert.deepEqual(f.shown, ['q1', 'q2', 'q3']); assert.equal(f.records.length, 3);
    assert.equal(f.records.filter(r => r.correct).length, score);
    assert.deepEqual(f.messages.at(-1).data, { type: 'GLTCG_ROUND_RESULT', requestId: 'round-1', sessionId: 'session-1', round: 1, correct: score, total: 3 });
  }
});
test('origin, exact iframe, access, session, request tokens and sequential rounds are enforced', async () => {
  const f = fixture(); const data = { type: 'GLTCG_HELLO', requestId: 'h' };
  await f.controller.handleMessage({ origin: 'https://evil.test', source: f.source, data });
  await f.controller.handleMessage({ origin: f.options.origin, source: {}, data });
  await f.send({ ...data, requestId: '<script>' }); assert.equal(f.messages.length, 0);
  await f.hello(); await f.send({ type: 'GLTCG_ROUND_REQUEST', requestId: 'x', sessionId: 'forged', round: 1 });
  for (const n of [0, 2, -1, 1.5, '1']) await f.round(n);
  f.setActive(false); await f.round(); assert.equal(f.records.length, 0);
  const denied = fixture({ isAllowed: () => false }); await denied.hello(); assert.equal(denied.messages.length, 0);
});
test('empty identity blocks all grading authority', async () => {
  const f = fixture(); f.setIdentity(''); await f.hello(); await f.round();
  assert.equal(f.messages[0].data.available, false); assert.equal(f.records.length, 0); assert.equal(f.shown.length, 0);
});
test('replayed completed rounds and repeated handshake never reserve or write again', async () => {
  const f = fixture(); await f.hello(); await f.round(); await f.hello(); await f.round(1, 'retry');
  assert.equal(f.shown.length, 3); assert.equal(f.records.length, 3); assert.equal(f.messages.at(-1).data.requestId, 'retry');
  await f.round(2); assert.equal(f.records.length, 6); assert.equal(f.controller.getState().nextRound, 3);
});
test('incomplete, duplicate and empty banks block the same round without filler or reservation', async () => {
  for (const bank of [[], [question('a'), question('a'), question('b')], [question('a'), question('b')]]) {
    const f = fixture({ getQuestions: async () => bank }); await f.hello(); await f.round();
    assert.equal(f.messages.at(-1).data.type, 'GLTCG_ROUND_BLOCKED'); assert.equal(f.shown.length, 0);
    assert.equal(f.records.length, 0); assert.equal(f.controller.getState().nextRound, 1);
  }
});
test('abandoning a partial round earns nothing and retry still needs all three', async () => {
  let abandon = true;
  const f = fixture({ presentQuestions: async ({ grade }) => { await grade(0, 1, 1); if (abandon) return false; await grade(1, 1, 1); await grade(2, 1, 1); return true; } });
  await f.hello(); await f.round(); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ROUND_BLOCKED');
  assert.equal(f.controller.getState().nextRound, 1); abandon = false; await f.round(1, 'retry');
  assert.equal(f.messages.at(-1).data.total, 3); assert.equal(f.records.length, 4);
});
test('concurrent rounds, double choices, malformed choices and forged indices cannot add writes', async () => {
  let finish; const f = fixture({ presentQuestions: async ({ grade }) => {
    assert.equal(await grade(2, 1, 1), null); assert.equal(await grade(0, -1, 1), null); assert.equal(await grade(0, 1.5, 1), null);
    const first = grade(0, 1, 1), second = grade(0, 1, 1); await first; assert.equal(await second, null);
    return new Promise(resolve => { finish = resolve; });
  } });
  await f.hello(); const running = f.round(); await tick(); await f.round(1, 'parallel');
  assert.equal(f.records.length, 1); finish(true); await running; assert.equal(f.messages.at(-1).data.type, 'GLTCG_ROUND_BLOCKED');
});
test('profile changes while bank loading discard the unreserved question set', async () => {
  let resolve; const f = fixture({ getQuestions: () => new Promise(r => { resolve = r; }) });
  await f.hello(); const running = f.round(); f.setIdentity('other-child'); resolve([1, 2, 3].map(i => question(String(i)))); await running;
  assert.equal(f.records.length, 0); assert.equal(f.shown.length, 0); assert.equal(f.messages.length, 1);
});
test('remote answers require an authoritative internally consistent marking result', async () => {
  for (const result of [null, { correct: true, answer: 7 }, { correct: true, answer: 0 }, { correct: 'true', answer: 1 }]) {
    const f = fixture({ getQuestions: async () => [1, 2, 3].map(i => ({ ...question(String(i)), answer: null, grading: 'remote' })),
      gradeQuestion: async () => result, presentQuestions: async ({ grade }) => { await grade(0, 1, 1); return true; } });
    await f.hello(); await f.round(); assert.equal(f.records.length, 0); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ROUND_BLOCKED');
  }
});
test('profile changes during remote marking cannot write or return a stale answer', async () => {
  let resolve, answer; const f = fixture({ getQuestions: async () => [1, 2, 3].map(i => ({ ...question(String(i)), grading: 'remote' })),
    gradeQuestion: () => new Promise(r => { resolve = r; }), presentQuestions: async ({ grade }) => { answer = await grade(0, 1, 1); return true; } });
  await f.hello(); const running = f.round(); await tick(); f.setIdentity('other-child'); resolve({ correct: true, answer: 1 }); await running;
  assert.equal(answer, null); assert.equal(f.records.length, 0); assert.equal(f.messages.length, 1);
});
test('profile changes during asynchronous history writes suppress stale feedback and rewards', async () => {
  let resolve, answer; const f = fixture({ recordAnswer: () => new Promise(r => { resolve = r; }),
    presentQuestions: async ({ grade }) => { answer = await grade(0, 1, 1); return true; } });
  await f.hello(); const running = f.round(); await tick(); f.setIdentity('other-child'); resolve(); await running;
  assert.equal(answer, null); assert.equal(f.messages.length, 1);
});
test('closing retires the session and late visual callbacks have no authority', async () => {
  let finish, callbacks, failures = 0; const f = fixture({ onImageFailure: () => failures++, onQuestionUnavailable: () => failures++,
    presentQuestions: args => { callbacks = args; return new Promise(resolve => { finish = resolve; }); } });
  await f.hello(); const running = f.round(); await tick(); f.controller.destroy();
  callbacks.imageFailed(question('q1'), 'image.png'); callbacks.questionUnavailable(question('q1')); finish(true); await running; await f.round();
  assert.equal(failures, 0); assert.equal(f.messages.at(-1).data.type, 'GLTCG_INVALIDATE'); assert.equal(f.controller.getState(), null);
});
test('purchases require the exact active iframe/session and accept only an ID and tier', async () => {
  const calls = [], f = fixture({ buyPack: async request => { calls.push(request); return { wallet: { balance: 880 } }; } });
  await f.hello(); const data = { type: 'GLTCG_BUY_REQUEST', sessionId: 'session-1', requestId: 'buy', purchaseId: 'purchase', packId: 'spark', balance: 9999, characterId: 'kaido' };
  await f.controller.handleMessage({ origin: 'https://evil.test', source: f.source, data });
  await f.controller.handleMessage({ origin: f.options.origin, source: {}, data });
  await f.send({ ...data, sessionId: 'forged' }); assert.equal(calls.length, 0);
  await f.send(data); assert.deepEqual(calls, [{ purchaseId: 'purchase', packId: 'spark' }]);
  assert.equal(f.messages.at(-1).data.type, 'GLTCG_BUY_RESULT'); assert.equal(f.messages.at(-1).data.purchaseId, 'purchase');
});
test('pending purchase invalidation suppresses stale replies without restarting the purchase', async () => {
  let finish; const f = fixture({ buyPack: () => new Promise(resolve => { finish = resolve; }) }); await f.hello();
  const request = { type: 'GLTCG_BUY_REQUEST', sessionId: 'session-1', requestId: 'buy', purchaseId: 'purchase', packId: 'spark' };
  const running = f.send(request); await f.send({ ...request, requestId: 'again' });
  assert.equal(f.messages.at(-1).data.type, 'GLTCG_BUY_BLOCKED'); assert.equal(f.messages.at(-1).data.retryable, true);
  f.controller.invalidate(); finish({ wallet: { balance: 880 } }); await running;
  assert.equal(f.messages.some(m => m.data.type === 'GLTCG_BUY_RESULT'), false);
});
test('a learning request while a purchase saves receives a retryable block and can retry the same round', async () => {
  let finish; const f = fixture({ buyPack: () => new Promise(resolve => { finish = resolve; }) }); await f.hello();
  const pending = f.send({ type: 'GLTCG_BUY_REQUEST', sessionId: 'session-1', requestId: 'buy', purchaseId: 'purchase', packId: 'spark' });
  await f.round(); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ROUND_BLOCKED'); assert.equal(f.messages.at(-1).data.retryable, true);
  assert.equal(f.shown.length, 0); assert.equal(f.controller.getState().nextRound, 1);
  finish({ wallet: { balance: 880 } }); await pending; await f.round(1, 'retry-after-save');
  assert.equal(f.messages.at(-1).data.type, 'GLTCG_ROUND_RESULT'); assert.equal(f.records.length, 3);
});
test('save messages cannot forward owned cards or points and round results refresh the wallet', async () => {
  const requests = [], wallet = { available: true, balance: 1000 };
  const f = fixture({ getSnapshot: () => ({ wallet }), saveCollection: async request => { requests.push(request); return { wallet }; }, recordAnswer: () => { wallet.balance += 8; } });
  await f.hello(); await f.send({ type: 'GLTCG_SAVE_REQUEST', requestId: 'save', sessionId: 'session-1', team: ['a'], progress: { completed: [1] }, cards: { kaido: 999 }, gold: 999 });
  assert.deepEqual(requests, [{ team: ['a'], progress: { completed: [1] } }]);
  await f.round(); assert.equal(f.messages.at(-1).data.wallet.balance, 1024); assert.equal(f.messages.at(-1).data.total, 3);
});

const root = new URL('../', import.meta.url), science = fs.existsSync(new URL('app.js', root));
const app = fs.readFileSync(new URL(science ? 'app.js' : 'index.html', root), 'utf8');
test('navigation, authentication and learner changes explicitly retire Grand Line', () => {
  const section = name => app.slice(app.indexOf(name), app.indexOf(name) + 420);
  assert.match(section('function navigateTo(page) {'), /grandLinePortal.close\(\)/);
  assert.match(section('onAuthStateChanged(auth,'), /grandLinePortal.close\(\)/);
  if (science) {
    assert.match(section('function _scienceFeedRefreshFrames()'), /grandLinePortal.sync\(\)/);
    assert.match(section('function configureSidebarForRole(role)'), /grandLinePortal.close\(\)/);
    assert.match(fs.readFileSync(new URL('grand-line-science-adapter.js',root),'utf8'), /mode:'grand-line'/); assert.match(app, /getProfileKey:.*familyProfile.activeStudent/);
  } else assert.match(section('async function saveStudentLevel(lv)'), /grandLinePortal.close\(\)/);
  const html = fs.readFileSync(new URL('index.html', root), 'utf8'); assert.match(html, /Crew Defense <span class="nav-beta">TCG/);
  assert.match(app, /Collect 50 One Piece characters/);
});
if (science) test('Science navigation reaches the new overlay without a missing page', () => {
  const start = app.indexOf('function navigateTo(page) {'), endText = "if (page === 'grand-line') { grandLinePortal.open(); return; }";
  const end = app.indexOf(endText, start); assert.ok(end > start);
  let opened = 0, closed = 0; const context = vm.createContext({ vetPrintPeekHide() {}, pirateRiftPortal: { close() {} },
    grandLinePortal: { close() { closed++; }, open() { opened++; } }, _isEmployee: () => false, EMPLOYEE_PAGES: [] });
  vm.runInContext(app.slice(start, end + endText.length) + '\nthrow new Error("missing route");}', context);
  vm.runInContext('navigateTo("grand-line")', context); assert.equal(opened, 1); assert.equal(closed, 1);
});
