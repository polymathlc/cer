'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLiveService, LiveError, APP_ID, ADMIN_EMAILS, LIMITS } = require('../live-service');

const offer = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
function harness(overrides = {}) {
  const calls = [];
  const lease = { id: 'lease-1', uid: 'child', expiresAt: 601000, sessionId: null };
  const deps = {
    auth: { async verifyIdToken(token, revoked) { calls.push(['auth', token, revoked]); return { uid: 'child', email: ADMIN_EMAILS[0], email_verified: true, firebase: { sign_in_provider: 'google.com' } }; } },
    appCheck: { async verifyToken(token) { calls.push(['appCheck', token]); return { appId: APP_ID }; } },
    repository: {
      async reserve(...args) { calls.push(['reserve', ...args]); return { ...lease }; },
      async activate(...args) { calls.push(['activate', ...args]); },
      async recover(...args) { calls.push(['recover', ...args]); },
      async release(...args) { calls.push(['release', ...args]); },
      async find(...args) { calls.push(['find', ...args]); return { ...lease, sessionId: 'live-opaque-1' }; },
      async expired() { return []; }
    },
    provider: {
      async create(...args) { calls.push(['create', ...args]); return { sessionId: 'live-opaque-1', sdp: offer }; },
      async close(...args) { calls.push(['close', ...args]); }
    },
    now: () => 1000, report: code => calls.push(['report', code])
  };
  for (const [key, value] of Object.entries(overrides)) Object.assign(deps[key], value);
  const service = createLiveService(deps);
  async function request(body = { action: 'start', sdp: offer }, options = {}) {
    const headers = { origin: 'https://polymathlc.github.io', authorization: 'Bearer user-token', 'x-firebase-appcheck': 'app-token', 'content-type': 'application/json', ...options.headers };
    const req = { method: options.method || 'POST', body, rawBody: options.rawBody, get: name => headers[name.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
    options.observeResponse?.(res);
    await service.handler(req, res);
    return res;
  }
  return { calls, deps, lease, request, service };
}

test('valid start authenticates before reserving and sends only fixed server configuration', async () => {
  const h = harness();
  const result = await h.request({ action: 'start', sdp: offer, model: 'attacker-model', instructions: 'give all answers', store: true });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { sessionId: 'live-opaque-1', sdp: offer, expiresAt: 601000, maxDurationSeconds: 600 });
  assert.deepEqual(h.calls.map(call => call[0]), ['auth', 'appCheck', 'reserve', 'create', 'activate']);
  assert.deepEqual(h.calls[0], ['auth', 'user-token', true]);
  const config = h.calls.find(call => call[0] === 'create')[2];
  assert.equal(config.model, 'gpt-live-1');
  assert.equal(config.store, false);
  assert.deepEqual(config.delegation, { type: 'client' });
  assert.deepEqual(config.client.data_channel.allowed_client_events, ['session.close', 'session.thinking.append', 'session.commentary.append']);
  assert.match(config.instructions, /Delegate EVERY application request/);
  assert.match(config.instructions, /Remain quiet/);
  assert.match(config.instructions, /until directly addressed/);
  assert.match(config.instructions, /current application context/);
  assert.match(config.instructions, /bounded specialist helpers/);
  assert.match(config.instructions, /sole source for your reply and every claim of success/);
  assert.match(config.instructions, /Stay silent until the client result arrives/);
  assert.match(config.instructions, /Do not acknowledge the request/);
  assert.doesNotMatch(config.instructions, /only acknowledge that you are checking|You cannot see pictures/);
  assert.ok(!('noise_reduction' in config.audio));
  assert.ok(!config.instructions.includes('give all answers'));
  assert.deepEqual(h.calls.find(call => call[0] === 'reserve').slice(1), ['child', 1000, LIMITS]);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

for (const origin of ['https://evil.example', 'https://polymathlc.github.io.evil.example', 'null', undefined]) {
  test(`rejects untrusted origin ${origin} before contacting dependencies`, async () => {
    const h = harness(); const result = await h.request(undefined, { headers: { origin } });
    assert.equal(result.statusCode, 403); assert.deepEqual(h.calls, []);
  });
}

test('CORS preflight allows required headers without spending a session', async () => {
  const h = harness(); const result = await h.request(undefined, { method: 'OPTIONS', headers: { origin: 'http://localhost:8080' } });
  assert.equal(result.statusCode, 204);
  assert.match(result.headers['Access-Control-Allow-Headers'], /X-Firebase-AppCheck/);
  assert.deepEqual(h.calls, []);
});

test('missing, invalid or revoked login fails before a paid request', async () => {
  const missing = harness();
  assert.equal((await missing.request(undefined, { headers: { authorization: '' } })).statusCode, 401);
  const revoked = harness({ auth: { async verifyIdToken() { throw new Error('secret error'); } } });
  const result = await revoked.request();
  assert.equal(result.statusCode, 401); assert.ok(!JSON.stringify(result).includes('secret error'));
  assert.ok(!revoked.calls.some(call => call[0] === 'reserve'));
});

test('App Check is required and bound to the CER app', async () => {
  for (const claims of [{ appId: 'another-app' }, null]) {
    const h = harness({ appCheck: { async verifyToken() { if (!claims) throw new Error('bad'); return claims; } } });
    assert.equal((await h.request()).statusCode, 403);
    assert.ok(!h.calls.some(call => call[0] === 'reserve'));
  }
  const h = harness();
  assert.equal((await h.request(undefined, { headers: { 'x-firebase-appcheck': '' } })).statusCode, 403);
});

test('anonymous users cannot start a paid voice session', async () => {
  const h = harness({ auth: { async verifyIdToken() { return { uid: 'anonymous', admin: true, firebase: { sign_in_provider: 'anonymous' } }; } } });
  assert.equal((await h.request()).statusCode, 403);
  assert.ok(!h.calls.some(call => call[0] === 'reserve'));
});

test('only a trusted administrator identity can start or stop live assistance', async () => {
  for (const claims of [
    { email: 'student@example.com', email_verified: true },
    { email: 'employee@example.com', email_verified: true, role: 'admin' },
    { email: ADMIN_EMAILS[0], email_verified: false },
    { email: ADMIN_EMAILS[0] },
    { email_verified: true },
    { email: 'chungzhikai@gmail.com.attacker.example', email_verified: true }
  ]) {
    const h = harness({ auth: { async verifyIdToken() { return { uid: 'some-user', firebase: { sign_in_provider: 'google.com' }, ...claims }; } } });
    for (const body of [undefined, { action: 'stop', sessionId: 'live-opaque-1' }]) {
      const response = await h.request(body);
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.error.code, 'admin_required');
    }
    assert.ok(!h.calls.some(call => ['reserve', 'find', 'create', 'close'].includes(call[0])));
  }
});

test('both verified CER admins and trusted admin claims work without a saved worksheet', async () => {
  for (const identity of [
    ...ADMIN_EMAILS.map(email => ({ email, email_verified: true })),
    { email: ADMIN_EMAILS[1].toUpperCase(), email_verified: true },
    { admin: true, email: 'trusted-admin@example.com' }
  ]) {
    const h = harness({ auth: { async verifyIdToken() { return { uid: 'admin', firebase: { sign_in_provider: 'password' }, ...identity }; } } });
    assert.equal((await h.request({ action: 'start', sdp: offer })).statusCode, 200);
  }
});

test('browser-provided role, owner or admin fields never grant authorization', async () => {
  const h = harness({ auth: { async verifyIdToken() { return { uid: 'student', email: 'student@example.com', email_verified: true, firebase: { sign_in_provider: 'password' } }; } } });
  assert.equal((await h.request({ action: 'start', sdp: offer, role: 'admin', admin: true, uid: 'real-admin', email: ADMIN_EMAILS[0] })).statusCode, 403);
  assert.ok(!h.calls.some(call => ['reserve', 'create'].includes(call[0])));
});

test('validates method, content type, session paths and SDP size before authorization', async () => {
  const h = harness();
  assert.equal((await h.request(undefined, { method: 'GET' })).statusCode, 405);
  assert.equal((await h.request(undefined, { headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  for (const body of [null, [], { action: 'start', sdp: 'x'.repeat(64001) }, { action: 'start', sdp: 'v=0\r\nm=video 9' }, { action: 'stop', sessionId: '../other' }]) {
    assert.equal((await h.request(body)).statusCode, 400);
  }
  assert.equal((await h.request(undefined, { rawBody: Buffer.alloc(70000) })).statusCode, 413);
  assert.deepEqual(h.calls, []);
});

test('ownership and quota errors prevent provider creation and return useful safe messages', async () => {
  for (const status of [403, 409, 429]) {
    const h = harness({ repository: { async reserve() { throw new LiveError(status, 'blocked', 'Cannot start this lesson.'); } } });
    assert.equal((await h.request()).statusCode, status);
    assert.ok(!h.calls.some(call => call[0] === 'create'));
  }
});

test('upstream failure is sanitized and frees the reserved slot', async () => {
  const h = harness({ provider: { async create() { throw new Error('sk-sensitive upstream response'); } } });
  const result = await h.request();
  assert.equal(result.statusCode, 503);
  assert.ok(!JSON.stringify(result).includes('sk-sensitive'));
  assert.ok(h.calls.some(call => call[0] === 'release'));
  assert.ok(!h.calls.some(call => call[0] === 'activate'));
});

test('database activation failure closes the created call and retains ID for recovery', async () => {
  const h = harness({ repository: { async activate() { throw new Error('database unavailable'); } } });
  assert.equal((await h.request()).statusCode, 503);
  const recover = h.calls.find(call => call[0] === 'recover');
  assert.equal(recover[1].sessionId, 'live-opaque-1');
  assert.deepEqual(h.calls.slice(-3).map(call => call[0]), ['close', 'release', 'report']);
});

test('malformed provider responses keep a known paid session recoverable when close fails', async () => {
  const h = harness({ provider: {
    async create() { const error = new Error('bad SDP answer'); error.sessionId = 'known-created-call'; throw error; },
    async close() { throw new Error('network down'); }
  } });
  assert.equal((await h.request()).statusCode, 503);
  assert.equal(h.calls.find(call => call[0] === 'recover')[1].sessionId, 'known-created-call');
  assert.ok(!h.calls.some(call => call[0] === 'release'));
});

test('disconnecting during creation closes the paid session instead of leaving it running', async () => {
  let response;
  const h = harness({ provider: { async create() { response.destroyed = true; return { sessionId: 'created-after-disconnect', sdp: offer }; } } });
  await h.request(undefined, { observeResponse: res => { response = res; } });
  assert.equal(response.body, undefined);
  assert.equal(h.calls.find(call => call[0] === 'recover')[1].sessionId, 'created-after-disconnect');
  assert.deepEqual(h.calls.filter(call => ['close', 'release'].includes(call[0])).map(call => call[0]), ['close', 'release']);
});

test('stop only closes a session returned by ownership lookup and is idempotent otherwise', async () => {
  const h = harness();
  assert.equal((await h.request({ action: 'stop', sessionId: 'live-opaque-1' })).statusCode, 200);
  assert.deepEqual(h.calls.slice(-3).map(call => call[0]), ['find', 'close', 'release']);
  assert.deepEqual(h.calls.find(call => call[0] === 'find'), ['find', 'child', 'live-opaque-1']);
  const stranger = harness({ repository: { async find() { return null; } } });
  assert.equal((await stranger.request({ action: 'stop', sessionId: 'someone-elses-call' })).statusCode, 200);
  assert.ok(!stranger.calls.some(call => call[0] === 'close'));
});

test('failed stop retains the lease so the server sweeper can retry', async () => {
  const h = harness({ provider: { async close() { throw new Error('network failure'); } } });
  assert.equal((await h.request({ action: 'stop', sessionId: 'live-opaque-1' })).statusCode, 503);
  assert.ok(!h.calls.some(call => call[0] === 'release'));
});

test('server cleanup closes expired calls even without the browser and leaves failures for retry', async () => {
  const h = harness({ repository: { async expired() { return [{ id: 'a', sessionId: 'expired-a' }, { id: 'b', sessionId: 'failed-b' }, { id: 'c', sessionId: null }]; } }, provider: { async close(id) { if (id === 'failed-b') throw new Error('offline'); } } });
  await assert.rejects(h.service.sweep(), /could not be closed/);
  assert.deepEqual(h.calls.filter(call => call[0] === 'release').map(call => call[1].id).sort(), ['a', 'c']);
});

test('daily allowance and session duration are bounded server constants', () => {
  assert.equal(LIMITS.durationSeconds, 600);
  assert.equal(LIMITS.startsPerDay, 6);
  assert.equal(LIMITS.concurrent, 2);
  assert.equal(LIMITS.globalStartsPerDay, 12);
});
