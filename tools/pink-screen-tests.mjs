// Regression tests for THE PINK WALL — the chroma screen keyed off a picture
// that this app did NOT generate. Run with: node tools/pink-screen-tests.mjs
//
// It loads the REAL functions out of app.js and runs them over synthetic
// pictures on a small canvas shim, exactly as tools/chroma-key-tests.mjs does.
//
// Why this file exists: _tcgGenClean keys the screen because it KNOWS which one
// it briefed. A pasted, dropped, uploaded or bundled picture carries no such
// note, so all three screens are tried — and a hero portrait STANDS on the
// bottom of its frame, which buried that edge and made the whole-ring test
// refuse every one of them. Both directions fail silently: too timid and 206
// avatars and portraits go into the game on a bright magenta wall, too eager
// and the key eats a subject that merely happens to contain the hue.
import fs from 'fs';
const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const grab = sig => { const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0; const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } } };
const consts = src.slice(src.indexOf('const TCG_SCREEN_HI'), src.indexOf('function _screenDn'))
  + '\n' + src.slice(src.indexOf('const TCG_SCREEN_RING_MIN'), src.indexOf('async function _screenKeyOut'));
const screens = src.slice(src.indexOf('const TCG_SCREENS = {'), src.indexOf('function tcgScreenForElement'));
const cutConsts = src.slice(src.indexOf("const TCG_SCREENS_TRY"), src.indexOf('// Returns { url, screen } or null.'));
const pieces = [screens, consts, cutConsts,
  grab('function _screenDn'), grab('async function _screenKeyOut'), grab('async function _tcgScreenCut'),grab('async function _tcgTryScreens'),
  grab('function _opaqueArea'), grab('function _tcgSlotStandsOnNothing'), grab('function _tcgStrictBg'),
  grab('function _tcgLiveIndex')].join('\n');

const store = new Map(); let seq = 0;
const mk = (w, h, px) => { const u = 'buf:' + (++seq); store.set(u, { w, h, px }); return u; };
class ImageData { constructor(px, w, h) { this.data = px; this.width = w; this.height = h; } }
const canvas = () => { let W = 0, H = 0, PX = null; return {
  set width(v) { W = v; PX = new Uint8ClampedArray(v * H * 4); }, get width() { return W; },
  set height(v) { H = v; PX = new Uint8ClampedArray(W * v * 4); }, get height() { return H; },
  getContext() { return { drawImage: img => { const b = store.get(img.src); PX.set(b.px); },
    getImageData: () => new ImageData(PX, W, H), putImageData: d => PX.set(d.data) }; },
  toDataURL() { return mk(W, H, PX.slice()); } }; };
global.document = { createElement: canvas };
const _loadImageEl = async u => { const b = store.get(u); return { naturalWidth: b.w, naturalHeight: b.h, width: b.w, height: b.h, src: u }; };
// duel FX slots ask their own shape how strict they are; nothing here is one.
const duelFxParseSlot = () => null;
const M = new Function('_loadImageEl', 'ImageData', 'console', 'duelFxParseSlot', '_tcgArt', '_tcgLiveUrls',
  pieces + '\nreturn {_screenKeyOut,_tcgScreenCut,_tcgSlotStandsOnNothing,_tcgStrictBg,_tcgLiveIndex,TCG_SCREEN_EDGES_MIN};'
)(_loadImageEl, ImageData, { warn() {}, info() {}, log() {} }, duelFxParseSlot, null, null);

const S = 200;
const paint = fn => { const px = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const o = (y * S + x) * 4, c = fn(x, y);
    if (!c) { px[o + 3] = 0; continue; } px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; }
  return mk(S, S, px); };
const scoreOf = (url, tagOf) => { const b = store.get(url), keep = {}, tot = {};
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const t = tagOf(x, y); if (!t) continue;
    tot[t] = (tot[t] || 0) + 1; if (b.px[(y * S + x) * 4 + 3] > 128) keep[t] = (keep[t] || 0) + 1; }
  const o = {}; Object.keys(tot).forEach(t => o[t] = Math.round((keep[t] || 0) / tot[t] * 100)); return o; };

let pass = 0, fail = 0;
const check = (name, got, want) => { const bad = [];
  Object.keys(want).forEach(t => { const v = got[t] == null ? -1 : got[t];
    if (want[t] === 'keep' && v < 90) bad.push(`${t} kept ${v}% (want >=90)`);
    if (want[t] === 'cut' && v > 8) bad.push(`${t} kept ${v}% (want <=8)`); });
  const state = Object.entries(got).map(([k, v]) => `${k} ${v}%`).join(', ');
  if (bad.length) { fail++; console.log(`FAIL  ${name.padEnd(30)} ${state}\n        ${bad.join('\n        ')}`); }
  else { pass++; console.log(`pass  ${name.padEnd(30)} ${state}`); } };
