// Regression tests for 🔎 WHY NOT THIS ONE — the ⓘ on a marked question's
// wrong options, and the same reasons on the printed answer key.
// Run with:
//     node tools/why-not-tests.mjs            all cases
//     node tools/why-not-tests.mjs <name>     one case
//
// It loads the REAL helpers out of app.js. This feature tells a child
// something about a question they have just got wrong, and prints it on the
// sheet a teacher marks from — so every way it fails is a way of stating
// something untrue, confidently, on a page that looks perfectly right:
//
//  • A REASON UNDER THE WRONG OPTION is the one that cannot be seen at all.
//    "There are only 2 producers, so 3 is wrong" shown against option 2 reads
//    exactly as well as it does against option 3, and teaches the opposite of
//    the truth. _wnyNormItems places every entry by the option's OWN number
//    and drops anything it cannot place.
//  • THE ANSWER LISTED AMONG THE REASONS IT IS NOT. The printed rows say why
//    each option is *not* the answer; the correct one appearing there is the
//    key contradicting itself two lines below the answer it just gave.
//  • THE TWO SURFACES DRIFTING. The hover and the printed key share one
//    generator and one cache key, built from _wnyOpts — so a block and a
//    marking-store entry describing the same four options MUST normalise to
//    the same thing. If they stop doing so, the student reads one sentence
//    and the teacher marks from another, and every print re-bills the AI.
//  • ARMED BEFORE MARKING. The badges go on the WRONG options, so a question
//    wearing them before it is answered points straight at the right one.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
// The switches live in the markup, so the wiring check reads both files: a
// wnyPrintOn('saved') pointing at a checkbox nobody put on the page is a
// toggle that is always off, which looks exactly like a feature that is off.
const html = fs.readFileSync(new URL('../index.html', import.meta.url).pathname, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b);
};

// escapeHtml goes through document.createElement in the app, so the harness
// supplies a faithful stand-in — what is under test here is that the model's
// text is escaped AT ALL, not the browser's own entity table.
const M = new Function(`
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
` +
  cut('function stripHtml(content) {', '\n// Add one answer-key section', 'stripHtml') +
  cut('function _normMcqChoice(raw) {', '\nfunction normalizeCategoryValue', 'normMcqChoice') +
  cut('const WNY_HOVER_MS', 'function _wnyPrompt(q, opts)', 'why-not core') +
  cut('function _wnyPrintJobs(selected) {', '\n// The pre-pass', 'print jobs') +
  cut('function _wnyKeyRows(block, why, ci) {', '\n// =====', 'key rows') +
  // …and the REAL answer-key pusher on top of it, so the section it builds is
  // tested as the printed key actually assembles it, not as a mock of it.
  "const QPART_ASSIGN = " + /const QPART_ASSIGN = ('[a-z]*')/.exec(src)[1] + ';\n' +
  "function transformImageUrl(u) { return String(u || ''); }\n" +
  cut('function qPartNormalize', '// The part each block belongs to', 'part helpers') +
  cut('function _pushAnnotAnswerKey', '// How many ruled lines a printed answer box gets', 'answer-key pushers') + `
return { opts: _wnyOpts, usable: _wnyUsable, clean: _wnyClean, norm: _wnyNormItems,
         jobs: _wnyPrintJobs, rows: _wnyKeyRows, push: _pushBlockAnswerKey,
         akHtml: _akSectionsHtml, MAX: WNY_WHY_MAX, PAR: WNY_PRINT_PAR };`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
};

// A four-option food-web question, in both of the shapes the app carries it in.
const BLOCK = {
  id: 'b1', type: 'mcq', correctId: 'o2',
  options: [
    { id: 'o1', text: '1' }, { id: 'o2', text: '2' },
    { id: 'o3', text: '3' }, { id: 'o4', text: '4' }
  ]
};
const STORE = {
  blockId: 'b1',
  options: BLOCK.options.map((o, i) => ({ letter: String(i + 1), text: o.text, id: o.id, correct: o.id === BLOCK.correctId }))
};

