// Production preview, practice card, answer marking and app iframe, with the
// shipped CSS/overlay. Account writes and paid AI are isolated at their edges.
// Set WIDGET_PLAYWRIGHT_MODULE / WIDGET_BROWSER_EXECUTABLE if needed.
import assert from 'node:assert/strict';
import { mcqLabelSrc } from './mcq-labels-src.mjs';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'test-results', 'question-apps-preview');
fs.mkdirSync(output, { recursive: true });
const moduleName = process.env.WIDGET_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
function section(text, from, to) {
  const start = text.indexOf(from), end = text.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, 'Find production section: ' + from);
  return text.slice(start, end);
}
// App functions use column-zero closing braces; nested blocks are indented.
function fn(name) {
  const match = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(source);
  assert.ok(match, 'Find production function: ' + name);
  const firstEnd = source.indexOf('\n', match.index);
  const first = source.slice(match.index, firstEnd);
  if (first.trimEnd().endsWith('}')) return first;
  const end = source.indexOf('\n}', match.index);
  assert.ok(end > match.index, 'Find production function end: ' + name);
  return source.slice(match.index, end + 2);
}
const css = [...index.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');
const overlay = section(index, '<div class="preview-overlay" id="studentPreviewOverlay">', '<!-- ==================== CONFIRM DIALOG');
for (const name of ['previewAsStudent', 'previewStudentCompleted', 'renderStudentPreviewBody', 'closeStudentPreview']) {
  assert.match(source, new RegExp('window\\.' + name + '\\s*=\\s*' + name + '\\s*;'), name + ' is available to inline controls');
}
const functions = [
  'syncEditorDomToBlocks', 'previewAsStudent', 'clearStudentPreviewPads', 'renderStudentPreviewBody', 'previewStudentCompleted', 'closeStudentPreview',
  'renderPracticeCard', 'renderPracticeQuestion', 'renderOpenPracticeBody', 'buildOpenBody', '_qpTextHtml',
  '_openSection', '_partActionsHtml', '_adminAnswerToolHtml', '_isAdmin', 'micButtonHtml',
  'renderImportedBlockStudent', 'markMcqChoice', 'renderTableReadonly', 'ensureTableMigrated', '_tblCellCss',
  '_openPhotoKey', 'openPhotoBarHtml', '_imgWaitBarId', 'imgWaitBarHtml',
  '_annotPadId', '_workingPadSvgUrl', 'annotationPadHtml', '_annotLinkifyDiagramRefs',
  'markQuestionPart', '_mcqPaintResult', '_setPartResult', '_partMistakeOf', '_checkAllPartsMarked', '_genAndShowExplanation', 'recordCerPerformance',
  '_deriveModelAnswer', '_qAnswerDiagrams', '_qExplanationDiagrams', 'showExplanation'
].map(fn).join('\n');
const keywords = section(source, 'const KW_WORD_RE =', '// ---- rendering: the blanks a student fills in');
const annotation = section(source, 'function _scheduleAnnotInit(', '// Flatten diagram + pen strokes + text labels into a base64 JPEG for the AI.');
const clicks = section(source, "document.addEventListener('click', function (e) {\n  const take =", "document.addEventListener('change', function (e) {\n  const t = e.target;");
const fixtureCode = `
  let currentUser = { uid:'preview-author', role:'admin', name:'Teacher' };
  let blocks = [], editorKeywords = {}, selectedBlanks = {}, _studentPreviewQ = null;
  let _openItemsStore = {}, _openMcqStore = {}, _fbStore = {}, _openQStore = {}, _openSurfaceCfg = {};
  let _openPartResults = {}, _annotPadScores = {}, _openFinalized = {}, _openPhoto = {}, _annotPads = {};
  let currentPracticeQ = null, activeStudentIndex = 0, students = [{name:'Learner',level:'P5'}], practiceSessionResults = [];
  const fixtureToasts = [], fixtureWrites = [], fixtureRewards = [];
  const escapeHtml = value => QuestionApps.escapeHtml(value);
  const stripHtml = value => new DOMParser().parseFromString(String(value || ''), 'text/html').body.textContent.trim();
  const normalizeCategoryValue = value => value;
  const showToast = (...args) => fixtureToasts.push(args);
  const transformImageUrl = value => value, imgSizeStyle = () => 'max-width:100%;height:auto';
  const handleImgError = () => { throw new Error('Unexpected broken fixture image'); };
  const qHasParts = () => false, qPartMap = () => null, qPartOf = () => '', qPartLabel = part => part || '';
  const qBlockOpensKey = () => '', qPartBodyHtml = block => block.content || '';
  const _scheduleImgWait = () => {}, imgWaitStop = () => {};
  const _resetOpenScienceCoaches = () => {}, _captureScienceCoachTarget = () => null, _showScienceCoachFeedback = () => {};
  const wnyArm = () => {}, _scienceFeedAllowed = () => true, _scienceFeedRememberResult = () => {};
  const rpgOnMarked = (...args) => fixtureRewards.push(args);
  const addDoc = (...args) => { fixtureWrites.push(args); return Promise.resolve(); }, collection = (...args) => args, db = {};
  const Timestamp = {now:()=>0}, rpgAnswerFingerprint = () => 'fixture', _attemptAnswers = () => [];
  const noteAttemptLocally = () => {}, fcNoteMistakes = () => {};
  const _questionContext = q => q.title, aiGrounding = () => '';
  let explanationResolve = null, explanationTask = null;
  const askGemini = () => new Promise(resolve => { explanationResolve = resolve; });
  window.__aiReady = () => false;
  ${mcqLabelSrc(source)}
  ${keywords}
  ${annotation}
  ${functions}
  ${clicks}
  Object.assign(window, { previewAsStudent, previewStudentCompleted, renderStudentPreviewBody, closeStudentPreview, markMcqChoice });
  window.previewFixture = {
    setup(q, role='admin') {
      currentUser.role = role;
      blocks = structuredClone(q.blocks); editorKeywords = structuredClone(q.answerKeywords || {}); selectedBlanks = structuredClone(q.blanks || {});
      for (const [id, value] of Object.entries({ questionTitle:q.title, categorySelect:q.category, topicSelect:q.topic,
        questionMarkingGuide:q.markingGuide, questionAnswerKeyNote:q.answerKeyNote, questionAnswerKeyImage:q.answerKeyImage })) {
        document.getElementById(id).value = value || '';
      }
      document.getElementById('questionAnnotation').checked = !!q.annotation;
      document.getElementById('editorStem').dataset.blockId = q.blocks.find(b=>b.type==='text')?.id || '';
      document.getElementById('editorStem').innerHTML = q.blocks.find(b=>b.type==='text')?.content || '';
    },
    snapshot: () => structuredClone(_studentPreviewQ),
    state: () => ({writes:fixtureWrites.length,rewards:fixtureRewards.length,results:_openPartResults['#studentPreviewBody'],
      finalized:!!_openFinalized['#studentPreviewBody'],qPresent:!!_openQStore['#studentPreviewBody'],toasts:fixtureToasts,
      annotationStrokes:Object.values(_annotPads).reduce((sum,pad)=>sum+pad.strokes.length,0)}),
    mutateEditor() { blocks.find(b=>b.type==='widget').html='<p>Later unsaved edit</p>'; editorKeywords.answer={}; selectedBlanks.answer={}; },
    practice() { currentUser.role='student'; renderPracticeQuestion(structuredClone(_studentPreviewQ),students[0]); currentUser.role='admin'; },
    startPendingExplanation() { window.__aiReady=()=>true; explanationTask=_genAndShowExplanation('#studentPreviewBody',_studentPreviewQ,
      {'open:0':{student:'A response',expected:'A model',verdict:'correct'}},'studentPreviewResult'); },
    async resolveExplanation() { explanationResolve('Delayed explanation'); await explanationTask; window.__aiReady=()=>false; }
  };
  window.fixtureReady = true;
`;
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Student preview test</title><style>${css}</style><script src="/question-apps.js"></script></head><body>
  <main class="page active" id="page-create"><button id="openPreview" onclick="previewAsStudent()">Preview Question</button>
  <div hidden><input id="questionTitle"><input id="categorySelect"><input id="topicSelect"><textarea id="questionMarkingGuide"></textarea><textarea id="questionAnswerKeyNote"></textarea><input id="questionAnswerKeyImage"><input type="checkbox" id="questionAnnotation"><div class="content-editable" id="editorStem" data-field="content"></div></div></main>
  <div hidden id="practiceContainer"></div>${overlay}<script src="/fixture.js"></script></body></html>`;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') { response.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' }); response.end(fixture); return; }
  if (pathname === '/fixture.js') { response.writeHead(200, { 'Content-Type':'text/javascript; charset=utf-8' }); response.end(fixtureCode); return; }
  if (pathname === '/question-apps.js') { response.writeHead(200, { 'Content-Type':'text/javascript; charset=utf-8' }); response.end(fs.readFileSync(path.join(root,'question-apps.js'))); return; }
  response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const executablePath = process.env.WIDGET_BROWSER_EXECUTABLE || process.env.CHROME_PATH;
const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:process.platform==='win32'?{channel:'msedge'}:{})});
const results = [];
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" fill="#edf5fd"/><text x="18" y="54" font-size="18">A plant diagram</text></svg>');
const appHtml = `<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#edf5fd;color:#183753;font:16px system-ui}button{font:inherit;padding:10px}input{max-width:100%}label{display:block;margin:16px 0}</style></head><body><h1>Saved respiration lab</h1><label>Oxygen used <input aria-label="Oxygen used" type="range" min="0" max="10" value="0" oninput="document.getElementById('drop').textContent=this.value"></label><p>Drop moved: <output id="drop">0</output> mm</p><button onclick="document.getElementById('drop').textContent='0'">Reset lab</button></body></html>`;
const question = (extra = {}) => ({title:'Investigating respiration',category:'Explanation',topic:'Plant Systems',
  markingGuide:'Compare oxygen use.',answerKeyNote:'Use the oxygen reading.',answerKeyImage:image,
  answerKeywords:{answer:{0:true}},blanks:{answer:{0:true}},blocks:[
    {id:'stem',type:'text',content:'<p>Explain why the ink drop moves towards the seeds.</p>'},
    {id:'answer',type:'plainanswer',content:'Respiration uses oxygen.'},
    {id:'explanation',type:'explanation',content:'<p>The germinating seeds take in oxygen during respiration.</p>'},
    {id:'saved-app',type:'widget',title:'Saved oxygen experiment',html:appHtml,height:420}
  ],...extra});
async function setup(q = question(), mobile = false, role = 'admin') {
  const page = await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1365,height:1050}});
  page.setDefaultTimeout(10000);
  const errors = [], outbound = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    outbound.push(route.request().url()); return route.abort();
  });
  await page.goto(origin); await page.waitForFunction(() => window.fixtureReady);
  await page.evaluate(({q,role})=>previewFixture.setup(q,role),{q,role});
  await page.locator('#openPreview').click();
  await page.locator('#studentPreviewOverlay.active').waitFor();
  return {page,errors,outbound};
}
async function assertFits(page) {
  const sizes = await page.evaluate(() => {
    const panel=document.querySelector('#studentPreviewOverlay .preview-panel'),body=document.getElementById('studentPreviewBody');
    return {viewport:innerWidth,page:document.documentElement.scrollWidth,panelWidth:panel.clientWidth,panelScroll:panel.scrollWidth,bodyWidth:body.clientWidth,bodyScroll:body.scrollWidth};
  });
  assert.ok(sizes.page<=sizes.viewport+1 && sizes.panelScroll<=sizes.panelWidth+1 && sizes.bodyScroll<=sizes.bodyWidth+1, 'Preview fits the viewport: '+JSON.stringify(sizes));
}
async function run(name, test) {
  try { await test(); results.push({name,passed:true}); console.log('PASS',name); }
  catch (error) { results.push({name,passed:false,error:error.message}); console.error('FAIL',name,error.message); }
}
try {
  for (const mobile of [false,true]) {
    await run((mobile?'mobile':'desktop')+': student question, saved app, interaction and fresh reset',async()=>{
      const {page,errors,outbound}=await setup(question(),mobile);
      try {
        const body=page.locator('#studentPreviewBody');
        assert.match(await body.innerText(),/Explain why the ink drop moves/);
        assert.equal(await body.locator('textarea.open-answer').count(),1);
        assert.equal(await body.locator('.admin-ans-tool,.post-explanation,.question-app-frame').count(),0,'No answer key, admin tools or app before completion');
        assert.doesNotMatch(await body.innerText(),/Respiration uses oxygen/);
        await page.evaluate(()=>previewFixture.practice());
        assert.equal(await page.locator('#practiceContainer .practice-card-header').innerHTML(),await body.locator('.practice-card-header').innerHTML(),'Preview shares the practicing student header');
        const normalize=html=>html.replaceAll('#practiceContainer','#studentPreviewBody').replaceAll('practiceContainer','studentPreviewBody');
        assert.equal(normalize(await page.locator('#practiceContainer .practice-card-body').innerHTML()),await body.locator('.practice-card-body').innerHTML(),'Preview uses exactly the practicing student question/answer body');
        await body.locator('textarea.open-answer').fill('The seeds use oxygen.');
        await assertFits(page);
        await page.screenshot({path:path.join(output,mobile?'question-mobile.png':'question-desktop.png'),animations:'disabled'});
        await page.evaluate(()=>previewFixture.mutateEditor());
        await page.getByRole('button',{name:'Preview completed question',exact:true}).click();
        assert.match(await body.innerText(),/Explain why the ink drop moves/,'Question stays visible beside the completed content');
        assert.equal(await body.locator('textarea.open-answer').inputValue(),'The seeds use oxygen.');
        assert.equal(await body.locator('.post-explanation strong u').textContent(),'Respiration','Stored answer keywords reach the model answer');
        const iframe=body.locator('.question-app-frame');
        await iframe.scrollIntoViewIfNeeded();
        assert.equal(await iframe.getAttribute('title'),'Saved oxygen experiment');
        assert.equal(await iframe.getAttribute('sandbox'),'allow-scripts');
        assert.equal(await iframe.getAttribute('referrerpolicy'),'no-referrer');
        assert.equal(await iframe.evaluate(el=>el.style.height),'420px');
        const frame=page.frameLocator('#studentPreviewBody .question-app-frame');
        await frame.getByRole('heading',{name:'Saved respiration lab'}).waitFor();
        await frame.getByLabel('Oxygen used').fill('7');
        assert.equal(await frame.locator('#drop').textContent(),'7');
        await frame.getByRole('button',{name:'Reset lab',exact:true}).click();
        assert.equal(await frame.locator('#drop').textContent(),'0');
        await assertFits(page);
        await page.screenshot({path:path.join(output,mobile?'completed-mobile.png':'completed-desktop.png'),animations:'disabled'});
        await page.getByRole('button',{name:'Preview completed question',exact:true}).click();
        assert.equal(await iframe.count(),1,'Repeated completion does not duplicate the app');
        await body.getByRole('button',{name:'Reset',exact:true}).click();
        assert.equal(await body.locator('textarea.open-answer').inputValue(),'');
        assert.equal(await body.locator('.post-explanation,.question-app-frame,.admin-ans-tool').count(),0);
        const state=await page.evaluate(()=>previewFixture.state());
        assert.equal(state.writes,0); assert.equal(state.rewards,0); assert.equal(state.finalized,false);
        assert.deepEqual(errors,[]); assert.deepEqual(outbound,[]);
      } finally { await page.close(); }
    });
  }
  await run('normal MCQ Check answer reveals the saved app without an AI or student write',async()=>{
    const q=question(); q.blocks.splice(1,1,{id:'choices',type:'mcq',correctId:'oxygen',options:[{id:'oxygen',text:'The seeds use oxygen.'},{id:'light',text:'The seeds release light.'}]});
    const {page,errors,outbound}=await setup(q,false,'student');
    try {
      const body=page.locator('#studentPreviewBody');
      await body.locator('input[value="oxygen"]').check();
      assert.equal(await body.locator('.question-app-frame').count(),0,'Choosing an option does not reveal the app');
      await body.getByRole('button',{name:'✓ Check answer',exact:true}).click();
      await body.locator('.question-app-frame').waitFor();
      assert.match(await body.locator('.mcq-feedback').innerText(),/Correct answer/);
      assert.match(await body.locator('#studentPreviewResult').innerText(),/1\/1 \(100%\)/);
      const state=await page.evaluate(()=>previewFixture.state());
      assert.equal(state.finalized,true); assert.equal(state.writes,0); assert.equal(state.rewards,0);
      await body.getByRole('button',{name:'Reset',exact:true}).click();
      assert.equal(await body.locator('input:checked,.question-app-frame,.post-explanation').count(),0);
      assert.equal(await body.locator('#studentPreviewResult').innerText(),'');
      assert.deepEqual(errors,[]); assert.deepEqual(outbound,[]);
    } finally { await page.close(); }
  });
  await run('editor snapshot retains annotation, answer key, keywords and table content',async()=>{
    const q=question({annotation:true}); q.blocks.splice(1,0,{id:'figure',type:'image',url:image,dgnLabel:'Seeds'},{id:'results',type:'table',rows:1,cols:2,data:[['Time','Oxygen']]});
    const {page,errors}=await setup(q);
    try {
      const snapshot=await page.evaluate(()=>previewFixture.snapshot());
      for (const key of ['annotation','answerKeyNote','answerKeyImage','markingGuide','answerKeywords','blanks','blocks']) assert.deepEqual(snapshot[key],q[key],key+' survives preview snapshot');
      assert.equal(await page.locator('#studentPreviewBody .dgn-pad').count(),1,'Annotation image remains a student drawing area');
      assert.equal(await page.locator('#studentPreviewBody table td').last().textContent(),'Oxygen');
      assert.equal(await page.locator('#studentPreviewBody img[alt="Diagram explaining the answer"]').count(),0);
      await page.getByRole('button',{name:'Preview completed question',exact:true}).click();
      assert.equal(await page.locator('#studentPreviewBody img[alt="Diagram explaining the answer"]').getAttribute('src'),image);
      assert.deepEqual(errors,[]);
    } finally { await page.close(); }
  });
  await run('real pen annotations clear on Reset and after closing and reopening preview',async()=>{
    const q=question({annotation:true}); q.blocks.splice(1,0,{id:'figure',type:'image',url:image,dgnLabel:'Seeds'});
    const {page,errors}=await setup(q);
    const draw=async()=>{
      const canvas=page.locator('#studentPreviewBody .dgn-pad canvas');
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForFunction(()=>document.querySelector('#studentPreviewBody .dgn-pad')?._annotReady);
      const box=await canvas.boundingBox(); assert.ok(box && box.width>0 && box.height>0);
      await page.mouse.move(box.x+box.width*0.2,box.y+box.height*0.4); await page.mouse.down();
      await page.mouse.move(box.x+box.width*0.7,box.y+box.height*0.6,{steps:5}); await page.mouse.up();
      assert.equal((await page.evaluate(()=>previewFixture.state())).annotationStrokes,1,'The real pen stores the drawn stroke');
    };
    try {
      await draw();
      await page.locator('#studentPreviewBody').getByRole('button',{name:'Reset',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#studentPreviewBody .dgn-pad')?._annotReady);
      assert.equal((await page.evaluate(()=>previewFixture.state())).annotationStrokes,0);
      await draw();
      await page.evaluate(()=>closeStudentPreview());
      await page.locator('#openPreview').click();
      await page.waitForFunction(()=>document.querySelector('#studentPreviewBody .dgn-pad')?._annotReady);
      assert.equal((await page.evaluate(()=>previewFixture.state())).annotationStrokes,0);
      assert.deepEqual(errors,[]);
    } finally { await page.close(); }
  });
  for (const action of ['reset','close']) {
    await run('a pending explanation cannot restore completed content after '+action,async()=>{
      const {page,errors}=await setup();
      try {
        await page.evaluate(()=>previewFixture.startPendingExplanation());
        if(action==='reset') await page.locator('#studentPreviewBody').getByRole('button',{name:'Reset',exact:true}).click();
        else await page.evaluate(()=>closeStudentPreview());
        await page.evaluate(()=>previewFixture.resolveExplanation());
        assert.equal(await page.locator('#studentPreviewBody .post-explanation,#studentPreviewBody .question-app-frame').count(),0);
        if(action==='close') { assert.equal(await page.locator('#studentPreviewBody').innerHTML(),''); assert.equal((await page.evaluate(()=>previewFixture.state())).qPresent,false); }
        assert.deepEqual(errors,[]);
      } finally { await page.close(); }
    });
  }
} finally {
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
  await browser.close(); await new Promise(resolve=>server.close(resolve));
}
if(results.some(result=>!result.passed)) process.exitCode=1;
