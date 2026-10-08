import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {CHUNK_BYTES} from '../core.js';
const docs=new Map(), files=new Map(), tasks=[];
const clone=x=>x===undefined?undefined:structuredClone(x);
const snap=path=>({exists:docs.has(path),data:()=>clone(docs.get(path))});
const ref=path=>({path,get:async()=>snap(path)});
let failCommit=false;
let beforeDownload=null;
let beforeSave=null;
const db={doc:ref,collection:name=>({doc:id=>ref(name+'/'+id),where:()=>({get:async()=>({docs:[...docs].filter(([k])=>k.startsWith(name+'/')).map(([k])=>snap(k))})})}),
 runTransaction:async fn=>{
   const writes=[];
   await fn({get:async r=>snap(r.path),create:(r,d)=>writes.push(['create',r.path,clone(d)]),update:(r,d)=>writes.push(['update',r.path,clone(d)])});
   if(failCommit){failCommit=false;throw new Error('Simulated network failure before commit');}
   for(const [op,path] of writes) if(op==='create'&&docs.has(path)) throw new Error('already exists');
   for(const [op,path,value] of writes) docs.set(path,op==='update'?{...docs.get(path),...value}:value);
 }};
const bucket={name:'test',file:path=>({save:async b=>{if(beforeSave)await beforeSave(path,b);files.set(path,Buffer.from(b));},download:async()=>{if(beforeDownload)await beforeDownload(path);if(!files.has(path))throw new Error('Missing upload');return [files.get(path)];}})};
mock.module('firebase-admin/app',{namedExports:{initializeApp:()=>({})}});
mock.module('firebase-admin/firestore',{namedExports:{getFirestore:()=>db}});
mock.module('firebase-admin/storage',{namedExports:{getStorage:()=>({bucket:()=>bucket})}});
mock.module('firebase-admin/functions',{namedExports:{getFunctions:()=>({taskQueue:()=>({enqueue:async(data,opts)=>tasks.push({data,opts})})})}});
mock.module('firebase-functions/v2/https',{namedExports:{onCall:(opts,fn)=>fn,HttpsError:class extends Error {constructor(code,message){super(message);this.code=code;}}}});
mock.module('firebase-functions/v2/firestore',{namedExports:{onDocumentWritten:(opts,fn)=>fn}});
mock.module('firebase-functions/v2/tasks',{namedExports:{onTaskDispatched:(opts,fn)=>fn}});
mock.module('firebase-functions/params',{namedExports:{defineSecret:()=>({value:()=>''}),defineString:(name,opts)=>({value:()=>opts.default})}});
let aiPages=[], aiPrompts=[], modelResponse=null;
// The crop clean-up pass answers "already clean" unless a test sets a box.
globalThis.REFINE={n:0,box:null};
mock.module('@google/genai',{namedExports:{GoogleGenAI:class {
  models={generateContent:async request=>{
    aiPrompts.push(request.contents[0].parts[0].text);
    if(modelResponse) {const response=await modelResponse(request);if(response)return response;}
    const text=request.contents[0].parts[0].text;
    if(text.startsWith('Check this science question')) {
      const q=JSON.parse(text.split('Question:\n').at(-1));
      return {candidates:[{finishReason:'STOP'}],text:JSON.stringify({findings:[],repairs:[],imageAudits:q.blocks.filter(b=>b.type==='image').map(b=>({blockId:b.id,complete:true,faithful:true,issues:[]}))})};
    }
    if(/auto-cropped figure/.test(text)) {
      const R=globalThis.REFINE;R.n++;
      const box=typeof R.box==='function'?await R.box(request.contents[0].parts[1].inlineData.data):R.box;
      return {candidates:[{finishReason:'STOP'}],text:JSON.stringify(box?{clean:false,box_2d:box}:{clean:true})};
    }
    const page=Number(/CURRENT page (\d+)/.exec(text)?.[1]);
    return {candidates:[{finishReason:'STOP'}],text:JSON.stringify({questions:aiPages[page-1]||[]})};
  }};
}}});
const api=await import('../index.js');
const auth={uid:'teacher',token:{admin:true,name:'Teacher'}};
const makeJob=(id='job')=>({id,ownerUid:'teacher',name:'paper.pdf',status:'queued',phase:'publish',publishIndex:0,nextPage:3,total:2,added:0,generation:0,autoCheck:false,checkpoint:'checkpoint',updatedAt:new Date().toISOString()});
const question={id:'q_rapid_job_1_0',title:'A',blocks:[],sourcePages:[]};
function setup(j=makeJob()){docs.clear();files.clear();tasks.length=0;aiPrompts=[];modelResponse=null;beforeDownload=null;beforeSave=null;globalThis.REFINE={n:0,box:null};docs.set('cerRapidImports/'+j.id,j);files.set('checkpoint',Buffer.from(JSON.stringify({pending:null,ready:[question]})));return j;}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function waitFor(test) {for(let i=0;i<1000&&!test();i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(test(),'the expected asynchronous work must start');}
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
test('PDF finalisation reads four chunks together and joins reverse completions in exact upload order',async()=>{
 const size=CHUNK_BYTES*5+7;
 setup({...makeJob(),status:'uploading',size,nextPage:1,phase:'page'});
 const chunks=Array.from({length:6},(_,i)=>Buffer.alloc(Math.min(CHUNK_BYTES,size-i*CHUNK_BYTES),i+1));
 chunks.forEach((chunk,i)=>files.set(`cer-rapid/teacher/job/chunks/${i}`,chunk));
 let active=0,peak=0;
 const held=[];
 beforeDownload=async path=>{if(!path.includes('/chunks/'))return;const d=deferred();held.push(d);active++;peak=Math.max(peak,active);await d.promise;active--;};
 const running=api.rapidImportFinish({auth,data:{id:'job'}});
 await waitFor(()=>held.length===4);
 assert.equal(docs.get('cerRapidImports/job').status,'uploading');
 for(let i=3;i>=0;i--)held[i].resolve();
 await waitFor(()=>held.length===6);
 held[5].resolve();held[4].resolve();await running;
 assert.equal(peak,4);assert.equal(active,0);
 assert.deepEqual(files.get('cer-rapid/teacher/job/original.pdf'),Buffer.concat(chunks));
 assert.equal(docs.get('cerRapidImports/job').status,'queued');
});
test('a missing chunk stops new reads and drains active downloads before finalisation fails',async()=>{
 setup({...makeJob(),status:'uploading',size:CHUNK_BYTES*7,nextPage:1,phase:'page'});
 const held=deferred(),started=[];
 beforeDownload=async path=>{if(!path.includes('/chunks/'))return;const i=Number(path.split('/').at(-1));started.push(i);if(i===0)throw new Error('Missing first chunk');await held.promise;};
 let settled=false;
 const running=api.rapidImportFinish({auth,data:{id:'job'}}).then(()=>{settled=true;},error=>{settled=true;return error;});
 await waitFor(()=>started.length===4);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false,'failure must await the already-started downloads');
 assert.deepEqual(started,[0,1,2,3]);held.resolve();
 const error=await running;assert.match(error.message,/Missing first chunk/);
 assert.deepEqual(started,[0,1,2,3],'later chunks are not started after a failure');
 assert.equal(files.has('cer-rapid/teacher/job/original.pdf'),false);
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
test('page preparation overlaps source preservation, bounds all question crop chains to three and uploads to four, preserving ordered fallback slots',async()=>{
 const j=setup({...makeJob('parallel'),phase:'page',nextPage:1,total:1,checkpoint:null,path:'original.pdf',engineOrder:['gemini'],decisions:false,enhanceImages:false,prompt:'Read all questions'});
 files.set(j.path,pdfFixture(1));
 aiPages=[Array.from({length:4},(_,i)=>({title:'Question '+i,sourceQuestionNumber:String(i+1),blocks:[
   {type:'text',text:`Question wording ${i}`},{type:'image',box_2d:[700,80,960,390]},
   {type:'image',box_2d:i===0?[900,100,300,800]:[700,80,960,390]},{type:'plainanswer',text:'Answer'}]}))];
 const source=deferred(),models=deferred(),uploads=deferred();
 let sourceStarted=false,activeModels=0,modelPeak=0,activeStores=0,storePeak=0,storeStarted=0;
 modelResponse=async request=>{
   if(!/auto-cropped figure/.test(request.contents[0].parts[0].text))return;
   activeModels++;modelPeak=Math.max(modelPeak,activeModels);await models.promise;activeModels--;
   return reply({clean:true});
 };
 beforeSave=async path=>{
   if(path.endsWith('/page-1.jpg')){sourceStarted=true;await source.promise;return;}
   if(!path.includes('/images/'))return;
   activeStores++;storeStarted++;storePeak=Math.max(storePeak,activeStores);await uploads.promise;activeStores--;
 };
 const running=api.rapidImportPage({data:{id:j.id,page:1,generation:0,phase:'page',publishIndex:0},retryCount:0});
 await waitFor(()=>activeModels===3);
 assert.equal(sourceStarted,true,'the original page is preserved while models prepare crops');
 assert.equal(docs.get('cerRapidImports/'+j.id).checkpoint,null);
 models.resolve();source.resolve();await waitFor(()=>storeStarted===4);
 assert.equal(docs.get('cerRapidImports/'+j.id).nextPage,1,'no checkpoint progress before all image writes settle');
 uploads.resolve();await running;
 assert.equal(modelPeak,3);assert.equal(storePeak,4);assert.equal(activeModels+activeStores,0);
 const job=docs.get('cerRapidImports/'+j.id),checkpoint=JSON.parse(files.get(job.checkpoint));
 assert.deepEqual(checkpoint.ready.map(q=>q.sourceQuestionNumber),['1','2','3','4']);
 assert.deepEqual(checkpoint.ready.map(q=>q.id),[0,1,2,3].map(i=>`q_rapid_parallel_1_${i}`));
 assert.equal(checkpoint.ready[0].blocks.filter(b=>b.type==='image')[1].url,checkpoint.ready[0].sourcePages[0].url);
 assert.equal(checkpoint.ready[0].diagramWhole,true);
 for(let i=0;i<4;i++)for(const [n,b] of checkpoint.ready[i].blocks.filter(b=>b.type==='image').entries()) {
   if(i===0&&n===1)continue;
   assert.ok(decodeURIComponent(new URL(b.url).pathname).endsWith(`page-1-q${i}-figure${n}.jpg`),'each figure retains its source-order slot');
 }
});
test('page upload failure drains active image writes and cannot advance or overwrite a later generation',async()=>{
 const j=setup({...makeJob('drain'),phase:'page',nextPage:1,total:1,checkpoint:null,path:'original.pdf',engineOrder:['gemini'],decisions:false,enhanceImages:false,prompt:'Read all questions'});
 files.set(j.path,pdfFixture(1));
 aiPages=[[{title:'Question',sourceQuestionNumber:'1',blocks:[{type:'text',text:'Observe the figures'},
   ...Array.from({length:6},()=>({type:'image',box_2d:[700,80,960,390]})),{type:'plainanswer',text:'Answer'}]}]];
 const held=deferred(),writes=[];
 beforeSave=async path=>{
   if(!/figure\d+\.jpg$/.test(path))return;
   const n=Number(/figure(\d+)\.jpg$/.exec(path)[1]);writes.push(n);
   if(n===0)throw new Error('Simulated crop write failure');await held.promise;
 };
 let settled=false;
 const running=api.rapidImportPage({data:{id:j.id,page:1,generation:0,phase:'page',publishIndex:0},retryCount:0})
   .then(()=>{settled=true;},error=>{settled=true;return error;});
 await waitFor(()=>writes.length===4);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false);assert.deepEqual(writes,[0,1,2,3]);
 docs.set('cerRapidImports/'+j.id,{...docs.get('cerRapidImports/'+j.id),generation:1,error:'new generation owns the job'});
 held.resolve();const error=await running;assert.match(error.message,/crop write failure/);
 assert.deepEqual(writes,[0,1,2,3]);
 const latest=docs.get('cerRapidImports/'+j.id);
 assert.equal(latest.checkpoint,null);assert.equal(latest.nextPage,1);assert.equal(latest.generation,1);assert.equal(latest.error,'new generation owns the job');
 assert.equal([...files.keys()].some(path=>path.includes('/checkpoints/')),false);
});
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
    await api.rapidImportPage({data:{id:j.id,page:j.nextPage,generation:j.generation,phase:j.phase,publishIndex:j.publishIndex,figureIndex:j.figureIndex},retryCount:0});
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

const reply=value=>({candidates:[{finishReason:'STOP'}],text:JSON.stringify(value)});
const imageUrl=path=>'https://firebasestorage.googleapis.com/v0/b/test/o/'+encodeURIComponent(path)+'?alt=media';
function savedFigure(kind='diagram') {
  const j=setup({...makeJob(),autoCheck:true,engineOrder:['gemini'],decisions:false,enhanceImages:true});
  const path='cer-rapid/teacher/job/images/raw/crop.jpg',url=imageUrl(path);
  const canvas=createCanvas(120,90),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,120,90);ctx.fillStyle='#c02010';ctx.fillRect(15,15,75,55);
  const bytes=canvas.toBuffer('image/jpeg');files.set(path,bytes);
  const q={id:'q_rapid_job_1_0',title:'Observe the figure',topic:'Heat',blocks:[
    {id:'stem',type:'text',content:'Observe this figure and explain what happens to the water.'},
    {id:'figure',type:'image',url,originalCropUrl:url,preColourUrl:url,figureKind:kind,cropSource:{url:imageUrl('cer-rapid/teacher/job/images/raw/page.jpg'),imageUrl:url}},
    {id:'answer',type:'plainanswer',content:'The water gains heat.'},
    {id:'explanation',type:'explanation',content:'Heat transfers from the warmer object to the water.'}
  ],sourcePages:[],rapidImportId:'job',status:'pending'};
  docs.set('users/teacher/vetting/'+q.id,q);
  return {j,q,url,bytes};
}
const imageModelReply=bytes=>({candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'image/jpeg',data:bytes.toString('base64')}}]}}]});
test('audit image reads overlap with a four-download bound, share duplicate paths and keep every image label in source order',async()=>{
  const {q}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
  const paths=Array.from({length:6},(_,i)=>`cer-rapid/teacher/job/images/raw/audit-${i}.jpg`);
  paths.forEach((path,i)=>files.set(path,Buffer.from('pixels-'+i)));
  q.sourcePages=paths.map((path,i)=>({page:i+1,url:imageUrl(path)}));
  q.blocks[1].originalCropUrl=imageUrl(paths[0]);q.blocks[1].url=imageUrl(paths[0])+'&token=another-token';
  q.blocks[2].answerImg=imageUrl(paths[1]);q.answerKeyImage=imageUrl(paths[2]);
  files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
  let active=0,maximum=0;
  const reads=[];
  beforeDownload=async path=>{
    if(!path.includes('/images/'))return;
    reads.push(path);active++;maximum=Math.max(maximum,active);
    await new Promise(resolve=>setImmediate(resolve));active--;
  };
  modelResponse=request=>{
    if(!request.contents[0].parts[0].text.startsWith('Check this science question'))return;
    const parts=request.contents[0].parts,prompt=parts[0].text;
    const expected=[0,1,2,3,4,5,0,0,1,2];
    assert.deepEqual(parts.slice(1).map(p=>p.inlineData.data),expected.map(i=>Buffer.from('pixels-'+i).toString('base64')));
    for(let i=0;i<6;i++)assert.ok(prompt.includes(`Image ${i+1}: Original PDF page ${i+1}`));
    assert.ok(prompt.includes('Image 7: Original figure crop figure'));
    assert.ok(prompt.includes('Image 8: Displayed figure figure'));
    assert.ok(prompt.includes('Image 9: Annotated answer figure answer'));
    assert.ok(prompt.includes('Image 10: Answer key image'));
    return reply({findings:[],repairs:[],imageAudits:['figure','answer:answerImg','$answerKey'].map(blockId=>({blockId,complete:true,faithful:true,issues:[]}))});
  };
  await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0},retryCount:0});
  assert.equal(maximum,4,'four independent Storage reads, not serial or unbounded');
  assert.equal(reads.length,6,'ten labelled inputs require only six unique Storage reads');
  assert.deepEqual([...reads].sort(),[...paths].sort());
  assert.notEqual(docs.get('users/teacher/vetting/'+q.id).autoCheck.state,'error');
});
test('one unreadable image in a parallel batch keeps the check in error and never invokes the visual AI',async()=>{
  const {q}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
  q.sourcePages=[{page:1,url:imageUrl('cer-rapid/teacher/job/images/raw/missing.jpg')}];
  files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
  await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0},retryCount:0});
  const saved=docs.get('users/teacher/vetting/'+q.id);
  assert.equal(saved.autoCheck.state,'error');assert.match(saved.autoCheck.error,/Missing upload/);
  assert.equal(aiPrompts.length,0,'missing pixels must never receive a fresh visual audit stamp');
});
test('a repaired figure is rechecked with its current pixels while unchanged source paths are read once',async()=>{
  const {q,url}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
  const changedPath='cer-rapid/teacher/job/images/raw/changed.jpg';files.set(changedPath,Buffer.from('changed pixels'));
  q.blocks[1].url=imageUrl(changedPath);delete q.blocks[1].cropSource;
  q.sourcePages=[{page:1,url}];
  files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
  const reads=[];beforeDownload=async path=>{if(path.includes('/images/'))reads.push(path);};
  let checks=0;
  modelResponse=request=>{
    if(!request.contents[0].parts[0].text.startsWith('Check this science question'))return;
    checks++;
    const images=request.contents[0].parts.slice(1).map(part=>part.inlineData.data);
    if(checks===1)assert.equal(images[2],Buffer.from('changed pixels').toString('base64'));
    else assert.equal(images[2],images[1],'the restored current figure must be audited, not the cached rejected display');
    return reply({findings:[],repairs:[],imageAudits:[{blockId:'figure',complete:true,faithful:checks>1,issues:checks===1?['The proposed display lost a label.']:[]}]});
  };
  await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0},retryCount:0});
  const saved=docs.get('users/teacher/vetting/'+q.id);
  assert.equal(checks,2);assert.equal(saved.blocks[1].url,url);assert.equal(saved.autoCheck.state,'green');
  assert.equal(reads.length,2,'both visual passes reuse one read per original immutable path');
  assert.ok(saved.autoCheck.repairs.some(repair=>repair.blockId==='figure'));
});
test('new uploads cannot disable automatic checks or enhancement',async()=>{
  setup();docs.clear();
  await api.rapidImportBegin({auth,data:{id:'required',size:20,prompt:'Read the paper',autoCheck:false,enhanceImages:false}});
  const j=docs.get('cerRapidImports/required');assert.equal(j.autoCheck,true);assert.equal(j.enhanceImages,true);
  assert.deepEqual(j.engineOrder,['openai','gemini','kimi']);
  assert.deepEqual((await api.rapidImportStatus({auth})).capabilities,{imageEditing:true,automaticChecks:true,automaticEnhancement:true});
});
test('new imports preserve an explicitly selected backup and store every failover engine',async()=>{
  setup();docs.clear();
  await api.rapidImportBegin({auth,data:{id:'selected',size:20,prompt:'Read the paper',engineOrder:['kimi','unknown','kimi']}});
  assert.deepEqual(docs.get('cerRapidImports/selected').engineOrder,['kimi','openai','gemini']);
});
test('verified table enhancement is monochrome and repeated requests always use the immutable original',async()=>{
  const {q,url,bytes}=savedFigure('table');let generations=0;
  modelResponse=request=>{
    if(request.config.responseModalities) {
      generations++;assert.match(request.contents[0].parts[0].text,/BLACK AND WHITE/);
      assert.equal(request.contents[0].parts[1].inlineData.data,bytes.toString('base64'));
      return imageModelReply(bytes);
    }
    if(request.contents[0].parts[0].text.startsWith('Compare image 1'))return reply({faithful:true,differences:[]});
  };
  const first=await api.rapidVettingImage({auth,data:{questionId:q.id,blockId:'figure',mode:'colour',expectedUrl:url}});
  const figure=first.question.blocks[1];assert.notEqual(figure.url,url);assert.equal(figure.originalCropUrl,url);assert.equal(figure.preColourUrl,url);assert.equal(figure.cropSource.imageUrl,figure.url);assert.equal(figure.enhancement.mode,'bw');
  const enhanced=await loadImage(files.get(decodeURIComponent(new URL(figure.url).pathname.split('/o/')[1])));
  const canvas=createCanvas(enhanced.width,enhanced.height),ctx=canvas.getContext('2d');ctx.drawImage(enhanced,0,0);
  const pixel=[...ctx.getImageData(40,40,1,1).data];assert.ok(Math.max(...pixel.slice(0,3))-Math.min(...pixel.slice(0,3))<=2);
  await api.rapidVettingImage({auth,data:{questionId:q.id,blockId:'figure',mode:'bw',expectedUrl:figure.url}});
  assert.equal(generations,2);assert.ok(aiPrompts.some(p=>p.includes('Displayed figure figure')),'checker reads the resulting figure');
});
test('unfaithful regeneration cannot replace the saved figure or lose the original',async()=>{
  const {q,url,bytes}=savedFigure();
  modelResponse=request=>request.config.responseModalities?imageModelReply(bytes):reply({faithful:false,differences:['Arrow reversed']});
  await assert.rejects(api.rapidVettingImage({auth,data:{questionId:q.id,blockId:'figure',mode:'colour',expectedUrl:url}}),/not verified/);
  assert.deepEqual(docs.get('users/teacher/vetting/'+q.id),q);
});
test('concurrent teacher changes abort regeneration instead of overwriting their question',async()=>{
  const {q,url,bytes}=savedFigure();
  modelResponse=request=>{
    if(request.config.responseModalities) {
      docs.get('users/teacher/vetting/'+q.id).blocks[0].content='Teacher changed the question while generation was running.';
      return imageModelReply(bytes);
    }
    if(request.contents[0].parts[0].text.startsWith('Compare image 1'))return reply({faithful:true,differences:[]});
  };
  await assert.rejects(api.rapidVettingImage({auth,data:{questionId:q.id,blockId:'figure',mode:'colour',expectedUrl:url}}),e=>e.code==='aborted');
  const saved=docs.get('users/teacher/vetting/'+q.id);assert.match(saved.blocks[0].content,/Teacher changed/);assert.equal(saved.blocks[1].url,url);
});
test('resize guards role, owner, displayed URL and current scale',async()=>{
  const {q,url}=savedFigure();
  const data={questionId:q.id,blockId:'figure',expectedUrl:url,expectedScale:null,scale:.7};
  await assert.rejects(api.rapidVettingImage({auth:{uid:'student',token:{}},data}),/administrator/);
  await assert.rejects(api.rapidVettingImage({auth:{uid:'other',token:{admin:true}},data}),/not found/);
  await assert.rejects(api.rapidVettingImage({auth,data:{...data,scale:100}}),/Invalid/);
  const r=await api.rapidVettingImage({auth,data});assert.equal(r.question.blocks[1].scale,.7);
  await assert.rejects(api.rapidVettingImage({auth,data}),e=>e.code==='aborted');
});
test('durable enhancement checkpoints two complete figures together and fences replayed image tasks',async()=>{
  const {q,bytes}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
  const j={...docs.get('cerRapidImports/job'),phase:'enhance',figureIndex:1};docs.set('cerRapidImports/job',j);
  q.blocks.splice(2,0,{...q.blocks[1],id:'second'});files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
  let count=0;modelResponse=request=>{
    if(request.config.responseModalities){count++;return imageModelReply(bytes);}
    if(request.contents[0].parts[0].text.startsWith('Compare image 1'))return reply({faithful:true,differences:[]});
  };
  const first={data:{id:'job',page:3,generation:0,phase:'enhance',publishIndex:0,figureIndex:1},retryCount:0};
  await api.rapidImportPage(first);await api.rapidImportPage(first);
  assert.equal(count,2);assert.equal(docs.get('cerRapidImports/job').phase,'publish');assert.equal(docs.get('cerRapidImports/job').figureIndex,0);assert.equal(docs.has('users/teacher/vetting/'+q.id),false);
  await api.rapidImportPage({...first,data:{...first.data,figureIndex:2}});
  await api.rapidImportPage({...first,data:{...first.data,phase:'publish',figureIndex:0}});
  assert.equal(count,2);assert.equal(docs.get('cerRapidImports/job').status,'completed');assert.equal(docs.get('cerRapidImports/job').added,1);
});
test('three enhancement figures start only two at a time and advance after the selected pair',async()=>{
  const {q,bytes}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
  docs.set('cerRapidImports/job',{...docs.get('cerRapidImports/job'),phase:'enhance',figureIndex:1});
  q.blocks.splice(2,0,{...q.blocks[1],id:'second'},{...q.blocks[1],id:'third'});
  files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
  const held=[deferred(),deferred()];let calls=0,active=0,peak=0,verified=0;
  modelResponse=async request=>{
    if(request.config.responseModalities){const n=calls++;active++;peak=Math.max(peak,active);if(n<2)await held[n].promise;active--;return imageModelReply(bytes);}
    if(request.contents[0].parts[0].text.startsWith('Compare image 1')){verified++;return reply({faithful:true,differences:[]});}
  };
  const first={data:{id:'job',page:3,generation:0,phase:'enhance',publishIndex:0,figureIndex:1},retryCount:0};
  const running=api.rapidImportPage(first);await waitFor(()=>calls===2);
  assert.equal(active,2,'both enhancement model calls must start immediately');
  held[1].resolve();await waitFor(()=>verified===1);
  assert.equal(docs.get('cerRapidImports/job').checkpoint,'checkpoint','one completed figure cannot advance the paired checkpoint');
  held[0].resolve();await running;
  assert.equal(peak,2);assert.equal(calls,2);
  const next=docs.get('cerRapidImports/job');assert.equal(next.phase,'enhance');assert.equal(next.figureIndex,3);
  const saved=JSON.parse(files.get(next.checkpoint)).ready[0];
  assert.equal(saved.blocks[1].enhancement.state,'done');assert.equal(saved.blocks[2].enhancement.state,'done');assert.equal(saved.blocks[3].enhancement,undefined);
  await api.rapidImportPage(first);assert.equal(calls,2,'replaying the first paired cursor is fenced');
  await api.rapidImportPage({...first,data:{...first.data,figureIndex:3}});
  assert.equal(calls,3);assert.equal(verified,3);assert.equal(docs.get('cerRapidImports/job').phase,'publish');
});
test('a paired enhancement preserves one failed original and one fully verified result with visible review findings',async()=>{
  const {q,bytes,url}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
  docs.set('cerRapidImports/job',{...docs.get('cerRapidImports/job'),phase:'enhance',figureIndex:1});
  q.blocks.splice(2,0,{...q.blocks[1],id:'second',figureKind:'table'});files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
  let calls=0,verified=0;
  modelResponse=request=>{
    if(request.config.responseModalities){calls++;if(!request.contents[0].parts[0].text.includes('BLACK AND WHITE'))throw new Error('First figure service unavailable');return imageModelReply(bytes);}
    if(request.contents[0].parts[0].text.startsWith('Compare image 1')){verified++;return reply({faithful:true,differences:[]});}
  };
  const first={data:{id:'job',page:3,generation:0,phase:'enhance',publishIndex:0,figureIndex:1},retryCount:0};
  await api.rapidImportPage(first);
  assert.equal(calls,2);assert.equal(verified,1);
  const checkpoint=JSON.parse(files.get(docs.get('cerRapidImports/job').checkpoint));
  assert.equal(checkpoint.ready[0].blocks[1].url,url);assert.equal(checkpoint.ready[0].blocks[1].enhancement.state,'error');
  assert.equal(checkpoint.ready[0].blocks[2].enhancement.state,'done');assert.notEqual(checkpoint.ready[0].blocks[2].url,url);
  await api.rapidImportPage({...first,data:{...first.data,phase:'publish',figureIndex:0}});
  const saved=docs.get('users/teacher/vetting/'+q.id);
  assert.equal(saved.autoCheck.state,'amber');assert.ok(saved.autoCheck.findings.some(f=>/First figure service unavailable/.test(f.detail)));
  assert.equal(saved.blocks[1].originalCropUrl,url);assert.equal(saved.blocks[2].originalCropUrl,url);
});
test('paired enhancement cannot advance when its checkpoint write fails, and an in-flight retry generation owns the cursor',async()=>{
  for(const changeGeneration of [false,true]) {
    const {q,bytes}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
    docs.set('cerRapidImports/job',{...docs.get('cerRapidImports/job'),phase:'enhance',figureIndex:1});
    q.blocks.splice(2,0,{...q.blocks[1],id:'second'});files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
    const held=deferred();let calls=0;
    modelResponse=async request=>{
      if(request.config.responseModalities){calls++;await held.promise;return imageModelReply(bytes);}
      if(request.contents[0].parts[0].text.startsWith('Compare image 1'))return reply({faithful:true,differences:[]});
    };
    if(!changeGeneration)beforeSave=async path=>{if(path.includes('/checkpoints/'))throw new Error('Checkpoint write unavailable');};
    const running=api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'enhance',publishIndex:0,figureIndex:1},retryCount:0});
    const result=running.then(()=>null,error=>error);await waitFor(()=>calls===2);
    if(changeGeneration)docs.set('cerRapidImports/job',{...docs.get('cerRapidImports/job'),generation:1,error:'new generation'});
    held.resolve();const error=await result;
    if(changeGeneration)assert.equal(error,null);else assert.match(error.message,/Checkpoint write unavailable/);
    const latest=docs.get('cerRapidImports/job');
    assert.equal(latest.checkpoint,'checkpoint');assert.equal(latest.phase,'enhance');assert.equal(latest.figureIndex,1);assert.equal(latest.added,0);
    if(changeGeneration){assert.equal(latest.generation,1);assert.equal(latest.error,'new generation');}
    assert.equal(docs.has('users/teacher/vetting/'+q.id),false);
  }
});
test('unverified enhancement is published with its original and a visible finding, never a green light',async()=>{
  const {q,url,bytes}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
  docs.set('cerRapidImports/job',{...docs.get('cerRapidImports/job'),phase:'enhance',figureIndex:1});
  files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
  modelResponse=request=>{
    if(request.config.responseModalities)return imageModelReply(bytes);
    if(request.contents[0].parts[0].text.startsWith('Compare image 1'))return reply({faithful:false,differences:['Label lost']});
  };
  await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'enhance',publishIndex:0,figureIndex:1},retryCount:0});
  await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0,figureIndex:0},retryCount:0});
  const saved=docs.get('users/teacher/vetting/'+q.id);assert.equal(saved.blocks[1].url,url);assert.equal(saved.autoCheck.state,'amber');assert.match(saved.autoCheck.findings[0].detail,/Label lost/);
});
test('safe answer repairs are rechecked and audited; a worse or unavailable recheck restores the original answer',async()=>{
  for(const result of ['better','worse','failure']) {
    const {q}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
    files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));let n=0;
    modelResponse=request=>{
      if(!request.contents[0].parts[0].text.startsWith('Check this science question'))return;
      n++;
      const imageAudits=[{blockId:'figure',complete:true,faithful:true,issues:[]}];
      if(n===1)return reply({imageAudits,findings:[{severity:'medium',title:'Incomplete answer',detail:'Missing reason',fix:'Explain the energy transfer.'}],repairs:[{id:'answer',content:'The water gains heat from the warmer object.',reason:'Completes the direction of heat transfer.'},{id:'stem',content:'Injected source wording'}]});
      if(result==='failure')throw new Error('Provider unavailable');
      return reply({imageAudits,findings:result==='better'?[]:[{severity:'high',title:'Worse answer',detail:'Incorrect'}],repairs:[]});
    };
    await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0},retryCount:0});
    const saved=docs.get('users/teacher/vetting/'+q.id);assert.equal(saved.blocks[0].content,q.blocks[0].content);
    assert.equal(saved.blocks[2].content,result==='better'?'The water gains heat from the warmer object.':q.blocks[2].content);
    assert.equal(saved.autoCheck.repairs.length,result==='better'?1:0);
    assert.equal(saved.autoCheck.state,result==='better'?'green':result==='failure'?'error':'amber');
    if(result!=='better')assert.match(saved.autoCheck.findings[0].fix,/Explain/);
  }
});

