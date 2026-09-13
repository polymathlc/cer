# Science interface

The approved arcade interface is permanent for every signed-in account.
The former Interface Studio banner, comparison buttons, release dialog and
rollback controls have been removed. Existing release flags and preview choices
are ignored; signing in applies the interface immediately without waiting for
a configuration read. Refresh a previously open tab after deployment to load
this version.

The interface no longer reads or writes `config/admin.arcadeUi`. Other
configuration, account permissions and learning features are unchanged.

`arcade-ui.css` contains screen-only styles scoped to `body.arcade-ui`. Printing
uses the existing styles. Buttons have raised edges, hover lift and press
feedback. Leaderboards keep real ordering and scores, adding staggered row
entrances, medal movement and house-score fills. Animations respect system
reduced-motion settings; a **Motion on/off** control is available in the sidebar.
The design uses original controls and the apps' existing artwork, with no copied
game logos or characters.

`interface-studio.mjs` is shared verbatim with the other subject. Keep the two
copies in sync. Sign-out clears the signed-in theme; signing into any account
applies the permanent interface. Motion preferences remain per subject and
browser tab.

Validation: `node tools/interface-studio-tests.mjs`; existing focused regression
suites; main module syntax checks. GitHub Actions runs the interface tests.
