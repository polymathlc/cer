// Observe the shipped canvas transform and real pointer handlers, not a camera stub.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.GAME_SCREENSHOTS || path.join(root, 'test-results/legends-projection');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
function close(a,b) { return Math.abs(a-b)<.01; }
async function open(width,height,dpr) {
  const context = await browser.newContext({ viewport:{width,height},deviceScaleFactor:dpr });
  const page = await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='projection.test')return route.abort();
    const filename=path.join(root,decodeURIComponent(url.pathname));
    return fs.existsSync(filename)?route.fulfill({path:filename}):route.abort();
  });
  await page.goto('http://projection.test/science-legends.html');
  await page.locator('.class-card').nth(1).click();
  await page.locator('#startBtn').click();
  await page.waitForFunction(()=>G&&G.time>.05);
  await page.evaluate(()=>{
    G.enemies=[];G.pets=[];G.spawnT=999;G.qTimer=-1000;G.player.hp=G.player.maxHp=100000;
    window.__projectionFrames=[];
    const original=LegendsArt.drawGround;
    LegendsArt.drawGround=function(g,...args){
      const m=g.getTransform();
      __projectionFrames.push({a:m.a/DPR,b:m.b/DPR,c:m.c/DPR,d:m.d/DPR,e:m.e/DPR,f:m.f/DPR});
      if(__projectionFrames.length>50)__projectionFrames.shift();
      return original.call(this,g,...args);
    };
    window.__readProjection=function(){draw();return __projectionFrames.at(-1);};
  });
  return {context,page,errors};
}
try {
  for(const [width,height,dpr] of [[1280,900,1],[390,844,2],[3000,2600,1]]){
    const {context,page,errors}=await open(width,height,dpr);
    const label=`${width}×${height} DPR${dpr}`;
    const initial=await page.evaluate(()=>__readProjection());
    check(initial&&close(initial.a,1)&&close(initial.d,1)&&close(initial.b,0)&&close(initial.c,0),`${label}: world uses a fixed orthographic angle and unit scale`);
    const shaken=await page.evaluate(()=>{
      G.shake=.6;const frames=[];
      for(let i=0;i<12;i++)frames.push(__readProjection());
      return frames;
    });
    check(shaken.every(m=>close(m.e,initial.e)&&close(m.f,initial.f)),`${label}: strong hits never move the camera independently of the player`);
    const actionFrames=await page.evaluate(()=>{
      const frames=[];
      hurtPlayer(5);frames.push(__readProjection());
      G.cds={};castSkill(0);frames.push(__readProjection());
      for(const direction of [[1,0],[0,1],[-1,0],[0,-1]]){
        G.player.fx=direction[0];G.player.fy=direction[1];frames.push(__readProjection());
      }
      return frames;
    });
    check(actionFrames.every(m=>close(m.a,initial.a)&&close(m.b,0)&&close(m.c,0)&&close(m.d,initial.d)),`${label}: hurt, casting and four facings preserve perspective`);
    const centered=await page.evaluate(()=>{
      const m=__readProjection();
      return {x:m.a*WORLD.w/2+m.c*WORLD.h/2+m.e,y:m.b*WORLD.w/2+m.d*WORLD.h/2+m.f,w:VW,h:VH,ww:WORLD.w,wh:WORLD.h};
    });
    if(centered.w>centered.ww)check(close(centered.x,centered.w/2),`${label}: a viewport wider than the world centers the arena`);
    if(centered.h>centered.wh)check(close(centered.y,centered.h/2),`${label}: a viewport taller than the world centers the arena`);
    // Click the exact rendered position of a small enemy during a hit flash.
    // The same check runs after CSS scales canvas presentation independently of its bitmap.
    for(const scaled of [false,true]){
      const aimed=await page.evaluate(scaled=>{
        canvas.style.width=scaled?'75%':'100%';canvas.style.height=scaled?'80%':'100%';
        G.enemies=[];G.projs=[];G.shake=.6;
        const p=G.player,e=spawnEnemy('mite',false);
        Object.assign(e,{x:p.x+70,y:p.y-25,speed:0,hp:10000,maxHp:10000});
        const m=__readProjection(),r=canvas.getBoundingClientRect();
        const sx=m.a*e.x+m.c*e.y+m.e,sy=m.b*e.x+m.d*e.y+m.f;
        const x=r.left+sx/VW*r.width,y=r.top+sy/VH*r.height;
        canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0,clientX:x,clientY:y}));
        const result={selected:G.atkTarget===e,x:mouse.wx,y:mouse.wy,ex:e.x,ey:e.y};
        window.dispatchEvent(new PointerEvent('pointerup',{pointerType:'mouse',button:0}));
        return result;
      },scaled);
      check(aimed.selected&&close(aimed.x,aimed.ex)&&close(aimed.y,aimed.ey),`${label}: ${scaled?'CSS-scaled':'normal'} canvas targets the visibly clicked enemy during impact`);
    }
    await page.evaluate(()=>{canvas.style.width='100%';canvas.style.height='100%';G.enemies=[];G.shake=0;});
    const retained=await page.evaluate(()=>({x:G.player.x,y:G.player.y,time:G.time,cls:G.cls}));
    const resized=width<600?{width:844,height:390}:{width:960,height:740};
    await page.setViewportSize(resized);
    await page.waitForFunction(()=>VW===$('stage').clientWidth&&VH===$('stage').clientHeight);
    const resizedState=await page.evaluate(()=>({x:G.player.x,y:G.player.y,time:G.time,cls:G.cls,m:__readProjection()}));
    check(close(resizedState.x,retained.x)&&close(resizedState.y,retained.y)&&resizedState.cls===retained.cls&&resizedState.time>=retained.time,`${label}: resize/orientation preserves the current hero and world position`);
    check(close(resizedState.m.a,1)&&close(resizedState.m.d,1)&&close(resizedState.m.b,0)&&close(resizedState.m.c,0),`${label}: live resize/orientation changes the viewport without changing perspective`);
    const before=await page.evaluate(()=>({x:G.player.x,y:G.player.y}));
    await page.keyboard.down('d');await page.waitForTimeout(160);await page.keyboard.up('d');
    const moved=await page.evaluate(()=>({x:G.player.x,m:__readProjection()}));
    check(moved.x>before.x&&close(moved.m.a,1)&&close(moved.m.d,1),`${label}: real keyboard movement advances the player without zooming`);
    await page.keyboard.press('Escape');
    const paused=await page.evaluate(()=>({time:G.time,m:__readProjection()}));
    await page.waitForTimeout(80);
    const pausedAfter=await page.evaluate(()=>({time:G.time,m:__readProjection()}));
    check(close(paused.time,pausedAfter.time)&&close(paused.m.e,pausedAfter.m.e)&&close(paused.m.f,pausedAfter.m.f),`${label}: pause has no camera drift or simulation debt`);
    await page.screenshot({path:path.join(output,`projection-${width}-dpr${dpr}.png`)});
    check(errors.length===0,`${label}: no runtime errors: ${errors.join(', ')}`);
    await context.close();
  }
  console.log(`Science Legends projection browser: ${checks} checks passed`);
} finally {await browser.close();}
