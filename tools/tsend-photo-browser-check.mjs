// 📖 The Study Buddy export, photographed in a REAL browser with the SHIPPED
// code (the planner, the preview packer and every _tsend* step cut out of
// app.js, index.html's own CSS, the real Google fonts and html2canvas 1.4.1 —
// the version TSEND_LIBS loads):
//   • text is drawn where the browser lays it out. html2canvas measures font
//     baselines in a bare <div> it appends to <body>; the print CSS hid it, so
//     every line was painted a whole ascent too high — MCQ options on their
//     boxes' top edge, "Answer:" floating above its box (v1.451.3);
//   • a printed MCQ's radio stays invisible, as on paper (html2canvas paints
//     its own grey circle half a line below the option);
//   • a question too tall for one sheet is cut into whole A4 sheets, each with
//     its own "Page N of M", at most one sheet's content tall, nothing lost
//     between two cuts, and no cut through a line of text — it used to be one
//     A4 photograph that kept the first sheet and printed "Pages 3–4" over the
//     answer box.
// Run: node tools/tsend-photo-browser-check.mjs
// (PW / PLAYWRIGHT_MODULE for a playwright that is not on the path; H2C for a
// local html2canvas.min.js, otherwise node_modules/html2canvas or the CDN.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'test-results', 'tsend-photo');
fs.mkdirSync(out, { recursive: true });
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const modulePath = process.env.PLAYWRIGHT_MODULE || process.env.PW;
const pwMod = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const chromium = pwMod.chromium || (pwMod.default && pwMod.default.chromium);

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
const styleOf = (html) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');

const INDEX = read('index.html');
const APP = read('app.js');
const PATH = ['doScaleAndPrint', '_printLearnImgDims', '_printStampImgDims', '_printFlowFallback', '_printPlanPages',
  '_printFontLinksHtml', '_wsAppCssForPreview', '_wsPreviewWhenReady', '_printPlanIn', '_printPagePxFor', '_printSetContentZoom',
  '_printFooterHeightIn', '_printNumberHeightIn', '_printSeparatorHeightIn', '_classifyPrintChunks', 'packChunkIndices',
  '_printVerifiedZoom', '_printPlanAkPages', '_packAkRows', '_printAkPageEl', '_akPageTitle', '_printFrontPlacement', '_printFrontAnchor',
  '_printFrontRestarts', '_createPrintPageFooter', '_printApplyZoom', '_printStampPlanHeight', '_printApplyPageNumbers',
  '_printPadTallPage', '_printWrapPageContent', '_wsWritePreview', '_wsPreviewPack',
  '_tsendPrepSheet', '_tsendSheetToJpeg', '_tsendSliceStarts', '_tsendSplitTallSheet', '_tsendSplitTallSheets', '_tsendNumberSheets'];
const CONSTS = ['_printImgNatural', 'PRINT_ZOOM_FLOOR', 'PRINT_FIT_SAFETY', 'PRINT_GENTLE_ZOOM', 'PRINT_PAGE_RESERVE', 'A4_CONTENT_PX', 'PRINT_PAGE_PX', 'WS_PREVIEW_CSS', 'TSEND_SCALE'];
const kitJs = [
  ...CONSTS.map((n) => topConst(APP, n)),
  ...PATH.map((n) => topFn(APP, n)),
  'function _printProgressShow() {} function _printProgressUpdate() {} function _printProgressHide() {} function _printAndRestore() {}',
  'const wsManualBreaks = new Set(), wsMergeUp = new Set(); let _wsPreviewSaved = null;',
  'function _canAuthor() { return false; } function _wsPreviewIsDraft() { return false; } function pvsDecorateDoc() {} function pvoDecorateDoc() {}',
  'Object.assign(window, { _wsWritePreview, _tsendPrepSheet, _tsendSheetToJpeg, _tsendSplitTallSheets, _tsendNumberSheets, A4_CONTENT_PX, TSEND_SCALE });'
].join('\n');

