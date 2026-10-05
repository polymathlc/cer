// Canvas adapter for the worksheet crop passes. The pixel helpers below are
// kept in step with index.html's browser crop pipeline (Math v1.66 / CER v1.359.0).
// No network calls, model redraws or Firebase dependencies: labels and fine
// lines come from the original page. A refused crop uses the caller's source
// page fallback and must remain visibly marked as needing manual cropping.
import { measureCrop } from './jev-review-core.js';

// The crop and what was learnt while making it. Jev is asked about the
// measurements, so they are taken from the SAME rectangle that was cut.
// `opts.marginScale` widens the breathing margin for a second attempt.
export function cropDiagram(canvas, box, createCanvas) {
  const made = cropDiagramEx(canvas, box, createCanvas);
  return made ? made.canvas : null;
}
export function cropDiagramEx(canvas, box, createCanvas, opts = {}) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  if (!box.every(v => typeof v === 'number' || (typeof v === 'string' && v.trim() !== ''))) return null;
  const values = box.map(Number);
  if (!values.every(v => Number.isFinite(v) && v >= 0 && v <= 1000)) return null;
  const [ymin, xmin, ymax, xmax] = values;
  if (ymax - ymin < 25 || xmax - xmin < 25) return null;
  if (ymax - ymin > 920 && xmax - xmin > 920) return null;
  const W = canvas.width, H = canvas.height;
  if (!W || !H) return null;
  // Clamp the two edges independently so a box beside the page edge does not
  // accidentally gain the clipped margin on its opposite edge.
  const ms = Number.isFinite(opts.marginScale) && opts.marginScale > 0 ? opts.marginScale : 1;
  let r = { x: Math.max(0, xmin / 1000 * W - W * 0.02 * ms),
    y: Math.max(0, ymin / 1000 * H - H * 0.018 * ms) };
  r.w = Math.min(W, xmax / 1000 * W + W * 0.02 * ms) - r.x;
  r.h = Math.min(H, ymax / 1000 * H + H * 0.018 * ms) - r.y;
  if (r.w < 24 || r.h < 24) return null;
  let thr = 190;
  try {
    const ctx = canvas.getContext('2d');
    thr = _inkThreshold(ctx, W, H, r);
    r = _expandRectToWhitespace(ctx, W, H, r, thr);
    r = _trimBlankEdges(ctx, W, H, r, thr, 'x') || r;
    r = _trimEdgeTextLines(ctx, W, H, r, thr, { y0: ymin / 1000 * H, y1: ymax / 1000 * H });
    r = _trimBlankEdges(ctx, W, H, r, thr, 'xy');
    if (!r) return null;
  } catch {
    // Without readable pixels we cannot certify a crop as nonblank or intact.
    return null;
  }
  if (r.w < 24 || r.h < 24) return null;
  const drawn = renderRect(canvas, r, createCanvas);
  let measure = null;
  try { measure = measureCrop(canvas.getContext('2d'), W, H, r, thr); } catch { measure = null; }
  // `scale`, `pad` and `thr` travel with the crop, so a rectangle the clean-up
  // pass draws on THIS picture can be mapped back onto the page (subCrop).
  return { canvas: drawn.canvas, rect: { x: r.x, y: r.y, w: r.w, h: r.h }, measure, pageShare: (r.w * r.h) / (W * H),
           scale: drawn.scale, pad: drawn.pad, thr };
}
// The page rectangle `r`, upscaled like every crop (≤2×, ≤~1600px) and set in
// ONE white frame. The first cut and the clean-up's re-cut both go through it,
// so the two can never be framed or scaled differently.
function renderRect(canvas, r, createCanvas) {
  const scale = Math.max(1, Math.min(2, 1600 / Math.max(r.w, r.h)));
  const w = Math.round(r.w * scale), h = Math.round(r.h * scale);
  const pad = Math.round(Math.max(16, Math.max(w, h) * 0.035));
  const out = createCanvas(w + pad * 2, h + pad * 2), ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, r.x, r.y, r.w, r.h, pad, pad, w, h);
  return { canvas: out, scale, pad };
}
const INK_RATIO = 0.74;
const INK_FLOOR = 48;    // never call almost-black-only "ink"
const INK_CEIL = 205;    // never call the paper itself ink
const INK_DEFAULT = 190; // the old fixed line — what an unreadable region falls back to
function _inkThreshold(ctx, W, H, r) {
  try {
    const x = Math.max(0, Math.round(r ? r.x : 0)), y = Math.max(0, Math.round(r ? r.y : 0));
    const w = Math.round(Math.min(r ? r.w : W, W - x)), h = Math.round(Math.min(r ? r.h : H, H - y));
    if (w < 8 || h < 8) return INK_DEFAULT;
    const d = ctx.getImageData(x, y, w, h).data;
    const hist = new Array(256).fill(0);
    let total = 0;
    for (let i = 0; i + 3 < d.length; i += 4) {
      if (d[i + 3] < 60) continue;
      const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      hist[l < 0 ? 0 : (l > 255 ? 255 : Math.round(l))]++;
      total++;
    }
    if (!total) return INK_DEFAULT;
    const want = total * 0.98;
    let seen = 0, white = 255;
    for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= want) { white = v; break; } }
    return Math.max(INK_FLOOR, Math.min(INK_CEIL, Math.round(white * INK_RATIO)));
  } catch (e) { return INK_DEFAULT; }   // a tainted canvas is not a reason to stop cropping
}
// Safety net for slightly-tight AI rectangles: grow each edge of the crop
// until it sits in clean whitespace, so a label word the rectangle clipped is
// pulled back in. Generous sideways (labels stick out left/right of a
// drawing), conservative vertically (question text usually sits above/below).
// Only ever grows — never shrinks the AI's selection.
function _expandRectToWhitespace(ctx, W, H, r, thr) {
  const TH_INK = (thr == null ? INK_DEFAULT : thr);
  const inkFrac = (x, y, w, h) => {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.round(Math.min(w, W - x)); h = Math.round(Math.min(h, H - y));
    if (w < 1 || h < 1) return 0;
    const d = ctx.getImageData(x, y, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < TH_INK && d[i + 3] > 60) n++;
    }
    return n / (d.length / 4);
  };
  const TH = 0.004; // >0.4% inked pixels in an edge strip = something is being cut through
  const stepX = Math.max(4, W * 0.012), stepY = Math.max(4, H * 0.012);
  const maxX = W * 0.18, maxY = H * 0.08; // per-side growth caps
  let { x, y, w, h } = r, gL = 0, gR = 0, gT = 0, gB = 0;
  for (let i = 0; i < 40; i++) {
    let moved = false;
    // Look one step past horizontal edges: a three-pixel strip can land in
    // the gap BETWEEN letters and stop halfway through a label. This short
    // halo bridges letter spacing while the existing growth caps still hold.
    if (x > 0 && gL < maxX && inkFrac(Math.max(0, x - stepX), y, Math.min(stepX, x) + 3, h) > TH) { const d = Math.min(stepX, x, maxX - gL); x -= d; w += d; gL += d; moved = true; }
    if (x + w < W && gR < maxX && inkFrac(x + w - 3, y, stepX + 3, h) > TH) { const d = Math.min(stepX, W - (x + w), maxX - gR); w += d; gR += d; moved = true; }
    if (y > 0 && gT < maxY && inkFrac(x, y, w, 3) > TH) { const d = Math.min(stepY, y, maxY - gT); y -= d; h += d; gT += d; moved = true; }
    if (y + h < H && gB < maxY && inkFrac(x, y + h - 3, w, 3) > TH) { const d = Math.min(stepY, H - (y + h), maxY - gB); h += d; gB += d; moved = true; }
    if (!moved) break;
  }
  return { x, y, w, h };
}
// Cut question-sentence lines off the TOP and BOTTOM of the crop. The AI's
// rectangle (or the safety margin) often catches the sentence above/below a
// figure; no margin tuning fixes that, so detect and trim it instead.
// A trimmable "text line" band must look like body text:
//   - short (one line: ≤ ~2.8% of page height) but not hairline-thin
//     (≥ ~0.5% — so a table/figure border line is never trimmed),
//   - its ink spanning most of the crop's width (≥ 55% — captions like
//     "Diagram 1" and axis titles are narrow, so they survive),
//   - not solid like a border (max row fill < 60%),
//   - separated from the remaining content by clear whitespace.
// Trims at most 3 bands and ~20% of the crop per side, keeps ≥ 50% of it —
// unless it walks into a FIGURE BODY, which is the stop it can trust (below).
const MAXRUN_FRAC = 0.30;  // a run of ink longer than this much of a band is a STROKE
const RUNS_MIN = 6;        // …and a line of print breaks into at least this many pieces
const RULE_FRAC = 0.55;    // a row carrying a run this wide is a printed RULE
const RULE_GROUPS = 4;     // …and this many of them is a framed table: hands off
// ---- PAST THE TABLE: a figure body is a place the walk can STOP ------------
// The trim above used to stand down completely the moment a crop held four
// printed rules — which is every bordered TABLE. So a table cropped with its
// stem above it and its lettered parts, marks and answer lines below it came
// back exactly as loose as the model drew it, the wording printed twice: once
// in the picture and once typed underneath.
//
// So the crop is cut into bands once, and a band that is plainly a FIGURE
// BODY — taller than a line of print and not shaped like print, or carrying a
// stroke across most of its width (a table's rules, a graph's axis) — is a
// place the walk can stop. That alone over-trimmed (v1.425.0), and every way
// it did so took away part of a FIGURE, which nothing downstream can put back
// — the AI clean-up only ever crops further. So the walk is held to EVIDENCE:
//   · A ROW OF SEPARATE LABELS IS NEVER WORDING (_trimLabelRow). The (1) (2)
//     (3) (4) under four picture options, "Set-up A   Set-up B", a graph's
//     tick numbers, "Plant A … Plant D" under a bar chart: each is wide and
//     made of print, so it read as a sentence. A sentence is ONE run of words;
//     a label row is several short pieces with wide gaps, or pieces that sit
//     each under its own part of the figure.
//   · CLEAR PAPER BEFORE THE BODY. A band is cut only where a gap of at least
//     gapMin follows it. Furniture hugs its figure — tick numbers a few points
//     under the axis, a caption under its drawing — and wording does not.
//   · A SHORT line of print is wording only when something CORROBORATES it:
//     the wrapped tail of a sentence it sits under (`tail`), or a part label
//     beside the answer line or sentence just eaten, with more wording further
//     in (`partLabel`). Merely sticking out past the body is not enough — a
//     "Table 1" caption at the page margin and a y-axis title over its axis
//     both stick out.
//   · THE CAPS LIFT ONLY ON EVIDENCE. Past three lines, or past the old 20% /
//     50% caps, the run removed must hold question FURNITURE — an answer line,
//     or a label ruled on its own line — or be at most three lines that reach
//     the body exactly. A key, a legend or a borderless table above a figure is
//     wide print and nothing else, and keeps the old all-or-nothing walk.
// Two things make more crops HAVE a body to stop at:
//   · a 1px border or an inner-only grid leaves rows holding only a few pixels
//     of vertical rule, which do not count as "inked", so the table fell apart
//     into one band per row with nothing strong in it. A thin stroke that runs
//     on through such a row BRIDGES it (never a stroke running the whole crop
//     edge to edge — that is a page frame or a margin rule).
//   · a table ruled with HORIZONTAL lines only is a stack of thin bands.
//     TABLE_RULES_MIN rules sharing one extent with table rows between them is
//     recognised as one table and becomes a body itself — so it is never eaten
//     row by row, and the wording around it can come off.
// And a body must be where the model said the figure is (`aiBox`): margin and
// expansion can drag a neighbouring figure in, and the walk must not stop at
// THAT and throw away the one it was asked for. With no body at all,
// everything is exactly what it was.
const ANSWER_LINE_GAP = 2;   // an answer line has at least this many gapMin of writing space above it
const STRONG_BAND = 2.5;     // a band this many line-heights tall is a figure body
const TRIM_BANDS_MAX = 12;   // lines one side may lose when the run holds question furniture
const LABEL_GAP = 1.5;       // a gap wider than this many line-heights splits a row into separate pieces
const LABEL_LONGEST = 0.4;   // …and a row of labels has no piece longer than this share of its width
const TABLE_RULES_MIN = 3;   // rules sharing one extent with table rows between them = a ruled table
function _trimEdgeTextLines(ctx, W, H, r, thr, aiBox) {
  const TH_INK = (thr == null ? INK_DEFAULT : thr);
  const x = Math.round(r.x), w = Math.round(r.w);
  const y0 = Math.round(r.y), h = Math.round(Math.min(r.h, H - y0));
  if (w < 40 || h < 60) return r;
  const data = ctx.getImageData(x, y0, w, h).data;
  const ink = new Uint8Array(w * h);
  const rows = new Array(h);
  for (let ry = 0; ry < h; ry++) {
    let n = 0, minX = -1, maxX = -1, runs = 0, run = 0, runX = 0, maxRun = 0, maxRunX = 0, prev = 0;
    const base = ry * w * 4;
    for (let rx = 0; rx < w; rx++) {
      const i = base + rx * 4;
      const on = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < TH_INK && data[i + 3] > 60) ? 1 : 0;
      if (on) {
        ink[ry * w + rx] = 1;
        n++; if (minX < 0) minX = rx; maxX = rx;
        if (!prev) { runs++; run = 1; runX = rx; } else run++;
        if (run > maxRun) { maxRun = run; maxRunX = runX; }
      } else run = 0;
      prev = on;
    }
    rows[ry] = { n, minX, maxX, runs, maxRun, maxRunX };
  }
  const inked = ry => rows[ry].n > Math.max(2, w * 0.004);
  const joinGap = Math.max(2, Math.round(H * 0.003));  // gaps inside one band (i-dots, accents)
  const gapMin = Math.max(5, Math.round(H * 0.007));   // whitespace that separates text from the figure
  const minBandH = Math.max(4, Math.round(H * 0.005)); // thinner = a border/rule line, keep it
  const maxBandH = Math.round(H * 0.028);              // taller = part of the figure, keep it
  const maxTrim = h * 0.20, minKeep = h * 0.50;

  // A stroke that runs the WHOLE crop, edge to edge, is a page frame or a
  // margin rule, not a figure — it must never bridge anything.
  const frameCol = new Uint8Array(w);
  for (let rx = 0; rx < w; rx++) {
    if (!ink[rx] || !ink[(h - 1) * w + rx]) continue;
    let n = 0;
    for (let ry = 0; ry < h; ry++) n += ink[ry * w + rx];
    if (n >= h * 0.95) frameCol[rx] = 1;
  }
  // A row too faint to count as inked still CONTINUES a band when a stroke
  // runs straight through it — a 1px table's vertical rules between its rows.
  const bridged = ry => {
    if (ry <= 0 || ry >= h - 1 || rows[ry].n < 1) return false;
    for (let rx = rows[ry].minX; rx <= rows[ry].maxX; rx++)
      if (!frameCol[rx] && ink[ry * w + rx] && ink[(ry - 1) * w + rx] && ink[(ry + 1) * w + rx]) return true;
    return false;
  };
  // …and a band's ends reach over such strokes too (an inner-only grid's
  // vertical rules run on above the first row of text and below the last).
  const stub = (ry, from) => {
    if (ry < 0 || ry >= h || inked(ry) || rows[ry].n < 1) return false;
    for (let rx = rows[ry].minX; rx <= rows[ry].maxX; rx++)
      if (!frameCol[rx] && ink[ry * w + rx] && ink[from * w + rx]) return true;
    return false;
  };
  const strokeRow = ry => rows[ry].maxRun > w * 0.15;
  const median = list => { list.sort((a, b) => a - b); return list.length ? list[list.length >> 1] : 0; };
  // Everything the walk asks of a band, measured once. The `r*` fields are the
  // same measures with any STROKE rows left out — what is left of a line once
  // the answer blank ruled along its foot is ignored.
  const bandOf = (s, e) => {
    let minX = w, maxX = 0, maxFrac = 0, maxRun = 0;
    let rMinX = w, rMaxX = 0, rMaxFrac = 0, rMaxRun = 0, sN = 0, sFirst = -1, sMinX = w;
    const runList = [], rRunList = [];
    for (let ry = s; ry <= e; ry++) {
      const row = rows[ry];
      if (row.n > 0) { if (row.minX < minX) minX = row.minX; if (row.maxX > maxX) maxX = row.maxX; }
      if (!inked(ry)) continue;
      if (row.n / w > maxFrac) maxFrac = row.n / w;
      if (row.maxRun > maxRun) maxRun = row.maxRun;
      runList.push(row.runs);
      if (strokeRow(ry)) {
        sN++; if (sFirst < 0) sFirst = ry;
        if (row.maxRunX < sMinX) sMinX = row.maxRunX;
      } else {
        if (row.minX < rMinX) rMinX = row.minX;
        if (row.maxX > rMaxX) rMaxX = row.maxX;
        if (row.n / w > rMaxFrac) rMaxFrac = row.n / w;
        if (row.maxRun > rMaxRun) rMaxRun = row.maxRun;
        rRunList.push(row.runs);
      }
    }
    if (maxX < minX) { minX = 0; maxX = 0; }
    return { s, e, size: e - s + 1, minX, maxX, inkW: maxX - minX + 1, maxFrac, maxRun, medRuns: median(runList),
             sN, sFirst, sMinX, rMinX, rInkW: Math.max(0, rMaxX - rMinX + 1), rMaxFrac, rMaxRun, rMedRuns: median(rRunList) };
  };

  // Every band in the crop, top to bottom.
  let bands = [];
  for (let ry = 0; ry < h;) {
    while (ry < h && !inked(ry)) ry++;
    if (ry >= h) break;
    let s = ry, e = ry, gap = 0;
    for (; ry < h; ry++) {
      if (inked(ry)) { e = ry; gap = 0; }
      else if (bridged(ry)) gap = 0;
      else if (++gap > joinGap) break;
    }
    const floor = bands.length ? bands[bands.length - 1].e + 1 : 0;
    while (s - 1 >= floor && stub(s - 1, s)) s--;
    while (stub(e + 1, e)) e++;
    bands.push(bandOf(s, e));
    ry = e + 1;
  }
  if (!bands.length) return r;

  // The ink of a band, column by column, as pieces: runs of inked columns
  // joined across any gap of `join` or less, each with its vertical extent.
  const piecesX = (b, join) => {
    const top = new Int32Array(w).fill(-1), bot = new Int32Array(w).fill(-1);
    for (let ry = b.s; ry <= b.e; ry++) {
      const o = ry * w;
      for (let rx = b.minX; rx <= b.maxX; rx++) if (ink[o + rx]) { if (top[rx] < 0) top[rx] = ry; bot[rx] = ry; }
    }
    const out = [];
    let cur = null, last = -1;
    for (let rx = b.minX; rx <= b.maxX; rx++) if (top[rx] >= 0) {
      if (!cur || rx - last - 1 > join) { cur = [rx, rx, top[rx], bot[rx]]; out.push(cur); }
      cur[1] = rx;
      if (top[rx] < cur[2]) cur[2] = top[rx];
      if (bot[rx] > cur[3]) cur[3] = bot[rx];
      last = rx;
    }
    return out;
  };
  // The WORDS of a band: a leader's dots, a minus sign or a blurred speck is
  // a piece too, and must not split a line of print into "labels" — so a
  // piece shorter than about a third of a line is left out.
  const wordPieces = b => b.wp || (b.wp = piecesX(b, Math.max(gapMin, Math.round(b.size * LABEL_GAP)))
    .filter(c => c[3] - c[2] + 1 >= Math.min(b.size, maxBandH) * 0.35));

  // A table ruled with HORIZONTAL lines only — or a three-line table — is a
  // stack of thin bands. Rules sharing one extent, with only table rows
  // between them, are folded into ONE band, which is a figure body.
  const ruleBand = b => b.size < minBandH && b.inkW >= w * 0.30 && b.maxRun >= b.inkW * 0.8;
  const tableRow = (b, ext) => b.size <= maxBandH * 2 && b.maxRun <= b.inkW * 0.5
    && b.minX >= ext.minX - b.size / 2 && b.maxX <= ext.maxX + b.size / 2
    && (wordPieces(b).length >= 2 || b.minX > ext.minX + b.size / 2);
  {
    const tol = Math.max(3, Math.round(w * 0.01));
    const out = [];
    for (let i = 0; i < bands.length;) {
      const ext = bands[i];
      let last = -1;
      if (ruleBand(ext)) {
        let nRules = 1, rowsN = 0, tabN = 0, pendRows = 0, pendTab = 0;
        for (let j = i + 1; j < bands.length; j++) {
          const b = bands[j];
          if (ruleBand(b) && Math.abs(b.minX - ext.minX) <= tol && Math.abs(b.maxX - ext.maxX) <= tol) {
            if (pendRows < 1 || pendRows > 6) break;
            rowsN += pendRows; tabN += pendTab; pendRows = pendTab = 0;
            nRules++; last = j;
            continue;
          }
          if (b.size > maxBandH * 2 || b.maxRun > b.inkW * 0.5) break;
          pendRows++; if (tableRow(b, ext)) pendTab++;
        }
        if (!(nRules >= TABLE_RULES_MIN && rowsN >= 2 && tabN >= rowsN * 0.6)) last = -1;
      }
      if (last < 0) { out.push(bands[i]); i++; continue; }
      const t = bandOf(ext.s, bands[last].e);
      t.table = true;
      out.push(t);
      i = last + 1;
    }
    bands = out;
  }
  bands.forEach((b, i) => {
    b.above = i ? b.s - bands[i - 1].e - 1 : b.s;
    b.below = i < bands.length - 1 ? bands[i + 1].s - b.e - 1 : h - 1 - b.e;
  });

  // A band is a line of PRINT, not part of the figure, on five counts. The
  // last two are what stop a table or a graph being eaten a row at a time:
  //   · NO LONG STROKE in it. Every scanline through print crosses letters, so
  //     the longest unbroken run of ink is a few pixels. An axis, a table
  //     border, a leader line, the top of a rectangle — each lays a run right
  //     across the band. Density alone cannot see that: a hairline rule across
  //     a wide crop is a fraction of a percent of its row's pixels, so the
  //     "not solid" test passes it happily and the top comes off the table.
  //   · MADE OF MANY SHORT PIECES. A line of print breaks into dozens of runs;
  //     a stroke or a blob is one or two.
  const printLike = b => b.maxFrac <= 0.6 && b.maxRun <= b.inkW * MAXRUN_FRAC && b.medRuns >= RUNS_MIN;
  const lineH = b => !!b && b.size >= minBandH && b.size <= maxBandH && printLike(b);
  const isProse = b => lineH(b) && b.inkW >= w * 0.55;
  // For the band at the very top, `above` is the distance to the crop's edge —
  // a measurement cut short by the crop, not evidence of a missing writing space.
  // A page photographed or scanned a degree off square tilts a ruled line
  // into a band a few pixels taller than a rule — still one stroke, still thin
  // for its length, never print.
  const isLine = b => !!b && b.inkW >= w * 0.45
    && (b.size < minBandH || (b.size < minBandH * 2.5 && b.medRuns <= 3
      && b.maxRun >= b.inkW * 0.15 && b.size <= b.inkW * 0.05))
    && (b.above >= gapMin * ANSWER_LINE_GAP || b === bands[0]);
  // "(ii) Substance 2 ____________ [2]": the blank ruled along the foot of the
  // label joins it into one band, and its stroke makes the band look like no
  // print at all. A few stroke rows in the LOWER half, starting right of the
  // label, with print in the rest.
  const isUnderlined = b => !!b && b.sN >= 1 && b.sN <= Math.max(4, Math.round(minBandH * 0.6))
    && b.sFirst >= b.s + b.size / 2 && b.size >= minBandH && b.size <= maxBandH
    && b.rMaxFrac <= 0.6 && b.rMaxRun <= b.rInkW * MAXRUN_FRAC && b.rMedRuns >= RUNS_MIN
    && b.sMinX > b.rMinX + w * 0.04;
  // Two or three single-spaced lines of a paragraph merge into one band taller
  // than a line. A drawing has ink on every row of it, so it never splits into
  // line-sized pieces at its own blank rows; a stack of lines always does.
  const stackedPieces = b => {
    const p = [];
    let ps = -1, pe = -1, gap = 0;
    for (let ry = b.s; ry <= b.e; ry++) {
      if (inked(ry)) {
        if (ps < 0) ps = ry;
        else if (gap >= Math.max(2, joinGap >> 1)) { p.push(pe - ps + 1); ps = ry; }
        pe = ry; gap = 0;
      } else gap++;
    }
    if (ps >= 0) p.push(pe - ps + 1);
    return p;
  };
  const isStacked = b => !!b && b.size > maxBandH && b.size <= maxBandH * 3 && b.inkW >= w * 0.55 && printLike(b)
    && (p => p.length >= 2 && Math.max(...p) <= maxBandH)(stackedPieces(b));
  // A ROW OF LABELS is not a sentence. Three or more pieces with wide gaps and
  // none of them long — tick numbers, (1) (2) (3) (4), A B C D, "Plant A …" —
  // or two or more pieces each sitting under its own part of the body.
  const isLabelRow = (b, segs) => {
    if (!b || b.size > maxBandH * 1.5) return false;
    const cl = wordPieces(b);
    if (cl.length >= 3 && Math.max(...cl.map(c => c[1] - c[0] + 1)) <= b.inkW * LABEL_LONGEST) return true;
    if (segs && segs.length >= 2 && cl.length >= 2) {
      const slack = b.size * 2, hit = new Set();
      for (const [a, z] of cl) {
        const k = segs.findIndex(([p, q]) => a >= p - slack && z <= q + slack);
        if (k < 0) return false;
        hit.add(k);
      }
      return hit.size >= 2;
    }
    return false;
  };
  // A body must be where the model said the figure is.
  const inBox = b => !aiBox || !(aiBox.y1 > aiBox.y0)
    || (Math.min(y0 + b.e, aiBox.y1) - Math.max(y0 + b.s, aiBox.y0) + 1) >= Math.min(b.size, aiBox.y1 - aiBox.y0) * 0.5;
  // A band this tall is a body whatever it is made of — a photographed 1px
  // table and an outline drawing both read as "print" — unless it is just a
  // few lines of a paragraph run together.
  const isStrong = b => b.table || (b.size > maxBandH * 1.5
    && (b.maxRun >= b.inkW * 0.5 || (b.size >= maxBandH * STRONG_BAND && !isStacked(b))));
  const strong = bands.map(b => isStrong(b) && inBox(b));
  const coreMode = strong.some(Boolean);

  // A FRAMED TABLE IS THE FIGURE, and every one of its rows reads as prose on
  // its own. Trimmed row by row it comes back as its own bottom two thirds —
  // the one wrong crop that looks completely convincing. Four rules and not
  // three: an ordinary boxed diagram is a rule top, a rule bottom and a
  // divider across the middle, and at three this would stand down on half the
  // figures it was written to clean. With a body in the crop, only the rules
  // OUTSIDE every body that are not answer lines or ruled blanks are counted.
  const skipRow = new Uint8Array(h);
  if (coreMode) bands.forEach((b, i) => {
    if (strong[i] || isLine(b) || isUnderlined(b)) for (let ry = b.s; ry <= b.e; ry++) skipRow[ry] = 1;
  });
  let ruleGroups = 0, inRule = 0;
  for (let ry = 0; ry < h; ry++) {
    const isRule = !skipRow[ry] && rows[ry].maxRun >= w * RULE_FRAC;
    if (isRule && !inRule) ruleGroups++;
    inRule = isRule ? 1 : 0;
  }
  if (ruleGroups >= RULE_GROUPS) return r;

  // Walk the bands from one edge. `order` lists band indices outward-in.
  // A RUN OF CONSECUTIVE LINES goes together. Two lines of a question sit a
  // few pixels apart — far less than the clear band that separates the
  // wording from the figure — so insisting on clear paper after the FIRST
  // line finds none, stops, and leaves both lines on the picture. The cut is
  // remembered only where a run reached real whitespace, so a band with
  // nothing but figure after it is still never touched.
  const walk = (order, dir) => {
    let core = -1;
    if (coreMode) for (const i of order) if (strong[i]) { core = i; break; }
    const C = core >= 0 ? bands[core] : null;
    const m = core >= 0 ? order.indexOf(core) : order.length;
    const segs = C ? piecesX(C, Math.max(gapMin, Math.round(w * 0.02))) : null;
    const B = k => bands[order[k]];
    const gapIn = b => (dir > 0 ? b.below : b.above);    // toward the body
    const gapOut = b => (dir > 0 ? b.above : b.below);   // toward the crop edge
    const toCore = b => (C ? (dir > 0 ? C.s - b.e - 1 : b.s - C.e - 1) : Infinity);
    const label = b => isLabelRow(b, segs);
    const plain = b => !!b && (isProse(b) || (!!C && (isStacked(b) || (isUnderlined(b) && b.inkW >= w * 0.55)))) && !label(b);
    // The short last line of a wrapped sentence: left-aligned under (or over)
    // a sentence it sits closer to than it sits to the body.
    const tail = k => {
      const b = B(k);
      if (!C || !lineH(b) || label(b)) return false;
      const by = (j, gap) => {
        if (j < 0 || j >= m) return false;
        const n = B(j);
        return isProse(n) && !label(n) && gap <= Math.max(gapMin, b.size * 1.5) && gap < toCore(b)
          && b.minX >= n.minX - b.size && b.minX <= n.minX + b.size * 5;
      };
      return by(k - 1, gapOut(b)) || by(k + 1, gapIn(b));
    };
    // A short part label — "(i) Substance 1" — beside the answer line or the
    // sentence just eaten, starting where it starts, with wording further in.
    const partLabel = k => {
      const b = B(k);
      if (!C || k === 0 || !lineH(b) || label(b)) return false;
      const p = B(k - 1);
      if (!(isLine(p) || isProse(p))) return false;
      if (Math.abs(p.minX - b.minX) > Math.max(w * 0.02, b.size)) return false;
      for (let j = k + 1; j < m; j++) if (plain(B(j))) return true;
      return false;
    };
    // A short line the MODEL left out of its own box, pulled in only by the
    // margin, and not centred on the body: the model was told to box a
    // figure's captions and titles, so one it left out is not one of them.
    const spill = k => {
      const b = B(k);
      if (!C || !aiBox || !lineH(b) || label(b)) return false;
      if (y0 + b.e >= aiBox.y0 && y0 + b.s <= aiBox.y1) return false;
      return Math.abs((b.minX + b.maxX) - (C.minX + C.maxX)) / 2 > w * 0.03;
    };
    const words = k => k < m && (plain(B(k)) || tail(k) || partLabel(k) || spill(k));
    let cut = null, eaten = 0, ev = false, capped = null, reached = false, outside = !!aiBox;
    // An ANSWER LINE is walked through, but only beside print — never as the
    // first thing met when nothing but more lines and the body lie beyond it.
    const lineOk = k => {
      if (!C || !isLine(B(k))) return false;
      if (eaten > 0) return true;
      let j = k + 1;
      while (j < m && isLine(B(j))) j++;
      return words(j);
    };
    const max = C ? TRIM_BANDS_MAX : 3;
    for (let k = 0; k < order.length && eaten < max; k++) {
      if (k === m) break;
      const b = B(k);
      const asLine = lineOk(k);
      const ok = asLine || (C ? words(k) : (isProse(b) && !label(b)));
      if (!ok) break;
      eaten++;
      if (asLine || (C && isUnderlined(b))) ev = true;
      if (aiBox && y0 + b.e >= aiBox.y0 && y0 + b.s <= aiBox.y1) outside = false;
      const after = gapIn(b);
      const end = dir > 0 ? b.e : b.s;
      // The line touching the body, closer than gapMin, is cut only when it is
      // a sentence that does not sit centred on the body: a caption or an axis
      // title is centred on its figure, a stem starts at the text margin.
      const touching = k + 1 === m && after < gapMin && after > 0 && plain(b)
        && Math.abs((b.minX + b.maxX) - (C.minX + C.maxX)) / 2 > w * 0.03;
      if (after >= gapMin || touching) {
        cut = end + dir * (1 + Math.min(after, gapMin));
        if (eaten <= 3) capped = cut;
        reached = k + 1 === m;
      }
    }
    // The caps lift on EVIDENCE: question furniture in the run, or a run of at
    // most three lines that reaches the body exactly from ABOVE (a stem) or
    // lies wholly outside the model's own box. Below a figure, three lines
    // reaching it may be its key or its legend, and keep the old caps.
    if (C && (ev || (reached && eaten <= 3 && (outside || dir > 0)))) return { cut, core: C };
    return { cut: capped, core: null };   // the old walk: ≤3 lines, 20% / 50% caps
  };
  let top = 0, bot = h - 1;
  const up = walk(bands.map((_, i) => i), 1);
  if (up.cut !== null) {
    if (up.core) top = up.cut;
    else if (up.cut <= maxTrim && bot - up.cut + 1 >= minKeep) top = up.cut;
  }
  const lower = bands.map((_, i) => i).reverse().filter(i => bands[i].s >= top);
  const dn = walk(lower, -1);
  if (dn.cut !== null) {
    if (dn.core) { if (dn.cut >= top) bot = dn.cut; }
    else if ((h - 1 - dn.cut) <= maxTrim && dn.cut - top + 1 >= minKeep) bot = dn.cut;
  }

  // The blank paper this exposes is pulled in by _trimBlankEdges, which is
  // now the ONE door for "shrink to the ink" — it does the LEFT and RIGHT
  // edges as well, and this function used to do neither.
  if (top === 0 && bot === h - 1) return r;
  return { x: r.x, y: y0 + top, w: r.w, h: bot - top + 1 };
}
// ---- AND THEN THE BLANK PAPER ITSELF --------------------------------------
// Pull every edge of the crop in to the first row and column carrying real
// ink. It is the one move in this whole pipeline that cannot be wrong — it
// removes measured empty paper and nothing else — and it is what
// _expandRectToWhitespace structurally cannot do, because that one only ever
// grows.
//
// It used to be four lines at the foot of _trimEdgeTextLines and it did the
// TOP and BOTTOM only, so the LEFT and RIGHT blank paper was never removed at
// all: whatever the model's rectangle, the 2.8%-of-the-PAGE margin and a
// sideways expansion of up to 18% of the page width had left on the sides was
// shipped. On a figure that is a third of the page wide that is most of the
// picture, and it reads as a crop somebody made loosely rather than as a pass
// that never ran.
//
// A SPECK IS NOT INK, and that is the half that matters on a photograph.
// JPEG ringing, dust and paper texture leave scattered single dark pixels, so
// one of them anywhere in the margin used to defeat the whole pull-in —
// silently, because the crop still looks like a crop. A row or column counts
// as ink only when it carries EDGE_INK_MIN pixels of it AND a run of at least
// EDGE_SPECK_RUN together: one isolated pixel is noise, two touching are a
// stroke. Both directions are bounded — a real feature that is genuinely one
// pixel across costs a pixel or two of crop, and a speck left in costs the
// whole tighten.
//
// A region with NO real ink anywhere is not a figure, so it comes back NULL
// rather than as a white rectangle. The caller turns that into the whole-page
// backup, which is one ✂️ crop from right and is badged; a blank picture
// uploaded into the question looks exactly like a figure somebody has already
// cropped, and reaches the bank that way.
//
// `axes` is 'x', 'y' or 'xy'. The X-only call runs BEFORE the prose trim
// because that trim measures every band against the CROP's width
// (`inkW >= w * 0.55`, `maxRun <= inkW * MAXRUN_FRAC`): with blank paper on
// both sides those fractions describe the paper rather than the figure, and a
// question sentence spanning the real content is scored as though it spanned
// half of it. The 'xy' call runs LAST, on the paper the trim itself exposes.
const EDGE_INK_MIN = 3;      // fewer inked pixels than this in a line is not a line of anything
const EDGE_INK_FRAC = 0.003; // …nor is a scatter thinner than this share of the span
const EDGE_SPECK_RUN = 2;    // one isolated pixel is noise; two touching are a stroke
function _trimBlankEdges(ctx, W, H, r, thr, axes) {
  const TH_INK = (thr == null ? INK_DEFAULT : thr);
  const doX = !axes || axes.indexOf('x') >= 0, doY = !axes || axes.indexOf('y') >= 0;
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const w = Math.round(Math.min(r.w, W - x0)), h = Math.round(Math.min(r.h, H - y0));
  if (w < 16 || h < 16) return r;
  let d;
  try { d = ctx.getImageData(x0, y0, w, h).data; }
  catch (e) { return r; }   // a tainted canvas is not a reason to stop cropping
  // One walk of the region fills both profiles: per row and per column, how
  // much ink and how long its longest unbroken run.
  const rowN = new Int32Array(h), rowRun = new Int32Array(h), rowCur = new Int32Array(h);
  const colN = new Int32Array(w), colRun = new Int32Array(w), colCur = new Int32Array(w);
  for (let ry = 0; ry < h; ry++) {
    const base = ry * w * 4;
    let run = 0;
    for (let rx = 0; rx < w; rx++) {
      const i = base + rx * 4;
      const on = d[i + 3] > 60 && (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) < TH_INK;
      if (on) {
        rowN[ry]++; colN[rx]++;
        run++; if (run > rowRun[ry]) rowRun[ry] = run;
        colCur[rx]++; if (colCur[rx] > colRun[rx]) colRun[rx] = colCur[rx];
      } else { run = 0; colCur[rx] = 0; }
    }
  }
  const real = (n, maxRun, span) =>
    n >= Math.max(EDGE_INK_MIN, span * EDGE_INK_FRAC) && maxRun >= EDGE_SPECK_RUN;
  let t = 0, b = h - 1, l = 0, rt = w - 1;
  while (t < b && !real(rowN[t], rowRun[t], w)) t++;
  while (b > t && !real(rowN[b], rowRun[b], w)) b--;
  while (l < rt && !real(colN[l], colRun[l], h)) l++;
  while (rt > l && !real(colN[rt], colRun[rt], h)) rt--;
  // Nothing anywhere: the rectangle landed on blank paper.
  if (!real(rowN[t], rowRun[t], w) || !real(colN[l], colRun[l], h)) return null;
  // …but the faint TIP of a real stroke is not a speck. The guard stops at the
  // first line carrying a stroke, which can be a few pixels inside the end of
  // a "T"'s crossbar or a serif — so "Temperature" lost the left of its T
  // whenever it was the leftmost thing in the crop. Step back out while the
  // next line holds ink TOUCHING ink on the line just inside it: that follows
  // a stroke to its very tip, and can never jump to a speck on its own. A tip
  // ENDS: a stroke still going when the reach runs out is a long line running
  // past the crop — a page frame, a margin rule — and the edge stays put.
  const on = (rx, ry) => { const i = (ry * w + rx) * 4; return d[i + 3] > 60 && (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) < TH_INK; };
  const colTouches = (c, inner) => { for (let ry = 0; ry < h; ry++) if (on(c, ry) && ((ry > 0 && on(inner, ry - 1)) || on(inner, ry) || (ry < h - 1 && on(inner, ry + 1)))) return true; return false; };
  const rowTouches = (rr, inner) => { for (let rx = 0; rx < w; rx++) if (on(rx, rr) && ((rx > 0 && on(rx - 1, inner)) || on(rx, inner) || (rx < w - 1 && on(rx + 1, inner)))) return true; return false; };
  const reach = Math.max(16, Math.round(Math.max(w, h) * 0.03));
  // Reaching the region's own edge proves nothing by itself — an earlier pass
  // may have stopped exactly at the tip — so the line just OUTSIDE it is read:
  // ink there touching the edge means the stroke goes on past it.
  const outLine = (sx, sy, sw, sh) => {
    if (sx < 0 || sy < 0 || sx + sw > W || sy + sh > H) return null;
    try { return ctx.getImageData(sx, sy, sw, sh).data; } catch (e) { return null; }
  };
  const runsOn = (px, n, inner) => {
    if (!px) return false;
    for (let k = 0; k < n; k++) {
      const i = k * 4;
      if (px[i + 3] > 60 && (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) < TH_INK
        && ((k > 0 && inner(k - 1)) || inner(k) || (k < n - 1 && inner(k + 1)))) return true;
    }
    return false;
  };
  const tip = (v, step, lim, touches, beyond) => {
    let k = 0, u = v;
    while (u !== lim && touches(u + step, u)) { u += step; if (++k >= reach) return v; }
    return u !== v && u === lim && beyond() ? v : u;
  };
  l = tip(l, -1, 0, colTouches, () => runsOn(outLine(x0 - 1, y0, 1, h), h, ry => on(0, ry)));
  rt = tip(rt, 1, w - 1, colTouches, () => runsOn(outLine(x0 + w, y0, 1, h), h, ry => on(w - 1, ry)));
  t = tip(t, -1, 0, rowTouches, () => runsOn(outLine(x0, y0 - 1, w, 1), w, rx => on(rx, 0)));
  b = tip(b, 1, h - 1, rowTouches, () => runsOn(outLine(x0, y0 + h, w, 1), w, rx => on(rx, h - 1)));
  const out = { x: r.x, y: r.y, w: r.w, h: r.h };
  if (doY && b - t + 1 >= 8) { out.y = y0 + t; out.h = b - t + 1; }
  if (doX && rt - l + 1 >= 8) { out.x = x0 + l; out.w = rt - l + 1; }
  return out;
}


