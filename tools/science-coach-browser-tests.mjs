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
const contextExample = `<p class="label">USE THE DIAGRAM</p>
<p>Fruit F grows among green leaves and has a strong smell. Explain how its smell helps animals find it.</p>
<svg viewBox="0 0 340 145" role="img" aria-label="Dull-green fruit F growing among green leaves" style="display:block;width:100%;max-width:340px;height:auto;margin:12px auto">
  <rect x="1" y="1" width="338" height="143" rx="15" fill="#f5f8ed" stroke="#d6e3c6"/>
  <path d="M66 94Q158 36 258 42M163 59v24" fill="none" stroke="#816241" stroke-width="5" stroke-linecap="round"/>
  <g fill="#8faf65" stroke="#547748" stroke-width="1.5"><path d="M81 83Q58 42 115 54Q123 71 81 83ZM129 64Q112 30 155 27Q165 50 129 64ZM188 50Q197 18 235 28Q224 49 188 50ZM206 49Q243 55 250 87Q208 86 206 49Z"/></g>
  <path d="M161 73C143 68 134 87 141 103C149 122 176 123 186 104C195 84 180 69 167 73Z" fill="#778b51" stroke="#4e6541" stroke-width="2"/>
  <g fill="#344d37" font-family="system-ui,sans-serif" font-size="12"><text x="14" y="27">Green leaves</text><text x="221" y="118">Dull-green fruit F</text></g>
  <path d="M84 32l40 15M217 113l-27-12" fill="none" stroke="#536a46" stroke-width="1.5"/>
</svg><p class="label">YOUR ANSWER</p><p>The smell attracts animals.</p>
<p class="score" id="feedback">Partial · Link fruit F's colour to how animals locate it.</p>`;
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
import {mountMistakeAnalysis,resetMistakeAnalysis} from '/science-mistakes.js';
import {MISTAKE_ANIMAL_ART_IDS} from '/science-mistake-art.js';
const result={verdict:'partial',feedback:'Compare both materials and support your answer with a reading.',coachIssues:[
{type:'comparison',detail:'You named material A, but did not compare its temperature with material B.'},
{type:'evidence',detail:'Include a temperature reading from the results table.'},
{type:'specific',detail:'Say which temperature is higher at the same time.'}]};
window.coachTest={mount:(value=result,id='feedback')=>mountScienceCoach(document.getElementById(id),value),
reset:()=>resetScienceCoaches(document.getElementById('question')),resetHost:()=>resetScienceCoaches(document.getElementById('feedback')),catalog:SCIENCE_COACHES};
// The 🐾 mistake analysis, mounted the way app.js mounts it: after the coach
// card when one is up, after the feedback otherwise, keyed by the feedback.
const animal=(id,extra={})=>({id,emoji:'🦊',animal:'The Fox',name:'Specific Sherry',desc:'The answer stayed general where the question wanted one exact thing named.',spot:'Words like "it changes" with nothing named.',fix:'Name the exact thing: the part, the property, the process, the number.',...extra});
const roster=MISTAKE_ANIMAL_ART_IDS.map(id=>animal(id,{animal:'The '+id[0].toUpperCase()+id.slice(1),name:'Habit '+id}));
const analysis={verdict:'partial',animal:animal('specific'),why:'You repeated that the temperature rose instead of comparing the two readings.',
question:{title:'Compare the results',label:'(b) Evidence',text:'The graph shows the temperature of water in cups made of materials X and Y.\\n(b) Which material is the poorer conductor of heat? Use the graph as evidence.',images:[]},
student:'Poorer conductor of heat',roster};
window.mistakeTest={mount:(value=analysis,id='feedback')=>{const host=document.getElementById(id);const coach=host.nextElementSibling&&host.nextElementSibling.matches('[data-sc-mount]:not([data-sc-mistake])')?host.nextElementSibling:null;return mountMistakeAnalysis(host,coach||host,value);},
resetHost:()=>resetMistakeAnalysis(document.getElementById('feedback')),reset:()=>resetMistakeAnalysis(document.getElementById('question')),analysis,ids:MISTAKE_ANIMAL_ART_IDS};
document.getElementById('check').focus();window.coachTest.mount();window.ready=true;
</script></html>`;
const files = new Set(['science-coaches.js','science-coach-core.js','science-coach-art.js','science-mistakes.js','science-mistake-art.js']);
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
  assert.equal(await page.locator('.sc-team-member').count(),9);
  assert.equal(await page.locator('.sc-team-member[data-coach="context"] h4').textContent(),'Context Connie');
  assert.equal(await page.locator('.sc-team-member[data-coach="context"] svg').getAttribute('data-animal'),'meerkat');
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

  // A question-specific clue and scientific link survive the real presentation
  // path, including a new ninth avatar, narrow screens and motion preferences.
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(markup=>{
    document.querySelector('.answer').innerHTML=markup;
    document.getElementById('check').focus();
    window.coachTest.mount({verdict:'partial',coachIssues:[{type:'context',detail:
      "You did not use fruit F's dull-green colour in the diagram: it blends into the green leaves, so it is harder to see. Its smell helps animals locate it."}]});
  },contextExample);
  assert.equal(await page.locator(':focus').getAttribute('id'),'check');
  assert.equal(await page.locator('.sc-message h3').textContent(),'Context Connie');
  assert.equal(await page.locator('.sc-portrait svg').getAttribute('data-animal'),'meerkat');
  assert.match(await page.locator('.sc-observation').textContent(),/fruit F.*dull-green.*green leaves.*smell/i);
  assert.match(await page.locator('.sc-next-move').textContent(),/diagram|question/i);
  assert.equal(await page.locator('[data-sc-tip]').count(),1,'One context gap gives one focused coach.');
  assert.equal(await page.locator('[data-sc-mount]').getAttribute('data-motion'),'on');
  for (const width of [1040,375,320]) {
    await page.setViewportSize({width,height:950});await settle();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const portrait=await page.locator('.sc-portrait').boundingBox();
    const card=await page.locator('.sc-card').boundingBox();
    assert.ok(portrait.x>=card.x&&portrait.x+portrait.width<=card.x+card.width);
    await screenshot('context-'+width);
    if(shots&&width===1040) await page.locator('.sc-card').screenshot({path:path.join(shots,'context-card.png')});
  }
  // 🐾 The mistake analysis FOLLOWS the sidekick: the same shell, the animal's
  // own animated figure, the actual question and what the student wrote,
  // one shared motion switch, and the same dismiss / reopen / roster / reset
  // behaviour — checked in the real stylesheet at three widths.
  await page.setViewportSize({width:1040,height:950});
  await page.evaluate(()=>{ localStorage.removeItem('science:coach-motion'); document.getElementById('check').focus(); window.mistakeTest.mount(); });
  await settle();
  assert.equal(await page.locator(':focus').getAttribute('id'),'check','The mistake card must not steal focus either.');
  assert.equal(await page.locator('[data-sc-mistake]').count(),1);
  assert.equal(await page.locator('[data-sc-mount]').count(),2,'The coach card stays; the analysis is added after it.');
  assert.equal(await page.locator('[data-sc-mistake]').evaluate(el=>el.previousElementSibling&&el.previousElementSibling.hasAttribute('data-sc-mount')&&!el.previousElementSibling.hasAttribute('data-sc-mistake')),true,'The analysis comes directly after the sidekick card.');
  assert.equal(await page.locator('[data-sc-mistake]').getAttribute('data-mistake'),'specific');
  assert.equal(await page.locator('[data-sc-mistake] .sc-portrait svg').getAttribute('data-animal'),'specific','The animated figure is the Sidekick skill named in the reply.');
  assert.equal(await page.locator('[data-sc-mistake] .sc-portrait .sc-avatar-float').count(),1);
  assert.equal(await page.locator('[data-sc-mistake]').getAttribute('data-motion'),'on');
  assert.notEqual(await page.locator('[data-sc-mistake] .sc-portrait .sc-avatar-float').evaluate(el=>getComputedStyle(el).animationName),'none','The figure animates under the coaches\' own motion rules.');
  assert.equal(await page.locator('[data-sc-mistake] .sc-eyebrow').evaluate(el=>el.textContent.trim()),'MISTAKE ANALYSIS');
  assert.equal(await page.locator('[data-sc-mistake] .sc-message h3').textContent(),'The Fox');
  assert.equal(await page.locator('[data-sc-mistake] .sc-focus').textContent(),'Specific Sherry');
  assert.match(await page.locator('[data-sc-mistake] .sc-observation').textContent(),/comparing the two readings/);
  assert.match(await page.locator('[data-sc-mistake] .sc-question-title').textContent(),/Compare the results/);
  assert.match(await page.locator('[data-sc-mistake] .sc-question-text').textContent(),/poorer conductor of heat\? Use the graph/,'The ACTUAL question is on the card.');
  assert.match(await page.locator('[data-sc-mistake] .sc-question-text').evaluate(el=>getComputedStyle(el).whiteSpace),/pre-line/,'The question keeps its line breaks.');
  assert.match(await page.locator('[data-sc-mistake] .sc-question-wrote').textContent(),/Poorer conductor of heat/,'What the student wrote is quoted beside it.');
  assert.match(await page.locator('[data-sc-mistake] .sc-next-move').textContent(),/WATCH FOR IT NEXT TIME[\s\S]*Name the exact thing/);
  assert.match(await page.locator('[data-sc-mistake] [role="status"]').textContent(),/Mistake analysis: The Fox/);
  const coachBox=await page.locator('[data-sc-mount]:not([data-sc-mistake]) .sc-card').boundingBox();
  const mistakeBox=await page.locator('[data-sc-mistake] .sc-card').boundingBox();
  assert.ok(mistakeBox.y>coachBox.y+coachBox.height-2,'On screen the analysis sits below the sidekick.');
  assert.ok(Math.abs(mistakeBox.width-coachBox.width)<2,'Both cards share one width.');
  await screenshot('mistake-desktop');
  if (shots) await page.locator('[data-sc-mistake] .sc-card').screenshot({path:path.join(shots,'mistake-card.png')});
  // One motion switch for both cards.
  await page.locator('[data-sc-mistake] [data-sc-motion]').click();
  assert.deepEqual(await page.locator('[data-sc-mount]').evaluateAll(els=>els.map(el=>el.dataset.motion)),['off','off'],'Pausing on the analysis pauses the sidekick too.');
  assert.equal(await page.locator('[data-sc-mistake] .sc-avatar-float').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.locator('[data-sc-mount]:not([data-sc-mistake]) [data-sc-motion]').click();
  assert.deepEqual(await page.locator('[data-sc-mount]').evaluateAll(els=>els.map(el=>el.dataset.motion)),['on','on'],'…and resuming on the sidekick resumes the analysis.');
  // Dismiss and reopen, without moving the sidekick.
  await page.locator('[data-sc-mistake] [data-sc-close]').click();
  assert.equal(await page.locator('[data-sc-mistake] .sc-card').isVisible(),false);
  assert.equal(await page.locator('[data-sc-mount]:not([data-sc-mistake]) .sc-card').isVisible(),true,'Closing the analysis leaves the sidekick up.');
  assert.equal(await page.locator(':focus').getAttribute('data-sc-reopen'),'');
  assert.match(await page.locator('[data-sc-mistake] [data-sc-reopen]').textContent(),/mistake analysis/);
  await page.locator('[data-sc-mistake] [data-sc-reopen]').click();
  assert.equal(await page.locator('[data-sc-mistake] .sc-card').isVisible(),true);
  // The ten-animal roster is built only when opened, and marks the one in this answer.
  assert.equal(await page.locator('[data-sc-mistake] .sc-team-grid > *').count(),0);
  await page.locator('[data-sc-mistake] .sc-team summary').click();
  await page.locator('[data-sc-mistake] .sc-team-member').last().waitFor();
  assert.equal(await page.locator('[data-sc-mistake] .sc-team-member').count(),9,'the nine Science Sidekicks, never the retired ten-animal list');
  assert.equal(await page.locator('[data-sc-mistake] .sc-team-member--here').getAttribute('data-mistake'),'specific');
  assert.equal(await page.locator('[data-sc-mistake] .sc-team-member .sc-avatar-float').count(),0,'Roster figures are still.');
  assert.deepEqual(await page.locator('[data-sc-mistake] .sc-team-member svg').evaluateAll(els=>els.map(el=>el.dataset.animal)),
    await page.evaluate(()=>[...window.mistakeTest.ids]),'All ten animals, in the shared order.');
  if (shots) await page.locator('[data-sc-mistake] .sc-team-grid').screenshot({path:path.join(shots,'mistake-cast.png')});
  await page.locator('[data-sc-mistake] .sc-team summary').click();
  // Narrow screens: no sideways scroll, the figure inside the card.
  for (const width of [375,320]) {
    await page.setViewportSize({width,height:950});await settle();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px screen must not scroll sideways with both cards up.`);
    const portrait=await page.locator('[data-sc-mistake] .sc-portrait').boundingBox();
    const card=await page.locator('[data-sc-mistake] .sc-card').boundingBox();
    assert.ok(portrait.x>=card.x&&portrait.x+portrait.width<=card.x+card.width);
    assert.equal(await page.locator('[data-sc-mistake] .sc-question-text').isVisible(),true);
    await screenshot('mistake-mobile-'+width);
  }
  await page.setViewportSize({width:1040,height:950});
  // A classmate's words and a model's sentence are DATA: nothing in them runs.
  await page.evaluate(()=>window.mistakeTest.mount({...window.mistakeTest.analysis,why:'<img src=x onerror="window.injected2=true"> Missing comparison.',student:'<script>window.injected3=true</script>x',
    question:{title:'<b>Bold</b>',label:'(c)',text:'Question <img src=x onerror="window.injected4=true">',images:['javascript:alert(1)','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=']}}));
  assert.equal(await page.locator('[data-sc-mistake]').count(),1,'Re-marking replaces the old analysis.');
  assert.equal(await page.locator('[data-sc-mistake] .sc-observation img, [data-sc-mistake] .sc-question-text img, [data-sc-mistake] script').count(),0);
  assert.match(await page.locator('[data-sc-mistake] .sc-observation').textContent(),/<img/);
  assert.equal(await page.locator('[data-sc-mistake] .sc-question-pics img').count(),1,'Only an image url is drawn; a script url is dropped.');
  assert.equal(await page.evaluate(()=>[window.injected2,window.injected3,window.injected4].every(v=>v===undefined)),true);
  // Correct, untyped and unknown never draw a card; a new check and a reset both clear it.
  const analysis=await page.evaluate(()=>JSON.parse(JSON.stringify(window.mistakeTest.analysis)));
  for (const bad of [{...analysis,verdict:'correct'},{...analysis,animal:{...analysis.animal,id:'dragon'}},{...analysis,animal:null},null]) {
    await page.evaluate(value=>window.mistakeTest.mount(value),bad);
    assert.equal(await page.locator('[data-sc-mistake]').count(),0,'No analysis for '+JSON.stringify(bad&&bad.verdict));
    await page.evaluate(()=>window.mistakeTest.mount());
  }
  await page.evaluate(()=>window.mistakeTest.resetHost());
  assert.equal(await page.locator('[data-sc-mistake]').count(),0,'A new check clears the previous analysis immediately.');
  assert.equal(await page.locator('[data-sc-mount]').count(),1,'…and leaves the sidekick to its own reset.');
  await page.evaluate(()=>window.mistakeTest.mount());
  await page.evaluate(()=>window.coachTest.reset());
  assert.equal(await page.locator('[data-sc-mount]').count(),0,'Resetting the question sweeps both cards.');
  await page.evaluate(()=>{ window.coachTest.mount(); window.mistakeTest.mount(); });
  assert.equal(await page.locator('[data-sc-mount]').count(),2);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.sc-avatar-float').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await page.locator('[data-sc-mistake] .sc-avatar-float').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('[data-sc-mount]:not([data-sc-mistake])').isVisible(),false,'Coaches never print on worksheets.');
  assert.equal(await page.locator('[data-sc-mistake]').isVisible(),false,'Nor does the mistake analysis.');
  assert.deepEqual(errors,[]);
  console.log('Science coach browser checks passed: desktop, 375/320px, focus, tabs, dismiss, motion, nine animals, context example, escaping, reset, print, and the mistake analysis that follows the sidekick.');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
