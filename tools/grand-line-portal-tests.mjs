import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(pw) ? pathToFileURL(pw).href : pw);
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="overflow:auto"><main id="app"><button id="launch">Grand Line</button></main><aside id="already-inert" inert>Other tool</aside><script type="module">
import {installGrandLinePortal} from '/grand-line-portal.js';
import {createGrandLineEconomy,createGrandLineRpgCommit} from '/grand-line-economy.js';
window.user={uid:'private-account',role:'student'};window.level='P6';window.previewLevel='P6';window.child='learner-a';window.notices=[];window.shown=[];window.records=[];window.writes=[];window.riftOpened=0;window.startedLevels=[];window.questionLevels=[];window.snapshotLevels=[];
window.rpg={gold:2000};window.remote=false;window.delayGrade=false;window.failSave=false;window.delaySave=false;
window.makeRows=()=>[1,2,3,4,5].map(i=>({id:'bank-'+i,topic:'Authored question '+i,html:'<p>Compare the <b>labelled table</b>.</p><table><tr><th>Material</th><th>Temperature</th></tr><tr><td>Metal</td><td>15 °C</td></tr></table><p><span class="math-frac"><span class="num">3</span><span class="den">4</span></span> of the sample.</p><script>window.evil=true<\\/script>',options:['Wood','Metal','Air'],answer:1}));
window.rows=makeRows();
const economy=createGrandLineEconomy({getUser:()=>user,getState:()=>rpg,getPacks:()=>[{id:'spark',name:'Bronze Pack',cost:120,odds:{1:40,2:30,3:17,4:8,5:3.5,6:1.2,7:.3}},{id:'nova',name:'Silver Pack',cost:320,bonusOdds:{3:62,4:25,5:9,6:3,7:1}},{id:'galaxy',name:'Gold Pack',cost:750,bonusOdds:{4:68,5:22,6:8,7:2}}],random:()=>0,
 isCurrent:ctx=>portal.isCurrent(ctx),commit:createGrandLineRpgCommit({getUser:()=>user,getState:()=>rpg,setState:s=>{rpg=s;},isCurrent:ctx=>portal.isCurrent(ctx),writeState:async(s,uid)=>{if(delaySave)await new Promise(resolve=>window.finishSave=resolve);if(failSave)throw Error('offline');writes.push({state:structuredClone(s),uid});}})});
window.portal=installGrandLinePortal({subject:new URLSearchParams(location.search).get('subject'),getUser:()=>user,getLevel:()=>level,getPreviewLevel:()=>previewLevel,getProfileKey:()=>child,isLevel:v=>/^P[3-6]$/.test(v||''),notify:m=>notices.push(m),onStart:ctx=>startedLevels.push(ctx.level),
 getRiftFrame:()=>document.querySelector('#rift'),beforeOpen:()=>document.querySelector('#rift')?.remove(),openRift:()=>riftOpened++,
 ...economy,getSnapshot:ctx=>{snapshotLevels.push(ctx.level);return economy.getSnapshot(ctx);},getQuestions:ctx=>{questionLevels.push(ctx.level);return rows.map(q=>remote?{...q,grading:'remote',answer:null}:q);},markShown:q=>shown.push(q.id),recordAnswer:r=>{records.push(r);rpg.gold+=r.correct?10:0;},
 gradeQuestion:async({choice})=>{if(delayGrade)await new Promise(resolve=>window.finishGrade=resolve);return {correct:choice===1,answer:1};}});
