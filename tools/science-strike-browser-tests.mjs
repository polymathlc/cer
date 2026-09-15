// Full production page, renderer and handlers. Only Firebase/network and the
// browser's pointer-lock boundary are simulated; game functions are never stubbed.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { strikeQuestionQualityOptions } from '../science-strike-feed.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
const root = new URL('../', import.meta.url);
const screens = process.env.SCIENCE_STRIKE_SCREENSHOTS;
if (screens) fs.mkdirSync(screens, { recursive: true });
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };

const question = (id, topic, stem, correct, wrong, extra = {}) => ({
  id, title: 'Question', topic, difficulty: 'easy', blocks: [
    { type: 'text', content: `<p>${stem}</p>` },
    { type: 'mcq', options: [{ id: 'a', text: correct }, { id: 'b', text: wrong }], correctId: 'a' },
    { type: 'explanation', content: `<p>${correct} is supported by the observation.</p>` },
  ], ...extra,
});
const bank = [
  question('roots', 'Plant Systems', 'Which part of a plant absorbs water from the soil?', 'Roots', 'Flowers'),
  question('shadow', 'Light', 'Which material blocks light to form a dark shadow?', 'An opaque wooden board', 'Clear glass'),
  question('heat', 'Heat', 'A metal spoon feels warmer after being placed in hot water. What happened?', 'Heat moved from the water to the spoon', 'Cold moved from the spoon to the water'),
  question('air', 'Matter and its 3 States', 'Why can an empty-looking balloon be inflated?', 'Air occupies space', 'Air has a fixed shape'),
  question('lungs', 'Human Body Systems', 'Which organ takes in oxygen from the air?', 'Lungs', 'Stomach'),
  question('above-year', 'Forces', 'What force slows a sliding block?', 'Friction', 'Magnetism'),
  question('suspect', 'Plant Systems', 'Which part of the plant takes up water?', 'Roots', 'Flowers', { practiceQuarantined: true }),
];

const firestore = `
const snap = value => ({exists:()=>value!==undefined,data:()=>value});
export const getFirestore = () => ({});
export const doc = (base, ...p) => ({path:[base?.path,...p].filter(Boolean).join('/'),kind:'doc'});
export const collection = (base, ...p) => ({path:[base?.path,...p].filter(Boolean).join('/')});
export const query = (ref, ...filters) => ({...ref,filters});
export const where = (...args) => args;
export const increment = n => ({increment:n});
export const Timestamp = {now:()=>({seconds:Date.now()/1000})};
export async function getDoc(ref){
 const m=window.__mock;
 if(ref.path==='config/admin')return snap({uid:'teacher'});
 if(ref.path==='userProfiles/learner')return snap(m.profile);
 if(ref.path==='users/teacher/settings/topics')return snap(m.topics||{custom:{}});
 if(ref.path==='users/teacher/settings/learningObjectives')return snap(m.objectives);
 if(ref.path==='users/learner/settings/scienceRpg')return snap({credits:{day:'2000-01-01',balance:6}});
 if(ref.path==='scienceGameLeaderboard/learner')return snap({fps:{correct:0,kills:0,bestWave:0}});
 return snap(undefined);
}
export async function getDocs(ref){
 const m=window.__mock;
 if(ref.path==='users/teacher/questions' && m.bankPending)await new Promise(r=>m.releaseBank=r);
 if(ref.path.includes('/questionHistory/'))return {forEach:fn=>Object.entries(m.history||{}).filter(([key])=>key.startsWith(ref.path+'/')).forEach(([key,v])=>fn({id:key,data:()=>v}))};
 const rows=ref.path==='users/teacher/questions'?m.bank:ref.path==='questionAttempts'?m.attempts:ref.path==='flaggedQuestions'?m.reports:[];
 return {forEach:fn=>rows.forEach((v,i)=>fn({id:v.id||String(i),data:()=>v}))};
}
export async function runTransaction(db,task){
 const m=window.__mock,history=m.history||=( {} ),writes=[];
 const result=await task({get:async ref=>snap(history[ref.path]),set:(ref,value)=>writes.push([ref.path,value])});
 writes.forEach(([key,value])=>history[key]=value);return result;
}
export async function setDoc(ref,value,options){window.__mock.writes.push({path:ref.path,value,options});}
export async function addDoc(ref,value){window.__mock.writes.push({path:ref.path,value});return {id:'attempt'};}
export function onSnapshot(ref,callback,onError){
 const m=window.__mock,entry={callback,onError,active:true};
 (m.listeners[ref.path]||=([])).push(entry);
 if(ref.path==='userProfiles/learner')m.profileCallback=callback;
 const deliver=async()=>{try{const value=ref.kind==='doc'?await getDoc(ref):await getDocs(ref);if(entry.active)callback(value);}catch(e){if(entry.active)onError?.(e);}};
 entry.deliver=deliver;queueMicrotask(deliver);
 m.emit=async path=>{await Promise.all((m.listeners[path]||[]).filter(e=>e.active).map(e=>e.deliver()));};
 return ()=>{entry.active=false;if(m.profileCallback===callback)m.profileCallback=null;};
}
`;
const auth = `export const getAuth=()=>({}); export class GoogleAuthProvider{}
export function onAuthStateChanged(_,callback){window.__mock.authCallback=callback;setTimeout(()=>callback(null),0);}
export async function signInWithPopup(){return window.__mock.authCallback({uid:'learner',email:'learner@example.test',displayName:'Test Learner'});}`;

