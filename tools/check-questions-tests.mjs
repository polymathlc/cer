// Regression tests for ✅ CHECK QUESTIONS' structural checks. Run with:
//     node tools/check-questions-tests.mjs            all cases
//     node tools/check-questions-tests.mjs <name>     one case
//
// It loads the REAL detector section out of app.js — `_cqTableLabelsChoices`,
// `_cqOptsAreBareNumbers`, `_cqMcqFixable`, `_cqLocalFindings` — and runs it
// over synthetic questions.
//
// This is pinned because both directions fail SILENTLY. Too loose and the page
// tells an employee to blank the options of a question whose choices are NOT in
// the table — one tap and the wording of all four is gone, with the ＃ button
// looking like it did the right thing. Too tight and the one problem the whole
// page exists to catch never gets flagged at all. Neither throws.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const a = src.indexOf('// ---- the tables an option list can be repeating');
const b = src.indexOf('// ---- the AI pass: the question AND its diagrams', a);
if (a < 0 || b < 0) throw new Error('check-questions detector section not found in app.js — did the banner comments change?');

// The few things the section leans on from the rest of the module. `stripHtml`
// and `_docNorm` are copied verbatim from app.js; `questionHasMarkableAnswer`
// is reduced to the clause these tests exercise.
const preamble = `
const CQ_LONG_OPTION = 20;
function stripHtml(content) {
  if (!content) return '';
  return content.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\\s+/g, ' ').trim();
}
function _docNorm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\\s+/g, ' ').trim(); }
function questionHasMarkableAnswer(q) {
  return (((q && q.blocks) || []).some(b => b && ['answer', 'plainanswer', 'openLines', 'workingSpace', 'mcq'].includes(b.type)));
}
`;

const M = new Function(preamble + src.slice(a, b) +
  '\nreturn { _cqTableRows, _cqTableCells, _cqOptsAreBareNumbers, _cqMcqFixable, _cqTableLabelsChoices, _cqWords, _cqLocalFindings };')();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};

// ---- builders --------------------------------------------------------------
let n = 0;
const mcq = (texts, correct = 0) => ({
  id: 'b' + (++n), type: 'mcq', correctId: 'o' + correct,
  options: texts.map((t, i) => ({ id: 'o' + i, text: t }))
});
const table = rows => ({ id: 'b' + (++n), type: 'table', rows: rows.length, cols: rows[0].length, data: rows });
const text = s => ({ id: 'b' + (++n), type: 'text', content: '<p>' + s + '</p>' });
const pic = (url = 'https://x/y.png') => ({ id: 'b' + (++n), type: 'image', url });
const ans = s => ({ id: 'b' + (++n), type: 'plainanswer', content: s });
const q = (blocks, extra) => Object.assign({ id: 'q' + (++n), title: 'A question', topic: 'Heat', blocks }, extra || {});

// Every finding the page would show for this question, AI not yet run.
const find = question => M._cqLocalFindings(question, false);
const repeats = question => find(question).filter(f => f.fix === 'numberOptions');

// ---- the headline check: options repeating the table -----------------------
test('a table that labels its rows 1-4 IS the option list', () => {
  // The commonest shape by far: the table sets out four candidate answers, and
  // the options underneath spell each row out again in words.
  const question = q([
    text('Which row shows the correct properties?'),
    table([
      ['', 'Melts', 'Conducts'],
      ['1', 'Yes', 'Yes'],
      ['2', 'Yes', 'No'],
      ['3', 'No', 'Yes'],
      ['4', 'No', 'No']
    ]),
    mcq(['Yes, Yes', 'Yes, No', 'No, Yes', 'No, No'])
  ]);
  const hits = repeats(question);
  eq(hits.length, 1, 'exactly one renumber finding');
  eq(hits[0].severity, 'high', 'severity');
});

