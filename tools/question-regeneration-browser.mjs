// Real copy-first optional-command modal, CSS and approval controller. Checker, AI and
// persistence calls use deterministic fixtures, without opening an account.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { regenerationHarnessBody, htmlSource, sampleQuestion, sampleFindings, samplePlan } from './question-regeneration-tests.mjs';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browserPath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const browser = await playwright.chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
const output = process.env.QUESTION_REGENERATION_QA_DIR || fileURLToPath(new URL('../../question-regeneration-qa/', import.meta.url));
fs.mkdirSync(output, { recursive: true });
const css = [...htmlSource.slice(0, htmlSource.indexOf('</head>')).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
const checkStart = htmlSource.indexOf('<div class="tl-overlay" id="tlOverlay"');
const checkEnd = htmlSource.indexOf('<!-- ==================== 🎯 RE-FILE', checkStart);
const commandStart = htmlSource.indexOf('<div class="confirm-overlay" id="regenOverlay"');
const commandEnd = htmlSource.indexOf('<!-- ==================== STUDENT ACTIVITY DETAIL', commandStart);
assert.ok(checkStart >= 0 && checkEnd > checkStart && commandStart >= 0 && commandEnd > commandStart, 'The shipped check and regeneration dialogs exist');
const modals = htmlSource.slice(checkStart, checkEnd) + htmlSource.slice(commandStart, commandEnd);
const coreSource = fs.readFileSync(new URL('../question-repair-core.mjs', import.meta.url), 'utf8');
const cropSource = fs.readFileSync(new URL('../question-crop-core.mjs', import.meta.url), 'utf8');
const body = regenerationHarnessBody();
const results = [];

async function fixture(width, height = 900, scope = 'create') {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 390, isMobile: width === 390 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/question-repair-core.mjs')) return route.fulfill({ contentType: 'text/javascript', body: coreSource });
    if (pathname.endsWith('/question-crop-core.mjs')) return route.fulfill({ contentType: 'text/javascript', body: cropSource });
    const launcher = '<button type="button" class="btn btn-outline em-qbtn" id="fixtureLaunchBtn" onclick="' + (scope === 'em' ? "openQuestionRegenerator('one')" : 'openRegenerateModal()') + '">Plan regeneration</button>';
    const editor = scope === 'em' ? '<div class="em-overlay show"><div class="em-head"><h3>Editing mode</h3>' + launcher + '</div><div class="em-body">Two questions are being edited.</div></div>' : launcher;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body' + (scope === 'em' ? ' class="em-editing"' : '') + '>' + editor + modals + '</body></html>' });
  });
  await page.goto('https://question-regeneration.test/');
  await page.evaluate(async ({ body, question, findings, plan, scope }) => {
    const core = { ...await import('/question-repair-core.mjs'), ...await import('/question-crop-core.mjs') };
    const h = window.qa = new Function('core', 'env', body)(core, { question, findings, plan, document, window, scope });
    for (const [name, fn] of Object.entries(h)) if (typeof fn === 'function') window[name] = fn;
    window.tlClosePanel = () => { h.tlRepairReset(); document.getElementById('tlOverlay').classList.remove('show'); };
    window.tlRecheck = () => {};
    window.tlPanelEdit = () => {};
    document.getElementById('tlPanelTitle').textContent = question.title;
    document.getElementById('tlPanelSub').textContent = 'Matter and its 3 States · Multiple Choice Question';
    if (scope === 'em') {
      h.em.on = true;
      const other = { id: 'other', type: 'plainanswer', content: 'Another question remains untouched.' };
      h.blocks = [...h.blocks, other];
      h.em.owner.other = 'q2';
      h.em.qs.push({ id: 'q2', key: 'two', title: 'Other question' });
      h.editorKeywords.other = ['unrelated'];
      h.selectedBlanks.other = [1];
    }
  }, { body, question: sampleQuestion(), findings: sampleFindings(), plan: samplePlan(true), scope });
  return { page, errors, close: () => context.close() };
}

async function withinViewport(page, selector, width, height) {
  const rect = await page.locator(selector).boundingBox();
  assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1, selector + ' stays within the viewport');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal page overflow');
}

