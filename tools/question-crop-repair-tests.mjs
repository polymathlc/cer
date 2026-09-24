// Execute the real crop approval adapter with real crop geometry/provenance.
// Image downloads, model responses, canvas and storage are counted fixtures.
import assert from 'node:assert/strict';
import {harness,sampleQuestion,samplePlan,deferred,settle} from './question-repair-tests.mjs';

export function cropQuestion(original=true){
  const q=sampleQuestion();
  if(original)q.blocks[1].cropSource={url:'https://fixtures.test/full-page.png',imageUrl:q.blocks[1].url,original:true,box_2d:[100,100,700,800]};
  return q;
}
export function cropFindings(status='clipped'){
  return [{type:'Crop',severity:status==='clipped'?'high':'med',title:'The flowchart crop needs correction',
    detail:status==='clipped'?'Restore the full starting box, branches and labels from the original page.':'Remove the duplicated question sentence outside the complete figure.',
    fix:'cropImage',target:'block:diagram:url',cropStatus:status,ai:true}];
}
export function cropPlan(){return {actions:[{kind:'recrop_image',target:'block:diagram:url',reason:'Restore the complete flowchart.',instruction:'Include the full starting box, branches and labels; exclude surrounding question prose.'}],notes:[]};}
async function start(h,findings=cropFindings()){
  h.tlRepairRefresh(h.tlRepairRead(h.scope,'q1'),{state:'red',findings});await settle();assert.equal(h.session.stage,'ready',h.session.message);
}
function cropReplies(h,{source='source-1',box=[100,100,800,900],audit={complete:true,clipped:false,strayText:false,detail:'Complete figure, no stray prose.'}}={}){
  h.H.aiImpl=async prompt=>prompt.startsWith('Select a new crop')?{complete:true,source,box_2d:box,detail:'Restored the starting box.'}:
    prompt.startsWith('Verify a corrected')?audit:h.H.aiReply;
}
const cases=[];
const test=(name,run)=>cases.push({name,run});

