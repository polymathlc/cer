// Independent observed work and player-facing feedback checks for rounds16/18–20.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.GAME_SCREENSHOTS || path.join(root, 'test-results/legends-feedback');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0; const check = (value, label) => { assert.ok(value, label); checks++; };
const all = [];
try {
  for (const viewport of [{width:1280,height:900},{width:390,height:844},{width:320,height:568}]) {
    const page = await browser.newPage({viewport, deviceScaleFactor:viewport.width<600?2:1,hasTouch:viewport.width<600}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='legends-feedback.test')return route.abort();const file=path.join(root,decodeURIComponent(url.pathname));return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.abort();});
    await page.goto('http://legends-feedback.test/science-legends.html');
    await page.locator('#startBtn').click();await page.waitForFunction(()=>G&&G.time>.05);
    const cooldown=await page.evaluate(async()=>{
      newGame('sorc');hide('menuOverlay');G.state='qa-manual';G.enemies=[];G.pets=[];G.qTimer=-1000;G.spawnT=999;muted=true;lowMotion=false;
      G.slots=['fireball','chain','nova','orb'];G.slots.forEach(s=>{G.stats.unlocked[s]=true;G.cds[s]=skillCd(s)*.8;});renderSkillBar();
      const shades=Array.from(document.querySelectorAll('#skillBar .cd-shade')),records=[],observer=new MutationObserver(rs=>records.push(...rs));shades.forEach(n=>observer.observe(n,{attributes:true}));
      for(let i=0;i<120;i++){update(1/120);if(i%2===0)paintSkillCooldowns(false);}paintSkillCooldowns(false);await Promise.resolve();observer.disconnect();
      const playing=shades.map((shade,i)=>{const animation=shade.getAnimations()[0],sid=G.slots[i];return{state:animation&&animation.playState,current:animation&&animation.currentTime,expected:(1-G.cds[sid]/skillCd(sid))*1000,inline:shade.style.transform};});
      G.state='pause';const pauseBefore=shades.map(n=>n.getAnimations()[0]?.currentTime);await new Promise(r=>setTimeout(r,150));const pauseAfter=shades.map(n=>n.getAnimations()[0]?.currentTime);
      const oldAnimations=shades.flatMap(n=>n.getAnimations());G.slots=['fireball','nova'];renderSkillBar();const cancelled=oldAnimations.every(a=>a.playState==='idle');
      lowMotion=true;const fallbackShades=Array.from(document.querySelectorAll('#skillBar .cd-shade')),fallbackRecords=[],fallbackObserver=new MutationObserver(rs=>fallbackRecords.push(...rs));fallbackShades.forEach(n=>fallbackObserver.observe(n,{attributes:true}));
      for(let i=0;i<120;i++){update(1/120);if(i%2===0)paintSkillCooldowns(false);}await Promise.resolve();fallbackObserver.disconnect();
      const fallbackAnimations=fallbackShades.flatMap(n=>n.getAnimations()).length;
      G.slots.forEach(s=>G.cds[s]=0);updateSkillCds();const ready=Array.from(document.querySelectorAll('#skillBar .skill-slot')).filter(n=>n.querySelector('.cd')).every(n=>n.classList.contains('ready')&&n.querySelector('.cd').style.display==='none');lowMotion=false;
      return{mutations:records.length,playing,pauseBefore,pauseAfter,cancelled,fallbackMutations:fallbackRecords.length,fallbackAnimations,ready};
    });
    check(cooldown.mutations===0,'R16: four active cooldown shades produce no inline mutations during120 simulation steps');
    check(cooldown.playing.every(a=>a.state==='paused'&&Math.abs(a.current-a.expected)<.001),'R16: compositor shades show actual simulation cooldown progress');
    check(JSON.stringify(cooldown.pauseBefore)===JSON.stringify(cooldown.pauseAfter),'R16: pause does not let cooldown shading drift on wall time');
    check(cooldown.cancelled,'R16: replacing a loadout cancels old shade animations');
    check(cooldown.fallbackAnimations===0&&cooldown.fallbackMutations<=24,'R16: reduced-motion fallback has a bounded10Hz style cadence');
    check(cooldown.ready,'R16: actual ready cooldowns immediately remove their shade and expose readiness');
    const damage=await page.evaluate(()=>{
      newGame('barb');hide('menuOverlay');G.state='qa-manual';G.enemies=[];G.pets=[];G.qTimer=-1000;G.spawnT=999;muted=true;
      const e=spawnEnemy('brute',false);Object.assign(e,{x:G.player.x+60,y:G.player.y,hp:10000,maxHp:10000});
      for(let i=0;i<20;i++)dealDamage(e,1,{continuous:true,noSplash:true});dealDamage(e,7,{continuous:true,noSplash:true,crit:true});
      const first={hp:e.hp,count:G.texts.length,value:G.texts[0].txt,big:G.texts[0].big,color:G.texts[0].color};
      G.time+=.23;dealDamage(e,3,{continuous:true,noSplash:true});const batches=G.texts.map(t=>t.txt);
      for(let i=0;i<100;i++)addText(e.x+i,e.y,String(i),'#fff',false,0);const cap=G.texts.length;dealDamage(e,2,{continuous:true,noSplash:true});const detached=G.texts[G.texts.length-1].txt===2;
      update(1);G.time+=1;dealDamage(e,4,{continuous:true,noSplash:true});const afterExpiry=G.texts[G.texts.length-1].txt;
      const hp=e.hp;newGame('barb');G.state='qa-manual';return{first,batches,cap,detached,afterExpiry,hp,resetCount:G.texts.length};
    });
    check(damage.first.hp===9973&&damage.first.count===1&&damage.first.value===27,'R18:21 actual same-target hits preserve all damage but coalesce into one accurate callout');
    check(damage.first.big&&damage.first.color==='#FFD54F','R18: a critical inside a normal batch retains its emphasis');
    check(damage.batches.join(',')==='27,3','R18: hits after220ms start a new readable batch');
    check(damage.cap===60&&damage.detached&&damage.afterExpiry===4&&damage.resetCount===0,'R18: caps, expiry and restart never mutate detached callouts');
    const labels=await page.evaluate(()=>{
      G.enemies=[];G.pets=[];G.player.x=1200;G.player.y=1200;G.view=LegendsView.create(1200,1200,VW,VH,WORLD.w,WORLD.h);G.camX=G.view.x;G.camY=G.view.y;
      const foes=[];for(let i=0;i<60;i++){const e=spawnEnemy('mite',false);Object.assign(e,{x:1200+(i%10-4.5)*31,y:1200+(Math.floor(i/10)-2.5)*42,hp:50,maxHp:100,hitFlash:i<3?.1:0});foes.push(e);}
      const important=[foes[40],foes[41],foes[42],foes[43],foes[44],foes[45]];foes[40].elite=true;foes[41].boss=true;G.atkTarget=foes[42];mouse.over=foes[43];foes[44].heavyWindup=.2;foes[45].spitWindup=.2;
      const paints=[],fill=ctx.fillRect;ctx.fillRect=function(x,y,w,h){if(h===4&&['#ef7770','#ce93d8'].includes(this.fillStyle))paints.push({x:x+w/(2*.5),y,w,h,color:this.fillStyle});return fill.apply(this,arguments);};
      try{drawActors(G.view.x,G.view.y);}finally{ctx.fillRect=fill;}
      const identified=paints.map(p=>foes.findIndex(e=>Math.abs(e.x-p.x)<.01&&Math.abs(e.y+e.r-actorHeight({kind:'enemy',actor:e})-8-p.y)<.01));return{paints:paints.length,identified,important:important.map(e=>foes.indexOf(e)),near:[0,1,2],limit:VW<600?12:24};
    });
    check(labels.paints<=labels.limit+6,'R19: ordinary crowd bars stay bounded while six important threats retain priority');
    check(labels.important.every(i=>labels.identified.includes(i)),'R19: selected/hovered/elite/boss/committed-attack bars are actually painted: '+JSON.stringify(labels));
    // Caption boxes are measured from native canvas paints, then compared with
    // actual visible HUD rectangles rather than the renderer cache's counters.
    const captions=await page.evaluate(()=>{
      G.enemies=[];G.pets=[];G.atkTarget=null;mouse.over=null;updateTargetPanel();updateBars();updateCombatReadability(0);draw();
      const canvasBox=canvas.getBoundingClientRect(),ids=['pBars','skillBar','skillSelBtn','evadeBtn','hintBar','joy','qTimer','battleStatus','targetPanel','toastWrap'],nodes=ids.map(id=>document.getElementById(id)).concat([document.querySelector('.touch-aim-hint'),document.querySelector('.beta-ribbon')]);
      const blocked=nodes.filter(n=>n&&!n.hidden).map(n=>n.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0).map(r=>({left:(r.left-canvasBox.left)*VW/canvasBox.width,top:(r.top-canvasBox.top)*VH/canvasBox.height,right:(r.right-canvasBox.left)*VW/canvasBox.width,bottom:(r.bottom-canvasBox.top)*VH/canvasBox.height}));
      const points=blocked.map(b=>({x:(b.left+b.right)/2,y:(b.top+b.bottom)/2})).concat([{x:4,y:4},{x:VW-4,y:VH-4},{x:VW/2,y:VH/2}]);const records=[];
      const fill=ctx.fillRect;let paint=null;ctx.fillRect=function(x,y,w,h){if(h===18)paint={x,y,w,h};return fill.apply(this,arguments);};
      try{points.forEach(p=>{const world=LegendsView.screenToWorld(G.view,p.x,p.y);paint=null;const value=drawThreatCaption(world.x,world.y,'SMASH','#ffe5b6');records.push({anchor:p,paint,value});});}finally{ctx.fillRect=fill;}
      const overlap=(p,b)=>p.x+p.w>b.left+.1&&p.x<b.right-.1&&p.y+p.h>b.top+.1&&p.y<b.bottom-.1;
      return{blocked,records,failures:records.filter(r=>!r.paint||r.paint.x<0||r.paint.y<0||r.paint.x+r.paint.w>VW||r.paint.y+r.paint.h>VH||blocked.some(b=>overlap(r.paint,b)))};
    });
    fs.writeFileSync(path.join(output,`feedback-${viewport.width}.json`),JSON.stringify({viewport,cooldown,damage,labels,captions,errors},null,2));
    check(captions.failures.length===0,`R20: every actual caption paint stays within${viewport.width}px combat view and avoids visible controls (${JSON.stringify(captions.failures)})`);
    check(captions.records.every(r=>Math.abs(r.value.anchorX-r.anchor.x)<.001&&Math.abs(r.value.anchorY-r.anchor.y)<.001),'R20: relocated captions retain their true world-source anchor');
    check(errors.length===0,'feedback checks leave no browser errors: '+errors.join(', '));all.push({viewport,cooldown,damage,labels,captionsChecked:captions.records.length});await page.close();
  }
  console.log(JSON.stringify(all));console.log(`Science Legends feedback browser: ${checks} checks passed`);
}finally{await browser.close();}
