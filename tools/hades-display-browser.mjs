import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(new URL('..', import.meta.url).pathname);
const science = fs.existsSync(path.join(root, 'app.js'));
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const fixture = science ? `<style>${[...index.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n')}</style>${index.match(/<section id="hadesDisplay"[\s\S]*?<\/section>/)[0]}` : `<section id="hadesDisplay" style="position:fixed;inset:0;display:flex;flex-direction:column"><button id="hadesFullscreen">Fullscreen</button><iframe id="hadesFrame" style="flex:1;min-height:0;height:0"></iframe></section>`;
const server = http.createServer((req,res) => {
  if (req.url === '/') { res.setHeader('content-type','text/html'); res.end(`${fixture}<script type="module">import { installHadesDisplay } from './hades-display.js'; window.display = installHadesDisplay({container:document.getElementById('hadesDisplay'),button:document.getElementById('hadesFullscreen')}); window.ready=true;</script>`); }
  else if(req.url === '/hades-display.js') { res.setHeader('content-type','text/javascript'); res.end(fs.readFileSync(path.join(root, 'hades-display.js'))); }
  else { res.end('<!doctype html><body>Game viewport</body>'); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port); await page.waitForFunction(()=>window.ready);
  if(science) assert.equal(await page.locator('#hadesFrame').isVisible(),false);
  await page.locator('#hadesFrame').evaluate(el=>el.hidden=false);
  const embedded = await page.locator('#hadesFrame').boundingBox();
  assert.ok(embedded.height >= 800, 'Game must use a full-size viewport rather than the default 150px iframe');
  const button = page.locator('#hadesFullscreen');
  await button.click(); await page.waitForFunction(()=>!!document.fullscreenElement);
  assert.equal(await button.textContent(),'Exit fullscreen');
  assert.ok((await page.locator('#hadesFrame').boundingBox()).height > 750);
  // Parent-owned questions must remain in the fullscreen tree above the game.
  assert.equal(await page.evaluate(()=>document.fullscreenElement.contains(document.body)),true);
  await page.evaluate(()=>document.exitFullscreen());
  await page.waitForFunction(()=>!document.querySelector('[data-hades-expanded]'));
  assert.equal(await button.textContent(),'Fullscreen');
  await page.evaluate(()=>{ document.documentElement.requestFullscreen=()=>Promise.reject(new Error('Unavailable')); });
  await button.click(); assert.equal(await button.getAttribute('aria-pressed'),'true');
  await button.click(); assert.equal(await button.getAttribute('aria-pressed'),'false');
  await page.setViewportSize({width:390,height:844});
  assert.ok((await page.locator('#hadesFrame').boundingBox()).height>=700);
  await button.click(); await page.evaluate(()=>display.destroy());
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  assert.equal(await page.locator('[data-hades-expanded]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Hades embed sizing, fullscreen, external exit, fallback, mobile and cleanup passed.');
} finally { await browser.close(); server.close(); }
