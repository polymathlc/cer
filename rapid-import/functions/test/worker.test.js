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
let aiPages=[], aiPrompts=[], modelResponse=null;
mock.module('@google/genai',{namedExports:{GoogleGenAI:class {
  models={generateContent:async request=>{
    aiPrompts.push(request.contents[0].parts[0].text);
    if(modelResponse) {const response=await modelResponse(request);if(response)return response;}
    const text=request.contents[0].parts[0].text;
    if(text.startsWith('Check this science question')) {
      const q=JSON.parse(text.split('Question:\n').at(-1));
      return {candidates:[{finishReason:'STOP'}],text:JSON.stringify({findings:[],repairs:[],imageAudits:q.blocks.filter(b=>b.type==='image').map(b=>({blockId:b.id,complete:true,faithful:true,issues:[]}))})};
    }
    const page=Number(/CURRENT page (\d+)/.exec(text)?.[1]);
    return {candidates:[{finishReason:'STOP'}],text:JSON.stringify({questions:aiPages[page-1]||[]})};
  }};
}}});
const api=await import('../index.js');
const auth={uid:'teacher',token:{admin:true,name:'Teacher'}};
const makeJob=(id='job')=>({id,ownerUid:'teacher',name:'paper.pdf',status:'queued',phase:'publish',publishIndex:0,nextPage:3,total:2,added:0,generation:0,autoCheck:false,checkpoint:'checkpoint',updatedAt:new Date().toISOString()});
const question={id:'q_rapid_job_1_0',title:'A',blocks:[],sourcePages:[]};
function setup(j=makeJob()){docs.clear();files.clear();tasks.length=0;aiPrompts=[];modelResponse=null;docs.set('cerRapidImports/'+j.id,j);files.set('checkpoint',Buffer.from(JSON.stringify({pending:null,ready:[question]})));return j;}
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
  const j=setup({...makeJob(),autoCheck:true,engineOrder:['gemini'],jev:false,enhanceImages:true});
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
test('new uploads cannot disable automatic checks or enhancement',async()=>{
  setup();docs.clear();
  await api.rapidImportBegin({auth,data:{id:'required',size:20,prompt:'Read the paper',autoCheck:false,enhanceImages:false}});
  const j=docs.get('cerRapidImports/required');assert.equal(j.autoCheck,true);assert.equal(j.enhanceImages,true);
  assert.deepEqual((await api.rapidImportStatus({auth})).capabilities,{imageEditing:true,automaticChecks:true,automaticEnhancement:true});
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
test('durable enhancement checkpoints each figure once and fences replayed image tasks',async()=>{
  const {q,bytes}=savedFigure();docs.delete('users/teacher/vetting/'+q.id);
  const j={...docs.get('cerRapidImports/job'),phase:'enhance',figureIndex:1};docs.set('cerRapidImports/job',j);
  q.blocks.splice(2,0,{...q.blocks[1],id:'second'});files.set('checkpoint',Buffer.from(JSON.stringify({ready:[q],pending:null})));
  let count=0;modelResponse=request=>{
    if(request.config.responseModalities){count++;return imageModelReply(bytes);}
    if(request.contents[0].parts[0].text.startsWith('Compare image 1'))return reply({faithful:true,differences:[]});
  };
  const first={data:{id:'job',page:3,generation:0,phase:'enhance',publishIndex:0,figureIndex:1},retryCount:0};
  await api.rapidImportPage(first);await api.rapidImportPage(first);
  assert.equal(count,1);assert.equal(docs.get('cerRapidImports/job').figureIndex,2);assert.equal(docs.has('users/teacher/vetting/'+q.id),false);
  await api.rapidImportPage({...first,data:{...first.data,figureIndex:2}});
  await api.rapidImportPage({...first,data:{...first.data,phase:'publish',figureIndex:0}});
  assert.equal(count,2);assert.equal(docs.get('cerRapidImports/job').status,'completed');assert.equal(docs.get('cerRapidImports/job').added,1);
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
