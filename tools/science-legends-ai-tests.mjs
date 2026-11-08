import test from 'node:test';
import assert from 'node:assert/strict';
import ai from '../science-legends-ai.js';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../science-legends.html',import.meta.url),'utf8');
function fn(name){let start=html.indexOf('function '+name+'('),open=html.indexOf('{',start),depth=0;for(let i=open;i<html.length;i++){if(html[i]==='{')depth++;if(html[i]==='}'&&--depth===0)return html.slice(start,i+1);}throw Error(name);}
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
  vm.createContext(w);vm.runInContext(fn('updateEnemies'),w);w.updateEnemies(.01);assert.equal(w.G.eprojs.length,0);assert.equal(enemy.spitWindup,.4);
  const x=enemy.x;w.G.player.x=100;w.G.player.y=200;w.updateEnemies(.2);assert.equal(enemy.x,x);assert.equal(w.G.eprojs.length,0);
  enemy.frozen=1;w.updateEnemies(.2);assert.equal(enemy.spitWindup,.2);assert.equal(w.G.eprojs.length,0);
  enemy.frozen=0;w.updateEnemies(.2);assert.equal(w.G.eprojs.length,1);assert.ok(w.G.eprojs[0].vx>259);assert.equal(w.G.eprojs[0].vy,0);
  w.updateEnemies(.1);assert.equal(w.G.eprojs.length,1);
});
