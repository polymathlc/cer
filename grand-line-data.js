/* Original fan-game rules; names and power themes are anchored to official character profiles. */
export const VERSION = '3.4.0';
// Retired collection IDs migrate to these current cards; future seven-star
// editions use separate IDs, so replaying an old receipt never grants a new legend.
export const RETIRED_CHARACTER_REPLACEMENTS = {
  shanks: 'wyper', blackbeard: 'kaku', bigmom: 'wapol', kizaru: 'hina',
  sengoku: 'paulie', garp: 'donkrieg', mihawk: 'hatchan', hancock: 'kalifa',
  ace: 'bellamy', sabo: 'gin', law: 'mr3', king: 'kuro',
};
export const FUTURE_EXPANSION_CHARACTERS = [
  { id: 'shanks', name: 'Shanks', stars: 7 },
  { id: 'blackbeard', name: 'Marshall D. Teach', stars: 7 },
  { id: 'kizaru', name: 'Admiral Kizaru', stars: 7 },
  { id: 'sengoku', name: 'Sengoku', stars: 7 },
  { id: 'mihawk', name: 'Dracule Mihawk', stars: 7 },
  { id: 'hancock', name: 'Boa Hancock', stars: 7 },
  { id: 'ace', name: 'Portgas D. Ace', stars: 7 },
  { id: 'law', name: 'Trafalgar Law', stars: 7 },
  { id: 'king', name: 'King', stars: 7 },
];
export const STARTER_IDS = ['luffy', 'zoro', 'nami', 'usopp', 'chopper'];
export const MAX_CREW_SIZE = 7;
export const PACK_ODDS = [
  { stars: 1, probability: 0.40 }, { stars: 2, probability: 0.30 },
  { stars: 3, probability: 0.17 }, { stars: 4, probability: 0.08 },
  { stars: 5, probability: 0.035 }, { stars: 6, probability: 0.012 }, { stars: 7, probability: 0.003 },
];
export const LORE_SOURCES = [
  { title: 'Official ONE PIECE character directory', url: 'https://one-piece.com/character/index.html' },
  { title: 'Official Straw Hat profiles', url: 'https://www.bandainamcoent.com/news/one-piece-odyssey-straw-hat-crew' },
  { title: 'Kaido: Azure Dragon Zoan', url: 'https://one-piece.com/character/Kaido/index.html' },
  { title: 'Whitebeard: Tremor-Tremor power', url: 'https://one-piece.com/character/edward_newgate/index.html' },
  { title: 'Sakazuki: magma power', url: 'https://one-piece.com/character/Sakazuki/index.html' },
  { title: 'Yamato: mythical guardian wolf and club', url: 'https://one-piece.com/character/YAMATO/' },
  { title: 'Marco: regenerating phoenix', url: 'https://one-piece.com/character/marco/index.html' },
  { title: 'Brook: soul, music and freezing swordplay', url: 'https://one-piece.com/character/brook/index.html' },
  { title: 'Galdino: wax for offense and defense', url: 'https://one-piece.com/character/Galdino/index.html' },
  { title: 'Koby: Marine training and Observation Haki', url: 'https://one-piece.com/character/Coby/index.html' },
  { title: 'Fujitora: gravity', url: 'https://one-piece.com/character/fujitora/index.html' },
  { title: 'Ryokugyu: forest power', url: 'https://one-piece.com/character/Aramaki/index.html' },
  { title: 'Enel: lightning powers', url: 'https://www.bandainamcoent.com/news/one-piece-pirate-warriors-4-special-new-dlc-adds-three-characters' },
  { title: 'Wyper: Shandian warrior', url: 'https://one-piece.com/character/Wyper/index.html' },
  { title: 'Kaku: giraffe transformation and four-sword fighting', url: 'https://one-piece.com/character/Kaku/index.html' },
  { title: 'Wapol: Munch-Munch assimilation and factory', url: 'https://one-piece.com/character/Wapol/index.html' },
  { title: 'Hina: iron restraints', url: 'https://one-piece.com/character/Hina/index.html' },
  { title: 'Paulie: Galley-La shipwright', url: 'https://one-piece.com/character/Paulie/index.html' },
  { title: 'Don Krieg: concealed weapons', url: 'https://one-piece.com/character/Don_Krieg/index.html' },
  { title: 'Hatchan: octopus fish-man and six swords', url: 'https://one-piece.com/character/Hacchan/index.html' },
  { title: 'Kalifa: soap powers and Cipher Pol', url: 'https://one-piece.com/character/Kalifa/index.html' },
  { title: 'Wyper: Burn Bazooka', url: 'https://one-piece.com/anime/171/index.html' },
  { title: 'Wyper: Reject Dial', url: 'https://one-piece.com/anime/169/index.html' },
  { title: 'Paulie: rope fighting', url: 'https://one-piece.com/anime/232/index.html' },
  { title: 'Bellamy: Spring-Spring Fruit', url: 'https://one-piece.com/character/bellamy/index.html' },
  { title: 'Gin: Krieg Pirates combat commander', url: 'https://one-piece.com/character/Gin/index.html' },
  { title: 'Kuro: Black Cat captain and strategist', url: 'https://one-piece.com/character/Kuro/index.html' },
  { title: 'Bellamy: Spring Hopper', url: 'https://one-piece.com/greg/o20150204_0347/index.html' },
  { title: 'Mr. 3: Candle Set and distinctive hair', url: 'https://one-piece.com/news/o20210423_12417/index.html' },
  { title: 'Kuro: Shakushi slashing technique', url: 'https://one-piece.com/news/o20181210_8267/index.html' },
  { title: 'Gin: iron-ball tonfa break through a shield', url: 'https://one-piece.com/anime/27/index.html' },
  { title: 'Kuro: bladed gloves and Shakushi', url: 'https://one-piece.com/anime/16/index.html' },
  { title: 'Garp: Galaxy Impact', url: 'https://optc-ww.channel.or.jp/news/562/' },
  { title: 'Sabo: flame-coated Dragon Claw Fist', url: 'https://one-piece.com/anime/o2851/index.html' },
  { title: 'Big Mom: Ikoku Sovereignty', url: 'https://one-piece.com/anime/o4765/index.html' },
  { title: 'Big Mom: Emperor Sword Cognac', url: 'https://one-piece.com/anime/o4907/index.html' },
  { title: 'Rocks Pirates: former crew members', url: 'https://one-piece.com/character/Rocks_D_Xebec/index.html' },
  { title: 'Oden: Whitebeard and Roger crews', url: 'https://one-piece.com/greg/o20170222_0695/index.html' },
  { title: 'Big Mom: Misery combines flame and lightning', url: 'https://one-piece.com/anime/62293/index.html' },
  { title: 'Garp: Blue Hole', url: 'https://one-piece.com/anime/68212/index.html' },
  { title: 'Garp and Grus: fist shockwaves and clay golems', url: 'https://one-piece.com/anime/68048/index.html' },
  { title: 'Grus: Clay Web protects a Marine ship', url: 'https://one-piece.com/anime/69263/index.html' },
  { title: 'Morley: Push-Push Fruit', url: 'https://one-piece.com/character/Morley/index.html' },
];

const E = (type, amount = 0, duration = 0, extra = {}) => ({ type, amount, duration, ...extra });
const S = (name, target, power, kind, effects = [], cost, cooldown) => ({ name, target, power, kind, effects, cost, cooldown });
const P = (name, type, value, description) => ({ name, type, value, description });
const COLORS = { spring: '#eab26e', wax: '#f2ddb1', rubber: '#f5b45f', steel: '#a7e3c2', storm: '#e8cf6b', plant: '#8dd68e', fire: '#ff896b', medicine: '#f59cbd', bloom: '#d49ee6', machine: '#72cce6', soul: '#bfb1ff', water: '#65bdda', haki: '#f38293', ice: '#a1e6fa', magnet: '#b798ce', shell: '#a8d7e8', rope: '#d0af85', soap: '#e8b7db', sand: '#d9bd79', string: '#e991bf', smoke: '#bacbdb', light: '#f7e394', gravity: '#be9be4', dark: '#af94dd', mochi: '#debab6', dragon: '#97c5f8', poison: '#c394df', earth: '#dca986', spirit: '#bddb8b', electric: '#b1e5fc', venom: '#bb87d9', magma: '#ff7754' };
function describeSkill(skill, index) {
  const parts = [];
  if (skill.power) parts.push(`${Math.round(skill.power * 100)}% attack damage${skill.target === 'all-enemies' ? ' to every enemy' : ''}`);
  for (const e of skill.effects) {
    const recipients = e.scope === 'self' ? ' yourself' : e.scope === 'all-allies' ? ' the whole crew' : '';
    if (e.type === 'heal') parts.push(`heal${recipients} for ${Math.round(e.amount * 100)}% attack`);
    else if (e.type === 'shield') parts.push(`shield${recipients} for ${Math.round(e.amount * 100)}% attack`);
    else if (e.type === 'revive') parts.push(`revive a knocked-out ally at ${Math.round(e.amount * 100)}% health`);
    else if (e.type === 'cleanse') parts.push(`remove harmful effects${recipients}`);
    else if (e.type === 'energy') parts.push(`restore ${e.amount} Spirit${recipients}`);
    else if (e.type === 'drain') parts.push(`drain ${e.amount} enemy Spirit`);
    else if (e.type === 'lifesteal') parts.push(`heal for ${Math.round(e.amount * 100)}% damage dealt`);
    else if (e.type === 'pierce') parts.push('ignore defense');
    else parts.push(`${e.chance && e.chance < 1 ? `${Math.round(e.chance * 100)}% chance: ` : ''}${e.type.replaceAll('-', ' ')}${recipients} for ${e.duration} turn${e.duration === 1 ? '' : 's'}`);
  }
  if (index === 0) parts.push('restore 20 Spirit');
  return parts.map((p, i) => i ? p : p[0].toUpperCase() + p.slice(1)).join('; ') + '.';
}
function C(id, name, title, stars, role, element, description, passive, skills, source) {
  const color = id === 'marco' ? '#72def1' : COLORS[element] || '#d6c18b';
  return { id, name, title, stars, role, element, color, description, passive,
    source: source || LORE_SOURCES[0].url,
    skills: skills.map((skill, index) => ({ ...skill, id: `${id}-${index}`, animation: `${id}-${index}-${skill.kind}`,
      color, cost: skill.cost ?? [0, 30, 60][index], cooldown: skill.cooldown ?? [0, 2, 3][index],
      description: describeSkill(skill, index) })) };
}

