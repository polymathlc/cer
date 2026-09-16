import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../ainstein-live.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const { awaitAinsteinVoice } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('slow answering helpers release cancellation without a late result', async () => {
  const controller = new AbortController(), wait = deferred();
  const answer = awaitAinsteinVoice(() => wait.promise, controller.signal);
  controller.abort();
  await assert.rejects(answer, { name: 'AbortError' });
  wait.resolve('obsolete answer');
});
test('answering helper deadline releases a stalled provider', async () => {
  await assert.rejects(awaitAinsteinVoice(() => new Promise(() => {}), undefined, 10), { name: 'TimeoutError' });
});
test('cancelled helpers never start, and completed answers retain their values', async () => {
  const controller = new AbortController(); controller.abort(); let called = false;
  await assert.rejects(awaitAinsteinVoice(() => { called = true; }, controller.signal), { name: 'AbortError' });
  assert.equal(called, false);
  assert.equal(await awaitAinsteinVoice(() => 'grounded answer'), 'grounded answer');
});
const start = source.indexOf('var AinsteinLiveBridge = (function () {');
const endMarker = 'return { connect: connect };\n})();';
const end = source.indexOf(endMarker, start);
assert.ok(start >= 0 && end > start, 'The shipped page includes the live bridge.');
const bridge = source.slice(start, end + endMarker.length);
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(overrides = {}) {
  const calls = [], peers = [], timers = new Map(), statuses = [], transcripts = [], remote = [];
  let timerId = 0;
  const track = { readyState: 'live', enabled: true, stopped: 0, stop() { this.stopped++; } };
  const stream = { getAudioTracks: () => [track] };
  const answer = { sessionId: 'live-recording-1', sdp: 'v=0\r\nm=audio 9\r\n', expiresAt: Date.now() + 600000 };
  class Peer {
    constructor() { this.iceGatheringState = overrides.pendingIce ? 'gathering' : 'complete'; this.connectionState = 'new'; this.listeners = new Map(); this.senders = []; peers.push(this); }
    addTrack(value, valueStream) { calls.push(['addTrack', value, valueStream]); this.senders.push({ replaceTrack: async value => calls.push(['replaceTrack', value]) }); }
    getSenders() { return this.senders; }
    createDataChannel(label) {
      this.channel = { label, readyState: 'connecting', messages: [],
        send: raw => this.channel.messages.push(JSON.parse(raw)), close: () => { this.channel.readyState = 'closed'; calls.push(['channel.close']); } };
      return this.channel;
    }
    async createOffer() { calls.push(['offer']); return overrides.offer ? await overrides.offer.promise : { type: 'offer', sdp: answer.sdp }; }
    async setLocalDescription(value) { calls.push(['localDescription']); if (overrides.local) await overrides.local.promise; this.localDescription = value; }
    async setRemoteDescription(value) { calls.push(['remoteDescription', value]); if (overrides.remote) await overrides.remote.promise; this.channel.readyState = 'open'; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
    close() { this.connectionState = 'closed'; calls.push(['peer.close']); }
  }
  const context = vm.createContext({ AbortController, Date, Set, Map, Promise, Error, Number, String, JSON,
    RTCPeerConnection: Peer, MediaStream: class { constructor(tracks) { this.tracks = tracks; } },
    setTimeout(callback, ms) { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(['fetch', body, opts, url]);
      if (body.action === 'start') { if (overrides.start) await overrides.start.promise; return { ok: !overrides.startStatus, status: overrides.startStatus, json: async () => overrides.answer || answer }; }
      if (overrides.stop) await overrides.stop.promise;
      return { ok: true, json: async () => ({ stopped: true }) };
    }
  });
  vm.runInContext(bridge, context);
  const controller = new AbortController();
  const opts = { stream, signal: controller.signal,
    user: { getIdToken: () => overrides.auth ? overrides.auth.promise : Promise.resolve('teacher-id-token') },
    appCheckToken: () => Promise.resolve('app-check-token'),
    onStatus: (message, phase) => statuses.push({ message, phase }),
    onTranscript: row => transcripts.push(row), onRemoteStream: value => remote.push(value),
    delegate: overrides.delegate || (async () => 'Use the grounded worksheet result.') };
  function emit(event) { peers[0].channel.onmessage?.({ data: typeof event === 'string' ? event : JSON.stringify(event) }); }
  function fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.callback(); } }
  function begin(extra = {}) { const result = context.AinsteinLiveBridge.connect({ ...opts, ...extra }); result.catch(() => {}); return result; }
  async function live(extra = {}) { const result = begin(extra); await tick(); emit({ type: 'session.started' }); const session = await result; return session; }
  return { calls, peers, timers, statuses, transcripts, remote, track, stream, opts, controller, begin, live, emit, fire, answer };
}

