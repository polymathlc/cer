// Regression tests for the sprite background KNOCK-OUT (_stripImageBackground,
// the chequerboard detector and the verifier). Run with:
//     node tools/bg-cut-tests.mjs            all cases
//     node tools/bg-cut-tests.mjs <name>     one case
//
// It loads the REAL functions out of app.js and runs them over synthetic
// pictures on a small canvas shim, so it tests the shipping code rather than a
// copy of it. If you add a function the cutter calls, add it to the `grab`
// list below or the shim will fail open and every case will silently pass.
//
// Every case here is a bug that actually shipped or was one edit away:
// the pack whose interior was hollowed out through its own tear, the shadow
// monster and the white frost effect whose backdrops could not be removed at
// all, the scale armour deleted by the chequerboard cutter on its second pass.
import fs from 'fs';
const APP = new URL('../app.js', import.meta.url);
const src = fs.readFileSync(APP, 'utf8');
const grab = sig => { const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0; const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } } };
const consts = src.slice(src.indexOf('const _BG_TOL'), src.indexOf('const _CHECK_CHROMA') + 120);
const pieces = [consts, grab('function _nearNeutral'), grab('function _checkerOnBorder'),
  grab('function _cutHoleArea'),
  grab('function _detectCheckerPair'), grab('function _cutCheckerboard'),
  grab('async function _stripImageBackground'), grab('function _cornerOpacity'),
  grab('function _bgLeftoverInPixels'), grab('async function _bgLeftover')].join('\n');

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
const _loadImageEl = async u => { const b = store.get(u); return { naturalWidth: b.w, naturalHeight: b.h, width: b.w, height: b.h, src: u }; };
const M = new Function('_loadImageEl', 'ImageData', 'console',
  pieces + '\nreturn {_stripImageBackground,_bgLeftover};')(_loadImageEl, ImageData, console);

const S = 220;
// paint(fn) -> data url. fn(x,y) returns [r,g,b] for background/subject or null for "empty" (alpha 0).
// It also returns a tag via tagOf so the suite can score what survived.
function paint(fn) {
  const px = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4, c = fn(x, y);
    if (!c) { px[o + 3] = 0; continue; }
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  return mk(S, S, px);
}
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
function score(url, tagOf) {
  const b = store.get(url); const keep = {}, tot = {};
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const t = tagOf(x, y); if (!t) continue;
    tot[t] = (tot[t] || 0) + 1;
    if (b.px[(y * S + x) * 4 + 3] > 128) keep[t] = (keep[t] || 0) + 1;
  }
  const out = {}; Object.keys(tot).forEach(t => { out[t] = pct(keep[t] || 0, tot[t]); });
  return out;
}

const CASES = [];
const test = (name, build, tagOf, want, strict = true) => CASES.push({ name, build, tagOf, want, strict });

// 1-2. The reported bug: gold packet, dark navy inner panel, dark backdrop.
//      Frame 1 is sealed; frame 2 has a nick torn in the top edge, which opens
//      a channel from the backdrop into the interior.
for (const [nm, tear] of [['pack-sealed', false], ['pack-torn', true]]) {
  const inPack = (x, y) => x >= 64 && x < 156 && y >= 26 && y < 194;
  const inPanel = (x, y) => x >= 78 && x < 142 && y >= 52 && y < 168;
  const emblem = (x, y) => Math.hypot(x - 110, y - 110) < 30;
  const inTear = (x, y) => tear && x >= 104 && x < 116 && y >= 26 && y < 56;
  test(nm,
    () => paint((x, y) => inTear(x, y) ? [10, 14, 34]
      : inPanel(x, y) && emblem(x, y) ? [196, 150, 58]
      : inPanel(x, y) ? [16, 24, 52]
      : inPack(x, y) ? [214, 168, 66] : [10, 14, 34]),
    (x, y) => inTear(x, y) ? null : inPanel(x, y) && !emblem(x, y) ? 'panel'
      : inPanel(x, y) ? 'emblem' : inPack(x, y) ? 'foil' : 'backdrop',
    { panel: 'keep', emblem: 'keep', foil: 'keep', backdrop: 'cut' });
}
// 3. A shadow monster that is almost entirely black, on a black backdrop.
test('shadow-monster',
  () => paint((x, y) => Math.hypot(x - 110, y - 110) < 62 ? [18, 16, 26] : [6, 6, 10]),
  (x, y) => Math.hypot(x - 110, y - 110) < 58 ? 'monster' : Math.hypot(x - 110, y - 110) > 70 ? 'backdrop' : null,
  { monster: 'keep', backdrop: 'cut' });
