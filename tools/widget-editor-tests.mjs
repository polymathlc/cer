// Behavioral checks using the real editor/publication functions and isolated
// in-memory services. No AI request or cloud write is made by this harness.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
const helpers = createRequire(import.meta.url)('../question-apps.js');
const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('const WIDGET_HTML_MAX =');
const end = source.indexOf('// EXTENDED BLOCK TYPES', start);
assert.ok(start >= 0 && end > start);
const saveStart = source.indexOf('async function saveQuestion(q, opts) {');
const saveEnd = source.indexOf('// Delete one question doc', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart);
const oldHtml = '<!doctype html><html><body>Existing app</body></html>';
const newHtml = '<!doctype html><html><body><button>Try it</button></body></html>';
const token = '11111111-2222-4333-8444-555555555555';
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function build() {
  const env = { author: true, store: new Map(), calls: [], toasts: [], block: { id: 'app1', type: 'widget', html: oldHtml, maxTokens: 2048 }, status: {}, fetchHook: null };
  const api = new Function('env', 'helpers', 'crypto', 'token', `
    const window = { QuestionApps: helpers }, AI_THINK_MIN = 'low';
    let currentUser = { uid: 'author1' }, blocks = [env.block], geminiModel = null;
    const document = { getElementById: id => env.status[id] || null };
    const console = { warn() {}, error() {} };
    const storage = {};
    function _canAuthor() { return env.author; }
    function renderBlocks() { env.renders = (env.renders || 0) + 1; }
    function showToast(message, type) { env.toasts.push({message, type}); }
    function syncEditorDomToBlocks() {}
    function emScope() { return blocks; }
    function emTitleFor() { return 'Question title'; }
    function emTopicFor() { return 'Respiration'; }
    function stripHtml(value) { return String(value || '').replace(/<[^>]*>/g, ''); }
    function _fcClip(value) { return value; }
    function aiGrounding() { return ''; }
    function escapeHtml(value) { return helpers.escapeHtml(value); }
    function transformImageUrl(value) { return value; }
    async function _urlToDataUrlRobust(url) { env.calls.push({type:'image',url}); return env.imagePromise || 'data:image/png;base64,ZmFrZQ=='; }
    function _parseImageDataUrl(value) { const m = /^data:([^;]+);base64,(.*)$/.exec(value); return m ? {mime:m[1],data:m[2]} : null; }
    function storageRef(_storage, path) { return path; }
    async function getDownloadURL(path) {
      env.calls.push({type:'get',path});
      if (env.getHook) await env.getHook();
      if (env.readError) throw env.readError;
      if (!env.store.has(path)) { const e = new Error('Not found'); e.code = 'storage/object-not-found'; throw e; }
      return 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' + encodeURIComponent(path) + '?alt=media&token=' + token;
    }
    async function uploadBytes(path, bytes, options) {
      env.calls.push({type:'upload',path,options,payload:new TextDecoder().decode(bytes)});
      if (env.uploadError) throw env.uploadError;
      env.store.set(path, new TextDecoder().decode(bytes));
    }
    async function fetch(url, options) {
      env.calls.push({type:'fetch',url,options});
      if (env.fetchHook) await env.fetchHook();
      const path = decodeURIComponent(new URL(url).pathname.split('/o/')[1]);
      return {ok:!env.fetchFailure,text:async()=>env.wrongPayload ? 'wrong content' : env.store.get(path)};
    }
    function confirm() { return true; }
    let _inflightOps = 0, _wkSuppress = 1;
    function _setSaveStatus(value) { env.saveStatus = value; }
    function _scienceFeedSummary() { return {}; }
    function _qRef(id) { return 'bank/' + id; }
    function _vRef(id) { return 'vetting/' + id; }
    async function setDoc(path, question) { env.calls.push({type:'save',path,question:structuredClone(question)}); }
    function styleHarvestQuestion() {}
    function _xtAnnounceQuestion() {}
    function _wkLogQuestion() {}
    function setTimeout(callback) { callback(); }
    ${source.slice(start, end)}
    ${source.slice(saveStart, saveEnd)}
    return {
      paste:widgetSetHtml, import:widgetImportHtml, setTokens:widgetSetTokenLimit,
      publish:_widgetPublishBlock, publishAll:_widgetEnsurePublished, clear:widgetClear,
      save:saveQuestion, saveVetting:saveVettingQuestion,
      run:(id='app1')=>_widgetRun(id,null,()=> 'Build the question app'),
      render:renderWidgetBlockEditor,
      setAsk(fn) { _widgetAskAI = fn; },
      setUser(value) { currentUser = value; },
      setBlocks(value) { blocks = value; },
      get blocks() { return blocks; }, get busy() { return _widgetBusy; }
    };
  `)(env, helpers, webcrypto, token);
  return {env, api};
}
let checks = 0;
async function test(name, body) {
  try { await body(); checks++; }
  catch (error) { error.message = name + ': ' + error.message; throw error; }
}

