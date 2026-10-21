// 🚨 Red light fixer — check the whole bank, list the reds, fix them in rounds.
// Run with:  node tools/red-light-fixer-tests.mjs
//
// Runs the REAL `rlf*` section (and the real 💲 cost meter it reads) out of
// app.js against an in-memory bank, a scripted checker and a scripted repair.
// No account, no network, no paid calls. What it holds in place:
//  • only the ADMIN's own, non-empty questions in the chosen scope are read,
//  • a verdict that stands is never paid for again, and a question the free
//    instant checks find red is listed without an AI call,
//  • every AI verdict is stamped on its question so the next launch is free,
//  • only reds are listed and fixed; anything amber or green leaves the list,
//  • the before-copy is written BEFORE the question, and a question whose
//    before-copy could not be written is never changed,
//  • ⏹ Stop and the 💲 budget both stop a run between questions,
//  • ↩ Undo restores only a question that is still exactly as the fix left it,
//  • pictures can be switched off, and an un-fixable row unticks itself.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as cost from '../ai-cost-core.mjs';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const from = src.indexOf('const AI_PRICE_STORE =');
const to = src.indexOf('// ── End red light fixer ──');
assert.ok(from > 0 && to > from, 'cost meter and fixer sections are present');
const section = src.slice(from, to);
const fixer = src.slice(src.indexOf('// 🚨 RED LIGHT FIXER'), to);

const clone = v => JSON.parse(JSON.stringify(v));
const settle = () => new Promise(r => setImmediate(r));

function mcq(id, extra = {}) {
  return { id, title: 'Question ' + id, topic: 'Heat', category: 'MCQ', qno: Number(String(id).replace(/\D/g, '')) || 1,
    blocks: [{ id: id + '_b1', type: 'text', content: 'Which material is the best conductor? ' + id }], ...extra };
}

