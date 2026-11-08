// Exercise the production async payload function with controlled storage delays.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=source.indexOf('async function _sdQuestionsPayload(source) {');
const end=source.indexOf('\n}',start)+2;
assert.ok(start>=0&&end>start);
const payloadSource=source.slice(start,end);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(){
  const state={key:'child-a',level:'P4',builds:0,claims:0,stats:Promise.resolve({'a-seen':{n:2,correct:1,last:10}}),ready:Promise.resolve(true)};
  const row={id:'question',q:'Which statement is correct?',options:['One','Two'],answer:0};
  const context={console,_scienceFeedKey:()=>state.key,_scienceFeedGameLevel:()=>state.level,
    _sdSeenStats:()=>state.stats,_scienceFeedEnsure:()=>state.ready,_ppGameFrameMatches:()=>false,
    buildDefenderQuestions:()=>{state.builds++;return [row];},_gqFilterPool:rows=>rows,
    _scienceFeedSources:()=>[row],_scienceFeedTake:async rows=>{state.claims++;if(state.claimDelay)await state.claimDelay;return rows;},
    _scienceFeedIsRecycled:()=>false,_scienceFeedGameMessage:()=>'',currentUser:{name:'Learner'},
    _dailyCreditAllowance:()=>10,_playsLeftPayload:()=>({legends:10})};
  vm.createContext(context);vm.runInContext(payloadSource,context);
  return {state,payload:()=>context._sdQuestionsPayload({})};
}
test('a sibling change while history loads never reserves the new learner bank or leaks old stats',async()=>{
  const f=fixture(),loading=deferred();f.state.stats=loading.promise;
  const pending=f.payload();f.state.key='child-b';loading.resolve({'a-only':{n:9,correct:8,last:1}});
  const result=await pending;
  assert.equal(result.studentKey,'child-b');assert.equal(result.questions.length,0);
  assert.deepEqual(Object.keys(result.seenStats),[]);assert.deepEqual(Array.from(result.seenIds),[]);
  assert.equal(f.state.builds,0);assert.equal(f.state.claims,0);
});
test('a level change while the ledger opens also discards history and avoids a claim',async()=>{
  const f=fixture(),loading=deferred();f.state.ready=loading.promise;
  const pending=f.payload();await Promise.resolve();f.state.level='P3';loading.resolve(true);
  const result=await pending;
  assert.equal(result.studentLevel,'P3');assert.equal(result.questions.length,0);
  assert.deepEqual(Object.keys(result.seenStats),[]);assert.equal(f.state.claims,0);
});
test('a change during question reservation withdraws both the pool and previous learner metadata',async()=>{
  const f=fixture(),loading=deferred();f.state.claimDelay=loading.promise;
  const pending=f.payload();while(!f.state.claims)await Promise.resolve();
  f.state.key='child-b';loading.resolve();const result=await pending;
  assert.equal(result.questions.length,0);assert.deepEqual(Object.keys(result.seenStats),[]);
});
test('an unchanged learner receives the live selected question and its own history',async()=>{
  const f=fixture(),result=await f.payload();
  assert.equal(result.questions[0].id,'question');assert.equal(result.seenStats['a-seen'].n,2);
  assert.equal(f.state.claims,1);
});
