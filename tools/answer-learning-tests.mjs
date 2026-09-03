// Regression tests for 🧠 LEARNING FROM THE TEACHER'S OWN CORRECTIONS — the
// loop that watches what the teacher changes about an answer this app wrote,
// asks the AI what lesson it should have known, and puts that lesson into the
// next answer. Run with:
//     node tools/answer-learning-tests.mjs
//
// It loads the REAL section out of app.js.
//
// EVERY FAILURE HERE IS SILENT, and they fall into two kinds.
//
// The first is the loop quietly not running: a correction the teacher made
// reaches no prompt, so the app makes the same mistake on the very next
// answer while the panel says the correction was learned. That is exactly the
// complaint this feature answers, arriving through its own fix.
//
// The second is worse and is what most of these cases are about: a correction
// reaching a prompt that must never see one. A correction is an ANSWER, so
//   • MARKING must never see it — that is a marker handed the answer, and it
//     starts marking a child on whether they used the teacher's wording;
//   • the CHECKER must never see it — told what phrasing the teacher prefers,
//     a second reader flags correct answers for wording, and the report then
//     reads as a clean bill of health inverted;
//   • question AUTHORING must never see it — the source document wins there,
//     and a note about answer wording has no business in it.
// Nothing on any screen would show any of that. The app answers fluently
// either way.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b) + '\n';
};

const prompt$ = cut("const STYLE_DOC = 'answerStyle';", '\n// ---- THE ONE DOOR ----', 'corrections in prompt form');
const loop$ = cut('// ---- ①  WHAT THE AI WROTE', '\n// ---- Teaching Notes page (admin only) ----', 'the loop');

// The world it runs in. Everything that touches Firestore, the DOM or a model
// is a stub that RECORDS what it was asked to do — those calls are the thing
// several of these cases are about.
const HOOK = { saved: 0, asks: [], toasts: [] };
const api = new Function(`
  const HOOK = arguments[0];
  let currentUser = { uid: 'admin1', role: 'admin' };
  let adminUid = 'admin1';
  const db = {};
  function _isAdmin() { return !!(currentUser && currentUser.role === 'admin'); }
  function stripHtml(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' '); }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function showToast(m, k) { HOOK.toasts.push(String(m)); }
  function showConfirm(t, m, fn) { fn(); }
  function notesRenderBody() {}
  const document = { getElementById: () => null };
  function doc() { return {}; }
  async function getDoc() { return { exists: () => false, data: () => null }; }
  async function setDoc(_r, d) { HOOK.saved++; HOOK.last = d; return true; }
  async function askGemini(p) { HOOK.asks.push(p); return JSON.stringify({ lesson: HOOK.lesson || '' }); }
  function _parseAIJson(s) { return JSON.parse(s); }
  ${prompt$}
  ${loop$}
  return {
    styleBlock, styleEnsure, styleEdits, styleHarvestQuestion, styleNoteGenerated,
    styleLessons, styleRecentEdits, styleWriteNotes, styleLearnedHtml, styleForget,
    styleForgetAll, _styleEditRatio, styleGen, STYLE_FIELDS, STYLE_EDIT_TRIVIAL,
    setRole(r) { currentUser = r ? { uid: 'admin1', role: r } : null; },
    reset() { aiStyle = { edits: [] }; Object.keys(styleGen).forEach(k => delete styleGen[k]); }
  };
`)(HOOK);

let ran = 0, fails = 0;
function ok(name, cond, extra) {
  ran++;
  if (cond) { console.log('  ✓ ' + name); return; }
  fails++;
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''));
}

// A correction already in the corpus, with its lesson written.
function seed() {
  api.reset();
  const st = api.styleEnsure();
  st.edits.push({
    slot: 'q1|content', q: 'Why did the water level drop?',
    wrote: 'The water went away.',
    a: 'The water evaporated — it gained heat and turned into water vapour.',
    dist: 0.8, topic: 'Heat', note: 'Always name the process, never "it went away".',
    at: '2026-09-01T00:00:00.000Z'
  });
  return st;
}

