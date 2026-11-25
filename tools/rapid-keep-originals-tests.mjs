// 🖼 ⚡ Rapid add keeps a CLEAN source's original pixels (v1.463.0). Loads the
// SHIPPED helpers and `_fillBlocksFromAiBoxes` out of app.js into a sandbox,
// stubs the image model and counts its calls.
//   node tools/rapid-keep-originals-tests.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b) + '\n';
};
const fnText = (name) => {
  const a = src.search(new RegExp('(?:async )?function ' + name + '\\('));
  const b = src.indexOf('\n}', a);
  if (a < 0 || b < 0) throw new Error('missing ' + name);
  return src.slice(a, b + 2) + '\n';
};
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); } };

const H = { redraws: 0, ready: true, redrawUrl: 'data:image/png;base64,REDRAW', measure: {} };
const sandbox = { console, Math, JSON, Promise, Array, Object, String, Number, Float32Array, H, document: { createElement: () => null, getElementById: () => null } };
vm.createContext(sandbox);
vm.runInContext(`
var _imgEnhanceState = {};
var _BW_ENHANCE_PROMPT = 'enhance';
var seq = 0;
function imageAiReady() { return H.ready; }
async function _cropBoxFromScreenshotEx(full, box) { return { dataUrl: 'data:image/png;base64,CROP' + box[0] }; }
async function _aiRefineCrop(v) { return v; }
function decisionsGateOn() { return false; }
function _canAuthor() { return true; }
async function generateCleanEnhancedImage() { H.redraws++; return H.redrawUrl; }
async function uploadImageDataUrl(v) { return 'https://img.test/' + (++seq); }
async function _loadImageEl() { throw new Error('no canvas here'); }
` + cut('const RAPID_KEEP_CLEAN_ORIGINALS', 'async function _rapidPrepFile(file) {', 'keep-originals block')
  + fnText('_rapidFigureMap') + fnText('_rememberCropSource')
  + cut('async function _fillBlocksFromAiBoxes', '\n// Editor flow', 'fill fn') + `
// The canvas is a browser thing: measurement is stubbed by URL.
_rapidMeasurePixels = async (u) => H.measure[u] || null;
`, sandbox);
const S = (code) => vm.runInContext(code, sandbox);

console.log('Decision: _rapidSourceIsClean');
const clean = S('_rapidSourceIsClean');
const screenshot = { white: 0.82, mid: 0.03, paperChroma: 0.5, n: 1000 };
const photo = { white: 0.04, mid: 0.7, paperChroma: 9, n: 1000 };
ok('a white PNG screenshot is clean', clean({ mime: 'image/png', width: 1200, height: 900, pixelStats: screenshot }) === true);
ok('a JPEG is poor (a camera writes JPEG)', clean({ mime: 'image/jpeg', width: 1200, height: 900, pixelStats: screenshot }) === false);
ok('a shrunk phone photo is poor whatever it measures', clean({ mime: 'image/png', photo: true, pixelStats: screenshot }) === false);
ok('a grey-paper PNG is poor', clean({ mime: 'image/png', width: 900, height: 900, pixelStats: photo }) === false);
ok('a yellow-cast PNG is poor', clean({ mime: 'image/png', width: 900, height: 900, pixelStats: { ...screenshot, paperChroma: 30 } }) === false);
ok('too many mid-greys is poor', clean({ mime: 'image/png', width: 900, height: 900, pixelStats: { ...screenshot, mid: 0.2 } }) === false);
ok('unmeasured PNG is poor (unsure → redraw, as before)', clean({ mime: 'image/png', width: 900, height: 900 }) === false);
ok('a rendered PDF page (JPEG) is clean', clean({ isPdfPage: true, mime: 'image/jpeg', pixelStats: { ...screenshot, white: 0.6 } }) === true);
ok('a rendered PDF page that cannot be measured is clean', clean({ isPdfPage: true, mime: 'image/jpeg' }) === true);
ok('a SCANNED PDF page (grey paper) is poor', clean({ isPdfPage: true, mime: 'image/jpeg', pixelStats: photo }) === false);
ok('no facts at all is poor', clean(null) === false);

console.log('Pixel stats: _rapidPixelStats');
const px = (rgb, count) => { const a = []; for (let i = 0; i < count; i++) a.push(rgb[0], rgb[1], rgb[2], 255); return a; };
const shot = S('_rapidPixelStats')(px([255, 255, 255], 90).concat(px([0, 0, 0], 10)), 10, 10);
ok('screenshot pixels measure white and inky', Math.abs(shot.white - 0.9) < 1e-9 && shot.mid === 0 && shot.paperChroma === 0);
const paper = S('_rapidPixelStats')(px([190, 186, 176], 100), 10, 10);
ok('photo paper measures as mid-grey, no white', paper.white === 0 && paper.mid === 1);
ok('a coloured fill is not counted as grey paper', S('_rapidPixelStats')(px([40, 120, 230], 100), 10, 10).mid === 0);
ok('screenshot stats → clean, photo stats → poor', clean({ mime: 'image/png', width: 10 * 100, height: 1000, pixelStats: shot }) && !clean({ mime: 'image/png', width: 1000, height: 1000, pixelStats: paper }));

