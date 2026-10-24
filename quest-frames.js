/* @ds-bundle: {"format":4,"namespace":"QuestFrames","components":[{"name":"QuestPage"},{"name":"PixelBorder"},{"name":"QuestBanner"},{"name":"BossBar"},{"name":"HeroCard"},{"name":"QuestionGem"},{"name":"CompanionTip"},{"name":"XPTrack"},{"name":"LootChest"}]} */
/* Polymath Quest Frames: every worksheet page is a level of Wheel Quest.
   One classic script, no imports, no network. Every picture is an SVG <image>
   or inline SVG so the frame prints with "Background graphics" switched off. */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var doc = global.document;

  /* ================================================================
     PAGE GEOMETRY. A4 at 96 css px per inch: 794 x 1123. These numbers
     repeat the spacing tokens (frame-inset, frame-band, safe-*) because
     the rampart is drawn in SVG user units. Change them together.
     ================================================================ */
  var PAGE = Object.freeze({
    w: 794, h: 1123,
    inset: 20,          /* --frame-inset */
    band: 30,           /* --frame-band  */
    rim: 6,             /* outline + gold rim inside the band */
    safeX: 64,          /* --safe-x */
    safeTop: { start: 216, trail: 124, finale: 124, calm: 92 },   /* --safe-top-start / --safe-top-trail */
    safeBottom: { start: 128, trail: 128, finale: 150, calm: 92 } /* --safe-bottom / --safe-bottom-finale */
  });

  /* ================================================================
     ART REGISTRY. Every picture is an ORIGINAL file from the three repos,
     uploaded unchanged to this design system. `blob` is its asset id here;
     `repo` + `path` is where the same bytes live in the source repository.
     ================================================================ */
  var ART = {
    'logo':            ['83e4a0272719a2419d230ac90e49851c', 'cer',    'assets/branding/polymath-learning-centre.png', 2681, 1957],
    'hero-warrior':    ['d92c22315573e65a6757bd9305cb7cd9', 'anskey', 'assets/battle-pixel/warrior.png', 1254, 1254],
    'hero-mage':       ['71d1899903effa94b98fd0c48364419d', 'anskey', 'assets/battle-pixel/mage.png', 1254, 1254],
    'hero-ranger':     ['95c4646783dfbf62a1b921ddf4593f42', 'anskey', 'assets/battle-pixel/ranger.png', 1254, 1254],
    'hero-cleric':     ['db87daea9e8f962e048af612c2db9e1a', 'anskey', 'assets/battle-pixel/cleric.png', 1254, 1254],
    'enemy-goblin':        ['f3154ce0c7e21189e65eeef1a2a9c6aa', 'anskey', 'assets/battle-pixel/goblin.png', 1254, 1254],
    'enemy-goblin-shaman': ['8c4d646e2eeb7308969fbc1a3e08bde0', 'anskey', 'assets/battle-pixel/goblin-shaman.png', 1254, 1254],
    'enemy-slime':         ['46417b7efcac3f51d11c623efa5bfe55', 'anskey', 'assets/battle-pixel/slime.png', 1254, 1254],
    'enemy-golem':         ['f9a196d67d13b237bab6877d6e8f571d', 'anskey', 'assets/battle-pixel/golem.png', 1254, 1254],
    'enemy-dragon':        ['1df1aae26a3b154ebc298de68d5cb980', 'anskey', 'assets/battle-pixel/dragon.png', 1254, 1254],
    'enemy-lich':          ['03709414aa6b3ae08660f9648f17f35a', 'anskey', 'assets/battle-pixel/lich.png', 1254, 1254],
    'bosses-01': ['c84fbd18b3e69d71aa3bb3bfb8250231', 'anskey', 'assets/battle-pixel/bosses/atlas-01.png', 1983, 793],
    'bosses-02': ['e922d7d562ed8eff93650c25058e8a5b', 'anskey', 'assets/battle-pixel/bosses/atlas-02.png', 1983, 793],
    'bosses-03': ['a1ecd2cbada2584f147f4a5d40b052ec', 'anskey', 'assets/battle-pixel/bosses/atlas-03.png', 1983, 793],
    'bosses-04': ['bb5c6baf2a934f16bdc0a2ccd0b4c401', 'anskey', 'assets/battle-pixel/bosses/atlas-04.png', 1983, 793],
    'bosses-05': ['ca87986b9c5894195b4d38d1b53b6076', 'anskey', 'assets/battle-pixel/bosses/atlas-05.png', 1983, 793],
    'bosses-06': ['4bed03fc58c69a5a2f9dfbf6b9a48272', 'anskey', 'assets/battle-pixel/bosses/atlas-06.png', 1983, 793],
    'bosses-07': ['651f285e73ab4663211f0ca80956f5af', 'anskey', 'assets/battle-pixel/bosses/atlas-07.png', 1983, 793],
    'bosses-08': ['4decba4c0b2851ff0b88bae2f14dce75', 'anskey', 'assets/battle-pixel/bosses/atlas-08.png', 1983, 793],
    'bosses-09': ['d892f4d24d9e0098225d7d23dd135ec6', 'anskey', 'assets/battle-pixel/bosses/atlas-09.png', 1983, 793],
    'bosses-10': ['4567f01d58dd74344e29fd8bcf549756', 'anskey', 'assets/battle-pixel/bosses/atlas-10.png', 1983, 793],
    'chest':     ['0b52c275fedea240689c50754dd392b3', 'anskey', 'assets/battle-pixel/chest-sheet.png', 2172, 724],
    'runes':     ['46cac1150b7f74d5b9beeeb5f7de626b', 'anskey', 'assets/battle-pixel/items/runes-1.png', 1254, 1254],
    'items-1':   ['0d53b3f62ddcdbc60ec2f34850e1ef2b', 'anskey', 'assets/battle-pixel/items/items-1.png', 1983, 793],
    'items-2':   ['e81c1996623e8fd3df05992ba1712394', 'anskey', 'assets/battle-pixel/items/items-2.png', 1983, 793],
    'items-3':   ['072c19c22e3f20f96e260e13bc53bbde', 'anskey', 'assets/battle-pixel/items/items-3.png', 1983, 793],
    'items-4':   ['c377e826bccfd9b3f960845b507c8459', 'anskey', 'assets/battle-pixel/items/items-4.png', 1983, 793],
    'items-5':   ['7b37fbdfeb12f67f1b33d86fe8a772f7', 'anskey', 'assets/battle-pixel/items/items-5.png', 1983, 793],
    'scene-forest':  ['50fb86823c03145299da80b8341bf147', 'anskey', 'assets/battle-pixel/adventure/forest.png', 640, 360],
    'scene-cavern':  ['d3c5056389dd3ab0cd9c48120465ca43', 'anskey', 'assets/battle-pixel/adventure/cavern.png', 640, 360],
    'scene-ruins':   ['eaf419c1c1b88c70976829b8b122225c', 'anskey', 'assets/battle-pixel/adventure/ruins.png', 640, 360],
    'scene-volcano': ['127d74ffdcd889a229ca5b3b6aae2c80', 'anskey', 'assets/battle-pixel/adventure/volcano.png', 640, 360],
    'orbit-welcome':   ['eaea65ea709187a90aa5164a13292cfd', 'tutor', 'assets/companions/orbit-welcome.webp', 512, 512],
    'orbit-thinking':  ['5582886248235b06f711136c146a2348', 'tutor', 'assets/companions/orbit-thinking.webp', 512, 512],
    'orbit-encourage': ['4f44c8d6a78e48186764c64cad318c42', 'tutor', 'assets/companions/orbit-encourage.webp', 512, 512],
    'orbit-celebrate': ['c1c590140a7ab0309f36e7d725549052', 'tutor', 'assets/companions/orbit-celebrate.webp', 512, 512],
    'pip-welcome':     ['ab91339f9192080f3ed471b4f55b2442', 'tutor', 'assets/companions/pip-welcome.webp', 512, 512],
    'pip-thinking':    ['fc010eeec14ddcd1ec3e82f366342023', 'tutor', 'assets/companions/pip-thinking.webp', 512, 512],
    'pip-encourage':   ['bc0bbdeb54f288b8103edf88f0fff51f', 'tutor', 'assets/companions/pip-encourage.webp', 512, 512],
    'pip-celebrate':   ['9488a67c6fb6882cd9e8252891c2cc54', 'tutor', 'assets/companions/pip-celebrate.webp', 512, 512],
    'nova-welcome':    ['a5523ee54c39cb6f541f6ef768b9da15', 'tutor', 'assets/companions/nova-welcome.webp', 512, 512],
    'nova-thinking':   ['78702f52d4fc180c8d7fab56a9ece424', 'tutor', 'assets/companions/nova-thinking.webp', 512, 512],
    'nova-encourage':  ['1698f4cdb1632794276110fe7d17c662', 'tutor', 'assets/companions/nova-encourage.webp', 512, 512],
    'nova-celebrate':  ['2ac20f85df24b52c9453ad15d4179406', 'tutor', 'assets/companions/nova-celebrate.webp', 512, 512],
    'math-icons':    ['5b8451a930ff09314787d17a1e3a75e5', 'cer', 'assets/worksheet-covers/math-icons-v2.png', 1254, 1254],
    'science-icons': ['a0a4ebbce91f517fc8792e80dc4984a4', 'cer', 'assets/worksheet-covers/science-icons-v2.png', 1254, 1254]
  };

  var artMode = 'blob';
  var artBases = null;
  var artResolve = null;

  function artEntry(key) {
    var row = ART[key];
    if (!row) return null;
    return { key: key, blob: row[0], repo: row[1], path: row[2], w: row[3], h: row[4] };
  }

  function artUrl(key) {
    var e = artEntry(key);
    if (!e) return '';
    if (artMode === 'resolve' && artResolve) { try { var u = artResolve(e); if (typeof u === 'string' && u) return u; } catch (err) { /* fall through */ } }
    if (artMode === 'blob' || !artBases) return '/_blob/' + e.blob;
    var base = artBases[e.repo];
    if (typeof base !== 'string') return '/_blob/' + e.blob;
    if (base && base.charAt(base.length - 1) !== '/') base += '/';
    return base + e.path;
  }

  var art = {
    /* use('blob') serves this design system's uploads. use({anskey, cer, tutor})
       serves each repository's own copy: pass the folder each repo is served from. */
    use: function (mode) {
      if (mode === 'blob' || mode == null) { artMode = 'blob'; artBases = null; artResolve = null; return art; }
      if (typeof mode === 'object' && typeof mode.resolve === 'function') { artMode = 'resolve'; artResolve = mode.resolve; artBases = null; return art; }
      if (typeof mode === 'object') {
        artBases = {};
        ['anskey', 'cer', 'tutor'].forEach(function (k) {
          if (typeof mode[k] === 'string') artBases[k] = mode[k];
        });
        artMode = 'repo';
      }
      return art;
    },
    url: artUrl,
    entry: artEntry,
    keys: function () { return Object.keys(ART); },
    mode: function () { return artMode; }
  };

  /* ================================================================
     ATLASES. Uniform grids crop by column and row. The two subject icon
     sheets from the Science portal's covers have uneven gutters, so they
     crop at the transparent seams the portal measured (worksheet-cover.js).
     ================================================================ */
  function grid(key, cols, rows) { return { key: key, cols: cols, rows: rows }; }
  var ATLASES = {
    'chest': grid('chest', 4, 1),
    'runes': grid('runes', 4, 4),
    'math-icons': { key: 'math-icons', xs: [0, 344, 634, 940, 1254], ys: [0, 338, 636, 920, 1254] },
    'science-icons': { key: 'science-icons', xs: [0, 312, 638, 958, 1254], ys: [0, 338, 643, 933, 1254] }
  };
  for (var a = 1; a <= 10; a++) ATLASES['bosses-' + (a < 10 ? '0' + a : a)] = grid('bosses-' + (a < 10 ? '0' + a : a), 5, 2);
  for (var b = 1; b <= 5; b++) ATLASES['items-' + b] = grid('items-' + b, 5, 2);

  function cellOf(atlasKey, col, row) {
    var at = ATLASES[atlasKey];
    var e = artEntry(at ? at.key : atlasKey);
    if (!e) return null;
    if (!at) return { x: 0, y: 0, w: e.w, h: e.h, sheet: e };
    if (at.xs) {
      var c = clamp(int(col, 0), 0, at.xs.length - 2), r = clamp(int(row, 0), 0, at.ys.length - 2);
      return { x: at.xs[c], y: at.ys[r], w: at.xs[c + 1] - at.xs[c], h: at.ys[r + 1] - at.ys[r], sheet: e };
    }
    var cw = e.w / at.cols, ch = e.h / at.rows;
    var cc = clamp(int(col, 0), 0, at.cols - 1), rr = clamp(int(row, 0), 0, at.rows - 1);
    return { x: cc * cw, y: rr * ch, w: cw, h: ch, sheet: e };
  }

  /* ================================================================
     GAME DATA, exported from the game's own source files:
     battle-bosses.js (100 enemies), items/catalog.json (50 relics),
     items/runes-provenance.json (16 runes).
     BOSS_ROWS: [id, name, world, atlas (0 = a sprite of its own), col, row, rarity]
     ITEM_ROWS: [id, name, rarity, sheet, col, row]
     RUNE_ROWS: [id, name, rarity, col, row]
     ================================================================ */
  var BOSS_ROWS = [["brambleboar","Bramblehide Boar","forest",1,0,0,"common"],
    ["acornknight","Acorncap Knight","forest",1,1,0,"uncommon"],
    ["lanternowl","Lanternwing Owl","forest",1,2,0,"rare"],
    ["thornstag","Thorncrown Stag","forest",1,3,0,"epic"],
    ["rootmaw","Rootmaw Colossus","forest",1,4,0,"legendary"],
    ["sapserpent","Sapscale Serpent","forest",1,0,1,"uncommon"],
    ["fernmantis","Fernblade Mantis","forest",1,1,1,"rare"],
    ["puffspore","Puffspore Monarch","forest",1,2,1,"common"],
    ["barkwarden","Barkshield Warden","forest",1,3,1,"epic"],
    ["blossomwyvern","Blossomwing Wyvern","forest",1,4,1,"mythical"],
    ["mudmaw","Mudmaw Crocodile","swamp",2,0,0,"common"],
    ["bogwitch","Boglight Witch","swamp",2,1,0,"rare"],
    ["reedstalker","Reedcloak Stalker","swamp",2,2,0,"uncommon"],
    ["miretoad","Mirebell Toad","swamp",2,3,0,"epic"],
    ["mosslamprey","Mossjaw Lamprey","swamp",2,4,0,"uncommon"],
    ["willowwisp","Willowveil Wisp","swamp",2,0,1,"rare"],
    ["lilyhydra","Lilypad Hydra","swamp",2,1,1,"legendary"],
    ["rotcap","Rotcap Alchemist","swamp",2,2,1,"common"],
    ["sludgeknight","Sludgeplate Knight","swamp",2,3,1,"epic"],
    ["fenbasilisk","Fenfire Basilisk","swamp",2,4,1,"mythical"],
    ["cragram","Craghoof Ram","mountain",3,0,0,"common"],
    ["frosttalon","Frosttalon Eagle","mountain",3,1,0,"rare"],
    ["quartzback","Quartzback Armadillo","mountain",3,2,0,"uncommon"],
    ["cobaltrook","Cobalt Rook","mountain",3,3,0,"epic"],
    ["gravelmole","Gravelpaw Mole","mountain",3,4,0,"common"],
    ["summitogre","Summitclub Ogre","mountain",3,0,1,"rare"],
    ["avalancheape","Avalanche Ape","mountain",3,1,1,"legendary"],
    ["shardhorn","Shardhorn Ibex","mountain",3,2,1,"uncommon"],
    ["granitegryphon","Granitewing Gryphon","mountain",3,3,1,"epic"],
    ["ironpeak","Ironpeak Titan","mountain",3,4,1,"mythical"],
    ["coralcolossus","Coralcrest Colossus","ocean",4,0,0,"legendary"],
    ["pearlwitch","Pearlmoon Witch","ocean",4,1,0,"rare"],
    ["tidalorca","Tidalcrest Orca","ocean",4,2,0,"epic"],
    ["reefjaw","Reefjaw Shark","ocean",4,3,0,"common"],
    ["barnacleking","Barnacle King","ocean",4,4,0,"uncommon"],
    ["jellylantern","Jellylantern Seer","ocean",4,0,1,"rare"],
    ["kelpkraken","Kelpveil Kraken","ocean",4,1,1,"legendary"],
    ["seaglassdrake","Seaglass Drake","ocean",4,2,1,"epic"],
    ["shelloracle","Spiralshell Oracle","ocean",4,3,1,"uncommon"],
    ["abyssangler","Abysslight Angler","ocean",4,4,1,"mythical"],
    ["dunejackal","Duneboot Jackal","desert",5,0,0,"common"],
    ["mirageserpent","Miragecoil Serpent","desert",5,1,0,"epic"],
    ["ambercobra","Amberfang Cobra","desert",5,2,0,"uncommon"],
    ["glassscorpion","Glassclaw Scorpion","desert",5,3,0,"rare"],
    ["sunscarab","Sunplate Scarab","desert",5,4,0,"uncommon"],
    ["oasisdjinn","Oasiswell Djinn","desert",5,0,1,"legendary"],
    ["sandstonegiant","Sandstone Mason","desert",5,1,1,"rare"],
    ["brassvulture","Brasswing Vulture","desert",5,2,1,"common"],
    ["dustdancer","Dustveil Dancer","desert",5,3,1,"epic"],
    ["pharaohcat","Pharaohstar Cat","desert",5,4,1,"mythical"],
    ["ashminotaur","Ashhorn Minotaur","volcano",6,0,0,"legendary"],
    ["lavacrab","Lavashell Crab","volcano",6,1,0,"common"],
    ["emberwasp","Emberwing Wasp","volcano",6,2,0,"uncommon"],
    ["sootimp","Sootcap Imp","volcano",6,3,0,"common"],
    ["magmawyrm","Magmafin Wyrm","volcano",6,4,0,"epic"],
    ["furnaceknight","Furnaceplate Knight","volcano",6,0,1,"rare"],
    ["cinderphoenix","Cinderplume Phoenix","volcano",6,1,1,"legendary"],
    ["basaltbull","Basaltback Bull","volcano",6,2,1,"uncommon"],
    ["coalwitch","Coalglow Witch","volcano",6,3,1,"rare"],
    ["infernohound","Infernostar Hound","volcano",6,4,1,"mythical"],
    ["icetooth","Icetooth Walrus","ice",7,0,0,"common"],
    ["snowharpy","Snowfeather Harpy","ice",7,1,0,"rare"],
    ["rimegolem","Rimeblock Golem","ice",7,2,0,"uncommon"],
    ["wintermoth","Winterveil Moth","ice",7,3,0,"epic"],
    ["hoarfrostbear","Hoarfrost Bear","ice",7,4,0,"rare"],
    ["glacialturtle","Glacialback Turtle","ice",7,0,1,"uncommon"],
    ["frostcrown","Frostcrown Regent","ice",7,1,1,"legendary"],
    ["blizzardelk","Blizzardhoof Elk","ice",7,2,1,"epic"],
    ["aurorawyrm","Aurorascale Wyrm","ice",7,3,1,"mythical"],
    ["crystalpenguin","Crystalcap Penguin","ice",7,4,1,"common"],
    ["cogarachnid","Cogweb Arachnid","clockwork",8,0,0,"common"],
    ["steamrhino","Steamplate Rhino","clockwork",8,1,0,"rare"],
    ["copperjester","Coppercap Jester","clockwork",8,2,0,"uncommon"],
    ["clockmantis","Clockblade Mantis","clockwork",8,3,0,"epic"],
    ["mercurygargoyle","Mercurywing Gargoyle","clockwork",8,4,0,"legendary"],
    ["gearbehemoth","Gearjaw Behemoth","clockwork",8,0,1,"epic"],
    ["voltvulture","Voltwing Vulture","clockwork",8,1,1,"rare"],
    ["magnetmaw","Magnetmaw Mimic","clockwork",8,2,1,"uncommon"],
    ["prismdroid","Prismcore Droid","clockwork",8,3,1,"common"],
    ["chronotitan","Chronocrown Titan","clockwork",8,4,1,"mythical"],
    ["lunarcobra","Lunarcrown Cobra","cosmic",9,0,0,"rare"],
    ["sunlion","Sunmane Lion","cosmic",9,1,0,"legendary"],
    ["starmantis","Starlance Mantis","cosmic",9,2,0,"uncommon"],
    ["voidmanta","Voidveil Manta","cosmic",9,3,0,"epic"],
    ["cometgryphon","Cometwing Gryphon","cosmic",9,4,0,"legendary"],
    ["eclipseknight","Eclipseplate Knight","cosmic",9,0,1,"epic"],
    ["nebulajelly","Nebulabell Jelly","cosmic",9,1,1,"rare"],
    ["orbitgolem","Orbitstone Golem","cosmic",9,2,1,"uncommon"],
    ["constellastag","Constellacrown Stag","cosmic",9,3,1,"mythical"],
    ["cosmicwyrm","Cosmicscale Wyrm","cosmic",9,4,1,"mythical"],
    ["bookwyrm","Bookspine Wyrm","library",10,0,0,"rare"],
    ["candyking","Candystone King","library",10,1,0,"epic"],
    ["mirrorwitch","Mirrorveil Witch","library",10,2,0,"legendary"],
    ["dreamchimera","Dreamweave Chimera","library",10,3,0,"mythical"],
    ["goblin","Mossfang Goblin","forest",0,0,0,"common"],
    ["slime","Sapphire Slime","ice",0,0,0,"common"],
    ["goblin-shaman","Bramblehex Shaman","swamp",0,0,0,"rare"],
    ["golem","Obsidian Sentinel","mountain",0,0,0,"epic"],
    ["dragon","Cinderwing Ancient","volcano",0,0,0,"legendary"],
    ["lich","The Astral Lich","cosmic",0,0,0,"mythical"]];
  var ITEM_ROWS = [["copper-sabre","Copper Sabre","common","items-1",0,0],
    ["buckler-of-bravery","Buckler of Bravery","common","items-1",1,0],
    ["crimson-vial-charm","Crimson Vial Charm","common","items-1",2,0],
    ["azure-vial-charm","Azure Vial Charm","common","items-1",3,0],
    ["healers-ribbon","Healer’s Ribbon","common","items-1",4,0],
    ["scouts-feather","Scout’s Feather","common","items-1",0,1],
    ["oak-leaf-pendant","Oak Leaf Pendant","common","items-1",1,1],
    ["apprentice-grimoire","Apprentice Grimoire","common","items-1",2,1],
    ["iron-gauntlet","Iron Gauntlet","common","items-1",3,1],
    ["amber-band","Amber Band","common","items-1",4,1],
    ["ember-sabre","Ember Sabre","uncommon","items-2",0,0],
    ["mossguard-shield","Mossguard Shield","uncommon","items-2",1,0],
    ["verdant-flask-charm","Verdant Flask Charm","uncommon","items-2",2,0],
    ["tideglass-pendant","Tideglass Pendant","uncommon","items-2",3,0],
    ["moonpetal-brooch","Moonpetal Brooch","uncommon","items-2",4,0],
    ["windfletch-quiver","Windfletch Quiver","uncommon","items-2",0,1],
    ["foxtrail-boots","Foxtrail Boots","uncommon","items-2",1,1],
    ["runecarved-wand","Runecarved Wand","uncommon","items-2",2,1],
    ["thornvine-ring","Thornvine Ring","uncommon","items-2",3,1],
    ["sunwoven-cape","Sunwoven Cape","uncommon","items-2",4,1],
    ["ruby-fang","Ruby Fang","rare","items-3",0,0],
    ["sapphire-bastion","Sapphire Bastion","rare","items-3",1,0],
    ["phoenix-plume","Phoenix Plume","rare","items-3",2,0],
    ["prismatic-compass","Prismatic Compass","rare","items-3",3,0],
    ["frostbite-bow","Frostbite Bow","rare","items-3",4,0],
    ["celestial-censer","Celestial Censer","rare","items-3",0,1],
    ["stormglass-orb","Stormglass Orb","rare","items-3",1,1],
    ["lions-heart-medal","Lion’s Heart Medal","rare","items-3",2,1],
    ["silver-thread-gloves","Silver Thread Gloves","rare","items-3",3,1],
    ["starlit-tiara","Starlit Tiara","rare","items-3",4,1],
    ["voidsteel-katana","Voidsteel Katana","epic","items-4",0,0],
    ["dragonheart-aegis","Dragonheart Aegis","epic","items-4",1,0],
    ["astral-bottle-relic","Astral Bottle Relic","epic","items-4",2,0],
    ["cometburst-relic","Cometburst Relic","epic","items-4",3,0],
    ["thunderwing-quiver","Thunderwing Quiver","epic","items-4",4,0],
    ["eclipse-grimoire","Eclipse Grimoire","epic","items-4",0,1],
    ["bloodmoon-pendant","Bloodmoon Pendant","epic","items-4",1,1],
    ["spiritwood-totem","Spiritwood Totem","epic","items-4",2,1],
    ["solar-sovereign-blade","Solar Sovereign Blade","legendary","items-4",3,1],
    ["worldtree-seed","Worldtree Seed","legendary","items-4",4,1],
    ["titanforge-hammer","Titanforge Hammer","legendary","items-5",0,0],
    ["seraphim-halo","Seraphim Halo","legendary","items-5",1,0],
    ["tempest-longbow","Tempest Longbow","legendary","items-5",2,0],
    ["infinity-mana-lantern","Infinity Mana Lantern","legendary","items-5",3,0],
    ["aegis-of-the-mountain","Aegis of the Mountain","legendary","items-5",4,0],
    ["starweaver-scepter","Starweaver Scepter","legendary","items-5",0,1],
    ["eternal-phoenix-diadem","Eternal Phoenix Diadem","mythical","items-5",1,1],
    ["hourglass-of-infinity","Hourglass of Infinity","mythical","items-5",2,1],
    ["reality-cleaver","Reality Cleaver","mythical","items-5",3,1],
    ["heart-of-the-constellation","Heart of the Constellation","mythical","items-5",4,1]];
  var RUNE_ROWS = [["ember","Ember Rune","common",0,0],
    ["frost","Frost Rune","uncommon",1,0],
    ["storm","Storm Rune","rare",2,0],
    ["earth","Earth Rune","legendary",3,0],
    ["tide","Tide Rune","uncommon",0,1],
    ["gale","Gale Rune","epic",1,1],
    ["radiance","Radiance Rune","legendary",2,1],
    ["umbral","Umbral Rune","mythical",3,1],
    ["bloom","Bloom Rune","rare",0,2],
    ["venom","Venom Rune","epic",1,2],
    ["arcane","Arcane Rune","mythical",2,2],
    ["iron","Iron Rune","common",3,2],
    ["phoenix","Phoenix Rune","unique",0,3],
    ["winterheart","Winterheart Rune","unique",1,3],
    ["worldspark","Worldspark Rune","unique",2,3],
    ["eclipse","Eclipse Rune","unique",3,3]];

  var RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythical', 'unique'];
  var RARITY_NAME = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', mythical: 'Mythical', unique: 'Unique' };
  var TIER = { common: 'Skirmish', uncommon: 'Skirmish', rare: 'Elite', epic: 'Elite', legendary: 'Boss', mythical: 'Mythic boss', unique: 'Mythic boss' };

  var BOSSES = BOSS_ROWS.map(function (r) {
    var atlas = r[3] ? 'bosses-' + (r[3] < 10 ? '0' + r[3] : String(r[3])) : null;
    return Object.freeze({ id: r[0], name: r[1], world: r[2], atlas: atlas, col: r[4], row: r[5], rarity: r[6], tier: TIER[r[6]] || 'Skirmish', art: atlas ? null : 'enemy-' + r[0] });
  });
  var BOSS_BY_ID = {};
  BOSSES.forEach(function (x) { BOSS_BY_ID[x.id] = x; });

  var ITEMS = ITEM_ROWS.map(function (r) { return Object.freeze({ id: r[0], name: r[1], rarity: r[2], atlas: r[3], col: r[4], row: r[5] }); });
  var ITEM_BY_ID = {};
  ITEMS.forEach(function (x) { ITEM_BY_ID[x.id] = x; });

  var RUNES = RUNE_ROWS.map(function (r) { return Object.freeze({ id: r[0], name: r[1], rarity: r[2], atlas: 'runes', col: r[3], row: r[4] }); });
  var RUNE_BY_ID = {};
  RUNES.forEach(function (x) { RUNE_BY_ID[x.id] = x; });

  var HEROES = Object.freeze({
    warrior: { id: 'warrior', name: 'Warrior', art: 'hero-warrior' },
    mage:    { id: 'mage',    name: 'Mage',    art: 'hero-mage' },
    ranger:  { id: 'ranger',  name: 'Ranger',  art: 'hero-ranger' },
    cleric:  { id: 'cleric',  name: 'Cleric',  art: 'hero-cleric' }
  });
  var HERO_ORDER = ['warrior', 'mage', 'ranger', 'cleric'];

  /* Study Buddy's three companions (polymathlc/tutor, assets/companions). */
  var COMPANIONS = Object.freeze({
    orbit: { id: 'orbit', name: 'Orbit', kind: 'robot' },
    pip:   { id: 'pip',   name: 'Pip',   kind: 'fox' },
    nova:  { id: 'nova',  name: 'Nova',  kind: 'owl' }
  });
  var POSES = ['welcome', 'thinking', 'encourage', 'celebrate'];

  /* The worlds follow the ten boss atlases, in their order. `scene` is the
     adventure backdrop shown in the world chip; `crop` is the part of the
     640 x 360 scene it shows. `trim` hangs from the top rampart. */
  var WORLDS = [
    { id: 'forest',    no: 1,  name: 'Whispering Wilds',     scene: 'scene-forest',  crop: [150, 30, 300, 150], trim: 'vine',   runes: ['bloom', 'earth'],
      loot: ['oak-leaf-pendant', 'scouts-feather', 'mossguard-shield', 'thornvine-ring', 'foxtrail-boots', 'worldtree-seed'],
      science: 'Living things, plants, animals, life cycles', math: 'Whole numbers, place value, the four operations' },
    { id: 'swamp',     no: 2,  name: 'Mistmire Marsh',       scene: 'scene-forest',  crop: [0, 150, 300, 150],  trim: 'vine',   runes: ['venom', 'tide'],
      loot: ['verdant-flask-charm', 'thornvine-ring', 'spiritwood-totem', 'crimson-vial-charm', 'windfletch-quiver', 'moonpetal-brooch'],
      science: 'Interactions, food chains and webs, habitats, adaptations', math: 'Factors, multiples, patterns' },
    { id: 'mountain',  no: 3,  name: 'Crystal Peaks',        scene: 'scene-cavern',  crop: [180, 20, 300, 150], trim: 'icicle', runes: ['earth', 'iron'],
      loot: ['iron-gauntlet', 'aegis-of-the-mountain', 'titanforge-hammer', 'sapphire-bastion', 'buckler-of-bravery', 'silver-thread-gloves'],
      science: 'Matter, materials and their properties, mass and volume', math: 'Angles, shapes, area, perimeter, volume, symmetry' },
    { id: 'ocean',     no: 4,  name: 'Coral Deeps',          scene: 'scene-cavern',  crop: [300, 110, 300, 150], trim: 'drip',  runes: ['tide', 'gale'],
      loot: ['tideglass-pendant', 'azure-vial-charm', 'stormglass-orb', 'sapphire-bastion', 'prismatic-compass', 'astral-bottle-relic'],
      science: 'Water and the water cycle, cells, body and plant systems', math: 'Decimals, money, volume of liquid' },
    { id: 'desert',    no: 5,  name: 'Sunscale Dunes',       scene: 'scene-volcano', crop: [20, 10, 300, 150],  trim: 'drip',   runes: ['radiance', 'gale'],
      loot: ['amber-band', 'sunwoven-cape', 'solar-sovereign-blade', 'lions-heart-medal', 'copper-sabre', 'hourglass-of-infinity'],
      science: 'Light, shadows and reflection', math: 'Percentage, ratio, proportion' },
    { id: 'volcano',   no: 6,  name: 'Ember Caldera',        scene: 'scene-volcano', crop: [290, 40, 300, 150], trim: 'drip',   runes: ['ember', 'phoenix'],
      loot: ['ember-sabre', 'ruby-fang', 'phoenix-plume', 'dragonheart-aegis', 'bloodmoon-pendant', 'eternal-phoenix-diadem'],
      science: 'Heat and temperature, energy and its conversions, photosynthesis', math: 'Algebra and equations' },
    { id: 'ice',       no: 7,  name: 'Frostfang Tundra',     scene: 'scene-cavern',  crop: [20, 40, 300, 150],  trim: 'icicle', runes: ['frost', 'winterheart'],
      loot: ['frostbite-bow', 'moonpetal-brooch', 'starlit-tiara', 'azure-vial-charm', 'silver-thread-gloves', 'seraphim-halo'],
      science: 'Changes of state: melting, freezing, boiling, evaporation, condensation', math: 'Data, tables, graphs and averages' },
    { id: 'clockwork', no: 8,  name: 'Gearspark Works',      scene: 'scene-ruins',   crop: [330, 60, 300, 150], trim: 'rivet',  runes: ['storm', 'iron'],
      loot: ['prismatic-compass', 'hourglass-of-infinity', 'iron-gauntlet', 'thunderwing-quiver', 'tempest-longbow', 'titanforge-hammer'],
      science: 'Electricity and circuits, magnets, forces and machines', math: 'Time, measurement and unit conversion' },
    { id: 'cosmic',    no: 9,  name: 'Starfall Observatory', scene: 'scene-ruins',   crop: [130, 0, 300, 150],  trim: 'star',   runes: ['umbral', 'worldspark'],
      loot: ['cometburst-relic', 'heart-of-the-constellation', 'starweaver-scepter', 'celestial-censer', 'voidsteel-katana', 'infinity-mana-lantern'],
      science: 'The Earth, the Sun, the Moon and space', math: 'Speed, distance and time, circles' },
    { id: 'library',   no: 10, name: 'Inkwell Library',      scene: 'scene-ruins',   crop: [300, 0, 300, 150],  trim: 'rivet',  runes: ['arcane', 'eclipse'],
      loot: ['apprentice-grimoire', 'eclipse-grimoire', 'runecarved-wand', 'healers-ribbon', 'infinity-mana-lantern', 'reality-cleaver'],
      science: 'Revision, experiments and process skills', math: 'Fractions, word problems, bar models and heuristics' }
  ].map(function (w) { return Object.freeze(w); });
  var WORLD_BY_ID = {};
  WORLDS.forEach(function (w) { WORLD_BY_ID[w.id] = w; });

  /* Topic words to a world. The first match wins; nothing matched falls back
     to the subject's home world (Science: forest, Maths: library). */
  var TOPIC_WORLDS = {
    science: [
      [/melt|freez|boil|evaporat|condens|change[sd]? of state|states? of matter/i, 'ice'],
      [/heat|temperature|thermal|energy|conver|photosynth|fuel/i, 'volcano'],
      [/electric|circuit|magnet|force|friction|spring|gravity|machine|lever|pulley/i, 'clockwork'],
      [/light|shadow|reflect|transparen|opaque/i, 'desert'],
      [/space|planet|earth|moon|sun\b|star|solar system|day and night/i, 'cosmic'],
      [/water cycle|water|cell|system|respirat|circulat|digest|transport|skeletal|muscular/i, 'ocean'],
      [/interaction|food (chain|web)|environment|adapt|habitat|ecosystem|community|population|decompos|impact/i, 'swamp'],
      [/matter|material|rock|mass|volume|solid|liquid|gas|propert/i, 'mountain'],
      [/plant|living|animal|fungi|bacteri|diversity|life cycle|reproduc|seed|flower|classif|cycle/i, 'forest'],
      [/revision|review|experiment|investigat|process skill|fair test/i, 'library']
    ],
    math: [
      [/percent|ratio|proportion|discount|gst|interest/i, 'desert'],
      [/speed|distance|rate|circle|circumference|radius|diameter/i, 'cosmic'],
      [/algebra|equation|unknown|expression/i, 'volcano'],
      [/data|graph|chart|table|average|mean|tally/i, 'ice'],
      [/time|clock|measure|length|mass|unit|conversion|kilogram|metre/i, 'clockwork'],
      [/angle|triangle|quadrilateral|geometr|shape|area|perimeter|symmetr|tessellat|nets?\b|solid|cube|cuboid|volume/i, 'mountain'],
      [/decimal|money|dollar|liquid|capacity/i, 'ocean'],
      [/factor|multiple|pattern|prime/i, 'swamp'],
      [/fraction|word problem|heuristic|model|bar model/i, 'library'],
      [/whole number|place value|addition|add\b|subtract|multipl|divi|number/i, 'forest']
    ]
  };

  var CHEERS = ['Your quest begins!', 'Keep going, hero!', 'Every heart counts!', 'Show your working!', 'Check your units!', 'Read the question twice!', 'Almost at the treasure!'];

  /* ================================================================
     PURE HELPERS (no DOM). Exposed on QuestFrames.pure.
     ================================================================ */
  function int(v, d) { var n = parseInt(v, 10); return isFinite(n) ? n : d; }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { n = int(n, 0); return n < 10 && n >= 0 ? '0' + n : String(n); }
  function upper(s) { return String(s == null ? '' : s).toUpperCase(); }

  /* FNV-1a, so a seed string always draws the same frame. */
  function hash(str) {
    var h = 2166136261;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /* mulberry32 */
  function rng(seed) {
    var s = (typeof seed === 'number' ? seed : hash(seed)) >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function subjectOf(v) { return /\b(math|maths|mathematics|numeracy)\b/i.test(String(v || '')) ? 'math' : 'science'; }
  function subjectName(s) { return s === 'math' ? 'Mathematics' : 'Science'; }

  function worldOf(v) {
    if (v && typeof v === 'object' && v.id && WORLD_BY_ID[v.id]) return WORLD_BY_ID[v.id];
    if (WORLD_BY_ID[v]) return WORLD_BY_ID[v];
    var n = int(v, 0);
    if (n >= 1 && n <= WORLDS.length) return WORLDS[n - 1];
    return null;
  }

  function worldFor(subject, topic) {
    var s = subjectOf(subject);
    var list = TOPIC_WORLDS[s];
    var text = String(topic || '');
    for (var i = 0; i < list.length; i++) if (list[i][0].test(text)) return WORLD_BY_ID[list[i][1]];
    return WORLD_BY_ID[s === 'math' ? 'library' : 'forest'];
  }

  /* Marks to loot rarity: a 1-mark question is common loot, a 5-mark one
     legendary. `challenge` (the boss question) is the game's Unique. */
  function rarityForMarks(marks, challenge) {
    if (challenge) return 'unique';
    var m = int(marks, 1);
    if (m <= 1) return 'common';
    if (m === 2) return 'uncommon';
    if (m === 3) return 'rare';
    if (m === 4) return 'epic';
    if (m === 5) return 'legendary';
    return 'mythical';
  }

  /* One heart per question, at most `max` hearts. Past that, a heart is
     worth `per` questions and the bar says so. */
  function heartsPlan(questions, max, perRow) {
    var q = Math.max(0, int(questions, 0));
    max = Math.max(1, int(max, 20));
    perRow = Math.max(1, int(perRow, 10));
    if (!q) return { questions: 0, hearts: 0, per: 1, rows: 0, perRow: perRow };
    var per = Math.ceil(q / max);
    var hearts = Math.ceil(q / per);
    var rows = Math.ceil(hearts / perRow);
    return { questions: q, hearts: hearts, per: per, rows: rows, perRow: Math.ceil(hearts / rows) };
  }

  /* XP trail: one segment per page (at most 12), the pages before this one
     done, this one current. Unknown page counts give blank segments. */
  function xpPlan(page, pages, xpPerPage) {
    var total = int(pages, 0), cur = int(page, 0), per = Math.max(0, int(xpPerPage, 50));
    if (total <= 0) return { known: false, segments: 6, done: 0, current: -1, page: 0, pages: 0, xp: 0, maxXp: 0, per: 1 };
    total = clamp(total, 1, 99);
    cur = clamp(cur || 1, 1, total);
    var segments = Math.min(total, 12);
    var perSeg = total / segments;
    var done = Math.floor((cur - 1) / perSeg);
    return { known: true, segments: segments, done: done, current: Math.min(segments - 1, done), page: cur, pages: total, xp: cur * per, maxXp: total * per, per: perSeg };
  }

  function bossesIn(world) {
    var w = worldOf(world) || WORLDS[0];
    return BOSSES.filter(function (x) { return x.world === w.id; })
      .sort(function (p, q) { return RARITY_ORDER.indexOf(p.rarity) - RARITY_ORDER.indexOf(q.rarity) || (p.atlas ? 1 : 0) - (q.atlas ? 1 : 0) || p.id.localeCompare(q.id); });
  }

  /* Quests escalate: the nth quest in a world meets the nth boss, weakest
     first. `final` picks the world's strongest. */
  function bossFor(world, quest, opts) {
    opts = opts || {};
    if (opts.boss && BOSS_BY_ID[opts.boss]) return BOSS_BY_ID[opts.boss];
    var list = bossesIn(world);
    if (!list.length) return BOSSES[0];
    if (opts.final) return list[list.length - 1];
    if ((quest == null || quest === '') && opts.seed != null) return list[hash(opts.seed) % list.length];
    var n = Math.max(1, int(quest, 1));
    return list[(n - 1) % list.length];
  }

  function heroFor(quest, hero, seed) {
    if (hero && HEROES[hero]) return HEROES[hero];
    if ((quest == null || quest === '') && seed != null) return HEROES[HERO_ORDER[hash(String(seed) + ':hero') % HERO_ORDER.length]];
    var n = Math.max(1, int(quest, 1));
    return HEROES[HERO_ORDER[(n - 1) % HERO_ORDER.length]];
  }

  function companionFor(subject, companion) {
    if (companion && COMPANIONS[companion]) return COMPANIONS[companion];
    return subjectOf(subject) === 'math' ? COMPANIONS.nova : COMPANIONS.orbit;
  }

  function cheerFor(page, variant) {
    if (variant === 'start') return CHEERS[0];
    var n = Math.max(1, int(page, 1));
    return CHEERS[1 + ((n - 2 + CHEERS.length - 1) % (CHEERS.length - 1))];
  }

  function safeArea(variant) {
    var v = PAGE.safeTop[variant] != null ? variant : 'trail';
    return { top: PAGE.safeTop[v], right: PAGE.safeX, bottom: PAGE.safeBottom[v], left: PAGE.safeX };
  }

  function lootFor(world, count, seed) {
    var w = worldOf(world) || WORLDS[0];
    var pool = w.loot.map(function (id) { return ITEM_BY_ID[id]; }).filter(Boolean);
    var r = rng(seed == null ? w.id : seed);
    var out = [];
    var copy = pool.slice();
    while (out.length < count && copy.length) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]);
    while (out.length < count && pool.length) out.push(pool[out.length % pool.length]);
    return out;
  }

  /* ================================================================
     PIXEL ART. A bitmap is rows of characters; each character names a
     colour class. Runs of one colour in a row become one <rect>.
     ================================================================ */
  var BITMAPS = {
    heart: [
      '.OO.OO.',
      'OHHOHHO',
      'OHWHHHO',
      'OHHHHHO',
      '.OHHHO.',
      '..OHO..',
      '...O...'
    ],
    star: [
      '.....O.....',
      '....OSO....',
      '....OSO....',
      'OOOOSSSOOOO',
      'OSWSSSSSSSO',
      '.OSSSSSSSO.',
      '..OSSSSSO..',
      '..OSSOSSO..',
      '.OSSO.OSSO.',
      '.OOO...OOO.'
    ],
    sparkle: [
      '...K...',
      '...L...',
      '..KLK..',
      'KLLLLLK',
      '..KLK..',
      '...L...',
      '...K...'
    ],
    pip: [
      '..O..',
      '.OPO.',
      'OPPPO',
      '.OPO.',
      '..O..'
    ],
    flag: [
      'OOOOOO..',
      'OFFFFFO.',
      'OFGFFFFO',
      'OFFFFFO.',
      'OOOOOO..',
      'O.......',
      'O.......',
      'O.......',
      'O.......',
      'OO......'
    ],
    link: [
      '.OOO.',
      'OKLKO',
      'OK.kO',
      'OkkkO',
      '.OOO.'
    ],
    bar: [
      'OkO',
      'OKO',
      'OkO'
    ],
    vine: [
      'OFO..',
      'OGFO.',
      '.OFO.',
      '.OGFO',
      '..OO.'
    ],
    icicle: [
      'OWWGO',
      'OWGFO',
      '.OGO.',
      '.OGO.',
      '..O..'
    ],
    drip: [
      'OFFFO',
      '.OGO.',
      '.OFO.',
      '..O..'
    ],
    rivet: [
      '.OOO.',
      'OLKkO',
      'OKKkO',
      'OkkkO',
      '.OOO.'
    ],
    hangstar: [
      '..O..',
      '..O..',
      '.OKO.',
      'OKLKO',
      '.OKO.',
      '..O..'
    ],
    seal: [
      '..OOOOO..',
      '.OKKKKKO.',
      'OKLLLLLKO',
      'OKL...LkO',
      'OKL...LkO',
      'OKL...LkO',
      'OKkkkkkkO',
      '.OkkkkkO.',
      '..OOOOO..'
    ]
  };

  var PIXEL_CLASS = {
    O: 'qf-c-ol', W: 'qf-c-ww', G: 'qf-c-wg', F: 'qf-c-wf', D: 'qf-c-wd', I: 'qf-c-wi',
    K: 'qf-c-gold', L: 'qf-c-gold-l', k: 'qf-c-gold-d', E: 'qf-c-empty',
    H: 'qf-c-heart', S: 'qf-c-star', P: 'qf-c-s', X: 'qf-c-xp', x: 'qf-c-xpg', M: 'qf-c-mp', m: 'qf-c-mpg',
    R: 'qf-c-r', Y: 'qf-c-page', C: 'qf-c-parch'
  };

  function runs(rows, map, ox, oy, scale) {
    var out = [];
    scale = scale || 1;
    for (var y = 0; y < rows.length; y++) {
      var row = rows[y], x = 0;
      while (x < row.length) {
        var ch = row.charAt(x);
        if (ch === '.' || ch === ' ') { x++; continue; }
        var start = x;
        while (x < row.length && row.charAt(x) === ch) x++;
        var cls = (map && map[ch]) || PIXEL_CLASS[ch] || 'qf-c-ol';
        out.push('<rect class="' + cls + '" x="' + (ox + start * scale) + '" y="' + (oy + y * scale) + '" width="' + ((x - start) * scale) + '" height="' + scale + '"/>');
      }
    }
    return out.join('');
  }

  function bitmapSize(rows) {
    var w = 0;
    rows.forEach(function (r) { w = Math.max(w, r.length); });
    return { w: w, h: rows.length };
  }

  /* A bitmap as its own small inline SVG. */
  function pixelSvg(name, opts) {
    opts = opts || {};
    var rows = Array.isArray(name) ? name : BITMAPS[name];
    if (!rows) return '';
    var sz = bitmapSize(rows);
    var px = num(opts.px, 3);
    var label = opts.label ? ' role="img" aria-label="' + esc(opts.label) + '"' : ' aria-hidden="true" focusable="false"';
    return '<svg class="qf-px ' + esc(opts.className || '') + '" viewBox="0 0 ' + sz.w + ' ' + sz.h + '" width="' + (sz.w * px) + '" height="' + (sz.h * px) + '" shape-rendering="crispEdges"' + label + '>' +
      runs(rows, opts.map, 0, 0, 1) + '</svg>';
  }

  /* An octagonal gem with a lit and a shadowed facet. */
  function gemRows(size) {
    var n = size || 13, cut = 3, rows = [];
    function inside(x, y) {
      if (x < 0 || y < 0 || x >= n || y >= n) return false;
      return Math.min(x, n - 1 - x) + Math.min(y, n - 1 - y) >= cut;
    }
    for (var y = 0; y < n; y++) {
      var row = '';
      for (var x = 0; x < n; x++) {
        if (!inside(x, y)) { row += '.'; continue; }
        var edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        if (edge) row += 'O';
        else if (x + y <= 7) row += 'g';
        else if (x + y >= 2 * (n - 1) - 6) row += 'd';
        else row += 'R';
      }
      rows.push(row);
    }
    return rows;
  }

  /* ================================================================
     SPRITES. A picture, or one cell of an atlas, cropped by an SVG viewBox
     around an <image>. Inline SVG prints without background graphics.
     ================================================================ */
  var uidN = 0;
  function uid(prefix) { uidN += 1; return (prefix || 'qf') + uidN.toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  function refOf(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') {
      if (HEROES[ref]) return { key: HEROES[ref].art, label: HEROES[ref].name };
      if (BOSS_BY_ID[ref]) return refOf(BOSS_BY_ID[ref]);
      if (ITEM_BY_ID[ref]) return refOf(ITEM_BY_ID[ref]);
      if (RUNE_BY_ID[ref]) return refOf(RUNE_BY_ID[ref]);
      if (ART[ref]) return { key: ref, label: '' };
      return null;
    }
    if (ref.atlas) return { atlas: ref.atlas, col: ref.col, row: ref.row, label: ref.name || ref.label || '' };
    if (ref.art) return { key: ref.art, label: ref.name || ref.label || '' };
    if (ref.key) return ref;
    return null;
  }

  function sprite(ref, opts) {
    opts = opts || {};
    var r = refOf(ref);
    if (!r) return '';
    var cell, e;
    if (r.atlas) {
      cell = cellOf(r.atlas, r.col, r.row);
      if (!cell) return '';
      e = cell.sheet;
    } else {
      e = artEntry(r.key);
      if (!e) return '';
      cell = { x: 0, y: 0, w: e.w, h: e.h };
    }
    if (opts.crop) cell = { x: opts.crop[0], y: opts.crop[1], w: opts.crop[2], h: opts.crop[3] };
    var inset = num(opts.inset, 0);
    var vx = cell.x + cell.w * inset, vy = cell.y + cell.h * inset, vw = cell.w * (1 - 2 * inset), vh = cell.h * (1 - 2 * inset);
    var label = opts.label != null ? opts.label : r.label;
    var aria = opts.decorative || !label ? ' aria-hidden="true" focusable="false"' : ' role="img" aria-label="' + esc(label) + '"';
    var size = '';
    if (opts.width != null) size += ' width="' + num(opts.width, 0) + '"';
    if (opts.height != null) size += ' height="' + num(opts.height, 0) + '"';
    var fit = opts.fit === 'cover' ? 'xMidYMid slice' : (opts.align || 'xMidYMid') + ' meet';
    var pos = opts.x != null ? ' x="' + num(opts.x, 0) + '" y="' + num(opts.y, 0) + '"' : '';
    var cls = 'qf-sprite' + (opts.pixelated ? ' qf-crisp' : '') + (opts.className ? ' ' + opts.className : '');
    if (opts.x != null && opts.width != null && opts.height != null) {
      /* Inside another SVG (the rampart's runes and loot): no nested <svg>.
         Chromium ignores a nested viewport when it repeats a position:fixed
         layer on every printed page (QuestFrames.flow), and paints the whole
         atlas across the sheet. Drawn this way it looks the same everywhere:
         the cell is a rect filled with a pattern
         holding the scaled sheet (patterns survive that repeat; a nested
         viewport and a clip-path do not). Fit is "meet", centred in the box. */
      var bx = num(opts.x, 0), by = num(opts.y, 0), bw = num(opts.width, 0), bh = num(opts.height, 0);
      var k = Math.min(bw / vw, bh / vh), cw = vw * k, ch = vh * k;
      var cx = bx + (bw - cw) / 2, cy = by + (bh - ch) / 2, clip = uid('qfc');
      return '<g class="' + esc(cls) + '"' + aria + '>' +
        '<pattern id="' + clip + '" patternUnits="userSpaceOnUse" x="' + round(cx - vx * k) + '" y="' + round(cy - vy * k) + '" width="' + round(e.w * k) + '" height="' + round(e.h * k) + '">' +
        '<image href="' + esc(artUrl(e.key)) + '" x="0" y="0" width="' + round(e.w * k) + '" height="' + round(e.h * k) + '" preserveAspectRatio="none"' + (opts.pixelated ? ' style="image-rendering:pixelated"' : '') + '/></pattern>' +
        '<rect x="' + round(cx) + '" y="' + round(cy) + '" width="' + round(cw) + '" height="' + round(ch) + '" fill="url(#' + clip + ')"/></g>';
    }
    return '<svg class="' + esc(cls) + '"' + pos + size + ' viewBox="' + round(vx) + ' ' + round(vy) + ' ' + round(vw) + ' ' + round(vh) + '" preserveAspectRatio="' + fit + '"' + aria + '>' +
      (opts.title ? '<title>' + esc(opts.title) + '</title>' : '') +
      '<image href="' + esc(artUrl(e.key)) + '" x="0" y="0" width="' + e.w + '" height="' + e.h + '" preserveAspectRatio="none"' + (opts.pixelated ? ' style="image-rendering:pixelated"' : '') + '/></svg>';
  }
  function round(v) { return Math.round(v * 100) / 100; }

  /* ================================================================
     PLATES. A pixel panel behind any text: drawn in SVG (so it prints),
     cut one pixel step at each corner by a CSS clip-path, with a hard
     shadow, a lit top-left bevel and a shaded bottom-right bevel.
     tone: gold | parchment | world | night | rarity
     ================================================================ */
  function plateFace() {
    return '<svg class="qf-plate-face" aria-hidden="true" focusable="false">' +
      '<rect class="qf-p-face" width="100%" height="100%"/>' +
      '<rect class="qf-p-glint" x="3" y="3" width="100%" height="3"/>' +
      '<rect class="qf-p-glint" x="3" y="3" width="3" height="100%"/>' +
      '<rect class="qf-p-deep" x="0" y="100%" width="100%" height="3" transform="translate(0 -6)"/>' +
      '<rect class="qf-p-deep" x="100%" y="0" width="3" height="100%" transform="translate(-6 0)"/>' +
      '<rect class="qf-p-line" x="0" y="0" width="100%" height="3"/>' +
      '<rect class="qf-p-line" x="0" y="100%" width="100%" height="3" transform="translate(0 -3)"/>' +
      '<rect class="qf-p-line" x="0" y="0" width="3" height="100%"/>' +
      '<rect class="qf-p-line" x="100%" y="0" width="3" height="100%" transform="translate(-3 0)"/>' +
      '</svg>';
  }
  function plate(tone, body, opts) {
    opts = opts || {};
    var cls = 'qf-plate qf-plate--' + (tone || 'parchment') + (opts.className ? ' ' + opts.className : '');
    var attrs = opts.attrs || '';
    var shadow = opts.shadow === false ? '' : '<svg class="qf-plate-shadow" aria-hidden="true" focusable="false"><rect width="100%" height="100%"/></svg>';
    return '<div class="' + esc(cls) + '"' + attrs + '>' + shadow + plateFace() + '<div class="qf-plate-body">' + body + '</div></div>';
  }

  /* A flat fill behind a chip or tab: an SVG rect, so it prints. */
  function fillBg() {
    return '<svg class="qf-fill" aria-hidden="true" focusable="false"><rect width="100%" height="100%"/></svg>';
  }

  /* ================================================================
     THE RAMPART (PixelBorder). One SVG over the whole page: brick bands
     in the world's colours, an outline and a gold rim, corner bastions
     holding the world's two runes, gold loot sockets on the sides, the
     world's trim hanging from the top wall, and a few sparkles.
     ================================================================ */
  /* Two fits. `frame` is the Quest page's own rampart (safe area inside it).
     `margins` fits the whole wall, bastions and sockets inside an existing
     sheet's print margins (16mm sides, 18mm top, 20mm foot), for a builder
     whose pages are already laid out and must not move by a pixel. */
  var FITS = {
    frame:   { inset: 20, band: 30, bastion: 60, bastionAt: 14, socket: 40, trim: 3, spark: 3, trimFrom: 96 },
    margins: { inset: 16, band: 24, bastion: 44, bastionAt: 10, socket: 32, trim: 2, spark: 2, trimFrom: 72 }
  };

  function brickTile(id, transform, band) {
    /* 84 wide, two rows of band/2. Mortar is the deep colour showing through. */
    var row = band / 2, t = '';
    t += '<rect class="qf-c-wd" x="0" y="0" width="84" height="' + band + '"/>';
    [[0, 25], [28, 25], [56, 25]].forEach(function (p) {
      t += '<rect class="qf-c-wg" x="' + p[0] + '" y="3" width="' + p[1] + '" height="3"/>';
      t += '<rect class="qf-c-wf" x="' + p[0] + '" y="6" width="' + p[1] + '" height="' + (row - 6) + '"/>';
    });
    [[0, 9], [12, 25], [40, 25], [68, 16]].forEach(function (p) {
      t += '<rect class="qf-c-wg" x="' + p[0] + '" y="' + (row + 3) + '" width="' + p[1] + '" height="3"/>';
      t += '<rect class="qf-c-wf" x="' + p[0] + '" y="' + (row + 6) + '" width="' + p[1] + '" height="' + (row - 6) + '"/>';
    });
    t += '<rect class="qf-c-wd" x="33" y="' + (row - 6) + '" width="3" height="3"/>';
    t += '<rect class="qf-c-wg" x="49" y="' + (band - 6) + '" width="3" height="3"/>';
    t += '<rect class="qf-c-wd" x="74" y="' + (band - 6) + '" width="3" height="3"/>';
    return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="84" height="' + band + '" patternTransform="' + transform + '">' + t + '</pattern>';
  }

  function ring(x, y, w, h, t, cls) {
    /* a hollow rectangle t px thick, as one even-odd path */
    return '<path class="' + cls + '" fill-rule="evenodd" d="M' + x + ' ' + y + 'h' + w + 'v' + h + 'h' + (-w) + 'z' +
      'M' + (x + t) + ' ' + (y + t) + 'v' + (h - 2 * t) + 'h' + (w - 2 * t) + 'v' + (-(h - 2 * t)) + 'z"/>';
  }

  function bevelBox(x, y, w, h, face, glint, deep) {
    return '<rect class="qf-c-ol" x="' + (x + 3) + '" y="' + (y + 3) + '" width="' + w + '" height="' + h + '" opacity=".9"/>' +
      '<rect class="qf-c-ol" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"/>' +
      '<rect class="' + face + '" x="' + (x + 3) + '" y="' + (y + 3) + '" width="' + (w - 6) + '" height="' + (h - 6) + '"/>' +
      '<rect class="' + glint + '" x="' + (x + 3) + '" y="' + (y + 3) + '" width="' + (w - 6) + '" height="3"/>' +
      '<rect class="' + glint + '" x="' + (x + 3) + '" y="' + (y + 3) + '" width="3" height="' + (h - 6) + '"/>' +
      '<rect class="' + deep + '" x="' + (x + 3) + '" y="' + (y + h - 6) + '" width="' + (w - 6) + '" height="3"/>' +
      '<rect class="' + deep + '" x="' + (x + w - 6) + '" y="' + (y + 3) + '" width="3" height="' + (h - 6) + '"/>';
  }

  function bastion(x, y, s, rune, label) {
    var k = Math.round(s / 6), sock = s - 2 * k, out = '';
    out += bevelBox(x, y, s, s, 'qf-c-wd', 'qf-c-wf', 'qf-c-wi');
    /* battlement notches on the outer corners */
    out += '<rect class="qf-c-wg" x="' + (x + k - 1) + '" y="' + (y + k - 1) + '" width="6" height="3"/>';
    out += '<rect class="qf-c-wg" x="' + (x + s - k - 5) + '" y="' + (y + k - 1) + '" width="6" height="3"/>';
    /* gold socket */
    out += bevelBox(x + k, y + k, sock, sock, 'qf-c-gold', 'qf-c-gold-l', 'qf-c-gold-d');
    out += '<rect class="qf-c-wi" x="' + (x + k + 6) + '" y="' + (y + k + 6) + '" width="' + (sock - 12) + '" height="' + (sock - 12) + '"/>';
    if (rune) out += sprite(rune, { x: x + k + 1, y: y + k + 1, width: sock - 2, height: sock - 2, inset: .08, label: label || rune.name, className: 'qf-rune' });
    return out;
  }

  function socket(cx, cy, s, item) {
    var x = cx - s / 2, y = cy - s / 2, out = '';
    out += bevelBox(x, y, s, s, 'qf-c-gold', 'qf-c-gold-l', 'qf-c-gold-d');
    out += '<rect class="qf-c-parch" x="' + (x + 6) + '" y="' + (y + 6) + '" width="' + (s - 12) + '" height="' + (s - 12) + '"/>';
    out += '<rect class="qf-c-gold-d" x="' + (x + 6) + '" y="' + (y + 6) + '" width="' + (s - 12) + '" height="3" opacity=".55"/>';
    if (item) out += sprite(item, { x: x + 4, y: y + 4, width: s - 8, height: s - 8, inset: .1, label: item.name, className: 'qf-loot' });
    return out;
  }

  function trimRow(kind, y, from, to, step, scale, r) {
    var rows = BITMAPS[kind];
    if (!rows) return '';
    var sz = bitmapSize(rows), out = '';
    for (var x = from; x + sz.w * scale <= to; x += step) {
      var jitter = Math.floor(r() * 3) * scale;
      var flip = r() < .5;
      var g = runs(rows, null, 0, 0, scale);
      out += '<g transform="translate(' + (x + jitter + (flip ? sz.w * scale : 0)) + ' ' + y + ')' + (flip ? ' scale(-1 1)' : '') + '">' + g + '</g>';
    }
    return out;
  }

  function border(o) {
    o = o || {};
    var w = worldOf(o.world) || WORLDS[0];
    var G = FITS[o.fit] || FITS.frame;
    var W = num(o.w, PAGE.w), H = num(o.h, PAGE.h), I = G.inset, B = G.band;
    var seed = o.seed != null ? o.seed : w.id + ':' + (o.quest || 1) + ':' + (o.page || 1);
    var r = rng(seed);
    var id = uid('qfb');
    var variant = o.variant || 'start';
    var parts = [];

    parts.push('<defs>' +
      brickTile(id + 't', 'translate(' + (Math.floor(r() * 28)) + ' ' + I + ')', B) +
      brickTile(id + 'b', 'translate(' + (Math.floor(r() * 28)) + ' ' + (H - I - B) + ')', B) +
      brickTile(id + 'l', 'translate(' + (I + B) + ' ' + Math.floor(r() * 28) + ') rotate(90)', B) +
      brickTile(id + 'r', 'translate(' + (W - I) + ' ' + Math.floor(r() * 28) + ') rotate(90)', B) +
      '</defs>');

    /* outer hard shadow, then the four brick bands */
    parts.push(ring(I + 3, I + 3, W - 2 * I, H - 2 * I, B + 3, 'qf-c-ol qf-shadow'));
    parts.push('<rect fill="url(#' + id + 't)" x="' + I + '" y="' + I + '" width="' + (W - 2 * I) + '" height="' + B + '"/>');
    parts.push('<rect fill="url(#' + id + 'b)" x="' + I + '" y="' + (H - I - B) + '" width="' + (W - 2 * I) + '" height="' + B + '"/>');
    parts.push('<rect fill="url(#' + id + 'l)" x="' + I + '" y="' + (I + B) + '" width="' + B + '" height="' + (H - 2 * I - 2 * B) + '"/>');
    parts.push('<rect fill="url(#' + id + 'r)" x="' + (W - I - B) + '" y="' + (I + B) + '" width="' + B + '" height="' + (H - 2 * I - 2 * B) + '"/>');
    /* outline outside, outline + gold rim inside */
    parts.push(ring(I - 3, I - 3, W - 2 * I + 6, H - 2 * I + 6, 3, 'qf-c-ol'));
    parts.push(ring(I + B - 3, I + B - 3, W - 2 * (I + B) + 6, H - 2 * (I + B) + 6, 3, 'qf-c-ol'));
    parts.push(ring(I + B, I + B, W - 2 * (I + B), H - 2 * (I + B), 3, 'qf-c-gold'));
    parts.push(ring(I + B + 3, I + B + 3, W - 2 * (I + B + 3), H - 2 * (I + B + 3), 1.5, 'qf-c-gold-d'));

    /* the world's trim hangs from the top wall */
    if (o.trims !== false) {
      parts.push('<g class="qf-trim">' + trimRow(w.trim === 'star' ? 'hangstar' : w.trim, I + B + 4, G.trimFrom, W - G.trimFrom, Math.round(46 * G.trim / 3), G.trim, r) + '</g>');
    }

    /* loot sockets on the side walls */
    if (o.sockets !== false) {
      var loot = lootFor(w, 4, seed + ':loot');
      var ys = variant === 'start' ? [.42, .7] : [.34, .66];
      parts.push('<g class="qf-sockets">' +
        socket(I + B / 2, Math.round(H * ys[0]), G.socket, loot[0]) +
        socket(I + B / 2, Math.round(H * ys[1]), G.socket, loot[1]) +
        socket(W - I - B / 2, Math.round(H * ys[0]), G.socket, loot[2]) +
        socket(W - I - B / 2, Math.round(H * ys[1]), G.socket, loot[3]) + '</g>');
    }

    /* sparkles twinkle on the walls (never in the content) */
    if (o.sparkles !== false) {
      var sp = '', half = 3.5 * G.spark;
      var spots = [
        [I + B / 2 - half, H * (.2 + r() * .12)], [W - I - B / 2 - half, H * (.5 + r() * .08)],
        [W * (.28 + r() * .1), H - I - B / 2 - half], [W * (.55 + r() * .12), I + B / 2 - half]
      ];
      spots.forEach(function (p, i) {
        sp += '<g class="qf-twinkle" style="animation-delay:' + (-i * 0.7).toFixed(1) + 's" transform="translate(' + Math.round(p[0]) + ' ' + Math.round(p[1]) + ')">' + runs(BITMAPS.sparkle, null, 0, 0, G.spark) + '</g>';
      });
      parts.push('<g class="qf-sparkles">' + sp + '</g>');
    }

    /* bastions with the world's runes */
    if (o.runes !== false) {
      var r1 = RUNE_BY_ID[w.runes[0]], r2 = RUNE_BY_ID[w.runes[1]];
      var c = G.bastionAt, s = G.bastion;
      parts.push('<g class="qf-bastions">' +
        bastion(c, c, s, r1) + bastion(W - c - s, c, s, r2) +
        bastion(c, H - c - s, s, r2) + bastion(W - c - s, H - c - s, s, r1) + '</g>');
    }

    var cls = 'qf-border qf-world-' + w.id + (o.fit === 'margins' ? ' qf-border--margins' : '') + (o.className ? ' ' + o.className : '');
    return '<svg class="' + esc(cls) + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' + parts.join('') + '</svg>';
  }

  /* ================================================================
     QUEST BANNER. A gold plate hung from the top wall on two chains:
     the logo sticker, QUEST nn · SUBJECT, the title and the world chip.
     ================================================================ */
  function subjectIcon(subject, icon) {
    var s = subjectOf(subject);
    var c = icon && icon.length === 2 ? icon : [0, 0];
    return sprite({ atlas: s === 'math' ? 'math-icons' : 'science-icons', col: c[0], row: c[1] }, { decorative: true, inset: .14, className: 'qf-subject-icon' });
  }

  function worldChip(world, opts) {
    var w = worldOf(world) || WORLDS[0];
    opts = opts || {};
    var scene = sprite(w.scene, { crop: w.crop, fit: 'cover', decorative: true, pixelated: true, className: 'qf-chip-scene' });
    var label = (opts.short ? '' : 'WORLD ' + w.no + ' · ') + upper(w.name);
    return '<span class="qf-world-chip qf-world-' + w.id + '">' + fillBg() + '<span class="qf-chip-window">' + scene + '</span><span class="qf-chip-text">' + esc(label) + '</span></span>';
  }

  function chains() {
    var link = runs(BITMAPS.link, null, 0, 0, 3), bar = runs(BITMAPS.bar, null, 3, 0, 3);
    var one = '<g>' + link + '</g><g transform="translate(0 12)">' + bar + '</g><g transform="translate(0 18)">' + link + '</g>';
    return '<svg class="qf-chain qf-chain--l" viewBox="0 0 15 33" width="15" height="33" shape-rendering="crispEdges" aria-hidden="true">' + one + '</svg>' +
      '<svg class="qf-chain qf-chain--r" viewBox="0 0 15 33" width="15" height="33" shape-rendering="crispEdges" aria-hidden="true">' + one + '</svg>';
  }

  function banner(o) {
    o = o || {};
    var s = subjectOf(o.subject);
    var w = worldOf(o.world) || worldFor(s, o.topic || o.title);
    var numbered = !(o.quest == null || o.quest === '' || o.quest === false);
    var quest = int(o.quest, 1);
    var slim = o.variant === 'trail' || o.variant === 'finale' || o.slim;
    var title = String(o.title || 'Untitled quest');
    var long = title.length > 22;
    var level = clamp(int(o.headingLevel, 2), 1, 6);
    var eyebrow = '<span class="qf-eyebrow qf-banner-eyebrow"><span class="qf-subject-tile qf-subject-' + s + '">' + subjectIcon(s, o.icon) + '</span>' +
      '<span>' + (numbered ? 'QUEST ' + esc(pad2(quest)) + ' · ' + esc(upper(o.subjectLabel || subjectName(s))) : esc(upper(o.subjectLabel || subjectName(s))) + ' QUEST') + '</span></span>';
    var body;
    if (slim) {
      var c = w.crop, win = [c[0] + c[2] / 2 - 90, c[1], 180, c[3]];
      body = '<span class="qf-slim-window" title="World ' + w.no + ' \u00b7 ' + esc(w.name) + '">' + sprite(w.scene, { crop: win, fit: 'cover', decorative: true, pixelated: true }) + '</span>' +
        '<span class="qf-banner-text">' + eyebrow.replace('</span></span>', ' \u00b7 W' + w.no + '</span></span>') +
        '<span class="qf-banner-title qf-quest-title-sm" role="heading" aria-level="' + level + '">' + esc(title) + '</span></span>';
    } else {
      body = (o.logo === false ? '' : '<span class="qf-logo">' + sprite('logo', { label: 'Polymath Learning Centre' }) + '</span>') +
        '<span class="qf-banner-text">' + eyebrow +
        '<span class="qf-banner-title ' + (long ? 'qf-quest-title-sm' : 'qf-quest-title') + '" role="heading" aria-level="' + level + '">' + esc(title) + '</span>' +
        worldChip(w) + '</span>';
    }
    return '<div class="qf-banner' + (slim ? ' qf-banner--slim' : '') + ' qf-world-' + w.id + ' qf-subject-' + s + '">' +
      (slim ? '' : chains()) + plate('gold', body) + '</div>';
  }

  /* ================================================================
     BOSS BAR. The boss stands in front of the wall over its name plate;
     one empty heart per question for the student to colour in.
     ================================================================ */
  function heartSvg(filled, px) {
    var map = filled ? { O: 'qf-c-ml' } : { O: 'qf-c-ml', H: 'qf-c-empty', W: 'qf-c-empty' };
    return pixelSvg('heart', { px: px || 2, map: map, className: 'qf-heart' + (filled ? ' is-filled' : '') });
  }

  function hearts(plan, opts) {
    opts = opts || {};
    var filled = int(opts.filled, 0), px = num(opts.px, 2), out = '';
    for (var i = 0; i < plan.hearts; i++) {
      var on = i < filled;
      if (opts.interactive) {
        out += '<button type="button" class="qf-toggle qf-heart-btn" data-qf-toggle aria-pressed="' + on + '" aria-label="Heart ' + (i + 1) + ' of ' + plan.hearts + '">' + heartSvg(false, px) + heartSvg(true, px) + '</button>';
      } else {
        out += heartSvg(on, px);
      }
    }
    return '<span class="qf-hearts" style="--qf-per-row:' + plan.perRow + '">' + out + '</span>';
  }

  function bossBar(o) {
    o = o || {};
    var w = worldOf(o.world) || worldFor(o.subject, o.topic);
    var boss = o.boss && typeof o.boss === 'object' ? o.boss : bossFor(w, o.quest, { boss: o.boss, final: o.final, seed: o.seed });
    var compact = o.compact || o.variant === 'trail' || o.variant === 'finale';
    var plan = heartsPlan(o.questions, 24, 12);
    var caption = plan.per > 1 ? '1 heart = ' + plan.per + ' questions. Colour as you go!' : 'Colour a heart for each question.';
    var art = sprite(boss, { label: boss.name, className: 'qf-boss-sprite' + (o.still ? '' : ' qf-bob'), inset: boss.atlas ? .02 : .06 });
    var plateBody = '<span class="qf-boss-name">' + esc(upper(boss.name)) + '</span>' +
      (compact ? '' : '<span class="qf-rarity-chip qf-r-' + boss.rarity + '">' + fillBg() + esc(upper(boss.tier)) + '</span>');
    return '<div class="qf-boss' + (compact ? ' qf-boss--compact' : '') + ' qf-world-' + w.id + '" data-boss="' + esc(boss.id) + '">' +
      '<div class="qf-boss-stage">' + art + (compact ? '' : pixelSvg('sparkle', { px: 2, className: 'qf-boss-spark qf-twinkle' }) + pixelSvg('sparkle', { px: 2, className: 'qf-boss-spark qf-boss-spark--2 qf-twinkle' })) + '</div>' +
      '<div class="qf-boss-info">' + plate('parchment', plateBody, { className: 'qf-boss-plate' }) +
      (plan.hearts ? hearts(plan, { filled: o.filled, interactive: o.interactive, px: compact ? 1.5 : 2 }) : '') +
      (plan.hearts && (compact ? o.caption === true : o.caption !== false) ? '<span class="qf-caption">' + esc(caption) + '</span>' : '') +
      '</div></div>';
  }

  /* ================================================================
     HERO CARD. The page's name fields as a character sheet, and the four
     heroes of Wheel Quest to circle.
     ================================================================ */
  function heroCard(o) {
    o = o || {};
    var w = worldOf(o.world) || worldFor(o.subject, o.topic);
    var fields = o.fields || [['HERO NAME', 'name'], ['CLASS', 'class'], ['DATE', 'date']];
    var values = o.values || {};
    var f = fields.map(function (p) {
      var v = values[p[1]];
      return '<span class="qf-field qf-field--' + esc(p[1]) + '"><span class="qf-field-label">' + esc(upper(p[0])) + '</span>' +
        '<span class="qf-field-line">' + (v ? '<span class="qf-field-value">' + esc(v) + '</span>' : '') + '</span></span>';
    }).join('');
    var picks = '';
    if (o.heroes !== false) {
      picks = '<span class="qf-field qf-hero-picks"><span class="qf-field-label">MY HERO</span><span class="qf-pick-row">' +
        HERO_ORDER.map(function (k) {
          var chosen = o.hero === k;
          return '<span class="qf-pick' + (chosen ? ' is-chosen' : '') + '" title="' + esc(HEROES[k].name) + '">' + sprite(k, { label: HEROES[k].name, inset: .08 }) + '</span>';
        }).join('') + '</span></span>';
    }
    return '<div class="qf-herocard qf-world-' + w.id + '">' + plate('parchment', f + picks) + '</div>';
  }

  /* ================================================================
     QUESTION GEM. The question number in a gem coloured by its loot
     rarity: the more marks, the rarer the gem.
     ================================================================ */
  function questionGem(o) {
    o = o || {};
    if (typeof o === 'number' || typeof o === 'string') o = { n: o };
    var rarity = o.rarity && RARITY_ORDER.indexOf(o.rarity) >= 0 ? o.rarity : rarityForMarks(o.marks, o.challenge);
    var n = String(o.n == null ? '' : o.n);
    var size = num(o.size, 36);
    var rows = gemRows(13);
    var map = { O: 'qf-c-ml', R: 'qf-c-r', g: 'qf-c-gemglint', d: 'qf-c-gemdeep' };
    var label = 'Question ' + n + (o.marks ? ', ' + int(o.marks, 1) + ' mark' + (int(o.marks, 1) === 1 ? '' : 's') : '') + (rarity === 'unique' ? ', boss question' : '');
    var digits = n.length >= 3 ? 4.6 : n.length === 2 ? 5.6 : 6.6;
    var gem = '<svg class="qf-gem-svg" viewBox="0 0 13 13" width="' + size + '" height="' + size + '" shape-rendering="crispEdges" role="img" aria-label="' + esc(label) + '">' +
      runs(rows, map, 0, 0, 1) +
      '<text class="qf-gem-num" x="6.5" y="6.6" text-anchor="middle" dominant-baseline="central" font-size="' + digits + '">' + esc(n) + '</text></svg>';
    var marks = '';
    if (o.marks != null && o.showMarks !== false) {
      var m = clamp(int(o.marks, 1), 1, 9);
      var pips = '';
      for (var i = 0; i < Math.min(m, 5); i++) pips += pixelSvg('pip', { px: 2, map: { O: 'qf-c-ml', P: 'qf-c-r' } });
      marks = '<span class="qf-gem-marks"><span class="qf-pips">' + pips + '</span><span class="qf-gem-mark-text">' + m + ' MARK' + (m === 1 ? '' : 'S') + '</span></span>';
    }
    var boss = rarity === 'unique' ? '<span class="qf-gem-boss">' + fillBg() + 'BOSS</span>' : '';
    return '<span class="qf-gem qf-r-' + rarity + (o.className ? ' ' + esc(o.className) : '') + '">' + gem + marks + boss + '</span>';
  }

  /* ================================================================
     COMPANION TIP. Orbit, Pip or Nova with a pixel speech bubble.
     ================================================================ */
  function companionImg(c, pose, opts) {
    var p = POSES.indexOf(pose) >= 0 ? pose : 'welcome';
    return sprite(c.id + '-' + p, { label: opts && opts.decorative ? '' : c.name, decorative: opts && opts.decorative, className: 'qf-companion-img' });
  }

  function companionTip(o) {
    o = o || {};
    var c = companionFor(o.subject, o.companion);
    var pose = o.pose || 'thinking';
    var side = o.side === 'right' ? 'right' : 'left';
    var title = o.title != null ? o.title : c.name + '’s hint';
    var text = o.text || 'Draw a model first.';
    var tail = '<svg class="qf-tip-tail" viewBox="0 0 4 5" width="12" height="15" shape-rendering="crispEdges" aria-hidden="true">' +
      runs(['..OC', '.OCC', 'OCCC', '.OCC', '..OC'], null, 0, 0, 1) + '</svg>';
    var body = (title ? '<span class="qf-tip-tab qf-tip-title qf-comp-' + c.id + '">' + fillBg() + esc(title) + '</span>' : '') + '<span class="qf-tip-text qf-tip-body">' + esc(text) + '</span>';
    return '<div class="qf-tip qf-tip--' + side + (o.compact ? ' qf-tip--compact' : '') + ' qf-comp-' + c.id + '">' +
      '<span class="qf-tip-who">' + companionImg(c, pose) + '</span>' +
      '<div class="qf-tip-bubble">' + tail + plate('parchment', body) + '</div></div>';
  }

  /* ================================================================
     XP TRAIL. One segment per page: done, current, still to go; the
     boss's flag at the end.
     ================================================================ */
  function xpTrack(o) {
    o = o || {};
    var w = worldOf(o.world) || worldFor(o.subject, o.topic);
    var plan = xpPlan(o.page, o.pages, o.xpPerPage);
    var n = plan.segments, gap = 3, h = 18;
    var segW = clamp(Math.floor((num(o.maxWidth, 230) - 32) / n) - gap, 10, 22);
    var width = n * segW + (n - 1) * gap + 30;
    var svg = '';
    for (var i = 0; i < n; i++) {
      var x = i * (segW + gap);
      var state = !plan.known ? 'todo' : i < plan.done ? 'done' : i === plan.current ? 'now' : 'todo';
      svg += '<rect class="qf-c-ol" x="' + (x + 2) + '" y="2" width="' + segW + '" height="' + h + '" opacity=".9"/>';
      svg += '<rect class="qf-c-ml" x="' + x + '" y="0" width="' + segW + '" height="' + h + '"/>';
      if (state === 'done') {
        svg += '<rect class="qf-c-xp" x="' + (x + 2) + '" y="2" width="' + (segW - 4) + '" height="' + (h - 4) + '"/>';
        svg += '<rect class="qf-c-xpg" x="' + (x + 2) + '" y="2" width="' + (segW - 4) + '" height="4"/>';
      } else if (state === 'now') {
        svg += '<rect class="qf-c-empty" x="' + (x + 2) + '" y="2" width="' + (segW - 4) + '" height="' + (h - 4) + '"/>';
        for (var k = 0; k < 4; k++) svg += '<rect class="qf-c-mp" x="' + (x + 2 + k * 5) + '" y="2" width="3" height="' + (h - 4) + '"/>';
        svg += '<rect class="qf-c-mpg" x="' + (x + 2) + '" y="2" width="' + (segW - 4) + '" height="3"/>';
      } else {
        svg += '<rect class="qf-c-empty" x="' + (x + 2) + '" y="2" width="' + (segW - 4) + '" height="' + (h - 4) + '"/>';
      }
    }
    svg += '<g transform="translate(' + (n * (segW + gap) + 2) + ' -12)">' + runs(BITMAPS.flag, { O: 'qf-c-ml' }, 0, 0, 3) + '</g>';
    var label = plan.known
      ? 'PAGE ' + plan.page + ' / ' + plan.pages + (plan.maxXp ? ' · +' + plan.xp + ' XP' : '')
      : 'PAGE ___ / ___';
    var aria = plan.known ? 'XP trail: page ' + plan.page + ' of ' + plan.pages : 'XP trail';
    return '<div class="qf-xp qf-world-' + w.id + '" role="img" aria-label="' + esc(aria) + '">' +
      '<span class="qf-xp-head"><span class="qf-eyebrow">XP TRAIL</span><span class="qf-counter">' + esc(label) + '</span></span>' +
      '<svg class="qf-xp-bar" viewBox="0 -12 ' + (width + 2) + ' ' + (h + 16) + '" width="' + (width + 2) + '" height="' + (h + 16) + '" shape-rendering="crispEdges" aria-hidden="true">' + svg + '</svg>' +
      '</div>';
  }

  /* ================================================================
     LOOT CHEST. The quest's treasure: a score to write in, three stars
     to colour and a seal for the teacher.
     ================================================================ */
  function lootChest(o) {
    o = o || {};
    var w = worldOf(o.world) || worldFor(o.subject, o.topic);
    var frame = o.open ? 3 : 0;
    var total = o.total != null ? int(o.total, 0) : null;
    var stars = '';
    var filled = clamp(int(o.stars, 0), 0, 3);
    for (var i = 0; i < 3; i++) {
      var on = i < filled;
      var map = on ? { O: 'qf-c-ml' } : { O: 'qf-c-ml', S: 'qf-c-empty', W: 'qf-c-empty' };
      if (o.interactive) {
        stars += '<button type="button" class="qf-toggle qf-star-btn" data-qf-toggle aria-pressed="' + on + '" aria-label="Star ' + (i + 1) + ' of 3">' +
          pixelSvg('star', { px: 2, map: { O: 'qf-c-ml', S: 'qf-c-empty', W: 'qf-c-empty' }, className: 'qf-star' }) + pixelSvg('star', { px: 2, map: { O: 'qf-c-ml' }, className: 'qf-star is-filled' }) + '</button>';
      } else {
        stars += pixelSvg('star', { px: 2, map: map, className: 'qf-star' + (on ? ' is-filled' : '') });
      }
    }
    var score = '<span class="qf-chest-score"><span class="qf-field-label">SCORE</span><span class="qf-score-line">' +
      (o.score != null ? '<span class="qf-field-value">' + esc(o.score) + '</span>' : '') + '</span>' +
      (total != null ? '<span class="qf-score-total">/ ' + esc(total) + '</span>' : '') + '</span>';
    var seal = o.seal === false ? '' : '<span class="qf-seal" aria-label="Teacher’s seal">' + pixelSvg('seal', { px: 4 }) + '<span class="qf-seal-text">SEAL</span></span>';
    var body = '<span class="qf-chest-art">' + sprite({ atlas: 'chest', col: frame, row: 0 }, { label: o.open ? 'Open treasure chest' : 'Treasure chest', className: o.open ? 'qf-bob' : '' }) + '</span>' +
      '<span class="qf-chest-text"><span class="qf-eyebrow">TREASURE</span>' + score +
      '<span class="qf-stars">' + stars + '</span>' +
      (o.caption !== false ? '<span class="qf-caption">' + esc(o.caption || 'Stars: \u00bd \u00b7 \u00be \u00b7 full marks') + '</span>' : '') + '</span>' + seal;
    return '<div class="qf-chest qf-world-' + w.id + '">' + plate('gold', body) + '</div>';
  }

  /* ================================================================
     THE FOOTER: the featured hero standing on the wall, the XP trail,
     and the companion's cheer (or, on the last page, the treasure).
     ================================================================ */
  function footer(o, w, s, variant) {
    var hero = heroFor(o.quest, o.hero, o.seed);
    var c = companionFor(s, o.companion);
    var out = '<div class="qf-foot">';
    out += '<span class="qf-foot-hero">' + sprite(hero.art, { label: hero.name, className: 'qf-hero-sprite qf-bob' }) + '</span>';
    out += '<span class="qf-foot-xp">' + xpTrack({ world: w, page: o.page, pages: o.pages, xpPerPage: o.xpPerPage, maxWidth: variant === 'finale' ? 220 : 300 }) + '</span>';
    if (variant === 'finale') {
      out += '<span class="qf-foot-chest">' + lootChest({ world: w, total: o.total, open: o.open, caption: o.chestCaption }) + '</span>';
    } else if (o.companion !== false) {
      var cheer = o.cheer || cheerFor(o.page, variant);
      out += '<span class="qf-foot-cheer"><span class="qf-cheer-bubble">' + plate('parchment', '<span class="qf-cheer-text qf-tip-body">' + esc(cheer) + '</span>') +
        '<svg class="qf-cheer-tail" viewBox="0 0 4 5" width="12" height="15" shape-rendering="crispEdges" aria-hidden="true">' + runs(['CO..', 'CCO.', 'CCCO', 'CCO.', 'CO..'], null, 0, 0, 1) + '</svg></span>' +
        '<span class="qf-foot-companion">' + companionImg(c, variant === 'start' ? 'welcome' : 'encourage') + '</span></span>';
    }
    return out + '</div>';
  }

  /* ================================================================
     QUEST PAGE. A whole A4 page: rampart, header, content, footer.
     variant: start (page 1) | trail (pages between) | finale (last page)
              | calm (rampart and slim header only, for dense pages)
     ================================================================ */
  function pageVariant(o) {
    if (o.variant) return o.variant;
    var p = int(o.page, 1), n = int(o.pages, 0);
    if (p <= 1) return 'start';
    if (n && p >= n) return 'finale';
    return 'trail';
  }

  function header(o, w, s, variant) {
    if (variant === 'start') {
      return '<div class="qf-head qf-head--start">' +
        '<span class="qf-head-banner">' + banner({ subject: s, world: w, quest: o.quest, title: o.title, icon: o.icon, subjectLabel: o.subjectLabel, headingLevel: o.headingLevel, logo: o.logo }) + '</span>' +
        '<span class="qf-head-boss">' + bossBar({ world: w, quest: o.quest, seed: o.seed, boss: o.boss, final: o.final, questions: o.questions, filled: o.filled, interactive: o.interactive }) + '</span>' +
        '<span class="qf-head-hero">' + heroCard({ world: w, hero: o.heroChoice, values: o.values, fields: o.fields }) + '</span>' +
        '</div>';
    }
    return '<div class="qf-head qf-head--slim">' +
      '<span class="qf-head-banner">' + banner({ subject: s, world: w, quest: o.quest, title: o.title, icon: o.icon, subjectLabel: o.subjectLabel, headingLevel: o.headingLevel, variant: 'trail' }) + '</span>' +
      (variant === 'calm' ? '' : '<span class="qf-head-boss">' + bossBar({ world: w, quest: o.quest, seed: o.seed, boss: o.boss, final: o.final, questions: o.questions, filled: o.filled, interactive: o.interactive, compact: true }) + '</span>') +
      '</div>';
  }

  function pageHtml(o) {
    o = o || {};
    var s = subjectOf(o.subject);
    var w = worldOf(o.world) || worldFor(s, o.topic || o.title);
    var variant = pageVariant(o);
    var safe = safeArea(variant);
    var theme = o.theme && /^(paper|arcade|photocopy)$/.test(o.theme) ? o.theme : null;
    var style = '--qf-at-top:' + safe.top + 'px;--qf-at-bottom:' + safe.bottom + 'px;--qf-at-x:' + safe.left + 'px';
    var content = o.content != null ? String(o.content) : '';
    return '<section class="qf-page qf-page--' + variant + ' qf-world-' + w.id + ' qf-subject-' + s + (o.motion === false ? ' qf-still' : '') + '"' +
      (theme ? ' data-theme="' + theme + '"' : '') + ' style="' + style + '" data-qf-page="' + esc(o.page || 1) + '">' +
      '<div class="qf-frame-layer">' +
      border({ world: w, quest: o.quest, page: o.page, variant: variant, seed: o.seed, sockets: variant !== 'calm', trims: o.trims, sparkles: o.sparkles }) +
      header(o, w, s, variant) +
      (variant === 'calm' ? '' : footer(o, w, s, variant)) +
      '</div>' +
      '<div class="qf-content">' + content + '</div>' +
      '</section>';
  }

  /* ================================================================
     FLOWING PRINT. For a worksheet that is one long document paged by the
     browser: a fixed frame layer (browsers repeat position:fixed on every
     printed page) and a table whose thead/tfoot reserve the header and
     footer on every page. Print only; on screen the content shows plain.
     ================================================================ */
  function flowHtml(o) {
    o = o || {};
    var s = subjectOf(o.subject);
    var w = worldOf(o.world) || worldFor(s, o.topic || o.title);
    var safe = safeArea('trail');
    var theme = o.theme && /^(paper|arcade|photocopy)$/.test(o.theme) ? ' data-theme="' + o.theme + '"' : '';
    var frame = '<div class="qf-flow-frame qf-page qf-page--trail qf-world-' + w.id + ' qf-subject-' + s + '"' + theme + ' aria-hidden="true">' +
      '<div class="qf-frame-layer">' + border({ world: w, quest: o.quest, page: 2, variant: 'trail', seed: o.seed }) +
      header(Object.assign({}, o, { questions: o.questions }), w, s, 'trail') +
      footer(Object.assign({}, o, { page: 0, pages: 0, cheer: o.cheer || 'Keep going, hero!' }), w, s, 'trail') + '</div></div>';
    var start = o.start === false ? '' : '<div class="qf-flow-start">' + heroCard({ world: w, hero: o.heroChoice, values: o.values, fields: o.fields }) + '</div>';
    return frame + '<table class="qf-flow qf-world-' + w.id + '"' + theme + ' style="--qf-at-top:' + safe.top + 'px;--qf-at-bottom:' + safe.bottom + 'px;--qf-at-x:' + safe.left + 'px">' +
      '<thead><tr><td><div class="qf-flow-top"></div></td></tr></thead>' +
      '<tfoot><tr><td><div class="qf-flow-bottom"></div></td></tr></tfoot>' +
      '<tbody><tr><td class="qf-flow-cell">' + start + (o.content != null ? String(o.content) : '') + '</td></tr></tbody></table>';
  }

  /* ================================================================
     DOM. Strings become elements; toggles get wired; a page element the
     builder already made can be decorated in place.
     ================================================================ */
  function toElement(html) {
    if (!doc) return null;
    var t = doc.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function wire(root) {
    if (!root || root.__qfWired) return root;
    root.__qfWired = true;
    root.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-qf-toggle]') : null;
      if (!btn || !root.contains(btn)) return;
      var on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      try { root.dispatchEvent(new CustomEvent('questframes:toggle', { bubbles: true, detail: { button: btn, pressed: on } })); } catch (err) { /* old browsers */ }
    });
    return root;
  }

  var BUILDERS = {
    page: pageHtml, border: border, banner: banner, boss: bossBar, bossBar: bossBar, heroCard: heroCard, hero: heroCard,
    gem: questionGem, questionGem: questionGem, tip: companionTip, companionTip: companionTip,
    xp: xpTrack, xpTrack: xpTrack, chest: lootChest, lootChest: lootChest, flow: flowHtml
  };

  function mount(target, kind, opts) {
    if (!doc) return null;
    var el = typeof target === 'string' ? doc.querySelector(target) : target;
    var build = BUILDERS[kind];
    if (!el || !build) return null;
    var tmp = doc.createElement('div');
    tmp.innerHTML = build(opts || {});
    var first = null;
    while (tmp.firstChild) {
      var n = tmp.firstChild;
      if (!first && n.nodeType === 1) first = n;
      el.appendChild(n);
    }
    wire(el);
    return first;
  }

  /* Put the frame on a page element the builder already made (an A4 box
     such as the Science portal's .cs-page). Its own children stay where they
     are; it gets the safe-area padding as CSS variables. */
  function decorate(el, opts) {
    if (!doc || !el) return null;
    opts = opts || {};
    var s = subjectOf(opts.subject);
    var w = worldOf(opts.world) || worldFor(s, opts.topic || opts.title);
    var variant = pageVariant(opts);
    var safe = safeArea(variant);
    undecorate(el);
    el.classList.add('qf-decorated', 'qf-world-' + w.id, 'qf-subject-' + s, 'qf-page--' + variant);
    el.style.setProperty('--qf-at-top', safe.top + 'px');
    el.style.setProperty('--qf-at-bottom', safe.bottom + 'px');
    el.style.setProperty('--qf-at-x', safe.left + 'px');
    if (opts.theme) el.setAttribute('data-theme', opts.theme);
    var layer = toElement('<div class="qf-frame-layer qf-frame-layer--overlay">' +
      border({ world: w, quest: opts.quest, page: opts.page, variant: variant, seed: opts.seed, sockets: variant !== 'calm' }) +
      header(opts, w, s, variant) + (variant === 'calm' ? '' : footer(opts, w, s, variant)) + '</div>');
    el.insertBefore(layer, el.firstChild);
    wire(el);
    return layer;
  }

  function undecorate(el) {
    if (!el) return;
    var old = el.querySelector(':scope > .qf-frame-layer--overlay');
    if (old) old.remove();
    Array.prototype.slice.call(el.classList).forEach(function (c) {
      if (/^qf-(decorated|world-|subject-|page--)/.test(c)) el.classList.remove(c);
    });
    ['--qf-at-top', '--qf-at-bottom', '--qf-at-x'].forEach(function (p) { el.style.removeProperty(p); });
  }

  /* A whole worksheet: n pages, the first a start page and the last the
     finale, each with its own content. */
  function quest(o) {
    o = o || {};
    var pages = Array.isArray(o.pages) ? o.pages : [];
    var n = pages.length || 1;
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push(pageHtml(Object.assign({}, o, { page: i + 1, pages: n, content: pages[i] || '', variant: n === 1 ? 'start' : undefined })));
    }
    return out.join('');
  }

  /* Element-returning components, named as the design system lists them. */
  function elementOf(fn) { return function (props) { var el = toElement(fn(props || {})); if (el) wire(el); return el; }; }

  var api = {
    version: VERSION,
    PAGE: PAGE,
    FITS: FITS,
    WORLDS: WORLDS,
    BOSSES: BOSSES,
    ITEMS: ITEMS,
    RUNES: RUNES,
    HEROES: HEROES,
    COMPANIONS: COMPANIONS,
    RARITIES: RARITY_ORDER.slice(),
    CHEERS: CHEERS.slice(),
    art: art,
    /* string builders */
    page: pageHtml,
    quest: quest,
    flow: flowHtml,
    border: border,
    banner: banner,
    bossBar: bossBar,
    heroCard: heroCard,
    questionGem: questionGem,
    companionTip: companionTip,
    xpTrack: xpTrack,
    lootChest: lootChest,
    worldChip: worldChip,
    sprite: sprite,
    pixel: pixelSvg,
    plate: plate,
    /* DOM */
    mount: mount,
    decorate: decorate,
    undecorate: undecorate,
    wire: wire,
    toElement: toElement,
    /* element components */
    QuestPage: elementOf(pageHtml),
    PixelBorder: elementOf(border),
    QuestBanner: elementOf(banner),
    BossBar: elementOf(bossBar),
    HeroCard: elementOf(heroCard),
    QuestionGem: elementOf(questionGem),
    CompanionTip: elementOf(companionTip),
    XPTrack: elementOf(xpTrack),
    LootChest: elementOf(lootChest),
    /* pure helpers */
    worldFor: worldFor,
    bossFor: bossFor,
    heroFor: heroFor,
    companionFor: companionFor,
    safeArea: safeArea,
    pure: {
      esc: esc, clamp: clamp, hash: hash, rng: rng, subjectOf: subjectOf, worldOf: worldOf, worldFor: worldFor,
      rarityForMarks: rarityForMarks, heartsPlan: heartsPlan, xpPlan: xpPlan, bossesIn: bossesIn, bossFor: bossFor,
      heroFor: heroFor, companionFor: companionFor, cheerFor: cheerFor, safeArea: safeArea, lootFor: lootFor,
      cellOf: cellOf, gemRows: gemRows, pageVariant: pageVariant
    }
  };

  global.QuestFrames = api;
})(typeof window !== 'undefined' ? window : this);

