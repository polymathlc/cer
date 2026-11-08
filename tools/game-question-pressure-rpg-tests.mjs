import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import Pressure from '../game-question-pressure.js';
import { createCollection } from '../grand-line-core.js';
import { createDefense, applyDefenseQuestionAnswer, completeDefenseLearning, startDefenseWave } from '../grand-line-defense.js';
import { createHadesLearningController } from '../hades-learning-parent.js';
import { createGrandLineLearningController } from '../grand-line-learning-parent.js';

function defense() {
  const b = createDefense(createCollection(), { seed: 914 });
  b.status = 'learning'; b.learning = { round: b.round, completed: false };
  return b;
}
function nextDefenseRound(b) {
  b.round++; b.status = 'learning'; b.learning = { round: b.round, completed: false };
}

test('Grand Line loses escalating actual ship life across waves, bypasses defenses, and cannot revive or win after fifth miss', () => {
  const b = defense(), damages = [];
  b.ship.shield = 100000; b.ship.armor = 100000;
  for (let n = 0; n < 5; n++) {
    if (n === 3) nextDefenseRound(b);
    b.ship.hp = b.ship.maxHp;
    const p = applyDefenseQuestionAnswer(b, false, n % 3);
    damages.push(p.damage);
    assert.equal(b.ship.hp, p.fatal ? 0 : b.ship.maxHp - p.damage);
  }
  assert.deepEqual(damages, [29, 58, 101, 162, 360]);
  assert.equal(b.status, 'defeat'); assert.equal(b.pendingOutcome, 'defeat');
  assert.equal(b.questionPressure.failed, true);
  b.ship.hp = b.ship.maxHp;
  assert.equal(completeDefenseLearning(b, { correct: 3, total: 3, round: b.round }), false);
  assert.equal(startDefenseWave(b), false);
  assert.equal(b.collection.stats.victories, 0); assert.equal(b.collection.completed.length, 0);
});

test('Grand Line rejects duplicate/nonfinal grades, resets on correct and on a fresh defense, and keeps terminal combat rounds separate', () => {
  const b = defense();
  assert.equal(applyDefenseQuestionAnswer(b, null, 0), false);
  assert.equal(applyDefenseQuestionAnswer(b, false, 1), false);
  assert.equal(applyDefenseQuestionAnswer(b, false, 0).streak, 1);
  const hp = b.ship.hp;
  assert.equal(applyDefenseQuestionAnswer(b, false, 0), false); assert.equal(b.ship.hp, hp);
  assert.equal(applyDefenseQuestionAnswer(b, true, 1).reset, true);
  assert.equal(applyDefenseQuestionAnswer(b, false, 2).damage, 29);
  assert.equal(completeDefenseLearning(b, { correct: 2, total: 3, round: b.round }), false);
  assert.ok(completeDefenseLearning(b, { correct: 1, total: 3, round: b.round }));
  assert.equal(b.collection.stats.correctAnswers, 1);
  assert.equal(defense().questionPressure.wrongStreak, 0);
  const fallen = defense(); fallen.ship.hp = 0; fallen.pendingOutcome = 'defeat';
  for (let i = 0; i < 3; i++) assert.equal(applyDefenseQuestionAnswer(fallen, true, i).fatal, false);
  assert.equal(completeDefenseLearning(fallen, { correct: 3, total: 3, round: fallen.round }).outcome, 'defeat');
});

function host(kind, plan, overrides = {}) {
  const count = kind === 'HADES' ? 5 : 3, messages = [], records = [];
  const source = { postMessage(d) { messages.push(d); } };
  const options = { origin: 'https://school.test', subject: 'Science', getFrame: () => ({ contentWindow: source }),
    getIdentity: () => 'learner:P6', getProfileKey: () => 'opaque', isAllowed: () => true, isActive: () => true,
    makeSessionId: () => 'session', getQuestions: async () => Array.from({ length: count }, (_, i) => ({ id: 'q' + i, html: '<p>Question</p>', options: ['A', 'B'], answer: 1 })),
    recordAnswer: x => records.push(x), presentQuestions: async ({ grade }) => { for (let i = 0; i < count; i++) { const r = await grade(i, plan.shift() ? 1 : 0, 50); if (!r || r.pressure?.fatal) return false; } return true; }, ...overrides };
  const make = kind === 'HADES' ? createHadesLearningController : createGrandLineLearningController;
  const controller = make(options);
  const send = d => controller.handleMessage({ origin: options.origin, source, data: d });
  const hello = id => send({ type: kind + '_HELLO', requestId: id || 'hello' });
  const round = (n, runId = 'run-1') => send({ type: kind + '_ROUND_REQUEST', requestId: 'round-' + n, sessionId: 'session', round: n, runId, pressure: 1 });
  return { controller, messages, records, send, hello, round, source, options };
}

