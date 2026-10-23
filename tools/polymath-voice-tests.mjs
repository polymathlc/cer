// 🎙 The Polymath, out loud — the live bridge in polymath-voice.js, run in
// Node against a fake RTCPeerConnection and a fake endpoint. No network, no
// microphone, no paid call. Run: node --test tools/polymath-voice-tests.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../polymath-tutor-core.mjs';

const ROOT = new URL('../', import.meta.url);
const SOURCE = readFileSync(new URL('polymath-voice.js', ROOT), 'utf8');
// The module imports the core by a relative, cache-stamped path; a data: URL
// has no base, so the import is pointed at the real file first.
const CORE_URL = new URL('polymath-tutor-core.mjs', ROOT).href;
assert.match(SOURCE, /from '\.\/polymath-tutor-core\.mjs\?v=\d+'/, 'the voice imports the core it ships beside');
const VOICE = await import('data:text/javascript;base64,' + Buffer.from(SOURCE.replace(/'\.\/polymath-tutor-core\.mjs\?v=\d+'/, JSON.stringify(CORE_URL))).toString('base64'));
const { PolymathLiveBridge } = VOICE;

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('timed out waiting for ' + label);
}
function deferred() { let resolve, reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; }

function harness(overrides = {}) {
  const calls = [], peers = [], statuses = [], transcripts = [], remote = [];
  const track = { readyState: 'live', enabled: true, stopped: 0, stop() { this.stopped++; } };
  const stream = { getAudioTracks: () => [track] };
  const answer = { sessionId: 'polymath-call-1', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', expiresAt: Date.now() + 900000, maxDurationSeconds: 900 };
  class Peer {
    constructor() { this.iceGatheringState = 'complete'; this.connectionState = 'new'; this.senders = []; this.listeners = new Map(); peers.push(this); }
    addTrack(t, s) { calls.push(['addTrack', t === track, s === stream]); this.senders.push({ replaceTrack: async v => calls.push(['replaceTrack', v]) }); }
    getSenders() { return this.senders; }
    createDataChannel(label) {
      this.channel = { label, readyState: 'connecting', messages: [],
        send: raw => this.channel.messages.push(JSON.parse(raw)),
        close: () => { this.channel.readyState = 'closed'; calls.push(['channel.close']); } };
      return this.channel;
    }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\nm=audio 9\r\n' }; }
    async setLocalDescription(v) { this.localDescription = v; }
    async setRemoteDescription(v) {
      calls.push(['remote', v.sdp]);
      this.channel.readyState = 'open';
      if (this.ontrack) this.ontrack({ streams: [{ id: 'remote-audio' }] });
    }
    addEventListener(n, f) { this.listeners.set(n, f); }
    removeEventListener(n, f) { if (this.listeners.get(n) === f) this.listeners.delete(n); }
    close() { this.connectionState = 'closed'; calls.push(['peer.close']); }
    emit(event) { this.channel.onmessage({ data: JSON.stringify(event) }); }
  }
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(['fetch', url, body, opts.headers, !!opts.keepalive]);
    if (body.action === 'start') {
      if (overrides.start) await overrides.start.promise;
      if (overrides.status) return { ok: false, status: overrides.status, json: async () => overrides.error || {} };
      return { ok: true, status: 200, json: async () => Object.assign({}, answer, overrides.answer || {}) };
    }
    return { ok: true, status: 200, json: async () => ({ stopped: true }) };
  };
  const user = { getIdToken: async () => overrides.idToken === undefined ? 'id-token-1' : overrides.idToken };
  const opts = {
    stream, user, fetch: fetchImpl, RTCPeerConnection: Peer,
    appCheckToken: overrides.appCheck === undefined ? async () => 'app-check-1' : overrides.appCheck,
    getContext: overrides.getContext || (() => 'THE QUESTION ON THE STUDENT\'S SCREEN (Question 1):\nWhich material conducts heat best?'),
    delegate: overrides.delegate || (async task => { calls.push(['delegate', task.transcript]); return 'Steel lets heat through quickly. What else do you notice?'; }),
    onStatus: (message, phase) => statuses.push([phase, message]),
    onTranscript: row => transcripts.push(row),
    onRemoteStream: s => remote.push(s),
    signal: overrides.signal
  };
  return { calls, peers, statuses, transcripts, remote, track, stream, answer, opts, connect: () => PolymathLiveBridge.connect(opts) };
}

