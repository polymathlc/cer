import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath,pathToFileURL}from'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const moduleName=process.env.PLAYWRIGHT_MODULE;
const {chromium}=await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? {channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL} : {})});
const files=['science-defenders.html','science-raiders.html','science-legends.html','science-slayers.html','science-spire.html'];
try{for(const file of files){
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='science-feed.test')return route.abort();
 if(u.pathname==='/host'){return route.fulfill({contentType:'text/html',body:`<!doctype html><script>window.feedKey='child-p4';window.feedLevel='P4';window.feedId='safe';window.feedReady=false;window.feedRecycled=false;window.requests=0;addEventListener('message',function(e){if(e.data.type==='SD_REQUEST_QUESTIONS'){window.requests++;e.source.postMessage({type:'SD_QUESTIONS',feedPolicyVersion:1,requestId:e.data.requestId,studentKey:window.feedKey,studentLevel:window.feedLevel,questions:window.feedReady?[{id:window.feedId,recycled:window.feedRecycled,q:'Which is a plant part?',html:'<p>Which is a plant part?</p>',topic:'Plant Systems',options:['Root','Wheel'],answer:0,explain:'Roots absorb water.',d:'normal'}]:[]},location.origin);}});</script><iframe id="game" style="width:100%;height:740px" src="/${file}"></iframe>`});}
 // Exercise the actual game and its repo-owned modules/art, not an obsolete
 // single-file dependency list. Network remains restricted to the test host.
 const filename=path.resolve(root,'.'+decodeURIComponent(u.pathname)),relative=path.relative(root,filename);
 if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!/^\.(?:html|js|mjs|css|png|webp|svg|woff2)$/.test(path.extname(filename))||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return route.abort();
 return route.fulfill({path:filename});});
 await page.goto('https://science-feed.test/host');const frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForFunction(()=>typeof scienceFeed!=='undefined');
 await page.waitForFunction(()=>requests>0);
 assert.equal(await frame.evaluate(()=>typeof QBANK!=='undefined'?QBANK.length:QUESTION_BANK.length),0,'startup delivers an empty bank while the portal loads');
 await page.evaluate(()=>{window.feedReady=true;});
 await frame.waitForFunction(()=>typeof QBANK!=='undefined'?QBANK.some(q=>q.id==='safe'):QUESTION_BANK.some(q=>q.id==='safe'));
 assert.ok(await page.evaluate(()=>requests>=2),'empty startup automatically requests the loaded bank');
 const first=await frame.evaluate(()=>{const q=pickQuestion();window.oldScienceQuestion=q;return q&&q.id;});assert.equal(first,'safe');
 const second=await frame.evaluate(async()=>{await scienceFeed.refresh();return pickQuestion();});assert.equal(second,null,'fresh request must not repeat an ID');
 await page.evaluate(()=>{window.feedRecycled=true;});
 for(let round=0;round<5;round++){assert.equal(await frame.evaluate(async()=>{await scienceFeed.refresh();return pickQuestion()?.id;}),'safe','the portal-authorized endless cycle keeps feeding a one-question bank');}
 await page.evaluate(()=>{window.feedRecycled=false;});
 await page.evaluate(()=>{window.feedKey='child-p3';window.feedLevel='P3';window.feedId='young';document.getElementById('game').contentWindow.postMessage({type:'SD_FEED_INVALIDATE',studentKey:feedKey,studentLevel:feedLevel},location.origin);});
 await frame.waitForFunction(()=>scienceFeed.context().studentKey==='child-p3');assert.equal(await frame.evaluate(()=>scienceFeed.current(window.oldScienceQuestion)),false);
 const next=await frame.evaluate(async()=>{await scienceFeed.refresh();return pickQuestion()?.id;});assert.equal(next,'young');
 assert.deepEqual(errors,[],file+' has no browser errors');console.log('PASS iframe browser '+file+': empty-startup recovery, five endless cycles, no stale repeat, child invalidation');await page.close();
}}finally{await browser.close();}
