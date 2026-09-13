# Science Strike v1.9.0

Released with the Science portal v1.382.0.

## Playing

The menu now explains the run in three steps, shows whether suitable Science
questions are ready, and keeps the full guide in an expandable section. Class
choices and wave upgrade cards work with the keyboard as well as the mouse.
Use a computer with a keyboard and mouse; the game checks readiness before
spending a run credit.

Aim & comfort settings are available from both the menu and the pause screen.
Aim speed is adjustable, and reduced motion removes screen shake and weapon
sway. Settings are remembered on the device; the initial reduced-motion choice
respects the operating system preference.

Shift gives a short quickstep in the movement direction, with a 2.4-second
cooldown. Movement remains collision-checked, and quickstep does not grant
invulnerability. Diagonal movement has the same speed as straight movement.
Ranged enemies root while charging and fire along their announced direction;
amber marks on the ground and radar show the lane before the shot.

The world uses multiple cached tree and rock silhouettes, contact shadows and
distance fading. The scenery adds no network requests. Enemy animation follows
active play time and respects reduced motion.

## Pauses and science checks

Combat and the Science countdown advance only while mouse control is confirmed
and the game window is active. Leaving the window, switching tabs, opening the
skill tree or answering a question clears held movement, firing and aiming
inputs. If the browser refuses mouse control, the run stays paused with a retry
message. Resuming an existing run does not spend another credit.

Science questions retain the shared school-level, mastery, quality and spacing
rules. Number keys select answers, and feedback keeps the game paused until the
student chooses Continue. Each displayed question can settle only once, so
repeated clicks or keys cannot multiply results or rewards. Wrong answers show
the correct option and the supplied explanation before play resumes.

The HUD includes the current Science result count. Run duration reports active
play time, excluding pauses. The held weapon is positioned inside the view so
its barrel and firing feedback remain visible. Existing weapons, classes, skill trees, wave drafts,
reward values and portal accounting remain in place.

## Verification

`tools/science-strike-tests.mjs` exercises production game state and input
handlers. `tools/science-strike-browser-tests.mjs` loads the actual game page,
scripts, canvas renderer and question policy with isolated Firebase and browser
API boundaries. Its test accounts, question bank and writes are synthetic.
The existing Science feeding checks continue to cover year limits, mastery,
duplicate spacing, broken images and mixed-question restrictions.

The Non-TCG gameplay checks workflow runs both state and browser checks and
retains gameplay screenshots for review.