// 4. A frost effect, white and pale grey, on a white backdrop.
test('frost-on-white',
  () => paint((x, y) => Math.hypot(x - 110, y - 110) < 62 ? [232, 244, 252] : [250, 250, 250]),
  (x, y) => Math.hypot(x - 110, y - 110) < 58 ? 'effect' : Math.hypot(x - 110, y - 110) > 70 ? 'backdrop' : null,
  { effect: 'keep', backdrop: 'cut' });
// 5. A painted chequerboard behind the sprite — must go, wherever it sits.
test('chequerboard',
  () => paint((x, y) => Math.hypot(x - 110, y - 110) < 62 ? [225, 175, 60]
    : (((x >> 3) + (y >> 3)) % 2 ? [242, 242, 242] : [217, 217, 217])),
  (x, y) => Math.hypot(x - 110, y - 110) < 58 ? 'sprite' : Math.hypot(x - 110, y - 110) > 70 ? 'chequer' : null,
  { sprite: 'keep', chequer: 'cut' });
// 6. A gradient plate — the cautious cut refuses these, so force has to do it.
test('gradient-plate',
  () => paint((x, y) => Math.hypot(x - 110, y - 110) < 62 ? [225, 175, 60]
    : [10 + ((x / S * 70) | 0), 14 + ((y / S * 40) | 0), 34 + ((x / S * 50) | 0)]),
  (x, y) => Math.hypot(x - 110, y - 110) < 58 ? 'sprite' : Math.hypot(x - 110, y - 110) > 70 ? 'plate' : null,
  { sprite: 'keep', plate: 'cut' });
// 7. Already a proper cut-out — must be handed back untouched.
test('already-cut',
  () => paint((x, y) => Math.hypot(x - 110, y - 110) < 62 ? [225, 175, 60] : null),
  (x, y) => Math.hypot(x - 110, y - 110) < 58 ? 'sprite' : null,
  { sprite: 'keep' });
// 8. A blast frame that legitimately fills the frame edge to edge (NOT strict).
test('blast-fills-frame',
  () => paint((x, y) => { const d = Math.hypot(x - 110, y - 110) / 150;
    return [255 - (d * 120 | 0), 190 - (d * 150 | 0), 60 + (d * 40 | 0)]; }),
  () => 'effect', { effect: 'keep' }, false);
// 9. A full painted scene an admin pasted — nothing may be cut out of it.
test('painted-scene',
  () => paint((x, y) => [40 + ((x * 5 + y * 3) % 120), 60 + ((x * 7) % 100), 90 + ((y * 11) % 90)]),
  () => 'scene', { scene: 'keep' }, false);
// 10. A fading tail: 95% already empty, with a corner of plate left behind.
test('fading-tail-with-corner',
  () => paint((x, y) => (x < 46 && y < 46) ? [22, 26, 40]
    : Math.hypot(x - 110, y - 110) < 22 ? [255, 210, 120] : null),
  (x, y) => (x < 40 && y < 40) ? 'corner' : Math.hypot(x - 110, y - 110) < 18 ? 'spark' : null,
  { corner: 'cut', spark: 'keep' });

