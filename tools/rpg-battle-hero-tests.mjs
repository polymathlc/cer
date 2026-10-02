import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { BATTLE_ROLES, battleRole, battleAvatarDataUrl, buildBattleHero } from '../rpg-battle-hero.mjs';
import { app, section, loadRenderer, sampleSets } from './rpg-avatar-art-tests.mjs';

test('all four roles are available and existing skill classes migrate without rebuilding a hero', () => {
  assert.deepEqual(Object.keys(BATTLE_ROLES), ['warrior', 'ranger', 'mage', 'healer']);
  assert.equal(battleRole(null, 'rogue'), 'ranger');
  assert.equal(battleRole(null, 'mage'), 'mage');
  assert.equal(battleRole(null, null), 'warrior');
  assert.equal(battleRole('healer', 'warrior'), 'healer');
  assert.equal(battleRole('constructor', 'mage'), 'mage');
});

test('every production equipment slot and pet evolution travels in a valid bounded SVG data URL', () => {
  const context = loadRenderer(), fixture = context.fixture;
  for (const set of sampleSets) {
    const state = { ...set, battleRole: 'healer', upgrades: { [set.equipment.pet]: 6 }, inventory: { secret: 1 }, stats: { privateLearning: true } };
    const before = JSON.stringify(state);
    fixture.setState(state);
    const svg = fixture.avatar();
    const hero = buildBattleHero({ uid: 'student-account-42', state, stats: { atk: 41, def: 12, maxHp: 240, spellPct: .4 }, svg });
    assert.ok(hero.avatarDataUrl.startsWith('data:image/svg+xml;charset=utf-8,'), set.name);
    assert.equal(decodeURIComponent(hero.avatarDataUrl.split(',')[1]), svg);
    assert.ok(Buffer.byteLength(JSON.stringify(hero)) < 750000, 'well inside the Firestore 1 MiB document limit');
    assert.equal(hero.role, 'healer');
    assert.equal(hero.uid, 'student-account-42');
    assert.equal(hero.stats.atk, 41);
    assert.equal(hero.stats.spellPct, .4);
    assert.equal(hero.equipment.weapon, set.equipment.weapon || null);
    assert.equal(hero.equipment.pet, set.equipment.pet || null);
    assert.equal('inventory' in hero, false);
    assert.equal('privateLearning' in hero.stats, false);
    assert.equal(JSON.stringify(state), before, 'snapshotting is read-only');
  }
  for (const item of fixture.items) {
    fixture.setState({ gender: 'female', equipment: { [item.slot]: item.id }, upgrades: {}, inventory: {} });
    assert.ok(battleAvatarDataUrl(fixture.avatar()), `every existing collectible is exportable: ${item.id}`);
  }
});

test('public data rejects active/external SVG content, unsafe equipment and non-finite stats', () => {
  const wrap = child => `<svg xmlns="http://www.w3.org/2000/svg">${child}</svg>`;
  for (const child of ['<script>alert(1)</script>', '<foreignObject/>', '<image href="https://evil.test"/>', '<a/>', '<rect onload="evil()"/>', '<rect fill="url(https://evil.test)"/>', '<style/>', '<use href="#a"/>', '<!ENTITY x SYSTEM "file:///private">']) {
    assert.equal(battleAvatarDataUrl(wrap(child)), '');
  }
  assert.equal(battleAvatarDataUrl(''), '');
  const hero = buildBattleHero({ uid: 'uid', state: { equipment: { weapon: '"><script>', pet: 'loyal_pup' } }, stats: { atk: Infinity, maxHp: NaN, def: -10, crit: undefined } });
  assert.equal(hero.equipment.weapon, null);
  assert.equal(hero.equipment.pet, 'loyal_pup');
  assert.equal(hero.stats.atk, 5);
  assert.equal(hero.stats.maxHp, 50);
  assert.equal(hero.stats.def, 0);
  assert.ok(Object.values(hero.stats).every(Number.isFinite));
  assert.throws(() => buildBattleHero({ uid: '' }), /stable account UID/);
});