// html2canvas: the very build TSEND_LIBS names.
const libUrl = (APP.match(/html2canvas:\s*\[\s*'([^']+)'/) || [])[1];
assert.ok(libUrl && /html2canvas@1\.4\.1/.test(libUrl), 'TSEND_LIBS still loads html2canvas 1.4.1 (this check pins that build)');
let h2c = null;
for (const p of [process.env.H2C, path.join(root, 'node_modules/html2canvas/dist/html2canvas.min.js')].filter(Boolean)) {
  if (fs.existsSync(p)) { h2c = fs.readFileSync(p); break; }
}
if (!h2c) { const r = await fetch(libUrl); assert.ok(r.ok, 'html2canvas could not be fetched from ' + libUrl); h2c = Buffer.from(await r.arrayBuffer()); }

const fontLink = (INDEX.match(/<link rel="stylesheet" media="print"[^>]*fonts\.googleapis[^>]*>/) || [''])[0].replace(/media="print"\s+onload="[^"]*"/, '');
const fixture = `<!doctype html><html><head><meta charset="utf-8">${fontLink}<link rel="stylesheet" href="/quest-frames.css"><style>${styleOf(INDEX)}</style><script src="/quest-frames.js"></script></head>
<body><div id="printOutput"></div><iframe id="pv" style="width:900px;height:1200px;border:0"></iframe><script src="/kit.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/portal') { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
  if (url.pathname === '/kit.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(kitJs); return; }
  if (url.pathname === '/h2c.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(h2c); return; }
  if (url.pathname === '/quest-frames.js' || url.pathname === '/quest-frames.css') {
    res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(read(url.pathname.slice(1))); return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.WORKSHEET_BROWSER_EXECUTABLE || process.env.CHROME_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/portal');
  await page.waitForFunction(() => window._wsWritePreview);
  const run = await page.evaluate(async () => {
    // A Science sheet as the builders print it: an imported MCQ (the very
    // label markup renderImportedBlockStudent writes) with its answer box, a
    // question too tall for any sheet — a table, then three parts with long
    // writing boxes — and the key.
    const mcq = (n) => '<div class="mcq-block" data-block="b' + n + '" style="margin:10px 0;">' + [1, 2, 3, 4].map((i) =>
      `<label style="display:flex;gap:8px;align-items:flex-start;padding:7px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;"><input type="radio" name="mcq_b${n}" value="o${i}"><span><b>${i}.</b> Option ${i}</span></label>`).join('') + '</div>'
      + '<div class="print-mcq-answer"><span class="print-mcq-answer-label">Answer:</span><span class="print-mcq-answer-slot"></span></div>';
    const box = (n) => '<div class="print-open-cer-box">' + '<div style="border-bottom:1px dotted #999;height:26px"></div>'.repeat(n) + '</div>';
    const chunk = (i, body, mcqFlag) => `<div class="print-question-chunk" data-qid="q${i}"${mcqFlag ? ' data-mcq="1"' : ''}><div class="print-q-header print-q-header-plain"><h2>Question ${i}</h2></div>${body}</div>`;
    const table = '<table border="1" style="width:100%;border-collapse:collapse">' + Array.from({ length: 12 }, (_, i) => `<tr><td style="height:40px">Pot ${i + 1}</td><td>${i * 5} g</td></tr>`).join('') + '</table>';
    const tall = '<div class="print-text-block">The results of his experiment are as shown.</div>' + table +
      '<div class="print-text-block">(b) What can Ravi conclude about the effect of fertiliser on leaf growth?</div>' + box(30) +
      '<div class="print-text-block">(c) Suggest one change Ravi could make to his experiment so that his conclusion is more reliable.</div>' + box(30) +
      '<div class="print-text-block">(d) The last part of the question, LAST-LINE-MARKER.</div>' + box(20);
    const html = chunk(1, '<div class="print-text-block">Which one is correct?</div>' + mcq(1), true) + chunk(2, tall) + chunk(3, '<div class="print-text-block">Which one?</div>' + mcq(3), true) +
      '<div class="print-answer-key-page"><h2>Answer Key</h2><div class="print-ak-question" data-qid="q1"><div class="print-ak-qhead">Question 1</div><div>(2)</div></div></div>';
    const frame = document.getElementById('pv');
    await new Promise((resolve, reject) => window._wsWritePreview(frame, html, { noTools: true, onReady: resolve, onError: () => reject(new Error('preview failed')) }));
    const d = frame.contentDocument, w = frame.contentWindow;
    await new Promise((r, j) => { const s = d.createElement('script'); s.src = '/h2c.js'; s.onload = r; s.onerror = () => j(new Error('h2c')); d.head.appendChild(s); });
    const packed = [...d.querySelectorAll('#wsPages .wspv-sheet')];
    const before = packed.map((s) => ({ span: +(s.dataset.span || 1), no: s.querySelector('.wspv-pageno').textContent, kind: s.dataset.kind || '' }));
    const sheets = await window._tsendSplitTallSheets(w, packed);
    window._tsendNumberSheets(sheets);
    sheets.forEach(window._tsendPrepSheet);
    await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
    // Where the BROWSER put things, relative to each sheet (CSS px).
    const rel = (el, sh) => { const a = sh.getBoundingClientRect(), b = el.getBoundingClientRect(); return { top: b.top - a.top, bottom: b.bottom - a.top, left: b.left - a.left, right: b.right - a.left }; };
    const textRect = (el, sh) => { const r = d.createRange(); r.selectNodeContents(el); const a = sh.getBoundingClientRect(), b = r.getBoundingClientRect(); return { top: b.top - a.top, bottom: b.bottom - a.top, left: b.left - a.left, right: b.right - a.left }; };
    const geo = sheets.map((sh) => {
      const view = sh.querySelector(':scope > .tsend-slice');
      const pno = sh.querySelector(':scope > .wspv-pageno');
      const labels = view ? [] : [...sh.querySelectorAll('.mcq-block label')].map((l) => ({ box: rel(l, sh), text: textRect(l.querySelector('span'), sh), radio: rel(l.querySelector('input'), sh) }));
      const answers = view ? [] : [...sh.querySelectorAll('.print-mcq-answer')].map((a) => ({ label: textRect(a.querySelector('.print-mcq-answer-label'), sh), slot: rel(a.querySelector('.print-mcq-answer-slot'), sh) }));
      let cutsText = [];
      if (view) {
        // Every line of text inside this window must be wholly inside it.
        const v = view.getBoundingClientRect();
        const walker = d.createTreeWalker(view, 4);
        const r = d.createRange();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.nodeValue.trim()) continue;
          r.selectNodeContents(n);
          [...r.getClientRects()].forEach((q) => { if (q.top < v.bottom - 0.5 && q.bottom > v.bottom + 0.5) cutsText.push(n.nodeValue.trim().slice(0, 30) + ' (bottom)'); if (q.top < v.top - 0.5 && q.bottom > v.top + 0.5) cutsText.push(n.nodeValue.trim().slice(0, 30) + ' (top)'); });
        }
      }
      return {
        slice: sh.dataset.slice || '', kind: sh.dataset.kind || '', no: pno ? pno.textContent : '',
        h: sh.getBoundingClientRect().height,
        view: view ? { ...rel(view, sh), offset: -parseFloat(view.firstElementChild.style.marginTop || '0'), total: view.firstElementChild.getBoundingClientRect().height } : null,
        pno: pno ? rel(pno, sh) : null, labels, answers, cutsText,
        hasLast: view ? (() => { const m = [...view.querySelectorAll('.print-text-block')].find((t) => /LAST-LINE-MARKER/.test(t.textContent)); if (!m) return false; const v = view.getBoundingClientRect(), b = m.getBoundingClientRect(); return b.top >= v.top - 0.5 && b.bottom <= v.bottom + 0.5; })() : false
      };
    });
    const shots = [];
    for (const sh of sheets) shots.push((await window._tsendSheetToJpeg(w, sh)).toDataURL('image/png'));
    return { before, geo, shots, A4: window.A4_CONTENT_PX, scale: window.TSEND_SCALE };
  });

  const shots = run.shots.map((u, i) => { const f = path.join(out, `sheet-${i + 1}.png`); fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')); return f; });
  // Read the photographs back as pixels, in the browser (no image library here).
  const px = await browser.newPage();
  const ink = (file, boxes) => px.evaluate(async ({ url, boxes }) => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return boxes.map(({ x0, y0, x1, y1, dark }) => {
      const W = Math.max(1, x1 - x0), H = Math.max(1, y1 - y0);
      const data = g.getImageData(x0, y0, W, H).data;
      let top = -1, bottom = -1, count = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4; const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (v < dark) { count++; if (top < 0) top = y; bottom = y; }
      }
      return { count, top: top < 0 ? null : y0 + top, bottom: bottom < 0 ? null : y0 + bottom };
    });
  }, { url: 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'), boxes });

  const s = run.scale;
  // ---- 1. text sits where the browser put it
  const mcqSheet = run.geo.findIndex((g) => g.labels.length);
  assert.ok(mcqSheet >= 0, 'the MCQ sheet was photographed');
  const g1 = run.geo[mcqSheet];
  for (const [i, l] of g1.labels.entries()) {
    // The option's ink, looked for inside its box only (2px in from the border).
    const [t] = await ink(shots[mcqSheet], [{ x0: Math.round((l.text.left - 1) * s), x1: Math.round((l.box.right - 3) * s), y0: Math.round((l.box.top + 2) * s), y1: Math.round((l.box.bottom - 2) * s), dark: 140 }]);
    assert.ok(t.count > 20, `option ${i + 1}: its text was photographed`);
    const inkMid = (t.top + t.bottom) / 2 / s, laidMid = (l.text.top + l.text.bottom) / 2;
    assert.ok(Math.abs(inkMid - laidMid) < 3, `option ${i + 1}: the text is drawn where the browser laid it out (ink centre ${inkMid.toFixed(1)}px, line centre ${laidMid.toFixed(1)}px) — not an ascent too high`);
    const boxMid = (l.box.top + l.box.bottom) / 2;
    assert.ok(Math.abs(inkMid - boxMid) < 4, `option ${i + 1}: centred in its box (${inkMid.toFixed(1)} vs ${boxMid.toFixed(1)})`);
    // ---- 2. no phantom radio circle
    const [r] = await ink(shots[mcqSheet], [{ x0: Math.round((l.box.left + 3) * s), x1: Math.round((l.text.left - 2) * s), y0: Math.round((l.box.top + 3) * s), y1: Math.round((l.box.bottom - 3) * s), dark: 235 }]);
    assert.equal(r.count, 0, `option ${i + 1}: no radio circle painted beside it (paper has none)`);
  }
  for (const a of g1.answers) {
    const [t] = await ink(shots[mcqSheet], [{ x0: Math.round((a.label.left - 1) * s), x1: Math.round((a.label.right + 1) * s), y0: Math.round((a.slot.top - 12) * s), y1: Math.round((a.slot.bottom + 12) * s), dark: 160 }]);
    const inkMid = (t.top + t.bottom) / 2 / s, slotMid = (a.slot.top + a.slot.bottom) / 2;
    assert.ok(Math.abs(inkMid - slotMid) < 3, `"Answer:" is level with its box (ink centre ${inkMid.toFixed(1)}px, box centre ${slotMid.toFixed(1)}px)`);
  }
  console.log(`PASS text: ${g1.labels.length} options and the answer box drawn where the browser lays them out; no radio circles`);

  // ---- 3. the tall question became whole A4 sheets
  const tallBefore = run.before.find((b) => b.span > 1);
  assert.ok(tallBefore, 'the fixture really has a question too tall for one sheet: ' + JSON.stringify(run.before));
  assert.match(tallBefore.no, /^Pages \d+–\d+ of \d+$/, 'the packer labelled it as several pages');
  const slices = run.geo.filter((g) => g.slice);
  assert.ok(slices.length >= 2, 'cut into ' + slices.length + ' sheets');
  run.geo.forEach((g, i) => {
    assert.equal(g.no, `Page ${i + 1} of ${run.geo.length}`, `sheet ${i + 1} is numbered as the PDF page it becomes`);
    assert.ok(Math.abs(g.h - 297 * 96 / 25.4) < 1, `sheet ${i + 1} is one A4 (${g.h.toFixed(1)}px)`);
  });
  let covered = 0;
  slices.forEach((g, i) => {
    const at = `cut ${i + 1}/${slices.length}`;
    assert.ok(g.view.bottom - g.view.top <= run.A4 + 0.5, `${at}: no taller than one sheet's content (${(g.view.bottom - g.view.top).toFixed(1)}px)`);
    assert.ok(g.view.bottom <= g.pno.top + 0.5, `${at}: the page number sits below the content, never over it`);
    assert.ok(Math.abs(g.view.offset - covered) < 1.01, `${at}: starts where the last one ended (${g.view.offset} vs ${covered}) — nothing lost between sheets`);
    covered = g.view.offset + (g.view.bottom - g.view.top);
    assert.deepEqual(g.cutsText, [], `${at}: no line of text cut in half`);
  });
  assert.ok(covered >= slices[0].view.total - 1.01, `the cuts cover the whole question (${covered.toFixed(1)} of ${slices[0].view.total.toFixed(1)}px)`);
  assert.ok(slices[slices.length - 1].hasLast, 'its last part is on its last sheet');
  // The photograph of a cut: ink right down to where the content ends, none in the page-number band but the number.
  const lastCut = run.geo.indexOf(slices[0]);
  const [band] = await ink(shots[lastCut], [{ x0: Math.round(10 * s), x1: Math.round(780 * s), y0: Math.round((slices[0].view.bottom + 1) * s), y1: Math.round((slices[0].pno.top - 1) * s), dark: 200 }]);
  assert.equal(band.count, 0, 'nothing is photographed between the content and the page number');
  console.log(`PASS tall: "${tallBefore.no}" became ${slices.length} A4 sheets, ${run.geo.length} pages numbered 1–${run.geo.length}, no text cut, nothing lost`);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.close();
}
