// Crop provenance and geometry only. Rectangles select existing source pixels;
// this module never redraws a figure, fetches an image or writes a question.
import { questionRepairTargets } from './question-repair-core.mjs';

const MAX_SOURCES = 8;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
function fail(message) { throw new Error('Crop repair: ' + message); }

function validImageUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 16000000 || /[\s<>"'\u0000-\u001f]/.test(value)) return false;
  if (/^data:image\/(?:png|jpe?g|webp|gif|bmp|avif);base64,[a-z0-9+/]+=*$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch (_) { return false; }
}

function resolveTarget(q, target) {
  const id = typeof target === 'string' ? target : target?.id;
  const entry = questionRepairTargets(q).find(item => item.id === id && item.kind === 'image');
  if (!entry) fail('That picture is no longer available.');
  const index = q.blocks.findIndex(block => id.startsWith('block:' + encodeURIComponent(block.id) + ':'));
  if (index < 0) fail('The picture has no question item.');
  return { entry, index, direct: id === 'block:' + encodeURIComponent(q.blocks[index].id) + ':url' };
}

// Store non-primary pictures on their parent block so a draft save retains
// them. Question-level imageSources remains a read fallback for earlier data.
function sourceRecords(q, resolved) {
  const { entry, index, direct } = resolved;
  const block = q.blocks[index];
  const records = [];
  if (direct && record(block.cropSource)) records.push(block.cropSource);
  if (record(block.cropSources) && own(block.cropSources, entry.id)) records.push(block.cropSources[entry.id]);
  if (record(q.imageSources) && own(q.imageSources, entry.id)) records.push(q.imageSources[entry.id]);
  return records.filter(record);
}

export function normalizeCropBox(raw) {
  if (!Array.isArray(raw) || raw.length !== 4 || ![...raw].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000)) {
    fail('The crop rectangle must contain four numbers between 0 and 1000.');
  }
  const [top, left, bottom, right] = raw;
  if (bottom <= top || right <= left) fail('The crop rectangle must have a positive width and height.');
  return raw.slice();
}

function optionalBox(raw) {
  if (raw === undefined) return undefined;
  try { return normalizeCropBox(raw); } catch (_) { return undefined; }
}

export function cropPixelRect(box, width, height) {
  const [top, left, bottom, right] = normalizeCropBox(box);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2) fail('The source picture dimensions are invalid.');
  const x = Math.max(0, Math.min(width, Math.floor(left * width / 1000)));
  const y = Math.max(0, Math.min(height, Math.floor(top * height / 1000)));
  const farX = Math.max(0, Math.min(width, Math.ceil(right * width / 1000)));
  const farY = Math.max(0, Math.min(height, Math.ceil(bottom * height / 1000)));
  const w = farX - x, h = farY - y;
  if (w < 2 || h < 2) fail('The selected crop is too small.');
  return { x, y, w, h };
}

export function cropSourcesFor(q, target, sessionOriginal) {
  const resolved = resolveTarget(q, target);
  const { entry } = resolved;
  const sources = [], seen = new Set();
  const add = (source, label) => {
    if (sources.length >= MAX_SOURCES || !record(source) || !validImageUrl(source.url) || seen.has(source.url)) return;
    seen.add(source.url);
    const original = source.original !== false;
    const result = { id: 'source-' + (sources.length + 1), label: original ? label : 'Previous image', url: source.url, original };
    const box = optionalBox(source.box_2d ?? source.box);
    if (box) result.box = box;
    sources.push(result);
  };
  for (const source of sourceRecords(q, resolved)) {
    if (source.imageUrl === entry.value) add(source, 'Original scan');
  }
  // Session state is only useful while it describes this exact picture. An
  // old editor session must never silently become another question's source.
  if (record(sessionOriginal) && sessionOriginal.imageUrl === entry.value) add(sessionOriginal, 'Original scan from this session');
  for (const page of Array.isArray(q.sourcePages) ? q.sourcePages : []) {
    if (!record(page)) continue;
    const pageNumber = Number(page.page);
    const label = Number.isInteger(pageNumber) && pageNumber > 0 ? 'Source page ' + pageNumber : 'Source page';
    add({ url: page.url, original: true }, label);
  }
  if (validImageUrl(entry.value)) sources.push({ id: 'current', label: 'Current picture — trim only', url: entry.value, original: false });
  return sources;
}

export function cropSourceUpdate(q, target, source, newUrl, box) {
  let resolved = resolveTarget(q, target);
  const previousTarget = resolved;
  if (!record(source) || !validImageUrl(source.url)) fail('The selected source picture is invalid.');
  if (!validImageUrl(newUrl)) fail('The cropped picture URL is invalid.');
  if (/:inline:\d+$/.test(resolved.entry.id) && resolved.entry.value !== newUrl) {
    // A simultaneous wording repair can move an image token. Catalog IDs name
    // the image's position, so record its source at the resulting position.
    const prefix = resolved.entry.id.replace(/:inline:\d+$/, ':inline:');
    const moved = questionRepairTargets(q).filter(item => item.kind === 'image' && item.id.startsWith(prefix) && item.value === newUrl);
    if (moved.length > 1) fail('The cropped inline picture cannot be identified uniquely.');
    if (moved.length === 1) resolved = resolveTarget(q, moved[0].id);
  }
  const rectangle = normalizeCropBox(box);
  const original = source.original !== false;
  let provenance = { url: source.url, imageUrl: newUrl, original, box_2d: rectangle };
  if (!original) {
    // Trimming an already cropped picture must retain any known full source.
    // The new rectangle is on the current picture, so it cannot honestly be
    // recorded as coordinates on that earlier original scan.
    const prior = [...sourceRecords(q, previousTarget), ...sourceRecords(q, resolved)].find(item => item.original !== false && validImageUrl(item.url)
      && item.imageUrl === source.url);
    if (prior) provenance = { url: prior.url, imageUrl: newUrl, original: true };
  }
  const result = copy(q);
  const block = result.blocks[resolved.index];
  if (resolved.direct) block.cropSource = provenance;
  else {
    if (!record(block.cropSources)) block.cropSources = {};
    block.cropSources[resolved.entry.id] = provenance;
  }
  return result;
}
