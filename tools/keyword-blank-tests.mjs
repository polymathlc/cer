// Regression tests for 🔑 ASSIGN KEYWORDS and 🔲 FILL-IN-THE-BLANKS.
// Run with:
//     node tools/keyword-blank-tests.mjs            all cases
//     node tools/keyword-blank-tests.mjs <name>     one case
//
// It loads the REAL functions out of app.js, including `_markedToBlanks` —
// the writer of this data since long before anything read it back.
//
// Every failure here is SILENT, and each one is silent in a different place:
//
//  • A WORD COUNT THAT DRIFTS is the worst of them. `q.blanks` stores word
//    POSITIONS, and `_markedToBlanks` has been writing them from the
//    `[[double bracket]]` marks every AI prompt asks for. If `_kwParse`
//    counts words differently by even one, every keyword on every AI-built
//    question in the bank slides along the sentence — and the app still works
//    perfectly: it blanks out "the" and bolds "of" on the answer key, and
//    nothing anywhere says a word about it.
//  • COUNTING INSIDE MARKUP is how that drift happens in practice. A `<b>` in
//    the middle of an answer is not a word and `&nbsp;` is not the word
//    "nbsp" — count either and everything after it shifts.
//  • AN INDEX PAST THE END is an answer that has been edited shorter. It must
//    be dropped, not clamped onto whatever word is now last.
//  • BOLDING BACK TO FRONT: kwBoldHtml splices into the source string, so
//    marking front to back moves every offset after the first one. The result
//    reads as mangled HTML in the middle of a printed answer key.
//  • A BLANK RENDERER THAT RETURNS AN EMPTY STRING instead of null takes the
//    question's answer box away and puts nothing in its place — a question
//    that cannot be answered at all, on a surface that looks fine.
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

// escapeHtml goes through the DOM in the app; this is what a text node's
// innerHTML actually gives back — & < > escaped, quotes left alone.
const SHIM = `
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
`;

const M = new Function(SHIM +
  cut('function _markedToBlanks(marked) {', '\n// Turn an AI question object', 'markedToBlanks') +
  cut('const KW_WORD_RE', '// ---- 🔲 the practice mode itself', 'keyword core') +
  cut('// ---- 🔲 the practice mode itself', '// =====================================================================\n// 🔑 ASSIGN KEYWORDS', 'fib renderer') + `
return { parse: _kwParse, fieldKey: kwFieldKey, blockFields: kwBlockFields,
         takes: kwBlockTakesKeywords, indices: kwIndices, qIndices: qKwIndices,
         words: qKeywordWords, has: qHasKeywords, count: qKeywordCount,
         boldPlain: kwBoldPlain, boldHtml: kwBoldHtml,
         keyField: qKeyFieldHtml, keyPlain: qKeyPlainHtml,
         blankField: kwBlankFieldHtml, preview: kwPreviewFieldHtml,
         fib: _kwFibBlockHtml, note: kwFibNoteHtml,
         marked: _markedToBlanks };`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
};
const deep = (got, want, what) => eq(JSON.stringify(got), JSON.stringify(want), what);

// A plain answer block plus the question that carries its keywords.
const plainQ = (content, idxs) => ({
  blocks: [{ id: 'b1', type: 'plainanswer', content }],
  blanks: { b1: Object.fromEntries((idxs || []).map(i => [String(i), true])) }
});
const cerQ = (fields, marks) => ({
  blocks: [Object.assign({ id: 'b1', type: 'answer' }, fields)],
  blanks: Object.fromEntries(Object.entries(marks || {}).map(
    ([f, idxs]) => ['b1_' + f, Object.fromEntries(idxs.map(i => [String(i), true]))]))
});

// ── the word count, which everything else stands on ─────────────────────────

test('the AI writer and this reader count the same words', () => {
  // THE compatibility test. `_markedToBlanks` turned the model's [[brackets]]
  // into indices; _kwParse has to land on the same words reading them back.
  const marked = 'Water [[evaporates]] from the leaves as water [[vapour]] through the [[stomata]].';
  const { content, blanks } = M.marked(marked);
  const parsed = M.parse(content);
  const got = Object.keys(blanks).map(i => parsed.words[Number(i)].w);
  deep(got, ['evaporates', 'vapour', 'stomata'], 'the words the indices point at');
});

