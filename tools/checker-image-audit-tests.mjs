// The shipped checker must account for every picture before a green verdict.
// These tests exercise its real prompt, media packet and report validation;
// model replies and downloads are deterministic, with no paid calls.
import { mcqLabelSrc } from './mcq-labels-src.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as repairCore from '../question-repair-core.mjs';
import { migrateDecisionsReviewState } from '../decisions-review-core.mjs';

const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=source.indexOf('// ---- the AI pass: the question AND its diagrams');
const end=source.indexOf('// ---- rendering',start);
assert.ok(start>=0 && end>start,'Question checker section exists');
const section=source.slice(start,end);

function harness(){
  return new Function('core',`
    const {questionRepairTargets}=core;
    const CQ_AI_IMAGES=3;
    const H={calls:[],downloads:[],reply:undefined,fetchImpl:null,modelImpl:null,fixable:false,current:null,live:0,inflight:0,grounding:''};
    const console={warn(){}};
    function stripHtml(v){return String(v || '').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim();}
    const normalizeCategoryValue=v=>v,aiGrounding=()=>H.grounding,transformImageUrl=v=>v;
    const tlSig=q=>JSON.stringify({t:q.title || '',p:q.topic || '',c:q.category || '',a:!!q.annotation,b:q.blocks || [],keyImage:q.answerKeyImage || ''});
    const getTopicLevel=topic=>topic==='Secondary science'?'Sec 1':'P5';
    const isSecondaryLevel=level=>/^Sec/.test(String(level || ''));
    function _docClip(s,n){return s.length>n?s.slice(0,n)+'…':s;}
    function _cqTableRows(b){return Object.values(b.data || {}).map(row=>Object.values(row || {}).map(stripHtml));}
    function _cqOptText(o){return stripHtml(typeof o==='string'?o:o?.text);}
    function _cqMcqFixable(){return H.fixable;}
    function _parseAIJson(v){return typeof v==='string'?JSON.parse(v):v;}
    function _parseImageDataUrl(v){const m=/^data:(image\\/[a-z+]+);base64,([^,]+)$/.exec(v || '');return m?{mime:m[1]}:null;}
    async function _urlToDataUrlRobust(url){H.downloads.push(url);return H.fetchImpl?await H.fetchImpl(url):'data:image/png;base64,ZmFrZQ==';}
    function report(call){
      if(H.reply!==undefined)return H.reply;
      const line=call.prompt.split('\\n').find(line=>line.startsWith('ATTACHMENT MANIFEST ('));
      const manifest=line?JSON.parse(line.slice(line.indexOf(': ')+2)):[];
      return {findings:[],imageAudits:manifest.map(t=>({target:t.target,status:'complete',detail:''}))};
    }
    async function respond(call){
      H.calls.push(call);H.live++;H.inflight=Math.max(H.inflight,H.live);
      try{return H.modelImpl?await H.modelImpl(call):report(call);}finally{H.live--;}
    }
    async function askGemini(prompt,opts){return respond({prompt,opts,media:[]});}
    async function askGeminiVision(prompt,media,opts){return respond({prompt,media,opts});}
    ${mcqLabelSrc(source, { display: false })}
    ${section}
    return {H,check:async q=>{H.current=q;return _cqAiCheck(q);},packet:_cqImagePacket,media:_cqMedia,repr:_cqRepr,norm:_cqNormFinding,targets:_cqImageTargets};
  `)(repairCore);
}
const picture=(id,url='https://fixtures.test/'+id+'.png')=>({id,type:'image',url});
const question=(blocks,extra={})=>({id:'q1',title:'Classifying materials',topic:'Materials',category:'MCQ',blocks,...extra});
const words={id:'words',type:'text',content:'The flowchart classifies materials by their properties.'};
const twoPictures=()=>question([words,picture('flowchart'),picture('duplicate-prose')]);
const complete=q=>({findings:[],imageAudits:repairCore.questionRepairTargets(q).filter(t=>t.kind==='image'&&t.value).map(t=>({target:t.id,status:'complete',detail:''}))});
const cases=[];
const test=(name,run)=>cases.push({name,run});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const until=async(predicate,message)=>{
  for(let i=0;i<40;i++){if(predicate())return;await new Promise(setImmediate);}
  assert.ok(predicate(),message);
};

