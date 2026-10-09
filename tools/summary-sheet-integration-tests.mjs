// Real summary-sheet controller plus the shipped app's persistence/AI adapters.
// Source bank, storage and model replies are deterministic; no live account calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installSummarySheets } from '../summary-sheets.js';
import { questionRepairTargets } from '../question-repair-core.mjs';
import { createSummaryCard } from '../summary-sheet-core.mjs';
import { mcqLabelSrc } from './mcq-labels-src.mjs';
import { sampleQuestions, teacher, sourceContext, fixtureImage, deferred, settle } from './summary-sheet-fixtures.mjs';

const proposal = {shortQuestion:'Why did the water cool?',shortAnswer:'Water loses heat to cooler surroundings.',howTo:'State the direction of heat transfer.',note:'Check the recorded answer.'};
function harness() {
  const h={user:teacher(),authUid:'teacher-1',author:true,bank:sampleQuestions(),ai:[],loads:[],saves:[],deletes:[],prints:[],messages:[],stored:new Map()};
  const adapter={
    getUser:()=>h.user,getAuthUid:()=>h.authUid,canAuthor:()=>h.author,getBank:()=>h.bank,
    isQuestionEligible:q=>!q.excluded,questionTopics:q=>[q.topic,q.topic2].filter(Boolean),sourceContext,
    askAI:async request=>{h.ai.push(structuredClone(request));return h.aiImpl?h.aiImpl(request):structuredClone(proposal);},
    loadSheets:async uid=>{h.loads.push(uid);return h.loadImpl?h.loadImpl(uid):structuredClone(h.stored.get(uid)||[]);},
    saveSheet:async (sheet,context)=>{h.saves.push({sheet:structuredClone(sheet),context});if(h.saveImpl)return h.saveImpl(sheet,context);if(!context.guard())return false;h.stored.set(context.uid,[structuredClone(sheet)]);return true;},
    deleteSheet:async (id,context)=>{h.deletes.push({id,context});if(h.deleteImpl)return h.deleteImpl(id,context);h.stored.set(context.uid,(h.stored.get(context.uid)||[]).filter(s=>s.id!==id));return context.guard();},
    printSheet:request=>{h.prints.push(structuredClone(request));return true;},notify:(text,kind)=>h.messages.push({text,kind}),
  };
  h.tool=installSummarySheets(adapter);h.tool.newSheet('Heat revision');
  h.cards=()=>h.tool.state().draft.summaryCards;
  h.account=uid=>{h.user={...teacher(),uid};h.authUid=uid;h.tool.resetForUser(uid);};
  return h;
}
test('manual collection retains selected order, deduplicates and leaves every bank question untouched',()=>{
  const h=harness(),before=structuredClone(h.bank);h.bank.push({...sampleQuestions()[2],id:'excluded',excluded:true});before.push(structuredClone(h.bank.at(-1)));
  assert.equal(h.tool.addQuestions(['light-1','heat-1','light-1','excluded','missing']),true);
  assert.deepEqual(h.cards().map(c=>c.questionId),['light-1','heat-1']);
  h.tool.addQuestions(['heat-1']);assert.equal(h.cards().length,2);
  assert.deepEqual(h.bank,before);assert.equal(h.ai.length,0);assert.equal(h.saves.length,0);
});
test('topic collection includes the source second topic and never auto-selects unrelated questions',()=>{
  const h=harness();h.tool.filter('Matter');assert.equal(h.tool.addTopic(),true);assert.deepEqual(h.cards().map(c=>c.questionId),['heat-1']);
  h.tool.addTopic('Heat');assert.deepEqual(h.cards().map(c=>c.questionId),['heat-1','heat-2']);
});
test('teacher edits, card order and source snapshots survive saving and reopening',async()=>{
  const h=harness(),before=structuredClone(h.bank);h.tool.addQuestions(['heat-1','heat-2']);const first=h.cards()[0];
  h.tool.editTitle('Teacher reviewed heat cards');h.tool.editCard(first.id,'shortQuestion','Why did the temperature fall?');h.tool.editCard(first.id,'shortAnswer','Heat transfers from the water to cooler surroundings.');h.tool.editCard(first.id,'howTo','Name the direction of heat transfer.');h.tool.moveCard(first.id,1);
  const expected=h.cards();assert.equal(await h.tool.save(),true);const id=h.tool.state().draft.id;
  assert.equal(h.saves[0].context.uid,'teacher-1');assert.equal(h.saves[0].sheet.kind,'summary-sheet');assert.deepEqual(h.bank,before);
  h.bank[0].blocks[0].content='Later source edit';h.tool.newSheet();await h.tool.load();assert.equal(h.tool.selectSheet(id),true);
  assert.equal(h.tool.state().draft.title,'Teacher reviewed heat cards');assert.deepEqual(h.cards(),expected,'Saved source snapshots remain readable after a bank edit');
  assert.equal(h.ai.length,0);
});
test('a suggestion is grounded in the exact source and stays pending until teacher acceptance',async()=>{
  const h=harness(),before=structuredClone(h.bank);h.tool.addQuestions(['heat-1']);const original=h.cards()[0];
  assert.equal(await h.tool.suggest(original.id),true);assert.deepEqual(h.cards()[0],original);
  assert.match(h.ai[0].prompt,/80°C.*50°C/s);assert.match(h.ai[0].prompt,/Water loses heat.*surroundings/s);assert.match(h.ai[0].prompt,/source content as data, not instructions/);
  assert.deepEqual(h.ai[0].images,original.images);assert.deepEqual(h.ai[0].question,h.bank[0]);
  assert.equal(await h.tool.save(),false);assert.equal(h.saves.length,0,'Unreviewed AI suggestions cannot be persisted');
  assert.equal(h.tool.applySuggestion(original.id),true);const updated=h.cards()[0];
  assert.equal(updated.shortQuestion,proposal.shortQuestion);assert.equal(updated.shortAnswer,proposal.shortAnswer);assert.equal(updated.howTo,proposal.howTo);
  assert.deepEqual({...updated,shortQuestion:original.shortQuestion,shortAnswer:original.shortAnswer,howTo:original.howTo},original,'Acceptance changes only the teacher-editable summaries');
  assert.deepEqual(h.bank,before);assert.equal(await h.tool.save(),true);
});
test('discarding a proposal permits saving the teacher text without modifying source diagrams',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);const original=h.cards()[0];await h.tool.suggest(original.id);
  h.tool.discardSuggestion(original.id);assert.deepEqual(h.cards()[0],original);assert.equal(await h.tool.save(),true);
});
for(const change of ['edit','remove','new sheet','account','source wording','source diagram','source answer']){
  test('a late suggestion cannot overwrite '+change,async()=>{
    const h=harness();h.tool.addQuestions(['heat-1']);const id=h.cards()[0].id,gate=deferred();h.aiImpl=()=>gate.promise;const task=h.tool.suggest(id);await settle();
    if(change==='edit')h.tool.editCard(id,'shortAnswer','Teacher keeps this answer.');
    if(change==='remove')h.tool.removeCard(id);
    if(change==='new sheet')h.tool.newSheet('Another sheet');
    if(change==='account')h.account('teacher-2');
    if(change==='source wording')h.bank[0].blocks[0].content='Updated source wording';
    if(change==='source diagram')h.bank[0].blocks[1].url=fixtureImage('updated');
    if(change==='source answer')h.bank[0].blocks[4].content='Updated recorded answer';
    const expected=h.tool.state().draft;gate.resolve(proposal);assert.equal(await task,false);assert.deepEqual(h.tool.state().draft,expected);assert.deepEqual(h.tool.state().pendingSuggestions,{});
  });
}
test('a changed source rejects a ready proposal as well as a new AI request',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);const original=h.cards()[0];await h.tool.suggest(original.id);
  h.bank[0].blocks[1].url=fixtureImage('new');assert.equal(h.tool.applySuggestion(original.id),false);assert.equal(await h.tool.suggest(original.id),false);
  assert.deepEqual(h.cards()[0],original);assert.equal(h.ai.length,1);
});
for(const outcome of ['failure','malformed','missing answer']){
  test('AI '+outcome+' preserves the existing card and original pictures',async()=>{
    const h=harness();h.tool.addQuestions(['heat-1']);const before=h.cards();h.aiImpl=()=>{if(outcome==='failure')throw Error('Model unavailable');return outcome==='malformed'?'not JSON':{shortQuestion:'Why?'};};
    assert.equal(await h.tool.suggest(before[0].id),false);assert.deepEqual(h.cards(),before);assert.deepEqual(h.tool.state().pendingSuggestions,{});assert.equal(h.saves.length,0);
  });
}
test('an AI request is single flight for a card and an unresolved reply blocks saving',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);const id=h.cards()[0].id,gate=deferred();h.aiImpl=()=>gate.promise;
  const task=h.tool.suggest(id);assert.equal(await h.tool.suggest(id),false);assert.equal(await h.tool.save(),false);assert.equal(h.ai.length,1);assert.equal(h.saves.length,0);gate.resolve(proposal);await task;
});
test('awaited saving prevents duplicate writes and reports success only after storage finishes',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);const gate=deferred();h.saveImpl=()=>gate.promise;const task=h.tool.save();
  assert.equal(h.tool.state().saving,true);assert.equal(h.tool.state().sheets.length,0);assert.equal(await h.tool.save(),false);assert.equal(h.saves.length,1);
  gate.resolve(true);assert.equal(await task,true);assert.equal(h.tool.state().sheets.length,1);assert.equal(h.tool.state().dirty,false);
  h.tool.editCard(h.cards()[0].id,'shortAnswer','Reviewed again.');h.saveImpl=undefined;await h.tool.save();assert.equal(h.saves[1].sheet.id,h.saves[0].sheet.id);
});
test('failed save retains the complete draft and retry uses the same sheet identity',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);const original=h.tool.state().draft;h.saveImpl=()=>false;
  assert.equal(await h.tool.save(),false);assert.deepEqual(h.tool.state().draft,original);assert.equal(h.tool.state().dirty,true);assert.equal(h.tool.state().sheets.length,0);
  h.saveImpl=undefined;assert.equal(await h.tool.save(),true);assert.equal(h.saves[0].sheet.id,h.saves[1].sheet.id);
});
test('account changes invalidate a pending save and cannot publish old cards in the new account',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);const gate=deferred();h.saveImpl=()=>gate.promise;const task=h.tool.save();const context=h.saves[0].context;
  h.account('teacher-2');h.tool.newSheet('Second account');h.tool.addQuestions(['light-1']);const expected=h.tool.state().draft;
  assert.equal(context.uid,'teacher-1');assert.equal(context.guard(),false);gate.resolve(true);assert.equal(await task,false);assert.deepEqual(h.tool.state().draft,expected);assert.deepEqual(h.tool.state().sheets,[]);
});
test('late library loads cannot leak a previous account or replace a newer refresh',async()=>{
  const h=harness(),old=deferred(),newer=deferred();let n=0;h.loadImpl=()=>++n===1?old.promise:newer.promise;
  const first=h.tool.load();const second=h.tool.load();newer.resolve([]);assert.equal(await second,true);old.resolve([{id:'old',kind:'summary-sheet',title:'Old',summaryCards:[]}]);assert.equal(await first,false);assert.deepEqual(h.tool.state().sheets,[]);
  const late=deferred();h.loadImpl=()=>late.promise;const pending=h.tool.load();h.account('teacher-2');late.resolve([{id:'private',kind:'summary-sheet',title:'Previous teacher',summaryCards:[]}]);assert.equal(await pending,false);assert.deepEqual(h.tool.state().sheets,[]);
});
test('presentation and printing use reviewed snapshots without AI, saving or source mutations',()=>{
  const h=harness(),before=structuredClone(h.bank);h.tool.addQuestions(['heat-1','light-1']);h.tool.editCard(h.cards()[0].id,'shortQuestion','Teacher short question');const snapshot=h.tool.state().draft;
  assert.equal(h.tool.present(),true);assert.equal(h.tool.state().presenting,true);assert.equal(h.tool.print(),true);h.tool.closePresent();assert.equal(h.tool.state().presenting,false);
  assert.deepEqual(h.tool.state().draft,snapshot);assert.deepEqual(h.bank,before);assert.equal(h.ai.length,0);assert.equal(h.saves.length,0);
  assert.match(h.prints[0].html,/Teacher short question/);assert.ok(h.prints[0].html.includes(fixtureImage('apparatus')));assert.ok(h.prints[0].html.includes(fixtureImage('tall-shadow')));assert.ok(!h.prints[0].html.includes(fixtureImage('key-only')));
});
test('students and mismatched authenticated accounts cannot author, generate, save or print',async()=>{
  for(const mismatch of ['student','auth']){const h=harness();if(mismatch==='student')h.author=false;else h.authUid='another-account';
    assert.equal(h.tool.newSheet(),false);assert.equal(h.tool.addQuestions(['heat-1']),false);assert.equal(await h.tool.suggest('missing'),false);assert.equal(await h.tool.save(),false);assert.equal(h.tool.present(),false);assert.equal(h.tool.print(),false);assert.equal(await h.tool.load(),false);
    assert.deepEqual([h.ai.length,h.saves.length,h.prints.length,h.loads.length],[0,0,0,0]);
  }
});
test('blank or unreviewed answers and pending AI cannot be shown to students or printed',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);const id=h.cards()[0].id;
  h.tool.editCard(id,'shortAnswer','');assert.equal(h.tool.present(),false);assert.equal(h.tool.print(),false);
  h.tool.editCard(id,'shortAnswer','Reviewed answer');await h.tool.suggest(id);assert.equal(h.tool.present(),false);assert.equal(h.tool.print(),false);assert.equal(h.prints.length,0);
  h.tool.discardSuggestion(id);assert.equal(h.tool.present(),true);assert.equal(h.tool.print(),true);
});
test('batch AI prepares a bounded sequence of pending reviews without changing live cards',async()=>{
  const h=harness();h.bank=Array.from({length:26},(_,i)=>({...sampleQuestions()[2],id:'source-'+i,title:'Source '+i}));h.tool.addQuestions(h.bank.map(q=>q.id));
  const original=h.cards();let active=0,maxActive=0;h.aiImpl=async()=>{active++;maxActive=Math.max(active,maxActive);await settle();active--;return proposal;};
  assert.equal(await h.tool.suggestAll(),true);assert.equal(h.ai.length,24);assert.equal(maxActive,1,'Batch requests remain sequential');assert.equal(Object.keys(h.tool.state().pendingSuggestions).length,24);assert.deepEqual(h.cards(),original);assert.equal(h.saves.length,0);
  assert.equal(await h.tool.suggestAll(),true);assert.equal(h.ai.length,26,'Next batch prepares the remaining cards without repeating ready proposals');assert.equal(Object.keys(h.tool.state().pendingSuggestions).length,26);
});
test('stopping batch AI rejects its current late reply and does not begin the next card',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1','heat-2']);const gate=deferred(),before=h.cards();h.aiImpl=()=>gate.promise;const task=h.tool.suggestAll();await settle();
  assert.equal(h.ai.length,1);h.tool.stopSuggestions();gate.resolve(proposal);assert.equal(await task,false);assert.deepEqual(h.tool.state().pendingSuggestions,{});assert.deepEqual(h.cards(),before);assert.equal(h.ai.length,1);
});
test('deletion failures and late account changes retain the current library',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);await h.tool.save();const saved=h.tool.state().sheets,id=saved[0].id;
  h.deleteImpl=()=>false;assert.equal(await h.tool.removeSheet(id),false);assert.deepEqual(h.tool.state().sheets,saved);
  const gate=deferred();h.deleteImpl=()=>gate.promise;const task=h.tool.removeSheet(id);const context=h.deletes.at(-1).context;h.account('teacher-2');assert.equal(context.guard(),false);gate.resolve(true);assert.equal(await task,false);assert.deepEqual(h.tool.state().sheets,[]);
});
test('an older library refresh cannot erase a newly saved sheet',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);const gate=deferred();h.loadImpl=()=>gate.promise;const loading=h.tool.load();
  assert.equal(await h.tool.save(),true);const saved=h.tool.state().sheets;gate.resolve([]);assert.equal(await loading,false);assert.deepEqual(h.tool.state().sheets,saved);
});
test('an older library refresh cannot resurrect a deleted sheet',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);await h.tool.save();const saved=h.tool.state().sheets,gate=deferred();h.loadImpl=()=>gate.promise;const loading=h.tool.load();
  assert.equal(await h.tool.removeSheet(saved[0].id),true);gate.resolve(saved);assert.equal(await loading,false);assert.deepEqual(h.tool.state().sheets,[]);
});
test('answer-only AI uses the teacher current short question and changes only the reviewed answer',async()=>{
  const h=harness(),bank=structuredClone(h.bank);h.tool.addQuestions(['heat-1']);const id=h.cards()[0].id;
  h.tool.editCard(id,'shortQuestion','Why does felt keep Cup A hot longer than Cup B?');h.tool.editCard(id,'shortAnswer','Teacher answer awaiting preparation.');h.tool.editCard(id,'howTo','Teacher reminder stays.');
  const before=h.cards()[0];h.aiImpl=()=>({shortAnswer:'Felt is a poor conductor, so Cup A loses heat more slowly.',shortQuestion:'Model must not replace the question',howTo:'Model must not replace the reminder',images:[{url:fixtureImage('invented')}],questionId:'invented'});
  assert.equal(await h.tool.suggestAnswer(id),true);assert.deepEqual(h.cards()[0],before,'Answer is proposed for review before mutation');
  assert.equal(h.ai[0].mode,'answer');assert.equal(h.ai[0].questionText,before.shortQuestion);assert.ok(h.ai[0].prompt.includes(before.shortQuestion));assert.deepEqual(h.ai[0].images,before.images);
  assert.equal(await h.tool.save(),false);assert.equal(h.tool.print(),false);assert.equal(h.tool.present(),false);assert.equal(h.saves.length,0);
  assert.equal(h.tool.applySuggestion(id),true);const after=h.cards()[0];assert.equal(after.shortAnswer,'Felt is a poor conductor, so Cup A loses heat more slowly.');
  assert.deepEqual({...after,shortAnswer:before.shortAnswer},before,'All question, strategy, source, identity and image fields stay unchanged');assert.deepEqual(h.bank,bank);
  assert.equal(await h.tool.save(),true);assert.deepEqual(h.saves[0].sheet.summaryCards[0],after);
});
test('a blank current question blocks answer preparation without a model call',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);const id=h.cards()[0].id;h.tool.editCard(id,'shortQuestion','   ');
  assert.equal(await h.tool.suggestAnswer(id),false);assert.equal(h.ai.length,0);assert.deepEqual(h.tool.state().pendingSuggestions,{});
});
for(const change of ['shortQuestion','shortAnswer','howTo','account','new sheet','source']){
  test('late answer-only AI rejects '+change+' changes without overwriting the current draft',async()=>{
    const h=harness();h.tool.addQuestions(['heat-1']);const id=h.cards()[0].id,gate=deferred();h.aiImpl=()=>gate.promise;
    const task=h.tool.suggestAnswer(id);await settle();assert.equal(h.ai.length,1);
    if(['shortQuestion','shortAnswer','howTo'].includes(change))h.tool.editCard(id,change,'Teacher typed newer '+change);
    if(change==='account')h.account('teacher-2');if(change==='new sheet')h.tool.newSheet('New teacher sheet');if(change==='source')h.bank[0].blocks[0].content='New source';
    const draft=h.tool.state().draft;gate.resolve({shortAnswer:'Late model answer'});assert.equal(await task,false);assert.deepEqual(h.tool.state().draft,draft);assert.deepEqual(h.tool.state().pendingSuggestions,{});
  });
}
test('answer-only failure, malformed and empty answers preserve teacher text and support discard',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);const before=h.cards()[0];
  for(const response of ['invalid JSON',{shortAnswer:''}]){h.aiImpl=()=>response;assert.equal(await h.tool.suggestAnswer(before.id),false);assert.deepEqual(h.cards()[0],before);}
  h.aiImpl=()=>{throw Error('Model unavailable');};assert.equal(await h.tool.suggestAnswer(before.id),false);assert.deepEqual(h.cards()[0],before);
  h.aiImpl=()=>({shortAnswer:'Proposed answer'});await h.tool.suggestAnswer(before.id);h.tool.discardSuggestion(before.id);assert.deepEqual(h.cards()[0],before);assert.equal(await h.tool.save(),true);
});
test('answer preparation shares the per-card request guard with whole-card preparation',async()=>{
  const h=harness();h.tool.addQuestions(['heat-1']);const id=h.cards()[0].id,gate=deferred();h.aiImpl=()=>gate.promise;
  const task=h.tool.suggestAnswer(id);assert.equal(await h.tool.suggestAnswer(id),false);assert.equal(await h.tool.suggest(id),false);assert.equal(h.ai.length,1);gate.resolve({shortAnswer:'Prepared answer'});await task;
});

