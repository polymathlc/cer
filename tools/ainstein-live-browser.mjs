// Real browser tests of the shipped live module. All microphone, WebRTC and
// paid network operations are replaced with deterministic browser fixtures.
// Run: node tools/ainstein-live-browser.mjs
// Optional: PLAYWRIGHT_MODULE, CHROME_PATH, AINSTEIN_QA_DIR.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch { playwright = require('C:/Users/chung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
const source = fs.readFileSync(new URL('../ainstein-live.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const output = process.env.AINSTEIN_QA_DIR || fileURLToPath(new URL('../../cer-live-qa/', import.meta.url));
fs.mkdirSync(output, { recursive: true });
const browserPath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const browser = await playwright.chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
const results = [];
const failures = [];

async function test(name, run) {
  try { await run(); results.push({ name, passed: true }); console.log('PASS', name); }
  catch (error) { results.push({ name, passed: false, error: error.message }); failures.push(name); console.error('FAIL', name, error.stack); }
}
async function fixture({ mobile = false, realBridge = false, admin = true, permission = 'immediate', auth = 'immediate', playback = 'allow', server = 'immediate' } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Keep the existing mascot's actual CSS alongside the new module: duplicate
  // animation names are otherwise invisible in an isolated widget fixture.
  const cssStart = appSource.lastIndexOf('const css = `', appSource.indexOf('#ainsteinBubble {'));
  const cssEnd = appSource.indexOf('`;', cssStart + 13);
  const bubbleCss = cssStart >= 0 && cssEnd > cssStart ? appSource.slice(cssStart + 13, cssEnd) : '';
  await page.route('https://cer-live.test/**', route => {
    if (route.request().url().endsWith('/ainstein-live.js')) return route.fulfill({ contentType: 'text/javascript', body: source });
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial,sans-serif;margin:0;background:#f4f8f7}main{padding:36px}h1{font-size:24px}' + bubbleCss + '#ainsteinBubble{width:88px;height:88px}#ainsteinBubble img{background:#c6e3c9}@media(max-width:560px){#ainsteinBubble{width:72px;height:72px}}</style></head><body><main><h1>Science Learning Portal</h1><p>Fixture: no account or paid AI calls.</p></main><button id="ainsteinBubble" class="show"><img alt="Ai-nstein" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Ccircle fill=%27%23769b7c%27 cx=%2750%27 cy=%2750%27 r=%2750%27/%3E%3Ctext x=%2750%27 y=%2765%27 text-anchor=%27middle%27 font-size=%2750%27%3EA%3C/text%3E%3C/svg%3E"></button></body></html>' });
  });
  await page.goto('https://cer-live.test/');
  await page.evaluate(async settings => {
    const { mountAinsteinLive, AinsteinLiveBridge } = await import('/ainstein-live.js');
    const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
    const f = window.fixture = { ...settings, identity: 'admin-one', micRequests: 0, connectCalls: 0, closeCalls: 0, requests: [], sent: [], delegates: [], status: [], peers: [], deferred, permissionResult: deferred(), authResult: deferred(), serverResult: deferred(), taskResult: deferred() };
    const trackEvents = new EventTarget(), trackListeners = new Map();
    f.track = { readyState: 'live', enabled: true, stopCalls: 0,
      stop() { this.readyState = 'ended'; this.stopCalls++; },
      addEventListener(name, listener, opts) { trackListeners.set(listener, name); trackEvents.addEventListener(name, listener, opts); },
      removeEventListener(name, listener) { trackListeners.delete(listener); trackEvents.removeEventListener(name, listener); },
      end() { this.readyState = 'ended'; trackEvents.dispatchEvent(new Event('ended')); },
      get listenerCount() { return trackListeners.size; }
    };
    f.stream = { getTracks: () => [f.track], getAudioTracks: () => [f.track] };
    f.remote = { fixtureRemote: true };
    f.audio = { srcObject: null, playCalls: 0, pauseCalls: 0, setAttribute() {}, play() { this.playCalls++; return f.playback === 'deny' ? Promise.reject(new DOMException('blocked', 'NotAllowedError')) : Promise.resolve(); }, pause() { this.pauseCalls++; } };
    f.emit = event => { const peer = f.peers.at(-1); peer?.channel.onmessage?.({ data: JSON.stringify(event) }); };
    class Peer {
      constructor() { this.iceGatheringState = 'complete'; this.connectionState = 'connected'; this.senders = []; f.peers.push(this); }
      addTrack(track) { this.senders.push({ track, replaceTrack(value) { this.track = value; return Promise.resolve(); } }); }
      getSenders() { return this.senders; }
      createDataChannel(label) { this.label = label; this.channel = { readyState: 'open', send(raw) { const event = JSON.parse(raw); f.sent.push(event); if (event.type === 'session.close') queueMicrotask(() => f.emit({ type: 'session.closed' })); }, close() { this.readyState = 'closed'; } }; return this.channel; }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }; }
      async setLocalDescription(value) { this.localDescription = value; }
      async setRemoteDescription(value) { this.remoteDescription = value; this.ontrack?.({ streams: [f.remote] }); queueMicrotask(() => f.emit({ type: 'session.started' })); }
      close() { this.connectionState = 'closed'; this.closed = true; }
    }
    window.RTCPeerConnection = Peer;
    window.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body); f.requests.push(body);
      if (body.action === 'stop') return { ok: true, json: async () => ({ stopped: true }) };
      if (f.server === 'delay') await f.serverResult.promise;
      return { ok: true, json: async () => ({ sessionId: 'fixture-session', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', expiresAt: Date.now() + 600000, maxDurationSeconds: 600 }) };
    };
    const fakeBridge = { async connect(opts) {
      f.connectCalls++; f.connectionOptions = opts;
      f.session = { close() { f.closeCalls++; return Promise.resolve(); } };
      opts.onStatus('Listening. Ask the AI when you need help.', 'live');
      opts.onRemoteStream(f.remote);
      return f.session;
    } };
    f.ui = mountAinsteinLive({
      isAdmin: () => f.admin, getIdentity: () => f.identity,
      getUser: () => ({ getIdToken: () => f.auth === 'delay' ? f.authResult.promise : Promise.resolve('id-token') }),
      getAppCheckToken: () => Promise.resolve('app-check'),
      mediaDevices: { async getUserMedia() { f.micRequests++; return f.permission === 'delay' ? f.permissionResult.promise : f.stream; } },
      bridge: f.realBridge ? AinsteinLiveBridge : fakeBridge, audio: f.audio,
      getContext: () => 'Current app context: question-bank page; typed query: magnets.',
      delegate: task => { f.delegates.push(task); return f.taskResult.promise; }
    });
    f.done = () => f.ui.destroy();
  }, { mobile, realBridge, admin, permission, auth, playback, server });
  return { page, errors, async close() { await page.evaluate(() => window.fixture?.done()); await context.close(); } };
}
async function start(page) { await page.evaluate(() => { window.fixture.startPromise = window.fixture.ui.start(); }); }
async function live(page) { await page.waitForFunction(() => window.fixture.ui.phase === 'live'); }
async function inactive(page) { await page.waitForFunction(() => !window.fixture.ui.active); }

try {
  await test('student/employee gate hides satellite and refuses microphone use', async () => {
    const f = await fixture({ admin: false });
    try {
      await start(f.page);
      assert.equal(await f.page.locator('#ainsteinLiveButton').isVisible(), false);
      assert.deepEqual(await f.page.evaluate(() => [fixture.micRequests, fixture.connectCalls, fixture.ui.active]), [0, 0, false]);
      await f.page.evaluate(() => { fixture.admin = true; fixture.ui.refresh(); });
      assert.equal(await f.page.locator('#ainsteinLiveButton').isVisible(), true);
    } finally { await f.close(); }
  });

  for (const mobile of [false, true]) await test(`${mobile ? 'touch mobile' : 'desktop'} satellite follows mascot drag and panel stays in viewport`, async () => {
    const f = await fixture({ mobile });
    try {
      const b = f.page.locator('#ainsteinLiveButton');
      const initial = await b.boundingBox();
      assert.ok(initial.width >= 36 && initial.width <= 44);
      await b.click();
      for (const position of [{ x: 4, y: 6 }, { x: 140, y: 200 }, { x: mobile ? 316 : 1180, y: mobile ? 756 : 800 }]) {
        await f.page.evaluate(pos => { const anchor = document.getElementById('ainsteinBubble'); anchor.style.left = pos.x + 'px'; anchor.style.top = pos.y + 'px'; anchor.style.bottom = anchor.style.right = 'auto'; fixture.ui.place(); }, position);
        const rect = await b.boundingBox(), panel = await f.page.locator('#ainsteinLivePanel').boundingBox();
        const viewport = f.page.viewportSize();
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height, 'satellite clipped');
        assert.ok(panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= viewport.width + 1 && panel.y + panel.height <= viewport.height + 1, 'panel clipped');
      }
      await f.page.screenshot({ path: path.join(output, mobile ? 'mobile.png' : 'desktop.png'), fullPage: true });
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  await test('voice animations do not override the existing mascot animation', async () => {
    const liveNames = [...source.matchAll(/@keyframes\s+(\w+)/g)].map(m => m[1]);
    const appNames = new Set([...appSource.matchAll(/@keyframes\s+(\w+)/g)].map(m => m[1]));
    assert.deepEqual(liveNames.filter(name => appNames.has(name)), []);
  });

  await test('start, silent thinking, plain-text transcript, playback recovery and stop', async () => {
    const f = await fixture({ playback: 'deny' });
    try {
      await start(f.page); await live(f.page);
      assert.equal(await f.page.locator('#ainsteinLivePlay').isVisible(), true);
      await f.page.evaluate(() => {
        fixture.connectionOptions.onStatus('Thinking…', 'live');
        fixture.connectionOptions.onTranscript({ role: 'user', text: '<img onerror=alert(1)> Find magnet questions' });
        fixture.connectionOptions.onTranscript({ role: 'assistant', text: 'Found three questions.' });
      });
      assert.equal(await f.page.locator('#ainsteinLiveStatusText').textContent(), 'Thinking…');
      assert.equal(await f.page.locator('#ainsteinLiveLog img').count(), 0);
      assert.match(await f.page.locator('#ainsteinLiveLog').textContent(), /You: <img onerror=alert\(1\)>/);
      assert.equal(await f.page.locator('#ainsteinLiveLog div').count(), 2);
      await f.page.evaluate(() => { fixture.playback = 'allow'; });
      await f.page.locator('#ainsteinLivePlay').click();
      await f.page.waitForFunction(() => document.getElementById('ainsteinLivePlay').hidden);
      await f.page.locator('#ainsteinLiveStop').click(); await inactive(f.page);
      assert.deepEqual(await f.page.evaluate(() => [fixture.track.readyState, fixture.audio.srcObject, fixture.closeCalls]), ['ended', null, 1]);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  await test('role or identity change immediately ends mic and hides unauthorized UI', async () => {
    for (const change of ['role', 'identity']) {
      const f = await fixture();
      try {
        await start(f.page); await live(f.page);
        await f.page.evaluate(change => { if (change === 'role') fixture.admin = false; else fixture.identity = 'admin-two'; fixture.ui.refresh(); }, change);
        assert.deepEqual(await f.page.evaluate(() => [fixture.ui.active, fixture.track.readyState, fixture.audio.srcObject]), [false, 'ended', null]);
        if (change === 'role') assert.equal(await f.page.locator('#ainsteinLiveButton').isVisible(), false);
      } finally { await f.close(); }
    }
  });

  await test('canceling while microphone permission is pending stops a late stream without connecting', async () => {
    const f = await fixture({ permission: 'delay' });
    try {
      await start(f.page);
      await f.page.waitForFunction(() => fixture.micRequests === 1);
      await f.page.locator('#ainsteinLiveStop').click();
      await f.page.evaluate(async () => { fixture.permissionResult.resolve(fixture.stream); await fixture.startPromise; });
      assert.deepEqual(await f.page.evaluate(() => [fixture.ui.active, fixture.connectCalls, fixture.track.readyState]), [false, 0, 'ended']);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  await test('canceling during authentication never creates a paid session', async () => {
    const f = await fixture({ realBridge: true, auth: 'delay' });
    try {
      await start(f.page);
      await f.page.waitForFunction(() => fixture.micRequests === 1);
      await f.page.locator('#ainsteinLiveStop').click();
      await f.page.evaluate(async () => { fixture.authResult.resolve('late-token'); await fixture.startPromise; });
      assert.deepEqual(await f.page.evaluate(() => [fixture.track.readyState, fixture.requests.length, fixture.ui.active]), ['ended', 0, false]);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  await test('canceling an in-flight creation closes its late paid session', async () => {
    const f = await fixture({ realBridge: true, server: 'delay' });
    try {
      await start(f.page);
      await f.page.waitForFunction(() => fixture.requests.some(x => x.action === 'start'));
      await f.page.locator('#ainsteinLiveStop').click();
      await f.page.evaluate(() => fixture.serverResult.resolve());
      await f.page.waitForFunction(() => fixture.requests.some(x => x.action === 'stop' && x.sessionId === 'fixture-session'));
      assert.deepEqual(await f.page.evaluate(() => [fixture.track.readyState, fixture.ui.active, fixture.peers[0].closed]), ['ended', false, true]);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  for (const exit of ['close', 'escape', 'pagehide', 'hidden']) await test(`${exit} stops media and audio and closes the live session`, async () => {
    const f = await fixture({ realBridge: true });
    try {
      await start(f.page); await live(f.page);
      if (exit === 'close') await f.page.locator('.al-close').click();
      else if (exit === 'escape') await f.page.keyboard.press('Escape');
      else await f.page.evaluate(exit => { if (exit === 'pagehide') window.dispatchEvent(new Event('pagehide')); else { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); } }, exit);
      await inactive(f.page);
      await f.page.waitForFunction(() => fixture.peers[0].closed);
      assert.deepEqual(await f.page.evaluate(() => [fixture.track.readyState, fixture.audio.srcObject, fixture.requests.filter(x => x.action === 'stop').length]), ['ended', null, 1]);
      if (exit === 'close' || exit === 'escape') assert.equal(await f.page.locator('#ainsteinLivePanel').isVisible(), false);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  await test('real bridge delegates once, shows Thinking silently, and returns only completed result', async () => {
    const f = await fixture({ realBridge: true });
    try {
      await start(f.page); await live(f.page);
      await f.page.evaluate(() => {
        fixture.emit({ type: 'session.input_transcript.delta', delta: 'Find P5 magnet questions', start_ms: 20 });
        fixture.emit({ type: 'session.delegation.created', delegation: { id: 'work-one', target: 'client' } });
        fixture.emit({ type: 'session.delegation.created', delegation: { id: 'work-one', target: 'client' } });
      });
      assert.equal(await f.page.locator('#ainsteinLiveStatusText').textContent(), 'Thinking…');
      assert.deepEqual(await f.page.evaluate(() => [fixture.delegates.length, fixture.sent.filter(x => x.type === 'session.commentary.append').length]), [1, 0]);
      assert.match(await f.page.evaluate(() => fixture.delegates[0].transcript[0].text), /Find P5 magnet/);
      await f.page.evaluate(() => fixture.taskResult.resolve('Three matching questions are shown.'));
      await f.page.waitForFunction(() => fixture.sent.some(x => x.type === 'session.commentary.append'));
      assert.deepEqual(await f.page.evaluate(() => fixture.sent.filter(x => x.type === 'session.commentary.append')), [{ type: 'session.commentary.append', delegation_id: 'work-one', content: 'Three matching questions are shown.' }]);
      assert.ok(await f.page.evaluate(() => fixture.sent.some(x => x.type === 'session.thinking.append' && x.content.includes('typed query: magnets'))));
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
  await test('microphone disconnection stops live media immediately and removes listeners', async () => {
    const f = await fixture({ realBridge: true });
    try {
      await start(f.page); await live(f.page);
      assert.equal(await f.page.evaluate(() => fixture.track.listenerCount), 1);
      await f.page.evaluate(() => fixture.track.end());
      await inactive(f.page);
      await f.page.waitForFunction(() => fixture.peers[0].closed);
      assert.deepEqual(await f.page.evaluate(() => [fixture.track.readyState, fixture.audio.srcObject, fixture.track.listenerCount]), ['ended', null, 0]);
      assert.match(await f.page.locator('#ainsteinLiveStatusText').textContent(), /Microphone disconnected/);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
} finally {
  await browser.close();
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
}
console.log(`${results.length - failures.length}/${results.length} browser checks passed. Screenshots: ${output}`);
if (failures.length) process.exitCode = 1;
