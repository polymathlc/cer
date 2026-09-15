import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScienceFeedContext, evaluateScienceFit, planScienceQuestions, scienceQuestionLevel, scienceQuestionContentKey } from '../science-feed-core.js';
const now = Date.parse('2026-09-14T03:00:00Z');
const topicLevels = { 'Plant life': 'P4', 'Electricity': 'P5', 'Forces': 'P6', 'Cells': 'S1', 'Magnets': 'P3' };
const q = (id, extra = {}) => ({ id, title: 'Question', topic: 'Plant life', category: 'Explanation',
  blocks: [{id:'stem',type:'text',content:`<p>Explain observation ${id} using the plant diagram.</p>`},
    {id:'answer',type:'plainanswer',content:'The roots take up water.'}], ...extra });
const opts = (bank, extra = {}) => ({bank,studentLevel:'P4',topicLevels,now,...extra});
const ids = result => result.questions.map(item => item.id);
const seededRandom = seed => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
  value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
};

test('random games draw different sets from the full suitable bank before applying the limit', () => {
  const bank=Array.from({length:12},(_,i)=>q('fresh'+i)), before=JSON.stringify(bank);
  const starts=new Set(), reached=new Set(), sets=new Set();
  for(let seed=0;seed<64;seed++) {
    const picked=ids(planScienceQuestions(bank,opts(bank,{randomize:true,random:seededRandom(seed),limit:3})));
    assert.equal(picked.length,3);assert.equal(new Set(picked).size,3);
    starts.add(picked[0]);picked.forEach(id=>reached.add(id));sets.add(picked.slice().sort().join(','));
  }
  assert.equal(starts.size,12);assert.equal(reached.size,12);assert.ok(sets.size>30);
  assert.equal(JSON.stringify(bank),before);
});

test('randomness preserves grade priority, narrow fit bands, hard ceilings and quality', () => {
  const bank=[q('old',{topic:'Magnets',difficulty:1200}),q('previous',{topic:'Electricity',difficulty:1065}),
    q('near-a',{topic:'Forces'}),q('near-b',{topic:'Forces',difficulty:'easy'}),
    q('less-suitable',{topic:'Forces',difficulty:1160}),q('too-hard',{topic:'Forces',difficulty:5}),
    q('above',{topic:'Cells'}),q('broken',{topic:'Forces',blocks:[]}),q('flagged',{topic:'Forces',practiceQuarantined:true})];
  for(let seed=0;seed<32;seed++) {
    const picked=ids(planScienceQuestions(bank,opts(bank,{studentLevel:'P6',randomize:true,random:seededRandom(seed)})));
    assert.deepEqual(picked.slice(0,2).sort(),['near-a','near-b']);
    assert.deepEqual(picked.slice(2),['less-suitable','previous']);
  }
});

test('many copies never give their question family extra lottery entries', () => {
  const original=q('alpha'), other=q('beta'), third=q('gamma');
  const copies=Array.from({length:40},(_,i)=>q('copy'+i,{variantOf:'alpha'}));
  const family=id=>id.startsWith('copy')?'alpha':id;
  const base=[original,other,third], inflated=[original,...copies,other,third];
  for(let seed=0;seed<128;seed++) {
    const pick=bank=>ids(planScienceQuestions(bank,opts(bank,{randomize:true,random:seededRandom(seed),limit:1})))[0];
    assert.equal(family(pick(inflated)),pick(base));
    const all=ids(planScienceQuestions(inflated,opts(inflated,{randomize:true,random:seededRandom(seed)}))).map(family);
    assert.deepEqual(all.sort(),['alpha','beta','gamma']);
  }
});

test('random draws respect cross-mode family spacing and stop after every eligible family', () => {
  const fresh=Array.from({length:8},(_,i)=>q('fresh'+i));
  const bank=fresh.concat(q('copy',{variantOf:'fresh0'}),q('due-later'));
  const served={},progress={'due-later':{latestFrac:1,last:now-1000}}, random=seededRandom(73),picked=[];
  for(let i=0;i<8;i++) {
    const item=planScienceQuestions(bank,opts(bank,{randomize:true,random,limit:1,served,progress})).questions[0];
    assert.ok(item);picked.push(item.id==='copy'?'fresh0':item.id);served[item.id]=now;
  }
  assert.equal(new Set(picked).size,8);
  const empty=planScienceQuestions(bank,opts(bank,{randomize:true,random,limit:1,served,progress}));
  assert.equal(empty.questions.length,0);assert.ok(empty.nextReviewAt>now);
});