// The world the section runs in. `browser` keeps the page's own document,
// window, storage and timers (tools/red-light-fixer-browser.mjs).
export function harnessState(opts = {}) {
  return {
    bank: (opts.bank || []).map(clone), vet: (opts.vet || []).map(clone),
    owners: Object.assign({}, opts.owners || {}),
    cache: new Map(), runs: [], plans: [], builds: [], saves: [], vsaves: [], history: [], histDocs: {}, batches: [],
    toasts: [], confirms: [], confirmAnswer: true, checkFor: opts.checkFor || (() => ({ verdict: 'green', findings: [] })),
    localFor: opts.localFor || (() => []), planFor: opts.planFor || (() => ({ actions: [{ id: 'a1', kind: 'replace_text', target: 'b', reason: 'reword the stem', value: 'x' }], notes: [] })),
    historyFails: opts.historyFails || false, saveFails: false, editing: null, panel: '', aiCostPerCheck: opts.aiCostPerCheck || 0, meterPush: null,
    store: {}, seq: 0,
  };
}
export function harnessSource({ browser = false } = {}) {
  return `
const { AI_DEFAULT_PRICES, AI_PRICES_AS_OF, AI_ROUTE_NAMES, mergePrices, priceFor, normalizeUsage, estimateUsage, costOf, createTally, tallyAdd, formatMoney, estimateCheckCost } = cost;
${browser ? 'window.__aiReady = () => true;' : `const localStorage = { getItem: k => H.store[k] ?? null, setItem: (k, v) => { H.store[k] = String(v); }, removeItem: k => { delete H.store[k]; } };
const window = { __aiReady: () => true };
const elements = {};
const document = { activeElement: null, getElementById: id => elements[id] || null, querySelectorAll: () => [], createElement: () => ({ querySelector: () => null }) };
const setTimeout = (fn) => { H.timers = (H.timers || 0) + 1; return 1; };
const clearTimeout = () => {};`}
let currentUser = { uid: 'teacher', role: 'admin' };
const auth = { currentUser: { uid: 'teacher' } };
let questionBank = H.bank, vettingList = H.vet;
let currentEditingQuestion = null, _tlPanelId = '';
let _wkSuppress = 0;
const _imgEnhanceState = {};
const _tlCache = H.cache;
const TL_PAR = 3, AI_MODEL = 'gemini-3.8-flash';
const db = {};
function _isAdmin() { return currentUser && currentUser.role === 'admin'; }
function _canAuthor() { return _isAdmin(); }
function _bankOwnerUid() { return 'teacher'; }
function _qOwner(id) { return H.owners[id] || 'teacher'; }
function _vOwner(id) { return H.owners[id] || 'teacher'; }
function _qRef(id) { return { path: 'users/' + _qOwner(id) + '/questions/' + id }; }
function _vRef(id) { return { path: 'users/' + _vOwner(id) + '/vetting/' + id }; }
function collection(_db, ...p) { return { path: p.join('/') }; }
function doc(a, ...p) { if (a && a.path && !p.length) return { path: a.path + '/h' + (++H.seq), id: 'h' + H.seq }; if (a && a.path) return { path: a.path + '/' + p.join('/'), id: p[p.length - 1] }; return { path: p.join('/'), id: p[p.length - 1] }; }
async function setDoc(ref, data, o) {
  if (/questionRepairs/.test(ref.path)) {
    if (H.historyFails) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
    H.history.push({ ref: ref.path, data: clone(data), merge: !!(o && o.merge), order: H.saves.length + H.vsaves.length });
    H.histDocs[ref.id] = Object.assign(H.histDocs[ref.id] || {}, clone(data));
    return;
  }
  if (ref.path.includes('/questions/') || ref.path.includes('/vetting/')) {
    if (H.ignoreFails) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
    (H.qwrites = H.qwrites || []).push({ ref: ref.path, data: clone(data), merge: !!(o && o.merge) });
    return;
  }
  throw new Error('unexpected setDoc ' + ref.path);
}
async function getDoc(ref) { const d = H.histDocs[ref.id]; return { exists: () => !!d, data: () => clone(d) }; }
async function getDocs() { return { docs: [] }; }
function query(...a) { return a; } function orderBy() {} function limit() {}
function writeBatch() { const ops = []; return { set: (ref, data, o) => ops.push({ ref: ref.path, data: clone(data), merge: !!(o && o.merge) }), commit: async () => { H.batches.push(ops); } }; }
function showToast(m, t) { H.toasts.push([m, t]); }
function confirm(m) { H.confirms.push(m); return H.confirmAnswer; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function qNoLabel(q) { return q && q.qno ? '#' + q.qno : ''; }
function aiEngineOrder() { return ['openai']; }
function getOpenAiModel() { return 'gpt-6.1-sol'; }
function getKimiModel() { return 'kimi-k3'; }
function tlSig(q) { return JSON.stringify({ t: q.title, p: q.topic, c: q.category, b: q.blocks }); }
function tlQuestionFor(scope, id) { return (scope === 'vet' ? vettingList : questionBank).find(q => q && String(q.id) === String(id)) || null; }
function tlStateOf(q) {
  if (!q) return { state: 'idle', findings: [] };
  const rec = _tlCache.get(String(q.id));
  const sig = tlSig(q);
  if (rec) {
    if (rec.sig !== sig) return { state: 'stale', findings: rec.findings || [] };
    if (rec.state === 'error') return { state: 'error', findings: rec.findings || [], error: rec.error };
    return { state: rec.verdict, findings: rec.findings || [] };
  }
  const a = q.autoCheck;
  if (a && a.sig === sig) return { state: a.state, findings: a.findings || [] };
  if (a) return { state: 'stale', findings: a.findings || [] };
  return { state: 'idle', findings: [] };
}
function _cqLocalFindings(q) { return H.localFor(q); }
function tlRepaint() {}
function tlLightHtml(q) { return '<b class="lamp"></b>'; }
function tlClick() {}
async function tlRun(q) {
  if (!(q.blocks || []).length) return null;
  H.runs.push(q.id);
  if (H.aiCostPerCheck && typeof _aiMeterText === 'function') _aiMeterText('openaiKey', 'gpt-6.1-sol', 'openai', { prompt_tokens: H.aiCostPerCheck, completion_tokens: 0 }, '', [], '', false);
  await new Promise(r => (typeof setImmediate === 'function' ? setImmediate(r) : globalThis.setTimeout(r, 5)));
  const r = H.checkFor(q);
  const rec = r.error
    ? { sig: tlSig(q), state: 'error', findings: [], verdict: '', error: r.error, at: 1 }
    : { sig: tlSig(q), state: 'done', findings: r.findings || [], verdict: r.verdict, error: '', at: 1 };
  _tlCache.set(String(q.id), rec);
  return rec;
}
function autoChkStamp(q, res) { q.autoCheck = { state: res.state, findings: clone(res.findings || []), sig: tlSig(q), tries: res.tries || 1 }; }
function tlRepairClone(v) { return JSON.parse(JSON.stringify(v)); }
function tlRepairRead(scope, id) { const q = tlQuestionFor(scope, id); return q ? clone(q) : null; }
function tlRepairCurrent(s) { const q = tlRepairRead(s.scope === 'bank' ? 'bank' : 'vet', s.id); return !!q && JSON.stringify(q) === s.signature; }
async function tlRepairPlan(s) { H.plans.push(s.id); await Promise.resolve(); return clone(H.planFor(s)); }
function normalizeQuestionRepairPlan(plan) { return { actions: (plan.actions || []).map((a, i) => ({ id: 'a' + (i + 1), ...a })), notes: plan.notes || [] }; }
async function tlRepairBuildNext(s, before) {
  H.builds.push({ id: s.id, actions: s.plan.actions.map(a => a.kind) });
  const q = clone(before);
  q.blocks[0].content = 'Fixed: ' + q.blocks[0].content;
  return { question: q, changedTargets: ['b'], skipped: [] };
}
async function saveQuestion(q, o) { if (o && o.guard && !o.guard()) return false; H.saves.push({ q: clone(q), wk: _wkSuppress, histBefore: H.history.length }); return !H.saveFails; }
async function saveVettingQuestion(q, o) { if (o && o.guard && !o.guard()) return false; H.vsaves.push({ q: clone(q), wk: _wkSuppress, histBefore: H.history.length }); return !H.saveFails; }
function tableDataToFirestore(d) { return Object.fromEntries(d.map((r, i) => [String(i), r])); }
function normalizeLoadedQuestion(q) { return q; }
function renderQuestionBank() {} function renderVettingList() {} function updateCounts() {}
function deleteField() { return { __del: true }; }
async function deleteQuestionDocAwait(id) { (H.deleted = H.deleted || []).push(id); return !H.deleteFails; }
async function deleteVettingDocAwait(id) { (H.deleted = H.deleted || []).push(id); return !H.deleteFails; }
function previewOneQuestionPrint() {} function buildWorksheetHtml() { return '<p></p>'; } function _wsWritePreview() {}
function _wnyCachedNotes() { return {}; } function wnyPrintOn() { return false; } function akxPrintOn() { return false; } function objBoxPrintOn() { return false; }
` + section + `
return { rlfLaunch, rlfFix, rlfStop, rlfUndo, rlfUndoRound, rlfLoad, rlfPreview, rlfFreeVerdict, rlfOwnedQuestions, rlfFlushStamps, rlfSetBudget, rlfToggle,
  rlfCanonical, rlfBusy, rlfRecost, rlfIgnore, rlfUnignore, rlfDelete, rlfPin, rlfUnpin, rlfIsPinned, rlfIgnoredQuestions, rlfFixCandidates, rlfRefreshItems, aiMeterOpen, _aiMeterText, aiPriceSaveOverrides,
  get rlf() { return _rlf; }, set rlf(v) { _rlf = v; },
  rlfPaint, rlfPaintCost, aiPriceDialogOpen, renderRedLightsPage,
  setEditing(id) { currentEditingQuestion = id; }, setUser(u) { currentUser = u; } };`;
}
export { mcq, section };
function build(opts = {}) {
  const H = harnessState(opts);
  const api = new Function('cost', 'H', 'clone', harnessSource())(cost, H, clone);
  return { api, H };
}
const high = t => ({ severity: 'high', title: t, ai: true });
const med = t => ({ severity: 'med', title: t, ai: true });

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('only the admin\'s own non-empty questions in the chosen scope are candidates', () => {
  const { api } = build({ bank: [mcq('q1'), mcq('q2', { topic: 'Matter' }), mcq('q3', { blocks: [] }), mcq('q4')], vet: [mcq('v1')], owners: { q4: 'other-admin' } });
  api.rlfLoad();
  assert.deepEqual(api.rlfOwnedQuestions({ bank: true, vet: false, topic: '' }).map(x => x.q.id), ['q1', 'q2']);
  assert.deepEqual(api.rlfOwnedQuestions({ bank: true, vet: true, topic: 'Heat' }).map(x => x.q.id), ['q1', 'v1']);
  assert.deepEqual(api.rlfOwnedQuestions({ bank: false, vet: true, topic: '' }).map(x => x.where), ['vet']);
});

