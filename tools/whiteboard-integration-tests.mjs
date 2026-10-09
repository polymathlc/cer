// Real controller/share modules and shipped app adapters. All persistence,
// account and AI boundaries are deterministic in-memory fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WB_LIMITS,newWhiteboard,createWhiteboardCard,whiteboardPublicSnapshot,normalizeWhiteboard,normalizeWhiteboardApp,whiteboardQuestionSnapshot} from '../whiteboard-core.mjs';
import {WHITEBOARD_SHARE_BYTES,WHITEBOARD_VIEWER,whiteboardViewerUrl,whiteboardShareParameters,whiteboardStorageUrl,whiteboardSnapshotBytes,whiteboardDigest,loadPublishedWhiteboard,readWhiteboardBytes,validWhiteboardUrl,whiteboardImageUrl} from '../whiteboard-share.mjs';
import {questions,teacher,student,appSuggestion,deferred,settle} from './whiteboard-fixtures.mjs';
import {installWhiteboards} from '../whiteboards.js';

const token='a682dbff-24e7-421a-bd63-4b512ac409a1';
function sampleBoard(){const board=newWhiteboard({title:'Heat lesson',createdBy:'teacher-1'});board.cards=questions().slice(0,2).map((q,i)=>createWhiteboardCard(q,{x:i*540,y:i*120,width:480}));return board;}
async function publication(board=sampleBoard()){const bytes=whiteboardSnapshotBytes(board),id=await whiteboardDigest(bytes);return {bytes,id,url:whiteboardViewerUrl(id,token)};}

test('share link validation never accepts arbitrary destinations or duplicate credentials',async()=>{
  const published=await publication();assert.equal(validWhiteboardUrl(published.url),published.url);
  assert.deepEqual(whiteboardShareParameters(new URL(published.url).hash),{id:published.id,token});
  assert.match(whiteboardStorageUrl(new URL(published.url).hash),/\/o\/cer-images%2Fwhiteboard-[a-f0-9]{64}\.json\?alt=media&token=/);
  for(const url of [published.url.replace('polymathlc.github.io','other.example'),published.url.replace('https:','http:'),published.url+'&token='+token,published.url+'&extra=yes',published.url.replace('#','?'),published.url.replace(token,'not-a-token'),published.url.replace('/cer/','/different/'),published.url.replace('https://','https://user:pass@')])assert.equal(validWhiteboardUrl(url),'',url);
  assert.equal(whiteboardViewerUrl('../private',token),'');
});

test('public diagrams convert genuine Dropbox and Google Drive share links without rewriting lookalike hosts',()=>{
  assert.equal(whiteboardImageUrl('https://www.dropbox.com/scl/fi/question.png?rlkey=fixture&dl=0'),'https://dl.dropboxusercontent.com/scl/fi/question.png?rlkey=fixture');
  assert.equal(whiteboardImageUrl('https://drive.google.com/file/d/questionDiagram/view?usp=sharing'),'https://drive.google.com/uc?export=view&id=questionDiagram');
  assert.equal(whiteboardImageUrl('https://drive.google.com/open?id=questionDiagram'),'https://drive.google.com/uc?export=view&id=questionDiagram');
  for(const url of ['https://notdropbox.com/question.png?dl=0','https://dropbox.com.untrusted.test/question.png?dl=0','https://drive.google.com.untrusted.test/file/d/questionDiagram/view','https://whiteboard.test/images/cup.svg','/images/cup.png'])assert.equal(whiteboardImageUrl(url),url);
});

