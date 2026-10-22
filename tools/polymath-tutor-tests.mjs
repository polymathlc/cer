// 🧠 The Polymath — the pure rules, and the wiring that puts its QR codes on
// every export surface. Run: node --test tools/polymath-tutor-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as core from '../polymath-tutor-core.mjs';

const ROOT = new URL('../', import.meta.url);
const APP = readFileSync(new URL('app.js', ROOT), 'utf8');
const INDEX = readFileSync(new URL('index.html', ROOT), 'utf8');
const PAGE = readFileSync(new URL('polymath.html', ROOT), 'utf8');
const UI = readFileSync(new URL('polymath-tutor.js', ROOT), 'utf8');

// The vendored QR library is a browser script that sets window.qrcode.
function loadQrcode() {
  const src = readFileSync(new URL('vendor/qrcode-generator.js', ROOT), 'utf8');
  const window = {};
  new Function('window', 'module', 'exports', 'define', src)(window, undefined, undefined, undefined);
  return window.qrcode || globalThis.qrcode;
}

const SAMPLE = {
  title: 'PSLE 2019 Science',
  questions: [
    {
      label: 'Question 1 — PSLE 2019 Q1', source: 'PSLE 2019 Q1',
      items: [
        { t: 'text', text: 'Which part of the plant takes in water?' },
        { t: 'img', url: 'https://example.com/plant.png', caption: 'A plant' },
        { t: 'mcq', id: 's1', options: [{ label: '1', text: 'Leaf' }, { label: '2', text: 'Root' }, { label: '3', text: 'Stem' }, { label: '4', text: 'Flower' }] },
      ],
      mcq: { s1: '2' },
      key: [{ label: 'Answer', text: '2. Root' }],
    },
    {
      label: 'Question 2', marks: 2,
      items: [
        { t: 'text', text: 'Explain why the ice melted.', part: '(a)' },
        { t: 'write', id: 's1', lines: 3, part: '(a)' },
        { t: 'fill', id: 's2', segments: [{ text: 'Heat flows from the ' }, { blank: true }, { text: ' surroundings.' }] },
      ],
      key: [{ part: '(a)', text: 'The ice gained heat from the warmer surroundings.' }],
      guide: 'Must mention gained heat.',
    },
  ],
};

test('the id is the content: stable, different on an edit, and valid', () => {
  const a = core.normalizeTutorPaper(SAMPLE);
  const b = core.normalizeTutorPaper(JSON.parse(JSON.stringify(SAMPLE)));
  assert.equal(core.tutorPaperId(a), core.tutorPaperId(b));
  const edited = JSON.parse(JSON.stringify(SAMPLE));
  edited.questions[0].items[0].text += ' ';
  assert.notEqual(core.tutorPaperId(core.normalizeTutorPaper(edited)), core.tutorPaperId(a));
  assert.ok(core.validTutorId(core.tutorPaperId(a)), core.tutorPaperId(a));
});

test('URLs round-trip, and junk is refused', () => {
  const id = core.tutorPaperId(core.normalizeTutorPaper(SAMPLE));
  const whole = core.tutorUrl(id), one = core.tutorUrl(id, 12);
  assert.equal(whole, core.TUTOR_BASE_URL + '#' + id);
  assert.equal(one, core.TUTOR_BASE_URL + '#' + id + '/12');
  assert.deepEqual(core.parseTutorHash(new URL(one).hash), { id, n: 12 });
  assert.deepEqual(core.parseTutorHash('#' + id), { id, n: 0 });
  assert.equal(core.parseTutorHash('#<script>'), null);
  assert.equal(core.parseTutorHash('#p123'), null);
  assert.equal(core.tutorUrl('nope', 1), '');
  // Short enough for a small printed code.
  assert.ok(one.length < 80, one.length + ' characters');
});

test('normalising keeps only safe, known content', () => {
  const p = core.normalizeTutorPaper({
    title: 'x', questions: [{
      items: [
        { t: 'script', text: 'alert(1)' },
        { t: 'img', url: 'javascript:alert(1)' },
        { t: 'img', url: 'http://insecure.example/a.png' },
        { t: 'img', url: 'data:image/png;base64,AAAA' },
        { t: 'text', text: '   ' },
        { t: 'mcq', id: 'a"b', options: [{ text: 'x', img: 'javascript:1' }] },
      ],
      key: [{ text: 'k', imgs: ['javascript:1', 'https://ok.example/k.png'] }],
    }],
  });
  const q = p.questions[0];
  assert.deepEqual(q.items.map(i => i.t), ['img', 'mcq']);
  assert.equal(q.items[0].url, 'data:image/png;base64,AAAA');
  assert.equal(q.items[1].id, 'ab');
  assert.equal(q.items[1].options[0].img, undefined);
  assert.deepEqual(q.key[0].imgs, ['https://ok.example/k.png']);
});

