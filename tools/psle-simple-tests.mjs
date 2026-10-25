// 🎓 Science PSLE — the simple view (v1.450.0). Cuts the SHIPPED block out of
// app.js (between "🎓 SCIENCE PSLE — THE SIMPLE VIEW" and "End Science PSLE
// simple view") and runs it against a small fake of the past-paper data and
// the page, so what is tested is what students get. Run:
//
//   node --test tools/psle-simple-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const START = APP.indexOf('// 🎓 SCIENCE PSLE — THE SIMPLE VIEW');
const END = APP.indexOf('// End Science PSLE simple view');
assert.ok(START > 0 && END > START, 'the simple view block is in app.js');
const BLOCK = APP.slice(APP.lastIndexOf('\n', START), END);

// Values made inside the vm carry its realm's prototypes; compare them as plain data.
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);

// ───────── a small fake world ─────────

// The REAL topic → level map and level colours, cut out of app.js, so the
// grouping is tested against the levels students actually see (v1.450.2).
const evalLiteral = (from) => {
  const start = APP.indexOf(from);
  assert.ok(start > 0, 'app.js still has ' + from);
  const open = APP.indexOf('{', start);
  const end = APP.indexOf('\n};', open);
  return vm.runInNewContext('(' + APP.slice(open, end + 2) + ')');
};
const TOPIC_LEVEL_MAP = evalLiteral('const topicLevelMap = {');
const LEVEL_COLORS = evalLiteral('const levelColors = {');
const TOPIC_LEVELS = ['P3', 'P4', 'P5', 'P6', 'S1'];
assert.ok(APP.includes("const TOPIC_LEVELS = ['P3', 'P4', 'P5', 'P6', 'S1'];"), 'the fake ladder is the app\'s own');

const PP_THEME = { 'Heat': 'energy', 'Light': 'energy', 'Magnets': 'interactions', 'Plant Systems': 'systems', 'Living and non-living things': 'diversity' };
const PP_THEME_C = { diversity: '#2d6ca8', cycles: '#0f7a5a', systems: '#a8762c', interactions: '#6b4fa0', energy: '#b55a2b' };
const PP_THEME_NAME = { diversity: 'Diversity', cycles: 'Cycles', systems: 'Systems', interactions: 'Interactions', energy: 'Energy' };

function paperRows() {
  return [
    { id: 's_2023_1', year: '2023', n: 1, marks: 2, topic: 'Heat' },
    { id: 's_2023_2', year: '2023', n: 2, marks: 2, topic: 'Magnets' },
    { id: 's_2023_30', year: '2023', n: 30, marks: 4, topic: 'Heat' },
    { id: 's_2024_2', year: '2024', n: 2, marks: 2, topic: 'Plant Systems' },
    { id: 's_2024_1', year: '2024', n: 1, marks: 2, topic: 'Heat' },
    { id: 's_2024_3', year: '2024', n: 3, marks: 2, topic: 'Living and non-living things' },
    { id: 's_2024_39', year: '2024', n: 39, marks: 2, topic: '' },           // unlabelled: no topic button
    { id: 's_2022_1', year: '2022', n: 1, marks: 2, topic: 'Light' }          // nothing attached yet
  ];
}
function bankFor() {
  return {
    s_2023_1: { id: 'b_heat_23_1', title: 'Heat 23/1' },
    s_2023_2: { id: 'b_mag_23_2', title: 'Magnets 23/2' },
    s_2023_30: { id: 'b_heat_23_30', title: 'Heat 23/30' },
    s_2024_1: { id: 'b_heat_24_1', title: 'Heat 24/1' },
    s_2024_2: { id: 'b_plant_24_2', title: 'Plant 24/2' },
    s_2024_3: { id: 'b_cell_24_3', title: 'Cell 24/3' },
    s_2024_39: { id: 'b_tape_24_39', title: 'Tape 24/39' }
  };
}

