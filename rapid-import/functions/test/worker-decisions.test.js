import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
const docs=new Map(), files=new Map(), tasks=[];
const callableOptions=new Map(), definedSecrets=[];
const clone=x=>x===undefined?undefined:structuredClone(x);
const snap=path=>({exists:docs.has(path),data:()=>clone(docs.get(path))});
const ref=path=>({path,id:path.split('/').pop(),get:async()=>snap(path)});
let failCommit=false;
let beforeDownload=null;
const db={doc:ref,collection:name=>({doc:id=>ref(name+'/'+id),where:()=>({get:async()=>({docs:[...docs].filter(([k])=>k.startsWith(name+'/')).map(([k])=>snap(k))})})}),
 runTransaction:async fn=>{
   const writes=[];
   await fn({get:async r=>snap(r.path),create:(r,d)=>writes.push(['create',r.path,clone(d)]),update:(r,d)=>writes.push(['update',r.path,clone(d)]),set:(r,d)=>writes.push(['set',r.path,clone(d)])});
   if(failCommit){failCommit=false;throw new Error('Simulated network failure before commit');}
   for(const [op,path] of writes) if(op==='create'&&docs.has(path)) throw new Error('already exists');
   for(const [op,path,value] of writes) docs.set(path,op==='update'?{...docs.get(path),...value}:value);
 }};
