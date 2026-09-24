import test from 'node:test';
import assert from 'node:assert/strict';
import { cropSourcesFor, normalizeCropBox, cropPixelRect, cropSourceUpdate } from '../question-crop-core.mjs';
import { applyQuestionRepairPlan } from '../question-repair-core.mjs';

const imageUrl = 'https://example.test/cropped.png';
const originalUrl = 'https://example.test/page.png';
const nextUrl = 'https://example.test/recropped.png';
const target = 'block:figure:url';
const box = [100, 200, 800, 900];
const fixture = () => ({
  id: 'question-1', title: 'The mass of air', holdBack: true, releaseOn: '2027-01-01',
  tags: ['air'], sourcePdf: 'paper.pdf',
  blocks: [
    { id: 'stem', type: 'text', content: 'Compare <img src="https://example.test/inline.png" alt="diagram">.', marks: 2 },
    { id: 'figure', type: 'image', url: imageUrl, scale: 0.7, printImg: 'lg',
      answerImg: 'https://example.test/answer.png', cropSource: { url: originalUrl, imageUrl, box_2d: box } },
  ],
  sourcePages: [{ page: 1, url: originalUrl }, { page: 2, url: 'https://example.test/page2.png' }],
});

test('crop sources prefer bound original, then session source, then unique source pages, with current last', () => {
  const q = fixture();
  const session = { url: 'https://example.test/session.png', imageUrl, box: [50, 50, 950, 950] };
  const sources = cropSourcesFor(q, target, session);
  assert.deepEqual(sources.map(s => s.url), [originalUrl, session.url, 'https://example.test/page2.png', imageUrl]);
  assert.deepEqual(sources.map(s => s.id), ['source-1', 'source-2', 'source-3', 'current']);
  assert.deepEqual(sources[0].box, box);
  assert.deepEqual(sources[1].box, session.box);
  assert.equal(sources[2].label, 'Source page 2');
  assert.equal(sources.at(-1).original, false);
  assert.deepEqual(cropSourcesFor(q, { id: target, value: 'https://wrong.test/ignored.png' }, session), sources);
});

test('source enumeration cannot use stale provenance or stale session originals', () => {
  const q = fixture();
  q.sourcePages = [];
  q.blocks[1].url = 'https://example.test/later-redraw.png';
  const sources = cropSourcesFor(q, target, { url: 'https://example.test/stale-session.png', imageUrl });
  assert.deepEqual(sources, [{ id: 'current', label: 'Current picture — trim only', url: q.blocks[1].url, original: false }]);
});

test('legacy source pages remain available after a redraw but are never tied to invented rectangles', () => {
  const q = fixture();
  q.blocks[1].url = 'https://example.test/later-redraw.png';
  const sources = cropSourcesFor(q, target);
  assert.deepEqual(sources.slice(0, -1).map(s => s.url), [originalUrl, 'https://example.test/page2.png']);
  assert.ok(sources.slice(0, -1).every(s => s.original && !('box' in s)));
});

test('bound parent-block provenance takes precedence over legacy question-level imageSources', () => {
  const q = fixture(), inlineTarget = 'block:stem:content:inline:1';
  const inlineUrl = 'https://example.test/inline.png';
  q.blocks[0].cropSources = { [inlineTarget]: { url: originalUrl, imageUrl: inlineUrl, box_2d: box } };
  q.imageSources = { [inlineTarget]: { url: 'https://example.test/legacy.png', imageUrl: inlineUrl } };
  const sources = cropSourcesFor(q, inlineTarget);
  assert.equal(sources[0].url, originalUrl);
  assert.equal(sources[1].url, 'https://example.test/legacy.png');
  assert.equal(sources.at(-1).url, inlineUrl);
});

test('source list has at most eight distinct alternatives and a stable current entry', () => {
  const q = fixture();
  q.sourcePages = Array.from({ length: 20 }, (_, i) => ({ page: i + 1, url: 'https://example.test/page' + i + '.png' }));
  const sources = cropSourcesFor(q, target);
  assert.equal(sources.length, 9);
  assert.equal(new Set(sources.slice(0, -1).map(s => s.url)).size, 8);
  assert.equal(sources.at(-1).id, 'current');
});

