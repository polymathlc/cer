// Exercise the actual role UI and publication functions without real accounts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { app, root, section, loadRenderer, sampleSets } from './rpg-avatar-art-tests.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(/^[A-Za-z]:[\\/]/.test(runtime) ? pathToFileURL(runtime).href : runtime);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
const card = section(html, '<div class="page" id="page-character">', '<!-- ===== PAGE: DUNGEON').replace('class="page"', 'class="page active"');
const helpers = fs.readFileSync(path.join(root, 'rpg-battle-hero.mjs'), 'utf8').replace(/export /g, '');
const renderer = loadRenderer();
const saved = { ...sampleSets[2], battleRole: 'warrior', clazz: 'warrior', xp: 12, stats: {}, inventory: { knight_sword: 1 }, upgrades: {} };
renderer.fixture.setState(saved);
const svg = renderer.fixture.avatar();
const source = `
${helpers}
let rpgState = JSON.parse(localStorage.getItem('savedHero') || 'null') || ${JSON.stringify(saved)};
let currentUser = {uid:'student-42',role:'student',name:'Test student'};
const db = {}, RPG_STORAGE_MODE = 'firestore', $ = id => document.getElementById(id);
const grandLineRpgSaveGate = {defer:()=>false};
const doc = (...parts) => parts.slice(1).join('/');
const setDoc = async (path, payload, options) => {
  if (path.endsWith('/scienceRpg')) localStorage.setItem('savedHero', JSON.stringify(payload));
  else { localStorage.setItem('publishedHero', JSON.stringify(payload)); window.lastPublished = payload; }
};
const rpgPlayerStats = () => ({level:5,atk:24,def:11,maxHp:130,crit:12,spellPct:.15});
const rpgLevelInfo = () => ({level:5});
const rpgAvatarSvg = () => ${JSON.stringify(svg)};
const rpgScorePayload = () => ({}), rpgHouseOf = () => ({id:'nova'}), rpgGameBoardData = () => ({}), rpgMonthKey = () => '2026-10';
const rpgWriteLocal = () => {}, rpgRenderSide = () => {};
const rpgRenderCharacterPage = () => {
  rpgRenderBattleRoles();
  $('rpgAvatarFrame').innerHTML = rpgAvatarSvg();
  $('rpgHeroName').textContent = currentUser.name;
  $('rpgHeroBars').textContent = 'Level 5 • HP 130 • Attack 24 • Defence 11';
};
${section(app, 'function rpgSave() {', 'function rpgSetGender(')}
${section(app, 'let rpgPublishTimer =', '// ---- Class raid boss:')}
${section(app, '  const battleRoles = $("rpgBattleRoles");', '  document.querySelectorAll(".rpg-tab[data-rpgtab]")')}
rpgRenderCharacterPage();
rpgPublishLeaderboard(true);
window.loadPublishedImage = async () => {
  const image = new Image(); image.src = window.lastPublished.battleHero.avatarDataUrl;
  await image.decode(); return {width:image.naturalWidth,height:image.naturalHeight};
};`;
const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}body{padding:16px}.page.active{display:block}.page-header{padding:12px}.page-body{padding:12px}.rpg-inv-card{min-height:320px}</style></head><body>${card}<script>${source.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const server = createServer((_, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(fixtureHtml); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
const out = path.resolve(process.env.GAME_SCREENSHOTS || path.join(root, '..', 'cer-battle-qa'));
fs.mkdirSync(out, { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const role of ['warrior', 'ranger', 'mage', 'healer']) {
    await page.locator(`[data-battle-role="${role}"]`).click();
    await page.waitForFunction(expected => window.lastPublished?.battleHero.role === expected, role);
    assert.equal(await page.locator(`[data-battle-role="${role}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-battle-role][aria-pressed="true"]').count(), 1);
  }
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('savedHero')).battleRole), 'healer');
  await page.reload();
  assert.equal(await page.locator('[data-battle-role="healer"]').getAttribute('aria-pressed'), 'true');
  const image = await page.evaluate(() => window.loadPublishedImage());
  assert.ok(image.width > 0 && image.height > 0, 'published SVG loads in an img as anskey consumes it');
  for (const viewport of [{ width: 1366, height: 1024, name: 'desktop' }, { width: 820, height: 1180, name: 'tablet' }, { width: 390, height: 844, name: 'phone' }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${viewport.name} does not overflow horizontally`);
    assert.equal(await page.locator('[data-battle-role]').count(), 4);
    await page.locator('#page-character').screenshot({ path: path.join(out, `cer-battle-role-${viewport.name}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log('CER browser: all roles selectable, private/public role persisted across reload, equipped SVG img decoded, desktop/tablet/phone layouts pass.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
