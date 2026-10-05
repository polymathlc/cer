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

const APP = new URL('../app.js', import.meta.url);
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
  + ' RULE_FRAC, RULE_GROUPS, STRONG_BAND, TRIM_BANDS_MAX };')();

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

test('label expansion crosses gaps between letters on BOTH sides', () => {
  for (const gap of [3, 6]) for (const mirror of [false, true]) {
    const p = page(600, 400).rect(mirror ? 280 : 210, 140, 110, 80);
    let end;
    for (let x = 365; x < 420; x += 3 + gap) {
      p.rect(mirror ? 600 - x - 3 : x, 160, 3, 10);
      end = x + 3;
    }
    const initial = { x: mirror ? 216 : 180, y: 110, w: 204, h: 160 };
    const expanded = M._expandRectToWhitespace(p.ctx, p.W, p.H, initial, thrOf(p));
    const out = tight(p, expanded, 'xy');
    ok(out, 'a figure with a label was refused');
    if (mirror) near(out.x, 600 - end, 1, 'the left label stopped between letters');
    else near(out.x + out.w, end, 1, 'the right label stopped between letters');
  }
});

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

// ---- PAST THE TABLE (v1.425.0) ----------------------------------------------
// The reported crop: a table filed with the end of the previous question, its
// answer line and the stem above it, and part (a), (i), its answer line and
// (ii) below it. The four-rule guard used to stand down on the whole crop
// because the TABLE had four rules, so none of it came off.
const fullTrim = (p, r) => {
  const thr = thrOf(p);
  r = M._trimBlankEdges(p.ctx, p.W, p.H, r, thr, 'x') || r;
  r = M._trimEdgeTextLines(p.ctx, p.W, p.H, r, thr);
  return M._trimBlankEdges(p.ctx, p.W, p.H, r, thr, 'xy');
};
function borderedTable(p, x0, y0, x1, rows, pitch) {
  for (let k = 0; k <= rows; k++) p.rect(x0, y0 + k * pitch, x1 - x0, 2);           // horizontal rules
  for (const x of [x0, x0 + 120, x0 + 250, x0 + 380, x1 - 2]) p.rect(x, y0, 2, rows * pitch + 2); // vertical rules
  for (let k = 0; k < rows; k++) p.prose(x0 + 10, y0 + k * pitch + 12, x1 - x0 - 20, 8); // a row of cells
  return y0 + rows * pitch + 2;
}
function reportedPage() {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 40, 640, 10);                                   // "…equipment?  [1]" — the previous question
  p.rect(80, 85, 600, 2);                                     // its answer line
  p.prose(30, 130, 600, 10);                                  // "The table shows three different substances…"
  const tableBottom = borderedTable(p, 100, 160, 600, 4, 35); // the table itself
  p.prose(30, 320, 620, 10);                                  // "(a) State the physical state…"
  p.prose(70, 345, 120, 10).prose(640, 345, 25, 10);          // "(i) Substance 1          [2]"
  p.rect(70, 395, 600, 2);                                    // its answer line
  p.prose(70, 420, 120, 10).prose(640, 420, 25, 10);          // "(ii) Substance 2         [2]"
  return { p, tableBottom };
}

test('THE REPORTED CROP: stem, parts, marks and answer lines all come off a table', () => {
  const { p, tableBottom } = reportedPage();
  const out = fullTrim(p, { x: 20, y: 30, w: 670, h: 410 });
  ok(out, 'the table came back as blank paper');
  near(out.y, 160, 2, 'the stem / the previous question was left on top of the table');
  near(out.y + out.h, tableBottom, 2, 'the lettered parts and answer lines were left under the table');
  near(out.x, 100, 2, 'the crop is wider than the table on the left');
  near(out.x + out.w, 600, 2, 'the crop is wider than the table on the right');
});

test('…and a SHORT part line that sticks out past the table is wording too', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 130, 600, 10);
  const tableBottom = borderedTable(p, 100, 160, 600, 4, 35);
  p.prose(70, 330, 120, 10);                                  // "(ii) Substance 2" — narrow, but it starts left of the table
  const out = fullTrim(p, { x: 20, y: 120, w: 670, h: 230 });
  near(out.y + out.h, tableBottom, 2, 'a short part line under the table was kept');
});

