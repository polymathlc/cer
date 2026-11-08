import test from 'node:test';
import assert from 'node:assert/strict';
import variety from '../science-legends-variety.js';

const STEP=1/120;
function scene(kind,options={}) {
  const def=variety.definitions[kind]||{hp:950,r:34,speed:52,dmg:24};
  const enemy={...def,kind,x:100,y:100,hp:def.hp,maxHp:def.hp,fx:1,fy:0,stun:0,frozen:0,...options};
  const target={x:165,y:100,hp:1000,r:16};
  const shots=[],hazards=[],hits=[],children=[],cues=[];
  const ctx={time:0,slowMult:1,player:target,shoot:s=>shots.push(s),hazard:s=>hazards.push(s),strike:(t,damage)=>{hits.push({target:t,damage});t.hp-=damage;},spawnChild:s=>{children.push(s);return s;},cue:(text,color)=>cues.push({text,color})};
  variety.initialize(enemy);
  const tick=(seconds=STEP)=>{const count=Math.ceil(seconds/STEP-1e-9);for(let i=0;i<count;i++){ctx.time+=STEP;variety.advance(enemy,STEP,target,ctx);}};
  const until=phase=>{for(let i=0;i<1200&&enemy.variety.phase!==phase;i++)tick();assert.equal(enemy.variety.phase,phase);};
  return {enemy,target,ctx,shots,hazards,hits,children,cues,tick,until};
}

test('R21 Warden front guard reduces damage; flank, timed exposure and actual break open counterplay',()=>{
  const f=scene('warden'),e=f.enemy;
  const front=variety.modifyDamage(e,10,{dx:1,dy:0},0);
  assert.equal(front.blocked,true);assert.equal(front.amount,3.5);
  assert.equal(variety.modifyDamage(e,10,{dx:-1,dy:0},0).amount,10);
  e.variety.guardCycle=3.3;assert.equal(variety.modifyDamage(e,10,{dx:1,dy:0},0).amount,10);
  e.variety.guardCycle=0;
  const broken=variety.modifyDamage(e,30,{sourceX:e.x+50,sourceY:e.y,heavy:true},1);
  assert.equal(broken.broken,true);assert.equal(broken.amount,30);assert.equal(e.variety.feedback.kind,'guard-break');
  assert.equal(variety.modifyDamage(e,10,{dx:1,dy:0},1.1).amount,10);
  assert.equal(variety.modifyDamage(e,1,{dx:1,dy:0},1.2).broken,false);
  f.ctx.time=3;f.tick();assert.ok(e.variety.guard>0);
});

test('R21 Warden strikes only once after windup, commits its cone and exposes recovery',()=>{
  const f=scene('warden');f.until('windup');
  assert.equal(f.hits.length,0);const x=f.enemy.x;
  f.tick(.35);assert.equal(f.hits.length,0);assert.equal(f.enemy.x,x);
  f.tick(.35);assert.equal(f.hits.length,1);assert.equal(f.enemy.variety.phase,'recovery');
  assert.equal(variety.modifyDamage(f.enemy,10,{dx:1,dy:0},f.ctx.time).amount,10);
  f.tick(.5);assert.equal(f.hits.length,1);
  const escaped=scene('warden');escaped.until('windup');escaped.target.y+=180;escaped.tick(.7);assert.equal(escaped.hits.length,0);
});

test('R22 Hexer locks its world-space curse and never damages from the windup',()=>{
  const f=scene('hexer');f.target.x=340;f.until('windup');
  const point={x:f.enemy.variety.aimX,y:f.enemy.variety.aimY};
  f.target.x+=180;f.target.y+=100;f.tick(.7);assert.equal(f.hazards.length,0);
  f.tick(.04);assert.equal(f.hazards.length,1);
  const h=f.hazards[0];assert.equal(h.x,point.x);assert.equal(h.y,point.y);assert.equal(h.kind,'curse');
  assert.ok(h.warning>0);assert.ok(h.tick>=.4);assert.ok(h.life<2);assert.ok(h.slow>0);assert.equal(f.hits.length,0);
  f.tick(.4);assert.equal(f.hazards.length,1);
});

