# Realm of Embers combat refresh — v1.383.0

All 201 existing cards retain their IDs, ownership, rarity, training, merges and
ordinary skills. Their additional signatures are run-local combat effects.
No new currency, reward source, AI request or save migration is introduced.

## Character rules

`science-tcg-identity.js` defines 19 separate six- and seven-star signatures.
The eight original epics, six human epics and five legends each have a different
targeting/effect rule. Other cards gain a weaker resonance linked to their existing
skill: for example a charge-and-discharge brawler, a cleansing healer, a chain
attacker or a protector. Their element still governs the existing affinity and art.

| Character | Additional signature |
| --- | --- |
| Ignarok | Team acceleration and strongest-target strike |
| Dagrath | Delay up to three targets and wash over the nearest |
| Voltrannus | Three jumps with diminishing damage |
| Mammorak | Personal barrier and two-target delay |
| Celestine | Cleanse and heal the most injured ally |
| Nyxthara | Stronger strike against a wounded enemy and self-heal |
| Chromagog | Alternate protective charge and heavy discharge |
| Sera | Three equal star strikes and a personal barrier |
| Auros | Damage enemies while healing allies |
| Draxx | Brand enemies for bonus damage on their next hit |
| Aeonyx | Cleanse self and accelerate the most injured ally |
| Valdren | Strong barrier and small heal for the most injured ally |
| Nyx | Twin meteors targeting the largest health pools |
| Thorne | Nonlethal health cost for a stronger team advance |
| Morrigane | Weak-target strike and a larger ward against wounded prey |
| Belial | Nonlethal health cost, brands and a focused strike |
| Cyrene | Two strikes leaving next-hit embers |
| Kaelen | Size-scaled strike against the largest enemy, with a damage cap |
| Ariselle | Crowd delay and protection |

Arena signatures follow a charged skill. Duel signatures resolve once on summon,
through the real minion damage and death handlers. Siege and Legends signatures
trigger every fourth completed attack/heal action for high stars, or every sixth
for lower cards. Siege healers and walls have explicit trigger paths. A spread of
projectiles counts as one action, so extra shots do not multiply signature speed.

Siege targets are limited to four enemies in reach and neighbouring lanes;
Legends targets are limited to six within 1.35 times the ordinary attack range.
The picker explains each mode's translation: Duel uses Divine Shield, freeze and
attack boosts; real-time modes use absorbing barriers and short control/recharge
effects. Status wards, damage shields and death processing remain authoritative.

## Role trees and presentation

Each role gains one reachable tier-three node without changing existing node IDs:
Pursuit Echo adds a shot after a skill; Spell Reservoir recharges skills every
fourth attack; Overflowing Grace converts excess healing into a capped barrier;
Shield Reprisal stuns an attacker whose blow a barrier fully absorbs.

Capstone destination buttons show the unlearned prerequisite path and exact
one-point unlock cost. The game still requires earned points for every purchase.
Duplicate legend/signature descriptions are collapsed into one box.

Battlefields have layered light, floor markings and an ambient effect. Existing
keyed character art is retained. Projectile trails and signature flashes use
element- and mechanic-specific silhouettes. Reduced-motion settings suppress
decorative motion and screen shakes.

`tcg-media.js` provides gesture-unlocked procedural attack, skill and level sounds,
with persistent mute and volume controls. Duel retains its authored hit ladder
and existing sounds, using the same mute/volume preference. Pause, questions,
tree opening, exit and hidden-document handling stop procedural voices. There
are no sound downloads added by this refresh.

## Verification

- `node --test tools/science-tcg-identity-tests.mjs tools/tcg-media-tests.mjs`
- `node tools/science-tcg-browser.mjs` with Playwright installed; optional
  `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_BROWSER_CHANNEL`, `TCG_SCREENSHOTS` variables.
- Existing duel sound, hero, rival and Siege squad regressions.

Browser tests load the actual production TCG tables, rules, renderers, handlers,
styles and bundled character artwork. Account, question-bank, persistence and
asset-index boundaries use fixtures, so tests do not read or change student data.
