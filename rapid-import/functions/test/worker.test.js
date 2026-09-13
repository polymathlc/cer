import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
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
let aiPages=[], aiPrompts=[];
mock.module('@google/genai',{namedExports:{GoogleGenAI:class {
  models={generateContent:async request=>{
    aiPrompts.push(request.contents[0].parts[0].text);
    const page=Number(/CURRENT page (\d+)/.exec(request.contents[0].parts[0].text)?.[1]);
    return {candidates:[{finishReason:'STOP'}],text:JSON.stringify({questions:aiPages[page-1]||[]})};
  }};
}}});
const api=await import('../index.js');
const auth={uid:'teacher',token:{admin:true,name:'Teacher'}};
const makeJob=(id='job')=>({id,ownerUid:'teacher',name:'paper.pdf',status:'queued',phase:'publish',publishIndex:0,nextPage:3,total:2,added:0,generation:0,autoCheck:false,checkpoint:'checkpoint',updatedAt:new Date().toISOString()});
const question={id:'q_rapid_job_1_0',title:'A',blocks:[],sourcePages:[]};
function setup(j=makeJob()){docs.clear();files.clear();tasks.length=0;aiPrompts=[];docs.set('cerRapidImports/'+j.id,j);files.set('checkpoint',Buffer.from(JSON.stringify({pending:null,ready:[question]})));return j;}
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
test('full upload and real PDF rendering continue entirely server-side across three pages',async()=>{
  setup();docs.clear();files.clear();
  const payload=(text,number,continuation)=>({title:'Question '+number,topic:'Heat',sourceQuestionNumber:number,continuation,
    blocks:[{type:'text',text},{type:'image',box_2d:[700,80,960,390]},{type:'plainanswer',text:'Answer'},{type:'explanation',text:'Reason'}]});
  aiPages=[[payload('(a) First part','8',false)],[payload('(b) Second part','8',true)],[payload('(c) Third part','8',true),payload('New question','9',false)]];
  const pdf=pdfFixture(3,['1 0 0 rg 20 20 50 60 re f\n','0 0 1 rg 20 20 50 60 re f\n','0 0.5 0 rg 20 20 50 60 re f\n']);
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
  const pictures=merged.blocks.filter(b=>b.type==='image');
  assert.equal(pictures.length,3);
  for(const [i,picture] of pictures.entries()) {
    assert.notEqual(picture.url,merged.sourcePages[i].url,'a valid figure must be cropped');
    const path=decodeURIComponent(new URL(picture.url).pathname.split('/o/')[1]);
    const img=await loadImage(files.get(path)),canvas=createCanvas(img.width,img.height),ctx=canvas.getContext('2d');
    ctx.drawImage(img,0,0);
    const rgb=[...ctx.getImageData(Math.floor(img.width/2),Math.floor(img.height/2),1,1).data].slice(0,3);
    assert.equal(rgb.indexOf(Math.max(...rgb)),[0,2,1][i],'each continuation figure must come from the current page, not the previous context page');
  }
});

test('real PDF worker keeps failed crops and mixed-case figures in the correct worksheet positions',async()=>{
  const pdf=pdfFixture(1,['1 0 0 rg 20 220 50 35 re f\n0 0 1 rg 110 100 60 40 re f\n']);
  const j=setup({...makeJob('figures'),phase:'page',nextPage:1,total:1,checkpoint:null,path:'original.pdf',engineOrder:['gemini'],prompt:'Read all questions'});
  files.set(j.path,pdf);
  aiPages=[[{title:'Diagrams',sourceQuestionNumber:'1',blocks:[
    {type:'text',text:'(a) Examine the first figure.'},
    {type:' IMAGE ',caption:'First figure',box_2d:[130,80,280,390]},
    {type:'text',text:'(b) Examine the missing figure.'},
    {type:'Image',caption:'Blank selection',box_2d:[350,50,450,300]},
    {type:'text',text:'(c) Examine the third figure.'},
    {type:'image',caption:'Third figure',box:[500,520,690,900]},
    {type:'image',caption:'Whole page selection',box_2d:[0,0,1000,1000]},
    {type:'image',caption:'Malformed selection',box_2d:[900,100,300,800]},
    {type:'plainanswer',text:'Answer'}
  ]}]];
  await api.rapidImportPage({data:{id:j.id,page:1,generation:0,phase:'page',publishIndex:0},retryCount:0});
  const next=docs.get('cerRapidImports/figures');
  await api.rapidImportPage({data:{id:j.id,page:next.nextPage,generation:0,phase:next.phase,publishIndex:0},retryCount:0});
  const q=[...docs].find(([key])=>key.includes('/vetting/'))[1];
  assert.deepEqual(q.blocks.map(b=>b.type),['text','image','text','image','text','image','image','image','plainanswer']);
  const pictures=q.blocks.filter(b=>b.type==='image'),source=q.sourcePages[0].url;
  assert.equal(pictures.length,5,'required figures cannot be dropped when cropping fails');
  assert.deepEqual(pictures.map(b=>b.part),['a','b','c','c','c']);
  assert.equal(pictures[1].url,source,'blank crop must retain its source in its own slot');
  assert.equal(pictures[3].url,source,'whole-page box must be marked as a fallback');
  assert.equal(pictures[4].url,source,'malformed box must retain its source');
  assert.equal(q.diagramWhole,true);
  const decoded=await Promise.all([pictures[0],pictures[2]].map(async b=>{
    assert.notEqual(b.url,source);
    const path=decodeURIComponent(new URL(b.url).pathname.split('/o/')[1]);
    const img=await loadImage(files.get(path));
    const canvas=createCanvas(img.width,img.height),ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    return {width:img.width,height:img.height,pixel:[...ctx.getImageData(Math.floor(img.width/2),Math.floor(img.height/2),1,1).data]};
  }));
  assert.ok(decoded[0].pixel[0]>200&&decoded[0].pixel[2]<40,'first image slot must hold the red first figure');
  assert.ok(decoded[1].pixel[2]>200&&decoded[1].pixel[0]<40,'third image slot must hold the blue third figure');
  assert.ok(decoded.every(img=>img.width<300&&img.height<220),'cropped figures should lose the loose page margins');
  assert.match(aiPrompts[0],/source reading order/);
  assert.match(aiPrompts[0],/CURRENT image 1 only/);
  assert.match(aiPrompts[0],/complete labels/);
  assert.match(aiPrompts[0],/Exclude surrounding question prose/);
  assert.equal(docs.get('cerRapidImports/figures').status,'completed');
});