test('a question with nothing to fill still gets a box to answer in', () => {
  const p = core.normalizeTutorPaper({ questions: [{ items: [{ t: 'text', text: 'Draw the circuit.' }] }] });
  assert.equal(core.answerSlots(p.questions[0]).length, 1);
  assert.equal(p.questions[0].label, 'Question 1');
});

test('Firestore-safe: no nested arrays and nothing undefined', () => {
  const p = core.normalizeTutorPaper({ questions: [{ items: [{ t: 'table', rows: [{ c: ['a', 'b'] }, { c: ['', ''] }] }] }] });
  const walk = (v, inArray) => {
    assert.notEqual(v, undefined);
    if (Array.isArray(v)) { assert.ok(!inArray, 'array directly inside an array'); v.forEach(x => walk(x, true)); }
    else if (v && typeof v === 'object') Object.values(v).forEach(x => walk(x, false));
  };
  walk(p, false);
  assert.equal(p.questions[0].items[0].rows.length, 1, 'an empty table row is dropped');
});

test('HTML to plain text keeps lines and decodes entities', () => {
  assert.equal(core.htmlToPlain('<p>A &amp; B</p><p>C<br>D</p>'), 'A & B\nC\nD');
  assert.equal(core.htmlToPlain('<b>2.</b> Root&nbsp;hairs'), '2. Root hairs');
  assert.deepEqual(core.extractImages('<img src="https://a/x.png"> <img alt=1 src=\'https://b/y.png?a=1&amp;b=2\'>'), ['https://a/x.png', 'https://b/y.png?a=1&b=2']);
});

test('MCQ is marked without the model; mixed questions are not', () => {
  const p = core.normalizeTutorPaper(SAMPLE);
  assert.equal(core.mcqVerdict(p.questions[0], { s1: '2' }).verdict, 'correct');
  assert.equal(core.mcqVerdict(p.questions[0], { s1: '3' }).verdict, 'incorrect');
  assert.equal(core.mcqVerdict(p.questions[1], { s1: 'x' }), null);
  assert.equal(core.hasAnyAnswer(p.questions[1], {}), false);
  assert.equal(core.hasAnyAnswer(p.questions[1], { s2: ['', 'warmer'] }), true);
});

test('the prompts carry the question, the key, the answer and the rule', () => {
  const q = core.normalizeTutorPaper(SAMPLE).questions[1];
  const check = core.buildCheckPrompt(q, { s1: 'it got hot', s2: ['warmer'] }, 2);
  assert.match(check, /You are The Polymath/);
  assert.match(check, /Explain why the ice melted/);
  assert.match(check, /gained heat from the warmer surroundings/);
  assert.match(check, /Must mention gained heat/);
  assert.match(check, /it got hot/);
  assert.match(check, /\(1\) warmer/);
  assert.match(check, /attempt 2/);
  assert.match(check, /Do NOT give the final answer/);
  assert.doesNotMatch(check, /Chung GPT|Gemini|ChatGPT/, 'the student only ever meets The Polymath');
  assert.match(core.buildHintPrompt(q, {}, 1), /SMALLEST/);
  assert.match(core.buildHintPrompt(q, {}, 9), /hint 3 of 3/);
  assert.match(core.buildSolutionPrompt(q, {}), /full answer/);
  assert.match(core.buildChatPrompt(q, {}, [{ who: 'student', text: 'hi' }], 'why?', false), /Do NOT give the final answer/);
  assert.doesNotMatch(core.buildChatPrompt(q, {}, [], 'why?', true), /Do NOT give the final answer/);
});

test('a reply that is not clean JSON still becomes feedback', () => {
  assert.deepEqual(core.parseCheckReply('```json\n{"verdict":"correct","feedback":"**Well** done","nextStep":""}\n```'), { verdict: 'correct', feedback: 'Well done', nextStep: '' });
  assert.equal(core.parseCheckReply('{"verdict":"maybe","feedback":"x"}').verdict, 'partial');
  assert.equal(core.parseCheckReply('Nice try').feedback, 'Nice try');
});