async function pageFor({ bankRows = bank, pending = false, lock = 'success', mobile = false, objectives, topics, attempts = [], reports = [] } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage(), errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ bankRows, pending, lock, objectives, topics, attempts, reports }) => {
    window.__mock = { bank: bankRows, bankPending: pending, objectives, topics, attempts, reports, listeners:{}, writes: [],
      profile: { level: 'P4', students: [{ name: 'Test Learner', level: 'P4' }], activeStudent: 0 }, lock };
    if (lock === 'native') return;
    let locked = null;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    document.exitPointerLock = () => { if (locked) { locked = null; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange')), 0); } };
    HTMLCanvasElement.prototype.requestPointerLock = function () {
      if (window.__mock.lock === 'deny') return Promise.reject(new DOMException('Permission denied for test', 'NotAllowedError'));
      locked = this;
      setTimeout(() => document.dispatchEvent(new Event('pointerlockchange')), 0);
      return Promise.resolve();
    };
    if (lock === 'unsupported') HTMLCanvasElement.prototype.requestPointerLock = undefined;
  }, { bankRows, pending, lock, objectives, topics, attempts, reports });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.gstatic.com') {
      const body = url.pathname.endsWith('firebase-app.js') ? 'export const initializeApp=()=>({});'
        : url.pathname.endsWith('firebase-app-check.js') ? 'export const initializeAppCheck=()=>({});export class ReCaptchaV3Provider{}'
          : url.pathname.endsWith('firebase-auth.js') ? auth
            : url.pathname.endsWith('firebase-firestore.js') ? firestore : null;
      if (body) return route.fulfill({ contentType: 'application/javascript', body });
    }
    if (url.hostname !== 'science-strike.test') { external.push(url.href); return route.abort(); }
    const file = url.pathname.slice(1);
    if (file === 'fps.html') {
      let html = fs.readFileSync(new URL(file, root), 'utf8');
      const closing = html.lastIndexOf('</script>');
      // Read-only observation plus scenario setup: the next real animation frame
      // opens the question/draft, and all user actions go through real DOM events.
      const seam = `\nwindow.__strikeQA={get run(){return G;},get ready(){return fpsFeedReady;},candidate:fpsQuestionCandidate,take:nextQuestion,refresh:loadQuestions,clearFeed:fpsFeedClear,get db(){return fpsFeedBank;},get current(){return currentUser;},get cap(){return studentLevelCap;},get credits(){return creditsLeft();},get skills(){return skillsOpen;},get pointer(){return pointerLocked;},get keys(){return keys;},get meta(){return meta;},get rows(){return questions;},get mouse(){return {fire:mouseDown,ads:adsHeld};},get state(){return {run:!!G,paused:G?.paused,over:G?.over,q:G?.activeQ?.id,total:G?.qTotal,correct:G?.qCorrect,ammo:G?.ammo,timer:G?.qTimerMs,x:G?.player.x,y:G?.player.y};},openDraft,answerQuestion};\n`;
      html = html.slice(0, closing) + seam + html.slice(closing);
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    if (/^(?:science-feed-(core|mastery|variety|quality)|science-strike-feed|student-question-history)\.js$/.test(file))
      return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(new URL(file, root), 'utf8') });
    return route.abort();
  });
  await page.goto('https://science-strike.test/fps.html');
  await page.waitForFunction(() => !!window.__strikeQA && !!window.__mock.authCallback);
  await page.locator('#signInBtn').click();
  await page.waitForFunction(() => document.querySelector('#menuScreen').classList.contains('active'));
  if (!pending) await page.waitForFunction(() => window.__strikeQA.ready);
  return { page, context, errors, external };
}
async function shot(page, name) { if (screens) await page.screenshot({ path: path.join(screens, `${name}.png`), fullPage: true }); }
async function seededTake(page, seed, count=1) {
  return page.evaluate(async ({seed,count})=>{
    const original=Math.random;
    Math.random=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let value=Math.imul(seed^seed>>>15,1|seed);
      value=value+Math.imul(value^value>>>7,61|value)^value;return ((value^value>>>14)>>>0)/4294967296;};
    try{const rows=[];for(let i=0;i<count;i++)rows.push((await window.__strikeQA.take())?.id||null);return rows;}
    finally{Math.random=original;}
  },{seed,count});
}
async function checkClean(session) {
  check(session.errors.length === 0, `No uncaught browser errors: ${session.errors.join('; ')}`);
  check(session.external.length === 0, `No real external requests: ${session.external.join('; ')}`);
  const writes = await session.page.evaluate(() => window.__mock.writes);
  check(writes.every(w => w.path === 'scienceGameLeaderboard/learner' && w.options?.merge === true || w.path === 'questionAttempts'), 'Only expected mocked own leaderboard/attempt writes; hero document untouched');
}

