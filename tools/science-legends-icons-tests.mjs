import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import icons from '../science-legends-icons.js';

const html=fs.readFileSync(new URL('../science-legends.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../science-legends-icons.js',import.meta.url),'utf8');
const chunk=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end));
const {CLASSES,SKILLS,TREES}=vm.runInNewContext(
  chunk('var CLASSES = {','var FOLLOWERS = {')+
  chunk('var CAPSTONES = {','var EQUIP_SLOTS = [')+
  chunk('var TIER_REQ = [','/* ---- Tree state helpers ---- */')+
  ';({CLASSES,SKILLS,TREES})'
);

test('all 60 shipped skills select unique class-and-cell portraits in the actual class order',()=>{
  assert.equal(Object.keys(SKILLS).length,60);
  assert.equal(Object.keys(icons.mapping).length,60);
  const signatures=new Set(),indices=new Set();
  for(const [classId,hero] of Object.entries(CLASSES)){
    assert.equal(hero.skills.length,12);
    hero.skills.forEach((sid,slot)=>{
      assert.ok(Object.hasOwn(icons.mapping,sid),sid);
      const entry=icons.mapping[sid];
      assert.equal(entry.classId,classId,sid);
      assert.equal(entry.slot,slot,sid);
      assert.equal(entry.file,`assets/science-legends/v3/icons-${classId}.webp`);
      assert.ok(entry.index>=0&&entry.index<60);
      assert.equal(icons.index(sid),entry.index);
      signatures.add(`${entry.file}#${entry.slot}`);indices.add(entry.index);
      const markup=icons.markup(sid,SKILLS[sid]);
      assert.ok(markup.includes(`data-skill-icon="${sid}"`));
      assert.ok(markup.includes(`data-icon-class="${classId}"`));
      assert.ok(markup.includes(`data-icon-slot="${slot}"`));
      assert.ok(markup.includes(`background-position:${slot%4*(100/3)}% ${Math.floor(slot/4)*50}%`));
      assert.ok(markup.includes(SKILLS[sid].icon));
      assert.ok(markup.includes('aria-hidden="true"'));
    });
  }
  assert.equal(signatures.size,60,'archetype reuse must never collapse distinct skills onto the same portrait');
  assert.equal(indices.size,60);
});

test('real tree nodes inherit their own skill portrait with readable distinct upgrade badges',()=>{
  for(const [classId,nodes] of Object.entries(TREES)){
    assert.equal(nodes.length,176,classId);
    const ranks=nodes.filter(n=>n.kind==='rank');
    assert.equal(ranks.length,12);
    assert.equal(new Set(ranks.map(n=>icons.index(n.fx.skill))).size,12);
    for(const node of nodes){
      const markup=icons.treeMarkup(node,SKILLS);
      if(node.kind==='passive'||node.kind==='cap'){
        assert.ok(markup.includes('legend-node-symbol'),node.id);
        assert.ok(markup.includes(node.icon),`${classId} ${node.id} keeps its specific original icon`);
        assert.ok(!markup.includes('data-skill-icon'),node.id);
        continue;
      }
      const sid=node.fx&&(node.fx.unlock||node.fx.skill)||node.ultInfo?.sid||node.sm?.sid||node.mod?.split('.')[0];
      assert.ok(markup.includes(`data-skill-icon="${sid}"`),`${classId} ${node.id}`);
      assert.ok(markup.includes(`data-icon-slot="${CLASSES[classId].skills.indexOf(sid)}"`));
      if(node.kind==='rank')assert.ok(!markup.includes('icon-kind-badge'));
      else assert.ok(markup.includes('icon-kind-badge'),`${node.id} distinguishes an upgrade from its base skill`);
    }
    for(const sid of CLASSES[classId].skills){
      const upgrades=nodes.filter(n=>n.id.endsWith('_'+sid)&&['enh','branch','ult'].includes(n.kind));
      assert.equal(upgrades.length,11);
      assert.equal(new Set(upgrades.map(n=>icons.treeMarkup(n,SKILLS).match(/class="icon-kind-badge"[^>]*>([^<]+)/)[1])).size,11,`${sid} upgrade badges differ`);
    }
  }
});

test('a missing class atlas preserves only that class fallback while other classes remain ready',()=>{
  const images=[],classes=new Set();
  const context={Image:class{constructor(){images.push(this);this.naturalWidth=0;}},document:{documentElement:{classList:{toggle(name,on){on?classes.add(name):classes.delete(name);},remove(name){classes.delete(name);}}}}};
  vm.runInNewContext(source,context);
  const api=context.LegendsIcons;
  assert.equal(images.length,5);
  assert.equal(api.ready(),false);
  for(const image of images){
    if(image.src.endsWith('icons-sorc.webp')){image.onerror();continue;}
    image.naturalWidth=1024;image.onload();
  }
  assert.equal(api.ready('sorc'),false);assert.equal(api.ready('barb'),true);assert.equal(api.ready(),false);
  assert.equal(classes.has('legends-icons-ready-sorc'),false);
  assert.equal(classes.has('legends-icons-ready-barb'),true);
  const sorc=images.find(i=>i.src.endsWith('icons-sorc.webp'));sorc.naturalWidth=1024;sorc.onload();
  assert.equal(api.ready(),true);
  sorc.onerror();assert.equal(api.ready('sorc'),false);
  assert.equal(classes.has('legends-icons-ready-sorc'),false);
  assert.equal(api.ready('pala'),true);
});

test('unknown skills stay explicit fallbacks and all decorative text is escaped',()=>{
  assert.equal(icons.index('missing'),-1);
  assert.equal(icons.index('__proto__'),-1);
  for(const sid of ['missing','__proto__'])assert.ok(!icons.markup(sid,{icon:'?'}).includes('icon-art'));
  const markup=icons.markup('<img onerror=alert(1)>',{icon:'<script>'},{kind:'"onclick="x',badge:'<b>',label:'"hello"'});
  assert.ok(!markup.includes('<img'));assert.ok(!markup.includes('<script>'));assert.ok(!markup.includes('<b>'));
  assert.ok(markup.includes('&lt;script&gt;'));assert.ok(markup.includes('&quot;hello&quot;'));
});
