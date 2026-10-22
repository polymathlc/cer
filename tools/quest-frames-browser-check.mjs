// 🎮 Quest frames in a REAL browser, printed to PDF with background graphics OFF:
//   • the portal: sheets laid out with index.html's own print CSS, framed in
//     their margins after planning, must print one sheet each — no extra blank
//     sheet, the answer key unframed, every sprite fetched from this site;
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
const portalFixture = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/quest-frames.css">
<style>${styleOf(INDEX)}</style>
<script src="/quest-frames.js"></script></head>
<body><div id="printOutput"></div></body></html>`;

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
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const failed = [], errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin)) failed.push(r.url()); });
  await page.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
  await page.goto(origin + '/portal');
  await page.waitForFunction(() => window.QuestFramesCer && window.QuestFrames);
  const portal = await page.evaluate(async () => {
    const QC = window.QuestFramesCer;
    const q = QC.ctx({ subject: 'science', title: 'P5 Heat and temperature', topics: ['Heat', 'Heat'], questions: 6 });
    const lines = (n) => '<div class="print-open-cer-box">' + '<div style="border-bottom:1px solid #999;height:26px"></div>'.repeat(n) + '</div>';
    const question = (n, marks) => '<div class="print-question-chunk"><div class="print-q-header print-q-header-plain qf-q-head">' + QC.gem(n, marks) + '<h2>Question ' + n + '</h2></div>' +
      '<div class="print-text-block">The metal spoon felt colder than the wooden spoon although both were left in the same room for an hour. Explain why.</div>' + lines(4) + '</div>';
    const footer = '<div class="print-page-footer"><span class="print-footer-text">© Polymath Learning Centre LLP.</span></div>';
    const sheet = (inner, n, extra) => '<div class="print-question-page' + (extra || '') + '"><div class="print-page-content">' + inner + '</div>' + footer + '<div class="print-page-number">– ' + n + ' –</div></div>';
    const output = document.getElementById('printOutput');
    output.innerHTML =
      sheet(QC.portalHeader(q, false, false) + question(1, 2) + '<div class="print-question-separator"></div>' + question(2, 3), 1) +
      sheet(question(3, 1) + '<div class="print-question-separator"></div>' + question(4, 0), 2) +
      sheet(question(5, 4) + '<div class="print-question-separator"></div>' + question(6, 5), 3) +
      sheet('<h2>Answer key</h2><p>1. Metal is a better conductor of heat.</p>', 4, ' print-answer-key-page');
    const framed = QC.framePrintPages(output, q);
    await QC.ready(output, 8000);
    return { framed, world: q.world, images: [...output.querySelectorAll('svg image')].length };
  });
  assert.equal(portal.framed, 3, 'the three question sheets are framed; the answer key is not');
  assert.equal(portal.world, 'volcano');
  assert.ok(portal.images > 20, 'runes, loot, gems, boss, logo and heroes are all pictures');
  assert.equal(await page.locator('.print-answer-key-page .qf-sheet-frame').count(), 0);
  assert.equal(await page.locator('.qf-sheet .qf-sheet-frame svg.qf-border--margins').count(), 3);
  await page.emulateMedia({ media: 'print' });
  const portalPdf = await page.pdf({ format: 'A4', printBackground: false, preferCSSPageSize: true });
  fs.writeFileSync(path.join(out, 'portal-framed.pdf'), portalPdf);
  assert.equal(pdfPages(portalPdf), 4, 'four sheets in, four sheets out: no blank sheet after a framed page');
  // The text column is where the planner measured it: 16mm in, 18mm down.
  const col = await page.evaluate(() => {
    const p = document.querySelector('.qf-sheet'), c = p.querySelector('.print-page-content');
    const a = p.getBoundingClientRect(), b = c.getBoundingClientRect();
    return { left: (b.left - a.left) * 25.4 / 96, top: (b.top - a.top) * 25.4 / 96, width: b.width * 25.4 / 96, page: getComputedStyle(p).page };
  });
  assert.equal(col.page, 'qf-sheet');
  assert.ok(Math.abs(col.left - 16) < 0.3 && Math.abs(col.top - 18) < 0.3, `text column starts 16mm in and 18mm down (got ${col.left.toFixed(2)} × ${col.top.toFixed(2)})`);
  assert.ok(Math.abs(col.width - 178) < 0.5, `text column is 178mm wide (got ${col.width.toFixed(2)})`);
  await page.emulateMedia({ media: 'screen' });
  assert.deepEqual(failed, [], 'every sprite is on this site');
  assert.deepEqual(errors, []);
  console.log('PASS portal: 3 framed sheets + plain answer key → 4 PDF pages, 178mm column at 16mm/18mm, all art served locally');

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
