# Grand Line Chronicles

A One Piece collectible card and ship-defense game alongside Pirate Rift. Open **Crew Defense** in the Math or Science portal to use the signed-in learner's real question bank and existing reward-point wallet. A direct visit to `grand-line.html` provides a clearly labeled local preview without platform purchases or reward points.

## Cards and crews

- Fifty illustrated characters, each with a matching battle avatar, three active abilities, and a passive.
- Five starter cards: Luffy, Zoro, Nami, Usopp, and Chopper. Choose five different owned characters for the battle crew.
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

**Crew Defense** replaces the former turn-based and idle-voyage modes. Choose a stage, arrange your five owned characters on defense pads, and protect your ship from moving enemies. Defenders use the battle avatars unlocked by their cards and attack automatically when enemies enter range. Their powers provide damage, area attacks, healing, shields, and control.

The nine stages each contain **three waves**. Your five crew members begin on separate pads. Select a defender and an empty pad to reposition that character before starting a wave. Start each wave when ready, adjust the simulation speed, and pause/resume with the defense controls. Defenders stay within the active owned crew; choosing a formation never buys or unlocks a card.

The loop is **choose five owned cards → arrange defenders → protect the ship → answer three questions → prepare the next wave**. Enemies follow the battlefield path toward the ship. Movement and attacks pause when the game is hidden, a dialog is open, questions are in progress, or a save is awaiting confirmation. Returning never simulates offline waves or awards offline points.

After **every completed wave, including the final wave or a ship defeat**, the portal presents exactly three suitable questions. Math uses authenticated marking for student answers. Science uses its existing feeding and attempt-recording flow. Wrong answers receive feedback and count toward completing the three-question pause. The next wave and final results remain locked until all three results and progress have been confirmed.

Each correct answer strengthens the **next wave**:

| Correct answers | Attack damage | Critical chance | Defense |
|---:|---:|---:|---:|
| 0 | No bonus | No bonus | No bonus |
| 1 | +10% | +5 percentage points | +8% |
| 2 | +20% | +10 percentage points | +16% |
| 3 | +30% | +15 percentage points | +24% |

Bonuses apply to the next wave and do not stack. The defense screen shows the current boost. Completing all three waves and the final questions records the victory and opens the next stage. A defeated ship ends the defense after the required questions; it does not unlock a stage or grant a pack.

Placement, start-wave, pause, and speed controls support keyboard navigation and touch. There are no turn-order, manual skill-selection, or idle-strategy controls. Sound and reduced motion remain in Settings.

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