// ---- THE QUESTION'S OWN WORDING, for the AI clean-up pass -------------------
// Kept in step with app.js's `_cropWordingOf`: the sentences already TYPED into
// the question, so the clean-up is a matching job ("this line is the question
// twice") rather than a judgement about what belongs to a table.
export const CROP_WORDING_CHARS = 1600;
export function cropWordingOf(blocks) {
  const out = [];
  const plain = v => String(v == null ? '' : v)
    .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
  // A line of fewer than three words is not a SENTENCE. Listed, a bare "(a)"
  // or a one-word line invites the clean-up to cut that same word off the
  // figure, where it is a label.
  const add = v => { if (v && v.split(' ').length >= 3) out.push(v); };
  (Array.isArray(blocks) ? blocks : []).forEach(b => {
    if (!b || typeof b !== 'object') return;
    const t = String(b.type || '').trim().toLowerCase();
    if (t === 'text' || t === 'part') add(plain(b.text != null ? b.text : b.content));
    // An MCQ lends its STEM only. Its options are what a picture option's
    // labels and a table's cells say, so listing them told the clean-up to
    // cut the figure's own words off it.
    else if (t === 'mcq') add(plain(b.question || b.stem || b.text));
  });
  // Every line gets its turn. One that does not fit is CLIPPED (on a word,
  // with "…") instead of ending the list, and room is held back for the lines
  // still to come (up to 160 characters each): a long stem must never crowd
  // out the short part lines printed under a table, which are exactly the
  // lines that end up in a crop. When everything fits, nothing is clipped.
  let text = '';
  out.forEach((line, i) => {
    const left = CROP_WORDING_CHARS - text.length - (text ? 3 : 2);
    const later = out.slice(i + 1).reduce((n, l) => n + 3 + Math.min(l.length, 160), 0);
    const room = Math.min(left, Math.max(40, left - later));
    let v = line;
    if (v.length > room) {
      if (room < 40) return;
      let at = v.lastIndexOf(' ', room - 1);
      if (at < room * 0.6) at = room - 1;
      v = v.slice(0, at).replace(/[\s,;:]+$/, '') + '…';
    }
    text += (text ? '\n- ' : '- ') + v;
  });
  return text;
}