test('blocked family members are removed before the lottery and cannot hide a fresh variant', () => {
  const bank=[q('original'),q('variant',{variantOf:'original'}),q('excluded'),q('other')];
  const progress={original:{latestFrac:1,last:now-3600000}};
  for(let seed=0;seed<16;seed++) {
    const config=opts(bank,{randomize:true,random:seededRandom(seed),progress,excludeIds:['excluded']});
    assert.deepEqual(ids(planScienceQuestions(bank,config)).sort(),['other','variant']);
    assert.deepEqual(ids(planScienceQuestions(bank,{...config,excludeFamilyIds:['original']})),['other']);
  }
});

test('manual revision and ordinary practice keep their deliberate order without drawing randomness', () => {
  const bank=[q('easy',{difficulty:'easy'}),q('normal'),q('hard',{difficulty:5})];
  const random=()=>{throw Error('Unexpected random draw');};
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{manual:true,randomize:true,random}))),['easy','normal','hard']);
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{random}))),['normal','easy']);
  const copies=[q('a'),q('b',{variantOf:'a'})];
  assert.deepEqual(ids(planScienceQuestions(copies,opts(copies,{randomize:true,random:()=>0,onePerFamily:false}))).sort(),['a','b']);
});

test('P6 games prioritize their grade over legacy-rated P3 and then use fresh P5', () => {
  const bank = [q('old-elo',{topic:'Magnets',difficulty:1200}),q('old-d',{topic:'Magnets',d:1050}),
    q('previous',{topic:'Electricity'}),q('current-easy',{topic:'Forces',difficulty:'easy'}),q('current',{topic:'Forces'})];
  const config = opts(bank,{studentLevel:'P6'});
  assert.deepEqual(ids(planScienceQuestions(bank,config)),['current','current-easy','previous']);
  const served = {current:now-1000,'current-easy':now-1000};
  assert.deepEqual(ids(planScienceQuestions(bank,{...config,served})),['previous']);
  served.previous=now-1000;
  assert.deepEqual(ids(planScienceQuestions(bank,{...config,served})),[]);
  assert.deepEqual(ids(planScienceQuestions(bank,{...config,manual:true})),bank.map(item=>item.id));
});

test('an explicit easy label cannot be promoted by a legacy game rating', () => {
  const item=q('old',{topic:'Magnets',level:'easy',d:1200});
  const result=evaluateScienceFit(item,opts([item],{studentLevel:'P6'}));
  assert.equal(result.difficulty,710);
  assert.equal(result.eligible,false);
});

test('successful easy revision never drags a P6 learner below the starting target', () => {
  const history=Array.from({length:12},(_,i)=>q('old'+i,{topic:'Magnets',level:'P3',difficulty:'easy'}));
  const current=q('current',{topic:'Magnets',level:'P6'});
  const bank=history.concat(current);
  const progress=Object.fromEntries(history.map(item=>[item.id,{latestFrac:1,last:now-1000}]));
  const cold=evaluateScienceFit(current,opts(bank,{studentLevel:'P6'}));
  const warm=evaluateScienceFit(current,opts(bank,{studentLevel:'P6',progress}));
  assert.equal(warm.target,cold.target);
  assert.equal(warm.diagnostic.scaffoldSupported,false);
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{studentLevel:'P6',progress}))),['current']);
});

test('only distinct relevant near-grade misses unlock deeper revision', () => {
  const observations=Array.from({length:6},(_,i)=>q('miss'+i,{topic:'Magnets',level:'P6'}));
  const scaffold=q('scaffold',{topic:'Magnets',level:'P4'}), adjacent=q('adjacent',{topic:'Magnets',level:'P5'});
  const current=q('current',{topic:'Magnets',level:'P6'}), distant=q('distant',{topic:'Magnets',d:1200});
  const bank=observations.concat(scaffold,adjacent,current,distant);
  const progress=Object.fromEntries(observations.map(item=>[item.id,{latestFrac:0,last:now-1000}]));
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{studentLevel:'P6',progress}))),['adjacent','current','scaffold']);
  for(const revised of [observations.map(item=>({...item,variantOf:'same-family'})),
    observations.map(item=>({...item,topic:'Forces'}))]) {
    const config=opts(revised.concat(scaffold,adjacent,current,distant),{studentLevel:'P6',progress});
    assert.equal(evaluateScienceFit(scaffold,config).eligible,false);
  }
});

