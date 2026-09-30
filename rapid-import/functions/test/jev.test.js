import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCanvas} from '@napi-rs/canvas';
import {measureCrop,figureFacts,figureHardIssues,questionFacts,questionHardIssues,buildReviewRequest,readReview,decideReview,failuresToFindings,JEV_MIN_CONFIDENCE} from '../jev-review-core.js';
import {jevReview,JevUnavailable,cleanInput,jevAllow} from '../jev.js';

test('the worker copy of the shared core is byte-identical to the site copy',()=>{
  assert.equal(readFileSync(new URL('../jev-review-core.js',import.meta.url),'utf8'),readFileSync(new URL('../../../jev-review-core.mjs',import.meta.url),'utf8'));
});

function page(){const c=createCanvas(200,150),x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,200,150);x.fillStyle='#000';x.fillRect(20,30,100,50);return {c,x};}
test('a crop that slices through a drawing is reported clipped on that side only',()=>{
  const {x}=page();
  const cut=measureCrop(x,200,150,{x:20,y:20,w:50,h:70},190);   // right edge lands mid-drawing
  assert.deepEqual(cut.clipped,['right']);
  const whole=measureCrop(x,200,150,{x:14,y:24,w:112,h:62},190);
  assert.deepEqual(whole.clipped,[]);
  assert.ok(whole.ink>0.05);
});
test('a rectangle on blank paper measures as blank; the page edge cannot be clipped',()=>{
  const {x}=page();
  assert.ok(measureCrop(x,200,150,{x:130,y:90,w:60,h:50},190).ink<0.002);
  assert.deepEqual(measureCrop(x,200,150,{x:0,y:30,w:60,h:50},190).clipped.includes('left'),false);
});
test('figure hard issues cover clipped, blank, whole page and refused crops',()=>{
  const base={index:0,source:'ai-box',width:200,height:100,pageShare:0.2};
  assert.deepEqual(figureHardIssues(figureFacts({...base,measure:{ink:0.1,clipped:[],bleed:{top:0,right:0,bottom:0,left:0}}})),[]);
  assert.equal(figureHardIssues(figureFacts({...base,measure:{ink:0.1,clipped:['top','left'],bleed:{top:.4,right:0,bottom:0,left:.5}}}))[0].code,'clipped');
  assert.equal(figureHardIssues(figureFacts({...base,measure:{ink:0.0001,clipped:[],bleed:{top:0,right:0,bottom:0,left:0}}}))[0].code,'blank');
  assert.equal(figureHardIssues(figureFacts({...base,pageShare:0.95,measure:{ink:.2,clipped:[],bleed:{top:0,right:0,bottom:0,left:0}}}))[0].code,'whole_page');
  assert.equal(figureHardIssues(figureFacts({...base,refused:true,source:'none'}))[0].code,'no_crop');
  const strayFacts=figureFacts({...base,measure:{ink:.1,clipped:[],bleed:{top:0,right:0,bottom:0,left:0}},refine:{changed:true}});
  assert.equal(strayFacts.aiSawStrayText,true,'Jev is told sentences had to be cut off');
  assert.deepEqual(figureHardIssues(strayFacts),[],'…but the clean-up already fixed it, so it is not a defect by itself');
});
const good={blocks:[
  {type:'text',content:'<p>Study the set-up in Diagram 1 and answer the questions.</p>'},{type:'image',url:'u'},
  {type:'text',part:'a',content:'<p>(a) Name the process shown.</p>'},{type:'plainanswer',part:'a',content:'Evaporation'},
  {type:'text',part:'b',content:'<p>Explain why.</p>'},{type:'plainanswer',part:'b',content:'The water gains heat.'}]};
