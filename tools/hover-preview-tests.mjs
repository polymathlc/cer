// 👁 THE HOVER PREVIEW STAYS OPEN — the question bank's tile card and the
// past-paper chip card share one element and one set of timers.
//
// Loads the REAL machinery out of app.js and runs it against a stub DOM. Every
// failure here is the same symptom and it is maddening rather than obvious:
// the card closes by itself, at no fixed moment, with nothing on any screen to
// explain it — so it reads as the app being flaky rather than as a bug anyone
// can report precisely.
//
//   node tools/hover-preview-tests.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'app.js'), 'utf8');

let passed = 0, failed = 0;
const tests = [];
function ok(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ ' + msg); } }
function test(name, fn) { tests.push([name, fn]); }
function runAll() {
  for (const [name, fn] of tests) {
    const before = failed;
    try { fn(); if (failed === before) console.log('✓ ' + name); else console.error('✗ ' + name); }
    catch (e) { failed++; console.error('✗ ' + name + '\n    ' + (e && e.stack || e)); }
  }
  console.log(failed ? `\n❌ ${passed} passed, ${failed} failed` : `\n✅ ${passed} passed, 0 failed`);
  process.exit(failed ? 1 : 0);
}
function cut(from, to, what) {
  const a = src.indexOf(from);
  if (a < 0) throw new Error('cannot find the start of ' + what + ': ' + from);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error('cannot find the end of ' + what + ': ' + to);
  return src.slice(a, b);
}

// ---- a card element with a real rectangle, so "is the pointer inside it"
//      can be asked honestly ---------------------------------------------
class Card {
  constructor() {
    this.id = ''; this.style = { display: 'none', left: '', top: '' };
    this.classes = new Set(); this.listeners = {};
    this.innerHTML = ''; this.scrollTop = 0;
    this.offsetWidth = 400; this.offsetHeight = 300; this.scrollHeight = 900; this.clientHeight = 300;
    this.rect = { left: 100, top: 100, right: 500, bottom: 400 };
  }
  addEventListener(k, cb) { (this.listeners[k] = this.listeners[k] || []).push(cb); }
  fire(k, ev) { (this.listeners[k] || []).forEach(cb => cb(ev || {})); }
  classList = {
    add: c => this.classes.add(c), remove: c => this.classes.delete(c),
    contains: c => this.classes.has(c),
  };
  getBoundingClientRect() { return this.rect; }
  querySelector() { return null; }
  appendChild(c) { return c; }
  contains() { return true; }
}

function harness(opts) {
  const o = opts || {};
  const card = new Card();
  const timers = new Map(); let seq = 0;
  const state = { bank: o.bank || [{ id: 'q1' }, { id: 'q2' }], flushes: 0, hidden: 0, rendered: [] };
  const doc = {
    createElement: () => card,
    body: { appendChild() {} },
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    activeElement: null,
  };
  const win = {
    innerWidth: 1400, innerHeight: 900,
    addEventListener() {},
    matchMedia: () => ({ matches: o.hover !== false }),
    requestAnimationFrame: cb => { const id = ++seq; timers.set(id, { cb, ms: -1, raf: true }); return id; },
  };
  const f = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'requestAnimationFrame',
    'pvsFlush', 'state', 'escapeHtml', 'card', `
    const _docQById = id => state.bank.find(q => q.id === id);
    let _ppHoverEl = null;
    const ppHoverHtml = id => 'PAPER ' + id;
    const ppBankHoverHtml = (id, note) => 'BANK ' + id;
    const BANK_HOVER_MS = 2500;
    let _bankHoverTimer = null, _bankHoverId = null, _bankHoverPt = null;
    ${cut('// -------- hover preview --------', '// "Not in syllabus" ribbon', 'ppHoverEl')}
    ${cut("let _ppHoverTimer = null;", 'function ppBankHoverHtml(qid, note){', 'the hover state, _ppHoverOpen and ppHoverShow')}
    ${cut('function ppHoverShowBank(ev, qid, note){', '// Admin action from the locked preview', 'showBank, move and expand')}
    ${cut('function ppHoverChipLeave(){', "\ndocument.addEventListener('keydown'", 'chipLeave + hide')}
    ${cut('// Cancelling what is PENDING', '\nfunction qbTileHoverMove(ev) {', 'the bank hover')}
    ${cut('function qbTileHoverMove(ev) {', '\n// Clicking a tile adds', 'move + leave')}
    // A stand-in for renderQuestionBank's first three lines — the only part of
    // it this is about. Kept as a COPY of the real guard and pinned against the
    // real source by the census below.
    function renderBankGuard() {
      qbTileHoverCancelPending();
      if (_ppHoverKey.indexOf('bank:') === 0 && !_docQById(_ppHoverKey.slice(5))) ppHoverHide();
    }
    return { ppHoverShow, ppHoverShowBank, ppHoverExpand, ppHoverHide, ppHoverChipLeave, ppHoverMove,
      qbTileHoverEnter, qbTileHoverMove, qbTileHoverLeave, qbTileHoverCancelPending, renderBankGuard,
      get key(){ return _ppHoverKey; }, get locked(){ return _ppHoverLocked; },
      get shown(){ return card.style.display === 'block'; } };
  `);
  const api = f(doc, win,
    (cb, ms) => { const id = ++seq; timers.set(id, { cb, ms }); return id; },
    id => timers.delete(id),
    cb => { const id = ++seq; timers.set(id, { cb, ms: -1, raf: true }); return id; },
    () => { state.flushes++; }, state,
    s => String(s), card);
  // Fire every timer whose delay matches, oldest first; -1 means an rAF.
  const fire = ms => {
    Array.from(timers.entries()).filter(([, t]) => t.ms === ms).forEach(([id, t]) => { timers.delete(id); t.cb(); });
  };
  const raf = () => fire(-1);
  const pending = ms => Array.from(timers.values()).filter(t => t.ms === ms).length;
  return { api, card, timers, fire, raf, pending, state };
}
const ev = (x, y) => ({ clientX: x, clientY: y });

