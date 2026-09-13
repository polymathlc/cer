import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL}from'node:url';
const moduleName=process.env.PLAYWRIGHT_MODULE;
const {chromium}=await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? {channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL} : {})});
const files=['science-defenders.html','science-raiders.html','science-legends.html','science-slayers.html','science-spire.html'];
try{for(const file of files){
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='science-feed.test')return route.abort();
 if(u.pathname==='/host'){return route.fulfill({contentType:'text/html',body:`<!doctype html><script>window.feedKey='child-p4';window.feedLevel='P4';window.feedId='safe';window.requests=0;addEventListener('message',function(e){if(e.data.type==='SD_REQUEST_QUESTIONS'){window.requests++;e.source.postMessage({type:'SD_QUESTIONS',feedPolicyVersion:1,requestId:e.data.requestId,studentKey:window.feedKey,studentLevel:window.feedLevel,questions:[{id:window.feedId,q:'Which is a plant part?',html:'<p>Which is a plant part?</p>',topic:'Plant Systems',options:['Root','Wheel'],answer:0,explain:'Roots absorb water.',d:'normal'}]},location.origin);}});</script><iframe id="game" style="width:100%;height:740px" src="/${file}"></iframe>`});}
 const name=u.pathname.slice(1);if(!files.concat('science-feed-bridge.js').includes(name))return route.abort();return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':'text/html',body:fs.readFileSync(new URL('../'+name,import.meta.url),'utf8')});});
 await page.goto('https://science-feed.test/host');const frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForFunction(()=>typeof scienceFeed!=='undefined');
 const first=await frame.evaluate(async()=>{await scienceFeed.refresh();const q=pickQuestion();window.oldScienceQuestion=q;return q&&q.id;});assert.equal(first,'safe');
 const second=await frame.evaluate(async()=>{await scienceFeed.refresh();return pickQuestion();});assert.equal(second,null,'fresh request must not repeat an ID');
 await page.evaluate(()=>{window.feedKey='child-p3';window.feedLevel='P3';window.feedId='young';document.getElementById('game').contentWindow.postMessage({type:'SD_FEED_INVALIDATE',studentKey:feedKey,studentLevel:feedLevel},location.origin);});
 await frame.waitForFunction(()=>scienceFeed.context().studentKey==='child-p3');assert.equal(await frame.evaluate(()=>scienceFeed.current(window.oldScienceQuestion)),false);
 const next=await frame.evaluate(async()=>{await scienceFeed.refresh();return pickQuestion()?.id;});assert.equal(next,'young');
 assert.deepEqual(errors,[],file+' has no browser errors');console.log('PASS iframe browser '+file+': live parent request, no repeat, child invalidation');await page.close();
}}finally{await browser.close();}
