// Regression tests for THE STUDENT USAGE TRACKER.
// Run with:
//     node tools/usage-tracker-tests.mjs            all cases
//     node tools/usage-tracker-tests.mjs <name>     one case
//
// It loads the REAL tracker out of app.js and runs it over a synthetic attempt
// log. Every failure here is SILENT — the overlay opens, the tables paint, the
// numbers look plausible, and a teacher acts on them:
//
//  • A MODE THAT FALLS OUT OF THE LOG IS A CHILD'S WORK MADE INVISIBLE. The
//    whole promise is "every question, and the mode it was done in", so an
//    unlabelled mode must still show — as its own raw string — rather than be
//    dropped or merged into "Unknown", which would silently fold two different
//    games into one row of the breakdown.
//  • THE VERDICT THRESHOLD MUST MATCH THE REST OF THE APP (≥0.95). Move it and
//    the tracker and the progress counters disagree about the same answer, with
//    nothing to say which of the two is lying.
//  • THE FILTERS AND THE EXPORT MUST READ THE SAME WINDOW. A CSV that quietly
//    holds more rows than the table it was exported from is a teacher sending a
//    parent a report of work in a mode they had filtered away.
//  • A PART-RIGHT ANSWER IS NOT A WRONG ONE. Rounding credit to a pass or a
//    fail understates every open-ended answer in the log at once.
//  • THE ANSWER SHOWN MUST BE THE ANSWER GIVEN. The panel is the only place a
//    teacher can check the AI's marking, so a part labelled wrong, an expected
//    answer shown as the student's, or an empty panel with no explanation each
//    turn "read what they wrote" into a thing nobody trusts twice.
//  • AN OVERRIDE MUST BE HONOURED EVERYWHERE OR NOWHERE. `sutCredit` is the one
//    place it is read; if the row shows the teacher's mark while the average,
//    the result filter or the export still count the AI's, the dashboard is
//    quietly disagreeing with itself on the one row somebody looked at closely.
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

// Only what the tracker itself reaches for.
const FIXTURE = `
let questionBank = [];
const RAPID_ATTEMPT_MS = 15000;
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function attemptTime(a) { return (a && a.timestamp) ? (a.timestamp.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp).getTime()) : 0; }
function formatGap(ms) { return ms == null ? '—' : Math.round(ms / 1000) + 's'; }
function formatDateTimeSGT(d) { return d.toISOString(); }
const APP_VERSION = 'vX.Y.Z';
let _openPartResults = {}, _openItemsStore = {};
// The tracker repaints itself after every toggle and every override; the pure
// half under test does not own that, so it is stubbed out.
function sutRender() {}
`;

// The tracker's pure half — everything up to the first function that touches
// the DOM. Cutting at showStudentDetail keeps the harness free of a document.
const block = cut('const USAGE_MODES = {', '\n// Open the tracker on one student.', 'tracker');

/* The other half: what is written down at marking time. It sits with the
   marking code rather than the tracker, so it is cut separately — and it has
   to be tested, because everything it can get wrong is invisible until a
   teacher opens a row weeks later and finds the wrong thing in it. */
const capture = cut('const SUT_ANS_CHARS', '\n// Once a part is marked', 'capture');
const C = new Function(FIXTURE + capture + `
return {
  _attemptAnswers,
  SUT_ANS_CHARS, SUT_ANS_PARTS,
  seed(results, items) { _openPartResults = { '#s': results }; _openItemsStore = { '#s': items || [] }; }
};
`)();

