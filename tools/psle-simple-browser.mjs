// 🎓 Science PSLE — the simple view, in a real Chromium (v1.450.0).
//
// Builds a page from index.html's own styles and markup (#page-psle and the
// #psleOverlay sheet), the SHIPPED simple-view block cut out of app.js, and
// the real past papers shipped in app.js (PP_SEED_Q, PP_THEME…), with every
// paper question "attached" to a fake bank question. Then it checks what a
// student sees on a computer and on a phone: a button per year and per topic,
// nothing wider than the screen, the sheet with its three actions, the topic
// sheet's year chips, and that each action calls the right door.
//
//   PW=/path/to/playwright/index.mjs node tools/psle-simple-browser.mjs
//   PSLE_SCREENSHOTS=artifacts/psle saves a picture of each step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

async function loadPlaywright() {
  for (const candidate of [process.env.PW, process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/npm-tools/node_modules/playwright/index.mjs', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(candidate); } catch (error) { /* next */ }
  }
  throw new Error('Playwright not found — set PW=/path/to/playwright/index.mjs');
}
const { chromium } = await loadPlaywright();

const slice = (from, to) => {
  const start = APP.indexOf(from); const end = APP.indexOf(to, start);
  assert.ok(start >= 0 && end > start, 'app.js still has ' + from);
  return APP.slice(start, end);
};
const markup = (from, to) => {
  const start = INDEX.indexOf(from); const end = INDEX.indexOf(to, start);
  assert.ok(start >= 0 && end > start, 'index.html still has ' + from);
  return INDEX.slice(start, end);
};

const styles = [...INDEX.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[0]).join('\n');
const pageHtml = markup('<div class="page" id="page-psle">', '<!-- ===== PAGE: TEACHING NOTES').replace('class="page" id="page-psle"', 'class="page active" id="page-psle"');
const overlayHtml = markup('<div class="overlay" id="psleOverlay"', '<!-- ==================== 📖 SEND TO STUDY BUDDY');
const seedAndThemes = slice('const PP_SEED_Q = [', 'let ppData = null;');
const simpleView = slice('// 🎓 SCIENCE PSLE — THE SIMPLE VIEW', '// End Science PSLE simple view');
// The REAL topic → level map and level colours: the topics are grouped by level (v1.450.2).
const literal = from => { const start = APP.indexOf(from); assert.ok(start >= 0, 'app.js still has ' + from); return APP.slice(start, APP.indexOf('\n};', start) + 3); };
const levelMaps = literal('const topicLevelMap = {') + '\n' + literal('const levelColors = {');

const script = `
${seedAndThemes}
window.calls = { practiceYear: [], practise: [], print: [], tsendOpen: [], tsendSend: 0, embed: [], toasts: [] };
const rows = PP_SEED_Q.map(q => Object.assign({}, q));
const ppQuestions = () => rows;
const ppYears = () => [...new Set(rows.map(q => String(q.year)))].sort();
const ppTopicOf = q => q.topic || '';
const ppTheme = topic => PP_THEME[topic] || 'diversity';
${levelMaps}
const TOPIC_LEVELS = ['P3', 'P4', 'P5', 'P6', 'S1'];
const isLevelCode = v => /^(?:P[3-6]|S1)$/.test(String(v || ''));
const levelGroupLabel = lv => (lv === 'S1' ? 'Secondary ' : 'Primary ') + String(lv || '').slice(1);
const customTopics = {};
const ppBankQ = id => /_40$/.test(id) ? null : { id: 'bank_' + id, title: id };   // one question per paper left unattached
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const showToast = (message, kind) => window.calls.toasts.push(message);
const loadPaperData = async () => {}, loadPaperMap = async () => {};
const ppPracticeYear = year => window.calls.practiceYear.push(year);
const launchWorksheetPractice = (questions, mode, options) => window.calls.practise.push(questions.length);
const ppCollectPrintable = ids => { const items = []; const missing = []; ids.forEach(id => { const bq = ppBankQ(id); if (bq) items.push({ bq, refs: [id] }); else missing.push(id); }); return { items, missing }; };
const _ppPrintQuestions = items => items.map(item => item.bq);
const _ppCoverHtml = title => '<div>' + title + '</div>';
const ppDoPrint = (items, missing, title, opts) => window.calls.print.push({ n: items.length, title, coverReady: !!(opts && opts.coverReady) });
const tsendOpen = ctx => window.calls.tsendOpen.push({ title: ctx.title, n: ctx.selected.length, savedId: ctx.savedId });
const tsendSend = () => { window.calls.tsendSend++; };
const appEmbedOpen = (page, params) => window.calls.embed.push({ page, params });
const navigateTo = () => {};
const currentUser = { uid: 'student-1', role: 'student' }, db = {}, TSEND_COLLECTION = 'tutorWorksheets';
const collection = () => ({}), where = () => ({}), limit = () => ({}), query = () => ({});
const getDocs = async () => ({ forEach() {} });
${simpleView}
Object.assign(window, { psleOpen, psleClose, psleSetYear, psleDo, renderPslePage, psleTopicSummaries, psleYearSummaries });
renderPslePage().then(() => { window.__ready = true; });
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${styles}
<style>.main-content{margin-left:0}</style></head><body><main class="main-content">${pageHtml}</main>${overlayHtml}
<script type="module">${script}</script></body></html>`;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const screenshots = process.env.PSLE_SCREENSHOTS;
if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };

