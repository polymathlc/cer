// Run: node tools/editor-release-tests.mjs. Executes the real editor, collector,
// viewer gate, practice queue and Firestore writer against deterministic shims.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing source section ${start}`);
  return src.slice(a, b);
}
const core = cut('// ---- Scheduled release — a question that is IN the bank', 'function getQuestionsForLevel(');
const editor = cut('var _editorReleaseDraft = null;', 'function getYouTubeEmbedUrl(');
const collector = cut('function collectQuestionData()', 'function setEditMode(');
const metadata = cut('const EDITOR_OWNED_QUESTION_FIELDS', 'function saveEditedQuestion(');
const roles = cut('function _isAdmin()', 'function _navAllowed(');
const queue = cut('function buildQpQueue(', '// Student shortcut:');
function harness() {
  return new Function(`
    let currentUser = {role:'admin', email:'chungzhikai@gmail.com'};
    let currentEditingQuestion = null, blocks = [{id:'b', type:'text', content:'Edited question'}];
    let selectedBlanks = {}, editorKeywords = {b:['energy']}, editorLos = [];
    let questionBank = [], vettingList = [], saved = [], events = [], saveImpl = async () => true;
    let duplicateAllowed = true;
    const _ownerUidByQuestionId = {}, _ownerUidByVettingId = {}, _rapidJustAdded = new Set();
    const elements = {}, active = new Set();
    const controls = ['editorReleaseDate','editorReleaseSave','cancelRelease'];
    const document = {activeElement:null, getElementById(id) {
      return elements[id] ||= {value:'', textContent:'', disabled:false, isConnected:true,
        classList:{add(c){active.add(id+':'+c)}, remove(c){active.delete(id+':'+c)}},
        focus(){document.activeElement=this},
        querySelectorAll(){return controls.map(k=>document.getElementById(k))}};
    }};
    const window = {};
    function syncEditorDomToBlocks() {}
    const normalizeCategoryValue = x=>x, applyMcqCategory = x=>x, akdQuestionNote = ()=>'';
    const _snapTagsToBank = x=>x, parseTagInput = x=>x ? x.split(',') : [];
    function _dupGateSave(q, proceed) {if (duplicateAllowed) proceed()}
    async function saveQuestion(q, opts) {saved.push({q:structuredClone(q), opts}); return saveImpl(q,opts)}
    function showToast(msg, kind){events.push([kind,msg])}
    function setEditMode(){} function renderBlocks(){} function updateCounts(){}
    function renderQuestionBank(){} function renderVettingList(){}
    function _afterEditNavigate(){events.push(['return'])} function navigateTo(p){events.push(['navigate',p])}
    const escapeHtml = x=>String(x);
    const getLevelNumber = ()=>6, studentCapNum = ()=>6, qpFilters = ()=>({type:'all',topic:''});
    const qInSyllabus = ()=>true, qpFibOn = ()=>false, qpMatchesType = ()=>true;
    const qLevelNum = ()=>4, qWithinStudentLevel = ()=>true, _qAttemptStats = {};
    const orderByAttemptPriority = q=>q, qpLoadSeen = ()=>[];
    ${roles + core + collector + metadata + editor + queue}
    return {
      openEditorRelease, closeEditorRelease, saveEditorRelease, editorReleaseKeydown,
      editorReleaseValid, qReleased, qAvailableToViewer, qLockSplit, buildQpQueue,
      releaseToday, releaseDayFromNow, collectQuestionData, carryOverQuestionMeta,
      elements, document, active, saved, events, owners:_ownerUidByQuestionId,
      vetOwners:_ownerUidByVettingId,
      set user(x){currentUser=x}, set editing(x){currentEditingQuestion=x},
      get editing(){return currentEditingQuestion}, get blocks(){return blocks},
      set bank(x){questionBank=x}, get bank(){return questionBank},
      set vetting(x){vettingList=x}, get vetting(){return vettingList},
      set saveImpl(x){saveImpl=x}, set duplicateAllowed(x){duplicateAllowed=x}
    };
  `)();
}
function existing(h, where = 'bank') {
  const q = {id:'kept-id', title:'Original', releaseOn:h.releaseDayFromNow(10),
    createdAt:'2025-01-01', source:{pages:[1,2]}, answerKeywords:{b:['old']}};
  h[where] = [q]; h.editing=q.id;
  h.document.getElementById('questionTitle').value='Edited title';
  return q;
}

