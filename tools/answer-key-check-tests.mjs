// Regression tests for the 🔍 ANSWER KEY CROSS-CHECK — two engines, at once.
// Run with:
//     node tools/answer-key-check-tests.mjs            all cases
//     node tools/answer-key-check-tests.mjs <name>     one case
//
// It loads the REAL comparison block out of app.js — together with the REAL
// answer-key pushers and the REAL tokeniser it leans on — and runs them
// against a shimmed page. The models are the easy part; the dangerous part is
// the plain code that turns two answers into advice, because every way it
// breaks looks exactly like a working report:
//
//  • "DO THESE TWO AGREE" MUST BE A TEACHER'S ANSWER, and in THIS app that is
//    harder than in the Maths one, because a science answer is usually a
//    SENTENCE. Too loose and every row comes back green — the feature then
//    quietly certifies wrong keys, which is worse than not running it. Too
//    tight (two engines explaining the same science in different words scored
//    as a split) and every row is amber, which is a report nobody reads.
//  • A NUMBER IS STILL SETTLED ON ITS NUMBERS. "24 g" and "42 g" share every
//    content word and are not the same answer — the text test must never be
//    allowed to rescue a numeric disagreement.
//  • THE DIRECTION MUST BE RIGHT. "Both engines disagree with your key" and
//    "both agree" are the same three strings compared two ways round. Reverse
//    it and the advice is confidently backwards.
//  • THE ANSWER KEY MUST BE READ THE WAY THE PRINTED KEY READS IT. The engines
//    are shown, and compared against, whatever `akcStatedAnswer` extracts — so
//    it goes through the same `_pushBlockAnswerKey` the printed key uses. Read
//    the wrong half of a question and the report is confidently checking
//    something the teacher never wrote.
//  • BOTH ENGINES MUST GET THE SAME PROMPT, AND THE GEMINI CALL MUST ACTUALLY
//    BE GEMINI. askGeminiVision routes through ChatGPT when the sidebar toggle
//    says so, so without skipOpenAi the two columns are the same model twice —
//    they would then agree with each other constantly and the whole
//    cross-check means nothing.
//  • THE WINDOW MUST NOT INVENT QUESTIONS. An undated question has no date to
//    place in "the past 24 hours"; letting it in makes the count on the button
//    disagree with what gets checked.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

// The REAL answer-key pushers and the REAL tokeniser — the two pieces the
// cross-check leans on that would be worth nothing shimmed. Everything else
// below is a shim.
const keyPushers = cut('function _pushAnswerKeySection', '// A question with no answer-bearing block', 'answer key pushers');
const sanitize = cut('function sanitizeAnswerKeyHtml', '\n// How many ruled lines', 'sanitizeAnswerKeyHtml');
const snapTokens = cut('const _SNAP_STOP', '// Compact "what is being asked"', 'the tokeniser');

