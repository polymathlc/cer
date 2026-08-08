// Regression tests for EMBER DUEL's 🦸 HEROES. Run with:
//     node tools/duel-hero-tests.mjs            all cases
//     node tools/duel-hero-tests.mjs <name>     one case
//
// Like the sound harness, it loads the REAL sections out of app.js — the hero
// table, the armour rule and the hero-power resolver — and runs them against
// stubs, so it tests the shipping code rather than a copy of it.
//
// What it pins is the part of the feature a later change can quietly break with
// no visible symptom:
//   · the DEFAULT is the safest hero, and a save with no choice (or a hero that
//     has been retired) still lands on it rather than on nothing;
//   · armour is spent BEFORE life, which is the whole reason the safe hero is
//     safe;
//   · a hero power costs DUEL_POWER_COST, fires once a TURN, and is refused
//     when there is nothing legal to aim it at;
//   · every `kind` in DUEL_HEROES is actually handled by duelResolvePower — the
//     trap DUEL_ABILITIES documents, arriving from the other direction.
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
  slice('// ---- 🦸 HEROES', '// ---- The live run', 'hero table'),
  slice('// Armour is spent BEFORE life', 'function duelHealHero', 'armour'),
  slice('// ---- 🦸 The hero power', '// ---- Attacking', 'hero power')
].join('\n');

// ---- the stubs -------------------------------------------------------------
// Everything the three sections reach for that lives elsewhere in app.js. Each
// one records what it was asked to do; `log` is the flat event list a case
// asserts against.
let log = [];
let saved = 0, toasts = [];
const env = {
  console,
  showToast: (msg, kind) => toasts.push({ msg, kind }),
  rpgSave: () => { saved++; },
  tcgState: () => env.__state,
  duelRun: null,
  duelFxHero: (who, amount, cls) => log.push({ fx: 'hero', who, amount, cls }),
  duelFx: (uid, amount, cls) => log.push({ fx: 'minion', uid, amount, cls }),
  duelHurtMinion: (m, amount) => { m.hp -= amount; log.push({ hurt: m.uid, amount }); return amount; },
  duelDraw: who => log.push({ draw: who }),
  duelSfxPlay: name => log.push({ sfx: name }),
  duelLog: msg => log.push({ line: msg }),
  duelRender: () => log.push({ render: 1 }),
  duelCheckOver: () => false,
  // The effect dispatcher lives in the animation section, which is not sliced
  // in — recorded rather than stubbed away, so a power that animates nothing
  // is a visible failure rather than a silent one.
  duelFxForKind: (kind, who) => log.push({ fx: kind, who }),
  DUEL_FX_BY_KIND: { armor: 1, dmgAny: 1, grow: 1, chill: 1, study: 1 },
  __state: null
};
// The two side lookups live in the turn-flow section, which is not sliced in —
// they are one line each and copied verbatim.
const SIDES = 'function _duelSide(w) { return w === \'P\' ? duelRun.p : duelRun.e; }\n'
  + 'function _duelFoe(w) { return w === \'P\' ? duelRun.e : duelRun.p; }\n';
const build = () => new Function(...Object.keys(env), SIDES + section + '\nreturn {' + [
  'DUEL_HEROES', 'DUEL_HERO_BY_ID', 'DUEL_HERO_DEFAULT', 'DUEL_POWER_COST',
  'duelHeroById', 'duelHeroesFor', 'duelHeroId', 'duelHero', 'duelHeroDefault', 'duelHeroChosen', 'duelSetHero',
  'duelHurtHero', 'duelGainArmor',
  'duelPowerNeed', 'duelCanUsePower', 'duelCommitPower', 'duelResolvePower',
  'setRun: r => { duelRun = r; }'
].join(',') + '};')(...Object.values(env));
let M = build();

// A duel run with just enough on it for the rules under test.
const side = (hero, extra) => Object.assign({
  hp: 30, maxHp: 30, armor: 0, hero, powerUsed: false, mana: 10, cap: 10,
  deck: ['c001'], hand: [], board: [], fatigue: 0
}, extra || {});
const minion = (uid, sideTag, atk, hp) => ({ uid, side: sideTag, atk, hp, maxHp: hp, dead: false, frozen: 0, canAttack: true });
const run = (pHero, eHero, extra) => {
  const r = Object.assign({
    turn: 1, whose: 'P', over: false, busy: false,
    p: side(pHero), e: side(eHero), log: [], fxq: [], pending: null, sel: null
  }, extra || {});
  M.setRun(r);
  return r;
};

