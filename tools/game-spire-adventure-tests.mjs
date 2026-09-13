import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const app=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\r\n/g,'\n');
const spire=fs.readFileSync(path.join(root,'science-spire.html'),'utf8').replace(/\r\n/g,'\n');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/\r\n/g,'\n');
function section(s,a,b){const start=s.indexOf(a),end=s.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a);return s.slice(start,end);}
function fn(s,name){const start=s.indexOf('function '+name+'(');assert.ok(start>=0,name);const firstEnd=s.indexOf('\n',start);return s.slice(start,s.slice(start,firstEnd).trimEnd().endsWith('}')?firstEnd:s.indexOf('\n}',start)+2);}
function timers(){let now=1000,queue=[];return {date:{now:()=>now},later(fn,ms){queue.push({fn,at:now+ms});},advance(ms){const end=now+ms;let n=0;while(true){queue.sort((a,b)=>a.at-b.at);if(!queue.length||queue[0].at>end)break;const task=queue.shift();now=task.at;task.fn();assert.ok(++n<10000);}now=end;},clear(){queue=[];}};}
function node(){return {style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},appendChild(){},querySelector(){return null;},querySelectorAll(){return[];},getAnimations(){return[];}};}
function spireHarness(){
  const clock=timers(),state={won:0,renders:0};
  const names=['cardTarget','incomingForecast','playCard','onCardClick','onEnemyClick','drawCards','firstAlive','startPlayerTurn','enemyActSeq','spireRunCurrent'];
  const api=new Function('clock','state',`
    const setTimeout=(f,n)=>clock.later(f,n), console={warn(){}};
    let G,_busy=false,_selCard=null; const RARITY={common:'#aaa',uncommon:'#aaa',rare:'#aaa',epic:'#aaa',legendary:'#aaa'};
    const scienceFeed={context:()=>({studentKey:'child',studentLevel:'P4'})},embedded=()=>false;
    const toast=()=>{},addLog=()=>{},floatText=()=>{},flashHit=()=>{},setAnim=()=>{},castPop=()=>{},projectile=()=>{},reap=()=>{};
    const heroEl=()=>null,enemyEl=()=>null,render=()=>state.renders++,rollIntents=()=>{};
    const shuffle=a=>a,choice=a=>a[0];
    const winCombat=()=>{state.won++;G.state='reward';};
    const dealDamage=(e,n)=>{if(e&&!e.dead){e.hp-=n;if(e.hp<=0){e.dead=true;G.kills++;}}};
    const gainBlock=n=>G.player.block+=n,healPlayer=n=>G.player.hp+=n,damagePlayer=n=>G.player.hp-=n;
    ${section(spire,'var CARDS =','var RARITY =')}
    ${names.map(n=>fn(spire,n)).join('\n')}
    return {setup(hand=['strike']){G={feedContext:{studentKey:'child',studentLevel:'P4'},turn:'player',state:'combat',kills:0,player:{energy:3,maxEnergy:3,hp:60,maxHp:60,block:0,str:0},enemies:[{name:'A',hp:30,maxHp:30,dead:false,block:0,str:0,intent:{type:'attack',value:12}},{name:'B',hp:30,maxHp:30,dead:false,block:0,str:0,intent:{type:'attack',value:7}}],hand:[...hand],draw:[],discard:[]};_busy=false;_selCard=null;return G;},get:()=>G,selection:()=>_selCard,playCard,onCardClick,onEnemyClick,cardTarget,incomingForecast,startPlayerTurn,enemyActSeq};
  `)(clock,state);
  return {api,clock,state};
}
test('Spire: Acid Flask selects a live enemy before spending energy',()=>{const{api}=spireHarness();const g=api.setup(['poison']);api.onCardClick(0);assert.equal(api.selection(),0);assert.equal(g.player.energy,3);api.onEnemyClick(1);assert.equal(g.enemies[1].poison,5);assert.equal(g.player.energy,2);assert.equal(g.hand.length,0);});
test('Spire: invalid/dead target spends neither card nor energy',()=>{const{api}=spireHarness();const g=api.setup(['poison']);g.enemies[1].dead=true;api.playCard(0,1);assert.equal(g.player.energy,3);assert.equal(g.hand.length,1);api.playCard(0,99);assert.equal(g.hand.length,1);});
test('Spire: Adrenaline and Apex add usable player energy',()=>{const{api}=spireHarness();let g=api.setup(['adrenal']);api.playCard(0,null);assert.equal(g.player.energy,4);g=api.setup(['apex']);api.playCard(0,null);assert.equal(g.player.energy,1);assert.equal(g.player.str,1);assert.equal(g.enemies[0].hp,21);});
test('Spire: played card frees a hand slot before drawing',()=>{const{api}=spireHarness();const g=api.setup(['adrenal',...Array(9).fill('strike')]);g.draw=['guard'];api.playCard(0,null);assert.equal(g.hand.length,10);assert.equal(g.hand.at(-1),'guard');assert.deepEqual(g.discard,['adrenal']);});
test('Spire: forecast applies weakness and block and ignores dead foes',()=>{const{api}=spireHarness();const g=api.setup();g.enemies[0].weak=1;g.enemies[0].str=4;g.player.block=10;assert.deepEqual(api.incomingForecast(),{incoming:19,blocked:10,exposed:9,other:0});g.enemies[1].dead=true;assert.equal(api.incomingForecast().incoming,12);});
test('Spire: remaining-turn forecast does not count an enemy twice',()=>{const{api}=spireHarness();const g=api.setup();g.turn='enemy';g.actedEnemies=[g.enemies[0]];assert.equal(api.incomingForecast().incoming,7);});
test('Spire: selected card can be cancelled by tapping it again',()=>{const{api}=spireHarness();api.setup();api.onCardClick(0);assert.equal(api.selection(),0);api.onCardClick(0);assert.equal(api.selection(),null);});
test('Spire: delayed old enemy turn cannot damage a new run',()=>{const{api,clock}=spireHarness();const old=api.setup();old.turn='enemy';api.enemyActSeq(0);assert.equal(old.player.hp,48);const fresh=api.setup();clock.advance(1000);assert.equal(fresh.player.hp,60);assert.equal(fresh.turn,'player');});
test('Spire: poison ending the fight does not start another player turn',()=>{const{api,state}=spireHarness();const g=api.setup();g.enemies.forEach(e=>e.poison=40);g.draw=['guard'];api.startPlayerTurn(false);assert.equal(state.won,1);assert.equal(g.state,'reward');assert.deepEqual(g.draw,['guard']);});

