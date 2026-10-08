import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { signature, normaliseQuestion } from '../rapid-import/functions/core.js';
import { migrateDecisionsReviewState } from '../decisions-review-core.mjs';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function cut(start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a + start.length);
  assert.ok(a > 0 && b > a, start);
  return src.slice(a, b);
}
const hash = cut('function _aiHash(str) {', 'async function askGeminiCached(');
const sig = cut('function tlSig(q) {', '// ── Reading the cache');
const tlSig = new Function(hash + 'const TL_SIG_HEAD=4000;\n' + sig + '\nreturn tlSig;')();
const mergeCode = cut('function _pvsMergeImported(', '// The two buttons as they sit inside the pill');
const merge = new Function('tlSig', mergeCode + '\nreturn _pvsMergeImported;')(tlSig);
const clone = value => structuredClone(value);
const base = () => ({id:'q',rapidImportId:'import',title:'Heat',topic:'Heat',category:'Explanation',
  blocks:[{id:'text',type:'text',content:'Explain this.'},{id:'figure',type:'image',url:'original.png',originalCropUrl:'raw.png',scale:0.6}],blanks:{}});

test('worker checks match CER after Firestore reorders nested maps', () => {
  const q = base();
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).reverse().map(key => [key,reorder(value[key])])) : value;
  assert.equal(signature(q), tlSig(q));
  assert.equal(signature(reorder(q)), tlSig(q));
  const edited = clone(q); edited.blocks[0].content += ' Changed.';
  assert.notEqual(signature(q), tlSig(edited));
  edited.blocks[0].content = q.blocks[0].content; edited.answerKeyImage = 'answer.png';
  assert.notEqual(signature(q), tlSig(edited));
});
test('new MCQ imports retain their signature when CER normalizes the category', () => {
  const q = normaliseQuestion({title:'Which?',topic:'Heat',blocks:[{type:'text',text:'Which material?'},{type:'mcq',options:['A','B'],correctIndex:0}]},'q',
    {id:'import',topics:['Heat'],createdAt:'2026-10-01',createdBy:'teacher',name:'Paper'},1,'source.png');
  assert.equal(q.category,'Multiple Choice Question');
  assert.equal(signature(q),tlSig(q));
});
test('a local resize merges over a remote regeneration without restoring old pixels or check findings', () => {
  const before = base(), local = clone(before), remote = clone(before);
  local.blocks[1].scale = 0.8;
  remote.blocks[1].url = 'regenerated.png';
  remote.autoCheck = {state:'green',findings:[],sig:tlSig(remote)};
  remote.serverNote = 'latest metadata';
  const result = merge(before,local,remote);
  assert.equal(result.blocks[1].url,'regenerated.png');
  assert.equal(result.blocks[1].originalCropUrl,'raw.png');
  assert.equal(result.blocks[1].scale,0.8);
  assert.equal(result.serverNote,'latest metadata');
  assert.equal(result.autoCheck.sig,tlSig(result));
  assert.equal(remote.blocks[1].scale,0.6);
});
test('concurrent resizing, deleted blocks and structural changes fail closed', () => {
  const before = base(), local = clone(before), remote = clone(before);
  local.blocks[1].scale=0.8; remote.blocks[1].scale=0.9;
  assert.equal(merge(before,local,remote),null);
  remote.blocks.pop(); assert.equal(merge(before,local,remote),null);
  const removed=clone(before); removed.blocks.shift();
  const regenerated=clone(before); regenerated.blocks[1].url='new.png';
  assert.equal(merge(before,removed,regenerated),null);
  const result=merge(before,removed,before);
  assert.equal(result.blocks.length,1);
  const reorderedMaps=clone(before);reorderedMaps.blocks=reorderedMaps.blocks.map(block=>Object.fromEntries(Object.entries(block).reverse()));
  assert.equal(merge(before,removed,reorderedMaps).blocks.length,1);
});
test('an old stamp cannot become current merely because a preview resizes', () => {
  const before=base(),local=clone(before),remote=clone(before);
  remote.autoCheck={state:'green',sig:'old-check'};local.blocks[1].scale=0.8;
  const next=merge(before,local,remote);
  assert.equal(next.autoCheck.sig,'old-check');
  assert.notEqual(next.autoCheck.sig,tlSig(next));
});
function saveHarness(remote) {
  const before=base(),local=clone(before);local.blocks[1].scale=0.8;
  const state={remote:clone(remote),updates:[],renders:[]};
  const api=new Function('state','tlSig','local', `
    const currentUser={uid:'teacher'},db={};let vettingList=[local];
    const _vRef=id=>id,normalizeLoadedQuestion=q=>q;
    const _pvoRerender=id=>state.renders.push(id);
    const runTransaction=async (_db,run)=>run({get:async()=>({exists:()=>!!state.remote,data:()=>clone(state.remote)}),update:(id,payload)=>state.updates.push({id,payload})});
    const clone=value=>JSON.parse(JSON.stringify(value));
    ${mergeCode}
    return {save:(before)=>_pvsSaveImported(local,before),list:()=>vettingList};
  `)(state,tlSig,local);
  return {state,api,before};
}
test('the transaction updates existing records only and never resurrects approval/deletion', async () => {
  const deleted=saveHarness(null), tombstone=saveHarness({updatedAt:'later'});
  for(const h of [deleted,tombstone]) {
    const result=await h.api.save(h.before);
    assert.equal(result.conflict,true);assert.equal(h.state.updates.length,0);assert.equal(h.api.list().length,0);
  }
  const changed=base();changed.blocks[1].url='remote.png';
  const h=saveHarness(changed);await h.api.save(h.before);
  assert.equal(h.state.updates[0].payload.blocks[1].url,'remote.png');
  assert.equal(h.state.updates[0].payload.blocks[1].scale,0.8);
  assert.deepEqual(Object.keys(h.state.updates[0].payload).sort(),['answerKeywords','blanks','blocks']);
});
test('a fresh persisted worker check outranks a stale session verdict', () => {
  const code=cut('function _tlFromStamp(q) {','function tlFresh(q) {');
  const cache=new Map(),q=base();q.autoCheck={state:'green',sig:tlSig(q),at:'2026-10-01T00:00:00Z'};
  cache.set(q.id,{sig:'older-content',state:'done',verdict:'red',at:1});
  const read=new Function('tlSig','_tlCache','migrateDecisionsReviewState',code+'\nreturn tlStateOf;')(tlSig,cache,migrateDecisionsReviewState);
  assert.equal(read(q).state,'green');
  q.blocks[0].content+=' changed';assert.equal(read(q).state,'stale');
});
