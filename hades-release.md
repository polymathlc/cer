# Hades 2.2.0 student beta

This portal ships the full-size Hades build with fullscreen controls, premium chamber details, animated gate rings, spectral dash silhouettes and polished menus. BETA labels remain visible. Students play using their own school level; administrator preview stays separate.

## Reproduce the artifact

Check out polymathlc/hades at the `upstreamCommit` in `hades-game.manifest.json`, apply `hades-game.source.patch` with `git apply`, and run `python generate_game.py`. The resulting `index.html` is this portal’s `hades-game.html`; `learning-parent.js` is `hades-learning-parent.js`. The manifest hashes verify the generated game, parent bridge and source patch. The patch is portal-owned; it does not imply an upstream release.

Math uses the existing authenticated markAttempt callable for top-level MCQs without reading private answer keys. Existing bank block MCQs are graded in the parent. Science records student answers through the existing game attempt history. Sign-out, profile changes, failed marking and incomplete rounds cannot carry a reward into another session.
