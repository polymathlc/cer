import { CHARACTER_BY_ID } from './grand-line-data.js?v=3.3.0';
import { getDefenseSkillProfile } from './grand-line-defense-profiles.js?v=3.3.0';

export const PREMIUM_VFX_CHARACTERS = Object.freeze([
  'kaido', 'whitebeard', 'akainu', 'luffy', 'aokiji', 'fujitora', 'ryokugyu',
]);
const premiumCharacters = new Set(PREMIUM_VFX_CHARACTERS);
export const VFX_ATLAS_SPECS = Object.freeze([...PREMIUM_VFX_CHARACTERS, 'generic'].map(id => Object.freeze({
  id, file: `${id}.webp`, columns: 4, rows: 3, frames: 12, framesPerRow: 4,
  premium: id !== 'generic', skillIds: Object.freeze(id === 'generic' ? [] : CHARACTER_BY_ID[id].skills.map(skill => skill.id)),
})));
const atlasById = new Map(VFX_ATLAS_SPECS.map(atlas => [atlas.id, atlas]));

// Only the current catalog is selectable; archived sheets in the delivery
// manifest are deliberately excluded from metadata and preload requests.
// A premium sheet has one dedicated animated row for each catalog skill.
// The shared sheet holds a directional strike, an area impact and a support
// pulse; the renderer may tint those neutral sprites to the catalog color.
function genericRow(skill, shape) {
  if (!skill.power || ['self', 'ally', 'all-allies', 'fallen-ally'].includes(skill.target)) return 2;
  return ['splash', 'radial'].includes(shape) ? 1 : 0;
}
export function getVfxSpec(unitOrCharacter, skillOrId, kind) {
  const characterId = typeof unitOrCharacter === 'string' ? unitOrCharacter : unitOrCharacter?.characterId;
  if (!Object.hasOwn(CHARACTER_BY_ID, characterId)) return null;
  const character = CHARACTER_BY_ID[characterId];
  const requestedId = typeof skillOrId === 'string' ? skillOrId : skillOrId?.id;
  const skill = requestedId ? character.skills.find(entry => entry.id === requestedId) : character.skills[0];
  if (!skill) return null;
  const geometry = getDefenseSkillProfile(unitOrCharacter, skill), premium = premiumCharacters.has(characterId);
  const atlasId = premium ? characterId : 'generic';
  return { atlasId, characterId, skillId: skill.id, source: `./assets/grand-line-vfx/${atlasId}.webp`,
    row: premium ? character.skills.indexOf(skill) : genericRow(skill, geometry.shape), columns: 4, rows: 3,
    frames: 4, premium, rarity: character.stars, kind: skill.kind || kind, shape: geometry.shape,
    color: skill.color || character.color, tint: premium ? null : skill.color || character.color,
    fallbackRow: genericRow(skill, geometry.shape) };
}

function defaultAssetBase() {
  try { return new URL('./assets/grand-line-vfx/', import.meta.url).href; }
  catch { return './assets/grand-line-vfx/'; }
}
function joinUrl(base, file) {
  try { return new URL(file, base).href; }
  catch { return `${String(base).replace(/\/?$/, '/')}${file}`; }
}
const positive = value => Number.isFinite(value) && value > 0;
function validMetadata(row) {
  const spec = atlasById.get(row?.id);
  if (!spec || row.file !== spec.file || row.columns !== 4 || row.rows !== 3 || row.frames !== 12 ||
      !positive(row.width) || !positive(row.height)) return false;
  return true;
}

