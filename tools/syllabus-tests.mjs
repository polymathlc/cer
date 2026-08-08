// Regression tests for the RETIRED-TOPIC rule. Run with:
//     node tools/syllabus-tests.mjs            all cases
//     node tools/syllabus-tests.mjs <name>     one case
//
// It loads the REAL `qRetiredTopic` / `qInSyllabus` out of app.js.
//
// This rule is a promise about what a child is shown, and it fails SILENTLY in
// both directions: too loose and a retired question is served in practice or in
// a game, too tight and a live topic vanishes from the whole app with no error
// anywhere. Neither shows up as a crash, so it is pinned here.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const a = src.indexOf('// ---- Retired topics ---');
const b = src.indexOf('function getQuestionsForLevel', a);
if (a < 0 || b < 0) throw new Error('retired-topic section not found in app.js — did the banner comment change?');
const section = 'function qSecondaryTopic(q) { return (q && typeof q.topic2 === \'string\') ? q.topic2.trim() : \'\'; }\n'
  + src.slice(a, b);

const M = new Function(section + '\nreturn { QRETIRED_TOPIC_RE, qRetiredTopic, qInSyllabus };')();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};
const ok = (cond, what) => { if (!cond) throw new Error(what); };

// ---- what the rule catches -------------------------------------------------
test('every spelling of the retired topic is caught', () => {
  ['Cell Systems', 'Cell System', 'cell systems', 'CELL SYSTEMS', 'cellsystem', 'Cell  Systems',
   'P5 Cell Systems', 'Cell Systems (retired)'].forEach(topic => {
    ok(M.qRetiredTopic({ topic }), 'must be retired: ' + topic);
    eq(M.qInSyllabus({ topic }), false, 'must not be served: ' + topic);
  });
});

test('it reads the SECOND topic field too', () => {
  ok(M.qRetiredTopic({ topic: 'Human Body Systems', topic2: 'Cell Systems' }), 'secondary topic');
  eq(M.qInSyllabus({ topic: 'Human Body Systems', topic2: 'Cell Systems' }), false, 'and is not served');
});

// ---- what it must NOT catch ------------------------------------------------
// Too tight is just as bad as too loose, and far harder to notice: a live topic
// would disappear from every practice mode, every game and every worksheet with
// no error message anywhere. Every real topic in topicsByLevel is checked.
test('no live topic is swept up with it', () => {
  const live = [
    'Living and non-living things', 'Materials', 'Life Cycles', 'Magnets',
    'Plant Systems', 'Human Body Systems', 'Matter and its 3 States', 'Light', 'Heat',
    'Water and its 3 States', 'Plant Reproduction', 'Human Reproduction',
    'Human and Plant Respiration', 'Human and Plant Transport', 'Electrical Systems',
    'Forces', 'Energy in Food', 'Energy Conversion', 'Living Together',
    'Food Chains and Webs', 'Humans and the Environment'
  ];
  live.forEach(topic => {
    ok(!M.qRetiredTopic({ topic }), 'must stay live: ' + topic);
    eq(M.qInSyllabus({ topic }), true, 'must still be served: ' + topic);
  });
});

test('a topic that merely mentions cells is not the retired one', () => {
  // "the cell is the basic unit of life" is P5 Reproduction and very much in
  // the syllabus — the rule is about the retired TOPIC, not about the word.
  ['Cycles in Plants and Animals (Reproduction)', 'Plant cells and animal cells',
   'The cell', 'Cells', 'Electrical Systems', 'Cell membrane'].forEach(topic => {
    ok(!M.qRetiredTopic({ topic }), 'must stay live: ' + topic);
  });
});

// ---- the per-question flag still works -------------------------------------
test('the hand-ticked flag is independent of the topic rule', () => {
  eq(M.qInSyllabus({ topic: 'Forces', notInSyllabus: true }), false, 'flag alone excludes');
  eq(M.qInSyllabus({ topic: 'Forces', notInSyllabus: false }), true, 'unticked is served');
  ok(!M.qRetiredTopic({ topic: 'Forces', notInSyllabus: true }), 'the flag is not a topic rule');
});

// ---- nothing throws on rubbish input ---------------------------------------
test('a malformed question never throws', () => {
  eq(M.qInSyllabus(null), true, 'null');
  eq(M.qInSyllabus(undefined), true, 'undefined');
  eq(M.qInSyllabus({}), true, 'no topic at all');
  eq(M.qRetiredTopic(null), false, 'null is not retired');
  eq(M.qInSyllabus({ topic: null, topic2: 123 }), true, 'wrong types');
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