test('highest explicit year, second topic and arbitrary mapped Science objective enforce the cap', () => {
  const bank = [q('p4'), q('p5',{topic2:'Electricity'}), q('p6',{level:'P6'}), q('mixed',{level:'P4/P6'}), q('lo',{los:['force-lo']}), q('inverse')];
  const config = opts(bank,{objectives:[{id:'force-lo',level:'P6'}],objectiveMap:{'force-lo':['inverse']}});
  assert.deepEqual(ids(planScienceQuestions(bank,config)),['p4']);
  assert.deepEqual(ids(planScienceQuestions(bank,{...config,manual:true})),['p4']);
  assert.equal(scienceQuestionLevel(bank[1],config).label,'P5');
});

test('unknown student and malformed/unknown question metadata fail closed', () => {
  const bank = [q('unknown',{topic:'Unfiled'}),q('invalid',{level:'P4 / Secondary'}),q('missing-lo',{los:['unmapped']}),q('known')];
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank))),['known']);
  assert.equal(planScienceQuestions(bank,opts(bank,{studentLevel:''})).questions.length,0);
  assert.equal(planScienceQuestions(bank,opts(bank,{studentLevel:'P4/P6'})).questions.length,0);
});

test('secondary uses its own syllabus band and primary never receives secondary', () => {
  const bank=[q('p4'),q('p6',{level:'P6'}),q('s1',{topic:'Cells'})];
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{studentLevel:'S1',manual:true}))),['s1']);
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{studentLevel:'P6',manual:true}))),['p4','p6']);
});

test('unknown secondary topics cannot ride behind a known primary topic or level', () => {
  const bank=[q('unknown-secondary',{topic2:'Unfiled secondary science'}),q('explicit',{level:'P4',topic2:'Unfiled secondary science'}),
    q('known-level',{level:'P4',topic:'Teacher custom topic'})];
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank))),['known-level']);
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{manual:true}))),['known-level']);
});

test('latest outcomes determine mastery and lifetime best or repetitions do not promote', () => {
  const bank=Array.from({length:9},(_,i)=>q('e'+i));
  const challenge=q('challenge',{difficulty:'hard'}); bank.push(challenge);
  const one={e0:{n:500,best:1,latestFrac:1,last:now-1000}};
  assert.equal(evaluateScienceFit(challenge,opts(bank,{progress:one})).eligible,false);
  const progress=Object.fromEntries(bank.slice(0,9).map((item,i)=>[item.id,{n:1,best:1,latestFrac:1,last:now-1000-i}]));
  assert.equal(evaluateScienceFit(challenge,opts(bank,{progress})).eligible,true);
  for(const record of Object.values(progress)) record.latestFrac=0;
  assert.equal(evaluateScienceFit(challenge,opts(bank,{progress})).eligible,false);
  assert.equal(buildScienceFeedContext(opts(bank,{progress:{e0:{n:900,best:1,last:now-1000}}})).mastery.observations.length,0);
});

test('success on a generic category in another topic cannot inflate an unseen skill', () => {
  const bank=Array.from({length:10},(_,i)=>q('e'+i,{topic:'Magnets',level:'P4'}));
  const challenge=q('challenge',{difficulty:'hard'});bank.push(challenge);
  const progress=Object.fromEntries(bank.slice(0,10).map(item=>[item.id,{latestFrac:1,last:now-1000}]));
  const fit=evaluateScienceFit(challenge,opts(bank,{progress}));
  assert.equal(fit.eligible,false);assert.equal(fit.diagnostic.evidenceCount,0);
});

test('same-story variants contribute mastery evidence once and stay spaced between modes', () => {
  const bank=Array.from({length:10},(_,i)=>q('p'+i,{title:"Casey's Garden",variantOf:'original'})).concat(q('fresh'));
  const progress=Object.fromEntries(bank.slice(0,10).map(item=>[item.id,{latestFrac:1,last:now-1000}]));
  assert.equal(buildScienceFeedContext(opts(bank,{progress})).mastery.observations.length,1);
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{served:{p3:now-1000}}))),['fresh']);
});

test('automatic feeds never recycle any completed question even after its old review date', () => {
  const bank=[q('correct'),q('partial'),q('wrong'),q('due'),q('future')];
  const progress={correct:{latestFrac:1,last:now-1000},partial:{latestFrac:0.5,last:now-1000},wrong:{latestFrac:0,last:now-1000},
    due:{latestFrac:0,last:now-3600000},future:{latestFrac:0,last:now-3600000,nextReviewAt:now+86400000}};
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{progress}))),[]);
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{progress,manual:true}))),bank.map(item=>item.id));
});

