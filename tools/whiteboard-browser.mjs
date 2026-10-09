// Shipped whiteboard page, controller, styles, public viewer and sandbox in
// Chromium. Source bank, assignments, storage and AI are loopback fixtures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {newWhiteboard,createWhiteboardCard,whiteboardPublicSnapshot} from '../whiteboard-core.mjs';
import {whiteboardSnapshotBytes,whiteboardDigest,whiteboardViewerUrl} from '../whiteboard-share.mjs';
import {questions,appSuggestion} from './whiteboard-fixtures.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const executablePath=process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const output=process.env.WHITEBOARD_QA_DIR||fileURLToPath(new URL('../../whiteboard-qa/',import.meta.url));fs.mkdirSync(output,{recursive:true});
const root=fileURLToPath(new URL('../',import.meta.url)),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=[...html.slice(0,html.indexOf('</head>')).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match=>match[1]).join('\n');
const start=html.indexOf('<div class="page" id="page-whiteboards">'),end=html.indexOf('<div class="page" id="page-myworksheets">',start);
assert.ok(start>=0&&end>start,'Shipped whiteboard portal page exists');const markup=html.slice(start,end).replace('class="page"','class="page active"');
const scriptFiles=['whiteboards.js','whiteboard-core.mjs','whiteboard-share.mjs','whiteboard-viewer.js','question-apps.js','tools/whiteboard-fixtures.mjs'];
const files=new Map(scriptFiles.map(name=>['/'+name,fs.readFileSync(path.join(root,name),'utf8')]));
const bootstrap=`
 import {installWhiteboards} from '/whiteboards.js';
 import {questions,teacher,student,appSuggestion,deferred} from '/tools/whiteboard-fixtures.mjs';
 import {whiteboardSnapshotBytes,whiteboardDigest,whiteboardViewerUrl} from '/whiteboard-share.mjs';
 const parameters=new URLSearchParams(location.search),role=parameters.get('role')||'admin',level=parameters.get('level')||'P5';
 const h=window.qa={user:role==='student'?student():teacher(),authUid:role==='student'?'student-1':'teacher-1',level,profile:role+':'+level,bank:questions(),models:[],writes:[],shares:[],assignments:[],attempts:[],prints:[],messages:[]};
 h.original=structuredClone(h.bank);window.hostCompromised=0;window.toggleSidebar=()=>{};
 const stored=()=>JSON.parse(localStorage.getItem('wb-fixture-boards')||'[]'),assignments=()=>JSON.parse(localStorage.getItem('wb-fixture-assignments')||'[]');
 h.tool=installWhiteboards({document,getUser:()=>h.user,getAuthUid:()=>h.authUid,getProfileKey:()=>h.profile,canAuthor:()=>h.user.role==='admin',canAssign:()=>h.user.role==='admin',getBank:()=>h.bank,
   isQuestionEligible:q=>!q.excluded,questionTopics:q=>[q.topic,q.topic2].filter(Boolean),getLevels:()=>['P3','P4','P5','P6','S1'],
   prepareQuestion:async q=>q,loadBoards:async()=>stored(),loadReceivedBoards:async()=>assignments().filter(entry=>entry.levels.includes(h.level)).map(entry=>entry.board),
   saveBoard:async(board,context)=>{if(!context.guard())return false;h.writes.push(structuredClone(board));localStorage.setItem('wb-fixture-boards',JSON.stringify([board,...stored().filter(old=>old.id!==board.id)]));return true;},
   deleteBoard:async(id,context)=>{if(!context.guard())return false;localStorage.setItem('wb-fixture-boards',JSON.stringify(stored().filter(board=>board.id!==id)));return true;},
   generateApp:async request=>{h.models.push(structuredClone(request));if(h.modelMode==='deferred'){h.modelGate=deferred();return h.modelGate.promise;}return appSuggestion();},
   shareBoard:async(board,context)=>{if(!context.guard())return false;const bytes=whiteboardSnapshotBytes(board),id=await whiteboardDigest(bytes);const url=whiteboardViewerUrl(id,'a682dbff-24e7-421a-bd63-4b512ac409a1');h.shares.push({url,board:structuredClone(board)});return {url};},
   assignBoard:async(board,levels,context)=>{if(!context.guard())return false;const entry={board:structuredClone(board),levels};h.assignments.push(entry);localStorage.setItem('wb-fixture-assignments',JSON.stringify([entry,...assignments().filter(old=>old.board.id!==board.id)]));return true;},
   practiceBoard:async(board,options)=>{h.attempts.push({board:structuredClone(board),options});return true;},
   printBoard:async request=>{h.prints.push(request);const tab=window.open('','_blank');if(!tab)return false;tab.opener=null;tab.document.write(request.html.replace(/<head>/i,'<head><base href="'+location.origin+'/">'));tab.document.close();return true;},
   imageUrl:value=>value,notify:(text,kind)=>h.messages.push({text,kind})
 });
 await h.tool.open();window.fixtureReady=true;
`;
let origin='';const publicPayloads=new Map();
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,origin||'http://127.0.0.1'),name=url.pathname;res.setHeader('Cache-Control','no-store');
 const send=(type,body,status=200)=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
 if(files.has(name))return send('text/javascript',files.get(name).replaceAll('https://whiteboard.test',origin));
 if(name==='/whiteboards.css')return send('text/css',fs.readFileSync(path.join(root,'whiteboards.css'),'utf8'));
 if(name==='/whiteboard.html')return send('text/html',fs.readFileSync(path.join(root,'whiteboard.html'),'utf8'));
 if(name.startsWith('/images/'))return send('image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" width="500" height="220" viewBox="0 0 500 220"><rect x="1" y="1" width="498" height="218" fill="#eaf2fb" stroke="#7895ad"/><text x="20" y="80" font-size="28">Question diagram</text></svg>');
 if(name==='/')return send('text/html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><link rel="stylesheet" href="/whiteboards.css"></head><body>'+markup+'<script src="/question-apps.js"></script><script type="module">'+bootstrap+'</script></body></html>');
 return send('text/plain','Unknown fixture route',404);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