test('R22 freeze, stun and heavy interruption retire the Hexer commitment once',()=>{
  for(const control of ['frozen','stun','heavy']){
    const f=scene('hexer');f.until('windup');
    if(control==='heavy')assert.equal(variety.modifyDamage(f.enemy,25,{heavy:true,dx:1,dy:0},f.ctx.time).interrupted,true);
    else{f.enemy[control]=1;f.tick(.9);assert.equal(f.cues.filter(c=>c.text.includes('INTERRUPTED')).length,1);}
    assert.equal(f.enemy.variety.phase,'recovery');assert.equal(f.enemy.modelAttackUntil,0);assert.equal(f.hazards.length,0);
    if(control!=='heavy')f.enemy[control]=0;
    f.tick(.5);assert.equal(f.hazards.length,0);
  }
});

test('R23 Broodling hatches at most two rewardless mites once with grace and no recursive child kind',()=>{
  const f=scene('broodling');assert.equal(variety.contactAllowed('broodling',f.enemy),false);
  f.tick(.81);assert.equal(variety.contactAllowed('broodling',f.enemy),true);
  f.enemy.hp=0;f.enemy.dead=true;
  const result=variety.onDeath(f.enemy,f.ctx);assert.equal(result.children,2);
  for(const child of f.children){assert.equal(child.kind,'mite');assert.equal(child.noXP,true);assert.equal(child.noLoot,true);assert.ok(child.grace>=.7);}
  assert.equal(variety.onDeath(f.enemy,f.ctx).children,0);assert.equal(f.children.length,2);
  const mite={kind:'mite',hp:0,dead:true,x:100,y:100};variety.onDeath(mite,f.ctx);assert.equal(f.children.length,2);
});

test('R23 frozen/stunned death prevents hatch and a full enemy cap creates no offspring',()=>{
  for(const control of ['frozen','stun']){
    const f=scene('broodling');f.enemy.hp=0;f.enemy.dead=true;f.enemy[control]=1;
    assert.equal(variety.onDeath(f.enemy,f.ctx).children,0);assert.equal(f.children.length,0);assert.ok(f.cues.some(c=>c.text==='HATCH PREVENTED'));
  }
  const f=scene('broodling');f.enemy.hp=0;f.enemy.dead=true;f.ctx.spawnChild=()=>null;
  assert.equal(variety.onDeath(f.enemy,f.ctx).children,0);
  assert.equal(variety.canSpawn('mite',50,Array.from({length:140},()=>({kind:'imp',hp:1})),140),false);
});

test('R24 Sentinel aims three committed lanes, has an actual warning and recovery, and no touch damage',()=>{
  const f=scene('sentinel');f.target.x=350;f.until('windup');
  assert.equal(f.shots.length,0);const dx=f.enemy.variety.aimDX,dy=f.enemy.variety.aimDY;
  f.target.x=f.enemy.x;f.target.y+=240;f.tick(.6);assert.equal(f.shots.length,0);
  f.tick(.07);assert.equal(f.shots.length,3);assert.equal(f.enemy.variety.phase,'recovery');
  const center=f.shots[1];assert.ok(Math.abs(center.vx-dx*300)<1e-8);assert.ok(Math.abs(center.vy-dy*300)<1e-8);
  const angles=f.shots.map(s=>Math.atan2(s.vy,s.vx));assert.ok(Math.abs(angles[1]-angles[0]-.28)<1e-8);assert.ok(Math.abs(angles[2]-angles[1]-.28)<1e-8);
  assert.ok(f.shots.every(s=>s.r<5&&s.life<2&&s.source===f.enemy));
  assert.equal(variety.contactAllowed('sentinel'),false);f.tick(.5);assert.equal(f.shots.length,3);
});

test('R24 control effects and death cancel Sentinel before any projectile can emit',()=>{
  for(const reason of ['frozen','stun','dead']){
    const f=scene('sentinel');f.until('windup');
    if(reason==='dead'){f.enemy.hp=0;f.enemy.dead=true;}else f.enemy[reason]=1;
    f.tick(1);assert.equal(f.shots.length,0);assert.notEqual(f.enemy.variety.phase,'windup');
  }
});