test('uses the protected CER endpoint and waits for session.started before becoming ready', async () => {
  const h = harness(); let resolved = false;
  const waiting = h.begin().then(value => { resolved = true; return value; }); await tick();
  assert.equal(h.peers[0].channel.label, 'oai-events'); assert.equal(h.peers[0].channel.readyState, 'open'); assert.equal(resolved, false);
  const call = h.calls.find(row => row[0] === 'fetch');
  assert.equal(call[3], 'https://us-central1-mathgen--app.cloudfunctions.net/cerAinsteinLive');
  assert.equal(call[2].headers.Authorization, 'Bearer teacher-id-token');
  assert.equal(call[2].headers['X-Firebase-AppCheck'], 'app-check-token');
  assert.deepEqual(call[1], { action: 'start', sdp: h.answer.sdp });
  h.emit({ type: 'session.started' }); const session = await waiting;
  assert.equal(session.closed, false); await session.close(); assert.equal(session.closed, true);
  assert.equal(h.track.stopped, 0); assert.equal(h.track.enabled, true);
  assert.ok(h.calls.some(row => row[0] === 'replaceTrack' && row[1] === null));
});

test('remote assistant audio is handed to the recorder without creating an audio player', async () => {
  const h = harness(), session = await h.live(), stream = { remote: true };
  h.peers[0].ontrack({ streams: [stream] }); assert.equal(h.remote[0], stream);
  h.peers[0].ontrack({ streams: [], track: { audio: true } }); assert.equal(h.remote[1].tracks.length, 1);
  await session.close(); assert.equal(h.peers[0].ontrack, null);
});

test('cancellation while authentication is pending rejects immediately and never starts a paid call', async () => {
  const auth = deferred(), h = harness({ auth }), waiting = h.begin();
  h.controller.abort(); await assert.rejects(waiting, error => error.name === 'AbortError');
  auth.resolve('teacher-id-token'); await tick();
  assert.equal(h.peers.length, 0); assert.equal(h.calls.filter(row => row[0] === 'fetch').length, 0); assert.equal(h.track.stopped, 0);
});

test('an already-aborted request cannot acquire a session', async () => {
  const h = harness(); h.controller.abort();
  await assert.rejects(h.begin(), error => error.name === 'AbortError');
  assert.equal(h.peers.length, 0); assert.equal(h.timers.size, 0);
});

for (const phase of ['offer', 'local']) test(`cancellation while ${phase} negotiation is pending prevents creation`, async () => {
  const wait = deferred(), h = harness({ [phase]: wait }), waiting = h.begin(); await tick();
  h.controller.abort(); await assert.rejects(waiting, error => error.name === 'AbortError');
  wait.resolve({ type: 'offer', sdp: h.answer.sdp }); await tick();
  assert.equal(h.calls.filter(row => row[0] === 'fetch').length, 0); assert.equal(h.track.stopped, 0);
});

