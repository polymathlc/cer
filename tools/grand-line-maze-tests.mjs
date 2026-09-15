import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const replaceImport = (source, name, url) => source.replace(new RegExp(`(['"])\\./${name}\\.js(?:\\?v=[^'"]+)?\\1`, 'g'), JSON.stringify(url));
const dataUrl = moduleUrl(await readFile(new URL('../grand-line-data.js', import.meta.url), 'utf8'));
const coreUrl = moduleUrl(replaceImport(await readFile(new URL('../grand-line-core.js', import.meta.url), 'utf8'), 'grand-line-data', dataUrl));
const gridUrl = moduleUrl(await readFile(new URL('../grand-line-defense-grid.js', import.meta.url), 'utf8'));
const profilesUrl = moduleUrl(await readFile(new URL('../grand-line-defense-profiles.js', import.meta.url), 'utf8'));
let source = await readFile(new URL('../grand-line-defense.js', import.meta.url), 'utf8');
for (const [name, url] of [['grand-line-data', dataUrl], ['grand-line-core', coreUrl], ['grand-line-defense-grid', gridUrl], ['grand-line-defense-profiles', profilesUrl]]) source = replaceImport(source, name, url);
const { createCollection, addCard } = await import(coreUrl);
const { CHARACTERS, DEFENSE_GRID, DEFENSE_PADS, DEFENSE_DEFAULT_PADS, DEFENSE_TERRAIN, MAZE_TOWER_COST, MAZE_TOWER_REFUND,
  MAX_MAZE_TOWERS, createDefense, startDefenseWave, advanceDefense, completeDefenseLearning, getDefenseRoute,
  getMazePlacementPreview, buildMazeTower, sellMazeTower, placeDefender, summonDefender, recallDefender,
  defensePointAt, defenseEnemyPointAt, getDefenseWavePreview } = await import(moduleUrl(source));
const { findDefenseGridRoute, defenseCell } = await import(gridUrl);
const step = (b, seconds) => { for (let n = 0; n < Math.round(seconds / .05); n++) advanceDefense(b, .05); };
const battle = (stage = 1) => { const c = createCollection(); c.unlockedEncounter = 9; return createDefense(c, { encounter: stage, seed: 7 }); };
const blocked = b => new Set([...b.terrain, ...b.allies.map(u => u.padId), ...b.mazeTowers.map(t => t.cellId)]);
function assertRoute(b) {
  const closed = blocked(b);
  assert.equal(b.routeCellIds[0], DEFENSE_GRID.entryId); assert.equal(b.routeCellIds.at(-1), DEFENSE_GRID.exitId);
  assert.equal(new Set(b.routeCellIds).size, b.routeCellIds.length);
  for (let n = 0; n < b.routeCellIds.length; n++) {
    const cell = defenseCell(b.routeCellIds[n]); assert.ok(cell); assert.equal(closed.has(cell.id), false, cell.id);
    if (n) { const previous = defenseCell(b.routeCellIds[n - 1]); assert.equal(Math.abs(cell.col - previous.col) + Math.abs(cell.row - previous.row), 1); }
  }
  assert.equal(b.routeLength, (b.route.length - 1) * 40);
  assert.deepEqual(getDefenseRoute(b), b.route);
}

test('the landscape grid contains 338 square cells and every harbor has distinct sparse terrain with an orthogonal exit route', () => {
  assert.deepEqual([DEFENSE_GRID.width, DEFENSE_GRID.height, DEFENSE_GRID.columns, DEFENSE_GRID.rows, DEFENSE_GRID.cellSize], [1120, 630, 26, 13, 40]);
  assert.equal(DEFENSE_PADS.length, 338); assert.equal(DEFENSE_DEFAULT_PADS.length, 10);
  assert.equal(new Set(DEFENSE_PADS.map(c => c.id)).size, 338);
  assert.equal(new Set(DEFENSE_TERRAIN.map(t => t.join('|'))).size, 9);
  for (let stage = 1; stage <= 9; stage++) {
    const b = battle(stage); assert.ok(b); assert.ok(b.terrain.length > 0 && b.terrain.length < 50); assertRoute(b);
    assert.deepEqual(b.route[0], { x: 20, y: 310 }); assert.deepEqual(b.route.at(-1), { x: 1100, y: 310 });
    for (const cell of DEFENSE_PADS) assert.deepEqual({ x: cell.x, y: cell.y }, { x: 60 + cell.col * 40, y: 70 + cell.row * 40 });
  }
});