test('crop findings produce crop actions without redrawing or uploading before approval',async()=>{
  const h=harness({question:cropQuestion(),plan:samplePlan(true)});await start(h);
  assert.equal(h.session.plan.actions.find(a=>a.target==='block:diagram:url').kind,'recrop_image');
  assert.deepEqual([h.H.image.length,h.H.uploads.length,h.H.saves.length,h.H.cropPixels.length],[0,0,0,0]);
});
test('approved automatic crop selects and verifies original pixels, then persists provenance',async()=>{
  const h=harness({question:cropQuestion(),plan:cropPlan(),scope:'bank'});await start(h);cropReplies(h);
  await h.tlRepairApply();assert.equal(h.session.stage,'applied',h.session.message);
  assert.equal(h.H.image.length,0,'Neither redraw nor image generation is used');assert.equal(h.H.ai.length,3);
  assert.equal(h.H.uploads.length,1);assert.equal(h.H.saves.length,1);assert.equal(h.H.cropPixels.length,1);
  assert.deepEqual(h.H.cropPixels[0].slice(1),[100,80,800,560,16,16,800,560]);
  const crop=h.bank[0].blocks[1].cropSource;
  assert.equal(crop.url,'https://fixtures.test/full-page.png');assert.equal(crop.imageUrl,'https://fixtures.test/generated.png');
  assert.deepEqual(crop.box_2d,[100,100,800,900]);assert.equal(crop.original,true);
  assert.equal(h.H.checks.length,1);
  await h.tlRepairUndo();assert.deepEqual(h.bank[0],cropQuestion());
});
test('clipped content without an original refuses automatic cropping and keeps manual controls',async()=>{
  const h=harness({question:cropQuestion(false),plan:cropPlan()});await start(h);cropReplies(h,{source:'current'});
  await h.tlRepairApply();assert.equal(h.session.stage,'error');assert.match(h.session.message,/original page is unavailable/);
  assert.equal(h.H.ai.length,1);assert.equal(h.H.uploads.length,0);assert.deepEqual(h.blocks,cropQuestion(false).blocks);
  assert.match(h.document.getElementById('tlRepairCropTools').innerHTML,/Crop manually/);
});
test('stray wording can be trimmed from a complete current picture without an original',async()=>{
  const h=harness({question:cropQuestion(false),plan:cropPlan()});await start(h,cropFindings('stray_text'));
  cropReplies(h,{source:'current'});await h.tlRepairApply();assert.equal(h.session.stage,'applied',h.session.message);
  assert.equal(h.blocks[1].cropSource.original,false);assert.equal(h.H.image.length,0);assert.equal(h.H.uploads.length,1);
});
test('unknown sources, unsafe rectangles and an incomplete crop audit cannot change anything',async()=>{
  for(const overrides of [{source:'https://untrusted.test/replacement.png'},{source:'current'},{box:[0,0,1001,900]},
    {audit:{complete:true,clipped:true,strayText:false}},{audit:{complete:true,clipped:false}},{audit:{complete:false,clipped:false,strayText:false}}]){
    const h=harness({question:cropQuestion(),plan:cropPlan()});await start(h);cropReplies(h,overrides);
    await h.tlRepairApply();assert.equal(h.session.stage,'error');assert.equal(h.H.uploads.length,0);
    assert.equal(h.H.saves.length,0);assert.deepEqual(h.blocks,cropQuestion().blocks);
  }
});
test('a crop selection cancelled or made stale before it resolves cannot apply or upload',async()=>{
  for(const mutation of [h=>h.tlRepairCancel(),h=>{h.blocks[0].content='Newer edit';},h=>{h.user={uid:'other',role:'admin'};}]){
    const h=harness({question:cropQuestion(),plan:cropPlan()}),d=deferred();await start(h);
    h.H.aiImpl=()=>d.promise;const pending=h.tlRepairApply();await settle();mutation(h);const before=structuredClone(h.blocks);
    d.resolve({complete:true,source:'source-1',box_2d:[100,100,800,900]});await pending;
    assert.deepEqual(h.blocks,before);assert.equal(h.H.uploads.length,0);assert.equal(h.H.saves.length,0);
  }
});
test('one failed action keeps both the crop and wording unchanged',async()=>{
  const plan=cropPlan();plan.actions.unshift(samplePlan().actions[0]);
  const h=harness({question:cropQuestion(),plan,scope:'vet'});await start(h);cropReplies(h,{audit:{complete:false,clipped:true,strayText:false}});
  const before=structuredClone(h.vetting[0]);await h.tlRepairApply();assert.deepEqual(h.vetting[0],before);
  assert.equal(h.H.saves.length,0);assert.equal(h.H.uploads.length,0);
});
test('a later failed crop never leaves an earlier cropped image applied on its own',async()=>{
  const plan=cropPlan();plan.actions.push({kind:'recrop_image',target:'block:diagram:answerImg',reason:'Trim the answer figure.',instruction:'Remove surrounding prose.'});
  const h=harness({question:cropQuestion(),plan,scope:'bank'});await start(h);cropReplies(h);
  const before=structuredClone(h.bank[0]);await h.tlRepairApply();
  assert.equal(h.session.stage,'error');assert.equal(h.H.uploads.length,1,'First crop succeeded before the second selection was refused');
  assert.deepEqual(h.bank[0],before);assert.equal(h.H.saves.length,0);assert.equal(h.H.checks.length,0);
});
test('a failed crop save preserves the original question and its provenance',async()=>{
  const h=harness({question:cropQuestion(),plan:cropPlan(),scope:'vet'});await start(h);cropReplies(h);h.H.saveImpl=async()=>false;
  const before=structuredClone(h.vetting[0]);await h.tlRepairApply();assert.equal(h.session.stage,'error');
  assert.deepEqual(h.vetting[0],before);assert.equal(h.H.checks.length,0);assert.equal(h.H.uploads.length,1);
});
test('manual cropping stages a preview without upload and only Implement changes the question',async()=>{
  const h=harness({question:cropQuestion(),plan:cropPlan()});await start(h);
  await h.tlRepairManualCrop(0);assert.equal(h.session.stage,'cropping');assert.equal(h.H.cropOpen.id,null);
  assert.deepEqual(h.H.cropOpen.options.box,[100,100,700,800]);assert.equal(h.H.cropOpen.options.guard(),true);
  const data='data:image/png;base64,bWFudWFs';
  await h.H.cropOpen.options.onApply(data,[50,100,850,950]);
  assert.equal(h.session.stage,'ready');assert.equal(h.session.manualCrops['block:diagram:url'].dataUrl,data);
  assert.match(h.document.getElementById('tlRepairActions').innerHTML,/Your proposed crop/);
  assert.equal(h.H.uploads.length,0);assert.deepEqual(h.blocks,cropQuestion().blocks);
  await h.tlRepairApply();assert.equal(h.session.stage,'applied',h.session.message);assert.equal(h.H.ai.length,1,'Manual selection skips automatic crop model calls');
  assert.deepEqual(h.H.uploads,[data]);assert.deepEqual(h.blocks[1].cropSource.box_2d,[50,100,850,950]);
});
test('closing manual controls leaves the reviewed plan and question intact',async()=>{
  const h=harness({question:cropQuestion(),plan:cropPlan()});await start(h);const plan=structuredClone(h.session.plan);
  await h.tlRepairManualCrop(0);h.tlRepairCropClosed(false);
  assert.equal(h.session.stage,'ready');assert.deepEqual(h.session.plan,plan);assert.equal(h.picker,null);
  assert.equal(h.H.uploads.length,0);assert.deepEqual(h.blocks,cropQuestion().blocks);
});
test('a manual preview callback rejects stale content and cancelled sessions',async()=>{
  for(const mutate of [h=>{h.blocks[0].content='Newer edit';},h=>h.tlRepairCancel()]){
    const h=harness({question:cropQuestion(),plan:cropPlan()});await start(h);await h.tlRepairManualCrop(0);
    const callback=h.H.cropOpen.options.onApply;mutate(h);const before=structuredClone(h.blocks);
    await assert.rejects(callback('data:image/png;base64,bWFudWFs',[0,0,1000,1000]),/question or account changed/i);
    assert.deepEqual(h.blocks,before);assert.equal(h.H.uploads.length,0);assert.equal(h.H.saves.length,0);
  }
});
test('selecting an original file stays local until the crop is implemented',async()=>{
  const h=harness({question:cropQuestion(false),plan:cropPlan()});await start(h);await h.tlRepairManualCrop(0);
  const data='data:image/png;base64,b3JpZ2luYWw=';
  await h.tlRepairCropUpload({type:'image/png',size:100,data});assert.equal(h.picker.source.original,true);
  assert.equal(h.H.uploads.length,0);assert.equal(h.H.cropOpen.options.srcUrl,'data:image/png;base64,ZmFrZQ==');
  await h.H.cropOpen.options.onApply('data:image/png;base64,bWFudWFs',[0,0,1000,1000]);
  await h.tlRepairApply();assert.equal(h.session.stage,'applied',h.session.message);
  assert.equal(h.H.uploads.length,2,'Original source and selected crop persist only on Implement');
  assert.equal(h.H.uploads[0],data);assert.equal(h.blocks[1].cropSource.original,true);
});
test('unsupported or oversized original files cannot replace the crop source',async()=>{
  const h=harness({question:cropQuestion(false),plan:cropPlan()});await start(h);await h.tlRepairManualCrop(0);
  const before=h.picker.sources.length;
  for(const file of [{type:'application/pdf',size:100},{type:'image/png',size:25000001}])await h.tlRepairCropUpload(file);
  assert.equal(h.picker.sources.length,before);assert.equal(h.H.uploads.length,0);
  assert.match(h.document.getElementById('cropSourceHelp').textContent,/PNG, JPEG or WebP/);
});
test('switching sources immediately disables the stale crop and ignores out-of-order downloads',async()=>{
  const h=harness({question:cropQuestion(),plan:cropPlan()}),d=deferred();await start(h);await h.tlRepairManualCrop(0);
  const old=h.H.cropOpen.options;h.H.mediaImpl=async url=>url===cropQuestion().blocks[1].url?await d.promise:'data:image/png;base64,b3JpZ2luYWw=';
  const pending=h.tlRepairCropSourceChanged('1');await settle();
  assert.equal(h.cropper,null);assert.equal(h.document.getElementById('cropApplyBtn').disabled,true);assert.equal(old.guard(),false);
  await h.tlRepairCropSourceChanged('0');assert.equal(h.picker.source.original,true);
  d.resolve('data:image/png;base64,bGF0ZQ==');await pending;
  assert.equal(h.picker.source.original,true);assert.equal(h.H.cropOpen.options.srcUrl,'data:image/png;base64,b3JpZ2luYWw=');
  assert.equal(h.H.uploads.length,0);assert.equal(h.session.stage,'cropping');
});
test('only the latest asynchronously selected original file becomes a crop source',async()=>{
  const readers=[];
  class Reader{readAsDataURL(file){readers.push({reader:this,file});}}
  const h=harness({question:cropQuestion(),plan:cropPlan(),FileReader:Reader});await start(h);await h.tlRepairManualCrop(0);
  const before=h.picker.sources.length;
  const first=h.tlRepairCropUpload({type:'image/png',size:100}),second=h.tlRepairCropUpload({type:'image/png',size:200});
  assert.equal(h.cropper,null);assert.equal(h.document.getElementById('cropApplyBtn').disabled,true);
  readers[1].reader.result='data:image/png;base64,c2Vjb25k';readers[1].reader.onload();await second;
  readers[0].reader.result='data:image/png;base64,Zmlyc3Q=';readers[0].reader.onload();await first;
  assert.equal(h.picker.sources.length,before+1);assert.equal(h.picker.source.url,'data:image/png;base64,c2Vjb25k');
  assert.equal(h.H.uploads.length,0);
});
test('manual adjustment after an applied plan never repeats its old image or insertion actions',async()=>{
  const plan=samplePlan(true);plan.actions.push({kind:'add_block',target:'new:explanation',reason:'Add the missing explanation.',value:'Air has mass.'});
  const h=harness({question:cropQuestion(),plan});await start(h,[{type:'Wording',severity:'med',title:'Correct wording and explanation',detail:'Use the requested correction.'}]);
  await h.tlRepairApply();assert.equal(h.session.stage,'applied');assert.equal(h.H.image.length,1);assert.equal(h.blocks.length,4);
  await h.tlRepairManualCrop(0);await h.H.cropOpen.options.onApply('data:image/png;base64,bWFudWFs',[0,0,1000,1000]);
  assert.equal(h.session.plan.actions.length,1);assert.equal(h.session.plan.actions[0].kind,'recrop_image');
  await h.tlRepairApply();assert.equal(h.session.stage,'applied');assert.equal(h.H.image.length,1);assert.equal(h.blocks.length,4);
});

let failed=0;
for(const item of cases){try{await item.run();console.log('PASS',item.name);}catch(error){failed++;console.error('FAIL',item.name,error.stack);}}
console.log(cases.length-failed+' passed, '+failed+' failed');if(failed)process.exitCode=1;
