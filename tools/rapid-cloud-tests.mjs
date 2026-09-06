import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('// Durable PDF imports.'),source.indexOf('const RAPID_PDF_MAX_PAGES = 60;'));
function harness(failFinish=false) {
  const calls=[],statuses=[],storage=new Map(),elements={rapidCloudMode:{checked:true},rapidCloudNote:{},rapidCloudJobs:{querySelectorAll:()=>[]}};
  let acknowledge;
  const gate=new Promise(r=>acknowledge=r);
  const context={crypto:webcrypto,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    setTimeout,clearTimeout,currentUser:{uid:'teacher'},app:{},getFunctions:()=>({}),
    httpsCallable:(f,name)=>async data=>{calls.push({name,data});if(name==='rapidImportFinish'){await gate;if(failFinish)throw new Error('No acknowledgement');}return {data:name==='rapidImportStatus'?{available:true,jobs:[]}: {}};},
    document:{getElementById:id=>elements[id]},currentTopicsByLevel:()=>({P5:['Heat'],P6:['Energy']}),currentTopics:()=>['Heat'],
    aiEngineOrder:()=>['openai','gemini'],_aiBuildQuestionPrompt:(a,b,level)=>'Captured '+level,aiGrounding:()=>'',autoChkOn:()=>true,_isAdmin:()=>true,
    rapidJobs:[],_updateRapidCounts(){},renderVettingList(){},_fileToBase64:async()=>'%PDF',_setRapidStatus:m=>statuses.push(m),
    _setRapidJobState:(id,patch)=>Object.assign(context.rapidJobs.find(j=>j.id===id),patch),
    _removeRapidJob:id=>{context.rapidJobs=context.rapidJobs.filter(j=>j.id!==id);},
    _failRapidJob:(id,e)=>{Object.assign(context.rapidJobs.find(j=>j.id===id),{status:'error',error:e.message});},
    _vCol:()=>({}),onSnapshot:()=>()=>{},escapeHtml:String,
  };
  vm.createContext(context);vm.runInContext(block+'\nthis.upload=_rapidUploadPdf;this.count=()=>_rapidCloudUploading;',context);
  const file=name=>({name,size:7,lastModified:1,slice:()=>({})});
  return {context,calls,statuses,acknowledge,file};
}
test('safe-to-close is never shown before durable acknowledgement',async()=>{
  const h=harness(),p=h.context.upload(h.file('a.pdf'),'P5','2027-01-01');
  await new Promise(r=>setImmediate(r));
  assert.equal(h.context.count(),1);assert.ok(!h.statuses.some(s=>s.includes('Safe to close')));
  h.acknowledge();await p;assert.equal(h.context.count(),0);assert.ok(h.statuses.some(s=>s.includes('Safe to close')));
});
test('multiple PDFs retain settings and upload independently in sequence',async()=>{
  const h=harness();const a=h.context.upload(h.file('a.pdf'),'P5','2027-01-01'),b=h.context.upload(h.file('b.pdf'),'P6','2027-02-01');
  assert.equal(h.context.count(),2);h.acknowledge();await Promise.all([a,b]);
  const starts=h.calls.filter(c=>c.name==='rapidImportBegin');
  assert.deepEqual(starts.map(c=>c.data.level),['P5','P6']);assert.deepEqual(starts.map(c=>c.data.release),['2027-01-01','2027-02-01']);
  assert.equal(h.calls.filter(c=>c.name==='rapidImportFinish').length,2);
});
test('lost acknowledgement leaves a failure card and reuses import ID on reselection',async()=>{
  const h=harness(true);h.acknowledge();await h.context.upload(h.file('a.pdf'),'P5','');
  assert.equal(h.context.rapidJobs[0].status,'error');assert.ok(!h.statuses.some(s=>s.includes('Safe to close')));
  await h.context.upload(h.file('a.pdf'),'P5','');
  const starts=h.calls.filter(c=>c.name==='rapidImportBegin');assert.equal(starts[0].data.id,starts[1].data.id);
});
