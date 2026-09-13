# Non-TCG game improvements

Portal release: **v1.382.0**. Science Strike: **v1.9.0**.

This update covers Science Defenders, Raiders, Spire, Science Legends, Slayers,
Strike and the original Adventure dungeon/Ghost Arena. Realm of Embers and its
TCG-related modes retain their existing code, art, progression and release rules.

| Game | Gameplay | Graphics and feedback |
| --- | --- | --- |
| Defenders | First, Strongest and Nearest tower targeting; upcoming-wave information; combat waits during questions and help. | Placement previews, clearer ranges, a detailed laboratory base and directional battlefield path. |
| Raiders | Enemy shots commit to their warning direction; visible aim-mode and dash controls; reliable pause and touch input. | A richer laboratory arena, clearer projectile trails, enemy aim lines and combat status. |
| Science Legends | Defensive evade, announced charge attacks, reliable modal/pause input and keyboard controls. | Ruined courtyard, braziers, ambient effects, boss health and objectives. |
| Slayers | Collision-aware evade and an explicit action to descend stairs. | Dungeon masonry, torchlight, charge warnings and an exploration map that respects walls. |
| Spire | Explicit card targets, damage/block forecasts, corrected energy cards and guarded turn callbacks. | Distinct illustrated battle rooms, selected-card/target feedback and clearer combat outcomes. |
| Adventure / Ghost Arena | Pause freezes cooldowns and pending hits; manual/automatic skill control; timed Guard for incoming attacks. | Distinct floor environments, visible attack countdowns and a readable tactical hotbar. |
| Strike | Shift quickstep, equal diagonal/straight movement speed and enemy shots that follow a fixed warning lane. | Multiple cached tree/rock silhouettes, contact shadows, distance fading and amber warning marks in the world and radar. |

Learning questions continue to use the shared school-level, mastery, quality,
spacing and diagram safeguards. Identity checks retire a previous learner's run
before it can resume or save under another learner. Existing reward rates and
credit gates are preserved; free Ghost Arena battles still award no currency.

All new environments and effects use existing or code-drawn assets. They require
no additional AI calls or paid rendering service. Comfort settings reduce motion;
essential attack warnings remain visible.

The non-TCG workflow runs focused production-mechanics tests, the existing
standalone question checks and real-page browser checks with synthetic accounts.
The browser fixtures intercept network/account boundaries; they do not write to
live student accounts. Screenshots are retained by CI for inspection.
