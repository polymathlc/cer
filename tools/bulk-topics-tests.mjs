// Regression tests for 🧰 ACTING ON MANY QUESTIONS AT ONCE — the shared scope,
// 🎯 Re-file topics, and 🚦 Check over a set.
// Run with:
//     node tools/bulk-topics-tests.mjs            all cases
//     node tools/bulk-topics-tests.mjs <name>     one case
//
// It loads the REAL `qbulk*` / `aiPickTopic` / `_qbtWrite` block out of app.js.
//
// A pile of P6 questions imported at P3 is not a labelling mistake: THIS APP
// HAS NO `q.level` FIELD. A question's level is read off its TOPIC, and every
// serving surface reads it that way — so a wrongly filed paper is SERVED to the
// wrong children, and re-filing the topics is the only thing that puts it
// right. Every way this goes wrong is silent, and it goes wrong on a whole
// batch at once:
//
//  • THE SCOPE MUST BE NARROWED TO WHAT IS ON SCREEN. A search box or a filter
//    is the author saying "these are the ones I am looking at"; re-filing a
//    question hidden behind one is the single outcome nobody could have
//    predicted from the button they pressed.
//  • A RETIRED TOPIC IS NEVER A TARGET. `qInSyllabus` keeps Cell Systems out of
//    every practice mode and every game, so filing a question into it writes
//    one no student can ever be served.
//  • THE SECOND TOPIC COUNTS. `qLevelNum` takes the MAX over `topic` and
//    `topic2`, so a P6 secondary topic left behind keeps the whole question at
//    P6 while the primary topic looks perfectly right — the re-file silently
//    undone by the field nobody looked at.
//  • A MODEL THAT ANSWERS OFF THE LIST is not an answer. It is snapped into the
//    level and marked LOW, which is the ⚠ badge a person already reads.
//  • A WRITE THAT DID NOT LAND MUST NOT MOVE THE IN-MEMORY COPY, or the screen
//    says the question was re-filed and the database says it was not.
//  • THE PREVIOUS TOPIC IS KEPT. This is the fix FOR a mistake, and the fix can
//    be a mistake too.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

// Every cut ends with a NEWLINE: a window that stops mid-comment glues the next
// window's first line onto a `//` and comments the declaration out.
const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b) + '\n';
};

const section = cut('const QBULK_MAX = 200;', '\n// 🔍 ANSWER KEY CROSS-CHECK', 'bulk tools');

