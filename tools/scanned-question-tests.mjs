// Regression tests for 📷 A QUESTION THAT CAME OFF A PHOTOGRAPH.
// Run with:  node tools/scanned-question-tests.mjs
//
// The Scan app (`polymathlc/scan`) writes straight into this app's vetting
// list, and one word — `source: 'scan'` — is the whole contract between two
// repositories that cannot see each other. Every way this goes wrong is
// silent, and the damage lands on a question a class then sits:
//
//  • THE WORD ITSELF. Rename the value and the card still arrives, still
//    renders and still approves — it simply stops being purple and stops
//    saying where it came from. Nothing throws on either side.
//  • ONE PREDICATE, TWO CONSUMERS. The outline and the badge must read the
//    same test, or a card is purple with no badge (which reads as a styling
//    bug) or badged with no outline (which is the warning made invisible).
//  • THE RANKING. Three outlines compete for one border. A possible duplicate
//    has to win over "this came off a photograph", which in turn has to win
//    over "this is new" — and a card ticked for deletion outranks all three,
//    or the author cannot see what they are about to delete.
//  • IT MUST BE LOUD. A scanned question has no diagram and no topic. Shown
//    like every other draft it is approved at the same speed as one somebody
//    typed and checked, and reaches the bank with a figure missing.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from.slice(0, 40) + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

// The REAL block, run as itself.
const block = cut(
  '// 📷 A QUESTION THAT CAME OFF A PHOTOGRAPH',
  'function renderVettingList() {',
  'scanned-question block');
const api = new Function(block + `
  return { SCANNED_SOURCE, _vetIsScanned, SCANNED_CARD_BORDER, SCANNED_CARD_BADGE };
`)();

// The renderer, read as text: it is far too entangled with the page to run,
// and what has to hold here is which predicate it asks and in what order.
const render = cut('function renderVettingList() {', '\nfunction _vetFocusScroll', 'renderVettingList');

let fails = 0, ran = 0;
function ok(name, cond, extra) {
  ran++;
  if (cond) return;
  fails++;
  console.error('FAIL: ' + name + (extra ? '\n      ' + extra : ''));
}

/* ---------- The contract word ---------- */
ok("the field's value is the word the Scan app writes", api.SCANNED_SOURCE === 'scan');
ok('a scanned question is recognised', api._vetIsScanned({ source: 'scan' }) === true);
ok('an ordinary hand-typed draft is not', api._vetIsScanned({ title: 'x' }) === false);
ok('another app’s source is not', api._vetIsScanned({ source: 'rapid' }) === false);
ok('nothing at all is not', api._vetIsScanned(null) === false && api._vetIsScanned(undefined) === false);

/* ---------- One predicate, two consumers ---------- */
ok('the renderer asks the predicate rather than the field',
   /const scanned = _vetIsScanned\(q\)/.test(render));
ok('the outline reads it', /scanned \? SCANNED_CARD_BORDER/.test(render));
ok('the badge reads it too', /\$\{scanned \? SCANNED_CARD_BADGE : ''\}/.test(render));

/* ---------- The ranking ---------- */
const border = render.slice(render.indexOf('const restBorder'), render.indexOf('const cardStyle'));
ok('a possible duplicate is still the first thing to look at',
   border.indexOf('dup ?') < border.indexOf('scanned ?'), border);
ok('where it came from beats merely being new',
   border.indexOf('scanned ?') < border.indexOf('isNew ?'), border);
ok('a card ticked for deletion outranks all three',
   /const cardStyle = picked \? .+ : restBorder;/.test(render));

/* ---------- It must be loud ---------- */
ok('the outline is purple', /#a855f7/.test(api.SCANNED_CARD_BORDER));
ok('the badge is purple too', /#f3e8ff/.test(api.SCANNED_CARD_BADGE) && /#7e22ce/.test(api.SCANNED_CARD_BADGE));
ok('the badge says which app it came from', /Scan app/.test(api.SCANNED_CARD_BADGE));
ok('…and what still has to be done to it before it is approved',
   /diagram/i.test(api.SCANNED_CARD_BADGE) && /topic/i.test(api.SCANNED_CARD_BADGE));

console.log((fails ? '✗ ' : '✓ ') + (ran - fails) + '/' + ran + ' checks passed');
process.exit(fails ? 1 : 0);
