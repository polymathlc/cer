// Regression tests for THE DOUBLED PART MARKER.
// Run with:
//     node tools/part-marker-tests.mjs            all cases
//     node tools/part-marker-tests.mjs <name>     one case
//
// It loads the REAL helpers out of app.js. A part label is drawn from the
// BLOCK — the chip in the editor, the tag beside the question on screen, the
// marker in the margin on paper — so a block that opens part (a) and ALSO has
// "(a)" typed at the front of its content prints it twice:
//
//     (a) (a) 文中形容“问题得到处理，有了结果”的词语是________。
//
// Both directions fail silently and neither throws:
//
//  • TOO TIMID and the doubling stays. That is where this started: the model
//    is asked to letter the sub-questions and answers by BOTH stamping
//    "part":"a" and writing "(a)" into the wording, and qLiftPartMarkers —
//    whose whole job is to move a typed marker into the field — skipped every
//    block that already had a part. The one case it could not fix was the one
//    case that needed fixing.
//  • TOO EAGER and it eats the question. "（见图一）文中形容…" opens with a
//    bracket and is prose; a block labelled (b) whose text opens "(a)" is two
//    people disagreeing about which question this is. Removing either leaves a
//    question that still reads perfectly and is about something else.
//  • FULL-WIDTH IS MOST OF THEM in a 华文 paper: （a）文中形容…, with the
//    character hard against the bracket. A rule that demands whitespace after
//    the marker matches none of them, and the bug looks unfixed.
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

// The part core, plus qBlockOpensPart from further down — the label a block
// prints has to be checked against what stripping leaves behind.
const M = new Function(
  cut('const QPART_LETTERS', 'function qPartsUsed', 'part core') +
  cut('function qBlockOpensPart(b) {', '\n// Does this question use parts', 'opens') + `
return { strip: qStripOwnPartMarker, body: qPartBodyHtml, detect: qPartDetect,
         normalize: qPartNormalize, opens: qBlockOpensPart };`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
};

const blk = (part, content) => ({ type: 'text', part, content });
// Strips and returns the resulting content.
const stripped = b => { M.strip(b); return b.content; };

// ── it comes out when it is the same label twice ────────────────────────────

test('the reported case: part (a) and "(a) …" in the text', () => {
  const b = blk('a', '(a) 文中形容“问题得到处理，有了结果”的词语是________。');
  ok(M.strip(b), 'the doubled marker was not removed');
  eq(b.content, '文中形容“问题得到处理，有了结果”的词语是________。', 'the wording');
});

test('FULL-WIDTH （a）, with no space after it', () => {
  // How a 华文 paper actually prints it, and the case a whitespace-guarded
  // rule silently matches none of.
  eq(stripped(blk('a', '（a）文中形容“问题得到处理”的词语是____。')),
     '文中形容“问题得到处理”的词语是____。', 'the wording');
});

test('half-width with no space after it', () => {
  eq(stripped(blk('a', '(a)文中形容…')), '文中形容…', 'the wording');
});

test('a marker wrapped in markup', () => {
  // The marker is very often "<strong>(b)</strong>", so it has to be removed
  // from the ORIGINAL html rather than sliced out of plain text — a plain
  // offset would cut through the tag and leave it unbalanced.
  const out = stripped(blk('b', '<p><strong>(b)</strong> Why did the leaves turn yellow?</p>'));
  ok(!/\(b\)/.test(out), 'the marker survived: ' + out);
  ok(/Why did the leaves turn yellow\?/.test(out), 'the question was damaged: ' + out);
  ok(/^<p>/.test(out) && /<\/p>$/.test(out), 'the markup was left unbalanced: ' + out);
});

test('the bare "a)" and "a." forms', () => {
  eq(stripped(blk('a', 'a) What is the answer?')), 'What is the answer?', 'a) form');
  eq(stripped(blk('c', 'c. What is the answer?')), 'What is the answer?', 'c. form');
});

