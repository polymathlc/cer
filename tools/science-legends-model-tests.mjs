import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../science-legends.html',import.meta.url),'utf8');
function fn(name){let start=html.indexOf('function '+name+'('),open=html.indexOf('{',start),depth=0;for(let i=open;i<html.length;i++){if(html[i]==='{')depth++;if(html[i]==='}'&&--depth===0)return html.slice(start,i+1);}throw Error(name);}
test('upright hero contract preserves size and ground anchor in every class/facing/spin state',()=>{
  const draws=[],w={G:null,heroSheets:[['idle','stride']],drawSpriteOr:(...args)=>draws.push(args)};
  vm.createContext(w);vm.runInContext(fn('drawActorModel')+'\n'+fn('drawHeroModel'),w);
  for(const cls of ['barb','sorc','beast','pala','ama'])for(const [fx,fy]of [[1,0],[-1,0],[0,1],[0,-1]])for(const spin of [null,{radius:100}]){
    w.G={cls,spin,player:{x:200,y:250,r:16,fx,fy,moving:true,animT:1}};w.drawHeroModel();
    const [id,sheet,x,y,size,flip]=draws.at(-1);assert.equal(id,'hero_'+cls);assert.equal(sheet,'idle');assert.equal(x,200);assert.equal(y+size/2,266);assert.equal(size,52);assert.equal(flip,fx<0);
  }
});
