// Regression tests for (b)(i) — ROMAN SUB-PARTS.
// Run with:
//     node tools/sub-part-tests.mjs            all cases
//     node tools/sub-part-tests.mjs <name>     one case
//
// A PSLE part very often splits again into (i) and (ii). Before this both
// sub-answers inherited the same letter, so the answer key printed ONE "(b)"
// heading with two answers run together under it, and the AI marker was handed
// both sub-questions as one item.
//
// It is a SECOND FIELD on the block, `subPart`, and `qPartMap` hands back a
// part KEY ('b', 'b.i', '.i') instead of a bare letter. Every way that goes
// wrong is silent:
//
//  • A SUB-PART THAT DOES NOT INHERIT ITS LETTER is the reason it is a second
//    field rather than a wider alphabet on `part`. A block carrying only
//    `subPart: 'ii'` belongs to whatever letter is current, so renaming (b) to
//    (c) carries its sub-parts with it. Freeze the letter into the key at
//    authoring time and a renumbered question quietly keeps the old one.
//  • A NEW LETTER MUST START FRESH. If (c) inherited the sub-part left over
//    from (b)(ii), every answer under (c) would be filed as (c)(ii).
//  • A LETTER STILL COVERS ITS OWN SUB-PARTS. The exam paper builder and the
//    explanation placer are letter-scoped: `qPartSpan(blocks,'b')` has to find
//    the blocks in (b)(i) and (b)(ii), or the marking scheme's answer for (b)
//    lands nowhere.
//  • `qBlockOpensPart` MUST STAY A BARE LETTER. Those same callers, plus
//    autoNumberParts and the Question Doctor, are letter-scoped; handing them
//    'b.i' makes every one of them silently match nothing.
//  • THE LABEL IS DRAWN FROM THE BLOCK, so a roman also typed at the front of
//    the wording prints twice: "(b)(ii) (ii) placing all three beakers…".
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

const M = new Function(
  cut('const QPART_LETTERS', 'function qPartsUsed', 'part core') +
  cut('function qPartOf(map, block)', '\n// The next unused letter', 'partOf+opens+hasParts') +
  cut('function qPartSpan(blocks, letter) {', '\n// ---- Parts in an AI-built question', 'spans') + `
return { normalize: qPartNormalize, sub: qSubNormalize, letter: qPartLetterNormalize,
         key: qPartKey, letterOf: qPartLetterOf, subOf: qPartSubOf, keyIn: qPartKeyIn,
         label: qPartLabel, map: qPartMap, partOf: qPartOf,
         opens: qBlockOpensPart, opensSub: qBlockOpensSub, opensKey: qBlockOpensKey,
         hasParts: qHasParts, span: qPartSpan, find: qPartFind,
         body: qPartBodyHtml, strip: qStripOwnPartMarker, ROMANS: QPART_ROMANS };`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
};
const deep = (got, want, what) => eq(JSON.stringify(got), JSON.stringify(want), what);

const txt = (part, subPart, content) => ({ id: 't' + Math.random().toString(36).slice(2, 7), type: 'text', part, subPart, content: content || 'Ask something.' });
const ans = () => ({ id: 'a' + Math.random().toString(36).slice(2, 7), type: 'plainanswer', content: 'Because.' });
// The reported question: (b) with (i) and (ii) under it.
const reported = () => {
  const b = [
    txt('b', '', 'Give a reason how each action helps to make her experiment a fair test.'),
    txt('', 'i', 'using similar beakers'), ans(),
    txt('', 'ii', 'placing all three beakers at the same place'), ans()
  ];
  return b;
};
const keysOf = blocks => { const m = M.map(blocks); return blocks.map(b => M.partOf(m, b)); };

// ── the reported bug ────────────────────────────────────────────────────────

test('(b)(i) and (b)(ii) are DIFFERENT parts, so their answers cannot merge', () => {
  const blocks = reported();
  deep(keysOf(blocks), ['b', 'b.i', 'b.i', 'b.ii', 'b.ii'], 'where each block is filed');
  // The two answer boxes — the whole complaint was that these were the same.
  ok(keysOf(blocks)[2] !== keysOf(blocks)[4], 'the two answers are filed apart');
});

test('…and they LABEL as the paper prints them', () => {
  const ks = keysOf(reported());
  eq(M.label(ks[1]), '(b)(i)', 'the first sub-question');
  eq(M.label(ks[3]), '(b)(ii)', 'the second');
  eq(M.label(ks[0]), '(b)', 'the shared stem');
});