test('the table itself is never eaten — every row, both borders', () => {
  const { p } = reportedPage();
  const out = fullTrim(p, { x: 20, y: 150, w: 670, h: 170 });   // a crop that is ONLY the table
  near(out.y, 160, 2, 'the top border came off');
  near(out.y + out.h, 302, 2, 'the bottom border came off');
});

test('a table ruled with HORIZONTAL lines only is still never eaten row by row', () => {
  // No vertical borders, so every rule and every row is its own band and none
  // of them is a figure body: the four-rule guard must still stand down.
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 100, 600, 10);
  for (let k = 0; k <= 4; k++) p.rect(100, 140 + k * 40, 500, 2);
  for (let k = 0; k < 4; k++) p.prose(110, 140 + k * 40 + 16, 480, 8);
  const r = { x: 20, y: 90, w: 670, h: 260 };
  const kept = M._trimEdgeTextLines(p.ctx, p.W, p.H, r, thrOf(p));
  ok(kept.y === r.y && kept.h === r.h, 'a horizontally-ruled table was trimmed');
});

test('a THREE-LINE table keeps its top rule; only the stem above it goes', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 100, 600, 10);                                  // the stem
  p.rect(100, 140, 500, 2);                                   // top rule
  p.prose(110, 148, 480, 8);                                  // header row
  p.rect(100, 162, 500, 2);                                   // mid rule
  for (let k = 0; k < 4; k++) p.prose(110, 172 + k * 22, 480, 8);
  p.rect(100, 262, 500, 2);                                   // bottom rule
  const out = fullTrim(p, { x: 20, y: 90, w: 670, h: 190 });
  ok(out.y > 112 && out.y <= 140, 'the stem stayed, or the top rule went (y=' + out.y + ')');
  ok(out.y + out.h >= 263, 'the bottom rule went');
});

test('a lone stroke above a drawing is part of the drawing, not an answer line', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(150, 150, 400, 2);                                   // e.g. a water surface, well above the rest
  p.rect(250, 230, 200, 140);                                 // the drawing
  const out = fullTrim(p, { x: 100, y: 100, w: 500, h: 300 });
  near(out.y, 150, 2, 'a stroke belonging to the figure was trimmed as an answer line');
});

test('an answer line on its own beside a figure, with no print, is left alone', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(250, 150, 200, 140);                                 // the drawing
  p.rect(150, 330, 400, 2);                                   // a line below it — nothing to say it is an answer line
  const out = fullTrim(p, { x: 100, y: 100, w: 500, h: 260 });
  near(out.y + out.h, 332, 2, 'a lone line below a figure was trimmed without any print beside it');
});

test('a caption inside the figure\'s width ("Diagram 1") survives under it', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(200, 150, 300, 160);                                 // the drawing
  p.prose(310, 330, 80, 10);                                  // "Diagram 1", centred under it
  const out = fullTrim(p, { x: 100, y: 100, w: 500, h: 260 });
  near(out.y + out.h, 340, 2, 'the caption under the figure was trimmed');
});

test('with NO figure body, a loose crop is trimmed exactly as before (3 lines, 20%)', () => {
  // A borderless list of words in rows: nothing in it is a figure body, so
  // the old caps hold and it is never eaten wholesale.
  const p = page(700, 1000, { paper: 250 });
  for (let k = 0; k < 8; k++) p.prose(100, 100 + k * 30, 500, 10);
  const r = { x: 90, y: 90, w: 520, h: 250 };
  const out = M._trimEdgeTextLines(p.ctx, p.W, p.H, r, thrOf(p));
  ok(out.h >= r.h * 0.5, 'a borderless block of rows was eaten past the old 50% floor');
});