test('option wording already printed in the table is caught without row numbers', () => {
  const question = q([
    text('Which material is the best conductor?'),
    table([['Material', 'Heat conducted'], ['Copper wire', 'High'], ['Wooden rod', 'Low'], ['Plastic straw', 'Low'], ['Glass tube', 'Low']]),
    mcq(['Copper wire', 'Wooden rod', 'Plastic straw', 'Glass tube'])
  ]);
  eq(repeats(question).length, 1, 'the options are the table cells');
});

test('options carrying information the table does NOT have are left alone', () => {
  // The trap. There is a table, there is an MCQ — but the options are real
  // science statements, and blanking them destroys the question.
  const question = q([
    text('Look at the results.'),
    table([['Beaker', 'Temperature'], ['A', '30 °C'], ['B', '55 °C']]),
    mcq([
      'Beaker B lost heat to the surroundings faster',
      'The water in A had a greater mass than in B',
      'Evaporation removed heat from the liquid surface',
      'The thermometer in B was faulty'
    ])
  ]);
  eq(repeats(question).length, 0, 'must not offer to blank real options');
});

test('a table with no MCQ at all is never flagged', () => {
  const question = q([text('Record your readings.'), table([['Trial', 'Time'], ['1', '4 s'], ['2', '6 s']]), ans('Six seconds.')]);
  eq(repeats(question).length, 0, 'no option list to renumber');
});

test('options that are ALREADY (1)(2)(3)(4) are never flagged again', () => {
  // The fix must be idempotent: a question someone has already fixed must not
  // come back round the queue with the same button on it.
  const rows = [['', 'Melts'], ['1', 'Yes'], ['2', 'No'], ['3', 'Yes'], ['4', 'No']];
  ['(1)', '1.', ' 2 )', '3'].forEach(sample => ok(/^[\s([]*\d{1,2}[\s)\].:-]*$/.test(sample), 'numberish: ' + sample));
  const question = q([table(rows), mcq(['(1)', '(2)', '(3)', '(4)'])]);
  eq(repeats(question).length, 0, 'already numbered');
  eq(M._cqMcqFixable(question), null, 'and the ＃ button is not offered');
  ok(M._cqOptsAreBareNumbers(question.blocks[1]), 'read as bare numbers');
});

test('blank options count as already-numbered, not as a repeat', () => {
  const question = q([table([['1', 'a'], ['2', 'b']]), mcq(['', '', '', ''])]);
  eq(repeats(question).length, 0, 'nothing to renumber');
});

// ---- the picture case: a nudge, and it stands down for the AI ---------------
test('wordy options beside a diagram raise a LOW nudge, never the one-tap fix', () => {
  // A picture cannot be read here, so this may only suggest a look. Offering
  // the destructive fix on a guess is exactly what must not happen.
  const question = q([
    text('Study the diagram of the circuit.'),
    pic(),
    mcq(['The bulb in circuit A lights up brightly', 'The bulb in circuit B does not light up at all',
         'Both bulbs light up with the same brightness', 'Neither of the two bulbs lights up'])
  ]);
  const hits = find(question).filter(f => f.type === 'Options');
  eq(hits.length, 1, 'one nudge');
  eq(hits[0].severity, 'low', 'low severity');
  eq(hits[0].fix, '', 'and NO one-tap fix');
});

test('the nudge disappears once the AI has answered', () => {
  const question = q([text('Study the diagram.'), pic(), mcq(['The bulb in circuit A lights up brightly', 'The bulb in circuit B does not light up at all'])]);
  ok(M._cqLocalFindings(question, false).some(f => f.type === 'Options'), 'raised before the AI runs');
  ok(!M._cqLocalFindings(question, true).some(f => f.type === 'Options'), 'stood down after');
});

test('short options beside a diagram are not nudged', () => {
  const question = q([text('Study the diagram.'), pic(), mcq(['2 N', '4 N', '6 N', '8 N'])]);
  eq(find(question).filter(f => f.type === 'Options').length, 0, 'nothing wordy about them');
});

