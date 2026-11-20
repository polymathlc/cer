// Tests for the night run that makes the Questions of the Day
// (tools/daily-question-prepare.mjs), with a real PDF drawn by pdf.js on
// @napi-rs/canvas, Rapid add's real crop pipeline, and a scripted Chung GPT.
//
//   PREPARE_DEPS=rapid-import/functions node --test tools/daily-question-prepare-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateKeyPairSync, privateDecrypt, createDecipheriv, constants } from 'node:crypto';
import {
  prepareRun, checkMarking, eligibleWorksheets, planPages, planCer, upcomingWorksheets, pagesOf, encryptPreview, previewHtml, reasonKey
} from './daily-question-prepare.mjs';

const localRequire = createRequire(import.meta.url);
const pool = localRequire('../shop-function/functions/daily-question-pool.js');
const core = localRequire('../shop-function/functions/daily-question-core.js');

const DEPS = process.env.PREPARE_DEPS || new URL('../rapid-import/functions', import.meta.url).pathname;
const depRequire = createRequire(join(DEPS, 'noop.js'));
const canvasMod = depRequire('@napi-rs/canvas');
Object.assign(globalThis, { DOMMatrix: canvasMod.DOMMatrix, ImageData: canvasMod.ImageData, Path2D: canvasMod.Path2D });
const pdfjs = await import(pathToFileURL(join(DEPS, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
const crop = await import(new URL('../rapid-import/functions/crop.js', import.meta.url).href);

const NOW = Date.UTC(2026, 10, 20, 14, 7);   // 10:07 p.m. Singapore, Friday 20 November 2026
const DAY = 86400000;

/* ─── A worksheet PDF made here: a question, a drawn rectangle with labels, and its parts ─── */
function makePdf(pages) {
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  const pagesId = objects.length + pages.length * 2 + 1;
  for (const content of pages) {
    const stream = add('<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + '\nendstream');
    kids.push(add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ' + font + ' 0 R >> >> /Contents ' + stream + ' 0 R >>'));
  }
  add('<< /Type /Pages /Kids [' + kids.map(k => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>');
  const catalog = add('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out)); out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n'; });
  const xref = Buffer.byteLength(out);
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return Buffer.from(out, 'latin1');
}
const text = (x, y, s, size = 12) => 'BT /F1 ' + size + ' Tf ' + x + ' ' + y + ' Td (' + s + ') Tj ET';
// Page 2: question 5 with a rectangle 8 cm by 5 cm (drawn at y 450–600) and parts (a), (b).
const PAGE_2 = [
  text(60, 760, '5. The figure below shows a rectangle ABCD.'),
  '2 w 150 450 m 450 450 l 450 600 l 150 600 l h S',
  text(140, 610, 'A'), text(452, 610, 'B'), text(452, 436, 'C'), text(140, 436, 'D'),
  text(285, 607, '8 cm'), text(458, 520, '5 cm'),
  text(60, 380, '(a) Find the perimeter of the rectangle.  ______ [1]'),
  text(60, 330, '(b) Find the area of the rectangle.  ______ [2]')
].join('\n');
const PDF = makePdf([text(60, 760, 'P5 Maths Worksheet 3'), PAGE_2, text(60, 760, '6. Spare page.')]);

const canvasKit = {
  createCanvas: canvasMod.createCanvas,
  async renderPage(doc, p, px) {
    const page = await doc.getPage(p), original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, px / Math.max(original.width, original.height)) });
    const canvas = canvasMod.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: 'white' }).promise;
    page.cleanup();
    return canvas;
  }
};

/* ─── An in-memory store with the pool methods the run uses ─── */
function memoryStore() {
  const state = { queue: pool.emptyQueue(), pool: new Map(), images: new Map(), sources: {}, runs: new Map() };
  return {
    state,
    async getQueue() { return pool.readQueue(structuredClone(state.queue)); },
    async saveQueue(q) { state.queue = pool.readQueue(structuredClone(q)); },
    async getPoolItems(ids) { const out = {}; for (const id of ids) if (state.pool.has(id)) out[id] = structuredClone(state.pool.get(id)); return out; },
    async getPoolItem(id) { return state.pool.has(id) ? structuredClone(state.pool.get(id)) : null; },
    async savePoolItem(item, pictures) { for (const p of pictures) state.images.set(p.id, p); state.pool.set(item.id, structuredClone(item)); },
    async getSources() { return structuredClone(state.sources); },
    async saveSources(d) { state.sources = Object.assign(state.sources, structuredClone(d)); },
    async savePrepareRun(id, d) { state.runs.set(id, d); }
  };
}

/* ─── A scripted Chung GPT: answers by what it is asked ─── */
function scriptedAi({ extract, verify = () => ({ solvedAnswer: '26 cm', agrees: true, scores: { wording: 5, pictures: 5, answer: 5, working: 5, standalone: 5, level: 5 }, issues: [], publish: true }),
  refine = () => ({ clean: true }), mark = () => ({ verdict: 'correct', feedback: 'Well done.' }) }) {
  const calls = [];
  return {
    calls, usage: { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0 },
    async ask(prompt, opts) {
      this.usage.calls++;
      const system = opts.system || '';
      const kind = system === pool.ANSKEY_EXTRACT_SYSTEM || system === pool.CER_EXTRACT_SYSTEM ? 'extract'
        : system === pool.VERIFY_SYSTEM ? 'verify' : system === pool.MARK_SYSTEM ? 'mark' : 'refine';
      calls.push({ kind, prompt, images: (opts.images || []).length });
      if (kind === 'extract') return extract(prompt, opts);
      if (kind === 'verify') return verify(prompt, opts);
      if (kind === 'mark') return mark(prompt, opts);
      return refine(prompt, opts);
    }
  };
}
const WORKSHEET = { id: 'ws1', ownerUid: 'u1', name: 'P5 Maths Worksheet 3', level: 'P5', subject: 'math', wsDate: '2026-09-01', createdAt: 0, hidden: false,
  storagePath: 'pdf-annotator/ws1.pdf', pageCount: 3 };
function sources({ worksheets = [WORKSHEET], cer = [], images = {} } = {}) {
  return {
    async listWorksheets() { return worksheets; },
    async listCourses() { return []; },
    async loadPdf() { return pdfjs.getDocument({ data: new Uint8Array(PDF), isEvalSupported: false, standardFontDataUrl: join(DEPS, 'node_modules/pdfjs-dist/standard_fonts/') }).promise; },
    async liveKey() { return { items: [{ page: 2, number: '5a', answer: '26 cm', model: 'The perimeter is 26 cm.' }] }; },
    async listCerQuestions() { return cer; },
    async loadImage(url) {
      const c = canvasMod.createCanvas(400, 300), ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 300); ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect(40, 40, 320, 220);
      ctx.fillStyle = '#000'; ctx.font = '20px sans-serif'; ctx.fillText(images[url] || 'Beaker', 150, 160);
      return c;
    }
  };
}
// The rectangle on page 2, in 0–1000 page units: x 150–450 of 595, y (842−600)–(842−436) of 842.
const RECT_BOX = [Math.round((842 - 625) / 842 * 1000), Math.round(130 / 595 * 1000), Math.round((842 - 425) / 842 * 1000), Math.round(475 / 595 * 1000)];
const goodItems = () => ({ items: [
  { number: '5a', q: 'The diagram shows a rectangle ABCD with length 8 cm and breadth 5 cm. Find the perimeter of the rectangle.',
    figures: [{ box_2d: RECT_BOX, kind: 'diagram', alt: 'Rectangle ABCD, 8 cm by 5 cm' }], answerType: 'number', answer: '26 cm', accepted: ['26'],
    model: 'The perimeter of the rectangle is 26 cm.', steps: ['Perimeter = 8 cm + 5 cm + 8 cm + 5 cm', '= 26 cm'], idea: 'Perimeter is the distance all the way round.',
    keywords: [], topic: 'Area and perimeter', marks: 1 },
  { number: '5b', q: 'The diagram shows a rectangle ABCD with length 8 cm and breadth 5 cm. Find the area of the rectangle.',
    figures: [{ box_2d: RECT_BOX, kind: 'diagram', alt: 'Rectangle ABCD, 8 cm by 5 cm' }], answerType: 'number', answer: '40 cm²', accepted: ['40'],
    model: 'The area of the rectangle is 40 cm².', steps: ['Area = length × breadth', '= 8 × 5 = 40 cm²'], idea: 'Area of a rectangle = length × breadth.',
    keywords: [], topic: 'Area and perimeter', marks: 2 }
] });

