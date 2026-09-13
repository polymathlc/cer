// Scheduling only: these helpers never change questions, marks or rewards.
// All time and student state are passed in, so a restored progress document
// produces the same exclusions as an attempt recorded in this tab.
export const PRACTICE_FAMILY_COOLDOWN_MS = 15 * 60 * 1000;

const text = value => String(value == null ? '' : value);
const formattingFree = (value, keepMathTags = false) => {
  const input = text(value);
  // Do not mistake inequalities such as "x<y and z>4" for an HTML tag.
  // Even a variable called b or a is kept unless a matching closing HTML
  // tag exists. Only the editor's ordinary paired formatting is discarded.
  return input.replace(/<\/?(p|div|span|br|b|strong|i|em|u|s|strike|sup|sub|ul|ol|li|a|h[1-6])\b[^>]*>/gi,
    (tag, name) => keepMathTags && /^(sup|sub)$/i.test(name) ? tag :
      name.toLowerCase() === 'br' || new RegExp(`</${name}\\s*>`, 'i').test(input) ? ' ' : tag);
};
const normalized = value => formattingFree(value).normalize('NFKC').toLowerCase()
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
// Exact question identity must retain mathematical case, superscripts and
// subscripts. Compatibility folding would conflate x² with x2, and lowering
// case would conflate variables or units such as m and M. Title families can
// still use the looser normalization above as a separate spacing hint.
const contentNormalized = value => formattingFree(value, true).normalize('NFC')
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();

function timeMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value && typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (value && typeof value.seconds === 'number') return value.seconds * 1000;
  return Date.parse(value) || 0;
}

// Two independent accumulators keep large embedded diagrams out of map keys.
// This is a content identifier, not a security or grading decision.
function contentHash(value) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b, 33) ^ c;
  }
  return `${value.length}:${a >>> 0}:${b >>> 0}`;
}

export function practiceContentKey(question) {
  const q = question || {};
  const blocks = (Array.isArray(q.blocks) ? q.blocks : []).flatMap(block => {
    if (!block) return [];
    if (block.type === 'text') {
      const words = contentNormalized(block.content);
      // Rich text may contain an inline picture. Preserve its source with
      // case intact, just like the mathematical text.
      const media = Array.from(text(block.content).matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi),
        match => match[1] || match[2] || match[3] || '');
      return words ? [['text', contentNormalized(block.part), contentNormalized(block.subPart), words, media]] : [];
    }
    if (block.type === 'image') {
      const url = text(block.url || block.src || block.dataUrl).trim();
      // Preserve diagrams and the task of annotating them. Styling, crop
      // display size, block ids and private answer fields are immaterial.
      return url ? [['image', url, contentNormalized(block.caption), !!block.annotate]] : [];
    }
    if (block.type === 'table') {
      const rows = Array.isArray(block.rows) ? block.rows.map(row =>
        Array.isArray(row) ? row.map(contentNormalized) : contentNormalized(row)) : [];
      return [['table', contentNormalized(block.caption), block.header !== false, rows]];
    }
    return [];
  });
  if (!blocks.length && contentNormalized(q.questionText || q.question)) {
    blocks.push(['text', contentNormalized(q.questionText || q.question), []]);
  }
  if (!blocks.length) return '';
  const optionValue = value => {
    if (!value || typeof value !== 'object') return contentNormalized(value);
    if (Array.isArray(value)) return value.map(optionValue);
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, optionValue(value[key])]));
  };
  const options = Array.isArray(q.options) ? q.options.map(optionValue) : [];
  // Digits, units, operations, option order and diagram URLs all matter.
  return `content:${contentHash(JSON.stringify([blocks, options]))}`;
}

