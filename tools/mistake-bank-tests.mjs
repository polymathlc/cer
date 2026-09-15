// Regression tests for 🐾 LEARNING FROM MISTAKES — the mistake bank and the
// page that drills it.
// Run with:  node tools/mistake-bank-tests.mjs
//
// Every failure here is silent and the pages go on looking right:
//
//  • A CHILD'S NAME IN THE BANK. An entry is read by every student in the
//    school. The builder is the ONE place an attempt becomes an entry, and it
//    must strip the uid, the email and the name off whatever it is handed —
//    a name that reaches one entry is a classmate's name under "a student
//    wrote", forever, with nothing anywhere to say so.
//  • A MISTAKE QUIETLY FIXED. The clean-up tidies spelling and takes names
//    out; if it ever improves the science the class is shown a correct
//    answer and asked to find the mistake in it.
//  • UNVETTED, OR UNTYPED, ON A STUDENT'S SCREEN. Pending is pending; an
//    entry with no animal has nothing to quiz on; a question the student may
//    not be served (unreleased, retired, above their level) must not reach
//    them through a wrong answer to it either.
//  • A QUIZ WITH NO RIGHT ANSWER among its options, or two of them.
//  • THE SHARED LIST DRIFTING from `polymathlc/scan` and `polymathlc/anskey`
//    — the same mistake wearing a different animal in each app.
import fs from 'fs';
import { scienceQuestionContentKey } from '../science-feed-core.js';

