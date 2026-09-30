// Regression tests for 🧭 JEV REVIEW — the yes/no gate on everything an
// automatic import (⚡ Rapid add, PDF add, the exam-paper / custom-paper
// readers) produces, and the AI check-and-fix that follows a NO.
// Run with:  node tools/jev-review-tests.mjs
//
// It loads the REAL Jev block out of app.js and runs it against stubs.
// Every failure here is silent — the question still lands in Vetting:
//  • a NO that does not reach the AI is Jev being decorative;
//  • a YES that skips the AI when it is not confident lets a bad crop through;
//  • Jev being unreachable must change NOTHING (the AI checks everything);
//  • a crop the AI could not fix must be KEPT and flagged, never dropped;
//  • the two copies of the shared core must never drift, or the browser and the
//    durable worker judge the same question differently.
import fs from 'fs';
import vm from 'vm';

const root = new URL('../', import.meta.url);
const src = fs.readFileSync(new URL('app.js', root), 'utf8');
const core = fs.readFileSync(new URL('jev-review-core.mjs', root), 'utf8');
let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
};
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), (m || 'not equal') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));

const c = await import(new URL('jev-review-core.mjs', root));

// ---- carve the real block out of app.js ------------------------------------
const a = src.indexOf('// 🧭 JEV REVIEW — the yes/no gate');
const b = src.indexOf("// Fill a question's image blocks from the AI-drawn rectangles (screenshots\n");
assert(a > 0 && b > a, 'the Jev block could not be found in app.js');
const block = src.slice(a, b);

function world(over = {}) {
  const calls = { jev: [], recrop: [], cut: [] };
  const store = {};
  const env = {
    console, Date, JSON, Number, Array, Math, Set, String, Object, Error, Promise,
    ...c,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    document: { getElementById: () => null },
    _canAuthor: () => true,
    _autoChkPaint() {},
    _rapidCloudCall: async (name, data) => { calls.jev.push({ name, data }); return over.jev ? over.jev(data, calls.jev.length) : { available: false }; },
    _cropBoxFromScreenshotEx: async (full, box, opts) => { calls.cut.push({ box, opts }); return over.cut ? over.cut(box, opts, calls.cut.length) : null; },
    askGeminiVision: async (prompt, media) => { calls.recrop.push({ prompt, media }); return over.recrop ? over.recrop(prompt, media, calls.recrop.length) : '{}'; },
    _parseAIJson: raw => { try { return JSON.parse(raw); } catch (e) { return null; } },
    ...over.env
  };
  vm.createContext(env);
  vm.runInContext(block + '\nthis.__x={jevGateOn,setJevGateOn,jevReviewCall,_jevGateFigures,jevGateQuestion,_jevFigureFindings,_jevReachable,JEV_RECROP_TRIES};', env);
  return { x: env.__x, calls, store };
}
const measure = (over = {}) => ({ ink: 0.1, clipped: [], bleed: { top: 0, right: 0, bottom: 0, left: 0 }, unreadable: false, ...over });
const good = (over = {}) => ({ dataUrl: 'data:image/png;base64,GOOD', width: 300, height: 200, pageShare: .2, measure: measure(over.measure), ...over });
const yes = (conf = .95) => ({ type: 'x', ok: true, choice: 'yes', confidence: conf });
const no = (conf = .9) => ({ ok: false, choice: 'no', confidence: conf });

