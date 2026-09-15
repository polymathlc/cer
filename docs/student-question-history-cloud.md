# Permanent student question history

Math and Science share the Firebase project but keep separate subject ledgers.
Every automatic practice/game delivery claims both its question ID and its
visible-content identifier in a server transaction before presentation. A
question assigned in another tab or on another device is excluded, including
when the student abandons a game before answering. Exact imported copies are
also excluded. History never expires or resets when a new game starts.

`student-question-history.js` stores immutable markers at:
`users/{uid}/questionHistory/{subject}-{profileHash}/entries/{markerHash}`.
There is no single growing profile document, rolling window or history cap.
Math uses the authenticated account; Science uses the selected child's stable
history identity. Hashes contain no answer keys or question text. Saved local
exposures and existing cloud attempts are unioned into the ledger before new
questions are delivered. Past exposures that were never saved cannot be
reconstructed. Explicitly chosen revision can reopen a question and still
records its exposure; automatic feeds never fall back to seen questions.

An unavailable server or incomplete migration blocks new automatic delivery and
shows a retry message. A cloud listener refreshes other tabs/devices, while the
transaction is the authority even if a listener has not caught up. Interrupted
migrations are safely repeated. Selecting another child/account invalidates
pending work and clears the local view.

## Shared rules deployment

Rules are deployed from the Math repository for this shared Firebase project.
Its tracked `firestore.rules` is an incomplete template; do not deploy that
template. Math's `Permanent student question history` workflow retrieves the
current live rules, adds only the owner-scoped immutable history collection,
verifies the previous rules are otherwise byte-for-byte unchanged, and runs
server-side permission tests. The existing starter blanket permission is
narrowed only to exclude the new question-history namespace; existing app paths
retain their previous permissions. Feature-branch runs validate only; main runs
compile and publish the additive update, checking the active release again to
avoid replacing a concurrent rules change. Math, Science and Scan permissions
are preserved. The existing Firebase service-account Actions credential is
used in memory and is never logged or copied to an artifact.

Validation:

- `node tools/student-question-history-tests.mjs`
- `node --test tools/science-feeding-integration-tests.mjs tools/science-feed-core-tests.mjs`
- Science Strike and student-feeding browser tests; these use isolated accounts.
- Permission tests and the rules deployment workflow run in the Math repository.
