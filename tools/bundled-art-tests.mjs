// Regression tests for THE BUNDLED REALM OF EMBERS ART — the layer that puts
// the art shipped in assets/realm-of-embers/ on the screen for any slot no
// admin has overridden. Run with: node tools/bundled-art-tests.mjs
//
// It loads the REAL path builder out of app.js and walks every slot the
// repository ships a picture for, checking each derived path against BOTH the
// shipped slot map and the file actually on disk.
//
// Every failure here is silent in the app and expensive: a path that misses is
// an <img> that 404s and a monster that falls back to its emoji — no error,
// nothing in the console a student could report, and 201 cards that look like
// the game was never finished. The commonest way it happens is a rename: the
// card file is its id plus the slug of its own NAME, so editing a name in
// TCG_GEN1 moves the picture out from under it. That is the trade the derived
// paths make, and this is the half of the trade that has to be loud.
import fs from 'fs';
import path from 'path';
import url from 'url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ART = path.join(ROOT, 'assets', 'realm-of-embers');
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const grab = sig => { const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0; const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } } };
const slice = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const pieces = [
  slice('const TCG_ELEMENTS = {', '// One special skill per monster'),
  slice('const TCG_SETS = {', 'function tcgSetOf'),
  slice("const TCG_ART_ROOT = 'assets/realm-of-embers/';", 'function tcgBundledArtPath'),
  grab('function tcgBundledArtPath'),
  // The dex itself, so the slug really is built from the shipping card names.
  slice('const TCG_GEN1 = ', '// The sets, for the headings and the pack copy.'),
  slice('const TCG_ARTIFACTS = ', 'function tcgArtifactById'),
  slice('const _tcgBundledUrl = {};', 'function tcgArtRefresh'),
  grab('function tcgFxSlotId'), grab('function tcgPackSlotId'), grab('function tcgHeroSlotId'),
  grab('function tcgArtifactSlotId'), grab('function tcgArtifactArtUrl')
].join('\n');
// The absolute-URL step wants a page to resolve against; app.js reads it at
// call time precisely so it can be one.
global.location = { href: 'https://polymathlc.github.io/cer/index.html' };
const M = new Function('_tcgArt',
  pieces + '\nreturn {tcgBundledArtPath,tcgBundledArt,tcgSlotArt,tcgSlotHasArt,TCG_CARDS,TCG_ARTIFACTS,tcgFxSlotId,tcgPackSlotId,tcgHeroSlotId,tcgArtifactSlotId,tcgArtifactArtUrl};')(
  { 'c001': 'https://example.test/an-admin-drew-this.png', 'arti:bud': 'https://example.test/admin-spring-bud.png' });

const map = JSON.parse(fs.readFileSync(path.join(ART, 'manifests', 'slot-map.json'), 'utf8'));
const slots = map.slots;

let pass = 0; const fails = [];
const ok = (name, cond, why) => { if (cond) pass++; else fails.push(name + (why ? ' — ' + why : '')); };

// 1. Every slot the repository ships is derived to exactly the file it ships.
for (const id of Object.keys(slots)) {
  const got = M.tcgBundledArtPath(id);
  const want = 'assets/realm-of-embers/' + slots[id];
  ok('slot-map ' + id, got === want, 'derived ' + (got || '(nothing)') + ', map says ' + want);
}
// 2. …and that file is really there. The map and the checkout can disagree.
for (const id of Object.keys(slots)) {
  ok('on disk ' + id, fs.existsSync(path.join(ROOT, M.tcgBundledArtPath(id) || 'nope')), slots[id] + ' is missing');
}
// 3. The other direction: every card in the dex is covered, both slots. A card
//    added to a set with no picture drawn for it is the one case the map above
//    cannot catch, because the map is what was drawn LAST time.
ok('dex size', M.TCG_CARDS.length === 201, 'the dex holds ' + M.TCG_CARDS.length + ' cards, the shipped art covers 201');
M.TCG_CARDS.forEach(c => {
  ok('card ' + c.id, !!slots[c.id] && M.tcgBundledArtPath(c.id) === 'assets/realm-of-embers/' + slots[c.id], c.name + ' has no bundled card art');
  ok('avatar ' + c.id, !!slots[c.id + ':av'], c.name + ' has no bundled battle avatar');
});
// 4. A slot the repository ships NOTHING for must derive to nothing, never to a
//    plausible-looking path that 404s. Those are the admin-drawn families.
['arti:nosuch', 'logo:realm', 'set:gen1', 'lore:one:c1', 'dfx:sweep:flame:1', '', 'c999', 'hero:nobody', 'fx:nosuch:1', 'pk:nosuch:gold:1']
  .forEach(id => ok('no bundle for ' + (id || '(empty)'), M.tcgBundledArtPath(id) === '', 'derived ' + M.tcgBundledArtPath(id)));
