// 🔑 ⚡ Rapid add: the paper's own answer key (v1.462.0). Loads the REAL
// helpers out of app.js — the rapid key's pure parts and the Exam Paper
// builder's number / part / slotting machinery they reuse — and checks that a
// question read off a page gets the MARKING SCHEME's answer, matched by number
// and part by part, and that a question the key does not answer keeps the AI's
// answer and says so.
//   node tools/rapid-answer-key-tests.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b) + '\n';
};
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); } };

const sandbox = { console, JSON, Math, String, Array, Object, Set, Map, RegExp, Number, Promise, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(`
var _epAnswers = [];
var _epPaperName = 'SOME OTHER PAPER';
var SCAN_READING_NOTE = '';
let _bid = 0; function generateBlockId() { return 'b' + (++_bid); }
function stripHtml(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, ' '); }
function escapeHtml(s) { return String(s == null ? '' : s); }
var document = { getElementById: () => null, querySelector: () => null };
` + cut('function _markedToBlanks(marked) {', '\n}\n', 'marked → blanks') + '}\n'
  + cut('const QPART_LETTERS', 'function qPartsUsed', 'part core')
  + cut('function qPartsUsed', 'function qPartOf(map, block)', 'part spans')
  + cut('function qPartOf(map, block)', '\n// The next unused letter', 'partOf + opens + hasParts')
  + cut('function _epNumKey(v) {', '\n// ---- Adding screenshots', 'number key')
  + cut('function _epKeyPrompt(i, total, opts) {', '\n// ---- Dropping the question number', 'key prompt')
  + cut('function _epNumParts(num) {', '\nfunction _epSlot(', 'matching + slotting')
  // let, not const, so the bounded wait below can be tested in milliseconds.
  + cut("// 🔑 THE PAPER'S OWN ANSWER KEY (v1.462.0)", '\nfunction _rapidKeyIsFile(', 'rapid key pure parts').replace('const RAPID_KEY_WAIT_MS', 'let RAPID_KEY_WAIT_MS')
  + cut('async function _rapidKeyAwait(key) {', '\nfunction rapidKeyClear(', 'bounded wait'), sandbox);
const run = code => vm.runInContext(code, sandbox);
const clone = x => JSON.parse(JSON.stringify(x));

const mcq = () => ({ id: 'q1', title: 'Magnets', blocks: [
  { id: 't1', type: 'text', content: 'Which material is attracted to a magnet?' },
  { id: 'm1', type: 'mcq', options: [{ id: 'o1', text: 'wood' }, { id: 'o2', text: 'iron' }, { id: 'o3', text: 'glass' }, { id: 'o4', text: 'plastic' }], correctId: 'o1' },
  { id: 'e1', type: 'explanation', content: 'AI: wood.' },
] });
const parts = () => ({ id: 'q2', title: 'Plants', blocks: [
  { id: 't0', type: 'text', content: 'The set-up below was left in the sun.' },
  { id: 't1', type: 'text', part: 'a', content: 'Name the process.' },
  { id: 'a1', type: 'plainanswer', content: 'AI answer a' },
  { id: 't2', type: 'text', part: 'b', content: 'Explain the result.' },
  { id: 'a2', type: 'plainanswer', content: 'AI answer b' },
] });
const open = () => ({ id: 'q3', title: 'Heat', blocks: [
  { id: 't1', type: 'text', content: 'Why does the metal spoon feel cold?' },
  { id: 'a1', type: 'plainanswer', content: 'AI answer' },
] });

console.log('\nthe printed number, read before the numbering is stripped');
ok('the reader\'s own "number" field wins', run(`_rapidKeyNumberOf({ number: ' 44(a) ' }, null)`) === '44(a)');
ok('falls back to a "12." opening the wording', run(`_rapidKeyNumberOf({}, { blocks: [{ type: 'text', content: '<p>12. Which material…</p>' }] })`) === '12');
ok('"Q7)" counts too', run(`_rapidKeyNumberOf({}, { blocks: [{ type: 'text', content: 'Q7) Which…' }] })`) === '7');
ok('"2.5 kg of ice" is not question 2', run(`_rapidKeyNumberOf({}, { blocks: [{ type: 'text', content: '2.5 kg of ice was heated' }] })`) === '');
ok('no number anywhere → empty', run(`_rapidKeyNumberOf({}, { blocks: [{ type: 'text', content: 'Which material…' }] })`) === '');

console.log('\nreading the key replies');
const rows = run(`(() => { const st = { base: '' };
  const a = _rapidKeyRowsFrom({ answers: [{ number: '12', option: '2' }, { number: '44', answer: '' }, { number: '(a)', answer: 'photosynthesis' }] }, st);
  const b = _rapidKeyRowsFrom([{ number: 'b', answer: 'more starch', explanation: 'light' }, { number: '' , answer: 'x' }], st);
  return { a, b, st }; })()`);
ok('a bare "(a)" line takes the number printed above it', rows.a[2].number === '44(a)', JSON.stringify(rows.a));
ok('…across replies (pages) too', rows.b[0].number === '44(b)', JSON.stringify(rows.b));
ok('a row with no number is dropped', rows.b.length === 1);
ok('a bare part with no number before it links to nothing', run(`_rapidKeyRowsFrom({ answers: [{ number: '(a)', answer: 'x' }] }, { base: '' }).length`) === 0);
ok('a later reading of the same number wins', run(`_rapidKeyMerge([[{ number: 'Q12', option: '1' }], [{ number: '12', option: '2' }]])`).length === 1
  && run(`_rapidKeyMerge([[{ number: 'Q12', option: '1' }], [{ number: '12', option: '2' }]])[0].option`) === '2');

console.log('\nmatching by number and part');
const KEY = [
  { number: '12', option: '2', answer: '', claim: '', evidence: '', reasoning: '', explanation: 'Iron is a magnetic material.' },
  { number: '44(a)', option: '', answer: 'Photosynthesis', claim: '', evidence: '', reasoning: '', explanation: '' },
  { number: '44(b)(i)', option: '', answer: 'More starch', claim: '', evidence: '', reasoning: '', explanation: '' },
  { number: '44(b)(ii)', option: '', answer: 'More light', claim: '', evidence: '', reasoning: '', explanation: '' },
  { number: '7', option: '', answer: 'Metal is a good conductor of heat.', claim: '', evidence: '', reasoning: '', explanation: '' },
];
sandbox.KEY = KEY;
ok('"Q12" finds 12', !!run(`_rapidKeyMatch(KEY, 'Q12', []).whole`));
ok('44 + part a finds 44(a)', run(`_rapidKeyMatch(KEY, '44', ['a']).by.a.answer`) === 'Photosynthesis');
ok('44 + part b folds the roman sub-parts', /\(i\) More starch[\s\S]*\(ii\) More light/.test(run(`_rapidKeyMatch(KEY, '44', ['b']).by.b.answer`)));
ok('no number → nothing', run(`_rapidKeyMatch(KEY, '', ['a'])`).whole === null);
ok('4 does not match 44(a)', Object.keys(run(`_rapidKeyMatch(KEY, '4', ['a']).by`)).length === 0);

console.log('\napplying the key');
sandbox.Q = mcq();
ok('MCQ: one line applied', run(`_rapidKeyApply(Q, KEY, '12')`) === 1);
ok('MCQ: the key\'s option is now correct', sandbox.Q.blocks[1].correctId === 'o2');
ok('MCQ: the key\'s explanation beats the AI\'s', sandbox.Q.blocks[2].content === 'Iron is a magnetic material.');
ok('MCQ: marked from the marking scheme', sandbox.Q.answerSource === 'key');
ok('no exam-builder bookkeeping left on the question', !('_epAns' in sandbox.Q) && !('_epAnsBy' in sandbox.Q));

sandbox.Q = parts();
ok('parts: both parts applied', run(`_rapidKeyApply(Q, KEY, '44')`) === 2);
const pa = sandbox.Q.blocks.filter(b => b.type === 'plainanswer').map(b => b.content);
ok('parts: each answer lands in its own part', pa.length === 2 && pa[0] === 'Photosynthesis' && /More starch/.test(pa[1]), JSON.stringify(pa));

sandbox.Q = open();
ok('open: answer replaced', run(`_rapidKeyApply(Q, KEY, '7')`) === 1 && sandbox.Q.blocks.find(b => b.type === 'plainanswer').content === 'Metal is a good conductor of heat.');

sandbox.Q = open();
const before = clone(sandbox.Q.blocks);
ok('no line on the key: nothing applied', run(`_rapidKeyApply(Q, KEY, '99')`) === 0);
ok('…the AI answer is kept', JSON.stringify(sandbox.Q.blocks) === JSON.stringify(before));
ok('…and it says so', sandbox.Q.answerSource === 'ai');
sandbox.Q = open();
ok('no number at all: the AI answer is kept', run(`_rapidKeyApply(Q, KEY, '')`) === 0 && sandbox.Q.answerSource === 'ai');

console.log('\nthe batch toast');
ok('counts both', run(`_rapidKeyBatchNote([{ answerSource: 'key' }, { answerSource: 'key' }, { answerSource: 'ai' }])`) === ' · 🔑 2 answers from the marking scheme, 1 written by the AI');
ok('all from the key', run(`_rapidKeyBatchNote([{ answerSource: 'key' }])`) === ' · 🔑 1 answer from the marking scheme');
ok('no key in the batch → no note', run(`_rapidKeyBatchNote([{}, {}])`) === '');

console.log('\nthe key prompt is the exam builder\'s');
const p3 = run(`_epKeyPrompt(4, 9, { count: 3, paperName: '' })`);
ok('several pages in one call', /The 3 attached images are pages 4 to 6 of 9/.test(p3));
ok('Rapid add never borrows the exam builder\'s paper name', !/SOME OTHER PAPER/.test(p3));
ok('the exam builder keeps its own wording', /^The attached image is screenshot 2 of 5[\s\S]*SOME OTHER PAPER/.test(run(`_epKeyPrompt(2, 5)`)));
ok('the parts rule is still in it', /REPEATS the question number/.test(p3));

console.log('\nthe bounded wait');
run(`RAPID_KEY_WAIT_MS = 30;`);
const waits = await run(`(async () => {
  const ready = await _rapidKeyAwait({ tail: Promise.resolve(), rows: [{ number: '1' }] });
  const stuck = await _rapidKeyAwait({ tail: new Promise(() => {}), rows: [] });
  const gone = await _rapidKeyAwait({ tail: Promise.resolve(), rows: [{ number: '1' }], cleared: true });
  const none = await _rapidKeyAwait(null);
  return { ready: ready.length, stuck: stuck.length, gone, none };
})()`);
ok('a read key hands back its rows', waits.ready === 1);
ok('a key that never finishes does not block the job', waits.stuck === 0);
ok('a cleared key is dropped by a waiting job', waits.gone === null);
ok('no key → null', waits.none === null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
