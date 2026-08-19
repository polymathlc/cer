// Regression tests for ✍️ AI COMPLETE.
// Run with:
//     node tools/ai-complete-tests.mjs            all cases
//     node tools/ai-complete-tests.mjs <name>     one case
//
// It loads the REAL helpers out of the app source. ✍️ AI complete is the third
// sibling of ✨ Improve and ✂️ Shorten and the ONE of the three that may not
// touch a word the author has already typed — so every way it can go wrong is
// a way of quietly damaging writing somebody was in the middle of:
//
//  • TOO EAGER and it eats the completion. A model asked to carry on very often
//    restates the last sentence first, so the reply is trimmed of whatever of
//    the existing text it opens with — and a trim that fires on a coincidental
//    few characters throws away the real continuation instead. The author sees
//    a sentence that starts halfway through a word, or nothing added at all.
//  • TOO TIMID and the author's own opening lands in the box TWICE. That reads
//    exactly like the button having mangled the paragraph, which is the one
//    thing it promises never to do.
//  • THE SPACE IS NOT COSMETIC. 中文 and 华文 are written without spaces between
//    characters, so a space welded onto the join is a space in the middle of a
//    word; latin without one runs two words together. Neither throws and both
//    are in the middle of a sentence a teacher is about to print.
//  • THE GUARANTEE IS STRUCTURAL. What is in the box is APPENDED to, never
//    re-serialised, so nothing the model returns can change it. Two source
//    checks below pin the wiring that makes that true — because ✨ Improve
//    replaces the whole box, and it is the handler that runs on the shared
//    class, so a missing guard means one press silently runs BOTH.
import fs from 'fs';

const SRC = ['../app.js', '../index.html']
  .map(p => new URL(p, import.meta.url).pathname)
  .find(p => fs.existsSync(p));
if (!SRC) throw new Error('neither app.js nor index.html found beside tools/');
const src = fs.readFileSync(SRC, 'utf8');

// The pure core: everything from the constants down to the end of _aicWords.
// It is byte-for-byte the same block in all four portals, so this harness is
// the same file in all four too.
const start = src.indexOf('const AIC_ECHO_MAX');
if (start < 0) throw new Error('AI complete core not found — has AIC_ECHO_MAX been renamed?');
const wc = src.indexOf('function _aicWords(t)', start);
if (wc < 0) throw new Error('_aicWords not found after AIC_ECHO_MAX');
const M = new Function(src.slice(start, src.indexOf('\n', wc)) + `
return { norm: _aicNorm, trim: _aicTrimEcho, join: _aicJoin, cjk: _aicCjk,
         unquote: _aicUnquote, words: _aicWords,
         MIN: AIC_ECHO_MIN, MAX: AIC_ECHO_MAX, WORDS: AIC_WORDS };`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
};

// What the box ends up holding. This is the whole feature in one line: the
// existing text, the separator, and the trimmed reply — the first of those
// three is never rebuilt from anything the model said.
const boxAfter = (before, reply) => {
  const add = M.trim(before, reply);
  return add ? before + M.join(before, add) + add : before;
};

// ── the promise: what was already typed is still there, untouched ───────────

test('the existing text survives whatever the model returns', () => {
  const before = 'Water in the puddle gains heat from the sun and';
  [
    'evaporates into water vapour.',
    before + ' evaporates into water vapour.',
    'WATER IN THE PUDDLE GAINS HEAT FROM THE SUN AND evaporates.',
    '',
    'and',
    'Here is the rest: it evaporates.'
  ].forEach(reply => {
    const after = boxAfter(before, reply);
    ok(after.startsWith(before), 'the opening was changed by reply ' + JSON.stringify(reply) + ':\n           ' + JSON.stringify(after));
  });
});

test('a reply that is nothing but an echo adds nothing at all', () => {
  const before = 'The plant needs sunlight to make food.';
  eq(M.trim(before, before), '', 'whole reply echoed');
  eq(M.trim(before, '  ' + before + '  '), '', 'echoed with padding');
  eq(boxAfter(before, before), before, 'the box should be left exactly as it was');
});

// ── the echo, which is what the model actually does ─────────────────────────

test('the whole paragraph echoed back is cut to the new tail', () => {
  const before = 'A magnet attracts objects made of iron.';
  eq(M.trim(before, before + ' It does not attract copper or plastic.'),
     'It does not attract copper or plastic.', 'full echo');
});

