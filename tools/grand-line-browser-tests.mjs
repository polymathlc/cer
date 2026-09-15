import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.GRAND_LINE_SCREENSHOTS || path.join(root, 'test-results', 'grand-line');
const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(runtime) ? pathToFileURL(runtime).href : runtime);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

// This fixture owns an entirely separate in-memory wallet. It uses the actual
// economy and parent grading controller, never either portal or a real account.
const harness = `<!doctype html><meta charset="utf-8"><title>Isolated Grand Line test wallet</title>
<style>body{margin:0}iframe{border:0;width:100%;height:100vh}#questions{position:fixed;z-index:10;inset:15%;background:white;padding:32px;font:20px sans-serif;border:3px solid black}button{font:inherit;padding:16px;margin:8px}</style>
<div id="questions" hidden></div><script type="module">
import {createGrandLineLearningController} from '/grand-line-learning-parent.js';
import {createGrandLineEconomy} from '/grand-line-economy.js';
import {createCollection} from '/grand-line-core.js';
const administrator=new URLSearchParams(location.search).get('role')==='admin';
const ctx={profileKey:'test-profile',admin:administrator}, profile=createCollection();
if(administrator)profile.cards.luffy.copies=3;
let state={gold:administrator?0:5000,grandLine:{profiles:{'test-profile':{collection:profile}}}};
const offers=[{id:'spark',name:'Bronze',cost:120,odds:{1:40,2:30,3:17,4:8,5:3.5,6:1.2,7:.3}},{id:'nova',name:'Silver',cost:320,bonusOdds:{3:62,4:25,5:9,6:3,7:1}},{id:'galaxy',name:'Gold',cost:750,bonusOdds:{4:68,5:22,6:8,7:2}}];
window.fake={legacyHost:new URLSearchParams(location.search).get('legacy')==='1',requests:[],records:[],adminCalls:[],role:administrator?'admin':'student',randomValue:0,randomCalls:0,questionIndex:0,commits:0,blockPurchase:false,failPurchaseResponseOnce:false,blockSave:false,blockAdmin:false,holdAdmin:false,failAdminResponseOnce:false,get state(){return state;}};
const currentContext=()=>({...ctx,admin:fake.role==='admin'});
const economy=createGrandLineEconomy({getState:()=>state,getUser:()=>({uid:'test-user',role:fake.role}),getPacks:()=>offers,isCurrent:c=>c.profileKey===ctx.profileKey&&c.admin===(fake.role==='admin'),random:()=>{fake.randomCalls++;return fake.randomValue;},commit:async next=>{state=next;fake.commits++;}});
const frame=document.createElement('iframe');frame.id='game';
const controller=createGrandLineLearningController({origin:location.origin,subject:'Math',getFrame:()=>frame,getIdentity:()=> 'test-identity:'+fake.role,getProfileKey:()=>ctx.profileKey,isAllowed:()=>true,isActive:()=>true,isAdmin:()=>fake.role==='admin',makeSessionId:()=> 'test-session',getSnapshot:()=>economy.getSnapshot(currentContext()),buyPack:async d=>{if(fake.blockPurchase)throw Object.assign(Error('Test pack unavailable'),{confirmedNoCharge:true});const result=await economy.buyPack(d,currentContext());if(fake.failPurchaseResponseOnce){fake.failPurchaseResponseOnce=false;throw Error('Test purchase response interrupted');}return result;},saveCollection:d=>{if(fake.blockSave)throw Error('Test progress save failure');return economy.saveCollection(d,currentContext());},adminAction:async d=>{fake.adminCalls.push({...d});if(fake.holdAdmin)await new Promise(resolve=>{fake.releaseAdmin=()=>{fake.holdAdmin=false;resolve();};});if(fake.blockAdmin)throw Error('Test admin save unavailable');const result=await economy.adminAction(d,currentContext());if(fake.failAdminResponseOnce){fake.failAdminResponseOnce=false;throw Error('Test admin response interrupted');}return result;},getQuestions:()=>[0,1,2].map(i=>({id:'test-q-'+i,html:'<p>Test question '+(i+1)+'</p>',options:['Wrong','Correct'],answer:1})),recordAnswer:async r=>fake.records.push({correct:r.correct,round:r.round}),presentQuestions:({questions,grade})=>new Promise(resolve=>{const box=document.querySelector('#questions');fake.questionIndex=0;box.hidden=false;function draw(){box.replaceChildren();const p=document.createElement('p');p.id='question-index';p.textContent='Question '+(fake.questionIndex+1)+' of 3';box.append(p);for(let choice=0;choice<2;choice++){const b=document.createElement('button');b.dataset.answer=choice;b.textContent=choice?'Correct':'Wrong';b.onclick=async()=>{b.disabled=true;const result=await grade(fake.questionIndex,choice,1000);if(!result)return;fake.questionIndex++;if(fake.questionIndex===3){box.hidden=true;resolve(true);}else draw();};box.append(b);}}draw();})});
window.addEventListener('message',event=>{if(event.source===frame.contentWindow){fake.requests.push(event.data);if(fake.legacyHost&&event.data?.type==='GLTCG_HELLO'){const post=frame.contentWindow.postMessage;frame.contentWindow.postMessage=function(data,...args){if(data?.type==='GLTCG_READY'){data={...data};delete data.maxPackQuantity;}return post.call(this,data,...args);};}if(fake.legacyHost&&event.data?.type==='GLTCG_BUY_REQUEST'){const data={...event.data};delete data.quantity;controller.handleMessage({origin:event.origin,source:event.source,data});return;}}controller.handleMessage(event);});
fake.send=data=>frame.contentWindow.postMessage(data,location.origin);
fake.snapshot=()=>economy.getSnapshot(currentContext());
fake.invalidate=()=>controller.invalidate('The signed-in role changed.');
frame.src='/grand-line.html?test=1&subject=math&learning=1';document.body.append(frame);
</script>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__harness.html') { res.setHeader('Content-Type', 'text/html'); res.end(harness); return; }
    if (url.pathname === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || !mime[path.extname(file)]) { res.statusCode = 403; res.end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)]); res.end(await fs.readFile(file));
  } catch (_) { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
await fs.mkdir(shots, { recursive: true });
const errors = [], checks = [];
function observe(page) { page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message)); }
const check = label => { checks.push(label); process.stdout.write(`PASS ${label}\n`); };
async function frames(page, count = 2) { await page.evaluate(count => new Promise(resolve => { function tick() { if (--count <= 0) resolve(); else requestAnimationFrame(tick); } requestAnimationFrame(tick); }), count); }
async function screenshot(page, name) { await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: !name.includes('detail') }); }
async function noOverflow(page) {
  const width=page.viewportSize().width;
  assert.ok(await page.evaluate(width=>document.documentElement.scrollWidth<=width+2,width),'Page fits its configured viewport without horizontal overflow');
}
async function standalone(page, subject = 'math') {
  await page.goto(base + '/grand-line.html?test=1&subject=' + subject);
  await page.waitForFunction(() => window.__grandLine?.ready);
  await page.evaluate(() => { __grandLine.settings.muted = true; });
}
async function clearWave(frame) {
  await frame.evaluate(() => {
    const a=__grandLine,b=a.battle;
    if(b.status!=='running')throw Error('Only a running wave may be cleared');
    b.spawned=b.spawnTotal;b.remainingToSpawn=0;
    for(const enemy of b.enemies){enemy.hp=0;enemy.alive=false;}
    a.advanceDefense(b,.05);a.renderBattle();
  });
  await frame.waitForFunction(()=>__grandLine.battle.status==='learning');
}
async function checkWaveEntrances(frame,{spawned=false}={}) {
  const expected=await frame.evaluate(async()=>{
    const {getDefenseWavePreview}=await import('./grand-line-defense.js');const b=__grandLine.battle,p=getDefenseWavePreview(b);
    return {round:b.round,total:p.total,entries:p.entrances,all:__grandLine.DEFENSE_GRID.entryIds};
  });
  const markers=await frame.locator('#wave-entrances [data-entry]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.entry,active:n.dataset.active==='true',text:n.textContent,label:n.getAttribute('aria-label')})));
  assert.deepEqual(markers.map(m=>m.id),expected.all,'All three named entrances remain visible');
  assert.deepEqual(markers.filter(m=>m.active).map(m=>m.id),expected.entries.map(e=>e.id),`Wave ${expected.round} highlights only the entrances that will release enemies`);
  for(const entry of expected.entries)assert.match(markers.find(m=>m.id===entry.id).label,new RegExp(entry.label+' entrance: '+entry.count+' enemies'));
  assert.equal(expected.entries.reduce((sum,e)=>sum+e.count,0),expected.total,'Entrance counts account for the full wave');
  assert.equal(expected.entries.length,1+(expected.round-1)%3);
  if(spawned){
    await frame.waitForFunction(ids=>{const b=__grandLine.battle;return b.status==='running'&&ids.every(id=>b.enemies.some(e=>e.entryId===id));},expected.entries.map(e=>e.id));
    const observed=await frame.evaluate(()=>[...new Set(__grandLine.battle.enemies.map(e=>e.entryId))].sort());
    assert.deepEqual(observed,expected.entries.map(e=>e.id).sort(),'Real frame-driven spawns match the advertised gates');
  }
}
async function answerThree(host,choice=1) {
  await host.locator('#questions').waitFor({state:'visible'});
  for(let i=0;i<3;i++) {
    assert.match(await host.locator('#question-index').textContent(),new RegExp('Question '+(i+1)+' of 3'));
    await host.locator('#questions [data-answer="'+choice+'"]').click();
  }
}
async function defenseState(frame) {
  return frame.evaluate(()=>({status:__grandLine.battle.status,round:__grandLine.battle.round,ship:__grandLine.battle.ship.hp,
    time:__grandLine.battle.stats.simulatedSeconds,spawned:__grandLine.battle.spawned,
    allies:__grandLine.battle.allies.map(a=>({id:a.id,hp:a.hp,energy:a.energy})),
    enemies:__grandLine.battle.enemies.map(e=>({id:e.id,x:e.x,y:e.y,hp:e.hp}))}));
}
async function selectCell(frame,id) {
  if(!await frame.locator('#keyboard-placement').evaluate(element=>element.open))await frame.locator('#keyboard-placement summary').click();
  const [,column,row]=id.split('-');
  await frame.locator('#grid-column').selectOption({value:column});
  await frame.locator('#grid-row').selectOption({value:row});
  assert.equal(await frame.locator('#selected-cell').textContent(),String.fromCharCode(65+Number(column))+(Number(row)+1),'Coordinate selectors choose the exact requested cell');
}

async function cellPoint(frame,id,{reveal=true}={}) {
  if(reveal)await frame.locator('#map-viewport').scrollIntoViewIfNeeded();
  const position=await frame.locator('#map-viewport').evaluate((viewport,id)=>{
    const pad=__grandLine.DEFENSE_PADS.find(p=>p.id===id);if(!pad)throw Error('Unknown test cell '+id);
    const canvas=viewport.querySelector('canvas'),scale=Math.min(canvas.clientWidth/1120,canvas.clientHeight/630);
    const x=(canvas.clientWidth-1120*scale)/2+pad.x*scale,y=(canvas.clientHeight-630*scale)/2+pad.y*scale;
    if(x<viewport.scrollLeft+10||x>viewport.scrollLeft+viewport.clientWidth-10)viewport.scrollLeft=x-viewport.clientWidth/2;
    if(y<viewport.scrollTop+10||y>viewport.scrollTop+viewport.clientHeight-10)viewport.scrollTop=y-viewport.clientHeight/2;
    return {x,y};
  },id);
  const box=await frame.locator('#battle-canvas').boundingBox();
  return {x:box.x+position.x,y:box.y+position.y};
}
async function clickCell(page,frame,id) { const point=await cellPoint(frame,id);await page.mouse.click(point.x,point.y); }
async function placementState(frame) {
  return frame.evaluate(()=>({supplies:__grandLine.battle.supplies,revision:__grandLine.battle.routeRevision,
    route:[...__grandLine.battle.routeCellIds],towers:__grandLine.battle.mazeTowers.map(t=>({id:t.id,cellId:t.cellId})),
    allies:__grandLine.battle.allies.map(a=>({id:a.id,padId:a.padId}))}));
}
async function pointerDrag(page,from,to,{release=true}={}) {
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(to.x,to.y,{steps:8});if(release)await page.mouse.up();
}
async function center(locator) { const r=await locator.boundingBox();assert.ok(r,'Pointer source is visible');return {x:r.x+r.width/2,y:r.y+r.height/2}; }
async function openAbilities(frame) { if(!await frame.locator('#defender-abilities').evaluate(element=>element.open))await frame.locator('#defender-abilities summary').click(); }

// APEX_HOVER_REGRESSION_START
// Focused regression for the featured fan: the interactive button itself must
// stay still when a pointer enters an exposed side or its lower edge.
async function checkApexHover(page) {
  const selector=id=>`#apex-showcase [data-character="${id}"]`;
  const waitFrames=count=>page.evaluate(count=>new Promise(resolve=>{function tick(){if(--count<=0)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);}),count);
  const rect=async locator=>locator.evaluate(element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
  const stable=(samples,before,label)=>{
    assert.ok(samples.length>=20);
    for(const sample of samples)for(const key of ['x','y','width','height'])assert.ok(Math.abs(sample.rect[key]-before[key])<.1,label+' keeps its '+key+' unchanged');
  };
  for(const id of ['bigmom7','garp7','sabo7'])for(const edge of ['side','bottom']){
    await page.mouse.move(1,1);await page.locator(selector(id)).scrollIntoViewIfNeeded();await waitFrames(15);
    const target=page.locator(selector(id)),before=await rect(target);
    const point=await target.evaluate((element,edge)=>{
      const box=element.getBoundingClientRect(),points=[];
      for(let y=Math.ceil(box.top)+1;y<Math.floor(box.bottom);y+=2)for(let x=Math.ceil(box.left)+1;x<Math.floor(box.right);x+=2)
        if(document.elementFromPoint(x,y)?.closest('.tcg-card')===element)points.push({x,y});
      if(!points.length)return null;
      if(edge==='bottom')return points.sort((a,b)=>b.y-a.y||Math.abs(a.x-(box.left+box.width/2))-Math.abs(b.x-(box.left+box.width/2)))[0];
      return points.sort((a,b)=>a.x-b.x||Math.abs(a.y-(box.top+box.height/2))-Math.abs(b.y-(box.top+box.height/2)))[0];
    },edge);
    assert.ok(point,id+' has an exposed '+edge+' pointer target');
    await page.mouse.move(point.x,point.y);
    const samples=await target.evaluate(async(element,point)=>{
      const samples=[];for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);const r=element.getBoundingClientRect();samples.push({rect:{x:r.x,y:r.y,width:r.width,height:r.height},hover:element.matches(':hover'),hit:document.elementFromPoint(point.x,point.y)?.closest('.tcg-card')===element});}return samples;
    },point);
    stable(samples,before,id+' '+edge+' hover');assert.ok(samples.every(sample=>sample.hover&&sample.hit),id+' keeps the stationary '+edge+' pointer for every frame');
    await page.mouse.click(point.x,point.y);
    await page.locator('#dialog-panel .tcg-card').waitFor();assert.equal(await page.locator('#dialog-panel .tcg-card').getAttribute('data-character'),id);
    await page.keyboard.press('Escape');
  }
  await page.mouse.move(1,1);await page.keyboard.press('Tab');
  for(const id of ['bigmom7','garp7','sabo7']){
    const target=page.locator(selector(id));await target.scrollIntoViewIfNeeded();const before=await rect(target);await target.focus();
    const samples=await target.evaluate(async element=>{
      const samples=[];for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);const r=element.getBoundingClientRect(),css=getComputedStyle(element);samples.push({rect:{x:r.x,y:r.y,width:r.width,height:r.height},focused:document.activeElement===element,visible:element.matches(':focus-visible'),outlined:css.outlineStyle!=='none'&&parseFloat(css.outlineWidth)>0});}return samples;
    });
    stable(samples,before,id+' keyboard focus');assert.ok(samples.every(sample=>sample.focused&&sample.visible&&sample.outlined),id+' keeps visible keyboard focus');
    await page.keyboard.press('Enter');await page.locator('#dialog-panel .tcg-card').waitFor();assert.equal(await page.locator('#dialog-panel .tcg-card').getAttribute('data-character'),id);await page.keyboard.press('Escape');
  }
}
// APEX_HOVER_REGRESSION_END

async function harnessGame(host, role = 'student', legacy = false) {
  await host.goto(base + '/__harness.html?role=' + role + (legacy ? '&legacy=1' : ''));
  await host.waitForFunction(() => document.querySelector('#game')?.contentWindow.__grandLine?.ready);
  const frame = host.frames().find(f => f.url().includes('grand-line.html'));
  await frame.evaluate(() => { __grandLine.settings.muted = true; });
  return frame;
}

