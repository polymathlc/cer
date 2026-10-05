// Logo shards on the public home page (landing-motion.js).
// Runs the SHIPPED file twice: bare, for the pure geometry, colour and layout
// core; and against a small fake page and canvas that records every vertex it
// is asked to draw. The promises the effect makes are checked, not eyeballed:
//   - the marks are small and very light: the big, bold logos must not return,
//   - they live in the side gutters only, so nothing is drawn over the content,
//   - the shards tile the logo exactly, with no gaps, overlaps or splinters,
//   - every build lands, every fall finishes, and then the loop goes to sleep,
//   - reduced motion, phones and tablets get nothing at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../landing-motion.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function run(window, document) {
  const module = { exports: {} };
  new Function('module', 'window', 'document', 'IntersectionObserver', source)(module, window, document, window && window.IntersectionObserver);
  return module.exports;
}
const C = run(undefined, undefined);

/* ---------- geometry helpers (independent of the code under test) ---------- */
const signed = p => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const area = p => Math.abs(signed(p));
const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
function convex(p) {
  let pos = 0, neg = 0;
  for (let i = 0; i < p.length; i++) {
    const t = turn(p[i], p[(i + 1) % p.length], p[(i + 2) % p.length]);
    if (t > 1e-6) pos++; else if (t < -1e-6) neg++;
  }
  return !(pos && neg);
}
/* Signed distance of q inside a convex polygon: > 0 inside, < 0 outside. */
function depth(p, q) {
  const s = Math.sign(signed(p));
  let d = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], L = dist(a, b);
    if (L > 1e-9) d = Math.min(d, s * turn(a, b, q) / L);
  }
  return d;
}
const box = ps => ps.flat().reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
/* WCAG contrast between two sRGB colours. */
function luminance(c) {
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgbOf = css => css.match(/\d+/g).map(Number);

test('it loads without a page, exports the core, and the page half stands down', () => {
  for (const name of ['rng', 'area', 'centroid', 'compact', 'cut', 'shatter', 'allot', 'tint', 'palette', 'plan', 'lane', 'usable', 'buildPose', 'fallStep']) {
    assert.equal(typeof C[name], 'function', name);
  }
  assert.equal(C.FACETS.length, 8);
  const empty = { getElementById: () => null };
  assert.doesNotThrow(() => run({ document: empty, requestAnimationFrame() {}, matchMedia: () => ({ matches: false }) }, empty));
});

test('the facets are the Polymath mark: convex, in its box, in its colours, never overlapping', () => {
  const logo = new Set(['#2e9ca6', '#56c4d0', '#056c76', '#ec008c', '#b51f6b', '#8a1650']);
  const M = C.MARK;
  for (const f of C.FACETS) {
    assert.ok(logo.has(f.hex), f.hex);
    assert.ok(convex(f.pts), 'facet must be convex: ' + f.hex);
    for (const [x, y] of f.pts) assert.ok(x >= M.x && x <= M.x + M.w && y >= M.y && y <= M.y + M.h);
  }
  const [x0, y0, x1, y1] = box(C.FACETS.map(f => f.pts));
  assert.deepEqual([x0, y0, x1 - x0, y1 - y0], [M.x, M.y, M.w, M.h], 'MARK is the bounding box of the facets');
  assert.deepEqual([M.cx, M.cy], [M.x + M.w / 2, M.y + M.h / 2]);
  for (let x = x0; x <= x1; x += 4) for (let y = y0; y <= y1; y += 4) {
    const owners = C.FACETS.filter(f => depth(f.pts, [x, y]) > 0.5).length;
    assert.ok(owners <= 1, `facets overlap at ${x},${y}`);
  }
});

test('every facet shatters into exactly the pieces asked for: a perfect tiling, no splinters', () => {
  for (const f of C.FACETS) {
    const A = area(f.pts), [x0, y0, x1, y1] = box([f.pts]);
    for (const n of [1, 2, 3, 5, 8]) for (let seed = 1; seed <= 25; seed++) {
      const parts = C.shatter(f.pts, n, C.rng(seed * 7919));
      assert.equal(parts.length, n);
      let sum = 0;
      for (const p of parts) {
        assert.ok(convex(p), 'shards are convex');
        for (const v of p) assert.ok(depth(f.pts, v) > -1e-6, 'shards stay inside their facet');
        assert.ok(C.compact(p) >= 0.35, 'no splinters: ' + C.compact(p).toFixed(3));
        if (n > 1) assert.ok(area(p) * n >= 0.08 * A, 'no crumbs');
        sum += area(p);
      }
      assert.ok(Math.abs(sum - A) <= A * 1e-9, 'shards cover the facet: no gaps');
      for (let x = x0; x <= x1; x += 9) for (let y = y0; y <= y1; y += 9) {
        assert.ok(parts.filter(p => depth(p, [x, y]) > 0.25).length <= 1, 'shards never overlap');
      }
    }
  }
});

test('a mark always breaks the same way, and different marks break differently', () => {
  const once = seed => JSON.stringify(C.shatter(C.FACETS[1].pts, 6, C.rng(seed)));
  assert.equal(once(42), once(42));
  assert.notEqual(once(42), once(43));
  const r = C.rng(5), seen = new Set();
  for (let i = 0; i < 1000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); seen.add(v); }
  assert.equal(seen.size, 1000);
});

