# Grand Line Chronicles · 3.5.0

A One Piece collectible card and ship-defense game alongside Pirate Rift. Open **Crew Defense** in the Math or Science portal to use the signed-in learner's real question bank and existing reward-point wallet. A direct visit to `grand-line.html` provides a clearly labeled local preview without platform purchases or reward points.

## Cards and crews

- **100 illustrated characters**, each with a matching battle avatar, three active abilities, and a passive: 300 abilities in total.
- Five starter cards: Luffy, Zoro, Nami, Usopp, and Chopper. Choose up to **seven different owned characters** for the free starting formation. Any other owned card can be summoned during defense preparation while a crew slot is available.
- Open **1, 5, 10, or 50 packs** at once in Card shop. Every pack contains exactly **one** character card. New cards unlock their avatars immediately; duplicates automatically merge into the existing character. Multi-pack openings show every card together, with new/merged labels and final copy counts.
- Star ratings are fixed rarities from one to seven. Merge rank rises at 2, 4, 8, 16… total copies, capped at rank 10. Each rank adds 12% to base life, attack, and defense.
- Expansion 01's seven-star cards are **Kaido the Beast, Whitebeard, and Admiral Akainu**. Expansion 02 adds 50 cards, including **Big Mom, Garp, and Sabo** at seven stars and **Silvers Rayleigh and Kozuki Oden** at six stars. All six seven-star cards have animated gold galaxy frames and foil. Reduced motion disables the decorative animation.

Collection search and the allegiance, ownership and rarity filters narrow the full roster. My crew uses compact slots with **Change** and **Remove** actions; choose a slot, search owned characters by name or fighting style, or filter by allegiance. **Cancel slot change** leaves the formation intact. The navigation shows the current crew count, and the defense page offers a direct shortcut to the next unlocked harbor.

### Allegiances, captains and nearby auras

Matching crew members gain a shared allegiance bonus to **life, attack, defense and speed**. Only members of that allegiance receive its bonus; no captain is required.

| Members sharing an allegiance | Bonus to each matching member's stats |
|---:|---:|
| 1 | None |
| 2 | +6% |
| 3–4 | +10% |
| 5–7 | +16% |

Characters can have several current or historical allegiances. Kaido belongs to the Beast Pirates and Rocks Pirates; Big Mom belongs to the Big Mom Pirates and Rocks Pirates; Whitebeard belongs to the Whitebeard Pirates and Rocks Pirates. Bonuses from qualifying groups add for each character, up to **+30% all stats**. For example, two Beast Pirates and two Rocks Pirates give Kaido +12%; a Beast Pirate without the Rocks tag receives only the Beast bonus. My crew shows active groups and the next required member count. Defense recalculates these bonuses when a character is summoned or recalled.

**Captain** badges identify the character's lore role; players do not appoint a single captain, and several captains may be deployed together. Some captains and commanders also give nearby living allies an attack or attack-speed aura:

| Leader | Aura | Effect |
|---|---|---|
| Luffy | Captain's Courage | +8% attack |
| Buggy | Showman's Rally | +6% attack speed |
| Kaido | Emperor's Might | +10% attack |
| Whitebeard | A Father's Rally | +10% attack speed |
| Big Mom | Queen's Command | +12% attack |
| Garp | Hero's Training | +10% attack |
| Sabo | Flame of Freedom | +10% attack speed |
| Belo Betty | Revolutionary Encouragement | +8% attack |

Each aura reaches **240 battlefield units, or six grid cells measured as a radius**, including the leader. It can affect allies of any allegiance. Only the strongest active aura of each stat applies, capped at **12% attack and 12% attack speed**; an attack aura and a speed aura can coexist. Moving out of range or a leader being knocked out removes that aura immediately. Maze towers and enemies receive no leader aura. Aura effects are separate from allegiance bonuses and do not become permanent upgrades. The selected defender shows its actual received bonuses and whether a leader aura is out of range. Garp, Sabo and Belo Betty retain their Marine or Revolutionary leadership roles rather than receiving pirate-captain labels.

## Existing platform reward points