test('cancellation clears pending ICE listeners and never starts a paid session', async () => {
  const h = harness({ pendingIce: true }), waiting = h.begin(); await tick();
  assert.equal(h.peers[0].listeners.size, 1); h.controller.abort();
  await assert.rejects(waiting, error => error.name === 'AbortError'); await tick();
  assert.equal(h.peers[0].listeners.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.calls.filter(row => row[0] === 'fetch').length, 0);
});

test('a paid session created after cancellation is closed by its returned ID', async () => {
  const start = deferred(), h = harness({ start }), waiting = h.begin(); await tick();
  h.controller.abort(); await assert.rejects(waiting, error => error.name === 'AbortError');
  const creating = h.calls.find(row => row[0] === 'fetch'); assert.equal(creating[2].signal.aborted, false);
  start.resolve(); await tick();
  const stops = h.calls.filter(row => row[0] === 'fetch' && row[1].action === 'stop');
  assert.equal(stops.length, 1); assert.equal(stops[0][1].sessionId, 'live-recording-1');
  assert.equal(h.calls.some(row => row[0] === 'remoteDescription'), false); assert.equal(h.track.stopped, 0);
});

test('malformed remote SDP still closes a known paid session', async () => {
  const h = harness({ answer: { sessionId: 'known-call', sdp: 'broken' } });
  await assert.rejects(h.begin(), /incomplete audio connection/); await tick();
  assert.ok(h.calls.some(row => row[0] === 'fetch' && row[1].action === 'stop' && row[1].sessionId === 'known-call'));
});

test('cancellation during remote-description installation closes the paid call without becoming ready', async () => {
  const remote = deferred(), h = harness({ remote }), waiting = h.begin(); await tick();
  assert.ok(h.calls.some(row => row[0] === 'remoteDescription')); h.controller.abort();
  await assert.rejects(waiting, error => error.name === 'AbortError'); remote.resolve(); await tick();
  assert.ok(h.calls.some(row => row[0] === 'fetch' && row[1].action === 'stop'));
  assert.ok(!h.statuses.some(row => row.phase === 'live')); assert.equal(h.track.stopped, 0);
});

test('closing waits for the provider terminal event or the three-second bound without stopping the shared mic', async () => {
  const stop = deferred(), h = harness({ stop }), session = await h.live(); let closed = false;
  const closing = session.close().then(() => { closed = true; }); await tick(); assert.equal(closed, false);
  assert.deepEqual(h.peers[0].channel.messages.at(-1), { type: 'session.close' }); assert.equal(h.track.stopped, 0);
  h.fire(3000); await closing; assert.equal(h.peers[0].connectionState, 'closed');
  stop.resolve(); await tick(); assert.equal(h.timers.size, 0);
});

test('session.closed confirms closure early and public close is idempotent', async () => {
  const stop = deferred(), h = harness({ stop }), session = await h.live();
  const closing = session.close(); assert.equal(session.close(), closing);
  h.emit({ type: 'session.closed' }); await closing; stop.resolve(); await tick();
  assert.equal(h.calls.filter(row => row[0] === 'peer.close').length, 1);
  assert.equal(h.calls.filter(row => row[0] === 'fetch' && row[1].action === 'stop').length, 1);
});

test('only the provider delta is consumed and transcripts are sorted and bounded for delegation', async () => {
  const requests = [], h = harness({ delegate: async request => { requests.push(request); return 'Grounded help.'; } }), session = await h.live();
  h.emit('invalid JSON'); h.emit(null); h.emit({ type: 'session.input_transcript.delta', text: 'wrong field' });
  assert.equal(h.transcripts.length, 0);
  h.emit({ type: 'session.input_transcript.delta', delta: 'second', start_ms: 20 });
  h.emit({ type: 'session.input_transcript.delta', delta: 'first ', start_ms: 10 });
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'q1' } }); await tick();
  assert.equal(requests[0].transcript[0].text, 'first second');
  for (let i = 0; i < 30; i++) h.emit({ type: 'session.input_transcript.delta', delta: 'x'.repeat(5000), start_ms: i + 100 });
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'q2' } }); await tick();
  assert.ok(requests[1].transcript.reduce((n, row) => n + row.text.length, 0) <= 24000);
  assert.equal(h.transcripts.at(-1).delta.length, 4000); await session.close();
});

