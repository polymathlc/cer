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
const ctx={profileKey:'test-profile'}, profile=createCollection();
let state={gold:5000,grandLine:{profiles:{'test-profile':{collection:profile}}}};
const offers=[{id:'spark',name:'Bronze',cost:120,odds:{1:40,2:30,3:17,4:8,5:3.5,6:1.2,7:.3}},{id:'nova',name:'Silver',cost:320,bonusOdds:{3:62,4:25,5:9,6:3,7:1}},{id:'galaxy',name:'Gold',cost:750,bonusOdds:{4:68,5:22,6:8,7:2}}];
window.fake={requests:[],records:[],randomValue:0,questionIndex:0,commits:0,blockPurchase:false,blockSave:false,get state(){return state;}};
const economy=createGrandLineEconomy({getState:()=>state,getPacks:()=>offers,isCurrent:()=>true,random:()=>fake.randomValue,commit:async next=>{state=next;fake.commits++;}});
const frame=document.createElement('iframe');frame.id='game';
const controller=createGrandLineLearningController({origin:location.origin,subject:'Math',getFrame:()=>frame,getIdentity:()=> 'test-identity',getProfileKey:()=>ctx.profileKey,isAllowed:()=>true,isActive:()=>true,makeSessionId:()=> 'test-session',getSnapshot:()=>economy.getSnapshot(ctx),buyPack:(d)=>{if(fake.blockPurchase)throw Object.assign(Error('Test pack unavailable'),{confirmedNoCharge:true});return economy.buyPack(d,ctx);},saveCollection:d=>{if(fake.blockSave)throw Error('Test progress save failure');return economy.saveCollection(d,ctx);},getQuestions:()=>[0,1,2].map(i=>({id:'test-q-'+i,html:'<p>Test question '+(i+1)+'</p>',options:['Wrong','Correct'],answer:1})),recordAnswer:async r=>fake.records.push({correct:r.correct,round:r.round}),presentQuestions:({questions,grade})=>new Promise(resolve=>{const box=document.querySelector('#questions');fake.questionIndex=0;box.hidden=false;function draw(){box.replaceChildren();const p=document.createElement('p');p.id='question-index';p.textContent='Question '+(fake.questionIndex+1)+' of 3';box.append(p);for(let choice=0;choice<2;choice++){const b=document.createElement('button');b.dataset.answer=choice;b.textContent=choice?'Correct':'Wrong';b.onclick=async()=>{b.disabled=true;const result=await grade(fake.questionIndex,choice,1000);if(!result)return;fake.questionIndex++;if(fake.questionIndex===3){box.hidden=true;resolve(true);}else draw();};box.append(b);}}draw();})});
window.addEventListener('message',event=>{if(event.source===frame.contentWindow)fake.requests.push(event.data);controller.handleMessage(event);});
fake.send=data=>frame.contentWindow.postMessage(data,location.origin);
fake.snapshot=()=>economy.getSnapshot(ctx);
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
async function noOverflow(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Page has no horizontal overflow'); }
async function standalone(page, subject = 'math') {
  await page.goto(base + '/grand-line.html?test=1&subject=' + subject);
  await page.waitForFunction(() => window.__grandLine?.ready);
  await page.evaluate(() => { __grandLine.settings.muted = true; });
}
async function stablePlayer(frame) { await frame.waitForFunction(() => __grandLine.battle?.status === 'player' && !document.querySelector('#cast-button').disabled); }
async function forcePlayer(frame, id, { last = false, terminal = false } = {}) {
  await frame.evaluate(({ id, last, terminal }) => {
    const a = __grandLine, b = a.battle, u = b.allies.find(x => x.characterId === id) || b.allies[0];
    b.rng = () => .5; // Keep evasion/critical rolls deterministic in combat fixtures.
    for (const unit of [...b.allies, ...b.enemies]) { unit.hp = unit.maxHp; unit.alive = true; unit.statuses = []; unit.shield = 0; }
    if (terminal) { b.enemies.forEach((x, i) => { x.hp = i ? 0 : 1; x.alive = i === 0; }); }
    b.status = 'player'; b.activeId = u.id; b.turnOrder = last ? [u.id] : [u.id, ...b.allies.filter(x => x !== u).map(x => x.id), ...b.enemies.map(x => x.id)]; b.turnIndex = 0;
    u.energy = u.maxEnergy; u.cooldowns = {}; a.renderBattle();
  }, { id, last, terminal });
  await stablePlayer(frame);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); observe(page); await standalone(page);
  assert.equal(await page.locator('#card-grid .tcg-card').count(), 50);
  assert.equal(await page.locator('#card-grid .tcg-card[data-owned="true"]').count(), 5);
  assert.equal(await page.locator('#apex-showcase .tcg-card[data-stars="7"]').count(), 3);
  assert.equal(await page.evaluate(() => __grandLine.collection.packs), 0);
  const ids = await page.locator('#card-grid .tcg-card').evaluateAll(nodes => nodes.map(n => n.dataset.character));
  for (const id of ids) {
    await page.locator(`#card-grid [data-character="${id}"]`).click();
    assert.equal(await page.locator('#dialog-panel .skill-description').count(), 4, id + ' has three active skills and a passive');
    assert.equal(await page.locator('#dialog-panel .tcg-card').count(), 1);
    await page.keyboard.press('Escape');
  }
  check('All 50 catalog cards open complete three-skill and passive details');
  await page.locator('#star-filter').selectOption('7'); assert.equal(await page.locator('#card-grid .tcg-card').count(), 3);
  await page.locator('#star-filter').selectOption('all'); await page.locator('#ownership-filter').selectOption('owned'); assert.equal(await page.locator('#card-grid .tcg-card').count(), 5);
  await page.locator('#ownership-filter').selectOption('all'); await page.locator('#search-input').fill('Kaido'); assert.equal(await page.locator('#card-grid .tcg-card').count(), 1);
  await page.locator('#search-input').fill(''); await noOverflow(page); await screenshot(page, 'desktop-collection');
  await page.locator('[data-view="crew"]').click(); assert.equal(await page.locator('#crew-slots .crew-slot').count(), 5);
  await page.locator('#crew-slots .text-button').first().click(); await page.locator('#crew-picker [data-character="zoro"]').click();
  assert.match(await page.locator('#toast').textContent(), /already in your crew/); assert.equal(await page.evaluate(() => new Set(__grandLine.collection.team).size), 5);
  assert.equal(await page.locator('#crew-picker [data-character="kaido"]').count(), 0);
  check('Crew has exactly five unique owned characters; duplicate and non-owned choices are blocked');
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
  await game.locator('[data-view="crew"]').click(); await game.locator('#crew-slots .text-button').first().click(); await game.locator(`#crew-picker [data-character="${grants[0]}"]`).click();
  await game.waitForFunction(id => __grandLine.collection.team[0] === id, grants[0]);
  // Crew changes render optimistically; wait for persistence and the child acknowledgement before inspecting the save or navigating.
  await host.waitForFunction(id => fake.state.grandLine.profiles['test-profile'].collection.team[0] === id, grants[0]);
  await game.locator('#toast').filter({ hasText: 'is ready to sail.' }).waitFor({ state: 'visible' });
  assert.equal(await host.evaluate(() => fake.state.grandLine.profiles['test-profile'].collection.team[0]), grants[0]);
  check('An unlocked card can replace a crew slot and persists through the parent');

  await game.locator('[data-view="campaign"]').click(); assert.equal(await game.locator('#campaign-map .encounter').count(), 9);
  assert.equal(await game.locator('#campaign-map button:disabled').count(), 8); await game.locator('#campaign-map button').first().click();
  await stablePlayer(game); await forcePlayer(game, 'zoro');
  const actor = await game.evaluate(() => __grandLine.battle.activeId);
  await game.locator('#skill-buttons button').nth(1).click(); await game.locator('#target-buttons button').first().click();
  const hpBefore = await game.evaluate(() => __grandLine.battle.enemies[0].hp);
  await game.locator('#cast-button').click();
  assert.ok(await game.evaluate(hp => __grandLine.battle.enemies[0].hp < hp, hpBefore));
  assert.ok(await game.evaluate(id => __grandLine.battle.effects.some(e => e.sourceId === id && e.skillId), actor));
  await forcePlayer(game, 'zoro', { last: true }); await game.locator('#defend-button').click();
  await game.waitForFunction(() => __grandLine.battle.status === 'learning');
  assert.equal(await game.locator('#round-gate').isVisible(), true); assert.equal(await game.locator('#cast-button').isDisabled(), true);
  const round = await game.evaluate(() => __grandLine.battle.round);
  const statsBefore = await game.evaluate(() => __grandLine.collection.stats.correctAnswers);
  await game.locator('#study-button').click(); await host.locator('#questions').waitFor({ state: 'visible' });
  const pending = await game.evaluate(() => ({ ...__grandLine.learningPending, sessionId: __grandLine.sessionId }));
  await game.evaluate(p => window.postMessage({ type: 'GLTCG_ROUND_RESULT', requestId: p.requestId, sessionId: p.sessionId, round: p.round, correct: 3, total: 3 }, location.origin), pending);
  await host.evaluate(p => fake.send({ type: 'GLTCG_ROUND_RESULT', requestId: 'forged', sessionId: p.sessionId, round: p.round, correct: 3, total: 3 }), pending);
  await host.evaluate(p => fake.send({ type: 'GLTCG_ROUND_RESULT', requestId: p.requestId, sessionId: p.sessionId, round: p.round, correct: 3, total: 2 }), pending);
  await frames(host, 3); assert.equal(await game.evaluate(() => __grandLine.battle.status), 'learning');
  await host.evaluate(() => { fake.blockSave = true; });
  for (let i = 0; i < 3; i++) {
    assert.match(await host.locator('#question-index').textContent(), new RegExp(`Question ${i + 1} of 3`));
    if (i < 2) assert.equal(await game.evaluate(() => __grandLine.battle.status), 'learning');
    await host.locator('#questions [data-answer="1"]').click();
  }
  await game.waitForFunction(() => __grandLine.dialog === 'save-progress');
  assert.equal(await game.locator('#cast-button').isDisabled(), true);
  await game.locator('#dialog-panel button').press('Escape');
  assert.equal(await game.evaluate(() => __grandLine.dialog), 'save-progress', 'Unsaved grading cannot be dismissed');
  assert.equal(await host.evaluate(() => fake.records.length), 3);
  await host.evaluate(() => { fake.blockSave = false; });
  await game.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await game.waitForFunction(() => !__grandLine.dialog);
  assert.equal(await host.evaluate(() => fake.records.length), 3, 'Save retry does not regrade questions');
  check('Failed battle progress saves keep combat paused and can be retried without repeating grades');
  await game.waitForFunction(previous => __grandLine.battle.round === previous + 1, round);
  assert.equal(await game.evaluate(() => __grandLine.collection.stats.correctAnswers), statsBefore + 3);
  const boost = await game.evaluate(() => __grandLine.battle.learningBoost);
  assert.equal(boost.correct, 3); assert.equal(boost.round, round + 1);
  assert.equal(boost.attackMultiplier, 1.3); assert.ok(Math.abs(boost.critBonus - .15) < 1e-10); assert.equal(boost.defenseMultiplier, 1.24);
  const boostText = await game.locator('#learning-boost').textContent();
  assert.match(boostText, /3\/3 CORRECT/); assert.match(boostText, /Attack \+30%/); assert.match(boostText, /Critical chance \+15 percentage points/); assert.match(boostText, /Defense \+24%/);
  await screenshot(host, 'desktop-learning-boost');
  assert.equal(await game.evaluate(() => __grandLine.collection.packs), 0);
  assert.equal(await host.evaluate(() => fake.records.length), 3);
  await host.evaluate(p => fake.send({ type: 'GLTCG_ROUND_RESULT', requestId: p.requestId, sessionId: p.sessionId, round: p.round, correct: 3, total: 3 }), pending); await frames(host, 3);
  assert.equal(await game.evaluate(() => __grandLine.collection.stats.correctAnswers), statsBefore + 3);
  assert.deepEqual(await game.evaluate(() => __grandLine.battle.learningBoost), boost, 'A replay cannot stack combat bonuses');
  check('Real skill and defend controls work; every full round waits for three parent-graded answers and rejects forgeries/replays');
  await forcePlayer(game, 'zoro', { last: true, terminal: true }); await game.locator('#cast-button').click(); await game.waitForFunction(() => __grandLine.battle.status === 'learning');
  assert.equal(await game.evaluate(() => __grandLine.battle.pendingOutcome), 'victory');
  assert.equal(await game.evaluate(() => __grandLine.battle.learningBoost), null, 'Combat bonuses expire at the next question gate');
  assert.equal(await game.evaluate(() => __grandLine.collection.unlockedEncounter), 1);
  await game.locator('#study-button').click(); for (let i = 0; i < 3; i++) { await host.locator('#questions [data-answer="1"]').click(); }
  await game.waitForFunction(() => __grandLine.battle.status === 'victory' && __grandLine.dialog === 'ending');
  assert.equal(await game.evaluate(() => __grandLine.collection.unlockedEncounter), 2); await screenshot(host, 'desktop-victory');
  check('The final battle round also requires three graded answers before victory and campaign unlock');

  await page.locator('[data-view="campaign"]').click(); await page.locator('#campaign-map button').first().click(); await stablePlayer(page);
  const effects = await page.evaluate(async () => {
    const core = await import('/grand-line-core.js'); const api = __grandLine, drawn = [];
    for (const c of core.CHARACTERS) for (const skill of c.skills) {
      const collection = core.createCollection(); core.addCard(collection, c.id); collection.team = [c.id, ...core.STARTER_IDS.filter(id => id !== c.id)].slice(0, 5);
      const b = core.createBattle(collection, { seed: 82 }); const actor = b.allies.find(u => u.characterId === c.id);
      b.status = 'player'; b.activeId = actor.id; b.turnOrder = [actor.id, ...b.enemies.map(u => u.id)]; b.turnIndex = 0; actor.energy = 100;
      if (skill.target === 'fallen-ally') { b.allies[1].hp = 0; b.allies[1].alive = false; }
      for (const e of b.enemies) { e.hp = e.maxHp = 10000; e.shield = 100; }
      const targets = core.getValidTargets(b, skill.id); if (!core.act(b, skill.id, targets[0]?.id)) throw Error('Could not execute ' + skill.id);
      const primary = b.effects.find(e => e.skillId === skill.id); if (!primary) throw Error('No animation for ' + skill.id);
      b.id += '-' + skill.id; api.renderer.draw(b, performance.now(), { selectedTarget: targets[0]?.id }); api.renderer.draw(b, performance.now() + 450, {}); drawn.push(primary.animation);
    }
    return drawn;
  });
  assert.equal(effects.length, 150); assert.equal(new Set(effects).size, 150);
  check('All 150 distinct active abilities execute and render their canvas effects without an error');
  if (process.env.GRAND_LINE_REQUIRE_ART === '1') {
    const assets = await page.evaluate(async () => {
      const a = __grandLine.art; await a.ready;
      return Promise.all(__grandLine.CHARACTERS.map(async c => {
        const item = a.load(c.id); await item.promise;
        const metadata = a.metadata.get(c.id);
        return { id: c.id, metadata: !!metadata, file: metadata?.file, source: item.image.currentSrc || item.image.src, expectedSource: metadata?.file ? new URL('./assets/grand-line/' + metadata.file, location.href).href : '', loaded: item.loaded, failed: item.failed, width: item.image.naturalWidth, height: item.image.naturalHeight, bounds: item.bounds };
      }));
    });
    assert.equal(assets.length, 50);
    for (const asset of assets) {
      assert.ok(asset.metadata && asset.loaded && !asset.failed && asset.width >= 1000 && asset.height >= 800 && asset.bounds?.w > 30 && asset.bounds?.h > 30, 'Full card and usable avatar artwork: ' + asset.id);
      assert.equal(asset.source, asset.expectedSource, 'Renderer loads the exact manifest file, including lossless WebP deployments: ' + asset.id);
    }
    check('All 50 original card paintings and battle avatars load with valid metadata and cropped bounds');
  }

  for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['small-phone', { width: 320, height: 740 }], ['landscape', { width: 844, height: 390 }]]) {
    const mobile = await browser.newPage({ viewport, isMobile: true, hasTouch: true }); observe(mobile); await standalone(mobile, 'science'); await noOverflow(mobile); await screenshot(mobile, name + '-collection');
    await mobile.locator('#apex-showcase [data-character="kaido"]').click(); await noOverflow(mobile); await screenshot(mobile, name + '-detail'); await mobile.locator('#dialog-panel .dialog-close').click();
    await mobile.locator('[data-view="campaign"]').click(); await mobile.locator('#campaign-map button').first().click(); await stablePlayer(mobile); await noOverflow(mobile);
    await mobile.locator('#skill-buttons button').first().click(); await mobile.locator('#target-buttons button').first().click(); await mobile.locator('#cast-button').click(); await screenshot(mobile, name + '-battle');
    await mobile.close();
  }
  check('Collection, full card details, targeting, and battle controls fit portrait and landscape phones');
  const production = await browser.newPage(); observe(production); await production.goto(base + '/grand-line.html'); await production.locator('#card-grid .tcg-card').first().waitFor();
  assert.equal(await production.evaluate(() => typeof window.__grandLine), 'undefined');
  check('Production pages do not expose the test API');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  await fs.writeFile(path.join(shots, 'results.json'), JSON.stringify({ checks, errors, abilityAnimations: effects.length, screenshots: shots }, null, 2));
  process.stdout.write(`Grand Line browser checks passed: ${checks.length}. Screenshots: ${shots}\n`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
