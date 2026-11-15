// 🎬 Polymath Online's lesson video player (online/watch.html) in a real
// browser, on the in-memory Firebase (tools/online-portal-fake-firebase.js):
// a student opens a worksheet's videos and gets a page of its own — every
// lesson, oldest first, playing one after another, with the questions and
// pages marked on the timeline — and never the Ans Key app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime.startsWith('file:') ? runtime : pathToFileURL(runtime).href);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fake = fs.readFileSync(path.join(root, 'tools/online-portal-fake-firebase.js'), 'utf8');
const shots = path.resolve(process.env.ONLINE_SCREENSHOTS || path.join(root, '..', 'online-portal-validation'));
fs.mkdirSync(shots, { recursive: true });
const pageUrl = pathToFileURL(path.join(root, 'online/watch.html')).href;

let checks = 0;
function check(name, condition, detail) { assert.ok(condition, name + (detail ? ' — ' + detail : '')); checks++; console.log('✓ ' + name); }

// A few seconds of quiet, as a WAV the browser plays like any lesson.
function wav(seconds) {
  const rate = 8000, n = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}
const MEDIA_SECONDS = 30;
const media = wav(MEDIA_SECONDS);
const BUCKET = 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/';
const file = (name) => BUCKET + encodeURIComponent('pdf-annotator/' + name) + '?alt=media&token=abc';

