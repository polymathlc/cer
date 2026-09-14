# Character and Spire SVG collection

Release: **v1.385.0**.

Both character variants and all 143 wardrobe items now use illustrated SVG art.
The collection includes 55 weapons, 16 shields, 18 armour pieces, 17 helmets,
21 accessories and 16 pets, with vector designs for every pet evolution stage.
Spire also has 11 illustrated characters and 20 distinct card scenes, shared
with the portal Spellbook. Projectiles and spell effects use the vector art.

The illustrations use layered materials, faceted metal, carved motifs, gem
settings, cloth details and expressive faces. The hero retains the original
equipment anchors and animation groups so existing equipped items continue to
fit. Item IDs, ownership, statistics, prices, upgrades, deck choices and learning
policies are unchanged.

The generated-art beta switch and image-replacement controls for these collections
have been retired. Saved image uploads and legacy asset files remain stored;
they no longer override the active SVG collection. This update uses no image
generation calls, paid assets, external artwork requests or runtime AI.

## Shared rendering

- `rpg-svg-art.js`: complete equipment profiles and self-contained item fragments.
- `rpg-hero-svg.js`: both character variants and the animated weapon grip.
- `spire-svg-art.js`: Spire characters, card illustrations and effects.
- `app.js`: the shared avatar, inventory, loot, Spellbook and catalogue consumers.
- `science-spire.html`: character animation, cards and combat effects.

SVG definitions have unique IDs on each render. Pet evolution and item variants
use the same catalogue as the game. No bitmap or emoji replaces the main artwork.
The existing reduced-motion setting covers the added Spire effects.

## Verification

Catalogue checks cover every stable ID and pet stage, self-contained paint
references, repeated rendering, equipment placement and retired raster overrides.
Browser checks use the production renderers with isolated synthetic account data,
inspect desktop/mobile layouts and create review sheets. Existing Spire tests
continue to cover targeting, forecasts, credits, question loading, endless floors,
rewards and safe run endings.
