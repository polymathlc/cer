import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const {chromium} = await import(process.env.RAPID_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = source.indexOf('let _rapidDuplicatesPlan =');
const end = source.indexOf('window.rapidDuplicateSettingsChanged = rapidDuplicateSettingsChanged;', start);
assert.ok(start >= 0 && end > start, 'Rapid duplicate integration is present');
const integration = source.slice(start, end + 'window.rapidDuplicateSettingsChanged = rapidDuplicateSettingsChanged;'.length);
const parserStart = source.indexOf('function _docQParts(q) {');
const parser = source.slice(parserStart, source.indexOf('// Clip long text', parserStart));
const section = html.match(/<section id="rapidDuplicates"[\s\S]*?<\/section>/)?.[0];
assert.ok(section);
const css = [...html.slice(0, html.indexOf('</head>')).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
const fixture = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rapid Add duplicate review</title>
<style>${css}body{padding:20px;background:#f3f5f8}.qa-pad{max-width:650px;margin:auto;background:white;padding:18px;border-radius:16px}.qa-pad h2{font-size:22px}@media(max-width:560px){body{padding:8px}.qa-pad{padding:10px}}</style>
<main class="qa-pad"><h2>Rapid Add</h2><p>Review extra copies after importing.</p>${section}</main>
<script type="module">
import {findRapidDuplicates, rapidDuplicateThreshold, rapidDuplicateFingerprint, rapidDuplicatePairCurrent} from '/rapid-duplicates.js';
let currentUser={uid:'teacher',role:'admin'},auth={currentUser:{uid:'teacher'}},_practiceAs=null;
let _inflightOps=0,_rapidPdfBusy=false,_rapidPdfQueue=[],rapidJobs=[],_rapidCloudJobs=[],_rapidJustAdded=new Set(['copy-a']),_vetSelected=new Set();
const db={}, rows=new Map(), events=[], uid='teacher';let fail=false,switchAt='',vettingList=[];
const stem='A metal ball was placed in a container of warm water. Explain what happens to the size of the ball.';
const make=id=>({id,title:'Expansion of the metal ball',level:'P5',createdAt:'2026-01-01',blocks:[{id:'stem',type:'text',content:stem}]});
function reset(){rows.set('questions',[make('original')]);rows.set('vetting',[make('copy-a'),make('copy-b')]);vettingList=structuredClone(rows.get('vetting'));_rapidJustAdded=new Set(['copy-a']);_vetSelected=new Set();events.length=0;fail=false;switchAt='';currentUser={uid:'teacher',role:'admin'};auth.currentUser={uid:'teacher'};_practiceAs=null;_rapidDuplicatesBusy=false;_rapidDuplicatesReset();}
function _isAdmin(){return currentUser?.role==='admin';}
function stripHtml(text){const div=document.createElement('div');div.innerHTML=text;return div.textContent;}
${parser}
function collection(...args){return args.at(-1);}
function doc(...args){return {owner:args.at(-3),where:args.at(-2),id:args.at(-1)};}
function snapshot(q){return {id:q?.id,exists:()=>!!q,data:()=>structuredClone(q)};}
async function getDocs(where){events.push(['read',where]);return {forEach:fn=>rows.get(where).forEach(q=>fn(snapshot(q)))};}
async function runTransaction(db,job){const removed=[];events.push(['transaction']);if(switchAt==='auth'){currentUser={uid:'student',role:'student'};auth.currentUser={uid:'student'};}const result=await job({get:async ref=>{events.push(['get',ref]);if(switchAt==='edit'&&ref.where==='vetting')rows.get(ref.where).find(q=>q.id===ref.id).title='Changed after preview';return snapshot(rows.get(ref.where).find(q=>q.id===ref.id));},delete:ref=>removed.push(ref)});if(fail)throw Error('Write refused');for(const ref of removed){assertOwner(ref);rows.set(ref.where,rows.get(ref.where).filter(q=>q.id!==ref.id));events.push(['deleted',ref]);}return result;}
function assertOwner(ref){if(ref.owner!=='teacher'||ref.where!=='vetting')throw Error('Unsafe deletion target');}
function _xtAnnounceQuestion(...args){events.push(['announce',...args]);}
function renderVettingList(){} function updateCounts(){} function showToast(message){events.push(['toast',message]);}
${integration}
window.qa={reset,events,role:(role,practice=false)=>{currentUser={uid:role==='admin'?'teacher':role,role};auth.currentUser={uid:practice?'teacher':currentUser.uid};_practiceAs=practice?{uid:'student'}:null;_rapidDuplicatesReset();},state:()=>({bank:rows.get('questions'),vetting:rows.get('vetting'),local:vettingList,busy:_rapidDuplicatesBusy}),fail:()=>{fail=true},change:()=>{rows.get('vetting')[0].title='Edited by another tab';},race:stage=>{switchAt=stage}};
reset();window.ready=true;
</script></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/rapid-duplicates.js') {res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'rapid-duplicates.js')));}
  else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch(process.env.RAPID_BROWSER_CHANNEL ? {channel:process.env.RAPID_BROWSER_CHANNEL} : {});
const reports=[];
try {
  for (const width of [1280,390]) {
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:width===390});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
    for(const [role,practice] of [['employee',false],['student',false],['admin',true]]){
      await page.evaluate(([r,p])=>qa.role(r,p),[role,practice]);assert.equal(await page.locator('#rapidDuplicates').isVisible(),false);
      await page.evaluate(()=>rapidDuplicateScan());assert.equal(await page.evaluate(()=>qa.events.length),0);
    }
    await page.evaluate(()=>qa.reset());
    await page.locator('#rapidDuplicatePercent').fill('40');await page.locator('#rapidDuplicateScan').click();
    assert.match(await page.locator('#rapidDuplicateStatus').innerText(),/50 to 100/);
    await page.locator('#rapidDuplicatePercent').fill('90');await page.locator('#rapidDuplicateScan').click();
    await page.waitForFunction(()=>!qa.state().busy);assert.equal(await page.locator('.rapid-duplicate-pair').count(),2);
    await page.locator('.rapid-duplicate-pair summary').first().click();
    const bounds=await page.locator('#rapidDuplicates').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(process.env.RAPID_SCREENSHOTS){fs.mkdirSync(process.env.RAPID_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.RAPID_SCREENSHOTS,'rapid-duplicates-'+width+'.png'),fullPage:true});}
    await page.evaluate(()=>{rapidDuplicateDelete();rapidDuplicateDelete();});await page.waitForFunction(()=>!qa.state().busy);
    assert.equal(await page.evaluate(()=>qa.state().vetting.length),0);assert.equal(await page.evaluate(()=>qa.state().bank.length),1);
    assert.equal(await page.evaluate(()=>qa.events.filter(e=>e[0]==='transaction').length),2);
    await page.evaluate(()=>qa.reset());await page.selectOption('#rapidDuplicateScope','session');await page.locator('#rapidDuplicateScan').click();await page.waitForFunction(()=>!qa.state().busy);
    assert.equal(await page.locator('.rapid-duplicate-pair').count(),1);await page.locator('#rapidDuplicateDelete').click();await page.waitForFunction(()=>!qa.state().busy);
    assert.deepEqual(await page.evaluate(()=>qa.state().vetting.map(q=>q.id)),['copy-b']);
    for(const failure of ['fail','change','edit','auth']){
      await page.evaluate(()=>qa.reset());await page.selectOption('#rapidDuplicateScope','vetting');await page.locator('#rapidDuplicateScan').click();await page.waitForFunction(()=>!qa.state().busy);
      await page.evaluate(mode=>{if(mode==='fail')qa.fail();else if(mode==='change')qa.change();else qa.race(mode);},failure);
      await page.locator('#rapidDuplicateDelete').click();await page.waitForFunction(()=>!qa.state().busy);
      const expected=failure==='change'?1:2;assert.equal(await page.evaluate(()=>qa.state().vetting.length),expected,failure);assert.equal(await page.evaluate(()=>qa.state().local.length),expected,failure);
      assert.equal(await page.evaluate(()=>qa.state().bank.length),1);
    }
    assert.deepEqual(errors,[]);reports.push({width,checks:'roles, threshold, review, bounds, session scope, double click, rejected writes, stale edits, auth switch'});await page.close();
  }
  console.log(JSON.stringify(reports,null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
