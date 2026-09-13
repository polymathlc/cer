import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = slug => readFileSync(new URL(`../science-${slug}.html`, import.meta.url), 'utf8');
function fn(text, name) {
  const start=text.indexOf(`function ${name}(`);
  assert.ok(start>=0,`${name} exists`);
  let depth=0,open=text.indexOf('{',start);
  // The exercised mechanics have no brace-containing strings or templates.
  for(let i=open;i<text.length;i++){
    if(text[i]==='{')depth++;
    if(text[i]==='}'&&--depth===0)return text.slice(start,i+1);
  }
  throw Error(`Unclosed ${name}`);
}
function world(slug, functions){
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,style:{},classList:{add(){},remove(){},contains(){return false;}},getContext(){return {fillRect(){},beginPath(){},arc(){},fill(){}}},width:150,height:150});return nodes.get(id);};
  const state={G:{state:'play',player:{x:100,y:100,r:16,fx:0,fy:1,dashT:0,hp:100},evadeTrail:[],enemies:[],ap:10},
    keys:{w:true},joyVec:{on:true,x:1,y:0},mouse:{lDown:true,rDown:true},lowMotion:false,
    $:node,overlayOpen:()=>false,moveInput:()=>({x:3,y:4}),ringFx(){},sfx(){},Event:class{},window:{dispatchEvent(){}},
    noteAction(n){state.G.ap-=n;if(state.G.ap===0)state.G.state='feed-loading';},
    nextDepth(){state.G.wave=(state.G.wave||1)+1;state.G.stairs=null;},
    clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2,
    WORLD:{w:2300,h:2300},TILE:46,MAPW:50,MAPH:50,map:null,Math,Uint8Array};
  vm.createContext(state);for(const f of functions)vm.runInContext(fn(source(slug),f),state);return state;
}
for(const slug of ['legends','slayers']){
  test(`${slug}: full shipped inline script parses`,()=>{const s=source(slug);new vm.Script(s.split('<script>')[1].split('</script>')[0]);});
  test(`${slug}: evade normalizes input, has a cooldown and cannot stack`,()=>{
    const w=world(slug,['evade']);assert.equal(w.evade(),true);assert.equal(w.G.player.evadeX,.6);assert.equal(w.G.player.evadeY,.8);assert.equal(w.G.player.evadeCd,5);assert.equal(w.evade(),false);assert.equal(w.G.ap,slug==='slayers'?9:10);
  });
  test(`${slug}: evade uses facing when stationary and respects class dash, pause and loading`,()=>{
    const w=world(slug,['evade']);w.moveInput=()=>({x:0,y:0});w.G.player.dashT=.1;assert.equal(w.evade(),false);w.G.player.dashT=0;w.overlayOpen=()=>true;assert.equal(w.evade(),false);w.overlayOpen=()=>false;w.G.state='feed-loading';assert.equal(w.evade(),false);w.G.state='play';assert.equal(w.evade(),true);assert.equal(w.G.player.evadeY,1);
  });
  test(`${slug}: opening overlays resets mouse, joystick, keyboard and queued movement`,()=>{
    const w=world(slug,['clearCombatInput','show','hide']);w.G.moveTarget={x:4,y:5};w.G.atkTarget={};w.show('pauseOverlay');assert.deepEqual(Object.keys(w.keys),[]);assert.equal(w.joyVec.on,false);assert.equal(w.mouse.rDown,false);assert.equal(w.mouse.lDown,false);assert.equal(w.G.moveTarget,null);assert.equal(w.G.atkTarget,null);
  });
  test(`${slug}: charge warning commits the direction before the enemy moves`,()=>{
    const w=world(slug,['lockCharge']);const e={speed:100};w.lockCharge(e,3,4);assert.equal(e.chargeSt,1);assert.equal(e.chargeT,.7);assert.equal(e.cvx,276);assert.equal(e.cvy,368);
    const update=fn(source(slug),'updateEnemies');const windup=update.slice(update.indexOf('e.chargeSt === 1'),update.indexOf('e.chargeSt === 1')+260);assert.ok(!windup.includes('cvx = dx'),'telegraph must not retarget at launch');
  });
  test(`${slug}: evade lasts 0.2 seconds and travels at most 130 units`,()=>{
    const w=world(slug,['moveEvade']);w.moveActor=(p,dx,dy)=>{p.x+=dx;p.y+=dy;};Object.assign(w.G.player,{evadeT:.2,evadeX:1,evadeY:0});for(let i=0;i<5;i++)w.moveEvade(w.G.player,.05);assert.ok(Math.abs(w.G.player.x-230)<.0001);assert.equal(w.G.player.evadeT,0);
  });
  test(`${slug}: evasion prevents hits without granting a shield or reward`,()=>{
    const w=world(slug,['hurtPlayer']);w.G.player.evadeT=.1;w.hurtPlayer(50);assert.equal(w.G.player.hp,100);assert.equal(w.G.player.shield,undefined);assert.equal(w.G.gold,undefined);
  });
}
test('Slayers: evade reaching zero action points waits for the learning question',()=>{const w=world('slayers',['evade']);w.G.ap=1;assert.equal(w.evade(),false);assert.equal(w.G.ap,0);assert.equal(w.G.state,'feed-loading');assert.equal(w.G.player.evadeT,undefined);});
test('Slayers: stairs require proximity, active play and explicit confirmation',()=>{
  const w=world('slayers',['clearCombatInput','nearStairs','descend']);w.G.stairs={x:500,y:500};assert.equal(w.descend(),false);w.G.stairs={x:120,y:120};w.overlayOpen=()=>true;assert.equal(w.descend(),false);w.overlayOpen=()=>false;assert.equal(w.descend(),true);assert.equal(w.G.wave,2);assert.equal(w.descend(),false);
});
test('Slayers: movement cannot automatically abandon the current floor',()=>{const w=world('slayers',['nearStairs','doSpawning']);w.G.stairs={x:100,y:100};w.doSpawning(.1);assert.equal(w.G.wave,undefined);assert.equal(w.$('descendBtn').hidden,false);});
test('Slayers: minimap sight does not reveal rooms through walls',()=>{
  const w=world('slayers',['revealDungeon']);w.MAPW=w.MAPH=12;w.TILE=10;w.map=new Uint8Array(144);for(let y=0;y<12;y++)w.map[y*12+6]=1;w.G.player={x:45,y:55};w.revealDungeon();assert.equal(w.G.explored[5*12+5],1);assert.equal(w.G.explored[5*12+6],1);assert.equal(w.G.explored[5*12+7],0);assert.equal(w.G.explored[5*12+9],0);
});
test('Slayers: dodge uses collision-aware movement even with a long frame',()=>{
  const w=world('slayers',['solidAt','moveActor','moveEvade']);w.TILE=46;w.map=new Uint8Array(2500);w.map[2*50+3]=1;Object.assign(w.G.player,{x:118,y:110,evadeT:.2,evadeX:1,evadeY:0});w.moveEvade(w.G.player,.05);assert.equal(w.G.player.x,118);
});
