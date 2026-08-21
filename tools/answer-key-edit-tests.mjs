// Regression tests for ✏️ THE ANSWER KEY, EDITED FROM THE PREVIEW.
// Run with:
//     node tools/answer-key-edit-tests.mjs            all cases
//     node tools/answer-key-edit-tests.mjs <name>     one case
//
// It loads the REAL functions out of app.js — the drawer's row builder and the
// two printed-key pushers it has to agree with.
//
// The answer key is the page a teacher MARKS thirty scripts from, so every
// failure here is one they meet in front of a class, and none of them throws:
//
//  • A FIELD THE KEY PRINTS AND THE DRAWER DOES NOT OFFER is a wrong answer
//    nobody can fix from the place they noticed it — the whole point of the
//    feature. The two lists are pinned against each other here, question shape
//    by question shape.
//  • A FIELD THE DRAWER OFFERS AND THE KEY DOES NOT PRINT is worse: the teacher
//    edits it, saves, and the sheet comes out of the printer unchanged.
//  • AN EXPLANATION WITH NO PART, on a question that HAS parts, silently reads
//    as explaining the LAST part — `qPartMap` inherits forward. That is the
//    exact fault QPART_NONE exists for, and the one thing about "➕ Add an
//    explanation" that can be quietly wrong.
//  • THE KEY SPLIT: every box is tagged `<blockId>|<field>`. Split on the
//    first separator instead of the last and an imported block id containing
//    one writes the teacher's answer onto a field that does not exist — the
//    edit simply vanishes on save.
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
function stripHtml(content) {
  if (!content) return '';
  return content.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\\s+/g, ' ').trim();
}
function sanitizeAnswerKeyHtml(c) { return c ? String(c) : ''; }
function transformImageUrl(u) { return u; }
let _idn = 0;
function generateBlockId() { return 'gen_' + (++_idn); }
`;

const M = new Function(SHIM +
  cut('const QPART_LETTERS', 'function qPartsUsed', 'part core') +
  cut('function qPartOf(map, block)', '\n// The next unused letter', 'partOf+opens+hasParts') +
  cut('function _pushAnswerKeySection(sections, label, content, part) {', '\n// A question with no answer-bearing block', 'key pushers') +
  cut('let _akeQid = null;', 'function akeOpen(', 'ake rows') +
  cut('function _akeKey(bid, field)', 'function _akeSyncFromDom', 'ake keys') +
  cut('function _akeNewExplanation(blocks, id) {', '\nfunction akeAddExplanation', 'new explanation') + `
