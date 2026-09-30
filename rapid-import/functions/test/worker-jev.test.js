import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
const docs=new Map(), files=new Map(), tasks=[];
const clone=x=>x===undefined?undefined:structuredClone(x);
const snap=path=>({exists:docs.has(path),data:()=>clone(docs.get(path))});
const ref=path=>({path,id:path.split('/').pop(),get:async()=>snap(path)});
let failCommit=false;
const db={doc:ref,collection:name=>({doc:id=>ref(name+'/'+id),where:()=>({get:async()=>({docs:[...docs].filter(([k])=>k.startsWith(name+'/')).map(([k])=>snap(k))})})}),
 runTransaction:async fn=>{
   const writes=[];
   await fn({get:async r=>snap(r.path),create:(r,d)=>writes.push(['create',r.path,clone(d)]),update:(r,d)=>writes.push(['update',r.path,clone(d)]),set:(r,d)=>writes.push(['set',r.path,clone(d)])});
   if(failCommit){failCommit=false;throw new Error('Simulated network failure before commit');}
   for(const [op,path] of writes) if(op==='create'&&docs.has(path)) throw new Error('already exists');
   for(const [op,path,value] of writes) docs.set(path,op==='update'?{...docs.get(path),...value}:value);
 }};
const bucket={name:'test',file:path=>({save:async b=>files.set(path,Buffer.from(b)),download:async()=>{if(!files.has(path))throw new Error('Missing upload');return [files.get(path)];}})};
mock.module('firebase-admin/app',{namedExports:{initializeApp:()=>({})}});
mock.module('firebase-admin/firestore',{namedExports:{getFirestore:()=>db}});
mock.module('firebase-admin/storage',{namedExports:{getStorage:()=>({bucket:()=>bucket})}});
mock.module('firebase-admin/functions',{namedExports:{getFunctions:()=>({taskQueue:()=>({enqueue:async(data,opts)=>tasks.push({data,opts})})})}});
mock.module('firebase-functions/v2/https',{namedExports:{onCall:(opts,fn)=>fn,HttpsError:class extends Error {constructor(code,message){super(message);this.code=code;}}}});
mock.module('firebase-functions/v2/firestore',{namedExports:{onDocumentWritten:(opts,fn)=>fn}});
mock.module('firebase-functions/v2/tasks',{namedExports:{onTaskDispatched:(opts,fn)=>fn}});
mock.module('firebase-functions/params',{namedExports:{defineSecret:()=>({value:()=>'k'}),defineString:(name,opts)=>({value:()=>opts.default})}});
let aiPages=[], aiPrompts=[], recrops=[], checks=[], recropBox=[130,80,280,390];
mock.module('@google/genai',{namedExports:{GoogleGenAI:class {
  models={generateContent:async request=>{
    aiPrompts.push(request.contents[0].parts[0].text);
    const text=request.contents[0].parts[0].text;
    if(/judged wrong|No crop could be cut/.test(text)) {recrops.push(text);return {candidates:[{finishReason:'STOP'}],text:JSON.stringify({box_2d:recropBox})};}
    if(/Check this science question/.test(text)) {checks.push(text);return {candidates:[{finishReason:'STOP'}],text:JSON.stringify({findings:[],repairs:[]})};}
    const page=Number(/CURRENT page (\d+)/.exec(text)?.[1]);
    return {candidates:[{finishReason:'STOP'}],text:JSON.stringify({questions:aiPages[page-1]||[]})};
  }};
}}});

function pdfFixture(pageCount,streams=[]) {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>'];
  objects.push('<< /Type /Pages /Kids ['+Array.from({length:pageCount},(_,i)=>(3+i*2)+' 0 R').join(' ')+'] /Count '+pageCount+' >>');
  for(let i=0;i<pageCount;i++) {
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents '+(4+i*2)+' 0 R /Resources << >> >>');
    const stream=streams[i]??'0 0 0 rg 20 20 50 60 re f\n';objects.push('<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream');
  }
  let pdf='%PDF-1.4\n',offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';});
  const xref=Buffer.byteLength(pdf);pdf+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n';
  pdf+=offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
  pdf+='trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return Buffer.from(pdf);
}

// Jev is the TypeSafe endpoint: scripted per test.
let jevCalls=[], jevPlan=()=>({});
globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body);jevCalls.push(body);
  const plan=jevPlan(Object.keys(body.questions),jevCalls.length,body);
  const answers={};
  for(const key of Object.keys(body.questions)) {
    const [choice,conf]=plan[key]||['yes',.95];
    answers[key]={type:'choice',choice,confidence:conf,probabilities:choice==='yes'?{yes:conf,no:1-conf}:{yes:1-conf,no:conf}};
  }
  return {ok:true,json:async()=>({answers})};
};
const api=await import('../index.js');
const auth={uid:'teacher',token:{admin:true,name:'Teacher'}};
const makeJob=(id='job')=>({id,ownerUid:'teacher',name:'paper.pdf',status:'queued',phase:'publish',publishIndex:0,nextPage:3,total:2,added:0,generation:0,autoCheck:false,checkpoint:'checkpoint',updatedAt:new Date().toISOString()});
function setup(j=makeJob()){docs.clear();files.clear();tasks.length=0;aiPrompts=[];docs.set('cerRapidImports/'+j.id,j);return j;}

