// Exercise the real page importer at the boundaries between independently
// prepared figures, explanations, visual checking and durable publication.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('async function processRapidJob(');
const end = source.indexOf('// 🔧 AUTO-FIXED', start);
assert.ok(start >= 0 && end > start);
const importer = source.slice(start, end);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(setImmediate);

function harness(options = {}) {
  const state = { uploads: [], prepared: [], explained: [], checked: [], saved: [], failed: [], ...options };
  const run = new Function('state', `
    let vettingList = [], _rapidAddedCount = 0;
    const _rapidJustAdded = new Set(), _imgEnhanceState = {};
    const DECISIONS_MAY_SKIP = false;
    const console = {warn() {}};
    const _fileToBase64 = async () => 'SOURCE';
    const askGeminiVision = async () => ({questions: state.payloads});
    const _aiBuildQuestionPrompt = () => 'read every question';
    const _parseAIJson = raw => raw;
    const _aiQuestionPayloads = raw => raw.questions;
    const buildQuestionFromAi = payload => structuredClone(payload);
    const _rapidApplyLevel = (q, level) => {q.level = level;};
    const _rapidApplyRelease = (q, release) => {q.releaseOn = release;};
    const _epStripNumbering = () => {};
    const imageAiReady = () => false;
    const uploadImageDataUrl = async data => {
      state.uploads.push(data);
      if (state.failUpload && state.uploads.length === 1) throw new Error('upload unavailable');
      if (state.uploadGate) await state.uploadGate;
      return 'source-' + state.uploads.length;
    };
    const _fillBlocksFromAiBoxes = async (blocks, boxes, mime, data, status, opts) => {
      const id = blocks[0].id;
      state.prepared.push(id);
      if (state.figureGate) await state.figureGate;
      const original = await opts.getSourcePageUrl();
      if (state.fallback === id) return 0;
      blocks.forEach(block => {block.url = 'crop-' + block.id; block.cropSource = {url:original};});
      return blocks.length;
    };
    const _rememberCropSource = (block, url) => {block.cropSource = {url};};
    const _cropWordingOf = () => 'unchanged source wording';
    const qHasParts = blocks => blocks.some(block => block.part);
    const aiWritePartExplanations = async q => {
      state.explained.push(q.id);
      if (state.explanationGate) await state.explanationGate;
      q.blocks.push({id:q.id + '-explanation', type:'explanation', content:'Complete explanation'});
    };
    const autoChkOn = () => true;
    const autoChkPrepareReview = async q => {
      state.checked.push(structuredClone(q));
      return {gate:{confident:true, available:true, findings:[], figureFindings:[]}, firstRead:{ran:true}};
    };
    const autoChkRun = async (q, options) => {
      if (!options.firstRead.ran) throw new Error('visual read missing');
      return {state:q.diagramWhole ? 'amber' : 'green', findings:q.diagramWhole ? [{title:'Crop by hand'}] : []};
    };
    const autoChkStamp = (q, result) => {q.autoCheck = result;};
    const autoChkAnnounce = () => {};
    const _decisionsFigureFindings = () => [];
    const saveVettingQuestion = async q => {
      state.saved.push(structuredClone(q));
      if (state.saveGate) await state.saveGate;
    };
    const _tagDuplicate = () => {};
    const _setRapidJobState = () => {};
    const _removeRapidJob = () => {};
    const _updateRapidCounts = () => {};
    const renderVettingList = () => {};
    const updateCounts = () => {};
    const _setRapidStatus = () => {};
    const showToast = () => {};
    const qReleaseOn = q => q.releaseOn;
    const qReleaseLabel = value => value;
    const autoChkBatchNote = () => '';
    const _failRapidJob = (id, error) => state.failed.push(error.message);
    ${importer}
    return processRapidJob;
  `)(state);
  return { state, run: (id = 'job') => run(id, {type:'image/png'}, 'P3', {release:'2099-01-01', source:'page 1'}) };
}

