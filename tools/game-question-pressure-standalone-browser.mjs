// Exercise the shipped question controls and defeat paths; only the account/feed boundary is synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const shots=process.env.GAME_SCREENSHOTS||path.join(root,'test-results/question-pressure-standalone');
fs.mkdirSync(shots,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});
let checks=0;
function check(value,label){assert.ok(value,label);checks++;}
function portal(slug){return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,iframe{border:0;margin:0;width:100%;height:100%;display:block}</style><iframe src="/science-${slug}.html"></iframe><script>
let serial=0;window.records=[];
addEventListener('message',e=>{if(e.source!==document.querySelector('iframe').contentWindow)return;records.push(e.data);
if(e.data.type==='SD_REQUEST_QUESTIONS')e.source.postMessage({type:'SD_QUESTIONS',feedPolicyVersion:1,requestId:e.data.requestId,studentKey:'pressure-child',studentLevel:'P4',playsLeft:{legends:40,slayers:40,defenders:40,raiders:40,spire:40},questions:[{id:'pressure-'+(++serial),q:'Which material lets light pass through?',options:['Clear glass','Wood','Brick','Metal'],answer:0,explain:'Clear glass is transparent.',topic:'Light'}]},location.origin);
if(e.data.type==='LEGENDS_REQUEST_META')e.source.postMessage({type:'LEGENDS_META',meta:{inv:[],eq:{},loadout:{},pts:0},gold:0},location.origin);
});</script>`;}
async function setup(slug,mobile=false){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.hostname!=='pressure.test')return route.abort();
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:portal(slug)});
  const file=path.join(root,url.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.abort();
 });
 await page.goto('https://pressure.test/');
 const frame=page.frames().find(f=>f.url().includes('science-'+slug+'.html'));
 await frame.waitForFunction(()=>typeof scienceFeed!=='undefined'&&scienceFeed.context().studentKey==='pressure-child'&&typeof _gPlaysLeft!=='undefined'&&_gPlaysLeft!==null);
 await frame.locator(slug==='defenders'||slug==='spire'?'#introStartBtn':'#startBtn').click();
 await frame.waitForFunction(slug=>G&&(slug==='defenders'?G.running:G.state!=='over'),slug);
 return {slug,context,page,frame,errors};
}
async function ask(t){
 await t.frame.evaluate(async slug=>{
  if(slug==='defenders'){G.enemies=[];G.spawnQueue=[];G.spawning=false;preRound.active=false;}
  else if(slug==='legends'||slug==='slayers'){G.enemies=[];G.eprojs=[];G.spawnT=1000;G.qTimer=0;}
  else if(slug==='raiders'){G.pending=[];G.enemies=[];G.ebullets=[];G.state='question';}
  if(slug==='spire'){
   if(G.state==='question'&&!qState.answered&&scienceFeed.current(qState.current))return;
   await askQuestion();
  } else await openQuestion();
 },t.slug);
 await t.frame.waitForFunction(slug=>qState.current&&!qState.answered&&scienceFeed.current(qState.current)&&document.querySelector(slug==='spire'?'#qOverlay.show':'#questionOverlay.show'),t.slug);
 if(t.slug==='legends'||t.slug==='slayers')await t.frame.evaluate(()=>{qState.lockT=0;});
}
async function snapshot(t){return t.frame.evaluate(slug=>({
 hp:slug==='defenders'?G.lives:G.player.hp,max:slug==='defenders'?DIFFICULTY[G.difficulty].lives:G.player.maxHp,
 streak:G.questionPressure.wrongStreak,state:slug==='defenders'?(G.running?'play':'over'):G.state,
 room:G.room,floor:G.floor,wave:G.wave,answered:slug==='defenders'?G.stats.answered:G.answered,
 feedback:document.querySelector(slug==='defenders'?'#qRewardAmt':slug==='spire'?'#qExplain':'#qReward').textContent,
 }),t.slug);}
async function grade(t,correct){
 await t.frame.locator(t.slug==='spire'?'#qOptions .q-opt':'#qOptions .q-option').nth(correct?0:1).click();
 return snapshot(t);
}
async function continueQuestion(t){
 await t.frame.locator(t.slug==='defenders'?'#qNextBtn':'#qContinueBtn').click();
}
async function refill(t){await t.frame.evaluate(slug=>{
 if(slug==='defenders')G.lives=DIFFICULTY[G.difficulty].lives;
 else {G.player.hp=G.player.maxHp;G.player.shield=10000;G.player.block=10000;G.player.evadeT=50;}
},t.slug);}
async function fresh(t){
 await t.frame.evaluate(slug=>{
  if(slug==='defenders'){resetGame();document.getElementById('introOverlay').classList.add('hide');}
  else if(slug==='legends'||slug==='slayers'){qState.active=false;newGame(chosenClass);hide('overOverlay');hide('questionOverlay');}
  else if(slug==='raiders'){qState.active=false;startRun();}
  else {newRun();hide('overOverlay');hide('qOverlay');startNode();}
 },t.slug);
}
try{
 for(const slug of ['legends','slayers','defenders','raiders','spire']){
  const t=await setup(slug);
  check(await t.frame.locator('.q-pressure-rule').innerText().then(s=>/Five in a row|Five.*row/i.test(s)),slug+': learner sees the rule before grading');
  await ask(t);const invalidBefore=await snapshot(t);
  const invalidAnswered=await t.frame.evaluate(()=>{for(const i of [null,undefined,NaN,-1,99,1.5,'1'])answerQuestion(i);return qState.answered;});
  const invalidAfter=await snapshot(t);
  check(!invalidAnswered&&invalidAfter.hp===invalidBefore.hp&&invalidAfter.streak===invalidBefore.streak&&invalidAfter.answered===invalidBefore.answered,slug+': invalid indices never grade, damage, reward or change the streak');
  // First prove reset semantics with two misses then a correct answer.
  for(let n=1;n<=2;n++){
   await ask(t);await refill(t);const before=await snapshot(t),after=await grade(t,false);
   check(after.streak===n&&after.hp<before.hp,slug+': real wrong answer '+n+' applies pressure');
   const again=await t.frame.evaluate(()=>{answerQuestion(1);return G.questionPressure.wrongStreak;});
   check(again===n,slug+': duplicate answer does not count twice');
   await continueQuestion(t);
  }
  await ask(t);const reset=await grade(t,true);
  check(reset.streak===0&&/streak reset/.test(reset.feedback),slug+': correct answer clears pressure and explains the reset');
  await continueQuestion(t);
  await ask(t);await refill(t);const first=await grade(t,false);
  check(first.streak===1&&first.max-first.hp===Math.ceil(first.max*8/100),slug+': next miss starts again at the first penalty');
  if(slug==='slayers'){
   await continueQuestion(t);
   const saved=await t.frame.evaluate(()=>{saveRun(true);const s=loadSave();G=null;resumeRun();return {saved:s.questionPressure.wrongStreak,restored:G.questionPressure.wrongStreak};});
   check(saved.saved===1&&saved.restored===1,'Slayers: save/resume preserves the same run streak');
  }
  // A new run resets pressure; HP refills and defenses between misses cannot avoid the fifth.
  await fresh(t);check((await snapshot(t)).streak===0,slug+': a fresh run starts without pressure');
  let staleContinue,previousDamage=0;
  for(let n=1;n<=5;n++){
   await ask(t);await refill(t);const before=await snapshot(t),after=await grade(t,false);
   check(after.streak===n,slug+': consecutive miss '+n+' tracked');
   const damage=before.max-after.hp;
   check(damage>previousDamage,slug+': actual health loss grows at miss '+n);previousDamage=damage;
   if(n<5){
    check(after.state!=='over'&&after.hp>0,slug+': full-health run survives miss '+n);
    check(after.feedback.includes(n+'/5')&&/next wrong answer/.test(after.feedback),slug+': feedback warns of the next consequence');
    if(n===1)staleContinue=await t.frame.evaluate(slug=>{window.pressureOldContinue=slug==='defenders'?closeQuestion:document.getElementById('qContinueBtn').onclick;return !!window.pressureOldContinue;},slug);
    await continueQuestion(t);
   } else {
    check(after.state==='over'&&after.hp===0,slug+': fifth wrong ends the run despite full HP and defenses');
    check(await t.frame.locator(slug==='defenders'?'#resultOverlay': '#overOverlay').isVisible(),slug+': normal defeat screen is visible');
    const beforeStale=await snapshot(t);
    await t.frame.evaluate(()=>{if(window.pressureOldContinue)window.pressureOldContinue();answerQuestion(0);});
    const afterStale=await snapshot(t);
    check(afterStale.state==='over'&&afterStale.hp===0&&afterStale.streak===5&&afterStale.room===beforeStale.room&&afterStale.floor===beforeStale.floor&&afterStale.wave===beforeStale.wave,slug+': stale Continue/correct answer cannot revive or advance defeat');
   }
  }
  if(slug==='defenders'){
   await fresh(t);await ask(t);
   await t.frame.evaluate(()=>{preRound.active=true;preRound.done=2;G.questionPressure.wrongStreak=4;G.lives=DIFFICULTY[G.difficulty].lives;timeUpQuestion();timeUpQuestion();closeQuestion();});
   const timeout=await snapshot(t);
   check(timeout.state==='over'&&timeout.hp===0&&timeout.streak===5,'Defenders: lethal timeout counts once and prevents the pre-wave launch');
   check(await t.frame.evaluate(()=>!preRound.active&&!G.waveInProgress&&G.wave===0),'Defenders: failed quiz never starts a wave');
  }
  check(t.errors.length===0,slug+': real page has no JavaScript errors: '+t.errors.join('; '));
  await t.page.screenshot({path:path.join(shots,slug+'-question-defeat.png'),fullPage:true});
  await t.context.close();
 }
 // The longer warning and result messages must remain readable on narrow screens.
 for(const slug of ['legends','defenders','spire']){
  const t=await setup(slug,true);await ask(t);await refill(t);await grade(t,false);
  check(await t.frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),slug+': penalty message does not widen the mobile document');
  await t.page.screenshot({path:path.join(shots,slug+'-question-mobile.png'),fullPage:true});
  check(t.errors.length===0,slug+': mobile page has no JavaScript errors');await t.context.close();
 }
 console.log('Question-pressure standalone browser: '+checks+' checks passed across five games.');
}finally{await browser.close();}
