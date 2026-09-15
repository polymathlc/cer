// Each attack has a footprint. Skill target labels in the card game describe
// allegiance, not permission to damage every enemy on the defense map.
const shot = (shape, options = {}) => Object.freeze({ shape, speed: 520, rangeMultiplier: 1,
  width: 30, radius: 76, angle: Math.PI / 5, bounces: 4, chainRange: 88, ...options });
const S = options => shot('single', options);
const L = options => shot('line', options);
const C = options => shot('cone', options);
const R = options => shot('radial', options);
const B = options => shot('splash', options);
const H = options => shot('chain', options);
const A = () => shot('support');
const profile = (label, description, range, skills) => Object.freeze({ label, description, range, shape: skills[0].shape, skills: Object.freeze(skills) });

export const DEFENSE_PROFILES = Object.freeze({
  luffy: profile('Elastic brawler', 'Pistol punches through a narrow line; Gatling sweeps a cone; Gear Five strikes around him.', 210, [L({ width: 25, speed: 580 }), C({ angle: .62 }), R({ radius: 185, speed: 360 })]),
  zoro: profile('Piercing swordsman', 'Every sword slash cuts a line through multiple enemies. Aim along a straight stretch of road.', 250, [L({ width: 30, speed: 480 }), L({ width: 42, rangeMultiplier: 1.12 }), L({ width: 64, rangeMultiplier: 1.2 })]),
  nami: profile('Chain lightning', 'Weather strikes jump between nearby raiders; Zeus reaches a larger cluster and slows it.', 245, [H({ bounces: 2, chainRange: 68 }), H({ bounces: 3 }), H({ bounces: 6, chainRange: 110 })]),
  usopp: profile('Long-range bombardier', 'Kabuto picks off distant targets. Bombgrass explodes around its landing point; Impact Wolf knocks out a tighter group.', 315, [S({ speed: 690 }), B({ radius: 102, speed: 370 }), B({ radius: 58, speed: 490 })]),
  sanji: profile('Flaming duelist', 'Fast kicks focus one enemy. Diable Jambe burns a small group; Ifrit Jambe drives through a narrow cone.', 190, [S({ speed: 750 }), B({ radius: 48, speed: 680 }), C({ angle: .38, speed: 690 })]),
  chopper: profile('Frontline doctor', 'Heavy Point swats a short cone. Treatments cleanse nearby allies, and medicine revives fallen defenders.', 250, [C({ angle: .45, rangeMultiplier: .7 }), A(), A()]),
  robin: profile('Crowd restraint', 'Clutch locks down one enemy; giant hands hit an area; Demonio overwhelms a priority target.', 230, [S(), B({ radius: 105 }), S({ speed: 410 })]),
  franky: profile('Beam and artillery', 'Strong Right is a straight punch. Radical Beam pierces a long line, while General Franky blasts a cluster.', 235, [L({ width: 24 }), L({ width: 40, rangeMultiplier: 1.25, speed: 820 }), B({ radius: 105 })]),
  brook: profile('Freezing fencer', 'Thin sword waves pass through a file of enemies. Soul Solid freezes its line; music strengthens nearby allies.', 240, [L({ width: 24 }), L({ width: 38, speed: 600 }), A()]),
  jinbe: profile('Water-wave guardian', 'Karate shockwaves sweep a cone; Shark Brick Fist pierces a line; the shoulder throw washes enemies around him.', 210, [C({ angle: .5 }), L({ width: 45 }), R({ radius: 205, speed: 390 })]),
  wyper: profile('Explosive vanguard', 'Bazooka shells burst on impact; fire rounds scorch a wider area; Reject Dial focuses an armored threat.', 275, [B({ radius: 55 }), B({ radius: 105, speed: 390 }), S({ speed: 700 })]),
  bellamy: profile('Spring-lane brawler', 'Spring Punch runs down a narrow lane; Spring Snipe drives farther and can stun; Spring Hopper ricochets through a forward cone. Repeated attacks build momentum.', 225, [L({ width: 25, speed: 670 }), L({ width: 38, rangeMultiplier: 1.18, speed: 820 }), C({ angle: .72, speed: 730 })]),
  gin: profile('Tonfa chokepoint guard', 'Twin Tonfa sweeps a short cone, Iron-Ball Crush pierces one armored target, and Spinning Tonfa can stun enemies all around him. Place him beside a tight bend.', 185, [C({ angle: .72, speed: 570 }), S({ speed: 650 }), R({ radius: 170, speed: 470 })]),
  mr3: profile('Wax trap architect', 'Wax Harpoon slows a narrow file; Candle Wall shields a nearby ally; Giant Candle Set hardens over a landing area to slow and sometimes stun its crowd.', 235, [L({ width: 24, speed: 410 }), A(), B({ radius: 110, speed: 330 })]),
  kid: profile('Magnetic siege', 'Metal Arm hits a small area, Punk Gibson smashes a larger cluster, and Damned Punk fires a piercing rail line.', 260, [B({ radius: 42 }), B({ radius: 82 }), L({ width: 48, speed: 850, rangeMultiplier: 1.2 })]),
  killer: profile('Sonic reaper', 'Punisher blades cut a cone, Sonic Scythe crosses a line, and the blade cyclone strikes around him.', 205, [C({ angle: .42 }), L({ width: 34 }), R({ radius: 180 })]),
  kalifa: profile('Bubble control', 'Finger Pistol focuses one foe; bubbles weaken a cluster; Golden Hour washes over enemies around her.', 225, [S(), B({ radius: 80, speed: 350 }), R({ radius: 210, speed: 300 })]),
  hatchan: profile('Six-sword sweeper', 'Six swords cover a broad cone. Ink splashes a crowd; his waltz cuts enemies on every side.', 195, [C({ angle: .75 }), B({ radius: 100 }), R({ radius: 180 })]),
  crocodile: profile('Sandstorm zone', 'His hook singles out an enemy, Sables bursts into a sandstorm, and Ground Death spreads out from his feet.', 240, [S(), B({ radius: 115, speed: 370 }), R({ radius: 225, speed: 290 })]),
  doflamingo: profile('String crossfire', 'Five Color Strings rake a cone; Parasite controls a target; Holy Bullets pierce a broad line.', 275, [C({ angle: .4 }), S(), L({ width: 72, speed: 700 })]),
  buggy: profile('Knife and cannon', 'A detached knife singles out a foe, his chop-chop blades spin around him, and Muggy Ball blasts a dense cluster.', 235, [S(), R({ radius: 165 }), B({ radius: 115, speed: 340 })]),
  smoker: profile('Smoke screen', 'The jitte focuses one enemy. White Out spreads across a cluster; White Blow travels through a wide line.', 230, [S(), B({ radius: 82 }), L({ width: 76, speed: 370 })]),
  tashigi: profile('Guarding blade', 'Shigure sends a narrow sword cut along the road. Crossguard protects an ally; Haki Blade extends her piercing line.', 220, [L({ width: 25 }), A(), L({ width: 36, rangeMultiplier: 1.2 })]),
  koby: profile('Resolute impact', 'Soru picks off a single enemy; protective resolve braces him; Honesty Impact sends a broad shockwave cone.', 210, [S({ speed: 740 }), A(), C({ angle: .78, rangeMultiplier: 1.15 })]),
  donkrieg: profile('Poison bombardment', 'Concealed shots strike one enemy, the battle spear explodes, and MH5 covers a wide landing area in poison.', 255, [S(), B({ radius: 75 }), B({ radius: 135, speed: 320 })]),
  paulie: profile('Rope snare', 'Rope strikes travel in a thin line. He protects an ally, then binds enemies in a broad forward cone.', 240, [L({ width: 22 }), A(), C({ angle: .8, speed: 390 })]),
  hina: profile('Iron-bar trap', 'Iron Bind runs through a narrow file. Black Cage traps a small cluster; her enclosure restrains enemies around her.', 215, [L({ width: 26 }), B({ radius: 62 }), R({ radius: 205, speed: 330 })]),
  aokiji: profile('Freezing perimeter', 'Ice Saber cuts a line; Ice Time freezes a cluster; Ice Age expands across the ground around him.', 255, [L({ width: 32 }), B({ radius: 82 }), R({ radius: 245, speed: 310 })]),
  fujitora: profile('Gravity artillery', 'The gravity blade cleaves a cone, Raging Tiger cuts a broad line, and Meteor Descent devastates its landing area.', 285, [C({ angle: .48 }), L({ width: 100, speed: 410 }), B({ radius: 140, speed: 300 })]),
  ryokugyu: profile('Living forest', 'Roots pierce a line, nutrient drain links nearby enemies, and Giant Forest grows around him.', 240, [L({ width: 36, speed: 390 }), H({ bounces: 3, chainRange: 76 }), R({ radius: 235, speed: 270 })]),
  kaku: profile('Four-sword crosscut', 'Four swords sweep a cone, his neck strikes along a line, and Amane Dachi circles the whole position.', 230, [C({ angle: .58 }), L({ width: 25, rangeMultiplier: 1.2 }), R({ radius: 220 })]),
  wapol: profile('Armored cannon', 'Munch-Munch Bite focuses a target, the factory armors him, and Tongue Cannon explodes into a cluster.', 225, [S(), A(), B({ radius: 100, speed: 400 })]),
  katakuri: profile('Mochi pressure', 'Mochi Punch follows a thin line, the thrust reaches farther, and Buzz Cut smashes a compact crowd.', 240, [L({ width: 27 }), L({ width: 35, rangeMultiplier: 1.18 }), B({ radius: 76 })]),
  yamato: profile('Glacial striker', 'A kanabo sweep hits a cone, Glacier Fang shoots a freezing line, and White Serpent pierces a longer path.', 240, [C({ angle: .55 }), L({ width: 48 }), L({ width: 58, rangeMultiplier: 1.12 })]),
  marco: profile('Phoenix rescue', 'Phoenix talons sweep a short cone; blue flames heal nearby allies; Phoenix Rescue revives a fallen defender.', 285, [C({ angle: .45, rangeMultiplier: .72 }), A(), A()]),
  kuro: profile('Silent claw skirmisher', 'Fast Cat Claws slice a narrow line. Silent Step Cut returns quickly; Shakushi extends a wider line and weakens survivors. Straight corridors reward his rapid footwork.', 215, [L({ width: 20, speed: 850 }), L({ width: 28, speed: 1000 }), L({ width: 50, rangeMultiplier: 1.15, speed: 950 })]),
  queen: profile('Plague battery', 'Brachio Slam crushes a cone, Black Coffee Laser pierces a line, and plague shells poison a wide area.', 250, [C({ angle: .58 }), L({ width: 32, speed: 850 }), B({ radius: 125, speed: 360 })]),
  jack: profile('Mammoth bulwark', 'Mammoth Swing catches a broad cone. Ancient Trample shakes enemies around him; Drought’s Advance braces his defense.', 195, [C({ angle: .85 }), R({ radius: 190, speed: 330 }), A()]),
  enel: profile('Thunder network', 'El Thor arcs to nearby enemies, Thunder Dragon chains farther, and Raigo detonates over a large cluster.', 285, [H({ bounces: 3 }), H({ bounces: 5, chainRange: 105 }), B({ radius: 135, speed: 420 })]),
  lucci: profile('Six Powers assassin', 'Finger Pistol focuses one enemy. Tempest Kick travels through a line; Six King Gun pierces armor in a tight cone.', 215, [S({ speed: 760 }), L({ width: 36 }), C({ angle: .32, speed: 720 })]),
  perona: profile('Hollow bombardier', 'Mini Hollow seeks one enemy, Negative Hollow jumps through a small group, and Kamikaze explodes over a crowd.', 255, [S({ speed: 380 }), H({ bounces: 3, chainRange: 65, speed: 380 }), B({ radius: 120, speed: 340 })]),
  bartolomeo: profile('Barrier rampart', 'Barrier Fist hits one target. Barrier Wall protects an ally; Barrier Crash sweeps a wide cone and shields nearby crew.', 210, [S(), A(), C({ angle: .8, speed: 370 })]),
  bonclay: profile('Support dancer', 'Swan Arabesque sweeps a short cone, a clone feint weakens one enemy, and friendship restores nearby allies.', 250, [C({ angle: .55, rangeMultiplier: .7 }), S(), A()]),
  carrot: profile('Electro skirmisher', 'Electro Claw hits a target, Electrical Luna chains through nearby foes, and Sulong Rush tears through a fast narrow line.', 210, [S({ speed: 780 }), H({ bounces: 4, chainRange: 75 }), L({ width: 40, speed: 850 })]),
  vivi: profile('Crew rally', 'Peacock Slashers sweep a cone. Alabasta’s rally shields nearby allies; her plea weakens enemies in a wide area around her.', 270, [C({ angle: .6, rangeMultiplier: .7 }), A(), R({ radius: 255, speed: 400 })]),
  arlong: profile('Sawtooth ambusher', 'Shark darts run through a line, Kiribachi sweeps a broad cone, and a tooth assault finishes one target.', 205, [L({ width: 28 }), C({ angle: .85 }), S()]),
  magellan: profile('Venom zones', 'Venom Touch hits a small area, Hydra poisons a larger landing zone, and Venom Demon spreads around him.', 240, [B({ radius: 42 }), B({ radius: 120, speed: 340 }), R({ radius: 225, speed: 280 })]),
  kaido: profile('Dragon annihilator', 'Thunder Bagua crushes a cone; Bolo Breath burns a long broad line; Flaming Drum Dragon explodes over a huge cluster.', 270, [C({ angle: .58 }), L({ width: 94, rangeMultiplier: 1.18, speed: 460 }), B({ radius: 150, speed: 350 })]),
  whitebeard: profile('Guandao and quake', 'Murakumogiri cleaves a wide cone. Seaquake ruptures a broad line; Heaven and Earth Tremor expands all around him.', 255, [C({ angle: .85, speed: 440 }), L({ width: 112, rangeMultiplier: 1.1, speed: 330 }), R({ radius: 250, speed: 290 })]),
  akainu: profile('Magma siege', 'Great Eruption splashes molten rock, Hell Hound burns through a line, and Meteor Volcano blasts a huge landing area.', 270, [B({ radius: 68, speed: 430 }), L({ width: 58, speed: 510 }), B({ radius: 150, speed: 310 })]),
});

export const getDefenseProfile = characterId => DEFENSE_PROFILES[typeof characterId === 'string' ? characterId : characterId?.characterId] || null;
export function getDefenseSkillProfile(actorOrId, skillOrId) {
  const profile = getDefenseProfile(actorOrId);
  if (!profile) return null;
  const skillId = typeof skillOrId === 'string' ? skillOrId : skillOrId?.id;
  const index = Number(String(skillId || '').split('-').at(-1));
  const base = profile.skills[Number.isInteger(index) && index >= 0 && index < 3 ? index : 0];
  const reach = typeof actorOrId === 'object' && actorOrId.specialization === 'reach';
  return { ...base, width: base.width * (reach ? 1.3 : 1), radius: base.radius * (reach ? 1.25 : 1),
    chainRange: base.chainRange * (reach ? 1.25 : 1), bounces: base.bounces + (reach && base.shape === 'chain' ? 1 : 0),
    angle: base.angle * (reach ? 1.12 : 1) };
}