export const CHARACTERS = [
  C('luffy', 'Monkey D. Luffy', 'Captain of the Straw Hats', 6, 'Striker', 'rubber', 'Rubber limbs, fearless Haki and a liberating fighting spirit.',
    P('Never Give Up', 'stubborn', 0.12, 'Once per battle, survive a lethal blow with 12% health.'), [
      S('Gum-Gum Pistol', 'enemy', 1.05, 'punch'),
      S('Gum-Gum Gatling', 'enemy', 1.85, 'punch', [E('stun', 0, 1, { chance: 0.45 })]),
      S('Gear Five: Dawn', 'all-enemies', 1.4, 'punch', [E('attack-up', 0.25, 2, { scope: 'self' })]),
    ], 'https://one-piece.com/character/luffy/index.html'),
  C('zoro', 'Roronoa Zoro', 'Three-Sword Swordsman', 5, 'Striker', 'steel', 'Three blades and an unbending ambition to become the greatest swordsman.',
    P('Nothing Happened', 'low-health-defense', 0.3, 'Take 30% less damage while below half health.'), [
      S('Three-Sword Cut', 'enemy', 1.1, 'slash'),
      S('Onigiri', 'enemy', 1.9, 'slash', [E('pierce')]),
      S('Asura: Nine Swords', 'enemy', 2.65, 'slash', [E('weaken', 0.2, 2)]),
    ], 'https://one-piece.com/character/zoro/index.html'),
  C('nami', 'Nami', 'Navigator of Storms', 3, 'Controller', 'storm', 'A master navigator who turns weather science and her Clima-Tact into lightning.',
    P('Weather Sense', 'energy', 7, 'Recover 7 extra Spirit at the start of each turn.'), [
      S('Clima-Tact Strike', 'enemy', 0.9, 'lightning'),
      S('Thunderbolt Tempo', 'enemy', 1.45, 'lightning', [E('stun', 0, 1, { chance: 0.8 })]),
      S('Zeus Breeze Tempo', 'all-enemies', 1.45, 'lightning', [E('slow', 0.22, 2)]),
    ], 'https://one-piece.com/character/nami/index.html'),
  C('usopp', 'Usopp', 'Brave Warrior of the Sea', 2, 'Controller', 'plant', 'A sharpshooter whose Pop Greens turn a slingshot into a living arsenal.',
    P('Sniper’s Patience', 'crit', 0.14, 'Gain 14% additional critical chance.'), [
      S('Kabuto Snipe', 'enemy', 1.0, 'wind'),
      S('Skull Bombgrass', 'all-enemies', 1.05, 'explosion', [E('burn', 0.18, 2)]),
      S('Green Star: Impact Wolf', 'enemy', 2.25, 'plant', [E('stun', 0, 1)]),
    ]),
  C('sanji', 'Sanji', 'Black Leg Cook', 5, 'Striker', 'fire', 'A brilliant cook who reserves his hands for food and his burning kicks for battle.',
    P('A Cook’s Care', 'all-regen', 0.025, 'At each round’s start, restore 2.5% maximum health to every living ally.'), [
      S('Collier Kick', 'enemy', 1.05, 'fire'),
      S('Diable Jambe', 'enemy', 1.65, 'fire', [E('burn', 0.28, 2)]),
      S('Ifrit Jambe: Boeuf Burst', 'enemy', 2.6, 'fire', [E('burn', 0.35, 2)]),
    ]),
  C('chopper', 'Tony Tony Chopper', 'Doctor of the Crew', 2, 'Healer', 'medicine', 'A reindeer doctor whose Human-Human Fruit and Rumble Ball unlock multiple forms.',
    P('Medical Knowledge', 'healing', 0.25, 'Healing and revival restore 25% more health.'), [
      S('Heavy Point Punch', 'enemy', 0.9, 'punch'),
      S('Doctor’s Treatment', 'ally', 0, 'heal', [E('heal', 2.0), E('cleanse')], 25),
      S('Emergency Medicine', 'fallen-ally', 0, 'revive', [E('revive', 0.36)], 55),
    ]),
  C('robin', 'Nico Robin', 'Devil Child Archaeologist', 4, 'Controller', 'bloom', 'The Flower-Flower Fruit lets Robin sprout limbs and restrain enemies from unexpected angles.',
    P('Archaeologist’s Insight', 'debuff-duration', 1, 'The first harmful effect she applies each battle lasts one additional turn.'), [
      S('Clutch', 'enemy', 0.95, 'plant', [E('weaken', 0.1, 1)]),
      S('Mil Fleur: Gigantesco Mano', 'all-enemies', 1.1, 'punch', [E('slow', 0.2, 2)]),
      S('Demonio Fleur', 'enemy', 2.2, 'dark', [E('stun', 0, 1)]),
    ]),
  C('franky', 'Franky', 'Iron Man Shipwright', 4, 'Guardian', 'machine', 'Cola-powered cybernetics, built-in weapons and a very super battle machine.',
    P('Cyborg Armor', 'defense', 0.15, 'Take 15% less direct damage.'), [
      S('Strong Right', 'enemy', 1.0, 'punch'),
      S('Radical Beam', 'enemy', 1.9, 'light', [E('pierce')]),
      S('General Franky', 'all-enemies', 1.3, 'explosion', [E('shield', 1.8, 0, { scope: 'self' }), E('taunt', 0, 2, { scope: 'self' })]),
    ]),
  C('brook', 'Brook', 'Soul King', 4, 'Controller', 'soul', 'A revived musician whose cane sword carries the chill of the underworld.',
    P('Revive-Revive Soul', 'revive-self', 0.3, 'Once per battle, return from a knockout at 30% health.'), [
      S('Hanauta Sancho', 'enemy', 1.0, 'slash'),
      S('Soul Solid', 'enemy', 1.35, 'ice', [E('freeze', 0, 1)]),
      S('New World Symphony', 'all-allies', 0, 'soul', [E('attack-up', 0.25, 2), E('energy', 25)]),
    ], 'https://one-piece.com/character/brook/index.html'),
  C('jinbe', 'Jinbe', 'Knight of the Sea', 5, 'Guardian', 'water', 'Fish-Man Karate channels water through powerful, disciplined strikes.',
    P('Steady Helmsman', 'all-shield', 0.07, 'Every ally begins battle with a shield worth 7% of their maximum health.'), [
      S('Fish-Man Karate', 'enemy', 1.08, 'water'),
      S('Shark Brick Fist', 'enemy', 1.8, 'water', [E('pierce')]),
      S('Ocean Current Shoulder Throw', 'all-enemies', 1.35, 'water', [E('weaken', 0.22, 2)]),
    ]),
  C('wyper', 'Wyper', 'Shandian Battle Warrior', 4, 'Striker', 'shell', 'A resolute Shandian warrior who fights with a bazooka, blue-white flame and the dangerous Reject Dial.',
    P('Shandian Resolve', 'low-health-defense', 0.2, 'Take 20% less direct damage while below half health.'), [
      S('Bazooka Shot', 'enemy', 1.02, 'explosion'),
      S('Burn Bazooka', 'all-enemies', 1.1, 'fire', [E('burn', 0.2, 2)]),
      S('Reject Dial', 'enemy', 2.6, 'earth', [E('pierce'), E('weaken', 0.3, 1, { scope: 'self' })], 65),
    ]),
  C('bellamy', 'Bellamy', 'The Hyena', 3, 'Striker', 'spring', 'The Spring-Spring Fruit coils his limbs into springs for powerful punches and ricocheting rushes.',
    P('Gathering Momentum', 'focus', 0.035, 'Each attack raises damage by 3.5%, up to 21% per battle.'), [
      S('Spring Punch', 'enemy', 1.0, 'punch'),
      S('Spring Snipe', 'enemy', 1.7, 'punch', [E('stun', 0, 1, { chance: 0.4 })]),
      S('Spring Hopper', 'all-enemies', 1.45, 'punch', [E('weaken', 0.15, 2)]),
    ], 'https://one-piece.com/character/bellamy/index.html'),
  C('gin', 'Gin', 'Krieg’s Combat Commander', 2, 'Guardian', 'steel', 'The Krieg Pirates’ relentless combat commander fights at close range with two weighted iron-ball tonfa.',
    P('Unbroken Resolve', 'low-health-defense', 0.25, 'Take 25% less direct damage while below half health.'), [
      S('Twin Tonfa', 'enemy', 1.0, 'punch'),
      S('Iron-Ball Crush', 'enemy', 1.7, 'punch', [E('pierce')]),
      S('Spinning Tonfa', 'all-enemies', 1.35, 'punch', [E('stun', 0, 1, { chance: 0.35 })]),
    ], 'https://one-piece.com/character/Gin/index.html'),
  C('mr3', 'Galdino · Mr. 3', 'Waxwork Tactician', 3, 'Controller', 'wax', 'The Wax-Wax Fruit shapes hardened wax into weapons, protective walls and traps that immobilize enemies.',
    P('Hardened Wax', 'shield-start', 0.12, 'Begin battle with a shield worth 12% maximum health.'), [
      S('Wax Harpoon', 'enemy', 0.9, 'earth', [E('slow', 0.12, 1)]),
      S('Candle Wall', 'ally', 0, 'shield', [E('shield', 1.7), E('guard', 0.15, 2)], 25),
      S('Giant Candle Set', 'all-enemies', 1.05, 'earth', [E('slow', 0.3, 3), E('stun', 0, 1, { chance: 0.4 })]),
    ], 'https://one-piece.com/character/Galdino/index.html'),
  C('kid', 'Eustass Kid', 'Captain of Steel', 5, 'Striker', 'magnet', 'Magnetism assembles scrap metal into crushing mechanical weapons.',
    P('Scrap Collector', 'shield-on-hit', 0.12, 'After dealing direct damage, gain a shield worth 12% of attack.'), [
      S('Metal Arm', 'enemy', 1.08, 'magnet'),
      S('Punk Gibson', 'enemy', 1.85, 'magnet', [E('slow', 0.25, 2)]),
      S('Damned Punk', 'enemy', 2.7, 'light', [E('pierce')]),
    ]),
  C('killer', 'Killer', 'Massacre Soldier', 4, 'Striker', 'steel', 'Rotating Punisher blades and sonic attacks punish heavily armored targets.',
    P('Punisher Blades', 'pierce', 0.28, 'Ignore 28% of enemy defense.'), [
      S('Punisher Cut', 'enemy', 1.07, 'slash'),
      S('Sonic Scythe', 'enemy', 1.7, 'wind', [E('pierce')]),
      S('Sonic Blade Cyclone', 'all-enemies', 1.5, 'slash', [E('weaken', 0.15, 2)]),
    ]),
  C('kalifa', 'Kalifa', 'Cipher Pol Soap Agent', 3, 'Controller', 'soap', 'A Six Powers agent whose Bubble-Bubble Fruit washes away strength and leaves opponents slippery and helpless.',
    P('Slippery Soap', 'evade', 0.1, '10% chance to evade direct attacks.'), [
      S('Finger Pistol', 'enemy', 0.98, 'punch'),
      S('Bubble Master', 'enemy', 1.15, 'water', [E('weaken', 0.3, 2), E('drain', 15)]),
      S('Golden Hour', 'all-enemies', 0.95, 'water', [E('slow', 0.25, 2), E('stun', 0, 1, { chance: 0.45 })]),
    ]),
  C('hatchan', 'Hatchan', 'Six-Sword Octopus', 2, 'Striker', 'water', 'An octopus fish-man who wields six swords, sprays ink and later opens the Takoyaki 8 stand.',
    P('Six-Blade Guard', 'counter', 0.12, 'Counter direct hits for damage equal to 12% of attack.'), [
      S('Six-Sword Cut', 'enemy', 1.0, 'slash'),
      S('Octopus Black Ink', 'all-enemies', 0.7, 'water', [E('weaken', 0.22, 2)]),
      S('Six-Sword Waltz', 'enemy', 2.35, 'slash', [E('slow', 0.2, 2)]),
    ]),
  C('crocodile', 'Crocodile', 'Desert King', 5, 'Controller', 'sand', 'The Sand-Sand Fruit drains moisture while a hooked weapon delivers venom.',
    P('Desert Drain', 'lifesteal', 0.13, 'Recover health equal to 13% of direct damage dealt.'), [
      S('Golden Hook', 'enemy', 1.0, 'slash', [E('poison', 0.12, 2, { chance: 0.6 })]),
      S('Sables', 'all-enemies', 1.1, 'sand', [E('slow', 0.25, 2)]),
      S('Ground Death', 'all-enemies', 1.35, 'sand', [E('weaken', 0.25, 2), E('lifesteal', 0.2)]),
    ]),
  C('doflamingo', 'Donquixote Doflamingo', 'Heavenly Demon', 5, 'Controller', 'string', 'Razor-sharp strings bind, cut and reshape the battlefield.',
    P('Emergency Stitching', 'regen', 0.055, 'Restore 5.5% maximum health at the start of each turn.'), [
      S('Five Color Strings', 'enemy', 1.03, 'string'),
      S('Parasite', 'enemy', 1.15, 'string', [E('stun', 0, 1), E('weaken', 0.2, 2)]),
      S('Sixteen Holy Bullets', 'all-enemies', 1.6, 'string', [E('pierce')]),
    ], 'https://one-piece.com/character/doflamingo/index.html'),
  C('buggy', 'Buggy', 'The Star Clown', 2, 'Trickster', 'machine', 'Chop-Chop separation and outrageous explosives conceal an uncanny talent for survival.',
    P('Chop-Chop Escape', 'evade', 0.16, '16% chance to evade direct attacks.'), [
      S('Detached Knife', 'enemy', 0.95, 'slash'),
      S('Chop-Chop Festival', 'all-enemies', 1.0, 'wind', [E('weaken', 0.2, 1)]),
      S('Muggy Ball', 'enemy', 2.45, 'explosion', [E('burn', 0.18, 2)]),
    ]),
  C('smoker', 'Smoker', 'White Hunter', 3, 'Guardian', 'smoke', 'Billowing smoke and a seastone-tipped jitte trap fleeing pirates.',
    P('White Smoke', 'defense', 0.1, 'Take 10% less direct damage.'), [
      S('Jitte Strike', 'enemy', 1.0, 'punch'),
      S('White Out', 'enemy', 1.25, 'smoke', [E('stun', 0, 1)]),
      S('White Blow', 'all-enemies', 1.35, 'smoke', [E('weaken', 0.25, 2)]),
    ]),
  C('tashigi', 'Tashigi', 'Sword Collector', 2, 'Guardian', 'steel', 'A principled Marine swordswoman who studies celebrated blades.',
    P('Protect the Innocent', 'all-shield', 0.06, 'Every ally starts with a shield worth 6% maximum health.'), [
      S('Shigure Draw', 'enemy', 1.03, 'slash'),
      S('Crossguard', 'ally', 0, 'shield', [E('shield', 2.0), E('guard', 0.2, 2)]),
      S('Haki Blade Advance', 'enemy', 2.2, 'slash', [E('pierce')]),
    ]),
  C('koby', 'Koby', 'Hero of SWORD', 3, 'Guardian', 'haki', 'Training under Garp and awakened Observation Haki turn courage into strength.',
    P('Honest Courage', 'all-energy', 3, 'Every living ally recovers 3 extra Spirit at each round’s start.'), [
      S('Soru Strike', 'enemy', 1.03, 'punch'),
      S('Protective Resolve', 'self', 0, 'shield', [E('shield', 2.2), E('taunt', 0, 2)]),
      S('Honesty Impact', 'all-enemies', 1.7, 'earth', [E('weaken', 0.15, 2)]),
    ], 'https://one-piece.com/character/Coby/index.html'),
  C('donkrieg', 'Don Krieg', 'Armored Pirate Admiral', 3, 'Guardian', 'machine', 'A heavily armored fleet captain who hides firearms, an explosive battle spear and poison gas in his arsenal.',
    P('Wootz Steel Armor', 'defense', 0.12, 'Take 12% less direct damage.'), [
      S('Concealed Pistol', 'enemy', 1.0, 'explosion'),
      S('Great Battle Spear', 'enemy', 1.8, 'explosion', [E('burn', 0.2, 2)]),
      S('MH5 Poison Gas', 'all-enemies', 1.15, 'poison', [E('poison', 0.32, 3)], 60, 4),
    ]),
  C('paulie', 'Paulie', 'Galley-La Rope Rigger', 3, 'Guardian', 'rope', 'A Galley-La shipwright whose rope techniques bind opponents and pull crewmates out of danger.',
    P('Secure the Rigging', 'all-shield', 0.06, 'Every ally starts with a shield worth 6% maximum health.'), [
      S('Rope Strike', 'enemy', 0.95, 'string'),
      S('Dockyard Rescue', 'ally', 0, 'shield', [E('shield', 1.8), E('guard', 0.2, 2)], 25),
      S('Rope Action: Dock Bind', 'all-enemies', 1.1, 'string', [E('slow', 0.2, 2), E('stun', 0, 1, { chance: 0.5 })], 55),
    ]),
  C('hina', 'Hina', 'Black Cage Marine', 3, 'Controller', 'steel', 'The Bind-Bind Fruit lets this disciplined Marine pass through opponents and lock them inside iron restraints.',
    P('Black Cage Discipline', 'debuff-duration', 1, 'The first harmful effect she applies each battle lasts one additional turn.'), [
      S('Iron Bind', 'enemy', 0.9, 'string', [E('slow', 0.12, 1, { chance: 0.4 })]),
      S('Black Cage', 'enemy', 1.1, 'string', [E('stun', 0, 1)]),
      S('Iron-Bar Enclosure', 'all-enemies', 1.25, 'string', [E('weaken', 0.2, 2), E('slow', 0.2, 2)]),
    ]),
  C('aokiji', 'Kuzan', 'Aokiji of Ice', 6, 'Controller', 'ice', 'The Ice-Ice Fruit freezes seas and traps enemies in deep cold.',
    P('Ice Body', 'freeze-immune', 1, 'Immune to freeze.'), [
      S('Ice Saber', 'enemy', 1.02, 'ice'),
      S('Ice Time', 'enemy', 1.4, 'ice', [E('freeze', 0, 1)]),
      S('Ice Age', 'all-enemies', 1.25, 'ice', [E('freeze', 0, 1, { chance: 0.6 }), E('slow', 0.2, 2)]),
    ]),
  C('fujitora', 'Admiral Fujitora', 'Issho of Gravity', 6, 'Controller', 'gravity', 'A blind swordsman whose gravity power can press foes down and summon falling debris.',
    P('Humane Justice', 'all-guard', 0.06, 'The crew takes 6% less direct damage while Fujitora stands.'), [
      S('Gravity Blade', 'enemy', 1.04, 'slash'),
      S('Gravito: Raging Tiger', 'all-enemies', 1.1, 'gravity', [E('slow', 0.3, 2)]),
      S('Meteor Descent', 'all-enemies', 1.8, 'earth', [E('stun', 0, 1, { chance: 0.4 })]),
    ], 'https://one-piece.com/character/fujitora/index.html'),
  C('ryokugyu', 'Admiral Ryokugyu', 'Aramaki of the Forest', 6, 'Guardian', 'plant', 'The Woods-Woods Fruit grows roots and a towering forest body.',
    P('Forest Renewal', 'lifesteal', 0.18, 'Recover 18% of direct damage dealt.'), [
      S('Root Impale', 'enemy', 1.02, 'plant'),
      S('Nutrient Drain', 'enemy', 1.4, 'plant', [E('lifesteal', 0.6)]),
      S('Giant Forest Form', 'all-enemies', 1.4, 'plant', [E('shield', 2.0, 0, { scope: 'self' }), E('slow', 0.2, 2)]),
    ], 'https://one-piece.com/character/Aramaki/index.html'),
  C('kaku', 'Kaku', 'Giraffe of Cipher Pol', 4, 'Striker', 'steel', 'A giraffe Zoan agent who combines two swords with cutting Tempest Kicks for four-sword fighting.',
    P('Six Powers Footwork', 'speed', 0.08, 'Initiative speed is increased by 8%.'), [
      S('Four-Sword Cut', 'enemy', 1.05, 'slash'),
      S('Giraffe Neck Strike', 'enemy', 1.7, 'punch', [E('stun', 0, 1, { chance: 0.6 })]),
      S('Rankyaku: Amane Dachi', 'all-enemies', 1.5, 'wind', [E('pierce')]),
    ]),
  C('wapol', 'Wapol', 'Munch-Munch King', 2, 'Guardian', 'machine', 'The Munch-Munch Fruit lets the former Drum king absorb what he eats and combine it into new machinery.',
    P('Scrap Diet', 'shield-on-hit', 0.1, 'After dealing direct damage, gain a shield worth 10% of attack.'), [
      S('Munch-Munch Bite', 'enemy', 0.9, 'punch', [E('lifesteal', 0.1)]),
      S('Baku Baku Factory', 'self', 0, 'shield', [E('shield', 1.6), E('attack-up', 0.2, 2)], 25),
      S('Tongue Cannon', 'all-enemies', 1.35, 'explosion', [E('weaken', 0.15, 1)]),
    ]),
  C('katakuri', 'Charlotte Katakuri', 'Sweet Commander', 5, 'Striker', 'mochi', 'Mochi techniques and advanced Observation Haki anticipate the enemy’s next move.',
    P('Future Sight', 'evade', 0.18, '18% chance to evade direct attacks.'), [
      S('Mochi Punch', 'enemy', 1.07, 'punch'),
      S('Mochi Thrust', 'enemy', 1.8, 'punch', [E('slow', 0.25, 2)]),
      S('Buzz Cut Mochi', 'enemy', 2.6, 'punch', [E('stun', 0, 1, { chance: 0.7 })]),
    ]),
  C('yamato', 'Yamato', 'Guardian of Wano', 5, 'Guardian', 'ice', 'A mythical guardian wolf, freezing breath and a mighty kanabo protect Wano.',
    P('Mirror Mountain', 'shield-start', 0.25, 'Begin battle with a shield worth 25% maximum health.'), [
      S('Kanabo Strike', 'enemy', 1.06, 'punch'),
      S('Namuji Glacier Fang', 'enemy', 1.45, 'ice', [E('freeze', 0, 1)]),
      S('Divine Swiftness: White Serpent', 'enemy', 2.3, 'ice', [E('shield', 1.5, 0, { scope: 'self' })]),
    ], 'https://one-piece.com/character/YAMATO/'),
  C('marco', 'Marco', 'The Phoenix', 5, 'Healer', 'fire', 'Blue phoenix flames regenerate wounds and support allies.',
    P('Phoenix Regeneration', 'regen', 0.08, 'Restore 8% maximum health at the start of each turn.'), [
      S('Phoenix Talon', 'enemy', 0.97, 'fire'),
      S('Blue Flame Recovery', 'all-allies', 0, 'heal', [E('heal', 1.35), E('cleanse')], 35),
      S('Phoenix Rescue', 'fallen-ally', 0, 'revive', [E('revive', 0.5)], 60),
    ], 'https://one-piece.com/character/marco/index.html'),
  C('kuro', 'Captain Kuro', 'Of a Hundred Plans', 2, 'Trickster', 'steel', 'The Black Cat Pirates’ calculating former captain combines silent footwork with long Cat Claws blades.',
    P('Silent Footwork', 'speed', 0.18, 'Gain 18% speed, shortening the interval between automatic attacks.'), [
      S('Cat Claws', 'enemy', 1.0, 'slash'),
      S('Silent Step Cut', 'enemy', 1.55, 'slash', [], 25, 1),
      S('Shakushi', 'all-enemies', 1.65, 'slash', [E('weaken', 0.18, 2)]),
    ], 'https://one-piece.com/character/Kuro/index.html'),
  C('queen', 'Queen', 'The Plague', 5, 'Controller', 'machine', 'A brachiosaurus cyborg equipped with lasers and dangerous engineered toxins.',
    P('Mechanical Bulk', 'shield-start', 0.2, 'Begin battle with a shield worth 20% maximum health.'), [
      S('Brachio Slam', 'enemy', 1.08, 'earth'),
      S('Black Coffee Laser', 'enemy', 1.9, 'light'),
      S('Plague Barrage', 'all-enemies', 1.25, 'poison', [E('poison', 0.32, 3)]),
    ]),
  C('jack', 'Jack', 'The Drought', 4, 'Guardian', 'earth', 'An ancient mammoth form makes this Beast Pirate a relentless siege engine.',
    P('Mammoth Endurance', 'low-health-defense', 0.35, 'Take 35% less damage below half health.'), [
      S('Mammoth Swing', 'enemy', 1.08, 'punch'),
      S('Ancient Trample', 'all-enemies', 1.15, 'earth', [E('slow', 0.2, 2)]),
      S('Drought’s Advance', 'self', 0, 'shield', [E('shield', 3.0), E('taunt', 0, 3), E('attack-up', 0.3, 2)]),
    ], 'https://one-piece.com/character/Jack/index.html'),
  C('enel', 'Enel', 'Thunder of Skypiea', 4, 'Striker', 'storm', 'The Rumble-Rumble Fruit and Mantra turn lightning into a terrifying weapon.',
    P('Mantra', 'evade', 0.13, '13% chance to evade direct attacks.'), [
      S('El Thor', 'enemy', 1.0, 'lightning'),
      S('Thunder Dragon', 'enemy', 1.6, 'lightning', [E('stun', 0, 1, { chance: 0.75 })]),
      S('Raigo', 'all-enemies', 1.8, 'lightning'),
    ]),
  C('lucci', 'Rob Lucci', 'Leopard Assassin', 5, 'Striker', 'steel', 'A leopard Zoan and the Six Powers produce precise, devastating martial arts.',
    P('Predator’s Focus', 'focus', 0.04, 'Each attack raises damage by 4%, up to 24% per battle.'), [
      S('Finger Pistol', 'enemy', 1.1, 'punch'),
      S('Tempest Kick', 'all-enemies', 1.3, 'wind'),
      S('Six King Gun', 'enemy', 2.55, 'punch', [E('pierce'), E('weaken', 0.2, 2)]),
    ]),
  C('perona', 'Perona', 'Ghost Princess', 3, 'Controller', 'soul', 'Hollow-Hollow ghosts sap the enemy’s confidence and explode on command.',
    P('Ghostly Evasion', 'evade', 0.1, '10% chance to evade direct attacks.'), [
      S('Mini Hollow', 'enemy', 0.9, 'soul'),
      S('Negative Hollow', 'enemy', 0.8, 'soul', [E('weaken', 0.4, 2), E('stun', 0, 1, { chance: 0.5 })]),
      S('Special Hollow: Kamikaze', 'all-enemies', 1.55, 'explosion', [E('weaken', 0.2, 2)]),
    ]),
  C('bartolomeo', 'Bartolomeo', 'Barrier Fanatic', 3, 'Guardian', 'spirit', 'Crossed fingers create near-impenetrable barriers to protect his idols.',
    P('Barrier-Barrier Bodyguard', 'all-shield', 0.1, 'Every ally begins battle with a shield worth 10% maximum health.'), [
      S('Barrier Fist', 'enemy', 0.98, 'punch'),
      S('Barrier Wall', 'ally', 0, 'shield', [E('shield', 2.6), E('guard', 0.15, 2)]),
      S('Barrier Crash', 'all-enemies', 1.25, 'shield', [E('shield', 1.0, 0, { scope: 'all-allies' })]),
    ]),
  C('bonclay', 'Bentham · Bon Clay', 'A Friend Beyond Duty', 2, 'Support', 'bloom', 'Clone-Clone disguise, ballet-like kicks and loyalty that never retreats.',
    P('Way of Friendship', 'all-regen', 0.03, 'At each round’s start, living allies recover 3% maximum health.'), [
      S('Swan Arabesque', 'enemy', 0.98, 'punch'),
      S('Clone-Clone Feint', 'enemy', 1.3, 'smoke', [E('weaken', 0.3, 2)]),
      S('Friendship Never Dies', 'all-allies', 0, 'heal', [E('heal', 1.4), E('attack-up', 0.2, 2)]),
    ]),
  C('carrot', 'Carrot', 'Moonlit Musketeer', 3, 'Striker', 'electric', 'Mink agility and Electro become dazzling speed beneath the full moon.',
    P('Mink Agility', 'speed', 0.16, 'Initiative speed is increased by 16%.'), [
      S('Electro Claw', 'enemy', 1.03, 'lightning'),
      S('Electrical Luna', 'enemy', 1.55, 'lightning', [E('stun', 0, 1, { chance: 0.6 })]),
      S('Sulong Rush', 'enemy', 2.3, 'lightning', [E('attack-up', 0.25, 2, { scope: 'self' })]),
    ]),
  C('vivi', 'Nefertari Vivi', 'Princess of Alabasta', 1, 'Support', 'spirit', 'A brave princess whose peacock slashers and leadership keep her friends together.',
    P('A Kingdom’s Hope', 'all-energy', 4, 'Every living ally recovers 4 Spirit at each round’s start.'), [
      S('Peacock Slasher', 'enemy', 0.95, 'slash'),
      S('Rally Alabasta', 'all-allies', 0, 'shield', [E('shield', 1.1), E('energy', 10)]),
      S('Let the Fighting Stop', 'all-enemies', 0.75, 'soul', [E('weaken', 0.4, 2)]),
    ]),
  C('arlong', 'Arlong', 'Sawtooth of the East Blue', 2, 'Striker', 'water', 'A sawshark fish-man attacks with his saw-shaped nose, powerful jaws and Kiribachi blade.',
    P('Shark’s Fury', 'execute', 0.18, 'Deal 18% more damage to targets below half health.'), [
      S('Shark on Darts', 'enemy', 1.04, 'water'),
      S('Kiribachi Sweep', 'all-enemies', 1.25, 'slash'),
      S('Shark Tooth Assault', 'enemy', 2.3, 'water', [E('weaken', 0.2, 2)]),
    ]),
  C('magellan', 'Magellan', 'Venom Warden', 5, 'Controller', 'venom', 'The Venom-Venom Fruit creates toxic creatures and overwhelming clouds of poison.',
    P('Venom Immunity', 'poison-immune', 1, 'Immune to poison damage and the poison status.'), [
      S('Venom Touch', 'enemy', 0.9, 'poison', [E('poison', 0.15, 2)]),
      S('Hydra', 'all-enemies', 1.05, 'poison', [E('poison', 0.3, 3)]),
      S('Venom Demon', 'all-enemies', 1.45, 'poison', [E('poison', 0.4, 3)]),
    ]),
  C('kaido', 'Kaido the Beast', 'Apex · Azure Dragon', 7, 'Guardian', 'dragon', 'A legendary dragon form and thunderous kanabo embody overwhelming force.',
    P('Strongest Creature', 'apex-kaido', 0.15, 'Take 15% less direct damage; recover 4% maximum health at each turn.'), [
      S('Thunder Bagua', 'enemy', 1.15, 'lightning', [E('stun', 0, 1, { chance: 0.2 })]),
      S('Bolo Breath', 'all-enemies', 1.4, 'dragon', [E('burn', 0.3, 2)], 35),
      S('Flaming Drum Dragon', 'all-enemies', 1.85, 'dragon', [E('burn', 0.35, 2)], 65),
    ], 'https://one-piece.com/character/Kaido/index.html'),
  C('whitebeard', 'Whitebeard', 'Apex · Strongest Man', 7, 'Guardian', 'earth', 'Edward Newgate’s bisento and Tremor-Tremor power can shake the sea itself.',
    P('A Father’s Protection', 'apex-whitebeard', 0.08, 'All allies begin with 8% maximum-health shields; deal 20% more damage below half health.'), [
      S('Murakumogiri Cleave', 'enemy', 1.16, 'slash'),
      S('Seaquake', 'all-enemies', 1.4, 'earth', [E('slow', 0.25, 2)], 35),
      S('Heaven and Earth Tremor', 'all-enemies', 1.9, 'earth', [E('pierce'), E('weaken', 0.2, 2)], 65),
    ], 'https://one-piece.com/character/edward_newgate/index.html'),
  C('akainu', 'Admiral Akainu', 'Apex · Absolute Justice', 7, 'Striker', 'magma', 'Sakazuki’s magma power consumes defenses in a relentless volcanic offensive.',
    P('Magma Incarnate', 'apex-akainu', 0.3, 'Immune to burn; deal 30% more damage to burning enemies.'), [
      S('Great Eruption', 'enemy', 1.12, 'fire', [E('burn', 0.16, 2)]),
      S('Hell Hound', 'enemy', 2.0, 'fire', [E('burn', 0.32, 2)], 35),
      S('Meteor Volcano', 'all-enemies', 1.8, 'explosion', [E('burn', 0.4, 3)], 65),
    ], 'https://one-piece.com/character/Sakazuki/index.html'),
];

