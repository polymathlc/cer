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

test('the faint TIP of a stroke is kept — a "T" keeps its crossbar', () => {
  // The leftmost columns of a T's crossbar carry two pixels each: too few for
  // the speck guard, but they touch the stroke it stopped at.
  const p = page(400, 300);
  p.rect(100, 100, 24, 2).rect(110, 100, 4, 20);              // "T": a 2px crossbar over its stem
  p.rect(140, 100, 120, 60);                                  // the rest of the figure
  p.rect(30, 250, 1, 1);                                      // a speck, well clear of it all
  const out = tight(p, { x: 20, y: 60, w: 300, h: 220 }, 'xy');
  ok(out, 'a page with a figure on it came back as blank paper');
  near(out.x, 100, 1, 'the tip of the crossbar was shaved off as if it were a speck');
  ok(out.y + out.h <= 162, 'the speck below was pulled into the crop');
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

test('…and a SHORT part label beside the answer line it labels is wording too', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 130, 600, 10);
  const tableBottom = borderedTable(p, 100, 160, 600, 4, 35);
  p.prose(30, 320, 620, 10);                                  // "(a) State the physical state…"
  p.prose(70, 345, 120, 10);                                  // "(i) Substance 1" — no mark, narrow
  p.rect(70, 395, 600, 2);                                    // its answer line
  p.prose(70, 420, 120, 10).prose(640, 420, 25, 10);          // "(ii) Substance 2         [2]"
  const out = fullTrim(p, { x: 20, y: 120, w: 670, h: 320 });
  near(out.y + out.h, tableBottom, 2, 'a short part label under the table was kept');
});

test('…but a short line with NOTHING to say it is wording stays — it may be the caption', () => {
  // Sticking out past the body is not evidence: "Table 1" set at the page
  // margin under a centred table sticks out exactly the same way.
  const p = page(700, 1000, { paper: 250 });
  borderedTable(p, 200, 160, 500, 4, 35);
  p.prose(60, 320, 60, 10);                                   // "Table 1", at the margin
  const out = fullTrim(p, { x: 40, y: 150, w: 620, h: 190 });
  ok(out.y + out.h >= 330, 'a caption under the table was trimmed as if it were wording');
});

test('the table itself is never eaten — every row, both borders', () => {
  const { p } = reportedPage();
  const out = fullTrim(p, { x: 20, y: 150, w: 670, h: 170 });   // a crop that is ONLY the table
  near(out.y, 160, 2, 'the top border came off');
  near(out.y + out.h, 302, 2, 'the bottom border came off');
});

