// Regression tests for 🔲 FILL-IN-THE-BLANKS — what a printed blank GIVES AWAY.
// Run with:
//     node tools/fill-blank-tests.mjs            all cases
//     node tools/fill-blank-tests.mjs <name>     one case
//
// It loads the REAL `_fbParse` / `_fbMergeBlankRuns` / `_fbSegments` /
// `_fbSlotChars` / `_fbPrintHtml` / `_fbAnswerKeyText` out of app.js.
//
// Every failure here is SILENT: the worksheet prints, the question is
// answerable, and the answer has been handed to the class anyway.
//
//  • THE COUNT. An author blanks one word at a time, so "carbon dioxide" is
//    `[[carbon]] [[dioxide]]`. Two rules in a row say the answer is two words,
//    and beside a one-rule blank answered "oxygen" that is the whole question
//    given away. A run of blanks joined by nothing but whitespace is ONE blank.
//  • THE PUNCTUATION GUARD, the other direction. `[[carbon]], [[dioxide]]` is
//    two real answers the author separated on purpose; merged, one of them is
//    gone from the paper AND from the key, and nothing anywhere says so.
//  • THE WIDTH. A rule sized from its own answer measures that answer. Every
//    blank in a block takes the width of the LONGEST answer, so there is room
//    to write and nothing to compare.
//  • THE KEY AND THE PAPER MUST AGREE. The key numbers the rules on the page,
//    so a key counting two answers against one printed rule mis-numbers every
//    row after it.
//  • `_fbParse` ITSELF MUST NOT MERGE. The language portals share it with the
//    word-bank cloze, the open cloze and the editing passage, where adjacent
//    blanks are separate answers — and an editing item is `[[wrong>>right]]`,
//    so a merge there grafts one item's correction onto the next one's
//    misspelling.
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

const SHIM = `
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
`;

const F = new Function(SHIM +
  cut('// Split text into tokens, keeping', '// ---- editor: clickable word chips', 'fill-blank core') +
  cut('function _fbPreviewHtml(text) {', '\nfunction fbSyncChips', 'fb preview') + `
return { parse: _fbParse, merge: _fbMergeBlankRuns, segments: _fbSegments,
         slotChars: _fbSlotChars, printHtml: _fbPrintHtml,
         keyText: _fbAnswerKeyText, previewHtml: _fbPreviewHtml,
         hasBlanks: _fbHasBlanks };
`)();

// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const only = process.argv[2];
function test(name, fn) {
  if (only && !name.includes(only)) return;
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function eq(got, want, what) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error((what || '') + '\n      got:  ' + g + '\n      want: ' + w);
}
function ok(cond, what) { if (!cond) throw new Error(what); }

const blanks = t => F.segments(t).filter(p => p.type === 'blank').map(p => p.answer);
// Every min-width the printed rules are given, in order.
const widths = html => (html.match(/min-width:(\d+)pt/g) || []).map(s => Number(s.match(/\d+/)[0]));
const rules = html => (html.match(/class="print-blank"/g) || []).length;

console.log('\nTHE COUNT — a run of blanks is one answer');

test('two adjacent blanks are one blank', () => {
  eq(blanks('Gas S : [[carbon]] [[dioxide]]'), ['carbon dioxide']);
});

test('three adjacent blanks are one blank', () => {
  eq(blanks('[[sodium]] [[hydrogen]] [[carbonate]]'), ['sodium hydrogen carbonate']);
});

test('a merged run prints ONE rule, like the paper', () => {
  eq(rules(F.printHtml({ text: 'Gas S : [[carbon]] [[dioxide]]' })), 1,
     'two rules in a row tell the class the answer is two words');
});

test('the reported bug: one rule each for gas R and gas S', () => {
  const html = F.printHtml({ text: 'Gas R : [[oxygen]]\nGas S : [[carbon]] [[dioxide]]' });
  eq(rules(html), 2, 'one rule per gas');
  const w = widths(html);
  eq(w[0], w[1], 'the two rules must be the same length or the longer one is the answer');
});

test('a newline between two blanks still joins them with one space', () => {
  eq(blanks('[[carbon]]\n[[dioxide]]'), ['carbon dioxide']);
});

test('directly adjacent blanks join with NO space — the sentence had none', () => {
  eq(blanks('[[car]][[bon]]'), ['carbon']);
});

test('blanks that are not adjacent stay separate', () => {
  eq(blanks('The [[heart]] pumps [[blood]] round the body.'), ['heart', 'blood']);
});