test('missing or partial per-figure audits cannot produce a fresh green import stamp',async()=>{
  for(const imageAudits of [undefined,[{blockId:'figure',complete:true,faithful:true,issues:[]}]]) {
    const {q}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
    q.blocks.push({...q.blocks[1],id:'second'});
    files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
    modelResponse=request=>request.contents[0].parts[0].text.startsWith('Check this science question')?reply({findings:[],repairs:[],imageAudits}):undefined;
    await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0},retryCount:0});
    const saved=docs.get('users/teacher/vetting/'+q.id);
    assert.equal(saved.autoCheck.state,'error');assert.match(saved.autoCheck.error,/every displayed figure/);
    assert.equal(saved.blocks.filter(b=>b.type==='image').length,2);
  }
});

test('nested inline pictures added in CER cannot escape the server visual audit',async()=>{
  for(const extra of [
    {id:'choices',type:'mcq',options:[{id:'a',text:'<img src="https://example.test/choice.png">'},{id:'b',text:'B'}],correctId:'a'},
    {id:'cells',type:'table',data:[['<img src="https://example.test/cell.png">']]}
  ]) {
    const {q}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);q.blocks.push(extra);
    files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
    await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0},retryCount:0});
    const saved=docs.get('users/teacher/vetting/'+q.id);
    assert.equal(saved.autoCheck.state,'error');assert.match(saved.autoCheck.error,/Inline pictures/);
    assert.equal(aiPrompts.length,0,'do not pretend to run a complete check with missing pixels');
  }
});