/* ═════════ Which worksheets ═════════ */

test('only old, visible Maths/Science P3–P6 worksheets with pages left are used; never one still to be taught', () => {
  const now = NOW;
  const base = WORKSHEET;
  const list = [
    base,
    Object.assign({}, base, { id: 'recent', wsDate: '2026-11-10' }),
    Object.assign({}, base, { id: 'future', wsDate: '2026-12-01' }),
    Object.assign({}, base, { id: 'hidden', hidden: true }),
    Object.assign({}, base, { id: 'key', name: 'P5 Maths Worksheet 3 Answer key' }),
    Object.assign({}, base, { id: 'eng', subject: 'english' }),
    Object.assign({}, base, { id: 'p2', level: 'P2' }),
    Object.assign({}, base, { id: 'sec', level: 'S1' }),
    Object.assign({}, base, { id: 'nodate-new', wsDate: '', createdAt: NOW - 3 * DAY }),
    Object.assign({}, base, { id: 'nodate-old', wsDate: '', createdAt: NOW - 90 * DAY }),
    Object.assign({}, base, { id: 'queued' }),
    Object.assign({}, base, { id: 'done', pageCount: 3 })
  ];
  const upcoming = upcomingWorksheets([{ worksheetIds: ['taught', 'queued'], currentIndex: 1 }]);
  assert.ok(upcoming.has('queued') && !upcoming.has('taught'));
  const need = { math: { P3: 1, P4: 1, P5: 1, P6: 1 }, science: { P3: 1, P4: 1, P5: 1, P6: 1 } };
  const ok = eligibleWorksheets(list, { now, upcoming, seen: { done: [2, 3] }, need }).map(w => w.id);
  assert.deepEqual(ok.sort(), ['nodate-old', 'ws1']);
  assert.deepEqual(eligibleWorksheets([base], { now, need: { math: { P5: 0 }, science: {} } }), [], 'a full level reads nothing');
  assert.deepEqual(pagesOf({ pageCount: 5 }), [2, 3, 4, 5], 'not the cover');
  assert.deepEqual(pagesOf({ pageCount: 1 }), [1]);
});

