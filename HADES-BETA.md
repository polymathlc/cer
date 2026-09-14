# Hades Sanctuary beta

Hades Sanctuary appears in the administrator sidebar and Arcade. It remains hidden and inaccessible to student and employee accounts. Choose a preview school level before starting; the preview uses the real Science question bank and the same level, mastery, quality and repetition safeguards as student practice.

After each cleared room, entering an exit opens a sanctuary with exactly five fresh MCQs. The portal keeps the original diagrams, labels, tables and options, grades each response and records preview history separately for each administrator and school level. No AI calls or generated question set are used. Fewer than five suitable questions, unavailable diagrams, abandoned questions or an account change pause the transition without granting a reward.

| Correct answers | Heal (% maximum life) | Next boon tier |
| --- | --- | --- |
| 0 | 0% | Common |
| 1 | 8% | Common |
| 2 | 16% | Rare |
| 3 | 24% | Rare |
| 4 | 32% | Epic |
| 5 | 40% | Heroic |

The iframe receives the completed score only. Answer keys remain in the portal. Requests are bound to the embedded frame, origin, account, preview level, run session and sequential round number. Retrying a completed request reuses its recorded result; it never records the answers twice. Permanent game upgrades are separated by subject and preview profile.

`hades-game.html` is the generated game copied from `polymathlc/hades`. The shared `hades-learning-parent.js` bridge is kept identical in the Math and Science portals.

Validation: `node --test tools/hades-learning-tests.mjs` checks protocol, scoring, idempotency, access and Science bank integration. `tools/hades-learning-browser.mjs` checks the rendered sanctuary, mobile layout, diagrams, tables, fractions, failed-image behavior, retries and account changes. The `Hades sanctuary beta checks` workflow runs both.

Release bundle: **Hades 2.1.0**, Science **v1.386.0**. The generated game and shared bridge are verified against `hades-game.manifest.json` in CI. Common/Rare/Epic/Heroic grant level 1/2/3/4 to a scalable boon or add 1/2/3/4 Pom levels; unique utility effects keep their fixed strength.