// Expansion II: current seven-star editions deliberately do not reuse retired save IDs.
CHARACTERS.push(
  C('bigmom7', 'Charlotte Linlin · Big Mom', 'Apex · Soul Queen', 7, 'Guardian', 'soul', 'Napoleon, Prometheus and Hera turn the Soul-Soul Fruit into a terrifying combined arsenal.',
    P('Iron Balloon', 'defense', .18, 'Take 18% less direct damage.'), [
      S('Napoleon: Cognac', 'enemy', 1.12, 'slash', [E('burn', .18, 2)]),
      S('Ikoku Sovereignty', 'all-enemies', 1.45, 'slash', [E('pierce')], 35),
      S('Misery: Homie Fusion', 'all-enemies', 1.8, 'lightning', [E('burn', .3, 2), E('stun', 0, 1, { chance: .3 })], 65),
    ], 'https://one-piece.com/character/CharlotteLinlin/index.html'),
  C('garp7', 'Monkey D. Garp', 'Apex · Marine Hero', 7, 'Striker', 'haki', 'A legendary Marine whose immense physical strength and Haki create devastating fist shockwaves. Galaxy Impact is not a gravity Devil Fruit power.',
    P('Fist of the Hero', 'pierce', .3, 'Every damaging skill ignores 30% of defense.'), [
      S('Iron Fist', 'enemy', 1.16, 'punch'),
      S('Blue Hole', 'enemy', 2.05, 'punch', [E('stun', 0, 1)], 35),
      S('Galaxy Impact', 'all-enemies', 1.9, 'earth', [E('weaken', .2, 2)], 65),
    ], 'https://optc-ww.channel.or.jp/news/562/'),
  C('sabo7', 'Sabo', 'Apex · Flame Emperor', 7, 'Striker', 'fire', 'The Revolutionary Army chief of staff combines Dragon Claw Fist with the Flame-Flame Fruit inherited from Ace.',
    P('Inherited Flame', 'burn-immune', 1, 'Immune to burn damage and the burn status.'), [
      S('Dragon Claw Fist', 'enemy', 1.12, 'punch', [E('pierce')]),
      S('Fire Fist', 'all-enemies', 1.4, 'fire', [E('burn', .25, 2)], 35),
      S('Flame Dragon King', 'all-enemies', 1.85, 'fire', [E('burn', .35, 2), E('weaken', .15, 2)], 65),
    ], 'https://one-piece.com/anime/o2851/index.html'),
  C('rayleigh', 'Silvers Rayleigh', 'Dark King', 6, 'Guardian', 'haki', 'The Roger Pirates’ former first mate wields a sword, masterful Armament Haki and an intimidating presence.',
    P('A Master’s Foresight', 'evade', .12, '12% chance to evade direct attacks.'), [
      S('Haki Blade', 'enemy', 1.1, 'slash', [E('pierce')]),
      S('Armament Repulsion', 'all-allies', 0, 'shield', [E('shield', 1.6), E('guard', .15, 2)]),
      S('Dark King’s Presence', 'all-enemies', 1.35, 'soul', [E('stun', 0, 1, { chance: .65 }), E('weaken', .2, 2)]),
    ]),
  C('oden', 'Kozuki Oden', 'Two-Sword Legend', 6, 'Striker', 'steel', 'Enma and Ame no Habakiri carry Oden’s forceful two-sword style. He sailed with both Whitebeard and Roger.',
    P('Unbreakable Will', 'low-health-defense', .25, 'Take 25% less direct damage below half health.'), [
      S('Two-Sword Cut', 'enemy', 1.1, 'slash'),
      S('Paradise Waterfall', 'all-enemies', 1.3, 'slash', [E('weaken', .18, 2)]),
      S('Paradise Totsuka', 'enemy', 2.65, 'slash', [E('pierce')]),
    ], 'https://one-piece.com/greg/o20170222_0695/index.html'),
  C('bennbeckman', 'Benn Beckman', 'Red Hair’s First Mate', 5, 'Controller', 'haki', 'A composed veteran whose rifle and tactical awareness keep dangerous opponents in check.',
    P('Measured Aim', 'crit', .12, 'Gain 12% additional critical chance.'), [
      S('Rifle Shot', 'enemy', 1.05, 'wind'), S('Covering Fire', 'all-enemies', 1.1, 'wind', [E('slow', .2, 2)]),
      S('Veteran’s Deadeye', 'enemy', 2.4, 'wind', [E('pierce')]),
    ]),
  C('luckyroux', 'Lucky Roux', 'Red Hair’s Combatant', 4, 'Striker', 'steel', 'A cheerful Red Hair Pirate who fights with sudden movement, a flintlock and his imposing build.',
    P('Quick on the Draw', 'speed', .12, 'Initiative speed is increased by 12%.'), [
      S('Flintlock Snap', 'enemy', 1, 'wind'), S('Rolling Rush', 'all-enemies', 1.25, 'punch', [E('slow', .15, 2)]),
      S('Close-Range Volley', 'enemy', 2.2, 'wind', [E('stun', 0, 1, { chance: .5 })]),
    ]),
  C('yasopp', 'Yasopp', 'Red Hair’s Sharpshooter', 4, 'Striker', 'steel', 'A renowned sniper who reads a distant target and places a precise rifle shot.',
    P('A Sniper’s Eye', 'crit', .17, 'Gain 17% additional critical chance.'), [
      S('Distant Shot', 'enemy', 1.04, 'wind'), S('Sighting Shot', 'enemy', 1.55, 'wind', [E('weaken', .25, 2)]),
      S('Unerring Bullet', 'enemy', 2.3, 'wind', [E('pierce')]),
    ]),
  C('jozu', 'Jozu', 'Diamond Vanguard', 5, 'Guardian', 'earth', 'Whitebeard’s third-division commander turns his body to diamond for crushing tackles and unyielding defense.',
    P('Diamond Body', 'defense', .2, 'Take 20% less direct damage.'), [
      S('Diamond Shoulder', 'enemy', 1, 'punch'), S('Brilliant Punk', 'all-enemies', 1.3, 'earth', [E('stun', 0, 1, { chance: .45 })]),
      S('Diamond Bulwark', 'all-allies', 0, 'shield', [E('shield', 2), E('guard', .2, 2)]),
    ]),
  C('vista', 'Vista', 'Flower Sword', 4, 'Striker', 'steel', 'Whitebeard’s fifth-division commander uses two swords in a flowing style evoking scattered rose petals.',
    P('Duelist’s Rhythm', 'focus', .035, 'Each attack raises damage by 3.5%, up to 21% per battle.'), [
      S('Twin Saber Cut', 'enemy', 1.06, 'slash'), S('Rose-Petal Sweep', 'all-enemies', 1.25, 'slash'),
      S('Flower Sword Dance', 'all-enemies', 1.65, 'slash', [E('weaken', .2, 2)]),
    ]),
  C('izo', 'Izo', 'Guns of the Kozuki', 4, 'Striker', 'haki', 'A former Kozuki retainer and Whitebeard commander whose twin pistols fire disciplined Haki-infused shots.',
    P('Swordsman’s Resolve', 'low-health-defense', .2, 'Take 20% less direct damage below half health.'), [
      S('Twin Pistol Shot', 'enemy', 1.03, 'wind'), S('Slicing Rounds', 'all-enemies', 1.2, 'wind', [E('pierce')]),
      S('Crossfire Barrage', 'enemy', 2.25, 'wind', [E('weaken', .2, 2)]),
    ]),
  C('perospero', 'Charlotte Perospero', 'Candy Minister', 4, 'Controller', 'wax', 'The Lick-Lick Fruit shapes sticky candy into walls, arrows and traps.',
    P('Candy Armor', 'shield-start', .12, 'Begin battle with a shield worth 12% maximum health.'), [
      S('Candy Arrow', 'enemy', .95, 'earth', [E('slow', .12, 1)]), S('Candy Wall', 'ally', 0, 'shield', [E('shield', 2), E('guard', .15, 2)], 25),
      S('Candy Maiden', 'all-enemies', 1.35, 'earth', [E('slow', .3, 3), E('stun', 0, 1, { chance: .4 })]),
    ]),
  C('smoothie', 'Charlotte Smoothie', 'Juice Sweet Commander', 5, 'Striker', 'water', 'The Wring-Wring Fruit extracts liquid; Smoothie grows stronger and releases great liquid sword waves.',
    P('Wring-Wring Recovery', 'lifesteal', .12, 'Heal for 12% of direct damage dealt.'), [
      S('Juice Slash', 'enemy', 1.02, 'water'), S('Wringing Blade', 'enemy', 1.65, 'water', [E('drain', 20)]),
      S('Liquid Giant Wave', 'all-enemies', 1.7, 'water', [E('slow', .2, 2)]),
    ]),
  C('cracker', 'Charlotte Cracker', 'Biscuit Sweet Commander', 5, 'Guardian', 'earth', 'The Biscuit-Biscuit Fruit creates hard biscuit soldiers while Pretzel delivers precise sword thrusts.',
    P('Biscuit Armor', 'shield-start', .18, 'Begin battle with a shield worth 18% maximum health.'), [
      S('Pretzel Thrust', 'enemy', 1.04, 'slash'), S('Biscuit Battalion', 'all-allies', 0, 'shield', [E('shield', 1.8), E('guard', .15, 2)]),
      S('Roll Pretzel', 'enemy', 2.5, 'slash', [E('pierce')]),
    ]),
  C('oven', 'Charlotte Oven', 'Minister of Browned Food', 4, 'Controller', 'fire', 'The Heat-Heat Fruit turns Oven’s body and the surrounding sea searing hot.',
    P('Heatproof', 'burn-immune', 1, 'Immune to burn damage and the burn status.'), [
      S('Heated Fist', 'enemy', 1, 'fire', [E('burn', .12, 2)]), S('Heat Wave', 'all-enemies', 1.15, 'fire', [E('burn', .22, 2)]),
      S('Boiling Sea', 'all-enemies', 1.5, 'fire', [E('burn', .3, 3)]),
    ]),
  C('daifuku', 'Charlotte Daifuku', 'Genie Minister', 4, 'Guardian', 'smoke', 'The Puff-Puff Fruit summons a huge halberd-wielding genie from Daifuku’s body.',
    P('Genie’s Reach', 'pierce', .15, 'Every damaging skill ignores 15% of defense.'), [
      S('Genie Halberd', 'enemy', 1.03, 'slash'), S('Genie Cleave', 'all-enemies', 1.3, 'slash'),
      S('Genie Execution', 'all-enemies', 1.6, 'slash', [E('weaken', .2, 2)]),
    ]),
  C('pudding', 'Charlotte Pudding', 'Memory Film Editor', 2, 'Support', 'bloom', 'The Memo-Memo Fruit extracts memories as film that Pudding can inspect and edit.',
    P('Careful Editing', 'energy', 6, 'Recover 6 extra Spirit at the start of each turn.'), [
      S('Memory Glimpse', 'enemy', .85, 'soul', [E('weaken', .1, 1)]), S('Memory Edit', 'ally', 0, 'heal', [E('cleanse'), E('heal', 1.4)], 25),
      S('Missing Memory', 'all-enemies', .85, 'soul', [E('weaken', .3, 2), E('slow', .2, 2)]),
    ]),
  C('brulee', 'Charlotte Brulee', 'Keeper of the Mirror World', 3, 'Controller', 'bloom', 'The Mirror-Mirror Fruit opens a reflected world and turns mirrors into shields and deceptive attacks.',
    P('Mirror Reflection', 'counter', .22, 'Return damage equal to 22% attack after surviving a direct hit.'), [
      S('Mirror Shard', 'enemy', .9, 'light'), S('Mirror Screen', 'ally', 0, 'shield', [E('shield', 1.7), E('cleanse')], 25),
      S('Mirror Ambush', 'all-enemies', 1.3, 'light', [E('stun', 0, 1, { chance: .45 })]),
    ]),
  C('ulti', 'Ulti', 'Pachycephalosaurus Headliner', 4, 'Striker', 'earth', 'An ancient pachycephalosaurus Zoan gives Ulti powerful headbutts and remarkable toughness.',
    P('Ancient Endurance', 'defense', .12, 'Take 12% less direct damage.'), [
      S('Ulti Headbutt', 'enemy', 1.05, 'punch'), S('Ulti-Mortar', 'enemy', 1.75, 'earth', [E('stun', 0, 1, { chance: .65 })]),
      S('Ulti-Meteor', 'all-enemies', 1.55, 'earth', [E('weaken', .15, 2)]),
    ]),
  C('pageone', 'Page One', 'Spinosaurus Headliner', 3, 'Guardian', 'dragon', 'An ancient spinosaurus Zoan grants Page One huge jaws, claws and a resilient hybrid body.',
    P('Ancient Hide', 'defense', .14, 'Take 14% less direct damage.'), [
      S('Spinosaurus Claw', 'enemy', 1, 'slash'), S('Hybrid Jaw Crush', 'enemy', 1.7, 'punch', [E('weaken', .2, 2)]),
      S('Spinosaurus Tail Sweep', 'all-enemies', 1.4, 'earth', [E('slow', .2, 2)]),
    ]),
  C('whoswho', 'Who’s-Who', 'Saber-Tooth Assassin', 4, 'Striker', 'steel', 'A former Cipher Pol agent combines Six Powers with an ancient saber-toothed tiger Zoan.',
    P('Predatory Technique', 'crit', .1, 'Gain 10% additional critical chance.'), [
      S('Fang Pistol', 'enemy', 1.03, 'wind'), S('Tempest Kick', 'all-enemies', 1.2, 'slash'),
      S('Fang Flash', 'enemy', 2.35, 'punch', [E('pierce')]),
    ]),
  C('sasaki', 'Sasaki', 'Armored Triceratops', 3, 'Guardian', 'earth', 'A triceratops Zoan and a rotating neck frill turn Sasaki into a charging armored threat.',
    P('Armored Frill', 'defense', .15, 'Take 15% less direct damage.'), [
      S('Horn Charge', 'enemy', 1.02, 'punch'), S('Heliceratops', 'all-enemies', 1.2, 'wind', [E('slow', .15, 2)]),
      S('Triceratops Drill', 'enemy', 2.2, 'punch', [E('pierce')]),
    ]),
  C('blackmaria', 'Black Maria', 'Spider of Onigashima', 4, 'Controller', 'bloom', 'An ancient spider Zoan weaves binding webs while a burning wheel weapon threatens trapped enemies.',
    P('Web Weaver', 'debuff-duration', 1, 'The first harmful effect she applies each battle lasts one additional turn.'), [
      S('Spider Thread', 'enemy', .9, 'plant', [E('slow', .15, 1)]), S('Maria Net', 'all-enemies', .9, 'plant', [E('slow', .3, 2), E('stun', 0, 1, { chance: .4 })]),
      S('Burning Wanyudo', 'all-enemies', 1.55, 'fire', [E('burn', .25, 2)]),
    ]),
  C('xdrake', 'X Drake', 'Undercover Allosaurus', 4, 'Guardian', 'dragon', 'A Marine SWORD officer who infiltrated the Beast Pirates, wielding an axe, sword and an allosaurus form.',
    P('Ancient Recovery', 'regen', .04, 'Recover 4% maximum health at the start of each turn.'), [
      S('Axe and Saber', 'enemy', 1.02, 'slash'), S('Allosaurus Bite', 'enemy', 1.75, 'punch', [E('weaken', .2, 2)]),
      S('X-Calibur', 'all-enemies', 1.6, 'slash', [E('pierce')]),
    ]),
  C('apoo', 'Scratchmen Apoo', 'Roar of the Sea', 3, 'Controller', 'soul', 'The Tone-Tone Fruit turns Apoo’s body into instruments whose sound delivers cuts and explosions.',
    P('Perfect Tempo', 'energy', 7, 'Recover 7 extra Spirit at the start of each turn.'), [
      S('Scratch', 'enemy', .95, 'slash'), S('Boom', 'all-enemies', 1.15, 'explosion', [E('stun', 0, 1, { chance: .4 })]),
      S('Fighting Music', 'all-enemies', 1.45, 'soul', [E('weaken', .2, 2)]),
    ]),
  C('hawkins', 'Basil Hawkins', 'Straw Magician', 3, 'Controller', 'plant', 'The Straw-Straw Fruit animates straw while tarot cards guide Hawkins’ risky battle choices.',
    P('Straw Substitute', 'stubborn', .1, 'Once per battle, survive a lethal blow with 10% health.'), [
      S('Straw Sword', 'enemy', .98, 'slash'), S('Straw Man’s Card', 'ally', 0, 'shield', [E('shield', 1.7), E('guard', .15, 2)]),
      S('Straw Man’s Scythe', 'all-enemies', 1.5, 'plant', [E('slow', .2, 2)]),
    ]),
  C('bege', 'Capone Bege', 'Fire Tank Captain', 3, 'Guardian', 'machine', 'The Castle-Castle Fruit houses a miniature armed fortress within Bege’s body.',
    P('Fortress Walls', 'all-shield', .07, 'Every ally begins battle with a shield worth 7% maximum health.'), [
      S('Castle Musket', 'enemy', .98, 'wind'), S('Castle Cannonade', 'all-enemies', 1.2, 'explosion'),
      S('Big Father', 'all-allies', 0, 'shield', [E('shield', 2.2), E('guard', .25, 2)]),
    ]),
  C('bonney', 'Jewelry Bonney', 'Age-Shifting Captain', 4, 'Controller', 'bloom', 'The Age-Age Fruit changes ages and draws strength from imagined futures.',
    P('A Future of Freedom', 'stubborn', .12, 'Once per battle, survive a lethal blow with 12% health.'), [
      S('Age Thrust', 'enemy', .95, 'punch', [E('slow', .12, 1)]), S('Aging Touch', 'enemy', 1.2, 'soul', [E('weaken', .3, 2), E('slow', .25, 2)]),
      S('Distorted Future', 'all-enemies', 1.65, 'punch', [E('attack-up', .2, 2, { scope: 'self' })]),
    ]),
  C('urouge', 'Urouge', 'Mad Monk', 4, 'Guardian', 'earth', 'The Fallen Monk Pirates captain turns the punishment he receives into greater physical power.',
    P('Damage into Strength', 'counter', .25, 'Return damage equal to 25% attack after surviving a direct hit.'), [
      S('Iron Pillar', 'enemy', 1.02, 'punch'), S('Karmic Growth', 'self', 0, 'shield', [E('shield', 1.5), E('attack-up', .3, 2)]),
      S('Karmic Punishment', 'enemy', 2.4, 'punch', [E('stun', 0, 1, { chance: .5 })]),
    ]),
  C('bepo', 'Bepo', 'Heart Pirates Navigator', 3, 'Striker', 'electric', 'A polar bear Mink whose martial arts, Electro and Sulong potential protect the Heart Pirates.',
    P('Mink Footwork', 'speed', .12, 'Initiative speed is increased by 12%.'), [
      S('Polar Bear Palm', 'enemy', 1, 'punch'), S('Electro Kick', 'enemy', 1.55, 'lightning', [E('stun', 0, 1, { chance: .5 })]),
      S('Sulong Rescue', 'all-enemies', 1.45, 'lightning', [E('shield', .8, 0, { scope: 'all-allies' })]),
    ]),
  C('penguin', 'Penguin', 'Heart Pirates Diver', 1, 'Support', 'water', 'An experienced Heart Pirates crewman whose swimming and teamwork make the sea his battlefield.',
    P('Submarine Teamwork', 'all-energy', 3, 'Every living ally recovers 3 Spirit at each round’s start.'), [
      S('Deckhand Strike', 'enemy', .9, 'punch'), S('Diving Cover', 'ally', 0, 'shield', [E('shield', 1.3)], 20, 1),
      S('Underwater Rush', 'all-enemies', 1.2, 'water', [E('slow', .15, 2)]),
    ]),
  C('shachi', 'Shachi', 'Heart Pirates Seawater Gunner', 1, 'Controller', 'water', 'A Heart Pirates swimmer who takes in seawater and spits it out as a powerful defensive spray.',
    P('Sea Readiness', 'energy', 5, 'Recover 5 extra Spirit at the start of each turn.'), [
      S('Water Spit', 'enemy', .9, 'water'), S('Seawater Intercept', 'enemy', 1.3, 'water', [E('weaken', .2, 2)], 20),
      S('Ocean Spray', 'all-enemies', 1.2, 'water', [E('slow', .2, 2)]),
    ]),
  C('kinemon', 'Kin’emon', 'Foxfire Samurai', 4, 'Guardian', 'fire', 'A loyal Kozuki retainer whose Foxfire Style both cuts flames and sets his sword ablaze.',
    P('Flame-Cutting Guard', 'burn-immune', 1, 'Immune to burn damage and the burn status.'), [
      S('Foxfire Cut', 'enemy', 1.02, 'slash'), S('Flame-Cleaving Guard', 'all-allies', 0, 'shield', [E('cleanse'), E('shield', 1.4)]),
      S('Flaming Double Slash', 'all-enemies', 1.6, 'fire', [E('burn', .2, 2)]),
    ]),
  C('denjiro', 'Denjiro', 'Hidden Blade of Wano', 4, 'Striker', 'steel', 'A Kozuki retainer whose patient resolve and precise swordsmanship hid beneath the identity Kyoshiro.',
    P('Patient Blade', 'crit', .12, 'Gain 12% additional critical chance.'), [
      S('Quickdraw', 'enemy', 1.05, 'slash'), S('Retainer’s Parry', 'ally', 0, 'shield', [E('shield', 1.4), E('guard', .2, 2)]),
      S('Moonlit Sword Rush', 'enemy', 2.35, 'slash', [E('pierce')]),
    ]),
  C('kiku', 'Kikunojo', 'Lingering Snow Samurai', 3, 'Striker', 'steel', 'A graceful Kozuki swordswoman whose calm resolve conceals a formidable blade.',
    P('Samurai Composure', 'evade', .09, '9% chance to evade direct attacks.'), [
      S('Snow-Moon Cut', 'enemy', 1, 'slash'), S('Demon Mask Charge', 'enemy', 1.6, 'slash', [E('weaken', .2, 2)]),
      S('Lingering Snow Dance', 'all-enemies', 1.45, 'slash', [E('slow', .15, 2)]),
    ]),
  C('raizo', 'Raizo', 'Raizo of the Mist', 3, 'Controller', 'water', 'A ninja retainer whose Scroll-Scroll Fruit stores attacks and releases their force from scrolls.',
    P('Ninja Evasion', 'evade', .1, '10% chance to evade direct attacks.'), [
      S('Shuriken Volley', 'enemy', .95, 'wind'), S('Scroll Capture', 'ally', 0, 'shield', [E('shield', 1.7), E('cleanse')]),
      S('Scroll Release: Great Flood', 'all-enemies', 1.45, 'water', [E('slow', .25, 2)]),
    ]),
  C('kawamatsu', 'Kawamatsu', 'Kappa Yokozuna', 3, 'Guardian', 'water', 'A fish-man and Kozuki retainer whose sumo strength complements flowing swordsmanship.',
    P('Yokozuna Stance', 'defense', .13, 'Take 13% less direct damage.'), [
      S('River Blade', 'enemy', 1, 'slash'), S('Sumo Palm', 'enemy', 1.65, 'punch', [E('stun', 0, 1, { chance: .5 })]),
      S('River of Retribution', 'all-enemies', 1.45, 'water', [E('weaken', .18, 2)]),
    ]),
  C('ashura', 'Ashura Doji', 'Strongest Bandit of Kuri', 4, 'Guardian', 'steel', 'Once a mountain bandit, Ashura’s great strength and swordsmanship became devoted to the Kozuki cause.',
    P('Mountain Endurance', 'low-health-defense', .25, 'Take 25% less direct damage below half health.'), [
      S('Bandit’s Blade', 'enemy', 1.04, 'slash'), S('Mountain Cleave', 'all-enemies', 1.25, 'slash'),
      S('Kuri’s Resolute Charge', 'enemy', 2.35, 'slash', [E('pierce')]),
    ]),
  C('inuarashi', 'Inuarashi', 'Ruler of the Day', 4, 'Striker', 'electric', 'The canine Mink ruler, Kozuki retainer and former voyage companion channels Electro through his sword.',
    P('Musketeer Footwork', 'speed', .12, 'Initiative speed is increased by 12%.'), [
      S('Electro Saber', 'enemy', 1.02, 'slash'), S('Musketeer Rush', 'enemy', 1.65, 'lightning', [E('pierce')]),
      S('Sulong Sword Storm', 'all-enemies', 1.6, 'lightning', [E('stun', 0, 1, { chance: .4 })]),
    ]),
  C('nekomamushi', 'Nekomamushi', 'Ruler of the Night', 4, 'Guardian', 'electric', 'The feline Mink ruler and Kozuki retainer fights with enormous claws, Electro and a prosthetic firearm.',
    P('Night Watch', 'counter', .22, 'Return damage equal to 22% attack after surviving a direct hit.'), [
      S('Electro Claw', 'enemy', 1.03, 'lightning'), S('Cat Viper Pounce', 'enemy', 1.7, 'punch', [E('stun', 0, 1, { chance: .5 })]),
      S('Sulong Night Raid', 'all-enemies', 1.6, 'lightning', [E('weaken', .2, 2)]),
    ]),
  C('ivankov', 'Emporio Ivankov', 'Miracle Worker', 5, 'Healer', 'medicine', 'The Horm-Horm Fruit manipulates hormones, supporting recovery and extraordinary vitality while mighty winks create shockwaves.',
    P('Miracle Medicine', 'healing', .2, 'Healing and revival restore 20% more health.'), [
      S('Death Wink', 'enemy', .98, 'wind'), S('Healing Hormones', 'ally', 0, 'heal', [E('heal', 2), E('cleanse')], 25),
      S('Tension Hormones', 'all-allies', 0, 'heal', [E('heal', 1.25), E('attack-up', .2, 2), E('energy', 15)]),
    ]),
  C('koala', 'Koala', 'Revolutionary Karate Instructor', 3, 'Support', 'water', 'A human Fish-Man Karate practitioner who trains allies and supports the Revolutionary Army.',
    P('Karate Discipline', 'all-guard', .06, 'Living allies take 6% less direct damage; in defense this protects nearby allies.'), [
      S('Karate Palm', 'enemy', .98, 'water'), S('Instructor’s Guard', 'ally', 0, 'shield', [E('shield', 1.5), E('cleanse')], 25),
      S('Revolutionary Palm Wave', 'all-enemies', 1.4, 'water', [E('weaken', .2, 2)]),
    ]),
  C('belobetty', 'Belo Betty', 'East Army Commander', 4, 'Support', 'spirit', 'The Pump-Pump Fruit turns Betty’s encouragement into courage and increased fighting strength for others.',
    P('Rousing Resolve', 'all-energy', 5, 'Every living ally recovers 5 Spirit at each round’s start.'), [
      S('Flagstaff Strike', 'enemy', .92, 'punch'), S('Pump-Up Rally', 'all-allies', 0, 'soul', [E('attack-up', .2, 2), E('energy', 15)]),
      S('Rise for Freedom', 'all-allies', 0, 'shield', [E('shield', 1.6), E('attack-up', .3, 2), E('cleanse')]),
    ]),
  C('lindbergh', 'Lindbergh', 'South Army Inventor', 2, 'Controller', 'machine', 'A Mink engineer whose jetpack, freeze gun and other gadgets support revolutionary operations.',
    P('Inventor’s Fuel', 'energy', 6, 'Recover 6 extra Spirit at the start of each turn.'), [
      S('Gadget Shot', 'enemy', .94, 'wind'), S('Cool Shooter', 'enemy', 1.3, 'ice', [E('freeze', 0, 1, { chance: .75 })]),
      S('Jetpack Frost Sweep', 'all-enemies', 1.25, 'ice', [E('slow', .25, 2)]),
    ]),
  C('morley', 'Morley', 'West Army Tunnel Maker', 4, 'Guardian', 'earth', 'The Push-Push Fruit lets this giant commander push the ground aside and sculpt tunnels through solid earth.',
    P('Giant’s Cover', 'all-shield', .08, 'Every ally begins battle with a shield worth 8% maximum health.'), [
      S('Trident Sweep', 'enemy', 1, 'slash'), S('Push-Push Earth', 'all-enemies', 1.15, 'earth', [E('slow', .3, 2)]),
      S('Underground Uprising', 'all-enemies', 1.55, 'earth', [E('stun', 0, 1, { chance: .45 })]),
    ]),
  C('karasu', 'Karasu', 'North Army Soot Commander', 4, 'Controller', 'dark', 'The Soot-Soot Fruit forms flocks of soot crows for movement, communication and attacks.',
    P('Soot Dispersion', 'evade', .12, '12% chance to evade direct attacks.'), [
      S('Soot Crow', 'enemy', .95, 'dark'), S('Obscuring Flock', 'all-enemies', 1.05, 'dark', [E('weaken', .25, 2)]),
      S('Soot Beak Barrage', 'all-enemies', 1.5, 'dark', [E('slow', .2, 2)]),
    ]),
  C('helmeppo', 'Helmeppo', 'SWORD Kukri Fighter', 1, 'Striker', 'steel', 'A Marine trained beside Koby under Garp who now fights with paired kukri blades.',
    P('Training Pays Off', 'focus', .03, 'Each attack raises damage by 3%, up to 18% per battle.'), [
      S('Kukri Cut', 'enemy', .95, 'slash'), S('Twin Kukri', 'enemy', 1.5, 'slash', [E('weaken', .15, 2)]),
      S('SWORD Cover Charge', 'all-enemies', 1.25, 'slash', [E('shield', .6, 0, { scope: 'all-allies' })]),
    ]),
  C('doll', 'Doll', 'Vice Admiral of G-14', 3, 'Striker', 'haki', 'A seasoned Marine vice admiral who relies on powerful kicks and disciplined close combat.',
    P('Veteran’s Timing', 'crit', .1, 'Gain 10% additional critical chance.'), [
      S('Marine Kick', 'enemy', 1.02, 'punch'), S('Breaking Heel', 'enemy', 1.65, 'punch', [E('pierce')]),
      S('Vice Admiral’s Sweep', 'all-enemies', 1.4, 'punch', [E('stun', 0, 1, { chance: .4 })]),
    ]),
  C('princegrus', 'Prince Grus', 'SWORD Clay Commander', 4, 'Guardian', 'earth', 'The Glorp-Glorp Fruit creates malleable clay and golems that defend allies and disrupt an enemy advance.',
    P('Clay Cover', 'all-shield', .08, 'Every ally begins battle with a shield worth 8% maximum health.'), [
      S('Clay Fist', 'enemy', .98, 'earth'), S('Golem Guard', 'ally', 0, 'shield', [E('shield', 2), E('guard', .15, 2)]),
      S('Clay Web', 'all-enemies', 1.35, 'earth', [E('slow', .3, 2), E('stun', 0, 1, { chance: .35 })]),
    ]),
  C('tbone', 'T Bone', 'Ship Cutter', 3, 'Guardian', 'steel', 'A compassionate Marine swordsman whose straight-edged sword attacks protect others at any cost.',
    P('Duty to Protect', 'all-guard', .06, 'Living allies take 6% less direct damage; in defense this protects nearby allies.'), [
      S('Right-Angle Cut', 'enemy', 1, 'slash'), S('Bone Guard', 'ally', 0, 'shield', [E('shield', 1.7), E('guard', .15, 2)]),
      S('Ship-Cutting Slash', 'all-enemies', 1.5, 'slash', [E('pierce')]),
    ]),
);

