import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateQuestionQuality as quality, buildQuestionQualitySummary as summary,
  questionQualitySignature as signature, questionHasUnresolvedStudentFlag as flagged} from '../science-feed-quality.js';

const stem = content => ({id:'stem',type:'text',content});
const answer = () => ({id:'answer',type:'answer',claim:'It is camouflaged.',evidence:'The fruit is dull green.',reasoning:'Smell helps animals find it.'});
const q = (blocks = [stem('<p>Why is smell important for animals to find the fruit?</p>'),answer()], extra = {}) => ({id:'q',title:'Fruit finding',level:'P4',topic:'Diversity',category:'Application',blocks,...extra});
const mcq = (texts = ['Carbon dioxide','Oxygen'], extra={}) => ({id:'choices',type:'mcq',options:texts.map((text,i)=>({id:'o'+i,text})),correctId:'o0',...extra});
const table = (data,extra={}) => ({id:'table',type:'table',data,rows:data.length,cols:data[0]?.length || 2,...extra});
const sound = question => assert.equal(quality(question).tier,'sound',JSON.stringify(quality(question)));
const reason = (question,want,options) => assert.ok(quality(question,options).reasons.includes(want),JSON.stringify(quality(question,options)));

test('valid Science CER answers and rich text are accepted',()=>{
  sound(q());
  sound(q([stem('<p>Explain why <strong>CO<sub>2</sub></strong> decreases.</p>'),answer()]));
  sound(q([stem('<p>Compare x&lt;y and the area x².</p>'),{id:'p',type:'plainanswer',content:'model'}]));
});
test('model answers, explanations and workspaces cannot disguise an empty stem',()=>{
  for(const blocks of [[answer()],[{type:'plainanswer',content:'Secret answer'}],[{type:'openLines',content:'Secret answer'}],
    [{type:'explanation',content:'Secret explanation'},answer()],[{type:'objectivesBox',label:'Prompt?'}]]) reason(q(blocks),'content-missing');
});
test('empty markup, comments, hidden blocks and invisible characters have no stem',()=>{
  for(const html of ['<p><br></p>','<span>&nbsp;&#160;&#xA0;</span>','<!-- wording -->','<div style="display:none">Hidden</div>',
    '<script>answer()</script>','<p>\u200b\ufeff</p>']) reason(q([stem(html),answer()]),'content-missing');
});
test('bad block shapes fail closed without throwing',()=>{
  for(const question of [null,{},q(null),q([null]),q([{type:'unknown',content:'wording'}]),q([stem({secret:'object'}),answer()])])
    assert.equal(quality(question).tier,'blocked');
});
test('context diagrams in image blocks and inline rich HTML count as content',()=>{
  sound(q([{id:'diagram',type:'image',url:'https://example.test/fruit.png'},answer()]));
  sound(q([stem('<p><img src="https://example.test/fruit.png" alt="Dull green fruit"></p>'),answer()]));
  sound(q([stem('<p><img src="/diagrams/fruit.svg"></p>'),answer()]));
  sound(q([stem('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>'),answer()]));
});
test('annotation tasks and blank answer workspaces remain eligible',()=>{
  sound(q([{id:'diagram',type:'image',url:'https://example.test/fruit.png'}],{annotation:true}));
  for(const type of ['openLines','workingSpace','plainanswer','answer']) sound(q([stem('Draw and label the circuit.'),{id:'a',type,annotate:true}]));
});
test('missing and invalid diagrams are detected without network requests',()=>{
  for(const url of ['',null]) reason(q([stem('Describe the diagram.'),{type:'image',url},answer()]),'image-missing');
  for(const url of ['javascript:run()','file:///secret','data:text/html,hello','data:image/png;base64,???','<insert image>'])
    reason(q([{type:'image',url},answer()]),'image-invalid');
  reason(q([{type:'image',url:'blob:expired'},answer()]),'image-unavailable');
  reason(q([stem('<img src="">'),answer()]),'image-missing');
});
test('inline image and explicit block load failures are downgraded',()=>{
  const url='https://example.test/a.png?x=1&y=2';
  reason(q([stem('<img src="https://example.test/a.png?x=1&amp;y=2">'),answer()]),'image-unavailable',{failedImageUrls:[url]});
  reason(q([{type:'image',url},answer()]),'image-unavailable',{failedImageUrls:new Set([url])});
  sound(q([{type:'image',url},answer()]));
});
test('data image and protocol-relative assets are legitimate',()=>{
  for(const url of ['data:image/png;base64,aGVsbG8=','data:image/svg+xml,%3Csvg%3E%3C/svg%3E','//example.test/a.png','./a.webp'])
    sound(q([{type:'image',url},answer()]));
});
test('MCQ options use real Science object schema',()=>{
  sound(q([stem('Which gas supports burning?'),mcq()]));
  sound(q([stem('Which diagram is correct?'),mcq(['<img src="a.png">','<img src="b.png">'])]));
  sound(q([stem('Which row?'),mcq(['1','2','3','4'])]));
});
test('MCQ empty options, missing identities and duplicate identities are blocked',()=>{
  for(const m of [mcq([]),mcq(['Only one']),mcq(['<p><br></p>','Oxygen']),mcq(['x','y'],{options:['x','y']}),
    mcq(['x','y'],{options:[{text:'x'},{text:'y'}]}),mcq(['x','y'],{options:[{id:'same',text:'x'},{id:'same',text:'y'}]})])
    reason(q([stem('Choose one.'),m]),'options-malformed');
});
test('duplicate visible MCQ options are detected through rich formatting',()=>{
  reason(q([stem('Choose the gas.'),mcq(['<b>Oxygen</b>',' Oxygen '])]),'options-duplicate');
  reason(q([stem('Choose the image.'),mcq(['<img src="a.png">','<img src="a.png">'])]),'options-duplicate');
});
test('scientific case and superscripts remain distinct options',()=>{
  for(const options of [['m','M'],['x²','x2'],['CO<sub>2</sub>','CO2'],['x<sup>2</sup>','x2'],['a &lt; b','a &gt; b']])
    sound(q([stem('Which is correct?'),mcq(options)]));
});
test('explicit invalid correctId is quarantined; absent public answer key is not',()=>{
  for(const key of [null,'missing',{},-1]) reason(q([stem('Choose.'),mcq(undefined,{correctId:key})]),'answer-key-review');
  const m=mcq(); delete m.correctId; sound(q([stem('Choose.'),m]));
});
test('array tables, HTML cells and blank cells are valid',()=>{
  sound(q([stem('Compare the leaves.'),table([['Leaf','Colour'],['A','<b>Green</b>'],['B','']]),answer()]));
  sound(q([stem('Complete this table.'),table([['',''],['','']]),answer()]));
});
test('Firestore numeric-key table maps render correctly',()=>{
  sound(q([stem('Describe the fruit.'),{type:'table',rows:2,cols:2,data:{0:{0:'Colour',1:'Dull green'},1:{0:'Smell',1:'Strong'}}},answer()]));
  sound(q([stem('Complete the grid.'),{type:'table',rows:3,cols:3,data:{0:{0:'Length'}}},answer()]));
});
test('legacy separate table headers remain valid without mutation',()=>{
  const t=table([['A','Green']],{headers:['Leaf','Colour']}); const before=JSON.stringify(t);
  sound(q([stem('Compare.'),t,answer()])); assert.equal(JSON.stringify(t),before);
});
test('table data hidden beyond declared dimensions is blocked',()=>{
  reason(q([stem('Compare.'),table([['A','B'],['C','D']],{rows:1}),answer()]),'table-truncated');
  reason(q([stem('Compare.'),table([['A','B']],{cols:1}),answer()]),'table-truncated');
  sound(q([stem('Fill the cells.'),table([['A',''],['','']],{rows:1,cols:1}),answer()]));
});
test('malformed table contents and invalid merge geometry are reviewed',()=>{
  for(const data of [null,'oops',[42],[[{answer:'hidden'}]]]) reason(q([stem('Table.'),{type:'table',data},answer()]),'table-malformed');
  reason(q([stem('Table.'),table([['A','B']],{merges:[{sr:0,sc:0,er:4,ec:0}]}),answer()]),'table-shape-review');
});
test('fillblank sentence renders as question without hashing hidden answers',()=>{
  const first=q([{id:'fb',type:'fillblank',text:'Leaves take in [[carbon]] [[dioxide]] during photosynthesis.'}]);
  const second=q([{id:'fb',type:'fillblank',text:'Leaves take in [[oxygen]] during photosynthesis.'}]);
  sound(first); sound(second); assert.equal(signature(first),signature(second));
  assert.notEqual(signature(first),signature(q([{id:'fb',type:'fillblank',text:'Roots take in [[water]] during photosynthesis.'}])));
});
test('unclosed blanks and unmistakable author placeholders are reviewed',()=>{
  reason(q([{type:'fillblank',text:'Plants need [[water'}]),'text-review');
  assert.equal(signature(q([{type:'fillblank',text:'Plants need [[water'}])),signature(q([{type:'fillblank',text:'Plants need [[a very different private answer'}])));
  reason(q([{type:'fillblank',text:{answer:'water'}}]),'content-malformed');
  for(const wording of ['[Insert question here]','{{QUESTION_TEXT}}','Lorem ipsum']) reason(q([stem(wording),answer()]),'placeholder-review');
  sound(q([stem('The leaf has a brown spot. Explain why.'),answer()]));
});
test('signature ignores all private model fields and projected nested keys',()=>{
  const first=q([stem('Choose one.'),mcq(),answer(),{type:'plainanswer',content:'secret'},{type:'image',url:'a.png',answerImg:'private.png',answerKey:'private'}]);
  const second=structuredClone(first);
  second.blocks[1].correctId='o1'; second.blocks[1].options[0].answer='private option answer';
  second.blocks[2].claim='different'; second.blocks[2].evidence='different'; second.blocks[2].reasoning='different';
  second.blocks[3].content='different'; second.blocks[4].answerImg='other.png'; second.blocks[4].answerKey='different';
  Object.assign(second,{answerKeywords:{'a':{0:true}},expected:'different',markingGuide:'different',autoCheck:{sig:'private',findings:['private']}});
  assert.equal(signature(first),signature(second));
});
test('signature changes when public wording, options, diagrams or table cells change',()=>{
  const first=q([stem('Choose one.'),mcq(),{type:'image',url:'a.png'},table([['Light','Strong']])]);
  for(const change of [x=>x.blocks[0].content='Choose two.',x=>x.blocks[1].options[0].text='Nitrogen',x=>x.blocks[2].url='b.png',x=>x.blocks[3].data[0][1]='Weak']) {
    const second=structuredClone(first); change(second); assert.notEqual(signature(first),signature(second));
  }
});
test('only current existing auto-check stamps affect selection',()=>{
  const question=q(undefined,{autoCheck:{state:'red',sig:'current'}});
  reason(question,'checked-issue',{importSignature:'current'});
  assert.equal(quality(question,{importSignature:'stale'}).tier,'sound');
  assert.equal(quality(question).tier,'sound');
  question.autoCheck.state='amber'; reason(question,'checked-review',{importSignature:'current'});
  question.autoCheck.state='error'; assert.equal(quality(question,{importSignature:'current'}).tier,'sound');
});
test('existing live traffic-light state is reused without running its checker',()=>{
  reason(q(),'checked-review',{checkedState:{state:'amber',stale:false}});
  assert.equal(quality(q(),{checkedState:{state:'red',stale:true}}).tier,'sound');
  assert.equal(quality(q(),{checkedState:{state:'error',stale:false}}).tier,'sound');
});
test('low accuracy and attempt speed alone never label a question erroneous',()=>{
  sound(q(undefined,{attempts:1000,correct:0,successRate:0,averageSeconds:1,stats:{accuracy:0}}));
});
test('review reports and teacher quarantine rank below sound work',()=>{
  reason(q(),'student-report',{studentFlagged:true});
  reason(q(undefined,{practiceQuarantined:true}),'teacher-quarantine');
  reason(q(undefined,{status:'flagged'}),'teacher-quarantine');
  reason(q(undefined,{importWarning:'A crop needs review.'}),'import-warning');
});
test('safe persisted summaries contain only allowlisted reason codes',()=>{
  const question=q(undefined,{autoCheck:{state:'red',sig:'private-key-signature',findings:['The answer is Oxygen']}});
  question.practiceQuality=summary(question,{importSignature:'private-key-signature',unresolvedFlagCount:2});
  const serialized=JSON.stringify(question.practiceQuality);
  assert.ok(!serialized.includes('Oxygen')); assert.ok(!serialized.includes('private-key-signature'));
  reason(question,'checked-issue'); reason(question,'reported-review');
  question.practiceQuality.reasonCodes.push('private-secret'); assert.ok(!quality(question).reasons.includes('private-secret'));
});
test('public content edits invalidate stale summaries',()=>{
  const question=q(); question.practiceQuality=summary(question,{unresolvedFlagCount:1}); reason(question,'reported-review');
  question.blocks[0].content='A corrected question.'; sound(question);
});
test('second-topic changes and quoted public sample answers invalidate reports',()=>{
  const question=q([stem('Explain what is wrong with this answer.'),{type:'studentAnswer',answer:'A plant takes in oxygen.'},answer()]);
  const initial=signature(question);
  question.blocks[1].answer='A plant takes in nitrogen.'; assert.notEqual(signature(question),initial);
  const sampleEdit=signature(question); question.topic2='Electricity'; assert.notEqual(signature(question),sampleEdit);
  question.blocks[1].answer='<img src="missing.png">'; reason(question,'image-unavailable',{failedImageUrls:['missing.png']});
});
test('ordinary save preserves unresolved report state until inbox is loaded',()=>{
  const question=q(); question.practiceQuality=summary(question,{unresolvedFlagCount:2});
  assert.equal(summary(question).reportCount,2);
  question.practiceQuality=summary(question,{unresolvedFlagCount:0,reportsReviewedAt:400});
  assert.equal(summary(question).reportsReviewedAt,400);
});
test('student report is cleared only by changed content or later review',()=>{
  const question=q(), report={signature:signature(question),at:200};
  assert.equal(flagged(question,report),true);
  question.practiceQuality=summary(question,{unresolvedFlagCount:0,reportsReviewedAt:100}); assert.equal(flagged(question,report),true);
  question.practiceQuality=summary(question,{unresolvedFlagCount:0,reportsReviewedAt:300}); assert.equal(flagged(question,report),false);
  question.practiceQuality=summary(question,{unresolvedFlagCount:1,reportsReviewedAt:300}); assert.equal(flagged(question,report),true);
  question.blocks[0].content='Edited wording.'; assert.equal(flagged(question,report),false);
});
