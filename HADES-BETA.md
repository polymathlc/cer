# Hades Sanctuary beta

Hades Sanctuary appears in the administrator sidebar and Arcade. It remains hidden and inaccessible to student and employee accounts. Choose a preview school level before starting; the preview uses the real Science question bank and the same level, mastery, quality and repetition safeguards as student practice.

After each cleared room, entering an exit opens a sanctuary with exactly five fresh MCQs. The portal keeps the original diagrams, labels, tables and options, grades each response and records preview history separately for each administrator and school level. No AI calls or generated question set are used. Fewer than five suitable questions, unavailable diagrams, abandoned questions or an account change pause the transition without granting a reward.

| Correct answers | Heal (% maximum life) | Reward tier | Scalable boon / Pom upgrade |
| --- | --- | --- | --- |
| 0 | 0% | Fractured | No boon or Pom; +1 maximum life only |
| 1 | 8% | Common | Level 1 / +1 level |
| 2 | 16% | Uncommon | Level 2 / +2 levels |
| 3 | 24% | Rare | Level 3 / +3 levels |
| 4 | 32% | Epic | Level 5 / +5 levels |
| 5 | 40% | Heroic | Level 8 / +8 levels |

The score changes the actual upgrade strength. Unique boons keep their authored mechanics and add 5 maximum life per reward rank (5/10/15/25/40 at 1–5 correct). With no scalable Pom target, the consolation is 1/5/10/20/35/60 maximum life at 0–5 correct. Maximum-life rewards do not heal; healing remains the percentage earned by correct answers.

Heart gates grant 1/10/18/25/40/60 maximum life and ash gates grant 1/5/10/15/25/40 ashes at 0–5 correct. Shop boon and Pom upgrades use the same tier, while shop hearts grant 1/12/24/35/50/80 maximum life. Ordinary purchased healing and unrelated combat rewards keep their own rules.

The iframe receives the completed score only. Answer keys remain in the portal. Requests are bound to the embedded frame, origin, account, preview level, run session and sequential round number. Retrying a completed request reuses its recorded result; it never records the answers twice. Permanent game upgrades are separated by subject and preview profile.

`hades-game.html` is the generated game copied from `polymathlc/hades`. The shared `hades-learning-parent.js` bridge is kept identical in the Math and Science portals.

Validation: `node --test tools/hades-learning-tests.mjs` checks protocol, scoring, idempotency, access and Science bank integration. `tools/hades-learning-browser.mjs` checks the rendered sanctuary, mobile layout, diagrams, tables, fractions, failed-image behavior, retries and account changes. The `Hades sanctuary beta checks` workflow runs both.

Release bundle: **Hades 2.1.2**, Science **v1.386.2**. The generated game and shared bridge are verified against `hades-game.manifest.json` in CI. Tests exercise all six scores, rendered reward summaries and duplicate-request protection.

The cast now forms a detailed SVG summoning circle on the floor, beneath scenery and combat actors. Its fixed boundary matches the spell’s reach, with counter-rotating interior rune bands that stop in reduced-motion mode.