async function checkMazeBuilder() {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});observe(page);await standalone(page);
  await page.locator('[data-view="campaign"]').click();await page.locator('#campaign-map button').first().click();
  await page.evaluate(async()=>{window.mazeTools=await import('./grand-line-defense.js');});
  const original=await page.evaluate(()=>({route:__grandLine.battle.route,revision:__grandLine.battle.routeRevision,supplies:__grandLine.battle.supplies,
    crewCell:__grandLine.battle.allies[0].padId,terrain:__grandLine.battle.terrain[0]}));
  await page.locator('#build-toggle').click();
  for(const cell of [original.crewCell,original.terrain,'cell-0-6','cell-25-6']) {
    await selectCell(page,cell);assert.equal(await page.locator('#cell-apply').isDisabled(),true,'Crew, terrain, entry and exit cannot accept a basic tower');
    assert.equal(await page.evaluate(()=>__grandLine.applyCellAction()),false);
  }
  await selectCell(page,'cell-12-6');
  const preview=await page.evaluate(()=>mazeTools.getMazePlacementPreview(__grandLine.battle,'cell-12-6',{kind:'tower'}));
  assert.equal(preview.valid,true);assert.notDeepEqual(preview.route,original.route);
  assert.deepEqual(await page.evaluate(()=>__grandLine.battle.route),original.route,'Selecting a proposed obstacle never commits a route or spends supplies');
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),100);
  await screenshot(page,'maze-route-preview');await page.locator('#cell-apply').click();
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),95);
  assert.deepEqual(await page.evaluate(()=>__grandLine.battle.route),preview.route);
  assert.ok(await page.evaluate(revision=>__grandLine.battle.routeRevision>revision,original.revision));
  assert.equal(await page.locator('#cell-apply').isDisabled(),true,'The occupied tower cell cannot be built twice');
  await clickCell(page,page,'cell-12-6');await page.locator('#tower-selection').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),95,'Sale selection is only a preview');
  await page.locator('#sell-selected-tower').click();
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),98);
  assert.deepEqual(await page.evaluate(()=>__grandLine.battle.route),original.route);
  assert.equal(await page.locator('#tower-selection').isHidden(),true,'A sold tower no longer exposes a refund action');
  check('Keyboard placement previews a rerouted maze before confirmation, charges five supplies once, and contextual sale restores the route for a bounded three-supply refund');

  await page.locator('#build-toggle').click();
  for(let row=0;row<13;row++)if(row!==6){await selectCell(page,`cell-1-${row}`);await page.locator('#cell-apply').click();}
  const passage=await page.evaluate(()=>({route:__grandLine.battle.route,revision:__grandLine.battle.routeRevision,supplies:__grandLine.battle.supplies,towers:__grandLine.battle.mazeTowers.length}));
  assert.equal(passage.towers,12);assert.equal(passage.supplies,38);
  assert.ok(await page.evaluate(()=>__grandLine.battle.routeCellIds.includes('cell-1-6')),'The wall funnels every enemy through its one-cell gap');
  await selectCell(page,'cell-1-6');assert.equal(await page.locator('#cell-apply').isDisabled(),true);
  assert.match(await page.locator('#cell-feedback').textContent(),/route.*exit/i);
  assert.equal(await page.evaluate(()=>__grandLine.applyCellAction()),false);
  assert.deepEqual(await page.evaluate(()=>({route:__grandLine.battle.route,revision:__grandLine.battle.routeRevision,supplies:__grandLine.battle.supplies,towers:__grandLine.battle.mazeTowers.length})),passage);
  await screenshot(page,'maze-chokepoint-blocked');
  await page.locator('#start-wave').click();
  assert.equal(await page.locator('#build-toggle').isDisabled(),true);
  const unchanged=await page.evaluate(()=>({route:__grandLine.battle.route,revision:__grandLine.battle.routeRevision,supplies:__grandLine.battle.supplies}));
  assert.equal(await page.evaluate(()=>__grandLine.applyCellAction()),false);
  assert.deepEqual(await page.evaluate(()=>({route:__grandLine.battle.route,revision:__grandLine.battle.routeRevision,supplies:__grandLine.battle.supplies})),unchanged);
  await page.waitForFunction(()=>__grandLine.battle.spawned>0);await page.locator('#defense-pause').click();
  const moving=await page.evaluate(()=>__grandLine.battle.enemies.map(e=>({x:e.x,y:e.y})));
  assert.ok(moving.length>0&&moving.every(e=>Number.isFinite(e.x)&&Number.isFinite(e.y)));
  await page.close();
  check('A player-built chokepoint keeps its final passage open; sealing the maze or editing during a wave is rejected without a charge or route change');
}

async function checkSevenCrew() {
  const host=await browser.newPage({viewport:{width:1440,height:1000}});observe(host);const game=await harnessGame(host,'admin');
  await game.locator('[data-view="packs"]').click();await game.locator('#admin-unlock-all').click();
  await game.waitForFunction(()=>!__grandLine.adminPending&&Object.keys(__grandLine.collection.cards).length===100);
  await game.locator('[data-view="crew"]').click();
  const additions=await game.evaluate(()=>__grandLine.CHARACTERS.map(c=>c.id).filter(id=>!__grandLine.collection.team.includes(id)).slice(0,2));
  const before=await game.evaluate(()=>[...__grandLine.collection.team]);
  await host.evaluate(()=>{fake.blockSave=true;});
  await game.evaluate(id=>__grandLine.changeTeam(5,id),additions[0]);
  assert.deepEqual(await game.evaluate(()=>__grandLine.collection.team),before,'Rejected crew persistence rolls back the optimistic sixth member');
  assert.deepEqual(await host.evaluate(()=>fake.state.grandLine.profiles['test-profile'].collection.team),before);
  await host.evaluate(()=>{fake.blockSave=false;});
  for(let i=0;i<additions.length;i++){
    await game.locator('#crew-slots .empty-crew-slot button').first().click();
    await game.locator(`#crew-picker [data-character="${additions[i]}"]`).click();
    await host.waitForFunction(count=>fake.state.grandLine.profiles['test-profile'].collection.team.length===count,6+i);
    await game.locator('#toast').filter({hasText:'is ready to defend.'}).waitFor({state:'visible'});
  }
  const seven=await game.evaluate(()=>[...__grandLine.collection.team]);assert.equal(seven.length,7);assert.equal(new Set(seven).size,7);
  assert.equal(await game.locator('#crew-slots .empty-crew-slot').count(),0);
  await game.evaluate(async()=>{await __grandLine.changeTeam(0,'not-owned');await __grandLine.changeTeam(0,__grandLine.collection.team[1]);await __grandLine.changeTeam(7,'kaido');});
  assert.deepEqual(await game.evaluate(()=>__grandLine.collection.team),seven);
  await Promise.all([game.waitForNavigation(),game.evaluate(()=>location.reload())]);
  await game.waitForFunction(()=>__grandLine?.ready);assert.deepEqual(await game.evaluate(()=>__grandLine.collection.team),seven);
  await game.locator('[data-view="campaign"]').click();await game.locator('#campaign-map button').first().click();
  const deployed=await game.evaluate(()=>({ids:__grandLine.battle.allies.map(a=>a.characterId),pads:__grandLine.battle.allies.map(a=>a.padId),paid:__grandLine.battle.allies.map(a=>a.paidSupplies),supplies:__grandLine.battle.supplies}));
  assert.deepEqual(deployed.ids,seven);assert.equal(new Set(deployed.pads).size,7);assert.deepEqual(deployed.paid,Array(7).fill(0));assert.equal(deployed.supplies,100);
  await screenshot(host,'desktop-seven-crew-maze');await host.close();
  check('Seven distinct owned crew members save through the parent and reload into seven free defenders; failed saves, duplicate slots, unowned cards and an eighth slot are rejected');
}

async function checkDirectPlacement() {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});observe(page);await standalone(page);
  await page.locator('[data-view="campaign"]').click();await page.locator('#campaign-map button').first().click();
  assert.equal(await page.locator('#keyboard-placement').evaluate(element=>element.open),false,'Precise keyboard placement is available without crowding the default view');
  assert.equal(await page.locator('#move-toggle,#sell-toggle').count(),0);
  await page.locator('#build-toggle').click();await clickCell(page,page,'cell-12-6');
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),95);
  await clickCell(page,page,'cell-13-6');
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),90,'The tower palette remains armed for repeated placements, with one charge per click');
  await clickCell(page,page,'cell-13-6');await page.locator('#tower-selection').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),90,'Selecting an existing tower cannot buy it again');
  await page.locator('#sell-selected-tower').click();assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),93);

  const drop=await cellPoint(page,'cell-14-6'),tile=await center(page.locator('#build-toggle')),beforeDrag=await placementState(page);
  await pointerDrag(page,tile,drop,{release:false});await frames(page,3);
  assert.deepEqual(await placementState(page),beforeDrag,'Dragging previews the tower without changing supplies or the route');
  await page.mouse.up();await frames(page,3);
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),88,'Pointer-up and its compatibility click cause exactly one five-supply placement');
  assert.equal(await page.evaluate(()=>__grandLine.battle.mazeTowers.filter(t=>t.cellId==='cell-14-6').length),1);
  const crew=await page.evaluate(()=>__grandLine.battle.allies.slice(0,2).map(a=>({id:a.id,padId:a.padId})));
  let target=await cellPoint(page,'cell-4-9'),source=await center(page.locator('#defender-buttons [data-ally="'+crew[0].id+'"]'));
  const beforeCrew=await placementState(page);await pointerDrag(page,source,target,{release:false});assert.deepEqual(await placementState(page),beforeCrew);
  await page.mouse.up();assert.equal(await page.evaluate(id=>__grandLine.battle.allies.find(a=>a.id===id).padId,crew[0].id),'cell-4-9');
  source=await cellPoint(page,'cell-4-9');target=await cellPoint(page,'cell-10-3');
  source.y-=35*(await page.locator('#battle-canvas').boundingBox()).width/1120;
  assert.notEqual(await page.evaluate(p=>__grandLine.renderer.pickPad(p.x,p.y),source),'cell-4-9','The drag begins on the upper avatar body, above its grid cell');
  const beforeCanvas=await placementState(page);await pointerDrag(page,source,target,{release:false});assert.deepEqual(await placementState(page),beforeCanvas);
  await page.mouse.up();assert.equal(await page.evaluate(id=>__grandLine.battle.allies.find(a=>a.id===id).padId,crew[0].id),'cell-10-3');
  await clickCell(page,page,crew[1].padId);await clickCell(page,page,'cell-16-9');
  assert.equal(await page.evaluate(id=>__grandLine.battle.allies.find(a=>a.id===id).padId,crew[1].id),'cell-16-9');
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),88,'Moving deployed crew from a thumbnail or the map is free');
  check('Mouse clicks place repeated towers once, contextual sales refund once, and palette or canvas crew drags commit only on release');

  await page.locator('#build-toggle').click();await page.locator('#placement-cancel').click();
  const cancelled=await placementState(page);await clickCell(page,page,'cell-15-6');assert.deepEqual(await placementState(page),cancelled);
  for(const reason of ['outside','escape','blur','cancel']) {
    target=await cellPoint(page,'cell-15-6');source=await center(page.locator('#build-toggle'));
    const before=await placementState(page);await pointerDrag(page,source,target,{release:false});
    if(reason==='outside')await page.mouse.move(1,1,{steps:4});
    if(reason==='escape')await page.keyboard.press('Escape');
    if(reason==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    if(reason==='cancel')await page.locator('#placement-palette').dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',isPrimary:true,bubbles:true});
    await page.mouse.up();await frames(page,2);assert.deepEqual(await placementState(page),before,reason+' cancels the drag without a charge or move');
  }
  for(const id of ['cell-0-6','cell-25-6','cell-5-1']) {
    await page.locator('#build-toggle').click();const before=await placementState(page);await clickCell(page,page,id);assert.deepEqual(await placementState(page),before,'Blocked cells never debit supplies');
  }
  // Use real keyboard activation after pointer cancellation: focus remains on
  // the canvas while arrow navigation previews and Enter commits exactly once.
  await page.locator('#build-toggle').click();await selectCell(page,'cell-20-8');
  await page.locator('#battle-canvas').focus();const beforeKeyboard=await placementState(page);
  await page.keyboard.press('ArrowRight');assert.deepEqual(await placementState(page),beforeKeyboard);
  assert.equal(await page.locator('#selected-cell').textContent(),'V9');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#cell-apply').isDisabled(),true);
  await page.keyboard.press('Enter');assert.deepEqual(await placementState(page),beforeKeyboard,'Enter after Escape cannot apply the cancelled keyboard placement');
  assert.equal(await page.evaluate(()=>__grandLine.applyCellAction()),false);
  await page.locator('#build-toggle').click();await page.locator('#battle-canvas').focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'battle-canvas');
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),beforeKeyboard.supplies-5);
  check('Outside drops, Escape, focus loss, cancelled pointers and blocked cells leave the maze untouched; keyboard placement retains focus and charges once');

  await page.locator('#defender-buttons [data-ally="'+crew[0].id+'"]').click();await openAbilities(page);
  const recalled=await page.evaluate(id=>__grandLine.battle.allies.find(a=>a.id===id).characterId,crew[0].id);await page.locator('#recall-defender').click();
  await page.locator('#summon-toggle').click();await page.locator('#summon-search').fill(recalled);
  // Scroll the whole adjacent map/palette region into view before recording
  // the pointer coordinates. The held card remains valid through re-renders.
  await page.locator('#keyboard-placement summary').click();
  await page.locator('#summon-roster [data-summon="'+recalled+'"]').scrollIntoViewIfNeeded();
  target=await cellPoint(page,'cell-23-5',{reveal:false});source=await center(page.locator('#summon-roster [data-summon="'+recalled+'"]'));
  const beforeSummon=await placementState(page);await pointerDrag(page,source,target,{release:false});assert.deepEqual(await placementState(page),beforeSummon);
  await page.mouse.up();await frames(page,3);
  const summoned=await page.evaluate(id=>__grandLine.battle.allies.find(a=>a.characterId===id),recalled);
  assert.ok(summoned);assert.equal(summoned.padId,'cell-23-5');assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),beforeSummon.supplies-summoned.summonCost);
  assert.equal(await page.evaluate(id=>__grandLine.battle.allies.filter(a=>a.characterId===id).length,recalled),1);
  await page.locator('#start-wave').click();await page.locator('#defense-pause').click();
  const running=await placementState(page);source=await cellPoint(page,'cell-23-5');target=await cellPoint(page,'cell-20-3');
  await pointerDrag(page,source,target);assert.deepEqual(await placementState(page),running,'Paused combat still forbids moving deployed defenders');
  await clearWave(page);const learning=await placementState(page);
  await page.locator('#battle-canvas').dispatchEvent('pointerdown',{pointerId:99,pointerType:'mouse',clientX:target.x,clientY:target.y,button:0,buttons:1,bubbles:true});
  await page.locator('#battle-canvas').dispatchEvent('pointerup',{pointerId:99,pointerType:'mouse',clientX:target.x,clientY:target.y,button:0,buttons:0,bubbles:true});
  assert.deepEqual(await placementState(page),learning,'The learning gate cannot be edited by forwarded canvas events');
  await page.close();check('An owned reserve card drags into battle with one charge; running and three-question gates reject map edits');
}

async function checkTouchPlacement() {
  const page=await browser.newPage({viewport:{width:390,height:1000},isMobile:true,hasTouch:true});observe(page);await standalone(page);
  await page.locator('[data-view="campaign"]').tap();await page.locator('#campaign-map button').first().tap();
  const cdp=await page.context().newCDPSession(page);
  const point=(p,id=1)=>({x:p.x,y:p.y,id,radiusX:2,radiusY:2,force:1});
  const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  const move=async(from,to)=>{for(let i=1;i<=8;i++)await touch('touchMove',[point({x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8})]);};
  let target=await cellPoint(page,'cell-12-6'),source=await center(page.locator('#build-toggle'));
  const before=await placementState(page);await touch('touchStart',[point(source)]);await move(source,target);await frames(page,2);
  assert.deepEqual(await placementState(page),before,'A real touch drag previews without spending');
  await touch('touchEnd',[]);await frames(page,3);assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),95);
  assert.equal(await page.evaluate(()=>__grandLine.battle.mazeTowers.filter(t=>t.cellId==='cell-12-6').length),1,'A touch drop and synthetic click never duplicate the tower');
  source=await cellPoint(page,'cell-2-5');target=await cellPoint(page,'cell-4-9');source.y-=35*(await page.locator('#battle-canvas').boundingBox()).width/1120;
  const beforeCrew=await placementState(page);await touch('touchStart',[point(source)]);await move(source,target);assert.deepEqual(await placementState(page),beforeCrew);
  await touch('touchEnd',[]);assert.equal(await page.evaluate(()=>__grandLine.battle.allies[0].padId),'cell-4-9','Touch can drag the visible upper avatar body, not only its cell anchor');
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),95);
  for(const mode of ['cancel','second-pointer']) {
    target=await cellPoint(page,'cell-14-6');source=await center(page.locator('#build-toggle'));
    const unchanged=await placementState(page);await touch('touchStart',[point(source)]);await move(source,target);
    if(mode==='cancel')await touch('touchCancel',[]);
    else {await touch('touchStart',[point(target),point({x:target.x+25,y:target.y+20},2)]);await touch('touchEnd',[]);}
    await frames(page,3);assert.deepEqual(await placementState(page),unchanged,mode+' aborts the placement without committing either pointer');
  }
  if(await page.locator('#placement-cancel').isVisible())await page.locator('#placement-cancel').tap();
  await page.locator('#map-zoom').tap();
  target=await cellPoint(page,'cell-10-8');await page.locator('#map-viewport').evaluate(e=>{e.scrollLeft=0;});target=await cellPoint(page,'cell-10-8');
  const beforePan=await placementState(page),scrollBefore=await page.locator('#map-viewport').evaluate(e=>e.scrollLeft);
  source=target;target={x:source.x-70,y:source.y};await touch('touchStart',[point(source)]);await move(source,target);await touch('touchEnd',[]);
  assert.ok(await page.locator('#map-viewport').evaluate((e,before)=>e.scrollLeft>before+30,scrollBefore),'Dragging an empty zoomed map pans instead of placing');
  assert.deepEqual(await placementState(page),beforePan);await noOverflow(page);
  await page.locator('#build-toggle').tap();target=await cellPoint(page,'cell-19-8');
  await touch('touchStart',[point(target)]);await touch('touchEnd',[]);await frames(page,3);
  assert.equal(await page.evaluate(()=>__grandLine.battle.mazeTowers.some(t=>t.cellId==='cell-19-8')),true,'An armed tap on the panned, zoomed map uses the transformed cell coordinates');
  assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),90);
  await screenshot(page,'phone-direct-placement-zoom');await cdp.detach();await page.close();
  check('Real touch drags charge once, cancellation and multiple fingers abort safely, and zoomed empty-map panning preserves placement coordinates');
}