test('one through ten unique owned crew members deploy for free and all nine terrain layouts remain passable', () => {
  const c = createCollection(); c.unlockedEncounter = 9;
  for (const character of CHARACTERS.slice(0, 11)) if (!c.cards[character.id]) addCard(c, character.id);
  for (let size = 1; size <= 10; size++) for (let stage = 1; stage <= 9; stage++) {
    c.team = CHARACTERS.slice(0, size).map(character => character.id);
    const b = createDefense(c, { encounter: stage }); assert.ok(b); assert.equal(b.allies.length, size);
    assert.ok(b.allies.every(u => u.paidSupplies === 0)); assert.equal(b.supplies, 100); assertRoute(b);
  }
  for (const team of [[], CHARACTERS.slice(0, 11).map(c => c.id), ['luffy', 'luffy'], ['shanks']]) assert.equal(createDefense({ ...c, team }), null);
});

test('placement previews are pure, reject fixed terrain and portals, and show the exact committed detour and sale refund', () => {
  const b = battle(), before = JSON.stringify(b), revision = b.routeRevision;
  for (const id of [DEFENSE_GRID.entryId, DEFENSE_GRID.exitId, b.terrain[0], 'cell-26-6', '__proto__', b.allies[0].padId]) {
    const preview = getMazePlacementPreview(b, id); assert.equal(preview.valid, false); assert.ok(preview.reason);
  }
  assert.equal(getMazePlacementPreview(b, b.allies[0].padId, { kind: 'tower', allyId: b.allies[0].id }).valid, false,
    'A selected hero never disappears from the blockers while previewing a basic tower');
  const preview = getMazePlacementPreview(b, 'cell-3-6'); assert.equal(preview.valid, true); assert.equal(preview.cost, 5);
  assert.ok(preview.route.length > b.route.length); assert.equal(JSON.stringify(b), before); assert.equal(b.routeRevision, revision);
  assert.equal(buildMazeTower(b, 'cell-3-6'), true); assert.deepEqual(b.route, preview.route); assertRoute(b);
  assert.equal(getMazePlacementPreview(b, 'cell-3-6').valid, false);
  const sale = getMazePlacementPreview(b, 'cell-3-6', { remove: true }); assert.equal(sale.valid, true); assert.equal(sale.cost, -3);
  assert.equal(sellMazeTower(b, 'cell-3-6'), true); assert.deepEqual(b.route, sale.route); assert.equal(b.supplies, 98);
  assert.equal(sellMazeTower(b, 'cell-3-6'), false); assert.equal(b.supplies, 98);
});

test('the last opening in a wall cannot be sealed by a tower, a moved hero or a newly summoned card', () => {
  const b = battle(); addCard(b.collection, 'kaido'); b.supplies = 200;
  for (let row = 0; row < 13; row++) if (row !== 6) assert.equal(buildMazeTower(b, `cell-1-${row}`), true);
  const before = JSON.stringify(b), route = b.route, funds = b.supplies;
  for (let n = 0; n < 2; n++) {
    assert.equal(getMazePlacementPreview(b, 'cell-1-6').valid, false);
    assert.equal(buildMazeTower(b, 'cell-1-6'), false);
    assert.equal(placeDefender(b, b.allies[0].id, 'cell-1-6'), false);
    assert.equal(summonDefender(b, 'kaido', 'cell-1-6'), false);
  }
  assert.equal(b.supplies, funds); assert.equal(b.route, route); assert.equal(JSON.stringify(b), before); assertRoute(b);
  assert.equal(sellMazeTower(b, 'cell-1-0'), true); assert.equal(buildMazeTower(b, 'cell-1-6'), true); assertRoute(b);
  assert.equal(findDefenseGridRoute(new Set(Array.from({ length: 13 }, (_, row) => `cell-1-${row}`))), null);
});

