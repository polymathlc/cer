// Regression tests for 🔤 MCQ LABELS — (1)(2)(3)(4) or (A)(B)(C)(D).
// Run with:  node tools/mcq-labels-tests.mjs
//
// Secondary 1 science letters its options; the primary papers number them.
// Every failure here is silent and lands on a sheet or in front of a child:
//   · the wrong style resolved — a Sec 1 paper printed (1)…(4), or a primary
//     paper suddenly lettered;
//   · ONE surface left on numbers — the sheet says "B", the key says "2.";
//   · the canonical choice moved — a child picks (B) and is marked against "2"
//     as a STRING, and every answer comes back wrong.
import fs from 'fs';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

const M = new Function(`
  const LEVEL_ORDER = { P3: 3, P4: 4, P5: 5, P6: 6, S1: 7 };
  const LEVEL_CODE_RE = /^(P[3-6]|S1)$/;
  function isLevelCode(v) { return LEVEL_CODE_RE.test(String(v || '')); }
  function getLevelNumber(v) { return LEVEL_ORDER[v] || 0; }
  const customTopics = { 'My Sec Topic': 'S1' };
  const topicLevelMap = { 'Heat': 'P5', 'Matter': 'P3', 'Physical Quantities': 'S1', 'Light': 'P5' };
  function getTopicLevel(t) { return customTopics[t] || topicLevelMap[t] || 'P6'; }
  function isSecondaryLevel(v) { return getLevelNumber(v) >= LEVEL_ORDER.S1 && isLevelCode(v); }
  ${cut('function _normMcqChoice(raw) {', '\nfunction normalizeCategoryValue', 'mcq labels')}
  ${cut('function _mcqLab(o)', '/* "2) A is smaller"', 'display label helpers')}
  return { mcqLabelStyle, mcqLabelOverride, mcqLabelOf, mcqLabelForNum, mcqOptionText, _mcqLab, _mcqLabOf, _normMcqChoice };
`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (c, what) => { if (!c) throw new Error(what); };
const eq = (a, b, what) => ok(a === b, what + ' (got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b) + ')');

test('AUTO letters a Secondary topic and numbers a primary one', () => {
  eq(M.mcqLabelStyle({ topic: 'Physical Quantities' }), 'letters', 'an S1 topic');
  eq(M.mcqLabelStyle({ topic: 'My Sec Topic' }), 'letters', 'a custom topic filed at S1');
  eq(M.mcqLabelStyle({ topic: 'Heat' }), 'numbers', 'a P5 topic');
  eq(M.mcqLabelStyle({ topic: 'Heat', topic2: 'Physical Quantities' }), 'letters', 'an S1 SECOND topic makes it a Sec 1 question');
  eq(M.mcqLabelStyle(null), 'numbers', 'no question at all');
  eq(M.mcqLabelStyle({}), 'numbers', 'a question with no topic');
});

test('the question\'s own choice beats the level, both ways', () => {
  eq(M.mcqLabelStyle({ topic: 'Heat', mcqLabels: 'letters' }), 'letters', 'a primary question set to letters');
  eq(M.mcqLabelStyle({ topic: 'Physical Quantities', mcqLabels: 'numbers' }), 'numbers', 'a Sec 1 question set to numbers');
  eq(M.mcqLabelStyle({ topic: 'Physical Quantities', mcqLabels: 'roman' }), 'letters', 'a value that is not a style is AUTO');
  eq(M.mcqLabelOverride({ mcqLabels: 'auto' }), '', 'auto is not stored as an override');
});

test('labels: A–Z for letters, a number past Z, numbers otherwise', () => {
  eq(['letters', 'numbers'].map(s => [0, 1, 2, 3].map(i => M.mcqLabelOf(i, s)).join('')).join('|'), 'ABCD|1234', 'labels');
  eq(M.mcqLabelOf(26, 'letters'), '27', 'a 27th option has no letter');
  eq(M.mcqLabelForNum('2', 'letters'), 'B', 'the canonical number 2 is drawn as B');
  eq(M.mcqLabelForNum('2', 'numbers'), '2', 'and as 2 on a primary question');
});

test('a bare marker naming THIS option is drawn as the question\'s own label', () => {
  eq(M.mcqOptionText('(3)', 2, 'letters'), '(C)', '"(3)" on the third option of a Sec 1 question');
  eq(M.mcqOptionText('(C)', 2, 'numbers'), '(3)', '"(C)" on a primary question');
  eq(M.mcqOptionText('<p>(2)</p>', 1, 'letters'), '(B)', 'a marker wrapped in markup');
  eq(M.mcqOptionText('(1)', 0, 'numbers'), '(1)', 'a primary picture option is unchanged');
});

test('real wording, and a marker naming ANOTHER option, are never rewritten', () => {
  eq(M.mcqOptionText('A and B only', 0, 'letters'), 'A and B only', 'wording that happens to start with A');
  eq(M.mcqOptionText('(2)', 0, 'letters'), '(2)', 'a "(2)" written on the FIRST option is the author\'s, not a label');
  eq(M.mcqOptionText('2 cm', 1, 'letters'), '2 cm', 'a measurement');
  eq(M.mcqOptionText('', 0, 'letters'), '', 'an empty option');
});

test('the canonical choice is still the NUMBER — only the drawing changes', () => {
  const opts = [{ letter: '1', label: 'A' }, { letter: '2', label: 'B' }, { letter: '3', label: 'C' }];
  eq(M._mcqLab(opts[1]), 'B', 'drawn label');
  eq(M._mcqLabOf(opts, '3'), 'C', 'a chosen number is drawn as its letter');
  eq(M._mcqLabOf(opts, ''), '', 'nothing chosen draws nothing');
  eq(M._mcqLabOf([{ letter: '2' }], '2'), '2', 'a store with no label still reads');
  eq(M._normMcqChoice('B'), '2', 'the AI answering "B" is still option 2');
});

// ---- the census: every surface draws through the helpers ------------------
test('every renderer that draws options passes the QUESTION', () => {
  const calls = src.match(/renderImportedBlockStudent\([^)]*\)/g) || [];
  const bare = calls.filter(c => !/renderImportedBlockStudent\(block, q\)|renderImportedBlockStudent\(block, q\)/.test(c) && !/function renderImportedBlockStudent/.test(c));
  ok(calls.length >= 8, 'fewer render calls than expected (' + calls.length + ')');
  ok(!bare.length, 'a render call without the question, so it can only ever number: ' + bare.join(' | '));
  const keys = (src.match(/_pushBlockAnswerKey\(qSections, block, bPart, qWhy[^)]*\)/g) || []);
  ok(keys.length === 4 && keys.every(c => /, q\)$/.test(c)), 'a print path pushes the MCQ answer without the question: ' + keys.join(' | '));
  ok(/_printMcqBlockHtml\(block, bPart, q\)/.test(src), 'the printed MCQ does not know its question');
});

