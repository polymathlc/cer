// Options printed as a table (option-table.js) and how Question of the Day uses it.
//   node --test tools/option-table-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../shop-function/functions/option-table.js');
const pool = require('../shop-function/functions/daily-question-pool.js');
const core = require('../shop-function/functions/daily-question-core.js');
const root = new URL('..', import.meta.url);

// The fruit question that started this (Question of the Day, 20 Nov 2026).
const FRUIT = ['Circle: X; triangle: Y; square: Z', 'Circle: Y; triangle: Z; square: X', 'Circle: Z; triangle: X; square: Y', 'Circle: Y; triangle: X; square: Z'];

test('the page copy of option-table.js is the same file as the server copy', () => {
  assert.equal(readFileSync(new URL('option-table.js', root), 'utf8'), readFileSync(new URL('shop-function/functions/option-table.js', root), 'utf8'));
});

test('options written as "Heading: cell; …" rows become a table, headings capitalised', () => {
  const t = T.fromOptions(FRUIT);
  assert.deepEqual(t.head, ['Circle', 'Triangle', 'Square']);
  assert.deepEqual(t.rows, [['X', 'Y', 'Z'], ['Y', 'Z', 'X'], ['Z', 'X', 'Y'], ['Y', 'X', 'Z']]);
  assert.deepEqual(T.shapeIssues(t, 4), []);
  assert.deepEqual(T.matchIssues(t, FRUIT), []);
  // Round trip: the table written back out reads as the same table.
  assert.deepEqual(T.fromOptions(T.toOptions(t)), t);
  // Commas and bars work as separators too, ticks and crosses are cells.
  assert.deepEqual(T.fromOptions(['Roots: ✓, Leaves: ✗', 'Roots: ✗, Leaves: ✓']).rows, [['✓', '✗'], ['✗', '✓']]);
  assert.deepEqual(T.fromOptions(['Beaker A: 20 °C | Beaker B: 30 °C', 'Beaker A: 30 °C | Beaker B: 20 °C']).head, ['Beaker A', 'Beaker B']);
  // A column may be headed A (that is not an option label).
  assert.deepEqual(T.fromOptions(['A: 1; B: 2', 'A: 2; B: 1']).head, ['A', 'B']);
});

test('options that are not a table are left alone', () => {
  for (const options of [
    ['It melts', 'It boils', 'It freezes', 'It condenses'],
    ['2:3', '3:4', '4:5', '5:6'],                                   // ratios, not headings
    ['Mass: 5 g', 'Mass: 6 g', 'Mass: 7 g', 'Mass: 8 g'],           // one heading is a label, not a table
    ['Circle: X; triangle: Y', 'Circle: Y; square: X', 'Circle: Z; triangle: X', 'Circle: X; triangle: Z'],  // headings differ
    ['The plant grows taller: it gets more light; it makes more food', 'b', 'c', 'd'],
    ['Only one']
  ]) assert.equal(T.fromOptions(options), null, JSON.stringify(options));
});

test('half a table is flagged as a table read wrongly', () => {
  assert.match(T.misreadTable(['Circle: X; triangle: Y', 'Circle: Y; triangle: X', 'X and Y', 'Y and X']), /2 of the 4 options/);
  assert.match(T.misreadTable(['Circle: X; triangle: Y', 'Circle: Y; square: X', 'Circle: Z; triangle: X', 'Circle: X; triangle: Z']), /same headings/);
  assert.equal(T.misreadTable(FRUIT), '');
  assert.equal(T.misreadTable(['It melts', 'It boils', 'It freezes', 'It condenses']), '');
});

test('a table that does not hold together fails its shape and match checks', () => {
  const good = T.fromOptions(FRUIT);
  assert.ok(T.shapeIssues({ head: ['Circle', 'Triangle', 'Square'], rows: good.rows.slice(0, 3) }, 4).some(i => /3 rows for 4 options/.test(i)));
  assert.ok(T.shapeIssues({ head: good.head, rows: [['X', 'Y'], ...good.rows.slice(1)] }, 4).some(i => /2 cells for 3 columns/.test(i)));
  assert.ok(T.shapeIssues({ head: good.head, rows: [['X', '', 'Z'], ...good.rows.slice(1)] }, 4).some(i => /empty cell/.test(i)));
  assert.ok(T.shapeIssues({ head: ['Circle', 'circle', 'Square'], rows: good.rows }, 4).some(i => /same heading/.test(i)));
  assert.ok(T.shapeIssues({ head: good.head, rows: [good.rows[0], good.rows[0], good.rows[2], good.rows[3]] }, 4).some(i => /two rows/.test(i)));
  assert.deepEqual(T.shapeIssues('nonsense', 4), ['the options table is not a table']);
  // The right answer must still point at the right row: a swapped row is caught.
  const swapped = { head: good.head, rows: [good.rows[0], good.rows[1], good.rows[3], good.rows[2]] };
  assert.deepEqual(T.matchIssues(swapped, FRUIT), ['option 3 is not row 3 of the options table', 'option 4 is not row 4 of the options table']);
  assert.ok(T.matchIssues({ head: ['Circle', 'Triangle', 'Hexagon'], rows: good.rows }, FRUIT).some(i => /headings/.test(i)));
});

