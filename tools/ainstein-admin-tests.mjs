import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createAinsteinAdminAgent, AINSTEIN_ADMIN_LIMITS, AINSTEIN_ADMIN_CAPABILITIES } from '../ainstein-admin-agent.js';

const BANK = [
  { id: 'spring-1', title: 'Compressing springs', text: 'Compare the force exerted by compressed spring X and spring Y.', level: 'P6', formats: ['written'], inSyllabus: true },
  { id: 'spring-2', title: 'Elastic spring energy', text: 'A compressed spring pushes a ball. Which spring exerts the greatest force?', level: 'P6', formats: ['mcq'], inSyllabus: true },
  { id: 'heat-1', title: 'Ice melting', text: 'The ice gains heat from the surroundings and melts.', level: 'P4', formats: ['mcq'], inSyllabus: true },
  { id: 'retired-1', title: 'Cell Systems', text: 'Compare force exerted by spring X and cell systems.', level: 'P6', formats: ['written'], inSyllabus: false }
];
function harness(plan = { action: 'search', query: 'compressed spring force', count: 5 }) {
  const calls = [], operations = [], statuses = [];
  const session = {};
  const state = { who: { uid: 'admin1', allowed: true, session }, bank: structuredClone(BANK), plan,
    rank: null, specialistError: false, rankError: false };
  const adapter = {
    getIdentity: () => state.who, getBank: () => state.bank,
    getContext: () => ({ page: 'bank', worksheetSelectionCount: 2 }),
    ask: async (prompt, options) => {
      calls.push({ prompt, options });
      if (prompt.startsWith('Plan one')) return state.plan;
      if (prompt.startsWith('Science concept') || prompt.startsWith('Question structure')) {
        if (state.specialistError) throw new Error('specialist offline');
        return { phrases: ['compressed spring force'] };
      }
      if (state.rankError) throw new Error('ranker offline');
      return { results: state.rank || [{ id: 'spring-1', score: 95 }, { id: 'spring-2', score: 90 }, { id: 'retired-1', score: 70 }] };
    },
    navigate: async (payload, ctx) => { ctx.check(); operations.push({ name: 'navigate', payload }); return { summary: payload.destination + ' opened.' }; },
    showResults: async (payload, ctx) => { ctx.check(); operations.push({ name: 'showResults', payload }); return { summary: 'Opened actual search results.' }; },
    prepareWorksheet: async (payload, ctx) => { ctx.check(); operations.push({ name: 'prepareWorksheet', payload }); return { summary: 'Prepared a separate unsaved worksheet draft.' }; },
    previewQuestion: async (payload, ctx) => { ctx.check(); operations.push({ name: 'previewQuestion', payload }); return { summary: 'Opened question ' + payload.id }; },
    saveWorksheet: async (payload, ctx) => { ctx.check(); operations.push({ name: 'saveWorksheet', payload }); return { id: payload.saveKey, summary: 'Saved in My Worksheets.' }; }
  };
  const agent = createAinsteinAdminAgent(adapter);
  return { agent, adapter, state, calls, operations, statuses,
    run: (text, options = {}) => agent.runAdminTask(text, { onStatus: s => statuses.push(s), ...options }) };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('Capabilities are an explicit extensible registry with no arbitrary execution', () => {
  assert.deepEqual(AINSTEIN_ADMIN_CAPABILITIES.map(c => c.action), ['navigate', 'search', 'worksheet', 'preview', 'save_worksheet']);
  assert.equal(AINSTEIN_ADMIN_LIMITS.calls, 4);
  assert.equal(AINSTEIN_ADMIN_LIMITS.results, 30);
});

for (const [request, destination] of [['open Rapid Add', 'rapid_add'], ['Please go to the question bank', 'bank'],
  ['open worksheet builder', 'worksheet'], ['show me My Worksheets', 'myworksheets'], ['enter vetting', 'vetting']]) {
  test(`Simple navigation is deterministic with no AI: ${request}`, async () => {
    const h = harness(); const out = await h.run(request);
    assert.equal(h.calls.length, 0); assert.equal(out.action, 'navigate');
    assert.equal(h.operations[0].payload.destination, destination);
  });
}

test('Actual specialist calls run concurrently and influence real-bank retrieval within four calls', async () => {
  const h = harness(); const gates = [deferred(), deferred()]; let active = 0, peak = 0, next = 0;
  const original = h.adapter.ask;
  h.adapter.ask = async (prompt, options) => {
    if (/^(Science concept|Question structure)/.test(prompt)) {
      h.calls.push({ prompt, options }); active++; peak = Math.max(peak, active);
      const value = await gates[next++].promise; active--; return value;
    }
    return original(prompt, options);
  };
  const job = h.run('Find questions involving compressed springs.'); await flush();
  assert.equal(peak, 2); gates.forEach(g => g.resolve({ phrases: ['elastic spring'] }));
  const out = await job;
  assert.equal(h.calls.length, 4); assert.equal(out.calls, 4);
  assert.deepEqual(out.ids, ['spring-1', 'spring-2', 'retired-1']);
  assert.equal(h.operations[0].name, 'showResults');
  assert(h.calls[3].prompt.includes('spring-1'));
  assert(!h.calls[3].prompt.includes('"id":"heat-1"'), 'Unrelated local candidates are excluded');
});

test('Search specialists can retrieve a synonym absent from the original phrase', async () => {
  const h = harness({ action: 'search', query: 'restoring push', count: 2 });
  const original = h.adapter.ask;
  h.adapter.ask = (prompt, options) => /^(Science concept|Question structure)/.test(prompt)
    ? (h.calls.push({ prompt, options }), Promise.resolve({ phrases: ['compressed spring'] })) : original(prompt, options);
  const out = await h.run('Find restoring push questions');
  assert(out.ids.includes('spring-1')); assert.equal(h.calls.length, 4);
});

test('Relevance review sees requested details in later question parts without a larger context budget', async () => {
  const h = harness({ action: 'search', query: 'magnetic shield experiment', count: 1 });
  h.state.bank = [{ id: 'late-experiment', title: 'A long paper question',
    text: 'Read the shared setup and answer each part. ' + 'The apparatus is set up as shown in the diagram. '.repeat(26) +
      'Part (d): Compare the magnetic shield experiment with the uncovered magnet. Explain why the compass changes direction.',
    level: 'P5', formats: ['written'], inSyllabus: true }];
  let reviewed;
  h.adapter.ask = async (prompt, options) => {
    h.calls.push({ prompt, options });
    if (prompt.startsWith('Plan one')) return h.state.plan;
    if (/^(Science concept|Question structure)/.test(prompt)) return { phrases: ['magnetic shield', 'compass direction'] };
    reviewed = JSON.parse(prompt.slice(prompt.indexOf('\n{') + 1)).candidates[0].text;
    return { results: reviewed.includes('magnetic shield experiment') ? [{ id: 'late-experiment', score: 95 }] : [] };
  };
  const out = await h.run('Find the magnetic shield experiment question');
  assert.deepEqual(out.ids, ['late-experiment']);
  assert.ok(reviewed.length <= 650);
  assert.match(reviewed, /Read the shared setup/);
  assert.match(reviewed, /magnetic shield experiment/);
  assert.equal(out.calls, 4);
});

test('Planner and relevance model cannot invent ids or cross explicit format/level constraints', async () => {
  const h = harness({ action: 'search', query: 'spring', count: 1000, format: 'mcq', level: 'P6' });
  h.state.rank = [{ id: 'not-real', score: 100 }, { id: 'heat-1', score: 100 }, { id: 'spring-1', score: 99 }, { id: 'spring-2', score: 90 }, { id: 'spring-2', score: 85 }];
  const out = await h.run('Find P6 spring MCQ questions');
  assert.deepEqual(out.ids, ['spring-2']); assert(out.count <= 30);
});

test('Retired questions remain searchable in management but cannot enter a prepared worksheet', async () => {
  const h = harness({ action: 'worksheet', query: 'spring', count: 8, title: 'Springs' });
  const out = await h.run('Prepare a worksheet with 8 spring questions');
  assert.deepEqual(out.ids, ['spring-1', 'spring-2']); assert.equal(out.saved, false);
  assert.match(out.summary, /no unrelated questions were added/);
  assert.equal(h.operations[0].name, 'prepareWorksheet');
  assert(!h.operations.some(o => o.name === 'saveWorksheet'));
});

test('A follow-up worksheet uses grounded previous results without re-searching or changing existing selections', async () => {
  const h = harness(); await h.run('Find spring questions');
  h.state.plan = { action: 'worksheet', source: 'previous', references: [2], count: 1, title: 'One spring question' };
  const before = h.calls.length; const out = await h.run('Make a worksheet from result 2');
  assert.equal(h.calls.length - before, 1); assert.deepEqual(out.ids, ['spring-2']);
  assert.equal(h.operations.at(-1).payload.title, 'One spring question');
});

test('Question preview resolves result numbers against current bank and rejects stale or invented references', async () => {
  const h = harness(); await h.run('Find spring questions');
  const calls = h.calls.length;
  const good = await h.run('preview result 2'); assert.deepEqual(good.ids, ['spring-2']); assert.equal(h.calls.length, calls);
  h.state.bank = h.state.bank.filter(q => q.id !== 'spring-2');
  const before = h.operations.length;
  const gone = await h.run('preview result 2'); assert.equal(gone.count, 0); assert.equal(h.operations.length, before);
  const absent = await h.run('preview result 29'); assert.equal(absent.count, 0);
});

test('An arbitrary known id from the model is not enough without user or previous-result grounding', async () => {
  const h = harness({ action: 'preview', ids: ['heat-1'] });
  const out = await h.run('Preview something');
  assert.equal(out.count, 0); assert.equal(h.operations.length, 0);
});

test('A missing explicit reference never silently selects every previous result', async () => {
  const h = harness(); await h.run('Find spring questions');
  h.state.plan = { action: 'worksheet', source: 'previous', references: [12], count: 1, title: 'Result 12' };
  const before = h.operations.length;
  const out = await h.run('Make a worksheet from result 12');
  assert.equal(out.count, 0); assert.equal(h.operations.length, before);
});

test('Preparing then explicitly saving creates only the new draft once; save key survives retry', async () => {
  const h = harness({ action: 'worksheet', query: 'spring', count: 2, title: 'Springs', save: true });
  const prepared = await h.run('Prepare a spring worksheet');
  assert.equal(prepared.saved, false, 'A model cannot grant permission to save');
  let tries = 0, firstKey;
  const original = h.adapter.saveWorksheet;
  h.adapter.saveWorksheet = async (payload, ctx) => {
    firstKey ||= payload.saveKey; assert.equal(payload.saveKey, firstKey);
    if (++tries === 1) throw new Error('offline'); return original(payload, ctx);
  };
  await assert.rejects(h.run('save worksheet'), /offline/);
  const saved = await h.run('save worksheet'); assert.equal(saved.saved, true);
  const again = await h.run('save worksheet'); assert.equal(again.saved, true);
  assert.equal(h.operations.filter(o => o.name === 'saveWorksheet').length, 1);
});

test('An explicit prepare-and-save request is a safe search→draft→save flow', async () => {
  const h = harness({ action: 'worksheet', query: 'spring', count: 2, title: 'Springs', save: true });
  const out = await h.run('Prepare and save a spring worksheet');
  assert.equal(out.saved, true);
  assert.deepEqual(h.operations.map(o => o.name), ['prepareWorksheet', 'saveWorksheet']);
});

test('A negated save request cannot be turned into a write by a model', async () => {
  const h = harness({ action: 'worksheet', query: 'spring', count: 2, title: 'Springs', save: true });
  await h.run("Prepare a worksheet but don't save it");
  assert(!h.operations.some(o => o.name === 'saveWorksheet'));
});

for (const request of [
  "Prepare a worksheet but don't automatically save it",
  'Prepare a worksheet; no need to save it',
  'Prepare a worksheet but do not ever save it',
  "Prepare a worksheet but I won't save it yet",
  'Prepare a worksheet. I am not ready to save it',
  'Explain how to save a worksheet',
  'Prepare a worksheet and save it later',
  'Prepare a worksheet so I can save it'
]) test(`An ambiguous or negated save never authorizes a model-proposed write: ${request}`, async () => {
  const h = harness({ action: 'worksheet', query: 'spring', count: 1, title: 'Springs', save: true });
  const out = await h.run(request);
  assert.equal(out.saved, false);
  assert(!h.operations.some(o => o.name === 'saveWorksheet'));
  h.state.plan = { action: 'save_worksheet' };
  await h.run(request);
  assert(!h.operations.some(o => o.name === 'saveWorksheet'), 'direct save plans must obey the same permission check');
});

test('Ordinary conversation falls through and unknown actions execute nothing', async () => {
  for (const action of ['none', 'delete_all_questions', 'eval', '__proto__']) {
    const h = harness({ action, code: 'removeBank()' });
    const out = await h.run('Hello'); assert.equal(out.handled, false); assert.equal(h.operations.length, 0);
  }
});

test('Search exposes partial keyword candidates if specialists or ranking are unavailable', async () => {
  const h = harness(); h.state.specialistError = true; h.state.rankError = true;
  const out = await h.run('Find spring questions');
  assert.equal(out.partial, true); assert.match(out.summary, /keyword candidates/);
  assert.equal(h.calls.length, 4);
});

test('An empty bank reports no matches without specialist or reranking charges', async () => {
  const h = harness(); h.state.bank = [];
  const out = await h.run('Find spring questions');
  assert.equal(out.count, 0); assert.equal(h.calls.length, 1); assert.equal(h.operations.length, 0);
});

test('A no-topic worksheet uses the requested real format and level rather than inventing search terms', async () => {
  const h = harness({ action: 'worksheet', query: '', format: 'mcq', level: 'P4', count: 1, title: 'P4 practice' });
  const out = await h.run('Prepare one P4 MCQ from any topic');
  assert.deepEqual(out.ids, ['heat-1']); assert.equal(h.calls.length, 1);
});

for (const [name, mutate] of [
  ['signed out', h => { h.state.who = null; }],
  ['another account', h => { h.state.who = { ...h.state.who, uid: 'admin2' }; }],
  ['new session of the same account', h => { h.state.who = { ...h.state.who, session: {} }; }],
  ['student or employee role', h => { h.state.who.allowed = false; }]
]) test(`A late planner cannot execute after ${name}`, async () => {
  const h = harness(); const waiting = deferred(); h.adapter.ask = () => waiting.promise;
  const job = h.run('Find spring questions'); await flush(); mutate(h);
  waiting.resolve({ action: 'navigate', destination: 'rapid_add' });
  await assert.rejects(job, { name: 'AbortError' }); assert.equal(h.operations.length, 0);
});

test('Direct non-admin calls are rejected before any bank, model or app access', async () => {
  const h = harness(); h.state.who.allowed = false;
  h.adapter.getBank = () => { throw new Error('bank must not be read'); };
  await assert.rejects(h.run('Open Rapid Add'), { name: 'SecurityError' });
  assert.equal(h.calls.length, 0); assert.equal(h.operations.length, 0);
});

test('Abort returns promptly even if the provider keeps running; no late results execute', async () => {
  const h = harness(); const waiting = deferred(); h.adapter.ask = () => waiting.promise;
  const controller = new AbortController(); const job = h.run('Find spring questions', { signal: controller.signal });
  await flush(); controller.abort();
  await assert.rejects(job, { name: 'AbortError' });
  waiting.resolve({ action: 'navigate', destination: 'bank' }); await flush();
  assert.equal(h.operations.length, 0);
});

test('Starting a newer task cancels an older one and session cancellation forgets old references', async () => {
  const h = harness(); await h.run('Find spring questions');
  const waiting = deferred(); h.adapter.ask = () => waiting.promise;
  const old = h.run('Search something else'); await flush();
  const rejection = assert.rejects(old, { name: 'AbortError' });
  await h.run('open Rapid Add'); await rejection;
  h.agent.cancel(); const before = h.operations.length;
  const missing = await h.run('preview result 1'); assert.equal(missing.count, 0); assert.equal(h.operations.length, before);
  waiting.resolve({ action: 'navigate', destination: 'vetting' }); await flush();
  assert.equal(h.operations.length, before);
});

test('The total task deadline releases a stuck provider without an app action', async t => {
  const h = harness(); h.adapter.ask = () => new Promise(() => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const job = h.run('Find springs');
  await Promise.resolve(); await Promise.resolve();
  const rejection = assert.rejects(job, { name: 'TimeoutError' });
  t.mock.timers.tick(AINSTEIN_ADMIN_LIMITS.milliseconds + 1);
  await rejection; assert.equal(h.operations.length, 0);
});

// Exercise the actual application adapter, not a second version of its gates.
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = app.indexOf('function _ainsteinAdminIdentity()');
const end = app.indexOf('// Ask on the student\'s behalf', start);
assert(start > 0 && end > start);
function adapterHarness() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', style: {}, classList: { contains: cls => nodes.get(id).active === cls, add(cls) { nodes.get(id).active = cls; } } });
    return nodes.get(id);
  };
  let adapter; const calls = [], writes = [];
  const c = vm.createContext({
    createAinsteinAdminAgent: a => (adapter = a, { runAdminTask() {}, cancel() {} }),
    currentUser: { uid: 'admin1', role: 'admin' }, auth: { currentUser: { uid: 'admin1' } }, _practiceAs: null,
    questionBank: structuredClone(BANK), blocks: [], currentEditingQuestion: null,
    _wsPreviewAdhoc: null, savedWorksheets: [], bankTopicSel: new Set(['Heat']), wsSelectedIds: new Set(['already-picked']),
    bankAiRanking: null, document: { getElementById: node },
    ainsteinVoiceContext: () => 'Visible unsaved answer: Spring X exerts a greater force.',
    _isAdmin: () => c.currentUser?.role === 'admin', _ainsteinPageId: () => 'bank', emActive: () => false,
    qLevelNum: q => Number(q.level?.replace('P', '')), levelFromNumber: n => 'P' + n,
    qInSyllabus: q => q.inSyllabus, qpHasMcq: q => q.formats.includes('mcq'), qpHasWritten: q => q.formats.includes('written'),
    extractQuestionSearchText: q => q.text, aiGrounding: () => 'GROUNDED', askGemini: (prompt, options) => { calls.push(['ask', prompt, options]); return Promise.resolve('{}'); },
    openRapidAdd: () => node('rapidAddOverlay').classList.add('active'), navigateTo: page => calls.push(['navigate', page]),
    previewQuestionsPrint: (questions, title, source) => { c._wsPreviewAdhoc = { questions, title, source }; calls.push(['preview', questions, title, source]); },
    _syncBankTopicTicks() {}, _qbulkState: () => ({}), _bankAiStatus() {}, renderSavedWorksheets() {},
    db: {}, doc: (...args) => args.slice(1), setDoc: async (ref, data) => writes.push({ ref, data })
  });
  vm.runInContext(app.slice(start, end), c);
  const ctx = () => ({ identity: adapter.getIdentity(), check() { const id = adapter.getIdentity(); if (!id.allowed || id.uid !== 'admin1') throw Object.assign(new Error('changed'), { name: 'AbortError' }); } });
  return { c, adapter, calls, writes, node, ctx };
}

