# Hades 2.2.2 student beta

This portal ships the full-size Hades build with fullscreen controls, premium chamber details, animated gate rings, spectral dash silhouettes and polished menus. BETA labels remain visible. Students play using their own school level; administrator preview stays separate.

Cast now snapshots the floor position under the mouse cursor when Q or E is pressed, including the visible camera and screen shake. The circle stays at that world position until it expires or is detonated. Keyboard-only and touch controls retain assisted targeting. Repeated Doom hits keep their pending detonation; Chill stacking, pulse timing and slowdown are consistent; Blizzard pulls respect pillars; dash duration and knockback follow the actual movement.

2.2.2 fixes the Boons codex freeze. Pressing Tab, B or the Boons button with any boon equipped paused the run and then failed while drawing card portraits (`renderGodPortraitToCanvas` was never defined), so the codex never appeared and the run stayed frozen. The codex now draws each god's portrait from the god sheet (Duo boons get a gold sigil), pauses only once it is showing, and a portrait problem can no longer block it.

## Reproduce the artifact

Check out polymathlc/hades at the `upstreamCommit` in `hades-game.manifest.json`, apply `hades-game.source.patch` with `git apply`, and run `python generate_game.py`. The resulting `index.html` is this portal's `hades-game.html`; `learning-parent.js` is `hades-learning-parent.js`. The manifest hashes verify the generated game, parent bridge and source patch. The portal-owned patch includes the student-beta, presentation, 2.2.1 gameplay and 2.2.2 codex changes; this bundle does not imply an upstream release.

Math uses the existing authenticated markAttempt callable for top-level MCQs without reading private answer keys. Existing bank block MCQs are graded in the parent. Science records student answers through the existing game attempt history. Sign-out, profile changes, failed marking and incomplete rounds cannot carry a reward into another session.

CI verifies artifact hashes, five-question grading, all reward scores, student access, fullscreen and rendered question content. The bundled-game cursor regression uses real mouse, keyboard and touch inputs, including camera movement, screen shake, scaled/offset canvas and layout changes without a fresh pointer event.