test('a table ruled with HORIZONTAL lines only is a body too — never eaten row by row', () => {
  // No vertical borders, so every rule and every row is its own band. Rules
  // sharing one extent with table rows between them are ONE table, and the
  // stem above it comes off like any other.
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 100, 600, 10);
  for (let k = 0; k <= 4; k++) p.rect(100, 140 + k * 40, 500, 2);
  for (let k = 0; k < 4; k++) p.prose(110, 140 + k * 40 + 16, 480, 8);
  const out = fullTrim(p, { x: 20, y: 90, w: 670, h: 260 });
  near(out.y, 140, 2, 'the stem stayed, or the top rule went');
  near(out.y + out.h, 302, 2, 'the table lost its bottom rows');
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

// ---- FIGURE FURNITURE IS NEVER WORDING (v1.426.0) ---------------------------
// v1.425.0 walked to the body and took everything on the way, and every one of
// these went with it. Nothing downstream can put any of it back — the AI
// clean-up only crops further — so each loss reads as a perfectly clean crop.
const labelRow = (p, xs, y, w = 24, h = 10) => { for (const x of xs) p.prose(x, y, w, h); return p; };
function pictureOptions(gap, where = 'below') {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 80, 620, 10);                                   // the stem
  const xs = [90, 250, 410, 570];
  for (const x of xs) p.rect(x, 130, 80, 80);                  // four drawn options
  if (where === 'below') labelRow(p, xs.map(x => x + 28), 210 + gap);
  else labelRow(p, xs.map(x => x + 28), 120 - gap - 10);
  return p;
}
for (const gap of [5, 12, 20]) {
  test('the (1) (2) (3) (4) under four picture options stay — gap ' + gap, () => {
    const p = pictureOptions(gap);
    const out = fullTrim(p, { x: 20, y: 70, w: 670, h: 200 });
    ok(out.y + out.h >= 220 + gap, 'the option labels were cut off (bottom ' + (out.y + out.h) + ')');
    ok(out.y >= 90, 'the stem above the options stayed');
  });
}
test('…and the same labels ABOVE the pictures stay too', () => {
  const p = page(700, 1000, { paper: 250 });
  const xs = [90, 250, 410, 570];
  labelRow(p, xs.map(x => x + 28), 110);
  for (const x of xs) p.rect(x, 130, 80, 80);
  const out = fullTrim(p, { x: 20, y: 90, w: 670, h: 140 });
  ok(out.y <= 110, 'the labels over the options were cut off (top ' + out.y + ')');
});
test('"Set-up A   Set-up B" under two set-ups stay, even close to them', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(120, 140, 160, 120).rect(420, 140, 160, 120);
  labelRow(p, [160, 460], 265, 70);                            // 5px under the drawings
  p.prose(30, 300, 620, 10);                                  // "(a) Which set-up…"
  const out = fullTrim(p, { x: 20, y: 130, w: 670, h: 190 });
  ok(out.y + out.h >= 275, 'the set-up captions were cut off (bottom ' + (out.y + out.h) + ')');
  ok(out.y + out.h < 300, 'the part line under them stayed');
});
function graph(p, { yTitle = true, ticks = 6, xTitle = 'none', grid = false } = {}) {
  p.rect(150, 150, 2, 200).rect(150, 350, 450, 2);            // the axes
  for (let k = 0; k < 5; k++) p.prose(122, 160 + k * 40, 18, 8); // y tick labels
  for (let k = 0; k < 9; k++) p.rect(160 + k * 50, 340 - k * 20, 6, 6); // the plotted points
  if (grid) for (let k = 0; k < 5; k++) p.rect(152, 160 + k * 40, 448, 1);
  if (yTitle) p.prose(100, 128, 100, 10);                     // "Temperature (°C)" over the axis
  if (ticks) labelRow(p, Array.from({ length: ticks }, (_, k) => 145 + k * 88), 356, 14, 8);
  if (xTitle === 'centre') p.prose(330, 378, 90, 10);
  if (xTitle === 'right') p.prose(560, 356, 80, 10);
  return p;
}
for (const grid of [false, true]) {
  test('a graph keeps its y-title, tick numbers and x-title' + (grid ? ' (gridded)' : ''), () => {
    const p = graph(page(700, 1000, { paper: 250 }), { grid, xTitle: 'centre' });
    p.prose(30, 90, 620, 10);                                 // the stem
    p.prose(30, 420, 620, 10);                                // "(a) …"
    const out = fullTrim(p, { x: 20, y: 80, w: 670, h: 360 });
    ok(out.y <= 128, 'the y-axis title over the axis was cut off (top ' + out.y + ')');
    ok(out.y > 100, 'the stem stayed');
    ok(out.y + out.h >= 388, 'the x-axis title or the tick numbers were cut off (bottom ' + (out.y + out.h) + ')');
    ok(out.y + out.h < 420, 'the part line stayed');
  });
}
test('…and with no axis title, the tick numbers are the last thing kept', () => {
  const p = graph(page(700, 1000, { paper: 250 }), { yTitle: false });
  p.prose(30, 400, 620, 10);
  const out = fullTrim(p, { x: 20, y: 140, w: 670, h: 280 });
  ok(out.y + out.h >= 364, 'the tick numbers were cut off (bottom ' + (out.y + out.h) + ')');
  ok(out.y + out.h < 400, 'the part line stayed');
});
test('…and an x-axis title at the RIGHT end of the axis stays', () => {
  const p = graph(page(700, 1000, { paper: 250 }), { yTitle: false, ticks: 5, xTitle: 'right' });
  const out = fullTrim(p, { x: 20, y: 140, w: 670, h: 240 });
  ok(out.y + out.h >= 366 && out.x + out.w >= 636, 'the x-axis title at the end of the axis was cut off');
});
test('"Table 1" at the margin over a centred table stays; the stem over it goes', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(60, 100, 600, 10);                                  // the stem, at the margin
  p.prose(60, 140, 50, 10);                                   // "Table 1", at the margin too
  borderedTable(p, 200, 160, 500, 4, 35);
  const out = fullTrim(p, { x: 40, y: 90, w: 620, h: 220 });
  ok(out.y <= 140, 'the caption over the table was cut off (top ' + out.y + ')');
  ok(out.y > 110, 'the stem stayed');
});
test('a HORIZONTALLY-ruled table under a drawing in the same crop is never eaten', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(250, 110, 200, 100);                                 // the drawing — a figure body
  for (let k = 0; k <= 4; k++) p.rect(100, 240 + k * 40, 500, 2);
  for (let k = 0; k < 4; k++) p.prose(110, 240 + k * 40 + 16, 480, 8);
  const out = fullTrim(p, { x: 20, y: 100, w: 670, h: 320 });
  ok(out.y + out.h >= 400, 'the table under the drawing was eaten (bottom ' + (out.y + out.h) + ')');
});
test('a six-line KEY over a row of drawings stays, and so do their letters', () => {
  const p = page(700, 1000, { paper: 250 });
  for (let k = 0; k < 6; k++) p.prose(100, 100 + k * 20, 500, 10);   // "1a Has wings ……… go to 2"
  const xs = [100, 240, 380, 520];
  for (const x of xs) p.rect(x, 240, 80, 80);
  labelRow(p, xs.map(x => x + 34), 326, 12);                   // A B C D
  const out = fullTrim(p, { x: 90, y: 90, w: 520, h: 250 });
  ok(out.y <= 100, 'the key over the drawings was eaten (top ' + out.y + ')');
  ok(out.y + out.h >= 336, 'the letters under the drawings were cut off');
});
test('a caption wider than a NARROW drawing, close under it, stays', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(330, 120, 40, 200);                                  // a thermometer
  p.prose(280, 324, 140, 10);                                 // "Thermometer X", 4px under it
  const out = fullTrim(p, { x: 260, y: 110, w: 180, h: 240 });
  ok(out.y + out.h >= 334, 'the caption under the thermometer was cut off');
});