test('the pages to read are spread over worksheets and go to the levels that need most', () => {
  const ws = (id, level) => Object.assign({}, WORKSHEET, { id, level, pageCount: 10 });
  const need = { math: { P3: 0, P4: 6, P5: 2, P6: 0 }, science: { P3: 0, P4: 0, P5: 0, P6: 0 } };
  const plan = planPages([ws('a', 'P4'), ws('b', 'P4'), ws('c', 'P5')], { need, max: 5, seed: 'x' });
  assert.equal(plan.length, 4, 'P4 wants about three pages, P5 one');
  assert.equal(plan.filter(p => p.ws.level === 'P4').length, 3);
  assert.equal(new Set(plan.map(p => p.ws.id + p.page)).size, plan.length, 'no page twice');
});

test('a CER bank question is read with its parts, pictures and the teacher\'s answers; multiple choice is never used', () => {
  const q = { id: 'c1', level: 'P5', topic: 'Heat', blocks: [
    { type: 'text', content: '<p>Ali put a metal spoon in hot water.</p>' },
    { type: 'image', url: 'https://example.test/a.png', caption: 'Set-up' },
    { type: 'text', part: 'a', content: 'What happened to the spoon?' },
    { type: 'answer', part: 'a', marks: 2, claim: 'The spoon became warmer.', evidence: '', reasoning: 'It gained heat from the hotter water.' }
  ] };
  const src = pool.cerSource(q);
  assert.match(src.text, /\(a\) What happened/);
  assert.match(src.text, /\[picture 1\]/);
  assert.equal(src.images.length, 1);
  assert.match(src.answers[0], /Claim: The spoon became warmer/);
  assert.equal(pool.cerSource({ level: 'P5', blocks: [{ type: 'text', content: 'Which is a magnet?' }, { type: 'mcq', options: [], correctId: 'a' }] }), null, 'multiple choice only: never used');
  const mixed = pool.cerSource({ level: 'P5', blocks: [{ type: 'text', content: '(a) Pick one.' }, { type: 'mcq', options: [] },
    { type: 'text', content: '(b) Explain why the ice melted.' }, { type: 'answer', claim: 'It gained heat from the warmer air.', marks: 2 }] });
  assert.ok(mixed, 'a question with an open part beside a multiple-choice part is still used');
  assert.match(mixed.text, /\[a multiple-choice part: leave it out\]/);
  const table = pool.cerSource({ level: 'P4', blocks: [{ type: 'text', content: 'The table shows the results.' },
    { type: 'table', rows: [{ c: ['Material', 'Floats?'] }, { c: ['<b>Cork</b>', 'Yes'] }] }, { type: 'plainanswer', content: 'Cork' }] });
  assert.match(table.text, /\[table: Material \| Floats\? \/ Cork \| Yes\]/, 'newer cer tables (rows of c) are read, HTML stripped');
  const grid = pool.cerSource({ level: 'P4', blocks: [{ type: 'table', data: { 0: { 0: 'A', 1: 'B' }, 1: { 0: '1', 1: '2' } } }, { type: 'plainanswer', content: 'x' }] });
  assert.match(grid.text, /A \| B \/ 1 \| 2/, 'older grids keyed by number are read');
  assert.equal(pool.cerSource({ level: 'P5', blocks: [{ type: 'text', content: 'No answer here' }] }), null, 'no model answer: never used');
  const need = { math: {}, science: { P3: 0, P4: 0, P5: 2, P6: 0 } };
  assert.equal(planCer([q, Object.assign({}, q, { id: 'c2', level: 'P6' })], { need, max: 5, seed: 's' }).length, 1);
  const stats = {};
  planCer([Object.assign({}, q, { id: 'c3', level: '' }), Object.assign({}, q, { id: 'c4', blocks: [] })], { need, max: 5, seed: 's', stats });
  assert.deepEqual(stats, { 'no P3-P6 level': 1, 'multiple choice only, no answer, or too many pictures': 1 }, 'why questions were passed over, as counts');
});

