import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {aggregateGameInsights, GAME_INSIGHTS_CATALOG, gameInsightTime, createGameInsightsController} from '../game-insights.js';
const now=Date.parse('2026-11-09T14:00:00+08:00');
const answer=(uid,mode,at,score=1,extra={})=>({uid,mode,timestamp:at,score,totalBlanks:1,ms:10000,...extra});
test('ranks distinct player accounts before volume and never merges the two Legends games',()=>{
 const data=aggregateGameInsights({now,attempts:[answer('a','legends',now),answer('a','legends',now),answer('b','tcg-legends',now),answer('c','tcg-legends',now)]});
 assert.equal(data.rows[0].id,'tcg-legends');assert.equal(data.rows[0].players,2);
 assert.equal(data.rows.find(r=>r.id==='legends').questions,2);assert.equal(data.players,3);assert.equal(data.rows.length,17);
});
test('retired, admin and employee accounts are excluded and malformed grades are not wrong answers',()=>{
 const data=aggregateGameInsights({now,profiles:[{uid:'admin',role:'admin'},{id:'old',retired:true},{uid:'staff',role:'employee'}],excludedUids:['retired'],attempts:['admin','old','staff','retired','student'].map(uid=>answer(uid,'hades',now)).concat([answer('student','hades',now,null)])});
 const row=data.rows.find(r=>r.id==='hades');assert.equal(row.players,1);assert.equal(row.questions,2);assert.equal(row.graded,1);assert.equal(row.accuracy,1);
});
test('teacher overrides and partial credit match final marks; duplicate IDs do not inflate activity',()=>{
 const a=answer('a','fps',now,0,{id:'one',override:{score:1}}),b=answer('a','fps',now,.5,{id:'two'});
 const row=aggregateGameInsights({now,attempts:[a,a,b]}).rows.find(r=>r.id==='fps');assert.equal(row.questions,2);assert.equal(row.accuracy,.75);
});
test('returning days use Singapore boundaries and trend uses equal previous calendar windows',()=>{
 const data=aggregateGameInsights({now,days:7,attempts:[answer('a','raiders','2026-11-08T15:59:00Z'),answer('a','raiders','2026-11-08T16:01:00Z'),answer('b','raiders','2026-10-29T05:00:00Z')]});
 const row=data.rows.find(r=>r.id==='raiders');assert.equal(row.returners,1);assert.equal(row.previousPlayers,1);assert.equal(row.trend,0);
});
test('start summaries join account sets without inventing playtime, completion or question answers',()=>{
 const data=aggregateGameInsights({now,attempts:[answer('a','legends',now)],dailySummaries:[{uid:'a',day:'2026-11-09',gameId:'legends',starts:2},{uid:'b',day:'2026-11-09',gameId:'pirate-rift',starts:3}]});
 const legend=data.rows.find(r=>r.id==='legends'),pirate=data.rows.find(r=>r.id==='pirate-rift');assert.equal(legend.players,1);assert.equal(legend.starts,2);assert.equal(pirate.players,1);assert.equal(pirate.questions,0);assert.equal(pirate.measuredStarts,true);assert.equal(pirate.measuredTime,false);assert.equal(pirate.measuredCompletions,false);
 assert.equal(data.rows.find(r=>r.id==='ghost-arena').rank,null);
});
test('answer clocks are measured separately and invalid or out-of-window data is ignored',()=>{
 const data=aggregateGameInsights({now,attempts:[answer('a','spire',now,1,{ms:1500}),answer('a','spire',now,0,{ms:0}),answer('a','spire',now,1,{ms:Infinity}),answer('a','spire','2020-01-01'),answer('a','practice',now)],dailySummaries:[{uid:'a',gameId:'pirate-rift',day:'2026-99-99',starts:5}]});
 const row=data.rows.find(r=>r.id==='spire');assert.equal(row.questions,3);assert.equal(row.answerMs,1500);assert.equal(row.timedAnswers,1);assert.equal(row.quickAnswers,1);assert.equal(data.rows.find(r=>r.id==='pirate-rift').players,0);
 assert.equal(gameInsightTime({seconds:10}),10000);assert.equal(gameInsightTime({toMillis:()=>20}),20);
});
test('a capped answer sample does not present a misleading growth percentage',()=>{
 const row=aggregateGameInsights({now,days:7,coverage:{attemptsTruncated:true},attempts:[answer('a','fps',now),answer('b','fps','2026-10-29')]}).rows.find(r=>r.id==='fps');assert.equal(row.trend,null);
});
test('non-admin handler access cannot query, export or retain data',async()=>{
 let reads=0;const host={replaceChildren(){this.cleared=true;}};
 const controller=createGameInsightsController({document:{getElementById:()=>host},isAdmin:()=>false,getUser:()=>({uid:'student'}),loadRecords(){reads++;}});
 assert.equal(await controller.open(),false);assert.equal(controller.exportCsv(),false);assert.equal(reads,0);assert.equal(host.cleared,true);
});
test('a switched account cannot paint a late admin response',async()=>{
 let user={uid:'admin',role:'admin'},finish;const h={innerHTML:'',replaceChildren(){this.innerHTML='';}};
 const controller=createGameInsightsController({document:{getElementById:()=>h},isAdmin:()=>user.role==='admin',getUser:()=>user,loadRecords:()=>new Promise(r=>finish=r)});
 const pending=controller.open();user={uid:'student',role:'student'};finish({attempts:[answer('a','legends',now)]});assert.equal(await pending,false);assert.ok(!h.innerHTML.includes('Science Legends'));assert.equal(controller.exportCsv(),false);
});
test('admin navigation is guarded and all bounded data reads stay behind admin access',()=>{
 const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(app,/page === 'gameinsights' && !_isAdmin\(\)/);assert.match(app,/if \(!_isAdmin\(\)\) \{ _gameInsightsController/);assert.match(app,/limit\(attemptLimit\)/);assert.match(html,/class="nav-item admin-only" data-page="gameinsights"/);assert.equal(new Set(GAME_INSIGHTS_CATALOG.map(g=>g.id)).size,17);
});
test('the production loader enforces access and canonical document identities before exposing summaries',async()=>{
 const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),start=app.indexOf('function loadGameInsights()'),end=app.indexOf('\n}',start)+2;
 let records,reads=0;const snapshot=docs=>({docs:docs.map(([id,value])=>({id,data:()=>value})),size:docs.length});
 const context=vm.createContext({_gameInsightsController:undefined,currentUser:{uid:'admin',role:'admin'},document:{},db:{},console,
  _isAdmin:()=>context.currentUser.role==='admin',
  createGameInsightsController:env=>({reset(){},async open(){records=await env.loadRecords({uid:'admin',since:1,limit:20000});return true;}}),
  collection:(db,name)=>name,query:(...parts)=>parts,where:(...v)=>v,orderBy:(...v)=>v,limit:n=>({limit:n}),Timestamp:{fromMillis:n=>n},doc:()=>null,
  getDocs:async parts=>{reads++;if(parts[0]==='scienceGameLeaderboard')return snapshot([['real-account',{uid:'spoof',gameUsageDaily:{'2026-11-09':{legends:{starts:2,uid:'spoof',gameId:'fps',day:'fake'}}}}]]);return snapshot([]);},
  getDoc:async()=>({exists:()=>false})});
 vm.runInContext(app.slice(start,end),context);assert.equal(await context.loadGameInsights(),true);assert.equal(reads,3);
 assert.equal(records.dailySummaries[0].uid,'real-account');assert.equal(records.dailySummaries[0].gameId,'legends');assert.equal(records.dailySummaries[0].day,'2026-11-09');
 context.currentUser={uid:'student',role:'student'};assert.equal(await context.loadGameInsights(),false);assert.equal(reads,3);
});