// ── ① which prompts may see a correction ────────────────────────────────────
seed();
ok('an ANSWER prompt is given the correction', /evaporated/.test(api.styleBlock('answer', 'Heat', 'water level')));
ok('…and so is an EXPLANATION', /evaporated/.test(api.styleBlock('teach', 'Heat', 'water level')));
ok('MARKING is given nothing at all', api.styleBlock('mark', 'Heat', 'water level') === '',
   'a marker handed the answer marks a child on whether they used the teacher’s wording');
ok('the CHECKER is given nothing at all', api.styleBlock('check', 'Heat', 'water level') === '',
   'told what phrasing the teacher prefers, a second reader flags correct answers for wording');
ok('question AUTHORING is given nothing at all', api.styleBlock('gen', 'Heat', 'water level') === '',
   'the source document wins there');
ok('an unknown kind is given nothing either', api.styleBlock('marks', 'Heat', 'water level') === '');

// …and the ONE door really appends it, for those kinds only.
const door = cut('function aiGrounding(kind, topic, q) {', '\n// ---- Teaching Notes page', 'the one door');
ok('aiGrounding asks styleBlock once and appends it', /const style = styleBlock\(kind, topic, q\)/.test(door));
['gen', 'answer', 'teach', 'check'].forEach(k => {
  ok('…on the ' + k + ' branch', new RegExp("kind === '" + k + "'[^\\n]*\\+ style").test(door));
});
ok('…and on the marking fallback', /_notesMarkingBlock\(topic \|\| ''\) \+ style/.test(door));

// The lesson leads and the raw pair goes LAST — nearest to the question.
seed();
const blk = api.styleBlock('answer', 'Heat', 'water level');
ok('the lesson leads and the raw correction goes last',
   blk.indexOf('Always name the process') < blk.indexOf('this app wrote:'));

// This topic's lessons lead, and the NEWEST leads inside each group.
// Reversing the concatenation instead reverses the two groups as well, which
// quietly serves another topic's lessons ahead of this one's.
api.reset();
[['Light', 'OTHER LESSON'], ['Heat', 'OLD HEAT LESSON'], ['Heat', 'NEW HEAT LESSON']]
  .forEach(([topic, note], i) => api.styleEnsure().edits.push({
    slot: 's' + i, q: 'q', wrote: 'w' + i, a: 'a' + i, dist: 0.9, topic, note, at: '' }));
const L = api.styleLessons('Heat');
ok('this topic\u2019s newest lesson leads', L[0] === 'NEW HEAT LESSON', L.join(' | '));
ok('\u2026then the rest of this topic\u2019s', L[1] === 'OLD HEAT LESSON', L.join(' | '));
ok('\u2026and another topic\u2019s is still there behind them', L[2] === 'OTHER LESSON');
api.styleEnsure().edits.push({ slot: 'dup', q: 'q', wrote: 'w', a: 'a', dist: 0.9, topic: 'Heat', note: 'NEW HEAT LESSON', at: '' });
ok('the same lesson twice is one lesson',
   api.styleLessons('Heat').filter(x => x === 'NEW HEAT LESSON').length === 1,
   'a duplicate eats the prompt twice and reads to the model as emphasis nobody wrote');

// ── ② what counts as a correction ───────────────────────────────────────────
api.reset();
api.styleNoteGenerated('b1', 'content', 'Why did it drop?', 'The water went away.');
api.styleHarvestQuestion({ id: 'q9', topic: 'Heat', blocks: [{ id: 'b1', type: 'plainanswer', content: 'The water evaporated into water vapour.' }] });
ok('a real rewrite is recorded', api.styleEdits().length === 1);
ok('…with the before, the after and the question', (() => {
  const e = api.styleEdits()[0];
  return /went away/.test(e.wrote) && /evaporated/.test(e.a) && /drop/.test(e.q) && e.topic === 'Heat';
})());