try {
  const session = await pageFor(), { page } = session;
  check(await page.locator('#classRow .class-card').count() === 3, 'Three distinct class choices render');
  check(await page.evaluate(() => window.__strikeQA.cap) === 4, 'Synthetic P4 learner keeps P4 school cap');
  await shot(page, '01-menu');
  await page.locator('#menuSettings summary').click();
  await page.locator('#strikeSensitivity0').focus();
  await page.keyboard.press('ArrowRight');
  check(await page.locator('#strikeSensitivity0').inputValue() === '1.1', 'Aim speed range supports keyboard adjustment');
  await page.locator('#menuSettings input[type=checkbox]').check();
  check(await page.evaluate(() => document.body.classList.contains('reduce-motion')), 'Reduced-motion preference applies');
  check(await page.locator('#strikeSensitivity1').inputValue() === '1.1', 'Menu and pause settings stay in sync');
  await page.reload();
  await page.waitForFunction(() => !!window.__strikeQA && !!window.__mock.authCallback);
  await page.locator('#signInBtn').click();
  await page.waitForFunction(() => window.__strikeQA.ready);
  check(await page.locator('#strikeSensitivity0').inputValue() === '1.1', 'Aim sensitivity survives a reload');
  check(await page.evaluate(() => document.body.classList.contains('reduce-motion')), 'Reduced-motion preference survives a reload');
  await page.locator('#menuSkillsBtn').click();
  check(await page.locator('#skillOverlay').evaluate(el => el.classList.contains('active')), 'Skill tree opens from menu');
  await page.locator('#skillCloseBtn').click();
  check(!await page.evaluate(() => window.__strikeQA.skills), 'Skill tree closes from menu');

  await page.locator('#playBtn').click();
  await page.waitForFunction(() => window.__strikeQA.run && !window.__strikeQA.run.paused);
  check(await page.evaluate(() => window.__strikeQA.credits) === 5, 'Starting a run spends one credit');
  check(await page.evaluate(() => window.__strikeQA.run.enemies.length) > 0, 'Real wave spawns enemies');
  check(await page.evaluate(() => window.__strikeQA.pointer), 'Combat starts only with pointer lock');
  await page.evaluate(() => document.dispatchEvent(new Event('pointerlockchange')));
  check(await page.evaluate(() => window.__strikeQA.pointer && !window.__strikeQA.run.paused), 'Duplicate pointer-lock confirmation does not pause a confirmed run');
  for (const viewport of [{ width: 1280, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    check(await page.evaluate(() => {
      const ids = ['qTimer', 'skillBtn', 'hudObjective'];
      const boxes = ids.map(id => document.getElementById(id).getBoundingClientRect());
      return boxes.every((a, i) => a.left >= 0 && a.right <= innerWidth && a.bottom <= innerHeight
        && boxes.slice(i + 1).every(b => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
    }), `Question timer, Skills and objective stay visible without overlap at ${viewport.width}×${viewport.height}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const start = await page.evaluate(() => window.__strikeQA.state);
  await page.keyboard.down('w');
  await page.waitForTimeout(180);
  await page.keyboard.up('w');
  const moved = await page.evaluate(() => window.__strikeQA.state);
  check(start.x !== moved.x || start.y !== moved.y, 'WASD moves the real player');
  await page.mouse.move(640, 450);
  await page.mouse.down();
  await page.waitForTimeout(140);
  await page.mouse.up();
  check(await page.evaluate(() => window.__strikeQA.run.ammo < window.__strikeQA.run.weapon.mag), 'Canvas shooting consumes ammunition');
  await shot(page, '02-combat');

  await page.keyboard.down('w');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('w');
  check(await page.evaluate(() => window.__strikeQA.run.paused), 'Focus loss pauses combat');
  check(await page.evaluate(() => !Object.values(window.__strikeQA.keys).some(Boolean) && !window.__strikeQA.mouse.fire && !window.__strikeQA.mouse.ads), 'Focus loss clears movement, fire and aim');
  const paused = await page.evaluate(() => window.__strikeQA.state);
  await page.waitForTimeout(120);
  check((await page.evaluate(() => window.__strikeQA.state)).timer === paused.timer, 'Question countdown freezes while paused');
  await page.locator('#resumeBtn').click();
  await page.waitForFunction(() => !window.__strikeQA.run.paused);
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => window.__strikeQA.run.paused), 'Escape explicitly pauses combat');
  await page.locator('#resumeBtn').click();
  await page.keyboard.press('i');
  check(await page.evaluate(() => window.__strikeQA.skills && window.__strikeQA.run.paused), 'I opens skill tree and pauses the run');
  await page.keyboard.press('i');
  await page.waitForFunction(() => !window.__strikeQA.skills && !window.__strikeQA.run.paused);

  await page.evaluate(() => { window.__strikeQA.run.qTimerMs = 0; });
  await page.waitForFunction(() => !!window.__strikeQA.run.activeQ);
  const firstId = await page.evaluate(() => window.__strikeQA.run.activeQ.id);
  check(firstId !== 'above-year' && firstId !== 'suspect', 'Question feeding respects P4 and quality restrictions');
  const frozen = await page.evaluate(() => window.__strikeQA.state);
  await page.waitForTimeout(1250);
  check((await page.evaluate(() => window.__strikeQA.state)).x === frozen.x, 'Student is safe while reading the science question');
  await page.keyboard.press('1');
  await page.waitForFunction(() => window.__strikeQA.run.qTotal === 1);
  check(await page.locator('#qFeedback').isVisible(), 'Keyboard answer displays feedback');
  check(await page.locator('#qFeedback .explain').textContent(), 'Question explanation is readable');
  await page.keyboard.press('1');
  await page.evaluate(() => window.__strikeQA.answerQuestion(0, document.querySelector('#qOptions .qopt')));
  check(await page.evaluate(() => window.__strikeQA.run.qTotal) === 1, 'Repeated event/direct handler cannot award a second answer');
  check(await page.evaluate(() => window.__mock.writes.filter(w => w.path === 'questionAttempts').length) === 1, 'Exactly one attempt is logged');
  await shot(page, '03-question-feedback');
  await page.keyboard.press('Tab');
  check(await page.locator('#qContinue').evaluate(el => document.activeElement === el), 'Continue is the next keyboard focus after feedback');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.__strikeQA.run.activeQ && !window.__strikeQA.run.paused);
  await page.evaluate(() => { window.__strikeQA.run.qTimerMs = 0; });
  await page.waitForFunction(() => !!window.__strikeQA.run.activeQ);
  check(await page.evaluate(() => window.__strikeQA.run.activeQ.id) !== firstId, 'Following question does not repeat the previous one');
  await page.waitForTimeout(850);
  await page.keyboard.press('2');
  check(await page.evaluate(() => window.__strikeQA.run.qCorrect === 1 && window.__strikeQA.run.qTotal === 2), 'Wrong answer is recorded correctly without losing earned progress');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.__strikeQA.run.activeQ);
  await page.evaluate(() => window.__strikeQA.openDraft());
  check(await page.locator('#draftOverlay').evaluate(el => el.classList.contains('active')), 'Wave upgrade draft renders');
  await shot(page, '04-wave-upgrade');
  await page.keyboard.press('1');
  await page.waitForFunction(() => !window.__strikeQA.run.draftOpen);
  check(await page.evaluate(() => window.__strikeQA.run.modsTaken.length) === 1, 'Keyboard draft selection applies exactly one upgrade');
  await page.evaluate(() => { window.__strikeQA.run.qTimerMs = 0; });
  await page.waitForFunction(() => !!window.__strikeQA.run.activeQ);
  const staleChoice = await page.locator('#qOptions .qopt').first().elementHandle();
  const beforeSwitch = await page.evaluate(() => window.__mock.writes.length);
  await page.evaluate(() => {
    window.__mock.profile = { level: 'P4', students: [{ name: 'Younger Sibling', level: 'P3' }], activeStudent: 0 };
    window.__mock.profileCallback({ exists: () => true, data: () => window.__mock.profile });
  });
  check(await page.evaluate(() => !window.__strikeQA.run && window.__strikeQA.cap === 3 && window.__strikeQA.current.name === 'Younger Sibling'), 'Changing children retires the old run and applies the younger school cap');
  check(await page.locator('#menuScreen').evaluate(el => el.classList.contains('active')), 'A changed child returns safely to the menu');
  await staleChoice.evaluate(button => button.click());
  check(await page.evaluate(() => window.__mock.writes.length) === beforeSwitch, 'Late old-child answer cannot log attempts or reward the new child');
  await checkClean(session);
  await session.context.close();
  console.log('PASS full-page Science Strike: menu, classes, skills, combat, focus/pause, keyboard answers, feedback, duplicate guard, variety and drafts');

  const denied = await pageFor({ lock: 'deny' });
  await denied.page.locator('#playBtn').click();
  await denied.page.waitForFunction(() => window.__strikeQA.run && document.querySelector('#pauseOverlay').classList.contains('active'));
  check(await denied.page.evaluate(() => window.__strikeQA.run.paused && !window.__strikeQA.pointer), 'Denied pointer lock keeps the run safely paused');
  const deniedTimer = await denied.page.evaluate(() => window.__strikeQA.run.qTimerMs);
  await denied.page.waitForTimeout(140);
  check(await denied.page.evaluate(() => window.__strikeQA.run.qTimerMs) === deniedTimer, 'Denied capture cannot silently advance combat');
  check(/mouse|pointer|capture|browser|permission/i.test(await denied.page.locator('#pauseOverlay').innerText()), 'Denied capture gives an actionable explanation');
  await shot(denied.page, '05-pointer-lock-recovery');
  await denied.page.evaluate(() => { window.__mock.lock = 'success'; });
  await denied.page.locator('#resumeBtn').click();
  await denied.page.waitForFunction(() => window.__strikeQA.pointer && !window.__strikeQA.run.paused);
  check(await denied.page.evaluate(() => window.__strikeQA.credits) === 5, 'Retrying pointer lock resumes the same run without another credit');
  await checkClean(denied);
  await denied.context.close();
  console.log('PASS denied pointer lock: frozen combat, recovery guidance and retry without another charge');

  const pending = await pageFor({ pending: true });
  await pending.page.locator('#playBtn').evaluate(button => button.click());
  check(await pending.page.evaluate(() => !window.__strikeQA.run && window.__strikeQA.credits === 6), 'Loading questions cannot start or charge for a run');
  await pending.page.evaluate(() => { window.__mock.bankPending = false; window.__mock.releaseBank(); });
  await pending.page.waitForFunction(() => window.__strikeQA.ready);
  await pending.page.locator('#playBtn').click();
  await pending.page.waitForFunction(() => window.__strikeQA.run && !window.__strikeQA.run.paused);
  check(await pending.page.evaluate(() => window.__strikeQA.credits) === 5, 'Run becomes available when suitable questions finish loading');
  await checkClean(pending);
  await pending.context.close();

  const empty = await pageFor({ bankRows: [bank.find(q => q.id === 'above-year')] });
  await empty.page.locator('#playBtn').evaluate(button => button.click());
  check(await empty.page.evaluate(() => !window.__strikeQA.run && window.__strikeQA.credits === 6), 'A bank containing only P6 questions cannot charge or start for P4');
  check(/question|practice|level|ready/i.test(await empty.page.locator('#menuScreen').innerText()), 'Empty eligible pool has readable guidance');
  await checkClean(empty);
  await empty.context.close();
  console.log('PASS question readiness: loading and unsuitable-only banks cannot spend a run credit');

  for (const config of [{ lock: 'unsupported' }, { mobile: true }]) {
    const device = await pageFor(config);
    await device.page.locator('#playBtn').evaluate(button => button.click());
    check(await device.page.evaluate(() => !window.__strikeQA.run && window.__strikeQA.credits === 6), 'Unsupported or touch-only device cannot start or spend credit');
    check(/keyboard and mouse|computer/i.test(await device.page.locator('#strikeReadiness').innerText()), 'Unsupported or touch-only device gets clear instructions');
    check(await device.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Menu remains within the viewport');
    if (config.mobile) await shot(device.page, '06-mobile-guidance');
    await checkClean(device);
    await device.context.close();
  }
  console.log('PASS settings and device guidance: persistent comfort settings, unsupported mouse capture, touch-only layout');

  const native = await pageFor({ lock: 'native' });
  await native.page.locator('#playBtn').click();
  await native.page.waitForFunction(() => document.pointerLockElement === document.querySelector('#gameCanvas') && !window.__strikeQA.run.paused, undefined, { timeout: 10000 });
  const nativeBefore = await native.page.evaluate(() => window.__strikeQA.state);
  await native.page.keyboard.down('w');
  await native.page.waitForTimeout(150);
  await native.page.keyboard.up('w');
  const nativeAfter = await native.page.evaluate(() => window.__strikeQA.state);
  check(nativeBefore.x !== nativeAfter.x || nativeBefore.y !== nativeAfter.y, 'Native pointer capture permits real simulation and movement');
  await native.page.keyboard.down('d');
  await native.page.keyboard.press('Shift');
  check(await native.page.evaluate(() => window.__strikeQA.run.dodgeCd > 2), 'Native Shift starts a quickstep and its cooldown');
  await native.page.waitForTimeout(200);
  await native.page.keyboard.up('d');
  const stepped = await native.page.evaluate(() => window.__strikeQA.state);
  check(stepped.x !== nativeAfter.x || stepped.y !== nativeAfter.y, 'Quickstep moves through the real collision-checked simulation');
  check(await native.page.evaluate(() => window.__strikeQA.run.dodgeT === 0), 'Quickstep ends after its brief movement window');
  await native.page.keyboard.press('Escape');
  await native.page.waitForFunction(() => window.__strikeQA.run.paused && !document.pointerLockElement);
  check(await native.page.locator('#pauseOverlay').evaluate(el => el.classList.contains('active')), 'Native Escape safely releases capture and shows pause');
  const pausedDodge = await native.page.evaluate(() => window.__strikeQA.run.dodgeCd);
  await native.page.keyboard.press('Shift');
  await native.page.waitForTimeout(100);
  check(await native.page.evaluate(() => window.__strikeQA.run.dodgeCd) === pausedDodge, 'Paused quickstep cooldown stays frozen and Shift cannot restart it');
  // Browsers impose a short unlock cooldown; the pause remains safe throughout.
  await native.page.waitForTimeout(1300);
  await native.page.locator('#resumeBtn').click();
  await native.page.waitForFunction(() => document.pointerLockElement === document.querySelector('#gameCanvas') && !window.__strikeQA.run.paused, undefined, { timeout: 10000 });
  check(await native.page.evaluate(() => window.__strikeQA.credits) === 5, 'Native Resume restores the same paid run');
  await shot(native.page, '07-native-combat');
  await checkClean(native);
  await native.context.close();
  console.log('PASS native browser pointer lock: captured movement, Escape pause and Resume (no pointer API overrides)');

  // Use the actual database adapters, source collections and live subscriptions.
  const high=question('objective-high','Plant Systems','Choose the statement for the investigation.','A','B');
  const red=question('teacher-red','Plant Systems','Which statement matches the teacher experiment?','C','D');
  red.autoCheck={state:'red',sig:strikeQuestionQualityOptions(red).importSignature};
  const fresh=question('saved-mcq','Plant Systems','Use the fruit labels to choose its dispersal method.','Smell helps animals find it','Wind carries it');
  fresh.title='Fruit dispersal worksheet';
  fresh.blocks.unshift({type:'table',rows:2,cols:2,data:{0:{0:'Fruit colour',1:'Dull green'},1:{0:'Fruit smell',1:'Strong'}}});
  const copied={...fresh,id:'copied-mcq',title:'Renamed worksheet'};
  const written={id:'written-only',title:'Written question',topic:'Plant Systems',blocks:[{type:'text',content:'Explain plant growth.'},{type:'plainanswer',content:'Water supports growth.'}]};
  const malformed={id:'malformed',topic:'Plant Systems',blocks:[null]};
  const available=question('other-saved','Light','Which material casts a clear dark shadow?','Wood','Air');
  const feed=await pageFor({bankRows:[high,red,written,malformed,fresh],objectives:{objectives:[{id:'advanced-lo',level:'P6'}],map:{'advanced-lo':['objective-high']}}});
  check(await feed.page.evaluate(()=>window.__strikeQA.candidate()?.id)==='saved-mcq','Database-only selection skips written/malformed, above-objective and teacher-red questions');
  await feed.page.locator('#playBtn').click();await feed.page.waitForFunction(()=>window.__strikeQA.run&&!window.__strikeQA.run.paused);
  await feed.page.evaluate(()=>{window.__strikeQA.run.qTimerMs=0;});await feed.page.waitForFunction(()=>window.__strikeQA.run.activeQ);
  check(await feed.page.locator('#qSource').innerText()==='Fruit dispersal worksheet','The actual database worksheet title is shown');
  check((await feed.page.locator('#qStem').innerText()).includes('Dull green'),'Saved numeric-key table labels remain visible');
  check(await feed.page.evaluate(()=>window.__strikeQA.run.activeQ.id)==='saved-mcq','The shown MCQ is the selected database document');
  await shot(feed.page,'08-database-mcq');
  await feed.page.evaluate(async()=>{window.__mock.bank=window.__mock.bank.filter(q=>q.id!=='saved-mcq');await window.__mock.emit('users/teacher/questions');});
  check(await feed.page.evaluate(()=>!window.__strikeQA.run.activeQ&&window.__strikeQA.run.paused),'A teacher deletion withdraws the active question safely');
  check(await feed.page.evaluate(()=>window.__mock.writes.filter(w=>w.path==='questionAttempts').length)===0,'Withdrawal does not log a wrong answer');
  await feed.page.evaluate(async({copied,available})=>{window.__mock.bank.push({...copied,variantOf:'saved-mcq'},available);await window.__mock.emit('users/teacher/questions');},{copied,available});
  check(await feed.page.evaluate(()=>window.__strikeQA.candidate()?.id)==='other-saved','A renamed copy cannot follow the original question');
  await feed.page.evaluate(async()=>{window.__mock.attempts=[{questionId:'other-saved',displayName:'Test Learner',score:1,totalBlanks:1,timestamp:{seconds:Date.now()/1000},mode:'practice'}];await window.__mock.emit('questionAttempts');});
  check(await feed.page.evaluate(()=>window.__strikeQA.candidate())===null,'Fresh practice history from the database blocks cross-mode repetition immediately');
  await feed.page.locator('#resumeBtn').click();await feed.page.waitForFunction(()=>!window.__strikeQA.run.paused);await feed.page.evaluate(()=>{window.__strikeQA.run.qTimerMs=0;});
  await feed.page.waitForFunction(()=>window.__strikeQA.run.paused);
  check(/No fresh database MCQs/.test(await feed.page.locator('#pauseReason').innerText()),'Exhausted suitable MCQs pause the game without invented questions');
  check(await feed.page.evaluate(()=>!window.__strikeQA.run.activeQ),'No fallback science question is displayed');
  await checkClean(feed);await feed.context.close();

  const memory=await pageFor({bankRows:[fresh,copied,available]});
  await memory.page.evaluate(()=>{Storage.prototype.getItem=()=>{throw Error('Storage blocked');};Storage.prototype.setItem=()=>{throw Error('Storage blocked');};});
  const selected=await memory.page.evaluate(async()=>[(await window.__strikeQA.take())?.id,(await window.__strikeQA.take())?.id,await window.__strikeQA.take()]);
  const selectedFamilies=selected.slice(0,2).map(id=>['saved-mcq','copied-mcq'].includes(id)?'fruit':id);
  check(new Set(selectedFamilies).size===2&&selectedFamilies.includes('fruit')&&selectedFamilies.includes('other-saved')&&selected[2]===null,'Blocked browser storage cannot cause repeated questions or copies');
  await memory.page.evaluate(()=>{const entries=window.__mock.listeners['questionAttempts'].filter(e=>e.active);entries[0].onError(new Error('test history unavailable'));});
  check(await memory.page.evaluate(()=>!window.__strikeQA.ready&&!window.__strikeQA.candidate()),'A history read failure stops feeding rather than using an unchecked pool');
  await memory.page.evaluate(()=>window.__strikeQA.clearFeed());
  check(await memory.page.evaluate(()=>Object.values(window.__mock.listeners).flat().every(e=>!e.active)),'Signing out or clearing the feed stops all account subscriptions');
  await checkClean(memory);await memory.context.close();
  console.log('PASS database MCQs: authored context, objective/quality restrictions, live edits/history, empty-pool pause, storage failure and subscription cleanup');

  const peers=[
    question('friction','Forces','How does friction affect a trolley moving across the floor?','It slows the trolley','It produces food',{title:'Trolley investigation',level:'P6',difficulty:3}),
    question('spring','Forces','What happens to a spring when a heavy bag is attached?','It becomes longer','It vanishes',{title:'Weighing bag',level:'P6',difficulty:3}),
    question('gravity','Forces','Which force causes a falling marble to move towards the ground?','Gravitational force','Magnetic force',{title:'Falling marble',level:'P6',difficulty:3}),
    question('elastic','Forces','How does stretching an elastic band change its stored energy?','It increases','It disappears',{title:'Elastic band',level:'P6',difficulty:3}),
  ];
  const revision=question('p5-revision','Electrical Systems','Why does the lamp go out when a switch opens?','The circuit is incomplete','The wire becomes transparent',{title:'Open circuit',level:'P5',difficulty:3});
  const basic=question('p3-basic','Magnets','Which material is attracted to a magnet?','Iron','Wood',{title:'Magnetic materials',level:'P3',difficulty:1200});
  const peerIds=new Set(peers.map(q=>q.id)),openers=[],openingSets=[];
  for(const seed of [1,7,19,43,101,509]){
    const variety=await pageFor({bankRows:[basic,revision,...peers]});
    await variety.page.evaluate(async()=>{window.__mock.profile={level:'P6',students:[{name:'Test Learner',level:'P6'}],activeStudent:0};await window.__mock.emit('userProfiles/learner');});
    await variety.page.waitForFunction(()=>window.__strikeQA.ready&&window.__strikeQA.cap===6);
    const sequence=await seededTake(variety.page,seed,peers.length+2);openers.push(sequence[0]);
    openingSets.push(sequence.slice(0,2).sort().join(','));
    check(sequence.slice(0,peers.length).every(id=>peerIds.has(id)),'Random standalone questions stay in the current-grade tier before revision');
    check(new Set(sequence.slice(0,peers.length)).size===peers.length,'Repeated standalone requests visit every suitable peer without repeats');
    check(sequence[peers.length]==='p5-revision'&&sequence[peers.length+1]===null,'P5 revision follows P6 work and randomisation cannot revive P3 fallback');
    await checkClean(variety);await variety.context.close();
  }
  check(new Set(openers).size>1,'Different controlled fresh starts vary the first database MCQ in Science Strike');
  check(new Set(openingSets).size>1,'Short Science Strike sessions vary the chosen set, not just the order of a fixed pair');
  console.log('PASS randomized standalone feed: seeded fresh starts vary, current-grade peers remain distinct and school priority is preserved');

} finally {
  await browser.close();
}
console.log(`${assertions} Science Strike browser assertions passed`);
