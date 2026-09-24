// Exercise the real browser import functions with only pixel/network work stubbed.
// Run: node --test tools/crop-provenance-tests.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const RAW = 'data:image/png;base64,T1JJR0lOQUw=';
const CROP = 'data:image/png;base64,Q1JPUA==';
const ENHANCED = 'data:image/png;base64,RU5IQU5DRUQ=';
function functionText(name) {
  const pattern = new RegExp('(?:async )?function ' + name + '\\(');
  const start = src.search(pattern);
  const end = src.indexOf('\n}', start);
  assert.ok(start >= 0 && end >= start, 'missing real function ' + name);
  return src.slice(start, end + 2);
}
function world({ ready = false, crops = [], imageBlocks = [] } = {}) {
  const H = { ready, crops: crops.slice(), images: new Map(), blocks: imageBlocks, enhanced: ENHANCED };
  const names = ['_rememberCropSource', '_fillBlocksFromAiBoxes', '_cropPageImagesInto',
    '_autoFillDiagramsFromBoxes', '_autoFillDiagramFromUpload', '_epCropInto', '_autoChkApply'];
  const api = new Function('H', `
    let blocks = H.blocks, seq = 0;
    const _imgEnhanceState = {}, _BW_ENHANCE_PROMPT = 'enhance';
    const document = { getElementById: () => null };
    function showToast() {} function renderBlocks() {} function renderImgEnhanceBar() {} function previewImage() {}
    function saveBlockContent(id, field, value) { blocks.find(b => b.id === id)[field] = value; }
    function imageAiReady() { return H.ready; }
    async function _cropBoxFromScreenshot() { return H.crops.shift() || null; }
    async function _aiRefineCrop(value) { return value; }
    async function generateCleanEnhancedImage() { return H.enhanced; }
    async function uploadImageDataUrl(value) { const url = 'https://images.test/' + (++seq); H.images.set(url, value); return url; }
    function normalizeCategoryValue(value) { return value; }
    function applyMcqCategory() {} function qEnsurePartExplanations() {}
    function buildBlocksFromAi(payload) { return { blocks: payload.blocks.map((b, i) => ({ ...b, id: 'new-' + i })), selectedBlanks: {} }; }
    ${names.map(functionText).join('\n')}
    return { ${names.join(',')}, state: _imgEnhanceState };
  `)(H);
  return { H, ...api };
}
const image = id => ({ id, type: 'image', url: '' });
const persisted = value => JSON.parse(JSON.stringify(value));
const page = { mimeType: 'image/png', data: RAW.split(',')[1] };

test('successful and enhanced crops retain raw source, current identity and original rectangle', async () => {
  for (const ready of [false, true]) {
    const block = image('crop');
    const w = world({ ready, crops: [CROP] });
    const box = [100, 200, 600, 800];
    assert.equal(await w._fillBlocksFromAiBoxes([block], [box], page.mimeType, page.data, null, { page: 2 }), 1);
    const saved = persisted(block).cropSource;
    assert.equal(w.H.images.get(saved.url), RAW);
    assert.equal(saved.imageUrl, block.url);
    assert.equal(w.H.images.get(block.url), ready ? ENHANCED : CROP);
    assert.deepEqual(saved.box_2d, box);
    assert.equal(saved.page, 2);
    assert.notEqual(saved.url, saved.imageUrl);
  }
});

test('partial crop failures retain their own raw fallback without claiming crop coordinates', async () => {
  const blocks = [image('first'), image('fallback')];
  const w = world({ crops: [CROP, null] });
  await w._fillBlocksFromAiBoxes(blocks, [[100, 200, 600, 800], null], page.mimeType, page.data);
  assert.equal(blocks[0].cropSource.url, blocks[1].cropSource.url);
  assert.equal(blocks[1].cropSource.imageUrl, blocks[1].url);
  assert.equal(w.H.images.get(blocks[1].cropSource.url), RAW);
  assert.equal(blocks[1].cropSource.box_2d, undefined);
});