// The world it runs in. The AI reply, the DOM and the writes are stubs; the
// routing, the scoping and the book-keeping are the app's own.
const preamble = `
const HOOK = {
  ai: () => ({ topic: 'Heat', confidence: 'high' }),
  aiReady: true, calls: 0, live: 0, inflight: 0,
  writes: [], refuse: new Set(), toasts: [], confirms: [], wkMax: 0,
  levels: {
    P3: ['Materials', 'Magnets'],
    P5: ['Heat', 'Electricity', 'Cell Systems'],
    P6: ['Energy', 'Forces'],
    // The reported case: a topic that names the PROCESS of science rather than
    // a body of it.
    S1: ['The Scientific Endeavour', 'Measurement and Lab Skills', 'Ray Model of Light'],
  },
  fixedTopic: 'Energy',
};
let questionBank = [], vettingList = [];
let wsSelectedIds = new Set(), _vetSelected = new Set();
let _tlMany = null;
let _wkSuppress = 0;
let currentUser = { uid: 'me' };
const TOPIC_LEVELS = ['P3', 'P4', 'P5', 'P6', 'S1'];
const AKC_WINDOWS = [{ hours: 1, text: 'hour' }, { hours: 24, text: '24 hours' }, { hours: 0, text: '— any time —' }];
const QRETIRED_TOPIC_RE = /cell\\s*systems/i;
const LEVEL_ORDER = { P3: 3, P4: 4, P5: 5, P6: 6, S1: 7 };
function getLevelNumber(l) { return LEVEL_ORDER[String(l || '').trim().toUpperCase()] || 3; }
let SHOWN_BANK = null, SHOWN_VET = null;   // null = "everything", so the page's own filter is the default
function _bankFilteredQuestions() { return (SHOWN_BANK || questionBank.slice()).filter(q => qbulkLightPasses('bank', q)); }
function _vetVisibleQuestions() { return (SHOWN_VET || vettingList.slice()).filter(q => qbulkLightPasses('vetting', q)); }
function _vetAddedAt(q) { return (q && (q.vettedAt || q.createdAt)) || ''; }
function _questionRecency(x) {
  if (x && x.createdAt) { const t = Date.parse(x.createdAt); if (!isNaN(t)) return t; }
  const m = /^q_(\\d{10,})/.exec(String((x && x.id) || ''));
  return m ? Number(m[1]) : 0;
}
function qSecondaryTopic(q) { return (q && typeof q.topic2 === 'string') ? q.topic2.trim() : ''; }
function _qOwner(id) { return (questionBank.find(q => q.id === id) || {}).owner || 'me'; }
function _vOwner(id) { return (vettingList.find(q => q.id === id) || {}).owner || 'me'; }
function currentTopicsByLevel() { return HOOK.levels; }
function currentTopics() { return Object.keys(HOOK.levels).reduce((a, k) => a.concat(HOOK.levels[k]), []); }
function getTopicLevel(t) { return Object.keys(HOOK.levels).find(k => HOOK.levels[k].indexOf(t) >= 0) || ''; }
function normalizeCategoryValue(v) { return String(v || ''); }
function _fcClip(s) { return String(s || '').slice(0, 400); }
function _questionContext(q) { return 'the wording of ' + (q && q.title); }
function _canAuthor() { return true; }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showToast(msg, kind) { HOOK.toasts.push({ msg, kind }); }
function confirm(msg) { HOOK.confirms.push(msg); return HOOK.confirmAnswer !== false; }
function updateCounts() {}
function renderQuestionBank() {}
function renderVettingList() {}
function tlStateOf(q) { return { state: (HOOK.lights && HOOK.lights[q && q.id]) || 'idle' }; }
function tlFresh(q) { return ['red', 'amber', 'green'].indexOf(tlStateOf(q).state) >= 0; }
function tlRepaint() {}
function tlCheckMany(list, opts) { HOOK.checked = list.slice(); return Promise.resolve(_tlMany = { total: list.length, done: list.length, red: 0, amber: 0, green: list.length, error: 0, running: false }); }
function tlStopMany() {}
async function askGemini() {
  HOOK.calls++; HOOK.live++; HOOK.inflight = Math.max(HOOK.inflight, HOOK.live);
  HOOK.wkMax = Math.max(HOOK.wkMax, _wkSuppress);
  try { await new Promise(r => setTimeout(r, 1)); return JSON.stringify(await HOOK.ai()); }
  finally { HOOK.live--; }
}
function _parseAIJson(raw) { try { return JSON.parse(raw); } catch (e) { return null; } }
async function _write(q, where) {
  HOOK.wkMax = Math.max(HOOK.wkMax, _wkSuppress);
  if (HOOK.refuse.has(q.id)) return false;
  HOOK.writes.push({ id: q.id, where, topic: q.topic, topic2: q.topic2, conf: q.topicConfidence });
  return true;
}
async function saveQuestion(q, opts) { HOOK.quiet = !!(opts && opts.quiet); return _write(q, 'bank'); }
async function saveVettingQuestion(q) { return _write(q, 'vetting'); }
const window = { __aiReady: () => HOOK.aiReady };
const localStorage = { getItem: () => null, setItem: () => {} };
const document = { getElementById: id => (id === 'qbtFixed' ? { value: HOOK.fixedTopic } : null) };
`;