test('later explanation and answer-key diagrams participate in the strict image audit',async()=>{
  for(const type of ['explanation','answerKey']) {
    const {q}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
    q.blocks.push({id:'additional-picture',type,url:'https://example.test/uncaptured.png'});
    files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
    await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0},retryCount:0});
    assert.equal(docs.get('users/teacher/vetting/'+q.id).autoCheck.state,'error');
    assert.equal(aiPrompts.length,0,'an unread additional picture must stop the audit');
  }
});

test('a figure imported before originals were preserved can still be regenerated and restored',async()=>{
  const {q,url,bytes}=savedFigure('diagram');
  const legacy=docs.get('users/teacher/vetting/'+q.id);
  delete legacy.blocks[1].originalCropUrl;delete legacy.blocks[1].preColourUrl;legacy.blocks[1].cropSource={url:imageUrl('cer-rapid/teacher/job/images/raw/page.jpg'),imageUrl:'older'};
  legacy.sourcePages=[{page:1,url:imageUrl('cer-rapid/teacher/job/images/raw/page.jpg')}];
  modelResponse=request=>{
    if(request.config.responseModalities)return imageModelReply(bytes);
    if(request.contents[0].parts[0].text.startsWith('Compare image 1'))return reply({faithful:true,differences:[]});
  };
  const first=await api.rapidVettingImage({auth,data:{questionId:q.id,blockId:'figure',mode:'colour',expectedUrl:url}});
  const figure=first.question.blocks[1];assert.equal(figure.originalCropUrl,url);assert.notEqual(figure.url,url);
  const back=await api.rapidVettingImage({auth,data:{questionId:q.id,blockId:'figure',mode:'original',expectedUrl:figure.url}});
  assert.equal(back.question.blocks[1].url,url);
});
test('the automatic check re-cuts and redraws a rejected figure exactly once, then rechecks',async()=>{
  const {q,url,bytes}=savedFigure('flowchart');docs.delete('users/teacher/vetting/'+q.id);
  const page=createCanvas(400,300),pctx=page.getContext('2d');pctx.fillStyle='white';pctx.fillRect(0,0,400,300);pctx.fillStyle='black';pctx.fillRect(100,80,200,120);
  files.set('cer-rapid/teacher/job/images/raw/page.jpg',page.toBuffer('image/jpeg'));
  files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
  let reads=0,recrops=0,generations=0;
  modelResponse=request=>{
    const text=request.contents[0].parts[0].text;
    if(request.config.responseModalities){generations++;return imageModelReply(bytes);}
    if(text.startsWith('Image 1 is a whole page')){recrops++;return reply({box_2d:[200,200,800,800]});}
    if(text.startsWith('Compare image 1'))return reply({faithful:true,differences:[]});
    if(text.startsWith('Check this science question')){
      reads++;const audit=reads===1?{blockId:'figure',complete:true,faithful:false,issues:['Right-hand box is clipped']}:{blockId:'figure',complete:true,faithful:true,issues:[]};
      return reply({findings:[],repairs:[],imageAudits:[audit]});
    }
  };
  await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0,figureIndex:0},retryCount:0});
  const saved=docs.get('users/teacher/vetting/'+q.id);
  assert.equal(recrops,1);assert.equal(generations,1);assert.equal(reads,2);
  assert.equal(globalThis.REFINE.n,1,'the re-cut gets the same clean-up the import\'s own cut had');
  assert.ok(aiPrompts.some(p=>/auto-cropped figure/.test(p)&&/Observe this figure and explain what happens to the water\./.test(p)),'…told the question\'s typed wording');
  assert.notEqual(saved.blocks[1].url,url);assert.equal(saved.blocks[1].enhancement.mode,'bw');
  assert.ok(saved.blocks[1].originalCropUrl&&saved.blocks[1].originalCropUrl!==saved.blocks[1].url);
  assert.ok(saved.autoCheck.repairs.some(r=>r.blockId==='figure'&&/Automatic figure fix/.test(r.reason)));
  assert.equal(saved.autoCheck.state,'green');
});
test('a figure that stays rejected is fixed only once and still ends up flagged, not retried',async()=>{
  const {q}=savedFigure('diagram');docs.delete('users/teacher/vetting/'+q.id);
  const page=createCanvas(400,300),pctx=page.getContext('2d');pctx.fillStyle='white';pctx.fillRect(0,0,400,300);pctx.fillStyle='black';pctx.fillRect(100,80,200,120);
  files.set('cer-rapid/teacher/job/images/raw/page.jpg',page.toBuffer('image/jpeg'));
  files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
  let recrops=0,reads=0;
  modelResponse=request=>{
    const text=request.contents[0].parts[0].text;
    if(request.config.responseModalities)return {candidates:[{finishReason:'OTHER'}]};
    if(text.startsWith('Image 1 is a whole page')){recrops++;return reply({box_2d:[200,200,800,800]});}
    if(text.startsWith('Check this science question')){reads++;return reply({findings:[],repairs:[],imageAudits:[{blockId:'figure',complete:true,faithful:false,issues:['Label missing']}]});}
  };
  await api.rapidImportPage({data:{id:'job',page:3,generation:0,phase:'publish',publishIndex:0,figureIndex:0},retryCount:0});
  const saved=docs.get('users/teacher/vetting/'+q.id);
  assert.equal(recrops,1);assert.equal(reads,2);assert.equal(saved.autoCheck.state,'red');
});
