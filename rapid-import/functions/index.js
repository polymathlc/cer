import { randomUUID } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getFunctions } from 'firebase-admin/functions';
import { GoogleGenAI } from '@google/genai';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { MAX_PDF_BYTES, CHUNK_BYTES, MAX_PAGES, parseReply, cropRect, normaliseQuestion, assemblePage, signature, html } from './core.js';

initializeApp();
Object.assign(globalThis, {DOMMatrix, ImageData, Path2D});
const db = getFirestore();
const bucket = () => getStorage().bucket('mathgen--app.firebasestorage.app');
const key = defineSecret('GEMINI_API_KEY');
const openaiKey = defineSecret('OPENAI_API_KEY');
const openaiModel = defineString('RAPID_IMPORT_OPENAI_MODEL', {default:'gpt-6-astra'});
const model = defineString('RAPID_IMPORT_MODEL', {default:'gemini-2.5-flash'});
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
    jobs:snaps.docs.map(s=>publicJob(s.data())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100)};
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
      prompt:d.prompt,engineOrder:Array.isArray(d.engineOrder)?d.engineOrder.filter(e=>['openai','gemini'].includes(e)):['openai','gemini'],grounding:String(d.grounding||'').slice(0,80000),topics:Array.isArray(d.topics)?d.topics.slice(0,100).map(String):[],
      level:String(d.level||''),release,autoCheck:d.autoCheck!==false,createdBy:String(a.token.name||a.token.email||'Admin'),
      createdAt:now,updatedAt:now,nextPage:1,added:0,generation:0,phase:'page',publishIndex:0});
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
  if(old?.status==='queued' && old.nextPage===j.nextPage && old.generation===j.generation && old.phase===j.phase && old.publishIndex===j.publishIndex) return;
  try {
    await getFunctions().taskQueue('rapidImportPage').enqueue({id:j.id,page:j.nextPage,generation:j.generation,phase:j.phase,publishIndex:j.publishIndex},
      {id:`${j.id}-${j.generation}-${j.nextPage}-${j.phase}-${j.publishIndex}`,dispatchDeadlineSeconds:540});
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
async function ask(prompt,images,job) {
  const order=[...new Set([...(job.engineOrder||['openai','gemini']),'gemini'])];
  let lastError;
  for(const engine of order) {
    try {
      if(engine==='openai') {
        const response=await fetch('https://api.openai.com/v1/chat/completions',{
          method:'POST',headers:{Authorization:'Bearer '+openaiKey.value(),'Content-Type':'application/json'},
          signal:AbortSignal.timeout(90000),body:JSON.stringify({model:openaiModel.value(),max_completion_tokens:24000,
            reasoning_effort:'medium',response_format:{type:'json_object'},messages:[{role:'user',content:[
              {type:'text',text:prompt},...images.map(data=>({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+data}}))]}]})});
        if(!response.ok) throw new Error('OpenAI request failed ('+response.status+').');
        const body=await response.json(),choice=body.choices?.[0];
        if(choice?.finish_reason!=='stop'||!choice.message?.content) throw new Error('OpenAI response was incomplete.');
        return {text:choice.message.content,candidates:[{finishReason:'STOP'}]};
      }
      const result=await new GoogleGenAI({apiKey:key.value()}).models.generateContent({model:model.value(),
        contents:[{role:'user',parts:[{text:prompt},...images.map(data=>({inlineData:{mimeType:'image/jpeg',data}}))]}],
        config:{responseMimeType:'application/json',maxOutputTokens:16000,httpOptions:{timeout:90000}}});
      if(result.candidates?.[0]?.finishReason!=='STOP') throw new Error('Gemini response was incomplete.');
      return result;
    } catch(e){lastError=e;}
  }
  throw lastError || new Error('No online AI engine available.');
}