async function live(h) {
  const ready = h.connect();
  await until(() => h.peers[0] && h.peers[0].channel && h.peers[0].channel.readyState === 'open', 'the remote answer');
  h.peers[0].emit({ type: 'session.started' });
  return ready;
}

test('a call starts at The Polymath\'s own endpoint, with both tokens and nothing else', async () => {
  const h = harness();
  const session = await live(h);
  const start = h.calls.find(c => c[0] === 'fetch');
  assert.equal(start[1], core.TUTOR_LIVE_ENDPOINT);
  assert.equal(start[1], 'https://us-central1-mathgen--app.cloudfunctions.net/polymathLive');
  assert.deepEqual(Object.keys(start[2]), ['action', 'sdp'], 'only the audio offer is sent — the server decides model and instructions');
  assert.equal(start[2].action, 'start');
  assert.equal(start[3].Authorization, 'Bearer id-token-1');
  assert.equal(start[3]['X-Firebase-AppCheck'], 'app-check-1');
  assert.equal(h.peers[0].channel.label, 'oai-events');
  assert.ok(h.calls.some(c => c[0] === 'addTrack' && c[1] && c[2]), 'the microphone track is sent');
  assert.equal(h.remote.length, 1, 'the reply audio is handed to the page');
  assert.equal(session.maxSeconds, 900);
  assert.ok(h.statuses.some(([p]) => p === 'connecting'));
  assert.deepEqual(h.statuses.at(-1), ['live', 'Listening…']);
  await session.close();
});

test('the screen is told to the voice, once per change, and never the key', async () => {
  let context = 'Q1 context';
  const h = harness({ getContext: () => context });
  const session = await live(h);
  const sent = () => h.peers[0].channel.messages.filter(m => m.type === 'session.thinking.append' && m.delegation_id === null);
  await until(() => sent().length === 1, 'the first context');
  assert.equal(sent()[0].content, 'Q1 context');
  await new Promise(r => setTimeout(r, 1100));
  assert.equal(sent().length, 1, 'an unchanged screen is not re-sent');
  context = 'Q2 context';
  await until(() => sent().length === 2, 'the changed context');
  assert.equal(sent()[1].content, 'Q2 context');
  await session.close();

  const q = core.normalizeTutorPaper({ questions: [{ label: 'Question 1', items: [{ t: 'text', text: 'Which spoon gets hot first?' }, { t: 'write', id: 's1' }], key: [{ text: 'SECRET-KEY: the steel spoon' }] }] }).questions[0];
  const said = core.voiceContext(q, { s1: 'the wooden one' }, { verdict: 'incorrect' });
  assert.match(said, /Which spoon gets hot first\?/);
  assert.match(said, /the wooden one/);
  assert.match(said, /INCORRECT/);
  assert.doesNotMatch(said, /SECRET-KEY/, 'the voice is never handed the key');
});

test('a delegation is answered by the page and spoken back; the crystal sees "thinking"', async () => {
  const h = harness();
  const session = await live(h);
  const peer = h.peers[0];
  peer.emit({ type: 'session.input_transcript.delta', delta: 'Why does the steel spoon get hot?', start_ms: 100, end_ms: 900 });
  peer.emit({ type: 'session.delegation.created', delegation: { id: 'del_1', target: 'client' }, offset_ms: 900 });
  await until(() => peer.channel.messages.some(m => m.type === 'session.commentary.append'), 'the spoken result');
  const result = peer.channel.messages.find(m => m.type === 'session.commentary.append');
  assert.equal(result.delegation_id, 'del_1');
  assert.equal(result.content, 'Steel lets heat through quickly. What else do you notice?');
  const asked = h.calls.find(c => c[0] === 'delegate')[1];
  assert.deepEqual(asked, [{ role: 'user', text: 'Why does the steel spoon get hot?' }], 'the tutor reads what the student said');
  assert.ok(h.statuses.some(([p]) => p === 'thinking'), 'the page is told it is thinking');
  assert.deepEqual(h.statuses.at(-1), ['live', 'Listening…'], 'and when it is done');
  assert.equal(h.transcripts[0].role, 'user');
  await session.close();
});

