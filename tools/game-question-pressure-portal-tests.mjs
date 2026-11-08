import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GameQuestionPressure = require('../game-question-pressure.js');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function fn(name) {
  const start = app.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const firstEnd = app.indexOf('\n', start);
  const end = app.slice(start, firstEnd).trimEnd().endsWith('}') ? firstEnd : app.indexOf('\n}', start) + 2;
  return app.slice(start, end);
}
function harness(mode) {
  const elements = new Map(), timers = [], counts = { attempts: 0, bank: 0, renders: 0 };
  const node = () => ({ innerHTML: '', textContent: '', style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {} }, remove() {}, querySelectorAll: () => [],
    appendChild(child) { this.children.push(child); } });
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
    querySelectorAll: () => [], createElement: node };
  const base = { over: false, answered: 0, correct: 0, streak: 0, bestStreak: 0, hp: 100, maxHp: 100,
    gate: 100, focus: 100, p: { hp: 100, maxHp: 100, armor: 9999, cap: 10, mana: 0, board: [] },
    shield: 9999, revived: false, legend: 'phoenix', defenders: [], mana: 0, sp: 0, card: { id: 'c1', name: 'Test' },
    roundTotal: 0, roundDone: 0, qPoints: 0, gold: 0, cleared: 0, wave: 1 };
  const c = vm.createContext({ GameQuestionPressure, document, console,
    performance: { now: () => 5000 }, setTimeout: fn => { timers.push(fn); return timers.length; },
    escapeHtml: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    _gameLab: (q, i) => String(i + 1), rpgAwardGameQuestion: () => { counts.attempts++; return 2; },
    logGameAttempt() {}, _duelLogAttempt() {}, _emsLogAttempt() {}, duelNoteQuestion() {}, duelSfxPlay() {},
    duelDraw() {}, duelTrainBoard: () => [], emsTrainField: () => [], tcgAddLevelProgress: () => ({ progress: 1 }),
    _tcgQuizStatus() {}, _tcgLevelUpBurst() {}, tcgShortName: c => c.name, TCG_BY_ID: { c1: { name: 'Test' } },
    tcgState: () => ({ siege: {}, legends: {} }), tcgConfetti() {},
    duelBank: () => counts.bank++, emsBank: () => counts.bank++, elgBank: () => counts.bank++,
    duelRender: () => counts.renders++, emsSyncHud() {}, emsRenderDeck() {}, emsManaPop() {}, emsBanner() {},
    emsRefreshDeckState() {}, elgHud() {}, elgBanner() {},
    EMS_GATE_HP: 100, EMS_MANA_CORRECT: 10, EMS_MANA_WRONG: 1, EMS_MANA_CAP: 400, EMS_ROUND_BONUS: 50, ELG_SP_CORRECT: 1, TCG_LVL_STEP: 10,
  });
  const varName = mode === 'train' ? '_tcgQuiz' : mode === 'duel' ? 'duelRun' : mode === 'siege' ? 'emsRun' : 'elgRun';
  c[varName] = base;
  const names = ['tcgQuestionPressure', 'tcgQuestionLossHtml'];
  if (mode === 'train') names.push('_tcgQuizAnswer', '_tcgQuizNext');
  if (mode === 'duel') names.push('duelAnswer', 'duelCloseQuiz', 'duelGameOver', 'duelEndTurn');
  if (mode === 'siege') names.push('emsAnswer', 'emsCloseQuiz', 'emsGameOver', 'emsQuizStreakHud', 'emsStreakMult');
  if (mode === 'legends') names.push('elgAnswer', 'elgCloseQuiz', 'elgGameOver');
  vm.runInContext(names.map(fn).join('\n'), c);
  c._tcgQuizRender = () => counts.renders++;
  const answer = correct => {
    const q = { id: 'plant', a: 0, opts: ['Roots', 'Flowers'], ex: 'Roots absorb water.' };
    if (mode === 'train') { c[varName].cur = q; c[varName].answered = false; c[varName].id = 'c1'; }
    else c[varName].quiz = { q, answered: false, at: 0 };
    c[mode === 'train' ? '_tcgQuizAnswer' : mode === 'duel' ? 'duelAnswer' : mode === 'siege' ? 'emsAnswer' : 'elgAnswer'](correct ? 0 : 1);
  };
  const hp = () => mode === 'train' ? c[varName].focus : mode === 'duel' ? c[varName].p.hp : mode === 'siege' ? c[varName].gate : c[varName].hp;
  const refill = () => { if (mode === 'train') c[varName].focus = 100; else if (mode === 'duel') c[varName].p.hp = 100; else if (mode === 'siege') c[varName].gate = 100; else c[varName].hp = 100; };
  return { c, answer, hp, refill, counts, timers, elements, get run() { return c[varName]; }, fresh() { c[varName] = { ...base, questionPressure: undefined, over: false, quiz: null, p: { ...base.p, hp: 100 }, hp: 100, gate: 100, focus: 100 }; } };
}