await test('Jev says no to a crop → the AI is asked to cut it again, told why, and the better cut wins', async () => {
  const { x, calls } = world({
    jev: (data, n) => ({ available: true, verdicts: n === 1 ? { figure_0: no() } : { figure_0: yes() } }),
    cut: () => good({ dataUrl: 'data:image/png;base64,FIXED' }),
    recrop: () => JSON.stringify({ box_2d: [100, 100, 400, 500] })
  });
  const out = await x._jevGateFigures([{ ex: good(), dataUrl: 'data:image/png;base64,OLD', box: [1, 1, 2, 2] }], 'image/png', 'PAGE', 'data:image/png;base64,PAGE');
  eq([out[0].state, out[0].tries], ['fixed', 1]);
  assert(out[0].dataUrl.endsWith('FIXED'), 'the new cut replaces the old one');
  eq(out[0].box, [100, 100, 400, 500], 'the box that worked is the one recorded');
  assert(/judged wrong/.test(calls.recrop[0].prompt) && /Jev judged the crop/.test(calls.recrop[0].prompt), 'the AI is told what Jev objected to');
  eq(calls.recrop[0].media.length, 2, 'the AI sees the whole page AND the bad crop');
  eq(calls.cut[0].opts.marginScale, 1.6, 'the first re-cut widens the margin');
});
await test('a crop that visibly runs past its edge is re-cut even when Jev says yes — and even when Jev is unreachable', async () => {
  for (const jev of [() => ({ available: true, verdicts: { figure_0: yes() } }), () => ({ available: false })]) {
    const { x, calls } = world({ jev, cut: () => good(), recrop: () => JSON.stringify({ box_2d: [10, 10, 500, 500] }) });
    const out = await x._jevGateFigures([{ ex: good({ measure: measure({ clipped: ['right'], bleed: { top: 0, right: .5, bottom: 0, left: 0 } }) }), dataUrl: 'data:image/png;base64,OLD', box: [1, 1, 2, 2] }], 'image/png', 'P', 'data:image/png;base64,P');
    assert(calls.recrop.length >= 1, 'the code’s own defect finding triggers the AI');
    eq(out[0].state, 'fixed');
  }
});
await test('a crop nobody can fix is tried exactly twice, KEPT (best attempt) and flagged — never dropped', async () => {
  const { x, calls } = world({
    jev: () => ({ available: true, verdicts: { figure_0: no() } }),
    cut: () => good(), recrop: () => JSON.stringify({ box_2d: [10, 10, 500, 500] })
  });
  const out = await x._jevGateFigures([{ ex: good(), dataUrl: 'data:image/png;base64,ORIG', box: [1, 1, 2, 2] }], 'image/png', 'P', 'data:image/png;base64,P');
  eq(calls.recrop.length, x.JEV_RECROP_TRIES, 'two AI re-cuts and no more');
  eq(out[0].state, 'flagged');
  assert(out[0].dataUrl, 'a picture is still there for the author to see');
  const f = x._jevFigureFindings([{ index: 0, reasons: out[0].reasons, state: 'flagged' }]);
  assert(f.length && f[0].type === 'Crop', 'the flag becomes a Crop finding on the vetting card');
});
await test('a rectangle that could not be cut at all is located by the AI', async () => {
  const { x, calls } = world({
    jev: () => ({ available: false }),
    cut: (box, opts, n) => good({ dataUrl: 'data:image/png;base64,LOCATED' }),
    recrop: () => JSON.stringify({ box_2d: [200, 100, 500, 600] })
  });
  const out = await x._jevGateFigures([{ ex: null, dataUrl: null, box: null }], 'image/png', 'P', 'data:image/png;base64,P');
  eq(calls.recrop[0].media.length, 1, 'no bad crop to show, only the page');
  assert(/No usable crop/.test(calls.recrop[0].prompt));
  eq(out[0].state, 'fixed');
});
await test('the AI answering nonsense, or failing, leaves the original crop in place and flagged', async () => {
  for (const recrop of [() => 'not json', () => JSON.stringify({ box_2d: [5, 5, 5, 5] }), () => { throw new Error('offline'); }]) {
    const { x } = world({ jev: () => ({ available: true, verdicts: { figure_0: no() } }), recrop });
    const out = await x._jevGateFigures([{ ex: good(), dataUrl: 'data:image/png;base64,ORIG', box: [1, 1, 2, 2] }], 'image/png', 'P', 'data:image/png;base64,P');
    assert(out[0].dataUrl.endsWith('ORIG') && out[0].state === 'flagged');
  }
});
await test('a clean crop costs no AI call at all', async () => {
  const { x, calls } = world({ jev: () => ({ available: true, verdicts: { figure_0: yes() } }) });
  const out = await x._jevGateFigures([{ ex: good(), dataUrl: 'data:image/png;base64,OK', box: [1, 1, 2, 2] }], 'image/png', 'P', 'data:image/png;base64,P');
  eq([out[0].state, calls.recrop.length], ['ok', 0]);
});

const goodQ = { blocks: [
  { type: 'text', content: '<p>Study the graph and answer.</p>' }, { type: 'image', url: 'u' },
  { type: 'plainanswer', content: 'It rises.' }] };