test('the worker carries the SAME trim, byte for byte', () => {
  const worker = fs.readFileSync(new URL('../rapid-import/functions/crop.js', import.meta.url), 'utf8');
  const pick = (text, from, to) => { const a = text.indexOf(from), b = text.indexOf(to, a); return a >= 0 && b > a ? text.slice(a, b) : null; };
  const mine = pick(src, 'const MAXRUN_FRAC', '// ---- AND THEN THE BLANK PAPER ITSELF');
  const theirs = pick(worker, 'const MAXRUN_FRAC', '// ---- AND THEN THE BLANK PAPER ITSELF');
  ok(mine && theirs, 'the trim was not found in one of the two files');
  ok(mine === theirs, 'app.js and rapid-import/functions/crop.js have drifted apart — a PDF import and a pasted screenshot would crop differently');
  const wordA = pick(src, 'const CROP_WORDING_CHARS', 'async function _aiRefineCrop');
  const wordB = pick(worker, 'export const CROP_WORDING_CHARS', '// The prompt the clean-up pass');
  ok(wordA && wordB && wordA.replace(/^const /, '').replace('function _cropWordingOf', 'function cropWordingOf').trim()
    === wordB.replace(/^export const /, '').replace('export function cropWordingOf', 'function cropWordingOf').trim(),
    'the two lists of the question\'s typed wording have drifted apart');
});

