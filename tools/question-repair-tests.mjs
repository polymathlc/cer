// Execute the shipped approval controller with real repair validation and
// deterministic AI, image and persistence fixtures. No account or paid calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as repairCore from '../question-repair-core.mjs';
import * as cropCore from '../question-crop-core.mjs';
const core={...repairCore,...cropCore};

export const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
export const htmlSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
export function controllerSection() {
  const start = appSource.indexOf('// ── Approved question repairs ──');
  const end = appSource.indexOf('// ── End approved question repairs ──', start);
  assert.ok(start >= 0 && end > start, 'Approved question repair controller is present');
  return appSource.slice(start, end);
}
export const sampleQuestion = () => ({
  id: 'q1', title: 'Comparing the mass of air', topic: 'Matter', category: 'MCQ',
  createdAt: '2026-01-01', source: { paper: 'Original paper', pages: [3] },
  releaseOn: '2026-12-01', tags: ['mass'], status: 'approved',
  blocks: [
    { id: 'wording', type: 'text', content: '<p>Two containers of water was placed on the balance.</p>', marks: 2 },
    { id: 'diagram', type: 'image', url: 'https://fixtures.test/original.png', scale: 0.6, caption: 'Containers A and B', answerImg: 'https://fixtures.test/annotated.png', answerKey: 'B is heavier.' },
    { id: 'answer', type: 'plainanswer', content: 'Container B has more air.' },
  ],
  answerKeywords: { answer: ['air'] }, blanks: {},
});
export const sampleFindings = () => [
  { type: 'Diagram', severity: 'high', title: 'Two options look identical', detail: 'Make option (2) horizontal.', ai: true },
  { type: 'Wording', severity: 'low', title: 'Opening sentence needs correction', detail: 'Use were instead of was.', ai: true },
];
export const samplePlan = (images = false) => ({ actions: [
  { kind: 'replace_text', target: 'block:wording:content', reason: 'Correct the opening sentence.', value: 'Two containers of water were placed on the balance.' },
  ...(images ? [{ kind: 'redraw_image', target: 'block:diagram:url', reason: 'Make the options distinct.', instruction: 'Make option (2) horizontal; preserve all other labels and containers.' }] : []),
], notes: ['Keep all unrelated details.'] });
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function harnessBody(section = controllerSection(), cropperSection = '') {
  return `
const { ${Object.keys(core).join(', ')} } = core;
const clone = value => JSON.parse(JSON.stringify(value));
const H = { ai: [], image: [], uploads: [], saves: [], checks: [], events: [], cropPixels: [], loadedImages: [], cropOpen: null,
  aiReply: env.plan, aiImpl: null, imageImpl: null, mediaImpl: null, loadImageImpl: null, saveImpl: null, author: true, owner: 'teacher',
  verdict: {state:'red',findings:env.findings}, recheckResult: {state:'green',findings:[]}, recheckImpl: null,
  bank: [clone(env.question)], vetting: [Object.assign(clone(env.question), {status:'pending'})],
  fields: {title:env.question.title,topic:env.question.topic,category:env.question.category},
  editor: clone(env.question), createActive: true, seq: 0 };
let currentUser = {uid:'teacher',name:'Teacher',role:'admin'};
const auth = {currentUser:{uid:'teacher'}};
let _practiceAs = null, questionBank=H.bank, vettingList=H.vetting;
let blocks=clone(env.question.blocks), selectedBlanks=clone(env.question.blanks || {}), editorKeywords=clone(env.question.answerKeywords || {});
let currentEditingQuestion=env.question.id, _cpbEdit=null;
let _em={on:false,busy:false,owner:{},qs:[{id:env.question.id,key:'one',title:env.question.title,n:1}]};
for(const b of blocks)_em.owner[b.id]=env.question.id;
const EM_KW_FIELDS=['content','text','claim','evidence','reasoning'];
function kwFieldKey(id,field){return ['content','text'].includes(field)?String(id):id+'_'+field;}
let _tlPanelScope=env.scope || 'create', _tlPanelId=env.question.id;
const _tlCache=new Map(), _imgEnhanceState={}, _ownerUidByQuestionId={q1:'original-owner'}, _ownerUidByVettingId={q1:'vetting-owner'};
const elements={};
const document=env.document || {activeElement:null,getElementById(id) {
  return elements[id] ||= {id,hidden:false,value:'',textContent:'',innerHTML:'',disabled:false,style:{},dataset:{},
    classList:{add(){},remove(){},contains(c){return c==='active'},toggle(){}},
    focus(){document.activeElement=this},scrollIntoView(){},removeAttribute(name){delete this[name];},querySelectorAll(){return []}};
},querySelectorAll(){return []},createElement(tag){
  if(tag==='canvas')return {width:0,height:0,getContext(){return {fillStyle:'',fillRect(){},drawImage(...args){H.cropPixels.push(args);}}},toDataURL(){return 'data:image/png;base64,Y3JvcA==';}};
  return {};
}};
const window=env.window || {};
${cropperSection ? '' : 'let _cropper=null, _cropOpenEpoch=0;'}
const FileReader=env.FileReader || class {readAsDataURL(file){this.result=file.data || 'data:image/png;base64,dXBsb2Fk';this.onload();}};
window.__aiReady=()=>H.author;
for(const [field,id] of [['title','questionTitle'],['topic','topicSelect'],['category','categorySelect']]){
  let input=document.getElementById(id);
  if(!input && env.document){input=document.createElement(field==='title'?'input':'select');input.id=id;input.hidden=true;document.body.append(input);}
  if(field!=='title'){
    const choices=field==='topic'?['Matter','Heat']:['MCQ','CER','Explanation'];
    if(env.document){for(const value of choices){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}}
    else input.options=choices.map(value=>({value}));
  }
  input.value=H.fields[field];
}
function _canAuthor(){return H.author && currentUser?.role==='admin' && !_practiceAs;}
function _isAdmin(){return _canAuthor();}
function _bankOwnerUid(){return H.owner;}
function _qOwner(id){return _ownerUidByQuestionId[id] || _bankOwnerUid();}
function _vOwner(id){return _ownerUidByVettingId[id] || _bankOwnerUid();}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function showToast(...args){H.events.push(['toast',...args]);}
function normalizeCategoryValue(v){return v;}
function currentTopics(){return ['Matter','Heat'];}
function aiGrounding(){return 'Use primary-school science.';}
function _cpbEditActive(){return !!_cpbEdit;}
function emActive(){return !!_em.on;}
function tlCreateActive(){return H.createActive && !_em.on;}
function tlDraftId(){return '__tl_draft__';}
function _docQById(id){return questionBank.find(q=>String(q.id)===String(id));}
function collectQuestionData(){return Object.assign(clone(H.editor),{id:currentEditingQuestion || '__tl_draft__',title:document.getElementById('questionTitle').value,topic:document.getElementById('topicSelect').value,category:document.getElementById('categorySelect').value,blocks:clone(blocks),blanks:clone(selectedBlanks),answerKeywords:clone(editorKeywords)});}
function carryOverQuestionMeta(q){const old=_docQById(q.id) || vettingList.find(x=>x.id===q.id);if(old)for(const [key,value] of Object.entries(old))if(q[key]===undefined)q[key]=clone(value);}
function tlCreateQuestion(){return tlCreateActive()?collectQuestionData():null;}
function emBlocksOf(id){return blocks.filter(b=>_em.owner[b.id]===String(id));}
function emKwFor(bs){const ids=new Set(bs.map(b=>b.id));return Object.fromEntries(Object.entries(editorKeywords).filter(([key])=>ids.has(key)));}
function emBlanksFor(bs){const ids=new Set(bs.map(b=>b.id));return Object.fromEntries(Object.entries(selectedBlanks).filter(([key])=>ids.has(key)));}
function tlEmQuestion(id){const old=_docQById(id),e=_em.qs.find(e=>e.id===id);return old && Object.assign(clone(old),e?.repairMeta || {},{title:e?.title || old.title,blocks:clone(emBlocksOf(id))});}
function tlQuestionFor(scope,id){return scope==='create'?tlCreateQuestion():scope==='em'?tlEmQuestion(id):scope==='vet'?vettingList.find(q=>q.id===id):_docQById(id);}
function syncEditorDomToBlocks(){H.events.push(['sync']);}
function tlSyncScreen(){syncEditorDomToBlocks();}
function tlSig(q){return JSON.stringify(q);}
function tlStateOf(q){return {...H.verdict,sig:tlSig(q)};}
function tlRepaint(){H.events.push(['repaint']);}
async function tlRun(q){H.checks.push(clone(q));H.verdict=H.recheckImpl?await H.recheckImpl(q):clone(H.recheckResult);return H.verdict;}
function renderBlocks(){H.events.push(['renderBlocks']);}
function renderQuestionBank(){H.events.push(['renderBank']);}
function renderVettingList(){H.events.push(['renderVetting']);}
function renderWsPreview(){}
function renderSavedWorksheets(){}
function updateCounts(){}
function emRenderStatus(){}
function emAfterRender(){}
function emAdoptOwners(){}
function generateBlockId(){return 'new_'+(++H.seq);}
function _parseAIJson(v){return typeof v==='string'?JSON.parse(v):v;}
function _cqRepr(q){return JSON.stringify(q);}
async function askGemini(prompt,opts){H.ai.push({prompt,opts,media:[]});return H.aiImpl?await H.aiImpl(prompt,[],opts):clone(H.aiReply);}
async function askGeminiVision(prompt,media,opts){H.ai.push({prompt,media,opts});return H.aiImpl?await H.aiImpl(prompt,media,opts):clone(H.aiReply);}
function transformImageUrl(url){return url;}
async function _urlToDataUrlRobust(url){H.events.push(['readImage',url]);return H.mediaImpl?await H.mediaImpl(url):'data:image/png;base64,ZmFrZQ==';}
async function _loadImageEl(url){H.loadedImages.push(url);return H.loadImageImpl?await H.loadImageImpl(url):env.loadImage?await env.loadImage(url):{naturalWidth:1000,naturalHeight:800,width:1000,height:800};}
async function openCropTool(id,options){H.cropOpen={id,options};_cropper={srcUrl:options.srcUrl};document.getElementById('cropApplyBtn').disabled=false;}
function closeCropTool(){H.cropOpen=null;_cropper=null;if(typeof tlRepairCropClosed==='function')tlRepairCropClosed(false);}
function _parseImageDataUrl(){return {mime:'image/png'};}
function imageAiReady(){return true;}
function qcmdDiagramPrompt(instruction){return instruction;}
async function qcmdRedrawDiagram(url,instruction){H.image.push({url,instruction,kind:'redraw'});return H.imageImpl?await H.imageImpl(): 'https://fixtures.test/redrawn.png';}
async function generateImageDataUrl(prompt,media,opts){H.image.push({prompt,media,opts,kind:'generate'});return H.imageImpl?await H.imageImpl():'data:image/png;base64,bmV3';}
async function uploadImageDataUrl(data){H.uploads.push(data);return 'https://fixtures.test/generated.png';}
function tableDataToFirestore(rows){return Object.fromEntries(rows.map((r,i)=>[String(i),Object.fromEntries(r.map((c,j)=>[String(j),c]))]));}
async function saveQuestion(q,opts){if(opts?.guard && !opts.guard())return false;H.saves.push({scope:'bank',q:clone(q),opts});return H.saveImpl?await H.saveImpl(q,opts):true;}
async function saveVettingQuestion(q,opts){if(opts?.guard && !opts.guard())return false;H.saves.push({scope:'vet',q:clone(q),opts});return H.saveImpl?await H.saveImpl(q,opts):true;}
${section}
${cropperSection}
return {H,document,elements,auth,
  tlRepairRefresh,tlRepairPrepare,tlRepairApply,tlRepairRevise,tlRepairDraftChanged,tlRepairCancel,tlRepairUndo,tlRepairReset,tlRepairRender,tlRepairRead,tlRepairCurrent,tlRepairCommit,
  get session(){return _tlRepairSession;},get epoch(){return _tlRepairEpoch;},
  get blocks(){return blocks;},set blocks(v){blocks=v;},
  get bank(){return questionBank;},get vetting(){return vettingList;},
  get editing(){return currentEditingQuestion;},set editing(v){currentEditingQuestion=v;},
  get user(){return currentUser;},set user(v){currentUser=v;auth.currentUser={uid:v?.uid};},
  set scope(v){_tlPanelScope=v;},get scope(){return _tlPanelScope;},
  set panelId(v){_tlPanelId=v;},set practice(v){_practiceAs=v;},
  get em(){return _em;},get owners(){return _ownerUidByQuestionId;},get vetOwners(){return _ownerUidByVettingId;},
  get editorKeywords(){return editorKeywords;},get selectedBlanks(){return selectedBlanks;},
  ...(typeof tlRepairAutoCrop==='function'?{tlRepairAutoCrop,tlRepairCropPixels,tlRepairManualCrop,tlRepairCropSourceChanged,tlRepairCropUpload,tlRepairCropClosed}:{}),
  get picker(){return typeof _tlCropPicker==='undefined'?null:_tlCropPicker;},get cropper(){return typeof _cropper==='undefined'?null:_cropper;},
  applyCropTool:typeof applyCropTool==='function'?applyCropTool:undefined,cropToolReset:typeof cropToolReset==='function'?cropToolReset:undefined,closeCropTool,
};`;
}
export function harness(options = {}) {
  const env = {question:sampleQuestion(),findings:sampleFindings(),plan:samplePlan(),...options};
  return new Function('core','env',harnessBody())(core,env);
}
export async function settle() { for(let i=0;i<15;i++) await Promise.resolve(); }