/* =====================================================================
   🎮 QUEST FRAMES ON THIS SITE (polymathlc/cer).
   Everything above this line is the Polymath Quest Frames design system's
   bundle, unchanged. Below: where this site keeps the art, the teacher's
   one switch every worksheet builder shares, and the glue the builders call.
   ===================================================================== */
(function (global) {
  'use strict';
  var QF = global.QuestFrames;
  if (!QF) return;
  var doc = global.document;
  var script = doc && doc.currentScript;
  var BASE = (function () {
    try { return new URL('.', (script && script.src) || global.location.href).href; }
    catch (e) { return 'https://polymathlc.com.sg/'; }
  })();
  var VERSION = '1.449.0';

  /* Art. The logo, the subject icons and the companions are already on this
     site; the Wheel Quest art is a print-sized copy in assets/quest-frames
     (see its README.md and manifest.json). Every copy keeps its source's
     aspect ratio, so the frame still crops in the source's own pixels. */
  var HERE = {
    'logo': 'assets/branding/polymath-learning-centre.png',
    'math-icons': 'assets/worksheet-covers/math-icons-v2.png',
    'science-icons': 'assets/worksheet-covers/science-icons-v2.png'
  };
  function artPath(e) {
    if (HERE[e.key]) return HERE[e.key];
    if (e.repo === 'tutor') return 'assets/worksheet-characters/' + e.path.split('/').pop();
    return 'assets/quest-frames/' + e.key + '.webp';
  }
  function abs(path) { return new URL(path, BASE).href; }
  QF.art.use({ resolve: function (e) { return abs(artPath(e)); } });

  /* ONE switch for every builder on the page: the portal's worksheet
     builder, My Worksheets, and the Maths and Science creators. It is the
     TEACHER's alone, and it is NEVER REMEMBERED.
     - The page says who the teacher is (`teacher(fn)`). Until it does, and
       whenever `fn()` says no or throws, every toggle is hidden, disabled and
       unticked and `on()` is false, so a student, an employee, "Practise as"
       and a signed-out page can never print a framed sheet. It fails CLOSED:
       a page that forgets to register prints the old sheet, never a frame.
     - Nothing is stored. Every visit starts unticked, so a worksheet is framed
       only when the teacher ticked the box before generating it.
     - `roleChanged(who)` unticks it whenever the PERSON changes (a sign-in, a
       sign-out, a hand-over to a student) and only then: a page that redraws
       its sign-in strip for the same teacher keeps the tick just made.
     - A toggle's box (its `[data-quest-frame-box]`, else its `<label>`) is
       hidden with an inline display and given back the display the page drew
       it with, because the portal lays its labels out with an inline flex. */
  var ticked = false;
  var teacherCheck = null;
  var lastWho = null;
  function teacher() {
    if (typeof teacherCheck !== 'function') return false;
    try { return !!teacherCheck(); } catch (e) { return false; }
  }
  function on() { return ticked && teacher(); }
  function toggleBox(el) {
    if (!el || typeof el.closest !== 'function') return null;
    return el.closest('[data-quest-frame-box]') || el.closest('label');
  }
  function showBox(box, show) {
    if (!box || !box.style || typeof box.getAttribute !== 'function') return;
    if (box.getAttribute('data-qf-display') == null) box.setAttribute('data-qf-display', box.style.display || '');
    box.style.display = show ? box.getAttribute('data-qf-display') : 'none';
  }
  function sync() {
    var t = teacher();
    if (!t) ticked = false;
    if (!doc) return;
    Array.prototype.forEach.call(doc.querySelectorAll('input[data-quest-frame-toggle]'), function (el) {
      el.checked = ticked;
      el.disabled = !t;
      showBox(toggleBox(el), t);
    });
  }
  function set(v) {
    ticked = !!v && teacher();
    sync();
  }
  function setTeacher(fn) {
    teacherCheck = typeof fn === 'function' ? fn : null;
    sync();
  }
  function roleChanged(who) {
    who = who == null ? '' : String(who);
    if (who !== lastWho) { lastWho = who; ticked = false; }
    sync();
  }
  if (doc) {
    doc.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('input[data-quest-frame-toggle]')) set(t.checked);
    });
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', sync); else sync();
  }

  function mostCommon(list) {
    var counts = {}, best = '', n = 0;
    (list || []).forEach(function (t) {
      t = String(t || '').trim();
      if (!t) return;
      counts[t] = (counts[t] || 0) + 1;
      if (counts[t] > n) { n = counts[t]; best = t; }
    });
    return best;
  }

  /* The quest a printed worksheet goes on: its world (from the topics, then
     the title), the boss (seeded by the title, so a reprint meets the same
     one), one heart per question, and the marks the treasure chest is scored
     out of (0 when no question carries marks: the chest then has no total). */
  function ctx(o) {
    o = o || {};
    var subject = QF.pure.subjectOf(o.subject || 'science');
    var title = String(o.title || '').trim() || 'Worksheet';
    var topic = mostCommon(o.topics);
    var world = QF.worldFor(subject, topic ? topic + ' ' + title : title);
    var whole = function (v) { v = Math.floor(Number(v) || 0); return v > 0 ? v : 0; };
    return { subject: subject, title: title, topic: topic, world: world.id, seed: title, questions: whole(o.questions), total: whole(o.total) };
  }

  /* Every picture a framed sheet will show, fetched before the print dialog
     opens: SVG <image> elements are not in document.images, so nothing else
     waits for them, and a sprite still in flight prints as a blank square. */
  function hrefsIn(root) {
    var out = [];
    if (!root || !root.querySelectorAll) return out;
    Array.prototype.forEach.call(root.querySelectorAll('svg image'), function (im) {
      var h = im.getAttribute('href') || im.getAttribute('xlink:href');
      if (h && out.indexOf(h) < 0) out.push(h);
    });
    return out;
  }
  function load(urls, timeoutMs) {
    return new Promise(function (resolve) {
      var left = urls.length;
      if (!left) { resolve(); return; }
      var done = false;
      var finish = function () { if (!done) { done = true; resolve(); } };
      setTimeout(finish, timeoutMs || 8000);
      urls.forEach(function (u) {
        var im = new Image();
        im.onload = im.onerror = function () { if (--left <= 0) finish(); };
        im.src = u;
      });
    });
  }
  function ready(root, timeoutMs) { return load(hrefsIn(root || doc), timeoutMs); }
  function preload(q) {
    if (!q) return Promise.resolve();
    var w = QF.pure.worldOf(q.world) || QF.WORLDS[0];
    var c = QF.companionFor(q.subject).id;
    var keys = ['logo', 'runes', 'chest', 'science-icons', 'math-icons', w.scene, 'hero-warrior', 'hero-mage', 'hero-ranger', 'hero-cleric', 'items-1', 'items-2', 'items-3', 'items-4', 'items-5',
      c + '-welcome', c + '-encourage'];
    var b = QF.bossFor(w.id, null, { seed: q.seed });
    keys.push(b.atlas || b.art);
    return load(keys.filter(Boolean).map(function (k) { return QF.art.url(k); }), 8000);
  }

  /* ---------------- the portal (index.html + app.js) ----------------

     A framed portal sheet is a QUEST PAGE in the design system's own layout
     (`QF.decorate`, the same header and footer the creators' pages carry):
     the rampart round the sheet; a header band with the quest banner and the
     boss with one heart per question; a footer band with a hero standing on
     the wall, the XP trail and a companion's cheer, or on the last sheet the
     treasure chest. Page 1 is the START page when the name fields are on: the
     full banner with the logo, the boss with its rule of play, and the hero
     card, which IS the name fields.

     SHEET is the box the questions print in, between the two bands. The print
     planner plans every framed sheet to `contentPx()` tall and 178mm wide (the
     16mm sides every other sheet has), so a question can never run under a
     band: the planner MEASURES what fits, it never assumes. quest-frames.css
     repeats these numbers in the framed sheet's padding, and
     tools/quest-frames-tests.mjs fails if the two disagree.
       top     the trail header's safe line (the start page adds `startExtra`
               in its own lead, below, so every sheet plans to ONE height);
       bottom  the tallest footer — the finale's treasure chest — on every
               sheet, so the last sheet needs no plan of its own, plus FOOT_GAP:
               a portal sheet always ends on its copyright row and page number,
               right at the foot of the box, where a creator's page rarely
               reaches, and without the gap that number sits on the chest;
       296mm   not 297: a sheet a hair over A4 spills a blank page after it. */
  var FOOT_GAP = 14;
  var SHEET = (function () {
    var P = QF.PAGE;
    var top = P.safeTop.trail;
    var bottom = Math.max(P.safeBottom.start, P.safeBottom.trail, P.safeBottom.finale) + FOOT_GAP;
    return Object.freeze({ heightMm: 296, sideMm: 16, top: top, bottom: bottom, startExtra: P.safeTop.start - top });
  })();
  var PX_PER_MM = 96 / 25.4;
  function contentPx() { return SHEET.heightMm * PX_PER_MM - SHEET.top - SHEET.bottom; }

  /* The hero card on page 1 is the sheet's name fields. Name and Date only,
     like the portal's own strip and its cover: Class went in v1.438.0. */
  var PORTAL_FIELDS = [['HERO NAME', 'name'], ['DATE', 'date']];

  /* Page 1's LEAD, emitted where the old page-1 header was (inside the first
     question's chunk, so the planner measures it with that question). It says
     two things:
       • which quest the worksheet is on (`data-qf`), so the planner, the
         printer and the live preview all read the framing off the very markup
         they lay out and can never disagree about it;
       • with the name fields on, the room the START header needs below the
         trail header's line. Its height is divided by `--qf-pz`, the
         fit-to-page zoom the planner, the printer and the preview put on the
         page content, so the room stays exactly `startExtra` px however the
         questions under it are shrunk, and the planner measured it that way.
     With the fields off, page 1 is an ordinary trail page and the lead is an
     empty marker that takes no room at all. `hasCover` makes no difference:
     the page-1 strip has always printed under a cover too. */
  function portalLead(q, hasCover, noFields) {
    if (!q) return '';
    var start = !noFields;
    var data = {
      world: q.world, seed: q.seed, subject: q.subject, title: q.title,
      questions: q.questions, total: q.total || 0, start: start
    };
    return '<div class="qf-print-lead' + (start ? ' qf-print-lead--start' : '') + '" aria-hidden="true" data-qf="' + QF.pure.esc(JSON.stringify(data)) + '"' +
      (start ? ' style="height:calc(' + SHEET.startExtra + 'px / var(--qf-pz, 1))"' : '') + '></div>';
  }

  /* The quest a lead names, checked: an unknown world is the subject's first,
     the numbers are whole and never negative, the title is never empty. */
  function leadCtxOf(el) {
    if (!el || typeof el.getAttribute !== 'function') return null;
    var raw = el.getAttribute('data-qf');
    if (!raw) return null;
    var d;
    try { d = JSON.parse(raw); } catch (e) { return null; }
    if (!d || typeof d !== 'object') return null;
    var subject = QF.pure.subjectOf(d.subject || 'science');
    var world = QF.pure.worldOf(d.world) ? String(d.world) : QF.worldFor(subject, String(d.title || '')).id;
    var whole = function (v) { v = Math.floor(Number(v) || 0); return v > 0 ? v : 0; };
    return {
      subject: subject, world: world, seed: d.seed == null ? String(d.title || '') : String(d.seed),
      title: String(d.title || '').trim() || 'Worksheet', questions: whole(d.questions), total: whole(d.total), start: !!d.start
    };
  }
  function leadCtx(root) {
    if (!root || typeof root.querySelector !== 'function') return null;
    return leadCtxOf(root.querySelector('.qf-print-lead'));
  }

  /* A question's number as a gem. With marks, the gem is that marks' loot
     rarity; a question with no marks set is a plain rare gem with no pips. */
  function gem(n, marks, size) {
    var m = Number(marks) || 0;
    return QF.questionGem({ n: n, marks: m || undefined, rarity: m ? undefined : 'rare', showMarks: !!m, size: size || 30, className: 'qf-print-gem' });
  }

  /* Which page of the quest a sheet is: the sheet holding the start lead is
     the START, the last framed sheet the FINALE (the treasure), every other a
     stretch of the TRAIL. A one-sheet worksheet with the name fields is a
     start page; without them it is the finale. */
  function variantOf(sheet, i, n) {
    if (sheet && sheet.querySelector && sheet.querySelector('.qf-print-lead--start')) return 'start';
    return i === n - 1 ? 'finale' : 'trail';
  }

  /* Dress a run of sheets as the quest's pages, in order. Shared by the
     printer (framePrintPages) and the live preview (app.js _wsPreviewPack),
     so the two put the same header, footer and treasure on the same sheet.
     A sheet already dressed is redressed rather than given a second layer. */
  function frameSheets(sheets, q, opts) {
    opts = opts || {};
    var list = Array.prototype.slice.call(sheets || []).filter(Boolean);
    if (!q || !list.length || !doc) return 0;
    var n = list.length;
    list.forEach(function (sheet, i) {
      var variant = variantOf(sheet, i, n);
      sheet.classList.add('qf-sheet');
      if (opts.still) sheet.classList.add('qf-still');
      QF.decorate(sheet, {
        subject: q.subject, title: q.title, world: q.world, seed: q.seed,
        questions: q.questions, total: q.total || null,
        page: i + 1, pages: n, variant: variant,
        fields: PORTAL_FIELDS,
        /* The design system cheers a TRAIL page by its number from page 2 on,
           so a page 1 that is not a start page (the name fields are off) would
           be told it is "almost at the treasure". The quest begins on page 1. */
        cheer: i === 0 && variant === 'trail' ? QF.CHEERS[0] : undefined
      });
    });
    return n;
  }

  /* After the planner has built and numbered every sheet: dress each ordinary
     question sheet as a quest page. The sheet becomes a margin-free A4 box
     (quest-frames.css; the named page is ALSO declared in index.html, after its
     own plain @page — see there) padded down to SHEET, the very box the
     planner planned it to. Tall pages (one question flowing over several
     sheets) and answer-key pages keep their plain look and the ordinary
     margins. The quest comes from the lead in the markup when the caller has
     none to hand, so a reprint of the same HTML is framed the same way. */
  function framePrintPages(output, q) {
    if (!output || !doc) return 0;
    q = q || leadCtx(output);
    if (!q) return 0;
    var sheets = Array.prototype.filter.call(output.querySelectorAll(':scope > .print-question-page'), function (page) {
      return !page.classList.contains('print-page-tall') && !page.classList.contains('print-answer-key-page');
    });
    return frameSheets(sheets, q, { still: true });
  }

  /* ---------------- the Maths and Science creators ---------------- */

  function gemSlots(html) {
    return String(html).replace(/<div class="question-number">\s*([^<]*?)\s*<\/div>/g, function (m, n) {
      return '<div class="question-number qf-gem-slot">' + QF.questionGem({ n: n, rarity: 'rare', showMarks: false, size: 34 }) + '</div>';
    });
  }

  /* One Quest page per printed question sheet: page 1 the start (banner,
     boss, hero card), the last the finale (treasure), the rest the trail.
     An instruction block rides on the page of the question after it. Returns
     '' when there is nothing to frame, and the caller prints as before. */
  function creatorBody(o) {
    o = o || {};
    var pages = [], intro = '', count = 0;
    (o.sections || []).forEach(function (s) {
      if (!s || !s.html) return;
      if (s.instruction) { intro += s.html; return; }
      count++;
      String(s.html).split(/(?=<section class="print-question")/).filter(function (x) { return x.trim(); }).forEach(function (piece, k) {
        pages.push((k === 0 ? intro : '') + gemSlots(piece));
        if (k === 0) intro = '';
      });
    });
    if (intro) { if (pages.length) pages[pages.length - 1] += intro; else pages.push(intro); }
    if (!pages.length) return '';
    var q = ctx({ subject: o.subject, title: o.title, topics: o.topics, questions: count });
    return QF.quest({ subject: q.subject, title: q.title, world: q.world, seed: q.seed, questions: q.questions, pages: pages, motion: false });
  }

  function creatorCss() {
    return '\n@page qf-page { size: A4 portrait; margin: 0; }\n' +
      '.qf-page { page: qf-page; margin: 0 auto; }\n' +
      '.qf-content { display: flex; flex-direction: column; }\n' +
      '.qf-content > .print-question { flex: 1 1 auto; min-height: 0 !important; page-break-after: auto !important; break-after: auto !important; }\n' +
      '.qf-content > .print-question > .question-card { height: 100%; }\n' +
      '.qf-content > .print-instruction { flex: none; margin: 0 0 14px; page-break-after: auto !important; break-after: auto !important; }\n' +
      '.qf-content .question-number.qf-gem-slot { background: none !important; border: 0 !important; box-shadow: none !important; width: auto !important; height: auto !important; min-width: 0 !important; padding: 0 !important; color: inherit !important; }\n' +
      '.qf-page.qf-overflow { page: auto; width: auto; height: auto; overflow: visible; background: none; }\n' +
      '.qf-page.qf-overflow > .qf-frame-layer { display: none; }\n' +
      '.qf-page.qf-overflow > .qf-content { position: static; display: block; }\n' +
      '.qf-page.qf-overflow .print-question { min-height: 255mm !important; }\n';
  }

  /* For the print window's <head>: the frame's stylesheet and its fonts. */
  function printHead() {
    return '<link href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400..700&display=swap" rel="stylesheet">' +
      '<link rel="stylesheet" href="' + abs('quest-frames.css?v=' + VERSION) + '">';
  }

  /* For the print window's <script>: a question too tall for its framed page
     is printed the old way (it flows on, unframed) rather than clipped; and
     the sprites are waited for before window.print(). */
  function printScript() {
    return 'function qfFixOverflow(){document.querySelectorAll(".qf-page").forEach(function(p){var c=p.querySelector(".qf-content");if(c&&c.scrollHeight>c.clientHeight+2)p.classList.add("qf-overflow");});}\n' +
      'function qfReady(){var u=[];document.querySelectorAll("svg image").forEach(function(i){var h=i.getAttribute("href");if(h&&u.indexOf(h)<0)u.push(h);});' +
      'return new Promise(function(r){var n=u.length,d=false;function f(){if(!d){d=true;r();}}if(!n){f();return;}setTimeout(f,8000);u.forEach(function(h){var m=new Image();m.onload=m.onerror=function(){if(--n<=0)f();};m.src=h;});});}\n';
  }

  global.QuestFramesCer = {
    version: VERSION,
    on: on,
    set: set,
    sync: sync,
    teacher: setTeacher,
    isTeacher: teacher,
    roleChanged: roleChanged,
    ctx: ctx,
    preload: preload,
    ready: ready,
    SHEET: SHEET,
    contentPx: contentPx,
    portalLead: portalLead,
    leadCtx: leadCtx,
    leadCtxOf: leadCtxOf,
    gem: gem,
    variantOf: variantOf,
    frameSheets: frameSheets,
    framePrintPages: framePrintPages,
    creatorBody: creatorBody,
    creatorCss: creatorCss,
    printHead: printHead,
    printScript: printScript,
    artPath: artPath,
    mostCommon: mostCommon
  };
})(typeof window !== 'undefined' ? window : this);