test('a hyphenated word and an apostrophe are ONE word, in both', () => {
  const { content, blanks } = M.marked("The ice [[re-freezes]] because it [[doesn't]] gain heat.");
  const parsed = M.parse(content);
  deep(Object.keys(blanks).map(i => parsed.words[Number(i)].w), ['re-freezes', "doesn't"], 'the words');
});

test('an HTML tag is not a word — a <b> must not shift every keyword after it', () => {
  const parsed = M.parse('The <b>water</b> turns to vapour.');
  deep(parsed.words.map(w => w.w), ['The', 'water', 'turns', 'to', 'vapour'], 'the words');
  eq(parsed.plain, 'The water turns to vapour.', 'the sentence a student reads');
});

test('&nbsp; is a space, not the word "nbsp"', () => {
  const parsed = M.parse('Heat&nbsp;travels by conduction.');
  deep(parsed.words.map(w => w.w), ['Heat', 'travels', 'by', 'conduction'], 'the words');
  eq(parsed.plain, 'Heat travels by conduction.', 'the sentence');
});

test('&amp; is punctuation, and does not become the word "amp"', () => {
  const parsed = M.parse('Salt &amp; water');
  deep(parsed.words.map(w => w.w), ['Salt', 'water'], 'the words');
  eq(parsed.plain, 'Salt & water', 'the sentence');
});

test('runs of whitespace collapse, exactly as stripHtml collapses them', () => {
  eq(M.parse('  The   water \n vapour  ').plain, 'The water vapour', 'the sentence');
});

test('a word carries its offset in the SOURCE as well as the plain text', () => {
  const html = 'The <b>water</b> vapour';
  const w = M.parse(html).words[1];
  eq(html.slice(w.sa, w.sb), 'water', 'the source slice the bolder will wrap');
});

// ── which indices are live ──────────────────────────────────────────────────

test('an index past the end of an edited-down answer is DROPPED', () => {
  // The answer was long, three keywords were marked, then it was rewritten to
  // four words. Nothing may be blanked at index 9 — and nothing may be
  // clamped onto whatever word is last now either.
  const q = plainQ('It gains heat.', [1, 9]);
  deep(M.qIndices(q, q.blocks[0], 'content'), [1], 'the live indices');
});

test('indices come back ASCENDING however they were stored', () => {
  const q = plainQ('one two three four five', [4, 0, 2]);
  deep(M.qIndices(q, q.blocks[0], 'content'), [0, 2, 4], 'ascending');
});

test('a false in the map is not a keyword', () => {
  const q = plainQ('one two three', []);
  q.blanks.b1 = { 0: true, 1: false };
  deep(M.qIndices(q, q.blocks[0], 'content'), [0], 'only the true one');
});

test('the field key is the convention _markedToBlanks already writes', () => {
  eq(M.fieldKey('b1', 'content'), 'b1', 'a plain answer box');
  eq(M.fieldKey('b1', 'claim'), 'b1_claim', 'a CER field');
  eq(M.fieldKey('b1', 'reasoning'), 'b1_reasoning', 'a CER field');
});

test('an annotation working area holds no keywords — there is no sentence in it', () => {
  ok(M.takes({ id: 'b1', type: 'workingSpace', content: '' }), 'a plain working space');
  ok(!M.takes({ id: 'b1', type: 'workingSpace', annotate: true }), 'a drawing pad');
  ok(!M.takes({ id: 'b1', type: 'mcq' }), 'an MCQ');
  ok(!M.takes({ id: 'b1', type: 'text' }), 'a text block');
});

// ── what the answer key bolds ───────────────────────────────────────────────

test('a keyword is bold and underlined EVERYWHERE it appears in the answer', () => {
  // The rule for a key, which is read rather than answered: a keyword bold in
  // one sentence and plain in the next reads as a mistake.
  const q = plainQ('Water vapour rises. The vapour cools.', [1]);
  eq(M.keyPlain(q, 'Water vapour rises. The vapour cools.'),
    'Water <strong><u>vapour</u></strong> rises. The <strong><u>vapour</u></strong> cools.',
    'both occurrences');
});

