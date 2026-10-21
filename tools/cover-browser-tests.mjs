// Offline browser checks: actual generated images, editor roundtrip and PDF without background graphics.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root = fileURLToPath(new URL('../',import.meta.url));
const output = path.join(root,'test-results','covers');
fs.mkdirSync(output,{recursive:true});
const modulePath = process.env.WORKSHEET_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE;
const {chromium} = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/worksheet-cover.js"></script><style>body{margin:0;background:#eef4f5}#covers{max-width:794px;margin:auto}@page{size:A4;margin:18.5mm 16mm}@media print{body{background:white}#covers{max-width:none;margin:0}.wc-cover{height:260mm}}</style></head><body><button id="edit">Edit cover</button><main id="covers"></main><script>document.querySelector('#edit').onclick=async()=>{window.result=await WorksheetCover.edit(window.settings||{title:'Photosynthesis, leaves & gas exchange',subheader:'Primary Science',footer:'Past year paper',subject:'science'});};</script></body></html>`;
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  if(pathname === '/') {res.setHeader('Content-Type','text/html');res.end(fixture);return;}
  if(pathname !== '/worksheet-cover.js' && !/^\/assets\/(worksheet-covers\/(math|science)-icons|branding\/polymath-learning-centre)\.png$/.test(pathname)) {res.writeHead(404).end();return;}
  res.setHeader('Content-Type',pathname.endsWith('.png')?'image/png':'text/javascript');
  res.end(fs.readFileSync(path.join(root,pathname.slice(1))));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.WORKSHEET_BROWSER_EXECUTABLE || process.env.CHROME_PATH;
const browser = await chromium.launch({headless:true,...(executablePath ? {executablePath} : process.platform==='win32'?{channel:'msedge'}:{})});
const errors=[];
const page=await browser.newPage({viewport:{width:1280,height:1000}});
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
async function ready(){await page.waitForFunction(()=>[...document.images].every(img=>img.complete&&img.naturalWidth>0));}
try {
  await page.goto(origin);
  await page.locator('#edit').click();
  await page.locator('.wc-editor[open]').waitFor();
  await ready();
  await page.locator('[data-wc-input=title]').fill('Photosynthesis\nand gas exchange');
  await page.locator('[data-wc-input=nameLabel]').fill('Student');
  await page.locator('[data-wc-input=dateLabel]').fill('Class');
  await page.locator('[data-wc-input=layout]').selectOption('frame');
  await page.locator('[data-wc-input=scale]').fill('1.2');
  await page.locator('[data-wc-input=opacity]').fill('0.65');
  assert.equal(await page.locator('.wc-editor-preview .wc-title').textContent(),'Photosynthesis\nand gas exchange');
  await page.screenshot({path:path.join(output,'science-editor-desktop.png'),fullPage:true});
  await page.locator('.wc-editor [type=submit]').click();
  const saved=await page.evaluate(()=>window.result);
  assert.equal(saved.title,'Photosynthesis\nand gas exchange');assert.equal(saved.nameLabel,'Student');assert.equal(saved.dateLabel,'Class');assert.equal(saved.artworkScale,1.2);assert.equal(saved.artworkLayout,'frame');
  await page.evaluate(saved=>{window.settings=saved;document.querySelector('#covers').innerHTML=WorksheetCover.render(saved);},saved);
  await ready();
  assert.equal(await page.locator('#covers .wc-icon').count(),6);
  assert.equal(await page.locator('#covers .wc-title').textContent(),saved.title);
  await page.locator('#edit').click();
  assert.equal(await page.locator('[data-wc-input=nameLabel]').inputValue(),'Student');
  const title=page.locator('.wc-editor-preview .wc-title');
  await title.fill('Line one');await title.press('End');await title.press('Enter');await title.pressSequentially('Line two');
  assert.equal(await page.locator('[data-wc-input=title]').inputValue(),'Line one\nLine two');
  await page.locator('[data-wc-input=subject]').selectOption('math');
  assert.match(await page.locator('.wc-editor-preview .wc-icon img').first().getAttribute('src'),/math-icons/);
  assert.equal(await page.locator('.wc-editor-preview [data-cover-subject=science]').count(),0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>window.result===null);
  assert.equal(await page.locator('dialog').count(),0);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#edit').click();
  await ready();
  assert.ok(await page.locator('.wc-editor').evaluate(el=>el.scrollWidth<=el.clientWidth+2),'Mobile dialog must not overflow horizontally');
  await page.screenshot({path:path.join(output,'science-editor-mobile.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1100,height:1200});
  for(const subject of ['science','math']) {
    await page.evaluate(subject=>{document.querySelector('#edit').style.display='none';document.querySelector('#covers').innerHTML=WorksheetCover.render({subject,title:subject==='math'?'Fractions, ratios\n& percentages':'Photosynthesis, leaves\n& gas exchange',subheader:subject==='math'?'Primary Mathematics':'Primary Science',footer:'Polymath worksheet'});},subject);
    await ready();
    const clips=await page.locator('.wc-icon').evaluateAll(nodes=>nodes.map(el=>{const frame=el.getBoundingClientRect(),img=el.firstElementChild.getBoundingClientRect();return {w:frame.width,h:frame.height,iw:img.width,ih:img.height};}));
    clips.forEach(x=>{assert.ok(Math.abs(x.w-x.h)<1);assert.ok(Math.abs(x.iw-x.w*3)<1);assert.ok(Math.abs(x.ih-x.h*2)<1);});
    await page.emulateMedia({media:'print'});
    await page.screenshot({path:path.join(output,`${subject}-cover.png`),fullPage:true});
    await page.pdf({path:path.join(output,`${subject}-cover.pdf`),format:'A4',printBackground:false,preferCSSPageSize:true});
    await page.emulateMedia({media:'screen'});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS generated atlas clipping, live text/edit/settings roundtrip, subject separation, cancel, mobile, printed PDF with background graphics disabled');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