await test('question gate: only a CONFIDENT clean yes skips the AI read', async () => {
  let w = world({ jev: () => ({ available: true, verdicts: { wording: yes(.95), structure: yes(.95) } }) });
  let g = await w.x.jevGateQuestion(goodQ, { figures: [] });
  eq([g.available, g.confident], [true, true]);
  w = world({ jev: () => ({ available: true, verdicts: { wording: yes(.95), structure: yes(.7) } }) });
  g = await w.x.jevGateQuestion(goodQ, { figures: [] });
  eq([g.available, g.confident], [true, false], 'a lukewarm yes still gets the AI');
});
await test('question gate: a no becomes findings for the AI; a flagged crop blocks the skip', async () => {
  let w = world({ jev: () => ({ available: true, verdicts: { wording: no(), structure: yes() } }) });
  let g = await w.x.jevGateQuestion(goodQ, { figures: [] });
  assert(!g.confident && g.findings.some(f => f.type === 'Wording'));
  w = world({ jev: () => ({ available: true, verdicts: { wording: yes(), structure: yes() } }) });
  g = await w.x.jevGateQuestion(goodQ, { figures: [{ index: 0, state: 'flagged', reasons: ['clipped'] }] });
  assert(!g.confident && g.figureFindings.length === 1, 'a crop the AI could not fix means a person must look');
});
await test('question gate: Jev unreachable → not confident, so the AI checks everything as it always did', async () => {
  const w = world({ jev: () => { const e = new Error('nope'); e.code = 'failed-precondition'; throw e; } });
  const g = await w.x.jevGateQuestion(goodQ, { figures: [] });
  eq([g.available, g.confident], [false, false]);
  const again = await w.x.jevGateQuestion(goodQ, { figures: [] });
  eq(w.calls.jev.length, 1, 'a refused Jev is not asked again straight away');
});
await test('a question with a hard defect fails the gate even when Jev says yes', async () => {
  const w = world({ jev: () => ({ available: true, verdicts: { wording: yes(.99), structure: yes(.99) } }) });
  const g = await w.x.jevGateQuestion({ blocks: [{ type: 'text', content: 'Which is right?' }, { type: 'mcq', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'x' }], correctId: null }] }, { figures: [] });
  assert(!g.confident && g.findings.some(f => /no option is marked/.test(f.title)));
});
await test('the switch turns Jev off and only administrators can reach it', async () => {
  const w = world({ jev: () => ({ available: true, verdicts: {} }) });
  w.x.setJevGateOn(false);
  eq(await w.x.jevReviewCall({ scope: 'question', question: {} }), null);
  eq(w.calls.jev.length, 0, 'switched off means no call is made');
  const emp = world({ env: { _canAuthor: () => false }, jev: () => ({ available: true, verdicts: { a: 1 } }) });
  eq(await emp.x.jevReviewCall({ scope: 'question', question: {} }), null);
  eq(emp.calls.jev.length, 0);
});

// ---- wiring pinned against app.js itself ------------------------------------
await test('the shared core is byte-identical in the site and in the durable worker', () => {
  assert(fs.readFileSync(new URL('rapid-import/functions/jev-review-core.js', root), 'utf8') === core, 'the two copies of the core differ');
});
await test('the browser calls the same function the worker exports', () => {
  assert(/_rapidCloudCall\('cerJevReview'/.test(src));
  assert(/export const cerJevReview\s*=/.test(fs.readFileSync(new URL('rapid-import/functions/index.js', root), 'utf8')));
});
await test('the crop review runs BEFORE the "nothing usable" early return, so an uncuttable rectangle reaches the AI', () => {
  const f = src.slice(src.indexOf('async function _fillBlocksFromAiBoxes'));
  assert(f.indexOf('_jevGateFigures(') > 0 && f.indexOf('_jevGateFigures(') < f.indexOf('if (!crops.some(Boolean)) return 0;'));
});
await test('⚡ Rapid add: Jev is advisory: a yes never skips the AI (JEV_MAY_SKIP off) and the comparison is recorded; everything else goes to autoChkRun with Jev\'s findings', () => {
  const s = src.slice(src.indexOf('🧭 JEV DECIDES WHO GETS THE AI'));
  const sk = s.indexOf('gate.confident'), run = s.indexOf('autoChkRun(q, {');
  assert(sk > 0 && run > sk, 'the skip must be conditional on gate.confident, with autoChkRun as the else');
  assert(/gate\.confident && JEV_MAY_SKIP/.test(s), 'the skip is behind JEV_MAY_SKIP');
  assert(/q\.jevShadow = /.test(s), 'the Jev-vs-AI comparison is recorded');
  assert(/JEV_MAY_SKIP = false/.test(core), 'advisory by default');
  assert(/extraFindings: gate \? gate\.findings/.test(s) && /figureFindings:/.test(s));
  assert(/if \(!filled\)/.test(src.slice(src.indexOf('async function processRapidJob'))), 'the whole-page backup is still there');
  assert(/\{ jev: jevRun \}/.test(src), 'the question hands the crop review an out-parameter it reads at 2c');
});
await test('the AI check keeps carrying crop findings through every attempt but never asks a wording repair to fix them', () => {
  const r = src.slice(src.indexOf('async function autoChkRun'));
  assert(/o\.figureFindings/.test(r) && /f\.type !== 'Crop'/.test(r));
});
await test('a Jev-cleared question is stamped honestly, not as an AI read', () => {
  assert(/if \(res\.jev\) q\.autoCheck\.jev = true;/.test(src));
  assert(/does not judge the science/.test(src));
});
await test('the durable worker and the browser use the same retry budget', () => {
  assert(/JEV_RECROP_TRIES = 2/.test(src) && /JEV_RECROP_TRIES = 2/.test(fs.readFileSync(new URL('rapid-import/functions/index.js', root), 'utf8')));
});

console.log(`\n${failed ? '✗' : '✅'} ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
