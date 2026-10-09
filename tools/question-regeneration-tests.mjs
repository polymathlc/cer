// Exercise the shipped regeneration entry point and approval controller with
// deterministic checker, AI, image and persistence fixtures. No paid calls.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as repairCore from '../question-repair-core.mjs';
import * as cropCore from '../question-crop-core.mjs';
import { appSource, htmlSource, controllerSection, harnessBody, sampleQuestion, sampleFindings, samplePlan, deferred, settle } from './question-repair-tests.mjs';

const core = { ...repairCore, ...cropCore };
export { appSource, htmlSource, sampleQuestion, sampleFindings, samplePlan };
export function regenerationModalSection() {
  const start = appSource.indexOf('// ── Regenerate the current draft:');
  const end = appSource.indexOf('// Turn an existing question into plain text', start);
  const confirm = appSource.indexOf('async function confirmRegenerate()');
  const confirmEnd = appSource.indexOf('function deleteQuestion(', confirm);
  assert.ok(start >= 0 && end > start && confirm >= 0 && confirmEnd > confirm, 'The shipped regeneration modal controller is present');
  return 'document.addEventListener ||= () => {};\n' + appSource.slice(start, end) + '\n' + appSource.slice(confirm, confirmEnd);
}
function shippedFunction(startText, endText) {
  const start = appSource.indexOf(startText), end = appSource.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, startText + ' is present');
  return appSource.slice(start, end);
}
export function regenerationEditorSection() {
  return `
// Use shipped editor reads and answer-key writes, rather than shadowing them
// with the existing harness's simpler question fixture.
let editorLos=clone(env.question.los || []),editorMcqLabels=env.question.mcqLabels || '';
function applyMcqCategory(q){return q;}
function parseTagInput(v){return v.split(',').filter(Boolean);}
function _snapTagsToBank(v){return v;}
function akdQuestionNote(){return document.getElementById('akdQuestionNote')?.value || '';}
function _renderAnswerKeyPreview(){H.events.push(['answerKeyPreview']);}
${shippedFunction('function collectQuestionData() {', 'function setEditMode(')}
${shippedFunction('function tlCreateQuestion() {', '// The wording lives in contenteditable')}
${shippedFunction('function _setAnswerKeyFields(', '// 🖼 AUTO DIAGRAM')}
for(const [id,value] of Object.entries({questionAnswerKeyNote:env.question.answerKeyNote || '',questionAnswerKeyImage:env.question.answerKeyImage || '',akdQuestionNote:env.question.answerKeyDiagramNote || '',questionTags:(env.question.tags || []).join(','),questionMarkingGuide:env.question.markingGuide || '',categorySelect2:env.question.category2 || '',topicSelect2:env.question.topic2 || ''})){
  let input=document.getElementById(id);
  if(!input && env.document){input=document.createElement('input');input.id=id;input.hidden=true;document.body.append(input);}
  input.value=value;
}
_editorImageSources=env.question.imageSources?clone(env.question.imageSources):null;
`;
}
export function regenerationHarnessBody() {
  assert.ok(appSource.includes('function qregenStart('), 'The shipped regeneration entry point is present');
  return harnessBody(controllerSection() + '\n' + regenerationModalSection() + '\n' + regenerationEditorSection()).replace('return {H,document,elements,auth,', 'return {H,document,elements,auth,qregenStart,openRegenerateModal,openQuestionRegenerator,closeRegenerateModal,confirmRegenerate,tlCreateQuestion,collectQuestionData,get imageSources(){return _editorImageSources;},set imageSources(v){_editorImageSources=v;},set mcqLabels(v){editorMcqLabels=v;},get enhanceState(){return _imgEnhanceState;},');
}
export function regenerationHarness(options = {}) {
  const env = { question: sampleQuestion(), findings: sampleFindings(), plan: samplePlan(true), ...options };
  const h = new Function('core', 'env', regenerationHarnessBody())(core, env);
  h.sourceScope=env.scope || 'create';h.original=structuredClone(env.question);
  return h;
}


