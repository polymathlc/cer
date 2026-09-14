// Production TCG tables, rules, renderers and handlers; only portal account,
// storage, question-bank and asset-index boundaries use local fixtures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const slice=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);};
const assets={};
for(const dir of ['battle-avatars','card-art']){
  const full=path.join(root,'assets/realm-of-embers',dir);if(!fs.existsSync(full))continue;
  for(const f of fs.readdirSync(full)){const id=f.match(/^c\d{3}/)?.[0];if(id)assets[dir+':'+id]='/assets/realm-of-embers/'+dir+'/'+f;}
}
for(const f of fs.readdirSync(path.join(root,'assets/realm-of-embers/heroes'))){assets['hero:'+f.replace(/\.webp$/,'')]= '/assets/realm-of-embers/heroes/'+f;}
const fixture=`
import {scienceTcgIdentity,scienceTcgIdentityText,scienceTcgSkillPath} from './science-tcg-identity.js';
import {applyScienceTcgSignature,scienceTcgBrandedDamage,scienceTcgAbsorbBarrier} from './science-tcg-runtime.js';
import {createTcgMedia} from './tcg-media.js';
const tcgMedia=createTcgMedia({storageKey:'test-tcg-audio'});tcgMedia.installControls(document);
const assets=${JSON.stringify(assets)};
const APP_VERSION='test',currentUser={uid:'test',name:'P6 learner',role:'student'}, db={};
const _tcgConfig={duelReleased:true,legendsReleased:true},_tcgArt={};
const model={cards:{},levels:{},merges:{},team:['c149','c150','c151','c200','c201'],gold:0,duel:{},legends:{}};
const rpgState={tcg:model,gold:0,gameScores:{}};
const tcgState=()=>model, escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tcgAvatarUrl=id=>assets['battle-avatars:'+id]||null,tcgArtUrl=id=>assets['card-art:'+id]||tcgAvatarUrl(id),tcgHeroArtUrl=id=>assets['hero:'+id]||null,duelFxFrames=()=>null,tcgSlotArt=()=>null,tcgLoadArt=async()=>{},tcgLoadConfig=async()=>{};
const tcgEyeHtml=()=>'',_isAdmin=()=>false,tcgRenderBody=()=>{},showToast=()=>{},tcgConfetti=()=>{},rpgSave=()=>{},rpgPublishLeaderboard=()=>{},rpgEnsureGameScores=()=>{},rpgApplyGameLevel=()=>{},rpgSyncTopbar=()=>{},rpgLogGameRun=()=>{},_spendCredit=()=>true;
const _tcgQuizPool=()=>[],_tcgServedLoad=()=>({}),_tcgShuffle=a=>a.slice(),_tcgSyncProgress=()=>{},rpgLevel=()=>1;
const doc=(...a)=>a,setDoc=async()=>{},getDoc=async()=>({exists:()=>false}),serverTimestamp=()=>null;
const _htmlPlainText=s=>String(s||'').replace(/<[^>]*>/g,''), qIsRetired=()=>false;
const rpgTouch=()=>{},rpgRender=()=>{},rpgModeId='tcg';
${slice('const TCG_ELEMENTS =','// ---- Booster packs')}
${slice('const TCG_FX_PHASES =','// \'fx:cosmic:fly2\'')}
${slice('const DUEL_FX_SHAPES =','function duelFxSlotId')}
${slice('function _tcgTargetByStrat','let _tcgConfig')}
${slice('function duelReleased()','// Inline handlers on the TCG page/overlays')}
TCG_CARDS.forEach(c=>{model.cards[c.id]=1;model.levels[c.id]=10;model.merges[c.id]=1;});
Object.assign(window,{elgStart,elgClose,elgTogglePause,elgOpenTree,elgCloseTree,elgTreeSelect,elgBuy,elgCast,emsLaunch,emsClose,emsSelect,emsPlace,emsTogglePause,emsOpenQuiz,emsCloseQuiz,duelOpen,duelStart,duelClose,duelEndTurn,duelTap,duelPlayCard,duelToggleSfx,tcgBattleSpeed,tcgCloseBattle,tcgSkipBattle});
window.qa={get elg(){return elgRun},get ems(){return emsRun},get duel(){return duelRun},cards:TCG_CARDS,media:tcgMedia,elgUpdate,elgRender,elgDamage,elgHeal,elgHurt,elgPassives,tcgSignatureLegends,emsUpdate,emsRender,tcgSignatureSiege,tcgSignatureDuel,duelSummon,duelMakeHandCard,duelRender,duelBeginTurn,duelCommitPlay,duelAttack,duelPeekHtml,tcgRunBattle,get arena(){return _tcgBattle},model,ELG_TREES,ELG_NODE_BY_ID};
window.__ready=true;
`;
const styles=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[0]).join('\n');
const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+'<link rel="stylesheet" href="/tcg-upgrade.css"><body><button id="start">Start test battle</button><script type="module" src="/fixture.js"></script></body>';
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='tcg.test')return route.abort();if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});if(u.pathname==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:fixture});const p=path.join(root,decodeURIComponent(u.pathname));if(!p.startsWith(root)||!fs.existsSync(p))return route.fulfill({status:404,body:''});return route.fulfill({contentType:p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.webp')?'image/webp':'application/octet-stream',body:fs.readFileSync(p)});});
const screens=process.env.TCG_SCREENSHOTS;if(screens)fs.mkdirSync(screens,{recursive:true});
const shot=async n=>{if(screens)await page.screenshot({path:path.join(screens,n+'.png'),fullPage:true});};
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
try{
  await page.goto('https://tcg.test/');
  await page.waitForFunction(()=>window.__ready,null,{timeout:8000}).catch(e=>{throw Error(errors.join('\n')||e.message)});
  await page.click('#start');
  await page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<div class="elg-overlay" id="elgOverlay"></div>');elgStart('c201');cancelAnimationFrame(qa.elg.raf);});
  await page.evaluate(()=>{const r=qa.elg;r.breather=999;r.atkN=3;r.atkT=99;r.spawnQ=[];r.enemies=[{id:1,card:qa.cards[10],x:r.x+80,y:r.y,hp:900,maxHp:900,dmg:1,speed:5,r:14,swing:1,stun:0},{id:2,card:qa.cards[11],x:r.x-100,y:r.y+40,hp:900,maxHp:900,dmg:1,speed:5,r:14,swing:1,stun:0}];qa.elgUpdate(.01);qa.elgRender();});
  ok(await page.evaluate(()=>qa.elg.enemies.every(e=>e.stun>0)&&qa.elg.shield>0),'Snow Queen really controls enemies and gains barrier');
  ok(await page.locator('.tcg-audio-controls').count()>0,'Sound control mounted in real Legends toolbar');
  await page.waitForTimeout(300);await shot('01-legends-battle');
  await page.evaluate(()=>{qa.elg.sp=3;elgOpenTree();elgTreeSelect('ar_reserve');});
  ok(await page.locator('#elgTree .elg-legend-box').count()===0,'Winter identity has one description instead of duplicate boxes');
  ok(await page.locator('.tcg-tree-routes button').count()===2,'Both role capstone destinations visible');
  ok(await page.locator('.tcg-route-steps button').count()===3,'Actual prerequisite path shown');
  await shot('02-tree-path');
  await page.evaluate(()=>{elgBuy('ar_pierce');elgBuy('ar_chain');elgBuy('ar_reserve');});
  ok(await page.evaluate(()=>qa.elg.tree.ar_reserve===1&&qa.elg.sp===0),'Three earned points buy real reachable new node');
  await page.evaluate(()=>{elgCloseTree();qa.elg.cds.ar_chain=5;qa.elg.atkN=3;qa.elg.atkT=99;qa.elgUpdate(.01);});
  ok(await page.evaluate(()=>qa.elg.cds.ar_chain<4),'Reservoir changes live cooldown');
  await page.evaluate(()=>elgTogglePause());
  ok(await page.evaluate(()=>qa.elg.paused&&qa.media.settings.voices===0),'Pause stops combat voices');
  await page.setViewportSize({width:390,height:844});await shot('03-mobile-battle');
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'Mobile game fits viewport');
  await page.evaluate(()=>{elgOpenTree();});await shot('04-mobile-tree');
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{elgClose();document.body.insertAdjacentHTML('beforeend','<div class="elg-overlay" id="elgOverlay"></div>');elgStart('c200');const r=qa.elg;cancelAnimationFrame(r.raf);r.sp=3;r.breather=999;elgBuy('st_step');elgBuy('st_dash');elgBuy('st_follow');elgCast('st_dash');r.enemies=[{id:50,card:qa.cards[0],x:r.x+70,y:r.y,hp:100000,maxHp:100000,dmg:1,speed:1,r:12,stun:0,swing:1}];r.atkT=99;qa.elgUpdate(.001);});
  ok(await page.evaluate(()=>qa.elg.shots.length===2&&!qa.elg.followShot),'Pursuit Echo fires one extra shot and consumes the charge');
  await page.evaluate(()=>{elgClose();document.body.insertAdjacentHTML('beforeend','<div class="elg-overlay" id="elgOverlay"></div>');elgStart('c145');const r=qa.elg;cancelAnimationFrame(r.raf);r.sp=3;elgBuy('me_vital');elgBuy('me_bloom');elgBuy('me_overflow');r.hp=r.maxHp;qa.elgHeal(100);});
  ok(await page.evaluate(()=>qa.elg.shield>0&&qa.elg.shield<=qa.elg.maxHp*.2),'Overflowing Grace converts real excess healing into capped protection');
  await page.evaluate(()=>{elgClose();document.body.insertAdjacentHTML('beforeend','<div class="elg-overlay" id="elgOverlay"></div>');elgStart('c194');const r=qa.elg;cancelAnimationFrame(r.raf);r.sp=3;elgBuy('wa_plate');elgBuy('wa_aegis');elgBuy('wa_recoil');r.shield=100;r.shieldT=6;const foe={id:70,card:qa.cards[0],x:r.x,y:r.y,hp:100000,maxHp:100000,stun:0};r.enemies=[foe];qa.elgHurt(10,foe);});
  ok(await page.evaluate(()=>qa.elg.enemies[0].stun===1),'Shield Reprisal stuns the attacker after a fully absorbed blow');
  await page.locator('.tcg-audio-controls button').click();
  ok(await page.evaluate(()=>!qa.media.settings.enabled&&qa.media.settings.voices===0),'Real mute control stops voices');
  await page.locator('.tcg-audio-controls button').click();
  await page.locator('[data-tcg-audio="volume"]').focus();await page.keyboard.press('End');
  ok(await page.evaluate(()=>qa.media.settings.volume===1),'Real keyboard volume control updates preference');
  await page.evaluate(()=>{elgClose();emsLaunch();});await page.waitForFunction(()=>window.qa.ems);
  await page.evaluate(()=>{const r=qa.ems;cancelAnimationFrame(r.raf);r.breather=999;r.mana=400;emsSelect('c194');emsPlace(2,1);r.mana=400;emsSelect('c145');emsPlace(2,0);r.defenders[0].hp=r.defenders[0].maxHp/2;const healer=r.defenders.find(d=>d.card.id==='c145');healer._signatureBeat=3;healer.cool=0;qa.emsUpdate(.01);qa.emsRender();});
  ok(await page.evaluate(()=>qa.ems.defenders.find(d=>d.card.id==='c145')._signature?.casts===1),'Siege healer triggers signature through healing branch');
  await shot('05-siege');
  await page.evaluate(()=>{const r=qa.ems;r.defenders=[];r.mana=400;emsSelect('c141');emsPlace(2,1);const d=r.defenders[0];d._signatureBeat=3;d.cool=0;r.enemies=[{id:900,card:qa.cards[0],lane:2,x:3,hp:100000,maxHp:100000,atk:1,spd:0,cool:99}];qa.emsUpdate(.01);});
  ok(await page.evaluate(()=>{const d=qa.ems.defenders[0];return d._signature.casts===1&&d.cool<=Math.max(0,d.p.rate-1.5);}), 'Siege Rally shortens the firing actor cooldown after its fourth projectile');
  await page.evaluate(()=>{emsClose();duelOpen();});await page.waitForTimeout(100);
  await page.waitForFunction(()=>window.qa.duel);
  await page.evaluate(()=>{const r=qa.duel;r.p.mana=10;r.p.cap=10;const foe=qa.duelSummon(qa.duelMakeHandCard('c147','E',1),'E');foe.shield=false;foe.hp=100;foe.maxHp=100;r.e.board=[foe];r.p.hand=[qa.duelMakeHandCard('c201','P',1)];qa.duelCommitPlay('P',0,null);});
  ok(await page.evaluate(()=>qa.duel.e.board[0].frozen===1&&qa.duel.p.board[0].shield),'Duel actual card play applies signature freeze and shield');
  await page.waitForFunction(()=>[...document.querySelectorAll('#duelShell img')].every(img=>img.complete));await shot('06-duel');
  await page.evaluate(()=>{const r=qa.duel;r.p.mana=10;r.p.hand=[qa.duelMakeHandCard('c147','P',1)];qa.duelCommitPlay('P',0,null);const actor=r.p.board.at(-1);actor.canAttack=true;actor.attacked=false;actor.frozen=0;qa.duelAttack(actor.uid,r.e.board[0].uid,false);});
  ok(await page.evaluate(()=>qa.duel.p.board.at(-1)._signature.casts===2),'Iron Capacitor discharge is reachable through the first actual attack');
  await page.evaluate(()=>{const r=qa.duel;const friend=qa.duelSummon(qa.duelMakeHandCard('c147','P',1),'P');friend.frozen=1;friend.canAttack=false;friend.hp=1;friend.maxHp=100;r.p.board=[friend];r.e.board=[];qa.duelBeginTurn('P');r.p.mana=10;r.p.hand=[qa.duelMakeHandCard('c145','P',1)];qa.duelCommitPlay('P',0,null);const before=r.e.hp;qa.duelAttack(friend.uid,'hero',false);window.__cleanseAttack={attacked:friend.attacked,dealt:before-r.e.hp};});
  ok(await page.evaluate(()=>window.__cleanseAttack.attacked&&window.__cleanseAttack.dealt>0),'Duel purification restores an actual attack after turn start consumed the freeze counter');
  await page.evaluate(()=>{duelClose();void qa.tcgRunBattle(['c149','c150','c151','c200','c201'],{name:'P6 learner'},{name:'Local sparring squad',tcgTeam:['c141','c142','c143','c144','c145'],ghost:true});});
  await page.waitForSelector('#tcgbStage',{timeout:6000}).catch(e=>{throw Error(errors.join('; ')||e.message)});await page.waitForTimeout(2350);await shot('07-arena');
  ok(await page.locator('#tcgbStage .tcgb-unit').count()===10,'Arena renders original ten-card match with upgrade controls');
  await page.evaluate(()=>tcgCloseBattle());
  ok(await page.evaluate(()=>qa.media.settings.voices===0),'Leaving the arena clears procedural voices');
  ok(errors.length===0,'No production handler errors: '+errors.join('; '));
  console.log(checks+' production TCG browser assertions passed');
}finally{await browser.close();}