async function checkAdministratorShop() {
  const student = await browser.newPage({ viewport: { width: 1100, height: 850 } }); observe(student);
  const learner = await harnessGame(student);
  await learner.locator('[data-view="packs"]').click();
  assert.equal(await learner.locator('#admin-tools').isHidden(), true);
  assert.deepEqual(await learner.evaluate(() => __grandLine.admin), { available: false, unlimitedGold: false });
  const studentBefore = await student.evaluate(() => JSON.stringify(fake.state));
  const dispatched = await student.evaluate(() => fake.requests.filter(d => d.type === 'GLTCG_ADMIN_REQUEST').length);
  await learner.evaluate(() => __grandLine.requestAdminAction('unlock-all'));
  await frames(student, 3);
  assert.equal(await student.evaluate(() => fake.requests.filter(d => d.type === 'GLTCG_ADMIN_REQUEST').length), dispatched);
  // A compromised child can alter its own display but cannot supply parent authority.
  await learner.evaluate(() => {
    __grandLine.applySnapshot({ admin: { available: true, unlimitedGold: true }, wallet: { ...__grandLine.wallet, unlimitedGold: true } });
    parent.postMessage({ type: 'GLTCG_ADMIN_REQUEST', requestId: 'forged-unlock', sessionId: __grandLine.sessionId, action: 'unlock-all' }, location.origin);
    parent.postMessage({ type: 'GLTCG_ADMIN_REQUEST', requestId: 'forged-unlimited', sessionId: __grandLine.sessionId, action: 'set-unlimited-gold', enabled: true, admin: true }, location.origin);
  });
  await student.waitForFunction(() => fake.requests.some(d => d.requestId === 'forged-unlimited'));
  await frames(student, 3);
  assert.equal(await student.evaluate(() => JSON.stringify(fake.state)), studentBefore);
  assert.equal(await student.evaluate(() => fake.adminCalls.length), 0);
  await learner.locator('[data-pack="spark"]').click();
  await learner.locator('#open-pack').click();
  await learner.waitForFunction(() => __grandLine.dialog === 'reveal');
  assert.equal(await student.evaluate(() => fake.state.gold), 4880, 'Forged free-purchase display still pays the host wallet rate');
  assert.equal(await learner.evaluate(() => __grandLine.wallet.unlimitedGold), false);
  await student.close();
  check('Student controls stay hidden and forged administrator availability cannot authorize parent actions');

  const host = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); observe(host);
  let game = await harnessGame(host, 'admin');
  await game.locator('[data-view="packs"]').click();
  await game.locator('#admin-tools').waitFor({ state: 'visible' });
  assert.deepEqual(await game.evaluate(() => __grandLine.admin), { available: true, unlimitedGold: false });
  assert.equal(await game.evaluate(() => __grandLine.wallet.balance), 0);
  assert.equal(await game.locator('#open-pack').isDisabled(), true);

  await host.evaluate(() => { fake.holdAdmin = true; });
  await game.locator('#admin-unlimited').click();
  await game.waitForFunction(() => !!__grandLine.adminPending);
  assert.equal(await game.evaluate(() => __grandLine.admin.unlimitedGold), false, 'Unlimited gold waits for the real parent confirmation');
  assert.equal(await game.locator('#open-pack').isDisabled(), true);
  assert.equal(await game.locator('#admin-unlock-all').isDisabled(), true);
  await game.evaluate(() => __grandLine.beginBattle(1));
  assert.equal(await game.evaluate(() => __grandLine.battle), null, 'A pending admin save prevents starting a defense');
  await host.waitForFunction(() => typeof fake.releaseAdmin === 'function');
  await host.evaluate(() => fake.releaseAdmin());
  await game.waitForFunction(() => !__grandLine.adminPending && __grandLine.admin.unlimitedGold);
  assert.equal(await game.evaluate(() => __grandLine.wallet.unlimitedGold), true);
  assert.equal(await host.evaluate(() => fake.state.gold), 0);
  assert.equal(await game.locator('#open-pack').isEnabled(), true);
  check('Admin gold starts disabled and only unlocks purchases after an acknowledged save; pending actions lock purchases and defense');

  for (const tier of ['spark', 'nova', 'galaxy']) {
    const before = await game.evaluate(() => Object.values(__grandLine.collection.cards).reduce((sum, c) => sum + c.copies, 0));
    await game.locator(`[data-pack="${tier}"]`).click();
    assert.equal(await game.locator('#open-pack').isEnabled(), true);
    await game.locator('#open-pack').click();
    await game.waitForFunction(() => __grandLine.dialog === 'reveal');
    assert.equal(await game.locator('#dialog-panel .tcg-card').count(), 1);
    assert.equal(await game.evaluate(() => Object.values(__grandLine.collection.cards).reduce((sum, c) => sum + c.copies, 0)), before + 1);
    assert.equal(await host.evaluate(() => fake.state.gold), 0);
    assert.equal(await game.evaluate(() => __grandLine.wallet.balance), 0);
    assert.equal(await host.evaluate(() => Number.isFinite(fake.state.gold)), true);
    await game.locator('#dialog-panel .dialog-close').click();
  }
  const freeReceipt = await host.evaluate(() => fake.requests.findLast(d => d.type === 'GLTCG_BUY_REQUEST'));
  const afterFreePurchase = await host.evaluate(() => JSON.stringify(fake.state));
  await game.evaluate(d => parent.postMessage(d, location.origin), freeReceipt); await frames(host, 3);
  assert.equal(await host.evaluate(() => JSON.stringify(fake.state)), afterFreePurchase);
  assert.equal(await game.evaluate(() => __grandLine.collection.stats.packsOpened), 3);
  check('All three administrator pack tiers work at zero gold with one normal card per purchase, finite wallet values and durable replay protection');

  const beforeUnlock = await game.evaluate(() => ({ cards: structuredClone(__grandLine.collection.cards), stats: structuredClone(__grandLine.collection.stats), team: [...__grandLine.collection.team] }));
  await host.evaluate(() => { fake.failAdminResponseOnce = true; });
  await game.locator('#admin-unlock-all').click();
  await game.waitForFunction(() => __grandLine.adminPending?.waiting === false);
  assert.deepEqual(await game.evaluate(() => __grandLine.collection.cards), beforeUnlock.cards, 'Failed responses do not optimistically grant the roster');
  assert.equal(await host.evaluate(() => Object.keys(fake.state.grandLine.profiles['test-profile'].collection.cards).length), 100);
  const commits = await host.evaluate(() => fake.commits);
  assert.equal(await game.locator('#open-pack').isDisabled(), true);
  await game.locator('#admin-retry').click();
  await game.waitForFunction(() => !__grandLine.adminPending && Object.keys(__grandLine.collection.cards).length === 100);
  assert.equal(await host.evaluate(() => fake.commits), commits, 'Retrying the acknowledged mutation has no second write');
  const unlocked = await game.evaluate(() => ({ cards: structuredClone(__grandLine.collection.cards), stats: structuredClone(__grandLine.collection.stats), team: [...__grandLine.collection.team], roster: __grandLine.CHARACTERS.map(c => c.id) }));
  assert.equal(Object.keys(unlocked.cards).length, 100);
  assert.deepEqual(Object.keys(unlocked.cards).sort(), unlocked.roster.sort());
  for (const [id, card] of Object.entries(unlocked.cards)) assert.equal(card.copies, beforeUnlock.cards[id]?.copies || 1, id + ' preserves existing copies or receives one copy');
  assert.equal(unlocked.cards.luffy.copies, 3);
  assert.deepEqual(unlocked.stats, beforeUnlock.stats); assert.deepEqual(unlocked.team, beforeUnlock.team);
  for (const id of ['shanks', 'blackbeard', 'bigmom', 'kizaru', 'sengoku', 'garp', 'mihawk', 'hancock', 'ace', 'sabo', 'law', 'king']) assert.equal(unlocked.cards[id], undefined);
  await screenshot(host, 'admin-shop-desktop');
  check('Unlock all grants only the 100 current cards, preserves duplicate ranks and crew, and safely retries an interrupted response');

  await game.locator('#admin-unlimited').click();
  await game.waitForFunction(() => !__grandLine.adminPending && !__grandLine.admin.unlimitedGold);
  assert.equal(await game.evaluate(() => __grandLine.wallet.unlimitedGold), false);
  assert.equal(await game.locator('#open-pack').isDisabled(), true);
  const noDebit = await host.evaluate(() => JSON.stringify(fake.state));
  await game.evaluate(() => document.querySelector('#open-pack').click()); await frames(host, 3);
  assert.equal(await host.evaluate(() => JSON.stringify(fake.state)), noDebit);
  await game.locator('#admin-unlimited').click();
  await game.waitForFunction(() => !__grandLine.adminPending && __grandLine.admin.unlimitedGold);
  await Promise.all([game.waitForNavigation(), game.evaluate(() => location.reload())]);
  game = host.frames().find(f => f.url().includes('grand-line.html'));
  await game.waitForFunction(() => __grandLine?.ready && __grandLine.admin.available);
  assert.equal(await game.evaluate(() => __grandLine.admin.unlimitedGold), true);
  assert.equal(await game.evaluate(() => __grandLine.wallet.balance), 0);
  assert.deepEqual(await game.evaluate(() => __grandLine.collection.cards), unlocked.cards);
  await game.locator('[data-view="packs"]').click();

  await host.evaluate(() => { fake.state.gold = 1000; fake.holdAdmin = true; });
  await game.evaluate(snapshot => {
    __grandLine.applySnapshot(snapshot);
    window.adminTestSetTimeout = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => window.adminTestSetTimeout(callback, delay === 15000 ? 50 : delay, ...args);
  }, await host.evaluate(() => fake.snapshot()));
  await game.locator('#admin-unlimited').click();
  await game.waitForFunction(() => __grandLine.adminPending?.waiting === false);
  assert.equal(await game.locator('#admin-retry').isVisible(), true);
  assert.equal(await game.locator('#open-pack').isDisabled(), true);
  assert.equal(await game.evaluate(() => __grandLine.admin.unlimitedGold), true);
  const timeoutRequests = await host.evaluate(() => fake.requests.filter(d => d.type === 'GLTCG_ADMIN_REQUEST').length);
  await game.evaluate(() => { window.setTimeout = window.adminTestSetTimeout; delete window.adminTestSetTimeout; });
  await host.waitForFunction(() => typeof fake.releaseAdmin === 'function');
  await host.evaluate(() => fake.releaseAdmin());
  await game.waitForFunction(() => !__grandLine.adminPending && !__grandLine.admin.unlimitedGold);
  assert.equal(await host.evaluate(() => fake.requests.filter(d => d.type === 'GLTCG_ADMIN_REQUEST').length), timeoutRequests);
  assert.equal(await host.evaluate(() => fake.state.gold), 1000);
  assert.match(await game.locator('#open-pack').textContent(), /points/);
  await game.locator('#admin-unlimited').click();
  await game.waitForFunction(() => !__grandLine.adminPending && __grandLine.admin.unlimitedGold);
  check('An admin timeout keeps purchases locked and accepts the late original confirmation without a duplicate request');

  // A failed disable reply is especially sensitive: the parent can already be
  // charging normal rates while the child still displays unlimited gold.
  await host.evaluate(() => { fake.state.gold = 1000; fake.failAdminResponseOnce = true; });
  await game.evaluate(snapshot => __grandLine.applySnapshot(snapshot), await host.evaluate(() => fake.snapshot()));
  await game.locator('#admin-unlimited').click();
  await game.waitForFunction(() => __grandLine.adminPending?.waiting === false);
  assert.equal(await host.evaluate(() => fake.state.grandLine.admin.unlimitedGold), false);
  assert.equal(await game.evaluate(() => __grandLine.admin.unlimitedGold), true, 'The child still has its last confirmed snapshot');
  assert.equal(await game.locator('#open-pack').isDisabled(), true, 'Uncertain admin state cannot silently turn a free-looking purchase into a debit');
  assert.equal(await game.locator('#admin-unlimited').isDisabled(), true);
  const pendingDisable = await game.evaluate(() => ({ action: __grandLine.adminPending.action, enabled: __grandLine.adminPending.enabled }));
  assert.deepEqual(pendingDisable, { action: 'set-unlimited-gold', enabled: false });
  await game.evaluate(() => { document.querySelector('#open-pack').click(); __grandLine.go('campaign'); __grandLine.beginBattle(1); });
  assert.equal(await game.locator('#packs-view').isVisible(), true);
  assert.equal(await game.evaluate(() => __grandLine.battle), null);
  assert.equal(await host.evaluate(() => fake.state.gold), 1000);
  await game.locator('#admin-retry').click();
  await game.waitForFunction(() => !__grandLine.adminPending && !__grandLine.admin.unlimitedGold);
  const disableCalls = await host.evaluate(() => fake.adminCalls.slice(-2).map(({ action, enabled }) => ({ action, enabled })));
  assert.deepEqual(disableCalls, [pendingDisable, pendingDisable], 'Retry repeats the exact intended toggle, rather than reversing it');
  assert.equal(await game.locator('#open-pack').isEnabled(), true);
  assert.match(await game.locator('#open-pack').textContent(), /points/);
  assert.equal(await host.evaluate(() => fake.state.gold), 1000);
  check('An uncertain unlimited-gold disable locks spending and navigation until the exact action is confirmed, then restores visible paid prices');
  await host.evaluate(() => { fake.state.gold = 0; });
  await game.evaluate(snapshot => __grandLine.applySnapshot(snapshot), await host.evaluate(() => fake.snapshot()));
  await game.locator('#admin-unlimited').click();
  await game.waitForFunction(() => !__grandLine.adminPending && __grandLine.admin.unlimitedGold);

  await host.setViewportSize({ width: 320, height: 740 }); await frames(host, 3);
  await noOverflow(host);
  assert.ok(await game.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Administrator card shop fits a 320px iframe');
  for (const selector of ['#admin-unlimited', '#admin-unlock-all']) {
    assert.equal(await game.locator(selector).isVisible(), true);
    assert.ok((await game.locator(selector).boundingBox()).height >= 40, 'Admin touch controls remain usable');
  }
  await game.locator('#admin-unlimited').click();
  await game.waitForFunction(() => !__grandLine.adminPending && !__grandLine.admin.unlimitedGold);
  assert.equal(await game.locator('#open-pack').isDisabled(), true);
  await game.locator('#admin-unlimited').click();
  await game.waitForFunction(() => !__grandLine.adminPending && __grandLine.admin.unlimitedGold);
  assert.equal(await game.locator('#open-pack').isEnabled(), true);
  await screenshot(host, 'admin-shop-small-phone');
  await game.locator('#open-pack').scrollIntoViewIfNeeded();
  await screenshot(host, 'admin-shop-small-phone-tiers');
  check('Admin controls disable and re-enable free packs, persist after iframe reload, and fit a 320px card shop');

  // Role changes retire both the visible controls and outstanding work.
  await host.evaluate(() => { fake.holdAdmin = true; });
  await game.locator('#admin-unlimited').click();
  await game.waitForFunction(() => !!__grandLine.adminPending);
  const beforeRoleChange = await host.evaluate(() => JSON.stringify(fake.state));
  await host.evaluate(() => { fake.role = 'student'; fake.invalidate(); fake.releaseAdmin(); });
  await game.waitForFunction(() => !__grandLine.ready && !__grandLine.adminPending);
  assert.equal(await game.locator('#admin-tools').isHidden(), true);
  assert.deepEqual(await game.evaluate(() => __grandLine.admin), { available: false, unlimitedGold: false });
  assert.equal(await game.evaluate(() => __grandLine.wallet.unlimitedGold), false);
  await frames(host, 3);
  assert.equal(await host.evaluate(() => JSON.stringify(fake.state)), beforeRoleChange);
  assert.equal(await game.evaluate(() => __grandLine.sessionId), '');
  await host.close();
  check('Role invalidation hides admin features, clears pending authority, and rejects a stale in-flight action');
}