test('Live adapter requires admin role, matching Firebase identity, and no practice-as', () => {
  const h = adapterHarness(); assert.equal(h.adapter.getIdentity().allowed, true);
  h.c.currentUser.role = 'employee'; assert.equal(h.adapter.getIdentity().allowed, false);
  h.c.currentUser.role = 'admin'; h.c._practiceAs = {}; assert.equal(h.adapter.getIdentity().allowed, false);
  h.c._practiceAs = null; h.c.auth.currentUser.uid = 'different'; assert.equal(h.adapter.getIdentity().allowed, false);
});

test('Real action planner context includes current typed screen data', () => {
  const h = adapterHarness();
  assert.match(h.adapter.getContext().screen, /Spring X exerts a greater force/);
});

test('Real search updates the bank view but preserves picked worksheet questions and bank contents', () => {
  const h = adapterHarness(); const before = JSON.stringify(h.c.questionBank);
  h.adapter.showResults({ records: BANK.slice(0, 2), query: 'spring', partial: false }, h.ctx());
  assert.deepEqual([...h.c.wsSelectedIds], ['already-picked']); assert.equal(JSON.stringify(h.c.questionBank), before);
  assert.deepEqual([...h.c.bankAiRanking.keys()], ['spring-1', 'spring-2']);
  assert.deepEqual(h.calls.at(-1), ['navigate', 'bank']);
});