try {
  for (const [width, height] of [[1280, 900], [390, 900], [390, 500]]) {
    const f = await fixture(width, height), page = f.page;
    try {
      await page.locator('#fixtureLaunchBtn').click();
      assert.equal(await page.locator('#regenOverlay').isVisible(), true);
      assert.equal(await page.locator('#regenConfirmBtn').isEnabled(), true, 'Blank instructions can prepare an autonomous plan');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'regenRemark');
      await withinViewport(page, '.regen-dialog', width, height);
      await page.locator('#regenConfirmBtn').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'regenRemark', 'Keyboard focus stays inside the modal');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'regenConfirmBtn');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#regenOverlay').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'fixtureLaunchBtn', 'Escape restores the launcher focus');
      assert.deepEqual(await page.evaluate(() => [qa.H.ai.length, qa.H.image.length, qa.H.checks.length, qa.H.saves.length]), [0, 0, 0, 0]);
      await page.locator('#fixtureLaunchBtn').click();
      await page.locator('#regenRemark').fill('Use three sealed containers and redraw the matching figure.');
      for (const id of ['regenCancelBtn', 'regenConfirmBtn']) {
        await page.locator('#' + id).scrollIntoViewIfNeeded();
        assert.ok((await page.locator('#' + id).boundingBox()).height >= 44, id + ' is a usable touch target');
      }
      await page.screenshot({ path: path.join(output, 'regeneration-command-' + width + '-' + height + '.png'), fullPage: true });
      await page.locator('#regenConfirmBtn').click();
      await page.waitForFunction(() => qa.session?.stage === 'ready');
      assert.equal(await page.locator('#regenOverlay').isVisible(), false);
      assert.equal(await page.locator('#tlOverlay').isVisible(), true);
      assert.equal(await page.locator('#tlRepairApplyBtn').innerText(), 'Approve regeneration plan');
      assert.equal(await page.locator('#tlRepairActions > li').count(), 2);
      assert.ok(await page.evaluate(() => qa.H.ai[0].prompt.includes('Use three sealed containers')));
      assert.deepEqual(await page.evaluate(() => [qa.H.image.length, qa.H.uploads.length, qa.H.saves.length, qa.H.checks.length]), [0, 0, 1, 1]);
      assert.ok(await page.evaluate(() => qa.bank.length === 2 && qa.session.id !== 'q1' && qa.session.scope === 'bank' && qa.bank[1].regeneratedFrom === 'q1'));
      assert.equal(await page.evaluate(() => qa.H.checks[0].id), await page.evaluate(() => qa.session.id));
      await withinViewport(page, '.tl-panel', width, height);
      await page.locator('#tlRepairReviseBtn').click();
      await page.locator('#tlRepairInstruction').fill('');
      assert.equal(await page.locator('#tlRepairUpdateBtn').isEnabled(), true);
      assert.equal(await page.locator('#tlRepairApplyBtn').isEnabled(), false);
      await page.locator('#tlRepairUpdateBtn').click();
      await page.waitForFunction(() => qa.session?.stage === 'ready' && qa.H.ai.length === 2);
      assert.equal(await page.evaluate(() => qa.session.instruction), '');
      for (const id of ['tlRepairApplyBtn', 'tlRepairReviseBtn', 'tlRepairCancelBtn']) {
        await page.locator('#' + id).scrollIntoViewIfNeeded();
        assert.ok((await page.locator('#' + id).boundingBox()).height >= 44, id + ' is a usable touch target');
      }
      await page.screenshot({ path: path.join(output, 'regeneration-plan-' + width + '-' + height + '.png'), fullPage: true });
      await page.locator('#tlRepairCancelBtn').click();
      assert.deepEqual(await page.evaluate(() => [qa.H.image.length, qa.H.saves.length, qa.blocks[0].content]), [0, 1, sampleQuestion().blocks[0].content]);
      assert.equal(await page.evaluate(() => qa.bank[1].blocks[0].content), sampleQuestion().blocks[0].content);
      assert.deepEqual(f.errors, []);
      results.push({ width, height, checks: 'optional command, modal focus and Escape, duplicate saved before checker and plan, autonomous revision reuses copy, approval-only regeneration, cancel retains copy, bounds and touch targets' });
    } finally { await f.close(); }
  }
  const f = await fixture(1280, 900, 'em'), page = f.page;
  try {
    await page.locator('#fixtureLaunchBtn').click();
    assert.ok(await page.locator('#regenRemark').evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + 10, r.y + 10)); }), 'The regeneration modal opens above worksheet editing mode');
    await page.locator('#regenConfirmBtn').click();
    await page.waitForFunction(() => qa.session?.stage === 'ready');
    assert.equal(await page.evaluate(() => qa.session.scope), 'bank');
    assert.equal(await page.evaluate(() => qa.bank[1].regeneratedFrom), 'q1');
    const copyId=await page.evaluate(() => qa.session.id);
    assert.equal(await page.evaluate(() => qa.H.checks[0].blocks.length), sampleQuestion().blocks.length);
    await page.locator('#tlRepairApplyBtn').click();
    await page.waitForFunction(() => qa.session?.stage === 'applied');
    assert.equal(await page.evaluate(() => qa.H.image.length), 1);
    assert.equal(await page.evaluate(() => qa.H.checks.length), 2);
    assert.equal(await page.evaluate(() => qa.H.saves.length), 2);
    assert.equal(await page.evaluate(() => qa.bank.find(q=>q.id===qa.session.id).blocks[1].url), 'https://fixtures.test/redrawn.png');
    assert.equal(await page.evaluate(() => qa.blocks[1].url), sampleQuestion().blocks[1].url);
    assert.deepEqual(await page.evaluate(() => qa.bank.find(q=>q.id==='q1')), sampleQuestion());
    assert.deepEqual(await page.evaluate(() => qa.em.qs.map(q=>q.id)), ['q1','q2']);
    assert.deepEqual(await page.evaluate(() => [qa.blocks.find(b => b.id === 'other').content, qa.em.owner.other, qa.editorKeywords.other, qa.selectedBlanks.other]), ['Another question remains untouched.', 'q2', ['unrelated'], [1]]);
    await page.screenshot({ path: path.join(output, 'regeneration-worksheet-approved.png'), fullPage: true });
    await page.locator('#tlRepairUndoBtn').click();
    await page.waitForFunction(() => qa.bank.find(q=>q.id===qa.session.id).blocks[1].url === 'https://fixtures.test/original.png');
    assert.equal(await page.evaluate(() => qa.session.id), copyId);
    assert.equal(await page.evaluate(() => qa.H.saves.length), 3);
    assert.equal(await page.evaluate(() => qa.blocks[0].content), sampleQuestion().blocks[0].content);
    assert.deepEqual(f.errors, []);
    results.push({ scope: 'em', checks: 'per-question launcher, modal stacking, saved bank duplicate, approved exact wording and image saved only to copy, follow-up checker, all worksheet members preserved, copy undo' });
  } finally { await f.close(); }
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