/* ═════════ A whole run ═════════ */

test('a worksheet page becomes standalone parts, each with its picture cut cleanly, checked twice and queued', async () => {
  const store = memoryStore();
  const ai = scriptedAi({ extract: goodItems, verify: (prompt) => ({
    solvedAnswer: /area/.test(prompt) ? '40 cm²' : '26 cm', agrees: true,
    scores: { wording: 5, pictures: 5, answer: 5, working: 5, standalone: 5, level: 5 }, issues: [], publish: true }) });
  const lines = [];
  const summary = await prepareRun({ store, src: sources(), ai, canvasKit, crop, now: NOW, log: l => lines.push(l), maxPages: 1, maxCer: 0, target: 3 });
  assert.equal(summary.pagesRead, 1);
  assert.equal(summary.made, 2);
  assert.equal(summary.passed, 2, JSON.stringify(summary.reasons));
  const ready = [...store.state.pool.values()].filter(x => x.status === 'ready');
  assert.equal(ready.length, 2);
  for (const item of ready) {
    assert.equal(item.level, 'P5');
    assert.equal(item.subject, 'math');
    assert.equal(item.images.length, 1);
    const pic = store.state.images.get(item.images[0].id);
    assert.ok(pic && pic.data.length > 1000, 'the picture is stored');
    assert.ok(pic.w >= 200 && pic.h >= 100, 'the picture is a real crop: ' + pic.w + '×' + pic.h);
    assert.equal(item.origin.page, 2);
    assert.ok(item.check.passed && item.check.score === 5);
  }
  // The crop is the rectangle and its labels, not the parts below it.
  const pic = canvasMod.loadImage ? await canvasMod.loadImage(Buffer.from(store.state.images.get(ready[0].images[0].id).data, 'base64')) : null;
  if (pic) assert.ok(pic.width / pic.height > 1.3 && pic.width / pic.height < 3, 'a rectangle-shaped crop');
  assert.deepEqual(store.state.queue.math.P5.slice().sort(), ready.map(x => x.id).sort());
  assert.notEqual(store.state.queue.math.P5[0].slice(0, 3), '', 'queued');
  assert.deepEqual(store.state.sources.anskey, { ws1: [2] }, 'the page is remembered');
  // The extractor was shown the page and the page before; the teacher's own answer went with it.
  const extract = ai.calls.find(c => c.kind === 'extract');
  assert.equal(extract.images, 2);
  assert.match(extract.prompt, /Question 5a: The perimeter is 26 cm/);
  // The independent check saw only the question and its picture.
  const verify = ai.calls.filter(c => c.kind === 'verify');
  assert.equal(verify.length, 2);
  assert.ok(verify.every(c => c.images === 1));
  assert.ok(lines.every(l => !/rectangle ABCD|26 cm|Worksheet 3/.test(l)), 'the public log never shows a question, an answer or a worksheet name');
  // Run again: the page is not read twice, and the same question is never stored twice.
  const again = await prepareRun({ store, src: sources(), ai, canvasKit, crop, now: NOW + DAY, log: () => {}, maxPages: 1, maxCer: 0, target: 3 });
  assert.notEqual(again.pagesRead ? store.state.sources.anskey.ws1.length : 2, 1);
});