const VERIFIED_PROFILE_SLUGS = {
  luffy: 'luffy', zoro: 'zoro', nami: 'nami', brook: 'brook', wyper: 'Wyper', bellamy: 'bellamy', gin: 'Gin', mr3: 'Galdino', kid: 'kid', killer: 'killer',
  kalifa: 'Kalifa', hatchan: 'Hacchan', crocodile: 'Crocodile', doflamingo: 'doflamingo', buggy: 'Buggy', smoker: 'smoker', tashigi: 'tashigi',
  koby: 'Coby', donkrieg: 'Don_Krieg', paulie: 'Paulie', hina: 'Hina', aokiji: 'kuzan', fujitora: 'fujitora', ryokugyu: 'Aramaki',
  kaku: 'Kaku', wapol: 'Wapol', katakuri: 'Charlotte_Katakuri', marco: 'marco', kuro: 'Kuro', queen: 'Queen', jack: 'Jack',
  lucci: 'Rob_Lucci', perona: 'Perona', bartolomeo: 'bartolomeo', bonclay: 'Bon_Clay_Mr2', carrot: 'carrot', vivi: 'Nefeltari_Vivi', arlong: 'Arlong',
  magellan: 'Magellan', kaido: 'Kaido', whitebeard: 'edward_newgate', akainu: 'Sakazuki',
  bigmom7: 'CharlotteLinlin', morley: 'Morley',
};
for (const character of CHARACTERS) {
  const slug = VERIFIED_PROFILE_SLUGS[character.id];
  if (slug) character.source = `https://one-piece.com/character/${slug}/index.html`;
  else if (['usopp', 'sanji', 'chopper', 'robin', 'franky'].includes(character.id)) character.source = LORE_SOURCES[1].url;
  else if (character.id === 'enel') character.source = LORE_SOURCES[12].url;
}
// Historical membership and lasting allegiances both count in this dream-team mode.
// A commander or former member does not become captain of that whole faction.
export const CREWS = Object.freeze(Object.fromEntries([
  ['strawhat', 'Straw Hat Pirates', '#e6ba65'], ['roger', 'Roger Pirates', '#ea9590'],
  ['whitebeard', 'Whitebeard Pirates', '#d1c6f4'], ['rocks', 'Rocks Pirates', '#caa1d6'],
  ['beasts', 'Beast Pirates', '#92b6ec'], ['bigmom', 'Big Mom Pirates', '#ed9ec7'],
  ['marines', 'Marines', '#9bd6ee'], ['sword', 'SWORD', '#b7dfdf'],
  ['revolutionary', 'Revolutionary Army', '#eea680'], ['redhair', 'Red Hair Pirates', '#d39191'],
  ['heart', 'Heart Pirates', '#f1cf76'], ['kozuki', 'Kozuki Clan', '#d9b1e6'],
  ['minks', 'Mokomo Dukedom', '#acdab4'], ['kid', 'Kid Pirates', '#d18b84'],
  ['crossguild', 'Cross Guild', '#d9a881'], ['baroque', 'Baroque Works', '#d4c59b'],
  ['donquixote', 'Donquixote Pirates', '#eeb4d7'], ['krieg', 'Krieg Pirates', '#c8cd8b'],
  ['blackcat', 'Black Cat Pirates', '#adb7ca'], ['arlong', 'Arlong Pirates', '#7ac9d4'],
  ['sun', 'Sun Pirates', '#e99f8a'], ['cipherpol', 'Cipher Pol', '#b5bbc9'],
  ['galleyla', 'Galley-La Company', '#cca778'], ['shandia', 'Shandian Warriors', '#baaa7e'],
  ['blackdrum', 'Black Drum Kingdom', '#a6b5c8'], ['thrillerbark', 'Thriller Bark Pirates', '#b89bd5'],
  ['bartoclub', 'Barto Club', '#afcd86'], ['grandfleet', 'Straw Hat Grand Fleet', '#dfc16e'],
  ['alabasta', 'Alabasta Kingdom', '#92d9e4'], ['impeldown', 'Impel Down', '#b2a5c7'],
  ['skyarmy', 'God’s Army', '#d7c17b'], ['firetank', 'Fire Tank Pirates', '#b0b5ba'],
  ['bonney', 'Bonney Pirates', '#e5a5c6'], ['fallenmonk', 'Fallen Monk Pirates', '#bcba97'],
  ['hawkins', 'Hawkins Pirates', '#c8bc7d'], ['onair', 'On Air Pirates', '#daa184'],
  ['drake', 'Drake Pirates', '#98b4bc'], ['rumbar', 'Rumbar Pirates', '#c3ace4'],
  ['blackbeard', 'Blackbeard Pirates', '#a0a0c1'], ['bellamy', 'Bellamy Pirates', '#d5b17c'],
].map(([id, name, color]) => [id, Object.freeze({ id, name, color })])));