// A second pass at the SAME box supersedes rather than filing a halfway copy.
api.styleHarvestQuestion({ id: 'q9', topic: 'Heat', blocks: [{ id: 'b1', type: 'plainanswer', content: 'The water evaporated: it gained heat and became water vapour.' }] });
ok('a second pass at the same box SUPERSEDES the first', api.styleEdits().length === 1,
   'the last thing the teacher left in the box is the one that counts');
ok('…and it is the LAST wording that is kept', /became water vapour/.test(api.styleEdits()[0].a));

// Edited back to what the app wrote: the correction is withdrawn.
api.styleHarvestQuestion({ id: 'q9', topic: 'Heat', blocks: [{ id: 'b1', type: 'plainanswer', content: 'The water went away.' }] });
ok('edited back to what the app wrote, the correction is WITHDRAWN', api.styleEdits().length === 0,
   'leaving it teaches a lesson the teacher has just taken back');

// Punctuation is not a rewrite.
api.reset();
api.styleNoteGenerated('b2', 'content', 'Q', 'The water evaporated and turned into water vapour');
api.styleHarvestQuestion({ id: 'q8', blocks: [{ id: 'b2', type: 'plainanswer', content: 'The water evaporated and turned into water vapour.' }] });
ok('tidying the punctuation is not a correction', api.styleEdits().length === 0,
   'a full stop is one word in n, which is over the trivial line without the edge trim');

// Every field of a CER answer is watched on its own.
ok('a CER answer box is watched claim, evidence AND reasoning separately',
   JSON.stringify(api.STYLE_FIELDS.answer) === '["claim","evidence","reasoning"]');
api.reset();
api.styleNoteGenerated('b3', 'reasoning', 'Q', 'Because it got hot.');
api.styleHarvestQuestion({ id: 'q7', blocks: [{ id: 'b3', type: 'answer', claim: 'It evaporated', evidence: 'The level fell', reasoning: 'Because it gained heat from the surroundings and changed state.' }] });
ok('…so a teacher who fixes only the reasoning is learned from', api.styleEdits().length === 1);

// A block type no AI button fills is not a correction when it changes.
api.reset();
api.styleNoteGenerated('b4', 'content', 'Q', 'anything');
api.styleHarvestQuestion({ id: 'q6', blocks: [{ id: 'b4', type: 'text', content: 'quite different wording' }] });
ok('a text block the AI never wrote is not a correction', api.styleEdits().length === 0);

// ── ③ whose corrections are these ───────────────────────────────────────────
api.reset();
api.setRole('employee');
api.styleNoteGenerated('b5', 'content', 'Q', 'The water went away.');
api.styleHarvestQuestion({ id: 'q5', blocks: [{ id: 'b5', type: 'plainanswer', content: 'The water evaporated into vapour.' }] });
ok('only the ADMIN teaches the app', api.styleEdits().length === 0,
   'an employee writes questions into the teacher’s bank; how the AI answers for the whole centre is not theirs to rewrite');
api.setRole('admin');

// ── ④ the lesson ────────────────────────────────────────────────────────────
api.reset();
HOOK.asks = [];
HOOK.lesson = 'Name the process — say "evaporated", never "went away".';
api.styleNoteGenerated('b6', 'content', 'Why did it drop?', 'The water went away.');
api.styleHarvestQuestion({ id: 'q4', blocks: [{ id: 'b6', type: 'plainanswer', content: 'The water evaporated into water vapour.' }] });
await new Promise(r => setTimeout(r, 30));
ok('the AI is asked for the lesson', HOOK.asks.length === 1);
ok('…and it is asked about ONE correction, never a batch', HOOK.asks.length === 1 && /What the AI wrote:/.test(HOOK.asks[0]) &&
   HOOK.asks[0].split('What the AI wrote:').length === 2,
   'a lesson attributed to the wrong correction reads perfectly and teaches something the teacher never said');
