# Science Quest pixel paper-doll v1

Status: admin-only beta. Students continue to receive the existing SVG avatar while `RPG_PIXEL_BETA_RELEASED` is false.

Every character and equipment sprite is a complete transparent 96×96 PNG. The runtime places every layer at `x=0`, `y=0`, `width=96`, `height=96`; it does not resize or reposition individual items.

Layer order:

1. back accessory (capes and wings)
2. character
3. armour
4. helmet
5. front accessory
6. shield
7. weapon
8. pet

`sources/characters/` contains the image-generated character masters. Run `node tools/build-rpg-pixel-sprites.mjs` to rebuild the fixed-canvas atlas, manifest, alpha QA report, and preview sheets from those masters and the existing item art in `avatar-v2`.

Inventory and card illustrations are intentionally unchanged. This bundle is used only by character avatars in Science Quest game modes.
