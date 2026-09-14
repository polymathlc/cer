import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SCIENCE_TCG_IDENTITIES, scienceTcgIdentity, scienceTcgSignaturePlan, scienceTcgSkillPath } from '../science-tcg-identity.js';
import { applyScienceTcgSignature, scienceTcgBrandedDamage, scienceTcgAbsorbBarrier } from '../science-tcg-runtime.js';
const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const slice = (a, b) => { const x = source.indexOf(a), y = source.indexOf(b, x); assert.ok(x >= 0 && y > x, a); return source.slice(x, y); };
const dex = vm.runInNewContext(slice('const TCG_GEN1 =', '// The sets, for the headings') + ';TCG_CARDS');
const unit = (id, hp = 80, maxHp = 100) => ({ id, uid:id, hp, maxHp, atk:10, shield:0, cds:{a:5}, charge:0, cool:4 });

test('all 201 saved card IDs retain roster order and each has an implemented identity', () => {
  assert.equal(dex.length, 201);
  dex.forEach((c, i) => { assert.equal(c.id, 'c' + String(i + 1).padStart(3, '0')); assert.ok(scienceTcgIdentity(c), c.name); });
  const high = dex.filter(c => c.stars >= 6);
  assert.equal(high.length, 19);
  assert.deepEqual(Array.from(high,c => c.id).sort(), Object.keys(SCIENCE_TCG_IDENTITIES).sort());
  assert.equal(new Set(high.map(c => scienceTcgIdentity(c).kind)).size, 19);
});
for (const mode of ['arena', 'duel', 'siege', 'legends']) {
  test(mode + ': every high-star signature changes actual combat state through its adapter', () => {
    for (const card of dex.filter(c => c.stars >= 6)) {
      const actor=unit('self'), friend=unit('friend',30), foes=[unit('foe1',20),unit('foe2',70,180),unit('foe3',60)];
      actor.poison={dmg:5};friend.poison={dmg:5};
      const before=JSON.stringify([actor,friend,foes]);let hits=0;
      const plan=applyScienceTcgSignature(mode,{card,actor,allies:[actor,friend],enemies:foes,power:mode==='duel'?2:20,damage:(t,n)=>{t.hp-=n;hits++;}});
      assert.ok(plan.length, card.name);
      // Exclude bookkeeping: a proc counter alone is not a gameplay change.
      delete actor._signature;
      assert.notEqual(JSON.stringify([actor,friend,foes]),before,card.name);
      assert.ok(foes.every(t=>Number.isFinite(t.hp)));
      assert.ok(actor.hp>0 && actor.hp<=actor.maxHp);
    }
  });
}
test('Iron Capacitor alternates defence then offence across the same run',()=>{
  const state={},actor=unit('self'),foe=unit('foe'),card=dex.find(c=>c.id==='c147');
  assert.equal(scienceTcgSignaturePlan(card,actor,[actor],[foe],state)[0].type,'shield');
  assert.equal(scienceTcgSignaturePlan(card,actor,[actor],[foe],state)[0].type,'damage');
});
test('barriers absorb and brands are consumed exactly once, without multiplying forever',()=>{
  const t=unit('target');t._signatureShield=8;
  assert.equal(scienceTcgAbsorbBarrier(t,5),0);assert.equal(t._signatureShield,3);
  assert.equal(scienceTcgAbsorbBarrier(t,7),4);assert.equal(t._signatureShield,0);
  t._signatureBrand={amount:.25,flat:false};assert.equal(scienceTcgBrandedDamage(t,20),25);assert.equal(scienceTcgBrandedDamage(t,20),20);
  t._signatureBrand={amount:1,flat:true};assert.equal(scienceTcgBrandedDamage(t,2),3);
});
test('pact costs cannot kill, dead units cannot trigger and status wards resist control',()=>{
  const card=dex.find(c=>c.id==='c198'),actor=unit('self',1),foe={...unit('foe'),wardStatus:true};
  applyScienceTcgSignature('arena',{card,actor,allies:[actor],enemies:[foe],power:20,damage:(t,n)=>t.hp-=n});
  assert.equal(actor.hp,1);assert.equal(foe._signatureBrand,undefined);
  actor.hp=0;assert.deepEqual(scienceTcgSignaturePlan(card,actor,[actor],[foe]),[]);
});

test('Duel cleansing restores freeze-locked attacks while preserving turn and Rush limits',()=>{
  const card=dex.find(c=>c.id==='c145');
  for(const [flags,expected] of [
    [{frozen:1,justPlayed:false,attacked:false},true],
    [{frozen:0,justPlayed:false,attacked:false},true],
    [{frozen:0,justPlayed:false,attacked:true},false],
    [{frozen:1,justPlayed:true,attacked:false},false],
    [{frozen:1,justPlayed:true,attacked:false,ab:{kw:['rush']},rushOnly:true},true],
    [{frozen:1,justPlayed:true,attacked:false,ab:{kw:['charge']},rushOnly:false},true]
  ]){
    const actor=unit('self'),friend={...unit('friend',1),canAttack:false,...flags};
    applyScienceTcgSignature('duel',{card,actor,allies:[actor,friend],enemies:[],power:2,damage:()=>{}});
    assert.equal(friend.frozen,0);assert.equal(friend.canAttack,expected,JSON.stringify(flags));
    assert.equal(friend.attacked,flags.attacked);assert.equal(friend.justPlayed,flags.justPlayed);
    assert.equal(friend.rushOnly,flags.rushOnly);
  }
});
test('all four new role skills have real prerequisites and are reachable at three earned points',()=>{
  const tree=vm.runInNewContext(slice('const ELG_TREES =','// ---- The connective tissue') + ';ELG_TREES');
  for(const [role,id] of [['striker','st_follow'],['arcanist','ar_reserve'],['mender','me_overflow'],['warden','wa_recoil']]){
    const path=scienceTcgSkillPath(tree[role],id,{});assert.equal(path.length,3,id);
    assert.equal(path.at(-1),id);const owned={};path.forEach(key=>{const n=tree[role].find(n=>n.id===key);assert.ok(!n.req||owned[n.req]);owned[key]=1;});
    assert.deepEqual(scienceTcgSkillPath(tree[role],id,owned),[]);
  }
});
test('live engine wiring includes healer, wall, turn-based, cooldown and pause paths',()=>{
  assert.equal((slice('function emsUpdate(dt)', '// ---- Shots').match(/tcgSignatureSiege\(d\)/g)||[]).length,3);
  assert.match(slice('function duelCommitPlay','function duelResolveSpell'),/tcgSignatureDuel\(who, m\)/);
  assert.match(slice('async function _tcgAct','// Artifact badge'),/signatureSession/);
  assert.match(slice('function elgUpdate','function elgHitDamage'),/tcgSignatureLegends\(\)/);
  for(const name of ['elgClose','emsClose','duelClose','tcgCloseBattle','elgOpenTree','elgOpenQuiz','elgTogglePause','emsTogglePause'])assert.match(source,new RegExp('function '+name+'\\([^)]*\\) \\{\\s*tcgCombatStop\\(\\);'));
  assert.match(source,/slice\(0, 6\)/);assert.match(source,/slice\(0, 4\)/);
});