test('a restated last sentence is cut', () => {
  const before = 'The ice was left on the table. The ice gained heat from the surroundings.';
  eq(M.trim(before, 'The ice gained heat from the surroundings. It melted into water.'),
     'It melted into water.', 'restated tail');
});

test('the echo is matched through different spacing, line breaks and case', () => {
  const before = 'The seed germinates\nand a shoot appears.';
  eq(M.trim(before, 'The   seed\n\ngerminates and A SHOOT APPEARS. The shoot grows towards the light.'),
     'The shoot grows towards the light.', 'folded comparison');
});

// ── the other direction: a real continuation must survive whole ─────────────

test('a genuine continuation is not trimmed', () => {
  const before = 'Sound travels faster in water than in air because';
  const reply = 'the particles in water are packed more closely together.';
  eq(M.trim(before, reply), reply, 'mid-sentence continuation');
});

test('a mid-word continuation survives, and is joined without a space', () => {
  const before = 'The liquid begins to evapor';
  eq(M.trim(before, 'ate as it gains heat.'), 'ate as it gains heat.', 'trimmed');
  // Only the author's own trailing space asks for one; "evapor" + "ate" must
  // not become "evapor ate".
  eq(M.join(before, 'ate as it gains heat.'), ' ', 'join');
});

test('a short coincidental overlap is kept, a long one is cut', () => {
  const before = 'Put the beaker on the mat.';
  // Under AIC_ECHO_MIN characters in common is a coincidence, not an echo.
  const shortOverlap = 'the mat' + ' should be dry before you start.';
  eq(M.trim(before, shortOverlap), shortOverlap, 'short overlap kept');
  ok('on the mat.'.length >= M.MIN, 'the long case must clear the floor to mean anything');
  eq(M.trim(before, 'on the mat. Then pour in the water.'), 'Then pour in the water.', 'long overlap cut');
});

test('the longest restated tail wins, so nothing of it is left behind', () => {
  const before = 'Heat flows from the hotter object to the colder object.';
  // "the colder object." alone also matches; the whole sentence is the better cut.
  eq(M.trim(before, 'Heat flows from the hotter object to the colder object. This continues until both are at the same temperature.'),
     'This continues until both are at the same temperature.', 'longest wins');
});

// ── the join ────────────────────────────────────────────────────────────────

test('latin gets its space and CJK never does', () => {
  eq(M.join('The water', 'evaporates.'), ' ', 'latin');
  eq(M.join('水在阳光下', '吸收热量，变成水蒸气。'), '', 'CJK on both sides');
  eq(M.join('水在阳光下', 'and then evaporates'), '', 'CJK then latin');
  eq(M.join('The answer is', '。'), '', 'latin then CJK punctuation');
});

test('a trailing space the author typed is not doubled', () => {
  eq(M.join('The water ', 'evaporates.'), '', 'existing space');
  eq(M.join('The water\n', 'evaporates.'), '', 'existing newline');
});

test('nothing is joined onto nothing', () => {
  eq(M.join('', 'evaporates.'), '', 'empty box');
  eq(M.join('   ', 'evaporates.'), '', 'blank box');
  eq(M.join('The water', ''), '', 'empty addition');
});

test('CJK is recognised across the ranges a 华文 paper actually uses', () => {
  ['学', '中', '。', '，', '「', '？'].forEach(c => ok(M.cjk(c), 'should be CJK: ' + c));
  ['a', 'Z', '.', '5', ' '].forEach(c => ok(!M.cjk(c), 'should not be CJK: ' + c));
});

// ── the quotation marks a model adds despite being told not to ──────────────

test('a reply wrapped in quotes is unwrapped', () => {
  eq(M.unquote('"it evaporates into water vapour."'), 'it evaporates into water vapour.', 'double');
  eq(M.unquote('“it evaporates.”'), 'it evaporates.', 'curly');
  eq(M.unquote('「它变成水蒸气。」'), '它变成水蒸气。', 'CJK brackets');
});

test('a continuation that opens a real quotation keeps it', () => {
  const line = '"Stop!" he shouted, and the class went quiet.';
  eq(M.unquote(line), line, 'unmatched — there is no closing quote at the very end');
  const both = '"Stop!" he shouted, and someone whispered "why?"';
  eq(M.unquote(both), both, 'the same quote appears inside, so the pair is not a wrapper');
});