test('progress lives on the phone and unlocks the solution after a real go', () => {
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const id = 'pabcdefghij';
  const pr = core.readProgress(storage, id);
  assert.equal(core.solutionUnlocked(pr, 1), false);
  pr.attempts[1] = core.TUTOR_SOLUTION_AFTER;
  pr.results[2] = { verdict: 'correct' };
  core.writeProgress(storage, id, pr);
  const back = core.readProgress(storage, id);
  assert.equal(core.solutionUnlocked(back, 1), true);
  assert.equal(core.solutionUnlocked(back, 2), true);
  assert.deepEqual(core.paperScore(core.normalizeTutorPaper(SAMPLE), back), { done: 1, correct: 1, total: 2 });
  assert.deepEqual(core.readProgress({ getItem: () => '{bad' }, id).answers, {});
});

test('the printed code is a real, scalable QR', () => {
  const qrcode = loadQrcode();
  assert.equal(typeof qrcode, 'function');
  const svg = core.tutorQrSvg(qrcode, core.tutorUrl('pabcdefghijk', 3), 19);
  assert.match(svg, /^<svg role="img"/);
  assert.match(svg, /width:19mm;height:19mm/);
  assert.equal(core.tutorQrSvg(null, 'x'), '');
});

/* ---------- the portal's side ---------- */
test('every export surface has its own switch, off by default', () => {
  for (const where of ['builder', 'saved', 'bank', 'paper', 'objective', 'custompaper']) {
    assert.ok(APP.includes(`tqrOpts('${where}', true)`), where + ' publishes on print');
  }
  for (const id of ['printIncludeTutorQr', 'wsIncludeTutorQr', 'mwIncludeTutorQr']) {
    const tag = INDEX.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
    assert.ok(tag, id + ' is on the page');
    assert.doesNotMatch(tag[0], /\schecked(?=[\s>=])/, id + ' starts unticked');
    assert.match(tag[0], /onchange="tqrToggle\(/);
  }
  for (const where of ['paper', 'objective', 'custompaper']) assert.ok(APP.includes(`tqrSwitchHtml('${where}'`), where + ' toolbar carries the switch');
  assert.match(APP, /const _tqrOn = \{\};/, 'nothing is remembered between visits');
});

test('the preview draws the codes but never publishes; Study Buddy never gets them', () => {
  assert.match(APP, /tutorQr: o\.noTags \? null : \(typeof tqrOpts === 'function' \? tqrOpts\(ctx\.tqrWhere \|\| ctx\.where, false\) : null\)/);
  assert.match(APP, /if \(tq\.publish\) _tqrPublish\(id, paper\);/);
});

test('both answer-key builders hang the codes, and the paper row is skipped by ✏️ edit answer', () => {
  assert.equal((APP.match(/tq\.rowQr\(i\)/g) || []).length, 2);
  assert.equal((APP.match(/allHtml \+= tq\.paperRow;/g) || []).length, 2);
  assert.match(APP, /qid\.indexOf\('__tqr'\) === 0\) return;/);
  assert.match(APP, /data-qid="__tqr_paper__"/);
});

test('the page builds nothing from the document as HTML, and wears only The Polymath name', () => {
  assert.doesNotMatch(UI, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(PAGE + UI, /Chung GPT/, 'a student never sees the engine\'s other name');
  assert.match(PAGE, /<title>The Polymath<\/title>/);
  assert.ok(PAGE.includes("model: 'gemini-3.8-flash'"));
  const appModel = APP.match(/const AI_MODEL = "([^"]+)"/)[1];
  assert.ok(PAGE.includes(`model: '${appModel}'`), 'the page runs the same model as the portal');
  assert.match(PAGE, /TUTOR_COLLECTION/);
  assert.equal(core.TUTOR_BASE_URL.replace(/[^/]+$/, 'question-app.html'), createRequire(import.meta.url)('../question-apps.js').VIEWER_URL, 'served beside the question-app viewer');
});

