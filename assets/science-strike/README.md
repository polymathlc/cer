# Science Strike: Reactor Frontier art

Seven original assets generated using the built-in `image_gen` tool for Science
Strike v2.0.0. The complete final prompt set is in [prompts.json](prompts.json).
The PNGs retain real alpha transparency. Originals remain in the generation
Library; these project copies are resized to a maximum 1024-pixel edge for the
960 x 540 game canvas. The panorama is a 2048 x 683 WebP (about 109 KB).
All seven deployed images total about 4.2 MB; no external art service is needed
to play. Models and enemy animation/flash canvases are decoded and cached once.

| File | Used in the game |
| --- | --- |
| reactor-panorama.webp | Directional, scope-aware skyline and menu backdrop |
| enemy-sentinel.png | Sentinel, hunter droid, scrap walker, pylon mech, siege golem |
| enemy-stalker.png | Crawler and volt spider |
| weapon-blaster.png | Blaster |
| weapon-assault.png | Pulse SMG, carbine, assault and battle rifles |
| weapon-scatter.png | Scatter, plasma thrower and arc cannon |
| weapon-rail.png | Sniper rail, DMR, laser and crossbow |

Weapon sprites appear in first person, in the menu armory and as ground loot.
Measured muzzle anchors keep flashes attached to each image through recoil and
reload. Rarity and element feedback remains live. Generated enemies retain
per-type hue variants, two cached animation frames, flash silhouettes and
letterbox-aware critical zones measured against their visible heads.

If a file fails to load, the original procedural rendering remains playable.
Other enemy species keep their distinct procedural silhouettes.