await test('HTML paste and import are author-only and preserve exact source', async () => {
  const {env,api} = build();
  api.paste('app1', newHtml); assert.equal(env.block.html, newHtml);
  env.author = false; api.paste('app1', oldHtml); assert.equal(env.block.html, newHtml);
  await api.import('app1', {files:[{size:oldHtml.length,text:async()=>oldHtml}]});
  assert.equal(env.block.html, newHtml);
  env.author = true;
  await api.import('app1', {files:[{size:oldHtml.length,text:async()=>oldHtml}]});
  assert.equal(env.block.html, oldHtml);
  await api.import('app1', {files:[{size:300001,text:async()=>newHtml}]});
  assert.equal(env.block.html, oldHtml); assert.match(env.toasts.at(-1).message,/smaller than 300 KB/);
  await api.import('app1', {files:[{size:4,text:async()=> 'text'}]});
  assert.equal(env.block.html, oldHtml); assert.match(env.toasts.at(-1).message,/does not contain/);
});

await test('An imported file cannot overwrite typing or a replacement editor', async () => {
  for (const change of ['typing','block','user']) {
    const {env,api} = build(), file = deferred();
    const loading = api.import('app1', {files:[{size:100,text:()=>file.promise}]});
    if (change === 'typing') api.paste('app1', '<html>new typing</html>');
    if (change === 'block') api.setBlocks([{...env.block}]);
    if (change === 'user') api.setUser({uid:'author2'});
    file.resolve(newHtml); await loading;
    assert.notEqual(api.blocks[0].html, newHtml, change);
  }
});

await test('Generation forwards the selected ceiling and question diagrams', async () => {
  const {env,api} = build(); let sent;
  api.setBlocks([env.block,{id:'image',type:'image',url:'https://example.test/diagram.png'}]);
  api.setAsk(async (...args) => { sent=args; return newHtml; });
  await api.run();
  assert.equal(env.block.html,newHtml); assert.equal(sent[3],2048);
  assert.equal(sent[4].length,1); assert.equal(sent[4][0].mimeType,'image/png');
  assert.equal(api.busy.app1,undefined);
});

await test('Late or incomplete AI replies cannot replace the current app', async () => {
  for (const change of ['html','block','user','permission','incomplete']) {
    const {env,api}=build(), answer=deferred();
    api.setAsk(()=>answer.promise);
    const running=api.run();
    if(change==='html') env.block.html='<html>Teacher edit</html>';
    if(change==='block') api.setBlocks([{...env.block}]);
    if(change==='user') api.setUser({uid:'another-author'});
    if(change==='permission') env.author=false;
    answer.resolve(change==='incomplete' ? '<html>cut off' : newHtml); await running;
    assert.notEqual(api.blocks[0].html,newHtml,change);
    assert.equal(api.busy.app1,undefined);
  }
});

await test('Double click does not make two billable requests', async () => {
  const {api}=build(), answer=deferred(); let calls=0;
  api.setAsk(()=>{calls++;return answer.promise;});
  const first=api.run(); await api.run(); assert.equal(calls,1);
  answer.resolve(newHtml); await first;
});

await test('Changed question context invalidates both waiting and completed generation', async () => {
  for (const phase of ['image','answer']) {
    const {env,api}=build(), pending=deferred(); let aiCalls=0;
    const text={id:'text',type:'text',content:'Original question'};
    api.setBlocks([env.block,text,{id:'img',type:'image',url:'https://example.test/img.png'}]);
    if (phase==='image') env.imagePromise=pending.promise;
    api.setAsk(()=>{aiCalls++;return phase==='answer' ? pending.promise : newHtml;});
    const running=api.run();
    if (phase==='answer') { while (!aiCalls) await Promise.resolve(); }
    text.content='Revised question';
    pending.resolve(phase==='image' ? 'data:image/png;base64,ZmFrZQ==' : newHtml);
    await running;
    assert.equal(env.block.html,oldHtml,phase);
    assert.equal(aiCalls,phase==='image' ? 0 : 1,phase);
  }
});