function fakeElement(id) {
  return {
    id, innerHTML: '', textContent: '', hidden: false, disabled: false, checked: true,
    style: {}, dataset: {},
    classList: {
      set: new Set(),
      add(name) { this.set.add(name); }, remove(name) { this.set.delete(name); }, contains(name) { return this.set.has(name); }
    },
    focus() {}
  };
}

function makeWorld(options = {}) {
  const rows = options.rows || paperRows();
  const bank = options.bank || bankFor();
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, fakeElement(id)); return elements.get(id); };
  const actionButtons = ['practice', 'tutor', 'pdf'].map(action => Object.assign(fakeElement('action-' + action), { dataset: { action } }));
  const calls = { toasts: [], practiceYear: [], practise: [], print: [], tsendOpen: [], tsendSend: 0, embed: [], queries: [] };
  const context = {
    console, Set, Map, Promise, setTimeout: fn => fn(), Object, Array, String, Number,
    document: {
      getElementById: element,
      querySelector: selector => selector.includes('.psle-action-title') ? element('tutor-title') : selector.includes('.psle-action') ? actionButtons[0] : null,
      querySelectorAll: selector => selector.includes('.psle-action') ? actionButtons : [],
      addEventListener() {}
    },
    escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    showToast: (message, kind) => calls.toasts.push({ message, kind }),
    PP_THEME_C, PP_THEME_NAME,
    ppTheme: topic => PP_THEME[topic] || 'diversity',
    TOPIC_LEVELS,
    isLevelCode: v => /^(?:P[3-6]|S1)$/.test(String(v || '')),
    levelGroupLabel: lv => (lv === 'S1' ? 'Secondary ' : 'Primary ') + String(lv || '').slice(1),
    levelColors: LEVEL_COLORS,
    topicLevelMap: TOPIC_LEVEL_MAP,
    customTopics: options.customTopics || {},
    ppQuestions: () => rows,
    ppYears: () => [...new Set(rows.map(q => String(q.year)))].sort(),
    ppTopicOf: q => q.topic || '',
    ppFindQ: id => rows.find(q => q.id === id),
    ppBankQ: id => bank[id] || null,
    loadPaperData: async () => {}, loadPaperMap: async () => {},
    ppPracticeYear: year => calls.practiceYear.push(year),
    launchWorksheetPractice: (questions, mode, options) => calls.practise.push({ ids: questions.map(q => q.id), mode, options }),
    ppCollectPrintable: ids => {
      const seen = new Map(); const missing = [];
      ids.forEach(id => {
        const q = rows.find(r => r.id === id); if (!q) return;
        const bq = bank[id];
        if (!bq) { missing.push(q.year + ' Q' + q.n); return; }
        if (seen.has(bq.id)) seen.get(bq.id).refs.push(q.year + ' Q' + q.n); else seen.set(bq.id, { bq, refs: [q.year + ' Q' + q.n] });
      });
      return { items: [...seen.values()], missing };
    },
    _ppPrintQuestions: items => items.map(item => Object.assign({}, item.bq)),
    _ppCoverHtml: title => '<cover>' + title + '</cover>',
    ppDoPrint: (items, missing, title, opts) => calls.print.push({ ids: items.map(i => i.bq.id), missing, title, opts }),
    tsendOpen: ctx => calls.tsendOpen.push(ctx),
    tsendSend: () => { calls.tsendSend++; },
    appEmbedOpen: (page, params) => calls.embed.push({ page, params }),
    navigateTo() {},
    currentUser: options.signedOut ? null : { uid: 'student-1', role: 'student' },
    db: {},
    TSEND_COLLECTION: 'tutorWorksheets',
    collection: (db, name) => ({ name }),
    where: (field, op, value) => ({ field, op, value }),
    limit: n => ({ limit: n }),
    query: (...parts) => parts,
    getDocs: async parts => {
      calls.queries.push(parts);
      const docs = options.tutorDocs || [];
      return { forEach: fn => docs.forEach(d => fn({ id: d.id, data: () => d.data })) };
    }
  };
  vm.createContext(context);
  vm.runInContext(BLOCK + '\n;globalThis.__psle = { psleRowsFor, psleBankQs, psleYearSummaries, psleTopicSummaries, psleTopicLevel, psleTitle, psleTutorSourceId, psleSameIds, renderPslePage, psleRender, psleOpen, psleSetYear, psleSheetRender, psleClose, psleDo, psleRunStudyBuddy, PSLE_TUTOR_MAX_QUESTIONS, get sel() { return _psleSel; } };', context);
  return { api: context.__psle, calls, element };
}