test('a standing verdict is reused, an instant red is free, everything else needs the AI', () => {
  const { api, H } = build({ bank: [mcq('q1'), mcq('q2'), mcq('q3')], localFor: q => q.id === 'q2' ? [high('No correct option is marked')] : [] });
  api.rlfLoad();
  const q1 = H.bank[0];
  H.cache.set('q1', { sig: JSON.stringify({ t: q1.title, p: q1.topic, c: q1.category, b: q1.blocks }), state: 'done', verdict: 'green', findings: [] });
  assert.equal(api.rlfFreeVerdict(H.bank[0]).how, 'reused');
  assert.equal(api.rlfFreeVerdict(H.bank[1]).how, 'instant');
  assert.equal(api.rlfFreeVerdict(H.bank[1]).state, 'red');
  assert.equal(api.rlfFreeVerdict(H.bank[2]), null);
  assert.deepEqual(api.rlfPreview({ bank: true }), { total: 3, reused: 1, instant: 1, needAi: 1, red: 1 });
});

test('launch: only unknown questions are read by the AI, only reds are listed, and verdicts are stamped', async () => {
  const { api, H } = build({
    bank: [mcq('q1'), mcq('q2'), mcq('q3'), mcq('q4')],
    localFor: q => q.id === 'q2' ? [high('The model answer is blank')] : [],
    checkFor: q => q.id === 'q3' ? { verdict: 'red', findings: [high('Wrong option marked')] } : q.id === 'q4' ? { verdict: 'amber', findings: [med('Wording')] } : { verdict: 'green', findings: [] },
  });
  api.rlfLoad();
  await api.rlfLaunch();
  assert.deepEqual(H.runs.sort(), ['q1', 'q3', 'q4'], 'the instant red is not sent to the AI');
  assert.deepEqual(api.rlf.items.map(i => i.id).sort(), ['q2', 'q3']);
  assert.ok(api.rlf.items.every(i => i.include && i.status === 'red'));
  const stamped = H.batches.flat();
  assert.deepEqual(stamped.map(s => s.ref).sort(), ['users/teacher/questions/q1', 'users/teacher/questions/q3', 'users/teacher/questions/q4']);
  assert.ok(stamped.every(s => s.merge && Object.keys(s.data).join() === 'autoCheck'), 'one field, merged — nothing else on the document is touched');
  assert.equal(api.rlf.check.ai, 3);
  assert.equal(api.rlf.check.instant, 1);
  assert.match(H.confirms[0], /1 are red on the instant checks — free/);
});

