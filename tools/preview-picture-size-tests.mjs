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
    const a = sel.match(/^\[data-pvs-act="([^"]*)"\]$/);
    if (a) return this.attrs['data-pvs-act'] === a[1];
    throw new Error('selector not supported by the stub: ' + sel);
  }
  querySelectorAll(sel) { return this.all().filter(c => c.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(h) {
    this._html = h;
    // Each button keeps its data-pvs-act, because that is what the decorator
    // binds by now — position would be a fiction the stub invented.
    (h.match(/<button[\s\S]*?>/g) || []).forEach(tag => {
      const b = this.appendChild(new El('button'));
      const act = /data-pvs-act="([^"]*)"/.exec(tag);
      if (act) b.setAttribute('data-pvs-act', act[1]);
      if (/\sdisabled/.test(tag)) b.setAttribute('disabled', '');
      const t = /data-pvs-act="colour"/.test(tag) ? (/>([^<]*)</.exec(tag + '<') || [, ''])[1] : '';
      if (t) b.textContent = t;
    });
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
  const state = { author: o.author !== false, bank: o.bank || [], vetting: o.vetting || [],
    read: [], gen: [], up: [], imageAi: o.imageAi, genFail: o.genFail, newUrl: o.newUrl };
  const f = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'saveQuestion', 'saveVettingQuestion', 'showToast', 'renderWsPreview', 'state', `
    const escapeHtml = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _canAuthor = () => state.author;
    let questionBank = state.bank, vettingList = state.vetting;
    let currentEditingQuestion = null, blocks = [];
    // 🎨 the image pipeline, stubbed: the real doors are proved by the census
    // at the foot of this file, not by running a model here.
    const CSS = { escape: v => String(v) };
    const currentUser = { uid: 'teacher' };
    const imageAiReady = () => state.imageAi !== false;
    const transformImageUrl = u => u;
    const _parseImageDataUrl = () => ({ mime: 'image/png' });
    const _urlToDataUrlRobust = async u => { state.read.push(u); return 'data:image/png;base64,AAAA'; };
    const generateCleanEnhancedImage = async (p, m) => { state.gen.push({ prompt: p, media: m }); if (state.gate) await state.gate; if (state.genFail) throw new Error(state.genFail); return 'data:image/png;base64,BBBB'; };
    const uploadImageDataUrl = async d => { state.up.push(d); return state.newUrl || 'colour.png'; };
    const imgEnhancePrompt = (colour, remark) => 'PROMPT colour=' + !!colour + ' remark=' + (remark || '');
    const _cqUpdateBadge = () => {};
    ${cut('const IMG_SCALE_MIN = 20;', '// ---- How TALL a picture may print', 'the scale helpers')}
    ${cut('function _imgRenderedPct(containerId, fallback) {', '\n// + / - handler for the image size control', 'the stepper')}
    ${cut('const PVS_IDLE_MS', '\nfunction previewImage(blockId, url) {', 'the pvs block')}
    return { pvsFind, pvsBarHtml, pvsWrapAttrs, pvsStep, pvsReset, pvsFlush, pvsDecorateDoc, pvsPaint, dirty: _pvsDirty,
      pvcRun, pvcRevert, pvcState, pvcBusy, pvcPaint, jobs: _pvcJobs,
      set author(v) { state.author = v; }, set editing(v) { currentEditingQuestion = v.id; blocks = v.blocks; } };
  `);
  const api = f(doc, { addEventListener() {} },
    (cb, ms) => { const id = ++seq; timers.set(id, { cb, ms }); return id; }, id => timers.delete(id),
    async (q, opts) => { saves.push({ where: 'bank', id: q.id, opts, scale: (q.blocks[0] || {}).scale }); return !state.refuse && o.saveOk !== false; },
    async q => { saves.push({ where: 'vetting', id: q.id, scale: (q.blocks[0] || {}).scale }); return !state.refuse && o.saveOk !== false; },
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
  // By ACTION, never by position: the pill grew a 🎨 button, and a test that
  // reads btns[1] would have kept passing while pointing at the wrong control.
  bars[0].querySelector('[data-pvs-act="plus"]').onclick({ stopPropagation() {} });
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

// ---- 🎨 colourise from a preview -------------------------------------------
test('🎨 colourises through the shared prompt and doors, and saves by itself', async () => {
  const h = harness({ bank: [Q('a')], newUrl: 'colour.png' });
  h.doc.body.appendChild(wrapFor('a', 'b1'));
  h.api.pvcRun('a', 'b1');
  await tick(); await tick(); await tick();
  ok(h.state.read[0] === 'x.png', 'it must read the picture that is on the block, not a cached one');
  ok(h.state.gen.length === 1, 'expected one image call, got ' + h.state.gen.length);
  // The SAME prompt the block editor's 🎨 sends: two prompts is one picture
  // coming back two ways depending on which button was pressed.
  ok(h.state.gen[0].prompt === 'PROMPT colour=true remark=', 'the shared colour prompt was not used: ' + h.state.gen[0].prompt);
  ok(h.state.up.length === 1, 'the result was not uploaded');
  ok(h.state.bank[0].blocks[0].url === 'colour.png', 'the block still carries the old picture');
  ok(h.saves.length === 1 && h.saves[0].where === 'bank' && h.saves[0].opts && h.saves[0].opts.quiet === true,
    'a colourise must save ONCE, quietly — it is housekeeping, not a question authored');
  ok(h.api.pvcState('a', 'b1') === 'done');
  ok(h.api.pvcBusy() === false, 'the job is still counted as in flight after it finished');
});

test('THE ORIGINAL IS KEPT, once, so the colourisation can be rejected', async () => {
  const h = harness({ bank: [Q('a')], newUrl: 'c1.png' });
  h.api.pvcRun('a', 'b1'); await tick(); await tick(); await tick();
  ok(h.state.bank[0].blocks[0].preColourUrl === 'x.png', 'the picture that was there was not kept');
  // Colourising twice must not lose the scan behind the FIRST attempt.
  h.state.newUrl = 'c2.png';
  h.api.jobs.clear();
  h.api.pvcRun('a', 'b1'); await tick(); await tick(); await tick();
  ok(h.state.bank[0].blocks[0].url === 'c2.png', 'the second colourisation did not land');
  ok(h.state.bank[0].blocks[0].preColourUrl === 'x.png', 'the original scan was overwritten by the first colourisation');
  await h.api.pvcRevert('a', 'b1');
  ok(h.state.bank[0].blocks[0].url === 'x.png', 'revert did not put the original back');
  ok(!('preColourUrl' in h.state.bank[0].blocks[0]), 'revert left a stale original behind');
});

test('a write the database refused leaves the question exactly as it was', async () => {
  const h = harness({ bank: [Q('a')], saveOk: false });
  h.api.pvcRun('a', 'b1'); await tick(); await tick(); await tick();
  ok(h.state.bank[0].blocks[0].url === 'x.png', 'the screen claims a picture the database refused');
  ok(h.api.pvcState('a', 'b1') === 'error');

  // A refused REVERT keeps BOTH fields, or the question wears the colourised
  // picture with nothing left to undo it with.
  const h2 = harness({ bank: [Q('a')], newUrl: 'c.png' });
  h2.api.pvcRun('a', 'b1'); await tick(); await tick(); await tick();
  ok(h2.state.bank[0].blocks[0].url === 'c.png' && h2.state.bank[0].blocks[0].preColourUrl === 'x.png', 'set-up');
  h2.state.refuse = true;
  await h2.api.pvcRevert('a', 'b1');
  ok(h2.state.bank[0].blocks[0].url === 'c.png', 'a refused revert changed the picture on screen anyway');
  ok(h2.state.bank[0].blocks[0].preColourUrl === 'x.png', 'a refused revert threw the original away — there is now no way back');
});

test('a question that has gone while the model was drawing is never written back', async () => {
  let open;
  const h = harness({ bank: [Q('a')] });
  h.state.gate = new Promise(r => { open = r; });
  h.api.pvcRun('a', 'b1');
  await tick();
  ok(h.state.gen.length === 1, 'the image call has not started, so nothing is being staged');
  h.state.bank.length = 0;            // deleted in another tab mid-call
  open(); await tick(); await tick(); await tick();
  ok(h.saves.length === 0, 'it wrote a question that is no longer in the bank');
  ok(h.api.pvcState('a', 'b1') === 'error');
});

test('the job outlives the preview: nothing in it reads the preview DOM', () => {
  const work = cut('async function _pvcWork(job) {', '\n// A colourised picture is exactly', '_pvcWork');
  for (const forbidden of ['wsPreviewOverlay', 'getElementById(', 'closest(']) {
    ok(work.indexOf(forbidden) < 0, '_pvcWork reads the preview through ' + forbidden + ' — the job would die with the preview');
  }
  // It re-resolves rather than holding the question across the await, because
  // questionBank is re-read and re-assigned wholesale elsewhere.
  ok(/const found = pvsFind\(job\.qid\);/.test(work), '_pvcWork does not re-resolve the question after the image call');
  ok(work.indexOf('await generateCleanEnhancedImage') < work.indexOf('const found = pvsFind(job.qid)'),
    'the re-resolve must come AFTER the image call, or it is not a re-resolve at all');
});

test('a student gets no colourise, and the handler refuses anyway', async () => {
  const h = harness({ bank: [Q('a')], author: false });
  ok(h.api.pvsBarHtml(h.state.bank[0], h.state.bank[0].blocks[0]) === '', 'a student was shown the pill');
  h.api.pvcRun('a', 'b1'); await tick(); await tick();
  ok(h.state.gen.length === 0, 'a hidden button is not a lock: the handler ran for a student');
});

test('it refuses rather than spending a call it cannot make', async () => {
  const noAi = harness({ bank: [Q('a')], imageAi: false });
  noAi.api.pvcRun('a', 'b1'); await tick();
  ok(noAi.state.gen.length === 0 && noAi.api.pvcState('a', 'b1') === '', 'it queued a job with no image model');
  const gone = harness({ bank: [{ id: 'a', blocks: [{ id: 'b1', type: 'image' }] }] });
  gone.api.pvcRun('a', 'b1'); await tick();
  ok(gone.state.gen.length === 0, 'it tried to colourise a block with no picture');
  // Pressing twice must not pay twice.
  const twice = harness({ bank: [Q('a')] });
  twice.api.pvcRun('a', 'b1'); twice.api.pvcRun('a', 'b1');
  await tick(); await tick(); await tick();
  ok(twice.state.gen.length === 1, 'a second press started a second paid call');
});

test('a vetting question is written through its own door', async () => {
  const h = harness({ bank: [], vetting: [Q('v')] });
  h.api.pvcRun('v', 'b1'); await tick(); await tick(); await tick();
  ok(h.saves.length === 1 && h.saves[0].where === 'vetting', 'a vetting question was written to the bank');
});

test('the pill carries 🎨 LAST, set apart from the free controls', () => {
  const h = harness({ bank: [Q('a')] });
  const html = h.api.pvsBarHtml(h.state.bank[0], h.state.bank[0].blocks[0]);
  const acts = (html.match(/data-pvs-act="([a-z]+)"/g) || []).map(m => /"([a-z]+)"/.exec(m)[1]);
  ok(JSON.stringify(acts) === JSON.stringify(['minus', 'plus', 'auto', 'colour']),
    'the pill order changed — 🎨 spends an AI call and must not be where a thumb lands while sizing: ' + acts);
  ok(/pvs-colour/.test(html), 'the colour button has no class of its own to set it apart');
});

// ---- the census: the queue, the doors, the guard ---------------------------
test('a colourised question goes to the FRONT of the check queue and is counted', () => {
  const mark = cut('function _pvcMarkRecheck(q) {', '\n// Swap the <img>', '_pvcMarkRecheck');
  ok(/q\.recheck = \{/.test(mark), 'nothing marks the question for a second look');
  ok(/delete q\.checked/.test(mark), 'a question already read must become unread: what was read was the OLD picture');
  const build = cut('function _cqBuildQueue() {', '\n// The question on show', '_cqBuildQueue');
  ok(/_cqRechecks\(\)/.test(build), 'the queue does not put rechecks first — newest-first would bury it');
  ok(/seen\.has\(id\)/.test(build), 'the queue can offer the same question twice');
  const count = cut('function _cqRecentUncheckedCount() {', '\nfunction _cqRechecks', 'the badge');
  ok(/_cqRecheckAt\(q\)/.test(count), 'the badge does not count rechecks — the one urgent question is the one it never mentions');
  const rechecks = cut('function _cqRechecks() {', '\nfunction _cqBuildQueue', '_cqRechecks');
  ok(rechecks.indexOf('cut') < 0 && rechecks.indexOf('_cqRecentCut') < 0,
    'a recheck must never be filtered by age: a colourised question from last term is the MOST urgent thing in the bank');
  const fine = cut('async function cqLooksFine(id) {', '\n// 🗑 Delete the question', 'cqLooksFine');
  ok(/delete q\.recheck/.test(fine), '✓ does not settle the recheck — the question sits at the front for ever');
  ok(/q\.recheck = hadRecheck/.test(fine), 'a refused save does not put the recheck back');
});

test('the shared prompt has ONE home, and both 🎨 doors ask it', () => {
  ok(/function imgEnhancePrompt\(colour, remark\)/.test(src), 'the prompt builder is gone');
  const editor = cut('async function enhanceBlockImage(blockId, colour) {', '\nfunction useOriginalImage', 'enhanceBlockImage');
  ok(/imgEnhancePrompt\(colour, remark\)/.test(editor), "the block editor's 🎨 no longer asks the shared builder");
  ok(editor.indexOf('TASK: add colour to this diagram') < 0, 'the editor kept a copy of the prompt — the two will drift');
  const work = cut('async function _pvcWork(job) {', '\n// A colourised picture is exactly', '_pvcWork');
  ok(/imgEnhancePrompt\(true, ''\)/.test(work), 'the preview 🎨 does not ask the shared builder');
  // The cleaning door, because this picture is going to be printed.
  ok(/generateCleanEnhancedImage\(/.test(work), '_pvcWork skips the paper-clean pass');
});

test('the unload guard knows about a colourise in flight', () => {
  const guard = cut('function _xtWorkInFlight() {', '\nfunction _xtGuardUnload', '_xtWorkInFlight');
  ok(/pvcBusy\(\)/.test(guard),
    'closing the tab mid-call is the ONE way this loses work: the picture exists only in the model\'s reply until it is written');
});

test('the decorator binds by ACTION, so a new control cannot re-point its neighbours', () => {
  const dec = cut('function pvsDecorateDoc(doc) {', '\ntry { window.addEventListener(\'pagehide\'', 'pvsDecorateDoc');
  ok(dec.indexOf('btns[0]') < 0 && dec.indexOf('btns[1]') < 0 && dec.indexOf('btns[2]') < 0,
    'the decorator still binds by position');
  for (const a of ['minus', 'plus', 'auto', 'colour']) {
    ok(dec.indexOf("'" + a + "'") >= 0, 'the decorator does not bind ' + a + ' inside an exported preview');
  }
});

test('🖨 Preview Exported reaches the pill and the 🎨 — it is the ONE preview path', () => {
  // previewOneQuestionPrint / previewEditorPrint / qbulkPreviewPrint all open
  // the ad-hoc preview, which renders through renderWsPreview -> buildWorksheetHtml
  // -> _wsWritePreview -> _wsPreviewPack, and _wsPreviewPack decorates. A
  // second rendering path for that button would carry neither control.
  const render = cut('async function renderWsPreview() {', '\nfunction _wsWritePreview(', 'renderWsPreview');
  ok(/buildWorksheetHtml\(/.test(render), 'the A4/exported preview no longer builds through the print builder');
  ok(/_wsWritePreview\(frame, html/.test(render), 'the preview no longer goes through the one writer');
  const write = cut('function _wsWritePreview(frame, html, opts) {', '\nfunction _wsPreviewPack(', '_wsWritePreview');
  ok(/_wsPreviewPack\(doc/.test(write), '_wsWritePreview no longer packs — nothing would hang a pill');
  for (const fn of ['previewOneQuestionPrint', 'previewQuestionsPrint', 'previewEditorPrint']) {
    ok(src.indexOf('function ' + fn + '(') >= 0, fn + ' is gone');
  }
  // …and the 🎨 rides in the SAME pill builder, so it cannot reach one surface
  // and miss another.
  const buttons = cut('function _pvsButtonsHtml(qid, bid, block) {', '\n// The pill as rendered INTO', '_pvsButtonsHtml');
  ok(/_pvcButtonHtml\(qid, bid\)/.test(buttons), 'the colour button is not in the shared pill — it would reach some previews and not others');
});

runAll();