document.querySelector('#launch').onclick=()=>portal.open();window.ready=true;
</script></body></html>`;
const childHtml = `<!doctype html><html><body><button id="round">Complete defense wave</button><script>
window.messages=[];window.sessionId='';window.round=1;
window.send=data=>parent.postMessage(data,location.origin);
addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin)return;messages.push(event.data);if(event.data.type==='GLTCG_READY')sessionId=event.data.sessionId;});
document.querySelector('#round').onclick=()=>send({type:'GLTCG_ROUND_REQUEST',sessionId,requestId:'round-'+round,round});
send({type:'GLTCG_HELLO',requestId:'hello-1'});
</script></body></html>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'); res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fixture); }
  if (url.pathname === '/grand-line.html' || url.pathname === '/rift.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(childHtml); }
  if (/^\/(grand-line-(portal|learning-parent|economy|core|data)|pirate-rift-portal)\.js$/.test(url.pathname)) {
    res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(root, path.basename(url.pathname))));
  }
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
const screens = process.env.GRAND_LINE_SCREENSHOTS || path.join(root, 'test-results', 'grand-line'); fs.mkdirSync(screens, { recursive: true });
try {
  for (const subject of ['Math', 'Science']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/?subject=' + subject); await page.waitForFunction(() => window.ready);
    let game;
    const open = async () => {
      await page.locator('#launch').click();
      game = await (await page.locator('.grand-line-stage iframe').elementHandle()).contentFrame();
      await game.waitForFunction(() => window.messages?.some(m => m.type === 'GLTCG_READY'));
      return game.evaluate(() => messages.find(m => m.type === 'GLTCG_READY'));
    };
    const message = async (type, count = 1) => { await game.waitForFunction(({ type, count }) => messages.filter(m => m.type === type).length >= count, { type, count }); return game.evaluate(type => messages.filter(m => m.type === type).at(-1), type); };
    const initial = await open(), url = new URL(await page.locator('iframe').getAttribute('src'));
    assert.equal(initial.questionCount, 3); assert.equal(initial.available, true); assert.match(initial.profileKey, /^p[0-9a-f]{16}$/);
    assert.equal(url.searchParams.get('profile'), initial.profileKey); assert.equal(url.searchParams.get('subject'), subject.toLowerCase()); assert.ok(!url.href.includes('private-account'));
    assert.equal(url.searchParams.get('v'), '3.2.0');
    assert.equal(await page.locator('.grand-line-portal').getAttribute('aria-label'), 'Crew Defense');
    assert.match(await page.locator('.grand-line-stage iframe').getAttribute('title'), /Crew Defense/);
    assert.match(await page.locator('.grand-line-status').textContent(), /three questions after every wave/);
    assert.equal(initial.collection.packs, 0); assert.equal(initial.wallet.balance, 2000);
    assert.equal(await page.locator('#app').evaluate(el => el.inert), true);
    assert.equal(await page.locator('.grand-line-portal select').count(), 0);
    assert.equal(await page.locator('.grand-line-portal [data-start]').count(), 0);
    assert.equal(await page.locator('.grand-line-level').textContent(), 'School level · P6');
    assert.deepEqual(await page.evaluate(() => startedLevels), ['P6']);
    assert.deepEqual(await page.evaluate(() => snapshotLevels), ['P6']);
    const bounds = await page.locator('iframe').boundingBox(); assert.ok(bounds.width <= 390 && bounds.height > 500);
    await page.evaluate(() => {
      const forgedSelect=document.createElement('select');forgedSelect.innerHTML='<option value="P3">P3</option>';
      document.querySelector('.grand-line-portal header').append(forgedSelect);forgedSelect.dispatchEvent(new Event('change',{bubbles:true}));forgedSelect.remove();
      window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window, data: { type: 'GLTCG_HELLO', requestId: 'forged' } }));
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.test', source: portal.getFrame().contentWindow, data: { type: 'GLTCG_HELLO', requestId: 'forged' } }));
    });
    await game.evaluate(() => send({ type:'GLTCG_LEVEL_CHANGE',requestId:'forged-level',sessionId,level:'P3',admin:true }));
    assert.equal(await game.evaluate(() => messages.length), 1);
    assert.deepEqual(await page.evaluate(() => startedLevels), ['P6']);
    assert.deepEqual(initial.admin, { available: false, unlimitedGold: false }); assert.equal(initial.wallet.unlimitedGold, false);
    await game.evaluate(() => send({ type: 'GLTCG_ADMIN_REQUEST', requestId: 'student-forged', sessionId, action: 'unlock-all', admin: true, role: 'admin', cards: { kaido: 999 } }));
    assert.equal((await message('GLTCG_ADMIN_BLOCKED')).retryable, false); assert.equal(await page.evaluate(() => writes.length), 0);
    assert.equal(await page.evaluate(() => rpg.gold), 2000);
    await game.evaluate(() => send({type:'GLTCG_ROUND_REQUEST',requestId:'round-1',sessionId,round:1,level:'P3'})); await page.getByText('Question 1 of 3', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => questionLevels), ['P6']);
    await page.getByText(subject + ' · Wave', { exact: true }).waitFor();
    assert.equal(await page.locator('.grand-line-learning-stem table').count(), 1); assert.equal(await page.locator('.grand-line-learning-stem .math-frac').count(), 1);
    assert.equal(await page.evaluate(() => window.evil), undefined); assert.equal(await page.locator('.grand-line-learning-stem script').count(), 0);
    await page.screenshot({ path: path.join(screens, subject.toLowerCase() + '-learning-mobile.png') });
    for (let i = 1; i <= 3; i++) {
      await page.getByText('Question ' + i + ' of 3', { exact: true }).waitFor(); await page.locator('.grand-line-learning-option').nth(1).click();
      await page.getByRole('button', { name: i === 3 ? 'Complete wave' : 'Next question', exact: true }).click();
    }
    const result = await message('GLTCG_ROUND_RESULT'); assert.equal(result.correct, 3); assert.equal(result.total, 3); assert.equal(result.wallet.balance, 2030);
    assert.deepEqual(await page.evaluate(() => shown), ['bank-1', 'bank-2', 'bank-3']); assert.equal(await page.evaluate(() => records.length), 3);
    assert.ok(!JSON.stringify(await game.evaluate(() => messages)).includes('options'));
    await game.evaluate(() => send({ type: 'GLTCG_ROUND_REQUEST', requestId: 'replay', sessionId, round: 1 })); await message('GLTCG_ROUND_RESULT', 2);
    assert.equal(await page.evaluate(() => records.length), 3);
    await game.evaluate(() => send({ type: 'GLTCG_BUY_REQUEST', requestId: 'buy-one', sessionId, purchaseId: 'purchase-one', packId: 'nova', cost: 0, characterId: 'kaido' }));
    const bought = await message('GLTCG_BUY_RESULT'); assert.equal(bought.wallet.balance, 1710); assert.equal(bought.grant.stars, 3);
    assert.equal(bought.collection.stats.packsOpened, 1); assert.equal(bought.collection.packs, 0); assert.equal(await page.evaluate(() => writes.length), 1);
    await game.evaluate(() => send({ type: 'GLTCG_BUY_REQUEST', requestId: 'buy-retry', sessionId, purchaseId: 'purchase-one', packId: 'nova' }));
    assert.equal((await message('GLTCG_BUY_RESULT', 2)).replayed, true); assert.equal(await page.evaluate(() => writes.length), 1);
    await game.evaluate(() => send({ type: 'GLTCG_SAVE_REQUEST', requestId: 'save', sessionId, team: ['chopper','usopp','nami','zoro','luffy'], progress: { stats: { victories: 1, packsOpened: 900 } }, cards: { kaido: { copies: 900 } }, balance: 9000 }));
    const saved = await message('GLTCG_SAVE_RESULT'); assert.equal(saved.wallet.balance, 1710); assert.equal(saved.collection.stats.packsOpened, 1); assert.equal(saved.collection.cards.kaido, undefined);
    await page.evaluate(() => { rows = makeRows().slice(0, 2); }); await game.evaluate(() => { round = 2; }); await game.locator('#round').click();
    assert.equal((await message('GLTCG_ROUND_BLOCKED')).round, 2); assert.equal(await page.locator('.grand-line-learning-overlay').count(), 0);
    assert.equal(await page.evaluate(() => shown.length), 3);
    await page.evaluate(() => { rows = makeRows(); remote = true; delayGrade = true; }); await game.locator('#round').click();
    await page.locator('.grand-line-learning-option').nth(1).click(); await page.waitForFunction(() => typeof finishGrade === 'function');
    await page.evaluate(() => { child = 'learner-b'; portal.sync(); finishGrade(); });
    assert.equal(await page.locator('.grand-line-learning-overlay').count(), 0); assert.equal(await page.locator('iframe').count(), 0); assert.equal(await page.evaluate(() => records.length), 3);
    assert.equal(await page.locator('#app').evaluate(el => el.inert), false); assert.equal(await page.locator('#already-inert').evaluate(el => el.inert), true);
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'auto'); assert.equal(await page.evaluate(() => document.activeElement.id), 'launch');
    const sibling = await open(); assert.notEqual(sibling.profileKey, initial.profileKey); assert.equal(sibling.collection.stats.packsOpened, 0); assert.equal(sibling.wallet.balance, 1710);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const beforeMigrationWrites = await page.evaluate(() => writes.length);
    await page.evaluate(({ profileKey, collection }) => {
      collection.version = 1; collection.cards.shanks = { copies: 4 }; collection.cards.wyper = { copies: 2 };
      collection.team = ['shanks', 'zoro', 'nami', 'usopp', 'chopper'];
      rpg.grandLine.profiles[profileKey] = { collection, purchases: { 'legacy-paid': { packId: 'galaxy', cost: 750,
        grant: { characterId: 'shanks', copies: 4, stars: 6, duplicate: true } } } };
    }, sibling);
    const migrated = await open();
    assert.equal(migrated.collection.cards.shanks, undefined); assert.equal(migrated.collection.cards.wyper.copies, 6);
    assert.deepEqual(migrated.collection.team, ['wyper', 'zoro', 'nami', 'usopp', 'chopper']);
    await game.evaluate(() => send({ type: 'GLTCG_BUY_REQUEST', requestId: 'legacy-retry', sessionId, purchaseId: 'legacy-paid', packId: 'galaxy' }));
    const legacy = await message('GLTCG_BUY_RESULT');
    assert.equal(legacy.replayed, true); assert.equal(legacy.wallet.balance, 1710);
    assert.equal(legacy.grant.characterId, 'wyper'); assert.equal(legacy.grant.copies, 6); assert.equal(legacy.grant.stars, 4);
    assert.equal(await page.evaluate(() => writes.length), beforeMigrationWrites);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const beforeMissing = await page.evaluate(() => ({writes:writes.length,questions:questionLevels.length,snapshots:snapshotLevels.length,starts:startedLevels.length}));
    for(const missing of ['', 'S9']){
      await page.evaluate(value=>{level=value;portal.open();},missing);
      assert.equal(await page.locator('.grand-line-portal select').count(),0);
      assert.equal(await page.locator('iframe').count(),0);
      assert.match(await page.locator('.grand-line-intro').textContent(),/saved school level is missing or unavailable/);
      assert.match(await page.locator('.grand-line-status').textContent(),/saved school level is required/);
      assert.deepEqual(await page.evaluate(()=>({writes:writes.length,questions:questionLevels.length,snapshots:snapshotLevels.length,starts:startedLevels.length})),beforeMissing);
      await page.getByRole('button',{name:'Close',exact:true}).click();
    }
    await page.evaluate(()=>{level='P4';});
    const updatedStudent=await open();
    assert.equal(await page.locator('.grand-line-level').textContent(),'School level · P4');
    assert.notEqual(updatedStudent.profileKey,sibling.profileKey);
    const beforeLevelChange=await page.evaluate(()=>records.length);
    await page.evaluate(()=>{rows=makeRows();remote=true;delayGrade=true;delete window.finishGrade;});
    await game.locator('#round').click();await page.locator('.grand-line-learning-option').nth(1).click();
    await page.waitForFunction(()=>typeof finishGrade==='function');
    await page.evaluate(()=>{level='P5';finishGrade();});
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(()=>records.length),beforeLevelChange);
    assert.equal(await game.evaluate(()=>messages.some(m=>m.type==='GLTCG_ROUND_RESULT')),false);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    assert.equal(await page.locator('iframe').count(),0);
    assert.equal(await page.locator('.grand-line-portal').count(),0);
    for (const denied of [null, { uid: 'employee', role: 'employee' }, { uid: 'other', role: 'unknown' }, { role: 'student' }]) {
      assert.equal(await page.evaluate(user => { window.user = user; return portal.open(); }, denied), false); assert.equal(await page.locator('iframe').count(), 0);
    }
    await page.evaluate(() => { user = { uid: 'private-admin', role: 'admin' }; rpg = { gold: 0 }; level = ''; portal.open(); });
    assert.equal(await page.locator('.grand-line-portal select').count(),0);
    assert.equal(await page.locator('.grand-line-level').textContent(),'Preview · P6');
    assert.equal(await page.locator('iframe').count(), 1);
    game = await (await page.locator('.grand-line-stage iframe').elementHandle()).contentFrame();
    const adminReady = await message('GLTCG_READY'); assert.deepEqual(adminReady.admin, { available: true, unlimitedGold: false });
    assert.equal(adminReady.wallet.balance, 0);
    await game.evaluate(() => send({ type: 'GLTCG_ADMIN_REQUEST', requestId: 'unlimited-on', sessionId, action: 'set-unlimited-gold', enabled: true, gold: 999999, cards: { kaido: 900 } }));
    const unlimited = await message('GLTCG_ADMIN_RESULT'); assert.equal(unlimited.action, 'set-unlimited-gold');
    assert.equal(unlimited.admin.unlimitedGold, true); assert.equal(unlimited.wallet.unlimitedGold, true); assert.equal(unlimited.wallet.balance, 0);
    assert.equal(unlimited.collection.cards.kaido, undefined);
    let adminPurchases = 0;
    for (const [packId, stars] of [['spark', 1], ['nova', 3], ['galaxy', 4]]) {
      await game.evaluate(packId => send({ type: 'GLTCG_BUY_REQUEST', requestId: 'admin-' + packId, sessionId, purchaseId: 'admin-paid-' + packId, packId }), packId);
      const purchase = await message('GLTCG_BUY_RESULT', ++adminPurchases);
      assert.equal(purchase.wallet.balance, 0); assert.equal(purchase.wallet.unlimitedGold, true); assert.equal(purchase.grant.stars, stars);
      assert.equal(purchase.collection.stats.packsOpened, adminPurchases);
    }
    const beforeAdminReplay = await page.evaluate(() => writes.length);
    await game.evaluate(() => send({ type: 'GLTCG_BUY_REQUEST', requestId: 'admin-galaxy-retry', sessionId, purchaseId: 'admin-paid-galaxy', packId: 'galaxy' }));
    assert.equal((await message('GLTCG_BUY_RESULT', ++adminPurchases)).replayed, true); assert.equal(await page.evaluate(() => writes.length), beforeAdminReplay);
    await game.evaluate(() => send({ type: 'GLTCG_ADMIN_REQUEST', requestId: 'unlock-all', sessionId, action: 'unlock-all' }));
    const unlocked = await message('GLTCG_ADMIN_RESULT', 2); assert.equal(unlocked.action, 'unlock-all');
    assert.equal(Object.keys(unlocked.collection.cards).length, 50); assert.equal(unlocked.wallet.balance, 0);
    assert.deepEqual(unlocked.collection.team, adminReady.collection.team); assert.equal(unlocked.collection.stats.packsOpened, 3);
    for (const id of ['shanks','blackbeard','bigmom','kizaru','sengoku','garp','mihawk','hancock']) assert.equal(unlocked.collection.cards[id], undefined);
    const beforeUnlockReplay = await page.evaluate(() => writes.length);
    await game.evaluate(() => send({ type: 'GLTCG_ADMIN_REQUEST', requestId: 'unlock-retry', sessionId, action: 'unlock-all' }));
    assert.deepEqual((await message('GLTCG_ADMIN_RESULT', 3)).collection.cards, unlocked.collection.cards);
    assert.equal(await page.evaluate(() => writes.length), beforeUnlockReplay);
    await page.evaluate(()=>{level='P5';portal.sync();});
    assert.equal(await page.locator('iframe').count(),0);
    await page.locator('#launch').click();
    assert.equal(await page.locator('.grand-line-level').textContent(),'School level · P5');
    game = await (await page.locator('.grand-line-stage iframe').elementHandle()).contentFrame();
    const otherLevel = await message('GLTCG_READY'); assert.notEqual(otherLevel.profileKey, adminReady.profileKey);
    assert.equal(otherLevel.admin.unlimitedGold, true); assert.equal(Object.keys(otherLevel.collection.cards).length, 5);
    await game.evaluate(() => send({ type: 'GLTCG_ADMIN_REQUEST', requestId: 'unlimited-off', sessionId, action: 'set-unlimited-gold', enabled: false }));
    assert.equal((await message('GLTCG_ADMIN_RESULT')).wallet.unlimitedGold, false);
    await game.evaluate(() => send({ type: 'GLTCG_BUY_REQUEST', requestId: 'normal-cost', sessionId, purchaseId: 'normal-cost', packId: 'spark' }));
    assert.equal((await message('GLTCG_BUY_BLOCKED')).confirmedNoCharge, true); assert.equal(await page.evaluate(() => rpg.gold), 0);
    await page.locator('[data-fullscreen]').evaluate(el => { el.closest('section').requestFullscreen = async () => { throw Error('denied'); }; });
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click(); assert.match(await page.getByRole('status').textContent(), /keep playing/);
    await page.locator('[data-close]').focus(); await page.keyboard.press('Escape'); assert.equal(await page.locator('iframe').count(), 0);
    await page.evaluate(() => { level = 'P6'; portal.open(); });
    game = await (await page.locator('.grand-line-stage iframe').elementHandle()).contentFrame(); await message('GLTCG_READY');
    await page.evaluate(() => { delaySave = true; window.adminReplies = []; const frame = portal.getFrame().contentWindow, post = frame.postMessage.bind(frame); frame.postMessage = (data, ...args) => { adminReplies.push(data); return post(data, ...args); }; });
    await game.evaluate(() => send({ type: 'GLTCG_ADMIN_REQUEST', requestId: 'pending-role-change', sessionId, action: 'set-unlimited-gold', enabled: true }));
    await page.waitForFunction(() => typeof finishSave === 'function');
    await page.evaluate(() => { user = { ...user, role: 'student' }; portal.sync(); delaySave = false; finishSave(); });
    await page.waitForTimeout(50); assert.equal(await page.locator('iframe').count(), 0);
    assert.equal(await page.evaluate(() => adminReplies.some(message => message.type === 'GLTCG_ADMIN_RESULT' || message.type === 'GLTCG_ADMIN_BLOCKED')), false);
    const demoted = await open(); assert.deepEqual(demoted.admin, { available: false, unlimitedGold: false }); assert.equal(demoted.wallet.unlimitedGold, false);
    await game.evaluate(() => send({ type: 'GLTCG_ADMIN_REQUEST', requestId: 'demoted-admin', sessionId, action: 'unlock-all' }));
    assert.equal((await message('GLTCG_ADMIN_BLOCKED')).retryable, false);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(() => { user = { uid: 'private-account', role: 'student' }; level = 'P6'; window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window, data: { type: 'PIRATE_RIFT_OPEN_TCG' } })); });
    assert.equal(await page.locator('iframe').count(), 0);
    await page.evaluate(() => { const frame = document.createElement('iframe'); frame.id = 'rift'; frame.src = '/rift.html'; document.body.append(frame); });
    const rift = await (await page.locator('#rift').elementHandle()).contentFrame(); await rift.waitForFunction(() => typeof send === 'function');
    await rift.evaluate(() => send({ type: 'PIRATE_RIFT_OPEN_TCG' })); await page.locator('.grand-line-stage iframe').waitFor();
    game = await (await page.locator('.grand-line-stage iframe').elementHandle()).contentFrame(); await game.waitForFunction(() => !!sessionId);
    await game.evaluate(() => send({ type: 'GLTCG_OPEN_RIFT' })); await page.waitForFunction(() => riftOpened === 1); assert.equal(await page.locator('.grand-line-portal').count(), 0);
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Grand Line Math/Science browser checks passed: automatic saved school level, no level selector, missing-level blocking, forged-level and live-level guards, real parent rendering, three answers, private grading, wallet purchases/replay, admin zero-balance packs/all 50 cards, role guards, crew saves, mobile access, profile invalidation and companion navigation.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
