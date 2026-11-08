// Dense real update/draw scenario; local fixtures cannot write rewards or student data.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),output=process.env.GAME_SCREENSHOTS||path.join(root,'test-results/legends-dense');fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});let checks=0;
function check(value,message){assert.ok(value,message);checks++;}
try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<600}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='dense.test')return route.abort();const f=path.join(root,decodeURIComponent(url.pathname));return fs.existsSync(f)&&fs.statSync(f).isFile()?route.fulfill({path:f}):route.abort();});
  await page.goto('http://dense.test/science-legends.html');
  await page.waitForFunction(()=>LegendsModels.ready('hero')&&LegendsModels.ready('enemy')&&LegendsModels.ready('companion')&&(!LegendsModels.allReady||LegendsModels.allReady()));
  await page.locator('.class-card').nth(1).click();await page.locator('#startBtn').click();await page.waitForFunction(()=>G&&G.time>.05);
  const scene=await page.evaluate(()=>{
   G.enemies=[];G.pets=[];G.spawnT=999;G.qTimer=-1000;G.actions=[];G.fx=[];G.wave=8;G.waveT=12;
   const p=G.player;p.hp=p.maxHp=1000000;G.slots=['fireball','nova','chain','orb'];
   for(const sid of G.slots){G.stats.unlocked[sid]=true;G.stats.rank[sid]=3;}
   const kinds=['slime','imp','mite','brute','spitter','charger'];
   // A crowded scene must respect the shipped ranged-role cap. Fill denied
   // ranged slots with a real melee spawn while retaining all66 actors.
   for(let i=0;i<66;i++){const angle=i*2.3999632297,radius=70+Math.sqrt(i/66)*250,e=spawnEnemy(kinds[i%6],i%11===0)||spawnEnemy('brute',i%11===0);Object.assign(e,{x:p.x+Math.cos(angle)*radius,y:p.y+Math.sin(angle)*radius,hp:1000000,maxHp:1000000,speed:20,dmg:1,fx:-Math.cos(angle),fy:-Math.sin(angle)});}
   spawnFollower();for(const kind of ['wolf','bear','boarpet','hydra'])spawnPet(kind,{});for(const pet of G.pets){pet.hp=pet.maxHp=1000000;}
   mouse.active=false;p.fx=1;p.fy=.25;G.cds={};for(let i=0;i<4;i++)castSkill(i);
   for(let frame=0;frame<30;frame++){update(1/120);if(frame%3===0)draw();}
   const brute=G.enemies.find(e=>e.kind==='brute'&&e.frozen<=0),spitter=G.enemies.find(e=>e.kind==='spitter'&&e.frozen<=0);
   if(brute)LegendsAI.beginHeavy(brute,p);if(spitter)LegendsAI.beginSpit(spitter,p.x-spitter.x,p.y-spitter.y);
   G.atkTarget=brute||G.enemies[0];G.qTimer=7;p.hp=p.maxHp=CLASSES[G.cls].hp+G.stats.hpAdd+(p.levelHp||0);
   $('toastWrap').innerHTML='';update(0);updateCombatReadability(0);updateHud();updateBars();updateTargetPanel();draw();
   const before={kills:G.kills,points:G.points,correct:G.correct,answered:G.answered,time:G.time};
   const times=[];for(let frame=0;frame<40;frame++){const t=performance.now();draw();times.push(performance.now()-t);}times.sort((a,b)=>a-b);
   G.state='qa-still';
   return {actors:G.enemies.length,ranged:G.enemies.filter(e=>['spitter','hexer','sentinel'].includes(e.kind)).length,pets:G.pets.length,actions:G.actions.length,fx:G.fx.length,finite:[p,...G.enemies,...G.pets].every(a=>Number.isFinite(a.x)&&Number.isFinite(a.y)),unchanged:JSON.stringify(before)===JSON.stringify({kills:G.kills,points:G.points,correct:G.correct,answered:G.answered,time:G.time}),medianDrawMs:times[Math.floor(times.length/2)],p95DrawMs:times[Math.floor(times.length*.95)]};
  });
  check(scene.actors===66&&scene.pets>=4&&scene.finite,`${width}: dense fight retains finite actors and companions through the shipped update/draw`);
  check(scene.ranged>0&&scene.ranged<=4,`${width}: wave8 retains ranged pressure within its actual role cap`);
  check(scene.actions<=24&&scene.fx<=300,`${width}: simultaneous class effects remain bounded`);
  check(scene.unchanged,`${width}: repeated dense rendering changes no score, reward, question total or simulation time`);
  await page.screenshot({path:path.join(output,`dense-combat-${width}.png`),animations:'disabled'});
  check(errors.length===0,`${width}: dense combat has no browser errors: ${errors.join(', ')}`);
  console.log(JSON.stringify({width,...scene}));await context.close();
 }
 console.log(`Science Legends dense browser: ${checks} checks passed`);
}finally{await browser.close();}
