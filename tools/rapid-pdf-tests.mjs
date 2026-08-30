// Regression tests for ⚡ RAPID ADD TAKING PDFs — a PDF is EXPLODED INTO PAGES.
// Run with:
//     node tools/rapid-pdf-tests.mjs            all cases
//     node tools/rapid-pdf-tests.mjs <name>     one case
//
// It loads the REAL block out of app.js — rapidAddFiles, startRapidJob, the
// PDF queue and the page expander — and runs it against a fake pdf.js. Every
// failure this catches is SILENT: the pad still opens, files still queue,
// questions still land in vetting, and something is quietly wrong.
//
//  • A PDF SENT WHOLE still reads. It comes back with the wording of some of
//    the questions, no figure anywhere (there is no single page to measure a
//    rectangle on), and the tail of a long paper simply missing — a reply that
//    ran out of room does not error, it TRUNCATES.
//  • THE BATCH LEVEL read inside the render loop instead of at queue time
//    files the back half of a P3 paper at P4, the moment the author moves the
//    picker on while the pages are still rendering. Both halves look right.
//  • A PAGE CAP that stops counting leaves a 400-page book queueing four
//    hundred AI calls from one drop.
//  • A BLANK PAGE treated as a failure puts a red card on every cover sheet
//    and instruction page in the paper, and a wall of red cards is what makes
//    the one real red card get clicked past.
//  • TWO PDFs RENDERED AT ONCE is a canvas per page of both of them, held in
//    memory, on a school Chromebook.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

// Everything the block reaches for. The point of the harness is the ROUTING
// and the BOOK-KEEPING, so the AI read, the DOM and pdf.js itself are stubs —
// but `startRapidJob` and the expander are the app's own.
const FIXTURE = `
let rapidJobs = [];
let _rapidSeq = 0;
const RAPID_MAX_BYTES = 18 * 1024 * 1024;
const PDF_PAGE_MAX_SIDE = 2000;
const LOG = { toasts: [], status: [], read: [] };
let LEVEL = '';
function rapidLevel() { return LEVEL; }
function showToast(m, k) { LOG.toasts.push({ m, k }); }
function _setRapidStatus(m) { LOG.status.push(m); }
function _updateRapidCounts() {}
function renderVettingList() {}
function _setRapidJobState(id, patch) { const j = rapidJobs.find(x => x.id === id); if (j) Object.assign(j, patch); }
function _removeRapidJob(id) { rapidJobs = rapidJobs.filter(j => j.id !== id); }
function _failRapidJob(id, err) {
  const j = rapidJobs.find(x => x.id === id);
  if (j) { j.status = 'error'; j.error = (err && err.message) || String(err); }
}
function _dataUrlToBlob() { return new Blob(['x'], { type: 'image/jpeg' }); }
async function _rapidPrepFile(f) { return f; }
// The fake reader. Each page is answered from PAGES, keyed by the page number
// carried in the job's source line, so a test can make page 2 blank and page 3
// throw and still know which is which.
let PAGES = {};
let LIVE = 0, PEAK = 0;
async function processRapidJob(jobId, file, batchLevel, opts) {
  const o = opts || {};
  LIVE++; PEAK = Math.max(PEAK, LIVE);
  // Two ticks of real asynchrony, so an expander that fired every page at once
  // would really have them all in flight here at the same moment.
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  LIVE--;
  const m = /page (\\d+) of/.exec(o.source || '');
  const p = m ? Number(m[1]) : 0;
  LOG.read.push({ page: p, level: batchLevel, source: o.source || '', blankOk: !!o.blankOk, name: file && file.name });
  const answer = PAGES[p] === undefined ? 1 : PAGES[p];
  if (answer === 'throw') { _failRapidJob(jobId, new Error('unreadable')); return undefined; }
  if (answer === 0) {
    if (!o.blankOk) { _failRapidJob(jobId, new Error('the AI returned nothing readable')); return undefined; }
    _removeRapidJob(jobId);
    return { blank: true };
  }
  _removeRapidJob(jobId);
  return { added: answer };
}
// pdf.js, faked. NUMPAGES is what the "document" claims; RENDERED records the
// order pages were rasterised in.
let NUMPAGES = 3;
const RENDERED = [];
let DESTROYED = 0;
async function _loadPdfJs() {
  return {
    getDocument() {
      return { promise: Promise.resolve({
        numPages: NUMPAGES,
        async getPage(p) { return { cleanup() {} , _p: p }; },
        destroy() { DESTROYED++; }
      }) };
    }
  };
}
async function _pdfRenderPage(page) { RENDERED.push(page._p); return { mimeType: 'image/jpeg', data: 'AAAA' }; }
function pdfFile(name, bytes) {
  const f = new File([new Uint8Array(bytes || 8)], name, { type: 'application/pdf' });
  return f;
}
function imgFile(name) { return new File([new Uint8Array(4)], name, { type: 'image/png' }); }
function reset() {
  rapidJobs = []; _rapidSeq = 0; LOG.toasts = []; LOG.status = []; LOG.read = [];
  PAGES = {}; NUMPAGES = 3; RENDERED.length = 0; DESTROYED = 0; LEVEL = ''; LIVE = 0; PEAK = 0;
  _rapidPdfQueue = []; _rapidPdfBusy = false;
}
`;

