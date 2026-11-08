import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import models from '../science-legends-models.js';
const html=fs.readFileSync(new URL('../science-legends.html',import.meta.url),'utf8');
function fn(name){let start=html.indexOf('function '+name+'('),open=html.indexOf('{',start),depth=0;for(let i=open;i<html.length;i++){if(html[i]==='{')depth++;if(html[i]==='}'&&--depth===0)return html.slice(start,i+1);}throw Error(name);}
test('upright hero contract preserves size and ground anchor in every class/facing/spin state',()=>{
  const draws=[],w={G:null,heroSheets:[['idle','stride']],_ovrImgs:{},window:{},drawSpriteOr:(...args)=>draws.push(args)};
  vm.createContext(w);vm.runInContext(fn('drawActorModel')+'\n'+fn('drawHeroModel'),w);
  for(const cls of ['barb','sorc','beast','pala','ama'])for(const [fx,fy]of [[1,0],[-1,0],[0,1],[0,-1]])for(const spin of [null,{radius:100}]){
    w.G={cls,spin,player:{x:200,y:250,r:16,fx,fy,moving:true,animT:1}};w.drawHeroModel();
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