// ───────── the summaries ─────────

test('years: newest first, with how many questions are ready and the marks', () => {
  const { api } = makeWorld();
  const years = api.psleYearSummaries();
  same(years.map(y => y.year), ['2024', '2023', '2022'], 'newest paper first');
  same(years[0], { year: '2024', total: 4, ready: 4, marks: 8 });
  same(years[1], { year: '2023', total: 3, ready: 3, marks: 8 });
  assert.equal(years[2].ready, 0, 'a year with nothing attached is counted as not ready');
});

test('topics: grouped by the level they are taught at (P3 → S1), then by name; unlabelled questions have no button', () => {
  const { api } = makeWorld();
  const topics = api.psleTopicSummaries();
  same(topics.map(t => t.topic), ['Living and non-living things', 'Magnets', 'Heat', 'Light', 'Plant Systems'],
    'P3 first, then P4 — the ladder\'s own order, alphabetical inside a level');
  same(topics.map(t => t.level), ['P3', 'P3', 'P4', 'P4', 'P4'], 'each topic carries the level it was grouped under');
  const heat = topics.find(t => t.topic === 'Heat');
  assert.equal(heat.total, 3);
  assert.equal(heat.ready, 3);
  same(heat.years, ['2024', '2023'], 'its years, newest first');
  assert.equal(topics.find(t => t.topic === 'Light').ready, 0);
});

test('a custom topic is filed at the admin\'s level, an unknown one under Other topics at the end, S1 after P6', async () => {
  const rows = paperRows().concat([
    { id: 'x_2024_10', year: '2024', n: 10, marks: 2, topic: 'Adaptations' },                 // the admin's custom topic, P5
    { id: 'x_2024_11', year: '2024', n: 11, marks: 2, topic: 'Experiment-Based Questions' },  // no level anywhere
    { id: 'x_2024_12', year: '2024', n: 12, marks: 2, topic: 'Forces' },                      // P6
    { id: 'x_2024_13', year: '2024', n: 13, marks: 2, topic: 'Separation Techniques' }        // S1
  ]);
  const bank = Object.assign(bankFor(), {
    x_2024_10: { id: 'b_ad' }, x_2024_11: { id: 'b_ex' }, x_2024_12: { id: 'b_fo' }, x_2024_13: { id: 'b_se' }
  });
  const { api, element } = makeWorld({ rows, bank, customTopics: { Adaptations: 'P5', 'Experiment-Based Questions': 'not a level' } });
  assert.equal(api.psleTopicLevel('Adaptations'), 'P5', 'the admin\'s custom level wins');
  assert.equal(api.psleTopicLevel('Experiment-Based Questions'), '', 'a junk custom level is no level');
  assert.equal(api.psleTopicLevel('Heat'), 'P4', 'the app\'s own map');
  assert.equal(api.psleTopicLevel(''), '');
  const topics = api.psleTopicSummaries();
  same(topics.map(t => t.level), ['P3', 'P3', 'P4', 'P4', 'P4', 'P5', 'P6', 'S1', ''], 'the ladder, then no level last');
  assert.equal(topics[topics.length - 1].topic, 'Experiment-Based Questions');
  await api.renderPslePage();
  const html = element('psleBody').innerHTML;
  const order = ['>Primary 3<', '>Primary 4<', '>Primary 5<', '>Primary 6<', '>Secondary 1<', '>Other topics<'].map(h => html.indexOf(h));
  assert.ok(order.every(i => i > 0), 'every group has a heading');
  same(order.slice().sort((a, b) => a - b), order, 'headings in ladder order, Other topics last');
  assert.ok(!html.includes('Primary 6<') || html.indexOf('Experiment-Based Questions') > html.indexOf('>Other topics<'),
    'an unknown topic is never claimed for Primary 6');
  assert.ok(html.includes('data-level="other"'), 'the no-level group is tagged');
  assert.ok(html.includes('--psle-accent:var(--accent-orange)'), 'a P5 topic wears the P5 colour');
});

