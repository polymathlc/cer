import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=source.indexOf('function notifyLegendsSurfaceVisibility('),end=source.indexOf('\n}',start)+2;
const actual=source.slice(start,end);
function harness(){
  const messages=[],listeners={};let src='science-legends.html?v=test',active=true;
  const frame={dataset:{},getAttribute:()=>src,addEventListener:(type,fn)=>{listeners[type]=fn;},contentWindow:{postMessage:(data,origin)=>messages.push({data,origin})}};
  const wrapper={style:{display:'flex'}},page={classList:{contains:()=>active}};
  const document={hidden:false,getElementById:id=>id==='legendsFrame'?frame:id==='appWrapper'?wrapper:id==='page-legends'?page:null};
  const context=vm.createContext({document,location:{origin:'https://school.test'}});vm.runInContext(actual,context);
  return {context,document,frame,wrapper,messages,listeners,setActive:value=>{active=value;},setSrc:value=>{src=value;}};
}
test('portal visibility sends a strict same-origin active-surface signal, then freezes the inactive game',()=>{
  const f=harness();assert.equal(f.context.notifyLegendsSurfaceVisibility(),true);
  assert.equal(f.messages[0].origin,'https://school.test');assert.equal(f.messages[0].data.type,'SD_GAME_VISIBILITY');assert.equal(f.messages[0].data.mode,'legends');assert.equal(f.messages[0].data.active,true);
  f.setActive(false);assert.equal(f.context.notifyLegendsSurfaceVisibility(),false);assert.equal(f.messages[1].data.active,false);
  f.context.notifyLegendsSurfaceVisibility();assert.equal(f.messages.length,2);
});
test('hiding the whole app or parent browser tab pauses an otherwise active game',()=>{
  const f=harness();f.wrapper.style.display='none';assert.equal(f.context.notifyLegendsSurfaceVisibility(),false);
  f.wrapper.style.display='flex';f.document.hidden=true;assert.equal(f.context.notifyLegendsSurfaceVisibility(),false);
  f.document.hidden=false;assert.equal(f.context.notifyLegendsSurfaceVisibility(),true);
});
test('load binding survives initial lazy frames and resends the real state after reload',()=>{
  const f=harness();f.setSrc(null);assert.equal(f.context.notifyLegendsSurfaceVisibility(),false);assert.equal(f.messages.length,0);assert.equal(typeof f.listeners.load,'function');
  f.setSrc('science-legends.html');f.setActive(false);f.listeners.load();assert.equal(f.messages[0].data.active,false);
  f.listeners.load();assert.equal(f.messages.length,2);assert.equal(f.messages[1].data.active,false);
});
test('missing or disconnected frames never break navigation',()=>{
  const f=harness();f.frame.contentWindow=null;assert.equal(f.context.notifyLegendsSurfaceVisibility(),false);
  f.document.getElementById=()=>null;assert.equal(f.context.notifyLegendsSurfaceVisibility(),false);
});
test('production navigation, auth surfaces and browser visibility invoke the publisher',()=>{
  const navigation=source.slice(source.indexOf('function navigateTo('),source.indexOf('function navigateTo(')+15000);
  assert.ok(navigation.indexOf('notifyLegendsSurfaceVisibility();')>navigation.indexOf("classList.add('active')"));
  const auth=source.slice(source.indexOf('function showPage('),start);
  assert.match(auth,/notifyLegendsSurfaceVisibility\(\);/);
  assert.match(source,/visibilitychange', \(\) => notifyLegendsSurfaceVisibility\(\)/);
});
