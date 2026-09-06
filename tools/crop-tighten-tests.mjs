// Regression tests for ✂️ THE CROP'S PIXEL PASSES — what counts as ink, and
// pulling every edge of a crop in to it. Run with:
//     node tools/crop-tighten-tests.mjs            all cases
//     node tools/crop-tighten-tests.mjs <name>     one case
//
// It loads the REAL `_inkThreshold` / `_expandRectToWhitespace` /
// `_trimEdgeTextLines` / `_trimBlankEdges` out of app.js and runs them over
// synthetic pages — a screenshot (paper at 255) and a phone PHOTOGRAPH of the
// same page (paper at 185, with a shadow sloping across it), which is the
// case a fixed ink level reads as solid ink from corner to corner.
//
// EVERY failure here is silent and the question still reaches Vetting with a
// picture on it:
//   too timid  — the crop keeps whatever blank paper the model's rectangle,
//                the margin and the sideways expansion left on it, which on a
//                third-of-a-page figure is most of the picture and reads as a
//                crop somebody made loosely;
//   too greedy — the tighten reaches past the paper into the figure and takes
//                an axis label, a caption or the left column of a table off
//                it. The crop still looks like a perfectly good crop.
//   and a BLANK crop is the third: a white rectangle uploaded into a question
//                looks exactly like a figure somebody has already cropped.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

const M = new Function(
  cut('const INK_RATIO', 'async function _cropBoxFromScreenshot', 'crop pixel passes')
  + '\nreturn { _inkThreshold, _expandRectToWhitespace, _trimEdgeTextLines, _trimBlankEdges,'
  + ' INK_DEFAULT, INK_RATIO, EDGE_INK_MIN, EDGE_SPECK_RUN, MAXRUN_FRAC, RUNS_MIN,'
  + ' RULE_FRAC, RULE_GROUPS };')();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const near = (a, b, tol, what) => ok(Math.abs(a - b) <= tol, what + ' (got ' + a + ', wanted ' + b + '±' + tol + ')');

// ---- a synthetic page ------------------------------------------------------
// `paper` is what the blank page measures: 255 on a screenshot, ~185 on a
// photograph. `slope` tilts it across the sheet the way a desk lamp does.
function page(W, H, { paper = 255, slope = 0 } = {}) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.max(0, Math.min(255, Math.round(paper - slope * (x / W))));
    const i = (y * W + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  }
  const set = (x, y, v) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  };
  const api = {
    W, H, px,
    // A solid block of ink — a figure's body, a rule, a speck.
    rect(x, y, w, h, v = 20) {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, v);
      return api;
    },
    // A line of PRINT: short dark runs with gaps, spanning `w`.
    prose(x, y, w, h, v = 30) {
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) if (xx % 6 < 2) set(xx, yy, v);
      return api;
    },
    ctx: {
      getImageData(x, y, w, h) {
        const d = new Uint8ClampedArray(w * h * 4);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
          const s = ((y + yy) * W + (x + xx)) * 4, t = (yy * w + xx) * 4;
          d[t] = px[s]; d[t + 1] = px[s + 1]; d[t + 2] = px[s + 2]; d[t + 3] = px[s + 3];
        }
        return { data: d };
      }
    }
  };
  return api;
}
const thrOf = p => M._inkThreshold(p.ctx, p.W, p.H, { x: 0, y: 0, w: p.W, h: p.H });

// ---- what counts as ink ----------------------------------------------------

test('a SCREENSHOT still lands on about the old fixed line', () => {
  const p = page(400, 300).rect(150, 120, 60, 40);
  near(thrOf(p), M.INK_DEFAULT, 12, 'the measured line moved off 190 on white paper');
});