test('public publication and verified read expose questions without model answers or account metadata',async()=>{
  const board=sampleBoard(),published=await publication(board),calls=[];
  const loaded=await loadPublishedWhiteboard(published.url,async(url,options)=>{calls.push({url,options});return new Response(published.bytes);});
  const text=JSON.stringify(loaded);
  for(const secret of ['PRIVATE MODEL ANSWER','PRIVATE EXPLANATION','PRIVATE CLAIM','PRIVATE EVIDENCE','PRIVATE REASONING','answer-only','teacher-1','correctId'])assert.ok(!text.includes(secret),'Public data omits '+secret);
  assert.deepEqual(loaded,whiteboardPublicSnapshot(board));assert.equal(calls.length,1);
  assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.referrerPolicy,'no-referrer');assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('a corrupted, unavailable or malformed public payload never opens the board',async()=>{
  const published=await publication();
  await assert.rejects(()=>loadPublishedWhiteboard(published.url,async()=>new Response(new Uint8Array([...published.bytes,32]))),/published link|match/);
  await assert.rejects(()=>loadPublishedWhiteboard(published.url,async()=>new Response('',{status:404})),/unavailable/);
  let calls=0;await assert.rejects(()=>loadPublishedWhiteboard('https://untrusted.test/',async()=>{calls++;}),/incomplete/);assert.equal(calls,0);
  const invalid=new TextEncoder().encode('{not JSON'),id=await whiteboardDigest(invalid);
  await assert.rejects(()=>loadPublishedWhiteboard(whiteboardViewerUrl(id,token),async()=>new Response(invalid)),/could not be read/);
});

test('downloads stop at their byte limit even without a trustworthy Content-Length header',async()=>{
  await assert.rejects(()=>readWhiteboardBytes(new Response('small',{headers:{'Content-Length':String(WHITEBOARD_SHARE_BYTES+1)}})),/too large/);
  let cancelled=false;
  const response={headers:new Headers(),body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array(WHITEBOARD_SHARE_BYTES));controller.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}})};
  await assert.rejects(()=>readWhiteboardBytes(response),/too large/);assert.equal(cancelled,true,'Over-limit stream is cancelled');
});

function controllerHarness(){
  const h={user:teacher(),authUid:'teacher-1',profile:'teacher-1:science:0',author:true,assignable:true,bank:questions(),stored:new Map(),received:[],writes:[],deletes:[],models:[],shares:[],assignments:[],attempts:[],prints:[],messages:[]};
  h.tool=installWhiteboards({getUser:()=>h.user,getAuthUid:()=>h.authUid,getProfileKey:()=>h.profile,canAuthor:()=>h.author,canAssign:()=>h.assignable,getBank:()=>h.bank,
    isQuestionEligible:q=>!q.excluded,questionTopics:q=>[q.topic,q.topic2].filter(Boolean),getLevels:()=>['P3','P4','P5','P6','S1'],
    prepareQuestion:async q=>h.prepareImpl?h.prepareImpl(q):structuredClone(q),
    loadBoards:async uid=>h.loadImpl?h.loadImpl(uid):structuredClone(h.stored.get(uid)||[]),loadReceivedBoards:async()=>structuredClone(h.received),
    saveBoard:async(board,context)=>{h.writes.push({board:structuredClone(board),context});if(h.saveImpl)return h.saveImpl(board,context);if(!context.guard())return false;h.stored.set(context.uid,[structuredClone(board),...(h.stored.get(context.uid)||[]).filter(old=>old.id!==board.id)]);return true;},
    deleteBoard:async(id,context)=>{h.deletes.push({id,context});if(!context.guard())return false;h.stored.set(context.uid,(h.stored.get(context.uid)||[]).filter(board=>board.id!==id));return true;},
    generateApp:async request=>{h.models.push(structuredClone(request));return h.modelImpl?h.modelImpl(request):appSuggestion();},
    shareBoard:async(board,context)=>{h.shares.push({board:structuredClone(board),context});return h.shareImpl?h.shareImpl(board,context):{url:(await publication(board)).url};},
    assignBoard:async(board,levels,context)=>{h.assignments.push({board:structuredClone(board),levels,context});return {count:3};},
    practiceBoard:async(board,options)=>{h.attempts.push({board:structuredClone(board),options});return true;},
    printBoard:request=>{h.prints.push(request);return true;},notify:(text,kind)=>h.messages.push({text,kind}),
  });
  h.tool.newBoard('Heat whiteboard');h.cards=()=>h.tool.state().draft?.cards||[];
  h.switchUser=user=>{h.user=user;h.authUid=user.uid;h.profile=user.uid+':science:0';h.author=user.role!=='student';h.assignable=user.role==='admin';h.tool.resetForUser(user.uid);};
  return h;
}

