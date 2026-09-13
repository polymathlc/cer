import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const defenders=read('science-defenders.html'),raiders=read('science-raiders.html');
function actual(source,name){
  const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);
  const open=source.indexOf('{',start);let depth=1,i=open+1;
  for(;depth && i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}')depth--;}
  assert.equal(depth,0,name+' is complete');return source.slice(source.slice(start-6,start)==='async '?start-6:start,i);
}
function fixture(source,names,boundaries){
  const context=vm.createContext({Math,Number,Array,String,...boundaries});
  vm.runInContext(names.map(name=>actual(source,name)).join('\n'),context);return context;
}
for(const [name,source] of [['Defenders',defenders],['Raiders',raiders]])test(name+' complete game scripts parse',()=>{
  let count=0;for(const script of source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
    if(!script[2].trim() || /module|json/.test(script[1]))continue;
    new vm.Script(script[2]);count++;
  }assert.ok(count>0);
});
function defence(){return fixture(defenders,['dist','enemyPathProgress','acquireTarget','setTowerTarget'],{
  PATH:[{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:400,y:20}],G:{enemies:[],towers:[]},refreshDetailPanel(){},
});}
test('First targeting follows true travelled distance across unequal path segments',()=>{
  const f=defence(),tower={x:100,y:20,range:600};
  f.G.enemies=[{x:90,y:0,wp:0,hp:50},{x:100,y:15,wp:1,hp:50},{x:101,y:20,wp:2,hp:50}];
  assert.equal(f.enemyPathProgress(f.G.enemies[1]),115);
  assert.equal(f.acquireTarget(tower),f.G.enemies[2]);
});
test('Strongest and Nearest offer distinct real targets without changing damage or costs',()=>{
  const f=defence(),tower={x:100,y:20,range:600,targetMode:'strong',damage:10,invested:80};
  f.G.enemies=[{x:98,y:0,wp:0,hp:200},{x:100,y:15,wp:1,hp:50},{x:150,y:20,wp:2,hp:100}];
  assert.equal(f.acquireTarget(tower),f.G.enemies[0]);tower.targetMode='near';
  assert.equal(f.acquireTarget(tower),f.G.enemies[1]);assert.equal(tower.damage,10);assert.equal(tower.invested,80);
});
test('Every priority ignores dead, escaped and out-of-range enemies',()=>{
  const f=defence();f.G.enemies=[{x:100,y:10,wp:1,hp:5},{x:100,y:19,wp:1,hp:900,dead:true},{x:110,y:20,wp:2,hp:999,reachedEnd:true},{x:350,y:20,wp:2,hp:9999}];
  for(const targetMode of ['first','strong','near'])assert.equal(f.acquireTarget({x:100,y:20,range:30,targetMode}),f.G.enemies[0]);
  f.G.enemies=[];assert.equal(f.acquireTarget({x:0,y:0,range:30}),null);
});
test('A tower priority change requires a placed tower and supported mode',()=>{
  const f=defence(),tower={targetMode:'first'};f.setTowerTarget(tower,'strong');assert.equal(tower.targetMode,'first');
  f.G.towers=[tower];f.setTowerTarget(tower,'arbitrary');assert.equal(tower.targetMode,'first');
  f.setTowerTarget(tower,'strong');assert.equal(tower.targetMode,'strong');
});
test('Wave intelligence reads the actual upcoming groups and stays on the active wave',()=>{
  const f=fixture(defenders,['waveIntel'],{G:{wave:1,totalWaves:3,waveInProgress:false},WAVES:[[{t:'scout',n:6}],[{t:'tank',n:4},{t:'swarm',n:9}],[{t:'swarm',n:20}]],ENEMY_TYPES:{scout:{name:'Scout'},tank:{name:'Tank'},swarm:{name:'Swarm'}}});
  assert.equal(f.waveIntel().title,'Next wave 2 · 13 enemies');assert.match(f.waveIntel().tip,/Strongest/);
  f.G.waveInProgress=true;assert.equal(f.waveIntel().title,'Current wave 1 · 6 enemies');
  f.G.wave=3;f.G.waveInProgress=false;assert.match(f.waveIntel().tip,/rapid or splash/);
});
test('Defenders freezes enemies during questions, loading, quiz gaps, help, pause and hidden tabs',()=>{
  let introHidden=true;const f=fixture(defenders,['defendersCanAdvance'],{G:{running:true,paused:false},qState:{active:false},scienceFeedOpening:false,preRound:{active:false},document:{hidden:false,getElementById:()=>({classList:{contains:()=>introHidden}})}});
  assert.equal(f.defendersCanAdvance(),true);
  for(const [object,key] of [[f.G,'paused'],[f.qState,'active'],[f.preRound,'active'],[f.document,'hidden']]){object[key]=true;assert.equal(f.defendersCanAdvance(),false,key);object[key]=false;}
  f.scienceFeedOpening=true;assert.equal(f.defendersCanAdvance(),false);f.scienceFeedOpening=false;
  introHidden=false;assert.equal(f.defendersCanAdvance(),false);introHidden=true;f.G.running=false;assert.equal(f.defendersCanAdvance(),false);
});
test('Reading the Defenders guide preserves the run, credit balance and prior pause state',()=>{
  const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{textContent:id,classList:{add(){},remove(){}},disabled:false});return elements.get(id);};
  const f=fixture(defenders,['openDefendersGuide','closeDefendersGuide'],{G:{running:true,paused:false,coins:70,towers:[{}]},_gPlaysLeft:4,defendersHelpState:null,document:{getElementById:element,querySelectorAll:()=>[]},setDefendersPaused(value){f.G.paused=value;}});
  f.openDefendersGuide();assert.equal(f.G.paused,true);assert.equal(element('topicSelect').disabled,true);
  assert.equal(f.closeDefendersGuide(),true);assert.equal(f.G.paused,false);assert.equal(f.G.coins,70);assert.equal(f.G.towers.length,1);assert.equal(f._gPlaysLeft,4);assert.equal(f.closeDefendersGuide(),false);
  f.G.paused=true;f.openDefendersGuide();f.closeDefendersGuide();assert.equal(f.G.paused,true);
});
function firing(){const shots=[];return {shots,f:fixture(raiders,['enemyWindup','updateEnemyFire'],{VIEW_W:720,enemyShoot:(enemy,angle)=>shots.push({enemy,angle})})};}
test('Raiders locks its announced aim and fires only after the dodge window',()=>{
  const {f,shots}=firing(),enemy={range:500,fireCd:.2,fireRate:1,shot:'single'};
  f.updateEnemyFire(enemy,.1,.25,200);assert.equal(enemy.aimLock,.25);assert.equal(shots.length,0);
  f.updateEnemyFire(enemy,.2,2,200);assert.equal(shots.length,0);
  f.updateEnemyFire(enemy,.11,2,200);assert.equal(shots.length,1);assert.equal(shots[0].angle,.25);assert.equal(enemy.aimLock,null);assert.equal(enemy.fireCd,1);
});
test('Snipers give a longer window, with no hidden instantly retargeted shot',()=>{
  const {f,shots}=firing(),enemy={range:600,fireCd:0,fireRate:2,shot:'fast'};
  f.updateEnemyFire(enemy,.4,1,200);assert.equal(shots.length,0);
  f.updateEnemyFire(enemy,.21,2,200);assert.equal(shots.length,1);assert.equal(shots[0].angle,1);
});
test('Leaving range cancels enemy aim; returning grants a fresh full warning',()=>{
  const {f,shots}=firing(),enemy={range:200,fireCd:0,fireRate:1,shot:'single'};
  f.updateEnemyFire(enemy,.1,.2,100);f.updateEnemyFire(enemy,.4,.5,250);assert.equal(enemy.aimLock,null);assert.equal(shots.length,0);
  f.updateEnemyFire(enemy,.1,1,100);assert.equal(enemy.aimLock,1);assert.equal(shots.length,0);
  f.updateEnemyFire(enemy,.31,2,100);assert.equal(shots.length,1);assert.equal(shots[0].angle,1);
});
test('Boss aimed bursts also use the telegraph window across the arena',()=>{
  const {f,shots}=firing(),enemy={behavior:'boss',range:0,fireCd:0,fireRate:1,shot:'spread3'};
  f.updateEnemyFire(enemy,.1,.6,600);assert.equal(enemy.aimLock,.6);assert.equal(shots.length,0);
  f.updateEnemyFire(enemy,.31,1.8,600);assert.equal(shots.length,1);assert.equal(shots[0].angle,.6);
});
test('Dash cannot activate while paused, outside combat or when the document is hidden',()=>{
  const f=fixture(raiders,['tryDash'],{G:{state:'play',player:{dashCd:0,iframes:0,x:1,y:1,facing:0}},paused:true,document:{hidden:false},moveVector:()=>({x:1,y:0}),addParticle(){}});
  f.tryDash();assert.equal(f.G.player.dashTime,undefined);f.paused=false;f.G.state='question';f.tryDash();assert.equal(f.G.player.dashTime,undefined);
  f.G.state='play';f.document.hidden=true;f.tryDash();assert.equal(f.G.player.dashTime,undefined);f.document.hidden=false;
  f.tryDash();assert.equal(f.G.player.dashTime,.16);assert.equal(f.G.player.dashCd,.9);assert.equal(f.G.player.iframes,.22);
  f.G=null;assert.doesNotThrow(()=>f.tryDash());
});
test('Raiders pause and resume clear stale keyboard, mouse and touch movement',()=>{
  const f=fixture(raiders,['resetRaiderInput','pauseRaid','resumeRaid'],{G:{state:'play'},paused:false,keys:{w:true},mouse:{active:true,down:true},touchMove:{active:true,dx:30,dy:30,id:9},document:{hidden:false},show(){},hide(){}});
  f.pauseRaid();assert.equal(f.paused,true);assert.equal(Object.keys(f.keys).length,0);assert.equal(f.touchMove.active,false);assert.equal(f.mouse.active,false);
  f.document.hidden=true;f.resumeRaid();assert.equal(f.paused,true);f.document.hidden=false;f.resumeRaid();assert.equal(f.paused,false);assert.equal(f.touchMove.id,null);
});
test('Releasing a secondary touch never cancels the movement finger',()=>{
  const f=fixture(raiders,['endRaiderTouch'],{touchMove:{active:true,id:2,dx:40,dy:20}});
  let prevented=0;f.endRaiderTouch({changedTouches:[{identifier:3}],preventDefault(){prevented++;}});assert.equal(f.touchMove.active,true);assert.equal(prevented,0);
  f.endRaiderTouch({changedTouches:[{identifier:2}],preventDefault(){prevented++;}});assert.equal(f.touchMove.active,false);assert.equal(f.touchMove.dx,0);assert.equal(prevented,1);
});
test('Defenders retires a changed learner without reporting the old run; same learner stays active',()=>{
  let identity={studentKey:'child-a',studentLevel:'P4'},reports=0;
  const f=fixture(defenders,['retireDefendersIdentity'],{G:{running:true,waveInProgress:true,spawning:true,spawnQueue:[{}]},defendersRunKey:'child-a',defendersRunLevel:'P4',defendersRunEpoch:3,preRound:{active:true},defendersHelpState:null,scienceFeed:{context:()=>identity},document:{getElementById:()=>({classList:{remove(){}}}),querySelectorAll:()=>[]},setDefendersPaused(){},toast(){},reportScore(){reports++;}});
  assert.equal(f.retireDefendersIdentity(),false);assert.equal(f.G.running,true);
  identity={studentKey:'child-b',studentLevel:'P5'};assert.equal(f.retireDefendersIdentity(),true);assert.equal(f.G.running,false);assert.equal(f.G.spawning,false);assert.equal(f.preRound.active,false);assert.equal(f.defendersRunEpoch,4);assert.equal(reports,0);
});
test('Raiders retires a changed learner or level without publishing a score',()=>{
  let identity={studentKey:'child-a',studentLevel:'P4'},retired=0,reports=0;
  const f=fixture(raiders,['retireRaiderIdentity'],{G:{state:'play'},raiderRunKey:'child-a',raiderRunLevel:'P4',scienceFeed:{context:()=>identity},backToMenu(){retired++;f.G=null;},toast(){},reportScore(){reports++;}});
  assert.equal(f.retireRaiderIdentity(),false);identity={studentKey:'child-a',studentLevel:'P5'};
  assert.equal(f.retireRaiderIdentity(),true);assert.equal(retired,1);assert.equal(reports,0);assert.equal(f.G,null);
});
test('A delayed Defenders bank response cannot reopen a question in a replacement run',async()=>{
  let resolve;const f=fixture(defenders,['openQuestion'],{G:{running:true},qState:{active:false},defendersRunEpoch:3,scienceFeedOpening:false,scienceFeed:{refresh:()=>new Promise(done=>resolve=done)},pickQuestion(){throw Error('stale response must not take a question');}});
  const pending=f.openQuestion();f.defendersRunEpoch++;resolve();await pending;assert.equal(f.qState.active,false);
});
test('A delayed Raiders bank response cannot reopen a question after the run is retired',async()=>{
  let resolve;const f=fixture(raiders,['openQuestion'],{G:{state:'question'},qState:{active:false},scienceFeedOpening:false,scienceFeed:{refresh:()=>new Promise(done=>resolve=done)},pickQuestion(){throw Error('stale response must not take a question');}});
  const pending=f.openQuestion();f.G=null;resolve();await pending;assert.equal(f.qState.active,false);
});
for(const [name,source] of [['Defenders',defenders],['Raiders',raiders]])test(name+' waits for current trusted game credits before starting an embedded run',()=>{
  let identity={studentKey:'',studentLevel:''};const window={parent:{}};
  const f=fixture(source,['_gameCreditIdentity','_gameCreditsReady','_canPlayGame'],{window,_gPlaysLeft:null,_gPlaysIdentity:'',JSON,scienceFeed:{context:()=>identity}});
  assert.equal(f._canPlayGame(),false);
  identity={studentKey:'child',studentLevel:'P4'};assert.equal(f._canPlayGame(),false);
  f._gPlaysLeft=0;assert.equal(f._canPlayGame(),false);
  f._gPlaysLeft=1;assert.equal(f._canPlayGame(),false);f._gPlaysIdentity=f._gameCreditIdentity();assert.equal(f._canPlayGame(),true);
  identity={studentKey:'other',studentLevel:'P4'};assert.equal(f._canPlayGame(),false);
  f._gPlaysLeft=null;window.parent=window;assert.equal(f._canPlayGame(),true);
});
for(const [name,source,prefix] of [['Defenders',defenders,'defenders'],['Raiders',raiders,'raider']])test(name+' outbound score and play packets keep the run learner identity',()=>{
  const packets=[];
  const f=fixture(source,['reportScore','_noteGamePlayStart'],{
    window:{parent:{postMessage:packet=>packets.push(packet)}},flagEmbedded:()=>true,embedded:()=>true,
    _gameCreditsReady:()=>true,_gPlaysLeft:2,
    [prefix+'RunKey']:'captured-child',[prefix+'RunLevel']:'P4',
    scienceFeed:{context:()=>({studentKey:'new-child',studentLevel:'P6'})},
    G:{score:100,wave:2,totalWaves:12},fmt:String,raidScore:()=>100,raidScoreLabel:()=>'Floor 1',
  });
  f.reportScore(false);f._noteGamePlayStart();
  assert.equal(packets.length,2);
  for(const packet of packets){assert.equal(packet.studentKey,'captured-child');assert.equal(packet.studentLevel,'P4');}
  assert.equal(f._gPlaysLeft,1);
});
