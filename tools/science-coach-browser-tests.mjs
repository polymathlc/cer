import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const {chromium} = await import(process.env.COACH_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = html.split('/* SCIENCE COACHES START')[1]?.split('/* SCIENCE COACHES END */')[0];
assert.ok(css, 'Production coach styles must be present.');
// Include the real global styles too, so portal rules cannot silently break a
// component that looked correct in isolation. The fixture makes no AI calls.
const styles = [...html.slice(0,html.indexOf('</head>')).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match=>match[1]).join('\n');
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Science sidekicks — interaction check</title><style>${styles}
body{margin:0;background:#f3f5f8;color:#25304c;font-family:system-ui,sans-serif}main{max-width:800px;margin:40px auto;padding:0 20px 40px}
h1{font-size:29px;letter-spacing:-1px;margin:0 0 9px}.lead{color:#67728b;margin:0 0 26px}.answer{border:1px solid #dce2ec;border-radius:16px;background:white;padding:18px 22px}.answer p{margin:6px 0;line-height:1.6}.score{font-weight:700;color:#986018;font-size:13px}.label{font-size:10px;letter-spacing:2px;font-weight:800;color:#75819a}.focus-anchor{margin-bottom:16px;padding:8px 12px;border:1px solid #aeb9cb;border-radius:8px;background:white}
@media(max-width:480px){main{padding:0 12px 30px;margin-top:22px}h1{font-size:24px}}
</style><main><p class="label">SCIENCE LEARNING PORTAL</p><h1>A little help. A stronger answer.</h1><p class="lead">Your science sidekicks are here for your next step.</p>
<button class="focus-anchor" id="check">Check answer</button><div id="question"><div class="answer"><p class="label">YOUR ANSWER</p><p>Material A keeps the water warm.</p><p class="score" id="feedback">Partial · Compare both materials and support your answer with a reading.</p></div></div><div id="other"><p id="feedback2"></p></div></main>
<script type="module">
import {mountScienceCoach,resetScienceCoaches} from '/science-coaches.js';
import {SCIENCE_COACHES} from '/science-coach-core.js';
const result={verdict:'partial',feedback:'Compare both materials and support your answer with a reading.',coachIssues:[
{type:'comparison',detail:'You named material A, but did not compare its temperature with material B.'},
{type:'evidence',detail:'Include a temperature reading from the results table.'},
{type:'specific',detail:'Say which temperature is higher at the same time.'}]};
window.coachTest={mount:(value=result,id='feedback')=>mountScienceCoach(document.getElementById(id),value),
reset:()=>resetScienceCoaches(document.getElementById('question')),resetHost:()=>resetScienceCoaches(document.getElementById('feedback')),catalog:SCIENCE_COACHES};
document.getElementById('check').focus();window.coachTest.mount();window.ready=true;
</script></html>`;
const files = new Set(['science-coaches.js','science-coach-core.js','science-coach-art.js']);
const server = http.createServer((req,res) => {
  const name = new URL(req.url,'http://localhost').pathname.slice(1);
  if (!name) { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(fixture); }
  else if (files.has(name)) { res.setHeader('Content-Type','text/javascript; charset=utf-8'); res.end(fs.readFileSync(path.join(root,name))); }
  else { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.COACH_BROWSER_CHANNEL ? {channel:process.env.COACH_BROWSER_CHANNEL} : {});
const page = await browser.newPage({viewport:{width:1040,height:950}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const shots = process.env.COACH_SCREENSHOTS;
if (shots) fs.mkdirSync(shots,{recursive:true});
async function screenshot(name) { if (shots) await page.screenshot({path:path.join(shots,name+'.png'),fullPage:true}); }
async function settle() { await page.waitForTimeout(650); }
try {
  await page.goto(url);
  await page.waitForFunction(()=>window.ready);
  assert.equal(await page.locator(':focus').getAttribute('id'),'check','Arriving feedback must not steal focus.');
  assert.equal(await page.locator('[data-sc-mount]').count(),1);
  assert.equal(await page.locator('.sc-message h3').textContent(),'Comparison Casey');
  assert.equal(await page.locator('[data-sc-tip]').count(),3);
  assert.equal(await page.locator('.sc-team-grid > *').count(),0,'Roster is created only when opened.');
  await settle();await screenshot('desktop');
  await page.locator('[data-sc-tip="1"]').click();
  assert.equal(await page.locator('.sc-message h3').textContent(),'Evidence Ellen');
  assert.equal(await page.locator(':focus').getAttribute('data-sc-tip'),'1','Changing a tip retains keyboard focus.');
  assert.match(await page.locator('[role="status"]').textContent(),/Evidence Ellen/);
  await page.locator('[data-sc-motion]').click();
  assert.equal(await page.locator('[data-sc-mount]').getAttribute('data-motion'),'off');
  assert.equal(await page.evaluate(()=>localStorage.getItem('science:coach-motion')),'off');
  assert.equal(await page.locator('.sc-avatar-float').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.locator('[data-sc-close]').click();
  assert.equal(await page.locator('.sc-card').isVisible(),false);
  assert.equal(await page.locator(':focus').getAttribute('data-sc-reopen'),'');
  await page.locator('[data-sc-reopen]').click();
  assert.equal(await page.locator('.sc-card').isVisible(),true);
  await page.locator('.sc-team summary').click();
  await page.locator('.sc-team-member').last().waitFor();
  assert.equal(await page.locator('.sc-team-member').count(),8);
  assert.equal(await page.locator('.sc-team-member .sc-avatar-float').count(),0,'Roster artwork is static.');
  await screenshot('team');
  if (shots) await page.locator('.sc-team-grid').screenshot({path:path.join(shots,'cast.png')});
  await page.locator('.sc-team summary').click();

  for (const width of [375,320]) {
    await page.setViewportSize({width,height:850});
    await settle();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px screen must not scroll sideways.`);
    assert.equal(await page.locator('.sc-message h3').isVisible(),true);
    const bounds = await page.locator('.sc-card').boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
    await screenshot('mobile-'+width);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>localStorage.removeItem('science:coach-motion'));
  await page.reload();await page.waitForFunction(()=>window.ready);
  assert.equal(await page.locator('[data-sc-mount]').getAttribute('data-motion'),'off');
  assert.equal(await page.locator('[data-sc-motion]').isDisabled(),true);
  assert.equal(await page.locator('.sc-card').evaluate(el=>getComputedStyle(el).animationName),'none');
  await screenshot('reduced-motion');

  await page.evaluate(()=>window.coachTest.mount({verdict:'partial',coachIssues:[{type:'evidence',detail:'<img src=x onerror="window.injected=true"> Missing supporting observation.'}]}));
  assert.equal(await page.locator('[data-sc-mount] img').count(),0);
  assert.match(await page.locator('.sc-observation').textContent(),/<img/);
  assert.equal(await page.evaluate(()=>window.injected),undefined);
  assert.equal(await page.locator('[data-sc-mount]').count(),1,'Re-marking replaces the old coach.');
  await page.evaluate(()=>window.coachTest.mount({verdict:'correct',feedback:'Good evidence.'}));
  assert.equal(await page.locator('[data-sc-mount]').count(),0,'Correct results clear old corrective feedback.');
  await page.evaluate(()=>window.coachTest.mount({feedback:'Missing evidence.'}));
  assert.equal(await page.locator('[data-sc-mount]').count(),0,'An unmarked response cannot create a coach.');
  await page.evaluate(()=>window.coachTest.mount());
  await page.evaluate(()=>window.coachTest.resetHost());
  assert.equal(await page.locator('[data-sc-mount]').count(),0,'A new check clears the previous tip immediately.');
  await page.evaluate(()=>window.coachTest.mount());
  await page.evaluate(()=>window.coachTest.reset());
  assert.equal(await page.locator('[data-sc-mount]').count(),0,'Resetting the question clears coaches.');
  await page.evaluate(()=>window.coachTest.mount());
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('[data-sc-mount]').isVisible(),false,'Coaches never print on worksheets.');
  assert.deepEqual(errors,[]);
  console.log('Science coach browser checks passed: desktop, 375/320px, focus, tabs, dismiss, motion, roster, escaping, reset and print.');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