test('a selection covers its rows in paper order, and practice serves each bank question once', () => {
  const { api } = makeWorld();
  same(api.psleRowsFor({ kind: 'year', key: '2024' }).map(q => q.id), ['s_2024_1', 's_2024_2', 's_2024_3', 's_2024_39'], 'sorted by question number');
  same(api.psleRowsFor({ kind: 'topic', key: 'Heat' }).map(q => q.id), ['s_2023_1', 's_2023_30', 's_2024_1'], 'every year, oldest paper first');
  same(api.psleRowsFor({ kind: 'topic', key: 'Heat', year: '2024' }).map(q => q.id), ['s_2024_1'], 'one year of the topic');

  const shared = bankFor(); shared.s_2024_1 = shared.s_2023_1;   // the same bank question attached to two papers
  const world = makeWorld({ bank: shared });
  same(world.api.psleBankQs({ kind: 'topic', key: 'Heat' }).map(q => q.id), ['b_heat_23_1', 'b_heat_23_30'], 'served once');
});

test('names and Study Buddy ids', () => {
  const { api } = makeWorld();
  assert.equal(api.psleTitle({ kind: 'year', key: '2024' }), 'PSLE 2024 Science Paper');
  assert.equal(api.psleTitle({ kind: 'topic', key: 'Heat' }), 'Heat — PSLE past-paper questions');
  assert.equal(api.psleTitle({ kind: 'topic', key: 'Heat', year: '2023' }), 'Heat — PSLE 2023');
  assert.equal(api.psleTutorSourceId({ kind: 'year', key: '2024' }), 'psle:year:2024');
  assert.equal(api.psleTutorSourceId({ kind: 'topic', key: 'Heat' }), 'psle:topic:Heat');
  assert.equal(api.psleTutorSourceId({ kind: 'topic', key: 'Heat', year: '2023' }), 'psle:topic:Heat:2023');
  assert.equal(api.psleSameIds(['a', 'b'], ['a', 'b']), true);
  assert.equal(api.psleSameIds(['a', 'b'], ['b', 'a']), false, 'order matters: a reordered paper is a different sheet');
  assert.equal(api.psleSameIds(['a'], ['a', 'b']), false);
  assert.equal(api.psleSameIds(undefined, []), false);
});

// ───────── the page ─────────

test('the page draws a button per year and per topic, and a not-ready one says so', async () => {
  const { api, element } = makeWorld();
  await api.renderPslePage();
  const html = element('psleBody').innerHTML;
  assert.equal((html.match(/psle-pick-year/g) || []).length, 3, 'three years');
  assert.equal((html.match(/psle-pick-topic/g) || []).length, 5, 'five topics');
  assert.ok(html.includes("psleOpen('year', 0)") && html.includes('>2024<'), 'the newest year is the first button');
  assert.ok(/psle-pick-year is-empty[^>]*>[\s\S]*?2022[\s\S]*?Coming soon/.test(html), '2022 has nothing attached: Coming soon');
  assert.ok(html.includes('>Primary 3<') && html.includes('>Primary 4<'), 'topics sit under their level');
  assert.ok(html.indexOf('>Primary 3<') < html.indexOf('>Primary 4<'), 'Primary 3 comes before Primary 4');
  assert.ok(!/>(Diversity|Cycles|Systems|Interactions|Energy)</.test(html), 'no syllabus-theme headings any more');
  assert.ok(!html.includes("psleOpen('topic', 5)"), 'no button for the unlabelled question');
  assert.ok(html.includes("navigateTo('papers')"), 'a way to the full page');
});

