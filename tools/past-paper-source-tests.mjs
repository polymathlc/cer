// The real topic collector, print path and worksheet builder must retain the
// paper reference even when the bank title is hidden by plainNumbers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function cut(from, to) {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Missing source section: ${from}`);
  return src.slice(start, end);
}

function harness(rows, bank) {
  const output = { innerHTML: '' };
  const toasts = [];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const deps = {
    document: { getElementById: () => output },
    escapeHtml, escapeHtmlKeepLines: escapeHtml,
    ppQuestions: () => rows,
    ppFindQ: id => rows.find(q => q.id === id),
    ppBankQ: id => bank.find(q => q.id === rows.find(row => row.id === id)?.bankId),
    ppTopicOf: q => q.topic,
    showToast: (...args) => toasts.push(args),
    _printProgressShow() {}, _printProgressHide() {}, _printProgressUpdate() {},
    _preloadImageUrls: async () => {}, wnyPrintOn: () => false,
    autoscaleAndPrint: () => {},
    _ppCoverHtml: () => '<div class="print-front-page print-cover-page"></div>',
    _wsHeaderHtml: () => '', pvsPoolOf: () => '',
    qIsMcqOnly: () => false, imgQuestionNeedsBig: () => false,
    qPartMap: () => ({}), qPartOf: () => '', qBlockOpensKey: () => '',
    qPartBodyHtml: b => b.content,
    printPartBlockHtml: (_, html) => `<div class="print-text-block">${html}</div>`,
    _pushAnnotAnswerKey() {}, objBoxAutoHtml: () => '',
    _qAnswerKeyExtraSection: () => null,
    _qFallbackKeySection: q => ({ content: q.answer }),
    _akQuestionSections: q => q.sections,
    _akSectionsHtml: sections => sections.map(s => escapeHtml(s.content)).join(''),
    _wsShowPreviewOverlay() {},
  };
  const code = [
    'let _ppTopicSel = null, _wsPreviewPaper = null, _wsPreviewSaved = null, _wsPreviewAdhoc = null;',
    cut('function ppCollectPrintable(hitIds){', '// Cover sheet for a past-paper print'),
    cut('function _ppPrintQuestions(items){', '// Each of the three past-paper print buttons'),
    cut('function ppTopicQs(){', 'function ppTopicRender(){'),
    cut('function ppTopicPrint(){', 'function ppTopicPractise(){'),
    cut('function ppPreview(items, missing, title, opts) {', '// Preview a SAVED worksheet'),
    cut('function buildWorksheetHtml(', '// One AI call per MCQ'),
    `return {
      topicPrint(topic, year = '') { _ppTopicSel = {topic, year}; ppTopicPrint(); },
      collect: ppCollectPrintable, copies: _ppPrintQuestions, build: buildWorksheetHtml,
      print: ppDoPrint, preview: ppPreview, previewState: () => _wsPreviewPaper,
    };`,
  ].join('\n');
  return { ...new Function(...Object.keys(deps), code)(...Object.values(deps)), output, toasts };
}

function bankQuestion(id, topic) {
  return { id, topic, title: 'Internal bank title', category: 'Internal category',
    blocks: [{ id: id + '-text', type: 'text', content: 'Explain the observation.' }],
    answer: 'Model answer.' };
}

test('every topic prints its own PSLE year and original number on each question and key', async () => {
  for (const topic of ['Forces', 'Heat', 'Light', 'Electrical System', 'Reproduction']) {
    const bank = [bankQuestion('older', topic), bankQuestion('newer', topic)];
    const rows = [
      { id: 'a', year: 2013, n: 22, topic, bankId: 'older' },
      { id: 'b', year: 2025, n: 40, topic, bankId: 'newer' },
      { id: 'other', year: 2020, n: 1, topic: 'Other topic', bankId: 'older' },
    ];
    const h = harness(rows, bank);
    h.topicPrint(topic);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(h.output.innerHTML, /<h2>Question 1 — PSLE 2013 Q22<\/h2>/);
    assert.match(h.output.innerHTML, /<h2>Question 2 — PSLE 2025 Q40<\/h2>/);
    assert.match(h.output.innerHTML, /<h4>Question 1 — PSLE 2013 Q22<\/h4>/);
    assert.match(h.output.innerHTML, /<h4>Question 2 — PSLE 2025 Q40<\/h4>/);
    assert.doesNotMatch(h.output.innerHTML, /Internal bank title|Internal category|2020 Q1/);
  }
});

test('a single-year topic selection prints only that year', async () => {
  const h = harness([
    { id: 'a', year: 2013, n: 22, topic: 'Forces', bankId: 'shared' },
    { id: 'b', year: 2014, n: 18, topic: 'Forces', bankId: 'shared' },
  ], [bankQuestion('shared', 'Forces')]);
  h.topicPrint('Forces', '2014');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.output.innerHTML, /<h2>Question 1 — PSLE 2014 Q18<\/h2>/);
  assert.doesNotMatch(h.output.innerHTML, /2013/);
});

test('a question reused across papers prints once with every source, without changing the bank', async () => {
  const q = bankQuestion('shared', 'Forces');
  const before = JSON.stringify(q);
  const h = harness([
    { id: 'a', year: 2013, n: 22, topic: 'Forces', bankId: 'shared' },
    { id: 'b', year: 2014, n: 18, topic: 'Forces', bankId: 'shared' },
  ], [q]);
  const { items, missing } = h.collect(['a', 'b']);
  await h.print(items, missing, 'Forces');
  assert.equal((h.output.innerHTML.match(/<h2>Question /g) || []).length, 1);
  assert.match(h.output.innerHTML, /Question 1 — PSLE 2013 Q22 \/ PSLE 2014 Q18/);
  assert.equal(JSON.stringify(q), before);
  h.preview(items, missing, 'Forces');
  assert.equal(h.output.innerHTML, h.build(h.previewState().selected, 'Forces', {
    plainNumbers: true, answerKeyExtras: true,
    frontHtml: '<div class="print-front-page print-cover-page"></div>',
  }));
});

test('ordinary worksheets keep clean numbering and never guess a year from a bank title', () => {
  const q = bankQuestion('ordinary', 'Forces');
  q.title = 'PSLE 2018 Q15';
  const h = harness([], [q]);
  const html = h.build([q], 'Worksheet', { plainNumbers: true });
  assert.match(html, /<h2>Question 1<\/h2>/);
  assert.match(html, /<h4>Question 1<\/h4>/);
  assert.doesNotMatch(html, /PSLE/);
});

test('source references are escaped as text in both headings', () => {
  const h = harness([], []);
  const selected = h.copies([{ bq: bankQuestion('safe', 'Heat'), refs: ['2020 Q1 <img src=x>'] }]);
  const html = h.build(selected, 'Heat', { plainNumbers: true });
  assert.match(html, /PSLE 2020 Q1 &lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img/);
});
