// Real start controls and portal contexts; Firebase persistence is an in-memory boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const app=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\r\n/g,'\n');
function fn(name){const a=app.indexOf('function '+name+'('),b=app.indexOf('\n}',a)+2;assert.ok(a>=0&&b>a,name);return app.slice(a,b);}
const script=`
import {createGameUsageRecorder,createGameUsageWriter} from '/game-usage.js';
import {aggregateGameInsights,createGameInsightsController} from '/game-insights.js';
import {installPirateRiftPortal} from '/pirate-rift-portal.js';
import {installGrandLinePortal} from '/grand-line-portal.js';
import {createCollection} from '/grand-line-core.js';
let currentUser={uid:'learner',role:'student'},child='one';const _practiceAs=null,db={};
const _isAdmin=()=>currentUser.role==='admin',_scienceFeedKey=()=>currentUser.uid+':'+child,_scienceFeedGameLevel=()=>'P4';
const _hadesAllowed=()=>currentUser.role==='student',_hadesPreviewLevel=()=>'P4';
var _gameUsageRecorder;const boards={learner:{fps:{correct:19},gold:555}},writes=[];
const doc=(db,col,uid)=>({col,uid}),getDoc=async ref=>({exists:()=>!!boards[ref.uid],data:()=>structuredClone(boards[ref.uid]||{})});
const increment=n=>({__add:n}),deleteField=()=>({__remove:true}),serverTimestamp=()=>Date.now();
function merge(a,b){for(const[k,v]of Object.entries(b)){if(v?.__add!=null)a[k]=(a[k]||0)+v.__add;else if(v?.__remove)delete a[k];else if(v&&typeof v==='object')merge(a[k]||=(Array.isArray(v)?[]:{}),v);else a[k]=v;}}
const setDoc=async(ref,patch,options)=>{if(options?.merge!==true)throw Error('Replace write forbidden');writes.push({uid:ref.uid,patch});merge(boards[ref.uid]||={},patch);};
${fn('_scienceFeedGameMessageCurrent')}
${fn('recordGameStart')}
${fn('recordGameStartMessage')}
var _hadesDisplay=null,_hadesBridge=null;
${fn('_hadesResetLearning')}
let serial=0;
addEventListener('message',event=>{const d=event.data;if(d?.type==='SD_REQUEST_QUESTIONS')event.source.postMessage({type:'SD_QUESTIONS',requestId:d.requestId,feedPolicyVersion:1,studentKey:_scienceFeedKey(),studentLevel:'P4',playsLeft:{defenders:50,raiders:50,spire:50,legends:50,slayers:50},questions:[{id:'bank-'+(++serial),q:'Which lets light through?',options:['Clear glass','Wood','Metal','Brick'],answer:0,topic:'Light',explain:'Clear glass is transparent.'}]},location.origin);if(d?.type==='LEGENDS_REQUEST_META')event.source.postMessage({type:'LEGENDS_META',meta:{inv:[],eq:{},loadout:{}},gold:0},location.origin);if(d?.type==='SD_PLAY_START'||d?.type==='HADES_HELLO')recordGameStartMessage(event);});
const rift=installPirateRiftPortal({getUser:()=>currentUser,getProfileKey:()=>child,getLevel:()=>'P4',subject:'science',onRunStarted:id=>recordGameStart('pirate-rift',id)});
const crew=installGrandLinePortal({getUser:()=>currentUser,getProfileKey:()=>child,getLevel:()=>'P4',subject:'Science',isLevel:v=>v==='P4',getSnapshot:async()=>({collection:createCollection(),wallet:{available:true,balance:0,offers:[]}}),getQuestions:async()=>[],onRunStarted:id=>recordGameStart('grand-line',id)});
const count=id=>Object.values(boards.learner.gameUsageDaily||{}).reduce((n,day)=>n+(day[id]?.starts||0),0);
window.usageQA={count,boards,writes,rift,crew,key:_scienceFeedKey,recordGameStartMessage,setUser:role=>{currentUser={uid:'learner',role};},switchChild:()=>{child='two';},showAdmin:async()=>{currentUser={uid:'owner',role:'admin'};const dailySummaries=Object.entries(boards.learner.gameUsageDaily||{}).flatMap(([day,games])=>Object.entries(games).map(([gameId,s])=>({uid:'learner',day,gameId,...s})));const controller=createGameInsightsController({document,getUser:()=>currentUser,isAdmin:_isAdmin,loadRecords:async()=>({dailySummaries,attempts:[],profiles:[]})});await controller.open();return aggregateGameInsights({dailySummaries});}};
usageQA.resetHades=()=>_hadesResetLearning('Profile changed');window.ready=true;`;
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/game-insights.css"><style>html,body{margin:0;font:15px Arial}iframe{width:100%;height:900px;border:0}</style><main id="stage"></main><section id="page-hades" class="active"></section><div id="gameInsightsRoot"></div><script type="module" src="/fixture.js"></script>';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};
try{
 const page=await browser.newPage({viewport:{width:1280,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='usage.test')return route.abort();if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});if(u.pathname==='/hades-stub.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Hades frame boundary</title>'});if(u.pathname==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:script});const file=path.join(root,u.pathname);if(!file.startsWith(root)||!fs.existsSync(file))return route.fulfill({status:404,body:''});let body=fs.readFileSync(file);if(u.pathname==='/grand-line.js')body=body.toString()+'\nwindow.__usageCrew={beginBattle,get battle(){return battle},get session(){return sessionId}};';return route.fulfill({contentType:u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':u.pathname.endsWith('.html')?'text/html':u.pathname.endsWith('.png')?'image/png':u.pathname.endsWith('.webp')?'image/webp':undefined,body});});
 await page.goto('https://usage.test/');await page.waitForFunction(()=>window.ready);
 for(const mode of ['defenders','raiders','spire','legends','slayers']){
  await page.evaluate(mode=>{const f=document.createElement('iframe');f.id=mode+'Frame';f.src='/science-'+mode+'.html';document.querySelector('#stage').replaceChildren(f);},mode);
  const frame=await(await page.locator('#'+mode+'Frame').elementHandle()).contentFrame();
  await frame.waitForFunction(()=>typeof scienceFeed!=='undefined'&&scienceFeed.context().studentKey&&typeof _gPlaysLeft!=='undefined'&&_gPlaysLeft!==null);
  check(await page.evaluate(mode=>usageQA.count(mode),mode)===0,'Opening '+mode+' menu is not a run');
  await frame.locator(mode==='defenders'||mode==='spire'?'#introStartBtn':'#startBtn').click();
  await page.waitForFunction(mode=>usageQA.count(mode)===1,mode);
  check(await page.evaluate(mode=>usageQA.count(mode),mode)===1,'Actual '+mode+' start recorded');
  await frame.evaluate(mode=>parent.postMessage({type:'SD_PLAY_START',mode,studentKey:scienceFeed.context().studentKey,studentLevel:'P4'},location.origin),mode);
  await page.waitForTimeout(30);check(await page.evaluate(mode=>usageQA.count(mode),mode)===1,'Repeated '+mode+' event deduplicated by actual run object');
 }
 await page.evaluate(()=>{document.querySelector('#stage').replaceChildren();const f=document.createElement('iframe');f.id='hadesFrame';f.src='/hades-stub.html';document.querySelector('#stage').append(f);});
 const hades=await(await page.locator('#hadesFrame').elementHandle()).contentFrame();
 await hades.evaluate(()=>parent.postMessage({type:'HADES_HELLO',requestId:'real-start-nonce'},location.origin));await page.waitForFunction(()=>usageQA.count('hades')===1);
 await hades.evaluate(()=>parent.postMessage({type:'HADES_HELLO',requestId:'real-start-nonce'},location.origin));await page.waitForTimeout(30);
 check(await page.evaluate(()=>usageQA.count('hades'))===1,'Hades retry reuses run nonce without another start');
 check(await page.evaluate(()=>usageQA.recordGameStartMessage({origin:location.origin,source:window,data:{type:'HADES_HELLO',requestId:'forged'}}))===false,'Forged Hades source rejected');
 check(await page.evaluate(()=>usageQA.recordGameStartMessage({origin:'https://elsewhere.test',source:document.querySelector('iframe').contentWindow,data:{type:'HADES_HELLO',requestId:'foreign'}}))===false,'Foreign origin rejected');
 check(await page.evaluate(()=>{const old=document.getElementById('hadesFrame').contentWindow;usageQA.resetHades();return old!==document.getElementById('hadesFrame').contentWindow&&usageQA.recordGameStartMessage({origin:location.origin,source:old,data:{type:'HADES_HELLO',requestId:'retired-frame'}})===false;}),'Retired Hades frame cannot publish a delayed start for another profile');
 await page.evaluate(()=>{document.querySelector('#stage').replaceChildren();usageQA.rift.open();});
 const rift=await(await page.locator('.pirate-rift-portal iframe').elementHandle()).contentFrame();await rift.locator('#begin-button').waitFor();
 check(await page.evaluate(()=>usageQA.count('pirate-rift'))===0,'Pirate portal/crew picker is not a run');await rift.locator('#begin-button').click();await page.waitForFunction(()=>usageQA.count('pirate-rift')===1);
 check(await page.evaluate(()=>usageQA.count('pirate-rift'))===1,'Real Pirate start control reaches current portal collector');
 await page.evaluate(()=>{usageQA.rift.close();usageQA.crew.open();});
 const crew=await(await page.locator('.grand-line-stage iframe').elementHandle()).contentFrame();await crew.waitForFunction(()=>window.__usageCrew?.session);
 check(await page.evaluate(()=>usageQA.count('grand-line'))===0,'Grand Line portal/campaign menu is not a run');await crew.evaluate(()=>__usageCrew.beginBattle(1));await page.waitForFunction(()=>usageQA.count('grand-line')===1);
 check(await page.evaluate(()=>usageQA.count('grand-line'))===1,'Real Grand Line beginBattle reaches current portal collector');
 await page.evaluate(()=>usageQA.switchChild());await crew.evaluate(()=>parent.postMessage({type:'CER_GAME_STARTED',game:'grand-line',runId:'stale-child-run'},location.origin));await page.waitForTimeout(30);
 check(await page.evaluate(()=>usageQA.count('grand-line'))===1,'Changed learner invalidates old Grand Line frame start');
 await page.evaluate(()=>{usageQA.crew.close();usageQA.setUser('admin');usageQA.rift.open();});
 const adminRift=await(await page.locator('.pirate-rift-portal iframe').elementHandle()).contentFrame();await adminRift.locator('#begin-button').click();await page.waitForTimeout(30);
 check(await page.evaluate(()=>usageQA.count('pirate-rift'))===1,'Administrator previews do not record starts');
 await page.evaluate(()=>usageQA.rift.close());
 const stats=await page.evaluate(()=>usageQA.showAdmin());
 check(stats.players===1&&stats.rows.filter(r=>r.starts>0).length===8,'Dashboard unions one collected account across eight real game starts');
 check((await page.locator('#gameInsightsRoot').textContent()).includes('historical starts and total playtime are unavailable'),'Dashboard keeps start-only source labels');
 check(await page.evaluate(()=>usageQA.boards.learner.fps.correct===19&&usageQA.boards.learner.gold===555),'Nested usage merges preserve old score and wallet fields');
 check(errors.length===0,'No uncaught errors: '+errors.join(';'));
 console.log('Game usage browser: '+checks+' actual launch/context/dashboard checks passed');
}finally{await browser.close();}
