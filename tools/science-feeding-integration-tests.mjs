// Real Science feeding handlers with controlled storage, DOM and Firebase edges.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as core from '../science-feed-core.js';
import * as quality from '../science-feed-quality.js';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const slice = (from, to) => {
  const a = source.indexOf(from), b = source.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, from);
  return source.slice(a, b);
};
const fn = (name, async = false) => slice(`${async ? 'async ' : ''}function ${name}(`, '\n}') + '\n}';
const helpers = slice('// ---- Student feeding: one local policy', 'function getQuestionsForLevel(');
const q = (id, extra = {}) => ({ id, title: `Heat investigation ${id}`, topic: 'Heat', level: 'P4',
  blocks: [{ id: 'text', type: 'text', content: `<p>In investigation ${id}, which material conducts heat?</p>` },
    { id: 'choices', type: 'mcq', options: [{ id: 'a', text: 'Metal' }, { id: 'b', text: 'Wood' }], correctId: 'a' }], ...extra });

function harness(bank = []) {
  const state = { bank, toasts: [], renders: [], summaries: 0, attempts: [], nodes: new Map(), storage: new Map(), writes: [], messages: [] };
  const node = id => {
    if (!state.nodes.has(id)) state.nodes.set(id, { id, innerHTML: '', value: id.includes('Level') ? 'P4' : id.includes('Type') ? 'all' : '',
      textContent: '', style: {}, contains: () => false, querySelectorAll: () => [], classList: { add() {}, remove() {} } });
    return state.nodes.get(id);
  };
  const document = { getElementById: node, querySelector: sel => node(sel), querySelectorAll: () => [], addEventListener() {} };
  const api = new Function('state', 'document', 'core', 'quality', `
    const {buildScienceFeedContext,planScienceQuestions,evaluateScienceFit,scienceQuestionLevel}=core;
    const {evaluateQuestionQuality,questionQualitySignature,buildQuestionQualitySummary,questionHasUnresolvedStudentFlag}=quality;
    let currentUser={uid:'family',name:'Mika',level:'P4',adminLevel:'P6',role:'student'};
    let familyProfile={students:[{name:'Mika',level:'P4'}],activeStudent:0};
    let students=[],activeStudentIndex=-1;
    let practiceSessionResults=[];
    const _annotPadScores={};
    const _practiceServedLoad=()=>({});let _practiceServed={};
    const renderPracticeReady=()=>{};
    const famActive=()=>familyProfile.students[familyProfile.activeStudent]||null;
    const famStudents=()=>familyProfile.students;
    const LEVEL_MAX='S1',LEVEL_MIN='P3',TOPIC_LEVELS=['P3','P4','P5','P6','S1'];
    const topicLevelMap={'Magnets':'P3','Heat':'P4','Electrical Systems':'P5','Forces':'P6','Cells — The Basic Unit of Life':'S1','Cell Systems':'P5'};
    const customTopics={}; let loData={objectives:[],map:{}};
    const isLevelCode=v=>/^(P[3-6]|S1)$/.test(v||'');
    const getLevelNumber=v=>v==='S1'?7:Number(String(v).replace('P',''))||3;
    const isSecondaryLevel=v=>v==='S1';
    const levelBandMin=v=>v==='S1'?7:3;
    const getTopicLevel=t=>topicLevelMap[t]||'P6';
    const qTopicList=q=>[q.topic,q.topic2].filter(Boolean);
    const qInSyllabus=q=>!q.notInSyllabus&&!qTopicList(q).some(t=>/Cell Systems/.test(t));
    const qAvailableToViewer=q=>!q.releaseOn||q.releaseOn<'2026-09-14';
    const questionHasMarkableAnswer=q=>q.blocks?.some(b=>b.type==='mcq'||b.type==='plainanswer');
    const localStorage={getItem:k=>state.storage.get(k)||null,setItem:(k,v)=>state.storage.set(k,v)};
    const showToast=(...args)=>state.toasts.push(args);
    const escapeHtml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const transformImageUrl=url=>url;
    const location={href:'https://school.test/cer/index.html',origin:'https://school.test'};
    const tlStateOf=q=>q.checkedState||{state:'idle'};
    const tlSig=q=>q.importSignature||'';
    let questionBank=state.bank,flaggedQuestions=[];
    let _qAttemptStats={},_qAttemptStatsAt=0,_qAttemptStatsUid='';
    let qpQueue=[],qpIndex=-1,qpLevel='P4',qpAnswered=0,qpSessionResults=[];
    let tpQueue=[],tpIndex=-1,tpAnswered=0,tpSessionResults=[];
    let _openQStore={},_openItemsStore={},_openMcqStore={},_openSurfaceCfg={},_openPartResults={},_openFinalized={};
    const _openPhoto={}; let currentPracticeQ=null;
    let _questRun=null,_ainsteinQuiz=null,_tcgQuiz=null,duelRun=null,emsRun=null,elgRun=null;
    let _commQuests=[];
    const preloadQueueImages=async()=>{};
    const Math=Object.create(globalThis.Math);Math.random=()=>0;
    const _resetOpenScienceCoaches=()=>{};
    const db={}; const collection=(...x)=>x,where=(...x)=>x,query=(...x)=>x;
    const getDocs=async()=> { if(state.wait) await state.wait; return {forEach:visit=>state.attempts.forEach(a=>visit({data:()=>a}))}; };
    const setDoc=async(ref,value)=>state.writes.push(value),_qRef=id=>id;
    const rpgQuestionChanged=()=>{};
    const qpFibOn=()=>false,qHasKeywords=()=>true;
    const qpSetMode=()=>{};
    const navigateTo=()=>{};
    const qLockSplit=qs=>({ready:qs.filter(qAvailableToViewer),locked:qs.filter(q=>!qAvailableToViewer(q))});
    const qLockNote=()=> 'Not released';
    const studentCapNum=()=>getLevelNumber(_scienceFeedLevel());
    const renderQpQuestion=q=>state.renders.push(q.id),renderQpSummary=()=>state.summaries++;
    const tpRenderQuestion=q=>state.renders.push(q.id),renderPracticeReport=()=>state.summaries++;
    const updateQpProgress=()=>{},tpUpdateProgress=()=>{};
    const qpLoadSeen=()=>[],qpSaveSeen=()=>{};
    const renderPracticeQuestion=(q,student)=>state.renders.push(q.id);
    const buildOpenBody=(q,selector,cfg)=>{_openQStore[selector]=q;_openSurfaceCfg[selector]=cfg;state.markedCallback=cfg.onAllMarked;return '';};
    const stripHtmlToText=v=>String(v||'').replace(/<[^>]*>/g,'');
    const _htmlPlainText=stripHtmlToText;
    const _sdBreakStatements=v=>v,_sdZoomBtns=()=>'',imgSizeStyle=()=>'',_sdSeedElo=()=>1200;
    const renderTableReadonly=b=>'<table>'+Object.values(b.data).map(row=>'<tr>'+Object.values(row).map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</table>';
    ${helpers}
    ${fn('qInLevelBand')}
    ${fn('qLevelNum')}
    ${fn('qWithinStudentLevel')}
    ${fn('qpHasWritten')}
    ${fn('qpHasMcq')}
    ${fn('qpMatchesType')}
    ${fn('qpFilters')}
    ${fn('buildQpQueue')}
    ${fn('qpMarkServed')}
    ${fn('loadNextQpQuestion')}
    ${fn('tpLoadNextQuestion')}
    ${fn('launchWorksheetPractice')}
    ${fn('getQuestionsForLevel')}
    ${fn('loadRandomPracticeQuestion', true)}
    ${fn('onPracticeStudentChange')}
    ${fn('renderOpenPracticeBody')}
    ${fn('commStartAutoQuest', true)}
    ${fn('loadAttemptStats', true)}
    ${fn('noteAttemptLocally')}
    ${fn('_sdStemHtml')}
    ${fn('_sdExtractMcq')}
    ${fn('_tcgBankQuestions')}
    return {
      plan:(qs=questionBank,opts)=>_scienceFeedPlan(qs,opts),
      level:qWithinStudentLevel,key:_scienceFeedKey,
      user:u=>{currentUser={...currentUser,...u};_scienceFeedPassCache=null;},
      family:value=>{familyProfile=value;_scienceFeedPassCache=null;},
      queue:qs=>{qpQueue=qs;qpIndex=-1;_qpFeedManual=false;},
      next:loadNextQpQuestion,build:()=>buildQpQueue('P6'),manual:launchWorksheetPractice,
      mark:_scienceFeedMark,result:noteAttemptLocally,load:loadAttemptStats,stats:()=>_qAttemptStats,
      store:_scienceFeedStoreRead,ownFlag:_scienceFeedFlagOwn,summary:_scienceFeedSummary,
      reports:rows=>{flaggedQuestions=rows;_scienceFeedFlagsLoadedUid=currentUser.uid;},
      image:_scienceFeedImageResult,gameRows:_tcgBankQuestions,nextGame:_scienceFeedNextGame,
      refresh:_scienceFeedRefreshFrames,
      active:q=>{_openQStore['#question']=q;_openSurfaceCfg['#question']={mode:'practice'};qpQueue=[q];},
      activeState:()=>({questions:_openQStore,queue:qpQueue}),
      profilePractice:async student=>{students=[student];activeStudentIndex=0;await loadRandomPracticeQuestion();},
      managed:rows=>{students=rows;},
      selectManaged:index=>{document.getElementById('practiceStudentSelect').value=String(index);onPracticeStudentChange();},
      random:loadRandomPracticeQuestion,
      managedMark:q=>{currentPracticeQ=q;renderOpenPracticeBody(q);},
      autoQuest:async count=>{_commQuests=[{_id:'quest',mode:'auto',format:'mcq',count,endAt:new Date(Date.now()+86400000).toISOString()}];await commStartAutoQuest('quest');},
      quest:()=>_questRun,
      flags:()=>_scienceFeedStoreRead('flags')
    };
  `)(state, document, core, quality);
  return { api, state, node };
}