async function open(viewport, mobile) {
  const context = await browser.newContext(Object.assign({ viewport }, mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'psle.test') return route.abort();
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://psle.test/');
  await page.waitForFunction(() => window.__ready, null, { timeout: 10000 }).catch(error => { throw new Error(errors.join('\n') || error.message); });
  return { context, page, errors };
}
const shot = async (page, name) => { if (screenshots) await page.screenshot({ path: path.join(screenshots, name + '.png'), fullPage: true }); };

// A computer.
{
  const { context, page, errors } = await open({ width: 1280, height: 900 }, false);
  const expectedYears = await page.evaluate(() => psleYearSummaries().length);
  const expectedTopics = await page.evaluate(() => psleTopicSummaries().length);
  ok(expectedYears >= 5, 'the shipped papers give several years (' + expectedYears + ')');
  ok(await page.locator('.psle-pick-year').count() === expectedYears, 'a button per year');
  ok(await page.locator('.psle-pick-topic').count() === expectedTopics, 'a button per topic');
  const heads = (await page.locator('.psle-group-head').allTextContents()).map(t => t.trim());
  const ladder = ['Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'Secondary 1', 'Other topics'];
  ok(heads.length >= 4 && heads.every(h => ladder.includes(h)), 'topics are grouped under level headings (' + heads.join(', ') + ')');
  ok(heads.every((h, i) => i === 0 || ladder.indexOf(heads[i - 1]) < ladder.indexOf(h)), 'the level groups run P3 → S1, in order');
  ok(await page.locator('.psle-group[data-level="P3"] .psle-pick-topic').count() > 0, 'Primary 3 holds its topics');
  ok(!(await page.textContent('#psleBody')).match(/\b(DIVERSITY|Diversity|Interactions)\b/), 'no syllabus-theme headings');
  const firstYear = await page.locator('.psle-pick-year .psle-pick-title').first().textContent();
  const years = await page.evaluate(() => psleYearSummaries().map(y => y.year));
  ok(firstYear.trim() === years[0] && years[0] > years[years.length - 1], 'newest year first');
  await shot(page, 'desktop');

  await page.locator('.psle-pick-year').first().click();
  ok(await page.locator('#psleOverlay.show').count() === 1, 'the sheet opens');
  ok(await page.locator('#psleOverlay .psle-action').count() === 3, 'three actions');
  ok((await page.textContent('#psleSheetTitle')).trim() === 'PSLE ' + years[0], 'titled with the year');
  ok(await page.locator('#psleSheetYears').isHidden(), 'a year sheet has no year chips');
  await shot(page, 'desktop-sheet-year');
  await page.locator('#psleOverlay .psle-action[data-action="practice"]').click();
  ok(await page.evaluate(() => window.calls.practiceYear[0]) === years[0], '▶ Practice runs that year');
  ok(await page.locator('#psleOverlay.show').count() === 0, 'and the sheet closes');

  await page.locator('.psle-pick-year').first().click();
  await page.locator('#psleOverlay .psle-action[data-action="pdf"]').click();
  const printed = await page.evaluate(() => window.calls.print[0]);
  ok(printed && printed.coverReady && printed.title === 'PSLE ' + years[0] + ' Science Paper', '📄 Export PDF prints the paper with no cover dialog');

  await page.locator('.psle-pick-year').first().click();
  await page.locator('#psleOverlay .psle-action[data-action="tutor"]').click();
  await page.waitForFunction(() => window.calls.tsendSend === 1);
  const sent = await page.evaluate(() => window.calls.tsendOpen[0]);
  ok(sent.savedId === 'psle:year:' + years[0] && sent.n > 0, '📖 Study Buddy sends the paper as the student\'s copy');

  // A topic: its years as chips, and a chip narrows the count.
  await page.locator('.psle-pick-topic', { hasText: 'Heat' }).first().click();
  ok(await page.locator('#psleSheetYears').isVisible(), 'a topic sheet offers its years');
  const allLine = await page.textContent('#psleSheetSub');
  await page.locator('#psleSheetYears .psle-chip').nth(1).click();
  const oneLine = await page.textContent('#psleSheetSub');
  ok(/from every year/.test(allLine) && /from PSLE \d{4}/.test(oneLine), 'picking a year narrows it: ' + oneLine);
  await shot(page, 'desktop-sheet-topic');
  await page.keyboard.press('Escape');
  ok(errors.length === 0, 'no page errors: ' + errors.join('; '));
  await context.close();
}

// A phone.
{
  const { context, page, errors } = await open({ width: 390, height: 844 }, true);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(width <= 390, 'nothing wider than the phone (' + width + 'px)');
  const yearBox = await page.locator('.psle-pick-year').first().boundingBox();
  ok(yearBox.width >= 96 && yearBox.height >= 84, 'year buttons are big enough to tap');
  await shot(page, 'phone');
  await page.locator('.psle-pick-topic').first().tap();
  const sheet = await page.locator('#psleOverlay .overlay-card').boundingBox();
  ok(sheet.x >= 0 && sheet.x + sheet.width <= 390 && sheet.y + sheet.height <= 844, 'the sheet fits the phone');
  await shot(page, 'phone-sheet');
  ok(errors.length === 0, 'no page errors: ' + errors.join('; '));
  await context.close();
}

await browser.close();
console.log(`psle-simple-browser: ${checks} checks passed`);