// ── one shape, so the hover and the printed key ask the same question ───────

test('a block and a marking-store entry normalise to the same options', () => {
  eq(JSON.stringify(M.opts(BLOCK)), JSON.stringify(M.opts(STORE)),
     'the two shapes disagree — hover and print would build different prompts, so different cache keys and different sentences');
});

test('the correct option is the one the question actually ticked', () => {
  const o = M.opts(BLOCK);
  eq(o.filter(x => x.correct).length, 1, 'exactly one correct');
  eq(o.find(x => x.correct).letter, '2', 'correctId o2 is option 2');
  eq(o[0].letter, '1', 'options are numbered from 1');
});

test('option text is flattened out of its markup', () => {
  const b = { type: 'mcq', correctId: 'x', options: [{ id: 'x', text: '<b>arrowhead</b>  and\n water lily' }, { id: 'y', text: 'algae' }] };
  eq(M.opts(b)[0].text, 'arrowhead and water lily', 'stripped and collapsed');
});

// ── is there anything to explain at all ─────────────────────────────────────

test('a question with no correct option ticked is refused', () => {
  // "Why is this one wrong" has no answer when nothing is recorded as right,
  // and a badge that cannot keep its promise is worse than no badge.
  ok(!M.usable(M.opts({ type: 'mcq', correctId: null, options: BLOCK.options })), 'no correctId');
  ok(!M.usable(M.opts({ type: 'mcq', correctId: 'nope', options: BLOCK.options })), 'correctId matching nothing');
  ok(M.usable(M.opts(BLOCK)), 'a properly ticked question is usable');
});

test('fewer than two options is refused', () => {
  ok(!M.usable(M.opts({ type: 'mcq', correctId: 'o1', options: [{ id: 'o1', text: 'only one' }] })), 'one option');
  ok(!M.usable([]), 'none');
});

test('the print pre-pass only picks up questions it can explain', () => {
  const good = { id: 'q1', blocks: [{ type: 'text', content: 'x' }, BLOCK] };
  const unticked = { id: 'q2', blocks: [{ type: 'mcq', correctId: null, options: BLOCK.options }] };
  const open = { id: 'q3', blocks: [{ type: 'plainanswer', content: 'x' }] };
  const twoParts = { id: 'q4', blocks: [BLOCK, { type: 'mcq', correctId: 'p2', options: [{ id: 'p1', text: 'a' }, { id: 'p2', text: 'b' }] }] };
  eq(M.jobs([good, unticked, open]).length, 1, 'one job');
  eq(M.jobs([twoParts]).length, 2, 'a question with two MCQ parts is two jobs');
  eq(M.jobs([]).length, 0, 'nothing');
  eq(M.jobs(null).length, 0, 'null');
});

// ── which option each reason belongs to: the silent one ─────────────────────

test('reasons are placed by the option number the model gave', () => {
  const map = M.norm({ options: [
    { n: '3', why: 'there are only 2 producers' },
    { n: '1', why: 'that counts the consumers too' }
  ] }, M.opts(BLOCK));
  eq(map['3'], 'there are only 2 producers', 'entry n=3');
  eq(map['1'], 'that counts the consumers too', 'entry n=1');
  eq(map['2'], undefined, 'nothing invented for option 2');
});

test('the number is read the way every other MCQ field is', () => {
  // _normMcqChoice already turns "(2)", "2." and "B" into 2 everywhere else.
  const opts = M.opts(BLOCK);
  eq(M.norm({ options: [{ n: '(4)', why: 'four' }] }, opts)['4'], 'four', 'bracketed');
  eq(M.norm({ options: [{ n: '3.', why: 'three' }] }, opts)['3'], 'three', 'trailing stop');
  eq(M.norm({ options: [{ n: 'C', why: 'letter' }] }, opts)['3'], 'letter', 'a letter');
  eq(M.norm({ options: [{ option: 1, why: 'numeric' }] }, opts)['1'], 'numeric', 'a number, under "option"');
});

