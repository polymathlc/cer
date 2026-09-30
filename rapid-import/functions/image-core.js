// Pure contracts shared by the durable worker and callable image controls.
export const FIGURE_KINDS = ['diagram','table','flowchart','graph'];
export function figureMode(kind, requested = 'colour') {
  if (!['colour','bw','original'].includes(requested)) throw new Error('Choose colour, black and white, or original.');
  return requested === 'original' ? 'original' : ['table','flowchart','graph'].includes(kind) ? 'bw' : requested;
}
// One house style for every regenerated figure. An image model cannot load a
// font file, but it follows a named typeface and a clear geometric description.
export const FIGURE_FONT = 'Century Gothic';
export const FIGURE_FONT_STYLE = `Typeset EVERY label, heading and number in ${FIGURE_FONT}: a smooth, clean geometric sans-serif with perfectly round letter bowls, single-storey "a", even stroke weight and generous letter spacing. Never use a handwritten, serif, condensed or decorative face.`;
// A "word diagram" (classification tree, concept map, flow chart, cycle of
// boxes and arrows) has no pictured objects, so it is monochrome like a table.
export const CLASSIFY_FIGURE_PROMPT = 'Classify this scanned science figure. Return JSON {"kind":"diagram|table|flowchart|graph"}. "table" is any grid of rows and columns. "graph" is any chart or plot with axes, bars, lines or pie sectors. "flowchart" is ANY word diagram: boxes, circles or brackets containing only words, numbers or symbols joined by lines or arrows (flow charts, classification trees, concept maps, cycles, grouping diagrams). "diagram" is ONLY a picture of real objects, apparatus, organisms or scenes, with or without labels. If it has no pictured objects it is never a "diagram".';
export function imageInstruction(kind, mode) {
  const words = ['table','flowchart','graph'].includes(kind);
  return `Clean the supplied original scanned ${kind} into a precise textbook figure on a pure white background. ` +
    (mode === 'bw' ? 'Use only BLACK AND WHITE: pure black lines and text on pure white, no grey fills and no colour. ' : 'Use restrained educational colour for pictured objects, keeping all text and arrows black. Never use colour to add or reveal an answer. ') +
    (words ? 'Redraw every border, box, table rule, axis, connector and arrow as a perfectly STRAIGHT, crisp, evenly weighted line with square corners, exactly horizontal or vertical unless the original is clearly diagonal; no wobble, no sketchy or hand-drawn strokes, no double lines. ' : 'Redraw every ruled line, label leader and arrow as a smooth, clean, evenly weighted line; straighten any line that was meant to be straight. ') +
    FIGURE_FONT_STYLE + ' ' +
    'Keep EXACTLY every original label, word, number, unit, symbol, object, arrow direction, connection, proportion, and relative position. ' +
    'Repair scanning noise and remove specks and stray marks. ' +
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

// Figures imported before originalCropUrl existed carry no preserved original,
// so every later regeneration refused. Their current picture IS the untouched
// crop provided it was never regenerated and is not merely the whole page.
export function adoptOriginal(block, pageUrls = []) {
  if (!block || block.type !== 'image' || !block.url || originalImageUrl(block)) return block;
  const regenerated = block.enhancement && block.enhancement.mode !== 'original';
  if (regenerated || pageUrls.includes(block.url) || block.url === block.cropSource?.url) return block;
  return {...block, originalCropUrl: block.url, preColourUrl: block.url,
    ...(block.cropSource ? {cropSource: {...block.cropSource, imageUrl: block.url}} : {})};
}
// Findings the automatic fix can act on by re-cutting / regenerating a figure.
export function figureFixTargets(findings, blocks = []) {
  const ids = new Set(blocks.filter(b => b.type === 'image').map(b => b.id));
  return [...new Set((findings || []).filter(f => f && ids.has(f.blockId) && ['Crop','Diagram'].includes(f.type)).map(f => f.blockId))];
}