const mon2 = new Date(2026, 10, 2, 19, 5).getTime();
const mon9 = new Date(2026, 10, 9, 19, 5).getTime();
const manifests = {
  'lesson-one.json': {
    version: 1, worksheetId: 'ws-b',
    timeline: {
      version: 1, duration: 30000,
      initial: { annotations: [], view: { page: 1, x: 300, y: 200, zoom: 1 } },
      events: [
        { t: 2000, type: 'upsert', annotation: { id: 'ink1', type: 'pen', page: 1, color: '#1A73E8', width: 3, points: [{ x: 60, y: 120 }, { x: 260, y: 140 }] } },
        { t: 3000, type: 'append', id: 'ink1', from: 2, points: [{ x: 300, y: 220 }] },
        { t: 15000, type: 'view', view: { page: 2, x: 300, y: 400, zoom: 1 } },
        { t: 16000, type: 'upsert', annotation: { id: 'ink2', type: 'text', page: 2, x: 80, y: 300, w: 200, h: 40, text: 'Answer: 42', fontSize: 18, color: '#C62828' } }
      ]
    },
    steps: [{ t: 0, label: 'Start', page: 1 }, { t: 1000, label: 'Q1', page: 1 }, { t: 9000, label: 'Q2', page: 1 }, { t: 20000, label: 'Q3', page: 2 }]
  },
  'lesson-two.json': {
    version: 1, worksheetId: 'ws-b',
    timeline: { version: 1, duration: 30000, initial: { annotations: [], view: { page: 2, x: 300, y: 200, zoom: 1 } }, events: [{ t: 10000, type: 'view', view: { page: 3, x: 0, y: 0, zoom: 1 } }] },
    steps: [{ t: 2000, label: 'Q4', page: 2 }, { t: 12000, label: 'Q5', page: 3 }]
  }
};
const ann = [
  { id: 'pen0', type: 'pen', page: 1, color: '#000', width: 2, points: [{ x: 1, y: 1 }] },
  // Listed newest first on purpose: the player plays the oldest first.
  { id: 'rec-three', type: 'video', page: 3, url: file('lesson-three.webm'), ts: mon9 + 3600000, lessonRecording: { version: 1, duration: 30000, video: true, screen: true, title: 'Window lesson' } },
  { id: 'rec-two', type: 'video', page: 2, url: file('lesson-two.webm'), ts: mon9, lessonRecording: { version: 1, duration: 30000, video: true, manifestUrl: file('lesson-two.json') } },
  { id: 'rec-one', type: 'video', page: 1, url: file('lesson-one.m4a'), ts: mon2, lessonRecording: { version: 1, duration: 30000, manifestUrl: file('lesson-one.json') } },
  { id: 'rec-evil', type: 'video', page: 1, url: 'https://evil.example/x.webm', ts: mon2, lessonRecording: { version: 1, duration: 30000 } }
];
const docs = {
  'onlineCourses/k6': { level: 'P6', subject: 'science', day: 'Monday', slot: 2, title: 'P6 Science · Monday 7:00pm', worksheetIds: ['ws-a', 'ws-b', 'ws-c'], currentIndex: 1, releasedThrough: 1 },
  'onlineMembers/stu': { level: 'P6', subjects: ['science'], role: 'student', name: 'Mei', email: 'mei@example.com' },
  'pdfAnnotator/ws-a': { name: 'P6 Science WS 1', storagePath: 'pdf-annotator/seed-a.pdf', annotations: '[]' },
  'pdfAnnotator/ws-b': { name: 'P5 Science November WS 1 - Revision', storagePath: 'pdf-annotator/seed-b.pdf', annotations: JSON.stringify(ann) },
  'pdfAnnotator/ws-c': { name: 'Not out yet', storagePath: 'pdf-annotator/seed-c.pdf', annotations: JSON.stringify(ann) }
};
const student = { uid: 'stu', email: 'mei@example.com', displayName: 'Mei Lim' };
const stranger = { uid: 'nobody', email: 'nobody@example.com', displayName: 'Nobody' };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function open({ user, query, width = 1280, height = 900 }) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  const fetched = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/gstatic\.com\/firebasejs\/.*\/firebase-app-compat\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: fake }));
  await page.route(/gstatic\.com\/firebasejs\/.*\/firebase-(auth|firestore|storage)-compat\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/cdnjs\.cloudflare\.com\/.*pdf\.min\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body:
    'window.pdfjsLib={GlobalWorkerOptions:{},getDocument:function(){return{promise:Promise.resolve({numPages:3,destroy:function(){},' +
    'getPage:function(n){return Promise.resolve({getViewport:function(o){return{width:600*o.scale,height:800*o.scale};},' +
    'render:function(o){var c=o.canvasContext;c.fillStyle="#f6f6f6";c.fillRect(20,20,200,40);window.__rendered=(window.__rendered||[]).concat([n]);return{promise:Promise.resolve()};}});}})}}};' }));
  await page.route(/firebasestorage\.googleapis\.com\//, (r) => {
    const url = decodeURIComponent(r.request().url());
    fetched.push(url);
    const name = (url.match(/pdf-annotator\/([^?]+)/) || [])[1] || '';
    if (manifests[name]) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(manifests[name]), headers: { 'access-control-allow-origin': '*' } });
    // Like Storage: byte ranges, so the player can seek.
    const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '');
    if (range) {
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
      return r.fulfill({ status: 206, body: media.subarray(start, end + 1), headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': 'bytes ' + start + '-' + end + '/' + media.length, 'access-control-allow-origin': '*' } });
    }
    return r.fulfill({ contentType: 'audio/wav', body: media, headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' } });
  });
  await page.route(/evil\.example/, (r) => { fetched.push(r.request().url()); r.abort(); });
  await page.addInitScript(({ user, docs }) => { window.__initialUser = user; window.__initialDocs = docs; }, { user, docs });
  await page.goto(pageUrl + query);
  return { page, context, errors, fetched };
}

/* ---- Signed out ---- */
{
  const { page, context, errors } = await open({ user: null, query: '?ws=ws-b' });
  await page.waitForSelector('#scrSignIn:not([hidden])');
  check('signed out: asks to sign in with the same Google account', await page.locator('#signInBtn').isVisible());
  check('signed out: no script errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

/* ---- A student with the worksheet released ---- */
{
  const { page, context, errors, fetched } = await open({ user: student, query: '?ws=ws-b&c=k6' });
  await page.waitForSelector('#scrPlayer:not([hidden])', { timeout: 10000 });
  check('student: the player is a page of its own, with no Ans Key app in it', (await page.locator('iframe').count()) === 0);
  check('student: the header names the worksheet and its place in the class',
    (await page.textContent('#wsName')) === 'P5 Science November WS 1 - Revision' && /Worksheet 2 of 3/.test(await page.textContent('#wsSub')) && /3 lessons/.test(await page.textContent('#wsSub')));
  const lessons = await page.$$eval('#lessonList .lesson-btn small', (els) => els.map((e) => e.textContent));
  check('student: every lesson is listed, oldest first, foreign files left out', lessons.length === 3, JSON.stringify(lessons));
  const days = await page.$$eval('#lessonList .day-head', (els) => els.map((e) => e.textContent));
  check('student: the lessons are grouped by class day in the order they were taught', /Mon 2 Nov/.test(days[0]) && /Mon 9 Nov/.test(days[1]), JSON.stringify(days));
  check('student: it starts on the first lesson taught', await page.evaluate(() => window.__watch.state.index === 0 && window.__watch.state.lessons[0].id === 'rec-one'));
  await page.waitForFunction(() => document.querySelectorAll('#qRow .qmark').length === 3, null, { timeout: 8000 });
  const chips = await page.$$eval('#qRow .qmark', (els) => els.map((e) => e.textContent));
  check('student: the timeline carries the question numbers', chips.join('|') === 'Q1|Q2|Q3', chips.join('|'));
  const bands = await page.$$eval('#pageRow .pmark', (els) => els.map((e) => e.getAttribute('title')));
  check('student: and the pages under it', bands.length === 2 && /^Page 1/.test(bands[0]) && /^Page 2 · from 0:15/.test(bands[1]), JSON.stringify(bands));
  const leftQ2 = await page.$eval('#qRow .qmark:nth-child(2)', (e) => parseFloat(e.style.left));
  check('student: each question sits at its moment in the lesson', Math.abs(leftQ2 - 30) < 0.5, String(leftQ2));
  const chapters = await page.$$eval('#lessonList .lesson.is-current .chap', (els) => els.map((e) => e.textContent));
  check('student: the lesson\'s questions are listed as chapters with page and time', chapters.length === 3 && /Q1p10:01/.test(chapters[0].replace(/\s/g, '')) && /Q3p20:20/.test(chapters[2].replace(/\s/g, '')), JSON.stringify(chapters));
  await page.waitForFunction(() => window.__watch.state.marks['rec-two'], null, { timeout: 8000 });
  check('student: the later lessons\' questions are listed too', /Q4/.test(await page.textContent('#lessonList')) && /Q5/.test(await page.textContent('#lessonList')));
  check('student: a voice lesson shows the worksheet page with the writing', await page.locator('#pageWrap').isVisible() && await page.locator('#voiceBadge').isVisible());
  await page.waitForFunction(() => (window.__rendered || []).length > 0, null, { timeout: 8000 });

  // Jump to Q2 on the timeline.
  await page.click('#qRow .qmark:nth-child(2)');
  await page.waitForFunction(() => Math.abs(document.getElementById('media').currentTime - 9) < 1.5, null, { timeout: 5000 });
  check('student: tapping Q2 jumps there', true);
  check('student: the player says which question and page are on screen', /Q2 · page 1/.test(await page.textContent('#nowMark')), await page.textContent('#nowMark'));
  await page.screenshot({ path: path.join(shots, '10-watch-voice-lesson.png') });
  // Jump to page 2 from its band: the page with the writing follows.
  await page.click('#pageRow .pmark:nth-child(2)');
  await page.waitForFunction(() => /page 2/.test(document.getElementById('nowMark').textContent), null, { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('pageLabel').textContent.startsWith('Page 2'), null, { timeout: 5000 });
  check('student: tapping a page band jumps there and the worksheet turns to it', true);
  const inkPixels = () => page.evaluate(() => {
    const c = document.getElementById('ink');
    if (!c.width) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
  check('student: nothing is written on page 2 before the teacher writes it', (await inkPixels()) === 0);
  await page.evaluate(() => { document.getElementById('media').pause(); window.__watch.seekTo(17.5); });
  await page.waitForFunction(() => {
    const c = document.getElementById('ink');
    if (!c.width) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
    return false;
  }, null, { timeout: 5000 });
  const inked = await inkPixels();
  check('student: the teacher\'s writing appears on the page as it was written', inked > 50, String(inked));
  await page.evaluate(() => window.__watch.seekTo(5));
  await page.waitForFunction(() => document.getElementById('pageLabel').textContent.startsWith('Page 1'), null, { timeout: 5000 });
  check('student: going back turns back to page 1 with its own writing', (await inkPixels()) > 20);

  // The end of a lesson: Up next, and the next one plays by itself.
  await page.evaluate(() => { const m = document.getElementById('media'); m.currentTime = m.duration - 0.4; m.play(); });
  await page.waitForSelector('#upNext:not([hidden])', { timeout: 6000 });
  check('student: at the end, "Up next" names the next lesson', /Mon 9 Nov/.test(await page.textContent('#upTitle')));
  await page.screenshot({ path: path.join(shots, '11-watch-up-next.png') });
  await page.waitForFunction(() => window.__watch.state.index === 1, null, { timeout: 8000 });
  check('student: the next lesson starts by itself', await page.locator('#upNext').isHidden());
  check('student: a camera lesson keeps the worksheet with the camera in its corner', await page.evaluate(() => document.getElementById('stage').classList.contains('kind-camera')) && await page.locator('#swapBtn').isVisible());
  await page.waitForFunction(() => document.querySelectorAll('#qRow .qmark').length === 2, null, { timeout: 5000 });
  check('student: the timeline now shows that lesson\'s questions', (await page.$$eval('#qRow .qmark', (els) => els.map((e) => e.textContent))).join('|') === 'Q4|Q5');

  // A chapter in another lesson: that lesson, at that moment.
  await page.click('#lessonList .chap >> text=Q1');
  await page.waitForFunction(() => window.__watch.state.index === 0 && Math.abs(document.getElementById('media').currentTime - 1) < 1.5, null, { timeout: 6000 });
  check('student: a question in another lesson opens that lesson at that question', true);
  // The window recording: the picture is the worksheet already.
  await page.click('#strip .seg:nth-child(3)');
  await page.waitForFunction(() => window.__watch.state.index === 2, null, { timeout: 5000 });
  check('student: a window recording plays on its own, with no page beside it', await page.locator('#pageWrap').isHidden() && /no question marks/.test(await page.textContent('#markNote')));
  check('student: the last lesson has no Next', await page.locator('#nextBtn').isDisabled());
  check('student: the address names the lesson, to share or come back to', /rec=rec-three/.test(await page.evaluate(() => location.search)));
  // Keys: Space pauses, [ ] move between questions.
  await page.click('#prevBtn');
  await page.waitForFunction(() => window.__watch.state.index === 1, null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('#qRow .qmark').length === 2);
  await page.evaluate(() => window.__watch.seekTo(0.5));
  await page.keyboard.press(']');
  await page.waitForFunction(() => Math.abs(document.getElementById('media').currentTime - 2) < 1.2, null, { timeout: 5000 });
  check('student: ] jumps to the next question', true);
  check('student: no foreign file was ever fetched', !fetched.some((u) => /evil\.example/.test(u)));
  check('student: no script errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: path.join(shots, '12-watch-camera-lesson.png') });
  await context.close();
}

/* ---- Where was I: the same device comes back to the same spot ---- */
{
  // First a visit with no worksheet (nothing plays, nothing is saved) to leave the spot behind.
  const { page, context } = await open({ user: student, query: '' });
  await page.waitForSelector('#scrMessage:not([hidden])', { timeout: 10000 });
  await page.evaluate(() => { localStorage.setItem('polymath.watch.ws-b', JSON.stringify({ rec: 'rec-two', t: 12 })); });
  await page.goto(pageUrl + '?ws=ws-b');
  await page.waitForFunction(() => window.__watch && window.__watch.state.index === 1, null, { timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('media').currentTime >= 11, null, { timeout: 8000 });
  check('return visit: it picks up the lesson and the moment this device left off', true);
  await context.close();
}

/* ---- Not released to the class, or not in a class ---- */
{
  const { page, context, errors, fetched } = await open({ user: student, query: '?ws=ws-c' });
  await page.waitForSelector('#scrMessage:not([hidden])', { timeout: 10000 });
  check('a worksheet not released yet: says so, plays nothing', /not reached your class/.test(await page.textContent('#msgTitle')) && !fetched.length);
  check('not released: no script errors', errors.length === 0, errors.join(' | '));
  await context.close();
}
{
  const { page, context } = await open({ user: stranger, query: '?ws=ws-b' });
  await page.waitForSelector('#scrMessage:not([hidden])', { timeout: 10000 });
  check('an account in no class: asked to join first', /not in a class/.test(await page.textContent('#msgTitle')));
  await context.close();
}

/* ---- A phone ---- */
{
  const { page, context, errors } = await open({ user: student, query: '?ws=ws-b&day=' + (() => { const d = new Date(mon9); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })(), width: 390, height: 844 });
  await page.waitForSelector('#scrPlayer:not([hidden])', { timeout: 10000 });
  check('phone: a class day link starts at that day\'s first lesson', await page.evaluate(() => window.__watch.state.index === 1));
  await page.waitForFunction(() => document.querySelectorAll('#qRow .qmark').length === 2, null, { timeout: 8000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('phone: nothing scrolls sideways', overflow <= 0, String(overflow));
  check('phone: the controls fit', await page.evaluate(() => { const r = document.querySelector('.ctl-row').getBoundingClientRect(); return r.right <= window.innerWidth + 1; }));
  await page.screenshot({ path: path.join(shots, '13-watch-phone.png'), fullPage: true });
  check('phone: no script errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

await browser.close();
console.log('Passed ' + checks + ' lesson video player checks.');