test('a named owner can keep multiple boards and complete snapshots without changing bank questions',async()=>{
  const h=controllerHarness(),original=structuredClone(h.bank);await h.tool.addQuestions(['heat-1','light-1','heat-1','missing']);assert.deepEqual(h.cards().map(card=>card.questionId),['heat-1','light-1']);
  const card=h.cards()[0];h.tool.moveCard(card.id,-840,500);h.tool.setView({x:-250,y:115,zoom:0.65});h.tool.editTitle('Our heat lesson');
  assert.equal(await h.tool.save(),true);const saved=h.tool.state().draft;
  assert.equal(h.writes[0].context.uid,'teacher-1');assert.equal(h.writes[0].board.createdBy,'teacher-1');assert.equal(h.writes[0].context.guard(),true);
  h.tool.newBoard('Another topic');await h.tool.addQuestions(['fill-1']);assert.equal(await h.tool.save(),true);assert.equal(h.stored.get('teacher-1').length,2);
  h.bank[0].blocks[0].content='Later bank wording';await h.tool.load();assert.equal(h.tool.selectBoard(saved.id),true);assert.deepEqual(h.tool.state().draft,saved,'Saved diagram and wording survive later bank edits');
  h.bank[0].blocks[0].content=original[0].blocks[0].content;assert.deepEqual(h.bank,original);assert.equal(h.models.length,0);
});

test('pasted and generated apps require explicit application and never edit their bank question',async()=>{
  const h=controllerHarness(),original=structuredClone(h.bank);await h.tool.addQuestions(['heat-1']);const id=h.cards()[0].id;
  assert.equal(h.tool.openApp(id),true);h.tool.editApp('title','A pasted activity');h.tool.editApp('html','<button>Try this question</button>');assert.equal(h.tool.previewApp(),true);
  assert.equal(h.cards()[0].app,null);assert.equal(await h.tool.save(),false,'An unreviewed app draft prevents saving');assert.equal(h.tool.applyApp(),true);assert.equal(h.cards()[0].app.title,'A pasted activity');
  h.tool.openApp(id);h.tool.editApp('instruction','Teach the direction of heat transfer.');assert.equal(await h.tool.generateApp(),true);
  assert.equal(h.cards()[0].app.title,'A pasted activity','AI result is pending until teacher accepts it');assert.equal(h.tool.state().editor.pending.title,'Explore cooling');
  assert.equal(await h.tool.save(),false);assert.equal(h.tool.applyApp(true),true);assert.equal(h.cards()[0].app.title,'Explore cooling');assert.equal(await h.tool.save(),true);
  assert.equal(h.models.length,1);assert.equal(h.models[0].instruction,'Teach the direction of heat transfer.');assert.ok(h.models[0].prompt.includes('question facts'));assert.deepEqual(h.bank,original);
});

for(const change of ['account','app edit','removed card','new board'])test('a late generated app cannot overwrite '+change,async()=>{
  const h=controllerHarness();await h.tool.addQuestions(['heat-1']);const id=h.cards()[0].id;h.tool.openApp(id);const gate=deferred();h.modelImpl=()=>gate.promise;
  const task=h.tool.generateApp();await settle();assert.equal(h.models.length,1);assert.equal(await h.tool.generateApp(),false,'One model request is allowed per editor');
  if(change==='account')h.switchUser({...teacher(),uid:'teacher-2'});
  if(change==='app edit')h.tool.editApp('html','<p>Teacher keeps this app</p>');
  if(change==='removed card')h.tool.removeCard(id);
  if(change==='new board')h.tool.newBoard('Different lesson');
  const before=h.tool.state().draft;gate.resolve(appSuggestion());assert.equal(await task,false);assert.deepEqual(h.tool.state().draft,before);assert.equal(h.tool.state().editor?.pending??null,null);
});

test('sharing saves current changes and sends exactly selected valid levels',async()=>{
  const h=controllerHarness();await h.tool.addQuestions(['heat-1']);assert.equal(await h.tool.assign([]),false);assert.equal(h.assignments.length,0);
  assert.equal(await h.tool.assign(['P5','P5','S1','unknown']),true);assert.deepEqual(h.assignments[0].levels,['P5','S1']);assert.equal(h.assignments[0].context.uid,'teacher-1');assert.equal(h.assignments[0].context.guard(),true);assert.equal(h.writes.length,1);
  h.tool.editTitle('Latest heat lesson');const url=await h.tool.share();assert.ok(validWhiteboardUrl(url));assert.equal(h.shares[0].board.title,'Latest heat lesson');assert.equal(h.writes.length,2);assert.equal(h.tool.state().dirty,false);
});

