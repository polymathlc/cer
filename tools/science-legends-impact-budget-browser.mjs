// Verify live sustained-hit timing against frames the game actually admits.
// The clock intentionally caps a host frame/backlog at100ms. Wall-clock ratios
// alone conflate that safety policy with hit-stop when a CI render/GC stalls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.GAME_SCREENSHOTS || path.join(root, 'test-results/legends-impact-budget');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'legends-impact.test') return route.abort();
    const file = path.join(root, decodeURIComponent(url.pathname));
    return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.abort();
  });
  await page.goto('http://legends-impact.test/science-legends.html');
  await page.waitForFunction(() => LegendsModels.allReady());
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => G && G.time > .05);
  const result = await page.evaluate(async () => {
    const rows = [];
    const realAdvance=LegendsCombat.advance,realImpact=combatImpact;
    for (const scenario of [{name:'normal',reduced:false},{name:'reduced',reduced:true},{name:'host-stall',reduced:false,stall:true},{name:'legacy-negative-control',reduced:false,legacy:true}]) {
      newGame('barb'); hide('menuOverlay'); lowMotion = scenario.reduced;muted=true;
      G.enemies = []; G.pets = []; G.spawnT = 999; G.qTimer = -1000;
      G.player.hp = G.player.maxHp = 1e8; G.stats.crit = 1; G.stats.rank.whirlwind = 5;
      G.stats.unlocked.whirlwind = true; G.slots = ['whirlwind'];
      const p = G.player;
      for (let i = 0; i < 30; i++) { const e = spawnEnemy('brute', false), angle = i * 2.3999; Object.assign(e, { x: p.x + Math.cos(angle) * 80, y: p.y + Math.sin(angle) * 80, hp: 1e8, maxHp: 1e8, speed: 0, dmg: 0, stun: 100 }); }
      G.cds = {}; castSkill(0);
      const run=G,start=performance.now(),before=G.time,initialAccumulator=G.accumulator||0;
      const trace={frames:0,rawElapsed:0,clampedElapsed:0,backlogDiscarded:0,hostFrameDiscarded:0,stopRequests:0,continuousStopRequests:0,continuousHits:0};
      LegendsCombat.advance=function(clock,elapsed,active,update){
        if(clock===run&&active){
          const admitted=Math.max(0,Math.min(.1,Number.isFinite(elapsed)?elapsed:0));
          trace.frames++;trace.rawElapsed+=elapsed;trace.clampedElapsed+=admitted;
          trace.hostFrameDiscarded+=Math.max(0,elapsed-admitted);
          // Account for the documented100ms backlog cap, independently of any
          // hit-stop. This is admission policy, never time lost to combat FX.
          trace.backlogDiscarded+=Math.max(0,(clock.accumulator||0)+admitted-.1);
        }
        return realAdvance.call(this,clock,elapsed,active,update);
      };
      window.combatImpact=function(enemy,amount,options){
        if(G!==run)return realImpact.apply(this,arguments);
        const continuous=!!options.continuous;if(continuous)trace.continuousHits++;
        const beforeStop=G.hitStop||0;
        // A deliberate old-behavior control must fail the same budget gate:
        // repeated channel ticks request35ms stops instead of remaining live.
        if(scenario.legacy&&options.continuous){G.impactCooldown=0;options={...options,continuous:false};}
        const value=realImpact.call(this,enemy,amount,options);
        if((G.hitStop||0)>beforeStop+1e-9){trace.stopRequests++;if(continuous)trace.continuousStopRequests++;}
        return value;
      };
      let stallTimer;
      if(scenario.stall)stallTimer=setTimeout(()=>{const until=performance.now()+300;while(performance.now()<until){}},750);
      try{await new Promise(resolve=>setTimeout(resolve,2500));}
      finally{clearTimeout(stallTimer);LegendsCombat.advance=realAdvance;window.combatImpact=realImpact;}
      const wall=(performance.now()-start)/1000,simulation=G.time-before;
      const admitted=trace.clampedElapsed-trace.backlogDiscarded+initialAccumulator-(G.accumulator||0);
      rows.push({scenario:scenario.name,reduced:scenario.reduced,wall,simulation,wallRatio:simulation/wall,admitted,ratio:simulation/admitted,trace,damagedFoes:G.enemies.filter(e=>e.hp<e.maxHp).length});
    }
    return rows;
  });
  fs.writeFileSync(path.join(output, 'impact-clock.json'), JSON.stringify(result, null, 2));
  for (const row of result) {
    check(row.damagedFoes === 30&&row.trace.continuousHits>=30&&row.admitted>1, `${row.scenario}: live sustained critical Whirlwind exercises all30foes and enough admitted frame time`);
    if(row.scenario!=='legacy-negative-control'){
      check(row.ratio>=.95&&row.ratio<=1.001,`${row.scenario}: sustained combat preserves at least95%of admitted simulation time (${row.ratio.toFixed(4)}; raw wall ratio${row.wallRatio.toFixed(4)})`);
      check(row.trace.continuousStopRequests===0,`${row.scenario}: nonlethal continuous hits never request dramatic hit-stop; basic critical hits retain their bounded impact`);
    }
  }
  check(Math.abs(result[0].ratio-result[1].ratio)<.04,'normal and reduced motion differ only within the intentional dramatic-impact budget');
  const stalled=result.find(r=>r.scenario==='host-stall'),legacy=result.find(r=>r.scenario==='legacy-negative-control');
  check(stalled.trace.hostFrameDiscarded>.1&&stalled.wallRatio<.95,'intentional300ms host stall reproduces the old wall-threshold failure without a hit-stop regression');
  check(legacy.ratio<.9&&legacy.trace.stopRequests>5,'the old repeated-hit-stop behavior still fails this admitted-time gate decisively');
  check(errors.length === 0, 'impact-budget scenario leaves no browser errors: ' + errors.join(', '));
  console.log(JSON.stringify(result));
  console.log(`Science Legends impact budget browser: ${checks} checks passed`);
} finally { await browser.close(); }
