// Regression tests for EMBER DUEL's rival ARCHETYPES and the AI's card timing.
// Run with:
//     node tools/duel-rival-tests.mjs            all cases
//     node tools/duel-rival-tests.mjs <name>     one case
//
// It loads the REAL rival-deck section and the REAL `duelAiWorthPlaying` out of
// app.js and runs them against a small synthetic dex, so it tests the shipping
// code rather than a copy of it.
//
// What it pins is the report this feature answers: "I win easily by rushing
// many small creatures." The counter is a DECK — board clears, held until they
// are worth casting — and the two halves are useless without each other. A
// sweeper deck that fires its sweepers at an empty board counters nothing, and
// held sweepers in a deck that has none is just a rival that never plays.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const slice = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js — did the banner comment change?');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};
const section = [
  slice('// ---- Who the rival brought', '// The level the rival\'s cards fight at', 'rival decks'),
  slice('// Is this card worth playing THIS turn?', '// Where the rival aims its hero power.', 'ai timing')
].join('\n');

// ---- a synthetic dex -------------------------------------------------------
// Enough shape for the archetypes to have something to prefer: cheap 1★ bodies
// (the swarm), plain mid cards, board clears and taunt walls.
const KINDS = {
  strike: { kind: 'rush', kw: [] },
  blast: { kind: 'sweep', kw: [] },            // a board clear
  dawn: { kind: 'dawn', kw: [] },              // a board clear that heals
  guard: { kind: 'guard', kw: ['shield', 'taunt'] },
  heal: { kind: 'mend', kw: [] }
};
const CARDS = [];
const add = (n, stars, k, cost) => { for (let i = 0; i < n; i++) CARDS.push({ id: k + stars + '_' + i, name: k + i, stars, k, cost }); };
add(8, 1, 'strike', 1);
add(6, 2, 'strike', 2);
add(6, 3, 'strike', 4);
add(4, 3, 'blast', 4);
add(3, 4, 'guard', 5);
add(2, 5, 'dawn', 6);
add(3, 2, 'heal', 3);
const BY_ID = {};
CARDS.forEach(c => { BY_ID[c.id] = c; });

const SPELLS = [
  { id: 'sp_bolt', kind: 'dmgAny', v: 2, cost: 1 },
  { id: 'sp_lance', kind: 'dmgAny', v: 4, cost: 3 },
  { id: 'sp_meteor', kind: 'dmgAny', v: 8, cost: 6 },
  { id: 'sp_ashfall', kind: 'sweep', v: 3, cost: 4 },
  { id: 'sp_scry', kind: 'draw', v: 2, cost: 2 },
  { id: 'sp_study', kind: 'draw', v: 3, cost: 4 },
  { id: 'sp_mend', kind: 'heal', v: 6, cost: 2 },
  { id: 'sp_frost', kind: 'freeze', v: 1, cost: 2 },
  { id: 'sp_warcall', kind: 'buff', v: 2, cost: 3 },
  { id: 'sp_bulwark', kind: 'guard', v: 4, cost: 2 },
  { id: 'sp_siphon', kind: 'siphon', v: 3, cost: 4 },
  { id: 'sp_judgement', kind: 'judge', v: 5, cost: 7 }
];
const SPELL_BY_ID = {};
SPELLS.forEach(x => { SPELL_BY_ID[x.id] = x; });

// A seeded shuffle, so a failure is reproducible instead of arriving one run in
// twenty. `rand` is swapped per case where the roll itself is under test.
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