test('An occupied editor is preserved while search results open in a separate draft preview', () => {
  const h = adapterHarness(); h.node('page-create').active = 'active'; h.c.blocks = [{ text: 'Unsaved work' }];
  h.adapter.showResults({ records: BANK.slice(0, 2), query: 'spring' }, h.ctx());
  assert.equal(h.c.blocks[0].text, 'Unsaved work'); assert(!h.calls.some(x => x[0] === 'navigate'));
  const preview = h.calls.find(x => x[0] === 'preview'); assert.equal(preview[3], 'editor');
  assert.notEqual(preview[1][0], h.c.questionBank[0], 'A draft is a snapshot, not bank mutation');
});

test('Current preview is not replaced and preparation never autosaves or changes builder selection', () => {
  const h = adapterHarness(); h.node('wsPreviewOverlay').active = 'show';
  h.c._wsPreviewAdhoc = { title: 'My current preview' };
  const out = h.adapter.prepareWorksheet({ ids: ['spring-1'], title: 'New draft' }, h.ctx());
  assert.match(out.summary, /current editor or preview/); assert.equal(h.c._wsPreviewAdhoc.title, 'My current preview');
  assert.equal(h.writes.length, 0); assert.deepEqual([...h.c.wsSelectedIds], ['already-picked']);
});