test('a not-ready button opens nothing', () => {
  const { api, calls, element } = makeWorld();
  api.psleRender();
  api.psleOpen('year', 2);
  assert.equal(api.sel, null);
  assert.ok(!element('psleOverlay').classList.contains('show'));
  assert.match(calls.toasts[0].message, /still being added/);
});

test('the topic sheet offers its years, and picking one narrows every action', () => {
  const { api, element } = makeWorld();
  api.psleRender();
  const heatIndex = api.psleTopicSummaries().findIndex(t => t.topic === 'Heat');
  api.psleOpen('topic', heatIndex);
  assert.ok(element('psleOverlay').classList.contains('show'));
  assert.equal(element('psleSheetTitle').textContent, 'Heat');
  assert.match(element('psleSheetSub').textContent, /^3 questions · 8 marks · from every year$/);
  assert.equal(element('psleSheetYears').hidden, false);
  assert.ok(element('psleSheetYears').innerHTML.includes("psleSetYear('2023')"));
  api.psleSetYear('2023');
  assert.match(element('psleSheetSub').textContent, /^2 questions · 6 marks · from PSLE 2023$/);
});

// ───────── the three actions ─────────

test('▶ Practice: a year goes through the full page\'s own door, a topic through Quick Practice', () => {
  const { api, calls, element } = makeWorld();
  api.psleRender();
  api.psleOpen('year', 0);
  api.psleDo('practice');
  same(calls.practiceYear, ['2024']);
  assert.ok(!element('psleOverlay').classList.contains('show'), 'the sheet closes');

  const heatIndex = api.psleTopicSummaries().findIndex(t => t.topic === 'Heat');
  api.psleOpen('topic', heatIndex);
  api.psleDo('practice');
  same(calls.practise[0].ids, ['b_heat_23_1', 'b_heat_23_30', 'b_heat_24_1']);
  same(calls.practise[0].options, { allowRetired: true }, 'retired-topic questions on a past paper are still served, as on the full page');
});

test('📄 Export PDF: the printed paper with its key, and no cover dialog', () => {
  const { api, calls } = makeWorld();
  api.psleRender();
  api.psleOpen('year', 0);
  api.psleDo('pdf');
  assert.equal(calls.print.length, 1);
  assert.equal(calls.print[0].title, 'PSLE 2024 Science Paper');
  same(calls.print[0].opts, { coverTitle: 'PSLE 2024 Science Paper', coverReady: true });
  same(calls.print[0].ids, ['b_heat_24_1', 'b_plant_24_2', 'b_cell_24_3', 'b_tape_24_39']);
  assert.ok(calls.toasts.some(t => /Save as PDF/.test(t.message)), 'says how to keep it as a PDF');
});

test('📖 Study Buddy: a first press sends the paper as the student\'s own copy', async () => {
  const { api, calls, element } = makeWorld();
  api.psleRender();
  api.psleOpen('year', 0);
  element('tsendSet').checked = true;   // an admin's default — must not set it for the class from here
  await api.psleRunStudyBuddy(api.sel);
  const [parts] = calls.queries;
  assert.ok(parts.some(p => p.field === 'ownerUid' && p.value === 'student-1'), 'looks only at this student\'s copies');
  assert.ok(parts.some(p => p.field === 'sourceWorksheetId' && p.value === 'psle:year:2024'));
  assert.equal(calls.tsendOpen.length, 1);
  const ctx = calls.tsendOpen[0];
  assert.equal(ctx.paper, true);
  assert.equal(ctx.coverReady, true, 'no cover dialog');
  assert.equal(ctx.akExtras, true, 'a past paper always carries its explanations');
  assert.equal(ctx.savedId, 'psle:year:2024', 'filed so the next press finds it');
  assert.equal(ctx.title, 'PSLE 2024 Science Paper');
  same(ctx.selected.map(q => q.id), ['b_heat_24_1', 'b_plant_24_2', 'b_cell_24_3', 'b_tape_24_39']);
  assert.equal(element('tsendSet').checked, false, 'never set for the class from here');
  assert.equal(calls.tsendSend, 1, 'sent straight away');
  same(calls.embed, []);
});

