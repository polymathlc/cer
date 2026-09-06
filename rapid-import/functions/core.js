// No browser or Firebase dependencies: these invariants are tested directly.
export const MAX_PDF_BYTES = 40 * 1024 * 1024;
export const CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_PAGES = 60;
export const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/\r?\n/g, '<br>');
export function parseReply(response) {
  if (response.candidates?.[0]?.finishReason !== 'STOP') throw new Error('AI response incomplete; retrying this page without saving partial questions.');
  const parsed = JSON.parse(response.text);
  if (!Array.isArray(parsed.questions)) throw new Error('AI did not return a question list.');
  if (parsed.questions.some(q => !q || !Array.isArray(q.blocks) || !q.blocks.length)) throw new Error('AI returned an incomplete question.');
  return parsed.questions;
}
export function cropRect(box, width, height) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null;
  const [y1,x1,y2,x2] = box.map(n => Math.max(0, Math.min(1000, n)));
  const x = Math.floor(x1 * width / 1000), y = Math.floor(y1 * height / 1000);
  const w = Math.min(width - x, Math.ceil((x2-x1)*width/1000));
  const h = Math.min(height - y, Math.ceil((y2-y1)*height/1000));
  return w >= 5 && h >= 5 ? {x,y,w,h} : null;
}
export function normaliseQuestion(payload, id, job, page, sourceUrl, imageUrls) {
  let part = '';
  const blocks = [];
  for (const b of payload.blocks) {
    const bid = id + '_b' + blocks.length;
    const type = String(b.type || '').toLowerCase();
    const text = String(b.text ?? b.content ?? '');
    let out;
    if (type === 'text') {
      const match = /^\s*\(([a-z])\)\s*/.exec(text);
      if (match) part = match[1];
      out = { id: bid, type, content: html(match ? text.slice(match[0].length) : text) };
      if (Number.isInteger(b.marks) && b.marks > 0 && b.marks <= 20) out.marks = b.marks;
    } else if (type === 'image') {
      out = { id: bid, type, url: imageUrls.shift() || sourceUrl, caption: String(b.caption || '') };
    } else if (type === 'mcq') {
      if (!Array.isArray(b.options) || b.options.length < 2) throw new Error('Incomplete multiple-choice options.');
      const options = b.options.map((s,i) => ({id: bid + '_' + i, text: String(s)}));
      out = {id: bid, type, options, correctId: options[b.correctIndex]?.id || null};
    } else if (type === 'answer') {
      out = {id: bid, type, claim: html(b.claim), evidence: html(b.evidence), reasoning: html(b.reasoning)};
    } else if (type === 'plainanswer' || type === 'explanation') {
      out = {id: bid, type, content: html(text || b.answer)};
    } else throw new Error('Unsupported question block: ' + type);
    if (part) out.part = part;
    blocks.push(out);
  }
  if (!blocks.length) throw new Error('Empty question.');
  const topics = job.topics || [];
  const q = {
    id, title: String(payload.title || 'Untitled'), topic: topics.includes(payload.topic) ? payload.topic : topics[0] || 'Heat',
    category: blocks.some(b => b.type === 'mcq') ? 'MCQ' : String(payload.category || 'Explanation'),
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0,20).map(String) : [],
    blocks, blanks: {}, markingGuide: '', status: 'pending',
    createdAt: job.createdAt, createdBy: job.createdBy,
    sourcePdf: job.name, sourcePages: [{page, url: sourceUrl}], rapidImportId: job.id,
    sourceQuestionNumber: String(payload.sourceQuestionNumber || '').slice(0,40),
    topicConfidence: topics.includes(payload.topic) ? 'high' : 'low'
  };
  if (job.release) q.releaseOn = job.release;
  return q;
}
// Keep the final question PRIVATE until the next page resolves its boundary.
// No half is published and then deleted; retries cannot resurrect one.
export function assemblePage(pending, entries, isLast) {
  const ready = [];
  let carry = pending;
  for (let i=0; i<entries.length; i++) {
    const {q, continuation} = entries[i];
    const sameNumber = !carry?.sourceQuestionNumber || !q.sourceQuestionNumber || carry.sourceQuestionNumber === q.sourceQuestionNumber;
    if (i === 0 && continuation && carry && sameNumber) {
      const inheritedPart=carry.blocks.at(-1)?.part;
      const tail=q.blocks.map(b=>!b.part&&inheritedPart?{...b,part:inheritedPart}:b);
      carry = {...carry, blocks: [...carry.blocks, ...tail], sourcePages: [...carry.sourcePages, ...q.sourcePages],
        ...(carry.diagramWhole||q.diagramWhole?{diagramWhole:true}:{}),
        ...(q.importWarning?{importWarning:q.importWarning}:{})};
    } else {
      if (carry) ready.push(carry);
      carry = q;
      if (continuation) carry.importWarning = 'Continuation could not be matched safely. Check the preceding page.';
    }
  }
  // A blank/instruction page is a boundary, never a reason to skip back to
  // some unrelated earlier question. The held question is preserved.
  if (isLast || !entries.length) { if (carry) ready.push(carry); carry = null; }
  return {ready, pending: carry};
}
export function signature(q) {
  const raw = JSON.stringify({t:q.title||'',p:q.topic||'',c:q.category||'',a:!!q.annotation,b:q.blocks||[]});
  let h=5381; for (let i=0;i<raw.length;i++) h=((h<<5)+h+raw.charCodeAt(i))|0;
  return raw.length + ':ai:' + (h>>>0).toString(36) + ':' + raw.slice(0,4000);
}
