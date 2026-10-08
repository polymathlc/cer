// Regression tests for 🧭 DECISIONS REVIEW — the yes/no gate on everything an
// automatic import (⚡ Rapid add, PDF add, the exam-paper / custom-paper
// readers) produces, and the AI check-and-fix that follows a NO.
// Run with:  node tools/decisions-review-tests.mjs
//
// It loads the REAL Decisions block out of app.js and runs it against stubs.
// Every failure here is silent — the question still lands in Vetting:
//  • a NO that does not reach the AI is Decisions being decorative;
//  • a YES that skips the AI when it is not confident lets a bad crop through;
//  • Decisions being unreachable must change NOTHING (the AI checks everything);
//  • a crop the AI could not fix must be KEPT and flagged, never dropped;
//  • the two copies of the shared core must never drift, or the browser and the
//    durable worker judge the same question differently.
import fs from 'fs';
import vm from 'vm';

const root = new URL('../', import.meta.url);
const src = fs.readFileSync(new URL('app.js', root), 'utf8');
const core = fs.readFileSync(new URL('decisions-review-core.mjs', root), 'utf8');
let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
};
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), (m || 'not equal') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));

const c = await import(new URL('decisions-review-core.mjs', root));

// ---- carve the real block out of app.js ------------------------------------
const a = src.indexOf('// 🧭 DECISIONS REVIEW — the yes/no gate');
const b = src.indexOf("// Fill a question's image blocks from the AI-drawn rectangles (screenshots\n");
assert(a > 0 && b > a, 'the Decisions block could not be found in app.js');
const block = src.slice(a, b);

function world(over = {}) {
  const calls = { decisions: [], recrop: [], cut: [], refine: [] };
  const store = { ...over.storage };
  const env = {
    console, Date, JSON, Number, Array, Math, Set, String, Object, Error, Promise,
    ...c,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    document: { getElementById: () => null },
    _canAuthor: () => true,
    _isAdmin: () => true,
    _autoChkPaint() {},
    _rapidCloudCall: async (name, data) => { calls.decisions.push({ name, data }); return over.decisions ? over.decisions(data, calls.decisions.length) : { available: false }; },
    _cropBoxFromScreenshotEx: async (full, box, opts) => { calls.cut.push({ box, opts }); return over.cut ? over.cut(box, opts, calls.cut.length) : null; },
    askGeminiVision: async (prompt, media) => { calls.recrop.push({ prompt, media }); return over.recrop ? over.recrop(prompt, media, calls.recrop.length) : '{}'; },
    // The crop clean-up: by default it finds nothing to cut. `over.refine`
    // may replace src.ex the way the real one does when its cut is kept.
    _aiRefineCrop: async (dataUrl, wording, src) => { calls.refine.push({ dataUrl, wording, src }); return over.refine ? over.refine(dataUrl, wording, src) : dataUrl; },
    _parseAIJson: raw => { try { return JSON.parse(raw); } catch (e) { return null; } },
    ...over.env
  };
  vm.createContext(env);
  vm.runInContext(block + '\nthis.__x={decisionsGateOn,setDecisionsGateOn,decisionsReviewCall,_decisionsGateFigures,decisionsGateQuestion,_decisionsFigureFindings,_decisionsReachable,DECISIONS_RECROP_TRIES};', env);
  return { x: env.__x, calls, store };
}
const measure = (over = {}) => ({ ink: 0.1, clipped: [], bleed: { top: 0, right: 0, bottom: 0, left: 0 }, unreadable: false, ...over });
const good = (over = {}) => ({ dataUrl: 'data:image/png;base64,GOOD', width: 300, height: 200, pageShare: .2, measure: measure(over.measure), ...over });
const yes = (conf = .95) => ({ type: 'x', ok: true, choice: 'yes', confidence: conf });
const no = (conf = .9) => ({ ok: false, choice: 'no', confidence: conf });