const bucket={name:'test',file:path=>({save:async b=>files.set(path,Buffer.from(b)),download:async()=>{if(beforeDownload)await beforeDownload(path);if(!files.has(path))throw new Error('Missing upload');return [files.get(path)];}})};
mock.module('firebase-admin/app',{namedExports:{initializeApp:()=>({})}});
mock.module('firebase-admin/firestore',{namedExports:{getFirestore:()=>db}});
mock.module('firebase-admin/storage',{namedExports:{getStorage:()=>({bucket:()=>bucket})}});
mock.module('firebase-admin/functions',{namedExports:{getFunctions:()=>({taskQueue:()=>({enqueue:async(data,opts)=>tasks.push({data,opts})})})}});
mock.module('firebase-functions/v2/https',{namedExports:{onCall:(opts,fn)=>{callableOptions.set(fn,opts);return fn;},HttpsError:class extends Error {constructor(code,message){super(message);this.code=code;}}}});
mock.module('firebase-functions/v2/firestore',{namedExports:{onDocumentWritten:(opts,fn)=>fn}});
mock.module('firebase-functions/v2/tasks',{namedExports:{onTaskDispatched:(opts,fn)=>fn}});
mock.module('firebase-functions/params',{namedExports:{defineSecret:name=>{const secret={name,value:()=>'secret:'+name};definedSecrets.push(secret);return secret;},defineString:(name,opts)=>({value:()=>opts.default})}});
let aiPages=[], aiPrompts=[], recrops=[], checks=[], recropBox=[130,80,280,390];
// The crop clean-up pass: clean by default. A test sets globalThis.REFINE.box
// (a box, or a function of the crop it was shown) to have it cut something off;
// REFINE.n counts the calls, so how many clean-ups ran is visible.
globalThis.REFINE={n:0,box:null};
mock.module('@google/genai',{namedExports:{GoogleGenAI:class {
  models={generateContent:async request=>{
    aiPrompts.push(request.contents[0].parts[0].text);
    const text=request.contents[0].parts[0].text;
    if(/judged wrong|No crop could be cut/.test(text)) {recrops.push(text);return {candidates:[{finishReason:'STOP'}],text:JSON.stringify({box_2d:recropBox})};}
    if(/Check this science question/.test(text)) {checks.push(text);const q=JSON.parse(text.split('Question:\n').at(-1));return {candidates:[{finishReason:'STOP'}],text:JSON.stringify({findings:[],repairs:[],imageAudits:q.blocks.filter(b=>b.type==='image').map(b=>({blockId:b.id,complete:true,faithful:true,issues:[]}))})};}
    if(/auto-cropped figure/.test(text)) {
      const R=globalThis.REFINE;R.n++;
      const box=typeof R.box==='function'?await R.box(request.contents[0].parts[1].inlineData.data):R.box;
      return {candidates:[{finishReason:'STOP'}],text:JSON.stringify(box?{clean:false,box_2d:box}:{clean:true})};
    }
    const page=Number(/CURRENT page (\d+)/.exec(text)?.[1]);
    if(globalThis.AFTER_PAGE_READ) globalThis.AFTER_PAGE_READ();
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

// OpenAI Decisions response arrays, scripted per test.
let decisionsCalls=[], decisionsPlan=()=>({});
globalThis.fetch=async(url,init)=>{
  assert.equal(url,'https://api.openai.com/v1/decisions');
  assert.equal(init.headers.Authorization,'Bearer secret:OPENAI_API_KEY');
  const wire=JSON.parse(init.body);assert.equal(wire.model,'gpt-6-luna');
  const body={state:JSON.parse(wire.input),questions:Object.fromEntries(wire.questions.map(q=>[q.name,q]))};decisionsCalls.push(body);
  const plan=await decisionsPlan(Object.keys(body.questions),decisionsCalls.length,body);
  const answers={};
  for(const key of Object.keys(body.questions)) {
    const [choice,conf]=plan[key]||['yes',.95];
    answers[key]={type:'choice',choice,confidence:conf,probabilities:choice==='yes'?{yes:conf,no:1-conf}:{yes:1-conf,no:conf}};
  }
  return {ok:true,json:async()=>({answers:Object.entries(answers).map(([name,a])=>({...a,name,probabilities:Object.entries(a.probabilities).map(([value,probability])=>({value,probability}))}))})};
};
const api=await import('../index.js');
const auth={uid:'teacher',token:{admin:true,name:'Teacher'}};
const makeJob=(id='job')=>({id,ownerUid:'teacher',name:'paper.pdf',status:'queued',phase:'publish',publishIndex:0,nextPage:3,total:2,added:0,generation:0,autoCheck:false,checkpoint:'checkpoint',updatedAt:new Date().toISOString()});
function setup(j=makeJob()){docs.clear();files.clear();tasks.length=0;aiPrompts=[];beforeDownload=null;docs.set('cerRapidImports/'+j.id,j);return j;}

const fig=[{title:'Fig',sourceQuestionNumber:'1',blocks:[{type:'text',text:'(a) Look at the figure.'},{type:'image',caption:'F',box_2d:[130,80,280,390]},{type:'plainanswer',text:'Answer'},{type:'explanation',text:'Because'}]}];
function start(autoCheck=false){
  const pdf=pdfFixture(1,['1 0 0 rg 20 220 50 35 re f\n']);
  const j=setup({...makeJob('fig'),phase:'page',nextPage:1,total:1,checkpoint:null,path:'o.pdf',engineOrder:['gemini'],prompt:'Read',autoCheck});
  files.set(j.path,pdf);aiPages=[fig];decisionsCalls=[];recrops=[];checks=[];globalThis.REFINE={n:0,box:null};return j;
}
const run=async id=>{
  await api.rapidImportPage({data:{id,page:1,generation:0,phase:'page',publishIndex:0},retryCount:0});
  const n=docs.get('cerRapidImports/'+id);
  await api.rapidImportPage({data:{id,page:n.nextPage,generation:0,phase:n.phase,publishIndex:0},retryCount:0});
  return [...docs].find(([k])=>k.includes('/vetting/'))[1];
};
test('Decisions says no to a crop: the AI is asked to re-cut it, Decisions is asked again, and the fixed box is recorded',async()=>{
  start();recropBox=[140,90,270,380];
  decisionsPlan=(keys,n)=>n===1?{figure_0:['no',.9]}:{};
  const q=await run('fig');
  assert.equal(recrops.length,1);assert.match(recrops[0],/Problems found: .*Decisions judged the crop/);
  assert.equal(decisionsCalls.filter(b=>Object.keys(b.questions).join()==='figure_0').length,2);
  assert.deepEqual(q.decisionsFigures,[{index:0,state:'fixed',tries:1,reasons:[]}]);
  assert.deepEqual(q.blocks.find(b=>b.type==='image').cropSource.box_2d,[140,90,270,380]);
  assert.equal(globalThis.REFINE.n,2,'one clean-up for the first cut and one for the re-cut');
});
test('a crop Decisions never accepts is retried twice, then kept and flagged rather than lost',async()=>{
  start(true);
  decisionsPlan=keys=>keys.includes('figure_0')&&keys.length===1?{figure_0:['no',.9]}:{};
  const q=await run('fig');
  assert.equal(recrops.length,2,'two AI re-cuts, no more');
  assert.equal(globalThis.REFINE.n,3,'the clean-up runs once per cut: 1 + the 2 re-cuts');
  assert.equal(q.decisionsFigures[0].state,'flagged');
  assert.ok(q.blocks.find(b=>b.type==='image').url,'the picture is still there');
  assert.ok(q.autoCheck.findings.some(f=>f.type==='Crop'&&f.cropStatus==='unclear'),'the flag reaches the vetting card as a Crop finding');
  assert.notEqual(q.autoCheck.state,'green');
});
test('Decisions is advisory: a confident yes still gets the AI read and the comparison is recorded; a no on the wording sends it to the AI with Decisions\'s reason',async()=>{
  start(true);decisionsPlan=()=>({});
  let q=await run('fig');
  assert.equal(checks.length,1,'the AI still reads the question when Decisions says yes');
  assert.ok(!q.autoCheck.decisions,'not stamped as a Decisions-only pass');
  assert.equal(q.decisionsShadow.yes,true);assert.equal(q.decisionsShadow.confident,true);assert.ok(q.decisionsShadow.ai);
  start(true);decisionsPlan=keys=>keys.includes('wording')?{wording:['no',.9]}:{};
  q=await run('fig');
  assert.equal(checks.length,1);assert.equal(q.decisionsShadow.yes,false);assert.match(checks[0],/Problems already flagged by Decisions/);
});
test('Decisions unavailable changes nothing: every question is AI-checked exactly as before',async()=>{
  start(true);const real=globalThis.fetch;globalThis.fetch=async()=>({ok:false,status:503});
  try{const q=await run('fig');assert.equal(checks.length,1);assert.equal(recrops.length,0);assert.ok(q.autoCheck);}
  finally{globalThis.fetch=real;}
});
test('question Decisions runs during Storage preparation and its flagged reasons still reach the visual AI',async()=>{
  start(true);
  let releaseReview,reviewStarted,downloads=0;
  const started=new Promise(resolve=>{reviewStarted=resolve;});
  decisionsPlan=async keys=>{
    if(!keys.includes('wording'))return {};
    reviewStarted();await new Promise(resolve=>{releaseReview=resolve;});
    return {wording:['no',.9]};
  };
  beforeDownload=async path=>{if(path.includes('/images/'))downloads++;};
  const running=run('fig');
  await started;
  try {
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(downloads>0,'Storage downloads must begin before the Decisions answer arrives');
    assert.equal(checks.length,0,'the visual AI waits for the advisory reasons after images are ready');
  } finally {releaseReview();}
  const q=await running;
  assert.equal(checks.length,1);assert.match(checks[0],/Problems already flagged by Decisions/);
  assert.equal(q.decisionsShadow.yes,false);
});
test('a failed Storage preparation keeps the Decisions shadow and an error stamp without a partial visual read',async()=>{
  const j=start(true);decisionsPlan=()=>({});
  await api.rapidImportPage({data:{id:j.id,page:1,generation:0,phase:'page',publishIndex:0},retryCount:0});
  for(const path of files.keys())if(path.includes('/images/'))files.delete(path);
  const next=docs.get('cerRapidImports/'+j.id);
  await api.rapidImportPage({data:{id:j.id,page:next.nextPage,generation:0,phase:next.phase,publishIndex:0},retryCount:0});
  const q=[...docs].find(([path])=>path.includes('/vetting/'))[1];
  assert.equal(checks.length,0);assert.equal(q.autoCheck.state,'error');assert.match(q.autoCheck.error,/Missing upload/);
  assert.equal(q.decisionsShadow.yes,true);assert.equal(q.decisionsShadow.ai,'error');
});
test('the review callable binds only the shared OpenAI key and defines no other provider secret',()=>{
  assert.deepEqual(definedSecrets.map(secret=>secret.name).sort(),['GEMINI_API_KEY','OPENAI_API_KEY']);
  assert.deepEqual(callableOptions.get(api.cerDecisionsReview).secrets.map(secret=>secret.name),['OPENAI_API_KEY']);
  assert.deepEqual(Object.keys(api).filter(name=>name.startsWith('cer')&&name.endsWith('Review')),['cerDecisionsReview']);
});
test('the browser review endpoint is administrator only and returns typed verdicts',async()=>{
  decisionsPlan=()=>({});
  const facts={excerpt:'Q',wordCount:8};
  await assert.rejects(api.cerDecisionsReview({auth:{uid:'s',token:{}},data:{scope:'question',question:facts}}),/administrator/);
  await assert.rejects(api.cerDecisionsReview({data:{scope:'question',question:facts}}),/Sign in/);
  const r=await api.cerDecisionsReview({auth,data:{scope:'question',question:facts}});
  assert.equal(r.available,true);assert.equal(r.verdicts.wording.ok,true);
  assert.ok(docs.has('cerDecisionsLimits/teacher'),'only counters are stored in the Decisions allowance collection');
  await assert.rejects(api.cerDecisionsReview({auth,data:{scope:'question',question:'nope'}}),/Invalid/);
});
test('disabling Decisions on an import skips provider review without removing the imported question',async()=>{
  const job=start(true);job.decisions=false;docs.set('cerRapidImports/'+job.id,job);
  const q=await run(job.id);
  assert.equal(decisionsCalls.length,0);
  assert.equal(checks.length,1,'visual AI checking still runs');
  assert.ok(q.blocks.some(block=>block.type==='image'&&block.url));
  assert.equal(q.decisionsFigures,undefined);
});
test('an existing queued import preserves its disabled review preference during migration',async()=>{
  const job=start(true);job['jev']=false;docs.set('cerRapidImports/'+job.id,job);
  const q=await run(job.id);
  assert.equal(decisionsCalls.length,0);
  assert.equal(checks.length,1,'the visual check is independent of the migrated preference');
  assert.ok(q.blocks.some(block=>block.type==='image'&&block.url));
});
test('publishing an existing checkpoint preserves its question and migrates stored review history',async()=>{
  const job=setup(makeJob('history'));
  const question={id:'saved-history',blocks:[{type:'text',content:'Keep the original wording.'}],sourcePages:[{page:1,url:'source'}],autoCheck:{state:'jev'}};
  question['jevFigures']=[{index:0,state:'flagged',reasons:['Keep the crop warning.']}];
  question['jevShadow']={yes:false,ai:'red',found:1};question.autoCheck['jev']=true;
  files.set(job.checkpoint,Buffer.from(JSON.stringify({ready:[question]})));
  await api.rapidImportPage({data:{id:job.id,page:3,generation:0,phase:'publish',publishIndex:0},retryCount:0});
  const saved=docs.get('users/teacher/vetting/saved-history');
  assert.deepEqual(saved.blocks,question.blocks);assert.deepEqual(saved.sourcePages,question.sourcePages);
  assert.deepEqual(saved.decisionsFigures,question['jevFigures']);assert.deepEqual(saved.decisionsShadow,question['jevShadow']);
  assert.equal(saved.autoCheck.state,'green');assert.equal(saved.autoCheck.decisions,true);
  for(const key of ['jevFigures','jevShadow']) assert.equal(Object.hasOwn(saved,key),false);
  assert.equal(Object.hasOwn(saved.autoCheck,'jev'),false);
});

// ---- the crop clean-up, through the real page task --------------------------
// Pages are drawn in RENDERED pixels (the 200×300pt page renders at 400×600).
const px=(x,y,w,h,rgb='0 0 0')=>`${rgb} rg ${x/2} ${(600-y-h)/2} ${w/2} ${h/2} re f\n`;
async function decode(b64OrBytes){
  const img=await loadImage(typeof b64OrBytes==='string'?Buffer.from(b64OrBytes,'base64'):b64OrBytes);
  const c=createCanvas(img.width,img.height),ctx=c.getContext('2d');ctx.drawImage(img,0,0);
  return {W:img.width,H:img.height,d:ctx.getImageData(0,0,img.width,img.height).data};
}
// Where on a decoded picture the pixels `hit` accepts lie (y1 -1: none).
function boxIn({W,H,d},hit){
  let y0=H,y1=-1,x0=W,x1=-1;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;if(hit(d[i],d[i+1],d[i+2])){if(y<y0)y0=y;if(y>y1)y1=y;if(x<x0)x0=x;if(x>x1)x1=x;}}
  return {y0,y1,x0,x1,W,H};
}
// The clean-up's reply: a box (0-1000 on the crop it was shown) round those
// pixels, or round the top `share` of them.
const refineTo=(hit,share=1)=>async b64=>{
  const r=boxIn(await decode(b64),hit);
  return [r.y0/r.H*1000,r.x0/r.W*1000,(r.y0+(r.y1-r.y0)*share)/r.H*1000,r.x1/r.W*1000].map(Math.round);
};
const red=(r,g,b)=>r>150&&g<90&&b<90, dark=(r,g,b)=>r<110&&g<110&&b<110;
function startPage(stream,box){
  const j=start();files.set(j.path,pdfFixture(1,[stream]));
  aiPages=[[{title:'Fig',sourceQuestionNumber:'1',blocks:[{type:'text',text:'Study the figure and answer the question.'},{type:'image',caption:'F',box_2d:box},{type:'plainanswer',text:'Answer'}]}]];
  return j;
}
async function storedFigure(q){
  const b=q.blocks.find(b=>b.type==='image');
  const pic=await decode(files.get(decodeURIComponent(new URL(b.url).pathname.split('/o/')[1])));
  return {W:pic.W,H:pic.H,pic,block:b};
}
// A block standing in for question text, a clear gap, then the figure. The
// pixel pass keeps the block (it is not shaped like a line of print), so these
// tests exercise the clean-up and not the trim.
const STEM=px(110,200,180,30);
const STEM_PAGE=STEM+px(100,280,200,120,'1 0 0');
const STEM_BOX=[300,230,700,770];
// …and the figure a bordered red table with empty cells: four rules, four verticals.
const TABLE_PAGE=STEM+[280,330,380,430].map(y=>px(100,y,244,4,'1 0 0')).join('')+[100,180,260,340].map(x=>px(x,280,4,154,'1 0 0')).join('');
const TABLE_BOX=[300,220,750,880];

test('the clean-up\'s box is cut from the PAGE: a cut that removes text above a gap is kept and re-measured',async()=>{
  decisionsPlan=()=>({});
  startPage(STEM_PAGE,STEM_BOX);
  const plain=await storedFigure(await run('fig'));
  assert.equal(globalThis.REFINE.n,1,'exactly one clean-up for one figure');
  assert.ok(boxIn(plain.pic,dark).y1>=0,'without a clean-up the block above stays in the picture');
  startPage(STEM_PAGE,STEM_BOX);globalThis.REFINE.box=refineTo(red);
  const q=await run('fig'), cleaned=await storedFigure(q);
  assert.equal(globalThis.REFINE.n,1,'1 + no re-cuts');
  assert.ok(cleaned.H<plain.H-40,`the stored figure is the cleaned cut (${cleaned.H} vs ${plain.H})`);
  assert.equal(boxIn(cleaned.pic,dark).y1,-1,'nothing of the block above the gap is left in the picture');
  assert.ok(boxIn(cleaned.pic,red).y1>0,'and the figure is all there');
  assert.deepEqual(cleaned.block.cropSource.box_2d,STEM_BOX,'the page-level box is still the one recorded');
  const facts=decisionsCalls.find(b=>b.state&&b.state.figures).state.figures[0];
  assert.equal(facts.aiSawStrayText,false,'a clean-up that worked is not reported to Decisions as stray text');
  assert.deepEqual(facts.clippedSides,[],'Decisions is shown the cleaned cut\'s own measurements');
  assert.ok(facts.height<plain.H-40,'…its own size, not the first cut\'s');
  assert.equal(recrops.length,0,'no re-cut loop for a cleaned crop');
});
test('a clean-up that slices a bordered table in half is refused and the unrefined crop is kept',async()=>{
  decisionsPlan=()=>({});
  startPage(TABLE_PAGE,TABLE_BOX);
  const plain=await storedFigure(await run('fig'));
  // Control: on this very page, a clean-up round the whole table is taken.
  startPage(TABLE_PAGE,TABLE_BOX);globalThis.REFINE.box=refineTo(red);
  const whole=await storedFigure(await run('fig'));
  assert.ok(whole.H<plain.H-40&&boxIn(whole.pic,dark).y1===-1,'the block above the table comes off');
  // Half the table: its borders would run off the bottom edge — refused.
  startPage(TABLE_PAGE,TABLE_BOX);globalThis.REFINE.box=refineTo(red,0.5);
  const q=await run('fig'), kept=await storedFigure(q);
  assert.equal(globalThis.REFINE.n,1);
  assert.deepEqual([kept.W,kept.H],[plain.W,plain.H],'the unrefined crop is kept, table whole');
  assert.deepEqual(kept.block.cropSource.box_2d,TABLE_BOX);
  assert.deepEqual(decisionsCalls.find(b=>b.state&&b.state.figures).state.figures[0].clippedSides,[]);
});
test('past the page task\'s deadline no clean-up or re-cut is started; the crop is kept and flagged',async()=>{
  const realNow=Date.now;let skew=0;
  Date.now=()=>realNow()+skew;
  globalThis.AFTER_PAGE_READ=()=>{skew=301000;};   // a page read that took five minutes
  try {
    startPage(STEM_PAGE,STEM_BOX);globalThis.REFINE.box=[600,0,1000,1000];
    decisionsPlan=keys=>keys.includes('figure_0')?{figure_0:['no',.9]}:{};
    const q=await run('fig');
    assert.equal(globalThis.REFINE.n,0,'no clean-up started after the deadline');
    assert.equal(recrops.length,0,'no AI re-cut started after the deadline');
    assert.equal(q.decisionsFigures[0].state,'flagged','the crop Decisions objected to is kept and flagged for a person');
    assert.ok(q.blocks.find(b=>b.type==='image').url,'the picture is still there');
  } finally {Date.now=realNow;globalThis.AFTER_PAGE_READ=null;}
});