test('R25 staged composition keeps early waves viable and caps guards, casters, ranged foes and total entities',()=>{
  const early=new Set();for(let i=0;i<100;i++)early.add(variety.pickKind(1,[],i/100));assert.deepEqual([...early].sort(),['imp','slime']);
  for(const [kind,def] of Object.entries(variety.definitions)){
    assert.equal(variety.canSpawn(kind,def.minWave-1,[]),false);assert.equal(variety.canSpawn(kind,def.minWave,[]),true);
  }
  const guards=Array.from({length:4},()=>({kind:'warden',hp:1}));assert.equal(variety.canSpawn('warden',60,guards),false);
  const range=Array.from({length:8},()=>({kind:'spitter',hp:1}));
  for(const kind of ['spitter','hexer','sentinel'])assert.equal(variety.canSpawn(kind,60,range),false);
  const packed=Array.from({length:140},()=>({kind:'imp',hp:1}));assert.equal(variety.pickKind(60,packed,.5),null);
  assert.equal(variety.canSpawn('unknown',60,[]),false);assert.equal(variety.canSpawn('imp',1,[],0),false);
  const late=new Set();for(let i=0;i<1000;i++)late.add(variety.pickKind(10,[],i/1000));
  for(const kind of ['warden','hexer','broodling','sentinel'])assert.ok(late.has(kind));
});

test('R26 volatile elite has a visible identity, delayed one-shot hazard and a control-effect counter',()=>{
  const f=scene('warden',{elite:true});assert.equal(f.enemy.varietyAffix,'volatile');
  f.enemy.dead=true;f.enemy.hp=0;const r=variety.onDeath(f.enemy,f.ctx);
  assert.equal(r.volatile,true);assert.equal(f.hazards.length,1);assert.equal(f.hazards[0].kind,'volatile');assert.ok(f.hazards[0].warning>=.8);assert.equal(f.hazards[0].owner,null);
  variety.onDeath(f.enemy,f.ctx);assert.equal(f.hazards.length,1);
  const frozen=scene('sentinel',{elite:true});frozen.enemy.dead=true;frozen.enemy.hp=0;frozen.enemy.frozen=1;
  assert.equal(variety.onDeath(frozen.enemy,frozen.ctx).volatile,false);assert.equal(frozen.hazards.length,0);assert.ok(frozen.cues.some(c=>c.text==='VOLATILE DISARMED'));
  const capped={...variety.definitions.hexer,kind:'hexer',hp:40,maxHp:40,elite:true,x:0,y:0};
  variety.initialize(capped,{enemies:Array.from({length:3},()=>({hp:10,varietyAffix:'volatile'}))});assert.equal(capped.varietyAffix,undefined);
});

test('R27 Tyrant enrage is one-way and changes one locked strike into a three-circle pattern',()=>{
  const f=scene('boss',{boss:true});f.target.x=260;f.until('windup');f.tick(.91);
  assert.equal(f.hazards.length,1);assert.equal(f.hazards[0].r,88);
  f.enemy.hp=f.enemy.maxHp*.54;f.tick();assert.equal(f.enemy.variety.phaseTwo,true);assert.equal(f.cues.filter(c=>c.text==='TYRANT ENRAGED').length,1);
  f.until('windup');const x=f.enemy.variety.aimX,y=f.enemy.variety.aimY;f.target.y+=300;f.tick(.77);
  assert.equal(f.hazards.length,4);const linked=f.hazards.slice(1);assert.ok(linked.every(h=>h.r===57));
  assert.equal(linked[1].x,x);assert.equal(linked[1].y,y);assert.equal(f.enemy.variety.phase,'recovery');
  f.enemy.hp=f.enemy.maxHp;f.tick();f.enemy.hp=f.enemy.maxHp*.4;f.tick();assert.equal(f.cues.filter(c=>c.text==='TYRANT ENRAGED').length,1);
});