// 5. The slot ids the app BUILDS at runtime are the ones the map is keyed on.
//    A change to tcgFxSlotId's shape would leave every effect frame unfound.
ok('fx slot shape', M.tcgBundledArtPath(M.tcgFxSlotId('flame', '', 4)) === 'assets/realm-of-embers/attack-animation/flame/charge-04.webp');
ok('fx fly shape', M.tcgBundledArtPath(M.tcgFxSlotId('cosmic', 'fly', 2)) === 'assets/realm-of-embers/attack-animation/cosmic/fly-02.webp');
ok('pack slot shape', M.tcgBundledArtPath(M.tcgPackSlotId('nd', 'gold', 7)) === 'assets/realm-of-embers/pack-ripping/nd/gold/frame-07.webp');
ok('hero slot shape', M.tcgBundledArtPath(M.tcgHeroSlotId('warden')) === 'assets/realm-of-embers/heroes/warden-warden-elowen.webp');
ok('artifact slot shape', M.tcgBundledArtPath(M.tcgArtifactSlotId('bud')) === 'assets/realm-of-embers/artifacts/bud-spring-bud.webp');
// 6. The paths become absolute URLs against the page — which is what makes the
//    four portals' shared 'sibling folders on one host' layout work, and what
//    lets Touch up read the pixels back without a CORS argument.
ok('absolute versioned url', M.tcgBundledArt('c001') === 'https://polymathlc.github.io/cer/assets/realm-of-embers/card-art/c001-pyrrik-the-cinderwhelp.webp?v=20260821-artifacts-packs',
   'got ' + M.tcgBundledArt('c001'));
ok('no url for an unbundled slot', M.tcgBundledArt('logo:realm') === '');
// 7. AN OVERRIDE ALWAYS WINS. This is the whole contract: the bundled layer is
//    a floor, never a ceiling, or an admin's redrawn picture is invisible and
//    nothing on any screen says why.
ok('override beats the bundle', M.tcgSlotArt('c001') === 'https://example.test/an-admin-drew-this.png');
ok('the bundle fills a slot with no override', M.tcgSlotArt('c002') === M.tcgBundledArt('c002'));
ok('the bundle fills an artifact slot', M.tcgSlotArt('arti:sunchip') === M.tcgBundledArt('arti:sunchip'));
ok('artifact reveal reads the bundled layer', M.tcgArtifactArtUrl('sunchip') === M.tcgBundledArt('arti:sunchip'));
ok('artifact reveal keeps an admin override', M.tcgArtifactArtUrl('bud') === 'https://example.test/admin-spring-bud.png');
ok('a slot with neither is empty, not undefined', M.tcgSlotArt('logo:realm') === '');
ok('hasArt is true for a bundled slot', M.tcgSlotHasArt('fx:frost:blast4') === true);
ok('hasArt is false for an unbundled one', M.tcgSlotHasArt('dfx:sweep:flame:1') === false);

// 8. The count the app is built around.
ok('shipped count', Object.keys(slots).length === 659, Object.keys(slots).length + ' slots in the map');

console.log(fails.length ? '✗ ' + fails.length + ' failed, ' + pass + ' passed' : '✓ all ' + pass + ' bundled-art checks passed');
fails.slice(0, 30).forEach(f => console.log('   ' + f));
if (fails.length > 30) console.log('   …and ' + (fails.length - 30) + ' more');
process.exit(fails.length ? 1 : 0);