test('students and public viewers can pan, practice or print but cannot author, save, share or assign',async()=>{
  const h=controllerHarness();h.received=[whiteboardPublicSnapshot(sampleBoard())];h.switchUser(student());assert.equal(await h.tool.open(),true);assert.equal(h.tool.selectBoard(h.received[0].id),true);
  const original=h.tool.state().draft;h.tool.setView({x:-320,y:100,zoom:0.6});assert.equal(h.tool.state().dirty,false,'Student navigation is not a teacher layout edit');
  assert.equal(h.tool.newBoard(),false);assert.equal(h.tool.editTitle('Student edit'),false);assert.equal(await h.tool.addQuestions(['fill-1']),false);assert.equal(await h.tool.save(),false);assert.equal(await h.tool.share(),false);assert.equal(await h.tool.assign(['P5']),false);assert.equal(h.tool.openApp(original.cards[0].id),false);
  assert.equal(await h.tool.practice(original.cards[0].id),true);assert.deepEqual(h.attempts[0].options,{cardId:original.cards[0].id});assert.equal(await h.tool.print(),true);assert.ok(h.prints[0].html.includes('Cooling water'));assert.ok(!h.prints[0].html.includes('PRIVATE MODEL ANSWER'));
  assert.equal(h.tool.setPublicBoard(sampleBoard()),true);assert.equal(h.tool.state().publicMode,true);assert.equal(await h.tool.practice(),true);assert.equal(await h.tool.print(),true);assert.equal(await h.tool.save(),false);assert.equal(h.writes.length,0);assert.equal(h.assignments.length,0);
});

test('account switches and storage failures preserve correct drafts without claiming a save',async()=>{
  const h=controllerHarness();await h.tool.addQuestions(['heat-1']);h.saveImpl=async()=>{throw Error('Fixture storage offline');};assert.equal(await h.tool.save(),false);assert.equal(h.tool.state().dirty,true);assert.equal(h.cards().length,1);
  const gate=deferred();h.saveImpl=()=>gate.promise;const task=h.tool.save();await settle();h.switchUser({...teacher(),uid:'teacher-2'});gate.resolve(true);assert.equal(await task,false);assert.equal(h.tool.state().draft,null);assert.equal(h.writes.at(-1).context.guard(),false);
  const loadGate=deferred();h.loadImpl=()=>loadGate.promise;const loading=h.tool.load();await settle();h.switchUser({...teacher(),uid:'teacher-3'});loadGate.resolve([sampleBoard()]);assert.equal(await loading,false);assert.deepEqual(h.tool.state().boards,[]);
});

test('received refresh updates the current snapshot and removes a withdrawn assignment',async()=>{
  const h=controllerHarness(),board=whiteboardPublicSnapshot(sampleBoard());h.received=[board];h.switchUser(student());await h.tool.open();assert.equal(h.tool.state().draft.id,board.id);
  h.received=[{...board,title:'Revised lesson'}];assert.equal(await h.tool.refreshReceived(),true);assert.equal(h.tool.state().draft.title,'Revised lesson');
  h.received=[];assert.equal(await h.tool.refreshReceived(),true);assert.equal(h.tool.state().draft,null);assert.deepEqual(h.tool.state().boards,[]);
});

test('a saved bank source change prevents both a late AI preview and approval of an existing preview',async()=>{
  for(const stage of ['generating','review']){const h=controllerHarness();await h.tool.addQuestions(['heat-1']);const id=h.cards()[0].id;h.tool.openApp(id);
    if(stage==='generating'){const gate=deferred();h.modelImpl=()=>gate.promise;const task=h.tool.generateApp();await settle();h.bank[0].blocks[0].content='Changed facts';gate.resolve(appSuggestion());assert.equal(await task,false);assert.equal(h.tool.state().editor.pending,null);}
    else{assert.equal(await h.tool.generateApp(),true);h.bank[0].blocks[0].content='Changed facts';assert.equal(h.tool.applyApp(true),false);}
    assert.equal(h.cards()[0].app,null,'An app for stale facts cannot be applied');}
});

