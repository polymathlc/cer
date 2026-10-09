// Private revision sheets retain their own source snapshots. These helpers never
// change a bank question, produce a picture, or accept image URLs from an AI.
export const SS_LIMITS = Object.freeze({ cards: 48, aiBatch: 24, question: 180, answer: 360, howTo: 220,
  title: 100, sourceText: 24000, sourceAnswer: 16000, images: 24, imageLabel: 180, sheetBytes: 850000 });

const clone = value => JSON.parse(JSON.stringify(value));
const text = (value, limit) => String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, limit);
const plain = value => String(value == null ? '' : value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
const short = (value, limit) => plain(value).slice(0, limit);
const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = prefix => prefix + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));

function imageUrl(value) {
  const url = String(value || '').trim().replace(/&amp;/g, '&');
  if (!url || /[\u0000-\u001f]/.test(url)) return '';
  return /^(?:https?:\/\/|data:image\/(?:png|jpeg|jpg|webp|gif);base64,|\/|\.\.?\/)/i.test(url) ? url : '';
}
function imagesOf(values, limit = SS_LIMITS.images) {
  const seen = new Map(), images = [];
  for (const item of Array.isArray(values) ? values : []) {
    const url = imageUrl(typeof item === 'string' ? item : item?.url);
    if (!url) continue;
    const label = short(typeof item === 'string' ? '' : item?.label, SS_LIMITS.imageLabel) || 'Original question image';
    const existing = seen.get(url);
    if (existing) {
      if (!existing.labels.includes(label)) existing.labels.push(label);
      existing.image.label = existing.labels.join(' / ').slice(0, SS_LIMITS.imageLabel);
    } else {
      const image = { url, label }; images.push(image); seen.set(url, { image, labels: [label] });
    }
  }
  return images.slice(0, limit);
}

// The allowlist is question-side only: answer keys, model-answer images,
// explanations and annotation solutions cannot become question figures.
export function extractSummaryQuestionImages(question) {
  const images = [];
  const add = (url, label) => { if (url) images.push({ url, label }); };
  const scan = (value, prefix = '') => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/<img\b[^>]*>/gi)) {
        const src = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
        const alt = /(?:^|\s)alt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[0]);
        if (src) add(src[1] ?? src[2] ?? src[3], [prefix, alt?.[1] ?? alt?.[2] ?? ''].filter(Boolean).join(' — ') || 'Original question image');
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach(item => scan(item, prefix));
  };
  for (const block of question?.blocks || []) {
    if (!block) continue;
    if (block.type === 'image') add(block.url, block.caption || block.alt || block.dgnLabel);
    if (['text', 'part'].includes(block.type)) scan(block.content);
    if (block.type === 'fillblank') scan(block.text);
    if (block.type === 'mcq') (block.options || []).forEach((option, index) => scan(option?.text,
      'Option ' + (question.mcqLabels === 'letters' && index < 26 ? String.fromCharCode(65 + index) : index + 1)));
    if (block.type === 'table') { scan(block.data); scan(block.caption); }
  }
  return imagesOf(images, Number.MAX_SAFE_INTEGER);
}

function stable(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => stable(item) ?? 'null').join(',') + ']';
  return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
}
export function summarySourceFingerprint(question) {
  const educational = {};
  for (const key of ['id', 'title', 'topic', 'topic2', 'level', 'category', 'category2', 'source', 'mcqLabels',
    'marks', 'los', 'markingGuide', 'answerKeywords', 'answerKeyNote', 'answerKeyImage', 'answerKeyDiagramNote', 'annotation', 'blocks']) {
    if (question?.[key] !== undefined) educational[key] = question[key];
  }
  const source = stable(educational);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < source.length; i++) { a = Math.imul(a ^ source.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ source.charCodeAt(i); }
  return 'ss1:' + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0') + ':' + source.length;
}