test('bolding is case-insensitive and keeps the case that was written', () => {
  const q = plainQ('The vapour cools.', [1]);
  eq(M.keyPlain(q, 'Vapour and vapour'),
    '<strong><u>Vapour</u></strong> and <strong><u>vapour</u></strong>', 'both cases');
});

test('everything that is NOT a keyword is still escaped', () => {
  const q = plainQ('Salt dissolves', [0]);
  eq(M.keyPlain(q, 'Salt <b> & water'), '<strong><u>Salt</u></strong> &lt;b&gt; &amp; water', 'escaped');
});

test('a question with no keywords is left completely alone', () => {
  const q = plainQ('Water vapour rises.', []);
  eq(M.keyPlain(q, 'Water vapour rises.'), 'Water vapour rises.', 'plain text untouched');
  eq(M.keyField(q, q.blocks[0], 'content'), 'Water vapour rises.', 'the HTML handed straight back');
});

test('a filler word is never bolded automatically', () => {
  // "of" is two letters. Marking it blanks it in practice (the author asked
  // for that); bolding every "of" on the key is noise, not a keyword.
  const q = plainQ('a lot of water', [2]);
  eq(M.keyPlain(q, 'a lot of water'), 'a lot of water', 'nothing bolded');
});

test('bolding the printed key keeps the author\'s own formatting', () => {
  const q = { blocks: [{ id: 'b1', type: 'plainanswer', content: 'The <b>water</b> vapour escapes.' }],
              blanks: { b1: { 2: true } } };
  eq(M.keyField(q, q.blocks[0], 'content'),
    'The <b>water</b> <strong><u>vapour</u></strong> escapes.', 'the <b> survives');
});

test('several keywords in one field are spliced BACK TO FRONT', () => {
  // Front to back, every offset after the first splice is wrong and the key
  // prints mangled markup in the middle of an answer.
  const q = plainQ('Water vapour escapes through stomata', [1, 4]);
  eq(M.keyField(q, q.blocks[0], 'content'),
    'Water <strong><u>vapour</u></strong> escapes through <strong><u>stomata</u></strong>',
    'both marks, both in the right place');
});

test('the keyword set is gathered from all three CER fields', () => {
  const q = cerQ({ claim: 'It evaporates', evidence: 'The mass fell', reasoning: 'Water became vapour' },
                 { claim: [1], reasoning: [2] });
  deep([...M.words(q)].sort(), ['evaporates', 'vapour'], 'the set');
  ok(M.has(q), 'the question has keywords');
  eq(M.count(q), 2, 'the blank count');
});

test('a question with nothing marked is never served in fill-in-the-blanks', () => {
  ok(!M.has(plainQ('Water vapour rises.', [])), 'no marks');
  ok(!M.has({ blocks: [{ id: 'b1', type: 'mcq' }], blanks: { b1: { 0: true } } }), 'an MCQ is not an answer field');
  ok(!M.has({}), 'an empty question');
});

// ── what a student is handed ────────────────────────────────────────────────

test('every marked word becomes an input, in order, and nothing else changes', () => {
  const block = { id: 'b1', type: 'plainanswer', content: 'Water vapour escapes through stomata.' };
  const seen = [];
  const html = M.blankField(block, 'content', [1, 4], w => { seen.push(w); return '[' + w + ']'; });
  deep(seen, ['vapour', 'stomata'], 'the words offered, in reading order');
  eq(html, 'Water [vapour] escapes through [stomata].', 'the sentence around them');
});

test('no keywords means NULL, never an empty sentence', () => {
  // An empty string here would replace the question's answer box with nothing
  // at all: a question that renders perfectly and cannot be answered.
  const block = { id: 'b1', type: 'plainanswer', content: 'Water vapour escapes.' };
  eq(M.blankField(block, 'content', [], () => '_'), null, 'no marks');
  eq(M.blankField({ id: 'b1', type: 'plainanswer', content: '' }, 'content', [0], () => '_'), null, 'no answer');
});

