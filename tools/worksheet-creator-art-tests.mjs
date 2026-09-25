// Run: node tools/worksheet-creator-art-tests.mjs
// Exercises the actual standalone editor's persistence, exports and asynchronous AI edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../science-worksheet.html', import.meta.url), 'utf8');
const artSource = fs.readFileSync(new URL('../worksheet-art.js', import.meta.url), 'utf8');
const section = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Missing section: ${from}`);
  return source.slice(start, end);
};
const fn = name => section(`function ${name}(`, 'function ').replace(/async\s*$/, '');
const ctx = vm.createContext({URL, Map, Set, console, Blob, fetch:async()=>{
  ctx.fetches++;
  return {ok:true, blob:async()=>new Blob(['sprite'],{type:'image/webp'})};
},fetches:0,document:{currentScript:{src:'https://polymathlc.github.io/cer/worksheet-art.js'},getElementById:()=>null},
FileReader:class {readAsDataURL(){this.result='data:image/webp;base64,c3ByaXRl';this.onload();}}});
vm.runInContext('globalThis.window=globalThis;window.parent=window;',ctx);
vm.runInContext(artSource,ctx);
vm.runInContext(`
  let state={title:'Magnets',questions:[]};let serial=0;let saved=0;let editable=true;
  const newId=()=>String(++serial);const escapeAttr=WorksheetArt.escapeHtml;const escapeHtml=escapeAttr;
  function scheduleAutoSave(){saved++;}function previewEditingEnabled(){return editable;}
  function renderPreview(){}function renderEditor(){}
  function isInstruction(q){return q.kind==='instruction';}
  function questionDisplayNumber(i){return i+1;}
  function formatTextWithFractions(t){return escapeHtml(t||'');}
  let showSources=false;
  ${section('// Worksheet art stays on the element', '(function installWorksheetArtStyles')}
  ${['makeElement','elementToHtml','elementToPrintHtml','questionToHtml','questionToPrintHtml',
    'getEmbeddedPreviewCss','serializeStateForCloud','reidQuestion','moveElement','removeElement'].map(fn).join('\n')}
  globalThis.testApi={setState:s=>state=s,getState:()=>state,setEditable:v=>editable=v,getSaved:()=>saved,
    makeElement,elementToHtml,elementToPrintHtml,questionToHtml,questionToPrintHtml,
    getEmbeddedPreviewCss,serializeStateForCloud,reidQuestion,moveElement,removeElement,
    worksheetArtPrompt,fillWorksheetArtText,inlineWorksheetArtImages,worksheetArtHtml};
`,ctx);
const api=ctx.testApi;
const science=api.makeElement('scienceArt');
const bubble=api.makeElement('tutorBubble');
Object.assign(bubble,{character:'nova',pose:'thinking',bubbleType:'reminder',text:'Compare <the poles> & look for a pattern.',size:'large'});
const q={id:'q1',elements:[{id:'stem',type:'text',text:'How do two magnets interact?'},science,bubble,{id:'answer',type:'answerKey',text:'Do not send this answer to AI'}]};
api.setState({title:'Magnets',questions:[q]});
assert.equal(science.kind,'science');assert.equal(bubble.kind,'character');
assert.ok(science.id!==bubble.id);

// These fields must survive the real cloud serializer and question-copy workflow.
const restored=JSON.parse(api.serializeStateForCloud(api.getState()));
assert.deepEqual(restored.questions[0].elements[2],JSON.parse(JSON.stringify(bubble)));
const copied=api.reidQuestion(q);
assert.notEqual(copied.elements[2].id,bubble.id);
assert.equal(copied.elements[2].text,bubble.text);
api.moveElement(q,2,-1);
assert.equal(q.elements[1],bubble);
api.moveElement(q,1,1);

// Preview and print use identical escaped content and packaged Tutor art.
for(const render of [api.elementToHtml,api.elementToPrintHtml]) {
  assert.match(render(science,0,1),/<svg\b/);
  const html=render(bubble,0,2);
  assert.match(html,/nova-thinking\.webp/);
  assert.match(html,/Compare &lt;the poles&gt; &amp; look for a pattern\./);
  assert.doesNotMatch(html,/<the poles>/);
  assert.match(html,/width="\d+" height="\d+"/);
}
assert.match(api.questionToHtml(q,0),/nova-thinking/);
assert.match(api.questionToPrintHtml(q,0),/nova-thinking/);
assert.match(api.getEmbeddedPreviewCss(),/print-color-adjust/);
assert.match(source,/case"scienceArt":case"tutorBubble":qParts\.push\(worksheetArtHtml\(el\)\)/);
assert.match(source,/case"scienceArt":case"tutorBubble":return buildWorksheetArtPreview\(el,editable\)/);
assert.match(source,/\["Colourful science art","scienceArt"\]/);

await api.inlineWorksheetArtImages();
assert.equal(ctx.fetches,1);
assert.match(api.elementToHtml(bubble,0,2),/src="data:image\/webp;base64,c3ByaXRl"/);
await api.inlineWorksheetArtImages();
assert.equal(ctx.fetches,1,'the same sprite is only fetched once');
assert.doesNotMatch(api.serializeStateForCloud(api.getState()),/c3ByaXRl/,'export bytes do not bloat cloud saves');

const input={value:bubble.text,focus(){this.focused=true;}};
const preview={innerHTML:''};const status={textContent:''};
const controls=[{disabled:false},{disabled:false}];
const prompt=api.worksheetArtPrompt(bubble,false);
assert.match(prompt,/How do two magnets interact/);
assert.doesNotMatch(prompt,/Do not send this answer/);
assert.match(prompt,/do not reveal the answer/);
assert.match(api.worksheetArtPrompt(bubble,true),/Keep its meaning and science facts unchanged/);
ctx.worksheetArtAskAI=async()=> 'Look at the poles facing each other.';
await api.fillWorksheetArtText(bubble,false,controls,input,preview,status);
assert.equal(bubble.text,'Look at the poles facing each other.');
assert.equal(input.value,bubble.text);assert.match(preview.innerHTML,/Look at the poles/);
assert.ok(api.getSaved()>0);assert.ok(controls.every(b=>!b.disabled));

// A slow reply may never overwrite newer typing or a restored/deleted worksheet.
let finish;
ctx.worksheetArtAskAI=()=>new Promise(resolve=>finish=resolve);
const pending=api.fillWorksheetArtText(bubble,true,controls,input,preview,status);
bubble.text='My newer wording';finish('Stale AI wording');await pending;
assert.equal(bubble.text,'My newer wording');assert.match(status.textContent,/text changed/);
const removedPending=api.fillWorksheetArtText(bubble,false,controls,input,preview,status);
api.removeElement(q,q.elements.indexOf(bubble));finish('Removed bubble reply');await removedPending;
assert.equal(bubble.text,'My newer wording');assert.ok(!q.elements.includes(bubble));

q.elements.push(bubble);
ctx.worksheetArtAskAI=async()=>{throw new Error('AI temporarily unavailable');};
await api.fillWorksheetArtText(bubble,true,controls,input,preview,status);
assert.equal(bubble.text,'My newer wording');assert.match(status.textContent,/AI temporarily unavailable/);
assert.ok(controls.every(b=>!b.disabled));
delete ctx.worksheetArtAskAI;
await api.fillWorksheetArtText(bubble,false,controls,input,preview,status);
assert.match(status.textContent,/Science Learning Portal/);
assert.match(source,/el\.kind==='character' && worksheetArtAiRoute\(\)/,'unavailable standalone AI controls are hidden');
ctx.opener={closed:false,worksheetArtAskAI:async()=> 'Remember to identify both poles.'};
await api.fillWorksheetArtText(bubble,false,controls,input,preview,status);
assert.equal(bubble.text,'Remember to identify both poles.','same-origin CER opener can provide AI');
console.log('Worksheet Creator art: persistence, ordering, exports, offline sprites and AI race/error handling passed.');