test('a PHOTOGRAPH is measured far lower — a fixed 190 reads it as all ink', () => {
  const p = page(400, 300, { paper: 185, slope: 25 }).rect(150, 120, 60, 40);
  const thr = thrOf(p);
  ok(thr < 160, 'the ink line stayed high on grey paper (got ' + thr + ')');
  ok(thr > 60, 'the ink line collapsed and would find no ink at all (got ' + thr + ')');
  // The point of the whole statistic: the paper is NOT ink at the measured line.
  ok(185 - 25 > thr, 'the darkest paper still reads as ink');
});

// ---- pulling the edges in --------------------------------------------------

const tight = (p, r, axes) => M._trimBlankEdges(p.ctx, p.W, p.H, r, thrOf(p), axes);

test('all FOUR edges are pulled in to the figure', () => {
  // A figure at (150,120)-(210,160) inside a rectangle with wide blank sides.
  const p = page(400, 300).rect(150, 120, 60, 40);
  const out = tight(p, { x: 40, y: 60, w: 320, h: 200 }, 'xy');
  ok(out, 'a page with a figure on it came back as blank paper');
  near(out.x, 150, 1, 'the LEFT edge was not pulled in');
  near(out.x + out.w, 210, 1, 'the RIGHT edge was not pulled in');
  near(out.y, 120, 1, 'the top edge was not pulled in');
  near(out.y + out.h, 160, 1, 'the bottom edge was not pulled in');
});

test('the sides alone, and the rows alone', () => {
  const p = page(400, 300).rect(150, 120, 60, 40);
  const r = { x: 40, y: 60, w: 320, h: 200 };
  const x = tight(p, r, 'x');
  near(x.x, 150, 1, "'x' did not move the left edge");
  near(x.y, 60, 0, "'x' moved a row");
  near(x.h, 200, 0, "'x' moved a row");
  const y = tight(p, r, 'y');
  near(y.y, 120, 1, "'y' did not move the top edge");
  near(y.x, 40, 0, "'y' moved a column");
  near(y.w, 320, 0, "'y' moved a column");
});

test('it never eats into the figure — ink on the edge is left alone', () => {
  const p = page(400, 300).rect(0, 0, 400, 300, 40); // ink corner to corner
  const out = tight(p, { x: 0, y: 0, w: 400, h: 300 }, 'xy');
  ok(out, 'a page that is entirely ink came back as blank paper');
  near(out.x, 0, 0, 'the left edge moved into solid ink');
  near(out.y, 0, 0, 'the top edge moved into solid ink');
  near(out.w, 400, 0, 'the right edge moved into solid ink');
  near(out.h, 300, 0, 'the bottom edge moved into solid ink');
});

test('A SPECK IS NOT INK — one stray dark pixel does not defeat the tighten', () => {
  // This is the photograph case: JPEG ringing and dust leave single dark
  // pixels in the margin, and one of them used to keep the whole margin.
  const p = page(400, 300, { paper: 185, slope: 20 }).rect(150, 120, 60, 40);
  p.rect(60, 70, 1, 1, 10);     // a speck up in the top-left blank paper
  p.rect(340, 250, 1, 1, 10);   // and another in the bottom-right
  const out = tight(p, { x: 40, y: 60, w: 320, h: 200 }, 'xy');
  ok(out, 'the tighten refused a page that plainly has a figure on it');
  near(out.x, 150, 2, 'a single speck kept the whole left margin');
  near(out.y, 120, 2, 'a single speck kept the whole top margin');
  near(out.x + out.w, 210, 2, 'a single speck kept the whole right margin');
});

