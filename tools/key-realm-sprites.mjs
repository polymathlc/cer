// Key the chroma screen out of the BUNDLED Realm of Embers sprites — once, at
// build time, with the result committed. Run with:
//     npm i sharp
//     node tools/key-realm-sprites.mjs --check     report only, writes nothing
//     node tools/key-realm-sprites.mjs             key and rewrite in place
//
// WHY IT EXISTS
// The art in assets/realm-of-embers/ is a production pass. Card scenes are
// finished pictures, but every sprite that STANDS ON NOTHING -- the `:av`
// battle avatars and the `hero:` portraits -- was drawn against one flat chroma
// wall, because that is the only instruction an image model can actually follow
// (CLAUDE.md, "Nothing that stands on nothing may keep a background"). The app
// keys that wall out on the way through `_tcgArtStore`, i.e. for a picture an
// admin uploads. Bundled art is served straight off the same origin and never
// passes that door, so the wall comes off HERE instead -- or a monster walks
// onto the battlefield inside a magenta box.
//
// IT IS THE SHIPPING KEYER, NOT A COPY. `_screenKeyOut` and `_screenDn` are
// extracted out of app.js exactly as tools/chroma-key-tests.mjs extracts them,
// and run against a canvas shim backed by sharp. A second implementation would
// be free to drift, and a keyer that drifts holes the artwork.
//
// THE ONE DELIBERATE DIFFERENCE: it keys with `strict` OFF.
// Strict mode refuses to key when screen colour is walled in behind the subject
// -- the guard that stops a magenta gem being punched out of a sprite. These
// monsters defeat its geometry test wholesale: a coiled serpent, a dragon's
// wing gaps and a ring of fire are all real wall seen through a real hole, but
// the material around the opening is THICKER than the opening is wide, so the
// `shell <= rad` test reads them as paint (see "An enclosed patch of screen
// colour is a HOLE or it is PAINT"). Strict refuses 246 of 206 sprites' worth
// of openings, and the fallback -- the flood-fill knock-out -- cannot reach an
// enclosed region at all, so it would ship those coils full of magenta.
//
// What makes the looser cut safe HERE and not at runtime is that this is a
// build step: the cut is pure colour (it only ever touches a pixel that is
// already the wall's own hue, so it cannot flood anywhere), every result is
// verified below, a contact sheet is written for a human to look at, and the
// SOURCE files are in git -- a mistake is one revert away. None of that is true
// of a picture a model returned to a browser thirty seconds ago.
//
// It is IDEMPOTENT. A sprite that is already cut carries no wall, fails the
// "is there a screen here at all" precondition, and is left untouched.
import fs from 'fs';
import path from 'path';
import url from 'url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ART = path.join(ROOT, 'assets', 'realm-of-embers');
const CHECK = process.argv.includes('--check');
const SHEET = path.join(ART, 'previews', 'keyed-sprites-qa.png');

let sharp;
try { sharp = (await import('sharp')).default; }
catch { console.error('This tool needs sharp for image I/O:  npm i sharp'); process.exit(2); }

// ---- the app's own functions, on a canvas shim ------------------------------
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const grab = sig => { const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0; const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } } };
const slice = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const pieces = [
  slice('const TCG_SCREENS = {', 'function tcgScreenForElement'),
  slice('const TCG_SCREEN_HI', 'function _screenDn'),
  slice('const TCG_SCREEN_RING_MIN', 'async function _screenKeyOut'),
  grab('function _screenDn'), grab('function _chamferDist'), grab('async function _screenKeyOut')
].join('\n');

const store = new Map(); let seq = 0;
const mk = (w, h, px) => { const u = 'buf:' + (++seq); store.set(u, { w, h, px }); return u; };
class ImageData { constructor(px, w, h) { this.data = px; this.width = w; this.height = h; } }
const canvas = () => { let W = 0, H = 0, PX = null; return {
  set width(v) { W = v; PX = new Uint8ClampedArray(v * H * 4); }, get width() { return W; },
  set height(v) { H = v; PX = new Uint8ClampedArray(W * v * 4); }, get height() { return H; },
  getContext() { return { drawImage: img => PX.set(store.get(img.src).px),
    getImageData: () => new ImageData(PX, W, H), putImageData: d => PX.set(d.data),
    fillRect() {}, set fillStyle(v) {} }; },
  toDataURL() { return mk(W, H, PX.slice()); } }; };
