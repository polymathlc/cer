// Exercise saved platform callbacks after cancellation/retirement. These tests
// observe worker ownership and public sheet readiness, never private request maps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const modelsSource=fs.readFileSync(new URL('../science-legends-models.js',import.meta.url),'utf8');

function fixture(){
  const images=[],workers=[],timers=new Map(),timerHistory=new Map(),listeners=new Map();let timerId=0,extracts=0;
  const frame=()=>({x:0,y:0,w:1,h:1,anchor:{x:.5,y:1},nominalWidth:1,nominalHeight:1,pixels:1,visiblePixels:1,core:{x:0,y:0,w:1,h:1},rgba:new Uint8ClampedArray([130,160,190,255])});
  const frames=columns=>Array.from({length:columns},()=>Array.from({length:4},frame));
  class FakeImage{constructor(){this.naturalWidth=24;this.naturalHeight=16;images.push(this);}set src(value){this.url=value;}get src(){return this.url;}}
  class FakeWorker{
    constructor(){this.posts=[];this.terminated=0;workers.push(this);}
    postMessage(message){this.posts.push(message);}
    terminate(){this.terminated++;}
    reply(message=this.posts.at(-1)){this.onmessage?.({data:{id:message.id,frames:frames(message.columns),missing:[]}});}
  }
  const scope={Image:FakeImage,Worker:FakeWorker,URL,Uint8ClampedArray,Event:class{constructor(type){this.type=type;}},
    ImageData:class{constructor(data,width,height){this.data=data;this.width=width;this.height=height;}},
    location:{href:'https://worker-lifecycle.test/science-legends.html'},
    document:{currentScript:{src:'https://worker-lifecycle.test/science-legends-models.js'},createElement(type){assert.equal(type,'canvas');return{width:0,height:0,getContext(){return{drawImage(){},getImageData(){return{data:new Uint8ClampedArray(24*16*4)};},putImageData(){},createImageData(width,height){return{data:new Uint8ClampedArray(width*height*4)};}};}};}},
    LegendsAtlas:{extract(_pixels,_width,_height,columns){extracts++;return{frames:frames(columns),missing:[]};},cropPixels(){return new Uint8ClampedArray([130,160,190,255]);}},
    setTimeout(fn,delay){const id=++timerId,record={fn,delay};timers.set(id,record);timerHistory.set(id,record);return id;},
    clearTimeout(id){timers.delete(id);},
    addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
    dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event);}
  };
  scope.window=scope;vm.runInContext(modelsSource,vm.createContext(scope),{filename:'science-legends-models.js'});
  const load=file=>{const image=images.find(i=>i.url.endsWith('/'+file+'.webp'));assert.ok(image,'sheet image '+file);image.onload();return image;};
  const timer=delay=>{const entry=[...timers].find(([,t])=>t.delay===delay);assert.ok(entry,'pending '+delay+'ms timer');return entry[0];};
  const fire=id=>{const record=timers.get(id);assert.ok(record,'active timer '+id);timers.delete(id);record.fn();};
  const replay=id=>{assert.ok(timerHistory.has(id));timerHistory.get(id).fn();};
  const flushFallbacks=()=>{for(const[id,record]of[...timers])if(record.delay===0)fire(id);};
  return{api:scope.LegendsModels,workers,load,timer,fire,replay,flushFallbacks,get extracts(){return extracts;},frames};
}

function retireFirst(f){
  f.load('heroes');const worker=f.workers[0],error=worker.onerror,message=worker.onmessage;worker.reply();assert.equal(f.api.ready('hero'),true);const idle=f.timer(500);f.fire(idle);assert.equal(worker.terminated,1);return{worker,error,message,idle};
}

test('a retired worker late error is harmless with no active replacement',()=>{
  const f=fixture(),old=retireFirst(f);let prevented=0;
  assert.doesNotThrow(()=>old.error({preventDefault(){prevented++;}}));
  assert.doesNotThrow(()=>old.error({preventDefault(){prevented++;}}));
  assert.equal(prevented,2);assert.equal(old.worker.terminated,1);assert.equal(f.api.ready('hero'),true);
  f.load('enemies-clean');assert.equal(f.workers.length,2,'late errors do not disable future worker preparation');
});

