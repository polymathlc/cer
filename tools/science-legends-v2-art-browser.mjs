// Exercise generated actors/VFX through production adapters and skill events.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.GAME_SCREENSHOTS||path.join(root,'test-results/legends-v2-art');
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});
let checks=0;
function check(value,message){assert.ok(value,message);checks++;}
async function open(failModels=false){
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='v2.test')return route.abort();
    if(failModels&&/v2\/(?:heroes|enemies)\.(?:png|webp)$/.test(url.pathname))return route.abort();
    const review=/v2\/enemies\.(?:png|webp)$/.test(url.pathname)?process.env.LEGENDS_QA_ENEMY_ASSET:/v2\/heroes\.(?:png|webp)$/.test(url.pathname)?process.env.LEGENDS_QA_HERO_ASSET:null;
    const filename=path.join(root,review||decodeURIComponent(url.pathname));
    return fs.existsSync(filename)&&fs.statSync(filename).isFile()?route.fulfill({path:filename}):route.abort();
  });
  await page.goto('http://v2.test/science-legends.html');
  await page.locator('.class-card').nth(1).click();await page.locator('#startBtn').click();
  await page.waitForFunction(()=>G&&G.time>.05&&typeof LegendsModels==='object'&&typeof LegendsActions==='object');
  if(!failModels)await page.waitForFunction(()=>LegendsModels.ready('hero')&&LegendsModels.ready('enemy')&&LegendsModels.ready('companion')&&LegendsActions.ready()&&LegendsActions.ready('elements'));
  await page.evaluate(()=>{G.enemies=[];G.pets=[];G.spawnT=999;G.qTimer=-1000;G.player.hp=G.player.maxHp=100000;});
  return {context,page,errors};
}
try{
  const {context,page,errors}=await open();
  const actors=await page.evaluate(()=>{
    const results=[];
    const c=document.createElement('canvas');c.width=c.height=180;const g=c.getContext('2d',{willReadFrequently:true});
    const board=document.createElement('canvas');board.id='qaActorBoard';board.width=1000;board.height=620;
    board.style.cssText='position:fixed;left:0;top:0;width:1000px;height:620px;z-index:999999;';
    const bg=board.getContext('2d');bg.fillStyle='#14212b';bg.fillRect(0,0,board.width,board.height);bg.font='12px sans-serif';
    const configs=[{moving:false,time:0},{moving:true,time:0},{moving:true,time:.2},{moving:false,time:0,modelAttackUntil:1}];
    for(const [column,cls] of CLASS_ORDER.entries())for(const [row,cfg] of configs.entries()){
      g.clearRect(0,0,180,180);
      const actor={x:90,y:100,r:16,fx:1,...cfg};
      const handled=LegendsModels.drawHero(g,cls,actor,cfg.time,false,72),data=g.getImageData(0,0,180,180).data;
      let count=0,bottom=-1,hash=0;
      for(let i=3;i<data.length;i+=4)if(data[i]>64){count++;bottom=Math.floor((i/4)/180);hash=(hash+data[i-3]*(i%7919)+data[i-2])%2147483647;}
      results.push({cls,row,handled,count,bottom,hash});
      const bx=column*195+100,by=row*140+110;
      bg.fillStyle='#77afaa';bg.fillRect(bx-45,by+16,90,1);
      LegendsModels.drawHero(bg,cls,{...actor,x:bx,y:by},cfg.time,false,90);
      bg.fillStyle='#e7d5af';bg.fillText(cls+' · '+['idle','walk A','walk B','attack'][row],column*195+25,row*140+137);
    }
    document.body.appendChild(board);
    return results;
  });
  check(actors.length===20&&actors.every(a=>a.handled&&a.count>100), 'All five heroes paint all four generated animation states');
  check(actors.every(a=>Math.abs(a.bottom-116)<=3), 'All hero animation frames share a stable painted ground anchor');
  check(['barb','sorc','beast','pala','ama'].every(cls=>new Set(actors.filter(a=>a.cls===cls).map(a=>a.hash)).size>=3), 'Every hero has visibly distinct generated idle, walk and attack frames');
  await page.locator('#qaActorBoard').screenshot({path:path.join(output,'hero-state-contact-sheet.png')});
  await page.evaluate(()=>$('qaActorBoard').remove());
  const enemies=await page.evaluate(()=>{
    const board=document.createElement('canvas');board.id='qaEnemyBoard';board.width=1000;board.height=600;
    board.style.cssText='position:fixed;left:0;top:0;width:1000px;height:600px;z-index:999999;';
    const g=board.getContext('2d');g.fillStyle='#14212b';g.fillRect(0,0,1000,600);g.font='12px sans-serif';
    const out=[];
    for(const [column,kind] of ['slime','imp','mite','brute','spitter','charger'].entries())for(let row=0;row<4;row++){
      const actor={kind,x:column*165+82,y:row*140+110,r:15,fx:1,moving:row===1||row===2,modelAttackUntil:row===3?1:0};
      out.push(LegendsModels.drawEnemy(g,actor,row===2?.2:0,false,90));
      g.fillStyle='#77afaa';g.fillRect(actor.x-45,actor.y+15,90,1);g.fillStyle='#e7d5af';g.fillText(kind+' · '+row,column*165+25,row*140+137);
    }
    document.body.appendChild(board);return out;
  });
  check(enemies.length===24&&enemies.every(Boolean),'All six enemy silhouettes render each generated animation state');
  await page.locator('#qaEnemyBoard').screenshot({path:path.join(output,'enemy-state-contact-sheet.png')});
  await page.evaluate(()=>$('qaEnemyBoard').remove());
  const companions=await page.evaluate(()=>{
    const board=document.createElement('canvas');board.id='qaCompanionBoard';board.width=800;board.height=600;
    board.style.cssText='position:fixed;left:0;top:0;width:800px;height:600px;z-index:999999;';
    const g=board.getContext('2d');g.fillStyle='#14212b';g.fillRect(0,0,800,600);g.font='12px sans-serif';const out=[];
    for(const [column,kind] of ['wolf','bear','boarpet','hydra'].entries())for(let row=0;row<4;row++){
      const actor={kind,x:column*195+98,y:row*140+110,r:15,fx:1,moving:row===1||row===2,modelAttackUntil:row===3?1:0};
      out.push(LegendsModels.drawCompanion(g,actor,row===2?.2:0,false,90,'sorc'));
      g.fillStyle='#77afaa';g.fillRect(actor.x-45,actor.y+15,90,1);g.fillStyle='#e7d5af';g.fillText(kind+' · '+row,column*195+25,row*140+137);
    }
    for(const kind of ['fdef','fmag','fpri','valkyrie','decoy'])out.push(LegendsModels.drawCompanion(g,{kind,x:20,y:20,r:10,fx:1},0,false,32,'sorc'));
    document.body.appendChild(board);return out;
  });
  check(companions.length===21&&companions.every(Boolean),'Every beast animation and humanoid follower uses a generated model');
  await page.locator('#qaCompanionBoard').screenshot({path:path.join(output,'companion-state-contact-sheet.png')});
  await page.evaluate(()=>$('qaCompanionBoard').remove());
  const override=await page.evaluate(async()=>{
    const tile=document.createElement('canvas');tile.width=tile.height=16;const g=tile.getContext('2d');g.fillStyle='#d334e7';g.fillRect(0,0,16,16);
    const image=new Image();image.src=tile.toDataURL();await image.decode();_ovrImgs.boar=image;
    const previousGame=G,previousSheets=heroSheets;newGame(G.cls);heroSheets=buildHeroSprites(CLASSES[G.cls].sprite);
    const original=ctx.drawImage,adapter=LegendsModels.drawCompanion;let seen=0,adapterCalls=0;
    ctx.drawImage=function(...args){if(args[0]===image)seen++;return original.apply(this,args);};
    LegendsModels.drawCompanion=function(...args){adapterCalls++;return adapter.apply(this,args);};
    try{drawPetModel({kind:'boarpet',x:G.player.x,y:G.player.y,r:16,animT:0,fx:1},60);}finally{ctx.drawImage=original;LegendsModels.drawCompanion=adapter;delete _ovrImgs.boar;G=previousGame;heroSheets=previousSheets;}
    return seen===1&&adapterCalls===0;
  });
  check(override,'A boarpet respects the boar administrator override that was ready when its run started');
  const skills=await page.evaluate(()=>{
    const result=[];
    for(const [cls,sid] of [['barb','cleave'],['sorc','fireball'],['sorc','nova'],['sorc','orb'],['sorc','chain'],['ama','plague'],['pala','holybolt'],['ama','multishot']]){
      newGame(cls);heroSheets=buildHeroSprites(CLASSES[cls].sprite);G.pets=[];G.spawnT=999;G.qTimer=-1000;
      G.slots=[sid,null,null,null];G.stats.unlocked[sid]=true;
      for(let i=0;i<3;i++){const e=spawnEnemy('brute',false);e.x=G.player.x+55+i*20;e.y=G.player.y;e.speed=e.dmg=0;e.hp=e.maxHp=1000000;}
      mouse.active=false;G.player.fx=1;G.player.fy=0;
      castSkill(0);if(G.projs.length)updateProjectiles(.5);
      result.push({sid,actions:G.actions.map(a=>({sheet:a.sheet||'attacks',row:a.row,family:a.family}))});
    }
    return result;
  });
  for(const [sid,sheet,row] of [['cleave','attacks',0],['fireball','attacks',1],['nova','attacks',2],['orb','attacks',3],['chain','elements',0],['plague','elements',1],['holybolt','elements',2],['multishot','elements',3]]){
    check(skills.find(s=>s.sid===sid)?.actions.some(a=>a.sheet===sheet&&a.row===row), `${sid}: real skill events reach their generated VFX family`);
  }
  const effects=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=c.height=400;const g=c.getContext('2d'),records=[];
    const original=g.drawImage.bind(g);g.drawImage=function(...args){records.push(args.slice(1));return original(...args);};
    const hashes=[];
    for(const sheet of ['attacks','elements'])for(let row=0;row<4;row++)for(let frame=0;frame<4;frame++){
      g.clearRect(0,0,400,400);
      const action={sheet,row,x:200,y:200,r:80,ang:0,start:0,life:1};
      LegendsActions.draw(g,action,frame*.25+.01,false);
      const pixels=g.getImageData(0,0,400,400).data;let hash=0;
      for(let i=0;i<pixels.length;i+=16)hash=(hash+pixels[i]*(i%7907)+pixels[i+3])%2147483647;
      hashes.push({sheet,row,frame,hash});
    }
    return {records,hashes};
  });
  check(effects.records.length===32&&effects.records.every(r=>Math.abs((r[6]/r[7])-(r[2]/r[3]))<.001), 'Every VFX frame preserves its source aspect ratio');
  check(['attacks','elements'].every(sheet=>[0,1,2,3].every(row=>new Set(effects.hashes.filter(h=>h.sheet===sheet&&h.row===row).map(h=>h.hash)).size===4)), 'All eight effect families paint four distinct generated frames');
  await page.evaluate(()=>{
    const board=document.createElement('canvas');board.id='qaEffectBoard';board.width=900;board.height=760;
    board.style.cssText='position:fixed;left:0;top:0;width:900px;height:760px;z-index:999999;';
    const g=board.getContext('2d');g.fillStyle='#14212b';g.fillRect(0,0,900,760);g.font='12px sans-serif';
    for(const [sheetIndex,sheet] of ['attacks','elements'].entries())for(let row=0;row<4;row++)for(let frame=0;frame<4;frame++){
      const x=frame*220+110,y=(sheetIndex*4+row)*94+47;
      LegendsActions.draw(g,{sheet,row,x,y,r:43,ang:0,start:0,life:1},frame*.25+.01,false);
      g.fillStyle='#e7d5af';g.fillText(sheet+' '+row+'/'+frame,x-65,y+43);
    }
    document.body.appendChild(board);
  });
  await page.locator('#qaEffectBoard').screenshot({path:path.join(output,'effect-frame-contact-sheet.png')});
  await page.evaluate(()=>$('qaEffectBoard').remove());
  await page.evaluate(()=>{G.actions=[];LegendsActions.emit(G,1,G.player.x,G.player.y,90,0,2);});
  await page.keyboard.press('Escape');
  const paused=await page.evaluate(()=>({time:G.time,frame:LegendsActions.sample(G.actions[0],G.time,false).frame,hp:G.enemies.map(e=>e.hp)}));
  await page.waitForTimeout(100);
  const purity=await page.evaluate(()=>{for(let i=0;i<30;i++)draw();return {time:G.time,frame:LegendsActions.sample(G.actions[0],G.time,false).frame,hp:G.enemies.map(e=>e.hp)};});
  check(paused.time===purity.time&&paused.frame===purity.frame, 'Pause freezes generated animation at its simulation-time frame');
  check(JSON.stringify(paused.hp)===JSON.stringify(purity.hp), 'Repeated VFX rendering applies no gameplay damage');
  await page.screenshot({path:path.join(output,'combat-paused.png')});
  check(errors.length===0,'Generated actors and all VFX families run without browser errors: '+errors.join(', '));
  await context.close();
  const fallback=await open(true);
  const safe=await fallback.page.evaluate(()=>{G.spin={t:1,radius:100};draw();return !LegendsModels.ready('hero')&&!LegendsModels.ready('enemy')&&G.player.hp>0;});
  check(safe&&fallback.errors.length===0,'Missing model atlases retain the upright gameplay fallback');
  await fallback.context.close();
  console.log(`Science Legends v2 art browser: ${checks} checks passed`);
}finally{await browser.close();}
