// Real production policies, question renderers, navigation handlers and styles.
// Only account/data providers and optional AI/reward services are stubbed.
// Every request stays inside this isolated fixture; no real student writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';

const moduleName=process.env.PLAYWRIGHT_MODULE || 'playwright';
const {chromium}=await import(/^[A-Za-z]:[\\/]/.test(moduleName)?pathToFileURL(moduleName).href:moduleName);
const root=fileURLToPath(new URL('../',import.meta.url));
const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\r\n/g,'\n');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/\r\n/g,'\n');
const section=(text,start,end)=>{
  const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,`Production section exists: ${start}`);return text.slice(a,b);
};
const fn=name=>{
  const match=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);
  assert.ok(match,`Production function exists: ${name}`);
  const start=match.index,firstEnd=source.indexOf('\n',start),first=source.slice(start,firstEnd);
  if(first.trimEnd().endsWith('}'))return first;
  const end=source.indexOf('\n}',start);assert.ok(end>start,`Production function closes: ${name}`);
  return source.slice(start,end+2);
};
const css=[...html.slice(0,html.indexOf('</head>')).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
const markup=section(html,'    <div class="page" id="page-quickpractice">','    <!-- ===== PAGE: TOPICAL PRACTICE');
const feed=section(source,'// ---- Student feeding: one local policy','function getQuestionsForLevel(');
const functions=[
  'buildOpenBody','renderImportedBlockStudent','renderTableReadonly','ensureTableMigrated','_tblCellCss','markMcqChoice',
  'buildQpQueue','qpHasWritten','qpHasMcq','qpMatchesType','qpFilters','startQuickPractice','loadNextQpQuestion','renderQpQuestion',
  'updateQpProgress','_qpAllPartsMarked','_recordQpResult','renderQpSummary','renderPracticeReport','_reportColor','_fmtScore',
  'qLevelNum','qWithinStudentLevel','qInLevelBand','levelBandMin','studentCapLevel','studentCapNum',
  'famApplyActiveStudent','_tcgBankQuestions','_sdExtractMcq','_sdStemHtml','_sdBreakStatements','_sdZoomBtns','_sdSeedElo'
].map(fn).join('\n');
const moduleFiles=new Set(['science-feed-core.js','science-feed-variety.js','science-feed-mastery.js','science-feed-quality.js']);
const errors=[],network=[];
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1120,height:920}});
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
const fixture=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
body{display:block;overflow:auto}main{max-width:940px;margin:20px auto;padding:0 12px}.page{display:none!important}#page-quickpractice{display:block!important}.main-content{margin-left:0!important}.qp-part{min-width:0}</style></head><body><main>${markup}</main>
<div id="practiceContainer"></div><div id="tpContainer"></div><div id="tcgqBody"></div><div id="duelQuiz"></div><div id="emsQuizBody"></div><div id="elgQuiz"></div>
<script type="module">
import {buildScienceFeedContext,planScienceQuestions,evaluateScienceFit,scienceQuestionLevel} from '/science-feed-core.js';
import {evaluateQuestionQuality,buildQuestionQualitySummary,questionQualitySignature,questionHasUnresolvedStudentFlag} from '/science-feed-quality.js';
let currentUser={uid:'fixture-family',name:'Older child',role:'student',level:'P6',adminLevel:'P6'};
let child={name:'Older child',level:'P6'},questionBank=[],customTopics={},loData={objectives:[],map:{}};
const topicLevelMap={'Plant Systems':'P4','Electrical Systems':'P5','Forces':'P6','Magnets':'P3','Cells':'S1'};
const TOPIC_LEVELS=['P3','P4','P5','P6','S1'],LEVEL_MAX='S1',LEVEL_MIN='P3',LEVEL_SECONDARY_MIN='S1',LEVEL_DEFAULT_CAP='P6';
const LEVEL_ORDER={P3:3,P4:4,P5:5,P6:6,S1:7};
const isLevelCode=l=>TOPIC_LEVELS.includes(l),isSecondaryLevel=l=>String(l).startsWith('S'),getLevelNumber=l=>LEVEL_ORDER[l]||6;
const getTopicLevel=t=>topicLevelMap[t]||LEVEL_MAX,famActive=()=>child;
let _qAttemptStats={},_qAttemptStatsUid='',_qAttemptStatsAt=0,flaggedQuestions=[];
let qpQueue=[],qpIndex=-1,qpAnswered=0,qpSessionResults=[],qpSubmitted=false,qpLevel='P4';
let tpQueue=[],tpIndex=-1,tpAnswered=0,tpSessionResults=[],_questRun=null,_ainsteinQuiz=null,currentPracticeQ=null;
let _tcgQuiz=null,duelRun=null,emsRun=null,elgRun=null;
let _openItemsStore={},_openMcqStore={},_fbStore={},_openQStore={},_openSurfaceCfg={},_openPartResults={},_annotPadScores={},_openFinalized={},_openPhoto={};
const writes=[],notices=[],navigation=[];
const _isAdmin=()=>false,_canAuthor=()=>false;
const escapeHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const stripHtml=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim();
const stripHtmlToText=value=>new DOMParser().parseFromString(String(value||''),'text/html').body.textContent||'';
const qInSyllabus=q=>!q.notInSyllabus&&!/cell\\s*systems?/i.test([q.topic,q.topic2].join(' '));
const qAvailableToViewer=q=>!q.heldBack&&q.releaseOn!=='2999-01-01';
const qTopicList=q=>[q.topic,q.topic2].filter(Boolean),qHasKeywords=()=>false,qpFibOn=()=>false;
const normalizeCategoryValue=v=>v||'',qSecondaryTagsHtml=()=>'',showToast=(...args)=>notices.push(args);
const navigateTo=page=>navigation.push(page),rpgQuestionChanged=()=>{},loadAttemptStats=async()=>_qAttemptStats,preloadQueueImages=async()=>{};
const _scienceTcgSources=()=>[],tlStateOf=q=>q.testCheck||{state:'idle'},tlSig=q=>q.testSignature||'';
const _famPersistServingLevel=()=>{},applyStudentLevelCaps=()=>{};
const transformImageUrl=url=>url,imgSizeStyle=()=> 'max-width:70%;height:auto',handleImgError=()=>{},_scheduleImgWait=()=>{},imgWaitBarHtml=()=>'';
const qHasParts=()=>false,qPartMap=()=>null,qPartOf=()=>'',qPartLabel=p=>p,qBlockOpensKey=()=>'',qPartBodyHtml=b=>b.content||'';
const _qpTextHtml=(part,body)=>'<div class="qp-qtext">'+(part?'<b>'+escapeHtml(part)+'</b> ':'')+(body||'')+'</div>';
const _resetOpenScienceCoaches=()=>{},openPhotoBarHtml=()=>'',_partActionsHtml=()=>'',generatePracticeFeedback=()=>{};
const _openSection=(items,label,model,bg,fg,selector,source)=>{items.push({label,model,block:source.block,field:source.field});return '<label>'+escapeHtml(label)+'<textarea class="open-answer"></textarea></label>';};
const questionHasMarkableAnswer=q=>(q.blocks||[]).some(b=>['answer','plainanswer','mcq','workingSpace','openLines'].includes(b.type));
const COMMON_MISTAKE_COLORS={teal:'#15837b'},_wsBlockLines=(value,fallback)=>Number(value)||fallback;
const _htmlPlainText=stripHtmlToText,db={},_qRef=id=>id,setDoc=async(...args)=>writes.push(args);
const qpMarkServed=id=>_scienceFeedMark(id),resetQpOpenAnswers=()=>{},openFlagDialog=()=>{};
${feed}
${functions}
Object.assign(window,{loadNextQpQuestion,markMcqChoice,resetQpOpenAnswers,openFlagDialog,navigateTo});
window.feedFixture={
 setup(bank,level='P4',name='Learner'){questionBank=structuredClone(bank);child={name,level};currentUser={uid:'fixture-family',name,role:'student',level,adminLevel:'P6'};localStorage.clear();_qAttemptStats={};_qAttemptStatsUid=_scienceFeedKey();_scienceFeedIdentity='';_scienceFeedImageFailures=new Map();qpQueue=[];qpIndex=-1;qpSessionResults=[];qpAnswered=0;_openQStore={};_openItemsStore={};_openMcqStore={};_openSurfaceCfg={};_openPartResults={};_openFinalized={};_scienceFeedRefreshFrames();document.getElementById('qpContainer').innerHTML='';document.getElementById('qpLevelSelect').value=level||'P6';},
 start:()=>startQuickPractice(),next:()=>loadNextQpQuestion(),finish:()=>_qpAllPartsMarked({score:1,total:1,mistakes:[]}),
 state:()=>({id:_openQStore['#qpContainer']?.id||null,queue:qpQueue.map(q=>q.id),index:qpIndex,level:_scienceFeedLevel(),key:_scienceFeedKey(),writes:writes.length,notices,navigation,history:_scienceFeedStoreRead('history')}),
 plan:(manual=false)=>_scienceFeedPlan(questionBank,{manual}).questions.map(q=>q.id),
 direct:id=>{document.getElementById('qpContainer').innerHTML=buildOpenBody(questionBank.find(q=>q.id===id),'#qpContainer',{});},
 switchChild(name,level){child={name,level};famApplyActiveStudent();},
 gamePool:()=>_scienceFeedGameRows(_tcgBankQuestions()).map(q=>q.id),
 gameHtml:id=>_tcgBankQuestions().find(q=>q.id===id),
 report:id=>_scienceFeedFlagOwn(id,questionQualitySignature(questionBank.find(q=>q.id===id))),
 remember:(id,score,total)=>_scienceFeedRememberResult(id,score,total),
 failed:()=>[..._scienceFeedImageFailures.keys()],
 invalidate:()=>_scienceFeedRefreshFrames()
};window.ready=true;
</script></body></html>`;
await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!=='https://science-feed.test'){network.push(u.origin);return route.abort();}
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:fixture});
  const file=u.pathname.slice(1);
  if(moduleFiles.has(file))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,file),'utf8')});
  return route.fulfill({status:404,body:'Fixture image unavailable'});
});
const q=(id,{level='P4',title='Question '+id,stem='Explain observation '+id+'.',blocks,...extra}={})=>({id,level,title,topic:'Plant Systems',category:'Explanation',status:'approved',blocks:blocks||[
  {id:'stem',type:'text',content:'<p>'+stem+'</p>'},{id:'choices',type:'mcq',correctId:'o1',options:[{id:'o1',text:'The roots take in water.'},{id:'o2',text:'The roots release light.'}]}],...extra});
const setup=async(bank,level='P4',name='Learner')=>{await page.goto('https://science-feed.test/');await page.waitForFunction(()=>window.ready);await page.evaluate(({bank,level,name})=>feedFixture.setup(bank,level,name),{bank,level,name});};
const state=()=>page.evaluate(()=>feedFixture.state());
const shot=async name=>{const dir=process.env.SCIENCE_FEED_SCREENSHOTS;if(dir){fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,name+'.png'),fullPage:true});}};
let passed=0;const pass=name=>{passed++;console.log('PASS Science browser: '+name);};
try{
  const bank=[q('p6',{level:'P6'}),q('p5',{level:'P5'}),q('p4'),q('fresh',{stem:'Compare the two plants.'})];
  await setup(bank,'');await page.evaluate(()=>feedFixture.start());
  assert.match(await page.locator('#qpContainer').innerText(),/Choose your current school level/);
  assert.equal(await page.locator('#qpContainer input[type=radio]').count(),0);assert.equal((await state()).writes,0);
  pass('missing school level prevents practice');

  await setup(bank);await page.evaluate(()=>feedFixture.start());
  assert.equal((await state()).id,'p4');assert.deepEqual((await state()).queue,['p4','fresh']);
  assert.equal(await page.locator('#qpContainer input[type=radio]').count(),2);
  await page.locator('#qpContainer input[type=radio]').first().check();
  assert.equal(await page.locator('#qpContainer input[type=radio]').first().isChecked(),true);
  await shot('p4-level-matched');pass('P4 selects real eligible questions and renders working choices');

  await page.evaluate(()=>feedFixture.direct('p6'));
  assert.match(await page.locator('#qpContainer').innerText(),/Practice paused/);assert.equal(await page.locator('#qpContainer input[type=radio]').count(),0);
  pass('direct rendering cannot bypass P4 school ceiling');

  await setup(bank);await page.evaluate(()=>feedFixture.start());await page.evaluate(()=>feedFixture.finish());await page.locator('#qpNextBtn').click();
  assert.equal((await state()).id,'fresh');await page.evaluate(()=>feedFixture.finish());await page.locator('#qpNextBtn').click();
  assert.match(await page.locator('#qpContainer').innerText(),/Practice Complete/);assert.deepEqual(await page.evaluate(()=>feedFixture.plan()),[]);
  pass('Next exhausts suitable work without repeating a served question');

  const first=q('copy-a',{title:"Casey's Garden",stem:'Compare plant A and plant B.'});
  const copy=structuredClone(first);copy.id='exact-copy';copy.title='Copied elsewhere';
  const variant=q('variant',{title:"Casey's Garden",stem:'Compare plant C and plant D.'});
  await setup([first,copy,variant,q('other',{stem:'Explain how heat passes through the metal.'})]);
  await page.evaluate(()=>feedFixture.start());
  assert.equal((await state()).id,'copy-a');assert.deepEqual(await page.evaluate(()=>feedFixture.gamePool()),['other']);
  pass('exact copies and story variants remain spaced across practice and games');

  await setup([q('suspect',{importWarning:'The crop needs review.'}),q('broken',{blocks:[]})]);await page.evaluate(()=>feedFixture.start());
  assert.equal(await page.locator('#qpContainer input[type=radio]').count(),0);assert.match(await page.locator('#qpContainer').innerText(),/No suitable fresh questions/);
  pass('suspect-only and malformed pools pause without fallback');

  await setup(bank,'P6','Older child');await page.evaluate(()=>feedFixture.start());assert.equal((await state()).id,'p6');
  await page.evaluate(()=>feedFixture.switchChild('Younger child','P4'));
  assert.equal((await state()).id,null);assert.deepEqual((await state()).queue,[]);assert.equal(await page.locator('#qpContainer input[type=radio]').count(),0);
  await page.evaluate(()=>{document.getElementById('qpLevelSelect').value='P6';return feedFixture.start();});
  assert.equal((await state()).id,'p4');assert.equal((await state()).level,'P4');
  await shot('sibling-p4-reset');pass('sibling change discards the older child’s displayed question and stale queue');

  await setup([q('reported'),q('other')]);await page.evaluate(()=>feedFixture.report('reported'));
  assert.deepEqual(await page.evaluate(()=>feedFixture.plan()),['other']);
  await page.evaluate(()=>feedFixture.switchChild('Sibling','P4'));
  assert.deepEqual(await page.evaluate(()=>feedFixture.plan()),['reported','other']);
  pass('reports and served state are scoped to the child sharing the account');

  const context=q('context',{title:'Fruit F',blocks:[{id:'s',type:'text',content:'<p>Use the table and Jo’s answer to explain how animals find fruit F.</p>'},
    {id:'t',type:'table',rows:2,cols:2,data:[['Colour','Dull green'],['Smell','Strong']]},
    {id:'sample',type:'studentAnswer',label:"Jo's answer",answer:'Animals find it easily by its bright colour.'},
    {id:'c',type:'mcq',correctId:'a',options:[{id:'a',text:'Its smell helps animals find the camouflaged fruit.'},{id:'b',text:'Its dull-green colour is easy to see.'}]}]});
  await setup([context]);await page.evaluate(()=>feedFixture.start());
  assert.equal(await page.locator('#qpContainer table').count(),1);assert.match(await page.locator('#qpContainer').innerText(),/Dull green.*Strong/s);
  assert.match(await page.locator('#qpContainer').innerText(),/bright colour/);
  const row=await page.evaluate(()=>feedFixture.gameHtml('context'));
  assert.ok(row);assert.match(row.html,/<table/);assert.match(row.html,/Dull green/);assert.match(row.html,/bright colour/);
  await shot('diagram-context-table');pass('practice and game extraction preserve table and quoted-response context');

  const scientific=q('gas',{blocks:[{id:'s',type:'text',content:'Choose the correctly written formula.'},{id:'c',type:'mcq',correctId:'a',options:[{id:'a',text:'CO<sub>2</sub>'},{id:'b',text:'CO2'}]}]});
  await setup([scientific]);const scienceRow=await page.evaluate(()=>feedFixture.gameHtml('gas'));
  assert.ok(scienceRow.optsHtml);assert.match(scienceRow.optsHtml[0],/<sub>2<\/sub>/);pass('game options preserve scientific subscript distinctions');

  const imageQuestion=q('image',{blocks:[{id:'s',type:'text',content:'Use the labelled diagram.'},{id:'t',type:'table',rows:1,cols:1,data:[['<img src="/missing-diagram.png" alt="Experiment A">']]},{id:'c',type:'mcq',correctId:'a',options:[{id:'a',text:'A'},{id:'b',text:'B'}]}]});
  await setup([imageQuestion]);await page.evaluate(()=>feedFixture.start());await page.waitForFunction(()=>feedFixture.failed().includes('image'));
  assert.deepEqual(await page.evaluate(()=>feedFixture.plan()),[]);pass('observed relative-URL diagram failure inside a table blocks later feeding');

  await setup([context]);await page.evaluate(()=>feedFixture.start());await page.setViewportSize({width:375,height:850});
  assert.equal(await page.locator('#qpContainer table').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot('mobile-context');
  pass('real question layout keeps context readable on a narrow screen');

  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert.equal((await state()).writes,0);
  console.log(`${passed} Science feeding browser scenarios passed without AI calls or Firebase writes.`);
}finally{await browser.close();}
