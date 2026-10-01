import assert from 'node:assert/strict';
import test from 'node:test';
import {createPortalModelRouter} from '../portal-model-router.mjs';

test('standalone vision and thinking requests start on GPT 6.1 Sol', async () => {
  let payload;
  const ask = createPortalModelRouter({call: async (name, data) => {assert.equal(name, 'askOpenAi'); payload = data; return 'answer';}, gemini: () => {throw new Error('should not run');}});
  const image = {mimeType:'image/png',data:'aW1hZ2U='};
  assert.equal(await ask('Read JSON', [image], {reasoningEffort:'high'}), 'answer');
  assert.equal(payload.model, 'gpt-6.1-sol');
  assert.equal(payload.reasoningEffort, 'high');
  assert.deepEqual(payload.media, [image]);
});

test('Kimi follows failed OpenAI and empty Gemini while keeping images', async () => {
  const order = [];
  const ask = createPortalModelRouter({call: async (name, data) => {order.push(name); if(name === 'askOpenAi') throw new Error('quota'); assert.equal(data.model, 'kimi-k3'); assert.equal(data.media[0].data, 'x'); return 'backup';}, gemini: () => ({generateContent: async () => {order.push('gemini'); return {response: {text: () => ''}};}})});
  assert.equal(await ask('question', [{mimeType:'image/png',data:'x'}]), 'backup');
  assert.deepEqual(order, ['askOpenAi','gemini','askKimi']);
});

test('all provider failures retain the original problem', async () => {
  const ask = createPortalModelRouter({call: async () => {throw new Error('server unavailable');}, gemini: () => null});
  await assert.rejects(ask('question'), /server unavailable/);
});