test('the table draws as HTML (page and email) and as plain text, the right row marked', () => {
  const t = T.fromOptions(FRUIT);
  const page = T.html(t, { correct: 3, className: 'x' });
  assert.match(page, /<table class="x"><thead><tr><th scope="col"><span class="ot-sr">Option<\/span><\/th><th scope="col">Circle<\/th>/);
  assert.equal((page.match(/<tr/g) || []).length, 5);
  assert.match(page, /<tr class="ot-right"><th scope="row">D ✓<\/th><td>Y<\/td><td>X<\/td><td>Z<\/td><\/tr>/);
  const mail = T.html(t, { inline: true });
  assert.ok(!/class="ot-right"/.test(mail));
  assert.match(mail, /style="border-collapse:collapse/);
  assert.ok(!T.html({ head: ['<b>'], rows: [['<script>']] }).includes('<script>'));
  assert.deepEqual(T.plainText(t, null, 0), ['     Circle  Triangle  Square', '  A. X       Y         Z   ✓', '  B. Y       Z         X', '  C. Z       X         Y', '  D. Y       X         Z']);
  assert.match(T.promptText(t), /columns Circle \| Triangle \| Square:\n {2}1\) X \| Y \| Z/);
});

/* ───────── Question of the Day ───────── */
const base = {
  kind: 'mcq', subject: 'science', level: 'P5', topic: 'Seed dispersal', images: [{ id: 'x', w: 400, h: 300, alt: 'diagram' }],
  q: 'The table shows the characteristics of fruits X, Y and Z. Which option correctly matches each fruit to its shape in the diagram?',
  answerIndex: 4, model: 'Y is dispersed by water, X by wind and Z by animals.', steps: ['Y floats.', 'X has wings.', 'Z is eaten.'], idea: 'Dispersal fits the fruit.'
};

test('Question of the Day: the reader is told how to write table options and to send the table', () => {
  for (const prompt of [pool.ANSKEY_EXTRACT_SYSTEM, pool.CER_EXTRACT_SYSTEM]) {
    assert.ok(prompt.includes(T.PROMPT_RULE));
    assert.match(prompt, /"optionTable"/);
  }
  assert.match(pool.VERIFY_SYSTEM, /shown as a TABLE/);
  assert.match(pool.TABLE_CHECK_SYSTEM, /printedAsTable/);
});

test('Question of the Day: table options pass; a reader table that disagrees, or half a table, is rejected', () => {
  const ok = pool.cleanItem(Object.assign({}, base, { options: FRUIT.map(o => o.replace(/triangle/g, 'Triangle').replace(/square/g, 'Square')),
    optionTable: { head: ['Circle', 'Triangle', 'Square'], rows: [['X', 'Y', 'Z'], ['Y', 'Z', 'X'], ['Z', 'X', 'Y'], ['Y', 'X', 'Z']] } }));
  assert.deepEqual(pool.optionTableIssues(ok), []);
  assert.deepEqual(pool.qualityIssues(ok, [{ ok: true, w: 400, h: 300, bytes: 1000, clipped: [], blank: false, pageShare: 0.2 }]), []);
  assert.equal(ok.answer, 'Circle: Y; Triangle: X; Square: Z');
  // The reader's table says row 4 is something else: the right answer would point at the wrong row.
  const bad = pool.cleanItem(Object.assign({}, base, { options: FRUIT,
    optionTable: { head: ['Circle', 'Triangle', 'Square'], rows: [['X', 'Y', 'Z'], ['Y', 'Z', 'X'], ['Z', 'X', 'Y'], ['X', 'Y', 'Z']] } }));
  assert.ok(pool.optionTableIssues(bad).some(i => /option 4 is not row 4/.test(i)));
  assert.ok(pool.qualityIssues(bad, []).some(i => /option 4 is not row 4/.test(i)));
  // A reader table that is not a table at all.
  const broken = pool.cleanItem(Object.assign({}, base, { options: FRUIT, optionTable: { head: 'Circle' } }));
  assert.ok(pool.optionTableIssues(broken).length);
  // Half the options as rows, half not.
  const half = pool.cleanItem(Object.assign({}, base, { options: ['Circle: X; triangle: Y', 'Circle: Y; triangle: X', 'X then Y', 'Y then X'] }));
  assert.ok(pool.optionTableIssues(half).some(i => /2 of the 4/.test(i)));
  // Ordinary options: nothing to say.
  const plain = pool.cleanItem(Object.assign({}, base, { options: ['It melts', 'It boils', 'It freezes', 'It condenses'] }));
  assert.deepEqual(pool.optionTableIssues(plain), []);
});

