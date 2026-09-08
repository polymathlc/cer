// 🖼 THE IMAGE ENGINE — ChatGPT Images 2.5 for every picture (v1.372.0)
//
// Loads the REAL image-engine block out of app.js against stubs and pins the
// things that fail silently — the app draws a picture either way, and a
// picture that came out of the wrong model looks exactly like one that did
// not:
//
//  • the default model is gpt-image-2.5-flare, the dropdown leads with it,
//    and an id the dropdown no longer offers falls back to it (not a 404 on
//    every picture);
//  • the one-shot LIFT: a device carrying yesterday's default (gpt-image-1)
//    is moved to Flare ONCE, and a deliberate re-pick afterwards sticks;
//  • the ORDER: ChatGPT Images by the server's key, then a key in this
//    browser, then Gemini — regardless of the TEXT engine; and Gemini first
//    only when the admin chose it;
//  • the door FALLS THROUGH: a server route that is not deployed hands over
//    to the browser key, which hands over to Gemini, and when everything
//    refuses the error names EVERY route;
//  • a refusal about ONE picture (invalid-argument) does not close the route;
//  • the request shape: edits carry input_fidelity high, several references
//    go up as image[], transparent asks for png, and xhigh is clamped to
//    high on a legacy model;
//  • the census: no caller reaches generateImageDataUrlGemini or
//    openAiGenerateImageDataUrl except the door; _tcgGenOnce, _diagramDraw
//    and generateEnhancedImageDataUrl all go through generateImageDataUrl;
//  • the dialog offers the picture engine and the 2.5 models, the shared
//    setting is written and read, and mistakes.html has the server route.
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mistakes = fs.readFileSync(new URL('../mistakes.html', import.meta.url), 'utf8');

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
var serverMode = 'ok', serverCalls = [];
function httpsCallable(_f, name) {
  return async function (payload) {
    serverCalls.push({ name: name, payload: payload });
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
  set fetchMode(v) { fetchMode = v; },
  set geminiMode(v) { geminiMode = v; },
  get serverCalls() { return serverCalls; },
  get fetchCalls() { return fetchCalls; },
  get geminiCalls() { return geminiCalls; },
  get last() { return imageLastCall; },
  get down() { return _aiDown; },
  resetDown: function () { Object.keys(_aiDown).forEach(function (k) { _aiDown[k] = 0; }); serverCalls.length = 0; fetchCalls.length = 0; geminiCalls.length = 0; },
  OPENAI_IMAGE_DEFAULT_MODEL, OPENAI_IMAGE_MODELS, OPENAI_IMAGE_25_RE, OPENAI_IMAGE_SUPERSEDED, OPENAI_IMAGE_GEN,
  getOpenAiImageModel, openAiImageModelKnown, openAiImageModelOptionsHtml, aiImageEngineSetting,
  imageEngineOrder, imageOpenAiPossible, imageEngineLabel, _tcgArtEngineLabel, _imgRefsFrom, _imgQualityFor,
  openAiGenerateImageDataUrl, openAiImageServer, generateImageDataUrl, imageRouteReport, _imgRouteFault
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
  ok('the default image model is ChatGPT Images 2.5 Flare', api.OPENAI_IMAGE_DEFAULT_MODEL === 'gpt-image-2.5-flare');
  ok('the dropdown leads with Flare and offers Sunburst second',
     api.OPENAI_IMAGE_MODELS[0].id === 'gpt-image-2.5-flare' && api.OPENAI_IMAGE_MODELS[1].id === 'gpt-image-2.5-sunburst');
  ok('the family regex takes both 2.5 models and their dated snapshots',
     ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.5-sunburst-2026-09-08'].every(id => api.OPENAI_IMAGE_25_RE.test(id)));
  ok('…and refuses everything outside it', ['gpt-image-2', 'gpt-image-1', 'gpt-image-2.5', 'gpt-image-3-flare', 'chatgpt-image-latest'].every(id => !api.OPENAI_IMAGE_25_RE.test(id)));
  ok('with nothing stored the model is the default', api.getOpenAiImageModel() === 'gpt-image-2.5-flare');
  api.store.x_openai_image_model = 'gpt-image-9-nova';
  ok('an id the dropdown no longer offers is the DEFAULT, not a 404 on every picture', api.getOpenAiImageModel() === 'gpt-image-2.5-flare');
  api.store.x_openai_image_model = 'gpt-image-2.5-sunburst';
  ok('a deliberate Sunburst pick is honoured', api.getOpenAiImageModel() === 'gpt-image-2.5-sunburst');
  api.store.x_openai_image_model = 'gpt-image-2.5-flare-2026-09-08';
  ok('a dated snapshot is honoured too', api.getOpenAiImageModel() === 'gpt-image-2.5-flare-2026-09-08');
  const opts = api.openAiImageModelOptionsHtml('gpt-image-2.5-sunburst');
  ok('the <select> is BUILT from the list', (opts.match(/<option/g) || []).length === api.OPENAI_IMAGE_MODELS.length);
  ok('…with the stored model selected', /value="gpt-image-2.5-sunburst" selected/.test(opts));
  ok('every legacy default is on the superseded list', ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-2'].every(id => api.OPENAI_IMAGE_SUPERSEDED.includes(id)));
  ok('…and neither 2.5 model is', !api.OPENAI_IMAGE_SUPERSEDED.some(id => api.OPENAI_IMAGE_25_RE.test(id)));
});

/* ---------- the one-shot lift ---------- */
await run('lift', () => {
  let api = build({ x_openai_image_model: 'gpt-image-1' });
  ok('a device carrying yesterday\'s default is lifted to Flare', api.store.x_openai_image_model === 'gpt-image-2.5-flare');
  ok('…and the lift is recorded', api.store.x_openai_image_gen === api.OPENAI_IMAGE_GEN);
  api = build({ x_openai_image_model: 'gpt-image-1', x_openai_image_gen: 'images25' });
  ok('a deliberate re-pick of a legacy model AFTER the lift sticks', api.store.x_openai_image_model === 'gpt-image-1');
  api = build({ x_openai_image_model: 'gpt-image-2.5-sunburst' });
  ok('a 2.5 pick is never touched by the lift', api.store.x_openai_image_model === 'gpt-image-2.5-sunburst');
  api = build({});
  ok('an empty slot stays empty (the default is read at call time)', !api.store.x_openai_image_model && api.getOpenAiImageModel() === 'gpt-image-2.5-flare');
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
  ok('…and the Card Art tab\'s old name still answers', api._tcgArtEngineLabel() === api.imageEngineLabel());
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
  ok('input_fidelity is high on every edit', fd.get('input_fidelity') === 'high');
  ok('an edit keeps the reference\'s own shape', fd.get('size') === 'auto');
  ok('transparent asks for a transparent background on png', fd.get('background') === 'transparent' && fd.get('output_format') === 'png');
  ok('the server was offered the same edit', api.serverCalls[0].payload.images.length === 2 && api.serverCalls[0].payload.inputFidelity === 'high' && api.serverCalls[0].payload.background === 'transparent');

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
  ok('the teaching-diagram core goes through the door', /generateImageDataUrl\(buildPrompt\(kind\), \{ refDataUrl: ref \}\)/.test(diag));
  const en = src.indexOf('async function generateEnhancedImageDataUrl');
  const enh = src.slice(en, src.indexOf('\n}\n', en));
  ok('every enhance path goes through the door', /return await generateImageDataUrl\(prompt, \{ media: list \}\)/.test(enh));
  ok('the chat toggle no longer decides who draws', !/openAiActive\(\) \? 'ChatGPT · '/.test(src));
  ok('the Card Art label reads the image engine', /function _tcgArtEngineLabel\(\) \{ return imageEngineLabel\(\); \}/.test(src));
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
  ok('the dropdown in the markup leads with Flare, selected', /<option value="gpt-image-2\.5-flare" selected>/.test(html) && /<option value="gpt-image-2\.5-sunburst">/.test(html));
  ok('…and the markup lists no id the code does not know', ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1', 'gpt-image-1-mini'].every(id => html.indexOf('<option value="' + id + '"') >= 0));
  ok('the dropdown is rebuilt from the list when the dialog opens', /imgSel\.innerHTML = openAiImageModelOptionsHtml\(getOpenAiImageModel\(\)\);/.test(src));
  ok('the Try-again sheet cleans figures with ChatGPT Images by the server key', /httpsCallable\(fns, 'openAiImage'/.test(mistakes) && /inputFidelity: 'high'/.test(mistakes));
  ok('…with Gemini as the fallback, not the plan', /falling back to Gemini/.test(mistakes) && /if \(!imageModels\.length\) throw first/.test(mistakes));
  ok('…and a refusal about one picture does not close the route there either', /invalid-argument/.test(mistakes));
  ok('the version was bumped', /const APP_VERSION = 'v1\.373\./.test(src) && /const APP_VERSION = 'v1\.6\./.test(mistakes));
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
  ok('…without the fallback note when nothing refused', !/after another route refused/.test(api.announced[0].text));

  api.resetDown(); api.announced.length = 0;
  api.serverMode = 'precondition'; api.key = 'sk-test-key';
  api.store.x_openai_image_model = 'gpt-image-2.5-sunburst';
  await api.generateImageDataUrl('draw', {});
  ok('a browser-key picture names the id the key was asked for', api.last.route === 'imgKey' && api.last.model === 'gpt-image-2.5-sunburst');
  ok('…and says another route refused first', /after another route refused/.test(api.announced[0].text) && /key on this device/.test(api.announced[0].text));

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