test('a clipped flowchart and stray repeated wording produce separate targeted crop findings',async()=>{
  const h=harness();h.H.reply={findings:[],imageAudits:[
    {target:'block:flowchart:url',status:'clipped',detail:'The right-hand flowchart box and its branch run off the picture edge. Recrop the complete flowchart from the full source.'},
    {target:'block:duplicate-prose:url',status:'stray_text',detail:'The image repeats the question sentence and cuts off its final words. Remove this surrounding prose while keeping all figure labels.'},
  ]};
  const findings=await h.check(twoPictures());
  assert.deepEqual(findings.map(f=>[f.type,f.severity,f.target,f.fix,f.cropStatus]),[
    ['Crop','high','block:flowchart:url','cropImage','clipped'],
    ['Crop','med','block:duplicate-prose:url','cropImage','stray_text'],
  ]);
  assert.match(findings[0].detail,/right-hand flowchart box/);assert.match(findings[1].detail,/repeats the question sentence/);
  assert.equal(h.H.calls.length,1,'Crop audit shares the main checker call');
});
test('complete per-picture audits permit an empty finding list',async()=>{
  const h=harness();assert.deepEqual(await h.check(twoPictures()),[]);assert.equal(h.H.calls[0].media.length,2);
});
test('unclear pictures require manual review rather than passing or pretending to recrop',async()=>{
  const h=harness();h.H.reply={findings:[],imageAudits:[{target:'block:flowchart:url',status:'unclear',detail:'The faint labels cannot be read reliably.'}]};
  const [finding]=await h.check(question([picture('flowchart')]));
  assert.equal(finding.severity,'med');assert.equal(finding.fix,'');assert.equal(finding.cropStatus,'unclear');
  assert.match(finding.title,/manual visual check/);
});
test('failed downloads or unreadable image data never reach an all-clear model response',async()=>{
  for(const value of ['throw','', 'not an image','data:image/png;base64,']){
    const h=harness();h.H.fetchImpl=async()=>{if(value==='throw')throw Error('Network failed');return value;};
    await assert.rejects(h.check(twoPictures()),/could not read|unreadable/i);assert.equal(h.H.calls.length,0);
  }
});
test('the checker audits every picture beyond the old three-image cap',async()=>{
  const q=question(Array.from({length:12},(_,i)=>picture('image-'+i))),h=harness();
  await h.check(q);assert.equal(h.H.calls.length,1);assert.equal(h.H.calls[0].media.length,12);
  assert.equal(h.H.downloads.length,12);assert.match(h.H.calls[0].prompt,/block:image-11:url/);
});
test('more than twelve pictures fail explicitly instead of silently omitting any',async()=>{
  const h=harness();await assert.rejects(h.check(question(Array.from({length:13},(_,i)=>picture('image-'+i)))),/12 pictures/);
  assert.equal(h.H.downloads.length,0);assert.equal(h.H.calls.length,0);
});
test('missing, duplicated, unknown and incomplete picture audits cannot produce a clean verdict',async()=>{
  const q=twoPictures(),good=complete(q);
  const replies=[
    {findings:[]}, {findings:[],imageAudits:[]},
    {findings:[],imageAudits:[good.imageAudits[0]]},
    {findings:[],imageAudits:[good.imageAudits[0],good.imageAudits[0]]},
    {findings:[],imageAudits:[good.imageAudits[0],{target:'block:unknown:url',status:'complete'}]},
    {findings:[],imageAudits:[good.imageAudits[0],{target:good.imageAudits[1].target,status:'looks-good'}]},
    {findings:[],imageAudits:[good.imageAudits[0],{target:good.imageAudits[1].target,status:'clipped',detail:''}]},
    {findings:[],imageAudits:[good.imageAudits[0],{target:good.imageAudits[1].target,status:'complete',detail:{}}]},
  ];
  for(const reply of replies){const h=harness();h.H.reply=reply;await assert.rejects(h.check(q),/not inspect every|incomplete picture audit/);}
});
test('malformed main findings cannot silently turn into an empty result',async()=>{
  for(const reply of [null,[],{},'not JSON',{findings:null,imageAudits:[]},{findings:[null],imageAudits:[]},{findings:[{}],imageAudits:[]}]){
    const h=harness();h.H.reply=reply;await assert.rejects(h.check(question([words])));
  }
});
test('text-only questions still use the text model and require an explicit complete report',async()=>{
  const h=harness();h.H.reply={findings:[],imageAudits:[]};assert.deepEqual(await h.check(question([words])),[]);
  assert.equal(h.H.downloads.length,0);assert.equal(h.H.calls[0].media.length,0);
});
test('media catalog includes option, table, answer and top-level answer-key pictures',async()=>{
  const q=question([
    {id:'inline',type:'text',content:'Question <img src="https://fixtures.test/stem.png">'},
    {id:'options',type:'mcq',correctId:'o1',options:[{id:'o1',text:'<img src="https://fixtures.test/option.png">'}]},
    {id:'table',type:'table',data:{0:{0:'<img src="https://fixtures.test/cell.png">'}}},
    {id:'answer',type:'answer',claim:'<img src="https://fixtures.test/claim.png">',evidence:'',reasoning:''},
    {id:'diagram',type:'image',url:'https://fixtures.test/figure.png',answerImg:'https://fixtures.test/answer.png'},
  ],{answerKeyImage:'https://fixtures.test/key.png'});
  const h=harness(),packet=await h.packet(q),ids=packet.targets.map(t=>t.id);
  assert.deepEqual(ids,[
    'block:inline:content:inline:1','block:options:option:o1:inline:1','block:table:cell:0:0:inline:1',
    'block:answer:claim:inline:1','block:diagram:url','block:diagram:answerImg','q:answerKeyImage',
  ]);
  assert.equal(packet.media.length,7);
  await h.check(q);assert.equal(h.H.calls[0].media.length,7);
  for(const id of ids)assert.ok(h.H.calls[0].prompt.includes(id),'Attachment manifest includes '+id);
});
test('duplicate URLs retain distinct target identities for the two visible image positions',async()=>{
  const h=harness(),q=question([picture('first','https://fixtures.test/shared.png'),picture('second','https://fixtures.test/shared.png')]);
  const packet=await h.packet(q);assert.equal(packet.targets.length,2);
  assert.notEqual(packet.targets[0].id,packet.targets[1].id);
  assert.equal(h.H.downloads.length,1,'The repeated URL is downloaded only once within the packet');
  await h.check(q);assert.equal(h.H.calls[0].media.length,2);
  assert.equal(h.H.downloads.length,2,'A later check rereads the remote URL rather than caching old pixels');
});

