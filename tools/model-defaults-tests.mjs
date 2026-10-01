import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('const AI_ENGINE_STORE =');
const end = source.indexOf('/* =====================================================================', start);
const prelude = source.slice(start, end);

function load(saved = {}, reply = {}) {
  const values = new Map(Object.entries(saved));
  const storage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, String(v)) };
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({url, body: JSON.parse(opts.body)});
    return {ok: true, json: async () => ({choices: [{finish_reason: 'stop', message: {content: 'Answer'}}], ...reply})};
  };
  const api = new Function('localStorage', 'fetch', prelude + '\nreturn {getAiEngine,getOpenAiModel,askOpenAI};')(storage, fetch);
  return {api, calls, values, storage, fetch};
}

test('fresh browser defaults to GPT 6.1 Sol, including the engine', () => {
  const {api} = load();
  assert.equal(api.getAiEngine(), 'openai');
  assert.equal(api.getOpenAiModel(), 'gpt-6.1-sol');
});

test('former defaults migrate once and a subsequent deliberate model pick survives', () => {
  for (const model of ['gpt-5.6-sol', 'gpt-6-astra']) {
    const {api, storage, fetch, values} = load({sq_openai_model: model, sq_openai_model_gen: 'astra'});
    assert.equal(api.getOpenAiModel(), 'gpt-6.1-sol');
    values.set('sq_openai_model', model);
    const reloaded = new Function('localStorage', 'fetch', prelude + '\nreturn getOpenAiModel();')(storage, fetch);
    assert.equal(reloaded, model);
  }
  assert.equal(load({sq_openai_model: 'gpt-4.1'}).api.getOpenAiModel(), 'gpt-4.1');
});

test('vision and thinking use Sol with a supported effort and no sampling parameters', async () => {
  const {api, calls} = load();
  await api.askOpenAI('Read the diagram', [{mimeType: 'image/png', data: 'aW1hZ2U='}], {maxOutputTokens: 2048, temperature: 0.3, reasoningEffort: 'high'});
  const body = calls[0].body;
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.max_completion_tokens, 6144);
  assert.ok(!('temperature' in body));
  assert.equal(body.messages[0].content[1].image_url.url, 'data:image/png;base64,aW1hZ2U=');
});

test('unsupported no-thinking effort becomes low, and widget ceiling stays exact', async () => {
  for (const effort of ['none', 'minimal']) {
    const {api, calls} = load();
    await api.askOpenAI('Build an app', [], {reasoningEffort: effort, maxOutputTokens: 1024, exactOutputBudget: true});
    assert.equal(calls[0].body.reasoning_effort, 'low');
    assert.equal(calls[0].body.max_completion_tokens, 1024);
  }
});

test('a truncated response is never presented as a complete answer', async () => {
  const {api} = load({}, {choices: [{finish_reason: 'length', message: {content: 'Partial answer'}}]});
  await assert.rejects(api.askOpenAI('Question'), /incomplete/);
});
