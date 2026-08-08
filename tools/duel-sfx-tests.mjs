// Regression tests for EMBER DUEL's sound and screen shake. Run with:
//     node tools/duel-sfx-tests.mjs            all cases
//     node tools/duel-sfx-tests.mjs <name>     one case
//
// It loads the REAL sound section out of app.js and runs it against a Web Audio
// shim that records every node and every scheduled value, so it tests the
// shipping code rather than a copy of it.
//
// What is actually being pinned here is the promise the feature makes: the
// bigger the damage, the more dramatic the result. That is a LADDER across four
// tiers — loudness, pitch and shake all have to move the same way — and it is
// exactly the kind of table a later tuning pass can quietly break without any
// visible symptom, because nobody hears a regression in a number.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const a = src.indexOf('// ---- Sound and the screen shake');
const b = src.indexOf('// ---- Rendering ---', a);
if (a < 0 || b < 0) throw new Error('sound section not found in app.js — did the banner comment change?');
const section = src.slice(a, b);

// ---- the shim --------------------------------------------------------------
// Every node records what it was told to do; `log` is the flat event list a
// case asserts against.
let log = [];
const param = (node, name) => ({
  set value(v) { log.push({ node, param: name, set: v }); },
  get value() { return 0; },
  setValueAtTime: (v, t) => log.push({ node, param: name, at: t, v }),
  linearRampToValueAtTime: (v, t) => log.push({ node, param: name, ramp: 'lin', at: t, v }),
  exponentialRampToValueAtTime: (v, t) => log.push({ node, param: name, ramp: 'exp', at: t, v })
});
const node = kind => {
  const n = { kind, connect: () => {}, disconnect: () => {} };
  n.gain = param(kind, 'gain');
  n.frequency = param(kind, 'frequency');
  n.Q = param(kind, 'Q');
  n.playbackRate = param(kind, 'playbackRate');
  Object.defineProperty(n, 'type', { set: v => log.push({ node: kind, type: v }), get: () => '' });
  Object.defineProperty(n, 'buffer', { set: v => log.push({ node: kind, buffer: v }), get: () => null });
  n.start = t => log.push({ node: kind, start: t });
  n.stop = t => log.push({ node: kind, stop: t });
  return n;
};
class FakeAC {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = node('dest'); }
  createGain() { return node('gain'); }
  createOscillator() { return node('osc'); }
  createBiquadFilter() { return node('filter'); }
  createBufferSource() { return node('src'); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  resume() {}
}
let store = {};
const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
let classes = new Set(), quakeEl = null;
const makeEl = () => ({
  offsetWidth: 1,
  classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }
});
let timers = [];
const runTimers = () => { const t = timers; timers = []; t.forEach(f => { try { f(); } catch (_) {} }); };

const env = {
  window: { AudioContext: FakeAC },
  localStorage,
  document: { getElementById: id => (id === 'duelOverlay' ? quakeEl : null) },
  fetch: () => Promise.reject(new Error('offline in tests')),
  setTimeout: (f, ms) => { timers.push(f); return timers.length; },
  clearTimeout: () => {},
  duelRender: () => {},
  console
};
// A fresh instance per call: duelSfxOn() caches the student's choice for the
// life of the page, so the muted case has to be its own "page load".
const build = () => new Function(...Object.keys(env), section + '\nreturn {' + [
  'DUEL_HIT_TIERS', 'DUEL_HEAL_TIERS', 'DUEL_SLAY_TIER', 'DUEL_HIT_DELAY',
  'duelHitTier', 'duelHealTier', 'duelSfxOn', 'duelToggleSfx', 'duelSfxCue',
  'duelQuake', 'duelSfxFlush', '_duelSfxBuf: () => _duelSfxBuf'
].join(',') + '};')(...Object.values(env));
const M = build();

// ---- harness ---------------------------------------------------------------
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error((what || 'value') + ': got ' + g + ', wanted ' + w);
};
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const reset = () => { log = []; store = {}; classes = new Set(); quakeEl = makeEl(); timers = []; };

