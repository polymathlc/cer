import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
const docs=new Map(), files=new Map(), tasks=[];
const clone=x=>x===undefined?undefined:structuredClone(x);
const snap=path=>({exists:docs.has(path),data:()=>clone(docs.get(path))});
const ref=path=>({path,get:async()=>snap(path)});
let failCommit=false;
const db={doc:ref,collection:name=>({doc:id=>ref(name+'/'+id),where:()=>({get:async()=>({docs:[...docs].filter(([k])=>k.startsWith(name+'/')).map(([k])=>snap(k))})})}),
 runTransaction:async fn=>{
   const writes=[];
   await fn({get:async r=>snap(r.path),create:(r,d)=>writes.push(['create',r.path,clone(d)]),update:(r,d)=>writes.push(['update',r.path,clone(d)])});
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
mock.module('firebase-functions/params',{namedExports:{defineSecret:()=>({value:()=>''}),defineString:(name,opts)=>({value:()=>opts.default})}});
let aiPages=[];
mock.module('@google/genai',{namedExports:{GoogleGenAI:class {
  models={generateContent:async request=>{
    const page=Number(/CURRENT page (\d+)/.exec(request.contents[0].parts[0].text)?.[1]);
    return {candidates:[{finishReason:'STOP'}],text:JSON.stringify({questions:aiPages[page-1]||[]})};
  }};
}}});
const api=await import('../index.js');
const auth={uid:'teacher',token:{admin:true,name:'Teacher'}};
const makeJob=(id='job')=>({id,ownerUid:'teacher',name:'paper.pdf',status:'queued',phase:'publish',publishIndex:0,nextPage:3,total:2,added:0,generation:0,autoCheck:false,checkpoint:'checkpoint',updatedAt:new Date().toISOString()});
const question={id:'q_rapid_job_1_0',title:'A',blocks:[],sourcePages:[]};
function setup(j=makeJob()){docs.clear();files.clear();tasks.length=0;docs.set('cerRapidImports/'+j.id,j);files.set('checkpoint',Buffer.from(JSON.stringify({pending:null,ready:[question]})));return j;}
test('duplicate delivery publishes once, atomically with checkpoint progress',async()=>{
 setup();const request={data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0},retryCount:0};
 await api.rapidImportPage(request);await api.rapidImportPage(request);
 assert.equal(docs.get('cerRapidImports/job').added,1);assert.equal(docs.get('cerRapidImports/job').status,'completed');
 assert.equal([...docs.keys()].filter(k=>k.includes('/vetting/')).length,1);
});
test('failure before transaction commit publishes nothing; retry completes once',async()=>{
 setup();const request={data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0},retryCount:0};failCommit=true;
 await assert.rejects(api.rapidImportPage(request));assert.equal(docs.get('cerRapidImports/job').added,0);
 assert.equal([...docs.keys()].filter(k=>k.includes('/vetting/')).length,0);
 await api.rapidImportPage(request);assert.equal(docs.get('cerRapidImports/job').added,1);
});
test('retry generation fences off an old worker',async()=>{
 const j=setup();j.status='failed';docs.set('cerRapidImports/job',j);
 await api.rapidImportRetry({auth,data:{id:'job'}});
 await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0},retryCount:0});
 assert.equal(docs.get('cerRapidImports/job').added,0);
 await api.rapidImportPage({data:{id:'job',page:3,generation:1,phase:'publish',publishIndex:0},retryCount:0});
 assert.equal(docs.get('cerRapidImports/job').added,1);
});
test('fifth failure is durable and retryable',async()=>{
 setup();files.clear();await assert.rejects(api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0},retryCount:4}));
 assert.equal(docs.get('cerRapidImports/job').status,'failed');assert.match(docs.get('cerRapidImports/job').error,/Missing/);
});
test('outbox does not enqueue upload-only records or error-only updates',async()=>{
 setup();const j=makeJob();
 await api.rapidImportDispatch({data:{before:{data:()=>undefined},after:{data:()=>({...j,status:'uploading'})}}});
 await api.rapidImportDispatch({data:{before:{data:()=>j},after:{data:()=>({...j,error:'retry'})}}});
 assert.equal(tasks.length,0);
 await api.rapidImportDispatch({data:{before:{data:()=>({...j,status:'uploading'})},after:{data:()=>j}}});
 assert.equal(tasks.length,1);assert.equal(tasks[0].data.phase,'publish');
});
test('missing PDF chunks cannot acknowledge safe-to-close',async()=>{
 setup({...makeJob(),status:'uploading',size:10,nextPage:1,phase:'page'});
 await assert.rejects(api.rapidImportFinish({auth,data:{id:'job'}}));
 assert.equal(docs.get('cerRapidImports/job').status,'uploading');
});
test('student and cross-owner requests are rejected',async()=>{
 setup();await assert.rejects(api.rapidImportStatus({auth:{uid:'student',token:{}}}),/administrator/);
 await assert.rejects(api.rapidImportFinish({auth:{uid:'other',token:{admin:true}},data:{id:'job'}}),/not found/);
});