test('a mark is small, but is made of many small pieces', () => {
  assert.ok(C.TUNE.maxMark <= 48, 'never a big logo');
  for (let G = 0; G <= 2000; G += 7) {
    const p = C.plan(G);
    if (!p) continue;
    assert.ok(p.max <= C.TUNE.maxMark && p.min >= C.TUNE.minMark && p.min <= p.max);
  }
  for (let w = C.TUNE.minMark; w <= C.TUNE.maxMark; w++) {
    const n = C.allot(Math.max(10, Math.round(w * C.TUNE.shardsPerPx)));
    assert.ok(n.every(k => k >= 1), 'every facet takes part');
    const total = n.reduce((s, k) => s + k, 0);
    assert.ok(total >= 12 && total <= 30, `${w}px mark: ${total} shards`);
  }
});

test('every colour stays very light: a whisper of the logo on the paper', () => {
  assert.deepEqual(C.PAPER, [242, 249, 250], 'tints fade toward the page paper, --lp-paper');
  assert.ok(C.TUNE.strength[0] < C.TUNE.strength[1] && C.TUNE.strength[1] <= 0.35);
  for (let s = C.TUNE.strength[0]; s <= C.TUNE.strength[1] + 1e-9; s += 0.02) {
    const pal = C.palette(s);
    assert.equal(pal.length, C.FACETS.length);
    for (const shades of pal) {
      assert.equal(shades.length, C.SHADES);
      for (const fill of shades) assert.ok(contrast(rgbOf(fill), C.PAPER) <= 1.6, `${fill} is too strong`);
    }
  }
  // each band keeps the logo's shading, front face lightest and shadow darkest, so the fold still reads
  for (const s of C.TUNE.strength) {
    const lum = C.palette(s).map(sh => luminance(rgbOf(sh[C.SHADES - 1])));
    assert.ok(lum[1] > lum[0] && lum[0] > lum[2], 'teal band: front, top, shadow');
    assert.ok(lum[5] > lum[4] && lum[4] > lum[6], 'pink band: front, top, shadow');
  }
});

test('marks live in the gutters, clear of the content column, and never overlap', () => {
  for (const G of [48, 60, 83, 120, 168, 240, 360, 500, 680]) for (const side of ['l', 'r']) {
    const p = C.plan(G), room = C.usable(p, side), vh = 900;
    assert.ok(p, `a ${G}px gutter takes marks`);
    assert.ok(room[0] >= 0 && room[1] <= G);
    const contentGap = side === 'l' ? G - room[1] : room[0];
    assert.ok(contentGap >= C.TUNE.innerMin, 'a clear margin before the content column');
    for (let lane = 0; lane < p.lanes; lane++) {
      const next = C.lane(p, side, lane, vh, 7 + lane), seen = [];
      for (let i = 0; i < 60; i++) {
        const m = next();
        assert.ok(m.w >= p.min - 1e-9 && m.w <= p.max + 1e-9);
        assert.ok(m.x - m.w / 2 >= room[0] - 1e-9 && m.x + m.w / 2 <= room[1] + 1e-9, `${G}/${side}: mark leaves the gutter`);
        if (seen.length) assert.ok(m.y - seen[seen.length - 1].y >= C.TUNE.spacing[0] * vh - 1e-9 && m.y - seen[seen.length - 1].y > m.w);
        seen.push(m);
      }
    }
  }
});

test('phones and tablets have no side margins, so they get no marks', () => {
  for (const G of [undefined, NaN, -5, 0, 20, 32]) assert.equal(C.plan(G), null, String(G));
});

test('a build starts invisible and lands exactly in place', () => {
  const sh = { delay: 0.2, sx: 30, sy: -40, sr: 1.1, sf: 2 }, F = C.TUNE.build.flight;
  assert.equal(C.buildPose(sh, 0).alpha, 0);
  assert.equal(C.buildPose(sh, 0.2).alpha, 0);
  const end = C.buildPose(sh, 0.2 + F);
  assert.deepEqual({ ...end }, { dx: 0, dy: 0, rot: 0, fa: 0, scale: 1, alpha: 1, done: true });
  let prev = C.buildPose(sh, 0.2);
  for (let t = 0.2; t <= 0.2 + F; t += 0.02) {
    const p = C.buildPose(sh, t);
    assert.ok(Math.abs(p.dx) <= Math.abs(prev.dx) + 1e-9 && Math.abs(p.dy) <= Math.abs(prev.dy) + 1e-9, 'always closing in');
    assert.ok(p.alpha >= prev.alpha - 1e-9, 'never fades while arriving');
    prev = p;
  }
});

