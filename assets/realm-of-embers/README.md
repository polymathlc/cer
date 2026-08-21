# Realm of Embers art

A complete art pass for every Realm of Embers slot the app defines, versioned
with the app itself.

| Folder | Files | App slots |
| --- | ---: | --- |
| `card-art/` | 201 | `c001` … `c201` |
| `battle-avatars/` | 201 | `c001:av` … `c201:av` |
| `artifacts/` | 30 | `arti:<id>` |
| `pack-ripping/` | 42 | `pk:<set>:<tier>:<frame>` |
| `attack-animation/` | 180 | `fx:<element>:<phase><frame>` |
| `heroes/` | 5 | `hero:<id>` |

Total game-facing WebP images: **659**.

## How they reach the screen

They are the app's **bundled default layer** — see *THE BUNDLED REALM OF EMBERS
ART* in `app.js` and `CLAUDE.md`. `tcgSlotArt(slot)` returns the admin's
override if there is one and this artwork otherwise, so every picture here is
live for every student with nothing to press and nothing uploaded.

Nothing is copied into Firestore or Storage. The `overrides` map stays what it
has always been — the record of what an admin has drawn or replaced — and this
folder is the floor underneath it. That also makes the art the one thing in the
game a lost `overrides` map cannot take away: it is in git.

The paths are **derived** from the slot id (a card's file is its id plus the
slug of its own name; an effect frame is its element and phase; a pack frame is
its set and tier), so nothing has to be listed twice. `tools/bundled-art-tests.mjs`
walks all 659 against both `manifests/slot-map.json` and the files on disk —
run it after renaming a card, moving a file or adding a set.

## Backgrounds

Card scenes keep their painted background. Everything that **stands on nothing**
— battle avatars, artifact objects, hero portraits, effect frames, pack frames
— carries a real alpha channel and is ready to composite as-is.

Most of the original sprite pass did not arrive that way: those assets were
drawn against one flat chroma wall, and the wall was keyed out at build time by
**`tools/key-realm-sprites.mjs`**, which runs the app's own `_screenKeyOut`
rather than a copy of it. That tool is idempotent — a sprite already standing on
nothing carries no wall and is left untouched — so it is safe to re-run after
adding art. If a violet subject shares the broad magenta screen hue, the build
tool falls back to a sampled-RGB key that removes the actual border plate while
retaining the main connected character. This is what lets all 201 battle
avatars ship with alpha without dissolving the psychic and shadow characters.

## Manifests and previews

- `manifests/slot-map.json` — the compact slot → file map. The harness checks the
  app's derived paths against it.
- `manifests/asset-manifest.json` — full character metadata and the production
  prompts extracted from `app.js`.
- `manifests/asset-prompts.jsonl` — the same prompts, line-oriented.
- `previews/*-qa.png` — the generation pass's own QA montages. `avatar-qa.png`
  and `heroes-qa.png` show those sprites **as drawn**, on their chroma wall.
- `previews/keyed-sprites-qa.png` — the same sprites **after keying**, over a
  checkerboard so a hole punched in a sprite would be visible. Written by
  `tools/key-realm-sprites.mjs`.

## Sizes

Normalised to the same ceilings `_tcgArtStore` uses:

- card art, artifact objects, pack frames and hero portraits: 512 × 512
- battle avatars and effect frames: 256 × 256

Run `node tools/check-realm-assets.mjs` to verify every expected file and
dimension, and `node tools/bundled-art-tests.mjs` to verify the app can find
them.
