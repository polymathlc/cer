import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const pw=process.env.PLAYWRIGHT_MODULE || 'playwright';
const {chromium}=await import(path.isAbsolute(pw)?pathToFileURL(pw).href:pw);
const root=fileURLToPath(new URL('..',import.meta.url));
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const adapter=app.slice(app.indexOf('var _hadesBridge = null;'),app.indexOf('function buildDefenderQuestions()'));
const markup=html.slice(html.indexOf('<div class="page" id="page-hades">'),html.indexOf('<!-- ===== PAGE: REALM OF EMBERS'));
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${markup}<script type="module">
import {installHadesDisplay} from './hades-display.js';import {installHadesLearningParent} from './hades-learning-parent.js';
window.currentUser={uid:'family',role:'student',level:'P6',name:'Older child'};window.records=[];window.shown=[];
const _isAdmin=()=>currentUser?.role==='admin',isLevelCode=l=>['P3','P4','P5','P6'].includes(l),TOPIC_LEVELS=['P3','P4','P5','P6'];
const _scienceFeedLevel=()=>currentUser.level,_scienceFeedKey=()=>currentUser.uid+':'+currentUser.name;
const questionBank=Array.from({length:10},(_,i)=>({id:'bank-'+i,title:'Science bank question '+i,html:'<p>Which part absorbs water?</p>',options:['Root','Leaf'],answer:0}));
const qReleased=()=>true,qInSyllabus=()=>true,questionQualitySignature=q=>q.id,_sdExtractMcq=q=>q;
const _scienceFeedContext=()=>({}),_scienceFeedPlan=rows=>({questions:rows.filter(q=>!shown.includes(q.id)).slice(0,5)});
const _scienceFeedMark=id=>shown.push(id),_scienceFeedRememberResult=()=>{},_scienceFeedImageResult=()=>{};
const _sdRecordAttempt=row=>records.push({...row,learner:currentUser.name});
${adapter}
document.getElementById('page-hades').classList.add('active');_hadesInit();window.closeGame=()=>_hadesResetLearning();window.ready=true;
</script>`;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('content-type','text/html');res.end(fixture);}
 else if(pathname==='/hades-game.html'){res.setHeader('content-type','text/html');res.end('<script>window.messages=[];addEventListener("message",e=>messages.push(e.data));window.send=d=>parent.postMessage(d,location.origin);</script>');}
 else if(['/hades-display.js','/hades-learning-parent.js'].includes(pathname)){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(root,pathname.slice(1))));}
 else res.writeHead(404).end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
 const frame=page.frames().find(f=>f.url().includes('hades-game.html'));
 await frame.waitForFunction(()=>window.send);
 assert.equal(await page.locator('#hadesPreviewLevel').isDisabled(),true);
 assert.match(await page.locator('#hadesPreviewNote').textContent(),/BETA · P6/);
 await frame.evaluate(()=>send({type:'HADES_HELLO',requestId:'student'}));await frame.waitForFunction(()=>messages.at(-1)?.type==='HADES_READY');
 const session=await frame.evaluate(()=>messages.at(-1).sessionId);
 await page.locator('#hadesFullscreen').click();
 await frame.evaluate(sessionId=>send({type:'HADES_ROUND_REQUEST',requestId:'round',round:1,sessionId}),session);
 await page.getByRole('dialog').waitFor();
 for(let i=0;i<5;i++){await page.locator('.hades-learning-option').first().click();await page.getByRole('button',{name:i===4?'Claim sanctuary reward':'Next question',exact:true}).click();}
 await frame.waitForFunction(()=>messages.at(-1)?.type==='HADES_ROUND_RESULT');
 assert.equal(await page.evaluate(()=>records.length),5);assert.equal(await page.evaluate(()=>records.every(r=>r.mode==='hades' && r.learner==='Older child')),true);
 assert.equal(await frame.evaluate(()=>messages.at(-1).healPercent),40);
 await page.evaluate(()=>{currentUser.name='Younger child';currentUser.level='P4';closeGame();});
 await page.waitForFunction(()=>!document.fullscreenElement);
 assert.equal(await page.locator('#hadesFrame').getAttribute('src'),null);assert.deepEqual(errors,[]);
 console.log('Science student beta: automatic launch, fixed profile level, fullscreen sanctuary, five recorded answers and profile cleanup passed.');
}finally{await browser.close();server.close();}
