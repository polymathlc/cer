# Realm of Embers generated art

This folder contains a complete generated-art pass for every requested Realm of Embers slot defined in `app.js`.

## Contents

| Folder | Files | App slots |
| --- | ---: | --- |
| `card-art/` | 201 | `c001` … `c201` |
| `battle-avatars/` | 201 | `c001:av` … `c201:av` |
| `pack-ripping/` | 42 | `pk:<set>:<tier>:<frame>` |
| `attack-animation/` | 180 | `fx:<element>:<phase><frame>` |
| `heroes/` | 5 | `hero:<id>` |

Total game-facing WebP images: **629**.

`manifests/slot-map.json` is the compact runtime slot-to-file map. `manifests/asset-manifest.json` records the full character metadata and production prompts extracted from the app. `manifests/asset-prompts.jsonl` is a line-oriented prompt/job list. `previews/` contains representative QA montages.

## Import behavior

The Card Art admin panel includes **Install bundled Realm art**. It reads `slot-map.json`, replaces the 629 Realm-owned slots with this verified mapping, and runs stand-alone sprites through CER's existing background cleaner before upload. This is the safe recovery path when another game's art has been written into matching slot IDs.

- Card art is already full-bleed and keeps its painted scene.
- Battle avatars, pack frames, attack frames, and hero portraits are production sources on the flat chroma screens requested by CER's own art pipeline. Uploading them through the app calls `_tcgArtStore`, which runs `_stripImageBackground` for every stand-on-nothing slot.
- Aeonyx's battle avatar already has a verified alpha channel; the installer safely accepts it too.
- If a model retained a dark or patterned plate, use the existing **Clean painted backgrounds** action after upload. The app was built for this exact generated-art failure mode.

## Output sizes

The game-facing WebP images are normalized to the same ceilings used by `_tcgArtStore`:

- card art, pack frames, and hero portraits: 512 × 512
- battle avatars and elemental effect frames: 256 × 256

Generation source atlases are intentionally kept outside the checkout under the workspace `work/realm-of-embers-intermediates/` folder, so the repository contains only deployable PNGs, manifests, and QA previews.

Run `node tools/check-realm-assets.mjs` from the repository root to verify every expected PNG and dimension.
