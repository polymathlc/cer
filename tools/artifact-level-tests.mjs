// Regression tests for 🔱 ARTIFACT LEVELS. Run with:
//     node tools/artifact-level-tests.mjs            all cases
//     node tools/artifact-level-tests.mjs <name>     one case
//
// It loads the REAL artifact table and the REAL power scaling out of app.js.
//
// Every artifact's `pow` means something different — a percentage, a countdown,
// a damage multiplier, a boolean — and a single "scale it by the level" rule
// is wrong for three of the four. Getting one of those backwards makes an
// artifact WORSE the more copies a student feeds it, which is the opposite of
// the promise and would never throw an error.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};
const section = [
  'const TCG_MERGE_GAIN = ' + /const TCG_MERGE_GAIN = (\{[^}]*\})/.exec(src)[1] + ';',
  cut('const TCG_ARTIFACTS = [', 'function tcgArtifactById', 'artifact table') + '];'.slice(0, 0),
  cut('function tcgArtifactById', '// ---- Auto-battle strategies', 'level helpers')
].join('\n');

const M = new Function('tcgState', section + '\nreturn { TCG_ARTIFACTS, TCG_ARTI_MAX, TCG_ARTI_STEP, TCG_ARTI_CAP,'
  + ' TCG_ARTI_BATTERY_LVL, tcgArtifactById, tcgArtiGain, tcgArtiPow, tcgArtiBlurb, tcgArtiLevelFromCopies, _tcgClampArti };')(() => null);

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const byId = id => M.tcgArtifactById(id);

// ---- levels from copies ----------------------------------------------------
test('a repeat copy is worth levels, and rarer means more', () => {
  eq(M.tcgArtiLevelFromCopies(1, 1), 1, 'the first copy is Lv1');
  eq(M.tcgArtiLevelFromCopies(1, 2), 2, 'a 1★ repeat is one level');
  eq(M.tcgArtiLevelFromCopies(1, 5), 5, 'four repeats, four levels');
  eq(M.tcgArtiLevelFromCopies(7, 2), 9, 'a 7★ repeat is eight levels');
  eq(M.tcgArtiLevelFromCopies(6, 3), 9, 'a 6★ repeat is four');
  ok(M.tcgArtiGain(7) > M.tcgArtiGain(1), 'a rarer repeat must be worth more');
});

test('the ceiling is Lv99 and nothing goes past it or under 1', () => {
  eq(M.TCG_ARTI_MAX, 99, 'the promised ceiling');
  eq(M.tcgArtiLevelFromCopies(7, 500), 99, 'a hoard stops at the top');
  eq(M._tcgClampArti(0), 1, 'never below 1');
  eq(M._tcgClampArti(-5), 1, 'nor negative');
  eq(M._tcgClampArti(1e6), 99, 'nor past the top');
  eq(M._tcgClampArti(undefined), 1, 'nor undefined');
});

// ---- the power curve -------------------------------------------------------
// "Power increases gradually" — every step up must be an increase, and the
// whole climb must be worth having without being a different game.
test('every plain-percentage artifact climbs, gradually, at every level', () => {
  const plain = M.TCG_ARTIFACTS.filter(a => ['atk', 'def', 'hp', 'swift', 'crit', 'healamp', 'shieldstart', 'lifesteal', 'thorns', 'regen'].indexOf(a.kind) >= 0);
  ok(plain.length >= 15, 'most of the set is a plain percentage');
  plain.forEach(a => {
    eq(M.tcgArtiPow(a, 1), a.pow, a.id + ' must be its printed value at Lv1');
    const cap = M.TCG_ARTI_CAP[a.kind];
    let prev = M.tcgArtiPow(a, 1);
    for (let lv = 2; lv <= 99; lv++) {
      const now = M.tcgArtiPow(a, lv);
      ok(now >= prev, a.id + ' went DOWN from Lv' + (lv - 1) + ' to Lv' + lv);
      if (cap) ok(now <= cap + 1e-9, a.id + ' passed its cap at Lv' + lv);
      prev = now;
    }
    ok(prev > a.pow, a.id + ' is no stronger at Lv99 than out of the packet');
    // Gradual, not a different artifact: a full climb must roughly double it,
    // not multiply it by ten.
    ok(prev <= a.pow * 2.5 + 1e-9, a.id + ' more than 2.5x at Lv99 — that is not gradual');
  });
});

test('a single level is a small step, not a jump', () => {
  const a = byId('oak');            // Defence +14%
  const step = M.tcgArtiPow(a, 2) - M.tcgArtiPow(a, 1);
  ok(step > 0, 'a level must be worth something');
  ok(step < a.pow * 0.05, 'one level must not be worth 5% of the whole artifact');
});

