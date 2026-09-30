// 🔧 Fix all — the background batch repair of every red/yellow vetting question.
// Runs the REAL repair controller and the REAL batch section out of app.js
// against deterministic AI / image / persistence fixtures. No account, no paid calls.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as repair from './question-repair-tests.mjs';
const { appSource, sampleQuestion, sampleFindings, samplePlan, harnessBody, settle } = repair;
import * as repairCore from '../question-repair-core.mjs';
import * as cropCore from '../question-crop-core.mjs';
const core = { ...repairCore, ...cropCore };

const start = appSource.indexOf('// ── Approved question repairs ──');
const mid = appSource.indexOf('// ── End approved question repairs ──', start);
const end = appSource.indexOf('// ── End fix all ──', mid);
assert.ok(start >= 0 && mid > start && end > mid, 'repair controller and fix-all section are present');
const section = appSource.slice(start, end);

function build(states, options = {}) {
  let body = harnessBody(section);
  // Per-question lights instead of one verdict for everything.
  body = body.replace('function tlStateOf(q){return {...H.verdict,sig:tlSig(q)};}',
    'function tlStateOf(q){const s=(H.states||{})[q && q.id];return s?{state:s.state,findings:s.findings||[],sig:tlSig(q)}:{state:"idle",findings:[],sig:tlSig(q)};}');
  body = body.replace('async function tlRun(q){H.checks.push(clone(q));H.verdict=H.recheckImpl?await H.recheckImpl(q):clone(H.recheckResult);return H.verdict;}',
    'async function tlRun(q){H.checks.push(clone(q));const r=H.recheckFor?await H.recheckFor(q):{state:"green",findings:[]};H.states[q.id]=r;return r;}');
  body = body.replace('return {H,document', `let _wkSuppress=0;
const QBULK=()=>H.vetting;
function qbulkUnlit(){return H.vetting;}
function qbulkRenderBar(){H.events.push(['bar']);}
function tlClick(){}
let confirmAnswer=true;
const confirm=()=>{H.events.push(['confirm']);return confirmAnswer;};
const setTimeout=(fn)=>{H.events.push(['timer']);return 1;};
const clearTimeout=()=>{};
const crypto={randomUUID(){return 'u'+(++H.seq);}};
return {vbrStart,vbrStop,vbrDismiss,vbrCandidates,vbrBusy,vbrBarHtml,vbrSummaryHtml,get vbr(){return _vbr;},get wk(){return _wkSuppress;},set confirm(v){confirmAnswer=v;},setSuppressProbe(fn){H.suppressProbe=fn;},H,document`);
  // The save stub records the suppression level at call time.
  body = body.replace("async function saveVettingQuestion(q,opts){if(opts?.guard && !opts.guard())return false;",
    "async function saveVettingQuestion(q,opts){H.suppressSeen=H.suppressSeen||[];H.suppressSeen.push(_wkSuppress);if(opts?.guard && !opts.guard())return false;");
  // _wkSuppress must exist before the save stub runs.
  body = 'let _wkSuppress=0;\n' + body.replace('let _wkSuppress=0;\nconst QBULK', 'const QBULK');
  const env = { question: sampleQuestion(), findings: sampleFindings(), plan: samplePlan(), ...options };
  env.states = states;
  const h = new Function('core', 'env', body)(core, env);
  return h;
}
const vq = (id, extra = {}) => ({ ...sampleQuestion(), id, status: 'pending', ...extra });
function setup(ids, options = {}) {
  const h = build({}, options);
  h.H.vetting.length = 0;
  h.H.states = {};
  for (const id of ids) {
    h.H.vetting.push(vq(id));
    h.vetOwners[id] = 'vetting-owner';
    h.H.states[id] = { state: 'red', findings: sampleFindings() };
  }
  h.user = { uid: 'teacher', role: 'admin' };
  return h;
}
async function run(h) { const p = h.vbrStart(); for (let i = 0; i < 80; i++) await settle(); await p; }

const cases = [];
const test = (name, fn) => cases.push({ name, run: fn });

