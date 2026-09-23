// Bounded question repairs. Model output names a catalog target, never an object
// path or executable code. This module has no DOM, network or persistence access.
const MAX_ACTIONS = 20;
const MAX_TEXT = 16000;
const MAX_INSTRUCTION = 4000;
const MAX_SOURCE = 1000000;
const IMAGE_TOKEN = /\[\[IMAGE_(\d+)\]\]/g;
const IMAGE_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function fail(message) { throw new Error('Repair plan: ' + message); }
function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function text(value, label, max = MAX_TEXT, empty = true) {
  if (typeof value !== 'string') fail(label + ' must be text.');
  if (value.length > max) fail(label + ' is too long.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(label + ' contains invalid characters.');
  if (!empty && !value.trim()) fail(label + ' is empty.');
  return value;
}
function plain(value, label, max = MAX_TEXT, empty = true) {
  const result = text(value, label, max, empty);
  if (/<\/?[a-z!][^>]*>/i.test(result)) fail(label + ' must be plain text, without HTML.');
  return result;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function decodeHtml(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°', times: '×', divide: '÷', minus: '−', ndash: '–', mdash: '—', sup2: '²', sup3: '³' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? all;
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
  });
}
function imageSourceAttribute(tag) {
  // Consume complete attributes, including quoted values. Looking for /src=/
  // alone can accidentally select text inside an alt attribute or data-src.
  const attributes = /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  attributes.lastIndex = 4;
  let match;
  while ((match = attributes.exec(tag))) {
    if (match[1].toLowerCase() === 'src') return { index: match.index, length: match[0].length, value: match[2] ?? match[3] ?? match[4] };
  }
  return null;
}
function imageSrc(tag) {
  const source = imageSourceAttribute(tag);
  return source ? decodeHtml(source.value) : '';
}
function richValue(value) {
  const source = typeof value === 'string' ? value : '';
  if (source.length > MAX_SOURCE) fail('A text box is too large to repair safely.');
  const images = [];
  let result = source.replace(IMAGE_TAG, tag => {
    images.push(tag);
    return '[[IMAGE_' + images.length + ']]';
  });
  // Preserve common science units when turning editable HTML into plain text.
  const supers = '⁰¹²³⁴⁵⁶⁷⁸⁹', subs = '₀₁₂₃₄₅₆₇₈₉';
  result = result.replace(/<sup\b[^>]*>([0-9]+)<\/sup>/gi, (_, n) => [...n].map(c => supers[Number(c)]).join(''))
    .replace(/<sub\b[^>]*>([0-9]+)<\/sub>/gi, (_, n) => [...n].map(c => subs[Number(c)]).join(''))
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  result = decodeHtml(result).replace(/\r\n?/g, '\n').trim();
  return { value: result, images };
}
function checkTokens(value, images) {
  const found = [...value.matchAll(IMAGE_TOKEN)].map(m => Number(m[1]));
  if (found.length !== images.length || found.some(n => !Number.isInteger(n) || n < 1 || n > images.length)
      || images.some((_, i) => found.filter(n => n === i + 1).length !== 1)) {
    fail('Keep every original image token ([[IMAGE_n]]) exactly once in the edited text.');
  }
  // Reject misspelled tokens too: they must never print as accidental wording.
  if (/\[\[IMAGE_/i.test(value.replace(IMAGE_TOKEN, ''))) fail('An image token is invalid.');
}
function renderRich(value, images) {
  checkTokens(value, images);
  return escapeHtml(value).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>')
    .replace(IMAGE_TOKEN, (_, n) => images[Number(n) - 1]);
}
function safeId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 200; }
function fieldKey(blockId, field) { return field === 'content' || field === 'text' ? blockId : blockId + '_' + field; }

// Internal destinations are rebuilt from the actual question on every call.
// Only the public catalog is shown to the model; none of its metadata is trusted
// when a reply is applied.
function catalogFor(q) {
  if (!record(q) || !Array.isArray(q.blocks)) fail('The question has no blocks.');
  const entries = [];
  const destinations = new Map();
  const add = (entry, destination) => {
    if (destinations.has(entry.id)) fail('The question contains ambiguous target identifiers.');
    entries.push(entry);
    destinations.set(entry.id, destination);
  };
  for (const field of ['title', 'topic', 'category']) {
    add({ id: 'q:' + field, label: 'Question ' + field, kind: 'text', value: String(q[field] || '') }, { kind: 'question', field });
  }
  const blockIds = new Set();
  q.blocks.forEach((b, index) => {
    if (!record(b) || !safeId(b.id)) fail('Every question block needs a stable identifier.');
    if (blockIds.has(b.id)) fail('The question has duplicate block identifiers.');
    blockIds.add(b.id);
    const prefix = 'block:' + encodeURIComponent(b.id) + ':';
    const item = ' (item ' + (index + 1) + ')';
    const typeLabel = {
      text: 'Question wording', part: 'Question part', answer: 'Model answer', plainanswer: 'Model answer',
      explanation: 'Explanation', openLines: 'Answer space', workingSpace: 'Working space', image: 'Diagram',
      answerKey: 'Answer key', fillblank: 'Fill-in-the-blank wording', commonMistake: 'Common mistake',
      studentAnswer: 'Example student answer', mcq: 'Multiple-choice answer', table: 'Table',
    }[b.type] || 'Question item';
    const label = typeLabel + item;
    const fieldLabel = name => ({
      claim: 'Claim', evidence: 'Evidence', reasoning: 'Reasoning', label: 'Label',
      answer: 'Answer', answerKey: 'Annotation answer in words', caption: 'Diagram caption', title: 'Heading',
    }[name] || typeLabel) + item;
    const image = (id, name, value, destination) => {
      add({ id, label: name + item, kind: 'image', value: typeof value === 'string' ? value : '' }, destination);
    };
    const field = (name, rich = false) => {
      const id = prefix + name;
      const original = typeof b[name] === 'string' ? b[name] : '';
      const contents = rich ? richValue(original) : { value: original, images: [] };
      add({ id, label: fieldLabel(name), kind: 'text', value: contents.value },
        { kind: 'field', index, blockId: b.id, field: name, rich, images: contents.images });
      contents.images.forEach((tag, i) => image(id + ':inline:' + (i + 1), fieldLabel(name).slice(0, -item.length) + ': picture ' + (i + 1), imageSrc(tag),
        { kind: 'inline', index, blockId: b.id, field: name, imageIndex: i }));
    };
    const richFields = {
      text: ['content'], part: ['content'], answer: ['claim', 'evidence', 'reasoning'],
      plainanswer: ['content'], explanation: ['content'], openLines: ['content'], workingSpace: ['content'],
      answerKey: ['text'], commonMistake: ['text'], studentAnswer: ['answer'],
    }[b.type] || [];
    richFields.forEach(name => field(name, true));
    const plainFields = {
      part: ['label'], answerLine: ['answer', 'label'], image: ['caption', 'answerKey'], workingSpace: ['answerKey'],
      fillblank: ['text'], commonMistake: ['title'], studentAnswer: ['label'],
    }[b.type] || [];
    plainFields.forEach(name => field(name));
    if (['image', 'answerKey', 'explanation'].includes(b.type)) {
      image(prefix + 'url', b.type === 'answerKey' ? 'Answer-key diagram' : b.type === 'explanation' ? 'Explanation diagram' : 'Diagram', b.url,
        { kind: 'image', index, blockId: b.id, field: 'url' });
    }
    if (b.type === 'image' || b.type === 'workingSpace') {
      image(prefix + 'answerImg', 'Annotated answer diagram', b.answerImg,
        { kind: 'image', index, blockId: b.id, field: 'answerImg' });
    }
    if (b.type === 'mcq') {
      const options = Array.isArray(b.options) ? b.options : [];
      const optionIds = new Set();
      options.forEach((option, optionIndex) => {
        if (!record(option) || !safeId(option.id) || optionIds.has(option.id)) fail('Every option needs a unique stable identifier.');
        optionIds.add(option.id);
        const id = prefix + 'option:' + encodeURIComponent(option.id);
        const contents = richValue(String(option.text || ''));
        add({ id, label: 'Choice ' + (optionIndex + 1) + item, kind: 'text', value: contents.value },
          { kind: 'optionText', index, blockId: b.id, optionIndex, field: 'options', rich: true, images: contents.images });
        contents.images.forEach((tag, i) => image(id + ':inline:' + (i + 1), 'Choice ' + (optionIndex + 1) + ': picture ' + (i + 1), imageSrc(tag),
          { kind: 'inline', index, blockId: b.id, field: 'options', optionIndex, optionId: option.id, imageIndex: i }));
      });
      add({ id: prefix + 'correctId', label: 'Correct choice' + item, kind: 'option', value: b.correctId || '',
        choices: options.map((o, i) => ({ id: o.id, label: '(' + (i + 1) + ') ' + richValue(String(o.text || '')).value })) },
      { kind: 'correctOption', index, blockId: b.id, field: 'correctId', optionIds });
    }
    if (b.type === 'table' && b.data && typeof b.data === 'object') {
      for (const row of Object.keys(b.data).filter(k => /^\d+$/.test(k))) {
        const cells = b.data[row];
        if (!cells || typeof cells !== 'object') continue;
        for (const col of Object.keys(cells).filter(k => /^\d+$/.test(k))) {
          const contents = richValue(String(cells[col] ?? ''));
          const id = prefix + 'cell:' + row + ':' + col;
          add({ id, label: label + ' — row ' + (Number(row) + 1) + ', column ' + (Number(col) + 1), kind: 'text', value: contents.value },
            { kind: 'cell', index, blockId: b.id, field: 'data', row, col, rich: true, images: contents.images });
          contents.images.forEach((tag, i) => image(id + ':inline:' + (i + 1), 'Table row ' + (Number(row) + 1) + ', column ' + (Number(col) + 1) + ': picture ' + (i + 1), imageSrc(tag),
            { kind: 'inline', index, blockId: b.id, field: 'data', row, col, imageIndex: i }));
        }
      }
    }
  });
  for (const type of ['image', 'plainanswer', 'explanation']) {
    add({ id: 'new:' + type, label: 'Add a new ' + (type === 'plainanswer' ? 'model answer' : type), kind: 'insertion', value: '' }, { kind: 'insertion', type });
  }
  return { entries, destinations, blockIds };
}

export function questionRepairTargets(q) { return catalogFor(q).entries; }

export function normalizeQuestionRepairPlan(raw, q) {
  if (!record(raw) || !Array.isArray(raw.actions)) fail('Expected an actions list.');
  if (raw.actions.length > MAX_ACTIONS) fail('At most ' + MAX_ACTIONS + ' actions can be proposed at once.');
  const catalog = catalogFor(q);
  const seen = new Set();
  const allowed = new Set(['id', 'kind', 'target', 'reason', 'value', 'instruction', 'afterBlockId']);
  const actions = raw.actions.map((item, i) => {
    if (!record(item) || Object.keys(item).some(k => !allowed.has(k))) fail('Action ' + (i + 1) + ' contains unsupported fields.');
    const kind = text(item.kind, 'Action kind', 40, false);
    const target = text(item.target, 'Action target', 1000, false);
    const destination = catalog.destinations.get(target);
    if (!destination) fail('Unknown target ' + target + '.');
    if (seen.has(target)) fail('Two actions conflict on ' + target + '.');
    seen.add(target);
    const action = { id: 'a' + (i + 1), kind, target, reason: plain(item.reason, 'Action reason', 1600, false).trim() };
    const has = key => OWN(item, key) && item[key] !== undefined;
    if (kind === 'replace_text') {
      if (!['question', 'field', 'optionText', 'cell'].includes(destination.kind)) fail('This target does not accept text.');
      if (has('instruction') || has('afterBlockId')) fail('Text edits cannot carry image or insertion instructions.');
      action.value = plain(item.value, 'Replacement text');
      checkTokens(action.value, destination.images || []);
      if (destination.kind === 'question' && !action.value.trim()) fail('Question details cannot be blank.');
    } else if (kind === 'select_option') {
      if (destination.kind !== 'correctOption') fail('This target is not a correct-option selector.');
      if (has('instruction') || has('afterBlockId')) fail('Option selections cannot carry other instructions.');
      action.value = text(item.value, 'Correct option', 200, false);
      if (!destination.optionIds.has(action.value)) fail('The selected option does not exist.');
    } else if (kind === 'redraw_image' || kind === 'generate_image') {
      if (!['image', 'inline'].includes(destination.kind)) fail('This target is not a picture.');
      if (has('value') || has('afterBlockId')) fail('Image actions cannot set URLs or other values.');
      const entry = catalog.entries.find(e => e.id === target);
      if (kind === 'redraw_image' && !entry.value) fail('A redraw needs an existing picture.');
      if (kind === 'generate_image' && entry.value) fail('An existing picture must use a redraw to preserve its original details.');
      action.instruction = plain(item.instruction, 'Image instruction', MAX_INSTRUCTION, false).trim();
    } else if (kind === 'add_block') {
      if (destination.kind !== 'insertion') fail('Only new image, model-answer or explanation blocks can be added.');
      if (has('afterBlockId')) {
        action.afterBlockId = text(item.afterBlockId, 'Insertion position', 200, false);
        if (!catalog.blockIds.has(action.afterBlockId)) fail('The insertion position no longer exists.');
      }
      if (destination.type === 'image') {
        if (has('value')) fail('A new picture needs a generation instruction, never a URL.');
        action.instruction = plain(item.instruction, 'Image instruction', MAX_INSTRUCTION, false).trim();
      } else {
        if (has('instruction')) fail('New answer blocks need text, not an image instruction.');
        action.value = plain(item.value, 'New block text', MAX_TEXT, false);
        checkTokens(action.value, []);
      }
    } else fail('Unsupported action kind ' + kind + '.');
    return action;
  });
  if (raw.notes !== undefined && (!Array.isArray(raw.notes) || raw.notes.length > 10)) fail('Notes must be a short list.');
  const notes = (raw.notes || []).map(note => plain(note, 'Plan note', 2000, false));
  return { actions, notes };
}

function generatedImage(results, actionId) {
  const value = results instanceof Map ? results.get(actionId) : record(results) && OWN(results, actionId) ? results[actionId] : undefined;
  if (typeof value !== 'string' || value.length > 16000000 || /[\s<>"'\u0000-\u001f]/.test(value)) fail('The generated picture for ' + actionId + ' is missing or invalid.');
  if (!/^https:\/\/[^/]+\//i.test(value) && !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(value)) fail('The generated picture URL is not supported.');
  return value;
}
function replaceImageSource(html, imageIndex, url) {
  let n = -1, replaced = false;
  const result = html.replace(IMAGE_TAG, tag => {
    n++;
    if (n !== imageIndex) return tag;
    const attr = imageSourceAttribute(tag);
    if (!attr) fail('The inline picture has no source to replace.');
    replaced = true;
    return tag.slice(0, attr.index) + 'src="' + escapeHtml(url) + '"' + tag.slice(attr.index + attr.length);
  });
  if (!replaced) fail('The inline picture is no longer present.');
  return result;
}
function clearChangedWordPositions(q, blockId, field) {
  if (!['content', 'text', 'claim', 'evidence', 'reasoning'].includes(field)) return;
  const key = fieldKey(blockId, field);
  for (const name of ['answerKeywords', 'keywords', 'blanks']) {
    if (record(q[name]) && OWN(q[name], key)) delete q[name][key];
  }
}
function inlineFieldValue(block, destination) {
  if (destination.optionIndex !== undefined) return block.options[destination.optionIndex].text;
  if (destination.row !== undefined) return block.data[destination.row][destination.col];
  return block[destination.field];
}
function setInlineFieldValue(block, destination, value) {
  if (destination.optionIndex !== undefined) block.options[destination.optionIndex].text = value;
  else if (destination.row !== undefined) block.data[destination.row][destination.col] = value;
  else block[destination.field] = value;
}

export function applyQuestionRepairPlan(q, rawPlan, imageResults = {}, makeId) {
  const plan = normalizeQuestionRepairPlan(rawPlan, q);
  const { entries, destinations, blockIds } = catalogFor(q);
  const question = JSON.parse(JSON.stringify(q));
  const changedFields = [];
  const changedTargets = [];
  const insertions = [];
  const inlineActions = [];
  for (const action of plan.actions) {
    const d = destinations.get(action.target);
    const b = d.index === undefined ? null : question.blocks[d.index];
    const originalValue = entries.find(e => e.id === action.target).value;
    if ((action.kind === 'replace_text' || action.kind === 'select_option') && action.value === originalValue) continue;
    changedTargets.push(action.target);
    if (d.blockId) changedFields.push({ blockId: d.blockId, field: d.field });
    if (action.kind === 'replace_text') {
      const value = d.rich ? renderRich(action.value, d.images) : action.value;
      if (d.kind === 'question') question[d.field] = value;
      else if (d.kind === 'optionText') b.options[d.optionIndex].text = value;
      else if (d.kind === 'cell') b.data[d.row][d.col] = value;
      else b[d.field] = value;
      if (d.blockId) clearChangedWordPositions(question, d.blockId, d.field);
    } else if (action.kind === 'select_option') {
      b.correctId = action.value;
    } else if (action.kind === 'redraw_image' || action.kind === 'generate_image') {
      const url = generatedImage(imageResults, action.id);
      if (d.kind === 'inline') inlineActions.push({ d, url });
      else b[d.field] = url;
    } else if (action.kind === 'add_block') {
      if (typeof makeId !== 'function') fail('Adding a block needs an identifier factory.');
      const id = makeId();
      if (!safeId(id) || blockIds.has(id)) fail('The new block identifier is invalid or already used.');
      blockIds.add(id);
      const block = d.type === 'image'
        ? { id, type: 'image', url: generatedImage(imageResults, action.id), caption: '' }
        : { id, type: d.type, content: renderRich(action.value, []) };
      insertions.push({ block, afterBlockId: action.afterBlockId });
    }
  }
  // Replacements restore original image tags first; source edits then affect the
  // intended original image even when a wording action moves its token.
  for (const { d, url } of inlineActions) {
    const b = question.blocks[d.index];
    const original = q.blocks[d.index];
    const originalHtml = inlineFieldValue(original, d);
    const originalImages = richValue(String(originalHtml || '')).images;
    const parentPrefix = 'block:' + encodeURIComponent(d.blockId) + ':';
    const parentTarget = parentPrefix + (d.optionIndex !== undefined ? 'option:' + encodeURIComponent(d.optionId)
      : d.row !== undefined ? 'cell:' + d.row + ':' + d.col : d.field);
    const textAction = plan.actions.find(a => a.target === parentTarget && a.kind === 'replace_text');
    let imageIndex = d.imageIndex;
    if (textAction) imageIndex = [...textAction.value.matchAll(IMAGE_TOKEN)].findIndex(m => Number(m[1]) === d.imageIndex + 1);
    if (!originalImages[d.imageIndex]) fail('The original inline picture is missing.');
    setInlineFieldValue(b, d, replaceImageSource(String(inlineFieldValue(b, d) || ''), imageIndex, url));
  }
  // Maintain plan order when several different block kinds use the same anchor.
  const tails = new Map();
  for (const { block, afterBlockId } of insertions) {
    if (!afterBlockId) question.blocks.push(block);
    else {
      const anchor = tails.get(afterBlockId) || afterBlockId;
      const index = question.blocks.findIndex(b => b.id === anchor);
      if (index < 0) fail('The insertion position is missing.');
      question.blocks.splice(index + 1, 0, block);
      tails.set(afterBlockId, block.id);
    }
  }
  return { question, changedTargets, changedFields };
}