test('Question of the Day: the source check compares the table cell by cell', () => {
  const item = pool.cleanItem(Object.assign({}, base, { options: FRUIT }));
  const read = rows => pool.cleanTableCheck({ found: true, readable: true, printedAsTable: true, head: ['Circle', 'Triangle', 'Square'], rows });
  const rows = [['X', 'Y', 'Z'], ['Y', 'Z', 'X'], ['Z', 'X', 'Y'], ['Y', 'X', 'Z']];
  assert.deepEqual(pool.tableCheckIssues(read(rows), item), []);
  assert.deepEqual(pool.tableCheckIssues(read([rows[0], rows[1], rows[2], ['Y', 'Z', 'Z']]), item), ['row 4 of the options table is not the same as on the source']);
  assert.ok(pool.tableCheckIssues(read(rows.slice(0, 3)), item).some(i => /3 rows/.test(i)));
  assert.ok(pool.tableCheckIssues(pool.cleanTableCheck({ printedAsTable: true, head: ['Circle', 'Triangle', 'Square', 'Star'], rows: rows.map(r => r.concat('W')) }), item).some(i => /4 columns/.test(i)));
  // A table on the page that came out as lines.
  const lines = pool.cleanItem(Object.assign({}, base, { options: ['X, Y, Z', 'Y, Z, X', 'Z, X, Y', 'Y, X, Z'] }));
  assert.deepEqual(pool.tableCheckIssues(read(rows), lines), ['the options are a table on the source, but they did not come out as a table']);
  // Lines on the page that were made into a table (leave non-tables alone).
  assert.deepEqual(pool.tableCheckIssues(pool.cleanTableCheck({ printedAsTable: false, options: FRUIT }), item), ['the options were made into a table, but they are not a table on the source']);
  // Lines on the page, lines here: fine.
  assert.deepEqual(pool.tableCheckIssues(pool.cleanTableCheck({ printedAsTable: false, options: ['a', 'b', 'c', 'd'] }), lines), []);
  assert.ok(pool.tableCheckIssues(pool.cleanTableCheck({ readable: false }), item).length);
  assert.ok(pool.tableCheckIssues(pool.cleanTableCheck({ found: false }), item).length);
  assert.match(pool.tableCheckPrompt(item, { number: '12', where: 'Image 1 is the page.' }), /number 12[\s\S]*4 options/);
});

test('Question of the Day: the checker sees the options as the table a parent sees', () => {
  const item = pool.cleanItem(Object.assign({}, base, { options: FRUIT }));
  const prompt = pool.verifyPrompt(item);
  assert.match(prompt, /The options are a table with the columns Circle \| Triangle \| Square/);
  assert.match(prompt, /4\) Y \| X \| Z/);
});

test('Question of the Day email: table options are a table, the right row green the next day', () => {
  const q = { kind: 'mcq', subject: 'science', subjectLabel: 'Science', level: 'P5', topic: 'Seed dispersal', q: base.q, images: [], options: FRUIT,
    answer: 3, answerLetter: 'D', steps: ['Y floats.'], idea: 'Dispersal.', model: '' };
  const today = core.questionCardHtml(q, {});
  assert.match(today, /<th scope="col" style="[^"]*">Circle<\/th>/);
  assert.ok(!today.includes('✓'));
  const next = core.questionCardHtml(q, { reveal: true });
  assert.match(next, /D ✓<\/th><td style="[^"]*font-weight:700">Y<\/td>/);
  assert.match(next, /Answer: D\. the green row in the table above/);
  const text = core.questionText(q, { reveal: true });
  assert.match(text, / {5}Circle {2}Triangle {2}Square\n {2}A\. X {7}Y {9}Z/);
  assert.match(text, /D\. Y {7}X {9}Z {3}✓/);
  // Ordinary options are unchanged.
  const plain = core.questionCardHtml(Object.assign({}, q, { options: ['It melts', 'It boils', 'It freezes', 'It condenses'] }), {});
  assert.match(plain, /It melts/);
  assert.ok(!/<th scope="col"/.test(plain));
});

test('the pages load option-table.js before the scripts that draw the options', () => {
  const qpage = readFileSync(new URL('question/index.html', root), 'utf8');
  assert.ok(qpage.indexOf('../option-table.js') > 0 && qpage.indexOf('../option-table.js') < qpage.indexOf('question-app.js'));
  const home = readFileSync(new URL('index.html', root), 'utf8');
  assert.ok(home.indexOf('<script src="option-table.js" defer>') > 0 && home.indexOf('<script src="option-table.js" defer>') < home.indexOf('<script src="question-of-the-day.js" defer>'));
  for (const f of ['question/question-app.js', 'question-of-the-day.js']) assert.match(readFileSync(new URL(f, root), 'utf8'), /PolymathOptionTable/);
});
