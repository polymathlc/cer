// 🖼 THE IMAGE ENGINE — ChatGPT Images 2.5 for every picture (v1.372.0)
//
// Loads the REAL image-engine block out of app.js against stubs and pins the
// things that fail silently — the app draws a picture either way, and a
// picture that came out of the wrong model looks exactly like one that did
// not:
//
//  • automatic selection uses Sunburst for teaching diagrams and faithful
//    edits, Flare for artwork, and honors explicit model choices;
//  • the one-shot LIFT moves the former Flare default to automatic, keeps
//    saved Sunburst/snapshots/legacy re-picks, and preserves later choices;
//  • the ORDER: ChatGPT Images by the server's key, then a key in this
//    browser, then Gemini — regardless of the TEXT engine; and Gemini first
//    only when the admin chose it;
//  • the door FALLS THROUGH: a server route that is not deployed hands over
//    to the browser key, which hands over to Gemini, and when everything
//    refuses the error names EVERY route;
//  • a refusal about ONE picture (invalid-argument) does not close the route;
//  • the request shape: edits carry NO input_fidelity on the 2.5 family (it is
//    refused there) and do on gpt-image-1, several references
//    go up as image[], transparent asks for png, and xhigh is clamped to
//    high on a legacy model;
//  • the census: no caller reaches generateImageDataUrlGemini or
//    openAiGenerateImageDataUrl except the door; _tcgGenOnce, _diagramDraw
//    and generateEnhancedImageDataUrl all go through generateImageDataUrl;
//  • the dialog offers the picture engine and the 2.5 models, the shared
//    setting is written and read, and mistakes.html has the server route.
import fs from 'node:fs';

const readSource = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const src = readSource('../app.js');
const html = readSource('../index.html');
const mistakes = readSource('../mistakes.html');

function section(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('section not found: ' + from.slice(0, 40));
  return src.slice(a, b);
}
const block = section("const OPENAI_IMAGE_DEFAULT_MODEL = ", '// Single swap-point for all model calls.');

function build(storeInit) {
  return new Function(`
var _store = ${JSON.stringify(storeInit || {})};
var localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  setItem: function (k, v) { _store[k] = String(v); },
  removeItem: function (k) { delete _store[k]; }
};
var AI_ENGINE_STORE = { engine: 'x_ai_engine', key: 'x_openai_key', model: 'x_openai_model', imageModel: 'x_openai_image_model', kimiKey: 'x_kimi_key', kimiModel: 'x_kimi_model', modelGen: 'x_openai_model_gen', authorEngine: 'x_ai_author_engine', imageEngine: 'x_ai_image_engine', imageGen: 'x_openai_image_gen' };
var _key = '';
function getOpenAiKey() { return _key; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
var AI_IMAGE_ENGINES = ['openai', 'gemini'];
var AI_IMAGE_ENGINE_DEFAULT = 'openai';
var _aiSharedImageEngine = null;
var AI_DOWN_MS = 10 * 60 * 1000;
var _aiDown = {}, _aiWhy = {};
function aiEngineIsDown(e) { return (_aiDown[e] || 0) > Date.now(); }
function _aiMarkDown(e, why) { _aiDown[e] = Date.now() + AI_DOWN_MS; _aiWhy[e] = why || ''; }
function _aiMarkUp(e) { _aiDown[e] = 0; _aiWhy[e] = ''; }
var geminiImageModels = [{}];
function _parseImageDataUrl(u) {
  var m = /^data:([^;,]+);base64,(.*)$/.exec(u || '');
  if (!m) return null;
  return { mime: m[1], bytes: Buffer.from(m[2], 'base64') };
}
var app = {}, _aiFns = null;
function getFunctions() { return {}; }
var serverMode = 'ok', serverCalls = [], serverOnCall = null;
function httpsCallable(_f, name) {
  return async function (payload) {
    serverCalls.push({ name: name, payload: payload });
    if (serverOnCall) serverOnCall(payload);
    if (serverMode === 'precondition') { var e = new Error('functions/failed-precondition: No OpenAI key is configured on the server.'); e.code = 'functions/failed-precondition'; throw e; }
    if (serverMode === 'bad') { var e2 = new Error('functions/invalid-argument: Image size 100x100: width and height must both be divisible by 16.'); e2.code = 'functions/invalid-argument'; throw e2; }
    if (serverMode === 'empty') return { data: {} };
    return { data: { b64: 'U0VSVkVS', mimeType: 'image/png', model: payload.model } };
  };
}
var fetchMode = 'ok', fetchCalls = [];
async function fetch(url, init) {
  fetchCalls.push({ url: url, init: init });
  if (fetchMode === 'unauth') return { ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect API key provided' } }) };
  if (fetchMode === 'unsupported' && fetchCalls.length % 2 === 1) return { ok: false, status: 400, json: async () => ({ error: { message: 'Unknown parameter: input_fidelity' } }) };
  return { ok: true, json: async () => ({ data: [{ b64_json: 'S0VZ' }] }) };
}
var geminiMode = 'ok', geminiCalls = [];
async function generateImageDataUrlGemini(prompt, refs) {
  geminiCalls.push({ prompt: prompt, refs: refs });
  if (geminiMode === 'fail') throw new Error('Gemini quota exceeded');
  return 'data:image/png;base64,R0VNSU5J';
}
async function _urlToDataUrlRobust(u) { return 'data:image/png;base64,VVJM'; }
var announced = [];
function showToast(text, type) { announced.push({ text: text, type: type }); }
var console = { warn: function () {} };
` + block + `
return {
  store: _store,
  announced: announced,
  imageEngineDescribe: imageEngineDescribe,
  set key(v) { _key = v; },
  set shared(v) { _aiSharedImageEngine = v; },
  set gemini(v) { geminiImageModels = v ? [{}] : []; },
  set serverMode(v) { serverMode = v; },
  set serverOnCall(v) { serverOnCall = v; },
  set fetchMode(v) { fetchMode = v; },
  set geminiMode(v) { geminiMode = v; },
  get serverCalls() { return serverCalls; },
  get fetchCalls() { return fetchCalls; },
  get geminiCalls() { return geminiCalls; },
  get last() { return imageLastCall; },
  get down() { return _aiDown; },
  resetDown: function () { Object.keys(_aiDown).forEach(function (k) { _aiDown[k] = 0; }); serverCalls.length = 0; fetchCalls.length = 0; geminiCalls.length = 0; },
  OPENAI_IMAGE_DEFAULT_MODEL, OPENAI_IMAGE_EDUCATION_MODEL, OPENAI_IMAGE_AUTO, OPENAI_IMAGE_MODELS, OPENAI_IMAGE_25_RE, OPENAI_IMAGE_SUPERSEDED, OPENAI_IMAGE_GEN,
  getOpenAiImageModel, getOpenAiImageModelChoice, openAiImageModelKnown, openAiImageModelOptionsHtml, aiImageEngineSetting,
  imageEngineOrder, imageOpenAiPossible, imageEngineLabel, _tcgArtEngineLabel, _imgRefsFrom, _imgQualityFor,
  openAiGenerateImageDataUrl, openAiImageServer, generateImageDataUrl, imageRouteReport, _imgRouteFault,
  _isUnsupportedImageParam, _imgFidelityFor, _imgSizeField
};
`)();
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
}
const run = (name, fn) => Promise.resolve().then(fn).catch(e => { fail++; console.log('  FAIL ' + name + ' threw: ' + (e && e.stack || e)); });

