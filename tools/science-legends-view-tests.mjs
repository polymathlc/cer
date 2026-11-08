import test from 'node:test';
import assert from 'node:assert/strict';
import view from '../science-legends-view.js';
test('fixed view mapping is its exact inverse at every viewport and world edge', () => {
  for (const [width,height] of [[320,700],[390,844],[1280,800],[3200,2800]]) {
    for (const [x,y] of [[0,0],[1150,1150],[2300,2300]]) {
      const camera=view.create(x,y,width,height,2300,2300);
      for (const [sx,sy] of [[0,0],[width/2,height/2],[width,height]]) {
        const point=view.screenToWorld(camera,sx,sy), screen=view.worldToScreen(camera,point.x,point.y);
        assert.deepEqual(screen,{x:sx,y:sy});
      }
      assert.equal(camera.scale,1);assert.equal(camera.angle,0);
    }
  }
});
test('oversized viewports center the world rather than clamping to a negative maximum',()=>{
  const camera=view.create(100,100,3200,2800,2300,2300);
  assert.equal(camera.x,-450);assert.equal(camera.y,-250);
  assert.deepEqual(view.worldToScreen(camera,1150,1150),{x:1600,y:1400});
});
test('normal viewports clamp at both world edges and remain deterministic',()=>{
  assert.equal(view.create(0,0,1280,800,2300,2300).x,0);
  assert.equal(view.create(2300,2300,1280,800,2300,2300).x,1020);
  const camera=view.create(1150,1150,1280,800,2300,2300);
  assert.deepEqual(camera,view.create(1150,1150,1280,800,2300,2300));
  assert.equal(camera.offsetX,0);assert.equal(camera.offsetY,0);
});
