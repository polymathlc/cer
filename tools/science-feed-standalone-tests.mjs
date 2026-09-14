import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildScienceFeedContext,planScienceQuestions} from '../science-feed-core.js';
import {strikeQuestionQualityOptions,strikeAttemptProgress} from '../science-strike-feed.js';
const read = name => fs.readFileSync(new URL('../'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const bridgeSource=read('science-feed-bridge.js'), fps=read('fps.html');
const cut=(source,start,end)=>{const i=source.indexOf(start),j=source.indexOf(end,i+start.length);assert.ok(i>=0&&j>i,start);return source.slice(i,j);};
const row=(id='a')=>({id,q:'A science question '+id,options:['One','Two'],answer:0});
function bridgeFixture(embedded=true){
  const messages=[],pools=[],acceptedEvents=[],listeners=[];let invalidated=0;
  const parent={postMessage:data=>messages.push(data)};
  const window={parent,location:{origin:'https://school.example'},addEventListener:(name,fn)=>listeners.push(fn)};
  if(!embedded)window.parent=window;
  const c=vm.createContext({window,Map,Date,Promise,Number,String,Array,setTimeout,clearTimeout});vm.runInContext(bridgeSource,c);
  const bridge=window.ScienceFeedBridge.create({onPool:(rows,event)=>{pools.push(rows);acceptedEvents.push(event);},onInvalidate:()=>invalidated++});
  const event=(data,extra={})=>{const incoming={data,source:parent,origin:window.location.origin,...extra};listeners.forEach(fn=>fn(incoming));return incoming;};
  const reply=(extra={})=>event({type:'SD_QUESTIONS',feedPolicyVersion:1,requestId:messages.at(-1)?.requestId,studentKey:'child-a',studentLevel:'P4',questions:[row()],...extra});
  return {bridge,messages,pools,acceptedEvents,event,reply,get invalidated(){return invalidated;}};
}
test('standalone game cannot substitute unlevelled built-in samples',async()=>{const f=bridgeFixture(false);assert.equal(await f.bridge.refresh(),false);assert.equal(f.bridge.take(),null);assert.equal(f.messages.length,0);});
test('embedded games await current policy and preserve parent ranking',async()=>{
  const f=bridgeFixture(),pending=f.bridge.refresh();assert.equal(f.bridge.take(),null);
  f.reply({questions:[row('best'),row('second')]});assert.equal(await pending,true);
  assert.equal(f.bridge.take().id,'best');assert.equal(f.bridge.take(),null,'one fresh response per question');
});
test('empty and unknown-level responses clear the previous game bank',async()=>{
  const f=bridgeFixture();let pending=f.bridge.refresh();f.reply();await pending;
  pending=f.bridge.refresh();f.reply({questions:[]});await pending;assert.equal(f.bridge.take(),null);assert.equal(f.pools.at(-1).length,0);
  f.event({type:'SD_FEED_INVALIDATE',studentKey:'child-a',studentLevel:''});
  pending=f.bridge.refresh();f.reply({studentLevel:''});await pending;assert.equal(f.bridge.take(),null);
});
test('untrusted, unversioned and stale request responses cannot feed a question',async()=>{
  const f=bridgeFixture(),pending=f.bridge.refresh();
  f.event({type:'SD_QUESTIONS',questions:[row()]},{origin:'https://other.example'});
  f.reply({feedPolicyVersion:0});f.reply({requestId:'old'});assert.equal(f.bridge.take(),null);
  f.reply();assert.equal(await pending,true);assert.equal(f.bridge.take().id,'a');
});

test('metadata consumers receive only the exact event accepted by the question guards',async()=>{
  const f=bridgeFixture(),pending=f.bridge.refresh();
  assert.equal(f.acceptedEvents.at(-1),undefined,'clearing is not accepted metadata');
  const count=f.acceptedEvents.length;
  f.reply({requestId:'stale',playsLeft:100});
  assert.equal(f.acceptedEvents.length,count);
  const accepted=f.reply({playsLeft:2});await pending;
  assert.equal(f.acceptedEvents.at(-1),accepted);
  f.reply({playsLeft:100});assert.equal(f.acceptedEvents.at(-1),accepted,'duplicate response stays rejected');
  f.event({type:'SD_FEED_INVALIDATE',studentKey:'child-b',studentLevel:'P3'});
  assert.equal(f.acceptedEvents.at(-1),undefined,'learner change retires accepted metadata');
});
test('learner invalidation clears active answers and rejects delayed old-learner pools',async()=>{
  const f=bridgeFixture();let pending=f.bridge.refresh();f.reply();await pending;const old=f.bridge.stamp(f.bridge.take());assert.equal(f.bridge.current(old),true);
  pending=f.bridge.refresh();const oldRequest=f.messages.at(-1).requestId;
  f.event({type:'SD_FEED_INVALIDATE',studentKey:'child-b',studentLevel:'P3'});assert.equal(await pending,false);assert.equal(f.bridge.current(old),false);assert.equal(f.invalidated,1);
  pending=f.bridge.refresh();f.reply({requestId:oldRequest});assert.equal(f.bridge.take(),null);
  f.reply({studentKey:'child-b',studentLevel:'P3',questions:[row('b')]});await pending;assert.equal(f.bridge.take().id,'b');
});
test('a stale repeated parent ID cannot immediately cycle in a child game',async()=>{
  const f=bridgeFixture();let pending=f.bridge.refresh();f.reply();await pending;assert.equal(f.bridge.take().id,'a');
  pending=f.bridge.refresh();f.reply();await pending;assert.equal(f.bridge.take(),null);
});
test('an observed diagram failure withdraws the question without recording a wrong answer',async()=>{
  const f=bridgeFixture(),pending=f.bridge.refresh();f.reply();await pending;const q=f.bridge.stamp(f.bridge.take());
  f.bridge.fail(q,'https://school.example/missing.png');assert.equal(f.bridge.current(q),false);assert.equal(f.bridge.take(),null);
  assert.equal(f.messages.at(-1).type,'SD_IMAGE_FAILED');assert.equal(f.messages.at(-1).studentKey,'child-a');
  assert.equal(f.messages.some(message=>message.type==='SD_RECORD'),false);assert.equal(f.invalidated,1);
});
for(const file of ['science-defenders.html','science-raiders.html','science-legends.html','science-slayers.html','science-spire.html'])test(file+' uses the guarded picker and accepts empty banks',()=>{
  const source=read(file),spire=file.includes('spire'),bank=spire?'QBANK':'QUESTION_BANK',apply=spire?'applyBank':'applyBankQuestions';
  for(const match of source.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  assert.match(source,/<script src="science-feed-bridge\.js"><\/script>/);
  assert.match(source,/await scienceFeed\.refresh\(\)/);
  assert.match(source,/if\(!scienceFeed\.current\(qState\.current\)\) return;/);
  const selected=row('safe'),c=vm.createContext({ScienceFeedBridge:{},scienceFeed:{take:()=>selected,stamp:q=>q},G:{topic:'mixed'},
    [bank]:[row('old')],usingBank:false,usingBankQuestions:false,rebuildTopicOptions(){},$:()=>({})});
  vm.runInContext(cut(source,'function pickQuestion(){','\n}\n')+'\n}\n'+cut(source,`function ${apply}(list){`,'\n}\n')+'\n}\n',c);
  assert.equal(c.pickQuestion().id,'safe');c[apply]([]);assert.equal(c[bank].length,0);
});
const question=(id,topic='Plant Systems',extra={})=>({id,title:id,topic,blocks:[{type:'text',content:'Which statement is true for '+id+'?'},{type:'mcq',options:[{id:'a',text:'First'},{id:'b',text:'Second'}],correctId:'a'}],...extra});
function fpsFixture(bank,random=()=>0.5){
  const storage=new Map(),elements=new Map(),noop=()=>{};
  const el=id=>{if(!elements.has(id))elements.set(id,{classList:{remove:noop}});return elements.get(id);};
  const c=vm.createContext({buildScienceFeedContext,planScienceQuestions:(qs,opts)=>planScienceQuestions(qs,{random,...opts}),strikeQuestionQualityOptions,strikeAttemptProgress,console,currentUser:{uid:'u',name:'Ada',authName:'Parent',role:'student'},
    studentLevelCap:4,studentLevelFloor:0,fpsProfileSignature:'',fpsAssignedFallback:'',fpsFeedAttempts:[],fpsFeedReady:true,fpsFeedBank:bank,
    fpsFeedLoad:0,fpsProfileStop:null,fpsFailedImages:new Map(),questions:bank.map(q=>({id:q.id,feedSource:q})),customTopicLevels:{},
    fpsServedMemory:new Map(),fpsFeedFlags:[],fpsFeedObjectives:[],fpsFeedObjectiveMap:{},
    stripHtml:html=>String(html||'').replace(/<[^>]*>/g,''),qZoomBtns:()=>'',
    suspendCombat:noop,clearTimeout:noop,cancelAnimationFrame:noop,hideOverlays:noop,enterMenu:noop,
    qLockT:0,raf:0,skillsOpen:false,skillsFromPause:false,
    G:{activeQ:null},QUESTION_INTERVAL:15000,$:el,isAdmin:()=>false,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    Map,Set,Date,JSON,Number,String,Array,Math});
  vm.runInContext(cut(fps,'const TOPIC_LEVEL_MAP =','let studentLevelCap =')
    +cut(fps,'function levelNum(l)','// The cap in force')
    +cut(fps,'function fpsFeedKey()','const $ =')
    +cut(fps,'function fpsCancelRunForIdentityChange(','function pauseRun(')
    +cut(fps,'function fpsEscape(value)','function fpsWireQuestionImages')
    +cut(fps,'function fpsDatabaseQuestionAvailable(','function fpsRecheckActiveQuestion(')
    +cut(fps,'function qSeenKey()','/* ---------- shared leaderboard'),c);
  return {c,storage};
}
test('Science Strike uses real school, mastery, quality and repetition policies',()=>{
  const bank=[question('p6','Forces'),question('hard','Plant Systems',{difficulty:5}),question('broken','Plant Systems',{status:'flagged'}),question('p4')];
  const {c}=fpsFixture(bank);assert.equal(c.nextQuestion().id,'p4');assert.equal(c.nextQuestion(),null);
  c.studentLevelCap=0;assert.equal(c.nextQuestion(),null);
});

test('Science Strike prioritizes fresh P6 then P5 instead of legacy-rated P3 for a P6 account',()=>{
  const bank=[question('p3-legacy','Magnets',{difficulty:1200}),question('p5','Electrical Systems'),
    question('p6-easy','Forces',{difficulty:'easy'}),question('p6','Forces')];
  const {c}=fpsFixture(bank);c.studentLevelCap=6;
  assert.deepEqual(new Set([c.nextQuestion().id,c.nextQuestion().id]),new Set(['p6','p6-easy']));
  assert.equal(c.nextQuestion().id,'p5');
  assert.equal(c.nextQuestion(),null,'running out does not reopen old or recently served questions');
});

test('Science Strike changes the sampled database question set while retaining P6-first difficulty and run spacing',()=>{
  const names=['cedar','maple','birch','willow','spruce','acacia','juniper','poplar'];
  const bank=[question('foundation','Magnets'),...names.map(id=>question(id,'Forces')),
    question('needs-review','Forces',{importWarning:'Check the source diagram'})];
  const sets=new Set();
  for(let seed=1;seed<=12;seed++){
    let value=seed;const random=()=>((value=(Math.imul(value,1664525)+1013904223)>>>0)/4294967296);
    const {c}=fpsFixture(bank,random);c.studentLevelCap=6;const picked=[];
    for(let i=0;i<3;i++){
      const item=c.nextQuestion();assert.ok(names.includes(item.id),'only sound current-grade questions are selected');picked.push(item.id);
    }
    assert.equal(new Set(picked).size,picked.length,'a run never repeats its own sampled question');
    sets.add(picked.slice().sort().join(','));
  }
  assert.ok(sets.size>1,'new randomness changes which questions are sampled, not just display order');
});

test('Science Strike ignores non-database cached rows and re-extracts the current saved answer',()=>{
  const live=question('database'),{c}=fpsFixture([live]);
  c.questions=[{id:'random-sample',feedSource:question('random-sample'),options:['Invented','Other'],answer:0}];
  live.blocks[1].correctId='b';
  const picked=c.nextQuestion();assert.equal(picked.id,'database');assert.equal(picked.answer,1);
});

test('Science Strike never repeats a question family during a run even after its timed cooldown',()=>{
  const first=question('original'),copy={...first,id:'copy',title:'Different label'},other=question('other','Heat');
  const {c}=fpsFixture([first,copy,other]);c.localStorage.getItem=()=>{throw Error('blocked storage');};c.localStorage.setItem=()=>{throw Error('blocked storage');};
  const picked=[c.nextQuestion().id];
  c.fpsServedMemory.clear(); // Even losing the timed cache must not reopen a run's family.
  picked.push(c.nextQuestion().id);assert.equal(c.nextQuestion(),null);
  assert.equal(picked.filter(id=>['original','copy'].includes(id)).length,1);assert.ok(picked.includes('other'));
});

test('Science Strike respects custom objective mappings and current teacher checks',()=>{
  const higher=question('mapped-high'),bad=question('review'),valid=question('valid');
  bad.autoCheck={state:'red',sig:strikeQuestionQualityOptions(bad).importSignature};
  const {c}=fpsFixture([higher,bad,valid]);c.fpsFeedObjectives=[{id:'higher',level:'P6'}];c.fpsFeedObjectiveMap={higher:['mapped-high']};
  assert.equal(c.nextQuestion().id,'valid');assert.equal(c.nextQuestion(),null);
});

test('Science Strike skips malformed documents and preserves sparse database tables and header labels',()=>{
  const broken=question('broken-table'),valid=question('valid-table');
  broken.blocks.unshift({type:'table',rows:2,cols:2,data:[['a','b'],['c','d']],merges:{bad:true}});
  valid.blocks.unshift({type:'table',rows:2,cols:2,data:{0:{0:'Fruit colour',1:'Detection'},1:{0:'dull green',1:'smell'}}});
  const {c}=fpsFixture([broken,valid]);const picked=c.nextQuestion();assert.equal(picked.id,'valid-table');assert.match(picked.stemHtml,/dull green/);
  const headers=question('headers');headers.blocks.unshift({type:'table',rows:1,cols:2,data:[['dull green','smell']],headers:{0:'Colour label',1:'Detection label'}});
  assert.match(c.extractMcq(headers).stemHtml,/Colour label/);assert.match(c.extractMcq(headers).stemHtml,/Detection label/);
});
test('Science Strike takes the active child level, not a younger sibling; secondary requires teacher authority',()=>{
  const {c}=fpsFixture([]);
  c.fpsApplyProfile({level:'P6',activeStudent:1,students:[{name:'Young',level:'P3'},{name:'Ada',level:'P4'}]});assert.equal(c.studentLevelCap,4);assert.equal(c.currentUser.name,'Ada');
  c.fpsApplyProfile({students:[{name:'Ada',level:'S1'}]});assert.equal(c.studentLevelCap,0);
  c.fpsApplyProfile({level:'S1',students:[{name:'Ada',level:'S1'}]});assert.equal(c.studentLevelCap,7);assert.equal(c.studentLevelFloor,7);
  c.fpsApplyProfile({});assert.equal(c.studentLevelCap,0);
});
test('Science Strike respects topic2, retired topics, per-child history and cross-mode cooldown',()=>{
  const bank=[question('mixed','Plant Systems',{topic2:'Forces'}),question('retired','Plant Systems',{topic2:'Cell Systems'}),question('a'),question('b')];
  const {c,storage}=fpsFixture(bank);const key=c.fpsFeedKey();
  storage.set('scienceFeed:served:'+key,JSON.stringify({a:Date.now()}));
  storage.set('scienceFeed:history:'+key,JSON.stringify({b:{last:Date.now(),latestFrac:1}}));assert.equal(c.nextQuestion(),null);
  c.currentUser.name='Other child';assert.ok(['a','b'].includes(c.nextQuestion().id),'child histories stay separate');
});
test('Science Strike clears the old run on a live child or level change',()=>{
  const {c}=fpsFixture([question('a')]);c.fpsApplyProfile({students:[{name:'Ada',level:'P4'}]});
  c.G.activeQ=c.nextQuestion();assert.ok(c.G.activeQ);c.fpsApplyProfile({students:[{name:'Ben',level:'P3'}]});assert.equal(c.G,null);
});

test('a late old-question image error cannot withdraw the next question for the same child',async()=>{
  const f=bridgeFixture();let pending=f.bridge.refresh();f.reply();await pending;const old=f.bridge.stamp(f.bridge.take());
  pending=f.bridge.refresh();assert.equal(f.bridge.current(old),false);f.reply({questions:[row('next')]});await pending;
  const next=f.bridge.stamp(f.bridge.take()),count=f.messages.length;
  f.bridge.fail(old,'https://school.example/old.png');assert.equal(f.messages.length,count);assert.equal(f.bridge.current(next),true);
});
test('Science Strike preserves the full public MCQ context and rich options',()=>{
  const c=vm.createContext({stripHtml:html=>String(html||'').replace(/<[^>]*>/g,''),qZoomBtns:()=>'',String,Number,Math,Array,Object});
  vm.runInContext(cut(fps,'function fpsEscape(value)','function fpsWireQuestionImages'),c);
  const q=question('rich');q.blocks.unshift({type:'table',rows:2,cols:2,data:[['Fruit colour','Detection'],['dull green','smell']],cellStyles:{'1_0':{backgroundColor:'green'}}},
    {type:'part',label:'(a)',content:'Use the labels.'},{type:'studentAnswer',answer:'<i>It will camouflage.</i>'},{type:'commonMistake',text:'Consider the dull green fruit.'});
  q.blocks[5].options[0].text='Root <img src="root.png"><sup>2</sup>';
  q.blocks.push({type:'explanation',content:'PRIVATE SOLUTION'});
  const extracted=c.extractMcq(q);assert.match(extracted.stemHtml,/<table/);assert.match(extracted.stemHtml,/dull green/);assert.match(extracted.stemHtml,/background-color:green/);
  assert.match(extracted.stemHtml,/It will camouflage/);assert.match(extracted.stemHtml,/Use the labels/);assert.doesNotMatch(extracted.stemHtml,/PRIVATE SOLUTION/);
  assert.match(extracted.options[0],/<img src="root.png"><sup>2<\/sup>/);
  q.blocks.push({...q.blocks[5]});assert.equal(c.extractMcq(q),null,'do not flatten multiple MCQ parts into a single answer');
});

test('Science Strike never counts a mixed MCQ and written task as one complete answer',()=>{
  const c=vm.createContext({stripHtml:html=>String(html||'').replace(/<[^>]*>/g,''),qZoomBtns:()=>'',String,Number,Math,Array,Object});
  vm.runInContext(cut(fps,'function fpsEscape(value)','function fpsWireQuestionImages'),c);
  const q=question('mixed');q.blocks.unshift({type:'part',label:'(a)',content:'Choose the plant part.'});
  const choiceBlocks=q.blocks.slice();
  for(const task of [{type:'plainanswer',content:'Because roots absorb water.'},{type:'answer',claim:'Root',evidence:'Water uptake',reasoning:'Absorption'},
    {type:'fillblank',text:'The root absorbs [[water]].'},{type:'workingSpace',annotate:false},{type:'workingSpace',annotate:true},
    {type:'openLines',lines:3},{type:'answerLine',answer:'Root'}]){
    q.blocks=choiceBlocks.concat({type:'part',label:'(b)',content:'Explain your answer.'},task);
    assert.equal(c.extractMcq(q),null,task.type+' is a separate task');
  }
  q.blocks=choiceBlocks;q.annotation=true;assert.equal(c.extractMcq(q),null);delete q.annotation;
  q.blocks=choiceBlocks.concat({type:'fillblank',text:'Roots absorb water.'},{type:'explanation',content:'HIDDEN EXPLANATION'},{type:'answerKey',text:'HIDDEN KEY'});
  const result=c.extractMcq(q);assert.ok(result,'private explanation alone is not another answer task');
  assert.match(result.stemHtml,/Roots absorb water/);assert.doesNotMatch(result.stemHtml,/HIDDEN/);
});