Pack offers are read from the host platform's `TCG_PACKS`; prices and odds are not a separate economy. The one-card pack uses each tier's existing guaranteed-card rarity distribution (`bonusOdds`, when present).

| Pack | Current point cost | 1★ | 2★ | 3★ | 4★ | 5★ | 6★ | 7★ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Bronze | 120 | 40% | 30% | 17% | 8% | 3.5% | 1.2% | 0.3% |
| Silver | 320 | — | — | 62% | 25% | 9% | 3% | 1% |
| Gold | 750 | — | — | — | 68% | 22% | 8% | 2% |

The host rolls rarity first, then chooses uniformly among characters of that rarity. The in-game shop shows the live rates. Questions award points through the platform's existing game-question rules, including its speed and repeat controls. Questions do not directly grant packs.

The shop shows the total price before opening: the platform's price per pack multiplied by the selected quantity, with the same independent rarity odds for every card. Purchases debit points and save all cards and one receipt together through the existing RPG account storage. Insufficient funds reject the entire batch. An interrupted confirmation retains the same purchase receipt and quantity for safe retry, even after reopening the game. Receipts bind the pack tier and quantity; replaying them does not roll or charge again. Old single-pack receipts remain supported. The host accepts only integer quantities from 1 to 50 and controls price, draw, ownership and balance; the game frame sends no card grants or point amounts. Collections and receipts are scoped by subject, account, learner, role and school level. The reward-point wallet retains the platform's existing account scope.

Multi-pack controls activate only when the portal confirms that both its purchase bridge and wallet support batch purchases. A portal tab opened before this update keeps single-pack purchases available and asks for a portal refresh; a pending batch stays locked until that refresh so an older bridge cannot silently reduce it to one pack.

## Administrator tools

Sign in with an **administrator account**, open Crew Defense and visit **Card shop**. The portal automatically supplies the saved school level; administrators without one use its P6 preview. The administrator panel provides **Unlimited gold** and **Unlock all 100 cards**.

Unlimited gold lets that administrator open any of the three pack tiers without spending reward points. Turning it off restores the normal listed prices. The setting is saved for the administrator's account on that portal; its actual point balance is unchanged. Unlock all adds any missing current cards to the administrator's selected collection without removing duplicate copies or changing the chosen crew. It includes the new Big Mom, Garp and Sabo editions and excludes the nine still-reserved future characters. Repeating either action does not stack grants.

These controls are unavailable to students and standalone previews. The portal checks the signed-in role and current profile before each action and before accepting its result. Administrator actions wait for question rounds, purchases and saves to finish; a profile or role change retires the open game session.

## Crew Defense and learning

Crew Defense is a real-time tower-defense game. Each of nine harbors contains **six waves** of enemies that follow routes toward the ship. Every map is a 16:9 landscape grid of 26 × 13 square cells. Three entrances sit on the left edge: **Top, Middle and Bottom**. Waves use one, two or all three entrances; the scout report and map highlight the active entrances before the wave starts. Enemies split across those entrances and follow their own shortest open orthogonal routes to the right exit. Their movement speed stays consistent even when the routes have different lengths. The six waves still contain **80, 105, 130, 160, 190, and 230 enemies**, with smaller swarms, fast runners, armored enemies, ranged pressure, and captains demanding different counters.

### Build a maze

Select the **Maze tower** tile in the placement grid, then click battlefield cells to build repeatedly. Alternatively, drag the tile onto a valid cell. Each basic disruptor tower costs **5 battle supplies**; selling it returns **3**. Up to 80 can be placed. These small structures block a cell, deal modest damage, and briefly slow enemies. Their main purpose is to form corridors and chokepoints around your crew's line, radial and splash attacks. Nine distinct fixed-terrain layouts provide different starting puzzles.

Towers and crew both block movement. The map previews the proposed routes before a placement; building, moving or summoning is rejected without spending supplies if it would cut off **any of the three entrances**, including one inactive this wave. Entrances, the exit, fixed terrain and occupied cells cannot receive towers. Routes use orthogonal steps, so enemies cannot cut diagonally through blocked corners. Funnel separate approaches into a shared chokepoint to make splash attacks effective. Build, sell, summon and move between waves; attacks run automatically during waves.

