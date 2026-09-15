import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHadesLearningController, hadesLearningReward, hadesLearningRewardSummary, validHadesQuestions} from '../hades-learning-parent.js';
import {buildScienceFeedContext,planScienceQuestions} from '../science-feed-core.js';
const question = id => ({id,html:'<p>Compare the labelled diagram '+id+'</p>',options:['A','B','C','D'],answer:1,topic:'Living things'});
function fixture(overrides={}) {
  const messages=[],marked=[],records=[]; let identity='admin:P6',active=true;
  const source={postMessage(message,origin){messages.push({message,origin});}};
  const options={origin:'https://example.test',subject:'Science',getFrame:()=>({contentWindow:source}),
    getIdentity:()=>identity,isAllowed:()=>true,isActive:()=>active,makeSessionId:()=> 'session-1',
    getQuestions:async()=>[1,2,3,4,5].map(n=>question('q'+n)),markShown:q=>marked.push(q.id),recordAnswer:r=>records.push(r),
    presentQuestions:async({questions,grade})=>{for(let i=0;i<5;i++)await grade(i,questions[i].answer,2500);return true;},...overrides};
  const controller=createHadesLearningController(options);
  const send=data=>controller.handleMessage({origin:options.origin,source,data});
  const hello=()=>send({type:'HADES_HELLO',requestId:'hello-1'});
  const round=(n=1,requestId='round-'+n)=>send({type:'HADES_ROUND_REQUEST',requestId,sessionId:'session-1',round:n});
  return {controller,source,messages,marked,records,send,hello,round,setIdentity:v=>{identity=v;},setActive:v=>{active=v;}};
}
test('all six reward outcomes are bounded and deterministic',()=>{
  assert.deepEqual([0,1,2,3,4,5].map(hadesLearningReward),[
    {correct:0,total:5,healPercent:0,boonTier:'fractured'},{correct:1,total:5,healPercent:8,boonTier:'common'},
    {correct:2,total:5,healPercent:16,boonTier:'uncommon'},{correct:3,total:5,healPercent:24,boonTier:'rare'},
    {correct:4,total:5,healPercent:32,boonTier:'epic'},{correct:5,total:5,healPercent:40,boonTier:'heroic'}]);
  for(const n of [-1,6,1.5,'5',NaN])assert.throws(()=>hadesLearningReward(n));
});
test('every completed score sends the matching tier and truthful upgrade summary',async()=>{
  const tiers=['fractured','common','uncommon','rare','epic','heroic'];
  const ranks=[0,1,2,3,5,8];
  for(let score=0;score<=5;score++){
    const f=fixture({presentQuestions:async({questions,grade})=>{
      for(let i=0;i<5;i++)await grade(i,i<score?questions[i].answer:0,2000);
      return true;
    }});
    await f.hello();await f.round();
    const result=f.messages.at(-1).message;
    assert.equal(result.type,'HADES_ROUND_RESULT');assert.equal(result.correct,score);
    assert.equal(result.healPercent,score*8);assert.equal(result.boonTier,tiers[score]);
    assert.equal(f.records.filter(record=>record.correct).length,score);assert.equal(f.records.length,5);
    const summary=hadesLearningRewardSummary(score);
    if(score===0){assert.match(summary,/No healing/);assert.match(summary,/no boon or Pom upgrade/);}
    else {assert.ok(summary.includes('Lv '+ranks[score]));assert.ok(summary.includes('Pom +'+ranks[score]));}
    await f.round(1,'score-retry');assert.equal(f.records.length,5);assert.equal(f.messages.at(-1).message.correct,score);
  }
});
test('only distinct complete MCQs enter a five-question round',()=>{
  const q=question('a');
  assert.equal(validHadesQuestions([q,q,{...q,id:'b',answer:-1},{...q,id:'c',options:['']}]).length,1);
  assert.equal(validHadesQuestions(Array.from({length:10},(_,i)=>question(String(i)))).length,5);
});
test('matching origin, exact iframe, role, request and session are required',async()=>{
  const f=fixture();
  await f.controller.handleMessage({origin:'https://evil.test',source:f.source,data:{type:'HADES_HELLO',requestId:'h'}});
  await f.controller.handleMessage({origin:'https://example.test',source:{},data:{type:'HADES_HELLO',requestId:'h'}});
  await f.send({type:'HADES_HELLO',requestId:'<script>'});assert.equal(f.messages.length,0);
  await f.hello();
  await f.send({type:'HADES_ROUND_REQUEST',requestId:'q',sessionId:'forged',round:1});
  await f.round(2); assert.equal(f.records.length,0);
  f.setActive(false);await f.round();assert.equal(f.records.length,0);
  const denied=fixture({isAllowed:()=>false});await denied.hello();assert.equal(denied.messages.length,0);
});
test('host grades exactly five, hides keys and reserves the whole set',async()=>{
  const f=fixture();await f.hello();await f.round();
  assert.deepEqual(f.marked,['q1','q2','q3','q4','q5']);assert.equal(f.records.length,5);
  assert.ok(f.records.every(r=>r.correct && r.ms===2500 && r.sessionId==='session-1'));
  const result=f.messages.at(-1).message;assert.equal(result.type,'HADES_ROUND_RESULT');assert.equal(result.healPercent,40);
  assert.ok(f.messages.every(r=>r.origin==='https://example.test'));
  assert.equal(JSON.stringify(f.messages).includes('options'),false);assert.equal(JSON.stringify(f.messages).includes('answer'),false);
  assert.equal(f.messages[0].message.profileKey,'science:admin:P6');
});
test('repeat handshake and completed round retry never regrade or duplicate rewards',async()=>{
  const f=fixture();await f.hello();await f.round();await f.hello();await f.round(1,'retry');
  assert.equal(f.records.length,5);assert.equal(f.controller.getState().nextRound,2);
  assert.equal(f.messages.at(-1).message.requestId,'retry');assert.equal(f.messages.at(-1).message.correct,5);
});
test('empty, duplicate or incomplete pools block instead of using filler',async()=>{
  for(const pool of [[],[question('x'),question('x')],[1,2,3,4].map(i=>question(String(i)))]){
    const f=fixture({getQuestions:async()=>pool});await f.hello();await f.round();
    assert.equal(f.messages.at(-1).message.type,'HADES_ROUND_BLOCKED');assert.equal(f.records.length,0);assert.equal(f.marked.length,0);
  }
});
test('concurrent requests, double choice and forged indices cannot add extra answers',async()=>{
  let finish;const f=fixture({presentQuestions:async({grade})=>{
    assert.equal(await grade(4,1,2000),null);
    const first=grade(0,1,2000),duplicate=grade(0,1,2000);await first;assert.equal(await duplicate,null);
    return await new Promise(resolve=>{finish=resolve;});
  }});await f.hello();const running=f.round();await new Promise(resolve=>setTimeout(resolve,0));
  await f.round(1,'duplicate');assert.equal(f.records.length,1);finish(true);await running;
  assert.equal(f.messages.at(-1).message.type,'HADES_ROUND_BLOCKED');
});
test('profile change during bank load invalidates stale work',async()=>{
  let resolve;const f=fixture({getQuestions:()=>new Promise(r=>{resolve=r;})});await f.hello();const running=f.round();
  f.setIdentity('other:P3');resolve([1,2,3,4,5].map(i=>question(String(i))));await running;
  assert.equal(f.records.length,0);assert.equal(f.marked.length,0);assert.equal(f.messages.some(m=>m.message.type==='HADES_ROUND_RESULT'),false);
  await f.hello();assert.equal(f.messages.some(m=>m.message.type==='HADES_INVALIDATE'),true);
});
test('abandonment and image failure grant no transition or reward',async()=>{
  const f=fixture({presentQuestions:async({grade})=>{await grade(0,1,2000);return false;}});await f.hello();await f.round();
  assert.equal(f.records.length,1);assert.equal(f.messages.at(-1).message.type,'HADES_ROUND_BLOCKED');
  assert.equal(f.controller.getState().nextRound,1);
});
test('explicit invalidation retires the old session immediately',async()=>{
  const f=fixture();await f.hello();f.controller.invalidate('Changed grade');await f.round();
  assert.equal(f.messages.at(-1).message.type,'HADES_INVALIDATE');assert.equal(f.records.length,0);assert.equal(f.controller.getState(),null);
});
test('late content/image failures from a retired round cannot affect the new profile',async()=>{
  let callbacks,finish;const failures=[];
  const f=fixture({onImageFailure:(...args)=>failures.push(args),onQuestionUnavailable:(...args)=>failures.push(args),
    presentQuestions:async args=>{callbacks=args;return new Promise(resolve=>{finish=resolve;});}});
  await f.hello();const pending=f.round();await new Promise(resolve=>setTimeout(resolve,0));
  f.controller.invalidate();f.setIdentity('another:P3');
  callbacks.imageFailed(question('q1'),'/late.png');callbacks.questionUnavailable(question('q1'),'unsupported');finish(false);await pending;
  assert.deepEqual(failures,[]);
});
test('CER beta integration uses real bank, explicit level, release and shared safeguards',()=>{
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=app.indexOf('async function _hadesScienceQuestions()'),stop=app.indexOf('function _hadesInit()',start);
  const code=app.slice(start,stop);let captured;
  const rows=Array.from({length:5},(_,i)=>({id:'q'+i,title:'Title '+i}));
  const context=vm.createContext({_isAdmin:()=>true,_hadesAllowed:()=>true,_hadesPreviewLevel:()=> 'P6',_hadesPreviewProfile:()=>({level:'P6'}),
    _hadesUnavailableContent:new Map(),questionQualitySignature:q=>q.id,
    questionBank:[...rows,{id:'pending',status:'pending'},{id:'future'},{id:'retired'}],
    qReleased:q=>q.id!=='future',qInSyllabus:q=>q.id!=='retired',_sdExtractMcq:q=>({...question(q.id)}),
    _scienceFeedTake:async(candidates,options)=>{captured={candidates,options};return candidates;}});
  return vm.runInContext(code+';_hadesScienceQuestions()',context).then(result=>{
    assert.equal(result.length,5);assert.equal(captured.options.profile.level,'P6');assert.equal(captured.options.game,true);assert.equal(captured.options.requireFull,true);
    assert.equal(captured.options.randomize,true);assert.equal(captured.options.onePerFamily,true);assert.equal(captured.options.limit,5);
    assert.match(app,/page === 'hades' && !_hadesAllowed\(\)/);assert.match(app,/ARCADE_GAMES\.filter\(g => !g\.adminOnly \|\| _isAdmin\(\)\)/);
    assert.match(html,/class="nav-item" data-page="hades"/);assert.match(html,/id="hadesFrame"/);
    assert.match(app,/hades-game\.html\?learning=1&subject=science/);
  });
});
test('the actual CER beta adapter prioritizes fresh P6 bank families and rejects P3, above-level and suspect rows',async()=>{
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const start=app.indexOf('async function _hadesScienceQuestions()'),stop=app.indexOf('function _hadesInit()',start);
  const science=(id,level)=>({id,title:'Observe sample '+id,level,topic:'Plants',blocks:[{type:'text',content:'Which plant organ absorbs water for sample '+id+'?'},{type:'mcq',correctId:'b',options:[{id:'a',text:'Flower'},{id:'b',text:'Root'}]}]});
  const bank=[...Array.from({length:8},(_,i)=>science('p6-'+i,'P6')),science('p3','P3'),science('above','S1'),{...science('flagged','P6'),status:'flagged'}, {...science('future','P6'),future:true}];
  const served={'p6-0':Date.now()};
  const context=vm.createContext({_isAdmin:()=>true,_hadesAllowed:()=>true,_hadesPreviewLevel:()=> 'P6',_hadesPreviewProfile:()=>({name:'Preview',level:'P6'}),
    _hadesUnavailableContent:new Map(),questionQualitySignature:q=>q.id,
    questionBank:bank,qReleased:q=>!q.future,qInSyllabus:()=>true,_sdExtractMcq:q=>({...question(q.id)}),
    _scienceFeedContext:()=>buildScienceFeedContext({bank,studentLevel:'P6',served,now:Date.now()}),
    _scienceFeedTake:async(candidates,options)=>planScienceQuestions(candidates,{...options,context:buildScienceFeedContext({bank,studentLevel:'P6',served,now:Date.now()})}).questions});
  const result=await vm.runInContext(app.slice(start,stop)+';_hadesScienceQuestions()',context);
  assert.equal(result.length,5);assert.ok(result.every(q=>q.id.startsWith('p6-') && q.id!=='p6-0'));
});

