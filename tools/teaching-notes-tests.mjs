// Regression tests for the TEACHING NOTES digests. Run with:
//     node tools/teaching-notes-tests.mjs
//
// It loads the REAL section out of app.js — `_notesGuidanceBlock`,
// `_notesMarkingBlock`, `_notesGenBlock`, `_notesAnswerBlock` — and runs it
// over synthetic notebooks.
//
// Every failure here is SILENT. A digest that comes back without the
// teacher's standing instruction is an ungrounded prompt: the AI still builds
// the question, still writes the answer and still marks the student, in its
// own voice instead of theirs, and nothing anywhere says so. The notebook is
// shared with the Ans Key annotator and the Scan app, so a field that stops
// being read here goes on being written there — which is the version of this
// bug that is impossible to spot from either side.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const a = src.indexOf('// ---- Which notes belong to THIS app ----');
const b = src.indexOf('// ---- Teaching Notes page (admin only) ----', a);
if (a < 0 || b < 0) throw new Error('teaching-notes digest section not found in app.js — did the banner comments change?');

// The note CARD is loaded too. It is the only place a teacher can see what a
// note written in one of the other two apps actually says, so a field that
// stops being rendered is a rule sitting in the notebook that nobody here
// knows is there.
const c = src.indexOf('function _noteSourceLabel(');
const d = src.indexOf('function notesRenderBody(', c);
if (c < 0 || d < 0) throw new Error('note card section not found in app.js');

const api = new Function(`
  let teachingNotes = [];
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  ${src.slice(a, b)}
  ${src.slice(c, d)}
  return {
    set notes(v) { teachingNotes = v; },
    _noteSuitsThisApp, _notesFor, _noteSourceLabel, notesCardHtml,
    _notesGuidanceBlock, _notesMarkingBlock, _notesGenBlock, _notesAnswerBlock,
    aiGrounding, notesLedgerFor, notesLedgerCounts, _notesFairShare,
    NOTES_GUIDE_MIN_EACH, NOTES_TRIM_MARK
  };
`)();

let ran = 0, fails = 0;
function ok(name, cond, extra) {
  ran++;
  if (cond) return;
  fails++;
  console.error('FAIL: ' + name + (extra ? '\n      ' + extra : ''));
}

const GUIDE = 'Always name the process — "evaporation", not "it dries up".';
const guideNote = { id: 'g1', guidance: GUIDE, topics: [], keywords: [], markingStandards: '', keyFacts: '' };
const heatNote = {
  id: 'n1', topics: ['Heat'], keywords: ['gains heat', 'expands'],
  markingStandards: 'The direction of heat flow must be stated.',
  keyFacts: 'Heat flows from hotter to colder.'
};
const generalNote = { id: 'n2', topics: [], keywords: ['fair test'], markingStandards: '', keyFacts: 'Change one variable only.' };

/* ---- Nothing at all grounds nothing ---- */
api.notes = [];
ok('an empty notebook grounds no marking', api._notesMarkingBlock('Heat') === '');
ok('an empty notebook grounds no question-building', api._notesGenBlock() === '');
ok('an empty notebook grounds no model answer', api._notesAnswerBlock('Heat') === '');

/* ---- The standing instruction reaches ALL THREE digests ----
   This is the whole point of the port: `guidance` is written by the Ans Key
   annotator and by the Scan app into this very collection, and until now
   this app read the field nowhere at all. */
api.notes = [guideNote, heatNote, generalNote];
ok('guidance reaches MARKING', api._notesMarkingBlock('Heat').includes(GUIDE));
ok('guidance reaches QUESTION-BUILDING', api._notesGenBlock().includes(GUIDE));
ok('guidance reaches a MODEL ANSWER', api._notesAnswerBlock('Heat').includes(GUIDE));

/* ---- …and it LEADS each of them ----
   A house rule read after the extracted keywords is a house rule competing
   with them; read first, it is the rule they are applied under. */
['_notesMarkingBlock', '_notesGenBlock', '_notesAnswerBlock'].forEach(fn => {
  const out = fn === '_notesGenBlock' ? api[fn]() : api[fn]('Heat');
  ok(fn + ' puts the guidance first',
     out.indexOf(GUIDE) >= 0 && out.indexOf(GUIDE) < out.indexOf('gains heat'),
     out.slice(0, 120));
});

