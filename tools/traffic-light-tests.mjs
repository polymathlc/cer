// Regression tests for 🚦 THE TRAFFIC LIGHT — one question's health at a
// glance.
// Run with:
//     node tools/traffic-light-tests.mjs            all cases
//     node tools/traffic-light-tests.mjs <name>     one case
//
// It loads the REAL `tl*` section out of app.js and runs it against stubs.
// Only ONE failure here actually matters, and every case below is a way of
// producing it: A GREEN LIGHT THAT LIES. The lamp is read at a glance, on a
// list of forty questions, by somebody who is about to print them — so a light
// that says "nothing wrong" when nothing was checked, when the check failed,
// or when the question has been rewritten since, is worse than no light at all.
//
//  • tlVerdict is PLAIN CODE. The same findings must always give the same
//    colour, or the lamp and the list printed under it disagree.
//  • An UNCHECKED question is `idle`, never `green`. Drawing "not checked" the
//    same as "checked and clean" is the whole feature quietly inverted.
//  • A verdict goes STALE when the question changes — in editing mode the
//    author is typing into the very question the light is about.
//  • …but NOT when something the check never reads changes. A light that goes
//    out every time a question is re-tagged is a light nobody bothers with.
//  • An AI failure is its own state and keeps the instant findings. "The check
//    could not run" and "the check found nothing" are opposite things.
//  • tlCheckMany checks each question on its OWN call, TL_PAR at a time, never
//    pays twice for a verdict that already stands, and stops when told to.
//  • tlEmQuestion reads what is ON SCREEN, not the saved copy — checking the
//    bank's version lights a question nobody is looking at.
//  • …and so does tlCreateQuestion, on the create page's ONE question. It has
//    three failures of its own, each of which draws a lamp about no question
//    that exists: reading the create page's fields while ✏️ editing mode has
//    the whole sheet in `blocks`; letting a verdict formed on one draft stand
//    over the next; and lighting an EMPTY editor green, which is the whole
//    feature inverted by pressing the button on a blank page.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b);
};

const section = cut('const TL_PAR = 3;', '// 🧰 ACTING ON MANY QUESTIONS AT ONCE', 'traffic light');

// ---- the world the section runs in -----------------------------------------
// Everything it borrows, stubbed, plus the hooks a case needs to steer:
//   HOOK.ai(q)      what the AI pass returns (or throws)
//   HOOK.aiReady    whether AI is reachable at all
//   HOOK.local(q)   what the instant checks find
//   HOOK.inflight   the high-water mark of AI calls running at once
const preamble = `
const HOOK = { aiReady: true, ai: () => [], local: () => [], calls: 0, live: 0, inflight: 0, toasts: [] };
let questionBank = [];
let vettingList = [];
let _em = { on: false, qs: [] };
let _emBlocks = {};
function emActive() { return !!_em.on; }
function emBlocksOf(id) { return _emBlocks[String(id)] || []; }
function syncEditorDomToBlocks() { HOOK.synced = (HOOK.synced || 0) + 1; }
function _docQById(id) { return questionBank.find(q => String(q.id) === String(id)) || undefined; }
function _sevRank(s) { return s === 'high' ? 0 : s === 'med' ? 1 : 2; }
function _canAuthor() { return true; }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showToast(msg, kind) { HOOK.toasts.push({ msg, kind }); }
function normalizeCategoryValue(v) { return String(v || ''); }
function _aiHash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return 'ai:' + (h >>> 0).toString(36); }
function editQuestion() { HOOK.editQuestionCalls = (HOOK.editQuestionCalls || 0) + 1; }
function _cqFindingHtml(f) { return '<div class="cq-find-row">' + escapeHtml(f.title) + '</div>'; }
// ── the create page's own world ───────────────────────────────────────────
let blocks = [];
let currentEditingQuestion = null;
function renderBlocks() { HOOK.rendered = (HOOK.rendered || 0) + 1; }
function _cqLocalFindings(q, aiAnswered) { return HOOK.local(q, aiAnswered) || []; }
function _cqMcqFixable() { return null; }
async function saveVettingQuestion() { return true; }
function renderVettingList() {}
function qbulkRenderBar() {}
async function _cqAiCheck(q) {
  HOOK.calls++;
  HOOK.live++;
  HOOK.inflight = Math.max(HOOK.inflight, HOOK.live);
  try { return await HOOK.ai(q); } finally { HOOK.live--; }
}
const window = { __aiReady: () => HOOK.aiReady };
// Enough of a DOM for the create page: an element per id, each carrying only
// what the code actually reads off it.
const DOM = HOOK.dom = {
  'page-create': { classList: { contains: c => c === 'active' && HOOK.createOpen, add(){}, remove(){} } },
  'questionTitle': { value: '' },
  'topicSelect': { value: '' },
  'categorySelect': { value: '' },
  'questionAnnotation': { checked: false },
  'tlCreateBar': { style: {}, dataset: {}, innerHTML: '' },
};
const document = {
  getElementById: id => DOM[id] || null,
  querySelectorAll: () => [],
  addEventListener: () => {},
};
`;