// ---- harness ---------------------------------------------------------------
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error((what || 'value') + ': got ' + g + ', wanted ' + w);
};
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const reset = () => { log = []; toasts = []; saved = 0; env.__state = null; M = build(); M.setRun(null); };

// ---- the table -------------------------------------------------------------
test('there are five basic heroes and they are all complete', () => {
  const basics = M.DUEL_HEROES.filter(h => h.tier === 'basic');
  eq(basics.length, 5, 'basic hero count');
  const ids = new Set();
  basics.forEach(h => {
    ok(h.id && !ids.has(h.id), 'a hero id must be unique: ' + h.id);
    ids.add(h.id);
    ['name', 'title', 'em', 'blurb', 'look', 'screen'].forEach(k => ok(h[k], h.id + ' is missing ' + k));
    ok(h.power && h.power.name && h.power.text && h.power.icon, h.id + ' has no hero power');
    ok(['magenta', 'green', 'blue'].indexOf(h.screen) >= 0, h.id + ' must name a real chroma screen');
  });
});

// The trap DUEL_ABILITIES documents, from the other direction: a hero added to
// the table with a `kind` nobody resolves is a power that costs two mana and
// does nothing at all — silently, with no error anywhere.
test('every hero power kind is actually resolved', () => {
  M.DUEL_HEROES.forEach(h => {
    reset();
    const r = run(h, M.DUEL_HEROES[0]);
    // Give it something legal to aim at whatever it asks for.
    r.p.board.push(minion('p1', 'P', 2, 3));
    r.e.board.push(minion('e1', 'E', 4, 5));
    const before = JSON.stringify([r.p.armor, r.p.hp, r.e.hp, r.p.board[0], r.e.board[0], log.length]);
    const need = M.duelPowerNeed(h);
    const target = need === 'friendlyMinion' ? { type: 'minion', m: r.p.board[0] }
      : need ? { type: 'minion', m: r.e.board[0] } : null;
    M.duelResolvePower('P', h.power, target);
    const after = JSON.stringify([r.p.armor, r.p.hp, r.e.hp, r.p.board[0], r.e.board[0], log.length]);
    ok(before !== after, h.id + '\'s ' + h.power.kind + ' power changed nothing — is it handled in duelResolvePower?');
  });
});

test('the safest hero is the default, and it is armour', () => {
  const d = M.duelHeroDefault();
  eq(d.id, M.DUEL_HERO_DEFAULT, 'the default id resolves');
  ok(d.safe, 'the default must be the hero marked safe');
  eq(M.DUEL_HEROES.filter(h => h.safe).length, 1, 'exactly one hero is billed as the safest');
  eq(d.power.kind, 'armor', 'the safe hero must be the one whose power cannot be wasted or mis-aimed');
  ok(!M.duelPowerNeed(d), 'the safe hero must never ask a beginner to aim anything');
});

test('a student who has never chosen still gets the safe hero', () => {
  reset();
  eq(M.duelHeroId({ duel: {} }), M.DUEL_HERO_DEFAULT, 'no choice');
  eq(M.duelHeroId({}), M.DUEL_HERO_DEFAULT, 'no duel block at all');
  eq(M.duelHeroId(null), M.DUEL_HERO_DEFAULT, 'no save at all');
  eq(M.duelHeroChosen({ duel: {} }), false, 'and they are told they have not chosen');
});

test('a hero that no longer exists falls back rather than breaking', () => {
  eq(M.duelHeroId({ duel: { hero: 'nobody' } }), M.DUEL_HERO_DEFAULT, 'retired id');
  ok(M.duelHero({ duel: { hero: 'nobody' } }), 'and a hero object always comes back');
  eq(M.duelHeroChosen({ duel: { hero: 'nobody' } }), false, 'a dead id is not a choice');
});

