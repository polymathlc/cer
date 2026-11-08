import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createGameUsageRecorder, createGameUsageWriter, expiredGameUsageDays, gameUsageDay, GAME_USAGE_IDS, GAME_USAGE_RETENTION_DAYS } from '../game-usage.js';
import { aggregateGameInsights, GAME_INSIGHTS_CATALOG } from '../game-insights.js';
const at = Date.parse('2026-11-09T00:30:00Z');
function fixture() {
  const writes=[];
  let actor={uid:'student',role:'student',key:'student:child-one'};
  const recorder=createGameUsageRecorder({getActor:()=>actor,now:()=>at,write:event=>{writes.push(event);}});
  return {recorder,writes,setActor:value=>{actor=value;}};
}
test('a real launch records one start without inventing time or completion data',async()=>{
  const f=fixture();assert.equal(await f.recorder.start('legends',{}),true);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].gameId,'legends');assert.equal(f.writes[0].day,'2026-11-09');
  assert.equal('activeMs' in f.writes[0],false);assert.equal('completedRuns' in f.writes[0],false);
});
test('duplicate callbacks for one run are counted once; a genuinely new run counts again',async()=>{
  const f=fixture(),run={};
  assert.equal(await f.recorder.start('spire',run),true);
  assert.equal(await f.recorder.start('spire',run),false);
  assert.equal(await f.recorder.start('spire',{}),true);assert.equal(f.writes.length,2);
});
test('scoped iframe run IDs deduplicate independently by game and learner',async()=>{
  const f=fixture();await f.recorder.start('hades','run-one');await f.recorder.start('hades','run-one');
  await f.recorder.start('grand-line','run-one');
  f.setActor({uid:'student',role:'student',key:'student:child-two'});await f.recorder.start('hades','run-one');
  assert.equal(f.writes.length,3);
});
test('administrator previews, teachers, guests and unknown games never record starts',async()=>{
  const f=fixture();for(const actor of [null,{uid:'a',role:'admin',key:'a'},{uid:'t',role:'teacher',key:'t'},{uid:'s',role:'student',key:'s',admin:true}]){
    f.setActor(actor);assert.equal(await f.recorder.start('legends',{}),false);
  }
  f.setActor({uid:'s',role:'student',key:'s'});assert.equal(await f.recorder.start('unknown',{}),false);
  assert.equal(await f.recorder.start('legends',null),false);assert.equal(f.writes.length,0);
});
test('an account or learner switch before queued recording cancels the write',async()=>{
  const f=fixture(),pending=f.recorder.start('legends',{});
  f.setActor({uid:'other',role:'student',key:'other'});assert.equal(await pending,false);assert.equal(f.writes.length,0);
});
test('write adapters can reject a changed identity after an asynchronous prerequisite',async()=>{
  let actor={uid:'a',role:'student',key:'a'},release,written=false;
  const gate=new Promise(resolve=>{release=resolve;});
  const recorder=createGameUsageRecorder({getActor:()=>actor,now:()=>at,write:async event=>{await gate;if(!event.isCurrent())return false;written=true;}});
  const pending=recorder.start('fps',{});await Promise.resolve();actor={uid:'b',role:'student',key:'b'};release();
  assert.equal(await pending,false);assert.equal(written,false);
});
test('telemetry failures never reject or block the game',async()=>{
  const recorder=createGameUsageRecorder({getActor:()=>({uid:'a',role:'student',key:'a'}),now:()=>at,write:()=>{throw Error('offline');}});
  assert.equal(await recorder.start('pirate-rift',{}),false);
  const unavailable=createGameUsageRecorder({getActor:()=>{throw Error('Retired profile');},write:()=>assert.fail('No write')});
  assert.equal(await unavailable.start('legends',{}),false);
});
test('daily cleanup keeps the full comparison window and only expires old date keys',()=>{
  const daily={'2026-11-09':{},'2026-09-01':{},'2026-01-01':{},garbage:{}};
  assert.deepEqual(expiredGameUsageDays(daily,at),['2026-01-01']);
  assert.equal(gameUsageDay(NaN),'');assert.equal(GAME_USAGE_IDS.length,17);
  assert.equal(gameUsageDay(Date.parse('2026-11-08T17:30:00Z')),'2026-11-09');
  const boundary=gameUsageDay(at-GAME_USAGE_RETENTION_DAYS*86400000),old=gameUsageDay(at-(GAME_USAGE_RETENTION_DAYS+1)*86400000);
  assert.deepEqual(expiredGameUsageDays({[boundary]:{},[old]:{}},at),[old]);
  assert.ok(GAME_USAGE_RETENTION_DAYS>=180&&GAME_USAGE_RETENTION_DAYS<=200,'Retain the90day window plus its90day comparison with bounded buffer');
});
test('writer emits a nested increment patch and never overwrites scores, wallets or other games',async()=>{
  const patches=[];let reads=0;
  const writer=createGameUsageWriter({read:async()=>{reads++;return {fps:{wins:5},gold:800,gameUsageRecordedSince:1,gameUsageDaily:{'2026-01-01':{},'2026-11-09':{fps:{starts:4}}}};},merge:async(uid,patch)=>patches.push(patch),increment:n=>({add:n}),remove:()=>({delete:true}),stamp:()=>123,now:()=>at});
  for(const gameId of ['legends','fps']) await writer({uid:'s',day:'2026-11-09',gameId,isCurrent:()=>true});
  assert.equal(reads,1);assert.deepEqual(patches[0].gameUsageDaily['2026-11-09'],{legends:{starts:{add:1}}});
  assert.deepEqual(patches[0].gameUsageDaily['2026-01-01'],{delete:true});
  assert.equal('fps' in patches[0],false);assert.equal('gold' in patches[0],false);assert.equal('gameUsageRecordedSince' in patches[0],false);
});
test('writer rechecks ownership after reading the old board and stamps new coverage once',async()=>{
  let current=true,release;const gate=new Promise(resolve=>{release=resolve;});let writes=0;
  const writer=createGameUsageWriter({read:()=>gate,merge:()=>{writes++;},increment:n=>n,remove:()=>null,stamp:()=>123,now:()=>at});
  const pending=writer({uid:'s',day:'2026-11-09',gameId:'hades',isCurrent:()=>current});await Promise.resolve();current=false;release({});
  assert.equal(await pending,false);assert.equal(writes,0);
  const patches=[];
  const fresh=createGameUsageWriter({read:async()=>({}),merge:async(uid,patch)=>patches.push(patch),increment:n=>n,remove:()=>null,stamp:()=>123,now:()=>at});
  await fresh({uid:'s',day:'2026-11-09',gameId:'hades',isCurrent:()=>true});assert.equal(patches[0].gameUsageRecordedSince,123);
});

