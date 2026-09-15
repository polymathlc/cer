export const DEFENSE_GRID = Object.freeze({ columns: 26, rows: 13, cellSize: 40,
  origin: Object.freeze({ x: 40, y: 50 }), width: 1120, height: 630,
  entryId: 'cell-0-6', exitId: 'cell-25-6' });
export const DEFENSE_PADS = Object.freeze(Array.from({ length: 26 * 13 }, (_, index) => {
  const col = index % 26, row = Math.floor(index / 26);
  return Object.freeze({ id: `cell-${col}-${row}`, col, row, x: 60 + col * 40, y: 70 + row * 40,
    name: `${String.fromCharCode(65 + col)}${row + 1}` });
}));
const cells = new Map(DEFENSE_PADS.map(cell => [cell.id, cell]));
export const DEFENSE_DEFAULT_PADS = Object.freeze([
  [2, 5], [6, 7], [10, 5], [14, 7], [18, 5], [4, 9], [10, 3], [16, 9], [20, 3], [23, 5],
].map(([col, row]) => cells.get(`cell-${col}-${row}`)));
export const DEFENSE_PATH = Object.freeze([{ x: 20, y: 310 }, ...Array.from({ length: 26 }, (_, col) => ({ x: 60 + col * 40, y: 310 })), { x: 1100, y: 310 }].map(Object.freeze));
export const MAZE_TOWER_COST = 5;
export const MAZE_TOWER_REFUND = 3;
export const MAX_MAZE_TOWERS = 80;
export const defenseCell = id => cells.get(id) || null;

function terrainFor(stage) {
  const blocked = new Set(), defaults = new Set(DEFENSE_DEFAULT_PADS.map(cell => cell.id));
  const add = (col, row) => {
    const id = `cell-${col}-${row}`;
    if (cells.has(id) && !defaults.has(id) && id !== DEFENSE_GRID.entryId && id !== DEFENSE_GRID.exitId) blocked.add(id);
  };
  const wall = (col, gaps) => { for (let row = 0; row < 13; row++) if (!gaps.includes(row)) add(col, row); };
  const rock = (col, row) => { add(col, row); add(col + 1, row); add(col, row + 1); };
  switch (stage) {
    case 1: rock(5, 1); rock(15, 10); rock(22, 1); break;
    case 2: wall(7, [2, 3]); rock(17, 9); rock(21, 2); break;
    case 3: wall(9, [9, 10]); wall(19, [2, 3]); break;
    case 4: wall(7, [3, 4]); wall(17, [8, 9]); rock(22, 1); break;
    case 5: wall(8, [9, 10]); wall(18, [3, 4]); rock(13, 10); break;
    case 6: wall(7, [1, 2]); wall(17, [10, 11]); rock(12, 4); break;
    case 7: wall(5, [8, 9]); wall(13, [2, 3]); wall(21, [8, 9]); break;
    case 8: wall(7, [3, 4]); wall(15, [9, 10]); wall(21, [2, 3]); break;
    case 9: wall(7, [1, 2]); wall(13, [10, 11]); wall(19, [3, 4]); break;
  }
  return Object.freeze([...blocked].sort());
}
export const DEFENSE_TERRAIN = Object.freeze(Array.from({ length: 9 }, (_, index) => terrainFor(index + 1)));

// Fixed orthogonal neighbour order makes every route deterministic. No diagonal
// links exist, so even a one-cell-wide maze cannot cut through blocked corners.
export function findDefenseGridRoute(blockedIds) {
  const blocked = blockedIds instanceof Set ? blockedIds : new Set(blockedIds || []);
  const { entryId, exitId } = DEFENSE_GRID;
  if (blocked.has(entryId) || blocked.has(exitId)) return null;
  const queue = [entryId], parent = new Map([[entryId, null]]);
  for (let next = 0; next < queue.length; next++) {
    const id = queue[next];
    if (id === exitId) break;
    const cell = cells.get(id);
    for (const [dc, dr] of [[1, 0], [0, -1], [0, 1], [-1, 0]]) {
      const adjacent = `cell-${cell.col + dc}-${cell.row + dr}`;
      if (!cells.has(adjacent) || blocked.has(adjacent) || parent.has(adjacent)) continue;
      parent.set(adjacent, id); queue.push(adjacent);
    }
  }
  if (!parent.has(exitId)) return null;
  const cellIds = [];
  for (let id = exitId; id !== null; id = parent.get(id)) cellIds.push(id);
  cellIds.reverse();
  return { cellIds, points: [{ x: 20, y: 310 }, ...cellIds.map(id => ({ x: cells.get(id).x, y: cells.get(id).y })), { x: 1100, y: 310 }] };
}
export function defenseRouteMetrics(points) {
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) cumulative.push(cumulative.at(-1) + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  return { cumulative, length: cumulative.at(-1) || 0 };
}
const defaultMetrics = defenseRouteMetrics(DEFENSE_PATH);
export function pointOnDefenseRoute(progress, battle) {
  const route = battle?.route || DEFENSE_PATH, metrics = battle?.routeMetrics || defaultMetrics;
  const travelled = Math.max(0, Math.min(1, Number(progress) || 0)) * metrics.length;
  let low = 1, high = route.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (metrics.cumulative[middle] < travelled) low = middle + 1;
    else high = middle;
  }
  const before = route[low - 1], after = route[low], length = metrics.cumulative[low] - metrics.cumulative[low - 1];
  const t = length ? (travelled - metrics.cumulative[low - 1]) / length : 0;
  return { x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t };
}