test('the student sentence is escaped, so an answer with < in it is safe', () => {
  const block = { id: 'b1', type: 'plainanswer', content: 'Ice melts when T > 0 degrees' };
  eq(M.blankField(block, 'content', [1], () => '_'), 'Ice _ when T &gt; 0 degrees', 'escaped');
});

test('the editor preview shows a slot per keyword and the rest of the sentence', () => {
  const block = { id: 'b1', type: 'plainanswer', content: 'Water vapour rises' };
  const html = M.preview(block, 'content', [1]);
  ok(html.includes('fb-blank-slot'), 'a slot is drawn');
  ok(html.includes('title="vapour"'), 'the slot knows its own word');
  ok(html.startsWith('Water '), 'the words before it');
  ok(html.endsWith(' rises'), 'the words after it');
});

test('an unmarked answer previews as the plain sentence, not as an error', () => {
  const block = { id: 'b1', type: 'plainanswer', content: 'Water vapour rises' };
  eq(M.preview(block, 'content', []), 'Water vapour rises', 'the sentence');
});

// ── the block a practice surface actually renders ───────────────────────────

test('a CER block blanks each field it has keywords in, and labels them', () => {
  const q = cerQ({ claim: 'It evaporates', evidence: 'The mass fell', reasoning: 'Water became vapour' },
                 { claim: [1], reasoning: [2] });
  const items = [], fbBlocks = [];
  const html = M.fib(q, q.blocks[0], items, fbBlocks, '#c', '(b)');
  ok(html, 'something was rendered');
  eq(items.length, 2, 'one marking item per blank');
  deep(items.map(i => i.label), ['(b) Claim Blank 1', '(b) Reasoning Blank 2'], 'the labels the AI marker reads');
  deep(items.map(i => i.model), ['evaporates', 'vapour'], 'the expected answers');
  deep(fbBlocks, [{ blockId: 'b1', oidxs: [0, 1], answers: ['evaporates', 'vapour'] }], 'the marking store');
  ok(html.includes('data-fb-check="#c"'), 'the Check button is wired to this surface');
  ok(!html.includes('Evidence'), 'a field with no keywords is not shown as an empty exercise');
});

test('the blanks keep counting on from whatever is already in the store', () => {
  // A question with two answer blocks: the second one\'s inputs must not
  // reuse the first one\'s indices, or one blank marks another.
  const q = plainQ('Water vapour rises', [1]);
  const items = [{ label: 'earlier', model: 'x' }], fbBlocks = [];
  const html = M.fib(q, q.blocks[0], items, fbBlocks, '#c', '');
  ok(html.includes('data-oidx="1"'), 'the input took the next free index');
  deep(fbBlocks[0].oidxs, [1], 'and the store agrees');
});

test('a block with no keywords renders NOTHING, so the caller falls back', () => {
  const q = plainQ('Water vapour rises', []);
  const items = [], fbBlocks = [];
  eq(M.fib(q, q.blocks[0], items, fbBlocks, '#c', ''), null, 'no fill-in-the-blanks body');
  eq(items.length, 0, 'and nothing was pushed onto the marking store');
  eq(fbBlocks.length, 0, 'nor onto the fill-blank store');
});

test('an annotation pad is never turned into blanks', () => {
  const q = { blocks: [{ id: 'b1', type: 'workingSpace', annotate: true, content: 'Draw the arrows' }],
              blanks: { b1: { 1: true } } };
  eq(M.fib(q, q.blocks[0], [], [], '#c', ''), null, 'left as a drawing pad');
});

test('the mode says what it is, on the question itself', () => {
  ok(/Fill-in-the-blanks/i.test(M.note()), 'the banner names the mode');
});

// ── runner ───────────────────────────────────────────────────────────────────

const only = process.argv[2];
let passed = 0, failed = 0;
for (const c of cases) {
  if (only && c.name !== only) continue;
  try { await c.fn(); console.log('  ok   ' + c.name); passed++; }
  catch (err) { console.log('  FAIL ' + c.name + '\n         ' + err.message); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
