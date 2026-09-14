import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
export const moduleNames = ['rpg-svg-art.js', 'rpg-hero-svg.js', 'spire-svg-art.js'];
export function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Production section exists: ${start}`);
  return source.slice(a, b);
}
// Only storage is replaced; the catalogue, upgrade thresholds, gender resolver,
// paper-doll compositor and icon renderer below are the production functions.
export const rendererSource = `
let rpgState = {gender:'male',equipment:{},inventory:{},upgrades:{},gold:321};
let _rpgArt = {_character:'https://invalid.test/old.png',_character_female:'https://invalid.test/female.png',wood_sword:'https://invalid.test/sword.png'};
${section(app, 'function escapeHtml(str) {', '// Escape a text block')}
${section(app, 'const RPG_SLOT_META =', '// ---- Enemy catalog')}
${section(app, 'const RPG_PET_EVO =', '// ---- Item affixes:')}
${app.match(/const RPG_UPGRADE_MAX = [^;]+;/)[0]}
${section(app, 'function rpgUpgradeLevel(', 'function rpgUpgradeCost(')}
${section(app, 'function rpgItemImageUrl()', '// ---- Codex: bestiary')}
globalThis.fixture = {
  items:RPG_ITEMS, byId:RPG_ITEMS_BY_ID, slots:RPG_SLOT_META,
  avatar:rpgAvatarSvg, icon:rpgItemIconSvg, item:rpgItemArt,
  gender:rpgHeroGender, petStage:rpgPetStage, petName:rpgPetDisplayName,
  itemImage:rpgItemImageUrl, characterImage:rpgCharacterArtUrl,
  setState(next){rpgState=next;}, state(){return rpgState;},
  setOverrides(next){_rpgArt=next;}
};`;
export function loadRenderer() {
  const document = {
    createTextNode(value) { return {value:String(value)}; },
    createElement() { return {innerHTML:'',appendChild(node){this.innerHTML=node.value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}}; }
  };
  const context = vm.createContext({ console, document });
  for (const file of moduleNames) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  vm.runInContext(rendererSource, context, { filename: 'production-avatar-fixture.js' });
  return context;
}
export function validateFragment(svg, allIds = new Set()) {
  assert.doesNotMatch(svg, /<(?:image|img|text|script|foreignObject)\b/i, 'avatar art must remain vector-only');
  assert.doesNotMatch(svg.replace(/aria-label="[^"]*"/g, ''), /undefined|NaN|Infinity/, 'SVG geometry must remain finite');
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]);
  for (const ref of refs) assert.ok(ids.includes(ref), `Paint reference ${ref} resolves in this SVG`);
  for (const id of ids) { assert.ok(!allIds.has(id), `Definition ${id} must not collide with another avatar`); allIds.add(id); }
  return svg;
}
export const sampleSets = [
  {name:'Explorer',gender:'male',equipment:{}},
  {name:'Explorer',gender:'female',equipment:{}},
  {name:'Knight',gender:'male',equipment:{weapon:'knight_sword',shield:'knight_shield',armor:'knight_plate',helmet:'knight_helm',accessory:'hero_cape',pet:'loyal_pup'}},
  {name:'Forest ranger',gender:'female',equipment:{weapon:'elven_blade',shield:'swift_buckler',armor:'emerald_scale',helmet:'adventurers_hood',accessory:'forest_cloak',pet:'owl_familiar'}},
  {name:'Dragonfire',gender:'male',equipment:{weapon:'dragon_blade',shield:'dragonscale_ward',armor:'dragon_plate',helmet:'dragonfang_helm',accessory:'dragon_wings',pet:'pocket_dragon'}},
  {name:'Celestial',gender:'female',equipment:{weapon:'celestial_edge',shield:'aurora_aegis',armor:'celestial_plate',helmet:'cosmos_crown',accessory:'wings_eternity',pet:'eternal_phoenix'}},
  {name:'Astral mage',gender:'female',equipment:{weapon:'starfire_staff',shield:'void_ward',armor:'phoenix_mantle',helmet:'astral_hat',accessory:'cosmos_amulet',pet:'astral_drake'}},
  {name:'Worldender',gender:'male',equipment:{weapon:'worldender',shield:'aegis_eternity',armor:'dawnforged_plate',helmet:'crown_infinity',accessory:'wings_dawn',pet:'cosmic_wyrm'}}
];
export function runChecks() {
  const context = loadRenderer(), f = context.fixture, allIds = new Set();
  assert.equal(f.items.length, 143);
  assert.equal(new Set(f.items.map(it => it.id)).size, 143);
  assert.deepEqual([...context.RpgSvgArt.ids].sort(), [...f.items.map(it => it.id)].sort(), 'every saved collectible gets authored art');
  // Stable IDs and all gameplay fields are covered, excluding the art function.
  const metadata = JSON.stringify(f.items.map(({ art, ...rest }) => rest));
  const digest = createHash('sha256').update(metadata).digest('hex');
  assert.equal(digest, '6628217ae91fadea2447ffda7e5d32f97d299f1f6a5a670c7173a69bcd64de4f', 'item identities, prices, requirements and bonuses remain compatible');
  const state = {gender:'female',equipment:{weapon:'wood_sword'},inventory:{wood_sword:1},upgrades:{},gold:321,petBond:{loyal_pup:40}};
  f.setState(state);
  const before = JSON.stringify(state);
  for (const it of f.items) {
    assert.equal(context.RpgSvgArt.profiles[it.id].slot, it.slot, it.id);
    validateFragment(f.icon(it), allIds);
    validateFragment(f.avatar({[it.slot]:it.id}, 'male'), allIds);
    validateFragment(f.avatar({[it.slot]:it.id}, 'female'), allIds);
    assert.equal(f.itemImage(it), '');
  }
  assert.equal(JSON.stringify(state), before, 'rendering never changes inventory, points, gender, upgrades or bonds');
  assert.equal(f.characterImage('female'), null, 'stored raster overrides cannot replace the vector body');
  for (const level of [0, 2, 3, 5, 6, 10]) {
    const expected = level >= 6 ? 2 : level >= 3 ? 1 : 0;
    for (const it of f.items.filter(it => it.slot === 'pet')) {
      f.setState({...state, upgrades:{[it.id]:level}});
      assert.equal(f.petStage(it), expected);
      for (const svg of [f.icon(it), f.avatar({pet:it.id}, 'female')]) {
        validateFragment(svg, allIds);
        assert.match(svg, new RegExp(`data-art-stage="${expected}"`));
      }
    }
  }
  f.setState(state);
  assert.equal(f.gender(undefined), 'female');
  assert.equal(f.gender('male'), 'male');
  assert.equal(f.gender('unknown'), 'male');
  assert.match(f.avatar({}, 'male'), /data-gender="male"/);
  assert.match(f.avatar({}, 'female'), /data-gender="female"/);
  for (const set of sampleSets) {
    for (const [slot,id] of Object.entries(set.equipment)) assert.equal(f.byId[id]?.slot, slot, `${set.name}: valid ${slot} item ${id}`);
    const svg = validateFragment(f.avatar(set.equipment, set.gender), allIds);
    assert.match(svg, /<circle cx="100" cy="78" r="34"/);
    assert.match(svg, /translate\(58,158\)/);
    assert.match(svg, /translate\(142,158\)/);
    const marks = ['data-hero-part="lower"','data-art-slot="armor"','data-hero-part="arms"','data-hero-part="head"','data-art-slot="helmet"'];
    const present = marks.map(mark => svg.indexOf(mark)).filter(at => at >= 0);
    assert.deepEqual([...present].sort((a,b) => a-b), present, 'clothes, armour, arms, face and helmet retain their layer order');
    if (set.equipment.accessory) {
      const itemAt = svg.indexOf('data-art-slot="accessory"');
      assert.equal(itemAt < svg.indexOf('data-hero-part="lower"'), f.byId[set.equipment.accessory].layer === 'back');
    }
    assert.match(svg, /class="av-anim-slash"/);
    assert.ok(svg.lastIndexOf('data-hero-part="grip"') > svg.lastIndexOf('data-art-slot="weapon"'), 'fingers hold the animated weapon');
  }
  assert.equal(f.item('weapon', {weapon:'missing_old_item'}), '', 'unknown saved items do not crash the avatar');
  assert.doesNotMatch(f.icon({...f.byId.wood_sword, name:'"><script>alert(1)</script>'}), /<script>/);
  assert.match(f.icon({...f.byId.wood_sword, name:'A "quoted" blade'}), /aria-label="A &quot;quoted&quot; blade"/, 'quoted names cannot break out of an SVG attribute');
  const appPosition = html.search(/type="module" src="app\.js(?:\?[^\"]*)?"/);
  assert.ok(appPosition >= 0, 'The application module is present');
  for (const name of moduleNames) assert.ok(html.indexOf(name) < appPosition, `${name} loads before its consumers`);
  assert.match(app, /rpgAvatarSvg\(r\.equipment \|\| \{\}, r\.gender\)/, 'leaderboard uses owner gender');
  assert.match(app, /rpgAvatarSvg\(row\.equipment \|\| \{\}, row\.gender\)/, 'arena uses owner gender');
  console.log(`rpg-avatar-art-tests: 143 collectible IDs, every pet stage, both genders, equipment layers and ${allIds.size} unique paint definitions OK`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runChecks();