return { rows: _akeRows, hasAnswer: _akeHasAnswer, key: _akeKey, splitKey: _akeSplitKey,
         newExpl: _akeNewExplanation, pushBlock: _pushBlockAnswerKey,
         pushSection: _pushAnswerKeySection, partMap: qPartMap, partOf: qPartOf,
         hasParts: qHasParts };`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
};
const deep = (got, want, what) => eq(JSON.stringify(got), JSON.stringify(want), what);

// What the PRINTED key says about a question, through the same two pushers
// both print paths use. `akExtras` mirrors the "💡 Explanations" switch.
const printedKey = (blocks, akExtras) => {
  const sections = [];
  const parts = M.partMap(blocks);
  blocks.forEach(b => {
    const p = M.partOf(parts, b);
    switch (b.type) {
      case 'answer':
        M.pushSection(sections, 'Claim', b.claim, p);
        M.pushSection(sections, 'Evidence', b.evidence, p);
        M.pushSection(sections, 'Reasoning', b.reasoning, p);
        break;
      case 'plainanswer': M.pushSection(sections, null, b.content, p); break;
      case 'explanation':
        if (akExtras && stripHtmlish(b.content)) sections.push({ label: 'Explanation', content: b.content, part: p });
        break;
      default: M.pushBlock(sections, b, p); break;
    }
  });
  return sections;
};
const stripHtmlish = c => String(c || '').replace(/<[^>]*>/g, ' ').trim();

// ── the drawer offers exactly what the key prints ───────────────────────────

test('a plain answer: the key prints it, the drawer offers it', () => {
  const blocks = [{ id: 'b1', type: 'plainanswer', content: 'It evaporates.' }];
  eq(printedKey(blocks).length, 1, 'one row on the key');
  const rows = M.rows(blocks);
  deep(rows.map(r => r.field), ['content'], 'one editable field');
  eq(rows[0].kind, 'rich', 'edited as rich text');
});

test('a CER answer: three rows on the key, three boxes in the drawer', () => {
  const blocks = [{ id: 'b1', type: 'answer', claim: 'A', evidence: 'B', reasoning: 'C' }];
  eq(printedKey(blocks).length, 3, 'three rows on the key');
  deep(M.rows(blocks).map(r => r.field), ['claim', 'evidence', 'reasoning'], 'three boxes');
});

test('an MCQ: the key names the option, the drawer lets you change it', () => {
  const blocks = [{ id: 'b1', type: 'mcq', correctId: 'o2',
                    options: [{ id: 'o1', text: 'Ice' }, { id: 'o2', text: 'Steam' }] }];
  const key = printedKey(blocks);
  eq(key.length, 1, 'the key names an answer');
  ok(/Steam/.test(key[0].content), 'and it is the ticked option');
  const rows = M.rows(blocks);
  eq(rows.length, 1, 'one drawer row');
  eq(rows[0].kind, 'mcq', 'drawn as the option list');
});

test('an answer line and a 🔑 answer-key block are both editable', () => {
  const blocks = [
    { id: 'b1', type: 'answerLine', label: 'Mass', answer: '24 g' },
    { id: 'b2', type: 'answerKey', text: 'Accept 24 g or 24g.' }
  ];
  eq(printedKey(blocks).length, 2, 'both print on the key');
  const rows = M.rows(blocks);
  deep(rows.map(r => r.field), ['answer', 'text'], 'both offered');
  eq(rows[0].kind, 'text', 'an answer line is a one-line input');
});

test('NOTHING that never reaches the key is offered for editing', () => {
  // A text block, a diagram, a table and a page break are the question, not
  // its answer. Offering them here would be the ✏️ edit question drawer.
  const blocks = [
    { id: 'b1', type: 'text', content: 'Why does the mass fall?' },
    { id: 'b2', type: 'image', url: 'x.png' },
    { id: 'b3', type: 'table', data: [] },
    { id: 'b4', type: 'pageBreak' },
    { id: 'b5', type: 'plainanswer', content: 'It evaporates.' }
  ];
  deep(M.rows(blocks).map(r => r.block.id), ['b5'], 'only the answer');
});

test('a question with no answer at all offers no answer row — and says so', () => {
  const blocks = [{ id: 'b1', type: 'text', content: 'Why?' }];
  eq(printedKey(blocks).length, 0, 'the key has nothing to print');
  ok(!M.hasAnswer(blocks), 'so the drawer offers to add one');
});

test('an explanation alone is not an answer', () => {
  // It is the FALLBACK the key prints when there is nothing else, which is
  // exactly the case "➕ Add an answer for the key" is offered for.
  const blocks = [{ id: 'b1', type: 'explanation', content: 'Because it evaporates.' }];
  ok(!M.hasAnswer(blocks), 'still no answer on file');
  eq(M.rows(blocks).length, 1, 'but the explanation is editable');
  eq(M.rows(blocks)[0].kind, 'explanation', 'and drawn as one');
});

// ── parts ───────────────────────────────────────────────────────────────────

test('each answer box is labelled with the part it belongs to', () => {
  const blocks = [
    { id: 't1', type: 'text', part: 'a', content: 'Name the process.' },
    { id: 'b1', type: 'plainanswer', content: 'Evaporation' },
    { id: 't2', type: 'text', part: 'b', content: 'Explain why.' },
    { id: 'b2', type: 'answer', claim: 'A', evidence: 'B', reasoning: 'C' }
  ];
  deep(M.rows(blocks).map(r => r.label),
    ['(a) Model answer', '(b) Claim', '(b) Evidence', '(b) Reasoning'], 'the labels');
});

test('a NEW explanation on a question WITH parts is filed under none', () => {
  // The one thing about adding an explanation that can be quietly wrong:
  // qPartMap inherits forward, so no part at all means "explains part (b)".
  const blocks = [
    { id: 't1', type: 'text', part: 'a', content: 'Name it.' },
    { id: 'b1', type: 'plainanswer', content: 'Evaporation' },
    { id: 't2', type: 'text', part: 'b', content: 'Explain.' },
    { id: 'b2', type: 'plainanswer', content: 'It gains heat.' }
  ];
  const ex = M.newExpl(blocks, 'x1');
  eq(ex.part, '-', 'filed under NO part');
  const withEx = blocks.concat([ex]);
  eq(M.partOf(M.partMap(withEx), ex), '', 'so it inherits nothing');
});

test('a NEW explanation on a question with NO parts carries no part field', () => {
  const blocks = [{ id: 'b1', type: 'plainanswer', content: 'It evaporates.' }];
  const ex = M.newExpl(blocks, 'x1');
  ok(!('part' in ex), 'nothing to file it under, so the field is left off');
});

test('an explanation filed under a part reaches the key under THAT part', () => {
  const blocks = [
    { id: 't1', type: 'text', part: 'a', content: 'Name it.' },
    { id: 'b1', type: 'plainanswer', content: 'Evaporation' },
    { id: 't2', type: 'text', part: 'b', content: 'Explain.' },
    { id: 'b2', type: 'plainanswer', content: 'It gains heat.' },
    { id: 'x1', type: 'explanation', part: 'a', content: 'Water turns to vapour.' }
  ];
  const key = printedKey(blocks, true);
  const ex = key.find(sec => sec.label === 'Explanation');
  ok(ex, 'the explanation printed');
  eq(ex.part, 'a', 'under the part it was filed under, not the last one');
});

test('a whole-question note prints unlabelled, not under the last part', () => {
  const blocks = [
    { id: 't1', type: 'text', part: 'a', content: 'Name it.' },
    { id: 'b1', type: 'plainanswer', content: 'Evaporation' },
    { id: 't2', type: 'text', part: 'b', content: 'Explain.' },
    { id: 'b2', type: 'plainanswer', content: 'It gains heat.' },
    { id: 'x1', type: 'explanation', part: '-', content: 'Both parts are about evaporation.' }
  ];
  const ex = printedKey(blocks, true).find(sec => sec.label === 'Explanation');
  eq(ex.part, '', 'no part label');
});

test('an unfiled explanation does NOT close the part it sits inside', () => {
  // It unfiles that block only — an answer box after it must keep its part.
  const blocks = [
    { id: 't1', type: 'text', part: 'a', content: 'Name it.' },
    { id: 'x1', type: 'explanation', part: '-', content: 'A note about the whole thing.' },
    { id: 'b1', type: 'plainanswer', content: 'Evaporation' }
  ];
  eq(M.partOf(M.partMap(blocks), blocks[2]), 'a', 'the answer is still part (a)');
});

// ── the explanations switch ─────────────────────────────────────────────────

test('an explanation only prints on the key when the switch is on', () => {
  const blocks = [
    { id: 'b1', type: 'plainanswer', content: 'It evaporates.' },
    { id: 'x1', type: 'explanation', content: 'Water turns to vapour.' }
  ];
  eq(printedKey(blocks, false).length, 1, 'switch off — the answer alone');
  eq(printedKey(blocks, true).length, 2, 'switch on — the explanation too');
});

test('the answer is never gated on the switch', () => {
  // An answer is the answer. Gating it behind the explanations flag is the
  // v1.284.0 bug, and this is the guard against putting it back.
  const blocks = [{ id: 'b1', type: 'mcq', correctId: 'o1', options: [{ id: 'o1', text: 'Ice' }] }];
  eq(printedKey(blocks, false).length, 1, 'the MCQ answer prints either way');
});

// ── the box keys ────────────────────────────────────────────────────────────

test('a box key round-trips, even for a block id containing the separator', () => {
  deep(M.splitKey(M.key('b1', 'claim')), ['b1', 'claim'], 'an ordinary id');
  deep(M.splitKey(M.key('odd|id', 'content')), ['odd|id', 'content'], 'an imported id with a bar in it');
});

test('a key with no separator at all does not throw', () => {
  deep(M.splitKey('rubbish'), ['rubbish', ''], 'and yields no field, so nothing is written');
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