Choose **one to seven different owned characters** in My crew. They deploy free at the start; existing five-member crews carry over with two open slots. Empty crew slots can be filled as more cards unlock. During preparation, any other **owned card** can be summoned if fewer than seven characters are deployed. Open **More crew**, then drag an owned character onto an empty grid cell, or select their tile and click the cell. Deployed crew can be dragged directly by their map avatars or palette tiles; selecting a crew member and clicking a destination also moves them. Locked and future-expansion cards cannot be summoned. Swapping two deployed crew members is free and preserves the same blockers.

Each defense starts with 100 battle supplies. A crew summon costs 20 + 5 × the card's stars; defeating enemies and finishing waves adds supplies. These supplies belong only to the current defense and never debit, award, or replace Math or Science reward points. Recalls refund half the supplies actually paid, rounded down. Free starting defenders refund zero. A recalled character keeps its training and specialization for this defense, but returning costs the normal summon price.

### Direct placement controls

The landscape map fills the available main column, with placement and selected-character controls beside it on desktop. Start wave, Pause, speed and zoom stay together directly above the play area. On phones, the map fills the screen width and all seven crew tiles fit in a compact two-row grid below it. **Zoom map** enlarges the cells and enables panning; **Fit map** returns to the complete landscape view.

The compact placement grid contains a 5-supply tower tile and the deployed crew. Selecting a placed tower reveals its **Sell tower · +3** action. Crew selection reveals the character's active bonuses, target priority and **Level up** action above the placement tiles; longer skill, allegiance, aura, specialization and recall details are grouped inside **Skills, alliances & upgrades**. Exact column/row selectors remain in the collapsed **Keyboard placement** panel.

Pointer previews never spend supplies. A drag commits only once, on release over a valid visible grid cell. Blocked cells, releases outside the map, Escape, lost capture, a second touch, hidden windows, and a change out of preparation cancel safely. During preparation, dragging empty map space pans a zoomed viewport without placing anything. Mouse, pen and touch use the same game rules.

### Automatic school level

Opening Crew Defense launches it with the student's saved portal level. There is no school-level selector or second Start game step. Math uses its saved learning-profile level; Science uses its existing student-level and teacher-cap resolution. A missing or invalid level blocks the game until the profile is corrected. Student level, learner or account changes invalidate the old question session and wallet authority. Administrators use their saved level or the host's P6 preview; student accounts never receive that fallback.

### Attack shapes and target priority

Every character has a defense profile, and each of their three skills has a real attack shape. Crew coverage appears when a crew member is selected during preparation; skill buttons toggle a specific attack-area preview, which clears when a wave starts. Attacks resolve with travel or wind-up time; their damage uses the actual line, cone, impact area, chain, or surrounding radius.

| Pattern | Tactical use |
|---|---|
| Piercing line | Face a long stretch of the route to cut through several enemies. Zoro sends sword crescents through aligned targets. |
| Sweeping cone | Cover a bend or a packed approach. Luffy's Gatling punches and Whitebeard's guan dao sweep cover a forward arc. |
| Surrounding area | Put the defender between nearby path segments to hit enemies around them. Whitebeard's earthquake spreads outward through the ground. |
| Splash blast | Aim at a dense group; enemies outside the impact radius are not hit. Slow enemies first to keep them together. |
| Chain | Hit a sequence of nearby enemies; gaps between enemies limit the chain. |
| Single target | Focus a dangerous runner or high-health captain. |
| Support | Keep healers, shields, and control skills close enough to protect the damage dealers. |

Target priority can change during combat: **First** picks enemies nearest the ship, **Strongest** favors high-health enemies, and **Cluster** aims at groups. AOE damage is valuable against the larger waves, while control, armor penetration, and focused attacks answer other threats. The existing character passives, poison, burn, slow, freeze, healing, and shields remain active.

### Illustrated ability animations

