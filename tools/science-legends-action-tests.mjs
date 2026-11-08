import test from 'node:test';
import assert from 'node:assert/strict';
import actions from '../science-legends-actions.js';
test('each sequence advances through four frames on simulation time and freezes when time stops',()=>{
  const state={time:10},action=actions.emit(state,2,10,20,80,0,.4);
  assert.deepEqual([10,10.11,10.21,10.31].map(time=>actions.sample(action,time,false).frame),[0,1,2,3]);
  assert.deepEqual(actions.sample(action,10.21,false),actions.sample(action,10.21,false));
  assert.equal(actions.sample(action,10.21,true).frame,1);
});
test('visual action queues stay bounded, expire and never carry a damage callback',()=>{
  const state={time:0};for(let i=0;i<100;i++)actions.emit(state,i%4,1,2,20,0,.3);
  assert.equal(state.actions.length,24);assert.ok(state.actions.every(action=>!('dmg'in action)&&!('run'in action)));
  state.time=.31;actions.expire(state);assert.equal(state.actions.length,0);
});
test('elemental action identity stays explicit through frame playback',()=>{
  const state={time:0};['lightning','poison','holy','arrow'].forEach((family,row)=>{
    const action=actions.emitElement(state,family,1,2,50,0,.4);assert.equal(action.sheet,'elements');assert.equal(action.row,row);assert.equal(action.family,family);
    assert.deepEqual([0,.11,.21,.31].map(t=>actions.sample(action,t,false).frame),[0,1,2,3]);
  });
  assert.equal(actions.familyForSkill('chain'),'lightning');assert.equal(actions.familyForSkill('plague'),'poison');assert.equal(actions.familyForSkill('holybolt'),'holy');assert.equal(actions.familyForSkill('multishot'),'arrow');
});

const classSkills={
  barb:['cleave','whirlwind','charge','warcry','slam','axes','ironskin','rampage','quake','execute','bladestorm','berserk'],
  sorc:['fireball','chain','nova','meteor','icebolt','storm','blizzard','teleport','barrier','hydra','orb','combust'],
  beast:['wolf','stampede','ravens','frenzy','sting','vines','hawk','boarpet','mend','roar','locusts','stag'],
  pala:['smite','hammers','zeal','consecrate','bash','holybolt','retribution','lay','fist','judgement','aegis','banner'],
  ama:['javelin','multishot','strafe','plague','fury','roll','valk','decoy','rain','trap','eagle','net']
};
function recorder(){
  const calls=[];
  const ctx=new Proxy({}, {get(target,key){if(key==='calls')return calls;return target[key]??((...args)=>{calls.push([key,...args]);});},set(target,key,value){target[key]=value;return true;}});
  return ctx;
}
test('all sixty real skills have a unique immutable recipe and visible native fallback',()=>{
  const motifs=new Set(),footprints=new Set();
  assert.equal(Object.keys(actions.recipes).length,60);
  for(const [cls,skills]of Object.entries(classSkills))skills.forEach((sid,index)=>{
    const recipe=actions.recipe(sid),state={time:0};
    assert.equal(recipe.cls,cls);assert.equal(recipe.index,index);assert.ok(Object.isFrozen(recipe));
    motifs.add(recipe.motif);
    const event=actions.emitSkill(state,sid,200,200,90,.4,.8),ctx=recorder();
    assert.equal(event.sid,sid);assert.equal(event.recipe,sid);
    assert.ok(actions.draw(ctx,event,.3,false,{}),`${sid} draws without images`);
    assert.ok(ctx.calls.some(([kind])=>['lineTo','arc','ellipse','fillRect'].includes(kind)),`${sid} has native geometry`);
    footprints.add(JSON.stringify(ctx.calls));
  });
  assert.equal(motifs.size,60);assert.equal(footprints.size,60,'each missing-art effect has its own visible geometry');
  assert.equal(actions.recipe('unknown'),null);
});
test('every skill samples its own four-frame source cells in the five class atlases',()=>{
  const profile={};for(const cls of Object.keys(classSkills))profile['fx-'+cls]={complete:true,naturalWidth:1600,naturalHeight:1200};
  for(const [cls,skills]of Object.entries(classSkills))skills.forEach((sid,index)=>{
    const state={time:0},event=actions.emitSkill(state,sid,0,0,80,0,.8),ctx=recorder();
    for(let phase=0;phase<4;phase++){
      ctx.calls.length=0;actions.draw(ctx,event,(phase+.25)*.2,false,profile);
      const draw=ctx.calls.find(([kind])=>kind==='drawImage');assert.ok(draw,sid);
      assert.equal(draw[1],profile['fx-'+cls]);
      assert.deepEqual(draw.slice(2,6),[((index%2)*4+phase)*200,Math.floor(index/2)*200,200,200],`${sid},phase ${phase}`);
    }
  });
});
test('Whirlwind plays all eight frames with evolving weapons until its full channel expires',()=>{
  const channel=Object.freeze({sid:'whirlwind',x:100,y:100,r:135,start:10,life:2.4,t:2.4,channel:true});
  const samples=Array.from({length:8},(_,i)=>actions.sampleSkill(channel,10.18+i/24,false));
  assert.equal(new Set(samples.map(s=>s.frame)).size,8);
  const late=actions.sampleSkill(channel,12.1,false);assert.ok(late.alpha>.5);assert.ok(late.cycle>6);
  const earlyCtx=recorder(),lateCtx=recorder();
  assert.ok(actions.drawChannel(earlyCtx,channel,10.4,false,{}));assert.ok(actions.drawChannel(lateCtx,channel,12.1,false,{}));
  assert.notDeepEqual(earlyCtx.calls,lateCtx.calls,'late channel continues weapon and dust choreography');
  assert.ok(lateCtx.calls.filter(([kind])=>kind==='arc').length>=5,'independent open weapon sweeps replace a plain circle');
  assert.ok(lateCtx.calls.filter(([kind])=>kind==='rotate').length>=2,'only the separately drawn weapon heads rotate');
  assert.equal(actions.drawChannel(recorder(),channel,12.41,false,{}),false);
  assert.equal(actions.sampleSkill(channel,10.4,true).frame,actions.sampleSkill(channel,12.1,true).frame);
});
test('sustained channels remain simulation-timed and drawing neither mutates state nor queues damage',()=>{
  for(const sid of ['whirlwind','storm','ravens','locusts','bladestorm','barrier','ironskin','aegis','hammers','quake','blizzard','vines','consecrate','trap','banner','berserk']){
    const channel=Object.freeze({sid,x:10,y:20,r:100,start:0,life:6,t:4});
    const a=recorder(),b=recorder();actions.drawChannel(a,channel,2,false,{});actions.drawChannel(b,channel,2,false,{});
    assert.deepEqual(a.calls,b.calls,`${sid} freezes with simulation time`);
    assert.deepEqual(Object.keys(channel),['sid','x','y','r','start','life','t']);
    assert.equal(actions.drawChannel(recorder(),channel,6.01,false,{}),false);
  }
  const state={time:0};for(let i=0;i<100;i++)actions.emitSkill(state,'fireball',1,2,60,0,.4);
  assert.equal(state.actions.length,24);assert.ok(state.actions.every(action=>!('dmg'in action)&&!('run'in action)));
  state.time=.41;actions.expire(state);assert.equal(state.actions.length,0);
});