test('Quick Practice enforces highest declared/topic/LO level and fails closed for unknown students', () => {
  const a=q('allowed'), b=q('higher',{level:'P6'}), c=q('mixed',{topic2:'Forces'});
  const {api}=harness([a,b,c]);
  assert.deepEqual(api.build().map(q=>q.id),['allowed']);
  api.user({level:''}); assert.deepEqual(api.build(),[]);
});

test('cached Quick Practice queue is rechecked after changing school level', () => {
  const {api,state}=harness([q('p6',{level:'P6'}),q('p4')]);
  api.queue([q('p6',{level:'P6'}),q('p4')]);api.next();api.next();
  assert.deepEqual(state.renders,['p4']);assert.equal(state.summaries,1);
});

test('a served exact copy cannot repeat through a new title, mode or freshly built queue', () => {
  const original=q('original'),copy={...original,id:'copy',title:'Different title'};
  const {api,state}=harness([original,copy]);
  api.queue([original,copy]);api.next();api.next();
  assert.equal(state.renders.length,1);assert.deepEqual(api.build(),[]);
  assert.equal(api.nextGame({pool:[{id:'copy',feedSource:copy}]}),null);
});

test('explicit worksheet preserves order and permits same-level difficult revision, while blocking above-level and broken questions', () => {
  const hard=q('hard',{difficulty:1200}), easy=q('easy'), high=q('p6',{level:'P6'});
  const broken=q('broken',{blocks:[{id:'stem',type:'text',content:''}]});
  const {api,state}=harness([hard,easy,high,broken]);api.mark('hard');api.manual([hard,high,broken,easy]);api.next();
  assert.deepEqual(state.renders,['hard','easy']);assert.ok(state.toasts.some(x=>/skipped/.test(x[0])));
});