export function regeneratedCopy(h){
 const q=h.bank.find(q=>q.id===h.session?.id && q.id!=='q1')||h.bank.find(q=>q.regeneratedFrom==='q1');
 assert.ok(q && q.id!=='q1','A separately identified saved copy exists');return q;
}
const cases=[];
const test=(name,run)=>cases.push({name,run});
async function start(h,command=''){await h.qregenStart(h.sourceScope,'q1',command);await settle();}
function unchanged(h,sourceBlocks=h.original.blocks){
 assert.deepEqual(h.blocks,sourceBlocks,'Source editor blocks remain intact');
 assert.deepEqual(h.bank.find(q=>q.id==='q1'),h.original,'Source bank question remains intact');
 assert.equal(h.editing,'q1','Source editor identity remains intact');
 assert.ok(h.H.saves.every(write=>write.q.id!=='q1'),'No regeneration write targets the original');
}
function checkCopy(h,saves=1){
 const q=regeneratedCopy(h);assert.equal(h.bank.length,2,'Only one new bank question is allocated');
 assert.equal(q.regeneratedFrom,'q1');assert.equal(h.session.scope,'bank');assert.equal(h.H.saves.length,saves);
 assert.equal(h.H.saves[0].scope,'bank');assert.equal(h.H.saves[0].q.id,q.id);return q;
}
test('the command modal reads unsaved source edits without creating a copy until submission',async()=>{
 const h=regenerationHarness();h.blocks[0].content='An unsaved teacher correction.';const before=structuredClone(h.blocks);
 h.document.getElementById('regenRemark').value='Previous command';h.openRegenerateModal();
 assert.equal(h.document.getElementById('regenRemark').value,'');assert.equal(h.document.activeElement.id,'regenRemark');
 assert.equal(h.document.getElementById('regenConfirmBtn').disabled,false);
 assert.deepEqual([h.H.ai.length,h.H.image.length,h.H.saves.length,h.H.checks.length],[0,0,0,0]);
 await h.confirmRegenerate();const q=checkCopy(h);assert.equal(q.blocks[0].content,before[0].content);
 assert.equal(h.H.checks[0].id,q.id);assert.equal(h.session.instruction,'');assert.equal(h.session.stage,'ready');unchanged(h,before);
});
test('duplicate saving finishes before checking, planning or image changes begin',async()=>{
 const h=regenerationHarness(),save=deferred();h.H.saveImpl=()=>save.promise;
 const pending=h.qregenStart('create','q1','Use three containers.');await settle();
 assert.equal(h.session.stage,'duplicating');assert.equal(h.H.saves.length,1);assert.equal(h.bank.length,1);
 assert.deepEqual([h.H.checks.length,h.H.ai.length,h.H.image.length,h.H.uploads.length],[0,0,0,0]);unchanged(h);
 save.resolve(true);await pending;await settle();const q=checkCopy(h);assert.deepEqual(q.blocks,h.original.blocks);
 assert.equal(h.H.checks[0].id,q.id);assert.equal(h.session.stage,'ready');assert.equal(h.H.image.length,0);unchanged(h);
});
test('an empty command checks the saved green copy and plans autonomous changes awaiting approval',async()=>{
 const h=regenerationHarness();h.H.recheckImpl=async q=>{
  assert.equal(h.H.saves.length,1);assert.ok(h.bank.some(stored=>stored.id===q.id));assert.notEqual(q.id,'q1');
  assert.equal(h.H.ai.length,0,'Checking precedes planning');return {state:'green',findings:[]};
 };
 await start(h);const q=checkCopy(h);assert.equal(h.H.checks.length,1);assert.equal(h.H.ai.length,1);
 assert.equal(h.session.stage,'ready');assert.equal(h.session.mode,'regeneration');
 assert.match(h.H.ai[0].prompt,/regenerat/i);assert.match(h.H.ai[0].prompt,/different|new variation|meaningful.*chang/i);
 assert.match(h.document.getElementById('tlRepairApplyBtn').textContent,/Approve regeneration plan/);
 assert.deepEqual(q.blocks,h.original.blocks);assert.deepEqual([h.H.image.length,h.H.uploads.length],[0,0]);unchanged(h);
});
test('the duplicate preserves deep metadata and unsaved keys, keywords, crop sources and marks',async()=>{
 const question={...sampleQuestion(),category2:'Explanation',topic2:'Heat',markingGuide:'Old guide',los:['objective1'],mcqLabels:'letters',
  answerKeyNote:'Old key',answerKeyImage:'https://fixtures.test/key.png',answerKeyDiagramNote:'Old labels',
  sourcePages:[{page:3,url:'https://fixtures.test/page.png'}],
  imageSources:{'q:answerKeyImage':{url:'https://fixtures.test/key-original.png',imageUrl:'https://fixtures.test/key.png',original:true}},
  checked:true,autoCheck:{state:'green'},usage:{attempts:99}};
 const h=regenerationHarness({question});h.blocks[0].content='An unsaved variation source.';
 h.document.getElementById('questionAnswerKeyNote').value='Unsaved key explanation';
 h.document.getElementById('questionMarkingGuide').value='Unsaved guide';h.document.getElementById('questionTags').value='mass,air';
 h.editorKeywords.answer=['unsaved keyword'];const before=structuredClone(h.blocks);await start(h);const q=checkCopy(h);
 assert.notEqual(q.createdAt,question.createdAt);assert.ok(!Number.isNaN(Date.parse(q.createdAt)));assert.ok(q.createdBy);
 for(const key of ['source','sourcePages','category2','topic2','los','mcqLabels','releaseOn','status','imageSources'])assert.deepEqual(q[key],question[key],key+' retained');
 assert.equal(q.answerKeyNote,'Unsaved key explanation');assert.equal(q.markingGuide,'Unsaved guide');assert.deepEqual(q.tags,['mass','air']);
 assert.deepEqual(q.answerKeywords.answer,['unsaved keyword']);assert.equal(q.blocks[0].marks,2);assert.equal(q.blocks[0].content,before[0].content);
 assert.equal(q.checked,undefined);assert.equal(q.autoCheck,undefined);assert.equal(q.usage,undefined);
 assert.notEqual(q.blocks,h.blocks);assert.notEqual(q.blocks[1],h.blocks[1]);assert.notEqual(q.imageSources,h.imageSources);
 assert.equal(h.H.checks[0].answerKeyImage,question.answerKeyImage);unchanged(h,before);
});
test('optional commands and checker findings reach the copy plan without source changes',async()=>{
 const h=regenerationHarness();h.H.recheckResult={state:'amber',findings:sampleFindings()};
 const command='Use three containers instead of two and keep the air-mass learning objective.';await start(h,command);checkCopy(h);
 assert.ok(h.H.ai[0].prompt.includes(command));for(const finding of sampleFindings())assert.ok(h.H.ai[0].prompt.includes(finding.title));
 assert.equal(h.H.ai[0].media.length,2);assert.deepEqual([h.H.image.length,h.H.uploads.length],[0,0]);unchanged(h);
});
test('approval saves the exact reviewed wording and diagram to the copy then checks only that copy',async()=>{
 const h=regenerationHarness();await start(h,'Use another container situation.');const id=regeneratedCopy(h).id,reviewed=structuredClone(h.session.plan);
 await h.tlRepairApply();const q=checkCopy(h,2);assert.equal(h.session.stage,'applied');assert.equal(q.id,id);assert.equal(h.H.ai.length,1);
 assert.equal(q.blocks[0].content,reviewed.actions[0].value);
 assert.deepEqual(h.H.image,[{url:h.original.blocks[1].url,instruction:reviewed.actions[1].instruction,kind:'redraw'}]);
 assert.equal(q.blocks[1].url,'https://fixtures.test/redrawn.png');assert.equal(q.blocks[1].answerImg,h.original.blocks[1].answerImg);
 assert.equal(h.H.saves[1].q.id,id);assert.equal(h.H.saves[1].q.blocks[0].content,reviewed.actions[0].value);
 assert.equal(h.H.checks.length,2);assert.ok(h.H.checks.every(check=>check.id===id));assert.equal(h.H.checks[1].blocks[1].url,q.blocks[1].url);unchanged(h);
});
test('worksheet regeneration creates a bank copy without replacing or adding worksheet members',async()=>{
 const h=regenerationHarness({scope:'em'});h.em.on=true;
 const extra={id:'other',type:'plainanswer',content:'Other question stays untouched.'};h.blocks=[...h.blocks,extra];
 h.em.owner.other='q2';h.em.qs.push({id:'q2',key:'two',title:'Other question'});h.editorKeywords.other=['unrelated'];h.selectedBlanks.other=[1];
 h.em.qs[0].repairMeta={topic:'Heat'};
 const before={blocks:structuredClone(h.blocks),em:structuredClone(h.em),keywords:structuredClone(h.editorKeywords),blanks:structuredClone(h.selectedBlanks)};
 h.openQuestionRegenerator('one');h.document.getElementById('regenRemark').value='  Use three sealed containers.  ';await h.confirmRegenerate();
 const q=checkCopy(h);assert.equal(q.topic,'Heat');assert.equal(q.blocks.length,h.original.blocks.length);
 assert.equal(h.session.instruction,'Use three sealed containers.');assert.equal(h.H.checks[0].blocks.length,h.original.blocks.length);
 await h.tlRepairApply();checkCopy(h,2);assert.equal(regeneratedCopy(h).blocks[1].url,'https://fixtures.test/redrawn.png');
 assert.deepEqual(h.em,before.em);assert.deepEqual(h.editorKeywords,before.keywords);assert.deepEqual(h.selectedBlanks,before.blanks);unchanged(h,before.blocks);
 await h.tlRepairUndo();checkCopy(h,3);assert.deepEqual(regeneratedCopy(h).blocks,h.original.blocks);assert.deepEqual(h.em,before.em);unchanged(h,before.blocks);
});
test('a duplicate save failure starts no checker, planner or image request',async()=>{
 for(const throws of [false,true]){
  const h=regenerationHarness();h.H.saveImpl=async()=>{if(throws)throw Error('Storage failed');return false;};
  await start(h);assert.equal(h.bank.length,1);assert.equal(h.H.saves.length,1);
  assert.deepEqual([h.H.checks.length,h.H.ai.length,h.H.image.length,h.H.uploads.length],[0,0,0,0]);unchanged(h);
 }
});
test('retrying a failed initial duplicate save creates one copy before any regeneration work',async()=>{
 const h=regenerationHarness();h.H.saveImpl=async()=>false;await start(h);
 assert.equal(h.session.stage,'error');assert.equal(h.bank.length,1);assert.deepEqual([h.H.ai.length,h.H.checks.length,h.H.image.length],[0,0,0]);
 h.H.saveImpl=async()=>true;h.tlRepairRevise();h.tlRepairDraftChanged('Try another container situation.');
 await h.tlRepairRevise(true);await settle();const q=regeneratedCopy(h);
 assert.equal(h.bank.length,2);assert.equal(h.session.scope,'bank');assert.equal(h.H.saves.length,2);
 assert.equal(h.H.saves[1].q.id,q.id);assert.equal(h.H.ai.length,1);assert.equal(h.H.checks.length,1);assert.equal(h.session.stage,'ready');unchanged(h);
});
test('changed source or account after opening the modal refuses duplication',async()=>{
 for(const mutate of [h=>{h.blocks[0].content='Newer source edit';},h=>{h.user={uid:'other',role:'admin'};}]){
  const h=regenerationHarness();h.openRegenerateModal();mutate(h);const before=structuredClone(h.blocks);await h.confirmRegenerate();
  assert.equal(h.bank.length,1);assert.deepEqual([h.H.saves.length,h.H.checks.length,h.H.ai.length,h.H.image.length],[0,0,0,0]);unchanged(h,before);
 }
});
test('account, source or editor changes during duplication cannot insert a stale copy or start AI',async()=>{
 for(const mutate of [h=>{h.blocks[0].content='Newer source edit';},h=>{h.editing='q2';},h=>{h.user={uid:'other',role:'admin'};},h=>{h.owners.q1='changed-source-owner';}]){
  const h=regenerationHarness(),save=deferred();h.H.saveImpl=()=>save.promise;const pending=h.qregenStart('create','q1');await settle();
  mutate(h);const before=structuredClone(h.blocks);assert.equal(h.H.saves[0].opts.guard(),false);
  save.resolve(true);await pending;assert.equal(h.bank.length,1);assert.deepEqual([h.H.checks.length,h.H.ai.length,h.H.image.length],[0,0,0]);
  assert.deepEqual(h.blocks,before);assert.deepEqual(h.bank[0],h.original);
 }
});
test('rapid duplicate clicks allocate and save only one new question',async()=>{
 const h=regenerationHarness(),save=deferred();h.H.saveImpl=()=>save.promise;
 const first=h.qregenStart('create','q1','Use different containers.');await settle();
 const second=h.qregenStart('create','q1','Use different containers.');await settle();
 assert.equal(h.H.saves.length,1);assert.equal(h.bank.length,1);save.resolve(true);await Promise.all([first,second]);
 checkCopy(h);assert.equal(h.H.checks.length,1);assert.equal(h.H.ai.length,1);unchanged(h);
});
test('cancelling pending duplication retains a successful unchanged copy and launches no late AI',async()=>{
 const h=regenerationHarness(),save=deferred();h.H.saveImpl=()=>save.promise;
 const pending=h.qregenStart('create','q1');await settle();h.tlRepairCancel();save.resolve(true);await pending;
 assert.deepEqual([h.H.checks.length,h.H.ai.length,h.H.image.length],[0,0,0]);assert.equal(h.bank.length,2);
 assert.deepEqual(regeneratedCopy(h).blocks,h.original.blocks);unchanged(h);
});
test('failed checks retain the saved unchanged copy and revisions retry using the same ID',async()=>{
 const h=regenerationHarness();h.H.recheckImpl=async()=>({state:'error',findings:[],error:'Checker unavailable'});
 await start(h);const q=checkCopy(h),id=q.id;assert.equal(h.session.stage,'error');assert.equal(h.H.ai.length,0);assert.deepEqual(q.blocks,h.original.blocks);
 h.tlRepairRevise();h.tlRepairDraftChanged('Try the copy again.');h.H.recheckImpl=async()=>({state:'green',findings:[]});
 await h.tlRepairRevise(true);await settle();checkCopy(h);assert.equal(h.session.id,id);assert.equal(h.H.checks.length,2);
 assert.equal(h.H.ai.length,1);assert.equal(h.session.stage,'ready');unchanged(h);
});
test('blank revisions reuse the saved copy and invalidate the previous approval',async()=>{
 const h=regenerationHarness();await start(h,'Use different containers.');const id=regeneratedCopy(h).id;
 h.tlRepairRevise();h.tlRepairDraftChanged('');assert.equal(h.document.getElementById('tlRepairApplyBtn').disabled,true);
 assert.equal(h.document.getElementById('tlRepairUpdateBtn').disabled,false);await h.tlRepairApply();checkCopy(h);
 const next=samplePlan(true);next.actions[0].value='Three sealed containers are on a balance.';h.H.aiReply=next;
 await h.tlRepairRevise(true);checkCopy(h);assert.equal(h.session.id,id);assert.equal(h.session.instruction,'');
 assert.equal(h.H.ai.length,2);assert.equal(h.H.image.length,0);assert.equal(h.session.stage,'ready');unchanged(h);
});
test('reopening the source modal with revised commands reuses the already saved copy',async()=>{
 const h=regenerationHarness();await start(h,'Use three containers.');const id=regeneratedCopy(h).id;
 h.openRegenerateModal();h.document.getElementById('regenRemark').value='Use four containers instead.';await h.confirmRegenerate();
 checkCopy(h);assert.equal(h.session.id,id);assert.equal(h.session.instruction,'Use four containers instead.');
 assert.equal(h.H.checks.length,1);assert.equal(h.H.ai.length,2);assert.equal(h.H.image.length,0);unchanged(h);
});
test('live Auto label selection and unsaved image-source edits override stored metadata only in the copy',async()=>{
 const question={...sampleQuestion(),mcqLabels:'letters',answerKeyImage:'https://fixtures.test/key.png',imageSources:{
  'q:answerKeyImage':{url:'https://fixtures.test/stored-page.png',imageUrl:'https://fixtures.test/key.png',original:true}}};
 const h=regenerationHarness({question});h.mcqLabels='';h.imageSources={
  'q:answerKeyImage':{url:'https://fixtures.test/unsaved-page.png',imageUrl:question.answerKeyImage,original:true,box_2d:[100,100,900,900]}};
 const provenance=structuredClone(h.imageSources);await start(h);const q=checkCopy(h);
 assert.equal(q.mcqLabels,undefined,'Cleared Auto override is not resurrected from the stored source');
 assert.deepEqual(q.imageSources,provenance);assert.notEqual(q.imageSources,h.imageSources);unchanged(h);
});
test('cancelled checking or planning retains the unchanged copy and ignores late replies',async()=>{
 for(const phase of ['check','plan']){
  const h=regenerationHarness(),late=deferred();if(phase==='check')h.H.recheckImpl=()=>late.promise;else h.H.aiImpl=()=>late.promise;
  const pending=h.qregenStart('create','q1');await settle();const id=regeneratedCopy(h).id;
  h.tlRepairCancel();late.resolve(phase==='check'?{state:'green',findings:[]}:samplePlan(true));await pending;await settle();
  assert.equal(h.session.stage,'cancelled');assert.equal(h.session.plan,null);checkCopy(h);
  assert.equal(regeneratedCopy(h).id,id);assert.deepEqual(regeneratedCopy(h).blocks,h.original.blocks);assert.equal(h.H.image.length,0);unchanged(h);
 }
});
test('closing a pending copy checker does not reopen its plan or remove the saved duplicate',async()=>{
 const h=regenerationHarness(),late=deferred();h.H.recheckImpl=()=>late.promise;
 const pending=h.qregenStart('create','q1');await settle();const id=regeneratedCopy(h).id;h.tlRepairReset();
 late.resolve({state:'green',findings:[]});await pending;assert.equal(h.session,null);
 assert.deepEqual(h.bank.find(q=>q.id===id).blocks,h.original.blocks);assert.equal(h.H.ai.length,0);unchanged(h);
});
test('changed copied content, panel, account or owner invalidates the plan',async()=>{
 for(const mutate of [h=>{regeneratedCopy(h).blocks[0].content='Newer copy edit';},h=>{h.panelId='q1';},h=>{h.scope='create';},
  h=>{h.user={uid:'other',role:'admin'};},h=>{h.H.owner='another-bank';},h=>{h.owners[h.session.id]='another-owner';},h=>{h.practice={uid:'student'};}]){
  const h=regenerationHarness();await start(h);mutate(h);const before=structuredClone(regeneratedCopy(h));
  await h.tlRepairApply();assert.equal(h.session.stage,'error');assert.deepEqual(regeneratedCopy(h),before);
  assert.equal(h.H.saves.length,1);assert.equal(h.H.image.length,0);unchanged(h);
 }
});
test('source edits after duplication stay intact while approval saves only the independent copy',async()=>{
 const h=regenerationHarness();await start(h);h.blocks[0].content='Another unsaved source correction.';const before=structuredClone(h.blocks);
 await h.tlRepairApply();checkCopy(h,2);assert.equal(h.session.stage,'applied');assert.equal(regeneratedCopy(h).blocks[1].url,'https://fixtures.test/redrawn.png');unchanged(h,before);
});
test('copy diagram changes preserve the original editor enhancement recovery cache',async()=>{
 const h=regenerationHarness();h.enhanceState.diagram={originalUrl:'https://fixtures.test/source-original.png',enhancedUrl:h.original.blocks[1].url};
 const before=structuredClone(h.enhanceState);await start(h);await h.tlRepairApply();checkCopy(h,2);
 assert.deepEqual(h.enhanceState,before,'Copy image writes do not erase the source Use original recovery');
 await h.tlRepairUndo();checkCopy(h,3);assert.deepEqual(h.enhanceState,before);unchanged(h);
});
test('failed or cancelled image work leaves both saved copy and source unchanged',async()=>{
 for(const cancel of [false,true]){
  const h=regenerationHarness(),image=deferred();await start(h);const before=structuredClone(regeneratedCopy(h));
  h.H.imageImpl=()=>image.promise;const pending=h.tlRepairApply();await settle();
  if(cancel){h.tlRepairCancel();image.resolve('https://fixtures.test/late.png');}else image.reject(Error('Image service failed'));
  await pending;assert.equal(h.session.stage,cancel?'cancelled':'error');assert.deepEqual(regeneratedCopy(h),before);
  assert.equal(h.H.saves.length,1);assert.equal(h.H.checks.length,1);unchanged(h);
 }
});
test('an approval save failure cannot partially update the duplicate or original',async()=>{
 const h=regenerationHarness();await start(h);const before=structuredClone(regeneratedCopy(h));h.H.saveImpl=async()=>false;
 await h.tlRepairApply();assert.equal(h.session.stage,'error');assert.deepEqual(regeneratedCopy(h),before);
 assert.equal(h.H.saves.length,2);assert.equal(h.H.checks.length,1);unchanged(h);
});
test('dependent key images and notes are reviewed, saved, checked and undone only on the copy',async()=>{
 const question={...sampleQuestion(),answerKeyNote:'Original key',answerKeyImage:'https://fixtures.test/key.png',answerKeyDiagramNote:'Original labels'};
 const plan=samplePlan(true);plan.actions.push(
  {kind:'replace_text',target:'q:answerKeyNote',reason:'Match the new question.',value:'B contains more air and has greater mass.'},
  {kind:'replace_text',target:'q:answerKeyDiagramNote',reason:'Match the new diagram.',value:'Label heavier container B.'},
  {kind:'redraw_image',target:'q:answerKeyImage',reason:'Match the new question.',instruction:'Show B lower than A and label greater air mass.'});
 const h=regenerationHarness({question,plan});await start(h);assert.equal(h.H.ai[0].media.length,3);assert.equal(h.H.checks[0].answerKeyImage,question.answerKeyImage);
 let call=0;h.H.imageImpl=async()=>++call===1?'https://fixtures.test/question-new.png':'https://fixtures.test/key-new.png';
 await h.tlRepairApply();const q=checkCopy(h,2);assert.equal(q.answerKeyNote,plan.actions[2].value);
 assert.equal(q.answerKeyDiagramNote,plan.actions[3].value);assert.equal(q.answerKeyImage,'https://fixtures.test/key-new.png');
 assert.equal(h.H.saves[1].q.answerKeyImage,q.answerKeyImage);assert.equal(h.H.checks[1].answerKeyImage,q.answerKeyImage);
 assert.equal(h.document.getElementById('questionAnswerKeyImage').value,question.answerKeyImage);assert.equal(h.document.getElementById('questionAnswerKeyNote').value,question.answerKeyNote);
 await h.tlRepairUndo();const restored=checkCopy(h,3);for(const key of ['answerKeyNote','answerKeyImage','answerKeyDiagramNote'])assert.equal(restored[key],question[key]);
 assert.equal(h.H.image.length,2);unchanged(h);
});
test('a dependent key-image failure leaves copied wording, diagram and key atomic',async()=>{
 const question={...sampleQuestion(),answerKeyNote:'Old key',answerKeyImage:'https://fixtures.test/key.png'};
 const plan=samplePlan(true);plan.actions.push({kind:'redraw_image',target:'q:answerKeyImage',reason:'Match the new question.',instruction:'Draw the regenerated answer.'});
 const h=regenerationHarness({question,plan});await start(h);const before=structuredClone(regeneratedCopy(h));let call=0;
 h.H.imageImpl=async()=>{if(++call===2)throw Error('Key service failed');return 'https://fixtures.test/question-new.png';};
 await h.tlRepairApply();assert.equal(h.session.stage,'error');assert.deepEqual(regeneratedCopy(h),before);assert.equal(h.H.saves.length,1);assert.equal(h.H.checks.length,1);unchanged(h);
});
test('key crop provenance is saved on the copy and Undo restores its inherited source',async()=>{
 const question={...sampleQuestion(),answerKeyImage:'https://fixtures.test/key.png',imageSources:{
  'q:answerKeyImage':{url:'https://fixtures.test/key-original.png',imageUrl:'https://fixtures.test/key.png',original:true,box_2d:[100,100,700,800]}}};
 const plan=samplePlan();plan.actions.push({kind:'recrop_image',target:'q:answerKeyImage',reason:'Restore labels.',instruction:'Keep the complete answer diagram.'});
 const h=regenerationHarness({question,plan});await start(h);h.session.manualCrops['q:answerKeyImage']={
  dataUrl:'data:image/png;base64,Y3JvcA==',box:[100,100,800,900],source:{id:'source-1',url:'https://fixtures.test/key-original.png',original:true}};
 await h.tlRepairApply();const q=checkCopy(h,2);assert.equal(q.imageSources['q:answerKeyImage'].imageUrl,'https://fixtures.test/generated.png');
 assert.equal(q.imageSources['q:answerKeyImage'].url,'https://fixtures.test/key-original.png');assert.deepEqual(h.H.saves[1].q.imageSources,q.imageSources);
 assert.deepEqual(h.collectQuestionData().imageSources,question.imageSources,'Source Save collector retains original provenance');
 await h.tlRepairUndo();assert.deepEqual(checkCopy(h,3).imageSources,question.imageSources);unchanged(h);
});
test('missing diagrams are generated after approval and persist only on the new copy',async()=>{
 const question=sampleQuestion();question.blocks[1].url='';const plan=samplePlan();
 plan.actions.push({kind:'generate_image',target:'block:diagram:url',reason:'Provide new figure.',instruction:'Draw airtight containers A and B.'});
 const h=regenerationHarness({question,plan});await start(h);checkCopy(h);assert.equal(h.H.image.length,0);assert.equal(h.H.uploads.length,0);
 await h.tlRepairApply();assert.equal(checkCopy(h,2).blocks[1].url,'https://fixtures.test/generated.png');
 assert.equal(h.H.image[0].media.purpose,'education');assert.equal(h.H.uploads.length,1);unchanged(h);
});
test('empty, title-only, answer-only and unchanged-stem plans cannot apply unsupported regeneration',async()=>{
 const plans=[{actions:[],notes:['Unable to infer safe changes.']},...[
  {kind:'replace_text',target:'q:title',value:'Another title'},
  {kind:'replace_text',target:'block:answer:content',value:'Another answer'},
  {kind:'replace_text',target:'block:wording:content',value:'Two containers of water was placed on the balance.'},
 ].map(action=>({actions:[{...action,reason:'Suggested variation.'}],notes:[]}))];
 for(const plan of plans){
  const h=regenerationHarness({plan});await start(h);const before=structuredClone(checkCopy(h));
  assert.equal(h.document.getElementById('tlRepairApplyBtn').disabled,true);await h.tlRepairApply();
  assert.deepEqual(regeneratedCopy(h),before);assert.equal(h.H.saves.length,1);assert.equal(h.H.image.length,0);unchanged(h);
 }
});
test('follow-up findings require a separately approved repair of the same copy',async()=>{
 const h=regenerationHarness();await start(h);const id=regeneratedCopy(h).id;
 h.H.recheckResult={state:'amber',findings:[sampleFindings()[0]]};h.H.aiReply={actions:[{...samplePlan(true).actions[1],instruction:'Correct the copied balance height.'}],notes:[]};
 await h.tlRepairApply();checkCopy(h,2);assert.equal(h.session.id,id);assert.equal(h.session.stage,'ready');assert.notEqual(h.session.mode,'regeneration');
 assert.equal(h.H.ai.length,2);assert.equal(h.H.image.length,1);assert.ok(h.session.undo);assert.match(h.session.message,/approve.*(?:new|repair).*plan/);unchanged(h);
});
test('late follow-up after Undo cannot revive a repair plan for the restored copy',async()=>{
 const h=regenerationHarness(),late=deferred();await start(h);const wording=h.session.plan.actions[0].value;
 h.H.recheckImpl=async q=>q.blocks[0].content===wording?late.promise:{state:'red',findings:sampleFindings()};
 const apply=h.tlRepairApply();await settle();assert.equal(h.session.stage,'applied');await h.tlRepairUndo();checkCopy(h,3);const message=h.session.message;
 late.resolve({state:'red',findings:sampleFindings()});await apply;await settle();assert.equal(h.H.ai.length,1);
 assert.equal(h.session.stage,'applied');assert.equal(h.session.plan,null);assert.equal(h.session.undo,null);assert.equal(h.session.message,message);
 assert.deepEqual(regeneratedCopy(h).blocks,h.original.blocks);unchanged(h);
});
test('only authoring editors can allocate a regeneration duplicate',async()=>{
 for(const mutate of [h=>{h.user={uid:'student',role:'student'};},h=>{h.H.createActive=false;},h=>{h.sourceScope='bank';},h=>{h.sourceScope='vet';}]){
  const h=regenerationHarness();mutate(h);await start(h);
  assert.deepEqual([h.H.saves.length,h.H.checks.length,h.H.ai.length,h.H.image.length],[0,0,0,0]);assert.equal(h.bank.length,1);unchanged(h);
 }
});
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let failed=0;for(const item of cases){try{await item.run();console.log('PASS',item.name);}catch(error){failed++;console.error('FAIL',item.name,error.stack);}}
 console.log(cases.length-failed+' passed, '+failed+' failed');if(failed)process.exitCode=1;
}
