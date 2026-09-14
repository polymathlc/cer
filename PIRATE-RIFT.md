# One Piece: Pirate Rift — beta 1.0.0

A separate isometric action RPG in the Math and Science Arcades. Play Luffy, Zoro, Whitebeard or Shanks through nine encounters and three boss fights. Each character has a basic attack, a signature technique, and an ultimate. Fight staggered enemy waves, dodge marked attacks, collect equipment, and choose upgrades as you level up.

| Action | Desktop | Touch |
| --- | --- | --- |
| Move | WASD / arrows | Left movement pad |
| Aim | Mouse cursor | Closest living enemy / facing direction |
| Strike | Hold click or J | Hold first skill |
| Signature | E / K / right click | Second skill |
| Ultimate | Q / F | Third skill |
| Dodge | Space | Dodge |
| Heal | R | Restore |
| Equipment | I | Equipment |
| Pause | Escape / P | Pause |

The game pauses for equipment, upgrade choices, focus loss and hidden tabs. A new expedition resets equipment and character levels; per-character best encounters, defeat counts, victories and preferences are saved locally. The portal scopes those records by account, learner, school level and subject. Closing the game, changing profiles or signing out removes its frame. This game does not write learning scores or consume the portal's other game credits. Hades remains separate.

Normal and boss encounters drop equipment of common, rare, epic or legendary quality. The first item for an empty equipment slot is equipped automatically; later items can be compared in Equipment. Finishing an encounter collects remaining treasure and restores some life and Spirit. The inventory retains up to 36 items and salvages lower-value excess loot into Berries. Bosses change their attack patterns below half life.

## Development and validation

The HTML, CSS and ES modules run directly from a static server. No build step, backend or external art service is needed to play. The simulation is separated from rendering and browser controls. Serve the repository and open `pirate-rift.html`; direct file URLs may not load ES modules. `?test=1` exposes the local test harness only, without any portal account authority.

- `node --test tools/pirate-rift-core.test.mjs tools/pirate-rift-portal-access-tests.mjs`
- `node tools/pirate-rift-browser-tests.mjs`
- `node tools/pirate-rift-portal-tests.mjs`

Browser tests use Playwright Chromium, with optional `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSER_CHANNEL` environment overrides. See `.github/workflows/pirate-rift.yml`. The renderer caps device-pixel ratio, caches the arena floor, bounds visual effects, isolates atlas silhouettes once, and supports reduced motion and missing-art fallbacks. All game files and the crew atlas are kept identical between both portals.

Artwork provenance and the generation prompt are recorded in `assets/pirate-rift/ART.md`.