test('only red and yellow vetting questions with findings are candidates', () => {
  const h = setup(['a', 'b', 'c', 'd', 'e']);
  h.H.states.b = { state: 'amber', findings: sampleFindings() };
  h.H.states.c = { state: 'green', findings: [] };
  h.H.states.d = { state: 'idle', findings: [] };
  h.H.states.e = { state: 'red', findings: [] };
  assert.deepEqual(h.vbrCandidates().map(q => q.id), ['a', 'b']);
});

test('every flagged question is planned, repaired, saved to vetting only, then re-checked', async () => {
  const h = setup(['a', 'b', 'c']);
  await run(h);
  assert.equal(h.H.ai.length, 3, 'one plan per question');
  assert.equal(h.H.saves.length, 3);
  assert.ok(h.H.saves.every(s => s.scope === 'vet'), 'never the bank');
  assert.equal(h.H.checks.length, 3, 'each repaired question is checked again');
  for (const save of h.H.saves) assert.equal(save.q.blocks[0].content, 'Two containers of water were placed on the balance.');
  for (const q of h.vetting) assert.ok(q.blocks[0].content.includes('were placed'), 'the list holds the repaired wording');
  assert.equal(h.vbr.running, false);
  assert.equal(h.vbr.fixed, 3);
  assert.equal(h.vbr.needsYou, 0);
});

test('a question is re-checked only after its own repair is saved, and is never repaired twice', async () => {
  const h = setup(['a']);
  h.H.recheckFor = async () => ({ state: 'amber', findings: sampleFindings() });
  await run(h);
  assert.equal(h.H.ai.length, 1, 'one fix pass only, even though it is still amber');
  assert.equal(h.H.saves.length, 1);
  assert.equal(h.H.checks.length, 1);
  assert.equal(h.vbr.stillBad, 1);
  assert.equal(h.vbr.items[0].outcome, 'still');
});

test('a failure on one question never stops the others and is listed as needing the teacher', async () => {
  const h = setup(['a', 'b', 'c']);
  let n = 0;
  h.H.aiImpl = async () => { if (++n === 2) throw new Error('model unavailable'); return structuredClone(samplePlan()); };
  await run(h);
  assert.equal(h.H.saves.length, 2);
  assert.equal(h.vbr.fixed, 2);
  assert.equal(h.vbr.needsYou, 1);
  const bad = h.vbr.items.find(i => i.outcome === 'failed');
  assert.ok(bad && /model unavailable/.test(bad.message));
  assert.ok(h.vbrSummaryHtml().includes('need'));
});

test('a plan with no safe actions is reported, not written', async () => {
  const h = setup(['a']);
  h.H.aiReply = { actions: [], notes: ['The intended answer is uncertain.'] };
  await run(h);
  assert.equal(h.H.saves.length, 0);
  assert.equal(h.vbr.items[0].outcome, 'needs');
  assert.match(h.vbr.items[0].message, /uncertain/);
});

test('a question open in the editor or its 🚦 panel is left alone', async () => {
  const h = setup(['a', 'b']);
  h.editing = 'a';
  await run(h);
  assert.equal(h.vbr.items.find(i => i.id === 'a').outcome, 'needs');
  assert.equal(h.vbr.items.find(i => i.id === 'b').outcome, 'fixed');
  assert.equal(h.H.saves.length, 1);
  assert.equal(h.H.saves[0].q.id, 'b');
});

test('a question edited while its repair was in flight is not overwritten', async () => {
  const h = setup(['a']);
  h.H.aiImpl = async () => { h.vetting[0].blocks[0].content = '<p>The teacher rewrote this.</p>'; return structuredClone(samplePlan()); };
  await run(h);
  assert.equal(h.H.saves.length, 0);
  assert.equal(h.vetting[0].blocks[0].content, '<p>The teacher rewrote this.</p>');
  assert.equal(h.vbr.items[0].outcome, 'failed');
});