// ---- …AND MORE OF THE WORDING NOW COMES OFF (v1.426.0) ----------------------
function tablePage(parts) {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 130, 600, 10);
  const tableBottom = borderedTable(p, 100, 160, 600, 4, 35);
  p.prose(30, 320, 620, 10);                                  // "(a) …"
  parts(p);
  return { p, tableBottom };
}
test('two and three answer lines per part all come off', () => {
  for (const n of [2, 3]) {
    const { p, tableBottom } = tablePage(p => {
      let y = 345;
      for (const lab of ['(i)', '(ii)']) {
        p.prose(70, y, 120, 10).prose(640, y, 25, 10);
        for (let k = 0; k < n; k++) { y += 36; p.rect(70, y, 600, 2); }
        y += 30;
      }
    });
    const out = fullTrim(p, { x: 20, y: 120, w: 670, h: 600 });
    near(out.y + out.h, tableBottom, 2, n + ' answer lines a part were left under the table');
  }
});
test('a part with its answer blank ruled on the same line comes off', () => {
  const { p, tableBottom } = tablePage(p => {
    p.prose(70, 345, 120, 10).rect(200, 353, 420, 2).prose(640, 345, 25, 10);   // "(i) Substance 1 ______ [2]"
    p.prose(70, 380, 120, 10).rect(200, 388, 420, 2).prose(640, 380, 25, 10);
  });
  const out = fullTrim(p, { x: 20, y: 120, w: 670, h: 280 });
  near(out.y + out.h, tableBottom, 2, 'an underlined part line was left under the table');
});
test('the short last line of a wrapped stem comes off a table as wide as the column', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(100, 100, 500, 10);                                 // "The table shows … their respective"
  p.prose(100, 116, 150, 10);                                 // "physical properties."
  const tableBottom = borderedTable(p, 100, 150, 600, 4, 35);
  const out = fullTrim(p, { x: 80, y: 90, w: 540, h: 210 });
  near(out.y, 150, 2, 'the tail of the wrapped stem was left on the table');
  near(out.y + out.h, tableBottom, 2, 'the table lost its bottom');
});
test('an answer line cut by the crop’s top edge still counts as one', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(80, 104, 600, 2);                                    // the previous question's answer line
  p.prose(30, 130, 600, 10);                                  // the stem
  borderedTable(p, 100, 160, 600, 4, 35);
  const out = fullTrim(p, { x: 20, y: 100, w: 670, h: 210 });
  near(out.y, 160, 2, 'the stem under an edge answer line was left on the table');
});
test('two single-spaced lines that run together come off as one', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 90, 620, 14).prose(30, 106, 300, 14);           // 2px apart: one band, taller than a line
  borderedTable(p, 100, 160, 600, 4, 35);
  const out = fullTrim(p, { x: 20, y: 80, w: 670, h: 230 });
  near(out.y, 160, 2, 'the run-together stem was left on the table');
});
test('a 1px table is ONE body — its 1px rules no longer let it fall apart', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 100, 600, 10);
  for (let k = 0; k <= 4; k++) p.rect(100, 140 + k * 40, 500, 1);
  for (const x of [100, 599]) p.rect(x, 140, 1, 161);               // two 1px sides: too faint to count as ink
  for (let k = 0; k < 4; k++) { p.prose(140, 140 + k * 40 + 16, 60, 8); p.prose(400, 140 + k * 40 + 16, 60, 8); }
  p.prose(30, 330, 620, 10);
  const out = fullTrim(p, { x: 20, y: 90, w: 670, h: 260 });
  near(out.y, 140, 2, 'the stem stayed over a 1px table');
  near(out.y + out.h, 301, 2, 'the part line stayed under a 1px table');
});
test('a stroke running the WHOLE crop never bridges — a page frame is not a figure', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(25, 0, 1, 1000);                                     // the page's margin rule
  p.prose(30, 100, 600, 10);
  borderedTable(p, 100, 140, 600, 4, 35);
  p.prose(30, 300, 620, 10);
  const out = fullTrim(p, { x: 20, y: 90, w: 670, h: 230 });
  ok(out.y >= 120 && out.y + out.h <= 290, 'the frame line joined the stem and the parts to the table');
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

// ---- THE SECOND REVIEW (v1.426.1) --------------------------------------------
// Each of these is a way the band walk went wrong after v1.426.0, in one
// direction or the other. Both directions are silent: a stray line reads as a
// loose crop, and a lost caption or header reads as a perfectly clean one.
const trimBox = (p, r, box) => {
  const thr = thrOf(p);
  r = M._trimBlankEdges(p.ctx, p.W, p.H, r, thr, 'x') || r;
  r = M._trimEdgeTextLines(p.ctx, p.W, p.H, r, thr, box);
  return M._trimBlankEdges(p.ctx, p.W, p.H, r, thr, 'xy');
};

test('a figure made only of TEXT, its last line a few px from the edge, never throws', () => {
  // A word equation, or a food chain written as words: there is no body, and
  // the last line sits closer to the crop's edge than a paragraph gap.
  const p = page(700, 1000, { paper: 250 });
  p.prose(100, 100, 500, 10).prose(100, 150, 500, 10);
  const r = { x: 90, y: 90, w: 520, h: 74 };                  // ends 3px under the last line
  let out = null;
  try { out = M._trimEdgeTextLines(p.ctx, p.W, p.H, r, thrOf(p), { y0: 95, y1: 162 }); }
  catch (e) { throw new Error('the trim threw on a text-only crop: ' + e.message); }
  ok(out && out.h > 0, 'a text-only crop came back empty');
});

test('a caption centred under an off-centre drawing stays, even touching it', () => {
  // Leader labels off one side pull the drawing's ink extent sideways; the
  // caption is centred on the drawing's own widest stroke, not on that extent.
  const p = page(700, 1000, { paper: 250 });
  p.rect(200, 150, 260, 160);                                 // the drawing
  p.rect(470, 200, 70, 2); p.prose(545, 195, 55, 10);         // a leader line and its label
  p.prose(215, 315, 230, 10);                                 // the caption, 5px under it
  const out = trimBox(p, { x: 150, y: 120, w: 500, h: 230 }, { y0: 150, y1: 310 });
  ok(out.y + out.h >= 325, 'the caption under the drawing was cut as a stray sentence');
});

test('a two-line title centred over a drawing stays — run together, it is still a title', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(170, 120, 360, 10).prose(200, 132, 300, 10);        // two lines, 2px apart, centred
  p.rect(150, 152, 400, 150);                                 // the drawing, 10px below
  const out = trimBox(p, { x: 100, y: 100, w: 500, h: 220 }, { y0: 152, y1: 302 });
  ok(out.y <= 120, 'a centred title over the drawing was cut as the stem');
});

