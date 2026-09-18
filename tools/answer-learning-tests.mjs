// Regression tests for 🧠 LEARNING FROM THE TEACHER'S OWN CORRECTIONS — the
// loop that watches what the teacher changes about an answer this app wrote,
// asks the AI what lesson it should have known, and puts that lesson — and the
// master profile Ans Key has distilled from the teacher's own worksheets —
// into the next answer. Run with:
//     node tools/answer-learning-tests.mjs
//
// It loads the REAL section out of app.js.
//
// EVERY FAILURE HERE IS SILENT, and they fall into two kinds.
//
// The first is the loop quietly not running: a correction the teacher made
// reaches no prompt, so the app makes the same mistake on the very next
// answer while the panel says the correction was learned. That is exactly the
// complaint this feature answers, arriving through its own fix. Since
// v1.411.0 that has three more doors: a generation that is not recorded on the
// BLOCK is a vetting card whose rewrite teaches nothing; a call site that does
// not pass the QUESTION is served whatever correction happens to be newest;
// and a save that overwrites the document whole erases the other tab's work.
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
// And the master profile's `markingStandards` — INFERRED from the teacher's
// answers, typed by nobody — must reach no prompt at all.
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
const HOOK = { saved: 0, asks: [], toasts: [], writes: [], remote: null, reply: null };
const api = new Function(`
  const HOOK = arguments[0];
  let currentUser = { uid: 'admin1', role: 'admin' };
  let adminUid = 'admin1';
  let teachingNotes = [];
  const db = {};
  function _isAdmin() { return !!(currentUser && currentUser.role === 'admin'); }
  function getTopicLevel(t) { return ({ Heat: 'P5', Light: 'P4', Cells: 'S1' })[t] || 'P6'; }
  function stripHtml(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' '); }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function showToast(m, k) { HOOK.toasts.push(String(m)); }
  function showConfirm(t, m, fn) { fn(); }
  function notesRenderBody() {}
  const document = { getElementById: () => null };
  function doc() { return Array.from(arguments).slice(1).join('/'); }
  async function getDoc(ref) {
    if (HOOK.remote && /settings\\/answerStyle$/.test(ref)) return { exists: () => true, data: () => HOOK.remote };
    return { exists: () => false, data: () => null };
  }
  async function setDoc(ref, d) { HOOK.saved++; HOOK.last = d; HOOK.writes.push({ ref, d }); return true; }
  async function askGemini(p) { HOOK.asks.push(p); return JSON.stringify(HOOK.reply || { lesson: HOOK.lesson || '' }); }
  function _parseAIJson(s) { return JSON.parse(s); }
  ${prompt$}
  ${loop$}
  return {
    styleBlock, styleEnsure, styleEdits, styleEditsAll, styleHarvestQuestion, styleNoteGenerated,
    styleLessons, styleRecentEdits, styleExemplarsFor, styleProfilePick, styleWriteNotes,
    styleLearnedHtml, styleForget, styleForgetAll, stylePromoteLesson, styleSave, styleTrim,
    _styleEditRatio, _styleOverlap, _styleStamp, _styleStampBlocks, _styleMergeEdits,
    styleGen, STYLE_FIELDS, STYLE_EDIT_TRIVIAL, STYLE_TRIM_MARK, STYLE_EDITS_MAX,
    get notes() { return teachingNotes; },
    set master(v) { _akStyle = v; },
    setRole(r) { currentUser = r ? { uid: 'admin1', role: r } : null; },
    reset() {
      aiStyle = { edits: [] }; _akStyle = null; teachingNotes = [];
      [styleGen, _styleSeen, _styleDropped].forEach(o => Object.keys(o).forEach(k => delete o[k]));
    }
  };
`)(HOOK);

let ran = 0, fails = 0;
function ok(name, cond, extra) {
  ran++;
  if (cond) { console.log('  ✓ ' + name); return; }
  fails++;
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''));
}
const tick = () => new Promise(r => setTimeout(r, 30));
function resetHook() { HOOK.saved = 0; HOOK.asks = []; HOOK.toasts = []; HOOK.writes = []; HOOK.remote = null; HOOK.reply = null; HOOK.lesson = ''; HOOK.last = null; }