/* ---------- the model ---------- */
await run('model', () => {
  const api = build();
  ok('routine art keeps Flare and educational work defaults to Sunburst',
     api.OPENAI_IMAGE_DEFAULT_MODEL === 'gpt-image-2.5-flare' && api.OPENAI_IMAGE_EDUCATION_MODEL === 'gpt-image-2.5-sunburst');
  ok('both 2.5 models remain available as explicit choices',
     ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].every(id => api.OPENAI_IMAGE_MODELS.some(m => m.id === id)));
  ok('the family regex takes both 2.5 models and their dated snapshots',
     ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.5-sunburst-2026-09-08'].every(id => api.OPENAI_IMAGE_25_RE.test(id)));
  ok('…and refuses everything outside it', ['gpt-image-2', 'gpt-image-1', 'gpt-image-2.5', 'gpt-image-3-flare', 'chatgpt-image-latest'].every(id => !api.OPENAI_IMAGE_25_RE.test(id)));
  ok('with nothing stored the choice is automatic', api.getOpenAiImageModelChoice() === api.OPENAI_IMAGE_AUTO);
  ok('automatic routes by purpose, not by the presence of a reference',
     api.getOpenAiImageModel({ purpose: 'education' }) === 'gpt-image-2.5-sunburst' &&
     api.getOpenAiImageModel({ purpose: 'art', refDataUrl: 'data:image/png;base64,QUJD' }) === 'gpt-image-2.5-flare' &&
     api.getOpenAiImageModel() === 'gpt-image-2.5-flare');
  api.store.x_openai_image_model = 'gpt-image-9-nova';
  ok('unknown stored ids fall back to automatic for both purposes',
     api.getOpenAiImageModelChoice() === api.OPENAI_IMAGE_AUTO && api.getOpenAiImageModel() === 'gpt-image-2.5-flare' &&
     api.getOpenAiImageModel({ purpose: 'education' }) === 'gpt-image-2.5-sunburst');
  api.store.x_openai_image_model = 'gpt-image-2.5-sunburst';
  ok('a deliberate Sunburst pick is honoured for art too', api.getOpenAiImageModel({ purpose: 'art' }) === 'gpt-image-2.5-sunburst');
  api.store.x_openai_image_model = 'gpt-image-2.5-flare';
  ok('a deliberate Flare pick is honoured for education too', api.getOpenAiImageModel({ purpose: 'education' }) === 'gpt-image-2.5-flare');
  ok('a valid per-call model outranks the stored choice', api.getOpenAiImageModel({ model: 'gpt-image-2.5-sunburst', purpose: 'art' }) === 'gpt-image-2.5-sunburst');
  ok('an invalid per-call model cannot reach the API', api.getOpenAiImageModel({ model: 'gpt-image-9-nova', purpose: 'education' }) === 'gpt-image-2.5-flare');
  api.store.x_openai_image_model = 'gpt-image-2.5-flare-2026-09-08';
  ok('a dated snapshot is honoured too', api.getOpenAiImageModel() === 'gpt-image-2.5-flare-2026-09-08');
  const opts = api.openAiImageModelOptionsHtml('gpt-image-2.5-sunburst');
  ok('the <select> includes automatic and every available model',
     /<option value="auto"/.test(opts) && api.OPENAI_IMAGE_MODELS.every(m => opts.includes('value="' + m.id + '"')));
  ok('…with the stored model selected', /value="gpt-image-2.5-sunburst" selected/.test(opts));
  ok('automatic is the first option and can be selected', /^<option value="auto" selected>/.test(api.openAiImageModelOptionsHtml('auto')));
  ok('a saved snapshot has a selected option, so opening and saving cannot replace it',
     /value="gpt-image-2.5-flare-2026-09-08" selected/.test(api.openAiImageModelOptionsHtml('gpt-image-2.5-flare-2026-09-08')));
  ok('every legacy default is on the superseded list', ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-2'].every(id => api.OPENAI_IMAGE_SUPERSEDED.includes(id)));
  ok('…and neither 2.5 model is', !api.OPENAI_IMAGE_SUPERSEDED.some(id => api.OPENAI_IMAGE_25_RE.test(id)));
});

/* ---------- the one-shot lift ---------- */
await run('lift', () => {
  let api = build({ x_openai_image_model: 'gpt-image-1' });
  ok('a device carrying the pre-2.5 default is lifted to automatic', api.getOpenAiImageModelChoice() === 'auto');
  ok('…and the lift is recorded', api.store.x_openai_image_gen === api.OPENAI_IMAGE_GEN);
  ok('the new lift has its own marker', api.OPENAI_IMAGE_GEN === 'images25-purpose-v1');
  for (const marker of [undefined, 'images25']) {
    api = build({ x_openai_image_model: 'gpt-image-2.5-flare', ...(marker ? { x_openai_image_gen: marker } : {}) });
    ok('the former Flare default becomes automatic with marker ' + marker,
       api.getOpenAiImageModelChoice() === 'auto' && api.getOpenAiImageModel({ purpose: 'education' }) === 'gpt-image-2.5-sunburst');
    api = build(api.store);
    ok('automatic remains automatic on the next load with marker ' + marker, api.getOpenAiImageModelChoice() === 'auto');
  }
  api = build({ x_openai_image_model: 'gpt-image-1', x_openai_image_gen: 'images25' });
  ok('a deliberate re-pick of a legacy model AFTER the lift sticks', api.store.x_openai_image_model === 'gpt-image-1');
  for (const id of ['gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08', 'gpt-image-2.5-flare-2026-09-08']) {
    api = build({ x_openai_image_model: id, x_openai_image_gen: 'images25' });
    ok('a saved Sunburst or snapshot choice survives migration: ' + id, api.getOpenAiImageModelChoice() === id);
  }
  api = build({ x_openai_image_model: 'gpt-image-2.5-flare', x_openai_image_gen: 'images25-purpose-v1' });
  api = build(api.store);
  ok('a deliberate Flare re-pick after this lift survives reload', api.getOpenAiImageModel({ purpose: 'education' }) === 'gpt-image-2.5-flare');
  api = build({});
  ok('an empty slot resolves automatically without pinning a concrete model', api.getOpenAiImageModelChoice() === 'auto');
});

/* ---------- the order ---------- */
await run('order', () => {
  const api = build();
  api.key = ''; api.gemini = true;
  ok('with nothing chosen and no key, ChatGPT Images by the server leads and Gemini follows',
     api.imageEngineOrder().join() === 'imgServer,imgGemini', api.imageEngineOrder().join());
  api.key = 'sk-test';
  ok('a key in this browser is the route BEHIND the server, ahead of Gemini',
     api.imageEngineOrder().join() === 'imgServer,imgKey,imgGemini', api.imageEngineOrder().join());
  api.store.x_ai_engine = 'gemini';
  ok('the TEXT engine has no say: Gemini as the chat engine still draws with ChatGPT Images',
     api.imageEngineOrder()[0] === 'imgServer');
  api.store.x_ai_image_engine = 'gemini';
  ok('choosing the Gemini image model puts it first and keeps ChatGPT Images behind it',
     api.imageEngineOrder().join() === 'imgGemini,imgServer,imgKey', api.imageEngineOrder().join());
  api.shared = 'openai';
  ok('the centre-wide setting outranks the device\'s own', api.imageEngineOrder()[0] === 'imgServer');
  api.shared = 'nonsense';
  ok('an unreadable shared value is the default (ChatGPT Images), never null', api.aiImageEngineSetting() === 'openai');
  api.shared = null; api.store.x_ai_image_engine = 'openai';
  api.gemini = false;
  ok('no Gemini image model → no Gemini route, and the door still has ChatGPT Images',
     api.imageEngineOrder().join() === 'imgServer,imgKey', api.imageEngineOrder().join());
  api.gemini = true;
  ok('skipOpenAi is Gemini and nothing else', api.imageEngineOrder({ skipOpenAi: true }).join() === 'imgGemini');
  ok('the label names ChatGPT Images and the model', /ChatGPT Images · gpt-image-2\.5-flare/.test(api.imageEngineLabel()));
  ok('the teaching-image label names the educational model', /ChatGPT Images · gpt-image-2\.5-sunburst/.test(api.imageEngineLabel({ purpose: 'education' })));
  ok('…and the Card Art tab\'s old name still answers', api._tcgArtEngineLabel() === api.imageEngineLabel());
  ok('the automatic chooser describes both purpose defaults', /Sunburst/i.test(api.imageRouteReport().model) && /Flare/i.test(api.imageRouteReport().model));
  api.store.x_openai_image_model = 'gpt-image-2.5-sunburst';
  ok('the chooser reports an explicit model as that model', api.imageRouteReport().model === 'gpt-image-2.5-sunburst');
  api.store.x_ai_image_engine = 'gemini';
  ok('…and says Gemini when Gemini leads', api.imageEngineLabel() === 'Gemini image model');
});

/* ---------- the door ---------- */
await run('door', async () => {
  const api = build();
  api.key = 'sk-test'; api.gemini = true;
  let out = await api.generateImageDataUrl('a beaker', {});
  ok('the server route answers first', out === 'data:image/png;base64,U0VSVkVS' && api.last.route === 'imgServer' && !api.last.fellBack);
  ok('…and is asked for the 2.5 model with a square size when there is no reference',
     api.serverCalls[0].payload.model === 'gpt-image-2.5-flare' && api.serverCalls[0].payload.size === '1024x1024' && api.serverCalls[0].payload.inputFidelity === undefined);

  api.resetDown(); api.serverMode = 'precondition';
  out = await api.generateImageDataUrl('a beaker', {});
  ok('a server route that is not deployed hands over to the key in this browser', out === 'data:image/png;base64,S0VZ' && api.last.route === 'imgKey' && api.last.fellBack);
  ok('…and is marked down, so the next picture does not pay for it again', api.down.imgServer > Date.now());
  ok('…which puts it to the BACK of the order, never off it', api.imageEngineOrder().join() === 'imgKey,imgGemini,imgServer', api.imageEngineOrder().join());
  ok('imageOpenAiPossible still says yes while a browser key is there', api.imageOpenAiPossible() === true);
  api.key = '';
  ok('…and no with no key and the server found missing', api.imageOpenAiPossible() === false);
  ok('the chooser says the function is not deployed yet', api.imageRouteReport().notes.some(n => /not switched on yet/.test(n)));

  api.key = 'sk-test'; api.resetDown(); api.serverMode = 'bad';
  out = await api.generateImageDataUrl('a beaker', { size: '100x100' });
  ok('a refusal about ONE picture still falls through to the next route', api.last.route === 'imgKey');
  ok('…but does NOT close the server route for ten minutes', !(api.down.imgServer > Date.now()));

  api.resetDown(); api.serverMode = 'precondition'; api.fetchMode = 'unauth';
  out = await api.generateImageDataUrl('a beaker', {});
  ok('a refused browser key hands over to Gemini', out === 'data:image/png;base64,R0VNSU5J' && api.last.route === 'imgGemini');
  ok('…and is marked down too', api.down.imgKey > Date.now());

  api.resetDown(); api.geminiMode = 'fail';
  let err = null;
  try { await api.generateImageDataUrl('a beaker', {}); } catch (e) { err = e; }
  ok('when EVERY route refuses the error names every route',
     err && /ChatGPT Images \(server key\)/.test(err.message) && /key in this browser/.test(err.message) && /Gemini image model/.test(err.message), err && err.message);
  ok('…and the first refusal is kept as the cause', err && err.cause && /failed-precondition/.test(err.cause.message));

  api.resetDown(); api.serverMode = 'empty'; api.fetchMode = 'ok'; api.geminiMode = 'ok';
  out = await api.generateImageDataUrl('a beaker', {});
  ok('a server reply with no picture in it is a refusal, not a blank picture', api.last.route === 'imgKey');

  api.resetDown(); api.serverMode = 'ok'; api.gemini = false; api.key = '';
  ok('with no Gemini model and no key the door still has the server', api.imageEngineOrder().join() === 'imgServer');
  api.serverMode = 'precondition';
  err = null;
  try { await api.generateImageDataUrl('a beaker', {}); } catch (e) { err = e; }
  ok('…and says so when that is not deployed either', err && /server key/.test(err.message));
});

/* ---------- the request shape ---------- */
await run('purpose routing on server and browser key', async () => {
  const ref = 'data:image/png;base64,QUJD';
  const cases = [
    { name: 'fresh teaching diagram', opts: { purpose: 'education' }, model: 'gpt-image-2.5-sunburst', edit: false },
    { name: 'faithful figure edit', opts: { purpose: 'education', refDataUrl: ref }, model: 'gpt-image-2.5-sunburst', edit: true },
    { name: 'fresh artwork', opts: { purpose: 'art' }, model: 'gpt-image-2.5-flare', edit: false },
    { name: 'artwork with a reference', opts: { purpose: 'art', refDataUrl: ref }, model: 'gpt-image-2.5-flare', edit: true },
    { name: 'explicit Sunburst for art', opts: { purpose: 'art', model: 'gpt-image-2.5-sunburst' }, model: 'gpt-image-2.5-sunburst', edit: false },
    { name: 'explicit Flare for an educational edit', opts: { purpose: 'education', model: 'gpt-image-2.5-flare', refDataUrl: ref }, model: 'gpt-image-2.5-flare', edit: true },
    { name: 'unknown per-call id with automatic education', opts: { purpose: 'education', model: 'gpt-image-9-nova' }, model: 'gpt-image-2.5-sunburst', edit: false }
  ];
  for (const c of cases) {
    const originalOpts = JSON.stringify(c.opts);
    const api = build();
    api.key = 'sk-test';
    await api.generateImageDataUrl(c.name, c.opts);
    ok(c.name + ': the server receives the resolved model', api.serverCalls[0].payload.model === c.model);
    ok(c.name + ': the server preserves generation/edit shape', api.serverCalls[0].payload.images.length === (c.edit ? 1 : 0));
    ok(c.name + ': the success badge names the resolved model', api.last.model === c.model);
    api.resetDown(); api.serverMode = 'precondition';
    await api.generateImageDataUrl(c.name, c.opts);
    const call = api.fetchCalls[0];
    const model = c.edit ? call.init.body.get('model') : JSON.parse(call.init.body).model;
    ok(c.name + ': fallback uses the same model as the server', api.serverCalls[0].payload.model === c.model && model === c.model);
    ok(c.name + ': fallback retains the right API operation', call.url.endsWith(c.edit ? '/images/edits' : '/images/generations'));
    ok(c.name + ': the caller options are unchanged', JSON.stringify(c.opts) === originalOpts);
  }

  const api = build();
  api.key = 'sk-test';
  for (const method of ['openAiImageServer', 'openAiGenerateImageDataUrl']) {
    api.resetDown();
    await api[method]('educational edit', { purpose: 'education', refDataUrl: ref });
    const model = method === 'openAiImageServer' ? api.serverCalls[0].payload.model : api.fetchCalls[0].init.body.get('model');
    ok(method + ' resolves educational purpose itself', model === 'gpt-image-2.5-sunburst');
    api.resetDown();
    await api[method]('explicit art model', { purpose: 'art', model: 'gpt-image-2.5-sunburst' });
    const explicit = method === 'openAiImageServer' ? api.serverCalls[0].payload.model : JSON.parse(api.fetchCalls[0].init.body).model;
    ok(method + ' honors the same per-call override', explicit === 'gpt-image-2.5-sunburst');
  }
  api.resetDown(); api.serverMode = 'precondition';
  api.serverOnCall = () => { api.store.x_openai_image_model = 'gpt-image-2.5-flare'; };
  const opts = { purpose: 'education', refDataUrl: ref };
  await api.generateImageDataUrl('setting changes while server request is pending', opts);
  ok('one picture keeps its resolved model across fallback even if settings change meanwhile',
     api.serverCalls[0].payload.model === 'gpt-image-2.5-sunburst' && api.fetchCalls[0].init.body.get('model') === 'gpt-image-2.5-sunburst');
  ok('resolving one picture does not mutate its caller options', !Object.hasOwn(opts, 'model'));
});

await run('actual image callers carry their purpose', async () => {
  const functionSource = (text, name) => {
    const start = text.indexOf('async function ' + name + '(');
    const end = text.indexOf('\n}', start);
    if (start < 0 || end < 0) throw new Error('missing function ' + name);
    return text.slice(start, end + 2);
  };
  const api = build();
  const callers = new Function('generateImageDataUrl', `
    function imageAiReady() { return true; }
    async function _akdQuestionFigure(q) { return q.ref || null; }
    async function _urlToDataUrlRobust(u) { return u; }
    function transformImageUrl(u) { return u; }
    async function _paperCleanDataUrl(u) { return { url: u }; }
    async function uploadImageDataUrl(u) { return u; }
    ${functionSource(src, '_diagramDraw')}
    ${functionSource(src, 'generateEnhancedImageDataUrl')}
    ${functionSource(src, '_tcgGenOnce')}
    return { _diagramDraw, generateEnhancedImageDataUrl, _tcgGenOnce };
  `)(api.generateImageDataUrl);
  const ref = 'data:image/png;base64,QUJD';
  for (const q of [{}, { ref }]) {
    api.resetDown();
    await callers._diagramDraw(q, kind => 'diagram from ' + kind, null, false);
    ok('the actual teaching-diagram wrapper chooses Sunburst ' + (q.ref ? 'with' : 'without') + ' a reference', api.serverCalls[0].payload.model === 'gpt-image-2.5-sunburst');
  }
  api.resetDown();
  await callers._diagramDraw({}, kind => 'regenerate ' + kind, ref, true);
  ok('the actual diagram regenerate path keeps the current diagram as its Sunburst reference',
     api.serverCalls[0].payload.model === 'gpt-image-2.5-sunburst' && api.serverCalls[0].payload.images[0].data === 'QUJD');
  api.resetDown();
  await callers.generateEnhancedImageDataUrl('preserve the printed values', { mimeType: 'image/png', data: 'QUJD' });
  ok('the actual enhancement wrapper chooses Sunburst for faithful edits', api.serverCalls[0].payload.model === 'gpt-image-2.5-sunburst');
  api.resetDown();
  await callers._tcgGenOnce('an avatar', ref, true);
  ok('the actual artwork wrapper retains Flare with reference and transparency',
     api.serverCalls[0].payload.model === 'gpt-image-2.5-flare' && api.serverCalls[0].payload.background === 'transparent');

  let cleanupPayload;
  const cleanFigure = new Function('httpsCallable', `
    let fns = {}, app = {};
    function getFunctions() { return {}; }
    function cleanPrompt(kind) { return 'preserve printed content: ' + kind; }
    function imageAnnounce() {}
    ${functionSource(mistakes, 'cleanFigureChatGpt')}
    return cleanFigureChatGpt;
  `)(() => async payload => { cleanupPayload = payload; return { data: { b64: 'QUJD', model: payload.model } }; });
  await cleanFigure(ref, 'figure');
  ok('the standalone Try-again cleaner explicitly requests Sunburst', cleanupPayload.model === 'gpt-image-2.5-sunburst');
  ok('the standalone cleaner preserves its source, shape and supported request fields',
     cleanupPayload.images[0].data === 'QUJD' && cleanupPayload.size === 'auto' && cleanupPayload.inputFidelity === undefined);
});

await run('request shape', async () => {
  const api = build();
  api.key = 'sk-test'; api.gemini = true; api.serverMode = 'precondition';
  const refs = ['data:image/png;base64,QUJD', 'data:image/jpeg;base64,REVG'];
  await api.generateImageDataUrl('redraw', { refDataUrls: refs, transparent: true });
  const call = api.fetchCalls[0];
  ok('a reference makes it an EDIT', /\/images\/edits$/.test(call.url));
  const fd = call.init.body;
  ok('…as multipart', typeof fd.getAll === 'function');
  ok('several references go up as image[]', fd.getAll('image[]').length === 2 && fd.getAll('image').length === 0);
  ok('input_fidelity is NEVER sent to the 2.5 family — it refuses the parameter', fd.get('input_fidelity') === null);
  ok('an edit keeps the reference\'s own shape by sending NO size (auto is the API default, and the word is refused by some models)', fd.get('size') === null);
  ok('transparent asks for a transparent background on png', fd.get('background') === 'transparent' && fd.get('output_format') === 'png');
  ok('the server was offered the same edit, and decides about fidelity itself', api.serverCalls[0].payload.images.length === 2 && api.serverCalls[0].payload.inputFidelity === undefined && api.serverCalls[0].payload.background === 'transparent');
  ok('the fidelity rule: gpt-image-1 and 1-mini take it, nothing newer does',
     api._imgFidelityFor('gpt-image-1') === 'high' && api._imgFidelityFor('gpt-image-1-mini') === 'high' && api._imgFidelityFor('gpt-image-1-2025-04-23') === 'high' &&
     api._imgFidelityFor('gpt-image-1.5') === '' && api._imgFidelityFor('gpt-image-2') === '' && api._imgFidelityFor('gpt-image-2.5-flare') === '' && api._imgFidelityFor('gpt-image-2.5-sunburst') === '');
  ok('the size rule: auto and blank send nothing, a real size goes through', api._imgSizeField('auto') === '' && api._imgSizeField('') === '' && api._imgSizeField('1536x1024') === '1536x1024');

  api.resetDown();
  await api.generateImageDataUrl('draw', { refDataUrl: 'data:image/png;base64,QUJD', model: 'gpt-image-1' });
  ok('…so a gpt-image-1 edit still carries input_fidelity high', api.fetchCalls[0].init.body.get('input_fidelity') === 'high' && api.fetchCalls[0].init.body.get('model') === 'gpt-image-1');

  api.resetDown();
  await api.generateImageDataUrl('draw', { refDataUrl: 'data:image/png;base64,QUJD', size: '1536x1024' });
  ok('an explicit size on an edit is sent as given', api.fetchCalls[0].init.body.get('size') === '1536x1024');

  ok('the retry net catches the wording the 2.5 family actually uses',
     api._isUnsupportedImageParam({ status: 400, detail: "The model 'gpt-image-2.5-flare' does not support the 'input_fidelity' parameter." }) &&
     api._isUnsupportedImageParam({ status: 400, detail: 'Unknown parameter: input_fidelity' }) &&
     api._isUnsupportedImageParam({ status: 400, detail: "Invalid value: 'auto'. Supported values are: '1024x1024'." }) &&
     api._isUnsupportedImageParam({ status: 400, detail: 'Unrecognized request argument supplied: quality' }) &&
     !api._isUnsupportedImageParam({ status: 400, detail: 'Incorrect API key provided' }) &&
     !api._isUnsupportedImageParam({ status: 401, detail: 'Unknown parameter: x' }));

  api.resetDown();
  await api.generateImageDataUrl('draw', { refDataUrl: 'data:image/png;base64,QUJD' });
  ok('one reference goes up as image, not image[]', api.fetchCalls[0].init.body.getAll('image').length === 1);

  api.resetDown();
  await api.generateImageDataUrl('draw', { media: { mimeType: 'image/png', data: 'QUJD' } });
  ok('the { mimeType, data } shape every enhance path builds is a reference too', /\/images\/edits$/.test(api.fetchCalls[0].url));

  api.resetDown();
  await api.generateImageDataUrl('draw', { quality: 'xhigh' });
  let body = JSON.parse(api.fetchCalls[0].init.body);
  ok('a generation is JSON on /generations', /\/images\/generations$/.test(api.fetchCalls[0].url) && body.model === 'gpt-image-2.5-flare');
  ok('xhigh is passed through to a 2.5 model', body.quality === 'xhigh');
  ok('…and png is the output', body.output_format === 'png' && body.size === '1024x1024');
  ok('the quality clamp: xhigh on a legacy model becomes high', api._imgQualityFor('gpt-image-1', 'xhigh') === 'high');
  ok('…and a nonsense quality is high', api._imgQualityFor('gpt-image-2.5-flare', 'ultra') === 'high');

  api.resetDown(); api.fetchMode = 'unsupported';
  await api.generateImageDataUrl('draw', { refDataUrl: 'data:image/png;base64,QUJD' });
  ok('an "unknown parameter" 400 is retried once with the bare minimum', api.fetchCalls.length === 2 && !api.fetchCalls[1].init.body.get('input_fidelity'));

  ok('_imgRefsFrom drops anything that is not an image data URL', api._imgRefsFrom({ refDataUrl: 'https://x/y.png', refDataUrls: ['data:image/png;base64,QUJD', 'nope'] }).length === 1);
  ok('an invalid-argument is a fault of the PICTURE, not the route', api._imgRouteFault({ code: 'functions/invalid-argument', message: 'x' }) === false);
  ok('a 400 about the key IS a route fault', api._imgRouteFault({ status: 400, message: 'Incorrect API key provided' }) === true);
  ok('a 401 is a route fault', api._imgRouteFault({ status: 401, message: 'x' }) === true);
});

/* ---------- the census — every picture goes through the door ---------- */
{
  const lines = src.split('\n');
  const callers = (re, allow) => lines.map((l, i) => ({ l, i })).filter(x => re.test(x.l) && !/^\s*(\/\/|\*|\/\*)/.test(x.l) && !/`[^`]*geminiImageModels[^`]*`/.test(x.l) && !allow(x.l)).map(x => (x.i + 1) + ': ' + x.l.trim());
  const rawGemini = callers(/generateImageDataUrlGemini\(/, l => /^async function generateImageDataUrlGemini/.test(l.trim()) || /return generateImageDataUrlGemini\(prompt, _imgRefsFrom\(opts\)\)/.test(l));
  ok('generateImageDataUrlGemini is reached ONLY from inside the door', rawGemini.length === 0, rawGemini.join('\n       '));
  const rawKey = callers(/openAiGenerateImageDataUrl\(/, l => /^async function openAiGenerateImageDataUrl/.test(l.trim()) || /return openAiGenerateImageDataUrl\(prompt, opts\)/.test(l));
  ok('openAiGenerateImageDataUrl is reached ONLY from inside the door', rawKey.length === 0, rawKey.join('\n       '));
  const rawServer = callers(/openAiImageServer\(/, l => /^async function openAiImageServer/.test(l.trim()) || /return openAiImageServer\(prompt, opts\)/.test(l));
  ok('openAiImageServer is reached ONLY from inside the door', rawServer.length === 0, rawServer.join('\n       '));
  const models = callers(/geminiImageModels/, l => /^(let|const) geminiImageModels/.test(l.trim()) || /geminiImageModels = AI_IMAGE_MODELS\.map/.test(l) || /const imageAiReady = /.test(l) || /return geminiImageModels\.length \? \['imgGemini'\]|!geminiImageModels\.length\) throw|for \(let i = 0; i < geminiImageModels\.length; i\+\+\)|const model = geminiImageModels\[i\];/.test(l));
  ok('nothing reaches the Gemini image models except the raw route and the readiness check', models.length === 0, models.join('\n       '));

  const at = src.indexOf('async function _tcgGenOnce');
  const tcg = src.slice(at, src.indexOf('\n}\n', at));
  ok('the Realm of Embers art generator goes through the door', /generateImageDataUrl\(prompt, \{ refDataUrl/.test(tcg) && !/openAiActive\(\)/.test(tcg));
  const dd = src.indexOf('async function _diagramDraw');
  const diag = src.slice(dd, src.indexOf('\n}\n', dd));
  ok('the teaching-diagram core goes through the door', /generateImageDataUrl\(buildPrompt\(kind\),/.test(diag));
  const en = src.indexOf('async function generateEnhancedImageDataUrl');
  const enh = src.slice(en, src.indexOf('\n}\n', en));
  ok('every enhance path goes through the door', /return await generateImageDataUrl\(prompt,/.test(enh));
  ok('the chat toggle no longer decides who draws', !/openAiActive\(\) \? 'ChatGPT · '/.test(src));
  ok('the Card Art label resolves the art purpose', /function _tcgArtEngineLabel\(\) \{ return imageEngineLabel\(\{ purpose: 'art' \}\); \}/.test(src));
  ok('imageAiReady counts ChatGPT Images as an image model', /const imageAiReady = \(\) => geminiImageModels\.length > 0 \|\| \(function \(\) \{ try \{ return imageOpenAiPossible\(\);/.test(src));
  ok('the callable is the function the Maths repo deploys', /httpsCallable\(_aiFns, 'openAiImage'/.test(src));
  ok('no API key is committed', !/sk-[A-Za-z0-9]{20,}/.test(src) && !/sk-[A-Za-z0-9]{20,}/.test(html) && !/sk-[A-Za-z0-9]{20,}/.test(mistakes));
}

/* ---------- the shared setting ---------- */
{
  ok('the image engine is written to the centre-wide document', /aiImageEngine: image,/.test(src) && /async function aiEngineSetShared\(engine, authorEngine, imageEngine\)/.test(src));
  ok('…and read by BOTH the live listener and the one-shot load', (src.match(/_aiSharedImageEngine = _aiImageFromDoc\(snap\.exists\(\) && snap\.data\(\)\);/g) || []).length === 2);
  ok('an unset field is ChatGPT Images', /const AI_IMAGE_ENGINE_DEFAULT = 'openai';/.test(src));
  ok('the callable fallback releases the image setting to the device', /_aiSharedAuthor = null;\n    _aiSharedImageEngine = null;/.test(src));
  ok('the dialog saves the picture engine with the rest', /await aiEngineSetShared\(eng, authEng, imgEng\);/.test(src) && /localStorage\.setItem\(AI_ENGINE_STORE\.imageEngine, imgEng\);/.test(src));
  ok('the store carries the two new slots', /imageEngine: 'sq_ai_image_engine', imageGen: 'sq_openai_image_gen'/.test(src));
  ok('the chooser prints the picture order', /🖼 Pictures — tried in this order/.test(src) && /function imageRouteReport\(/.test(src));
}

/* ---------- the dialog and the standalone page ---------- */
{
  ok('the dialog offers the picture engine, ChatGPT Images checked', /name="aiImageEngineChoice" value="openai" checked/.test(html) && /name="aiImageEngineChoice" value="gemini"/.test(html));
  ok('…previewing the order as the radios change', /aiEngineImageChoicePreview\('gemini'\)/.test(html) && /window\.aiEngineImageChoicePreview = aiEngineImageChoicePreview;/.test(src));
  ok('the dropdown in the markup selects automatic and offers Sunburst', /<option value="auto" selected>/.test(html) && /<option value="gpt-image-2\.5-sunburst">/.test(html));
  ok('…and the markup lists no id the code does not know', ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1', 'gpt-image-1-mini'].every(id => html.indexOf('<option value="' + id + '"') >= 0));
  ok('the dropdown opens with the saved choice, not a resolved concrete model', /imgSel\.innerHTML = openAiImageModelOptionsHtml\(getOpenAiImageModelChoice\(\)\);/.test(src));
  ok('a missing dropdown falls back to automatic when saving', /const imageModel = \(imgSelEl && imgSelEl\.value\) \|\| OPENAI_IMAGE_AUTO;/.test(src));
  ok('the Try-again sheet cleans figures with ChatGPT Images by the server key, sending no input_fidelity', /httpsCallable\(fns, 'openAiImage'/.test(mistakes) && !/inputFidelity/.test(mistakes));
  ok('no client sends input_fidelity unconditionally any more', !/fd\.append\('input_fidelity', 'high'\)/.test(src) && !/inputFidelity: refs\.length \? 'high'/.test(src));
  ok('…with Gemini as the fallback, not the plan', /falling back to Gemini/.test(mistakes) && /if \(!imageModels\.length\) throw first/.test(mistakes));
  ok('…and a refusal about one picture does not close the route there either', /invalid-argument/.test(mistakes));
  /* A FLOOR, never a pin. Written as `=== v1.373.` this passed on the day the
     fidelity fix shipped and went red on every single release after it — and a
     harness that is always red is one nobody runs, which costs far more than
     the bump it was nagging about. The invariant worth keeping is that the
     release carrying this block bumped the version, so the floor is that
     version and anything later. */
  const _ver = s => { const m = /const APP_VERSION = 'v(\d+)\.(\d+)\.(\d+)'/.exec(s); return m ? [+m[1], +m[2], +m[3]] : null; };
  const _atLeast = (s, a, b, c) => { const v = _ver(s); return !v ? false : v[0] !== a ? v[0] > a : v[1] !== b ? v[1] > b : v[2] >= c; };
  ok('the version was bumped for the release that carried this — a FLOOR, or the check goes red on every release after it',
     _atLeast(src, 1, 373, 0) && _atLeast(mistakes, 1, 6, 0));
}

/* ---------- 🖼 the green box — which model drew it ---------- */
await run('badge', async () => {
  const api = build({ x_openai_image_gen: 'images25' });
  ok('a Gemini route names Gemini and the id', api.imageEngineDescribe('imgGemini', 'gemini-3.1-flash-image-preview') === 'Gemini · gemini-3.1-flash-image-preview');
  ok('the server route names ChatGPT Images, the id and the key', api.imageEngineDescribe('imgServer', 'gpt-image-2.5-flare') === 'ChatGPT Images · gpt-image-2.5-flare · server key');
  ok('the browser-key route says the key is on this device', /key on this device$/.test(api.imageEngineDescribe('imgKey', 'gpt-image-2.5-sunburst')));
  ok('a missing model id falls back to the chosen image model rather than printing nothing', api.imageEngineDescribe('imgServer', '') === 'ChatGPT Images · gpt-image-2.5-flare · server key');

  // The server says which model REALLY drew it — a legacy pick falls back to
  // Flare on the server — and that is what the box names.
  api.resetDown();
  await api.generateImageDataUrl('draw', {});
  ok('after a server picture the door records the server route and its model', api.last.route === 'imgServer' && api.last.model === 'gpt-image-2.5-flare' && api.last.engine === 'openai');
  ok('…and announces it', api.announced.length === 1 && /🖼 Picture generated by ChatGPT Images · gpt-image-2\.5-flare · server key/.test(api.announced[0].text) && api.announced[0].type === 'image');
  ok('…without the fallback note when nothing refused', !/\(after /.test(api.announced[0].text));

  api.resetDown(); api.announced.length = 0;
  api.serverMode = 'precondition'; api.key = 'sk-test-key';
  api.store.x_openai_image_model = 'gpt-image-2.5-sunburst';
  await api.generateImageDataUrl('draw', {});
  ok('a browser-key picture names the id the key was asked for', api.last.route === 'imgKey' && api.last.model === 'gpt-image-2.5-sunburst');
  ok('…and says WHICH route refused first, and WHY', /\(after ChatGPT Images \(server key\) refused: No OpenAI key is configured on the server\./.test(api.announced[0].text) && /key on this device/.test(api.announced[0].text), api.announced[0].text);
  ok('…with the transport prefix stripped off the reason', !/functions\//.test(api.announced[0].text) && api.last.refusedBy === 'ChatGPT Images (server key)');
  ok('…and the chooser repeats it', /after ChatGPT Images \(server key\) refused: No OpenAI key/.test(api.imageRouteReport().notes.join(' ')), api.imageRouteReport().notes.join(' | '));

  api.resetDown(); api.announced.length = 0;
  api.serverMode = 'precondition'; api.key = ''; api.fetchMode = 'ok';
  await api.generateImageDataUrl('draw', {});
  ok('a Gemini fallback picture is announced as Gemini', api.last.route === 'imgGemini' && api.last.engine === 'gemini' && /🖼 Picture generated by Gemini/.test(api.announced[0].text));

  api.resetDown(); api.announced.length = 0;
  api.serverMode = 'precondition'; api.geminiMode = 'fail';
  let threw = false;
  try { await api.generateImageDataUrl('draw', {}); } catch (e) { threw = true; }
  ok('a picture that failed on every route announces NOTHING', threw && api.announced.length === 0 && api.last.route === '' && api.last.model === '');
  ok('the chooser note names the model too', /imageEngineDescribe\(imageLastCall\.route, imageLastCall\.model\)/.test(src));

  // The routes record the model where the picture is handed back.
  ok('the server route reads the model the server really used', /_imgRouteModel = \(typeof d\.model === 'string' && d\.model\) \? d\.model : model;/.test(src));
  ok('the browser-key route records the id it asks for', /_imgRouteModel = model; \/\/ the id this browser's key is about to ask for/.test(src));
  ok('the raw Gemini route records the id that answered, by index', /_imgRouteModel = AI_IMAGE_MODELS\[i\]/.test(src));
  ok('the door announces on the success branch only', (src.match(/imageAnnounce\(imageLastCall\);/g) || []).length === 1);
  ok('the box is its own toast type, held longer than an ordinary toast', /type === 'image' \? IMG_BADGE_MS : 3000/.test(src) && /case 'image':/.test(src));
  ok('…and painted a FIXED green, not --primary', /\.toast\.image \{ background: #15803d;/.test(html));
  ok('the Try-again sheet has its own box', /function imageAnnounce\(/.test(mistakes) && /#imgBadge/.test(mistakes) && /imageAnnounce\('ChatGPT Images · '/.test(mistakes) && /imageAnnounce\('Gemini · '/.test(mistakes));
});

console.log(`image-engine tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