test('an option number the list does not have is dropped, never squeezed in', () => {
  const map = M.norm({ options: [{ n: '9', why: 'nowhere' }, { n: '1', why: 'here' }] }, M.opts(BLOCK));
  eq(Object.keys(map).sort().join(','), '1', 'only the real one survives');
});

test('a repeated number is a duplicate, so the first one wins', () => {
  const map = M.norm({ options: [{ n: '1', why: 'first' }, { n: '1', why: 'second' }] }, M.opts(BLOCK));
  eq(map['1'], 'first', 'first wins');
});

test('positional order is used ONLY when the model numbered nothing at all', () => {
  const opts = M.opts(BLOCK);
  const all = M.norm({ options: [{ why: 'a' }, { why: 'b' }, { why: 'c' }, { why: 'd' }] }, opts);
  eq(all['1'] + all['2'] + all['3'] + all['4'], 'abcd', 'one per option, in order');
  // A PARTIAL unnumbered list cannot be lined up — the third entry might belong
  // to option 3 or to option 4 — and guessing shows a child the wrong reason
  // with every appearance of being right.
  eq(Object.keys(M.norm({ options: [{ why: 'a' }, { why: 'b' }] }, opts)).length, 0, 'partial unnumbered dropped');
  // One numbered entry means the model WAS numbering; the rest are not
  // positional, they are unplaceable.
  const mixed = M.norm({ options: [{ n: '2', why: 'two' }, { why: 'no idea' }, { why: 'nor this' }, { why: 'nor this' }] }, opts);
  eq(Object.keys(mixed).join(','), '2', 'a numbered entry disables the fallback');
});

test('an empty reason is not stored, and a long one is clipped', () => {
  const opts = M.opts(BLOCK);
  eq(M.norm({ options: [{ n: '1', why: '   ' }] }, opts)['1'], undefined, 'blank');
  const long = 'x'.repeat(M.MAX + 200);
  eq(M.norm({ options: [{ n: '1', why: long }] }, opts)['1'].length, M.MAX, 'clipped to WNY_WHY_MAX');
  eq(M.clean('  spaced \n out  '), 'spaced out', 'whitespace folded');
});

test('a reply in a shape nobody expected yields nothing rather than nonsense', () => {
  const opts = M.opts(BLOCK);
  eq(Object.keys(M.norm(null, opts)).length, 0, 'null');
  eq(Object.keys(M.norm({}, opts)).length, 0, 'empty object');
  eq(Object.keys(M.norm({ options: 'not a list' }, opts)).length, 0, 'string');
  eq(Object.keys(M.norm({ options: ['just a string'] }, opts)).length, 0, 'unnumbered strings, wrong count');
});

// ── the printed key ─────────────────────────────────────────────────────────

test('the correct option is NEVER listed among the reasons it is not the answer', () => {
  const why = { '1': 'one is wrong', '2': 'two is right', '3': 'three is wrong', '4': 'four is wrong' };
  const rows = M.rows(BLOCK, why, 1);   // option 2 (index 1) is the answer
  ok(!rows.includes('two is right'), 'the answer appeared under "why the other options are wrong"');
  ['one is wrong', 'three is wrong', 'four is wrong'].forEach(t => ok(rows.includes(t), 'missing: ' + t));
});

test('each row carries the option number the student sees on the paper', () => {
  const rows = M.rows(BLOCK, { '1': 'aaa', '3': 'ccc' }, 1);
  ok(rows.indexOf('<b>1.</b>') >= 0, 'option 1 numbered');
  ok(rows.indexOf('<b>3.</b>') >= 0, 'option 3 numbered');
  ok(rows.indexOf('<b>1.</b>') < rows.indexOf('<b>3.</b>'), 'printed in the paper\'s own order');
});