const cases=[];
const test=(name,run)=>cases.push({name,run});
async function start(h, state='red') {
  h.tlRepairRefresh(h.tlRepairRead(h.scope,'q1'),{state,findings:sampleFindings()});
  await settle();
}

test('findings automatically propose actions without changing questions, images or storage',async()=>{
  for(const state of ['red','amber','error']){
    const h=harness(); await start(h,state);
    assert.equal(h.session.stage,'ready');assert.equal(h.H.ai.length,1);
    assert.deepEqual(h.blocks,sampleQuestion().blocks);
    assert.deepEqual([h.H.image.length,h.H.uploads.length,h.H.saves.length],[0,0,0]);
    assert.ok(h.document.getElementById('tlRepairActions').innerHTML.includes('were placed'));
    h.tlRepairRefresh(h.tlRepairRead('create','q1'),{state,findings:sampleFindings()});
    await settle();assert.equal(h.H.ai.length,1,'Repaints reuse the same proposal');
  }
});
test('a clean, stale, running or unauthorized question never requests a repair plan',async()=>{
  for(const state of ['green','stale','running','idle']){const h=harness();await start(h,state);assert.equal(h.H.ai.length,0);}
  const h=harness();h.user={uid:'student',role:'student'};await start(h);assert.equal(h.H.ai.length,0);
});
test('Implement applies exactly reviewed text and reference-image instruction, then rechecks',async()=>{
  const h=harness({plan:samplePlan(true)});await start(h);
  const reviewed=structuredClone(h.session.plan);await h.tlRepairApply();
  assert.equal(h.session.stage,'applied');assert.equal(h.H.ai.length,1,'No unreviewed second text rewrite');
  assert.equal(h.blocks[0].content,reviewed.actions[0].value);
  assert.deepEqual(h.H.image,[{url:sampleQuestion().blocks[1].url,instruction:reviewed.actions[1].instruction,kind:'redraw'}]);
  assert.equal(h.blocks[1].url,'https://fixtures.test/redrawn.png');
  assert.equal(h.blocks[1].answerImg,sampleQuestion().blocks[1].answerImg);
  assert.equal(h.editing,'q1');assert.equal(h.H.saves.length,0,'Editor remains a draft');
  assert.equal(h.H.checks.length,1);assert.equal(h.H.checks[0].blocks[0].content,reviewed.actions[0].value);
});
test('a wording-only approval preserves image, marks, answer and editor identity',async()=>{
  const h=harness();await start(h);await h.tlRepairApply();
  assert.equal(h.H.image.length,0);assert.equal(h.blocks[0].marks,2);
  assert.deepEqual(h.blocks.slice(1),sampleQuestion().blocks.slice(1));
  assert.deepEqual(h.editorKeywords,{answer:['air']});assert.equal(h.editing,'q1');
});
test('cancelled planning ignores its late model reply',async()=>{
  const h=harness(),d=deferred();h.H.aiImpl=()=>d.promise;await start(h);
  assert.equal(h.session.stage,'planning');h.tlRepairCancel();
  d.resolve(samplePlan(true));await settle();
  assert.equal(h.session.stage,'cancelled');assert.equal(h.session.plan,null);
  assert.deepEqual(h.blocks,sampleQuestion().blocks);assert.equal(h.H.image.length,0);
});
test('cancelled image work cannot apply a late image or wording result',async()=>{
  const h=harness({plan:samplePlan(true)}),d=deferred();await start(h);h.H.imageImpl=()=>d.promise;
  const pending=h.tlRepairApply();await settle();assert.equal(h.session.stage,'applying');
  h.tlRepairCancel();d.resolve('https://fixtures.test/late.png');await pending;
  assert.equal(h.session.stage,'cancelled');assert.deepEqual(h.blocks,sampleQuestion().blocks);
  assert.equal(h.H.saves.length,0);assert.equal(h.H.checks.length,0);
});
test('closing the plan ignores a late completion and never reopens it',async()=>{
  const h=harness(),d=deferred();h.H.aiImpl=()=>d.promise;await start(h);
  assert.equal(h.tlRepairReset(),true);d.resolve(samplePlan());await settle();
  assert.equal(h.session,null);assert.equal(h.document.getElementById('tlRepairArea').hidden,true);
  assert.deepEqual(h.blocks,sampleQuestion().blocks);
});
test('revision disables the previous plan and the revised proposal still awaits approval',async()=>{
  const h=harness();await start(h);h.tlRepairRevise();h.tlRepairDraftChanged('Keep the diagram; change only wording.');
  await h.tlRepairApply();assert.deepEqual(h.blocks,sampleQuestion().blocks);
  assert.equal(h.document.getElementById('tlRepairApplyBtn').disabled,true);
  const revised=samplePlan();revised.actions[0].value='The two containers were placed on a balance.';
  h.H.aiReply=revised;await h.tlRepairRevise(true);
  assert.equal(h.session.stage,'ready');assert.equal(h.H.ai.length,2);
  assert.ok(h.H.ai[1].prompt.includes('Keep the diagram; change only wording.'));
  assert.deepEqual(h.blocks,sampleQuestion().blocks);
  await h.tlRepairApply();assert.equal(h.blocks[0].content,revised.actions[0].value);
});
test('changed content, editor, panel, account or owner prevents applying a stale plan',async()=>{
  const mutations=[h=>{h.blocks[0].content='Teacher made a newer edit';},h=>{h.editing='q2';},
    h=>{h.panelId='q2';},h=>{h.scope='bank';},h=>{h.user={uid:'other',role:'admin'};},
    h=>{h.H.owner='other-bank';},h=>{h.practice={uid:'student'};}];
  for(const change of mutations){const h=harness({plan:samplePlan(true)});await start(h);change(h);
    const before=structuredClone(h.blocks);await h.tlRepairApply();
    assert.equal(h.session.stage,'error');assert.deepEqual(h.blocks,before);
    assert.equal(h.H.image.length,0);assert.equal(h.H.saves.length,0);
  }
});
test('content or account changed while redrawing cannot be overwritten',async()=>{
  for(const mutation of [h=>{h.blocks[0].content='Newer teacher edit';},h=>{h.user={uid:'other',role:'admin'};}]){
    const h=harness({plan:samplePlan(true)}),d=deferred();await start(h);h.H.imageImpl=()=>d.promise;
    const pending=h.tlRepairApply();await settle();mutation(h);const before=structuredClone(h.blocks);
    d.resolve('https://fixtures.test/late.png');await pending;
    assert.equal(h.session.stage,'error');assert.deepEqual(h.blocks,before);assert.equal(h.H.saves.length,0);
  }
});
test('failed image work or malformed proposals leave every original block unchanged',async()=>{
  const h=harness({plan:samplePlan(true)});await start(h);h.H.imageImpl=async()=>{throw Error('Image service unavailable');};
  await h.tlRepairApply();assert.equal(h.session.stage,'error');assert.deepEqual(h.blocks,sampleQuestion().blocks);
  assert.equal(h.H.saves.length,0);assert.equal(h.H.checks.length,0);
  for(const plan of [{actions:[{kind:'delete',target:'block:wording:content',reason:'bad'}]},null,'not json']){
    const f=harness({plan});await start(f);assert.equal(f.session.stage,'error');assert.deepEqual(f.blocks,sampleQuestion().blocks);
  }
});
test('bank and vetting approvals save only the right collection and preserve metadata',async()=>{
  for(const scope of ['bank','vet']){
    const h=harness({scope});await start(h);const other=structuredClone(scope==='bank'?h.vetting:h.bank);
    await h.tlRepairApply();assert.equal(h.session.stage,'applied');assert.equal(h.H.saves.length,1);
    const written=h.H.saves[0];assert.equal(written.scope,scope);assert.equal(written.q.id,'q1');
    assert.deepEqual(written.q.source,sampleQuestion().source);assert.equal(written.q.releaseOn,sampleQuestion().releaseOn);
    assert.deepEqual(written.q.tags,['mass']);assert.equal(written.q.createdAt,'2026-01-01');
    assert.equal(written.q.status,scope==='vet'?'pending':'approved');
    assert.deepEqual(scope==='bank'?h.vetting:h.bank,other);
    assert.equal(h.owners.q1,'original-owner');assert.equal(h.vetOwners.q1,'vetting-owner');
  }
});
test('an owner-map change after review refuses writes to a different document owner',async()=>{
  for(const scope of ['bank','vet']){
    const h=harness({scope});await start(h);(scope==='bank'?h.owners:h.vetOwners).q1='different-owner';
    await h.tlRepairApply();assert.equal(h.H.saves.length,0);assert.equal(h.session.stage,'error');
  }
});
test('failed saves leave local records untouched and permit a new instruction',async()=>{
  for(const scope of ['bank','vet']){
    const h=harness({scope});await start(h);const record=(scope==='bank'?h.bank:h.vetting)[0];
    const before=structuredClone(record);h.H.saveImpl=async()=>false;await h.tlRepairApply();
    assert.equal(h.session.stage,'error');assert.equal((scope==='bank'?h.bank:h.vetting)[0],record);
    assert.deepEqual(record,before);assert.equal(h.H.checks.length,0);
    h.tlRepairRevise();assert.equal(h.document.getElementById('tlRepairInstructionWrap').hidden,false);
  }
});
test('double implement and closing during a save cannot duplicate or interrupt its write',async()=>{
  const h=harness({scope:'bank'}),d=deferred();await start(h);h.H.saveImpl=()=>d.promise;
  const pending=h.tlRepairApply();await settle();assert.equal(h.session.stage,'committing');
  await h.tlRepairApply();assert.equal(h.H.saves.length,1);assert.equal(h.tlRepairReset(),false);
  h.tlRepairCancel();assert.equal(h.session.stage,'committing');assert.equal(h.document.getElementById('tlDoneBtn').disabled,true);
  assert.deepEqual(h.bank[0],sampleQuestion());d.resolve(true);await pending;
  assert.equal(h.session.stage,'applied');assert.equal(h.H.saves.length,1);
});
test('a delayed write finishing in another account cannot replace its visible question',async()=>{
  const h=harness({scope:'bank'}),d=deferred();await start(h);h.H.saveImpl=()=>d.promise;
  const pending=h.tlRepairApply();await settle();h.user={uid:'another',role:'admin'};
  assert.equal(h.H.saves[0].opts.guard(),false,'Retry guard sees the changed account');
  d.resolve(true);await pending;assert.equal(h.session.stage,'error');assert.deepEqual(h.bank[0],sampleQuestion());
  assert.equal(h.H.checks.length,0);
});
test('worksheet repairs affect only owned blocks and retain topic changes for Save',async()=>{
  const plan=samplePlan();plan.actions.push({kind:'replace_text',target:'q:topic',reason:'Use the correct topic.',value:'Heat'});
  const h=harness({scope:'em',plan});h.em.on=true;
  const extra={id:'other',type:'text',content:'Another question stays untouched.'};
  h.blocks=[...h.blocks,extra];h.em.owner.other='q2';h.em.qs.push({id:'q2',key:'two',title:'Other'});
  await start(h);await h.tlRepairApply();assert.equal(h.session.stage,'applied');
  assert.deepEqual(h.blocks.find(b=>b.id==='other'),extra);assert.equal(h.em.owner.other,'q2');
  assert.equal(h.em.qs[0].repairMeta.topic,'Heat');assert.equal(h.H.saves.length,0);
  assert.deepEqual(h.bank[0],sampleQuestion());
});
test('missing and new diagrams are generated only after approval and use the education route',async()=>{
  for(const add of [false,true]){
    const question=sampleQuestion();question.blocks[1].url='';
    const plan={actions:[add?{kind:'add_block',target:'new:image',reason:'Restore the missing figure.',instruction:'Draw containers A and B on a horizontal balance.',afterBlockId:'wording'}:
      {kind:'generate_image',target:'block:diagram:url',reason:'Restore the missing figure.',instruction:'Draw containers A and B on a horizontal balance.'}],notes:[]};
    const h=harness({question,plan});await start(h);assert.equal(h.H.image.length,0);
    await h.tlRepairApply();assert.equal(h.session.stage,'applied');assert.equal(h.H.image.length,1);assert.equal(h.H.uploads.length,1);
    assert.equal(h.H.image[0].media.purpose,'education');
    const image=add?h.blocks[1]:h.blocks.find(b=>b.id==='diagram');assert.equal(image.url,'https://fixtures.test/generated.png');
  }
});
test('Undo restores prior content through the same scope without another model call',async()=>{
  for(const scope of ['create','bank','vet','em']){
    const h=harness({scope,plan:samplePlan(true)});if(scope==='em')h.em.on=true;
    await start(h);const before=h.tlRepairRead(scope,'q1');await h.tlRepairApply();await h.tlRepairUndo();
    assert.deepEqual(h.tlRepairRead(scope,'q1'),before);assert.equal(h.H.ai.length,1);assert.equal(h.H.image.length,1);
    assert.equal(h.session.undo,null);assert.equal(h.H.checks.length,2);
  }
});
test('Undo refuses to overwrite edits made after implementation',async()=>{
  const h=harness();await start(h);await h.tlRepairApply();h.blocks[0].content='Teacher edited the repair.';
  await h.tlRepairUndo();assert.equal(h.blocks[0].content,'Teacher edited the repair.');
  assert.match(h.session.message,/Undo is unavailable/);assert.equal(h.H.saves.length,0);
});
test('an empty proposed action list cannot be implemented',async()=>{
  const h=harness({plan:{actions:[],notes:['The diagram is too ambiguous to infer the intended answer.']}});await start(h);
  assert.equal(h.session.stage,'ready');assert.equal(h.document.getElementById('tlRepairApplyBtn').disabled,true);
  await h.tlRepairApply();assert.deepEqual(h.blocks,sampleQuestion().blocks);assert.equal(h.H.saves.length,0);
});
test('remaining findings produce a new review plan without automatically applying another fix',async()=>{
  const h=harness({scope:'bank'});await start(h);
  h.H.recheckResult={state:'amber',findings:[sampleFindings()[0]]};
  h.H.aiReply={actions:[samplePlan(true).actions[1]],notes:[]};
  await h.tlRepairApply();
  assert.equal(h.session.stage,'ready');assert.equal(h.H.ai.length,2);
  assert.equal(h.H.saves.length,1);assert.equal(h.H.image.length,0,'Further image work still needs approval');
  assert.equal(h.session.plan.actions[0].kind,'redraw_image');
  assert.match(h.session.message,/approve this new plan/);assert.ok(h.session.undo);
  await h.tlRepairUndo();assert.deepEqual(h.bank[0],sampleQuestion());
  assert.equal(h.H.ai.length,2,'Undo does not launch another proposal loop');
});
test('failed follow-up checks leave the repair undoable and never claim a clean result',async()=>{
  for(const throws of [false,true]){
    const h=harness();await start(h);
    h.H.recheckResult={state:'error',findings:[],error:'Checker unavailable'};
    if(throws)h.H.recheckImpl=async()=>{throw Error('Checker unavailable');};
    await h.tlRepairApply();assert.equal(h.session.stage,'applied');assert.ok(h.session.undo);
    assert.match(h.session.message,/follow-up check could not finish/);
    assert.doesNotMatch(h.session.message,/no further issues/);assert.equal(h.H.ai.length,1);
  }
});
test('unsupported topic or category suggestions remain review errors and cannot change dropdowns',async()=>{
  for(const scope of ['create','bank','em'])for(const target of ['q:topic','q:category']){
    const h=harness({scope,plan:{actions:[{kind:'replace_text',target,reason:'Incorrect classification.',value:'Invented unavailable choice'}],notes:[]}});
    if(scope==='em')h.em.on=true;await start(h);assert.equal(h.session.stage,'error');
    await h.tlRepairApply();assert.deepEqual(h.blocks,sampleQuestion().blocks);assert.equal(h.H.saves.length,0);
  }
});
test('the real bank and vetting writers stop before a stale first write or retry',async()=>{
  const begin=appSource.indexOf('async function saveQuestion(q, opts)'),end=appSource.indexOf('// Delete one question doc',begin);
  assert.ok(begin>=0 && end>begin);
  const make=()=>new Function(`
    let currentUser={uid:'teacher'},_wkSuppress=0,_inflightOps=0,allowed=true;
    const writes=[],states=[],db={};let fail=false,changeOnRetry=false;
    const _qRef=id=>'bank/'+id,_vRef=id=>'vet/'+id,_setSaveStatus=s=>states.push(s);
    const _wkLogQuestion=()=>{},styleHarvestQuestion=()=>{},showToast=()=>{},_xtAnnounceQuestion=()=>{};
    const _scienceFeedSummary=()=>({}),console={warn(){},error(){}};
    const setDoc=async(ref,payload)=>{writes.push([ref,payload]);if(fail)throw Error('Network interruption');};
    const setTimeout=fn=>{if(changeOnRetry)allowed=false;fn();};
    ${appSource.slice(begin,end)}
    return {saveQuestion,saveVettingQuestion,writes,states,guard:()=>allowed,
      get inflight(){return _inflightOps;},set allowed(v){allowed=v;},set fail(v){fail=v;},set changeOnRetry(v){changeOnRetry=v;}};
  `)();
  for(const fn of ['saveQuestion','saveVettingQuestion']){
    const first=make();first.allowed=false;assert.equal(await first[fn]({id:'q1'},{guard:first.guard}),false);
    assert.equal(first.writes.length,0);assert.equal(first.inflight,0);
    const retry=make();retry.fail=true;retry.changeOnRetry=true;
    assert.equal(await retry[fn]({id:'q1'},{guard:retry.guard}),false);
    assert.equal(retry.writes.length,1,'No retry may write after account/question changes');assert.equal(retry.inflight,0);
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failed=0;
  for(const item of cases){try{await item.run();console.log('PASS',item.name);}catch(error){failed++;console.error('FAIL',item.name,error.stack);}}
  console.log(cases.length-failed+' passed, '+failed+' failed');
  if(failed)process.exitCode=1;
}
