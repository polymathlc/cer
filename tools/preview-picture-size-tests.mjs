// 🔍± PICTURE SIZE, FROM A PREVIEW — the − / + / Auto pill on every preview
// picture, and the write-back to the bank when the preview closes.
//
// Loads the REAL block out of app.js and runs it against stubs. Every failure
// here is silent in the app: a pill that renders for a student is a control
// that writes to the bank from a hover; a write that fires on every press is
// four documents for one decision; a close hook that stops flushing is a size
// the teacher watched change and that never reached the bank; and a step that
// sets 0 instead of deleting the field reads as "Auto" to one caller and as a
// real number to the next.
//
//   node tools/preview-picture-size-tests.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'app.js'), 'utf8');

let passed = 0, failed = 0;
const tests = [];
function ok(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ ' + msg); } }
// Tests are QUEUED and awaited in order — the flush is async, and a runner
// that does not await it reports a test as passed before its assertions run.
function test(name, fn) { tests.push([name, fn]); }
async function runAll() {
  for (const [name, fn] of tests) {
    const before = failed;
    try { await fn(); if (failed === before) console.log('✓ ' + name); else console.error('✗ ' + name); }
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

// ---- a tiny DOM: enough for wrappers, images and labels -------------------
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.textContent = ''; this.className = ''; this.dataset = {}; this.listeners = {}; this.parent = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = String(v); }
  getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  addEventListener(k, cb) { this.listeners[k] = cb; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  matches(sel) {
    if (sel === 'img') return this.tag === 'img';
    if (sel === 'button') return this.tag === 'button';
    if (sel[0] === '.') return this.className.split(' ').includes(sel.slice(1));
    const m = sel.match(/^\[data-pvs-q="([^"]*)"\]\[data-pvs-b="([^"]*)"\]$/);
    if (m) return this.attrs['data-pvs-q'] === m[1] && this.attrs['data-pvs-b'] === m[2];
    if (sel === '[data-pvs-q][data-pvs-b]') return 'data-pvs-q' in this.attrs && 'data-pvs-b' in this.attrs;
    if (sel === '[data-pvs-bar]') return 'data-pvs-bar' in this.attrs;
    throw new Error('selector not supported by the stub: ' + sel);
  }
  querySelectorAll(sel) { return this.all().filter(c => c.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(h) {
    this._html = h;
    // the pill's three buttons, in order
    const n = (h.match(/<button/g) || []).length;
    for (let i = 0; i < n; i++) this.appendChild(new El('button'));
    if (/pvs-label/.test(h)) { const l = new El('span'); l.className = 'pvs-label'; this.appendChild(l); }
  }
}
function wrapFor(qid, bid) {
  const w = new El('div'); w.setAttribute('data-pvs-q', qid); w.setAttribute('data-pvs-b', bid);
  const img = w.appendChild(new El('img')); img.offsetWidth = 300; w.clientWidth = 500;
  const l = w.appendChild(new El('span')); l.className = 'pvs-label';
  return w;
}

function harness(opts) {
  const o = opts || {};
  const doc = new El('document'); doc.head = new El('head'); doc.body = new El('body');
  doc.getElementById = id => (id === 'pvsStyle' ? doc.head.children.find(c => c.id === id) || null : (o.overlay && id === 'wsPreviewOverlay' ? o.overlay : null));
  doc.createElement = tag => new El(tag);
  doc.querySelectorAll = sel => (sel === 'iframe' ? (o.frames || []) : doc.body.querySelectorAll(sel));
  const timers = new Map(); let seq = 0;
  const saves = [], toasts = [], replans = [];
  const state = { author: o.author !== false, bank: o.bank || [], vetting: o.vetting || [] };
  const f = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'saveQuestion', 'saveVettingQuestion', 'showToast', 'renderWsPreview', 'state', `
    const escapeHtml = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _canAuthor = () => state.author;
    let questionBank = state.bank, vettingList = state.vetting;
    let currentEditingQuestion = null, blocks = [];
    ${cut('const IMG_SCALE_MIN = 20;', '// ---- How TALL a picture may print', 'the scale helpers')}
    ${cut('function _imgRenderedPct(containerId, fallback) {', '\n// + / - handler for the image size control', 'the stepper')}
    ${cut('const PVS_IDLE_MS', '\nfunction previewImage(blockId, url) {', 'the pvs block')}
    return { pvsFind, pvsBarHtml, pvsWrapAttrs, pvsStep, pvsReset, pvsFlush, pvsDecorateDoc, pvsPaint, dirty: _pvsDirty,
      set author(v) { state.author = v; }, set editing(v) { currentEditingQuestion = v.id; blocks = v.blocks; } };
  `);
  const api = f(doc, { addEventListener() {} },
    (cb, ms) => { const id = ++seq; timers.set(id, { cb, ms }); return id; }, id => timers.delete(id),
    async (q, opts) => { saves.push({ where: 'bank', id: q.id, opts, scale: (q.blocks[0] || {}).scale }); return o.saveOk !== false; },
    async q => { saves.push({ where: 'vetting', id: q.id, scale: (q.blocks[0] || {}).scale }); return o.saveOk !== false; },
    (m, t) => toasts.push([m, t]), () => replans.push(1), state);
  const fire = () => { const list = Array.from(timers.entries()); timers.clear(); list.forEach(([, t]) => t.cb()); };
  return { api, doc, saves, toasts, replans, timers, fire, state };
}
const Q = (id, scale) => ({ id, title: 'Q ' + id, blocks: [{ id: 'b1', type: 'image', url: 'x.png', ...(scale != null ? { scale } : {}) }, { id: 'b2', type: 'text', content: 'hi' }] });
const tick = () => new Promise(r => setTimeout(r, 0));

// ---- the pill --------------------------------------------------------------
test('the pill renders for an author on a saved question, and for nobody else', () => {
  const h = harness({ bank: [Q('a')] });
  const html = h.api.pvsBarHtml(Q('a'), Q('a').blocks[0]);
  ok(/pvsStep\('a','b1',-1\)/.test(html) && /pvsStep\('a','b1',1\)/.test(html) && /pvsReset\('a','b1'\)/.test(html), 'the three buttons are not wired');
  ok(/event\.stopPropagation\(\)/.test(html), 'a press would also fire the chip or tile the preview sits on');
  ok(h.api.pvsBarHtml({ id: null, blocks: [] }, Q('a').blocks[0]) === '', 'a draft with no id got a pill it cannot write for');
  ok(h.api.pvsBarHtml(Q('a'), { type: 'image', url: 'x' }) === '', 'a block with no id got a pill');
  h.api.author = false;
  ok(h.api.pvsBarHtml(Q('a'), Q('a').blocks[0]) === '', 'a STUDENT got the pill — a hidden button is not a lock, but the pill must not even be drawn');
  ok(h.api.pvsWrapAttrs(Q('a'), Q('a').blocks[0]).indexOf('data-pvs-q="a"') >= 0, 'the wrapper does not name its question');
});

test('the handlers refuse anyone who is not an author, and a question that is gone', () => {
  const h = harness({ bank: [Q('a')], author: false });
  h.api.pvsStep('a', 'b1', 1);
  ok(h.state.bank[0].blocks[0].scale === undefined && h.api.dirty.size === 0, 'a non-author changed a picture');
  h.api.author = true;
  h.api.pvsStep('zzz', 'b1', 1);
  ok(h.api.dirty.size === 0 && h.toasts.length === 1, 'a question that is not there was not refused with a word');
});

// ---- the step ------------------------------------------------------------------
test('+ and − write block.scale through the ONE stepper, and Auto DELETES the field', () => {
  const h = harness({ bank: [Q('a', 0.6)] });
  h.api.pvsStep('a', 'b1', 1);
  ok(Math.abs(h.state.bank[0].blocks[0].scale - 0.65) < 1e-9, '+ did not step 5% from the size that is set: ' + h.state.bank[0].blocks[0].scale);
  h.api.pvsStep('a', 'b1', -1); h.api.pvsStep('a', 'b1', -1);
  ok(Math.abs(h.state.bank[0].blocks[0].scale - 0.55) < 1e-9, '− did not step back');
  h.api.pvsReset('a', 'b1');
  ok(!('scale' in h.state.bank[0].blocks[0]), 'Auto left the field behind — 0 reads as "no size chosen" to one caller and as a number to the next');
  ok(h.api.dirty.get('a') === 'bank', 'the question was not marked dirty for the flush');
});

test('with no size set the first press steps from the size ON SCREEN, floored and capped', () => {
  const h = harness({ bank: [Q('a')] });
  h.doc.body.appendChild(wrapFor('a', 'b1'));          // rendered at 300/500 = 60%
  h.api.pvsStep('a', 'b1', 1);
  ok(Math.abs(h.state.bank[0].blocks[0].scale - 0.65) < 1e-9, 'the first press did not move from the rendered 60%: ' + h.state.bank[0].blocks[0].scale);
  for (let i = 0; i < 20; i++) h.api.pvsStep('a', 'b1', 1);
  ok(h.state.bank[0].blocks[0].scale === 1, '+ ran past the column: ' + h.state.bank[0].blocks[0].scale);
  for (let i = 0; i < 40; i++) h.api.pvsStep('a', 'b1', -1);
  ok(Math.abs(h.state.bank[0].blocks[0].scale - 0.2) < 1e-9, '− ran below the floor: ' + h.state.bank[0].blocks[0].scale);
});

test('every copy of the picture on the page is repainted together, iframes included', () => {
  const frameDoc = new El('document'); frameDoc.body = new El('body'); frameDoc.querySelectorAll = s => frameDoc.body.querySelectorAll(s);
  const frame = { contentDocument: frameDoc };
  const h = harness({ bank: [Q('a')], frames: [frame] });
  const w1 = h.doc.body.appendChild(wrapFor('a', 'b1'));
  const w2 = frameDoc.body.appendChild(wrapFor('a', 'b1'));
  const other = h.doc.body.appendChild(wrapFor('a', 'b9'));
  h.api.pvsStep('a', 'b1', 1);
  ok(w1.children[0].style.width === '65%' && w2.children[0].style.width === '65%', 'a copy of the picture kept its old size');
  ok(w1.children[1].textContent === '65%' && w2.children[1].textContent === '65%', 'a label did not follow');
  ok(!other.children[0].style.width, 'a DIFFERENT picture on the same question was resized');
  h.api.pvsReset('a', 'b1');
  ok(w1.children[0].style.width === '' && w1.children[0].style.maxWidth === '70%' && w1.children[1].textContent === 'Auto', 'Auto did not put the picture back on the automatic cap');
});

test('the question open in the editor follows, so Save there cannot put the old size back', () => {
  const h = harness({ bank: [Q('a', 0.5)] });
  const editorBlocks = [{ id: 'b1', type: 'image', url: 'x.png', scale: 0.5 }];
  h.api.editing = { id: 'a', blocks: editorBlocks };
  h.api.pvsStep('a', 'b1', 1);
  ok(Math.abs(editorBlocks[0].scale - 0.55) < 1e-9, 'the editor copy still holds the old size');
  const h2 = harness({ bank: [Q('a', 0.5)] });
  const otherBlocks = [{ id: 'b1', type: 'image', url: 'x.png', scale: 0.5 }];
  h2.api.editing = { id: 'DIFFERENT', blocks: otherBlocks };
  h2.api.pvsStep('a', 'b1', 1);
  ok(otherBlocks[0].scale === 0.5, 'a DIFFERENT question open in the editor was resized because it shares a block id');
});

// ---- the write -----------------------------------------------------------------
test('nothing is written on a press; the flush writes each touched question ONCE, quietly, through the right door', async () => {
  const h = harness({ bank: [Q('a', 0.5)], vetting: [Q('v', 0.5)] });
  h.api.pvsStep('a', 'b1', 1); h.api.pvsStep('a', 'b1', 1); h.api.pvsStep('a', 'b1', 1);
  h.api.pvsStep('v', 'b1', -1);
  ok(h.saves.length === 0, 'a press wrote to the bank — four writes for one decision');
  await h.api.pvsFlush(); await tick();
  ok(h.saves.length === 2, 'expected one write per question, got ' + h.saves.length);
  const bank = h.saves.find(s => s.id === 'a'), vet = h.saves.find(s => s.id === 'v');
  ok(bank && bank.where === 'bank' && bank.opts && bank.opts.quiet === true, 'the bank question was not written quietly through saveQuestion');
  ok(vet && vet.where === 'vetting', 'the vetting question did not go through saveVettingQuestion');
  ok(Math.abs(bank.scale - 0.65) < 1e-9, 'the size written is not the size pressed to');
  ok(h.api.dirty.size === 0, 'the dirty set was not cleared');
  ok(h.toasts.some(t => t[1] === 'success'), 'a costly invisible thing happened and nothing said so');
});

test('a write that did not land keeps the question dirty and says so', async () => {
  const h = harness({ bank: [Q('a', 0.5)], saveOk: false });
  h.api.pvsStep('a', 'b1', 1);
  await h.api.pvsFlush(); await tick();
  ok(h.api.dirty.get('a') === 'bank', 'a refused write was forgotten — the size the teacher chose is gone on the next reload');
  ok(h.toasts.some(t => t[1] === 'error'), 'a refused write was not reported');
});

test('a surface with no close of its own is flushed after the idle timer, and the A4 preview is re-planned', async () => {
  const overlay = new El('div'); overlay.classList = { contains: c => c === 'show' };
  const h = harness({ bank: [Q('a', 0.5)], overlay });
  h.api.pvsStep('a', 'b1', 1);
  const kinds = Array.from(h.timers.values()).map(t => t.ms).sort((a, b) => a - b);
  ok(kinds.length === 2, 'expected an idle timer and a re-plan timer, got ' + JSON.stringify(kinds));
  h.fire(); await tick();
  ok(h.saves.length === 1, 'the idle timer did not write');
  ok(h.replans.length === 1, 'the A4 preview was not re-planned after the picture changed size');
});

test('a question deleted between the press and the flush is skipped, not written back', async () => {
  const h = harness({ bank: [Q('a', 0.5)] });
  h.api.pvsStep('a', 'b1', 1);
  h.state.bank.length = 0;
  await h.api.pvsFlush(); await tick();
  ok(h.saves.length === 0, 'a deleted question was resurrected by the flush');
});

// ---- the iframe decorator ------------------------------------------------------
test('pvsDecorateDoc hangs ONE pill per picture, over the corner, bound to this window', () => {
  const frameDoc = new El('document'); frameDoc.head = new El('head'); frameDoc.body = new El('body');
  frameDoc.querySelectorAll = s => frameDoc.body.querySelectorAll(s);
  frameDoc.getElementById = id => frameDoc.head.children.find(c => c.id === id) || null;
  frameDoc.createElement = tag => new El(tag);
  frameDoc.defaultView = { getComputedStyle: () => ({ position: 'static' }) };
  const h = harness({ bank: [Q('a', 0.5)], vetting: [], frames: [{ contentDocument: frameDoc }] });
  const w = frameDoc.body.appendChild(wrapFor('a', 'b1'));
  const stranger = frameDoc.body.appendChild(wrapFor('nobody', 'b1'));
  h.api.pvsDecorateDoc(frameDoc); h.api.pvsDecorateDoc(frameDoc);
  const bars = w.querySelectorAll('[data-pvs-bar]');
  ok(bars.length === 1, 'expected exactly one pill after two passes, got ' + bars.length);
  ok(bars[0].className.indexOf('pvs-over') >= 0 && w.style.position === 'relative', 'the pill is not laid over the picture — it would change a page the planner has already measured');
  ok(stranger.querySelectorAll('[data-pvs-bar]').length === 0, 'a picture whose question is in neither list got a pill');
  ok(frameDoc.head.children.some(c => c.id === 'pvsStyle'), 'the stylesheet was not injected into the frame');
  const btns = bars[0].querySelectorAll('button');
  btns[1].onclick({ stopPropagation() {} });
  ok(Math.abs(h.state.bank[0].blocks[0].scale - 0.55) < 1e-9, 'the + inside the frame is not bound to this window\'s pvsStep');
  h.api.author = false;
  const w2 = frameDoc.body.appendChild(wrapFor('a', 'b2'));
  h.api.pvsDecorateDoc(frameDoc);
  ok(w2.querySelectorAll('[data-pvs-bar]').length === 0, 'a student\'s frame was decorated');
});

// ---- the census: every surface, every close --------------------------------------
test('the ONE preview renderer carries the pill on its image branch', () => {
  const prev = cut('function renderQuestionBodyPreviewHtml(q) {', '\nfunction questionHasMarkableAnswer', 'preview');
  ok(prev.indexOf('pvsBarHtml(q, block)') >= 0, 'renderQuestionBodyPreviewHtml renders no pill');
  ok(prev.indexOf('pvsWrapAttrs(q, block)') >= 0, 'the preview wrapper does not name its question and block');
});

test('BOTH print builders tag every picture, so the exported previews can hang a pill on it', () => {
  const a = cut('function doPrintWorksheetOpen(', '\nfunction buildWorksheetHtml(', 'doPrintWorksheetOpen');
  const b = cut('function buildWorksheetHtml(', '\nasync function _wnyRunPrepare', 'buildWorksheetHtml');
  ok(a.indexOf('class="print-text-block"${pvsWrapAttrs(q, block)}') >= 0, 'doPrintWorksheetOpen does not tag its pictures');
  ok(b.indexOf('class="print-text-block"${pvsWrapAttrs(q, block)}') >= 0, 'buildWorksheetHtml does not tag its pictures — the 👁 hover and the A4 preview carry no pill');
  ok(/pvsDecorateDoc\(doc\)/.test(cut('function _wsPreviewPack(', '\n// WORKSHEET QUICK EDIT', '_wsPreviewPack')), '_wsPreviewPack does not decorate the packed pages');
});

test('every preview close flushes, and the handlers are on window', () => {
  for (const fn of ['ppHoverHide', 'vetPrintPeekHide', 'dupCompareClose', 'closeWorksheetPreview']) {
    const body = cut('function ' + fn + '(', '\nfunction ', fn);
    ok(/pvsFlush\(\)/.test(body), fn + ' closes without writing the picture sizes back');
  }
  for (const fn of ['pvsStep', 'pvsReset', 'pvsFlush']) ok(src.indexOf('window.' + fn + ' = ' + fn + ';') >= 0, fn + ' is not on window — the inline onclick finds nothing');
  ok(/window\.addEventListener\('pagehide', \(\) => \{ pvsFlush\(\); \}\)/.test(src), 'a tab closed with a hover open loses the edit — no pagehide flush');
});

test('the write is QUIET and never on a press', () => {
  const blk = cut('const PVS_IDLE_MS', '\nfunction previewImage(blockId, url) {', 'the pvs block');
  ok(/saveQuestion\(found\.q, \{ quiet: true \}\)/.test(blk), 'a nudged picture would land in the work-session log as a question authored');
  const step = cut('function pvsStep(', '\nfunction pvsReset(', 'pvsStep');
  ok(step.indexOf('saveQuestion') < 0 && step.indexOf('saveVettingQuestion') < 0, 'pvsStep writes on every press');
});

runAll();