const M = new Function(preamble + section + `
return {
  HOOK,
  QBULK_MAX, QBT_CONFIRM_OVER,
  list: qbulkList, owned: qbulkOwned, choices: qbulkTopicChoices, unlit: qbulkUnlit,
  secondOk: qbulkSecondOk, isProcess: qProcessTopic,
  recency: qbulkRecency, scopeLabel: qbulkScopeLabel, lightPasses: qbulkLightPasses,
  setScope: (w, s) => { _qbulk[w].scope = s; },
  setWindow: (w, h) => { _qbulk[w].hours = h; },
  setLight: (w, l) => { _qbulk[w].light = l; },
  pickTopic: aiPickTopic,
  open: qbulkTopicsOpen, run: qbulkTopicsRun, undo: qbulkTopicsUndo, level: qbulkTopicsLevel,
  check: qbulkCheck,
  draft: () => _qbt,
  undoStack: () => _qbtUndo,
  setBank: v => { questionBank = v; },
  setVetting: v => { vettingList = v; },
  setShownBank: v => { SHOWN_BANK = v; },
  setShownVet: v => { SHOWN_VET = v; },
  pickBank: ids => { wsSelectedIds = new Set(ids); },
  pickVet: ids => { _vetSelected = new Set(ids); },
  wk: () => _wkSuppress,
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
  }
};

const HOUR = 3600000;
let n = 0;
const Q = (extra) => Object.assign({
  id: 'q_' + (1700000000000 + (++n)) + '_a', title: 'Question ' + n,
  topic: 'Materials', category: 'PSLE - OEQ', blocks: [], createdAt: new Date().toISOString(),
}, extra || {});
const ago = h => new Date(Date.now() - h * HOUR).toISOString();

const reset = () => {
  M.HOOK.ai = () => ({ topic: 'Heat', confidence: 'high' });
  M.HOOK.aiReady = true;
  M.HOOK.calls = 0; M.HOOK.live = 0; M.HOOK.inflight = 0;
  M.HOOK.writes = []; M.HOOK.refuse = new Set(); M.HOOK.toasts = []; M.HOOK.confirms = [];
  M.HOOK.wkMax = 0; M.HOOK.quiet = undefined; M.HOOK.lights = {}; M.HOOK.checked = null;
  M.HOOK.confirmAnswer = true; M.HOOK.fixedTopic = 'Energy';
  M.setBank([]); M.setVetting([]); M.setShownBank(null); M.setShownVet(null);
  M.pickBank([]); M.pickVet([]);
  M.setScope('bank', 'window'); M.setWindow('bank', 24); M.setLight('bank', '');
  M.setScope('vetting', 'window'); M.setWindow('vetting', 24); M.setLight('vetting', '');
};

// ── the scope: which questions ──────────────────────────────────────────────
test('every scope is narrowed to what the page is SHOWING', () => {
  reset();
  const a = Q(), b = Q(), c = Q();
  M.setBank([a, b, c]);
  M.setShownBank([a, b]);            // a filter or a search is hiding c
  M.pickBank([a.id, c.id]);          // …and c was ticked before it was hidden
  M.setScope('bank', 'picked');
  eq(M.list('bank').map(q => q.id), [a.id], 'a tick on a hidden question is not in the set');
  M.setScope('bank', 'shown');
  eq(M.list('bank').map(q => q.id), [a.id, b.id], '"everything shown" means shown');
  M.setScope('bank', 'window');
  eq(M.list('bank').map(q => q.id), [a.id, b.id], 'and the window is a filter on TOP of it');
});

test('the window keeps only what was added inside it', () => {
  reset();
  const fresh = Q({ createdAt: ago(0.2) });
  const old = Q({ createdAt: ago(50) });
  M.setBank([fresh, old]);
  M.setScope('bank', 'window');
  M.setWindow('bank', 1);
  eq(M.list('bank').map(q => q.id), [fresh.id], 'the past hour');
  M.setWindow('bank', 24);
  eq(M.list('bank').map(q => q.id), [fresh.id], 'still only the fresh one at 24h');
  M.setWindow('bank', 0);
  eq(M.list('bank').length, 2, '"any time" is everything shown');
});

test('a vetting question is dated by when it was VETTED, not created', () => {
  reset();
  // The card says "Added <vettedAt>", so a window that read createdAt would
  // mean two different things on two pages that look the same.
  const q = Q({ createdAt: ago(50), vettedAt: ago(0.2) });
  M.setVetting([q]);
  M.setScope('vetting', 'window');
  M.setWindow('vetting', 1);
  eq(M.list('vetting').map(x => x.id), [q.id], 'the vetting date is the one that counts');
});

test('a question with no date at all is only ever in "any time"', () => {
  reset();
  const undated = { id: 'nodate', title: 'x', topic: 'Materials', blocks: [] };
  M.setBank([undated]);
  M.setScope('bank', 'window');
  M.setWindow('bank', 24);
  eq(M.list('bank').length, 0, 'no date means it cannot be shown to be recent');
  M.setWindow('bank', 0);
  eq(M.list('bank').length, 1, '…but "any time" still takes it');
});

test('only what this account OWNS can be written, and the rest are counted out', () => {
  reset();
  const mine = Q(), theirs = Q({ owner: 'someone-else' });
  M.setBank([mine, theirs]);
  const { mine: m, foreign } = M.owned('bank', [mine, theirs]);
  eq(m.map(q => q.id), [mine.id], 'ours');
  eq(foreign.length, 1, "another admin's — Firestore would refuse every one");
});

// ── the topic choices ───────────────────────────────────────────────────────
test('a RETIRED topic is never a target, at any level', () => {
  reset();
  // qInSyllabus keeps Cell Systems out of every practice mode and every game,
  // so filing a question into it writes one no student can ever be served.
  ok(M.choices('P5').indexOf('Cell Systems') < 0, 'not inside its own level');
  ok(M.choices('').indexOf('Cell Systems') < 0, 'not with no level chosen either');
  eq(M.choices('P5'), ['Heat', 'Electricity'], 'what is left of P5');
});

test('a level with nothing live in it falls back rather than offering none', () => {
  reset();
  M.HOOK.levels = { P3: ['Cell Systems'], P5: ['Heat'] };
  // An empty "choose from exactly this list" leaves the model nothing to
  // choose from, and a model with nothing to choose invents a topic.
  ok(M.choices('P3').length > 0, 'never empty');
  ok(M.choices('P3').indexOf('Cell Systems') < 0, 'and still never the retired one');
  M.HOOK.levels = {
    P3: ['Materials', 'Magnets'],
    P5: ['Heat', 'Electricity', 'Cell Systems'],
    P6: ['Energy', 'Forces'],
    // The reported case: a topic that names the PROCESS of science rather than
    // a body of it.
    S1: ['The Scientific Endeavour', 'Measurement and Lab Skills', 'Ray Model of Light'],
  };
});

// ── the AI pick ─────────────────────────────────────────────────────────────
test('the model is held to the level it was given', async () => {
  reset();
  M.HOOK.ai = () => ({ topic: 'Forces', confidence: 'high' });   // a P6 topic
  const r = await M.pickTopic(Q(), 'P3');
  ok(M.choices('P3').indexOf(r.topic) >= 0, 'snapped into P3, got ' + r.topic);
  eq(r.confidence, 'low', 'and flagged, because the thing that had to be guessed was guessed');
});

test('an invented topic is snapped and flagged, never written as-is', async () => {
  reset();
  M.HOOK.ai = () => ({ topic: 'Something Nobody Teaches', confidence: 'high' });
  const r = await M.pickTopic(Q(), 'P6');
  eq(r.topic, 'Energy', 'the level\'s first live topic');
  eq(r.confidence, 'low', 'a topic off the list is not an answer');
});

test('a topic that IS on the list keeps the confidence the model reported', async () => {
  reset();
  M.HOOK.ai = () => ({ topic: 'Forces', confidence: 'high' });
  eq(await M.pickTopic(Q(), 'P6'), { topic: 'Forces', topic2: '', confidence: 'high' }, 'taken at its word');
  M.HOOK.ai = () => ({ topic: 'Forces', confidence: 'low' });
  eq((await M.pickTopic(Q(), 'P6')).confidence, 'low', '…including when it says it is unsure');
});

test('the model is asked with the LEVEL\'s topics and nothing else', async () => {
  reset();
  let seen = '';
  const realAsk = M.HOOK.ai;
  M.HOOK.ai = () => ({ topic: 'Energy', confidence: 'high' });
  // The prompt itself is what carries the constraint — a call that offered the
  // whole list would re-file a P6 paper wherever the model liked.
  const body = section.slice(section.indexOf('async function aiPickTopic'), section.indexOf('function qbulkTopicsOpen'));
  ok(/qbulkTopicChoices\(level\)/.test(body), 'the choices come from the level');
  ok(/CHOOSE EXACTLY ONE OF THESE TOPICS/.test(body), 'and the prompt says so');
  await M.pickTopic(Q(), 'P6');
  M.HOOK.ai = realAsk;
});

// ── the run ─────────────────────────────────────────────────────────────────
test('re-filing writes the new topic and remembers the old one', async () => {
  reset();
  const q = Q({ topic: 'Materials' });
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => ({ topic: 'Energy', confidence: 'high' });
  M.open('bank');
  M.level('P6');
  await M.run();
  eq(q.topic, 'Energy', 'the question moved');
  eq(M.HOOK.writes.length, 1, 'one write');
  eq(M.undoStack().map(u => u.topic), ['Materials'], 'and the old topic is kept for ↩ Undo');
});

test('↩ Undo puts every one of them back', async () => {
  reset();
  const a = Q({ topic: 'Materials' }), b = Q({ topic: 'Magnets' });
  M.setBank([a, b]);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => ({ topic: 'Energy', confidence: 'high' });
  M.open('bank');
  M.level('P6');
  await M.run();
  eq([a.topic, b.topic], ['Energy', 'Energy'], 'both moved');
  await M.undo();
  eq([a.topic, b.topic], ['Materials', 'Magnets'], 'and both went back');
  eq(M.undoStack(), null, 'the stack is spent');
});

test('a SECOND topic from a HIGHER level is cleared, or the re-file is undone by it', async () => {
  reset();
  // qLevelNum takes the MAX over topic and topic2, so a P6 secondary topic left
  // behind keeps the whole question at P6 while the primary looks right.
  const q = Q({ topic: 'Materials', topic2: 'Forces' });
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => ({ topic: 'Magnets', confidence: 'high' });
  M.open('bank');
  M.level('P3');
  await M.run();
  eq(q.topic, 'Magnets', 'primary');
  eq(q.topic2, '', 'the P6 secondary topic is gone');
});

test('...but one at or BELOW the primary level is left alone', async () => {
  reset();
  const q = Q({ topic: 'Materials', topic2: 'Magnets' });
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => ({ topic: 'Materials', topic2: 'Magnets', confidence: 'high' });
  M.open('bank');
  M.level('P3');
  await M.run();
  eq(q.topic2, 'Magnets', 'it cannot raise the level, so it stays');
});

// -- the second topic: an experiment is an experiment ABOUT something --------
test('a SKILL topic gets the science it is really about as a second topic', async () => {
  reset();
  // "The Scientific Endeavour" says HOW the question is being asked and nothing
  // about WHAT it asks, so the heat in the question is nowhere in its filing
  // and it never turns up under Heat.
  const q = Q({ topic: 'Materials' });
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => ({ topic: 'The Scientific Endeavour', topic2: 'Heat', confidence: 'high' });
  M.open('bank');
  M.level('S1');
  await M.run();
  eq(q.topic, 'The Scientific Endeavour', 'the skill it tests');
  eq(q.topic2, 'Heat', 'and the science it is about -- a P5 topic under an S1 primary');
});

test('a second topic must never RAISE the level, whoever proposed it', async () => {
  reset();
  // The one way this feature could break the fix it ships beside: a topic2 from
  // a later year silently puts the whole question above the level the author
  // just asked for.
  ok(!M.secondOk('Materials', 'Forces'), 'P3 primary must not take a P6 second');
  ok(M.secondOk('Forces', 'Materials'), 'a P6 primary may take a P3 second');
  ok(M.secondOk('Forces', 'Energy'), 'and one at the same level');
  const q = Q({ topic: 'Materials' });
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => ({ topic: 'Magnets', topic2: 'Forces', confidence: 'high' });
  M.open('bank');
  M.level('P3');
  await M.run();
  ok(!q.topic2, 'the P6 proposal was refused, got ' + JSON.stringify(q.topic2));
});

test('a second topic is never another skill topic, or invented, or the same one', () => {
  reset();
  // A second PROCESS topic says nothing the first one did not -- the point of
  // the second is the science the experiment is about.
  ok(M.isProcess('The Scientific Endeavour') && M.isProcess('Measurement and Lab Skills'), 'both skill topics are known');
  ok(!M.secondOk('The Scientific Endeavour', 'Measurement and Lab Skills'), 'not a second skill topic');
  ok(!M.secondOk('Forces', 'Something Nobody Teaches'), 'not an invented one -- nothing could ever find it');
  ok(!M.secondOk('Forces', 'Cell Systems'), 'not a retired one -- no student could ever be served it');
  ok(!M.secondOk('Forces', 'Forces'), 'and not the same topic twice');
  ok(!M.secondOk('Forces', ''), 'an empty second topic is no second topic');
});

test('a question already on the right topic still GAINS a second one', async () => {
  reset();
  // The reported case is exactly this: the primary was right all along and the
  // science was nowhere in the filing. Counting it as "already right" would
  // leave every one of them exactly as it was.
  const q = Q({ topic: 'The Scientific Endeavour' });
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => ({ topic: 'The Scientific Endeavour', topic2: 'Heat', confidence: 'high' });
  M.open('bank');
  M.level('S1');
  await M.run();
  eq(q.topic2, 'Heat', 'the second topic was still written');
  eq(M.HOOK.writes.length, 1, 'and it really was a write');
});

test('...but one that is right in BOTH is left completely alone', async () => {
  reset();
  const q = Q({ topic: 'The Scientific Endeavour', topic2: 'Heat' });
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => ({ topic: 'The Scientific Endeavour', topic2: 'Heat', confidence: 'high' });
  M.open('bank');
  M.level('S1');
  await M.run();
  eq(M.HOOK.writes.length, 0, 'nothing to write');
});

test('Undo puts the second topic back too', async () => {
  reset();
  const q = Q({ topic: 'Materials', topic2: '' });
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => ({ topic: 'The Scientific Endeavour', topic2: 'Heat', confidence: 'high' });
  M.open('bank');
  M.level('S1');
  await M.run();
  eq([q.topic, q.topic2], ['The Scientific Endeavour', 'Heat'], 'both moved');
  await M.undo();
  eq([q.topic, q.topic2], ['Materials', ''], 'and both went back');
});

test('a write Firestore REFUSED does not move the in-memory copy', async () => {
  reset();
  const q = Q({ topic: 'Materials', topicConfidence: 'high' });
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.refuse = new Set([q.id]);
  M.HOOK.ai = () => ({ topic: 'Energy', confidence: 'low' });
  M.open('bank');
  M.level('P6');
  await M.run();
  eq(q.topic, 'Materials', 'the screen must not say it moved when the database says it did not');
  eq(q.topicConfidence, 'high', 'and nothing else on it was left changed either');
  eq(M.undoStack(), [], 'nothing to undo, because nothing was done');
});

test('a question already on the right topic is not written at all', async () => {
  reset();
  const q = Q({ topic: 'Energy' });
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => ({ topic: 'Energy', confidence: 'high' });
  M.open('bank');
  M.level('P6');
  await M.run();
  eq(M.HOOK.writes.length, 0, 'no write for a question that is already right');
});

test('📌 Set all writes the chosen topic with NO AI call', async () => {
  reset();
  const a = Q(), b = Q();
  M.setBank([a, b]);
  M.setScope('bank', 'shown');
  M.HOOK.fixedTopic = 'Forces';
  M.open('bank');
  await M.run('fixed');
  eq([a.topic, b.topic], ['Forces', 'Forces'], 'both set');
  eq(M.HOOK.calls, 0, 'and not one AI call — this is the blunt, predictable tool');
});

test('the writes are QUIET, so a re-file is not forty questions authored', async () => {
  reset();
  const q = Q();
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.open('bank');
  await M.run('fixed');
  eq(M.HOOK.quiet, true, 'a bank write is quiet');
  ok(M.HOOK.wkMax > 0, 'and the work-session log is suppressed for the whole run');
  eq(M.wk(), 0, '…and released again afterwards');
});

test('a vetting re-file writes through the VETTING collection', async () => {
  reset();
  const q = Q({ topic: 'Materials' });
  M.setVetting([q]);
  M.setScope('vetting', 'shown');
  M.HOOK.fixedTopic = 'Energy';
  M.open('vetting');
  await M.run('fixed');
  eq(M.HOOK.writes.map(w => w.where), ['vetting'], 'not the bank');
  eq(q.topic, 'Energy', 'and it moved');
});

test('a run releases the work-session guard even when everything fails', async () => {
  reset();
  const q = Q();
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => { throw new Error('billing cap'); };
  M.open('bank');
  await M.run();
  eq(M.wk(), 0, 'a guard left up would silence every later save in the session');
  eq(q.topic, 'Materials', 'and nothing moved');
});

test('one AI call per question, a few at a time', async () => {
  reset();
  const list = Array.from({ length: 9 }, () => Q());
  M.setBank(list);
  M.setScope('bank', 'shown');
  M.HOOK.ai = () => ({ topic: 'Energy', confidence: 'high' });
  M.open('bank');
  M.level('P6');
  await M.run();
  eq(M.HOOK.calls, 9, 'one per question — a whole batch in one reply truncates');
  ok(M.HOOK.inflight <= 3, 'at most a few at once, got ' + M.HOOK.inflight);
  ok(M.HOOK.inflight > 1, 'and they really do overlap');
});

test('a new run replaces the last one\'s undo, never stacks on it', async () => {
  reset();
  const q = Q({ topic: 'Materials' });
  M.setBank([q]);
  M.setScope('bank', 'shown');
  M.HOOK.fixedTopic = 'Energy';
  M.open('bank');
  await M.run('fixed');
  M.HOOK.fixedTopic = 'Forces';
  await M.run('fixed');
  eq(M.undoStack().length, 1, 'one entry, from the LAST run');
  eq(M.undoStack()[0].topic, 'Energy', 'stacking two would put the wrong topic back');
  await M.undo();
  eq(q.topic, 'Energy', 'undone one step, not two');
});

test('a set of another account\'s questions opens nothing and says why', () => {
  reset();
  M.setBank([Q({ owner: 'someone-else' })]);
  M.setScope('bank', 'shown');
  M.open('bank');
  eq(M.draft(), null, 'no dialog');
  ok(/another account/i.test((M.HOOK.toasts.pop() || {}).msg || ''), 'and it says so');
});

// ── 🚦 the check over a set ─────────────────────────────────────────────────
test('🚦 Check runs the SAME tlCheckMany the sheet does', async () => {
  reset();
  const list = Array.from({ length: 4 }, () => Q());
  M.setBank(list);
  M.setScope('bank', 'shown');
  await M.check('bank');
  eq((M.HOOK.checked || []).length, 4, 'every question in the set');
  // One call per question is not an optimisation waiting to happen: a whole
  // batch asked for in one reply truncates, and comes back as findings that
  // cannot be attributed to the question they belong to.
  ok(/tlCheckMany\(/.test(section), 'it is the shared runner');
  ok(!/askGemini/.test(section.slice(section.indexOf('async function qbulkCheck'), section.indexOf('// 🎯 RE-FILING TOPICS'))),
     'and it carries no prompt of its own');
});

test('a check already running is not started again', async () => {
  reset();
  M.setBank([Q()]);
  M.setScope('bank', 'shown');
  const body = section.slice(section.indexOf('async function qbulkCheck'), section.indexOf('// ====='));
  ok(/_tlMany && _tlMany\.running/.test(body), 'the guard is there');
});

test('a verdict that already stands is not re-read, and the confirm says so', () => {
  const body = section.slice(section.indexOf('async function qbulkCheck'), section.indexOf('// ====='));
  ok(/tlFresh\(q\)/.test(body), 'it counts only the unread ones');
  ok(/already have a verdict/.test(body), 'and the confirm names what it is really about to spend');
});

// ── the light filter ────────────────────────────────────────────────────────
test('the 🚦 chips filter as well as count, and stale reads as unchecked', () => {
  reset();
  const red = Q(), green = Q(), stale = Q();
  M.HOOK.lights = { [red.id]: 'red', [green.id]: 'green', [stale.id]: 'stale' };
  M.setLight('bank', '');
  ok(M.lightPasses('bank', red) && M.lightPasses('bank', green), 'no filter lets everything through');
  M.setLight('bank', 'red');
  ok(M.lightPasses('bank', red) && !M.lightPasses('bank', green), 'only the reds');
  // "Edited since it was checked" is the same grey lamp as "never checked", so
  // it has to be the same filter — two chips for one lamp would be unusable.
  M.setLight('bank', 'idle');
  ok(M.lightPasses('bank', stale), 'a stale verdict lists under ○ not checked');
});

test('the tally counts BEFORE the chip, so the chips are not one-way', () => {
  reset();
  const red = Q(), green = Q(), amber = Q();
  M.setBank([red, green, amber]);
  M.HOOK.lights = { [red.id]: 'red', [green.id]: 'green', [amber.id]: 'amber' };
  M.setScope('bank', 'shown');
  M.setLight('bank', 'red');
  // The chip narrows the PAGE — that is the whole point — but the tally has to
  // ask with it lifted, or pressing 🔴 leaves a bar reading "🔴 1" and nothing
  // else, and there is no way back to the other two.
  eq(M.list('bank').map(q => q.id), [red.id], 'the page really is narrowed');
  eq(M.unlit('bank').length, 3, 'and the tally still sees all three');
  M.setLight('bank', '');
  eq(M.unlit('bank').length, 3, '…as it does with no chip on');
});

test('the light filter is applied by BOTH pages, not just one', () => {
  const bank = src.slice(src.indexOf('function _bankFilteredQuestions'), src.indexOf('// The picture a question is recognised by'));
  ok(/qbulkLightPasses\('bank'/.test(bank), 'the bank asks it');
  const vet = src.slice(src.indexOf('function _vetVisibleQuestions'), src.indexOf('function _vetPruneSelection'));
  ok(/qbulkLightPasses\('vetting'/.test(vet), 'and so does the vetting list');
});

// ── 🖨 preview printed ──────────────────────────────────────────────────────
test('the printed preview is the SAME preview and the SAME printer', () => {
  // "exactly like the PDF" is only true if it IS the PDF's own path. A preview
  // of its own would be free to drift, and it would drift in the direction
  // nobody checks — the printed sheet, in front of a class.
  const ctx = src.slice(src.indexOf('function _wsPreviewCtx()'), src.indexOf('function openWorksheetPreview'));
  ok(/_wsPreviewAdhoc/.test(ctx), 'an ad-hoc set is a third CONTEXT, not a second renderer');
  const at = src.indexOf('async function printQuestionsDirect');
  const printer = src.slice(at, at + 700);
  ok(/doPrintStudentWorksheet\(/.test(printer), 'and it prints through the worksheet printer itself');
  // …and the render path is untouched: one builder, one planner.
  const render = src.slice(src.indexOf('async function renderWsPreview'), src.indexOf('function _wsPreviewWhenReady'));
  ok(/buildWorksheetHtml\(selected, title/.test(render), 'the preview still builds the sheet the one way');
});

test('every opener clears all THREE preview slots', () => {
  // A slot left set is a preview showing the last thing that was open — the
  // paper you previewed an hour ago, under the button you just pressed.
  const win = src.slice(src.indexOf('function openWorksheetPreview'), src.indexOf('function _wsShowPreviewOverlay'));
  ['openWorksheetPreview', 'previewQuestionsPrint', 'ppPreview', 'previewSavedWorksheet'].forEach(fn => {
    const body = src.slice(src.indexOf('function ' + fn), src.indexOf('function ' + fn) + 900);
    ok(/_wsPreviewAdhoc/.test(body), fn + ' does not clear or set the ad-hoc slot');
  });
  const close = src.slice(src.indexOf('function closeWorksheetPreview'), src.indexOf('function wsBreakBefore'));
  ok(/_wsPreviewAdhoc = null/.test(close), 'and closing clears it');
  void win;
});

test('✏️ Editing mode is offered on a BANK set and never on a vetting one', () => {
  // emSaveAll writes through saveQuestion — on a vetting question that would
  // quietly move it into the bank.
  const body = src.slice(src.indexOf('function _wsShowPreviewOverlay'), src.indexOf('function closeWorksheetPreview'));
  ok(/_wsPreviewAdhoc\.source === 'bank'/.test(body), 'the source decides it');
});

// ── the source itself ───────────────────────────────────────────────────────
test('ONE bar renderer serves both pages', () => {
  // Two renderers is two places for a change to land on one page and not the
  // other, on surfaces that are meant to look and behave alike.
  ok(/function qbulkRenderBar\(where\)/.test(section), 'one renderer');
  ok(/qbulkRenderBar\('bank'\)/.test(src), 'the bank calls it');
  ok(/qbulkRenderBar\('vetting'\)/.test(src), 'and the vetting list calls it');
});

test('the bar is rebuilt on every render, so the count is the set the eye can see', () => {
  const bank = src.slice(src.indexOf('function renderQuestionBank'), src.indexOf('// ── Grid view'));
  ok(/qbulkRenderBar\('bank'\)/.test(bank), 'from the bank renderer itself');
  const vet = src.slice(src.indexOf('function renderVettingList'), src.indexOf('// Returning to the Vetting List'));
  ok((vet.match(/qbulkRenderBar\('vetting'\)/g) || []).length >= 3,
     'including the early returns, or the bar vanishes the moment a filter empties the list');
});

test('the vetting list carries a lamp of its own', () => {
  const vet = src.slice(src.indexOf('function renderVettingList'), src.indexOf('// Returning to the Vetting List'));
  ok(/tlLightHtml\(q, 'vet'\)/.test(vet), 'every vetting card gets one');
  ok(/scope === 'vet'/.test(src), 'and the scope knows where to find the question');
  // `cqNumberOptions` reads `_docQById`, which is the BANK — on a vetting
  // question it reports "no options here" about a question that plainly has four.
  ok(/tlFixVetOptions\(/.test(src), 'and the ＃ fix writes the vetting collection');
});

// ── runner ──────────────────────────────────────────────────────────────────
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && !c.name.includes(only)) continue;
  try { await c.fn(); pass++; console.log('  ✓ ' + c.name); }
  catch (e) { fail++; console.log('  ✗ ' + c.name + '\n      ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