test('a three-line table with EIGHT data rows keeps its header and its top rule', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 80, 600, 10);                                   // the stem
  p.rect(100, 120, 500, 2); p.prose(110, 134, 480, 8); p.rect(100, 154, 500, 2);   // padded rows
  for (let k = 0; k < 8; k++) p.prose(110, 168 + k * 24, 480, 8);
  p.rect(100, 366, 500, 2);
  p.rect(200, 400, 300, 120);                                 // a drawing below it in the same crop
  const out = trimBox(p, { x: 20, y: 70, w: 670, h: 460 }, { y0: 120, y1: 520 });
  ok(out.y > 92 && out.y <= 120, 'the top rule and header were cut, or the stem stayed (y=' + out.y + ')');
});

test('a slanted arrow under a drawing is part of the drawing, not an answer line', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(200, 150, 300, 140);                                 // the drawing
  for (let x = 150; x < 540; x++) p.rect(x, 340 + Math.floor((x - 150) / 70), 1, 2);   // a shallow slant
  for (let k = 0; k < 5; k++) p.rect(540 - k, 340 + k, 1, 11 - 2 * k);                  // its head, several strokes deep
  p.prose(30, 385, 620, 10);                                  // the question, below
  const out = trimBox(p, { x: 20, y: 130, w: 670, h: 275 }, { y0: 150, y1: 360 });
  ok(out.y + out.h >= 350, 'the arrow under the drawing was trimmed as an answer line');
});