The twelve current six- and seven-star characters each have three dedicated animated ability rows, for **36 individual abilities**: Kaido, Whitebeard, Akainu, Luffy, Kuzan, Fujitora, Ryokugyu, Big Mom, Garp, Sabo, Rayleigh and Oden. The other 88 characters share directional-strike, area-impact and support animations tinted to their abilities. Zoro and Kuro use the shared sword-slash effects; their actual attack geometry and speed remain distinct. Law's earlier sprite sheet is archived and is excluded from active ability bindings and preloading.

Thirteen active transparent sprite sheets contain **156 generated frames**. Each cast plays cropped wind-up, travel, impact and fade frames; splash and chain effects follow their actual resolution. Whitebeard's ground tremors, forest eruptions and gravity impacts draw beneath the characters. Compact status markers and shield bars replace large overlapping auras. Visual budgets cap effects and combine damage labels during crowded waves without changing damage or target selection. Reduced motion uses fixed frames and removes shakes and moving trails.

The browser loads only the deployed characters' sheets plus the shared fallback. Image failures retain quiet attack cues. The shipped WebP files preserve the generated images' visible pixels and transparency losslessly; full generation prompts and hashes are recorded in `assets/grand-line-vfx/ART.md` and its manifest.

### Three questions, then individual upgrades

After every wave, including the final wave or a ship defeat, the portal presents **exactly three** questions from the selected learner's Math or Science bank. Wrong answers receive feedback and still count toward completing the round. Combat and preparation remain locked until all three results and the progress save are confirmed.

Completing the round grants **1 training point + 1 per correct answer**, once. Spend training points on a selected defender between waves. Levels run from 1 to 5; the next level costs the current level (1, 2, 3, then 4 points). Each additional level adds 20% base attack, 15% base health, and 10% base defense. Training is shared, so investing in one carry trades off against improving several defenders.

At level 3, choose one specialization for that character:

- **Power:** +25% damage and 35% armor penetration.
- **Reach:** +15% range, wider attacks and splash areas, longer chain reach, and faster attacks and skill recovery.

Training, supplies, placement, and specialization reset for a new defense; permanent card copies, merge ranks, platform points, and harbor unlocks are retained.

Correct answers also strengthen the next wave without stacking across waves:

| Correct answers | Training earned | Attack damage | Critical chance | Defense |
|---:|---:|---:|---:|---:|
| 0 | 1 | No bonus | No bonus | No bonus |
| 1 | 2 | +10% | +5 percentage points | +8% |
| 2 | 3 | +20% | +10 percentage points | +16% |
| 3 | 4 | +30% | +15 percentage points | +24% |

Completing all six waves and the final questions records the victory and opens the next harbor. A defeated ship ends the defense after its required questions. Questions continue to use the host's normal scoring and reward rules; the game does not mint packs or platform currency.

### Controls

Click a tower or crew tile, then click a valid map cell to place it directly, or drag the tile onto the cell. Crew avatars can also be dragged from the map. Tower selection stays armed for repeated building; select a placed tower to sell it. For precise keyboard placement, open **Keyboard placement**, or focus the map and use arrow keys followed by Enter. Escape cancels placement. Keys **1–7** select defenders; Space starts or pauses the wave. Pause and **1×, 2×, or 4×** speed are available. On phones, enlarge the map with **Zoom map** and drag empty map space to pan. Hidden tabs, dialogs, question rounds, and pending saves pause simulation. Returning never simulates offline waves or awards offline points. Admin pack controls remain available in Card shop.

## Current roster and future expansions

There are **100 obtainable cards**, including six seven-star cards: Kaido, Whitebeard, Admiral Akainu, Big Mom, Garp and Sabo. The new expansion editions use the distinct IDs `bigmom7`, `garp7` and `sabo7`; the earlier replacement cards remain obtainable.

**Nine** legends remain reserved for future seven-star expansions: Shanks, Marshall D. Teach, Admiral Kizaru, Sengoku, Dracule Mihawk, Boa Hancock, Portgas D. Ace, Trafalgar Law and King. They are absent from current packs, active teams and encounters, and cannot be unlocked yet. These are fan-game expansion reservations, not official ONE PIECE release announcements.