test('word counting is what the toast reports', () => {
  eq(M.words('It melted into water.'), 4, 'plain');
  eq(M.words('  spaced   out \n words '), 3, 'padded');
  eq(M.words(''), 0, 'empty');
  eq(M.words(null), 0, 'null');
});

// ── the wiring, which is what makes the promise structural ──────────────────

test('the box is appended to, never rewritten', () => {
  // ✨ Improve and ✂️ Shorten both hand their reply to a setter that REPLACES
  // the whole box. ✍️ AI complete must not: the author's own bold, underline
  // and pasted pictures live in that markup, and re-serialising it would
  // flatten all three even when the words came back perfect.
  const fn = (name) => {
    const i = src.indexOf('function ' + name + '(');
    ok(i > 0, name + ' is missing — the append helper is what makes the promise structural');
    const j = src.indexOf('\n}\n', i);
    ok(j > i, name + ': could not find the end of it');
    return src.slice(i, j);
  };
  const appendName = /function _aicAppendInto\(/.test(src) ? '_aicAppendInto' : 'aiFieldAppend';
  const body = fn(appendName);
  // Every write in there starts from what the box already holds.
  const writes = body.match(/\b(?:el\.innerHTML|el\.innerText|el\.value)\s*=\s*[^;]+/g) || [];
  ok(writes.length > 0, appendName + ' writes nothing at all');
  writes.forEach(w => ok(/=\s*\(?\s*(?:el\.innerHTML|el\.innerText|el\.value|v)\b/.test(w),
    'this write replaces the box instead of adding to it:\n           ' + w.trim()));
  // …and the caret is put at the END first, or a completion lands wherever the
  // cursor happened to be — in the middle of a sentence.
  ok(/collapse\(false\)/.test(body) || /selectionStart = el\.selectionEnd = v\.length/.test(body),
     appendName + ' does not move to the end of the box before writing');
});

test('every box that can be shortened can also be carried on', () => {
  // A prose box with ✂️ Shorten and no ✍️ AI complete is a box where the
  // button silently is not, and nothing on screen says why.
  if (/shortenBtnHtml\(/.test(src)) {
    const shorten = (src.match(/\$\{shortenBtnHtml\(/g) || []).length;
    const complete = (src.match(/\$\{completeBtnHtml\(/g) || []).length;
    eq(complete, shorten, 'call sites (${shortenBtnHtml} vs ${completeBtnHtml})');
    ok(shorten > 0, 'there should be call sites at all');
  } else {
    ok(/data-block-complete/.test(src), 'the text block needs its own ✍️ AI complete button');
    ok(/aiRunComplete\(el, c\)/.test(src), 'the shared toolbar needs to build one too');
  }
});

test('✨ Improve does not also fire on it', () => {
  // The three share .improve-btn for their looks and Improve is the handler
  // that runs on the bare class — so without the guard ONE press runs both,
  // and Improve REWRITES the box. That is the exact damage this button
  // promises never to do, delivered by the button itself.
  if (/shortenBtnHtml\(/.test(src)) {
    const i = src.indexOf("closest('.improve-btn')");
    ok(i > 0, 'the ✨ Improve handler was not found');
    const guards = src.slice(i, i + 600);
    ok(/contains\('shorten-btn'\)\)\s*return/.test(guards), 'the ✂️ Shorten guard has gone');
    ok(/contains\('complete-btn'\)\)\s*return/.test(guards), 'the ✍️ AI complete guard is missing');
  } else {
    // math wires each button to its own handler by data attribute, so there is
    // no shared class to guard — pin that it stays that way.
    ok(!/ai-complete-btn[\s\S]{0,80}ai-improve-btn/.test(src), 'the complete button must not carry the improve class');
  }
});

test('the model is told not to repeat, answer or reformat', () => {
  const p = src.slice(src.indexOf('Carry on writing the text'), src.indexOf('Carry on writing the text') + 2400);
  ok(/Do NOT repeat/i.test(p), 'rule 1 (do not repeat) is missing from the prompt');
  ok(/Do NOT rewrite/i.test(p), 'rule 2 (do not rewrite) is missing from the prompt');
  ok(/never (answer|solve) it/i.test(p), 'the do-not-answer rule is missing from the prompt');
  ok(/Plain text only/i.test(p), 'the plain-text rule is missing from the prompt');
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