test('image downloads overlap in a bounded pool and retain attachment order',async()=>{
  const h=harness(),q=question(Array.from({length:8},(_,i)=>picture('pool-'+i)));
  const gates=new Map();let live=0,peak=0;
  h.H.fetchImpl=async url=>{
    const gate=deferred();gates.set(url,gate);live++;peak=Math.max(peak,live);
    try{return await gate.promise;}finally{live--;}
  };
  const reading=h.packet(q);
  await until(()=>h.H.downloads.length===4,'The first four downloads should overlap');
  assert.equal(peak,4,'The pool starts four concurrent image reads');
  gates.get('https://fixtures.test/pool-3.png').resolve('data:image/png;base64,cGlj3==');
  await until(()=>h.H.downloads.length===5,'Finishing one image should refill the download pool');
  for(let i=0;i<8;i++){
    const url='https://fixtures.test/pool-'+i+'.png';
    await until(()=>gates.has(url),'Every image gets its turn in the bounded pool');
    gates.get(url).resolve('data:image/png;base64,cGlj'+i+'==');
  }
  const packet=await reading;
  assert.ok(peak<=4,'Image reads stay bounded while the pool refills');
  assert.deepEqual(packet.targets.map(t=>t.id),Array.from({length:8},(_,i)=>'block:pool-'+i+':url'));
  assert.deepEqual(packet.media.map(m=>m.data),Array.from({length:8},(_,i)=>'cGlj'+i+'=='),'Completion order cannot reorder attachments');
});