test('student Hades uses the learner level, shared history and keeps beta access authenticated',async()=>{
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const start=app.indexOf('var _hadesBridge = null;'),stop=app.indexOf('function _hadesInit()',start);
  let options;
  const context=vm.createContext({currentUser:{uid:'student',role:'student',level:'P6'},_isAdmin:()=>false,
    _scienceFeedLevel:()=> 'P6',document:{getElementById:()=>({value:'P3'})},
    questionBank:Array.from({length:5},(_,i)=>({id:'student-'+i})),qReleased:()=>true,qInSyllabus:()=>true,
    questionQualitySignature:q=>q.id,_sdExtractMcq:q=>question(q.id),_scienceFeedContext:(profile,level)=>({profile,level}),
    _scienceFeedTake:async(rows,opts)=>{options=opts;return rows;}});
  vm.runInContext(app.slice(start,stop),context);
  assert.equal(vm.runInContext('_hadesAllowed()',context),true);
  assert.equal(vm.runInContext('_hadesPreviewLevel()',context),'P6','DOM preview cannot change a student level');
  assert.equal(vm.runInContext('_hadesPreviewProfile()',context),undefined,'student history is not a preview profile');
  assert.equal((await vm.runInContext('_hadesScienceQuestions()',context)).length,5);
  assert.equal(options.requireFull,true);assert.equal(options.profile,undefined);
  context.currentUser=null;assert.equal(vm.runInContext('_hadesAllowed()',context),false);
});
