// Exercise the real Armory, saved equipment shape and class skill math.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.GAME_SCREENSHOTS || path.join(root, 'test-results/legends-loot');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {})
});
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }

try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 568 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 600 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'legends-loot.test') return route.abort();
      const file = path.join(root, decodeURIComponent(url.pathname));
      return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.abort();
    });
    await page.goto('http://legends-loot.test/science-legends.html');
    await page.evaluate(() => {
      const gear = (id, slot, name, af, r = 'rare', pw = null) => ({ id, slot, name, af, r, pw });
      const worldbreaker = LegendsLoot.rollBossItem('barb', () => 0, null, () => 'worldbreaker');
      const heart = LegendsLoot.rollBossItem('sorc', () => 0, null, () => 'heart');
      META.inv = [
        worldbreaker, heart, gear('sword', 'onehand', 'Blade', { dmg: 5 }, 'magic'),
        gear('shield', 'shield', 'Ward', { armor: 8 }),
        gear('legacy', 'ring', 'Ring of Endless Echoes', { hp: 10 }, 'mythic', 'echoring'),
        gear('ring', 'ring', 'Garnet Band', { hp: 6 }),
        gear('pants', 'pants', 'Legguards', { hp: 15 })
      ];
      META.eq = { mainhand: 'sword', offhand: 'shield', ring1: 'legacy' };
      META.pts = 1000;
    });
    await page.locator('#menuArmoryBtn').click();
    const overlay = page.locator('#armoryOverlay');
    const inspect = id => page.locator('#invGrid [data-item="' + id + '"]').click();
    const equip = slot => page.locator('[data-armory-equip="' + slot + '"]');
    check(await page.locator('#eqSlots [data-slot]').count() === 10, viewport.width + ': ten visible equipment slots');
    check(await page.locator('#armoryClassName').textContent() === 'Barbarian gear', viewport.width + ': menu uses selected class');
    await page.waitForFunction(() => ['common','exalted','mythic'].every(kind => $('armoryOverlay').classList.contains('gear-art-' + kind)));
    check(await page.evaluate(() => {
      const icon = id => getComputedStyle($('invGrid').querySelector('[data-item="' + id + '"] .gear-icon'));
      return icon('sword').backgroundImage.includes('items-common.webp') &&
        icon('legacy').backgroundImage.includes('items-exalted.webp') &&
        icon('worldbreaker').backgroundImage.includes('items-mythic.webp') &&
        icon('worldbreaker').backgroundPosition !== icon('heart').backgroundPosition;
    }), viewport.width + ': ordinary and Mythic gear draw distinct cells from the generated atlases');
    check(await page.evaluate(() => {
      const panel = $('armoryOverlay').querySelector('.armory-panel');
      return panel.scrollWidth <= panel.clientWidth + 1 &&
        [...$('invGrid').querySelectorAll('button')].every(button => button.getBoundingClientRect().width >= 44);
    }), viewport.width + ': inventory and equipment fit the viewport with usable targets');
    await inspect('heart');
    check(await equip('offhand').isDisabled() && (await page.locator('#armoryDetail').textContent()).includes('Requires Sorcerer'),
      viewport.width + ': class-restricted Mythic shows its requirement and disabled equip action');
    await inspect('worldbreaker');
    check((await page.locator('#armoryDetail').textContent()).includes('+22% Bleed skill damage'),
      viewport.width + ': signature affinity shown in item details');
    await equip('mainhand').click();
    check(await page.evaluate(() => META.eq.mainhand === 'worldbreaker' && META.eq.offhand === null &&
      META.inv.some(item => item.id === 'shield') && META.inv.some(item => item.id === 'sword')),
    viewport.width + ': two-handed equip keeps both replaced pieces in the bag');
    await inspect('shield');
    check(await equip('offhand').isDisabled() && (await page.locator('#armoryDetail').textContent()).includes('Unequip the two-handed'),
      viewport.width + ': two-handed occupancy blocks equipping the shield');
    await inspect('ring');
    await equip('ring2').click();
    await inspect('pants');
    await equip('pants').click();
    check(await page.evaluate(() => META.eq.ring1 === 'legacy' && META.eq.ring2 === 'ring' && META.eq.pants === 'pants'),
      viewport.width + ': pants and both independent ring slots equip while retaining the legacy Mythic');

    if (viewport.width > 600) {
      await page.screenshot({ path: path.join(output, 'armory-desktop.png') });
      await page.locator('#armoryCloseBtn').click();
      await page.locator('#startBtn').click();
      await page.waitForFunction(() => G && G.time > .05);
      check(await page.evaluate(() => G.stats.gear.mainhand.id === 'worldbreaker' && !G.stats.gear.offhand &&
        G.stats.sm.whirlwind.dmg === .35 && G.stats.mods['pw.flamespin'] && G.stats.mods['pw.echoring']),
      'live Barbarian stats use the two-handed signature and preserve the legacy Mythic power');
      await page.evaluate(() => { chosenClass = 'sorc'; });
      await page.locator('#armoryBtn').click();
      check(await page.locator('#armoryClassName').textContent() === 'Barbarian gear',
        'live Armory uses run class even when the menu selection differs');
      const rolls = await page.evaluate(() => {
        const random = Math.random;
        try {
          Math.random = () => .9999;
          return Array.from({ length: 12 }, () => rollItem()).every(item => item.r === 'unique' && !item.signature);
        } finally { Math.random = random; }
      });
      check(rolls && !(await page.locator('#armoryBoxOdds').textContent()).includes('Mythic'),
        'loot box upper tail only gives ordinary Unique gear');
      await page.evaluate(() => {
        for (let i = META.inv.length; i < 110; i++) {
          META.inv.push({ id: 'reserve-' + i, name: 'Reserve Ring', r: 'common', slot: 'ring', af: { hp: 2 } });
        }
        renderArmory();
      });
      check(await page.locator('#buyBoxBtn').isDisabled() && await page.locator('#armoryBagCount').textContent() === '110 items',
        'existing and boss gear above the purchase cap stays visible without deletion');
      await page.locator('#armoryNext').click();
      check(await page.locator('#armoryPageLabel').textContent() === 'Page 2 of 4', 'large bags can reach retained items on later pages');
    } else {
      check(await page.locator('#armoryCloseBtn').evaluate(button => {
        const rect = button.getBoundingClientRect();
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === button;
      }), 'mobile Done remains reachable after scrolling to item details');
      await page.screenshot({ path: path.join(output, 'armory-mobile.png') });
    }
    check(await overlay.isVisible() && !errors.length, viewport.width + ': Armory flows without runtime errors: ' + errors.join(', '));
    await context.close();
  }
} finally {
  await browser.close();
}
console.log('Science Legends loot browser: ' + checks + ' checks passed');