test('one failed concurrent image read prevents the provider check and names its target',async()=>{
  const h=harness(),q=question([picture('first'),picture('missing'),picture('third')]);
  h.H.fetchImpl=async url=>{if(url.endsWith('/missing.png'))throw Error('Unavailable');return 'data:image/png;base64,cGlj==';};
  await assert.rejects(h.check(q),/could not read.*missing|could not read.*picture/i);
  assert.equal(h.H.calls.length,0,'No paid check may omit the failed picture');
});

test('simultaneous identical checks share in-flight work but completed checks reread',async()=>{
  const h=harness(),q=twoPictures(),gate=deferred();
  h.H.modelImpl=async()=>{await gate.promise;return complete(q);};
  const first=h.check(q),second=h.check(JSON.parse(JSON.stringify(q)));
  await until(()=>h.H.calls.length===1,'The shared checker should reach its provider');
  assert.equal(h.H.downloads.length,2,'The shared review prepares each distinct picture once');
  gate.resolve();
  assert.deepEqual(await first,[]);assert.deepEqual(await second,[]);
  assert.equal(h.H.calls.length,1,'Identical simultaneous checks share one provider call');
  await h.check(q);
  assert.equal(h.H.calls.length,2,'An explicit later review receives a fresh provider read');
  assert.equal(h.H.downloads.length,4,'Remote image bytes are read again after completion');
});

test('a queued review preserves its snapshot and edits start distinct checks',async()=>{
  const h=harness(),q=question([{...words}]),gate=deferred();
  const original=q.blocks[0].content;
  h.H.modelImpl=async()=>{await gate.promise;return {findings:[],imageAudits:[]};};
  const before=h.check(q);
  q.blocks[0].content='Completely changed wording after the check began.';
  const after=h.check(q);
  await until(()=>h.H.calls.length===2,'Changed wording requires another checker call');
  assert.ok(h.H.calls.some(c=>c.prompt.includes(original)),'The original review reads its own snapshot');
  assert.ok(h.H.calls.some(c=>c.prompt.includes(q.blocks[0].content)),'The edited review reads the new wording');
  gate.resolve();await Promise.all([before,after]);
});

test('changed science grounding does not share an already-running check',async()=>{
  const h=harness(),q=question([words]),gate=deferred();
  h.H.modelImpl=async()=>{await gate.promise;return {findings:[],imageAudits:[]};};
  h.H.grounding='FIRST SCIENCE GROUNDING\n';const first=h.check(q);
  h.H.grounding='UPDATED SCIENCE GROUNDING\n';const second=h.check(q);
  await until(()=>h.H.calls.length===2,'Different grounding must receive a separate read');
  assert.equal(h.H.calls.filter(call=>call.prompt.includes('FIRST SCIENCE GROUNDING')).length,1,'The old request retains the grounding used in its sharing key');
  assert.equal(h.H.calls.filter(call=>call.prompt.includes('UPDATED SCIENCE GROUNDING')).length,1,'The new request receives its own captured grounding');
  gate.resolve();await Promise.all([first,second]);
});