test('a second launch pays for nothing that has not changed', async () => {
  const { api, H } = build({ bank: [mcq('q1'), mcq('q2')], checkFor: q => q.id === 'q1' ? { verdict: 'red', findings: [high('x')] } : { verdict: 'green', findings: [] } });
  api.rlfLoad();
  await api.rlfLaunch();
  const first = H.runs.length;
  H.cache.clear();   // a new tab: only the stamps on the questions remain
  await api.rlfLaunch();
  assert.equal(H.runs.length, first, 'no AI call the second time');
  assert.equal(H.confirms.length, 1, 'and no spending confirm, because nothing will be spent');
  assert.deepEqual(api.rlf.items.map(i => i.id), ['q1']);
  H.bank[1].blocks[0].content = 'edited';
  await api.rlfLaunch();
  assert.deepEqual(H.runs.slice(first), ['q2'], 'only the edited question is read again');
});

test('a failed check is listed under errors, never as green and never as red', async () => {
  const { api } = build({ bank: [mcq('q1'), mcq('q2')], checkFor: q => q.id === 'q1' ? { error: 'ChatGPT API error 429' } : { verdict: 'green', findings: [] } });
  api.rlfLoad();
  await api.rlfLaunch();
  assert.equal(api.rlf.items.length, 0);
  assert.deepEqual(api.rlf.errors.map(e => e.id), ['q1']);
  assert.match(api.rlf.errors[0].error, /429/);
});

test('declining the confirm spends nothing', async () => {
  const { api, H } = build({ bank: [mcq('q1')] });
  H.confirmAnswer = false;
  api.rlfLoad();
  await api.rlfLaunch();
  assert.equal(H.runs.length, 0);
  assert.equal(api.rlf.stage, 'idle');
});

test('⏹ Stop ends the check between questions and keeps what was found', async () => {
  const bank = Array.from({ length: 30 }, (_, i) => mcq('q' + (i + 1)));
  const { api, H } = build({ bank, checkFor: () => ({ verdict: 'red', findings: [high('x')] }) });
  api.rlfLoad();
  const p = api.rlfLaunch();
  await settle(); await settle();
  api.rlfStop();
  await p;
  assert.ok(H.runs.length < 30, 'stopped early: ' + H.runs.length);
  assert.equal(api.rlf.items.length, H.runs.length, 'every question already read is listed');
  assert.equal(api.rlf.stage, 'idle');
});