test('suspect questions are excluded automatically but explicitly selected revision warns the student', () => {
  const suspect=q('review',{importWarning:'Please check the diagram crop'});
  const {api,state}=harness([suspect]);assert.equal(api.plan().questions.length,0);
  api.manual([suspect]);assert.deepEqual(state.renders,['review']);assert.ok(state.toasts.some(x=>/teacher review/.test(x[0])));
});

test('only deliberate past-paper entry can admit retired work and still applies the absolute school ceiling', () => {
  const retired=q('retired',{notInSyllabus:true}),high=q('high',{notInSyllabus:true,level:'P6'});
  const {api,state}=harness([retired,high]);api.manual([retired]);assert.equal(state.renders.length,0);
  api.manual([retired,high],undefined,{allowRetired:true});assert.deepEqual(state.renders,['retired']);
});

test('latest outcomes from the active child feed mastery; a sibling and lifetime best do not replace them', async () => {
  const {api,state}=harness([q('a')]);const now=Date.now();
  state.attempts=[{displayName:'Mika',questionId:'a',score:1,totalBlanks:1,timestamp:now-4000},
    {displayName:'Mika',questionId:'a',score:0,totalBlanks:1,timestamp:now-1000},
    {displayName:'Older',questionId:'a',score:1,totalBlanks:1,timestamp:now}];
  await api.load();assert.equal(api.stats().a.best,1);assert.equal(api.stats().a.latestFrac,0);
  assert.equal(api.stats().a.n,2);assert.equal(api.plan().questions.length,0,'new miss gets a review break');
});

