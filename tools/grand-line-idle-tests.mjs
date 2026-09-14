import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const dataUrl = moduleUrl(await readFile(new URL('../grand-line-data.js',import.meta.url),'utf8'));
const coreUrl = moduleUrl((await readFile(new URL('../grand-line-core.js',import.meta.url),'utf8')).replace(/(['"])\.\/grand-line-data\.js(?:\?[^'"]*)?\1/g,JSON.stringify(dataUrl)));
const core = await import(coreUrl);
const idle = await import(moduleUrl((await readFile(new URL('../grand-line-idle.js',import.meta.url),'utf8')).replace(/(['"])\.\/grand-line-core\.js(?:\?[^'"]*)?\1/g,JSON.stringify(coreUrl))));
function fixture(id='luffy'){
  const collection=core.createCollection();core.addCard(collection,id);
  core.setTeam(collection,[...new Set([id,...core.STARTER_IDS])].slice(0,5));
  const b=core.createBattle(collection,{seed:'idle-test'}),actor=b.allies.find(u=>u.characterId===id);
  b.status='player';b.activeId=actor.id;b.turnOrder=[actor.id,...b.allies.filter(u=>u!==actor).map(u=>u.id),...b.enemies.map(u=>u.id)];b.turnIndex=0;b.rng=()=>0.5;
  actor.energy=100;actor.cooldowns={};
  for(const enemy of b.enemies){enemy.hp=enemy.maxHp=10000;enemy.shield=0;enemy.statuses=[];enemy.passive={type:'none',value:0};}
  return {b,actor,collection};
}
test('idle speed uses bounded action intervals, with 4x as the safe default',()=>{
  assert.deepEqual(idle.IDLE_SPEEDS,[1,2,4]);
  assert.deepEqual([1,2,4,99,NaN].map(idle.idleActionDelay),[1000,500,250,250,250]);
});
test('all fifty characters choose legal actions under every crew strategy',()=>{
  for(const character of core.CHARACTERS) for(const strategy of Object.keys(idle.IDLE_STRATEGIES)){
    const {b,actor}=fixture(character.id),choice=idle.chooseIdleAction(b,strategy);
    assert.ok(choice,character.id+' '+strategy);
    if(choice.kind==='skill'){
      const skill=actor.skills.find(s=>s.id===choice.skillId);
      assert.ok(skill&&skill.cost<=actor.energy);
      assert.ok(core.getValidTargets(b,choice.skillId).some(t=>t.id===choice.targetId));
    }
    assert.ok(idle.advanceIdleBattle(b,strategy));
  }
});
test('idle doctors revive fallen allies before attacking',()=>{
  const {b}=fixture('chopper'),fallen=b.allies.find(u=>u.characterId==='luffy');fallen.hp=0;fallen.alive=false;
  const choice=idle.chooseIdleAction(b);assert.equal(choice.skillId,'chopper-2');assert.equal(choice.targetId,fallen.id);
  assert.ok(idle.advanceIdleBattle(b));assert.ok(fallen.hp>0);
});
test('idle doctors heal injured allies and avoid wasting medicine on healthy crews',()=>{
  const {b}=fixture('chopper'),wounded=b.allies.find(u=>u.characterId==='nami');
  assert.equal(idle.chooseIdleAction(b).skillId,'chopper-0');
  wounded.hp=1;const choice=idle.chooseIdleAction(b);assert.equal(choice.skillId,'chopper-1');assert.equal(choice.targetId,wounded.id);
  assert.ok(idle.advanceIdleBattle(b));assert.ok(wounded.hp>1);
});
test('idle choices obey energy, cooldowns and forced target rules',()=>{
  const {b,actor}=fixture();actor.energy=0;actor.cooldowns[actor.skills[2].id]=3;
  b.enemies[1].statuses=[{type:'taunt',duration:2,amount:0}];
  const choice=idle.chooseIdleAction(b);assert.equal(choice.skillId,'luffy-0');
  assert.ok(core.getValidTargets(b,choice.skillId).some(u=>u.id===choice.targetId));
  assert.ok(idle.advanceIdleBattle(b));
});
test('idle focus fire finishes an unshielded enemy instead of chasing false shielded kills',()=>{
  const {b,actor}=fixture();actor.energy=0;
  for(const enemy of b.enemies){enemy.hp=10000;enemy.shield=0;}
  b.enemies[0].hp=10;b.enemies[0].shield=200;b.enemies[1].hp=9;
  const choice=idle.chooseIdleAction(b);assert.equal(choice.targetId,b.enemies[1].id);
  assert.ok(idle.advanceIdleBattle(b));assert.equal(b.enemies[1].hp,0);assert.equal(b.enemies[0].shield,200);
});
test('idle strategy treats self-inflicted weakness as a penalty',()=>{
  const {b,actor}=fixture('wyper');
  const basic={...actor.skills[0],power:1,effects:[],cost:0,cooldown:0};
  actor.skills=[basic,{...basic,id:'recoil-comparison',effects:[{type:'weaken',amount:0.3,duration:2,scope:'self'}]}];
  assert.equal(idle.chooseIdleAction(b).skillId,basic.id);
});
test('idle combat stops at every question gate and cannot award points or skip grading',()=>{
  const {b,collection}=fixture();
  for(let i=0;i<40&&b.status!=='learning';i++)assert.ok(idle.advanceIdleBattle(b));
  assert.equal(b.status,'learning');const before=JSON.stringify(b),packs=collection.packs;
  for(let i=0;i<30;i++)assert.equal(idle.advanceIdleBattle(b),null);
  assert.equal(JSON.stringify(b),before);assert.equal(collection.packs,packs);assert.equal(collection.stats.correctAnswers,0);
  assert.equal(core.completeLearning(b,{total:2,correct:2}),false);
  const result=core.completeLearning(b,{total:3,correct:3,round:b.round});assert.equal(result.boost.attackMultiplier,1.3);
  assert.equal(result.boost.critBonus,0.15000000000000002);assert.equal(result.boost.defenseMultiplier,1.24);
  for(let i=0;i<40&&b.status!=='learning';i++)assert.ok(idle.advanceIdleBattle(b));
  assert.equal(b.status,'learning');assert.equal(b.learningBoost,null);assert.equal(collection.packs,packs);
});
test('idle finishers still stop for the final three-question gate before victory rewards',()=>{
  const {b,collection}=fixture();for(const enemy of b.enemies){enemy.hp=0;enemy.alive=false;}b.enemies[0].hp=1;b.enemies[0].alive=true;
  assert.ok(idle.advanceIdleBattle(b));assert.equal(b.status,'learning');assert.equal(b.pendingOutcome,'victory');
  assert.equal(collection.stats.victories,0);assert.equal(idle.advanceIdleBattle(b),null);
  core.completeLearning(b,{total:3,correct:3,round:b.round});assert.equal(b.status,'victory');assert.equal(collection.stats.victories,1);
});