/* ---- A HOUSE RULE IS NOT FILTERED BY TOPIC ----
   The topic filter is what makes the other fields cheap, and it is exactly
   wrong for a standing instruction: a rule that only applied to the notes
   matching the question in front of us would not be a house rule. A note
   tagged "Heat" is present, so the guidance note is NOT in `rel` — the
   guidance still has to get through. */
ok('guidance survives a topic-matched marking digest', api._notesMarkingBlock('Heat').includes(GUIDE));
ok('guidance survives a topic-matched answer digest', api._notesAnswerBlock('Heat').includes(GUIDE));
ok('guidance applies to a topic nothing was uploaded for', api._notesMarkingBlock('Electricity').includes(GUIDE));
ok('guidance applies when no topic is known at all', api._notesMarkingBlock('').includes(GUIDE));

/* ---- Guidance ALONE is worth a block ----
   A teacher who has typed a house rule and uploaded no documents at all must
   still be obeyed. Each digest used to bail out the moment there were no
   keywords, standards or facts to report. */
api.notes = [guideNote];
ok('a guidance-only notebook still grounds marking', api._notesMarkingBlock('Heat').includes(GUIDE));
ok('a guidance-only notebook still grounds question-building', api._notesGenBlock().includes(GUIDE));
ok('a guidance-only notebook still grounds a model answer', api._notesAnswerBlock('Heat').includes(GUIDE));

/* ---- Several notes are joined, and the budget is respected ---- */
api.notes = [guideNote, { id: 'g2', guidance: 'Units on every numerical answer.', topics: [] }];
const both = api._notesGuidanceBlock();
ok('every standing note is carried', both.includes(GUIDE) && both.includes('Units on every'));

/* ---- NO NOTE IS EVER SILENTLY DROPPED ----
   This is the bug the teacher reported. The budget used to be a `.slice()`
   over the JOINED guidance, so with two long standing instructions the first
   lost most of itself and the SECOND reached no prompt at all — while sitting
   on the Teaching Notes page looking obeyed. It is a POT now, shared out. */
const many = [];
for (let i = 0; i < 12; i++) many.push({ id: 'many' + i, topics: [], guidance: 'RULE-SENTINEL-' + i + ' ' + 'w'.repeat(900) });
api.notes = many;
for (const kind of ['mark', 'answer', 'gen', 'teach', 'check']) {
  const dig = api.aiGrounding(kind);
  const missing = many.filter(n => !dig.includes('RULE-SENTINEL-' + n.id.slice(4)));
  ok('every standing instruction reaches a "' + kind + '" prompt', missing.length === 0,
     missing.length + ' of 12 notes were dropped entirely');
}

/* ---- Over-long is TRIMMED, not vanished ---- */
api.notes = [{ id: 'g3', topics: [], guidance: 'OPENING-SENTINEL ' + 'x'.repeat(9000) }];
const big = api._notesGuidanceBlock();
ok('an over-long note keeps its opening', big.includes('OPENING-SENTINEL'));
ok('an over-long note is marked as trimmed', big.includes(api.NOTES_TRIM_MARK));
ok('an over-long note does not go in whole', big.length < 9000, 'length ' + big.length);

/* ---- A SHORT note is never trimmed at all ---- */
api.notes = [guideNote, { id: 'g4', topics: [], guidance: 'Units on every numerical answer.' }];
ok('a short note goes in word for word', api._notesGuidanceBlock().includes('Units on every numerical answer.'));

/* ---- The ledger tells the truth, in both directions ---- */
api.notes = [guideNote];
api.aiGrounding('answer');
ok('a note that fits is not reported as trimmed', api.notesLedgerFor('g1') === null);
ok('nothing is reported when nothing was cut', api.notesLedgerCounts().trimmed === 0 && api.notesLedgerCounts().dropped === 0);
api.notes = many;
api.aiGrounding('answer');
ok('a trimmed note IS reported', api.notesLedgerCounts().trimmed > 0);
const rep0 = api.notesLedgerFor('many0');
ok('the report names the note and its real numbers', !!rep0 && rep0.wanted > rep0.kept, JSON.stringify(rep0));
ok('the card says so', api.notesCardHtml(many[0]).includes('Trimmed'));
api.notes = [guideNote];
api.aiGrounding('answer');
ok('the card is clean again once it fits', !api.notesCardHtml(guideNote).includes('Trimmed'));

/* ---- The same rule typed in two apps is ONE rule ---- */
api.notes = [{ id: 'd1', topics: [], guidance: GUIDE }, { id: 'd2', topics: [], guidance: GUIDE + '  ' }];
ok('a duplicated rule is not sent twice',
   api._notesGuidanceBlock().split(GUIDE).length - 1 === 1);