global.document = { createElement: canvas };
const hush = { warn() {}, info() {}, log() {}, error(...a) { console.error(...a); } };
const _loadImageEl = async u => { const b = store.get(u); return { naturalWidth: b.w, naturalHeight: b.h, width: b.w, height: b.h, src: u }; };
const M = new Function('_loadImageEl', 'ImageData', 'console',
  pieces + '\nreturn {_screenKeyOut,_screenDn,TCG_SCREEN_HI,TCG_SCREEN_LO,TCG_SCREEN_MIN_COVER,TCG_SCREEN_REST_MAX};')(_loadImageEl, ImageData, hush);

// ---- which wall is this sprite standing on? ---------------------------------
// Asked of the PICTURE, never looked up from the generator's routing table: the
// file is the only thing that knows what it was really drawn on, and a table
// that disagrees with it keys the wrong colour -- which fails silently and
// ships the wall.
const RING_MIN = 0.30;   // a monster may fill the frame; a third of the border is still proof
// A wall is OPAQUE, and counting an empty pixel as evidence of one is what
// makes this tool dangerous to run twice: a sprite that has already been cut
// has a fully transparent border, which reads as a perfect ring of every colour
// at once -- and the loser of that argument is whichever hue the ARTWORK
// happens to contain. A blue dragon standing on nothing would have had its own
// blue keyed out on the second pass. So emptiness proves nothing here.
function detectScreen(w, h, px) {
  let best = { name: null, ring: 0 };
  for (const name of ['magenta', 'green', 'blue']) {
    let ring = 0, hit = 0;
    const at = (x, y) => { const o = (y * w + x) * 4; ring++;
      if (px[o + 3] >= 24 && M._screenDn(px[o], px[o + 1], px[o + 2], name) >= M.TCG_SCREEN_HI) hit++; };
    for (let x = 0; x < w; x++) { at(x, 0); at(x, h - 1); }
    for (let y = 0; y < h; y++) { at(0, y); at(w - 1, y); }
    if (hit / (ring || 1) > best.ring) best = { name, ring: hit / ring };
  }
  return best;
}
const screenCover = (px, name) => { let n = 0, c = 0;
  for (let i = 0; i < px.length; i += 4) { n++; if (px[i + 3] < 24) continue;
    if (M._screenDn(px[i], px[i + 1], px[i + 2], name) >= M.TCG_SCREEN_HI) c++; }
  return c / n; };

const slots = JSON.parse(fs.readFileSync(path.join(ART, 'manifests', 'slot-map.json'), 'utf8')).slots;
const standsOnNothing = id => /(:av$|^fx:|^dfx:|^pk:|^logo:|^arti:|^hero:)/.test(id);
const ids = Object.keys(slots).filter(standsOnNothing).sort();