test('…and the two halves of the rule each do their own half', () => {
  // The count floor and the run guard catch different noise, and a real mark
  // has to clear both. Scattered pixels are dust; touching ones are a stroke.
  const scattered = page(400, 300).rect(150, 120, 60, 40);
  scattered.rect(60, 70, 1, 1, 10).rect(64, 70, 1, 1, 10).rect(68, 70, 1, 1, 10);
  const a = tight(scattered, { x: 40, y: 60, w: 320, h: 200 }, 'xy');
  near(a.x, 150, 2, 'three scattered specks were read as a mark');
  near(a.y, 120, 2, 'three scattered specks were read as a mark');

  const touching = page(400, 300).rect(150, 120, 60, 40);
  touching.rect(60, 70, Math.max(M.EDGE_INK_MIN, M.EDGE_SPECK_RUN), 3, 10);
  const b = tight(touching, { x: 40, y: 60, w: 320, h: 200 }, 'xy');
  near(b.x, 60, 2, 'a real mark in the margin was trimmed away as noise');
  near(b.y, 70, 2, 'a real mark in the margin was trimmed away as noise');
});

test('a 1px HAIRLINE is real ink and survives', () => {
  // An axis, a table border and a leader line are all one pixel across at
  // source resolution. Trimming one away takes the frame off a table.
  const p = page(400, 300).rect(150, 120, 60, 40);
  p.rect(80, 70, 1, 180, 10);   // a vertical hairline down the left
  const out = tight(p, { x: 40, y: 60, w: 320, h: 200 }, 'xy');
  near(out.x, 80, 1, 'a 1px vertical rule was trimmed off as noise');
});

test('BLANK PAPER comes back NULL, never as a white rectangle', () => {
  ok(tight(page(400, 300), { x: 40, y: 60, w: 320, h: 200 }, 'xy') === null,
    'an empty region was returned as a crop');
  ok(tight(page(400, 300, { paper: 185, slope: 30 }), { x: 40, y: 60, w: 320, h: 200 }, 'xy') === null,
    'a blank PHOTOGRAPH was returned as a crop');
});

test('a speck-only region is blank paper too', () => {
  const p = page(400, 300);
  p.rect(100, 100, 1, 1, 10); p.rect(250, 200, 1, 1, 10);
  ok(tight(p, { x: 40, y: 60, w: 320, h: 200 }, 'xy') === null,
    'two specks were read as a figure');
});

test('a tainted canvas, or a tiny box, is handed back unchanged', () => {
  const r = { x: 10, y: 10, w: 300, h: 200 };
  const bad = { getImageData() { throw new Error('tainted'); } };
  ok(M._trimBlankEdges(bad, 400, 300, r, 190, 'xy') === r, 'a tainted canvas stopped the crop');
  const p = page(400, 300).rect(0, 0, 400, 300, 40);
  const small = { x: 0, y: 0, w: 10, h: 10 };
  ok(M._trimBlankEdges(p.ctx, p.W, p.H, small, 190, 'xy') === small, 'a tiny box was not handed straight back');
});

// ---- it composes with the passes either side of it -------------------------

test('the sentence above a figure goes, and then its blank paper goes too', () => {
  const p = page(400, 300, { paper: 250 });
  p.prose(30, 70, 340, 6);        // a full-width line of question text
  p.rect(150, 120, 60, 40);       // the figure, well below it
  const thr = thrOf(p);
  let r = { x: 20, y: 60, w: 360, h: 200 };
  r = M._trimBlankEdges(p.ctx, p.W, p.H, r, thr, 'x') || r;
  r = M._trimEdgeTextLines(p.ctx, p.W, p.H, r, thr);
  ok(r.y > 76, 'the sentence was not trimmed off the top (y=' + r.y + ')');
  const out = M._trimBlankEdges(p.ctx, p.W, p.H, r, thr, 'xy');
  near(out.y, 120, 2, 'the paper the sentence left behind was kept');
  near(out.x, 150, 2, 'the blank sides were kept');
  near(out.x + out.w, 210, 2, 'the blank sides were kept');
});