// A correction already in the corpus, with its lesson written.
function seed() {
  api.reset();
  const st = api.styleEnsure();
  st.edits.push({
    slot: 'q1|content', q: 'Why did the water level drop?',
    wrote: 'The water went away.',
    a: 'The water evaporated — it gained heat and turned into water vapour.',
    dist: 0.8, topic: 'Heat', lvl: 'p5', sub: 'science', src: 'cer',
    note: 'Always name the process, never "it went away".',
    at: '2026-09-01T00:00:00.000Z'
  });
  return st;
}
// Ans Key's master corpus, as the contract describes it.
function master() {
  return {
    samples: [
      { k: 's1', src: 'typed', q: 'Why does the puddle disappear on a hot day?', a: 'The water gains heat from the surroundings and evaporates into water vapour.', lvl: 'p5', sub: 'science', at: '2026-08-01' },
      { k: 's2', src: 'typed', q: 'Why does the bulb light up?', a: 'The circuit is closed so current flows through the bulb.', lvl: 'p5', sub: 'science', at: '2026-08-02' },
      { k: 's3', src: 'typed', q: 'Find the area of the rectangle.', a: '24 cm²', lvl: 'p5', sub: 'math', at: '2026-08-03' }
    ],
    edits: [
      { k: 'e1', q: 'Why does ice melt?', wrote: 'It gets warm.', a: 'The ice gains heat from the surroundings and melts.', dist: 0.7, lvl: 'p4', sub: 'science', note: 'State where the heat comes from.', at: '2026-08-05' },
      { k: 'e2', q: 'Share $60 in the ratio 1:2.', wrote: '20 and 40', a: '$20 and $40', dist: 0.5, lvl: 'p5', sub: 'math', note: 'Always write the unit on a money answer.', at: '2026-08-06' }
    ],
    profiles: {
      _global: { styleRules: 'GLOBAL RULES', phrasing: 'global phrasing', markingStandards: 'SECRET STANDARD', keywords: ['gains heat'], fixes: ['Name the process.'], n: 90 },
      'any:science': { styleRules: 'SCIENCE RULES', phrasing: 'science phrasing', markingStandards: 'SECRET STANDARD', keywords: ['water vapour'], fixes: ['State the direction of heat flow.'], n: 60 },
      'p5:science': { styleRules: 'P5 SCIENCE RULES', phrasing: 'p5 phrasing', markingStandards: 'SECRET STANDARD', keywords: ['evaporate'], fixes: [], n: 40 }
    },
    profile: { styleRules: 'GLOBAL RULES', phrasing: 'global phrasing', markingStandards: 'SECRET STANDARD', keywords: ['gains heat'], n: 90 }
  };
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
ok('this topic’s newest lesson leads', L[0] === 'NEW HEAT LESSON', L.join(' | '));
ok('…then the rest of this topic’s', L[1] === 'OLD HEAT LESSON', L.join(' | '));
ok('…and another topic’s is still there behind them', L[2] === 'OTHER LESSON');
api.styleEnsure().edits.push({ slot: 'dup', q: 'q', wrote: 'w', a: 'a', dist: 0.9, topic: 'Heat', note: 'NEW HEAT LESSON', at: '' });
ok('the same lesson twice is one lesson',
   api.styleLessons('Heat').filter(x => x === 'NEW HEAT LESSON').length === 1,
   'a duplicate eats the prompt twice and reads to the model as emphasis nobody wrote');

// ── ② the master profile (document A) ───────────────────────────────────────
seed();
api.master = master();
const withMaster = api.styleBlock('answer', 'Heat', 'Why did the puddle dry up on a hot day?');
ok('the level’s own profile is picked when its bucket has enough samples',
   api.styleProfilePick('Cells').via === 'any:science' && /SCIENCE RULES/.test(withMaster) === true,
   'p5:science has 2 samples in A.samples, under the 30 floor, so it falls to any:science');
{
  const m = master();
  for (let i = 0; i < 40; i++) m.samples.push({ k: 'x' + i, q: 'q' + i, a: 'a' + i, lvl: 'p5', sub: 'science' });
  api.master = m;
  ok('…and IS picked once the bucket rests on 30 of the teacher’s answers',
     api.styleProfilePick('Heat').via === 'p5:science' && /P5 SCIENCE RULES/.test(api.styleBlock('answer', 'Heat', 'q')));
  // No samples held → the bucket profile's own `n` is the count, so it has
  // to be under the floor for the chain to fall through to the global one.
  const g = master(); delete g.profiles['any:science']; g.samples = []; g.profiles['p5:science'].n = 5;
  api.master = g;
  ok('…with no subject profile the GLOBAL one stands in',
     api.styleProfilePick('Heat').via === '_global' && /GLOBAL RULES/.test(api.styleBlock('answer', 'Heat', 'q')));
  const bare = master(); delete bare.profiles; bare.samples = [];
  api.master = bare;
  ok('…or the mirrored `profile` when there is no profiles map at all', /GLOBAL RULES/.test(api.styleBlock('answer', 'Heat', 'q')));
}
api.master = master();
ok('the exemplars are RETRIEVED for the question by Jaccard overlap', (() => {
  const ex = api.styleExemplarsFor('Why did the puddle dry up on a hot day?', 'Heat');
  return ex.length === 2 && /puddle/.test(ex[0].q) && /bulb/.test(ex[1].q);
})(), 'retrieved by the question, not by which sample happens to be newest');
ok('a MATHS sample is never served as a science exemplar', !api.styleExemplarsFor('area of the rectangle', 'Heat').some(s => /rectangle/.test(s.q)),
   'Ans Key teaches maths too; a maths answer in a science prompt is the wrong voice');
ok('a MATHS correction is never served as a science lesson', !api.styleLessons('Heat').some(s => /money/.test(s)) && api.styleLessons('Heat').some(s => /heat comes from/.test(s)),
   'Ans Key’s science edits are served; its maths ones are not');
ok('the overlap is JACCARD, over the union', (() => {
  const v = api._styleOverlap('conductor heat metal spoon', 'insulator heat metal spoon');
  return Math.abs(v - 3 / 5) < 1e-9;
})(), 'over the shorter side "conductor" and "insulator" answers score 0.75 and read as agreeing');
ok('the profile’s inferred marking standards reach NO prompt', !/SECRET STANDARD/.test(withMaster) && !/SECRET STANDARD/.test(api.styleBlock('teach', 'Heat', 'q')),
   'a standard nobody typed must never decide anything');
ok('the heading names the bucket and the correction count', /p5:science/.test(withMaster) && /learned from \d+ correction/.test(withMaster));
ok('rules, exemplars, fixes, lessons then pairs — pairs LAST', (() => {
  const i = k => withMaster.indexOf(k);
  return i('SCIENCE RULES') < i('ANSWERS THIS TEACHER WROTE') && i('ANSWERS THIS TEACHER WROTE') < i('keep having to fix')
    && i('keep having to fix') < i('do not make these mistakes') && i('do not make these mistakes') < i('this app wrote:');
})());
ok('the style block is EMPTY when the master is missing and nothing has been learned', (api.reset(), api.styleBlock('answer', 'Heat', 'q') === ''));
ok('the master is READ live and never written', (() => {
  const whole = prompt$ + loop$;
  return /onSnapshot\(doc\(db, 'users', uid, STYLE_MASTER_COL, STYLE_DOC\)/.test(whole)
    && !/setDoc\([^;]*STYLE_MASTER_COL/.test(whole) && /const STYLE_MASTER_COL = 'aiTraining'/.test(prompt$);
})(), 'document A is Ans Key’s; this app reads it and writes only its own settings/answerStyle');
ok('the master listener comes down with the corpus', /function stopAnswerStyle\(\)[\s\S]*?_akStyleDetach\(\)/.test(loop$));
ok('a long text is cut on a word and SAYS so', (() => {
  const t = api.styleTrim('one two three four five six seven eight nine ten eleven twelve', 40);
  return t === 'one two three four five six' + api.STYLE_TRIM_MARK && t.length <= 40
    && api.styleTrim('short', 40) === 'short';
})(), 'a silent truncation reads to the model as a sentence the teacher wrote that way');

// ── ③ what counts as a correction ───────────────────────────────────────────
api.reset(); resetHook();
api.styleNoteGenerated('b1', 'content', 'Why did it drop?', 'The water went away.');
api.styleHarvestQuestion({ id: 'q9', topic: 'Heat', blocks: [{ id: 'b1', type: 'plainanswer', content: 'The water evaporated into water vapour.' }] });
ok('a real rewrite is recorded', api.styleEdits().length === 1);
ok('…with the before, the after and the question', (() => {
  const e = api.styleEdits()[0];
  return /went away/.test(e.wrote) && /evaporated/.test(e.a) && /drop/.test(e.q) && e.topic === 'Heat';
})());
ok('…and it carries the level, the subject and whose it is', (() => {
  const e = api.styleEdits()[0];
  return e.lvl === 'p5' && e.sub === 'science' && e.src === 'cer';
})(), 'the contract every other reader builds its buckets from');

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

// ── ④ the generation lives ON THE BLOCK, so a vetting card rewritten a day
//      later still counts ──────────────────────────────────────────────────────
api.reset();
{
  const b = { id: 'b9', type: 'plainanswer', content: 'The water went away.' };
  api.styleNoteGenerated('b9', 'content', 'Why did it drop?', 'The water went away.', b);
  ok('styleNoteGenerated stamps the block as well as the session', !!(b.aiWrote && b.aiWrote.content && /went away/.test(b.aiWrote.content.wrote) && /drop/.test(b.aiWrote.content.q)));
}
api.reset();   // a new tab, a new day: styleGen is empty
api.styleHarvestQuestion({ id: 'q10', topic: 'Heat', blocks: [{
  id: 'b10', type: 'plainanswer', content: 'The water evaporated into water vapour.',
  aiWrote: { content: { q: 'Why did it drop?', wrote: 'The water went away.', at: '2026-09-01T00:00:00.000Z' } }
}] });
ok('a rewrite of what the block SAYS the AI wrote is a correction, with no session record at all', api.styleEdits().length === 1 && /went away/.test(api.styleEdits()[0].wrote),
   'this is what makes a vetting card built by ⚡ Rapid add and rewritten tomorrow teach anything');
ok('…and a CER block is read field by field off the stamp', (() => {
  api.reset();
  api.styleHarvestQuestion({ id: 'q11', topic: 'Heat', blocks: [{
    id: 'b11', type: 'answer', claim: 'It evaporated', evidence: 'The level fell', reasoning: 'It gained heat from the surroundings and changed state.',
    aiWrote: { reasoning: { q: 'Q', wrote: 'Because it got hot.', at: '2026-09-01' }, claim: { q: 'Q', wrote: 'It evaporated', at: '2026-09-01' } }
  }] });
  return api.styleEdits().length === 1 && /got hot/.test(api.styleEdits()[0].wrote);
})());
ok('the ONE builder every AI authoring path goes through stamps every answer and explanation box', (() => {
  const b = cut('function buildBlocksFromAi(data) {', '\n// Build a full pending question object', 'buildBlocksFromAi');
  return /_styleStampBlocks\(blocks, qHint\)/.test(b) && b.indexOf('_styleStampBlocks') < b.indexOf('return { blocks: qApplyAiParts(blocks)');
})(), '⚡ Rapid add, 📄 Exam Paper, the bulk import, 🗂️ Custom Paper, 🔄 Regenerate and the auto-check repair all go through it');
ok('…and so does the per-part explanation filler', (() => {
  const f = cut('async function aiWritePartExplanations(q, opts) {', '\nfunction qPartOf(', 'aiWritePartExplanations');
  return /_styleStamp\(nb, 'content'/.test(f);
})());
{
  const list = [
    { id: 't1', type: 'text', content: 'Why does the puddle disappear?' },
    { id: 'a1', type: 'plainanswer', content: 'It <b>evaporates</b>.' },
    { id: 'e1', type: 'explanation', content: 'Heat from the sun.' },
    { id: 'i1', type: 'image', url: '' }
  ];
  api._styleStampBlocks(list, 'Why does the puddle disappear?');
  ok('the stamp carries the question, the wording (HTML stripped) and a time', (() => {
    const a = list[1].aiWrote && list[1].aiWrote.content, e = list[2].aiWrote && list[2].aiWrote.content;
    return a && /evaporates/.test(a.wrote) && !/<b>/.test(a.wrote) && /puddle/.test(a.q) && a.at && e && /Heat from the sun/.test(e.wrote) && !list[0].aiWrote && !list[3].aiWrote;
  })());
}
ok('a QUIET save harvests nothing', (() => {
  api.reset();
  const blocks = [{ id: 'b12', type: 'plainanswer', content: 'The water evaporated.', aiWrote: { content: { q: 'Q', wrote: 'The water went away.', at: '2026-09-01' } } }];
  api.styleHarvestQuestion({ id: 'q12', topic: 'Heat', blocks }, { quiet: true });
  return api.styleEdits().length === 0;
})(), 'the usage backfill, the auto-tagger and a bulk re-file are housekeeping, not the teacher rewriting an answer');
ok('…and both save doors say whether they are quiet', (() => {
  const bank = cut("      if (wkLog) _wkLogQuestion(q, 'bank');", '\n      // Every other window', 'bank save');
  const vet = cut("      if (wkLog) _wkLogQuestion(q, 'vetting');", '\n      _xtAnnounceQuestion', 'vetting save');
  return /styleHarvestQuestion\(q, \{ quiet: quiet \|\| _wkSuppress > 0 \}\)/.test(bank) && /styleHarvestQuestion\(q, \{ quiet: !wkLog \}\)/.test(vet);
})());

// ── ⑤ whose corrections are these ───────────────────────────────────────────
api.reset();
api.setRole('employee');
api.styleNoteGenerated('b5', 'content', 'Q', 'The water went away.');
api.styleHarvestQuestion({ id: 'q5', blocks: [{ id: 'b5', type: 'plainanswer', content: 'The water evaporated into vapour.' }] });
ok('only the ADMIN teaches the app', api.styleEdits().length === 0,
   'an employee writes questions into the teacher’s bank; how the AI answers for the whole centre is not theirs to rewrite');
api.setRole('admin');

// ── ⑥ the question is PASSED, so the retrieval is not dead ──────────────────
ok('both AI buttons hand the question to the grounding', (() => {
  const ans = cut('async function aiGenerateBlockAnswer(blockId, btn) {', '\n// Delegated so the button works', 'answer button');
  const exp = cut('async function aiGenerateBlockExplanation(blockId, btn, level) {', '\n// Delegated', 'explain button');
  return /aiGrounding\('answer', topic, askedAbout\)/.test(ans) && /aiGrounding\('teach', topic, askedAbout\)/.test(exp)
    && ans.indexOf('const askedAbout') < ans.indexOf("aiGrounding('answer'");
})(), 'without it the exemplars and the raw corrections are whatever happens to be newest');
ok('both AI writers record what they wrote, on the block', (() => {
  const ans = cut('async function aiGenerateBlockAnswer(blockId, btn) {', '\n// Delegated so the button works', 'answer button');
  const exp = cut('async function aiGenerateBlockExplanation(blockId, btn, level) {', '\n// Delegated', 'explain button');
  return /styleNoteGenerated\(block\.id, f, askedAbout, block\[f\], block\)/.test(ans) && /styleNoteGenerated\(block\.id, 'content', askedAbout, block\.content, block\)/.test(exp);
})());

// ── ⑦ the lesson ────────────────────────────────────────────────────────────
api.reset(); resetHook();
HOOK.lesson = 'Name the process — say "evaporated", never "went away".';
api.styleNoteGenerated('b6', 'content', 'Why did it drop?', 'The water went away.');
api.styleHarvestQuestion({ id: 'q4', topic: 'Heat', blocks: [{ id: 'b6', type: 'plainanswer', content: 'The water evaporated into water vapour.' }] });
await tick();
ok('the AI is asked for the lesson', HOOK.asks.length === 1);
ok('…and it is asked about ONE correction, never a batch', HOOK.asks.length === 1 && /What the AI wrote:/.test(HOOK.asks[0]) &&
   HOOK.asks[0].split('What the AI wrote:').length === 2,
   'a lesson attributed to the wrong correction reads perfectly and teaches something the teacher never said');
ok('…and shown both halves of the difference', /went away/.test(HOOK.asks[0]) && /evaporated/.test(HOOK.asks[0]));
ok('…and asked which KIND it is', /"kind":"style"\|"fact"\|"cosmetic"/.test(HOOK.asks[0]) && /sameAs/.test(HOOK.asks[0]));
ok('the lesson is kept on the correction', /Name the process/.test(api.styleEdits()[0].note || '') && api.styleEdits()[0].noteKind === 'style');

// A cosmetic change has no lesson, and must not be re-asked for ever.
api.reset(); resetHook();
api.styleNoteGenerated('b7', 'content', 'Q', 'Heat flows from the hot cup to the cold air.');
api.styleHarvestQuestion({ id: 'q3', blocks: [{ id: 'b7', type: 'plainanswer', content: 'Heat travels from the hot cup into the cold air around it.' }] });
await tick();
const asked = HOOK.asks.length;
await api.styleWriteNotes();
ok('a correction the model had no lesson for is not asked about again', HOOK.asks.length === asked,
   'otherwise every save pays for the same empty answer for the rest of the account’s life');
ok('…it is filed as cosmetic and still shown to the teacher', api.styleEdits()[0].noteKind === 'cosmetic' && /No lesson drawn/.test(api.styleLearnedHtml()));

// The same lesson twice is filed under the SAME text — `sameAs`.
seed(); resetHook();
HOOK.reply = { lesson: 'Name the process instead of saying it went away.', kind: 'style', sameAs: 0 };
api.styleNoteGenerated('b13', 'content', 'Why did the level fall?', 'The water went off somewhere.');
api.styleHarvestQuestion({ id: 'q13', topic: 'Heat', blocks: [{ id: 'b13', type: 'plainanswer', content: 'The water evaporated into water vapour.' }] });
await tick();
ok('the lesson call is shown the lessons already learned', /Lessons already learned:\n0\. Always name the process/.test(HOOK.asks[0] || ''));
ok('`sameAs` files the correction under the EXACT existing text, not the model’s rewording', (() => {
  const e = api.styleEdits().find(x => x.slot === 'q13:b13|content');
  return e && e.note === 'Always name the process, never "it went away".' && e.noteKind === 'style';
})(), 'recurrence is counted by exact text — three paraphrases are three lessons, not one lesson ×3');
ok('…so the panel counts it ×2 and offers a house rule', /×2/.test(api.styleLearnedHtml()) && /Make it a house rule/.test(api.styleLearnedHtml()));

// A FACT is a teaching note, not a style lesson.
api.reset(); resetHook();
HOOK.reply = { lesson: 'Ice melts at 0 °C, not at 100 °C.', kind: 'fact', sameAs: null };
api.styleNoteGenerated('b14', 'content', 'At what temperature does ice melt?', 'Ice melts at 100 °C.');
api.styleHarvestQuestion({ id: 'q14', topic: 'Heat', blocks: [{ id: 'b14', type: 'plainanswer', content: 'Ice melts at 0 °C.' }] });
await tick();
ok('a corrected FACT is written to the teaching notes', (() => {
  const w = HOOK.writes.find(x => /teachingNotes\//.test(x.ref));
  return w && w.d.source === 'cer' && w.d.noteKind === 'correction' && /Correct answer: Ice melts at 0/.test(w.d.keyFacts)
    && w.d.guidance === '' && w.d.sourceQuestion === 'At what temperature does ice melt?'
    && JSON.stringify(w.d.subjects) === '["science"]' && JSON.stringify(w.d.levels) === '["P5"]'
    && w.d.markingStandards === '' && JSON.stringify(w.d.topics) === '[]' && /^Correction: /.test(w.d.title);
})(), 'the same shape quickNoteSave writes, so every digest here and the three other apps read it');
ok('…and NOT kept as a style lesson', api.styleEdits()[0].note === '' && api.styleEdits()[0].noteKind === 'fact' && api.styleLessons('Heat').length === 0,
   'a fact served as a habit tells the model to state it everywhere');
ok('…and the panel says where it went', /Filed in your teaching notes/.test(api.styleLearnedHtml()));

// ── ⑧ recurrence → house rule ───────────────────────────────────────────────
seed(); resetHook();
api.styleEnsure().edits.push({ slot: 'q2|content', q: 'Why did the ice melt?', wrote: 'It got warm.', a: 'It gained heat from the surroundings and melted.', dist: 0.7, topic: 'Heat', lvl: 'p5', sub: 'science', note: 'Always name the process, never "it went away".', at: '2026-09-02T00:00:00.000Z' });
await api.stylePromoteLesson('Always name the process, never "it went away".');
ok('📌 writes the lesson as a standing instruction', (() => {
  const w = HOOK.writes.find(x => /teachingNotes\//.test(x.ref));
  return w && w.d.guidance === 'Always name the process, never "it went away".' && w.d.noteKind === 'guidance' && w.d.source === 'cer' && api.notes.length === 1;
})(), 'the quick note reaches EVERY prompt, marking included');
ok('…marks those corrections promoted, so the button is not offered again', api.styleEdits().every(e => e.promoted) && /House rule/.test(api.styleLearnedHtml()) && !/Make it a house rule/.test(api.styleLearnedHtml()));
ok('…and a promoted lesson is no longer repeated in the style block', api.styleLessons('Heat').length === 0,
   'it reaches the prompt through the guidance now; served twice it reads as emphasis nobody wrote');
api.setRole('student'); resetHook();
await api.stylePromoteLesson('anything');
ok('a student cannot make a house rule, in the HANDLER', HOOK.writes.length === 0 && HOOK.toasts.length === 1);
api.setRole('admin');

// ── ⑨ the store ─────────────────────────────────────────────────────────────
api.reset(); resetHook();
api.styleNoteGenerated('b8', 'content', 'Q', 'The water went away.');
api.styleHarvestQuestion({ id: 'q2', topic: 'Heat', blocks: [{ id: 'b8', type: 'plainanswer', content: 'The water evaporated into water vapour.' }] });
await tick();
ok('document C carries the version, the edits and a stamp — never the session record or the master', HOOK.saved > 0 &&
   JSON.stringify(Object.keys(HOOK.writes[0].d).sort()) === '["edits","updatedAt","v"]' && HOOK.writes[0].d.v === 2 &&
   !JSON.stringify(HOOK.writes[0].d).includes('styleGen') && /settings\/answerStyle$/.test(HOOK.writes[0].ref));
ok('the corpus is THIS app’s own document, not the Ans Key app’s',
   /const STYLE_DOC = 'answerStyle';/.test(prompt$) && /settings', STYLE_DOC/.test(loop$),
   'Ans Key teaches maths too — its corpus is READ and never written');

// Two admin tabs: the document is READ, MERGED and written, never overwritten.
api.reset(); resetHook();
api.styleEnsure().edits.push({ slot: 'mine', q: 'q', wrote: 'w', a: 'a', dist: 0.5, note: 'MINE', at: '2026-09-02T00:00:00.000Z' });
HOOK.remote = { v: 2, edits: [
  { slot: 'theirs', q: 'q', wrote: 'w2', a: 'a2', dist: 0.5, note: 'THEIRS', at: '2026-09-03T00:00:00.000Z' },
  { slot: 'mine', q: 'q', wrote: 'w', a: 'a', dist: 0.5, note: 'OLDER COPY', at: '2026-09-01T00:00:00.000Z' }
] };
await api.styleSave();
ok('a save UNIONS the other tab’s corrections in, by slot', (() => {
  const w = HOOK.writes.find(x => /settings\/answerStyle$/.test(x.ref));
  const slots = w ? w.d.edits.map(e => e.slot).sort().join(',') : '';
  return slots === 'mine,theirs';
})(), 'a whole-document overwrite from a tab that loaded an hour ago throws away every correction made beside it');
ok('…and the NEWER copy of a slot wins', api.styleEdits().find(e => e.slot === 'mine').note === 'MINE');
ok('…but a correction FORGOTTEN here is not put back by the other tab', (() => {
  api.styleForget('theirs');
  return !api.styleEdits().some(e => e.slot === 'theirs');
})());
await tick();
ok('the merge is capped at the document’s size', api._styleMergeEdits(
  Array.from({ length: 130 }, (_, i) => ({ slot: 's' + i, wrote: 'w', a: 'a', at: '2026-01-' + String(100 + i) })), [], {}, '').length === api.STYLE_EDITS_MAX);

ok('the corrections come down on sign-out', /stopAnswerStyle\(\)/.test(src) &&
   /try \{ stopAnswerStyle\(\); \} catch/.test(src),
   'or one account’s corrections go on grounding the next person to sign in on the device');

ok('a denied write is NAMED, not swallowed', /permission-denied/.test(loop$),
   '"could not save" reads as the feature not working; it is a one-line rules fix on users/{uid}/settings/answerStyle');

ok('the style block is on the ledger the Teaching Notes page reads', /_notesLedger\.style = \{ chars: out\.length/.test(prompt$) &&
   /style: sc/.test(cut('function notesLedgerCounts() {', '\n}', 'ledger counts')) && /styleLine/.test(cut('function notesRenderBody() {', '<div class="tn-upload">', 'notes page')),
   'a block quietly added to every answer prompt is a cost nobody can see');

console.log('\n' + (ran - fails) + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
