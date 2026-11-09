import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import models from '../science-legends-models.js';
const html=fs.readFileSync(new URL('../science-legends.html',import.meta.url),'utf8');
function fn(name){let start=html.indexOf('function '+name+'('),open=html.indexOf('{',start),depth=0;for(let i=open;i<html.length;i++){if(html[i]==='{')depth++;if(html[i]==='}'&&--depth===0)return html.slice(start,i+1);}throw Error(name);}
test('upright hero contract preserves size and ground anchor in every class/facing/spin state',()=>{
  const draws=[],w={G:null,heroSheets:[['idle','stride']],customImage:()=>null,window:{},drawSpriteOr:(...args)=>draws.push(args)};
  vm.createContext(w);vm.runInContext(fn('drawActorModel')+'\n'+fn('drawHeroModel'),w);
  for(const cls of ['barb','sorc','beast','pala','ama'])for(const [fx,fy]of [[1,0],[-1,0],[0,1],[0,-1]])for(const spin of [null,{radius:100}]){
    w.G={cls,spin,stats:{},player:{x:200,y:250,r:16,fx,fy,moving:true,animT:1}};w.drawHeroModel();
    const [id,sheet,x,y,size,flip]=draws.at(-1);assert.equal(id,'hero_'+cls);assert.equal(sheet,'idle');assert.equal(x,200);assert.equal(y+size/2,266);assert.equal(size,72);assert.equal(flip,fx<0);
  }
});
test('atlas animation uses simulation time and preserves fixed source dimensions',()=>{
  assert.equal(models.stateFrame({moving:false},1,false),0);
  assert.equal(models.stateFrame({moving:true},0,false),1);
  assert.equal(models.stateFrame({moving:true},.15,false),2);
  assert.equal(models.stateFrame({moving:true,modelAttackUntil:2},1,false),3);
  assert.equal(models.stateFrame({moving:true},.15,true),1);
  const row0=models.sourceRect(1402,1122,5,2,0),row3=models.sourceRect(1402,1122,5,2,3);
  assert.equal(row0.w,row3.w);assert.equal(row0.h,row3.h);assert.equal(row0.x,row3.x);
});
test('foot measurement ignores transparent padding and never rescales raised-weapon frames',()=>{
  const pixels=new Uint8Array(100*100*4);for(let y=10;y<90;y++)for(let x=30;x<70;x++)pixels[(y*100+x)*4+3]=255;
  const anchor=models.footAnchor(pixels,100,100);assert.equal(anchor.y,.89);assert.equal(anchor.x,.495);
});
test('six enemy archetypes select unique columns and halt locomotion under control effects',()=>{
  ['slime','imp','mite','brute','spitter','charger'].forEach((kind,index)=>assert.equal(models.enemyColumn(kind),index));
  assert.equal(models.enemyColumn('boss'),3);assert.equal(models.enemyColumn('unknown'),-1);
  assert.equal(models.enemyFrame({moving:true},.15,false),2);
  assert.equal(models.enemyFrame({moving:true,frozen:1},.15,false),0);
  assert.equal(models.enemyFrame({moving:true,stun:1},.15,false),0);
  assert.equal(models.enemyFrame({moving:true,chargeSt:1},.15,false),3);
  assert.equal(models.enemyFrame({moving:true,chargeSt:1,frozen:1},.15,false),3);
  assert.equal(models.enemyFrame({moving:true,spitWindup:.4,stun:1},.15,false),3);
  assert.equal(models.enemyFrame({moving:true,heavyWindup:.4,frozen:1},.15,false),3);
  assert.equal(models.enemyFrame({moving:true,modelAttackUntil:1},.15,false),3);
});
test('actor depth follows planted feet, remains stable at ties and never mutates simulation arrays',()=>{
  const hero={y:100,r:16},rear={y:80,r:15},front={y:120,r:15},pet={y:100,r:16};
  const entries=[{actor:hero,order:0},{actor:front,order:1},{actor:rear,order:2},{actor:pet,order:3}];
  assert.deepEqual(models.sortActors(entries).map(e=>e.actor),[rear,hero,pet,front]);
  assert.equal(entries[0].actor,hero);assert.equal(entries[1].actor,front);
  front.y=70;assert.deepEqual(models.sortActors(entries).map(e=>e.actor),[front,rear,hero,pet]);
});
test('status badges have deterministic text/shape identities and omit expired effects',()=>{
  assert.deepEqual(models.statuses({frozen:1,stun:1,slowT:1,bleedT:1,dotKind:'poison'}).map(s=>s.kind),['frozen','stun','slow','poison']);
  assert.equal(models.statuses({bleedT:1}).at(0).label,'BLEED');
  assert.equal(models.statuses({bleedT:1,dotKind:'burn'}).at(0).label,'BURN');
  assert.deepEqual(models.statuses({frozen:0,stun:-1,slowT:0,bleedT:0}),[]);
});
test('expired strong damage-over-time does not survive a later weaker application',()=>{
  const w={G:{stats:{poisonMult:1}},Math};vm.createContext(w);vm.runInContext(fn('applyBleed'),w);
  const enemy={bleed:100,bleedT:0,dotKind:'poison'};w.applyBleed(enemy,12,3,'bleed');assert.equal(enemy.bleed,4);assert.equal(enemy.dotKind,'bleed');
  w.applyBleed(enemy,6,3,'poison');assert.equal(enemy.bleed,4);assert.equal(enemy.dotKind,'bleed');
  w.applyBleed(enemy,30,3,'poison');assert.equal(enemy.bleed,10);assert.equal(enemy.dotKind,'poison');
});
test('beast and humanoid companions map to premium sheets with explicit friendly roles',()=>{
  ['wolf','bear','boarpet','hydra'].forEach((kind,index)=>assert.deepEqual(models.companionModel(kind),{sheet:'companion',column:index}));
  assert.deepEqual(models.companionModel('fdef'),{sheet:'hero',column:3});assert.deepEqual(models.companionModel('fmag'),{sheet:'hero',column:1});assert.deepEqual(models.companionModel('decoy','barb'),{sheet:'hero',column:0});
  assert.equal(models.companionRole('fpri'),'HEALER');assert.equal(models.companionModel('unknown'),null);
});
test('visible body picking reaches heads and follows front-to-back depth without altering radii',()=>{
  const back={x:100,y:100,r:21,hp:100,fx:1},front={x:100,y:110,r:21,hp:100,fx:1};
  const bounds=actor=>models.bodyBounds(actor,84,{x:.5,y:.95});
  assert.equal(models.pick([back],100,58,bounds),back);assert.equal(models.pick([back,front],100,80,bounds),front);
  front.dead=true;assert.equal(models.pick([back,front],100,80,bounds),back);assert.equal(models.pick([back],300,300,bounds),null);assert.equal(back.r,21);
});
test('unpacked body bounds use nominal source scale and the same mirrored foot anchor as rendering',()=>{
  const frame={w:320,h:240,nominalWidth:256,nominalHeight:256,anchor:{x:.3,y:.9}},actor={x:100,y:120,r:16,fx:1};
  assert.deepEqual(models.frameBounds(actor,80,frame),{x:70,y:68.5,w:100,h:75});
  actor.fx=-1;assert.deepEqual(models.frameBounds(actor,80,frame),{x:30,y:68.5,w:100,h:75});
  assert.equal(actor.r,16);
});
test('presentation snapshots exclude unavailable images and cannot adopt later live overrides or ground patterns',()=>{
  const first={complete:true,naturalWidth:16},late={complete:false,naturalWidth:0},builtin={complete:true,naturalWidth:320};
  const w={G:null,_ovrImgs:{brute:first,ground:first,slime:late},_barbBuiltin:builtin,groundPat:'first',buildGround(){},window:{LegendsArt:{groundReady:()=>true,ready:()=>true}},LegendsModels:{snapshot:()=>Object.freeze({hero:null})},LegendsActions:{snapshot:()=>Object.freeze({attacks:null})}};
  w.LegendsArt=w.window.LegendsArt;vm.createContext(w);vm.runInContext(['validImage','customImage','ovr','snapshotPresentation'].map(fn).join('\n'),w);
  const profile=w.snapshotPresentation();w.G={presentation:profile};w._ovrImgs.brute={complete:true,naturalWidth:32};w.groundPat='late';late.complete=true;late.naturalWidth=16;
  assert.equal(w.ovr('brute'),first);assert.equal(w.ovr('brute',true),w._ovrImgs.brute);assert.equal(w.ovr('slime'),null);assert.equal(w.ovr('hero_barb'),builtin);assert.equal(profile.groundPattern,'first');assert.equal(profile.generatedGround,false);assert.ok(Object.isFrozen(profile)&&Object.isFrozen(profile.overrides));
  const next=w.snapshotPresentation();assert.equal(next.overrides.brute,w._ovrImgs.brute);assert.equal(next.overrides.slime,late);assert.equal(next.groundPattern,'late');
});
test('direction changes use normalized hysteresis and preserve idle, frozen and stunned facing',()=>{
  const actor={fx:-10,fy:-10};assert.equal(models.advanceFacing(actor),true);
  for(const fy of [-.01,0,.01,.2,-.2]){actor.fx=1;actor.fy=fy;assert.equal(models.advanceFacing(actor),true);}
  actor.fy=1;assert.equal(models.advanceFacing(actor),false);
  actor.fx=actor.fy=0;assert.equal(models.advanceFacing(actor),false);
  actor.fx=.000001;actor.fy=-.000002;assert.equal(models.advanceFacing(actor),false);
  actor.fx=0;actor.fy=-1;actor.frozen=1;assert.equal(models.advanceFacing(actor),false);actor.frozen=0;actor.stun=1;assert.equal(models.advanceFacing(actor),false);
  actor.stun=0;assert.equal(models.advanceFacing(actor),true);
  assert.equal(models.advanceFacing(actor,300,300),false);assert.equal(models.advanceFacing(actor,-300,-300),true);
});
test('actual simulation facing follows committed attack vectors and Stampede velocity',()=>{
  const charge={fx:1,fy:1,chargeSt:1,cvx:-100,cvy:-100},spit={fx:1,fy:1,spitWindup:.4,spitVX:-50,spitVY:-50},heavy={x:100,y:100,fx:1,fy:1,heavyWindup:.4,heavyX:70,heavyY:70},frozen={fx:1,fy:-1,modelRear:false,frozen:1};
  const boar={kind:'boar',vx:1,vy:-1};const w={LegendsModels:models,G:{player:{fx:0,fy:1},pets:[{fx:0,fy:-1}],enemies:[charge,spit,heavy,frozen],projs:[boar]}};
  vm.createContext(w);vm.runInContext(fn('updateModelFacings'),w);w.updateModelFacings();
  assert.equal(w.G.player.modelRear,false);assert.equal(w.G.pets[0].modelRear,true);for(const actor of [charge,spit,heavy,boar])assert.equal(actor.modelRear,true);assert.equal(frozen.modelRear,false);
  for(const actor of [charge,spit,heavy]){actor.fx=1;actor.fy=1;}w.updateModelFacings();for(const actor of [charge,spit,heavy])assert.equal(actor.modelRear,true);
});
