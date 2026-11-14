// Polymath Mind Map — a real-browser check of the page, with the Firebase/AI services and the
// access gate replaced by fixtures (tools/mindmap-fixtures/), so it needs no account and no network.
//   npm install --no-save playwright && npx playwright install chromium && node tools/mindmap-browser.mjs
// MINDMAP_SCREENSHOTS=<dir> saves screenshots.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tools', 'mindmap-fixtures');
const shots = process.env.MINDMAP_SCREENSHOTS || '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

async function open(browser, { staff = false, phone = false } = {}) {
  const ctx = await browser.newContext(phone ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.addInitScript(s => { window.__asStaff = s; }, staff);
  await page.route('**/mindmap/mindmap-services.js*', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(fixtures, 'stub-services.js'), 'utf8') }));
  await page.route('**/student/access-gate.js*', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(fixtures, 'stub-gate.js'), 'utf8') }));
  await page.route(/^https:\/\//, r => r.fulfill({ status: 404, body: '' }));
  await page.goto(base + '/mindmap/');
  await page.waitForSelector('.mm-node.is-root', { timeout: 15000 });
  return { page, errors, ctx };
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };

const browser = await chromium.launch();
try {
  // ── A student builds a map by typing a command (the same path as speech) ──
  {
    const { page, errors, ctx } = await open(browser);
    await page.keyboard.type('Plants');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('.mm-node.is-root .mm-text', e => e.textContent), 'Plants', 'typing renames the centre');
    await page.fill('#commandInput', 'make a map about plants');
    await page.press('#commandInput', 'Enter');
    await page.waitForSelector('.mm-node.type-image img.pic', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('.mm-node.type-question').length === 2, null, { timeout: 15000 });
    await page.waitForFunction(() => (document.querySelector('.code-frame') || {}).srcdoc?.includes('Water travel'), null, { timeout: 15000 });
    const info = await page.evaluate(() => ({
      topics: [...document.querySelectorAll('.mm-node.type-topic .mm-text')].map(e => e.textContent),
      scripts: document.querySelectorAll('.q-body script, .q-body [onerror]').length,
      sandbox: document.querySelector('.code-frame').getAttribute('sandbox'),
      links: document.querySelectorAll('path.link').length,
      title: document.querySelector('#mapTitle').value
    }));
    assert.deepEqual(info.topics, ['Plants', 'Roots', 'Absorb water', 'Stem', 'Carries water up', 'Leaves']);
    assert.equal(info.scripts, 0, 'question HTML is sanitised');
    assert.ok(!info.sandbox.includes('allow-same-origin'));
    assert.equal(info.links, 1);
    assert.equal(info.title, 'Plants');
    // Each topic is one line wide, not one letter wide.
    const rootBox = await page.$eval('.mm-node.is-root', e => ({ w: e.offsetWidth, h: e.offsetHeight }));
    assert.ok(rootBox.w > rootBox.h, 'the centre is wider than tall');
    // The app's console reaches the window, and it cannot reach this page.
    await page.waitForFunction(() => [...document.querySelectorAll('.mm-node.type-code .code-console div')].some(d => /sandbox ok: SecurityError/.test(d.textContent)), null, { timeout: 10000 });
    await page.click('#zoomFit');
    await page.waitForTimeout(500);
    await shot(page, 'student-built');

    // The question picker shows only this student's levels (P3–P4) and nothing held back.
    await page.click('.mm-node.is-root');
    await page.click('#toolQuestion');
    await page.waitForSelector('.q-tile');
    assert.equal(await page.$$eval('.q-tile', t => t.length), 9);
    const levels = await page.$$eval('.q-tile .q-meta span:first-child', s => [...new Set(s.map(x => x.textContent))].sort());
    assert.deepEqual(levels, ['P3', 'P4']);
    await page.click('.q-tile >> nth=0');
    await page.click('.q-tile >> nth=0');
    await page.click('.q-tile >> nth=1 >> .q-check');
    await shot(page, 'student-picker');
    await page.click('[data-view="list"]');
    await page.click('[data-pk="place"]');
    await page.waitForFunction(() => document.querySelectorAll('.mm-node.type-question').length === 4);
    // Checking an MCQ answer on the map.
    const mcq = page.locator('.mm-node.type-question [data-option-id="o1"]').first();
    await mcq.click();
    await page.waitForSelector('.mm-node.type-question .qc-answer');

    // v1.1.0: a question card folds to one line and opens again.
    const firstQ = page.locator('.mm-node.type-question').first();
    const qid = await firstQ.getAttribute('data-id');
    const openBox = await firstQ.boundingBox();
    // The card may sit outside the visible canvas (the canvas is panned, not scrolled), so the click is dispatched.
    await firstQ.locator('.q-fold').dispatchEvent('click');
    await page.waitForSelector(`.mm-node[data-id="${qid}"].is-folded .q-mini`);
    const foldedBox = await page.locator(`.mm-node[data-id="${qid}"]`).boundingBox();
    assert.ok(foldedBox.height < openBox.height, 'a folded card is shorter than an open one');
    assert.equal(await page.locator(`.mm-node[data-id="${qid}"] .q-body`).count(), 0, 'a folded card hides the question body');
    await page.locator(`.mm-node[data-id="${qid}"] .q-mini`).dispatchEvent('click');
    await page.waitForSelector(`.mm-node[data-id="${qid}"]:not(.is-folded) .q-body`);
    await shot(page, 'student-question-folding');

    // v1.1.0: questions placed on their own are free-standing containers, attached to no topic.
    const branchesBefore = await page.$$eval('path.branch', p => p.length);
    await page.click('.mm-node.is-root');
    await page.click('#toolQuestion');
    await page.waitForSelector('.q-tile');
    await page.click('[data-pk-where="free"]');
    await page.check('[data-pk-folded]');
    await page.click('.q-tile >> nth=2 >> .q-check');
    await page.click('.q-tile >> nth=3 >> .q-check');
    assert.match(await page.textContent('.modal-foot .grow'), /on its own/);
    await page.click('[data-pk="place"]');
    await page.waitForFunction(() => document.querySelectorAll('.mm-node.type-question.is-free.is-folded').length === 2);
    assert.equal(await page.$$eval('path.branch', p => p.length), branchesBefore, 'no branch is drawn to a free-standing question');
    await page.waitForTimeout(450);
    await shot(page, 'student-free-questions');
    // Tidy-up leaves them where they are.
    const freeId = await page.getAttribute('.mm-node.type-question.is-free >> nth=0', 'data-id');
    const spotBefore = await page.$eval(`.mm-node[data-id="${freeId}"]`, e => [e.style.left, e.style.top]);
    await page.click('#toolTidy');
    await page.waitForTimeout(500);
    assert.deepEqual(await page.$eval(`.mm-node[data-id="${freeId}"]`, e => [e.style.left, e.style.top]), spotBefore, 'tidy-up does not move a free question');
    // An attached question can be made to stand on its own from the panel.
    const head = page.locator(`.mm-node[data-id="${qid}"] .q-head`);
    await head.dispatchEvent('pointerdown', { pointerId: 7, button: 0, isPrimary: true });
    await head.dispatchEvent('pointerup', { pointerId: 7, button: 0, isPrimary: true });
    if (await page.locator('#inspectorToggle').isVisible()) await page.click('#inspectorToggle');
    await page.waitForSelector('[data-i="detach"]');
    await page.click('[data-i="detach"]');
    await page.waitForSelector(`.mm-node[data-id="${qid}"].is-free`);

    // Keyboard building, undo.
    await page.click('.mm-node.is-root');
    const before = await page.$$eval('.mm-node', n => n.length);
    await page.keyboard.press('Tab');
    await page.keyboard.type('Flowers');
    await page.keyboard.press('Enter');
    assert.ok((await page.$$eval('.mm-node .mm-text', n => n.map(x => x.textContent))).includes('Flowers'));
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    assert.equal(await page.$$eval('.mm-node', n => n.length), before, 'undo removes the new topic');

    // It saved, to mindmaps/{id}, owned by this account.
    await page.waitForFunction(() => window.__saves >= 1);
    // The newest save (the page saves 1.4 s after the last change) holds the free-standing questions.
    await page.waitForFunction(() => [...window.__store.entries()].some(([k, v]) => k.startsWith('mindmaps/') && v.ownerUid === 'student1' && v.nodes.filter(n => n.type === 'question' && !n.parentId).length >= 2), null, { timeout: 10000 });
    const saved = await page.evaluate(() => [...window.__store.entries()].filter(([k, v]) => k.startsWith('mindmaps/') && v.ownerUid === 'student1').map(([, v]) => v));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].ownerUid, 'student1');
    assert.ok(saved[0].nodes.length >= 10);
    const savedFree = saved[0].nodes.filter(n => n.type === 'question' && !n.parentId);
    assert.ok(savedFree.length >= 2, 'free-standing questions are saved with no parent');
    assert.ok(savedFree.every(n => n.question.folded === true || n.id === qid), 'and they were saved folded');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  // ── v1.2.0: a student sees Mr Chung's Maps above their own, read-only, and can make a copy ──
  {
    const { page, errors, ctx } = await open(browser);
    await page.waitForSelector('.toast:has-text("Mr Chung")', { timeout: 10000 });
    await page.click('#mapsBtn');
    await page.waitForSelector('#mmPublished .map-card');
    const sections = await page.$$eval('.maps-section h3', h => h.map(x => x.textContent.trim()));
    assert.deepEqual(sections, ["📌 Mr Chung's Maps", '🗂 My maps'], 'Mr Chung\'s Maps come first, then the student\'s own');
    const pubTitles = await page.$$eval('#mmPublished .map-card b', b => b.map(x => x.textContent));
    assert.deepEqual(pubTitles, ['Forces (from class)'], 'only maps a publisher published are listed');
    assert.equal(await page.$$eval('#mmPublished [data-del], #mmPublished [data-pub]', b => b.length), 0, 'a student cannot delete or unpublish them');
    assert.ok(await page.$$eval('#mmList .map-card', c => c.length) >= 1, 'their own maps are below');
    assert.equal(await page.$$eval('#mmList [data-pub]', b => b.length), 0, 'students have no publish button');
    await shot(page, 'student-maps-modal');
    await page.click('#mmPublished .map-card');
    await page.waitForSelector('#readonlyBanner:not([hidden])');
    assert.match(await page.textContent('#readonlyText'), /Mr Chung's Maps/);
    assert.ok(await page.$eval('#publishMenuItem', e => e.hidden), 'no publish item for students');
    assert.deepEqual(await page.$$eval('.mm-node .mm-text', n => n.map(x => x.textContent)), ['Forces', 'Friction']);
    await page.click('#copySharedBtn');
    await page.waitForSelector('#readonlyBanner[hidden]', { state: 'attached' });
    await page.waitForFunction(() => [...window.__store.values()].some(v => v.ownerUid === 'student1' && v.title === 'Forces (from class)'));
    const copy = await page.evaluate(() => [...window.__store.values()].find(v => v.ownerUid === 'student1' && v.title === 'Forces (from class)'));
    assert.equal(copy.published, false, 'a student\'s copy is private');
    assert.equal((await page.evaluate(() => window.__store.get('mindmaps/mPubChung1'))).nodes.length, 2, 'the original is untouched');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  // ── v1.2.0: Mr Chung chooses which of his maps are published ──
  {
    const { page, errors, ctx } = await open(browser, { staff: true });
    await page.waitForFunction(() => [...window.__store.values()].some(v => v.ownerUid === 'student1'));
    const myId = await page.evaluate(() => [...window.__store.values()].find(v => v.ownerUid === 'student1').id);
    await page.click('#mapsBtn');
    await page.waitForSelector(`#mmList [data-pub="${myId}"]`);
    await page.click(`#mmList [data-pub="${myId}"]`);
    await page.waitForFunction(id => window.__store.get('mindmaps/' + id).published === true, myId);
    await page.waitForSelector(`#mmPublished [data-open="${myId}"]`);
    await shot(page, 'staff-maps-modal');
    assert.ok(await page.$eval('#publishChip', e => !e.hidden), 'the open map shows it is published');
    await page.keyboard.press('Escape');
    await page.click('#moreBtn');
    assert.match(await page.textContent('#publishMenuItem'), /Unpublish/);
    await page.click('#publishMenuItem');
    await page.waitForFunction(id => window.__store.get('mindmaps/' + id).published === false, myId);
    assert.ok(await page.$eval('#publishChip', e => e.hidden));
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  // ── Staff see every level, and answers ──
  {
    const { page, errors, ctx } = await open(browser, { staff: true });
    await page.click('#toolQuestion');
    await page.waitForSelector('.q-tile');
    assert.equal(await page.$$eval('.q-tile', t => t.length), 14);
    await page.click('.q-tile >> nth=1');
    await page.click('#pkAnswer');
    await page.waitForSelector('#pkPreview .qc-answer, #pkPreview .qc-option.is-right');
    assert.ok(await page.$eval('#versionBadge', e => !e.hidden), 'staff see the version badge');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  // ── Phone ──
  {
    const { page, errors, ctx } = await open(browser, { phone: true });
    await page.fill('#commandInput', 'make a map about plants');
    await page.press('#commandInput', 'Enter');
    await page.waitForSelector('.mm-node.type-image img.pic', { timeout: 15000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'no sideways scrolling on a phone');
    await shot(page, 'phone');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  console.log('mindmap browser checks passed');
} finally {
  await browser.close();
  server.close();
}