test('all17 canonical launches join the dashboard without touching existing leaderboard fields',async()=>{
 const board={fps:{correct:18},gold:150,td:{best:300}},patches=[];
 function merge(target,patch){for(const[key,value]of Object.entries(patch)){if(value?.add)target[key]=(target[key]||0)+value.add;else if(value?.remove)delete target[key];else if(value&&typeof value==='object')merge(target[key]||={},value);else target[key]=value;}}
 const writer=createGameUsageWriter({read:async()=>structuredClone(board),merge:async(uid,patch)=>{patches.push(patch);merge(board,patch);},increment:n=>({add:n}),remove:()=>({remove:true}),stamp:()=>at,now:()=>at});
 const recorder=createGameUsageRecorder({getActor:()=>({uid:'s',role:'student',key:'s:one'}),write:writer,now:()=>at});
 for(const mode of GAME_USAGE_IDS){const run={};await recorder.start(mode,run);await recorder.start(mode,run);}
 const summaries=Object.entries(board.gameUsageDaily).flatMap(([day,games])=>Object.entries(games).map(([gameId,row])=>({uid:'s',day,gameId,...row})));
 const data=aggregateGameInsights({now:at,dailySummaries:summaries,attempts:[{uid:'s',mode:'legends',timestamp:at,score:1,totalBlanks:1}]});
 assert.equal(patches.length,17);assert.equal(data.players,1);assert.equal(data.measuredGames,17);assert.ok(data.rows.every(r=>r.starts===1));
 assert.deepEqual(board.fps,{correct:18});assert.equal(board.gold,150);assert.deepEqual(board.td,{best:300});
 assert.deepEqual([...GAME_USAGE_IDS].sort(),GAME_INSIGHTS_CATALOG.map(g=>g.id).sort());
});

