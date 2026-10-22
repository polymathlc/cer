# Quest frame art

Print-sized copies of Wheel Quest's own art from `polymathlc/anskey`
(`assets/battle-pixel/`), for the 🎮 Quest frame on printed worksheets
(`quest-frames.js`). They are not redrawn: each file is its source scaled down
with the same aspect ratio, as WebP. The four adventure scenes are lossless,
because they are true pixel art. `manifest.json` records every copy's source
path, size and SHA-256.

| File | Source | What it is |
|---|---|---|
| `hero-warrior/mage/ranger/cleric.webp` | `warrior.png` … `cleric.png` | The four base heroes, facing right |
| `enemy-*.webp` | `goblin.png`, `goblin-shaman.png`, `slime.png`, `golem.png`, `dragon.png`, `lich.png` | The six solo enemies |
| `bosses-01` … `bosses-10.webp` | `bosses/atlas-01.png` … `atlas-10.png` | 94 bosses, 5 × 2 per sheet, one sheet per world |
| `items-1` … `items-5.webp` | `items/items-1.png` … `items-5.png` | 50 relics, 5 × 2 per sheet |
| `runes.webp` | `items/runes-1.png` | 16 runes, 4 × 4 |
| `chest.webp` | `chest-sheet.png` | The treasure chest opening, 4 frames |
| `scene-forest/cavern/ruins/volcano.webp` | `adventure/*.png` | Backdrops for the banner's world window |

The frame crops atlas cells in the SOURCE's pixels (the SVG draws each copy at
its source width and height), so a copy must keep its source's aspect ratio
exactly; `tools/quest-frames-tests.mjs` checks every one against the manifest.
The logo, the subject icons and the companions are this site's own files
(`assets/branding/`, `assets/worksheet-covers/`, `assets/worksheet-characters/`).
