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
