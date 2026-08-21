import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

sharp.cache(false);

const root = path.resolve(import.meta.dirname, '..');
const packRoot = path.join(root, 'assets', 'realm-of-embers', 'pack-ripping');
const previewFile = path.join(root, 'assets', 'realm-of-embers', 'previews', 'pack-qa.png');
const checkOnly = process.argv.includes('--check');
const EDGE = 3;

const files = [];
for (const set of ['gen1', 'nd']) {
  for (const tier of ['bronze', 'silver', 'gold']) {
    for (let frame = 1; frame <= 7; frame++) {
      files.push({ set, tier, frame, file: path.join(packRoot, set, tier, `frame-${String(frame).padStart(2, '0')}.webp`) });
    }
  }
}

function inspect(raw, width, height) {
  const brightRows = [];
  for (let y = EDGE; y < Math.min(80, height - EDGE); y++) {
    let visible = 0;
    let bright = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (raw[i + 3] > 20) visible++;
      if (raw[i + 3] > 20 && Math.min(raw[i], raw[i + 1], raw[i + 2]) > 150) bright++;
    }
    if (visible / width >= 0.98 && bright / width >= 0.95) brightRows.push(y);
  }
  let edgePixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= EDGE && x < width - EDGE && y >= EDGE && y < height - EDGE) continue;
    if (raw[(y * width + x) * 4 + 3] > 20) edgePixels++;
  }
  return { brightRows, edgePixels };
}

function clearBadPixels(raw, width, height, brightRows) {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < EDGE || x >= width - EDGE || y < EDGE || y >= height - EDGE || brightRows.includes(y)) {
      raw[(y * width + x) * 4 + 3] = 0;
    }
  }
}

async function writeOver(file, bytes) {
  let last;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { fs.writeFileSync(file, bytes); return; }
    catch (error) {
      last = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw last;
}

let changed = 0;
let failed = 0;
for (const item of files) {
  if (!fs.existsSync(item.file)) throw new Error(`Missing pack frame: ${item.file}`);
  const decoded = await sharp(item.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  if (width !== 512 || height !== 512) throw new Error(`${path.relative(root, item.file)} is ${width}x${height}, expected 512x512`);
  const issue = inspect(decoded.data, width, height);
  if (checkOnly) {
    if (issue.edgePixels || issue.brightRows.length) {
      failed++;
      console.error(`${path.relative(root, item.file)}: ${issue.edgePixels} visible edge pixels; bright full-width rows ${issue.brightRows.join(', ') || 'none'}`);
    }
    continue;
  }
  if (!issue.edgePixels && !issue.brightRows.length) continue;
  clearBadPixels(decoded.data, width, height, issue.brightRows);
  const encoded = await sharp(decoded.data, { raw: { width, height, channels: 4 } })
    .webp({ lossless: true, effort: 5 })
    .toBuffer();
  await writeOver(item.file, encoded);
  changed++;
  console.log(`${path.relative(root, item.file)}: cleared ${issue.edgePixels} edge pixels${issue.brightRows.length ? ` and rows ${issue.brightRows.join(', ')}` : ''}`);
}

if (checkOnly) {
  console.log(`${files.length} pack frames checked; ${failed} still contain a crop border or full-width light band.`);
  process.exit(failed ? 1 : 0);
}

const cell = 174;
const label = 34;
const preview = sharp({ create: { width: cell * 7, height: (cell + label) * 6, channels: 4, background: '#070917ff' } });
const layers = [];
for (let row = 0; row < 6; row++) {
  const group = files.slice(row * 7, row * 7 + 7);
  for (let col = 0; col < group.length; col++) {
    const item = group[col];
    layers.push({ input: await sharp(item.file).resize(cell - 10, cell - 10, { fit: 'contain' }).png().toBuffer(), left: col * cell + 5, top: row * (cell + label) + 5 });
    const text = `${item.set} ${item.tier} · ${item.frame}`.replace(/&/g, '&amp;');
    layers.push({
      input: Buffer.from(`<svg width="${cell}" height="${label}" xmlns="http://www.w3.org/2000/svg"><rect width="${cell}" height="${label}" fill="#14182c"/><text x="${cell / 2}" y="22" fill="#fff2c1" font-family="Arial,sans-serif" font-size="14" font-weight="700" text-anchor="middle">${text}</text></svg>`),
      left: col * cell,
      top: row * (cell + label) + cell
    });
  }
}
await preview.composite(layers).png().toFile(previewFile);
console.log(`${files.length} pack frames processed; ${changed} rewritten. QA preview: ${path.relative(root, previewFile)}`);