test('the actual portal start adapter verifies source, origin, learner and game identity',async()=>{
 const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const fn=name=>{const a=app.indexOf('function '+name+'('),b=app.indexOf('\n}',a)+2;assert.ok(a>=0&&b>a);return app.slice(a,b);};
 const nodes=new Map(),writes=[];let actor={uid:'s',role:'student'},key='s:child';
 const c=vm.createContext({currentUser:actor,_practiceAs:null,_gameUsageRecorder:undefined,location:{origin:'https://cer.test'},document:{getElementById:id=>nodes.get(id)},
  _isAdmin:()=>c.currentUser.role==='admin',_scienceFeedKey:()=>key,_scienceFeedGameLevel:()=>'P4',_hadesAllowed:()=>true,_hadesPreviewLevel:()=>'P4',
  createGameUsageRecorder:config=>createGameUsageRecorder({...config,now:()=>at}),createGameUsageWriter:config=>createGameUsageWriter({...config,now:()=>at}),db:{},
  doc:(db,col,uid)=>({col,uid}),getDoc:async()=>({exists:()=>false}),setDoc:async(ref,patch,options)=>writes.push({ref,patch,options}),increment:n=>({add:n}),deleteField:()=>({remove:true}),serverTimestamp:()=>at});
 vm.runInContext(fn('_scienceFeedGameMessageCurrent')+fn('recordGameStart')+fn('recordGameStartMessage'),c);
 for(const mode of ['defenders','raiders','spire','legends','slayers']){
  const source={G:{}};nodes.set(mode+'Frame',{contentWindow:source});
  const event={origin:'https://cer.test',source,data:{type:'SD_PLAY_START',mode,studentKey:key,studentLevel:'P4'}};
  assert.equal(await c.recordGameStartMessage(event),true);assert.equal(await c.recordGameStartMessage(event),false);
  assert.equal(await c.recordGameStartMessage({...event,origin:'https://forged.test'}),false);
  assert.equal(await c.recordGameStartMessage({...event,data:{...event.data,mode:'hades'}}),false);
  assert.equal(await c.recordGameStartMessage({...event,data:{...event.data,studentKey:'old-child'}}),false);
 }
 const source={};nodes.set('hadesFrame',{contentWindow:source,getAttribute:()=>'/hades-game.html'});nodes.set('page-hades',{classList:{contains:()=>true}});
 const hello={origin:'https://cer.test',source,data:{type:'HADES_HELLO',requestId:'start-one'}};
 assert.equal(await c.recordGameStartMessage(hello),true);assert.equal(await c.recordGameStartMessage(hello),false);
 c.currentUser={uid:'a',role:'admin'};assert.equal(await c.recordGameStartMessage({...hello,data:{...hello.data,requestId:'admin-preview'}}),false);
 c.currentUser=actor;c._practiceAs={uid:'s'};assert.equal(await c.recordGameStartMessage({...hello,data:{...hello.data,requestId:'acting-preview'}}),false);
 assert.equal(writes.length,6);assert.ok(writes.every(w=>w.ref.uid==='s'&&w.ref.col==='scienceGameLeaderboard'&&w.options.merge===true));
});