test('unsafe source URLs and malformed optional boxes are ignored', () => {
  const q = fixture();
  q.blocks[1].cropSource.box_2d = [0, 0, 0, 900];
  q.sourcePages = [
    { page: 1, url: 'javascript:alert(1)' }, { page: 2, url: 'http://example.test/plain.png' },
    { page: 3, url: 'https://name:secret@example.test/private.png' },
    { page: 4, url: 'data:text/html;base64,YQ==' },
    { page: 5, url: 'data:image/png;base64,YQ==' },
  ];
  const sources = cropSourcesFor(q, target);
  assert.equal(sources.length, 3);
  assert.equal(sources[0].box, undefined);
  assert.equal(sources[1].url, 'data:image/png;base64,YQ==');
});

test('unknown and non-image targets cannot select crop sources', () => {
  const q = fixture();
  for (const id of ['q:title', 'block:stem:content', '__proto__', 'new:image', 'block:missing:url']) {
    assert.throws(() => cropSourcesFor(q, id), /picture/);
  }
});

test('valid rectangles are copied without modifying or widening their normalized bounds', () => {
  const input = [0, 12.5, 1000, 900];
  const normalized = normalizeCropBox(input);
  assert.deepEqual(normalized, input);
  assert.notEqual(normalized, input);
  normalized[0] = 10;
  assert.equal(input[0], 0);
  assert.deepEqual(cropPixelRect([100, 200, 800, 900], 1000, 500), { x: 200, y: 50, w: 700, h: 350 });
  assert.deepEqual(cropPixelRect([0, 0, 1000, 1000], 101, 51), { x: 0, y: 0, w: 101, h: 51 });
  assert.deepEqual(cropPixelRect([100, 100, 900, 900], 101, 51), { x: 10, y: 5, w: 81, h: 41 });
});

test('invalid rectangles and dimensions fail instead of silently clipping to a different crop', () => {
  for (const bad of [null, [], Array(4), [0, 0, 1000], [0, 0, 1000, 1000, 1], ['0', 0, 1000, 1000],
    [-1, 0, 1000, 1000], [0, 0, 1001, 1000], [0, 0, Infinity, 1000], [0, 0, NaN, 1000],
    [500, 0, 100, 1000], [0, 600, 1000, 500], [0, 0, 0, 1000]]) {
    assert.throws(() => normalizeCropBox(bad), /Crop repair:/);
  }
  for (const dims of [[0, 100], [100, 1], [100.5, 100], [Infinity, 100], ['100', 100]]) {
    assert.throws(() => cropPixelRect(box, ...dims), /dimensions/);
  }
  assert.throws(() => cropPixelRect([0, 0, 1, 1], 100, 100), /too small/);
});

test('direct image crop provenance is persisted without changing pixels or unrelated question fields', () => {
  const q = fixture(), before = structuredClone(q);
  const source = cropSourcesFor(q, target)[0];
  const result = cropSourceUpdate(q, target, source, nextUrl, box);
  assert.deepEqual(q, before);
  assert.equal(result.blocks[1].url, imageUrl, 'the caller applies the prepared cropped image separately');
  assert.deepEqual(result.blocks[1].cropSource, { url: originalUrl, imageUrl: nextUrl, original: true, box_2d: box });
  assert.equal(result.blocks[1].scale, 0.7);
  assert.deepEqual(result.blocks[0], before.blocks[0]);
  assert.deepEqual(result.sourcePages, before.sourcePages);
  assert.equal(result.holdBack, true);
  assert.equal(result.releaseOn, before.releaseOn);
});

test('inline and answer-image provenance lives on the block so draft saving retains it', () => {
  const q = fixture();
  for (const id of ['block:stem:content:inline:1', 'block:figure:answerImg']) {
    const result = cropSourceUpdate(q, id, { url: originalUrl, original: true }, nextUrl, box);
    const parent = id.includes(':stem:') ? result.blocks[0] : result.blocks[1];
    assert.deepEqual(parent.cropSources[id], { url: originalUrl, imageUrl: nextUrl, original: true, box_2d: box });
    assert.equal(result.imageSources, undefined);
    assert.deepEqual(result.blocks[1].cropSource, q.blocks[1].cropSource);
  }
});

test('inline provenance follows a picture moved by an approved wording repair', () => {
  const q = fixture();
  q.blocks[0].content = '<img src="https://example.test/other.png"> before <img src="' + nextUrl + '">';
  const result = cropSourceUpdate(q, 'block:stem:content:inline:1', { url: originalUrl, original: true }, nextUrl, box);
  assert.equal(result.blocks[0].cropSources['block:stem:content:inline:1'], undefined);
  assert.deepEqual(result.blocks[0].cropSources['block:stem:content:inline:2'],
    { url: originalUrl, imageUrl: nextUrl, original: true, box_2d: box });
  const sources = cropSourcesFor(result, 'block:stem:content:inline:2');
  assert.equal(sources[0].url, originalUrl);
  assert.deepEqual(sources[0].box, box);
});

