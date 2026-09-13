import test from 'node:test';
import assert from 'node:assert/strict';
import {SCIENCE_COACHES,SCIENCE_COACH_INSTRUCTIONS,selectScienceCoaches} from '../science-coach-core.js';
const ids = result => selectScienceCoaches(result).map(c=>c.id);

test('catalog has eight trusted friendly coaches and useful actions',()=>{
  assert.deepEqual(Object.keys(SCIENCE_COACHES),['comparison','specific','evidence','keywords','concept','reasoning','careful','complete']);
  for(const [id,c] of Object.entries(SCIENCE_COACHES)) {
    assert.equal(c.id,id);assert.ok(c.name&&c.focus&&c.intro&&c.action);assert.match(c.accent,/^#[0-9a-f]{6}$/i);
    assert.ok(Object.isFrozen(c));assert.doesNotMatch(c.action,/careless|stupid|lazy/i);
  }
  assert.match(SCIENCE_COACH_INSTRUCTIONS,/at most 3/);assert.match(SCIENCE_COACH_INSTRUCTIONS,/Accepted synonyms/);
});
test('correct or full-credit results never receive corrective tags',()=>{
  for(const result of [{verdict:'correct',feedback:'Missing evidence.',coachIssues:[{type:'evidence',detail:'Evidence from the graph is missing.'}]},
    {score:2,total:2,feedback:'Missing comparison.'},{awarded:3,marks:3,misconception:'confuses heat with temperature'},
    {correct:true,feedback:'Incorrect units.'}]) assert.deepEqual(ids(result),[]);
});
test('missing, failed and unmarked results do not invent a coaching diagnosis',()=>{
  for(const result of [null,undefined,{},[],{feedback:'Missing evidence.'},{verdict:'unknown',feedback:'Missing comparison.'},{error:'Provider failed',feedback:'Missing evidence.'},
    {verdict:'unmarked',score:0,total:1},{status:'error'},{score:NaN,total:1}]) assert.deepEqual(ids(result),[]);
});
test('structured issues take priority, deduplicate and never exceed three coaches',()=>{
  const result={verdict:'partial',feedback:'Missing comparison.',coachIssues:[
    {type:'evidence',detail:'Your claim has no supporting observation.'},{type:'specific',detail:'The word it does not name an object.'},
    {type:'evidence',detail:'The graph result is not quoted.'},{type:'reasoning',detail:'The cause of the change is not explained.'},
    {type:'keywords',detail:'A required science term is missing.'}]};
  assert.deepEqual(ids(result),['evidence','specific','reasoning']);
});
test('invalid and unsupported structured issues cannot supply metadata or label ability',()=>{
  const result={verdict:'incorrect',coachIssues:[{type:'evil',detail:'A concrete missing observation.'},
    {type:'concept',detail:'Wrong.'},{type:'careful',detail:'You are a careless student.'},
    {type:'concept',detail:'Perhaps you confuse heat and temperature.'},
    {type:'keywords',detail:'Good keywords are included.'},null]};
  assert.deepEqual(ids(result),['complete']);
  assert.equal(selectScienceCoaches(result)[0].detail,'');
});
test('legacy negative feedback selects concrete comparison, evidence and terminology help',()=>{
  assert.deepEqual(ids({verdict:'partial',feedback:'You did not compare both materials.'}),['comparison']);
  assert.deepEqual(ids({verdict:'partial',feedback:'Your answer lacks supporting evidence.'}),['evidence']);
  assert.deepEqual(ids({verdict:'partial',feedback:'Use the scientific term identified in the feedback.'}),['keywords']);
});
test('praise, accepted wording and negated criticism do not become category tags',()=>{
  for(const feedback of ['Good comparison.','You did provide evidence.','Your reasoning is correct.',
    'No missing keywords.','Your comparison is not wrong.','You do not need to add evidence.',
    'Your keywords are correct. Accepted synonyms are fine.','No evidence is missing.',
    "Your answer isn't missing keywords.",'Your answer is more specific this time.']) {
    assert.deepEqual(ids({verdict:'partial',feedback}),['complete'],feedback);
  }
});
test('mixed praise and a negative clause coach only the observed gap',()=>{
  assert.deepEqual(ids({verdict:'partial',feedback:'Good comparison, but you did not provide evidence.'}),['evidence']);
  assert.deepEqual(ids({verdict:'partial',feedback:'You did provide evidence and your explanation is incomplete.'}),['reasoning']);
});
test('concept support requires an explicit observed science error, never a low score',()=>{
  assert.deepEqual(ids({score:0,total:5,feedback:'Try again.'}),['complete']);
  assert.deepEqual(ids({verdict:'incorrect',misconception:''}),['complete']);
  assert.deepEqual(ids({verdict:'incorrect',misconception:'no misconception'}),['complete']);
  assert.deepEqual(ids({verdict:'incorrect',misconception:"doesn't understand photosynthesis"}),['complete']);
  assert.deepEqual(ids({verdict:'incorrect',misconception:'confuses mass with weight'}),['concept']);
  assert.deepEqual(ids({verdict:'partial',feedback:'You incorrectly state that heat moves from cold to hot.'}),['concept']);
});
test('specific, reasoning, detail checks and blank responses have distinct actions',()=>{
  assert.deepEqual(ids({verdict:'partial',feedback:'Be more specific about the object.'}),['specific']);
  assert.deepEqual(ids({verdict:'partial',feedback:'Explain why the temperature changes.'}),['reasoning']);
  assert.deepEqual(ids({verdict:'partial',feedback:'The units are incorrect.'}),['careful']);
  assert.deepEqual(ids({verdict:'blank',feedback:'You have not answered this part.'}),['complete']);
});
test('batch marking ignores correct items and keeps feedback from partial items',()=>{
  assert.deepEqual(ids({items:[{verdict:'correct',feedback:'Missing keywords.'},
    {verdict:'partial',feedback:'Your explanation is incomplete.'},{verdict:'incorrect',feedback:'The units are wrong.'}]}),['reasoning','careful']);
});
test('model answers and explanations of scientific absence are not mistaken for learner errors',()=>{
  assert.deepEqual(ids({verdict:'incorrect',modelAnswer:'Use evidence.',expected:'Explain why.',student:'Missing keywords.',
    explanation:'There is no evidence of a change in temperature.'}),['complete']);
});
test('feedback remains capped untrusted text; result-supplied names and colors are ignored',()=>{
  const detail='<img src=x onerror=alert(1)> Your observation is missing. '+'extra '.repeat(100);
  const result={verdict:'partial',coachIssues:[{type:'evidence',detail,name:'Injected',accent:'url(evil)'}]};
  const copy=structuredClone(result),coach=selectScienceCoaches(result)[0];
  assert.equal(coach.id,'evidence');assert.equal(coach.name,'Evidence Ellen');assert.equal(coach.accent,SCIENCE_COACHES.evidence.accent);
  assert.ok(coach.detail.length<=280);assert.equal(typeof coach.detail,'string');assert.ok(coach.detail.startsWith('<img'));
  assert.deepEqual(result,copy);
});
