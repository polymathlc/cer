# Science Quest avatar v2

This folder contains the generated, layered Science Quest character and equipment set introduced in v1.312.0 and recalibrated to the generated character silhouette in v1.313.1.

Status: **admin beta**. `RPG_ART_BETA_RELEASED` in `app.js` is intentionally `false`, so students continue to receive the existing SVG avatars. Admins can toggle the generated set for comparison and unlock the full 143-item catalogue on their own test hero.

Layout:

- `characters/`: neutral male and female base characters.
- `items/<slot>/`: one transparent WebP per RPG item id.
- `previews/`: visual QA contact sheets.
- `asset-manifest.json`: item names, ids, slots, rarity, layer and prompts.
- `asset-qa.json`: exported dimensions and alpha-channel checks.

The shared `rpgAvatarSvg()` compositor layers equipment over the base character in every avatar surface. Keep filenames keyed to stable item ids; changing names is safe, changing ids is a save-data migration.

Generated armour, helmets and front accessories use dedicated square mounts rather than the taller legacy SVG paper-doll boxes. Any future base-character replacement must be checked against the common, epic and mythic loadouts in `previews/loadouts-qa.png` before release.
