// Build the Science Quest pixel paper-doll set.
//
// The source character masters are generated pixel art. Item sources are the
// existing transparent avatar-v2 illustrations. This build crops each item,
// reduces it directly to its final pixel dimensions, and bakes its position
// into a complete 96x96 transparent layer. Runtime code therefore stacks equal
// canvases; it never guesses an item's scale or anchor.
//
// Run from the repository root after installing sharp: node tools/build-rpg-pixel-sprites.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

sharp.cache(false);

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repo, "assets", "science-quest", "avatar-v2");
const outRoot = path.join(repo, "assets", "science-quest", "avatar-pixel-v1");
const canvas = 96;
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const sourceManifest = JSON.parse(await fs.readFile(path.join(sourceRoot, "asset-manifest.json"), "utf8"));

const slots = {
  weapon: { x: 57, y: 8, width: 34, height: 58, fit: "contain" },
  shield: { x: 5, y: 39, width: 38, height: 38, fit: "contain" },
  armor: { x: 25, y: 37, width: 46, height: 31, fit: "fill" },
  helmet: { x: 28, y: 3, width: 40, height: 39, fit: "fill" },
  accessoryFront: { x: 40, y: 38, width: 16, height: 18, fit: "contain" },
  accessoryCape: { x: 25, y: 35, width: 46, height: 39, fit: "fill" },
  accessoryWings: { x: 10, y: 26, width: 76, height: 37, fit: "fill" },
  pet: { x: 1, y: 37, width: 26, height: 26, fit: "contain" },
};

const wingIds = new Set(["dragon_wings", "angel_wings", "wings_eternity", "wings_dawn"]);

function itemMount(item) {
  if (item.slot !== "accessory") return slots[item.slot];
  if (item.layer !== "back") return slots.accessoryFront;
  return wingIds.has(item.id) ? slots.accessoryWings : slots.accessoryCape;
}

function itemOutput(item) {
  return path.join(outRoot, "items", item.slot, `${item.id}.png`);
}

async function ensureDirs() {
  const dirs = ["characters", "previews", ...new Set(sourceManifest.items.map(item => `items/${item.slot}`))];
  await Promise.all(dirs.map(dir => fs.mkdir(path.join(outRoot, dir), { recursive: true })));
}

async function normalizedCharacter(gender) {
  const source = path.join(outRoot, "sources", "characters", `${gender}-master.png`);
  const trimmed = await sharp(source)
    .ensureAlpha()
    .trim({ background: transparent, threshold: 1 })
    .resize({ height: 86, kernel: sharp.kernel.nearest })
    .png({ palette: true, colours: 64, dither: 0 })
    .toBuffer();
  const meta = await sharp(trimmed).metadata();
  const left = Math.round((canvas - meta.width) / 2);
  const top = 93 - meta.height;
  await sharp({ create: { width: canvas, height: canvas, channels: 4, background: transparent } })
    .composite([{ input: trimmed, left, top }])
    .png({ palette: true, colours: 64, dither: 0 })
    .toFile(path.join(outRoot, "characters", `${gender}.png`));
}

async function normalizedItem(item) {
  const mount = itemMount(item);
  const source = path.join(sourceRoot, item.file);
  const fitted = await sharp(source)
    .ensureAlpha()
    .trim({ background: transparent, threshold: 1 })
    .resize(mount.width, mount.height, {
      fit: mount.fit,
      kernel: sharp.kernel.nearest,
      background: transparent,
      withoutEnlargement: false,
    })
    .png({ palette: true, colours: 64, dither: 0 })
    .toBuffer();
  await sharp({ create: { width: canvas, height: canvas, channels: 4, background: transparent } })
    .composite([{ input: fitted, left: mount.x, top: mount.y }])
    .png({ palette: true, colours: 64, dither: 0 })
    .toFile(itemOutput(item));
}

async function alphaQa(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1, opaque = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] <= 8) continue;
      opaque++;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  return {
    file: path.relative(outRoot, file).replaceAll("\\", "/"),
    width: info.width,
    height: info.height,
    opaquePixels: opaque,
    bounds: opaque ? { left, top, right, bottom } : null,
  };
}

function itemById(id) {
  return sourceManifest.items.find(item => item.id === id);
}

async function renderLoadout(set) {
  const layers = [];
  const accessory = set.accessory && itemById(set.accessory);
  if (accessory?.layer === "back") layers.push({ input: itemOutput(accessory) });
  layers.push({ input: path.join(outRoot, "characters", `${set.gender || "male"}.png`) });
  for (const slot of ["armor", "helmet"]) {
    const item = set[slot] && itemById(set[slot]);
    if (item) layers.push({ input: itemOutput(item) });
  }
  if (accessory?.layer !== "back" && accessory) layers.push({ input: itemOutput(accessory) });
  for (const slot of ["shield", "weapon", "pet"]) {
    const item = set[slot] && itemById(set[slot]);
    if (item) layers.push({ input: itemOutput(item) });
  }
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: transparent } })
    .composite(layers)
    .png({ palette: true, colours: 96, dither: 0 })
    .toBuffer();
}

function xml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}