test('a sub-part INHERITS its letter, so renumbering carries it along', () => {
  // This is why it is a second field. Freeze 'b' into the key at authoring
  // time and renaming the part leaves the sub-parts pointing at the old one.
  const blocks = reported();
  blocks[0].part = 'c';
  deep(keysOf(blocks), ['c', 'c.i', 'c.i', 'c.ii', 'c.ii'], 'all of it moved to (c)');
});

test('a NEW letter starts fresh — it never inherits the last sub-part', () => {
  const blocks = reported().concat([txt('c', '', 'A new part.'), ans()]);
  const ks = keysOf(blocks);
  eq(ks[5], 'c', 'the new part');
  eq(ks[6], 'c', 'and its answer — NOT c.ii');
});

test('a block may open both at once', () => {
  const blocks = [txt('b', 'i', 'First sub-question.'), ans()];
  deep(keysOf(blocks), ['b.i', 'b.i'], 'both halves from one block');
});

test('sub-parts with no letters at all still get their own headings', () => {
  // A question numbered (i) (ii) with no (a)/(b) above them.
  const blocks = [txt('', 'i', 'One.'), ans(), txt('', 'ii', 'Two.'), ans()];
  deep(keysOf(blocks), ['.i', '.i', '.ii', '.ii'], 'filed apart');
  eq(M.label('.i'), '(i)', 'and labelled as the paper prints them');
  ok(M.hasParts(blocks), 'the question uses parts');
});

// ── the key, taken apart and put back together ──────────────────────────────

test('a key round-trips', () => {
  eq(M.key('b', 'i'), 'b.i', 'both');
  eq(M.key('b', ''), 'b', 'letter only');
  eq(M.key('', 'i'), '.i', 'roman only');
  eq(M.key('', ''), '', 'neither');
  eq(M.letterOf('b.i'), 'b', 'the letter back out');
  eq(M.subOf('b.i'), 'i', 'the roman back out');
  eq(M.letterOf('b'), 'b', 'a bare letter');
  eq(M.subOf('b'), '', 'has no roman');
  eq(M.letterOf('.i'), '', 'a roman-only key has no letter');
  eq(M.subOf('.i'), 'i', 'and keeps its roman');
});

test('every legacy value normalises exactly as it always did', () => {
  eq(M.normalize('a'), 'a', 'a bare letter');
  eq(M.normalize('(b)'), 'b', 'bracketed');
  eq(M.normalize('C.'), 'c', 'with a trailing dot');
  eq(M.normalize(''), '', 'empty');
  eq(M.normalize('i'), '', "'i' is still not an assignable letter");
  eq(M.normalize('zz'), '', 'nonsense');
});

test('a composite key normalises, and rubbish in either half does not', () => {
  eq(M.normalize('b.i'), 'b.i', 'valid');
  eq(M.normalize('b.viii'), 'b.viii', 'the last roman');
  eq(M.normalize('.ii'), '.ii', 'roman only');
  // A malformed key is REFUSED outright rather than half-read. Keys are only
  // ever produced by qPartKey from two validated halves, so a bad one is
  // corrupt data — and filing a block under (b) because the roman half was
  // rubbish would be a guess presented as a fact.
  eq(M.normalize('b.ix'), '', "'ix' is not a sub-part, so the key is refused");
  eq(M.normalize('zz.i'), '', 'a bad letter, likewise');
});

test('only a real roman is a sub-part', () => {
  M.ROMANS.forEach(r => eq(M.sub(r), r, 'roman ' + r));
  eq(M.sub('(ii)'), 'ii', 'brackets come off');
  eq(M.sub('ix'), '', 'past the end');
  eq(M.sub('l'), '', 'a letter that is not one of them');
  eq(M.sub(''), '', 'nothing');
});

// ── the letter-scoped callers still mean what they meant ────────────────────

test('qBlockOpensPart is still a BARE LETTER, never a key', () => {
  // The exam paper builder, autoNumberParts and the Doctor are all letter
  // scoped. Hand them 'b.i' and every one of them silently matches nothing.
  const b = txt('b', 'ii', 'x');
  eq(M.opens(b), 'b', 'the letter');
  eq(M.opensSub(b), 'ii', 'and the roman, separately');
});