await test('Decisions says no to a crop → the AI is asked to cut it again, told why, and the better cut wins', async () => {
  const { x, calls } = world({
    decisions: (data, n) => ({ available: true, verdicts: n === 1 ? { figure_0: no() } : { figure_0: yes() } }),
    cut: () => good({ dataUrl: 'data:image/png;base64,FIXED' }),
    recrop: () => JSON.stringify({ box_2d: [100, 100, 400, 500] })
  });
  const out = await x._decisionsGateFigures([{ ex: good(), dataUrl: 'data:image/png;base64,OLD', box: [1, 1, 2, 2] }], 'image/png', 'PAGE', 'data:image/png;base64,PAGE');
  eq([out[0].state, out[0].tries], ['fixed', 1]);
  assert(out[0].dataUrl.endsWith('FIXED'), 'the new cut replaces the old one');
  eq(out[0].box, [100, 100, 400, 500], 'the box that worked is the one recorded');
  assert(/judged wrong/.test(calls.recrop[0].prompt) && /Decisions judged the crop/.test(calls.recrop[0].prompt), 'the AI is told what Decisions objected to');
  eq(calls.recrop[0].media.length, 2, 'the AI sees the whole page AND the bad crop');
  eq(calls.cut[0].opts.marginScale, 1.6, 'the first re-cut widens the margin');
});
await test('a crop that visibly runs past its edge is re-cut even when Decisions says yes — and even when Decisions is unreachable', async () => {
  for (const decisions of [() => ({ available: true, verdicts: { figure_0: yes() } }), () => ({ available: false })]) {
    const { x, calls } = world({ decisions, cut: () => good(), recrop: () => JSON.stringify({ box_2d: [10, 10, 500, 500] }) });
    const out = await x._decisionsGateFigures([{ ex: good({ measure: measure({ clipped: ['right'], bleed: { top: 0, right: .5, bottom: 0, left: 0 } }) }), dataUrl: 'data:image/png;base64,OLD', box: [1, 1, 2, 2] }], 'image/png', 'P', 'data:image/png;base64,P');
    assert(calls.recrop.length >= 1, 'the code’s own defect finding triggers the AI');
    eq(out[0].state, 'fixed');
  }
});
await test('a crop nobody can fix is tried exactly twice, KEPT (best attempt) and flagged — never dropped', async () => {
  const { x, calls } = world({
    decisions: () => ({ available: true, verdicts: { figure_0: no() } }),
    cut: () => good(), recrop: () => JSON.stringify({ box_2d: [10, 10, 500, 500] })
  });
  const out = await x._decisionsGateFigures([{ ex: good(), dataUrl: 'data:image/png;base64,ORIG', box: [1, 1, 2, 2] }], 'image/png', 'P', 'data:image/png;base64,P');
  eq(calls.recrop.length, x.DECISIONS_RECROP_TRIES, 'two AI re-cuts and no more');
  eq(out[0].state, 'flagged');
  assert(out[0].dataUrl, 'a picture is still there for the author to see');
  const f = x._decisionsFigureFindings([{ index: 0, reasons: out[0].reasons, state: 'flagged' }]);
  assert(f.length && f[0].type === 'Crop', 'the flag becomes a Crop finding on the vetting card');
});
await test('a rectangle that could not be cut at all is located by the AI', async () => {
  const { x, calls } = world({
    decisions: () => ({ available: false }),
    cut: (box, opts, n) => good({ dataUrl: 'data:image/png;base64,LOCATED' }),
    recrop: () => JSON.stringify({ box_2d: [200, 100, 500, 600] })
  });
  const out = await x._decisionsGateFigures([{ ex: null, dataUrl: null, box: null }], 'image/png', 'P', 'data:image/png;base64,P');
  eq(calls.recrop[0].media.length, 1, 'no bad crop to show, only the page');
  assert(/No usable crop/.test(calls.recrop[0].prompt));
  eq(out[0].state, 'fixed');
});
await test('the AI answering nonsense, or failing, leaves the original crop in place and flagged', async () => {
  for (const recrop of [() => 'not json', () => JSON.stringify({ box_2d: [5, 5, 5, 5] }), () => { throw new Error('offline'); }]) {
    const { x } = world({ decisions: () => ({ available: true, verdicts: { figure_0: no() } }), recrop });
    const out = await x._decisionsGateFigures([{ ex: good(), dataUrl: 'data:image/png;base64,ORIG', box: [1, 1, 2, 2] }], 'image/png', 'P', 'data:image/png;base64,P');
    assert(out[0].dataUrl.endsWith('ORIG') && out[0].state === 'flagged');
  }
});
await test('an AI re-cut gets the same clean-up as the first cut — told the wording, cut from the page — and Decisions sees the cleaned cut', async () => {
  const { x, calls } = world({
    decisions: (data, n) => ({ available: true, verdicts: n === 1 ? { figure_0: no() } : { figure_0: yes() } }),
    cut: () => good({ dataUrl: 'data:image/png;base64,RECUT', height: 400 }),
    recrop: () => JSON.stringify({ box_2d: [100, 100, 400, 500] }),
    refine: (d, w, src) => { src.ex = good({ dataUrl: 'data:image/png;base64,CLEAN', height: 250 }); return src.ex.dataUrl; }
  });
  const out = await x._decisionsGateFigures([{ ex: good(), dataUrl: 'data:image/png;base64,OLD', box: [1, 1, 2, 2] }],
    'image/png', 'PAGE', 'data:image/png;base64,PAGE', null, '- The table shows three substances.');
  eq(calls.refine.length, 1, 'the re-cut is cleaned up once');
  eq(calls.refine[0].wording, '- The table shows three substances.', 'with the question\'s typed wording');
  eq(calls.refine[0].src.page, 'data:image/png;base64,PAGE', 'and the page it is cut from');
  assert(out[0].dataUrl.endsWith('CLEAN') && out[0].ex.height === 250, 'the cleaned cut is the one kept');
  eq(calls.decisions[1].data.figures[0].height, 250, 'Decisions is asked about the cleaned cut, not the raw one');
  assert(calls.decisions.every(c => c.data.figures.every(f => f.aiSawStrayText === false)),
    'a clean-up that worked is never reported to Decisions as stray text');
});
await test('a clean crop costs no AI call at all', async () => {
  const { x, calls } = world({ decisions: () => ({ available: true, verdicts: { figure_0: yes() } }) });
  const out = await x._decisionsGateFigures([{ ex: good(), dataUrl: 'data:image/png;base64,OK', box: [1, 1, 2, 2] }], 'image/png', 'P', 'data:image/png;base64,P');
  eq([out[0].state, calls.recrop.length], ['ok', 0]);
});