// Everything the block reaches out to, and nothing else. The part helpers are
// faithful miniatures of the real ones — a wrong part LABEL in a flattened key
// string is cosmetic, which is the only thing they affect here.
const FIXTURE = `
const escapeHtml = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const stripHtml = s => String(s == null ? "" : s).replace(/<[^>]*>/g, "").trim();
function qPartNormalize(p) { const s = String(p == null ? "" : p).trim().toLowerCase(); return /^[a-z]$/.test(s) ? s : ""; }
function qPartLabel(p) { const n = qPartNormalize(p); return n ? "(" + n + ")" : ""; }
function qBlockOpensPart(b) { return b && b.part ? qPartNormalize(b.part) : ""; }
function qPartUnfiled(b) { return !!(b && b.part === "-"); }
function qPartMap(blocks) {
  const m = new Map(); let cur = "";
  (blocks || []).forEach(b => { if (!b) return; const o = qBlockOpensPart(b); if (o) cur = o; m.set(b, qPartUnfiled(b) ? "" : cur); });
  return m;
}
function _cqTableRows() { return []; }
function _fbHasBlanks(b) { return !!(b && b.blanks && Object.keys(b.blanks).length); }
function _fbAnswerKeyText(b) { return (b && b.keyText) || ""; }
function transformImageUrl(u) { return u; }
function getTopicLevel(t) { return /P(\\d)/.test(String(t || "")) ? "P" + RegExp.$1 : ""; }
function qSecondaryTopic(q) { return (q && q.topic2) || ""; }
function _canAuthor() { return true; }
function showToast() {}
function confirm() { return true; }
function editQuestion() {}
function _parseAIJson(s) { return JSON.parse(s); }
const localStorage = { getItem: () => null, setItem: () => {} };
const document = { getElementById: () => null };
let geminiModel = {};
const AI_MODEL = "gemini-3.7-flash";
let openAiKey = "sk-test", openAiModel = "gpt-5.6-sol";
function getOpenAiKey() { return openAiKey; }
function getOpenAiModel() { return openAiModel; }
// The centre-wide key/model layer (see THE KEY IS THE CENTRE'S TOO in app.js):
// every ChatGPT call, this report's engine list included, reads through it.
function aiChatKey() { return getOpenAiKey(); }
function aiChatModel() { return getOpenAiModel(); }
let bankShown = [];
function _bankFilteredQuestions() { return bankShown; }
function _questionRecency(x) {
  if (x && x.createdAt) { const t = Date.parse(x.createdAt); if (!isNaN(t)) return t; }
  const m = /^q_(\\d{10,})/.exec(String((x && x.id) || ""));
  return m ? Number(m[1]) : 0;
}
let savedWorksheets = [];
function _wsSavedQuestions() { return []; }
async function _urlToDataUrlRobust() { throw new Error("no images in these tests"); }
function _parseImageDataUrl() { return null; }
async function askOpenAI() { throw new Error("not used in these tests"); }
async function askGeminiVision() { throw new Error("not used in these tests"); }
`;

const compareBlock = cut('const AKC_PAR = 3;', '// ---- running a batch', 'cross-check comparison block');
const entryBlock = cut('// ---- the two ways in', '// Shown only to an author', 'cross-check entry points');