test('a y-axis title just over the axis is not the tail of the stem above it', () => {
  const p = page(700, 1000, { paper: 250 });
  // Closer to the stem than to the axis, but not TWICE as close: it sits
  // with the figure it names, not under the sentence above it.
  p.prose(30, 100, 620, 10);                                  // the stem
  p.prose(60, 122, 140, 10);                                  // "Temperature (°C)", 12px under it
  p.rect(110, 150, 2, 230); p.rect(110, 378, 450, 2);         // the axes, 18px under the title
  for (let k = 0; k < 5; k++) p.prose(80, 160 + k * 40, 20, 8);    // tick numbers
  const out = trimBox(p, { x: 20, y: 90, w: 670, h: 310 }, { y0: 122, y1: 380 });
  ok(out.y <= 122, 'the axis title was cut with the stem');
});

function wideTablePage(partLine) {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 100, 600, 10);                                  // the stem
  for (let k = 0; k <= 4; k++) p.rect(30, 130 + k * 35, 640, 2);
  for (const x of [30, 250, 450, 668]) p.rect(x, 130, 2, 142);
  for (let k = 0; k < 4; k++) for (const x of [60, 280, 480]) p.prose(x, 130 + k * 35 + 12, 140, 8);
  partLine(p);
  return p;
}
test('a part line under a WIDE table is not a row of labels over its columns', () => {
  const p = wideTablePage(q => {
    q.prose(30, 290, 600, 10);                                // "(a) State the physical state…"
    q.prose(70, 315, 120, 10).prose(640, 315, 25, 10);        // "(i) Substance 1      [2]"
    q.rect(70, 360, 600, 2);                                  // its answer line
    q.prose(70, 385, 120, 10).prose(640, 385, 25, 10);        // "(ii) Substance 2     [2]"
  });
  const out = trimBox(p, { x: 20, y: 90, w: 670, h: 315 }, { y0: 90, y1: 400 });
  near(out.y + out.h, 272, 3, 'the lettered parts under a wide table were kept as labels');
});

test('"(a) State…  [1]" is a part line, never a row of labels', () => {
  const p = page(700, 1000, { paper: 250 });
  const bottom = borderedTable(p, 100, 160, 600, 4, 35);
  p.prose(30, 320, 20, 10).prose(70, 320, 240, 10).prose(640, 320, 25, 10);   // (a) · words · [1]
  p.rect(70, 365, 600, 2);                                    // its answer line
  const out = trimBox(p, { x: 20, y: 150, w: 670, h: 230 }, { y0: 150, y1: 370 });
  near(out.y + out.h, bottom, 3, 'a part line with its mark was kept as labels');
});

test('a FIVE-line stem the model left out of its box comes off', () => {
  const p = page(700, 1000, { paper: 250 });
  for (let k = 0; k < 5; k++) p.prose(30, 60 + k * 18, 620, 10);
  const bottom = borderedTable(p, 100, 160, 600, 4, 35);
  const out = trimBox(p, { x: 20, y: 50, w: 670, h: 260 }, { y0: 160, y1: bottom });
  near(out.y, 160, 3, 'a long stem outside the box was kept');
});

test('parts the model DID put in its box come off — answer lines ruled from a tab further in', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 130, 600, 10);                                  // the stem
  const bottom = borderedTable(p, 100, 160, 600, 4, 35);
  p.prose(30, 320, 620, 10);                                  // "(a) State the physical state…"
  p.prose(70, 345, 120, 10); p.rect(110, 380, 560, 2);        // "(i) Substance 1", its line from a tab
  p.prose(70, 405, 120, 10); p.rect(110, 440, 560, 2);        // "(ii) Substance 2", its line from a tab
  const out = trimBox(p, { x: 20, y: 120, w: 670, h: 330 }, { y0: 120, y1: 445 });
  near(out.y + out.h, bottom, 3, 'the parts inside the model box were kept');
});

test('MCQ options under a row of pictures are options, not labels of the pictures', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 80, 620, 10);                                   // the stem
  for (const x of [90, 250, 410, 570]) p.rect(x, 120, 80, 80);
  p.prose(30, 222, 400, 10);                                  // "Which objects were attracted?"
  p.prose(30, 245, 170, 10).prose(360, 245, 170, 10);         // "(1) P and Q only    (2) P and S only"
  p.prose(30, 268, 170, 10).prose(360, 268, 170, 10);         // "(3) …                (4) …"
  const out = trimBox(p, { x: 20, y: 110, w: 670, h: 175 }, { y0: 120, y1: 200 });
  near(out.y + out.h, 200, 3, 'the question line and options were kept as labels of the pictures');
});

