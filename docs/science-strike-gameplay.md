# Science Strike v2.0.0 — Reactor Frontier

## Combat and art overhaul

The battlefield now uses an original generated research-valley panorama with
directional parallax and scope-aware framing, twilight mineral terrain, marked
outpost roads and survey beacons. Generated sentinel and stalker enemy families
have cached animation frames, color variants, hit flashes and critical zones
matched to their visible heads. Other species retain their distinct silhouettes.

Four generated first-person weapon models cover the twelve weapon archetypes;
the same art appears on ground loot and in the menu armory. Barrel flashes use
measured anchors and follow recoil and reload motion. The HUD shows magazine
capacity, low-ammo warnings and continuous reload progress. Weapon families
have distinct synthesized reports. Art lives locally in
`assets/science-strike/`; its README and `prompts.json` document every asset and
the complete built-in image-generation prompt set. Failed image downloads
retain the procedural renderer.

Ballistic rounds travel 3.5 times faster. Swept collision finds the nearest
enemy along a bullet's path, so a small minion cannot be skipped between frames.
Piercing applies once per victim in depth order, trunks stop bullets, and range
ends exactly at the weapon limit. Bullets and beams share the current camera
projection for body/head hits. Brief impact trails and stronger critical/kill
confirmations keep fast shots readable.

Automatic fire preserves fractional cooldown at 30, 60 and 144 fps. A short
click between frames is buffered for 160 ms, and held fire resumes when a reload
finishes. Movement and repeated-fire bloom recover faster, recoil recenters,
and shotgun pellets form a stratified fan. Right-click braces every weapon;
scoped weapons retain their magnification. Loot, skills, science checks and
portal rewards continue to use the existing systems.

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

Science Strike serves only authored MCQs from the published teacher database.
It shows the worksheet title and preserves diagrams, table labels and choices.
Written-answer tasks, mixed worksheets and malformed MCQs are not converted into
game questions. There are no generated questions or sample fallback pools.

The shared school-level, mastery, quality and spacing rules use current database
history, teacher corrections, custom topics and learning objectives. Live bank
changes withdraw deleted, changed or newly unsuitable active questions without
marking an answer. Existing teacher checks are read without calling an AI.
Question families cannot repeat within a run; shared spacing also survives new
runs, and session memory still protects students when browser storage is blocked.
An exhausted suitable pool pauses the game instead of filling it with repeats.
Suitable current-grade work now comes first. Earlier-year game ratings cannot
push basic P3 questions ahead of P6 work, and stepping further back requires
several relevant weak results. Successful easy answers never pull the target
below its starting point for that school level.
Each question draw randomizes among comparably suitable, fresh database families
before choosing one. A fixed bank prefix no longer supplies every opening set;
grade priorities, mastery limits, quality checks and run-wide spacing still apply.

Number keys select answers, and feedback keeps the game paused until the
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
`tools/science-strike-combat-tests.mjs` covers swept collisions, aim snapshots,
range, piercing, firing cadence and reload/tap buffering. Artwork tests cover
decode failures, cached sprite installation, critical geometry and panorama
framing. The browser suite also verifies actual generated image decoding,
transparency, use by the production renderer, all twelve weapon archetypes,
distinct weapon renders, ADS, reload and asset-network failure fallback.
The existing Science feeding checks continue to cover year limits, mastery,
duplicate spacing, broken images and mixed-question restrictions.

The Non-TCG gameplay checks workflow runs both state and browser checks and
retains gameplay screenshots for review.
