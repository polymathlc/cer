import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const begin=source.indexOf('const RPG_ITEMS = [');
const end=source.indexOf('const RPG_ITEMS_BY_ID',begin);
assert.ok(begin>=0&&end>begin,'production item catalogue exists');
const items=source.slice(begin,end).split(/\r?\n/).filter(line=>/\bid:\s*"/.test(line)&&/\bslot:\s*"/.test(line)).map(line=>{
  const field=name=>line.match(new RegExp(`\\b${name}:\\s*"([^"]+)"`))?.[1];
  return {id:field('id'),name:field('name'),slot:field('slot'),rarity:field('rarity'),box:field('box'),layer:field('layer')};
});
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root,'rpg-svg-art.js'),'utf8'),context);
const art=context.RpgSvgArt;
assert.equal(items.length,143);
assert.deepEqual([...art.ids].sort(),items.map(it=>it.id).sort(),'every stable id has an authored profile');
assert.ok(Object.isFrozen(art.profiles));
const allIds=new Set();
const normalized=new Set();
let maxBytes=0;
for(const it of items){
  assert.equal(art.profiles[it.id].slot,it.slot,`${it.id} belongs to its production slot`);
  const svg=art.item(it);
  maxBytes=Math.max(maxBytes,svg.length);
  assert.doesNotMatch(svg,/<(?:image|text|foreignObject|script|filter|animate)\b|(?:href|src)=|https?:|NaN|undefined|Infinity/i,`${it.id} is finite, resource-free vector art`);
  assert.ok(svg.length>1800&&svg.length<26000,`${it.id} has substantial but bounded vector detail`);
  const local=new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  for(const id of local){assert.ok(!allIds.has(id),`duplicate id ${id}`);allIds.add(id);}
  for(const m of svg.matchAll(/url\(#([^\)]+)\)/g))assert.ok(local.has(m[1]),`${it.id} owns gradient ${m[1]}`);
  const stable=svg.replace(/rpgv\d+_/g,'LOCAL_');
  assert.ok(!normalized.has(stable),`${it.id} has a distinct drawing`);normalized.add(stable);
  assert.equal(stable,art.item(it).replace(/rpgv\d+_/g,'LOCAL_'),`${it.id} geometry is deterministic`);
  if(it.slot==='pet'){
    const stages=[0,1,2].map(stage=>art.item(it,{stage}).replace(/rpgv\d+_/g,'LOCAL_'));
    assert.equal(new Set(stages).size,3,`${it.id} visibly changes through all three evolution stages`);
    assert.equal(art.item(it,{stage:999}).replace(/rpgv\d+_/g,'LOCAL_'),stages[2]);
    assert.equal(art.item(it,{stage:-1}).replace(/rpgv\d+_/g,'LOCAL_'),stages[0]);
  }
}
for(const slot of ['weapon','shield','armor','helmet','accessory','pet']){
  const future={id:`future_${slot}`,slot};
  assert.match(art.item(future),/rpg-vector-item/,'future items get an intentional slot fallback');
}
assert.equal(art.item(null),'');
assert.equal(art.item({slot:'missing'}),'');
assert.doesNotMatch(art.item({id:'bad-box',slot:'armor',box:'0 0 Infinity -1'}),/Infinity|NaN/);
// More than the cache capacity still produces correct independently scoped defs.
for(let i=0;i<300;i++)assert.match(art.item({id:`future-${i}`,slot:'weapon'}),/rpg-vector-item/);
assert.ok(art.item(items[0]).replace(/rpgv\d+_/g,'LOCAL_')===art.item(items[0]).replace(/rpgv\d+_/g,'LOCAL_'));
console.log(`SVG wardrobe: all ${items.length} items, 48 pet stages, unique scoped gradients; largest ${maxBytes} bytes.`);

// Optional real-browser design audit and review sheets. No network or account.
if(process.argv.includes('--render')){
  const location=process.env.PLAYWRIGHT_MODULE;
  if(!location)throw new Error('PLAYWRIGHT_MODULE is required for --render');
  const {chromium}=await import(pathToFileURL(location).href);
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
    const output=path.resolve(process.env.GAME_SCREENSHOTS||path.join(root,'..','rpg-svg-qa'));
    fs.mkdirSync(output,{recursive:true});
    const slotBoxes={weapon:'-32 -92 64 118',shield:'-26 -32 52 66',armor:'58 106 84 96',helmet:'54 2 92 88',accessory:'60 108 80 100',pet:'10 80 50 54'};
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    for(const slot of Object.keys(slotBoxes)){
      const chosen=items.filter(it=>it.slot===slot);
      const tiles=chosen.map(it=>`<article><div class="art"><svg viewBox="${it.box||slotBoxes[slot]}" xmlns="http://www.w3.org/2000/svg" data-id="${it.id}">${art.item(it)}</svg></div><b>${it.name}</b><small>${it.rarity}</small></article>`).join('');
      await page.setContent(`<html><head><style>body{margin:0;padding:36px;background:#142335;color:#fff6dc;font:14px system-ui}h1{font-size:28px;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(8,1fr);gap:12px}article{min-width:0;padding:12px;border:1px solid #5e7487;border-radius:12px;background:linear-gradient(140deg,#253d50,#182638);text-align:center}.art{height:134px;margin-bottom:9px;background:radial-gradient(ellipse,#587b8455,transparent 70%)}svg{height:100%;max-width:100%;overflow:visible}b{display:block;min-height:34px}small{color:#a9c4ce}</style></head><body><h1>Science Quest · ${slot} · authored SVG catalogue</h1><div class="grid">${tiles}</div></body></html>`);
      const invalid=await page.locator('svg').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.id,box:n.querySelector('.rpg-vector-item').getBBox(),view:n.viewBox.baseVal})).filter(({box:b})=>!(b.width>0&&b.height>0&&Number.isFinite(b.x)&&Number.isFinite(b.y))));
      assert.deepEqual(invalid,[],`${slot} has visible bounded SVG geometry`);
      const clipped=await page.locator('svg').evaluateAll(nodes=>nodes.map(n=>{
        const b=n.querySelector('.rpg-vector-item').getBBox(),v=n.viewBox.baseVal;
        return {id:n.dataset.id,left:v.x-b.x,top:v.y-b.y,right:b.x+b.width-v.x-v.width,bottom:b.y+b.height-v.y-v.height};
      }).filter(row=>[row.left,row.top,row.right,row.bottom].some(n=>n>1.5)));
      assert.deepEqual(clipped,[],`${slot} art stays within its production equipment box`);
      const malformed=await page.locator('svg').evaluateAll(nodes=>nodes.filter(n=>new DOMParser().parseFromString(n.outerHTML,'image/svg+xml').querySelector('parsererror')).map(n=>n.dataset.id));
      assert.deepEqual(malformed,[],`${slot} fragments parse as standalone SVG`);
      await page.screenshot({path:path.join(output,`wardrobe-${slot}.png`),fullPage:true});
    }
    const petTiles=items.filter(it=>it.slot==='pet').flatMap(it=>[0,1,2].map(stage=>`<article><div class="art"><svg viewBox="${it.box||slotBoxes.pet}" xmlns="http://www.w3.org/2000/svg">${art.item(it,{stage})}</svg></div><b>${it.name} · ${stage}</b></article>`)).join('');
    await page.setContent(`<html><head><style>body{padding:24px;background:#182b3c;color:white;font:14px system-ui}.grid{display:grid;grid-template-columns:repeat(9,1fr);gap:12px}article{padding:10px;border:1px solid #647583;border-radius:12px;text-align:center}.art{height:120px}svg{height:100%;max-width:100%}b{display:block}</style></head><body><h1>Pet evolution · every stage remains vector art</h1><div class="grid">${petTiles}</div></body></html>`);
    await page.screenshot({path:path.join(output,'wardrobe-pet-evolution.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(`Browser sheets: ${output}`);
  }finally{await browser.close();}
}
