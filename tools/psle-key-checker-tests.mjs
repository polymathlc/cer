// 🔍 PSLE answer key checker (v1.464.0) — the pure rules in
// psle-key-check-core.mjs, plus static checks that app.js / index.html wire
// the screen the way the core expects. Run:
//
//   node --test tools/psle-key-checker-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as PKC from '../psle-key-check-core.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const KEYS = { '2023': { 1: 2, 2: 3, 3: 4 } };
const OEQ = { '2023': { '31': '(a) Heat gain. (b) It expands.' } };
const TOPICS = ['Heat', 'Light', 'Magnets', 'Plant Systems'];

function bank(extra = {}) {
  return {
    id: 'b1', qno: 12, topic: 'Heat', marks: 2,
    mcq: { options: ['Wood', 'Metal', 'Plastic', 'Glass'], correct: 2 },
    answers: [{ blockId: 'm', part: '', kind: 'mcq', text: 'Option 3' }],
    explanations: [{ blockId: 'e', part: '', text: 'Metal conducts heat.' }],
    pictures: 1, emptyPictures: false, markable: true, hasParts: false, ...extra,
  };
}
function ctx(paper = {}, b = bank(), official) {
  const p = { id: 's_2023_2', year: '2023', n: 2, bk: 'A', marks: 2, topic: 'Heat', type: 'recall', title: 'Conductors', ans: 'Option 3 — metal', ...paper };
  return { paper: p, official: official || { option: PKC.officialOption(KEYS, p.year, p.n, p.bk), text: '', ocr: false }, bank: b, topics: TOPICS };
}
const ids = fs => fs.map(f => f.id).sort();

test('optionNum reads the option out of the usual ways a key is written', () => {
  assert.equal(PKC.optionNum('Option 3 — metal'), 3);
  assert.equal(PKC.optionNum('(2) because'), 2);
  assert.equal(PKC.optionNum('4'), 4);
  assert.equal(PKC.optionNum('Metal conducts heat'), null);
  assert.equal(PKC.optionNum(''), null);
});

test('the official keys: MCQ for Booklet A only, open-ended text for Booklet B', () => {
  assert.equal(PKC.officialOption(KEYS, '2023', 2, 'A'), 3);
  assert.equal(PKC.officialOption(KEYS, '2023', 2, 'B'), null);
  assert.equal(PKC.officialOption(KEYS, '2019', 2, 'A'), null);
  assert.equal(PKC.officialOpenAnswer(OEQ, '2023', 31, 'B'), '(a) Heat gain. (b) It expands.');
  assert.equal(PKC.officialOpenAnswer(OEQ, '2023', 1, 'A'), '');
});

test('stampOption keeps the wording and replaces only the option', () => {
  assert.equal(PKC.stampOption('Option 2 — metal conducts', 3), 'Option 3 — metal conducts');
  assert.equal(PKC.stampOption('(2) metal', 4), 'Option 4 — metal');
  assert.equal(PKC.stampOption('', 1), 'Option 1');
  assert.equal(PKC.stampOption('metal conducts', 2), 'Option 2 — metal conducts');
});

test('a clean question has nothing to say and is green', () => {
  const f = PKC.localFindings(ctx());
  assert.deepEqual(ids(f), []);
  assert.equal(PKC.statusOf(f, null), 'green');
});

test('the paper answer disagreeing with the official key is red, with the official option as the fix', () => {
  const f = PKC.localFindings(ctx({ ans: 'Option 2 — wood' }));
  const hit = f.find(x => x.id === 'paper-vs-official');
  assert.ok(hit, 'flagged');
  assert.equal(hit.severity, 'high');
  assert.deepEqual(hit.fix, { kind: 'paperOption', option: 3 });
  assert.equal(PKC.statusOf(f, null), 'red');
});

test('the bank ticking the wrong option is red even when the paper is right', () => {
  const f = PKC.localFindings(ctx({}, bank({ mcq: { options: ['a', 'b', 'c', 'd'], correct: 0 } })));
  const hit = f.find(x => x.id === 'bank-vs-official');
  assert.ok(hit);
  assert.deepEqual(hit.fix, { kind: 'bankOption', option: 3 });
});

test('with no official key, the bank and the paper are compared with each other', () => {
  const c = ctx({ year: '2019', ans: 'Option 1' }, bank({ mcq: { options: ['a', 'b', 'c', 'd'], correct: 3 } }));
  const f = PKC.localFindings(c);
  const hit = f.find(x => x.id === 'bank-vs-paper');
  assert.ok(hit, 'disagreement found');
  assert.deepEqual(hit.fix, { kind: 'bankOption', option: 1 });
});