test('bulk and exam fallback images keep reloadable source metadata', async () => {
  for (const kind of ['bulk', 'exam']) {
    const blocks = [image(kind)];
    const w = world();
    const payload = { blocks: [{ type: 'image', box_2d: null }] };
    if (kind === 'bulk') await w._cropPageImagesInto(blocks, payload, page);
    else await w._epCropInto(blocks, payload, [page]);
    const source = persisted(blocks[0]).cropSource;
    assert.equal(w.H.images.get(source.url), RAW);
    assert.equal(source.imageUrl, blocks[0].url);
  }
});

test('multiple screenshots keep each figure attached to its own original page', async () => {
  const blocks = [image('one'), image('two')];
  const second = { mimeType: 'image/png', data: 'U0VDT05E' };
  const w = world({ imageBlocks: blocks });
  await w._autoFillDiagramsFromBoxes({ blocks: [{ type: 'image', page: 1 }, { type: 'image', page: 2 }] }, [page, second]);
  assert.equal(w.H.images.get(blocks[0].cropSource.url), RAW);
  assert.equal(w.H.images.get(blocks[1].cropSource.url), 'data:image/png;base64,U0VDT05E');
  assert.deepEqual(blocks.map(b => b.cropSource.page), [1, 2]);
});

test('whole-image fallback retains raw screenshot even when displayed image is enhanced', async () => {
  for (const ready of [false, true]) {
    const blocks = [image('whole')];
    const w = world({ ready, imageBlocks: blocks });
    await w._autoFillDiagramFromUpload(page.mimeType, page.data);
    const b = persisted(blocks[0]);
    assert.equal(w.H.images.get(b.cropSource.url), RAW);
    assert.equal(b.cropSource.imageUrl, b.url);
    assert.equal(w.H.images.get(b.url), ready ? ENHANCED : RAW);
    assert.equal(w.state.whole.originalDataUrl, RAW);
  }
});

test('rapid whole-page backup stores the raw upload separately from enhancement', async () => {
  const start = src.indexOf('    const wholePage = async () => {', src.indexOf('async function processRapidJob'));
  const end = src.indexOf('\n    };', start);
  assert.ok(start >= 0 && end > start);
  const factory = src.slice(start, end + '\n    };'.length);
  for (const ready of [false, true]) {
    const images = new Map();
    const run = new Function('images', 'ready', 'raw', 'enhanced', `
      let _pageBackup, seq = 0;
      const file = { type: 'image/png' }, b64 = raw.split(',')[1], many = false, jobId = 'job', _BW_ENHANCE_PROMPT = '';
      function imageAiReady() { return ready; }
      function _setRapidJobState() {} function renderVettingList() {}
      async function generateCleanEnhancedImage() { return enhanced; }
      async function uploadImageDataUrl(data) { const url = 'https://images.test/' + (++seq); images.set(url, data); return url; }
      ${factory}
      return wholePage;
    `)(images, ready, RAW, ENHANCED);
    const backup = await run();
    assert.equal(images.get(backup.originalUrl), RAW);
    assert.equal(backup.originalDataUrl, RAW);
    assert.equal(images.get(backup.url), ready ? ENHANCED : RAW);
    assert.equal(await run(), backup, 'one original upload is reused across all page questions');
  }
  assert.match(functionText('processRapidJob'), /_rememberCropSource\(b, page\.originalUrl\)/);
});

test('automatic rebuilds carry persisted provenance to replacement image IDs', () => {
  const w = world();
  const cropSource = { url: 'https://images.test/raw', imageUrl: 'https://images.test/crop', box_2d: [100, 200, 600, 800], page: 2 };
  const q = { blocks: [{ id: 'old', type: 'image', url: cropSource.imageUrl, cropSource }] };
  assert.equal(w._autoChkApply(q, { blocks: [{ type: 'image' }] }), true);
  assert.equal(q.blocks[0].id, 'new-0');
  assert.deepEqual(persisted(q.blocks[0].cropSource), cropSource);
});

test('source metadata omits malformed rectangles rather than trusting them', () => {
  const w = world();
  for (const box of [[100, 200, 50, 800], [-1, 0, 500, 500], [0, 0, 1001, 500], [0, '', 500, 500], [0, 0, NaN, 500]]) {
    const block = { url: 'https://images.test/crop' };
    w._rememberCropSource(block, 'https://images.test/raw', box);
    assert.equal(block.cropSource.box_2d, undefined);
  }
});
