// Validate unpacking against the real runtime alpha atlases, including known crossed-grid anatomy.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),output=process.env.GAME_SCREENSHOTS||path.join(root,'test-results/legends-atlas');fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1100,height:700}});let checks=0;const timings=[];
function check(value,message){assert.ok(value,message);checks++;}
try{
 await page.route('**/*',route=>{const url=new URL(route.request().url()),f=path.join(root,decodeURIComponent(url.pathname));return fs.existsSync(f)&&fs.statSync(f).isFile()?route.fulfill({path:f}):route.fulfill({body:'<html></html>',contentType:'text/html'});});
 await page.goto('http://atlas.test/');await page.addScriptTag({url:'http://atlas.test/science-legends-atlas.js'});
 for(const [name,columns] of [['heroes',5],['heroes-rear',5],['enemies-clean',6],['enemies-rear',6],['companions',4],['companions-rear',4]]){
  const result=await page.evaluate(async({name,columns})=>{
   const image=new Image();image.src='/assets/science-legends/v2/'+name+'.webp';await image.decode();
   const source=document.createElement('canvas');source.width=image.width;source.height=image.height;const g=source.getContext('2d',{willReadFrequently:true});g.drawImage(image,0,0);
   const pixels=g.getImageData(0,0,source.width,source.height).data,started=performance.now();
   const parsed=LegendsAtlas.extract(pixels,source.width,source.height,columns,4),elapsed=performance.now()-started;
   const board=document.createElement('canvas');board.id='unpacked';board.width=1000;board.height=600;
   board.style.cssText='position:fixed;left:0;top:0;width:1000px;height:600px;';const bg=board.getContext('2d');bg.fillStyle='#14212b';bg.fillRect(0,0,1000,600);bg.font='12px sans-serif';
   const results=[];
   for(let column=0;column<columns;column++)for(let row=0;row<4;row++){
    const frame=parsed.frames[column][row];if(!frame){results.push({column,row,missing:true});continue;}
    const extracted=LegendsAtlas.cropPixels(pixels,source.width,source.height,frame);let core=0;
    for(let i=3;i<extracted.length;i+=4)if(extracted[i]>=64)core++;
    const texture=document.createElement('canvas');texture.width=frame.w;texture.height=frame.h;texture.getContext('2d').putImageData(new ImageData(extracted,frame.w,frame.h),0,0);
    const size=96,x=column*(1000/columns)+500/columns,y=row*140+118,w=frame.w/parsed.nominalWidth*size,h=frame.h/parsed.nominalHeight*size;
    bg.drawImage(texture,x-frame.anchor.x*w,y-frame.anchor.y*h,w,h);bg.fillStyle='#77afaa';bg.fillRect(x-40,y,80,1);bg.fillStyle='#e7d5af';bg.fillText(column+' / '+row,x-25,y+17);
    results.push({column,row,core,expectedCore:frame.pixels,footX:frame.footX,footY:frame.footY,bounds:frame.core});
   }
   document.body.appendChild(board);return {elapsed,missing:parsed.missing,frames:results};
  },{name,columns});
  check(result.missing.length===0&&result.frames.length===columns*4,`${name}: every intended silhouette is recovered as one complete actor`);
  check(result.frames.every(f=>f.core===f.expectedCore),`${name}: isolated runtime textures preserve every selected core pixel and contain no foreign core pixels`);
  if(name==='heroes-rear'){
   const sorc=result.frames.find(f=>f.column===1&&f.row===3),beast=result.frames.find(f=>f.column===2&&f.row===3);
   check(sorc.bounds.x+sorc.bounds.w<=530&&beast.bounds.x<=543,'Rear Sorcerer excludes the neighbor spear tip while Beast Master retains its complete spear');
  }
  if(name==='enemies-rear'){
   const brute=result.frames.find(f=>f.column===3&&f.row===0),mite=result.frames.find(f=>f.column===2&&f.row===0);
   check(brute.bounds.x<=721&&brute.core>=33000&&mite.bounds.x+mite.bounds.w<=685,'Rear Brute recovers its body beyond the nominal grid without leaking that body into Mite');
  }
  if(name==='companions'){
   const bear=result.frames.find(f=>f.column===1&&f.row===3),boar=result.frames.find(f=>f.column===2&&f.row===0);
   check(bear.bounds.x<=292&&bear.core>=56000&&boar.bounds.x<=603,'Bear attack and Boar recover complete anatomy that crossed nominal columns');
  }
  timings.push({name,ms:Math.round(result.elapsed)});
  await page.locator('#unpacked').screenshot({path:path.join(output,`unpacked-${name}.png`)});await page.locator('#unpacked').evaluate(n=>n.remove());
 }
 console.log(`Science Legends atlas browser: ${checks} checks passed; preparation ${JSON.stringify(timings)}`);
}finally{await browser.close();}
