// 🎮 Quest frames in a REAL browser, printed to PDF with background graphics OFF:
//   • the portal: a framed worksheet through the SHIPPED planner, printer and
//     live preview (cut out of app.js), with index.html's own print CSS. Every
//     question sheet a quest page — start, trail, finale — whose wall runs to
//     the paper's edge in the rasterised PDF, with nothing under a band; the
//     answer key plain; the preview showing the same sheets; one PDF page per
//     sheet; every sprite fetched from this site (needs pdftoppm);
//   • the Maths and Science creators: their own print CSS and question markup,
//     one Quest page per question, an over-tall question falling back to the
//     old flowing print instead of being clipped;
//   • the switch, in the real toggle markup of all three pages: hidden until
//     the page names the teacher, never shown to a student, unticked on every
//     hand-over, and not remembered across a reload.
// Run: node tools/quest-frames-browser-check.mjs
// (WORKSHEET_PLAYWRIGHT_MODULE / WORKSHEET_BROWSER_EXECUTABLE as for the cover checks.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'test-results', 'quest-frames');
fs.mkdirSync(out, { recursive: true });
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const modulePath = process.env.WORKSHEET_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || process.env.PW;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');

// A complete function out of a page's source (the creators are partly minified).
function fn(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Missing shipped function ${name}`);
  let end = source.indexOf('}', match.index);
  while (end !== -1) {
    const candidate = source.slice(match.index, end + 1);
    try { new vm.Script(`(${candidate})`); return candidate; } catch { end = source.indexOf('}', end + 1); }
  }
  throw new Error(`Unterminated function ${name}`);
}
const styleOf = (html) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');

const INDEX = read('index.html');
const APP = read('app.js');

// The portal's REAL print path, cut out of app.js: the planner, the printer and
// the live preview's packer, with only the progress bar, window.print() and the
// preview's editing tools stubbed. A top-level function, found by its name.
function topFn(source, name) {
  const match = new RegExp(`\\n(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Missing shipped function ${name}`);
  const at = match.index + 1;
  let end = source.indexOf('}', at);
  while (end !== -1) {
    const candidate = source.slice(at, end + 1);
    try { new vm.Script(`(${candidate})`); return candidate; } catch { end = source.indexOf('}', end + 1); }
  }
  throw new Error(`Unterminated function ${name}`);
}
function topConst(source, name) {
  const m = new RegExp(`\\nconst ${name} = (?:\`[\\s\\S]*?\`|[^\\n]*);`).exec(source);
  assert.ok(m, `Missing shipped const ${name}`);
  return m[0].trim();
}
const PRINT_PATH = ['doScaleAndPrint', '_printLearnImgDims', '_printStampImgDims', '_printFlowFallback', '_printPlanPages',
  '_printFontLinksHtml', '_wsAppCssForPreview', '_wsPreviewWhenReady', '_printPlanIn', '_printPagePxFor', '_printSetContentZoom',
  '_printFooterHeightIn', '_printNumberHeightIn', '_printSeparatorHeightIn', '_classifyPrintChunks', 'packChunkIndices',
  '_printVerifiedZoom', '_printPlanAkPages', '_packAkRows', '_printAkPageEl', '_akPageTitle', '_printFrontPlacement', '_printFrontAnchor',
  '_printFrontRestarts', '_createPrintPageFooter', '_printApplyZoom', '_printStampPlanHeight', '_printApplyPageNumbers',
  '_printPadTallPage', '_printWrapPageContent', '_wsWritePreview', '_wsPreviewPack'];
const PRINT_CONSTS = ['_printImgNatural', 'PRINT_ZOOM_FLOOR', 'PRINT_FIT_SAFETY', 'PRINT_GENTLE_ZOOM', 'PRINT_PAGE_RESERVE', 'A4_CONTENT_PX', 'PRINT_PAGE_PX', 'WS_PREVIEW_CSS'];
const kitJs = [
  ...PRINT_CONSTS.map((n) => topConst(APP, n)),
  ...PRINT_PATH.map((n) => topFn(APP, n)),
  'function _printProgressShow() {} function _printProgressUpdate() {} function _printProgressHide() {}',
  'function _printAndRestore(output) { window.__printed = (window.__printed || 0) + 1; if (window.__onPrint) window.__onPrint(output); }',
  'const wsManualBreaks = new Set(), wsMergeUp = new Set(); let _wsPreviewSaved = null;',
  'function _canAuthor() { return false; } function _wsPreviewIsDraft() { return false; } function pvsDecorateDoc() {} function pvoDecorateDoc() {}',
  'window.doScaleAndPrint = doScaleAndPrint; window._wsWritePreview = _wsWritePreview;'
].join('\n');
const portalFixture = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/quest-frames.css">
<style>${styleOf(INDEX)}</style>
<script src="/quest-frames.js"></script></head>
<body><div id="printOutput"></div><iframe id="pv" style="width:900px;height:900px;border:0"></iframe><script src="/kit.js"></script></body></html>`;

// Each page's own Quest frame toggle, cut out of the page exactly as shipped.
function labelOf(html, marker) {
  const m = new RegExp('<label\\b[^>]*>\\s*<input[^>]*' + marker + '[\\s\\S]*?<\\/label>').exec(html);
  assert.ok(m, 'missing the Quest frame toggle ' + marker);
  return m[0];
}
const MATH_PAGE = read('math-worksheet.html');
const SCIENCE_PAGE = read('science-worksheet.html');
const togglesFixture = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/quest-frames.css">
<style>${styleOf(INDEX)}</style>
<script src="/quest-frames.js"></script></head>
<body><div id="toggles">${labelOf(INDEX, 'id="wsQuestFrame"')}${labelOf(INDEX, 'id="mwQuestFrame"')}${labelOf(MATH_PAGE, 'data-quest-frame-toggle')}${labelOf(SCIENCE_PAGE, 'data-quest-frame-toggle')}</div></body></html>`;

const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.html': 'text/html' };
const served = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/portal') { res.setHeader('Content-Type', 'text/html'); res.end(portalFixture); return; }
  if (url.pathname === '/kit.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(kitJs); return; }
  if (url.pathname === '/toggles') { res.setHeader('Content-Type', 'text/html'); res.end(togglesFixture); return; }
  if (url.pathname === '/blank') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><script src="/worksheet-art.js"></script><script src="/quest-frames.js"></script></head><body></body></html>'); return; }
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  served.push(url.pathname);
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.WORKSHEET_BROWSER_EXECUTABLE || process.env.CHROME_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;

try {
  // ------------------------------------------------------------------ switch
  {
    const tp = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const terr = [];
    tp.on('pageerror', (e) => terr.push(e.message));
    await tp.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    await tp.goto(origin + '/toggles');
    await tp.waitForFunction(() => window.QuestFramesCer);
    const shown = () => tp.evaluate(() => [...document.querySelectorAll('#toggles label')].map((l) => getComputedStyle(l).display));
    const ticks = () => tp.evaluate(() => [...document.querySelectorAll('#toggles input')].map((i) => i.checked));
    const on = () => tp.evaluate(() => window.QuestFramesCer.on());
    const as = (role, who) => tp.evaluate(([r, w]) => {
      window.__role = r;
      window.QuestFramesCer.teacher(() => window.__role === 'admin');
      window.QuestFramesCer.roleChanged(w);
    }, [role, who]);
    assert.equal(await tp.locator('#toggles label').count(), 4, 'the portal\'s two toggles and one in each creator');
    assert.deepEqual(await shown(), ['none', 'none', 'none', 'none'], 'hidden before the page names the teacher');
    await as('student', 'kid:student');
    assert.deepEqual(await shown(), ['none', 'none', 'none', 'none'], 'a student never sees a toggle');
    await as('employee', 'writer:employee');
    assert.deepEqual(await shown(), ['none', 'none', 'none', 'none'], 'nor an employee');
    await as('admin', 'teacher:admin');
    assert.ok((await shown()).every((d) => d !== 'none'), 'the teacher sees every toggle');
    assert.deepEqual(await tp.evaluate(() => [...document.querySelectorAll('#toggles label')].map((l) => l.style.display)), ['flex', '', '', ''],
      'each given back the inline display its page drew it with (the builder\'s label lays itself out with an inline flex)');
    assert.deepEqual(await ticks(), [false, false, false, false], 'unticked on arrival');
    assert.equal(await on(), false);
    await tp.locator('#wsQuestFrame').click();
    assert.equal(await on(), true, 'a real click ticks it');
    assert.deepEqual(await ticks(), [true, true, true, true], 'every toggle follows');
    await as('admin', 'teacher:admin');
    assert.equal(await on(), true, 'redrawn for the same teacher, the tick stays');
    await as('student', 'kid:student');
    assert.equal(await on(), false, 'handed to a student: off');
    assert.deepEqual(await shown(), ['none', 'none', 'none', 'none'], 'and hidden');
    assert.deepEqual(await ticks(), [false, false, false, false], 'and unticked');
    await as('admin', 'teacher:admin');
    assert.equal(await on(), false, 'back to the teacher: still unticked');
    await tp.locator('#mwQuestFrame').click();
    assert.equal(await on(), true);
    await tp.reload();
    await tp.waitForFunction(() => window.QuestFramesCer);
    await as('admin', 'teacher:admin');
    assert.equal(await on(), false, 'never remembered: a reload starts unticked');
    assert.deepEqual(await ticks(), [false, false, false, false]);
    assert.equal(await tp.evaluate(() => localStorage.length + sessionStorage.length), 0, 'nothing was stored');
    assert.deepEqual(terr, []);
    await tp.close();
    console.log('PASS switch: hidden for students, employees and an unnamed teacher; unticked on arrival, on hand-over and after a reload');
  }

  // ------------------------------------------------------------------ portal
  // The SHIPPED print path, not a hand-built imitation of it: the planner, the
  // printer and the preview packer out of app.js (kit.js), on a framed
  // worksheet. v1.444.0 passed a hand-built check here and printed every
  // framed sheet shrunk inside the old margins — only the PDF can say that.
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const failed = [], errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/print plan|preview plan|quest frame/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin)) failed.push(r.url()); });
  await page.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
  await page.goto(origin + '/portal');
  await page.waitForFunction(() => window.QuestFramesCer && window.QuestFrames && window.doScaleAndPrint && window._wsWritePreview);

  // A Science worksheet as buildWorksheetHtml shapes it: page 1's lead in the
  // first chunk, a gem on every "Question N", MCQs flagged, and the key.
  const printWorksheet = (variant) => page.evaluate(async (variant) => {
    const QC = window.QuestFramesCer;
    const QS = [
      [2, variant === 'zoom' ? 25 : 4, 'Ali placed a metal spoon and a wooden spoon in the same cup of hot water. After two minutes, the handle of the metal spoon felt hotter. Explain why.'],
      [1, 0, 'Which one of the following is a good conductor of heat?'],
      [3, 5, 'Siti wrapped a can of cold drink in newspaper and left an identical can unwrapped. (a) Which stayed cold for longer? (b) Explain in terms of heat flow.'],
      [1, 0, 'A cup of hot tea is left in a room at 28°C. What will its temperature be after a long time?'],
      [4, 6, 'Ben heated four rods made of different materials at one end. Suggest two variables he must keep the same, and explain what his results show.'],
      [5, 6, 'Mei filled a glass with ice. Water droplets formed on the outside of the glass. Explain how, and state where the water came from.'],
      [2, 4, 'Explain why the handle of a cooking pot is usually made of plastic or wood.'],
      [1, 0, 'Which of these is NOT a source of heat?']
    ];
    const total = QS.reduce((t, x) => t + x[0], 0);
    const q = QC.ctx({ subject: 'science', title: 'P5 Heat and temperature', topics: ['Heat', 'Heat'], questions: QS.length, total });
    const lines = (n) => '<div class="print-open-cer-box">' + '<div style="border-bottom:1px solid #999;height:26px"></div>'.repeat(n) + '</div>';
    const options = '<div class="print-text-block">(1) Plastic&nbsp;&nbsp; (2) Wood&nbsp;&nbsp; (3) Copper&nbsp;&nbsp; (4) Air</div><div class="print-mcq-answer">Answer: (&nbsp;&nbsp;&nbsp;&nbsp;)</div>';
    const html = QS.map(([m, l, t], i) => '<div class="print-question-chunk" data-qid="q' + (i + 1) + '"' + (l ? '' : ' data-mcq="1"') + '>' +
      (i === 0 ? QC.portalLead(q, false, variant === 'nofields') : '') +
      '<div class="print-q-header print-q-header-plain qf-q-head">' + QC.gem(i + 1, m) + '<h2>Question ' + (i + 1) + '</h2></div>' +
      '<div class="print-text-block">' + t + '</div>' + (l ? lines(l) : options) + '</div>').join('') +
      '<div class="print-answer-key-page"><h2>Answer Key</h2>' + QS.map((x, i) => '<div class="print-ak-question" data-qid="q' + (i + 1) + '"><div class="print-ak-qhead">Question ' + (i + 1) + '</div><div>Answer ' + (i + 1) + '.</div></div>').join('') + '</div>';
    const output = document.getElementById('printOutput');
    output.innerHTML = html;
    window.__printed = 0;
    await new Promise((resolve) => { window.__onPrint = resolve; window.doScaleAndPrint(output, { forcedBreakIds: new Set(), mergeUpIds: new Set(), questFrame: q }); });
    output.style.cssText = '';
    await QC.ready(output, 15000);
    const sheets = [...output.children].map((p) => ({
      variant: ([...p.classList].find((c) => c.startsWith('qf-page--')) || '').replace('qf-page--', '') || (p.classList.contains('print-answer-key-page') ? 'key' : 'plain'),
      qids: [...p.querySelectorAll('.print-question-chunk')].map((c) => c.dataset.qid),
      zoom: (p.querySelector(':scope > .print-page-content') || { style: {} }).style.zoom || '',
      boss: !!p.querySelector('.qf-head .qf-boss .qf-sprite'),
      hearts: p.querySelectorAll('.qf-head .qf-heart').length,
      hero: !!p.querySelector('.qf-foot-hero .qf-sprite'),
      xp: (p.querySelector('.qf-xp .qf-counter') || {}).textContent || '',
      cheer: (p.querySelector('.qf-cheer-text') || {}).textContent || '',
      companion: !!p.querySelector('.qf-foot-companion .qf-sprite'),
      chest: (p.querySelector('.qf-chest .qf-score-total') || {}).textContent || '',
      herocard: !!p.querySelector('.qf-head .qf-herocard'),
      logo: !!p.querySelector('.qf-head .qf-logo'),
      wall: !!p.querySelector(':scope > .qf-frame-layer > svg.qf-border')
    }));
    // The same HTML through the live preview, as the teacher sees it.
    const frame = document.getElementById('pv');
    await new Promise((resolve, reject) => window._wsWritePreview(frame, html, { onReady: resolve, onError: () => reject(new Error('preview failed')) }));
    const preview = [...frame.contentDocument.querySelectorAll('#wsPages .wspv-sheet')].map((s) => ({
      variant: ([...s.classList].find((c) => c.startsWith('qf-page--')) || '').replace('qf-page--', '') || (s.querySelector('.print-ak-question') ? 'key' : 'plain'),
      qids: [...s.querySelectorAll('.print-question-chunk')].map((c) => c.dataset.qid)
    }));
    return { printed: window.__printed, sheets, preview, images: output.querySelectorAll('svg image').length, SHEET: QC.SHEET };
  }, variant);

  // Every framed sheet, laid out for print: the page it is on, the box the
  // questions really ended in, and every header and footer piece kept out of it.
  const sheetGeometry = () => page.evaluate(() => [...document.querySelectorAll('#printOutput > .qf-sheet')].map((p) => {
    const S = window.QuestFramesCer.SHEET;
    const a = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    const start = p.classList.contains('qf-page--start');
    const box = { top: a.top + parseFloat(cs.paddingTop) + (start ? S.startExtra : 0), bottom: a.bottom - parseFloat(cs.paddingBottom), left: a.left + parseFloat(cs.paddingLeft), right: a.right - parseFloat(cs.paddingRight) };
    const last = p.querySelector(':scope > .print-page-number') || p.querySelector(':scope > .print-page-footer');
    const firstQ = p.querySelector('.print-q-header');
    const pieces = [...p.querySelectorAll('.qf-head > span, .qf-foot > span')].map((el) => ({ name: el.className, r: el.getBoundingClientRect() }));
    const hits = pieces.filter(({ r }) => r.width && r.height && r.left < box.right - 1 && r.right > box.left + 1 && r.top < box.bottom - 1 && r.bottom > box.top + 1).map((x) => x.name);
    const lead = p.querySelector('.qf-print-lead--start');
    return {
      page: cs.page, width: a.width * 25.4 / 96, height: a.height * 25.4 / 96, start,
      overrun: last ? last.getBoundingClientRect().bottom - box.bottom : 0,
      firstQTop: firstQ ? firstQ.getBoundingClientRect().top - box.top : null,
      leadH: lead ? lead.getBoundingClientRect().height : null,
      hits
    };
  }));

  // The PDF, rasterised: where the ink really is on each sheet.
  const inkBoxes = (pdf, name) => {
    const dir = fs.mkdtempSync(path.join(out, 'raster-'));
    const file = path.join(dir, name + '.pdf');
    fs.writeFileSync(file, pdf);
    try { execFileSync('pdftoppm', ['-r', '40', '-gray', file, path.join(dir, 'p')]); }
    catch (e) { throw new Error('pdftoppm (poppler-utils) is needed to measure the printed sheets: ' + e.message); }
    const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.pgm')).sort((x, y) => parseInt(x.match(/(\d+)\.pgm$/)[1], 10) - parseInt(y.match(/(\d+)\.pgm$/)[1], 10));
    const boxes = pages.map((f) => {
      const buf = fs.readFileSync(path.join(dir, f));
      let at = 0;
      const token = () => { while (/\s/.test(String.fromCharCode(buf[at]))) at++; let t = ''; while (!/\s/.test(String.fromCharCode(buf[at]))) t += String.fromCharCode(buf[at++]); return t; };
      assert.equal(token(), 'P5');
      const w = +token(), h = +token(); token(); at++;
      let x0 = w, x1 = -1, y0 = h, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (buf[at + y * w + x] < 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const mm = 210 / w;
      return x1 < 0 ? null : { left: x0 * mm, right: (x1 + 1) * mm, top: y0 * mm, bottom: (y1 + 1) * mm };
    });
    fs.rmSync(dir, { recursive: true, force: true });
    return boxes;
  };

  // ---- a worksheet with the name fields, page 1 over-full (so it is shrunk)
  const run = await printWorksheet('zoom');
  assert.equal(run.printed, 1, 'printed once, through the planned path (never the flow fallback)');
  const variants = run.sheets.map((s) => s.variant);
  assert.equal(variants[0], 'start', 'page 1 is the START page');
  assert.equal(variants[variants.length - 1], 'key', 'the answer key comes last…');
  assert.equal(variants[variants.length - 2], 'finale', '…after the FINALE, the last question sheet');
  assert.ok(variants.slice(1, -2).every((v) => v === 'trail') && variants.length >= 5, 'every sheet between is the TRAIL: ' + variants.join(' '));
  const framedSheets = run.sheets.filter((s) => s.variant !== 'key');
  const n = framedSheets.length;
  framedSheets.forEach((s, i) => {
    const at = `sheet ${i + 1} (${s.variant})`;
    assert.ok(s.wall, at + ': the rampart');
    assert.ok(s.boss, at + ': the boss stands in the header');
    assert.equal(s.hearts, 8, at + ': one heart per question');
    assert.ok(s.hero, at + ': a hero stands on the wall');
    assert.equal(s.xp, `PAGE ${i + 1} / ${n}` + s.xp.slice(`PAGE ${i + 1} / ${n}`.length), at + ': the XP trail counts the quest\'s pages');
  });
  const [first] = framedSheets, last = framedSheets[n - 1];
  assert.ok(first.herocard && first.logo, 'page 1: the full banner with the logo, and the hero card (the name fields)');
  assert.equal(first.cheer, 'Your quest begins!');
  assert.ok(framedSheets.slice(1, -1).every((s) => s.companion && s.cheer && !s.herocard && !s.chest), 'the trail: a companion cheers, no hero card, no chest');
  assert.equal(last.chest, '/ 19', 'the finale: the treasure chest, scored out of the sheet\'s 19 marks');
  assert.ok(run.sheets.find((s) => s.variant === 'key') && !run.sheets.find((s) => s.variant === 'key').wall, 'the answer key prints plain');
  assert.ok(Number(first.zoom) > 0 && Number(first.zoom) < 1, 'page 1 was shrunk to fit (zoom ' + first.zoom + ')');
  assert.ok(run.images > 30, 'boss, heroes, companions, chest, runes and loot are all pictures');
  assert.deepEqual(run.preview, run.sheets.map(({ variant, qids }) => ({ variant, qids })), 'the live preview shows the very same sheets, dressed the same way');

  await page.emulateMedia({ media: 'print' });
  const geo = await sheetGeometry();
  geo.forEach((g, i) => {
    const at = `sheet ${i + 1}`;
    assert.equal(g.page, 'qf-sheet', at + ': on the margin-free page');
    assert.ok(Math.abs(g.width - 210) < 0.5 && Math.abs(g.height - 296) < 0.5, `${at}: a whole A4 sheet (${g.width.toFixed(1)} × ${g.height.toFixed(1)}mm)`);
    assert.ok(g.overrun <= 0.5, `${at}: the page number ends inside the box the planner planned (overrun ${g.overrun.toFixed(2)}px)`);
    assert.deepEqual(g.hits, [], at + ': no header or footer piece lies over the questions');
    assert.ok(g.firstQTop != null && g.firstQTop >= -0.5, at + ': the first question starts inside the box');
  });
  assert.ok(Math.abs(geo[0].leadH - run.SHEET.startExtra) < 0.6, `page 1 keeps the start header's full ${run.SHEET.startExtra}px although its questions are shrunk (got ${geo[0].leadH})`);
  const portalPdf = await page.pdf({ format: 'A4', printBackground: false, preferCSSPageSize: true });
  fs.writeFileSync(path.join(out, 'portal-framed.pdf'), portalPdf);
  assert.equal(pdfPages(portalPdf), run.sheets.length, `${run.sheets.length} sheets in, ${run.sheets.length} sheets out: no blank sheet after a framed page`);
  const ink = inkBoxes(portalPdf, 'portal');
  ink.forEach((b, i) => {
    const at = `printed page ${i + 1} (${variants[i]})`;
    assert.ok(b, at + ' is not blank');
    if (variants[i] === 'key') {
      assert.ok(b.left > 12 && b.top > 12, `${at}: the key keeps the ordinary margins (ink from ${b.left.toFixed(1)}mm, ${b.top.toFixed(1)}mm)`);
    } else {
      // THE v1.444.0 BUG: the named page lost to index.html's plain @page and the
      // sheet was shrunk inside the old margins — its wall started 18mm in.
      assert.ok(b.left < 6 && b.top < 6 && b.right > 204 && b.bottom > 290, `${at}: the wall runs to the edge of the paper (ink ${b.left.toFixed(1)}–${b.right.toFixed(1)} × ${b.top.toFixed(1)}–${b.bottom.toFixed(1)}mm)`);
    }
  });
  await page.emulateMedia({ media: 'screen' });

  // ---- the name fields off: page 1 is an ordinary trail page
  const plain = await printWorksheet('nofields');
  assert.equal(plain.sheets[0].variant, 'trail', 'without the name fields, page 1 is a trail page');
  assert.ok(!plain.sheets[0].herocard, 'with no hero card');
  assert.equal(plain.sheets[0].cheer, 'Your quest begins!', 'and the quest still begins there, not "almost at the treasure"');
  assert.deepEqual(plain.preview, plain.sheets.map(({ variant, qids }) => ({ variant, qids })), 'the preview agrees');
  await page.emulateMedia({ media: 'print' });
  (await sheetGeometry()).forEach((g, i) => {
    assert.ok(g.overrun <= 0.5 && !g.hits.length, `no fields, sheet ${i + 1}: inside its box and clear of the bands`);
  });
  await page.emulateMedia({ media: 'screen' });

  assert.deepEqual(failed, [], 'every sprite is on this site');
  assert.deepEqual(errors, []);
  console.log(`PASS portal (shipped planner, printer and preview): ${variants.join(' → ')}; wall to the paper's edge on every framed sheet, the key plain; nothing under a band`);

  // ---------------------------------------------------------------- creators
  for (const [subject, file] of [['math', 'math-worksheet.html'], ['science', 'science-worksheet.html']]) {
    const source = read(file);
    const names = ['getPrintCss', 'getEmbeddedPreviewCss', 'questionToPrintHtml', 'questionDisplayNumber', 'isInstruction'];
    if (/function\s+worksheetArtCss\s*\(/.test(source)) names.push('worksheetArtCss');
    const declarations = names.map((n) => fn(source, n)).join('\n');
    const cp = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    const cerr = [], cfail = [];
    cp.on('pageerror', (e) => cerr.push(e.message));
    cp.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin)) cfail.push(r.url()); });
    await cp.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    await cp.goto(origin + '/blank');
    await cp.waitForFunction(() => window.QuestFramesCer);
    const long = 'The quick brown fox jumps over the lazy dog. '.repeat(110);
    await cp.addScriptTag({ content: `const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const formatTextWithFractions=escapeHtml;const showSources=false;
      function elementToPrintHtml(el){return el.type==='lines'?'<div class="qf-test-lines">'+'<div style="border-bottom:1px solid #999;height:28px"></div>'.repeat(el.n)+'</div>':'<p>'+escapeHtml(el.text)+'</p>';}
      let state={title:'${subject === 'math' ? 'Fractions of a set' : 'Heat gain and loss'}',questions:[
        {kind:'instruction',elements:[{type:'text',text:'Answer all questions.'}]},
        {elements:[{type:'text',text:'Question one.'},{type:'lines',n:6}]},
        {elements:[{type:'text',text:'Question two.'},{type:'lines',n:5}]},
        {elements:[{type:'text',text:${JSON.stringify(long)}}]},
        {elements:[{type:'text',text:'Question four.'},{type:'lines',n:4}]}]};
      ${declarations}` });
    const built = await cp.evaluate((subject) => {
      const QC = window.QuestFramesCer;
      const isIns = (q) => isInstruction(q);
      const body = QC.creatorBody({ subject, title: state.title, topics: [], sections: state.questions.map((q, i) => ({ html: questionToPrintHtml(q, i), instruction: isIns(q) })) });
      document.open();
      document.write('<!doctype html><html><head><meta charset="utf-8">' + QC.printHead().replace(/<link href="https:\/\/fonts[^>]*>/, '') +
        '<style>' + getEmbeddedPreviewCss() + getPrintCss() + QC.creatorCss() + '</style></head><body><div class="print-doc">' + body + '</div><script>' + QC.printScript() + '<\/script></body></html>');
      document.close();
      return { pages: (body.match(/<section class="qf-page /g) || []).length };
    }, subject);
    await cp.waitForFunction(() => typeof window.qfReady === 'function');
    await cp.evaluate(async () => { await document.fonts.ready; await window.qfReady(); window.qfFixOverflow(); });
    const state = await cp.evaluate(() => ({
      overflow: [...document.querySelectorAll('.qf-page')].map((p) => p.classList.contains('qf-overflow')),
      gems: document.querySelectorAll('.qf-gem-slot .qf-gem-svg').length,
      instructionFirst: document.querySelector('.qf-page--start .qf-content').textContent.indexOf('Answer all questions.') >= 0
    }));
    assert.equal(built.pages, 4, `${subject}: one Quest page per question`);
    assert.deepEqual(state.overflow, [false, false, true, false], `${subject}: only the over-tall question falls back to the old flowing print`);
    assert.equal(state.gems, 4, `${subject}: every number is a gem`);
    assert.ok(state.instructionFirst, `${subject}: the instruction prints on the first question's page`);
    const pdf = await cp.pdf({ format: 'A4', printBackground: false, preferCSSPageSize: true });
    fs.writeFileSync(path.join(out, subject + '-creator-framed.pdf'), pdf);
    const n = pdfPages(pdf);
    assert.ok(n >= 5 && n <= 7, `${subject}: three framed pages + the long question's own sheets (got ${n})`);
    assert.deepEqual(cfail, [], `${subject}: every sprite is on this site`);
    assert.deepEqual(cerr, [], `${subject}: no errors`);
    await cp.close();
    console.log(`PASS ${subject} creator: 4 Quest pages, gems, the instruction on page 1, the over-tall question unframed (${n} PDF pages)`);
  }
  assert.ok(served.some((p) => p.startsWith('/assets/quest-frames/')), 'the Wheel Quest copies were used');
  console.log('PDFs: ' + out);
} finally {
  await browser.close();
  server.close();
}
