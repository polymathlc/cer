import {test} from 'node:test';
import assert from 'node:assert/strict';
import {figureMode,originalImageUrl,storageImagePath,requireImageAudits} from '../image-core.js';
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
