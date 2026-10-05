/* Scroll-driven motion for the public home page (#landingPage).
   Progressive enhancement: with no JS, no IntersectionObserver or a
   reduced-motion preference, nothing is hidden and nothing moves. */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var root = document.getElementById('landingPage');
  if (!root) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;

  var GROUPS = [
    '.lp-capabilities .lp-wrap > span',
    '.lp-why-grid > *', '.lp-why-modes > *', '.lp-feature-grid > *',
    '.lp-steps > *', '.lp-about-method > li', '.lp-about-programmes > *',
    '.lp-teacher-list > *', '.lp-faq-list > *'
  ];
  var SINGLES = [
    '.lp-section-head', '.lp-demo-grid > *', '.lp-game-card', '.lp-teacher-card',
    '.lp-about-story', '.lp-about-contact', '.lp-faq-intro', '.lp-closing-inner',
    '.lp-experiment', '.lp-worked', '.lp-extras'
  ];

  var targets = [];
  function mark(el, i) {
    if (el.hasAttribute('data-lp-reveal')) return;
    el.setAttribute('data-lp-reveal', '');
    el.style.setProperty('--lp-i', Math.min(i, 6));
    targets.push(el);
  }
  GROUPS.forEach(function (sel) {
    root.querySelectorAll(sel).forEach(function (el, i) { mark(el, i); });
  });
  SINGLES.forEach(function (sel) {
    root.querySelectorAll(sel).forEach(function (el, i) { mark(el, i); });
  });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        var el = e.target;
        el.classList.add('lp-in');
        io.unobserve(el);
        /* Hand the element back to its own hover styles once it has appeared. */
        var done = function (ev) {
          if (ev && ev.target !== el) return;
          el.removeEventListener('transitionend', done);
          el.removeAttribute('data-lp-reveal');
          el.classList.remove('lp-in');
          el.style.removeProperty('--lp-i');
        };
        el.addEventListener('transitionend', done);
        setTimeout(done, 1800);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  root.classList.add('lp-motion');
  targets.forEach(function (el) { io.observe(el); });

  /* Scroll progress bar + header shadow + hero orbit drift, one rAF per frame. */
  var bar = document.createElement('div');
  bar.className = 'lp-progress';
  bar.setAttribute('aria-hidden', 'true');
  root.insertBefore(bar, root.firstChild);
  var header = root.querySelector('.lp-header');
  var orbit = root.querySelector('.lp-orbit');
  var ticking = false;

  function frame() {
    ticking = false;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    bar.style.transform = 'scaleX(' + Math.min(1, y / max).toFixed(4) + ')';
    if (header) header.classList.toggle('lp-scrolled', y > 8);
    if (orbit && y < 900) orbit.style.transform = 'translateY(' + (y * 0.12).toFixed(1) + 'px) rotate(' + (y * 0.05).toFixed(1) + 'deg)';
  }
  function onScroll() {
    if (!ticking) { ticking = true; window.requestAnimationFrame(frame); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  frame();
})();

/* Logo shards: small, very light copies of the Polymath mark live in the side
   gutters. As the visitor scrolls, each one builds itself from many small
   shards, rides up with the page, then cracks and falls apart before it
   reaches the header. Two fixed canvas strips cover the gutters and nothing
   else, so nothing is ever drawn over the content column. The loop sleeps when
   nothing moves. Skipped under prefers-reduced-motion, and wherever the
   gutters are too narrow for a mark (phones, tablets).
   The geometry and timing are pure functions, exported for the Node harness
   (tools/landing-shards-tests.mjs in polymathlc/cer). */