All **twelve historical ID conversions** remain permanent, including the three names that now have separately unlockable seven-star editions:

| Retired legacy character | Permanent replacement |
|---|---|
| Shanks | Wyper · 4★ |
| Marshall D. Teach | Kaku · 4★ |
| Charlotte Linlin | Wapol · 2★ |
| Admiral Kizaru | Hina · 3★ |
| Sengoku | Paulie · 3★ |
| Monkey D. Garp | Don Krieg · 3★ |
| Dracule Mihawk | Hatchan · 2★ |
| Boa Hancock | Kalifa · 3★ |
| Portgas D. Ace | Bellamy · 3★ |
| Sabo | Gin · 2★ |
| Trafalgar Law | Galdino · Mr. 3 · 3★ |
| King | Captain Kuro · 2★ |

Existing copies transfer **one-for-one** to the corresponding replacement, including team slots. When a save contains both names, their copies combine and merge normally. The retired bare IDs `bigmom`, `garp` and `sabo` still convert to Wapol, Don Krieg and Gin; they never grant `bigmom7`, `garp7` or `sabo7`. New editions must be unlocked through current packs or the authorized administrator unlock action. Copy counts, reward points, purchase receipts and stage progress are preserved; combat strength follows the replacement’s current rarity. Repeated loading or replaying a purchase receipt cannot duplicate copies, reroll a result or charge points again.

When an older save has eight to ten active crew members, migration keeps the **first seven valid, distinct owned characters in their existing order** after legacy conversions. Every owned card and duplicate copy remains in the collection, including characters removed from the active formation. Existing five-member crews remain valid. The smaller active-crew limit applies to new selections, saved formations and deployed defenders.

The earlier lower-rarity replacements fill distinct defense roles. Bellamy builds attack momentum with spring-driven lines and a forward ricochet cone. Gin holds bends with short-range tonfa sweeps, an armor-piercing focused strike and a stunning spin around himself. Mr. 3 sends slowing wax along a line, shields an ally with Candle Wall and hardens a larger crowd with Giant Candle Set. Kuro attacks quickly with three claw-line techniques; Silent Step Cut has a short cooldown. Their controls and damage follow actual attack footprints, so placement still determines which enemies they reach.

## Artwork and lore

All 100 character images were generated with the built-in image generator. The expansion adds 50 distinct character compositions and backgrounds. Each original source contains painted card art beside a transparent full-body battle avatar. The manifest records the actual panel split; CSS draws standard rarity frames, and the battle renderer uses the corresponding avatar. Artwork prompts and provenance are in [assets/grand-line/ART.md](assets/grand-line/ART.md). Character ability references and the distinction between lore and game balance are in [LORE-SOURCES.md](LORE-SOURCES.md).

## Validation

Run the core, economy, bank and learning tests with Node 24:

```sh
node --test tools/grand-line-core.test.mjs tools/grand-line-economy-tests.mjs tools/grand-line-admin-tests.mjs tools/grand-line-learning-tests.mjs tools/grand-line-bank-tests.mjs
node --test tools/grand-line-defense-tests.mjs tools/grand-line-maze-tests.mjs tools/grand-line-vfx-tests.mjs tools/grand-line-roster-tests.mjs tools/grand-line-migration-tests.mjs tools/grand-line-synergy-tests.mjs tools/grand-line-asset-tests.mjs
```

The Science repository uses its science-feeding integration suite instead of a separate Math bank test. Both repositories run the browser suites below. Set `PLAYWRIGHT_MODULE` to an installed Playwright module path; optionally set `PLAYWRIGHT_BROWSER_CHANNEL` and `GRAND_LINE_SCREENSHOTS`.

```sh
node tools/grand-line-browser-tests.mjs
node tools/grand-line-portal-tests.mjs
```

Browser tests use an isolated in-memory wallet. They do not sign into an account, spend real reward points, or write to Firebase. The production page exposes no test API unless explicitly loaded with `?test=1`.
