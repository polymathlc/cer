import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Production section exists: ${start}`);
  return app.slice(a, b);
}
const copy = value => JSON.parse(JSON.stringify(value));

function publicationFixture() {
  const writes = [], timers = new Map();
  const deleted = { retiredField: true };
  const leaderboard = { fps: { best: 200, correct: 30 }, battleHero: { role: 'mage', stats: { atk: 999 } } };
  let nextTimer = 0;
  const context = vm.createContext({
    console, currentUser: { uid: 'owner', role: 'student', name: 'Student' },
    rpgState: { equipment: { weapon: 'starfire_staff' }, clazz: 'mage', gender: 'female', xp: 30, gold: 70,
      stats: { gameQ: 8, gameCorrect: 7 }, inventory: { starfire_staff: 1 }, skills: { magic: 3 } },
    RPG_STORAGE_MODE: 'firestore', db: {},
    doc: (...parts) => parts.slice(1).join('/'), deleteField: () => deleted,
    setDoc: (path, payload, options) => {
      writes.push({ path, payload: copy(payload), options });
      if (path === 'scienceGameLeaderboard/owner') {
        assert.equal(options.merge, true, 'Science Strike and other existing leaderboard data survive');
        for (const [key, value] of Object.entries(payload)) {
          if (value === deleted) delete leaderboard[key];
          else leaderboard[key] = copy(value);
        }
      }
      return Promise.resolve();
    },
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    grandLineRpgSaveGate: { defer: () => false },
    rpgAvatarSvg: () => { throw new Error('CER must not build classroom avatar exports'); },
    rpgLevelInfo: () => ({ level: 4 }), rpgScorePayload: () => ({ total: 12 }), rpgHouseOf: () => ({ id: 'nova' }),
    rpgGameBoardData: () => ({}), rpgMonthKey: () => '2026-10',
    rpgWriteLocal: () => {}, rpgRenderSide: () => {},
  });
  vm.runInContext(section('function rpgSave() {', 'function rpgSetGender(') + '\n' +
    section('let rpgPublishTimer =', '// ---- Class raid boss:'), context);
  return { context, writes, timers, leaderboard };
}

test('saving CER progression retires the classroom export while preserving CER gameplay and other leaderboard fields', () => {
  const { context, writes, timers, leaderboard } = publicationFixture();
  context.rpgSave();
  assert.equal(writes.length, 1, 'the private CER save still writes immediately');
  assert.equal(writes[0].path, 'users/owner/settings/scienceRpg');
  assert.deepEqual(writes[0].payload.inventory, { starfire_staff: 1 });
  assert.deepEqual(writes[0].payload.skills, { magic: 3 });
  assert.equal(writes[0].payload.clazz, 'mage');
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal('battleHero' in leaderboard, false, 'previously published classroom snapshots are removed');
  assert.deepEqual(leaderboard.equipment, { weapon: 'starfire_staff' });
  assert.equal(leaderboard.gender, 'female');
  assert.equal(leaderboard.clazz, 'mage');
  assert.deepEqual(leaderboard.fps, { best: 200, correct: 30 });
  assert.deepEqual(leaderboard.games, { q: 8, correct: 7 });
  assert.deepEqual(leaderboard.score, { total: 12 });
  assert.equal(leaderboard.xp, 30);
});

test('queued leaderboard writes cannot cross accounts and only student cloud accounts publish', () => {
  const { context, writes, timers } = publicationFixture();
  context.rpgPublishLeaderboard();
  const queued = [...timers.values()][0];
  context.currentUser = { uid: 'another-student', role: 'student' };
  queued();
  assert.equal(writes.length, 0);
  context.currentUser = { uid: 'owner', role: 'admin' };
  context.rpgPublishLeaderboard(true);
  assert.equal(writes.length, 0);
  context.currentUser = { uid: 'owner', role: 'student' };
  context.RPG_STORAGE_MODE = 'local';
  context.rpgPublishLeaderboard(true);
  assert.equal(writes.length, 0);
});

test('retiring a saved classroom role preserves CER class, skills, equipment, inventory and currency', () => {
  const context = vm.createContext({
    tcgHydrateState: state => state,
    RPG_TREE_BY_ID: { magic: { max: 5 } },
    RPG_ITEMS_BY_ID: { starfire_staff: { id: 'starfire_staff', slot: 'weapon' } },
    RPG_SLOTS: ['weapon'], RPG_ENEMIES_BY_ID: {}, rpgWeaponFx: () => ({ kind: 'magic' }),
  });
  vm.runInContext(section('function rpgDefaults() {', 'function rpgReadLocal(') + '\n' +
    section('function rpgHydrate(', 'function rpgSave('), context);
  const saved = { v: 2, cap99Fix: true, battleRole: 'healer', clazz: 'mage', gender: 'female', gold: 70, xp: 30,
    equipment: { weapon: 'starfire_staff' }, inventory: { starfire_staff: 1 }, skills: { magic: 3 },
    tcg: { cards: { c001: 3 }, team: ['c001'] } };
  const before = copy(saved), hydrated = copy(context.rpgHydrate(saved));
  assert.equal('battleRole' in hydrated, false);
  for (const key of ['clazz', 'gender', 'gold', 'xp', 'inventory', 'skills', 'tcg']) assert.deepEqual(hydrated[key], saved[key], key);
  assert.equal(hydrated.equipment.weapon, 'starfire_staff');
  assert.deepEqual(saved, before, 'hydration does not mutate the source save');
});

test('CER no longer offers classroom role controls or loads a classroom snapshot exporter', () => {
  assert.doesNotMatch(html, /rpgBattleRoles|rpgBattleSyncStatus|rpg-battle-role/);
  assert.doesNotMatch(app, /buildBattleHero|rpgRenderBattleRoles|rpgSetBattleRole|rpg-battle-hero\.mjs/);
  assert.match(html, /id="rpgAvatarFrame"/);
  assert.match(html, /data-rpgtab="skills"/);
  assert.match(html, /id="rpgEquipRow"/);
});
