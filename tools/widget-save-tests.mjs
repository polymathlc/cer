// App-bearing editor saves wait for durable publication + persistence before
// clearing the editor or moving a question between Bank and Vetting.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function cut(from,to){const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,from);return source.slice(a,b);}
function deferred(){let resolve;const promise=new Promise(ok=>resolve=ok);return{promise,resolve};}
const sections=[
  cut('let _widgetEditorSaving =','function widgetSetTokenLimit('),
  cut('async function addToBank() {','// Everything collectQuestionData()'),
  cut('async function _saveEditedQuestionConfirmed(q) {','// Edit mode: commit'),
  cut('async function _saveEditToBankConfirmed(q, id) {','function cancelEdit()'),
  cut('async function _addToVettingConfirmed(q) {','function clearForm()')
].join('\n');
function build(kind,result=true){
  const env={calls:[],toasts:[],result,kind,title:'Edited question',topic:'Respiration'};
  const api=new Function('env',`
    let blocks=[{id:'app1',type:'widget',html:'<html>Edited app</html>'}],selectedBlanks={},editorKeywords={};
    let currentUser={uid:'teacher'},currentEditingQuestion=['editBank','editVetting','approve'].includes(env.kind)?'q1':null;
    let questionBank=env.kind==='editBank'?[{id:'q1',title:'Old bank question',blocks:[]}]:[];
    let vettingList=['editVetting','approve'].includes(env.kind)?[{id:'q1',title:'Old vetted question',blocks:[]}]:[];
    const _ownerUidByVettingId={q1:'original-owner'},_ownerUidByQuestionId={},_rapidJustAdded=new Set(['q1']);
    const window={};
    function collectQuestionData(){return{id:'q1',createdAt:new Date().toISOString(),title:env.title,topic:env.topic,blocks:structuredClone(blocks)};}
    function showToast(message,type){env.toasts.push({message,type});}
    function updateCounts(){} function renderBlocks(){} function renderQuestionBank(){} function renderVettingList(){}
    function setEditMode(){} function navigateTo(page){env.calls.push({kind:'navigate',page});}
    function _afterEditNavigate(){env.calls.push({kind:'navigate',page:'return'});}
    function ppConsumePendingAttach(){}
    async function saveQuestion(q,opts){env.calls.push({kind:'saveBank',q:structuredClone(q),opts});return env.result;}
    async function saveVettingQuestion(q){env.calls.push({kind:'saveVetting',q:structuredClone(q)});return env.result;}
    function deleteVettingDoc(id){env.calls.push({kind:'deleteVetting',id});}
    ${sections}
    return{
      run(){const q=collectQuestionData();if(env.kind==='addBank')return addToBank();if(env.kind==='addVetting')return _addToVettingConfirmed(q);if(env.kind==='approve')return _saveEditToBankConfirmed(q,'q1');return _saveEditedQuestionConfirmed(q);},
      get blocks(){return blocks;},get bank(){return questionBank;},get vetting(){return vettingList;},get editing(){return currentEditingQuestion;},
      setBlocks(value){blocks=value;},setUser(uid){currentUser={uid};},setEditing(id){currentEditingQuestion=id;},
      get saving(){return _widgetEditorSaving;},get owner(){return _ownerUidByQuestionId.q1;}
    };
  `)(env);
  return{env,api};
}
const kinds=['addBank','addVetting','editBank','editVetting','approve'];
let scenarios=0;
for(const kind of kinds){
  {
    const {env,api}=build(kind,false),originalBlocks=api.blocks,bank=structuredClone(api.bank),vetting=structuredClone(api.vetting),editing=api.editing;
    await api.run();
    assert.equal(api.blocks,originalBlocks,kind+' preserves unsaved editor');
    assert.deepEqual(api.bank,bank,kind+' preserves bank');assert.deepEqual(api.vetting,vetting,kind+' preserves vetting');
    assert.equal(api.editing,editing,kind+' stays in edit mode');assert.equal(env.calls.filter(x=>x.kind==='navigate').length,0);
    assert.equal(env.calls.filter(x=>x.kind.startsWith('save')).length,1);assert.equal(api.saving,false);
    if(kind==='approve')assert.equal(api.owner,undefined,'Failed approval restores owner mapping');
    scenarios++;
  }
  {
    const {env,api}=build(kind,true);await api.run();
    const calls=env.calls.filter(x=>x.kind.startsWith('save'));assert.equal(calls.length,1,kind+' saves exactly once');
    assert.equal(calls[0].kind,['addVetting','editVetting'].includes(kind)?'saveVetting':'saveBank');
    const destination=['addVetting','editVetting'].includes(kind)?api.vetting:api.bank;
    assert.equal(destination.length,1);assert.equal(destination[0].title,'Edited question');assert.equal(api.editing,null);
    if(kind==='approve'){
      assert.equal(calls[0].opts.fromVetting,true,'Approval uses atomic bank+vetting operation');
      assert.equal(api.vetting.length,0);assert.equal(env.calls.filter(x=>x.kind==='deleteVetting').length,0,'No second delete after atomic move');
      assert.equal(api.owner,'original-owner');
    }
    scenarios++;
  }
  {
    const pending=deferred(),{env,api}=build(kind,pending.promise),original=api.blocks;
    const first=api.run();await api.run();assert.equal(env.calls.filter(x=>x.kind.startsWith('save')).length,1,kind+' blocks duplicate clicks');
    assert.equal(api.blocks,original,'The form stays until durable success');pending.resolve(true);await first;scenarios++;
  }
  for(const race of ['typed','replacement','account','editing','title','topic']){
    const pending=deferred(),{env,api}=build(kind,pending.promise),bank=structuredClone(api.bank),vetting=structuredClone(api.vetting);
    const saving=api.run();
    if(race==='typed')api.blocks[0].html='<html>Newer edit</html>';
    if(race==='replacement')api.setBlocks([{id:'next',type:'widget',html:'<html>Next editor</html>'}]);
    if(race==='account')api.setUser('another-teacher');
    if(race==='editing')api.setEditing('next-question');
    if(race==='title')env.title='Newer question title';
    if(race==='topic')env.topic='Newer topic';
    const newer=api.blocks;pending.resolve(true);await saving;
    assert.equal(api.blocks,newer,kind+'/'+race+' preserves current editor');
    assert.deepEqual(api.bank,bank);assert.deepEqual(api.vetting,vetting);
    assert.equal(env.calls.filter(x=>x.kind==='navigate').length,0);
    assert.match(env.toasts.at(-1).message,/newer editor changes/);assert.equal(api.saving,false);scenarios++;
  }
}
console.log(scenarios+' app editor save scenarios passed.');