test('an old account or sibling history request cannot populate the new child cache', async () => {
  const {api,state}=harness([q('a')]);let done;state.wait=new Promise(resolve=>done=resolve);
  state.attempts=[{displayName:'Mika',questionId:'a',score:1,totalBlanks:1,timestamp:Date.now()}];
  const pending=api.load();api.user({name:'Younger',level:'P3'});api.family({students:[{name:'Younger',level:'P3'}],activeStudent:0});
  done();await pending;assert.equal(api.stats(),null,'the old response leaves the new child unloaded');
});

test('learner change clears active questions, marking stores and cached queues even with the same login', () => {
  const {api}=harness([q('p6',{level:'P6'})]);api.user({name:'Older',level:'P6'});api.refresh();api.active(q('p6',{level:'P6'}));
  api.user({name:'Mika',level:'P4'});api.family({students:[{name:'Mika',level:'P4'}],activeStudent:0});api.refresh();
  assert.deepEqual(api.activeState(),{questions:{},queue:[]});
});

test('managed pupil practice has independent served memory and cannot exceed that pupil level', async () => {
  const {api,state}=harness([q('p4'),q('p6',{level:'P6'})]);api.user({role:'admin'});
  await api.profilePractice({name:'Primary Four',level:'P4'});await api.profilePractice({name:'Primary Four',level:'P4'});
  assert.deepEqual(state.renders,['p4']);await api.profilePractice({name:'Another Four',level:'P4'});assert.deepEqual(state.renders,['p4','p4']);
});

test('a pending managed-practice load cannot show the previous pupil question after the teacher changes pupil', async () => {
  const {api,state}=harness([q('p4'),q('p6',{level:'P6'})]);api.user({role:'admin'});
  api.managed([{name:'Older',level:'P6'},{name:'Younger',level:'P4'}]);api.selectManaged(0);
  let done;state.wait=new Promise(resolve=>done=resolve);const pending=api.random();
  api.selectManaged(1);done();await pending;assert.deepEqual(state.renders,[]);
  await api.random();assert.deepEqual(state.renders,['p4']);
});

test('a completed mark from the previous managed pupil cannot write into the newly selected pupil history', () => {
  const question=q('p6',{level:'P6'});const {api,state}=harness([question]);api.user({role:'admin'});
  api.managed([{name:'Older',level:'P6'},{name:'Younger',level:'P4'}]);api.selectManaged(0);api.managedMark(question);
  const oldCallback=state.markedCallback;api.selectManaged(1);oldCallback({score:1,total:1});
  assert.deepEqual(api.store('history',{name:'Younger',level:'P4'}),{});
  assert.deepEqual(api.store('history',{name:'Older',level:'P6'}),{});
});

test('automatic quest considers suitable candidates after the requested number of held-back ones', async () => {
  const sound=q('sound'),suspect=q('review',{importWarning:'Review source crop'});
  const {api,state}=harness([sound,suspect]);await api.autoQuest(1);
  assert.deepEqual(api.quest().ids,['sound']);assert.deepEqual(state.renders,['sound']);
});

test('a loaded empty report inbox cannot acknowledge a newer own report it never reviewed', () => {
  const question=q('a');const {api}=harness([question]);api.ownFlag('a',quality.questionQualitySignature(question));
  api.user({role:'admin'});api.reports([]);const summary=api.summary(question);
  assert.equal(summary.reportsReviewedAt,undefined);
  assert.equal(quality.questionHasUnresolvedStudentFlag({...question,practiceQuality:summary},api.flags().a),true);
});

test('an explicit review acknowledges the matching revision without leaking answers into summary', () => {
  const question=q('a');const {api}=harness([question]);api.user({role:'admin'});
  api.reports([{questionId:'a',questionSignature:quality.questionQualitySignature(question),status:'resolved',reviewedAt:Date.now()}]);
  const summary=api.summary(question);assert.ok(summary.reportsReviewedAt);assert.equal(summary.reportCount,0);
  assert.equal(JSON.stringify(summary).includes('correctId'),false);assert.equal(JSON.stringify(summary).includes('Metal'),false);
});

test('failed relative images inside tables and quoted answers lower quality, then a successful load clears it', () => {
  const question=q('diagram');question.blocks.push({id:'table',type:'table',rows:1,cols:1,data:[['<img src="figures/plot.png">']]});
  const {api}=harness([question]);assert.equal(api.plan().questions.length,1);
  api.image(question,'https://school.test/cer/figures/plot.png?_retry=123',true);assert.equal(api.plan().questions.length,0);
  api.image(question,'figures/plot.png',false);assert.equal(api.plan().questions.length,1);
});

