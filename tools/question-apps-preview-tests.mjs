// Exercise the shipped preview lifecycle and marking guards without Firebase or AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const match = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(source);
  assert.ok(match, 'Find shipped function ' + name);
  const end = source.indexOf('\n}', match.index);
  assert.ok(end > match.index, 'Find end of ' + name);
  return source.slice(match.index, end + 2);
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function markingFixture(mode = 'preview', role = 'student') {
  const env = {mode, role, events:[], stats:null};
  const api = new Function('env', `
    const sel = '#studentPreviewBody';
    const currentUser = {uid:'learner',role:env.role,email:'learner@example.test',name:'Learner'};
    const q = {id:'preview',title:'Respiration',topic:'Life cycles',category:'Open-ended',blocks:[]};
    const _openItemsStore = {[sel]:[{label:'Answer'}]}, _openMcqStore = {[sel]:[]};
    const _openPartResults = {[sel]:{'open:0':{pts:1,verdict:'correct',student:'oxygen',expected:'oxygen'}}};
    const _openSurfaceCfg = {[sel]:{mode:env.mode,onAllMarked:()=>env.events.push('completed')}};
    const _annotPadScores = {[sel]:{}}, _openFinalized = {}, _openQStore = {[sel]:q};
    const document = {querySelector:()=>({querySelectorAll:()=>[]}),getElementById:()=>null};
    const db = {}, Timestamp = {now:()=>0};
    let cerPerf = null;
    const collection = (_db,...parts)=>parts.join('/'), doc = collection;
    const addDoc = (path,value)=>{env.events.push({write:path,value});return Promise.resolve();};
    const setDoc = addDoc;
    const rpgAnswerFingerprint = ()=> 'fingerprint';
    const _attemptAnswers = ()=>[];
    const noteAttemptLocally = ()=>env.events.push('local attempt');
    const fcNoteMistakes = ()=>env.events.push('mistake log');
    const _genAndShowExplanation = ()=>env.events.push('explanation');
    const _partLabelFor = ()=> 'Answer';
    const rpgOnMarked = ()=>env.events.push('reward');
    const _emptyPerf = ()=>({attempts:0,totalScore:0,totalPossible:0,topics:{},categories:{},recent:[]});
    const normalizeCategoryValue = value=>value;
    const qpHasMcq = ()=>false, _computeScore100 = ()=>100;
    ${extract('recordCerPerformance')}
    ${extract('_checkAllPartsMarked')}
    return {
      record:()=>{recordCerPerformance(q,1,1,env.mode,'oxygen');env.stats=cerPerf;},
      complete:()=>{_checkAllPartsMarked(sel);env.stats=cerPerf;},
      finalized:()=>!!_openFinalized[sel]
    };
  `)(env);
  return {env,api};
}

for (const role of ['admin','student']) {
  test(role + ' preview never grants rewards or writes performance', () => {
    const {env,api} = markingFixture('preview',role);
    api.record();
    assert.deepEqual(env.events,[]);
    assert.equal(env.stats,null);
  });
}

test('completing preview answers reveals feedback without attempts, rewards or logs', () => {
  const {env,api} = markingFixture();
  api.complete();
  assert.equal(api.finalized(),true);
  assert.deepEqual(env.events,['completed','explanation']);
  assert.equal(env.stats,null);
  api.complete();
  assert.deepEqual(env.events,['completed','explanation'],'A second completion does not reveal twice');
});

test('ordinary student practice still records completion and rewards', () => {
  const {env,api} = markingFixture('practice-open');
  api.complete();
  assert.equal(api.finalized(),true);
  assert.equal(env.events.filter(event=>event.write).length,3);
  assert.ok(env.events.some(event=>event.write==='questionAttempts'));
  for (const action of ['reward','local attempt','mistake log','completed','explanation']) {
    assert.ok(env.events.includes(action),action);
  }
  assert.equal(env.stats.attempts,1);
  assert.equal(env.stats.totalScore,1);
});