test('choosing is saved, and only a real hero can be chosen', () => {
  reset();
  env.__state = { duel: {} };
  M.duelSetHero('ember');
  eq(env.__state.duel.hero, 'ember', 'the choice is stored');
  eq(saved, 1, 'and saved');
  M.duelSetHero('nobody');
  eq(env.__state.duel.hero, 'ember', 'an unknown hero changes nothing');
  eq(saved, 1, 'and is never written');
  ok(toasts.some(t => t.kind === 'error'), 'the student is told why');
});

// ---- armour ----------------------------------------------------------------
test('armour is spent before life', () => {
  reset();
  const r = run(M.duelHeroDefault(), M.duelHeroById('ember'));
  M.duelGainArmor('P', 5);
  eq(r.p.armor, 5, 'armour gained');
  eq(r.p.hp, 30, 'gaining armour is not healing');
  M.duelHurtHero('P', 3);
  eq([r.p.armor, r.p.hp], [2, 30], 'a small blow is soaked whole');
  M.duelHurtHero('P', 6);
  eq([r.p.armor, r.p.hp], [0, 26], 'a bigger blow spends the rest and then bites');
});

test('armour never overheals and never goes negative', () => {
  reset();
  const r = run(M.duelHeroDefault(), M.duelHeroById('ember'));
  M.duelGainArmor('P', 2);
  M.duelHurtHero('P', 40);
  eq([r.p.armor, r.p.hp], [0, -8], 'the hero still dies through armour');
  eq(M.duelGainArmor('P', 0), 0, 'nothing gained is nothing shown');
  eq(log.filter(x => x.fx === 'hero' && x.cls === 'shield').length, 1, 'and only the real gain is animated');
});

test('the damage reported is the damage dealt, armour or not', () => {
  reset();
  const r = run(M.duelHeroDefault(), M.duelHeroById('ember'));
  M.duelGainArmor('P', 10);
  // Lifesteal heals for what the attack DEALT — if armour quietly reduced the
  // number here, a lifesteal minion would stop healing against an armoured foe.
  eq(M.duelHurtHero('P', 4), 4, 'the full blow is reported');
  eq(r.p.hp, 30, 'even though none of it reached the life total');
});

// ---- the power -------------------------------------------------------------
test('a hero power costs two mana and fires once a turn', () => {
  reset();
  const r = run(M.duelHeroDefault(), M.duelHeroById('ember'));
  r.p.mana = M.DUEL_POWER_COST;
  ok(M.duelCanUsePower('P'), 'affordable at exactly the cost');
  M.duelCommitPower('P', null);
  eq(r.p.mana, 0, 'the crystals are spent');
  eq(r.p.armor, 2, 'and the power resolved');
  eq(M.duelCanUsePower('P'), false, 'a second press in the same turn is refused');
  r.p.mana = 10;
  eq(M.duelCanUsePower('P'), false, 'even with mana to spare');
  r.p.powerUsed = false;                       // what duelBeginTurn does
  ok(M.duelCanUsePower('P'), 'and it comes back next turn');
});

test('a power is refused when it cannot be paid for', () => {
  reset();
  const r = run(M.duelHeroDefault(), M.duelHeroById('ember'));
  r.p.mana = M.DUEL_POWER_COST - 1;
  eq(M.duelCanUsePower('P'), false, 'one crystal short');
  M.duelCommitPower('P', null);
  eq([r.p.mana, r.p.armor], [M.DUEL_POWER_COST - 1, 0], 'and committing anyway changes nothing');
});

test('a targeted power is refused with nothing to aim at', () => {
  reset();
  const r = run(M.duelHeroById('frost'), M.duelHeroById('ember'));
  eq(M.duelPowerNeed(r.p.hero), 'enemyMinion', 'the freeze asks for an enemy minion');
  eq(M.duelCanUsePower('P'), false, 'an empty rival board means no legal target');
  r.e.board.push(minion('e1', 'E', 4, 5));
  ok(M.duelCanUsePower('P'), 'and it is available the moment there is one');
  const grove = run(M.duelHeroById('grove'), M.duelHeroById('ember'));
  eq(M.duelCanUsePower('P'), false, '+1/+1 with no minions of your own is refused too');
  grove.p.board.push(minion('p1', 'P', 2, 3));
  ok(M.duelCanUsePower('P'), 'and available once you have one');
});