async function checkQuestion(q,job) {
  if(!job.autoCheck) return;
  const images=[];
  for(const source of q.sourcePages){
    // URLs here were minted by this worker, never supplied by the model.
    const path=decodeURIComponent(new URL(source.url).pathname.split('/o/')[1]);
    images.push((await bucket().file(path).download())[0].toString('base64'));
  }
  let findings=[], tries=0, error='', best=null;
  const started=Date.now();
  try {
    for(tries=1;tries<=4;tries++) {
      if(tries>1 && Date.now()-started>240000) break;
      const r=await ask(`Check this science question and answers against its source pages. ${job.grounding}\nCheck scientific accuracy, missing parts, correct options, complete model answers, explanations per part and diagram references. Return JSON {"findings":[{"severity":"high|medium|low","title":"problem","detail":"reason"}],"repairs":[{"id":"block id","content":"corrected plain text","claim":"...","evidence":"...","reasoning":"...","correctIndex":0}]}. Only repair answer, plainanswer, explanation or mcq blocks. Do not alter the source wording or invent missing information. Empty findings means correct. Question:\n${JSON.stringify(q)}`,images,job);
      if(r.candidates?.[0]?.finishReason!=='STOP') throw new Error('Checker response was incomplete.');
      const reply=JSON.parse(r.text);
      if(!Array.isArray(reply.findings)) throw new Error('Invalid checker response.');
      findings=reply.findings.slice(0,20).map(f=>({type:'Check',severity:f.severity==='high'?'high':f.severity==='low'?'low':'med',title:String(f.title||'Check required').slice(0,160),detail:String(f.detail||'').slice(0,400),fix:'',ai:true}));
      const score=findings.reduce((n,f)=>n+(f.severity==='high'?100:f.severity==='med'?10:1),0);
      if(!best || score<best.score) best={score,findings:structuredClone(findings),blocks:structuredClone(q.blocks)};
      if(!findings.length || tries===4) break;
      let changed=false;
      for(const fix of reply.repairs||[]) {
        const b=q.blocks.find(b=>b.id===fix.id);
        if(!b) continue;
        if(['plainanswer','explanation'].includes(b.type)&&typeof fix.content==='string') { b.content=html(fix.content); changed=true; }
        if(b.type==='answer') for(const field of ['claim','evidence','reasoning']) if(typeof fix[field]==='string'){b[field]=html(fix[field]);changed=true;}
        if(b.type==='mcq'&&Number.isInteger(fix.correctIndex)&&b.options[fix.correctIndex]){b.correctId=b.options[fix.correctIndex].id;changed=true;}
      }
      if(!changed) break;
    }
  } catch(e){error=String(e.message).slice(0,160);}
  if(best){q.blocks=best.blocks;findings=best.findings;}
  if(q.importWarning) findings.push({type:'Other',severity:'high',title:'Check page continuation',detail:q.importWarning,fix:'',ai:false});
  q.autoCheck={state:error?'error':findings.some(f=>f.severity==='high')?'red':findings.length?'amber':'green',tries,found:findings.length,findings,sig:signature(q),at:new Date().toISOString()};
  if(error) q.autoCheck.error=error;
}
export const rapidImportPage = onTaskDispatched({region:'us-central1',secrets:[key,openaiKey],timeoutSeconds:540,memory:'2GiB',cpu:1,
  retryConfig:{maxAttempts:5,minBackoffSeconds:60,maxBackoffSeconds:300},rateLimits:{maxConcurrentDispatches:2},maxInstances:2},async request=>{
  const {id,page,generation,phase,publishIndex}=request.data||{};
  if(!validId(id)||!Number.isInteger(page)) throw new Error('Invalid task.');
  const ref=jobRef(id), job=(await ref.get()).data();
  if(!job || job.status!=='queued' || job.nextPage!==page || job.generation!==generation || job.phase!==phase || job.publishIndex!==publishIndex) return;
  let doc;
  try {
    if(phase==='publish') {
      const checkpoint=JSON.parse((await bucket().file(job.checkpoint).download())[0].toString());
      const q=checkpoint.ready[publishIndex];
      if(!q) throw new Error('Missing question checkpoint.');
      await checkQuestion(q,job);
      if(Buffer.byteLength(JSON.stringify(q))>800000) throw new Error('Question too large to save safely.');
      await db.runTransaction(async tx=>{
        const latest=(await tx.get(ref)).data();
        if(latest.status!=='queued'||latest.nextPage!==page||latest.generation!==generation||latest.phase!==phase||latest.publishIndex!==publishIndex) return;
        tx.create(db.doc(`users/${job.ownerUid}/vetting/${q.id}`),q);
        const more=publishIndex+1<checkpoint.ready.length;
        tx.update(ref,{added:latest.added+1,publishIndex:more?publishIndex+1:0,phase:more?'publish':'page',
          status:!more&&page>job.total?'completed':'queued',error:'',updatedAt:new Date().toISOString()});
      });
      return;
    }
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const bytes=(await bucket().file(job.path).download())[0];
    doc=await pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,CanvasFactory}).promise;
    if(doc.numPages>MAX_PAGES) throw new Error(`This PDF has ${doc.numPages} pages. Split it into files of at most ${MAX_PAGES} pages; no pages have been silently skipped.`);
    const pending=job.checkpoint ? JSON.parse((await bucket().file(job.checkpoint).download())[0].toString()).pending : null;
    const canvas=await render(doc,page), image=canvas.toBuffer('image/jpeg').toString('base64');
    const reference=page>1?(await render(doc,page-1)).toBuffer('image/jpeg').toString('base64'):null;
    const boundary=`\nPDF BOUNDARY RULES (override single-image assumptions): image 1 is the CURRENT page ${page}. ${reference?'Image 2 is the PREVIOUS page for context only; NEVER extract it again.':''} Extract ALL and ONLY questions/parts printed on image 1. Add sourceQuestionNumber to each entry (original main number, no part suffix). The first entry may have continuation:true if it belongs to the last question on the previous page, including repeated numbers with (continued), a new diagram for an existing question, a stem split mid-sentence, or later lettered parts. A repeated number or a continuation diagram does NOT start a new question. All other entries have continuation:false. Never renumber lettered parts. Use previous-page context to answer continuation parts. A continuation-only page is NOT blank. All image rectangles refer to image 1. Last held question: ${pending?JSON.stringify({number:pending.sourceQuestionNumber,blocks:pending.blocks}).slice(0,35000):'none; do not guess a preceding question'}.`;
    const payloads=parseReply(await ask(job.prompt+boundary,reference?[image,reference]:[image],job));
    if(payloads.length>60) throw new Error('Too many questions on one page; review this PDF.');
    const token=randomUUID(), sourceUrl=await storeImage(job,token,`page-${page}`,canvas), entries=[];
    for(let i=0;i<payloads.length;i++) {
      const payload=payloads[i], urls=[];
      for(const block of payload.blocks.filter(b=>b.type==='image')) {
        const rect=cropRect(block.box_2d,canvas.width,canvas.height);
        if(!rect) {urls.push(sourceUrl);continue;}
        const crop=createCanvas(rect.w,rect.h);
        crop.getContext('2d').drawImage(canvas,rect.x,rect.y,rect.w,rect.h,0,0,rect.w,rect.h);
        urls.push(await storeImage(job,token,`page-${page}-q${i}-figure${urls.length}`,crop));
      }
      const q=normaliseQuestion(payload,`q_rapid_${id}_${page}_${i}`,job,page,sourceUrl,urls);
      if(q.blocks.some(b=>b.type==='image'&&b.url===sourceUrl)) q.diagramWhole=true;
      entries.push({q,continuation:payload.continuation===true});
    }
    const assembled=assemblePage(pending,entries,page===doc.numPages);
    // Immutable checkpoint uploaded before the atomic Firestore publication.
    const checkpoint=`cer-rapid/${job.ownerUid}/${id}/checkpoints/${token}.json`;
    await bucket().file(checkpoint).save(JSON.stringify(assembled),{resumable:false,contentType:'application/json'});
    await db.runTransaction(async tx=>{
      const latest=(await tx.get(ref)).data();
      if(latest.status!=='queued'||latest.nextPage!==page||latest.generation!==generation||latest.phase!==phase||latest.publishIndex!==publishIndex) return;
      tx.update(ref,{checkpoint,nextPage:page+1,total:doc.numPages,phase:assembled.ready.length?'publish':'page',publishIndex:0,
        status:page===doc.numPages&&!assembled.ready.length?'completed':'queued',error:'',updatedAt:new Date().toISOString()});
    });
  } catch(e) {
    // The final attempt leaves a durable, visible failure and a retry button.
    // Earlier committed pages and the held question stay intact.
    await db.runTransaction(async tx=>{
      const latest=(await tx.get(ref)).data();
      if(latest?.nextPage!==page||latest.generation!==generation||latest.status!=='queued'||latest.phase!==phase||latest.publishIndex!==publishIndex) return;
      tx.update(ref,{error:String(e.message||e).slice(0,300),...(request.retryCount>=4?{status:'failed'}:{}),updatedAt:new Date().toISOString()});
    });
    throw e;
  } finally {if(doc) await doc.destroy();}
});
