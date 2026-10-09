// Shipped page, controller, core and styles in Chromium. AI/storage are local
// fixtures: no account, source bank, image-generation or paid API mutations.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const executablePath=process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const output=process.env.SUMMARY_SHEET_QA_DIR||fileURLToPath(new URL('../../summary-sheet-qa/',import.meta.url));fs.mkdirSync(output,{recursive:true});
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=[...html.slice(0,html.indexOf('</head>')).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
const start=html.indexOf('<div class="page" id="page-summarysheets">'),end=html.indexOf('<div class="page" id="page-myworksheets">',start);
assert.ok(start>=0&&end>start,'Real author summary-sheet page is present');
const pageMarkup=html.slice(start,end).replace('class="page"','class="page active"');
const modules=new Map([
  ['/summary-sheets.js',fs.readFileSync(new URL('../summary-sheets.js',import.meta.url),'utf8')],
  ['/summary-sheet-core.mjs',fs.readFileSync(new URL('../summary-sheet-core.mjs',import.meta.url),'utf8')],
  ['/tools/summary-sheet-fixtures.mjs',fs.readFileSync(new URL('./summary-sheet-fixtures.mjs',import.meta.url),'utf8')],
]);
const summaryCss=fs.readFileSync(new URL('../summary-sheets.css',import.meta.url),'utf8');
const appSource=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),printStart=appSource.indexOf('function ssPrintSheet({ html, title }) {'),printEnd=appSource.indexOf('function ssTool()',printStart);
assert.ok(printStart>=0&&printEnd>printStart,'Shipped summary print adapter exists');const shippedPrintSection=appSource.slice(printStart,printEnd);
const bootstrap=`
  import {installSummarySheets} from '/summary-sheets.js';
  import {sampleQuestions,teacher,sourceContext,deferred} from '/tools/summary-sheet-fixtures.mjs';
  const h=window.qa={user:teacher(),authUid:'teacher-1',author:true,bank:sampleQuestions(),ai:[],saves:[],prints:[],sourceOpens:[]};
  h.original=structuredClone(h.bank);
  h.tool=installSummarySheets({document,getUser:()=>h.user,getAuthUid:()=>h.authUid,canAuthor:()=>h.author,getBank:()=>h.bank,
    isQuestionEligible:()=>true,questionTopics:q=>[q.topic,q.topic2].filter(Boolean),sourceContext,
    askAI:async request=>{h.ai.push(structuredClone(request));if(h.aiMode==='deferred'){h.aiGate=deferred();return h.aiGate.promise;}if(h.aiMode==='failure')throw Error('Fixture model unavailable');return {shortQuestion:'Why did the water cool?',shortAnswer:'Water loses heat to cooler surroundings.',howTo:'State the direction of heat transfer.',note:'Compare the recorded answer before using this suggestion.'};},
    loadSheets:async uid=>JSON.parse(localStorage.getItem('ss-fixture-'+uid)||'[]'),
    saveSheet:async (sheet,context)=>{if(!context.guard())return false;h.saves.push({uid:context.uid,sheet:structuredClone(sheet)});localStorage.setItem('ss-fixture-'+context.uid,JSON.stringify([sheet]));return true;},
    deleteSheet:async (id,context)=>{if(!context.guard())return false;localStorage.setItem('ss-fixture-'+context.uid,'[]');return true;},
    openSource:id=>h.sourceOpens.push(id),navigate:()=>{},notify:()=>{},printSheet:data=>{h.prints.push(data);return true;},
  });
  h.resolveAI=()=>h.aiGate.resolve({shortQuestion:'Late AI wording',shortAnswer:'Late AI answer',howTo:''});
  window.toggleSidebar=()=>{};await h.tool.open();window.fixtureReady=true;
`;
const results=[];
function fixtureSvg(name){
  const wide=name.includes('wide'),tall=name.includes('tall'),w=wide?1200:tall?150:300,h=wide?160:tall?1200:180;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'"><rect x="2" y="2" width="'+(w-4)+'" height="'+(h-4)+'" fill="#f0f5f1" stroke="#51755b" stroke-width="4"/><path d="M10 10L'+(w-10)+' '+(h-10)+'M'+(w-10)+' 10L10 '+(h-10)+'" stroke="#91ad98"/><text x="12" y="32" font-size="18" fill="#243a2b">'+path.basename(name,'.svg')+'</text></svg>';
}
// A real loopback server is necessary for the initial about:blank popup:
// document.write can start its resources before Playwright attaches routing.
let origin='',printControl=null;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,origin||'http://127.0.0.1'),name=url.pathname;
  res.setHeader('Cache-Control','no-store');
  const send=(type,body,status=200)=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
  if(modules.has(name))return send('text/javascript',modules.get(name).replaceAll('https://summary-sheet.test',origin));
  if(name==='/summary-sheets.css')return send('text/css',summaryCss);
  if(name.startsWith('/images/')){
    if(printControl&&url.searchParams.has('print-read')){
      const record={url:url.href,done:false};printControl.requests.push(record);await printControl.gate;record.done=true;
      if(printControl.failTall&&name.includes('tall-shadow'))return send('text/plain','Unavailable source picture',404);
    }
    return send('image/svg+xml',fixtureSvg(name));
  }
  if(name==='/')return send('text/html; charset=utf-8','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><link rel="stylesheet" href="/summary-sheets.css"></head><body>'+pageMarkup+'<script type="module">'+bootstrap+'</script></body></html>');
  return send('text/plain','Fixture route missing',404);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
