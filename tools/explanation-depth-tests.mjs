// Regression tests for 📝 AN EXPLANATION IS NOT THE ANSWER AGAIN.
// Run with:
//     node tools/explanation-depth-tests.mjs            all cases
//     node tools/explanation-depth-tests.mjs <name>     one case
//
// It loads the REAL `EXPL_ASKS_RE` / `_aiAsksToExplain` / `_explAnswerContext`
// / `_explDepthRules` out of app.js, and checks the shared build fragment
// `_partsPromptRules()` carries the rule too.
//
// EVERY FAILURE HERE IS SILENT. The AI answers, the block fills, the sheet
// prints — and the answer key says the same thing twice:
//
//  • THE FAULT ITSELF. A question that says "Explain your answer" has a model
//    answer that IS an explanation, so "explain why the answer is correct" and
//    "write the answer" are one instruction and the box comes back as the
//    answer again. The teacher then prints a key whose second half is dead
//    paper, and nothing anywhere says so.
//  • THE OTHER DIRECTION. With NO answer written yet — an MCQ, or a box the
//    author filled before writing the answer — the old prompt was right, and
//    `_explDepthRules` must return the EMPTY STRING so that prompt is
//    byte-for-byte what it always was. Telling a model not to repeat an answer
//    that does not exist is how an explanation comes back refusing to say what
//    the answer is.
//  • WHOSE ANSWER. On a question with parts, only THIS part's answer is the one
//    this box would be repeating. Counting part (b)'s answer puts the "do not
//    repeat it" rule on a box that has nothing to repeat.
//  • WHOSE WORDING. The instruction to explain is usually in the part's own
//    wording and is often printed once in the shared stem — but another PART's
//    "Explain your answer" is not this part's, and reading it turns the strong
//    rule on for a box that only had to answer.
//  • THE BUILD PATHS. ⚡ Rapid add, 📄 Exam Paper and the bulk import write the
//    answer AND the explanation in one call, which is where most duplicated
//    explanations in the bank came from. They read `_partsPromptRules()`, so
//    the rule has to be in it.
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

// stripHtml is pure in the app; qPartOf is one line. Both are cut in rather
// than re-written, so the harness cannot drift from what the app does.
// Each piece is cut to its own closing brace and the pieces are joined by
// NEWLINES: app.js ends a good many of these regions on a `//` comment, and
// concatenating straight onto one comments the next piece out — silently, and
// only the `const` declarations vanish, because the functions hoist.
const SHIM = [
  cut('function stripHtml(content) {', '\n}\n', 'stripHtml') + '\n}\n',
  cut('function qPartOf(map, block) {', '\n', 'qPartOf'),
].join('\n');

const F = new Function([
  SHIM,
  cut('const EXPL_ASKS_RE', '\nasync function aiGenerateBlockAnswer', 'explanation depth'),
  'return { asks: _aiAsksToExplain, context: _explAnswerContext, rules: _explDepthRules };',
].join('\n'))();

// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const only = process.argv[2];
function test(name, fn) {
  if (only && !name.includes(only)) return;
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function ok(cond, what) { if (!cond) throw new Error(what); }
function eq(got, want, what) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error((what || '') + '\n      got:  ' + g + '\n      want: ' + w);
}

// A part map the way qPartMap builds one: block -> the part it belongs to.
const mapOf = list => {
  const m = new Map(); let cur = '';
  list.forEach(b => { if (b.part) cur = b.part; m.set(b, b.part === '-' ? '' : cur); });
  return m;
};
const ctx = (list, target, scoped) => F.context(list, mapOf(list), target || '', !!scoped);

console.log('\nDOES THE QUESTION ASK FOR THE REASONING?');

test('the reported wording — "Explain your answer."', () => {
  ok(F.asks('Would the amount of gas R be higher, the same or lower? Explain your answer.'));
});

test('the other ways a paper asks for it', () => {
  ['Why did the water level rise?', 'Give a reason for your answer.',
   'Account for the difference in temperature.', 'Justify your choice.',
   'Explain how the plant obtains water.'].forEach(s => ok(F.asks(s), s));
});

test('华文 and the CJK forms, which carry no word boundaries', () => {
  ['为什么水会上升？', '试说明原因。', '解释你的答案。'].forEach(s => ok(F.asks(s), s));
});

test('a question that asks for a NAME is not asking for reasoning', () => {
  ['Name the two gases.', 'State the change of state shown.',
   'Circle the correct answer.', 'Complete the table below.'].forEach(s => ok(!F.asks(s), s));
});

test('a word that merely contains one of the triggers does not fire it', () => {
  // \b keeps "whyever"-style substrings out; the point is that a stray match
  // turns the strongest rule on for a question that never asked for reasoning.
  ok(!F.asks('The whydah is a small bird.'), 'matched inside a word');
});

console.log('\nWHAT THE BOX IS SITTING ON');