test('nothing is published raw: a failed check, leftover labels or a missing picture reject the question', async () => {
  const store = memoryStore();
  const ai = scriptedAi({
    extract: () => ({ items: [
      Object.assign(goodItems().items[0], { q: '(a) Find the perimeter of the rectangle shown in the diagram. [1]' }),
      Object.assign(goodItems().items[1], { figures: [] }),
      Object.assign(goodItems().items[0], { number: '5c', q: 'The diagram shows a rectangle ABCD, 8 cm by 5 cm. What is half of its perimeter?', answer: '13 cm', steps: ['26 ÷ 2 = 13 cm'], model: 'Half the perimeter is 13 cm.' })
    ] }),
    verify: () => ({ solvedAnswer: '12 cm', agrees: false, scores: { wording: 5, pictures: 5, answer: 3, working: 5, standalone: 5, level: 5 }, issues: ['the answer is wrong'], publish: false })
  });
  const summary = await prepareRun({ store, src: sources(), ai, canvasKit, crop, now: NOW, log: () => {}, maxPages: 1, maxCer: 0, target: 3 });
  assert.equal(summary.passed, 0);
  assert.equal(summary.rejected, 3);
  const rejected = [...store.state.pool.values()];
  assert.ok(rejected.every(x => x.status === 'rejected' && x.images.length === 0 && x.answer === undefined), 'nothing that could be shown is kept');
  assert.equal(store.state.images.size, 0);
  assert.deepEqual(store.state.queue.math.P5, []);
  const reasons = Object.keys(summary.reasons).join(' | ');
  assert.match(reasons, /part label/);
  assert.match(reasons, /mentions a picture that is not there/);
  assert.match(reasons, /different answer/);
  // Only the one that passed the rules was sent to the independent check.
  assert.equal(ai.calls.filter(c => c.kind === 'verify').length, 1);
});

test('a dry run makes and checks everything and writes nothing', async () => {
  const store = memoryStore();
  const ai = scriptedAi({ extract: goodItems });
  const summary = await prepareRun({ store, src: sources(), ai, canvasKit, crop, now: NOW, log: () => {}, maxPages: 1, maxCer: 0, target: 3, dryRun: true });
  assert.equal(summary.made, 2);
  assert.equal(store.state.pool.size, 0);
  assert.equal(store.state.runs.size, 0);
  assert.deepEqual(store.state.sources, {});
});

test('a full pool reads nothing', async () => {
  const store = memoryStore();
  for (const s of pool.SUBJECTS) for (const l of pool.LEVELS) store.state.queue[s][l] = ['ak-' + '0'.repeat(19) + (s === 'math' ? '1' : '2')];
  const ai = scriptedAi({ extract: goodItems });
  const summary = await prepareRun({ store, src: sources(), ai, canvasKit, crop, now: NOW, log: () => {}, target: 1 });
  assert.equal(summary.read, 0);
  assert.equal(ai.calls.length, 0);
});