test('both editor action rows offer scheduling beside the bank save, with an accessible date dialog', () => {
  for (const id of ['createModeActions','editModeActions']) {
    const row = html.slice(html.indexOf(`id="${id}"`)).split('<!--')[0];
    assert.match(row, /onclick="openEditorRelease\(\)"/);
    assert.ok(row.indexOf('Question Bank') < row.indexOf('Schedule release'));
  }
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="editorReleaseTitle"/);
  assert.match(html, /for="editorReleaseDate"/);
  assert.match(html, /12:00 AM Singapore time/);
  for (const name of ['openEditorRelease','saveEditorRelease','closeEditorRelease','editorReleaseKeydown']) {
    assert.ok(src.includes(`window.${name} = ${name};`));
  }
});

test('opening, cancelling, duplicate refusal and student calls never save a question', () => {
  const h=harness(); h.openEditorRelease();
  assert.equal(h.elements.editorReleaseDate.value,h.releaseDayFromNow(1));
  h.closeEditorRelease(); assert.equal(h.bank.length,0); assert.equal(h.saved.length,0);
  assert.equal(h.blocks.length,1);
  h.duplicateAllowed=false; h.openEditorRelease(); assert.equal(h.active.size,0);
  h.user={role:'student'}; h.openEditorRelease(); assert.equal(h.active.size,0);
});

test('rejects missing, past, today and impossible calendar dates without writing', async () => {
  const h=harness(); h.openEditorRelease();
  for (const date of ['',h.releaseToday(),'2001-01-01','9999-02-30','2099-13-01','next week']) {
    h.elements.editorReleaseDate.value=date;
    assert.equal(await h.saveEditorRelease(),false,date);
  }
  assert.equal(h.saved.length,0); assert.equal(h.blocks.length,1);
});

test('editing preserves id, provenance and keywords and writes the chosen date with current edits', async () => {
  const h=harness(), q=existing(h); h.openEditorRelease();
  assert.equal(h.elements.editorReleaseDate.value,q.releaseOn);
  const on=h.releaseDayFromNow(20); h.elements.editorReleaseDate.value=on;
  assert.equal(await h.saveEditorRelease(),true);
  assert.equal(h.saved.length,1); assert.equal(h.bank.length,1);
  const result=h.saved[0].q;
  assert.equal(result.id,q.id); assert.equal(result.title,'Edited title');
  assert.equal(result.releaseOn,on); assert.equal(result.createdAt,q.createdAt);
  assert.deepEqual(result.source,q.source); assert.deepEqual(result.answerKeywords,{b:['energy']});
  assert.equal(result.blocks[0].content,'Edited question');
  assert.equal(h.editing,null); assert.equal(h.active.size,0);
  assert.ok(h.events.some(e=>e[0]==='return'));
  const next={id:q.id}; h.carryOverQuestionMeta(next);
  assert.equal(next.releaseOn,on,'ordinary edits preserve the schedule');
});

test('failed approval preserves the draft, Vetting question and previous owner mapping for retry', async () => {
  const h=harness(), q=existing(h,'vetting');
  h.owners[q.id]='previous'; h.vetOwners[q.id]='original-owner'; h.saveImpl=async()=>false;
  h.openEditorRelease(); assert.equal(await h.saveEditorRelease(),false);
  assert.equal(h.editing,q.id); assert.equal(h.vetting[0],q); assert.equal(h.bank.length,0);
  assert.equal(h.blocks.length,1); assert.equal(h.owners[q.id],'previous');
  assert.equal(h.elements.editorReleaseSave.disabled,false);
  assert.match(h.elements.editorReleaseError.textContent,/Could not save/);
  h.saveImpl=async()=>true; assert.equal(await h.saveEditorRelease(),true);
  assert.equal(h.vetting.length,0); assert.equal(h.bank.length,1);
  assert.equal(h.owners[q.id],'original-owner');
  assert.equal(h.saved[1].opts.fromVetting,true);
});

