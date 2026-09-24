// Real dialog, CSS and approval controller. All AI and persistence calls are
// deterministic fixtures; this never opens an account or spends image credits.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { harnessBody, htmlSource, sampleQuestion, sampleFindings, samplePlan } from './question-repair-tests.mjs';

const require=createRequire(import.meta.url);
const playwright=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browserPath=process.env.CHROME_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
const browser=await playwright.chromium.launch({headless:true,...(browserPath?{executablePath:browserPath}:{})});
const output=process.env.QUESTION_REPAIR_QA_DIR || fileURLToPath(new URL('../../checker-repair-qa/',import.meta.url));
fs.mkdirSync(output,{recursive:true});
const css=[...htmlSource.slice(0,htmlSource.indexOf('</head>')).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
const start=htmlSource.indexOf('<div class="tl-overlay" id="tlOverlay"');
const end=htmlSource.indexOf('<!-- ==================== 🎯 RE-FILE',start);
assert.ok(start>=0 && end>start,'Question check dialog exists');
const modal=htmlSource.slice(start,end);
const coreSource=fs.readFileSync(new URL('../question-repair-core.mjs',import.meta.url),'utf8');
const cropSource=fs.readFileSync(new URL('../question-crop-core.mjs',import.meta.url),'utf8');
const body=harnessBody();
const results=[];

async function fixture(width){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    if(route.request().url().endsWith('/question-repair-core.mjs'))return route.fulfill({contentType:'text/javascript',body:coreSource});
    if(route.request().url().endsWith('/question-crop-core.mjs'))return route.fulfill({contentType:'text/javascript',body:cropSource});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body>'+modal+'</body></html>'});
  });
  await page.goto('https://question-repair.test/');
  await page.evaluate(async ({body,question,findings,plan})=>{
    const core={...await import('/question-repair-core.mjs'),...await import('/question-crop-core.mjs')};
    const h=window.qa=new Function('core','env',body)(core,{question,findings,plan,document,window,scope:'create'});
    for(const [name,fn] of Object.entries(h))if(typeof fn==='function' && name.startsWith('tlRepair'))window[name]=fn;
    window.tlClosePanel=()=>{h.tlRepairReset();document.getElementById('tlOverlay').classList.remove('show');};
    window.tlRecheck=()=>{};
    window.tlPanelEdit=()=>{};
    document.getElementById('tlOverlay').classList.add('show');
    document.getElementById('tlPanelTitle').textContent=question.title;
    document.getElementById('tlPanelSub').textContent='Matter and its 3 States · Multiple Choice Question';
    document.getElementById('tlPanelBody').innerHTML='<div class="tl-verdict red"><div><div class="tl-verdict-t">Something here is wrong</div><div class="tl-verdict-d">2 things to look at, worst first.</div></div></div>';
    window.startPlan=()=>h.tlRepairRefresh(h.tlRepairRead('create','q1'),{state:'red',findings});
    window.startPlan();
  },{body,question:sampleQuestion(),findings:sampleFindings(),plan:samplePlan(true)});
  await page.waitForFunction(()=>qa.session?.stage==='ready');
  return {page,errors,close:()=>context.close()};
}

try{
  for(const width of [1280,390]){
    const f=await fixture(width),page=f.page;
    try{
      assert.equal(await page.locator('#tlRepairActions > li').count(),2);
      assert.match(await page.locator('#tlRepairActions').innerText(),/horizontal/);
      assert.deepEqual(await page.evaluate(()=>[qa.H.image.length,qa.H.saves.length]),[0,0]);
      assert.equal(await page.locator('#tlRepairInstructionWrap').isVisible(),false);
      await page.screenshot({path:path.join(output,'repair-initial-plan-'+width+'.png'),fullPage:true});
      await page.locator('#tlRepairReviseBtn').click();
      assert.equal(await page.locator('#tlRepairInstructionWrap').isVisible(),true);
      await page.locator('#tlRepairInstruction').fill('Keep the diagram and change only the opening sentence.');
      await page.evaluate(()=>{const input=document.getElementById('tlRepairInstruction');input.focus();input.setSelectionRange(8,8);qa.tlRepairRender();});
      assert.deepEqual(await page.evaluate(()=>[document.activeElement.id,document.activeElement.selectionStart]),['tlRepairInstruction',8],'Repainting preserves instruction focus and cursor');
      assert.equal(await page.locator('#tlRepairApplyBtn').isEnabled(),false);
      await page.evaluate(()=>{qa.H.aiReply={actions:[{kind:'replace_text',target:'block:wording:content',reason:'Correct the opening sentence.',value:'Two containers were placed on the balance.'}],notes:[]};});
      await page.locator('#tlRepairUpdateBtn').click();
      await page.waitForFunction(()=>qa.session?.stage==='ready');
      assert.equal(await page.locator('#tlRepairActions > li').count(),1);
      assert.ok(await page.evaluate(()=>qa.H.ai.at(-1).prompt.includes('Keep the diagram')));
      const panel=await page.locator('.tl-panel').boundingBox();
      assert.ok(panel.x>=0 && panel.y>=0 && panel.x+panel.width<=width+1 && panel.y+panel.height<=901,'Dialog stays in viewport');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');
      for(const id of ['tlRepairApplyBtn','tlRepairReviseBtn','tlRepairCancelBtn']){
        await page.locator('#'+id).scrollIntoViewIfNeeded();
        const target=await page.locator('#'+id).boundingBox();
        assert.ok(target.height>=44,'Touch target '+id);
      }
      await page.screenshot({path:path.join(output,'repair-plan-'+width+'.png'),fullPage:true});
      await page.locator('#tlRepairCancelBtn').click();
      assert.deepEqual(await page.evaluate(()=>[qa.H.image.length,qa.H.saves.length,qa.blocks[0].content]),[0,0,sampleQuestion().blocks[0].content]);
      assert.deepEqual(f.errors,[]);
      results.push({width,checks:'automatic proposal, review, instruction revision, cancelled changes, mobile bounds and touch targets'});
    }finally{await f.close();}
  }
  const f=await fixture(1280);
  try{
    await f.page.locator('#tlRepairApplyBtn').click();
    await f.page.waitForFunction(()=>qa.session?.stage==='applied');
    assert.equal(await f.page.evaluate(()=>qa.H.image.length),1);
    assert.equal(await f.page.evaluate(()=>qa.H.ai.length),1,'Implement uses reviewed text without another model rewrite');
    assert.equal(await f.page.evaluate(()=>qa.blocks[1].url),'https://fixtures.test/redrawn.png');
    assert.equal(await f.page.evaluate(()=>qa.editing),'q1');
    assert.equal(await f.page.locator('#tlRepairUndoBtn').isVisible(),true);
    await f.page.locator('#tlRepairUndoBtn').click();
    await f.page.waitForFunction(()=>qa.blocks[1].url==='https://fixtures.test/original.png');
    assert.equal(await f.page.evaluate(()=>qa.blocks[0].content),sampleQuestion().blocks[0].content);
    assert.deepEqual(f.errors,[]);
    results.push({checks:'approve exact plan, redraw reference image, preserve editing identity, undo'});
  }finally{await f.close();}
  console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