export function createSummaryCard(question, context = {}, id = newId('sc_')) {
  if (!question?.id) throw new Error('Choose a saved question from the bank.');
  const sourceImages = extractSummaryQuestionImages(question);
  if (sourceImages.length > SS_LIMITS.images) throw new Error('This question has more than ' + SS_LIMITS.images + ' pictures. Use a smaller question so every original image can be kept.');
  const labels = new Map(imagesOf(context.images).map(image => [image.url, image.label]));
  const images = sourceImages.map(image => {
    const role = labels.get(image.url);
    // The portal's role label has its authoritative option letter/number.
    // Retain the original caption/alt as well, without a competing option label.
    const caption = image.label.split(' / ').map(label => label.replace(/^Option (?:[0-9]+|[A-Z])(?: — )?/, '').trim())
      .filter(label => label && label !== 'Original question image').join(' / ');
    return { ...image, label: role ? short(role + (caption && caption !== role ? ' — ' + caption : ''), SS_LIMITS.imageLabel) : image.label };
  });
  const sourceText = text(context.text || question.title, SS_LIMITS.sourceText);
  const sourceAnswer = text(context.answer, SS_LIMITS.sourceAnswer);
  const sourceExplanation = text(context.explanation, SS_LIMITS.sourceAnswer);
  return {
    id: String(id), questionId: String(question.id), sourceSignature: summarySourceFingerprint(question),
    sourceTitle: short(question.title, SS_LIMITS.title), topic: short(question.topic || context.topic, SS_LIMITS.title),
    sourceMeta: clone(Object.fromEntries(['id', 'title', 'topic', 'topic2', 'level', 'category', 'tags', 'los']
      .filter(key => question[key] !== undefined).map(key => [key, question[key]]))),
    sourceText, sourceAnswer, sourceExplanation, fullContext: text(context.fullContext, SS_LIMITS.sourceText), images, answerImages: imagesOf(context.answerImages),
    shortQuestion: short(sourceText, SS_LIMITS.question), shortAnswer: short(sourceAnswer, SS_LIMITS.answer), howTo: '',
  };
}

function normalizeCard(raw, index) {
  if (!raw || typeof raw !== 'object' || !raw.questionId) return null;
  return {
    id: text(raw.id || 'sc_' + index, 120), questionId: text(raw.questionId, 200),
    sourceSignature: text(raw.sourceSignature, 200), sourceTitle: text(raw.sourceTitle, SS_LIMITS.title),
    topic: text(raw.topic, SS_LIMITS.title), sourceMeta: raw.sourceMeta && typeof raw.sourceMeta === 'object' ? clone(raw.sourceMeta) : {},
    sourceText: text(raw.sourceText, SS_LIMITS.sourceText), sourceAnswer: text(raw.sourceAnswer, SS_LIMITS.sourceAnswer),
    sourceExplanation: text(raw.sourceExplanation, SS_LIMITS.sourceAnswer), fullContext: text(raw.fullContext, SS_LIMITS.sourceText), images: imagesOf(raw.images), answerImages: imagesOf(raw.answerImages),
    shortQuestion: short(raw.shortQuestion, SS_LIMITS.question), shortAnswer: short(raw.shortAnswer, SS_LIMITS.answer), howTo: short(raw.howTo, SS_LIMITS.howTo),
  };
}
export function normalizeSummarySheet(raw, id) {
  if (!raw || typeof raw !== 'object' || raw.kind !== 'summary-sheet' || !(raw.id || id)) return null;
  const seen = new Set();
  const summaryCards = (Array.isArray(raw.summaryCards) ? raw.summaryCards : []).map(normalizeCard).filter(card => {
    if (!card || seen.has(card.id)) return false;
    seen.add(card.id); return true;
  }).slice(0, SS_LIMITS.cards);
  return { id: text(raw.id || id, 200), kind: 'summary-sheet', version: 1, title: text(raw.title || 'Topic cheat sheet', SS_LIMITS.title),
    createdAt: text(raw.createdAt, 80), updatedAt: text(raw.updatedAt, 80), createdBy: text(raw.createdBy, 200), summaryCards };
}

