# CLAUDE.md

Guidance for Claude when working in this repo.

## Apps
- `index.html` — "Science Quest" CER science-quiz app: admin question authoring (block editor, AI build-from-screenshot, image crop/touch-up, vetting → bank) + student practice + an RPG/dungeon game layer. Single file: HTML + one large `<script type="module">`.
  - Functions referenced from inline `onclick`/`on*` handlers MUST be assigned to `window` near the bottom of the module (search `window.navigateTo =`), because the module has its own scope.
  - `const` declared mid-module is in its temporal dead zone earlier in the file — only read such values at call time, not at module-eval time.
- `science-worksheet.html`, `math-worksheet.html`, `math.html` — worksheet builder apps.

## Versioning convention — applies to EVERY change (do this every time)
1. **Bump the version.** In `index.html`, update `const APP_VERSION = 'vX.Y.Z'` (search `APP_VERSION`). Patch bump for fixes/small tweaks, minor bump for new features.
2. **Keep it visible.** The version renders in the sidebar footer for admins only (`#appVersionBadge`, class `admin-only`). This is how the user confirms the latest build is actually deployed.
3. **Report it.** When summarising an update in chat, always state the new version number (e.g., "Shipped in **v1.0.3**").

The whole point: the user checks the version shown in the app's sidebar against the number reported in chat to know whether the upload/deploy went through. (The user wants this as a standing feature for all their projects — mirror this section into other repos' CLAUDE.md / their global memory.)

## House rules
- After editing the module JS, validate it: extract the `<script type="module">` body and run `node --check`.
- Do NOT change enemy base `gold`/`xp` (the `RPG_ENEMIES` map step) — they are shared by the dungeon AND the per-question battle strip. Tune dungeon-only rewards via `ADV_XP_SCALE` / `ADV_GOLD_SCALE` and the floor-clear bonus instead.
- Commit messages and pushed artifacts must not contain the model identifier.