async function fixture(width,height=950){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.goto(origin+'/');await page.waitForFunction(()=>window.fixtureReady);
  return {context,page,errors};
}
const action=(page,name,id)=>page.locator('[data-ss-action="'+name+'"]'+(id?'[data-ss-id="'+id+'"]':''));
async function noOverflow(page,selector='.ss-grid'){
  const result=await page.evaluate(selector=>({viewport:innerWidth,page:document.documentElement.scrollWidth,boxes:[...document.querySelectorAll(selector+' > article')].map(el=>{const b=el.getBoundingClientRect();return {x:b.x,right:b.right,width:b.width,scroll:el.scrollWidth,client:el.clientWidth};})}),selector);
  assert.ok(result.page<=result.viewport+1,'No horizontal page overflow: '+JSON.stringify(result));
  assert.ok(result.boxes.every(b=>b.x>=-1&&b.right<=result.viewport+1&&b.scroll<=b.client+1),'Cards and content remain inside the viewport: '+JSON.stringify(result));
}
async function imageBounds(page,selector){
  await page.locator(selector+' img').evaluateAll(images=>Promise.all(images.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;}))));
  const images=await page.locator(selector+' img').evaluateAll(images=>images.map(img=>{const b=img.getBoundingClientRect(),c=img.closest('article').getBoundingClientRect();return {loaded:img.naturalWidth>0,fit:getComputedStyle(img).objectFit,left:b.left,right:b.right,top:b.top,bottom:b.bottom,card:c.toJSON(),width:b.width,height:b.height};}));
  assert.ok(images.length>0&&images.every(i=>i.loaded&&i.fit==='contain'&&i.left>=i.card.left-1&&i.right<=i.card.right+1&&i.top>=i.card.top-1&&i.bottom<=i.card.bottom+1),'Every original image fits its card without cropping: '+JSON.stringify(images));
}
try{
  for(const width of [1280,900,390]){
    const f=await fixture(width),{page}=f;
    try{
      await page.locator('#ssTopic').selectOption('Heat');assert.equal(await page.locator('[data-ss-pick]').count(),2);
      await page.locator('[data-ss-pick="heat-1"]').check();await action(page,'addSelected').click();await page.locator('.ss-card').waitFor();
      await action(page,'addTopic').click();assert.equal(await page.locator('.ss-card').count(),2,'Manual selection and topic collection do not duplicate a card');
      await page.locator('#ssTopic').selectOption('Light');await page.locator('[data-ss-pick="light-1"]').check();await action(page,'addSelected').click();assert.equal(await page.locator('.ss-card').count(),3);
      await page.locator('#ssTitle').fill('Heat and light revision');
      const first=await page.evaluate(()=>qa.tool.state().draft.summaryCards[0].id);
      const question=page.locator('[data-ss-card="'+first+'"][data-ss-field="shortQuestion"]'),answer=page.locator('[data-ss-card="'+first+'"][data-ss-field="shortAnswer"]');
      await question.fill('Why does the hot water cool?');await answer.fill('Heat moves from hot water to its cooler surroundings.');
      await action(page,'suggest',first).click();await action(page,'applySuggestion',first).waitFor();assert.equal(await question.inputValue(),'Why does the hot water cool?','AI is displayed for teacher review before changing the card');
      await action(page,'save').click();assert.equal(await page.evaluate(()=>qa.saves.length),0,'Teacher review required before saving');
      await action(page,'applySuggestion',first).click();assert.equal(await question.inputValue(),'Why did the water cool?');
      assert.equal(await page.locator('.ss-grid .ss-image').count(),6,'All four inline/table/option images and both figure-only questions are kept');
      await noOverflow(page);await imageBounds(page,'.ss-grid');
      const columns=await page.locator('.ss-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);assert.equal(columns,width>1180?3:width>680?2:1);
      const controls=await page.locator('.ss-host button[data-ss-action]').evaluateAll(buttons=>buttons.filter(b=>b.getBoundingClientRect().height>0).map(b=>({text:b.textContent,height:b.getBoundingClientRect().height})));assert.ok(controls.every(b=>b.height>=44),'All visible author buttons have 44px touch targets: '+JSON.stringify(controls));
      await page.screenshot({path:path.join(output,'summary-editor-'+width+'.png'),fullPage:true});
      await action(page,'save').click();await page.waitForFunction(()=>qa.saves.length===1&&!qa.tool.state().saving);const saved=await page.evaluate(()=>qa.tool.state().draft.id);
      assert.deepEqual(await page.evaluate(()=>qa.bank),await page.evaluate(()=>qa.original),'Original bank sources remain byte-for-byte unchanged');
      await page.reload();await page.waitForFunction(()=>window.fixtureReady);await action(page,'select',saved).click();assert.equal(await page.locator('.ss-card').count(),3);assert.equal(await page.locator('#ssTitle').inputValue(),'Heat and light revision');
      await action(page,'present').click();await page.locator('#summarySheetsPresentation').waitFor();assert.equal(await page.locator('#summarySheetsPresentation input,#summarySheetsPresentation textarea,#summarySheetsPresentation [contenteditable]').count(),0);
      assert.equal(await page.locator('#summarySheetsPresentation .ss-present-card').count(),3);assert.equal(await page.locator('#summarySheetsPresentation img').count(),6);assert.ok((await page.locator('#summarySheetsPresentation').innerText()).includes('Water loses heat to cooler surroundings.'));
      await noOverflow(page,'.ss-present-grid');await imageBounds(page,'.ss-present-grid');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'ssPresentationClose');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.dataset.ssAction),'print','Presentation traps Tab inside its own controls');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'ssPresentationClose');
      await page.locator('#summarySheetsPresentation').screenshot({path:path.join(output,'summary-present-'+width+'.png')});await page.keyboard.press('Escape');assert.equal(await page.locator('#summarySheetsPresentation').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.id),'ssPresentBtn');
      await action(page,'print').click();assert.equal(await page.evaluate(()=>qa.prints.length),1);assert.equal(await page.evaluate(()=>qa.ai.length),0,'Reopen, presentation and print do not run AI');assert.equal(await page.evaluate(()=>qa.saves.length),0,'Presenting and printing do not autosave');
      assert.equal(f.errors.length,0,'No browser exceptions: '+f.errors.join('; '));results.push({width,flow:'manual topic selection, review, save/reload, present, keyboard, images',cards:3,images:6});
    }finally{await f.context.close();}
  }
  // A teacher keeps typing while the model is pending; both late replies and
  // model failures must leave the card they see intact.
  const race=await fixture(390);
  try{
    const {page}=race;await page.locator('[data-ss-pick="heat-1"]').check();await action(page,'addSelected').click();const id=await page.evaluate(()=>qa.tool.state().draft.summaryCards[0].id);
    await page.evaluate(()=>qa.aiMode='deferred');await action(page,'suggest',id).click();await page.waitForFunction(()=>!!qa.aiGate);
    const answer=page.locator('[data-ss-card="'+id+'"][data-ss-field="shortAnswer"]');await answer.fill('Teacher typing stays here.');await page.evaluate(()=>qa.resolveAI());await page.waitForFunction(()=>!qa.tool.state().generating.length);
    assert.equal(await answer.inputValue(),'Teacher typing stays here.');assert.equal(await action(page,'applySuggestion',id).count(),0);
    await page.evaluate(()=>qa.aiMode='failure');await action(page,'suggest',id).click();await page.waitForFunction(()=>!qa.tool.state().generating.length);assert.equal(await answer.inputValue(),'Teacher typing stays here.');assert.match(await page.locator('#summarySheetsStatus').innerText(),/No card changes/);
    const typed=page.locator('[data-ss-card="'+id+'"][data-ss-field="shortQuestion"]');await typed.fill('');await typed.type('Teacher revised wording');assert.equal(await typed.inputValue(),'Teacher revised wording','Typing keeps focus and all input events');
    await page.evaluate(()=>{qa.author=false;qa.tool.resetForUser();});assert.match(await page.locator('#summarySheetsHost').innerText(),/author/);assert.equal(await page.locator('#summarySheetsHost textarea,#summarySheetsHost [data-ss-action]').count(),0);assert.equal(race.errors.length,0);results.push({flow:'late AI, failed AI, continuous typing, author gate'});
  }finally{await race.context.close();}
  // Standalone print document: long allowed text, wide and tall original figures
  // must stay within two A4 columns without cropped image or hidden card content.
  const p=await fixture(794,1123);
  try{
    const {page}=p;const printData=await page.evaluate(()=>{
      qa.tool.addQuestions(['heat-1','heat-2','light-1']);const cards=qa.tool.state().draft.summaryCards;
      for(const card of cards){qa.tool.editCard(card.id,'shortQuestion',card.shortQuestion+' Compare the source evidence and diagram.');qa.tool.editCard(card.id,'shortAnswer',(card.shortAnswer+' Explain the scientific cause and use the observed evidence. ').repeat(3));qa.tool.editCard(card.id,'howTo','Name the cause, direction and comparison in the original source. Use the units where needed.');}
      qa.tool.print();return qa.prints[0];
    });
    await imageBounds(page,'.ss-grid');
    printData.html=printData.html.replace(/src="([^"]+)"/g,(whole,url)=>url.startsWith(origin+'/images/')?'src="'+url+'?print-read=1"':whole);
    // Hold popup images to prove the actual adapter never prints before they load.
    let release;const gate=new Promise(resolve=>release=resolve);printControl={gate,release,requests:[],failTall:false};
    const popupPromise=page.waitForEvent('popup');
    await page.evaluate(({section,data})=>{
      qa.printEvents=[];qa.printToasts=[];const open=window.open.bind(window);
      window.open=(...args)=>{const tab=open(...args);if(tab){qa.popup=tab;tab.print=()=>qa.printEvents.push({images:tab.document.images.length,complete:[...tab.document.images].every(img=>img.complete&&img.naturalWidth>0)});tab.focus=()=>{};}return tab;};
      const escapeHtml=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      qa.shippedPrint=new Function('_canAuthor','showToast','escapeHtml',section+'return ssPrintSheet;')(()=>qa.author,(text,kind)=>qa.printToasts.push({text,kind}),escapeHtml);
      qa.printData=data;const button=document.createElement('button');button.id='fixtureRealPrint';button.textContent='Print reviewed sheet';button.onclick=()=>qa.shippedPrint(qa.printData);document.body.prepend(button);
    },{section:shippedPrintSection,data:printData});
    await page.locator('#fixtureRealPrint').click();
    const printPage=await popupPromise;await printPage.bringToFront();await printPage.setViewportSize({width:794,height:1123});
    for(let i=0;i<100&&!printControl.requests.length;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(printControl.requests.length>0,'Original figures are being read');assert.equal(await page.evaluate(()=>qa.printEvents.length),0,'Auto print waits for the original figures');
    // document.open/write can replace window globals in the new page. Install
    // the printer recorder in its completed document before releasing figures.
    await page.evaluate(()=>{const tab=qa.popup;tab.print=()=>qa.printEvents.push({images:tab.document.images.length,complete:[...tab.document.images].every(img=>img.complete&&img.naturalWidth>0)});});release();
    try{await page.waitForFunction(()=>qa.printEvents.length===1,{},{timeout:5000});}catch(error){
      const diagnostic={requests:printControl.requests,parent:await page.evaluate(()=>({events:qa.printEvents,toasts:qa.printToasts})),popup:await printPage.evaluate(()=>({ready:document.readyState,images:[...document.images].map(i=>({src:i.src,complete:i.complete,width:i.naturalWidth})),printer:String(window.print)}))};
      throw Error('Shipped print adapter did not auto-print: '+JSON.stringify(diagnostic));
    }assert.deepEqual(await page.evaluate(()=>qa.printEvents[0]),{images:6,complete:true});
    assert.equal(await printPage.locator('base').getAttribute('href'),origin+'/');assert.equal(await printPage.locator('body').evaluate(el=>el.classList.contains('ss-print-document')),true);assert.equal(await printPage.evaluate(()=>window.opener),null);
    await printPage.emulateMedia({media:'print'});await imageBounds(printPage,'.ss-present-grid');await noOverflow(printPage,'.ss-present-grid');
    assert.equal(await printPage.locator('.ss-present-card').count(),3);assert.equal(await printPage.locator('input,textarea,button').count(),0,'Student PDF has no author controls');assert.equal(await printPage.locator('img').count(),6);assert.equal(await printPage.locator('.ss-present-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
    const layout=await printPage.locator('.ss-present-card').evaluateAll(cards=>cards.map(card=>({height:card.getBoundingClientRect().height,breakInside:getComputedStyle(card).breakInside,scroll:card.scrollHeight,client:card.clientHeight})));
    await printPage.screenshot({path:path.join(output,'summary-print-a4.png'),fullPage:true});
    assert.ok(layout.every(c=>c.height<1047&&c.scroll<=c.client+1&&c.breakInside==='avoid'),'Each complete card can fit one printable A4 page: '+JSON.stringify(layout));
    const attrs=await printPage.locator('img').evaluateAll(images=>images.map(img=>img.getAttribute('onerror')));assert.ok(attrs.every(v=>v===null));
    await printPage.pdf({path:path.join(output,'summary-print-a4.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});assert.equal(p.errors.length,0);results.push({flow:'Real popup waits for figures; A4 print, two columns, original 6 pictures, long text and bounds',cards:3,images:6,layout});
    // One unavailable source image keeps the preview open and suppresses print.
    printControl.failTall=true;
    const failedPopup=page.waitForEvent('popup');await page.locator('#fixtureRealPrint').click();const failed=await failedPopup;
    await page.waitForFunction(()=>qa.printToasts.some(t=>t.kind==='error'));assert.equal(await page.evaluate(()=>qa.printEvents.length),1,'Image failure never silently prints missing question material');assert.equal(await failed.locator('.ss-present-card').count(),3);results.push({flow:'Real print popup retains preview and suppresses print when an original picture fails'});
  }finally{await p.context.close();}
  fs.writeFileSync(path.join(output,'summary-sheet-browser-results.json'),JSON.stringify(results,null,2));console.log('Summary sheet browser QA passed: '+results.length+' scenarios. Artifacts: '+output);
}finally{
  printControl?.release();
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
