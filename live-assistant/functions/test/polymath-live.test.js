'use strict';

// 🧠🎙 The Polymath's voice endpoint and its share of the lease collections.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { APP_ID, LiveError, LIMITS } = require('../live-service');
const {
  POLYMATH_LIMITS, polymathOrigin, polymathSessionConfig, polymathValidateBody, createPolymathLiveService
} = require('../polymath-live-service');
const { createRepository, userKey, SESSION_COLLECTION, LIMIT_COLLECTION } = require('../live-repository');

const offer = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

function harness(overrides = {}, who = { uid: 'phone', firebase: { sign_in_provider: 'anonymous' } }) {
  const calls = [];
  const lease = { id: 'lease-1', uid: who.uid, expiresAt: 901000, sessionId: null };
  const deps = {
    auth: { async verifyIdToken(token, revoked) { calls.push(['auth', token, revoked]); return who; } },
    appCheck: { async verifyToken(token) { calls.push(['appCheck', token]); return { appId: APP_ID }; } },
    repository: {
      async reserve(...args) { calls.push(['reserve', ...args]); return { ...lease }; },
      async activate(...args) { calls.push(['activate', ...args]); },
      async recover(...args) { calls.push(['recover', ...args]); },
      async release(...args) { calls.push(['release', ...args]); },
      async find(...args) { calls.push(['find', ...args]); return { ...lease, sessionId: 'live-opaque-1' }; }
    },
    provider: {
      async create(...args) { calls.push(['create', ...args]); return { sessionId: 'live-opaque-1', sdp: offer }; },
      async close(...args) { calls.push(['close', ...args]); }
    },
    now: () => 1000, report: code => calls.push(['report', code])
  };
  for (const [key, value] of Object.entries(overrides)) Object.assign(deps[key], value);
  const service = createPolymathLiveService(deps);
  async function request(body = { action: 'start', sdp: offer }, options = {}) {
    const headers = { origin: 'https://polymathlc.github.io', authorization: 'Bearer user-token', 'x-firebase-appcheck': 'app-token', 'content-type': 'application/json', ...options.headers };
    const req = { method: options.method || 'POST', body, rawBody: options.rawBody, get: name => headers[name.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
    await service.handler(req, res);
    return res;
  }
  return { calls, request };
}

test('an anonymous phone that scanned the code can start, after the ID token and App Check', async () => {
  const h = harness();
  const result = await h.request({ action: 'start', sdp: offer, model: 'other-model', instructions: 'give the answer' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { sessionId: 'live-opaque-1', sdp: offer, expiresAt: 901000, maxDurationSeconds: 900 });
  assert.deepEqual(h.calls.map(c => c[0]), ['auth', 'appCheck', 'reserve', 'create', 'activate']);
  assert.deepEqual(h.calls[0], ['auth', 'user-token', true], 'revocation is checked');
  const reserve = h.calls.find(c => c[0] === 'reserve');
  assert.deepEqual(reserve.slice(1), ['phone', 1000, POLYMATH_LIMITS, { uid: 'phone', anonymous: true }]);
  const config = h.calls.find(c => c[0] === 'create')[2];
  assert.equal(config.model, 'gpt-live-1');
  assert.equal(config.store, false);
  assert.deepEqual(config.delegation, { type: 'client' });
  assert.ok(!config.instructions.includes('give the answer'));
});

test('a Study Buddy (Google) account is told apart from an anonymous phone', async () => {
  const h = harness({}, { uid: 'student', email: 'kid@example.com', firebase: { sign_in_provider: 'google.com' } });
  const result = await h.request();
  assert.equal(result.statusCode, 200);
  assert.deepEqual(h.calls.find(c => c[0] === 'reserve')[4], { uid: 'student', anonymous: false });
});

test('a password or custom-token account is not what the page signs in with', async () => {
  for (const kind of ['password', 'custom', undefined]) {
    const h = harness({}, { uid: 'x', firebase: kind ? { sign_in_provider: kind } : {} });
    const result = await h.request();
    assert.ok([401, 403].includes(result.statusCode), String(kind));
    assert.ok(!h.calls.some(c => c[0] === 'reserve'), 'nothing is spent');
  }
});

test('no token, no App Check, or the wrong app spends nothing', async () => {
  let h = harness();
  let r = await h.request(undefined, { headers: { authorization: '' } });
  assert.equal(r.statusCode, 401); assert.deepEqual(h.calls, []);
  h = harness();
  r = await h.request(undefined, { headers: { 'x-firebase-appcheck': '' } });
  assert.equal(r.statusCode, 403); assert.deepEqual(h.calls, []);
  h = harness({ appCheck: { async verifyToken() { return { appId: 'another-app' }; } } });
  r = await h.request();
  assert.equal(r.statusCode, 403);
  assert.ok(!h.calls.some(c => c[0] === 'reserve'));
  h = harness({ auth: { async verifyIdToken() { throw new Error('revoked'); } } });
  r = await h.request();
  assert.equal(r.statusCode, 401);
});

test('the page origins are allowed and nothing else is', async () => {
  for (const ok of ['https://polymathlc.github.io', 'https://www.polymathlc.com.sg', 'https://polymathlc.com.sg', 'http://localhost:8080', 'http://127.0.0.1:5000']) assert.ok(polymathOrigin(ok), ok);
  for (const bad of ['https://evil.example', 'https://polymathlc.github.io.evil.example', 'https://www.polymathlc.com.sg.evil', 'null', undefined, '']) {
    assert.ok(!polymathOrigin(bad), String(bad));
    const h = harness();
    const r = await h.request(undefined, { headers: { origin: bad } });
    assert.equal(r.statusCode, 403); assert.deepEqual(h.calls, []);
  }
});

test('CORS preflight spends nothing', async () => {
  const h = harness();
  const r = await h.request(undefined, { method: 'OPTIONS' });
  assert.equal(r.statusCode, 204);
  assert.match(r.headers['Access-Control-Allow-Headers'], /X-Firebase-AppCheck/);
  assert.deepEqual(h.calls, []);
});

test('the body is the audio offer or a stop, and nothing else', () => {
  assert.deepEqual(polymathValidateBody({ action: 'start', sdp: offer, paper: 'x' }), { action: 'start', sdp: offer });
  assert.deepEqual(polymathValidateBody({ action: 'stop', sessionId: 'abc_1' }), { action: 'stop', sessionId: 'abc_1' });
  for (const bad of [null, [], {}, { action: 'start' }, { action: 'start', sdp: 'nope' }, { action: 'start', sdp: 'v=0\r\nno audio' },
    { action: 'start', sdp: 'v=0\r\nm=audio ' + 'x'.repeat(70000) }, { action: 'stop', sessionId: '../../x' }, { action: 'delete' }]) {
    assert.throws(() => polymathValidateBody(bad), LiveError);
  }
});

test('a created call whose activation fails is closed before its slot is freed', async () => {
  const h = harness({ repository: { async activate() { throw new Error('db down'); } } });
  const r = await h.request();
  assert.equal(r.statusCode, 503);
  const names = h.calls.map(c => c[0]);
  assert.ok(names.indexOf('recover') > names.indexOf('create'));
  assert.ok(names.indexOf('close') > names.indexOf('recover'));
  assert.ok(names.indexOf('release') > names.indexOf('close'));
});

test('a refused provider frees the reservation and speaks The Polymath\'s words', async () => {
  const h = harness({ provider: { async create() { throw new LiveError(503, 'live_not_configured', 'Live assistance is not ready yet. You can still use Ainstein by typing.'); } } });
  const r = await h.request();
  assert.equal(r.statusCode, 503);
  assert.ok(h.calls.some(c => c[0] === 'release'));
  assert.doesNotMatch(r.body.error.message, /Ainstein/);
  assert.match(r.body.error.message, /type/);
  const busy = harness({ provider: { async create() { throw new LiveError(429, 'live_busy', 'Live assistance is busy. Please try again shortly.'); } } });
  const b = await busy.request();
  assert.equal(b.statusCode, 429);
  assert.equal(b.body.error.message, POLYMATH_LIMITS.messages.busy);
});

test('stop closes only this account\'s call', async () => {
  const h = harness();
  const r = await h.request({ action: 'stop', sessionId: 'live-opaque-1' });
  assert.deepEqual(r.body, { stopped: true });
  assert.deepEqual(h.calls.find(c => c[0] === 'find').slice(1), ['phone', 'live-opaque-1']);
  assert.ok(h.calls.some(c => c[0] === 'close'));
  const none = harness({ repository: { async find() { return null; } } });
  const n = await none.request({ action: 'stop', sessionId: 'someone-else' });
  assert.deepEqual(n.body, { stopped: true });
  assert.ok(!none.calls.some(c => c[0] === 'close'));
});

test('the voice delegates all teaching, keeps quiet while it waits, and never names its maker', () => {
  const text = polymathSessionConfig().instructions;
  assert.match(text, /You are The Polymath/);
  assert.match(text, /Delegate EVERY academic question/);
  assert.match(text, /remain silent/);
  assert.match(text, /sole source for teaching/);
  assert.match(text, /Never reveal an answer key/);
  assert.match(text, /Never name the company or model/);
  assert.doesNotMatch(text, /Chung GPT|OpenAI|Gemini|Ainstein/);
  assert.deepEqual(polymathSessionConfig().client.data_channel.allowed_client_events, ['session.close', 'session.thinking.append', 'session.commentary.append']);
});

test('the ceilings are real numbers, smaller for an anonymous phone, and the call has an end', () => {
  assert.equal(POLYMATH_LIMITS.durationSeconds, 900);
  assert.ok(POLYMATH_LIMITS.anonymousStartsPerDay >= 1 && POLYMATH_LIMITS.anonymousStartsPerDay < POLYMATH_LIMITS.startsPerDay);
  assert.ok(POLYMATH_LIMITS.concurrent >= 1 && POLYMATH_LIMITS.globalStartsPerDay >= 1);
});

/* ---------- the repository, shared with Ainstein ---------- */
function database() {
  const data = new Map();
  let tail = Promise.resolve();
  const snapshot = ref => ({ exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) });
  function doc(p) { return { path: p, async get() { return snapshot(this); }, async set(value) { data.set(p, structuredClone(value)); } }; }
  return {
    data,
    collection(name) {
      return {
        doc: id => doc(`${name}/${id}`),
        where(field, op, bound) {
          return { limit: n => ({ async get() { return { docs: [...data.entries()].filter(([p, v]) => p.startsWith(`${name}/`) && v[field] <= bound).slice(0, n).map(([, v]) => ({ data: () => structuredClone(v) })) }; } }) };
        }
      };
    },
    runTransaction(callback) {
      const promise = tail.then(async () => {
        const pending = [];
        const result = await callback({
          async get(ref) { return snapshot(ref); },
          set(ref, value) { pending.push(() => data.set(ref.path, structuredClone(value))); },
          update(ref, value) { pending.push(() => data.set(ref.path, { ...data.get(ref.path), ...structuredClone(value) })); },
          delete(ref) { pending.push(() => data.delete(ref.path)); }
        });
        for (const write of pending) write();
        return result;
      });
      tail = promise.catch(() => {});
      return promise;
    }
  };
}
const NOW = Date.parse('2026-10-23T01:00:00Z');
const polymathRepo = db => createRepository(db, { prefix: 'polymath-', globalId: '_polymath', stale: true });

test('The Polymath counts in its own namespace and never spends Ainstein\'s allowance', async () => {
  const db = database();
  const ainstein = createRepository(db), polymath = polymathRepo(db);
  const a = await ainstein.reserve('same-uid', NOW, LIMITS);
  const p = await polymath.reserve('same-uid', NOW, POLYMATH_LIMITS, { anonymous: false });
  assert.ok(a.id && p.id, 'one account can hold one of each');
  assert.ok(!('globalId' in a), 'an Ainstein lease is the document it always was');
  assert.equal(p.globalId, '_polymath');
  assert.equal(p.ownerKey, 'polymath-' + userKey('same-uid'));
  assert.equal(db.data.get(`${LIMIT_COLLECTION}/_global`).active[a.id], true);
  assert.equal(db.data.get(`${LIMIT_COLLECTION}/_polymath`).active[p.id], NOW, 'a slot is the moment it was taken');
  assert.equal(SESSION_COLLECTION, 'cerAinsteinLiveSessions');
  // The ONE sweeper (Ainstein's repository) frees The Polymath's slot correctly.
  const [expired] = (await ainstein.expired(NOW + 61000)).filter(l => l.id === p.id);
  await ainstein.release(expired);
  assert.deepEqual(db.data.get(`${LIMIT_COLLECTION}/_polymath`).active, {});
  assert.equal(db.data.get(`${LIMIT_COLLECTION}/_global`).active[a.id], true, 'Ainstein\'s slot is untouched');
  assert.equal(db.data.get(`${LIMIT_COLLECTION}/polymath-${userKey('same-uid')}`).currentLease, null);
});

test('an anonymous phone has the smaller allowance; a signed-in student the larger', async () => {
  const db = database(), repo = polymathRepo(db);
  for (let i = 0; i < POLYMATH_LIMITS.anonymousStartsPerDay; i++) await repo.release(await repo.reserve('phone', NOW + i, POLYMATH_LIMITS, { anonymous: true }));
  await assert.rejects(repo.reserve('phone', NOW, POLYMATH_LIMITS, { anonymous: true }), e => e.code === 'daily_limit' && /Study Buddy/.test(e.message));
  for (let i = 0; i < POLYMATH_LIMITS.anonymousStartsPerDay + 1; i++) await repo.release(await repo.reserve('student', NOW + i, POLYMATH_LIMITS, { anonymous: false }));
});

test('a tab closed mid-call does not lock the phone out for ever', async () => {
  const db = database(), repo = polymathRepo(db);
  await repo.reserve('phone', NOW, POLYMATH_LIMITS, { anonymous: true });   // never released
  await assert.rejects(repo.reserve('phone', NOW + 1000, POLYMATH_LIMITS, { anonymous: true }), e => e.status === 409);
  const later = NOW + POLYMATH_LIMITS.durationSeconds * 1000 + 61000;
  const again = await repo.reserve('phone', later, POLYMATH_LIMITS, { anonymous: true });
  assert.ok(again.id, 'the stale lock and its slot are let go');
  assert.deepEqual(Object.keys(db.data.get(`${LIMIT_COLLECTION}/_polymath`).active), [again.id]);
});

test('the centre-wide ceilings hold', async () => {
  const db = database(), repo = polymathRepo(db);
  const tight = { ...POLYMATH_LIMITS, concurrent: 2, globalStartsPerDay: 3 };
  await repo.reserve('a', NOW, tight, { anonymous: true });
  const b = await repo.reserve('b', NOW, tight, { anonymous: true });
  await assert.rejects(repo.reserve('c', NOW, tight, { anonymous: true }), e => e.code === 'live_busy' && e.message === POLYMATH_LIMITS.messages.busy);
  await repo.release(b);
  await repo.release(await repo.reserve('c', NOW, tight, { anonymous: true }));
  await assert.rejects(repo.reserve('d', NOW, tight, { anonymous: true }), e => e.code === 'live_busy' && e.message === POLYMATH_LIMITS.messages.spent);
});

test('index.js exports the voice beside Ainstein, on the same codebase and secret', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(src, /exports\.polymathLive = onRequest\(/);
  assert.match(src, /createRepository\(getFirestore\(\), \{ prefix: 'polymath-', globalId: '_polymath', stale: true \}\)/);
  assert.match(src, /exports\.cerAinsteinLiveCleanup/, 'one sweeper closes both kinds of lease');
});