/* ---- 'mark' NEVER gets the key facts, however tight the budget ----
   A marker handed the answer stops marking against the paper. The plausible
   regression is a "just send everything" fallback when the water-filler runs
   out, so it is checked with the notebook well over budget too. */
const secret = { id: 's1', topics: ['Heat'], keywords: [], markingStandards: 'State the direction.', keyFacts: 'THE-ANSWER-IS-42' };
api.notes = [secret];
ok('marking never sees the key facts', !api.aiGrounding('mark', 'Heat').includes('THE-ANSWER-IS-42'));
ok('an answer digest DOES see the key facts', api.aiGrounding('answer', 'Heat').includes('THE-ANSWER-IS-42'));
api.notes = many.concat([secret]);
ok('marking never sees the key facts even over budget', !api.aiGrounding('mark', 'Heat').includes('THE-ANSWER-IS-42'));

/* ---- An unknown kind degrades to MARKING, not to ANSWER ----
   'mark' is the kind that leaks least, so a typo must not be the thing that
   hands a marker the answer. */
api.notes = [secret];
ok('an unknown kind is grounded as marking', !api.aiGrounding('marks', 'Heat').includes('THE-ANSWER-IS-42'));

/* ---- 'check' is a REFERENCE, never a standard to rewrite to ----
   A checker told to base the wording on the notes starts flagging correct
   answers as wrong for using different words, and the report then reads as a
   clean bill of health inverted. */
api.notes = [heatNote];
const chk = api.aiGrounding('check', 'Heat');
ok('a check digest carries the notes', chk.includes('gains heat'));
ok('a check digest says the notes are a reference', chk.includes('NOT AS A STANDARD TO REWRITE TO'));
ok('a check digest never licenses a rewrite', !chk.includes('base the science and the wording on this database FIRST'));

/* ---- The fair-share rule itself ---- */
{
  const share = api._notesFairShare(
    [{ id: 'a', text: 'short' }, { id: 'b', text: 'y'.repeat(5000) }], 600, 120);
  ok('the short note survives whole beside a huge one', share.texts[0] === 'short');
  ok('the huge note is trimmed rather than the short one dropped', share.texts.length === 2);
  ok('nothing is dropped when the floor fits', share.dropped.length === 0);
}

/* ---- No regression in what was already there ----
   The topic filter, the keyword lists and the authority order all have to
   behave exactly as they did before the guidance was folded in. */
api.notes = [heatNote, generalNote];
const mark = api._notesMarkingBlock('Heat');
ok('a topic-matched note still reaches marking', mark.includes('gains heat'));
// This assertion is the REVERSE of what it said before v1.310.0, and the
// reversal is the point: an untagged note is a GENERAL note, and a general
// note that stops applying the moment some other note happens to match the
// topic is not general at all. It is also how every note written in the Ans
// Key annotator arrives here, so the old rule silently dropped the whole of
// the shared notebook from any question this app had its own notes for.
ok('a general note applies ALONGSIDE the topic match', mark.includes('fair test'));
ok('…with the topic match still leading it', mark.indexOf('gains heat') < mark.indexOf('fair test'));
ok('the marking authority order still stands', mark.includes('ALWAYS the highest authority'));
ok('…and does not point at guidance that was never sent', !mark.includes('general guidance above'));
api.notes = [guideNote, heatNote];
ok('…but does the moment there is some', api._notesMarkingBlock('Heat').includes('general guidance above'));
api.notes = [heatNote, generalNote];
ok('an untagged note is the fallback when nothing matched', api._notesMarkingBlock('Electricity').includes('fair test'));
ok('question-building still sees every keyword',
   api._notesGenBlock().includes('gains heat') && api._notesGenBlock().includes('fair test'));
ok('question-building still yields to the source document',
   api._notesGenBlock().includes('highest authority'));
ok('a model answer still gets the key facts', api._notesAnswerBlock('Heat').includes('Heat flows from hotter'));
ok('a notebook with no guidance produces no guidance block', api._notesGuidanceBlock() === '');
ok('…and marking then reads exactly as it always did', mark.startsWith("TEACHER'S REFERENCE NOTES"));

