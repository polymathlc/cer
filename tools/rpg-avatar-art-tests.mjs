import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const assetRoot = path.join(root, "assets", "science-quest", "avatar-v2");
const manifestPath = path.join(assetRoot, "asset-manifest.json");

const start = app.indexOf("const RPG_ITEMS = [");
const end = app.indexOf("const RPG_ITEMS_BY_ID", start);
assert.ok(start >= 0 && end > start, "RPG item catalogue should be readable");
const catalog = app.slice(start, end);
const items = catalog.split(/\r?\n/).filter(line => /\{\s*id:\s*"/.test(line) && /\bslot:\s*"/.test(line)).map(line => {
  const field = key => line.match(new RegExp(`\\b${key}:\\s*"([^"]+)"`))?.[1];
  return { id: field("id"), name: field("name"), slot: field("slot"), rarity: field("rarity") };
});
assert.equal(items.length, 143, "all 143 RPG items should remain in the catalogue");
assert.equal(new Set(items.map(x => x.id)).size, items.length, "RPG item ids should be unique");

assert.match(app, /const RPG_ART_BETA_RELEASED = false;/, "generated art must remain unreleased");
assert.match(app, /if \(!rpgCanPreview\(\)\) return false;/, "unreleased art should be admin-only");
assert.match(app, /function rpgUnlockAllBetaItems\(\)/, "admin test unlock control should exist");
assert.match(app, /RPG_ITEMS\.forEach\(it => \{ rpgState\.inventory\[it\.id\]/, "unlock control should cover the full catalogue");
assert.match(app, /function rpgItemImageAspect\(src\)/, "bundled sprites should map into paper-doll slot geometry");
assert.match(app, /includes\(`\$\{RPG_ART_BETA_ROOT\}\/`\) \? "none" : "xMidYMid meet"/, "manual overrides should keep their historical aspect ratio");
assert.match(html, /id="rpgArtBetaPanel" hidden/, "beta UI should start hidden");

const avatarStart = app.indexOf("function rpgAvatarSvg(");
const avatarEnd = app.indexOf("function rpgItemIconSvg(", avatarStart);
const avatar = app.slice(avatarStart, avatarEnd);
for (const slot of ["armor", "helmet", "pet", "shield", "weapon"]) {
  assert.match(avatar, new RegExp(`rpgItemArt\\(\"${slot}\"`), `${slot} should layer into the generated avatar`);
}
assert.match(avatar, /const accArt = acc \? rpgItemArt\("accessory"/, "accessories should use the shared image-aware layer");
assert.ok(avatar.indexOf("const eq =") < avatar.indexOf("if (charUrl) return"), "equipment must resolve before generated character composition");
for (const slot of ["armor", "helmet", "pet", "shield", "weapon"]) {
  const n = avatar.split(`rpgItemArt("${slot}"`).length - 1;
  assert.equal(n, 2, `${slot} should layer into BOTH avatar branches — the drawn hero and an uploaded character`);
}

// ── THE HERO IS DRAWN; ONLY HIS KIT IS GENERATED ─────────────────────────────
// The generated character PNG stands in a different pose and at different
// proportions from the slot boxes every piece of equipment is placed by, so a
// breastplate landed on his belly, a helm across his eyes and his shoulders
// stayed bare. Both halves of the fix are silent when undone: put the bundled
// character back and every piece is out of place again on a screen that still
// renders perfectly, and put the two bundled box overrides back and the helmet
// and the amulet alone go wrong while the armour looks right.
const charStart = app.indexOf("function rpgCharacterArtUrl(");
const charEnd = app.indexOf("function rpgAvatarSvg(", charStart);
assert.ok(charStart >= 0 && charEnd > charStart, "rpgCharacterArtUrl should be readable");
const charFn = app.slice(charStart, charEnd);
assert.ok(!charFn.includes("RPG_ART_BETA_ROOT"), "the hero must NOT fall back to a generated character sprite");
assert.ok(!charFn.includes("rpgArtBetaEnabled"), "the beta switch decides the item art, not the body");
assert.match(charFn, /_rpgArt\._character_male/, "an admin's own character upload must still win");
assert.match(charFn, /_rpgArt\._character_female/, "…for either gender");

const boxStart = app.indexOf("function rpgItemAvatarBox(");
const boxEnd = app.indexOf("function rpgItemArtImage(", boxStart);
assert.ok(boxStart >= 0 && boxEnd > boxStart, "rpgItemAvatarBox should be readable");
const boxFn = app.slice(boxStart, boxEnd);
assert.ok(!boxFn.includes("RPG_ART_BETA_ROOT"), "every item goes on its OWN slot box, generated or drawn");
assert.match(boxFn, /return it\.box \|\| RPG_SLOT_META\[it\.slot\]\.box;/, "the slot box is the one place a piece is placed");

// …and the generated ITEM art — the half worth keeping — is still served.
assert.match(app, /function rpgBundledItemArtUrl\(it\)/, "generated item art should still be bundled in");
assert.match(app, /\$\{RPG_ART_BETA_ROOT\}\/items\//, "items should still resolve to the bundled sprites");

assert.match(app, /rpgAvatarSvg\(r\.equipment \|\| \{\}, r\.gender\)/, "leaderboards should render the owner's gender");
assert.match(app, /rpgAvatarSvg\(row\.equipment \|\| \{\}, row\.gender\)/, "arena ghosts should render the owner's gender");
assert.match(app, /gender: rpgState\.gender \|\| null/, "leaderboard payload should publish gender");

assert.ok(fs.existsSync(manifestPath), "asset-manifest.json should exist");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.equal(manifest.status, "admin-beta", "manifest should identify the unreleased beta");
assert.equal(manifest.characters.length, 2, "male and female characters should both be bundled");
assert.equal(manifest.items.length, items.length, "manifest should cover every RPG item");

const manifestById = new Map(manifest.items.map(x => [x.id, x]));
for (const item of items) {
  const entry = manifestById.get(item.id);
  assert.ok(entry, `manifest entry missing for ${item.id}`);
  assert.equal(entry.slot, item.slot, `${item.id} slot should match the catalogue`);
  assert.equal(entry.rarity, item.rarity, `${item.id} rarity should match the catalogue`);
  assert.equal(entry.file, `items/${item.slot}/${item.id}.webp`, `${item.id} should use its stable id path`);
  const file = path.join(assetRoot, entry.file);
  assert.ok(fs.existsSync(file), `asset missing for ${item.id}: ${entry.file}`);
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length > 1000, `${item.id} image should not be empty`);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", `${item.id} should be WebP`);
  assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", `${item.id} should be WebP`);
}
for (const character of manifest.characters) {
  const file = path.join(assetRoot, character.file);
  assert.ok(fs.existsSync(file), `character asset missing: ${character.file}`);
}

console.log(`rpg-avatar-art-tests: ${manifest.characters.length} characters + ${items.length} items OK (admin beta)`);