// Open a bank card the way a real rest on a tile does.
function openBank(h, qid) {
  h.api.qbTileHoverEnter(ev(200, 200), qid || 'q1');
  h.fire(2500);          // the dwell
  h.raf();               // the expand's re-anchor
  return h;
}

// ---- the bug this exists for ----------------------------------------------
test('a background re-render does NOT close a card the teacher is reading', () => {
  const h = harness(); openBank(h, 'q1');
  ok(h.api.shown && h.api.locked, 'the card did not open');
  ok(h.api.key === 'bank:q1', 'the card does not record what it is showing: ' + h.api.key);
  // The usage backfill lands, or another tab syncs a question: renderQuestionBank
  // runs, through nothing the teacher did.
  h.api.renderBankGuard();
  ok(h.api.shown, 'a re-render closed the preview — this IS the reported bug');
  ok(h.pending(2500) === 0, 'the pending dwell survived the re-render and will fire at a tile that is gone');
});

test('…but a card whose question really has left the bank is closed', () => {
  const h = harness(); openBank(h, 'q1');
  h.state.bank.length = 0;                       // deleted, here or in another tab
  h.api.renderBankGuard();
  ok(!h.api.shown, 'a card was left open on a question that is no longer in the bank');
});

test('a past-paper card is never closed by the bank re-rendering', () => {
  const h = harness();
  h.api.ppHoverShow(ev(200, 200), 'p1');
  h.api.ppHoverExpand(); h.raf();
  ok(h.api.key === 'paper:p1', 'the paper card does not record its source');
  h.api.renderBankGuard();
  ok(h.api.shown, 'the bank re-render closed a past-paper preview by reading its id as a bank id');
});

// ---- the tile being replaced under a still cursor --------------------------
test('the tile being rebuilt under the cursor keeps the card, and does not restart the dwell', () => {
  const h = harness(); openBank(h, 'q1');
  h.api.renderBankGuard();
  // The new tile fires its own mouseenter on the next mouse move.
  h.api.qbTileHoverEnter(ev(201, 200), 'q1');
  ok(h.api.shown, 'the card closed when the replacement tile said hello');
  ok(h.pending(2500) === 0, 'it restarted the 2.5s dwell for a card that is already open and being read');
});

test('moving to a DIFFERENT tile still starts a fresh dwell', () => {
  const h = harness(); openBank(h, 'q1');
  h.api.qbTileHoverLeave();
  h.api.qbTileHoverEnter(ev(600, 400), 'q2');
  ok(h.pending(2500) === 1, 'resting on another question no longer opens its preview');
});

// ---- the card sliding out from under a still pointer -----------------------
test('the card does not re-anchor itself out from under the pointer', () => {
  const h = harness(); openBank(h, 'q1');
  h.card.style.left = '100px'; h.card.style.top = '100px';
  h.card.fire('mouseenter');                     // the cursor has moved into the card
  h.card.fire('mousemove', { clientX: 300, clientY: 250 });   // inside rect 100..500 / 100..400
  h.api.ppHoverExpand(); h.raf();                // the 420ms re-measure once the diagram loaded
  ok(h.card.style.left === '100px' && h.card.style.top === '100px',
    'the card moved under a reader — it is CSS-transitioned, so it slides away and fires its own mouseleave');
});