async function checkMultiPackPurchases() {
  const host=await browser.newPage({viewport:{width:1440,height:1000}});observe(host);let game=await harnessGame(host);
  await game.locator('[data-view="packs"]').click();
  assert.deepEqual(await game.locator('#pack-quantities [data-quantity]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.quantity))),[1,5,10,50]);
  await game.locator('[data-pack="spark"]').click();await game.locator('[data-quantity="5"]').click();
  assert.match(await game.locator('#pack-total').textContent(),/5 packs.*5 cards.*600/);
  assert.match(await game.locator('#open-pack').textContent(),/5.*600/);
  const before=await host.evaluate(()=>({gold:fake.state.gold,commits:fake.commits,collection:structuredClone(fake.state.grandLine.profiles['test-profile'].collection)}));
  await game.locator('#open-pack').click();await game.waitForFunction(()=>__grandLine.dialog==='reveal');
  const first=await host.evaluate(()=>{const request=fake.requests.findLast(d=>d.type==='GLTCG_BUY_REQUEST');return {request,receipt:fake.state.grandLine.profiles['test-profile'].purchases[request.purchaseId],gold:fake.state.gold,commits:fake.commits};});
  assert.equal(first.request.quantity,5);assert.equal(first.receipt.quantity,5);assert.equal(first.receipt.cost,600);
  assert.equal(first.gold,before.gold-600);assert.equal(first.commits,before.commits+1,'All five grants and the total debit share one persistence operation');
  assert.equal(first.receipt.grants.length,5);assert.equal(first.receipt.grant,undefined);
  assert.deepEqual(await game.locator('.batch-reveal-item').evaluateAll(nodes=>nodes.map(n=>n.dataset.character)),first.receipt.grants.map(g=>g.characterId));
  assert.equal(await game.locator('.batch-reveal-content .tcg-card').count(),5);assert.equal(await game.locator('.reveal-content').count(),0);
  const after=await game.evaluate(()=>structuredClone(__grandLine.collection)),counts={};for(const grant of first.receipt.grants)counts[grant.characterId]=(counts[grant.characterId]||0)+1;
  for(const [id,count]of Object.entries(counts))assert.equal(after.cards[id].copies,(before.collection.cards[id]?.copies||0)+count);
  assert.ok(first.receipt.grants.filter(g=>g.duplicate).length>=4,'Repeated draws merge inside the same batch');
  assert.equal(after.stats.packsOpened,before.collection.stats.packsOpened+5);
  await screenshot(host,'batch-five-reveal');await game.getByRole('button',{name:'Back to card shop',exact:true}).click();
  check('Five-pack purchases debit the exact total once, persist all grants atomically, merge repeated cards and reveal every receipt item');

  await game.locator('[data-pack="galaxy"]').click();await game.locator('[data-quantity="10"]').click();
  assert.match(await game.locator('#pack-total').textContent(),/7,500/);assert.equal(await game.locator('#open-pack').isDisabled(),true);
  const unchanged=await host.evaluate(()=>JSON.stringify(fake.state)),requestCount=await host.evaluate(()=>fake.requests.length);
  await game.locator('#open-pack').dispatchEvent('click');await frames(host,2);
  assert.equal(await host.evaluate(()=>fake.requests.length),requestCount,'Insufficient total disables the purchase before it reaches the host');
  await game.evaluate(()=>{
    window.batchRejection=null;window.addEventListener('message',event=>{if(event.source===parent&&event.data.purchaseId==='insufficient-batch')window.batchRejection=event.data;});
    parent.postMessage({type:'GLTCG_BUY_REQUEST',sessionId:__grandLine.sessionId,requestId:'insufficient-request',purchaseId:'insufficient-batch',packId:'galaxy',quantity:10},location.origin);
  });
  await game.waitForFunction(()=>window.batchRejection?.type==='GLTCG_BUY_BLOCKED');
  assert.equal(await game.evaluate(()=>batchRejection.confirmedNoCharge),true);assert.equal(await host.evaluate(()=>JSON.stringify(fake.state)),unchanged);
  check('An unaffordable batch is disabled at its full price and the parent independently rejects it without a debit or partial grants');

  await game.locator('[data-pack="nova"]').click();await game.locator('[data-quantity="5"]').click();await host.evaluate(()=>{fake.failPurchaseResponseOnce=true;});
  await game.locator('#open-pack').click();await game.waitForFunction(()=>__grandLine.purchasePending&&!__grandLine.purchasePending.waiting&&__grandLine.dialog==='purchase');
  const pending=await game.evaluate(()=>({purchaseId:__grandLine.purchasePending.purchaseId,packId:__grandLine.purchasePending.packId,quantity:__grandLine.purchasePending.quantity}));
  assert.equal(pending.quantity,5);assert.equal(pending.packId,'nova');
  const committed=await host.evaluate(()=>({state:JSON.stringify(fake.state),commits:fake.commits}));
  assert.equal(await game.locator('[data-quantity="50"]').isDisabled(),true);assert.equal(await game.locator('[data-pack="galaxy"]').isDisabled(),true);
  await Promise.all([game.waitForNavigation(),game.evaluate(()=>location.reload())]);await game.waitForFunction(()=>__grandLine?.ready);await game.evaluate(()=>{__grandLine.settings.muted=true;});
  assert.deepEqual(await game.evaluate(()=>({purchaseId:__grandLine.purchasePending.purchaseId,packId:__grandLine.purchasePending.packId,quantity:__grandLine.purchasePending.quantity})),pending);
  await game.locator('[data-view="packs"]').click();assert.equal(await game.locator('[data-quantity="5"]').getAttribute('aria-pressed'),'true');
  await game.locator('#open-pack').click();await game.getByRole('button',{name:'Resume this purchase',exact:true}).click();await game.waitForFunction(()=>__grandLine.dialog==='reveal');
  const resumed=await host.evaluate(()=>fake.requests.findLast(d=>d.type==='GLTCG_BUY_REQUEST'));
  assert.equal(resumed.purchaseId,pending.purchaseId);assert.equal(resumed.packId,pending.packId);assert.equal(resumed.quantity,5);
  assert.deepEqual(await host.evaluate(()=>({state:JSON.stringify(fake.state),commits:fake.commits})),committed,'Resuming an acknowledged batch cannot charge or grant again');
  assert.equal(await game.locator('.batch-reveal-item').count(),5);assert.equal(await game.evaluate(()=>__grandLine.purchasePending),null);
  const savedGrantIds=await host.evaluate(id=>fake.state.grandLine.profiles['test-profile'].purchases[id].grants.map(g=>g.characterId),pending.purchaseId);
  assert.deepEqual(await game.locator('.batch-reveal-item').evaluateAll(nodes=>nodes.map(n=>n.dataset.character)),savedGrantIds);
  await host.close();check('An interrupted batch response survives iframe reload and resumes the same five-pack receipt with no second save, debit or grant');

  const adminHost=await browser.newPage({viewport:{width:1440,height:1000}});observe(adminHost);const adminGame=await harnessGame(adminHost,'admin');
  await adminGame.locator('[data-view="packs"]').click();await adminGame.locator('#admin-unlimited').click();await adminGame.waitForFunction(()=>__grandLine.admin.unlimitedGold&&!__grandLine.adminPending);
  await adminGame.locator('[data-pack="galaxy"]').click();await adminGame.locator('[data-quantity="50"]').click();
  assert.match(await adminGame.locator('#pack-total').textContent(),/50 packs.*50 cards.*0 points/);assert.equal(await adminGame.locator('#open-pack').isEnabled(),true);
  await adminGame.locator('#open-pack').click();await adminGame.waitForFunction(()=>__grandLine.dialog==='reveal');
  assert.equal(await adminGame.locator('.batch-reveal-item').count(),50);
  const fifty=await adminHost.evaluate(()=>{const request=fake.requests.findLast(d=>d.type==='GLTCG_BUY_REQUEST');return {gold:fake.state.gold,receipt:fake.state.grandLine.profiles['test-profile'].purchases[request.purchaseId]};});
  assert.equal(fifty.gold,0);assert.equal(fifty.receipt.quantity,50);assert.equal(fifty.receipt.cost,0);assert.equal(fifty.receipt.normalCost,37500);assert.equal(fifty.receipt.adminUnlimited,true);
  assert.deepEqual(await adminGame.locator('.batch-reveal-item').evaluateAll(nodes=>nodes.map(n=>n.dataset.character)),fifty.receipt.grants.map(g=>g.characterId));
  assert.equal(await adminGame.evaluate(()=>__grandLine.collection.stats.packsOpened),50);
  await screenshot(adminHost,'batch-fifty-admin');await adminHost.setViewportSize({width:320,height:740});await frames(adminHost,4);
  assert.equal(await adminGame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
  await adminGame.locator('.batch-reveal-item').last().scrollIntoViewIfNeeded();assert.equal(await adminGame.locator('.batch-reveal-item').last().isVisible(),true);
  await adminGame.getByRole('button',{name:'Back to card shop',exact:true}).scrollIntoViewIfNeeded();await screenshot(adminHost,'batch-fifty-mobile');
  await adminGame.getByRole('button',{name:'Back to card shop',exact:true}).click();await adminHost.close();
  check('Administrators can open fifty packs at zero gold, retain normal-rate receipt evidence, and browse every reveal on a small phone');
}

async function checkLegacyPackCapability() {
  const host=await browser.newPage({viewport:{width:1100,height:850}});observe(host);const game=await harnessGame(host,'student',true);
  await game.locator('[data-view="packs"]').click();
  for(const quantity of [5,10,50])assert.equal(await game.locator('[data-quantity="'+quantity+'"]').isDisabled(),true,'A stale parent cannot authorize batch size '+quantity);
  assert.equal(await game.locator('[data-quantity="1"]').isEnabled(),true);
  await game.locator('[data-quantity="5"]').dispatchEvent('click');assert.equal(await game.locator('[data-quantity="1"]').getAttribute('aria-pressed'),'true');
  await game.locator('#open-pack').click();await game.waitForFunction(()=>__grandLine.dialog==='reveal');
  assert.equal(await game.locator('.reveal-content .tcg-card').count(),1);assert.equal(await host.evaluate(()=>fake.state.gold),4880);
  assert.equal(await host.evaluate(()=>fake.requests.findLast(d=>d.type==='GLTCG_BUY_REQUEST').quantity),1);

  await host.evaluate(()=>{fake.legacyHost=false;});
  await Promise.all([game.waitForNavigation(),game.evaluate(()=>location.reload())]);await game.waitForFunction(()=>__grandLine.ready);
  await game.locator('[data-view="packs"]').click();await game.locator('[data-quantity="5"]').click();await host.evaluate(()=>{fake.failPurchaseResponseOnce=true;});
  await game.locator('#open-pack').click();await game.waitForFunction(()=>__grandLine.purchasePending&&!__grandLine.purchasePending.waiting);
  const pending=await game.evaluate(()=>({purchaseId:__grandLine.purchasePending.purchaseId,quantity:__grandLine.purchasePending.quantity}));assert.equal(pending.quantity,5);
  const committed=await host.evaluate(()=>({state:JSON.stringify(fake.state),commits:fake.commits}));
  await host.evaluate(()=>{fake.legacyHost=true;});
  await Promise.all([game.waitForNavigation(),game.evaluate(()=>location.reload())]);await game.waitForFunction(()=>__grandLine.ready);
  assert.deepEqual(await game.evaluate(()=>({purchaseId:__grandLine.purchasePending.purchaseId,quantity:__grandLine.purchasePending.quantity})),pending);
  await game.locator('[data-view="packs"]').click();const requests=await host.evaluate(()=>fake.requests.filter(d=>d.type==='GLTCG_BUY_REQUEST').length);
  assert.equal(await game.locator('#open-pack').isDisabled(),true);assert.match(await game.locator('#pack-progress').textContent(),/refresh/i);
  await game.locator('#open-pack').dispatchEvent('click');
  for(const button of await game.getByRole('button',{name:'Resume this purchase',exact:true}).all())await button.dispatchEvent('click');
  await frames(host,3);assert.equal(await host.evaluate(()=>fake.requests.filter(d=>d.type==='GLTCG_BUY_REQUEST').length),requests,'A five-pack receipt never reaches a host that would silently buy one');
  assert.deepEqual(await host.evaluate(()=>({state:JSON.stringify(fake.state),commits:fake.commits})),committed);
  assert.equal(await game.evaluate(()=>__grandLine.purchasePending.purchaseId),pending.purchaseId);

  await host.evaluate(()=>{fake.legacyHost=false;});
  await Promise.all([game.waitForNavigation(),game.evaluate(()=>location.reload())]);await game.waitForFunction(()=>__grandLine.ready);
  await game.locator('[data-view="packs"]').click();await game.locator('#open-pack').click();await game.getByRole('button',{name:'Resume this purchase',exact:true}).click();await game.waitForFunction(()=>__grandLine.dialog==='reveal');
  assert.equal(await game.locator('.batch-reveal-item').count(),5);assert.deepEqual(await host.evaluate(()=>({state:JSON.stringify(fake.state),commits:fake.commits})),committed);
  await host.close();check('Legacy portals allow only one pack and retain pending batches without sending them until a refreshed portal confirms batch support');
}

async function checkPaidRosterMigration() {
  const host=await browser.newPage({viewport:{width:1440,height:1000}});observe(host);const game=await harnessGame(host,'admin');
  const entries=[['ace','bellamy'],['sabo','gin'],['law','mr3'],['king','kuro']];
  await host.evaluate(entries=>{
    const profile=fake.state.grandLine.profiles['test-profile'],c=profile.collection;
    for(const [i,[oldId,newId]]of entries.entries()){c.cards[oldId]={copies:2+i};c.cards[newId]={copies:1};}
    c.cards.kaido={copies:1};c.cards.zoro.copies=2;c.team=[...entries.map(([id])=>id),'luffy','zoro','nami','usopp','chopper','kaido'];c.stats.packsOpened=17;
    profile.purchases={'reserved-batch':{packId:'galaxy',quantity:5,cost:3750,at:'2026-09-14T12:00:00.000Z',grants:[...entries.map(([characterId],i)=>({characterId,copies:2+i,duplicate:true,stars:characterId==='law'?6:5})),{characterId:'zoro',copies:2,duplicate:true,stars:5}]}};
    fake.state.gold=0;
  },entries);
  await game.evaluate(()=>localStorage.setItem('grand-line.v1:math:'+__grandLine.scope+':purchase',JSON.stringify({purchaseId:'reserved-batch',packId:'galaxy',quantity:5})));
  const stored=await host.evaluate(()=>({state:JSON.stringify(fake.state),commits:fake.commits,rolls:fake.randomCalls}));
  await Promise.all([game.waitForNavigation(),game.evaluate(()=>location.reload())]);await game.waitForFunction(()=>__grandLine.ready);
  const migrated=await game.evaluate(()=>structuredClone(__grandLine.collection));
  assert.deepEqual(migrated.team,[...entries.map(([,id])=>id),'luffy','zoro','nami']);
  for(const id of ['usopp','chopper','kaido'])assert.ok(migrated.cards[id]?.copies>0,'Trimming an old ten-person crew preserves '+id+' in the collection');
  for(const id of ['bigmom7','garp7','sabo7'])assert.equal(migrated.cards[id],undefined,'Historical cards do not grant new seven-star editions');
  for(const [i,[oldId,newId]]of entries.entries()){assert.equal(migrated.cards[oldId],undefined);assert.equal(migrated.cards[newId].copies,3+i);assert.equal(await game.locator('#card-grid [data-character="'+oldId+'"]').count(),0);}
  assert.equal(migrated.stats.packsOpened,17);assert.equal(migrated.packs,0);
  await game.locator('[data-view="packs"]').click();await game.locator('#open-pack').click();await game.getByRole('button',{name:'Resume this purchase',exact:true}).click();await game.waitForFunction(()=>__grandLine.dialog==='reveal');
  assert.deepEqual(await game.locator('.batch-reveal-item').evaluateAll(nodes=>nodes.map(n=>n.dataset.character)),[...entries.map(([,id])=>id),'zoro']);
  assert.deepEqual(await game.evaluate(()=>__grandLine.collection),migrated);
  assert.deepEqual(await host.evaluate(()=>({state:JSON.stringify(fake.state),commits:fake.commits,rolls:fake.randomCalls})),stored,'Paid historical batches migrate their reveal without a debit, random draw or save');
  await game.getByRole('button',{name:'Back to card shop',exact:true}).click();await game.locator('#admin-unlock-all').click();await game.waitForFunction(()=>!__grandLine.adminPending&&Object.keys(__grandLine.collection.cards).length===100);
  const all=await game.evaluate(()=>structuredClone(__grandLine.collection));assert.deepEqual(all.team,migrated.team);assert.deepEqual(all.stats,migrated.stats);
  for(const [i,[oldId,newId]]of entries.entries()){assert.equal(all.cards[oldId],undefined);assert.equal(all.cards[newId].copies,3+i);}
  assert.equal(await host.evaluate(()=>fake.state.gold),0);
  await game.locator('[data-view="collection"]').click();
  for(const [,id]of entries){await game.locator('#card-grid [data-character="'+id+'"]').click();assert.equal(await game.locator('#dialog-panel [data-character="'+id+'"]').count(),1);await game.locator('#dialog-panel .dialog-close').click();}
  if(process.env.GRAND_LINE_REQUIRE_ART==='1'){
    const art=await game.evaluate(async ids=>Promise.all(ids.map(async id=>{const item=__grandLine.art.load(id);await item.promise;return {id,loaded:item.loaded,failed:item.failed,bounds:item.bounds,metadata:__grandLine.art.metadata.has(id)};})),entries.map(([,id])=>id));
    assert.ok(art.every(item=>item.loaded&&!item.failed&&item.metadata&&item.bounds?.w>30&&item.bounds?.h>30),'Every replacement has loaded original card and avatar art');
  }
  await game.locator('[data-view="campaign"]').click();await game.locator('#campaign-map button').first().click();
  assert.deepEqual(await game.evaluate(()=>__grandLine.battle.allies.map(a=>a.characterId)),migrated.team);
  await screenshot(host,'reserved-four-migrated-crew');await host.close();
  check('Four retired IDs transfer paid copies and historical batch reveals once; old ten-person crews trim to seven without losing cards or granting new expansion editions');
}

async function checkGeneratedDefenseVfx() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); observe(page); await standalone(page);
  const mappings=await page.evaluate(async()=>{const {getVfxSpec,PREMIUM_VFX_CHARACTERS}=await import('./grand-line-vfx.js');return {premium:PREMIUM_VFX_CHARACTERS.length,
    skills:__grandLine.CHARACTERS.flatMap(c=>c.skills.map(skill=>({id:skill.id,premium:getVfxSpec(c.id,skill)?.premium,atlasId:getVfxSpec(c.id,skill)?.atlasId})))};});
  assert.equal(mappings.premium,12);assert.equal(mappings.skills.length,300);assert.equal(mappings.skills.filter(s=>s.premium).length,36);
  assert.equal(mappings.skills.filter(s=>s.atlasId==='generic').length,88*3);assert.ok(mappings.skills.every(s=>s.atlasId));
  const atlases = await page.evaluate(async () => {
    const { createDefenseVfxManager, VFX_ATLAS_SPECS } = await import('./grand-line-vfx.js');
    window.qaVfx = createDefenseVfxManager(); await qaVfx.ready; await qaVfx.preload();
    return VFX_ATLAS_SPECS.map(spec => {
      const item = qaVfx.images.get(spec.id), metadata = qaVfx.metadata.get(spec.id);
      if (!item?.loaded) return { id: spec.id, loaded: false };
      const canvas = document.createElement('canvas'); canvas.width = item.image.naturalWidth; canvas.height = item.image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(item.image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, frames = [];
      for (let row = 0; row < 3; row++) for (let frame = 0; frame < 4; frame++) {
        let clear = 0, visible = 0, samples = 0, hash = 2166136261;
        const left = Math.floor(frame * canvas.width / 4), right = Math.floor((frame + 1) * canvas.width / 4);
        const top = Math.floor(row * canvas.height / 3), bottom = Math.floor((row + 1) * canvas.height / 3);
        for (let y = top; y < bottom; y += 3) for (let x = left; x < right; x += 3) {
          const offset = (y * canvas.width + x) * 4, alpha = pixels[offset + 3]; samples++;
          if (alpha <= 2) clear++; if (alpha >= 16) visible++;
          for (let channel = 0; channel < 4; channel++) hash = Math.imul(hash ^ pixels[offset + channel], 16777619) >>> 0;
        }
        frames.push({ row, frame, clear: clear / samples, visible: visible / samples, hash });
      }
      return { id: spec.id, loaded: true, width: canvas.width, height: canvas.height, frames,
        source: item.image.currentSrc || item.image.src, expected: metadata?.file ? new URL('./assets/grand-line-vfx/' + metadata.file, location.href).href : null };
    });
  });
  assert.equal(atlases.length, 13); const premiumRows = new Set();
  for (const atlas of atlases) {
    assert.equal(atlas.loaded, true, atlas.id + ' generated VFX loads'); assert.ok(atlas.width >= 1000 && atlas.height >= 1000);
    assert.ok(atlas.expected); assert.equal(new URL(atlas.source).pathname, new URL(atlas.expected).pathname);
    assert.equal(atlas.frames.length, 12);
    for (const frame of atlas.frames) {
      assert.ok(frame.clear > .1, `${atlas.id} row ${frame.row} frame ${frame.frame} has a transparent background`);
      assert.ok(frame.visible > .001, `${atlas.id} row ${frame.row} frame ${frame.frame} contains visible painted effects`);
    }
    for (let row = 0; row < 3; row++) {
      const hashes = atlas.frames.filter(frame => frame.row === row).map(frame => frame.hash);
      assert.equal(new Set(hashes).size, 4, `${atlas.id} skill row ${row} animates through four different frames`);
      if (atlas.id !== 'generic') premiumRows.add(hashes.join(':'));
    }
  }
  assert.equal(premiumRows.size, 36, 'All premium skill rows have distinct actual image content');
  check('All 36 premium skill animations and the shared lower-star effects load 156 visible, distinct, transparent image frames');

  await page.evaluate(async () => {
    const defense = await import('./grand-line-defense.js'), { createDefenseRenderer } = await import('./grand-line-defense-render.js');
    const { PREMIUM_VFX_CHARACTERS, createDefenseVfxManager } = await import('./grand-line-vfx.js');
    const collection = JSON.parse(JSON.stringify(__grandLine.collection));
    collection.cards = Object.fromEntries(__grandLine.CHARACTERS.map(c => [c.id, { copies: 1 }])); collection.team = PREMIUM_VFX_CHARACTERS.slice(0,5);
    const b = defense.createDefense(collection, { seed: 42 }); b.supplies = 1000;
    [...PREMIUM_VFX_CHARACTERS.slice(5,6),'marco'].forEach((id,i) => defense.summonDefender(b,id,defense.DEFENSE_DEFAULT_PADS[i+5].id));
    const avatars=await Promise.all(b.allies.map(ally=>__grandLine.art.load(ally.characterId).promise));
    if(avatars.some(item=>!item.loaded||item.failed))throw Error('Dense VFX screenshots require every deployed avatar to load');
    for(const [column,gap]of[[7,2],[17,10]])for(let row=0;row<13;row++)if(row!==gap){
      const cell=`cell-${column}-${row}`;if(defense.getMazePlacementPreview(b,cell,{kind:'tower'}).valid)defense.buildMazeTower(b,cell);
    }
    b.round=3;defense.startDefenseWave(b); for(let i=0;i<12;i++)defense.advanceDefense(b,.05);
    const enemy = b.enemies[0];
    b.enemies = Array.from({length:200},(_,i) => {
      const unit = JSON.parse(JSON.stringify(enemy)); unit.id = 'vfx-mob-'+i; unit.progress = .02+i*.0047;
      unit.hp = unit.maxHp = 1000; unit.alive = true; unit.escaped = false; unit.laneOffset = (i%5-2)*4;unit.entryId=b.activeEntryIds[i%b.activeEntryIds.length];
      Object.assign(unit,defense.defenseEnemyPointAt(unit.progress,unit.laneOffset,b,unit.entryId)); return unit;
    });
    b.projectiles = Array.from({length:80},(_,i) => {
      const actor=b.allies[i%b.allies.length], skill=actor.skills[i%3], geometry=defense.getDefenseSkillProfile(actor,skill);
      const target=b.enemies[(i*17)%200], start={x:actor.x,y:actor.y}, end={x:target.x,y:target.y}, phase=.15+(i%5)*.14;
      return { id:'vfx-projectile-'+i,sourceId:actor.id,characterId:actor.characterId,skillId:skill.id,kind:skill.kind,animation:skill.animation,color:skill.color,
        ...geometry,geometry,start,end,x:start.x+(end.x-start.x)*phase,y:start.y+(end.y-start.y)*phase,
        age:phase,duration:1,range:actor.range,targetId:target.id,hitIds:[],actor,skill,damageTotal:0,finished:false };
    });
    b.effects = Array.from({length:80},(_,i) => {const target=b.enemies[(i*17)%200],actor=b.allies[i%b.allies.length];return {
      id:'vfx-damage-'+i,kind:'damage',sourceId:actor.id,source:{x:actor.x,y:actor.y},targetIds:[target.id],targets:[{x:target.x,y:target.y}],amount:50+i,age:0,life:1,
    };});
    for(let i=0;i<30;i++){const p=b.projectiles[i],target=b.enemies[(i*17)%200];b.effects.push({id:'vfx-impact-'+i,kind:'impact',sourceId:p.sourceId,characterId:p.characterId,
      skillId:p.skillId,attackKind:p.kind,shape:'splash',geometry:p.geometry,source:p.start,origin:p.start,center:p.end,end:p.end,
      targetIds:[target.id],targets:[{x:target.x,y:target.y}],age:0,life:.45});}
    const healer=b.allies.find(a=>a.characterId==='marco');
    for(let i=0;i<12;i++){const target=b.allies[i%b.allies.length];b.effects.push({id:'vfx-support-'+i,kind:'heal',sourceId:healer.id,characterId:'marco',skillId:'marco-1',source:{x:healer.x,y:healer.y},
      targetIds:[target.id],targets:[{x:target.x,y:target.y}],age:0,life:1});}
    window.qaBattle=JSON.parse(JSON.stringify(b));
    const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};freeze(qaBattle);
    const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:999999;background:#082c39;display:grid;place-items:center';
    const canvas=document.createElement('canvas');canvas.id='vfx-qa-canvas';canvas.style.cssText='width:100%;height:auto;aspect-ratio:16/9;max-height:100vh';overlay.append(canvas);document.body.append(overlay);
    window.qaPhases=[];window.qaPreloads=[];
    window.qaRenderer=createDefenseRenderer(canvas,__grandLine.art,{vfx:{
      preload:ids=>{qaPreloads.push([...ids]);return qaVfx.preload(ids);},sprite:(...args)=>{qaPhases.push(args[3]);return qaVfx.sprite(...args);},
    }});
    qaRenderer.draw({...qaBattle,allies:qaBattle.allies.slice(0,5),projectiles:[],effects:[]},800,{});
    window.qaInitialPreloads=qaPreloads.flat();
    window.qaFallback=()=>{qaRenderer.destroy();const missing=createDefenseVfxManager({baseUrl:new URL('./missing-vfx/',location.href).href,fetchFn:null,timeoutMs:100});
      qaRenderer=createDefenseRenderer(canvas,__grandLine.art,{vfx:missing});return missing.preload();};
    window.qaTintProbe=()=>{
      qaRenderer.destroy();const image=document.createElement('canvas');image.width=image.height=16;
      const paint=image.getContext('2d');paint.fillStyle='#fff';paint.fillRect(0,0,16,16);let tint='#ff0000';
      qaRenderer=createDefenseRenderer(canvas,__grandLine.art,{vfx:{preload:()=>Promise.resolve(),sprite:()=>({image,sx:0,sy:0,sw:16,sh:16,row:0,frame:0,atlasId:'generic',premium:false,tint})}});
      const p={...qaBattle.projectiles[0],id:'tint-shot',characterId:'nami',skillId:'nami-0',kind:'lightning',shape:'single',start:{x:450,y:300},end:{x:550,y:300},x:500,y:300};
      const battle={...qaBattle,id:'tint-probe',allies:[],enemies:[],effects:[],projectiles:[p]},before=JSON.stringify(battle);
      const pixel=()=>{const box=canvas.getBoundingClientRect(),scale=Math.min(box.width/1120,box.height/630),ox=(box.width-scale*1120)/2,oy=(box.height-scale*630)/2;
        return [...canvas.getContext('2d').getImageData(Math.round((ox+500*scale)*canvas.width/box.width),Math.round((oy+286*scale)*canvas.height/box.height),1,1).data];};
      qaRenderer.draw(battle,3000,{});const red=pixel();tint='#0000ff';qaRenderer.draw(battle,3000,{});const blue=pixel();
      for(let i=0;i<40;i++){tint='#'+((i*7919+37)&0xffffff).toString(16).padStart(6,'0');qaRenderer.draw(battle,3000,{});}
      return {red,blue,stats:qaRenderer.getVfxStats(),unchanged:before===JSON.stringify(battle)};
    };
  });
  function assertBudget(stats) {
    for(const key of ['projectiles','impacts','supports','damageLabels'])assert.ok(stats[key]<=stats.budget[key],key+' is bounded');
    assert.ok(stats.sprites<=stats.budget.totalSprites); assert.ok(stats.projectiles+stats.impacts+stats.supports<=stats.budget.totalSprites);
    assert.ok(stats.droppedSprites>0,'Dense overlapping effects are culled');
  }
  for(const [label,viewport] of [['desktop',{width:1440,height:1000}],['phone',{width:320,height:740}]]) {
    await page.setViewportSize(viewport);await frames(page,3);
    for(const reducedMotion of [false,true]) {
      const report=await page.evaluate(reducedMotion=>{
        qaRenderer.resize();qaPhases.length=0;const before=JSON.stringify(qaBattle);
        qaRenderer.draw(qaBattle,1000,{selectedAllyId:qaBattle.allies[0].id,reducedMotion});
        return {unchanged:before===JSON.stringify(qaBattle),stats:qaRenderer.getVfxStats(),phases:[...new Set(qaPhases)],enemies:qaBattle.enemies.length,
          prefetched:qaPreloads.flat(),initialPreloads:qaInitialPreloads,newAllies:qaBattle.allies.slice(5).map(a=>a.characterId)};
      },reducedMotion);
      assert.equal(report.enemies,200);assert.equal(report.unchanged,true);assertBudget(report.stats);
      assert.ok(report.stats.sprites>0);assert.equal(report.stats.fallbacks,0);assert.equal(report.stats.rangeVisible,false);
      assert.equal(report.stats.reducedMotion,reducedMotion);
      for(const id of report.newAllies){assert.ok(!report.initialPreloads.includes(id));assert.ok(report.prefetched.includes(id),'Newly summoned '+id+' is prefetched within the same battle');}
      if(label==='phone')assert.ok(report.stats.budget.totalSprites<=12);
      if(reducedMotion)assert.ok(report.phases.every(phase=>phase===.35||phase===.7),'Reduced motion uses fixed animation poses');
      await page.screenshot({path:path.join(shots,`vfx-${label}-${reducedMotion?'reduced':'dense'}.png`)});
    }
    const preview=await page.evaluate(()=>{qaRenderer.draw(qaBattle,1000,{selectedAllyId:qaBattle.allies[0].id,previewSkillId:qaBattle.allies[0].skills[0].id});return qaRenderer.getVfxStats();});
    assert.equal(preview.rangeVisible,true,'Attack areas appear when explicitly requested');
  }
  check('Dense 200-enemy maze scenes with loaded crew art obey desktop/mobile sprite and label budgets, support reduced motion and never mutate combat state');
  for(const status of ['learning','setup','victory','defeat']) {
    const stopped=await page.evaluate(status=>{
      const battle={...qaBattle,status},before=JSON.stringify(battle);
      qaRenderer.draw(battle,2000,{selectedAllyId:battle.allies[0].id});
      return {stats:qaRenderer.getVfxStats(),remaining:battle.projectiles.length,unchanged:before===JSON.stringify(battle)};
    },status);
    assert.ok(stopped.remaining>0,'The regression includes real leftover projectile records');
    assert.equal(stopped.stats.projectiles,0,`${status} never paints leftover projectiles after a wave stops`);
    assert.equal(stopped.unchanged,true);
  }
  await page.evaluate(()=>qaFallback());
  const fallback=await page.evaluate(()=>{const before=JSON.stringify(qaBattle);qaRenderer.draw(qaBattle,1000,{selectedAllyId:qaBattle.allies[0].id});return {stats:qaRenderer.getVfxStats(),unchanged:before===JSON.stringify(qaBattle)};});
  assertBudget(fallback.stats);assert.equal(fallback.stats.sprites,0);assert.ok(fallback.stats.fallbacks>0);assert.equal(fallback.unchanged,true);
  await page.screenshot({path:path.join(shots,'vfx-phone-offline-fallback.png')});
  const tinted=await page.evaluate(()=>qaTintProbe());
  assert.ok(tinted.red[0]>tinted.red[2]+80&&tinted.blue[2]>tinted.blue[0]+80,'Shared sprites visibly use the requested elemental tint');
  assert.equal(tinted.stats.tintedSprites,1);assert.ok(tinted.stats.tintCacheEntries>0&&tinted.stats.tintCacheEntries<=tinted.stats.tintCacheLimit&&tinted.stats.tintCacheLimit<=24);
  assert.equal(tinted.unchanged,true);await page.close();
  check('Missing VFX images fall back to bounded quiet markers without blocking rendering or changing damage');
}

async function checkBattlefieldWorkspace() {
  for (const viewport of [{width:2048,height:1100},{width:1440,height:900},{width:1366,height:768}]) {
    const page=await browser.newPage({viewport});observe(page);await standalone(page);
    await page.evaluate(()=>{
      const collection=structuredClone(__grandLine.collection);
      collection.team=__grandLine.CHARACTERS.slice(0,7).map(c=>c.id);
      for(const id of collection.team)collection.cards[id]={copies:1};
      __grandLine.applySnapshot({collection});
    });
    await page.locator('[data-view="campaign"]').click();await page.locator('#campaign-map button').first().click();
    await page.locator('#map-viewport').scrollIntoViewIfNeeded();await frames(page,3);await noOverflow(page);
    const layout=await page.evaluate(()=>{
      const bounds=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
      const viewport=document.getElementById('map-viewport');
      return {map:bounds('battle-canvas'),viewport:bounds('map-viewport'),build:bounds('build-toggle'),start:bounds('start-wave'),palette:bounds('placement-palette'),scrollHeight:viewport.scrollHeight,clientHeight:viewport.clientHeight};
    });
    assert.ok(layout.map.width>=viewport.width*.70,'The battlefield occupies most of a desktop screen instead of shrinking with its height');
    assert.ok(layout.map.width>=layout.viewport.width*.98,'The map fills its column without empty side gutters');
    assert.ok(layout.map.width/layout.map.height>1.76&&layout.map.width/layout.map.height<1.80,'A wider map preserves landscape geometry');
    assert.ok(layout.scrollHeight<=layout.clientHeight+2,'The fitted desktop map shows all rows without internal scrolling');
    assert.ok(layout.build.x>=layout.map.right-2,'Desktop build controls stay beside the enlarged map');
    assert.ok(layout.build.y<layout.map.bottom&&layout.build.bottom>layout.map.y,'Tower palette stays alongside the play area');
    assert.ok(layout.start.y>=0&&layout.start.bottom<=viewport.height,'Start wave stays on screen with the map');
    assert.equal(await page.locator('#defender-buttons [data-ally]').count(),7);
    await page.locator('#build-toggle').click();await clickCell(page,page,'cell-4-6');
    assert.equal(await page.evaluate(()=>__grandLine.battle.mazeTowers.some(t=>t.cellId==='cell-4-6')),true,'Full-width canvas picking places the tower at the clicked cell');
    assert.equal(await page.evaluate(()=>__grandLine.battle.supplies),95);
    await screenshot(page,'workspace-'+viewport.width);await page.close();
  }
  check('Wide and short desktop screens use a large landscape battlefield with adjacent seven-crew controls and accurate grid placement');
}

async function checkPackSelectionReadability() {
  const page=await browser.newPage({viewport:{width:390,height:844}});observe(page);await standalone(page);
  await page.locator('[data-view="packs"]').click();
  for(const quantity of [1,5,10,50]) {
    const selected=page.locator(`#pack-quantities [data-quantity="${quantity}"]`);await selected.click();
    assert.equal(await page.locator('#pack-quantities [aria-pressed="true"]').count(),1,'Exactly one pack quantity is selected');
    assert.equal(await selected.getAttribute('aria-pressed'),'true');
    for(const hover of [false,true]) {
      if(hover)await selected.hover();else await page.mouse.move(1,1);
      await frames(page,15);
      const contrast=await selected.evaluate(element=>{
        const css=getComputedStyle(element),rgb=text=>(text.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
        const luminance=values=>values.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
        const foreground=luminance(rgb(css.color)),background=luminance(rgb(css.backgroundColor));
        return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
      });
      assert.ok(contrast>=4.5,`Selected ${quantity}-pack label stays readable ${hover?'while hovered':'at rest'} (${contrast.toFixed(2)}:1)`);
    }
    assert.match(await page.locator('#pack-total').textContent(),new RegExp('^'+quantity+' pack'));
    assert.equal(await page.locator('#open-pack').isDisabled(),true,'Changing a quantity does not authorize preview purchases');
  }
  await noOverflow(page);await screenshot(page,'phone-pack-quantity-selection');await page.close();
  check('Every selected pack quantity stays readable at rest and on hover with one clear selection and unchanged purchase authorization');
}

async function checkCrewStrategyInterface() {
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:740}]) {
    const page=await browser.newPage({viewport,isMobile:viewport.width<500,hasTouch:viewport.width<500});observe(page);await standalone(page);
    await page.evaluate(()=>{const collection=JSON.parse(JSON.stringify(__grandLine.collection));collection.cards=Object.fromEntries(__grandLine.CHARACTERS.map(c=>[c.id,{copies:1}]));collection.team=['kaido','bigmom7','luffy','zoro','nami','usopp','chopper'];__grandLine.applySnapshot({collection});});
    await page.locator('#allegiance-filter').selectOption('rocks');
    assert.deepEqual((await page.locator('#card-grid [data-character]').evaluateAll(nodes=>nodes.map(n=>n.dataset.character))).sort(),['bigmom7','kaido','whitebeard']);
    assert.match(await page.locator('#collection-result-count').textContent(),/Showing 3 cards/);
    await page.locator('#search-input').fill('does-not-exist');assert.equal(await page.locator('#empty-collection').isVisible(),true);
    await page.locator('#clear-collection-filters').click();assert.equal(await page.locator('#card-grid .tcg-card').count(),100);assert.equal(await page.locator('#allegiance-filter').inputValue(),'all');
    await page.locator('[data-view="crew"]').click();assert.equal(await page.locator('#crew-slots .crew-slot').count(),7);assert.match(await page.locator('#crew-nav-count').textContent(),/^7 \/ 7$/);
    const straw=page.locator('#crew-synergies .synergy-group').filter({hasText:'Straw Hat Pirates'}),rocks=page.locator('#crew-synergies .synergy-group').filter({hasText:'Rocks Pirates'});
    assert.match(await straw.textContent(),/5.*\+16% all stats/);assert.match(await rocks.textContent(),/2.*\+6% all stats/);
    await page.getByRole('button',{name:'Inspect Kaido the Beast, captain, crew slot 1',exact:true}).click();
    assert.match(await page.locator('#dialog-panel .allegiance-badges').textContent(),/Beast Pirates.*Captain/);assert.match(await page.locator('#dialog-panel .allegiance-badges').textContent(),/Rocks Pirates/);
    assert.match(await page.locator('#dialog-panel .captain-aura-description').textContent(),/10% attack/);await page.keyboard.press('Escape');
    const before=await page.evaluate(()=>[...__grandLine.collection.team]);
    await page.getByRole('button',{name:'Change crew slot 7',exact:true}).click();await page.locator('#crew-search').fill('Queen');
    assert.deepEqual((await page.locator('#crew-picker [data-character]').evaluateAll(nodes=>nodes.map(n=>n.dataset.character))).sort(),['bigmom7','queen'],'Search includes Queen and Big Mom’s Soul Queen title');
    await page.locator('#cancel-crew-selection').click();assert.deepEqual(await page.evaluate(()=>__grandLine.collection.team),before);assert.equal(await page.locator('#cancel-crew-selection').isHidden(),true);
    await page.getByRole('button',{name:'Change crew slot 7',exact:true}).click();assert.equal(await page.locator('#crew-search').inputValue(),'');
    await page.locator('#crew-allegiance-filter').selectOption('beasts');
    const beasts=await page.locator('#crew-picker [data-character]').evaluateAll(nodes=>nodes.map(n=>n.dataset.character));assert.ok(beasts.includes('kaido')&&beasts.includes('queen'));assert.ok(!beasts.includes('zoro'));
    assert.equal(await page.locator('#crew-picker [data-character="kaido"]').isDisabled(),true,'The visible captain cannot occupy a second crew slot');
    await page.locator('#crew-picker [data-character="queen"]').click();await page.waitForFunction(()=>__grandLine.collection.team[6]==='queen');
    assert.match(await straw.textContent(),/4.*\+10% all stats/);assert.match(await page.locator('#crew-synergies .synergy-group').filter({hasText:'Beast Pirates'}).textContent(),/2.*\+6% all stats/);
    assert.equal(await page.locator('#cancel-crew-selection').isHidden(),true);await noOverflow(page);await screenshot(page,'alliances-crew-'+viewport.width);
    await page.locator('[data-view="campaign"]').click();await page.locator('#defense-continue button').click();
    assert.equal(await page.locator('#defender-buttons [data-ally]').count(),7);const dimensions=await page.locator('#defender-buttons').evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth,tiles:[...element.children].map(n=>{const r=n.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right};})}));
    assert.ok(dimensions.scroll<=dimensions.width+1,'Every crew tile is in the visible grid, with no swipe-only hidden crew');for(const tile of dimensions.tiles)assert.ok(tile.width>=44&&tile.height>=44,'Crew touch targets remain reachable');
    await page.locator('#summon-toggle').click();assert.match(await page.locator('#summon-choice').textContent(),/seven crew slots are filled/);assert.equal(await page.locator('#summon-roster [data-summon="marco"]').isDisabled(),true);await page.locator('#summon-toggle').click();
    const zoro=await page.evaluate(()=>__grandLine.battle.allies.find(a=>a.characterId==='zoro').id);
    await page.locator('#defender-buttons [data-ally="'+zoro+'"]').click();await clickCell(page,page,'cell-7-7');
    assert.equal(await page.evaluate(id=>__grandLine.battle.allies.find(a=>a.id===id).padId,zoro),'cell-7-7');
    assert.match(await page.locator('#defender-bonus-summary').textContent(),/All stats \+10%.*Aura attack \+12%/);
    await openAbilities(page);assert.match(await page.locator('#defender-synergies .captain-aura-status').textContent(),/attack \+12%/);await page.locator('#defender-abilities summary').click();
    await page.locator('#defender-buttons [data-ally="'+zoro+'"]').click();await clickCell(page,page,'cell-24-11');
    assert.match(await page.locator('#defender-bonus-summary').textContent(),/^All stats \+10%$/,'Moving away removes the spatial aura while retaining allegiance bonuses');
    await openAbilities(page);assert.match(await page.locator('#defender-synergies .captain-aura-status').textContent(),/No active leader aura in range/);
    await page.locator('#battle-synergies summary').first().click();assert.match(await page.locator('#battle-synergy-summary').textContent(),/3 active/);await noOverflow(page);await screenshot(page,'alliances-battle-'+viewport.width);await page.close();
  }
  check('Collection allegiance filters, seven-slot search/cancel/replacement, captain badges, live group thresholds and nearby aura readouts stay correct on desktop and both phone sizes');
}

