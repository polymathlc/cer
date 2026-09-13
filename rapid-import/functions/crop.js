// Canvas adapter for the worksheet crop passes. The pixel helpers below are
// kept in step with index.html's browser crop pipeline (Math v1.66 / CER v1.359.0).
// No network calls, model redraws or Firebase dependencies: labels and fine
// lines come from the original page. A refused crop uses the caller's source
// page fallback and must remain visibly marked as needing manual cropping.
export function cropDiagram(canvas, box, createCanvas) {
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
  let r = { x: Math.max(0, xmin / 1000 * W - W * 0.02),
    y: Math.max(0, ymin / 1000 * H - H * 0.018) };
  r.w = Math.min(W, xmax / 1000 * W + W * 0.02) - r.x;
  r.h = Math.min(H, ymax / 1000 * H + H * 0.018) - r.y;
  if (r.w < 24 || r.h < 24) return null;
  try {
    const ctx = canvas.getContext('2d');
    const thr = _inkThreshold(ctx, W, H, r);
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
  const scale = Math.max(1, Math.min(2, 1600 / Math.max(r.w, r.h)));
  const w = Math.round(r.w * scale), h = Math.round(r.h * scale);
  const pad = Math.round(Math.max(16, Math.max(w, h) * 0.035));
  const out = createCanvas(w + pad * 2, h + pad * 2), ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, r.x, r.y, r.w, r.h, pad, pad, w, h);
  return out;
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
// Trims at most 3 bands and ~20% of the crop per side, keeps ≥ 50% of it.
const MAXRUN_FRAC = 0.30;  // a run of ink longer than this much of a band is a STROKE
const RUNS_MIN = 6;        // …and a line of print breaks into at least this many pieces
const RULE_FRAC = 0.55;    // a row carrying a run this wide is a printed RULE
const RULE_GROUPS = 4;     // …and this many of them is a framed table: hands off
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

  // Scan from `from` in direction `dir` (+1 top / −1 bottom): the first ink
  // band plus the whitespace gap that follows it.
  const band = (from, dir, limit) => {
    let s = from;
    while (s !== limit && !inked(s)) s += dir;
    if (s === limit) return null;
    let e = s, gap = 0, minX = w, maxX = 0, maxFrac = 0, maxRun = 0;
    const runList = [];
    for (let ry = s; ry !== limit; ry += dir) {
      if (inked(ry)) {
        e = ry; gap = 0;
        if (rows[ry].minX < minX) minX = rows[ry].minX;
        if (rows[ry].maxX > maxX) maxX = rows[ry].maxX;
        if (rows[ry].n / w > maxFrac) maxFrac = rows[ry].n / w;
        if (rows[ry].maxRun > maxRun) maxRun = rows[ry].maxRun;
        runList.push(rows[ry].runs);
      } else if (++gap > joinGap) break;
    }
    let after = 0;
    for (let ry = e + dir; ry !== limit && !inked(ry); ry += dir) after++;
    runList.sort((a, b) => a - b);
    return { end: e, size: Math.abs(e - s) + 1, inkW: maxX - minX + 1, maxFrac, maxRun,
             medRuns: runList.length ? runList[runList.length >> 1] : 0, after };
  };
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
  const isProse = b => !!b && b.size >= minBandH && b.size <= maxBandH
    && b.inkW >= w * 0.55 && b.maxFrac <= 0.6
    && b.maxRun <= b.inkW * MAXRUN_FRAC && b.medRuns >= RUNS_MIN;

  // A FRAMED TABLE IS THE FIGURE, and every one of its rows reads as prose on
  // its own. Trimmed row by row it comes back as its own bottom two thirds —
  // the one wrong crop that looks completely convincing. Four rules and not
  // three: an ordinary boxed diagram is a rule top, a rule bottom and a
  // divider across the middle, and at three this would stand down on half the
  // figures it was written to clean.
  let ruleGroups = 0, inRule = 0;
  for (let ry = 0; ry < h; ry++) {
    const isRule = rows[ry].maxRun >= w * RULE_FRAC;
    if (isRule && !inRule) ruleGroups++;
    inRule = isRule ? 1 : 0;
  }
  if (ruleGroups >= RULE_GROUPS) return r;

  // A RUN OF CONSECUTIVE LINES goes together. Two lines of a question sit a
  // few pixels apart — far less than the clear band that separates the
  // wording from the figure — so insisting on clear paper after the FIRST
  // line finds none, stops, and leaves both lines on the picture. The cut is
  // remembered only where a run reached real whitespace, so a band with
  // nothing but figure after it is still never touched.
  const eat = (from, dir, limit) => {
    let at = from, cut = null;
    for (let k = 0; k < 3; k++) {
      const b = band(at, dir, limit);
      if (!isProse(b)) break;
      if (b.after >= gapMin) cut = b.end + dir * (1 + Math.min(b.after, gapMin));
      at = b.end + dir;
      if (dir > 0 ? at >= limit : at <= limit) break;
    }
    return cut;
  };
  let top = 0, bot = h - 1;
  const t = eat(0, 1, h);
  if (t !== null && t <= maxTrim && bot - t + 1 >= minKeep) top = t;
  const b2 = eat(h - 1, -1, top - 1);
  if (b2 !== null && (h - 1 - b2) <= maxTrim && b2 - top + 1 >= minKeep) bot = b2;

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

