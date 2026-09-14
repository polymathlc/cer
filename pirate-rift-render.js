const ISO_X = Math.sqrt(3) / 2;
const ISO_Y = .5;
const TAU = Math.PI * 2;
const PALETTES = {
  harbor: { background: '#080f17', sea: '#101e29', floor: ['#283238', '#303a3e', '#263137', '#343c3e'], line: '#121d24', edge: '#45504f', accent: '#79b8bd', rune: '#b19b65', dust: '#8bbbbc' },
  ruins: { background: '#080f13', sea: '#0b2228', floor: ['#233534', '#293d38', '#263b39', '#31443d'], line: '#102423', edge: '#526156', accent: '#78c9b4', rune: '#baaa75', dust: '#86d8b9' },
  citadel: { background: '#100c16', sea: '#211725', floor: ['#37313c', '#3c3540', '#322d38', '#423840'], line: '#211d2c', edge: '#63555e', accent: '#cd8998', rune: '#c3a572', dust: '#d4a9c1' },
};
const CREW = {
  luffy: { index: 0, color: '#ffbc61', cloth: '#b9272d', hair: '#191b20', height: 110 },
  zoro: { index: 1, color: '#80e4bc', cloth: '#205a47', hair: '#79a657', height: 112 },
  whitebeard: { index: 2, color: '#b3d7ff', cloth: '#e4d9c0', hair: '#e0ccb1', height: 143 },
  shanks: { index: 3, color: '#f07786', cloth: '#2a2530', hair: '#a33335', height: 118 },
};

