import test from 'node:test';
import assert from 'node:assert/strict';
import tree from '../science-legends-tree.js';
test('spatial browsing prefers visible aligned paths, crosses branches and stops at edges',()=>{
  const nodes=[{id:'a',row:0,col:0},{id:'b',row:0,col:2},{id:'c',row:2,col:0},{id:'d',row:3,col:2}];
  assert.equal(tree.next(nodes,'a','ArrowRight'),'b');assert.equal(tree.next(nodes,'a','ArrowDown'),'c');assert.equal(tree.next(nodes,'b','ArrowDown'),'d');assert.equal(tree.next(nodes,'a','ArrowLeft'),'a');assert.equal(tree.next(nodes,'d','Home'),'a');assert.equal(tree.next(nodes,'a','End'),'d');
});
