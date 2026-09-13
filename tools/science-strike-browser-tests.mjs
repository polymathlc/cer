// Full production page, renderer and handlers. Only Firebase/network and the
// browser's pointer-lock boundary are simulated; game functions are never stubbed.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

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
export const doc = (_, ...p) => ({path:p.join('/')});
export const collection = (_, ...p) => ({path:p.join('/')});
export const query = (ref, ...filters) => ({...ref,filters});
export const where = (...args) => args;
export const increment = n => ({increment:n});
export const Timestamp = {now:()=>({seconds:Date.now()/1000})};
export async function getDoc(ref){
 const m=window.__mock;
 if(ref.path==='config/admin')return snap({uid:'teacher'});
 if(ref.path==='userProfiles/learner')return snap(m.profile);
 if(ref.path==='users/teacher/settings/topics')return snap({custom:{}});
 if(ref.path==='users/learner/settings/scienceRpg')return snap({credits:{day:'2000-01-01',balance:6}});
 if(ref.path==='scienceGameLeaderboard/learner')return snap({fps:{correct:0,kills:0,bestWave:0}});
 return snap(undefined);
}
export async function getDocs(ref){
 const m=window.__mock;
 if(ref.path==='users/teacher/questions' && m.bankPending)await new Promise(r=>m.releaseBank=r);
 const rows=ref.path==='users/teacher/questions'?m.bank:[];
 return {forEach:fn=>rows.forEach((v,i)=>fn({id:v.id||String(i),data:()=>v}))};
}
export async function setDoc(ref,value,options){window.__mock.writes.push({path:ref.path,value,options});}
export async function addDoc(ref,value){window.__mock.writes.push({path:ref.path,value});return {id:'attempt'};}
export function onSnapshot(ref,callback){window.__mock.profileCallback=callback;return ()=>{window.__mock.profileCallback=null;};}
`;
const auth = `export const getAuth=()=>({}); export class GoogleAuthProvider{}
export function onAuthStateChanged(_,callback){window.__mock.authCallback=callback;setTimeout(()=>callback(null),0);}
export async function signInWithPopup(){return window.__mock.authCallback({uid:'learner',email:'learner@example.test',displayName:'Test Learner'});}`;

async function pageFor({ bankRows = bank, pending = false, lock = 'success', mobile = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage(), errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ bankRows, pending, lock }) => {
    window.__mock = { bank: bankRows, bankPending: pending, writes: [],
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
  }, { bankRows, pending, lock });
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
      const seam = `\nwindow.__strikeQA={get run(){return G;},get ready(){return fpsFeedReady;},get current(){return currentUser;},get cap(){return studentLevelCap;},get credits(){return creditsLeft();},get skills(){return skillsOpen;},get pointer(){return pointerLocked;},get keys(){return keys;},get meta(){return meta;},get rows(){return questions;},get mouse(){return {fire:mouseDown,ads:adsHeld};},get state(){return {run:!!G,paused:G?.paused,over:G?.over,q:G?.activeQ?.id,total:G?.qTotal,correct:G?.qCorrect,ammo:G?.ammo,timer:G?.qTimerMs,x:G?.player.x,y:G?.player.y};},openDraft,answerQuestion};\n`;
      html = html.slice(0, closing) + seam + html.slice(closing);
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    if (/^science-feed-(core|mastery|variety|quality)\.js$/.test(file))
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
} finally {
  await browser.close();
}
console.log(`${assertions} Science Strike browser assertions passed`);
