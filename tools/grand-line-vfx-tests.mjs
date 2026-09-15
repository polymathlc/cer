import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { CHARACTERS } from '../grand-line-data.js';
import { PREMIUM_VFX_CHARACTERS, VFX_ATLAS_SPECS, getVfxSpec, createDefenseVfxManager } from '../grand-line-vfx.js';

const assetRoot = new URL('../assets/grand-line-vfx/', import.meta.url);
const baseUrl = 'https://effects.test/assets/grand-line-vfx/';
function images(outcome = () => 'load', width = 1536, height = 1024) {
  const requests = [], pending = [];
  class ImageCtor {
    constructor() { this.naturalWidth = this.width = width; this.naturalHeight = this.height = height; }
    set src(value) {
      this.currentSrc = value; requests.push(value); const result = outcome(value);
      const finish = () => result === 'error' ? this.onerror?.() : this.onload?.();
      if (result === 'hold') pending.push({ image: this, finish }); else queueMicrotask(finish);
    }
    decode() { return Promise.resolve(); }
  }
  return { ImageCtor, requests, pending };
}
const managerFor = (fixture, options = {}) => createDefenseVfxManager({ ImageCtor: fixture.ImageCtor, baseUrl, fetchFn: null, timeoutMs: 100, ...options });
const metadata = (id, extra = {}) => ({ id, file: `${id}.webp`, columns: 4, rows: 3, frames: 12, width: 1536, height: 1024, ...extra });

test('all seven six/seven-star characters have 21 distinct dedicated skill animations; every lower-star skill uses the shared sheet', () => {
  const premium = CHARACTERS.filter(c => c.stars >= 6), common = CHARACTERS.filter(c => c.stars < 6);
  assert.equal(premium.length, 7); assert.equal(common.length, 43);
  assert.deepEqual([...PREMIUM_VFX_CHARACTERS].sort(), premium.map(c => c.id).sort());
  assert.equal(VFX_ATLAS_SPECS.length, 8); assert.equal(new Set(VFX_ATLAS_SPECS.map(a => a.id)).size, 8);
  const unique = new Set(); let covered = 0;
  for (const character of CHARACTERS) for (const [index, skill] of character.skills.entries()) {
    const spec = getVfxSpec(character.id, skill.id); covered++;
    assert.ok(spec, skill.id); assert.equal(spec.skillId, skill.id); assert.equal(spec.columns, 4); assert.equal(spec.rows, 3);
    assert.ok(spec.row >= 0 && spec.row < 3); assert.equal(spec.rarity, character.stars);
    assert.equal(spec.premium, character.stars >= 6);
    if (character.stars >= 6) {
      assert.equal(spec.atlasId, character.id); assert.equal(spec.row, index); assert.equal(spec.tint, null);
      unique.add(`${spec.source}:${spec.row}`);
    } else { assert.equal(spec.atlasId, 'generic'); assert.ok(spec.tint); }
  }
  assert.equal(covered, 150); assert.equal(unique.size, 21);
  assert.equal(getVfxSpec('zoro', 'zoro-0').row, 0);
  assert.equal(getVfxSpec('usopp', 'usopp-1').row, 1);
  assert.equal(getVfxSpec('chopper', 'chopper-1').row, 2);
});

test('unknown or mismatched character/skill requests cannot select another character’s premium artwork', () => {
  for (const id of ['__proto__', 'constructor', 'unknown', 'shanks', 'ace', 'sabo', 'law', 'king', null]) assert.equal(getVfxSpec(id, 'luffy-0'), null);
  assert.equal(getVfxSpec('luffy', 'zoro-0'), null); assert.equal(getVfxSpec('luffy', 'luffy-9'), null);
  assert.equal(getVfxSpec({ characterId: 'luffy' }, { id: 'luffy-2' }).row, 2);
});

