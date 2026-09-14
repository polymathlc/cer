import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(pw) ? pathToFileURL(pw).href : pw);
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="overflow:auto"><main id="app"><button id="launch">Set sail</button></main><aside id="already-inert" inert>Hidden tool</aside><script type="module">
import { installPirateRiftPortal } from '/pirate-rift-portal.js';
window.user = {uid:'private-account-one',role:'student'}; window.level = 'P6'; window.child = 'child-a'; window.notices = []; window.before = 0;
window.portal = installPirateRiftPortal({subject:new URLSearchParams(location.search).get('subject'),getUser:()=>user,getLevel:()=>level,getProfileKey:()=>child,notify:m=>notices.push(m),beforeOpen:()=>before++});
document.querySelector('#launch').onclick = () => portal.open(); window.ready = true;
</script></body></html>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'); res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fixture); }
  if (url.pathname === '/pirate-rift.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end('<!doctype html><html><body><button>Game control</button><script>window.ready=true;window.ticks=0;setInterval(()=>ticks++,20);</script></body></html>');
  }
  if (url.pathname === '/pirate-rift-portal.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(root, 'pirate-rift-portal.js'))); }
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? {channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL} : {}) });
try {
  for (const subject of ['math', 'science']) {
    const page = await browser.newPage({viewport:{width:390,height:844}}), errors=[];
    page.setDefaultTimeout(10000); page.on('pageerror', error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/?subject=' + subject);
    await page.waitForFunction(()=>window.ready);
    const open = async () => {
      await page.locator('#launch').click();
      await page.frameLocator('iframe').getByRole('button', {name:'Game control'}).waitFor();
      return new URL(await page.locator('iframe').getAttribute('src'));
    };
    const initial = await open();
    assert.equal(initial.searchParams.get('subject'),subject); assert.equal(initial.searchParams.get('v'),'1.0.0');
    assert.match(initial.searchParams.get('profile'),/^p[0-9a-f]{16}$/); assert.ok(!initial.href.includes('private-account-one'));
    assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'),'no-referrer');
    assert.equal(await page.locator('[role="dialog"]').count(),1);
    assert.equal(await page.locator('#app').evaluate(el=>el.inert),true);
    const rect = await page.locator('iframe').boundingBox();
    assert.ok(rect.x>=0 && rect.x+rect.width<=390 && rect.height>650, 'mobile game fills the remaining viewport');
    await page.evaluate(()=>portal.open());
    assert.equal(await page.locator('iframe').count(),1, 'reopening replaces the run, never duplicates it');
    await page.getByRole('button',{name:'Close Pirate Rift'}).click();
    assert.equal(await page.locator('iframe').count(),0);
    assert.equal(await page.locator('#app').evaluate(el=>el.inert),false);
    assert.equal(await page.locator('#already-inert').evaluate(el=>el.inert),true);
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'auto');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'launch');
    assert.equal((await open()).searchParams.get('profile'),initial.searchParams.get('profile'));
    await page.evaluate(()=>{ child='child-b'; portal.sync(); });
    assert.equal(await page.locator('iframe').count(),0,'switching siblings immediately ends the old run');
    const sibling = await open(); assert.notEqual(sibling.searchParams.get('profile'),initial.searchParams.get('profile'));
    await page.evaluate(()=>{ level='P5'; portal.sync(); });
    assert.equal(await page.locator('iframe').count(),0);
    const changedLevel = await open(); assert.notEqual(changedLevel.searchParams.get('profile'),sibling.searchParams.get('profile'));
    await page.evaluate(()=>{ user=null; portal.sync(); });
    assert.equal(await page.locator('[role="dialog"]').count(),0,'sign-out removes the entire overlay');
    for (const user of [null,{uid:'employee',role:'employee'},{uid:'unknown',role:'unknown'},{role:'student'}]) {
      assert.equal(await page.evaluate(user=>{window.user=user;return portal.open();},user),false);
      assert.equal(await page.locator('iframe').count(),0);
    }
    await page.evaluate(()=>{user={uid:'private-admin',role:'admin'};level='';child='';});
    await open(); assert.equal(await page.locator('iframe').count(),1,'administrators can play without a question bank or level');
    await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
    await page.waitForFunction(()=>document.fullscreenElement?.classList.contains('pirate-rift-portal'));
    await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
    await page.waitForFunction(()=>!document.fullscreenElement);
    await page.locator('[data-fullscreen]').evaluate(el=>{el.closest('section').requestFullscreen=async()=>{throw new Error('denied');};});
    await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
    assert.match(await page.getByRole('status').textContent(),/keep playing/);
    assert.equal(await page.locator('iframe').count(),1,'unavailable fullscreen keeps the run intact');
    await page.getByRole('button',{name:'Close Pirate Rift'}).focus(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('iframe').count(),0);
    await open();
    await page.evaluate(()=>{user.uid='new-user';window.dispatchEvent(new Event('focus'));});
    assert.equal(await page.locator('iframe').count(),0,'refocusing with another account invalidates the frame');
    assert.deepEqual(errors,[]); await page.close();
  }
  console.log('Pirate Rift portal browser checks passed for Math and Science: access, scope, mobile, close, focus, fullscreen fallback and profile cleanup.');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