test('two swapped inline recrops keep each original source when the second is a current-only trim', () => {
  const q = fixture();
  const first = 'block:stem:content:inline:1', second = 'block:stem:content:inline:2';
  const oldA = 'https://example.test/old-a.png', oldB = 'https://example.test/old-b.png';
  const newA = 'https://example.test/new-a.png', newB = 'https://example.test/new-b.png';
  const pageA = 'https://example.test/source-a.png', pageB = 'https://example.test/source-b.png';
  q.blocks[0].content = '<img src="' + oldA + '"> and <img src="' + oldB + '">';
  q.blocks[0].cropSources = {
    [first]: { url: pageA, imageUrl: oldA, original: true, box_2d: box },
    [second]: { url: pageB, imageUrl: oldB, original: true, box_2d: box },
  };
  const sourceA = cropSourcesFor(q, first)[0];
  const sourceB = cropSourcesFor(q, second).at(-1);
  const actions = [
    { kind: 'recrop_image', target: first, reason: 'Crop A.', instruction: 'Keep the complete first figure.' },
    { kind: 'recrop_image', target: second, reason: 'Crop B.', instruction: 'Trim unrelated wording from the second figure.' },
    { kind: 'replace_text', target: 'block:stem:content', reason: 'Put B first.', value: '[[IMAGE_2]] then [[IMAGE_1]]' },
  ];
  let result = applyQuestionRepairPlan(q, { actions }, { a1: newA, a2: newB }).question;
  result = cropSourceUpdate(result, first, sourceA, newA, box);
  result = cropSourceUpdate(result, second, sourceB, newB, box);
  assert.deepEqual(result.blocks[0].cropSources[first], { url: pageB, imageUrl: newB, original: true });
  assert.deepEqual(result.blocks[0].cropSources[second], { url: pageA, imageUrl: newA, original: true, box_2d: box });
  assert.equal(cropSourcesFor(result, first)[0].url, pageB);
  assert.equal(cropSourcesFor(result, second)[0].url, pageA);
});

test('trimming current preserves an existing full original and discards coordinates from the wrong source', () => {
  const q = fixture();
  const source = cropSourcesFor(q, target).at(-1);
  // Normal application updates pixels first, then records the selected source.
  q.blocks[1].url = nextUrl;
  const result = cropSourceUpdate(q, target, source, nextUrl, [200, 200, 800, 800]);
  assert.deepEqual(result.blocks[1].cropSource, { url: originalUrl, imageUrl: nextUrl, original: true });
  assert.equal(cropSourcesFor(result, target)[0].url, originalUrl);
  assert.equal(cropSourcesFor(result, target)[0].box, undefined);
});

test('current-only cropping records a previous picture without claiming missing content is recoverable', () => {
  const q = fixture();
  delete q.blocks[1].cropSource;
  q.sourcePages = [];
  const source = cropSourcesFor(q, target).at(-1);
  q.blocks[1].url = nextUrl;
  const result = cropSourceUpdate(q, target, source, nextUrl, box);
  assert.equal(result.blocks[1].cropSource.original, false);
  const sources = cropSourcesFor(result, target);
  assert.equal(sources[0].label, 'Previous image');
  assert.equal(sources[0].original, false);
  assert.equal(sources.at(-1).original, false);
});

test('provenance updates reject invalid rectangles, image URLs and targets without modifying source', () => {
  const q = fixture(), before = structuredClone(q);
  assert.throws(() => cropSourceUpdate(q, '__proto__', { url: originalUrl }, nextUrl, box), /picture/);
  assert.throws(() => cropSourceUpdate(q, target, { url: 'javascript:alert(1)' }, nextUrl, box), /source/);
  assert.throws(() => cropSourceUpdate(q, target, { url: originalUrl }, 'javascript:alert(1)', box), /URL/);
  assert.throws(() => cropSourceUpdate(q, target, { url: originalUrl }, nextUrl, [0, 0, 0, 0]), /positive/);
  assert.deepEqual(q, before);
  assert.equal({}.polluted, undefined);
});
