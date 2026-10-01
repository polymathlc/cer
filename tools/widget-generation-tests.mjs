// The app builder must never turn a small token budget into an uncapped call,
// repeat a failed provider, or replace a working app with a truncated reply.
// Run: node tools/widget-generation-tests.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const helpers = createRequire(import.meta.url)('../question-apps.js');

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Missing application section: ' + start);
  return source.slice(a, b);
}
const complete = '<!DOCTYPE html><html><head></head><body><button>Try me</button></body></html>';
const api = new Function('complete', 'helpers', `
  const AI_THINK_MIN = 'low';
  const AI_ENGINES = ['openai', 'gemini', 'kimi'];
  const AI_ROUTE_LABEL = { openai: 'OpenAI', gemini: 'Gemini', kimi: 'Kimi' };
  let aiLastCall = {}, _aiWhy = {};
  function _aiMarkUp() {}
  function _aiMarkDown(engine, why) { _aiWhy[engine] = why; }
  function getOpenAiKey() { return ''; }
  function getKimiKey() { return ''; }
  const WIDGET_HTML_MAX = 300000;
  ${section('const WIDGET_EFFORTS =', 'let _widgetBusy =')}
  let reply = complete, finishReason = 'STOP', calls = [], failEngines = new Set();
  const window = { QuestionApps: helpers };
  async function askOpenAiServer(prompt, media, options) {
    calls.push({ engine: 'openai', prompt, media, options });
    if (failEngines.has('openai')) throw new Error('Server unavailable');
    return reply;
  }
  let geminiModel = { async generateContent(request) {
    calls.push({ engine: 'gemini', request });
    if (failEngines.has('gemini')) throw new Error('Gemini unavailable');
    return { response: { candidates: [{ finishReason }], text: () => reply } };
  } };
  async function askKimiServer(prompt, media, options) {
    calls.push({ engine: 'kimi', prompt, media, options });
    if (failEngines.has('kimi')) throw new Error('Kimi unavailable');
    return reply;
  }
  ${section('function _aiRoutesFor(', '/* ⚡ QUESTION ADDING')}
  ${section('function _aiRun(', '/* ChatGPT by whichever route')}
  ${section('async function askGeminiDirect(', '/* What the chooser prints.')}
  ${section('async function _widgetAskAI(', 'async function _widgetRun(')}
  return {
    ask: _widgetAskAI, extract: _widgetExtractHtml,
    get calls() { return calls; },
    reset(options = {}) { calls = []; _aiWhy = {}; reply = options.reply ?? complete; finishReason = options.finishReason || 'STOP'; failEngines = new Set(options.fail ? AI_ENGINES : (options.failEngines || [])); }
  };
`)(complete, helpers);

assert.equal(helpers.normalizeTokenLimit(''), 4096);
assert.equal(helpers.normalizeTokenLimit('invalid'), 4096);
assert.equal(helpers.normalizeTokenLimit(-1), 1024, 'The lowest selectable ceiling matches the server floor');
assert.equal(helpers.normalizeTokenLimit(999999), 32000);

for (const engine of ['openai', 'gemini']) {
  for (const effort of ['standard', 'high', 'pro']) {
    for (const limit of [1024, 4096, 32000]) {
      api.reset();
      assert.equal(await api.ask(engine, effort, 'Build a simulation', limit), complete);
      assert.equal(api.calls.length, 1, engine + ' / ' + effort + ' makes one request');
      const call = api.calls[0];
      const actual = engine === 'openai' ? call.options.maxOutputTokens : call.request.generationConfig.maxOutputTokens;
      assert.equal(actual, limit, engine + ' / ' + effort + ' honours the selected ceiling');
    }
  }
  api.reset();
  await api.ask(engine, 'pro', 'Build a simulation');
  assert.equal(engine === 'openai' ? api.calls[0].options.maxOutputTokens : api.calls[0].request.generationConfig.maxOutputTokens, 4096, 'Old blocks receive a capped default');
  api.reset({ fail: true });
  await assert.rejects(api.ask(engine, 'pro', 'Build a simulation', 2048), /unavailable/);
  assert.deepEqual(api.calls.map(c => c.engine), [engine, ...['openai', 'gemini', 'kimi'].filter(e => e !== engine)], 'Failures try each configured provider once');
  for (const call of api.calls) {
    assert.equal(call.engine === 'gemini' ? call.request.generationConfig.maxOutputTokens : call.options.maxOutputTokens, 2048, 'Every fallback retains the selected token ceiling');
    if (call.engine !== 'gemini') assert.equal(call.options.exactOutputBudget, true);
  }
  api.reset();
  const pictures = [
    { mimeType: 'image/png', data: 'diagram' },
    { mimeType: 'image/jpeg', data: 'chart' },
    { mimeType: 'image/webp', data: 'apparatus' },
    { mimeType: 'image/png', data: 'fourth-image' },
    { mimeType: 'application/pdf', data: 'not-an-image' }
  ];
  await api.ask(engine, 'standard', 'Use these diagrams', 4096, pictures);
  const sent = engine === 'openai' ? api.calls[0].media : api.calls[0].request.contents[0].parts.slice(1).map(part => part.inlineData);
  assert.deepEqual(sent, pictures.slice(0, 3), 'Both engines receive the same three question diagrams');
}

api.reset({ finishReason: 'MAX_TOKENS' });
assert.equal(await api.ask('gemini', 'pro', 'Build a simulation', 1024), complete);
assert.deepEqual(api.calls.map(c => c.engine), ['gemini', 'openai'], 'A truncated provider falls back without repeating that provider');
assert.equal(api.calls[1].options.maxOutputTokens, 1024);
api.reset({ failEngines: ['openai', 'gemini'] });
const backupPictures = [{ mimeType: 'image/png', data: 'fallback-diagram' }];
assert.equal(await api.ask('openai', 'pro', 'Keep this prompt', 2048, backupPictures), complete);
assert.deepEqual(api.calls.map(c => c.engine), ['openai', 'gemini', 'kimi']);
assert.equal(api.calls[2].prompt, 'Keep this prompt');
assert.deepEqual(api.calls[2].media, backupPictures);
assert.equal(api.calls[2].options.reasoningEffort, 'high');
assert.equal(api.calls[2].options.exactOutputBudget, true);
assert.equal(api.extract('```html\n' + complete + '\n```'), complete);
assert.equal(api.extract('Here is the app:\n' + complete + '\nDone.'), complete);
for (const incomplete of ['', 'some text', '<button>Partial app</button>', '<!DOCTYPE html><html><body><script>function draw() {']) {
  assert.throws(() => api.extract(incomplete), /complete|incomplete/i, 'Incomplete AI reply is refused');
}
assert.throws(() => api.extract('<html><body>' + 'x'.repeat(300000) + '</body></html>'), /too large/i);
console.log('App generation: token caps, provider backups and incomplete-output protection passed.');