// 11. A dark navy inner panel with fine regular detail — "near-neutral" by an
//     ABSOLUTE chroma test, so the chequerboard detector can claim it.
test('navy-panel-detail',
  () => paint((x, y) => {
    const inPack = x >= 50 && x < 170 && y >= 20 && y < 200;
    if (!inPack) return [10, 14, 34];
    const inPanel = x >= 66 && x < 154 && y >= 44 && y < 176;
    if (!inPanel) return [214, 168, 66];
    const star = ((x * 7 + y * 13) % 29) < 2;          // a starry field on dark navy
    return star ? [150, 160, 190] : [16, 24, 52];
  }),
  (x, y) => {
    const inPack = x >= 50 && x < 170 && y >= 20 && y < 200;
    const inPanel = x >= 66 && x < 154 && y >= 44 && y < 176;
    return !inPack ? 'backdrop' : inPanel ? 'panel' : 'foil';
  },
  { panel: 'keep', foil: 'keep', backdrop: 'cut' });
// 12. An already-cut sprite put through the cutter a SECOND time — every
//     generated frame goes through it 2-4 times (generate, store, display,
//     repair), so pass two must be a no-op.
test('second-pass-noop',
  () => paint((x, y) => Math.hypot(x - 110, y - 110) < 62 ? [24, 26, 38] : null),
  (x, y) => Math.hypot(x - 110, y - 110) < 58 ? 'sprite' : null,
  { sprite: 'keep' });

// 13. Scale armour: an already-cut sprite made of TWO CLOSE near-neutral
//     shades on a regular grid. That is what the chequerboard detector looks
//     for, and every frame goes through the cutter more than once.
test('scale-armour-cutout',
  () => paint((x, y) => {
    if (Math.hypot(x - 110, y - 110) >= 66) return null;
    return (((x >> 3) + (y >> 3)) % 2) ? [86, 92, 104] : [66, 72, 84];
  }),
  (x, y) => Math.hypot(x - 110, y - 110) < 60 ? 'armour' : null,
  { armour: 'keep' });
// 14. A pack panel shaded in two close navies on a regular weave, inside gold
//     foil, on a dark backdrop.
test('navy-weave-panel',
  () => paint((x, y) => {
    const inPack = x >= 50 && x < 170 && y >= 20 && y < 200;
    if (!inPack) return [10, 14, 34];
    const inPanel = x >= 66 && x < 154 && y >= 44 && y < 176;
    if (!inPanel) return [214, 168, 66];
    return (((x >> 2) + (y >> 2)) % 2) ? [30, 38, 66] : [16, 24, 52];
  }),
  (x, y) => {
    const inPack = x >= 50 && x < 170 && y >= 20 && y < 200;
    const inPanel = x >= 66 && x < 154 && y >= 44 && y < 176;
    return !inPack ? 'backdrop' : inPanel ? 'panel' : 'foil';
  },
  { panel: 'keep', foil: 'keep', backdrop: 'cut' });

const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of CASES) {
  if (only && c.name !== only) continue;
  let dirty = c.build();
  if (c.name === 'second-pass-noop' || c.name === 'scale-armour-cutout') dirty = await M._stripImageBackground(dirty);   // pass one
  const gentle = await M._stripImageBackground(dirty);
  const left = await M._bgLeftover(gentle, c.strict);
  const out = left ? await M._stripImageBackground(gentle, true) : gentle;
  const got = score(out, c.tagOf);
  const bad = [];
  Object.keys(c.want).forEach(t => {
    const v = got[t] == null ? -1 : got[t];
    if (c.want[t] === 'keep' && v < 90) bad.push(`${t} kept ${v}% (want >=90)`);
    if (c.want[t] === 'cut' && v > 8) bad.push(`${t} kept ${v}% (want <=8)`);
  });
  const finalLeft = await M._bgLeftover(out, c.strict);
  if (c.want.backdrop === 'cut' || c.want.plate === 'cut' || c.want.chequer === 'cut') {
    if (finalLeft) bad.push('verifier still reports: ' + finalLeft);
  }
  const state = Object.entries(got).map(([k, v]) => `${k} ${v}%`).join(', ');
  if (bad.length) { fail++; console.log(`FAIL  ${c.name.padEnd(24)} ${state}\n        ${bad.join('\n        ')}`); }
  else { pass++; console.log(`pass  ${c.name.padEnd(24)} ${state}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