test('…but the FIRST expand always places it, pointer or not', () => {
  const h = harness();
  h.api.qbTileHoverShowBankMissing = null;
  h.api.ppHoverShowBank(ev(200, 200), 'q1');
  h.card.fire('mousemove', { clientX: 300, clientY: 250 });   // pointer already inside the collapsed card
  h.api.ppHoverExpand(); h.raf();
  ok(h.card.style.left !== '' && h.card.style.top !== '',
    'the first expand skipped its placement, so the grown card hangs off the screen');
});

test('a card mid-slide still knows the pointer is in it', () => {
  // `top` and `left` are CSS-TRANSITIONED, so while the card is travelling its
  // rectangle is somewhere between where it was and where it is going — and it
  // need not contain the pointer the browser still counts as hovering it.
  // Geometry alone therefore says "not inside" at exactly the moment a second
  // re-anchor would slide the card out from under a reader. The card's own
  // mouseenter is the truth; the rectangle is only the backstop for a card that
  // has grown over a cursor which has not moved since.
  const h = harness(); openBank(h, 'q1');
  h.card.fire('mouseenter');                       // the cursor really is in it
  h.card.style.left = '100px'; h.card.style.top = '100px';
  h.card.rect = { left: 700, top: 600, right: 1100, bottom: 900 };   // mid-flight
  h.api.ppHoverExpand(); h.raf();
  ok(h.card.style.left === '100px' && h.card.style.top === '100px',
    'the card re-anchored while the pointer was inside it, because it trusted a rectangle that was still moving');
});

test('the card leaving the pointer gets a GRACE, not an instant close', () => {
  const h = harness(); openBank(h, 'q1');
  h.card.fire('mouseenter');
  h.card.fire('mouseleave');
  ok(h.api.shown, 'the card closed the instant it brushed past the cursor');
  ok(h.pending(260) === 1, 'no grace was armed, so the card can never be re-entered');
  h.card.fire('mouseenter');                     // it caught up with the pointer
  h.fire(260);
  ok(h.api.shown, 'the grace fired even though the pointer came back inside');
});

test('a real leave still closes it once the grace runs out', () => {
  const h = harness(); openBank(h, 'q1');
  h.card.fire('mouseenter'); h.card.fire('mouseleave');
  h.fire(260);
  ok(!h.api.shown, 'the card never closes — the grace has become a leak');
  ok(h.api.key === '', 'it still claims to be showing a question');
});

test('leaving the tile before the dwell fires opens nothing at all', () => {
  const h = harness();
  h.api.qbTileHoverEnter(ev(200, 200), 'q1');
  h.api.qbTileHoverLeave();
  h.fire(2500);
  ok(!h.api.shown, 'a preview opened for a tile the cursor had already left');
});

test('a touch device never opens one', () => {
  const h = harness({ hover: false });
  h.api.qbTileHoverEnter(ev(200, 200), 'q1');
  h.fire(2500);
  ok(!h.api.shown, 'a card opened under a finger');
});

// ---- the census: the real renderQuestionBank, not the stub -----------------
test('renderQuestionBank cancels the PENDING preview and keeps an open one', () => {
  const body = cut('function renderQuestionBank() {', '\n  // Keep the tag list current', 'renderQuestionBank');
  ok(/qbTileHoverCancelPending\(\)/.test(body), 'it no longer cancels the pending dwell — it will fire at a replaced tile');
  ok(!/^\s*qbTileHoverLeave\(\);/m.test(body),
    'it still calls qbTileHoverLeave(), which closes a card the teacher is reading on every background re-render');
  ok(/_ppHoverKey\.indexOf\('bank:'\) === 0/.test(body) && /_docQById/.test(body),
    'it closes the card without asking whether the question has actually gone');
});

test('the leave helpers stay apart: cancelling a pending open is not closing an open one', () => {
  const cancel = cut('function qbTileHoverCancelPending() {', '\nfunction qbTileHoverEnter', 'cancel');
  ok(!/ppHoverHide|ppHoverChipLeave/.test(cancel), 'cancelling what is pending also closes what is open — the split is the fix');
  const leave = cut('function qbTileHoverLeave() {', '\n// Clicking a tile adds', 'leave');
  ok(/ppHoverChipLeave\(\)/.test(leave), 'the cursor genuinely leaving a tile no longer closes the card');
});

test('the re-anchor has a timer of its own', () => {
  const enter = cut('function qbTileHoverEnter(ev, qid) {', '\nfunction qbTileHoverMove', 'qbTileHoverEnter');
  ok(/_bankHoverAnchorTimer = setTimeout\(ppHoverExpand/.test(enter),
    'the re-anchor shares the dwell timer, so cancelling a pending open also cancels the measurement that puts an open card back on screen');
});
runAll();