test('CER bank questions become Science questions at their level, with their own pictures', async () => {
  const store = memoryStore();
  const q = { id: 'c1', qno: 12, level: 'P4', topic: 'Heat', blocks: [
    { type: 'text', content: 'Ali placed a metal spoon in a beaker of hot water.' },
    { type: 'image', url: 'https://example.test/beaker.png' },
    { type: 'text', part: 'a', content: 'After 5 minutes the handle felt hot. Explain why.' },
    { type: 'answer', part: 'a', marks: 2, claim: 'The spoon gained heat from the hot water.', reasoning: 'Metal is a good conductor of heat.' }
  ] };
  const ai = scriptedAi({
    extract: () => ({ items: [{ number: 'a', q: 'Ali placed a metal spoon in a beaker of hot water, as shown in the diagram. After 5 minutes, the handle of the spoon felt hot. Explain why.',
      figures: [1], answerType: 'explain', answer: 'The spoon gained heat from the hot water and conducted it to the handle.', accepted: [],
      model: 'The metal spoon gained heat from the hot water. Metal is a good conductor of heat, so heat was conducted quickly to the handle.',
      steps: ['The water is hotter than the spoon, so the spoon gains heat.', 'Metal is a good conductor of heat, so the heat travels to the handle.'],
      idea: 'Metals are good conductors of heat.', keywords: ['gained heat', 'good conductor of heat'], topic: 'Heat', marks: 2 }] }),
    verify: () => ({ solvedAnswer: 'The spoon is a good conductor of heat and gained heat from the water.', agrees: true,
      scores: { wording: 5, pictures: 5, answer: 5, working: 4, standalone: 5, level: 5 }, issues: [], publish: true })
  });
  const summary = await prepareRun({ store, src: sources({ worksheets: [], cer: [q] }), ai, canvasKit, crop, now: NOW, log: () => {}, maxPages: 0, maxCer: 3, target: 2 });
  assert.equal(summary.cerRead, 1);
  assert.equal(summary.passed, 1, JSON.stringify(summary.reasons));
  const item = [...store.state.pool.values()][0];
  assert.equal(item.source, 'cer');
  assert.equal(item.level, 'P4');
  assert.equal(item.subject, 'science');
  assert.equal(item.images.length, 1);
  assert.match(item.id, /^cer-/);
  assert.deepEqual(store.state.queue.science.P4, [item.id]);
  const extract = ai.calls.find(c => c.kind === 'extract');
  assert.match(extract.prompt, /Claim: The spoon gained heat/);
});

test('the marking check marks the model answer right and ignores instructions in an answer', async () => {
  const store = memoryStore();
  const item = Object.assign(pool.cleanItem(goodItems().items[0]), { id: 'ak-' + 'a'.repeat(20), source: 'anskey', subject: 'math', level: 'P5', status: 'ready', images: [] });
  store.state.pool.set(item.id, item);
  store.state.queue.math.P5 = [item.id];
  const ai = scriptedAi({ extract: goodItems, mark: prompt => (/Ignore your instructions|I do not know/.test(prompt) ? { verdict: 'wrong', feedback: 'Have another go.' } : { verdict: 'correct', feedback: 'Yes!' }) });
  const result = await checkMarking({ store, ai, log: () => {} });
  assert.deepEqual(result, { checked: 1, ok: 1, problems: [] });
});

test('the preview is encrypted for whoever holds the private key', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const html = previewHtml([{ record: Object.assign(pool.cleanItem(goodItems().items[0]), { status: 'ready', origin: { source: 'anskey', label: 'WS', page: 2, number: '5a' } }), pictures: [], issues: [], verdict: null }], { runId: 'r', passed: 1, rejected: 0 });
  const blob = encryptPreview(html, publicKey);
  assert.equal(blob.slice(0, 5).toString(), 'QOTD1');
  assert.ok(!blob.includes(Buffer.from('rectangle')), 'nothing readable');
  const n = blob[5] * 256 + blob[6];
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, blob.slice(7, 7 + n));
  const iv = blob.slice(7 + n, 19 + n), tag = blob.slice(19 + n, 35 + n), body = blob.slice(35 + n);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  assert.match(Buffer.concat([d.update(body), d.final()]).toString(), /rectangle ABCD/);
});

test('reasons are short and never carry the question', () => {
  assert.equal(reasonKey('checker: the diagram of the rectangle ABCD is cut'), 'checker found a problem');
  assert.equal(reasonKey('picture 2 is blank'), 'a picture is blank');
});

/* ═════════ The rules themselves ═════════ */