function pdfFixture(pageCount) {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>'];
  objects.push('<< /Type /Pages /Kids ['+Array.from({length:pageCount},(_,i)=>(3+i*2)+' 0 R').join(' ')+'] /Count '+pageCount+' >>');
  for(let i=0;i<pageCount;i++) {
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents '+(4+i*2)+' 0 R /Resources << >> >>');
    const stream='0 0 0 rg 20 20 50 60 re f\n';objects.push('<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream');
  }
  let pdf='%PDF-1.4\n',offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';});
  const xref=Buffer.byteLength(pdf);pdf+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n';
  pdf+=offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
  pdf+='trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return Buffer.from(pdf);
}
test('full upload and real PDF rendering continue entirely server-side across three pages',async()=>{
  setup();docs.clear();files.clear();
  const payload=(text,number,continuation)=>({title:'Question '+number,topic:'Heat',sourceQuestionNumber:number,continuation,
    blocks:[{type:'text',text},{type:'image',box_2d:[0,0,500,500]},{type:'plainanswer',text:'Answer'},{type:'explanation',text:'Reason'}]});
  aiPages=[[payload('(a) First part','8',false)],[payload('(b) Second part','8',true)],[payload('(c) Third part','8',true),payload('New question','9',false)]];
  const pdf=pdfFixture(3);
  await api.rapidImportBegin({auth,data:{id:'realpdf',name:'three-pages.pdf',size:pdf.length,prompt:'Read science questions',engineOrder:['gemini'],topics:['Heat'],autoCheck:false}});
  await api.rapidImportChunk({auth,data:{id:'realpdf',index:0,data:pdf.toString('base64')}});
  await api.rapidImportFinish({auth,data:{id:'realpdf'}});
  // No client calls after this point: only durable server transitions.
  for(let i=0;i<10;i++) {
    const j=docs.get('cerRapidImports/realpdf');if(j.status==='completed')break;
    await api.rapidImportPage({data:{id:j.id,page:j.nextPage,generation:j.generation,phase:j.phase,publishIndex:j.publishIndex},retryCount:0});
  }
  const j=docs.get('cerRapidImports/realpdf');assert.equal(j.status,'completed');assert.equal(j.added,2);
  const questions=[...docs].filter(([k])=>k.includes('/vetting/')).map(([,q])=>q);
  const merged=questions.find(q=>q.sourceQuestionNumber==='8');
  assert.deepEqual(merged.sourcePages.map(p=>p.page),[1,2,3]);
  assert.deepEqual(merged.blocks.filter(b=>b.type==='text').map(b=>b.part),['a','b','c']);
  assert.equal(merged.blocks.filter(b=>b.type==='image').length,3);
});