test('abandoned questions and exact copies stay excluded across years and removed originals', () => {
  const original=q('old'),copy=q('copy',{blocks:structuredClone(original.blocks)}),fresh=q('new');
  const bank=[original,copy,fresh],served={old:now-800*86400000};
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{served}))),['new']);
  assert.deepEqual(ids(planScienceQuestions([copy,fresh],opts([copy,fresh],{seenContentKeys:[scienceQuestionContentKey(original)]}))),['new']);
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{served,manual:true}))),['old','copy','new']);
});

test('old outcome counters and account history records migrate even without a recent timestamp', () => {
  const bank=[q('answered'),q('shown'),q('fresh')];
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{progress:{answered:{n:1}},seen:{shown:{at:1}}}))),['fresh']);
});

test('a tiny bank never fills with above-level, too hard or far too easy questions', () => {
  const bank=[q('hard',{difficulty:5}),q('above',{level:'P6'}),q('old',{level:'P1',topic:'',difficulty:1})];
  assert.equal(planScienceQuestions(bank,opts(bank)).questions.length,0);
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{manual:true}))),['hard','old']);
});

test('quality failures and observed diagram errors are excluded from feed and mastery', () => {
  const bank=[q('broken',{blocks:[]}),q('suspect',{importWarning:'Check crop'}),q('image',{blocks:[{type:'image',url:'/diagram.png'}]}),q('sound')];
  const config=opts(bank,{failedImageUrls:{image:['/diagram.png']},progress:{broken:{latestFrac:0,last:now-1000},suspect:{latestFrac:0,last:now-1000},image:{latestFrac:0,last:now-1000}}});
  assert.deepEqual(ids(planScienceQuestions(bank,config)),['sound']);
  assert.equal(buildScienceFeedContext(config).mastery.observations.length,0);
  assert.ok(planScienceQuestions(bank,{...config,manual:true}).reviewCount>0);
});

test('existing check callback blocks current errors without AI or changing data', () => {
  const bank=[q('red'),q('good')],before=JSON.stringify(bank);
  const config=opts(bank,{qualityOptions:item=>({checkedState:item.id==='red'?{state:'red',stale:false}:null})});
  assert.deepEqual(ids(planScienceQuestions(bank,config)),['good']);
  assert.equal(JSON.stringify(bank),before);
});

test('corrected private answers do not create fresh copies while MCQ choices and table data do', () => {
  const original=q('a'),copy=q('copy',{title:'Renamed copy',blocks:structuredClone(original.blocks)});
  copy.blocks[1].content='Another private answer';
  assert.equal(buildScienceFeedContext(opts([original,copy])).catalog.exact.get('a'),buildScienceFeedContext(opts([original,copy])).catalog.exact.get('copy'));
  const mcq=(id,choice)=>q(id,{blocks:[{type:'text',content:'Choose the correct label.'},{type:'mcq',options:[{id:'1',text:choice},{id:'2',text:'B'}],correctId:'1'}]});
  const table=(id,value)=>q(id,{blocks:[{type:'table',rows:2,cols:2,data:{0:{0:'Day',1:'Height'},1:{0:'Monday',1:value}}}]});
  for(const bank of [[mcq('a','A'),mcq('b','C')],[table('a','12'),table('b','13')]]) {
    const c=buildScienceFeedContext(opts(bank));assert.notEqual(c.catalog.exact.get('a'),c.catalog.exact.get('b'));
  }
});

test('broad Science titles do not collapse an entire topic into one story', () => {
  const bank=[q('a',{title:'Plant Reproduction'}),q('b',{title:'Plant Reproduction'})];
  assert.equal(planScienceQuestions(bank,opts(bank)).questions.length,2);
});

test('well-sampled usage tunes difficulty cautiously; a low pass rate is not an error verdict', () => {
  const ordinary=q('ordinary'),thin=q('thin',{usage:{pct:0,attempts:500,students:1}}),hard=q('hard',{usage:{pct:0,attempts:200,students:60}});
  const bank=[ordinary,thin,hard],c=buildScienceFeedContext(opts(bank));
  assert.equal(evaluateScienceFit(ordinary,{context:c}).difficulty,evaluateScienceFit(thin,{context:c}).difficulty);
  assert.ok(evaluateScienceFit(hard,{context:c}).difficulty>evaluateScienceFit(ordinary,{context:c}).difficulty);
  assert.equal(c.qualityById.get('hard').tier,'sound');
});