test('the 💲 budget stops the run by itself once it is reached', async () => {
  const bank = Array.from({ length: 40 }, (_, i) => mcq('q' + (i + 1)));
  // 100k input tokens of GPT-6.1 Sol = $0.20 a check; a $1 budget allows ~5.
  const { api, H } = build({ bank, aiCostPerCheck: 100000 });
  api.rlfLoad();
  api.rlfSetBudget('1');
  await api.rlfLaunch();
  assert.ok(H.runs.length >= 5 && H.runs.length <= 5 + 3, 'stopped near the budget: ' + H.runs.length);
  assert.equal(api.rlf.stopReason, 'budget');
  assert.ok(api.rlf.tally.usd >= 1 && api.rlf.tally.usd < 1.7, 'spent ' + api.rlf.tally.usd);
  assert.ok(H.toasts.some(t => /Budget/.test(t[0])));
});

test('the meter records what each call cost and survives a price change', async () => {
  const { api, H } = build({ bank: [mcq('q1'), mcq('q2')], aiCostPerCheck: 1000000 });
  api.rlfLoad();
  await api.rlfLaunch();
  assert.equal(api.rlf.tally.calls, 2);
  assert.ok(Math.abs(api.rlf.tally.usd - 4) < 1e-9, '2 × 1M tokens × $2');
  // ⚙ Prices: the totals are worked out again from the calls already made.
  api.aiPriceSaveOverrides({ 'gpt-6.1-sol': { in: 1 } });
  api.rlfRecost();
  assert.ok(Math.abs(api.rlf.tally.usd - 2) < 1e-9, 'repriced to 2 × 1M × $1: ' + api.rlf.tally.usd);
  assert.ok(Object.keys(H.store).some(k => k.startsWith('sq_rlf_spent:')), 'lifetime spend kept in this browser');
});