/* ================= The notebook is SHARED =================
   Everything below is about a note that was written in the Ans Key annotator
   or the Scan app and landed in this collection. Those apps write `topics`
   EMPTY on purpose — it is this app's syllabus list and they have never heard
   of it — so every one of their notes arrives here untagged. */
const anskeyNote = {
  id: 'a1', source: 'anskey', topics: [], noteTopics: ['evaporation'],
  subjects: [], levels: ['P5'],
  keywords: ['water vapour'], markingStandards: 'Name the process.', keyFacts: 'Evaporation needs heat.'
};
const anskeyMathNote = {
  id: 'a2', source: 'anskey', topics: [], subjects: ['math'], levels: [],
  keywords: ['remainder'], markingStandards: 'Show the model.', keyFacts: 'Divide before you subtract.',
  guidance: 'Draw the model before writing the number sentence.'
};

/* THE BUG THIS FIXES. An untagged note used to reach a topic-filtered prompt
   only when NOTHING matched the topic — so the moment the teacher had one
   note tagged "Heat" here, every note they had ever written in Ans Key was
   silently dropped from marking a Heat question. */
api.notes = [heatNote, anskeyNote];
const shared = api._notesMarkingBlock('Heat');
ok('an Ans Key note reaches marking even when a tagged note matched', shared.includes('water vapour'));
ok('…and the tagged note is still there beside it', shared.includes('gains heat'));
ok('an Ans Key note reaches a model answer too', api._notesAnswerBlock('Heat').includes('water vapour'));
ok('the topic-matched note leads, so it wins the caps',
   shared.indexOf('gains heat') < shared.indexOf('water vapour'));
ok('an Ans Key note applies to a topic nothing was uploaded for',
   api._notesMarkingBlock('Electricity').includes('water vapour'));

/* …and a MATHS note does not, however general it looks. The notebook is
   shared with an app that teaches both subjects; a maths marking standard in
   a science prompt is worse than no note at all. */
api.notes = [heatNote, anskeyMathNote];
const noMaths = api._notesMarkingBlock('Heat');
ok('a maths-only note stays out of marking', !noMaths.includes('remainder'));
ok('a maths-only marking standard stays out', !noMaths.includes('Show the model'));
ok('a maths-only note stays out of question-building', !api._notesGenBlock().includes('remainder'));
ok('a maths-only note stays out of a model answer', !api._notesAnswerBlock('Heat').includes('remainder'));
ok('a maths-only HOUSE RULE stays out as well', !api._notesGuidanceBlock().includes('Draw the model'));
ok('the science note is untouched by all that', noMaths.includes('gains heat'));

api.notes = [{ id: 'b1', topics: [], subjects: ['science'], keywords: ['condensation'] }];
ok('a science-tagged note is welcome', api._notesGenBlock().includes('condensation'));
api.notes = [{ id: 'b2', topics: [], subjects: ['both'], keywords: ['fair test'] }];
ok('a both-subjects note is welcome', api._notesGenBlock().includes('fair test'));
api.notes = [{ id: 'b3', topics: [], keywords: ['photosynthesis'] }];
ok('a note naming no subject at all is welcome', api._notesGenBlock().includes('photosynthesis'));
/* A dropped note is still listed on the page, so the page has to SAY it is
   dropped: a note sitting in the list reads as a note being followed. */
ok('the page says when a shared note is not being used here',
   /Not used here/.test(src) && /never reaches a science prompt/.test(src));
ok('_noteSuitsThisApp is the one place that is decided',
   api._noteSuitsThisApp({}) === true &&
   api._noteSuitsThisApp({ subjects: ['math'] }) === false &&
   api._noteSuitsThisApp({ subjects: [] }) === true);

/* A general note must not be listed twice when it is ALSO the topic match —
   duplicated keywords would eat the cap and duplicated standards read as
   emphasis the teacher never wrote. */
api.notes = [{ id: 'd1', topics: [], keywords: ['once'] }];
const twice = api._notesFor('');
ok('a general note appears exactly once', twice.length === 1);

/* The live listener is what makes any of this reach a tab that was already
   open. Pinned as source, since a `getDocs` here would look identical until
   the day somebody types a note mid-lesson. */
