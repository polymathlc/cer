import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('// Durable PDF imports.'),source.indexOf('const RAPID_PDF_MAX_PAGES = 60;'));
function harness(failFinish=false,options={}) {
  const calls=[],statuses=[],subscriptions=[],storage=new Map(),elements={rapidCloudMode:{checked:true},rapidCloudNote:{},rapidCloudJobs:{querySelectorAll:()=>[]}};
  let acknowledge;
  const gate=new Promise(r=>acknowledge=r);
  const context={crypto:webcrypto,AI_ENGINES:['openai','gemini','kimi'],localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    setTimeout:options.setTimeout||setTimeout,clearTimeout,currentUser:{uid:'teacher'},app:{},getFunctions:()=>({}),
    httpsCallable:(f,name)=>async data=>{calls.push({name,data});if(options.call)await options.call(name,data,context);if(name==='rapidImportFinish'){await gate;if(failFinish)throw new Error('No acknowledgement');}return {data:name==='rapidImportStatus'?{available:true,jobs:[]}: {}};},
    document:{getElementById:id=>elements[id]},currentTopicsByLevel:()=>({P5:['Heat'],P6:['Energy']}),currentTopics:()=>['Heat'],
    aiEngineOrder:()=>['openai','gemini'],_aiBuildQuestionPrompt:(a,b,level)=>'Captured '+level,aiGrounding:()=>'',autoChkOn:()=>true,_isAdmin:()=>true,
    _bankOwnerUid:()=>context.currentUser?.uid,_canAuthor:()=>true,
    rapidJobs:[],_updateRapidCounts(){},renderVettingList(){},_fileToBase64:options.fileToBase64||(async slice=>'%PDF:'+slice.start+':'+slice.end),_setRapidStatus:m=>statuses.push(m),
    _setRapidJobState:(id,patch)=>Object.assign(context.rapidJobs.find(j=>j.id===id),patch),
    _removeRapidJob:id=>{context.rapidJobs=context.rapidJobs.filter(j=>j.id!==id);},
    _failRapidJob:(id,e)=>{const job=context.rapidJobs.find(j=>j.id===id);assert.ok(job,'Unexpected failure after upload card was removed: '+e.stack);Object.assign(job,{status:'error',error:e.message});},
    _vCol:()=>({}),onSnapshot:(ref,callback)=>{subscriptions.push({ref,callback});return()=>{};},escapeHtml:String,
  };
  vm.createContext(context);vm.runInContext(block+'\nthis.upload=_rapidUploadPdf;this.count=()=>_rapidCloudUploading;',context);
  const file=(name,size=7)=>({name,size,lastModified:1,slice:(start,end)=>({name,start,end:Math.min(size,end)})});
  return {context,calls,statuses,subscriptions,acknowledge,file};
}
test('safe-to-close is never shown before durable acknowledgement',async()=>{
  const h=harness(),p=h.context.upload(h.file('a.pdf'),'P5','2027-01-01');
  await new Promise(r=>setImmediate(r));
  assert.equal(h.context.count(),1);assert.ok(!h.statuses.some(s=>s.includes('Safe to close')));
  h.acknowledge();await p;assert.equal(h.context.count(),0);assert.ok(h.statuses.some(s=>s.includes('Safe to close')));
  assert.equal(h.subscriptions.length,1,'successful acknowledgement refreshes the live vetting subscription');
});
test('multiple PDFs retain settings and upload independently in sequence',async()=>{
  const h=harness();const a=h.context.upload(h.file('a.pdf'),'P5','2027-01-01'),b=h.context.upload(h.file('b.pdf'),'P6','2027-02-01');
  assert.equal(h.context.count(),2);h.acknowledge();await Promise.all([a,b]);
  const starts=h.calls.filter(c=>c.name==='rapidImportBegin');
  assert.deepEqual(starts.map(c=>c.data.level),['P5','P6']);assert.deepEqual(starts.map(c=>c.data.release),['2027-01-01','2027-02-01']);
  assert.equal(h.calls.filter(c=>c.name==='rapidImportFinish').length,2);
  assert.equal(h.subscriptions.length,1,'multiple refreshes reuse the owner subscription');
});
test('lost acknowledgement leaves a failure card and reuses import ID on reselection',async()=>{
  const h=harness(true);h.acknowledge();await h.context.upload(h.file('a.pdf'),'P5','');
  assert.equal(h.context.rapidJobs[0].status,'error');assert.ok(!h.statuses.some(s=>s.includes('Safe to close')));
  await h.context.upload(h.file('a.pdf'),'P5','');
  const starts=h.calls.filter(c=>c.name==='rapidImportBegin');assert.equal(starts[0].data.id,starts[1].data.id);
});

