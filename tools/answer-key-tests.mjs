// Regression tests for the PRINTED ANSWER KEY. Run with:
//     node tools/answer-key-tests.mjs            all cases
//     node tools/answer-key-tests.mjs <name>     one case
//
// It loads the REAL answer-key pushers out of app.js.
//
// This is a silent failure in the worst way: a worksheet key that omits a
// question prints perfectly, looks tidy, and the teacher only finds out in
// front of the class. The bug it exists to pin is exactly that — every MCQ
// answer was dropped from the key of an ordinary worksheet (they were gated
// behind the past-paper `answerKeyExtras` flag), so a paper of twenty
// questions printed a key listing six.
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

const section = [
  "const QPART_ASSIGN = " + /const QPART_ASSIGN = ('[a-z]*')/.exec(src)[1] + ';',
  cut('function qPartNormalize', '// The part each block belongs to', 'part helpers'),
  cut('function stripHtml(', '\n\n', 'stripHtml'),
  // escapeHtml goes through the DOM in the app; the shim is the same contract.
  "function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }",
  'function transformImageUrl(u) { return String(u || \'\'); }',
  cut('function _pushAnnotAnswerKey', '// How many ruled lines a printed answer box gets', 'answer-key pushers')
].join('\n');

const M = new Function(section + '\nreturn { _pushBlockAnswerKey, _pushAnswerKeySection, _pushAnnotAnswerKey,'
  + ' _qFallbackKeySection, _akQuestionSections, _akSectionsHtml, AK_NO_ANSWER, sanitizeAnswerKeyHtml };')();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};
const ok = (cond, what) => { if (!cond) throw new Error(what); };

const mcq = (correct) => ({
  type: 'mcq', correctId: correct,
  options: [{ id: 'o1', text: 'Evaporation' }, { id: 'o2', text: 'Condensation' },
            { id: 'o3', text: 'Melting' }, { id: 'o4', text: 'Freezing' }]
});
const push = (block, part) => { const s = []; M._pushBlockAnswerKey(s, block, part); return s; };

// ---- the bug ---------------------------------------------------------------
test('an MCQ puts its correct option on the key', () => {
  const s = push(mcq('o2'));
  eq(s.length, 1, 'one section');
  eq(s[0].label, 'Answer', 'labelled');
  ok(s[0].content.indexOf('Condensation') >= 0, 'names the option: ' + s[0].content);
  ok(s[0].content.indexOf('<b>2.</b>') >= 0, 'and numbers it as the student sees it: ' + s[0].content);
});

test('the option NUMBER is its position, not its id', () => {
  eq(push(mcq('o1'))[0].content.indexOf('<b>1.</b>'), 0, 'first option');
  ok(push(mcq('o4'))[0].content.indexOf('<b>4.</b>') === 0, 'fourth option');
});

test('an MCQ with no correct option ticked pushes nothing', () => {
  // An authoring gap, not an answer — the placeholder is what surfaces it.
  eq(push(mcq(null)).length, 0, 'null correctId');
  eq(push(mcq('nope')).length, 0, 'a correctId matching no option');
  eq(push({ type: 'mcq' }).length, 0, 'no options at all');
});

// ---- the other answer-bearing blocks ---------------------------------------
test('an answer line puts its answer on the key', () => {
  const s = push({ type: 'answerLine', label: 'Ans:', answer: '4.5 N' });
  eq(s.length, 1, 'one section');
  eq(s[0].label, 'Ans:', 'keeps the author\'s own label');
  ok(s[0].content.indexOf('4.5 N') >= 0, 'and the answer');
  eq(M._pushBlockAnswerKey.length, 3, 'signature is (sections, block, part)');
  eq(push({ type: 'answerLine', answer: 'Oxygen' })[0].label, 'Answer', 'unlabelled falls back');
  eq(push({ type: 'answerLine', label: 'Ans:', answer: '   ' }).length, 0, 'a blank answer is not an answer');
});

test('a 🔑 answer-key block reaches the key, words or picture', () => {
  eq(push({ type: 'answerKey', text: 'Both bulbs light.' })[0].label, 'Answer key', 'words');
  const img = push({ type: 'answerKey', text: '', url: 'https://x/y.png' });
  eq(img.length, 1, 'a picture alone is still an answer');
  ok(img[0].content.indexOf('<img') >= 0, 'and is rendered: ' + img[0].content);
  eq(push({ type: 'answerKey', text: '', url: '' }).length, 0, 'an empty one pushes nothing');
});

test('a block that carries no answer pushes nothing', () => {
  ['text', 'image', 'openLines', 'workingSpace', 'commonMistake', 'studentAnswer', 'pageBreak', 'video']
    .forEach(type => eq(push({ type, content: 'x', text: 'x', answer: 'x' }).length, 0, type));
});