function question(id, parts = false) {
  return {id, title:id, blocks:[
    {id:id + '-text', type:'text', content:'Original stem', ...(parts ? {part:'a'} : {})},
    {id:id + '-figure', type:'image', box_2d:[0,0,500,500]}
  ]};
}

test('figures and explanations overlap, but checking waits for both before publication', async () => {
  const figures = deferred(), explanations = deferred();
  const h = harness({payloads:[question('q1', true)], figureGate:figures.promise, explanationGate:explanations.promise});
  const pending = h.run();
  await tick();
  assert.deepEqual(h.state.prepared, ['q1-figure']);
  assert.deepEqual(h.state.explained, ['q1']);
  assert.equal(h.state.checked.length, 0);
  figures.resolve(); await tick();
  assert.equal(h.state.checked.length, 0, 'a ready figure alone cannot trigger the visual check');
  explanations.resolve();
  const result = await pending;
  assert.equal(result.added, 1);
  assert.equal(h.state.checked[0].blocks[1].url, 'crop-q1-figure');
  assert.equal(h.state.checked[0].blocks[2].content, 'Complete explanation');
  assert.equal(h.state.saved[0].autoCheck.state, 'green');
  assert.equal(h.state.saved[0].level, 'P3');
  assert.equal(h.state.saved[0].releaseOn, '2099-01-01');
});

test('a completed explanation cannot publish while its figure is still preparing', async () => {
  const figures = deferred();
  const h = harness({payloads:[question('q1', true)], figureGate:figures.promise});
  const pending = h.run(); await tick();
  assert.deepEqual(h.state.explained, ['q1']);
  assert.equal(h.state.checked.length, 0);
  assert.equal(h.state.saved.length, 0);
  figures.resolve(); await pending;
  assert.equal(h.state.checked.length, 1);
  assert.equal(h.state.checked[0].blocks[1].url, 'crop-q1-figure');
});

test('questions and whole-page fallback share one untouched source upload with distinct crops', async () => {
  const h = harness({payloads:[question('q1'), question('q2'), question('q3')], fallback:'q3-figure'});
  const result = await h.run();
  assert.deepEqual(h.state.uploads, ['data:image/png;base64,SOURCE']);
  assert.deepEqual(result.questions.map(q => q.id), ['q1','q2','q3']);
  assert.deepEqual(result.questions.map(q => q.blocks[1].cropSource.url), ['source-1','source-1','source-1']);
  assert.deepEqual(result.questions.map(q => q.blocks[1].url), ['crop-q1-figure','crop-q2-figure','source-1']);
  assert.equal(result.questions[2].diagramWhole, true);
  assert.equal(result.questions[2].autoCheck.state, 'amber', 'whole-page fallback still reaches checking');
  assert.equal(h.state.checked.length, 3);
});

test('a failed original upload can be retried and is never cached as a missing source', async () => {
  const h = harness({payloads:[question('q1'), question('q2')], failUpload:true});
  const result = await h.run();
  assert.equal(h.state.uploads.length, 2);
  assert.equal(result.added, 2);
  assert.equal(result.questions[0].blocks[1].cropSource.url, 'source-2');
  assert.equal(result.questions[1].blocks[1].cropSource.url, 'source-2');
  assert.equal(result.questions[0].diagramWhole, true);
  assert.deepEqual(h.state.failed, []);
});

test('source reuse is per page job and the importer waits for saved questions', async () => {
  const saved = deferred();
  const h = harness({payloads:[{...question('q1'), continuation:true}], saveGate:saved.promise});
  let done = false;
  const pending = h.run().then(result => {done = true; return result;});
  await tick();
  assert.equal(h.state.saved.length, 1);
  assert.equal(done, false);
  saved.resolve();
  assert.equal((await pending).continuation, true);
  await h.run('other-page');
  assert.equal(h.state.uploads.length, 2, 'another page job gets its own source');
});
