// Regression tests for 🌋 EMBER SIEGE's 🎯 SQUAD — the three-per-role bench a
// student chooses before the gate opens. Run with:
//     node tools/siege-squad-tests.mjs            all cases
//     node tools/siege-squad-tests.mjs <name>     one case
//
// Like the duel harnesses, it loads the REAL sections out of app.js — the role
// table and the squad block — and runs them against stubs, so it tests the
// shipping code rather than a copy of it.
//
// Everything it pins fails SILENTLY, and each failure lands on a student
// mid-game with nothing on screen to explain it:
//   · the cap is PER ROLE. Lose that and a squad is eighteen attackers and no
//     healer, which is the messy scroll this feature exists to end — wearing a
//     tidier heading.
//   · a squad is never EMPTY. The deck column is the only way to summon
//     anything, so an empty one is a game that renders perfectly and cannot be
//     played at all.
//   · a card no longer owned drops out. A merged-away monster left on the
//     bench is a tile that costs mana and summons nothing.
//   · the DECK reads the squad and the SAVE carries it. Either half missing and
//     the picker is decoration: the choice is made, confirmed, and then either
//     ignored by the battlefield or forgotten by the next run.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const slice = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js — did the banner comment change?');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b);
};
const section = [
  slice('// ---- Roles: the shelves', '// 6★ and 7★ splash monsters', 'role table'),
  slice('// 🎯 CHOOSING A SQUAD', '// ---- The pick screen', 'squad block')
].join('\n');

// ---- the stubs -------------------------------------------------------------
// A synthetic dex: four monsters in every role, each a different power, so
// "the best three" has an unambiguous right answer.
const MODE_BY_ROLE = { attack: 'bolt', splash: 'splash', pierce: 'pierce', control: 'slow', healer: 'heal', tank: 'wall' };
const DEX = {};
let num = 0;
Object.keys(MODE_BY_ROLE).forEach(role => {
  for (let i = 1; i <= 4; i++) {
    const id = role + i;
    DEX[id] = { id, num: ++num, name: role + ' ' + i, stars: i, mode: MODE_BY_ROLE[role] };
  }
});
let saves = 0, toasts = [];
const env = {
  console,
  TCG_BY_ID: DEX,
  TCG_SKILLS: {},
  tcgState: () => env.__state,
  // Roles come off the skill kind in the app; here the synthetic card carries
  // its lane mode directly, which is the only thing emsRole actually reads.
  emsBehaviour: card => ({ mode: (card && card.mode) || 'bolt' }),
  // Power rises with the star rating, so `4` is always the best of a role.
  tcgCardPower: id => (DEX[id] ? DEX[id].stars * 100 : 0),
  rpgSave: () => { saves++; },
  showToast: (m, k) => toasts.push({ m, k }),
  __state: null
};
const M = new Function(...Object.keys(env), section + '\nreturn {' + [
  'EMS_ROLES', 'EMS_SQUAD_PER_ROLE', 'emsRole',
  'emsOwnedCards', 'emsSquadShelves', 'emsSquadSort', 'emsSquadClean',
  'emsSquadDefault', 'emsSquadSaved', 'emsSquadStore'
].join(',') + '};')(...Object.values(env));

// A save owning the listed ids (everything, if none are named).
const own = (ids, siege) => {
  const cards = {};
  (ids || Object.keys(DEX)).forEach(id => { cards[id] = 1; });
  env.__state = { cards, siege: siege || { best: 0, runs: 0 } };
  return env.__state;
};
const roleOf = id => M.emsRole(DEX[id]).key;
const countByRole = ids => {
  const per = {};
  ids.forEach(id => { const k = roleOf(id); per[k] = (per[k] || 0) + 1; });
  return per;
};

// ---- the tiny harness ------------------------------------------------------
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(msg + '\n           got ' + A + '\n           want ' + B);
};

// ---- the cap ---------------------------------------------------------------
test('the cap is three PER ROLE, not a flat total', () => {
  own();
  const all = Object.keys(DEX);
  const kept = M.emsSquadClean(all);
  const per = countByRole(kept);
  Object.keys(per).forEach(k => eq(per[k], M.EMS_SQUAD_PER_ROLE, k + ' kept ' + per[k] + ' — the cap is per role'));
  eq(kept.length, M.EMS_ROLES.length * M.EMS_SQUAD_PER_ROLE, 'every role fills its own three');
});

test('a role the student is short of keeps everything they own in it', () => {
  own(['tank1', 'attack1', 'attack2', 'attack3', 'attack4']);
  const kept = M.emsSquadClean(['tank1', 'attack1', 'attack2', 'attack3', 'attack4']);
  eq(countByRole(kept), { tank: 1, attack: 3 }, 'one tank is a squad of one tank, not an error');
});

test('the FIRST three of a role survive the cap, in the order they were picked', () => {
  own();
  eq(M.emsSquadClean(['attack4', 'attack2', 'attack1', 'attack3']), ['attack4', 'attack2', 'attack1'],
    'the cap trims the tail, never reshuffles the choice');
});