function interactiveFixture(mode = 'preview') {
  const pending = deferred();
  const env = {mode,pending:pending.promise,events:[],input:{value:'air',style:{}},feedback:{innerHTML:''},hint:{innerHTML:'',style:{display:'none'}}};
  const api = new Function('env', `
    const sel = '#studentPreviewBody';
    const _openQStore = {[sel]:{id:'preview',topic:'Respiration'}};
    const _openSurfaceCfg = {[sel]:{mode:env.mode}};
    const _fbStore = {[sel]:[{blockId:'blank',oidxs:[0],answers:['oxygen']}]};
    const _openItemsStore = {[sel]:[{label:'Answer',model:'oxygen'}]}, _openMcqStore = {[sel]:[]};
    const container = {querySelector:selector=>selector.includes('fb-input') ? env.input : env.feedback};
    const document = {querySelector:selector=>selector===sel ? container : env.hint};
    const window = {__aiReady:()=>true};
    const askGemini = ()=>env.pending;
    const _parseAIJson = JSON.parse;
    const _questionContext = ()=> 'Which gas is used?';
    const _markingPreamble = ()=>'', aiGrounding = ()=>'';
    const escapeHtml = value=>String(value);
    const _captureScienceCoachTarget = ()=>null;
    const _showScienceCoachFeedback = ()=>env.events.push('coach');
    const _setPartResult = (...args)=>env.events.push({mark:args});
    const _checkAllPartsMarked = ()=>env.events.push('completed');
    const rpgNoteHintUsed = ()=>env.events.push('RPG hint');
    const showToast = message=>env.events.push({toast:message});
    ${extract('fbCheck')}
    ${extract('hintQuestionPart')}
    return {
      check:()=>fbCheck(sel,'blank',{disabled:false,innerHTML:'Check answers'}),
      hint:()=>hintQuestionPart(sel,'open','0',{disabled:false,innerHTML:'Hint'}),
      change(action) {
        if(action==='reset') _openSurfaceCfg[sel]={mode:env.mode};
        if(action==='question') _openQStore[sel]={id:'another-question'};
        if(action==='close') {delete _openQStore[sel];delete _openSurfaceCfg[sel];}
      }
    };
  `)(env);
  return {env,api,resolve:pending.resolve};
}

for (const action of ['reset','question','close']) {
  test('late fill-blank result cannot mark after ' + action, async () => {
    const {env,api,resolve} = interactiveFixture();
    const checking = api.check();
    api.change(action);
    resolve('[{"i":0,"verdict":"correct"}]');
    await checking;
    assert.deepEqual(env.events,[]);
    assert.deepEqual(env.input.style,{});
  });
}

test('current fill-blank result still marks and completes the answer', async () => {
  const {env,api,resolve} = interactiveFixture();
  const checking = api.check();
  resolve('[{"i":0,"verdict":"correct"}]');
  await checking;
  assert.equal(env.events.filter(event=>event.mark).length,1);
  assert.ok(env.events.includes('completed'));
  assert.match(env.feedback.innerHTML,/1 \/ 1 correct/);
});

test('preview hints display normally without changing RPG state', async () => {
  const {env,api,resolve} = interactiveFixture();
  const hinting = api.hint();
  resolve('Think about the gas used in respiration.');
  await hinting;
  assert.match(env.hint.innerHTML,/gas used in respiration/);
  assert.equal(env.hint.style.display,'');
  assert.deepEqual(env.events,[]);
});

test('ordinary practice hints retain the existing RPG hint behavior', async () => {
  const {env,api,resolve} = interactiveFixture('practice-open');
  const hinting = api.hint();
  resolve('Think about respiration.');
  await hinting;
  assert.deepEqual(env.events,['RPG hint']);
});

for (const action of ['reset','question','close']) {
  test('late hint cannot update a discarded surface after ' + action, async () => {
    const {env,api,resolve} = interactiveFixture('practice-open');
    const hinting = api.hint();
    api.change(action);
    resolve('An old hint.');
    await hinting;
    assert.equal(env.hint.innerHTML,'');
    assert.deepEqual(env.events,[]);
  });
}

test('preview cleanup disposes annotation state and observers only for its own pads', () => {
  const disconnected = [];
  const env = {
    pads:{first:{strokes:[{}],ro:{disconnect:()=>disconnected.push('first')}},second:{strokes:[{}]},practice:{strokes:[{}]}},
    ids:['first','second','not-initialised']
  };
  const cleanup = new Function('env', `
    const _annotPads=env.pads;
    const document={querySelectorAll:selector=>{
      if(selector!=='#studentPreviewBody .dgn-pad[data-annot]') throw new Error('Wrong preview scope');
      return env.ids.map(id=>({getAttribute:()=>id}));
    }};
    ${extract('clearStudentPreviewPads')}
    return clearStudentPreviewPads;
  `)(env);
  cleanup();
  assert.deepEqual(disconnected,['first']);
  assert.deepEqual(Object.keys(env.pads),['practice']);
  cleanup();
  assert.deepEqual(disconnected,['first'],'Repeated cleanup is safe');
});