ok('the notebook is read with a listener, not a one-shot get',
   /onSnapshot\(collection\(db, 'users', owner, 'teachingNotes'\)/.test(src));
ok('the listener is torn down when the account changes',
   /stopTeachingNotes\(\)/.test(src.slice(src.indexOf('onAuthStateChanged(auth'), src.indexOf('onAuthStateChanged(auth') + 900)));
ok('a waiter is released when the listener goes, never left hanging',
   /_notesPending/.test(src) && /waiting\.forEach/.test(src));

/* ---------- A rule typed on an answer card in the Scan app ----------
   The Scan app's ✎ writes an ordinary note in this very collection:
   `guidance` for the rule, `keyFacts` for the corrected answer with its
   question above it, and `sourceQuestion` for the question it was written
   against. Everything below is what makes it READABLE here — a rule the
   teacher can no longer place is a rule they delete. */
api.notes = [];
const scanNote = {
  id: 's1', title: 'Name the process', source: 'scan', noteKind: 'correction',
  guidance: 'On "explain" questions, always name the process.',
  sourceQuestion: 'How would this affect the size of the remaining peaches?',
  keyFacts: 'Question: How would this affect the size of the remaining peaches?\nThe answer is: They grow larger.',
  topics: [], keywords: [], subjects: ['science'], levels: ['P5']
};
const scanCard = api.notesCardHtml(scanNote);
ok('the card names the app the rule was typed in',
   api._noteSourceLabel(scanNote) === 'from Scan & Answer' && scanCard.includes('from Scan &amp; Answer'));
ok('the rule itself is shown', scanCard.includes('always name the process'));
ok('and the question it was written against, so it can still be placed',
   scanCard.includes('Written against') && scanCard.includes('remaining peaches'));
ok('the corrected answer is kept as a key fact', scanCard.includes('They grow larger.'));
ok('a note with no question shows no such row',
   !api.notesCardHtml({ id: 's2', guidance: 'x', topics: [], keywords: [] }).includes('Written against'));
ok('the question is escaped like everything else on the card',
   api.notesCardHtml({ id: 's3', guidance: 'x', sourceQuestion: 'a <b>&</b>', topics: [], keywords: [] })
     .includes('a &lt;b&gt;&amp;&lt;/b&gt;'));

api.notes = [scanNote];
ok('and the rule really does reach a science prompt here',
   api._notesGuidanceBlock('').includes('always name the process'));
ok('a marking call obeys it too — guidance is the one field that reaches marking',
   api._notesMarkingBlock('').includes('always name the process'));
ok('the corrected answer reaches an ANSWER, never the marker',
   api._notesAnswerBlock('').includes('They grow larger.') &&
   !api._notesMarkingBlock('').includes('They grow larger.'));


/* ==================================================================
   THE CENSUS — the test that fails when a new AI call site is added
   ungrounded.

   "Every AI function checks the teaching notes first" is a promise that
   cannot be kept by remembering: a call site added next month is grounded
   or it is not, and nothing on any screen says which — the AI answers
   fluently in its own voice instead of the teacher's. So the file itself is
   read: every model call is found, the function it sits in is resolved, and
   anything that is neither grounded nor deliberately exempt is a FAILURE
   naming the function and its line.

   The exemption list is the point of it. Adding a call that should not be
   grounded means typing a sentence here saying why — which is a decision
   somebody made, rather than one nobody noticed.
   ================================================================== */
const UNGROUNDED_BY_DESIGN = {
  // ---- transport: they carry a prompt somebody else built ----
  _aiRun: 'the dispatcher — it is handed a finished prompt',
  _aiAsk: 'the failover loop — it is handed a finished prompt',
  askGemini: 'the door every text call goes through; the prompt arrives built',
  askGeminiDirect: 'the raw Gemini call',
  askGeminiCached: 'a cache in front of askGemini',
  askGeminiVision: 'the door every vision call goes through',
  askChatGpt: 'a named-engine wrapper round the same door',
  askKimi: 'a named-engine wrapper round the same door',
  askKimiDirect: 'the raw Moonshot call',
  askOpenAiServer: 'the Cloud Function transport',
  _widgetAskAI: 'the widget builder’s own transport — _widgetSpecPrompt is what is grounded',
  akcAskEngine: 'the cross-check transport — akcPrompt is what is grounded',

  // ---- reading the notes themselves ----
  notesHandleFiles: 'this is what READS the notes; grounding it is a feedback loop',
  styleWriteNotes: 'this is what WRITES a lesson out of the teacher’s own correction — it is handed the before and the after and asked what the app should have known. Grounding it in the notes is the same feedback loop: it would come back agreeing with what the app already believed rather than with what the teacher actually changed',

  // ---- transcription: a transcriber told what the answer should say writes
  //      that down instead of what is on the page ----
  _finishVoice: 'transcribes dictation',
  transcribeAudio: 'THE one transcription door — gemini-3.5-transcribe, with the ordinary model behind it. It is handed audio and asked for the words that were said, so grounding it in the marking standards would be a transcriber told what the answer ought to say, which is how a recording comes back as the answer somebody wanted rather than the one they spoke',
  epReadKey: 'transcribes a marking scheme off a photograph',
  _mpReadScript: 'transcribes a student’s handwriting — it is told never to mark',
  _mpReadKey: 'transcribes a marking scheme off a photograph',
  tblBuildFromShot: 'transcribes a TABLE off a screenshot — a reader told what the table ought to say writes that down instead of what is printed, which is the one failure here that looks exactly like success',

  // ---- pictures: no science words come back ----
  _aiRefineCrop: 'returns a rectangle, not words',
  tcgArtRescueIdentify: 'names which card a picture shows',
  generateCleanEnhancedImage: 'redraws a diagram',

  // ---- metadata ABOUT questions, not science said to anybody ----
  aiSuggestTags: 'proposes tags for a question',
  runBankAiSearch: 'turns a search box into a filter',
  qpAiRecommend: 'picks which questions to serve',
  aiPickTopic: 'files ONE question under a syllabus topic — metadata about the question, the same footing as aiSuggestTags. Grounding it would hand a filing call the marking standards and the exemplar answers, which is a great deal of prompt for a decision that is "which of these thirty names fits"',
  _classifyLOsWithAI: 'files questions under syllabus objectives',
  loAiFind: 'files questions under syllabus objectives',
  loSuggestLos: 'files one question under syllabus objectives',
  _ainsteinSearchYoutube: 'writes a YouTube search query',
  _ainsteinParseWorksheetSpec: 'parses a request into a worksheet spec',
  snapFindAndMark: 'MATCHES a photographed question to one in the bank; the marking itself goes through markOpenAnswersIn, which is grounded',
  runOeqCompare: 'compares the app’s answer against the OFFICIAL PSLE key — that key is the authority there, not the notes',
};

{
  const lines = src.split('\n');
  const fns = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) fns.push({ name: m[1], line: i });
  });
  const bodyOf = {};
  fns.forEach((f, k) => {
    const end = k + 1 < fns.length ? fns[k + 1].line : lines.length;
    bodyOf[f.name] = lines.slice(f.line, end).join('\n');
  });
  const groundedBody = n => /aiGrounding\s*\(|_markingPreamble\s*\(|_genPreamble\s*\(/.test(bodyOf[n] || '');
  // ONE HOP: a call site whose prompt is built by another top-level function
  // is grounded when THAT function is. Any deeper and the rule stops being
  // checkable by reading.
  const grounded = n => {
    if (groundedBody(n)) return true;
    const body = bodyOf[n] || '';
    return fns.some(f => f.name !== n && groundedBody(f.name) &&
      new RegExp('\\b' + f.name.replace(/\$/g, '\\$') + '\\s*\\(').test(body));
  };
  const owner = i => { let best = null; for (const f of fns) { if (f.line <= i) best = f; else break; } return best; };
  const callRe = /\baskGemini(?:Vision|Cached|Direct)?\s*\(|geminiModel\.generateContent\s*\(/;
  const seen = new Map();
  lines.forEach((l, i) => {
    if (!callRe.test(l)) return;
    const o = owner(i);
    if (!o) return;
    if (!seen.has(o.name)) seen.set(o.name, i + 1);
  });
  ok('the census found the model call sites at all', seen.size > 20, seen.size + ' found');
  const loose = [];
  for (const [name, line] of seen) {
    if (grounded(name)) continue;
    if (Object.prototype.hasOwnProperty.call(UNGROUNDED_BY_DESIGN, name)) continue;
    loose.push(name + ' (app.js:' + line + ')');
  }
  ok('every AI call site is grounded in the teaching notes, or exempt on purpose', loose.length === 0,
     loose.length ? 'UNGROUNDED:\n        ' + loose.join('\n        ') : '');
  // A stale exemption is how a RENAMED function slips back through.
  const stale = Object.keys(UNGROUNDED_BY_DESIGN).filter(n => !bodyOf[n]);
  ok('no exemption names a function that no longer exists', stale.length === 0, stale.join(', '));
}

console.log((fails ? '✗ ' : '✓ ') + (ran - fails) + '/' + ran + ' checks passed');
process.exit(fails ? 1 : 0);