test('oversize pasted code is kept for editing and rejected rather than silently truncated',async()=>{
  const h=controllerHarness();await h.tool.addQuestions(['heat-1']);h.tool.openApp(h.cards()[0].id);const code='<p>'+ 'x'.repeat(WB_LIMITS.appHtml)+'</p>';h.tool.editApp('html',code);
  assert.equal(h.tool.state().editor.html,code);assert.equal(h.tool.previewApp(),false);assert.equal(h.tool.applyApp(),false);assert.equal(h.cards()[0].app,null);
});

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function shippedAppHarness(){
  const start=app.indexOf('function wbOwnerCurrent(uid) {'),end=app.indexOf('function wbTool()',start);
  assert.ok(start>=0&&end>start,'Shipped whiteboard adapters are present');
  const tableStart=app.indexOf('function tableDataToFirestore(data) {'),tableEnd=app.indexOf('\n}',tableStart);
  assert.ok(tableStart>=0&&tableEnd>tableStart,'Shipped Firestore table serializer exists');
  const deps={normalizeWhiteboard,normalizeWhiteboardApp,whiteboardQuestionSnapshot,whiteboardSnapshotBytes,whiteboardDigest,whiteboardViewerUrl,validWhiteboardUrl,whiteboardPublicSnapshot,questions,teacher,appSuggestion};
  return new Function('deps',`
    const {normalizeWhiteboard,normalizeWhiteboardApp,whiteboardQuestionSnapshot,whiteboardSnapshotBytes,whiteboardDigest,whiteboardViewerUrl,validWhiteboardUrl,whiteboardPublicSnapshot}=deps;
    ${app.slice(tableStart,tableEnd+2)}
    let currentUser=deps.teacher(),adminUid='teacher-1',questionBank=deps.questions(),_notesWatching='teacher-1',_notesLoaded=true,_wbAssignmentsUnsub=null;
    const auth={currentUser:{uid:'teacher-1'}},db={},storage={};
    const H={documents:[],writes:[],deletes:[],uploads:[],downloads:[],models:[],attempts:[],prints:[],published:[],notesLoads:0,notesStops:0,catalog:{boards:{}},level:'P5',profile:'teacher-1:science:0',events:[],readImpl:null,notesImpl:null,downloadImpl:null,notesUnavailable:false};
    const _canAuthor=()=>currentUser.role==='admin'||currentUser.role==='employee',_isAdmin=()=>currentUser.role==='admin',_isEmployee=()=>currentUser.role==='employee';
    const _scienceFeedKey=()=>H.profile,_scienceFeedLevel=()=>H.level,isLevelCode=value=>['P3','P4','P5','P6','S1'].includes(value);
    const collection=(...value)=>value.slice(1),doc=(...value)=>value.slice(1),storageRef=(_,value)=>value;
    const snap=value=>({exists:()=>value!=null,data:()=>value});
    const getDocs=async ref=>{H.events.push({kind:'getDocs',ref});return H.readImpl?H.readImpl(ref):{forEach:fn=>H.documents.forEach(row=>fn({id:row.id,data:()=>row.value}))};};
    const getDoc=async ref=>{H.events.push({kind:'getDoc',ref});return H.readImpl?H.readImpl(ref):snap(H.catalog);};
    const setDoc=async(ref,value)=>H.writes.push({ref,value}),deleteDoc=async ref=>H.deletes.push(ref);
    const runTransaction=async(_,callback)=>{const tx={get:async ref=>{H.events.push({kind:'transaction:get',ref});return H.transactionReadImpl?H.transactionReadImpl(ref):snap(H.catalog);},set:(ref,value,options)=>{H.writes.push({ref,value,options});H.catalog=value;},delete:ref=>H.deletes.push(ref)};return callback(tx);};
    const getDownloadURL=async reference=>{H.downloads.push(reference);if(H.downloadImpl)return H.downloadImpl(reference);if(!H.uploads.some(record=>record.reference===reference)){const err=Error('Missing');err.code='storage/object-not-found';throw err;}return 'https://firebasestorage.googleapis.com/object?alt=media&token=${token}';};
    const uploadBytes=async(reference,bytes,metadata)=>{H.uploads.push({reference,bytes,metadata});};
    const loadPublishedWhiteboard=async url=>{H.published.push(url);return H.publishedImpl?H.publishedImpl(url):whiteboardPublicSnapshot(H.publicBoard);};
    const qInSyllabus=q=>!q.excluded,qReleased=q=>!q.held,qAvailableToViewer=q=>_canAuthor()||qReleased(q),qWithinStudentLevel=q=>!q.tooHigh;
    const window={__aiReady:()=>true,QuestionApps:{normalizeTokenLimit:value=>Math.max(1024,Math.min(32000,Math.floor(Number(value)||4096)))}};
    const document={getElementById:id=>id==='printOutput'?H.output:null};H.output={innerHTML:'',querySelectorAll:selector=>selector==='.print-answer-key-page'?[{remove:()=>H.removedAnswerKey=true}]:selector==='img'?H.images||[]:[]};
    const buildWorksheetHtml=(questions,title,options)=>{H.prints.push({questions,title,options});return '<article>Student worksheet</article><div class="print-answer-key-page">Key</div>';},autoscaleAndPrint=output=>{H.didPrint=output===H.output;};
    const launchWorksheetPractice=async questions=>{H.attempts.push(questions);};
    const stopTeachingNotes=()=>{H.notesStops++;_notesWatching='';_notesLoaded=false;H.events.push({kind:'notes:stop'});};
    const loadTeachingNotes=async()=>{H.notesLoads++;H.events.push({kind:'notes:load'});if(H.notesImpl)await H.notesImpl();_notesWatching=currentUser.role==='admin'?currentUser.uid:adminUid;_notesLoaded=!H.notesUnavailable;};
    const ssSourceContext=q=>({images:q.blocks.filter(block=>block.type==='image').map(block=>({url:block.url,label:block.caption})),fullContext:JSON.stringify(q)});
    const transformImageUrl=value=>value,_urlToDataUrlRobust=async value=>H.imageImpl?H.imageImpl(value):'data:image/png;base64,c291cmNl',_parseImageDataUrl=value=>String(value).startsWith('data:image/png;base64,')?{mime:'image/png'}:null;
    const aiGrounding=(kind,topic,q)=>{H.events.push({kind:'grounding',groundingKind:kind,topic});return 'TEACHER NOTES FOR HEAT';};
    const _aiAsk=async(prompt,media,options,routes)=>{H.events.push({kind:'model'});H.models.push({prompt,media,options,routes});return H.modelImpl?H.modelImpl():deps.appSuggestion().html;},_widgetExtractHtml=value=>value;
    const aiAuthorEngine=()=>H.engine||'openai',_aiRoutesFor=engine=>[engine],showToast=(...args)=>H.events.push({kind:'toast',args});
    ${app.slice(start,end)}
    return {H,auth,load:wbLoadBoards,save:wbSaveBoard,remove:wbDeleteBoard,resolve:wbResolveQuestions,share:wbShareBoard,assign:wbAssignBoard,received:wbLoadReceivedBoards,generate:wbGenerateApp,practice:wbPracticeBoard,print:wbPrintBoard,
      bank:()=>questionBank,account:user=>{currentUser=user;auth.currentUser={uid:user.uid};H.profile=user.uid+':science:0';},teacher:id=>{adminUid=id;},notesOwner:value=>{_notesWatching=value;_notesLoaded=true;}};
  `)(deps);
}

