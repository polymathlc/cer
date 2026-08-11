// Regression tests for the 🎯 LEARNING-OBJECTIVE TAGS on a question. Run with:
//     node tools/objective-tag-tests.mjs            all cases
//     node tools/objective-tag-tests.mjs <name>     one case
//
// It loads the REAL `qLos` / `_loOrderIds` / `loQuestions` out of app.js.
//
// Filing a question under an objective is a teacher's work, and every way it
// can go wrong here is SILENT: a tag dropped because the objective list had not
// loaded yet, a tag lost because the list no longer knows that id, or a
// question that is filed and then simply does not appear under its objective.
// Nothing throws in any of those cases — the filing is just gone — so it is
// pinned here.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const slice = (from, to, what) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(what + ' not found in app.js — did the banner comment change?');
  return src.slice(a, b);
};

// The read side (qLos / _loOrderIds) and the objective page's own reader.
const readers = slice('function qLos(q) {', 'function loEditorSet(ids)', 'the qLos block');
const loQuestions = slice('function loQuestions(id) {', '\nfunction loThemeColor', 'loQuestions');

const M = new Function(`
  let _loLoaded = false;
  let loData = { objectives: [], map: {} };
  let questionBank = [];
  function loList() { return (loData && Array.isArray(loData.objectives)) ? loData.objectives : []; }
  function loFind(id) { return loList().find(o => o && o.id === id); }
  function loQIds(id) { const a = (loData && loData.map) ? loData.map[id] : null; return Array.isArray(a) ? a : []; }
  ${readers}
  ${loQuestions}
  return {
    qLos, _loOrderIds, loQuestions,
    setUp(objectives, map, bank, loaded) {
      loData = { objectives, map: map || {} };
      questionBank = bank || [];
      _loLoaded = !!loaded;
    }
  };
`)();

const OBJ = [
  { id: 'div-living', title: 'Characteristics of living things', level: 'P3' },
  { id: 'heat-flow', title: 'Heat flows from hotter to colder', level: 'P4' },
  { id: 'lc-plants', title: 'Life cycles of plants', level: 'P3' },
];

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};
const ok = (cond, what) => { if (!cond) throw new Error(what); };

// ---- reading a question's tags ---------------------------------------------
test('nothing is dropped before the objective list has loaded', () => {
  // This is the one that costs a teacher their work: the list is a document, so
  // a question opened in the editor before it arrives must come back with every
  // objective it walked in with — not stripped bare and saved that way.
  M.setUp([], {}, [], false);
  eq(M.qLos({ los: ['div-living', 'heat-flow'] }), ['div-living', 'heat-flow'], 'unloaded');
});

test('an objective the admin has deleted is dropped once the list IS loaded', () => {
  M.setUp(OBJ, {}, [], true);
  eq(M.qLos({ los: ['div-living', 'gone-away', 'heat-flow'] }), ['div-living', 'heat-flow'], 'loaded');
});

test('duplicates and rubbish entries are ignored', () => {
  M.setUp(OBJ, {}, [], true);
  eq(M.qLos({ los: ['div-living', 'div-living', '', null, undefined, 'heat-flow'] }),
     ['div-living', 'heat-flow'], 'deduped');
});

test('a question with no tags at all never throws', () => {
  M.setUp(OBJ, {}, [], true);
  eq(M.qLos(null), [], 'null');
  eq(M.qLos({}), [], 'no field');
  eq(M.qLos({ los: 'div-living' }), [], 'not an array');
});

// ---- the order tags are stored in ------------------------------------------
test('tags are stored in objective-list order, not tick order', () => {
  M.setUp(OBJ, {}, [], true);
  eq(M._loOrderIds(['lc-plants', 'div-living']), ['div-living', 'lc-plants'], 'reordered');
});

test('an id the list does not know keeps its place instead of being thrown away', () => {
  // Same failure as above from the write side: with the list still loading,
  // loList() is empty and a naive filter would save an EMPTY array over the
  // teacher's filing.
  M.setUp([], {}, [], false);
  eq(M._loOrderIds(['heat-flow', 'div-living']), ['heat-flow', 'div-living'], 'nothing lost');
  M.setUp(OBJ, {}, [], true);
  eq(M._loOrderIds(['gone-away', 'div-living']), ['div-living', 'gone-away'], 'unknown id kept');
});

// ---- both ends of the system ------------------------------------------------
test('an objective shows questions attached to it AND questions tagged with it', () => {
  const bank = [
    { id: 'q1', title: 'attached only' },
    { id: 'q2', title: 'tagged only', los: ['div-living'] },
    { id: 'q3', title: 'neither', los: ['heat-flow'] },
  ];
  M.setUp(OBJ, { 'div-living': ['q1'] }, bank, true);
  eq(M.loQuestions('div-living').map(q => q.id), ['q1', 'q2'], 'both ends');
  eq(M.loQuestions('heat-flow').map(q => q.id), ['q3'], 'tag end alone');
  eq(M.loQuestions('lc-plants').map(q => q.id), [], 'empty objective');
});

test('a question filed from BOTH ends is listed once', () => {
  const bank = [{ id: 'q1', title: 'filed twice', los: ['div-living'] }];
  M.setUp(OBJ, { 'div-living': ['q1'] }, bank, true);
  eq(M.loQuestions('div-living').map(q => q.id), ['q1'], 'deduped');
});

test('an attached question deleted from the bank simply stops appearing', () => {
  M.setUp(OBJ, { 'div-living': ['q1', 'gone'] }, [{ id: 'q1', title: 'still here' }], true);
  eq(M.loQuestions('div-living').map(q => q.id), ['q1'], 'missing id skipped');
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
