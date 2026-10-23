// 🧠 The Polymath — the SHIPPED page (polymath.html + polymath-tutor.js +
// polymath-voice.js + polymath-tutor-core.mjs) in Chromium, with the five
// Firebase modules it imports from gstatic replaced by local fakes, a fake
// WebRTC peer standing in for the live voice, and Chromium's own fake
// microphone. No account, no real model, no paid call.
//   PLAYWRIGHT_MODULE=/path/to/playwright node tools/polymath-tutor-browser.mjs
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as core from '../polymath-tutor-core.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const QA_DIR = process.env.POLYMATH_QA_DIR || '';

const PAPER = core.normalizeTutorPaper({
  title: 'PSLE 2019 Science — Heat',
  questions: [
    { label: 'Question 1 — PSLE 2019 Q4', source: 'PSLE 2019 Q4', items: [
      { t: 'text', text: 'Which material is the best conductor of heat?' },
      { t: 'img', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAAYCAIAAAApowkFAAAANElEQVR4nO3OUQkAIBBAsevf0X9baAyfMFiAzdrnO/N8IB0mLS0dIC0tHSAtLR0gLS0dcAET9I9iZMlIjAAAAABJRU5ErkJggg==', caption: 'Four spoons' },
      { t: 'mcq', id: 's1', options: [{ label: '1', text: 'Wood' }, { label: '2', text: 'Plastic' }, { label: '3', text: 'Steel' }, { label: '4', text: 'Rubber' }] },
    ], mcq: { s1: '3' }, key: [{ label: 'Answer', text: '3. Steel' }] },
    { label: 'Question 2', marks: 2, items: [
      { t: 'text', text: 'Explain why the ice cube melted faster on the metal tray.', part: '(a)' },
      { t: 'table', rows: [{ c: ['Tray', 'Time (min)'] }, { c: ['Metal', '4'] }, { c: ['Plastic', '9'] }] },
      { t: 'write', id: 's1', lines: 3, part: '(a)' },
      { t: 'fill', id: 's2', segments: [{ text: 'Heat flows from a ' }, { blank: true }, { text: ' object to a colder one.' }] },
    ], key: [{ part: '(a)', text: 'Metal is a good conductor of heat, so the ice gained heat faster from the tray.' }] },
  ],
});
const ID = core.tutorPaperId(PAPER);

// The fakes stand in for the exact gstatic URLs polymath.html imports.
const FAKES = {
  'firebase-app.js': 'export function initializeApp(c){ window.__fb.config = c; return { name: "app" }; }',
  'firebase-app-check.js': `export class ReCaptchaV3Provider { constructor(k){ this.key = k; } }
    export function initializeAppCheck(app, o){ window.__fb.appCheck = o.provider.key; return { appCheck: true }; }
    export async function getToken(ac, force){ window.__fb.appCheckTokens = (window.__fb.appCheckTokens || 0) + 1; return { token: 'app-check-token' }; }`,
  // A Firestore that keeps every document in window.__fb.store, keyed by path.
  'firebase-firestore.js': `export function getFirestore(){ return {}; }
    export function doc(db, ...segs){ return { col: segs.slice(0, -1).join('/'), id: segs[segs.length - 1] }; }
    const path = ref => ref.col + '/' + ref.id;
    const copy = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    export async function getDoc(ref){ window.__fb.reads.push(ref); const p = window.__fb.store[path(ref)]; return { exists: () => !!p, data: () => copy(p) }; }
    export async function setDoc(ref, data){ window.__fb.writes.push({ op: 'set', path: path(ref), data: copy(data) }); window.__fb.store[path(ref)] = copy(data); }
    export async function updateDoc(ref, data){ if (!window.__fb.store[path(ref)]) throw new Error('No document to update'); window.__fb.writes.push({ op: 'update', path: path(ref), data: copy(data) }); Object.assign(window.__fb.store[path(ref)], copy(data)); }
    export function serverTimestamp(){ return { __serverTimestamp: true }; }`,
  // Google sign-in and anonymous sign-in, with a listener like the real one.
  'firebase-auth.js': `const auth = { currentUser: null, listeners: [] };
    const fire = () => auth.listeners.forEach(cb => cb(auth.currentUser));
    const make = (o) => Object.assign({ getIdToken: async () => o.isAnonymous ? 'anon-id-token' : 'google-id-token' }, o);
    export function getAuth(){ return auth; }
    export function onAuthStateChanged(a, cb){ auth.listeners.push(cb); setTimeout(() => cb(auth.currentUser), 0); return () => { auth.listeners = auth.listeners.filter(f => f !== cb); }; }
    export class GoogleAuthProvider { setCustomParameters(p){ this.params = p; } }
    export async function signInWithPopup(a, provider){ window.__fb.popups = (window.__fb.popups || 0) + 1;
      auth.currentUser = make({ uid: 'kid-1', isAnonymous: false, displayName: 'Ava Tan (Google)', email: 'ava@example.com' }); fire(); return { user: auth.currentUser }; }
    export async function signInWithRedirect(){ throw new Error('no redirect in a test'); }
    export async function signInAnonymously(){ window.__fb.anonymous = (window.__fb.anonymous || 0) + 1;
      auth.currentUser = make({ uid: 'anon-1', isAnonymous: true, displayName: '', email: '' }); fire(); return { user: auth.currentUser }; }
    export async function signOut(){ auth.currentUser = null; fire(); }`,
  'firebase-ai.js': `export class GoogleAIBackend {}
    export function getAI(){ return {}; }
    export function getGenerativeModel(ai, o){ window.__fb.model = o.model; return { async generateContent(req){
      const parts = req.contents[0].parts; const prompt = parts[0].text;
      window.__fb.asks.push({ prompt, images: parts.length - 1, json: req.generationConfig.responseMimeType === 'application/json' });
      let text = 'Think about which material lets heat pass through easily.';
      if (window.__fb.fail) throw new Error('[429] quota exceeded');
      if (req.generationConfig.responseMimeType === 'application/json') text = /CORRECT/.test(prompt) ? '{"verdict":"incorrect","feedback":"Great choice! Steel conducts heat well.","nextStep":""}' : '{"verdict":"partial","feedback":"You noticed the metal tray. **Good.**","nextStep":"What does the metal do with heat?"}';
      else if (/TALKING to the student/.test(prompt)) text = 'The Polymath: **Steel** lets heat travel through it quickly. Which spoon would feel hot first?';
      else if (/teach the full answer/.test(prompt)) text = 'Metal is a good conductor of heat. Model answer: the ice gained heat faster.';
      else if (/^Student:/m.test(prompt)) text = 'A conductor lets heat flow through it quickly.';
      return { response: { text: () => text } };
    } }; }`,
};

// The live voice, faked at the WebRTC seam: the page's real bridge talks to
// this peer exactly as it would to the provider. The reply "audio" is a real
// tone from an AudioContext, so the crystal's analyser has a voice to follow.
const FAKE_RTC = () => {
  window.__live = { peers: [], sent: [], streams: [] };
  const realGum = navigator.mediaDevices && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  if (realGum) navigator.mediaDevices.getUserMedia = async c => { const s = await realGum(c); window.__live.streams.push(s); window.__live.constraints = c; return s; };
  class FakePeer {
    constructor() { this.iceGatheringState = 'complete'; this.connectionState = 'new'; this.senders = []; window.__live.peers.push(this); }
    addTrack(track) { this.senders.push({ track, replaceTrack: async t => { this.detached = t === null; } }); }
    getSenders() { return this.senders; }
    createDataChannel(label) {
      const ch = { label, readyState: 'connecting',
        send: raw => { const m = JSON.parse(raw); window.__live.sent.push(m); if (m.type === 'session.close') setTimeout(() => ch.onmessage && ch.onmessage({ data: '{"type":"session.closed"}' }), 0); },
        close: () => { ch.readyState = 'closed'; } };
      this.channel = ch; return ch;
    }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }; }
    async setLocalDescription(d) { this.localDescription = d; }
    async setRemoteDescription(d) {
      this.remote = d; this.channel.readyState = 'open'; this.connectionState = 'connected';
      const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
      gain.gain.value = 0; const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest); osc.start();
      window.__live.voice = gain;                       // the test turns the "voice" up and down
      setTimeout(() => this.ontrack && this.ontrack({ streams: [dest.stream], track: dest.stream.getAudioTracks()[0] }), 0);
    }
    addEventListener() {} removeEventListener() {}
    close() { this.closed = true; this.connectionState = 'closed'; }
  }
  window.RTCPeerConnection = FakePeer;
  window.__live.emit = e => window.__live.peers.at(-1).channel.onmessage({ data: JSON.stringify(e) });
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (type, body, status = 200) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (url.pathname === '/fixture.svg') return send('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120" fill="#eef"/><text x="10" y="60">spoons</text></svg>');
  const file = ROOT + url.pathname.replace(/^\/+/, '');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send('text/plain', 'missing', 404);
  const type = /\.html$/.test(file) ? 'text/html; charset=utf-8' : /\.m?js$/.test(file) ? 'text/javascript' : /\.png$/.test(file) ? 'image/png' : 'application/octet-stream';
  send(type, fs.readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok - ' + name); }
  catch (e) { failed++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); }
}
const LIVE_ENDPOINT = core.TUTOR_LIVE_ENDPOINT;
async function open(hash, width = 390, papers, extra) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://www.gstatic.com/firebasejs/**', route => {
    const name = route.request().url().split('/').pop();
    if (!FAKES[name]) return route.abort();
    route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKES[name] });
  });
  // The voice endpoint, CORS and all, recording what the page sent it.
  const liveCalls = [];
  await page.route(LIVE_ENDPOINT, async route => {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Firebase-AppCheck', Vary: 'Origin' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    const body = JSON.parse(req.postData() || '{}');
    liveCalls.push({ body, headers: req.headers() });
    if (body.action === 'start') {
      if (extra && extra.refuse) return route.fulfill({ status: 429, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: { code: 'live_limit', message: 'You have used today\'s voice calls with The Polymath.' } }) });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ sessionId: 'polymath-call-1', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', expiresAt: Date.now() + 900000, maxDurationSeconds: 900 }) });
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ stopped: true }) });
  });
  await page.addInitScript(([papers, profiles]) => { window.__fb = { store: Object.assign({}, papers, profiles), reads: [], asks: [], writes: [] }; },
    [papers || { ['polymathTutorPapers/' + ID]: PAPER }, (extra && extra.profiles) || {}]);
  await page.addInitScript(FAKE_RTC);
  await page.goto(origin + '/polymath.html' + hash);
  return { context, page, errors, liveCalls };
}
const shot = async (page, name) => { if (QA_DIR) { fs.mkdirSync(QA_DIR, { recursive: true }); await page.screenshot({ path: QA_DIR + '/' + name + '.png', fullPage: true }); } };