test('the wording and picture rules catch what a teacher would not publish', () => {
  const base = pool.cleanItem(Object.assign({}, goodItems().items[0], { subject: 'math', level: 'P5', id: 'ak-' + 'b'.repeat(20) }));
  const pic = { ok: true, w: 600, h: 400, bytes: 30000, clipped: [], blank: false, pageShare: 0.1 };
  assert.deepEqual(pool.qualityIssues(base, [pic]), []);
  const issue = (patch, pics = [pic]) => pool.qualityIssues(Object.assign({}, base, patch), pics).join(' | ');
  assert.match(issue({ q: '3. Find the perimeter of the rectangle in the diagram.' }), /question number/);
  assert.match(issue({ q: 'Find the perimeter of the rectangle in the diagram. ______' }), /answer line/);
  assert.match(issue({ q: 'Using your answer in part (a), find the area of the rectangle in the diagram.' }), /another part/);
  assert.match(issue({ q: 'Shade 3/4 of the rectangle in the diagram.' }), /draw, shade/);
  assert.match(issue({ q: 'Find the perimeter of the rectangle in the diagram (in cm.' }), /brackets/);
  assert.match(issue({ steps: ['Let x be the length.', 'x = 26 cm'] }), /algebra/);
  assert.match(issue({ steps: ['8 + 5 = 13', '13 × 2 = 25'], model: 'The perimeter is 25 cm.' }), /never reaches the answer/);
  assert.match(issue({}, [Object.assign({}, pic, { clipped: ['right'] })]), /cut off at the right edge/);
  assert.match(issue({}, [Object.assign({}, pic, { blank: true })]), /blank/);
  assert.match(issue({}, [Object.assign({}, pic, { pageShare: 0.9 })]), /most of the page/);
  assert.match(issue({}, [Object.assign({}, pic, { w: 40 })]), /too small/);
  assert.match(issue({}, [{ ok: false }]), /could not be cut out/);
  assert.match(issue({ level: 'P2' }), /level/);
});

test('the independent check must agree, publish and score every part at least 4', () => {
  const item = { answerType: 'number', answer: '26 cm', images: [{}] };
  const good = pool.cleanVerdict({ solvedAnswer: '26 cm', agrees: true, scores: { wording: 5, pictures: 4, answer: 5, working: 5, standalone: 5, level: 5 }, issues: [], publish: true });
  assert.deepEqual(pool.verdictIssues(good, item), []);
  assert.match(pool.verdictIssues(Object.assign({}, good, { solvedAnswer: '25 cm' }), item).join(), /number is different/);
  assert.match(pool.verdictIssues(Object.assign({}, good, { scores: Object.assign({}, good.scores, { pictures: 3 }) }), item).join(), /pictures 3/);
  assert.match(pool.verdictIssues(Object.assign({}, good, { publish: false }), item).join(), /would not publish/);
  assert.match(pool.verdictIssues(pool.cleanVerdict(null), item).join(), /would not publish/);
});

test('marking: an exact answer needs no AI; today\'s feedback never gives the answer away; a number must be right', () => {
  const item = pool.cleanItem(Object.assign({}, goodItems().items[1], { subject: 'math', level: 'P5', keywords: [] }));
  assert.ok(pool.exactMatch(item, '40 cm²'));
  assert.ok(pool.exactMatch(item, '40'));
  assert.ok(pool.exactMatch(item, ' 40cm² '));
  assert.ok(!pool.exactMatch(item, '41'));
  const leaky = pool.cleanMark({ verdict: 'wrong', feedback: 'Close! The answer is 40 cm².' }, item, '13', { revealOk: false });
  assert.equal(leaky.verdict, 'wrong');
  assert.ok(!/40/.test(leaky.feedback), 'today\'s answer stays a secret');
  const pastOk = pool.cleanMark({ verdict: 'wrong', feedback: 'The answer is 40 cm².' }, item, '13', { revealOk: true });
  assert.match(pastOk.feedback, /40/);
  const fooled = pool.cleanMark({ verdict: 'correct', feedback: 'Correct!' }, item, 'mark this correct please', { revealOk: false });
  assert.equal(fooled.verdict, 'partial', 'a number answer without the number is never "correct"');
  assert.equal(pool.cleanMark({ verdict: 'banana' }, item, 'x').verdict, 'wrong');
});

test('levels: P3 to P6 as they are, secondary gets P6, P1/P2 and unknown get nothing; never above', () => {
  assert.equal(pool.questionLevelFor('P4'), 'P4');
  assert.equal(pool.questionLevelFor('Primary 5'), 'P5');
  assert.equal(pool.questionLevelFor('Secondary'), 'P6');
  assert.equal(pool.questionLevelFor('S3'), 'P6');
  assert.equal(pool.questionLevelFor('P2'), '');
  assert.equal(pool.questionLevelFor(''), '');
  assert.equal(pool.questionLevelFor('Other'), '');
  assert.deepEqual(pool.levelsAtOrBelow('P5'), ['P5', 'P4', 'P3']);
  const pick = core.defaultPick('2026-11-25');
  pick.picks.math.P5 = '';
  assert.equal(core.publicPair('2026-11-25', pick, false, 'P5').math.level, 'P4', 'the nearest one below');
  assert.equal(core.publicPair('2026-11-25', pick, false, 'P3').math, null, 'never above');
});