function adventureHarness(){
  const clock=timers(),state={hits:0,casts:0,key:'child',level:'P4',nodes:new Map()};
  const $=id=>{if(!state.nodes.has(id))state.nodes.set(id,node());return state.nodes.get(id);};
  const names=['advNow','advAfter','advRunCurrent','advCancelStaleRun','advTogglePause','advUseSkill','advGuard','advGuardDamage','advStopLoop','advFrontFoe'];
  const api=new Function('clock','state','$',`
    const Date=clock.date,setTimeout=(f,n)=>clock.later(f,n),clearInterval=()=>{};
    let adv,advToken=1,advRafLast=0,currentUser={uid:'family'},rpgState={stats:{}};
    const _scienceFeedKey=()=>state.key,_scienceFeedLevel=()=>state.level;
    const advUpdateTactics=()=>{},advCast=()=>state.casts++,advFloat=()=>{},advOverlay=()=>{};
    ${names.map(n=>fn(app,n)).join('\n')}
    return {setup(){adv={phase:'fight',paused:false,pausedAt:0,timeOffset:0,guardUntil:0,guardReadyAt:0,ownerUid:'family',ownerKey:state.key,ownerLevel:state.level,ownerState:rpgState,skills:[{readyAt:0,def:{kind:'hit',cd:6}}],stats:{cdr:0},mods:{cdr:0},foes:[{dead:false}]};return adv;},get:()=>adv,now:advNow,pause:advTogglePause,guard:advGuard,damage:advGuardDamage,skill:advUseSkill,after:advAfter,current:advRunCurrent,cancel:advCancelStaleRun};
  `)(clock,state,$);return {api,clock,state};
}
test('Adventure: pause freezes the run clock and already launched hits',()=>{const{api,clock,state}=adventureHarness();api.setup();api.after(500,()=>state.hits++);clock.advance(100);api.pause();clock.advance(5000);assert.equal(api.now(),1100);assert.equal(state.hits,0);api.pause();clock.advance(399);assert.equal(state.hits,0);clock.advance(101);assert.equal(state.hits,1);});
test('Adventure: Guard reduces a hit by 60% and cannot be spammed',()=>{const{api,clock}=adventureHarness();api.setup();assert.equal(api.guard(),true);assert.equal(api.damage(20),8);assert.equal(api.guard(),false);clock.advance(1401);assert.equal(api.damage(20),20);clock.advance(6600);assert.equal(api.guard(),true);});
test('Adventure: Guard duration and cooldown do not expire while paused',()=>{const{api,clock}=adventureHarness();api.setup();api.guard();clock.advance(500);api.pause();clock.advance(12000);assert.equal(api.damage(20),8);assert.equal(api.guard(),false);api.pause();clock.advance(901);assert.equal(api.damage(20),20);assert.equal(api.guard(),false);});
test('Adventure: manual skills share the existing cooldown and pause gate',()=>{const{api,clock,state}=adventureHarness();api.setup();assert.equal(api.skill(0),true);assert.equal(api.skill(0),false);api.pause();clock.advance(9000);assert.equal(api.skill(0),false);api.pause();clock.advance(6000);assert.equal(api.skill(0),true);assert.equal(state.casts,2);});
test('Adventure: sibling switch discards delayed hits and the old run',()=>{const{api,clock,state}=adventureHarness();api.setup();api.after(500,()=>state.hits++);state.key='other-child';clock.advance(501);assert.equal(state.hits,0);assert.equal(api.get(),null);});
test('Adventure: grade change invalidates a paused run',()=>{const{api,state}=adventureHarness();api.setup();api.pause();state.level='P6';assert.equal(api.current(),false);assert.equal(api.cancel(),true);assert.equal(api.get(),null);});
test('Adventure: Ghost Arena still has no currency or XP payout',()=>{const body=fn(app,'advArenaEnd');assert.doesNotMatch(body,/rpgApplyRewards|rpgCreditKill|\.gold\s*[+=]|\.xp\s*[+=]/);assert.match(body,/arenaWins/);});
test('Adventure: automatic skill casting can be turned off without stopping basic attacks',()=>{const body=fn(app,'advTick');assert.match(body,/if \(!adv\.manualSkills\) adv\.skills\.forEach/);assert.match(body,/advAutoAttack\(\)/);});
