// Browser checks for the shipped cover renderer and real preview save handlers.
// PW=/path/to/playwright/index.mjs BROWSER=/path/to/chrome node tools/worksheet-cover-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const science = fs.existsSync(path.join(root, 'app.js'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const src = science ? fs.readFileSync(path.join(root, 'app.js'), 'utf8') : html;
const output = path.join(root, 'test-results/worksheet-cover');
fs.mkdirSync(output, { recursive: true });
function cut(from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, from);
  return src.slice(a, b);
}
const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(x => x[1]).join('\n');
let harness = `
var currentUser = { uid: 'teacher' }, wsCoverDesign = {}, wsArtwork = [], writes = [], refuseWrite = false;
var sheet = { id: 'saved', title: '${science ? 'Matter & Materials' : 'Fractions & Decimals'}', ownerUid: 'teacher', questionIds: ['q1'], coverDesign: {} };
var savedWorksheets = [sheet], _wsPreviewSaved = { id: 'saved' }, _wsPreviewPaper = null, _wsPreviewAdhoc = null, _wvWs = null;
var WS_HEADER_ORG = 'Polymath Learning Centre', WS_HEADER_MAX = 120, WS_COVER_LOGO = location.origin + '/assets/branding/polymath-learning-centre.png', WS_LOGO_FALLBACK = WS_COVER_LOGO;
var question = { id: 'q1', title: 'Question 1', blocks: [{type:'text', text:'Practice question'}] };
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function $(id) { return document.getElementById(id); }
function wsFind(id) { return savedWorksheets.find(w => w.id === id); }
function wsMine(w) { return w && w.ownerUid === currentUser?.uid; }
function dgIsTest() { return false; }
function renderSavedWorksheets() {}
function renderDiagnosticPage() {}
function renderWorksheetOverview() {}
function toast() {}
function showToast() {}
async function persistWorksheet(next) { if(refuseWrite) throw Error('Offline'); writes.push(JSON.parse(JSON.stringify(next))); }
async function setDoc(ref, next) { if(refuseWrite) throw Error('Offline'); writes.push(JSON.parse(JSON.stringify(next))); }
function _wsRef(id) { return { id, uid:currentUser.uid }; }
function _wsSavedQuestions() { return [question]; }
function _wsStudentFieldsOn() { return true; }
function akxPrintOn() { return false; }
function objBoxPrintOn() { return false; }
function wsCurrentTitle() { return $('wsTitle').value; }
`;
if (science) {
  harness += cut('function _wsCoverHtml(', '// Blank Name / Date / Class lines');
  harness += cut('function _wsPreviewCtx()', '\nfunction openWorksheetPreview()');
  harness += cut('function _wsAppCssForPreview()', '// The preview normally shows');
  harness += `
function renderWsPreview() {
  const ctx = _wsPreviewCtx(), doc = $('preview').contentDocument;
  doc.open(); doc.write('<!doctype html><html><head><style>' + _wsAppCssForPreview() + '</style><style>body{margin:0!important;padding:0!important;background:white!important}.pc-cover{width:178mm}</style></head><body><div id="printOutput">' + _wsCoverHtml(ctx.title, undefined, undefined, ctx.noFields, ctx.coverDesign) + '</div></body></html>'); doc.close();
}
function openFixture() { renderWsPreview(); }
$('edit').onclick = wsEditCover;
`;
} else {
  harness += cut('function wsHeaderOrgOf(', '\nfunction wsHasMcq');
  harness += cut('function wsHeadFieldHtml(', '// How much blank working space');
  harness += cut('function wsPrintCss()', '\n//');
  harness += cut('async function wsBuildDocumentHtml(', '// ---- Editing the header');
  harness += cut('const WS_EDIT_HINT =', '\nasync function printCurrentWorksheet');
  harness += cut('function wsBindCoverEditor(', '// ============ EDITING THE SHEET HEADER');
  harness += cut('async function wsPreviewHeaderSave(', '// On `window`');
  harness += `
window.wsPreviewHeaderSave = wsPreviewHeaderSave;
function wsHeadEstimateMm() { return 30; }
function wsQuestionChunkHtml() { return '<article class="ws-chunk"><h2>Question 1</h2><p>Write your answer below.</p></article>'; }
function pvsPreviewScriptHtml() { return ''; }
async function makeQrSvg() { return '<svg viewBox="0 0 20 20" data-test-qr><rect width="20" height="20" fill="black"/></svg>'; }
function openFixture(saved = true) {
  return wsOpenDocument([question], saved ? sheet.title : wsCurrentTitle(), {
    cover: true, fields: true, sheetUrl: 'https://example.com/worksheet',
    headerEditId: saved ? 'saved' : '', coverEditScope: saved ? '' : 'builder',
    headerOrg: saved ? wsHeaderOrgOf(sheet) : wsCoverDesign.org,
    coverDesign: saved ? sheet.coverDesign : wsCoverDesign
  }).then(() => {});
}
`;
}
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${science ? `<style>${css}</style>` : ''}<script src="/worksheet-cover.js"></script></head><body style="margin:20px;background:#eef4f4"><input id="wsTitle" value="Draft worksheet"><input id="mwIncludeCover" type="checkbox" checked><input id="wsIncludeCover" type="checkbox" checked><button id="edit">Edit cover</button><iframe id="preview" style="display:block;width:674px;height:950px;border:0;margin:auto"></iframe><script>${harness}</script></body></html>`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
  const allowed = ['/worksheet-cover.js', '/assets/branding/polymath-learning-centre.png'];
  if (!allowed.includes(pathname)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', pathname.endsWith('.png') ? 'image/png' : 'text/javascript');
  res.end(fs.readFileSync(path.join(root, pathname.slice(1))));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(process.env.PW ? pathToFileURL(process.env.PW).href : 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER || undefined });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1080 } });
  context.on('page', page => page.on('pageerror', error => (errors.push(error.message), console.error('Browser error:', error.message))));
  if (science) await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const parent = await context.newPage();
  await parent.goto(origin);
  let page = parent;
  if (science) await parent.evaluate(() => openFixture());
  else {
    const popup = parent.waitForEvent('popup');
    await parent.evaluate(() => openFixture());
    page = await popup;
  }
  const cover = () => science ? parent.frameLocator('#preview').locator('.pc-cover') : page.locator('.ws-sheet .pc-cover');
  await cover().locator('.pc-logo').evaluate(img => img.decode());
  await cover().screenshot({ path: path.join(output, science ? 'science-cover.png' : 'math-cover.png') });
  assert.equal(await cover().getAttribute('data-cover-subject'), science ? 'science' : 'math');
  assert.equal(await cover().locator('img').evaluate(img => img.naturalWidth > 0), true);
  const edit = () => page.locator(science ? '#edit' : '#wsEditCover').click();
  await edit();
  await page.locator('dialog.pc-editor').waitFor();
  await page.locator('[name=title]').fill('Our edited worksheet');
  await page.locator('[name=subtitle]').fill('Explore <patterns> & explain');
  await page.locator('[name=name]').fill('Ada');
  await page.locator('[name=className]').fill('P5');
  await page.locator('[name=date]').fill('20 October 2026');
  await page.locator('[data-remix]').click();
  await page.locator('[name=subject]').selectOption(science ? 'math' : 'science');
  await page.locator('dialog.pc-editor').screenshot({ path: path.join(output, 'cover-editor.png') });
  // Cancellation must not change the generated cover or write to storage.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await parent.evaluate(() => writes.length), 0);
  assert.notEqual(await cover().locator('h1').textContent(), 'Our edited worksheet');
  await edit();
  await page.locator('[name=title]').fill('Our edited worksheet');
  await page.locator('[name=subtitle]').fill('Explore <patterns> & explain');
  await page.locator('[name=name]').fill('Ada');
  await parent.evaluate(() => { refuseWrite = true; });
  await page.getByRole('button', { name: 'Apply cover' }).click();
  await page.getByRole('status').filter({ hasText: 'Could not save' }).waitFor();
  assert.notEqual(await cover().locator('h1').textContent(), 'Our edited worksheet');
  await parent.evaluate(() => { refuseWrite = false; });
  await page.getByRole('button', { name: 'Apply cover' }).click();
  await page.locator('dialog.pc-editor').waitFor({ state: 'detached' });
  assert.equal(await cover().locator('h1').textContent(), 'Our edited worksheet');
  assert.equal(await cover().locator('.pc-subtitle').textContent(), 'Explore <patterns> & explain');
  assert.equal(await parent.evaluate(() => sheet.coverDesign.name), 'Ada');
  // Reopening reads the stored model, not the preview's DOM.
  if (science) await parent.evaluate(() => openFixture());
  else {
    await page.close();
    const popup = parent.waitForEvent('popup');
    await parent.evaluate(() => openFixture());
    page = await popup;
  }
  assert.equal(await cover().locator('h1').textContent(), 'Our edited worksheet');
  assert.equal(await cover().locator('.pc-field-value').first().textContent(), 'Ada');
  if (!science) {
    assert.equal(await page.locator('.ws-sheetqr').count(), 1);
    // Inline title editing still works after the cover editor rebuilt the cover.
    await edit();
    await page.getByRole('button', { name: 'Apply cover' }).click();
    await page.locator('dialog.pc-editor').waitFor({ state: 'detached' });
    await page.locator('.pc-cover [data-ws-edit=title]').fill('Inline title');
    await page.locator('.pc-cover [data-ws-edit=title]').press('Tab');
    await parent.waitForFunction(() => sheet.title === 'Inline title');
    await page.pdf({ path: path.join(output, 'worksheet.pdf'), format: 'A4', printBackground: true });
  }
  // A phone can reach every control, and the dialog does not overflow sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await edit();
  assert.ok(await page.locator('dialog.pc-editor').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.locator('[name=title]').fill('A longer worksheet title about investigating materials and their properties with careful observations');
  await page.locator('.pc-editor-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'cover-editor-mobile.png') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Changing the signed-in account cannot write back through an old preview.
  await edit();
  const count = await parent.evaluate(() => writes.length);
  await parent.evaluate(() => { currentUser = { uid: 'another' }; });
  await page.getByRole('button', { name: 'Apply cover' }).click();
  await page.getByRole('status').filter({ hasText: 'account changed' }).waitFor();
  assert.equal(await parent.evaluate(() => writes.length), count);
  // Shareable preview: the actual renderer, with optional student lines and
  // no worksheet-specific QR. Also check the maximum permitted text lengths.
  const sample = await parent.evaluate(isScience => isScience
    ? _wsCoverHtml('Matter & Materials', 'Primary 5 · Practice worksheet', undefined, false)
    : wsCoverHtml('Fractions & Decimals', 'Primary 5 · Practice worksheet', false), science);
  const proof = await context.newPage();
  await proof.setViewportSize({ width: 710, height: 1000 });
  await proof.setContent('<!doctype html><html><body style="margin:0;width:178mm">' + sample + '</body></html>');
  await proof.locator('.pc-logo').evaluate(img => img.decode());
  await proof.locator('.pc-cover').screenshot({ path: path.join(output, science ? 'science-preview.png' : 'math-preview.png') });
  const longest = await parent.evaluate(() => WorksheetCover.render({
    title: 'W'.repeat(120), subtitle: 'W'.repeat(140), org: 'W'.repeat(120),
    name: 'W'.repeat(70), className: 'W'.repeat(40), date: 'W'.repeat(40), footer: 'W'.repeat(100)
  }, {extraHtml: '<div class="ws-sheetqr on-cover"><svg viewBox="0 0 20 20"><rect width="20" height="20"/></svg><div class="ws-sheetqr-cap">Scan for answers</div></div>'}));
  await proof.setContent('<!doctype html><html><body style="margin:0;width:178mm">' + longest + '</body></html>');
  const height = await proof.locator('.pc-cover').evaluate(el => el.getBoundingClientRect().height);
  assert.ok(height <= 252 * 96 / 25.4, 'Long cover text must fit one page: ' + height);
  assert.deepEqual(errors, []);
  console.log('PASS: rendering, local logo, edit/cancel, failed-save retry, persistence, reopen, mobile and account guard');
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