test('no ticked option, blank answers, no answer section are all red', () => {
  assert.ok(PKC.localFindings(ctx({}, bank({ mcq: { options: ['a', 'b', 'c', 'd'], correct: -1 } }))).some(f => f.id === 'bank-no-correct' && f.fix && f.fix.option === 3));
  const oeq = bank({ mcq: null, answers: [{ blockId: 'p', part: 'a', kind: 'plainanswer', text: '' }] });
  const f = PKC.localFindings(ctx({ n: 31, bk: 'B', ans: 'It expands' }, oeq, { option: null, text: '', ocr: false }));
  assert.ok(f.some(x => x.id === 'bank-answer-blank' && /part \(a\)/.test(x.title)));
  assert.ok(PKC.localFindings(ctx({}, bank({ markable: false }))).some(x => x.id === 'bank-unmarkable'));
});

test('marks, topic and booklet disagreements are flagged with a matching fix', () => {
  const f = PKC.localFindings(ctx({ marks: 1, topic: 'Light' }, bank({ marks: 2 })));
  assert.deepEqual(f.find(x => x.id === 'marks-mismatch').fix, { kind: 'marks', value: 2 });
  assert.deepEqual(f.find(x => x.id === 'topic-mismatch').fix, { kind: 'topic', value: 'Heat' });
  const b = PKC.localFindings(ctx({ bk: 'B', n: 31 }, bank(), { option: null, text: '', ocr: false }));
  assert.deepEqual(b.find(x => x.id === 'mcq-in-b').fix, { kind: 'booklet', value: 'A' });
});

test('not attached and nothing else wrong is grey, never green', () => {
  const f = PKC.localFindings(ctx({}, null));
  assert.ok(f.some(x => x.id === 'not-attached'));
  assert.equal(PKC.statusOf(f, null), 'grey');
});

test('an AI "wrong" verdict is red; "check" is amber', () => {
  assert.equal(PKC.statusOf([], { verdict: 'wrong', issues: [] }), 'red');
  assert.equal(PKC.statusOf([], { verdict: 'check', issues: [] }), 'amber');
  assert.equal(PKC.statusOf([], { verdict: 'ok', issues: [] }), 'green');
});

test('the signature changes when anything the AI saw changes', () => {
  const a = PKC.contextSig(ctx(), 'repr');
  assert.equal(PKC.contextSig(ctx(), 'repr'), a, 'stable');
  assert.notEqual(PKC.contextSig(ctx({ ans: 'Option 2' }), 'repr'), a, 'paper answer');
  assert.notEqual(PKC.contextSig(ctx({}, bank({ mcq: { options: ['Wood', 'Metal', 'Plastic', 'Glass'], correct: 1 } })), 'repr'), a, 'ticked option');
  assert.notEqual(PKC.contextSig(ctx(), 'repr 2'), a, 'question wording');
});

test('the prompt carries the official key, both answers, the options and the topic list', () => {
  const p = PKC.buildPrompt(ctx(), 'THE STEM', { grounding: 'GROUND', picturesSent: 1 });
  assert.match(p, /OFFICIAL PSLE answer key says Option 3/);
  assert.match(p, /"paperAnswer":"Option 3 — metal"/);
  assert.match(p, /"tickedOption":3/);
  assert.match(p, /\(2\) Metal/);
  assert.match(p, /THE STEM/);
  assert.match(p, /GROUND/);
  assert.match(p, /VALID TOPICS: \["Heat","Light","Magnets","Plant Systems"\]/);
  assert.match(p, /1 of 1 picture/);
  assert.match(p, /Return ONLY JSON/);
  const oeq = PKC.buildPrompt(ctx({ n: 31, bk: 'B' }, bank({ mcq: null }), { option: null, text: '(o) Heat', ocr: true }), 'x');
  assert.match(oeq, /OCR/);
});

test('parseReply keeps only fixes the app can carry out', () => {
  const c = ctx({}, bank({ mcq: null, answers: [{ blockId: 'pa', part: 'a', kind: 'plainanswer', text: 'x' }, { blockId: 'pb', part: 'b', kind: 'plainanswer', text: 'y' }] }));
  const r = PKC.parseReply({
    verdict: 'wrong', ownAnswer: 'It expands', summary: 'Part (b) is wrong',
    issues: [
      { area: 'Answer key', severity: 'high', title: 'Part (b) answer wrong', detail: 'd', fix: { kind: 'bankAnswer', part: '(b)', text: 'The air expands' } },
      { area: 'Options', severity: 'high', title: 'tick 3', fix: { kind: 'bankOption', option: 3 } },          // no MCQ: dropped
      { area: 'Topic', severity: 'low', title: 'topic', fix: { kind: 'topic', value: 'Astrology' } },          // not a topic: dropped
      { area: 'Marks', severity: 'med', title: 'marks', fix: { kind: 'marks', value: 99 } },                   // absurd: dropped
      { area: 'Marks', severity: 'med', title: 'marks ok', fix: { kind: 'marks', value: 3 } },
      { title: '' },                                                                                          // no title: dropped
    ],
  }, c);
  assert.equal(r.verdict, 'wrong');
  assert.equal(r.issues.length, 5);
  assert.deepEqual(r.issues[0].fix, { kind: 'bankAnswer', part: 'b', blockId: 'pb', text: 'The air expands' });
  assert.equal(r.issues[1].fix, undefined);
  assert.equal(r.issues[2].fix, undefined);
  assert.equal(r.issues[3].fix, undefined);
  assert.deepEqual(r.issues[4].fix, { kind: 'marks', value: 3 });
  assert.ok(r.issues.every(i => i.ai));
});