// ---- parts -----------------------------------------------------------------
test('an answer is filed under the part its block belongs to', () => {
  eq(push(mcq('o2'), 'b')[0].part, 'b', 'mcq');
  eq(push({ type: 'answerLine', answer: 'Oxygen' }, '(c)')[0].part, 'c', 'answer line, marker form');
  eq(push({ type: 'answerKey', text: 'x' }, 'a')[0].part, 'a', 'answer-key block');
  eq(push(mcq('o2'))[0].part, '', 'no part is no part');
});

// ---- the fallback and the placeholder --------------------------------------
test('a question with no answer at all falls back to its explanation', () => {
  const q = { blocks: [{ type: 'text', content: 'Why?' }, { type: 'explanation', content: 'Water vapour cools.' }] };
  const fb = M._qFallbackKeySection(q);
  ok(fb, 'there is a fallback');
  eq(fb.label, 'Explanation', 'labelled honestly — it is not the answer');
  ok(fb.content.indexOf('Water vapour cools') >= 0, 'and carries the note');
  eq(M._qFallbackKeySection({ blocks: [{ type: 'explanation', content: '   ' }] }), null, 'a blank explanation is nothing');
  eq(M._qFallbackKeySection({ blocks: [] }), null, 'no blocks');
  eq(M._qFallbackKeySection(null), null, 'no question');
});

test('a question that still yields nothing is LISTED, not skipped', () => {
  // A gap in the numbering reads as a printing fault, so every question gets a
  // row and the empty ones say so.
  const secs = M._akQuestionSections({ title: 'Question 7', sections: [] });
  eq(secs.length, 1, 'exactly one placeholder row');
  ok(/no answer recorded/i.test(secs[0].content), 'and it says so: ' + secs[0].content);
  const real = [{ label: 'Answer', content: '<b>2.</b> Condensation' }];
  eq(M._akQuestionSections({ sections: real }), real, 'a question with answers is untouched');
});

test('the placeholder can never be what makes the key page appear', () => {
  // A bank with no model answers must print NO key sheet — not a page of
  // "no answer recorded". That is why the hasAny guard reads the real
  // sections and the placeholder is substituted only at render time.
  const empty = [{ title: 'Q1', sections: [] }, { title: 'Q2', sections: [] }];
  eq(empty.some(d => d.sections && d.sections.length > 0), false, 'nothing real → no sheet');
  ok(M.AK_NO_ANSWER.length === 1, 'the placeholder is a constant, not something pushed onto a question');
});

// ---- rendering -------------------------------------------------------------
test('the part heading prints once per part, not once per answer', () => {
  const html = M._akSectionsHtml([
    { label: 'Claim', content: 'A', part: 'b' },
    { label: 'Evidence', content: 'B', part: 'b' },
    { label: 'Reasoning', content: 'C', part: 'b' },
    { label: 'Answer', content: 'D', part: 'c' }
  ]);
  eq((html.match(/class="ak-part"/g) || []).length, 2, 'two headings for two parts');
  ok(html.indexOf('(b)') >= 0 && html.indexOf('(c)') >= 0, 'both are labelled');
});

test('the placeholder renders without a stray label', () => {
  const html = M._akSectionsHtml(M._akQuestionSections({ sections: [] }));
  eq(html.indexOf('ak-sublabel'), -1, 'no sublabel for a null label');
  ok(html.indexOf('ak-fullcontent') >= 0, 'but the row is there');
});

test('an answer is sanitised on the way to the key', () => {
  const s = push({ type: 'answerKey', text: '<b>Yes</b><script>alert(1)</script>' });
  eq(s[0].content.indexOf('<script'), -1, 'no script survives: ' + s[0].content);
  ok(s[0].content.indexOf('<b>Yes</b>') >= 0, 'but the formatting does');
  const m = push({ type: 'mcq', correctId: 'o1', options: [{ id: 'o1', text: '<img src=x onerror="bad()">' }] });
  eq(/\son\w+=/.test(m[0].content), false, 'and an option cannot smuggle a handler: ' + m[0].content);
});

// ---- nothing throws on rubbish ---------------------------------------------
test('a malformed block never throws', () => {
  [null, undefined, {}, { type: null }, { type: 'mcq', options: null }, { type: 'answerLine' },
   { type: 'answerKey' }].forEach(b => {
    const s = [];
    M._pushBlockAnswerKey(s, b, undefined);
    ok(Array.isArray(s), 'survived ' + JSON.stringify(b));
  });
});

// ---- run -------------------------------------------------------------------
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name.indexOf(only) < 0) continue;
  try { c.fn(); pass++; console.log('  ok   ' + c.name); }
  catch (e) { fail++; console.log('  FAIL ' + c.name + '\n         ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