const fig=[{title:'Fig',sourceQuestionNumber:'1',blocks:[{type:'text',text:'(a) Look at the figure.'},{type:'image',caption:'F',box_2d:[130,80,280,390]},{type:'plainanswer',text:'Answer'},{type:'explanation',text:'Because'}]}];
function start(autoCheck=false){
  const pdf=pdfFixture(1,['1 0 0 rg 20 220 50 35 re f\n']);
  const j=setup({...makeJob('fig'),phase:'page',nextPage:1,total:1,checkpoint:null,path:'o.pdf',engineOrder:['gemini'],prompt:'Read',autoCheck});
  files.set(j.path,pdf);aiPages=[fig];jevCalls=[];recrops=[];checks=[];return j;
}
const run=async id=>{
  await api.rapidImportPage({data:{id,page:1,generation:0,phase:'page',publishIndex:0},retryCount:0});
  const n=docs.get('cerRapidImports/'+id);
  await api.rapidImportPage({data:{id,page:n.nextPage,generation:0,phase:n.phase,publishIndex:0},retryCount:0});
  return [...docs].find(([k])=>k.includes('/vetting/'))[1];
};
test('Jev says no to a crop: the AI is asked to re-cut it, Jev is asked again, and the fixed box is recorded',async()=>{
  start();recropBox=[140,90,270,380];
  jevPlan=(keys,n)=>n===1?{figure_0:['no',.9]}:{};
  const q=await run('fig');
  assert.equal(recrops.length,1);assert.match(recrops[0],/Problems found: .*Jev judged the crop/);
  assert.equal(jevCalls.filter(b=>Object.keys(b.questions).join()==='figure_0').length,2);
  assert.deepEqual(q.jevFigures,[{index:0,state:'fixed',tries:1,reasons:[]}]);
  assert.deepEqual(q.blocks.find(b=>b.type==='image').cropSource.box_2d,[140,90,270,380]);
});
test('a crop Jev never accepts is retried twice, then kept and flagged rather than lost',async()=>{
  start(true);
  jevPlan=keys=>keys.includes('figure_0')&&keys.length===1?{figure_0:['no',.9]}:{};
  const q=await run('fig');
  assert.equal(recrops.length,2,'two AI re-cuts, no more');
  assert.equal(q.jevFigures[0].state,'flagged');
  assert.ok(q.blocks.find(b=>b.type==='image').url,'the picture is still there');
  assert.ok(q.autoCheck.findings.some(f=>f.type==='Crop'&&f.cropStatus==='unclear'),'the flag reaches the vetting card as a Crop finding');
  assert.notEqual(q.autoCheck.state,'green');
});
test('a confident clean pass from Jev skips the slow AI check; a no on the wording sends it to the AI with Jev\'s reason',async()=>{
  start(true);jevPlan=()=>({});
  let q=await run('fig');
  assert.equal(checks.length,0,'no AI read when Jev is sure');
  assert.deepEqual([q.autoCheck.state,q.autoCheck.jev],['green',true]);
  start(true);jevPlan=keys=>keys.includes('wording')?{wording:['no',.9]}:{};
  q=await run('fig');
  assert.equal(checks.length,1);assert.match(checks[0],/Problems already flagged by Jev/);
});
test('Jev unavailable changes nothing: every question is AI-checked exactly as before',async()=>{
  start(true);const real=globalThis.fetch;globalThis.fetch=async()=>({ok:false,status:503});
  try{const q=await run('fig');assert.equal(checks.length,1);assert.equal(recrops.length,0);assert.ok(q.autoCheck);}
  finally{globalThis.fetch=real;}
});
test('the browser review endpoint is administrator only and returns typed verdicts',async()=>{
  jevPlan=()=>({});
  const facts={excerpt:'Q',wordCount:8};
  await assert.rejects(api.cerJevReview({auth:{uid:'s',token:{}},data:{scope:'question',question:facts}}),/administrator/);
  await assert.rejects(api.cerJevReview({data:{scope:'question',question:facts}}),/Sign in/);
  const r=await api.cerJevReview({auth,data:{scope:'question',question:facts}});
  assert.equal(r.available,true);assert.equal(r.verdicts.wording.ok,true);
  await assert.rejects(api.cerJevReview({auth,data:{scope:'question',question:'nope'}}),/Invalid/);
});