const goodQ = { blocks: [
  { type: 'text', content: '<p>Study the graph and answer.</p>' }, { type: 'image', url: 'u' },
  { type: 'plainanswer', content: 'It rises.' }] };
await test('question gate: only a CONFIDENT clean yes skips the AI read', async () => {
  let w = world({ decisions: () => ({ available: true, verdicts: { wording: yes(.95), structure: yes(.95) } }) });
  let g = await w.x.decisionsGateQuestion(goodQ, { figures: [] });
  eq([g.available, g.confident], [true, true]);
  w = world({ decisions: () => ({ available: true, verdicts: { wording: yes(.95), structure: yes(.7) } }) });
  g = await w.x.decisionsGateQuestion(goodQ, { figures: [] });
  eq([g.available, g.confident], [true, false], 'a lukewarm yes still gets the AI');
});
await test('question gate: a no becomes findings for the AI; a flagged crop blocks the skip', async () => {
  let w = world({ decisions: () => ({ available: true, verdicts: { wording: no(), structure: yes() } }) });
  let g = await w.x.decisionsGateQuestion(goodQ, { figures: [] });
  assert(!g.confident && g.findings.some(f => f.type === 'Wording'));
  w = world({ decisions: () => ({ available: true, verdicts: { wording: yes(), structure: yes() } }) });
  g = await w.x.decisionsGateQuestion(goodQ, { figures: [{ index: 0, state: 'flagged', reasons: ['clipped'] }] });
  assert(!g.confident && g.figureFindings.length === 1, 'a crop the AI could not fix means a person must look');
});
await test('question gate: Decisions unreachable → not confident, so the AI checks everything as it always did', async () => {
  const w = world({ decisions: () => { const e = new Error('nope'); e.code = 'failed-precondition'; throw e; } });
  const g = await w.x.decisionsGateQuestion(goodQ, { figures: [] });
  eq([g.available, g.confident], [false, false]);
  const again = await w.x.decisionsGateQuestion(goodQ, { figures: [] });
  eq(w.calls.decisions.length, 1, 'a refused Decisions is not asked again straight away');
});
await test('a question with a hard defect fails the gate even when Decisions says yes', async () => {
  const w = world({ decisions: () => ({ available: true, verdicts: { wording: yes(.99), structure: yes(.99) } }) });
  const g = await w.x.decisionsGateQuestion({ blocks: [{ type: 'text', content: 'Which is right?' }, { type: 'mcq', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'x' }], correctId: null }] }, { figures: [] });
  assert(!g.confident && g.findings.some(f => /no option is marked/.test(f.title)));
});
await test('the switch turns Decisions off and only administrators can reach it', async () => {
  const w = world({ decisions: () => ({ available: true, verdicts: {} }) });
  w.x.setDecisionsGateOn(false);
  eq(await w.x.decisionsReviewCall({ scope: 'question', question: {} }), null);
  eq(w.calls.decisions.length, 0, 'switched off means no call is made');
  const emp = world({ env: { _canAuthor: () => true, _isAdmin: () => false }, decisions: () => ({ available: true, verdicts: { a: 1 } }) });
  eq(await emp.x.decisionsReviewCall({ scope: 'question', question: {} }), null);
  eq(emp.calls.decisions.length, 0);
});

