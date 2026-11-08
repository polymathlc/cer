import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const now=Date.parse('2026-11-09T14:00:00+08:00');
const fixture=`import {createGameInsightsController} from '/game-insights.js';
window.user={uid:'admin',role:'admin'};window.reads=[];window.exports=[];window.fail=false;
const now=${now};const a=(uid,mode,day,score=1)=>({uid,mode,timestamp:day+'T12:00:00+08:00',score,totalBlanks:1,ms:10000});
window.controller=createGameInsightsController({document,getUser:()=>user,isAdmin:()=>user.role==='admin',now:()=>now,
loadRecords:async request=>{reads.push(request);if(fail)throw Error('Synthetic offline boundary');return{attempts:[a('one','legends','2026-11-09'),a('one','legends','2026-11-08',0),a('two','legends','2026-11-07'),a('one','tcg-legends','2026-11-09'),a('admin','fps','2026-11-09'),a('old','fps','2026-11-09'),a('previous','legends','2026-10-10')],profiles:[{uid:'admin',role:'admin'},{uid:'old',retired:true}],dailySummaries:[{uid:'one',day:'2026-11-09',gameId:'legends',starts:2},{uid:'pirate',day:'2026-11-08',gameId:'pirate-rift',starts:3}],coverage:{attemptsTruncated:true,attemptLimit:20000}};},download:(csv,name)=>exports.push({csv,name})});
await controller.open();window.ready=true;`;
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/game-insights.css"><style>body{margin:0;font:15px Arial;background:#f6f8fb;color:#203552}.page-header,.page-body{padding:20px}.btn{padding:9px 13px;border:1px solid #aebed2;border-radius:8px;background:#fff;color:#24486e;cursor:pointer}</style><main id="page-gameinsights"><header class="page-header"><h1>Games Insights</h1><p>See what students choose, how they answer, and where to improve next</p></header><div class="page-body"><div id="gameInsightsRoot"></div></div></main><script type="module" src="/fixture.js"></script>';
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};
const screenshots=process.env.GAME_SCREENSHOTS||path.join(root,'test-results/game-insights');fs.mkdirSync(screenshots,{recursive:true});
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='insights.test')return route.abort();if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});if(u.pathname==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:fixture});const full=path.join(root,u.pathname);if(!full.startsWith(root)||!fs.existsSync(full))return route.abort();return route.fulfill({path:full});});
  await page.goto('https://insights.test/');await page.waitForFunction(()=>window.ready);
  check(await page.locator('tbody tr').count()===17,'all game modes remain visible');
  check((await page.locator('tbody tr').first().textContent()).includes('Science Legends'),'ranked by player accounts');
  check((await page.locator('.gi-warning').textContent()).includes('read limit'),'sampling limits are visible');
  check((await page.locator('.gi-note').allTextContents()).join(' ').includes('not total playing time'),'answer-time source is explicit');
  check((await page.locator('tbody tr').filter({hasText:'Pirate Rift'}).textContent()).includes('3'),'pure action game has real starts');
  check((await page.locator('tbody tr').filter({hasText:'Ghost Arena'}).textContent()).includes('Not measured'),'missing data is not labelled unpopular');
  await page.locator('[data-gi-game="pirate-rift"]').click();
  check((await page.locator('.gi-detail').textContent()).includes('Not recorded'),'starts do not invent completions');
  check(await page.locator('[data-gi-game="pirate-rift"]').evaluate(e=>document.activeElement===e),'row selection preserves keyboard focus');
  await page.locator('[data-gi-export]').click();const exported=await page.evaluate(()=>exports[0]);
  check(exported.csv.includes('Science Legends')&&exported.name.endsWith('.csv'),'CSV contains game aggregate rows');
  check(exported.csv.includes('Answer sample capped')&&exported.csv.includes('"true"'),'CSV retains the sample coverage warning');
  check(!exported.csv.includes('admin')&&!exported.csv.includes('previous'),'CSV excludes account identities');
  await page.locator('[data-gi-days]').selectOption('7');check(await page.evaluate(()=>reads.length)===1,'narrowing dates reuses loaded window');
  await page.locator('[data-gi-days]').selectOption('90');await page.waitForFunction(()=>reads.length===2);check(await page.evaluate(()=>reads[1].limit)===20000,'wider dates preserve query bound');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile document has no horizontal overflow');
  await page.screenshot({path:path.join(screenshots,'game-insights-'+width+'.png'),fullPage:true});
  await page.evaluate(()=>{user={uid:'student',role:'student'};return controller.open();});
  check((await page.locator('#gameInsightsRoot').textContent())==='','role change clears admin view');
  check(await page.evaluate(()=>controller.exportCsv())===false,'student cannot export');
  check(await page.evaluate(()=>reads.length)===2,'student cannot start any query');
  check(errors.length===0,'no script errors: '+errors.join(';'));
  await page.close();
 }
 console.log('Game insights browser: '+checks+' checks passed');
}finally{await browser.close();}