test('delegations coalesce to the newest question and stale answers are never spoken', async () => {
  const first = deferred(), requests = [];
  const h = harness({ delegate: request => { requests.push(request); return requests.length === 1 ? first.promise : 'Latest grounded answer.'; } }), session = await h.live();
  for (const id of ['q1', 'q1', 'q2', 'q3']) h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id } });
  assert.equal(requests.length, 1); first.resolve('Obsolete answer.'); await tick();
  assert.deepEqual(requests.map(row => row.id), ['q1', 'q3']);
  const speech = h.peers[0].channel.messages.filter(row => row.type === 'session.commentary.append');
  assert.equal(speech.length, 1); assert.equal(speech[0].delegation_id, 'q3'); assert.equal(speech[0].content, 'Latest grounded answer.');
  assert.ok(h.peers[0].channel.messages.some(row => row.type === 'session.thinking.append' && row.delegation_id === 'q2'));
  await session.close();
});

test('aborting a live call cancels delegation and discards a late teaching result', async () => {
  const reply = deferred(), requests = [], h = harness({ delegate: request => { requests.push(request); return reply.promise; } }), session = await h.live();
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'q1' } });
  h.controller.abort(); assert.equal(requests[0].signal.aborted, true); await session.close();
  reply.resolve('Late answer'); await tick();
  assert.equal(h.peers[0].channel.messages.filter(row => row.type === 'session.commentary.append').length, 0);
});

test('a delegated question shows Thinking without sending spoken progress while its answer is pending', async () => {
  const reply = deferred(), h = harness({ delegate: () => reply.promise }), session = await h.live();
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'q1' } });
  assert.equal(h.statuses.at(-1).message, 'Thinking…');
  assert.equal(h.peers[0].channel.messages.filter(row => row.type === 'session.commentary.append').length, 0);
  reply.resolve('The spring exerts the greatest force.'); await tick();
  const spoken = h.peers[0].channel.messages.filter(row => row.type === 'session.commentary.append');
  assert.equal(spoken.length, 1); assert.equal(spoken[0].content, 'The spring exerts the greatest force.');
  assert.match(h.statuses.at(-1).message, /Listening/);
  await session.close();
});

test('app context is quiet, refreshed before a question, deduplicated and stopped on close', async () => {
  const h = harness(); let context = 'Page 1: current typed answer is Spring X.';
  const session = await h.live({ getContext: () => context });
  const quiet = () => h.peers[0].channel.messages.filter(row => row.type === 'session.thinking.append' && row.delegation_id === null);
  assert.equal(quiet().length, 1); assert.equal(quiet()[0].content, context);
  h.fire(1000); assert.equal(quiet().length, 1);
  context = 'Page 2: the current typed answer is Spring Z.';
  h.fire(1000); assert.equal(quiet().length, 2); assert.equal(quiet()[1].content, context);
  context = 'The answer has just been edited to Spring Y.';
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'q1' } });
  assert.equal(quiet().length, 3); assert.equal(quiet()[2].content, context);
  await tick(); await session.close();
  context = 'Closed'; h.fire(1000); assert.equal(quiet().length, 3); assert.equal(h.timers.size, 0);
});

test('initial connection timeout rejects and closes an unstarted session', async () => {
  const h = harness(), waiting = h.begin(); await tick(); h.fire(60000);
  await assert.rejects(waiting, /timed out/); await tick(); assert.equal(h.peers[0].connectionState, 'closed');
});

test('missing App Check fails before making a paid request', async () => {
  const h = harness();
  await assert.rejects(h.begin({ appCheckToken: '' }), /app verification/);
  assert.equal(h.calls.filter(row => row[0] === 'fetch').length, 0);
});