function blockedFor(b, proposal) {
  const blocked = new Set(b.terrain || []);
  for (const unit of b.allies || []) if (unit.id !== proposal?.allyId && unit.padId) blocked.add(unit.padId);
  for (const tower of b.mazeTowers || []) if (!(proposal?.remove && tower.cellId === proposal.cellId)) blocked.add(tower.cellId);
  if (proposal?.cellId && !proposal.remove) blocked.add(proposal.cellId);
  return blocked;
}
const previewCaches = new WeakMap();
export function planDefenseRoute(b, proposal) {
  if (!b) return null;
  const blocked = blockedFor(b, proposal), key = [...blocked].sort().join('|');
  let cache = previewCaches.get(b);
  if (!cache) { cache = new Map(); previewCaches.set(b, cache); }
  if (cache.has(key)) return cache.get(key);
  const route = findDefenseGridRoute(blocked);
  // The cache is independent of the battle save. Pointer previews stay pure
  // and bounded while repeated draws can reuse the same proposal immediately.
  if (cache.size >= 360) cache.delete(cache.keys().next().value);
  cache.set(key, route); return route;
}
export function commitDefenseRoute(b) {
  const route = planDefenseRoute(b);
  if (!route) return false;
  b.route = route.points; b.routeCellIds = route.cellIds;
  b.routeMetrics = defenseRouteMetrics(route.points); b.routeLength = b.routeMetrics.length;
  b.routeRevision = (b.routeRevision || 0) + 1;
  return true;
}
export function getDefenseRoute(b, proposal) {
  if (!proposal && b?.route) return b.route;
  return planDefenseRoute(b, proposal)?.points || null;
}
export function getMazePlacementPreview(b, cellId, options = {}) {
  const cell = defenseCell(cellId), kind = options.kind || 'tower', remove = !!options.remove;
  const cost = remove ? -MAZE_TOWER_REFUND : kind === 'tower' ? MAZE_TOWER_COST : 0;
  const result = { valid: false, reason: '', cell, cellId, cost, route: b?.route || null, kind, remove };
  const invalid = reason => ({ ...result, reason });
  if (!b || b.status !== 'setup' || b.pendingOutcome) return invalid('Build and move between waves.');
  if (!cell || [DEFENSE_GRID.entryId, DEFENSE_GRID.exitId].includes(cellId)) return invalid('Keep the entrance and exit open.');
  if (!['tower', 'crew'].includes(kind)) return invalid('Choose a tower or a crew member.');
  if ((b.terrain || []).includes(cellId)) return invalid('This cell contains fixed terrain.');
  const tower = (b.mazeTowers || []).find(entry => entry.cellId === cellId);
  const movingId = kind === 'crew' && !remove ? options.allyId : null;
  const moving = movingId ? b.allies.find(unit => unit.id === movingId) : null;
  if (movingId && !moving) return invalid('Choose a deployed crew member.');
  const occupied = b.allies.find(unit => unit.padId === cellId && unit !== moving);
  if (remove) {
    if (!tower) return invalid('Choose a basic tower to sell.');
  } else {
    if (tower) return invalid('A basic tower already occupies this cell.');
    if (occupied && !(kind === 'crew' && moving)) return invalid('A crew member occupies this cell.');
    if (kind === 'tower' && (b.mazeTowers || []).length >= MAX_MAZE_TOWERS) return invalid('The maze already has 80 basic towers.');
    if (kind === 'tower' && b.supplies < MAZE_TOWER_COST) return invalid('A basic tower costs 5 supplies.');
  }
  // Swapping two crew members does not change the set of blocked cells.
  const plan = occupied && moving ? planDefenseRoute(b) : planDefenseRoute(b, { cellId, allyId: moving?.id, remove });
  if (!plan) return invalid('Leave at least one complete route to the exit.');
  return { ...result, valid: true, reason: remove ? 'Selling opens this cell and returns 3 supplies.' : 'A complete route remains open.', route: plan.points };
}