test('an option with no reason simply has no row', () => {
  eq(M.rows(BLOCK, { '3': 'only this one' }, 1).match(/ak-why/g).length, 1, 'one row');
  eq(M.rows(BLOCK, {}, 1), '', 'no reasons at all → no rows, so no empty heading');
  eq(M.rows(BLOCK, null, 1), '', 'null');
  eq(M.rows(null, { '1': 'x' }, 1), '', 'no block');
});

test('the model\'s text is escaped into the key', () => {
  const rows = M.rows(BLOCK, { '1': 'a < b & <img src=x>' }, 1);
  ok(rows.includes('&lt;img'), 'markup in a model reply must not reach the page as markup');
  ok(!rows.includes('<img'), 'raw tag leaked');
});

test('the printed key gains the section only when the notes were asked for', () => {
  // Straight through the REAL pusher, the way a print assembles it.
  const plain = [];
  M.push(plain, BLOCK, '', null);
  eq(plain.length, 1, 'no notes → the answer and nothing else');
  eq(plain[0].label, 'Answer', 'the answer is still the answer');

  const withNotes = [];
  M.push(withNotes, BLOCK, '', { b1: { '1': 'only 2 producers', '3': 'that counts a consumer' } });
  eq(withNotes.length, 2, 'notes → the answer AND the reasons');
  eq(withNotes[1].label, 'Why the other options are wrong', 'the heading');
  ok(withNotes[1].content.includes('only 2 producers'), 'option 1\'s reason');
  ok(!withNotes[1].content.includes('<b>2.</b>'), 'the answer must not be listed among the reasons it is not');
});

test('a question with no answer ticked gets no reasons either', () => {
  // The reasons are teaching notes BESIDE an answer. Offering them where the
  // key cannot even name the answer would be the wrong way up — and the
  // "no answer recorded" placeholder is what has to surface that gap.
  const s = [];
  M.push(s, { type: 'mcq', correctId: null, options: BLOCK.options }, '', { b1: { '1': 'a reason' } });
  eq(s.length, 0, 'nothing at all');
});

test('the notes are keyed by BLOCK id, so a two-part question keeps them apart', () => {
  const second = { id: 'b2', type: 'mcq', correctId: 'p1', options: [{ id: 'p1', text: 'yes' }, { id: 'p2', text: 'no' }] };
  const s = [];
  M.push(s, second, 'b', { b1: { '1': 'part a reason' }, b2: { '2': 'part b reason' } });
  eq(s.length, 2, 'answer + reasons');
  ok(s[1].content.includes('part b reason'), 'this part\'s own reason');
  ok(!s[1].content.includes('part a reason'), 'the other part\'s reason leaked in');
  eq(s[1].part, 'b', 'filed under its own part');
});

// ── the wiring, which is what keeps it honest ───────────────────────────────

