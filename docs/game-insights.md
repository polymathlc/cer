# Games Insights

Administrators open **Games → Games Insights**. Students and employees cannot
navigate to the page, invoke its data loader, or export its statistics. The view
and pending requests are cleared when the account or administrator preview changes.

Popularity ranks distinct player accounts with observed activity, then question
answers. Historical `questionAttempts` records contain account UIDs, not separate
family-child identities, so siblings sharing an old account count together. The
view joins these records with new actual-run start summaries without counting an
account twice. A returning account appears on two or more Singapore dates.

Windows are 7, 30 and 90 Singapore calendar days, including today. The answering
player trend compares the question-log population with the preceding window; it
does not invent a historical trend for launch-only games. Accuracy honors valid
teacher mark overrides. Answer clocks are explicitly labelled as answer time,
never total playtime. No completion, session-length or frame-rate data is inferred.

The loader reads at most 20,000 recent answers across the current and prior
window, 5,000 profiles, 5,000 leaderboard documents and the administrator's retired
account map. Sampling warnings appear in the view and CSV; capped answer samples
hide trend percentages. Unknown game activity is marked unmeasured, not unpopular.

## Actual launch collection

`game-usage.js` counts one start per real run, with no heartbeats or recurring
writes. It merges nested increments into the student's existing
`scienceGameLeaderboard/{uid}.gameUsageDaily[YYYY-MM-DD][gameId].starts` fields.
The writer never replaces score, FPS, wallet, card or reward data. It retains
190 days of daily counters, covering the 90-day view and its comparison window.
Historical launches before this release are unavailable.

Only student runs count. Administrator previews and acting-as-student previews
are excluded. Every deferred write rechecks the captured account and active
learner after prerequisite reads. Object-owned runs use weak deduplication; iframe
protocols use scoped, bounded nonce deduplication. Failures do not block, charge or
interrupt gameplay.

The seventeen canonical IDs are `defenders`, `raiders`, `spire`, `legends`,
`slayers`, `fps`, `hades`, `grand-line`, `tcg-train`, `tcg-duel`, `tcg-siege`,
`tcg-legends`, `pirate-rift`, `adventure`, `ghost-arena`, `tcg-arena` and
`tcg-dungeon`. Hooks run after actual run initialization, not opening a page,
character picker, campaign or training menu. Parent messages require the current
same-origin frame and learner context. Hades retries reuse its real start nonce;
profile replacement retires the old frame identity.

CI is `.github/workflows/game-insights.yml`. Unit coverage checks aggregation,
access, all canonical IDs, duplicate starts, profile cancellation, nested merges,
retention and the real portal adapter. Browser tests exercise the dashboard,
eight iframe starts/contexts, six TCG starts, Adventure/Ghost Arena and Strike.
Fixtures intercept persistence; tests do not write to production accounts.