test('server failures stay visible after cleanup and never expose upstream payloads', async () => {
  for (const status of [401, 403, 404, 409, 429, 503]) {
    const h = harness({ startStatus: status, answer: { error: { message: 'sk-private upstream detail' } } });
    await assert.rejects(h.begin(), error => !error.message.includes('private')); await tick();
    assert.equal(h.statuses.at(-1).phase, 'closed');
    assert.notEqual(h.statuses.at(-1).message, 'Live assistance ended.');
    assert.ok(!JSON.stringify(h.statuses).includes('sk-private'));
  }
});

test('different delegation IDs for the same completed user request reuse its result without repeating app actions', async () => {
  const requests = [], h = harness({ delegate: task => { requests.push(task); return 'Saved the prepared worksheet.'; } }), session = await h.live();
  h.emit({ type: 'session.input_transcript.delta', delta: 'Save that worksheet.', start_ms: 100, end_ms: 200 });
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'save-first' } }); await tick();
  h.emit({ type: 'session.output_transcript.delta', delta: 'Saved the prepared worksheet.', start_ms: 250, end_ms: 350 });
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'save-repeat' } }); await tick();
  assert.equal(requests.length, 1, 'the same spoken request must not save twice');
  const speech = h.peers[0].channel.messages.filter(row => row.type === 'session.commentary.append');
  assert.deepEqual(speech.map(row => row.delegation_id), ['save-first', 'save-repeat']);
  assert.ok(speech.every(row => row.content === 'Saved the prepared worksheet.'));
  // A deliberate later repeat is a new utterance, even if its wording matches.
  h.emit({ type: 'session.input_transcript.delta', delta: 'Save that worksheet.', start_ms: 500, end_ms: 600 });
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'save-later' } }); await tick();
  assert.equal(requests.length, 2);
  await session.close();
});

test('a superseding spoken request aborts the old task before awaiting its result', async () => {
  const first = deferred(), requests = [];
  const h = harness({ delegate: task => { requests.push(task); return requests.length === 1 ? first.promise : 'Opened Rapid Add.'; } }), session = await h.live();
  h.emit({ type: 'session.input_transcript.delta', delta: 'Prepare a worksheet.', start_ms: 100 });
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'old-plan' } });
  assert.equal(requests[0].signal.aborted, false);
  h.emit({ type: 'session.input_transcript.delta', delta: 'Actually open Rapid Add instead.', start_ms: 200 });
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'new-plan' } });
  assert.equal(requests[0].signal.aborted, true, 'stale mutations need cancellation before their await resumes');
  first.resolve('Prepared a stale worksheet.'); await tick();
  assert.deepEqual(requests.map(task => task.id), ['old-plan', 'new-plan']);
  assert.deepEqual(h.peers[0].channel.messages.filter(row => row.type === 'session.commentary.append').map(row => row.content), ['Opened Rapid Add.']);
  await session.close();
});

test('duplicate delegation IDs for the same in-flight utterance do not cancel or repeat its app mutation', async () => {
  const reply = deferred(), requests = [];
  const h = harness({ delegate: task => { requests.push(task); return reply.promise; } }), session = await h.live();
  h.emit({ type: 'session.input_transcript.delta', delta: 'Save that worksheet.', start_ms: 100, end_ms: 200 });
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'save-active' } });
  h.emit({ type: 'session.delegation.created', delegation: { target: 'client', id: 'save-alias' } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].signal.aborted, false, 'a duplicate provider event must not interrupt an authorized in-flight save');
  reply.resolve('Saved the prepared worksheet.'); await tick();
  assert.equal(requests.length, 1, 'the settled mutation must not restart for its alias');
  const speech = h.peers[0].channel.messages.filter(row => row.type === 'session.commentary.append');
  assert.ok(speech.length >= 1);
  assert.ok(speech.every(row => row.content === 'Saved the prepared worksheet.'));
  await session.close();
});

