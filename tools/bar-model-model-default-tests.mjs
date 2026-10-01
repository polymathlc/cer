import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = fs.readFileSync(new URL('../bar-model.html', import.meta.url), 'utf8');
function section(from, to) {
  const start = html.indexOf(from), end = html.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `missing section: ${from}`);
  return html.slice(start, end);
}
const settings = section('var STORAGE_KEYS =', '/* ── Admin modal wiring');
const routing = section('  async function barGeminiVision(', '  /* ── Admin auth bridge');

function fixture(saved = {}, failures = {}) {
  const values = new Map(Object.entries(saved)), calls = [];
  const ctx = vm.createContext({
    window: {}, firebaseApp: {}, AI_THINK_MIN: 'low', Date,
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key)
    },
    getFunctions: () => ({}),
    httpsCallable: (_functions, name) => async payload => {
      const engine = name === 'askKimi' ? 'kimi' : 'openai';
      calls.push({ engine, payload });
      if (failures[engine] instanceof Error) throw failures[engine];
      return { data: { text: failures[engine] ?? `${engine} reply` } };
    },
    geminiModel: { generateContent: async payload => {
      calls.push({ engine: 'gemini', payload });
      if (failures.gemini instanceof Error) throw failures.gemini;
      return { response: { text: () => failures.gemini ?? 'gemini reply' } };
    } },
    fetch: async (_url, options) => {
      calls.push({ engine: 'openaiKey', payload: JSON.parse(options.body) });
      if (failures.openaiKey instanceof Error) throw failures.openaiKey;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'browser reply' } }] }) };
    }
  });
  vm.runInContext(settings + routing, ctx);
  return { values, calls, run: code => vm.runInContext(code, ctx) };
}

test('every inline script still parses', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 3);
  for (const [, script] of scripts) {
    const code = script.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];/gm, '');
    new vm.Script(code);
  }
});

test('new devices use GPT 6.1 Sol for server vision and low reasoning', async () => {
  const f = fixture();
  assert.equal(f.run('getStoredOpenAiModel()'), 'gpt-6.1-sol');
  assert.equal(f.run('getStoredMarkingEngine()'), 'openai');
  assert.equal(await f.run("window.askGeminiVision('Mark the image', 'pixels', 'image/png', { json: true })"), 'openai reply');
  assert.equal(f.calls[0].payload.model, 'gpt-6.1-sol');
  assert.equal(f.calls[0].payload.reasoningEffort, 'low');
  assert.equal(f.calls[0].payload.media[0].data, 'pixels');
});

test('stored old defaults migrate once; explicit choices survive', () => {
  const old = fixture({ pbms_openai_model: 'gpt-6-astra', pbms_marking_engine: 'gemini' });
  assert.equal(old.run('getStoredOpenAiModel()'), 'gpt-6.1-sol');
  assert.equal(old.run('getStoredMarkingEngine()'), 'openai');
  assert.equal(old.values.get('pbms_openai_model_gen'), 'sol61');
  const manual = fixture({ pbms_openai_model: 'gpt-6-astra', pbms_openai_model_choice: 'manual', pbms_marking_engine: 'gemini', pbms_marking_engine_choice: 'manual' });
  assert.equal(manual.run('getStoredOpenAiModel()'), 'gpt-6-astra');
  assert.equal(manual.run('getStoredMarkingEngine()'), 'gemini');
  const after = fixture({ pbms_openai_model: 'gpt-6-astra', pbms_openai_model_gen: 'sol61' });
  assert.equal(after.run('getStoredOpenAiModel()'), 'gpt-6-astra');
});

test('server refusal reaches Gemini with the original attachment', async () => {
  const f = fixture({}, { openai: new Error('quota') });
  assert.equal(await f.run("window.askGeminiVision('Read this', 'pixels', 'image/jpeg')"), 'gemini reply');
  assert.deepEqual(f.calls.map(c => c.engine), ['openai', 'gemini']);
  assert.equal(f.calls[1].payload.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.equal(f.run('window.barAiLastCall.engine'), 'gemini');
  assert.equal(f.run('window.barAiLastCall.fellBack'), true);
});

test('two provider failures reach authenticated Kimi', async () => {
  const f = fixture({}, { openai: new Error('quota'), gemini: new Error('cap') });
  assert.equal(await f.run("window.askGeminiVision('Read this', 'pixels', 'image/png')"), 'kimi reply');
  assert.deepEqual(f.calls.map(c => c.engine), ['openai', 'gemini', 'kimi']);
  assert.equal(f.calls[2].payload.media[0].data, 'pixels');
});

test('browser key is a fallback behind the server, with correct JPEG and reasoning shape', async () => {
  const f = fixture({ pbms_openai_key: 'mock-key' }, { openai: new Error('function missing') });
  assert.equal(await f.run("window.askGeminiVision('Reply JSON', 'pixels', 'image/jpeg', { maxOutputTokens: 800 })"), 'browser reply');
  assert.deepEqual(f.calls.map(c => c.engine), ['openai', 'openaiKey']);
  const body = f.calls[1].payload;
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_completion_tokens, 4896);
  assert.equal(body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,pixels');
  assert.ok(!('temperature' in body));
});

test('text-only calls do not invent an attachment and manual provider keeps backups', async () => {
  const f = fixture({ pbms_marking_engine: 'kimi', pbms_marking_engine_choice: 'manual' }, { kimi: new Error('offline') });
  assert.equal(await f.run("window.askGeminiVision('Explain this', null, null, { json: false })"), 'openai reply');
  assert.deepEqual(f.calls.map(c => c.engine), ['kimi', 'openai']);
  assert.equal(f.calls[1].payload.media.length, 0);
  assert.equal(f.calls[1].payload.json, false);
});

test('empty replies trigger backup and exhaustion names every route', async () => {
  const f = fixture({}, { openai: '', gemini: '' });
  assert.equal(await f.run("window.askGeminiVision('Explain this')"), 'kimi reply');
  const broken = fixture({}, { openai: new Error('quota'), gemini: new Error('cap'), kimi: new Error('offline') });
  await assert.rejects(broken.run("window.askGeminiVision('Explain this')"), /openai: quota.*gemini: cap.*kimi: offline/);
});

test('audio retains its dedicated route and the settings no longer require a browser key', () => {
  assert.match(html, /const AI_TRANSCRIBE_MODEL = "gemini-3\.5-transcribe"/);
  assert.match(html, /window\.__transcribeReady = \(\) => !!\(geminiModel \|\| transcribeModelGet\(\)\)/);
  assert.doesNotMatch(html, /ChatGPT is selected but no API key is entered/);
  assert.match(section('async function runAiCheck(', 'var result = parseMarkingResponse'), /window\.barAiLastCall/);
  assert.match(html, /window\.__aiReady = \(\) => true/);
});