test('an upper-case marker on a lower-case part is still the same label', () => {
  eq(stripped(blk('a', '(A) What is the answer?')), 'What is the answer?', 'the wording');
});

// ── it stays out of everything else ─────────────────────────────────────────

test('a DIFFERENT letter is left alone — that is a disagreement, not a repeat', () => {
  // The block says (b) and the text says (a). One of them is wrong and only a
  // human can say which; removing either silently files the question under a
  // letter the author never chose.
  eq(stripped(blk('b', '(a) Why did the leaves turn yellow?')), '(a) Why did the leaves turn yellow?', 'unchanged');
  eq(stripped(blk('b', '（a）为什么…')), '（a）为什么…', 'unchanged, full-width');
});

test('a block with NO part keeps whatever it has', () => {
  // Nothing is being printed beside it, so there is nothing being repeated.
  // qLiftPartMarkers is what handles this one, by LIFTING the marker.
  eq(stripped(blk('', '(a) Why did the leaves turn yellow?')), '(a) Why did the leaves turn yellow?', 'unchanged');
});

test('prose that merely opens with a bracket is not a marker', () => {
  eq(stripped(blk('a', '(see Diagram 1) What is X?')), '(see Diagram 1) What is X?', 'unchanged');
  eq(stripped(blk('a', '（见图一）文中形容…')), '（见图一）文中形容…', 'unchanged, full-width');
});

test('TWO markers in one box is refused', () => {
  // Several parts written into one box, or an options list. Neither is fixed
  // by removing the first marker — the same guard the scan and autoNumberParts
  // already use.
  eq(stripped(blk('a', '(a) First bit<br>(b) Second bit')), '(a) First bit<br>(b) Second bit', 'unchanged');
  eq(stripped(blk('a', '（a）第一<br>（b）第二')), '（a）第一<br>（b）第二', 'unchanged, full-width');
});

test('a NUMBERED part is left alone', () => {
  // Detection is letters only, deliberately: a number at the start of a line
  // is a quantity or a year far more often than it is a part, and "16" is what
  // a comprehension passage prints against the word the question asks about.
  eq(stripped(blk('16', '16. What is X?')), '16. What is X?', 'unchanged');
});

test('an empty or missing block is handled rather than thrown on', () => {
  eq(stripped(blk('a', '')), '', 'empty content');
  ok(!M.strip(null), 'a null block');
  ok(!M.strip({}), 'a block with nothing on it');
  eq(M.body(null), '', 'body of nothing');
});

test('the legacy part BLOCK is never touched — its label IS its content', () => {
  const b = { type: 'part', part: 'a', label: '(a)', content: '(a)' };
  ok(!M.strip(b), 'a legacy part block was stripped');
  eq(b.content, '(a)', 'unchanged');
});

// ── the render side ─────────────────────────────────────────────────────────

test('qPartBodyHtml drops the repeat WITHOUT touching the block', () => {
  // This is what fixes the questions already in the bank: they were written
  // both ways and nobody is going to open them one at a time. It must not
  // rewrite the block, or an author would see the editor change under them.
  const b = blk('a', '(a) 文中形容…');
  eq(M.body(b), '文中形容…', 'what is rendered');
  eq(b.content, '(a) 文中形容…', 'the block must be left exactly as it was');
});

test('qPartBodyHtml hands back the content untouched when there is no repeat', () => {
  eq(M.body(blk('b', '(a) Why?')), '(a) Why?', 'a disagreeing marker');
  eq(M.body(blk('', '(a) Why?')), '(a) Why?', 'no part');
  eq(M.body(blk('a', 'Why did it happen?')), 'Why did it happen?', 'no marker');
});

test('the label the block prints is unaffected by any of this', () => {
  // Belt and braces: the whole point is that the label keeps coming from the
  // BLOCK. If stripping ever cost a block its part, the question would lose
  // its numbering instead of gaining it.
  const b = blk('a', '(a) 文中形容…');
  M.strip(b);
  eq(M.opens(b), 'a', 'the block stopped opening its part');
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