// ---- the ladder ------------------------------------------------------------
// The whole feature in one assertion: every tier is louder, deeper, longer and
// shakes harder than the one below it. Retuning the table is fine; inverting a
// rung is the bug.
test('tiers climb on every axis', () => {
  const t = M.DUEL_HIT_TIERS;
  eq(t.length, 4, 'tier count');
  for (let i = 1; i < t.length; i++) {
    ok(t[i].gain > t[i - 1].gain, 'tier ' + i + ' must be louder than ' + (i - 1));
    ok(t[i].body < t[i - 1].body, 'tier ' + i + ' must be deeper than ' + (i - 1));
    ok(t[i].dur > t[i - 1].dur, 'tier ' + i + ' must last longer than ' + (i - 1));
    ok(t[i].noise > t[i - 1].noise, 'tier ' + i + ' must crack harder than ' + (i - 1));
    ok(t[i].sub >= t[i - 1].sub, 'tier ' + i + ' must not lose sub');
    eq(t[i].quake, t[i - 1].quake + 1, 'quake step at tier ' + i);
  }
  ok(t[t.length - 1].max === Infinity, 'the top tier must be open-ended — a 40-damage blow needs a sound');
});

test('damage picks its tier at the boundaries', () => {
  const cue = n => M.duelHitTier(n).cue;
  eq([1, 2, 3, 5, 6, 9, 10, 99].map(cue),
     ['hit1', 'hit1', 'hit2', 'hit2', 'hit3', 'hit3', 'hit4', 'hit4'], 'ladder');
  // Zero never reaches duelSfxCue (duelSfxFlush guards on dmg > 0), but a tier
  // must still come back rather than undefined — a crash on the play path is
  // how a whole turn's audio disappears.
  ok(M.duelHitTier(0), 'tier for 0');
  ok(M.duelHitTier(-5), 'tier for a negative');
});

test('healing has its own two-step ladder', () => {
  eq([1, 4, 5, 30].map(n => M.duelHealTier(n).cue), ['heal1', 'heal1', 'heal2', 'heal2'], 'heal ladder');
  const [s, big] = M.DUEL_HEAL_TIERS;
  ok(big.gain > s.gain && big.dur > s.dur, 'the big heal must be fuller');
  ok(big.steps.length > s.steps.length, 'the big heal must be more of the chord');
  ok(M.DUEL_HEAL_TIERS.every(t => t.synth === 'heal'), 'heal tiers must not route to the impact synth');
});

// ---- what a flush actually plays -------------------------------------------
const started = () => log.filter(x => x.start !== undefined);
const freqAt0 = () => (log.filter(x => x.node === 'osc' && x.param === 'frequency' && x.at === 0)[0] || {}).v;

test('one blow, one sound', () => {
  reset();
  M.duelSfxFlush([{ t: 'm', uid: 1, amount: 4, cls: 'dmg' }], false);
  ok(started().length >= 2, 'an impact is layered — noise plus a body');
  eq(classes.has('duel-quake-2'), true, 'a 4-damage hit shakes at level 2');
});

test('an area spell is ONE big blow, not five overlapping ones', () => {
  reset();
  M.duelSfxFlush([
    { t: 'm', uid: 1, amount: 3, cls: 'spell' },
    { t: 'm', uid: 2, amount: 3, cls: 'spell' },
    { t: 'm', uid: 3, amount: 11, cls: 'spell' },
    { t: 'm', uid: 4, amount: 3, cls: 'spell' }
  ], false);
  // Sized by the LOUDEST, and played once: four impacts at once clip, and four
  // separate light taps is not what an eleven-damage nuke sounds like.
  eq(freqAt0(), M.DUEL_HIT_TIERS[3].body * 2.4, 'sized by the biggest damage in the batch');
  eq(classes.has('duel-quake-4'), true, 'the shake follows the biggest damage too');
  // The body is the triangle; the sub under it is a sine. One body means one blow.
  eq(log.filter(x => x.node === 'osc' && x.type === 'triangle').length, 1, 'exactly one body per flush');
});

test('a blow to your own hero counts for more', () => {
  reset();
  M.duelSfxFlush([{ t: 'h', who: 'P', amount: 9, cls: 'dmg' }], false);
  const own = freqAt0();
  reset();
  M.duelSfxFlush([{ t: 'h', who: 'E', amount: 9, cls: 'dmg' }], false);
  ok(own < freqAt0(), 'nine to your own face must land deeper than nine to the rival');
  reset();
  M.duelSfxFlush([{ t: 'm', uid: 7, amount: 9, cls: 'dmg' }], false);
  ok(own < freqAt0(), '…and deeper than nine to a minion');
});

