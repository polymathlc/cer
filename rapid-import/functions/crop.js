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
    r = _trimEdgeTextLines(ctx, W, H, r, thr);
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
// in the picture and once typed underneath. Every one of those lines was
// trimmable; the guard was protecting the table's own rows, and a bordered
// table is ONE band (its vertical borders join every row), so it never needed
// protecting from a band-by-band walk at all.
//
// So the crop is cut into bands once, and a band that is plainly a FIGURE
// BODY — taller than a line of print and not shaped like print, or carrying a
// stroke across most of its width (a table's rules, a graph's axis) — becomes
// a place the walk stops. With one in the crop:
//   · the walk may take up to TRIM_BANDS_MAX lines off a side rather than 3,
//     and the 20% / 50% caps go — the body it stops at is what is kept;
//   · an ANSWER LINE (a thin rule with writing space above it) is walked
//     through, but only beside a line of print, never as the first thing met
//     on its own — a lone stroke above a drawing can be part of the drawing;
//   · a SHORT line of print ("(ii) Substance 2") counts as wording when it
//     sticks out past the body's own left or right edge — a figure's labels
//     and its "Diagram 1" caption sit within it;
//   · the line touching the body is cut however small the gap, because the
//     two are different kinds of thing and the band split already proves
//     there is clear paper between them.
// The four-rule guard still applies, to the rules OUTSIDE every figure body
// that are not answer lines — a table drawn with horizontal rules only is a
// stack of thin bands and must still never be eaten row by row. With no
// figure body at all, everything is exactly what it was.
const ANSWER_LINE_GAP = 2;   // an answer line has at least this many gapMin of writing space above it
const STRONG_BAND = 2.5;     // a band this many line-heights tall is a figure body
const TRIM_BANDS_MAX = 12;   // lines one side may lose when a figure body is reached
const STICK_OUT = 0.02;      // past the body's own edge by this share of the crop = wording
function _trimEdgeTextLines(ctx, W, H, r, thr) {
  const TH_INK = (thr == null ? INK_DEFAULT : thr);
  const x = Math.round(r.x), w = Math.round(r.w);
  const y0 = Math.round(r.y), h = Math.round(Math.min(r.h, H - y0));
  if (w < 40 || h < 60) return r;
  const data = ctx.getImageData(x, y0, w, h).data;
  const rows = new Array(h);
  for (let ry = 0; ry < h; ry++) {
    let n = 0, minX = -1, maxX = -1, runs = 0, run = 0, maxRun = 0, prev = 0;
    const base = ry * w * 4;
    for (let rx = 0; rx < w; rx++) {
      const i = base + rx * 4;
      const on = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < TH_INK && data[i + 3] > 60) ? 1 : 0;
      if (on) {
        n++; if (minX < 0) minX = rx; maxX = rx;
        if (!prev) { runs++; run = 1; } else run++;
        if (run > maxRun) maxRun = run;
      } else run = 0;
      prev = on;
    }
    rows[ry] = { n, minX, maxX, runs, maxRun };
  }
  const inked = ry => rows[ry].n > Math.max(2, w * 0.004);
  const joinGap = Math.max(2, Math.round(H * 0.003));  // gaps inside one band (i-dots, accents)
  const gapMin = Math.max(5, Math.round(H * 0.007));   // whitespace that separates text from the figure
  const minBandH = Math.max(4, Math.round(H * 0.005)); // thinner = a border/rule line, keep it
  const maxBandH = Math.round(H * 0.028);              // taller = part of the figure, keep it
  const maxTrim = h * 0.20, minKeep = h * 0.50;

  // Every band in the crop, top to bottom, with the clear paper either side.
  // Joining across gaps is symmetric, so these are the same bands a walk from
  // either edge would find.
  const bands = [];
  for (let ry = 0; ry < h;) {
    while (ry < h && !inked(ry)) ry++;
    if (ry >= h) break;
    const s = ry;
    let e = ry, gap = 0, minX = w, maxX = 0, maxFrac = 0, maxRun = 0;
    const runList = [];
    for (; ry < h; ry++) {
      if (inked(ry)) {
        e = ry; gap = 0;
        if (rows[ry].minX < minX) minX = rows[ry].minX;
        if (rows[ry].maxX > maxX) maxX = rows[ry].maxX;
        if (rows[ry].n / w > maxFrac) maxFrac = rows[ry].n / w;
        if (rows[ry].maxRun > maxRun) maxRun = rows[ry].maxRun;
        runList.push(rows[ry].runs);
      } else if (++gap > joinGap) break;
    }
    ry = e + 1;
    runList.sort((a, b) => a - b);
    bands.push({ s, e, size: e - s + 1, minX, maxX, inkW: maxX - minX + 1, maxFrac, maxRun,
                 medRuns: runList.length ? runList[runList.length >> 1] : 0 });
  }
  if (!bands.length) return r;
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
  const isProse = b => !!b && b.size >= minBandH && b.size <= maxBandH
    && b.inkW >= w * 0.55 && printLike(b);
  const isLine = b => !!b && b.size < minBandH && b.inkW >= w * 0.45
    && b.above >= gapMin * ANSWER_LINE_GAP;
  const isStrong = b => b.size > maxBandH * 1.5
    && (b.maxRun >= b.inkW * 0.5 || (b.size >= maxBandH * STRONG_BAND && !printLike(b)));
  const strong = bands.map(isStrong);
  const coreMode = strong.some(Boolean);

  // A FRAMED TABLE IS THE FIGURE, and every one of its rows reads as prose on
  // its own. Trimmed row by row it comes back as its own bottom two thirds —
  // the one wrong crop that looks completely convincing. Four rules and not
  // three: an ordinary boxed diagram is a rule top, a rule bottom and a
  // divider across the middle, and at three this would stand down on half the
  // figures it was written to clean. In core mode only the rules OUTSIDE a
  // figure body, and that are not answer lines, are counted — see above.
  const skipRow = new Uint8Array(h);
  if (coreMode) bands.forEach((b, i) => {
    if (strong[i] || isLine(b)) for (let ry = b.s; ry <= b.e; ry++) skipRow[ry] = 1;
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
  // remembered only where a run reached real whitespace (or the figure body
  // itself), so a band with nothing but figure after it is still never touched.
  const walk = (order, dir) => {
    let core = -1;
    if (coreMode) for (const i of order) if (strong[i]) { core = i; break; }
    const C = core >= 0 ? bands[core] : null;
    const sticksOut = b => !!C && b.size >= minBandH && b.size <= maxBandH && printLike(b)
      && (b.minX < C.minX - w * STICK_OUT || b.maxX > C.maxX + w * STICK_OUT);
    const words = b => isProse(b) || sticksOut(b);
    let cut = null, eaten = 0;
    const max = C ? TRIM_BANDS_MAX : 3;
    for (let k = 0; k < order.length && eaten < max; k++) {
      const i = order[k], b = bands[i];
      if (i === core) break;
      const next = k + 1 < order.length ? bands[order[k + 1]] : null;
      const ok = words(b) || (C && isLine(b) && (eaten > 0 || (next && order[k + 1] !== core && words(next))));
      if (!ok) break;
      eaten++;
      const after = dir > 0 ? b.below : b.above;
      const end = dir > 0 ? b.e : b.s;
      if (after >= gapMin || (next && order[k + 1] === core)) cut = end + dir * (1 + Math.min(after, gapMin));
    }
    return { cut, core: C };
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
