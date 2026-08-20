import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const outDir = path.join(root, 'assets', 'realm-of-embers', 'manifests');
const imageExt = 'webp';

function assignmentExpression(name) {
  const marker = `const ${name} =`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Could not find ${marker}`);
  let i = start + marker.length;
  while (/\s/.test(source[i])) i++;
  const exprStart = i;
  let quote = '', escaped = false, lineComment = false, blockComment = false;
  let round = 0, square = 0, curly = 0;
  for (; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if ((ch === '/' && next === '/')) { lineComment = true; i++; continue; }
    if ((ch === '/' && next === '*')) { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(') round++; else if (ch === ')') round--;
    else if (ch === '[') square++; else if (ch === ']') square--;
    else if (ch === '{') curly++; else if (ch === '}') curly--;
    else if (ch === ';' && round === 0 && square === 0 && curly === 0) {
      return source.slice(exprStart, i);
    }
  }
  throw new Error(`Unterminated assignment for ${name}`);
}

function readConst(name) {
  return vm.runInNewContext(`(${assignmentExpression(name)})`, Object.create(null));
}

function slug(s) {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const elements = readConst('TCG_ELEMENTS');
const gen1 = readConst('TCG_GEN1');
const gen2 = readConst('TCG_GEN2');
const emojiWords = readConst('TCG_EM_WORD');
const palettes = readConst('TCG_ART_PALETTE');
const classLooks = readConst('TCG_CLASS_LOOK');
const heroes = readConst('DUEL_HEROES');

const tierMood = ['', 'small, cute and just starting out', 'small but scrappy and eager',
  'a confident mid-tier fighter', 'a battle-hardened veteran', 'a powerful elite boss',
  'an awe-inspiring legendary titan', 'a mythic, world-shaping god-tier being'];

const cards = [];
for (const stars of [1, 2, 3, 4, 5, 6, 7]) {
  for (const row of gen1[stars] || []) {
    const n = cards.length + 1;
    cards.push({ id: `c${String(n).padStart(3, '0')}`, name: row[0], em: row[1], element: row[2], skillId: row[3], skillName: row[4], stars, set: 'gen1', human: false });
  }
}
for (const stars of [1, 2, 3, 4, 5, 6, 7]) {
  for (const row of gen2[stars] || []) {
    const n = cards.length + 1;
    cards.push({ id: `c${String(n).padStart(3, '0')}`, name: row[0], em: row[1], element: row[2], skillId: row[3], skillName: row[4], stars, set: 'nd', human: true, cls: row[5] || 'warrior', sex: row[6] || 'male', art: row[7] || null });
  }
}

function cardPrompt(c) {
  const elementName = (elements[c.element]?.name || 'Elemental').toLowerCase();
  const common = [
    'Use case: stylized-concept',
    'Asset type: Realm of Embers collectible-card character art',
  ];
  if (c.human) {
    const person = c.sex === 'female' ? 'woman' : 'man';
    common.push(`Primary request: Original fantasy CHARACTER artwork for "${c.name}", ${classLooks[c.cls] || classLooks.warrior}. A ${c.stars >= 6 ? 'strikingly heroic ' : ''}human ${person}, ${elementName}-element, ${tierMood[c.stars]} (${c.stars} of 7 stars). This is a PERSON, not a monster or beast; noble and heroic, a hero a child would want on their card.`);
    if (c.art) common.push(`Character-specific direction: ${c.art}`);
  } else {
    common.push(`Primary request: Original fantasy monster artwork for "${c.name}", a ${elementName}-element creature whose base form is a ${emojiWords[c.em] || 'mythical beast'}, reimagined as ${tierMood[c.stars]} (${c.stars} of 7 stars).`);
  }
  common.push(
    `Element look: ${palettes[c.element] || 'vivid fantasy colors'}.`,
    `Signature move: "${c.skillName}"; let the pose and effects hint at it without written symbols.`,
    `Subject: exactly one ${c.human ? 'character' : 'creature'}; whole figure inside frame.`,
    'Style/medium: polished painterly digital illustration, rich saturated color, dramatic rim lighting and glowing elemental effects; match one coherent premium children\'s fantasy trading-card set. No anime, cel-shading, comic-book line art, photorealism, 3D render or pixel art.',
    'Composition/framing: square full-bleed illustration; heroic three-quarter view; centered and filling most of frame; atmospheric background scene matching the element.',
    `Constraints: no text, letters, numbers, signatures, watermark, card frame, border, banner or interface; exactly one ${c.human ? 'person' : 'creature'}; primary-school friendly; no blood, gore, frightening horror${c.human ? '; modest fully-covering clothing, robes or armor' : ''}.`
  );
  return common.join('\n');
}

function avatarPrompt(c) {
  return [
    'Use case: identity-preserve',
    'Asset type: Realm of Embers battle avatar sprite',
    `Input images: Image 1 is the identity and design reference for ${c.name}.`,
    `Primary request: Redraw the exact same ${c.human ? 'character' : 'creature'} from Image 1 as a battle avatar cutout. Preserve every identity-defining feature, colors, equipment and silhouette.`,
    `Subject: exactly one complete ${c.human ? 'character' : 'creature'}, dynamic three-quarter battle stance, facing slightly right, ready to use "${c.skillName}".`,
    'Style/medium: same polished painterly digital game-art style and lighting as Image 1.',
    'Composition/framing: square; full body entirely visible; centered; generous clean margin around every extremity; readable at 96 pixels.',
    'Background: genuinely transparent alpha background.',
    'Constraints: preserve identity and palette; no scenery, ground, floor, cast shadow, card frame, border, UI, text, letters, numbers, signature or watermark; no cropped extremities; child-friendly.'
  ].join('\n');
}

const phaseFrames = [
  ['charge', 5], ['fly', 3], ['hit', 3], ['blast', 4]
];
const attack = Object.keys(elements).map(element => ({
  element,
  name: elements[element].name,
  frames: phaseFrames.flatMap(([phase, count]) => Array.from({ length: count }, (_, i) => ({
    slot: `fx:${element}:${phase === 'charge' ? '' : phase}${i + 1}`,
    phase,
    frame: i + 1,
    file: `attack-animation/${element}/${phase}-${String(i + 1).padStart(2, '0')}.${imageExt}`
  }))),
  sourceSheet: { included: false, archivePath: `source-sheets/attack-animation/${element}/source-sheet.png` },
  prompt: [
    'Use case: stylized-concept',
    'Asset type: Realm of Embers elemental attack animation sprite sheet',
    `Primary request: a coherent 15-frame sprite sheet for one ${elements[element].name} projectile attack using ${palettes[element]}.`,
    'Sequence and grid: exactly 5 columns by 3 rows, read left-to-right then top-to-bottom. Frames 1-5 charge from tiny spark to fully charged sphere; frames 6-8 show a same-sized projectile flying right with a leftward trail loop; frames 9-11 show impact on an unseen target growing brighter; frames 12-15 show a large radial blast expanding and fading. No labels or numbers inside cells.',
    'Style/medium: polished painterly 2D game VFX, crisp silhouette, rich saturated elemental glow; all frames depict the same projectile design and viewpoint.',
    'Composition/framing: every cell square, equal-sized, aligned to a perfectly regular grid; effect centered with safe margins; no overlap across cell boundaries.',
    'Background: one perfectly flat pure magenta #FF00FF chroma-key color in every non-effect pixel.',
    'Constraints: no characters, scenery, ground, interface, text, letters, numbers, borders, checkerboard, watermark or shadow; no magenta in the effect itself.'
  ].join('\n')
}));

const packLooks = {
  bronze: 'compact bronze-foil booster packet with warm copper glow',
  silver: 'sleek silver-foil booster packet with cool white-blue glow',
  gold: 'premium gold-foil booster packet with brilliant amber glow'
};
const setLooks = {
  gen1: 'Primal Dominion original monster set: dark indigo center panel, elemental dragon crest, primal scale and claw motifs',
  nd: 'Lionheart Legion human-hero set: red-and-white heraldry, proud lion crest, knightly banner motifs'
};
const packs = [];
for (const set of ['gen1', 'nd']) for (const tier of ['bronze', 'silver', 'gold']) {
  packs.push({
    set, tier,
    sourceSheet: { included: false, archivePath: `source-sheets/pack-ripping/${set}/${tier}/source-sheet.png` },
    frames: Array.from({ length: 7 }, (_, i) => ({ slot: `pk:${set}:${tier}:${i + 1}`, frame: i + 1, file: `pack-ripping/${set}/${tier}/frame-${String(i + 1).padStart(2, '0')}.${imageExt}` })),
    prompt: [
      'Use case: stylized-concept',
      'Asset type: Realm of Embers booster-pack ripping animation sprite sheet',
      `Primary request: a coherent seven-frame tear-open animation for a ${packLooks[tier]}. Set identity: ${setLooks[set]}.`,
      'Sequence and grid: exactly 4 columns by 2 rows, read left-to-right then top-to-bottom. Cell 1 sealed pack; cell 2 top seam under tension; cell 3 first tear; cell 4 tear widening with foil curling; cell 5 pack bursting open with light; cell 6 cards have left, wrapper collapsing; cell 7 empty torn wrapper; cell 8 completely blank chroma background. No labels or numbers.',
      'Style/medium: premium painterly 2D game animation; identical packet design, scale and camera across frames; foil texture and tier glow consistent.',
      'Composition/framing: every cell square and equal-sized on a perfectly regular grid; packet centered with safe margins; no overlap across cells.',
      `Background: one perfectly flat pure ${set === 'nd' ? 'green #00FF00' : 'magenta #FF00FF'} chroma-key color in every non-packet pixel.`,
      `Constraints: no hands, people, characters, scenery, floor, table, interface, text, letters, numbers, borders, checkerboard or watermark; no ${set === 'nd' ? 'green' : 'magenta'} in packet or glow.`
    ].join('\n')
  });
}

const heroAssets = heroes.map(h => ({
  id: h.id,
  slot: `hero:${h.id}`,
  name: h.name,
  file: `heroes/${h.id}-${slug(h.name)}.${imageExt}`,
  prompt: [
    'Use case: stylized-concept',
    'Asset type: Realm of Embers duel hero portrait',
    `Primary request: a single fantasy hero portrait for "${h.name}", ${h.title}: ${h.look}.`,
    `Power flavor: ${h.power.name} — ${h.power.text}; imply this visually without words, symbols or diagrams.`,
    'Subject: exactly one character alone, facing viewer at a slight three-quarter angle, waist up, centered, head and shoulders readable at 48 pixels.',
    'Style/medium: polished painterly digital game art, rich saturated color and dramatic rim lighting; heroic, warm, friendly, matching the Realm of Embers card set.',
    'Composition/framing: square with clear margin around hero; no other people, creatures or scenery.',
    'Background: genuinely transparent alpha background.',
    'Constraints: no text, letters, numbers, readable runes, labels, signature, watermark, card frame, banner or UI; no weapon pointed at viewer; child-friendly; nothing gruesome, frightening or revealing.'
  ].join('\n')
}));

const manifest = {
  schema: 1,
  source: 'app.js',
  counts: { cards: cards.length, cardArt: cards.length, battleAvatars: cards.length, heroes: heroAssets.length, packFrames: packs.reduce((n, p) => n + p.frames.length, 0), attackFrames: attack.reduce((n, a) => n + a.frames.length, 0), totalFiles: cards.length * 2 + heroAssets.length + packs.reduce((n, p) => n + p.frames.length, 0) + attack.reduce((n, a) => n + a.frames.length, 0) },
  cards: cards.map(c => ({ ...c, slug: slug(c.name), cardSlot: c.id, avatarSlot: `${c.id}:av`, cardFile: `card-art/${c.id}-${slug(c.name)}.${imageExt}`, avatarFile: `battle-avatars/${c.id}-${slug(c.name)}.${imageExt}`, cardPrompt: cardPrompt(c), avatarPrompt: avatarPrompt(c) })),
  heroes: heroAssets,
  packs,
  attack
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'asset-prompts.jsonl'), [
  ...manifest.cards.flatMap(c => [{ type: 'card-art', slot: c.cardSlot, file: c.cardFile, prompt: c.cardPrompt }, { type: 'battle-avatar', slot: c.avatarSlot, file: c.avatarFile, prompt: c.avatarPrompt, reference: c.cardFile }]),
  ...manifest.heroes.map(h => ({ type: 'hero', slot: h.slot, file: h.file, prompt: h.prompt })),
  ...manifest.packs.map(p => ({ type: 'pack-sheet', set: p.set, tier: p.tier, sourceSheet: p.sourceSheet, prompt: p.prompt, frames: p.frames })),
  ...manifest.attack.map(a => ({ type: 'attack-sheet', element: a.element, sourceSheet: a.sourceSheet, prompt: a.prompt, frames: a.frames }))
].map(x => JSON.stringify(x)).join('\n') + '\n');

const slotMap = Object.fromEntries([
  ...manifest.cards.flatMap(c => [[c.cardSlot, c.cardFile], [c.avatarSlot, c.avatarFile]]),
  ...manifest.heroes.map(h => [h.slot, h.file]),
  ...manifest.packs.flatMap(p => p.frames.map(f => [f.slot, f.file])),
  ...manifest.attack.flatMap(a => a.frames.map(f => [f.slot, f.file]))
]);
fs.writeFileSync(path.join(outDir, 'slot-map.json'), JSON.stringify({
  schema: 1,
  game: 'realm-of-embers',
  count: Object.keys(slotMap).length,
  slots: slotMap
}, null, 2) + '\n');

console.log(JSON.stringify(manifest));