const CREW_MEMBERS = {
  strawhat: ['luffy', 'zoro', 'nami', 'usopp', 'sanji', 'chopper', 'robin', 'franky', 'brook', 'jinbe', 'vivi'],
  roger: ['rayleigh', 'oden', 'buggy', 'inuarashi', 'nekomamushi'],
  whitebeard: ['whitebeard', 'marco', 'jozu', 'vista', 'izo', 'oden', 'inuarashi', 'nekomamushi'],
  rocks: ['kaido', 'whitebeard', 'bigmom7'],
  beasts: ['kaido', 'queen', 'jack', 'ulti', 'pageone', 'whoswho', 'sasaki', 'blackmaria', 'xdrake', 'hawkins', 'apoo'],
  bigmom: ['bigmom7', 'katakuri', 'perospero', 'smoothie', 'cracker', 'oven', 'daifuku', 'pudding', 'brulee'],
  marines: ['garp7', 'akainu', 'aokiji', 'fujitora', 'ryokugyu', 'smoker', 'tashigi', 'hina', 'koby', 'helmeppo', 'doll', 'princegrus', 'tbone', 'xdrake'],
  sword: ['koby', 'helmeppo', 'princegrus', 'xdrake'],
  revolutionary: ['sabo7', 'ivankov', 'koala', 'belobetty', 'lindbergh', 'morley', 'karasu'],
  redhair: ['bennbeckman', 'luckyroux', 'yasopp'], heart: ['bepo', 'penguin', 'shachi'],
  kozuki: ['oden', 'yamato', 'kinemon', 'denjiro', 'kiku', 'raizo', 'kawamatsu', 'ashura', 'inuarashi', 'nekomamushi', 'izo'],
  minks: ['carrot', 'bepo', 'inuarashi', 'nekomamushi', 'lindbergh'], kid: ['kid', 'killer'],
  crossguild: ['buggy', 'crocodile', 'mr3'], baroque: ['crocodile', 'robin', 'bonclay', 'mr3', 'vivi'],
  donquixote: ['doflamingo', 'bellamy'], krieg: ['donkrieg', 'gin'], blackcat: ['kuro'],
  arlong: ['arlong', 'hatchan'], sun: ['jinbe', 'arlong', 'hatchan'], cipherpol: ['lucci', 'kaku', 'kalifa', 'whoswho'],
  galleyla: ['paulie', 'lucci', 'kaku', 'kalifa'], shandia: ['wyper'], blackdrum: ['wapol'],
  thrillerbark: ['perona'], bartoclub: ['bartolomeo'], grandfleet: ['luffy', 'bartolomeo'],
  alabasta: ['vivi'], impeldown: ['magellan'], skyarmy: ['enel'], firetank: ['bege'],
  bonney: ['bonney'], fallenmonk: ['urouge'], hawkins: ['hawkins'], onair: ['apoo'], drake: ['xdrake'],
  rumbar: ['brook'], blackbeard: ['aokiji'], bellamy: ['bellamy'],
};
const CAPTAINS = {
  luffy: ['strawhat', 'grandfleet'], whitebeard: ['whitebeard'], kaido: ['beasts'], bigmom7: ['bigmom'],
  kid: ['kid'], buggy: ['crossguild'], crocodile: ['baroque'], doflamingo: ['donquixote'],
  donkrieg: ['krieg'], kuro: ['blackcat'], arlong: ['arlong'], jinbe: ['sun'],
  bartolomeo: ['bartoclub'], bege: ['firetank'], bonney: ['bonney'], urouge: ['fallenmonk'],
  hawkins: ['hawkins'], apoo: ['onair'], xdrake: ['drake'], brook: ['rumbar'], bellamy: ['bellamy'],
};
const aura = (label, stat, amount, range = 240) => Object.freeze({ label, stat, amount, range,
  description: `Nearby living crew gain ${Math.round(amount * 100)}% ${stat === 'speed' ? 'attack speed' : 'attack'}. Only the strongest aura of each type applies.` });
