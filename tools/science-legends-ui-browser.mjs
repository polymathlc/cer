// Independent full-page skill-tree interaction and final visual preview checks.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),output=process.env.GAME_SCREENSHOTS||path.join(root,'test-results/legends-ui');
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});let checks=0;
function check(value,message){assert.ok(value,message);checks++;}
try{
 for(const width of [1280,390,320]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='ui.test')return route.abort();const f=path.join(root,decodeURIComponent(url.pathname));return fs.existsSync(f)&&fs.statSync(f).isFile()?route.fulfill({path:f}):route.abort();});
  await page.goto('http://ui.test/science-legends.html');await page.waitForFunction(()=>document.querySelectorAll('.class-card').length===5&&LegendsModels.allReady());
  await page.screenshot({path:path.join(output,`menu-${width}.png`),animations:'disabled'});
  await page.locator('.class-card').nth(1).click();await page.locator('#startBtn').click();await page.waitForFunction(()=>G&&G.time>.05);
  await page.evaluate(()=>{G.spawnT=999;G.qTimer=7;G.enemies=[];G.pets=[];G.player.hp=G.player.maxHp=CLASSES[G.cls].hp+G.stats.hpAdd+(G.player.levelHp||0);});
  await page.keyboard.press('t');await page.locator('#treeOverlay').waitFor({state:'visible'});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: illustrated tree does not make the page wider than the screen`);
  check(await page.locator('#treeOverlay').getAttribute('role')==='dialog',`${width}: tree remains a named modal dialog`);
  const initial=await page.evaluate(()=>{const nd=TREES[G.cls].find(canLearn),wrap=$('treeBoardWrap'),p=nodeXY(nd);wrap.scrollLeft=Math.max(0,p.x-wrap.clientWidth/2);wrap.scrollTop=Math.max(0,p.y-wrap.clientHeight/2);return {id:nd.id,rank:nodeRank(nd.id),points:G.points};});
  await page.locator(`[data-node="${initial.id}"]`).click();
  await page.locator('#treePop').waitFor({state:'visible'});
  const contained=await page.locator('#treePop').evaluate(node=>{const r=node.getBoundingClientRect(),w=document.getElementById('treeBoardWrap').getBoundingClientRect();return r.left>=w.left-1&&r.right<=w.right+1&&r.top>=w.top-1&&r.bottom<=w.bottom+1;});
  check(contained,`${width}: selected skill details and Add point control stay inside the visible graph viewport`);
  await page.screenshot({path:path.join(output,`skill-tree-${width}.png`),animations:'disabled'});
  await page.locator('#tpAdd').click();
  const learned=await page.evaluate(id=>({rank:nodeRank(id),points:G.points}),initial.id);
  check(learned.rank===initial.rank+1&&learned.points===initial.points-1,`${width}: one Add point press learns exactly one rank and spends one point`);
  check(await page.locator('#treePtsBig').innerText()===`${learned.points} point${learned.points===1?'':'s'}`,`${width}: tree point feedback matches the actual build`);
  await page.locator('#treeCloseBtn').click();
  await page.evaluate(()=>{
   G.enemies=[];G.pets=[];G.actions=[];G.fx=[];G.time=10;G.wave=4;G.waveT=12;G.qTimer=8;
   const p=G.player,kinds=['slime','imp','mite','brute','spitter','charger'];
   for(let i=0;i<18;i++){const e=spawnEnemy(kinds[i%6],i%7===0),angle=i/18*Math.PI*2,radius=95+(i%3)*50;Object.assign(e,{x:p.x+Math.cos(angle)*radius,y:p.y+Math.sin(angle)*radius,speed:0,hp:1000,maxHp:1000,fx:-Math.cos(angle),fy:-Math.sin(angle)});}
   G.player.fx=1;G.player.fy=.3;G.player.modelAttackUntil=11;
   LegendsActions.emit(G,1,p.x+105,p.y-5,100,0,.7).start=G.time-.2;
   LegendsActions.emit(G,2,p.x-115,p.y+45,82,0,.7).start=G.time-.2;
   LegendsActions.emitElement(G,'lightning',p.x+25,p.y-110,70,0,.7).start=G.time-.2;
   if(LegendsAI){const brute=G.enemies.find(e=>e.kind==='brute');LegendsAI.beginHeavy(brute,p);const spitter=G.enemies.find(e=>e.kind==='spitter');LegendsAI.beginSpit(spitter,p.x-spitter.x,p.y-spitter.y);}
   $('toastWrap').innerHTML='';updateCombatReadability(0);updateHud();updateBars();draw();G.state='qa-still';
  });
  await page.screenshot({path:path.join(output,`combat-${width}.png`),animations:'disabled'});
  check(errors.length===0,`${width}: tree and illustrated combat render without browser errors: ${errors.join(', ')}`);
  await context.close();
 }
 console.log(`Science Legends UI browser: ${checks} checks passed`);
}finally{await browser.close();}