test('moving, swapping and recalling a crew member rebuild the same route cache as tower changes', () => {
  const b = battle(), [first, second] = b.allies, original = first.padId, oldRoute = b.routeLength;
  const preview = getMazePlacementPreview(b, 'cell-3-6', { kind: 'crew', allyId: first.id });
  assert.equal(preview.valid, true); assert.equal(placeDefender(b, first.id, 'cell-3-6'), true);
  assert.deepEqual(b.route, preview.route); assert.ok(b.routeLength > oldRoute); assert.equal(b.routeCellIds.includes(first.padId), false); assertRoute(b);
  const occupied = second.padId, revision = b.routeRevision, beforeSwap = b.route;
  assert.equal(placeDefender(b, first.id, second.padId), true); assert.equal(second.padId, 'cell-3-6'); assert.equal(first.padId, occupied);
  assert.deepEqual(b.route, beforeSwap); assert.ok(b.routeRevision > revision);
  assert.equal(placeDefender(b, second.id, original), true); assert.equal(b.routeLength, oldRoute);
  assert.equal(recallDefender(b, first.id), true); assertRoute(b);
});

test('basic towers spend five supplies, refund three, stay capped at eighty and never mutate cards, gold or training', () => {
  const b = battle(); b.collection.gold = 73; const before = JSON.stringify(b.collection); b.supplies = 1000;
  assert.equal(MAZE_TOWER_COST, 5); assert.equal(MAZE_TOWER_REFUND, 3); assert.equal(MAX_MAZE_TOWERS, 80);
  for (const cell of DEFENSE_PADS) {
    if (cell.row === 6) continue;
    if (b.mazeTowers.length >= 80) break;
    buildMazeTower(b, cell.id);
  }
  assert.equal(b.mazeTowers.length, 80); assert.equal(b.supplies, 600); assert.equal(b.trainingPoints, 0);
  const extra = DEFENSE_PADS.find(cell => !blocked(b).has(cell.id) && ![DEFENSE_GRID.entryId, DEFENSE_GRID.exitId].includes(cell.id));
  assert.equal(buildMazeTower(b, extra.id), false); assert.equal(b.supplies, 600);
  const id = b.mazeTowers[0].cellId; assert.equal(sellMazeTower(b, id), true); assert.equal(b.supplies, 603);
  assert.equal(sellMazeTower(b, id), false); assert.equal(buildMazeTower(b, id), true); assert.equal(b.supplies, 598);
  assert.equal(JSON.stringify(b.collection), before); assertRoute(b);
  const poor = battle(); poor.supplies = 4; assert.equal(buildMazeTower(poor, 'cell-3-6'), false); assert.equal(poor.mazeTowers.length, 0);
});

test('maze builds, sells and crew moves stay locked until the exact three-question round gate is completed', () => {
  const b = battle(); assert.equal(buildMazeTower(b, 'cell-3-6'), true); assert.equal(startDefenseWave(b), true);
  const checkLocked = () => {
    const before = JSON.stringify(b);
    assert.equal(buildMazeTower(b, 'cell-4-6'), false); assert.equal(sellMazeTower(b, 'cell-3-6'), false);
    assert.equal(placeDefender(b, b.allies[0].id, 'cell-4-6'), false); assert.equal(JSON.stringify(b), before);
  };
  checkLocked(); b.spawned = b.spawnTotal; b.enemies = []; advanceDefense(b, .05); assert.equal(b.status, 'learning'); checkLocked();
  assert.equal(completeDefenseLearning(b, { round: 1, total: 2, correct: 2 }), false); checkLocked();
  assert.ok(completeDefenseLearning(b, { round: 1, total: 3, correct: 2 }));
  assert.equal(sellMazeTower(b, 'cell-3-6'), true); assert.equal(buildMazeTower(b, 'cell-4-6'), true);
});

test('basic towers fire a delayed modest projectile and apply real movement disruption on impact', () => {
  const b = battle(); b.rng = () => .5; assert.equal(buildMazeTower(b, 'cell-1-5'), true);
  b.allies.forEach(u => { u.skills = []; }); startDefenseWave(b); step(b, .6);
  const projectile = b.projectiles.find(p => p.mazeTower); assert.ok(projectile);
  const target = b.enemies.find(enemy => enemy.id === projectile.targetId), hp = target.hp;
  const tower = b.mazeTowers[0]; tower.actionTimer = 999; b.spawned = b.spawnTotal;
  b.enemies.forEach(enemy => { enemy.skills = []; });
  assert.equal(projectile.age, 0); step(b, .05); assert.equal(target.hp, hp);
  step(b, .3); assert.ok(target.hp < hp); assert.ok(hp - target.hp <= 8);
  assert.ok(target.statuses.some(status => status.type === 'slow' && status.amount === .12));
  assert.ok(b.stats.damageDealt > 0); assert.equal(tower.hp, tower.maxHp);
});