let keyed = 0, already = 0, failed = 0;
const notes = [], sheet = [];
for (const id of ids) {
  const file = path.join(ART, slots[id]);
  if (!fs.existsSync(file)) { notes.push([id, 'MISSING ' + slots[id]]); failed++; continue; }
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const px = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  const found = detectScreen(w, h, px);
  const cover = found.name ? screenCover(px, found.name) : 0;
  // Nothing to key. Either the sprite was cut upstream, or it never stood on a
  // wall -- both are "leave it exactly as it is", which is what makes a second
  // run of this tool a no-op.
  if (found.ring < RING_MIN || cover < M.TCG_SCREEN_MIN_COVER) { already++; continue; }

  // A monster that FILLS the frame buries most of the border ring, and the
  // whole-ring test then reads a wall it can plainly see as no wall at all --
  // it refused every hero portrait and every sprite drawn edge to edge. `wide`
  // is the app's own sanctioned relaxation for exactly that shape: a third of
  // the ring, and one WHOLE edge still clean, which is what keeps it evidence
  // of a wall rather than a licence to key anything containing the hue.
  const out = await M._screenKeyOut(mk(w, h, px.slice()), found.name, false, false)
           || await M._screenKeyOut(mk(w, h, px.slice()), found.name, false, true);
  if (!out) { notes.push([id, 'the keyer refused the ' + found.name + ' screen (ring ' + Math.round(found.ring * 100) + '%)']); failed++; continue; }
  const got = store.get(out);

  // --- verification, and it is the whole reason the looser cut is allowed ---
  // 1. Nothing the wall did not touch may have been removed. The key only ever
  //    lowers alpha on a pixel scoring above TCG_SCREEN_LO, so this is an
  //    assertion about the code rather than a hope about the picture -- which
  //    is exactly why it is worth asserting.
  let lost = 0, wall = 0, kept = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const wasScreenish = px[o + 3] >= 24 && M._screenDn(px[o], px[o + 1], px[o + 2], found.name) > M.TCG_SCREEN_LO;
    if (wasScreenish) wall++;
    if (got.px[o + 3] > 128) kept++;
    else if (px[o + 3] > 128 && !wasScreenish) lost++;
  }
  // 2. None of the wall may be left -- anywhere, border or walled in behind the
  //    artwork. The subject is briefed never to contain the screen colour, so
  //    this question has no false positives (the app asks it as
  //    _screenStillThere before it saves a generated frame).
  const rest = screenCover(got.px, found.name);
  if (lost) { notes.push([id, 'REFUSED — the cut took ' + lost + ' pixel(s) the ' + found.name + ' wall never touched']); failed++; continue; }
  if (rest > M.TCG_SCREEN_REST_MAX) { notes.push([id, 'REFUSED — ' + Math.round(rest * 100) + '% of the ' + found.name + ' screen is still there']); failed++; continue; }
  if (kept < w * h * 0.04) { notes.push([id, 'REFUSED — only ' + Math.round(kept / (w * h) * 100) + '% of the frame is left; that is not a sprite']); failed++; continue; }

  keyed++;
  if (sheet.length < 64) sheet.push({ id, px: got.px, w, h });
  if (!CHECK) {
    await sharp(Buffer.from(got.px.buffer, got.px.byteOffset, got.px.length), { raw: { width: w, height: h, channels: 4 } })
      .webp({ lossless: true, effort: 5 }).toFile(file + '.tmp');
    fs.renameSync(file + '.tmp', file);
  }
}

// A contact sheet, because the last check on a picture is a person looking at
// it. Checkerboard behind, so a hole punched in a sprite is visible rather than
// blending into a flat backdrop.
if (!CHECK && sheet.length) {
  const cell = 128, cols = 8, rows = Math.ceil(sheet.length / cols);
  const bg = Buffer.alloc(cols * cell * rows * cell * 4);
  for (let y = 0; y < rows * cell; y++) for (let x = 0; x < cols * cell; x++) {
    const v = ((x >> 3) + (y >> 3)) % 2 ? 210 : 160, o = (y * cols * cell + x) * 4;
    bg[o] = bg[o + 1] = bg[o + 2] = v; bg[o + 3] = 255;
  }
  const comp = [];
  for (let i = 0; i < sheet.length; i++) {
    const s = sheet[i];
    comp.push({ input: await sharp(Buffer.from(s.px.buffer, s.px.byteOffset, s.px.length), { raw: { width: s.w, height: s.h, channels: 4 } })
      .resize(cell, cell, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
      left: (i % cols) * cell, top: Math.floor(i / cols) * cell });
  }
  await sharp(bg, { raw: { width: cols * cell, height: rows * cell, channels: 4 } }).composite(comp).png().toFile(SHEET);
  console.log('QA contact sheet → ' + path.relative(ROOT, SHEET));
}

console.log((CHECK ? 'Would key ' : 'Keyed ') + keyed + ' sprite' + (keyed === 1 ? '' : 's')
  + ' · ' + already + ' already standing on nothing · ' + failed + ' left alone');
notes.forEach(([id, why]) => console.log('  ' + id.padEnd(24) + why));
process.exit(failed ? 1 : 0);