test('served history is passed per child and never mutates callers', () => {
  const bank=[q('a'),q('b')],served={a:now-1000};const before=JSON.stringify(served);
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{served}))),['b']);
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank,{served:{}}))),['a','b']);
  assert.equal(JSON.stringify(served),before);
});

test('sparse table coordinates remain distinct experimental contexts', () => {
  const make = (id,data) => q(id,{blocks:[{type:'text',content:'Which cell changed?'},{type:'table',rows:3,cols:3,data},{type:'plainanswer',content:'B'}]});
  for (const [left,right] of [
    [{0:{0:'A',1:'B'}},{0:{0:'A',2:'B'}}],
    [{0:{0:'A'},1:{0:'B'}},{0:{0:'A'},2:{0:'B'}}]
  ]) {
    const context=buildScienceFeedContext(opts([make('a',left),make('b',right)]));
    assert.notEqual(context.catalog.exact.get('a'),context.catalog.exact.get('b'));
  }
});

test('quoted student responses, visible warnings and part labels affect exact identity', () => {
  const contexts = [
    value=>({type:'studentAnswer',label:"Jo's answer",answer:value}),
    value=>({type:'commonMistake',title:'Read this explanation',text:value}),
    value=>({type:'part',label:value,content:'Use the answer to the previous part.'}),
    value=>({type:'text',part:value,content:'Use the answer to the previous part.'}),
    value=>({type:'text',part:'b',subPart:value,content:'Use the answer to the previous part.'}),
    value=>({type:'image',caption:value,url:'/diagram.svg'})
  ];
  for (const block of contexts) {
    const a=q('a',{blocks:[{type:'text',content:'Explain what is incorrect.'},block('The leaf takes in oxygen.'),{type:'plainanswer',content:'model'}]});
    const b=q('b',{blocks:[{type:'text',content:'Explain what is incorrect.'},block('The leaf takes in nitrogen.'),{type:'plainanswer',content:'model'}]});
    const context=buildScienceFeedContext(opts([a,b]));
    assert.notEqual(context.catalog.exact.get('a'),context.catalog.exact.get('b'));
  }
});

test('unsupported MCQ content never creates a fresh copy of unchanged visible choices', () => {
  const a=q('a',{blocks:[{type:'text',content:'Choose the gas.'},{type:'mcq',content:'Private ignored text A',options:[{id:'a',text:'Oxygen'},{id:'b',text:'Nitrogen'}]}]});
  const b=structuredClone(a); b.id='b'; b.blocks[1].content='Private ignored text B';
  const context=buildScienceFeedContext(opts([a,b])); assert.equal(context.catalog.exact.get('a'),context.catalog.exact.get('b'));
});

test('explicit levels array can classify an otherwise unfiled primary topic', () => {
  const bank=[q('a',{topic:'Teacher custom topic',levels:['P4']})];
  assert.deepEqual(ids(planScienceQuestions(bank,opts(bank))),['a']);
});

test('retired past-paper work needs explicit manual permission and never boosts live mastery', () => {
  const retired=q('past',{notInSyllabus:true}), higher=q('higher',{notInSyllabus:true,level:'P6'}), broken=q('broken',{notInSyllabus:true,blocks:[]});
  const bank=[retired,higher,broken,q('current')];
  const config=opts(bank,{progress:{past:{latestFrac:1,last:now-1000}}});
  assert.equal(buildScienceFeedContext(config).mastery.observations.length,0);
  assert.deepEqual(ids(planScienceQuestions(bank,{...config,allowRetired:true})),['current']);
  assert.deepEqual(ids(planScienceQuestions(bank,{...config,manual:true})),['current']);
  assert.deepEqual(ids(planScienceQuestions(bank,{...config,manual:true,allowRetired:true})),['past','current']);
  assert.deepEqual(ids(planScienceQuestions(bank,{...config,manual:true,allowRetired:true,failedImageUrls:{past:['transformed-unavailable-url']}})),['current']);
});

test('combined-topic concepts keep their category instead of sharing a split topic fragment', () => {
  const bank=Array.from({length:10},(_,i)=>q('e'+i,{topic:'Plant life',topic2:'Magnets',category:'Recall'}));
  const challenge=q('challenge',{topic:'Plant life',topic2:'Magnets',category:'Explanation',difficulty:'hard'});bank.push(challenge);
  const progress=Object.fromEntries(bank.slice(0,10).map(item=>[item.id,{latestFrac:1,last:now-1000}]));
  const fit=evaluateScienceFit(challenge,opts(bank,{progress}));
  assert.equal(fit.eligible,false); assert.equal(fit.diagnostic.evidenceCount,0);
});
