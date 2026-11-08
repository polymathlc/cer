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
  await page.waitForFunction(()=>window.LegendsModels&&LegendsModels.allReady());
  await page.locator('#startBtn').click();
  await page.evaluate(()=>show('pauseOverlay'));
  const frames=await page.evaluate(()=>{
    const recorded=[],real=ctx.drawImage,realHero=LegendsModels.drawHero,sourceCache=new WeakMap();let inHero=false;
    LegendsModels.drawHero=function(...args){inHero=true;try{return realHero.apply(this,args);}finally{inHero=false;}};
    ctx.drawImage=function(image,...args){
      if(inHero){
        const m=this.getTransform();
        const crop=args.length>=8?args.slice(0,4):[0,0,image.naturalWidth||image.width,image.naturalHeight||image.height],key=crop.join(',');
        let entries=sourceCache.get(image);if(!entries){entries=new Map();sourceCache.set(image,entries);}
        let stamp=entries.get(key);
        if(!stamp){
          const sample=document.createElement('canvas');sample.width=Math.ceil(crop[2]);sample.height=Math.ceil(crop[3]);
          const g=sample.getContext('2d');g.drawImage(image,...crop,0,0,sample.width,sample.height);
          const pixels=g.getImageData(0,0,sample.width,sample.height).data;let hash=2166136261,painted=false;
          for(let i=0;i<pixels.length;i++){hash=Math.imul(hash^pixels[i],16777619);if(i%4===3&&pixels[i])painted=true;}
          stamp={hash:hash>>>0,painted};entries.set(key,stamp);
        }
        recorded.push({cls:G.cls,a:m.a,b:m.b,c:m.c,d:m.d,...stamp});
      }
      return real.call(this,image,...args);
    };
    try {
      for(const cls of CLASS_ORDER)for(const face of [[1,0],[-1,0],[0,1],[0,-1]])for(const spin of [false,true]){
        newGame(cls);G.pets=[];G.enemies=[];G.time=1;
        Object.assign(G.player,{fx:face[0],fy:face[1],moving:false,modelAttackUntil:0});
        LegendsModels.advanceFacing(G.player);
        G.spin=spin?{radius:100}:null;draw();
      }
      const poses=[],poseHashes=[];
      for(const settings of [{time:1,moving:false,until:0},{time:0,moving:true,until:0},{time:.15,moving:true,until:0},{time:1,moving:false,until:2}]){
        G.time=settings.time;G.player.moving=settings.moving;G.player.modelAttackUntil=settings.until;draw();
        poses.push(LegendsModels.stateFrame(G.player,G.time,false));poseHashes.push(recorded.at(-1).hash);
      }
      return {recorded,poses,poseHashes,dpr:DPR};
    } finally {ctx.drawImage=real;LegendsModels.drawHero=realHero;}
  });
  check(frames.recorded.length===44,'all five classes render a generated model in all facings and Whirlwind states');
  for(const draw of frames.recorded){
    check(Math.abs(draw.a)===frames.dpr&&draw.d===frames.dpr&&draw.b===0&&draw.c===0,`${draw.cls}: actual sprite draw keeps fixed elevation, scale and upright pose`);
    check(draw.painted,`${draw.cls}: actual actor source paints nontransparent pixels`);
  }
  const classes=new Map();for(const draw of frames.recorded)if(!classes.has(draw.cls))classes.set(draw.cls,draw.hash);
  check(new Set(classes.values()).size===5,'all five classes actually paint distinct generated silhouettes');
  check(JSON.stringify(frames.poses)==='[0,1,2,3]','idle, two stride and attack states render distinct atlas rows');
  check(new Set(frames.poseHashes).size===4,'all four action states paint distinct source pixels even with cached textures');
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