const section = [
  cut('const RAPID_PDF_MAX_PAGES', '\nasync function processRapidJob(', 'rapid pdf block'),
  FIXTURE
].join('\n');

const M = new Function(section + `
return {
  rapidAddFiles, startRapidJob, _rapidExpandPdf, _rapidPageFile,
  RAPID_PDF_MAX_PAGES, RAPID_PDF_PAR,
  LOG, RENDERED, reset,
  setLevel: v => { LEVEL = v; },
  setPages: v => { PAGES = v; },
  setNumPages: n => { NUMPAGES = n; },
  jobs: () => rapidJobs,
  destroyed: () => DESTROYED,
  queueLen: () => _rapidPdfQueue.length,
  peak: () => PEAK,
  pdfFile, imgFile,
  idle: () => new Promise(r => setTimeout(r, 0))
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};
const settle = async () => { for (let i = 0; i < 200; i++) await new Promise(r => setTimeout(r, 0)); };

// ── the source itself: the shape that cannot be checked by running it ────────

test('a PDF is turned away from the model INSIDE startRapidJob', () => {
  // The door above it sorts files too, but the door is one caller. This is the
  // guard that a caller added next month cannot walk past — and walking past it
  // is not an error, it is a paper read with every figure missing.
  const body = cut('function startRapidJob(file, level, opts)', '\nasync function processRapidJob', 'startRapidJob');
  ok(/application\/pdf/.test(body), 'startRapidJob no longer recognises a PDF');
  ok(body.indexOf('_rapidQueuePdf') < body.indexOf('_rapidPrepFile'), 'a PDF reaches the reader before it is turned away');
});

test('every route into the pad goes through the ONE door', () => {
  for (const fn of ['rapidPickFiles', 'rapidPaste', 'rapidDrop']) {
    const body = cut('function ' + fn + '(', '\n}\n', fn);
    ok(/rapidAddFiles\(/.test(body), fn + ' does not hand its files to rapidAddFiles');
    ok(!/startRapidJob\(/.test(body), fn + ' queues a job itself — a route with its own pipeline is a route that drifts');
  }
});

test('the paste route reads FILES, not just image mime types', () => {
  // A PDF copied in Explorer or Finder arrives as kind "file". Matching on
  // `type.startsWith("image/")` alone makes "paste a pile of PDFs" a paste that
  // silently does nothing at all.
  const body = cut('function rapidPaste(e)', '\nfunction rapidDrop', 'rapidPaste');
  ok(/kind !== 'file'/.test(body) || /kind === 'file'/.test(body), 'rapidPaste does not look at the clipboard item kind');
  ok(/application\/pdf/.test(body), 'rapidPaste does not accept a pasted PDF');
});

test('a blank page is an outcome, not a failure', () => {
  const body = cut('async function processRapidJob(jobId, file, batchLevel, opts)', '\n// A failure must always leave', 'processRapidJob');
  ok(/o\.blankOk/.test(body), 'processRapidJob does not honour blankOk — every cover page becomes a red card');
  ok(/blank: true/.test(body), 'processRapidJob does not report a blank page back to the PDF feeder');
  ok(/return \{ added: added\.length \}/.test(body), 'processRapidJob does not report how many questions it added');
});

// ── the door ────────────────────────────────────────────────────────────────

test('the door captures the batch level ONCE for the whole drop', async () => {
  M.reset();
  M.setLevel('P3');
  M.rapidAddFiles([M.imgFile('a.png'), M.imgFile('b.png')], 'drop');
  M.setLevel('P4');                       // the author moves the picker on
  await settle();
  eq(M.LOG.read.map(r => r.level), ['P3', 'P3'], 'the level was re-read per file');
});

test('images and PDFs in one drop are both taken', async () => {
  M.reset();
  M.setNumPages(2);
  M.rapidAddFiles([M.imgFile('a.png'), M.pdfFile('paper.pdf')], 'drop');
  await settle();
  eq(M.LOG.read.filter(r => !r.source).length, 1, 'the image was not queued');
  eq(M.LOG.read.filter(r => r.source).length, 2, 'the PDF pages were not queued');
});

test('a file that is neither is refused, and says so', async () => {
  M.reset();
  const n = M.rapidAddFiles([new File([new Uint8Array(2)], 'notes.txt', { type: 'text/plain' })], 'drop');
  eq(n, 0, 'a text file was accepted');
  ok(M.LOG.toasts.length, 'nothing was said about the refused file');
  await settle();
});

// ── the expander ────────────────────────────────────────────────────────────

test('every page of the PDF is queued, in the paper\'s own order', async () => {
  M.reset();
  M.setNumPages(5);
  await M._rapidExpandPdf(M.pdfFile('paper.pdf'), '');
  await settle();
  eq(M.RENDERED, [1, 2, 3, 4, 5], 'the pages were not rendered in order');
  eq(M.LOG.read.map(r => r.page), [1, 2, 3, 4, 5], 'the pages were not read in order');
});

test('the batch level is carried to EVERY page', async () => {
  M.reset();
  M.setNumPages(4);
  await M._rapidExpandPdf(M.pdfFile('paper.pdf'), 'P5');
  await settle();
  eq(M.LOG.read.map(r => r.level), ['P5', 'P5', 'P5', 'P5'], 'a page landed at a different level from the rest of its paper');
});

test('every page is told a blank page is allowed', async () => {
  M.reset();
  M.setNumPages(3);
  await M._rapidExpandPdf(M.pdfFile('paper.pdf'), '');
  await settle();
  ok(M.LOG.read.every(r => r.blankOk), 'a PDF page would file a red card for having nothing on it');
});

test('a page names its paper and its page number', async () => {
  M.reset();
  M.setNumPages(2);
  await M._rapidExpandPdf(M.pdfFile('2023 SA2.pdf'), '');
  await settle();
  ok(/2023 SA2\.pdf/.test(M.LOG.read[0].source), 'the page does not name its paper');
  ok(/page 1 of 2/.test(M.LOG.read[0].source), 'the page does not name which page it is');
});

test('the page cap holds, and the author is told', async () => {
  M.reset();
  M.setNumPages(M.RAPID_PDF_MAX_PAGES + 25);
  await M._rapidExpandPdf(M.pdfFile('book.pdf'), '');
  await settle();
  eq(M.LOG.read.length, M.RAPID_PDF_MAX_PAGES, 'the page cap did not hold');
  ok(M.LOG.toasts.some(t => /pages/.test(t.m) && /first/.test(t.m)), 'the pages that were skipped were never mentioned');
});

test('no more than RAPID_PDF_PAR pages are ever in flight', async () => {
  // A page is an AI call. Forty of them fired at once is a rate limit, not a
  // fast import — and the failures it causes are read as "the PDF could not be
  // read" rather than "we asked for too much at once".
  M.reset();
  M.setNumPages(12);
  await M._rapidExpandPdf(M.pdfFile('paper.pdf'), '');
  await settle();
  eq(M.LOG.read.length, 12, 'not every page was read');
  ok(M.peak() <= M.RAPID_PDF_PAR, 'pages in flight peaked at ' + M.peak() + ', over the cap of ' + M.RAPID_PDF_PAR);
  ok(M.RAPID_PDF_PAR >= 1 && M.RAPID_PDF_PAR <= 4, 'RAPID_PDF_PAR is outside anything a school connection would survive');
});

test('a blank page, a failed page and a good page are told apart', async () => {
  M.reset();
  M.setNumPages(4);
  M.setPages({ 1: 0, 2: 3, 3: 'throw', 4: 1 });     // cover, 3 questions, unreadable, 1 question
  await M._rapidExpandPdf(M.pdfFile('paper.pdf'), '');
  await settle();
  const summary = M.LOG.status[M.LOG.status.length - 1] || '';
  ok(/4 questions/.test(summary), 'the question count is wrong: ' + summary);
  ok(/1 page had no questions/.test(summary), 'the blank page was not reported: ' + summary);
  ok(/1 page could not be read/.test(summary), 'the failed page was not reported: ' + summary);
  eq(M.jobs().filter(j => j.status === 'error').length, 1, 'a blank page left a red card behind');
});

test('the PDF job card is taken down when the paper is done', async () => {
  M.reset();
  M.setNumPages(2);
  await M._rapidExpandPdf(M.pdfFile('paper.pdf'), '');
  await settle();
  eq(M.jobs().length, 0, 'a spinner was left on screen after the paper finished');
  eq(M.destroyed(), 1, 'the PDF document was never released');
});

test('a PDF that cannot be opened leaves ONE red card, not silence', async () => {
  M.reset();
  M.setNumPages(0);
  await M._rapidExpandPdf(M.pdfFile('broken.pdf'), '');
  await settle();
  eq(M.jobs().filter(j => j.status === 'error').length, 1, 'an unopenable PDF vanished without a card');
});

test('two PDFs are rendered one at a time', async () => {
  M.reset();
  M.setNumPages(2);
  M.rapidAddFiles([M.pdfFile('a.pdf'), M.pdfFile('b.pdf')], 'drop');
  // One is in flight, the other is waiting its turn.
  eq(M.queueLen(), 1, 'both PDFs started rendering at once');
  await settle();
  eq(M.LOG.read.length, 4, 'the second PDF never ran');
});

test('a page file carries the paper and the page in its NAME', () => {
  const f = M._rapidPageFile({ mimeType: 'image/jpeg', data: 'AAAA' }, '2023 CA1.pdf', 7);
  ok(/2023 CA1/.test(f.name || ''), 'the page file does not name its paper');
  ok(/7/.test(f.name || ''), 'the page file does not name its page');
  ok(!/\.pdf/i.test(f.name || ''), 'the page file still calls itself a PDF');
});

// ── runner ───────────────────────────────────────────────────────────────────

const only = process.argv[2];
let passed = 0, failed = 0;
for (const c of cases) {
  if (only && c.name !== only) continue;
  try { await c.fn(); console.log('  ok   ' + c.name); passed++; }
  catch (err) { console.log('  FAIL ' + c.name + '\n         ' + err.message); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