test('the badge is armed from the ONE painter and nowhere else', () => {
  // Three marking paths carried their own copy of the paint loop. A fourth
  // copy — or one left behind — is how the ⓘ ends up on two surfaces out of
  // three and mysteriously missing on the third.
  const arms = (src.match(/\bwnyArm\(/g) || []).length;
  eq(arms, 2, 'wnyArm should appear exactly twice: its definition and the one call in _mcqPaintResult');
  const paint = src.indexOf('function _mcqPaintResult');
  ok(paint > 0, '_mcqPaintResult is missing');
  ok(src.slice(paint, paint + 900).includes('wnyArm(containerSel, blockId, options, chosenLetter)'), 'the painter does not arm');
  eq((src.match(/(?<!function )_mcqPaintResult\(containerSel,/g) || []).length, 3, 'all three marking paths should call the painter');
  // …and no path may still be painting the labels by hand.
  eq((src.match(/lab\.style\.background = '#dcfce7'/g) || []).length, 1, 'a copy of the paint loop is still out there');
});

test('a reset takes the badges away again', () => {
  const i = src.indexOf('function resetOpenAnswersIn');
  ok(i > 0, 'resetOpenAnswersIn is missing');
  ok(src.slice(i, i + 2000).includes('wnyDisarm'), 'a reset question keeps its badges, and they sit on the WRONG options');
});

test('only the wrong options get a badge', () => {
  const i = src.indexOf('function wnyArm');
  const body = src.slice(i, src.indexOf('\nfunction wnyDisarm', i));
  ok(/if \(o\.correct\) return;/.test(body), 'the correct option must be skipped before the badge is built');
  ok(body.indexOf('if (o.correct) return;') < body.indexOf("createElement('button')"), 'the skip has to come first');
});

test('it stays a VISION call', () => {
  // A science distractor is wrong because of what the diagram or the table
  // SHOWS. Without the pictures the reason cannot be given at all, and the
  // model falls back to "this does not match" — which is what the student
  // already had. This is the same rule ✅ Check Questions' AI pass carries.
  const i = src.indexOf('async function _wnyLoad');
  const body = src.slice(i, src.indexOf('\n// ---- the card', i));
  ok(/_cqMedia\(q\)/.test(body), 'the diagrams are no longer attached');
  ok(/askGeminiVision\(/.test(body), 'downgraded to a text-only call');
  ok(!/\baskGemini\(/.test(body), 'a text-only call has crept in');
});

test('both print paths pass the notes to the ONE key pusher', () => {
  // The two switches had already drifted over the MCQ answer once. A key that
  // carries the reasons from one print button and not the other is that same
  // fault wearing a new hat.
  ok(/function _pushBlockAnswerKey\(sections, block, part, why\)/.test(src), 'the pusher does not take the notes');
  const calls = src.match(/_pushBlockAnswerKey\(qSections, block, bPart[^)]*\)/g) || [];
  eq(calls.length, 4, 'both print paths have an mcq case and a default case');
  calls.forEach(c => ok(/qWhy/.test(c), 'a print path is not passing the notes: ' + c));
  eq((src.match(/const qWhy = whyNotes \? whyNotes\[q\.id\] : null;/g) || []).length, 2, 'both loops must resolve the question\'s own notes');
});

test('the switch really is a switch', () => {
  const i = src.indexOf('async function wnyPrepare');
  ok(i > 0, 'wnyPrepare is missing');
  ok(/^\s*if \(!on\) return null;/m.test(src.slice(i, i + 400)), 'wnyPrepare must generate nothing when it was not asked to');
  // One checkbox per print surface, and the reader knows all three.
  // One checkbox per print surface, named explicitly. A default that fell
  // through to another page's checkbox would honour a switch the teacher set
  // somewhere else, on a print they started from here.
  ['builder', 'saved', 'paper', 'bank'].forEach(w => {
    ok(new RegExp("wnyPrintOn\\('" + w + "'\\)").test(src), w + ' does not read a switch');
    const id = (new RegExp(w + ": '([A-Za-z]+)'").exec(src) || [])[1];
    // The past-papers toolbar is built in app.js, the other three sit in
    // index.html — either counts, an id nobody renders at all does not.
    ok(id && (html.includes('id="' + id + '"') || src.includes('id="' + id + '"')),
       'nothing renders a checkbox with that id for ' + w);
  });
  ok(/const WNY_SWITCHES = /.test(src), 'the surface→checkbox map has gone');
  ok(/if \(!id\) return false;/.test(src), 'an unknown surface must not fall through to another page\'s switch');
});

test('nothing here writes a question', () => {
  const a = src.indexOf('// 🔎 WHY NOT THIS ONE');
  const b = src.indexOf('// Last-resort explanation built locally', a);
  ok(a > 0 && b > a, 'the why-not block was not found');
  const body = src.slice(a, b);
  [/saveQuestion\(/, /setDoc\(/, /updateDoc\(/, /addDoc\(/, /deleteDoc\(/].forEach(re =>
    ok(!re.test(body), 'the why-not block writes to the database: ' + re));
});

// ── run ─────────────────────────────────────────────────────────────────────
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name !== only) continue;
  try { c.fn(); console.log('  ok   ' + c.name); pass++; }
  catch (e) { console.log('  FAIL ' + c.name + '\n       ' + e.message); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