test('Saving writes only a new own worksheet with grounded ids, then reports a completed save', async () => {
  const h = adapterHarness();
  const out = await h.adapter.saveWorksheet({ ids: ['spring-1'], title: 'New draft', saveKey: 'stable-draft-id' }, h.ctx());
  assert.equal(h.writes.length, 1); assert.deepEqual(Array.from(h.writes[0].ref).slice(0, 3), ['users', 'admin1', 'worksheets']);
  assert.equal(h.writes[0].ref[3], 'stable-draft-id');
  assert.deepEqual(Array.from(h.writes[0].data.questionIds), ['spring-1']); assert.equal(h.c.savedWorksheets.length, 1);
  assert.match(out.summary, /Saved/);
});

test('An old execution context cannot open Rapid Add or save after account switching', async () => {
  const h = adapterHarness(); const ctx = h.ctx(); h.c.currentUser = { uid: 'other', role: 'admin' }; h.c.auth.currentUser.uid = 'other';
  assert.throws(() => h.adapter.navigate({ destination: 'rapid_add' }, ctx), { name: 'AbortError' });
  await assert.rejects(h.adapter.saveWorksheet({ ids: ['spring-1'], title: 'No' }, ctx), { name: 'AbortError' });
  assert.equal(h.writes.length, 0);
});