test('the drawn labels go through the helpers, not `i + 1`', () => {
  const student = cut('function renderImportedBlockStudent(block, q) {', "    case 'answerLine':", 'student render');
  ok(/mcqLabelOf\(i, lab\)/.test(student) && /mcqOptionText\(/.test(student), 'the student render still numbers');
  const key = cut('function _pushBlockAnswerKey(', "    case 'answerLine':", 'key pusher');
  ok(/mcqLabelOf\(ci, lab\)/.test(key), 'the answer key still numbers');
  const store = cut("        mcqItems.push({", '        break;', 'marking store');
  ok(/letter: String\(idx \+ 1\)/.test(store), 'the canonical number moved off `letter`');
  ok(/label: mcqLabelOf\(idx, mcqLabelStyle\(q\)\)/.test(store), 'the marking store has no label to draw');
  ok(!/you chose \$\{escapeHtml\(chosenLetter\)\}/.test(src), 'feedback still says "you chose 2" on a lettered question');
  ok(!/Correct answer:<\/strong> \$\{escapeHtml\(correctOpt\.letter\)\}/.test(src), 'feedback still names the correct option by number');
});

test('the editor stores only an explicit choice, owns it, and relabels on a topic change', () => {
  ok(/\.\.\.\(editorMcqLabels \? \{ mcqLabels: editorMcqLabels \} : \{\}\)/.test(src), 'AUTO is written as a value');
  ok(/'mcqLabels',/.test(cut('const EDITOR_OWNED_QUESTION_FIELDS', ']);', 'owned fields')), 'setting it back to Auto would be undone by the carry-over');
  ok(/editorMcqLabels = mcqLabelOverride\(q\);/.test(src), 'opening a question does not load its choice');
  ok((src.match(/editorMcqLabels = '';/g) || []).length >= 2, 'a cleared editor keeps the last question\'s choice');
  ok(/_mcqLabelsRefresh\(\);\n\}\);/.test(src) && /topicSelect2'\)\?\.addEventListener\('change', \(\) => _mcqLabelsRefresh\(\)\)/.test(src),
    'choosing a Sec 1 topic does not relabel the options on screen');
  const ed = cut("      const emOwner = (typeof emOwnerQuestion === 'function') ? emOwnerQuestion(id) : null;", "    case 'answerLine':", 'editor block');
  ok(/emOwner \? mcqLabelStyle\(emOwner\) : editorMcqLabelStyle\(\)/.test(ed), 'editing mode reads the create page\'s topic instead of the question\'s own');
});

const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name.indexOf(only) < 0) continue;
  try { c.fn(); pass++; console.log('  ok   ' + c.name); }
  catch (e) { fail++; console.log('  FAIL ' + c.name + '\n       ' + e.message); }
}
console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
