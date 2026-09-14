# Grand Line Chronicles

A One Piece collectible card adventure alongside Pirate Rift. Open **Grand Line Chronicles** in the Math or Science portal to use the signed-in learner's real question bank and existing reward-point wallet. A direct visit to `grand-line.html` provides a clearly labeled local preview without platform purchases or reward points.

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

## Turn-based battles and learning

Nine encounters form three acts. Command the active hero, choose one of three skills, select a valid target, and confirm. Basic attacks restore Spirit; stronger abilities spend it and have cooldowns. Defend restores Spirit and protects the hero. Healing, revival, control, shields, damage over time, and lore-based passives support different crew combinations.

After **every full round, including the final round**, the portal presents exactly three suitable questions. Math uses authenticated marking for student answers. Science uses its existing feeding and attempt-recording flow. Wrong answers receive feedback and count toward completing the three-question pause. Combat resumes only after all three results and battle progress have been confirmed.

Each correct answer strengthens the **next full round**:

| Correct answers | Attack damage | Critical chance | Defense |
|---:|---:|---:|---:|
| 0 | No bonus | No bonus | No bonus |
| 1 | +10% | +5 percentage points | +8% |
| 2 | +20% | +10 percentage points | +16% |
| 3 | +30% | +15 percentage points | +24% |

Bonuses do not stack between rounds. Critical chance, including character passives, is capped at 75%. Each correct answer also restores 1.8% of living crew members' maximum life and 3 Spirit. The battle screen displays the current bonus and its round. The final quiz records the result and opens the next encounter after victory.

Keyboard: **1 / 2 / 3** select a skill; **D** defends. Buttons support keyboard navigation and touch. Sound and reduced motion are available in Settings.

## Artwork and lore

All 50 character images were generated with the built-in image generator. Each original source contains painted card art beside a transparent full-body battle avatar. The manifest records the actual panel split; CSS draws standard rarity frames, and the battle renderer uses the corresponding avatar. Artwork prompts and provenance are in [assets/grand-line/ART.md](assets/grand-line/ART.md). Character ability references and the distinction between lore and game balance are in [LORE-SOURCES.md](LORE-SOURCES.md).

## Validation

Run the core, economy, bank and learning tests with Node 24:

```sh
node --test tools/grand-line-core.test.mjs tools/grand-line-economy-tests.mjs tools/grand-line-learning-tests.mjs tools/grand-line-bank-tests.mjs
```

The Science repository uses its science-feeding integration suite instead of a separate Math bank test. Both repositories run the browser suites below. Set `PLAYWRIGHT_MODULE` to an installed Playwright module path; optionally set `PLAYWRIGHT_BROWSER_CHANNEL` and `GRAND_LINE_SCREENSHOTS`.

```sh
node tools/grand-line-browser-tests.mjs
node tools/grand-line-portal-tests.mjs
```

Browser tests use an isolated in-memory wallet. They do not sign into an account, spend real reward points, or write to Firebase. The production page exposes no test API unless explicitly loaded with `?test=1`.