const action=(page,name,id)=>page.locator('[data-wb-action="'+name+'"]'+(id?'[data-wb-id="'+id+'"]':''));
async function fixture(width){const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],outbound=[];page.on('pageerror',error=>errors.push(error.message));context.on('request',request=>{const url=request.url();if(!url.startsWith(origin)&&!url.startsWith('data:')&&!url.startsWith('about:'))outbound.push(url);});page.on('dialog',dialog=>dialog.accept());await page.goto(origin+'/');await page.waitForFunction(()=>window.fixtureReady);return {context,page,errors,outbound};}
async function waitSaved(page){await page.waitForFunction(()=>!qa.tool.state().saving&&!qa.tool.state().dirty);}
async function waitPrintImages(page){
 await page.locator('img').evaluateAll(images=>{images.forEach(img=>{img.loading='eager';});});
 try{await page.waitForFunction(()=>[...document.images].every(img=>img.complete),{},{timeout:12000,polling:100});}catch(error){console.log('Print image timeout '+JSON.stringify(await page.locator('img').evaluateAll(images=>images.map(img=>({src:img.src,loading:img.loading,complete:img.complete,width:img.naturalWidth})))));throw error;}
 await page.locator('img').evaluateAll(images=>Promise.all(images.map(img=>img.naturalWidth&&img.decode?img.decode().catch(()=>{}):Promise.resolve())));
 const images=await page.locator('img').evaluateAll(images=>images.map(img=>({src:img.src,width:img.naturalWidth,height:img.naturalHeight})));
 assert.ok(images.length>0&&images.every(img=>img.width>0&&img.height>0),'Every question diagram loads before worksheet PDF: '+JSON.stringify(images));
}
const results=[];
try{
 for(const width of [1280,900,390]){
  const f=await fixture(width),{page}=f;
  try{
   await page.locator('#wbTitle').fill('Heat and light lesson');await page.locator('[data-wb-pick="heat-1"]').check();await action(page,'addSelected').click();await page.waitForFunction(()=>qa.tool.state().draft.cards.length===1);
   await page.locator('#wbTopic').selectOption('Light');await action(page,'add','light-1').click();await page.waitForFunction(()=>qa.tool.state().draft.cards.length===2);
   const id=await page.evaluate(()=>qa.tool.state().draft.cards[0].id);assert.equal(await page.locator('.wb-card').count(),2);
   const before=await page.evaluate(()=>qa.tool.state().draft.cards[0]);await page.locator('#wbCanvas').scrollIntoViewIfNeeded();const handle=await page.locator('#wbHandle_'+id).boundingBox();
   await page.mouse.move(handle.x+20,handle.y+20);await page.mouse.down();await page.mouse.move(handle.x+100,handle.y+65,{steps:6});await page.mouse.up();
   const dragged=await page.evaluate(()=>qa.tool.state().draft.cards[0]);assert.ok(Math.abs(dragged.x-before.x-80)<2&&Math.abs(dragged.y-before.y-45)<2,'Pointer drag changes world positions '+JSON.stringify({before:{x:before.x,y:before.y},dragged:{x:dragged.x,y:dragged.y},handle,width}));
   await page.locator('#wbHandle_'+id).focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>qa.tool.state().draft.cards[0].x),dragged.x-20,'Keyboard header movement is available');
   const oldView=await page.evaluate(()=>qa.tool.state().draft.view),canvas=await page.locator('#wbCanvas').boundingBox();await page.mouse.move(canvas.x+10,canvas.y+10);await page.mouse.down();await page.mouse.move(canvas.x+40,canvas.y+30,{steps:4});await page.mouse.up();
   const panned=await page.evaluate(()=>qa.tool.state().draft.view);assert.ok(panned.x!==oldView.x||panned.y!==oldView.y,'Background drag pans the canvas');
   await action(page,'zoomOut').click();assert.ok(await page.evaluate(()=>qa.tool.state().draft.view.zoom)<1);await action(page,'fit').click();
   await action(page,'save').click();await waitSaved(page);const expected=await page.evaluate(()=>qa.tool.state().draft);await page.reload();await page.waitForFunction(()=>window.fixtureReady);await action(page,'select',expected.id).click();assert.deepEqual(await page.evaluate(()=>qa.tool.state().draft),expected,'Canvas position, zoom, name and complete questions survive reopen');
   const documentWidth=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert.ok(documentWidth.scroll<=documentWidth.width+1,'Page controls fit the viewport');
   await action(page,'app',id).click();await page.locator('#wbAppTitle').fill('Pasted helper');
   const pasted='<h2>Sandbox activity</h2><button id="try">Try</button><output id="answer">Ready</output><script>document.getElementById("try").onclick=()=>document.getElementById("answer").textContent="Answer prepared";try{parent.hostCompromised=1}catch(e){window.parentBlocked=true}try{localStorage.setItem("escaped","1")}catch(e){window.storageBlocked=true}fetch("https://untrusted.invalid/escape").catch(()=>window.networkBlocked=true)</script>';
   await page.locator('#wbAppCode').fill(pasted);await action(page,'previewApp').click();const frame=page.frameLocator('.wb-app-preview iframe');await frame.locator('#try').click();assert.equal(await frame.locator('#answer').innerText(),'Answer prepared');
   const iframe=page.locator('.wb-app-preview iframe');assert.equal(await iframe.getAttribute('sandbox'),'allow-scripts');const isolation=await iframe.evaluate(async el=>{try{return el.contentWindow.localStorage.getItem('escaped')}catch{return 'opaque';}});assert.equal(isolation,'opaque');assert.equal(await page.evaluate(()=>window.hostCompromised),0);assert.equal(f.outbound.length,0,'Sandbox CSP blocks app network requests');
   await action(page,'applyApp').click();assert.equal(await page.evaluate(()=>qa.tool.state().draft.cards[0].app.title),'Pasted helper');
   await action(page,'app',id).click();await page.locator('#wbAppInstruction').fill('Show cooling and explain the answer');await page.locator('#wbAppTokenLimit').fill('8192');await action(page,'generateApp').click();await action(page,'useGenerated').waitFor();
   assert.equal(await page.evaluate(()=>qa.tool.state().draft.cards[0].app.title),'Pasted helper','AI app stays pending during review');assert.equal(await page.evaluate(()=>qa.models[0].maxTokens),8192);await action(page,'useGenerated').click();assert.equal(await page.evaluate(()=>qa.tool.state().draft.cards[0].app.title),'Explore cooling');
   await page.locator('.wb-helper iframe').evaluate(el=>{el.loading='eager';});await page.frameLocator('.wb-helper iframe').locator('#cool').waitFor({state:'attached',timeout:12000});
   await action(page,'fit').click();await action(page,'save').click();await waitSaved(page);await page.locator('.wb-sharing > summary').click();await page.locator('[data-wb-level="P5"]').check();await action(page,'assign').click();await page.waitForFunction(()=>qa.assignments.length===1);assert.deepEqual(await page.evaluate(()=>qa.assignments[0].levels),['P5']);
   await action(page,'share').click();await page.locator('#wbShareUrl').waitFor();assert.match(await page.locator('#wbShareUrl').inputValue(),/^https:\/\/polymathlc.github.io\/cer\/whiteboard.html#id=[a-f0-9]{64}&token=/);
   await action(page,'practice').click();assert.equal(await page.evaluate(()=>qa.attempts.length),1);
   const popupPromise=page.waitForEvent('popup');await action(page,'print').click();const print=await popupPromise;await print.waitForLoadState('load');await waitPrintImages(print);assert.ok((await print.locator('body').innerText()).includes('Cooling water'));assert.ok(!(await print.locator('body').innerText()).includes('PRIVATE MODEL ANSWER'));await print.emulateMedia({media:'print'});await print.screenshot({path:path.join(output,'whiteboard-print-'+width+'.png'),fullPage:true});const pdf=await print.pdf({path:path.join(output,'whiteboard-worksheet-'+width+'.pdf'),format:'A4',printBackground:true});assert.ok(pdf.subarray(0,4).toString()==='%PDF','Actual worksheet PDF is generated');await print.close();
   await page.locator('.wb-helper iframe').evaluate(el=>{el.loading='eager';});await page.frameLocator('.wb-helper iframe').locator('#cool').waitFor({state:'attached',timeout:12000});await page.screenshot({path:path.join(output,'whiteboard-author-'+width+'.png'),fullPage:true});assert.deepEqual(await page.evaluate(()=>qa.bank),await page.evaluate(()=>qa.original));
   await page.goto(origin+'/?role=student&level=P5');await page.waitForFunction(()=>window.fixtureReady);assert.equal(await page.locator('.wb-card').count(),2,'Matching learner receives their teacher board');assert.equal(await action(page,'save').count(),0);assert.equal(await action(page,'app',id).count(),0);assert.equal(await action(page,'assign').count(),0);await action(page,'attempt',id).click();assert.equal(await page.evaluate(()=>qa.attempts[0].options.cardId),id);
   await page.screenshot({path:path.join(output,'whiteboard-student-'+width+'.png'),fullPage:true});await page.goto(origin+'/?role=student&level=P6');await page.waitForFunction(()=>window.fixtureReady);assert.equal(await page.locator('.wb-card').count(),0,'Other learner levels do not receive the board');
   assert.deepEqual(f.errors,[],'No page runtime errors');assert.equal(f.outbound.length,0);results.push({test:'author and student workflows',width,status:'passed'});console.log('Whiteboard author and student browser checks passed at '+width+'px');
  }catch(error){await page.screenshot({path:path.join(output,'whiteboard-failure-'+width+'.png'),fullPage:true}).catch(()=>{});throw error;}finally{await f.context.close();}
 }
 // Exercise the actual unauthenticated public viewer with tokenized storage
 // routed to a digest-verified snapshot, without reading any real Storage.
 const board=newWhiteboard({title:'Public heat lesson',createdBy:'teacher-1'}),publicQuestion=questions()[0];for(const block of publicQuestion.blocks)if(block.type==='image')block.url=block.url.replace('https://whiteboard.test',origin);publicQuestion.blocks.push({id:'malformed',type:'text',content:'<div title="unclosed><img src=https://example.test/image.png onerror=window.hostCompromised=1>'});board.cards=[createWhiteboardCard(publicQuestion)];board.cards[0].app=appSuggestion();
 const bytes=whiteboardSnapshotBytes(board),id=await whiteboardDigest(bytes),link=whiteboardViewerUrl(id,'a682dbff-24e7-421a-bd63-4b512ac409a1');publicPayloads.set(id,bytes);
 const context=await browser.newContext({viewport:{width:900,height:900}}),page=await context.newPage(),errors=[];await context.addInitScript(()=>{window.hostCompromised=0;});page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 const mockStorage=route=>route.fulfill({status:200,contentType:'application/json',body:Buffer.from(bytes)});await context.route('https://firebasestorage.googleapis.com/**',mockStorage);
 await page.goto(origin+'/whiteboard.html'+new URL(link).hash);await page.locator('.wb-card').waitFor();assert.equal(await action(page,'save').count(),0);assert.equal(await action(page,'app').count(),0);assert.equal(await page.locator('.wb-helper iframe').getAttribute('sandbox'),'allow-scripts');assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE MODEL ANSWER'));assert.equal(await page.evaluate(()=>window.hostCompromised),0,'Malformed quoted rich text never runs an event');assert.equal(await page.locator('img[src^="https://example.test"]').count(),0);
 const accountHref=await page.locator('#whiteboardAccountLink').getAttribute('href');assert.equal(new URL(accountHref,origin).searchParams.get('whiteboard'),link,'Account link carries the complete frozen whiteboard URL');
 await action(page,'attempt',board.cards[0].id).click();await page.locator('#wbResponseDialog').waitFor();await page.locator('#wbResponse_0').fill('Heat moves from hot water to cooler surroundings.');await page.locator('#wbResponseSave').click();assert.ok((await page.locator('#wbResponseStatus').innerText()).includes('saved'));await page.locator('#wbResponseClose').click();
 await page.reload();await page.locator('.wb-card').waitFor();await action(page,'attempt',board.cards[0].id).click();assert.equal(await page.locator('#wbResponse_0').inputValue(),'Heat moves from hot water to cooler surroundings.','Public learner answers persist on this browser');await page.locator('#wbResponseClose').click();
 // Remove the completed fetch interception before document.write creates a
 // new about:blank print document. Chrome leaves its subresources pending
 // with Playwright network interception enabled; diagrams use our loopback.
 await context.unroute('https://firebasestorage.googleapis.com/**',mockStorage);
 const publicPopupPromise=page.waitForEvent('popup');await action(page,'print').click();const publicPrint=await publicPopupPromise;await publicPrint.waitForLoadState('load');await waitPrintImages(publicPrint);assert.ok(!(await publicPrint.locator('body').innerText()).includes('PRIVATE'));const publicPdf=await publicPrint.pdf({path:path.join(output,'whiteboard-public-worksheet.pdf'),format:'A4',printBackground:true});assert.equal(publicPdf.subarray(0,4).toString(),'%PDF');await publicPrint.close();
 await page.screenshot({path:path.join(output,'whiteboard-public.png'),fullPage:true});assert.deepEqual(errors,[]);results.push({test:'public viewer, saved responses, account link and PDF',status:'passed'});
 await context.route('https://firebasestorage.googleapis.com/**',mockStorage);await page.goto(origin+'/whiteboard.html#id='+'0'.repeat(64)+'&token=a682dbff-24e7-421a-bd63-4b512ac409a1');await page.waitForFunction(()=>document.getElementById('whiteboardViewerStatus').textContent.includes('published link'));assert.equal(await page.locator('.wb-card').count(),0,'Digest mismatch never renders public content');results.push({test:'public corrupt snapshot refused',status:'passed'});await context.close();
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.length,output,results},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