test('double click while saving creates one bank record; cancel cannot interrupt the write', async () => {
  const h=harness(); let finish;
  h.saveImpl=()=>new Promise(r=>{finish=r}); h.openEditorRelease();
  const first=h.saveEditorRelease();
  assert.equal(await h.saveEditorRelease(),false); h.closeEditorRelease();
  assert.equal(h.active.size,1); assert.equal(h.bank.length,0);
  finish(true); assert.equal(await first,true);
  assert.equal(h.saved.length,1); assert.equal(h.bank.length,1);
  assert.ok(h.bank[0].releaseOn); assert.equal(h.bank[0].status,'approved');
});

test('changed editor context refuses a stale schedule', async () => {
  const h=harness(); existing(h); h.openEditorRelease(); h.editing='another-question';
  assert.equal(await h.saveEditorRelease(),false); assert.equal(h.saved.length,0);
});

test('teacher practice and worksheets include held questions; student and practise-as-student do not', () => {
  const h=harness(), future={id:'future',releaseOn:h.releaseDayFromNow(2)}, live={id:'live'};
  h.bank=[future,live];
  assert.equal(h.qReleased(future),false,'release status itself remains date-only');
  assert.deepEqual(h.buildQpQueue('P6'),[future,live]);
  assert.deepEqual(h.qLockSplit(h.bank).ready,[future,live]);
  for (const email of ['student@example.com','chungzhikai@gmail.com']) {
    h.user={role:'student',email};
    assert.equal(h.qAvailableToViewer(future),false);
    assert.deepEqual(h.buildQpQueue('P6'),[live]);
    assert.deepEqual(h.qLockSplit(h.bank).locked,[future]);
  }
  assert.equal(h.qAvailableToViewer(future,future.releaseOn),true);
  h.user={role:'employee'}; assert.equal(h.qAvailableToViewer(future),true);
});

// Exercise the actual saveQuestion writer, including its retry/permission path.
function writerHarness() {
  return new Function(`
    let currentUser={}, _wkSuppress=0, _inflightOps=0, _saveQuestionLastError='';
    let failed=false; const db={}, records=new Map([['vetting/id',{id:'id'}]]), events=[];
    const _qRef=id=>'bank/'+id, _vRef=id=>'vetting/'+id, _setSaveStatus=()=>{};
    const _wkLogQuestion=()=>{}, styleHarvestQuestion=()=>{}, showToast=()=>{};
    const _xtAnnounceQuestion=(...args)=>events.push(args);
    const console={error(){},warn(){}};
    const setDoc=async(ref,value)=>records.set(ref,value);
    function writeBatch() {
      const pending=[];
      return {set(ref,value){pending.push(()=>records.set(ref,value))},
        delete(ref){pending.push(()=>records.delete(ref))},
        async commit(){if(failed) throw {code:'permission-denied'}; pending.forEach(fn=>fn())}};
    }
    ${cut('async function saveQuestion(q, opts)', "let _saveQuestionLastError = '';")}
    return {saveQuestion,records,events,set failed(x){failed=x}};
  `)();
}
test('atomic approval never removes Vetting on failure and announces both changes only after commit', async () => {
  const w=writerHarness(), q={id:'id',releaseOn:'2099-01-01'};
  w.failed=true;
  assert.equal(await w.saveQuestion(q,{fromVetting:true}),false);
  assert.equal(w.records.has('vetting/id'),true); assert.equal(w.records.has('bank/id'),false);
  assert.deepEqual(w.events,[]);
  w.failed=false;
  assert.equal(await w.saveQuestion(q,{fromVetting:true}),true);
  assert.equal(w.records.has('vetting/id'),false); assert.deepEqual(w.records.get('bank/id'),q);
  assert.deepEqual(w.events,[['id','bank','save'],['id','vetting','del']]);
});
test('ordinary bank writes still use the existing save path', async () => {
  const w=writerHarness(); assert.equal(await w.saveQuestion({id:'other'}),true);
  assert.equal(w.records.has('vetting/id'),true); assert.equal(w.records.has('bank/other'),true);
});