test('the actual trainer extraction retains tables, quoted context and scientific option formatting', () => {
  const question=q('table');question.blocks.splice(1,0,{id:'table',type:'table',rows:1,cols:1,data:[['15 °C']]},
    {id:'quoted',type:'studentAnswer',answer:'The fruit is dull green.'});
  question.blocks.at(-1).options=[{id:'a',text:'CO<sub>2</sub>'},{id:'b',text:'CO2'}];
  const {api}=harness([question]);const rows=api.gameRows();assert.equal(rows.length,1);
  assert.match(rows[0].html,/<table>/);assert.match(rows[0].html,/15 °C/);assert.match(rows[0].html,/dull green/);
  assert.deepEqual(rows[0].optsHtml,['CO<sub>2</sub>','CO2']);
});

test('a multi-part MCQ worksheet cannot be reduced to one answer in a game', () => {
  const question=q('multipart');question.blocks.push({...question.blocks[1],id:'second-choice'});
  const {api}=harness([question]);assert.deepEqual(api.gameRows(),[]);
  assert.equal(api.plan().questions.length,1,'the full question remains available to normal practice');
});

test('a mixed MCQ and written-response question stays in full practice rather than recording one click as whole-question mastery', () => {
  for(const type of ['answer','plainanswer','openLines','workingSpace','fillblank','answerLine']){
    const question=q('mixed-'+type);question.blocks.push({id:'written',type,content:'Explain your choice.',text:'[[conduction]]'});
    const {api}=harness([question]);assert.deepEqual(api.gameRows(),[],type);
  }
  const annotated=q('annotation',{annotation:true});annotated.blocks.push({id:'diagram',type:'image',url:'https://school.test/figure.png',annotate:true});
  assert.deepEqual(harness([annotated]).api.gameRows(),[]);
  const explanation=q('explanation');explanation.blocks.push({id:'key',type:'explanation',content:'Metals conduct heat.'});
  assert.equal(harness([explanation]).api.gameRows().length,1,'a hidden explanation is not an extra response');
});

test('a cached game question uses the latest teacher-edited stem and answer', () => {
  const old=q('edited'),current=q('edited');
  current.blocks[0].content='<p>Which material is a heat insulator?</p>';current.blocks[1].correctId='b';
  const {api}=harness([current]);
  const row=api.nextGame({pool:[{id:'edited',db:true,feedSource:old,html:'Old stem',opts:['Metal','Wood'],a:0}]});
  assert.match(row.html,/heat insulator/);assert.equal(row.a,1);assert.equal(row.feedSource,current);
});

test('a pending real per-part grade cannot record results for a sibling after the shared login changes', async () => {
  let finish;const state={writes:0,completed:0,started:false};
  const api=new Function('state','wait',`
    let currentUser={uid:'family',name:'Older',level:'P6',role:'student'};
    const q={id:'p6',topic:'Forces',blocks:[]};
    let _openQStore={'#q':q},_openSurfaceCfg={'#q':{}},_openPhoto={};
    const _openItemsStore={'#q':[{label:'Answer',model:'A force'}]},_openMcqStore={};
    const fb={innerHTML:''};const area={value:'A force',style:{},closest:()=>({querySelector:()=>fb})};
    const document={querySelector:sel=>sel.includes('.open-answer')?area:fb};
    const window={__aiReady:()=>true},showToast=()=>{},_captureScienceCoachTarget=()=>null,_showScienceCoachFeedback=()=>{};
    const _gradingQuestionInput=async()=>({text:'Question',note:'',media:[]}),_markingPreamble=()=>'',SCIENCE_COACH_INSTRUCTIONS='';
    const askGemini=async()=>{state.started=true;await wait;return JSON.stringify({verdict:'correct',feedback:'Good'})};
    const _parseAIJson=JSON.parse,escapeHtml=String,qKeyPlainHtml=(q,v)=>v;
    const _setPartResult=()=>state.writes++,_checkAllPartsMarked=()=>state.completed++;
    ${fn('markQuestionPart',true)}
    return {mark:()=>markQuestionPart('#q','open','0',{innerHTML:'Check'}),switch:()=>{currentUser={uid:'family',name:'Mika',level:'P4',role:'student'};_openQStore={};_openSurfaceCfg={};}};
  `)(state,new Promise(resolve=>finish=resolve));
  const pending=api.mark();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(state.started,true);
  api.switch();finish();await pending;assert.equal(state.writes,0);assert.equal(state.completed,0);
});
