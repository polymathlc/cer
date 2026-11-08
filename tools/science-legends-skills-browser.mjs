// Exercise every shipped skill and ultimate through the real update and renderer.
// Only the surrounding portal and its question/credit metadata are fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
async function openGame({ width = 1280, touch = false, failArt = false, reduced = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'legends-skills.test') return route.abort();
    if (failArt && url.pathname.includes('/assets/science-legends/')) return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style><iframe src="/science-legends.html"></iframe><script>
      window.addEventListener('message',e=>{
        if(e.source!==document.querySelector('iframe').contentWindow)return;
        if(e.data.type==='SD_REQUEST_QUESTIONS')e.source.postMessage({type:'SD_QUESTIONS',feedPolicyVersion:1,requestId:e.data.requestId,studentKey:'skill-test',studentLevel:'P4',playsLeft:{legends:10},questions:[{id:'glass',q:'Which material lets light pass through?',options:['Clear glass','Wood'],answer:0,topic:'Light'}]},location.origin);
        if(e.data.type==='LEGENDS_REQUEST_META')e.source.postMessage({type:'LEGENDS_META',meta:{inv:[],eq:{},loadout:{},pts:0},gold:0},location.origin);
      });</script>` });
    const filename = path.join(root, url.pathname);
    return fs.existsSync(filename) ? route.fulfill({ path: filename }) : route.abort();
  });
  await page.goto('http://legends-skills.test/');
  const game = page.frames().find(frame => frame.url().includes('science-legends.html'));
  await game.waitForFunction(() => typeof _gameCreditsReady === 'function' && _gameCreditsReady());
  return { context, page, game, errors };
}
try {
  const desktop = await openGame();
  await desktop.game.locator('#startBtn').click();
  await desktop.game.waitForFunction(() => G && G.state === 'play' && LegendsArt.ready());
  const counts = await desktop.game.evaluate(() => {
    const counts = {};
    for (const cls of CLASS_ORDER) {
      counts[cls] = 0;
      for (const sid of CLASSES[cls].skills) for (let ultimate = 0; ultimate <= 3; ultimate++) {
        try {
          newGame(cls);
          G.spawnT = 999;
          G.slots = [sid, null, null, null];
          G.stats.unlocked[sid] = true;
          G.stats.rank[sid] = 5;
          G.stats.mods[sid + '.e1'] = true;
          G.stats.mods[sid + '.e2'] = true;
          G.stats.ult[sid] = ultimate;
          G.player.hp = G.player.maxHp;
          for (let i = 0; i < 8; i++) {
            const enemy = spawnEnemy('brute', false);
            enemy.x = G.player.x + 45 + i * 30;
            enemy.y = G.player.y + (i % 3 - 1) * 22;
            enemy.hp = enemy.maxHp = 1e7;
            enemy.speed = enemy.dmg = 0;
          }
          mouse.active = true; mouse.sx = 600; mouse.sy = 400;
          mouse.wx = G.player.x + 160; mouse.wy = G.player.y;
          castSkill(0);
          if (!(G.cds[sid] > 0)) throw new Error('Skill did not start');
          for (let frame = 0; frame < 180; frame++) {
            update(1 / 120);
            if (frame % 60 === 0) draw();
          }
          const actors = [G.player, ...G.enemies, ...G.pets, ...G.projs, ...G.eprojs];
          if (!actors.every(actor => Number.isFinite(actor.x) && Number.isFinite(actor.y))) throw new Error('Non-finite actor position');
          if (G.impacts.length > 48 || G.projs.some(projectile => projectile.trail && projectile.trail.length > 9)) throw new Error('Unbounded combat effect');
          counts[cls]++;
        } catch (error) { throw new Error(cls + '/' + sid + '/ultimate-' + ultimate + ': ' + error.message); }
      }
    }
    return counts;
  });
  check(Object.keys(counts).length === 5 && Object.values(counts).every(count => count === 48), 'All 60 skills and their three ultimate variants simulate and render with finite positions and bounded effects');
  check(desktop.errors.length === 0, `No desktop browser errors: ${desktop.errors.join(', ')}`);
  await desktop.context.close();
  for (const width of [320, 390]) {
    const mobile = await openGame({ width, touch: true, failArt: width === 320, reduced: true });
    check(await mobile.game.evaluate(() => lowMotion), `${width}px: system reduced motion is honored`);
    check(await mobile.game.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: menu has no horizontal overflow`);
    await mobile.game.locator('#startBtn').tap();
    await mobile.game.waitForFunction(() => G && G.time > .1);
    check(await mobile.game.evaluate(() => ['joy', 'evadeBtn', 'skillBar', 'skillSelBtn', 'pBars'].every(id => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1;
    })), `${width}px: touch controls fit the viewport`);
    await mobile.game.evaluate(() => {
      const enemy = spawnEnemy('brute', false);
      enemy.x = G.player.x + 50; enemy.y = G.player.y;
      enemy.hp = enemy.maxHp = 1000;
      dealDamage(enemy, 50, { crit: true, color: '#FF8800' });
      G.projs.push({ kind: 'fire', sid: 'fireball', x: G.player.x, y: G.player.y, vx: 500, vy: 0, r: 9, dmg: 25, life: 1, radius: 100 });
      for (let i = 0; i < 10; i++) { update(1 / 120); draw(); }
    });
    check(await mobile.game.evaluate(() => !G.hitStop && G.projs.every(projectile => !projectile.trail || !projectile.trail.length)), `${width}px: reduced-motion hits omit hitstop and projectile trails`);
    if (width === 320) check(await mobile.game.evaluate(() => !LegendsArt.ready()), 'Missing generated art leaves the vector combat renderer usable');
    check(mobile.errors.length === 0, `${width}px: combat has no browser errors when art ${width === 320 ? 'fails' : 'loads'}: ${mobile.errors.join(', ')}`);
    await mobile.context.close();
  }
  console.log(`${checks} Legends stress checks passed; exercised 240 skill/ultimate combinations.`);
} finally { await browser.close(); }
