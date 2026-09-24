import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assemblePage,normaliseQuestion,parseReply,cropRect,signature} from '../core.js';
const q=(id,page,number='8')=>({id,sourceQuestionNumber:number,blocks:[{id:id+'_b',type:'text',content:id}],sourcePages:[{page,url:'https://example.test/'+page}]});
test('a three-page question is held and saved as one, with all source pages',()=>{
  const a=assemblePage(null,[{q:q('a',1),continuation:false}],false);
  assert.equal(a.ready.length,0);
  const b=assemblePage(a.pending,[{q:q('b',2),continuation:true}],false);
  assert.equal(b.ready.length,0);
  const c=assemblePage(b.pending,[{q:q('c',3),continuation:true}],true);
  assert.equal(c.ready.length,1);assert.equal(c.pending,null);
  assert.deepEqual(c.ready[0].blocks.map(b=>b.content),['a','b','c']);
  assert.deepEqual(c.ready[0].sourcePages.map(p=>p.page),[1,2,3]);
  assert.equal(c.ready[0].id,'a');
});
test('continuation followed by a new question keeps boundaries',()=>{
  const r=assemblePage(q('a',1),[{q:q('b',2),continuation:true},{q:q('c',2,'9'),continuation:false}],false);
  assert.equal(r.ready.length,1);assert.equal(r.ready[0].blocks.length,2);assert.equal(r.pending.id,'c');
});
test('conflicting numbers and orphan continuations are flagged, never silently merged',()=>{
  const r=assemblePage(q('a',1),[{q:q('b',2,'9'),continuation:true}],true);
  assert.equal(r.ready.length,2);assert.match(r.ready[1].importWarning,/could not/);
  assert.ok(assemblePage(null,[{q:q('x',1),continuation:true}],true).ready[0].importWarning);
});
test('blank page flushes pending and clears carry; PDFs never share carry',()=>{
  const a=assemblePage(q('a',1),[],false);assert.equal(a.ready.length,1);assert.equal(a.pending,null);
  assert.equal(assemblePage(null,[{q:q('b',1),continuation:false}],true).ready[0].blocks.length,1);
});
test('truncated and malformed AI replies fail instead of saving partial questions',()=>{
  assert.throws(()=>parseReply({candidates:[{finishReason:'MAX_TOKENS'}],text:'{"questions":[]}'}));
  assert.throws(()=>parseReply({candidates:[{finishReason:'STOP'}],text:'{"questions":[{"blocks":[]}]}'}));
  assert.deepEqual(parseReply({candidates:[{finishReason:'STOP'}],text:'{"questions":[]}'}),[]);
});
test('normalisation preserves part letters, marks, release date and source provenance',()=>{
  const job={id:'job',createdAt:'now',createdBy:'Teacher',name:'paper.pdf',topics:['Heat'],release:'2027-01-02'};
  const r=normaliseQuestion({title:'Question',topic:'Heat',blocks:[{type:'text',text:'(b) Explain <why>',marks:2},{type:'plainanswer',text:'<script>bad</script>'},{type:'explanation',text:'Reason'},{type:'image'}]},'q1',job,2,'page-url',[]);
  assert.equal(r.blocks[0].part,'b');assert.equal(r.blocks[1].part,'b');assert.equal(r.blocks[0].marks,2);
  assert.equal(r.releaseOn,job.release);assert.equal(r.blocks[3].url,'page-url');assert.equal(r.sourcePages[0].page,2);
  assert.ok(!r.blocks[1].content.includes('<script>'));
});
test('invalid image rectangles use fallback; valid crop is clamped',()=>{
  assert.equal(cropRect([900,500,100,600],1000,1000),null);
  assert.equal(cropRect([NaN,0,100,100],1000,1000),null);
  assert.deepEqual(cropRect([-20,10,1005,900],1000,500),{x:10,y:0,w:890,h:500});
});

test('mixed-case image blocks keep their own crop or fallback and original part position',()=>{
  const urls=['first-figure',null,'third-figure'];
  const r=normaliseQuestion({blocks:[
    {type:'text',text:'(a) First part'},
    {type:' IMAGE ',caption:'First'},
    {type:'text',text:'(b) Second part'},
    {type:'Image',caption:'Needs review'},
    {type:'plainanswer',text:'Answer'},
    {type:'image',caption:'Third'}
  ]},'q',{topics:[]},1,'source-page',urls);
  assert.deepEqual(r.blocks.map(b=>b.type),['text','image','text','image','plainanswer','image']);
  assert.deepEqual(r.blocks.filter(b=>b.type==='image').map(b=>[b.url,b.caption,b.part]),[
    ['first-figure','First','a'],['source-page','Needs review','b'],['third-figure','Third','b']
  ]);
  assert.deepEqual(urls,['first-figure',null,'third-figure'],'normalisation must not consume its input array');
});
test('question signature changes after an answer edit',()=>{
  const a=q('a',1), before=signature(a);a.blocks[0].content='changed';assert.notEqual(signature(a),before);
});

test('each imported figure keeps the raw source and its own crop identity after JSON persistence',()=>{
  const result=normaliseQuestion({blocks:[
    {type:'image',box_2d:[100,200,400,700]},
    {type:'image',box:['200','300','600','800']},
    {type:'image',box_2d:[0,0,1000,1000]}
  ]},'crop-q',{topics:[]},3,'raw-page',['crop-one','crop-two','raw-page']);
  assert.deepEqual(JSON.parse(JSON.stringify(result)).blocks.map(b=>b.cropSource),[
    {url:'raw-page',imageUrl:'crop-one',page:3,box_2d:[100,200,400,700]},
    {url:'raw-page',imageUrl:'crop-two',page:3,box_2d:[200,300,600,800]},
    {url:'raw-page',imageUrl:'raw-page',page:3}
  ]);
});

test('invalid metadata rectangles never become trusted source coordinates',()=>{
  for(const box of [[900,200,100,700],[-1,200,400,700],[100,200,1001,700],[100,'',400,700],[100,200,NaN,700],null]) {
    const result=normaliseQuestion({blocks:[{type:'image',box_2d:box}]},'invalid-q',{topics:[]},1,'raw-page',['crop-url']);
    assert.deepEqual(result.blocks[0].cropSource,{url:'raw-page',imageUrl:'crop-url',page:1});
  }
});

test('page continuations preserve the original page for every figure',()=>{
  const make=(id,page)=>normaliseQuestion({sourceQuestionNumber:'8',blocks:[
    {type:'text',text:'(a) Figure'}, {type:'image',box_2d:[100,200,400,700]}
  ]},id,{topics:[]},page,'raw-page-'+page,['crop-'+page]);
  const first=make('first',1), second=make('second',2);
  const joined=assemblePage(first,[{q:second,continuation:true}],true).ready[0];
  assert.deepEqual(JSON.parse(JSON.stringify(joined)).blocks.filter(b=>b.type==='image').map(b=>b.cropSource),[
    {url:'raw-page-1',imageUrl:'crop-1',page:1,box_2d:[100,200,400,700]},
    {url:'raw-page-2',imageUrl:'crop-2',page:2,box_2d:[100,200,400,700]}
  ]);
});
