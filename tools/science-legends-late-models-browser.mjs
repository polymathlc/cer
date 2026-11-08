// Slow images must not replace the hero/enemy presentation halfway through a run.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),output=process.env.GAME_SCREENSHOTS||path.join(root,'test-results/legends-late-models');fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});let checks=0;const failures=[];
function check(value,message){if(!value){if(process.env.LEGENDS_LATE_MODEL_DIAGNOSTIC)failures.push(message);else assert.ok(value,message);}checks++;}
try{
 for(const [index,cls] of [[0,'barb'],[1,'sorc']]){
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),held=[],errors=[];let holding=true;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());if(url.hostname!=='late.test')return route.abort();
   if(holding&&(/\/v2\/(?:heroes|enemies|companions)(?:-rear|-clean)?\.(?:png|webp)$/.test(url.pathname)||/\/courtyard-slate\.(?:png|webp)$/.test(url.pathname))){held.push(route);return;}
   const f=path.join(root,decodeURIComponent(url.pathname));return fs.existsSync(f)&&fs.statSync(f).isFile()?route.fulfill({path:f}):route.abort();
  });
  await page.goto('http://late.test/science-legends.html',{waitUntil:'domcontentloaded'});
  await page.locator('.class-card').nth(index).click();await page.locator('#startBtn').click();await page.waitForFunction(()=>G&&G.time>.05);
  await page.evaluate(()=>{
   G.enemies=[];G.pets=[];G.spawnT=999;G.qTimer=-1000;G.player.moving=false;G.player.fx=1;G.player.fy=1;G.player.modelAttackUntil=0;
   const e=spawnEnemy('brute',false);e.x=G.player.x+130;e.y=G.player.y;e.speed=0;e.hp=e.maxHp=10000;e.moving=false;e.fx=-1;e.fy=1;
   show('pauseOverlay');window.__lateImages=[];
   window.__captureLateModels=function(){
    const records=[],raw=ctx.drawImage,hero=drawHeroModel,enemy=drawEnemyModel;let actor=null,role='';
    drawHeroModel=function(){actor=G.player;role='hero';hero();actor=null;};drawEnemyModel=function(e,size){actor=e;role='enemy';enemy(e,size);actor=null;};
    ctx.drawImage=function(...args){
     if(actor){
      const image=args[0],m=ctx.getTransform(),foot=LegendsView.worldToScreen(G.view,actor.x,actor.y+actor.r),c=document.createElement('canvas');c.width=c.height=192;const g=c.getContext('2d');
      g.setTransform(m.a/DPR,m.b/DPR,m.c/DPR,m.d/DPR,m.e/DPR-foot.x+96,m.f/DPR-foot.y+128);g.drawImage(...args);
      const pixels=g.getImageData(0,0,192,192).data;let left=192,right=-1,top=192,bottom=-1;
      for(let i=3;i<pixels.length;i+=4)if(pixels[i]>64){const p=i/4|0,x=p%192,y=p/192|0;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
      let identity=__lateImages.indexOf(image);if(identity<0){identity=__lateImages.length;__lateImages.push(image);}
      records.push({role,identity,source:image.src?(image.src.startsWith('data:')?'built-in data image':image.src):'canvas',sourceWidth:image.naturalWidth||image.width,sourceHeight:image.naturalHeight||image.height,bounds:{left,right,top,bottom},data:c.toDataURL()});
     }
     return raw.apply(this,args);
    };
    try{draw();}finally{ctx.drawImage=raw;drawHeroModel=hero;drawEnemyModel=enemy;}
    return records;
   };
  });
  const before=await page.evaluate(()=>__captureLateModels());
  const initialGround=await page.evaluate(()=>Array.from(ctx.getImageData(30*DPR,30*DPR,1,1).data));
  holding=false;for(const route of held){const f=path.join(root,decodeURIComponent(new URL(route.request().url()).pathname));await route.fulfill({path:f});}
  await page.waitForFunction(()=>LegendsModels.ready('hero')&&LegendsModels.ready('enemy')&&LegendsModels.ready('companion'));
  const after=await page.evaluate(()=>__captureLateModels());
  const decodedGround=await page.evaluate(()=>Array.from(ctx.getImageData(30*DPR,30*DPR,1,1).data));
  check(JSON.stringify(initialGround)===JSON.stringify(decodedGround),`${cls}: late default courtyard decoding does not replace the active-run arena`);
  for(const role of ['hero','enemy']){
   const a=before.find(r=>r.role===role),b=after.find(r=>r.role===role);
   check(a&&b&&a.identity===b.identity,`${cls}: late assets do not replace the ${role} texture in the active run`);
   check(a&&b&&JSON.stringify(a.bounds)===JSON.stringify(b.bounds),`${cls}: late assets preserve the painted ${role} size and planted-foot position`);
   for(const [phase,value] of [['before',a],['after',b]])if(value)fs.writeFileSync(path.join(output,`${cls}-${role}-${phase}.png`),Buffer.from(value.data.split(',')[1],'base64'));
  }
  const groundBefore=await page.evaluate(()=>{draw();return Array.from(ctx.getImageData(30*DPR,30*DPR,1,1).data);});
  await page.evaluate(cls=>{
    const tile=document.createElement('canvas');tile.width=tile.height=32;const g=tile.getContext('2d');g.fillStyle='#e331a6';g.fillRect(0,0,32,32);
    applyLegendsAssets({['hero_'+cls]:tile.toDataURL(),brute:tile.toDataURL(),ground:tile.toDataURL()});
  },cls);
  await page.waitForFunction(cls=>_ovrImgs['hero_'+cls]?.complete&&_ovrImgs.brute?.complete&&_ovrImgs.ground?.complete,cls);
  const custom=await page.evaluate(()=>({models:__captureLateModels(),ground:Array.from(ctx.getImageData(30*DPR,30*DPR,1,1).data)}));
  check(before.every(a=>custom.models.find(b=>b.role===a.role)?.identity===a.identity),`${cls}: late saved administrator images do not replace active-run actors`);
  check(JSON.stringify(groundBefore)===JSON.stringify(custom.ground),`${cls}: late saved ground art does not replace the active-run arena`);
  const fresh=await page.evaluate(cls=>{
    newGame(cls);heroSheets=buildHeroSprites(CLASSES[cls].sprite);G.enemies=[];G.pets=[];G.spawnT=999;G.qTimer=-1000;
    const e=spawnEnemy('brute',false);e.x=G.player.x+130;e.y=G.player.y;e.speed=0;
    const models=__captureLateModels();return {models,ground:Array.from(ctx.getImageData(30*DPR,30*DPR,1,1).data)};
  },cls);
  check(fresh.models.every(a=>custom.models.find(b=>b.role===a.role)?.identity!==a.identity),`${cls}: the next run can adopt the newly ready administrator art`);
  check(JSON.stringify(fresh.ground)!==JSON.stringify(custom.ground),`${cls}: the next run can adopt the newly ready ground art`);
  check(errors.length===0,`${cls}: delayed decoding does not throw in the game renderer`);
  console.log(JSON.stringify({cls,before:before.map(({data,...rest})=>rest),after:after.map(({data,...rest})=>rest)}));
  await context.close();
 }
 console.log(process.env.LEGENDS_LATE_MODEL_DIAGNOSTIC?`Science Legends late-model browser: ${checks} diagnostic checks evaluated; failures ${JSON.stringify(failures)}`:`Science Legends late-model browser: ${checks} checks passed`);
}finally{await browser.close();}
