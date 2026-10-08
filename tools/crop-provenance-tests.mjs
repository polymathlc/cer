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
function world({ ready = false, crops = [], imageBlocks = [], hooks = {} } = {}) {
  const H = { ready, crops: crops.slice(), images: new Map(), blocks: imageBlocks, enhanced: ENHANCED, hooks };
  const names = ['_rapidFigureMap', '_rememberCropSource', '_fillBlocksFromAiBoxes', '_cropPageImagesInto',
    '_autoFillDiagramsFromBoxes', '_autoFillDiagramFromUpload', '_epCropInto', '_autoChkApply'];
  const api = new Function('H', `
    let blocks = H.blocks, seq = 0;
    const _imgEnhanceState = {}, _BW_ENHANCE_PROMPT = 'enhance';
    const document = { getElementById: () => null };
    function showToast() {} function renderBlocks() {} function renderImgEnhanceBar() {} function previewImage() {}
    function saveBlockContent(id, field, value) { blocks.find(b => b.id === id)[field] = value; }
    function imageAiReady() { return H.ready; }
    async function _cropBoxFromScreenshot() { return H.crops.shift() || null; }
    async function _cropBoxFromScreenshotEx(full, box) { if (H.hooks.cut) return H.hooks.cut(full, box); const c = H.crops.shift(); return c ? { dataUrl: c } : null; }
    function decisionsGateOn() { return false; } function _canAuthor() { return true; }
    async function _aiRefineCrop(value, wording, source) { return H.hooks.refine ? H.hooks.refine(value, wording, source) : value; }
    function _cropWordingOf() { return ''; }
    async function generateCleanEnhancedImage(prompt, media) { return H.hooks.enhance ? H.hooks.enhance(prompt, media) : H.enhanced; }
    async function uploadImageDataUrl(value) { if (H.hooks.upload) await H.hooks.upload(value); const url = 'https://images.test/' + (++seq); H.images.set(url, value); return url; }
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
  const start = src.indexOf('    let sourceUpload;', src.indexOf('async function processRapidJob'));
  const wholeStart = src.indexOf('    const wholePage = async () => {', start);
  const end = src.indexOf('\n    };', wholeStart);
  assert.ok(start >= 0 && end > start);
  const factory = src.slice(start, end + '\n    };'.length);
  for (const ready of [false, true]) {
    const images = new Map();
    const { run, sourcePageUrl } = new Function('images', 'ready', 'raw', 'enhanced', `
      let seq = 0;
      const file = { type: 'image/png' }, b64 = raw.split(',')[1], many = false, jobId = 'job', _BW_ENHANCE_PROMPT = '';
      function imageAiReady() { return ready; }
      function _setRapidJobState() {} function renderVettingList() {}
      async function generateCleanEnhancedImage() { return enhanced; }
      async function uploadImageDataUrl(data) { const url = 'https://images.test/' + (++seq); images.set(url, data); return url; }
      ${factory}
      return { run: wholePage, sourcePageUrl };
    `)(images, ready, RAW, ENHANCED);
    const sourceUrls = await Promise.all([sourcePageUrl(), sourcePageUrl(), sourcePageUrl()]);
    assert.ok(sourceUrls.every(url => url === sourceUrls[0]), 'overlapping source requests share one upload promise');
    assert.equal(images.size, 1);
    const backup = await run();
    assert.equal(images.get(backup.originalUrl), RAW);
    assert.equal(backup.originalDataUrl, RAW);
    assert.equal(images.get(backup.url), ready ? ENHANCED : RAW);
    assert.equal(await run(), backup, 'one original upload is reused across all page questions');
    assert.equal(backup.originalUrl, sourceUrls[0]);
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

const waitTurn = () => new Promise(resolve => setImmediate(resolve));
test('simultaneous pages share bounded figure work while out-of-order completion keeps slots and enhancement budgets', async () => {
  let prep = 0, prepPeak = 0, writes = 0, writePeak = 0;
  const enhanced = [], refined = [];
  const cropOf = i => 'data:image/png;base64,CROP_' + i;
  const cleanOf = i => 'data:image/png;base64,CLEAN_' + i;
  const w = world({ ready: true, hooks: {
    cut: async (full, box) => box[0] === 1 ? null : { dataUrl: cropOf(box[0]) },
    refine: async (value, wording, source) => {
      const i = Number(value.split('_').at(-1));
      prep++; prepPeak = Math.max(prepPeak, prep);
      await waitTurn(); if (i % 5 === 0) await waitTurn();
      prep--; refined.push(i);
      source.ex = { ...source.ex, dataUrl: cleanOf(i), checkedOnPage: source.page };
      return source.ex.dataUrl;
    },
    enhance: async (prompt, media) => {
      const i = Number(media[0].data.split('_').at(-1)); enhanced.push(i);
      writes++; writePeak = Math.max(writePeak, writes);
      await waitTurn(); if (i % 5 === 0) await waitTurn(); writes--;
      return 'data:image/png;base64,ENHANCED_' + i;
    }
  } });
  const first = Array.from({ length: 5 }, (_, i) => image('a' + i));
  const second = Array.from({ length: 5 }, (_, i) => image('b' + i));
  let begun = 0;
  const options = { onEnhance: () => begun++ };
  const counts = await Promise.all([
    w._fillBlocksFromAiBoxes(first, first.map((_, i) => [i, 0, 600, 800]), page.mimeType, page.data, null, options),
    w._fillBlocksFromAiBoxes(second, second.map((_, i) => [i + 5, 0, 600, 800]), page.mimeType, page.data, null, options)
  ]);
  assert.deepEqual(counts, [4, 5]);
  assert.equal(prepPeak, 3, 'a global bound across both pages');
  assert.equal(writePeak, 2, 'image calls share a separate global bound');
  assert.ok(refined.indexOf(2) < refined.indexOf(0), 'the fixture actually completed out of order');
  assert.deepEqual(enhanced.slice().sort((a, b) => a - b), [0, 2, 3, 5, 6, 7], 'only the first three eligible SOURCE slots per page are enhanced');
  assert.equal(begun, 6, 'one budget callback per image call actually started');
  for (const [offset, blocks] of [[0, first], [5, second]]) {
    blocks.forEach((block, local) => {
      const i = offset + local;
      const stored = w.H.images.get(block.url);
      if (i === 1) {
        assert.equal(stored, RAW); assert.equal(block.cropSource.box_2d, undefined);
      } else {
        assert.equal(stored, enhanced.includes(i) ? 'data:image/png;base64,ENHANCED_' + i : cleanOf(i));
        assert.equal(block.cropSource.box_2d[0], i);
      }
      assert.equal(w.H.images.get(block.cropSource.url), RAW);
      assert.equal(block.cropSource.imageUrl, block.url);
    });
  }
});

test('failed enhancement keeps the cleaned crop and failed uploads do not lose later figures or consume extra budget', async () => {
  const crops = [CROP, 'data:image/png;base64,SECOND', 'data:image/png;base64,THIRD', 'data:image/png;base64,FOURTH'];
  const blocks = crops.map((_, i) => image('f' + i));
  let calls = 0, reservations = 0;
  const w = world({ ready: true, crops, hooks: {
    enhance: async (prompt, media) => { calls++; await waitTurn(); if (media[0].data === CROP.split(',')[1]) throw new Error('Image service unavailable'); return 'data:image/png;base64,ENHANCED_' + media[0].data; },
    upload: async value => { await waitTurn(); if (value.endsWith('ENHANCED_SECOND')) throw new Error('Upload failed'); }
  } });
  const filled = await w._fillBlocksFromAiBoxes(blocks, blocks.map((_, i) => [100 + i, 100, 700, 800]), page.mimeType, page.data, null, { onEnhance: () => reservations++ });
  assert.equal(filled, 3);
  assert.equal(calls, 3); assert.equal(reservations, 3);
  assert.equal(w.H.images.get(blocks[0].url), CROP, 'the failed image call keeps its sharp crop');
  assert.equal(blocks[1].url, '', 'the failed upload is not counted as a saved crop');
  assert.ok(w.H.images.get(blocks[2].url).endsWith('ENHANCED_THIRD'));
  assert.equal(w.H.images.get(blocks[3].url), crops[3], 'no spare enhancement after an earlier failure');
});

test('a failed preparation drains already-started work and releases every slot before returning', async () => {
  const w = world();
  let release, settled = false;
  const holding = new Promise(resolve => { release = resolve; });
  const started = [], finished = [];
  const run = w._rapidFigureMap([0, 1, 2, 3, 4], 'prep', async value => {
    started.push(value);
    if (value === 0) { await waitTurn(); throw new Error('Failed crop'); }
    await holding; finished.push(value); return value;
  });
  const checked = assert.rejects(run, /Failed crop/).then(() => { settled = true; });
  await waitTurn(); await waitTurn();
  assert.deepEqual(started, [0, 1, 2]); assert.equal(settled, false, 'fallback cannot start while another crop is still writing');
  release(); await checked;
  assert.deepEqual(finished, [1, 2]);
  assert.deepEqual(await w._rapidFigureMap([5, 6, 7, 8], 'prep', async value => value), [5, 6, 7, 8]);
  assert.equal(w._rapidFigureMap.pools.prep.active, 0); assert.equal(w._rapidFigureMap.pools.prep.waiting.length, 0);
});

test('questions sharing a source upload keep the same untouched original and all-failed crops request no upload', async () => {
  const w = world({ crops: [CROP, CROP, null] });
  const originalUrl = 'https://images.test/shared-original'; w.H.images.set(originalUrl, RAW);
  let requests = 0;
  const options = { getSourcePageUrl: () => { requests++; return Promise.resolve(originalUrl); } };
  const first = image('one'), second = image('two');
  await w._fillBlocksFromAiBoxes([first], [[100, 100, 700, 800]], page.mimeType, page.data, null, options);
  await w._fillBlocksFromAiBoxes([second], [[100, 100, 700, 800]], page.mimeType, page.data, null, options);
  assert.equal(first.cropSource.url, originalUrl); assert.equal(second.cropSource.url, originalUrl);
  assert.equal([...w.H.images.values()].filter(value => value === RAW).length, 1);
  assert.equal(await w._fillBlocksFromAiBoxes([image('missing')], [null], page.mimeType, page.data, null, options), 0);
  assert.equal(requests, 2, 'the all-failed path leaves its existing whole-page fallback in charge');
});