test('a broken shard rides the page until the crack frees it, then falls, keeps to its gutter and fades out', () => {
  const lo = 12, hi = 106;
  const shard = over => ({ x: 60, y: 300, vx: 0, vy: -30, rot: 0, fa: 0, scale: 1, sc: 1, a0: 1, alpha: 1, rel: 0.1, ft: 0, wr: 1, wf: 2, fl: 2, fp: 0, famp: 30, life: 2.6, ...over });
  const s = shard();
  assert.equal(C.fallStep(s, 0.05, 20, lo, hi), true);
  assert.equal(s.y, 300 - 20 * C.TUNE.parallax, 'still attached: moves exactly with the page');
  let t = 0.05, alive = true, lowest = s.y;
  while (alive && t < 10) { alive = C.fallStep(s, 1 / 60, 0, lo, hi); t += 1 / 60; lowest = Math.max(lowest, s.y); }
  assert.equal(alive, false, 'the fall finishes');
  assert.ok(t <= s.rel + s.life + 0.05);
  assert.ok(s.alpha <= 1e-9, 'faded out');
  assert.ok(lowest > 300 + 150, 'it really falls');
  for (const vx of [-260, 260]) {
    const w = shard({ vx, x: vx < 0 ? lo + 2 : hi - 2, rel: 0 });
    for (let i = 0; i < 200 && C.fallStep(w, 1 / 60, 0, lo, hi); i++) assert.ok(w.x >= lo - 4 && w.x <= hi + 4, 'kept in the gutter');
  }
});

/* ---------- the page half, against a fake page that records what is drawn ---------- */
function fakePage({ width = 1440, height = 900, wrap = [120, width - 120], reduced = false, hidden = false, dpr = 2 } = {}) {
  const raf = [], listeners = {}, inserted = [], canvases = [];
  let clock = 1000;
  function context(canvas) {
    let m = [1, 0, 0, 1, 0, 0];
    return {
      canvas, fills: 0, partial: 0, minX: Infinity, maxX: -Infinity, globalAlpha: 1, fillStyle: '',
      setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f]; },
      clearRect() {}, beginPath() {}, closePath() {},
      moveTo(x, y) { this.point(x, y); }, lineTo(x, y) { this.point(x, y); },
      point(x, y) { const X = m[0] * x + m[2] * y + m[4]; this.minX = Math.min(this.minX, X); this.maxX = Math.max(this.maxX, X); },
      fill() { this.fills++; if (this.globalAlpha < 1) this.partial++; }
    };
  }
  function element(tag) {
    const el = { tagName: tag.toUpperCase(), style: {}, attrs: {}, className: '', width: 300, height: 150, setAttribute(k, v) { this.attrs[k] = String(v); } };
    if (tag === 'canvas') { el.ctx = context(el); el.getContext = () => el.ctx; canvases.push(el); }
    return el;
  }
  const rect = (left, right, top, bottom) => ({ getBoundingClientRect: () => ({ left, right, top, bottom, width: right - left, height: bottom - top }) });
  const header = { ...rect(0, width, 0, 82), classList: { toggle() {} } };
  const root = {
    offsetHeight: hidden ? 0 : 6000, firstChild: null, style: {}, classList: { add() {}, contains: () => false },
    insertBefore(node) { inserted.push(node); },
    querySelector: sel => (sel === '.lp-header' ? header : sel === 'main .lp-wrap' ? rect(wrap[0], wrap[1], 120, 900) : null),
    querySelectorAll: () => []
  };
  const document = {
    getElementById: id => (id === 'landingPage' ? root : null),
    createElement: element,
    documentElement: { clientWidth: width, scrollHeight: 6000, scrollTop: 0 }
  };
  const window = {
    document, innerWidth: width, innerHeight: height, devicePixelRatio: dpr, pageYOffset: 0,
    matchMedia: () => ({ matches: reduced, addEventListener() {} }),
    requestAnimationFrame(cb) { raf.push(cb); return raf.length; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    IntersectionObserver: class { observe() {} unobserve() {} }
  };
  return {
    window, document, inserted, canvases, raf, listeners,
    frame() { clock += 1000 / 60; const q = raf.splice(0); q.forEach(cb => cb(clock)); return q.length; },
    scrollBy(dy) { window.pageYOffset += dy; document.documentElement.scrollTop = window.pageYOffset; (listeners.scroll || []).forEach(fn => fn({})); },
    runUntilIdle(limitSeconds) { let n = 0; while (raf.length && n < limitSeconds * 60) { this.frame(); n++; } return raf.length === 0; }
  };
}