test('newer speech cancels pending work before a replacement delegation and discards its late result', async () => {
  const reply = deferred(), requests = [];
  const h = harness({ delegate: task => { requests.push(task); return reply.promise; } }), session = await h.live();
  h.emit({ type: 'session.input_transcript.delta', delta: 'Save that worksheet.', start_ms: 100, end_ms: 300 });
  h.emit({ type: 'session.delegation.created', offset_ms: 400, delegation: { target: 'client', id: 'save-pending' } });
  h.emit({ type: 'session.input_transcript.delta', delta: 'Wait, stop.', start_ms: 500, end_ms: 650 });
  assert.equal(requests[0].signal.aborted, true, 'cancel at the new speech, not at a future delegation');
  reply.resolve('The old request finished late.'); await tick();
  assert.equal(h.peers[0].channel.messages.filter(row => row.type === 'session.commentary.append').length, 0);
  await session.close();
});

test('late transcript fragments from before dispatch and assistant speech leave the original task running', async () => {
  const reply = deferred(), requests = [];
  const h = harness({ delegate: task => { requests.push(task); return reply.promise; } }), session = await h.live();
  h.emit({ type: 'session.input_transcript.delta', delta: 'Prepare a worksheet', start_ms: 100, end_ms: 200 });
  h.emit({ type: 'session.delegation.created', offset_ms: 500, delegation: { target: 'client', id: 'prepare-original' } });
  h.emit({ type: 'session.input_transcript.delta', delta: ' on forces.', start_ms: 250, end_ms: 450 });
  h.emit({ type: 'session.input_transcript.delta', delta: 'correction', start_ms: 100, end_ms: 200 });
  h.emit({ type: 'session.output_transcript.delta', delta: 'Earlier assistant audio.', start_ms: 600, end_ms: 700 });
  assert.equal(requests[0].signal.aborted, false);
  reply.resolve('Prepared the worksheet.'); await tick();
  assert.equal(h.peers[0].channel.messages.filter(row => row.type === 'session.commentary.append').length, 1);
  await session.close();
});

test('a cancelled delegate rejection stays quiet while awaiting the latest user request', async () => {
  const reply = deferred(), requests = [];
  const h = harness({ delegate: task => { requests.push(task); return reply.promise; } }), session = await h.live();
  h.emit({ type: 'session.delegation.created', offset_ms: 100, delegation: { target: 'client', id: 'interrupted' } });
  h.emit({ type: 'session.input_transcript.delta', delta: 'Actually, wait.', start_ms: 200 });
  reply.reject(new DOMException('Cancelled', 'AbortError')); await tick();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(h.peers[0].channel.messages.filter(row => row.type === 'session.commentary.append').length, 0);
  await session.close();
});

test('long multilingual context and verified results use bounded appends without losing content', async () => {
  const context = 'Typed text: ' + '力和弹簧🧑‍🏫 '.repeat(200);
  const result = 'Prepared the worksheet. ' + 'Question type: 中文，force, springs. '.repeat(80);
  const h = harness({ delegate: () => result }), session = await h.live({ getContext: () => context });
  h.emit({ type: 'session.delegation.created', offset_ms: 100, delegation: { target: 'client', id: 'long-result' } }); await tick();
  const messages = h.peers[0].channel.messages;
  const thoughts = messages.filter(row => row.type === 'session.thinking.append' && row.delegation_id === null);
  const speech = messages.filter(row => row.type === 'session.commentary.append');
  assert.ok(thoughts.length > 1 && speech.length > 1);
  assert.equal(thoughts.map(row => row.content).join(''), context);
  assert.equal(speech.map(row => row.content).join(''), result.trim());
  assert.ok([...thoughts, ...speech].every(row => Buffer.byteLength(row.content, 'utf8') <= 480));
  assert.ok(speech.every(row => row.delegation_id === 'long-result'));
  const count = thoughts.length; h.fire(1000);
  assert.equal(messages.filter(row => row.type === 'session.thinking.append' && row.delegation_id === null).length, count);
  await session.close();
});
