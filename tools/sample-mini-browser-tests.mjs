// Exercise the shipped public science player: review gating, hover/tap reasons,
// blank/CER responses, and the same isolated interactive apps used by practice.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const modulePath = process.env.PLAYWRIGHT_MODULE || process.env.WIDGET_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3e0AAAAASUVORK5CYII=';
const questions = [
  { id:'respiration', title:'Grasshopper respiration', level:'Sec 1', labelStyle:'letters', blocks:[
    { id:'stem', type:'text', text:'Which gas does substance M absorb?' },
    { id:'choice', type:'mcq', options:[{id:'oxygen',text:'oxygen'},{id:'nitrogen',text:'nitrogen'},{id:'water',text:'water vapour'},{id:'co2',text:'carbon dioxide'}] }
  ] },
  { id:'cer', title:'Explain the result', blocks:[{id:'a',type:'cer'}] },
  { id:'blanks', title:'Complete the sentence', blocks:[{id:'b',type:'fillblank',segments:[{type:'text',text:'Water '},{type:'blank'},{type:'text',text:' when it is heated.'}]}] },
  { id:'annotation', title:'Annotate the experiment', blocks:[
    {id:'picture',type:'image',url:'/fixture-diagram.svg',annotate:true,label:'Experiment diagram',scale:.5,caption:'Label the experiment.'},
    {id:'work',type:'annotation',label:'Working area',lines:8,height:320}
  ]},
  { id:'fidelity', title:'Read the author’s options', labelStyle:'numbers', blocks:[
    {id:'picture',type:'image',url:'/fixture-diagram.svg',scale:.2,caption:'Teacher-selected image size'},
    {id:'c',type:'mcq',options:[{id:'a',text:'A'},{id:'b',text:'1'},{id:'c',text:'(3)'},{id:'d',text:'(A)'}]}
  ]}
];
const review = {
  mcq:[{blockId:'choice',correctId:'co2',options:[
    {id:'oxygen',why:'Oxygen is taken in by the grasshopper, rather than removed by substance M.'},
    {id:'nitrogen',why:'Nitrogen is not the gas given out during respiration.'},
    {id:'water',why:'The experiment measures oxygen uptake by removing carbon dioxide.'},
    {id:'co2',why:'This correct option must never receive a wrong-option badge.'}
  ]}],
  explanation:'The grasshopper respires and gives out carbon dioxide.',
  modelAnswer:'Substance M absorbs carbon dioxide. <script>window.hostCompromised=true</script>',
  answerDiagrams:[{url:pixel}], explanationDiagrams:[{url:pixel,scale:.5}],
  widgets:[{id:'lab',title:'Explore respiration',height:260,html:`<button id="add">Run experiment</button><output id="count">0</output><output id="isolation"></output><script>
    let count=0;document.getElementById('add').onclick=()=>document.getElementById('count').textContent=++count;
    try {parent.document.body.dataset.compromised='yes'} catch(e) {document.getElementById('isolation').textContent='isolated'}
  </script>`}]
};
const server = http.createServer((request, response) => {
  if (request.url === '/fixture-diagram.svg') {
    response.setHeader('Content-Type','image/svg+xml');response.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#e0e8e0"/><rect x="80" y="80" width="100" height="100" fill="#789078"/></svg>');return;
  }
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\//, '');
  const target = path.resolve(root, name);
  if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { response.writeHead(404); response.end(); return; }
  const types = {'.html':'text/html','.js':'application/javascript','.css':'text/css'};
  response.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream'); response.end(fs.readFileSync(target));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless:true, ...(process.env.WIDGET_BROWSER_EXECUTABLE ? {executablePath:process.env.WIDGET_BROWSER_EXECUTABLE} : {})});
let unavailable = false, uncertain = false, missingReasons = false;
const checks = [], errors = [];
async function setup(page) {
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/studyBuddySample', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'questions') return route.fulfill({contentType:'application/json',body:JSON.stringify({token:'guest',questions})});
    checks.push(body);
    if (unavailable) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Marking is unavailable; your writing is still here.'})});
    const verdict = uncertain ? 'uncertain' : body.questionId !== 'respiration' || body.responses.choice === 'co2' ? 'correct' : 'incorrect';
    const resultReview = missingReasons ? {...review,mcq:review.mcq.map(block=>({...block,options:[]})),reasonError:'Reasons could not load. Check your answer again to retry.'} : review;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({verdict,feedback:'Checked your answer.',review:resultReview})});
  });
  await page.goto(origin + '/sample-materials.html'); await page.getByRole('heading',{name:'Grasshopper respiration'}).waitFor();
}
try {
  const page = await browser.newPage({viewport:{width:1000,height:900}}); await setup(page);
  assert.equal(await page.locator('.review-card,.why-button,iframe').count(),0,'initial load reveals no answers or apps');
  assert.equal(await page.locator('.option-answer').first().innerText(),'(A) oxygen','secondary label style preserved');
  await page.getByRole('button',{name:'Check my answer',exact:true}).click();
  assert.equal(checks.length,0,'blank answers are rejected locally');
  await page.getByRole('radio',{name:'(A) oxygen',exact:true}).check();
  await page.getByRole('button',{name:'Check my answer',exact:true}).click(); await page.locator('.review-card').first().waitFor();
  assert.equal(await page.locator('.check-button').evaluate(node=>node===document.activeElement),true,'checking restores keyboard focus');
  assert.equal(await page.locator('.option[data-verdict=incorrect]').innerText(),'(A) oxygen\nⓘ');
  assert.equal(await page.locator('.option[data-verdict=correct]').innerText(),'(D) carbon dioxide');
  assert.equal(await page.locator('.why-button').count(),3,'only wrong options have reasons');
  const nitrogen = page.getByRole('button',{name:'Why is (B) wrong?',exact:true}); await nitrogen.hover();
  await page.locator('.why-popup').waitFor({state:'visible'});
  assert.match(await page.locator('.why-popup').innerText(),/Nitrogen is not the gas given out/,'reason stays with its own option ID');
  const anchorBox = await nitrogen.boundingBox(), popupBox = await page.locator('.why-popup').boundingBox();
  assert.ok(popupBox.y + popupBox.height < anchorBox.y,'hover explanation opens above its option');
  await nitrogen.focus(); await page.keyboard.press('Enter'); await page.getByRole('button',{name:'Close explanation'}).focus(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('.why-popup').isVisible(),false,'keyboard escape dismisses reasons');
  assert.equal(await nitrogen.evaluate(node=>node===document.activeElement),true,'escape returns focus from dialog to its trigger');
  assert.equal(await page.locator('.review-card img').count(),2,'answer and explanation diagrams render');
  assert.equal(await page.locator('script').count(),3,'stored model answer is plain text, never host markup');
  const frame = page.frameLocator('.question-app-frame'); await frame.locator('#isolation').filter({hasText:'isolated'}).waitFor();
  await frame.getByRole('button',{name:'Run experiment'}).click(); assert.equal(await frame.locator('#count').innerText(),'1','widget scripts run');
  assert.equal(await page.evaluate(() => document.body.dataset.compromised || window.hostCompromised),undefined,'widget cannot access host');
  assert.equal(await page.locator('.question-app-frame').getAttribute('sandbox'),'allow-scripts','same sandbox as CER');
  assert.match(await page.locator('.question-app-frame').getAttribute('srcdoc'),/connect-src &#39;none&#39;/,'shared CSP prevents network access');
  await page.getByRole('button',{name:'Restart activity'}).click(); assert.equal(await frame.locator('#count').innerText(),'0','restart resets app state');
  await page.getByRole('button',{name:'Expand activity'}).click(); assert.equal(await page.locator('.widget-expanded').count(),1);
  await page.getByRole('button',{name:'Question 2',exact:true}).click(); await page.getByRole('button',{name:'Question 1',exact:true}).click();
  assert.equal(await page.locator('.why-button').count(),3,'question navigation preserves checked attempt');
  assert.equal(await page.getByRole('button',{name:'Question 1',exact:true}).evaluate(node=>node===document.activeElement),true,'question navigation preserves keyboard focus');
  await page.getByRole('radio',{name:'(D) carbon dioxide',exact:true}).check();
  assert.equal(await page.locator('.review-card,.why-button,iframe,.feedback').count(),0,'editing an answer disarms all review');
  unavailable = true; await page.getByRole('button',{name:'Check my answer',exact:true}).click(); await page.locator('.feedback').filter({hasText:'unavailable'}).waitFor();
  assert.equal(await page.locator('.review-card,.why-button,iframe').count(),0,'service failures do not unlock review');
  unavailable = false; uncertain = true; await page.getByRole('button',{name:'Check my answer',exact:true}).click(); await page.locator('.feedback[data-verdict=uncertain]').waitFor();
  assert.equal(await page.locator('.review-card,.why-button,iframe').count(),0,'uncertain grading does not unlock review even if reply includes it');
  uncertain = false; missingReasons = true; await page.getByRole('button',{name:'Check my answer',exact:true}).click(); await page.locator('.why-note').waitFor();
  assert.equal(await page.locator('.why-button').count(),0,'failed reason generation never invents option explanations');
  assert.match(await page.locator('.why-note').innerText(),/Check your answer again/,'reason generation failure has a retry path');
  missingReasons = false; await page.getByRole('button',{name:'Check my answer',exact:true}).click(); await page.locator('.why-button').first().waitFor();
  assert.equal(await page.getByRole('radio',{name:'(D) carbon dioxide',exact:true}).isChecked(),true,'retrying reasons keeps the attempt');
  await page.getByRole('button',{name:'Try this question again'}).click(); assert.equal(await page.locator('input:checked,.review-card,.why-button').count(),0,'retry clears answers and review');
  await page.getByRole('button',{name:'Question 2',exact:true}).click(); await page.getByRole('textbox').first().fill('Carbon dioxide is absorbed.');
  await page.getByRole('button',{name:'Check my answer',exact:true}).click(); await page.locator('.retry-button').waitFor();
  assert.equal(checks.at(-1).responses['a:claim'],'Carbon dioxide is absorbed.','CER fields retain canonical IDs');
  await page.getByRole('textbox').nth(1).fill('The ink moved.'); assert.equal(await page.locator('.review-card').count(),0,'typing clears stale review without losing focus');
  assert.equal(await page.getByRole('textbox').nth(1).inputValue(),'The ink moved.');
  await page.getByRole('button',{name:'Question 3',exact:true}).click(); await page.getByRole('textbox',{name:'Blank 1',exact:true}).fill('evaporates');
  await page.getByRole('button',{name:'Check my answer',exact:true}).click(); await page.locator('.retry-button').waitFor();
  assert.equal(checks.at(-1).responses['b:blank:0'],'evaporates','fillblank answers use canonical field IDs');
  await page.getByRole('button',{name:'Question 5',exact:true}).click();
  assert.deepEqual(await page.locator('.option-answer').allTextContents(),['(1) A','(2) 1','(3)','(4) (A)'],'author option wording is preserved and only its own bracketed marker is relabelled');
  assert.equal(await page.locator('.diagram').evaluate(image=>image.style.width),'20%','teacher-selected picture scale is honored');
  assert.equal(await page.locator('.diagram-caption').innerText(),'Teacher-selected image size');
  await page.getByRole('button',{name:'Question 4',exact:true}).click();
  const imagePad=page.locator('.annotation-wrap').first(), imageCanvas=imagePad.locator('canvas'), workPad=page.locator('.annotation-wrap').nth(1);
  await page.waitForFunction(()=>document.querySelector('.annotation-canvas').width===400);
  assert.equal(await imageCanvas.evaluate(canvas=>canvas.style.width),'50%','annotation pad honors teacher image scale');
  const pristine=await imageCanvas.evaluate(canvas=>canvas.toDataURL());
  const beforeEmpty=checks.length;await page.getByRole('button',{name:'Check my answer',exact:true}).click();
  assert.equal(checks.length,beforeEmpty,'empty annotation pads cannot be submitted');
  // Render after the validation message creates new pads; wait for the image.
  await page.waitForFunction(()=>document.querySelector('.annotation-canvas').width===400);
  const rect=await imageCanvas.boundingBox();
  await page.mouse.move(rect.x+rect.width*.2,rect.y+rect.height*.4);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*.4,rect.y+rect.height*.65,{steps:4});await page.mouse.move(rect.x+rect.width*.6,rect.y+rect.height*.3,{steps:4});await page.mouse.up();
  assert.notEqual(await imageCanvas.evaluate(canvas=>canvas.toDataURL()),pristine,'pointer pen draws over the original image');
  await imagePad.getByRole('button',{name:'Label',exact:true}).click();await imageCanvas.click({position:{x:rect.width*.1,y:rect.height*.1}});
  await imagePad.getByRole('textbox',{name:'Label 1',exact:true}).fill('grasshopper');
  const labelled=await imageCanvas.evaluate(canvas=>canvas.toDataURL());
  await page.getByRole('button',{name:'Question 1',exact:true}).click();await page.getByRole('button',{name:'Question 4',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.annotation-canvas').width===400);
  assert.equal(await imagePad.getByRole('textbox',{name:'Label 1',exact:true}).inputValue(),'grasshopper','labels persist across question navigation');
  assert.equal(await imageCanvas.evaluate(canvas=>canvas.toDataURL()),labelled,'pen strokes persist across question navigation');
  await imagePad.getByRole('button',{name:'Eraser',exact:true}).click();
  await imageCanvas.click({position:{x:rect.width*.4,y:rect.height*.65}});
  assert.notEqual(await imageCanvas.evaluate(canvas=>canvas.toDataURL()),labelled,'eraser removes the targeted stroke');
  await imagePad.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await imageCanvas.evaluate(canvas=>canvas.toDataURL()),labelled,'undo restores erased strokes');
  await imagePad.getByRole('button',{name:'Clear',exact:true}).click();
  assert.equal(await imageCanvas.evaluate(canvas=>canvas.toDataURL()),pristine,'clear removes annotations without erasing the source diagram');
  await imagePad.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await imageCanvas.evaluate(canvas=>canvas.toDataURL()),labelled,'clear is reversible');
  const workCanvas=workPad.locator('canvas');await workCanvas.scrollIntoViewIfNeeded();const workRect=await workCanvas.boundingBox();
  const workPristine=await workCanvas.evaluate(canvas=>canvas.toDataURL());
  await page.mouse.move(workRect.x+25,workRect.y+25);await page.mouse.down();await page.mouse.move(workRect.x+130,workRect.y+70,{steps:6});await page.mouse.up();
  assert.notEqual(await workCanvas.evaluate(canvas=>canvas.toDataURL()),workPristine,'blank working area accepts pen drawings');
  await page.getByRole('button',{name:'Check my answer',exact:true}).click();await page.locator('.retry-button').waitFor();
  const drawings=checks.at(-1).responses;assert.deepEqual(Object.keys(drawings).sort(),['picture','work'],'only canonical authored annotation IDs are submitted');
  for(const drawing of Object.values(drawings)) {assert.match(drawing,/^data:image\/png;base64,iVBOR/);assert.ok(drawing.length<=1800000,'composite respects server PNG budget');}
  const compositeSourcePixel=await page.evaluate(async data=>{
    const image=new Image();image.src=data;await image.decode();const out=document.createElement('canvas');out.width=image.width;out.height=image.height;const cx=out.getContext('2d');cx.drawImage(image,0,0);return Array.from(cx.getImageData(5,5,1,1).data);
  },drawings.picture);
  assert.deepEqual(compositeSourcePixel,[224,232,224,255],'submitted composite includes the original question diagram');
  await imagePad.getByRole('button',{name:'Pen',exact:true}).click();await imageCanvas.click({position:{x:10,y:10}});
  assert.equal(await page.locator('.review-card').count(),0,'editing a drawing disarms checked review');
  await page.close();
  const mobile = await browser.newPage({viewport:{width:375,height:812},hasTouch:true}); await setup(mobile);
  await mobile.getByRole('radio',{name:'(D) carbon dioxide',exact:true}).check(); await mobile.getByRole('button',{name:'Check my answer',exact:true}).click();
  const badge = mobile.getByRole('button',{name:'Why is (A) wrong?',exact:true}); await badge.tap(); await mobile.locator('.why-popup').waitFor({state:'visible'});
  const box = await mobile.locator('.why-popup').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 375 && box.y >= 0 && box.y + box.height <= 812,'mobile reason stays inside frame viewport');
  assert.equal(await badge.getAttribute('aria-expanded'),'true','tap pins the accessible reason');
  await mobile.getByRole('button',{name:'Close explanation'}).tap(); assert.equal(await mobile.locator('.why-popup').isVisible(),false);
  await mobile.getByRole('button',{name:'Question 4',exact:true}).tap();await mobile.waitForFunction(()=>document.querySelector('.annotation-canvas').width===400);
  const mobilePad=mobile.locator('.annotation-wrap').first(),mobileCanvas=mobilePad.locator('canvas');
  await mobilePad.getByRole('button',{name:'Label',exact:true}).tap();await mobileCanvas.tap({position:{x:20,y:15}});
  await mobilePad.getByRole('textbox',{name:'Label 1',exact:true}).fill('gas');
  await mobile.getByRole('button',{name:'Check my answer',exact:true}).tap();await mobile.locator('.retry-button').waitFor();
  assert.match(checks.at(-1).responses.picture,/^data:image\/png;base64,iVBOR/,'touch label annotations submit for marking');
  await mobile.close(); assert.deepEqual(errors,[],'no browser runtime errors');
  console.log('PASS public sample review, hover/tap reasons, authored annotations, response fields, and isolated interactive apps');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