const env = {
  console,
  TCG_CARDS: CARDS,
  TCG_BY_ID: BY_ID,
  DUEL_SPELLS: SPELLS,
  DUEL_DECK_SIZE: 40,
  DUEL_AUTO_SPELLS: 10,
  DUEL_COPIES_MAX: 2,
  DUEL_COPIES_SPELL: 4,
  duelIsSpell: id => !!SPELL_BY_ID[id],
  duelAbility: card => KINDS[card.k],
  duelCardStats: card => ({ cost: card.cost }),
  duelRivalLevel: () => 20,
  duelDeckFor: () => env.__deck,
  _tcgShuffle: list => list.slice().sort(() => rnd() - 0.5),
  duelRun: null,
  __deck: []
};
const build = () => new Function(...Object.keys(env), section + '\nreturn {' + [
  'DUEL_RIVAL_PLANS', 'DUEL_AOE_ABILITIES', 'DUEL_WALL_ABILITIES', 'DUEL_SWARM_COST', 'DUEL_SWARM_SHARE',
  'DUEL_PLAN_MIN_PREF', 'duelPlanById', 'duelDeckIsSwarm', 'duelPlanFor', 'duelRivalDeck', '_duelFill', 'duelAiWorthPlaying',
  'setRun: r => { duelRun = r; }'
].join(',') + '};')(...Object.values(env));
let M = build();

// ---- harness ---------------------------------------------------------------
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error((what || 'value') + ': got ' + g + ', wanted ' + w);
};
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const reset = () => { seed = 7; env.__deck = []; M = build(); M.setRun(null); };

const swarmDeck = () => CARDS.filter(c => c.cost <= 2).slice(0, 12).concat(CARDS.filter(c => c.cost <= 2).slice(0, 12))
  .map(c => c.id).concat(['sp_bolt', 'sp_bolt', 'sp_scry', 'sp_scry']);
const bigDeck = () => CARDS.filter(c => c.cost >= 4).map(c => c.id).concat(CARDS.filter(c => c.cost >= 4).map(c => c.id))
  .slice(0, 24).concat(['sp_meteor', 'sp_judgement', 'sp_study', 'sp_lance']);

// ---- reading the student's deck -------------------------------------------
test('a deck of cheap bodies is a swarm deck, a deck of big ones is not', () => {
  ok(M.duelDeckIsSwarm(swarmDeck()), 'cheap minions played wide');
  ok(!M.duelDeckIsSwarm(bigDeck()), 'expensive minions are not a swarm');
  ok(!M.duelDeckIsSwarm([]), 'an empty deck is not a swarm');
  ok(!M.duelDeckIsSwarm(['sp_bolt', 'sp_scry']), 'spells alone are not a swarm');
  // A handful of cards is not evidence of anything — the rival should not be
  // reading a strategy into a student's first four cards.
  ok(!M.duelDeckIsSwarm(CARDS.filter(c => c.cost <= 2).slice(0, 4).map(c => c.id)), 'too few to judge');
});

// ---- the roll --------------------------------------------------------------
test('the sweeper turns up more often against a swarm, and is never the only deck', () => {
  const run = deck => {
    reset();
    env.__deck = deck;
    const n = {};
    for (let i = 0; i < 4000; i++) { const p = M.duelPlanFor({}); n[p.id] = (n[p.id] | 0) + 1; }
    return n;
  };
  const vsBig = run(bigDeck()), vsSwarm = run(swarmDeck());
  ok(vsSwarm.ashfall > vsBig.ashfall * 1.4, 'the counter must be materially more likely against a swarm');
  // "Occasionally" cuts both ways: it must show up against an ordinary deck,
  // and a swarm player must still meet something other than the counter.
  ok(vsBig.ashfall > 4000 * 0.15, 'the counter still turns up sometimes against anyone');
  ok(vsSwarm.mixed > 4000 * 0.15, 'a swarm player is not farmed by one deck every duel');
  M.DUEL_RIVAL_PLANS.forEach(p => ok((vsSwarm[p.id] | 0) > 0 && (vsBig[p.id] | 0) > 0, p.id + ' must be reachable'));
});