test('the sentence trim now measures against the FIGURE, not the paper', () => {
  // A crop with wide blank sides: the band spans the content but only a third
  // of the untightened rectangle, so `inkW >= w * 0.55` refuses it. Pulling
  // the sides in first is what makes that fraction mean something.
  const p = page(600, 300, { paper: 250 });
  p.prose(240, 70, 120, 6);       // a line of text over a narrow figure
  p.rect(250, 110, 100, 60);
  const thr = thrOf(p);
  const wide = { x: 20, y: 60, w: 560, h: 200 };
  const noPre = M._trimEdgeTextLines(p.ctx, p.W, p.H, wide, thr);
  const pre = M._trimEdgeTextLines(p.ctx, p.W, p.H,
    M._trimBlankEdges(p.ctx, p.W, p.H, wide, thr, 'x'), thr);
  ok(noPre.y <= 76, 'the wide crop unexpectedly trimmed the sentence on its own');
  ok(pre.y > 76, 'tightening the sides first did not let the sentence be found');
});

test('a FRAMED TABLE is still never trimmed, and is still tightened', () => {
  const p = page(400, 300, { paper: 250 });
  for (const y of [110, 125, 140, 155, 170]) p.rect(120, y, 160, 2);  // five full-width rules
  for (const y of [113, 128, 143, 158]) p.prose(124, y, 150, 2);      // and text between them
  const thr = thrOf(p);
  const r = { x: 40, y: 60, w: 320, h: 200 };
  const kept = M._trimEdgeTextLines(p.ctx, p.W, p.H, r, thr);
  ok(kept.y === r.y && kept.h === r.h, 'a framed table was trimmed row by row');
  const out = M._trimBlankEdges(p.ctx, p.W, p.H, kept, thr, 'xy');
  near(out.x, 120, 2, 'the table was not tightened to its own frame');
  near(out.x + out.w, 280, 2, 'the table was not tightened to its own frame');
});

// ---- the census: one door, and it is actually wired in ---------------------

test('_trimEdgeTextLines no longer carries a pull-in of its own', () => {
  const fn = cut('function _trimEdgeTextLines', '\nfunction _trimBlankEdges', 'trim fn');
  ok(fn.indexOf('while (f < l && !inked(f)) f++;') < 0,
    'the blank-paper pull-in is back inside _trimEdgeTextLines — two doors for one job');
  ok(fn.indexOf('_trimBlankEdges') >= 0,
    'nothing in _trimEdgeTextLines points at where the pull-in went');
});

test('the crop really calls it, on both axes, in the right order', () => {
  const fn = cut('async function _cropBoxFromScreenshot', '\n// SECOND-CHANCE CLEANUP', 'crop fn');
  const xAt = fn.indexOf("_trimBlankEdges(pctx, W, H, r, thr, 'x')");
  const trimAt = fn.indexOf('_trimEdgeTextLines(pctx, W, H, r, thr)');
  const xyAt = fn.indexOf("_trimBlankEdges(pctx, W, H, r, thr, 'xy')");
  ok(xAt > 0, 'the sides are not pulled in before the sentence trim');
  ok(trimAt > xAt, 'the sentence trim runs before the sides are pulled in');
  ok(xyAt > trimAt, 'the final tighten does not run after the sentence trim');
  ok(fn.indexOf('if (tight === null) return null;') > 0,
    'a crop that held no ink is still shipped as a white rectangle');
});

test('the whole-page backup is what a refused crop falls to', () => {
  // _cropBoxFromScreenshot returning null must reach the caller's backup, or
  // the block ends up with no picture at all rather than one to crop by hand.
  const fill = cut('async function _fillBlocksFromAiBoxes', '\n// Editor flow', 'fill fn');
  ok(fill.indexOf('if (!crops[i])') >= 0 && fill.indexOf('blk.url = fullUrl;') >= 0,
    'a failed crop no longer falls back to the whole screenshot');
});

// ---- run -------------------------------------------------------------------
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name.indexOf(only) < 0) continue;
  try { c.fn(); pass++; console.log('  ok   ' + c.name); }
  catch (e) { fail++; console.log('  FAIL ' + c.name + '\n       ' + e.message); }
}
console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