test('atlas loading is lazy, shared across skill rows, and frame crops remain inside non-divisible image dimensions', async () => {
  const f = images(), manager = managerFor(f); await manager.ready;
  assert.equal(f.requests.length, 0); assert.equal(manager.sprite('luffy', 'luffy-0', null, 0), null);
  const first = manager.load('luffy', 'luffy-0'), third = manager.load('luffy', 'luffy-2');
  await Promise.all([first.promise, third.promise]);
  assert.equal(f.requests.filter(url => url.includes('/luffy.webp')).length, 1);
  assert.equal(f.requests.filter(url => url.includes('/generic.webp')).length, 1);
  for (const [phase, expectedFrame] of [[-1,0],[0,0],[.25,1],[.5,2],[.75,3],[1,3],[5,3]]) {
    const sprite = manager.sprite('luffy', 'luffy-2', null, phase);
    assert.equal(sprite.row, 2); assert.equal(sprite.frame, expectedFrame); assert.equal(sprite.premium, true);
    assert.equal(sprite.sx, expectedFrame * 384); assert.equal(sprite.sy, 2 * 1024 / 3);
    assert.ok(sprite.sw > 0 && sprite.sh > 0); assert.ok(sprite.sx + sprite.sw <= 1536 + 1e-8 && sprite.sy + sprite.sh <= 1024 + 1e-8);
  }
  assert.ok(Number.isFinite(manager.sprite('luffy', 'luffy-2', null, NaN).sx)); manager.destroy();
});

test('manifest metadata admits only fixed atlas files and valid grids, and versions image requests by the delivery hash', async () => {
  const f = images(), sha256 = 'a'.repeat(64);
  const manager = managerFor(f, { fetchFn: async () => ({ ok: true, json: async () => ({ assets: [
    metadata('luffy', { sha256 }), metadata('kaido', { file: '../foreign.webp' }), metadata('whitebeard', { columns: 3 }),
    metadata('aokiji', { width: 0 }), metadata('unrecognized'),
  ] }) }) });
  await manager.ready; assert.deepEqual([...manager.metadata.keys()], ['luffy']);
  await manager.load('luffy', 'luffy-0').promise;
  assert.ok(f.requests.some(url => url.endsWith('/luffy.webp?v=' + sha256.slice(0, 16))));
  assert.ok(f.requests.every(url => !url.includes('foreign'))); manager.destroy();
});

test('archived Law artwork is never selectable, admitted as active metadata, or fetched by explicit or full preloads', async () => {
  const f = images(), manager = managerFor(f, { fetchFn: async () => ({ ok: true, json: async () => ({ assets: [metadata('law')] }) }) });
  await manager.ready; assert.equal(manager.metadata.has('law'), false);
  for (const id of ['law', 'ace', 'sabo', 'king']) {
    assert.equal(manager.load(id, `${id}-0`), null);
    assert.equal(manager.sprite(id, `${id}-0`), null);
  }
  await manager.preload(['law', 'ace', 'sabo', 'king']);
  assert.deepEqual([...manager.images.keys()], ['generic']);
  await manager.preload();
  assert.deepEqual([...manager.images.keys()].sort(), VFX_ATLAS_SPECS.map(spec => spec.id).sort());
  assert.equal(f.requests.length, 8);
  assert.ok(f.requests.every(url => !url.includes('/law.webp')));
  manager.destroy();
});

test('a loading or failed premium atlas uses a loaded generic animation without blocking or changing its requested skill', async () => {
  for (const outcome of ['hold', 'error']) {
    const f = images(url => url.includes('/luffy.webp') ? outcome : 'load'), manager = managerFor(f);
    await manager.ready; await manager.load('zoro', 'zoro-0').promise;
    const pending = manager.load('luffy', 'luffy-2');
    if (outcome === 'error') await pending.promise;
    const sprite = manager.sprite('luffy', 'luffy-2', null, .5);
    assert.ok(sprite); assert.equal(sprite.atlasId, 'generic'); assert.equal(sprite.premium, false);
    assert.equal(sprite.spec.skillId, 'luffy-2'); assert.equal(sprite.row, 1);
    manager.destroy(); await pending.promise;
  }
});

test('image errors, invalid dimensions, decode failure and timeout resolve gracefully with no sprite when all artwork fails', async () => {
  for (const failure of ['error', 'dimensions', 'decode', 'timeout']) {
    const f = images(() => failure === 'timeout' ? 'hold' : failure === 'error' ? 'error' : 'load', failure === 'dimensions' ? 0 : 1536);
    if (failure === 'decode') f.ImageCtor.prototype.decode = () => Promise.reject(Error('decode failed'));
    const manager = managerFor(f, { timeoutMs: 10 });
    const loaded = await manager.preload(); assert.ok(loaded.every(item => item.failed && !item.loaded), failure);
    assert.equal(manager.sprite('luffy', 'luffy-0'), null); assert.equal(manager.sprite('zoro', 'zoro-0'), null); manager.destroy();
  }
});