await check('the whole-paper code opens the paper list', async () => {
  const { context, page, errors } = await open('#' + ID);
  await page.getByRole('heading', { name: PAPER.title }).waitFor();
  assert.equal(await page.locator('.pt-qrow').count(), 2);
  assert.equal(await page.title(), 'The Polymath');
  assert.equal(await page.locator('.pt-brand-text strong').textContent(), 'The Polymath');
  const fb = await page.evaluate(() => window.__fb);
  assert.deepEqual(fb.reads, [{ col: 'polymathTutorPapers', id: ID }], 'a phone that has not signed in reads only the paper');
  assert.deepEqual(fb.writes, []);
  assert.equal(fb.config.projectId, 'mathgen--app');
  assert.ok(fb.appCheck, 'App Check is started');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, 'no sideways scroll on a phone');
  await shot(page, 'paper');
  await page.getByRole('button', { name: /Start with Question 1/ }).click();
  await page.waitForFunction(id => location.hash === '#' + id + '/1', ID);
  await page.getByRole('heading', { name: 'Question 1 — PSLE 2019 Q4' }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

await check('an MCQ is marked by the key, and the model explains', async () => {
  const { context, page, errors } = await open('#' + ID + '/1');
  await page.getByRole('heading', { name: 'Question 1 — PSLE 2019 Q4' }).waitFor();
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.getByText('Have a go first').waitFor();
  assert.equal((await page.evaluate(() => window.__fb.asks)).length, 0, 'no call for an empty answer');
  await page.getByRole('radio', { name: /Steel/ }).click();
  assert.equal(await page.getByRole('radio', { name: /Steel/ }).getAttribute('aria-checked'), 'true');
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.locator('.pt-feedback.pt-correct').waitFor();
  // The fake model said "incorrect"; the key said option 3 — the key wins.
  assert.match(await page.locator('.pt-feedback').textContent(), /Correct/);
  const ask = (await page.evaluate(() => window.__fb.asks))[0];
  assert.ok(ask.json, 'marking asks for JSON');
  assert.equal(ask.images, 1, 'the question\'s picture goes to the model');
  assert.match(ask.prompt, /You are The Polymath/);
  assert.match(ask.prompt, /Chose option \(3\)/);
  assert.ok(await page.getByRole('button', { name: '📘 Worked solution' }).isEnabled(), 'right answer unlocks the solution');
  // Progress is on the phone: reload and it is still there.
  await page.reload();
  await page.locator('.pt-feedback.pt-correct').waitFor();
  assert.equal(await page.locator('.pt-score b').textContent(), '1');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('an open question: hints step up, the solution stays locked until a real go, chat works', async () => {
  const { context, page, errors } = await open('#' + ID + '/2');
  await page.getByRole('heading', { name: 'Question 2' }).waitFor();
  assert.equal(await page.locator('.pt-table tr').count(), 3);
  assert.ok(await page.getByRole('button', { name: '🔒 Worked solution' }).isDisabled());
  await page.getByRole('button', { name: '💡 Hint 1 of 3' }).click();
  await page.locator('.pt-hint').first().waitFor();
  assert.match((await page.evaluate(() => window.__fb.asks)).at(-1).prompt, /SMALLEST/);
  await page.getByRole('textbox', { name: '(a) Your answer' }).fill('The metal tray was warmer.');
  await page.getByRole('textbox', { name: 'Blank 1' }).fill('hotter');
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.locator('.pt-feedback.pt-partial').waitFor();
  assert.match(await page.locator('.pt-feedback').textContent(), /You noticed the metal tray\. Good\./, 'markdown is stripped');
  const prompt = (await page.evaluate(() => window.__fb.asks)).at(-1).prompt;
  assert.match(prompt, /The metal tray was warmer\./);
  assert.match(prompt, /\(1\) hotter/);
  assert.match(prompt, /good conductor of heat/);
  assert.ok(await page.getByRole('button', { name: '🔒 Worked solution' }).isDisabled(), 'one try is not enough');
  await page.getByRole('button', { name: 'Check again' }).click();
  await page.getByText('try 2').waitFor();
  await page.getByRole('button', { name: '📘 Worked solution' }).click();
  await page.locator('.pt-solution').waitFor();
  await page.getByRole('textbox', { name: 'Message to The Polymath' }).fill('What is a conductor?');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.pt-bubble.pt-tutor').waitFor();
  assert.match(await page.locator('.pt-bubble.pt-tutor').textContent(), /lets heat flow/);
  await shot(page, 'question');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('nothing from the document is ever run as HTML', async () => {
  const evil = core.normalizeTutorPaper({ title: '<img src=x onerror="window.__pwned=1">', questions: [{ items: [{ t: 'text', text: '<script>window.__pwned=1</script><b>bold?</b>' }] }] });
  const id = core.tutorPaperId(evil);
  const { context, page } = await open('#' + id + '/1', 390, { ['polymathTutorPapers/' + id]: evil });
  await page.locator('.pt-text').waitFor();
  assert.match(await page.locator('.pt-text').textContent(), /<script>/);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  await context.close();
});

await check('a bad link and a missing paper each say what to do', async () => {
  let s = await open('#nope');
  await s.page.getByRole('alert').waitFor();
  assert.match(await s.page.getByRole('alert').textContent(), /not a Polymath link/);
  await s.context.close();
  s = await open('#pzzzzzzzzzz/1', 390, {});
  await s.page.getByRole('alert').waitFor();
  assert.match(await s.page.getByRole('alert').textContent(), /could not be found/);
  await s.context.close();
});

await check('a busy model is a message, not a crash', async () => {
  const { context, page, errors } = await open('#' + ID + '/2');
  await page.getByRole('heading', { name: 'Question 2' }).waitFor();
  await page.evaluate(() => { window.__fb.fail = true; });
  await page.getByRole('button', { name: '💡 Hint 1 of 3' }).click();
  await page.locator('.pt-inline-error').waitFor();
  assert.match(await page.locator('.pt-inline-error').textContent(), /very busy/);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('🎙 the crystal: a real microphone, a live call, a delegated answer, and every way out stops the mic', async () => {
  const { context, page, errors, liveCalls } = await open('#' + ID + '/1');
  await page.getByRole('heading', { name: 'Question 1 — PSLE 2019 Q4' }).waitFor();
  const card = page.locator('.pm-voice');
  await card.waitFor();
  assert.equal(await card.getAttribute('data-phase'), 'idle');
  assert.equal(await page.locator('.pm-crystal svg .pm-facet').count(), 12, 'the gem is drawn');
  assert.match(await page.locator('.pm-status').textContent(), /Tap the crystal/);
  assert.equal(await page.locator('.pm-log').isVisible(), false, 'no empty transcript box before a call');
  // The idle crystal still breathes.
  const before = await card.evaluate(n => n.style.getPropertyValue('--pm-level'));
  await page.waitForTimeout(300);
  assert.notEqual(await card.evaluate(n => n.style.getPropertyValue('--pm-level')), '', 'the crystal is animated');
  void before;

  await page.locator('.pm-crystal').click();
  await page.waitForFunction(() => window.__live.peers.length === 1 && window.__live.peers[0].channel.readyState === 'open');
  // Signed out: an anonymous account is made at the tap, and both tokens go up.
  const start = liveCalls.find(c => c.body.action === 'start');
  assert.ok(start, 'the call was started at The Polymath\'s endpoint');
  assert.deepEqual(Object.keys(start.body).sort(), ['action', 'sdp']);
  assert.equal(start.headers.authorization, 'Bearer anon-id-token');
  assert.equal(start.headers['x-firebase-appcheck'], 'app-check-token');
  assert.equal(await page.evaluate(() => window.__fb.anonymous), 1);
  const constraints = await page.evaluate(() => window.__live.constraints);
  assert.equal(constraints.video, false, 'audio only');
  assert.equal(constraints.audio.echoCancellation, true);
  // An anonymous phone is still "signed out": the header offers Sign in.
  await page.locator('.pt-signin').waitFor();

  await page.evaluate(() => window.__live.emit({ type: 'session.started' }));
  await page.waitForFunction(() => document.querySelector('.pm-voice').dataset.phase === 'listening');
  assert.ok(await page.getByRole('button', { name: 'End the call', exact: true }).isVisible());
  assert.ok(await page.getByRole('button', { name: '🔇 Mute me' }).isVisible());
  await page.waitForFunction(() => /1[45]:\d\d left/.test(document.querySelector('.pm-clock').textContent));
  // The voice is told what is on the screen — the question, never the key.
  await page.waitForFunction(() => window.__live.sent.some(m => m.type === 'session.thinking.append' && m.delegation_id === null));
  const told = await page.evaluate(() => window.__live.sent.find(m => m.type === 'session.thinking.append' && m.delegation_id === null).content);
  assert.match(told, /Which material is the best conductor of heat\?/);
  assert.doesNotMatch(told, /ANSWER KEY|3\. Steel/);

  // The student speaks; the voice delegates; the page's tutor answers.
  await page.evaluate(() => {
    window.__live.emit({ type: 'session.input_transcript.delta', delta: 'Why is steel the answer?', start_ms: 100, end_ms: 900 });
    window.__live.emit({ type: 'session.delegation.created', delegation: { id: 'del_1', target: 'client' }, offset_ms: 900 });
  });
  await page.waitForFunction(() => window.__live.sent.some(m => m.type === 'session.commentary.append' && m.delegation_id === 'del_1'));
  const spoken = await page.evaluate(() => window.__live.sent.filter(m => m.type === 'session.commentary.append').map(m => m.content).join(''));
  assert.equal(spoken, 'Steel lets heat travel through it quickly. Which spoon would feel hot first?', 'markdown and the name prefix are stripped for speech');
  const voiceAsk = (await page.evaluate(() => window.__fb.asks)).find(a => /TALKING to the student/.test(a.prompt));
  assert.ok(voiceAsk, 'the delegation went to the page\'s own tutor');
  assert.match(voiceAsk.prompt, /Student: Why is steel the answer\?/);
  assert.match(voiceAsk.prompt, /ANSWER KEY \(for you only\)/);
  assert.match(voiceAsk.prompt, /Do NOT give the final answer/);
  assert.equal(voiceAsk.images, 1, 'the voice tutor sees the question\'s picture too');
  await page.locator('.pm-line.pm-you').waitFor();
  assert.match(await page.locator('.pm-line.pm-you').textContent(), /Why is steel the answer\?/);

  // The tutor talks: the crystal follows the voice.
  await page.evaluate(() => {
    window.__live.voice.gain.value = 0.9;
    window.__live.emit({ type: 'session.output_transcript.delta', delta: 'Steel lets heat travel through it quickly.', start_ms: 1000, end_ms: 2500 });
  });
  await page.waitForFunction(() => document.querySelector('.pm-voice').dataset.phase === 'speaking');
  await page.waitForFunction(() => parseFloat(document.querySelector('.pm-voice').style.getPropertyValue('--pm-level')) > 0.2);
  await shot(page, 'voice-speaking');
  await page.evaluate(() => { window.__live.voice.gain.value = 0; });
  await page.waitForFunction(() => document.querySelector('.pm-voice').dataset.phase === 'listening', null, { timeout: 8000 });

  // The call survives moving to the next question, and the voice is told the new screen.
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.getByRole('heading', { name: 'Question 2' }).waitFor();
  assert.equal(await page.locator('.pm-voice').getAttribute('data-phase'), 'listening', 'the call carried on');
  await page.waitForFunction(() => window.__live.sent.some(m => m.type === 'session.thinking.append' && m.delegation_id === null && /ice cube melted/.test(m.content)));

  // Mute, then End: the microphone is switched off and the server told.
  await page.getByRole('button', { name: '🔇 Mute me' }).click();
  assert.equal(await page.evaluate(() => window.__live.streams[0].getAudioTracks()[0].enabled), false);
  await page.getByRole('button', { name: 'End the call', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pm-voice').dataset.phase === 'idle');
  assert.equal(await page.evaluate(() => window.__live.streams[0].getAudioTracks().every(t => t.readyState === 'ended')), true, 'the microphone is off');
  await page.waitForFunction(() => window.__live.peers[0].closed === true);
  assert.ok(await page.evaluate(() => window.__live.sent.some(m => m.type === 'session.close')));
  await page.waitForTimeout(100);
  assert.ok(liveCalls.some(c => c.body.action === 'stop' && c.body.sessionId === 'polymath-call-1'), 'the server session is stopped');

  // A second call, ended by leaving the page.
  await page.locator('.pm-crystal').click();
  await page.waitForFunction(() => window.__live.peers.length === 2 && window.__live.peers[1].channel.readyState === 'open');
  await page.evaluate(() => window.__live.emit({ type: 'session.started' }));
  await page.waitForFunction(() => document.querySelector('.pm-voice').dataset.phase === 'listening');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.waitForFunction(() => window.__live.streams[1].getAudioTracks().every(t => t.readyState === 'ended'));
  // And a third, ended by opening another paper.
  await page.locator('.pm-crystal').click();
  await page.waitForFunction(() => window.__live.peers.length === 3 && window.__live.peers[2].channel.readyState === 'open');
  await page.evaluate(() => window.__live.emit({ type: 'session.started' }));
  await page.waitForFunction(() => document.querySelector('.pm-voice').dataset.phase === 'listening');
  await page.evaluate(() => { location.hash = '#pzzzzzzzzzz/1'; });
  await page.waitForFunction(() => window.__live.streams[2].getAudioTracks().every(t => t.readyState === 'ended'));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, 'no sideways scroll on a phone');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('🎙 a refused call says why, and leaves no microphone on', async () => {
  const { context, page, errors } = await open('#' + ID + '/1', 390, undefined, { refuse: true });
  await page.locator('.pm-voice').waitFor();
  await page.getByRole('button', { name: /Talk to The Polymath/ }).first().click();
  await page.waitForFunction(() => document.querySelector('.pm-voice').dataset.phase === 'error');
  assert.match(await page.locator('.pm-status').textContent(), /today's voice calls/);
  await page.waitForFunction(() => window.__live.streams.length === 1 && window.__live.streams[0].getAudioTracks().every(t => t.readyState === 'ended'));
  assert.deepEqual(errors, []);
  await context.close();
});

await check('📕 signing in with Study Buddy: wrong answers go into its mistake book, a right one sorts them', async () => {
  const profiles = { 'studentProfiles/kid-1': { name: 'Parent Account', level: 'P4', tutorOnboard: { students: [{ name: 'Ava', level: 'P5' }] } } };
  const { context, page, errors } = await open('#' + ID + '/1', 390, undefined, { profiles });
  await page.getByRole('heading', { name: 'Question 1 — PSLE 2019 Q4' }).waitFor();
  // Signed out, a wrong answer stays on the phone only.
  await page.getByRole('radio', { name: /Wood/ }).click();
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.locator('.pt-feedback.pt-incorrect').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__fb.writes), [], 'nothing is written without an account');
  // The intro card offers the sign-in.
  await page.getByRole('button', { name: '← Whole paper' }).click();
  await page.locator('.pt-book-off').waitFor();
  assert.match(await page.locator('.pt-book-off').textContent(), /Study Buddy will remember the questions you get wrong/);
  await shot(page, 'book-signed-out');
  await page.locator('.pt-book-off').getByRole('button', { name: 'Sign in' }).click();
  // The student's own name from the Study Buddy roster, not the account's.
  await page.locator('.pt-signout').waitFor();
  await page.waitForFunction(() => /Ava/.test(document.querySelector('.pt-account-name').textContent) && !/Google/.test(document.querySelector('.pt-account-name').textContent));
  await page.locator('.pt-book-on').waitFor();
  assert.match(await page.locator('.pt-book-on').textContent(), /Signed in as Ava\./);
  // The question already marked wrong on this phone is filed on sign-in.
  const path = 'users/kid-1/mistakes/' + core.mistakeDocId(ID, 1);
  await page.waitForFunction(p => window.__fb.store[p], path);
  let card = await page.evaluate(p => window.__fb.store[p], path);
  assert.equal(card.source, 'polymath');
  assert.equal(card.verdict, 'wrong');
  assert.equal(card.type, 'mcq');
  assert.equal(card.option, '1');
  assert.equal(card.level, 'P5');
  assert.equal(card.subject, 'science');
  assert.equal(card.cleared, false);
  assert.deepEqual(card.createdAt, { __serverTimestamp: true });
  assert.match(card.question, /best conductor of heat/);
  assert.match(card.studentAnswer, /Chose option \(1\)/);
  assert.match(card.answer, /Steel/);
  await shot(page, 'book-signed-in');

  // An open question marked partly right is filed as it is checked, with a note.
  await page.getByRole('button', { name: 'Carry on with Question 2' }).click();
  await page.getByRole('textbox', { name: '(a) Your answer' }).fill('The metal tray was warmer.');
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.locator('.pt-feedback.pt-partial').waitFor();
  await page.locator('.pt-filed').waitFor();
  assert.match(await page.locator('.pt-filed').textContent(), /Saved to your Study Buddy mistake book/);
  const card2 = await page.evaluate(p => window.__fb.store[p], 'users/kid-1/mistakes/' + core.mistakeDocId(ID, 2));
  assert.equal(card2.verdict, 'partial');
  assert.equal(card2.type, 'open');
  assert.match(card2.studentAnswer, /metal tray was warmer/);
  assert.match(card2.feedback, /What does the metal do with heat\?/);

  // Checking it again updates the same card; it keeps its place in the book.
  await page.getByRole('button', { name: 'Check again' }).click();
  await page.getByText('try 2').waitFor();
  await page.waitForFunction(() => window.__fb.writes.filter(w => /mistakes\/.*-2$/.test(w.path)).length === 2);
  const w2 = await page.evaluate(() => window.__fb.writes.filter(w => /mistakes\/.*-2$/.test(w.path)));
  assert.equal(w2[0].op, 'set');
  assert.equal(w2[1].op, 'update');
  assert.ok(!('createdAt' in w2[1].data), 'createdAt is never rewritten');
  assert.equal(w2[1].data.attempts, 2);

  // Getting question 1 right marks its card sorted.
  await page.getByRole('button', { name: 'Previous question' }).click();
  await page.getByRole('radio', { name: /Steel/ }).click();
  await page.getByRole('button', { name: 'Check again' }).click();
  await page.locator('.pt-feedback.pt-correct').waitFor();
  await page.locator('.pt-filed').waitFor();
  assert.match(await page.locator('.pt-filed').textContent(), /Marked as sorted/);
  card = await page.evaluate(p => window.__fb.store[p], path);
  assert.equal(card.cleared, true);

  // Signed in, a voice call goes up under the student's own account.
  await page.locator('.pm-crystal').click();
  await page.waitForFunction(() => window.__live.peers.length === 1 && window.__live.peers[0].channel.readyState === 'open');
  assert.equal(await page.evaluate(() => window.__fb.anonymous || 0), 0, 'no anonymous account for a signed-in student');
  await page.getByRole('button', { name: 'End the call', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pm-voice').dataset.phase === 'idle');

  // Signing out stops the writing.
  const writes = (await page.evaluate(() => window.__fb.writes)).length;
  await page.locator('.pt-signout').click();
  await page.locator('.pt-signin').waitFor();
  await page.getByRole('radio', { name: /Wood/ }).click();
  await page.getByRole('button', { name: 'Check again' }).click();
  await page.locator('.pt-feedback.pt-incorrect').waitFor();
  await page.waitForTimeout(150);
  assert.equal((await page.evaluate(() => window.__fb.writes)).length, writes, 'nothing written after signing out');
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all browser checks passed');