// ---- the decks themselves --------------------------------------------------
const counts = deck => { const n = {}; deck.forEach(id => { n[id] = (n[id] | 0) + 1; }); return n; };
const aoeCount = deck => deck.filter(id => {
  const sp = SPELL_BY_ID[id];
  if (sp) return sp.kind === 'sweep' || sp.kind === 'judge';
  return !!M.DUEL_AOE_ABILITIES[KINDS[BY_ID[id].k].kind];
}).length;

test('every archetype builds a legal, full deck', () => {
  M.DUEL_RIVAL_PLANS.forEach(p => {
    reset();
    const deck = M.duelRivalDeck({ cards: {} }, p);
    eq(deck.length, 40, p.id + ' deck size');
    const n = counts(deck);
    Object.keys(n).forEach(id => {
      const max = SPELL_BY_ID[id] ? 4 : 2;
      ok(n[id] <= max, p.id + ': ' + id + ' appears ' + n[id] + ' times, over the limit of ' + max);
    });
    ok(deck.filter(id => SPELL_BY_ID[id]).length >= 8, p.id + ' must still run spells, not 40 monsters');
    ok(deck.every(id => SPELL_BY_ID[id] || BY_ID[id]), p.id + ' must only contain real cards');
  });
});

test('the counter deck is actually a counter', () => {
  reset();
  const mixed = M.duelRivalDeck({ cards: {} }, M.duelPlanById('mixed'));
  reset();
  const ash = M.duelRivalDeck({ cards: {} }, M.duelPlanById('ashfall'));
  ok(aoeCount(ash) > aoeCount(mixed), 'Ashfall Legion must hold more board clears than a mixed deck ('
    + aoeCount(ash) + ' vs ' + aoeCount(mixed) + ')');
  ok(ash.indexOf('sp_ashfall') >= 0, 'and the sweep spell itself is in it');
  reset();
  const wall = M.duelRivalDeck({ cards: {} }, M.duelPlanById('bulwark'));
  const taunts = wall.filter(id => BY_ID[id] && (KINDS[BY_ID[id].k].kw || []).indexOf('taunt') >= 0).length;
  ok(taunts >= 2, 'Bulwark Order must actually field taunts, got ' + taunts);
});

test('a plan reaches one star past the band for its own cards, and no further', () => {
  // A 2★ collection is banded 1–3, and every Taunt in this dex is 4★. The
  // archetype must widen by one rather than quietly collapse into a random
  // deck — but 5★ board clears stay out of reach, so nobody meets a deck of
  // legends because the rival wanted a theme.
  reset();
  const early = { cards: { strike2_0: 1, strike2_1: 1 } };        // average 2★ → band 1–3
  const wall = M.duelRivalDeck(early, M.duelPlanById('bulwark'));
  const taunts = wall.filter(id => BY_ID[id] && (KINDS[BY_ID[id].k].kw || []).indexOf('taunt') >= 0).length;
  ok(taunts >= 1, 'the plan widened far enough to find its cards');
  ok(wall.every(id => SPELL_BY_ID[id] || BY_ID[id].stars <= 4), 'and never more than one star past the band');
  // The widening is for the PLAN, not a free upgrade: a plan with no
  // preferences at all must stay inside the student's own band.
  reset();
  const mixed = M.duelRivalDeck(early, M.duelPlanById('mixed'));
  ok(mixed.every(id => SPELL_BY_ID[id] || BY_ID[id].stars <= 3), 'a mixed deck stays in band');
});

test('_duelFill never loops forever on a tiny collection', () => {
  eq(M._duelFill(['a'], 5, 2).length, 5, 'one card, five slots — the cap lifts rather than hanging');
  eq(M._duelFill([], 5, 2).length, 0, 'nothing to draw from is an empty deck, not a hang');
  eq(M._duelFill(['a', 'b'], 4, 2), ['a', 'b', 'a', 'b'], 'and it spreads before it repeats');
});