for (const mode of ['train', 'duel', 'siege', 'legends']) {
  test(mode + ': consecutive real answer handlers escalate health loss and finish the run', () => {
    const h = harness(mode);
    for (const expected of [92, 76, 48, 3, 0]) { h.answer(false); assert.equal(h.hp(), expected); }
    assert.equal(h.run.over, true);
    assert.equal(h.counts.attempts, 5);
    h.answer(true);
    assert.equal(h.hp(), 0, 'late correct cannot revive');
    assert.equal(h.counts.attempts, 5, 'ended run cannot pay or record another answer');
    if (mode !== 'train') { assert.equal(h.counts.bank, 1); assert.match(h.run.questionLoss.explanation, /absorb/); }
    if (mode === 'train') { h.c._tcgQuizNext(); assert.equal(h.counts.renders, 0); }
    if (mode === 'duel') { h.c.duelEndTurn(); assert.equal(h.run.over, true); }
  });
  test(mode + ': correct answers reset pressure; new runs begin at first penalty', () => {
    const h = harness(mode); h.answer(false); h.answer(false); h.answer(true);
    assert.equal(h.run.questionPressure.wrongStreak, 0);
    const before = h.hp(); h.answer(false); assert.equal(h.hp(), before - 8);
    h.fresh(); h.answer(false); assert.equal(h.hp(), 92); assert.equal(h.run.questionPressure.wrongStreak, 1);
  });
  test(mode + ': shields, healing and round boundaries cannot prevent fifth-error defeat', () => {
    const h = harness(mode);
    for (let i = 1; i <= 5; i++) { h.refill(); h.run.roundDone = 0; h.answer(false); }
    assert.equal(h.hp(), 0); assert.equal(h.run.over, true);
    const before = h.counts.attempts;
    for (const timer of h.timers) timer();
    assert.equal(h.counts.attempts, before);
    assert.equal(h.run.over, true);
  });
  test(mode + ': duplicate answer clicks settle pressure and rewards once', () => {
    const h = harness(mode); h.answer(false);
    const handler = h.c[mode === 'train' ? '_tcgQuizAnswer' : mode === 'duel' ? 'duelAnswer' : mode === 'siege' ? 'emsAnswer' : 'elgAnswer'];
    handler(1); handler(0);
    assert.equal(h.run.questionPressure.wrongStreak, 1); assert.equal(h.hp(), 92); assert.equal(h.counts.attempts, 1);
  });
}

test('pure automatic fights and ordinary practice keep their existing question-free mechanics', () => {
  for (const name of ['rpgBattleRound', 'advTick', 'advArenaEnd', 'tcgRunBattle']) assert.doesNotMatch(fn(name), /GameQuestionPressure|tcgQuestionPressure/);
});

test('training cannot grade the previous question while its replacement is loading', () => {
  const h = harness('train'); h.answer(false);
  h.run.answered = false; h.run.loading = true;
  h.c._tcgQuizAnswer(1);
  assert.equal(h.counts.attempts, 1); assert.equal(h.hp(), 92); assert.equal(h.run.questionPressure.wrongStreak, 1);
});