function sendHarness(role = 'admin') {
  const field = { value: 'Find spring questions' }, calls = [];
  const c = vm.createContext({
    currentUser: { uid: 'u1', role }, _ainstein: { busy: false, history: [] },
    _ainsteinEl: () => field, _isAdmin: () => c.currentUser?.role === 'admin',
    _ainsteinAdminIdentity: () => ({ allowed: c.currentUser?.role === 'admin' }),
    window: { __aiReady: () => true }, ainsteinCreditsLeft: () => role === 'admin' ? Infinity : 5,
    showToast() {}, _ainsteinRender() {}, _ainsteinPaint() {},
    runAdminTask: async text => { calls.push(['admin', text]); return { handled: true, summary: 'Found 2 bank questions.' }; },
    _ainsteinQuestionContext: () => ({}), _ainsteinMayAnswer: () => false,
    _ainsteinScreenImages: async () => [], _ainsteinBuildPrompt: q => q,
    askGemini: async prompt => { calls.push(['chat', prompt]); return JSON.stringify({ relevant: true, clue: 'Think about the force.' }); },
    _parseAIJson: JSON.parse, _ainsteinLeaksAnswer: () => false,
    _ainsteinSpend: n => calls.push(['credits', n]), _ainsteinWantsOpen: () => '',
    _ainsteinGuideKind: () => '', _ainsteinWantsPractice: () => false, _ainsteinMaybeVideo() {}, console
  });
  const a = app.indexOf('async function ainsteinSend() {'), b = app.indexOf('// ---- mount ', a);
  assert(a > 0 && b > a);
  vm.runInContext(app.slice(a, b), c);
  return { c, calls, field };
}