test('R27 Tyrant summons are bounded and paused, ended or invalid steps emit nothing',()=>{
  const f=scene('boss',{boss:true});f.target.x=2000;
  f.tick(18);assert.equal(f.children.length,4);assert.ok(f.children.every(c=>c.kind==='imp'&&c.grace>1));
  const before=JSON.stringify(f.enemy),count=f.children.length;
  f.ctx.paused=true;f.tick(5);assert.equal(JSON.stringify(f.enemy),before);assert.equal(f.children.length,count);
  f.ctx.paused=false;f.ctx.ended=true;f.tick(5);assert.equal(f.children.length,count);
  f.ctx.ended=false;variety.advance(f.enemy,Infinity,f.target,f.ctx);variety.advance(f.enemy,NaN,f.target,f.ctx);assert.equal(f.children.length,count);
});

test('R28 art metadata is immutable, four-role column order and fallback identity are explicit',()=>{
  assert.deepEqual(variety.modelOrder,['warden','hexer','broodling','sentinel']);
  const names=new Set();for(const [i,kind] of variety.modelOrder.entries()){
    const m=variety.model(kind);assert.equal(m.column,i);assert.ok(['brute','spitter','slime','charger'].includes(m.fallback));names.add(variety.introduction(kind).name);
    assert.ok(Object.isFrozen(variety.definitions[kind]));assert.notEqual(variety.introduction(kind).role,'Enemy');
  }
  assert.equal(names.size,4);assert.equal(variety.model('imp'),null);assert.ok(Object.isFrozen(variety.guideEntries));
});

test('R29 hit and interrupt transitions produce bounded distinct feedback instead of per-step spam',()=>{
  const shell=scene('broodling');variety.modifyDamage(shell.enemy,5,{dx:1,dy:0},1);const first=shell.enemy.variety.feedback;
  for(let i=0;i<100;i++)variety.modifyDamage(shell.enemy,1,{dx:1,dy:0},1.1);assert.equal(shell.enemy.variety.feedback,first);
  const f=scene('sentinel');f.until('windup');assert.equal(variety.interrupt(f.enemy,'stun',f.ctx),true);
  for(let i=0;i<100;i++)assert.equal(variety.interrupt(f.enemy,'stun',f.ctx),false);
  assert.equal(f.cues.filter(c=>c.text==='INTERRUPTED').length,1);
});

function canvas(){const calls=[];const ctx=new Proxy({},{get:(o,key)=>key in o?o[key]:(...args)=>calls.push({key,args}),set:(o,k,v)=>(o[k]=v,true)});return {ctx,calls};}
test('R29 telegraphs and role reactions draw without mutating simulation or applying damage',()=>{
  for(const kind of variety.modelOrder.concat('boss')){
    const f=scene(kind,{boss:kind==='boss'});if(kind!=='broodling')f.until('windup');
    const before=JSON.stringify(f.enemy),h=f.hazards.length,s=f.shots.length,hit=f.hits.length,{ctx,calls}=canvas(),captions=[];
    variety.drawTelegraphs(ctx,f.enemy,f.ctx.time,(...args)=>captions.push(args));
    assert.equal(JSON.stringify(f.enemy),before);assert.equal(f.hazards.length,h);assert.equal(f.shots.length,s);assert.equal(f.hits.length,hit);assert.ok(calls.length>=2);
    if(kind!=='broodling')assert.ok(captions.length>0);
  }
});

test('R30 intelligence names real roles, their tells and actionable counterplay including phase and affix',()=>{
  for(const entry of variety.guideEntries){assert.ok(entry.name.length>5);assert.ok(entry.role.length>5);assert.ok(entry.tell.length>25);assert.ok(entry.counter.length>30);assert.ok(entry.icon);}
  const boss=scene('boss',{boss:true});assert.equal(variety.intelligence(boss.enemy).name,'Core Tyrant');
  boss.enemy.hp=boss.enemy.maxHp*.5;boss.tick();assert.equal(variety.intelligence(boss.enemy).name,'Enraged Core Tyrant');
  assert.match(variety.guides.broodling.counter,/no loot or XP/);assert.match(variety.guides.volatile.counter,/frozen or stunned/);
  assert.equal(variety.intelligence({kind:'slime'}),null);
});