export function normalizeSummarySuggestion(reply) {
  let parsed = reply;
  if (typeof parsed === 'string') {
    const cleaned = parsed.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { parsed = JSON.parse(cleaned); } catch (_) { throw new Error('The AI reply could not be read. Your card is unchanged.'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The AI returned no usable card suggestion.');
  const suggestion = { shortQuestion: short(parsed.shortQuestion, SS_LIMITS.question), shortAnswer: short(parsed.shortAnswer, SS_LIMITS.answer),
    howTo: short(parsed.howTo, SS_LIMITS.howTo), note: short(parsed.note, 500) };
  if (!suggestion.shortQuestion || !suggestion.shortAnswer) throw new Error('The AI suggestion needs a question and an answer. Your card is unchanged.');
  return suggestion;
}

// Preparing an answer cannot revise the teacher's current question, reminder,
// source identity or pictures, even if the model returns those extra fields.
export function normalizeSummaryAnswerSuggestion(reply) {
  let parsed = reply;
  if (typeof parsed === 'string') {
    const cleaned = parsed.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { parsed = JSON.parse(cleaned); } catch (_) { throw new Error('The AI reply could not be read. Your answer is unchanged.'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The AI returned no usable answer suggestion.');
  const suggestion = { shortAnswer: short(parsed.shortAnswer, SS_LIMITS.answer), note: short(parsed.note, 500) };
  if (!suggestion.shortAnswer) throw new Error('The AI did not prepare an answer. Your existing answer is unchanged.');
  return suggestion;
}

export function summarySheetPrintHtml(sheet, { imageUrl: transform = value => value } = {}) {
  const normalized = normalizeSummarySheet(sheet);
  if (!normalized) throw new Error('That summary sheet could not be read.');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + escape(normalized.title) + '</title><link rel="stylesheet" href="summary-sheets.css?v=1.428.1">'
    + '<style>body{font-family:Arial,sans-serif;margin:0;padding:12mm;color:#182525;background:white}.ss-present-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5mm}.ss-present-card{border:1px solid #d1ddd7;border-radius:3mm;padding:4mm;break-inside:avoid;page-break-inside:avoid}.ss-images{display:flex;flex-wrap:wrap;gap:2mm}.ss-images.ss-images-multiple{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.ss-figure{margin:0;min-width:0}.ss-image{max-width:100%;max-height:45mm;object-fit:contain}.ss-image-caption{font-size:7pt}.ss-present-question{font-weight:bold}.ss-present-answer,.ss-present-howto{white-space:pre-wrap;line-height:1.45}h1{font-size:18pt;margin:0 0 6mm}@page{size:A4;margin:10mm}@media print{body{padding:0}}</style></head><body>'
    + '<h1>' + escape(normalized.title) + '</h1><main class="ss-present-grid">'
    + normalized.summaryCards.map((card, index) => '<article class="ss-present-card"><p class="ss-present-question">'
      + (index + 1) + '. ' + escape(card.shortQuestion) + '</p>'
      + (card.images.length ? '<div class="ss-images' + (card.images.length > 1 ? ' ss-images-multiple' : '') + '">' + card.images.map(image => '<figure class="ss-figure"><img class="ss-image" src="' + escape(imageUrl(transform(image.url)))
        + '" alt="' + escape(image.label) + '"><figcaption class="ss-image-caption">' + escape(image.label) + '</figcaption></figure>').join('') + '</div>' : '')
      + '<p class="ss-present-answer"><strong>Suggested answer</strong><br>' + escape(card.shortAnswer || 'No answer recorded — review before showing students.') + '</p>'
      + (card.howTo ? '<p class="ss-present-howto"><strong>How to answer</strong><br>' + escape(card.howTo) + '</p>' : '') + '</article>').join('')
    + '</main></body></html>';
}