test('on a desktop page it draws only inside the two gutter strips, and sleeps when nothing moves', () => {
  const p = fakePage({ width: 1440, height: 900, wrap: [120, 1320], dpr: 2 });
  run(p.window, p.document);
  const strips = p.canvases;
  assert.deepEqual(strips.map(c => c.className).sort(), ['lp-shards lp-shards-l', 'lp-shards lp-shards-r']);
  for (const c of strips) {
    assert.equal(c.attrs['aria-hidden'], 'true');
    assert.equal(c.style.display, 'block');
    assert.equal(c.style.width, '120px', 'exactly as wide as the gutter');
    assert.equal(c.width, 240, 'backed at the device pixel ratio');
  }
  assert.ok(p.runUntilIdle(6), 'the marks build themselves, then the loop sleeps');
  const built = strips.map(c => c.ctx.fills);
  assert.ok(built.every(n => n > 0), 'both gutters draw marks');
  for (let i = 0; i < 150; i++) { p.scrollBy(10); p.frame(); }   // read down the page at 600px/s
  const moving = strips.reduce((s, c) => s + c.ctx.partial, 0);
  assert.ok(p.runUntilIdle(8), 'every fall finishes and the loop sleeps again');
  assert.ok(moving > 0, 'scrolling builds and breaks marks');
  for (const c of strips) {
    assert.ok(c.ctx.minX >= -0.5 && c.ctx.maxX <= c.width + 0.5, `${c.className}: drawn x ${c.ctx.minX.toFixed(1)}..${c.ctx.maxX.toFixed(1)} of ${c.width}`);
  }
});

test('phones and tablets get the strips hidden and no animation loop at all', () => {
  for (const [width, wrap] of [[390, [20, 370]], [1024, [32, 992]]]) {
    const p = fakePage({ width, wrap });
    run(p.window, p.document);
    assert.ok(p.canvases.every(c => c.style.display !== 'block'), 'the stylesheet keeps them hidden; nothing shows them');
    assert.equal(p.raf.length, 0);
    p.scrollBy(400);
    assert.equal(p.raf.length, 1, 'only the progress bar listens to the scroll');
    p.frame();
    assert.equal(p.raf.length, 0);
    assert.ok(p.canvases.every(c => c.ctx.fills === 0));
  }
});

test('reduced motion: nothing is inserted into the page and nothing listens', () => {
  const p = fakePage({ reduced: true });
  run(p.window, p.document);
  assert.equal(p.inserted.length, 0);
  assert.equal(p.canvases.length, 0);
  assert.equal((p.listeners.scroll || []).length, 0);
  assert.equal(p.raf.length, 0);
});

test('while the home page is hidden (signed in) nothing is drawn', () => {
  const p = fakePage({ hidden: true });
  run(p.window, p.document);
  p.scrollBy(300);
  p.runUntilIdle(2);
  assert.ok(p.canvases.every(c => c.ctx.fills === 0));
});

test('index.html loads it and keeps the layer between the content and the header', () => {
  assert.match(html, /<script defer src="landing-motion\.js"><\/script>/);
  const esc = sel => sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = sel => (html.match(new RegExp('(?:^|\\n)' + esc(sel) + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
  const media = query => {               /* the bodies of every @media block for this query */
    const out = [];
    for (let i = html.indexOf(query); i !== -1; i = html.indexOf(query, i + 1)) {
      let j = html.indexOf('{', i), d = 0, k = j;
      for (; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) break; }
      out.push(html.slice(j + 1, k));
    }
    return out;
  };
  const hides = query => media(query).some(b => /#landingPage \.lp-shards[^{]*\{[^}]*display:none/.test(b));
  const strips = rule('#landingPage .lp-shards');
  assert.match(strips, /position:fixed/);
  assert.match(strips, /pointer-events:none/);
  const z = +(strips.match(/z-index:(\d+)/) || [])[1];
  const content = +(rule('#landingPage main, #landingPage .lp-footer').match(/z-index:(\d+)/) || [])[1];
  const header = +(rule('#landingPage .lp-header').match(/z-index:(\d+)/) || [])[1];
  assert.ok(content < z && z < header, `content ${content} < shards ${z} < header ${header}`);
  assert.ok(hides('@media (prefers-reduced-motion:reduce)'), 'hidden under reduced motion');
  assert.ok(hides('@media print'), 'never printed');
  assert.doesNotMatch(html, /lp-shapes|lp-shape\b/, 'the old big-logo layer is gone');
});
