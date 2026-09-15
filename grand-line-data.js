/* Original fan-game rules; names and power themes are anchored to official character profiles. */
export const VERSION = '3.1.0';
// Retired collection IDs migrate to these current cards; future seven-star
// editions remain separate from the obtainable roster and pack draw pools.
export const RETIRED_CHARACTER_REPLACEMENTS = {
  shanks: 'wyper', blackbeard: 'kaku', bigmom: 'wapol', kizaru: 'hina',
  sengoku: 'paulie', garp: 'donkrieg', mihawk: 'hatchan', hancock: 'kalifa',
};
export const FUTURE_EXPANSION_CHARACTERS = [
  { id: 'shanks', name: 'Shanks', stars: 7 },
  { id: 'blackbeard', name: 'Marshall D. Teach', stars: 7 },
  { id: 'bigmom', name: 'Charlotte Linlin', stars: 7 },
  { id: 'kizaru', name: 'Admiral Kizaru', stars: 7 },
  { id: 'sengoku', name: 'Sengoku', stars: 7 },
  { id: 'garp', name: 'Monkey D. Garp', stars: 7 },
  { id: 'mihawk', name: 'Dracule Mihawk', stars: 7 },
  { id: 'hancock', name: 'Boa Hancock', stars: 7 },
];
export const STARTER_IDS = ['luffy', 'zoro', 'nami', 'usopp', 'chopper'];
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
  { title: 'Law: surgeon and Op-Op powers', url: 'https://one-piece.com/character/law/index.html' },
  { title: 'Koby: Marine training and Observation Haki', url: 'https://one-piece.com/character/Coby/index.html' },
  { title: 'Fujitora: gravity', url: 'https://one-piece.com/character/fujitora/index.html' },
  { title: 'Ryokugyu: forest power', url: 'https://one-piece.com/character/Aramaki/index.html' },
  { title: 'Enel and King: lightning and Lunarian flame', url: 'https://www.bandainamcoent.com/news/one-piece-pirate-warriors-4-special-new-dlc-adds-three-characters' },
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
];

const E = (type, amount = 0, duration = 0, extra = {}) => ({ type, amount, duration, ...extra });
const S = (name, target, power, kind, effects = [], cost, cooldown) => ({ name, target, power, kind, effects, cost, cooldown });
const P = (name, type, value, description) => ({ name, type, value, description });
const COLORS = { rubber: '#f5b45f', steel: '#a7e3c2', storm: '#e8cf6b', plant: '#8dd68e', fire: '#ff896b', medicine: '#f59cbd', bloom: '#d49ee6', machine: '#72cce6', soul: '#bfb1ff', water: '#65bdda', haki: '#f38293', ice: '#a1e6fa', magnet: '#b798ce', shell: '#a8d7e8', rope: '#d0af85', soap: '#e8b7db', sand: '#d9bd79', string: '#e991bf', smoke: '#bacbdb', light: '#f7e394', gravity: '#be9be4', dark: '#af94dd', mochi: '#debab6', dragon: '#97c5f8', poison: '#c394df', earth: '#dca986', spirit: '#bddb8b', electric: '#b1e5fc', venom: '#bb87d9', magma: '#ff7754' };
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
  C('ace', 'Portgas D. Ace', 'Fire Fist', 5, 'Striker', 'fire', 'Whitebeard’s fiery commander turns flame into sweeping, explosive attacks.',
    P('Living Flame', 'burn-immune', 1, 'Immune to burn damage and the burn status.'), [
      S('Fire Gun', 'enemy', 1.0, 'fire'),
      S('Hiken: Fire Fist', 'enemy', 1.65, 'fire', [E('burn', 0.32, 2)]),
      S('Great Flame Commandment', 'all-enemies', 1.5, 'fire', [E('burn', 0.25, 2)]),
    ], 'https://one-piece.com/character/ace/index.html'),
  C('sabo', 'Sabo', 'Flame Emperor', 5, 'Striker', 'fire', 'The Revolutionary Army’s chief of staff combines Dragon Claw martial arts with flame.',
    P('Revolutionary Resolve', 'execute', 0.22, 'Deal 22% more damage to enemies below half health.'), [
      S('Dragon Claw', 'enemy', 1.05, 'punch'),
      S('Dragon’s Breath', 'all-enemies', 1.1, 'earth', [E('weaken', 0.2, 2)]),
      S('Flame Dragon King', 'enemy', 2.5, 'fire', [E('burn', 0.3, 2)]),
    ]),
  C('law', 'Trafalgar Law', 'Surgeon of Death', 6, 'Tactician', 'light', 'ROOM turns the battlefield into an operating theater governed by the Op-Op Fruit.',
    P('Surgical Precision', 'pierce', 0.35, 'Ignore 35% of enemy defense.'), [
      S('Kikoku Cut', 'enemy', 1.0, 'slash'),
      S('ROOM: Shambles', 'ally', 0, 'heal', [E('heal', 1.8), E('cleanse'), E('shield', 0.7)]),
      S('K-ROOM: Shock Wille', 'enemy', 2.5, 'lightning', [E('pierce'), E('weaken', 0.25, 2)]),
    ], 'https://one-piece.com/character/law/index.html'),
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
  C('king', 'King', 'The Conflagration', 5, 'Guardian', 'fire', 'Lunarian flames and an ancient pteranodon form combine endurance with aerial power.',
    P('Lunarian Flame', 'burn-immune', 1, 'Immune to burn damage and the burn status.'), [
      S('Imperial Wing', 'enemy', 1.08, 'slash'),
      S('Imperial Flame', 'enemy', 1.65, 'fire', [E('burn', 0.3, 2)]),
      S('Great Imperial Flaming Wings', 'all-enemies', 1.65, 'dragon', [E('burn', 0.22, 2)]),
    ]),
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

