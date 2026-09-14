// Independent browser appraisal: real game markup, renderers and handlers.
// Account persistence and external services are isolated at the fixture boundary.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>fs.readFileSync(path.join(root,name),'utf8').replace(/\r\n/g,'\n');
const app=read('app.js'),spire=read('science-spire.html'),index=read('index.html');
function section(s,a,b){const start=s.indexOf(a),end=s.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a);return s.slice(start,end);}
async function settledSpireRoom(frame,floor){
 await frame.waitForFunction(expected=>{
  if(!G||G.floor!==expected||scienceFeedOpening)return false;
  if(G.state==='question')return !!document.querySelector('#qOverlay.show')&&!qState.answered&&scienceFeed.current(qState.current);
  return ['combat','rest','pack'].includes(G.state);
 },floor);
 return frame.evaluate(()=>G.state);
}
{
 const module=process.env.PLAYWRIGHT_MODULE||'playwright';
 const{chromium}=await import(/^[A-Za-z]:[\\/]/.test(module)?pathToFileURL(module).href:module);
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1120,height:820}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 const css=[...index.slice(0,index.indexOf('</head>')).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
 const markup=section(index,'    <div class="page" id="page-adventure">','    <!-- ===== PAGE: LEADERBOARD');
 const advSource=section(app,'// ---- Adventure mode (idle side-scrolling','// ---- Static event wiring');
 const fixture=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{display:block;padding:18px;background:#e9eef5}.page{display:block!important}.page-body{padding:0!important}.page-header{padding:0 0 16px}.mobile-toggle{display:none!important}.subtitle{max-width:880px}.adv-card{max-width:980px;margin:auto}</style></head><body>${markup}<script>
 window.facts={credits:3,payouts:[],saves:0};
 const $=id=>document.getElementById(id);let currentUser={uid:'fixture',name:'Explorer'},learnerKey='child',learnerLevel='P4';
 let rpgState={equipment:{weapon:'wood_sword',pet:'loyal_pup'},stats:{},dungeonFloor:1};
 const _scienceFeedKey=()=>learnerKey,_scienceFeedLevel=()=>learnerLevel;
 const RPG_CLASSES={},RPG_ITEMS_BY_ID={},RPG_ELEMENTS={},RPG_ELITE_AFFIXES={},RPG_COUNTERS={},RPG_RANGED_ENEMIES=new Set();
 const _creditsLeft=()=>facts.credits,rpgCanPreview=()=>false,_spendCredit=()=>{if(facts.credits<=0)throw Error('No credits');facts.credits--;};
 const rpgPlayerStats=()=>({maxHp:600,atk:10,def:1,crit:0,cdr:0}),rpgPetSkillMult=()=>1,rpgClassActives=()=>[];
 const rpgRandomEnemy=tier=>({id:'slime',name:'Crystal Sentinel',maxHp:240,atk:35,emoji:'🗿',tier,gold:2,xp:1,flavor:'The vault awakens'});
 const rpgAvatarSvg=()=>'<svg viewBox="0 0 120 150"><path d="M25 80L10 140H110L95 80Z" fill="#286f94"/><path d="M30 84h60l-6 42H36Z" fill="#70cdd2"/><circle cx="60" cy="50" r="28" fill="#e8bd91"/><path d="M26 43L60 2l34 41Z" fill="#4766a6"/><path d="M96 80l16-45" stroke="#f5d889" stroke-width="8"/><circle cx="53" cy="49" r="3"/><circle cx="72" cy="49" r="3"/></svg>';
 const escapeHtml=s=>String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;'),toast=()=>{},navigateTo=()=>{},rpgWeaponElement=()=>'',rpgElColor=()=> '#88ccff';
 const rpgLevelInfo=()=>({level:1}),rpgKillTier=()=>0,rpgPetBonusGold=()=>0,rpgPetBonusXp=()=>0,rpgDropChance=()=>0;
 const rpgCreditKill=()=>{},rpgApplyRewards=(gold,xp)=>{facts.payouts.push({gold,xp});return {levelsGained:0,newLevel:1};},rpgSave=()=>facts.saves++,rpgPublishLeaderboard=()=>{};
 ${advSource}
 window.fixture={start(){rpgRenderAdventure();advStart();adv.manualSkills=true;adv.heroNextAtk=advNow()+100000;adv.foes.forEach((f,i)=>{f.wx=300+i*110;f.nextAtk=advNow()+700;f.reached=true;});advUpdateTactics();},snapshot:()=>({hp:adv?.heroHp,paused:adv?.paused,manual:adv?.manualSkills,guard:adv?.guardUntil,now:advNow(),foeHp:adv?.foes[0]?.hp,skillAt:adv?.skills[0]?.readyAt}),threat(){adv.foes.forEach((f,i)=>{f.nextAtk=advNow()+700+i*200;f.reached=true;f.wx=adv.worldX+advHeroScreenX()+95+i*90;});advTick();advUpdateTactics();},realm(n){adv.floor=n;advUpdateTactics();},switchChild(){learnerKey='other';},damage:advGuardDamage};
 Object.assign(window.fixture,{
   armBasic(){adv.heroNextAtk=advNow();adv.skills.forEach(s=>s.readyAt=0);this.threat();},
   startArena(){advStartArena({name:'Practice rival',level:1,equipment:{weapon:'wood_sword'}});},
   winArena(){advFoeDie(0);},
   endWithEffects(){advProjectile({color:'#77ccff'});advFloat($('advHero'),'Review impact','dmg');advArenaEnd(true);},
   layout(){const i=advFrontFoe();return {stage:$('advStage').getBoundingClientRect().toJSON(),hero:advHeroScreenX(),world:adv.worldX,first:i>=0?{wx:adv.foes[i].wx,box:advFoeEl(i).getBoundingClientRect().toJSON()}:null};}
 });
 </script></body></html>`;
 const parent=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe src="/science-spire.html"></iframe><script>
 window.hold=new URLSearchParams(location.search).has('hold');window.noCredits=new URLSearchParams(location.search).has('noCredits');window.feedKey='child';window.feedLevel='P4';window.pending=[];window.messages=[];window.feedCredits=3;
 window.questionRows=new URLSearchParams(location.search).has('questions')?Array.from({length:10},(_,i)=>({id:'eligible-p4-'+i,q:'Suitable P4 question '+(i+1),options:['Correct choice','Other choice'],answer:0,topic:'P4 science'})):[];
 // A delayed finite feed exposes the question-loading state, including exhaustion.
 window.feedDelay=new URLSearchParams(location.search).has('questions')?90:0;
 window.reply=e=>{const send=()=>e.source.postMessage({type:'SD_QUESTIONS',feedPolicyVersion:1,requestId:e.data.requestId,studentKey:feedKey,studentLevel:feedLevel,...(noCredits?{}:{playsLeft:{spire:feedCredits}}),questions:questionRows.filter(q=>!messages.some(m=>m.type==='SD_SHOWN'&&m.questionId===q.id))},location.origin);if(feedDelay)setTimeout(send,feedDelay);else send();};
 window.release=()=>{hold=false;pending.splice(0).forEach(reply);};
 addEventListener('message',e=>{messages.push(e.data);if(e.data?.type==='SD_PLAY_START')feedCredits--;if(e.data?.type==='SD_REQUEST_QUESTIONS'){if(hold)pending.push(e);else reply(e);}});
 </script>`;
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!=='http://game.test'){requests.push(u.href);return route.abort();}const body=u.pathname==='/science-spire.html'?spire:['/science-feed-bridge.js','/spire-svg-art.js'].includes(u.pathname)?read(u.pathname.slice(1)):u.pathname==='/adventure'?fixture:parent;return route.fulfill({status:200,contentType:u.pathname.endsWith('.js')?'text/javascript':'text/html',body});});
 const shots=process.env.GAME_SCREENSHOTS||path.join(root,'..','game-upgrade-qa');fs.mkdirSync(shots,{recursive:true});
 try{
  await page.goto('http://game.test/?hold=1');const early=page.frames().find(f=>f.url().endsWith('/science-spire.html'));await early.waitForFunction(()=>typeof scienceFeed!=='undefined');
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'SD_PLAYS_LEFT',playsLeft:{spire:999}},location.origin));await page.waitForTimeout(30);assert.equal(await early.evaluate(()=>_gPlaysLeft),null,'An early unstamped credit broadcast cannot unlock the game');
  await early.locator('#introStartBtn').click();assert.equal(await early.evaluate(()=>G),null,'Loading learner context must not start a stranded run');assert.equal(await page.evaluate(()=>messages.some(m=>m.type==='SD_PLAY_START')),false,'Loading must not charge a credit');
  await page.evaluate(()=>release());await early.waitForFunction(()=>scienceFeed.context().studentKey==='child');await early.locator('#introStartBtn').click();await early.waitForFunction(()=>G?.state==='combat');assert.equal(await page.evaluate(()=>messages.filter(m=>m.type==='SD_PLAY_START').length),1,'Ready start charges exactly once');assert.deepEqual(await page.evaluate(()=>{const m=messages.find(m=>m.type==='SD_PLAY_START');return {key:m.studentKey,level:m.studentLevel};}),{key:'child',level:'P4'},'Start messages identify the run owner');
  await early.evaluate(()=>document.getElementById('introStartBtn').click());assert.equal(await page.evaluate(()=>messages.filter(m=>m.type==='SD_PLAY_START').length),1,'Repeated start cannot replace the paid run');
  await page.goto('http://game.test/?noCredits=1');const noCreditFrame=page.frames().find(f=>f.url().endsWith('/science-spire.html'));await noCreditFrame.waitForFunction(()=>typeof scienceFeed!=='undefined'&&scienceFeed.context().studentKey==='child');await noCreditFrame.locator('#introStartBtn').click();assert.equal(await noCreditFrame.evaluate(()=>G),null,'Learner metadata without a credit balance cannot start a run');
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'SD_PLAYS_LEFT',playsLeft:{spire:999}},location.origin));await page.waitForTimeout(30);assert.equal(await noCreditFrame.evaluate(()=>_gPlaysLeft),null);
  await page.evaluate(()=>{noCredits=false;});await noCreditFrame.evaluate(()=>scienceFeed.refresh());assert.equal(await noCreditFrame.evaluate(()=>_gameCreditsReady()),true);
  await page.evaluate(()=>{hold=true;feedKey='sibling';feedLevel='P6';document.querySelector('iframe').contentWindow.postMessage({type:'SD_FEED_INVALIDATE',studentKey:feedKey,studentLevel:feedLevel},location.origin);});await noCreditFrame.waitForFunction(()=>scienceFeed.context().studentKey==='sibling');
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'SD_PLAYS_LEFT',playsLeft:{spire:999}},location.origin));await noCreditFrame.locator('#introStartBtn').click();assert.equal(await noCreditFrame.evaluate(()=>G),null,'Changing a learner on the menu waits for that learner’s credits');assert.equal(await noCreditFrame.evaluate(()=>_gPlaysLeft),null);await page.evaluate(()=>release());await noCreditFrame.waitForFunction(()=>_gameCreditsReady());await noCreditFrame.locator('#introStartBtn').click();await noCreditFrame.waitForFunction(()=>G?.state==='combat');assert.equal(await page.evaluate(()=>messages.filter(m=>m.type==='SD_PLAY_START').length),1);
  await page.goto('http://game.test/');const frame=page.frames().find(f=>f.url().endsWith('/science-spire.html'));await frame.waitForFunction(()=>typeof scienceFeed!=='undefined'&&scienceFeed.context().studentKey==='child');
  const metadata=await frame.evaluate(()=>({credits:_gPlaysLeft,seen:Object.keys(SEEN_STATS)}));
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'SD_QUESTIONS',feedPolicyVersion:1,requestId:'obsolete',studentKey:'child',studentLevel:'P4',playsLeft:{spire:999},seenStats:{injected:{n:99}},questions:[]},location.origin));await page.waitForTimeout(40);
  assert.deepEqual(await frame.evaluate(()=>({credits:_gPlaysLeft,seen:Object.keys(SEEN_STATS)})),metadata,'Rejected stale bank replies cannot change credit or history metadata');
  await frame.evaluate(()=>{newRun();document.querySelectorAll('.overlay').forEach(e=>e.classList.remove('show'));G.state='combat';G.turn='player';G.pendingRoom={type:'elite'};G.enemies=spawnEnemies('combat');while(G.enemies.length<2)G.enemies.push({...spawnEnemies('elite')[0]});G.enemies.forEach((e,i)=>e.intent={type:'attack',value:i?7:12});G.hand=['poison','defend','adrenal','cleave','bash'];G.player.energy=3;G.player.block=5;render();});
  await frame.locator('.hand .card').first().click();assert.equal(await frame.locator('.target-preview').count(),2);assert.match(await frame.locator('#forecast').innerText(),/14 HP at risk/);await page.screenshot({path:path.join(shots,'spire-target-desktop.png')});
  await frame.locator('.enemy').nth(1).click();assert.equal(await frame.evaluate(()=>G.enemies[1].poison),5);assert.equal(await frame.evaluate(()=>G.player.energy),2);
  await frame.locator('.hand .card').filter({hasText:'Bash'}).focus();await frame.locator('.hand .card').filter({hasText:'Bash'}).press('Enter');assert.equal(await frame.locator('.target-preview').count(),2);await frame.locator('.hand .card').filter({hasText:'Bash'}).press('Escape');assert.equal(await frame.locator('.target-preview').count(),0,'Keyboard target selection can be cancelled');
  await page.setViewportSize({width:390,height:844});await frame.locator('.hand .card').filter({hasText:'Bash'}).click();await page.screenshot({path:path.join(shots,'spire-target-mobile.png')});assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await frame.locator('#cancelTargetBtn').click();
  const turnHp=await frame.evaluate(()=>G.player.hp);await frame.locator('#endTurnBtn').click();await frame.waitForFunction(()=>G.turn==='player'&&!_busy);assert.equal(await frame.evaluate(()=>G.player.hp),turnHp-14,'Displayed forecast matches a complete real enemy turn');assert.equal(await frame.evaluate(()=>G.player.energy),3);
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'SD_FEED_INVALIDATE',studentKey:'child',studentLevel:'P4'},location.origin));assert.equal(await frame.evaluate(()=>G.state),'combat');
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'SD_FEED_INVALIDATE',studentKey:'other',studentLevel:'P6'},location.origin));await frame.waitForFunction(()=>G===null);assert.equal(await frame.locator('#introOverlay.show').count(),1);
  // Exercise a continuous run through two bosses with a finite eligible bank.
  await page.setViewportSize({width:1120,height:820});await page.goto('http://game.test/?questions=1');
  const endless=page.frames().find(f=>f.url().endsWith('/science-spire.html'));await endless.waitForFunction(()=>typeof scienceFeed!=='undefined'&&_gameCreditsReady());
  await endless.locator('#introStartBtn').click();await settledSpireRoom(endless,1);await endless.evaluate(()=>{window.endlessRun=G;window.originalDeck=G.deck;});
  for(let floor=1;floor<=24;floor++){
    const roomState=await settledSpireRoom(endless,floor);
    assert.equal(await endless.evaluate(()=>G.floor),floor);
    if(roomState==='question'){
      await endless.locator('#qOptions .q-opt').first().click();
      await endless.evaluate(()=>answerQuestion(0,document.querySelector('#qOptions .q-opt')));
      await endless.locator('#qContinueBtn').click();
    }
    const state=await endless.evaluate(()=>G.state);
    if(floor===13){
      assert.equal(await endless.evaluate(()=>G.map[0].floor),13);await endless.locator('#mapBtn').click();
      assert.match(await endless.locator('#mapList').innerText(),/13/);assert.match(await endless.locator('#mapList').innerText(),/24/);
      await page.screenshot({path:path.join(shots,'spire-endless-chapter-two-desktop.png')});await endless.locator('#mapClose').click();
    }
    if(state==='combat'){
      assert.equal(await endless.locator('#stage').getAttribute('data-room'),await endless.evaluate(()=>G.map[G.node].type),'Combat keeps its actual boss, elite or ordinary room appearance');
      const before=await endless.evaluate(()=>({hp:G.player.hp,maxHp:G.player.maxHp,gold:G.gold,boss:G.map[G.node].type==='boss'}));
      await endless.evaluate(()=>{G.enemies.forEach(e=>{e.hp=0;e.dead=true;G.kills++;});winCombat();});
      assert.equal(await endless.evaluate(()=>G.state),'reward');
      if(before.boss){
        assert.equal(await endless.evaluate(()=>G.maxFloor),floor);assert.equal(await endless.locator('#overOverlay.show').count(),0);
        assert.ok(await endless.evaluate(()=>G.gold)>=before.gold+50);assert.equal(await endless.evaluate(()=>G.player.hp),Math.min(before.maxHp,before.hp+Math.round(before.maxHp*.3)));
      }
      await endless.locator('#rewardSkip').click();
    }else if(state==='rest')await endless.locator('#restHeal').click();
    else if(state==='pack')await endless.locator('#packButtons button').last().click();
    else assert.fail('Unexpected room state '+state);
    await endless.waitForFunction(f=>G.floor===f+1,floor);
    assert.equal(await endless.evaluate(()=>G.maxFloor),floor);
    assert.equal(await endless.evaluate(()=>G===endlessRun&&G.deck===originalDeck),true);
    assert.equal(await endless.evaluate(()=>G.map.length),12);
  }
  await endless.waitForFunction(()=>G.floor===25&&G.state==='combat');
  assert.equal(await page.evaluate(()=>messages.filter(m=>m.type==='SD_PLAY_START').length),1);assert.equal(await page.evaluate(()=>feedCredits),2);
  const learning=await page.evaluate(()=>({shown:messages.filter(m=>m.type==='SD_SHOWN'),answers:messages.filter(m=>m.type==='SD_RECORD'),scores:messages.filter(m=>m.type==='SD_SCORE')}));
  assert.equal(learning.shown.length,10);assert.equal(new Set(learning.shown.map(m=>m.questionId)).size,10);assert.equal(learning.answers.length,10);
  assert.ok(learning.shown.every(m=>m.studentKey==='child'&&m.studentLevel==='P4'&&m.questionId.startsWith('eligible-p4-')));
  assert.equal(await endless.evaluate(()=>G.questionBonus),0,'Exhausting suitable questions permits combat without stale bonuses or fallback repeats');
  assert.equal(learning.scores.at(-1).label,'Floor 24');assert.ok(learning.scores.every((m,i)=>!i||m.score>learning.scores[i-1].score),'Room checkpoints advance the best score without duplicate payouts');
  await page.setViewportSize({width:390,height:844});await endless.locator('#mapBtn').click();assert.match(await endless.locator('#mapList').innerText(),/25/);assert.match(await endless.locator('#mapList').innerText(),/36/);
  assert.equal(await endless.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(shots,'spire-endless-chapter-three-mobile.png')});await endless.locator('#mapClose').click();
  // Deliberately end while a question reply is pending; it cannot reopen play.
  await page.evaluate(()=>{hold=true;});await endless.evaluate(()=>{G.pendingRoom=G.map[G.node];void askQuestion();});
  await page.waitForFunction(()=>pending.length>0);const endingScore=await endless.evaluate(()=>score());
  await endless.evaluate(()=>{window.finishedQuestionReply=scienceFeed.refresh();});
  page.once('dialog',dialog=>dialog.accept());await endless.locator('#restartBtn').click();await endless.waitForFunction(()=>G.state==='over');
  await page.evaluate(()=>release());await endless.evaluate(()=>finishedQuestionReply);assert.equal(await endless.evaluate(()=>G.state),'over');assert.equal(await endless.locator('#qOverlay.show').count(),0);
  assert.equal(await endless.locator('#overOverlay.show').count(),1);assert.equal(await page.evaluate(()=>messages.filter(m=>m.type==='SD_SCORE').at(-1).score),endingScore);
  const endedReports=await page.evaluate(()=>messages.filter(m=>m.type==='SD_SCORE').length);await endless.evaluate(()=>{finishRun();gameOver();});assert.equal(await page.evaluate(()=>messages.filter(m=>m.type==='SD_SCORE').length),endedReports);
  await endless.locator('#againBtn').click();await endless.waitForFunction(()=>G.state==='combat');assert.equal(await page.evaluate(()=>messages.filter(m=>m.type==='SD_PLAY_START').length),2);assert.equal(await page.evaluate(()=>feedCredits),1);
  await endless.evaluate(()=>damagePlayer(G.player.hp+G.player.block));await endless.waitForFunction(()=>G.state==='over');assert.match(await endless.locator('#overTitle').innerText(),/Defeated/);
  await page.evaluate(()=>{questionRows=[{id:'eligible-p4-final',q:'One fresh P4 question',options:['Correct choice','Other choice'],answer:0,topic:'P4 science'}];});
  await endless.locator('#againBtn').click();await endless.waitForFunction(()=>G.state==='question'&&qState.current?.id==='eligible-p4-final');
  await endless.evaluate(()=>{window.oldAnswer=document.querySelector('#qOptions .q-opt').onclick;});await endless.locator('#qOptions .q-opt').first().click();
  await endless.evaluate(()=>{window.oldContinue=document.getElementById('qContinueBtn').onclick;});
  await page.waitForFunction(()=>messages.some(m=>m.type==='SD_RECORD'&&m.questionId==='eligible-p4-final'));
  const answerCount=await page.evaluate(()=>messages.filter(m=>m.type==='SD_RECORD').length);page.once('dialog',dialog=>dialog.accept());await endless.locator('#qOverlay').getByRole('button',{name:'End climb',exact:true}).click();
  await endless.evaluate(()=>{oldAnswer();oldContinue();});assert.equal(await endless.evaluate(()=>G.state),'over');assert.equal(await endless.locator('#qOverlay.show').count(),0);assert.equal(await page.evaluate(()=>messages.filter(m=>m.type==='SD_RECORD').length),answerCount);
  await page.screenshot({path:path.join(shots,'spire-ended-mobile.png')});assert.equal(await endless.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.setViewportSize({width:1120,height:820});await page.goto('http://game.test/adventure');await page.evaluate(()=>fixture.start());assert.equal(await page.evaluate(()=>facts.credits),2,'Adventure spends the existing one-credit price');await page.evaluate(()=>advStart());assert.equal(await page.evaluate(()=>facts.credits),2,'Duplicate start leaves the current run alone');await page.evaluate(()=>fixture.threat());await page.waitForTimeout(250);await page.locator('#advPauseBtn').click();const before=await page.evaluate(()=>fixture.snapshot());await page.waitForTimeout(1600);const after=await page.evaluate(()=>fixture.snapshot());assert.equal(after.hp,before.hp);assert.equal(after.now,before.now);assert.equal(after.paused,true);await page.screenshot({path:path.join(shots,'adventure-paused-desktop.png')});
  await page.locator('#advPauseBtn').click();await page.locator('#advGuardBtn').click();assert.equal(await page.evaluate(()=>fixture.damage(20)),8);await page.locator('[data-adv-skill="0"]').click();assert.ok(await page.evaluate(()=>fixture.snapshot().skillAt>fixture.snapshot().now));await page.waitForTimeout(500);assert.ok(await page.evaluate(()=>fixture.snapshot().foeHp<240));
  await page.locator('#advAutoBtn').click();assert.equal(await page.evaluate(()=>fixture.snapshot().manual),false);await page.locator('#advAutoBtn').click();assert.equal(await page.evaluate(()=>fixture.snapshot().manual),true);await page.evaluate(()=>fixture.armBasic());const basicHp=await page.evaluate(()=>fixture.snapshot().foeHp);await page.waitForTimeout(550);assert.equal(await page.evaluate(()=>fixture.snapshot().skillAt),0,'Manual mode does not cast ready skills automatically');assert.ok(await page.evaluate(()=>fixture.snapshot().foeHp)<basicHp,'Manual skills retain the real basic attack');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{fixture.realm(2);fixture.threat();});await page.waitForTimeout(150);await page.screenshot({path:path.join(shots,'adventure-ember-mobile.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  const mobileLayout=await page.evaluate(()=>fixture.layout());assert.ok(mobileLayout.first.box.right<=mobileLayout.stage.right,'The first mobile foe stays inside the stage with a long name');
  await page.evaluate(()=>fixture.switchChild());await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>fixture.snapshot().hp),undefined);assert.deepEqual(await page.evaluate(()=>facts.payouts),[],'Switching learners does not publish the old run rewards');
  await page.evaluate(()=>fixture.startArena());assert.equal(await page.evaluate(()=>facts.credits),2,'Ghost Arena retains free entry');await page.evaluate(()=>fixture.winArena());await page.waitForFunction(()=>fixture.snapshot().hp===undefined);assert.deepEqual(await page.evaluate(()=>facts.payouts),[],'Winning a free Ghost Arena duel pays no currency or XP');
  await page.evaluate(()=>{fixture.startArena();fixture.endWithEffects();});await page.waitForTimeout(650);assert.equal(await page.locator('#advFx > *,#advHero .rpg-float').count(),0,'Ending a run removes in-flight visual effects');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log('Browser passed: Spire delayed profile/credits, stale metadata, learner switching, targeting, complete forecast turn, two endless boss transitions, bounded global maps, one-credit continuation, finite question bank, score checkpoints and ending with a delayed reply; Adventure pause/guard/manual basics, mobile bounds, learner cancellation, free Arena rewards and exit effects; desktop/mobile screenshots.');console.log('Screenshots: '+shots);
 }finally{await browser.close();}
}