const CHUNK=3*1024*1024;
const tick=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function chunkGates(){
  const pending=new Map();let live=0,peak=0;
  return {pending,get live(){return live;},get peak(){return peak;},
    async call(name,data){
      if(name!=='rapidImportChunk')return;
      const gate=deferred();pending.set(data.index,gate);live++;peak=Math.max(peak,live);
      await gate.promise;live--;
    }};
}

test('two indexed chunks overlap, preserve exact source slices and finish only after all acknowledgements',async()=>{
  const gates=chunkGates(),h=harness(false,{call:gates.call});h.acknowledge();
  const p=h.context.upload(h.file('parallel.pdf',CHUNK*2+1024),'P5','');
  await tick();
  assert.deepEqual([...gates.pending.keys()],[0,1]);assert.equal(gates.peak,2);
  gates.pending.get(1).resolve();await tick();
  assert.ok(gates.pending.has(2),'one free slot immediately feeds the next chunk');
  assert.ok(!h.calls.some(c=>c.name==='rapidImportFinish'));
  assert.equal(h.statuses.filter(s=>s.startsWith('Uploading')).at(-1),'Uploading “parallel.pdf” — 50%. Keep this tab open.',
    'a later chunk acknowledges only its own bytes, not all lower indexes');
  gates.pending.get(2).resolve();await tick();
  assert.ok(!h.calls.some(c=>c.name==='rapidImportFinish'),'the first chunk is still unacknowledged');
  gates.pending.get(0).resolve();await p;
  const chunks=h.calls.filter(c=>c.name==='rapidImportChunk');
  assert.deepEqual(chunks.map(c=>[c.data.index,c.data.data]),[[0,'%PDF:0:'+CHUNK],[1,'%PDF:'+CHUNK+':'+CHUNK*2],[2,'%PDF:'+CHUNK*2+':'+(CHUNK*2+1024)]]);
  assert.equal(gates.peak,2);assert.equal(gates.live,0);
  assert.equal(h.calls.filter(c=>c.name==='rapidImportFinish').length,1);
  assert.ok(h.statuses.filter(s=>s.startsWith('Uploading')).at(-1).includes('100%'));
});

test('a large PDF never exceeds two chunk calls and progress counts a short last chunk correctly',async()=>{
  const gates=chunkGates(),h=harness(false,{call:gates.call});h.acknowledge();
  const p=h.context.upload(h.file('five.pdf',CHUNK*4+CHUNK/2),'P5','');
  await tick();
  for(const index of [1,2,3,4]){assert.ok(gates.pending.has(index));gates.pending.get(index).resolve();await tick();}
  const progress=h.statuses.filter(s=>s.startsWith('Uploading')).map(s=>Number(/— (\d+)%/.exec(s)[1]));
  assert.deepEqual(progress,[22,44,67,78]);
  assert.ok(!h.calls.some(c=>c.name==='rapidImportFinish'));
  gates.pending.get(0).resolve();await p;
  assert.equal(gates.peak,2);assert.equal(h.calls.filter(c=>c.name==='rapidImportChunk').length,5);
  assert.ok(h.statuses.filter(s=>s.startsWith('Uploading')).at(-1).includes('100%'));
});