console.log('Faithfulness: _rapidRedrawLooksFaithful');
const faith = S('_rapidRedrawLooksFaithful');
const grid = (on) => Array.from({ length: 256 }, (_, i) => on.includes(i) ? 1 : 0);
const A = { w: 400, h: 300, ink: grid([1, 2, 3, 17, 18, 19, 40, 41]) };
ok('same shape, same ink → faithful', faith(A, { w: 800, h: 600, ink: grid([1, 2, 3, 17, 18, 19, 40]) }));
ok('reshaped redraw → not faithful', !faith(A, { w: 300, h: 400, ink: A.ink }));
ok('ink moved elsewhere → not faithful', !faith(A, { w: 400, h: 300, ink: grid([200, 201, 202, 220, 221, 222, 240, 241]) }));
ok('unmeasurable → faithful (behave as today)', faith(null, A));

console.log('Pipeline: _fillBlocksFromAiBoxes');
const run = async (opts) => {
  H.redraws = 0;
  const blks = [{ id: 'a', type: 'image' }, { id: 'b', type: 'image' }];
  const n = await sandbox._fillBlocksFromAiBoxes(blks, [[100, 0, 500, 500], [600, 0, 900, 900]], 'image/png', 'PAGE', null,
    Object.assign({ decisions: false, getSourcePageUrl: async () => 'https://img.test/page' }, opts));
  return { n, blks };
};
let r = await run({ keepOriginals: true, checkRedraw: true });
ok('clean source: both figures filled', r.n === 2);
ok('clean source: NO image-model call', H.redraws === 0, 'redraws=' + H.redraws);
ok('clean source: each figure says why it was kept', r.blks.every(b => b.figureKept === 'clean-source'));
ok('clean source: Enhance/Touch-up state still seeded with the crop + original', r.blks.every(b => S('_imgEnhanceState')[b.id] && S('_imgEnhanceState')[b.id].currentDataUrl.startsWith('data:image/png;base64,CROP') && S('_imgEnhanceState')[b.id].originalUrl === 'https://img.test/page'));
ok('clean source: crop provenance kept', r.blks.every(b => b.cropSource && b.cropSource.url === 'https://img.test/page' && Array.isArray(b.cropSource.box_2d)));

r = await run({ keepOriginals: false, checkRedraw: true });
ok('poor source: every figure redrawn (one call each)', H.redraws === 2, 'redraws=' + H.redraws);
ok('poor source: the redraw is what is shown', r.blks.every(b => S('_imgEnhanceState')[b.id].currentDataUrl === H.redrawUrl && !b.figureKept));

H.measure['data:image/png;base64,CROP100'] = { width: 400, height: 300, cw: 2, ch: 1, px: [0, 0, 0, 255, 255, 255, 255, 255] };
H.measure[H.redrawUrl] = { width: 300, height: 400, cw: 1, ch: 2, px: [0, 0, 0, 255, 255, 255, 255, 255] };
r = await run({ keepOriginals: false, checkRedraw: true });
ok('poor source, reshaped redraw → the crop is kept instead', r.blks[0].figureKept === 'redraw-unfaithful' && S('_imgEnhanceState').a.currentDataUrl === 'data:image/png;base64,CROP100');
H.measure = {};

r = await run({});
ok('editor route (no keepOriginals) still redraws', H.redraws === 2 && r.blks.every(b => !b.figureKept));

H.ready = false; r = await run({ keepOriginals: true }); H.ready = true;
ok('no image model + clean source: still kept and filled', r.n === 2 && H.redraws === 0);

console.log('Job entry: _rapidKeepOriginals');
const keep = S('_rapidKeepOriginals');
H.measure['data:image/png;base64,P'] = { width: 1200, height: 900, stats: screenshot };
H.measure['data:image/jpeg;base64,J'] = { width: 1200, height: 900, stats: photo };
ok('a measured clean screenshot is kept', await keep({ type: 'image/png' }, 'P', {}) === true);
ok('the same screenshot via the photo shrink is redrawn', await keep({ type: 'image/png' }, 'P', { photoShrunk: true }) === false);
ok('a file the photo shrink marked is redrawn', await keep({ type: 'image/png', rapidPhotoShrunk: true }, 'P', {}) === false);
ok('a PDF page whose pixels look like a photo is redrawn', await keep({ type: 'image/jpeg' }, 'J', { pdfPage: true }) === false);
ok('a PDF page that cannot be measured is kept', await keep({ type: 'image/jpeg' }, 'X', { pdfPage: true }) === true);
H.measure = {};

console.log('Wiring');
const job = cut('async function processRapidJob', '\n// ', 'processRapidJob');
ok('processRapidJob asks _rapidKeepOriginals (typeof-guarded)', /typeof _rapidKeepOriginals === 'function'/.test(job));
ok('processRapidJob hands keepOriginals + checkRedraw to the crop pipeline', /keepOriginals: keepClean, checkRedraw: true/.test(job));
ok('the whole-page fallback skips the redraw for a clean source', /!many && imageAiReady\(\) && !keepClean/.test(job));
ok('a PDF page is marked pdfPage when it is queued', /pdfPage: true/.test(cut('async function _rapidExpandPdf', '\n}\n', 'expand')));
ok('a shrunk photo is marked photoShrunk', /out\.rapidPhotoShrunk = true/.test(cut('async function _rapidPrepFile', '\n}\n', 'prep')));
ok('the switch is on', S('RAPID_KEEP_CLEAN_ORIGINALS') === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