test('shipped persistence uses only the owner collection and keeps ordinary worksheets separate',async()=>{
  const h=shippedAppHarness(),board=sampleBoard();h.H.documents=[{id:board.id,value:board},{id:'ordinary',value:{title:'Ordinary worksheet',questionIds:['heat-1']}},{id:'summary',value:{kind:'summary-sheet'}}];
  assert.equal((await h.load('teacher-1')).length,1);assert.deepEqual(h.H.events[0].ref,['users','teacher-1','worksheets']);
  assert.equal(await h.save({...board,createdBy:'incorrect-owner'},{uid:'teacher-1',guard:()=>true}),true);assert.deepEqual(h.H.writes[0].ref,['users','teacher-1','worksheets',board.id]);assert.equal(h.H.writes[0].value.createdBy,'teacher-1');
  assert.equal(await h.save(board,{uid:'other-teacher',guard:()=>true}),false);assert.equal(await h.save(board,{uid:'teacher-1',guard:()=>false}),false);assert.equal(h.H.writes.length,1);
  h.H.catalog.boards[board.id]={title:board.title};assert.equal(await h.remove(board.id,{uid:'teacher-1',guard:()=>true}),true);assert.deepEqual(h.H.deletes[0],['users','teacher-1','worksheets',board.id]);assert.equal(h.H.catalog.boards[board.id],undefined,'Deletion removes future student assignment too');
  h.account(student());assert.deepEqual(await h.load('student-1'),[]);assert.equal(await h.save(board,{uid:'student-1',guard:()=>true}),false);
});

test('table snapshots serialize for Firestore and normalize back without losing any cell',async()=>{
  const h=shippedAppHarness(),board=newWhiteboard({title:'Tables',createdBy:'teacher-1'});board.cards=[createWhiteboardCard(h.bank().find(q=>q.id==='table-1'))];
  const original=structuredClone(board);assert.equal(await h.save(board,{uid:'teacher-1',guard:()=>true}),true);
  const stored=h.H.writes[0].value,table=stored.cards[0].question.blocks.find(block=>block.type==='table');assert.equal(Array.isArray(table.data),false,'Firestore payload has no nested arrays');assert.deepEqual(table.data,{'0':{'0':'Cup','1':'Initial / °C','2':'Final / °C'},'1':{'0':'A','1':'80','2':'50'}});
  assert.deepEqual(normalizeWhiteboard(stored),original);assert.deepEqual(board,original,'Persistence does not mutate the controller draft');
});