ok('…and shown both halves of the difference', /went away/.test(HOOK.asks[0]) && /evaporated/.test(HOOK.asks[0]));
ok('the lesson is kept on the correction', /Name the process/.test(api.styleEdits()[0].note || ''));

// A cosmetic change has no lesson, and must not be re-asked for ever.
api.reset();
HOOK.asks = [];
HOOK.lesson = '';
api.styleNoteGenerated('b7', 'content', 'Q', 'Heat flows from the hot cup to the cold air.');
api.styleHarvestQuestion({ id: 'q3', blocks: [{ id: 'b7', type: 'plainanswer', content: 'Heat travels from the hot cup into the cold air around it.' }] });
await new Promise(r => setTimeout(r, 30));
const asked = HOOK.asks.length;
await api.styleWriteNotes();
ok('a correction the model had no lesson for is not asked about again', HOOK.asks.length === asked,
   'otherwise every save pays for the same empty answer for the rest of the account’s life');
ok('…and it is still shown to the teacher', /No lesson drawn/.test(api.styleLearnedHtml()));

// ── ⑤ the source itself ─────────────────────────────────────────────────────
ok('the harvest runs on BOTH save doors', (() => {
  const bank = cut('      if (wkLog) _wkLogQuestion(q, \'bank\');', '\n', 'bank save');
  const vet = cut('      if (wkLog) _wkLogQuestion(q, \'vetting\');', '\n', 'vetting save');
  return /styleHarvestQuestion/.test(src.slice(src.indexOf(bank), src.indexOf(bank) + 400))
      && /styleHarvestQuestion/.test(src.slice(src.indexOf(vet), src.indexOf(vet) + 400));
})(), 'the two functions every committed question goes through — hooking one is an authoring path that silently never learns');

ok('both AI writers record what they wrote', (() => {
  const ans = cut('async function aiGenerateBlockAnswer(blockId, btn) {', '\n// Delegated so the button works', 'answer button');
  const exp = cut('async function aiGenerateBlockExplanation(blockId, btn, level) {', '\n// Delegated', 'explain button');
  return /styleNoteGenerated\(/.test(ans) && /styleNoteGenerated\(/.test(exp);
})());

// What the AI wrote lives only in this session: a generation the author never
// saved is not a correction, and a page reloaded mid-edit is a change nobody
// could honestly attribute. So the written document carries the corrections
// and nothing else.
api.reset();
HOOK.saved = 0; HOOK.last = null; HOOK.lesson = '';
api.styleNoteGenerated('b8', 'content', 'Q', 'The water went away.');
api.styleHarvestQuestion({ id: 'q2', blocks: [{ id: 'b8', type: 'plainanswer', content: 'The water evaporated into water vapour.' }] });
await new Promise(r => setTimeout(r, 30));
ok('what the AI wrote is NOT persisted', HOOK.saved > 0 &&
   JSON.stringify(Object.keys(HOOK.last || {}).sort()) === '["edits","updatedAt"]' &&
   !JSON.stringify(HOOK.last).includes('styleGen') && /in memory only/.test(loop$),
   'a generation the author never saved is not a correction');

ok('the corpus is THIS app’s own document, not the Ans Key app’s',
   /const STYLE_DOC = 'answerStyle';/.test(prompt$) && /settings', STYLE_DOC/.test(loop$) && !/aiTraining/.test(loop$),
   'Ans Key teaches maths too — sharing its corpus would put a maths correction into a science answer');

ok('the corrections come down on sign-out', /stopAnswerStyle\(\)/.test(src) &&
   /try \{ stopAnswerStyle\(\); \} catch/.test(src),
   'or one account’s corrections go on grounding the next person to sign in on the device');

ok('a denied write is NAMED, not swallowed', /permission-denied/.test(loop$),
   '"could not save" reads as the feature not working; it is a one-line rules fix on users/{uid}/settings/answerStyle');

console.log('\n' + (ran - fails) + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