function publicationFixture() {
  const writes = [], timers = new Map(), status = { textContent: '' };
  let nextTimer = 0;
  const context = vm.createContext({
    console, BATTLE_ROLES, battleRole, buildBattleHero, writes, timers,
    currentUser: { uid: 'owner', role: 'student', name: 'Student' },
    rpgState: { battleRole: 'warrior', equipment: { weapon: 'wood_sword' }, clazz: 'mage', gender: 'female', xp: 30, stats: {}, inventory: { wood_sword: 1 }, skills: { magic: 3 } },
    RPG_STORAGE_MODE: 'firestore', db: {},
    doc: (...parts) => parts.slice(1).join('/'),
    setDoc: (path, payload, options) => { writes.push({ path, payload: JSON.parse(JSON.stringify(payload)), options }); return Promise.resolve(); },
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    $: id => id === 'rpgBattleSyncStatus' ? status : null,
    grandLineRpgSaveGate: { defer: () => false },
    rpgPlayerStats: () => ({ level: 4, atk: 25, maxHp: 100, def: 5, crit: 12, spellPct: .2 }),
    rpgAvatarSvg: () => '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
    rpgLevelInfo: () => ({ level: 4 }), rpgScorePayload: () => ({}), rpgHouseOf: () => ({ id: 'nova' }),
    rpgGameBoardData: () => ({}), rpgMonthKey: () => '2026-10',
    rpgWriteLocal: () => {}, rpgRenderSide: () => {}, rpgRenderCharacterPage: () => {},
  });
  vm.runInContext(section(app, 'function rpgSave() {', 'function rpgSetGender(') + '\n' + section(app, 'let rpgPublishTimer =', '// ---- Class raid boss:'), context);
  return { context, writes, timers, status };
}

test('choosing any classroom role saves privately and immediately publishes without changing inventory or skill class', async () => {
  const { context, writes, status } = publicationFixture();
  for (const role of Object.keys(BATTLE_ROLES)) {
    context.rpgSetBattleRole(role);
    await Promise.resolve();
    const [save, publication] = writes.slice(-2);
    assert.equal(save.path, 'users/owner/settings/scienceRpg');
    assert.equal(save.payload.battleRole, role);
    assert.equal(save.payload.clazz, 'mage');
    assert.deepEqual(save.payload.inventory, { wood_sword: 1 });
    assert.deepEqual(save.payload.skills, { magic: 3 });
    assert.equal(publication.path, 'scienceGameLeaderboard/owner');
    assert.equal(publication.payload.battleHero.role, role);
    assert.equal(publication.payload.battleHero.equipment.weapon, 'wood_sword');
    assert.equal(publication.options.merge, true, 'existing Science Strike and leaderboard fields survive');
  }
  assert.match(status.textContent, /synced/);
});

test('an ordinary equipment save republishes the current hero; a queued write cannot cross accounts', () => {
  const { context, writes, timers } = publicationFixture();
  context.rpgState.equipment.weapon = 'starfire_staff';
  context.rpgSave();
  [...timers.values()].at(-1)();
  assert.equal(writes.at(-1).payload.battleHero.equipment.weapon, 'starfire_staff');
  const before = writes.length;
  context.rpgPublishLeaderboard();
  const queued = [...timers.values()].at(-1);
  context.currentUser = { uid: 'another-student', role: 'student' };
  queued();
  assert.equal(writes.length, before);
});

test('role UI is accessible and hydration preserves a saved role', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="rpgBattleRoles" role="group" aria-label="Choose your classroom role"/);
  assert.match(html, /id="rpgBattleSyncStatus" role="status" aria-live="polite"/);
  assert.match(section(app, 'function rpgHydrate(', 'function rpgSave('), /st\.battleRole = battleRole\(st\.battleRole, st\.clazz\)/);
});