test('shipped publication validates every source and uploads one immutable student-only snapshot',async()=>{
  const h=shippedAppHarness(),board=sampleBoard();h.H.publicBoard=board;const context={uid:'teacher-1',guard:()=>true};
  const result=await h.share(board,context);assert.ok(validWhiteboardUrl(result.url));assert.equal(h.H.uploads.length,1);assert.match(h.H.uploads[0].reference,/^cer-images\/whiteboard-[a-f0-9]{64}\.json$/);
  assert.equal(h.H.uploads[0].metadata.contentType,'application/json');assert.ok(h.H.uploads[0].metadata.cacheControl.includes('immutable'));assert.ok(!new TextDecoder().decode(h.H.uploads[0].bytes).includes('PRIVATE'));
  await h.share(board,context);assert.equal(h.H.uploads.length,1,'Repeat shares reuse an already-published digest');
  h.bank()[0].held=true;await assert.rejects(()=>h.share(board,context),/held back|scheduled/);assert.equal(h.H.uploads.length,1);
});

test('shipped assignment catalog selects exact learner levels and reads only matching valid publications',async()=>{
  const h=shippedAppHarness(),board=sampleBoard();h.H.publicBoard=board;const result=await h.assign(board,['P5','P5'],{uid:'teacher-1',guard:()=>true});assert.deepEqual(result.levels,['P5']);
  const write=h.H.writes.at(-1);assert.deepEqual(write.ref,['users','teacher-1','settings','whiteboardAssignments']);assert.deepEqual(write.value.boards[board.id].levels,['P5']);
  const published=await publication(board);h.H.catalog.boards.wb_p6={title:'P6 only',url:published.url,levels:['P6']};h.H.catalog.boards.wb_bad={url:'https://untrusted.test/',levels:['P5']};h.H.catalog.boards.wb_all={url:published.url,levels:['P3','P4']};
  h.account(student());const before=h.H.published.length;const received=await h.received('student-1');assert.equal(received.length,1);assert.equal(received[0].id,board.id);assert.equal(h.H.published.length,before+1,'Wrong levels and invalid URLs are never downloaded');
  h.H.level='P6';const p6=await h.received('student-1');assert.deepEqual(p6.map(value=>value.id),['wb_p6']);
  h.account({...teacher(),role:'employee'});await assert.rejects(()=>h.assign(board,['P5'],{uid:'teacher-1',guard:()=>true}),/Only the teacher/);
});

test('a learner change during receiving a whiteboard drops the old account response',async()=>{
  const h=shippedAppHarness(),board=sampleBoard(),published=await publication(board);h.H.catalog.boards[board.id]={url:published.url,levels:['P5']};h.account(student());const gate=deferred();h.H.publishedImpl=()=>gate.promise;
  const task=h.received('student-1');await settle();h.H.profile='student-1:science:second-child';gate.resolve(whiteboardPublicSnapshot(board));assert.deepEqual(await task,[]);
});

test('one unavailable assignment does not hide another received whiteboard and reports the failed receipt',async()=>{
  const h=shippedAppHarness(),board=sampleBoard(),published=await publication(board),badUrl=whiteboardViewerUrl('e'.repeat(64),token);h.account(student());
  h.H.catalog.boards[board.id]={url:published.url,levels:['P5']};h.H.catalog.boards.wb_unavailable={url:badUrl,levels:['P5']};
  h.H.publishedImpl=async url=>{if(url===badUrl)throw Error('Fixture publication missing');return whiteboardPublicSnapshot(board);};
  const received=await h.received('student-1');assert.deepEqual(received.map(value=>value.id),[board.id]);assert.ok(h.H.events.some(event=>event.kind==='toast'&&String(event.args[0]).includes('1')),'Failed receipt is reported without a blank library');
});