const mk = () => new Function(FIXTURE + sanitize + keyPushers + snapTokens + compareBlock + entryBlock + `
return {
  agree: akcAnswersAgree,
  overlap: akcTextOverlap,
  units: akcUnits,
  numbers: akcNumbers,
  stated: akcStatedAnswer,
  agreesWithKey: akcAgreesWithKey,
  compare: akcCompare,
  prompt: akcPrompt,
  engines: akcEngines,
  recent: akcRecentQuestions,
  windowLabel: akcWindowLabel,
  seedBank(list) { bankShown = list; },
  noOpenAiKey() { openAiKey = ""; },
  noGemini() { geminiModel = null; },
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};
// An engine result in the shape akcAskEngine hands back.
const res = (engine, answer, over = {}) => Object.assign({
  engine, label: engine === 'openai' ? 'ChatGPT' : 'Gemini', model: 'm', ok: true,
  answer, optionNumber: null, working: '', stated: '', guide: 'ok', issues: [], confidence: 'high'
}, over);
const failed = (engine, error) => ({ engine, label: engine === 'openai' ? 'ChatGPT' : 'Gemini', model: 'm', ok: false, error, issues: [] });
// A question in THIS app's shape: the answer is a BLOCK, not a field.
const q = (over = {}) => Object.assign({
  id: 'q1', title: 'Evaporation', topic: 'P4 Heat',
  blocks: [
    { type: 'text', content: 'Why did the puddle dry up?' },
    { type: 'plainanswer', content: '24 g' }
  ]
}, over);
const mcqQ = (correct, over = {}) => Object.assign({
  id: 'q2', title: 'Which one?', topic: 'P4 Heat',
  blocks: [
    { type: 'text', content: 'Which material conducts heat best?' },
    { type: 'mcq', correctId: 'o' + correct, options: [
      { id: 'o1', text: 'wood' }, { id: 'o2', text: 'copper' }, { id: 'o3', text: 'plastic' }
    ] }
  ]
}, over);

// ── would a teacher mark these two the same? ────────────────────────────────

test('the same NUMERIC answer written two ways agrees', () => {
  const M = mk();
  ok(M.agree('24 g', '24 g'), 'identical answers');
  ok(M.agree('24', '24 g'), 'a bare number against the same number with a unit');
  ok(M.agree('$12.50', '12.50 dollars'), 'a price written two ways');
  ok(M.agree('1,200 ml', '1200 ml'), 'a thousands separator');
  ok(M.agree('3 grams', '3 g'), 'a spelt-out unit');
  ok(M.agree('The answer is 18', '18'), 'a sentence around the number');
});

test('a DIFFERENT unit is a disagreement, not a formatting difference', () => {
  const M = mk();
  ok(!M.agree('24 g', '24 kg'), 'grams against kilograms');
  ok(!M.agree('5 m', '5 cm'), 'metres against centimetres');
  ok(!M.agree('3 h', '3 min'), 'hours against minutes');
});

test('different numbers never agree, however alike the words', () => {
  // The text test must never rescue a numeric disagreement: these two
  // sentences share every content word and are not the same answer.
  const M = mk();
  ok(!M.agree('24', '42'), 'transposed digits');
  ok(!M.agree('12', '12.5'), 'a decimal');
  ok(!M.agree('The mass of the water is 24 g', 'The mass of the water is 42 g'), 'one number changed in an identical sentence');
  ok(!M.agree('It took 3 minutes', 'It took 30 minutes'), 'a tenfold difference');
});

test('a number on one side and words on the other never agree', () => {
  const M = mk();
  ok(!M.agree('24 g', 'The water evaporated'), 'a number against a sentence');
});

// ── the half the Maths app does not need: WORDED science answers ────────────

test('the same science in different words AGREES', () => {
  // Two engines answering independently never phrase it identically, and a
  // report that called every one of those a split would be unreadable.
  const M = mk();
  ok(M.agree('The water evaporated', 'Water evaporated'), 'a dropped article');
  ok(M.agree('It gains heat from the surroundings', 'It gains heat from its surroundings'), 'a pronoun');
  ok(M.agree('Evaporation', 'evaporation.'), 'case and a full stop');
  ok(M.agree('The metal is a good conductor of heat', 'Metal is a good conductor of heat'), 'an article');
});

test('a DIFFERENT science answer is a disagreement', () => {
  const M = mk();
  ok(!M.agree('The water evaporated', 'The water condensed'), 'evaporation against condensation');
  ok(!M.agree('It is a good conductor of heat', 'It is a good insulator of heat'), 'conductor against insulator');
  ok(!M.agree('Photosynthesis', 'Respiration'), 'two different processes');
});

test('an empty answer agrees with nothing', () => {
  const M = mk();
  ok(!M.agree('', '24'), 'empty against a number');
  ok(!M.agree('24', ''), 'a number against empty');
  ok(!M.agree('', ''), 'two empties — nothing was checked, so nothing agreed');
});

// ── what the question says the answer is ────────────────────────────────────

test('the key is read out of the BLOCKS, the way the printed key reads it', () => {
  const M = mk();
  eq(M.stated(q()), '24 g', 'a plain answer block');
});

test('a CER answer key carries all three parts', () => {
  const M = mk();
  const cer = q({ blocks: [
    { type: 'text', content: 'Explain.' },
    { type: 'answer', claim: 'The water evaporated', evidence: 'The level fell', reasoning: 'Heat turns water to vapour' }
  ] });
  const s = M.stated(cer);
  ok(s.includes('Claim: The water evaporated'), 'the claim: ' + s);
  ok(s.includes('Evidence: The level fell'), 'the evidence: ' + s);
  ok(s.includes('Reasoning: Heat turns water to vapour'), 'the reasoning: ' + s);
});

test('an MCQ key is its option, numbered the way the student reads it', () => {
  const M = mk();
  // Labelled and numbered by the shared printed-key pusher, so the report and
  // the printed key say the same thing.
  eq(M.stated(mcqQ(2)), 'Answer: 2. copper', 'the stated MCQ answer');
});

test('an MCQ with no correct option ticked states no answer at all', () => {
  // An authoring gap, and the report has to call it a missing key rather than
  // silently comparing against nothing.
  const M = mk();
  eq(M.stated(mcqQ(9)), '', 'a question with nothing ticked');
});

test('an MCQ is compared by OPTION NUMBER, not by the words', () => {
  const M = mk();
  const mcq = mcqQ(2);
  eq(M.agreesWithKey(mcq, res('gemini', 'anything at all', { optionNumber: 2 })), true, 'the right option');
  eq(M.agreesWithKey(mcq, res('gemini', 'copper', { optionNumber: 3 })), false, 'the wrong option, right-looking text');
});

test('a question with no stated answer agrees with nothing either way', () => {
  const M = mk();
  eq(M.agreesWithKey(q({ blocks: [{ type: 'text', content: 'Why?' }] }), res('gemini', '24 g')), null, 'no key to agree with');
});

test('a WORDED answer is settled by the engine\'s own verdict', () => {
  // The engine was shown the key and its own answer together and asked whether
  // they say the same science. No token count can make that judgement: these
  // two share almost no words and are the same answer.
  const M = mk();
  const worded = q({ blocks: [
    { type: 'text', content: 'Why did the puddle dry up?' },
    { type: 'plainanswer', content: 'The water evaporated' }
  ] });
  eq(M.agreesWithKey(worded, res('gemini', 'The liquid turned into vapour and left the surface', { stated: 'agree' })), true,
     'a paraphrase the engine itself vouched for');
  // And the other way: one flipped word the engine caught.
  eq(M.agreesWithKey(worded, res('gemini', 'The water condensed', { stated: 'disagree' })), false,
     'a contradiction the engine itself reported');
});

test('an engine verdict can never overrule ARITHMETIC', () => {
  // A model that writes 42 g and then calls the key\'s 24 g "agree" is being
  // sloppy in exactly the way this feature exists to catch.
  const M = mk();
  eq(M.agreesWithKey(q(), res('gemini', '42 g', { stated: 'agree' })), false, 'a wrong number vouched for by the engine');
  eq(M.agreesWithKey(mcqQ(2), res('gemini', 'copper', { optionNumber: 3, stated: 'agree' })), false, 'a wrong option vouched for by the engine');
});

test('an "unsure" verdict falls back to the words rather than counting either way', () => {
  const M = mk();
  const worded = q({ blocks: [
    { type: 'text', content: 'Why?' },
    { type: 'plainanswer', content: 'The water evaporated' }
  ] });
  eq(M.agreesWithKey(worded, res('gemini', 'Water evaporated', { stated: 'unsure' })), true, 'the same words');
  eq(M.agreesWithKey(worded, res('gemini', 'The water froze', { stated: 'unsure' })), false, 'different words');
});

test('a multi-part key is labelled per part', () => {
  const M = mk();
  const parts = q({ blocks: [
    { type: 'text', content: 'First bit', part: 'a' },
    { type: 'plainanswer', content: 'Evaporation' },
    { type: 'text', content: 'Second bit', part: 'b' },
    { type: 'plainanswer', content: 'Condensation' }
  ] });
  const s = M.stated(parts);
  ok(s.includes('(a)') && s.includes('(b)'), 'the parts are named: ' + s);
  ok(s.includes('Evaporation') && s.includes('Condensation'), 'both answers are there: ' + s);
});

// ── the recommendation, and which way round it points ───────────────────────

test('both engines agreeing with the key is GREEN and says do nothing', () => {
  const M = mk();
  const c = M.compare(q(), [res('openai', '24 g'), res('gemini', '24 grams')]);
  eq(c.status, 'agree', 'status');
  eq(c.tone, 'good', 'tone');
  ok(/Nothing to do/i.test(c.rec), 'the recommendation: ' + c.rec);
});

test('both engines agreeing with EACH OTHER but not the key says change the key', () => {
  // The strongest signal the report can produce, and the exact opposite of the
  // case above — reversed, it tells a teacher to change a correct key.
  const M = mk();
  const c = M.compare(q(), [res('openai', '48 g'), res('gemini', '48 g')]);
  eq(c.status, 'key-wrong', 'status');
  eq(c.tone, 'bad', 'tone');
  ok(/change the answer key/i.test(c.rec), 'the recommendation: ' + c.rec);
  ok(c.rec.includes('48 g') && c.rec.includes('24 g'), 'both answers are named: ' + c.rec);
});

test('a split where one engine backs the key is AMBER and names which', () => {
  const M = mk();
  const c = M.compare(q(), [res('openai', '24 g'), res('gemini', '48 g')]);
  eq(c.status, 'split', 'status');
  ok(/ChatGPT agrees with your key/.test(c.rec), 'the backer is named: ' + c.rec);
  ok(c.rec.includes('48 g'), 'the other answer is named: ' + c.rec);
});

test('three different answers is RED and says rework the question', () => {
  const M = mk();
  const c = M.compare(q(), [res('openai', '48 g'), res('gemini', '12 g')]);
  eq(c.status, 'split-none', 'status');
  eq(c.tone, 'bad', 'tone');
  ok(/rework/i.test(c.rec), 'the recommendation: ' + c.rec);
});

test('a flagged model answer is reported even when the answer is right', () => {
  const M = mk();
  const c = M.compare(q(), [res('openai', '24 g', { guide: 'issue' }), res('gemini', '24 g')]);
  eq(c.status, 'guide', 'status');
  eq(c.tone, 'warn', 'tone');
  ok(/model answer/i.test(c.rec), 'the recommendation: ' + c.rec);
});

test('a question with NO key is called out, with the answer to write in', () => {
  const M = mk();
  const none = q({ blocks: [{ type: 'text', content: 'Why?' }] });
  const c = M.compare(none, [res('openai', '24 g'), res('gemini', '24 g')]);
  eq(c.status, 'no-key', 'status');
  ok(c.rec.includes('24 g'), 'the agreed answer is offered: ' + c.rec);
});

test('one engine alone is never reported as agreement', () => {
  // A second opinion is the entire product. One engine matching the key is
  // reassuring, not confirmation, and the report has to say which it is.
  const M = mk();
  const c = M.compare(q(), [res('gemini', '24 g'), failed('openai', 'network problem')]);
  eq(c.status, 'single', 'status');
  ok(/no second opinion/i.test(c.rec), 'the recommendation: ' + c.rec);
});

test('one engine alone DISAGREEING with the key is still raised', () => {
  const M = mk();
  const c = M.compare(q(), [res('gemini', '48 g'), failed('openai', 'no key saved')]);
  eq(c.status, 'single', 'status');
  // One status, two colours: a lone engine AGREEING with the key is amber, a
  // lone engine contradicting it is red, and only the comparison's own tone
  // can tell them apart — which is why nothing else may re-derive it.
  eq(c.tone, 'bad', 'a lone engine contradicting the key must not be soft-pedalled');
});

test('both engines failing is reported as NOT CHECKED, never as agreement', () => {
  const M = mk();
  const c = M.compare(q(), [failed('openai', 'network problem'), failed('gemini', 'overloaded')]);
  eq(c.status, 'failed', 'status');
  ok(/Neither engine/i.test(c.rec), 'the recommendation: ' + c.rec);
  ok(c.rec.includes('network problem') && c.rec.includes('overloaded'), 'both reasons are given: ' + c.rec);
});

test('an engine that answered nothing at all does not count as an engine', () => {
  const M = mk();
  const c = M.compare(q(), [res('openai', ''), res('gemini', '24 g')]);
  eq(c.status, 'single', 'an empty answer was counted as a second opinion');
});

// ── the prompt ──────────────────────────────────────────────────────────────

test('the prompt asks the engine to answer it BEFORE reading the key', () => {
  const M = mk();
  const p = M.prompt(q(), '');
  ok(/FIRST work the question out/i.test(p), 'the independent-solve instruction is missing');
  ok(p.includes('24 g'), 'the stated answer is not in the prompt');
  ok(p.includes('Why did the puddle dry up?'), 'the question wording is not in the prompt');
});

test('the prompt tells the engine when it is answering a CER question', () => {
  const M = mk();
  const cer = q({ blocks: [
    { type: 'text', content: 'Explain.' },
    { type: 'answer', claim: 'It evaporated', evidence: 'The level fell', reasoning: 'Heat' }
  ] });
  ok(/This is a CER question/i.test(M.prompt(cer, '')), 'a CER question is not announced as one');
  ok(!/This is a CER question/i.test(M.prompt(q(), '')), 'an ordinary question was called a CER one');
});

test('an MCQ prompt numbers its options and asks for the number', () => {
  const M = mk();
  const p = M.prompt(mcqQ(2), '');
  ok(p.includes('(1) wood') && p.includes('(2) copper'), 'the options are not numbered the way the student sees them');
  ok(/optionNumber/.test(p), 'the option number is not asked for');
});

// ── which engines run ───────────────────────────────────────────────────────

test('both engines are offered when both are available', () => {
  const M = mk();
  eq(M.engines().map(e => e.id), ['openai', 'gemini'], 'the engines');
});

/* A missing DEVICE key no longer costs the second opinion: `askChatGpt` goes
   through the server's key first, so the ChatGPT column exists on a machine
   nobody has ever set up — which is the whole reason this report is worth
   running on anything but the teacher's own laptop. A route that is not there
   fails its row honestly; what must never happen is the column silently
   disappearing and the run reading as a clean bill of health from one
   engine. */
test('the ChatGPT column survives a device with no key of its own', () => {
  const M = mk();
  M.noOpenAiKey();
  eq(M.engines().map(e => e.id), ['openai', 'gemini'], 'the engines');
});

// ── the "past N hours" window ───────────────────────────────────────────────

const hoursAgo = h => new Date(Date.now() - h * 3600000).toISOString();

test('the window takes questions from inside it and leaves the rest', () => {
  const M = mk();
  M.seedBank([
    { id: 'a', createdAt: hoursAgo(0.5) },
    { id: 'b', createdAt: hoursAgo(5) },
    { id: 'c', createdAt: hoursAgo(40) }
  ]);
  eq(M.recent(1).map(x => x.id), ['a'], 'the past hour');
  eq(M.recent(6).map(x => x.id), ['a', 'b'], 'the past 6 hours');
  eq(M.recent(0).map(x => x.id), ['a', 'b', 'c'], 'any time');
});

test('an undated question is only ever in the "any time" window', () => {
  const M = mk();
  M.seedBank([{ id: 'a', createdAt: hoursAgo(1) }, { id: 'old' }]);
  eq(M.recent(24).map(x => x.id), ['a'], 'an undated question was dated by guesswork');
  eq(M.recent(0).map(x => x.id), ['a', 'old'], 'any time');
});

test('the window reads the bank as the eye sees it', () => {
  // The button counts what _bankFilteredQuestions returns, so a filtered bank
  // cannot check a question that is not on screen.
  const M = mk();
  M.seedBank([{ id: 'only', createdAt: hoursAgo(1) }]);
  eq(M.recent(24).map(x => x.id), ['only'], 'the checked set');
});

// ── the wiring, read as text ────────────────────────────────────────────────

test('both engines are asked the SAME prompt, at the same time', () => {
  ok(/Promise\.all\(engines\.map\(e =>\s*\n\s*akcAskEngine\(e, prompt, media\)/.test(src),
     'the two engines are no longer run together off one prompt');
});

test('the Gemini call really is Gemini', () => {
  // askGeminiVision routes through ChatGPT when the sidebar toggle says so —
  // without skipOpenAi both columns would be the same model twice.
  const block = cut('async function akcAskEngine', '\nasync function akcCheckQuestion', 'akcAskEngine');
  ok(/skipOpenAi: true/.test(block), 'the Gemini side can be silently answered by ChatGPT');
});

test('askGeminiVision actually honours skipOpenAi', () => {
  // The flag above is worth nothing if the function ignores it. Since the
  // three-route rebuild, honouring it means building an order of Gemini and
  // NOTHING else — a ChatGPT route left in it would answer the Gemini column.
  const block = cut('async function askGeminiVision', '\n// Convert text with', 'askGeminiVision');
  ok(/skipOpenAi = false/.test(block), 'askGeminiVision does not accept skipOpenAi');
  ok(/skipOpenAi \? \['gemini'\] : aiEngineOrder\(\)/.test(block),
     'askGeminiVision does not cut the ChatGPT routes out when skipOpenAi is set');
});

test('the ChatGPT key lives in the slots the OTHER portals read', () => {
  // The four apps are sibling folders on one GitHub Pages origin, so they
  // share a localStorage. A key pasted here has to be the key Maths reads, or
  // its cross-check silently runs with ONE engine and reports it as "no second
  // opinion" forever — which looks like a working feature.
  const block = cut('const AI_ENGINE_STORE =', '\nconst OPENAI_DEFAULT_MODEL', 'the engine store');
  ok(/sq_ai_engine/.test(block) && /sq_openai_key/.test(block), 'the shared slot names have drifted');
  ok(/sq_openai_model/.test(block) && /sq_openai_image_model/.test(block), 'the shared model slots have drifted');
});

test('no API key is committed to the app', () => {
  // These are public static sites served to every student. A key in here is a
  // key handed to the school.
  ok(!/sk-[A-Za-z0-9_-]{20,}/.test(src), 'an OpenAI-shaped secret is checked into app.js');
});

test('the report never writes an answer key', () => {
  const block = cut('const AKC_PAR = 3;', '// ---- the two ways in', 'the cross-check block');
  ok(!/saveQuestion\(|setDoc|updateDoc|deleteDoc/.test(block),
     'the cross-check writes to the database — it is a report, and a model that is confidently wrong must not be able to overwrite a key');
});

test('the key is read through the SHARED printed-key pusher', () => {
  // A second answer-reader written for this feature would be free to drift
  // from what the teacher actually prints and marks from.
  const block = cut('function akcKeySections', 'function akcStatedAnswer', 'akcKeySections');
  ok(/_pushBlockAnswerKey\(/.test(block) && /_pushAnswerKeySection\(/.test(block),
     'the cross-check has grown its own answer reader');
});

// ── runner ───────────────────────────────────────────────────────────────────

const only = process.argv[2];
let passed = 0, failed_ = 0;
for (const c of cases) {
  if (only && c.name !== only) continue;
  try { await c.fn(); console.log('  ok   ' + c.name); passed++; }
  catch (err) { console.log('  FAIL ' + c.name + '\n         ' + err.message); failed_++; }
}
console.log(`\n${passed} passed, ${failed_} failed`);
process.exit(failed_ ? 1 : 0);
