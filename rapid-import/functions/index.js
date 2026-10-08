import { randomUUID, createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getFunctions } from 'firebase-admin/functions';
import { GoogleGenAI } from '@google/genai';
import { createCanvas, loadImage, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { MAX_PDF_BYTES, CHUNK_BYTES, MAX_PAGES, parseReply, blockType, normaliseQuestion, assemblePage, signature, html } from './core.js';
import { cropDiagramEx, cropWordingOf, refinePrompt, subCrop } from './crop.js';
import { decisionsReview, decisionsAllow, DecisionsUnavailable } from './decisions.js';
import { figureFacts, figureHardIssues, questionFacts, questionHardIssues, decideReview, failuresToFindings, recropReasons, migrateDecisionsReviewState } from './decisions-review-core.js';
import { FIGURE_KINDS, CLASSIFY_FIGURE_PROMPT, figureMode, imageInstruction, originalImageUrl, adoptOriginal, figureFixTargets, storageImagePath, enhancementFindings, nextImageIndex, requireImageAudits } from './image-core.js';
import { rapidAiOrder, createRapidAiRouter, createOptionalKimiKeyReader } from './ai-routing.js';

const firebaseApp = initializeApp();
Object.assign(globalThis, {DOMMatrix, ImageData, Path2D});
const db = getFirestore();
const bucket = () => getStorage().bucket('mathgen--app.firebasestorage.app');
const key = defineSecret('GEMINI_API_KEY');
const openaiKey = defineSecret('OPENAI_API_KEY');
// Review decisions use the shared server-side OpenAI secret.
const openaiModel = defineString('RAPID_IMPORT_OPENAI_MODEL', {default:'gpt-6.1-sol'});
const kimiModel = defineString('RAPID_IMPORT_KIMI_MODEL', {default:'kimi-k3'});
const model = defineString('RAPID_IMPORT_MODEL', {default:'gemini-2.5-flash'});
const imageModel = defineString('RAPID_IMPORT_IMAGE_MODEL', {default:'gemini-3.1-flash-image'});
const JOBS = 'cerRapidImports';
const callOpts = {region:'us-central1', timeoutSeconds:120, memory:'512MiB', maxInstances:4};
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const jobRef = id => db.collection(JOBS).doc(id);
// Never trust a role or owner UID sent by the browser. Match the trusted
// admin claim / verified allowlist used by the existing Maths backend.
function admin(request) {
  const a = request.auth;
  if (!a) throw new HttpsError('unauthenticated','Sign in first.');
  const verifiedAdmin = a.token.email_verified && ['chungzhikai@gmail.com','abigail.yew@stanfordmanpower.com'].includes(a.token.email);
  if (a.token.admin !== true && !verifiedAdmin) throw new HttpsError('permission-denied','Online PDF imports require an administrator account.');
  return a;
}
async function owned(request) {
  const a = admin(request), id = request.data?.id;
  if (!validId(id)) throw new HttpsError('invalid-argument','Invalid import ID.');
  const ref = jobRef(id), snap = await ref.get();
  if (!snap.exists || snap.data().ownerUid !== a.uid) throw new HttpsError('not-found','Import not found.');
  return {ref, job:snap.data()};
}
const stale = j => j.status === 'queued' && Date.now()-Date.parse(j.updatedAt)>60*60*1000;
const publicJob = j => ({id:j.id,name:j.name,status:stale(j)?'failed':j.status,page:j.nextPage-1,total:j.total||0,added:j.added||0,error:j.error||(stale(j)?'Worker has not progressed for an hour. Retry to resume.':''),updatedAt:j.updatedAt});
export const rapidImportStatus = onCall(callOpts, async request => {
  const a = admin(request);
  // Single-field query needs no new index; sort after the bounded read.
  const snaps = await db.collection(JOBS).where('ownerUid','==',a.uid).get();
  return {available:true,maxBytes:MAX_PDF_BYTES,maxPages:MAX_PAGES,chunkBytes:CHUNK_BYTES,
    capabilities:{imageEditing:true,automaticChecks:true,automaticEnhancement:true},
    jobs:snaps.docs.map(s=>publicJob(s.data())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100)};
});
// Decisions, for the browser importer. The browser sends measured FACTS about a crop
// or a question and gets typed verdicts back; the decision is made in the page
// with the same shared core. Administrator only, counted, and never persisted.
export const cerDecisionsReview = onCall({...callOpts, timeoutSeconds:30, memory:'256MiB', secrets:[openaiKey]}, async request => {
  const a = admin(request);
  if (!await decisionsAllow(db, a.uid)) throw new HttpsError('resource-exhausted','Decisions has reached its allowance. The AI will check instead.');
  try { return {available:true, verdicts: await decisionsReview(request.data, {apiKey:()=>openaiKey.value()})}; }
  catch(e) {
    if (!(e instanceof DecisionsUnavailable)) throw e;
    if (e.code==='invalid') throw new HttpsError('invalid-argument',e.message);
    throw new HttpsError(e.code==='not_configured'?'failed-precondition':'unavailable',e.message);
  }
});
export const rapidImportBegin = onCall(callOpts, async request => {
  const a=admin(request), d=request.data||{};
  if (!validId(d.id) || !Number.isInteger(d.size) || d.size<=0 || d.size>MAX_PDF_BYTES) throw new HttpsError('invalid-argument','PDF limit: 40 MB per file.');
  if (typeof d.prompt !== 'string' || d.prompt.length>100000 || !d.prompt.trim()) throw new HttpsError('invalid-argument','Missing reading instructions.');
  const release = String(d.release||'');
  if (release && !/^\d{4}-\d{2}-\d{2}$/.test(release)) throw new HttpsError('invalid-argument','Invalid release date.');
  const ref=jobRef(d.id), now=new Date().toISOString();
  await db.runTransaction(async tx=>{
    const existing=await tx.get(ref);
    if(existing.exists) {
      if(existing.data().ownerUid!==a.uid || existing.data().size!==d.size) throw new HttpsError('already-exists','Import ID already used.');
      return;
    }
    tx.create(ref,{id:d.id,ownerUid:a.uid,size:d.size,name:String(d.name||'PDF').slice(0,180),status:'uploading',
      prompt:d.prompt,engineOrder:rapidAiOrder(d.engineOrder),grounding:String(d.grounding||'').slice(0,80000),topics:Array.isArray(d.topics)?d.topics.slice(0,100).map(String):[],
      level:String(d.level||''),release,autoCheck:true,enhanceImages:true,createdBy:String(a.token.name||a.token.email||'Admin'),
      createdAt:now,updatedAt:now,nextPage:1,added:0,generation:0,phase:'page',publishIndex:0,figureIndex:0});
  });
  return {id:d.id};
});
export const rapidImportChunk = onCall(callOpts, async request => {
  const {job}=await owned(request), d=request.data;
  if(job.status!=='uploading') return {uploaded:true};
  const count=Math.ceil(job.size/CHUNK_BYTES);
  if(!Number.isInteger(d.index)||d.index<0||d.index>=count||typeof d.data!=='string'||d.data.length>CHUNK_BYTES*4/3+4) throw new HttpsError('invalid-argument','Invalid upload chunk.');
  const buf=Buffer.from(d.data,'base64');
  const expected=Math.min(CHUNK_BYTES,job.size-d.index*CHUNK_BYTES);
  if(buf.length!==expected) throw new HttpsError('invalid-argument','Incomplete upload chunk.');
  if(d.index===0 && !buf.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw new HttpsError('invalid-argument','This is not a PDF.');
  // Create-only, so a retried chunk cannot overwrite a finalised PDF.
  try { await bucket().file(`cer-rapid/${job.ownerUid}/${job.id}/chunks/${d.index}`).save(buf,{resumable:false,preconditionOpts:{ifGenerationMatch:0}}); }
  catch(e) { if(Number(e.code)!==412) throw e; }
  return {uploaded:true};
});
export const rapidImportFinish = onCall({...callOpts,memory:'1GiB'}, async request=>{
  const {ref,job}=await owned(request);
  if(job.status!=='uploading') return {queued:true};
  const chunks=[];
  for(let i=0;i<Math.ceil(job.size/CHUNK_BYTES);i++) chunks.push((await bucket().file(`cer-rapid/${job.ownerUid}/${job.id}/chunks/${i}`).download())[0]);
  const pdf=Buffer.concat(chunks);
  if(pdf.length!==job.size) throw new HttpsError('failed-precondition','The PDF upload is incomplete.');
  const path=`cer-rapid/${job.ownerUid}/${job.id}/original.pdf`;
  await bucket().file(path).save(pdf,{resumable:false,contentType:'application/pdf'});
  await db.runTransaction(async tx=>{
    const latest=await tx.get(ref);
    if(latest.data().status==='uploading') tx.update(ref,{status:'queued',path,updatedAt:new Date().toISOString()});
  });
  // Durable Firestore transition is the outbox: enqueueing does NOT depend
  // on this request or browser staying alive after the acknowledgement.
  return {queued:true};
});
export const rapidImportRetry = onCall(callOpts, async request=>{
  const {ref}=await owned(request);
  await db.runTransaction(async tx=>{
    const j=(await tx.get(ref)).data();
    if(j.status!=='failed' && !stale(j)) throw new HttpsError('failed-precondition','Only failed jobs can be retried.');
    tx.update(ref,{status:'queued',generation:j.generation+1,error:'',updatedAt:new Date().toISOString()});
  });
  return {queued:true};
});
export const rapidImportDispatch = onDocumentWritten({document:JOBS+'/{id}',region:'us-central1',retry:true},async event=>{
  const j=event.data?.after.data(), old=event.data?.before.data();
  if(!j || j.status!=='queued') return;
  if(old?.status==='queued' && old.nextPage===j.nextPage && old.generation===j.generation && old.phase===j.phase && old.publishIndex===j.publishIndex && old.figureIndex===j.figureIndex) return;
  try {
    await getFunctions().taskQueue('rapidImportPage').enqueue({id:j.id,page:j.nextPage,generation:j.generation,phase:j.phase,publishIndex:j.publishIndex,...(j.figureIndex!==undefined?{figureIndex:j.figureIndex}:{})},
      {id:`${j.id}-${j.generation}-${j.nextPage}-${j.phase}-${j.publishIndex}-${j.figureIndex||0}`,dispatchDeadlineSeconds:540});
  } catch(e) { if(e.code!=='functions/task-already-exists' && e.code!=='already-exists' && Number(e.code)!==6) throw e; }
});

class CanvasFactory {
  create(width,height){const canvas=createCanvas(width,height);return {canvas,context:canvas.getContext('2d')};}
  reset(target,width,height){target.canvas.width=width;target.canvas.height=height;}
  destroy(target){target.canvas.width=0;target.canvas.height=0;target.canvas=null;target.context=null;}
}
async function render(doc,p) {
  const page=await doc.getPage(p), original=page.getViewport({scale:1});
  const viewport=page.getViewport({scale:Math.min(2,2000/Math.max(original.width,original.height))});
  const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
  await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'}).promise;
  page.cleanup();return canvas;
}
async function storeImage(job,token,name,canvas) {
  const path=`cer-rapid/${job.ownerUid}/${job.id}/images/${token}/${name}.jpg`, downloadToken=randomUUID();
  await bucket().file(path).save(canvas.toBuffer('image/jpeg'),{resumable:false,metadata:{contentType:'image/jpeg',metadata:{firebaseStorageDownloadTokens:downloadToken}}});
  return `https://firebasestorage.googleapis.com/v0/b/${bucket().name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
}
const getKimiKey = createOptionalKimiKeyReader({
  projectId:process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || firebaseApp.options?.projectId || 'mathgen--app',
  getAccessToken:() => firebaseApp.options?.credential?.getAccessToken()
});
const ask = createRapidAiRouter({openaiKey:() => openaiKey.value(), openaiModel:() => openaiModel.value(),
  getKimiKey, kimiModel:() => kimiModel.value(), generateGemini:(prompt, images, timeout) =>
    new GoogleGenAI({apiKey:key.value()}).models.generateContent({model:model.value(),
      contents:[{role:'user',parts:[{text:prompt},...images.map(data=>({inlineData:{mimeType:'image/jpeg',data}}))]}],
      config:{responseMimeType:'application/json',maxOutputTokens:16000,httpOptions:{timeout}}})
});

async function storedImage(url, ownerUid) {
  const path=storageImagePath(url,bucket().name,ownerUid);
  const bytes=(await bucket().file(path).download())[0];
  if(bytes.length>16*1024*1024) throw new Error('The source image is too large to process safely.');
  return bytes;
}
async function enhanceImage(block, job, requested='colour', pageUrls=[]) {
  block=adoptOriginal(block,pageUrls);
  const original=originalImageUrl(block);
  if(!original || original===block.cropSource?.url) throw new Error('A complete figure crop is required. The original page has been kept for manual cropping.');
  const bytes=await storedImage(original,job.ownerUid), source=await loadImage(bytes);
  const sourceBase64=bytes.toString('base64'), auxiliary=job;
  let kind=block.figureKind;
  if(!FIGURE_KINDS.includes(kind)) {
    const r=await ask(CLASSIFY_FIGURE_PROMPT,[sourceBase64],auxiliary,result=>{
      if(!FIGURE_KINDS.includes(JSON.parse(result.text).kind)) throw new Error('The figure type could not be determined safely.');
    });
    kind=JSON.parse(r.text).kind;
    if(!FIGURE_KINDS.includes(kind)) throw new Error('The figure type could not be determined safely.');
  }
  const mode=figureMode(kind,requested);
  const r=await new GoogleGenAI({apiKey:key.value()}).models.generateContent({model:imageModel.value(),
    contents:[{role:'user',parts:[{text:imageInstruction(kind,mode)},{inlineData:{mimeType:'image/jpeg',data:sourceBase64}}]}],
    config:{responseModalities:['IMAGE'],httpOptions:{timeout:120000}}});
  const candidate=r.candidates?.[0];
  if(candidate?.finishReason!=='STOP') throw new Error('Figure enhancement was incomplete.');
  const generated=candidate.content?.parts?.find(p=>p.inlineData?.data)?.inlineData;
  if(!generated || !['image/png','image/jpeg','image/webp'].includes(generated.mimeType)) throw new Error('The enhancement service did not return an image.');
  const output=Buffer.from(generated.data,'base64');
  if(output.length>16*1024*1024) throw new Error('The enhanced image is too large.');
  const picture=await loadImage(output);
  if(picture.width<24 || picture.height<24 || picture.width*picture.height>16000000 || Math.abs((picture.width/picture.height)/(source.width/source.height)-1)>0.22) throw new Error('The enhanced image changed the source proportions.');
  const canvas=createCanvas(picture.width,picture.height),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(picture,0,0);
  if(mode==='bw') {
    // Enforce monochrome even if an image model adds an unintended colour tint.
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    for(let i=0;i<pixels.data.length;i+=4) { const v=Math.round(.2126*pixels.data[i]+.7152*pixels.data[i+1]+.0722*pixels.data[i+2]); pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v; }
    ctx.putImageData(pixels,0,0);
  }
  const checked=await ask('Compare image 1, the ORIGINAL scan, with image 2, the proposed cleaned figure. Verify every label, spelling, numeral, symbol, unit, object, arrow direction, connection, table cell value, graph point, and relative position. Check that no content is invented, lost or clipped. Colour and font improvements are permitted. Return JSON {"faithful":true|false,"differences":["specific issue"]}. Only faithful:true with no differences permits replacement.',[sourceBase64,canvas.toBuffer('image/jpeg').toString('base64')],auxiliary,result=>{
    const verdict=JSON.parse(result.text);
    if(typeof verdict.faithful!=='boolean'||!Array.isArray(verdict.differences)) throw new Error('Figure verification was incomplete.');
  });
  const verdict=JSON.parse(checked.text);
  if(verdict.faithful!==true || !Array.isArray(verdict.differences) || verdict.differences.length) throw new Error('Enhancement was not verified against the original: '+(verdict.differences||['verification unavailable']).slice(0,3).map(String).join('; ').slice(0,250));
  const url=await storeImage(job,randomUUID(),'enhanced-'+mode,canvas);
  return {...block,url,originalCropUrl:original,preColourUrl:original,figureKind:kind,
    width:canvas.width,height:canvas.height,
    ...(block.cropSource?{cropSource:{...block.cropSource,imageUrl:url}}:{}),
    enhancement:{state:'done',mode,at:new Date().toISOString()}};
}
const fullRevision=q=>createHash('sha256').update(JSON.stringify(q)).digest('hex');
export const rapidVettingImage = onCall({...callOpts,secrets:[key,openaiKey],timeoutSeconds:540,memory:'2GiB'},async request=>{
  const a=admin(request),d=request.data||{};
  const validQuestionPart=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,220}$/.test(id);
  if(!validQuestionPart(d.questionId)||!validQuestionPart(d.blockId)||typeof d.expectedUrl!=='string') throw new HttpsError('invalid-argument','Select a saved figure first.');
  const resizing=Object.hasOwn(d,'scale');
  if(resizing ? (typeof d.scale!=='number'||!Number.isFinite(d.scale)||d.scale<0.25||d.scale>2) : !['colour','bw','original'].includes(d.mode)) throw new HttpsError('invalid-argument','Invalid figure size or mode.');
  const ref=db.doc(`users/${a.uid}/vetting/${d.questionId}`),snap=await ref.get();
  if(!snap.exists) throw new HttpsError('not-found','Vetting question not found.');
  const q=snap.data(),revision=fullRevision(q),index=q.blocks?.findIndex(b=>b.id===d.blockId&&b.type==='image');
  if(index===undefined||index<0) throw new HttpsError('not-found','Figure not found.');
  const block=q.blocks[index];
  if(block.url!==d.expectedUrl || (resizing&&(block.scale??null)!==(d.expectedScale??null))) throw new HttpsError('aborted','This figure changed. Refresh and try again.');
  const next=structuredClone(q);
  if(resizing) next.blocks[index].scale=d.scale;
  else if(d.mode==='original') {
    const original=originalImageUrl(adoptOriginal(block,(q.sourcePages||[]).map(p=>p.url)));
    if(!original) throw new HttpsError('failed-precondition','The preserved original crop is unavailable.');
    const originalBytes=await storedImage(original,a.uid),picture=await loadImage(originalBytes);
    next.blocks[index]={...block,url:original,originalCropUrl:original,preColourUrl:original,width:picture.width,height:picture.height,
      ...(block.cropSource?{cropSource:{...block.cropSource,imageUrl:original}}:{}),enhancement:{state:'done',mode:'original',at:new Date().toISOString()}};
  } else {
    if(!validId(q.rapidImportId)) throw new HttpsError('failed-precondition','This figure has no durable import source.');
    const importJob=(await jobRef(q.rapidImportId).get()).data();
    if(!importJob||importJob.ownerUid!==a.uid) throw new HttpsError('not-found','Original import not found.');
    try { next.blocks[index]=await enhanceImage(block,importJob,d.mode,(q.sourcePages||[]).map(p=>p.url)); }
    catch(e) { throw new HttpsError('failed-precondition',String(e.message||e).slice(0,350)); }
  }
  // Resizing leaves scientific content unchanged. Regenerated/restored figures
  // are re-read with their actual pixels before the shared record is replaced.
  if(!resizing) {
    const importJob=validId(q.rapidImportId)?(await jobRef(q.rapidImportId).get()).data():null;
    await checkQuestion(next,{...(importJob?.ownerUid===a.uid?importJob:{}),ownerUid:a.uid,autoCheck:true,maxCheckTries:1});
  } else if(next.autoCheck?.sig===signature(q)) next.autoCheck.sig=signature(next);
  next.updatedAt=new Date().toISOString();
  await db.runTransaction(async tx=>{
    const latest=await tx.get(ref);
    if(!latest.exists||fullRevision(latest.data())!==revision) throw new HttpsError('aborted','This question changed while the figure was processing. Refresh and try again.');
    tx.update(ref,{blocks:next.blocks,...(next.autoCheck?{autoCheck:next.autoCheck}:{}),updatedAt:next.updatedAt});
  });
  return {question:next,changed:true};
});


// ---- Decisions in the worker --------------------------------------------------------
// Decisions answers yes/no on facts measured here. Unavailable (no key, busy, offline)
// is never a failure of the import: the question simply takes the ordinary path.
const decisionsOn = job => job.decisions !== false;
async function decisionsAsk(input) {
  try { return await decisionsReview(input,{apiKey:()=>openaiKey.value()}); }
  catch(e) { if(e instanceof DecisionsUnavailable) return null; throw e; }
}
const DECISIONS_RECROP_TRIES = 2;
function parseBox(text) {
  try {
    const p=JSON.parse(text), b=p.box_2d??p.box;
    return Array.isArray(b)&&b.length===4&&b.every(v=>Number.isFinite(Number(v)))?b.map(Number):null;
  } catch { return null; }
}
// Ask the AI where the figure really is, told exactly what was wrong with the last attempt.
async function recropBox(canvas, made, reasons, job) {
  const images=[canvas.toBuffer('image/jpeg').toString('base64')];
  if(made) images.push(made.canvas.toBuffer('image/jpeg').toString('base64'));
  const prompt=`Image 1 is a whole page of a primary-school science paper. ${made?'Image 2 is the crop that was cut for one figure and was judged wrong.':'No crop could be cut for one figure.'}\nProblems found: ${reasons.join('; ')||'the crop is not the complete, clean figure'}.\nLocate the ONE figure (diagram, graph, table or experimental set-up) this crop was meant to be. Reply ONLY with JSON {"box_2d":[ymin,xmin,ymax,xmax]} in integers 0-1000 measured on IMAGE 1. Include every label, arrow, axis title, unit, legend, caption and table border belonging to the figure, with clear whitespace beyond the last of them. Exclude sentences of question text, question numbers and ordinary written options. A table runs from its top border to its bottom border (plus a title printed on it): never the sentence that introduces it, the lettered parts printed under it such as "(a) State..." or "(i) Substance 1", marks such as [2], blank answer lines, or the end of the previous question. Never use the whole page.`;
  const r=await ask(prompt,images,job,result=>{
    if(!parseBox(result.text)) throw new Error('The crop location response was incomplete.');
  });
  return parseBox(r.text);
}
// SECOND-CHANCE CLEANUP, as in the browser (app.js `_aiRefineCrop`): the crop
// is shown back to the AI with the question's own TYPED wording, and anything
// in the picture that is also in that list — the stem over a table, the parts
// and answer lines under it — is cut off. This pass did not exist in the
// worker, so a durable PDF import shipped whatever the pixel trim left. Any
// failure keeps the crop exactly as it was.
//
// The clean-up's rectangle is cut from the PAGE (`page`, the canvas the crop
// came from) and measured again there (subCrop), so a clean-up that cuts into
// the figure is refused rather than shipped. `until` is the page task's
// deadline: past it the crop is kept as it is rather than spending another
// model call the task may not live to finish.
async function refineCrop(made, wording, job, page, until=Infinity) {
  if(!made||!made.canvas||!page) return made;
  if(Date.now()>until) return made;
  try {
    const r=await ask(refinePrompt(wording),[made.canvas.toBuffer('image/jpeg').toString('base64')],job);
    const p=JSON.parse(r.text);
    if(!p||p.clean===true||!Array.isArray(p.box_2d)) return made;
    return subCrop(made,p.box_2d,createCanvas,page)||made;
  } catch { return made; }
}
// A few at a time, results in the order they were asked for.
const REFINE_PARALLEL = 3;
// How far into a page task new crop clean-ups and AI re-cuts may still start.
// A model call already running may take its full router time past this, and
// the page still has to store its figures and checkpoint before 540 seconds.
const PAGE_REFINE_MS = 300000;
async function inOrder(items, n, fn) {
  const out=new Array(items.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{
    while(next<items.length){const i=next++;out[i]=await fn(items[i],i);}
  }));
  return out;
}
// Cut, judge, and re-cut with the AI until Decisions and the pixel checks agree.
// Returns one entry per image block: { made, state, tries, reasons }.
async function reviewCrops(imageBlocks, canvas, job, wording='', until=Infinity) {
  const made=await inOrder(imageBlocks,REFINE_PARALLEL,b=>refineCrop(cropDiagramEx(canvas,b.box_2d??b.box,createCanvas),wording,job,canvas,until));
  if(!decisionsOn(job)||!imageBlocks.length) return made.map(m=>({made:m,state:'ok',tries:0,reasons:[]}));
  // A clean-up that WORKED is not stray text left on the crop: the crop Decisions is
  // shown is the cleaned one, re-measured. Telling Decisions "the AI saw stray text"
  // made it say no to every cleaned crop and sent each round the re-cut loop.
  const factsOf=(m,i)=>figureFacts({index:i,source:m?'ai-box':'none',refused:!m,width:m?.canvas.width,height:m?.canvas.height,pageShare:m?.pageShare,measure:m?.measure,refine:{changed:false}});
  const facts=made.map(factsOf);
  const verdicts=await decisionsAsk({scope:'figures',figures:facts});
  // Decisions unavailable is not "no Decisions": the pixel checks still stand on their own,
  // and a crop they call clipped or blank is re-cut all the same.
  const decision=decideReview({verdicts,figures:facts,question:null});
  const out=[];
  for(let i=0;i<made.length;i++) {
    const own=decision.failures.filter(f=>f.key==='figure_'+i);
    if(!own.length) {out.push({made:made[i],state:'ok',tries:0,reasons:[]});continue;}
    let best={made:made[i],score:own.length,reasons:own.map(f=>f.reason)}, reasons=best.reasons, tries=0, fixed=false;
    while(tries<DECISIONS_RECROP_TRIES) {
      if(Date.now()>until) break;
      tries++;
      let box=null;
      try { box=await recropBox(canvas,best.made,reasons,job); } catch { break; }
      if(!box) break;
      const m2=await refineCrop(cropDiagramEx(canvas,box,createCanvas,{marginScale:tries===1?1.6:2.2}),wording,job,canvas,until);
      const f2=factsOf(m2,i), hard=figureHardIssues(f2);
      let v2=null;
      if(!hard.length) v2=await decisionsAsk({scope:'figures',figures:[f2]});
      const d2=decideReview({verdicts:v2?{figure_0:v2.figure_0}:null,figures:[f2],question:null});
      const score=d2.failures.length;
      reasons=d2.failures.map(f=>f.reason);
      if(m2&&score<best.score) {best={made:m2,score,reasons};imageBlocks[i].box_2d=box;}
      if(!score&&m2) {fixed=true;break;}
    }
    out.push({made:best.made,state:fixed?'fixed':'flagged',tries,reasons:fixed?[]:best.reasons});
  }
  return out;
}

// One bounded attempt to repair figures the visual audit rejected. The page the
// figure came from is kept in Storage, so the AI is shown the page plus the bad
// crop, cuts again, and the new crop is redrawn (colour for pictured diagrams,
// black and white Century Gothic for tables, graphs and word diagrams). When no
// better crop can be cut, a regenerated figure falls back to its original crop.
const FIGURE_FIX_MAX = 3;
async function fixFigures(q, findings, job, applied, until=Infinity) {
  const targets=figureFixTargets(findings,q.blocks).slice(0,FIGURE_FIX_MAX);
  let any=false;
  const pageUrls=(q.sourcePages||[]).map(p=>p.url);
  for(const id of targets) {
    const index=q.blocks.findIndex(b=>b.id===id);
    let block=adoptOriginal(q.blocks[index],pageUrls);
    const reasons=findings.filter(f=>f.blockId===id).map(f=>f.detail||f.title).slice(0,4);
    let next=null, how='';
    const pageUrl=block.cropSource?.url;
    if(pageUrl) {
      try {
        const page=await loadImage(await storedImage(pageUrl,job.ownerUid)), canvas=createCanvas(page.width,page.height);
        canvas.getContext('2d').drawImage(page,0,0);
        const current=block.originalCropUrl&&block.originalCropUrl!==pageUrl?await loadImage(await storedImage(block.originalCropUrl,job.ownerUid)):null;
        const box=await recropBox(canvas,current?{canvas:(()=>{const c=createCanvas(current.width,current.height);c.getContext('2d').drawImage(current,0,0);return c;})()}:null,reasons,job);
        // The re-cut gets the same clean-up the import's own cut had, told the
        // question's typed wording, or the stem it was rejected for comes back.
        const made=box&&await refineCrop(cropDiagramEx(canvas,box,createCanvas,{marginScale:1.6}),cropWordingOf(q.blocks),job,canvas,until);
        if(made&&made.canvas) {
          const url=await storeImage(job,randomUUID(),`refit-${id}`,made.canvas);
          next={...block,url,originalCropUrl:url,preColourUrl:url,width:made.canvas.width,height:made.canvas.height,
            cropSource:{...block.cropSource,imageUrl:url,box_2d:box},enhancement:undefined};
          delete next.enhancement;how='re-cut';
          try { next=await enhanceImage(next,job,'colour',pageUrls);how='re-cut and redrawn'; } catch {}
        }
      } catch {}
    }
    if(!next) {
      const original=originalImageUrl(block);
      if(original&&original!==block.url) {
        next={...block,url:original,cropSource:block.cropSource?{...block.cropSource,imageUrl:original}:block.cropSource,
          enhancement:{state:'done',mode:'original',at:new Date().toISOString()}};how='restored to its original crop';
      }
    }
    if(next) {
      q.blocks[index]=next;any=true;
      applied.push({blockId:id,type:'image',reason:`Automatic figure fix (${how}) after the traffic-light check found: ${reasons.join('; ').slice(0,250)}`});
    }
  }
  return any;
}

async function checkQuestion(q,job) {
  migrateDecisionsReviewState(q);
  migrateDecisionsReviewState(job);
  if(!job.autoCheck) return;
  // Decisions contributes measured findings; the current cropAudit signature may
  // only be stamped after the AI reads the actual source and displayed pixels.
  let known=[], shadow=null;
  if(decisionsOn(job)) {
    const qf=questionFacts(q), verdicts=await decisionsAsk({scope:'question',question:qf}).catch(()=>null);
    const flaggedFigs=(q.decisionsFigures||[]).filter(f=>f.state==='flagged');
    if(verdicts) {
      const d=decideReview({verdicts,figures:[],question:qf});
      known=failuresToFindings(d.failures);
      shadow={yes:!known.length,confident:d.confident&&!flaggedFigs.length};
    }
  }
  const flaggedFigures=(q.decisionsFigures||[]).filter(f=>f.state==='flagged').flatMap(f=>failuresToFindings((f.reasons.length?f.reasons:['the crop could not be made complete and clean']).map(r=>({key:'figure_'+f.index,index:f.index,code:'decisions_no',reason:r,by:'decisions'}))));
  const images=[], imageLabels=[];
  let findings=[], tries=0, error='', best=null, applied=[], figuresFixed=false;
  const started=Date.now();
  try {
    // Read what the pupil will see as well as the source, so a faithful page
    // cannot hide a clipped or incorrectly regenerated displayed figure.
    // Browser-added inline pictures have a broader URL contract than durable
    // imports. Refuse an incomplete audit rather than stamping them green.
    // Include nested MCQ choices/table cells and any future rich-text fields,
    // not only the top-level stem and answer strings.
    if(/<img\b/i.test(JSON.stringify(q.blocks||[]))) throw new Error('Inline pictures require a fresh check in CER.');
    let auditTargets=[];
    const gather=async()=>{
      images.length=0;imageLabels.length=0;
      const displayed=(q.blocks||[]).filter(b=>b.type==='image'||(['explanation','answerKey'].includes(b.type)&&b.url));
      const sources=[...(q.sourcePages||[]).map(p=>({url:p.url,label:`Original PDF page ${p.page}`})),
        ...displayed.flatMap(b=>[
          ...(b.originalCropUrl?[{url:b.originalCropUrl,label:`Original figure crop ${b.id}`}]:[]),
          {url:b.url,label:`Displayed figure ${b.id}`}
        ]),...(q.blocks||[]).filter(b=>b.answerImg).map(b=>({url:b.answerImg,label:`Annotated answer figure ${b.id}`})),
        ...(q.answerKeyImage?[{url:q.answerKeyImage,label:'Answer key image'}]:[])];
      auditTargets=[...displayed.map(b=>b.id),
        ...(q.blocks||[]).filter(b=>b.answerImg).map(b=>b.id+':answerImg'),...(q.answerKeyImage?['$answerKey']:[])];
      if(sources.length>24) throw new Error('Too many source images for one safe automatic check. Review this question manually.');
      for(const source of sources) {images.push((await storedImage(source.url,job.ownerUid)).toString('base64'));imageLabels.push(`Image ${images.length}: ${source.label}`);}
    };
    await gather();
    const limit=job.maxCheckTries===1?1:2;
    for(tries=1;tries<=limit;tries++) {
      if(tries>1 && Date.now()-started>240000) break;
      if(tries>1 && figuresFixed) await gather();
      const r=await ask(`Check this science question and answers against its source pages. ${job.grounding||''}\n${imageLabels.join('\n')}\nCheck scientific accuracy, missing parts, correct options, complete model answers, explanations per part and diagram references. Compare every displayed figure with its original: complete labels, correct values, arrows, cells and cropping. Return JSON {"findings":[{"severity":"high|medium|low","title":"problem","detail":"reason","fix":"specific suggested correction"}],"imageAudits":[{"blockId":"target id","complete":true,"faithful":true,"issues":[]}],"repairs":[{"id":"block id","content":"corrected plain text","claim":"...","evidence":"...","reasoning":"...","correctIndex":0,"reason":"why this correction is justified"}]}. You MUST return one explicit imageAudits entry for EACH target in ${JSON.stringify(auditTargets)}. Set complete:false if any target could not be inspected, faithful:false and specific issues for incorrect or clipped content; never claim an unread figure is correct. Target $answerKey is the answer-key image and suffix :answerImg is an annotated answer. Only repair answer, plainanswer, explanation or mcq blocks. Do not alter the source wording or invent missing information. Empty findings means correct only when all visual audits also pass.${known.length?` Problems already flagged by Decisions (confirm, and repair where the repair types allow): ${known.map(k=>k.title).join('; ')}.`:''} Question:\n${JSON.stringify(q)}`,images,job,result=>{
        if(!Array.isArray(JSON.parse(result.text).findings)) throw new Error('Invalid checker response.');
      });
      if(r.candidates?.[0]?.finishReason!=='STOP') throw new Error('Checker response was incomplete.');
      const reply=JSON.parse(r.text);
      if(!Array.isArray(reply.findings)) throw new Error('Invalid checker response.');
      findings=reply.findings.slice(0,20).map(f=>({type:'Check',severity:f.severity==='high'?'high':f.severity==='low'?'low':'med',title:String(f.title||'Check required').slice(0,160),detail:String(f.detail||'').slice(0,400),fix:String(f.fix||'Review against the original source.').slice(0,400),ai:true}));
      findings.push(...requireImageAudits(reply.imageAudits,auditTargets));
      const score=findings.reduce((n,f)=>n+(f.severity==='high'?100:f.severity==='med'?10:1),0);
      if(!best || score<best.score) best={score,findings:structuredClone(findings),blocks:structuredClone(q.blocks),repairs:structuredClone(applied)};
      if(!findings.length || tries===limit) break;
      let changed=false;
      // ONE automatic figure fix per question, on the first read only: re-cut
      // from the preserved page, then redraw in house style. Never repeated.
      if(!figuresFixed && job.enhanceImages!==false) {
        try { figuresFixed=await fixFigures(q,findings,job,applied,started+240000); } catch {}
        if(figuresFixed) changed=true;
      }
      for(const fix of Array.isArray(reply.repairs)?reply.repairs.slice(0,40):[]) {
        const b=q.blocks.find(b=>b.id===fix.id);
        if(!b) continue;
        const before=JSON.stringify(b);
        const safeText=v=>typeof v==='string'&&v.trim()&&v.length<=12000;
        if(['plainanswer','explanation'].includes(b.type)&&safeText(fix.content)) b.content=html(fix.content);
        if(b.type==='answer') for(const field of ['claim','evidence','reasoning']) if(safeText(fix[field])) b[field]=html(fix[field]);
        if(b.type==='mcq'&&Number.isInteger(fix.correctIndex)&&b.options?.[fix.correctIndex]) b.correctId=b.options[fix.correctIndex].id;
        if(JSON.stringify(b)!==before) {changed=true;applied.push({blockId:b.id,type:b.type,reason:String(fix.reason||'Automatic correction from checker findings.').slice(0,400)});}
      }
      if(!changed) break;
    }
  } catch(e){error=String(e.message).slice(0,160);}
  if(best){q.blocks=best.blocks;findings=best.findings;applied=best.repairs;}
  // Whatever Decisions flagged and the repair did not cure is still true of the
  // question as it now stands, so it is re-measured (no second Decisions call) and kept.
  {
    const now=questionHardIssues(questionFacts(q)), still=[];
    now.wording.forEach(is=>still.push({key:'wording',code:is.code,reason:is.detail,by:'code'}));
    now.structure.forEach(is=>still.push({key:'structure',code:is.code,reason:is.detail,by:'code'}));
    findings=findings.concat(failuresToFindings(still),flaggedFigures,enhancementFindings(q)).slice(0,40);
  }
  if(q.importWarning) findings.push({type:'Other',severity:'high',title:'Check page continuation',detail:q.importWarning,fix:'',ai:false});
  q.autoCheck={state:error?'error':findings.some(f=>f.severity==='high')?'red':findings.length?'amber':'green',tries,found:findings.length,findings,repairs:applied,sig:signature(q),at:new Date().toISOString()};
  if(error) q.autoCheck.error=error;
  if(shadow) q.decisionsShadow={...shadow,ai:q.autoCheck.state,found:q.autoCheck.found};
}
export const rapidImportPage = onTaskDispatched({region:'us-central1',secrets:[key,openaiKey],timeoutSeconds:540,memory:'2GiB',cpu:1,
  retryConfig:{maxAttempts:5,minBackoffSeconds:60,maxBackoffSeconds:300},rateLimits:{maxConcurrentDispatches:2},maxInstances:2},async request=>{
  // Taken before anything is read: the crop clean-up stops starting new model
  // calls PAGE_REFINE_MS in, so a page full of figures still finishes, stores
  // and checkpoints inside the 540-second task instead of being killed mid-way.
  const started=Date.now();
  const {id,page,generation,phase,publishIndex,figureIndex}=request.data||{};
  if(!validId(id)||!Number.isInteger(page)) throw new Error('Invalid task.');
  const ref=jobRef(id), job=migrateDecisionsReviewState((await ref.get()).data());
  const matches=j=>j&&j.status==='queued'&&j.nextPage===page&&j.generation===generation&&j.phase===phase&&j.publishIndex===publishIndex&&(phase!=='enhance'||j.figureIndex===figureIndex);
  if(!matches(job)) return;
  let doc;
  try {
    if(phase==='enhance') {
      const checkpoint=JSON.parse((await bucket().file(job.checkpoint).download())[0].toString());
      const q=checkpoint.ready[publishIndex],block=q?.blocks?.[figureIndex];
      if(block?.type!=='image') throw new Error('Missing figure checkpoint.');
      try { q.blocks[figureIndex]=await enhanceImage(block,job,'colour',(q.sourcePages||[]).map(p=>p.url)); }
      catch(e) { q.blocks[figureIndex]={...block,enhancement:{state:'error',mode:figureMode(block.figureKind),error:String(e.message||e).slice(0,350),at:new Date().toISOString()}}; }
      // One figure per task bounds image-model latency. Each successful (or
      // visibly flagged) result is checkpointed before advancing the outbox.
      const path=`cer-rapid/${job.ownerUid}/${id}/checkpoints/${randomUUID()}.json`;
      await bucket().file(path).save(JSON.stringify(checkpoint),{resumable:false,contentType:'application/json'});
      const next=nextImageIndex(q,figureIndex);
      await db.runTransaction(async tx=>{
        if(!matches((await tx.get(ref)).data())) return;
        tx.update(ref,{checkpoint:path,phase:next<0?'publish':'enhance',figureIndex:next<0?0:next,error:'',updatedAt:new Date().toISOString()});
      });
      return;
    }
    if(phase==='publish') {
      const checkpoint=JSON.parse((await bucket().file(job.checkpoint).download())[0].toString());
      const q=checkpoint.ready[publishIndex];
      if(!q) throw new Error('Missing question checkpoint.');
      await checkQuestion(q,job);
      if(Buffer.byteLength(JSON.stringify(q))>800000) throw new Error('Question too large to save safely.');
      await db.runTransaction(async tx=>{
        const latest=(await tx.get(ref)).data();
        if(!matches(latest)) return;
        tx.create(db.doc(`users/${job.ownerUid}/vetting/${q.id}`),q);
        const more=publishIndex+1<checkpoint.ready.length;
        const next=more&&job.enhanceImages?nextImageIndex(checkpoint.ready[publishIndex+1]):-1;
        tx.update(ref,{added:latest.added+1,publishIndex:more?publishIndex+1:0,phase:more?(next<0?'publish':'enhance'):'page',figureIndex:next<0?0:next,
          status:!more&&page>job.total?'completed':'queued',error:'',updatedAt:new Date().toISOString()});
      });
      return;
    }
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const bytes=(await bucket().file(job.path).download())[0];
    doc=await pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,CanvasFactory}).promise;
    if(doc.numPages>MAX_PAGES) throw new Error(`This PDF has ${doc.numPages} pages. Split it into files of at most ${MAX_PAGES} pages; no pages have been silently skipped.`);
    const pending=migrateDecisionsReviewState(job.checkpoint ? JSON.parse((await bucket().file(job.checkpoint).download())[0].toString()).pending : null);
    const canvas=await render(doc,page), image=canvas.toBuffer('image/jpeg').toString('base64');
    const reference=page>1?(await render(doc,page-1)).toBuffer('image/jpeg').toString('base64'):null;
    const boundary=`\nPDF BOUNDARY RULES (override single-image assumptions): image 1 is the CURRENT page ${page}. ${reference?'Image 2 is the PREVIOUS page for context only; NEVER extract it again.':''} Extract ALL and ONLY questions/parts printed on image 1. Add sourceQuestionNumber to each entry (original main number, no part suffix). The first entry may have continuation:true if it belongs to the last question on the previous page, including repeated numbers with (continued), a new diagram for an existing question, a stem split mid-sentence, or later lettered parts. A repeated number or a continuation diagram does NOT start a new question. All other entries have continuation:false. Never renumber lettered parts. Use previous-page context to answer continuation parts. A continuation-only page is NOT blank. All image rectangles refer to image 1. Last held question: ${pending?JSON.stringify({number:pending.sourceQuestionNumber,blocks:pending.blocks}).slice(0,35000):'none; do not guess a preceding question'}.`;
    const figures='\nFIGURE RULES: Keep text and image blocks in source reading order, at the exact point each figure belongs among the stem and lettered parts. Use one image block per figure or complete table, and retain every figure needed to answer the question. Give every image block figureKind:"diagram", "table", "flowchart" or "graph". Tables, graphs and every WORD diagram (boxes, circles or brackets holding only words or numbers joined by lines or arrows: flow charts, classification trees, concept maps, cycles) must be classified accurately (table, graph or flowchart) so they are redrawn in black and white; only a figure with pictured objects, apparatus or organisms is a diagram and receives colour. Each box_2d is [ymin,xmin,ymax,xmax], 0-1000 on CURRENT image 1 only, never on the previous context page or on an already cropped image. Include complete labels, units, arrows, legends, captions, table headers and borders belonging to the figure; check the last letter on every side and leave clear whitespace beyond it. Exclude surrounding question prose, question numbers, ordinary written options and answer lines; put that wording in text or mcq blocks instead. A table rectangle runs from its top border to its bottom border (plus a title printed on it): never the sentence that introduces it, the lettered parts printed under it such as "(a) State..." or "(i) Substance 1", marks such as [2], blank answer lines, or the end of the previous question. Keep picture answer choices together in one image including their option labels. Do not use a whole-page rectangle as a figure. If you cannot locate a required figure, keep its image block with box_2d:null in its original position so its source page can be retained for review.';
    const payloads=parseReply(await ask(job.prompt+boundary+figures,reference?[image,reference]:[image],job,parseReply));
    if(payloads.length>60) throw new Error('Too many questions on one page; review this PDF.');
    const token=randomUUID(), sourceUrl=await storeImage(job,token,`page-${page}`,canvas), entries=[];
    for(let i=0;i<payloads.length;i++) {
      const payload=payloads[i], urls=[];
      const reviewed=await reviewCrops(payload.blocks.filter(b=>blockType(b)==='image'),canvas,job,cropWordingOf(payload.blocks),started+PAGE_REFINE_MS);
      for(const r of reviewed) {
        const crop=r.made&&r.made.canvas;
        // Reserve one result for every image block, including refused crops,
        // so later figures never slide into an earlier figure's position.
        if(!crop) {urls.push(sourceUrl);continue;}
        urls.push(await storeImage(job,token,`page-${page}-q${i}-figure${urls.length}`,crop));
      }
      const q=normaliseQuestion(payload,`q_rapid_${id}_${page}_${i}`,job,page,sourceUrl,urls);
      if(q.blocks.some(b=>b.type==='image'&&b.url===sourceUrl)) q.diagramWhole=true;
      // What Decisions and the AI recrop did, kept so the publish step can raise anything still wrong.
      const flagged=reviewed.map((r,n)=>({index:n,state:r.state,tries:r.tries,reasons:(r.reasons||[]).slice(0,4)})).filter(r=>r.state!=='ok'||r.tries);
      if(flagged.length) q.decisionsFigures=flagged;
      entries.push({q,continuation:payload.continuation===true});
    }
    const assembled=assemblePage(pending,entries,page===doc.numPages);
    // Immutable checkpoint uploaded before the atomic Firestore publication.
    const checkpoint=`cer-rapid/${job.ownerUid}/${id}/checkpoints/${token}.json`;
    await bucket().file(checkpoint).save(JSON.stringify(assembled),{resumable:false,contentType:'application/json'});
    await db.runTransaction(async tx=>{
      const latest=(await tx.get(ref)).data();
      if(!matches(latest)) return;
      const first=assembled.ready.length&&job.enhanceImages?nextImageIndex(assembled.ready[0]):-1;
      tx.update(ref,{checkpoint,nextPage:page+1,total:doc.numPages,phase:assembled.ready.length?(first<0?'publish':'enhance'):'page',publishIndex:0,figureIndex:first<0?0:first,
        status:page===doc.numPages&&!assembled.ready.length?'completed':'queued',error:'',updatedAt:new Date().toISOString()});
    });
  } catch(e) {
    // The final attempt leaves a durable, visible failure and a retry button.
    // Earlier committed pages and the held question stay intact.
    await db.runTransaction(async tx=>{
      const latest=(await tx.get(ref)).data();
      if(!matches(latest)) return;
      tx.update(ref,{error:String(e.message||e).slice(0,300),...(request.retryCount>=4?{status:'failed'}:{}),updatedAt:new Date().toISOString()});
    });
    throw e;
  } finally {if(doc) await doc.destroy();}
});