const T = new Function(FIXTURE + block + `
return {
  usageMode, usageModeChip, sutCredit, sutVerdict, sutQuestionMeta, sutVisible, sutByMode,
  sutOverrideOf, sutAnswerRowsHtml, sutOverrideHtml, sutToggleRow,
  MODES: USAGE_MODES,
  state() { return _sut; },
  seed(rows, bank) {
    questionBank = bank || [];
    (rows || []).forEach(a => { a._t = attemptTime(a); a._q = sutQuestionMeta(a); });
    let prev = null;
    (rows || []).slice().sort((x, y) => x._t - y._t).forEach(a => { a._gap = prev == null ? null : a._t - prev; prev = a._t; });
    _sut = { uid: 'u1', name: 'Test', email: '', all: rows || [], mode: '', result: '', days: '', search: '', loading: false,
             open: new Set(), saving: '' };
  },
  filter(k, v) { _sut[k] = v; },
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};

const DAY = 86400000;
const at = (mode, score, total, agoDays, qid) => ({
  mode, score, totalBlanks: total, questionId: qid || 'q1',
  timestamp: new Date(Date.now() - agoDays * DAY)
});

// ── the mode is what a human calls it ───────────────────────────────────────

test('a known mode is named, not printed raw', () => {
  eq(T.usageMode('tcg-siege').label, 'Ember Siege', 'the Siege label');
  eq(T.usageMode('quickpractice-open').label, 'Quick Practice', 'Quick Practice label');
  eq(T.usageMode('tcg-siege').group, 'game', 'the Siege group');
  eq(T.usageMode('quickpractice-open').group, 'practice', 'Quick Practice group');
});

test('an UNKNOWN mode keeps its own string and is never merged away', () => {
  const a = T.usageMode('some-new-mode');
  eq(a.label, 'some-new-mode', 'an unlabelled mode must show as itself');
  eq(a.key, 'some-new-mode', 'its key must survive, or the filter cannot select it');
  const b = T.usageMode('another-new-mode');
  ok(a.key !== b.key, 'two unlabelled modes must stay distinguishable');
});

test('every group is one the CSS can paint', () => {
  const allowed = ['practice', 'game', 'other'];
  Object.entries(T.MODES).forEach(([k, m]) => {
    ok(allowed.indexOf(m.group) >= 0, 'mode ' + k + ' has group "' + m.group + '", which has no chip colour');
    ok(m.label && m.icon, 'mode ' + k + ' is missing a label or icon');
  });
});

test('a blank mode reads as not recorded rather than crashing', () => {
  eq(T.usageMode('').label, 'Not recorded', 'a missing mode');
  eq(T.usageMode(undefined).group, 'other', 'a missing mode groups as other');
});

// ── the result ──────────────────────────────────────────────────────────────

test('the verdict threshold is the app-wide 0.95, and part-right is its own answer', () => {
  eq(T.sutVerdict(at('practice', 1, 1, 0)).key, 'correct', 'full marks');
  eq(T.sutVerdict(at('practice', 19, 20, 0)).key, 'correct', '95% is correct');
  eq(T.sutVerdict(at('practice', 1, 2, 0)).key, 'partial', 'half marks is PART right, not wrong');
  eq(T.sutVerdict(at('practice', 0, 3, 0)).key, 'wrong', 'nothing earned');
});

test('credit is fractional, so an open answer is not rounded into a pass or a fail', () => {
  eq(T.sutCredit(at('practice', 3, 4, 0)), 0.75, 'three of four marks');
  eq(T.sutCredit(at('practice', 5, 0, 0)), null, 'out of nothing is unmeasurable, not zero');
});

test('a score outside its own total cannot leave the 0..1 range', () => {
  eq(T.sutCredit(at('practice', 9, 4, 0)), 1, 'over-award clamps to full');
  eq(T.sutCredit(at('practice', -3, 4, 0)), 0, 'a negative clamps to nothing');
});

// ── the breakdown by mode ───────────────────────────────────────────────────

test('the breakdown counts each mode separately and averages within it', () => {
  const rows = [
    at('tcg-siege', 1, 1, 1), at('tcg-siege', 1, 1, 1), at('tcg-siege', 0, 1, 1),
    at('quickpractice-open', 1, 2, 2)
  ];
  T.seed(rows, []);
  const by = T.sutByMode(rows);
  const siege = by.find(r => r.m.key === 'tcg-siege');
  const qp = by.find(r => r.m.key === 'quickpractice-open');
  eq(siege.n, 3, 'Siege attempts');
  eq(siege.correct, 2, 'Siege fully correct');
  eq(Math.round(siege.sum / siege.scored * 100), 67, 'Siege average');
  eq(qp.n, 1, 'Quick Practice attempts');
  eq(qp.correct, 0, 'a half-marks answer is not a correct one');
});

test('practice modes sort ahead of games, so a teacher reads the schoolwork first', () => {
  const rows = [at('tcg-siege', 1, 1, 1), at('tcg-siege', 1, 1, 1),
                at('quickpractice-open', 1, 1, 1)];
  T.seed(rows, []);
  const by = T.sutByMode(rows);
  eq(by[0].m.group, 'practice', 'practice must come first even when a game has more attempts');
});

// ── the filters, and the window the export shares ───────────────────────────

test('the mode filter narrows to exactly that mode', () => {
  T.seed([at('tcg-siege', 1, 1, 1), at('practice-open', 1, 1, 1), at('tcg-duel', 0, 1, 1)], []);
  T.filter('mode', 'tcg-siege');
  const v = T.sutVisible();
  eq(v.length, 1, 'rows left standing');
  eq(v[0].mode, 'tcg-siege', 'the mode that survived');
});

test('the result filter tells part-right apart from wrong', () => {
  T.seed([at('practice', 1, 1, 1), at('practice', 1, 2, 1), at('practice', 0, 1, 1)], []);
  T.filter('mode', ''); T.filter('result', 'partial');
  eq(T.sutVisible().length, 1, 'only the part-right answer');
  T.filter('result', 'wrong');
  eq(T.sutVisible().length, 1, 'only the wrong answer');
  T.filter('result', '');
});

test('the date window keeps today and drops last month', () => {
  T.seed([at('practice', 1, 1, 0), at('practice', 1, 1, 3), at('practice', 1, 1, 40)], []);
  T.filter('days', '7');
  eq(T.sutVisible().length, 2, 'the last seven days');
  T.filter('days', '1');
  eq(T.sutVisible().length, 1, 'today only');
  T.filter('days', '');
  eq(T.sutVisible().length, 3, 'all time puts them all back');
});

test('the search reads the question and its topic, not the raw id', () => {
  const bank = [{ id: 'q1', title: 'Photosynthesis in bright light', topic: 'Plants', category: 'Biology' },
                { id: 'q2', title: 'Melting ice', topic: 'Matter', category: 'Physics' }];
  T.seed([at('practice', 1, 1, 1, 'q1'), at('practice', 1, 1, 1, 'q2')], bank);
  T.filter('search', 'photosynthesis');
  eq(T.sutVisible().length, 1, 'matched by title');
  T.filter('search', 'matter');
  eq(T.sutVisible().length, 1, 'matched by topic');
  T.filter('search', '');
});

test('the filters compose rather than override one another', () => {
  T.seed([at('tcg-siege', 1, 1, 0), at('tcg-siege', 0, 1, 0), at('practice', 1, 1, 0),
          at('tcg-siege', 1, 1, 40)], []);
  T.filter('mode', 'tcg-siege'); T.filter('result', 'correct'); T.filter('days', '7');
  eq(T.sutVisible().length, 1, 'Siege + correct + this week');
  T.filter('mode', ''); T.filter('result', ''); T.filter('days', '');
});

// ── the question a row is about ─────────────────────────────────────────────

test('the title comes from the BANK, so a game attempt that stored none still names it', () => {
  const bank = [{ id: 'q7', title: 'Circuits and switches', topic: 'Electricity' }];
  T.seed([{ mode: 'tcg-siege', score: 1, totalBlanks: 1, questionId: 'q7', questionTitle: '',
            timestamp: new Date() }], bank);
  const m = T.sutQuestionMeta(T.state().all[0]);
  eq(m.title, 'Circuits and switches', 'the resolved title');
  eq(m.meta, 'Electricity', 'the resolved topic');
  eq(m.gone, false, 'it is still in the bank');
});

test('the LIVE bank title wins over the one frozen on the attempt', () => {
  const bank = [{ id: 'q7', title: 'Circuits and switches (revised)' }];
  T.seed([{ mode: 'practice', score: 1, totalBlanks: 1, questionId: 'q7',
            questionTitle: 'Circuits and switches', timestamp: new Date() }], bank);
  eq(T.sutQuestionMeta(T.state().all[0]).title, 'Circuits and switches (revised)',
     'an edited question must not show its old title forever');
});

test('a question deleted since is SAID to be gone, never dropped from the log', () => {
  T.seed([{ mode: 'practice', score: 1, totalBlanks: 1, questionId: 'zzz',
            questionTitle: 'Old question', timestamp: new Date() }], []);
  const m = T.sutQuestionMeta(T.state().all[0]);
  eq(m.gone, true, 'it must be flagged as removed');
  eq(m.title, 'Old question', 'the title stamped on the attempt still stands in');
  eq(T.sutVisible().length, 1, 'the work was still done — the row must stay');
});

// ── the whole log survives the round trip ───────────────────────────────────

test('no attempt is lost between the log and the breakdown', () => {
  const rows = [at('tcg-siege', 1, 1, 1), at('practice', 1, 1, 1), at('brand-new-mode', 1, 1, 1),
                at('', 1, 1, 1), at('tcg-duel', 0, 1, 1)];
  T.seed(rows, []);
  const total = T.sutByMode(T.sutVisible()).reduce((n, r) => n + r.n, 0);
  eq(total, rows.length, 'the breakdown must account for every single attempt');
});

// ── what the child actually wrote ───────────────────────────────────────────
// The panel is the ONLY place a teacher can check the AI's marking, so every
// way it can mislead is a way the whole feature stops being trusted.

const withAns = (parts, mode) => Object.assign(at(mode || 'quickpractice-open', 1, parts.length, 1),
  { _id: 'a1', answers: parts });

test('the panel shows what they put, beside what was wanted', () => {
  const h = T.sutAnswerRowsHtml(withAns([
    { label: 'Claim', student: 'the ice melted', expected: 'it gained heat', verdict: 'incorrect', pts: 0 }
  ]));
  ok(h.includes('the ice melted'), 'their own words have to be on screen');
  ok(h.includes('it gained heat'), 'and what was expected, or there is nothing to judge against');
  ok(h.includes('Claim'), 'the part must be named — an unlabelled answer belongs to no question');
});

test('a blank answer SAYS it was blank rather than showing nothing', () => {
  const h = T.sutAnswerRowsHtml(withAns([{ label: 'Answer', student: '', expected: 'evaporation', verdict: 'incorrect' }]));
  ok(/Left blank/i.test(h), 'an empty box reads as a broken panel, not as an unanswered question');
});

test('an answer is ESCAPED — it is text a child typed, not markup', () => {
  const h = T.sutAnswerRowsHtml(withAns([{ label: 'A', student: '<img src=x onerror=alert(1)>', expected: '', verdict: 'incorrect' }]));
  ok(!/<img/.test(h), 'a typed tag must never reach the page as a tag');
  ok(h.includes('&lt;img'), 'it must still be readable as what they wrote');
});

test('a GAME says why there is nothing to read, rather than looking broken', () => {
  const h = T.sutAnswerRowsHtml(Object.assign(at('tcg-siege', 1, 1, 1), { _id: 'g1' }));
  ok(/game logs whether/i.test(h), 'the reason must be given');
  ok(/Ember Siege/.test(h), 'and it must name the mode, so it reads as a fact about that game');
});

test('an attempt from before answers were kept says exactly that', () => {
  const h = T.sutAnswerRowsHtml(Object.assign(at('quickpractice-open', 2, 3, 400), { _id: 'o1' }));
  ok(/No answer was recorded/i.test(h), 'silence here reads as a fault in the panel');
  ok(/fingerprint/i.test(h), 'and it must say the wording cannot be recovered, or somebody will go looking');
});

// ── the teacher's mark, over the AI's ───────────────────────────────────────

test('an override is read, clamped, and only when it is a real number', () => {
  const base = { score: 1, totalBlanks: 3 };
  eq(T.sutOverrideOf(Object.assign({}, base, { override: { score: 3, by: 'me' } })).score, 3, 'a plain override');
  eq(T.sutOverrideOf(Object.assign({}, base, { override: { score: 9 } })).score, 3, 'a mark above the total is capped');
  eq(T.sutOverrideOf(Object.assign({}, base, { override: { score: -2 } })).score, 0, 'and one below zero is floored');
  eq(T.sutOverrideOf(Object.assign({}, base, { override: { score: 'x' } })), null, 'a score that will not parse is NOT an override');
  eq(T.sutOverrideOf(Object.assign({}, base, { override: {} })), null, 'nor is an empty object');
  eq(T.sutOverrideOf(base), null, 'and an untouched attempt has none');
});

test('the teacher\'s mark wins in the ROW, the verdict and the average alike', () => {
  // The AI gave 0/3; the teacher says it was worth all three.
  const a = Object.assign(at('quickpractice-open', 0, 3, 1), { _id: 'x1', override: { score: 3, by: 'me' } });
  T.seed([a], []);
  eq(T.sutCredit(a), 1, 'credit must follow the override');
  eq(T.sutVerdict(a).key, 'correct', 'and so must the verdict chip');
  eq(T.sutByMode(T.sutVisible())[0].correct, 1, 'and the by-mode breakdown');
  eq(Math.round(T.sutByMode(T.sutVisible())[0].sum * 100), 100, 'and the average it prints');
});

test('…and the RESULT FILTER follows it too, or the row hides from its own verdict', () => {
  const a = Object.assign(at('quickpractice-open', 0, 2, 1), { _id: 'x2', override: { score: 2 } });
  T.seed([a], []);
  T.state().result = 'correct';
  eq(T.sutVisible().length, 1, 'filtering to Correct must find an attempt the teacher marked correct');
  T.state().result = 'wrong';
  eq(T.sutVisible().length, 0, 'and must NOT still find it under the AI\'s old verdict');
});

test('the override panel offers the mark out of the SAME total the question was marked on', () => {
  const a = Object.assign(at('quickpractice-open', 1, 3, 1), { _id: 'x3' });
  T.seed([a], []);
  const h = T.sutOverrideHtml(a);
  ok(/max="3"/.test(h), 'the cap has to be the question\'s own total');
  ok(/out of 3/.test(h), 'and it has to say so');
  ok(/does <b>not<\/b> change the points/i.test(h), 'what an override does NOT do must be on screen, not assumed');
});

test('an attempt with no record id cannot be re-marked, and says so', () => {
  const a = at('quickpractice-open', 1, 2, 1);        // no _id
  T.seed([a], []);
  const h = T.sutOverrideHtml(a);
  ok(/cannot be re-marked/i.test(h), 'a Save button that could never write must not be offered');
  ok(!/sutSaveOverride/.test(h), 'and its handler must not be wired up either');
});

test('expanding is per row, and a row can be closed again', () => {
  T.seed([Object.assign(at('practice', 1, 1, 1), { _id: 'r1' })], []);
  T.sutToggleRow('r1');
  ok(T.state().open.has('r1'), 'a click opens exactly that row');
  T.sutToggleRow('r1');
  ok(!T.state().open.has('r1'), 'and a second click closes it');
});

// ── what gets written down in the first place ───────────────────────────────

test('the part is NAMED from its key, so nothing has to be threaded through six call sites', () => {
  C.seed({ 'open:0': { verdict: 'correct', pts: 1, expected: 'heat', student: 'heat' },
           'mcq:b7':  { verdict: 'incorrect', pts: 0, expected: '2) copper', student: '3' } },
         [{ label: 'Reasoning' }]);
  const out = C._attemptAnswers('#s');
  eq(out.length, 2, 'both parts must be kept');
  eq(out[0].label, 'Reasoning', 'an open part takes the label the marker gave it');
  eq(out[1].label, 'Multiple choice', 'and an MCQ is named for what it is');
});

test('an unnamed open part still gets a name rather than an empty heading', () => {
  C.seed({ 'open:4': { verdict: 'correct', pts: 1, expected: 'x', student: 'y' } }, []);
  eq(C._attemptAnswers('#s')[0].label, 'Answer', 'a missing item label must not print as nothing');
});

test('the student and the expected answer do not get swapped', () => {
  C.seed({ 'open:0': { verdict: 'incorrect', pts: 0, expected: 'condensation', student: 'evaporation' } },
         [{ label: 'Answer' }]);
  const a = C._attemptAnswers('#s')[0];
  eq(a.student, 'evaporation', 'what the child wrote');
  eq(a.expected, 'condensation', 'and what was wanted — reversed, the panel teaches the opposite');
});

test('a long answer is CLIPPED, or one essay makes the attempt unwritable', () => {
  C.seed({ 'open:0': { verdict: 'correct', pts: 1, expected: '', student: 'z'.repeat(5000) } }, []);
  const a = C._attemptAnswers('#s')[0];
  ok(a.student.length <= C.SUT_ANS_CHARS + 1, 'it must be cut to the cap');
  ok(a.student.endsWith('…'), 'and say it was cut, or it reads as the child stopping mid-word');
});

test('the number of parts is capped too', () => {
  const many = {};
  for (let i = 0; i < C.SUT_ANS_PARTS + 12; i++) many['open:' + i] = { verdict: 'correct', pts: 1, expected: 'a', student: 'b' };
  C.seed(many, []);
  eq(C._attemptAnswers('#s').length, C.SUT_ANS_PARTS, 'a document that will not save is a mark that was never recorded');
});

test('nothing marked writes nothing — never a row of empty parts', () => {
  C.seed({}, []);
  eq(C._attemptAnswers('#s').length, 0, 'an empty log must stay empty');
  eq(C._attemptAnswers('#never-opened').length, 0, 'and an unknown surface must not throw');
});

// ── run ─────────────────────────────────────────────────────────────────────

const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name !== only) continue;
  try { c.fn(); pass++; console.log('  ✅ ' + c.name); }
  catch (e) { fail++; console.log('  ❌ ' + c.name + '\n       ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
