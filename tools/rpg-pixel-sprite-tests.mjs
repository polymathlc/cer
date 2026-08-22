import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const assetRoot = path.join(root, "assets", "science-quest", "avatar-pixel-v1");
const manifest = JSON.parse(fs.readFileSync(path.join(assetRoot, "asset-manifest.json"), "utf8"));
const qa = JSON.parse(fs.readFileSync(path.join(assetRoot, "asset-qa.json"), "utf8"));

const catalogStart = app.indexOf("const RPG_ITEMS = [");
const catalogEnd = app.indexOf("const RPG_ITEMS_BY_ID", catalogStart);
assert.ok(catalogStart >= 0 && catalogEnd > catalogStart, "RPG item catalogue should be readable");
const items = app.slice(catalogStart, catalogEnd).split(/\r?\n/)
  .filter(line => /\{\s*id:\s*"/.test(line) && /\bslot:\s*"/.test(line))
  .map(line => ({
    id: line.match(/\bid:\s*"([^"]+)"/)?.[1],
    slot: line.match(/\bslot:\s*"([^"]+)"/)?.[1],
  }));

assert.equal(items.length, 143, "pixel atlas should cover all 143 equipment items");
assert.equal(manifest.status, "admin-beta", "pixel atlas should remain an admin beta");
assert.deepEqual(manifest.canvas, { width: 96, height: 96, format: "PNG", rendering: "pixelated" });
assert.deepEqual(manifest.layerOrder, ["accessory-back", "character", "armor", "helmet", "accessory-front", "shield", "weapon", "pet"]);
assert.equal(manifest.characters.length, 2, "male and female character sprites should exist");
assert.equal(manifest.items.length, items.length, "pixel manifest should cover the full item catalogue");

assert.match(app, /const RPG_PIXEL_BETA_RELEASED = false;/, "pixel mode must remain unreleased");
assert.match(app, /function rpgPixelBetaEnabled\(\)[\s\S]*?if \(!rpgCanPreview\(\)\) return false;/, "unreleased pixel mode should be admin-only");
assert.match(app, /const pixelOn = rpgPixelBetaEnabled\(\);[\s\S]*?if \(pixelOn\) return rpgPixelAvatarSvg\(equipment, gender\);/, "shared avatar renderer should select the pixel compositor");
assert.match(app, /x="0" y="0" width="96" height="96" preserveAspectRatio="none"/, "pixel layers should share one exact canvas");
assert.match(app, /window\.rpgSetPixelBeta = rpgSetPixelBeta;/, "inline beta toggle should be globally callable");
assert.match(app, /window\.rpgUnlockAllBetaItems = rpgUnlockAllBetaItems;/, "inline unlock control should be globally callable");
assert.match(app, /class="av-swing"/, "weapon layer should retain attack animation support");
assert.match(html, /\.rpg-pixel-avatar, \.rpg-pixel-avatar image \{ image-rendering: pixelated;/, "browser should use nearest-neighbour pixel rendering");
assert.match(html, /body\.rpg-pixel-beta #page-adventure \.adv-stage/, "Dungeon should receive the pixel-mode treatment");
assert.match(html, /id="rpgArtBetaPanel" hidden/, "beta UI should start hidden");

function pngSize(bytes) {
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", "asset should be PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const expected = [...manifest.characters, ...manifest.items];
assert.equal(expected.length, 145, "atlas should contain 143 items plus two characters");
const qaByFile = new Map(qa.assets.map(asset => [asset.file, asset]));
assert.equal(qaByFile.size, expected.length, "alpha QA should cover every runtime sprite");
const catalogById = new Map(items.map(item => [item.id, item]));
for (const entry of expected) {
  const file = path.join(assetRoot, entry.file);
  assert.ok(fs.existsSync(file), `pixel asset missing: ${entry.file}`);
  const bytes = fs.readFileSync(file);
  assert.deepEqual(pngSize(bytes), { width: 96, height: 96 }, `${entry.file} should be exactly 96x96`);
  const report = qaByFile.get(entry.file);
  assert.ok(report && report.opaquePixels > 0 && report.bounds, `${entry.file} should contain visible pixels on transparency`);
  if (entry.id && entry.slot) {
    assert.equal(entry.slot, catalogById.get(entry.id)?.slot, `${entry.id} slot should match the catalogue`);
    assert.equal(entry.file, `items/${entry.slot}/${entry.id}.png`, `${entry.id} should use its stable fixed-canvas path`);
  }
}

console.log(`rpg-pixel-sprite-tests: ${expected.length} exact-canvas sprites OK (admin-only beta)`);