async function contactSheet(slot) {
  const items = sourceManifest.items.filter(item => item.slot === slot);
  const cols = 8, cellWidth = 160, cellHeight = 174;
  const rows = Math.ceil(items.length / cols);
  const width = cols * cellWidth, height = rows * cellHeight;
  const cards = items.map((item, index) => {
    const x = (index % cols) * cellWidth, y = Math.floor(index / cols) * cellHeight;
    return `<rect x="${x + 5}" y="${y + 5}" width="150" height="164" rx="12" fill="#f8fafc" stroke="#cbd5e1"/>
      <text x="${x + 80}" y="${y + 145}" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="700" fill="#172033">${xml(item.name)}</text>
      <text x="${x + 80}" y="${y + 161}" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" fill="#64748b">${xml(item.id)}</text>`;
  }).join("");
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#e8edf4"/>${cards}</svg>`);
  const composites = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const avatar = await renderLoadout({ gender: "male", [slot]: item.id });
    composites.push({
      input: await sharp(avatar).resize(128, 128, { kernel: sharp.kernel.nearest }).png().toBuffer(),
      left: (index % cols) * cellWidth + 16,
      top: Math.floor(index / cols) * cellHeight + 10,
    });
  }
  await sharp(bg).composite(composites).png().toFile(path.join(outRoot, "previews", `${slot}-qa.png`));
}

async function loadoutSheet() {
  const sets = [
    { name: "Field Adventurer", tier: "COMMON", color: "#8b5cf6", gender: "male", weapon: "wood_sword", shield: "wooden_shield", armor: "cloth_tunic", helmet: "leather_cap", accessory: "lucky_amulet", pet: "loyal_pup" },
    { name: "Frostfire Champion", tier: "EPIC", color: "#f59e0b", gender: "female", weapon: "flame_sword", shield: "knight_shield", armor: "frost_plate", helmet: "glacier_helm", accessory: "phoenix_cape", pet: "ember_fox" },
    { name: "Eternal Worldender", tier: "MYTHIC", color: "#ec4899", gender: "male", weapon: "worldender", shield: "aegis_eternity", armor: "dawnforged_plate", helmet: "crown_infinity", accessory: "wings_eternity", pet: "cosmic_wyrm" },
  ];
  const width = 1280, height = 680;
  const cards = sets.map((set, index) => {
    const x = 55 + index * 405;
    return `<rect x="${x}" y="105" width="370" height="535" rx="22" fill="#fff" stroke="${set.color}" stroke-width="4"/>
      <rect x="${x + 20}" y="125" width="330" height="350" rx="16" fill="#172033"/>
      <text x="${x + 185}" y="520" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#172033">${xml(set.name)}</text>
      <text x="${x + 185}" y="550" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700" letter-spacing="3" fill="${set.color}">${set.tier} LOADOUT</text>
      <text x="${x + 185}" y="582" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#64748b">${xml(set.weapon)} · ${xml(set.shield)}</text>
      <text x="${x + 185}" y="603" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#64748b">${xml(set.armor)} · ${xml(set.helmet)}</text>
      <text x="${x + 185}" y="624" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#64748b">${xml(set.accessory)} · ${xml(set.pet)}</text>`;
  }).join("");
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="#111827"/><stop offset=".5" stop-color="#27235f"/><stop offset="1" stop-color="#111827"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <text x="640" y="48" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#fff">Science Quest pixel paper-doll beta</text>
    <text x="640" y="78" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" fill="#c7d2fe">96 × 96 fixed-canvas sprites · no runtime fitting</text>${cards}</svg>`);
  const composites = [];
  for (let index = 0; index < sets.length; index++) {
    const avatar = await renderLoadout(sets[index]);
    composites.push({ input: await sharp(avatar).resize(320, 320, { kernel: sharp.kernel.nearest }).png().toBuffer(), left: 80 + index * 405, top: 140 });
  }
  await sharp(bg).composite(composites).png().toFile(path.join(outRoot, "previews", "loadouts-qa.png"));
}

await ensureDirs();
await Promise.all([normalizedCharacter("male"), normalizedCharacter("female")]);
for (const item of sourceManifest.items) await normalizedItem(item);

const files = [
  path.join(outRoot, "characters", "male.png"),
  path.join(outRoot, "characters", "female.png"),
  ...sourceManifest.items.map(itemOutput),
];
const qa = [];
for (const file of files) qa.push(await alphaQa(file));
await fs.writeFile(path.join(outRoot, "asset-qa.json"), `${JSON.stringify({ canvas, assets: qa }, null, 2)}\n`);

const manifest = {
  version: 1,
  status: "admin-beta",
  generatedAt: "2026-08-22",
  canvas: { width: canvas, height: canvas, format: "PNG", rendering: "pixelated" },
  layerOrder: ["accessory-back", "character", "armor", "helmet", "accessory-front", "shield", "weapon", "pet"],
  characters: [
    { id: "male", file: "characters/male.png", source: "sources/characters/male-master.png" },
    { id: "female", file: "characters/female.png", source: "sources/characters/female-master.png" },
  ],
  items: sourceManifest.items.map(item => ({
    id: item.id,
    name: item.name,
    slot: item.slot,
    rarity: item.rarity,
    layer: item.layer,
    file: `items/${item.slot}/${item.id}.png`,
    mount: itemMount(item),
    source: `../avatar-v2/${item.file}`,
  })),
};
await fs.writeFile(path.join(outRoot, "asset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const slot of ["armor", "helmet", "accessory", "shield", "weapon", "pet"]) await contactSheet(slot);
await loadoutSheet();

console.log(`Built ${files.length} fixed-canvas pixel sprites (${sourceManifest.items.length} items + 2 characters).`);
