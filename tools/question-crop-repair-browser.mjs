// Real manual crop controls and approved-repair dialog, including pixel output.
// No account, remote image downloads, uploads or paid model calls are used.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {appSource,htmlSource,harnessBody,sampleQuestion,controllerSection} from './question-repair-tests.mjs';

const require=createRequire(import.meta.url),playwright=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const executablePath=process.env.CHROME_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
const browser=await playwright.chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const output=process.env.QUESTION_REPAIR_QA_DIR || fileURLToPath(new URL('../../checker-repair-qa/',import.meta.url));
fs.mkdirSync(output,{recursive:true});
const css=[...htmlSource.slice(0,htmlSource.indexOf('</head>')).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
const section=(text,from,to)=>{const a=text.indexOf(from),b=text.indexOf(to,a);assert.ok(a>=0&&b>a,'Fixture section '+from);return text.slice(a,b);};
const modal=section(htmlSource,'<div class="tl-overlay" id="tlOverlay"','<!-- ==================== 🎯 RE-FILE');
const cropModal=section(htmlSource,'<div class="overlay" id="cropOverlay"','<!-- ==================== SIDE-BY-SIDE DUPLICATE');
const cropper=section(appSource,'(function injectCropStyles()','// =====================================================================\n// IMAGE TOUCH-UP');
const body=harnessBody(controllerSection(),cropper);
const modules=Object.fromEntries(['question-repair-core.mjs','question-crop-core.mjs'].map(name=>[name,fs.readFileSync(new URL('../'+name,import.meta.url),'utf8')]));
const results=[];

async function fixture(width){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=390,isMobile:width<=390});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    const name=route.request().url().split('/').at(-1);
    if(modules[name])return route.fulfill({contentType:'text/javascript',body:modules[name]});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body>'+modal+cropModal+'</body></html>'});
  });
  await page.goto('https://question-crop.test/');
  await page.evaluate(async({body,question})=>{
    const core={...await import('/question-repair-core.mjs'),...await import('/question-crop-core.mjs')};
    const canvas=document.createElement('canvas');canvas.width=600;canvas.height=600;
    const draw=canvas.getContext('2d');draw.fillStyle='#fff';draw.fillRect(0,0,600,600);draw.fillStyle='#172534';draw.font='20px sans-serif';
    draw.fillText('Question prose outside the diagram',30,35);draw.strokeStyle='#172534';draw.lineWidth=3;
    draw.strokeRect(150,100,300,70);draw.fillText('Materials',250,140);draw.beginPath();draw.moveTo(300,170);draw.lineTo(300,220);draw.moveTo(120,220);draw.lineTo(480,220);draw.lineTo(480,290);draw.moveTo(120,220);draw.lineTo(120,290);draw.stroke();
    draw.strokeRect(40,290,220,80);draw.strokeRect(350,290,220,80);draw.fillText('Conducts heat',80,337);draw.fillText('Poor conductor',385,337);
    draw.fillText('Duplicated sentence outside crop',30,520);
    const data=canvas.toDataURL('image/png');
    question.blocks[1].cropSource={url:'https://fixture.test/full-page.png',imageUrl:question.blocks[1].url,original:true,box_2d:[100,25,650,975]};
    const findings=[{type:'Crop',severity:'high',title:'The flowchart starting box is cut off',detail:'Restore the complete flowchart and remove the repeated question sentence.',fix:'cropImage',target:'block:diagram:url',cropStatus:'clipped'}];
    const plan={actions:[{kind:'recrop_image',target:'block:diagram:url',reason:'Restore the diagram crop.',instruction:'Include the complete diagram and remove prose.'}],notes:[]};
    const loadImage=url=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url;});
    const h=window.qa=new Function('core','env',body)(core,{question,findings,plan,document,window,FileReader,loadImage,scope:'create'});
    h.H.mediaImpl=async url=>url.startsWith('data:')?url:data;
    for(const [name,fn] of Object.entries(h))if(typeof fn==='function'&&(name.startsWith('tlRepair')||['applyCropTool','cropToolReset','closeCropTool'].includes(name)))window[name]=fn;
    window.tlClosePanel=()=>{h.tlRepairReset();document.getElementById('tlOverlay').classList.remove('show');};window.tlRecheck=()=>{};window.tlPanelEdit=()=>{};
    document.getElementById('tlOverlay').classList.add('show');document.getElementById('tlPanelTitle').textContent='Classifying materials';
    document.getElementById('tlPanelSub').textContent='Materials · Flowchart question';document.getElementById('tlPanelBody').innerHTML='<div class="tl-verdict red">The diagram crop needs correction.</div>';
    h.tlRepairRefresh(h.tlRepairRead('create','q1'),{state:'red',findings});
  },{body,question:sampleQuestion()});
  await page.waitForFunction(()=>qa.session?.stage==='ready');
  return{page,errors,close:()=>context.close()};
}
try{
  for(const width of [1280,390,300]){
    const f=await fixture(width),p=f.page;
    try{
      await p.locator('#tlRepairCropTools button').first().click();await p.waitForFunction(()=>qa.cropper!==null);
      assert.equal(await p.locator('#cropOverlay').isVisible(),true);assert.equal(await p.locator('#cropSourceWrap').isVisible(),true);
      assert.match(await p.locator('#cropApplyBtn').innerText(),/Use this crop in plan/);
      assert.deepEqual(await p.evaluate(()=>[qa.H.uploads.length,qa.H.saves.length]),[0,0]);
      await p.locator('#cropOverlay .overlay-foot button').filter({hasText:'Whole image'}).click();
      assert.deepEqual(await p.evaluate(()=>[qa.cropper.box.x,qa.cropper.box.y,qa.cropper.box.w===qa.cropper.dispW,qa.cropper.box.h===qa.cropper.dispH]),[0,0,true,true]);
      await p.selectOption('#cropSourceSelect','1');await p.waitForFunction(()=>qa.cropper&&qa.picker.source.id==='current');
      assert.match(await p.locator('#cropSourceHelp').innerText(),/cannot restore content already cut off/);
      await p.selectOption('#cropSourceSelect','0');await p.waitForFunction(()=>qa.cropper&&qa.picker.source.original);
      const card=await p.locator('#cropOverlay .overlay-card').boundingBox();
      assert.ok(card.x>=0&&card.x+card.width<=width+1,'Crop dialog within width '+width);
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow '+width);
      for(const id of ['cropSourceSelect','cropOriginalFile','cropStage','cropApplyBtn']){
        const box=await p.locator('#'+id).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,id+' within mobile bounds '+width);
      }
      // Exercise the actual pointer listeners and conversion from display pixels.
      const handle=p.locator('#cropBox [data-h="se"]');await handle.scrollIntoViewIfNeeded();const bounds=await handle.boundingBox();
      const old=await p.evaluate(()=>({...qa.cropper.box}));
      await p.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await p.mouse.down();await p.mouse.move(bounds.x+bounds.width/2-12,bounds.y+bounds.height/2-12);await p.mouse.up();
      const resized=await p.evaluate(()=>({...qa.cropper.box}));assert.ok(resized.w<old.w&&resized.h<old.h,'Pointer resize changes the crop '+JSON.stringify({width,bounds,old,resized}));
      await p.screenshot({path:path.join(output,'manual-crop-'+width+'.png'),fullPage:true});
      await p.locator('#cropApplyBtn').click();await p.waitForFunction(()=>qa.session?.stage==='ready'&&qa.session.manualCrops?.['block:diagram:url']);
      assert.equal(await p.locator('#cropOverlay').isVisible(),false);assert.equal(await p.locator('.tl-crop-preview').count(),1);
      assert.deepEqual(await p.evaluate(()=>[qa.H.uploads.length,qa.H.saves.length]),[0,0],'Using crop in plan is not an upload or question edit');
      assert.equal(await p.evaluate(()=>qa.blocks[1].url),sampleQuestion().blocks[1].url);
      const dimensions=await p.evaluate(async()=>{const img=new Image();img.src=qa.session.manualCrops['block:diagram:url'].dataUrl;await img.decode();return[img.naturalWidth,img.naturalHeight];});
      assert.ok(dimensions[0]>100&&dimensions[0]<600&&dimensions[1]>100&&dimensions[1]<600,'Canvas returns real selected pixels');
      await p.locator('#tlRepairApplyBtn').click();await p.waitForFunction(()=>qa.session?.stage==='applied');
      assert.equal(await p.evaluate(()=>qa.H.uploads.length),1);assert.equal(await p.evaluate(()=>qa.H.image.length),0);
      assert.equal(await p.evaluate(()=>qa.blocks[1].cropSource.url),'https://fixture.test/full-page.png');
      await p.locator('#tlRepairUndoBtn').click();await p.waitForFunction(()=>qa.blocks[1].url==='https://fixtures.test/original.png');
      assert.deepEqual(f.errors,[]);results.push({width,checks:'manual source picker, responsive controls, pointer resize, staged pixel preview, approved upload, provenance and Undo'});
    }finally{await f.close();}
  }
  const f=await fixture(390);
  try{
    const p=f.page;await p.locator('#tlRepairCropTools button').first().click();await p.waitForFunction(()=>qa.cropper!==null);
      await p.locator('#cropOverlay .overlay-foot button').filter({hasText:'Cancel'}).click();
    assert.equal(await p.locator('#cropOverlay').isVisible(),false);assert.equal(await p.evaluate(()=>qa.session.stage),'ready');
    assert.deepEqual(await p.evaluate(()=>[qa.H.uploads.length,qa.blocks[1].url]),[0,sampleQuestion().blocks[1].url]);
    await p.locator('#tlRepairCropTools button').first().click();await p.waitForFunction(()=>qa.cropper!==null);
    await p.evaluate(()=>{qa.H.loadImageImpl=async()=>{throw Error('Image decode failed while applying crop');};});
    await p.locator('#cropApplyBtn').click();await p.waitForFunction(()=>qa.session.stage==='ready'&&qa.picker===null);
    assert.equal(await p.evaluate(()=>qa.H.uploads.length),0);assert.equal(await p.locator('#cropOverlay').isVisible(),false);
    await p.evaluate(()=>{qa.H.loadImageImpl=null;});
    await p.locator('#tlRepairCropTools button').first().click();await p.waitForFunction(()=>qa.cropper!==null);
    await p.evaluate(()=>{qa.blocks[0].content='Newer teacher edit while the crop is open.';});
    await p.locator('#cropApplyBtn').click();assert.equal(await p.locator('#cropOverlay').isVisible(),false);
    assert.equal(await p.evaluate(()=>qa.H.uploads.length),0);assert.equal(await p.evaluate(()=>qa.session.manualCrops?.['block:diagram:url']||null),null);
    assert.deepEqual(f.errors,[]);results.push({checks:'cancel manual crop, recover failed pixel generation and reject stale crop on approval'});
  }finally{await f.close();}
  console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
