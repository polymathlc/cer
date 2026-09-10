# Science interface studio

Sign in to https://polymathlc.github.io/cer/ with your existing admin account.
The Interface Studio bar above the app opens the new look by default. Use
**View current interface** and **Preview new interface** to compare. This choice
is per admin, per subject, and per browser tab; it never releases anything.

When ready, choose **Release to students** and confirm in the dialog. The
separate **Return students to current interface** action restores the original
look. Connected, signed-in clients follow the saved release setting in real
time. Refresh a previously open tab after deployment to load this version.

The rollout flag is `config/admin.arcadeUi`, with `version: 1` and an explicit
boolean `released: true`. Missing, unknown, failed and cache-only snapshots do
not enable the student theme. Only an admin can invoke a write, through the
existing protected config document. A Firestore transaction checks for a
concurrent change and fails offline instead of queueing a later release. The
transaction merges its own field and preserves bank pointers and other settings.
No new Firestore rules, functions, or account privileges are needed.

`arcade-ui.css` contains screen-only styles scoped to `body.arcade-ui`. Printing
uses the existing styles. Buttons have raised edges, hover lift and press
feedback. Leaderboards keep real ordering and scores, adding staggered row
entrances, medal movement and house-score fills. Animations respect system
reduced-motion settings; a **Motion on/off** control is available in the sidebar.
The design uses original controls and the apps' existing artwork, with no copied
game logos or characters.

`interface-studio.mjs` is shared verbatim with the other subject. Keep the two
copies in sync. Sign-out and account switching unsubscribe and invalidate
callbacks so an admin preview cannot carry into a student's session.

Validation: `node tools/interface-studio-tests.mjs`; existing focused regression
suites; main module syntax checks. GitHub Actions runs the interface tests.