test('shipped practice and PDF use the canonical ordered questions and enforce schedule, level and snapshot freshness',async()=>{
  const h=shippedAppHarness(),board=sampleBoard();h.account(student());assert.equal(await h.practice(board,{cardId:board.cards[1].id}),true);assert.deepEqual(h.H.attempts[0].map(q=>q.id),['light-1']);
  assert.equal(await h.print({board}),true);assert.deepEqual(h.H.prints[0].questions.map(q=>q.id),['heat-1','light-1']);assert.equal(h.H.removedAnswerKey,true);assert.equal(h.H.didPrint,true);
  for(const reason of ['held','tooHigh','excluded','changed']){const fresh=shippedAppHarness();fresh.account(student());if(reason==='changed')fresh.bank()[0].blocks[0].content='Changed question';else fresh.bank()[0][reason]=true;
    await assert.rejects(()=>fresh.practice(board));await assert.rejects(()=>fresh.print({board}));assert.equal(fresh.H.attempts.length,0);assert.equal(fresh.H.prints.length,0);}
});

test('the shipped PDF printer waits for diagrams and stops on broken images, learner changes or a replaced print output',async()=>{
  const broken=shippedAppHarness();broken.H.images=[{complete:true,naturalWidth:0}];await assert.rejects(()=>broken.print({board:sampleBoard()}),/diagram.*load/);assert.equal(broken.H.didPrint,undefined);
  for(const change of ['learner','output','none']){const h=shippedAppHarness();h.account(student());const listeners={};h.H.images=[{complete:false,naturalWidth:0,addEventListener:(name,callback)=>{listeners[name]=callback;}}];
    const task=h.print({board:sampleBoard()});await settle();assert.equal(h.H.didPrint,undefined);assert.equal(h.H.images[0].loading,'eager');
    if(change==='learner')h.H.profile='student-1:science:second-child';if(change==='output')h.H.output.innerHTML='A different worksheet';
    h.H.images[0].naturalWidth=400;listeners.load();assert.equal(await task,change==='none');assert.equal(h.H.didPrint===true,change==='none');}
});

test('shipped helper-app generation waits for teaching notes and uses one selected route at the exact output budget',async()=>{
  const h=shippedAppHarness(),board=sampleBoard(),gate=deferred();h.H.notesImpl=()=>gate.promise;
  const task=h.generate({question:h.bank()[0],card:board.cards[0],instruction:'Show a heat-transfer arrow',maxTokens:8192});await settle();assert.equal(h.H.models.length,0);
  gate.resolve();const result=await task;assert.equal(result.html,appSuggestion().html);assert.equal(h.H.models.length,1);const call=h.H.models[0];
  assert.deepEqual(call.routes,['openai']);assert.equal(call.options.maxOutputTokens,8192);assert.equal(call.options.exactOutputBudget,true);assert.equal(call.options.reasoningEffort,'high');assert.equal(call.options.json,false);assert.equal(call.media.length,1);
  assert.ok(call.prompt.includes('TEACHER NOTES FOR HEAT'));assert.ok(call.prompt.includes('Show a heat-transfer arrow'));assert.ok(call.prompt.includes('PRIVATE MODEL ANSWER'),'Teacher builder can use the recorded answer without publishing the bank answer');
});

test('teaching-note failure, stale source, unreadable figure and account changes never submit an app model request',async()=>{
  for(const reason of ['notes','source','image','account','more images']){const h=shippedAppHarness(),board=sampleBoard(),gate=deferred();const request={question:h.bank()[0],card:board.cards[0]};
    if(reason==='notes')h.H.notesUnavailable=true;
    if(reason==='source')h.bank()[0].blocks[0].content='Changed wording';
    if(reason==='image')h.H.imageImpl=()=>'';
    if(reason==='more images'){h.bank()[0].blocks.push(...[1,2,3].map(i=>({id:'extra_'+i,type:'image',url:'https://whiteboard.test/images/extra.svg'})));request.card=createWhiteboardCard(h.bank()[0]);}
    if(reason==='account')h.H.notesImpl=()=>gate.promise;
    const task=h.generate(request);if(reason==='account'){await settle();h.account({...teacher(),uid:'teacher-2'});gate.resolve();}
    await assert.rejects(()=>task);assert.equal(h.H.models.length,0,reason);}
});

test('whiteboards ship with matching app, page, modules and authenticated navigation',()=>{
  assert.ok(app.includes('installWhiteboards'),'App installs whiteboard controller');assert.ok(page.includes('id="page-whiteboards"'),'Portal has whiteboard page');assert.ok(page.includes('whiteboards.css'),'Whiteboard styles are deployed');
  assert.ok(/kind\s*===?\s*['"]infinite-whiteboard['"]|\[['"][^\n]+infinite-whiteboard/.test(app),'Ordinary worksheet loader separates whiteboard documents');
});
