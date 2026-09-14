import { DEFENSE_PATH, DEFENSE_PADS, getDefenseAttackPreview, getDefenseProfile } from './grand-line-defense.js?v=2.0.0';
import { CHARACTER_BY_ID } from './grand-line-data.js?v=2.0.0';

const WORLD_W = 1000, WORLD_H = 600, TAU = Math.PI * 2;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const hash = value => [...String(value || '')].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
const STYLE_ICONS = { single: '•', line: '➜', cone: '⋀', radial: '◎', splash: '✹', chain: 'ϟ', support: '+' };
const STYLE_NAMES = { single: 'PRECISION', line: 'PIERCING LINE', cone: 'FAN ATTACK', radial: 'AROUND TOWER', splash: 'SPLASH AREA', chain: 'CHAIN ATTACK', support: 'CREW SUPPORT' };
const shortName = unit => (unit.name || CHARACTER_BY_ID[unit.characterId]?.name || unit.characterId || 'Crew')
  .replace('Tony Tony Chopper', 'Chopper').replace('Monkey D. ', '').replace('Roronoa ', '').replace('Admiral ', '').replace(' the Beast', '');

function ellipse(g, x, y, rx, ry, color) {
  g.fillStyle = color; g.beginPath(); g.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, TAU); g.fill();
}
function stroke(g, points, color, width = 2) {
  if (!points.length) return;
  g.strokeStyle = color; g.lineWidth = width; g.beginPath();
  points.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke();
}
function polygon(g, points, fill, outline) {
  if (!points.length) return;
  g.beginPath(); points.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (outline) { g.strokeStyle = outline; g.stroke(); }
}
function rounded(g, x, y, w, h, r, color) {
  g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}
function spark(g, x, y, r, color) {
  polygon(g, Array.from({ length: 8 }, (_, i) => {
    const a = i / 8 * TAU, radius = i % 2 ? r * .22 : r;
    return [x + Math.cos(a) * radius, y + Math.sin(a) * radius];
  }), color);
}
function closestRoutePoint(p) {
  let closest = DEFENSE_PATH[0] || p, distance = Infinity;
  for (let i = 1; i < DEFENSE_PATH.length; i++) {
    const a = DEFENSE_PATH[i - 1], b = DEFENSE_PATH[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < distance) { closest = q; distance = d; }
  }
  return closest;
}