// The prompt the clean-up pass sends with ONE cropped figure. Kept in step
// with app.js's `_aiRefineCrop`.
export function refinePrompt(wording) {
  const typed = String(wording || '').trim();
  return 'The attached image is an auto-cropped figure for a primary-school science exam question. It should contain ONE figure (diagram / graph / experimental set-up / data table) and NOTHING else.\n' +
    'Sometimes the crop wrongly includes question text above, below or beside the figure: the sentence that introduces it, lettered parts such as "(a) State the…" or "(i) Substance 1", question numbers, marks such as [2], blank answer lines, or the end of the previous question.\n' +
    (typed ? 'These sentences are ALREADY TYPED in the question. A whole line or sentence from this list that sits OUTSIDE the figure is stray text and must be left out, and so is the start or end of such a sentence cut off at the edge of the crop:\n' + typed + '\n' +
      'BUT a single word or short phrase INSIDE the figure — a label, an axis title, a legend entry, a row or column heading, a table cell, or the (1) (2) (3) (4) / (A) (B) (C) (D) label of a picture option — belongs to the figure even if the same word is in the list above: keep it.\n' : '') +
    'Reply ONLY with JSON:\n' +
    '- If the image is already clean (only the figure): {"clean":true}\n' +
    '- Otherwise: {"clean":false,"box_2d":[ymin,xmin,ymax,xmax]} — integers 0-1000 measured on THIS image, the rectangle around the figure/table only.\n' +
    'Rules for box_2d:\n' +
    '- INCLUDE everything that belongs to the figure: labels, pointer lines, axis titles, axis numbers, units, table headers and borders, and short captions like "Diagram 1".\n' +
    '- EXCLUDE full sentences / paragraphs of question text, and the part labels, marks, answer lines and question numbers that go with them.\n' +
    '- A TABLE runs from its top border to its bottom border — never the sentence above it or the parts below it.\n' +
    '- Never cut through a word that belongs to the figure — when unsure, keep it.';
}

