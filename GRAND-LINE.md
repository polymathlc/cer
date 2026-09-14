# Grand Line Chronicles

A One Piece collectible card and ship-defense game alongside Pirate Rift. Open **Crew Defense** in the Math or Science portal to use the signed-in learner's real question bank and existing reward-point wallet. A direct visit to `grand-line.html` provides a clearly labeled local preview without platform purchases or reward points.

## Cards and crews

- Fifty illustrated characters, each with a matching battle avatar, three active abilities, and a passive.
- Five starter cards: Luffy, Zoro, Nami, Usopp, and Chopper. Choose five different owned characters for the free starting formation. Any other owned card can be summoned during defense preparation.
- Every purchased pack contains exactly **one** character card. New cards unlock their avatars immediately; duplicates automatically merge into the existing character.
- Star ratings are fixed rarities from one to seven. Merge rank rises at 2, 4, 8, 16… total copies, capped at rank 10. Each rank adds 12% to base life, attack, and defense.
- Expansion 01's seven-star cards are **Kaido the Beast, Whitebeard, and Admiral Akainu**, with animated gold galaxy frames and foil. Reduced motion disables the decorative animation.

## Existing platform reward points

Pack offers are read from the host platform's `TCG_PACKS`; prices and odds are not a separate economy. The one-card pack uses each tier's existing guaranteed-card rarity distribution (`bonusOdds`, when present).

| Pack | Current point cost | 1★ | 2★ | 3★ | 4★ | 5★ | 6★ | 7★ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Bronze | 120 | 40% | 30% | 17% | 8% | 3.5% | 1.2% | 0.3% |
| Silver | 320 | — | — | 62% | 25% | 9% | 3% | 1% |
| Gold | 750 | — | — | — | 68% | 22% | 8% | 2% |

The host rolls rarity first, then chooses uniformly among characters of that rarity. The in-game shop shows the live rates. Questions award points through the platform's existing game-question rules, including its speed and repeat controls. Questions do not directly grant packs.

Purchases debit points and save the card and receipt together through the existing RPG account storage. An interrupted confirmation retains the same purchase receipt for safe retry. The host controls price, draw, ownership and balance; the game frame sends no card grants or point amounts. Collections and receipts are scoped by subject, account, learner, role and school level. The reward-point wallet retains the platform's existing account scope.

## Administrator tools

Sign in with an **administrator account**, open Crew Defense, choose a school level, and visit **Card shop**. The administrator panel provides **Unlimited gold** and **Unlock all 50 cards**.

Unlimited gold lets that administrator open any of the three pack tiers without spending reward points. Turning it off restores the normal listed prices. The setting is saved for the administrator's account on that portal; its actual point balance is unchanged. Unlock all adds any missing current cards to the administrator's selected collection without removing duplicate copies or changing the chosen crew. It excludes the eight reserved future-expansion characters. Repeating either action does not stack grants.

These controls are unavailable to students and standalone previews. The portal checks the signed-in role and current profile before each action and before accepting its result. Administrator actions wait for question rounds, purchases and saves to finish; a profile or role change retires the open game session.

## Crew Defense and learning

Crew Defense is a real-time tower-defense game. Each of nine harbors contains **six waves** of enemies that follow a route toward the ship. A wave contains dense groups of raiders, with swarms, fast runners, armored enemies, ranged pressure, and captains demanding different counters. The scout report shows the next wave and a tactical suggestion before it begins.

### Summoning and placement

Your chosen five crew members deploy free at the start. All other **owned cards** are available in **Summon from collection**; the starting crew is not a restriction on reinforcements. Choose a character, select an empty numbered position, and confirm the summon. Each character can appear once, across ten positions. Locked and future-expansion cards cannot be summoned.

Each defense starts with 100 battle supplies. A summon costs 20 + 5 × the card's stars; defeating enemies and finishing waves adds supplies. These supplies belong only to the current defense and never debit, award, or replace Math or Science reward points. Recalls refund half the supplies actually paid, rounded down. The five free starting defenders refund zero. A recalled character keeps its training and specialization for this defense, but returning costs the normal summon price. Repositioning and swapping deployed defenders are free during preparation.

### Attack shapes and target priority

Every character has a defense profile, and each of their three skills has a real attack shape. The map previews the selected defender's coverage. Attacks resolve with travel or wind-up time; their damage uses the actual line, cone, impact area, chain, or surrounding radius.

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

Select defenders or numbered positions with the map, buttons, touch, or keyboard. Keys 1–9 and 0 select up to ten defenders; Space starts or pauses the wave. Pause and 1×, 2×, or 4× speed are available. Hidden tabs, dialogs, question rounds, and pending saves pause simulation. Returning never simulates offline waves or awards offline points. Admin pack controls remain available in Card shop.

## Current roster and future expansions

Eight legends are reserved for future **seven-star** expansions. They are absent from current card packs, active teams, and encounters; they are not available to unlock yet. Kaido, Whitebeard, and Admiral Akainu remain the only current seven-star cards.

| Reserved future seven-star character | Current replacement |
|---|---|
| Shanks | Wyper · 4★ |
| Marshall D. Teach | Kaku · 4★ |
| Charlotte Linlin | Wapol · 2★ |
| Admiral Kizaru | Hina · 3★ |
| Sengoku | Paulie · 3★ |
| Monkey D. Garp | Don Krieg · 3★ |
| Dracule Mihawk | Hatchan · 2★ |
| Boa Hancock | Kalifa · 3★ |

Existing copies transfer **one-for-one** to the corresponding replacement, including team slots. When a save contains both names, their copies combine and merge normally. Copy counts, reward points, purchase receipts and stage progress are preserved; combat strength follows the replacement’s current rarity. Repeated loading or replaying a purchase receipt cannot duplicate copies or charge points again. Future seven-star editions will have their own expansion releases; owning an earlier retired card does not automatically grant an unreleased card.

## Artwork and lore

All 50 character images were generated with the built-in image generator. Each original source contains painted card art beside a transparent full-body battle avatar. The manifest records the actual panel split; CSS draws standard rarity frames, and the battle renderer uses the corresponding avatar. Artwork prompts and provenance are in [assets/grand-line/ART.md](assets/grand-line/ART.md). Character ability references and the distinction between lore and game balance are in [LORE-SOURCES.md](LORE-SOURCES.md).

## Validation

Run the core, economy, bank and learning tests with Node 24:

```sh
node --test tools/grand-line-core.test.mjs tools/grand-line-economy-tests.mjs tools/grand-line-admin-tests.mjs tools/grand-line-learning-tests.mjs tools/grand-line-bank-tests.mjs
node --test tools/grand-line-defense-tests.mjs tools/grand-line-roster-tests.mjs tools/grand-line-migration-tests.mjs
```

The Science repository uses its science-feeding integration suite instead of a separate Math bank test. Both repositories run the browser suites below. Set `PLAYWRIGHT_MODULE` to an installed Playwright module path; optionally set `PLAYWRIGHT_BROWSER_CHANNEL` and `GRAND_LINE_SCREENSHOTS`.

```sh
node tools/grand-line-browser-tests.mjs
node tools/grand-line-portal-tests.mjs
```

Browser tests use an isolated in-memory wallet. They do not sign into an account, spend real reward points, or write to Firebase. The production page exposes no test API unless explicitly loaded with `?test=1`.