// ---- the ordinary checks ---------------------------------------------------
test('an MCQ with nothing ticked is high severity', () => {
  const block = mcq(['Yes', 'No']);
  block.correctId = '';
  const hits = find(q([text('Is it?'), block])).filter(f => f.type === 'MCQ');
  ok(hits.some(f => /correct option/i.test(f.title) && f.severity === 'high'), 'no correct option');
});

test('two identical options are caught', () => {
  const hits = find(q([text('Which?'), mcq(['Copper', 'Wood', 'copper ', 'Glass'])])).filter(f => f.type === 'MCQ');
  ok(hits.some(f => /identical/i.test(f.title)), 'repeated options');
});

test('a blank model answer is caught, a filled one is not', () => {
  ok(find(q([text('Explain.'), ans('')])).some(f => f.type === 'Answer'), 'blank');
  eq(find(q([text('Explain.'), ans('Because heat flows from hot to cold.')])).filter(f => f.type === 'Answer').length, 0, 'filled');
});

test('wording that promises a figure the question does not have', () => {
  ok(find(q([text('Look at the diagram below.'), ans('Copper.')])).some(f => f.type === 'Diagram'), 'no picture, no table');
  eq(find(q([text('Look at the diagram below.'), pic(), ans('Copper.')])).filter(f => f.type === 'Diagram').length, 0, 'picture present');
  eq(find(q([text('Look at the table below.'), table([['a', 'b']]), ans('Copper.')])).filter(f => f.type === 'Diagram').length, 0, 'table present');
});

test('an empty picture placeholder is caught', () => {
  ok(find(q([text('Look.'), pic(''), ans('Copper.')])).some(f => /empty picture/i.test(f.title)), 'placeholder with no picture');
});

test('a missing topic is a low-severity filing note', () => {
  const hits = find(q([text('Why?'), ans('Because.')], { topic: '' })).filter(f => f.type === 'Filing');
  eq(hits.length, 1, 'one note');
  eq(hits[0].severity, 'low', 'low');
});

// ---- table data arrives in two shapes --------------------------------------
test('a table read straight from Firestore (object of rows) is read too', () => {
  // normalizeLoadedQuestion restores arrays, but a question held from a raw
  // read has not been through it — and silently reading no cells would turn
  // the headline check off without any error.
  const objTable = { id: 'bt', type: 'table', data: { '0': { '0': '', '1': 'Melts' }, '1': { '0': '1', '1': 'Yes' }, '2': { '0': '2', '1': 'No' } } };
  eq(M._cqTableCells(objTable).sort(), ['1', '2', 'Melts', 'No', 'Yes'], 'cells');
  ok(M._cqTableLabelsChoices([objTable], 2), 'rows 1 and 2 label the choices');
});

test('table cells keep their HTML stripped', () => {
  eq(M._cqTableCells(table([['<b>Copper</b>', 'High&nbsp;heat']])), ['Copper', 'High heat'], 'stripped');
});

test('the row-label test needs EVERY number, not just some', () => {
  const t = table([['1', 'a'], ['2', 'b'], ['4', 'c']]);
  ok(!M._cqTableLabelsChoices([t], 4), '3 is missing');
  ok(M._cqTableLabelsChoices([table([['(1)', 'a'], ['2.', 'b']])], 2), 'brackets and stops are fine');
  ok(!M._cqTableLabelsChoices([t], 1), 'one option is not a choice list');
});

// ---- nothing throws on rubbish input ---------------------------------------
test('a malformed question never throws', () => {
  [null, undefined, {}, { blocks: null }, { blocks: [null, {}, { type: 'mcq' }] },
   { blocks: [{ type: 'table', data: null }, { type: 'table', data: 'nonsense' }] }].forEach(bad => {
    const out = M._cqLocalFindings(bad, false);
    ok(Array.isArray(out), 'always an array');
  });
  eq(M._cqMcqFixable(null), null, 'no question, no fix button');
  eq(M._cqTableRows(null), [], 'no table');
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
