import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});
let checks=0;function check(value,message){assert.ok(value,message);checks++;}
try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='tree.test')return route.abort();const file=path.join(root,url.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.abort();});
  await page.goto('http://tree.test/science-legends.html');await page.locator('#startBtn').click();await page.waitForFunction(()=>G&&G.time>.05);await page.evaluate(()=>{G.enemies=[];G.pets=[];G.spawnT=999;G.points=3;});await page.keyboard.press('t');
  check(await page.locator('#treeBoard .tnode[tabindex="0"]').count()===1,`${width}: one logical graph Tab entry`);
  const first=page.locator('#treeBoard .tnode[tabindex="0"]');await first.focus();const initial=await first.getAttribute('data-node');await page.keyboard.press('ArrowRight');
  check(await page.evaluate(id=>document.activeElement.dataset.node!==id,initial),`${width}: real arrow browsing moves between branches`);
  await page.keyboard.press('End');check(await page.evaluate(()=>$('treeBoardWrap').scrollTop>0),`${width}: End reaches and reveals distant nodes`);
  check(await page.evaluate(()=>{const a=document.activeElement.getBoundingClientRect(),b=$('treeBoardWrap').getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom+1;}),`${width}: focused node remains within the scrolled graph`);
  const points=await page.evaluate(()=>G.points);await page.keyboard.press('Enter');check(await page.locator('#treePop').isVisible(),`${width}: locked node remains inspectable`);check(await page.evaluate(n=>G.points===n,points),`${width}: inspection never spends points`);
  await page.keyboard.press('Escape');check(await page.locator('#treePop').count()===0&&await page.evaluate(()=>document.activeElement.classList.contains('tnode')),`${width}: Escape returns details to their node`);
  await page.keyboard.press('Home');await page.locator('#treeBoard .tnode.avail').first().focus();await page.keyboard.press('Enter');await page.locator('#tpAdd').focus();await page.keyboard.press('Enter');
  const allocation=await page.evaluate(()=>({points:G.points,focus:document.activeElement.id,selected:treeSel,feedback:$('treeFeedback').textContent}));
  check(allocation.points===2&&allocation.focus==='tpAdd',`${width}: actual allocation retains meaningful Add point focus: ${JSON.stringify(allocation)}`);
  check((await page.locator('#treeFeedback').innerText()).includes('2 skill points'),`${width}: allocation announces the result`);
  await page.keyboard.press('Escape');check(await page.locator('#treeOverlay').isVisible()&&await page.locator('#treePop').count()===0,`${width}: Escape inside details closes only the popover`);
  await page.keyboard.press('t');check(await page.evaluate(()=>!$('treeOverlay').classList.contains('show')&&!$('pauseOverlay').classList.contains('show')&&!keys.t),`${width}: T returns to combat without pause or held input`);
  await page.keyboard.press('t');const advanced=await page.evaluate(()=>{const node=TREES[G.cls].find(n=>n.kind==='ult');return {id:node.id,name:node.name};});
  await page.locator('#treeSearch').fill(advanced.name);check((await page.locator('#treeSearchCount').innerText()).includes('matches'),`${width}: advanced skill search reports literal matches`);
  await page.keyboard.press('Enter');check(await page.evaluate(id=>treeSel===id&&document.activeElement.dataset.node===id,advanced.id),`${width}: Enter focuses and inspects the actual advanced node`);
  check(await page.locator('.tree-route-edge').count()>0&&await page.locator('.tnode.search-muted').count()>0,`${width}: actual dependency paths stay visible while unrelated nodes dim`);
  check(await page.locator('#tpAdd').isDisabled()&&await page.evaluate(()=>G.points===2),`${width}: search never bypasses advanced-node allocation requirements`);
  await page.locator('#treeSearch').fill('');await page.locator('#treeSearch').focus();await page.keyboard.type('tp1wasd');
  check(await page.evaluate(()=>$('treeOverlay').classList.contains('show')&&!$('pauseOverlay').classList.contains('show')&&Object.values(keys).every(v=>!v)),`${width}: real search typing cannot trigger battle hotkeys`);
  await page.locator('#treeSearch').fill('<img src=x onerror=alert(1)>');check((await page.locator('#treeSearchCount').innerText()).includes('No matches')&&await page.locator('#treeSearchResults img').count()===0,`${width}: no-result queries stay literal text`);
  await page.locator('#treeSearchClear').click();check(await page.evaluate(()=>treeQuery===''&&document.querySelectorAll('.tnode.search-muted').length===0),`${width}: clearing search restores the complete graph`);
  check(errors.length===0,`${width}: no keyboard UI runtime errors: ${errors.join(', ')}`);await context.close();
}console.log(`Science Legends tree browser: ${checks} checks passed`);}finally{await browser.close();}
