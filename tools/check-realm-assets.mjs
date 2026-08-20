import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const realm = path.join(root, 'assets', 'realm-of-embers');
const manifest = JSON.parse(fs.readFileSync(path.join(realm, 'manifests', 'asset-manifest.json'), 'utf8'));

const expected = [
  ...manifest.cards.flatMap(c => [
    { slot: c.cardSlot, file: c.cardFile, size: 512 },
    { slot: c.avatarSlot, file: c.avatarFile, size: 256 }
  ]),
  ...manifest.heroes.map(h => ({ slot: h.slot, file: h.file, size: 512 })),
  ...manifest.artifacts.map(a => ({ slot: a.slot, file: a.file, size: 512 })),
  ...manifest.packs.flatMap(p => p.frames.map(f => ({ slot: f.slot, file: f.file, size: 512 }))),
  ...manifest.attack.flatMap(a => a.frames.map(f => ({ slot: f.slot, file: f.file, size: 256 })))
];

function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.length >= 24 && b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: b.length };
  }
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), bytes: b.length };
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff), bytes: b.length };
  }
  if (kind === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, bytes: b.length };
  }
  return null;
}

const missing = [], invalid = [], dimensions = [], seenSlots = new Set(), duplicateSlots = [];
let bytes = 0;
for (const item of expected) {
  if (seenSlots.has(item.slot)) duplicateSlots.push(item.slot);
  seenSlots.add(item.slot);
  const file = path.join(realm, ...item.file.split('/'));
  if (!fs.existsSync(file)) { missing.push(item); continue; }
  const info = imageSize(file);
  if (!info) { invalid.push(item); continue; }
  bytes += info.bytes;
  if (info.width !== item.size || info.height !== item.size) dimensions.push({ ...item, actual: `${info.width}x${info.height}` });
}

const result = {
  expected: expected.length,
  present: expected.length - missing.length,
  totalMiB: Math.round(bytes / 1024 / 1024 * 10) / 10,
  missing,
  invalid,
  dimensions,
  duplicateSlots
};

console.log(JSON.stringify(result, null, 2));
if (missing.length || invalid.length || dimensions.length || duplicateSlots.length || expected.length !== 659) process.exitCode = 1;