test('a stem touching the table, with its question number in the margin, comes off', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 145, 10, 10).prose(70, 145, 560, 10);           // "5   The table shows…", 5px above
  const bottom = borderedTable(p, 150, 160, 600, 4, 35);
  const out = trimBox(p, { x: 20, y: 120, w: 670, h: 200 }, { y0: 140, y1: bottom });
  near(out.y, 160, 3, 'a numbered stem touching the table was kept');
});

test('a margin rule on a page shot a fraction of a degree off square glues nothing together', () => {
  // The rule walks one column over every 150 rows and is 3px wide, so no single
  // column runs edge to edge and every row counts as inked until it is wiped.
  const p = page(700, 1000, { paper: 250 });
  for (let y = 0; y < 1000; y++) p.rect(660 + Math.floor(y / 150), y, 3, 1);
  p.prose(30, 100, 600, 10);                                  // the stem
  const bottom = borderedTable(p, 100, 160, 600, 4, 35);
  p.prose(30, 320, 600, 10);                                  // a part under it
  const out = trimBox(p, { x: 20, y: 90, w: 670, h: 250 }, { y0: 90, y1: 340 });
  // (The rule itself is ink on every row, so the blank-paper pull-in that runs
  // afterwards stops short of the table — paper, not words, and as before.)
  ok(out.y > 110 && out.y <= 160, 'the stem stayed — the rule glued the crop into one block (y=' + out.y + ')');
  ok(out.y + out.h >= bottom && out.y + out.h < 320, 'the part stayed — the rule glued the crop into one block');
});

test('a photograph reaching both edges of the crop is NOT wiped as a frame', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(150, 0, 400, 1000);                                  // a dark photo, edge to edge
  p.prose(30, 100, 100, 10);
  const out = trimBox(p, { x: 20, y: 80, w: 670, h: 300 }, { y0: 80, y1: 380 });
  ok(out.y <= 80 && out.y + out.h >= 380, 'the photograph was treated as a page frame and trimmed through');
});

