import test from 'node:test';
import assert from 'node:assert/strict';
import ai from '../science-legends-ai.js';
import variety from '../science-legends-variety.js';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../science-legends.html',import.meta.url),'utf8');
function fn(name){let start=html.indexOf('function '+name+'('),open=html.indexOf('{',start),depth=0;for(let i=open;i<html.length;i++){if(html[i]==='{')depth++;if(html[i]==='}'&&--depth===0)return html.slice(start,i+1);}throw Error(name);}
function loadEnemyUpdate(w){
  Object.assign(w,{LegendsVariety:variety,addHostileHazard(){},spawnEnemyChild(){},addText(){}});
  vm.createContext(w);vm.runInContext(fn('varietyContext')+'\n'+fn('updateEnemies'),w);
}
test('Spitter locks aim and releases exactly once after its complete windup',()=>{
  const enemy={hp:10};assert.equal(ai.beginSpit(enemy,3,4),true);assert.equal(ai.beginSpit(enemy,-1,0),false);
  assert.equal(ai.advanceSpit(enemy,.2),null);assert.equal(enemy.spitWindup,.2);
  const shot=ai.advanceSpit(enemy,.2);assert.deepEqual(shot,{vx:156,vy:208});assert.equal(ai.advanceSpit(enemy,1),null);
  assert.equal(enemy.spitRecovery,.22);assert.equal(enemy.shootCd,2.3);
});
test('control effects pause a committed shot and death cancels it permanently',()=>{
  const enemy={hp:10};ai.beginSpit(enemy,1,0);enemy.frozen=1;assert.equal(ai.advanceSpit(enemy,1),null);assert.equal(enemy.spitWindup,.4);
  enemy.frozen=0;enemy.stun=1;assert.equal(ai.advanceSpit(enemy,1),null);assert.equal(enemy.spitWindup,.4);
  enemy.stun=0;enemy.dead=true;assert.equal(ai.advanceSpit(enemy,1),null);assert.equal(enemy.spitPending,false);
});
test('real enemy update braces, keeps locked aim and emits one projectile after windup',()=>{
  const enemy={kind:'spitter',x:100,y:100,r:13,hp:100,speed:10,dmg:10,shootCd:0,hitCd:0,animT:0,frozen:0,stun:0,bleedT:0,slowT:0,kt:0};
  const w={G:{time:0,enemies:[enemy],player:{x:200,y:100,r:16,thorns:0},pets:[],auras:[],eprojs:[]},LegendsAI:ai,MOB_TYPES:{spitter:{ranged:true}},WORLD:{w:2300,h:2300},Math,buildGrid(){},separate(){},nearestTarget:()=>w.G.player,dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),hurtPlayer(){},dealDamage(){}};
  loadEnemyUpdate(w);w.updateEnemies(.01);assert.equal(w.G.eprojs.length,0);assert.equal(enemy.spitWindup,.4);
  const x=enemy.x;w.G.player.x=100;w.G.player.y=200;w.updateEnemies(.2);assert.equal(enemy.x,x);assert.equal(w.G.eprojs.length,0);
  enemy.frozen=1;w.updateEnemies(.2);assert.equal(enemy.spitWindup,.2);assert.equal(w.G.eprojs.length,0);
  enemy.frozen=0;w.updateEnemies(.2);assert.equal(w.G.eprojs.length,1);assert.ok(w.G.eprojs[0].vx>259);assert.equal(w.G.eprojs[0].vy,0);
  w.updateEnemies(.1);assert.equal(w.G.eprojs.length,1);
});
test('heavy attacks commit to one target area, allow evasion and enforce recovery',()=>{
  const enemy={hp:100,x:100,y:100,r:21},target={hp:100,x:135,y:100,r:16};
  assert.equal(ai.beginHeavy(enemy,target),true);assert.equal(ai.advanceHeavy(enemy,.2),null);
  target.y=200;const strike=ai.advanceHeavy(enemy,.25);assert.equal(ai.heavyHits(strike),false);assert.equal(ai.advanceHeavy(enemy,.2),null);assert.equal(ai.beginHeavy(enemy,target),false);
  enemy.heavyRecovery=0;target.y=100;ai.beginHeavy(enemy,target);const hit=ai.advanceHeavy(enemy,.45);assert.equal(ai.heavyHits(hit),true);
  target.hp=0;assert.equal(ai.heavyHits(hit),false);
});
test('real heavy-enemy update deals no early damage and only one committed contact hit',()=>{
  const enemy={kind:'brute',x:100,y:100,r:21,hp:100,speed:10,dmg:10,hitCd:0,animT:0,frozen:0,stun:0,bleedT:0,slowT:0,kt:0};let hits=0;
  const w={G:{time:0,enemies:[enemy],player:{hp:100,x:135,y:100,r:16,thorns:0},pets:[],auras:[],eprojs:[]},LegendsAI:ai,MOB_TYPES:{brute:{}},WORLD:{w:2300,h:2300},Math,buildGrid(){},separate(){},nearestTarget:()=>w.G.player,dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),hurtPlayer(){hits++;},dealDamage(){},actionFx(){}};
  loadEnemyUpdate(w);w.updateEnemies(.01);assert.equal(hits,0);const x=enemy.x;
  w.updateEnemies(.2);assert.equal(hits,0);assert.equal(enemy.x,x);w.updateEnemies(.25);assert.equal(hits,1);w.updateEnemies(.2);assert.equal(hits,1);assert.ok(enemy.heavyRecovery>0);
});