const M = new Function(preamble + section + `
return {
  HOOK,
  TL_PAR, TL_LOOKS,
  tlVerdict, tlSig, tlStateOf, tlFresh, tlRun, tlCheckMany, tlStopMany,
  tlLightHtml, tlTipFor, tlLookFor, tlEmQuestion, tlHeadline, tlWordFor,
  tlCreateActive, tlCreateQuestion, tlDraftId, tlRenderCreateBar,
  tlFixCreateOptions, tlQuestionFor, tlClick, tlRepaint,
  setBank: v => { questionBank = v; },
  setVetting: v => { vettingList = v; },
  setEm: (on, qs, blocksById) => { _em = { on, qs: qs || [] }; _emBlocks = blocksById || {}; },
  setEditor: (open, fields, bs, editingId) => {
    HOOK.createOpen = !!open;
    Object.assign(DOM['questionTitle'], { value: (fields && fields.title) || '' });
    Object.assign(DOM['topicSelect'], { value: (fields && fields.topic) || '' });
    Object.assign(DOM['categorySelect'], { value: (fields && fields.category) || '' });
    DOM['questionAnnotation'].checked = !!(fields && fields.annotation);
    blocks = bs || [];
    currentEditingQuestion = editingId || null;
  },
  editorBlocks: () => blocks,
  cache: () => _tlCache,
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};

let n = 0;
const F = (severity, title) => ({ type: 'Check', severity, title: title || 'something', detail: '', fix: '' });
const Q = extra => Object.assign({
  id: 'q' + (++n), title: 'A question', topic: 'Heat', category: 'mcq',
  blocks: [{ id: 'b1', type: 'text', content: '<p>Why did the ice melt?</p>' }],
}, extra || {});

const reset = () => {
  M.cache().clear();
  M.HOOK.aiReady = true;
  M.HOOK.ai = () => [];
  M.HOOK.local = () => [];
  M.HOOK.calls = 0; M.HOOK.live = 0; M.HOOK.inflight = 0; M.HOOK.toasts = [];
  M.setEm(false, [], {});
  M.setBank([]);
  M.setVetting([]);
  M.setEditor(false, {}, [], null);
  M.HOOK.editQuestionCalls = 0;
  M.HOOK.rendered = 0;
  M.HOOK.dom['tlCreateBar'].dataset = {};
  M.HOOK.dom['tlCreateBar'].innerHTML = '';
  M.HOOK.dom['tlCreateBar'].style = {};
};
const TEXT = html => ({ id: 'b1', type: 'text', content: '<p>' + html + '</p>' });

// ---- the verdict is plain code ---------------------------------------------
test('a high finding is RED, anything else is AMBER, nothing is GREEN', () => {
  reset();
  eq(M.tlVerdict([F('high'), F('low')]), 'red', 'one high finding');
  eq(M.tlVerdict([F('med')]), 'amber', 'a medium finding');
  // A LOW finding is still amber and never green. "No topic set" is a real
  // thing to fix, and a green light with a finding printed under it is the
  // lamp contradicting its own panel.
  eq(M.tlVerdict([F('low')]), 'amber', 'a low finding');
  eq(M.tlVerdict([]), 'green', 'nothing found');
  eq(M.tlVerdict(null), 'green', 'no list at all');
});

// ---- an unlit lamp is not a green one --------------------------------------
test('a question nobody has checked is idle, never green', () => {
  reset();
  const q = Q();
  eq(M.tlStateOf(q).state, 'idle', 'never checked');
  eq(M.tlLookFor(q).cls, 'idle', 'the lamp it draws');
  ok(!M.tlFresh(q), 'an unchecked question has no verdict standing');
  ok(/not checked/i.test(M.tlTipFor(q)), 'and it says so: ' + M.tlTipFor(q));
});

test('a green lamp is only ever a check that really ran and really found nothing', async () => {
  reset();
  const q = Q();
  await M.tlRun(q);
  eq(M.tlStateOf(q).state, 'green', 'clean question');
  ok(M.tlFresh(q), 'the verdict stands');
});

// ---- staleness -------------------------------------------------------------
test('editing the question puts the lamp out', async () => {
  reset();
  const q = Q();
  await M.tlRun(q);
  eq(M.tlStateOf(q).state, 'green', 'before the edit');
  q.blocks[0].content = '<p>Why did the ice melt so quickly?</p>';
  // NOT green any more, and not red either — there is simply no verdict for
  // the question as it now reads.
  eq(M.tlStateOf(q).state, 'stale', 'after the edit');
  ok(!M.tlFresh(q), 'a stale verdict does not stand');
  ok(/edited since/i.test(M.tlTipFor(q)), 'and it says why: ' + M.tlTipFor(q));
  // The same grey lamp as "never checked": both mean "no verdict stands".
  eq(M.tlLookFor(q).cls, 'idle', 'a stale lamp is unlit');
});

test('an edit deep inside a huge question still puts the lamp out', async () => {
  reset();
  // A question carrying a pasted picture is a data URL megabytes long, so the
  // signature does not keep the whole of it. A plain truncation would be the
  // silent version of that saving: an edit past the cut leaves a green lamp
  // over a question that has been rewritten.
  const big = 'x'.repeat(50000);
  const q = Q({ blocks: [{ id: 'b1', type: 'text', content: '<p>' + big + 'A</p>' }] });
  await M.tlRun(q);
  eq(M.tlStateOf(q).state, 'green', 'before the edit');
  q.blocks[0].content = '<p>' + big + 'B</p>';   // one character, 50k in
  eq(M.tlStateOf(q).state, 'stale', 'the length is the same, so the hash has to catch it');
});

test('…but a change the check never reads leaves it alone', async () => {
  reset();
  const q = Q();
  await M.tlRun(q);
  q.los = ['P5.HE.1'];              // filed on the syllabus map
  q.checked = { at: 'now' };        // read in ✅ Check Questions
  q.createdBy = 'someone';
  eq(M.tlStateOf(q).state, 'green', 'a re-tag must not put the lamp out');
});

test('a title or a topic change DOES put it out — both reach the prompt', async () => {
  reset();
  const a = Q();
  await M.tlRun(a);
  a.title = 'A better title';
  eq(M.tlStateOf(a).state, 'stale', 'the title is in the question the AI is shown');
  const b = Q();
  await M.tlRun(b);
  b.topic = 'Light';
  eq(M.tlStateOf(b).state, 'stale', 'the topic grounds the check');
});

// ---- an AI failure is never a green light ----------------------------------
test('an AI call that failed is its own state, and keeps the instant findings', async () => {
  reset();
  M.HOOK.ai = () => { throw new Error('billing cap'); };
  M.HOOK.local = () => [F('high', 'No correct option is marked')];
  const q = Q();
  await M.tlRun(q);
  const s = M.tlStateOf(q);
  eq(s.state, 'error', 'the AI could not answer');
  ok(/billing cap/.test(s.error || ''), 'and says what happened: ' + s.error);
  eq(s.findings.length, 1, 'the instant checks still ran');
  ok(!M.tlFresh(q), 'a failed check leaves no verdict standing');
});

test('AI switched off is reported, not silently passed', async () => {
  reset();
  M.HOOK.aiReady = false;
  const q = Q();
  await M.tlRun(q);
  eq(M.HOOK.calls, 0, 'no call is made when there is nothing to call');
  eq(M.tlStateOf(q).state, 'error', 'never green on the instant checks alone');
});

test('the instant checks run even when the AI is unreachable', async () => {
  reset();
  M.HOOK.aiReady = false;
  M.HOOK.local = () => [F('high', 'The model answer is blank')];
  const q = Q();
  await M.tlRun(q);
  eq(M.tlStateOf(q).findings.length, 1, 'a structural red needs no model');
});

test('findings are shown worst first, whichever layer found them', async () => {
  reset();
  M.HOOK.local = () => [F('low', 'No topic set')];
  M.HOOK.ai = () => [F('high', 'The marked option is wrong')];
  const q = Q();
  await M.tlRun(q);
  const s = M.tlStateOf(q);
  eq(s.state, 'red', 'the worst finding decides the colour');
  eq(s.findings.map(f => f.severity), ['high', 'low'], 'order');
});

test('the AI is told whether it has answered, so its nudges can stand down', async () => {
  reset();
  let sawAnswered = null;
  M.HOOK.local = (q, aiAnswered) => { sawAnswered = aiAnswered; return []; };
  await M.tlRun(Q());
  eq(sawAnswered, true, 'the AI answered, so the "the AI will say" nudge is spent');
  reset();
  M.HOOK.aiReady = false;
  M.HOOK.local = (q, aiAnswered) => { sawAnswered = aiAnswered; return []; };
  await M.tlRun(Q());
  eq(sawAnswered, false, 'nothing answered, so the nudge still stands');
});

// ---- the whole sheet at once -----------------------------------------------
test('every question is its own call, TL_PAR at a time', async () => {
  reset();
  M.HOOK.ai = () => new Promise(r => setTimeout(() => r([]), 5));
  const list = Array.from({ length: 9 }, () => Q());
  await M.tlCheckMany(list, {});
  eq(M.HOOK.calls, 9, 'one call per question — a whole paper in one reply truncates');
  ok(M.HOOK.inflight <= M.TL_PAR, 'at most TL_PAR in flight, got ' + M.HOOK.inflight);
  ok(M.HOOK.inflight > 1, 'and they really do overlap');
});

test('a verdict that already stands is not paid for twice', async () => {
  reset();
  const list = [Q(), Q(), Q()];
  await M.tlRun(list[0]);
  eq(M.HOOK.calls, 1, 'the first one');
  await M.tlCheckMany(list, {});
  eq(M.HOOK.calls, 3, 'only the two without a verdict were read again');
});

test('…but one that has gone stale IS re-read', async () => {
  reset();
  const q = Q();
  await M.tlRun(q);
  q.blocks[0].content = '<p>changed</p>';
  await M.tlCheckMany([q], {});
  eq(M.HOOK.calls, 2, 'the edited question is checked again');
});

test('the run reports what it found, and ⏹ Stop is honoured', async () => {
  reset();
  M.HOOK.ai = q => (q.id === 'q-bad' ? [F('high')] : []);
  const bad = Q({ id: 'q-bad' });
  const m = await M.tlCheckMany([bad, Q(), Q()], {});
  eq([m.total, m.red, m.green], [3, 1, 2], 'the tally');

  reset();
  let seen = 0;
  M.HOOK.ai = () => { if (++seen === 1) M.tlStopMany(); return new Promise(r => setTimeout(() => r([]), 3)); };
  const many = await M.tlCheckMany(Array.from({ length: 30 }, () => Q()), {});
  ok(many.done < 30, 'stopping really stops: ' + many.done + ' of 30');
});

test('a run never reads more than TL_MANY_MAX questions', async () => {
  reset();
  const huge = Array.from({ length: 400 }, () => Q());
  const m = await M.tlCheckMany(huge, {});
  ok(m.total <= 200, 'a single press cannot spend hundreds of calls: ' + m.total);
});

// ---- editing mode reads what is ON SCREEN ----------------------------------
test('in editing mode the lamp is about the question on screen, not the saved one', () => {
  reset();
  const saved = Q({ id: 'q7', title: 'Saved title', blocks: [{ id: 'b1', type: 'text', content: '<p>old</p>' }] });
  M.setBank([saved]);
  M.setEm(true, [{ id: 'q7', key: 'k1', title: 'Typed title' }], {
    q7: [{ id: 'b1', type: 'text', content: '<p>new, not saved yet</p>' }],
  });
  const live = M.tlEmQuestion('q7');
  eq(live.title, 'Typed title', 'the title being typed');
  ok(/not saved yet/.test(live.blocks[0].content), 'the wording on screen');
  // …and everything else about the question still comes from the bank, or the
  // check would be run on a question with no topic and no category.
  eq(live.topic, 'Heat', 'the meta comes from the bank copy');
});

test('a question the sheet no longer knows falls back to the bank', () => {
  reset();
  const saved = Q({ id: 'q9' });
  M.setBank([saved]);
  M.setEm(true, [], {});
  eq(M.tlEmQuestion('q9').id, 'q9', 'never null — a missing entry must not blank the lamp');
});

test('a question with nothing in it can never light green, whoever asks', async () => {
  reset();
  // Every check is a walk over the blocks, so an empty question returns an
  // empty list from BOTH layers — which `tlVerdict` reads, correctly, as
  // green. The guard has to be above them, or the easiest lie of all to
  // produce is the one nobody guards against.
  const empty = Q({ id: 'q-empty', blocks: [] });
  eq(await M.tlRun(empty), null, 'no verdict is formed');
  eq(M.tlStateOf(empty).state, 'idle', 'and the lamp stays unlit');
  eq(M.HOOK.calls, 0, 'nothing was read, so nothing was billed');
  // 🚦 Check all counts it as ⚠, never as one of the greens.
  const m = await M.tlCheckMany([empty, Q()], {});
  eq([m.green, m.error], [1, 1], 'the tally: one real green, one that could not be checked');
});

test('a VETTING question is found in the vetting list, never in the bank', () => {
  reset();
  // `_docQById` reads `questionBank` and nothing else, so without its own scope
  // every lamp on the vetting list is about a question that cannot be found —
  // and sits grey for ever on a page where nothing looks broken.
  const v = Q({ id: 'v1', title: 'Waiting to be vetted' });
  M.setVetting([v]);
  eq(M.tlQuestionFor('vet', 'v1').title, 'Waiting to be vetted', 'through the scope');
  eq(M.tlQuestionFor('bank', 'v1'), null, 'and it really is not in the bank');
});

// ---- the create page reads the EDITOR, not the bank ------------------------
test('on the create page the lamp is about what is in the editor', () => {
  reset();
  M.setBank([Q({ id: 'q7', title: 'Saved title', topic: 'Heat', blocks: [TEXT('old')] })]);
  M.setEditor(true, { title: 'Being typed', topic: 'Light', category: 'PSLE - OEQ' }, [TEXT('new, not saved yet')], 'q7');
  const q = M.tlCreateQuestion();
  eq(q.title, 'Being typed', 'the title in the box');
  eq(q.topic, 'Light', 'the topic chosen NOW, not the one it was saved under');
  ok(/not saved yet/.test(q.blocks[0].content), 'the wording on screen');
  // …and the scope resolves to exactly that, so one painter and one panel
  // serve the create page without knowing anything about it.
  eq(M.tlQuestionFor('create', 'q7').title, 'Being typed', 'through the scope');
});

test('a question opened from the bank keeps its REAL id, so the bank lights up too', async () => {
  reset();
  const bank = Q({ id: 'q7', title: 't', topic: 'Heat', category: 'c', blocks: [TEXT('a question')] });
  M.setBank([bank]);
  M.setEditor(true, { title: 't', topic: 'Heat', category: 'c' }, bank.blocks, 'q7');
  await M.tlRun(M.tlCreateQuestion());
  eq(M.tlStateOf(M.tlCreateQuestion()).state, 'green', 'checked in the editor');
  // The editor's copy and the saved copy are word for word the same here, so
  // the verdict really does describe the bank's question — which is what makes
  // "check it, save it, and the bank row is already lit" honest.
  eq(M.tlStateOf(bank).state, 'green', 'the same verdict stands for the saved copy');
});

test('an UNSAVED draft is checked under one fixed id, and clearing the editor puts it out', async () => {
  reset();
  M.setEditor(true, { title: 'A draft', topic: 'Heat' }, [TEXT('first draft')], null);
  eq(M.tlCreateQuestion().id, M.tlDraftId(), 'a draft has no id of its own');
  await M.tlRun(M.tlCreateQuestion());
  eq(M.tlStateOf(M.tlCreateQuestion()).state, 'green', 'the draft was checked');
  // The reset that starts the next question is what has to put the lamp out,
  // and it does it through the SIGNATURE — no reset hook to forget.
  M.setEditor(true, { title: '', topic: 'Heat' }, [TEXT('a completely different question')], null);
  eq(M.tlStateOf(M.tlCreateQuestion()).state, 'stale', 'the last draft\'s verdict must not stand over the next');
});

// ---- the guard that matters most -------------------------------------------
test('it stands DOWN in editing mode, where `blocks` is the whole sheet', () => {
  reset();
  M.setEditor(true, { title: 'Left over from the create page', topic: 'Heat' }, [TEXT('question 1'), TEXT('question 2')], null);
  eq(M.tlCreateActive(), true, 'the create page is up');
  M.setEm(true, [{ id: 'q1', key: 'k1', title: 'x' }], {});
  // With the sheet open the global `blocks` is the WHOLE PAPER and the create
  // page's own fields still hold whatever question was last open THERE, so a
  // lamp drawn from them describes no question that exists.
  eq(M.tlCreateActive(), false, 'not while editing mode has the sheet');
  eq(M.tlCreateQuestion(), null, 'and no question is offered');
  eq(M.tlQuestionFor('create', 'anything'), null, 'through the scope either');
});

test('…and when the create page is not even open', () => {
  reset();
  M.setEditor(false, { title: 'stale' }, [TEXT('stale')], null);
  eq(M.tlCreateQuestion(), null, 'the editor is not on screen');
});

// ---- an empty editor must never light green --------------------------------
test('pressing the lamp on an empty editor refuses rather than lighting it green', async () => {
  reset();
  M.setEditor(true, { title: '', topic: '' }, [], null);
  await M.tlClick('create', M.tlDraftId());
  eq(M.HOOK.calls, 0, 'nothing was read');
  eq(M.tlStateOf(M.tlCreateQuestion()).state, 'idle', 'and nothing was lit');
  ok(/add some blocks/i.test((M.HOOK.toasts.pop() || {}).msg || ''), 'it says why');
  // The point: the instant checks find NOTHING wrong with a question that has
  // nothing in it, so without this guard a blank page lights green.
  eq(M.tlVerdict([]), 'green', 'which is exactly what an empty check would return');
});

test('a question with blocks in it checks normally', async () => {
  reset();
  M.setEditor(true, { title: 'A question', topic: 'Heat' }, [TEXT('why did the ice melt?')], null);
  await M.tlClick('create', M.tlDraftId());
  eq(M.HOOK.calls, 1, 'one call, one question');
  eq(M.tlStateOf(M.tlCreateQuestion()).state, 'green', 'and a verdict that stands');
});

// ---- the ＃ fix has to write where the question actually lives --------------
test('the one-tap fix writes the EDITOR\'s blocks, never the bank', () => {
  reset();
  const mcq = { id: 'm1', type: 'mcq', options: [{ id: 'o1', text: 'the wood floats' }, { id: 'o2', text: 'the wood sinks' }], correctId: 'o1' };
  const saved = Q({ id: 'q7', blocks: [JSON.parse(JSON.stringify(mcq))] });
  M.setBank([saved]);
  M.setEditor(true, { title: 't', topic: 'Heat' }, [mcq], 'q7');
  M.tlFixCreateOptions();
  eq(M.editorBlocks()[0].options.map(o => o.text), ['(1)', '(2)'], 'the editor is renumbered');
  // Nothing is saved until the author presses Save — `cqNumberOptions` writes
  // straight to the bank, which on a draft that has never been saved does
  // nothing at all and on one that has rewrites it behind the author's back.
  eq(saved.blocks[0].options.map(o => o.text), ['the wood floats', 'the wood sinks'], 'the bank copy is untouched');
  ok(M.HOOK.rendered > 0, 'and the editor is redrawn so the author sees it');
});

test('the fix says so rather than doing nothing when there are no options', () => {
  reset();
  M.setEditor(true, { title: 't', topic: 'Heat' }, [TEXT('no options here')], null);
  M.tlFixCreateOptions();
  ok(/no options/i.test((M.HOOK.toasts.pop() || {}).msg || ''), 'a button that silently does nothing is worse than none');
});

// ---- the bar --------------------------------------------------------------
test('the create bar is hidden when there is no question to be about', () => {
  reset();
  M.tlRenderCreateBar();
  eq(M.HOOK.dom['tlCreateBar'].style.display, 'none', 'not on the create page');
  M.setEditor(true, { title: 'A question', topic: 'Heat' }, [TEXT('x')], null);
  M.tlRenderCreateBar();
  eq(M.HOOK.dom['tlCreateBar'].style.display, '', 'shown once the editor is up');
  ok(/data-tl-scope="create"/.test(M.HOOK.dom['tlCreateBar'].innerHTML), 'carrying a lamp of its own');
});

test('a labelled lamp never says "nothing flagged" about a question nobody checked', async () => {
  reset();
  const q = Q();
  ok(/check this question/i.test(M.tlWordFor(q)), 'unchecked: ' + M.tlWordFor(q));
  await M.tlRun(q);
  eq(M.tlWordFor(q), 'Nothing flagged', 'checked and clean');
  q.blocks[0].content = '<p>changed</p>';
  ok(/check again/i.test(M.tlWordFor(q)), 'edited since: ' + M.tlWordFor(q));
  // Every state needs words of its own, or two of them read alike on a control
  // whose whole job is to say which one it is in.
  const seen = new Set();
  ['idle', 'stale', 'running', 'error', 'red', 'amber', 'green'].forEach(s => {
    const w = M.tlWordFor({ id: 'x', blocks: [] });   // shape only; state is forced below
    ok(typeof w === 'string' && w.length, 'no words at all for ' + s);
  });
  ['red', 'amber', 'green', 'running', 'error', 'stale', 'idle'].forEach(state => {
    const words = M.tlHeadline({ state, findings: [] });
    ok(!seen.has(words), 'two states read alike: ' + words);
    seen.add(words);
  });
});

test('a labelled lamp keeps its words and its dot apart', () => {
  reset();
  const html = M.tlLightHtml(Q({ id: 'q1' }), 'create', { text: true });
  ok(/class="tl-light [a-z]+ wide"/.test(html), 'it is the wide pill: ' + html.slice(0, 120));
  ok(/<span class="tl-dot">/.test(html), 'the colour');
  ok(/<span class="tl-txt">/.test(html), 'and what it means — repaint writes them separately');
  ok(/data-tl-scope="create"/.test(html), 'the ONE painter still finds it');
});

// ---- the lamp itself -------------------------------------------------------
test('every lamp carries its id and scope, which is what lets ONE painter find it', () => {
  reset();
  const html = M.tlLightHtml(Q({ id: 'q1' }), 'em');
  ok(/data-tl-id="q1"/.test(html), 'the question it is about');
  ok(/data-tl-scope="em"/.test(html), 'who to ask for that question');
  ok(/aria-label=/.test(html), 'a colour alone is not a label');
  ok(/stopPropagation/.test(html), 'a lamp on a card must not also trigger the card');
});

test('a lamp for nothing is nothing', () => {
  reset();
  eq(M.tlLightHtml(null, 'bank'), '', 'no question');
  eq(M.tlLightHtml({ title: 'no id' }, 'bank'), '', 'no id');
});

test('every state has a look and a headline of its own', () => {
  reset();
  ['idle', 'stale', 'running', 'error', 'red', 'amber', 'green'].forEach(s => {
    ok(M.TL_LOOKS[s], 'no look for ' + s);
    ok(M.tlHeadline({ state: s, findings: [] }), 'no headline for ' + s);
  });
  // The two that must never be confused for one another.
  ok(M.TL_LOOKS.green.cls !== M.TL_LOOKS.idle.cls, 'green and unlit look different');
  ok(M.TL_LOOKS.error.cls !== M.TL_LOOKS.green.cls, 'a failed check does not look clean');
});

// ---- the source itself -----------------------------------------------------
test('it is the SAME checker ✅ Check Questions uses — never a second prompt', () => {
  ok(/_cqAiCheck\(/.test(section), 'the AI half is Check Questions\' own');
  ok(/_cqLocalFindings\(/.test(section), 'and so is the instant half');
  ok(!/askGemini/.test(section), 'the traffic light must not carry a prompt of its own');
});

test('the summary bar is SHOWN, not merely un-hidden', () => {
  // `.em-tlbar` is display:none in the stylesheet, so clearing the inline
  // style leaves it hidden — the bar would never appear at all, on a run that
  // otherwise worked perfectly.
  const fn = section.slice(section.indexOf('function tlRenderEmBar'), section.indexOf('function tlJumpToProblem'));
  ok(/display = 'flex'/.test(fn), 'it has to name a display mode of its own');
  ok(!/display = ''/.test(fn), "clearing the inline style leaves the stylesheet's display:none standing");
});

test('the bar counts the lamps standing NOW, not the run\'s own tally', () => {
  // A question fixed after the run has to drop out of the count, or the bar
  // sits there saying "1 🔴" about a question that is now green.
  const fn = section.slice(section.indexOf('function tlRenderEmBar'), section.indexOf('function tlJumpToProblem'));
  ok(/tlStateOf\(tlEmQuestion/.test(fn), 'it re-reads each question rather than reporting _tlMany');
});

test('the create page never reloads the saved copy over unsaved edits', () => {
  // `editQuestion` in the panel's ✏️ button would load the SAVED question over
  // the very edits the check was run on — and on a draft that has never been
  // saved there is nothing to load. The create scope has to be handled BEFORE
  // that call, so the branch has to come first in the function.
  const fn = section.slice(section.indexOf('function tlPanelEdit'), section.indexOf('function tlScrollToQuestion'));
  const create = fn.indexOf("_tlPanelScope === 'create'");
  ok(create > -1, 'the create scope is handled at all');
  ok(create < fn.indexOf('editQuestion('), 'and before editQuestion could fire');
});

test('the ＃ fix is routed by SCOPE, so it cannot write to the wrong place', () => {
  // `_cqFindingHtml` lives outside the cut section — it is ✅ Check Questions'
  // own renderer, shared with this panel — so this reads app.js itself.
  const fn = src.slice(src.indexOf('function _cqFindingHtml'), src.indexOf('// ---- the AI pass, driven from the page'));
  ok(/scope === 'create'/.test(fn), 'the create page gets the editor fix');
  ok(/tlFixCreateOptions\(\)/.test(fn), 'which writes the blocks on screen');
  ok(/cqNumberOptions\(/.test(fn), 'and everywhere else still writes the bank');
  ok(/list\.map\(f => _cqFindingHtml\(f, q\.id, _tlPanelScope\)\)/.test(section), 'the panel hands the scope over');
});

test('the painter SWAPS the state class rather than rewriting className', () => {
  // A lamp carries layout classes of its own — `sm` on a bank row, `lg` in the
  // panel, `wide` on the create page. Rebuilding the class list from the state
  // alone leaves the lamp its colour and takes its shape away.
  const fn = section.slice(section.indexOf('function tlRepaint'), section.indexOf('// ── Which question a light is about'));
  ok(/classList\.remove/.test(fn) && /classList\.add/.test(fn), 'it edits the class list');
  ok(!/el\.className = /.test(fn), 'and never rewrites it wholesale');
  ok(/\.tl-dot/.test(fn), "a labelled lamp's dot is painted on its own, or the words are rubbed out");
});

test('every entry point syncs BOTH surfaces before it checks anything', () => {
  // The wording lives in contenteditable boxes on the sheet AND in the create
  // editor, so it only reaches `blocks` when it is read back. One sync that
  // covers both means no call site has to know which surface it is on.
  ok(/function tlSyncScreen\(\) \{ tlEmSync\(\); tlCreateSync\(\); \}/.test(section), 'there is one sync');
  const click = section.slice(section.indexOf('async function tlClick'), section.indexOf('function tlOpenPanel'));
  ok(/tlSyncScreen\(\)/.test(click), 'the lamp click syncs');
  const recheck = section.slice(section.indexOf('function tlRecheck'), section.indexOf('function tlPanelEdit'));
  ok(/tlSyncScreen\(\)/.test(recheck), '🔄 Check again syncs');
});

test('the verdict is never asked of a model', () => {
  const fn = section.slice(section.indexOf('function tlVerdict'), section.indexOf('function tlSig'));
  ok(!/await|askGemini|Promise/.test(fn), 'tlVerdict has to be repeatable, so it is plain code');
});

// ---- runner ----------------------------------------------------------------
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && !c.name.includes(only)) continue;
  try { await c.fn(); pass++; console.log('  ✓ ' + c.name); }
  catch (e) { fail++; console.log('  ✗ ' + c.name + '\n      ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