await test('Publication uploads only an immutable app snapshot and verifies anonymous read', async () => {
  const {env,api}=build(); env.block.privateAnswer='never share';
  await api.publishAll([{title:'Private question',answer:'never share',blocks:[env.block]}]);
  const writes=env.calls.filter(c=>c.type==='upload'); assert.equal(writes.length,1);
  assert.match(writes[0].path,/^cer-images\/question-app-[a-f0-9]{64}\.json$/);
  assert.deepEqual(Object.keys(JSON.parse(writes[0].payload)).sort(),['height','html','title','version']);
  assert.equal(writes[0].options.contentType,'application/json');
  const read=env.calls.find(c=>c.type==='fetch'); assert.equal(read.options.credentials,'omit');
  assert.ok(helpers.publishedUrl(env.block));
  await api.publish(env.block); assert.equal(env.calls.filter(c=>c.type==='upload').length,1);
  const duplicate={...env.block}; delete duplicate.appUrl; delete duplicate.appSourceHash;
  await api.publish(duplicate); assert.equal(duplicate.appUrl,env.block.appUrl);
  assert.equal(env.calls.filter(c=>c.type==='upload').length,1,'Existing content is never overwritten');
});

await test('Publication failures never create a claimed working link', async () => {
  for(const mode of ['uploadError','readError','fetchFailure','wrongPayload']) {
    const {env,api}=build(); env[mode]=mode.endsWith('Error') ? new Error('Denied') : true;
    await assert.rejects(api.publish(env.block)); assert.equal(env.block.appUrl,undefined,mode);
  }
  const {env,api}=build(); env.author=false;
  await assert.rejects(api.publish(env.block),/question author/); assert.equal(env.calls.length,0);
});

await test('Concurrent identical publication shares one upload', async () => {
  const {env,api}=build(), second={...env.block,id:'app2'};
  await Promise.all([api.publish(env.block),api.publish(second)]);
  assert.equal(env.calls.filter(c=>c.type==='upload').length,1);
  assert.equal(second.appUrl,env.block.appUrl);
});

await test('Changed source and account changes cannot accept an old publication', async () => {
  for(const mode of ['source','account','title','height']) {
    const {env,api}=build();
    env.fetchHook=()=>{if(mode==='source')env.block.html=newHtml;else if(mode==='title')env.block.title='New title';else if(mode==='height')env.block.height=800;else api.setUser({uid:'other'});};
    await assert.rejects(api.publish(env.block),/changed/); assert.equal(env.block.appUrl,undefined);
  }
});

await test('Title and height changes produce new snapshots and preserve printed URLs', async () => {
  const {env,api}=build(); await api.publish(env.block); const originalUrl=env.block.appUrl;
  env.block.title='Renamed app'; assert.equal(helpers.publishedUrl(env.block),'');
  await api.publish(env.block); const renamedUrl=env.block.appUrl; assert.notEqual(renamedUrl,originalUrl);
  env.block.height=800; assert.equal(helpers.publishedUrl(env.block),'');
  await api.publish(env.block); assert.notEqual(env.block.appUrl,renamedUrl);
  assert.equal(env.store.size,3,'All previous worksheet snapshots remain available');
});

await test('Account changes before upload stop the write', async () => {
  const {env,api}=build(); env.getHook=()=>api.setUser({uid:'another-author'});
  await assert.rejects(api.publish(env.block),/Account changed/);
  assert.equal(env.calls.filter(call=>call.type==='upload').length,0);
});

await test('Bank and vetting saves persist the published link with question content', async () => {
  for (const route of ['save','saveVetting']) {
    const {env,api}=build(), question={id:'q1',blocks:[env.block],answer:'Private model answer'};
    assert.equal(await api[route](question),true,route);
    const saved=env.calls.find(call=>call.type==='save');
    assert.equal(saved.question.answer,question.answer);
    assert.ok(helpers.publishedUrl(saved.question.blocks[0]));
    assert.ok(env.calls.findIndex(call=>call.type==='fetch') < env.calls.findIndex(call=>call.type==='save'));
    assert.equal(env.saveStatus,'saved');
  }
});

await test('Failed publication cannot persist a broken worksheet link', async () => {
  for (const route of ['save','saveVetting']) {
    const {env,api}=build(); env.uploadError=new Error('Storage denied');
    assert.equal(await api[route]({id:'q1',blocks:[env.block]}),false,route);
    assert.equal(env.calls.filter(call=>call.type==='save').length,0,route);
    assert.equal(env.saveStatus,'error');
  }
});

await test('Editor exposes paste, exact token cap and sandboxed preview', async () => {
  const {env,api}=build(), html=api.render(env.block);
  assert.match(html,/App HTML code/); assert.match(html,/Maximum output tokens/);
  assert.match(html,/min="1024" max="32000"/); assert.match(html,/sandbox="allow-scripts"/);
  assert.doesNotMatch(html,/allow-same-origin/);
  assert.match(html,/Input tokens cost extra/);
});
console.log(checks + ' widget editor and publication scenarios passed.');
