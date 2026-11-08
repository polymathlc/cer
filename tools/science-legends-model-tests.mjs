import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import models from '../science-legends-models.js';
const html=fs.readFileSync(new URL('../science-legends.html',import.meta.url),'utf8');
function fn(name){let start=html.indexOf('function '+name+'('),open=html.indexOf('{',start),depth=0;for(let i=open;i<html.length;i++){if(html[i]==='{')depth++;if(html[i]==='}'&&--depth===0)return html.slice(start,i+1);}throw Error(name);}
test('upright hero contract preserves size and ground anchor in every class/facing/spin state',()=>{
  const draws=[],w={G:null,heroSheets:[['idle','stride']],_ovrImgs:{},window:{},drawSpriteOr:(...args)=>draws.push(args)};
  vm.createContext(w);vm.runInContext(fn('drawActorModel')+'\n'+fn('drawHeroModel'),w);
  for(const cls of ['barb','sorc','beast','pala','ama'])for(const [fx,fy]of [[1,0],[-1,0],[0,1],[0,-1]])for(const spin of [null,{radius:100}]){
    w.G={cls,spin,player:{x:200,y:250,r:16,fx,fy,moving:true,animT:1}};w.drawHeroModel();
    const [id,sheet,x,y,size,flip]=draws.at(-1);assert.equal(id,'hero_'+cls);assert.equal(sheet,'idle');assert.equal(x,200);assert.equal(y+size/2,266);assert.equal(size,72);assert.equal(flip,fx<0);
  }
});
test('atlas animation uses simulation time and preserves fixed source dimensions',()=>{
  assert.equal(models.stateFrame({moving:false},1,false),0);
  assert.equal(models.stateFrame({moving:true},0,false),1);
  assert.equal(models.stateFrame({moving:true},.15,false),2);
  assert.equal(models.stateFrame({moving:true,modelAttackUntil:2},1,false),3);
  assert.equal(models.stateFrame({moving:true},.15,true),1);
  const row0=models.sourceRect(1402,1122,5,2,0),row3=models.sourceRect(1402,1122,5,2,3);
  assert.equal(row0.w,row3.w);assert.equal(row0.h,row3.h);assert.equal(row0.x,row3.x);
});
test('foot measurement ignores transparent padding and never rescales raised-weapon frames',()=>{
  const pixels=new Uint8Array(100*100*4);for(let y=10;y<90;y++)for(let x=30;x<70;x++)pixels[(y*100+x)*4+3]=255;
  const anchor=models.footAnchor(pixels,100,100);assert.equal(anchor.y,.89);assert.equal(anchor.x,.495);
});
test('six enemy archetypes select unique columns and halt locomotion under control effects',()=>{
  ['slime','imp','mite','brute','spitter','charger'].forEach((kind,index)=>assert.equal(models.enemyColumn(kind),index));
  assert.equal(models.enemyColumn('boss'),3);assert.equal(models.enemyColumn('unknown'),-1);
  assert.equal(models.enemyFrame({moving:true},.15,false),2);
  assert.equal(models.enemyFrame({moving:true,frozen:1},.15,false),0);
  assert.equal(models.enemyFrame({moving:true,stun:1},.15,false),0);
  assert.equal(models.enemyFrame({moving:true,chargeSt:1},.15,false),3);
  assert.equal(models.enemyFrame({moving:true,modelAttackUntil:1},.15,false),3);
});