const is = (name, got, want) => { if (got === want) { pass++; console.log(`pass  ${name.padEnd(30)} ${JSON.stringify(got)}`); }
  else { fail++; console.log(`FAIL  ${name.padEnd(30)} got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };

// A hero portrait: a figure from the knees up, standing ON the bottom edge, in
// front of a wall. Top and both sides are pure screen; the bottom edge is boots
// and cloak. This is the shape of all five bundled hero portraits and the ring
// lands near 80%, which is why every one of them still had its wall.
// A warm brown, deliberately far from all three screens: magenta, green and
// blue all score negative on it, so it is subject under every one of them.
const SKIN = [120, 84, 52];
const stander = (wall, body) => paint((x, y) => {
  const torso = x >= 62 && x < 138 && y >= 58;            // down to the frame edge
  const head = Math.hypot(x - 100, y - 42) < 26;
  return torso || head ? (body || SKIN) : wall;
});
{
  const u = stander([250, 4, 250]);
  const out = await M._screenKeyOut(u, 'magenta', true, false);
  is('standing figure keys', !!out, true);
  if (out) check('standing figure', scoreOf(out, (x, y) => {
    const body = x >= 62 && x < 138 && y >= 58, head = Math.hypot(x - 100, y - 42) < 26;
    return body || head ? 'figure' : 'wall'; }), { figure: 'keep', wall: 'cut' });
}
// The same rule must not become a licence. ONE clean edge is not a wall: this
// is a picture whose LEFT half happens to be magenta and nothing more.
{
  const u = paint((x, y) => x < S * 0.45 ? [250, 4, 250] : [64, 52, 96]);
  is('half-magenta picture refused', await M._screenKeyOut(u, 'magenta', true, false), null);
}
// Two clean edges is not three. A subject wedged into one corner leaves the top
// and the left clean and is still not evidence of a studio wall.
{
  const u = paint((x, y) => (x > 70 && y > 70) ? [64, 52, 96] : [250, 4, 250]);
  is('two clean edges refused', await M._screenKeyOut(u, 'magenta', true, false), null);
  is('EDGES_MIN is three', M.TCG_SCREEN_EDGES_MIN, 3);
}

// ---- _tcgScreenCut: which of the three walls was it? -----------------------
for (const [name, rgb] of [['magenta', [250, 4, 250]], ['green', [3, 249, 4]], ['blue', [0, 2, 246]]]) {
  const got = await M._tcgScreenCut(stander(rgb), true);
  is('finds the ' + name + ' wall', got && got.screen, name);
}
// A picture with no wall at all is handed back untouched, so the caller falls
// through to the ordinary knock-out rather than to a hole.
{
  const u = paint((x, y) => [18, 24, 52]);
  is('no wall -> null', await M._tcgScreenCut(u, true), null);
}
// Card art keeps its painted scene: a full-bleed dark scene is not a wall.
{
  const u = paint((x, y) => [(x * 255 / S) | 0, 40, 90]);
  is('painted scene -> null', await M._tcgScreenCut(u, true), null);
}
// The keep-guard. A frame that is ALL wall has no subject to save, and keying
// it would leave nothing at all — the one failure a background remover can
// produce that looks perfectly tidy.
{
  const u = paint(() => [250, 4, 250]);
  is('all-wall refused', await M._tcgScreenCut(u, true), null);
}
// The documented limit, pinned so it stays a REFUSAL rather than a hole: a
// subject painted in a shade that leans towards its own screen cannot be told
// apart from it by any colour test. The defence is the per-element screen
// routing and the prompt; what must never happen is the picture coming back
// half transparent.
{
  const got = await M._tcgScreenCut(stander([0, 2, 246], [64, 52, 96]), true);
  is('subject leaning to the screen refused', got, null);
}

// THE GUARD THAT MATTERS MOST. `_screenDn` asks "is this pixel that HUE", so a
// VIOLET monster shot on a MAGENTA wall scores as wall and is eaten alive —
// and the bundled set is full of them, because every psychic, shadow and
// cosmic card was shot on magenta although tcgScreenForElement routes exactly
// those elements to a green screen. A half-dissolved sprite is far worse than
// a visible wall: nothing on screen says it happened.
{
  const VIOLET = [190, 40, 220];   // screen-ness 0.68 against magenta: reads as wall
  const got = await M._tcgScreenCut(stander([250, 4, 250], VIOLET), true);
  is('violet subject on magenta refused', got, null);
}
// …and the same subject on a GREEN wall, which its palette does not contain,
// keys perfectly. That pins the refusal above as being about the CLASH and not
// about violet.
{
  const got = await M._tcgScreenCut(stander([3, 249, 4], [190, 40, 220]), true);
  is('violet subject on green keys', got && got.screen, 'green');
}
// A picture that is already a cut-out has no border left to judge, and an
// empty border pixel used to count as PROOF of a wall — so any sprite whose
// own paint held enough of a screen hue passed every precondition and was
// keyed. That is how an already-transparent blue dragon came back holed.
{
  const u = paint((x, y) => Math.hypot(x - 100, y - 100) < 70 ? [40, 60, 230] : null);
  is('already a cut-out is left alone', await M._tcgScreenCut(u, true), null);
}

// ---- which stored urls may be keyed ---------------------------------------
{
  const std = M._tcgSlotStandsOnNothing;
  is('avatar stands on nothing', std('c001:av'), true);
  is('hero stands on nothing', std('hero:warden'), true);
  is('artifact stands on nothing', std('arti:ironpin'), true);
  is('card art keeps its scene', std('c001'), false);
  is('set banner keeps its scene', std('set:nd'), false);
  is('lore plate keeps its scene', std('lore:one:c1'), false);
}
{
  // tcgArtUrl falls back to the avatar and tcgAvatarUrl falls back to the card
  // art, so ONE picture can legitimately be doing both jobs — and keying it
  // would strip the painted scene off a card face.
  const art = { 'c001': 'A', 'c001:av': 'B', 'c002': 'C', 'c002:av': 'C', 'hero:w': 'D' };
  const idx = new Function('_tcgArt', 'let _tcgLiveUrls; ' + grab('function _tcgSlotStandsOnNothing')
    + grab('function _tcgStrictBg') + grab('function _tcgLiveIndex')
    + '\nreturn _tcgLiveIndex();')(art);
  is('avatar is keyable', idx.has('B'), true);
  is('hero is keyable', idx.has('D'), true);
  is('card art is never keyed', idx.has('A'), false);
  is('shared picture is never keyed', idx.has('C'), false);
  is('avatars are cut strictly', idx.get('B'), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