// ---- THE THIRD REVIEW (v1.426.2) ---------------------------------------------
test('a figure\'s OWN frame reaching the top and bottom of a pasted image is not a page frame', () => {
  // Nothing beyond the crop shows the stroke running on, so it is the figure's.
  const p = page(700, 1000, { paper: 250 });
  p.rect(100, 0, 500, 2).rect(100, 998, 500, 2).rect(100, 0, 2, 1000).rect(598, 0, 2, 1000);   // the frame
  p.prose(180, 30, 340, 12);                                  // its title, inside
  p.rect(200, 200, 300, 500);                                 // the drawing
  p.prose(180, 950, 340, 12);                                 // its caption, inside
  const out = trimBox(p, { x: 80, y: 0, w: 540, h: 1000 }, { y0: 25, y1: 970 });
  ok(out.y <= 2 && out.y + out.h >= 998, 'the figure\'s frame was wiped and its title or caption cut (' + out.y + '..' + (out.y + out.h) + ')');
});
test('a slanted ray crossing the crop is the figure\'s, not a page frame', () => {
  const p = page(700, 1000, { paper: 250 });
  for (let y = 0; y < 1000; y++) p.rect(120 + Math.floor(y * 0.3), y, 2, 1);   // a ray, ~17° off vertical
  p.prose(250, 120, 300, 12);                                 // the title
  p.rect(300, 350, 200, 220);                                 // a block the ray meets
  p.prose(250, 860, 300, 12);                                 // the caption
  const out = trimBox(p, { x: 90, y: 100, w: 520, h: 800 }, { y0: 110, y1: 880 });
  ok(out.y <= 120 && out.y + out.h >= 872, 'the ray was wiped as a frame and the title or caption cut');
});
test('labels under OUTLINE drawings stay — a label may sit over a part cut either way', () => {
  // An outline beaker is one piece only with its strokes left in (walls joined
  // by its base); with them out, nothing is left but two thin walls.
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 100, 620, 10);                                  // the stem
  for (const x of [150, 420]) { p.rect(x, 150, 3, 150).rect(x + 147, 150, 3, 150).rect(x, 297, 150, 3); }
  p.prose(180, 312, 90, 10).prose(450, 312, 90, 10);          // "Set-up A"   "Set-up B", 12px under
  const out = trimBox(p, { x: 20, y: 90, w: 670, h: 250 }, { y0: 150, y1: 325 });
  ok(out.y + out.h >= 322, 'the labels under the outline drawings were cut');
});
test('"X   Y   switch (open)" is a row of labels, not a part line', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(150, 150, 400, 150);                                 // the circuit
  p.prose(190, 312, 14, 10).prose(330, 312, 14, 10).prose(440, 312, 100, 10);   // X · Y · switch (open)
  p.prose(30, 380, 620, 10);                                  // the next question, below
  const out = trimBox(p, { x: 20, y: 130, w: 670, h: 270 }, { y0: 150, y1: 325 });
  ok(out.y + out.h >= 322, 'the labels were cut as a part line');
});
test('a caption under a labelled figure stays — it sits under its figure, not at the margin', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(150, 150, 400, 150);                                 // the drawing
  p.prose(190, 312, 70, 10).prose(440, 312, 70, 10);          // its two labels
  p.prose(150, 350, 380, 12);                                 // "Diagram 2: …", at the figure's left edge
  const out = trimBox(p, { x: 20, y: 130, w: 670, h: 250 }, { y0: 150, y1: 362 });
  ok(out.y + out.h >= 362, 'the caption under the labelled figure was cut');
});
test('…but a part line under it, starting out at the margin, still comes off', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(150, 150, 400, 150);
  p.prose(190, 312, 70, 10).prose(440, 312, 70, 10);
  p.prose(30, 350, 560, 12);                                  // "(a) Which set-up …", at the margin
  const out = trimBox(p, { x: 20, y: 130, w: 670, h: 250 }, { y0: 150, y1: 362 });
  ok(out.y + out.h <= 330, 'the part line under the labelled figure was kept');
});
test('a centred caption set in from both edges stays, even inside the model\'s box', () => {
  const p = page(700, 1000, { paper: 250 });
  p.rect(100, 150, 500, 150);                                 // the drawing
  p.prose(200, 330, 300, 12);                                 // "Figure 1: …", centred, 28px under
  const out = trimBox(p, { x: 20, y: 130, w: 670, h: 230 }, { y0: 150, y1: 345 });
  ok(out.y + out.h >= 342, 'a centred caption inside the box was cut');
});
test('a wrapped stem\'s short last line, hugging the table, comes off with the stem', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 120, 10, 12).prose(70, 120, 560, 12);          // "7   Siti placed three …"
  p.prose(70, 138, 200, 12);                                  // "two weeks as shown below." — 6px leading
  const bottom = borderedTable(p, 70, 160, 600, 4, 35);      // the table, 10px under it, at the indent
  const out = trimBox(p, { x: 20, y: 100, w: 670, h: 220 }, { y0: 160, y1: bottom });
  near(out.y, 160, 3, 'the stem\'s last line was kept on the table');
});
test('"Table 1" a paragraph gap under the stem is the table\'s caption, not the stem\'s tail', () => {
  const p = page(700, 1000, { paper: 250 });
  p.prose(30, 100, 600, 12);                                  // the stem
  p.prose(30, 132, 60, 10);                                   // "Table 1", 20px under it, at the margin
  borderedTable(p, 150, 157, 600, 4, 35);                     // a centred table, 15px under the caption
  const out = trimBox(p, { x: 20, y: 90, w: 670, h: 220 }, { y0: 130, y1: 300 });   // the model boxed its caption
  ok(out.y <= 132, 'the caption was cut as the end of the stem');
});
test('"(a)  Explain your answer.  [1]" under a FULL-WIDTH table is a part line', () => {
  const p = page(700, 1000, { paper: 250 });
  const bottom = borderedTable(p, 30, 120, 670, 4, 35);       // the table spans the column
  p.prose(31, 282, 26, 10).prose(80, 282, 220, 10).prose(645, 282, 24, 10);   // (a) · words · [1]
  p.rect(80, 330, 560, 2);                                    // its answer line
  const out = trimBox(p, { x: 20, y: 110, w: 670, h: 240 }, { y0: 110, y1: bottom });
  near(out.y + out.h, bottom, 3, 'the part line under a full-width table was kept as labels');
});

