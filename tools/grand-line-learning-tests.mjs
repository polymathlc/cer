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
  assert.deepEqual(f.messages[0].data, { type: 'GLTCG_READY', requestId: 'hello-1', sessionId: 'session-1', subject: 'Math', profileKey: 'p0123456789abcdef', questionCount: 3, maxPackQuantity: 1, available: true, reason: '' });
  const payload = JSON.stringify(f.messages);
  for (const secret of ['private-account', 'child-a', 'options', 'answer', 'Authored question']) assert.ok(!payload.includes(secret));
  assert.ok(f.messages.every(m => m.origin === 'https://school.test'));
});
test('READY advertises multi-pack support only when the wallet authority explicitly supports fifty packs', async () => {
  for(const maxPackQuantity of [undefined,null,1,5,49,51,'50',false]){
    const f=fixture({getSnapshot:()=>({wallet:{maxPackQuantity}})});await f.hello();assert.equal(f.messages.at(-1).data.maxPackQuantity,1);
  }
  const f=fixture({getSnapshot:()=>({wallet:{maxPackQuantity:50}})});await f.hello();assert.equal(f.messages.at(-1).data.maxPackQuantity,50);
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
test('purchases require the exact active iframe/session and accept only an ID, tier and bounded quantity', async () => {
  const calls = [], f = fixture({ buyPack: async request => { calls.push(request); return { wallet: { balance: 880 } }; } });
  await f.hello(); const data = { type: 'GLTCG_BUY_REQUEST', sessionId: 'session-1', requestId: 'buy', purchaseId: 'purchase', packId: 'spark', balance: 9999, characterId: 'kaido' };
  await f.controller.handleMessage({ origin: 'https://evil.test', source: f.source, data });
  await f.controller.handleMessage({ origin: f.options.origin, source: {}, data });
  await f.send({ ...data, sessionId: 'forged' }); assert.equal(calls.length, 0);
  await f.send(data); assert.deepEqual(calls, [{ purchaseId: 'purchase', packId: 'spark', quantity: 1 }]);
  assert.equal(f.messages.at(-1).data.type, 'GLTCG_BUY_RESULT'); assert.equal(f.messages.at(-1).data.purchaseId, 'purchase');
});
test('batch quantities default only when omitted and forward every allowed whole number without client rewards', async () => {
  const calls = [], f = fixture({ buyPack: async request => { calls.push(request); return { quantity: request.quantity, grants: [] }; } });
  await f.hello();
  for(let quantity=1;quantity<=50;quantity++){
    const data={type:'GLTCG_BUY_REQUEST',sessionId:'session-1',requestId:'batch-'+quantity,purchaseId:'purchase-'+quantity,packId:'nova',quantity,cost:0,grants:[{characterId:'kaido'}],cards:{kaido:999},balance:Infinity,admin:true};
    await f.send(data);assert.deepEqual(calls.at(-1),{purchaseId:data.purchaseId,packId:'nova',quantity});
    assert.equal(f.messages.at(-1).data.type,'GLTCG_BUY_RESULT');assert.equal(f.messages.at(-1).data.quantity,quantity);
  }
  assert.equal(calls.length,50);
});
test('malformed or excessive quantities are confirmed uncharged without calling the purchase authority or holding its lock', async () => {
  const calls=[],f=fixture({buyPack:async request=>{calls.push(request);return {};}});await f.hello();
  const data={type:'GLTCG_BUY_REQUEST',sessionId:'session-1',requestId:'batch',purchaseId:'purchase',packId:'spark'};
  for(const quantity of [null,false,true,0,-1,51,1.5,'5',NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1,[],{},new Number(5)]){
    await f.send({...data,quantity});const result=f.messages.at(-1).data;
    assert.equal(result.type,'GLTCG_BUY_BLOCKED');assert.equal(result.confirmedNoCharge,true);assert.equal(result.retryable,false);
    assert.equal(result.purchaseId,'purchase');assert.equal(calls.length,0);
  }
  await f.send({...data,quantity:5});assert.equal(calls.length,1);assert.equal(f.messages.at(-1).data.type,'GLTCG_BUY_RESULT');
});
test('a pending batch keeps its exact quantity across retries and shares the same learning/save lock', async () => {
  let finish;const calls=[],f=fixture({buyPack:request=>{calls.push(request);return new Promise(resolve=>{finish=resolve;});}});await f.hello();
  const request={type:'GLTCG_BUY_REQUEST',sessionId:'session-1',requestId:'first',purchaseId:'batch-receipt',packId:'galaxy',quantity:50};
  const first=f.send(request);await f.send({...request,requestId:'overlap'});assert.equal(calls.length,1);assert.equal(f.messages.at(-1).data.retryable,true);
  finish({quantity:50,grants:[]});await first;
  const retry=f.send({...request,requestId:'retry'});assert.deepEqual(calls[1],calls[0]);finish({quantity:50,grants:[]});await retry;
  assert.equal(f.messages.at(-1).data.requestId,'retry');assert.equal(f.messages.at(-1).data.quantity,50);
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

test('admin actions require the live role, exact iframe, origin and session', async () => {
  const calls = []; let admin = false;
  const f = fixture({ isAdmin: () => admin, adminAction: async request => { calls.push(request); return {}; } });
  await f.hello();
  const data = { type: 'GLTCG_ADMIN_REQUEST', requestId: 'admin-1', sessionId: 'session-1', action: 'unlock-all', admin: true, role: 'admin' };
  await f.send(data); assert.equal(calls.length, 0); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ADMIN_BLOCKED');
  assert.equal(f.messages.at(-1).data.retryable, false); admin = true;
  await f.controller.handleMessage({ origin: 'https://evil.test', source: f.source, data });
  await f.controller.handleMessage({ origin: f.options.origin, source: {}, data });
  await f.send({ ...data, sessionId: 'forged' }); assert.equal(calls.length, 0);
  await f.send(data); assert.deepEqual(calls, [{ action: 'unlock-all' }]);
  assert.equal(f.messages.at(-1).data.action, 'unlock-all'); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ADMIN_RESULT');
  const missingRole = fixture({ adminAction: async () => { throw Error('must not call'); } });
  await missingRole.hello(); await missingRole.send(data); assert.equal(missingRole.messages.at(-1).data.type, 'GLTCG_ADMIN_BLOCKED');
});
test('admin action values are validated and only the action and boolean setting reach the host', async () => {
  const calls = [], admin = { available: true, unlimitedGold: true };
  const f = fixture({ isAdmin: () => true, adminAction: async request => { calls.push(request); return { admin, wallet: { balance: 0, unlimitedGold: true } }; } });
  await f.hello(); const data = { type: 'GLTCG_ADMIN_REQUEST', requestId: 'admin', sessionId: 'session-1' };
  for (const action of [undefined, 'grant-gold', '__proto__', 'set-unlimited-gold']) {
    await f.send({ ...data, action, enabled: 'true' }); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ADMIN_BLOCKED');
  }
  assert.equal(calls.length, 0);
  for (const enabled of [true, false]) await f.send({ ...data, action: 'set-unlimited-gold', enabled, cards: { kaido: 999 }, gold: Infinity, role: 'admin', profileKey: 'other' });
  await f.send({ ...data, action: 'unlock-all', enabled: true, gold: 999 });
  assert.deepEqual(calls, [{ action: 'set-unlimited-gold', enabled: true }, { action: 'set-unlimited-gold', enabled: false }, { action: 'unlock-all' }]);
  assert.deepEqual(f.messages.at(-1).data.admin, admin); assert.equal(f.messages.at(-1).data.wallet.balance, 0);
});
test('admin writes block purchases, crew saves, learning and overlapping admin actions until confirmation', async () => {
  let finish, calls = 0; const f = fixture({ isAdmin: () => true, adminAction: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
    buyPack: () => { throw Error('must not buy'); }, saveCollection: () => { throw Error('must not save'); } });
  await f.hello(); const data = { type: 'GLTCG_ADMIN_REQUEST', requestId: 'admin', sessionId: 'session-1', action: 'unlock-all' };
  const pending = f.send(data);
  await f.send({ ...data, requestId: 'again' }); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ADMIN_BLOCKED');
  await f.send({ type: 'GLTCG_BUY_REQUEST', requestId: 'buy', sessionId: 'session-1', purchaseId: 'purchase', packId: 'spark' });
  assert.equal(f.messages.at(-1).data.type, 'GLTCG_BUY_BLOCKED');
  await f.send({ type: 'GLTCG_SAVE_REQUEST', requestId: 'save', sessionId: 'session-1', team: [] });
  assert.equal(f.messages.at(-1).data.type, 'GLTCG_SAVE_BLOCKED');
  await f.round(); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ROUND_BLOCKED'); assert.equal(f.messages.at(-1).data.retryable, true);
  assert.equal(f.shown.length, 0); assert.equal(calls, 1); finish({}); await pending;
  await f.round(1, 'after-admin'); assert.equal(f.records.length, 3);
});
test('questions and pending ordinary saves block an admin write without dropping the action', async () => {
  for (const saving of [false, true]) {
    let finish, calls = 0; const f = fixture({ isAdmin: () => true, adminAction: async () => { calls++; return {}; },
      saveCollection: () => new Promise(resolve => { finish = resolve; }),
      presentQuestions: () => new Promise(resolve => { finish = resolve; }) });
    await f.hello(); const pending = saving ? f.send({ type: 'GLTCG_SAVE_REQUEST', requestId: 'save', sessionId: 'session-1' }) : f.round();
    await tick(); const data = { type: 'GLTCG_ADMIN_REQUEST', requestId: 'admin', sessionId: 'session-1', action: 'unlock-all' };
    await f.send(data); assert.equal(calls, 0); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ADMIN_BLOCKED');
    assert.equal(f.messages.at(-1).data.retryable, true); finish(false); await pending;
    await f.send(data); assert.equal(calls, 1); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ADMIN_RESULT');
  }
});
test('live role loss, profile changes and closing suppress late admin success and failure replies', async () => {
  for (const change of ['role', 'profile', 'close']) for (const reject of [false, true]) {
    let finish, fail, admin = true;
    const f = fixture({ isAdmin: () => admin, adminAction: () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }) });
    await f.hello(); const pending = f.send({ type: 'GLTCG_ADMIN_REQUEST', requestId: 'admin', sessionId: 'session-1', action: 'unlock-all' });
    if (change === 'role') admin = false; else if (change === 'profile') f.setIdentity('other-child'); else f.controller.destroy();
    if (reject) fail(Error('offline')); else finish({ admin: { available: true, unlimitedGold: true } });
    await pending; assert.equal(f.messages.some(m => /^GLTCG_ADMIN_(RESULT|BLOCKED)$/.test(m.data.type)), false);
  }
});
test('an admin write failure releases the lock so the same idempotent action can retry', async () => {
  let fail = true; const f = fixture({ isAdmin: () => true, adminAction: async () => { if (fail) throw Error('offline'); return { changed: true }; } });
  await f.hello(); const request = { type: 'GLTCG_ADMIN_REQUEST', requestId: 'admin', sessionId: 'session-1', action: 'set-unlimited-gold', enabled: true };
  await f.send(request); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ADMIN_BLOCKED'); assert.equal(f.messages.at(-1).data.retryable, true);
  fail = false; await f.send(request); assert.equal(f.messages.at(-1).data.type, 'GLTCG_ADMIN_RESULT'); assert.equal(f.messages.at(-1).data.changed, true);
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
  assert.match(app, /Collect 100 One Piece characters and deploy a crew of seven/);
  assert.match(app, /createGrandLineEconomy\(\{\s*getUser:\(\)=>currentUser,/);
});
if (science) test('Science navigation reaches the new overlay without a missing page', () => {
  const start = app.indexOf('function navigateTo(page) {'), endText = "if (page === 'grand-line') { grandLinePortal.open(); return; }";
  const end = app.indexOf(endText, start); assert.ok(end > start);
  let opened = 0, closed = 0; const context = vm.createContext({ vetPrintPeekHide() {}, pirateRiftPortal: { close() {} },
    grandLinePortal: { close() { closed++; }, open() { opened++; } }, _isEmployee: () => false, EMPLOYEE_PAGES: [] });
  vm.runInContext(app.slice(start, end + endText.length) + '\nthrow new Error("missing route");}', context);
  vm.runInContext('navigateTo("grand-line")', context); assert.equal(opened, 1); assert.equal(closed, 1);
});