test('fix: plan → before-copy → save → re-check; amber and green leave the list, red stays', async () => {
  const state = { q1: 'red', q2: 'red', q3: 'red' };
  const { api, H } = build({
    bank: [mcq('q1'), mcq('q2'), mcq('q3')],
    checkFor: q => {
      const fixed = /^Fixed:/.test(q.blocks[0].content);
      if (!fixed) return { verdict: state[q.id], findings: [high('Wrong option marked')] };
      return q.id === 'q1' ? { verdict: 'green', findings: [] } : q.id === 'q2' ? { verdict: 'amber', findings: [med('Wording')] } : { verdict: 'red', findings: [high('Still wrong')] };
    },
  });
  api.rlfLoad();
  await api.rlfLaunch();
  assert.equal(api.rlf.items.length, 3);
  await api.rlfFix();
  assert.deepEqual(H.plans.sort(), ['q1', 'q2', 'q3']);
  assert.equal(H.saves.length, 3);
  assert.ok(H.saves.every(s => s.histBefore >= 1), 'the before-copy is written first');
  assert.ok(H.saves.every(s => s.wk === 1), 'saved quietly — not a work-session entry');
  assert.equal(H.history.length, 3);
  assert.ok(H.history.every(h => /^users\/teacher\/questionRepairs\//.test(h.ref)));
  assert.ok(H.history.every(h => !/^Fixed:/.test(h.data.before.blocks[0].content)), 'the history holds the question as it WAS');
  assert.deepEqual(api.rlf.items.map(i => i.id), ['q3'], 'the list shrank to the one still red');
  assert.equal(api.rlf.items[0].rounds, 1);
  assert.match(api.rlf.items[0].message, /still finds it red/);
  assert.equal(api.rlf.fixed.filter(f => !f.listed).length, 2);
  assert.match(H.confirms[1], /LIVE bank questions/);
  // round 2 is a press, and only the red one is planned again
  await api.rlfFix();
  assert.equal(H.plans.filter(id => id === 'q3').length, 2);
  assert.equal(H.plans.length, 4);
  assert.equal(api.rlf.round, 2);
});

test('a before-copy that cannot be written leaves the question untouched', async () => {
  const { api, H } = build({ bank: [mcq('q1')], checkFor: () => ({ verdict: 'red', findings: [high('x')] }), historyFails: true });
  api.rlfLoad();
  await api.rlfLaunch();
  await api.rlfFix();
  assert.equal(H.saves.length, 0, 'never saved');
  assert.equal(H.bank[0].blocks[0].content.startsWith('Fixed'), false);
  assert.equal(api.rlf.items.length, 1);
  assert.match(api.rlf.items[0].message, /undo copy could not be saved/);
});

test('no safe fix twice unticks the row; pictures can be switched off', async () => {
  const { api, H } = build({
    bank: [mcq('q1'), mcq('q2')],
    checkFor: q => /^Fixed/.test(q.blocks[0].content) ? { verdict: 'green', findings: [] } : { verdict: 'red', findings: [high('x')] },
    planFor: s => s.id === 'q1' ? { actions: [], notes: ['the science is uncertain'] }
      : { actions: [{ kind: 'redraw_image', target: 'img', reason: 'redraw the beam', instruction: 'x' }, { kind: 'replace_text', target: 'b', reason: 'reword', value: 'y' }], notes: [] },
  });
  api.rlfLoad();
  await api.rlfLaunch();
  api.rlf.pictures = false;
  await api.rlfFix();
  const q1 = api.rlf.items.find(i => i.id === 'q1');
  assert.equal(q1.noFix, 1);
  assert.equal(q1.include, true);
  assert.deepEqual(H.builds.map(b => b.actions), [['replace_text']], 'the picture action was left out');
  await api.rlfFix();
  assert.equal(q1.noFix, 2);
  assert.equal(q1.include, false, 'unticked after two rounds with no fix');
  assert.match(q1.message, /unticked/);
  H.plans.length = 0;
  await api.rlfFix();
  assert.equal(H.plans.length, 0, 'an unticked row is not paid for');
});

test('a question open in the editor, or another account\'s, is left alone', async () => {
  const { api, H } = build({ bank: [mcq('q1'), mcq('q2')], checkFor: () => ({ verdict: 'red', findings: [high('x')] }) });
  api.rlfLoad();
  await api.rlfLaunch();
  api.setEditing('q1');
  H.owners.q2 = 'someone-else';
  await api.rlfFix();
  assert.equal(H.plans.length, 0);
  assert.match(api.rlf.items.find(i => i.id === 'q1').message, /editor/);
  assert.match(api.rlf.items.find(i => i.id === 'q2').message, /another account/);
  assert.equal(api.rlf.items.find(i => i.id === 'q1').rounds, 0, 'a skipped row has not used up a round');
});

test('vetting questions are fixed on the vetting card, tables stored the Firestore way', async () => {
  const v = mcq('v1');
  v.blocks.push({ id: 't1', type: 'table', data: [['a', 'b'], ['c', 'd']], colWidths: [40, null] });
  const { api, H } = build({ vet: [v], checkFor: q => /^Fixed/.test(q.blocks[0].content) ? { verdict: 'green', findings: [] } : { verdict: 'red', findings: [high('x')] } });
  api.rlfLoad();
  api.rlf.scope = { bank: false, vet: true, topic: '' };
  await api.rlfLaunch();
  await api.rlfFix();
  assert.equal(H.saves.length, 0, 'never the bank');
  assert.equal(H.vsaves.length, 1);
  assert.ok(!Array.isArray(H.vsaves[0].q.blocks[1].data), 'table rows stored as a map');
  assert.ok(!Array.isArray(H.history[0].data.before.blocks[1].data), 'and in the before-copy too');
  assert.deepEqual(H.vsaves[0].q.blocks[1].colWidths, { 0: 40 });
});

test('↩ Undo restores the before-copy, and refuses once the question was edited since', async () => {
  const { api, H } = build({ bank: [mcq('q1'), mcq('q2')], checkFor: q => /^Fixed/.test(q.blocks[0].content) ? { verdict: 'green', findings: [] } : { verdict: 'red', findings: [high('x')] } });
  api.rlfLoad();
  await api.rlfLaunch();
  await api.rlfFix();
  assert.equal(api.rlf.items.length, 0);
  const i1 = api.rlf.fixed.findIndex(f => f.id === 'q1');
  const i2 = api.rlf.fixed.findIndex(f => f.id === 'q2');
  H.bank.find(q => q.id === 'q2').blocks[0].content = 'the teacher edited this';
  const savesBefore = H.saves.length;
  await api.rlfUndo(i2);
  assert.equal(H.saves.length, savesBefore, 'an edited question is never overwritten');
  assert.ok(H.toasts.some(t => /edited since/.test(t[0])));
  await api.rlfUndo(i1);
  const restored = H.saves[H.saves.length - 1].q;
  assert.equal(restored.blocks[0].content.startsWith('Fixed'), false, 'the old wording is back');
  assert.equal(api.rlf.fixed[i1].undone, true);
  assert.ok(H.history.some(h => h.merge && h.data.undone === true), 'the history entry is marked undone');
  assert.deepEqual(api.rlf.items.map(i => i.id), ['q1'], 'and it is back on the red list');
});

test('a repaired question is kept with its keys sorted, as Firestore will return it', () => {
  const { api } = build({});
  const c = api.rlfCanonical({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 3 } });
  assert.equal(JSON.stringify(c), '{"a":{"c":3,"d":[{"y":2,"z":1}]},"b":1}');
});

test('the list survives a reload', async () => {
  const { api, H } = build({ bank: [mcq('q1')], checkFor: () => ({ verdict: 'red', findings: [high('x')] }) });
  api.rlfLoad();
  await api.rlfLaunch();
  const saved = Object.keys(H.store).find(k => k.startsWith('sq_rlf:'));
  assert.ok(saved, 'the list is saved per account');
  api.rlf = null;
  api.rlfLoad();
  assert.deepEqual(api.rlf.items.map(i => i.id), ['q1']);
  assert.equal(api.rlf.tally.calls, 0, 'no meter records in this harness');
});

test('only an admin can launch or fix', async () => {
  const { api, H } = build({ bank: [mcq('q1')] });
  api.rlfLoad();
  api.setUser({ uid: 'teacher', role: 'employee' });
  await api.rlfLaunch();
  await api.rlfFix();
  assert.equal(H.runs.length, 0);
  assert.ok(H.toasts.every(t => /admin/.test(t[0])));
});

// ── Pin, ignore, delete ─────────────────────────────────────────────────────
test('an ignored question is never a candidate and is listed apart', () => {
  const { api } = build({ bank: [mcq('q1', { redLightIgnore: { at: 1, by: 'teacher' } }), mcq('q2')], vet: [mcq('v1', { redLightIgnore: { at: 1 } })] });
  api.rlfLoad();
  assert.deepEqual(api.rlfOwnedQuestions({ bank: true, vet: true, topic: '' }).map(x => x.q.id), ['q2']);
  assert.deepEqual(api.rlfIgnoredQuestions().map(x => x.q.id).sort(), ['q1', 'v1']);
});
const redsOnLaunch = () => build({ bank: [mcq('q1'), mcq('q2')], checkFor: () => ({ verdict: 'red', findings: [high('Wrong option marked')] }) });
test('ignore writes ONE merged field, drops the red, and un-ignore deletes the field', async () => {
  const { api, H } = redsOnLaunch();
  api.rlfLoad(); H.confirmAnswer = true;
  await api.rlfLaunch();
  assert.deepEqual(api.rlf.items.map(i => i.id).sort(), ['q1', 'q2']);
  api.rlfPin('bank', 'q1');
  await api.rlfIgnore('bank', 'q1');
  const w = H.qwrites[0];
  assert.equal(w.ref, 'users/teacher/questions/q1');
  assert.ok(w.merge);
  assert.deepEqual(Object.keys(w.data), ['redLightIgnore']);
  assert.ok(H.bank[0].redLightIgnore);
  assert.deepEqual(api.rlf.items.map(i => i.id), ['q2']);
  assert.ok(!api.rlfIsPinned('bank', 'q1'), 'ignoring the pinned question unpins it');
  assert.ok(!api.rlfOwnedQuestions({ bank: true, vet: false, topic: '' }).some(x => x.q.id === 'q1'));
  await api.rlfUnignore('bank', 'q1');
  assert.deepEqual(H.qwrites[1].data, { redLightIgnore: { __del: true } });
  assert.ok(!('redLightIgnore' in H.bank[0]));
});
test('an ignore the database refused is rolled back and the red stays', async () => {
  const { api, H } = redsOnLaunch();
  api.rlfLoad(); H.confirmAnswer = true;
  await api.rlfLaunch();
  H.ignoreFails = true;
  await api.rlfIgnore('bank', 'q1');
  assert.ok(!('redLightIgnore' in H.bank[0]));
  assert.ok(api.rlf.items.some(i => i.id === 'q1'));
  assert.ok(H.toasts.some(t => t[1] === 'error' && /permission-denied/.test(t[0])));
});
test('only the admin can ignore', async () => {
  const { api, H } = redsOnLaunch();
  api.rlfLoad();
  api.setUser({ uid: 'teacher', role: 'employee' });
  await api.rlfIgnore('bank', 'q1');
  assert.ok(!H.qwrites);
  assert.ok(!H.bank[0].redLightIgnore);
});
test('the pin survives a reload, and deleting the pinned question unpins it', async () => {
  const { api, H } = redsOnLaunch();
  api.rlfLoad(); H.confirmAnswer = true;
  await api.rlfLaunch();
  api.rlfPin('bank', 'q2');
  api.rlf = null; api.rlfLoad();
  assert.ok(api.rlfIsPinned('bank', 'q2'));
  H.confirms.length = 0;
  await api.rlfDelete('bank', 'q2');
  assert.match(H.confirms[0], /PERMANENT/);
  assert.deepEqual(H.deleted, ['q2']);
  assert.deepEqual(H.bank.map(q => q.id), ['q1']);
  assert.deepEqual(api.rlf.items.map(i => i.id), ['q1']);
  assert.ok(!api.rlfIsPinned('bank', 'q2'));
});
test('a delete that is cancelled or refused removes nothing', async () => {
  const { api, H } = redsOnLaunch();
  api.rlfLoad(); H.confirmAnswer = true;
  await api.rlfLaunch();
  H.confirmAnswer = false;
  await api.rlfDelete('bank', 'q1');
  assert.ok(!H.deleted);
  H.confirmAnswer = true; H.deleteFails = true;
  await api.rlfDelete('bank', 'q1');
  assert.deepEqual(H.deleted, ['q1']);
  assert.equal(H.bank.length, 2, 'not spliced when the database refused');
  assert.ok(api.rlf.items.some(i => i.id === 'q1'));
});
test('ignore, delete and pin are wired, and ignore is not an editor-owned field', () => {
  for (const fn of ['rlfPin', 'rlfUnpin', 'rlfPinFull', 'rlfIgnore', 'rlfUnignore', 'rlfDelete']) {
    assert.match(src, new RegExp('Object\\.assign\\(window, \\{[^}]*\\b' + fn + '\\b'), fn + ' is on window');
  }
  assert.match(html, /id="rlfPin"/);
  const owned = src.match(/const EDITOR_OWNED_QUESTION_FIELDS = new Set\(\[([^\]]*)\]/);
  assert.ok(owned, 'found the editor-owned list');
  assert.ok(!/redLightIgnore/.test(owned[1]), 'an edit must keep an ignore');
  const vbr = src.slice(src.indexOf('function vbrCandidates('), src.indexOf('function vbrCandidates(') + 1500);
  assert.match(vbr, /redLightIgnore/, 'Fix all skips an ignored question too');
});

// ── Wiring ──────────────────────────────────────────────────────────────────
test('it is the SAME checker and the SAME repair: no prompt lives in the fixer', () => {
  assert.ok(!/askGemini|askChatGpt|askKimi\(|_aiAsk\(/.test(fixer), 'no direct model call');
  for (const fn of ['tlRun(', 'tlRepairPlan(', 'tlRepairBuildNext(', 'tlRepairCurrent(']) assert.ok(fixer.includes(fn), 'uses ' + fn);
});
test('the headless repair guard reads the bank for a bank fix and the vetting list otherwise', () => {
  const guard = src.slice(src.indexOf('function tlRepairCurrent('), src.indexOf('function tlRepairReset('));
  assert.match(guard, /const scope = s\.scope === 'bank' \? 'bank' : 'vet';/);
  assert.match(guard, /tlRepairRead\(scope, s\.id\)/);
  assert.match(guard, /scope === 'bank' \? _qOwner\(s\.id\) : _vOwner\(s\.id\)/);
});
test('the page is admin-only on every route in', () => {
  assert.match(html, /class="nav-item admin-only" data-page="redlights"/);
  assert.match(html, /<div class="page" id="page-redlights">/);
  assert.match(html, /id="rlfCost"/);
  assert.match(html, /id="aiPriceOverlay"/);
  assert.match(src, /if \(page === 'redlights' && !_isAdmin\(\)\) page = rpgHomePage\(\);/);
  assert.match(src, /if \(page === 'redlights'\) renderRedLightsPage\(\);/);
  const emp = src.match(/const EMPLOYEE_PAGES = \[([^\]]*)\]/)[1];
  assert.ok(!/redlights/.test(emp), 'not an employee page');
});
test('the tab guard knows about a run, and the buttons are exported', () => {
  const guard = src.slice(src.indexOf('function _xtWorkInFlight('), src.indexOf('function _xtGuardUnload('));
  assert.match(guard, /rlfBusy\(\)/);
  for (const fn of ['rlfLaunch', 'rlfFix', 'rlfStop', 'rlfUndo', 'rlfUndoRound', 'rlfHistoryLoad', 'renderRedLightsPage', 'aiPriceDialogOpen', 'aiPriceDialogSave']) {
    assert.match(src, new RegExp('Object\\.assign\\(window, \\{[^}]*\\b' + fn + '\\b'), fn + ' is on window');
  }
});
test('the cost bar is sticky and the layout works at phone width', () => {
  assert.match(html, /\.rlf-cost \{\s*position: sticky;/);
  assert.match(html, /@media \(max-width: 640px\) \{\s*\.rlf-cost/);
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
let failed = 0;
for (const c of cases) {
  try { await c.fn(); console.log('  ✓ ' + c.name); }
  catch (e) { failed++; console.log('  ✗ ' + c.name + '\n    ' + ((e && e.stack) || e)); }
}
console.log(`\n${cases.length - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
}
