// Observe real painted matrices and source identity across all four facing quadrants.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),output=process.env.GAME_SCREENSHOTS||path.join(root,'test-results/legends-facing');fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});let checks=0;
function check(value,message){assert.ok(value,message);checks++;}
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='facing.test')return route.abort();const f=path.join(root,decodeURIComponent(url.pathname));return fs.existsSync(f)&&fs.statSync(f).isFile()?route.fulfill({path:f}):route.abort();});
 await page.goto('http://facing.test/science-legends.html');
 await page.waitForFunction(()=>LegendsModels.ready('hero')&&LegendsModels.ready('enemy')&&LegendsModels.ready('companion')&&(!LegendsModels.allReady||LegendsModels.allReady()));
 const results=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=192;const g=canvas.getContext('2d',{willReadFrequently:true}),images=[];
  const specs=[...CLASS_ORDER.map(key=>({kind:'hero',key})),...['slime','imp','mite','brute','spitter','charger'].map(key=>({kind:'enemy',key})),...['wolf','bear','boarpet','hydra','fdef','fmag','fpri','valkyrie','decoy'].map(key=>({kind:'pet',key}))];
  function capture(spec,actor,profile,time=0){
   LegendsModels.advanceFacing(actor);
   g.clearRect(0,0,192,192);const original=g.drawImage;let result=null;
   g.drawImage=function(...args){const m=g.getTransform(),image=args[0],length=args.length,sw=length===9?args[3]:(image.naturalWidth||image.width),sh=length===9?args[4]:(image.naturalHeight||image.height),dw=args[length-2],dh=args[length-1];let id=images.indexOf(image);if(id<0){id=images.length;images.push(image);}result={source:id+':'+(length===9?args.slice(1,5).join(','):'full'),a:m.a,b:m.b,c:m.c,d:m.d,sx:Math.hypot(m.a,m.b)*dw/sw,sy:Math.hypot(m.c,m.d)*dh/sh};return original.apply(this,args);};
   let handled;
   try{handled=spec.kind==='hero'?LegendsModels.drawHero(g,spec.key,actor,time,false,96,profile):spec.kind==='enemy'?LegendsModels.drawEnemy(g,actor,time,false,96,profile):LegendsModels.drawCompanion(g,actor,time,false,96,'sorc',profile);}finally{g.drawImage=original;}
   const pixels=g.getImageData(0,0,192,192).data;let bottom=-1,hash=0;
   for(let i=3;i<pixels.length;i+=4)if(pixels[i]>64){bottom=Math.max(bottom,Math.floor(i/4/192));hash=(hash+pixels[i-3]*(i%7907)+pixels[i-2])%2147483647;}
   return {...result,handled,bottom,hash};
  }
  const pinned=LegendsModels.snapshot(),partial=Object.freeze({...pinned,heroRear:null,enemyRear:null,companionRear:null}),rearOnly=Object.freeze({...pinned,hero:null,enemy:null,companion:null});
  const results=specs.map(spec=>{
   const base={kind:spec.key,x:96,y:100,r:16,moving:false,frozen:0,stun:0,chargeSt:0,modelAttackUntil:0};
   const quadrants={};for(const [key,fx,fy] of [['SE',1,1],['SW',-1,1],['NW',-1,-1],['NE',1,-1]])quadrants[key]=capture(spec,{...base,fx,fy});
   const actor={...base,fx:-1,fy:-1},rear=[capture(spec,actor)];for(const fy of [-.01,0,.01,-.01,0]){actor.fy=fy;rear.push(capture(spec,actor));}
   actor.fy=1;const front=[capture(spec,actor)];for(const fy of [.01,0,-.01,.01,0]){actor.fy=fy;front.push(capture(spec,actor));}
   const fallbackActor={...base,fx:1,fy:-1},fallback=capture(spec,fallbackActor,partial),fallbackAgain=capture(spec,fallbackActor,partial),orphanRear=capture(spec,{...base,fx:-1,fy:-1},rearOnly);
   const animated=[];for(const fy of [1,-1])for(const [row,time] of [[0,0],[1,0],[2,.2],[3,0]])animated.push(capture(spec,{...base,fx:1,fy,moving:row===1||row===2,modelAttackUntil:row===3?1:0},undefined,time));
   return {spec,quadrants,rear,front,fallback,fallbackAgain,orphanRear,animated};
  });
  const board=document.createElement('canvas');board.id='qaFacingBoard';board.width=1000;board.height=650;board.style.cssText='position:fixed;left:0;top:0;width:1000px;height:650px;z-index:999999';const bg=board.getContext('2d');bg.fillStyle='#14212b';bg.fillRect(0,0,1000,650);bg.font='12px sans-serif';
  CLASS_ORDER.forEach((cls,row)=>{[['SE',1,1],['SW',-1,1],['NW',-1,-1],['NE',1,-1]].forEach(([label,fx,fy],column)=>{const actor={x:column*245+123,y:row*125+95,r:16,fx,fy,moving:false};LegendsModels.advanceFacing(actor);LegendsModels.drawHero(bg,cls,actor,0,false,96);bg.fillStyle='#77afaa';bg.fillRect(actor.x-45,actor.y+16,90,1);bg.fillStyle='#e7d5af';bg.fillText(cls+' · '+label,column*245+65,row*125+124);});});document.body.appendChild(board);
  return results;
 });
 for(const result of results){
  const label=result.spec.kind+'/'+result.spec.key,q=result.quadrants;
  check(Object.values(q).every(p=>p.handled)&&q.SE.a>0&&q.SW.a<0&&q.NW.a>0&&q.NE.a<0,`${label}: native SE front and NW rear mirror correctly in all four quadrants`);
  check(q.SE.source===q.SW.source&&q.NW.source===q.NE.source&&q.SE.source!==q.NW.source,`${label}: north movement uses the matching rear model rather than backpedalling in front view`);
  check(Object.values(q).every(p=>Math.abs(p.b)<1e-9&&Math.abs(p.c)<1e-9&&p.d>0&&Math.abs(p.sx-q.SE.sx)<.001&&Math.abs(p.sy-q.SE.sy)<.001&&Math.abs(p.bottom-116)<=4),`${label}: yaw changes preserve camera elevation, source scale and planted feet`);
  check(result.rear.every(p=>p.source===result.rear[0].source)&&result.front.every(p=>p.source===result.front[0].source)&&result.rear[0].source!==result.front[0].source,`${label}: near-horizontal idle aim does not flicker between front and rear`);
  check(result.fallback.source===q.SE.source&&result.fallback.a>0&&result.fallbackAgain.source===result.fallback.source,`${label}: a pinned missing-rear profile keeps its front source and correct front mirror rule`);
  check(!result.orphanRear.handled,`${label}: a rear-only partial profile never introduces a mismatched premium body`);
  check(new Set(result.animated.slice(0,4).map(p=>p.hash)).size===4&&new Set(result.animated.slice(4).map(p=>p.hash)).size===4,`${label}: front and rear each paint four distinct idle/walk/attack frames`);
  check(result.animated.every(p=>p.handled&&Math.abs(p.sx-q.SE.sx)<.001&&Math.abs(p.sy-q.SE.sy)<.001&&Math.abs(p.bottom-116)<=4),`${label}: walking and attacking keep the same source scale and ground anchor in both views`);
 }
 await page.locator('#qaFacingBoard').screenshot({path:path.join(output,'hero-facing-contact-sheet.png')});
 check(errors.length===0,'Directional models produce no browser errors: '+errors.join(', '));
 console.log(`Science Legends facing browser: ${checks} checks passed`);
}finally{await browser.close();}