await test('saved review preferences migrate once and current preferences take precedence', () => {
  const old = world({ storage: { sq_jev_gate: '0' } });
  eq(old.x.decisionsGateOn(), false);
  eq(old.store.sq_decisions_gate, '0');
  assert(!Object.hasOwn(old.store, 'sq_jev_gate'));
  const current = world({ storage: { sq_jev_gate: '0', sq_decisions_gate: '1' } });
  eq(current.x.decisionsGateOn(), true);
});

await test('a failed preference migration still honors a saved opt-out', () => {
  const w = world({ env: { localStorage: { getItem: k => k === 'sq_jev_gate' ? '0' : null, setItem: () => { throw new Error('storage unavailable'); } } } });
  eq(w.x.decisionsGateOn(), false);
});

// ---- wiring pinned against app.js itself ------------------------------------
await test('the shared core is byte-identical in the site and in the durable worker', () => {
  assert(fs.readFileSync(new URL('rapid-import/functions/decisions-review-core.js', root), 'utf8') === core, 'the two copies of the core differ');
});
await test('the browser calls the same function the worker exports', () => {
  assert(/_rapidCloudCall\('cerDecisionsReview'/.test(src));
  assert(/export const cerDecisionsReview\s*=/.test(fs.readFileSync(new URL('rapid-import/functions/index.js', root), 'utf8')));
});

await test('the Decisions checkbox is wired to the module handler and current app version', () => {
  const html = fs.readFileSync(new URL('index.html', root), 'utf8');
  assert(/onchange="toggleDecisionsGate\(this.checked\)"/.test(html));
  assert(/window\.toggleDecisionsGate = toggleDecisionsGate;/.test(src));
  const version = /const APP_VERSION = 'v([^']+)';/.exec(src)[1];
  const urls = [...html.matchAll(/app\.js\?v=([^"']+)/g)].map(match => match[1]);
  assert(urls.length >= 2 && urls.every(value => value === version));
});
await test('the crop review runs BEFORE the "nothing usable" early return, so an uncuttable rectangle reaches the AI', () => {
  const f = src.slice(src.indexOf('async function _fillBlocksFromAiBoxes'));
  assert(f.indexOf('_decisionsGateFigures(') > 0 && f.indexOf('_decisionsGateFigures(') < f.indexOf('if (!crops.some(Boolean)) return 0;'));
});
await test('⚡ Rapid add: Decisions is advisory: a yes never skips the AI (DECISIONS_MAY_SKIP off) and the comparison is recorded; everything else goes to autoChkRun with Decisions\'s findings', () => {
  const s = src.slice(src.indexOf('async function processRapidJob'));
  const sk = s.indexOf('gate.confident'), run = s.indexOf('autoChkRun(q, {');
  assert(sk > 0 && run > sk, 'the skip must be conditional on gate.confident, with autoChkRun as the else');
  assert(/gate\.confident && DECISIONS_MAY_SKIP/.test(s), 'the skip is behind DECISIONS_MAY_SKIP');
  assert(/q\.decisionsShadow = /.test(s), 'the Decisions-vs-AI comparison is recorded');
  assert(/DECISIONS_MAY_SKIP = false/.test(core), 'advisory by default');
  assert(/extraFindings: gate \? gate\.findings/.test(s) && /figureFindings:/.test(s));
  assert(/if \(!filled\)/.test(src.slice(src.indexOf('async function processRapidJob'))), 'the whole-page backup is still there');
  assert(/\{ decisions: decisionsRun[,}]/.test(src), 'the question hands the crop review an out-parameter it reads at 2c');
});
await test('the AI check keeps carrying crop findings through every attempt but never asks a wording repair to fix them', () => {
  const r = src.slice(src.indexOf('async function autoChkRun'));
  assert(/o\.figureFindings/.test(r) && /!_autoChkIsCropFinding\(f\)/.test(r) && /autoChkRecrop\(q, cropF/.test(r), 'crop findings are re-cut from the original page; only the rest reaches the wording repair');
});
await test('a Decisions-cleared question is stamped honestly, not as an AI read', () => {
  assert(/if \(res\.decisions\) q\.autoCheck\.decisions = true;/.test(src));
  assert(/This saved result has no visual AI read/.test(src));
});
await test('the durable worker and the browser use the same retry budget', () => {
  assert(/DECISIONS_RECROP_TRIES = 2/.test(src) && /DECISIONS_RECROP_TRIES = 2/.test(fs.readFileSync(new URL('rapid-import/functions/index.js', root), 'utf8')));
});

console.log(`\n${failed ? '✗' : '✅'} ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