// ---- A REFUSED CLEAN-UP STAYS REFUSED, AND SAYS NOTHING ----------------------
// v1.426.1 painted out a "sliver of a sentence" crossing a clean-up edge and
// told Jev about every refused clean-up. A review found the sliver test could
// not tell a slanting stem from a figure's own label, axis title or table row —
// it painted those white and dropped a truly clipped side — and that a refusal
// is the safeguard protecting the figure, not evidence of stray text. Both
// were taken back out; this pins that they stay out.
test('a clean-up that clips a side is refused outright — nothing is painted on the picture', () => {
  const worker = fs.readFileSync(new URL('../rapid-import/functions/crop.js', import.meta.url), 'utf8');
  const sub = worker.slice(worker.indexOf('export function subCrop'));
  ok(/if \(measure\.clipped\.some\(side => before\.indexOf\(side\) < 0\)\) return null;/.test(sub),
    'the worker clean-up no longer refuses a cut that clips a new side');
  ok(!/Sliver|fillStyle/.test(sub), 'the worker clean-up paints on the picture again');
  const fn = cut('async function _cropRefineOnPage', '\n// SECOND-CHANCE CLEANUP', 'browser refine-on-page');
  ok(/if \(measure\.clipped\.some\(side => before\.indexOf\(side\) < 0\)\) return null;/.test(fn),
    'the browser clean-up no longer refuses a cut that clips a new side');
  ok(!/Sliver/.test(fn), 'the browser clean-up paints on the picture again');
});
test('a refused clean-up is never reported to Jev as stray text', () => {
  const idx = fs.readFileSync(new URL('../rapid-import/functions/index.js', import.meta.url), 'utf8');
  ok(/subCrop\(made,p\.box_2d,createCanvas,page\)\|\|made;/.test(idx) && /refine:\{changed:false\}/.test(idx),
    'the worker tells Jev about a clean-up it refused (or merely did not trust)');
  const facts = cut('function _jevFigureFacts', '\n// Ask the AI where the figure really is', 'jev facts');
  ok(!/refineRefused/.test(src) && /refine: \{ changed: !!refineChanged \}/.test(facts),
    'the browser tells Jev about a clean-up it refused');
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
      fillRect(...a) { (c.painted = c.painted || []).push(a); }, save() {}, restore() {}
    });
    c.toDataURL = () => { const u = 'data:image/png;base64,CUT' + (++n); reg.set(u, c); return u; };
    return c;
  } };
  const _loadImageEl = async url => url === PAGE ? { naturalWidth: p.W, naturalHeight: p.H, page: p }
    : { naturalWidth: reg.get(url).width, naturalHeight: reg.get(url).height };
  const ai = { prompts: [], reply: null };
  const askGeminiVision = async prompt => { ai.prompts.push(prompt); return ai.reply; };
  const warns = [];
  const B = new Function('document', '_loadImageEl', 'measureCrop', 'askGeminiVision', '_parseAIJson', 'console',
    cut('const INK_RATIO', '\n// SECOND-CHANCE CLEANUP', 'browser crop')
    + cut('const CROP_WORDING_CHARS', '\n// =====', 'browser refine')
    + '\nreturn { _cropBoxFromScreenshotEx, _aiRefineCrop };')(
    document, _loadImageEl, measureCrop, askGeminiVision, v => v, { warn: (...a) => warns.push(a) });
  return { ...B, reg, ai, PAGE, warns };
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
  ok(!B.warns.length, 'the clean-up threw and was swallowed: ' + B.warns.map(w => String(w[1] && w[1].message || w[0])).join('; '));
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
  const trimAt = fn.indexOf('_trimEdgeTextLines(pctx, W, H, r, thr, { y0: ymin / 1000 * H, y1: ymax / 1000 * H })');
  const xyAt = fn.indexOf("_trimBlankEdges(pctx, W, H, r, thr, 'xy')");
  ok(xAt > 0, 'the sides are not pulled in before the sentence trim');
  ok(trimAt > xAt, 'the sentence trim runs before the sides are pulled in');
  ok(xyAt > trimAt, 'the final tighten does not run after the sentence trim');
  ok(fn.indexOf('if (tight === null) return null;') > 0,
    'a crop that held no ink is still shipped as a white rectangle');
  const worker = fs.readFileSync(new URL('../rapid-import/functions/crop.js', import.meta.url), 'utf8');
  ok(worker.indexOf('_trimEdgeTextLines(ctx, W, H, r, thr, { y0: ymin / 1000 * H, y1: ymax / 1000 * H })') > 0,
    'the worker no longer tells the trim where the model put the figure');
});

test('a body is only where the MODEL put the figure — a neighbour dragged in is not one', () => {
  // The model boxed a borderless block of three rows; the margin and the
  // expansion reached a drawing below it. Without the hint that drawing is the
  // body, the three rows read as a stem reaching it from above, and the figure
  // the model asked for is thrown away.
  const p = page(700, 1000, { paper: 250 });
  for (let k = 0; k < 3; k++) p.prose(110, 110 + k * 20, 480, 10);
  p.rect(250, 190, 200, 90);                                  // a neighbouring drawing
  const thr = thrOf(p), r = { x: 20, y: 95, w: 670, h: 200 };
  const free = M._trimEdgeTextLines(p.ctx, p.W, p.H, r, thr);
  ok(free.y > 150, 'the case no longer exercises the hint (the rows were kept without it)');
  const out = M._trimEdgeTextLines(p.ctx, p.W, p.H, r, thr, { y0: 105, y1: 162 });
  ok(out.y <= 110, 'the rows the model boxed were thrown away for a neighbour\'s sake');
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