test('the hit waits for the attacker to arrive', () => {
  reset();
  M.duelSfxFlush([{ t: 'lunge', uid: 1 }, { t: 'm', uid: 2, amount: 5, cls: 'dmg' }], true);
  eq(started().every(x => x.start >= M.DUEL_HIT_DELAY), true, 'a lunging attack delays its impact');
  eq(classes.size, 0, 'and the shake is delayed with it');
  runTimers();
  eq(classes.has('duel-quake-2'), true, 'the shake lands when the blow does');
});

test('a trade heals, kills and hits in one flush', () => {
  reset();
  M.duelSfxFlush([
    { t: 'm', uid: 1, amount: 6, cls: 'dmg' },
    { t: 'm', uid: 1, amount: 0, cls: 'slay' },
    { t: 'h', who: 'P', amount: 6, cls: 'heal' }
  ], false);
  // The heal is NOT delayed behind the impact — lifesteal reads as one motion.
  eq(started().some(x => x.start === 0), true, 'the heal plays immediately');
  eq(started().some(x => x.start > 0), true, 'the death lands after the blow');
});

test('nothing that is not damage shakes the screen', () => {
  ['freeze', 'shield', 'buff', 'rank'].forEach(cls => {
    reset();
    M.duelSfxFlush([{ t: 'm', uid: 1, amount: 3, cls }], false);
    eq(classes.size, 0, cls + ' must not shake the board');
  });
  reset();
  M.duelSfxFlush([{ t: 'm', uid: 1, amount: 5, cls: 'heal' }], false);
  eq(classes.size, 0, 'healing must not shake the board');
  ok(started().length > 0, '…but it must still be heard');
});

test('a flush with nothing in it plays nothing', () => {
  reset();
  M.duelSfxFlush([], false);
  M.duelSfxFlush(null, false);
  M.duelSfxFlush([{ t: 'lunge', uid: 1 }], true);
  eq(started().length, 0, 'a lunge on its own is silent — the impact is the sound');
});

// ---- the switch ------------------------------------------------------------
test('the sound switch really silences it', () => {
  reset();
  store['sq_duel_sfx'] = '0';
  const muted = build();                      // a page opened by a student who had turned it off
  eq(muted.duelSfxOn(), false, 'a stored 0 is off');
  log = [];
  muted.duelSfxFlush([{ t: 'm', uid: 1, amount: 12, cls: 'dmg' }], false);
  eq(started().length, 0, 'nothing is scheduled while the duel is muted');
  // The shake is motion, not sound — muting must not take it away.
  eq(classes.has('duel-quake-4'), true, 'the screen still shakes with the sound off');
});

// ---- the shake -------------------------------------------------------------
test('the shake is clamped and never stacks', () => {
  reset();
  M.duelQuake(9, 0);
  eq(classes.has('duel-quake-4'), true, 'over the top clamps to 4');
  M.duelQuake(0, 0);
  eq([...classes], ['duel-quake-1'], 'under the bottom clamps to 1, and the old class is gone');
  M.duelQuake(3, 0);
  eq([...classes], ['duel-quake-3'], 'only ever one quake class at a time');
});

test('a shake with no board on screen is a no-op, not a crash', () => {
  reset();
  quakeEl = null;
  M.duelQuake(3, 0);
  M.duelSfxFlush([{ t: 'm', uid: 1, amount: 8, cls: 'dmg' }], false);
  ok(started().length > 0, 'the sound still plays when the overlay has gone');
});

// ---- samples beat the synth ------------------------------------------------
test('a loaded sample is used instead of the synth', () => {
  reset();
  const buf = M._duelSfxBuf();
  buf.hit3 = { fake: 'buffer' };
  M.duelSfxCue(M.duelHitTier(7), 0);
  eq(log.filter(x => x.node === 'src' && x.buffer).length, 1, 'the sample is played');
  eq(log.some(x => x.node === 'osc'), false, 'and the synth does not double it');
  eq(log.filter(x => x.param === 'playbackRate')[0].set, M.DUEL_HIT_TIERS[2].rate, 'at the tier pitch');
  delete buf.hit3;
});

test('a cue with no sample falls through to the synth', () => {
  reset();
  M.duelSfxCue(M.duelHitTier(7), 0);
  ok(log.some(x => x.node === 'osc'), 'the synth carries a cue with no file');
});

// ---- run -------------------------------------------------------------------
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name.indexOf(only) < 0) continue;
  reset();
  try { c.fn(); pass++; console.log('  ok   ' + c.name); }
  catch (e) { fail++; console.log('  FAIL ' + c.name + '\n         ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