const LEADER_AURAS = {
  luffy: aura('Captain’s Courage', 'attack', .08), whitebeard: aura('A Father’s Rally', 'speed', .1),
  kaido: aura('Emperor’s Might', 'attack', .1), bigmom7: aura('Queen’s Command', 'attack', .12),
  garp7: aura('Hero’s Training', 'attack', .1), sabo7: aura('Flame of Freedom', 'speed', .1),
  belobetty: aura('Revolutionary Encouragement', 'attack', .08), buggy: aura('Showman’s Rally', 'speed', .06),
};
for (const character of CHARACTERS) {
  character.allegiances = Object.keys(CREW_MEMBERS).filter(id => CREW_MEMBERS[id].includes(character.id));
  character.captainOf = CAPTAINS[character.id] || [];
  character.aura = LEADER_AURAS[character.id] || null;
  character.expansion = ['bigmom7', 'garp7', 'sabo7', 'rayleigh', 'oden'].includes(character.id) || CHARACTERS.indexOf(character) >= 50 ? 2 : 1;
}
export const CHARACTER_BY_ID = Object.assign(Object.create(null), Object.fromEntries(CHARACTERS.map(c => [c.id, c])));
export const ENCOUNTERS = [
  { id: 1, name: 'Orange Town', chapter: 'EAST BLUE', description: 'A small pirate crew and swift claw strikes make a gentle first test.', enemies: ['buggy', 'kuro', 'vivi'], scale: 0.72 },
  { id: 2, name: 'Arlong Park', chapter: 'EAST BLUE', description: 'Break a siege of sawteeth, six swords and concealed weapons.', enemies: ['arlong', 'hatchan', 'donkrieg'], scale: 0.83 },
  { id: 3, name: 'Alabasta Crossroads', chapter: 'PARADISE', description: 'Sandstorms, wax traps and iron restraints test your support skills.', enemies: ['crocodile', 'bonclay', 'hina', 'mr3'], scale: 0.82 },
  { id: 4, name: 'Skypiea Storm', chapter: 'PARADISE', description: 'Read the initiative order to survive lightning, flame and rope snares.', enemies: ['enel', 'wyper', 'usopp', 'paulie'], scale: 0.9 },
  { id: 5, name: 'Enies Lobby', chapter: 'PARADISE', description: 'Careful healing and focused attacks overcome Six Powers and soap tricks.', enemies: ['lucci', 'kaku', 'kalifa', 'tashigi', 'franky'], scale: 0.89 },
  { id: 6, name: 'Impel Down', chapter: 'NEW WORLD', description: 'Cleanse venom and break through a scrap-armored blockade.', enemies: ['magellan', 'crocodile', 'wapol', 'queen', 'perona'], scale: 0.98 },
  { id: 7, name: 'New World Crossfire', chapter: 'NEW WORLD', description: 'Spring rushes, iron-ball tonfa and soap snares demand a coordinated crew.', enemies: ['katakuri', 'kaku', 'kalifa', 'bellamy', 'gin'], scale: 1.03 },
  { id: 8, name: 'Onigashima', chapter: 'APEX', description: 'Face the Beast, ancient Zoans and a swift claw ambusher in this dream match. Merge duplicates to strengthen your crew.', enemies: ['kaido', 'kuro', 'queen', 'jack', 'yamato'], scale: 1.09 },
  { id: 9, name: 'Clash at Marineford', chapter: 'APEX', description: 'An original dream-match finale against tremors, magma, gravity, ice and living forests.', enemies: ['whitebeard', 'akainu', 'fujitora', 'aokiji', 'ryokugyu'], scale: 1.15 },
];