async function checkThreeEntranceInterface() {
  for(const viewport of [{width:2048,height:1100},{width:390,height:844},{width:320,height:740}]) {
    const page=await browser.newPage({viewport,isMobile:viewport.width<500,hasTouch:viewport.width<500});observe(page);await standalone(page);
    await page.evaluate(async()=>{
      const a=__grandLine,collection=structuredClone(a.collection);collection.cards=Object.fromEntries(a.CHARACTERS.map(c=>[c.id,{copies:1}]));collection.team=['kaido','bigmom7','whitebeard','marco','sabo7','koala','garp7'];a.applySnapshot({collection});a.settings.battleSpeed=1;
      await a.art.ready;await Promise.all(collection.team.map(id=>a.art.load(id).promise));
    });
    await page.locator('[data-view="campaign"]').click();await page.locator('#defense-continue button').click();
    for(let wave=1;wave<=3;wave++) {
      await checkWaveEntrances(page);await noOverflow(page);
      const summary=await page.locator('#wave-entrances').boundingBox(),start=await page.locator('#start-wave').boundingBox();
      assert.ok(Math.abs(summary.y-start.y)<100,'Entry information stays beside Start wave on desktop and phone');
      assert.equal(await page.locator('#defender-buttons [data-ally]').count(),7);
      assert.match(await page.locator('#route-length').textContent(),/^3 open routes/);
      if(wave===3){
        const roads=await page.evaluate(()=>{
          const a=__grandLine,g=document.querySelector('#battle-canvas').getContext('2d'),original={},strokes=[];let segments=[],pen=null;
          const edge=(p,q)=>[p.join(','),q.join(',')].sort().join('|');
          for(const name of ['beginPath','moveTo','lineTo','stroke'])original[name]=g[name];
          g.beginPath=function(...args){segments=[];pen=null;return original.beginPath.apply(this,args);};
          g.moveTo=function(x,y){pen=[x,y];return original.moveTo.call(this,x,y);};
          g.lineTo=function(x,y){if(pen)segments.push(edge(pen,[x,y]));pen=[x,y];return original.lineTo.call(this,x,y);};
          g.stroke=function(...args){if(this.lineWidth===10)strokes.push([...segments]);return original.stroke.apply(this,args);};
          try{a.renderer.draw(a.battle,1000,{reducedMotion:true,placementArmed:false});}finally{for(const name of Object.keys(original))g[name]=original[name];}
          // Wave three uses every entrance, including roads that merge near the exit.
          const all=[];for(const route of Object.values(a.battle.routes))for(let i=1;i<route.points.length;i++)all.push(edge([route.points[i-1].x,route.points[i-1].y],[route.points[i].x,route.points[i].y]));
          return {strokes,unique:[...new Set(all)].sort(),unmerged:all.length};
        });
        assert.equal(roads.strokes.length,1,'All three roads share one paint operation');
        assert.deepEqual(roads.strokes[0].sort(),roads.unique,'Every active road segment paints exactly once');
        assert.ok(roads.unique.length<roads.unmerged,'The fixture includes a genuinely shared exit segment');
      }
      await page.locator('#start-wave').scrollIntoViewIfNeeded();await frames(page,3);
      await page.screenshot({path:path.join(shots,`entrances-${viewport.width}-wave-${wave}-setup.png`)});
      await page.locator('#start-wave').click();await checkWaveEntrances(page,{spawned:true});
      if(wave===3){await page.locator('#defense-pause').click();await frames(page,3);await page.screenshot({path:path.join(shots,`entrances-${viewport.width}-wave-3-running.png`)});await page.locator('#defense-pause').click();}
      if(wave<3){await clearWave(page);await page.evaluate(()=>{const a=__grandLine,b=a.battle;a.completeDefenseLearning(b,{total:3,correct:3,round:b.round});a.renderBattle();});}
    }
    await page.close();
  }
  check('Three labeled gates, accurate per-gate counts and real one/two/three-gate spawns stay clear beside Start wave at desktop and both phone sizes');
}