/* ---------- the portal's snapshot builder, cut out of app.js ---------- */
// The SHIPPED `_tqr*` section, run against small stand-ins for the app's part,
// MCQ-label and fill-in helpers (pinned by their own suites), so what is pinned
// here is how each block becomes something The Polymath can show and mark.
function loadTqr(extra) {
  const a = APP.indexOf('// 🧠 THE POLYMATH ON THE ANSWER KEY');
  const b = APP.indexOf('// Build the worksheet print HTML (question chunks + answer key)', a);
  assert.ok(a > 0 && b > a, 'the section is in app.js');
  const section = APP.slice(a, b).replace('window.tqrToggle = tqrToggle;', '');
  const stubs = `
    const window = { qrcode: ${extra && extra.qrcode ? 'QR' : 'null'} };
    const document = { querySelectorAll: () => [] };
    const escapeHtml = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const stripHtml = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
    const transformImageUrl = u => u;
    const qPartMap = blocks => { const m = new Map(); let cur = ''; (blocks || []).forEach(b => { if (b && b.part) cur = b.part; m.set(b, cur); }); return m; };
    const qPartOf = (m, b) => (m && m.get(b)) || '';
    const qPartLabel = p => p ? '(' + p + ')' : '';
    const qBlockOpensKey = (b) => (b && b.part) || '';
    const mcqLabelStyle = () => 'numbers';
    const mcqLabelOf = (i) => String(i + 1);
    const mcqOptionText = (t) => t;
    const qMarksOf = b => b.marks || 0;
    const qMarksBracket = n => '[' + n + ']';
    const _qOwnMarkersOff = b => b.content || '';
    const printAnswerLines = () => 3;
    const _fbHasBlanks = b => /\\[\\[/.test(b.text || '');
    const _fbSegments = t => t.split(/(\\[\\[[^\\]]+\\]\\])/).filter(Boolean).map(s => /^\\[\\[/.test(s) ? { type: 'blank', answer: s.slice(2, -2) } : { type: 'text', text: s });
    const ensureTableMigrated = () => {};
    const uploadImageDataUrl = async () => 'https://storage.example/x.png';
    const published = [];
    const doc = (db, col, id) => ({ col, id });
    const getDoc = async () => ({ exists: () => false });
    const setDoc = async (ref, body) => { published.push({ ref, body }); };
    const serverTimestamp = () => 'TS';
    const db = {}, currentUser = { uid: 'teacher' }, APP_VERSION = 'test';
    const toasts = []; const showToast = (m, t) => toasts.push([t, m]);
  `;
  const body = stubs + section + '\nreturn { _tqrQuestion, _tqrPaper, _tqrKeyParts, tqrOpts, tqrToggle, tqrPrintOn, published, toasts };';
  return new Function('htmlToPlain', 'extractImages', 'normalizeTutorPaper', 'tutorPaperId', 'tutorUrl', 'tutorQrSvg', 'TUTOR_NAME', 'TUTOR_COLLECTION', 'TUTOR_MAX_DOC_CHARS', 'QR', body)(
    core.htmlToPlain, core.extractImages, core.normalizeTutorPaper, core.tutorPaperId, core.tutorUrl, core.tutorQrSvg, core.TUTOR_NAME, core.TUTOR_COLLECTION, core.TUTOR_MAX_DOC_CHARS, extra && extra.qrcode);
}

const BANK_Q = {
  id: 'q1', title: 'Melting ice', _ppPrintSource: 'PSLE 2018 Q30', markingGuide: 'Award 1 mark for heat gained.',
  blocks: [
    { type: 'text', content: 'Ali left ice in a cup.\nIt melted.', part: 'a', marks: 2 },
    { type: 'image', url: 'https://example.com/cup.png', annotate: false },
    { type: 'table', data: [['Time', 'Temp'], ['0 min', '0 &deg;C']], rows: 2, cols: 2 },
    { type: 'answer', claim: 'x', evidence: 'y', reasoning: 'z' },
    { type: 'mcq', part: 'b', correctId: 'o3', options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }, { id: 'o3', text: 'C <img src="https://example.com/c.png">' }] },
    { type: 'fillblank', text: 'Heat moves to the [[colder]] object.' },
    { type: 'explanation', content: '<p>Heat flows from hot to cold.</p>' },
    { type: 'objectivesBox' },
  ],
};
const AK_ROW = { qid: 'q1', title: 'Question 1 — PSLE 2018 Q30', sections: [
  { label: 'Claim', content: '<b>gained</b> heat', part: 'a' },
  { label: 'Answer', content: '<b>3.</b> C', part: 'b' },
  { label: 'Explanation', kind: 'explanation', content: 'printed explanation', part: '' },
] };