test('a LETTER covers its own sub-parts', () => {
  ok(M.keyIn('b.i', 'b'), '(b)(i) is inside (b)');
  ok(M.keyIn('b', 'b'), 'and so is (b) itself');
  ok(!M.keyIn('c.i', 'b'), 'but (c)(i) is not');
  ok(M.keyIn('b.i', 'b.i'), 'a full key matches itself');
  ok(!M.keyIn('b.ii', 'b.i'), 'and not its sibling');
  ok(!M.keyIn('b', 'b.i'), 'nor the letter it sits in');
});

test('qPartSpan(blocks, "b") still finds everything under (b)', () => {
  // The marking scheme writes one answer for part (b); it has to land inside
  // the whole of (b), sub-parts included.
  const blocks = reported().concat([txt('c', '', 'A new part.'), ans()]);
  const span = M.span(blocks, 'b');
  eq(span.first, 0, 'from the stem');
  eq(span.last, 4, 'to the last sub-answer');
});

test('qPartFind(blocks, "b", …) reaches into a sub-part', () => {
  const blocks = reported();
  const hit = M.find(blocks, 'b', b => b.type === 'plainanswer');
  ok(hit, 'found an answer inside (b)');
  eq(blocks.indexOf(hit), 2, 'the first one');
});

// ── the label is drawn from the block, so it must not also be in the text ───

test('a roman typed at the front of its own block comes out at RENDER', () => {
  const b = txt('', 'ii', '(ii) placing all three beakers at the same place');
  eq(M.body(b), 'placing all three beakers at the same place', 'the wording');
  eq(b.content, '(ii) placing all three beakers at the same place', 'and the block is untouched');
});

test('"(b)(ii) …" loses BOTH markers', () => {
  const b = txt('b', 'ii', '(b)(ii) placing all three beakers');
  eq(M.body(b), 'placing all three beakers', 'both off');
});

test('a roman that is NOT this block\'s own is left for a human to look at', () => {
  const b = txt('', 'ii', '(i) using similar beakers');
  eq(M.body(b), '(i) using similar beakers', 'two people disagreeing — not tidied away');
});

test('a block with no sub-part of its own is never touched', () => {
  const b = txt('b', '', '(i) using similar beakers');
  eq(M.body(b), '(i) using similar beakers', 'unchanged');
});

test('the strip cuts the marker out of the MARKUP, not through it', () => {
  // qPartDetect deletes the marker's CHARACTERS and never a tag, so a wrapped
  // marker leaves its (empty, invisible) wrapper behind rather than an
  // unbalanced <strong> — the same residue the letter path has always left.
  const b = txt('', 'ii', '<p><strong>(ii)</strong> placing them together</p>');
  eq(M.body(b), '<p><strong></strong>placing them together</p>', 'balanced markup, marker gone');
});

test('qStripOwnPartMarker takes it out of the BLOCK, and reports honestly', () => {
  const b = txt('', 'ii', '(ii) placing them together');
  ok(M.strip(b), 'something was removed');
  eq(b.content, 'placing them together', 'the stored wording');
  ok(!M.strip(b), 'and a second run finds nothing');
});

// ── the marker a block prints beside itself ─────────────────────────────────

test('a block that opens only a roman still shows its FULL key', () => {
  const blocks = reported();
  const m = M.map(blocks);
  eq(M.opensKey(blocks[1], m), 'b.i', 'resolved through the map');
  eq(M.label(M.opensKey(blocks[1], m)), '(b)(i)', 'so the paper prints (b)(i)');
});

test('a block that opens nothing prints no marker', () => {
  const blocks = reported();
  eq(M.opensKey(blocks[2], M.map(blocks)), '', 'an answer box carries no label of its own');
});

test('with no map to hand, a block falls back to its own two fields', () => {
  eq(M.opensKey(txt('b', 'i', 'x'), null), 'b.i', 'all a lone block can know');
  eq(M.opensKey(txt('', 'i', 'x'), null), '.i', 'the letter is simply not there to inherit');
});

// ── nothing about a lettered-only question moved ────────────────────────────

test('a question with no sub-parts is filed and labelled exactly as before', () => {
  const blocks = [txt('a', '', 'One.'), ans(), txt('b', '', 'Two.'), ans()];
  deep(keysOf(blocks), ['a', 'a', 'b', 'b'], 'bare letters');
  eq(M.label('a'), '(a)', 'and the old label');
});

test('a question with no parts at all is still partless', () => {
  const blocks = [txt('', '', 'Just a question.'), ans()];
  ok(!M.hasParts(blocks), 'no parts');
  deep(keysOf(blocks), ['', ''], 'nothing filed');
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