function project(x, y) { return { x: (x - y) * ISO_X, y: (x + y) * ISO_Y }; }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function hash(a, b = 0) {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
function alphaColor(color, opacity) {
  if (/^#[0-9a-f]{6}$/i.test(color || '')) {
    return `${color}${Math.round(clamp(opacity, 0, 1) * 255).toString(16).padStart(2, '0')}`;
  }
  return color || '#eac787';
}
function polygon(ctx, points, fill, stroke, width = 1) {
  if (!points.length) return;
  ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function ellipse(ctx, x, y, rx, ry, fill, stroke, width = 1) {
  ctx.beginPath(); ctx.ellipse(x, y, Math.max(.01, rx), Math.max(.01, ry), 0, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function ground(ctx, x, y, draw) {
  const p = project(x, y);
  ctx.save(); ctx.translate(p.x, p.y); ctx.transform(ISO_X, ISO_Y, -ISO_X, ISO_Y, 0, 0);
  draw(); ctx.restore();
}
function roundRect(ctx, x, y, width, height, radius = 5) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
}

/** Isometric canvas renderer. All simulation coordinates remain in world units. */
export function createRenderer(canvas, { artUrl = './assets/pirate-rift/crew.png', enemyArtUrl = './assets/pirate-rift/enemies.png' } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Pirate Rift requires a 2D canvas.');
  let width = 1, height = 1, dpr = 1, zoom = 1;
  let camera = { x: 0, y: 0 };
  let floorCache = null, floorKey = '', sprites = null, enemySprites = null, disposed = false;
  let currentTime = 0, reduced = false;
  let resolvePortraits;
  const portraitsReady = new Promise(resolve => { resolvePortraits = resolve; });
  function publishPortraits() {
    try {
      const result = {};
      for (const [id, crew] of Object.entries(CREW)) {
        const sprite = sprites[crew.index];
        const portrait = document.createElement('canvas'); portrait.width = sprite.sw; portrait.height = sprite.sh;
        portrait.getContext('2d').drawImage(sprite.image, sprite.sx, sprite.sy, sprite.sw, sprite.sh, 0, 0, sprite.sw, sprite.sh);
        result[id] = portrait.toDataURL('image/png');
      }
      resolvePortraits(result);
    } catch { resolvePortraits(null); }
  }
  const images = [];
  function loadSprites(url, complete) {
  const art = new Image(); images.push(art);
  art.decoding = 'async';
  art.onload = () => {
    if (disposed) return;
    const quadrants = [];
    const cellWidth = Math.floor(art.naturalWidth / 2), cellHeight = Math.floor(art.naturalHeight / 2);
    if (!cellWidth || !cellHeight) return;
    // Generated atlases can have a sword or cape crossing the quadrant boundary.
    // Isolate connected silhouettes first, retaining the complete figure and its alpha.
    try {
      const atlas = document.createElement('canvas'); atlas.width = art.naturalWidth; atlas.height = art.naturalHeight;
      const atlasCtx = atlas.getContext('2d', { willReadFrequently: true }); atlasCtx.drawImage(art, 0, 0);
      const source = atlasCtx.getImageData(0, 0, atlas.width, atlas.height);
      const pixels = source.data, w = atlas.width, h = atlas.height, labels = new Uint32Array(w * h), queue = new Int32Array(w * h);
      const components = []; let label = 0;
      for (let start = 0; start < labels.length; start++) {
        if (labels[start] || pixels[start * 4 + 3] < 15) continue;
        label++; let head = 0, tail = 1, left = w, top = h, right = 0, bottom = 0, sumX = 0, sumY = 0;
        queue[0] = start; labels[start] = label;
        while (head < tail) {
          const pos = queue[head++], x = pos % w, y = Math.floor(pos / w);
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); sumX += x; sumY += y;
          const visit = next => { if (!labels[next] && pixels[next * 4 + 3] >= 15) { labels[next] = label; queue[tail++] = next; } };
          if (x > 0) visit(pos - 1); if (x < w - 1) visit(pos + 1); if (y > 0) visit(pos - w); if (y < h - 1) visit(pos + w);
        }
        if (tail > Math.max(500, w * h * .002)) components.push({ label, left, top, right, bottom, count: tail, cx: sumX / tail, cy: sumY / tail });
      }
      const selected = new Array(4);
      for (const component of components.sort((a, b) => b.count - a.count)) {
        const index = (component.cx >= w / 2 ? 1 : 0) + (component.cy >= h / 2 ? 2 : 0);
        if (!selected[index]) selected[index] = component;
      }
      if (selected.filter(Boolean).length === 4) {
        const parsed = selected.map(component => {
          const sw = component.right - component.left + 1, sh = component.bottom - component.top + 1;
          const spriteCanvas = document.createElement('canvas'); spriteCanvas.width = sw; spriteCanvas.height = sh;
          const spriteCtx = spriteCanvas.getContext('2d'), target = spriteCtx.createImageData(sw, sh);
          for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
            const sourcePos = (y + component.top) * w + x + component.left, destPos = (y * sw + x) * 4;
            if (labels[sourcePos] !== component.label) continue;
            target.data[destPos] = pixels[sourcePos * 4]; target.data[destPos + 1] = pixels[sourcePos * 4 + 1];
            target.data[destPos + 2] = pixels[sourcePos * 4 + 2]; target.data[destPos + 3] = pixels[sourcePos * 4 + 3];
          }
          spriteCtx.putImageData(target, 0, 0);
          return { image: spriteCanvas, sx: 0, sy: 0, sw, sh };
        });
        complete(parsed); return;
      }
    } catch { /* Cross-origin or opaque artwork still supports ordinary quadrant cropping. */ }
    const scan = document.createElement('canvas'); scan.width = cellWidth; scan.height = cellHeight;
    const scanCtx = scan.getContext('2d', { willReadFrequently: true });
    for (let i = 0; i < 4; i++) {
      const sx = (i % 2) * cellWidth, sy = Math.floor(i / 2) * cellHeight;
      let left = cellWidth, top = cellHeight, right = 0, bottom = 0;
      try {
        scanCtx.clearRect(0, 0, cellWidth, cellHeight);
        scanCtx.drawImage(art, sx, sy, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
        const pixels = scanCtx.getImageData(0, 0, cellWidth, cellHeight).data;
        for (let y = 0; y < cellHeight; y += 2) for (let x = 0; x < cellWidth; x += 2) {
          if (pixels[(y * cellWidth + x) * 4 + 3] > 45) {
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
        }
      } catch { left = 0; top = 0; right = cellWidth - 1; bottom = cellHeight - 1; }
      if (left >= right || top >= bottom) { left = 0; top = 0; right = cellWidth - 1; bottom = cellHeight - 1; }
      left = Math.max(0, left - 3); top = Math.max(0, top - 3);
      right = Math.min(cellWidth - 1, right + 4); bottom = Math.min(cellHeight - 1, bottom + 4);
      quadrants.push({ image: art, sx: sx + left, sy: sy + top, sw: right - left + 1, sh: bottom - top + 1 });
    }
    complete(quadrants);
  };
  art.onerror = () => { complete(null); };
  art.src = url;
  }
  loadSprites(artUrl, result => { sprites = result; if (sprites) publishPortraits(); else resolvePortraits(null); });
  loadSprites(enemyArtUrl, result => { enemySprites = result; });

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width || canvas.clientWidth || 800);
    height = Math.max(1, rect.height || canvas.clientHeight || 600);
    dpr = clamp(globalThis.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    zoom = width < 600 ? .74 : width < 950 ? .88 : 1;
  }

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * width / Math.max(1, rect.width);
    const py = (clientY - rect.top) * height / Math.max(1, rect.height);
    const ix = (px - width * .5) / zoom + camera.x;
    const iy = (py - height * .54) / zoom + camera.y;
    return { x: (ix / ISO_X + iy / ISO_Y) / 2, y: (iy / ISO_Y - ix / ISO_X) / 2 };
  }

  function makeFloor(game, palette) {
    const b = game.worldBounds || { minX: -620, minY: -480, maxX: 620, maxY: 480 };
    const key = `${game.act || 1}:${game.room || 1}:${b.minX}:${b.minY}:${b.maxX}:${b.maxY}`;
    if (key === floorKey) return;
    floorKey = key;
    const corners = [project(b.minX, b.minY), project(b.maxX, b.minY), project(b.maxX, b.maxY), project(b.minX, b.maxY)];
    const left = Math.min(...corners.map(p => p.x)) - 110, top = Math.min(...corners.map(p => p.y)) - 100;
    const fw = Math.max(...corners.map(p => p.x)) - left + 110, fh = Math.max(...corners.map(p => p.y)) - top + 150;
    const scale = Math.min(1.25, 2600 / fw, 1800 / fh);
    const cache = document.createElement('canvas'); cache.width = Math.ceil(fw * scale); cache.height = Math.ceil(fh * scale);
    const c = cache.getContext('2d'); c.scale(scale, scale); c.translate(-left, -top);
    const shadow = c.createRadialGradient(0, 80, 50, 0, 80, fw * .53);
    shadow.addColorStop(0, '#000000cc'); shadow.addColorStop(.75, '#00000099'); shadow.addColorStop(1, '#00000000');
    c.fillStyle = shadow; c.fillRect(left, top, fw, fh);
    const perimeter = corners.map(p => [p.x, p.y]);
    polygon(c, perimeter.map(([x, y]) => [x, y + 29]), '#111821', '#070b12', 9);
    polygon(c, perimeter, palette.line, palette.edge, 4);
    const tile = 86;
    let row = 0;
    for (let y = b.minY; y < b.maxY; y += tile, row++) {
      let col = 0;
      for (let x = b.minX; x < b.maxX; x += tile, col++) {
        const x2 = Math.min(x + tile, b.maxX), y2 = Math.min(y + tile, b.maxY);
        const pts = [project(x + 1, y + 1), project(x2 - 1, y + 1), project(x2 - 1, y2 - 1), project(x + 1, y2 - 1)];
        const seed = hash(col + game.room * 7, row);
        let fill = palette.floor[Math.floor(seed * palette.floor.length)];
        const cx = (x + x2) / 2, cy = (y + y2) / 2;
        if (Math.abs(cx) < 105 || Math.abs(cy + 40) < 55) fill = game.act === 3 ? '#50434a' : game.act === 2 ? '#3e5144' : '#444b47';
        const dock = game.act === 1 && ((x > b.maxX - tile * 2 && y > -100) || (x < b.minX + tile && y < 100));
        if (dock) fill = ['#403b31', '#494035', '#39372f'][Math.floor(seed * 3)];
        polygon(c, pts.map(p => [p.x, p.y]), fill, alphaColor(palette.line, .78), 1.1);
        c.beginPath(); c.moveTo(pts[3].x, pts[3].y - 1); c.lineTo(pts[0].x, pts[0].y + 1); c.lineTo(pts[1].x, pts[1].y);
        c.strokeStyle = alphaColor(palette.edge, .6); c.lineWidth = 1; c.stroke();
        // Weathered grain is baked once per room, never painted in the frame loop.
        for (let grain = 0; grain < 40; grain++) {
          const gx = hash(col * 47 + grain, row * 17), gy = hash(col * 19 + grain, row * 43);
          const gp = project(x + 3 + gx * (x2 - x - 6), y + 3 + gy * (y2 - y - 6));
          c.fillStyle = grain % 3 ? '#07121b16' : '#d9d5b716';
          c.fillRect(gp.x, gp.y, 1 + hash(grain + col, row) * (dock ? 8 : 2.5), .65 + hash(grain, col) * 1.2);
        }
        if (dock) {
          for (let plank = 1; plank < 5; plank++) {
            const py = y + (y2 - y) * plank / 5, a = project(x + 1, py), z = project(x2 - 1, py);
            c.strokeStyle = '#171e20a6'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(z.x, z.y); c.stroke();
            const nail = project(x + 7, py + 4); ellipse(c, nail.x, nail.y, 1.2, .8, '#96856688');
          }
        }
        if (seed < .3) {
          const p = project(cx, cy);
          const twist = hash(col + 9, row) * 18;
          c.beginPath(); c.moveTo(p.x - 28 + twist, p.y - 10); c.lineTo(p.x - 6, p.y - 1 + twist * .12);
          c.lineTo(p.x - 3 + twist * .25, p.y + 11); c.moveTo(p.x - 6, p.y - 1); c.lineTo(p.x + 19, p.y - 8 + twist * .5);
          c.strokeStyle = '#07131b55'; c.lineWidth = 1.5; c.stroke();
        }
        if (seed > .73) {
          const p = project(cx + 18, cy - 15);
          const points = Array.from({ length: 9 }, (_, k) => {
            const a = k / 9 * TAU, size = 9 + hash(k + col, row) * 17;
            return [p.x + Math.cos(a) * size, p.y + Math.sin(a) * size * .55];
          });
          polygon(c, points, game.act === 2 ? '#5a77572a' : '#10192125');
        }
        if (seed < .15) {
          const p = project(x + 7, y + 8);
          polygon(c, [[p.x - 5, p.y], [p.x - 2, p.y - 3], [p.x + 4, p.y - 2], [p.x + 5, p.y + 1], [p.x, p.y + 3]], '#6c77716b', '#13212766');
          polygon(c, [[p.x + 8, p.y + 2], [p.x + 12, p.y + 1], [p.x + 14, p.y + 4], [p.x + 9, p.y + 5]], '#79817a51');
        }
      }
    }
    ground(c, 0, -40, () => {
      c.strokeStyle = alphaColor(palette.rune, .19); c.lineWidth = 3;
      for (const radius of [145, 158, 240]) { c.beginPath(); c.arc(0, 0, radius, 0, TAU); c.stroke(); }
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU;
        c.save(); c.rotate(a); c.beginPath(); c.moveTo(175, -8); c.lineTo(198, 0); c.lineTo(175, 8); c.stroke(); c.restore();
      }
      c.beginPath(); c.moveTo(-36, 0); c.lineTo(36, 0); c.moveTo(0, -36); c.lineTo(0, 36); c.stroke();
      c.beginPath(); c.arc(0, 0, 47, 0, TAU); c.stroke();
      for (let i = 0; i < 8; i++) {
        c.save(); c.rotate(i * TAU / 8);
        polygon(c, [[0, -118], [-11, -45], [0, -57], [11, -45]], alphaColor(palette.rune, i % 2 ? .1 : .2));
        c.restore();
      }
    });
    if (game.act === 1) {
      // Coiled mooring ropes sit flat on the dock, so they add no false collision.
      for (const [rx, ry] of [[b.maxX - 64, b.maxY - 190], [b.minX + 47, b.minY + 195]]) {
        const rp = project(rx, ry);
        for (let ring = 0; ring < 4; ring++) ellipse(c, rp.x, rp.y, 14 + ring * 3, 7 + ring * 1.6, null, ring % 2 ? '#9e896657' : '#4e46336e', 2);
        c.beginPath(); c.moveTo(rp.x + 23, rp.y + 4); c.bezierCurveTo(rp.x + 48, rp.y + 8, rp.x + 39, rp.y + 27, rp.x + 56, rp.y + 31); c.strokeStyle = '#9e896657'; c.lineWidth = 2; c.stroke();
      }
    }
    const roomLight = c.createRadialGradient(0, -40, 100, 0, -40, 900);
    roomLight.addColorStop(0, '#d9c18b08'); roomLight.addColorStop(.62, '#11162000'); roomLight.addColorStop(1, '#07101b45');
    c.save(); polygon(c, perimeter); c.clip(); c.fillStyle = roomLight; c.fillRect(left, top, fw, fh); c.restore();
    // Embedded brass edge markers make the boundary easy to read during combat.
    for (let i = 0; i < 4; i++) {
      const start = corners[i], end = corners[(i + 1) % 4];
      for (let j = 1; j < 13; j++) {
        const f = j / 13, px = start.x + (end.x - start.x) * f, py = start.y + (end.y - start.y) * f;
        ellipse(c, px, py, 3.5, 2, alphaColor(palette.rune, .7));
      }
    }
    floorCache = { canvas: cache, left, top, width: fw, height: fh };
  }

  function drawBackdrop(palette, time) {
    ctx.fillStyle = palette.background; ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * .5, height * .43, 20, width * .5, height * .43, Math.max(width, height) * .72);
    glow.addColorStop(0, palette.sea); glow.addColorStop(1, palette.background);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.strokeStyle = alphaColor(palette.accent, .075); ctx.lineWidth = 1;
    for (let i = 0; i < 28; i++) {
      const x = hash(i, 9) * width, y = hash(i, 11) * height;
      const shift = reduced ? 0 : Math.sin(time * .28 + i) * 13;
      ctx.beginPath(); ctx.ellipse(x + shift, y, 18 + hash(i, 4) * 45, 2 + hash(i, 5) * 4, -.18, .2, Math.PI * .9); ctx.stroke();
    }
    ctx.restore();
  }

  function shadowAt(x, y, radius, opacity = .5) {
    const p = project(x, y);
    ellipse(ctx, p.x, p.y + 3, radius * 1.2, radius * .55, `rgba(0,0,0,${opacity})`);
  }

  function drawObstacle(obstacle, index, palette, act) {
    const p = project(obstacle.x, obstacle.y), r = obstacle.radius || 28;
    const kind = index % 4;
    ctx.save(); ctx.translate(p.x, p.y);
    ellipse(ctx, 8, 7, r * 1.7, r * .64, '#0000005c');
    if (act === 1 && kind === 1) {
      const s = r * .9;
      polygon(ctx, [[-s, -s * .6], [0, 0], [0, -s * 1.7], [-s, -s * 2.3]], '#3a302a', '#191d20', 2);
      polygon(ctx, [[0, 0], [s, -s * .6], [s, -s * 2.3], [0, -s * 1.7]], '#514135', '#191d20', 2);
      polygon(ctx, [[-s, -s * 2.3], [0, -s * 2.9], [s, -s * 2.3], [0, -s * 1.7]], '#6a5641', '#252527', 2);
      ctx.strokeStyle = '#ac956b88'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-s, -s * 1.95); ctx.lineTo(0, -s * 1.35); ctx.lineTo(s, -s * 1.95); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s * .6, -s * .37); ctx.lineTo(-s * .6, -s * 2.06); ctx.moveTo(s * .6, -s * .37); ctx.lineTo(s * .6, -s * 2.06); ctx.stroke();
    } else if (kind === 2) {
      polygon(ctx, [[-r * 1.1, -3], [-r * .65, -r * 1.1], [r * .12, -r * 1.55], [r, -r * .9], [r * 1.2, -5], [0, r * .5]], '#3c4141', '#1b282c', 2);
      polygon(ctx, [[-r * .65, -r * 1.1], [r * .12, -r * 1.55], [r, -r * .9], [r * .15, -r * .45]], '#65706a');
      polygon(ctx, [[r * .15, -r * .45], [r, -r * .9], [r * 1.2, -5], [0, r * .5]], '#49514f');
      ctx.strokeStyle = '#85928a66'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-r * .5, -r * .95); ctx.lineTo(-r * .3, -r * .4); ctx.stroke();
    } else {
      const tall = kind === 3 ? r * 1.9 : r * 3.05;
      const pillar = ctx.createLinearGradient(-r, 0, r, 0);
      pillar.addColorStop(0, '#292f33'); pillar.addColorStop(.4, act === 3 ? '#71626b' : '#68716a'); pillar.addColorStop(.7, '#454c4a'); pillar.addColorStop(1, '#232d30');
      ellipse(ctx, 0, 0, r * 1.2, r * .58, '#3e4848', '#171f26', 2);
      ctx.fillStyle = pillar; ctx.fillRect(-r * .8, -tall, r * 1.6, tall);
      ellipse(ctx, 0, 0, r * .8, r * .36, '#404a48');
      for (let j = -1; j <= 1; j++) { ctx.strokeStyle = '#17242966'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(j * r * .43, -tall + 7); ctx.lineTo(j * r * .43, -10); ctx.stroke(); }
      ellipse(ctx, 0, -tall, r * .85, r * .38, act === 3 ? '#8a747d' : '#818a7b', '#263139', 2);
      polygon(ctx, [[-r * .45, -tall - 4], [r * .05, -tall + 1], [-r * .1, -tall + r * .24]], '#3d4948');
      if (kind === 0) {
        ctx.fillStyle = '#b9a16c'; ctx.fillRect(-r * .82, -tall + 10, r * 1.64, 3);
        const fireY = -tall - 12;
        const glow = ctx.createRadialGradient(0, fireY, 0, 0, fireY, r * 2.7);
        glow.addColorStop(0, '#ffc87838'); glow.addColorStop(1, '#ffc87800');
        ctx.fillStyle = glow; ctx.fillRect(-r * 3, fireY - r * 3, r * 6, r * 6);
        const flicker = reduced ? 1 : 1 + Math.sin(currentTime * 8 + index * 2) * .15;
        polygon(ctx, [[-7, -tall - 2], [-10, fireY], [-3, fireY - 7 * flicker], [0, fireY - 23 * flicker], [7, fireY - 9], [8, fireY + 4], [3, -tall - 1]], '#eca456');
        polygon(ctx, [[-3, -tall - 3], [-3, fireY - 2], [1, fireY - 13 * flicker], [4, fireY], [3, -tall - 3]], '#ffe4a0');
      }
    }
    ctx.restore();
  }

  function drawTelegraph(telegraph) {
    if (!telegraph) return;
    const progress = clamp(1 - (telegraph.remaining || 0) / Math.max(.01, telegraph.duration || 1), 0, 1);
    ground(ctx, telegraph.x || 0, telegraph.y || 0, () => {
      const radius = Math.max(8, telegraph.radius || 70);
      ctx.rotate(telegraph.angle || 0);
      const path = () => {
        ctx.beginPath();
        if (telegraph.type === 'cone') { const halfArc = (telegraph.arc || 1.5) / 2; ctx.moveTo(0, 0); ctx.arc(0, 0, radius, -halfArc, halfArc); ctx.closePath(); }
        else if (telegraph.type === 'line') {
          const halfWidth = telegraph.width || radius, length = telegraph.length || radius * 2;
          ctx.moveTo(0, -halfWidth); ctx.lineTo(length, -halfWidth); ctx.arc(length, 0, halfWidth, -Math.PI / 2, Math.PI / 2);
          ctx.lineTo(0, halfWidth); ctx.arc(0, 0, halfWidth, Math.PI / 2, Math.PI * 1.5); ctx.closePath();
        }
        else ctx.arc(0, 0, radius, 0, TAU);
      };
      path(); ctx.fillStyle = `rgba(235,61,69,${.09 + progress * .21})`; ctx.fill();
      ctx.lineWidth = 2.3; ctx.strokeStyle = '#ff7475cc'; ctx.stroke();
      ctx.save(); ctx.scale(Math.max(.01, progress), Math.max(.01, progress)); path();
      ctx.fillStyle = '#fc625227'; ctx.fill(); ctx.strokeStyle = '#ffb295'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
      if (progress > .7) { ctx.setLineDash([7, 6]); path(); ctx.strokeStyle = '#ffe2c4'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
    });
  }

  function drawLoot(item, time) {
    const p = project(item.x, item.y);
    const colors = { common: '#c9c7b3', uncommon: '#8ed2a2', rare: '#74bbfa', epic: '#bd8aff', legendary: '#ffc261', mythic: '#ff8e87' };
    const color = item.type === 'heal' ? '#97dfa9' : colors[item.rarity] || (item.type === 'gold' ? '#f6d17d' : '#8dc1ff');
    const bob = reduced ? 0 : Math.sin(time * 2.4 + (item.x || 0)) * 2;
    ctx.save(); ctx.translate(p.x, p.y);
    ellipse(ctx, 0, 0, 15, 7, alphaColor(color, .11), alphaColor(color, .55));
    if (item.type === 'heal') {
      ctx.save(); ctx.translate(0, -8 + bob); ctx.rotate(-.45);
      ctx.strokeStyle = '#eee2c6'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(13, 0); ctx.stroke();
      ellipse(ctx, -13, -2, 3, 3, '#eee2c6'); ellipse(ctx, -13, 2, 3, 3, '#eee2c6');
      ellipse(ctx, 13, -2, 3, 3, '#eee2c6'); ellipse(ctx, 13, 2, 3, 3, '#eee2c6');
      ellipse(ctx, 0, 0, 9, 7, '#a7533c', '#d59468', 1.5); ellipse(ctx, 2, -1, 5, 4, '#cc7d57'); ctx.restore();
    } else if (item.type !== 'gold') {
      const beam = ctx.createLinearGradient(0, -90, 0, 0); beam.addColorStop(0, alphaColor(color, 0)); beam.addColorStop(.8, alphaColor(color, .12)); beam.addColorStop(1, alphaColor(color, .34));
      polygon(ctx, [[-12, -90], [12, -90], [5, 0], [-5, 0]], beam);
      ctx.strokeStyle = alphaColor(color, .6); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -60); ctx.lineTo(0, -13); ctx.stroke();
      polygon(ctx, [[0, -18 + bob], [7, -10 + bob], [0, -3 + bob], [-7, -10 + bob]], color, '#fff1d599');
      if (item.rarity === 'legendary' || item.rarity === 'epic') {
        ctx.font = '600 10px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = color; ctx.shadowColor = '#050a13'; ctx.shadowBlur = 3;
        ctx.fillText(item.name || 'TREASURE', 0, -31 + bob); ctx.shadowBlur = 0;
      }
    } else {
      ellipse(ctx, -3, -4, 6, 3, '#b18742', '#ffdd88'); ellipse(ctx, 3, -7, 6, 3, '#edc66b', '#fff0b6');
    }
    ctx.restore();
  }

  function drawEnemy(enemy, time, player) {
    const p = project(enemy.x, enemy.y), radius = enemy.radius || 18;
    const isBoss = !!enemy.boss, brute = enemy.type === 'brute' || isBoss;
    const painted = enemySprites?.[{ marine: 0, gunner: 1, brute: 2, captain: 3, boss: 3 }[enemy.type] ?? 0];
    const spriteHeight = painted ? isBoss ? 106 : brute ? 100 : 99 : 68;
    const s = (brute ? 1.2 : .92) * clamp(radius / (brute ? 29 : 18), .8, 1.7);
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s, s);
    if (enemy.slow > 0) ellipse(ctx, 0, 1, 23, 11, '#90d9dd0d', '#90d9dd77', 1);
    if (isBoss && enemy.phase >= 2) {
      const aura = ctx.createRadialGradient(0, -28, 0, 0, -28, 61);
      aura.addColorStop(0, '#fb658a22'); aura.addColorStop(1, '#fb658a00'); ctx.fillStyle = aura; ctx.fillRect(-61, -89, 122, 122);
    }
    const flash = (enemy.hitFlash || 0) > 0;
    const bob = reduced ? 0 : Math.sin(time * 5 + (Number(enemy.id) || enemy.x)) * 1.3;
    ctx.translate(0, bob);
    if (painted) {
      ctx.save();
      const facing = project((player?.x || 0) - enemy.x, (player?.y || 0) - enemy.y);
      if (facing.x < -.1) ctx.scale(-1, 1);
      if (flash) ctx.filter = 'brightness(1.7)';
      if (isBoss) { ctx.shadowColor = enemy.phase >= 2 ? '#e54576' : enemy.color || '#eabb78'; ctx.shadowBlur = 12; }
      const drawWidth = spriteHeight * painted.sw / painted.sh;
      ctx.drawImage(painted.image, painted.sx, painted.sy, painted.sw, painted.sh, -drawWidth * .5, -spriteHeight + 3, drawWidth, spriteHeight);
      ctx.restore();
      if (isBoss) {
        ellipse(ctx, 0, 0, radius * .6, radius * .3, null, alphaColor(enemy.color || '#dcbc86', .6), 1);
        for (let crown = -1; crown <= 1; crown++) {
          const cx = crown * 9;
          polygon(ctx, [[cx, -spriteHeight - 10], [cx + 3, -spriteHeight - 5], [cx, -spriteHeight - 1], [cx - 3, -spriteHeight - 5]], enemy.color || '#e8bd7b');
        }
      }
    } else {
    const cloth = flash ? '#efcfbb' : isBoss ? '#722f3d' : enemy.type === 'captain' ? '#604877' : enemy.type === 'gunner' ? '#31566a' : '#385266';
    // A strong hat, shoulder and weapon profile keeps threats legible at arena scale.
    polygon(ctx, [[-14, -43], [-20, -9], [-7, -3], [0, -12], [9, -3], [21, -11], [14, -43]], '#192530', '#0c1622', 2);
    polygon(ctx, [[-12, -39], [-15, -23], [-8, -8], [0, -18], [9, -8], [16, -24], [12, -39]], cloth, '#142333', 1.5);
    polygon(ctx, [[-14, -40], [-24, -34], [-20, -25], [-9, -31]], flash ? '#fff4df' : '#c0c6b8', '#152532');
    polygon(ctx, [[13, -40], [24, -34], [21, -25], [8, -31]], flash ? '#fff4df' : '#c0c6b8', '#152532');
    ctx.strokeStyle = '#0c1721'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-9, 1); ctx.moveTo(7, -12); ctx.lineTo(11, 1); ctx.stroke();
    ctx.strokeStyle = '#b5bdaf'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-13, -35); ctx.lineTo(-15, -19); ctx.stroke();
    ellipse(ctx, 0, -46, 10, 11, flash ? '#ffe9da' : '#ad9182', '#26313a', 1.5);
    if (isBoss) {
      polygon(ctx, [[-22, -54], [-14, -61], [-5, -59], [0, -67], [8, -58], [19, -60], [24, -52]], '#2b202a', '#c39868', 2);
      ctx.fillStyle = '#f9c68a'; ctx.fillRect(-5, -56, 9, 3);
      polygon(ctx, [[-6, -42], [0, -29], [8, -44]], '#292530');
    } else {
      polygon(ctx, [[-14, -53], [-9, -61], [8, -61], [13, -53], [18, -51], [-15, -51]], '#c6d0c9', '#1b2e38', 1.5);
      ctx.fillStyle = '#31505c'; ctx.fillRect(-9, -55, 18, 3);
    }
    ctx.fillStyle = isBoss ? '#ff8f83' : '#dce8c8'; ctx.fillRect(-6, -47, 3, 2); ctx.fillRect(3, -47, 3, 2);
    if (enemy.type === 'gunner') {
      polygon(ctx, [[15, -33], [39, -42], [43, -37], [21, -27]], '#202c38', '#b2b9ac', 1.5);
      ellipse(ctx, 39, -39, 3, 3, '#e7bb83');
    } else if (brute) {
      ctx.strokeStyle = '#725648'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(17, -16); ctx.lineTo(34, -52); ctx.stroke();
      polygon(ctx, [[24, -61], [41, -66], [49, -46], [30, -42]], '#6c7680', '#afb6b3', 2);
      ctx.strokeStyle = '#d5dbce'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(41, -64); ctx.lineTo(47, -48); ctx.stroke();
    } else {
      ctx.strokeStyle = '#b9cfd1'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(19, -21); ctx.lineTo(31, -57); ctx.stroke();
      ctx.strokeStyle = '#eee9d2'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(20, -23); ctx.lineTo(33, -61); ctx.stroke();
      ctx.strokeStyle = '#b49865'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(13, -25); ctx.lineTo(26, -20); ctx.stroke();
    }
    }
    if (enemy.stun > 0) {
      ellipse(ctx, 0, -spriteHeight - 5, 15, 5, null, '#e8d09188', 1);
      for (let i = 0; i < 3; i++) {
        const a = (reduced ? 0 : time * 2) + i * TAU / 3, sx = Math.cos(a) * 15, sy = -spriteHeight - 5 + Math.sin(a) * 5;
        polygon(ctx, [[sx, sy - 3], [sx + 3, sy], [sx, sy + 3], [sx - 3, sy]], '#fce2a0');
      }
    }
    ctx.restore();
    if ((enemy.hp < enemy.maxHp || isBoss) && enemy.hp > 0) {
      const barWidth = isBoss ? 100 : 39;
      ctx.save(); ctx.translate(p.x, p.y - (spriteHeight + (isBoss ? 17 : 8)) * s);
      if (isBoss) {
        ctx.textAlign = 'center'; ctx.font = '600 11px "Segoe UI",sans-serif'; ctx.fillStyle = '#f6cbbc'; ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
        ctx.fillText(enemy.name || 'WARLORD', 0, -8); ctx.shadowBlur = 0;
      }
      ctx.fillStyle = '#090f19d9'; ctx.fillRect(-barWidth / 2 - 1, -1, barWidth + 2, 5);
      ctx.fillStyle = isBoss ? '#e57374' : '#cf8d7d'; ctx.fillRect(-barWidth / 2, 0, barWidth * clamp(enemy.hp / Math.max(1, enemy.maxHp), 0, 1), 3);
      ctx.restore();
    }
  }

  function drawFallbackCharacter(id, time, facing) {
    const crew = CREW[id] || CREW.luffy;
    const big = id === 'whitebeard', s = big ? 1.32 : 1;
    ctx.save(); ctx.scale(s, s);
    const bob = reduced ? 0 : Math.sin(time * 2.3) * .7;
    ctx.translate(0, bob);
    const skin = '#d5a37e', outline = '#131923';
    if (id === 'shanks' || big) {
      polygon(ctx, [[-19, -70], [-29, -19], [-18, -5], [0, -13], [19, -3], [30, -16], [20, -70]], big ? '#e4ddc6' : '#25212b', outline, 2);
      polygon(ctx, [[-18, -62], [-26, -17], [-15, -25], [-10, -62]], big ? '#c94f55' : '#443644');
    }
    ctx.strokeStyle = outline; ctx.lineCap = 'round'; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(-7, -24); ctx.lineTo(-11, -4); ctx.moveTo(8, -24); ctx.lineTo(12, -4); ctx.stroke();
    ctx.strokeStyle = id === 'luffy' ? '#6b92b0' : id === 'zoro' ? '#19372b' : '#6e6257'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(-7, -25); ctx.lineTo(-10, -9); ctx.moveTo(8, -25); ctx.lineTo(11, -9); ctx.stroke();
    ctx.strokeStyle = id === 'luffy' ? skin : '#29202b'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-13, -2); ctx.lineTo(-5, -2); ctx.moveTo(8, -1); ctx.lineTo(16, -1); ctx.stroke();
    polygon(ctx, [[-15, -64], [-16, -30], [0, -23], [16, -30], [15, -64]], id === 'zoro' ? '#32715a' : big ? skin : id === 'shanks' ? '#d9d6c5' : '#c3383c', outline, 2);
    if (id === 'luffy' || big) polygon(ctx, [[-6, -64], [-7, -32], [7, -32], [6, -64]], skin);
    ctx.strokeStyle = '#bd5146'; ctx.lineWidth = 1.5;
    if (id === 'luffy') { ctx.beginPath(); ctx.moveTo(-4, -45); ctx.lineTo(4, -38); ctx.moveTo(4, -45); ctx.lineTo(-4, -38); ctx.stroke(); }
    ctx.strokeStyle = skin; ctx.lineWidth = big ? 12 : 8;
    ctx.beginPath(); ctx.moveTo(-16, -59); ctx.lineTo(-22, -34); ctx.moveTo(16, -59); ctx.lineTo(23, -36); ctx.stroke();
    if (id === 'shanks') { ctx.strokeStyle = '#25212b'; ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(-17, -61); ctx.lineTo(-20, -39); ctx.stroke(); }
    ctx.strokeStyle = id === 'luffy' ? '#eab957' : '#912f3f'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-15, -29); ctx.lineTo(15, -29); ctx.stroke();
    ellipse(ctx, 0, -75, 13, 15, skin, outline, 1.5);
    polygon(ctx, [[-13, -76], [-14, -85], [-8, -91], [-2, -88], [5, -92], [13, -84], [13, -76], [7, -82], [2, -79], [-6, -83]], crew.hair, outline);
    ctx.fillStyle = '#28282a'; ctx.fillRect(-7, -75, 3, 2); ctx.fillRect(4, -75, 3, 2);
    if (id === 'luffy') {
      ellipse(ctx, 0, -85, 25, 7, '#d2a451', '#523d27', 2);
      polygon(ctx, [[-15, -86], [-13, -98], [-7, -104], [8, -104], [15, -96], [16, -86]], '#dbb65f', '#58442d', 2);
      ctx.fillStyle = '#b73138'; ctx.fillRect(-15, -90, 30, 5);
      ctx.strokeStyle = '#763b30'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(5, -71); ctx.lineTo(10, -71); ctx.stroke();
    } else if (big) {
      ctx.strokeStyle = '#fff7dd'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-24, -78); ctx.quadraticCurveTo(-12, -62, 0, -70); ctx.quadraticCurveTo(12, -62, 24, -78); ctx.stroke();
      polygon(ctx, [[-13, -84], [-12, -93], [12, -93], [14, -83]], '#e6dec9', '#635e5a');
      ctx.strokeStyle = '#c9ad72'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(27, -4); ctx.lineTo(39, -113); ctx.stroke();
      polygon(ctx, [[39, -114], [27, -125], [24, -141], [35, -132], [47, -126], [42, -109]], '#d2dde0', '#627e88', 2);
    } else if (id === 'zoro') {
      for (let j = 0; j < 3; j++) {
        ctx.strokeStyle = j === 1 ? '#eee8d1' : '#312b40'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-13 + j * 5, -32); ctx.lineTo(-35 + j * 5, -5); ctx.stroke();
        ctx.strokeStyle = '#d5bc77'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-17 + j * 5, -27); ctx.lineTo(-13 + j * 5, -30); ctx.stroke();
      }
      ctx.strokeStyle = '#dceee7'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(23, -35); ctx.lineTo(51, -69); ctx.stroke();
      ctx.strokeStyle = '#b1a774'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(20, -41); ctx.lineTo(28, -34); ctx.stroke();
    } else if (id === 'shanks') {
      ctx.strokeStyle = '#d4dbe1'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(22, -34); ctx.lineTo(47, -9); ctx.stroke();
      ctx.strokeStyle = '#e0bc77'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(19, -29); ctx.lineTo(28, -39); ctx.stroke();
      ctx.strokeStyle = '#883e3c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-7, -79); ctx.lineTo(-5, -70); ctx.moveTo(-4, -79); ctx.lineTo(-2, -70); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer(game, time) {
    const player = game.player, p = project(player.x, player.y), crew = CREW[game.characterId] || CREW.luffy;
    ctx.save(); ctx.translate(p.x, p.y);
    if (player.empowered > 0) {
      const aura = ctx.createRadialGradient(0, -45, 0, 0, -45, 78);
      aura.addColorStop(0, '#fff4c52d'); aura.addColorStop(1, '#fff4c500'); ctx.fillStyle = aura; ctx.fillRect(-78, -123, 156, 156);
      ctx.strokeStyle = '#fff7dcbb'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(side * 19, -37); ctx.bezierCurveTo(side * 48, -35, side * 46, -75, side * 24, -69);
        ctx.bezierCurveTo(side * 17, -64, side * 31, -58, side * 34, -69); ctx.stroke();
      }
    }
    if (player.hitFlash > 0) ellipse(ctx, 0, -40, 34, 47, '#fb707017', '#f6a69a99', 2);
    const invulnerable = (player.invulnerable || 0) > 0 || (player.dodgeTime || 0) > 0;
    if (invulnerable) {
      ellipse(ctx, 0, -35, 29, 42, alphaColor(crew.color, .09), alphaColor(crew.color, .55), 1.5);
      ctx.globalAlpha = reduced ? .83 : .68 + Math.sin(time * 25) * .15;
    }
    const facingVector = project(Math.cos(player.facing || 0), Math.sin(player.facing || 0));
    if (facingVector.x < -.1) ctx.scale(-1, 1);
    const sprite = sprites?.[crew.index];
    if (sprite) {
      const drawHeight = crew.height, drawWidth = drawHeight * sprite.sw / sprite.sh;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sprite.image, sprite.sx, sprite.sy, sprite.sw, sprite.sh, -drawWidth * .5, -drawHeight + 5, drawWidth, drawHeight);
    } else drawFallbackCharacter(game.characterId, time, player.facing);
    ctx.restore();
  }

  function drawPlayerRing(game) {
    const p = project(game.player.x, game.player.y), color = CREW[game.characterId]?.color || '#e8c787';
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 66);
    glow.addColorStop(0, alphaColor(color, .12)); glow.addColorStop(1, alphaColor(color, 0));
    ctx.fillStyle = glow; ctx.fillRect(p.x - 66, p.y - 66, 132, 132);
    ellipse(ctx, p.x, p.y + 1, 27, 15, '#040d1533', alphaColor(color, .82), 1.7);
    ground(ctx, game.player.x, game.player.y, () => {
      ctx.rotate(game.player.facing || 0);
      polygon(ctx, [[31, 0], [23, -4], [23, 4]], color);
    });
  }

  function drawPortal(portal, palette, time) {
    const p = project(portal.x, portal.y), pulse = reduced ? 1 : 1 + Math.sin(time * 2.2) * .045;
    ctx.save(); ctx.translate(p.x, p.y);
    const glow = ctx.createRadialGradient(0, -38, 0, 0, -38, 120);
    glow.addColorStop(0, '#f5d28e42'); glow.addColorStop(.5, '#ccaf8030'); glow.addColorStop(1, '#c8ab7700');
    ctx.fillStyle = glow; ctx.fillRect(-120, -158, 240, 240);
    ellipse(ctx, 0, 0, 51, 28, '#dab5740d', '#d5b57d88', 2);
    ellipse(ctx, 0, 0, 43, 22, null, '#f3d29d55', 1);
    const portalFill = ctx.createRadialGradient(0, -53, 1, 0, -53, 61);
    portalFill.addColorStop(0, '#e5d2a5'); portalFill.addColorStop(.3, '#926e47'); portalFill.addColorStop(.75, '#221f2b'); portalFill.addColorStop(1, '#080c15');
    ellipse(ctx, 0, -53, 31 * pulse, 54, portalFill, '#edc88f', 3);
    ellipse(ctx, 0, -53, 37 * pulse, 60, null, '#8d755d88', 1.5);
    for (let j = 0; j < 8; j++) {
      const a = j / 8 * TAU + (reduced ? 0 : time * .2);
      polygon(ctx, [[Math.cos(a) * 42, -53 + Math.sin(a) * 64 - 3], [Math.cos(a) * 42 + 3, -53 + Math.sin(a) * 64], [Math.cos(a) * 42, -53 + Math.sin(a) * 64 + 3], [Math.cos(a) * 42 - 3, -53 + Math.sin(a) * 64]], '#f7d49b');
    }
    ctx.fillStyle = '#f6ddb0'; ctx.textAlign = 'center'; ctx.font = '600 10px "Segoe UI",sans-serif';
    ctx.letterSpacing = '2px'; ctx.fillText('PASSAGE OPEN', 0, -132); ctx.letterSpacing = '0px';
    ctx.restore();
  }

  function drawEffect(effect, characterId, textLayer = false) {
    const kind = effect.kind || 'burst', isText = kind === 'damage' || kind === 'text';
    if (textLayer ? !isText && !effect.text : isText) return;
    const life = Math.max(.001, effect.maxLife || 1), progress = clamp(1 - Math.max(0, effect.life || 0) / life, 0, 1);
    const opacity = clamp(1 - progress * .95, 0, 1), radius = Math.max(6, effect.radius || 32);
    const color = effect.color || CREW[characterId]?.color || '#f6d18c';
    const p = project(effect.x || 0, effect.y || 0);
    ctx.save(); ctx.globalAlpha = opacity;
    if (textLayer) {
      ctx.translate(p.x, p.y - 54 - progress * (reduced ? 9 : 42));
      const textSize = kind === 'loot' ? '600 12px' : String(effect.text).includes('!') || kind === 'burst' ? '800 20px' : '700 16px';
      ctx.font = `${textSize} "Segoe UI",sans-serif`; ctx.textAlign = 'center';
      ctx.strokeStyle = '#101521'; ctx.lineWidth = 3.5; ctx.strokeText(String(effect.text || ''), 0, 0);
      ctx.fillStyle = color; ctx.fillText(String(effect.text || ''), 0, 0); ctx.restore(); return;
    }
    if (kind === 'quake' || kind === 'shockwave') {
      ground(ctx, effect.x || 0, effect.y || 0, () => {
        const size = radius * (.25 + progress * .8);
        ctx.strokeStyle = color; ctx.lineWidth = 3 * (1 - progress) + 1;
        ctx.beginPath(); ctx.arc(0, 0, size, 0, TAU); ctx.stroke();
        ctx.strokeStyle = alphaColor(color, .5); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, size * .88, 0, TAU); ctx.stroke();
        for (let i = 0; i < 10; i++) {
          const a = i / 10 * TAU; ctx.save(); ctx.rotate(a);
          ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(size * .32, 8); ctx.lineTo(size * .56, -13); ctx.lineTo(size * .75, 3); ctx.lineTo(size, -5);
          ctx.strokeStyle = '#071220'; ctx.lineWidth = 8; ctx.stroke(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        }
      });
    } else if (kind === 'slash' || kind === 'swords' || kind === 'haki') {
      ground(ctx, effect.x || 0, effect.y || 0, () => {
        ctx.rotate(effect.angle || 0);
        if (effect.length > 0) {
          const trailWidth = Math.min(48, radius);
          polygon(ctx, [[0, -trailWidth], [effect.length, -trailWidth * .4], [effect.length, trailWidth * .4], [0, trailWidth]], alphaColor(color, .1));
          for (let j = -1; j <= 1; j++) {
            ctx.beginPath(); ctx.moveTo(0, trailWidth * .7 * j); ctx.lineTo(effect.length, trailWidth * .3 * j);
            ctx.strokeStyle = j === 0 ? '#fff8de' : color; ctx.lineWidth = j === 0 ? 2 : 3; ctx.stroke();
          }
        }
        const swordCount = kind === 'swords' ? 3 : kind === 'haki' ? 2 : 1;
        for (let i = 0; i < swordCount; i++) {
          ctx.save(); ctx.rotate((i - (swordCount - 1) * .5) * .38);
          const r = radius * (.72 + progress * .35), halfArc = (effect.arc || 2.2) / 2, start = -halfArc + progress * .3, end = halfArc;
          ctx.beginPath(); ctx.arc(0, 0, r, start, end); ctx.arc(0, 0, r * .75, end, start, true); ctx.closePath();
          ctx.fillStyle = alphaColor(color, .2); ctx.fill();
          ctx.beginPath(); ctx.arc(0, 0, r, start, end); ctx.lineWidth = 5 - progress * 3; ctx.strokeStyle = color; ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, r - 3, start + .3, end - .1); ctx.lineWidth = 1.3; ctx.strokeStyle = '#fff6df'; ctx.stroke();
          ctx.restore();
        }
      });
      if (kind === 'haki') drawLightningAt(p, radius, color, progress);
    } else if (kind === 'lightning') {
      drawLightningAt(p, radius, color, progress);
      ellipse(ctx, p.x, p.y, radius * 1.2 * progress, radius * .7 * progress, alphaColor(color, .06), color, 2);
    } else if (kind === 'punch' || kind === 'gatling') {
      const count = kind === 'gatling' ? 6 : 1;
      const angle = effect.angle || 0;
      const direction = project(Math.cos(angle), Math.sin(angle));
      for (let i = 0; i < count; i++) {
        const spread = (i - (count - 1) * .5) * 10;
        const reach = kind === 'punch' ? effect.length || 235 : 0;
        const shift = progress * 15, ex = p.x + direction.x * reach + spread, ey = p.y + direction.y * reach + spread * .35 - 22;
        const armLength = kind === 'punch' ? reach : Math.min(130, radius) * (1 - progress * .7);
        ctx.beginPath(); ctx.moveTo(ex - direction.x * armLength, ey - direction.y * armLength);
        ctx.lineTo(ex + direction.x * shift, ey + direction.y * shift);
        ctx.strokeStyle = '#603f3c'; ctx.lineWidth = 13; ctx.lineCap = 'round'; ctx.stroke();
        ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.stroke();
        ellipse(ctx, ex + direction.x * shift, ey + direction.y * shift, 10, 8, '#e5b08b', '#fff0c2', 1.5);
        ctx.strokeStyle = '#96684d'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ex - 4, ey - 5); ctx.lineTo(ex - 4, ey + 1); ctx.moveTo(ex, ey - 6); ctx.lineTo(ex, ey); ctx.stroke();
      }
      ellipse(ctx, p.x, p.y - 20, radius * (.3 + progress * .6), radius * (.2 + progress * .4), null, alphaColor(color, .7), 2);
    } else if (kind === 'heal') {
      ellipse(ctx, p.x, p.y, radius, radius * .55, '#74daa01a', color, 2);
      for (let i = 0; i < 4; i++) {
        const x = p.x + Math.sin(i * 2.1) * radius * .6, y = p.y - 15 - progress * 54 + Math.cos(i) * 10;
        ctx.fillStyle = color; ctx.fillRect(x - 4, y - 1, 8, 2); ctx.fillRect(x - 1, y - 4, 2, 8);
      }
    } else if (kind === 'dodge') {
      ellipse(ctx, p.x, p.y - 25, 17 + progress * 12, 31 + progress * 8, alphaColor(color, .08), alphaColor(color, .4), 1);
      ellipse(ctx, p.x, p.y, radius * (1 + progress), radius * .5 * (1 + progress), null, alphaColor(color, .55));
    } else {
      ellipse(ctx, p.x, p.y, radius * (.2 + progress), radius * .58 * (.2 + progress), alphaColor(color, .07), color, 2);
      for (let i = 0; i < 7; i++) {
        const a = i * TAU / 7, distance = radius * (.35 + progress);
        const x = p.x + Math.cos(a) * distance, y = p.y + Math.sin(a) * distance * .6 - 10 * (1 - progress);
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 5); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawLightningAt(p, radius, color, progress) {
    ctx.save(); ctx.translate(p.x, p.y - 22);
    for (let i = 0; i < 7; i++) {
      const a = i * TAU / 7, len = radius * (.8 + hash(i, 3) * .4);
      ctx.beginPath(); ctx.moveTo(0, 0);
      for (let j = 1; j <= 5; j++) {
        const dist = len * j / 5, kink = (j % 2 ? -1 : 1) * 12 * (1 - progress * .3);
        ctx.lineTo(Math.cos(a) * dist + Math.sin(a) * kink, Math.sin(a) * dist * .58 - Math.cos(a) * kink);
      }
      ctx.strokeStyle = alphaColor(color, .22); ctx.lineWidth = 8; ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke(); ctx.strokeStyle = '#ffe6d2'; ctx.lineWidth = .8; ctx.stroke();
    }
    ctx.restore();
  }

  function drawProjectile(projectile) {
    const p = project(projectile.x, projectile.y), vel = project(projectile.vx || 0, projectile.vy || 0);
    const len = Math.hypot(vel.x, vel.y) || 1, radius = projectile.radius || 4;
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = alphaColor(projectile.color || '#ffc586', .36); ctx.lineWidth = radius * 2;
    ctx.beginPath(); ctx.moveTo(p.x - vel.x / len * 17, p.y - 17 - vel.y / len * 17); ctx.lineTo(p.x, p.y - 17); ctx.stroke();
    ellipse(ctx, p.x, p.y - 17, radius + 2, radius + 1, projectile.color || '#ffc586');
    ellipse(ctx, p.x, p.y - 17, radius * .45, radius * .45, '#fff7d4');
    ctx.restore();
  }

  function drawTarget(target, game) {
    if (!target || game.status !== 'playing') return;
    const b = game.worldBounds;
    if (b && (target.x < b.minX || target.x > b.maxX || target.y < b.minY || target.y > b.maxY)) return;
    const p = project(target.x, target.y), color = CREW[game.characterId]?.color || '#d6bd8b';
    ctx.save(); ctx.globalAlpha = .8;
    ellipse(ctx, p.x, p.y, 12, 7, alphaColor(color, .05), alphaColor(color, .8));
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(a) * 15, p.y + Math.sin(a) * 9);
      ctx.lineTo(p.x + Math.cos(a) * 20, p.y + Math.sin(a) * 12); ctx.stroke();
    }
    ctx.restore();
  }

  function drawAmbient(palette, time) {
    ctx.save();
    // Fixed particle budget and slow movement prevent distracting storm flashes.
    for (let i = 0; i < 30; i++) {
      const x = (hash(i, 23) * (width + 60) + (reduced ? 0 : time * (2 + hash(i, 2) * 3))) % (width + 60) - 30;
      const y = hash(i, 19) * height + (reduced ? 0 : Math.sin(time * .32 + i) * 14);
      ctx.globalAlpha = .09 + hash(i, 31) * .13; ctx.fillStyle = palette.dust;
      ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
    const vignette = ctx.createRadialGradient(width * .5, height * .5, Math.min(width, height) * .26, width * .5, height * .5, Math.max(width, height) * .68);
    vignette.addColorStop(0, '#05091400'); vignette.addColorStop(.65, '#05091419'); vignette.addColorStop(1, '#050914b3');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  function drawMinimap(game) {
    if (width < 760 || height < 430) return;
    const bounds = game.worldBounds || { minX: -620, minY: -480, maxX: 620, maxY: 480 };
    const mapWidth = 140, mapHeight = 108, x = width - mapWidth - 22, y = 110;
    const scale = 108 / Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2;
    const mp = (wx, wy) => { const p = project(wx - centerX, wy - centerY); return [x + mapWidth / 2 + p.x * scale * .63, y + 53 + p.y * scale * .63]; };
    ctx.save();
    roundRect(ctx, x, y, mapWidth, mapHeight, 8); ctx.fillStyle = '#0a1019b3'; ctx.fill(); ctx.strokeStyle = '#c8b08425'; ctx.lineWidth = 1; ctx.stroke();
    polygon(ctx, [mp(bounds.minX, bounds.minY), mp(bounds.maxX, bounds.minY), mp(bounds.maxX, bounds.maxY), mp(bounds.minX, bounds.maxY)], '#66737b19', '#c5b58855');
    for (const obstacle of game.obstacles || []) {
      const [px, py] = mp(obstacle.x, obstacle.y); ellipse(ctx, px, py, 2, 1.5, '#b9b6a955');
    }
    for (const enemy of (game.enemies || []).slice(0, 100)) {
      if (enemy.hp <= 0) continue;
      const [px, py] = mp(enemy.x, enemy.y); ellipse(ctx, px, py, enemy.boss ? 3.5 : 1.8, enemy.boss ? 3 : 1.6, enemy.boss ? '#ff9b7c' : '#d47b76');
    }
    if (game.status === 'cleared') { const [px, py] = mp(game.portal?.x || 0, game.portal?.y ?? -355); ellipse(ctx, px, py, 3, 3, '#e3c18a'); }
    const [px, py] = mp(game.player.x, game.player.y); polygon(ctx, [[px, py - 4], [px + 3.5, py + 3], [px, py + 1], [px - 3.5, py + 3]], '#f5e2b7');
    ctx.textAlign = 'center'; ctx.font = '500 9px "Segoe UI",sans-serif'; ctx.fillStyle = '#bfb8a5';
    ctx.fillText(`SECTOR ${String(game.room || 1).padStart(2, '0')} / 09`, x + mapWidth / 2, y + 97);
    ctx.restore();
  }

  function draw(game, { reducedMotion = false, target = null } = {}) {
    if (disposed || !game?.player) return;
    reduced = reducedMotion; currentTime = Number.isFinite(game.time) ? game.time : 0;
    const time = reduced ? 0 : currentTime;
    const palette = PALETTES[game.roomTheme] || PALETTES[['harbor', 'ruins', 'citadel'][(game.act || 1) - 1]] || PALETTES.harbor;
    camera = project(game.player.x, game.player.y);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    drawBackdrop(palette, time); makeFloor(game, palette);
    ctx.save(); ctx.translate(width * .5 - camera.x * zoom, height * .54 - camera.y * zoom); ctx.scale(zoom, zoom);
    if (floorCache) ctx.drawImage(floorCache.canvas, floorCache.left, floorCache.top, floorCache.width, floorCache.height);
    const enemies = (game.enemies || []).filter(e => e.hp > 0);
    for (const enemy of enemies) drawTelegraph(enemy.telegraph);
    for (const item of (game.loot || []).slice(0, 90)) drawLoot(item, time);
    drawTarget(target, game); drawPlayerRing(game);
    for (const enemy of enemies) shadowAt(enemy.x, enemy.y, (enemy.radius || 18) * 1.2);
    shadowAt(game.player.x, game.player.y, game.characterId === 'whitebeard' ? 27 : 21, .58);
    for (const effect of (game.effects || []).slice(-130)) {
      if (effect.kind === 'quake' || effect.kind === 'shockwave' || effect.kind === 'dodge') drawEffect(effect, game.characterId);
    }
    const actors = (game.obstacles || []).map((value, index) => ({ type: 'obstacle', value, index, depth: value.x + value.y }));
    for (const enemy of enemies) actors.push({ type: 'enemy', value: enemy, depth: enemy.x + enemy.y });
    actors.push({ type: 'player', value: game.player, depth: game.player.x + game.player.y });
    if (game.status === 'cleared') {
      const portal = game.portal || { x: 0, y: -355 };
      actors.push({ type: 'portal', value: portal, depth: portal.x + portal.y });
    }
    actors.sort((a, b) => a.depth - b.depth);
    for (const actor of actors) {
      const p = project(actor.value.x, actor.value.y);
      const sx = width * .5 + (p.x - camera.x) * zoom, sy = height * .54 + (p.y - camera.y) * zoom;
      if (sx < -200 || sx > width + 200 || sy < -80 || sy > height + 220) continue;
      if (actor.type === 'player') drawPlayer(game, time);
      else if (actor.type === 'enemy') drawEnemy(actor.value, time, game.player);
      else if (actor.type === 'portal') drawPortal(actor.value, palette, time);
      else drawObstacle(actor.value, actor.index, palette, game.act || 1);
    }
    for (const projectile of (game.projectiles || []).slice(-120)) drawProjectile(projectile);
    for (const effect of (game.effects || []).slice(-130)) {
      if (effect.kind !== 'quake' && effect.kind !== 'shockwave' && effect.kind !== 'dodge') drawEffect(effect, game.characterId);
    }
    for (const effect of (game.effects || []).slice(-90)) drawEffect(effect, game.characterId, true);
    ctx.restore(); drawAmbient(palette, time); drawMinimap(game);
    if (game.player.hp <= game.player.maxHp * .25 && game.status === 'playing') {
      const danger = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .3, width / 2, height / 2, Math.max(width, height) * .7);
      danger.addColorStop(0, '#830f2000'); danger.addColorStop(1, '#a518304d'); ctx.fillStyle = danger; ctx.fillRect(0, 0, width, height);
    }
  }

  function destroy() { disposed = true; for (const image of images) { image.onload = null; image.onerror = null; } floorCache = null; sprites = null; enemySprites = null; resolvePortraits(null); }
  resize();
  return { resize, draw, screenToWorld, destroy, portraitsReady };
}
