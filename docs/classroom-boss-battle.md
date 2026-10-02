# Classroom boss battle hero sync

Students open **Your Hero → Classroom boss battle role** and choose Warrior,
Ranger, Mage or Healer. This choice is free and independent of the existing
Science Quest skill class: it never refunds skills, removes gear or creates
another character. Existing rogue heroes start as Rangers, mages as Mages and
other heroes as Warriors until a classroom role is chosen.

The existing Firebase account UID remains the identity in both applications.
`users/{uid}/settings/scienceRpg.battleRole` stores the choice. All ordinary RPG
saves also refresh the existing `scienceGameLeaderboard/{uid}` document with
`merge: true`, retaining leaderboard and other game data. Role choices publish
immediately; ordinary changes share the existing 1.2-second debounce. A queued
publication checks its original UID again before writing. Existing students
publish the new snapshot the next time they sign in to CER.

The `battleHero` version-1 snapshot contains:

- `uid`, `role`, `gender`, `level` and `updatedAt`.
- `equipment`: the six existing equipped item IDs, including the pet.
- `stats`: finite numeric output from the existing `rpgPlayerStats()` function,
  including attack, defence, maximum HP, critical chance/multiplier, spell power,
  dodge, cooldown, poison, thorns and leech. Existing level, gear upgrades, sets,
  skill passives, pet bonds and rebirths therefore remain represented.
- `avatarDataUrl`: the existing SVG paper doll, including equipped gear and pet
  evolution, encoded as a self-contained image URL. External images, references,
  scripts and active markup are rejected. Consumers must use `<img src>` and
  never insert snapshot data as raw HTML.

No private inventory, question history or credentials are added to this public
snapshot. anskey subscribes to these existing leaderboard documents by student
UID and owns classroom balancing, encounter health, action transactions and
teacher/class-scoped persistence. Missing or unavailable snapshots must appear
as a labelled fallback in anskey. The CER page reports successful publication or
an error that asks the student to reconnect and refresh; a failed cloud hero load
retains the existing protection against replacing saved progress.

Run `node --test tools/rpg-battle-hero-tests.mjs tools/rpg-hero-svg-tests.mjs
tools/rpg-svg-catalog-tests.mjs tools/rpg-avatar-art-tests.mjs` for snapshot,
role persistence, account-switch isolation, every collectible and existing art
regression coverage. The non-TCG gameplay CI also includes these checks.