test('a failed picture action is skipped and named while the wording fix still lands', async () => {
  const h = setup(['a'], { plan: samplePlan(true) });
  h.H.imageImpl = async () => { throw new Error('image service down'); };
  await run(h);
  assert.equal(h.H.saves.length, 1);
  assert.equal(h.H.saves[0].q.blocks[0].content, 'Two containers of water were placed on the balance.');
  assert.equal(h.H.saves[0].q.blocks[1].url, sampleQuestion().blocks[1].url, 'the original picture is kept');
  assert.equal(h.vbr.items[0].skipped, 1);
  assert.match(h.vbr.items[0].message, /1 action skipped/);
});

test('picture repairs that succeed are applied together with the wording', async () => {
  const h = setup(['a'], { plan: samplePlan(true) });
  await run(h);
  assert.equal(h.H.saves[0].q.blocks[1].url, 'https://fixtures.test/redrawn.png');
  assert.equal(h.H.saves[0].q.blocks[1].answerImg, sampleQuestion().blocks[1].answerImg);
});

test('the repair save is quiet only while the save call starts, and a declined confirm does nothing', async () => {
  const h = setup(['a', 'b']);
  await run(h);
  assert.deepEqual([...new Set(h.H.suppressSeen)], [1], 'work-session logging is suppressed during each save');
  assert.equal(h.wk, 0, 'and released afterwards');
  const d = setup(['a']);
  d.confirm = false;
  await run(d);
  assert.equal(d.H.ai.length, 0);
  assert.equal(d.vbr, null);
});

test('Stop halts further questions but keeps what is already fixed', async () => {
  const h = setup(['a', 'b', 'c', 'd', 'e', 'f']);
  let n = 0;
  h.H.aiImpl = async () => { if (++n === 1) h.vbrStop(); return structuredClone(samplePlan()); };
  await run(h);
  assert.ok(h.H.saves.length >= 1 && h.H.saves.length < 6);
  assert.ok(h.vbr.items.some(i => i.outcome === 'skipped' && /stopped/.test(i.message)));
  assert.equal(h.vbr.running, false);
});

test('a student account can never start it', async () => {
  const h = setup(['a']);
  h.user = { uid: 'student', role: 'student' };
  await run(h);
  assert.equal(h.H.ai.length, 0);
  assert.equal(h.vbr, null);
});

test('a second press while running is refused and the tab guard sees the running batch', async () => {
  const h = setup(['a']);
  let release;
  h.H.aiImpl = () => new Promise(r => { release = () => r(structuredClone(samplePlan())); });
  const p = h.vbrStart();
  await settle();
  assert.equal(h.vbrBusy(), true);
  await h.vbrStart();
  assert.equal(h.H.ai.length, 1, 'no second run started');
  release(); for (let i = 0; i < 80; i++) await settle(); await p;
  assert.equal(h.vbrBusy(), false);
});

// ── source-level guarantees the harness cannot exercise ──
test('the button is on the vetting tools bar only, and the tab guard and exports are wired', () => {
  assert.match(appSource, /\$\{w === 'vetting' \? vbrBarHtml\(unlit\) : ''\}/);
  assert.match(appSource, /w === 'vetting' \? vbrSummaryHtml\(\) : ''/);
  assert.match(appSource, /if \(vbrBusy\(\)\) return true;/);
  assert.match(appSource, /Object\.assign\(window, \{ vbrStart, vbrStop, vbrDismiss \}\)/);
});
test('the panel and the batch share ONE planner and ONE builder', () => {
  assert.match(appSource, /s\.plan = await tlRepairPlan\(s\);/);
  assert.match(appSource, /const result = await tlRepairBuildNext\(s, before\);/);
  assert.match(appSource, /await tlRepairBuildNext\(s, before, \{ tolerant: true \}\)/);
  const fix = appSource.slice(mid, end);
  assert.ok(!/saveQuestion\(/.test(fix), 'the batch never writes the question bank');
  assert.ok(!/askGemini/.test(fix), 'the batch has no prompt of its own');
  assert.ok(!/questionBank/.test(fix.replace(/never the bank/g, '')), 'the batch never touches the bank list');
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failed = 0;
  for (const item of cases) { try { await item.run(); console.log('PASS', item.name); } catch (error) { failed++; console.error('FAIL', item.name, error.stack); } }
  console.log(cases.length - failed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}