test('numbered and lettered variants keep separate in-flight calls and prompt labels',async()=>{
  for(const labelChange of [{mcqLabels:'letters'},{topic2:'Secondary science'}]){
    const h=harness(),gate=deferred();
    const numbered=question([{id:'choice',type:'mcq',correctId:'a',options:[{id:'a',text:'Iron'},{id:'b',text:'Plastic'}]}]);
    const lettered={...numbered,...labelChange};
    h.H.modelImpl=async()=>{await gate.promise;return {findings:[],imageAudits:[]};};
    const first=h.check(numbered),second=h.check(lettered);
    await until(()=>h.H.calls.length===2,'Different effective option labels require independent reports');
    assert.equal(h.H.calls.filter(call=>/Marked correct: \(1\)/.test(call.prompt)).length,1,'The original check retains numbered option labels');
    assert.equal(h.H.calls.filter(call=>/Marked correct: \(A\)/.test(call.prompt)).length,1,'The other check reads lettered option labels');
    gate.resolve();await Promise.all([first,second]);
  }
});

test('provider concurrency is bounded globally across independent checker callers',async()=>{
  const h=harness(),gates=[];
  h.H.modelImpl=async()=>{const gate=deferred();gates.push(gate);await gate.promise;return {findings:[],imageAudits:[]};};
  const reads=Array.from({length:14},(_,i)=>h.check(question([{...words,content:'Unique question '+i}],{id:'global-'+i})));
  await until(()=>h.H.calls.length===6,'The checker should start six independent provider reads');
  assert.equal(h.H.live,6,'The six calls overlap');
  await new Promise(setImmediate);
  assert.equal(h.H.calls.length,6,'Further entry points wait for an available global slot');
  for(let i=0;i<14;i++){
    await until(()=>gates[i],'A released slot permits the next provider read');
    gates[i].resolve();
  }
  await Promise.all(reads);
  assert.equal(h.H.calls.length,14,'Every question still receives its own report');
  assert.equal(h.H.inflight,6,'The shared global bound applies throughout the queue');
});

