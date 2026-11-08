// Real shipped games and accessibility helper; the parent only supplies a fixture feed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
try {
  for (const slug of ['legends', 'slayers']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'expedition.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style><iframe src="/science-${slug}.html"></iframe><script>
        window.addEventListener('message',e=>{
          if(e.source!==document.querySelector('iframe').contentWindow)return;
          if(e.data.type==='SD_REQUEST_QUESTIONS')e.source.postMessage({type:'SD_QUESTIONS',feedPolicyVersion:1,requestId:e.data.requestId,studentKey:'accessibility-test',studentLevel:'P4',playsLeft:{legends:10,slayers:10},questions:[{id:'glass',q:'Which material lets light pass through?',options:['Clear glass','Wood'],answer:0,topic:'Light'}]},location.origin);
          if(e.data.type==='LEGENDS_REQUEST_META')e.source.postMessage({type:'LEGENDS_META',meta:{inv:[],eq:{},loadout:{},pts:0},gold:0},location.origin);
        });</script>` });
      const filename = path.join(root, url.pathname);
      return fs.existsSync(filename) ? route.fulfill({ path: filename }) : route.abort();
    });
    await page.goto('http://expedition.test/');
    const game = page.frames().find(frame => frame.url().includes(`science-${slug}.html`));
    await game.waitForFunction(() => document.getElementById('menuOverlay').getAttribute('role') === 'dialog');
    check(await game.evaluate(() => document.activeElement.id === 'menuOverlay'), `${slug}: menu initially receives focus without scrolling`);
    check(await game.evaluate(() => document.querySelector('.hud').inert && document.getElementById('evadeBtn').inert), `${slug}: background combat controls are inert`);
    check(await game.locator('#menuOverlay').getAttribute('aria-labelledby'), `${slug}: menu has a screen-reader title`);
    await game.locator('.class-card').nth(1).focus();
    await page.keyboard.press('Enter');
    await game.waitForFunction(() => document.activeElement.matches('.class-card[aria-pressed="true"]'));
    check(await game.evaluate(() => Array.from(document.querySelectorAll('.class-card')).indexOf(document.activeElement) === 1), `${slug}: class selection preserves keyboard focus after rerender`);
    await game.locator('.fol-pill').nth(1).focus();
    await page.keyboard.press('Enter');
    await game.waitForFunction(() => document.activeElement.matches('.fol-pill[aria-pressed="true"]'));
    check(await game.evaluate(() => Array.from(document.querySelectorAll('.fol-pill')).indexOf(document.activeElement) === 1), `${slug}: follower selection preserves focus and announces pressed state`);
    await game.locator('#startBtn').focus();
    await page.keyboard.press('Tab');
    check(await game.evaluate(() => document.activeElement === (document.querySelector('#menuOverlay summary') || document.querySelector('.class-card'))), `${slug}: Tab wraps to the first menu control, including collapsed help`);
    await page.keyboard.press('Shift+Tab');
    check(await game.evaluate(() => document.activeElement.id === 'startBtn'), `${slug}: Shift+Tab wraps within the menu`);
    await game.locator('#menuArmoryBtn').click();
    await game.waitForFunction(() => document.activeElement.id === 'armoryOverlay');
    check(await game.evaluate(() => document.getElementById('menuOverlay').inert), `${slug}: nested armory contains focus above the menu`);
    await game.locator('#armoryCloseBtn').click();
    await game.waitForFunction(() => document.activeElement.id === 'menuArmoryBtn');
    check(await game.locator('#menuOverlay').getAttribute('aria-modal') === 'true', `${slug}: closing nested armory restores the menu and its opener`);
    await game.waitForFunction(() => _gameCreditsReady());
    await game.locator('#startBtn').click();
    await game.waitForFunction(() => G && G.state === 'play' && !document.querySelector('.hud').inert);
    await game.locator('#pauseBtn').click();
    await game.waitForFunction(() => document.activeElement.id === 'pauseOverlay');
    await game.locator('#resumeBtn').click();
    await game.waitForFunction(() => document.activeElement.id === 'pauseBtn');
    check(await game.evaluate(() => !document.querySelector('.hud').inert), `${slug}: resuming restores the opener and releases combat controls`);
    check((await game.locator('#muteBtn').getAttribute('aria-label')).includes('Sound'), `${slug}: icon button has a descriptive name`);
    check(errors.length === 0, `${slug}: no browser errors: ${errors.join(', ')}`);
    await context.close();
  }
  console.log(`${checks} expedition accessibility browser checks passed.`);
} finally { await browser.close(); }