// Invoke the current app adapters, rather than duplicating their routing rules.
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
function cut(from,to){const a=app.indexOf(from),b=app.indexOf(to,a+from.length);assert.ok(a>=0&&b>a,'App section '+from+' exists');return app.slice(a,b);}
function appHarness(){
  return new Function('questionRepairTargets','deps',`
    let currentUser={uid:'teacher-1',name:'Teacher',role:'admin'},adminUid='',savedWorksheets=[],_notesWatching='teacher-1',_notesLoaded=true;
    const auth={currentUser:{uid:'teacher-1'}},db={},window={__aiReady:()=>true},H={author:true,documents:[],writes:[],deletes:[],downloads:[],models:[],grounding:'TEACHER ANSWER GUIDANCE',groundingCalls:[],notesLoads:0,notesStops:0,notesListener:false,order:[],fetchImpl:null,readImpl:null,notesImpl:null,notesUnavailable:false};
    const _isEmployee=()=>currentUser.role==='employee',stopTeachingNotes=()=>{_notesWatching='';_notesLoaded=false;H.notesListener=false;H.notesStops++;H.order.push('notes:stop');};
    const _canAuthor=()=>H.author,collection=(...path)=>path.slice(1),doc=(...path)=>path.slice(1),_wsCol=()=>collection(db,'users',currentUser.uid,'worksheets');
    const getDocs=async ref=>H.readImpl?H.readImpl(ref):{forEach:fn=>H.documents.forEach(d=>fn({id:d.id,data:()=>d.value}))};
    const setDoc=async (ref,value)=>{H.writes.push({ref,value});if(H.writeImpl)await H.writeImpl();};const deleteDoc=async ref=>{H.deletes.push(ref);};
    const _wsNormalise=(value,id)=>({id,...value}),stripHtml=v=>String(v||'').replace(/<[^>]*>/g,' ').replace(/\\s+/g,' ').trim(),normalizeCategoryValue=v=>v;
    const _docClip=(v,n)=>v.slice(0,n),getTopicLevel=()=>'',isSecondaryLevel=()=>false;
    const escapeHtml=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const transformImageUrl=v=>v,aiGrounding=(kind,topic,questionText)=>{H.order.push('ground');H.groundingCalls.push({kind,topic,questionText});return H.grounding;},_parseAIJson=v=>typeof v==='string'?JSON.parse(v):v;
    const loadTeachingNotes=async()=>{
      const notesOwner=_isEmployee()?currentUser.adminUid:currentUser.uid;
      // The real loader retains its failed listener. Another attempt takes
      // this early return until the caller retires that matching notebook.
      if(H.notesListener&&_notesWatching===notesOwner){H.order.push('notes:cached');return;}
      H.notesLoads++;H.notesListener=true;_notesWatching=notesOwner;H.order.push('notes:start');
      if(H.notesImpl)await H.notesImpl();if(_notesWatching!==notesOwner)return;
      _notesLoaded=!H.notesUnavailable;H.order.push('notes:ready');
    };
    const _parseImageDataUrl=v=>v.startsWith('data:image/png;base64,')?{mime:'image/png'}:null;
    const _urlToDataUrlRobust=async url=>{H.downloads.push(url);return H.fetchImpl?H.fetchImpl(url):'data:image/png;base64,c291cmNl';};
    const askGemini=async (prompt,opts)=>{H.order.push('model');H.models.push({prompt,opts,media:[]});return deps.proposal;};
    const askGeminiVision=async (prompt,media,opts)=>{H.order.push('model');H.models.push({prompt,media,opts});return deps.proposal;};
    ${mcqLabelSrc(app,{display:false})}
    ${cut('const QPART_ASSIGN =','// The part each block belongs to')}
    ${cut('function qPartMap(blocks) {','// A question written flat')}
    ${cut('function qBlockOpensPart(b) {','// (qBlockOpensSub')}
    ${cut('function qPartOf(map, block) {','// Which part a block OPENS')}
    ${cut('function _fbParse(text) {','// EVERY BLANK IS ONE STANDARD LENGTH')}
    ${cut('function _fbAnswerKeyText(block) {','// ---- editor: clickable word chips')}
    ${cut('function _pushAnnotAnswerKey','// How many ruled lines a printed answer box gets')}
    ${cut('function akcKeySections(q) {','// The MCQ block, if this question is one.')}
    ${cut('function _cqTableRows(b) {','function _cqTableCells(')}
    ${cut('function _gradingQuestionSource(q) {','const GRADING_SOURCE_IMAGE_MAX')}
    ${cut('function _akdAnswerText(q, note) {','// The question\'s own figure')}
    ${cut('function _serializeQuestionForRegen(q) {','function _regenPrompt(')}
    ${cut('function ssOwnerCurrent(uid) {','function ssPrintSheet(')}
    ${cut('async function loadSavedWorksheets() {','function renderSavedWorksheets(')}
    return {H,auth,context:ssSourceContext,ask:ssAskAI,load:ssLoadSheets,save:ssSaveSheet,remove:ssDeleteSheet,loadLegacy:loadSavedWorksheets,
      account(uid){currentUser={uid,role:'admin'};auth.currentUser={uid};},employee(owner){currentUser.role='employee';currentUser.adminUid=owner;adminUid=owner;},notesOwner(value){_notesWatching=value;},notes:()=>({owner:_notesWatching,loaded:_notesLoaded}),legacy:()=>savedWorksheets};
  `)(questionRepairTargets,{proposal});
}
test('shipped source adapter includes question table and option images, separates answers, and preserves full source context',()=>{
  const h=appHarness(),q=sampleQuestions()[0],before=structuredClone(q),context=h.context(q),card=createSummaryCard(q,context,'real-adapter');
  assert.match(context.text,/80°C.*50°C/s);assert.match(context.text,/TABLE:/);assert.match(context.text,/Time \/ min/);assert.match(context.text,/Heat moves to the surroundings/);assert.doesNotMatch(context.text,/The temperature decreases because|Water loses heat/);
  assert.match(context.answer,/Water loses heat/);assert.match(context.fullContext,/answerKeyNote/);assert.match(context.fullContext,/50/);
  assert.deepEqual(card.images.map(i=>i.url),[fixtureImage('apparatus'),fixtureImage('table-figure'),fixtureImage('option-a'),fixtureImage('option-b')]);
  assert.ok(context.answerImages.some(i=>i.url===fixtureImage('key-only')));assert.ok(context.answerImages.some(i=>i.url===fixtureImage('annotated-answer')));assert.deepEqual(q,before);
});
test('shipped source adapter preserves lettered MCQ labels in image roles and recorded answers',()=>{
  const h=appHarness(),q=sampleQuestions()[0];q.mcqLabels='letters';const context=h.context(q),card=createSummaryCard(q,context,'lettered');
  assert.match(context.text,/A\).*Heat moves/);assert.match(context.answer,/A\.\s+Heat moves/);assert.match(card.images.find(i=>i.url===fixtureImage('option-a')).label,/Choice A/);assert.match(card.images.find(i=>i.url===fixtureImage('option-b')).label,/Choice B/);
});
test('shipped source adapter retains fillblank, annotation and multipart answers from the shared answer-key readers',()=>{
  const h=appHarness(),q={id:'all-answers',title:'Heat and light',topic:'Heat',answerKeyNote:'Use complete scientific terms.',blocks:[
    {id:'part-a',type:'text',part:'a',content:'(a) Name the process in which a liquid changes to a gas.'},
    {id:'blank',type:'fillblank',text:'A liquid changes to a gas by [[evaporation]].'},
    {id:'part-b',type:'text',part:'b',content:'(b) Draw an arrow showing the direction of heat transfer.'},
    {id:'annotated',type:'image',url:fixtureImage('apparatus'),answerKey:'Arrow from the warmer cup towards the cooler surroundings.',annotate:true,dgnLabel:'Cup'},
    {id:'working',type:'workingSpace',annotate:true,answerKey:'Heat flows from hotter to cooler places.'},
  ]},before=structuredClone(q),context=h.context(q),card=createSummaryCard(q,context,'mixed');
  assert.match(context.text,/____/);assert.doesNotMatch(context.text,/\[\[evaporation\]\]/);assert.match(context.answer,/Use complete scientific terms/);assert.match(context.answer,/\(a\).*Fill in the blanks.*evaporation/s);assert.match(context.answer,/\(b\).*Arrow from the warmer cup/s);assert.match(context.answer,/Heat flows from hotter to cooler places/);assert.equal(card.sourceAnswer,context.answer);assert.deepEqual(q,before);
});
test('shipped private library filters summary sheets and the legacy worksheet loader filters them out',async()=>{
  const h=appHarness();h.H.documents=[{id:'revision',value:{kind:'summary-sheet',title:'Heat',summaryCards:[]}},{id:'worksheet',value:{name:'Practice',questionIds:['heat-1']}}];
  assert.deepEqual((await h.load('teacher-1')).map(s=>s.id),['revision']);await h.loadLegacy();assert.deepEqual(h.legacy().map(s=>s.id),['worksheet']);
  const late=deferred();h.H.readImpl=()=>late.promise;const pending=h.load('teacher-1');h.account('teacher-2');late.resolve({forEach:fn=>fn({id:'revision',data:()=>h.H.documents[0].value})});assert.deepEqual(await pending,[]);
});
test('shipped writes capture the requested owner and honor account and revision guards',async()=>{
  const h=appHarness(),payload={id:'sheet-1',kind:'summary-sheet'};
  assert.equal(await h.save(payload,{uid:'teacher-1',guard:()=>false}),false);assert.equal(h.H.writes.length,0);
  assert.equal(await h.save(payload,{uid:'teacher-1',guard:()=>true}),true);assert.deepEqual(h.H.writes[0].ref,['users','teacher-1','worksheets','sheet-1']);
  h.account('teacher-2');assert.equal(await h.save(payload,{uid:'teacher-1',guard:()=>true}),false);assert.equal(await h.remove('sheet-1',{uid:'teacher-1',guard:()=>true}),false);assert.equal(h.H.writes.length,1);
});
test('shipped summary AI uses authoring, answer teaching notes and every provided source picture',async()=>{
  const h=appHarness(),q=sampleQuestions()[0],context=h.context(q);await h.ask({prompt:'Shorten the recorded source',images:[...context.images,...context.answerImages],question:q});
  assert.equal(h.H.models.length,1);assert.equal(h.H.models[0].opts.authoring,true);assert.equal(h.H.models[0].opts.json,true);assert.match(h.H.models[0].prompt,/TEACHER ANSWER GUIDANCE/);assert.match(h.H.models[0].prompt,/COMPLETE SOURCE AND ANSWER FIELDS/);assert.ok(h.H.models[0].media.length===h.H.downloads.length&&h.H.downloads.length>=4);
  h.H.author=false;await assert.rejects(()=>h.ask({prompt:'test',images:[],question:q}),/teacher/);assert.equal(h.H.models.length,1);
});
test('shipped summary AI stops if a picture fails, the account switches during reading, or too many figures would be skipped',async()=>{
  for(const condition of ['picture','account','too many']){const h=appHarness(),q=sampleQuestions()[0],gate=deferred();let images=[{url:fixtureImage('apparatus')}];
    if(condition==='picture')h.H.fetchImpl=()=>'';
    if(condition==='account'){h.H.fetchImpl=()=>gate.promise;}
    if(condition==='too many')images=Array.from({length:13},(_,i)=>({url:fixtureImage('figure-'+i)}));
    const task=h.ask({prompt:'test',images,question:q});if(condition==='account'){h.account('teacher-2');gate.resolve('data:image/png;base64,c291cmNl');}
    await assert.rejects(()=>task);assert.equal(h.H.models.length,0);
  }
});
test('shipped answer preparation awaits teaching notes before grounding with the current question',async()=>{
  const h=appHarness(),gate=deferred(),question=sampleQuestions()[0],questionText='Why does felt keep Cup A hot longer?';h.H.notesImpl=async()=>{await gate.promise;h.H.grounding='LATEST TEACHER INSULATION NOTES';};
  const task=h.ask({prompt:'Prepare the answer for '+questionText,images:[],question,mode:'answer',questionText});await settle();
  assert.equal(h.H.notesLoads,1);assert.equal(h.H.models.length,0);assert.equal(h.H.groundingCalls.length,0,'Grounding waits for the notes load');
  gate.resolve();await task;assert.deepEqual(h.H.order,['notes:start','notes:ready','ground','model']);
  assert.deepEqual(h.H.groundingCalls[0],{kind:'answer',topic:question.topic,questionText});assert.match(h.H.models[0].prompt,/LATEST TEACHER INSULATION NOTES/);assert.ok(h.H.models[0].prompt.includes(questionText));assert.equal(h.H.models[0].opts.authoring,true);
  assert.ok(h.H.models[0].prompt.endsWith(questionText),'Current edited question is the final authoritative model instruction');
});
test('an account change or teaching-notes failure stops answer preparation before grounding and AI',async()=>{
  for(const change of ['account','failure']){const h=appHarness(),gate=deferred();h.H.notesImpl=()=>gate.promise;
    const task=h.ask({prompt:'Prepare an answer',images:[],question:sampleQuestions()[0],mode:'answer',questionText:'Current teacher question'});await settle();
    if(change==='account'){h.account('teacher-2');gate.resolve();}else gate.reject(Error('Teacher notes unavailable'));
    await assert.rejects(()=>task);assert.equal(h.H.models.length,0);assert.equal(h.H.groundingCalls.length,0);
  }
});
test('an unreadable teaching notebook prevents answer AI and an old owner notebook is cleared before reload',async()=>{
  const q=sampleQuestions()[0],request={prompt:'Prepare an answer',images:[],question:q,mode:'answer',questionText:'Teacher current question'};
  const h=appHarness();h.H.notesUnavailable=true;await assert.rejects(()=>h.ask(request));assert.equal(h.H.models.length,0);assert.equal(h.H.groundingCalls.length,0);
  assert.equal(h.H.notesStops,1,'The matching failed listener is retired so another click can reload it');assert.equal(h.H.notesListener,false);assert.equal(h.notes().owner,'');
  h.H.notesUnavailable=false;await h.ask(request);assert.equal(h.H.notesLoads,2,'Retry starts a fresh teaching-notes load');assert.equal(h.H.models.length,1);assert.equal(h.H.groundingCalls.length,1);assert.equal(h.notes().owner,'teacher-1');
  const fresh=appHarness();fresh.notesOwner('previous-teacher');await fresh.ask(request);assert.deepEqual(fresh.H.order,['notes:stop','notes:start','notes:ready','ground','model']);
});
test('failed old preparation cannot clear a newer notebook or an account that changed during loading',async()=>{
  for(const change of ['notebook','account']){const h=appHarness(),gate=deferred();h.H.notesImpl=()=>gate.promise;h.H.notesUnavailable=true;
    const task=h.ask({prompt:'Prepare answer',images:[],question:sampleQuestions()[0],mode:'answer',questionText:'Teacher current question'});await settle();
    if(change==='account')h.account('teacher-2');h.notesOwner('teacher-2');gate.resolve();await assert.rejects(()=>task);
    assert.equal(h.notes().owner,'teacher-2');assert.equal(h.H.notesStops,0,'Late cleanup preserves the newer notebook');assert.equal(h.H.models.length,0);
  }
});
test('employee answer preparation loads its teacher notebook and missing teacher ownership cannot run AI',async()=>{
  const request={prompt:'Prepare answer',images:[],question:sampleQuestions()[0],mode:'answer',questionText:'Why does felt slow heat loss?'};
  const h=appHarness();h.employee('teacher-notebook-owner');await h.ask(request);assert.deepEqual(h.H.order,['notes:stop','notes:start','notes:ready','ground','model']);assert.equal(h.H.notesLoads,1);assert.equal(h.H.models.length,1);
  const missing=appHarness();missing.employee('');await assert.rejects(()=>missing.ask(request));assert.equal(missing.H.notesLoads,0);assert.equal(missing.H.models.length,0);
});