test('a complete question has no hard issues; the durable worker stamping every block with its part is not a repeat',()=>{
  const q=JSON.parse(JSON.stringify(good));q.blocks[1].part='a';
  const h=questionHardIssues(questionFacts(q));
  assert.deepEqual([h.wording,h.structure],[[],[]]);
});
test('garbled wording, cut-off sentences and a left-over number are wording defects',()=>{
  const h=questionHardIssues(questionFacts({blocks:[{type:'text',content:'3. What is the � of the cell and the'},{type:'plainanswer',content:'x'}]}));
  const codes=h.wording.map(i=>i.code);
  for(const c of ['garbled','cut_off','number_left']) assert.ok(codes.includes(c),c);
});
test('option, part-letter and answer defects are structure defects',()=>{
  const q={blocks:[{type:'text',part:'a',content:'A'},{type:'mcq',options:[{id:'1',text:'x'},{id:'2',text:'X'},{id:'3',text:''}],correctId:null},
    {type:'plainanswer',content:'…'},{type:'text',part:'c',content:'C'}]};
  const codes=questionHardIssues(questionFacts(q)).structure.map(i=>i.code);
  for(const c of ['mcq_empty','mcq_duplicate','mcq_correct','part_gap','answer_placeholder','part_no_answer']) assert.ok(codes.includes(c),c);
  assert.ok(questionHardIssues(questionFacts({blocks:[{type:'text',content:'See the graph above and answer.'}]})).structure.some(i=>i.code==='figure_absent'));
});
const answer=(choice,conf,pYes)=>({type:'choice',choice,confidence:conf,probabilities:{yes:pYes,no:1-pYes}});
test('requests are scoped and the answers are read strictly',()=>{
  const facts=questionFacts(good);
  assert.deepEqual(Object.keys(buildReviewRequest({question:facts,figures:[{index:0}],scope:'all'}).questions),['wording','structure','figure_0']);
  assert.deepEqual(Object.keys(buildReviewRequest({figures:[{index:0},{index:1}],scope:'figures'}).questions),['figure_0','figure_1']);
  assert.equal(buildReviewRequest({figures:[{index:0}],scope:'figures'}).state.question,undefined);
  assert.deepEqual(Object.keys(buildReviewRequest({question:facts,figures:[{index:0}],scope:'question'}).questions),['wording','structure']);
  const body=buildReviewRequest({question:facts,scope:'question'});
  const ok=readReview({answers:{wording:answer('yes',.95,.95),structure:answer('no',.9,.1)}},body);
  assert.equal(ok.wording.ok,true);assert.equal(ok.structure.ok,false);
  assert.equal(readReview({answers:{wording:answer('yes',JEV_MIN_CONFIDENCE-.1,.55),structure:answer('yes',.9,.9)}},body).wording.ok,false,'a yes that is not sure is a no');
  assert.throws(()=>readReview({answers:{wording:answer('maybe',.9,.9),structure:answer('yes',.9,.9)}},body),/unreadable/);
  assert.throws(()=>readReview({answers:{wording:{type:'choice',choice:'yes',confidence:.9,probabilities:{yes:.2,no:.2}},structure:answer('yes',.9,.9)}},body),/unreadable/);
  assert.throws(()=>readReview({answers:{wording:answer('yes',.9,.9)}},body),/unreadable/);
});
test('Jev says no, or the code finds a hard defect: the AI must check and fix. Only a confident clean pass skips it',()=>{
  const qf=questionFacts(good), clean={ok:true,confidence:.95}, figs=[figureFacts({index:0,source:'ai-box',width:200,height:100,pageShare:.2,measure:{ink:.1,clipped:[],bleed:{top:0,right:0,bottom:0,left:0}}})];
  let d=decideReview({verdicts:{wording:clean,structure:clean,figure_0:clean},figures:figs,question:qf});
  assert.deepEqual([d.passed,d.confident],[true,true]);
  d=decideReview({verdicts:{wording:clean,structure:{ok:true,confidence:.7},figure_0:clean},figures:figs,question:qf});
  assert.deepEqual([d.passed,d.confident],[true,false],'a lukewarm yes passes but does not skip the AI read');
  d=decideReview({verdicts:{wording:{ok:false,choice:'no',confidence:.9},structure:clean,figure_0:clean},figures:figs,question:qf});
  assert.equal(d.passed,false);assert.equal(d.failures[0].by,'jev');
  const clipped=[{...figs[0],clippedSides:['top']}];
  d=decideReview({verdicts:{figure_0:clean},figures:clipped,question:null});
  assert.equal(d.passed,false,'Jev saying yes cannot override a crop that visibly continues past its edge');
  assert.equal(failuresToFindings(d.failures)[0].cropStatus,'clipped');
});
test('the provider sends the secret only as a bearer header and never leaks an error body',async()=>{
  const body=questionFacts(good);let seen;
  const okFetch=async(url,init)=>{seen={url,init};return {ok:true,json:async()=>({answers:{wording:answer('yes',.9,.9),structure:answer('yes',.9,.9)}})};};
  const v=await jevReview({scope:'question',question:body},{apiKey:'sekret',fetchImpl:okFetch});
  assert.equal(v.wording.ok,true);assert.equal(seen.init.headers.Authorization,'Bearer sekret');assert.ok(!seen.init.body.includes('sekret'));
  await assert.rejects(jevReview({scope:'question',question:body},{apiKey:'',fetchImpl:okFetch}),e=>e instanceof JevUnavailable&&e.code==='not_configured');
  await assert.rejects(jevReview({scope:'question',question:body},{apiKey:'k',fetchImpl:async()=>({ok:false,status:429,text:async()=>'SECRET'})}),e=>e.code==='busy'&&!/SECRET/.test(e.message));
  await assert.rejects(jevReview({scope:'question',question:body},{apiKey:'k',fetchImpl:async()=>({ok:true,json:async()=>({answers:{}})})}),e=>e.code==='invalid_response');
  await assert.rejects(jevReview({scope:'question',question:body},{apiKey:'k',fetchImpl:async()=>{throw new Error('net');}}),e=>e.code==='unavailable');
});
test('input from the browser is bounded and shaped before it is forwarded',()=>{
  const c=cleanInput({scope:'question',question:{excerpt:'x'.repeat(9000),'bad key!':1,deep:{a:{b:{c:{d:{e:{f:1}}}}}}},figures:[{index:0}]});
  assert.equal(c.question.excerpt.length,1500);assert.ok(!('bad key!' in c.question));
  assert.throws(()=>cleanInput(null),/Invalid/);assert.throws(()=>cleanInput({scope:'question',question:[]}),/Invalid/);
  assert.throws(()=>cleanInput({scope:'figures',figures:[]}),/Nothing/);
});
test('allowance counts per minute and per day without storing content',async()=>{
  const docs=new Map(),db={collection:()=>({doc:id=>({id})}),runTransaction:async fn=>fn({get:async r=>({data:()=>docs.get(r.id)}),set:(r,v)=>docs.set(r.id,v)})};
  for(let i=0;i<90;i++) assert.equal(await jevAllow(db,'u',1e12),true);
  assert.equal(await jevAllow(db,'u',1e12),false);
  assert.equal(await jevAllow(db,'u',1e12+61000),true);
  assert.deepEqual(Object.keys(docs.get('u')).sort(),['day','dayCount','minute','minuteCount']);
});