test('a rejected provider read releases its global slot and permits a later retry',async()=>{
  const h=harness(),q=question([words]);
  h.H.modelImpl=async()=>{throw Error('Provider unavailable');};
  await assert.rejects(h.check(q),/Provider unavailable/);
  assert.equal(h.H.live,0,'Rejected calls free their occupied slot');
  h.H.modelImpl=async()=>({findings:[],imageAudits:[]});
  assert.deepEqual(await h.check(q),[],'Failures are not kept as reusable results');
  assert.equal(h.H.calls.length,2);
});
test('other authoring callers still receive a best-effort array with the existing cap',async()=>{
  const h=harness();h.H.fetchImpl=async url=>{if(url.endsWith('bad.png'))throw Error('download failure');return 'data:image/png;base64,ZmFrZQ==';};
  const result=await h.media(question([picture('bad'),picture('a'),picture('b'),picture('c'),picture('d')]));
  assert.ok(Array.isArray(result));assert.equal(result.length,3);assert.equal(h.H.calls.length,0);
});
test('a text excerpt explicitly names its abbreviation without excusing visible image clipping',async()=>{
  const h=harness(),q=question([{...words,content:'Long complete question. '.repeat(250)},picture('flowchart')]);
  const repr=h.repr(q);assert.match(repr,/TEXT CONTEXT ABBREVIATED BY THE CHECKER/);
  assert.match(repr,/not evidence.*actual question/);assert.doesNotMatch(repr,/it is attached to this message/);
  await h.check(q);const prompt=h.H.calls[0].prompt;
  assert.match(prompt,/clipped flowchart boxes/);assert.match(prompt,/duplicated sentence fragments/);
  assert.match(prompt,/Do not call normal figure labels/);
  assert.doesNotMatch(prompt,/never report the question as truncated or cut off/i);
  assert.match(prompt,/Tightening an already clipped picture cannot restore missing content/);
});
test('only known exact targets and known image fixes survive normal-finding normalization',()=>{
  const h=harness(),targets=repairCore.questionRepairTargets(twoPictures());
  const base={type:'Crop',summary:'A label is cut off',detail:'Right edge clips B.',severity:'high',fix:'cropImage',cropStatus:'clipped'};
  const known=h.norm({...base,target:'block:flowchart:url'},false,targets);
  assert.equal(known.target,'block:flowchart:url');assert.equal(known.fix,'cropImage');assert.equal(known.cropStatus,'clipped');
  const unknown=h.norm({...base,target:'https://evil.test/a.png'},false,targets);
  assert.equal(unknown.target,undefined);assert.equal(unknown.fix,'');assert.equal(unknown.cropStatus,undefined);
  const wording=h.norm({...base,target:'block:words:content'},false,targets);
  assert.equal(wording.target,'block:words:content');assert.equal(wording.fix,'');assert.equal(wording.cropStatus,undefined);
  assert.equal(h.norm({summary:'Repeated choices',fix:'numberOptions'},true,targets).fix,'numberOptions');
  assert.equal(h.norm({summary:'Repeated choices',fix:'numberOptions'},false,targets).fix,'');
});
function stampHarness(){
  const fn=name=>{const a=source.indexOf('function '+name+'('),b=source.indexOf('\n}',a);assert.ok(a>=0&&b>a);return source.slice(a,b+2);};
  const looksStart=source.indexOf('const AUTOCHK_CARD_LOOK ='),looksEnd=source.indexOf('function autoChkCardHtml',looksStart);
  return new Function(`
    ${migrateDecisionsReviewState.toString()}
    const TL_SIG_HEAD=4000,AUTOCHK_KEEP_FINDINGS=20,_tlCache=new Map();
    const escapeHtml=value=>String(value),_aiHash=value=>{let h=5381;for(let i=0;i<value.length;i++)h=((h<<5)+h+value.charCodeAt(i))|0;return 'ai:'+(h>>>0).toString(36);};
    ${fn('tlSig')+fn('_tlFromStamp')+fn('autoChkStamp')+source.slice(looksStart,looksEnd)+fn('autoChkCardHtml')}
    function previousSig(q){const raw=JSON.stringify({t:q.title||'',p:q.topic||'',c:q.category||'',a:!!q.annotation,b:q.blocks||[]});return raw.length+':'+_aiHash(raw)+':'+raw.slice(0,TL_SIG_HEAD);}
    return {tlSig,_tlFromStamp,autoChkStamp,autoChkCardHtml,previousSig};
  `)();
}
test('pre-crop-audit green stamps become stale and their cards ask for a fresh check',()=>{
  const h=stampHarness(),q=twoPictures();q.autoCheck={state:'green',sig:h.previousSig(q),findings:[],at:new Date().toISOString()};
  assert.equal(h._tlFromStamp(q).state,'stale');assert.match(h.autoChkCardHtml(q),/Check again/);
  assert.doesNotMatch(h.autoChkCardHtml(q),/🟢/);
});
test('saved crop findings keep their exact target and defect type across reloads',()=>{
  const h=stampHarness(),q=twoPictures();h.autoChkStamp(q,{state:'red',tries:1,findings:[{type:'Crop',severity:'high',title:'Flowchart clipped',detail:'Starting box missing',target:'block:flowchart:url',cropStatus:'clipped',fix:'cropImage',ai:true}]});
  const reloaded=JSON.parse(JSON.stringify(q)),state=h._tlFromStamp(reloaded);
  assert.equal(state.state,'red');assert.equal(state.findings[0].target,'block:flowchart:url');
  assert.equal(state.findings[0].cropStatus,'clipped');assert.equal(state.findings[0].fix,'cropImage');
});
test('changing the top-level answer picture invalidates its previous check',()=>{
  const h=stampHarness(),q=twoPictures();q.answerKeyImage='https://fixtures.test/answer-1.png';
  h.autoChkStamp(q,{state:'green',findings:[]});q.answerKeyImage='https://fixtures.test/answer-2.png';
  assert.equal(h._tlFromStamp(q).state,'stale');
});

let failed=0;
for(const item of cases){try{await item.run();console.log('PASS',item.name);}catch(error){failed++;console.error('FAIL',item.name,error.stack);}}
console.log(cases.length-failed+' passed, '+failed+' failed');
if(failed)process.exitCode=1;
