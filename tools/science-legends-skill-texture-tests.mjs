import test from 'node:test';
import assert from 'node:assert/strict';
import actions from '../science-legends-actions.js';

function recorder(){
  const calls=[],styles={};
  return new Proxy(styles,{get:(target,key)=>key==='calls'?calls:target[key]??((...args)=>calls.push([key,...args])),set:(target,key,value)=>{target[key]=value;calls.push(['set',key,value]);return true;}});
}
const profile=Object.fromEntries(['barb','sorc','beast','pala','ama'].map(cls=>['fx-'+cls,{complete:true,naturalWidth:1448,naturalHeight:1086,src:'fx-'+cls}]));
function event(sid,options={}){return {sid,x:100,y:100,r:80,ang:.3,start:0,life:1,...options};}
function paint(action,time=.3,reduced=false,images=profile){const c=recorder();actions.draw(c,action,time,reduced,images);return c;}

test('41: directional generated art is calibrated against its authored heading',()=>{
  for(const sid of ['javelin','plague','multishot','fireball','icebolt','sting','charge']){
    const a=event(sid,{phase:'cast'}),heading=actions.recipe(sid).sourceHeading;
    assert.notEqual(heading,0,sid);
    assert.ok(Math.abs(actions.atlasRotation(a)+heading-a.ang)<1e-9);
    const c=paint(a);assert.equal(c.calls.find(x=>x[0]==='rotate')[1],a.ang-heading);
    assert.ok(c.calls.some(x=>x[0]==='drawImage'));
  }
  assert.equal(actions.atlasRotation(event('holybolt')),0.3,'already horizontal Holy Bolt needs no extra turn');
  for(const sid of ['stag','bash','roll'])assert.equal(actions.recipe(sid).sourceHeading,0,sid+' is authored eastward or radially');
});

test('42: flight overlays never multiply the native body or repaint a whole fan',()=>{
  for(const sid of ['multishot','strafe','axes','stampede','javelin','fireball','icebolt']){
    const c=recorder();actions.drawChannel(c,event(sid,{phase:'flight',bodyOwned:true}),.3,false,profile);
    assert.equal(c.calls.filter(x=>x[0]==='drawImage').length,0,sid+' native body owns flight');
    assert.ok(c.calls.some(x=>x[0]==='lineTo'||x[0]==='arc'||x[0]==='ellipse'||x[0]==='quadraticCurveTo'),sid+' still has a material wake');
  }
  for(const sid of ['multishot','strafe','axes','stampede']){
    const c=recorder();actions.drawChannel(c,event(sid,{phase:'flight'}),.3,false,profile);
    assert.equal(c.calls.filter(x=>x[0]==='drawImage').length,0,sid+' standalone does not draw the multi-body atlas');
    assert.ok(c.calls.some(x=>x[0]==='fill'||x[0]==='ellipse'),sid+' standalone retains one native body');
  }
});

test('43: live flight stays in its release phase and remains visible until removal',()=>{
  const a=event('fireball',{phase:'flight',channel:true});
  const samples=[.001,.3,.75,.999].map(t=>actions.sampleSkill(a,t,false));
  assert.deepEqual(samples.map(s=>s.frame),[1,1,1,1]);
  assert.equal(new Set(samples.map(s=>s.alpha)).size,1);
  assert.ok(samples.every(s=>s.alpha>.7));
  assert.equal(actions.draw(recorder(),a,1.001,false,profile),false);
  assert.deepEqual(paint(a,.8).calls,paint(a,.8).calls,'paused simulation freezes the wake');
});

test('44: a cast gesture has caster scale while the effect retains its real area',()=>{
  for(const sid of ['meteor','fist','blizzard','consecrate','barrier','mend','nova']){
    const cast=paint(Object.freeze(event(sid,{phase:'cast'}))),effect=paint(Object.freeze(event(sid)));
    assert.equal(cast.calls.find(x=>x[0]==='drawImage')[8],42,sid+' caster gesture');
    assert.ok(effect.calls.find(x=>x[0]==='drawImage')[8]>100,sid+' effect area');
    assert.ok(cast.calls.some(x=>x[0]==='clip'),sid+' gesture is bounded');
  }
});

test('45: lightning follows actual copied victim segments without phantom atlas forks',()=>{
  const points=[{x:20,y:40},{x:90,y:40},{x:90,y:120}],state={time:0};
  const a=actions.emitSkill(state,'chain',20,40,36,0,.5,{points});points[1].x=900;
  assert.equal(a.points[1].x,90,'the render path cannot follow mutable target arrays');
  const c=paint(a,.2);assert.equal(c.calls.filter(x=>x[0]==='drawImage').length,0);
  assert.ok(c.calls.some(x=>x[0]==='lineTo'&&x[1]===90&&x[2]===40));
  assert.ok(c.calls.some(x=>x[0]==='lineTo'&&x[1]===90&&x[2]===120));
  for(const call of c.calls.filter(x=>x[0]==='lineTo'))assert.ok(call[1]>=10&&call[1]<=100&&call[2]>=30&&call[2]<=130,'no unhit branch outside the path envelope');
});

