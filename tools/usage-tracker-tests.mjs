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
`;

// The tracker's pure half — everything up to the first function that touches
// the DOM. Cutting at showStudentDetail keeps the harness free of a document.
const block = cut('const USAGE_MODES = {', '\n// Open the tracker on one student.', 'tracker');

const T = new Function(FIXTURE + block + `
return {
  usageMode, usageModeChip, sutCredit, sutVerdict, sutQuestionMeta, sutVisible, sutByMode,
  MODES: USAGE_MODES,
  state() { return _sut; },
  seed(rows, bank) {
    questionBank = bank || [];
    (rows || []).forEach(a => { a._t = attemptTime(a); a._q = sutQuestionMeta(a); });
    let prev = null;
    (rows || []).slice().sort((x, y) => x._t - y._t).forEach(a => { a._gap = prev == null ? null : a._t - prev; prev = a._t; });
    _sut = { uid: 'u1', name: 'Test', email: '', all: rows || [], mode: '', result: '', days: '', search: '', loading: false };
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