test('saved retired error callbacks cannot terminate, disable or drain an active replacement',()=>{
  const f=fixture(),old=retireFirst(f);f.load('enemies-clean');f.load('companions');const current=f.workers[1];
  assert.doesNotThrow(()=>old.error({preventDefault(){}}));assert.doesNotThrow(()=>old.error({preventDefault(){}}));f.flushFallbacks();
  assert.equal(current.terminated,0);assert.equal(f.extracts,0);assert.equal(f.api.ready('enemy'),false);assert.equal(f.api.ready('companion'),false);
  f.load('heroes-rear');assert.equal(f.workers.length,2);assert.equal(current.posts.length,3,'replacement worker remains enabled');
  for(const request of current.posts)current.reply(request);
  assert.equal(f.api.ready('enemy'),true);assert.equal(f.api.ready('companion'),true);assert.equal(f.api.ready('heroRear'),true);
});

test('a saved retired message cannot publish or drain a replacement request with the same ID',()=>{
  const f=fixture(),old=retireFirst(f);f.load('enemies-clean');f.load('companions');const current=f.workers[1];
  assert.equal(current.posts.length,2);const [enemy,companion]=current.posts;
  // A stale sender even knows the replacement request ID; sender ownership wins.
  old.message({data:{id:enemy.id,frames:f.frames(enemy.columns),missing:[]}});
  assert.equal(f.api.ready('enemy'),false,'stale messages cannot publish replacement data');
  f.flushFallbacks();assert.equal(current.terminated,0);assert.equal(f.extracts,0,'replacement requests are not drained into fallback');
  assert.equal(f.api.ready('enemy'),false);assert.equal(f.api.ready('companion'),false);
  current.reply(enemy);assert.equal(f.api.ready('enemy'),true);assert.equal(f.api.ready('companion'),false);current.reply(companion);assert.equal(f.api.ready('companion'),true);
  f.load('heroes-rear');assert.equal(f.workers.length,2);assert.equal(current.posts.length,3,'replacement remains enabled and owns subsequent requests');
  current.reply();assert.equal(f.api.ready('heroRear'),true);
});

test('a saved retired idle callback cannot prematurely retire the replacement after its queue drains',()=>{
  const f=fixture(),old=retireFirst(f);f.load('enemies-clean');const current=f.workers[1];f.replay(old.idle);assert.equal(current.terminated,0);
  current.reply();const currentIdle=f.timer(500);f.replay(old.idle);assert.equal(current.terminated,0,'old timer cannot retire an idle replacement');
  f.fire(currentIdle);assert.equal(current.terminated,1,'the replacement still retires on its own deadline');f.replay(currentIdle);assert.equal(current.terminated,1);
});

test('cancelled idle callback is ignored when the same worker has a newer retirement generation',()=>{
  const f=fixture();f.load('heroes');const worker=f.workers[0];worker.reply();const cancelledIdle=f.timer(500);
  f.load('enemies-clean');assert.equal(f.workers.length,1);f.replay(cancelledIdle);assert.equal(worker.terminated,0);
  worker.reply();const actualIdle=f.timer(500);assert.notEqual(actualIdle,cancelledIdle);f.replay(cancelledIdle);assert.equal(worker.terminated,0);
  f.fire(actualIdle);assert.equal(worker.terminated,1);
});

test('current worker failure falls back each pending sheet once despite duplicate late callbacks',()=>{
  const f=fixture();f.load('heroes');f.load('enemies-clean');const worker=f.workers[0],error=worker.onerror,message=worker.onmessage,first=worker.posts[0];
  error({preventDefault(){}});assert.equal(worker.terminated,1);assert.equal(f.api.ready('hero'),false);assert.equal(f.api.ready('enemy'),false);
  assert.doesNotThrow(()=>error({preventDefault(){}}));message({data:{id:first.id,frames:f.frames(first.columns),missing:[]}});
  assert.equal(f.api.ready('hero'),false,'late responses do not bypass the scheduled fallback');f.flushFallbacks();
  assert.equal(f.extracts,2);assert.equal(f.api.ready('hero'),true);assert.equal(f.api.ready('enemy'),true);
  error({preventDefault(){}});f.flushFallbacks();assert.equal(f.extracts,2);assert.equal(worker.terminated,1);
  f.load('companions');assert.equal(f.api.ready('companion'),true);assert.equal(f.workers.length,1,'a genuine current failure deliberately selects safe synchronous fallback');assert.equal(f.extracts,3);
});