(function (global) {
  'use strict';

  var PAPER = [242, 249, 250];               /* --lp-paper: every tint fades toward it */
  var MARK = { x: 522, y: 160, w: 690, h: 625, cx: 867, cy: 472.5 };
  /* The mark's facets, traced from assets/branding/polymath-learning-centre.png in
     its 2000px display units. They tile the mark without overlapping, listed in
     the order the mark builds itself: teal band, its leg, pink band, its leg. */
  var FACETS = [
    { hex: '#2e9ca6', pts: [[522, 338], [647, 213], [990, 387], [866, 513]] },
    { hex: '#56c4d0', pts: [[522, 338], [866, 513], [902, 736], [556, 562]] },
    { hex: '#056c76', pts: [[556, 562], [728, 650], [680, 697]] },
    { hex: '#2e9ca6', pts: [[556, 562], [680, 697], [591, 785]] },
    { hex: '#b51f6b', pts: [[836, 308], [984, 160], [1142, 240], [990, 387]] },
    { hex: '#ec008c', pts: [[866, 513], [990, 387], [1142, 240], [1175, 467], [902, 736]] },
    { hex: '#8a1650', pts: [[1175, 467], [1100, 630], [1040, 600]] },
    { hex: '#b51f6b', pts: [[1175, 467], [1212, 687], [1100, 630]] }
  ];
  /* Magenta reads louder than teal at the same strength, so it is held back. */
  var HUE_WEIGHT = { '#ec008c': 0.72, '#b51f6b': 0.82, '#8a1650': 0.82 };
  var SHADES = 5;                            /* face-on .. edge-on, for a turning shard */

  var TUNE = {
    minMark: 20,                             /* px: a gutter that cannot hold this gets no marks */
    maxMark: 46,                             /* px: never a big logo */
    edge: 0.1, edgeMin: 5,                   /* clear of the screen edge: share of gutter, floor px */
    inner: 0.12, innerMin: 8,                /* clear of the content column */
    strength: [0.15, 0.27],                  /* share of logo colour mixed into the paper, far..near */
    spacing: [0.3, 0.48],                    /* gap between marks in one lane, x viewport height */
    parallax: 0.9,                           /* marks ride a little slower than the page */
    shardsPerPx: 0.5,                        /* shards per px of mark width */
    build: { stagger: 0.075, jitter: 0.16, flight: 0.9 },
    fall: { life: 2.6, fadeFrom: 0.3, gravity: 380, drag: 1.25, dragX: 2.2, crack: 0.16, couple: 0.18 },
    zone: { top: 0.16, bottom: 0.94, hysteresis: 36 },   /* break line under the header, build line near the bottom, x vh */
    calm: 2200,                              /* px/s: faster than this, nothing new starts building */
    lean: 0.0001, leanMax: 0.08,             /* rad per px/s of scroll, and the most a mark leans */
    intro: 0.35                              /* s after load before the first marks build */
  };

  /* ---------- pure core ---------- */

  function rng(seed) {                       /* mulberry32: the same seed breaks the same way */
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function area(poly) {
    var a = 0;
    for (var i = 0, n = poly.length; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  }
  function centroid(poly) {
    var a = 0, x = 0, y = 0, n = poly.length, i;
    for (i = 0; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n], c = p[0] * q[1] - q[0] * p[1];
      a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c;
    }
    if (Math.abs(a) < 1e-9) {
      for (x = 0, y = 0, i = 0; i < n; i++) { x += poly[i][0]; y += poly[i][1]; }
      return [x / n, y / n];
    }
    return [x / (3 * a), y / (3 * a)];
  }
  function lerpPt(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  /* 1 for a circle, about 0.6 for a fair triangle, near 0 for a needle. */
  function compact(poly) {
    var per = 0;
    for (var i = 0, n = poly.length; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n];
      per += Math.sqrt((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]));
    }
    return per ? 4 * Math.PI * area(poly) / (per * per) : 0;
  }
  /* The two halves of a convex polygon either side of the chord p (on edge i) to q (on edge j). */
  function halves(poly, i, p, j, q) {
    var n = poly.length, A = [p], B = [q], k;
    for (k = (i + 1) % n; ; k = (k + 1) % n) { A.push(poly[k]); if (k === j) break; }
    A.push(q);
    for (k = (j + 1) % n; ; k = (k + 1) % n) { B.push(poly[k]); if (k === i) break; }
    B.push(p);
    return [A, B];
  }

  /* Split a convex polygon in two along a straight crack at a random angle
     through a point near its middle. A dozen tries, keeping the split whose
     smaller half is fairest and least needle-like, so no shard is a splinter. */
  function cut(poly, rnd) {
    var n = poly.length, c = centroid(poly), best = null, k;
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (k = 0; k < n; k++) {
      x0 = Math.min(x0, poly[k][0]); x1 = Math.max(x1, poly[k][0]);
      y0 = Math.min(y0, poly[k][1]); y1 = Math.max(y1, poly[k][1]);
    }
    for (var tries = 0; tries < 14; tries++) {
      var px = c[0] + (rnd() - 0.5) * (x1 - x0) * 0.35, py = c[1] + (rnd() - 0.5) * (y1 - y0) * 0.35;
      var th = rnd() * Math.PI, dx = Math.cos(th), dy = Math.sin(th), hits = [];
      for (k = 0; k < n; k++) {
        var a = poly[k], b = poly[(k + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1];
        var den = ex * dy - ey * dx;
        if (Math.abs(den) < 1e-9) continue;
        var s = ((px - a[0]) * dy - (py - a[1]) * dx) / den;
        if (s >= 0 && s < 1) hits.push({ k: k, s: s, p: [a[0] + ex * s, a[1] + ey * s] });
      }
      if (hits.length !== 2 || hits[0].s < 0.06 || hits[0].s > 0.94 || hits[1].s < 0.06 || hits[1].s > 0.94) continue;
      var parts = halves(poly, hits[0].k, hits[0].p, hits[1].k, hits[1].p);
      var aA = area(parts[0]), aB = area(parts[1]);
      var score = Math.min(1, Math.min(aA, aB) / (aA + aB) / 0.28) * Math.min(1, Math.min(compact(parts[0]), compact(parts[1])) / 0.42);
      if (!best || score > best.score) best = { parts: parts, score: score };
      if (score >= 1) break;
    }
    if (best) return best.parts;
    var m = Math.floor(n / 2);                /* degenerate input: straight across the middle */
    return halves(poly, 0, lerpPt(poly[0], poly[1 % n], 0.5), m, lerpPt(poly[m], poly[(m + 1) % n], 0.5));
  }

  /* Break a convex polygon into n shards, cutting mostly (not always) the
     biggest piece, so the shards come out in a natural spread of sizes. */
  function shatter(poly, n, rnd) {
    var parts = [poly.map(function (p) { return [p[0], p[1]]; })];
    while (parts.length < n) {
      var weights = parts.map(function (q) { var a = area(q); return a * a; });
      var total = weights.reduce(function (s, v) { return s + v; }, 0), r = rnd() * total, bi = 0;
      while (bi < parts.length - 1 && (r -= weights[bi]) > 0) bi++;
      var two = cut(parts[bi], rnd);
      parts.splice(bi, 1, two[0], two[1]);
    }
    return parts;
  }

  /* Shards per facet for a mark of about `total` shards: by area, at least one. */
  function allot(total) {
    var areas = FACETS.map(function (f) { return area(f.pts); });
    var sum = areas.reduce(function (s, a) { return s + a; }, 0);
    return areas.map(function (a) { return Math.max(1, Math.round(total * a / sum)); });
  }

  function hexRgb(hex) { var v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  /* A logo colour mixed into the paper: strength 0 is paper, 1 the logo itself. */
  function tint(hex, strength) {
    var c = hexRgb(hex);
    return [0, 1, 2].map(function (i) { return Math.round(PAPER[i] + (c[i] - PAPER[i]) * strength); });
  }
  function css(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  /* One mark's fills: per facet, SHADES steps from face-on (index SHADES-1)
     to edge-on (index 0, lighter: a turning shard catches the light). */
  function palette(strength) {
    return FACETS.map(function (f) {
      var s = strength * (HUE_WEIGHT[f.hex] || 1), out = [];
      for (var l = 0; l < SHADES; l++) out.push(css(tint(f.hex, s * (0.6 + 0.4 * l / (SHADES - 1)))));
      return out;
    });
  }

  /* What a gutter G px wide can hold, or null when there is no room for a mark. */
  function plan(G) {
    if (!(G > 0)) return null;
    var edge = Math.max(TUNE.edgeMin, G * TUNE.edge), inner = Math.max(TUNE.innerMin, G * TUNE.inner);
    var max = Math.min(TUNE.maxMark, G - edge - inner);
    if (max < TUNE.minMark) return null;
    return {
      G: G, edge: edge, inner: inner, max: max,
      min: Math.max(TUNE.minMark, max * 0.6),
      lanes: Math.max(1, Math.min(3, Math.floor(G / 150)))
    };
  }

  /* An endless walk down one lane of one gutter, yielding marks in document
     coordinates: centre x within the strip, y, width, depth (0 far, 1 near). */
  function lane(p, side, index, vh, seed) {
    var rnd = rng(seed), room = usable(p, side), width = (room[1] - room[0]) / p.lanes;
    var lo = room[0] + width * index, hi = lo + width;
    var y = vh * (0.3 + 0.25 * rnd()) + (side === 'r' ? vh * 0.2 : 0) + index * vh * 0.15;
    var spread = 1 + 0.5 * (p.lanes - 1);
    return function () {
      var depth = Math.pow(rnd(), 0.8), w = p.min + (p.max - p.min) * depth;
      var a = lo + w / 2, b = hi - w / 2;
      var mark = {
        side: side, x: a < b ? a + (b - a) * (0.5 + (rnd() + rnd() - 1) * 0.5) : (lo + hi) / 2,
        y: y, w: w, depth: depth,
        strength: TUNE.strength[0] + (TUNE.strength[1] - TUNE.strength[0]) * depth,
        tilt: (rnd() - 0.5) * 0.17, sway: 0.6 + rnd() * 0.8,
        seed: (rnd() * 4294967296) >>> 0
      };
      y += vh * (TUNE.spacing[0] + (TUNE.spacing[1] - TUNE.spacing[0]) * rnd()) * spread;
      return mark;
    };
  }
  /* The strip's usable x range: away from the screen edge and the content column. */
  function usable(p, side) { return side === 'l' ? [p.edge, p.G - p.inner] : [p.inner, p.G - p.edge]; }

  function ease(u) { return 1 - Math.pow(1 - u, 4); }       /* quick start, long soft landing */
  function smooth(u) { return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u); }

  var WHOLE = { dx: 0, dy: 0, rot: 0, fa: 0, scale: 1, alpha: 1, done: true };
  /* A shard t seconds into its mark's build: offset (px), spin, flip angle, scale, alpha. */
  function buildPose(sh, t) {
    var u = (t - sh.delay) / TUNE.build.flight;
    if (u >= 1) return WHOLE;
    if (u <= 0) return { dx: sh.sx, dy: sh.sy, rot: sh.sr, fa: sh.sf, scale: 0.55, alpha: 0, done: false };
    var e = ease(u), r = 1 - e;
    return { dx: sh.sx * r, dy: sh.sy * r, rot: sh.sr * r, fa: sh.sf * r, scale: 0.55 + 0.45 * e, alpha: smooth(u / 0.45), done: false };
  }

  /* Advance one falling shard by dt seconds; scrollDy is how far the page moved
     this frame and [lo, hi] the strip's usable x range. A shard rides the page
     until the crack reaches it, then lets go gradually and falls, kept off the
     content column by a soft wall. Returns false once it has faded out. */
  function fallStep(sh, dt, scrollDy, lo, hi) {
    var F = TUNE.fall;
    sh.ft += dt;
    var free = sh.ft - sh.rel;
    if (free <= 0) { sh.y -= scrollDy * TUNE.parallax; return true; }
    sh.y -= scrollDy * TUNE.parallax * Math.exp(-free / F.couple);
    sh.vy = (sh.vy + F.gravity * dt) * Math.exp(-F.drag * dt);
    sh.vx = (sh.vx + Math.sin(free * sh.fl + sh.fp) * sh.famp * dt) * Math.exp(-F.dragX * dt);
    if (sh.x < lo) sh.vx += (lo - sh.x) * 80 * dt;
    else if (sh.x > hi) sh.vx -= (sh.x - hi) * 80 * dt;
    sh.x = Math.min(hi + 4, Math.max(lo - 4, sh.x + sh.vx * dt)); sh.y += sh.vy * dt;
    sh.rot += sh.wr * dt; sh.fa += sh.wf * dt;
    var u = free / sh.life;
    sh.alpha = sh.a0 * (1 - smooth((u - F.fadeFrom) / (1 - F.fadeFrom)));
    sh.sc = sh.scale * (1 - 0.2 * smooth(u));
    return u < 1;
  }

  var Core = {
    PAPER: PAPER, MARK: MARK, FACETS: FACETS, TUNE: TUNE, SHADES: SHADES,
    rng: rng, area: area, centroid: centroid, compact: compact, cut: cut, shatter: shatter, allot: allot,
    tint: tint, palette: palette, plan: plan, lane: lane, usable: usable,
    buildPose: buildPose, fallStep: fallStep, ease: ease, smooth: smooth
  };
  if (typeof module === 'object' && module && module.exports) module.exports = Core;

  /* ---------- browser ---------- */

  var doc = global.document;
  if (!doc || !global.requestAnimationFrame) return;
  var root = doc.getElementById('landingPage');
  if (!root) return;
  var motion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)');
  if (motion && motion.matches) return;

  var FACET_PATHS = FACETS.map(function (f) {
    return f.pts.map(function (p) { return [p[0] - MARK.cx, p[1] - MARK.cy]; });
  });
  var sides = {}, marks = [], walkers = [];
  var dpr = 1, vh = 0, docH = 0, bandTop = 0;
  var enabled = false, dead = false, running = false, lastT = 0, lastY = global.pageYOffset || 0, vel = 0, dir = 1;
  var intro = true;

  ['l', 'r'].forEach(function (side) {
    var el = doc.createElement('canvas');
    el.className = 'lp-shards lp-shards-' + side;
    el.setAttribute('aria-hidden', 'true');
    root.insertBefore(el, root.firstChild);
    sides[side] = { side: side, el: el, ctx: el.getContext('2d'), plan: null, key: '' };
  });

  function strip(s, G) {
    var p = plan(G), key = p ? [G, vh, dpr].join(':') : '';
    if (key === s.key) return false;
    s.key = key; s.plan = p;
    s.el.style.display = p ? 'block' : 'none';
    if (p) {
      s.el.style.width = G + 'px'; s.el.style.height = vh + 'px';
      s.el.width = Math.round(G * dpr); s.el.height = Math.round(vh * dpr);
    }
    return true;
  }

  function newMark(s) { return { s: s, state: 'empty', t0: 0, shards: null, pal: palette(s.strength), tilt: 0, x: s.x, y: s.y, n: 0 }; }

  function walk() {                          /* add marks down to the bottom of the reachable page */
    var maxY = TUNE.parallax * Math.max(0, docH - vh) + vh * 0.9;
    walkers.forEach(function (w) {
      for (;;) {
        var m = w.held || w.next();
        w.held = null;
        if (m.y > maxY) { w.held = m; break; }
        marks.push(newMark(m));
      }
    });
  }

  function layout() {
    marks = []; walkers = [];
    ['l', 'r'].forEach(function (side, si) {
      var p = sides[side].plan;
      for (var k = 0; p && k < p.lanes; k++) walkers.push({ next: lane(p, side, k, vh, 7 + si * 101 + k * 31) });
    });
    walk();
  }

  function measure() {
    if (dead) return;
    var de = doc.documentElement;
    if (!root.offsetHeight) { enabled = false; clear(); return; }   /* signed in: the home page is hidden */
    vh = global.innerHeight; dpr = Math.min(global.devicePixelRatio || 1, 2);
    var wrap = root.querySelector('main .lp-wrap'), vw = de.clientWidth;
    var r = wrap ? wrap.getBoundingClientRect() : { left: 0, right: vw };
    var header = root.querySelector('.lp-header');
    bandTop = (header ? Math.max(0, header.getBoundingClientRect().bottom) : 0) + vh * TUNE.zone.top;
    var changed = strip(sides.l, Math.floor(r.left));
    changed = strip(sides.r, Math.floor(vw - r.right)) || changed;
    var h = de.scrollHeight;
    if (changed || !marks.length) { docH = h; layout(); }
    else if (h > docH + 40) { docH = h; walk(); }
    enabled = !!(sides.l.plan || sides.r.plan);
    if (!enabled) clear();
    kick();
  }

  function shardsOf(m) {
    var rnd = rng(m.s.seed), out = [], counts = allot(Math.max(10, Math.round(m.s.w * TUNE.shardsPerPx)));
    FACETS.forEach(function (f, fi) {
      shatter(f.pts, counts[fi], rnd).forEach(function (poly) {
        var c = centroid(poly);
        out.push({ f: fi, c: [c[0] - MARK.cx, c[1] - MARK.cy], pts: poly.map(function (p) { return [p[0] - c[0], p[1] - c[1]]; }) });
      });
    });
    return out;
  }

  function startBuild(m, now, wait) {
    if (!m.shards) m.shards = shardsOf(m);
    var S = m.s.w / MARK.w, room = usable(sides[m.s.side].plan, m.s.side), rnd = rng(m.s.seed + (++m.n) * 7919);
    m.shards.forEach(function (sh) {
      var ox = sh.c[0] * S, oy = sh.c[1] * S;
      var ang = Math.atan2(oy, ox) + (rnd() - 0.5) * 1.2, dist = m.s.w * (0.7 + rnd() * 1.1);
      var x0 = m.x + ox + Math.cos(ang) * dist;
      sh.sx = Math.min(room[1], Math.max(room[0], x0)) - m.x - ox;   /* fly in from within the gutter */
      sh.sy = Math.sin(ang) * dist * 0.7 + dir * m.s.w * (0.6 + rnd() * 0.6);
      sh.sr = (rnd() - 0.5) * 2.6;
      sh.sf = (rnd() < 0.5 ? -1 : 1) * (1.1 + rnd() * 1.4);
      sh.delay = wait + sh.f * TUNE.build.stagger + rnd() * TUNE.build.jitter;
    });
    m.state = 'build'; m.t0 = now;
  }

  function startFall(m, now, energy) {
    var S = m.s.w / MARK.w, R = m.s.tilt + m.tilt, co = Math.cos(R), si = Math.sin(R);
    var rnd = rng(m.s.seed ^ (m.n * 2654435761));
    var ox = (rnd() - 0.5) * m.s.w * 0.5, oy = (rnd() - 0.6) * m.s.w * 0.4;   /* where the crack starts */
    m.shards.forEach(function (sh) {
      var pose = m.state === 'build' ? buildPose(sh, now - m.t0) : WHOLE;
      var lx = sh.c[0] * S, ly = sh.c[1] * S;
      sh.x = m.x + lx * co - ly * si + pose.dx; sh.y = m.y + lx * si + ly * co + pose.dy;
      sh.rot = R + pose.rot; sh.fa = pose.fa; sh.scale = sh.sc = pose.scale; sh.a0 = sh.alpha = pose.alpha;
      var dx = lx - ox, dy = ly - oy, d = Math.sqrt(dx * dx + dy * dy) || 1;
      sh.rel = d / m.s.w * TUNE.fall.crack + rnd() * 0.05;
      var sp = (16 + rnd() * 40) * energy;
      sh.vx = dx / d * sp + (rnd() - 0.5) * 12;
      sh.vy = dy / d * sp * 0.6 - (12 + rnd() * 34) * energy;
      sh.wr = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 1.8);
      sh.wf = (rnd() < 0.5 ? -1 : 1) * (1.4 + rnd() * 3);
      sh.fl = 1.6 + rnd() * 1.8; sh.fp = rnd() * 6.283; sh.famp = 18 + rnd() * 38;
      sh.life = TUNE.fall.life * (0.85 + rnd() * 0.3);
      sh.ft = 0;
    });
    m.state = 'fall'; m.t0 = now;
  }

  function step(now, dt, dy) {
    var busy = false, y = global.pageYOffset || 0, Z = TUNE.zone, queued = [];
    var energy = 1 + Math.min(Math.abs(vel) / 1600, 0.8);
    var lean = Math.max(-TUNE.leanMax, Math.min(TUNE.leanMax, -vel * TUNE.lean)), settle = 1 - Math.exp(-dt / 0.22);
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i], s = m.s;
      m.y = s.y - y * TUNE.parallax;
      if (m.state === 'fall') {
        var room = usable(sides[s.side].plan, s.side), live = false;
        for (var k = 0; k < m.shards.length; k++) if (fallStep(m.shards[k], dt, dy, room[0], room[1])) live = true;
        if (live) busy = true; else m.state = 'empty';
        continue;
      }
      if (m.y < -s.w || m.y > vh + s.w) { m.state = 'empty'; continue; }   /* gone off screen */
      var target = lean * s.sway * (s.side === 'l' ? 1 : -1);   /* the two sides lean as mirror images */
      m.tilt += (target - m.tilt) * settle;
      if (Math.abs(target - m.tilt) > 0.0015) busy = true;
      if (m.state !== 'empty' && m.y < bandTop) { startFall(m, now, energy); busy = true; continue; }
      if (m.state === 'empty') {
        if (m.y > bandTop + Z.hysteresis && m.y < vh * Z.bottom && Math.abs(vel) < TUNE.calm) queued.push(m);
        continue;
      }
      if (m.state === 'build') {
        var done = true;
        for (var j = 0; j < m.shards.length && done; j++) done = buildPose(m.shards[j], now - m.t0).done;
        if (done) m.state = 'whole'; else busy = true;
      }
    }
    queued.sort(function (a, b) { return a.y - b.y; });   /* several at once build top to bottom */
    var wait = intro ? TUNE.intro : 0;
    if (queued.length) intro = false;
    queued.forEach(function (m, i) { startBuild(m, now, wait + i * 0.14); busy = true; });
    return busy;
  }

  function path(c, pts) {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
  }
  function drawShard(c, m, sh, x, y, rot, fa, sc, alpha) {
    if (alpha < 0.004) return;
    var S = m.s.w / MARK.w * sc * dpr, fl = Math.cos(fa), co = Math.cos(rot) * S, si = Math.sin(rot) * S;
    c.setTransform(co * fl, si * fl, -si, co, x * dpr, y * dpr);
    c.globalAlpha = alpha;
    c.fillStyle = m.pal[sh.f][Math.round(Math.abs(fl) * (SHADES - 1))];
    path(c, sh.pts); c.fill();
  }
  function draw(now) {
    ['l', 'r'].forEach(function (side) {
      var s = sides[side];
      if (s.plan) { s.ctx.setTransform(1, 0, 0, 1, 0, 0); s.ctx.clearRect(0, 0, s.el.width, s.el.height); }
    });
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i], c = sides[m.s.side].ctx, k, sh;
      if (m.state === 'empty') continue;
      if (m.state === 'fall') {
        for (k = 0; k < m.shards.length; k++) { sh = m.shards[k]; drawShard(c, m, sh, sh.x, sh.y, sh.rot, sh.fa, sh.sc, sh.alpha); }
        continue;
      }
      var R = m.s.tilt + m.tilt;
      if (m.state === 'whole') {                /* fused: whole facets, no seams between shards */
        var S = m.s.w / MARK.w * dpr, co = Math.cos(R) * S, si = Math.sin(R) * S;
        c.setTransform(co, si, -si, co, m.x * dpr, m.y * dpr);
        c.globalAlpha = 1;
        for (k = 0; k < FACET_PATHS.length; k++) { c.fillStyle = m.pal[k][SHADES - 1]; path(c, FACET_PATHS[k]); c.fill(); }
        continue;
      }
      var S1 = m.s.w / MARK.w, cr = Math.cos(R), sr = Math.sin(R);
      for (k = 0; k < m.shards.length; k++) {
        sh = m.shards[k];
        var p = buildPose(sh, now - m.t0), lx = sh.c[0] * S1, ly = sh.c[1] * S1;
        drawShard(c, m, sh, m.x + lx * cr - ly * sr + p.dx, m.y + lx * sr + ly * cr + p.dy, R + p.rot, p.fa, p.scale, p.alpha);
      }
    }
    sides.l.ctx.globalAlpha = 1; sides.r.ctx.globalAlpha = 1;
  }
  function clear() {
    ['l', 'r'].forEach(function (side) {
      var s = sides[side];
      s.ctx.setTransform(1, 0, 0, 1, 0, 0); s.ctx.clearRect(0, 0, s.el.width, s.el.height);
    });
  }

  function frame(ms) {
    var now = ms / 1000, dt = lastT ? Math.min(0.05, Math.max(0.001, now - lastT)) : 1 / 60;
    lastT = now;
    var y = global.pageYOffset || 0, dy = y - lastY;
    lastY = y;
    if (dy) dir = dy > 0 ? 1 : -1;
    vel += (dy / dt - vel) * (1 - Math.exp(-dt / 0.12));
    if (!enabled) { running = false; lastT = 0; return; }
    var busy = step(now, dt, dy);
    draw(now);
    if (busy || dy || Math.abs(vel) > 8) global.requestAnimationFrame(frame);
    else { running = false; lastT = 0; vel = 0; }
  }
  function kick() {
    if (!running && enabled) { running = true; global.requestAnimationFrame(frame); }
  }

  global.addEventListener('scroll', kick, { passive: true });
  global.addEventListener('resize', measure, { passive: true });
  global.addEventListener('load', measure);
  if (global.ResizeObserver) new global.ResizeObserver(measure).observe(root);
  if (global.MutationObserver) new global.MutationObserver(measure).observe(root, { attributes: true, attributeFilter: ['style'] });
  if (motion && motion.addEventListener) motion.addEventListener('change', function () {
    if (!motion.matches) return;
    dead = true; enabled = false; clear();
    ['l', 'r'].forEach(function (side) { sides[side].el.style.display = 'none'; sides[side].key = 'off'; });
    global.removeEventListener('scroll', kick); global.removeEventListener('resize', measure);
  });
  measure();
})(typeof window !== 'undefined' ? window : this);