test('a printed question becomes items, slots and a key The Polymath can mark', () => {
  const M = loadTqr();
  const paper = M._tqrPaper([BANK_Q], [AK_ROW], 'PSLE 2018');
  const q = paper.questions[0];
  assert.equal(q.label, 'Question 1 — PSLE 2018 Q30');
  assert.equal(q.source, 'PSLE 2018 Q30');
  assert.equal(q.marks, 2);
  assert.equal(q.guide, 'Award 1 mark for heat gained.');
  assert.deepEqual(q.items.map(i => i.t), ['text', 'img', 'table', 'write', 'write', 'write', 'mcq', 'fill']);
  assert.equal(q.items[0].text, 'Ali left ice in a cup.\nIt melted. [2]');
  assert.equal(q.items[0].part, '(a)');
  assert.deepEqual(q.items[2].rows[0].c, ['Time', 'Temp']);
  assert.deepEqual(q.items.filter(i => i.t === 'write').map(i => i.label), ['Claim', 'Evidence', 'Reasoning']);
  const mcq = q.items.find(i => i.t === 'mcq');
  assert.equal(mcq.part, '(b)');
  assert.equal(mcq.options[2].img, 'https://example.com/c.png');
  assert.equal(q.mcq[mcq.id], '3');
  assert.equal(q.items.find(i => i.t === 'fill').segments.filter(s => s.blank).length, 1);
  assert.ok(!JSON.stringify(q.items).includes('colder'), 'the blank\'s answer is not in the question');
  // The key: the printed rows first, the explanation from the blocks last.
  assert.deepEqual(q.key.map(r => r.label), ['Answer', 'Claim', 'Explanation']);
  assert.equal(q.key.find(r => r.label === 'Claim').text, 'gained heat');
  assert.equal(q.key[2].text, 'Heat flows from hot to cold.');
});

test('the key carries a row for the paper and a code per question; only a print publishes', async () => {
  const qrcode = loadQrcode();
  const M = loadTqr({ qrcode });
  assert.equal(M._tqrKeyParts([BANK_Q], [AK_ROW], 'T', null), null, 'switch off: nothing on the key');
  const preview = M._tqrKeyParts([BANK_Q], [AK_ROW], 'T', { publish: false });
  assert.match(preview.paperRow, /data-qid="__tqr_paper__"/);
  assert.match(preview.paperRow, /<svg/);
  assert.ok(preview.paperRow.includes(core.tutorUrl(preview.id)));
  assert.match(preview.rowQr(0), /float:right/);
  assert.match(preview.rowQr(0), /aria-label="Scan to try question 1 with The Polymath"/);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(M.published.length, 0, 'a preview writes nothing');
  const printed = M._tqrKeyParts([BANK_Q], [AK_ROW], 'T', { publish: true });
  M._tqrKeyParts([BANK_Q], [AK_ROW], 'T', { publish: true });
  assert.equal(printed.id, preview.id, 'the preview shows the codes that print');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(M.published.length, 1, 'once per paper');
  assert.equal(M.published[0].ref.col, 'polymathTutorPapers');
  assert.equal(M.published[0].ref.id, printed.id);
  assert.equal(M.published[0].body.questions.length, 1);
  assert.equal(M.published[0].body.by, 'teacher');
});

test('a pasted picture is uploaded, not stored in the document', async () => {
  const M = loadTqr({ qrcode: loadQrcode() });
  const q = { id: 'q2', title: 'x', blocks: [{ type: 'image', url: 'data:image/png;base64,iVBORw0KGgo=', annotate: false }, { type: 'plainanswer', content: 'a' }] };
  M._tqrKeyParts([q], [{ qid: 'q2', title: 'Q', sections: [] }], 'T', { publish: true });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(M.published[0].body.questions[0].items[0].url, 'https://storage.example/x.png');
});

test('the switches are per surface and start off', () => {
  const M = loadTqr();
  assert.equal(M.tqrOpts('paper', true), null);
  M.tqrToggle('paper', true);
  assert.deepEqual(M.tqrOpts('paper', true), { publish: true });
  assert.equal(M.tqrOpts('builder', true), null, 'a tick on one surface is not a tick on another');
  M.tqrToggle('nonsense', true);
  assert.equal(M.tqrPrintOn('nonsense'), false);
});

test('the symbols a science paper uses survive', () => {
  assert.equal(core.htmlToPlain('0 &deg;C &times; 2 &rarr; x'), '0 °C × 2 → x');
});