// ---- the three kinds that are NOT a percentage ------------------------------
test('the Warding Charm does not scale — an immunity is on or off', () => {
  const a = byId('ward');
  eq(a.kind, 'ward', 'still the boolean one');
  eq(M.tcgArtiPow(a, 1), a.pow, 'Lv1');
  eq(M.tcgArtiPow(a, 99), a.pow, 'Lv99 — unchanged');
});

// This is the one that would silently invert: skillThresh is a COUNTDOWN, so
// scaling it up makes the artifact worse the more copies you feed it.
test('the Battery Core counts DOWN, never up', () => {
  const a = byId('battery');
  eq(M.tcgArtiPow(a, 1), 2, 'out of the packet: skills charge a turn sooner');
  eq(M.tcgArtiPow(a, M.TCG_ARTI_BATTERY_LVL - 1), 2, 'still 2 just below the step');
  eq(M.tcgArtiPow(a, M.TCG_ARTI_BATTERY_LVL), 1, 'and 1 at the step');
  eq(M.tcgArtiPow(a, 99), 1, 'never lower than 1 — a skill every turn is the floor');
  for (let lv = 1; lv <= 99; lv++) ok(M.tcgArtiPow(a, lv) <= 2, 'never HIGHER than its printed value at Lv' + lv);
});

test('the element multipliers grow the part above x2, not the whole thing', () => {
  ['ember', 'wyrm'].forEach(id => {
    const a = byId(id);
    eq(a.kind, 'ember', id + ' is a multiplier');
    eq(Math.round(M.tcgArtiPow(a, 1) * 100) / 100, a.pow, id + ' at Lv1');
    const top = M.tcgArtiPow(a, 99);
    ok(top > a.pow, id + ' must grow');
    // x2 is what everybody gets, so only the artifact's own share may double.
    ok(top <= 2 + (a.pow - 2) * 2.5 + 1e-9, id + ' grew the base multiplier, not its own bonus');
    ok(top < 5, id + ' at Lv99 is ' + top + 'x — that is a different game');
  });
});

test('a revive can never pass a full heal', () => {
  ['phoenix', 'ankh'].forEach(id => {
    const a = byId(id);
    for (let lv = 1; lv <= 99; lv++) ok(M.tcgArtiPow(a, lv) <= 1 + 1e-9, id + ' revived past 100% HP at Lv' + lv);
  });
  ok(M.tcgArtiPow(byId('ankh'), 99) >= M.tcgArtiPow(byId('ankh'), 1), 'and it still climbs');
});

// ---- what the student is told ----------------------------------------------
test('the blurb shows the numbers the artifact actually has now', () => {
  const a = byId('pin');            // "Defence +8%"
  eq(M.tcgArtiBlurb(a, 1), a.blurb, 'Lv1 reads exactly as written');
  const top = M.tcgArtiBlurb(a, 99);
  ok(top !== a.blurb, 'a levelled artifact must not still claim its Lv1 figure');
  ok(top.indexOf(Math.round(M.tcgArtiPow(a, 99) * 100) + '%') >= 0, 'and must state the current one: ' + top);
});

test('no blurb is left saying something untrue or broken', () => {
  M.TCG_ARTIFACTS.forEach(a => {
    [1, 40, 99].forEach(lv => {
      const t = M.tcgArtiBlurb(a, lv);
      ok(typeof t === 'string' && t.length > 10, a.id + ' Lv' + lv + ' has no blurb');
      ok(t.indexOf('undefined') < 0 && t.indexOf('NaN') < 0, a.id + ' Lv' + lv + ' blurb is broken: ' + t);
    });
  });
});

test('every artifact in the table has a kind the scaler understands', () => {
  const known = ['ward', 'battery', 'ember', 'phoenix'].concat(Object.keys(M.TCG_ARTI_CAP));
  M.TCG_ARTIFACTS.forEach(a => {
    const v = M.tcgArtiPow(a, 50);
    ok(typeof v === 'number' && isFinite(v), a.id + ' (' + a.kind + ') scaled to ' + v);
    // A kind with no cap and no special rule still scales — that is fine — but
    // it should be a deliberate choice, so flag anything unrecognised.
    ok(known.indexOf(a.kind) >= 0, a.id + ' has kind "' + a.kind + '" with no cap and no special rule');
  });
});

// ---- run -------------------------------------------------------------------
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name.indexOf(only) < 0) continue;
  try { c.fn(); pass++; console.log('  ok   ' + c.name); }
  catch (e) { fail++; console.log('  FAIL ' + c.name + '\n         ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
