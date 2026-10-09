// Whiteboards own complete question-side snapshots, never a question bank's
// model answers. These pure helpers can run in the portal and its public viewer.
export const WB_LIMITS = Object.freeze({ cards: 120, blocks: 160, title: 100, questionTitle: 1000, text: 80000,
  appHtml: 250000, boardBytes: 750000, sheetBytes: 750000, rows: 60, cols: 30,
  coordinate: 10000000, minWidth: 260, maxWidth: 1100, minZoom: 0.15, maxZoom: 2.5 });
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const idPattern = /^[A-Za-z0-9_.:-]{1,200}$/;
const makeId = prefix => prefix + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
const byteLength = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
const fail = message => { throw new Error(message); };
function bounded(value, limit, label, fallback = '') {
  const result = String(value == null ? fallback : value).replace(/\r\n?/g, '\n').trim();
  if (result.length > limit) fail(label + ' is too long. Shorten it before saving or sharing.');
  return result;
}
function identifier(value, label) {
  const result = String(value || '');
  if (!idPattern.test(result) || result === '.' || result === '..') fail(label + ' is invalid.');
  return result;
}
function finite(value, fallback, min, max) {
  const number = Number(value);
  return value === '' || value == null || !Number.isFinite(number) ? fallback : Math.max(min, Math.min(max, number));
}
export const escapeWhiteboardHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
function decode(value) {
  return String(value || '').replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (_, hex, decimal) => {
    const code = parseInt(hex || decimal, hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }).replace(/&(amp|quot|apos|lt|gt|nbsp|colon|tab|newline);/gi, (_, entity) =>
    ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', colon: ':', tab: '\t', newline: '\n' }[entity.toLowerCase()]));
}
function imageUrl(value) {
  const url = decode(String(value || '').trim());
  if (!url || /[\u0000-\u0020\\]/.test(url)) fail('A question image has an invalid URL. Fix it before adding or sharing this question.');
  if (!/^(?:https?:\/\/|\/(?![\\])|\.\.?\/)/i.test(url)
    && !/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/]+=*$/i.test(url)) {
    fail('A question image uses an unsupported URL. Keep every diagram on a stable image URL.');
  }
  return url;
}
const allowedTags = new Set('p br div span b strong i em u s sub sup ul ol li table thead tbody tfoot tr th td caption img figure figcaption hr code pre blockquote h1 h2 h3 h4 h5 h6 small a'.split(' '));
const rawTags = new Set('script style iframe object embed template noscript textarea xmp title'.split(' '));
const voidTags = new Set(['br', 'img', 'hr']);
const styleKeys = new Set('color background-color font-size font-family font-weight font-style text-decoration text-align vertical-align white-space line-height border border-color border-width border-style padding margin width height max-width max-height'.split(' '));
function safeStyle(value) {
  return decode(value).split(';').flatMap(rule => {
    const colon = rule.indexOf(':'), key = rule.slice(0, colon).trim().toLowerCase(), css = rule.slice(colon + 1).trim();
    if (colon < 0 || !styleKeys.has(key) || !css || /url\s*\(|expression|[\\<>@\u0000-\u001f]/i.test(css)
      || !/^[a-z0-9\s#.,%()+"'\/-]+$/i.test(css)) return [];
    return [key + ':' + css];
  }).join(';');
}
function attributes(source) {
  const result = {};
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const key = match[1].toLowerCase();
    if (!own(result, key)) result[key] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return result;
}
// A small allowlist tokenizer avoids a DOM dependency and reconstructs every
// accepted tag/attribute. Inline event handlers, active HTML and CSS URLs never
// reach the host page; code apps use the separate opaque-origin sandbox.
export function sanitizeWhiteboardQuestionHtml(value, { imageUrl: transform = value => value } = {}) {
  const source = bounded(value, WB_LIMITS.text, 'Question text');
  let output = '', cursor = 0, raw = '';
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) { if (!raw) output += source.slice(cursor); break; }
    if (!raw) output += source.slice(cursor, start);
    if (source.startsWith('<!--', start)) { const end = source.indexOf('-->', start + 4); cursor = end < 0 ? source.length : end + 3; continue; }
    let end = start + 1, quote = '';
    for (; end < source.length; end++) {
      const character = source[end];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end === source.length) { if (!raw) output += escapeWhiteboardHtml(source.slice(start)); break; }
    const tag = /^<\s*(\/?)\s*([a-z][a-z0-9]*)\b([\s\S]*?)\/?\s*>$/i.exec(source.slice(start, end + 1));
    cursor = end + 1;
    if (!tag) { if (!raw) output += escapeWhiteboardHtml(source.slice(start, end + 1)); continue; }
    const closing = !!tag[1], name = tag[2].toLowerCase();
    if (raw) { if (closing && name === raw) raw = ''; continue; }
    if (rawTags.has(name)) { if (!closing && !/\/\s*>$/.test(tag[0])) raw = name; continue; }
    if (['svg', 'canvas', 'math', 'input', 'select'].includes(name)) fail('An embedded question diagram or control cannot be copied completely. Convert it to a question image first.');
    if (!allowedTags.has(name)) continue;
    if (closing) { if (!voidTags.has(name)) output += '</' + name + '>'; continue; }
    const attr = attributes(tag[3]), safe = [];
    if (attr.style) { const css = safeStyle(attr.style); if (css) safe.push('style="' + escapeWhiteboardHtml(css) + '"'); }
    if (name === 'img') {
      if (!attr.src) fail('A question image has no source. Fix it before sharing.');
      safe.push('src="' + escapeWhiteboardHtml(imageUrl(transform(imageUrl(attr.src)))) + '"');
      safe.push('alt="' + escapeWhiteboardHtml(decode(attr.alt || 'Question diagram')) + '"');
      for (const key of ['width', 'height']) if (/^\d{1,4}$/.test(attr[key] || '')) safe.push(key + '="' + attr[key] + '"');
      safe.push('loading="lazy"');
    }
    if (name === 'td' || name === 'th') for (const key of ['rowspan', 'colspan']) {
      if (/^\d{1,2}$/.test(attr[key] || '') && +attr[key] > 0) safe.push(key + '="' + attr[key] + '"');
    }
    if (name === 'a' && attr.href) {
      const href = decode(attr.href).trim();
      if (/^https?:\/\/[^\s\\]+$/i.test(href)) safe.push('href="' + escapeWhiteboardHtml(href) + '"', 'target="_blank"', 'rel="noopener noreferrer"');
    }
    output += '<' + name + (safe.length ? ' ' + safe.join(' ') : '') + '>';
  }
  return output;
}
function metadata(value, label) { return bounded(value, 300, label); }
function migratedTable(raw) {
  if (!raw.headers) return raw;
  if (typeof raw.headers !== 'object' || !raw.data || typeof raw.data !== 'object') fail('A question table has unreadable legacy headers.');
  if (Object.keys(raw.headers).some(key => !/^\d+$/.test(key)) || Object.keys(raw.data).some(key => !/^\d+$/.test(key))) fail('A question table has invalid legacy indexes.');
  const cols = Number(raw.cols) || Math.max(0, ...Object.keys(raw.headers).map(key => +key + 1),
    ...Object.values(raw.data).flatMap(row => Object.keys(row || {}).map(key => +key + 1)));
  const rows = Number(raw.rows) || Math.max(0, ...Object.keys(raw.data).map(key => +key + 1));
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 0 || cols > WB_LIMITS.cols || rows >= WB_LIMITS.rows
    || Object.keys(raw.headers).some(key => +key >= cols)) fail('A legacy question table is too large or has invalid headers.');
  const cellStyles = Object.fromEntries(Object.entries(raw.cellStyles || {}).map(([key, value]) => {
    const match = /^(-?\d+)_(\d+)$/.exec(key);
    return [match ? (+match[1] + 1) + '_' + match[2] : key, value];
  }));
  return { ...raw, headers: undefined, cols, rows: rows + 1,
    data: [Array.from({ length: cols }, (_, col) => raw.headers[col] ?? ''),
      ...Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => raw.data[row]?.[col] ?? ''))],
    cellStyles, merges: (raw.merges || []).map(merge => ({ ...merge, sr: merge.sr + 1, er: merge.er + 1 })) };
}
function matrixOf(block) {
  if (!block.data || typeof block.data !== 'object') fail('A question table has no readable cells.');
  const rowKeys = Object.keys(block.data);
  if (rowKeys.some(key => !/^\d+$/.test(key))) fail('A question table has invalid row indexes.');
  const rows = Number(block.rows) || Math.max(0, ...rowKeys.map(key => +key + 1));
  const allCols = rowKeys.flatMap(key => {
    const row = block.data[key];
    if (!row || typeof row !== 'object') fail('A question table has an unreadable row.');
    const keys = Object.keys(row);
    if (keys.some(key => !/^\d+$/.test(key))) fail('A question table has invalid column indexes.');
    return keys.map(key => +key + 1);
  });
  const cols = Number(block.cols) || Math.max(0, ...allCols);
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > WB_LIMITS.rows || cols > WB_LIMITS.cols
    || rowKeys.some(key => +key >= rows) || allCols.some(col => col > cols)) fail('A question table is too large or has cells outside its declared size.');
  return { rows, cols, data: Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) =>
    sanitizeWhiteboardQuestionHtml(block.data[row]?.[col] ?? ''))) };
}
const blankText = value => String(value || '').replace(/\[\[[\s\S]+?\]\](?:\s*\[\[[\s\S]+?\]\])*/g, '[[blank]]');
function snapshotBlock(raw, index) {
  if (!raw || typeof raw !== 'object' || !raw.type) fail('A question contains an unreadable block.');
  const block = { id: identifier(raw.id || 'block_' + index, 'Question block ID'), type: String(raw.type) };
  if (raw.part) block.part = metadata(raw.part, 'Question part');
  if (raw.marks != null) block.marks = finite(raw.marks, 0, 0, 1000);
  switch (block.type) {
    case 'text': block.content = sanitizeWhiteboardQuestionHtml(raw.content); break;
    case 'part': block.label = metadata(raw.label, 'Question part label'); block.content = sanitizeWhiteboardQuestionHtml(raw.content); break;
    case 'image':
      if (!raw.url) fail('A question diagram has no image URL.');
      block.url = imageUrl(raw.url); block.caption = bounded(raw.caption || raw.alt || raw.dgnLabel, 1000, 'Image caption');
      if (raw.scale != null) block.scale = finite(raw.scale, 100, 1, 100);
      break;
    case 'table': {
      raw = migratedTable(raw);
      Object.assign(block, matrixOf(raw));
      block.caption = sanitizeWhiteboardQuestionHtml(raw.caption);
      block.merges = (Array.isArray(raw.merges) ? raw.merges : []).map(merge => {
        if (!merge || !['sr', 'sc', 'er', 'ec'].every(key => Number.isInteger(merge[key]))
          || merge.sr < 0 || merge.sc < 0 || merge.er < merge.sr || merge.ec < merge.sc
          || merge.er >= block.rows || merge.ec >= block.cols) fail('A question table contains an invalid merged cell.');
        return { sr: merge.sr, sc: merge.sc, er: merge.er, ec: merge.ec };
      });
      block.cellStyles = {};
      for (const [key, style] of Object.entries(raw.cellStyles || {})) {
        if (!/^\d+_\d+$/.test(key) || !style) continue;
        if (typeof style === 'string') { const css = safeStyle(style); if (css) block.cellStyles[key] = css; continue; }
        if (typeof style !== 'object') continue;
        const map = { textAlign: 'text-align', verticalAlign: 'vertical-align', backgroundColor: 'background-color', color: 'color', fontSize: 'font-size', fontWeight: 'font-weight', fontFamily: 'font-family' };
        const css = safeStyle(Object.entries(map).filter(([field]) => style[field]).map(([field, property]) => property + ':' + style[field]).join(';'));
        if (css) block.cellStyles[key] = css;
      }
      block.colWidths = Array.from({ length: block.cols }, (_, col) => raw.colWidths?.[col] ? finite(raw.colWidths[col], 0, 0, 3000) : 0);
      break;
    }
    case 'mcq':
      if (!Array.isArray(raw.options) || !raw.options.length || raw.options.length > 30) fail('A multiple-choice question has unreadable or too many options.');
      block.options = raw.options.map((option, optionIndex) => {
        if (!option || typeof option !== 'object') fail('A multiple-choice option could not be read.');
        return { id: identifier(option.id || 'option_' + optionIndex, 'Option ID'), text: sanitizeWhiteboardQuestionHtml(option.text) };
      });
      break;
    case 'fillblank': block.text = bounded(blankText(raw.text), WB_LIMITS.text, 'Fill-in-the-blank question'); break;
    case 'answer': break; // Keep the three blank response sections, without the solution.
    case 'plainanswer': break;
    case 'answerLine': block.label = metadata(raw.label, 'Answer line label'); break;
    case 'openLines': case 'workingSpace': case 'objectivesBox':
      block.lines = Math.round(finite(raw.lines, block.type === 'workingSpace' ? 6 : 4, 1, 12));
      if (block.type === 'objectivesBox') block.label = metadata(raw.label || 'Learning objectives', 'Learning objectives label');
      break;
    case 'studentAnswer':
      // This is a student's answer supplied by the QUESTION, e.g. "Explain
      // why the student's answer is wrong", rather than the model answer.
      block.label = metadata(raw.label || "Student's answer", 'Student answer label');
      block.answer = sanitizeWhiteboardQuestionHtml(raw.answer);
      break;
    case 'commonMistake':
      block.title = bounded(raw.title || 'Common mistake', WB_LIMITS.title, 'Question note title');
      block.text = sanitizeWhiteboardQuestionHtml(raw.text);
      break;
    case 'video': block.url = metadata(raw.url, 'Question video URL'); if (block.url && !/^https?:\/\/[^\s\\]+$/i.test(block.url)) fail('A question video has an unsupported URL.'); break;
    case 'widget': Object.assign(block, normalizeWhiteboardApp({ html: raw.html, title: raw.title, height: raw.height })); break;
    case 'pageBreak': break;
    case 'explanation': case 'answerKey': return null;
    default: fail('The question block “' + block.type + '” cannot be copied completely. Convert it in the question editor first.');
  }
  return block;
}
export function whiteboardQuestionSnapshot(raw) {
  if (!raw || typeof raw !== 'object') fail('The question could not be read.');
  const question = { id: identifier(raw.id, 'Question ID'), title: bounded(raw.title || 'Question', WB_LIMITS.questionTitle, 'Question title'),
    topic: metadata(raw.topic, 'Question topic'), topic2: metadata(raw.topic2, 'Question topic'), category: metadata(raw.category, 'Question category'),
    level: Array.isArray(raw.level) ? raw.level.map(level => metadata(level, 'Question level')) : metadata(raw.level, 'Question level'),
    mcqLabels: raw.mcqLabels === 'letters' ? 'letters' : 'numbers', blocks: [] };
  if (!Array.isArray(raw.blocks) || !raw.blocks.length || raw.blocks.length > WB_LIMITS.blocks) fail('The question has no readable content or too many blocks.');
  question.blocks = raw.blocks.map(snapshotBlock).filter(Boolean);
  if (!question.blocks.some(block => ['text', 'part', 'image', 'table', 'mcq', 'fillblank', 'studentAnswer'].includes(block.type))) {
    fail('The question has no student-facing content. Add its question text or diagram first.');
  }
  return question;
}
export function normalizeWhiteboardApp(raw) {
  if (raw == null || raw === '') return null;
  let value = raw;
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/^```(?:html|json)?\s*/i, '').replace(/\s*```$/, '');
    if (cleaned.startsWith('{')) { try { value = JSON.parse(cleaned); } catch (_) { fail('The generated app could not be read. The current app is unchanged.'); } }
    else value = { html: cleaned };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('The app could not be read.');
  const html = bounded(value.html, WB_LIMITS.appHtml, 'App code');
  if (!html) fail('Paste or generate an app with HTML code first.');
  return { title: bounded(value.title || 'Explore this question', WB_LIMITS.title, 'App title'), html,
    height: Math.round(finite(value.height, 560, 240, 900)) };
}
export function newWhiteboard({ title = 'New whiteboard', createdBy = '' } = {}, id = makeId('wb_')) {
  const now = new Date().toISOString();
  return { id: identifier(id, 'Whiteboard ID'), kind: 'infinite-whiteboard', version: 1,
    title: bounded(title || 'New whiteboard', WB_LIMITS.title, 'Whiteboard name'), createdBy: createdBy ? identifier(createdBy, 'Owner ID') : '',
    createdAt: now, updatedAt: now, view: { x: 0, y: 0, zoom: 1 }, cards: [] };
}
export function createWhiteboardCard(question, position = {}, id = makeId('wc_')) {
  const snapshot = whiteboardQuestionSnapshot(question);
  return { id: identifier(id, 'Card ID'), questionId: snapshot.id,
    x: finite(position.x, 40, -WB_LIMITS.coordinate, WB_LIMITS.coordinate),
    y: finite(position.y, 40, -WB_LIMITS.coordinate, WB_LIMITS.coordinate),
    width: finite(position.width, 440, WB_LIMITS.minWidth, WB_LIMITS.maxWidth), question: snapshot, app: null };
}
function normalizeView(raw = {}) {
  return { x: finite(raw?.x, 0, -WB_LIMITS.coordinate, WB_LIMITS.coordinate), y: finite(raw?.y, 0, -WB_LIMITS.coordinate, WB_LIMITS.coordinate),
    zoom: finite(raw?.zoom, 1, WB_LIMITS.minZoom, WB_LIMITS.maxZoom) };
}
export function normalizeWhiteboard(raw, id) {
  if (!raw || typeof raw !== 'object' || raw.kind !== 'infinite-whiteboard') return null;
  const result = { id: identifier(raw.id || id, 'Whiteboard ID'), kind: 'infinite-whiteboard', version: 1,
    title: bounded(raw.title || 'New whiteboard', WB_LIMITS.title, 'Whiteboard name'),
    createdBy: raw.createdBy ? identifier(raw.createdBy, 'Owner ID') : '', createdAt: bounded(raw.createdAt, 80, 'Creation date'),
    updatedAt: bounded(raw.updatedAt, 80, 'Update date'), view: normalizeView(raw.view), cards: [] };
  if (!Array.isArray(raw.cards) || raw.cards.length > WB_LIMITS.cards) fail('A whiteboard can keep up to ' + WB_LIMITS.cards + ' complete question cards.');
  const seen = new Set();
  result.cards = raw.cards.map(card => {
    if (!card || typeof card !== 'object') fail('A whiteboard card could not be read.');
    const normalized = createWhiteboardCard(card.question, card, card.id);
    if (seen.has(normalized.id)) fail('This whiteboard has duplicate card IDs.');
    seen.add(normalized.id);
    if (identifier(card.questionId, 'Question ID') !== normalized.questionId) fail('A card is pointing to a different question from its saved content.');
    normalized.app = normalizeWhiteboardApp(card.app);
    return normalized;
  });
  if (byteLength(result) > WB_LIMITS.boardBytes) fail('This whiteboard is too large to save or share completely. Remove some cards or shorten an app.');
  return result;
}
export function whiteboardPublicSnapshot(board) {
  const result = normalizeWhiteboard(board);
  if (!result || !result.cards.length) fail('Add at least one question before sharing the whiteboard.');
  const { createdBy, createdAt, updatedAt, ...publicBoard } = result;
  return publicBoard;
}
export function whiteboardQuestionIds(board, cardId = '') {
  const result = normalizeWhiteboard(board);
  if (!result) fail('The whiteboard could not be read.');
  if (cardId && !result.cards.some(card => card.id === cardId)) fail('That question card is no longer on the whiteboard.');
  return [...new Set(result.cards.filter(card => !cardId || card.id === cardId).map(card => card.questionId))];
}
export function worldToScreen(point, view) {
  const v = normalizeView(view);
  return { x: Number(point.x) * v.zoom + v.x, y: Number(point.y) * v.zoom + v.y };
}
export function screenToWorld(point, view) {
  const v = normalizeView(view);
  return { x: (Number(point.x) - v.x) / v.zoom, y: (Number(point.y) - v.y) / v.zoom };
}
export function whiteboardBounds(cards = []) {
  if (!cards.length) return { x: 0, y: 0, width: 440, height: 400 };
  const bounds = cards.map(card => ({ x: finite(card.x, 0, -WB_LIMITS.coordinate, WB_LIMITS.coordinate),
    y: finite(card.y, 0, -WB_LIMITS.coordinate, WB_LIMITS.coordinate), width: finite(card.width, 440, WB_LIMITS.minWidth, WB_LIMITS.maxWidth),
    height: finite(card.height, 520, 100, 20000) }));
  const x = Math.min(...bounds.map(card => card.x)), y = Math.min(...bounds.map(card => card.y));
  return { x, y, width: Math.max(...bounds.map(card => card.x + card.width)) - x,
    height: Math.max(...bounds.map(card => card.y + card.height)) - y };
}
function tableHtml(block, options) {
  let html = '<table class="wb-question-table"><colgroup>' + block.colWidths.map(width => '<col' + (width ? ' style="width:' + width + 'px"' : '') + '>').join('') + '</colgroup><tbody>';
  for (let row = 0; row < block.rows; row++) {
    html += '<tr>';
    for (let col = 0; col < block.cols; col++) {
      const merge = block.merges.find(merge => row >= merge.sr && row <= merge.er && col >= merge.sc && col <= merge.ec);
      if (merge && (row !== merge.sr || col !== merge.sc)) continue;
      const span = merge ? ' rowspan="' + (merge.er - merge.sr + 1) + '" colspan="' + (merge.ec - merge.sc + 1) + '"' : '';
      const style = block.cellStyles[row + '_' + col];
      html += '<td' + span + (style ? ' style="' + escapeWhiteboardHtml(style) + '"' : '') + '>' + sanitizeWhiteboardQuestionHtml(block.data[row][col], options) + '</td>';
    }
    html += '</tr>';
  }
  return html + '</tbody></table>' + (block.caption ? '<p>' + sanitizeWhiteboardQuestionHtml(block.caption, options) + '</p>' : '');
}
export function whiteboardQuestionHtml(raw, options = {}) {
  const question = whiteboardQuestionSnapshot(raw), escape = escapeWhiteboardHtml;
  return question.blocks.map(block => {
    const partLabel = /^[a-z](?:\.(?:i|ii|iii|iv|v|vi|vii|viii))?$/.test(block.part || '')
      ? block.part.split('.').map(label => '(' + label + ')').join('') : block.part;
    const part = partLabel ? '<strong class="wb-question-part">' + escape(partLabel) + '</strong> ' : '';
    const marks = block.marks > 0 ? ' <small class="wb-question-marks">[' + block.marks + (block.marks === 1 ? ' mark' : ' marks') + ']</small>' : '';
    switch (block.type) {
      case 'text': return '<div class="wb-question-text">' + part + sanitizeWhiteboardQuestionHtml(block.content, options) + marks + '</div>';
      case 'part': return '<div class="wb-question-text">' + part + '<strong>' + escape(block.label) + '</strong> ' + sanitizeWhiteboardQuestionHtml(block.content, options) + marks + '</div>';
      case 'image': return '<figure><img src="' + escape(imageUrl((options.imageUrl || (value => value))(block.url))) + '" alt="' + escape(block.caption || 'Question diagram') + '"' + (block.scale ? ' style="max-width:' + block.scale + '%"' : '') + '>' + (block.caption ? '<figcaption>' + escape(block.caption) + '</figcaption>' : '') + '</figure>';
      case 'table': return tableHtml(block, options);
      case 'mcq': return '<ol class="wb-question-options"' + (question.mcqLabels === 'letters' ? ' type="A"' : '') + '>' + block.options.map(option => '<li>' + sanitizeWhiteboardQuestionHtml(option.text, options) + '</li>').join('') + '</ol><div class="wb-answer-line">Answer: ______</div>';
      case 'fillblank': return '<div class="wb-fillblank">' + escape(block.text).replace(/\[\[blank\]\]/g, '<span class="wb-blank">______________________</span>') + '</div>';
      case 'answer': return ['Claim', 'Evidence', 'Reasoning'].map(label => '<div class="wb-answer-label">' + label + '</div><div class="wb-answer-space"></div>').join('');
      case 'plainanswer': return '<div class="wb-answer-space"></div>';
      case 'answerLine': return '<div class="wb-answer-line">' + escape(block.label || 'Answer:') + ' ______________________</div>';
      case 'openLines': case 'workingSpace': case 'objectivesBox': return (block.label ? '<div class="wb-answer-label">' + escape(block.label) + '</div>' : '') + '<div class="wb-answer-space" style="min-height:' + block.lines * 22 + 'px"></div>';
      case 'studentAnswer': return '<blockquote><strong>' + escape(block.label) + '</strong><div>' + sanitizeWhiteboardQuestionHtml(block.answer, options) + '</div></blockquote>';
      case 'commonMistake': return '<blockquote><strong>' + escape(block.title) + '</strong><div>' + sanitizeWhiteboardQuestionHtml(block.text, options) + '</div></blockquote>';
      case 'video': return block.url ? '<p>Video: <a target="_blank" rel="noopener noreferrer" href="' + escape(block.url) + '">' + escape(block.url) + '</a></p>' : '';
      case 'widget': {
        if (options.print) return '<p class="wb-print-app-note">Interactive app: ' + escape(block.title) + ' — open the whiteboard link to use it.</p>';
        const frame = options.appFrame || globalThis.QuestionApps?.frame;
        if (typeof frame !== 'function') fail('The interactive app renderer is unavailable. Reload the whiteboard so every app can be shown.');
        return frame(block);
      }
      case 'pageBreak': return '<div class="wb-page-break"></div>';
      default: return '';
    }
  }).join('');
}
export function whiteboardWorksheetHtml(board, options = {}) {
  const normalized = normalizeWhiteboard(board);
  if (!normalized || !normalized.cards.length) fail('Add at least one question before exporting a worksheet.');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
    + escapeWhiteboardHtml(normalized.title) + '</title><style>body{font:12pt Arial,sans-serif;color:#182525;margin:0;background:white}h1{font-size:20pt;margin:0 0 6mm}.wb-print-question{margin-bottom:8mm}.wb-print-question h2{font-size:13pt;margin:4mm 0}.wb-question-text{margin:3mm 0;line-height:1.55}figure{margin:4mm 0}img{max-width:100%;max-height:90mm;object-fit:contain}figcaption{font-size:9pt;color:#555}.wb-question-table{border-collapse:collapse;width:100%;margin:3mm 0}.wb-question-table td{border:1px solid #bbb;padding:2mm}.wb-question-options li{padding:2mm 0}.wb-answer-space{min-height:18mm;border:1px solid #ccc;margin:2mm 0 5mm}.wb-answer-label{font-weight:600;margin-top:3mm}.wb-answer-line{margin:3mm 0 6mm}.wb-fillblank{line-height:2.4}.wb-blank{white-space:nowrap}.wb-page-break{break-before:page}.wb-print-question h2{break-after:avoid}figure,table,.wb-answer-space,blockquote{break-inside:avoid}@page{size:A4;margin:12mm}@media screen{body{max-width:186mm;margin:10mm auto;padding:12mm}body:before{content:"Use Print → Save as PDF to download this worksheet";display:block;margin-bottom:8mm;font-size:10pt;color:#555}}@media print{body{margin:0;padding:0}}</style></head><body><h1>'
    + escapeWhiteboardHtml(normalized.title) + '</h1><p>Name: ______________________ &nbsp; Date: ______________</p>'
    + normalized.cards.map((card, index) => '<article class="wb-print-question"><h2>' + (index + 1) + '. ' + escapeWhiteboardHtml(card.question.title) + '</h2>' + whiteboardQuestionHtml(card.question, { ...options, print: true }) + '</article>').join('') + '</body></html>';
}
export const whiteboardPrintHtml = whiteboardWorksheetHtml;
