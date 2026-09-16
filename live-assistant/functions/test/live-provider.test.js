'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createProvider } = require('../live-provider');

function socketFactory(mode, seen) {
  return (url, options) => {
    seen.push({ url, options });
    const socket = new EventEmitter();
    socket.terminate = () => { seen.push('terminated'); };
    socket.send = raw => {
      seen.push(JSON.parse(raw));
      queueMicrotask(() => {
        if (mode === 'success') {
          socket.emit('message', Buffer.from('{"type":"session.output_transcript.delta","delta":"private speech"}'));
          socket.emit('message', Buffer.from('{"type":"session.closed"}'));
        } else if (mode === 'lost') socket.emit('close');
        else if (mode === 'error') socket.emit('error', new Error('secret upstream'));
      });
    };
    queueMicrotask(() => {
      if (typeof mode === 'number') socket.emit('unexpected-response', {}, { statusCode: mode, resume() {} });
      else socket.emit('open');
    });
    return socket;
  };
}

test('creates with server authorization and exact JSON Live transport, preserving opaque ID', async () => {
  let request;
  const provider = createProvider({ apiKey: () => 'server-secret', connect() {}, fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, async json() { return { session: { id: 'live-opaque_abc' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }; } };
  } });
  const result = await provider.create('offer', { model: 'fixed' });
  assert.equal(request.url, 'https://api.openai.com/v1/live/sessions');
  assert.equal(request.options.headers.Authorization, 'Bearer server-secret');
  assert.deepEqual(JSON.parse(request.options.body), { session: { model: 'fixed' }, transport: { type: 'webrtc', sdp: 'offer' } });
  assert.deepEqual(result, { sessionId: 'live-opaque_abc', sdp: 'v=0\r\nanswer' });
  assert.ok(!('key' in result));
});

test('does not contact OpenAI if the server secret is missing', async () => {
  const provider = createProvider({ apiKey: () => '', connect() {}, fetchImpl() { throw new Error('should not fetch'); } });
  await assert.rejects(provider.create('offer', {}), error => error.code === 'live_not_configured');
});

test('upstream error bodies are never read or exposed', async () => {
  for (const status of [401, 403, 429, 500]) {
    const provider = createProvider({ apiKey: () => 'secret', connect() {}, fetchImpl: async () => ({ ok: false, status, async json() { throw new Error('must not read sensitive payload'); } }) });
    await assert.rejects(provider.create('offer', {}), error => !error.message.includes('sensitive') && (status !== 429 || error.status === 429));
  }
});

test('closing uses an authenticated sideband, waits for session.closed, and ignores reflected speech', async () => {
  const seen = [];
  const provider = createProvider({ apiKey: () => 'secret', connect: socketFactory('success', seen) });
  await provider.close('live-opaque_abc');
  assert.equal(seen[0].url, 'wss://api.openai.com/v1/live/sessions/live-opaque_abc/attach');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(seen[1], { type: 'session.close' });
  assert.equal(seen.at(-1), 'terminated');
  assert.ok(!seen.some(value => value?.type === 'session.start'));
});

test('a socket disconnect without the terminal event does not confirm a stopped paid call', async () => {
  const provider = createProvider({ apiKey: () => 'secret', connect: socketFactory('lost', []) });
  await assert.rejects(provider.close('live-1'), /not confirmed/);
});

test('already-closed calls are idempotent but auth and upstream failures remain retriable', async () => {
  for (const status of [404, 410]) await createProvider({ apiKey: () => 'secret', connect: socketFactory(status, []) }).close('live-1');
  for (const status of [401, 403, 429, 500]) await assert.rejects(createProvider({ apiKey: () => 'secret', connect: socketFactory(status, []) }).close('live-1'));
});

test('an unresponsive close times out instead of releasing the lease', async () => {
  const seen = [];
  const provider = createProvider({ apiKey: () => 'secret', connect: socketFactory('silent', seen), closeTimeoutMs: 5 });
  await assert.rejects(provider.close('live-1'), /timed out/);
  assert.equal(seen.at(-1), 'terminated');
});

test('a malformed SDP answer retains the known session ID for server cleanup', async () => {
  const seen = [];
  const provider = createProvider({ apiKey: () => 'secret', connect: socketFactory('success', seen), fetchImpl: async () => ({ ok: true, async json() { return { session: { id: 'live-1' }, transport: { type: 'webrtc', sdp: 'bad' } }; } }) });
  await assert.rejects(provider.create('offer', {}), error => error.message === 'Invalid live answer.' && error.sessionId === 'live-1');
  assert.deepEqual(seen, []);
});
