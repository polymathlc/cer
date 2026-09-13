import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const runtime=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(/^[A-Za-z]:[\\/]/.test(runtime)?pathToFileURL(runtime).href:runtime);
const repo=new URL('../',import.meta.url),shots=pathToFileURL(path.resolve(process.env.GAME_SCREENSHOTS||fileURLToPath(new URL('../../games-qa/defenders-raiders/',import.meta.url)))+path.sep);fs.mkdirSync(shots,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});let checks=0;
const ok=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS '+label);};
async function setup(file,viewport={width:1440,height:1000},mobile=false,options={}){
 const context=await browser.newContext({viewport,hasTouch:mobile,isMobile:mobile});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='school.example')return route.abort();
  if(url.pathname==='/harness')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%;}iframe{border:0;width:100%;height:100%;}</style><iframe src="/${file}"></iframe><script>
window.messages=[];window.pending=[];window.holdReplies=${options.defer?'true':'false'};window.identity={studentKey:'test-p4',studentLevel:'P4'};window.credits={defenders:${options.credits??8},raiders:${options.credits??8}};let serial=0;
addEventListener('message',e=>{messages.push(e.data);if(e.data.type==='SD_PLAY_START'){credits[e.data.mode]=Math.max(0,credits[e.data.mode]-1);e.source.postMessage({type:'SD_PLAYS_LEFT',playsLeft:credits},location.origin);}
if(e.data.type==='SD_REQUEST_QUESTIONS'){let reply={type:'SD_QUESTIONS',feedPolicyVersion:1,requestId:e.data.requestId,...identity,playsLeft:{...credits},questions:[{id:'q-'+(++serial),q:'Which part of a plant absorbs water from soil?',topic:'Plant Systems',d:'easy',options:['Roots','Flowers','Fruits','Leaves'],answer:0,explain:'Roots absorb water from the soil.'}]};if(holdReplies)pending.push(reply);else e.source.postMessage(reply,location.origin);}});
window.changeLearner=(key,level)=>{identity={studentKey:key,studentLevel:level};document.querySelector('iframe').contentWindow.postMessage({type:'SD_FEED_INVALIDATE',...identity},location.origin);};
window.releaseReplies=()=>{holdReplies=false;pending.splice(0).forEach(data=>document.querySelector('iframe').contentWindow.postMessage(data,location.origin));};
</script>`});
  const path=new URL('.'+url.pathname,repo);if(!fs.existsSync(path))return route.abort();return route.fulfill({contentType:url.pathname.endsWith('.html')?'text/html; charset=utf-8':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'application/octet-stream',body:fs.readFileSync(path)});
 });
 await page.goto('https://school.example/harness');const frame=page.frames().find(f=>f.url().includes(file));await frame.waitForFunction(()=>typeof G!=='undefined' && typeof scienceFeed!=='undefined');if(!options.defer)await frame.waitForFunction(()=>scienceFeed.context().studentKey==='test-p4' && _gPlaysLeft!==null);return {page,frame,errors,context};
}
try{
 const d=await setup('science-defenders.html');await d.frame.locator('#introStartBtn').click();await d.frame.waitForFunction(()=>bgReady&&G.running);
 ok(await d.frame.locator('#waveIntel').innerText().then(t=>t.includes('6 Scout Drone')),'Defenders actual wave forecast');
 await d.frame.evaluate(()=>{G.selectedTowerType='cannon';tryPlaceTower(BUILD_PADS[7]);selectPlacedTower(G.towers[0]);});
 await d.frame.locator('[data-target="strong"]').click();ok(await d.frame.evaluate(()=>G.towers[0].targetMode==='strong'),'Defenders priority button controls actual tower');
 const credit=await d.frame.evaluate(()=>_gPlaysLeft);await d.frame.locator('#howBtn').click();await d.frame.locator('#introStartBtn').click();
 ok(await d.frame.evaluate(()=>G.towers.length===1)&&await d.frame.evaluate(()=>_gPlaysLeft)===credit,'Guide returns without destroying tower or charging credit');
 await d.frame.locator('#startWaveBtn').click();
 for(let i=0;i<3;i++){await d.frame.locator('#questionOverlay.show').waitFor();await d.frame.locator('#qOptions .q-option').first().click();await d.frame.locator('#qNextBtn').click();}
 await d.frame.waitForFunction(()=>G.waveInProgress&&G.enemies.length>0);await d.page.waitForTimeout(500);
 await d.frame.locator('#quizBtn').click();await d.frame.locator('#questionOverlay.show').waitFor();
 const before=await d.frame.evaluate(()=>({hp:G.lives,x:G.enemies[0]?.x}));await d.page.waitForTimeout(250);const after=await d.frame.evaluate(()=>({hp:G.lives,x:G.enemies[0]?.x}));ok(JSON.stringify(before)===JSON.stringify(after),'Live wave freezes during science reading');
 await d.frame.locator('#qOptions .q-option').first().click();await d.frame.locator('#qNextBtn').click();
 await d.frame.evaluate(()=>{G.selectedTowerType='cannon';hoverPad=BUILD_PADS[8];});
 await d.page.screenshot({path:fileURLToPath(new URL('defenders-battle.png',shots)),fullPage:true});
 ok(d.errors.length===0,'Defenders browser has no errors');await d.context.close();

 const r=await setup('science-raiders.html',{width:1280,height:900});await r.frame.locator('#startBtn').click();await r.frame.waitForFunction(()=>G&&G.state==='play');
 await r.frame.locator('#aimModeBtn').click();ok(await r.frame.evaluate(()=>raiderAutoAim),'Raiders auto-aim choice');
 await r.frame.locator('#motionToggle').check();ok(await r.frame.evaluate(()=>raiderReducedMotion),'Raiders reduced-motion choice');
 await r.frame.locator('#dashBtn').click();ok(await r.frame.evaluate(()=>G.player.dashCd>0),'Visible dash button activates actual dash');
 await r.page.waitForTimeout(300); await r.page.keyboard.down('d');await r.page.waitForTimeout(100);await r.frame.locator('#pauseBtn').click();await r.page.keyboard.up('d');
 let pos=await r.frame.evaluate(()=>G.player.x);await r.page.waitForTimeout(150);ok(await r.frame.evaluate(()=>G.player.x)===pos,'Pause freezes Raider position');
 await r.frame.locator('#resumeBtn').click();pos=await r.frame.evaluate(()=>G.player.x);await r.page.waitForTimeout(150);ok(await r.frame.evaluate(()=>G.player.x)===pos,'Resume clears held movement');
 await r.frame.evaluate(()=>{G.pending=[];G.enemies=[];G.ebullets=[];G.player.cd=10;spawnEnemy('turret',G.player.x-180,G.player.y-70,1);var e=G.enemies[0];e.spawnT=0;e.fireCd=.3;G.player.hp=G.player.maxHp;updateEnemyFire(e,.05,Math.atan2(G.player.y-e.y,G.player.x-e.x),193);render();});
 ok(await r.frame.evaluate(()=>G.enemies[0].aimLock!=null && G.ebullets.length===0),'Raiders visible warning precedes the actual shot');
 await r.page.screenshot({path:fileURLToPath(new URL('raiders-battle.png',shots)),fullPage:true});
 await r.frame.evaluate(()=>{G.enemies=[];G.pending=[];G.ebullets=[];onRoomCleared();});await r.frame.locator('#questionOverlay.show').waitFor();await r.frame.locator('#qOptions .q-option').first().click();await r.frame.locator('#qContinueBtn').click();await r.frame.locator('#upgradeOverlay.show').waitFor();
 ok(await r.frame.locator('#upgradeCards').innerText().then(t=>t.length>10),'Raiders correct answer reaches actual upgrade choice');
 await r.page.screenshot({path:fileURLToPath(new URL('raiders-upgrade.png',shots)),fullPage:true});
 ok(r.errors.length===0,'Raiders browser has no errors');await r.context.close();
 const m=await setup('science-raiders.html',{width:390,height:844},true);await m.frame.locator('#startBtn').click();
 await m.page.screenshot({path:fileURLToPath(new URL('raiders-mobile.png',shots)),fullPage:true});
 const bounds=await m.frame.locator('#dashBtn').boundingBox();ok(bounds.width>=100,'Mobile dash target is comfortably sized');
 ok(m.errors.length===0,'Mobile Raiders browser has no errors');await m.context.close();

 // Independent review: a stale response must not bypass the bridge through metadata.
 for(const file of ['science-defenders.html','science-raiders.html']){
  const t=await setup(file,{width:1120,height:860});const def=file.includes('defenders'),start=def?'#introStartBtn':'#startBtn';
  await t.frame.locator(start).click();await t.frame.waitForFunction(()=>_gPlaysLeft===7);
  await t.page.waitForFunction(()=>messages.some(m=>m.type==='SD_PLAY_START'));
  ok(await t.page.evaluate(()=>messages.find(m=>m.type==='SD_PLAY_START').studentKey==='test-p4' && messages.find(m=>m.type==='SD_PLAY_START').studentLevel==='P4'),file+' start is stamped with its accepted learner');
  await t.frame.evaluate(()=>reportScore());await t.page.waitForFunction(()=>messages.some(m=>m.type==='SD_SCORE'));
  ok(await t.page.evaluate(()=>messages.filter(m=>m.type==='SD_SCORE').at(-1).studentKey==='test-p4' && messages.filter(m=>m.type==='SD_SCORE').at(-1).studentLevel==='P4'),file+' score is stamped with its run learner');
  const before=await t.frame.evaluate(()=>({credits:_gPlaysLeft,key:studentKey,seen:Object.keys(student.seen)}));
  await t.page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'SD_QUESTIONS',requestId:'obsolete-request',feedPolicyVersion:1,...identity,playsLeft:{defenders:999,raiders:999},seenIds:['stale-row'],questions:[]},location.origin));
  await t.page.waitForTimeout(50);
  ok(JSON.stringify(await t.frame.evaluate(()=>({credits:_gPlaysLeft,key:studentKey,seen:Object.keys(student.seen)})))===JSON.stringify(before),file+' rejects stale response metadata and credit restoration');
  await t.frame.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://untrusted.example',source:parent,data:{type:'SD_PLAYS_LEFT',playsLeft:{defenders:999,raiders:999}}})));
  ok(await t.frame.evaluate(()=>_gPlaysLeft)===7,file+' rejects untrusted play metadata');
  await t.frame.evaluate(()=>openQuestion());await t.frame.locator('#questionOverlay.show').waitFor();
  const recorded=await t.page.evaluate(()=>messages.filter(m=>m.type==='SD_RECORD').length);
  await t.frame.evaluate(()=>scienceFeed.fail(qState.current,'/diagram-unavailable.png'));
  ok(await t.frame.evaluate(()=>!qState.active),file+' withdraws a failed diagram');
  ok(await t.page.evaluate(()=>messages.filter(m=>m.type==='SD_RECORD').length)===recorded,file+' diagram failure gives no right or wrong answer credit');
  ok(await t.frame.evaluate(def?()=>G.running:()=>G!==null),file+' same-child diagram failure preserves the game');
  if(def){
   await t.frame.evaluate(()=>openQuestion());await t.frame.locator('#questionOverlay.show').waitFor();
   const starts=await t.page.evaluate(()=>messages.filter(m=>m.type==='SD_PLAY_START').length);
   await t.frame.evaluate(()=>resetGame());
   ok(await t.frame.evaluate(()=>!qState.active && qState.current===null && G.stats.answered===0),'Defenders retry clears old question and answers');
   await t.frame.evaluate(()=>answerQuestion(0,document.querySelector('#qOptions .q-option')));
   ok(await t.frame.evaluate(()=>G.stats.answered===0),'Defenders cannot credit the old question after retry');
   ok(await t.page.evaluate(()=>messages.filter(m=>m.type==='SD_PLAY_START').length)===starts,'Defenders active-run retry keeps its existing credit');
   await t.frame.evaluate(()=>endGame(false));
   const epoch=await t.frame.evaluate(()=>defendersRunEpoch);await t.frame.evaluate(()=>document.getElementById('restartBtn').click());
   ok(await t.frame.evaluate(()=>!G.running && defendersRunEpoch)===epoch,'Defenders finished-run Restart cannot bypass Play Again');
   await t.frame.locator('#resultPlayAgain').click();await t.frame.waitForFunction(()=>_gPlaysLeft===6);
   await t.page.waitForFunction(n=>messages.filter(m=>m.type==='SD_PLAY_START').length===n,starts+1);
   ok(await t.page.evaluate(()=>messages.filter(m=>m.type==='SD_PLAY_START').length)===starts+1,'Defenders finished-run Play Again uses one credit');
  }
  await t.page.evaluate(()=>holdReplies=true);await t.frame.evaluate(()=>{void openQuestion();});await t.page.waitForFunction(()=>pending.length>0);
  const reports=await t.page.evaluate(()=>messages.filter(m=>m.type==='SD_SCORE').length);
  await t.page.evaluate(()=>changeLearner('different-child','P6'));
  await t.frame.waitForFunction(def?()=>!G.running:()=>G===null);
  await t.frame.locator(start).click();ok(await t.frame.evaluate(def?()=>!G.running:()=>G===null),file+' waits for the new learner credit response');
  await t.page.evaluate(()=>releaseReplies());await t.page.waitForTimeout(100);
  ok(await t.frame.evaluate(()=>!qState.active),file+' ignores old async response after child switch');
  ok(await t.page.evaluate(()=>messages.filter(m=>m.type==='SD_SCORE').length)===reports,file+' child retirement does not publish old score');
  await t.frame.locator(start).click();await t.page.waitForTimeout(80);
  await t.page.evaluate(()=>changeLearner('different-child','P4'));await t.frame.waitForFunction(def?()=>!G.running:()=>G===null);
  ok(await t.frame.evaluate(()=>!qState.active),file+' grade change retires the old run');
  await t.page.evaluate(()=>{holdReplies=true;changeLearner('menu-child','P4');});await t.frame.waitForFunction(()=>!_gameCreditsReady());
  await t.frame.locator(start).click();ok(await t.frame.evaluate(def?()=>!G.running:()=>G===null),file+' idle menu cannot reuse another learner credit readiness');
  await t.page.evaluate(()=>releaseReplies());
  ok(t.errors.length===0,file+' adversarial checks have no browser errors');await t.context.close();
 }
 for(const file of ['science-defenders.html','science-raiders.html']){
  const t=await setup(file,{width:1120,height:860},false,{defer:true,credits:0}),def=file.includes('defenders');
  await t.frame.locator(def?'#introStartBtn':'#startBtn').click();
  ok(await t.frame.evaluate(def?()=>!G.running:()=>G===null),file+' cannot start before trusted credits load');
  ok(await t.page.evaluate(()=>messages.filter(m=>m.type==='SD_PLAY_START').length)===0,file+' waiting for credits spends nothing');
  await t.page.evaluate(()=>releaseReplies());await t.frame.waitForFunction(()=>_gPlaysLeft===0);
  await t.frame.locator(def?'#introStartBtn':'#startBtn').click();
  ok(await t.frame.evaluate(def?()=>!G.running:()=>G===null),file+' zero credits cannot start');
  await t.page.evaluate(()=>{credits={defenders:2,raiders:2};document.querySelector('iframe').contentWindow.postMessage({type:'SD_PLAYS_LEFT',playsLeft:credits},location.origin);});
  await t.frame.waitForFunction(()=>_gPlaysLeft===2);await t.frame.locator(def?'#introStartBtn':'#startBtn').click();
  await t.frame.waitForFunction(()=>_gPlaysLeft===1);
  await t.page.waitForFunction(()=>messages.filter(m=>m.type==='SD_PLAY_START').length===1);
  ok(await t.page.evaluate(()=>messages.filter(m=>m.type==='SD_PLAY_START').length)===1,file+' loaded credits start exactly one run');
  ok(t.errors.length===0,file+' readiness checks have no browser errors');await t.context.close();
 }
 const dm=await setup('science-defenders.html',{width:390,height:844},true);await dm.frame.locator('#introStartBtn').click();
 await dm.frame.evaluate(()=>{G.selectedTowerType='cannon';hoverPad=BUILD_PADS[7];});
 await dm.page.screenshot({path:fileURLToPath(new URL('defenders-mobile.png',shots)),fullPage:true});
 ok(await dm.frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Defenders mobile layout stays inside viewport');
 ok(dm.errors.length===0,'Defenders mobile has no browser errors');await dm.context.close();
 console.log(checks+' browser checks passed');
}finally{await browser.close();}