test('the clean-up pass is handed the question\'s own wording, at every crop', () => {
  const fill = cut('async function _fillBlocksFromAiBoxes', '\n// Editor flow', 'fill fn');
  ok(fill.indexOf('_aiRefineCrop(c, opts && opts.wording, src)') >= 0, 'the wording never reaches the clean-up pass');
  ok(fill.indexOf('_jevGateFigures(gateItems, mimeType, b64, fullDataUrl, onStatus, opts && opts.wording)') >= 0,
    'the Jev re-cut is not handed the wording, so its clean-up puts the stem straight back');
  const calls = src.split('_fillBlocksFromAiBoxes(').length - 2;  // minus the definition
  const withWording = (src.match(/_fillBlocksFromAiBoxes\((?:(?!_fillBlocksFromAiBoxes\()[\s\S]){0,400}?wording: _cropWordingOf\(/g) || []).length;
  ok(calls >= 4 && withWording === calls, 'a crop path calls the clean-up without the question\'s wording (' + withWording + ' of ' + calls + ')');
  const refine = cut('async function _aiRefineCrop(', '\n// =====', 'refine');
  ok(/ALREADY TYPED in the question/.test(refine), 'the clean-up prompt never mentions the typed wording');
  ok(/TABLE runs from its top border to its bottom border/.test(refine), 'the clean-up prompt has no table rule');
});

// Every argument list of every call, read with brackets and strings respected.
function callArgs(text, name) {
  const calls = [];
  let at = 0;
  while ((at = text.indexOf(name + '(', at)) >= 0) {
    const isDef = /function\s+$/.test(text.slice(Math.max(0, at - 20), at));
    let i = at + name.length + 1, depth = 0, cur = '', q = null;
    const args = [];
    for (; i < text.length; i++) {
      const ch = text[i];
      if (q) { cur += ch; if (ch === '\\') { cur += text[++i]; continue; } if (ch === q) q = null; continue; }
      if (ch === '\'' || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) { if (!depth) break; depth--; }
      if (ch === ',' && !depth) { args.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) args.push(cur.trim());
    if (!isDef) calls.push({ at, args, line: text.slice(0, at).split('\n').length });
    at = i;
  }
  return calls;
}

test('CENSUS: every clean-up call is handed the wording AND the page', () => {
  const calls = callArgs(src, '_aiRefineCrop');
  ok(calls.length >= 3, 'the clean-up calls were not found (' + calls.length + ')');
  const empty = /^(?:undefined|null|''|""|``)?$/;
  for (const c of calls) {
    ok(c.args.length >= 2 && !empty.test(c.args[1]),
      'app.js:' + c.line + ' calls the clean-up without the question\'s wording — it then cuts the stem as figure, or the figure as stem');
    ok(c.args.length >= 3 && !empty.test(c.args[2]),
      'app.js:' + c.line + ' calls the clean-up without the page — its cut keeps the first cut\'s measurements and a second white frame');
  }
  const recrop = cut('async function autoChkRecrop', '\n// ---- the loop', 'autoChkRecrop');
  ok(/_aiRefineCrop\(dataUrl, _cropWordingOf\(q\.blocks\)/.test(recrop), 'the auto-check re-cut is cleaned without the question\'s wording');
  const gate = cut('async function _jevGateFigures', '\n// The question as a whole', 'gate');
  ok(/_aiRefineCrop\(ex2\.dataUrl, wording, src\)/.test(gate), 'the Jev re-cut is never cleaned up');
  ok(/_jevFigureFacts\(i, ex2, false\)/.test(gate) && /_jevFigureFacts\(i, it\.ex, false\)/.test(gate),
    'a clean-up that worked is reported to Jev as stray text, which sends every cleaned crop round the re-cut loop');
});

test('the clean-up keeps a figure\'s own words — in both copies of the prompt', () => {
  const worker = fs.readFileSync(new URL('../rapid-import/functions/crop.js', import.meta.url), 'utf8');
  const browser = cut('async function _aiRefineCrop(', '\n// =====', 'refine');
  const prompt = worker.slice(worker.indexOf('export function refinePrompt'), worker.indexOf('export function subCrop'));
  for (const [who, text] of [['app.js', browser], ['crop.js', prompt]]) {
    ok(/sits OUTSIDE the figure is stray text/.test(text), who + ': the rule for whole lines outside the figure is missing');
    ok(/belongs to the figure even if the same word is in the list above: keep it/.test(text),
      who + ': nothing tells the clean-up that a label INSIDE the figure stays, so a table loses its row headings');
    ok(/row or column heading, a table cell/.test(text) && /\(A\) \(B\) \(C\) \(D\) label of a picture option/.test(text),
      who + ': the clause no longer names table headings, cells and picture-option labels');
    ok(!/none of them may stay in the picture/.test(text), who + ': the old blanket rule (cut every listed word) is back');
  }
});

test('the typed wording lists sentences, never an MCQ\'s options, and never drops a later line', () => {
  const W = new Function(cut('const CROP_WORDING_CHARS', 'async function _aiRefineCrop', 'wording')
    + '\nreturn { _cropWordingOf, CROP_WORDING_CHARS };')();
  const w = W._cropWordingOf([
    { type: 'text', content: '<p>The table shows the <b>state</b> of three substances.</p>' },
    { type: ' MCQ ', question: 'Which substance is a liquid at room temperature?', options: [{ text: 'Substance 1' }, 'liquid', { content: 'a gas and a liquid' }] },
    { type: 'text', text: '(a)' }, { type: 'text', text: 'Substance 2' }, { type: 'part', text: '(i) Substance 1' }]);
  ok(w === '- The table shows the state of three substances.\n- Which substance is a liquid at room temperature?\n- (i) Substance 1',
    'the list is not what was expected:\n' + w);
  ok(!/a gas and a liquid|\n- liquid/.test(w), 'an MCQ option reached the list');
  const stem = ('The mass of each substance was measured every minute and recorded. '.repeat(40)).trim();
  const long = W._cropWordingOf([{ type: 'text', text: stem },
    { type: 'text', text: '(b) Explain why the mass of the beaker fell over the ten minutes.' }]);
  ok(long.length <= W.CROP_WORDING_CHARS, 'over budget: ' + long.length);
  ok(/…\n- \(b\) Explain why the mass of the beaker fell over the ten minutes\.$/.test(long),
    'a stem over the whole budget pushed the part line under the table off the list (or clipped it)');
  const head = long.split('\n')[0].slice(2, -1);
  ok(stem.startsWith(head) && /[\s,;:]/.test(stem[head.length]), 'the long line was not clipped on a word: …' + head.slice(-20));
  // Everything that fits is listed whole, in order.
  const fits = W._cropWordingOf([{ type: 'text', text: 'one two three' }, { type: 'text', text: 'four five six' }]);
  ok(fits === '- one two three\n- four five six', 'a list that fits was changed: ' + fits);
});

// ---- the clean-up is cut from the PAGE, in the browser too ------------------
// The REAL _cropBoxFromScreenshotEx / _cropRefineOnPage / _aiRefineCrop, run
// over a synthetic page with a stand-in canvas that records what was drawn.
const { measureCrop } = await import(new URL('../jev-review-core.mjs', import.meta.url));
function browserCrop(p) {
  const reg = new Map(), PAGE = 'data:image/png;base64,PAGE';
  let n = 0;
  const document = { createElement: () => {
    const c = { width: 0, height: 0, drawn: null };
    c.getContext = () => ({
      drawImage: (img, ...a) => { c.drawn = { img, a }; },
      getImageData: (...a) => c.drawn.img.page.ctx.getImageData(...a),
      fillRect() {}
    });
    c.toDataURL = () => { const u = 'data:image/png;base64,CUT' + (++n); reg.set(u, c); return u; };
    return c;
  } };
  const _loadImageEl = async url => url === PAGE ? { naturalWidth: p.W, naturalHeight: p.H, page: p }
    : { naturalWidth: reg.get(url).width, naturalHeight: reg.get(url).height };
  const ai = { prompts: [], reply: null };
  const askGeminiVision = async prompt => { ai.prompts.push(prompt); return ai.reply; };
  const B = new Function('document', '_loadImageEl', 'measureCrop', 'askGeminiVision', '_parseAIJson', 'console',
    cut('const INK_RATIO', '\n// SECOND-CHANCE CLEANUP', 'browser crop')
    + cut('const CROP_WORDING_CHARS', '\n// =====', 'browser refine')
    + '\nreturn { _cropBoxFromScreenshotEx, _aiRefineCrop };')(
    document, _loadImageEl, measureCrop, askGeminiVision, v => v, { warn() {} });
  return { ...B, reg, ai, PAGE };
}
test('the browser clean-up is cut from the PAGE, re-measured, and refused when it cuts into the figure', async () => {
  const p = page(700, 700);
  p.rect(150, 60, 400, 40);                                          // a block above, then a clear gap
  for (const y of [200, 260, 320, 380]) p.rect(150, y, 400, 4);      // a bordered table
  for (const x of [150, 250, 350, 450, 546]) p.rect(x, 200, 4, 184);
  const B = browserCrop(p);
  const ex = await B._cropBoxFromScreenshotEx(B.PAGE, [60, 190, 580, 820]);
  ok(ex && ex.scale >= 1 && ex.pad >= 16 && ex.thr > 0, 'the crop does not carry what maps it back to the page');
  ok(ex.rect.y < 80 && ex.rect.y + ex.rect.h >= 380 && !ex.measure.clipped.length, 'the first cut is not the block and the table');
  const onCrop = (y0, y1) => [Math.round((ex.pad + (y0 - ex.rect.y) * ex.scale) / ex.height * 1000), Math.round(ex.pad / ex.width * 1000),
    Math.round((ex.pad + (y1 - ex.rect.y) * ex.scale) / ex.height * 1000), Math.round((ex.width - ex.pad) / ex.width * 1000)];
  // Removing the block above the gap: kept.
  B.ai.reply = { clean: false, box_2d: onCrop(200, 384) };
  const src = { ex, page: B.PAGE };
  const out = await B._aiRefineCrop(ex.dataUrl, '- The table shows three substances.', src);
  ok(/ALREADY TYPED[\s\S]*The table shows three substances\./.test(B.ai.prompts[0]), 'the wording never reached the prompt');
  ok(out !== ex.dataUrl && src.ex !== ex && src.ex.dataUrl === out, 'a clean-up off a clear gap was not kept');
  const drawn = B.reg.get(out).drawn;
  ok(drawn.img.page === p, 'the clean-up was cut out of the CROP, not the page — it keeps the first cut\'s measurements and a second frame');
  ok(drawn.a[1] > 110 && drawn.a[1] <= 200 && drawn.a[1] >= ex.rect.y, 'the cut does not start below the block: ' + drawn.a[1]);
  ok(src.ex.rect.y === drawn.a[1] && src.ex.measure !== ex.measure && !src.ex.measure.clipped.length, 'the cleaned cut is not measured on its own');
  ok(src.ex.height === Math.round(src.ex.rect.h * src.ex.scale) + src.ex.pad * 2, 'the cleaned cut is not in ONE white frame');
  // Slicing the table in half: the borders run off the bottom — refused.
  B.ai.reply = { clean: false, box_2d: onCrop(200, 290) };
  const src2 = { ex, page: B.PAGE };
  const out2 = await B._aiRefineCrop(ex.dataUrl, '- The table shows three substances.', src2);
  ok(out2 === ex.dataUrl && src2.ex === ex, 'a clean-up that cuts the table in half was kept');
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
  try { await c.fn(); pass++; console.log('  ok   ' + c.name); }
  catch (e) { fail++; console.log('  FAIL ' + c.name + '\n       ' + e.message); }
}
console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
