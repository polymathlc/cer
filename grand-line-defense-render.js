import { DEFENSE_PATH, DEFENSE_PADS, DEFENSE_GRID, getDefenseAttackPreview, getDefenseProfile, getMazePlacementPreview } from './grand-line-defense.js?v=3.3.0';
import { CHARACTER_BY_ID } from './grand-line-data.js?v=3.3.0';
import { createDefenseVfxManager, getVfxSpec } from './grand-line-vfx.js?v=3.3.0';

const WORLD_W = 1120, WORLD_H = 630, TAU = Math.PI * 2;
const MAP_PALETTES = [
  ['#89956c', '#929d74', '#c2ac7c', '#66775c'], ['#65846b', '#6b8b70', '#ada375', '#426550'],
  ['#718986', '#78918c', '#b9b69b', '#4a656b'], ['#a08b65', '#a9946d', '#d3bb83', '#765f45'],
  ['#737985', '#7d828c', '#b3aaa1', '#565967'], ['#98aaa5', '#a4b5af', '#cfdfd6', '#718e92'],
  ['#897369', '#947c6e', '#c3a581', '#664d4e'], ['#687077', '#727a81', '#a89b87', '#494f5f'],
  ['#8b9288', '#989e92', '#cbd0b3', '#646f69'],
];
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
export function createDefenseRenderer(canvas, art, { vfx: suppliedVfx } = {}) {
  const ctx = canvas.getContext('2d');
  const vfx = suppliedVfx || createDefenseVfxManager();
  let width = 1, height = 1, dpr = 1, scale = 1, offsetX = 0, offsetY = 0;
  let backdrop = null, destroyed = false, battleKey, seen = new Set(), animations = [];
  let unitPositions = new Map(), floats = [], vfxStats = {}, occupiedFx = [];
  const tintCache = new Map(), tintCacheLimit = 24, imageKeys = new WeakMap(), preloadedIds = new Set();
  let nextImageKey = 0, deployedSignature = '';
  let placementCache = null, placementCacheKey = '', lastPlacementPreview = null;

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

  function makeBackdrop(b) {
    const surface = canvas.ownerDocument.createElement('canvas'); surface.width = WORLD_W * 2; surface.height = WORLD_H * 2;
    const g = surface.getContext('2d'); g.scale(2, 2); g.imageSmoothingEnabled = false;
    const stage = clamp((b.encounter?.id || 1) - 1, 0, MAP_PALETTES.length - 1), palette = MAP_PALETTES[stage];
    const { columns, rows, cellSize: cell, origin } = DEFENSE_GRID, landW = columns * cell, landH = rows * cell;
    g.fillStyle = '#163d49'; g.fillRect(0, 0, WORLD_W, WORLD_H);
    // Square, stepped coast and stone kerbs establish the pixel-grid arena.
    g.fillStyle = '#092d3b'; g.fillRect(origin.x - 14, origin.y - 7, landW + 28, landH + 26);
    g.fillStyle = '#4e746e'; g.fillRect(origin.x - 9, origin.y - 12, landW + 18, landH + 26);
    g.fillStyle = palette[3]; g.fillRect(origin.x - 5, origin.y - 5, landW + 10, landH + 10);
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const x = origin.x + column * cell, y = origin.y + row * cell, seed = hash(`${stage}:${column}:${row}`);
      g.fillStyle = palette[(row + column) % 2]; g.fillRect(x, y, cell, cell);
      g.fillStyle = '#ffffff08'; g.fillRect(x + 1, y + 1, cell - 1, 1);
      g.fillStyle = '#183b3a24'; g.fillRect(x, y + cell - 1, cell, 1); g.fillRect(x + cell - 1, y, 1, cell);
      if (seed % 6 === 0) { g.fillStyle = '#213d331b'; g.fillRect(x + 8 + seed % 9, y + 14, 3, 2); g.fillRect(x + 23, y + 26, 2, 2); }
    }
    for (const terrainId of b.terrain || []) {
      const pad = DEFENSE_PADS.find(p => p.id === (typeof terrainId === 'string' ? terrainId : terrainId.cellId || terrainId.id));
      if (!pad) continue;
      const seed = hash(pad.id + stage), x = pad.x - cell / 2, y = pad.y - cell / 2;
      g.fillStyle = palette[3]; g.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      g.fillStyle = '#123b383f'; g.fillRect(x + 8, y + 12, 26, 24);
      if (seed % 3 === 0) {
        g.fillStyle = '#344f46'; g.fillRect(x + 8, y + 6, 25, 24);
        g.fillStyle = '#728469'; g.fillRect(x + 8, y + 6, 23, 7); g.fillRect(x + 8, y + 13, 7, 14);
        g.fillStyle = '#92a37a'; g.fillRect(x + 11, y + 7, 7, 4); g.fillRect(x + 18, y + 15, 9, 3);
        g.fillStyle = '#36554a'; g.fillRect(x + 3, y + 24, 10, 5); g.fillRect(x + 29, y + 17, 7, 12);
      } else {
        g.fillStyle = '#56615c'; g.fillRect(x + 6, y + 10, 27, 23); g.fillRect(x + 11, y + 5, 17, 28);
        g.fillStyle = '#9caa93'; g.fillRect(x + 8, y + 10, 21, 8); g.fillRect(x + 13, y + 7, 13, 4);
        g.fillStyle = '#c0c7a6'; g.fillRect(x + 11, y + 11, 8, 3);
        g.fillStyle = '#707e6e'; g.fillRect(x + 7, y + 22, 17, 8);
        g.fillStyle = '#3e514b'; g.fillRect(x + 25, y + 18, 6, 13);
      }
    }
    g.font = '9px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#bed7c3';
    for (let column = 0; column < columns; column++) g.fillText(String.fromCharCode(65 + column), origin.x + column * cell + cell / 2, origin.y - 9);
    g.textAlign = 'right';
    for (let row = 0; row < rows; row++) g.fillText(String(row + 1), origin.x - 11, origin.y + row * cell + cell / 2 + 3);
    g.fillStyle = '#91b4a152'; g.fillRect(15, 15, WORLD_W - 30, 1); g.fillRect(15, WORLD_H - 14, WORLD_W - 30, 1);
    backdrop = surface;
  }

  function drawWater(now, reducedMotion) {
    if (reducedMotion) return;
    ctx.fillStyle = '#b9dec617';
    for (let i = 0; i < 14; i++) {
      const x = (i * 113 + Math.floor(now / 500) % 10) % WORLD_W, y = i % 2 ? 608 : 8;
      ctx.fillRect(x, y + i % 3 * 3, 7 + i % 11, 1);
    }
  }

  function label(text, x, y, { color = '#e9eddb', size = 19, background = '#092b36e8', pad = 8 } = {}) {
    ctx.font = `600 ${size}px "Segoe UI", sans-serif`; ctx.textAlign = 'center';
    const w = ctx.measureText(text).width;
    rounded(ctx, x - w / 2 - pad, y - size + 1, w + pad * 2, size + 9, 5, background);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  function activePlacement(b, options) {
    if (options.placementArmed === false) return null;
    const cellId = options.hoverPadId || options.selectedPadId;
    if (!cellId || b.status === 'running') return null;
    const supplied = options.placementPreview;
    const suppliedId = typeof supplied?.cell === 'string' ? supplied.cell : supplied?.cell?.id;
    if (supplied && suppliedId === cellId) return supplied;
    const mode = options.buildMode || 'crew', allyId = options.summonCharacterId ? undefined : options.selectedAllyId;
    const key = `${b.id}:${b.routeRevision}:${cellId}:${mode}:${allyId || ''}:${b.status}:${b.supplies}`;
    if (key !== placementCacheKey) {
      placementCacheKey = key;
      placementCache = getMazePlacementPreview(b, cellId, { kind: mode === 'crew' ? 'crew' : 'tower', allyId, remove: mode === 'sell' });
    }
    return placementCache;
  }

  function drawRoute(route, { preview = false, reducedMotion = false, now = 0 } = {}) {
    if (!route?.length) return;
    ctx.save();
    if (preview) {
      ctx.setLineDash([7, 7]); stroke(ctx, route, '#d9ffbf', 5); ctx.setLineDash([]);
    } else {
      stroke(ctx, route, '#244d4480', 15);
      stroke(ctx, route, '#d8d5a7a6', 10);
      stroke(ctx, route, '#edf0c557', 3);
    }
    for (let i = 1; i < route.length; i += preview ? 4 : 3) {
      const a = route[i - 1], z = route[i], dx = z.x - a.x, dy = z.y - a.y;
      if (!dx && !dy) continue;
      const t = reducedMotion || preview ? .5 : .25 + now % 1000 / 2000;
      const x = a.x + dx * t, y = a.y + dy * t;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx));
      polygon(ctx, [[-3, -3], [3, 0], [-3, 3]], preview ? '#eaffca' : '#4d6759'); ctx.restore();
    }
    ctx.restore();
  }

  function drawMazeTowers(b, options) {
    for (const tower of b.mazeTowers || []) {
      const cell = DEFENSE_PADS.find(p => p.id === (tower.cellId || tower.padId));
      const x = finite(tower.x, cell?.x), y = finite(tower.y, cell?.y), selected = (tower.cellId || tower.padId) === options.selectedPadId;
      ctx.save();
      ctx.fillStyle = '#143f385d'; ctx.fillRect(x - 11, y - 4, 25, 17);
      ctx.fillStyle = '#434b42'; ctx.fillRect(x - 11, y - 9, 22, 19);
      ctx.fillStyle = '#a6a687'; ctx.fillRect(x - 11, y - 9, 22, 5);
      ctx.fillStyle = '#657767'; ctx.fillRect(x - 9, y - 4, 18, 10);
      ctx.fillStyle = '#c7ccaa'; ctx.fillRect(x - 7, y - 10, 14, 3);
      ctx.fillStyle = '#1d4048'; ctx.fillRect(x - 7, y - 16, 14, 11);
      ctx.fillStyle = '#77b9b3'; ctx.fillRect(x - 5, y - 15, 10, 5);
      ctx.fillStyle = '#b7eee3'; ctx.fillRect(x - 2, y - 17, 4, 9);
      ctx.fillStyle = '#243b38'; ctx.fillRect(x - 12, y + 6, 4, 5); ctx.fillRect(x + 8, y + 6, 4, 5);
      if (Number.isFinite(tower.hp) && tower.hp < tower.maxHp) {
        ctx.fillStyle = '#143b36'; ctx.fillRect(x - 10, y + 12, 20, 3);
        ctx.fillStyle = '#b3d9b0'; ctx.fillRect(x - 9, y + 13, 18 * clamp(tower.hp / Math.max(1, tower.maxHp), 0, 1), 1);
      }
      if (selected) { ctx.strokeStyle = '#fff0a1'; ctx.lineWidth = 2; ctx.strokeRect(x - 17, y - 19, 34, 35); }
      ctx.restore();
    }
  }

  function drawGridSelection(b, options, preview) {
    const cellId = options.hoverPadId || options.selectedPadId, cell = DEFENSE_PADS.find(p => p.id === cellId);
    if (!cell) return;
    const half = DEFENSE_GRID.cellSize / 2, mode = options.buildMode || 'crew';
    const selectedUnit = b.allies.find(u => u.id === options.selectedAllyId);
    const occupiedBySelected = mode === 'crew' && !options.summonCharacterId && selectedUnit?.padId === cell.id;
    const valid = preview?.valid || occupiedBySelected, invalid = preview && !preview.valid && !occupiedBySelected;
    const color = invalid ? '#f2a296' : mode === 'sell' ? '#f1c990' : valid ? '#d3f6bc' : '#f2dda1';
    ctx.save(); ctx.fillStyle = invalid ? '#bf5c493a' : mode === 'sell' ? '#dbaa583b' : '#d8ec922e';
    ctx.fillRect(cell.x - half + 1, cell.y - half + 1, half * 2 - 2, half * 2 - 2);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(cell.x - half + 2, cell.y - half + 2, half * 2 - 4, half * 2 - 4);
    if (invalid) {
      ctx.beginPath(); ctx.rect(cell.x - half + 3, cell.y - half + 3, half * 2 - 6, half * 2 - 6); ctx.clip();
      ctx.strokeStyle = '#f2a29680'; ctx.lineWidth = 1;
      for (let d = -40; d < 50; d += 9) stroke(ctx, [{ x: cell.x + d, y: cell.y - half }, { x: cell.x + d + 40, y: cell.y + half }], '#f2a29680', 1);
    }
    ctx.restore();
    if (preview?.valid && preview.route) drawRoute(preview.route, { preview: true });
    if (b.status !== 'running') {
      const column = Math.round((cell.x - DEFENSE_GRID.origin.x - half) / DEFENSE_GRID.cellSize), row = Math.round((cell.y - DEFENSE_GRID.origin.y - half) / DEFENSE_GRID.cellSize);
      const address = `${String.fromCharCode(65 + column)}${row + 1}`;
      const text = invalid ? `${address} · ${String(preview.reason || 'Keep an open route').slice(0, 86)}` : `${address} · ${mode === 'tower' ? 'BUILD TOWER · 5' : mode === 'sell' ? 'SELL TOWER · +3' : options.summonCharacterId ? 'SUMMON CREW' : 'MOVE CREW HERE'}`;
      label(text, WORLD_W / 2, 602, { size: 13, color, background: '#143944ef', pad: 10 });
    }
  }

  function drawShip(ship = {}) {
    const entrance = DEFENSE_PADS.find(p => p.id === DEFENSE_GRID.entryId), exit = DEFENSE_PADS.find(p => p.id === DEFENSE_GRID.exitId);
    if (!entrance || !exit) return;
    ctx.save();
    ctx.fillStyle = '#8fc99f'; ctx.fillRect(7, entrance.y - 3, 30, 6);
    polygon(ctx, [[30, entrance.y - 8], [40, entrance.y], [30, entrance.y + 8]], '#c9eab0');
    ctx.fillStyle = '#e5c58d'; ctx.fillRect(exit.x + 19, exit.y - 3, 30, 6);
    polygon(ctx, [[exit.x + 43, exit.y - 8], [exit.x + 53, exit.y], [exit.x + 43, exit.y + 8]], '#f0dca1');
    for (const dy of [-21, 15]) {
      ctx.fillStyle = '#435958'; ctx.fillRect(exit.x + 20, exit.y + dy, 19, 10);
      ctx.fillStyle = '#bec4a3'; ctx.fillRect(exit.x + 20, exit.y + dy, 19, 3);
    }
    label('IN', 18, entrance.y - 14, { size: 10, pad: 2, color: '#ceefba', background: '#163d49' });
    label('OUT', WORLD_W - 18, exit.y - 34, { size: 10, pad: 2, color: '#f0d5a1', background: '#163d49' });
    const ratio = clamp(finite(ship.hp) / Math.max(1, finite(ship.maxHp, 1)), 0, 1);
    ctx.fillStyle = '#082e38'; ctx.fillRect(WORLD_W - 140, 587, 99, 8);
    ctx.fillStyle = ratio > .3 ? '#a8d3a4' : '#e4987c'; ctx.fillRect(WORLD_W - 138, 589, 95 * ratio, 4);
    label(`BASE ${Math.ceil(finite(ship.hp))}`, WORLD_W - 89, 612, { size: 11, background: '#163d49', color: '#e6dab6', pad: 3 });
    ctx.restore();
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
      label(`${STYLE_ICONS[shape] || '•'} ${STYLE_NAMES[shape] || 'ATTACK AREA'}`, 955, 26, { size: 11, color: '#ffebb5', background: '#163d49' });
    }
    ctx.restore();
  }

  function summonPreview(b, options) {
    const character = CHARACTER_BY_ID[options.summonCharacterId], profile = getDefenseProfile(options.summonCharacterId);
    if (!character || !profile) return null;
    const pad = DEFENSE_PADS.find(pad => pad.id === (options.hoverPadId || options.selectedPadId));
    if (!pad || !lastPlacementPreview?.valid || b.allies.some(unit => unit.padId === pad.id)) return null;
    const reserve = b.reserve?.[character.id];
    // This temporary unit is only a preview; the engine remains the owner of summons.
    return { ...character, ...reserve, id: `preview-${character.id}`, characterId: character.id, side: 'ally', x: pad.x, y: pad.y, padId: pad.id,
      profile, range: finite(reserve?.range, profile.range), hp: 1, maxHp: 1, level: reserve?.level || 1, specialization: reserve?.specialization || '', priority: reserve?.priority || 'first', statuses: [], escaped: false };
  }

  function paintSummonPreview(unit) {
    if (!unit) return;
    const asset = art?.load(unit.characterId), h = 49;
    ctx.save(); ctx.globalAlpha = .62;
    ellipse(ctx, unit.x, unit.y + 2, 14, 5, '#b8f7df8a');
    if (asset?.loaded && asset.bounds && asset.image) {
      const r = asset.bounds, width = h * r.w / r.h;
      ctx.translate(unit.x, unit.y); ctx.scale(-1, 1);
      ctx.drawImage(asset.image, r.x, r.y, r.w, r.h, -width / 2, -h, width, h);
    } else {
      ellipse(ctx, unit.x, unit.y - h * .78, 9, 10, '#cdfbe5');
      polygon(ctx, [[unit.x - 10, unit.y - h * .6], [unit.x + 10, unit.y - h * .6], [unit.x + 20, unit.y], [unit.x - 20, unit.y]], '#a9ecda');
    }
    ctx.restore();
    label('SUMMON', unit.x, Math.min(584, unit.y + 19), { size: 10, color: '#c7ffea', background: '#0a3e47ee', pad: 3 });
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
    if (selected) { ctx.strokeStyle = '#ffe2a0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y + 1, 15, 5, 0, 0, TAU); ctx.stroke(); }
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
    const ratio = clamp(finite(unit.hp) / Math.max(1, finite(unit.maxHp, 1)), 0, 1), bw = ally ? 26 : unit.boss ? 24 : 13;
    if (ally || unit.boss || ratio < .99) {
      ctx.fillStyle = '#193731'; ctx.fillRect(x - bw / 2 - 1, y + 3, bw + 2, ally ? 5 : 3);
      ctx.fillStyle = ally ? '#aadca9' : '#eeb393'; ctx.fillRect(x - bw / 2, y + 4, bw * ratio, ally ? 3 : 1);
    }
    if (unit.shield > 0) { ctx.fillStyle = '#a0e8f8'; ctx.fillRect(x - bw / 2, y + (ally ? 9 : 7), bw * clamp(unit.shield / Math.max(1, unit.maxHp), 0, 1), 1); }
    if (ally && !dead) {
      const name = shortName(unit);
      const shape = unit.profile?.skills?.[0]?.shape || 'single';
      const badgeY = Math.max(14, y - h + 8);
      label(`${unit.level || 1}`, x + 13, badgeY, { size: 9, pad: 3, color: '#ffe6a2', background: '#082e3fdd' });
      if (selected) label(`${STYLE_ICONS[shape] || '•'} ${name.length > 17 ? name.slice(0, 16) + '…' : name}`, x, Math.min(583, y + 23), {
        size: 11, pad: 4, color: '#ffe4a0',
      });
    }
    if (!ally && unit.boss && !dead) label('CAPTAIN', x, Math.max(18, y - h - 4), { size: 8, pad: 3, color: '#ffe1a2', background: '#5b353cde' });
    if (selected) {
      polygon(ctx, [[x - 4, y - h - 9], [x + 4, y - h - 9], [x, y - h - 3]], '#ffe6a5');
    }
    const status = unit.statuses?.find(s => ['freeze', 'stun', 'burn', 'poison', 'slow'].includes(s.type));
    if (status && !dead) {
      const symbol = { freeze: 'Ⅱ', stun: '!', burn: '♨', poison: '●', slow: '↓' }[status.type];
      const color = { freeze: '#b8e6ef', stun: '#f3dfa0', burn: '#f0a27e', poison: '#c1a0d7', slow: '#adcdde' }[status.type];
      rounded(ctx, x + 6, y - h + 3, 10, 10, 2, '#123440ec');
      ctx.fillStyle = color; ctx.font = '600 8px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(symbol, x + 11, y - h + 11);
    }
  }

  function resetVfxFrame(options) {
    const compact = scale < .6;
    vfxStats = { sprites: 0, projectiles: 0, impacts: 0, supports: 0, damageLabels: 0, fallbacks: 0, droppedSprites: 0, tintedSprites: 0,
      rangeVisible: false, reducedMotion: !!options.reducedMotion,
      budget: { projectiles: compact ? 8 : 10, impacts: compact ? 3 : 4, supports: compact ? 1 : 2, damageLabels: compact ? 2 : 3, totalSprites: compact ? 12 : 16 } };
    occupiedFx = [];
  }

  function tintedFrame(sprite) {
    if (!sprite.tint || sprite.premium) return null;
    if (!imageKeys.has(sprite.image)) imageKeys.set(sprite.image, ++nextImageKey);
    const key = `${imageKeys.get(sprite.image)}:${sprite.sx}:${sprite.sy}:${sprite.sw}:${sprite.sh}:${sprite.tint}`;
    if (tintCache.has(key)) {
      const cached = tintCache.get(key); tintCache.delete(key); tintCache.set(key, cached); return cached;
    }
    const surface = canvas.ownerDocument.createElement('canvas'), size = 160;
    const ratio = sprite.sw / sprite.sh;
    surface.width = Math.max(1, Math.round(size * Math.min(1, ratio)));
    surface.height = Math.max(1, Math.round(size / Math.max(1, ratio)));
    const g = surface.getContext('2d');
    g.drawImage(sprite.image, sprite.sx, sprite.sy, sprite.sw, sprite.sh, 0, 0, surface.width, surface.height);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = sprite.tint; g.fillRect(0, 0, surface.width, surface.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(sprite.image, sprite.sx, sprite.sy, sprite.sw, sprite.sh, 0, 0, surface.width, surface.height);
    tintCache.set(key, surface);
    while (tintCache.size > tintCacheLimit) tintCache.delete(tintCache.keys().next().value);
    return surface;
  }

  function admitVfx(type, x, y) {
    const count = vfxStats.projectiles + vfxStats.impacts + vfxStats.supports;
    // A dense formation needs visible enemies between attacks, even with ten towers.
    if (vfxStats[type] >= vfxStats.budget[type] || count >= vfxStats.budget.totalSprites || occupiedFx.filter(p => Math.hypot(p.x - x, p.y - y) < 55).length >= 2) {
      vfxStats.droppedSprites++; return false;
    }
    occupiedFx.push({ x, y }); vfxStats[type]++; return true;
  }

  function drawSprite(characterId, skillId, kind, phase, placement, type) {
    const sprite = vfx.sprite(characterId, skillId, kind, phase);
    if (!admitVfx(type, placement.x, placement.y)) return false;
    ctx.save(); ctx.translate(placement.x, placement.y); ctx.rotate(placement.angle || 0);
    ctx.globalAlpha = placement.alpha ?? 1;
    if (sprite?.image && sprite.sw > 0 && sprite.sh > 0) {
      // Crop exactly one cell. Transparent gutters remain transparent, without
      // stretching the atlas or drawing any neighbouring animation frames.
      const ratio = sprite.sw / sprite.sh, long = Math.max(1, ratio);
      const w = placement.size * .65 * ratio / long, h = placement.size * .65 / long * (placement.flatten || 1);
      const tinted = tintedFrame(sprite);
      if (tinted) { ctx.drawImage(tinted, -w / 2, -h / 2, w, h); vfxStats.tintedSprites++; }
      else ctx.drawImage(sprite.image, sprite.sx, sprite.sy, sprite.sw, sprite.sh, -w / 2, -h / 2, w, h);
      vfxStats.sprites++;
    } else {
      // Asset loading and offline failures get one quiet marker, never the old
      // beams, polygons, shield clouds, or piles of particles.
      const color = CHARACTER_BY_ID[characterId]?.color || '#e0d5b4';
      if (type === 'supports') { stroke(ctx, [{ x: -4, y: 0 }, { x: 4, y: 0 }], color, 2); stroke(ctx, [{ x: 0, y: -4 }, { x: 0, y: 4 }], color, 2); }
      else ellipse(ctx, 0, 0, type === 'impacts' ? 5 : 3, type === 'impacts' ? 5 : 3, color);
      vfxStats.fallbacks++;
    }
    ctx.restore(); return true;
  }

  function attackPriority(p, selectedId) {
    const character = CHARACTER_BY_ID[p.characterId], skillIndex = Number(String(p.skillId || '').split('-').at(-1)) || 0;
    return (character?.stars || 1) * 3 + skillIndex * 8 + (p.sourceId === selectedId ? 6 : 0) + (p.sourceId?.startsWith('ally-') ? 8 : 0);
  }

  function paintProjectiles(b, options, groundLayer = false) {
    if (b.status !== 'running') return;
    const projectiles = (b.projectiles || []).filter(p => p.start && p.end).slice().sort((a, z) => attackPriority(z, options.selectedAllyId) - attackPriority(a, options.selectedAllyId));
    for (const p of projectiles) {
      const progress = clamp(p.age / Math.max(.01, p.duration), 0, 1), spec = getVfxSpec(p.characterId, p.skillId, p.kind);
      const skillIndex = Number(String(p.skillId || '').split('-').at(-1)) || 0;
      const burst = ['single', 'splash', 'chain'].includes(p.shape), ground = ['earth', 'quake', 'plant', 'gravity'].includes(p.kind);
      if ((ground || p.shape === 'radial') !== groundLayer) continue;
      if (p.mazeTower) {
        const x = finite(p.x, p.end.x), y = finite(p.y, p.end.y) - 7;
        if (admitVfx('projectiles', x, y)) {
          ctx.save(); ctx.fillStyle = '#a7e5d6'; ctx.fillRect(x - 2, y - 1, 4, 2); ctx.restore();
        }
        continue;
      }
      let size = spec?.premium ? [72, 110, 142][skillIndex] : [47, 64, 80][skillIndex];
      let x = finite(p.x, p.end.x), y = finite(p.y, p.end.y) - (ground ? 5 : 14);
      let angle = Math.atan2(p.end.y - p.start.y, p.end.x - p.start.x), flatten = 1;
      if (p.shape === 'radial') {
        x = p.start.x; y = p.start.y - (ground ? 0 : 12); angle = 0;
        size = clamp(Math.min(p.range, p.radius) * (1 + progress * .45), 80, spec?.premium ? 205 : 150); flatten = ground ? .7 : 1;
      } else if (p.shape === 'cone') {
        size = clamp(size * 1.12, 58, 168);
      } else if (p.shape === 'line') {
        size = Math.max(size, clamp(finite(p.width, 25) * 1.08, 45, 140));
      }
      if (burst) size *= .77;
      const phase = options.reducedMotion ? .35 : progress * (['splash', 'chain'].includes(p.shape) ? .49 : .95);
      drawSprite(p.characterId, p.skillId, p.kind, phase,
        { x, y, size, angle, flatten, alpha: options.reducedMotion ? .7 : p.shape === 'radial' ? .78 : .94 }, 'projectiles');
    }
  }

  function recordEffects(b, now, options) {
    const fresh = [];
    for (const event of b.effects || []) {
      if (seen.has(event.id)) continue;
      seen.add(event.id); fresh.push(event);
      const source = event.origin || event.source || unitPositions.get(event.sourceId);
      const targets = event.targets?.length ? event.targets : (event.targetIds || []).map(id => unitPositions.get(id)).filter(Boolean);
      const characterId = event.characterId || unitPositions.get(event.sourceId)?.characterId;
      if (event.projectileId || event.kind === 'projectile-launch') continue;
      const start = now - finite(event.age) * 1000;
      if (event.kind === 'damage' && event.amount > 0) {
        const target = targets[0]; if (!target) continue;
        const important = event.sourceId === options.selectedAllyId || (event.targetIds || []).some(id => unitPositions.get(id)?.boss);
        const key = `${event.sourceId}:${Math.floor(start / 220)}`;
        const existing = floats.find(item => item.key === key);
        if (existing) {
          existing.x = (existing.x * existing.count + target.x) / (existing.count + 1);
          existing.y = (existing.y * existing.count + target.y) / (existing.count + 1);
          existing.amount += event.amount; existing.count++; existing.important ||= important;
        } else floats.push({ key, start, duration: 630, amount: event.amount, count: 1, x: target.x, y: target.y, important });
        continue;
      }
      if (event.kind === 'leak') {
        floats.push({ key: event.id, start, duration: 850, amount: -Math.abs(event.amount || 0), count: 1, x: b.ship?.x || 940, y: b.ship?.y || 485, important: true, ship: true });
        continue;
      }
      // Only the cast event owns an animation. Shield/heal ticks, status events,
      // critical procs and each casualty update the unit UI without extra art.
      if (event.kind === 'impact') {
        if (!['splash', 'chain'].includes(event.shape)) continue;
        const center = event.center || event.end || targets[0] || source; if (!center) continue;
        const duplicate = animations.some(a => a.type === 'impacts' && a.sourceId === event.sourceId && a.skillId === event.skillId && Math.abs(start - a.start) < 180);
        if (duplicate) continue;
        animations.push({ type: 'impacts', sourceId: event.sourceId, characterId, skillId: event.skillId, kind: event.attackKind || event.kind,
          shape: event.shape, radius: event.geometry?.radius || 60, center: { ...center }, start, duration: 380, source: source ? { ...source } : null });
      } else if (event.skillId && characterId) {
        const character = CHARACTER_BY_ID[characterId], skill = character?.skills.find(skill => skill.id === event.skillId);
        if (!skill || !['self', 'ally', 'all-allies', 'fallen-ally'].includes(skill.target)) continue;
        const center = targets[0] || source; if (!center) continue;
        animations.push({ type: 'supports', sourceId: event.sourceId, characterId, skillId: event.skillId, kind: event.kind,
          center: { ...center }, start, duration: 620, source: source ? { ...source } : null });
      }
    }
    if (seen.size > 1600) seen = new Set([...seen].slice(-800));
    animations = animations.filter(a => now - a.start < a.duration).slice(-24);
    floats = floats.filter(a => now - a.start < a.duration).slice(-20);
    return fresh;
  }

  function paintEffects(now, options, groundLayer = false) {
    const ordered = animations.slice().sort((a, z) => attackPriority(z, options.selectedAllyId) - attackPriority(a, options.selectedAllyId));
    for (const a of ordered) {
      const ground = a.type !== 'supports' && ['earth', 'quake', 'plant', 'gravity'].includes(a.kind);
      if (ground !== groundLayer) continue;
      const t = clamp((now - a.start) / a.duration, 0, 1), spec = getVfxSpec(a.characterId, a.skillId, a.kind);
      const skillIndex = Number(String(a.skillId || '').split('-').at(-1)) || 0;
      const support = a.type === 'supports';
      const size = support ? spec?.premium ? 112 : 65 : clamp(a.radius * (spec?.premium ? 1.35 : 1), 50, spec?.premium ? 175 : 120);
      const phase = options.reducedMotion ? .7 : support ? t : .5 + t * .49;
      drawSprite(a.characterId, a.skillId, a.kind, phase,
        { x: a.center.x, y: a.center.y - (support ? 24 : 8), size: size * (skillIndex === 0 ? .86 : 1), angle: 0,
          alpha: (options.reducedMotion ? .6 : .84) * Math.min(1, (1 - t) * 3) }, a.type);
    }
    if (groundLayer) return;
    const labels = floats.filter(a => a.important || a.count >= 3).sort((a, z) => Number(z.important) - Number(a.important) || z.amount - a.amount);
    const occupied = [];
    for (const item of labels) {
      if (vfxStats.damageLabels >= vfxStats.budget.damageLabels) break;
      if (occupied.some(p => Math.hypot(p.x - item.x, p.y - item.y) < 75)) continue;
      occupied.push(item); vfxStats.damageLabels++;
      const t = clamp((now - item.start) / item.duration, 0, 1), y = item.y - 31 - (options.reducedMotion ? 0 : t * 8);
      const text = `${Math.round(item.amount)}${item.count > 1 ? ` · ${item.count} hits` : ''}`;
      ctx.save(); ctx.globalAlpha = Math.min(1, (1 - t) * 3); ctx.font = '600 11px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = '#12313fe8'; ctx.strokeText(text, item.x, y);
      ctx.fillStyle = item.ship ? '#f8b294' : '#f8e9b9'; ctx.fillText(text, item.x, y); ctx.restore();
    }
  }

  function draw(b, now = 0, options = {}) {
    if (!b || !ctx || destroyed) return [];
    const key = b.id ?? b;
    if (key !== battleKey) {
      battleKey = key; seen.clear(); animations = []; floats = [];
      deployedSignature = ''; backdrop = null; placementCacheKey = ''; placementCache = null;
    }
    if (width < 2 || height < 2) resize();
    if (!backdrop) makeBackdrop(b);
    const allies = b.allies || [], enemies = b.enemies || [];
    const deployed = [...new Set(allies.map(unit => unit.characterId))].sort(), signature = deployed.join('|');
    if (signature !== deployedSignature) {
      deployedSignature = signature;
      const freshIds = deployed.filter(id => !preloadedIds.has(id));
      if (freshIds.length) { freshIds.forEach(id => preloadedIds.add(id)); vfx.preload?.(freshIds)?.catch?.(() => {}); }
    }
    lastPlacementPreview = activePlacement(b, options);
    const preview = summonPreview(b, options);
    const visualOptions = options.summonCharacterId ? { ...options, selectedAllyId: '' } : options;
    resetVfxFrame(options);
    unitPositions = new Map([...allies.map(u => [u, true]), ...enemies.map(u => [u, false])].map(([u, ally]) => [u.id, {
      x: finite(u.x), y: finite(u.y), h: ally ? 49 : u.boss ? 32 : /armor|brute/.test(String(u.archetype || u.enemyType || '')) ? 26 : 22, ally, characterId: u.characterId, boss: !!u.boss,
    }]));
    if (b.ship) unitPositions.set(b.ship.id || 'ship', { x: finite(b.ship.x, 940), y: finite(b.ship.y, 475), h: 95 });
    const fresh = recordEffects(b, finite(now), options);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#082c39'; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.translate(offsetX, offsetY); ctx.scale(scale, scale);
    ctx.beginPath(); ctx.rect(0, 0, WORLD_W, WORLD_H); ctx.clip(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.drawImage(backdrop, 0, 0, WORLD_W, WORLD_H); drawWater(now, options.reducedMotion);
    drawRoute(b.route || DEFENSE_PATH, { now, reducedMotion: options.reducedMotion });
    const rangeUnit = options.summonCharacterId ? preview : allies.find(u => u.id === options.selectedAllyId);
    const crewMode = !['tower', 'sell'].includes(options.buildMode);
    if ((crewMode || options.showAttackArea === true || options.previewSkillId) && (b.status !== 'running' || options.showAttackArea === true || options.previewSkillId)) {
      vfxStats.rangeVisible = !!rangeUnit;
      drawRange(b, rangeUnit, options);
    }
    drawGridSelection(b, visualOptions, lastPlacementPreview);
    drawMazeTowers(b, visualOptions);
    drawShip(b.ship);
    paintProjectiles(b, options, true);
    paintEffects(now, options, true);
    const units = [...allies.map(u => ({ u, ally: true })), ...enemies.filter(u => u.hp > 0 && !u.escaped).map(u => ({ u, ally: false }))]
      .sort((a, z) => finite(a.u.y) - finite(z.u.y));
    for (const { u, ally } of units) paintUnit(u, ally, now, visualOptions);
    paintSummonPreview(preview);
    paintProjectiles(b, options);
    paintEffects(now, options);
    const state = b.status || b.state || b.phase;
    const caption = { setup: 'BUILD A MAZE · KEEP AN OPEN ROUTE', running: `WAVE ${b.round} · ${enemies.filter(u => u.hp > 0 && !u.escaped).length} RAIDERS`, learning: 'TRAIN YOUR CREW · 3 QUESTIONS', victory: 'DEFENSE SECURED', defeat: 'BASE LOST' }[state];
    if (caption) label(caption, 490, 26, { size: 13, background: '#163d49', color: state === 'defeat' ? '#ffc2ac' : '#dce9c3' });
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
    const { origin, cellSize, columns, rows } = DEFENSE_GRID;
    if (x < origin.x || y < origin.y || x >= origin.x + columns * cellSize || y >= origin.y + rows * cellSize) return null;
    return `cell-${Math.floor((x - origin.x) / cellSize)}-${Math.floor((y - origin.y) / cellSize)}`;
  }

  function pickDefender(clientX, clientY, battle) {
    if (destroyed || !battle?.allies?.length) return null;
    const box = canvas.getBoundingClientRect(), s = Math.min(box.width / WORLD_W, box.height / WORLD_H);
    if (!s || clientX < box.left || clientX >= box.right || clientY < box.top || clientY >= box.bottom) return null;
    const x = (clientX - box.left - (box.width - WORLD_W * s) / 2) / s;
    const y = (clientY - box.top - (box.height - WORLD_H * s) / 2) / s;
    // Match the rendered avatar, including its body above the cell anchor.
    for (const unit of [...battle.allies].sort((a, b) => b.y - a.y)) {
      const bounds = art?.load(unit.characterId)?.bounds, width = bounds?.h ? 49 * bounds.w / bounds.h : 30;
      if (Math.abs(x - unit.x) <= Math.max(15, width / 2) && y >= unit.y - 49 && y <= unit.y + 8) return unit.id;
    }
    return null;
  }

  return { resize, draw, pickPad, pickDefender, getVfxStats() { return { ...vfxStats, tintCacheEntries: tintCache.size, tintCacheLimit, budget: { ...vfxStats.budget } }; },
    destroy() { destroyed = true; observer?.disconnect(); animations = []; floats = []; seen.clear(); unitPositions.clear(); tintCache.clear(); preloadedIds.clear(); placementCache = null; lastPlacementPreview = null; backdrop = null; if (!suppliedVfx) vfx.destroy(); } };
}
