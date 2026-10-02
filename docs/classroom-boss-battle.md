# Independent classroom heroes

The anskey classroom battle now owns its pixel heroes, Warrior/Ranger/Mage/Cleric
roles, skill trees, inventory and encounter rewards. These characters do not
read or write CER's Science Quest hero, equipment, stats or currency.

CER's **Your Hero** page continues to manage Science Quest's avatar, equipment
and skill class. The former classroom role selector and classroom sync messages
have been removed. A previously saved `battleRole` preference is discarded when
the CER save is hydrated; all other existing CER progression is preserved.

Normal CER saves still publish the existing leaderboard summary using
`merge: true`, preserving Science Strike and other games' leaderboard fields.
Each publication deletes the retired `battleHero` field from that student's
`scienceGameLeaderboard/{uid}` document. No avatar snapshot is built or exported.
Old snapshots disappear when their owners next publish; anskey does not depend
on that cleanup and ignores them immediately. Debounced writes retain their
original account check.

Run `node --test tools/rpg-battle-hero-tests.mjs` to verify separation, legacy
role migration, preserved CER progression/leaderboard fields and account-switch
isolation. The existing SVG art tests and browser checks continue to cover CER's
own avatars. The obsolete classroom role browser fixture has been removed from
the non-TCG gameplay CI.
