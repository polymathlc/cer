// Real shipped menu, generated assets, renderer and engine; no account or network writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.GAME_SCREENSHOTS || path.join(root, 'test-results/legends-premium');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
async function open(width, failArt = false) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], missing = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'legends.test') return route.abort();
    if (failArt && /(?:arcane-atlas|courtyard-slate|skill-icons)\.(?:png|webp)$/.test(url.pathname)) return route.abort();
    const filename = path.join(root, decodeURIComponent(url.pathname));
    if (!fs.existsSync(filename)) { missing.push(url.pathname); return route.abort(); }
    return route.fulfill({ path: filename });
  });
  await page.goto('http://legends.test/science-legends.html');
  await page.waitForFunction(() => typeof LegendsArt !== 'undefined' && document.querySelectorAll('.class-card').length === 5);
  return { context, page, errors, missing };
}
try {
  for (const width of [1280, 390, 320]) {
    const { context, page, errors, missing } = await open(width);
    await page.waitForFunction(() => LegendsArt.ready() && LegendsArt.groundReady());
    check(await page.locator('#menuOverlay .panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${width}: menu fits without horizontal overflow`);
    check(await page.locator('#startBtn').isVisible(), `${width}: sticky launch action is visible`);
    const backgroundReady = await page.evaluate(async () => {
      const img = new Image(); img.src = 'assets/science-legends/expedition-cover.png'; await img.decode(); return img.naturalWidth > 1000;
    });
    check(backgroundReady, `${width}: generated cover loads`);
    await page.locator('.legends-guide summary').click();
    check(await page.locator('.how li').first().evaluate(el => getComputedStyle(el).display === 'block'), `${width}: instructions retain flowing inline emphasis`);
    await page.locator('.legends-guide summary').click();
    await page.screenshot({ path: path.join(output, `legends-menu-${width}.png`) });
    check(!/0 suitable/.test(await page.locator('#menuFoot').innerText()), `${width}: stream status never pretends one payload is the entire bank`);
    await page.locator('.class-card').nth(1).click();
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => G && G.time > .05);
    await page.waitForFunction(()=>LegendsIcons.ready());
    check(await page.locator('#skillBar .icon-art').first().evaluate(el=>getComputedStyle(el).display==='block'&&getComputedStyle(el).backgroundImage.includes('skill-icons.webp')),`${width}: generated skill icons actually paint on the combat bar`);
    check(await page.locator('#skillBar .skill-slot').first().evaluate(el=>el.tagName==='BUTTON'&&el.getAttribute('aria-label').includes('Fireball')),`${width}: named skill controls work as native keyboard buttons`);
    check(await page.evaluate(()=>{G.cds[G.slots[0]]=2.5;updateSkillCds();return $('skillBar').querySelector('.cd-value').textContent==='3'&&getComputedStyle($('skillBar').querySelector('.cd-value')).transform==='none'&&$('skillBar').querySelector('.cd-shade').style.transform.includes('scaleY');}),`${width}: numeric cooldown remains legible while only its progress shade scales`);
    check(await page.evaluate(() => G.cls === 'sorc'), `${width}: selected hero starts a real run`);
    const rendered = await page.evaluate(() => {
      G.enemies = []; G.pets = []; G.spawnT = 999;
      const p = G.player;
      const e = spawnEnemy('slime', false); e.x = p.x + 95; e.y = p.y; e.speed = 0; e.hp = e.maxHp = 10000;
      const back=spawnEnemy('imp',false),front=spawnEnemy('imp',false);
      back.x=front.x=p.x;back.y=p.y-50;front.y=p.y+50;back.speed=front.speed=0;
      draw();const depth=G.renderOrder.indexOf(back)<G.renderOrder.indexOf(p)&&G.renderOrder.indexOf(p)<G.renderOrder.indexOf(front);
      G.projs.push({ kind:'fire', sid:'fireball', x:p.x + 40, y:p.y, vx:420, vy:0, r:10, dmg:100, radius:100, life:1, pierce:0 });
      combatImpact(e, 100, { crit:true, color:'#FF8A65', impactX:1, impactY:0 });
      const target = document.createElement('canvas'); target.width=400;target.height=150;
      const g = target.getContext('2d');
      const fire = LegendsArt.drawProjectile(g, {x:70,y:70,vx:1,vy:0,sid:'fireball'}, 'fireorb');
      const ice = LegendsArt.drawProjectile(g, {x:160,y:70,vx:1,vy:0}, 'shard');
      const hit = LegendsArt.drawImpact(g, {x:250,y:70,ang:0,r:34,strong:true,color:'#FF8A65'}, .2);
      const hammer = LegendsArt.drawHammer(g, {x:330,y:70}, 0);
      const pixels = g.getImageData(0,0,400,150).data;
      return { handled:fire&&ice&&hit&&hammer, painted:pixels.some((v,i)=>i%4===3&&v>0), ground:LegendsArt.drawGround(g,0,0,400,150),depth };
    });
    check(rendered.handled && rendered.painted, `${width}: generated projectiles, impacts and hammers actually paint pixels`);
    check(rendered.ground, `${width}: generated ground texture renders through its cached pattern`);
    check(rendered.depth, `${width}: actual renderer layers rear enemy, hero and front enemy by ground feet`);
    await page.waitForFunction(() => G.projs.length === 0 && G.enemies[0]?.hp < 10000);
    check(await page.evaluate(() => G.impacts.length <= 48), `${width}: real explosion resolves with bounded impact effects`);
    await page.evaluate(() => { G.player.hp=G.player.maxHp; G.qTimer=0; draw(); });
    await page.screenshot({ path: path.join(output, `legends-combat-${width}.png`) });
    await page.keyboard.press('t');await page.locator('#treeOverlay').waitFor({state:'visible'});
    const points=await page.evaluate(()=>G.points);await page.locator('#treeBoard .tnode').first().click();
    check(await page.evaluate(()=>getComputedStyle($('treeBoard')).backgroundImage.includes('skill-tree.webp')), `${width}: real skill tree uses generated decorative art`);
    check(await page.evaluate(()=>{const panel=$('treeOverlay').querySelector('.panel').getBoundingClientRect(),wrap=$('treeBoardWrap').getBoundingClientRect(),pop=$('treePop').getBoundingClientRect();return panel.left>=0&&panel.right<=innerWidth+1&&pop.left>=wrap.left&&pop.right<=wrap.right+1;}), `${width}: tree and readable popover fit the viewport`);
    check(await page.evaluate(n=>G.points===n,points), `${width}: tree visual inspection never spends points`);
    await page.screenshot({path:path.join(output,`legends-tree-${width}.png`)});await page.locator('#treeCloseBtn').click();
    check(errors.length === 0, `${width}: no runtime errors: ${errors.join(', ')}`);
    check(missing.length === 0, `${width}: all shipped local resources exist: ${missing.join(', ')}`);
    await context.close();
  }
  const fallback = await open(1280, true);
  await fallback.page.locator('#startBtn').click();
  await fallback.page.waitForFunction(() => G && G.time > .05);
  check(await fallback.page.evaluate(() => {
    drawProjectile({kind:'fire',sid:'fireball',x:G.player.x,y:G.player.y,vx:420,vy:0,r:10});
    return !LegendsArt.ready();
  }), 'blocked art falls back to the production vector renderer');
  check(fallback.errors.length === 0, 'missing optional art never interrupts combat');
  check(await fallback.page.evaluate(()=>!LegendsIcons.ready()&&getComputedStyle($('skillBar').querySelector('.icon-fallback')).visibility==='visible'), 'missing generated icons preserve named emoji fallback controls');
  await fallback.context.close();
  console.log(`Science Legends premium browser: ${checks} checks passed`);
} finally { await browser.close(); }