test('a delegation meant for somebody else, or with a bad id, is ignored', async () => {
  let asked = 0;
  const h = harness({ delegate: async () => { asked++; return 'x'; } });
  const session = await live(h);
  h.peers[0].emit({ type: 'session.delegation.created', delegation: { id: 'del_server', target: 'server' } });
  h.peers[0].emit({ type: 'session.delegation.created', delegation: { id: 'bad id!', target: 'client' } });
  h.peers[0].emit({ type: 'session.delegation.created', delegation: { id: 'x'.repeat(300), target: 'client' } });
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(asked, 0);
  await session.close();
});

test('the same delegation twice is answered once; a repeat of the same request reuses the answer', async () => {
  let asked = 0;
  const h = harness({ delegate: async () => { asked++; return 'One answer.'; } });
  const session = await live(h);
  const peer = h.peers[0];
  peer.emit({ type: 'session.input_transcript.delta', delta: 'What is a conductor?', start_ms: 0, end_ms: 500 });
  peer.emit({ type: 'session.delegation.created', delegation: { id: 'd1', target: 'client' } });
  peer.emit({ type: 'session.delegation.created', delegation: { id: 'd1', target: 'client' } });
  await until(() => peer.channel.messages.some(m => m.type === 'session.commentary.append'), 'the first answer');
  peer.emit({ type: 'session.delegation.created', delegation: { id: 'd2', target: 'client' } });
  await until(() => peer.channel.messages.filter(m => m.type === 'session.commentary.append').length === 2, 'the reused answer');
  assert.equal(asked, 1);
  assert.equal(peer.channel.messages.filter(m => m.type === 'session.commentary.append')[1].delegation_id, 'd2');
  await session.close();
});

test('the student talking again cancels the answer in progress, and the newer one is answered', async () => {
  const first = deferred();
  const seen = [];
  const h = harness({ delegate: async task => {
    seen.push(task.transcript.at(-1).text);
    if (seen.length === 1) { task.signal.addEventListener('abort', () => first.resolve('stale')); return first.promise; }
    return 'The newer answer.';
  } });
  const session = await live(h);
  const peer = h.peers[0];
  peer.emit({ type: 'session.input_transcript.delta', delta: 'What is heat?', start_ms: 0, end_ms: 400 });
  peer.emit({ type: 'session.delegation.created', delegation: { id: 'a1', target: 'client' }, offset_ms: 400 });
  await until(() => seen.length === 1, 'the first delegation');
  peer.emit({ type: 'session.input_transcript.delta', delta: ' Actually, what is a conductor?', start_ms: 1200, end_ms: 2000 });
  peer.emit({ type: 'session.delegation.created', delegation: { id: 'a2', target: 'client' }, offset_ms: 2000 });
  await until(() => peer.channel.messages.some(m => m.type === 'session.commentary.append' && m.delegation_id === 'a2'), 'the newer answer');
  assert.ok(!peer.channel.messages.some(m => m.type === 'session.commentary.append' && m.delegation_id === 'a1'), 'the stale answer is never spoken');
  assert.equal(peer.channel.messages.find(m => m.type === 'session.commentary.append' && m.delegation_id === 'a2').content, 'The newer answer.');
  await session.close();
});

test('a failed delegation is spoken as an apology, never as silence', async () => {
  const h = harness({ delegate: async () => { throw new Error('model down'); } });
  const session = await live(h);
  h.peers[0].emit({ type: 'session.input_transcript.delta', delta: 'Help', start_ms: 0, end_ms: 300 });
  h.peers[0].emit({ type: 'session.delegation.created', delegation: { id: 'f1', target: 'client' } });
  await until(() => h.peers[0].channel.messages.some(m => m.type === 'session.commentary.append'), 'the apology');
  assert.match(h.peers[0].channel.messages.find(m => m.type === 'session.commentary.append').content, /could not check that/);
  await session.close();
});

test('a long result is split into appends the live channel accepts', async () => {
  const long = 'A conductor lets heat pass through it easily. '.repeat(60);
  const h = harness({ delegate: async () => long });
  const session = await live(h);
  h.peers[0].emit({ type: 'session.input_transcript.delta', delta: 'Explain', start_ms: 0, end_ms: 300 });
  h.peers[0].emit({ type: 'session.delegation.created', delegation: { id: 'L1', target: 'client' } });
  await until(() => h.peers[0].channel.messages.filter(m => m.type === 'session.commentary.append').length > 1, 'several appends');
  const parts = h.peers[0].channel.messages.filter(m => m.type === 'session.commentary.append');
  parts.forEach(p => assert.ok(Buffer.byteLength(p.content, 'utf8') <= 480, 'each append fits the budget'));
  assert.equal(parts.map(p => p.content).join(''), long.trim().slice(0, 6000));
  await session.close();
});