export function createDefenseVfxManager(options = {}) {
  const ImageCtor = options.ImageCtor || globalThis.Image;
  const fetchFn = options.fetchFn === null ? null : options.fetchFn || globalThis.fetch?.bind(globalThis);
  const baseUrl = options.baseUrl || defaultAssetBase();
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 12000);
  const manifestTimeoutMs = Math.max(1, Number(options.manifestTimeoutMs) || 3000);
  const metadata = new Map(), images = new Map();
  let destroyed = false;
  let cancelManifest = () => {};

  const ready = new Promise(resolve => {
    if (!fetchFn) { resolve(metadata); return; }
    let finished = false;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const finish = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(metadata); } };
    const timer = setTimeout(() => { controller?.abort(); finish(); }, manifestTimeoutMs);
    cancelManifest = () => { controller?.abort(); finish(); };
    Promise.resolve().then(() => fetchFn(joinUrl(baseUrl, 'manifest.json'), {
      cache: 'no-cache', ...(controller ? { signal: controller.signal } : {}),
    })).then(response => {
      if (!response?.ok) throw Error('Defense effects manifest unavailable');
      return response.json();
    }).then(manifest => {
      if (destroyed || finished) return;
      const rows = Array.isArray(manifest) ? manifest : manifest?.assets;
      for (const row of Array.isArray(rows) ? rows : []) if (validMetadata(row)) metadata.set(row.id, { ...row });
    }).catch(() => { /* The fixed atlas layout also works without metadata. */ }).finally(finish);
  });

  function loadAtlas(atlasId) {
    if (!atlasById.has(atlasId)) return null;
    if (images.has(atlasId)) return images.get(atlasId);
    const atlas = atlasById.get(atlasId);
    const item = { atlasId, image: null, loaded: false, failed: false, columns: 4, rows: 3,
      frames: 12, frameWidth: 0, frameHeight: 0, promise: null, cancel: null };
    images.set(atlasId, item);
    if (destroyed || typeof ImageCtor !== 'function') {
      item.failed = true; item.promise = Promise.resolve(item); return item;
    }
    item.promise = ready.then(() => new Promise(resolve => {
      if (destroyed) { item.failed = true; resolve(item); return; }
      const image = item.image = new ImageCtor();
      let settled = false;
      const finish = failed => {
        if (settled) return;
        settled = true; clearTimeout(timer); image.onload = null; image.onerror = null;
        item.failed = failed; item.loaded = !failed; item.cancel = null;
        if (!failed) {
          item.frameWidth = (image.naturalWidth || image.width) / 4;
          item.frameHeight = (image.naturalHeight || image.height) / 3;
        }
        resolve(item);
      };
      const timer = setTimeout(() => finish(true), timeoutMs);
      item.cancel = () => finish(true);
      image.decoding = 'async';
      image.onload = () => {
        const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
        if (!positive(width) || !positive(height) || width < 4 || height < 3) { finish(true); return; }
        const expected = metadata.get(atlasId);
        if (expected && (width !== expected.width || height !== expected.height)) { finish(true); return; }
        if (typeof image.decode === 'function') Promise.resolve().then(() => image.decode()).then(() => finish(false), () => finish(true));
        else finish(false);
      };
      image.onerror = () => finish(true);
      const sha = metadata.get(atlasId)?.sha256;
      try { image.src = joinUrl(baseUrl, atlas.file) + (/^[a-f0-9]{64}$/i.test(sha || '') ? `?v=${sha.slice(0, 16)}` : ''); }
      catch { finish(true); }
    })).catch(() => { item.failed = true; return item; });
    return item;
  }
  function load(characterId, skillId, kind) {
    const spec = getVfxSpec(characterId, skillId, kind);
    if (!spec) return null;
    if (spec.premium) loadAtlas('generic');
    return loadAtlas(spec.atlasId);
  }
  function sprite(characterId, skillId, kind, phase = 0) {
    const spec = getVfxSpec(characterId, skillId, kind);
    if (!spec || destroyed) return null;
    const requested = load(characterId, skillId, kind);
    let item = requested, row = spec.row, premium = spec.premium;
    if (!item?.loaded && spec.premium) {
      item = loadAtlas('generic'); row = spec.fallbackRow; premium = false;
    }
    if (!item?.loaded) return null;
    const frame = Math.min(3, Math.floor(Math.max(0, Math.min(1, Number(phase) || 0)) * 4));
    return { image: item.image, sx: frame * item.frameWidth, sy: row * item.frameHeight,
      sw: item.frameWidth, sh: item.frameHeight, row, frame, columns: 4, rows: 3,
      premium, tint: premium ? null : spec.color, spec, atlasId: item.atlasId };
  }
  function preload(characterIds) {
    const ids = characterIds === undefined ? VFX_ATLAS_SPECS.map(atlas => atlas.id) :
      [...new Set(['generic', ...characterIds.filter(id => premiumCharacters.has(id))])];
    return Promise.all(ids.map(id => loadAtlas(id)?.promise).filter(Boolean));
  }
  return { ready, load, sprite, preload, metadata, images, baseUrl,
    destroy() { destroyed = true; cancelManifest(); for (const item of images.values()) item.cancel?.(); images.clear(); metadata.clear(); },
  };
}