export function practiceTitleFamily(question) {
  const q = question || {};
  const title = normalized(q.title)
    .replace(/\s*[([](?:copy|variant|version|easier|harder)(?:\s*#?\d+)?[)\]]\s*$/g, '')
    .replace(/\s+(?:copy|variant|version)\s*#?\d*\s*$/g, '').trim();
  const words = (title.match(/[a-z]+(?:'[a-z]+)?/g) || []).filter(word => word.length > 2);
  // Broad filing labels must not turn every arithmetic question into one
  // family. A distinctive story title is a spacing hint, never a deletion.
  const generic = new Set(('question questions practice problem problems word ' +
    'math maths mathematics exercise exercises worksheet test quiz revision ' +
    'addition subtraction multiplication division fraction fractions percentage ' +
    'percentages ratio algebra geometry measurement decimal decimals number ' +
    'numbers operation operations basic advanced challenge mixed harder easier ' +
    'primary level grade chapter part topic set review solving of the and with ' +
    'using for find finding calculate calculating solve solving about ' +
    'science scientific living things plant plants animal animals life cells ' +
    'reproduction photosynthesis diversity cycles systems interactions energy ' +
    'water heat light electricity electrical circuit circuits forces magnets ' +
    'magnetism materials matter air food butterfly seed seeds body human').split(' '));
  if (title.length < 8 || words.length < 2 || !words.some(word => !generic.has(word))) return '';
  const topics = Array.isArray(q.topics) && q.topics.length ? q.topics : text(q.topic).split(',');
  return `title:${normalized(topics.map(normalized).sort().join('|'))}:${title}`;
}

// Variant links are occasionally chains, missing-parent links or cycles.
// Union-find handles all three and also connects exact copies filed under
// unrelated ids. Title families are kept separate from exact-copy groups:
// a new numerical variant waits 15 minutes, not the original's whole review.
export function buildPracticeCatalog(questions) {
  const byId = new Map(), familyParents = new Map(), exactParents = new Map();
  const find = (parents, id) => {
    if (!parents.has(id)) parents.set(id, id);
    let root = id;
    while (parents.get(root) !== root) root = parents.get(root);
    while (parents.get(id) !== id) {
      const next = parents.get(id); parents.set(id, root); id = next;
    }
    return root;
  };
  const join = (parents, a, b) => {
    const aa = find(parents, a), bb = find(parents, b);
    if (aa !== bb) parents.set(aa > bb ? aa : bb, aa > bb ? bb : aa);
  };
  const contentIds = new Map(), titleIds = new Map();
  for (const q of Array.isArray(questions) ? questions : []) {
    if (!q || !text(q.id)) continue;
    const id = text(q.id);
    byId.set(id, q); find(familyParents, id); find(exactParents, id);
    if (q.variantOf) join(familyParents, id, text(q.variantOf));
    const content = practiceContentKey(q);
    if (content) {
      if (contentIds.has(content)) {
        join(exactParents, id, contentIds.get(content));
        join(familyParents, id, contentIds.get(content));
      } else contentIds.set(content, id);
    }
    const title = practiceTitleFamily(q);
    if (title) {
      if (titleIds.has(title)) join(familyParents, id, titleIds.get(title));
      else titleIds.set(title, id);
    }
  }
  const families = new Map(), exact = new Map();
  // Include missing roots, so progress for a removed original still protects
  // its variants from immediately following it after a reload.
  for (const id of familyParents.keys()) families.set(id, find(familyParents, id));
  for (const id of exactParents.keys()) exact.set(id, find(exactParents, id));
  return { byId, families, exact };
}

export function createPracticeRun(uid = '') {
  return { uid: text(uid), served: [] };
}

export function recordPracticeServed(run, question, now = Date.now(), uid = run && run.uid) {
  const next = run && run.uid === text(uid) ? run : createPracticeRun(uid);
  const id = text(question && question.id);
  if (!id || next.served.some(item => item.id === id)) return next;
  return { uid: next.uid, served: next.served.concat({ id, at: Number(now) || 0 }) };
}

function practiceHistory(catalog, progress, run, uid, now) {
  const exactDue = new Map(), familyRecent = new Map(), servedIds = new Set(), servedExact = new Set();
  for (const [storedId, p] of Object.entries(progress || {})) {
    if (!p || typeof p !== 'object') continue;
    const id = text(p.questionId || storedId);
    const exact = catalog.exact.get(id) || id;
    const family = catalog.families.get(id) || id;
    const last = timeMs(p.lastAttemptAt), due = timeMs(p.nextReviewAt);
    if (due > now) exactDue.set(exact, Math.max(exactDue.get(exact) || 0, due));
    if (last) familyRecent.set(family, Math.max(familyRecent.get(family) || 0, last));
  }
  if (run && run.uid === text(uid)) {
    for (const item of Array.isArray(run.served) ? run.served : []) {
      const id = text(item && item.id);
      if (!id) continue;
      servedIds.add(id);
      servedExact.add(catalog.exact.get(id) || id);
      const family = catalog.families.get(id) || id;
      familyRecent.set(family, Math.max(familyRecent.get(family) || 0, Number(item.at) || 0));
    }
  }
  return { exactDue, familyRecent, servedIds, servedExact };
}

// Candidates are already ranked by the app's learning priorities. Selection
// preserves that ranking amongst eligible families, without mutating the bank
// or adding repeat questions to fill a nominal set size.
export function planPracticeQuestions(candidates, options = {}) {
  const bank = options.bank || candidates;
  const catalog = options.catalog || buildPracticeCatalog(bank);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const history = practiceHistory(catalog, options.progress, options.run, options.uid, now);
  const selected = [], blocked = [], seenIds = new Set(), chosenFamilies = new Set();
  const excludedIds = new Set((options.excludeIds || []).map(text));
  const excludedFamilies = new Set((options.excludeFamilyIds || []).map(id => catalog.families.get(text(id)) || text(id)));
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : Infinity;
  let nextReviewAt = 0;
  for (const q of Array.isArray(candidates) ? candidates : []) {
    if (!q || !text(q.id)) continue;
    const id = text(q.id), family = catalog.families.get(id) || id;
    const exact = catalog.exact.get(id) || id;
    let reason = '';
    if (options.videoOnly && !(q.hasVideoExplanation || q.videoExplanationUrl)) reason = 'filter';
    else if (!options.manual) {
      const due = history.exactDue.get(exact) || 0;
      const recent = history.familyRecent.get(family) || 0;
      if (excludedIds.has(id) || history.servedIds.has(id) || history.servedExact.has(exact)) reason = 'served';
      else if (due > now) reason = 'review-not-due';
      else if (recent && recent + PRACTICE_FAMILY_COOLDOWN_MS > now) reason = 'recent-family';
      else if (excludedFamilies.has(family)) reason = 'same-family';
      else if (options.onePerFamily !== false && chosenFamilies.has(family)) reason = 'same-family';
      else if (seenIds.has(id)) reason = 'duplicate-id';
      if (reason === 'review-not-due' || reason === 'recent-family') {
        const ready = Math.max(due, recent ? recent + PRACTICE_FAMILY_COOLDOWN_MS : 0);
        if (!nextReviewAt || ready < nextReviewAt) nextReviewAt = ready;
      }
    }
    if (reason) { blocked.push({ id, reason }); continue; }
    if (selected.length < limit) {
      selected.push(q); chosenFamilies.add(family); seenIds.add(id);
    }
  }
  return { questions: selected, blocked, nextReviewAt };
}