test('an answer with content is seen; an empty one is not', () => {
  eq(ctx([{ type: 'plainanswer', content: 'Lower.' }]).hasAnswer, true);
  eq(ctx([{ type: 'plainanswer', content: '' }]).hasAnswer, false);
  eq(ctx([{ type: 'plainanswer', content: '<p> </p>' }]).hasAnswer, false,
     'markup with no words in it is not an answer');
});

test('a CER answer counts on any of its three fields', () => {
  eq(ctx([{ type: 'answer', claim: '', evidence: 'The graph flattens.', reasoning: '' }]).hasAnswer, true);
  eq(ctx([{ type: 'answer', claim: '', evidence: '', reasoning: '' }]).hasAnswer, false);
});

test('an MCQ is not a written answer — its explanation prompt must not change', () => {
  eq(ctx([{ type: 'mcq', options: [{ text: 'a' }] }]).hasAnswer, false);
});

test('ONLY this part\'s answer counts', () => {
  const list = [
    { type: 'text', part: 'a', content: 'Name the two gases.' },
    { type: 'plainanswer', part: 'a', content: 'Oxygen and carbon dioxide.' },
    { type: 'text', part: 'b', content: 'Explain your answer.' },
    { type: 'plainanswer', part: 'b', content: 'Because the plant respires.' },
  ];
  eq(ctx(list, 'b', true), { hasAnswer: true, asksExplain: true });
  eq(ctx(list, 'a', true), { hasAnswer: true, asksExplain: false },
     "part (b)'s 'Explain your answer' is not part (a)'s");
});

test('the SHARED STEM asks for both parts, so it counts for either', () => {
  const list = [
    { type: 'text', content: 'The graph shows the gases in a sealed room. Explain your answer in each case.' },
    { type: 'text', part: 'a', content: 'Is gas R higher or lower?' },
    { type: 'plainanswer', part: 'a', content: 'Lower.' },
  ];
  eq(ctx(list, 'a', true), { hasAnswer: true, asksExplain: true });
});

test('an unscoped question reads the whole thing', () => {
  const list = [
    { type: 'text', content: 'Would the amount of gas R be lower? Explain your answer.' },
    { type: 'plainanswer', content: 'Lower, because the adults used less oxygen.' },
  ];
  eq(ctx(list, '', false), { hasAnswer: true, asksExplain: true });
});

console.log('\nTHE RULE ITSELF');

test('NO answer yet means NO rule at all — the old prompt is untouched', () => {
  eq(F.rules(false, false), '');
  eq(F.rules(false, true), '', 'a question that asks to explain but has no answer yet still gets nothing');
});

test('an answer brings the do-not-repeat rule', () => {
  const r = F.rules(true, false);
  ok(/do NOT restate it/.test(r), 'the rule must forbid restating the answer');
  ok(/do NOT paraphrase it/.test(r), 'paraphrasing is the same fault in different words');
  ok(/longer and more detailed/i.test(r), 'it has to say what to do, not only what not to do');
});

test('the four things a teacher adds are all asked for', () => {
  const r = F.rules(true, true);
  ['principle', 'reasoning', 'most likely to give instead', 'marker is looking for']
    .forEach(s => ok(r.includes(s), 'missing: ' + s));
});

test('the STRONG line fires only when the question itself asks to explain', () => {
  ok(/ALREADY an explanation/.test(F.rules(true, true)),
     'this is the reported bug: the answer is already the explanation');
  ok(!/ALREADY an explanation/.test(F.rules(true, false)),
     'a "Name the two gases" answer is not an explanation, so do not say it is');
});

test('the rule never contradicts the answer it is written over', () => {
  const r = F.rules(true, true);
  ok(!/contradict|disagree|correct the answer/i.test(r),
     'an explanation that argues with the model answer is worse than one that repeats it');
});

console.log('\nTHE BUILD PATHS CARRY IT TOO');

test('_partsPromptRules() states the rule', () => {
  const frag = cut('function _partsPromptRules() {', '\n}', 'parts fragment');
  ok(/AN EXPLANATION IS NOT THE ANSWER AGAIN/.test(frag),
     '⚡ Rapid add and 📄 Exam Paper write the answer and the explanation in ONE call — ' +
     'without this line they go on writing the same paragraph twice');
  ok(/goes BEYOND it/.test(frag));
});

test('the button reads the rule through the one function', () => {
  const fn = cut('async function aiGenerateBlockExplanation', '\n}\n', 'explanation button');
  ok(/_explDepthRules\(depth\.hasAnswer, depth\.asksExplain\)/.test(fn),
     'a second copy of the rule written here is a copy that drifts');
  ok(/_explAnswerContext\(/.test(fn));
  ok(/depth\.hasAnswer \? 1300 : 700/.test(fn),
     'going beyond the answer needs room to do it in');
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
