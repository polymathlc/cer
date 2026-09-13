import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped handlers, not a parallel model of the game state.
const source = fs.readFileSync(new URL('../fps.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function cut(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
function fixture() {
  const listeners = new Map(), elements = new Map(), storage = new Map(), timers = new Map();
  const counts = { render: 0, credit: 0, record: 0, bank: 0, publish: 0, reload: 0, grenade: 0, ability: 0, pick: 0, lock: 0, cores: 0, menu: 0 };
  let timerId = 0;
  const on = (scope, name, fn) => { const key = scope + ':' + name; if (!listeners.has(key)) listeners.set(key, []); listeners.get(key).push(fn); };
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const el = {
      id, tagName: 'BUTTON', style: {}, dataset: {}, disabled: false, children: [], attributes: {},
      textContent: '', innerHTML: '',
      classList: { contains: value => classes.has(value), add: value => classes.add(value), remove: value => classes.delete(value), toggle(value, state) { state ??= !classes.has(value); state ? classes.add(value) : classes.delete(value); } },
      addEventListener: (name, fn) => on(id, name, fn),
      setAttribute: (name, value) => { el.attributes[name] = value; },
      focus: () => { document.activeElement = el; },
      querySelector(selector) { if (selector === '.verdict') return element('verdict'); if (selector === '.explain') return element('explain'); return el.children[0]; },
      querySelectorAll: selector => selector === '.qopt' ? options : [],
      getClientRects: () => [{}], appendChild: child => el.children.push(child),
    };
    elements.set(id, el); return el;
  }
  const options = [element('answer0'), element('answer1')];
  const canvas = element('gameCanvas');
  canvas.requestPointerLock = () => { counts.lock++; };
  const document = {
    hidden: false, focused: true, activeElement: null, pointerLockElement: null, body: element('body'),
    hasFocus() { return document.focused; },
    exitPointerLock() { document.pointerLockElement = null; },
    addEventListener: (name, fn) => on('document', name, fn),
    querySelectorAll: selector => selector === '#qOptions .qopt' ? options : [],
    createElement: () => element('created' + elements.size),
  };
  const window = {
    addEventListener: (name, fn) => on('window', name, fn),
    matchMedia: () => ({ matches: false }),
  };
  const q = { id: 'plant', topic: 'Plant Systems', feedKey: 'child', options: ['Roots', 'Flowers'], answer: 0, explain: 'Roots absorb water.' };
  const c = vm.createContext({
    console, Math, Number, String, Object, Array, JSON, Promise,
    window, document, canvas, $: element, keys: {}, pointerLocked: false, skillsOpen: false, skillsFromPause: false,
    G: { paused: false, over: false, activeQ: null, draftOpen: false, playSeconds: 0, qTimerMs: 15000,
      qOpenedAt: 0, questionAnswered: false, qCorrect: 0, qTotal: 0, streak: 0, bestStreak: 0, nextDropFloorTier: 0,
      ammo: 0, grenades: { count: 0 }, player: { hp: 30, maxHp: 100, x: 1, y: 1, dir: 0, pitch: 0 } },
    currentUser: { name: 'Ada', role: 'student' }, fpsFeedReady: true, studentLevelCap: 4,
    fpsQuestionCandidate: () => q, fpsFeedKey: () => 'child',
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    performance: { now: () => 5000 }, raf: 0, lastT: 0, qLockT: 0,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    toggleMute() {}, startReload: () => counts.reload++, tryPickup: () => counts.pick++, throwGrenade: () => counts.grenade++, useAbility: () => counts.ability++,
    pickDraft: () => counts.pick++, openSkills() {}, closeSkills() {}, endRun() {},
    enterMenu: () => counts.menu++, startRun() {}, render: () => counts.render++, updateHud() {},
    healPlayer() {}, magSize: () => 12, awardCores: n => { counts.cores += n; }, luckNow: () => 1,
    fpsPublish: () => counts.publish++, _myFpsBoard: { correct: 0 }, increment: value => value,
    sfx: { qGood() {}, qBad() {}, qPop() {} }, recordAttempt: () => counts.record++, bankPortalPoints: () => { counts.bank++; return 8; },
    spendGameCredit: () => { counts.credit++; return true; },
    isAdmin: () => false, levelLabel: n => 'P' + n,
    nextQuestion: () => q, QUESTION_INTERVAL: 15000, fpsWireQuestionImages() {}, toast() {},
  });
  vm.runInContext(cut('// The simulation may advance', '/* ════════════════ COMBAT'), c);
  const emit = (scope, name, extra = {}) => {
    const event = { code: '', repeat: false, button: 0, target: canvas, prevented: false,
      preventDefault() { this.prevented = true; }, ...extra };
    for (const fn of listeners.get(scope + ':' + name) || []) fn(event);
    return event;
  };
  const run = code => vm.runInContext(code, c);
  const grant = () => { document.pointerLockElement = canvas; emit('document', 'pointerlockchange'); };
  const held = () => { c.keys.KeyW = true; run('mouseDown = true; adsHeld = true'); };
  return { c, run, counts, document, window, canvas, q, options, element, emit, grant, held, timers, storage };
}

test('FPS module remains syntactically valid and versioned', () => {
  const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  new vm.Script(script.replace(/^import .*;\n/gm, ''));
  assert.match(source, /Science Strike v1\.9\.0/);
});

test('combat waits for confirmed pointer lock; duplicate confirmations are harmless', () => {
  const f = fixture(); f.c.requestLock();
  assert.equal(f.c.combatReady(), false); assert.equal(f.c.G.paused, true);
  f.grant(); assert.equal(f.c.combatReady(), true);
  f.grant(); assert.equal(f.c.combatReady(), true);
  assert.equal(f.element('pauseOverlay').classList.contains('active'), false);
});

test('a denied pointer lock keeps the run paused with a retry action', async () => {
  const f = fixture(); f.canvas.requestPointerLock = () => Promise.reject(new Error('blocked'));
  f.c.requestLock(); await Promise.resolve();
  assert.equal(f.c.G.paused, true); assert.equal(f.c.combatReady(), false);
  assert.match(f.element('pauseReason').textContent, /not allowed/);
  assert.equal(f.element('pauseOverlay').classList.contains('active'), true);
});

test('a lock granted after switching tabs cannot resume combat', () => {
  const f = fixture(); f.c.requestLock(); f.document.hidden = true;
  f.emit('document', 'visibilitychange'); f.grant();
  assert.equal(f.c.G.paused, true); assert.equal(f.document.pointerLockElement, null);
});

for (const cause of ['blur', 'hidden', 'escape', 'pointer-loss']) test(cause + ' pauses and releases movement, firing and aiming', () => {
  const f = fixture(); f.c.requestLock(); f.grant(); f.held();
  if (cause === 'blur') { f.document.focused = false; f.emit('window', 'blur'); }
  if (cause === 'hidden') { f.document.hidden = true; f.emit('document', 'visibilitychange'); }
  if (cause === 'escape') f.emit('document', 'keydown', { code: 'Escape' });
  if (cause === 'pointer-loss') { f.document.pointerLockElement = null; f.emit('document', 'pointerlockchange'); }
  assert.equal(f.c.G.paused, true); assert.equal(Object.keys(f.c.keys).length, 0);
  assert.equal(f.run('mouseDown || adsHeld'), false);
  f.document.hidden = false; f.document.focused = true;
  assert.equal(f.c.combatReady(), false, 'returning focus never resumes automatically');
});

test('question and draft overlays stay in front when focus is lost', () => {
  for (const property of ['activeQ', 'draftOpen']) {
    const f = fixture(); f.c.G[property] = property === 'activeQ' ? f.q : true;
    f.emit('window', 'blur');
    assert.equal(f.c.G.paused, true); assert.equal(f.element('pauseOverlay').classList.contains('active'), false);
  }
});

test('simulation and science countdown stay frozen while lock is missing', () => {
  const f = fixture(); vm.runInContext(cut('function tick(now)', '/* ════════════════ RENDER'), f.c);
  f.held(); const before = JSON.stringify(f.c.G.player); f.c.tick(1000);
  assert.equal(f.c.G.qTimerMs, 15000); assert.equal(f.c.G.playSeconds, 0);
  assert.equal(JSON.stringify(f.c.G.player), before); assert.equal(f.c.G.paused, true);
});

test('modal keys and held repeats cannot fire abilities or pick upgrades under the skill tree', () => {
  const f = fixture(); f.c.requestLock(); f.grant();
  f.emit('document', 'keydown', { code: 'KeyQ', repeat: true }); assert.equal(f.counts.grenade, 0);
  f.c.G.draftOpen = true; f.c.skillsOpen = true;
  f.emit('document', 'keydown', { code: 'Digit1' }); assert.equal(f.counts.pick, 0);
  f.emit('document', 'keydown', { code: 'KeyF' }); assert.equal(f.counts.ability, 0);
});

test('settings inputs retain keyboard control and do not move the player', () => {
  const f = fixture(); f.c.requestLock(); f.grant();
  f.emit('document', 'keydown', { code: 'KeyW', target: { tagName: 'INPUT' } });
  f.emit('document', 'keydown', { code: 'KeyQ', target: { tagName: 'INPUT' } });
  assert.equal(f.counts.grenade, 0); assert.equal(Object.keys(f.c.keys).length, 0);
});

test('opening a question clears held controls and applies the answer guard', () => {
  const f = fixture();
  vm.runInContext(cut('function openQuestion()', 'let qLockT = 0;'), f.c);
  f.held(); f.c.openQuestion();
  assert.equal(f.c.G.activeQ, f.q); assert.equal(f.c.G.paused, true);
  assert.equal(f.run('mouseDown || adsHeld'), false); assert.equal(Object.keys(f.c.keys).length, 0);
  assert.equal(f.element('qOptions').classList.contains('qlock'), true);
  assert.equal(f.document.activeElement, f.element('qStem'));
});

test('one shown question records one attempt and pays once despite rapid clicks or number keys', () => {
  const f = fixture(); vm.runInContext(cut('function answerQuestion(i, btn)', '/* ---- 🪙 Portal points'), f.c);
  f.c.G.activeQ = f.q;
  f.emit('document', 'keydown', { code: 'Digit1' });
  f.c.answerQuestion(0, f.options[0]);
  f.emit('document', 'keydown', { code: 'Digit1', repeat: true });
  assert.equal(f.c.G.qTotal, 1); assert.equal(f.c.G.qCorrect, 1);
  assert.equal(f.counts.record, 1); assert.equal(f.counts.bank, 1); assert.equal(f.counts.publish, 1);
  assert.equal(f.counts.cores, 5); assert.equal(f.c.G.grenades.count, 1);
  assert.equal(f.document.activeElement, f.element('qFeedback'));
});

test('wrong-answer feedback identifies the correct numbered option and settles once', () => {
  const f = fixture(); vm.runInContext(cut('function answerQuestion(i, btn)', '/* ---- 🪙 Portal points'), f.c);
  f.c.G.activeQ = f.q; f.c.answerQuestion(1, f.options[1]); f.c.answerQuestion(0, f.options[0]);
  assert.match(f.element('verdict').textContent, /correct choice is 1/);
  assert.equal(f.c.G.qCorrect, 0); assert.equal(f.c.G.qTotal, 1); assert.equal(f.counts.bank, 1);
});

test('answer window, stale child, invalid option and dead run produce no result', () => {
  const f = fixture(); vm.runInContext(cut('function answerQuestion(i, btn)', '/* ---- 🪙 Portal points'), f.c);
  f.c.G.activeQ = f.q; f.element('qOptions').classList.add('qlock'); f.c.answerQuestion(0, f.options[0]);
  f.element('qOptions').classList.remove('qlock'); f.c.answerQuestion(-1, f.options[0]);
  f.q.feedKey = 'other'; f.c.answerQuestion(0, f.options[0]);
  f.q.feedKey = 'child'; f.c.G.over = true; f.c.answerQuestion(0, f.options[0]);
  assert.equal(f.counts.record, 0); assert.equal(f.counts.bank, 0);
});

test('continuing requires a settled current question and waits for lock again', () => {
  const f = fixture(); vm.runInContext(cut("$('qContinue').addEventListener", '/* ════════════════ RUN END'), f.c);
  f.c.G.activeQ = f.q; f.emit('qContinue', 'click'); assert.equal(f.c.G.activeQ, f.q);
  f.c.G.questionAnswered = true; f.emit('qContinue', 'click');
  assert.equal(f.c.G.activeQ, null); assert.equal(f.c.G.paused, true); assert.equal(f.counts.lock, 1);
  f.grant(); assert.equal(f.c.combatReady(), true);
});

test('identity change cancels the old run without publishing it under the new child', () => {
  const f = fixture(); f.c.requestLock(); f.grant(); f.held(); f.c.G.activeQ = f.q;
  f.c.fpsCancelRunForIdentityChange();
  assert.equal(f.c.G, null); assert.equal(f.counts.publish, 0); assert.equal(f.counts.bank, 0);
  assert.equal(f.document.pointerLockElement, null); assert.equal(f.counts.menu, 1);
  assert.equal(f.run('mouseDown || adsHeld'), false);
});

test('loading, empty bank, unknown level and unsupported controls block before spending credit', () => {
  for (const reason of ['loading', 'empty', 'level', 'unsupported', 'touch']) {
    const f = fixture(); f.c.G = null;
    vm.runInContext(cut('function strikeStartIssue()', 'function luckNow()'), f.c);
    if (reason === 'loading') f.c.fpsFeedReady = false;
    if (reason === 'empty') f.c.fpsQuestionCandidate = () => null;
    if (reason === 'level') f.c.studentLevelCap = 0;
    if (reason === 'unsupported') delete f.canvas.requestPointerLock;
    if (reason === 'touch') f.window.matchMedia = () => ({ matches: true });
    f.c.startRun(); assert.equal(f.counts.credit, 0, reason); assert.equal(f.c.G, null);
    assert.ok(f.element('strikeReadiness').textContent);
  }
});

test('a second start cannot charge a second credit while a run already exists', () => {
  const f = fixture(); vm.runInContext(cut('function strikeStartIssue()', 'function luckNow()'), f.c);
  f.c.startRun(); assert.equal(f.counts.credit, 0);
});

test('aim settings clamp corrupt values and honor the system reduced-motion preference', () => {
  const f = fixture(); f.storage.set('scienceStrike:controls', JSON.stringify({ sensitivity: 10 }));
  f.window.matchMedia = () => ({ matches: true });
  const settings = f.c.readStrikeSettings(); assert.equal(settings.sensitivity, 2); assert.equal(settings.reducedMotion, true);
  f.storage.set('scienceStrike:controls', '{broken');
  assert.equal(f.c.readStrikeSettings().sensitivity, 1);
});

test('a current failed diagram withdraws safely without recording a wrong answer', () => {
  const f = fixture(); const images = [];
  f.c.fpsFailedImages = new Map(); f.c.G.activeQ = f.q;
  vm.runInContext(cut('function fpsWireQuestionImages(container,q)', 'async function loadQuestions()'), f.c);
  f.c.fpsWireQuestionImages({ querySelectorAll: () => [{ complete: false, getAttribute: () => '/missing.png', addEventListener: (name, fn) => images.push(fn) }] }, f.q);
  images[0]();
  assert.equal(f.c.G.activeQ, null); assert.equal(f.c.G.paused, true); assert.equal(f.c.G.qTimerMs, 15000);
  assert.equal(f.counts.record, 0); assert.match(f.element('pauseReason').textContent, /diagram could not load/);
});

test('every weapon muzzle remains visible in hip fire, ADS, recoil and reduced-motion modes', () => {
  let matrix = [1, 0, 0, 1, 0, 0], stack = [], muzzle;
  const point = (x, y) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] });
  const ctx = {
    save() { stack.push([...matrix]); }, restore() { matrix = stack.pop(); },
    translate(x, y) { const p = point(x, y); matrix[4] = p.x; matrix[5] = p.y; },
    rotate(r) { const [a,b,c,d,e,f] = matrix, co = Math.cos(r), si = Math.sin(r); matrix = [a*co+c*si,b*co+d*si,c*co-a*si,d*co-b*si,e,f]; },
    scale(x, y) { matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y; },
    beginPath() {}, closePath() {}, roundRect() {}, fill() {}, stroke() {}, arc() {}, ellipse() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, fillRect() {},
  };
  const c = vm.createContext({ ctx, Math, performance: { now: () => 1000 }, REND_W: 960, REND_H: 540, bobT: .3, swayX: 12, swayY: 10,
    strikeSettings: { reducedMotion: false }, G: null });
  vm.runInContext(cut('const ARCHETYPES = [', 'const PREFIX =') + cut('function drawGunModel(g, w)', '// full-model sprite cache') + cut('function drawViewModel()', '// sniper/AR scope:'), c);
  const realDraw = c.drawGunModel;
  c.drawGunModel = (canvas, weapon) => { const x = realDraw(canvas, weapon); muzzle = point(x - 6, -12); return x; };
  const archetypes = vm.runInContext('ARCHETYPES', c);
  for (const arch of archetypes) for (const reducedMotion of [false, true]) for (const ads of [0, 1]) for (const gunKick of [0, 1]) {
    c.strikeSettings.reducedMotion = reducedMotion;
    c.G = { weapon: { arch, rarity: { color: '#fff' }, element: 'none' }, ads, gunKick, reloading: 0, casings: [], particles: [] };
    c.drawViewModel();
    const label = `${arch.key}, reducedMotion=${reducedMotion}, ADS=${ads}, recoil=${gunKick}`;
    assert.ok(muzzle.x > 20 && muzzle.x < 940 && muzzle.y > 300 && muzzle.y < 525, `${label}: muzzle ${JSON.stringify(muzzle)}`);
    assert.equal(stack.length, 0, 'canvas transform stack stays balanced');
  }
});