test('📖 Study Buddy: a second press opens the copy that already has their work on it', async () => {
  const tutorDocs = [
    { id: 'old-copy', data: { sourceQuestionIds: ['b_heat_24_1', 'b_plant_24_2'], updatedAt: { toMillis: () => 5 } } },           // questions changed since
    { id: 'their-copy', data: { sourceQuestionIds: ['b_heat_24_1', 'b_plant_24_2', 'b_cell_24_3', 'b_tape_24_39'], updatedAt: { toMillis: () => 9 } } }
  ];
  const { api, calls } = makeWorld({ tutorDocs });
  api.psleRender();
  api.psleOpen('year', 0);
  await api.psleRunStudyBuddy(api.sel);
  same(calls.embed, [{ page: 'tutor', params: { ws: 'their-copy' } }]);
  assert.equal(calls.tsendOpen.length, 0, 'nothing new is made');
  assert.equal(calls.tsendSend, 0);
});

test('📖 Study Buddy: signed out, or too many questions for one sheet, sends nothing', async () => {
  const signedOut = makeWorld({ signedOut: true });
  signedOut.api.psleRender();
  signedOut.api.psleOpen('year', 0);
  await signedOut.api.psleRunStudyBuddy(signedOut.api.sel);
  assert.equal(signedOut.calls.tsendOpen.length, 0);
  assert.match(signedOut.calls.toasts.at(-1).message, /Sign in/);

  const rows = []; const bank = {};
  for (let n = 1; n <= 60; n++) { rows.push({ id: 'big_' + n, year: '2030', n, marks: 1, topic: 'Heat' }); bank['big_' + n] = { id: 'bq_' + n }; }
  const big = makeWorld({ rows, bank });
  big.api.psleRender();
  big.api.psleOpen('year', 0);
  await big.api.psleRunStudyBuddy(big.api.sel);
  assert.equal(big.calls.tsendOpen.length, 0);
  assert.match(big.calls.toasts.at(-1).message, /too many for one Study Buddy sheet/);
});

// ───────── the wiring ─────────

test('index.html: the page, the sheet with its three actions, and a nav item for everyone', () => {
  assert.ok(INDEX.includes('<div class="page" id="page-psle">'));
  assert.ok(INDEX.includes('<div id="psleBody"></div>'));
  assert.ok(INDEX.includes('id="psleOverlay"'));
  for (const action of ['practice', 'tutor', 'pdf']) assert.ok(INDEX.includes(`data-action="${action}" onclick="psleDo('${action}')"`), action + ' button');
  const nav = INDEX.match(/<div class="nav-item[^"]*" data-page="psle"[^>]*>/);
  assert.ok(nav, 'nav item');
  assert.ok(!nav[0].includes('admin-only'), 'students see it');
});

test('app.js: navigation, the #psle deep link and the two cover shortcuts', () => {
  assert.ok(APP.includes("if (page === 'psle') renderPslePage();"));
  assert.ok(APP.includes("} else if (hash === 'psle') {"), 'opens after sign-in from /cer/#psle');
  assert.ok(APP.includes("'#psle': 'loginPage'"), 'signed out, #psle opens the sign-in form');
  for (const name of ['psleOpen', 'psleClose', 'psleSetYear', 'psleDo']) assert.ok(APP.includes(`window.${name} = ${name};`), name + ' reachable from onclick');
  assert.ok(APP.includes('if (ctx && ctx.coverReady) return true;'), 'the Study Buddy export skips the cover editor for a ready cover');
  assert.ok(/if \(!\(opts && opts\.coverReady\)\) \{\s*if \(!await _wsEditCover\(/.test(APP), 'the print skips it too');
});