test('a transient chunk failure retries the same bytes and index with the existing backoff',async()=>{
  const delays=[];let attempts=0;
  const h=harness(false,{setTimeout:(callback,ms)=>{delays.push(ms);queueMicrotask(callback);},call:async(name,data)=>{
    if(name==='rapidImportChunk'&&data.index===0&&++attempts<3)throw new Error('temporary network failure');
  }});h.acknowledge();
  await h.context.upload(h.file('retry.pdf',CHUNK+1),'P5','');
  const retried=h.calls.filter(c=>c.name==='rapidImportChunk'&&c.data.index===0);
  assert.equal(retried.length,3);assert.deepEqual(delays,[1000,2000]);
  assert.ok(retried.every(c=>c.data.data===retried[0].data.data));
  assert.equal(h.calls.filter(c=>c.name==='rapidImportFinish').length,1);
  assert.deepEqual(h.statuses.filter(s=>s.startsWith('Uploading')).map(s=>Number(/— (\d+)%/.exec(s)[1])),[0,100],
    'retrying a chunk never counts its bytes twice');
});

test('an exhausted chunk error stops feeding and drains the other started call before filing failure',async()=>{
  const other=deferred();let attempts=0;
  const h=harness(false,{setTimeout:callback=>queueMicrotask(callback),call:async(name,data)=>{
    if(name!=='rapidImportChunk')return;
    if(data.index===0){attempts++;throw new Error('chunk zero failed');}
    if(data.index===1)await other.promise;
  }});h.acknowledge();
  const p=h.context.upload(h.file('failed.pdf',CHUNK*4),'P5','');
  await tick();assert.equal(attempts,3);
  assert.equal(h.context.rapidJobs[0].status,'processing','failure is deferred until the other call settles');
  assert.deepEqual(h.calls.filter(c=>c.name==='rapidImportChunk').map(c=>c.data.index),[0,1,0,0]);
  other.resolve();await p;
  assert.equal(h.context.rapidJobs[0].status,'error');assert.equal(h.context.rapidJobs[0].error,'chunk zero failed');
  assert.ok(!h.calls.some(c=>c.name==='rapidImportFinish'));
  assert.ok(!h.statuses.some(s=>s.includes('Safe to close')));
});

test('an account change stops new chunks and waits for both started writes before failure',async()=>{
  const gates=chunkGates(),h=harness(false,{call:gates.call});h.acknowledge();
  const p=h.context.upload(h.file('switch.pdf',CHUNK*4),'P5','');
  await tick();h.context.currentUser={uid:'another-teacher'};
  gates.pending.get(1).resolve();await tick();
  assert.equal(h.context.rapidJobs[0].status,'processing');
  assert.deepEqual([...gates.pending.keys()],[0,1]);
  gates.pending.get(0).resolve();await p;
  assert.equal(gates.live,0);assert.equal(h.context.rapidJobs[0].status,'error');
  assert.match(h.context.rapidJobs[0].error,/Account changed/);
  assert.ok(!h.calls.some(c=>c.name==='rapidImportFinish'));
});

test('an account change while chunks are encoded prevents their upload calls',async()=>{
  const encoded=deferred(),h=harness(false,{fileToBase64:async()=>{await encoded.promise;return '%PDF';}});h.acknowledge();
  const p=h.context.upload(h.file('encoding.pdf',CHUNK*3),'P5','');
  await tick();h.context.currentUser={uid:'another-teacher'};encoded.resolve();await p;
  assert.equal(h.calls.filter(c=>c.name==='rapidImportChunk').length,0);
  assert.ok(!h.calls.some(c=>c.name==='rapidImportFinish'));
  assert.equal(h.context.rapidJobs[0].status,'error');
});

test('another PDF waits for the current upload and acknowledgement while keeping queued authoring settings',async()=>{
  const gates=chunkGates(),h=harness(false,{call:gates.call});
  const a=h.context.upload(h.file('first.pdf',CHUNK*2),'P5','2027-01-01');
  const b=h.context.upload(h.file('second.pdf'),'P6','2027-02-01');
  await tick();assert.equal(h.calls.filter(c=>c.name==='rapidImportBegin').length,1);
  gates.pending.get(0).resolve();gates.pending.get(1).resolve();await tick();
  assert.equal(h.calls.filter(c=>c.name==='rapidImportBegin').length,1,'second file still waits for durable confirmation');
  h.acknowledge();await a;await tick();
  const starts=h.calls.filter(c=>c.name==='rapidImportBegin');
  assert.deepEqual(starts.map(c=>[c.data.level,c.data.release]),[['P5','2027-01-01'],['P6','2027-02-01']]);
  gates.pending.get(0).resolve();await b;
  assert.equal(h.context.count(),0);
});
