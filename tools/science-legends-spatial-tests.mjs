import test from 'node:test';
import assert from 'node:assert/strict';
import spatial from '../science-legends-spatial.js';
import combat from '../science-legends-combat.js';
let seed=7941;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const enemy=()=>({x:random()*2300,y:random()*2300,r:4+random()*65,hp:100,dead:false});

test('spatial candidates preserve every exact fast swept hit and its nearest/tie ordering',()=>{
  const enemies=Array.from({length:140},enemy),index=spatial.rebuild(spatial.create(),enemies);
  for(let n=0;n<1000;n++){
    const p={x:random()*2300,y:random()*2300,r:2+random()*20},x=random()*2300,y=random()*2300;
    const full=combat.sweepHits(p,x,y,enemies),near=combat.sweepHits(p,x,y,spatial.sweep(index,p,x,y));
    assert.deepEqual(near,full);
  }
  const same=[{x:100,y:100,r:20,hp:100},{x:100,y:100,r:20,hp:100}];
  spatial.rebuild(index,same);const p={x:0,y:100,r:2};
  assert.deepEqual(combat.sweepHits(p,200,100,spatial.sweep(index,p,200,100)).map(h=>h.enemy),same);
});

test('radius candidates preserve large targets and exact tangencies after movement, radius changes and removals',()=>{
  const enemies=Array.from({length:140},enemy),index=spatial.create();
  for(let step=0;step<10;step++){
    for(const actor of enemies){actor.x+=random()*120-60;actor.y+=random()*120-60;actor.r=1+random()*100;}
    if(step===4){enemies.splice(6,20);enemies.push(enemy());enemies[0].dead=true;}
    spatial.rebuild(index,enemies);
    for(let n=0;n<50;n++){
      const x=random()*2300,y=random()*2300,r=random()*400,hit=e=>!e.dead&&e.hp>0&&(e.x-x)**2+(e.y-y)**2<=(r+e.r)**2;
      assert.deepEqual(spatial.radius(index,x,y,r).filter(hit),enemies.filter(hit));
    }
  }
});

test('local queries avoid scanning a spread-out horde and reject dead entries without a rebuild',()=>{
  const enemies=Array.from({length:140},(_,i)=>({x:(i%14)*150,y:Math.floor(i/14)*150,r:10,hp:100}));
  const index=spatial.rebuild(spatial.create(),enemies),near=spatial.radius(index,0,0,45);
  assert.deepEqual(near,[enemies[0]]);assert.ok(index.lastTested<10);
  enemies[0].dead=true;assert.deepEqual(spatial.radius(index,0,0,45),[]);
  assert.deepEqual(spatial.queryBox(index,NaN,0,1,1),[]);
  assert.deepEqual(spatial.queryBox(index,-1e9,-1e9,1e9,1e9),enemies.slice(1));
});
