// Pure contracts shared by the durable worker and callable image controls.
export const FIGURE_KINDS = ['diagram','table','flowchart','graph'];
export function figureMode(kind, requested = 'colour') {
  if (!['colour','bw','original'].includes(requested)) throw new Error('Choose colour, black and white, or original.');
  return requested === 'original' ? 'original' : ['table','flowchart','graph'].includes(kind) ? 'bw' : requested;
}
export function imageInstruction(kind, mode) {
  return `Clean the supplied original scanned ${kind} into a precise textbook figure on a pure white background. ` +
    (mode === 'bw' ? 'Use only BLACK AND WHITE. ' : 'Use restrained educational colour for pictured objects, keeping all text and arrows black. Never use colour to add or reveal an answer. ') +
    'Keep EXACTLY every original label, word, number, unit, symbol, object, arrow direction, connection, proportion, and relative position. ' +
    'Repair scanning noise, straighten ruled borders and flowchart connectors, and typeset labels in a clear readable sans-serif font. ' +
    'Preserve table row and column counts, cell values and empty cells, graph values and scales, and flowchart topology. ' +
    'Do not solve, reinterpret, invent, omit, rearrange or clip any content. Leave whitespace around all labels. Preserve the aspect ratio. Output only the image.';
}
export function originalImageUrl(block) {
  return block?.originalCropUrl || block?.preColourUrl || (block?.cropSource?.imageUrl === block?.url ? block.url : '');
}
export function storageImagePath(url, bucketName, ownerUid) {
  // Download only known per-owner Storage objects, never an arbitrary URL or
  // another teacher's object even if a forged block contains a download token.
  let u; try { u = new URL(url); } catch { throw new Error('The preserved original image is unavailable.'); }
  const prefix = `/v0/b/${bucketName}/o/`;
  if (u.protocol !== 'https:' || u.hostname !== 'firebasestorage.googleapis.com' || !u.pathname.startsWith(prefix)) throw new Error('The preserved image is not in this import store.');
  let path; try { path = decodeURIComponent(u.pathname.slice(prefix.length)); } catch { throw new Error('Invalid image path.'); }
  if (!path.startsWith(`cer-rapid/${ownerUid}/`) || path.split('/').some(p=>p==='..'||p==='.') || !path.includes('/images/')) throw new Error('The preserved image does not belong to this account.');
  return path;
}
export function enhancementFindings(q) {
  return (q.blocks||[]).filter(b=>b.type==='image'&&b.enhancement?.state==='error').map(b=>({
    type:'Diagram',severity:'med',title:'Figure enhancement needs review',
    detail:String(b.enhancement.error||'The original crop was kept because enhancement could not be verified.').slice(0,400),
    fix:'Retry colour or black-and-white enhancement from the preserved original crop.',ai:false,blockId:b.id
  }));
}
export function nextImageIndex(q, after=-1) {
  return (q?.blocks||[]).findIndex((b,i)=>i>after&&b.type==='image');
}
export function requireImageAudits(audits, targets) {
  if(!targets.length) return [];
  if(!Array.isArray(audits)||audits.length!==targets.length||new Set(audits.map(a=>a?.blockId)).size!==targets.length) throw new Error('The checker did not audit every displayed figure.');
  return targets.flatMap(target=>{
    const audit=audits.find(a=>a?.blockId===target);
    if(!audit||audit.complete!==true||typeof audit.faithful!=='boolean'||!Array.isArray(audit.issues)||audit.issues.some(s=>typeof s!=='string')) throw new Error('The checker could not complete the visual audit for '+target+'.');
    if(audit.faithful && !audit.issues.length) return [];
    return [{type:'Crop',severity:'high',title:'Figure differs from its source',blockId:target,
      detail:(audit.issues.join('; ')||'The checker could not verify that every source detail was preserved.').slice(0,400),
      fix:'Compare with the preserved original crop and regenerate or recrop this figure.',ai:true}];
  });
}
