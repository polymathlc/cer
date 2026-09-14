import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import http from 'node:http';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pw=process.env.PLAYWRIGHT_MODULE || 'playwright';
const {chromium}=await import(path.isAbsolute(pw)?pathToFileURL(pw).href:pw);
const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><iframe id="game" src="/frame.html"></iframe><script type="module">
import {installHadesLearningParent,sanitizeHadesQuestionHtml} from '/hades-learning-parent.js';
window.identity='admin:P6';window.records=[];window.marked=[];window.failures=[];window.unavailable=[];window.badImage=false;window.slowImage=false;window.unsupportedVisual='';
window.clean=sanitizeHadesQuestionHtml;
window.bridge=installHadesLearningParent({subject:'Science',getFrame:()=>document.getElementById('game'),getIdentity:()=>window.identity,isAllowed:()=>true,isActive:()=>true,
getQuestions:async()=>Array.from({length:5},(_,i)=>({id:'bank-'+i,topic:'Plant Systems',html:window.unsupportedVisual+'<p>Use label A and compare the dull green fruit with the bright red fruit.</p><table><tr><th>Fruit</th><th>Colour</th></tr><tr><td>A</td><td>Dull green</td></tr></table><img alt="Fruit diagram" src="'+(window.slowImage?'/slow.svg':window.badImage?'/missing.png':'/diagram.svg')+'"><p>Calculate <span class="math-frac"><span class="num">1</span><span class="den">2</span></span> of the examples.</p>',options:['It is bright.','It blends with leaves, so smell helps animals find it.','It has no seeds.','It has roots.'],answer:1,explainHtml:'<p>The diagram labels show that colour provides little contrast.</p>'})),
markShown:q=>window.marked.push(q.id),recordAnswer:r=>window.records.push(r),onImageFailure:(q,url)=>window.failures.push({id:q.id,url}),onQuestionUnavailable:(q,reason)=>window.unavailable.push({id:q.id,reason})});window.ready=true;
</script></body></html>`;
const pendingImages=[];
const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end(fixture);}
  else if(req.url==='/hades-learning-parent.js'){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(root,'hades-learning-parent.js')));}
  else if(req.url==='/frame.html'){res.setHeader('content-type','text/html');res.end('<!doctype html><script>window.messages=[];addEventListener("message",e=>messages.push(e.data));window.send=d=>parent.postMessage(d,location.origin);</script>');}
  else if(req.url==='/diagram.svg'){res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="110" viewBox="0 0 360 110"><path d="M25 75Q70 12 145 77" fill="none" stroke="#29583a" stroke-width="8"/><circle cx="95" cy="57" r="28" fill="#73846c"/><text x="155" y="65" font-size="25">A · dull green fruit</text></svg>');}
  else if(req.url==='/slow.svg'){pendingImages.push(res);}
  else{res.statusCode=404;res.end('Missing');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});
const errors=[];
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.ready);
  const frame=page.frames().find(f=>f.url().endsWith('/frame.html'));
  const send=d=>frame.evaluate(d=>window.send(d),d);
  async function hello(id){await send({type:'HADES_HELLO',requestId:id});await frame.waitForFunction(()=>messages.at(-1)?.type==='HADES_READY');return frame.evaluate(()=>messages.at(-1).sessionId);}
  let sessionId=await hello('browser-1');
  await send({type:'HADES_ROUND_REQUEST',requestId:'round-1',sessionId,round:1});
  await page.getByRole('dialog').waitFor();await page.waitForFunction(()=>!document.querySelector('.hades-learning-option').disabled);
  assert.equal(await page.locator('.hades-learning-stem table').count(),1);
  assert.equal(await page.locator('.hades-learning-stem img').getAttribute('alt'),'Fruit diagram');
  const geometry=await page.evaluate(()=>{
    const dialog=document.querySelector('.hades-learning-dialog').getBoundingClientRect();const num=document.querySelector('.num').getBoundingClientRect(),den=document.querySelector('.den').getBoundingClientRect();
    return{left:dialog.left,right:dialog.right,width:innerWidth,numY:num.y,denY:den.y,mathDisplay:getComputedStyle(document.querySelector('.math-frac')).display};});
  assert.ok(geometry.left>=0 && geometry.right<=geometry.width);assert.ok(geometry.denY>geometry.numY);assert.equal(geometry.mathDisplay,'inline-flex');
  const output=process.env.HADES_SCREENSHOTS;if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'science-sanctuary-mobile.png'),fullPage:true});}
  for(let i=0;i<5;i++){
    await page.locator('.hades-learning-option').nth(1).click();
    assert.equal(await page.locator('.hades-learning-option[data-correct=true]').count(),1);
    if(i===4)assert.match(await page.locator('.hades-learning-reward').textContent(),/Heroic: next scalable boon Lv 8, or Pom \+8 levels/);
    await page.getByRole('button',{name:i===4?'Claim sanctuary reward':'Next question',exact:true}).click();
  }
  await frame.waitForFunction(()=>messages.at(-1)?.type==='HADES_ROUND_RESULT');
  const result=await frame.evaluate(()=>messages.at(-1));assert.equal(result.correct,5);assert.equal(result.healPercent,40);assert.equal(result.boonTier,'heroic');
  assert.equal(await page.evaluate(()=>records.length),5);assert.equal(await page.getByRole('dialog').count(),0);
  await send({type:'HADES_ROUND_REQUEST',requestId:'round-retry',sessionId,round:1});
  await frame.waitForFunction(()=>messages.at(-1)?.requestId==='round-retry');assert.equal(await page.evaluate(()=>records.length),5);
  assert.equal(await frame.evaluate(()=>JSON.stringify(messages).includes('options')),false);
  // Exercise every real dialog score, including zero, with an idempotent replay.
  for(let score=0;score<5;score++){
    await page.evaluate(()=>{window.records=[];});sessionId=await hello('score-'+score);
    await send({type:'HADES_ROUND_REQUEST',requestId:'score-round-'+score,sessionId,round:1});
    await page.getByRole('dialog').waitFor();
    for(let i=0;i<5;i++){
      await page.locator('.hades-learning-option').nth(i<score?1:0).click();
      if(i===4){
        const summary=await page.locator('.hades-learning-reward').textContent();
        if(score===0){assert.match(summary,/0\/5 correct · No healing/);assert.match(summary,/tiny consolation only; no boon or Pom upgrade/);}
        else {assert.ok(summary.includes('Lv '+[0,1,2,3,5][score]));assert.ok(summary.includes('Pom +'+[0,1,2,3,5][score]));}
      }
      await page.getByRole('button',{name:i===4?'Claim sanctuary reward':'Next question',exact:true}).click();
    }
    await frame.waitForFunction(()=>messages.at(-1)?.type==='HADES_ROUND_RESULT');
    const scored=await frame.evaluate(()=>messages.at(-1));
    assert.equal(scored.correct,score);assert.equal(scored.healPercent,score*8);assert.equal(scored.boonTier,['fractured','common','uncommon','rare','epic'][score]);
    await send({type:'HADES_ROUND_REQUEST',requestId:'score-retry-'+score,sessionId,round:1});
    await frame.waitForFunction(id=>messages.at(-1)?.requestId===id,'score-retry-'+score);assert.equal(await page.evaluate(()=>records.length),5);
  }
  const sanitized=await page.evaluate(()=>clean('<img src="javascript:alert(1)" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">label</a><span class="math-frac arbitrary" aria-label="one half" style="position:fixed;background-image:url(https://evil.test/x)"><span class="num">1</span><span class="den">2</span></span>'));
  assert.doesNotMatch(sanitized,/javascript:|onerror|<script|position:|background-image|arbitrary/);assert.match(sanitized,/math-frac/);assert.match(sanitized,/aria-label="one half"/);
  // Broken essential diagrams stop all options, flag the real bank id and let
  // the player return without receiving a healing/upgrade result.
  await page.evaluate(()=>{window.badImage=true;});sessionId=await hello('browser-2');
  await send({type:'HADES_ROUND_REQUEST',requestId:'broken',sessionId,round:1});
  await page.locator('.hades-learning-warning:not([hidden])').waitFor();
  assert.equal(await page.locator('.hades-learning-option:disabled').count(),4);assert.equal(await page.evaluate(()=>failures.length),1);
  await page.getByRole('button',{name:'Return to game',exact:true}).click();await frame.waitForFunction(()=>messages.at(-1)?.type==='HADES_ROUND_BLOCKED');assert.equal(await page.evaluate(()=>records.length),5);
  await page.evaluate(()=>{window.badImage=false;window.slowImage=true;});sessionId=await hello('browser-3');
  await send({type:'HADES_ROUND_REQUEST',requestId:'invalidate',sessionId,round:1});await page.getByRole('dialog').waitFor();
  await page.evaluate(()=>{window.retiredImage=document.querySelector('.hades-learning-stem img');window.identity='other:P3';bridge.invalidate('Changed account');});
  assert.equal(await page.getByRole('dialog').count(),0);await frame.waitForFunction(()=>messages.at(-1)?.type==='HADES_INVALIDATE');
  await page.evaluate(()=>retiredImage.dispatchEvent(new Event('error')));
  assert.equal(await page.evaluate(()=>failures.length),1,'late detached-image failure cannot flag a question for the next account');
  const unsupported=['<svg><circle cx="20" cy="20" r="10"/></svg>','<math><mi>x</mi></math>','<iframe title="Essential diagram" src="/diagram.svg"></iframe>'];
  for(let i=0;i<unsupported.length;i++){
    await page.evaluate(visual=>{window.slowImage=false;window.unsupportedVisual=visual;},unsupported[i]);sessionId=await hello('unsupported-'+i);
    await send({type:'HADES_ROUND_REQUEST',requestId:'visual-'+i,sessionId,round:1});
    await page.locator('.hades-learning-warning:not([hidden])').waitFor();
    assert.match(await page.locator('.hades-learning-warning').textContent(),/cannot be displayed safely/);
    assert.equal(await page.locator('.hades-learning-option:disabled').count(),4);
    assert.equal(await page.locator('.hades-learning-stem svg,.hades-learning-stem math,.hades-learning-stem iframe').count(),0);
    await page.getByRole('button',{name:'Return to game',exact:true}).click();await frame.waitForFunction(()=>messages.at(-1)?.type==='HADES_ROUND_BLOCKED');
  }
  assert.equal(await page.evaluate(()=>unavailable.length),3);assert.equal(await page.evaluate(()=>records.length),5);
  assert.deepEqual(errors,[]);console.log('Hades learning browser: all six reward scores and summaries, five questions, rich rendering, mobile, retries, missing/unsupported visuals and late account-change callbacks passed.');
}finally{pendingImages.forEach(response=>response.destroy());await browser.close();await new Promise(resolve=>server.close(resolve));}
