import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pw = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(pw) ? pathToFileURL(pw).href : pw);
const fixture = `<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style>
<iframe id="game" src="/hades-game.html?learning=1&subject=science"></iframe><script type="module">
import { installHadesLearningParent } from '/hades-learning-parent.js';
window.records=[];window.bridge=installHadesLearningParent({subject:'Science',getFrame:()=>document.getElementById('game'),getIdentity:()=> 'isolated:P6',isAllowed:()=>true,isActive:()=>true,
 getQuestions:async()=>Array.from({length:5},(_,i)=>({id:'q'+i,html:'<p>Which answer is correct?</p>',options:['Wrong','Correct'],answer:1})),recordAnswer:r=>records.push(r)});window.ready=true;
</script>`;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') { res.setHeader('Content-Type', mime['.html']); res.end(fixture); return; }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !mime[path.extname(file)]) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', mime[path.extname(file)]); res.end(await fs.readFile(file)); }
  catch (_) { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
const errors = [];
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://fonts.**', route => route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => window.ready);
  let game = page.frames().find(frame => frame.url().includes('/hades-game.html'));
  await game.waitForFunction(() => gameRuntime.ready);
  await game.locator('#runtime-start').click();
  await game.waitForFunction(() => hadesLearning.state === 'ready' && gameRuntime.started);
  async function checkpoint(chamber) {
    await game.evaluate(chamber => {
      gameState.isPaused = true; player.hp = 100; player.maxHp = 100;
      player.iFrames = 100000; player.defianceCount = 9;
      continueThroughHadesGate({ type: 'heart' }, chamber);
    }, chamber);
    await page.getByRole('dialog').waitFor();
  }
  async function grade(index, correct, expectedStreak, fatal = false) {
    await game.evaluate(() => { player.hp = player.maxHp; });
    await page.locator('.hades-learning-option').nth(correct ? 1 : 0).click();
    await game.waitForFunction(streak => hadesLearning.pressure.wrongStreak === streak, expectedStreak);
    const state = await game.evaluate(() => ({ hp: player.hp, maxHp: player.maxHp, defiance: player.defianceCount, pending: !!hadesLearning.pending }));
    const rate = [0, 8, 16, 28, 45, 100][expectedStreak];
    assert.equal(state.hp, correct ? state.maxHp : fatal ? 0 : state.maxHp - Math.ceil(state.maxHp * rate / 100)); checks++;
    assert.equal(state.defiance, 9); checks++;
    if (fatal) {
      assert.equal(state.pending, false); checks++;
      await page.waitForFunction(() => !document.querySelector('.hades-learning-overlay'));
      await game.locator('#gameover-modal').waitFor({ state: 'visible' });
      assert.match(await game.locator('#gameover-title').textContent(), /NO ESCAPE/); checks++;
      return;
    }
    if (correct && expectedStreak === 0) assert.match(await page.locator('.hades-learning-pressure').textContent(), /streak reset/);
    else assert.match(await page.locator('.hades-learning-pressure').textContent(), new RegExp('streak ' + expectedStreak + '/5'));
    checks++;
    await page.getByRole('button', { name: index === 4 ? 'Claim sanctuary reward' : 'Next question', exact: true }).click();
  }
  await checkpoint(2);
  await grade(0, false, 1); await grade(1, false, 2); await grade(2, true, 0);
  await grade(3, false, 1); await grade(4, false, 2);
  await game.waitForFunction(() => hadesLearning.state === 'ready' && gameState.chamber === 2);
  await checkpoint(3);
  await grade(0, false, 3); await grade(1, false, 4); await grade(2, false, 5, true);
  assert.equal(await page.evaluate(() => records.length), 8); checks++;
  assert.equal(await game.evaluate(() => gameState.chamber), 2); checks++;
  const outcome = await game.evaluate(() => ({ hp: player.hp, state: hadesLearning.state, epoch: hadesLearning.rewardEpoch }));
  await game.evaluate(() => receiveLearningMessage({ source: parent, origin: location.origin, data: { type: 'HADES_ROUND_RESULT', requestId: 'stale', sessionId: hadesLearning.sessionId, round: 2, correct: 5, total: 5, healPercent: 40, boonTier: 'heroic' } }));
  assert.deepEqual(await game.evaluate(() => ({ hp: player.hp, state: hadesLearning.state, epoch: hadesLearning.rewardEpoch })), outcome); checks++;
  // Leaving a partially answered checkpoint cannot reset the run's pressure.
  await page.reload(); await page.waitForFunction(() => window.ready);
  game = page.frames().find(frame => frame.url().includes('/hades-game.html'));
  await game.waitForFunction(() => gameRuntime.ready); await game.locator('#runtime-start').click();
  await game.waitForFunction(() => hadesLearning.state === 'ready' && gameRuntime.started);
  assert.equal(await game.evaluate(() => hadesLearning.pressure.wrongStreak), 0); checks++;
  await checkpoint(2); await grade(0, false, 1); await grade(1, false, 2);
  await page.getByRole('button', { name: 'Return to game', exact: true }).click();
  await game.waitForFunction(() => hadesLearning.state === 'blocked');
  assert.equal(await game.evaluate(() => hadesLearning.pressure.wrongStreak), 2); checks++;
  await game.locator('#learning-retry').click(); await page.getByRole('dialog').waitFor();
  await grade(0, false, 3); await grade(1, false, 4); await grade(2, false, 5, true);
  assert.equal(await page.evaluate(() => records.length), 5); checks++;
  assert.deepEqual(errors, []); checks++;
  console.log('RPG question pressure browser: ' + checks + ' checks passed with actual Hades artifact and real parent grading.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