// ---- the other half: WHEN the rival casts ----------------------------------
const foe = (uid, hp) => ({ uid, hp, dead: false });
const setBoard = (mine, theirs) => {
  M.setRun({ p: { board: theirs || [] }, e: { board: mine || [], hp: 30, maxHp: 30 } });
};
const spell = id => ({ type: 'spell', spell: SPELL_BY_ID[id] });

test('a board clear is held until it is worth casting', () => {
  reset();
  setBoard([], []);
  eq(M.duelAiWorthPlaying(spell('sp_ashfall')), false, 'an empty board is not a target');
  setBoard([], [foe('a', 5)]);
  eq(M.duelAiWorthPlaying(spell('sp_ashfall')), false, 'one big minion is not worth a clear');
  setBoard([], [foe('a', 2)]);
  eq(M.duelAiWorthPlaying(spell('sp_ashfall')), true, 'unless it kills it outright');
  setBoard([], [foe('a', 9), foe('b', 9)]);
  eq(M.duelAiWorthPlaying(spell('sp_ashfall')), true, 'two bodies is a board — this is the swarm punish');
  setBoard([], [foe('a', 9), foe('b', 9), foe('c', 9), foe('d', 9)]);
  eq(M.duelAiWorthPlaying(spell('sp_judgement')), true, 'and so is four');
});

test('the rest of the hand is not held back', () => {
  reset();
  setBoard([], []);
  ['sp_bolt', 'sp_lance', 'sp_meteor', 'sp_scry', 'sp_study', 'sp_frost', 'sp_bulwark', 'sp_siphon']
    .forEach(id => eq(M.duelAiWorthPlaying(spell(id)), true, id + ' must never be held'));
  // A plain minion is always worth playing — holding bodies is how a rival
  // loses while holding a perfect hand.
  eq(M.duelAiWorthPlaying({ type: 'minion', card: BY_ID.strike1_0, ab: KINDS.strike }), true, 'a plain body');
});

test('healing and buffs wait for a reason', () => {
  reset();
  setBoard([], []);
  eq(M.duelAiWorthPlaying(spell('sp_mend')), false, 'a heal at full health is a wasted card');
  M.setRun({ p: { board: [] }, e: { board: [], hp: 20, maxHp: 30 } });
  eq(M.duelAiWorthPlaying(spell('sp_mend')), true, 'and is cast once it is worth casting');
  setBoard([{ uid: 'm', hp: 3, dead: false }], []);
  eq(M.duelAiWorthPlaying(spell('sp_warcall')), false, 'a board-wide buff on one minion');
  setBoard([{ uid: 'm', hp: 3, dead: false }, { uid: 'n', hp: 3, dead: false }], []);
  eq(M.duelAiWorthPlaying(spell('sp_warcall')), true, 'is worth it on two');
});

test('a minion with a clearing battlecry is only held with nothing to clear', () => {
  reset();
  const blaster = { type: 'minion', card: BY_ID.blast3_0, ab: Object.assign({ trig: 'battlecry' }, KINDS.blast) };
  setBoard([], []);
  eq(M.duelAiWorthPlaying(blaster), false, 'nothing on the other side yet');
  setBoard([], [foe('a', 4)]);
  eq(M.duelAiWorthPlaying(blaster), true, 'one target is enough — it is a body as well as a clear');
});

test('a dead minion is not a target', () => {
  reset();
  M.setRun({ p: { board: [{ uid: 'a', hp: 0, dead: true }, { uid: 'b', hp: 0, dead: true }] }, e: { board: [], hp: 30, maxHp: 30 } });
  eq(M.duelAiWorthPlaying(spell('sp_ashfall')), false, 'two corpses are not a board');
});

// ---- run -------------------------------------------------------------------
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name.indexOf(only) < 0) continue;
  reset();
  try { c.fn(); pass++; console.log('  ok   ' + c.name); }
  catch (e) { fail++; console.log('  FAIL ' + c.name + '\n         ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
