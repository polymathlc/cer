# Games Insights — v1.458.0

The **Games Insights** sidebar tab is visible only to administrators. The page's
navigation, loader, renderer and CSV export independently check administrator
access. Signing out, switching accounts or entering a practice preview clears
the current view; an old asynchronous response cannot populate a new account.
Opening another game does not fetch organization-wide analytics.

The catalog contains all seventeen game modes. Popularity ranks observed player
accounts, then question-answer volume. Historical `questionAttempts` records do
not identify family profiles separately, so children sharing an account count
together. Returning accounts were observed on at least two Singapore dates in
the selected window. Accuracy uses graded answers and teacher mark overrides;
its sample size is shown. Answering-player trends compare question activity
with the preceding equal-length period. Games ask questions at different rates,
so answer volume is not a measure of total playing time.

The page supports seven, thirty and ninety-day windows, per-game daily question
charts and CSV export. Recommendations distinguish reach from volume and avoid
flagging a difficulty problem from fewer than twenty graded answers. Unknown
activity is labeled as unmeasured instead of ranking a game as unpopular.

Historical reads use the existing timestamp index and are bounded to the newest
20,000 attempts plus at most 5,000 account profiles and leaderboard documents.
The view and export retain source-cap warnings; truncated answer samples hide
trends. Retired and administrator accounts are excluded where the loaded profile
and retirement records identify them. No additional Firestore index or rules
deployment is required by these existing query/write paths.

## Recorded launches

`game-usage.js` records actual student run starts across all seventeen modes,
including games without question loops. Menu opens, administrator previews,
duplicate callbacks, foreign frames and stale learner identities do not count.
Direct game modes use their actual run object; iframe protocols use the current
owned frame and run nonce. The Hades frame is retired on profile changes so an
old WindowProxy cannot report a run for the replacement learner.

Each actual start performs a deferred merge into the student's existing
`scienceGameLeaderboard/{uid}` document:

```text
gameUsageVersion: 1
gameUsageRecordedSince: server timestamp
gameUsageDaily[YYYY-MM-DD][gameId].starts: increment(1)
```

Days use Singapore time and retain 190 days, covering the ninety-day comparison
window. The writer rechecks the owner after prerequisite reads and merges only
usage fields; it never replaces score, wallet, reward or FPS data. Recording is
best effort and cannot block or charge gameplay. There are no frame, heartbeat
or question-time writes for this feature.

Starts begin with this release. Historical starts, total playtime and completed
runs were not recorded and are not inferred. The dashboard joins recorded-start
accounts with question accounts without double counting them. Pure action games
can therefore enter the popularity rankings as new launches are observed.

CI in `.github/workflows/game-insights.yml` verifies role/account isolation,
coverage limits, nested merge preservation, all actual launch paths and the
desktop/mobile dashboard. Existing game-family browser suites also exercise
their real start buttons with isolated telemetry adapters; tests do not write
synthetic starts into production accounts.
