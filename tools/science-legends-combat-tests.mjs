import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import combat from '../science-legends-combat.js';
import actions from '../science-legends-actions.js';
import spatial from '../science-legends-spatial.js';

const source=readFileSync(new URL('../science-legends.html',import.meta.url),'utf8');
function fn(name){
  const start=source.indexOf(`function ${name}(`);assert.ok(start>=0,name);
  const open=source.indexOf('{',start);let depth=0;
  for(let i=open;i<source.length;i++){
    if(source[i]==='{')depth++;
    if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw Error(`Unclosed ${name}`);
}
function projectileWorld(){
  const damage=[],damageOpts=[],explosions=[],hurt=[];
  const w={LegendsCombat:combat,LegendsActions:actions,LegendsSpatial:spatial,WeakSet,Math,lowMotion:false,WORLD:{w:2300,h:2300},
    G:{time:0,projs:[],eprojs:[],zones:[],orbs:[],enemies:[],player:{x:100,y:300,r:16},stats:{mods:{}}},
    dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2,rollCrit:()=>({mult:1,crit:false}),
    dealDamage:(e,n,opts)=>{e.hp-=n;damage.push(e);damageOpts.push(opts);if(e.hp<=0)e.dead=true;},
    explode:(x,y,r,n)=>explosions.push({x,y,r,n}),hurtPlayer:n=>hurt.push(n),healPlayer(){},
    hasEnh:()=>false,applyBleed(){},enemiesInRadius:()=>[],rand:(a,b)=>(a+b)/2,damage,damageOpts,explosions,hurt};
  vm.createContext(w);vm.runInContext(['enemyCandidates','ultN','skillBuild','skillTint','skillFx','projectileTrail','updateProjectiles'].map(fn).join('\n'),w);return w;
}
const enemy=(x,hp=100)=>({x,y:100,r:4,hp,dead:false});
const projectile=(extra={})=>({kind:'basic',x:100,y:100,r:2,vx:10000,vy:0,life:1,dmg:10,pierce:0,...extra});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≈ ${b}`);

test('swept collisions catch small targets between frames and respect tangent/miss/start overlap',()=>{
  close(combat.sweepCircle(0,0,100,0,50,0,4),.46);
  close(combat.sweepCircle(0,4,100,4,50,0,4),.5);
  assert.equal(combat.sweepCircle(0,5,100,5,50,0,4),null);
  assert.equal(combat.sweepCircle(50,0,50,0,50,0,4),0);
  assert.equal(combat.sweepCircle(0,0,0,0,50,0,4),null);
  assert.equal(combat.sweepCircle(0,0,10,0,50,0,4),null);
});
test('shipped projectiles hit the nearest target in flight order, regardless of enemy array order',()=>{
  const w=projectileWorld(),near=enemy(130),far=enemy(170);
  w.G.enemies=[far,near];w.G.projs=[projectile()];w.updateProjectiles(.01);
  assert.deepEqual(w.damage,[near]);assert.equal(w.G.projs.length,0);assert.equal(far.hp,100);
});
test('piercing remembers target objects after enemy removal and can hit a newly occupying index',()=>{
  const w=projectileWorld(),first=enemy(130),second=enemy(190),pr=projectile({pierce:2,vx:2000});
  w.G.enemies=[first,second];w.G.projs=[pr];w.updateProjectiles(.02);
  assert.deepEqual(w.damage,[first]);
  w.G.enemies.splice(0,1);w.updateProjectiles(.03);
  assert.deepEqual(w.damage,[first,second]);
  pr.x=180;pr.vx=100;w.updateProjectiles(.02);
  assert.deepEqual(w.damage,[first,second],'same target cannot be damaged twice by one projectile');
});
test('projectiles use only their remaining flight time but resolve hits before expiry',()=>{
  const w=projectileWorld(),near=enemy(130),far=enemy(180);
  w.G.enemies=[far,near];w.G.projs=[projectile({life:.005})];w.updateProjectiles(.05);
  assert.deepEqual(w.damage,[near]);assert.equal(w.G.projs.length,0);
  w.damage.length=0;w.G.enemies=[far];w.G.projs=[projectile({life:.005})];w.updateProjectiles(.05);
  assert.equal(w.damage.length,0);assert.equal(w.G.projs.length,0);
});
test('fireballs detonate at first contact, not at an overshot endpoint',()=>{
  const w=projectileWorld();w.G.enemies=[enemy(180),enemy(130)];w.G.projs=[projectile({kind:'fire',sid:'fireball',radius:70})];
  w.updateProjectiles(.01);assert.equal(w.explosions.length,1);close(w.explosions[0].x,124);
  assert.equal(w.G.actions[0].sid,'fireball');close(w.G.actions[0].x,124);assert.equal(w.G.actions[0].r,70);
});
test('enemy projectiles also cannot tunnel through the player',()=>{
  const w=projectileWorld();w.G.player={x:130,y:100,r:4};w.G.eprojs=[projectile({dmg:7})];
  w.updateProjectiles(.01);assert.deepEqual(w.hurt,[7]);assert.equal(w.G.eprojs.length,0);
});
test('dead targets never intercept a shot or consume its piercing budget',()=>{
  const w=projectileWorld(),live=enemy(170);w.G.enemies=[enemy(130,0),live];w.G.projs=[projectile()];
  w.updateProjectiles(.01);assert.deepEqual(w.damage,[live]);
});
test('actual projectile contact carries explicit poison, holy and Amazon arrow identities',()=>{
  for(const [extra,cls,element]of [[{poison:1,sid:'sting'},'beast','poison'],[{sid:'holybolt'},'pala','holy'],[{basic:true},'ama','arrow']]){
    const w=projectileWorld();w.G.cls=cls;w.G.enemies=[enemy(130)];w.G.projs=[projectile(extra)];w.updateProjectiles(.01);assert.equal(w.damageOpts[0].element,element);
  }
});
test('knockback integrates the same displacement and damping at different frame rates',()=>{
  const simulate=n=>{const e={x:0,y:0,kx:220,ky:-120,kt:.22};for(let i=0;i<n;i++)combat.knockback(e,.22/n);return e;};
  const a=simulate(1),b=simulate(22);close(a.x,b.x);close(a.y,b.y);close(a.kx,b.kx);close(a.ky,b.ky);
  assert.ok(a.x>20&&a.x<40);assert.equal(a.kt,0);
});
test('fixed simulation produces equal movement at 30, 60 and 144 Hz',()=>{
  const simulate=hz=>{const clock={};let x=0;for(let i=0;i<hz*4;i++)combat.advance(clock,1/hz,true,dt=>{x+=240*dt;});return x;};
  close(simulate(30),960);close(simulate(60),960);close(simulate(144),960);
});
test('simulation caps catch-up, clears pause debt and immediately stops when a question opens',()=>{
  const clock={};let steps=0;combat.advance(clock,10,true,()=>steps++);assert.equal(steps,12);
  combat.advance(clock,.1,false,()=>steps++);assert.equal(clock.accumulator,0);
  combat.advance(clock,1/60,true,()=>false);assert.ok(clock.accumulator===0);
  clock.hitStop=.035;const before=steps;combat.advance(clock,.02,true,()=>steps++);assert.equal(steps,before);
  close(clock.hitStop,.015);combat.advance(clock,1/60,false,()=>steps++);assert.equal(clock.hitStop,0);
});
test('impact feedback is bounded, directional and honors reduced motion',()=>{
  const w={G:{player:{x:0,y:0},impacts:[],shake:0,impactCooldown:0},lowMotion:false,Math,Number};
  vm.createContext(w);vm.runInContext(fn('combatImpact'),w);
  for(let i=0;i<100;i++)w.combatImpact({x:i+1,y:0,r:5,hp:1},10,{crit:true,impactX:0,impactY:20});
  assert.equal(w.G.impacts.length,48);close(w.G.impacts[0].ang,Math.PI/2);assert.equal(w.G.hitStop,.035);
  w.lowMotion=true;w.G.hitStop=0;w.G.impactCooldown=0;w.combatImpact({x:1,y:0,r:5,hp:1},10,{crit:true});
  assert.equal(w.G.hitStop,0);assert.equal(w.G.impacts.length,48);
});
test('projectile trail history stays bounded and disappears in reduced motion',()=>{
  const w=projectileWorld(),p=projectile();for(let i=0;i<1000;i++){p.x++;w.projectileTrail(p,.01);}
  assert.ok(p.trail.length<=9);assert.ok(p.trail.every(t=>t.age<=.15));w.lowMotion=true;w.projectileTrail(p,.01);assert.equal(p.trail.length,0);
});

test('continuous critical channels retain visible impact without slowing the simulation clock',()=>{
  const w={G:{player:{x:0,y:0},time:0,impacts:[],hitStop:0,shake:0,impactCooldown:0},lowMotion:false,Math,Number};
  vm.createContext(w);vm.runInContext(fn('combatImpact'),w);
  for(let frame=0;frame<240;frame++)combat.advance(w.G,1/60,true,dt=>{
    w.G.time+=dt;w.G.impactCooldown=Math.max(0,w.G.impactCooldown-dt);
    w.combatImpact({x:20,y:0,r:5,hp:100},10,{crit:true,continuous:true});
  });
  close(w.G.time,4);assert.equal(w.G.hitStop,0);assert.equal(w.G.impacts.length,48);
});

test('repeated dramatic impacts have a stop budget below five percent of wall time',()=>{
  for(const hz of [30,60,144]){
  const w={G:{player:{x:0,y:0},time:0,impacts:[],hitStop:0,shake:0,impactCooldown:0},lowMotion:false,Math,Number};
  vm.createContext(w);vm.runInContext(fn('combatImpact'),w);
  for(let frame=0;frame<hz*4;frame++)combat.advance(w.G,1/hz,true,dt=>{
    w.G.time+=dt;w.G.impactCooldown=Math.max(0,w.G.impactCooldown-dt);
    w.combatImpact({x:20,y:0,r:5,hp:0,elite:true},10,{crit:true});
  });
  assert.ok(w.G.time/4>=.95,`${hz}Hz simulation retained${w.G.time/4} of wall time`);
  assert.equal(w.G.impacts.length,48);
  }
});

test('mid-frame impact stops consume remaining wall time instead of losing an extra partial frame',()=>{
  const clock={};let steps=0;
  combat.advance(clock,1/30,true,()=>{steps++;clock.hitStop=.035;});
  assert.equal(steps,1);close(clock.hitStop,.01);close(clock.accumulator,0);
  combat.advance(clock,.01,true,()=>steps++);assert.equal(steps,1);close(clock.hitStop,0);
});