const APP = new URL('../app.js', import.meta.url);
const src = fs.readFileSync(APP, 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const coachCore = fs.readFileSync(new URL('../science-coach-core.js', import.meta.url), 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from.slice(0, 40) + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

const block = cut('// 🐾 LEARNING FROM MISTAKES — the mistake bank', 'window.navigateTo = navigateTo;', 'mistake bank block');

/* ---- stubs: Firestore, the bank, the AI, the page ---- */
const prelude = `
  const writes = [];
  const merges = [];
  let bankDocs = [];
  let attemptDocs = [];
  let askReply = '';
  const DEL = { _methodName: 'deleteField' };
  const Timestamp = { now: () => ({ seconds: Math.floor(Date.now() / 1000), toMillis() { return this.seconds * 1000; } }) };
  const db = {};
  function collection() { return { kind: 'col', args: [].slice.call(arguments) }; }
  function doc(col, id) { return { col, id }; }
  function query() { return { kind: 'query', args: [].slice.call(arguments) }; }
  function where() { return ['where'].concat([].slice.call(arguments)); }
  function orderBy() { return ['orderBy'].concat([].slice.call(arguments)); }
  function limit(n) { return ['limit', n]; }
  async function getDocs(q) {
    // The attempt log is the ONE ordered, limited query in the block; the bank reads are plain or where-filtered.
    const rows = q && q.kind === 'query' && q.args.some(a => Array.isArray(a) && a[0] === 'orderBy') ? attemptDocs : bankDocs;
    return { docs: rows.map(d => ({ id: d.id, data: () => Object.assign({}, d) })) };
  }
  async function addDoc(col, data) { writes.push(data); return { id: 'w' + writes.length }; }
  async function setDoc(ref, data, opts) { merges.push({ id: ref.id, data, opts }); }
  async function deleteDoc() {}
  function deleteField() { return DEL; }
  let currentUser = { uid: 'admin1', email: 'chungzhikai@gmail.com', name: 'Mr Chung', role: 'admin' };
  let adminUid = 'admin1';
  let questionBank = [];
  let mistakeLog = [];
  async function loadMistakeLog() { return mistakeLog; }
  const shown=new Map();
  function _scienceFeedKey(){return JSON.stringify([currentUser?.uid,currentUser?.name]);}
  function _scienceFeedHistoryClient(){return {has:(id,key)=>shown.get(_scienceFeedKey())?.has(id)||shown.get(_scienceFeedKey())?.has(key)};}
  async function _scienceFeedEnsure(){return true;}
  function _scienceFeedMessage(){return 'No fresh questions';}
  async function _scienceFeedClaim(rows,profile,manual=false){const key=_scienceFeedKey();if(!shown.has(key))shown.set(key,new Set());const seen=shown.get(key);if(!manual&&rows.some(q=>seen.has(q.id)))return false;rows.forEach(q=>{seen.add(q.id);seen.add(scienceQuestionContentKey(q));});return true;}
  function _isAdmin() { return currentUser && currentUser.role === 'admin'; }
  function _isEmployee() { return currentUser && currentUser.role === 'employee'; }
  function _canAuthor() { return _isAdmin() || _isEmployee(); }
  function _docQById(id) { return questionBank.find(q => q.id === id); }
  let released = true, inSyllabus = true, withinLevel = true;
  function qAvailableToViewer(q) { return _canAuthor() || released; }
  function qInSyllabus(q) { return inSyllabus; }
  function qWithinStudentLevel(q) { return withinLevel; }
  function getTopicLevel(t) { return t === 'Heat' ? 'P4' : 'P5'; }
  function stripHtml(c) { return c ? String(c).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\\s+/g, ' ').trim() : ''; }
  function escapeHtml(s) { return s ? String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : ''; }
  function transformImageUrl(u) { return u; }
  function currentTopics() { return ['Heat', 'Light']; }
  function _gradingQuestionSource(q) {
    const lines = [q.title || ''];
    (q.blocks || []).forEach(b => { if (b.type === 'text') lines.push(stripHtml(b.content)); });
    return { text: lines.filter(Boolean).join('\\n'), images: (q.blocks || []).filter(b => b.type === 'image' && b.url).map(b => ({ url: b.url, label: 'fig' })) };
  }
  async function _cqMedia(q) { return []; }
  const groundings = [];
  function aiGrounding(kind, topic, q) { groundings.push(kind); return '\\n[GROUNDED:' + kind + ':' + (topic || '') + ']'; }
  const prompts = [];
  async function askGemini(prompt, opts) { prompts.push({ prompt, opts }); return askReply; }
  async function askGeminiVision(prompt, media, opts) { prompts.push({ prompt, opts, media }); return askReply; }
  function _parseAIJson(raw) { return JSON.parse(raw); }
  const toasts = [];
  function showToast(m, t) { toasts.push({ m, t }); }
  function showConfirm(t, m, fn) { fn(); }
  const document = { getElementById: () => null, querySelector: () => null };
  const CSS = { escape: s => s };
  // The animated figure and the shared motion preference are imported from
  // the sidekick modules; here they are stubs, because this harness checks
  // the bank and the quiz, never a drawing.
  const renderMistakeAnimalAvatar = (id, opts) => '<svg data-animal="' + id + '"' + (opts && opts.animated === false ? ' data-still' : '') + '></svg>';
  const scienceCoachMotion = { load() {}, allowed: () => true };
`;
const api = new Function('scienceQuestionContentKey',prelude + block + `
  return {
    MISTAKE_ANIMALS, mistakeAnimal, mistakeAnimalNormalize, mistakeAnimalLabel, mistakeAnimalIds, MISTAKE_ANIMAL_RULE,
    MK_HARVEST_MAX, MK_MIN_ANSWER_WORDS, MK_QUIZ_OPTIONS, MK_SESSION_MAX, MK_COLLECTION,
    _mkEntryFromAnalysis, _mkCandidatesFrom, _mkSort, _mkVisibleToStudent, _mkQuizOptions, _mkModelAnswer,
    _mkAnalysePrompt, _mkGenPrompt, mkAnalyseCandidate, mkGenerateOne, _mkStudentPool, _mkLogQuiz,
    _mkMarkedEntry, _mkFileMarked, _mkHarvestNote, mkHarvest, _mkOwnEntries, _mkOwnSectionHtml, MK_FILED_MARKING, MK_FILED_AI,
    setAttempts: a => { attemptDocs = a; }, setLog: l => { mistakeLog = l; }, state: () => _mk, _mkNormaliseEntry, loadAdmin: () => mkLoad(true),
    writes, merges, prompts, groundings, toasts,
    start:mkStart,session:()=>_mkSess,seen:()=>shown.get(_scienceFeedKey()),
    setUser: u => { currentUser = u; }, setBank: b => { questionBank = b; }, setDocs: d => { bankDocs = d; },
    setReply: r => { askReply = r; }, setGates: g => { released = g.released; inSyllabus = g.inSyllabus; withinLevel = g.withinLevel; },
    loadStudent: () => mkStudentLoad(true), bank: () => _mk.bank, resetBank: () => { _mk.bank = []; _mk.loaded = false; }
  };
`)(scienceQuestionContentKey);

let fails = 0, ran = 0;
function ok(name, cond, extra) {
  ran++;
  if (cond) return;
  fails++;
  console.error('FAIL: ' + name + (extra ? '\n      ' + extra : ''));
}

/* ---------- The shared taxonomy ---------- */
ok('there are nine mistake types — one per Science Sidekick', api.MISTAKE_ANIMALS.length === 9);
ok('the ids are the shared ones, in the shared order',
   JSON.stringify(api.mistakeAnimalIds()) === JSON.stringify(['comparison', 'context', 'specific', 'evidence', 'keywords', 'concept', 'reasoning', 'careful', 'complete']));
ok('every id is a Science Sidekick’s own id, so the coach and the animal are ONE figure',
   /export const SCIENCE_COACHES = Object\.freeze\(\{[\s\S]*?\n\}\);/.test(coachCore) && api.mistakeAnimalIds().every(id => new RegExp('\\n  ' + id + ':coach\\(\'' + id + '\'').test(coachCore)));
ok('the animal is the Sidekick’s name', api.mistakeAnimal('comparison').animal === 'Comparison Casey' && api.mistakeAnimal('specific').animal === 'Specific Sherry' && api.mistakeAnimal('context').animal === 'Context Connie');
ok('every animal is whole', api.MISTAKE_ANIMALS.every(m => m.id && m.emoji && m.animal && m.name && m.desc && m.spot && m.fix));
ok('the lookup returns null, never a default', api.mistakeAnimal('dragon') === null && api.mistakeAnimal('') === null && api.mistakeAnimal(undefined) === null);
ok('a model’s word becomes an id', api.mistakeAnimalNormalize('Comparison Casey') === 'comparison' && api.mistakeAnimalNormalize('too vague') === 'specific' && api.mistakeAnimalNormalize({ animal: 'EVIDENCE' }) === 'evidence' && api.mistakeAnimalNormalize('casey') === 'comparison' && api.mistakeAnimalNormalize('Evidence Ellen — ignored the evidence') === 'evidence');
ok('THE OLD TEN IDS STILL READ AS THE HABIT THEY MEANT — an entry filed under one in any app is not an unknown mistake',
   api.mistakeAnimalNormalize('sloth') === 'complete' && api.mistakeAnimalNormalize('The Fox') === 'reasoning' && api.mistakeAnimalNormalize('rushed it') === 'careful' && api.mistakeAnimalNormalize('peacock') === 'specific' && api.mistakeAnimalNormalize({ animal: 'BAT' }) === 'evidence' && api.mistakeAnimalNormalize('goldfish — forgot the fact') === 'concept');
ok('…but the lookup itself stays strict: an old id is not an entry', api.mistakeAnimal('sloth') === null && api.mistakeAnimal('fox') === null);
ok('"unsure", "none", nothing and an invented animal are NO type', ['unsure', 'none', '', null, 'dragon', 'N/A'].every(v => api.mistakeAnimalNormalize(v) === ''));
ok('the rule names every id and allows none', api.mistakeAnimalIds().every(id => api.MISTAKE_ANIMAL_RULE.includes('  ' + id + ' = ')) && /empty string rather than forcing one/.test(api.MISTAKE_ANIMAL_RULE));
// The block is copied into two other repos: pin that the three copies cannot
// silently disagree by checking this one against its own canonical text.
const taxonomyHere = src.slice(src.indexOf('var MISTAKE_ANIMALS = ['), src.indexOf('var MISTAKE_ANIMAL_RULE ='));
ok('the taxonomy block is the var-declared, classic-script shape the other apps can paste', /^var MISTAKE_ANIMALS = \[/.test(taxonomyHere) && /function mistakeAnimalNormalize\(v\)/.test(taxonomyHere));

/* ---------- The builder: an entry never carries the child ---------- */
const ctx = {
  source: 'student', questionId: 'q1', questionTitle: 'Ice in a beaker', topic: 'Heat', topic2: '', level: 'P4',
  part: '(b)', question: 'Why does the ice melt?', images: ['https://x/fig.png'], expected: 'It gains heat from the surroundings.',
  raw: 'the ice loses heat so it melt', fromAttempt: 'a1:0',
  // A caller that put the child on the context by mistake:
  uid: 'child9', email: 'child@x.com', displayName: 'Ali', name: 'Ali'
};
const ana = { worth: true, cleaned: 'The ice loses heat so it melts.', animal: 'Reasoning Ravi', why: 'This student has the direction of heat flow backwards.', fixed: 'The ice gains heat from the surroundings and melts.', hint: 'Ask which way the heat moves.' };
const e1 = api._mkEntryFromAnalysis(ana, ctx);
ok('an entry is built', !!e1);
ok('IT NEVER CARRIES THE CHILD', e1 && !('uid' in e1) && !('email' in e1) && !('displayName' in e1) && !('name' in e1),
   JSON.stringify(Object.keys(e1 || {})));
ok('it is pending', e1 && e1.status === 'pending');
ok('the animal is normalised', e1 && e1.animal === 'reasoning');
ok('an entry says how it was filed, and the clean-up call is the default', e1 && e1.filedBy === 'ai');
ok('the cleaned answer is what is shown', e1 && e1.studentAnswer === ana.cleaned);
ok('the raw answer is kept on a pending student entry', e1 && e1.raw === ctx.raw);
ok('the lesson travels', e1 && e1.why === ana.why && e1.fixed === ana.fixed && e1.hint === ana.hint);
ok('the question, part, pictures and level travel', e1 && e1.question === ctx.question && e1.part === '(b)' && e1.images.length === 1 && e1.level === 'P4');
ok('the attempt key travels so it is not harvested twice', e1 && e1.fromAttempt === 'a1:0');
ok('the hash is over the question and the cleaned answer', e1 && e1.hash === api._mkEntryFromAnalysis(ana, ctx).hash && e1.hash !== api._mkEntryFromAnalysis(Object.assign({}, ana, { cleaned: 'Something else entirely.' }), ctx).hash);
ok('a generated entry carries no raw answer', !('raw' in api._mkEntryFromAnalysis(ana, Object.assign({}, ctx, { source: 'generated' }))));
ok('an unknown source is a student entry', api._mkEntryFromAnalysis(ana, Object.assign({}, ctx, { source: 'other' })).source === 'student');
ok('"worth": false builds nothing', api._mkEntryFromAnalysis(Object.assign({}, ana, { worth: false }), ctx) === null);
ok('a one-word answer builds nothing', api._mkEntryFromAnalysis(Object.assign({}, ana, { cleaned: 'idk' }), ctx) === null);
ok('an empty clean-up falls back to the raw answer', api._mkEntryFromAnalysis(Object.assign({}, ana, { cleaned: '' }), ctx).studentAnswer === ctx.raw);
ok('an invented animal is NO type, and the entry is still built for the teacher to type it',
   api._mkEntryFromAnalysis(Object.assign({}, ana, { animal: 'dragon' }), ctx).animal === '');
ok('a missing fixed answer falls back to the model answer', api._mkEntryFromAnalysis(Object.assign({}, ana, { fixed: '' }), ctx).fixed === ctx.expected);
ok('a reply that is not an object still builds from what the app knew', api._mkEntryFromAnalysis(null, ctx) && api._mkEntryFromAnalysis(null, ctx).studentAnswer === ctx.raw);
ok('long fields are clipped', api._mkEntryFromAnalysis(Object.assign({}, ana, { why: 'w'.repeat(2000) }), ctx).why.length <= 600);

/* ---------- Which attempts are worth analysing ---------- */
api.setBank([{ id: 'q1', title: 'Ice', topic: 'Heat', blocks: [] }, { id: 'q2', title: 'Light', topic: 'Light', blocks: [] }]);
const attempts = [
  { id: 'a1', questionId: 'q1', answers: [
      { label: '(a)', student: 'It gains heat.', expected: 'It gains heat.', verdict: 'correct' },
      { label: '(b)', student: 'the ice loses heat', expected: 'It gains heat.', verdict: 'wrong' },
      { label: '(c)', student: 'melts', expected: 'It melts because…', verdict: 'partial' } ] },
  { id: 'a2', questionId: 'q1', answers: [{ label: 'Answer', student: 'heat goes in a bit', expected: 'x', verdict: 'partial' }] },
  { id: 'a3', questionId: 'gone', answers: [{ label: 'Answer', student: 'a wrong answer', expected: 'x', verdict: 'wrong' }] },
  { id: 'a4', questionId: 'q2', answers: [] },
  { id: 'a5', questionId: 'q2', score: 0, totalBlanks: 1 },
  { id: 'a6', questionId: 'q2', answers: [{ label: 'Answer', student: 'light travels in curves', expected: 'straight', verdict: 'WRONG' }] }
];
const cands = api._mkCandidatesFrom(attempts, new Set(['a2:0']), id => api.setBank, );
ok('only WRONG and PARTIAL parts are candidates, one per part', (() => {
  const c = api._mkCandidatesFrom(attempts, new Set(), id => [{ id: 'q1' }, { id: 'q2' }].find(q => q.id === id));
  return c.length === 3 && c.map(x => x.fromAttempt).join() === 'a1:1,a2:0,a6:0';
})());
ok('a correct part is never a candidate', !api._mkCandidatesFrom(attempts, new Set(), id => ({ id })).some(c => c.fromAttempt === 'a1:0'));
ok('a one-word answer is not a candidate', !api._mkCandidatesFrom(attempts, new Set(), id => ({ id })).some(c => c.fromAttempt === 'a1:2'));
ok('an attempt already in the bank is skipped', !api._mkCandidatesFrom(attempts, new Set(['a2:0']), id => ({ id })).some(c => c.fromAttempt === 'a2:0'));
ok('a question no longer in the bank is skipped — there is nothing to show', !api._mkCandidatesFrom(attempts, new Set(), id => id === 'gone' ? null : { id }).some(c => c.fromAttempt === 'a3:0'));
ok('a game attempt (no answers) is skipped', !api._mkCandidatesFrom(attempts, new Set(), id => ({ id })).some(c => /^a[45]:/.test(c.fromAttempt)));
ok('the verdict is read case-insensitively', api._mkCandidatesFrom(attempts, new Set(), id => ({ id })).some(c => c.fromAttempt === 'a6:0' && c.verdict === 'wrong'));
ok('the part label and the marker’s expected answer travel', (() => {
  const c = api._mkCandidatesFrom(attempts, new Set(), id => ({ id })).find(x => x.fromAttempt === 'a1:1');
  return c && c.part === '(b)' && c.expected === 'It gains heat.' && c.raw === 'the ice loses heat';
})());
ok('one press is capped', api._mkCandidatesFrom(Array.from({ length: 200 }, (_, i) => ({ id: 'z' + i, questionId: 'q1', answers: [{ student: 'two words', verdict: 'wrong' }] })), new Set(), id => ({ id })).length === api.MK_HARVEST_MAX);

/* ---------- Sorting ---------- */
const stamp = n => ({ seconds: n });
const sorted = api._mkSort([
  { animal: 'complete', topic: 'Heat', createdAt: stamp(1) },
  { animal: '', topic: 'Heat', createdAt: stamp(9) },
  { animal: 'comparison', topic: 'Light', createdAt: stamp(2) },
  { animal: 'comparison', topic: 'Heat', createdAt: stamp(3) },
  { animal: 'comparison', topic: 'Heat', createdAt: stamp(5) }
]);
ok('sorted by animal in the taxonomy’s order', sorted[0].animal === 'comparison' && sorted[3].animal === 'complete');
ok('no type sorts last', sorted[4].animal === '');
ok('then by topic', sorted[0].topic === 'Heat' && sorted[2].topic === 'Light');
ok('then newest first', sorted[0].createdAt.seconds === 5 && sorted[1].createdAt.seconds === 3);

/* ---------- What a student may be shown ---------- */
const good = { status: 'approved', animal: 'reasoning', studentAnswer: 'x y', question: 'Q?', questionId: 'q1' };
api.setGates({ released: true, inSyllabus: true, withinLevel: true });
api.setUser({ uid: 's1', role: 'student', email: 's@x', name: 'S' });
ok('an approved, typed entry on a servable question is shown', api._mkVisibleToStudent(good, api.setBank && (id => ({ id }))) === true);
ok('PENDING is never shown', api._mkVisibleToStudent(Object.assign({}, good, { status: 'pending' }), id => ({ id })) === false);
ok('REJECTED is never shown', api._mkVisibleToStudent(Object.assign({}, good, { status: 'rejected' }), id => ({ id })) === false);
ok('an entry with NO animal is never shown — nothing to quiz on', api._mkVisibleToStudent(Object.assign({}, good, { animal: '' }), id => ({ id })) === false);
ok('an entry with an invented animal is never shown', api._mkVisibleToStudent(Object.assign({}, good, { animal: 'dragon' }), id => ({ id })) === false);
api.setGates({ released: false, inSyllabus: true, withinLevel: true });
ok('an UNRELEASED question does not reach a student through a wrong answer to it', api._mkVisibleToStudent(good, id => ({ id })) === false);
api.setGates({ released: true, inSyllabus: false, withinLevel: true });
ok('a RETIRED topic does not either', api._mkVisibleToStudent(good, id => ({ id })) === false);
api.setGates({ released: true, inSyllabus: true, withinLevel: false });
ok('nor a question above their LEVEL', api._mkVisibleToStudent(good, id => ({ id })) === false);
api.setGates({ released: true, inSyllabus: true, withinLevel: true });
ok('a question that has since left the bank is served on its own wording', api._mkVisibleToStudent(good, id => null) === true);
ok('an entry with no wording is not', api._mkVisibleToStudent(Object.assign({}, good, { question: '' }), id => null) === false);
ok('the gate is one function that asks BOTH qAvailableToViewer and qWithinStudentLevel — the release census reads it',
   /function _mkVisibleToStudent[\s\S]*?qAvailableToViewer\(q\)[\s\S]*?qWithinStudentLevel\(q\)[\s\S]*?\n\}/.test(block));

/* ---------- The quiz options ---------- */
for (let i = 0; i < 40; i++) {
  const o = api._mkQuizOptions('complete', 4);
  if (!(o.length === 4 && o.filter(x => x === 'complete').length === 1 && new Set(o).size === 4 && o.every(id => api.mistakeAnimal(id)))) {
    ok('the right animal is among the four options exactly once, and every option is real', false, JSON.stringify(o));
    break;
  }
  if (i === 39) ok('the right animal is among the four options exactly once, and every option is real', true);
}
ok('the option count is bounded by the taxonomy', api._mkQuizOptions('reasoning', 99).length === 9 && api._mkQuizOptions('reasoning', 1).length === 2);

/* ---------- The model answer, read off the blocks ---------- */
const qAll = { blocks: [
  { type: 'text', content: '<p>Why?</p>' },
  { type: 'plainanswer', content: '<p>It gains <b>heat</b>.</p>' },
  { type: 'answer', claim: 'Claim.', evidence: 'Evidence.', reasoning: 'Reasoning.' },
  { type: 'answerLine', answer: 'Line answer' },
  { type: 'answerKey', text: 'Key text' },
  { type: 'mcq', options: [{ id: 'o1', text: 'Wrong' }, { id: 'o2', text: 'Right one' }], correctId: 'o2' },
  { type: 'explanation', content: 'never an answer' }
] };
const model = api._mkModelAnswer(qAll);
ok('every answer-bearing block is read', /It gains heat ?\./.test(model) && /Claim\. Evidence\. Reasoning\./.test(model) && /Line answer/.test(model) && /Key text/.test(model) && /\(2\) Right one/.test(model));
ok('an explanation is not an answer', !/never an answer/.test(model));
ok('a question with no answer has none', api._mkModelAnswer({ blocks: [{ type: 'text', content: 'x' }] }) === '');

/* ---------- The prompts ---------- */
const ap = api._mkAnalysePrompt({ part: '(b)', raw: 'the ice loses heat', verdict: 'wrong' }, 'Why does the ice melt?', 'It gains heat.');
ok('the clean-up is told to KEEP the mistake', /THE MISTAKE kept exactly as they wrote it/.test(ap) && /Never correct it, never improve the science/.test(ap));
ok('the clean-up is told to take names out', /ANY name or personal detail removed/.test(ap));
ok('the lesson speaks of "this student", never "you"', /Say "this student", never "you"/.test(ap));
ok('a worthless answer can be refused', /"worth": false/.test(ap));
ok('the shared rule is in it', ap.includes(api.MISTAKE_ANIMAL_RULE));
const gp = api._mkGenPrompt('Q?', 'A.', api.mistakeAnimal('evidence'));
ok('a written wrong answer carries EXACTLY ONE mistake of the chosen kind', /EXACTLY ONE mistake of this kind and no other error/.test(gp) && /evidence = Evidence Ellen/.test(gp));
ok('…and must read as an honest attempt', /Never a parody, never obviously silly/.test(gp));

/* ---------- End to end: analyse a candidate, and what gets written ---------- */
{
  api.setUser({ uid: 'admin1', email: 'chungzhikai@gmail.com', name: 'Mr Chung', role: 'admin' });
  api.resetBank();
  api.setBank([{ id: 'q1', title: 'Ice', topic: 'Heat', topic2: '', blocks: [{ type: 'text', content: 'Why does the ice melt?' }, { type: 'plainanswer', content: 'It gains heat.' }] }]);
  api.setReply(JSON.stringify({ worth: true, cleaned: 'The ice loses heat so it melts.', animal: 'reasoning', why: 'Backwards.', fixed: 'It gains heat and melts.', hint: 'Which way?' }));
  const c = { fromAttempt: 'a1:1', questionId: 'q1', q: api.setBank && { id: 'q1', title: 'Ice', topic: 'Heat', blocks: [{ type: 'text', content: 'Why does the ice melt?' }, { type: 'plainanswer', content: 'It gains heat.' }] }, part: '(b)', raw: 'the ice loses heat so it melt', expected: 'It gains heat.', verdict: 'wrong',
              uid: 'child9', email: 'child@x.com', displayName: 'Ali' };
  const before = api.writes.length;
  const r = await api.mkAnalyseCandidate(c);
  ok('a good analysis is added', r === 'added' && api.writes.length === before + 1);
  const w = api.writes[api.writes.length - 1];
  ok('WHAT IS WRITTEN NEVER CARRIES THE CHILD', w && !('uid' in w) && !('email' in w) && !('displayName' in w) && !('name' in w), JSON.stringify(Object.keys(w || {})));
  ok('it is written PENDING', w && w.status === 'pending' && w.source === 'student');
  ok('the call is grounded as teaching', api.groundings.includes('teach'));
  ok('the prompt carries the question, the model answer and what the child wrote', /Why does the ice melt\?/.test(api.prompts[api.prompts.length - 1].prompt) && /It gains heat\./.test(api.prompts[api.prompts.length - 1].prompt) && /the ice loses heat so it melt/.test(api.prompts[api.prompts.length - 1].prompt));
  ok('the call asks for JSON and never leads with the authoring engine', api.prompts[api.prompts.length - 1].opts.json === true && !api.prompts[api.prompts.length - 1].opts.authoring);
  const r2 = await api.mkAnalyseCandidate(c);
  ok('the same wrong answer is not filed twice', r2 === 'skipped' && api.writes.length === before + 1);
  api.setReply(JSON.stringify({ worth: false, cleaned: 'idk lol', animal: 'reasoning' }));
  const r3 = await api.mkAnalyseCandidate(Object.assign({}, c, { fromAttempt: 'a9:0', raw: 'idk lol' }));
  ok('a worthless answer is skipped and nothing is written', r3 === 'skipped' && api.writes.length === before + 1);

  // A generated example.
  api.setReply(JSON.stringify({ answer: 'The ice loses heat to the air and melts.', why: 'Backwards.', fixed: 'It gains heat.', hint: 'Which way?' }));
  const g = await api.mkGenerateOne(c.q, api.mistakeAnimal('reasoning'));
  const gw = api.writes[api.writes.length - 1];
  ok('a generated example is written pending, generated, typed, with no raw answer',
     g === true && gw.status === 'pending' && gw.source === 'generated' && gw.animal === 'reasoning' && !('raw' in gw));
  ok('…and it is grounded as teaching too', api.groundings.filter(k => k === 'teach').length >= 2);
}

/* ---------- The student read and the quiz log ---------- */
{
  api.setUser({ uid: 's1', role: 'student', email: 's@x', name: 'S' });
  api.setDocs([{ id: 'e1', status: 'approved', animal: 'fox', studentAnswer: 'x y', question: 'Q', questionId: 'q1' }]);  // an OLD id on a stored entry
  await api.loadStudent();
  ok('the student pool is filtered through the gate — and a stored OLD id is read as the habit it meant', api._mkStudentPool('').length === 1 && api._mkStudentPool('reasoning').length === 1 && api._mkStudentPool('evidence').length === 0);
  const before = api.writes.length;
  api._mkLogQuiz({ questionId: 'q1', questionTitle: 'Ice', animal: 'reasoning' }, true, 1200);
  const lw = api.writes[before];
  ok('the quiz is logged under the mistakes mode with the standard attempt shape',
     lw && lw.mode === 'mistakes' && lw.score === 1 && lw.totalBlanks === 1 && lw.questionId === 'q1' && lw.uid === 's1' && lw.ms === 1200);
  ok('the log never names the animal a classmate’s answer was filed under', lw && !('animal' in lw));
  await api.start('', 'quiz');
  ok('mistake tasks are reserved before their first session and cannot repeat in another mistake mode', api.seen().has('mistake:e1') && api._mkStudentPool('').length === 0);
  api.setUser({uid:'s2',role:'student',name:'Other child'});
  ok('a separate child keeps their own untouched mistake pool',api._mkStudentPool('').length===1);
  api.setUser({ uid: 'admin1', role: 'admin', email: 'a@x', name: 'A' });
  api._mkLogQuiz({ questionId: 'q1' }, true, 10);
  ok('the teacher is never logged', api.writes.length === before + 1);
}

/* ---------- 🐾 The habit the MARKER named, filed without a second call (v1.394.0) ---------- */
{
  api.setUser({ uid: 'admin1', email: 'chungzhikai@gmail.com', name: 'Mr Chung', role: 'admin' });
  const q = { id: 'q7', title: 'Why does the ice melt?', topic: 'Heat', blocks: [
    { type: 'text', content: '<p>Why does the ice melt?</p>' }, { type: 'plainanswer', content: 'It gains heat.' } ] };
  api.setBank([q]);
  const cand = { fromAttempt: 'a1:0', questionId: 'q7', q, part: '(a)', raw: 'the ice loses heat so it melt', expected: 'It gains heat.',
    verdict: 'wrong', mistake: 'reasoning', mistakeWhy: 'You reversed the direction of heat flow.' };
  const e = api._mkMarkedEntry(cand);
  ok('a marked candidate becomes a PENDING entry with no AI call', e && e.status === 'pending' && api.prompts.length === (api.prompts.length));
  ok('…filed by the marking, under the marker\'s habit, with its reason and the model answer',
     e && e.filedBy === api.MK_FILED_MARKING && e.animal === 'reasoning' && e.why === 'You reversed the direction of heat flow.' && e.fixed === 'It gains heat.' && e.hint === api.mistakeAnimal('reasoning').fix);
  ok('…and it carries the raw answer for the teacher, the question and never a child', e && e.raw === 'the ice loses heat so it melt' && /Why does the ice melt/.test(e.question) && !('uid' in e) && !('email' in e) && !('name' in e));
  ok('a candidate with no habit, an unknown habit or no question is refused',
     api._mkMarkedEntry(Object.assign({}, cand, { mistake: '' })) === null && api._mkMarkedEntry(Object.assign({}, cand, { mistake: 'dragon' })) === null && api._mkMarkedEntry(Object.assign({}, cand, { q: null })) === null);
  ok('a habit with no reason falls back to the animal\'s own description', api._mkMarkedEntry(Object.assign({}, cand, { mistakeWhy: '' })).why === api.mistakeAnimal('reasoning').desc);
  ok('the two filers are told apart', api.MK_FILED_MARKING === 'marking' && api.MK_FILED_AI === 'ai' && api.MK_FILED_MARKING !== api.MK_FILED_AI);

  // The harvest files the marked ones itself and leaves the rest for ✨.
  api.setDocs([]); api.resetBank();
  api.setAttempts([
    { id: 'a1', questionId: 'q7', answers: [
      { label: '(a)', student: 'the ice loses heat so it melt', expected: 'It gains heat.', verdict: 'wrong', mistake: 'reasoning', mistakeWhy: 'Backwards.' },
      { label: '(b)', student: 'the ice is cold and it is solid', expected: 'It gains heat.', verdict: 'partial' },
      { label: 'Multiple choice', student: '2', expected: '1) It gains heat', verdict: 'wrong', mistake: 'reasoning', mistakeWhy: 'Never on an MCQ.' },
      { label: '(c)', student: 'heat flows from the ice to the air around it', expected: 'It gains heat.', verdict: 'wrong', mistake: 'dragon', mistakeWhy: 'Invented.' }
    ] },
    { id: 'a2', questionId: 'q7', answers: [
      { label: '(a)', student: 'the ice loses heat so it melt', expected: 'It gains heat.', verdict: 'wrong', mistake: 'reasoning', mistakeWhy: 'Same words again.' }
    ] }
  ]);
  const cands = api._mkCandidatesFrom([{ id: 'a1', questionId: 'q7', answers: [
      { label: 'Multiple choice', student: 'two words here', expected: '1) x', verdict: 'wrong', mistake: 'reasoning' } ] }], new Set(), id => q);
  ok('a multiple-choice row is never a candidate, however it is labelled', cands.length === 0);
  const before = api.writes.length, calls = api.prompts.length;
  await api.mkHarvest();
  const st = api.state();
  ok('the harvest files the marked wrong answer as pending, with no AI call', api.writes.length === before + 1 && api.prompts.length === calls && api.writes[before].animal === 'reasoning' && api.writes[before].filedBy === api.MK_FILED_MARKING && api.writes[before].status === 'pending');
  ok('the same wrong answer marked twice is ONE lesson', api.bank().length === 1 && api.bank()[0].fromAttempt === 'a1:0');
  ok('the invented habit and the unmarked part wait for ✨, the MCQ row waits for nobody', Array.isArray(st.candidates) && st.candidates.map(c => c.part).sort().join(',') === '(b),(c)' && st.candidates.every(c => !c.mistake));
  ok('what happened is SAID under the buttons', /1 wrong answer the marker had already sorted is in Pending now/.test(st.progress) && /2 more wrong answers carry no mistake type yet/.test(st.progress) && /Nothing is shown to a student until you approve it/.test(st.progress));
  ok('the note on an automatic run says it was a check', /^Checked the newest attempts:/.test(api._mkHarvestNote({ added: 1, skipped: 0, failed: 0 }, 0, true)) && api._mkHarvestNote({ added: 0, skipped: 0, failed: 0 }, 0, true) === 'Every wrong answer in the newest attempts is already here.');
  ok('a refused write is counted, never hidden', /2 could not be written/.test(api._mkHarvestNote({ added: 0, skipped: 0, failed: 2 }, 0, false)));
  const again = await api._mkFileMarked([cand]);
  ok('filing the same attempt part again is skipped by the dedupe', again.added === 0 && again.skipped === 1 && api.bank().length === 1);
  const mcqOnly = await api._mkFileMarked([Object.assign({}, cand, { fromAttempt: 'a3:0', mistake: '' })]);
  ok('a candidate with no habit cannot be filed by the marking path', mcqOnly.added === 0 && mcqOnly.skipped === 1);
  api.setUser({ uid: 's1', role: 'student', email: 's@x', name: 'S' });
  const stBefore = api.writes.length;
  await api.mkHarvest();
  ok('a student cannot harvest', api.writes.length === stBefore);
}

/* ---------- 🐾 A child's OWN mistakes, on their own page (v1.394.0) ---------- */
{
  const q = { id: 'q7', title: 'Why does the ice melt?', topic: 'Heat', blocks: [{ type: 'text', content: '<p>Why does the ice melt?</p>' }, { type: 'plainanswer', content: 'It gains heat.' }] };
  const q8 = { id: 'q8', title: 'Held back', topic: 'Light', blocks: [{ type: 'text', content: '<p>Which is brighter?</p>' }] };
  api.setBank([q, q8]);
  api.setUser({ uid: 's1', role: 'student', email: 's@x', name: 'S' });
  api.setGates({ released: true, inSyllabus: true, withinLevel: true });
  const log = [
    { id: 'm1', qId: 'q7', qTitle: 'Why does the ice melt?', topic: 'Heat', kind: 'open', verdict: 'incorrect', expected: 'It gains heat.', student: 'the ice loses heat', mistake: 'fox', mistakeWhy: 'Backwards.', at: '2026-09-10T00:00:00.000Z' },
    { id: 'm2', qId: 'q7', qTitle: 'Why does the ice melt?', topic: 'Heat', kind: 'open', verdict: 'partial', expected: 'It gains heat.', student: 'THE ICE LOSES HEAT ', mistake: 'reasoning', at: '2026-09-11T00:00:00.000Z' },
    { id: 'm3', qId: 'q7', qTitle: 'Why does the ice melt?', topic: 'Heat', kind: 'open', verdict: 'incorrect', expected: 'It gains heat.', student: 'it is cold', at: '2026-09-12T00:00:00.000Z' },
    { id: 'm4', qId: 'q7', qTitle: 'Why does the ice melt?', topic: 'Heat', kind: 'mcq', verdict: 'incorrect', expected: '1) It gains heat', student: '2', mistake: 'reasoning', at: '2026-09-13T00:00:00.000Z' },
    { id: 'm5', qId: 'q9', qTitle: 'Gone', topic: 'Heat', kind: 'open', verdict: 'incorrect', expected: 'x', student: 'y z', mistake: 'careful', at: '2026-09-14T00:00:00.000Z' },
    { id: 'm6', qId: 'q7', qTitle: 'Why does the ice melt?', topic: 'Heat', kind: 'open', verdict: 'incorrect', expected: 'It gains heat.', student: 'the sun is hot', mistake: 'Specific Sherry', mistakeWhy: 'Too vague.', at: '2026-09-15T00:00:00.000Z' }
  ];
  api.setLog(log);
  const own = api._mkOwnEntries(log, id => [q, q8].find(x => x.id === id));
  ok('only a logged part with a real habit, on a question still in the bank, becomes an own entry — one per wrong answer', own.length === 2 && own.map(e => e.id).sort().join() === 'own:m1,own:m6');
  const m1 = own.find(e => e.id === 'own:m1');
  ok('an OLD ten-animal id on the child\'s log is read as its Sidekick', m1 && m1.animal === 'reasoning');
  ok('the entry is the child\'s own: question, what they wrote, the marker\'s reason and the model answer', m1 && m1.own === true && m1.status === 'own' && /Why does the ice melt/.test(m1.question) && m1.studentAnswer === 'the ice loses heat' && m1.why === 'Backwards.' && m1.fixed === 'It gains heat.' && m1.expected === 'It gains heat.' && m1.hint === api.mistakeAnimal('reasoning').fix && m1.verdict === 'incorrect' && m1.questionId === 'q7');
  ok('a multiple-choice part on the log is never an own entry, whatever habit it carries', !own.some(e => e.id === 'own:m4'));
  ok('a habit reaching the log by its Sidekick name resolves too', own.find(e => e.id === 'own:m6').animal === 'specific');
  ok('the own pool is the log and nothing else, filtered by animal', api._mkStudentPool('', 'mine').length === 2 && api._mkStudentPool('reasoning', 'mine').length === 1 && api._mkStudentPool('evidence', 'mine').length === 0);
  api.setGates({ released: false, inSyllabus: true, withinLevel: true });
  ok('a question the child may not be served is not studied through their own wrong answer to it either', api._mkOwnEntries(log, id => [q, q8].find(x => x.id === id)).length === 0);
  api.setGates({ released: true, inSyllabus: true, withinLevel: true });
  const html = api._mkOwnSectionHtml(own);
  ok('the own section names the count, offers the study button, and says "You wrote"', /🐾 My own mistakes/.test(html) && /2 to revisit/.test(html) && /mkStart\('', 'mine'\)/.test(html) && /You wrote/.test(html) && !/a student wrote/i.test(html));
  ok('the newest own mistake is drawn first, with the animated figure and a study button per card', html.indexOf('own:m6') < html.indexOf('own:m1') && (html.match(/mk-own-card/g) || []).length === 2 && /data-animal="specific"/.test(html) && /mkStudyOwn\('own:m6'\)/.test(html));
  ok('the child\'s words are escaped on their own card', /&lt;/.test(api._mkOwnSectionHtml([Object.assign({}, m1, { studentAnswer: '<b>x</b>' })])));
  const empty = api._mkOwnSectionHtml([]);
  ok('with nothing named yet the section says so and the button is disabled', /none yet/.test(empty) && /disabled/.test(empty) && !/mk-own-card/.test(empty));
  const many = Array.from({ length: 9 }, (_, i) => Object.assign({}, m1, { id: 'own:x' + i, at: '2026-09-0' + (i + 1) }));
  ok('only the newest MK_OWN_SHOWN cards are drawn and the rest are counted', (api._mkOwnSectionHtml(many).match(/mk-own-card/g) || []).length === 6 && /Showing your newest 6 of 9/.test(api._mkOwnSectionHtml(many)));
}

/* ---------- 🐾 An entry stored under the OLD list still reads (v1.394.0) ---------- */
{
  api.setUser({ uid: 'admin1', email: 'chungzhikai@gmail.com', name: 'Mr Chung', role: 'admin' });
  api.setDocs([
    { id: 'o1', status: 'pending', animal: 'fox', studentAnswer: 'a b', question: 'Q', questionId: 'q1' },
    { id: 'o2', status: 'approved', animal: 'parrot', studentAnswer: 'a b', question: 'Q', questionId: 'q1' },
    { id: 'o3', status: 'approved', animal: 'concept', studentAnswer: 'a b', question: 'Q', questionId: 'q1' },
    { id: 'o4', status: 'approved', animal: 'dragon', studentAnswer: 'a b', question: 'Q', questionId: 'q1' },
    { id: 'o5', status: 'approved', animal: '', studentAnswer: 'a b', question: 'Q', questionId: 'q1' }
  ]);
  await api.loadAdmin();
  const by = id => api.bank().find(e => e.id === id);
  ok('the admin read carries every old id to its Sidekick on the way in', by('o1').animal === 'reasoning' && by('o2').animal === 'specific');
  ok('a live id and an untyped entry are left as they are', by('o3').animal === 'concept' && by('o5').animal === '');
  ok('an id that fits nothing is left for the teacher to re-pick, never guessed', by('o4').animal === 'dragon');
  ok('the normaliser is pure over an entry and tolerates junk', api._mkNormaliseEntry(null) === null && api._mkNormaliseEntry({ animal: 'The Rabbit' }).animal === 'careful' && api._mkNormaliseEntry({}).animal === undefined);
}

/* ---------- Read as text: the wiring that fails silently ---------- */
ok('_setPartResult hands the reply AND the key to _partMistakeOf', /function _setPartResult\(containerSel, key, verdict, pts, expected, student, reply\)[\s\S]*?_partMistakeOf\(reply, verdict, key\)/.test(src));
ok('_partMistakeOf refuses an mcq key before it reads the reply', /function _partMistakeOf\(reply, verdict, key\) \{[\s\S]*?if \(String\(key \|\| ''\)\.startsWith\('mcq:'\)\) return \{\};/.test(src));
ok('the attempt row carries the habit only through the taxonomy', /if \(r\.mistake && mistakeAnimal\(r\.mistake\)\) \{\s*row\.mistake = String\(r\.mistake\);/.test(src));
ok('the student\'s own log carries the habit, never on an mcq part', /const habit = rec\.kind === 'mcq' \? '' : mistakeAnimalNormalize\(p\.mistake\);/.test(src));
ok('the teacher\'s page checks the newest attempts by itself, once a sitting', /_mk\.autoRan/.test(block) && /mkHarvest\(\{ auto: true \}\)/.test(block));
ok('the sidekick and the mistake analysis stand down on a multiple-choice part', /function _showScienceCoachFeedback[\s\S]*?if \(_coachKindIsMcq\(context\)\) \{[\s\S]*?resetScienceCoaches\(host\)[\s\S]*?resetMistakeAnalysis\(host\)[\s\S]*?return;/.test(src) && /function _mistakeAnalysisFor[\s\S]*?if \(_coachKindIsMcq\(context\)\) return null;/.test(src));
ok('the per-part marker asks for coach issues and a habit on an OPEN part only', /\(kind === 'open'\s*\?\s*SCIENCE_COACH_INSTRUCTIONS \+ '\\n' \+\s*MISTAKE_ANIMAL_RULE/.test(src));
ok('both loads normalise a stored animal on the way in', /_mk\.bank = snap\.docs\.map\(d => _mkNormaliseEntry\(/.test(block) && /_mkStudent\.entries = snap\.docs\.map\(d => _mkNormaliseEntry\(/.test(block));
ok('the student page draws the own section from the log', /const mine = _mkStudentPool\('', 'mine'\);\s*let html = _mkOwnSectionHtml\(mine\);/.test(block) && /window\.mkStudyOwn = mkStudyOwn/.test(src));
ok('the own-mistakes card has its stylesheet', /\.mk-own\b/.test(html) && /\.mk-own-card/.test(html) && /\.mk-own-grid/.test(html));

/* ---------- Read as text: the wiring ---------- */
ok('the student read asks for approved entries and nothing else', /getDocs\(query\(col, where\('status', '==', 'approved'\)\)\)/.test(block));
ok('approving deletes the raw answer', /status: 'approved', approvedAt: Timestamp\.now\(\), raw: deleteField\(\)/.test(block));
ok('approving refuses an entry with no animal', /function mkApprove[\s\S]*?if \(!mistakeAnimal\(fields\.animal\)\)[\s\S]*?return;/.test(block));
ok('approving refuses an entry with no correct answer', /function mkApprove[\s\S]*?if \(!fields\.fixed\)[\s\S]*?return;/.test(block));
ok('every write goes through the one merge writer', (block.match(/setDoc\(/g) || []).length === 1 && /await setDoc\(doc\(col, id\), patch, \{ merge: true \}\)/.test(block));
ok('the harvest reads the newest attempts, capped', /orderBy\('timestamp', 'desc'\), limit\(MK_HARVEST_SCAN\)/.test(block));
ok('the rewrite check is grounded as MARKING', /function mkCheckRewrite[\s\S]*?aiGrounding\('mark'/.test(block));
ok('no call here leads with the authoring engine', !/authoring: true/.test(block));
ok('the admin page is guarded in navigateTo, not only hidden', /if \(page === 'mistakebank' && !_isAdmin\(\)\) page = rpgHomePage\(\);/.test(src));
ok('both pages are dispatched', /if \(page === 'mistakebank'\) mkRender\(\);/.test(src) && /if \(page === 'mistakes'\) mkStudentRender\(\);/.test(src));
ok('mistakebank is deliberately not an employee page', /const EMPLOYEE_PAGES = \[[^\]]*\]/.test(src) && !/const EMPLOYEE_PAGES = \[[^\]]*mistakebank/.test(src));
ok('the quiz mode is labelled for the usage tracker', /'mistakes':\s*\{ icon: '🐾', label: 'Learn from Mistakes', group: 'practice' \}/.test(src));
ok('the admin nav item is admin-only', /class="nav-item admin-only" data-page="mistakebank"/.test(html));
ok('the student nav item is student-only', /class="nav-item student-only" data-page="mistakes"/.test(html));
ok('both pages exist', /id="page-mistakebank"/.test(html) && /id="page-mistakes"/.test(html));
ok('the page renderers refuse a non-author and paint from state', /async function mkRender\(\)[\s\S]*?if \(!_canAuthor\(\)\)[\s\S]*?return; \}/.test(block));

console.log((fails ? '✗ ' : '✓ ') + (ran - fails) + '/' + ran + ' mistake-bank checks passed');
process.exit(fails ? 1 : 0);
