import {test} from 'node:test';
import assert from 'node:assert/strict';
import {figureMode,originalImageUrl,storageImagePath,requireImageAudits,imageInstruction,CLASSIFY_FIGURE_PROMPT,adoptOriginal,figureFixTargets} from '../image-core.js';
import {normaliseQuestion,assemblePage} from '../core.js';

test('table, flowchart and graph requests remain monochrome; diagrams can use either mode',()=>{
  for(const kind of ['table','flowchart','graph']) {
    assert.equal(figureMode(kind,'colour'),'bw');
    assert.equal(figureMode(kind,'original'),'original');
  }
  assert.equal(figureMode('diagram','colour'),'colour');
  assert.equal(figureMode('diagram','bw'),'bw');
  assert.throws(()=>figureMode('diagram','unexpected'));
});
test('original crop has precedence over a previous generated variant',()=>{
  const q=normaliseQuestion({blocks:[{type:'image',figureKind:'table'}]},'q',{topics:[]},1,'page',['crop']);
  assert.equal(q.blocks[0].figureKind,'table');
  assert.equal(q.blocks[0].originalCropUrl,'crop');
  q.blocks[0].url='generated';q.blocks[0].preColourUrl='older-generated';
  assert.equal(originalImageUrl(q.blocks[0]),'crop');
  assert.equal(originalImageUrl({url:'replaced',cropSource:{url:'page',imageUrl:'old'}}),'');
});
test('image downloads reject other owners, other buckets and external endpoints',()=>{
  const make=(path,bucket='test')=>'https://firebasestorage.googleapis.com/v0/b/'+bucket+'/o/'+encodeURIComponent(path)+'?alt=media';
  assert.equal(storageImagePath(make('cer-rapid/teacher/job/images/original.jpg'),'test','teacher'),'cer-rapid/teacher/job/images/original.jpg');
  for(const url of [make('cer-rapid/other/job/images/crop.jpg'),make('cer-rapid/teacher/job/images/crop.jpg','other'),make('cer-rapid/teacher/job/original.pdf'),make('cer-rapid/teacher/../other/images/crop.jpg'),'https://example.com/private']) assert.throws(()=>storageImagePath(url,'test','teacher'));
});
test('continuation crop flags retain their correct figure indexes',()=>{
  const q=(id,flags)=>({id,sourceQuestionNumber:'8',blocks:[{id,type:'image'}],sourcePages:[],jevFigures:flags});
  const result=assemblePage(q('a',[{index:0,state:'fixed'}]),[{q:q('b',[{index:0,state:'flagged'}]),continuation:true}],true);
  assert.deepEqual(result.ready[0].jevFigures,[{index:0,state:'fixed'},{index:1,state:'flagged'}]);
});
test('visual audit requires every distinct target to be explicitly inspected',()=>{
  const clean={blockId:'first',complete:true,faithful:true,issues:[]};
  assert.deepEqual(requireImageAudits([clean],['first']),[]);
  for(const audits of [[],[clean,clean],[clean,{...clean,blockId:'second',complete:false}]]) assert.throws(()=>requireImageAudits(audits,['first','second']));
  const findings=requireImageAudits([{...clean,faithful:false,issues:['Number changed']}],['first']);
  assert.equal(findings[0].severity,'high');assert.equal(findings[0].blockId,'first');
});

test('regenerated figures are briefed in Century Gothic with straight lines; pictures may use colour',()=>{
  for(const kind of ['table','flowchart','graph']) {
    const text=imageInstruction(kind,figureMode(kind,'colour'));
    assert.match(text,/Century Gothic/);assert.match(text,/BLACK AND WHITE/);assert.match(text,/perfectly STRAIGHT/);
  }
  const colour=imageInstruction('diagram','colour');
  assert.match(colour,/Century Gothic/);assert.match(colour,/restrained educational colour/);assert.doesNotMatch(colour,/Use only BLACK AND WHITE/);
});
test('a word diagram such as a classification tree is classified as monochrome',()=>{
  assert.match(CLASSIFY_FIGURE_PROMPT,/classification trees/);
  assert.match(CLASSIFY_FIGURE_PROMPT,/ONLY a picture of real objects/);
  assert.equal(figureMode('flowchart','colour'),'bw');
});
test('a legacy figure with no preserved original adopts its untouched crop, but never a page or a redraw',()=>{
  const legacy={type:'image',url:'crop',cropSource:{url:'page',page:1}};
  const adopted=adoptOriginal(legacy,['page']);
  assert.equal(adopted.originalCropUrl,'crop');assert.equal(adopted.preColourUrl,'crop');assert.equal(adopted.cropSource.imageUrl,'crop');
  assert.equal(originalImageUrl(adopted),'crop');
  assert.equal(adoptOriginal({...legacy,url:'page'},['page']).originalCropUrl,undefined);
  assert.equal(adoptOriginal({...legacy,enhancement:{state:'done',mode:'bw'}},['page']).originalCropUrl,undefined);
  const kept={...legacy,originalCropUrl:'first'};assert.equal(adoptOriginal(kept,['page']),kept);
});
test('only crop or figure findings on real image blocks are auto-fixed',()=>{
  const blocks=[{id:'a',type:'image'},{id:'b',type:'text'},{id:'c',type:'image'}];
  const f=[{type:'Crop',blockId:'a'},{type:'Crop',blockId:'a'},{type:'Check',blockId:'c'},{type:'Crop',blockId:'b'},{type:'Diagram',blockId:'c'}];
  assert.deepEqual(figureFixTargets(f,blocks),['a','c']);
});