test('unavailable, malformed or slow manifests never prevent the fixed-layout loader from recovering', async () => {
  for (const fetchFn of [async () => { throw Error('offline'); }, async () => ({ ok: true, json: async () => null }), () => new Promise(() => {})]) {
    const f = images(), manager = managerFor(f, { fetchFn, manifestTimeoutMs: 10 });
    assert.equal(manager.sprite('luffy', 'luffy-0'), null);
    await manager.ready; const item = await manager.load('luffy', 'luffy-0').promise;
    assert.equal(item.loaded, true); assert.ok(manager.sprite('luffy', 'luffy-0')); manager.destroy();
  }
});

test('metadata/image dimension mismatches fall back and destroying during load cancels late image work', async () => {
  const f = images(), manager = managerFor(f, { fetchFn: async () => ({ ok: true, json: async () => [metadata('luffy', { width: 2048 })] }) });
  await manager.ready; const item = await manager.load('luffy', 'luffy-0').promise;
  assert.equal(item.failed, true); await manager.load('zoro', 'zoro-0').promise;
  assert.equal(manager.sprite('luffy', 'luffy-0').atlasId, 'generic'); manager.destroy();
  const slow = images(() => 'hold'), pendingManager = managerFor(slow); await pendingManager.ready;
  const pending = pendingManager.load('luffy', 'luffy-0'); await Promise.resolve(); pendingManager.destroy();
  await pending.promise; assert.equal(pending.failed, true); assert.equal(pendingManager.sprite('luffy', 'luffy-0'), null);
});

function webpInfo(bytes) {
  assert.equal(bytes.subarray(0,4).toString(), 'RIFF'); assert.equal(bytes.subarray(8,12).toString(), 'WEBP');
  const info = { alpha: false, width: 0, height: 0 };
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunk = bytes.subarray(offset,offset+4).toString(), length = bytes.readUInt32LE(offset+4), start = offset + 8;
    assert.ok(start + length <= bytes.length, 'Complete WebP chunk');
    if (chunk === 'ALPH') info.alpha = true;
    if (chunk === 'VP8X') { info.alpha ||= !!(bytes[start] & 0x10); info.width = 1 + bytes.readUIntLE(start+4,3); info.height = 1 + bytes.readUIntLE(start+7,3); }
    if (chunk === 'VP8L') { assert.equal(bytes[start],0x2f); const bits = bytes.readUInt32LE(start+1); info.width = 1 + (bits & 0x3fff); info.height = 1 + ((bits >>> 14) & 0x3fff); info.alpha ||= !!(bits & 0x10000000); }
    offset = start + length + (length & 1);
  }
  return info;
}
test('all eight active atlases and archived Law artwork retain verified dimensions, alpha, provenance and unique checksums', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', assetRoot), 'utf8'));
  const rows = Array.isArray(manifest) ? manifest : manifest.assets;
  assert.equal(rows.length, 9); assert.deepEqual(rows.map(r=>r.id).sort(),[...VFX_ATLAS_SPECS.map(s=>s.id), 'law'].sort());
  const hashes = new Set();
  for (const row of rows) {
    assert.equal(row.file, row.id+'.webp'); assert.equal(row.columns,4); assert.equal(row.rows,3); assert.equal(row.frames,12);
    assert.ok(row.provenance, row.id+' preserves generation provenance');
    const bytes = await fs.readFile(new URL(row.file, assetRoot)), info = webpInfo(bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),row.sha256,row.id+' delivered checksum'); hashes.add(row.sha256);
    assert.equal(info.width,row.width); assert.equal(info.height,row.height); assert.ok(info.width>=1000&&info.height>=1000);
    assert.equal(info.alpha,true,row.id+' requires real alpha support');
  }
  assert.equal(hashes.size,9,'Every character atlas and the generic atlas is a distinct delivered image');
});
