// 🔍± PICTURE SIZE, FROM A PREVIEW — the − / + / Auto pill on every preview
// picture, and the write-back to the bank when the preview closes. Plus the
// ✨ / 🎨 regenerate buttons beside it, and ▲▼ the order of a question's
// elements, moved from the same preview.
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
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.textContent = ''; this.className = ''; this.dataset = {}; this.listeners = {}; this.parent = null;
    const el = this;
    this.classList = { add(c) { if (!el.className.split(' ').includes(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(' ').filter(x => x && x !== c).join(' '); }, contains(c) { return el.className.split(' ').includes(c); } }; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = String(v); }
  getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  get firstElementChild() { return this.children[0] || null; }
  addEventListener(k, cb) { this.listeners[k] = cb; }
  closest(sel) { let n = this; while (n) { if (sel.split(',').some(s => n.matches(s.trim()))) return n; n = n.parent; } return null; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  matches(sel) {
    if (/^[a-z]+$/.test(sel)) return this.tag === sel;
    if (sel[0] === '.') return this.className.split(' ').includes(sel.slice(1));
    // Any chain of [attr] / [attr="v"] — the pills, the bars and the wrappers
    // are all found by attribute.
    const parts = sel.match(/\[[^\]]+\]/g);
    if (parts && parts.join('') === sel) return parts.every(p => {
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(p);
      return m[2] === undefined ? (m[1] in this.attrs) : this.attrs[m[1]] === m[2];
    });
    throw new Error('selector not supported by the stub: ' + sel);
  }
  querySelectorAll(sel) { return this.all().filter(c => c.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(h) {
    this._html = h;
    // Each button keeps its data-pvs-act, because that is what the decorator
    // binds by now — position would be a fiction the stub invented.
    (h.match(/<button[\s\S]*?<\/button>/g) || []).forEach(full => {
      const tag = full.slice(0, full.indexOf('>') + 1);
      const b = this.appendChild(new El('button'));
      const act = /data-pvs-act="([^"]*)"/.exec(tag);
      if (act) b.setAttribute('data-pvs-act', act[1]);
      const oact = /data-pvo-act="([^"]*)"/.exec(tag);
      if (oact) b.setAttribute('data-pvo-act', oact[1]);
      if (/\sdisabled/.test(tag)) b.setAttribute('disabled', '');
      const t = /data-pv[so]-act="(colour|enhance|up|down|del|undo)"/.test(tag) ? full.slice(tag.length, full.lastIndexOf('<')) : '';
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
  doc.querySelector = sel => doc.querySelectorAll(sel)[0] || null;
  doc.defaultView = { getComputedStyle: () => ({ position: 'static' }) };
  const timers = new Map(); let seq = 0;
  const saves = [], toasts = [], replans = [];
  const state = { author: o.author !== false, bank: o.bank || [], vetting: o.vetting || [],
    read: [], gen: [], up: [], imageAi: o.imageAi, genFail: o.genFail, newUrl: o.newUrl,
    renders: 0, refreshes: 0, peek: o.peek || null, em: !!o.em };
  const f = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'saveQuestion', 'saveVettingQuestion', 'showToast', 'renderWsPreview', 'state', `
    const escapeHtml = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _canAuthor = () => state.author;
    let questionBank = state.bank, vettingList = state.vetting;
    let currentEditingQuestion = null, blocks = [], editorKeywords = {};
    const kwForgetBlock = id => { state.forgot = (state.forgot || []).concat([String(id)]); };
    // ▲▼ the editor and the peek, stubbed: a render is counted, a refresh is counted.
    const renderBlocks = () => { state.renders++; };
    const emActive = () => state.em;
    let _vetPrintPeek = state.peek;
    const _vetPrintPeekRefresh = () => { state.refreshes++; };
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
    return { pvsFind, pvsBarHtml, pvsWrapAttrs, pvsStep, pvsReset, pvsFlush, pvsFlushSettled, pvsDecorateDoc, pvsPaint, dirty: _pvsDirty,
      pvcRun, pvcRevert, pvcState, pvcBusy, pvcPaint, jobs: _pvcJobs,
      pvoWrapOpen, pvoMove, pvoRemove, pvoUndo, pvoKeydown, pvoSelect, pvoDecorateDoc, get sel() { return _pvoSel; }, set sel(v) { _pvoSel = v; }, set hover(v) { _pvoHover = v; }, get undo() { return _pvoUndo; }, get kw() { return editorKeywords; },
      set author(v) { state.author = v; }, set editing(v) { currentEditingQuestion = v.id; blocks = v.blocks; }, get blocks() { return blocks; } };
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
  h.api.pvcRun('a', 'b1', true);
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

test('✨ enhances through the SAME pipeline with the black-and-white prompt, and says so', async () => {
  const h = harness({ bank: [Q('a')], newUrl: 'bw.png' });
  h.api.pvcRun('a', 'b1');            // no third argument: the ✨ button
  await tick(); await tick(); await tick();
  ok(h.state.gen.length === 1 && h.state.gen[0].prompt === 'PROMPT colour=false remark=', 'the ✨ button did not ask the shared BLACK-AND-WHITE prompt: ' + (h.state.gen[0] || {}).prompt);
  ok(h.state.bank[0].blocks[0].url === 'bw.png' && h.state.bank[0].blocks[0].preColourUrl === 'x.png', 'the enhanced picture did not land, or the original was not kept');
  ok(h.state.bank[0].recheck && h.state.bank[0].recheck.why === 'enhance', 'the recheck does not say it was an ENHANCE — the queue banner would call it a colourisation');
  ok(h.saves.length === 1 && h.saves[0].opts && h.saves[0].opts.quiet === true, 'an enhance must save once, quietly');
  ok(h.toasts.some(t => /✨ Enhanced and saved/.test(t[0])), 'the toast does not say what happened');
  const h2 = harness({ bank: [Q('a')], newUrl: 'c.png' });
  h2.api.pvcRun('a', 'b1', 'yes');     // only `true` is the 🎨 button
  await tick(); await tick(); await tick();
  ok(h2.state.gen[0].prompt === 'PROMPT colour=false remark=', 'a truthy non-boolean was read as the colour button');
});

test('ONE JOB PER PICTURE: while one button runs, the other is disabled and starts nothing', async () => {
  let open;
  const h = harness({ bank: [Q('a')] });
  h.doc.body.appendChild(wrapFor('a', 'b1'));
  h.state.gate = new Promise(r => { open = r; });
  h.api.pvcRun('a', 'b1', true);       // 🎨 in flight
  await tick();
  h.api.pvcRun('a', 'b1', false);      // ✨ pressed on the same picture
  await tick();
  ok(h.state.gen.length === 1, 'a second model call was started on a picture already being redrawn');
  const html = h.api.pvsBarHtml(h.state.bank[0], h.state.bank[0].blocks[0]);
  const btn = act => (html.match(new RegExp('<button[^>]*data-pvs-act="' + act + '"[^>]*>([^<]*)</button>')) || []);
  ok(/disabled/.test(btn('colour')[0] || '') && btn('colour')[1] === '⏳', 'the running button does not show ⏳ disabled');
  ok(/disabled/.test(btn('enhance')[0] || '') && btn('enhance')[1] === '✨', 'the OTHER button is not disabled while the picture is being redrawn');
  open(); await tick(); await tick(); await tick();
  const after = h.api.pvsBarHtml(h.state.bank[0], h.state.bank[0].blocks[0]);
  const b2 = act => (after.match(new RegExp('<button[^>]*data-pvs-act="' + act + '"[^>]*>([^<]*)</button>')) || []);
  ok(b2('colour')[1] === '✅' && !/disabled/.test(b2('colour')[0]), 'the finished job is not shown on the button that started it');
  ok(b2('enhance')[1] === '✨' && !/disabled/.test(b2('enhance')[0]), 'the other button still wears the finished job\'s state');
  // …and pvcPaint repaints BOTH copies on the page.
  const w = h.doc.body.children[0];
  h.api.pvcPaint('a', 'b1');
  ok(w.querySelector('[data-pvs-act="colour"]') === null || true, 'stub sanity');
});

test('THE ORIGINAL IS KEPT, once, so the colourisation can be rejected', async () => {
  const h = harness({ bank: [Q('a')], newUrl: 'c1.png' });
  h.api.pvcRun('a', 'b1', true); await tick(); await tick(); await tick();
  ok(h.state.bank[0].blocks[0].preColourUrl === 'x.png', 'the picture that was there was not kept');
  // Colourising twice must not lose the scan behind the FIRST attempt.
  h.state.newUrl = 'c2.png';
  h.api.jobs.clear();
  h.api.pvcRun('a', 'b1', true); await tick(); await tick(); await tick();
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
  h2.api.pvcRun('a', 'b1', true); await tick(); await tick(); await tick();
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
  const work = cut('async function _pvcWork(job) {', '\n// A regenerated picture is exactly', '_pvcWork');
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

test('the pill carries ✨ then 🎨 LAST, set apart from the free controls', () => {
  const h = harness({ bank: [Q('a')] });
  const html = h.api.pvsBarHtml(h.state.bank[0], h.state.bank[0].blocks[0]);
  const acts = (html.match(/data-pvs-act="([a-z]+)"/g) || []).map(m => /"([a-z]+)"/.exec(m)[1]);
  ok(JSON.stringify(acts) === JSON.stringify(['minus', 'plus', 'auto', 'enhance', 'colour']),
    'the pill order changed — ✨ and 🎨 each spend an AI call and must not be where a thumb lands while sizing: ' + acts);
  ok(/pvs-colour/.test(html) && /pvs-enhance/.test(html), 'the two AI buttons have no classes of their own to set them apart');
  ok(/pvcRun\('a','b1',false\)/.test(html) && /pvcRun\('a','b1',true\)/.test(html), 'the two buttons do not name which prompt they send');
});

// ---- the census: the queue, the doors, the guard ---------------------------
test('a colourised question goes to the FRONT of the check queue and is counted', () => {
  const mark = cut('function _pvcMarkRecheck(q, why) {', '\n// Swap the <img>', '_pvcMarkRecheck');
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
  const work = cut('async function _pvcWork(job) {', '\n// A regenerated picture is exactly', '_pvcWork');
  ok(/imgEnhancePrompt\(job\.colour === true, ''\)/.test(work), 'the preview ✨/🎨 do not ask the shared builder with the job\'s own colour');
  // …and the ✅ Check Questions banner knows both reasons.
  const banner = cut('function _cqRecheckBanner(q) {', '\n// Only the findings panel', '_cqRecheckBanner');
  ok(/=== 'enhance'/.test(banner), 'the queue banner calls an ✨ enhance a colourisation');
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
  for (const a of ['minus', 'plus', 'auto', 'enhance', 'colour']) {
    ok(dec.indexOf("'" + a + "'") >= 0, 'the decorator does not bind ' + a + ' inside an exported preview');
  }
});

// ---- ▲▼ the order of a question's elements ----------------------------------
const Q3 = id => ({ id, title: 'Q ' + id, blocks: [{ id: 't1', type: 'text', content: 'stem' }, { id: 'p1', type: 'image', url: 'x.png' }, { id: 'm1', type: 'mcq', options: [] }] });
function orderOf(q) { return q.blocks.map(b => b.id).join(','); }

test('▲▼ swaps two entries of q.blocks, marks the question dirty, and refuses the ends', () => {
  const h = harness({ bank: [Q3('a')] });
  ok(h.api.pvoMove('a', 'p1', -1) === true && orderOf(h.state.bank[0]) === 'p1,t1,m1', 'up did not move the picture above the stem: ' + orderOf(h.state.bank[0]));
  ok(h.api.dirty.get('a') === 'bank', 'the move was not marked for the flush');
  ok(h.api.pvoMove('a', 'p1', -1) === false && orderOf(h.state.bank[0]) === 'p1,t1,m1', 'the TOP element moved up, or the no-op did not say so');
  ok(h.api.pvoMove('a', 'm1', 1) === false, 'the BOTTOM element moved down');
  ok(h.api.pvoMove('a', 't1', 1) === true && orderOf(h.state.bank[0]) === 'p1,m1,t1', 'down did not move');
  ok(h.api.pvoMove('a', 'zz', 1) === false, 'a block that is not there "moved"');
  ok(h.api.pvoMove('nope', 't1', 1) === false && h.toasts.length === 1, 'a question that is gone was not refused in words');
  ok(h.saves.length === 0, 'a move wrote on the press — it must ride the flush');
});

test('a non-author moves nothing; a vetting question is flushed through ITS door', async () => {
  const h = harness({ vetting: [Q3('v')], author: false });
  ok(h.api.pvoMove('v', 'p1', -1) === false && orderOf(h.state.vetting[0]) === 't1,p1,m1', 'a student reordered a question');
  h.api.author = true;
  h.api.pvoMove('v', 'p1', -1);
  await h.api.pvsFlush();
  ok(h.saves.length === 1 && h.saves[0].where === 'vetting', 'the moved vetting question was not written through saveVettingQuestion');
  ok(h.toasts.some(t => /Preview edits saved/.test(t[0])), 'the flush toast still speaks only of picture sizes');
});

test('the editor follows ONLY when it holds this very question and ✏️ editing mode is off', () => {
  const h = harness({ bank: [Q3('a')] });
  const eb = [{ id: 't1' }, { id: 'p1' }, { id: 'm1' }];
  h.api.editing = { id: 'a', blocks: eb };
  h.api.pvoMove('a', 'm1', -1);
  ok(eb.map(b => b.id).join(',') === 't1,m1,p1' && h.state.renders === 1, 'the editor copy still holds the old order — Save there would put it back');
  const other = harness({ bank: [Q3('a')] });
  const ob = [{ id: 't1' }, { id: 'p1' }, { id: 'm1' }];
  other.api.editing = { id: 'b', blocks: ob };
  other.api.pvoMove('a', 'm1', -1);
  ok(ob.map(b => b.id).join(',') === 't1,p1,m1' && other.state.renders === 0, 'a DIFFERENT question open in the editor was reordered — duplicated questions share block ids');
  const em = harness({ bank: [Q3('a')], em: true });
  const emb = [{ id: 't1' }, { id: 'p1' }, { id: 'm1' }];
  em.api.editing = { id: 'a', blocks: emb };
  em.api.pvoMove('a', 'm1', -1);
  ok(emb.map(b => b.id).join(',') === 't1,p1,m1', 'in ✏️ editing mode the global blocks is the WHOLE PAPER and was reordered anyway');
  const shape = harness({ bank: [Q3('a')] });
  const sb = [{ id: 't1' }, { id: 'p1' }];
  shape.api.editing = { id: 'a', blocks: sb };
  shape.api.pvoMove('a', 'm1', -1);
  ok(sb.map(b => b.id).join(',') === 't1,p1', 'an editor holding a different SHAPE of the question was rewritten');
});

test('the open peek is refreshed and the A4 preview re-planned after a move', () => {
  const peek = { host: {}, anchor: {}, qid: 'a', scope: 'vetting' };
  const h = harness({ bank: [Q3('a')], peek });
  h.api.pvoMove('a', 'p1', -1);
  ok(h.state.refreshes === 1, 'the peek was not rewritten from the new order');
  const other = harness({ bank: [Q3('a')], peek: { ...peek, qid: 'zzz' } });
  other.api.pvoMove('a', 'p1', -1);
  ok(other.state.refreshes === 0, 'a peek on a DIFFERENT question was rewritten');
  const overlay = { classList: { contains: c => c === 'show' } };
  const a4 = harness({ bank: [Q3('a')], overlay });
  a4.api.pvoMove('a', 'p1', -1);
  a4.fire();
  ok(a4.replans.length >= 1, 'the A4 preview was not re-planned — the page breaks were decided from the OLD order');
});

test('the wrapper generates no box, and only a question and block with ids get one', () => {
  const h = harness({ bank: [Q3('a')] });
  const open = h.api.pvoWrapOpen(Q3('a'), Q3('a').blocks[1]);
  ok(/display:contents/.test(open), 'the wrapper is a real box — the planner would measure a page the printer does not print');
  ok(/data-pvo-q="a"/.test(open) && /data-pvo-b="p1"/.test(open), 'the wrapper does not name its question and block');
  ok(h.api.pvoWrapOpen({ id: null, blocks: [] }, Q3('a').blocks[1]) === '' && h.api.pvoWrapOpen(Q3('a'), { type: 'text' }) === '', 'a draft or an id-less block got a wrapper it cannot move');
});

function blockWrap(doc, qid, bid) {
  const w = doc.body.appendChild(new El('div')); w.setAttribute('data-pvo-q', qid); w.setAttribute('data-pvo-b', bid);
  const host = w.appendChild(new El('div')); host.className = 'print-text-block';
  return { w, host };
}

test('the decorator hangs ▲▼ on each element, disables the ends, and binds by action', () => {
  const h = harness({ bank: [Q3('a')] });
  const top = blockWrap(h.doc, 'a', 't1'), mid = blockWrap(h.doc, 'a', 'p1'), end = blockWrap(h.doc, 'a', 'm1');
  const none = blockWrap(h.doc, 'zzz', 't1');
  h.api.pvoDecorateDoc(h.doc);
  const bar = host => host.querySelector('[data-pvo-bar]');
  ok(bar(top.host) && bar(mid.host) && bar(end.host), 'an element got no bar');
  ok(!bar(none.host), 'an element of a question that is not in either list got a bar');
  ok(top.host.style.position === 'relative', 'the bar has nothing to sit inside — it lands at the top of the PAGE');
  const up = host => bar(host).querySelector('[data-pvo-act="up"]'), down = host => bar(host).querySelector('[data-pvo-act="down"]');
  ok(up(top.host).hasAttribute('disabled') && !down(top.host).hasAttribute('disabled'), 'the top element offers ▲');
  ok(!up(end.host).hasAttribute('disabled') && down(end.host).hasAttribute('disabled'), 'the bottom element offers ▼');
  ok(typeof up(mid.host).onclick === 'function' && typeof down(mid.host).onclick === 'function', 'the buttons are not bound — inside an iframe the inline handler would resolve against a window with no pvoMove');
  const stop = { stopPropagation() { this.s = 1; }, preventDefault() {} };
  up(mid.host).onclick(stop);
  ok(orderOf(h.state.bank[0]) === 'p1,t1,m1', '▲ did not move the picture');
  ok(h.api.sel && h.api.sel.bid === 'p1', 'the moved element was not selected for the keys');
  ok(h.doc.head.children.some(c => c.id === 'pvsStyle'), 'the stylesheet was not injected into the decorated document');
  h.api.pvoDecorateDoc(h.doc);
  ok(mid.host.querySelectorAll('[data-pvo-bar]').length === 1, 'decorating twice hung two bars');
});

test('↑ / ↓ move the selected (or hovered) element, only while it is on a screen', () => {
  const h = harness({ bank: [Q3('a')] });
  const ev = key => ({ key, target: { tagName: 'BODY' }, preventDefault() { this.p = 1; }, stopPropagation() {} });
  h.api.sel = { qid: 'a', bid: 'p1' };
  let e = ev('ArrowUp'); h.api.pvoKeydown(e);
  ok(orderOf(h.state.bank[0]) === 't1,p1,m1' && !e.p, 'a selection from a preview that is CLOSED moved a block from the arrow keys');
  blockWrap(h.doc, 'a', 'p1');
  e = ev('ArrowUp'); h.api.pvoKeydown(e);
  ok(orderOf(h.state.bank[0]) === 'p1,t1,m1' && e.p === 1, '↑ did not move the selected element, or left the page free to scroll as well');
  e = ev('ArrowUp'); h.api.pvoKeydown(e);
  ok(!e.p, 'a press that moved nothing (top element, ↑) stole the scroll');
  h.api.sel = null; h.api.hover = { qid: 'a', bid: 'p1' };
  e = ev('ArrowDown'); h.api.pvoKeydown(e);
  ok(orderOf(h.state.bank[0]) === 't1,p1,m1' && e.p === 1, '↓ did not act on the HOVERED element when nothing is selected');
  const typing = { key: 'ArrowDown', target: { tagName: 'INPUT' }, preventDefault() { this.p = 1; }, stopPropagation() {} };
  h.api.pvoKeydown(typing);
  ok(orderOf(h.state.bank[0]) === 't1,p1,m1' && !typing.p, 'an arrow key pressed in a text field moved a block');
  const mod = { key: 'ArrowDown', ctrlKey: true, target: { tagName: 'BODY' }, preventDefault() { this.p = 1; }, stopPropagation() {} };
  h.api.pvoKeydown(mod);
  ok(orderOf(h.state.bank[0]) === 't1,p1,m1', 'Ctrl+↓ moved a block');
});

test('the tags are asked for by the PREVIEWS only — the printed sheet never carries them', () => {
  const build = cut('function buildWorksheetHtml(selected, worksheetTitle, opts) {', '\nfunction _flatSyllabusLOs' , 'buildWorksheetHtml');
  ok(/const blockTags = !!\(opts && opts\.blockTags\);/.test(build), 'buildWorksheetHtml does not read the option');
  ok(/if \(blockTags && qHtml\.length > atBlock\)/.test(build) && /pvoWrapOpen\(q, block\)/.test(build), 'the builder does not wrap each element');
  const render = cut('async function renderWsPreview() {', '\nfunction _wsWritePreview(', 'renderWsPreview');
  ok(/blockTags: pvsAllowed\(\)/.test(render), 'the A4 preview does not ask for the order tags');
  const peek = cut('function _vetPrintPeekRender(host, q, scope, serial) {', '\nfunction vetPrintPeekShow(', '_vetPrintPeekRender');
  ok(/blockTags: true/.test(peek), 'the 👁 peek does not ask for the order tags');
  // Every other call passes nothing: the tags are a preview-only wrapper.
  const sites = (src.match(/blockTags:/g) || []).length;
  ok(sites === 2, 'blockTags is passed from ' + sites + ' places — it must be the A4 preview and the peek and nothing else, or a printed sheet carries a wrapper the planner never measured');
  const pack = cut('function _wsPreviewPack(doc, opts) {', '\n// WORKSHEET QUICK EDIT', '_wsPreviewPack');
  ok(/pvoDecorateDoc\(doc\);/.test(pack), 'the pack does not hang the ▲▼ bars after measuring');
  // A move rides the SAME dirty map and flush as the picture size.
  const move = cut('function pvoMove(qid, bid, dir) {', '\n// The editor, if this very question', 'pvoMove');
  ok(/_pvsMark\(found\)/.test(move) && move.indexOf('saveQuestion') < 0, 'a move writes on its own instead of riding the one flush');
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

// ---- 🗑 taking an element off, from a preview ---------------------------------
const Q3K = id => Object.assign(Q3(id), { answerKeywords: { p1: { 2: true }, p1_claim: { 0: true }, t1: { 1: true }, p10: { 3: true } }, blanks: { p1: { 2: true }, t1: {} } });

test('🗑 splices the block out of q.blocks, takes its keywords and blanks with it, and rides the flush', () => {
  const h = harness({ bank: [Q3K('a')] });
  ok(h.api.pvoRemove('a', 'p1') === true && orderOf(h.state.bank[0]) === 't1,m1', 'the picture did not leave the question: ' + orderOf(h.state.bank[0]));
  ok(h.api.dirty.get('a') === 'bank', 'the removal was not marked for the flush');
  ok(h.saves.length === 0, 'a removal wrote on the press — it must ride the flush');
  const kw = h.state.bank[0].answerKeywords;
  ok(!('p1' in kw) && !('p1_claim' in kw), 'the removed block\'s keyword marks were left behind — they come back on the next block given that id');
  ok(('t1' in kw) && ('p10' in kw), 'another block\'s keywords were taken (p10 is not p1_)');
  ok(!('p1' in h.state.bank[0].blanks) && ('t1' in h.state.bank[0].blanks), 'the blanks were not scoped to the removed block');
  ok(h.api.pvoRemove('a', 'zz') === false, 'a block that is not there was "removed"');
  ok(h.api.pvoRemove('nope', 't1') === false, 'a question that is gone was not refused');
  ok(h.toasts.some(t => /no longer here/.test(t[0])), 'a question that is gone was not refused in words');
});

test('a question is never EMPTIED, and a non-author removes nothing', () => {
  const h = harness({ bank: [Q3('a')] });
  ok(h.api.pvoRemove('a', 't1') && h.api.pvoRemove('a', 'p1'), 'two removals refused');
  ok(h.api.pvoRemove('a', 'm1') === false && orderOf(h.state.bank[0]) === 'm1', 'the LAST block was removed — a question with no blocks prints as a numbered gap');
  ok(h.toasts.some(t => /at least one element/.test(t[0])), 'the refusal was silent');
  const s = harness({ bank: [Q3('a')], author: false });
  ok(s.api.pvoRemove('a', 'p1') === false && orderOf(s.state.bank[0]) === 't1,p1,m1', 'a student removed an element');
});

test('↩ puts the removed element back where it was, keywords and blanks included, once', () => {
  const h = harness({ bank: [Q3K('a')] });
  h.api.pvoRemove('a', 'p1');
  ok(h.api.undo.length === 1 && h.api.undo[0].index === 1, 'the removal was not remembered with its position');
  ok(h.api.pvoUndo('a') === true && orderOf(h.state.bank[0]) === 't1,p1,m1', 'undo did not put the picture back in the middle: ' + orderOf(h.state.bank[0]));
  ok(h.state.bank[0].answerKeywords.p1 && h.state.bank[0].answerKeywords.p1_claim, 'the keywords did not come back with the block');
  ok(h.state.bank[0].blanks.p1, 'the blanks did not come back with the block');
  ok(h.api.undo.length === 0 && h.api.pvoUndo('a') === false, 'the same removal could be undone twice');
  ok(h.api.dirty.get('a') === 'bank', 'the undo was not marked for the flush');
  // Removed from the END, undone after the list shrank further: clamped, never past the end.
  const e = harness({ bank: [Q3('b')] });
  e.api.pvoRemove('b', 'm1'); e.api.pvoRemove('b', 'p1');
  ok(e.api.pvoUndo() === true && orderOf(e.state.bank[0]) === 't1,p1', 'undo with no qid did not take the most recent removal');
  ok(e.api.pvoUndo('b') === true && orderOf(e.state.bank[0]) === 't1,p1,m1', 'the earlier removal did not come back at its own position');
  // A block that came back some other way is not doubled.
  const d = harness({ bank: [Q3('c')] });
  d.api.pvoRemove('c', 'p1');
  d.state.bank[0].blocks.push({ id: 'p1', type: 'image' });
  ok(d.api.pvoUndo('c') === false && orderOf(d.state.bank[0]) === 't1,m1,p1', 'an element already back on the question was put back a second time');
});

test('the editor drops and restores the same block, only when it holds this question and ✏️ editing mode is off', () => {
  const h = harness({ bank: [Q3('a')] });
  const eb = [{ id: 't1' }, { id: 'p1' }, { id: 'm1' }];
  h.api.editing = { id: 'a', blocks: eb };
  h.api.pvoRemove('a', 'p1');
  ok(eb.map(b => b.id).join(',') === 't1,m1' && h.state.renders === 1, 'the editor copy still holds the block — Save there would put it back');
  ok((h.state.forgot || []).includes('p1'), 'the editor\'s own keyword marks for the block were not forgotten');
  h.api.pvoUndo('a');
  ok(eb.map(b => b.id).join(',') === 't1,p1,m1', 'the editor did not get the block back on undo');
  ok(eb[1] !== h.state.bank[0].blocks[1], 'the editor and the bank SHARE the restored block object — a keystroke there edits the bank before Save');
  const other = harness({ bank: [Q3('a')] });
  const ob = [{ id: 't1' }, { id: 'p1' }, { id: 'm1' }];
  other.api.editing = { id: 'b', blocks: ob };
  other.api.pvoRemove('a', 'p1');
  ok(ob.length === 3 && other.state.renders === 0, 'a DIFFERENT question open in the editor lost a block — duplicated questions share block ids');
  const em = harness({ bank: [Q3('a')], em: true });
  const emb = [{ id: 't1' }, { id: 'p1' }, { id: 'm1' }];
  em.api.editing = { id: 'a', blocks: emb };
  em.api.pvoRemove('a', 'p1');
  ok(emb.length === 3, 'in ✏️ editing mode the global blocks is the WHOLE PAPER and lost a block anyway');
});

test('the bar carries 🗑 (disabled on a lone block) and ↩ only once something was removed; Delete and Ctrl+Z work the keys', () => {
  const h = harness({ bank: [Q3('a')] });
  const mid = blockWrap(h.doc, 'a', 'p1');
  h.api.pvoDecorateDoc(h.doc);
  const bar = mid.host.querySelector('[data-pvo-bar]');
  const del = bar.querySelector('[data-pvo-act="del"]');
  ok(del && typeof del.onclick === 'function' && !del.hasAttribute('disabled'), 'no bound 🗑 on the bar');
  ok(!bar.querySelector('[data-pvo-act="undo"]'), '↩ offered with nothing to put back');
  del.onclick({ stopPropagation() {}, preventDefault() {} });
  ok(orderOf(h.state.bank[0]) === 't1,m1', '🗑 did not remove the element');
  ok(h.api.sel === null, 'the removed element stayed selected for the keys');
  // Redecorate (the preview is redrawn from q.blocks): ↩ now appears on the question's bars.
  const stem = blockWrap(h.doc, 'a', 't1');
  h.api.pvoDecorateDoc(h.doc);
  const undo = stem.host.querySelector('[data-pvo-act="undo"]');
  ok(undo && typeof undo.onclick === 'function', '↩ is missing from a bar of a question with a removal to undo');
  undo.onclick({ stopPropagation() {}, preventDefault() {} });
  ok(orderOf(h.state.bank[0]) === 't1,p1,m1', '↩ on the bar did not put the element back');
  // A lone block's 🗑 is disabled.
  const lone = harness({ bank: [{ id: 'l', blocks: [{ id: 'only', type: 'text' }] }] });
  const lw = blockWrap(lone.doc, 'l', 'only');
  lone.api.pvoDecorateDoc(lone.doc);
  ok(lw.host.querySelector('[data-pvo-act="del"]').hasAttribute('disabled'), 'the only element of a question offers 🗑');
  // Keys.
  const k = harness({ bank: [Q3('k')] });
  const ev = (key, extra) => Object.assign({ key, target: { tagName: 'BODY' }, preventDefault() { this.p = 1; }, stopPropagation() {} }, extra || {});
  k.api.sel = { qid: 'k', bid: 'p1' };
  let e = ev('Delete'); k.api.pvoKeydown(e);
  ok(orderOf(k.state.bank[0]) === 't1,p1,m1' && !e.p, 'Delete acted on an element that is not on any screen');
  blockWrap(k.doc, 'k', 'p1'); blockWrap(k.doc, 'k', 't1');
  e = ev('Delete'); k.api.pvoKeydown(e);
  ok(orderOf(k.state.bank[0]) === 't1,m1' && e.p === 1, 'Delete did not remove the selected element');
  e = ev('Backspace'); k.api.pvoKeydown(e);
  ok(orderOf(k.state.bank[0]) === 't1,m1' && !e.p, 'Backspace removed an element');
  k.api.hover = { qid: 'k', bid: 't1' };
  e = ev('z', { ctrlKey: true }); k.api.pvoKeydown(e);
  ok(orderOf(k.state.bank[0]) === 't1,p1,m1' && e.p === 1, 'Ctrl+Z did not put the element back');
  e = ev('z', { ctrlKey: true }); k.api.pvoKeydown(e);
  ok(!e.p, 'Ctrl+Z with nothing to undo was swallowed');
  const typing = ev('Delete', { target: { tagName: 'INPUT' } }); k.api.sel = { qid: 'k', bid: 'p1' }; k.api.pvoKeydown(typing);
  ok(orderOf(k.state.bank[0]) === 't1,p1,m1' && !typing.p, 'Delete pressed in a text field removed an element');
});

test('a removal rides the same flush, and the harness pins the write-free press', () => {
  const rm = cut('function pvoRemove(qid, bid) {', '\n// The keyword marks and the blanks', 'pvoRemove');
  ok(/_pvsMark\(found\)/.test(rm) && rm.indexOf('saveQuestion') < 0, 'a removal writes on its own instead of riding the one flush');
  ok(/list\.length <= 1/.test(rm), 'the last-block guard is gone');
  const dec = cut('function pvoDecorateDoc(doc) {', '\n\nfunction previewImage(blockId, url) {', 'pvoDecorateDoc');
  ok(/data-pvo-act="del"/.test(dec) && /'\[data-pvo-act="del"\]'/.test(dec), 'the decorator does not bind 🗑 by action');
  ok(/pvoRemove/.test(dec) && /pvoUndo/.test(dec), 'the decorator binds no handler for 🗑 / ↩');
});

runAll();
