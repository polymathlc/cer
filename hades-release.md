# Hades 2.2.4 student beta

The portal’s sanctuary question panel now accepts a flag and comment through the authenticated question report route. Reports stay tied to the displayed question and learner session, separate from answer grading and room rewards.

This portal ships the full-size Hades build with fullscreen controls, premium chamber details, animated gate rings, spectral dash silhouettes and polished menus. BETA labels remain visible. Students play using their own school level; administrator preview stays separate.

Cast now snapshots the floor position under the mouse cursor when Q or E is pressed, including the visible camera and screen shake. The circle stays at that world position until it expires or is detonated. Keyboard-only and touch controls retain assisted targeting. Repeated Doom hits keep their pending detonation; Chill stacking, pulse timing and slowdown are consistent; Blizzard pulls respect pillars; dash duration and knockback follow the actual movement.

2.2.2 fixes the Boons codex freeze. Pressing Tab, B or the Boons button with any boon equipped paused the run and then failed while drawing card portraits (`renderGodPortraitToCanvas` was never defined), so the codex never appeared and the run stayed frozen. The codex now draws each god's portrait from the god sheet (Duo boons get a gold sigil), pauses only once it is showing, and a portrait problem can no longer block it.

## Reproduce the artifact

2.2.3 applies escalating life loss for each verified wrong answer, in actual
answer order. Consecutive misses cost 8%, 16%, 28%, then 45% maximum life; the
fifth ends the run, bypassing invulnerability and Death Defiance. A correct
answer resets the streak. Fresh runs start fresh. Parent-owned grading emits
only a final boolean grade and its ordered index to the matching pending game
checkpoint; cancelled, unconfirmed, stale and replayed messages cannot apply a
penalty or revive an ended run. Defeat closes the learning overlay and retires
the gate callback before a reward or chamber transition can run.

The standalone artifact embeds the exact shared `game-question-pressure.js`
policy. Its source hash is recorded in the manifest and the artifact check
compares both that hash and the embedded source, so a shared-policy change
requires rebuilding the bundle. The source patch includes the policy used by
the generator and by the parent bridge; no external runtime request is needed
by the bundled game.

Check out polymathlc/hades at the `upstreamCommit` in `hades-game.manifest.json`, apply `hades-game.source.patch` with `git apply`, and run `python generate_game.py`. The resulting `index.html` is this portal's `hades-game.html`; `learning-parent.js` is `hades-learning-parent.js`. The manifest hashes verify the generated game, parent bridge and source patch. The portal-owned patch includes the student-beta, presentation, 2.2.1 gameplay and 2.2.2 codex changes; this bundle does not imply an upstream release.

Math uses the existing authenticated markAttempt callable for top-level MCQs without reading private answer keys. Existing bank block MCQs are graded in the parent. Science records student answers through the existing game attempt history. Sign-out, profile changes, failed marking and incomplete rounds cannot carry a reward into another session.

CI verifies artifact hashes, five-question grading, all reward scores, student access, fullscreen and rendered question content. The bundled-game cursor regression uses real mouse, keyboard and touch inputs, including camera movement, screen shake, scaled/offset canvas and layout changes without a fresh pointer event.