const VERIFIED_PROFILE_SLUGS = {
  luffy: 'luffy', zoro: 'zoro', nami: 'nami', brook: 'brook', wyper: 'Wyper', ace: 'ace', sabo: 'sabo', law: 'law', kid: 'kid', killer: 'killer',
  kalifa: 'Kalifa', hatchan: 'Hacchan', crocodile: 'Crocodile', doflamingo: 'doflamingo', buggy: 'Buggy', smoker: 'smoker', tashigi: 'tashigi',
  koby: 'Coby', donkrieg: 'Don_Krieg', paulie: 'Paulie', hina: 'Hina', aokiji: 'kuzan', fujitora: 'fujitora', ryokugyu: 'Aramaki',
  kaku: 'Kaku', wapol: 'Wapol', katakuri: 'Charlotte_Katakuri', marco: 'marco', king: 'King', queen: 'Queen', jack: 'Jack',
  lucci: 'Rob_Lucci', perona: 'Perona', bartolomeo: 'bartolomeo', bonclay: 'Bon_Clay_Mr2', carrot: 'carrot', vivi: 'Nefeltari_Vivi', arlong: 'Arlong',
  magellan: 'Magellan', kaido: 'Kaido', whitebeard: 'edward_newgate', akainu: 'Sakazuki',
};
for (const character of CHARACTERS) {
  const slug = VERIFIED_PROFILE_SLUGS[character.id];
  if (slug) character.source = `https://one-piece.com/character/${slug}/index.html`;
  else if (['usopp', 'sanji', 'chopper', 'robin', 'franky'].includes(character.id)) character.source = LORE_SOURCES[1].url;
  else if (character.id === 'enel') character.source = LORE_SOURCES[12].url;
}
export const CHARACTER_BY_ID = Object.assign(Object.create(null), Object.fromEntries(CHARACTERS.map(c => [c.id, c])));
export const ENCOUNTERS = [
  { id: 1, name: 'Orange Town', chapter: 'EAST BLUE', description: 'A small pirate crew makes a gentle first test.', enemies: ['buggy', 'tashigi', 'vivi'], scale: 0.72 },
  { id: 2, name: 'Arlong Park', chapter: 'EAST BLUE', description: 'Break a siege of sawteeth, six swords and concealed weapons.', enemies: ['arlong', 'hatchan', 'donkrieg'], scale: 0.83 },
  { id: 3, name: 'Alabasta Crossroads', chapter: 'PARADISE', description: 'Sandstorms and iron restraints test your support skills.', enemies: ['crocodile', 'bonclay', 'hina', 'tashigi'], scale: 0.82 },
  { id: 4, name: 'Skypiea Storm', chapter: 'PARADISE', description: 'Read the initiative order to survive lightning, flame and rope snares.', enemies: ['enel', 'wyper', 'usopp', 'paulie'], scale: 0.9 },
  { id: 5, name: 'Enies Lobby', chapter: 'PARADISE', description: 'Careful healing and focused attacks overcome Six Powers and soap tricks.', enemies: ['lucci', 'kaku', 'kalifa', 'tashigi', 'franky'], scale: 0.89 },
  { id: 6, name: 'Impel Down', chapter: 'NEW WORLD', description: 'Cleanse venom and break through a scrap-armored blockade.', enemies: ['magellan', 'crocodile', 'wapol', 'queen', 'perona'], scale: 0.98 },
  { id: 7, name: 'New World Crossfire', chapter: 'NEW WORLD', description: 'Mochi, swordplay and soap snares demand a coordinated five-card crew.', enemies: ['katakuri', 'kaku', 'kalifa', 'king', 'sabo'], scale: 1.03 },
  { id: 8, name: 'Onigashima', chapter: 'APEX', description: 'Face the Beast and his All-Stars. Merge duplicates to strengthen your crew.', enemies: ['kaido', 'king', 'queen', 'jack', 'yamato'], scale: 1.09 },
  { id: 9, name: 'Clash at Marineford', chapter: 'APEX', description: 'An original dream-match finale against tremors, magma, gravity, ice and living forests.', enemies: ['whitebeard', 'akainu', 'fujitora', 'aokiji', 'ryokugyu'], scale: 1.15 },
];