test('Admin text dispatches actual capability outcome without a second answer call', async () => {
  const h = sendHarness(); await h.c.ainsteinSend();
  assert.deepEqual(h.calls, [['admin', 'Find spring questions']]);
  assert.equal(h.c._ainstein.history.at(-1).text, 'Found 2 bank questions.');
  assert.equal(h.c._ainstein.busy, false);
});

test('Student text keeps its original tutoring/credit path and never invokes admin capabilities', async () => {
  const h = sendHarness('student'); await h.c.ainsteinSend();
  assert(!h.calls.some(c => c[0] === 'admin'));
  assert(h.calls.some(c => c[0] === 'chat')); assert(h.calls.some(c => c[0] === 'credits'));
  assert.equal(h.c._ainstein.history.at(-1).text, 'Think about the force.');
});

test('Admin ordinary conversation still uses existing Ainstein chat', async () => {
  const h = sendHarness(); h.c.runAdminTask = async () => ({ handled: false });
  await h.c.ainsteinSend(); assert(h.calls.some(c => c[0] === 'chat'));
  assert.equal(h.c._ainstein.history.at(-1).text, 'Think about the force.');
});

test('A stale admin text task neither replies into nor clears a new session', async () => {
  const h = sendHarness(); const pending = deferred(); h.c.runAdminTask = () => pending.promise;
  const job = h.c.ainsteinSend(); await flush();
  h.c.currentUser = { uid: 'u2', role: 'admin' }; h.c._ainstein.history = [{ who: 'me', text: 'New session' }];
  h.c._ainstein.busy = true;
  pending.resolve({ handled: true, summary: 'Old result' }); await job;
  assert.equal(h.c._ainstein.history.length, 1); assert.equal(h.c._ainstein.busy, true);
});
