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

const api = new Function(`
  let teachingNotes = [];
  ${src.slice(a, b)}
  return {
    set notes(v) { teachingNotes = v; },
    _noteSuitsThisApp, _notesFor,
    _notesGuidanceBlock, _notesMarkingBlock, _notesGenBlock, _notesAnswerBlock
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
api.notes = [{ id: 'g3', guidance: 'x'.repeat(4000), topics: [] }];
ok('the guidance budget is capped', api._notesGuidanceBlock().length < 1900,
   'length ' + api._notesGuidanceBlock().length);

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

console.log((fails ? '✗ ' : '✓ ') + (ran - fails) + '/' + ran + ' checks passed');
process.exit(fails ? 1 : 0);