test('parseReply refuses a reply with no verdict, and "wrong" always says something', () => {
  assert.throws(() => PKC.parseReply({ issues: [] }, ctx()), /verdict/);
  assert.throws(() => PKC.parseReply([], ctx()), /unreadable/);
  const r = PKC.parseReply({ verdict: 'wrong', summary: 'Option 2 is right' }, ctx());
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].severity, 'high');
});

test('filters and summary', () => {
  const rows = [
    { status: 'red', checked: false, ai: null },
    { status: 'amber', checked: true, ai: { verdict: 'check' }, aiStale: true },
    { status: 'green', checked: true, ai: { verdict: 'ok' }, aiStale: false },
    { status: 'grey', checked: false, ai: null },
  ];
  assert.equal(rows.filter(r => PKC.passesFilter(r, 'attention')).length, 2);
  assert.equal(rows.filter(r => PKC.passesFilter(r, 'unchecked')).length, 2);
  assert.equal(rows.filter(r => PKC.passesFilter(r, 'checked')).length, 2);
  assert.equal(rows.filter(r => PKC.passesFilter(r, 'noai')).length, 3, 'a stale verdict counts as not run');
  assert.deepEqual(PKC.summarise(rows), { total: 4, red: 1, amber: 1, green: 1, grey: 1, checked: 2, ai: 1 });
  for (const f of PKC.FILTERS) assert.ok(f.key && f.label);
  assert.match(PKC.fixLabel({ kind: 'bankOption', option: 2 }), /option 2/);
});

// ── static wiring ────────────────────────────────────────────────────────
const START = APP.indexOf('// 🔍 PSLE ANSWER KEY CHECKER');
const END = APP.indexOf('// End PSLE answer key checker');
const BLOCK = APP.slice(START, END);

test('app.js imports the core and ships the block', () => {
  assert.ok(APP.includes("import * as PKC from './psle-key-check-core.mjs?v=1';"));
  assert.ok(START > 0 && END > START, 'block present');
});

test('every onclick/onchange/oninput the screen writes is on window', () => {
  const html = BLOCK + INDEX;
  const used = new Set([...html.matchAll(/on(?:click|change|input)="(pkc[A-Za-z]+|ppTopicCheck)\(/g)].map(m => m[1]));
  assert.ok(used.size >= 12, 'handlers found: ' + [...used].join(','));
  for (const fn of used) assert.ok(new RegExp('^window\\.' + fn + ' = ' + fn + ';', 'm').test(APP), fn + ' is on window');
});

test('the doors: every paper, each year, the topic view, the topic bars', () => {
  assert.match(APP, /onclick="pkcOpen\('all'\)"/);
  assert.match(APP, /onclick="pkcOpen\('year','\$\{escapeHtml\(y\)\}'\)"/);
  assert.match(APP, /onclick="pkcOpen\('topic', 0\)"/);
  assert.ok(INDEX.includes('id="ppTopicCheckBtn"') && INDEX.includes('onclick="ppTopicCheck()"'));
  assert.ok(!/_ppTopicOrder\[[^\]]*\][^"]*"/.test(APP.slice(APP.indexOf('function ppPkcCardHtml'), APP.indexOf('function ppMarksByTopic'))), 'no module variable in an inline handler');
});

test('the overlay markup is there with its three panes', () => {
  for (const id of ['pkcOverlay', 'pkcHead', 'pkcRail', 'pkcMain', 'pkcSide']) assert.ok(INDEX.includes(`id="${id}"`), id);
});

test('saving the bank files a before-copy FIRST, and AI calls are metered', () => {
  const save = BLOCK.slice(BLOCK.indexOf('async function pkcSave('), BLOCK.indexOf('async function pkcSaveAll('));
  assert.ok(save.indexOf('RLF_HISTORY_COL') > 0 && save.indexOf('RLF_HISTORY_COL') < save.indexOf('await saveQuestion('), 'history before the save');
  assert.match(BLOCK, /aiMeterOpen\(_pkcOnRecord\)/);
  assert.ok(!/authoring: true/.test(BLOCK), 'not an authoring call');
});