for (const kind of ['HADES', 'GLTCG']) {
  test(kind + ' emits only ordered verified grade identities, stops on fatal pressure, and resets for a new run', async () => {
    const plan = Array(12).fill(false), f = host(kind, plan);
    await f.hello(); await f.round(1);
    if (kind === 'GLTCG') await f.round(2);
    const grades = f.messages.filter(d => d.type === kind + '_QUESTION_RESULT');
    assert.equal(grades.length, 5); assert.equal(f.records.length, 5);
    for (const g of grades) {
      assert.equal(g.correct, false); assert.equal(g.sessionId, 'session');
      assert.ok(!('answer' in g) && !('options' in g));
    }
    assert.equal(f.messages.filter(d => d.type === kind + '_ROUND_RESULT').length, kind === 'HADES' ? 0 : 1);
    if (kind === 'HADES') { await f.hello('new-run'); await f.round(1); }
    else await f.round(2, 'new-defense');
    assert.ok(f.records.length > 5, 'a new run gets a fresh pressure state');
  });

  test(kind + ' never applies unconfirmed remote marks or stale/cancelled callbacks', async () => {
    const f = host(kind, [], { getQuestions: async () => Array.from({ length: kind === 'HADES' ? 5 : 3 }, (_, i) => ({ id: 'q' + i, html: '<p>Question</p>', options: ['A', 'B'], grading: 'remote' })),
      gradeQuestion: async () => { throw Error('offline'); }, presentQuestions: async ({ grade }) => { await grade(0, 0, 5); return true; } });
    await f.hello(); await f.round(1);
    assert.equal(f.messages.some(d => d.type === kind + '_QUESTION_RESULT'), false);
    assert.equal(f.records.length, 0);
    assert.equal(await f.send({ type: kind + '_PRESSURE_DEFEAT', requestId: 'stale', sessionId: 'session', round: 1 }), false);
  });
}

function hadesGame() {
  const html = fs.readFileSync(new URL('../hades-game.html', import.meta.url), 'utf8');
  const receive = html.slice(html.indexOf('function receiveLearningMessage(event)'), html.indexOf('function installHadesLearning()'));
  const rewards = html.slice(html.indexOf('function learningRewardForScore(correct)'), html.indexOf('function learningStorageKey()'));
  const parent = {}, location = { origin: 'https://school.test' }, messages = [], endings = [];
  const pending = { requestId: 'request', round: 1, gradeIndex: 0, correct: 0, enter() { endings.push('entered'); } };
  const state = { pending, sessionId: 'session', enabled: true, pressure: Pressure.create(), rewardEpoch: 1, state: 'checkpoint' };
  const player = { hp: 100, maxHp: 100, iFrames: 999, defianceCount: 999 };
  const context = { window: { parent, location }, HADES_LEARNING_ENABLED: true, hadesLearning: state, player, GameQuestionPressure: Pressure,
    gameState: { particles: [] }, document: { hidden: false, getElementById: () => ({ textContent: '' }) }, sound: { stopBGM() {} },
    postLearningMessage: d => messages.push(d), updateHUD() {}, clearLearningTimer() {}, hideLearningWait() {}, resetRuntimeInput() {},
    handleGameOver: win => endings.push(win), savePermanentProgress() {}, resumeRuntime() {}, pauseRuntime() {},
    HADES_BOON_TIERS: { common: { name: 'Common' } }, FloatingText: function () {} };
  vm.createContext(context); vm.runInContext(rewards + '\n' + receive, context);
  const send = (index, correct, extra = {}) => context.receiveLearningMessage({ source: parent, origin: location.origin, data: { type: 'HADES_QUESTION_RESULT', sessionId: 'session', requestId: 'request', round: 1, questionIndex: index, correct, ...extra } });
  return { send, player, state, messages, endings, context, parent };
}

test('actual Hades artifact applies five increasingly severe grades despite invulnerability, full heals and Death Defiance', () => {
  const f = hadesGame(); const damage = [];
  for (let i = 0; i < 5; i++) { f.player.hp = 100; f.send(i, false); damage.push(100 - f.player.hp); }
  assert.deepEqual(damage, [8, 16, 28, 45, 100]);
  assert.deepEqual(f.endings, [false]); assert.equal(f.state.pending, null);
  assert.equal(f.messages.at(-1).type, 'HADES_PRESSURE_DEFEAT');
  f.context.receiveLearningMessage({ source: f.parent, origin: 'https://school.test', data: { type: 'HADES_ROUND_RESULT', sessionId: 'session', requestId: 'request', round: 1, correct: 5, total: 5, healPercent: 40, boonTier: 'heroic' } });
  assert.equal(f.player.hp, 0); assert.deepEqual(f.endings, [false]);
});

test('actual Hades artifact rejects duplicate/out-of-order/malformed grades and correct answers reset pressure', () => {
  const f = hadesGame(); f.send(0, false); const hp = f.player.hp;
  f.send(0, false); f.send(2, false); f.send(1, null); f.send(1, false, { sessionId: 'other' });
  assert.equal(f.player.hp, hp); assert.equal(f.state.pressure.wrongStreak, 1);
  f.send(1, true); assert.equal(f.state.pressure.wrongStreak, 0);
  f.send(2, false); assert.equal(f.player.hp, hp - 8);
});
