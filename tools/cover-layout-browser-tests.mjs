// Real cover generators and their legacy styles, without Firebase or paid services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'test-results', 'cover-layout');
fs.mkdirSync(output, { recursive: true });
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const sources = { app: read('app.js'), index: read('index.html'), math: read('math-worksheet.html'), science: read('science-worksheet.html') };
const css = html => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');
// Ask the JS parser where a complete function ends; this handles template-string
// CSS braces and the science creator's original minified source alike.
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
const modulePath = process.env.WORKSHEET_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    const kind = url.searchParams.get('kind') || 'index';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css(sources[kind])}</style><script src="/worksheet-cover.js"></script></head><body><div id="printOutput"></div></body></html>`);
    return;
  }
  if (url.pathname !== '/worksheet-cover.js' && !/^\/assets\/(worksheet-covers\/(math|science)-icons-v2|branding\/polymath-learning-centre)\.png$/.test(url.pathname)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', url.pathname.endsWith('.png') ? 'image/png' : 'text/javascript');
  res.end(fs.readFileSync(path.join(root, url.pathname.slice(1))));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.WORKSHEET_BROWSER_EXECUTABLE || process.env.CHROME_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
const escapeSource = `function escapeHtml(value){return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}`;
async function ready() { await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0)); }
async function clips(scope = page) {
  const items = await scope.locator('.wc-icon').evaluateAll(nodes => nodes.map(el => {
    const style = getComputedStyle(el), element = el.firstElementChild, image = getComputedStyle(element);
    return { id: el.dataset.icon, crop: (el.dataset.crop || '').split(',').map(Number), nw: element.naturalWidth, nh: element.naturalHeight, left: parseFloat(el.style.left), top: parseFloat(el.style.top), w: parseFloat(style.width), h: parseFloat(style.height), iw: parseFloat(image.width), ih: parseFloat(image.height), ix: parseFloat(image.left), iy: parseFloat(image.top), widthRatio: parseFloat(style.width) / parseFloat(getComputedStyle(el.parentElement).width), overflow: style.overflow };
  }));
  assert.ok(items.length >= 30 && items.length <= 38, 'Every cover generator uses the scattered symbol design');
  assert.equal(new Set(items.map(item => item.id)).size, 16, 'Every cover uses all sixteen subject icons');
  assert.equal(new Set(items.map(item => Math.floor(item.top / 25))).size, 4, 'Scatter reaches all four vertical quarters');
  assert.ok(items.filter(item => item.left >= 20 && item.left <= 75 && item.top >= 10 && item.top <= 90).length >= 6, 'Symbols also occupy interior whitespace');
  assert.equal(new Set(items.map(item => item.crop.join(','))).size, 16);
  items.forEach(item => {
    const [x, y, w, h] = item.crop;
    assert.ok(item.crop.length === 4 && item.crop.every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= item.nw && y + h <= item.nh, 'Crop metadata stays within the source atlas');
    assert.ok(item.w > 10); assert.ok(item.widthRatio <= .08, 'Icons stay small in each legacy cover layout');
    assert.ok(Math.abs(item.w * h / w - item.h) < 1, 'Source crop keeps its aspect ratio');
    assert.ok(Math.abs(item.iw - item.w * item.nw / w) < 1 && Math.abs(item.ih - item.h * item.nh / h) < 1, 'Atlas scale follows the actual crop');
    assert.ok(Math.abs(item.ix + item.w * x / w) < 1 && Math.abs(item.iy + item.h * y / h) < 1, 'Crop offsets follow source pixels');
    assert.equal(item.overflow, 'hidden');
  });
  assert.ok(await scope.locator('.cover-artwork svg circle').count() >= 6, 'Cover includes bubble textures');
  assert.ok(await scope.locator('.cover-artwork svg polygon').count() >= 4, 'Cover includes polygon textures');
}
async function inside(selector, parts) {
  const bounds = await page.locator(selector).evaluate((cover, parts) => {
    const parent = cover.getBoundingClientRect();
    return parts.map(part => { const el = cover.querySelector(part); const box = el.getBoundingClientRect(); return { part, top: box.top - parent.top, bottom: box.bottom - parent.top, left: box.left - parent.left, right: box.right - parent.left, height: parent.height, width: parent.width }; });
  }, parts);
  bounds.forEach(box => { assert.ok(box.top >= -1 && box.bottom <= box.height + 1, `${box.part} spills vertically: ${JSON.stringify(box)}`); assert.ok(box.left >= -1 && box.right <= box.width + 1, `${box.part} spills horizontally`); });
}
async function clearStudentFields() {
  const collisions = await page.locator('.wc-cover').evaluateAll(covers => covers.flatMap(cover => {
    const protectedAreas = [...cover.querySelectorAll('.wc-field-label,.wc-field-line,.wc-footer')].flatMap(el => {
      if (el.classList.contains('wc-field-line')) return [{ part: 'student writing line', box: el.getBoundingClientRect() }];
      const range = document.createRange(); range.selectNodeContents(el);
      return [...range.getClientRects()].map(box => ({ part: el.classList.contains('wc-footer') ? 'footer text' : 'student field label', box }));
    });
    return [...cover.querySelectorAll('.wc-icon')].flatMap(icon => {
      const box = icon.getBoundingClientRect();
      return protectedAreas.filter(area => Math.min(box.right, area.box.right) - Math.max(box.left, area.box.left) > 1 && Math.min(box.bottom, area.box.bottom) - Math.max(box.top, area.box.top) > 1).map(area => `${icon.dataset.icon} overlaps ${area.part}`);
    });
  }));
  if (collisions.length) {
    const geometry = await page.locator('.wc-cover').evaluateAll(covers => covers.map(cover => {
      const parent = cover.getBoundingClientRect();
      const normal = box => ({ left: +(100 * (box.left - parent.left) / parent.width).toFixed(2), top: +(100 * (box.top - parent.top) / parent.height).toFixed(2), right: +(100 * (box.right - parent.left) / parent.width).toFixed(2), bottom: +(100 * (box.bottom - parent.top) / parent.height).toFixed(2) });
      return { width: parent.width, height: parent.height, text: [...cover.querySelectorAll('.wc-title,.wc-subheader,.wc-field-label,.wc-field-line,.wc-footer')].map(el => ({ part: el.className, ...normal(el.getBoundingClientRect()) })), icons: [...cover.querySelectorAll('.wc-icon')].map(icon => ({ id: icon.dataset.icon, at: [icon.style.left, icon.style.top], ...normal(icon.getBoundingClientRect()) })) };
    }));
    console.log('Cover overlap geometry:', JSON.stringify(geometry));
    await page.screenshot({ path: path.join(output, 'overlap-diagnostic.png'), fullPage: true });
  }
  assert.deepEqual(collisions, [], 'Small symbols leave student labels, writing lines and footer text clear');
}
// The Big M cover keeps every icon off its words, logo, pills and fields card.
async function clearBigMText() {
  const hits = await page.locator('.wc-cover.wc-m').evaluateAll(covers => covers.flatMap(cover => {
    const areas = [...cover.querySelectorAll('.wc-logo,.wc-pill,.wc-fields,.wc-bar')].map(el => ({ part: el.className, box: el.getBoundingClientRect() }))
      .concat([...cover.querySelectorAll('.wc-eyebrow,.wc-title,.wc-subtitle,.wc-footer')].flatMap(el => { const range = document.createRange(); range.selectNodeContents(el); return [...range.getClientRects()].map(box => ({ part: el.className, box })); }));
    return [...cover.querySelectorAll('.wc-icon')].flatMap(icon => { const box = icon.getBoundingClientRect(); return areas.filter(a => Math.min(box.right, a.box.right) - Math.max(box.left, a.box.left) > 1 && Math.min(box.bottom, a.box.bottom) - Math.max(box.top, a.box.top) > 1).map(a => `${icon.dataset.icon} on ${a.part}`); });
  }));
  assert.deepEqual(hits, [], 'Big M cover icons stay off the logo, pills, title block, fields card and footer');
}
async function onePage(name) {
  const viewport = page.viewportSize();
  // Print-media DOM geometry needs the same 178mm content width as the PDF;
  // a desktop viewport would stretch width:100% while keeping a fixed mm height.
  await page.setViewportSize({ width: Math.round((210 - 32) * 96 / 25.4), height: 1200 });
  try {
    await clearStudentFields(); await clearBigMText();
    for (const svg of await page.locator('.cover-artwork svg.wc-textures, .cover-artwork svg.wc-facets').all()) assert.ok(await svg.isVisible(), 'Textures and the faceted M print without browser background graphics');
    await page.screenshot({ path: path.join(output, `${name}-print.png`), fullPage: true });
    const pdf = await page.pdf({ path: path.join(output, `${name}.pdf`), format: 'A4', preferCSSPageSize: true, printBackground: false });
    assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1, `${name} must fit one printed sheet`);
  } finally { await page.setViewportSize(viewport); }
}
try {
  await page.goto(origin + '/?kind=index');
  const appFns = ['_wsCoverDefaults', '_wsCoverScoreDefault', '_wsCoverHtml', '_wsAppCssForPreview', '_cpbIndexGridHtml', '_cpbCoverValue', '_cpbCoverBrandHtml', '_cpbCoverInstructions', '_cpbCoverHeadHtml', '_cpbCoverFootHtml', '_cpbCoverA', '_cpbCoverB', 'cpbEditCovers'].map(name => fn(sources.app, name)).join('\n');
  await page.addScriptTag({ content: `${escapeSource}\nconst currentUser={uid:'cover-layout-test'},CPB_MCQ_MARKS=2,WS_COVER_SCORE_KEY='cer.coverScore';let _cpbMeta={org:'Polymath Learning Centre',exam:'Practice paper',subject:'SCIENCE',level:'PRIMARY 6',year:'2026',code:'P6',duration:'1 hour 45 minutes',coverScale:1,coverOpacity:.72};function _cpbMetaGet(key){return _cpbMeta[key];}function cpbIsWorksheet(){return false;}function cpbMarks(){return {a:20,b:12};}function cpbLayout(){return {a:Array(10),list:Array(16)};}function _cpbDraftSave(){}function cpbRender(){}function _printFontLinksHtml(){return '';}\n${appFns}` });
  const previewRules = await page.addStyleTag({ content: await page.evaluate(() => _wsAppCssForPreview()) });
  await page.addStyleTag({ content: 'html,body{margin:0;padding:0}#printOutput{display:block!important;width:178mm;margin:0 auto}@media print{#printOutput{width:100%;margin:0}}' });
  await page.evaluate(() => { document.querySelector('#printOutput').innerHTML = _wsCoverHtml('Photosynthesis, leaves\n& gas exchange', 'Primary Science', 'Past Year Paper', false); });
  await ready(); await clips();
  await inside('.wc-cover', ['.wc-title', '.wc-fields', '.wc-footer']);
  await clearStudentFields(); await clearBigMText();
  await page.screenshot({ path: path.join(output, 'main-science-preview.png'), fullPage: true });
  await page.emulateMedia({ media: 'print' }); await onePage('main-science-cover');
  // The main cover is the whole A4 sheet, edge to edge: its own margin-free
  // named page, 210mm wide and (half a millimetre short of) 297mm tall.
  const bleed = await page.locator('.wc-cover').evaluate(el => { const box = el.getBoundingClientRect(), style = getComputedStyle(el); return { page: style.page, width: box.width, height: box.height }; });
  const mm = 96 / 25.4;
  assert.equal(bleed.page, 'polymath-cover', 'The cover prints on the margin-free page');
  assert.ok(Math.abs(bleed.width - 210 * mm) < 1, `Cover spans the full A4 width: ${bleed.width}`);
  assert.ok(bleed.height >= 296 * mm && bleed.height <= 297 * mm, `Cover spans the full A4 height: ${bleed.height}`);
  await page.emulateMedia({ media: 'screen' });
  // Score switched off: no score area at all, Name and Date share one row,
  // and the icons still stay off the card.
  await page.evaluate(() => { document.querySelector('#printOutput').innerHTML = _wsCoverHtml('PSLE 2015\nScience Paper', 'Primary Science', 'Past Year Paper', false, { score: false }); });
  await ready();
  assert.equal(await page.locator('.wc-score').count(), 0, 'No score box when it is off');
  assert.equal(await page.locator('.wc-field-label').allTextContents().then(labels => labels.join(',')), 'Name,Date');
  const row = await page.locator('.wc-fields .wc-field').evaluateAll(fields => fields.map(f => Math.round(f.getBoundingClientRect().top)));
  assert.equal(new Set(row).size, 1, 'Name and Date sit on one row');
  await inside('.wc-cover', ['.wc-title', '.wc-fields', '.wc-footer']);
  await page.emulateMedia({ media: 'print' }); await onePage('main-science-cover-no-score'); await page.emulateMedia({ media: 'screen' });
  await previewRules.evaluate(el => el.remove());

  await page.evaluate(() => { window._editedCovers = cpbEditCovers(); });
  await page.locator('.cpb-cover-editor[open]').waitFor();
  await page.locator('[name=org]').fill('Polymath Learning Centre');
  await page.locator('[name=coverInstructionsA]').fill('Read every question carefully.\nShow your answer clearly.');
  const frame = page.frameLocator('.cpb-cover-editor iframe');
  await frame.locator('.cpb-cv-ins-list li').first().waitFor();
  assert.equal(await frame.locator('.cpb-cv-ins-list li').count(), 2);
  await clips(frame);
  const frameSize = await page.locator('.cpb-cover-editor iframe').evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }));
  const previewSize = await frame.locator('.cpb-cover').boundingBox();
  assert.ok(previewSize.width <= frameSize.width + 1 && previewSize.height <= frameSize.height + 1, 'Booklet preview fits the iframe');
  await page.screenshot({ path: path.join(output, 'custom-cover-editor-a.png'), fullPage: true });
  await page.locator('[data-booklet=B]').click();
  assert.equal(await frame.locator('.cpb-cv-booklet').textContent(), '(BOOKLET B)');
  assert.ok(await frame.locator('.cpb-cv-total').isVisible());
  await page.screenshot({ path: path.join(output, 'custom-cover-editor-b.png'), fullPage: true });
  await page.locator('.cpb-cover-editor [type=submit]').click();
  assert.equal(await page.evaluate(() => window._editedCovers), true);
  await page.addStyleTag({ content: await page.evaluate(() => _wsAppCssForPreview()) });
  for (const booklet of ['A', 'B']) {
    await page.evaluate(booklet => { document.querySelector('#printOutput').innerHTML = booklet === 'A' ? _cpbCoverA(20, 10) : _cpbCoverB(12, 11, 16, 'booklet-b-q1'); }, booklet);
    await ready(); await clips();
    await inside('.cpb-cover', ['.cpb-cv-head', '.cpb-cv-ins', '.cpb-cv-foot']);
    if (booklet === 'B') assert.equal(await page.locator('.cpb-cover').getAttribute('data-front-before'), 'booklet-b-q1');
    await page.emulateMedia({ media: 'print' }); await onePage(`custom-booklet-${booklet.toLowerCase()}`); await page.emulateMedia({ media: 'screen' });
  }

  for (const subject of ['math', 'science']) {
    const source = sources[subject];
    await page.goto(origin + '/?kind=' + subject);
    const names = ['defaultCover', 'getCover', 'coverFieldsOn', 'coverDecoSvg', 'coverPageMarkup', 'buildCoverHtml', 'getCoverCss', 'getCoverEditorCss'];
    const declarations = names.map(name => fn(source, name)).join('\n');
    await page.addScriptTag({ content: `${escapeSource}\nlet state={title:'${subject === 'math' ? 'Fractions, ratios & percentages' : 'Photosynthesis, leaves & gas exchange'}',cover:{enabled:true,nameLabel:'Student',dateLabel:'Class'}};const COVER_FIELD_PLACEHOLDERS={header:'Cover header',title:'Worksheet title',subheader:'Subtitle',footer:'Footer',nameLabel:'Name label',dateLabel:'Date label'};\n${declarations}` });
    await page.addStyleTag({ content: await page.evaluate(() => getCoverEditorCss()) });
    await page.evaluate(() => { document.querySelector('#printOutput').innerHTML = coverPageMarkup('cover-preview', true); document.querySelector('#printOutput').style.cssText = 'display:block;width:min(794px,100%);margin:auto'; });
    await ready(); await clips();
    assert.equal(await page.locator('[data-cover-subject]').first().getAttribute('data-cover-subject'), subject);
    await inside('.cover-preview', ['.cover-title', '.cover-fields-grid', '.cover-footer']);
    await clearStudentFields();
    await page.screenshot({ path: path.join(output, `${subject}-standalone-preview.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await inside('.cover-preview', ['.cover-title', '.cover-fields-grid', '.cover-footer']);
    await clearStudentFields();
    await page.setViewportSize({ width: 1280, height: 1100 });
    const exportCss = await page.evaluate(() => getCoverCss());
    await page.addStyleTag({ content: exportCss + '@page{size:A4;margin:18mm 16mm}html,body{margin:0;padding:0}#printOutput{width:100%!important;margin:0!important}' });
    await page.evaluate(() => { document.querySelector('#printOutput').innerHTML = buildCoverHtml(); });
    await ready(); await clips();
    await page.emulateMedia({ media: 'print' }); await onePage(`${subject}-standalone-cover`); await page.emulateMedia({ media: 'screen' });
  }
  assert.deepEqual(errors, []);
  console.log('PASS Big M main cover (icons clear of every word), main, Custom Paper editor/booklets and standalone generators: small scattered sixteen-icon atlases, bubble/polygon textures, mobile bounds, labels and one PDF page per cover');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
