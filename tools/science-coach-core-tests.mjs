import test from 'node:test';
import assert from 'node:assert/strict';
import {SCIENCE_COACHES,SCIENCE_COACH_INSTRUCTIONS,selectScienceCoaches} from '../science-coach-core.js';
const ids = result => selectScienceCoaches(result).map(c=>c.id);

test('catalog has nine trusted friendly animal coaches and useful actions',()=>{
  assert.deepEqual(Object.keys(SCIENCE_COACHES),['comparison','context','specific','evidence','keywords','concept','reasoning','careful','complete']);
  for(const [id,c] of Object.entries(SCIENCE_COACHES)) {
    assert.equal(c.id,id);assert.ok(c.name&&c.focus&&c.intro&&c.action);assert.match(c.accent,/^#[0-9a-f]{6}$/i);
    assert.ok(Object.isFrozen(c));assert.doesNotMatch(c.action,/careless|stupid|lazy/i);
  }
  assert.match(SCIENCE_COACH_INSTRUCTIONS,/at most 3/);assert.match(SCIENCE_COACH_INSTRUCTIONS,/Accepted synonyms/);
  assert.equal(SCIENCE_COACHES.context.name,'Context Connie');assert.equal(SCIENCE_COACHES.context.animal,'Meerkat');
  assert.match(SCIENCE_COACHES.context.action,/detail or label/);assert.match(SCIENCE_COACHES.context.action,/explain how/);
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

test('context instructions require actual question clues and a scientific link, not invented scenery',()=>{
  assert.match(SCIENCE_COACH_INSTRUCTIONS,/comparison\|context\|specific/);
  assert.match(SCIENCE_COACH_INSTRUCTIONS,/actual missed clue and the missing scientific link/);
  assert.match(SCIENCE_COACH_INSTRUCTIONS,/diagram you can actually see/);
  assert.match(SCIENCE_COACH_INSTRUCTIONS,/ONLY IF.*dull-green fruit among green leaves/);
  assert.match(SCIENCE_COACH_INSTRUCTIONS,/Dull-green fruit alone does not establish a green background/);
  assert.match(SCIENCE_COACH_INSTRUCTIONS,/Do not require context for a general science question/);
});

test('fruit context coaching connects the supplied feature to its scientific consequence',()=>{
  const detail='Your answer does not link the dull-green fruit among green leaves in the diagram to blending into the background, making it harder to see, so smell helps animals find it.';
  const result={verdict:'partial',feedback:detail,coachIssues:[{type:'context',detail}]};
  const coaches=selectScienceCoaches(result);
  assert.deepEqual(coaches.map(c=>c.id),['context']);
  assert.equal(coaches[0].detail,detail);
  assert.doesNotMatch(SCIENCE_COACHES.context.action,/fruit|smell|green/);
});

test('legacy context feedback handles diagram labels, given conditions and scenario application',()=>{
  for(const feedback of [
    'You did not use the diagram labels to explain which leaf lost more water.',
    'Your answer ignores the dull-green colour of the fruit shown in the picture.',
    'Link the given condition of the covered plant to the lack of light for photosynthesis.',
    'Your explanation has not applied the science idea to the situation in the question.',
    'Use the question context to explain why the animal can find this fruit.',
    'No link between the diagram labels and your explanation is provided.',
    'The question clues are not used in your answer.'
  ]) assert.deepEqual(ids({verdict:'partial',feedback}),['context'],feedback);
});

test('one context gap does not create redundant evidence, reasoning or specificity coaches',()=>{
  for(const feedback of [
    'Your answer is missing evidence because you did not use the diagram labels in your explanation.',
    'Your explanation is incomplete because you did not link the green fruit in the diagram to camouflage.',
    'Your answer is not specific because you did not apply the given situation to your explanation.'
  ]) assert.deepEqual(ids({verdict:'partial',feedback}),['context'],feedback);
  const detail='You did not link the labelled covered leaf in the diagram to the lack of light in your explanation.';
  assert.deepEqual(ids({verdict:'partial',coachIssues:[{type:'evidence',detail},{type:'reasoning',detail},{type:'context',detail}]}),['context']);
  const structured='The dull-green fruit blends into the supplied green surroundings, so explain why smell helps animals find it.';
  assert.deepEqual(ids({verdict:'partial',coachIssues:[{type:'reasoning',detail:structured},{type:'context',detail:structured}]}),['context']);
  assert.deepEqual(ids({verdict:'partial',coachIssues:[{type:'Reasoning',detail:structured},{type:'Context',detail:structured}]}),['context']);
});

test('context coaching preserves independent science, comparison, evidence and label-check issues',()=>{
  assert.deepEqual(ids({verdict:'partial',feedback:'You did not use the diagram labels to explain the result. Your answer lacks supporting measurements.'}),['context','evidence']);
  assert.deepEqual(ids({verdict:'partial',feedback:'Your answer ignores the diagram labels. The labels A and B are swapped.'}),['context','careful']);
  assert.deepEqual(ids({verdict:'partial',feedback:'You did not compare both plants. You did not use the diagram labels to explain the result. The units are incorrect. Your answer lacks supporting data.'}),['comparison','context','evidence']);
  assert.deepEqual(ids({verdict:'partial',feedback:'You incorrectly state that heat moves from cold to hot. You did not apply the given situation to your answer.'}),['concept','context']);
});

test('using question context well, negating a gap and not requiring context never trigger Connie',()=>{
  for(const feedback of [
    'You already use the diagram labels correctly.',
    'You have clearly used the question clues in your answer.',
    'Your diagram labels are used in the explanation.',
    'The question context is not missing from your answer.',
    'No question context is missing.',
    'You do not need to use the diagram for this general question.',
    'You need not refer to the diagram for this question.',
    'Your answer does not ignore the context of the question.',
    'You correctly link the scenario to the science idea.'
  ]) {
    assert.deepEqual(ids({verdict:'partial',feedback}),['complete'],feedback);
    assert.deepEqual(ids({verdict:'partial',coachIssues:[{type:'context',detail:feedback}]}),['complete'],feedback);
  }
  assert.deepEqual(ids({verdict:'partial',feedback:'You already use the diagram labels correctly, but your answer lacks supporting data.'}),['evidence']);
});

test('general concepts and genuine label mistakes keep their existing coach categories',()=>{
  assert.deepEqual(ids({verdict:'partial',feedback:'Explain why heat moves from a hot object to a cold object.'}),['reasoning']);
  assert.deepEqual(ids({verdict:'partial',feedback:'Your answer lacks a scientific explanation.'}),['reasoning']);
  assert.deepEqual(ids({verdict:'partial',feedback:'The diagram labels are swapped.'}),['careful']);
  assert.deepEqual(ids({verdict:'partial',feedback:'You used the wrong label A in the diagram.'}),['careful']);
  assert.deepEqual(ids({verdict:'partial',feedback:'The diagram is too vague about which variable changed.'}),['specific']);
});

test('scientific discussion and question imagery alone do not diagnose unused context',()=>{
  for(const feedback of [
    'The diagram shows dull-green fruit.',
    'The fruit does not use colour to attract animals in this situation.',
    'No evidence of germination is shown in the diagram.',
    'The labels in the diagram describe the leaves.',
    'No link between the diagram labels and temperature exists in this experiment.',
    'The experiment does not use green light in this situation.'
  ]) assert.deepEqual(ids({verdict:'partial',feedback}),['complete'],feedback);
  assert.deepEqual(ids({verdict:'partial',modelAnswer:'Use the diagram labels to explain the fruit colour.',
    explanation:'Use the diagram labels to explain the fruit colour.'}),['complete']);
});

test('context tags respect marking state and batch boundaries',()=>{
  const coachIssues=[{type:'context',detail:'Your answer does not link the given leaf covering to the lack of light.'}];
  for(const result of [{verdict:'correct',coachIssues},{score:2,total:2,coachIssues},{verdict:'unmarked',coachIssues},
    {verdict:'error',coachIssues},{coachIssues}]) assert.deepEqual(ids(result),[]);
  assert.deepEqual(ids({items:[{verdict:'correct',coachIssues},{verdict:'partial',feedback:'Your answer lacks evidence.'}]}),['evidence']);
  assert.deepEqual(ids({items:[{verdict:'partial',coachIssues},{verdict:'partial',feedback:'Your explanation is incomplete.'}]}),['context','reasoning']);
});

test('praise for using context does not suppress an independent detail error',()=>{
  const feedback='You correctly link the diagram to the explanation, but your units are incorrect.';
  assert.deepEqual(ids({verdict:'partial',feedback}),['careful']);
  assert.deepEqual(ids({verdict:'partial',coachIssues:[{type:'careful',detail:feedback}]}),['careful']);
  assert.deepEqual(ids({verdict:'partial',feedback:'You correctly link the diagram to the explanation, and use the wrong unit.'}),['careful']);
});