test('the five basic powers do what they say', () => {
  // 🛡️ armour
  reset();
  let r = run(M.duelHeroDefault(), M.duelHeroById('ember'));
  M.duelResolvePower('P', M.duelHeroById('warden').power, null);
  eq([r.p.armor, r.p.hp], [2, 30], 'Bulwark');

  // 🔥 one damage, aimed
  reset();
  r = run(M.duelHeroById('ember'), M.duelHeroDefault());
  const foe = minion('e1', 'E', 4, 5); r.e.board.push(foe);
  M.duelResolvePower('P', M.duelHeroById('ember').power, { type: 'minion', m: foe });
  eq(foe.hp, 4, 'Ember Spark on a minion');
  M.duelResolvePower('P', M.duelHeroById('ember').power, { type: 'hero', who: 'E' });
  eq(r.e.hp, 29, 'Ember Spark on a face');

  // 🌿 +1/+1
  reset();
  r = run(M.duelHeroById('grove'), M.duelHeroDefault());
  const mine = minion('p1', 'P', 2, 3); r.p.board.push(mine);
  M.duelResolvePower('P', M.duelHeroById('grove').power, { type: 'minion', m: mine });
  eq([mine.atk, mine.hp, mine.maxHp], [3, 4, 4], 'Green Gift raises the ceiling too, so it is not undone by a heal');

  // ❄️ freeze, no damage
  reset();
  r = run(M.duelHeroById('frost'), M.duelHeroDefault());
  const cold = minion('e1', 'E', 6, 6); r.e.board.push(cold);
  M.duelResolvePower('P', M.duelHeroById('frost').power, { type: 'minion', m: cold });
  eq([cold.frozen, cold.canAttack, cold.hp], [1, false, 6], 'Chill Touch stops it without hurting it');

  // 📖 a card for a life
  reset();
  r = run(M.duelHeroById('scribe'), M.duelHeroDefault());
  M.duelResolvePower('P', M.duelHeroById('scribe').power, null);
  eq(log.filter(x => x.draw === 'p').length, 1, 'Ashen Study draws');
  eq(r.p.hp, 29, 'and it costs a life');
});

// A basic hero is the FLOOR the game is balanced on. The legendary set arrives
// next; if a basic power is quietly buffed to legendary numbers there is
// nothing left for the expansion to be.
test('the basic powers stay small', () => {
  M.DUEL_HEROES.filter(h => h.tier === 'basic').forEach(h => {
    ok((h.power.v | 0) <= 2, h.id + ' — a basic hero power must stay small (v ≤ 2)');
  });
  eq(M.DUEL_POWER_COST, 2, 'and they all cost the Hearthstone two');
});

test('the chooser offers exactly the basic heroes', () => {
  const list = M.duelHeroesFor({ cards: {} });
  eq(list.length, M.DUEL_HEROES.filter(h => h.tier === 'basic').length, 'basics are free to everybody');
  ok(list.every(h => h.tier === 'basic'), 'and nothing above basic leaks in before its expansion');
});

// Every power must queue an animation as well as change the board — a hero
// power that resolves in silence reads as a button that did nothing.
test('every hero power animates', () => {
  M.DUEL_HEROES.forEach(h => {
    reset();
    const r = run(h, M.DUEL_HEROES[0]);
    r.p.board.push(minion('p1', 'P', 2, 3));
    r.e.board.push(minion('e1', 'E', 4, 5));
    M.duelResolvePower('P', h.power, null);
    ok(log.some(x => x.fx === h.power.kind && x.who === 'P'), h.id + ' resolved without an animation');
  });
});

test('every hero names an element for its animation', () => {
  M.DUEL_HEROES.forEach(h => ok(h.el, h.id + ' has no element, so its power would animate in the default colour'));
});

// ---- the rival -------------------------------------------------------------
test('a power the rival uses is spent by the rival', () => {
  reset();
  const r = run(M.duelHeroDefault(), M.duelHeroById('ember'));
  r.e.mana = 4;
  M.duelCommitPower('E', { type: 'hero', who: 'P' });
  eq([r.e.mana, r.e.powerUsed], [2, true], 'the rival pays for its own power');
  eq(r.p.hp, 29, 'and it lands on the student');
  eq(r.p.powerUsed, false, 'without spending the student\'s');
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