test('surrounding text survives the merge unchanged', () => {
  eq(F.segments('Gas S : [[carbon]] [[dioxide]] is produced.'),
     [{ type: 'text', text: 'Gas S : ' },
      { type: 'blank', answer: 'carbon dioxide' },
      { type: 'text', text: ' is produced.' }]);
});

console.log('\nTHE PUNCTUATION GUARD — the other direction');

test('a comma between two blanks keeps them apart', () => {
  eq(blanks('[[carbon]], [[dioxide]]'), ['carbon', 'dioxide']);
});

test('a word between two blanks keeps them apart', () => {
  eq(blanks('[[oxygen]] and [[nitrogen]]'), ['oxygen', 'nitrogen']);
});

test('a full stop between two blanks keeps them apart', () => {
  eq(blanks('It is [[oxygen]]. It is [[nitrogen]]'), ['oxygen', 'nitrogen']);
});

console.log('\nTHE WIDTH — no blank may measure its own answer');

test('every rule in a block is the same width', () => {
  const w = widths(F.printHtml({ text: '[[a]] and [[photosynthesis]] and [[hi]]' }));
  eq(w.length, 3);
  ok(w.every(x => x === w[0]), 'a rule sized from its own answer measures the answer');
});

test('the width comes from the LONGEST answer, so there is room to write', () => {
  const short = widths(F.printHtml({ text: '[[a]] and [[b]]' }))[0];
  const long = widths(F.printHtml({ text: '[[a]] and [[carbon dioxide gas]]' }))[0];
  ok(long > short, 'the longest answer must still get its room');
});

test('the width is bounded — no rule runs off the sheet', () => {
  const w = widths(F.printHtml({ text: '[[' + 'x'.repeat(400) + ']]' }))[0];
  ok(w <= 240, 'over the cap a rule wraps the page: ' + w);
  const tiny = widths(F.printHtml({ text: '[[x]]' }))[0];
  ok(tiny >= 70, 'under the floor there is nowhere to write: ' + tiny);
});

test('the student boxes are one width too', () => {
  // _fbPreviewHtml is the author-facing twin of the student rendering.
  const html = F.previewHtml('[[a]] and [[photosynthesis]]');
  const slots = html.split('fb-blank-slot').slice(1).map(s => (s.match(/&nbsp;/g) || []).length);
  eq(slots.length, 2);
  ok(slots[0] === slots[1], 'a box sized from its own answer measures the answer');
});

console.log('\nTHE KEY AGREES WITH THE PAPER');

test('the key lists one answer per printed rule', () => {
  const block = { text: 'Gas R : [[oxygen]]\nGas S : [[carbon]] [[dioxide]]' };
  eq(F.keyText(block), '1. oxygen   2. carbon dioxide');
  eq(rules(F.printHtml(block)), 2, 'the key numbers the rules on the page');
});

test('a block with no blanks keys nothing', () => {
  eq(F.keyText({ text: 'Nothing is blanked here.' }), '');
});

test('nothing is printed for an empty block', () => {
  eq(F.printHtml({ text: '' }), '');
});

test('a printed blank is BLANK — no answer reaches the paper', () => {
  const html = F.printHtml({ text: 'Gas S : [[carbon]] [[dioxide]]' });
  ok(!/carbon|dioxide/i.test(html), 'the answer printed on the worksheet: ' + html);
});

console.log('\n`_fbParse` ITSELF MUST NOT MERGE (the cloze family shares it)');

test('_fbParse still returns adjacent blanks separately', () => {
  const raw = F.parse('[[carbon]] [[dioxide]]').filter(p => p.type === 'blank').map(p => p.answer);
  eq(raw, ['carbon', 'dioxide'],
     'merging inside _fbParse welds two editing items or two cloze answers into one');
});

test('an editing pair survives _fbParse intact', () => {
  const raw = F.parse('[[reseev>>receive]] [[choose>>chosen]]')
    .filter(p => p.type === 'blank').map(p => p.answer);
  eq(raw, ['reseev>>receive', 'choose>>chosen']);
});

test('_fbHasBlanks is unchanged and still asks the block type', () => {
  ok(F.hasBlanks({ type: 'fillblank', text: 'a [[b]]' }));
  ok(!F.hasBlanks({ type: 'fillblank', text: 'no blanks' }));
  ok(!F.hasBlanks({ type: 'text', text: 'a [[b]]' }));
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
