// Independent evaluator: inspect the actual generated model draw matrices and poses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.GAME_SCREENSHOTS || path.join(root, 'test-results/legends-review');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless:true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? {channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL} : {}) });
let checks=0;
function check(value,message){assert.ok(value,message);checks++;}
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='legends-review.test')return route.abort();
    const file=path.join(root,url.pathname);
    return fs.existsSync(file)?route.fulfill({path:file}):route.abort();
  });
  await page.goto('http://legends-review.test/science-legends.html');
  await page.waitForFunction(()=>window.LegendsModels&&LegendsModels.ready('hero')&&LegendsModels.ready('enemy'));
  await page.locator('#startBtn').click();
  await page.evaluate(()=>show('pauseOverlay'));
  const frames=await page.evaluate(()=>{
    const recorded=[],real=ctx.drawImage;
    ctx.drawImage=function(image,...args){
      if(String(image.src||'').includes('/v2/heroes.png')){
        const m=this.getTransform();
        recorded.push({cls:G.cls,a:m.a,b:m.b,c:m.c,d:m.d,sx:args[0],sy:args[1],sw:args[2],sh:args[3]});
      }
      return real.call(this,image,...args);
    };
    try {
      for(const cls of CLASS_ORDER)for(const face of [[1,0],[-1,0],[0,1],[0,-1]])for(const spin of [false,true]){
        newGame(cls);G.pets=[];G.enemies=[];G.time=1;
        Object.assign(G.player,{fx:face[0],fy:face[1],moving:false,modelAttackUntil:0});
        G.spin=spin?{radius:100}:null;draw();
      }
      const poses=[];
      for(const settings of [{time:1,moving:false,until:0},{time:0,moving:true,until:0},{time:.15,moving:true,until:0},{time:1,moving:false,until:2}]){
        G.time=settings.time;G.player.moving=settings.moving;G.player.modelAttackUntil=settings.until;draw();
        poses.push(recorded.at(-1).sy/recorded.at(-1).sh);
      }
      return {recorded,poses,dpr:DPR};
    } finally {ctx.drawImage=real;}
  });
  check(frames.recorded.length===44,'all five classes render a generated model in all facings and Whirlwind states');
  for(const draw of frames.recorded){
    check(Math.abs(draw.a)===frames.dpr&&draw.d===frames.dpr&&draw.b===0&&draw.c===0,`${draw.cls}: actual sprite draw keeps fixed elevation, scale and upright pose`);
    const col=['barb','sorc','beast','pala','ama'].indexOf(draw.cls);
    check(Math.abs(draw.sx/draw.sw-col)<1e-8,`${draw.cls}: generated sprite uses its own class column`);
  }
  check(JSON.stringify(frames.poses)==='[0,1,2,3]','idle, two stride and attack states render distinct atlas rows');
  const before=await page.evaluate(()=>({time:G.time,row:LegendsModels.stateFrame(G.player,G.time,false)}));
  await page.waitForTimeout(150);
  check(await page.evaluate(b=>G.time===b.time&&LegendsModels.stateFrame(G.player,G.time,false)===b.row,before),'paused simulation freezes model animation');
  await page.evaluate(()=>{
    newGame('sorc');G.pets=[];G.enemies=[];G.spawnT=999;G.time=1;
    const types=['slime','imp','mite','brute','spitter','charger'];
    types.forEach((type,i)=>{const e=spawnEnemy(type,i===3);e.x=G.player.x+(i-2.5)*96;e.y=G.player.y+(i%2?100:-75);e.speed=0;});
    G.state='qa-frozen';hide('pauseOverlay');
    draw();
  });
  await page.screenshot({path:path.join(output,'review-models.png')});
  check(errors.length===0,'premium renderer has no uncaught browser errors: '+errors.join(', '));
  console.log(`${checks} independent generated-model browser checks passed`);
} finally {await browser.close();}