if(process.env.GRAND_LINE_BROWSER_FOCUS==='entrances') {
  try{await checkThreeEntranceInterface();assert.deepEqual(errors,[]);await fs.writeFile(path.join(shots,'entrances-results.json'),JSON.stringify({checks,errors},null,2));}
  finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
  process.exit(0);
}

if(process.env.GRAND_LINE_BROWSER_FOCUS==='interface') {
  try{await checkBattlefieldWorkspace();await checkPackSelectionReadability();await checkCrewStrategyInterface();assert.deepEqual(errors,[]);await fs.writeFile(path.join(shots,'interface-results.json'),JSON.stringify({checks,errors},null,2));}
  finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
  process.exit(0);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); observe(page); await standalone(page);
  assert.equal(await page.locator('#card-grid .tcg-card').count(), 100);
  assert.equal(await page.locator('#card-grid .tcg-card[data-owned="true"]').count(), 5);
  assert.equal(await page.locator('#apex-showcase .tcg-card[data-stars="7"]').count(), 3);
  assert.equal(await page.evaluate(() => __grandLine.collection.packs), 0);
  await checkApexHover(page);
  check('All three featured apex cards keep stationary side and lower-edge hover targets, stable keyboard focus and the correct detail action');
  const ids = await page.locator('#card-grid .tcg-card').evaluateAll(nodes => nodes.map(n => n.dataset.character));
  for (const id of ids) {
    await page.locator(`#card-grid [data-character="${id}"]`).click();
    assert.equal(await page.locator('#dialog-panel .skill-description').count(), 4, id + ' has three active skills and a passive');
    assert.equal(await page.locator('#dialog-panel .tcg-card').count(), 1);
    await page.keyboard.press('Escape');
  }
  check('All 100 catalog cards open complete three-skill and passive details');
  await page.locator('#star-filter').selectOption('7'); assert.equal(await page.locator('#card-grid .tcg-card').count(), 6);
  await page.locator('#star-filter').selectOption('all'); await page.locator('#ownership-filter').selectOption('owned'); assert.equal(await page.locator('#card-grid .tcg-card').count(), 5);
  await page.locator('#ownership-filter').selectOption('all'); await page.locator('#search-input').fill('Kaido'); assert.equal(await page.locator('#card-grid .tcg-card').count(), 1);
  await page.locator('#search-input').fill(''); await noOverflow(page); await screenshot(page, 'desktop-collection');
  await page.locator('[data-view="crew"]').click(); assert.equal(await page.locator('#crew-slots .crew-slot').count(), 7);
  assert.equal(await page.locator('#crew-slots .empty-crew-slot').count(),2);
  await page.getByRole('button',{name:'Change crew slot 1',exact:true}).click(); assert.equal(await page.locator('#crew-picker [data-character="zoro"]').isDisabled(),true,'A character already assigned to another slot cannot be picked');
  await page.evaluate(()=>__grandLine.changeTeam(0,'zoro'));assert.match(await page.locator('#toast').textContent(), /already in your crew/); assert.equal(await page.evaluate(() => new Set(__grandLine.collection.team).size), 5);
  assert.equal(await page.locator('#crew-picker [data-character="kaido"]').count(), 0);
  check('Existing five-character crews remain valid with two open slots; duplicate and non-owned choices are blocked');
  await page.locator('[data-view="packs"]').click(); assert.equal(await page.locator('#open-pack').isDisabled(), true);
  check('Standalone preview starts with no packs and cannot spend reward points');

  const host = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); observe(host); await host.goto(base + '/__harness.html');
  const game = host.frames().find(f => f.url().includes('grand-line.html')) || await host.waitForEvent('framenavigated', f => f.url().includes('grand-line.html'));
  await game.waitForFunction(() => window.__grandLine?.ready); await game.evaluate(() => { __grandLine.settings.muted = true; });
  assert.equal(await game.evaluate(() => __grandLine.wallet.balance), 5000);
  assert.equal(await game.evaluate(() => __grandLine.collection.packs), 0);
  await game.locator('[data-view="packs"]').click();
  const grants = [];
  for (const [tier, cost] of [['spark', 120], ['nova', 320], ['galaxy', 750]]) {
    const before = await host.evaluate(() => fake.state.gold);
    await game.locator(`[data-pack="${tier}"]`).click(); assert.match(await game.locator('#open-pack').textContent(), new RegExp(String(cost)));
    await game.locator('#open-pack').click(); await game.waitForFunction(() => __grandLine.dialog === 'reveal');
    assert.equal(await game.locator('#dialog-panel .tcg-card').count(), 1, 'One purchase reveals exactly one card');
    assert.equal(await host.evaluate(() => fake.state.gold), before - cost);
    grants.push(await game.locator('#dialog-panel .tcg-card').getAttribute('data-character'));
    await screenshot(host, 'pack-' + tier); await game.locator('#dialog-panel .dialog-close').click();
  }
  assert.equal(await game.evaluate(() => __grandLine.collection.stats.packsOpened), 3);
  check('All three portal pack tiers spend their test-wallet rate and reveal exactly one character');
  await game.locator('[data-pack="spark"]').click(); await game.locator('#open-pack').click(); await game.waitForFunction(() => __grandLine.dialog === 'reveal');
  assert.match(await game.locator('#dialog-panel').textContent(), /merge rank 1/i);
  assert.equal(await game.evaluate(id => __grandLine.collection.cards[id].copies, grants[0]), 2);
  const receipt = await host.evaluate(() => fake.requests.findLast(x => x.type === 'GLTCG_BUY_REQUEST'));
  const gold = await host.evaluate(() => fake.state.gold);
  await game.evaluate(receipt => parent.postMessage(receipt, location.origin), receipt); await frames(host, 3);
  assert.equal(await host.evaluate(() => fake.state.gold), gold, 'Receipt replay cannot charge twice');
  assert.equal(await game.evaluate(() => __grandLine.collection.stats.packsOpened), 4);
  await game.locator('#dialog-panel .dialog-close').click();
  check('Duplicates merge at two copies and replayed purchase receipts cannot charge or grant twice');
  await host.evaluate(() => { fake.blockPurchase = true; });
  await game.locator('#open-pack').click();
  await game.waitForFunction(() => !__grandLine.purchasePending && !__grandLine.dialog);
  assert.equal(await host.evaluate(() => fake.state.gold), gold);
  await game.locator('[data-pack="nova"]').click(); assert.equal(await game.locator('#open-pack').isEnabled(), true);
  await host.evaluate(() => { fake.blockPurchase = false; });
  check('A confirmed no-charge rejection clears its receipt and allows another pack choice');
  await game.locator('[data-view="crew"]').click(); await game.getByRole('button',{name:'Change crew slot 1',exact:true}).click(); await game.locator(`#crew-picker [data-character="${grants[0]}"]`).click();
  await game.waitForFunction(id => __grandLine.collection.team[0] === id, grants[0]);
  // Crew changes render optimistically; wait for persistence and the child acknowledgement before inspecting the save or navigating.
  await host.waitForFunction(id => fake.state.grandLine.profiles['test-profile'].collection.team[0] === id, grants[0]);
  await game.locator('#toast').filter({ hasText: 'is ready to defend.' }).waitFor({ state: 'visible' });
  assert.equal(await host.evaluate(() => fake.state.grandLine.profiles['test-profile'].collection.team[0]), grants[0]);
  check('An unlocked card can replace a crew slot and persists through the parent');

  await game.locator('[data-view="campaign"]').click();
  assert.equal(await game.locator('#campaign-map .encounter').count(),9);
  assert.equal(await game.locator('#campaign-map button:disabled').count(),8);
  assert.match(await game.locator('#campaign-view').textContent(),/Crew Defense/i);
  await game.locator('#campaign-map button').first().click();
  await game.waitForFunction(()=>__grandLine.battle?.status==='setup');
  assert.equal(await game.locator('#defender-buttons [data-ally]').count(),5);
  assert.equal(await game.evaluate(()=>__grandLine.DEFENSE_PADS.length),338);
  assert.equal(await game.locator('#grid-column option').count(),26);
  assert.equal(await game.locator('#grid-row option').count(),13);
  const crew=await game.evaluate(()=>__grandLine.battle.allies.map(a=>({id:a.id,characterId:a.characterId,padId:a.padId})));
  assert.equal(new Set(crew.map(a=>a.padId)).size,5);
  assert.deepEqual(crew.map(a=>a.characterId),await game.evaluate(()=>__grandLine.collection.team));
  const pads=await game.evaluate(()=>__grandLine.DEFENSE_DEFAULT_PADS.map(p=>p.id));
  const emptyPad=pads.find(id=>!crew.some(a=>a.padId===id));assert.ok(emptyPad);
  const firstDefender=crew[0];
  await game.locator('#defender-buttons [data-ally="'+firstDefender.id+'"]').click();
  await selectCell(game,emptyPad);
  assert.equal(await game.evaluate(id=>__grandLine.battle.allies.find(a=>a.id===id).padId,firstDefender.id),firstDefender.padId,'Choosing a grid cell only previews movement');
  await game.locator('#cell-apply').click();
  assert.equal(await game.evaluate(id=>__grandLine.battle.allies.find(a=>a.id===id).padId,firstDefender.id),emptyPad);
  await game.evaluate(()=>__grandLine.placeDefender('not-an-owned-defender','not-a-pad'));
  assert.equal(await game.evaluate(()=>new Set(__grandLine.battle.allies.map(a=>a.padId)).size),5);
  assert.equal(await game.locator('#idle-mode,#manual-commands,#skill-buttons,#turn-order').count(),0);
  await game.locator('#start-wave').scrollIntoViewIfNeeded();await screenshot(host,'desktop-defense-setup');
  check('Existing owned crews deploy on the 338-cell maze; coordinate selection previews placement and only confirmation moves a defender');

  assert.equal(await game.evaluate(()=>__grandLine.battle.waveCount),6);
  assert.equal(await game.evaluate(()=>__grandLine.battle.supplies),100);
  assert.equal(await game.evaluate(()=>__grandLine.battle.trainingPoints),0);
  assert.equal(await game.locator('#upgrade-defender').isDisabled(),true);
  assert.match(await game.locator('#wave-preview').textContent(),/800/);
  const nonteam=await game.evaluate(()=>Object.keys(__grandLine.collection.cards).find(id=>!__grandLine.collection.team.includes(id)));
  assert.ok(nonteam,'Purchases and the saved crew leave another owned character available to summon');
  const summonPad=await game.evaluate(()=>__grandLine.DEFENSE_DEFAULT_PADS.find(p=>!__grandLine.battle.allies.some(a=>a.padId===p.id)).id);
  await game.locator('#summon-toggle').click();await game.locator('#summon-panel').waitFor({state:'visible'});
  await game.locator('#summon-pattern').selectOption('line');
  assert.equal(await game.locator('#summon-roster [data-summon="zoro"]').count(),1);
  assert.equal(await game.locator('#summon-roster [data-summon="nami"]').count(),0);
  await game.locator('#summon-pattern').selectOption('all');
  assert.equal(await game.locator('#summon-roster [data-summon="kaido"]').count(),0);
  await game.locator('#summon-roster [data-summon="'+nonteam+'"]').click();
  await selectCell(game,summonPad);
  assert.equal(await game.evaluate(()=>__grandLine.battle.supplies),100,'Selecting an owned summon and pad never spends supplies');
  await game.locator('#cell-apply').click();
  const summoned=await game.evaluate(id=>__grandLine.battle.allies.find(a=>a.characterId===id),nonteam);
  assert.ok(summoned);assert.equal(summoned.padId,summonPad);assert.equal(summoned.level,1);
  assert.equal(await game.evaluate(()=>__grandLine.battle.supplies),100-summoned.summonCost);
  const summonCount=await game.evaluate(()=>__grandLine.battle.allies.length);
  assert.equal(await game.evaluate(({nonteam,summonPad})=>__grandLine.summonCharacter(nonteam,summonPad),{nonteam,summonPad}),false);
  assert.equal(await game.evaluate(pad=>__grandLine.summonCharacter('kaido',pad),summonPad),false);
  assert.equal(await game.evaluate(()=>__grandLine.battle.allies.length),summonCount);
  await game.locator('#defender-buttons [data-ally="'+summoned.id+'"]').click();
  for(const priority of ['strongest','cluster','first']) {
    await game.locator('#defense-priority').selectOption(priority);
    assert.equal(await game.evaluate(id=>__grandLine.battle.allies.find(a=>a.id===id).priority,summoned.id),priority);
  }
  await openAbilities(game);await game.locator('#recall-defender').click();
  assert.equal(await game.evaluate(id=>__grandLine.battle.allies.some(a=>a.id===id),summoned.id),false);
  const afterRecall=await game.evaluate(()=>__grandLine.battle.supplies);
  assert.ok(afterRecall>100-summoned.summonCost&&afterRecall<=100,'Recalling returns only a bounded portion of the paid summon');
  await game.locator('#defender-buttons [data-ally="'+firstDefender.id+'"]').click();
  check('Six dense waves offer owned summons outside the saved crew, explicit supply spending, bounded recall and defender targeting priorities');

  await game.locator('#defense-speed').selectOption('1');
  await game.locator('#start-wave').click();await game.waitForFunction(()=>__grandLine.battle.status==='running');
  assert.equal(await game.locator('#upgrade-defender').isDisabled(),true);
  assert.equal(await game.locator('#recall-defender').isDisabled(),true);
  await game.locator('#defense-priority').selectOption('strongest');
  assert.equal(await game.evaluate(id=>__grandLine.battle.allies.find(a=>a.id===id).priority,firstDefender.id),'strongest');
  await game.waitForFunction(()=>__grandLine.battle.enemies.some(e=>e.hp>0));
  const mover=await game.evaluate(()=>{const e=__grandLine.battle.enemies.find(e=>e.hp>0);e.hp=e.maxHp=1000;return {id:e.id,x:e.x,y:e.y};});
  await game.waitForFunction(before=>{const e=__grandLine.battle.enemies.find(e=>e.id===before.id);return e&&(e.x!==before.x||e.y!==before.y);},mover);
  await game.locator('#defense-pause').click();const paused=await defenseState(game);await frames(host,25);assert.deepEqual(await defenseState(game),paused);
  await game.locator('#defense-speed').selectOption('4');assert.equal(await game.evaluate(()=>__grandLine.settings.battleSpeed),4);
  await frames(host,12);assert.deepEqual(await defenseState(game),paused,'Changing speed does not resume a paused wave');
  await game.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await game.locator('#defense-pause').click();const hidden=await defenseState(game);await frames(host,25);assert.deepEqual(await defenseState(game),hidden);
  await game.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await game.locator('#settings-button').click();const menu=await defenseState(game);await frames(host,25);assert.deepEqual(await defenseState(game),menu);
  await game.locator('#dialog-panel .dialog-close').click();
  await game.waitForFunction(()=>__grandLine.battle.stats.damageDealt>0);
  await game.locator('#map-viewport').scrollIntoViewIfNeeded();await screenshot(host,'desktop-defense-running');
  check('Enemies move naturally; defenders attack; pause, speed, hidden tabs and dialogs gate the simulation');

  await clearWave(game);
  assert.equal(await game.locator('#round-gate').isVisible(),true);
  const round=await game.evaluate(()=>__grandLine.battle.round),statsBefore=await game.evaluate(()=>__grandLine.collection.stats.correctAnswers);
  const gated=await defenseState(game);await frames(host,25);assert.deepEqual(await defenseState(game),gated);
  await game.evaluate(()=>__grandLine.startWave());assert.equal(await game.evaluate(()=>__grandLine.battle.status),'learning');
  await game.locator('#study-button').click();await host.locator('#questions').waitFor({state:'visible'});
  const pending=await game.evaluate(()=>({...__grandLine.learningPending,sessionId:__grandLine.sessionId}));
  await game.evaluate(p=>window.postMessage({type:'GLTCG_ROUND_RESULT',requestId:p.requestId,sessionId:p.sessionId,round:p.round,correct:3,total:3},location.origin),pending);
  await host.evaluate(p=>fake.send({type:'GLTCG_ROUND_RESULT',requestId:'forged',sessionId:p.sessionId,round:p.round,correct:3,total:3}),pending);
  await host.evaluate(p=>fake.send({type:'GLTCG_ROUND_RESULT',requestId:p.requestId,sessionId:p.sessionId,round:p.round,correct:3,total:2}),pending);
  await frames(host,3);assert.equal(await game.evaluate(()=>__grandLine.battle.status),'learning');
  await host.evaluate(()=>{fake.blockSave=true;});
  await answerThree(host);await game.waitForFunction(()=>__grandLine.dialog==='save-progress');
  const unsaved=await defenseState(game);await frames(host,25);assert.deepEqual(await defenseState(game),unsaved);
  await game.evaluate(()=>__grandLine.startWave());assert.notEqual(await game.evaluate(()=>__grandLine.battle.status),'running');
  assert.equal(await game.evaluate(()=>__grandLine.upgradeSelected()),false,'Unacknowledged question progress cannot buy an upgrade');
  await game.locator('#dialog-panel button').press('Escape');assert.equal(await game.evaluate(()=>__grandLine.dialog),'save-progress');
  assert.equal(await host.evaluate(()=>fake.records.length),3);
  await host.evaluate(()=>{fake.blockSave=false;});
  await game.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await game.getByRole('button',{name:'Retry saving',exact:true}).click();await game.waitForFunction(()=>!__grandLine.dialog);
  await frames(host,30);assert.equal(await host.evaluate(()=>fake.records.length),3);
  await game.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await game.locator('#start-wave').waitFor({state:'visible'});assert.equal(await game.locator('#start-wave').isEnabled(),true);
  assert.equal(await game.evaluate(()=>__grandLine.battle.status),'setup');
  assert.equal(await game.evaluate(()=>__grandLine.battle.round),round+1);
  assert.equal(await game.evaluate(()=>__grandLine.battle.spawnTotal),1050);
  const boost=await game.evaluate(()=>__grandLine.battle.learningBoost);
  assert.equal(boost.correct,3);assert.equal(boost.round,round+1);assert.equal(boost.attackMultiplier,1.3);
  assert.ok(Math.abs(boost.critBonus-.15)<1e-10);assert.equal(boost.defenseMultiplier,1.24);
  assert.equal(await game.evaluate(()=>__grandLine.collection.stats.correctAnswers),statsBefore+3);
  assert.match(await game.locator('#learning-boost').textContent(),/Attack \+30%/);
  await host.evaluate(p=>fake.send({type:'GLTCG_ROUND_RESULT',requestId:p.requestId,sessionId:p.sessionId,round:p.round,correct:3,total:3}),pending);await frames(host,3);
  assert.deepEqual(await game.evaluate(()=>__grandLine.battle.learningBoost),boost);
  assert.equal(await game.evaluate(()=>__grandLine.collection.stats.correctAnswers),statsBefore+3);
  assert.equal(await game.evaluate(()=>__grandLine.collection.packs),0);await screenshot(host,'desktop-defense-boost');
  check('Every wave needs exactly three private grades; save failures, hidden-tab saves and forged/replayed results cannot bypass or stack the boost');

  assert.equal(await game.evaluate(()=>__grandLine.battle.trainingPoints),4);
  await game.locator('#defender-buttons [data-ally="'+firstDefender.id+'"]').click();
  const trainingBase=await game.evaluate(id=>{const a=__grandLine.battle.allies.find(a=>a.id===id);return {range:a.range,attack:a.attack,cards:JSON.stringify(__grandLine.collection.cards)};},firstDefender.id);
  await game.locator('#upgrade-defender').click();
  assert.equal(await game.evaluate(()=>__grandLine.battle.trainingPoints),3);
  await game.locator('#upgrade-defender').click();
  assert.equal(await game.evaluate(()=>__grandLine.battle.trainingPoints),1);
  assert.equal(await game.evaluate(id=>__grandLine.battle.allies.find(a=>a.id===id).level,firstDefender.id),3);
  await openAbilities(game);await game.locator('#specialize-reach').click();
  assert.equal(await game.evaluate(id=>__grandLine.battle.allies.find(a=>a.id===id).specialization,firstDefender.id),'reach');
  assert.ok(await game.evaluate(({id,range})=>__grandLine.battle.allies.find(a=>a.id===id).range>range,{id:firstDefender.id,range:trainingBase.range}));
  assert.equal(await game.evaluate(()=>__grandLine.specializeSelected('power')),false);
  assert.equal(await game.locator('#upgrade-defender').isDisabled(),true,'Level three needs three more training points to upgrade');
  assert.equal(await game.evaluate(()=>JSON.stringify(__grandLine.collection.cards)),trainingBase.cards);
  check('Exactly three graded answers award training once; paid battle levels unlock one permanent-in-battle specialization without changing owned card copies');

  await checkWaveEntrances(game);await game.locator('#start-wave').click();await checkWaveEntrances(game,{spawned:true});await clearWave(game);
  assert.equal(await game.evaluate(()=>__grandLine.battle.learningBoost),null);
  await game.locator('#study-button').click();await answerThree(host,0);
  await game.waitForFunction(()=>__grandLine.battle.status==='setup'&&__grandLine.battle.round===3);
  assert.equal(await host.evaluate(()=>fake.records.length),6);
  assert.equal(await game.evaluate(()=>__grandLine.battle.trainingPoints),2,'Three wrong answers still earn the one base training point');
  for(let wave=3;wave<=6;wave++) {
    assert.equal(await game.evaluate(()=>__grandLine.battle.spawnTotal),[800,1050,1300,1600,1900,2300][wave-1]);
    await checkWaveEntrances(game);await game.locator('#start-wave').click();await checkWaveEntrances(game,{spawned:true});await clearWave(game);
    assert.equal(await game.evaluate(()=>__grandLine.battle.round),wave);
    assert.equal(await game.evaluate(()=>__grandLine.collection.unlockedEncounter),1);
    if(wave<6) {
      assert.equal(await game.evaluate(()=>__grandLine.battle.pendingOutcome),null);
      await game.locator('#study-button').click();await answerThree(host);
      await game.waitForFunction(wave=>__grandLine.battle.status==='setup'&&__grandLine.battle.round===wave+1,wave);
      assert.equal(await host.evaluate(()=>fake.records.length),wave*3);
    }
  }
  assert.equal(await game.evaluate(()=>__grandLine.battle.pendingOutcome),'victory');
  assert.equal(await game.evaluate(()=>__grandLine.collection.unlockedEncounter),1);
  await game.locator('#study-button').click();await answerThree(host);
  await game.waitForFunction(()=>__grandLine.battle.status==='victory'&&__grandLine.dialog==='ending');
  assert.equal(await game.evaluate(()=>__grandLine.collection.unlockedEncounter),2);
  assert.equal(await game.evaluate(()=>__grandLine.collection.stats.victories),1);
  assert.equal(await host.evaluate(()=>fake.records.length),18);await screenshot(host,'desktop-defense-victory');
  check('All six waves require three questions each, including wrong answers and the final wave before a stage unlock');

  await game.evaluate(()=>{__grandLine.closeDialog();__grandLine.go('campaign');__grandLine.beginBattle(1);});
  assert.equal(await game.evaluate(()=>__grandLine.battle.trainingPoints),0);
  assert.ok(await game.evaluate(()=>__grandLine.battle.allies.every(a=>a.level===1&&a.specialization===null)),'A new defense starts without battle-only upgrades');
  await game.locator('#start-wave').click();
  await game.evaluate(()=>{__grandLine.battle.ship.hp=0;__grandLine.advanceDefense(__grandLine.battle,.05);__grandLine.renderBattle();});
  await game.waitForFunction(()=>__grandLine.battle.status==='learning');
  assert.equal(await game.evaluate(()=>__grandLine.battle.pendingOutcome),'defeat');
  await game.locator('#study-button').click();await answerThree(host);
  await game.waitForFunction(()=>__grandLine.battle.status==='defeat'&&__grandLine.dialog==='ending');
  assert.equal(await game.evaluate(()=>__grandLine.collection.unlockedEncounter),2);
  assert.equal(await game.evaluate(()=>__grandLine.collection.stats.victories),1);
  assert.equal(await game.evaluate(()=>__grandLine.collection.packs),0);
  assert.equal(await host.evaluate(()=>fake.records.length),21);await screenshot(host,'desktop-defense-defeat');
  check('Ship defeat stops defense, requires its three questions and grants no stage, pack or victory');

  const closedSession=await game.evaluate(()=>__grandLine.sessionId);
  await host.evaluate(sessionId=>fake.send({type:'GLTCG_INVALIDATE',sessionId,message:'The learner changed.'}),closedSession);
  await game.waitForFunction(()=>!__grandLine.ready&&__grandLine.battle===null);
  await game.evaluate(()=>__grandLine.beginBattle(1));assert.equal(await game.evaluate(()=>__grandLine.battle),null);
  assert.equal(await game.evaluate(()=>__grandLine.sessionId),'');
  check('A profile invalidation removes the defense and its authority to start another stage');

  const roster=await page.evaluate(()=>__grandLine.CHARACTERS.map(c=>c.id));
  for(const id of ['shanks','blackbeard','bigmom','kizaru','sengoku','garp','mihawk','hancock','ace','sabo','law','king'])assert.ok(!roster.includes(id));
  for(const id of ['wyper','kaku','wapol','hina','paulie','donkrieg','hatchan','kalifa','bellamy','gin','mr3','kuro'])assert.ok(roster.includes(id));
  await page.locator('[data-view="collection"]').click();await page.locator('.roster-update summary').click();
  assert.equal(await page.locator('#future-characters li').count(),9);
  check('Current collection preserves all twelve replacements and clearly reserves nine future legends alongside six current seven-star editions');
  await page.locator('[data-view="campaign"]').click();await page.locator('#campaign-map button').first().click();
  await page.locator('#defender-buttons [data-ally]').first().click();await openAbilities(page);await page.locator('#defender-skills [data-skill-preview="luffy-2"]').click();
  assert.equal(await page.locator('#defender-skills [data-skill-preview="luffy-2"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#defender-skills [data-skill-preview="luffy-0"]').getAttribute('aria-pressed'),'false');
  await page.evaluate(()=>{const draw=__grandLine.renderer.draw;__grandLine.renderer.draw=(b,now,options)=>{window.lastPreviewSkill=options.previewSkillId;return draw(b,now,options);};});
  await page.waitForFunction(()=>window.lastPreviewSkill==='luffy-2');await screenshot(page,'desktop-radial-skill-preview');
  await page.locator('#defender-skills [data-skill-preview="luffy-0"]').click();
  await page.waitForFunction(()=>window.lastPreviewSkill==='luffy-0');
  check('Skill preview buttons select the actual radial or line attack passed to the battlefield renderer');
  await page.locator('#start-wave').click();await clearWave(page);await page.locator('#study-button').click();
  for(let i=0;i<3;i++) {
    assert.match(await page.locator('.question-count').textContent(),new RegExp('Question '+(i+1)+' of 3.*No platform points awarded'));
    await page.locator('#dialog-panel [data-answer]').first().click();
    await page.getByRole('button',{name:'Check answer',exact:true}).click();
    await page.getByRole('button',{name:i===2?'Return to defense':'Next question',exact:true}).click();
  }
  await page.waitForFunction(()=>__grandLine.battle.status==='setup'&&__grandLine.battle.round===2);
  assert.equal(await page.evaluate(()=>__grandLine.collection.packs),0);
  assert.equal(await page.evaluate(()=>__grandLine.wallet.available),false);
  check('Standalone defense uses exactly three labeled local examples and cannot create platform points or packs');
  if (process.env.GRAND_LINE_REQUIRE_ART === '1') {
    const assets = await page.evaluate(async () => {
      const a = __grandLine.art; await a.ready;
      return Promise.all(__grandLine.CHARACTERS.map(async c => {
        const item = a.load(c.id); await item.promise;
        const metadata = a.metadata.get(c.id);
        return { id: c.id, metadata: !!metadata, file: metadata?.file, source: item.image.currentSrc || item.image.src, expectedSource: metadata?.file ? new URL('./assets/grand-line/' + metadata.file, location.href).href : '', loaded: item.loaded, failed: item.failed, width: item.image.naturalWidth, height: item.image.naturalHeight, bounds: item.bounds };
      }));
    });
    assert.equal(assets.length, 100);
    for (const asset of assets) {
      assert.ok(asset.metadata && asset.loaded && !asset.failed && asset.width >= 1000 && asset.height >= 800 && asset.bounds?.w > 30 && asset.bounds?.h > 30, 'Full card and usable avatar artwork: ' + asset.id);
      assert.equal(asset.source, asset.expectedSource, 'Renderer loads the exact manifest file, including lossless WebP deployments: ' + asset.id);
    }
    check('All 100 original card paintings and battle avatars load with valid metadata and cropped bounds');
  }

  for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['small-phone', { width: 320, height: 740 }], ['landscape', { width: 844, height: 390 }]]) {
    const mobile = await browser.newPage({ viewport, isMobile: true, hasTouch: true }); observe(mobile); await standalone(mobile, 'science'); await noOverflow(mobile); await screenshot(mobile, name + '-collection');
    await mobile.locator('#apex-showcase [data-character="garp7"]').click(); await noOverflow(mobile); await screenshot(mobile, name + '-detail'); await mobile.locator('#dialog-panel .dialog-close').click();
    await mobile.locator('[data-view="crew"]').click();assert.equal(await mobile.locator('#crew-slots .crew-slot').count(),7);await noOverflow(mobile);await screenshot(mobile,name+'-crew');
    await mobile.locator('[data-view="campaign"]').click();await mobile.locator('#campaign-map button').first().click();
    await mobile.waitForFunction(()=>__grandLine.battle?.status==='setup');await noOverflow(mobile);
    await mobile.locator('#defender-buttons [data-ally]').first().tap();
    const originalPad=await mobile.evaluate(()=>__grandLine.battle.allies[0].padId),lastPad=await mobile.evaluate(()=>__grandLine.DEFENSE_DEFAULT_PADS.at(-1));
    await selectCell(mobile,lastPad.id);
    assert.equal(await mobile.evaluate(()=>__grandLine.battle.allies[0].padId),originalPad);
    await mobile.locator('#cell-apply').tap();
    assert.equal(await mobile.evaluate(()=>__grandLine.battle.allies[0].padId),lastPad.id);
    await mobile.locator('#defender-buttons [data-ally]').first().tap();
    await selectCell(mobile,originalPad);await mobile.locator('#cell-apply').tap();
    await mobile.locator('#defender-buttons [data-ally]').first().tap();
    await mobile.locator('#map-viewport').scrollIntoViewIfNeeded();await frames(mobile);
    const canvasBox=await mobile.locator('#battle-canvas').boundingBox();
    assert.ok(canvasBox.width<=viewport.width,'The defense canvas fits the configured viewport');
    const scale=Math.min(canvasBox.width/1120,canvasBox.height/630);
    await mobile.touchscreen.tap(canvasBox.x+(canvasBox.width-1120*scale)/2+lastPad.x*scale,
      canvasBox.y+(canvasBox.height-630*scale)/2+lastPad.y*scale);
    assert.equal(await mobile.locator('#selected-cell').textContent(),lastPad.name,'The touched cell responds at its actual fitted canvas coordinates');
    assert.equal(await mobile.evaluate(()=>__grandLine.battle.allies[0].padId),lastPad.id,'A map tap immediately moves the selected crew member once');
    assert.equal(await mobile.evaluate(()=>__grandLine.battle.supplies),100,'Moving an existing crew member never costs supplies');
    await mobile.locator('#map-zoom').tap();assert.equal(await mobile.locator('#map-zoom').getAttribute('aria-pressed'),'true');
    await mobile.locator('#map-viewport').scrollIntoViewIfNeeded();await frames(mobile,3);
    const pan=await mobile.locator('#map-viewport').evaluate((element,pad)=>{
      const canvas=element.querySelector('canvas');element.scrollLeft=element.scrollWidth-element.clientWidth;
      element.scrollTop=Math.max(0,pad.y/630*canvas.clientHeight-element.clientHeight/2);
      return {left:element.scrollLeft,overflow:element.scrollWidth>element.clientWidth,touch:getComputedStyle(canvas).touchAction};
    },lastPad);
    assert.ok(pan.overflow&&pan.left>0,'Zoomed grid can pan horizontally without widening the page');
    await noOverflow(mobile);
    const zoomBox=await mobile.locator('#battle-canvas').boundingBox(),zoomScale=Math.min(zoomBox.width/1120,zoomBox.height/630);
    await mobile.touchscreen.tap(zoomBox.x+lastPad.x*zoomScale,zoomBox.y+lastPad.y*zoomScale);
    assert.equal(await mobile.locator('#selected-cell').textContent(),lastPad.name,'Panned canvas touch picking preserves grid coordinates');
    await screenshot(mobile,name+'-maze-zoom');await mobile.locator('#map-zoom').tap();
    const recalled=await mobile.evaluate(()=>({id:__grandLine.battle.allies[0].id,characterId:__grandLine.battle.allies[0].characterId}));
    await openAbilities(mobile);await mobile.locator('#recall-defender').tap();assert.equal(await mobile.evaluate(()=>__grandLine.battle.supplies),100);
    await mobile.locator('#summon-toggle').tap();await mobile.locator('#summon-panel').waitFor({state:'visible'});
    await mobile.locator('#summon-search').fill(recalled.characterId);
    await mobile.locator('#summon-roster [data-summon="'+recalled.characterId+'"]').tap();
    await selectCell(mobile,lastPad.id);
    await noOverflow(mobile);await screenshot(mobile,name+'-summon-preview');
    await mobile.locator('#cell-apply').tap();
    assert.equal(await mobile.evaluate(id=>__grandLine.battle.allies.find(a=>a.characterId===id)?.padId,recalled.characterId),lastPad.id);
    await mobile.locator('#defense-priority').selectOption('cluster');
    assert.equal(await mobile.evaluate(id=>__grandLine.battle.allies.find(a=>a.characterId===id).priority,recalled.characterId),'cluster');
    await noOverflow(mobile);
    await screenshot(mobile,name+'-defense-setup');
    await mobile.locator('#map-zoom').tap();
    await mobile.locator('#start-wave').tap();await mobile.waitForFunction(()=>__grandLine.battle.status==='running');
    await mobile.locator('#defense-pause').tap();await noOverflow(mobile);await screenshot(mobile,name+'-defense-running');
    for(const id of ['defense-pause','defense-speed','build-toggle','summon-toggle','map-zoom','grid-column','grid-row','cell-apply'])assert.ok((await mobile.locator('#'+id).boundingBox()).height>=44,'Defense touch controls remain usable: '+id);
    await clearWave(mobile);await mobile.locator('#map-viewport').scrollIntoViewIfNeeded();await frames(mobile,3);
    const gate=await mobile.locator('#study-button').boundingBox(),visibleMap=await mobile.locator('#map-viewport').boundingBox();
    assert.ok(gate.x>=visibleMap.x-1&&gate.x+gate.width<=visibleMap.x+visibleMap.width+1&&gate.y>=visibleMap.y-1&&gate.y+gate.height<=visibleMap.y+visibleMap.height+1,'The three-question button stays fully reachable after a zoomed wave');
    await mobile.locator('#study-button').tap();assert.equal(await mobile.locator('.question-count').count(),1);
    await mobile.close();
  }
  check('Collection, seven-slot crews, direct map taps, keyboard placement, zoom/panning and running defense fit portrait and landscape phones');
  await checkBattlefieldWorkspace();
  await checkPackSelectionReadability();
  await checkCrewStrategyInterface();
  await checkMazeBuilder();
  await checkDirectPlacement();
  await checkTouchPlacement();
  await checkSevenCrew();
  await checkAdministratorShop();
  await checkMultiPackPurchases();
  await checkLegacyPackCapability();
  await checkPaidRosterMigration();
  await checkThreeEntranceInterface();
  if(process.env.GRAND_LINE_REQUIRE_ART==='1')await checkGeneratedDefenseVfx();
  const production = await browser.newPage(); observe(production); await production.goto(base + '/grand-line.html'); await production.locator('#card-grid .tcg-card').first().waitFor();
  assert.equal(await production.evaluate(() => typeof window.__grandLine), 'undefined');
  check('Production pages do not expose the test API');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  await fs.writeFile(path.join(shots, 'results.json'), JSON.stringify({ checks, errors,  screenshots: shots }, null, 2));
  process.stdout.write(`Grand Line browser checks passed: ${checks.length}. Screenshots: ${shots}\n`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