test('the server\'s own refusal is what the student reads', async () => {
  const h = harness({ status: 429, error: { error: { code: 'live_limit', message: 'You have used today\'s voice calls with The Polymath.' } } });
  await assert.rejects(h.connect(), /today's voice calls/);
  assert.ok(h.statuses.some(([p, m]) => p === 'error' && /today's voice calls/.test(m)));
  const bare = harness({ status: 503 });
  await assert.rejects(bare.connect(), /unavailable just now/);
});

test('no microphone, no account or no App Check token refuses before anything is paid for', async () => {
  const noMic = harness();
  noMic.track.readyState = 'ended';
  await assert.rejects(noMic.connect(), /Allow the microphone/);
  const noToken = harness({ appCheck: null });
  await assert.rejects(noToken.connect(), /getting ready/);
  const emptyId = harness({ idToken: '' });
  await assert.rejects(emptyId.connect(), /getting ready/);
  [noMic, noToken, emptyId].forEach(h => assert.ok(!h.calls.some(c => c[0] === 'fetch' && c[2].action === 'start'), 'no call was started'));
});

test('an incomplete answer from the server is refused and the call it named is closed', async () => {
  const h = harness({ answer: { sdp: 'not sdp' } });
  await assert.rejects(h.connect(), /came back incomplete/);
  await until(() => h.calls.some(c => c[0] === 'fetch' && c[2].action === 'stop'), 'the stop');
  const stop = h.calls.find(c => c[0] === 'fetch' && c[2].action === 'stop');
  assert.equal(stop[2].sessionId, 'polymath-call-1');
  assert.equal(stop[4], true, 'a stop survives the page going away');
});

test('ending the call closes the channel, the peer and the server session', async () => {
  const h = harness();
  const session = await live(h);
  const closing = session.close();
  assert.ok(h.peers[0].channel.messages.some(m => m.type === 'session.close'));
  h.peers[0].channel.onmessage({ data: JSON.stringify({ type: 'session.closed' }) });
  await closing;
  assert.ok(session.closed);
  assert.ok(h.calls.some(c => c[0] === 'peer.close'));
  assert.ok(h.calls.some(c => c[0] === 'channel.close'));
  assert.ok(h.calls.some(c => c[0] === 'replaceTrack' && c[1] === null), 'the microphone is detached from the call');
  assert.ok(h.calls.some(c => c[0] === 'fetch' && c[2].action === 'stop' && c[2].sessionId === 'polymath-call-1'));
  assert.deepEqual(h.statuses.at(-1)[0], 'closed');
});

test('aborting the signal mid-start ends the call, even one the server already opened', async () => {
  const gate = deferred(), controller = new AbortController();
  const h = harness({ start: gate, signal: controller.signal });
  const ready = h.connect();
  await until(() => h.calls.some(c => c[0] === 'fetch'), 'the start request');
  controller.abort();
  gate.resolve();
  await assert.rejects(ready, { name: 'AbortError' });
  await until(() => h.calls.some(c => c[0] === 'fetch' && c[2].action === 'stop'), 'the late call is closed');
});

test('a lost data channel ends the call with words, not a frozen crystal', async () => {
  const h = harness();
  await live(h);
  h.peers[0].channel.onclose();
  await until(() => h.statuses.some(([p]) => p === 'error'), 'the error');
  assert.match(h.statuses.find(([p]) => p === 'error')[1], /keep going by typing/);
});

test('the voice module builds its crystal without markup strings', () => {
  assert.doesNotMatch(SOURCE, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.doesNotMatch(SOURCE, /Chung GPT|OpenAI|gpt-live|Gemini/i, 'the student meets The Polymath, not a vendor');
  assert.match(SOURCE, /createElementNS/);
  ['pm-crystal', 'pm-gem', 'pm-halo', 'pm-rays', 'pm-ring', 'pm-core', 'pm-spark'].forEach(cls => assert.ok(SOURCE.includes(cls), cls));
  assert.match(SOURCE, /--pm-level/);
  assert.match(SOURCE, /visibilitychange/);
  assert.match(SOURCE, /pagehide/);
  assert.match(SOURCE, /TUTOR_VOICE_IDLE_MS/);
  // The analysers only listen: the incoming voice is never connected to the speakers twice.
  assert.doesNotMatch(SOURCE, /\.destination\b/);
});
