// Compare actual simulation decisions across presentation choices and exercise
// the real portal visibility publisher with a real same-origin game iframe.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),output=process.env.GAME_SCREENSHOTS||path.join(root,'test-results/legends-session');fs.mkdirSync(output,{recursive:true});
const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),publisher=app.match(/function notifyLegendsSurfaceVisibility\(force\) \{[\s\S]*?\r?\n\}/)?.[0];assert.ok(publisher,'actual parent publisher exists');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;};
const parent=`<!doctype html><style>html,body{margin:0;width:100%;height:100%}#appWrapper,#page-legends,iframe{width:100%;height:100%;border:0}.page:not(.active){display:none}</style><div id="appWrapper"><div id="page-legends" class="page active"><iframe id="legendsFrame" src="science-legends.html"></iframe></div></div><iframe id="sibling" srcdoc="<p>sibling</p>" style="position:absolute;width:1px;height:1px;left:-10px"></iframe><script>${publisher};notifyLegendsSurfaceVisibility(true);</script>`;
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='legends-session.test')return route.abort();if(u.pathname==='/parent.html')return route.fulfill({contentType:'text/html',body:parent});const file=path.join(root,decodeURIComponent(u.pathname));return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.abort();});
  await page.goto('http://legends-session.test/science-legends.html');await page.waitForFunction(()=>LegendsModels.allReady());await page.locator('#startBtn').click();await page.waitForFunction(()=>G&&G.time>.05);
  const replay=await page.evaluate(()=>{
    const originalRandom=Math.random,crit=rollCrit,spawn=spawnEnemy,kill=killEnemy,rows=[];
    try{
      for(const variant of [{draws:0,mute:false,reduced:false},{draws:3,mute:false,reduced:false},{draws:1,mute:true,reduced:false},{draws:2,mute:true,reduced:true}]){
        let seed=0x71a39c;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
        lowMotion=variant.reduced;muted=variant.mute;newGame('sorc');hide('menuOverlay');G.state='qa-manual';G.enemies=[];G.pets=[];G.qTimer=-1000;G.spawnT=.05;G.player.hp=G.player.maxHp=100000;G.stats.regen=0;G.stats.crit=.5;G.stats.unlocked.chain=true;G.stats.unlocked.nova=true;G.slots=['chain','nova'];G.stats.mods={};G.stats.poisonMult=1;
        const decisions={crit:[],spawn:[],kills:[]};
        window.rollCrit=function(){const r=crit();decisions.crit.push(r);return r;};
        window.spawnEnemy=function(...args){const e=spawn.apply(this,args);if(e)decisions.spawn.push({kind:e.kind,x:e.x,y:e.y,hp:e.hp,elite:e.elite});return e;};
        window.killEnemy=function(e,...args){decisions.kills.push({kind:e.kind,goldBefore:G.gold});return kill.call(this,e,...args);};
        for(let i=0;i<24;i++){const e=spawnEnemy('brute',i%6===0),a=i*2.3999;Object.assign(e,{x:G.player.x+Math.cos(a)*70,y:G.player.y+Math.sin(a)*70,hp:20,maxHp:20,stun:100,dmg:0,xp:1});}
        G.state='play';
        for(let i=0;i<360;i++){if(i%90===0){G.cds.chain=0;castSkill(0);}if(i===90||i===240){G.cds.nova=0;castSkill(1);}update(1/120);for(let j=0;j<variant.draws;j++)draw();}
        G.state='qa-manual';rows.push({variant,decisions,state:{time:G.time,hp:G.player.hp,level:G.level,xp:G.xp,gold:G.gold,kills:G.kills,orbs:G.orbs.map(o=>({x:o.x,y:o.y,kind:o.kind})),enemies:G.enemies.map(e=>({kind:e.kind,x:e.x,y:e.y,hp:e.hp,dead:e.dead}))}});
        window.rollCrit=crit;window.spawnEnemy=spawn;window.killEnemy=kill;
      }
      return rows;
    }finally{Math.random=originalRandom;window.rollCrit=crit;window.spawnEnemy=spawn;window.killEnemy=kill;}
  });
  fs.writeFileSync(path.join(output,'replay.json'),JSON.stringify(replay,null,2));
  check(replay[0].decisions.crit.length>0&&replay[0].state.kills>=20&&replay[0].decisions.spawn.length>24,'R31: replay exercises real criticals, kills, drops and later random spawning');
  const reference=JSON.stringify({decisions:replay[0].decisions,state:replay[0].state});
  for(const row of replay.slice(1))check(JSON.stringify({decisions:row.decisions,state:row.state})===reference,'R31: extra drawing, audio mute and reduced motion preserve actual seeded combat/spawn/drop decisions: '+JSON.stringify(row.variant));
  await page.goto('http://legends-session.test/parent.html');
  const frame=page.frameLocator('#legendsFrame');await frame.locator('#startBtn').waitFor();const child=page.frames().find(f=>f.url().includes('/science-legends.html'));await child.waitForFunction(()=>LegendsModels.allReady());await child.evaluate(()=>{newGame('barb');heroSheets=buildHeroSprites(CLASSES.barb.sprite);hide('menuOverlay');});await child.waitForFunction(()=>G&&G.time>.05);
  await child.evaluate(()=>{G.enemies=[];G.pets=[];G.qTimer=-1000;G.spawnT=999;G.player.hp=G.player.maxHp=100000;window.__paintCount=0;const original=draw;window.draw=function(...args){window.__paintCount++;return original.apply(this,args);};});
  async function snapshot(){return child.evaluate(()=>({time:G.time,paint:window.__paintCount,x:G.player.x,y:G.player.y,held:!!keys.w||mouse.lDown||mouse.rDown,hidden:document.hidden,paused:$('pauseOverlay').classList.contains('show')}));}
  await frame.locator('#game').focus();await page.keyboard.down('w');await page.waitForTimeout(100);const held=await snapshot();
  await page.evaluate(()=>{document.getElementById('page-legends').classList.remove('active');notifyLegendsSurfaceVisibility();});await page.waitForTimeout(80);const off=await snapshot();await page.waitForTimeout(250);const frozen=await snapshot();
  check(held.held&&!off.held&&!off.hidden,'R32: hiding the portal surface clears a real held movement key even while child document.hidden isfalse');
  check(frozen.time===off.time&&frozen.paint===off.paint,'R32: real parent publisher stops CSS-hidden child simulation and painting');
  await child.evaluate(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true}));canvas.dispatchEvent(new PointerEvent('pointerdown',{clientX:100,clientY:100,pointerId:23,button:0,bubbles:true}));castSkill(0);evade();});const blocked=await snapshot();check(blocked.time===frozen.time&&!blocked.held,'R32: hidden input and cast/evade requests cannot arm held controls');
  await page.evaluate(()=>{document.getElementById('page-legends').classList.add('active');});await page.waitForTimeout(100);const stillOff=await snapshot();check(stillOff.time===frozen.time,'R32: visible intersection cannot override explicit parent-inactive state');
  // Real sibling messages have the correct origin but the wrong source window.
  await page.evaluate(()=>{document.getElementById('sibling').contentWindow.eval("parent.document.getElementById('legendsFrame').contentWindow.postMessage({type:'SD_GAME_VISIBILITY',mode:'legends',active:true},parent.location.origin)");});await page.waitForTimeout(60);check((await snapshot()).time===frozen.time,'R32: a sibling cannot forge the parent active signal');
  await child.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'SD_GAME_VISIBILITY',mode:'legends',active:true},source:window.parent,origin:'https://wrong-origin.test'})));await page.waitForTimeout(60);check((await snapshot()).time===frozen.time,'R32: wrong-origin messages cannot resume the game');
  await page.evaluate(()=>notifyLegendsSurfaceVisibility());await page.waitForTimeout(130);const resumed=await snapshot();check(resumed.time>frozen.time&&resumed.time-frozen.time<.25&&!resumed.held,'R32: returning resumes safely with no accumulated hidden-time catch-up or held input');
  await page.keyboard.up('w');
  // IO fallback covers callers that hide a container without using navigation.
  await page.evaluate(()=>document.getElementById('page-legends').style.display='none');await page.waitForTimeout(80);const ioBefore=await snapshot();await page.waitForTimeout(180);const ioAfter=await snapshot();check(ioBefore.time===ioAfter.time&&ioBefore.paint===ioAfter.paint,'R32: IntersectionObserver fallback independently stops an unannounced CSS-hidden surface');
  await page.evaluate(()=>document.getElementById('page-legends').style.display='');await page.waitForTimeout(100);check((await snapshot()).time>ioAfter.time,'R32: IO fallback resumes when an otherwise active surface reappears');
  await child.evaluate(()=>show('pauseOverlay'));await page.evaluate(()=>{document.getElementById('page-legends').classList.remove('active');notifyLegendsSurfaceVisibility();});await page.waitForTimeout(100);await page.evaluate(()=>{document.getElementById('page-legends').classList.add('active');notifyLegendsSurfaceVisibility();});await page.waitForTimeout(100);const manual=await snapshot();await page.waitForTimeout(100);const manualLater=await snapshot();check(manual.paused&&manual.time===manualLater.time,'R32: manually opened pause survives navigation away and back');
  check(errors.length===0,'session checks leave no browser errors: '+errors.join(', '));fs.writeFileSync(path.join(output,'session.json'),JSON.stringify({replay,visibility:{held,off,frozen,blocked,stillOff,resumed,ioBefore,ioAfter,manual,manualLater},errors},null,2));console.log(`Science Legends session browser: ${checks} checks passed`);
}finally{await browser.close();}