/** Canvas drawing has its own animation state and never writes to the battle. */
export function createDefenseRenderer(canvas, art) {
  const ctx = canvas.getContext('2d');
  let width = 1, height = 1, dpr = 1, scale = 1, offsetX = 0, offsetY = 0;
  let backdrop = null, destroyed = false, battleKey, seen = new Set(), animations = [];
  let unitPositions = new Map();

  function resize() {
    if (destroyed) return;
    const box = canvas.getBoundingClientRect();
    width = Math.max(1, box.width); height = Math.max(1, box.height);
    dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    const backingWidth = Math.round(width * dpr), backingHeight = Math.round(height * dpr);
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    scale = Math.min(width / WORLD_W, height / WORLD_H);
    offsetX = (width - WORLD_W * scale) / 2; offsetY = (height - WORLD_H * scale) / 2;
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas); resize();

  function makeBackdrop() {
    const surface = canvas.ownerDocument.createElement('canvas');
    surface.width = WORLD_W * 2; surface.height = WORLD_H * 2;
    const g = surface.getContext('2d'); g.scale(2, 2); g.lineCap = 'round'; g.lineJoin = 'round';
    const ocean = g.createLinearGradient(0, 0, WORLD_W, WORLD_H);
    ocean.addColorStop(0, '#073d50'); ocean.addColorStop(.45, '#117d89'); ocean.addColorStop(1, '#073d57');
    g.fillStyle = ocean; g.fillRect(0, 0, WORLD_W, WORLD_H);
    const light = g.createRadialGradient(330, 110, 10, 330, 110, 650);
    light.addColorStop(0, '#7ee8c927'); light.addColorStop(1, '#68dfdb00');
    g.fillStyle = light; g.fillRect(0, 0, WORLD_W, WORLD_H);
    for (let i = 0; i < 180; i++) {
      const x = (i * 83.71 + 27) % 1000, y = (i * 137.19 + 39) % 600;
      g.strokeStyle = i % 4 ? '#baf4dd12' : '#baf4dd29'; g.lineWidth = i % 4 ? 1 : 2;
      g.beginPath(); g.ellipse(x, y, 9 + i % 17, 2.2, -.1, .1, Math.PI - .1); g.stroke();
    }
    // Submerged reef shelves give the route a readable silhouette against the sea.
    stroke(g, DEFENSE_PATH.map(p => ({ x: p.x + 8, y: p.y + 16 })), '#052e3d72', 132);
    stroke(g, DEFENSE_PATH, '#56b9ab40', 118);
    stroke(g, DEFENSE_PATH.map(p => ({ x: p.x, y: p.y + 4 })), '#b5f2d93b', 102);

    for (const pad of DEFENSE_PADS) {
      const end = closestRoutePoint(pad);
      stroke(g, [end, { x: pad.x, y: pad.y + 13 }], '#07353fc7', 39);
      stroke(g, [end, { x: pad.x, y: pad.y + 8 }], '#846842', 30);
      stroke(g, [end, { x: pad.x, y: pad.y + 8 }], '#bb955c', 23);
      const dist = Math.hypot(pad.x - end.x, pad.y + 8 - end.y), n = Math.max(1, Math.floor(dist / 10));
      const nx = -(pad.y + 8 - end.y) / (dist || 1), ny = (pad.x - end.x) / (dist || 1);
      for (let i = 1; i < n; i++) {
        const x = end.x + (pad.x - end.x) * i / n, y = end.y + (pad.y + 8 - end.y) * i / n;
        stroke(g, [{ x: x - nx * 13, y: y - ny * 13 }, { x: x + nx * 13, y: y + ny * 13 }], '#604b37', 2);
      }
      ellipse(g, pad.x, pad.y + 11, 48, 35, '#062d3b77');
      ellipse(g, pad.x, pad.y + 4, 43, 32, '#78674c');
      ellipse(g, pad.x, pad.y - 1, 43, 30, '#d3bd86');
      ellipse(g, pad.x, pad.y - 3, 36, 24, '#b29d71');
      for (const dx of [-34, 34]) {
        rounded(g, pad.x + dx - 3, pad.y + 4, 6, 16, 2, '#645038');
        ellipse(g, pad.x + dx, pad.y + 4, 4, 2.3, '#ddc397');
      }
    }

    // Wide stone paving, a warm edge, and transverse seams communicate the enemy lane.
    stroke(g, DEFENSE_PATH.map(p => ({ x: p.x, y: p.y + 7 })), '#665e43', 84);
    stroke(g, DEFENSE_PATH, '#f1d49a', 84);
    stroke(g, DEFENSE_PATH, '#baa579', 75);
    stroke(g, DEFENSE_PATH, '#ddc99c', 66);
    for (let i = 1; i < DEFENSE_PATH.length; i++) {
      const a = DEFENSE_PATH[i - 1], b = DEFENSE_PATH[i], length = Math.hypot(b.x - a.x, b.y - a.y);
      const dx = (b.x - a.x) / (length || 1), dy = (b.y - a.y) / (length || 1);
      for (let distance = 18; distance < length - 12; distance += 31) {
        const x = a.x + dx * distance, y = a.y + dy * distance;
        stroke(g, [{ x: x - dy * 32, y: y + dx * 32 }, { x: x + dy * 32, y: y - dx * 32 }], '#9689705c', 1.5);
        stroke(g, [{ x: x - dx * 15, y: y - dy * 15 }, { x: x + dx * 15, y: y + dy * 15 }], '#fff1c755', 1);
      }
      if (length > 60) {
        const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
        g.save(); g.translate(x, y); g.rotate(Math.atan2(dy, dx));
        stroke(g, [{ x: -6, y: -6 }, { x: 1, y: 0 }, { x: -6, y: 6 }], '#89745190', 3); g.restore();
      }
    }
    // Small navigation details stay away from the active lane.
    g.save(); g.translate(925, 86); g.strokeStyle = '#cfebd545'; g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, 31, 0, TAU); g.stroke();
    polygon(g, [[0, -35], [7, 0], [0, 24], [-7, 0]], '#d6e7c49e');
    polygon(g, [[-25, 0], [0, -5], [25, 0], [0, 5]], '#83bfb994');
    g.fillStyle = '#d1e7d0b8'; g.font = '12px Georgia'; g.textAlign = 'center'; g.fillText('N', 0, -42); g.restore();
    const first = DEFENSE_PATH[0];
    if (first) {
      ellipse(g, first.x, first.y + 5, 34, 12, '#76533966');
      g.save(); g.translate(first.x, first.y); g.rotate(Math.PI / 4);
      stroke(g, [{ x: -9, y: 0 }, { x: 9, y: 0 }], '#7d5047', 5);
      stroke(g, [{ x: 0, y: -9 }, { x: 0, y: 9 }], '#7d5047', 5); g.restore();
    }
    // The inset edge ties the canvas to the game's brass and navy interface.
    g.strokeStyle = '#d4e5bb35'; g.lineWidth = 2; g.strokeRect(9, 9, 982, 582);
    backdrop = surface;
  }

  function drawWater(now, reducedMotion) {
    if (reducedMotion) return;
    ctx.save(); ctx.strokeStyle = '#d9ffe520'; ctx.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      const x = (i * 167 + 59) % 1000, y = (i * 103 + 47) % 600;
      const route = closestRoutePoint({ x, y });
      if (Math.hypot(route.x - x, route.y - y) < 76 || DEFENSE_PADS.some(p => Math.hypot(p.x - x, p.y - y) < 60)) continue;
      const sway = Math.sin(now * .0007 + i) * 5;
      ctx.beginPath(); ctx.ellipse(x + sway, y, 17, 3, -.08, .15, 2.9); ctx.stroke();
    }
    ctx.restore();
  }

  function label(text, x, y, { color = '#e9eddb', size = 19, background = '#092b36e8', pad = 8 } = {}) {
    ctx.font = `600 ${size}px "Segoe UI", sans-serif`; ctx.textAlign = 'center';
    const w = ctx.measureText(text).width;
    rounded(ctx, x - w / 2 - pad, y - size + 1, w + pad * 2, size + 9, 5, background);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  function drawPads(allies, options) {
    for (let i = 0; i < DEFENSE_PADS.length; i++) {
      const pad = DEFENSE_PADS[i], occupant = allies.find(u => u.padId === pad.id);
      const selected = occupant?.id === options.selectedAllyId || pad.id === options.selectedPadId;
      const hovered = pad.id === options.hoverPadId;
      ctx.save();
      ctx.strokeStyle = selected ? '#ffe4a0' : hovered ? '#b9fcf3' : occupant ? '#aae0b9a8' : '#fff2b882';
      ctx.lineWidth = selected || hovered ? 4 : 2;
      ctx.setLineDash(occupant ? [] : [5, 5]); ctx.beginPath();
      ctx.ellipse(pad.x, pad.y - 3, 34, 23, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      if (!occupant) {
        stroke(ctx, [{ x: pad.x - 7, y: pad.y - 3 }, { x: pad.x + 7, y: pad.y - 3 }], '#e8dfb39c', 2);
        stroke(ctx, [{ x: pad.x, y: pad.y - 10 }, { x: pad.x, y: pad.y + 4 }], '#e8dfb39c', 2);
      }
      // Numbers sit below the feet, so even an occupied post remains identifiable.
      if (!occupant || occupant.hp <= 0) {
        const numberY = Math.min(579, pad.y + 22);
        ellipse(ctx, pad.x - 32, numberY, 14, 14, selected ? '#f3d28a' : '#123d45');
        ctx.fillStyle = selected ? '#17323b' : '#f4db9f'; ctx.font = '700 20px "Segoe UI", sans-serif';
        ctx.textAlign = 'center'; ctx.fillText(String(i + 1), pad.x - 32, numberY + 7);
      }
      ctx.restore();
    }
  }

  function drawShip(ship = {}) {
    const x = finite(ship.x, 940), y = finite(ship.y, 475);
    ctx.save(); ctx.translate(x, y);
    ellipse(ctx, 0, 22, 50, 20, '#062b3c99');
    ctx.strokeStyle = '#bcebd37a'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(0, 25 + i * 5, 46 + i * 4, 14, 0, .1, Math.PI - .1); ctx.stroke(); }
    polygon(ctx, [[-45, -2], [-33, 31], [21, 36], [49, 8], [36, -10]], '#734e35', '#e4c28a');
    polygon(ctx, [[-43, -2], [-30, 15], [25, 20], [48, 7], [33, -12]], '#c29659', '#f3d799');
    stroke(ctx, [{ x: -30, y: 23 }, { x: 22, y: 28 }, { x: 37, y: 16 }], '#3f382e', 3);
    for (let i = 0; i < 4; i++) ellipse(ctx, -23 + i * 14, 20, 3, 3, '#233d42');
    stroke(ctx, [{ x: -5, y: 9 }, { x: -5, y: -98 }], '#584637', 6);
    stroke(ctx, [{ x: -35, y: -72 }, { x: 27, y: -72 }], '#bd995f', 4);
    ctx.fillStyle = '#f1e6bb'; ctx.beginPath(); ctx.moveTo(-32, -71);
    ctx.quadraticCurveTo(-43, -37, -29, -12); ctx.quadraticCurveTo(0, -23, 27, -11);
    ctx.quadraticCurveTo(16, -42, 25, -71); ctx.closePath(); ctx.fill();
    stroke(ctx, [{ x: -32, y: -71 }, { x: 25, y: -71 }], '#ffefc9', 2);
    ellipse(ctx, -3, -43, 10, 9, '#1e3e45'); ellipse(ctx, -7, -43, 2, 2.5, '#f1e6bb'); ellipse(ctx, 1, -43, 2, 2.5, '#f1e6bb');
    stroke(ctx, [{ x: -10, y: -31 }, { x: 5, y: -35 }], '#1e3e45', 3);
    stroke(ctx, [{ x: -10, y: -35 }, { x: 5, y: -31 }], '#1e3e45', 3);
    ellipse(ctx, -3, -50, 14, 3, '#be8050'); ellipse(ctx, -3, -53, 8, 4, '#d5b66c');
    polygon(ctx, [[-3, -100], [26, -93], [-3, -83]], '#c96958');
    ctx.restore();
    const ratio = clamp(finite(ship.hp) / Math.max(1, finite(ship.maxHp, 1)), 0, 1);
    const barX = clamp(x, 60, 940), barY = Math.min(574, y + 57);
    label('YOUR SHIP', barX, barY, { size: 17, color: '#f5dfa7' });
    rounded(ctx, barX - 44, barY + 13, 88, 9, 4, '#062833');
    rounded(ctx, barX - 42, barY + 15, 84 * ratio, 5, 2, ratio > .3 ? '#8bd8b8' : '#ef9478');
  }

  function traceArea(shape, from, to, geometry, range) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const length = finite(range, 200), radius = finite(geometry.radius, 55);
    ctx.beginPath();
    if (shape === 'line') {
      const nx = -Math.sin(angle), ny = Math.cos(angle), half = finite(geometry.width, 34) / 2;
      const end = { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
      ctx.moveTo(from.x + nx * half, from.y + ny * half); ctx.lineTo(end.x + nx * half, end.y + ny * half);
      ctx.lineTo(end.x - nx * half, end.y - ny * half); ctx.lineTo(from.x - nx * half, from.y - ny * half); ctx.closePath();
    } else if (shape === 'cone') {
      const spread = finite(geometry.angle, .48);
      ctx.moveTo(from.x, from.y); ctx.arc(from.x, from.y, length, angle - spread, angle + spread); ctx.closePath();
    } else if (shape === 'radial' || shape === 'support') ctx.arc(from.x, from.y, shape === 'support' ? length : radius || length, 0, TAU);
    else ctx.arc(to.x, to.y, shape === 'single' ? 14 : radius, 0, TAU);
  }

  function drawRange(b, unit, options) {
    if (!unit || unit.hp <= 0 || !Number.isFinite(unit.range)) return;
    ctx.save(); ctx.fillStyle = '#cdf1c709'; ctx.strokeStyle = '#e8edba72'; ctx.lineWidth = 1.5;
    ctx.setLineDash([9, 7]); ctx.beginPath(); ctx.arc(unit.x, unit.y, unit.range, 0, TAU); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    const skill = unit.skills.find(s => s.id === options.previewSkillId) || unit.skills[0];
    const preview = getDefenseAttackPreview(b, unit, skill);
    if (preview) {
      const from = preview.source || unit, to = preview.target || unit.lastAim || closestRoutePoint(unit);
      const geometry = preview.geometry || preview, shape = preview.shape || geometry.shape || 'single';
      ctx.fillStyle = '#ffe69520'; ctx.strokeStyle = '#ffe49bad'; ctx.lineWidth = 2;
      traceArea(shape, from, to, geometry, preview.range ?? unit.range); ctx.fill(); ctx.stroke();
      if (shape !== 'radial') {
        ctx.setLineDash([4, 6]); stroke(ctx, [from, to], '#fcefc18c', 1.5); ctx.setLineDash([]);
        ctx.strokeStyle = '#fff5c8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(to.x, to.y, 9, 0, TAU); ctx.stroke();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) stroke(ctx, [{ x: to.x + dx * 12, y: to.y + dy * 12 }, { x: to.x + dx * 17, y: to.y + dy * 17 }], '#fff5c8', 2);
      }
      const affected = (preview.targetIds || []).map(id => b.enemies.find(enemy => enemy.id === id)).filter(Boolean);
      if (shape === 'chain') {
        ctx.setLineDash([4, 5]); stroke(ctx, [from, ...affected], '#bcecf2a1', 2); ctx.setLineDash([]);
      }
      for (const enemy of affected) {
        ctx.strokeStyle = '#fff1aaa6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(enemy.x, enemy.y, 16, 8, 0, 0, TAU); ctx.stroke();
      }
      label(`${STYLE_ICONS[shape] || '•'} ${STYLE_NAMES[shape] || 'ATTACK AREA'}`, 764, 76, { size: 15, color: '#ffebb5', background: '#102f3ce8' });
    }
    ctx.restore();
  }

  function summonPreview(b, options) {
    const character = CHARACTER_BY_ID[options.summonCharacterId], profile = getDefenseProfile(options.summonCharacterId);
    if (!character || !profile) return null;
    const pad = DEFENSE_PADS.find(pad => pad.id === (options.hoverPadId || options.selectedPadId));
    if (!pad || b.allies.some(unit => unit.padId === pad.id)) return null;
    const reserve = b.reserve?.[character.id];
    // This temporary unit is only a preview; the engine remains the owner of summons.
    return { ...character, ...reserve, id: `preview-${character.id}`, characterId: character.id, side: 'ally', x: pad.x, y: pad.y, padId: pad.id,
      profile, range: finite(reserve?.range, profile.range), hp: 1, maxHp: 1, level: reserve?.level || 1, specialization: reserve?.specialization || '', priority: reserve?.priority || 'first', statuses: [], escaped: false };
  }

  function paintSummonPreview(unit) {
    if (!unit) return;
    const asset = art?.load(unit.characterId), h = Math.max(36, Math.min(unit.y - 12, 84));
    ctx.save(); ctx.globalAlpha = .62;
    ellipse(ctx, unit.x, unit.y + 2, 28, 9, '#b8f7df8a');
    if (asset?.loaded && asset.bounds && asset.image) {
      const r = asset.bounds, width = h * r.w / r.h;
      ctx.translate(unit.x, unit.y); ctx.scale(-1, 1);
      ctx.drawImage(asset.image, r.x, r.y, r.w, r.h, -width / 2, -h, width, h);
    } else {
      ellipse(ctx, unit.x, unit.y - h * .78, 9, 10, '#cdfbe5');
      polygon(ctx, [[unit.x - 10, unit.y - h * .6], [unit.x + 10, unit.y - h * .6], [unit.x + 20, unit.y], [unit.x - 20, unit.y]], '#a9ecda');
    }
    ctx.restore();
    label('SUMMON HERE', unit.x, Math.min(588, unit.y + 29), { size: 14, color: '#c7ffea', background: '#0a3e47ee' });
  }

  function drawRaider(unit, x, y, h) {
    const type = String(unit.archetype || unit.enemyType || unit.type || (unit.boss ? 'captain' : 'swarm'));
    const armored = /armor|guard|brute/.test(type), runner = /runner|scout|swift/.test(type);
    const captain = unit.boss || /captain/.test(type), caster = /ranged|artillery|gunner/.test(type);
    ctx.save(); ctx.translate(x, y); ctx.scale(h / 64, h / 64);
    const coat = armored ? '#506174' : runner ? '#965051' : caster ? '#777aa0' : '#d4c8a8';
    // Compact enemy silhouettes keep dense packs readable at phone scale.
    stroke(ctx, [{ x: -5, y: -13 }, { x: -7, y: -1 }], '#263e48', 6);
    stroke(ctx, [{ x: 5, y: -13 }, { x: 9, y: -2 }], '#263e48', 6);
    polygon(ctx, [[-10, -42], [10, -42], [14, -13], [-14, -13]], coat, '#18333dc9');
    if (armored) {
      polygon(ctx, [[-13, -42], [0, -49], [14, -42], [10, -22], [0, -17], [-10, -22]], '#8097a8', '#cee3dc');
      polygon(ctx, [[-21, -37], [-6, -40], [-7, -15], [-15, -8], [-23, -17]], '#486e85', '#b9d5d6');
      stroke(ctx, [{ x: -16, y: -31 }, { x: -15, y: -17 }], '#cde7e1', 2);
    } else {
      stroke(ctx, [{ x: -9, y: -36 }, { x: -16, y: -25 }], coat, 7);
      stroke(ctx, [{ x: 9, y: -36 }, { x: 16, y: -27 }], coat, 7);
      rounded(ctx, -11, -20, 23, 5, 1, '#806f52');
      if (runner) {
        polygon(ctx, [[-9, -42], [8, -43], [22, -36], [10, -33]], '#e38c6f');
        stroke(ctx, [{ x: 17, y: -31 }, { x: 29, y: -45 }], '#dcebe4', 3);
      } else if (caster) {
        stroke(ctx, [{ x: 8, y: -29 }, { x: 27, y: -39 }], '#273945', 7);
        stroke(ctx, [{ x: 22, y: -38 }, { x: 33, y: -43 }], '#9aafaf', 3);
      } else stroke(ctx, [{ x: 16, y: -29 }, { x: 27, y: -45 }], '#e0e9d5', 3);
    }
    ellipse(ctx, 0, -48, 9, 10, '#d4a486');
    if (armored) {
      ctx.fillStyle = '#708997'; ctx.beginPath(); ctx.arc(0, -49, 11, Math.PI, TAU); ctx.fill();
      stroke(ctx, [{ x: -10, y: -49 }, { x: 10, y: -49 }], '#c2d6d6', 2);
    } else {
      rounded(ctx, -11, -58, 22, 9, 3, runner ? '#8b4948' : '#e8dec4');
      rounded(ctx, -11, -51, 23, 3, 1, '#334f63');
    }
    stroke(ctx, [{ x: -4, y: -47 }, { x: -2, y: -47 }], '#493c3a', 1.5);
    stroke(ctx, [{ x: 3, y: -47 }, { x: 5, y: -47 }], '#493c3a', 1.5);
    if (captain) polygon(ctx, [[-16, -60], [-11, -73], [0, -65], [11, -73], [16, -60]], '#e7b968', '#fff0ba');
    ctx.restore();
  }

  function paintUnit(unit, ally, now, options) {
    const pos = unitPositions.get(unit.id); if (!pos) return;
    const dead = unit.hp <= 0, selected = ally && unit.id === options.selectedAllyId;
    const h = pos.h, x = pos.x, bob = ally || options.reducedMotion ? 0 : Math.sin(now * .008 + hash(unit.id)) * 1.5;
    const y = pos.y + bob, info = CHARACTER_BY_ID[unit.characterId];
    ctx.save(); ctx.globalAlpha = dead ? .28 : 1;
    ellipse(ctx, x, y + 2, h * .23, h * .065, '#06232a91');
    if (selected) { ctx.strokeStyle = '#ffe2a0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y + 1, 26, 9, 0, 0, TAU); ctx.stroke(); }
    if (unit.shield > 0) {
      ctx.fillStyle = '#8fdff016'; ctx.strokeStyle = '#a5e8f6b8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y - h * .46, h * .34, h * .52, 0, 0, TAU); ctx.fill(); ctx.stroke();
    }
    const asset = ally || unit.boss ? art?.load(unit.characterId) : null;
    if (asset?.loaded && asset.bounds && asset.image) {
      const r = asset.bounds, w = h * r.w / r.h;
      ctx.save(); ctx.translate(x, y); if (ally) ctx.scale(-1, 1);
      ctx.drawImage(asset.image, r.x, r.y, r.w, r.h, -w / 2, -h, w, h); ctx.restore();
    } else if (!ally) drawRaider(unit, x, y, h);
    else {
      const color = info?.color || (ally ? '#91d6b4' : '#e2a693');
      ellipse(ctx, x, y - h * .77, h * .12, h * .13, color);
      polygon(ctx, [[x - h * .08, y - h * .62], [x + h * .1, y - h * .62], [x + h * .24, y - 4], [x - h * .22, y - 4]], color);
      ctx.fillStyle = '#0d343d'; ctx.textAlign = 'center'; ctx.font = `700 ${h * .23}px Georgia`;
      ctx.fillText(shortName(unit).slice(0, 1).toUpperCase(), x, y - h * .29);
    }
    ctx.restore();
    const ratio = clamp(finite(unit.hp) / Math.max(1, finite(unit.maxHp, 1)), 0, 1), bw = ally ? 55 : unit.boss ? 58 : 31;
    rounded(ctx, x - bw / 2 - 2, y + 5, bw + 4, 9, 3, '#052532');
    rounded(ctx, x - bw / 2, y + 7, bw * ratio, 5, 2, ally ? '#9ee0b4' : '#f3a289');
    if (unit.shield > 0) rounded(ctx, x - bw / 2, y + 16, bw * clamp(unit.shield / Math.max(1, unit.maxHp), 0, 1), 3, 1, '#a0e8f8');
    if (ally && !dead) {
      const name = shortName(unit), number = DEFENSE_PADS.findIndex(p => p.id === unit.padId) + 1;
      const shape = unit.profile?.skills?.[0]?.shape || 'single';
      const badgeY = Math.max(14, y - h + 8);
      label(`${STYLE_ICONS[shape] || '•'} ${unit.level || 1}`, x + 24, badgeY, { size: 14, pad: 5, color: '#ffe6a2', background: '#082e3fe8' });
      label(`${number} · ${name.length > 13 ? name.slice(0, 12) + '…' : name}`, x + 3, Math.min(588, y + 39), {
        size: 17, pad: 5, color: selected ? '#ffe4a0' : '#e9eddb',
      });
    }
    if (!ally && unit.boss && !dead) label('CAPTAIN', x, Math.max(18, y - h - 4), { size: 13, pad: 5, color: '#ffe1a2', background: '#5b353cde' });
    if (selected) {
      polygon(ctx, [[x - 7, y - h - 13], [x + 7, y - h - 13], [x, y - h - 5]], '#ffe6a5');
    }
    const status = unit.statuses?.find(s => ['freeze', 'stun', 'burn', 'poison', 'slow'].includes(s.type));
    if (status && !dead) {
      const symbol = { freeze: '❄', stun: '✦', burn: '♨', poison: '●', slow: '↓' }[status.type];
      ctx.fillStyle = '#fff0b4'; ctx.font = '21px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(symbol, x + 21, y - h + 12);
    }
  }

  function blade(x, y, angle, size, color, triple = false) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    const count = triple ? 3 : 1;
    for (let i = 0; i < count; i++) {
      ctx.save(); ctx.translate(-i * 9, (i - (count - 1) / 2) * 9);
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-size * .18, -size);
      ctx.bezierCurveTo(size * .9, -size * .43, size * .9, size * .43, -size * .18, size);
      ctx.bezierCurveTo(size * .38, size * .35, size * .38, -size * .35, -size * .18, -size); ctx.fill();
      ctx.strokeStyle = '#ecffe1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-size * .18, -size);
      ctx.bezierCurveTo(size * .9, -size * .43, size * .9, size * .43, -size * .18, size); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }

  function fist(x, y, angle, size, haki = false) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(size / 12, size / 12);
    rounded(ctx, -11, -8, 17, 17, 4, haki ? '#493549' : '#eaa887');
    rounded(ctx, -3, -11, 13, 20, 5, haki ? '#342738' : '#f4bf96');
    rounded(ctx, -6, 3, 11, 9, 3, haki ? '#675060' : '#da916f');
    for (let i = 0; i < 3; i++) stroke(ctx, [{ x: 0, y: -6 + i * 5 }, { x: 7, y: -6 + i * 5 }], haki ? '#e88cab' : '#b66e5a', 1.5);
    ctx.restore();
  }

  function rubberArm(from, to, size, alpha = 1, haki = false) {
    ctx.save(); ctx.globalAlpha *= alpha;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    stroke(ctx, [from, to], haki ? '#532f43' : '#a2574c', size * 1.12);
    stroke(ctx, [from, to], haki ? '#a65c79' : '#e9a383', size * .76);
    stroke(ctx, [{ x: from.x, y: from.y }, { x: from.x + Math.cos(angle) * 13, y: from.y + Math.sin(angle) * 13 }], '#d85450', size * 1.28);
    fist(to.x, to.y, angle, size * 1.35, haki); ctx.restore();
  }

  function earthquake(from, radius, phase, seed, strong = false) {
    const reach = Math.max(8, radius * phase);
    ctx.save();
    ctx.strokeStyle = '#b8f1f36b'; ctx.lineWidth = strong ? 5 : 3;
    ctx.beginPath(); ctx.arc(from.x, from.y, reach, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#e5fdeda8'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(from.x, from.y, reach * .84, 0, TAU); ctx.stroke();
    for (let i = 0; i < 7; i++) {
      const angle = i * TAU / 7 + (seed % 17) * .07;
      const points = Array.from({ length: 6 }, (_, j) => {
        const d = reach * j / 5, bend = Math.sin(i * 13 + j * 8 + seed) * reach * .055;
        return { x: from.x + Math.cos(angle) * d - Math.sin(angle) * bend, y: from.y + Math.sin(angle) * d + Math.cos(angle) * bend };
      });
      stroke(ctx, points, '#193e50', strong ? 6 : 4); stroke(ctx, points, '#d7fff1', strong ? 2.5 : 1.8);
      const branch = points[3];
      stroke(ctx, [branch, { x: branch.x + Math.cos(angle + .6) * reach * .19, y: branch.y + Math.sin(angle + .6) * reach * .19 }], '#d7fff1', 1.5);
    }
    ctx.restore();
  }

  function bolt(points, color, width = 3, seed = 0) {
    const zigzag = [];
    for (let j = 1; j < points.length; j++) {
      const a = points[j - 1], z = points[j], length = Math.hypot(z.x - a.x, z.y - a.y), n = Math.max(2, Math.ceil(length / 20));
      for (let i = 0; i <= n; i++) {
        const t = i / n, offset = i && i < n ? Math.sin(i * 12 + seed + j * 7) * 9 : 0;
        zigzag.push({ x: a.x + (z.x - a.x) * t - (z.y - a.y) / (length || 1) * offset, y: a.y + (z.y - a.y) * t + (z.x - a.x) / (length || 1) * offset });
      }
    }
    stroke(ctx, zigzag, color, width); stroke(ctx, zigzag, '#f5ffda', Math.max(1, width / 3));
  }

  function groundRupture(from, to, width, seed) {
    const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy);
    const nx = -dy / (distance || 1), ny = dx / (distance || 1);
    for (let row = -1; row <= 1; row++) {
      const points = Array.from({ length: 11 }, (_, i) => {
        const f = i / 10, offset = (row * width * .33 + Math.sin(i * 2.7 + seed + row * 4) * width * .13) * Math.min(1, f * 5);
        return { x: from.x + dx * f + nx * offset, y: from.y + dy * f + ny * offset };
      });
      stroke(ctx, points, '#15394b', 7); stroke(ctx, points, '#c0faf3', 2.5);
      for (let i = 3; i < points.length; i += 3) {
        const p = points[i], side = i % 2 ? 1 : -1;
        stroke(ctx, [p, { x: p.x - dx * .035 + nx * width * .18 * side, y: p.y - dy * .035 + ny * width * .18 * side }], '#d9fff1', 1.5);
      }
    }
    ctx.strokeStyle = '#e0fff0ab'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(to.x, to.y, width * .56, 12, Math.atan2(dy, dx) + Math.PI / 2, Math.PI, TAU); ctx.stroke();
  }

  function paintProjectiles(b, reducedMotion) {
    for (const p of (b.projectiles || []).slice(-100)) {
      if (!p.start || !p.end) continue;
      const phase = clamp(p.age / Math.max(.01, p.duration), 0, 1), angle = Math.atan2(p.end.y - p.start.y, p.end.x - p.start.x);
      const ground = p.characterId === 'whitebeard' && ['earth', 'quake'].includes(p.kind);
      const lift = ground ? 0 : 30;
      const from = { x: p.start.x, y: p.start.y - lift }, to = { x: finite(p.x, p.end.x), y: finite(p.y, p.end.y) - lift };
      const end = { x: p.end.x, y: p.end.y - lift }, color = p.color || '#ffdb92', seed = hash(p.id);
      const powerful = !p.skillId?.endsWith('-0');
      ctx.save();
      if (reducedMotion) {
        ctx.globalAlpha = .5; ctx.strokeStyle = color; ctx.lineWidth = 3;
        traceArea(p.shape, p.start, p.end, p, p.range); ctx.stroke();
        ellipse(ctx, to.x, to.y, 7, 7, color); ctx.restore(); continue;
      }
      if (ground) {
        if (p.shape === 'line') groundRupture(p.start, to, p.width || 100, seed);
        else earthquake(p.start, p.radius || p.range, phase, seed, powerful);
        ellipse(ctx, from.x, from.y - 33, 13 + Math.sin(phase * Math.PI) * 7, 13, '#e6fcf198');
      } else if (p.characterId === 'luffy') {
        if (p.shape === 'radial') {
          const reach = (p.radius || p.range) * Math.sin(phase * Math.PI / 2);
          for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + seed; rubberArm(from, { x: from.x + Math.cos(a) * reach, y: from.y + Math.sin(a) * reach }, 8, .6, powerful); }
        } else if (p.shape === 'cone' || /gatling/i.test(p.animation || p.skillId)) {
          for (let i = 0; i < 7; i++) {
            const a = angle + (i - 3) / 3 * (p.angle || .4), pulse = .68 + .32 * Math.sin(phase * 14 + i * 2.6) ** 2;
            const reach = (p.range || Math.hypot(end.x - from.x, end.y - from.y)) * Math.min(1, phase * 2.6) * pulse;
            rubberArm({ x: from.x, y: from.y + (i % 2 ? 5 : -5) }, { x: from.x + Math.cos(a) * reach, y: from.y + Math.sin(a) * reach }, 7, .45 + i * .055, powerful);
          }
        } else rubberArm(from, to, powerful ? 13 : 9, .95, powerful);
      } else if (p.characterId === 'whitebeard' && p.kind === 'slash') {
        // Murakumogiri's long pole and crescent blade are visible before the air slash.
        const sweep = angle - .9 + phase * 1.8, reach = 71;
        const bladeEnd = { x: from.x + Math.cos(sweep) * reach, y: from.y + Math.sin(sweep) * reach };
        stroke(ctx, [{ x: from.x - Math.cos(sweep) * 31, y: from.y - Math.sin(sweep) * 31 }, bladeEnd], '#382f38', 7);
        stroke(ctx, [{ x: from.x - Math.cos(sweep) * 31, y: from.y - Math.sin(sweep) * 31 }, bladeEnd], '#bd954c', 3);
        blade(bladeEnd.x, bladeEnd.y, sweep, 23, '#e8edcb');
        blade(to.x, to.y, angle, Math.max(26, finite(p.width, 50) * .6), '#b8eeec');
      } else if (p.kind === 'slash' || ['zoro', 'brook', 'killer', 'kaku'].includes(p.characterId)) {
        const shade = p.characterId === 'zoro' ? '#a7f3b0' : color;
        if (p.shape === 'radial' || p.shape === 'cone') {
          const count = p.shape === 'radial' ? 7 : 4;
          const reach = (p.shape === 'radial' ? p.radius : p.range) * phase;
          for (let i = 0; i < count; i++) {
            const a = p.shape === 'radial' ? i * TAU / count + phase : angle + (i / (count - 1) - .5) * p.angle * 2;
            blade(from.x + Math.cos(a) * reach, from.y + Math.sin(a) * reach, a, 24, shade);
          }
        } else {
          stroke(ctx, [{ x: to.x - Math.cos(angle) * 45, y: to.y - Math.sin(angle) * 45 }, to], shade + '65', 5);
          blade(to.x, to.y, angle, Math.max(21, finite(p.width, 35) * .6), shade, p.characterId === 'zoro');
        }
      } else if (['lightning', 'electric', 'light'].includes(p.kind) || p.shape === 'chain') {
        bolt([from, to], color, powerful ? 5 : 3, seed + Math.floor(phase * 8)); spark(ctx, to.x, to.y, 11, '#fff0ae');
      } else if (p.shape === 'radial') {
        const radius = (p.radius || p.range) * phase;
        ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(from.x, from.y, radius, 0, TAU); ctx.stroke();
        for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + phase; spark(ctx, from.x + Math.cos(a) * radius, from.y + Math.sin(a) * radius, 7, color); }
      } else if (['fire', 'magma', 'explosion', 'dragon'].includes(p.kind)) {
        const distance = Math.hypot(to.x - from.x, to.y - from.y), tail = Math.min(distance, powerful ? 72 : 40);
        stroke(ctx, [{ x: to.x - Math.cos(angle) * tail, y: to.y - Math.sin(angle) * tail }, to], '#ee80566e', powerful ? 18 : 11);
        if (p.shape === 'cone') {
          const spread = finite(p.angle, .35), reach = p.range * phase;
          ctx.fillStyle = '#ff7d4340'; traceArea('cone', from, end, p, reach); ctx.fill();
          for (let i = 0; i < 5; i++) { const a = angle + (i - 2) * spread / 2; const f = { x: from.x + Math.cos(a) * reach, y: from.y + Math.sin(a) * reach }; stroke(ctx, [from, f], i % 2 ? '#ffcd7c88' : '#ed75516e', 8); ellipse(ctx, f.x, f.y, 9, 9, color); }
        } else if (p.kind === 'dragon' && p.shape === 'line') {
          stroke(ctx, [from, to], '#e7755266', (p.width || 80) * .8);
          stroke(ctx, [from, to], '#ffce836b', (p.width || 80) * .37);
          for (let i = 0; i < 5; i++) { const d = (i - 2) * (p.width || 80) / 6; ellipse(ctx, to.x - Math.sin(angle) * d, to.y + Math.cos(angle) * d, 11, 11, i % 2 ? color : '#ffe3a0'); }
        } else { ellipse(ctx, to.x, to.y, powerful ? 13 : 9, powerful ? 13 : 9, color); ellipse(ctx, to.x + 2, to.y - 2, 6, 6, '#fff3b0'); }
      } else if (['ice', 'water', 'wind', 'sand', 'poison', 'plant', 'smoke', 'soul', 'soap'].includes(p.kind)) {
        for (let i = 0; i < 4; i++) {
          const length = Math.min(36, Math.hypot(to.x - from.x, to.y - from.y)) * i / 4;
          const x = to.x - Math.cos(angle) * length, y = to.y - Math.sin(angle) * length;
          ctx.globalAlpha = 1 - i * .17;
          if (p.kind === 'ice') polygon(ctx, [[x + 11, y], [x - 7, y - 7], [x - 3, y + 8]], i % 2 ? '#f1ffef' : color);
          else ellipse(ctx, x, y + Math.sin(i * 2 + phase * 8) * 4, 8 - i, 9 - i, color);
        }
      } else if (p.kind === 'punch') rubberArm(from, to, powerful ? 9 : 6, .75);
      else {
        stroke(ctx, [{ x: to.x - Math.cos(angle) * 28, y: to.y - Math.sin(angle) * 28 }, to], '#f5e5b991', 2.5);
        ellipse(ctx, to.x, to.y, 6, 6, color); ellipse(ctx, to.x + 1, to.y - 1, 2, 2, '#fffbe0');
      }
      ctx.restore();
    }
  }

  function recordEffects(b, now) {
    const fresh = [];
    for (const event of b.effects || []) {
      if (seen.has(event.id)) continue;
      seen.add(event.id); fresh.push(event);
      const source = event.source || unitPositions.get(event.sourceId);
      const targets = event.targets?.length ? event.targets : (event.targetIds || []).map(id => unitPositions.get(id)).filter(Boolean);
      if (event.projectileId || event.kind === 'projectile-launch') continue;
      animations.push({ event, start: now - finite(event.age) * 1000,
        duration: event.kind === 'impact' ? 450 : ['damage', 'knockout'].includes(event.kind) ? 650 : 1050,
        source: source ? { x: source.x, y: source.y - 36 } : null,
        targets: targets.map(t => ({ x: t.x, y: t.y - 35 })) });
    }
    if (seen.size > 1200) seen = new Set([...seen].slice(-600));
    animations = animations.filter(a => now - a.start < a.duration).slice(-64);
    return fresh;
  }

  function paintEffects(now, reducedMotion) {
    for (const a of animations) {
      const e = a.event, t = clamp((now - a.start) / a.duration, 0, 1), color = e.color || '#f2d28d';
      const targets = a.targets.length ? a.targets : a.source ? [a.source] : [];
      const seed = hash(e.animation || e.skillId || e.id), phase = clamp(t * 2.9, 0, 1);
      ctx.save(); ctx.globalAlpha = reducedMotion ? .65 * (1 - t * .65) : Math.min(1, (1 - t) * 2.5);
      if (e.kind === 'impact') {
        const profile = e.geometry || e, shape = e.shape || profile.shape;
        const source = e.source || (a.source ? { x: a.source.x, y: a.source.y + 36 } : null);
        const center = e.center || e.end || e.targets?.[0] || source;
        if (center) {
          const radius = finite(profile.radius, shape === 'single' ? 18 : 40);
          if (shape === 'radial' && source) {
            ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(source.x, source.y, radius * (.86 + t * .14), 0, TAU); ctx.stroke();
          } else if (shape === 'splash') {
            ctx.fillStyle = color + (color.length === 7 ? '20' : ''); ctx.strokeStyle = color; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(center.x, center.y, radius * (.45 + phase * .55), 0, TAU); ctx.fill(); ctx.stroke();
            for (let i = 0; i < 9; i++) { const angle = i * TAU / 9 + seed; spark(ctx, center.x + Math.cos(angle) * radius * t, center.y - 20 + Math.sin(angle) * radius * t, 7 * (1 - t) + 2, i % 2 ? color : '#fff1c4'); }
          } else if (shape === 'chain' && source) bolt([{ x: source.x, y: source.y - 30 }, ...targets], color, 3, seed);
          for (const to of targets.slice(0, 16)) spark(ctx, to.x, to.y, 8 + 12 * (1 - t), color);
        }
        ctx.restore(); continue;
      }
      if (['damage', 'knockout'].includes(e.kind)) {
        for (const to of targets.slice(0, 1)) {
          if (e.kind === 'knockout') { ctx.strokeStyle = '#f9dfae'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(to.x, to.y + 28, 12 + t * 13, 5 + t * 5, 0, 0, TAU); ctx.stroke(); }
          else if (e.amount >= 35 || e.critical) {
            ctx.textAlign = 'center'; ctx.font = `${e.critical ? 800 : 600} ${e.critical ? 18 : 14}px "Segoe UI", sans-serif`; ctx.lineWidth = 3;
            const text = `${e.critical ? '✦ ' : ''}${Math.round(e.amount)}`, yy = to.y - 26 - (reducedMotion ? 0 : t * 18);
            ctx.strokeStyle = '#143341'; ctx.strokeText(text, to.x, yy); ctx.fillStyle = e.critical ? '#ffe59e' : '#fff2d0'; ctx.fillText(text, to.x, yy);
          }
        }
        ctx.restore(); continue;
      }
      for (const to of targets.slice(0, 12)) {
        const x = to.x, y = to.y, source = a.source || to, sx = source.x, sy = source.y;
        const px = sx + (x - sx) * phase, py = sy + (y - sy) * phase, r = e.skillId ? 38 : 23, kind = e.kind;
        if (reducedMotion) {
          ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r * .65, 0, TAU); ctx.stroke();
          if (['heal', 'revive'].includes(kind)) { stroke(ctx, [{ x: x - 8, y }, { x: x + 8, y }], color, 4); stroke(ctx, [{ x, y: y - 8 }, { x, y: y + 8 }], color, 4); }
        } else if (['punch', 'projectile', 'shot', 'basic'].includes(kind)) {
          stroke(ctx, [{ x: sx, y: sy }, { x: px, y: py }], color, kind === 'punch' ? 5 : 2);
          ellipse(ctx, px, py, kind === 'punch' ? 8 : 5, 6, color);
          if (phase === 1) spark(ctx, x, y, r * (1 - t), '#fff1be');
        } else if (['slash', 'string', 'rope'].includes(kind)) {
          if (phase < 1) stroke(ctx, [{ x: sx, y: sy }, { x: px, y: py }], color, 2);
          ctx.save(); ctx.translate(x, y); ctx.rotate(-.8 + seed % 5 * .2);
          for (let i = 0; i < (kind === 'slash' ? 3 : 6); i++) {
            ctx.strokeStyle = color; ctx.lineWidth = kind === 'slash' ? 4 : 1.5; ctx.beginPath();
            ctx.ellipse((i - 1) * 9, 0, r * phase, r * .27, 0, -2.6, .7); ctx.stroke();
          } ctx.restore();
        } else if (['lightning', 'light', 'electric'].includes(kind)) {
          const points = Array.from({ length: 9 }, (_, i) => ({ x: x + (i && i < 8 ? Math.sin(i * 6 + seed) * r * .45 : 0), y: y - 100 + i / 8 * 103 }));
          stroke(ctx, points, color, 5); stroke(ctx, points, '#fffbdc', 1.5); spark(ctx, x, y, r * .6, '#ffefb4');
        } else if (['heal', 'revive', 'shield', 'cleanse'].includes(kind)) {
          ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath();
          for (let i = 0; i <= 6; i++) { const angle = i / 6 * TAU - Math.PI / 2; const xx = x + Math.cos(angle) * r, yy = y + Math.sin(angle) * r; i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.stroke();
          if (kind !== 'shield') {
            stroke(ctx, [{ x: x - 10, y: y - t * 15 }, { x: x + 10, y: y - t * 15 }], color, 5);
            stroke(ctx, [{ x, y: y - 10 - t * 15 }, { x, y: y + 10 - t * 15 }], color, 5);
          }
          for (let i = 0; i < 5; i++) spark(ctx, x + Math.cos(i * 2.1) * r * .8, y + Math.sin(i * 2.1) * r * .8 - t * 15, 4, color);
        } else if (['fire', 'magma', 'explosion', 'dragon'].includes(kind)) {
          if (kind === 'dragon') {
            const points = Array.from({ length: 19 }, (_, i) => { const f = i / 18; return { x: sx + (x - sx) * f * phase, y: sy + (y - sy) * f * phase + Math.sin(f * TAU * 2 - t * 5) * 10 }; });
            stroke(ctx, points, color, 13); stroke(ctx, points, '#ffe6a3', 3);
          } else { ellipse(ctx, px, py, 10, 7, color); ellipse(ctx, px - 3, py, 4, 4, '#ffebac'); }
          if (phase > .6) for (let i = 0; i < 10; i++) {
            const angle = i / 10 * TAU, spread = r * t;
            ellipse(ctx, x + Math.cos(angle) * spread, y + Math.sin(angle) * spread - t * 13, 5 * (1 - t) + 2, 9 * (1 - t) + 2, i % 2 ? color : '#ffe1a0');
          }
        } else if (['ice', 'earth', 'quake'].includes(kind)) {
          for (let i = 0; i < 5; i++) { const xx = x + (i - 2) * 13; polygon(ctx, [[xx - 7, y + 17], [xx + 2, y - r * phase * (.6 + (i % 2) * .4)], [xx + 9, y + 12]], i % 2 ? color : '#d7e9d5'); }
          stroke(ctx, [{ x: x - r, y: y + 20 }, { x: x - 8, y: y + 12 }, { x: x + 9, y: y + 22 }, { x: x + r, y: y + 13 }], color, 3);
        } else if (['water', 'wind', 'sand', 'smoke', 'soul', 'soap', 'poison'].includes(kind)) {
          for (let i = 0; i < 5; i++) {
            ctx.strokeStyle = color; ctx.lineWidth = kind === 'water' ? 5 : 2.5; ctx.beginPath();
            ctx.ellipse(x + Math.sin(i * 2 + t * 3) * 7, y + (i - 2) * 9, r * (.55 + i * .1) * phase, r * .23, i * .15 + t, .2, Math.PI * 1.75); ctx.stroke();
          }
        } else if (['gravity', 'dark', 'magnet'].includes(kind)) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
          glow.addColorStop(0, '#142136bf'); glow.addColorStop(1, '#14213600'); ctx.fillStyle = glow; ctx.fillRect(x - r, y - r, r * 2, r * 2);
          for (let i = 0; i < 3; i++) { ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(x, y, r * (.5 + i * .2), r * (.2 + i * .15), t * 2 + i, 0, TAU); ctx.stroke(); }
        } else if (['plant', 'bloom'].includes(kind)) {
          for (let i = 0; i < 5; i++) { const xx = x + (i - 2) * 12; ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(xx, y + 22); ctx.quadraticCurveTo(xx - 12, y, xx + 4, y - r * phase); ctx.stroke(); ellipse(ctx, xx - 3, y - 3, 9, 4, color); }
        } else {
          ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r * phase, 0, TAU); ctx.stroke();
          for (let i = 0; i < 5; i++) spark(ctx, x + Math.cos(i * 1.26) * r * t, y + Math.sin(i * 1.26) * r * t, 5, color);
        }
        if (Number.isFinite(e.amount) && t > .2 && (e.skillId || ['heal', 'leak'].includes(kind))) {
          ctx.textAlign = 'center'; ctx.font = '700 21px "Segoe UI", sans-serif'; ctx.lineWidth = 4;
          const text = `${['heal', 'revive'].includes(kind) ? '+' : ''}${Math.round(e.amount)}`;
          const textY = y - 35 - (reducedMotion ? 0 : t * 14);
          ctx.strokeStyle = '#0a2939'; ctx.strokeText(text, x, textY); ctx.fillStyle = '#fff3c5'; ctx.fillText(text, x, textY);
        }
      }
      ctx.restore();
    }
  }

  function draw(b, now = 0, options = {}) {
    if (!b || !ctx || destroyed) return [];
    const key = b.id ?? b;
    if (key !== battleKey) { battleKey = key; seen.clear(); animations = []; }
    if (width < 2 || height < 2) resize();
    if (!backdrop) makeBackdrop();
    const allies = b.allies || [], enemies = b.enemies || [];
    const preview = summonPreview(b, options);
    const visualOptions = options.summonCharacterId ? { ...options, selectedAllyId: '' } : options;
    unitPositions = new Map([...allies.map(u => [u, true]), ...enemies.map(u => [u, false])].map(([u, ally]) => [u.id, {
      x: finite(u.x), y: finite(u.y), h: Math.max(36, Math.min(finite(u.y) - 12, ally ? 84 : u.boss ? 89 : /armor|brute/.test(String(u.archetype || u.enemyType || '')) ? 62 : 52)), ally,
    }]));
    if (b.ship) unitPositions.set(b.ship.id || 'ship', { x: finite(b.ship.x, 940), y: finite(b.ship.y, 475), h: 95 });
    const fresh = recordEffects(b, finite(now));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#082c39'; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.translate(offsetX, offsetY); ctx.scale(scale, scale);
    ctx.beginPath(); ctx.rect(0, 0, WORLD_W, WORLD_H); ctx.clip(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.drawImage(backdrop, 0, 0, WORLD_W, WORLD_H); drawWater(now, options.reducedMotion);
    drawRange(b, options.summonCharacterId ? preview : allies.find(u => u.id === options.selectedAllyId), options); drawPads(allies, visualOptions);
    drawShip(b.ship);
    const units = [...allies.map(u => ({ u, ally: true })), ...enemies.filter(u => u.hp > 0 && !u.escaped).map(u => ({ u, ally: false }))]
      .sort((a, z) => finite(a.u.y) - finite(z.u.y));
    for (const { u, ally } of units) paintUnit(u, ally, now, visualOptions);
    paintSummonPreview(preview);
    paintProjectiles(b, options.reducedMotion);
    paintEffects(now, options.reducedMotion);
    const state = b.status || b.state || b.phase;
    const caption = { setup: 'SUMMON · POSITION · UPGRADE', running: `WAVE ${b.round} · ${enemies.filter(u => u.hp > 0 && !u.escaped).length} RAIDERS ON SHORE`, learning: 'TRAIN YOUR CREW · 3 QUESTIONS', victory: 'HARBOR SECURED', defeat: 'SHIP LOST' }[state];
    if (caption) label(caption, 720, 45, { size: 19, color: state === 'defeat' ? '#ffc2ac' : '#dce9c3' });
    ctx.restore();
    return fresh;
  }

  function pickPad(clientX, clientY) {
    if (destroyed || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    // Derive from the current box rather than a previous frame after orientation changes.
    const currentScale = Math.min(box.width / WORLD_W, box.height / WORLD_H);
    const ox = (box.width - WORLD_W * currentScale) / 2, oy = (box.height - WORLD_H * currentScale) / 2;
    const x = (clientX - box.left - ox) / currentScale, y = (clientY - box.top - oy) / currentScale;
    if (x < 0 || y < 0 || x > WORLD_W || y > WORLD_H) return null;
    const radius = Math.max(42, Math.min(62, 22 / currentScale));
    let nearest = null, distance = Infinity;
    for (const pad of DEFENSE_PADS) {
      const d = Math.hypot(x - pad.x, y - pad.y);
      if (d <= radius && d < distance) { nearest = pad.id; distance = d; }
    }
    return nearest;
  }

  return { resize, draw, pickPad, destroy() { destroyed = true; observer?.disconnect(); animations = []; seen.clear(); unitPositions.clear(); backdrop = null; } };
}