// Cut the rectangle the clean-up pass returned — drawn on the CROP — out of the
// PAGE the crop came from, with the same guards as the browser: a sliver, the
// whole image, or a box that would throw away almost all of the crop is not
// trusted and the crop is kept. Returns a NEW made-shaped object, or null to
// keep the crop as it was.
//
// IT IS CUT FROM THE PAGE AND MEASURED THERE, never cut out of the crop. Cut
// out of the crop, the result kept the FIRST cut's measurements — so a
// clean-up that sliced a table in half was invisible to the clipped check and
// to Jev — and it wore the crop's white frame inside a second one. Here the
// box is mapped back onto the page (inside the first cut, never past it), cut
// with ONE fresh frame, and measured again; a cut that leaves drawing running
// off an edge the first cut did not is refused, because the clean-up has cut
// into the figure rather than trimmed question text off it.
export function subCrop(made, box, createCanvas, page) {
  if (!made || !made.canvas || !made.rect || !page || !Array.isArray(box) || box.length !== 4) return null;
  if (!(made.scale > 0) || !Number.isFinite(made.pad)) return null;
  const [ymin, xmin, ymax, xmax] = box.map(Number);
  if (![ymin, xmin, ymax, xmax].every(v => Number.isFinite(v) && v >= 0 && v <= 1000)) return null;
  if (ymax - ymin < 100 || xmax - xmin < 150) return null;
  if (ymax - ymin > 960 && xmax - xmin > 960) return null;
  const CW = made.canvas.width, CH = made.canvas.height, W = page.width, H = page.height;
  if (!CW || !CH || !W || !H) return null;
  // The box on the crop, with the same small margin the browser keeps…
  const mx = CW * 0.012, my = CH * 0.012;
  const cx0 = Math.max(0, xmin / 1000 * CW - mx), cy0 = Math.max(0, ymin / 1000 * CH - my);
  const cx1 = Math.min(CW, xmax / 1000 * CW + mx), cy1 = Math.min(CH, ymax / 1000 * CH + my);
  if (cx1 - cx0 < 24 || cy1 - cy0 < 24 || ((cx1 - cx0) * (cy1 - cy0)) / (CW * CH) < 0.12) return null;
  // …and on the page: undo the frame and the upscale, and stay inside the first cut.
  const R = made.rect, s = made.scale, p = made.pad;
  const inX = v => Math.max(R.x, Math.min(R.x + R.w, v)), inY = v => Math.max(R.y, Math.min(R.y + R.h, v));
  const x0 = inX(R.x + (cx0 - p) / s), x1 = inX(R.x + (cx1 - p) / s);
  const y0 = inY(R.y + (cy0 - p) / s), y1 = inY(R.y + (cy1 - p) / s);
  const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (r.w < 12 || r.h < 12) return null;
  let measure;
  try { measure = measureCrop(page.getContext('2d'), W, H, r, made.thr != null ? made.thr : INK_DEFAULT); }
  catch { return null; }
  if (!measure || measure.unreadable) return null;
  const before = (made.measure && made.measure.clipped) || [];
  if (measure.clipped.some(side => before.indexOf(side) < 0)) return null;
  const drawn = renderRect(page, r, createCanvas);
  return { ...made, canvas: drawn.canvas, rect: r, scale: drawn.scale, pad: drawn.pad, measure,
           pageShare: (r.w * r.h) / (W * H), refined: true };
}