test('a card that is no longer owned drops out', () => {
  own(['tank1', 'healer1']);
  eq(M.emsSquadClean(['tank1', 'attack4', 'healer1']), ['tank1', 'healer1'],
    'a monster merged away must not sit on the bench costing mana and summoning nothing');
});

test('the same card listed twice counts once', () => {
  own();
  eq(M.emsSquadClean(['tank1', 'tank1', 'tank2']), ['tank1', 'tank2'], 'a duplicate must not eat a slot');
});

test('rubbish in is an empty squad out, never a throw', () => {
  own();
  eq(M.emsSquadClean(null), [], 'no list at all');
  eq(M.emsSquadClean(['nope', 42, null]), [], 'ids that name nothing');
});

// ---- the default -----------------------------------------------------------
test('the default fields the BEST three of every role', () => {
  own();
  const def = M.emsSquadDefault();
  eq(countByRole(def), { attack: 3, splash: 3, pierce: 3, control: 3, healer: 3, tank: 3 }, 'one shelf each');
  ok(def.indexOf('tank4') >= 0 && def.indexOf('tank3') >= 0 && def.indexOf('tank2') >= 0,
    'the three strongest tanks are the three chosen');
  ok(def.indexOf('tank1') < 0, 'and the weakest is the one left out');
});

test('the default is already inside the cap', () => {
  own();
  eq(M.emsSquadClean(M.emsSquadDefault()), M.emsSquadDefault(), 'nothing the default proposes is ever trimmed');
});

test('strongest first is what the shelf is sorted by', () => {
  own();
  eq(M.emsSquadSort([DEX.tank1, DEX.tank4, DEX.tank2]).map(c => c.id), ['tank4', 'tank2', 'tank1'],
    'the pick screen is read top-left first, so the best has to be there');
});

// ---- what a run actually gets ----------------------------------------------
test('a student who has never picked still gets a playable squad', () => {
  own();
  const sq = M.emsSquadSaved();
  ok(sq.length > 0, 'an empty deck column is a game that cannot be played at all');
  eq(sq, M.emsSquadDefault(), 'and it is the best of what they own');
});

test('a saved squad is what comes back', () => {
  own(null, { best: 3, runs: 2, squad: ['healer1', 'tank2'] });
  eq(M.emsSquadSaved(), ['healer1', 'tank2'], 'the line-up a student settled on is not re-picked every run');
});

test('a saved squad whose cards have all gone falls back rather than emptying', () => {
  own(['attack1'], { best: 0, runs: 0, squad: ['tank4', 'healer4'] });
  eq(M.emsSquadSaved(), ['attack1'], 'the fallback is the default, never nothing');
});

test('an over-full saved squad is trimmed on the way out, not trusted', () => {
  own(null, { best: 0, runs: 0, squad: ['tank1', 'tank2', 'tank3', 'tank4'] });
  eq(M.emsSquadSaved(), ['tank1', 'tank2', 'tank3'], 'a save written by an older build cannot exceed the cap');
});

test('storing a squad cleans it and saves', () => {
  const s = own();
  saves = 0;
  M.emsSquadStore(['tank1', 'tank2', 'tank3', 'tank4', 'nope']);
  eq(s.siege.squad, ['tank1', 'tank2', 'tank3'], 'what is written is already inside the cap');
  ok(saves === 1, 'and it is actually saved, or the pick is forgotten on reload');
});

test('storing keeps the rest of the siege record', () => {
  const s = own(null, { best: 7, runs: 4 });
  M.emsSquadStore(['tank1']);
  eq([s.siege.best, s.siege.runs], [7, 4], 'a squad must not cost a student their best wave');
});

// ---- the two halves that live outside this block ---------------------------
// Both are read from the source rather than executed: one is inside the
// hydrator (which reaches half the app) and the other inside the renderer.
test('the SAVE carries the squad through tcgHydrateState', () => {
  const lit = src.slice(src.indexOf('siege: {'), src.indexOf('siege: {') + 400);
  ok(/squad:/.test(lit),
    'tcgHydrateState is a WHITELIST — a squad missing from its siege literal is a squad dropped on every load');
});

test('the DECK is drawn from the squad, not from the whole collection', () => {
  const fn = slice('function emsRenderDeck()', '\nfunction emsSelect', 'deck renderer');
  ok(/emsRun\.squad/.test(fn), 'the deck must read the run\'s squad, or the pick screen changes nothing');
  ok(/emsSquadDefault\(\)/.test(fn), 'and fall back to a real squad rather than drawing an empty column');
  ok(!/Object\.keys\(s\.cards\)/.test(fn), 'the whole collection is exactly what it must stop listing');
});

test('the pick screen is what ⚔️ Ember Siege opens', () => {
  const fn = slice('function emsOpen()', '\nfunction emsLaunch', 'emsOpen');
  ok(/emsOpenSquad\(\)/.test(fn), 'a run must not start before the student has chosen');
  ok(!/emsPreloadFx/.test(fn), 'and the battlefield must not be built behind them while they choose');
});

// ---- run -------------------------------------------------------------------
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name.indexOf(only) < 0) continue;
  toasts = [];
  try { c.fn(); pass++; console.log('  ok   ' + c.name); }
  catch (e) { fail++; console.log('  FAIL ' + c.name + '\n         ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