test('cached routes drive movement without reading terrain or changing route revisions during frames', () => {
  const b = battle(9); buildMazeTower(b, 'cell-3-6'); startDefenseWave(b);
  const route = b.route, revision = b.routeRevision, originalTerrain = b.terrain;
  Object.defineProperty(b, 'terrain', { configurable: true, get() { throw Error('Frame movement must not rerun grid pathfinding'); } });
  step(b, 5); assert.equal(b.route, route); assert.equal(b.routeRevision, revision); assert.ok(b.enemies.length > 50);
  Object.defineProperty(b, 'terrain', { configurable: true, value: originalTerrain, writable: true }); assertRoute(b);
});

test('enemies stay inside traversable orthogonal cells even at tight bends and offset crowd lanes', () => {
  for (const stage of [1, 3, 7, 9]) {
    const b = battle(stage); for (let row = 0; row <= 9; row++) buildMazeTower(b, `cell-3-${row}`);
    const closed = blocked(b); assertRoute(b);
    for (let sample = 0; sample <= 3000; sample++) for (const lane of [-7, 0, 7]) {
      const point = defenseEnemyPointAt(sample / 3000, lane, b);
      const col = Math.floor((point.x - 40) / 40), row = Math.floor((point.y - 50) / 40);
      if (col >= 0 && col < 26 && row >= 0 && row < 13) assert.equal(closed.has(`cell-${col}-${row}`), false, `stage ${stage}, sample ${sample}, lane ${lane}`);
    }
  }
});

test('a player-built detour increases travel time rather than simply painting a different road', () => {
  const direct = battle(), maze = battle();
  for (let row = 0; row < 11; row++) assert.equal(buildMazeTower(maze, `cell-3-${row}`), true);
  assert.ok(maze.routeLength >= direct.routeLength + 320);
  for (const b of [direct, maze]) {
    b.allies.forEach(u => { u.skills = []; }); b.mazeTowers.forEach(t => { t.range = 0; });
    startDefenseWave(b); step(b, .6); b.enemies = [b.enemies[0]]; b.spawned = b.spawnTotal;
    Object.assign(b.enemies[0], { skills: [], progress: 0, moveSpeed: 100, hp: 100000, maxHp: 100000, statuses: [] });
    Object.assign(b.enemies[0], defensePointAt(0, b)); step(b, 12);
  }
  assert.equal(direct.enemies[0].escaped, true); assert.equal(maze.enemies[0].escaped, false); assert.equal(maze.status, 'running');
});

test('the six large-wave previews match actual spawning, preserve exactly three grades and include armored threats plus one captain', () => {
  const b = battle(), totals = [80, 105, 130, 160, 190, 230];
  b.ship.hp = b.ship.maxHp = 1000000;
  b.allies.forEach(u => { u.skills = []; });
  for (let round = 1; round <= 6; round++) {
    assert.equal(getDefenseWavePreview(b).total, totals[round - 1]); startDefenseWave(b); step(b, 12);
    assert.equal(b.spawned, totals[round - 1]); assert.equal(b.enemies.length, totals[round - 1]);
    if (round >= 3) assert.ok(b.enemies.some(e => e.enemyType === 'armored' && e.armor >= .4));
    assert.equal(b.enemies.filter(e => e.boss).length, round === 6 ? 1 : 0);
    for (const enemy of b.enemies) { enemy.hp = 0; enemy.alive = false; }
    if (b.status === 'running') advanceDefense(b, .05);
    assert.equal(b.status, 'learning'); assert.equal(completeDefenseLearning(b, { round, total: 2, correct: 2 }), false);
    assert.ok(completeDefenseLearning(b, { round, total: 3, correct: 3 }));
    b.allies.forEach(u => { u.skills = []; });
  }
  assert.equal(b.status, 'victory'); assert.equal(b.rewardedRounds.length, 6); assert.equal(b.collection.stats.correctAnswers, 18);
});