test('46: contact sparks and genuine area bursts have different geometries',()=>{
  for(const sid of ['multishot','axes','icebolt','holybolt','plague','fireball']){
    const hit=paint(event(sid,{phase:'impact',r:24}));
    assert.equal(hit.calls.filter(x=>x[0]==='drawImage').length,0,sid+' contact is not a weapon volley');
    assert.ok(hit.calls.some(x=>x[0]==='lineTo'||x[0]==='arc'),sid+' material contact remains visible');
  }
  assert.ok(paint(event('fireball',{phase:'burst',r:120})).calls.some(x=>x[0]==='drawImage'),'real blast retains generated area art');
});

test('47: targeted textures descend to the latched target before impact frames',()=>{
  for(const sid of ['meteor','hawk','fist','rain']){
    const early=recorder(),late=recorder(),reduced=recorder();
    actions.drawAnticipation(early,{sid,x:150,y:200,r:90,progress:.1},false,profile);
    actions.drawAnticipation(late,{sid,x:150,y:200,r:90,progress:.9},false,profile);
    actions.drawAnticipation(reduced,{sid,x:150,y:200,r:90,progress:.9},true,profile);
    const earlyCell=early.calls.find(x=>x[0]==='drawImage'),lateCell=late.calls.find(x=>x[0]==='drawImage');
    const a=actions.atlasFrame(sid,0,profile),b=actions.atlasFrame(sid,1,profile);
    assert.deepEqual(earlyCell.slice(2,6),[a.x,a.y,a.w,a.h]);assert.deepEqual(lateCell.slice(2,6),[b.x,b.y,b.w,b.h]);
    assert.deepEqual(early.calls.filter(x=>x[0]==='translate')[0],['translate',150,200]);
    assert.ok(early.calls.filter(x=>x[0]==='translate')[1][2]<late.calls.filter(x=>x[0]==='translate')[1][2]);
    assert.deepEqual(reduced.calls.filter(x=>x[0]==='translate')[1],['translate',0,-0]);
  }
});

test('48: dash arrival marks only the final actually travelled segment',()=>{
  const short=paint(event('roll',{phase:'arrival',fromX:90,fromY:100}));
  const far=paint(event('roll',{phase:'arrival',fromX:-1000,fromY:100}));
  for(const c of [short,far]){
    const native=c.calls.filter(x=>x[0]==='moveTo'||x[0]==='lineTo');
    assert.ok(native.length>0);for(const p of native)assert.ok(p[1]>=-72&&p[1]<=0);
  }
  assert.ok(short.calls.filter(x=>x[0]==='moveTo').every(p=>p[1]>=-10));
  const still=paint(event('roll',{phase:'arrival',fromX:100,fromY:100}));
  assert.equal(still.calls.filter(x=>x[0]==='lineTo').length,0,'blocked dash invents no trail');
});

test('49: sustained expiry ticks reflect remaining simulation life without decorative motion',()=>{
  const a=event('aegis',{channel:true,r:43,life:8});
  const early=paint(a,.1,true,{}),late=paint(a,7.5,true,{});
  assert.equal(early.calls.filter(x=>x[0]==='lineTo').length-late.calls.filter(x=>x[0]==='lineTo').length,7);
  assert.deepEqual(late.calls,paint(a,7.5,true,{}).calls,'pause freezes functional expiry');
  assert.equal(actions.draw(recorder(),a,8.01,true,{}),false);
});

test('50: contact floods stay bounded and cannot evict an important pending area/arrival',()=>{
  const state={time:0},meteor=actions.emitSkill(state,'meteor',100,100,120,0,.9,{phase:'burst'}),arrival=actions.emitSkill(state,'roll',150,100,58,0,.42,{phase:'arrival',fromX:80,fromY:100});
  for(let i=0;i<100;i++)actions.emitSkill(state,'multishot',300+i*20,100,24,0,.25,{phase:'impact'});
  assert.equal(state.actions.length,24);assert.ok(state.actions.includes(meteor));assert.ok(state.actions.includes(arrival));
  const separate={time:0};for(let i=0;i<100;i++)actions.emitSkill(separate,'javelin',100+i%3,100+i%2,24,0,.25,{phase:'impact'});
  assert.equal(separate.actions.length,1);assert.equal(separate.actions[0].contacts,4);
  actions.emitSkill(separate,'javelin',200,100,24,0,.25,{phase:'impact'});assert.equal(separate.actions.length,2,'distant contacts remain distinct');
  assert.ok(separate.actions.every(a=>!('dmg'in a)&&!('run'in a)));
  const array=state.actions;state.time=1;actions.expire(state);assert.equal(state.actions,array);assert.equal(state.actions.length,0);
});
