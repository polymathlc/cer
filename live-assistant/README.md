# Ainstein and The Polymath live voice bridge

This isolated Firebase codebase powers the administrator-only voice button in
the Science Learning Portal. It reuses the proven WebRTC Live bridge from Ans Key
and Study Buddy. Scan currently provides recorded dictation/transcription rather
than a bidirectional live conversation.

## Deploy

Use Node 22 and an authorized Firebase account for `mathgen--app`:

```sh
npm install --prefix /tmp/cer-firebase-tools firebase-tools
node tools/cer-live-server-rules.mjs --firebase-tools /tmp/cer-firebase-tools/node_modules/firebase-tools
node tools/cer-live-server-rules.mjs --firebase-tools /tmp/cer-firebase-tools/node_modules/firebase-tools --apply
npm ci --prefix live-assistant/functions
npm test --prefix live-assistant/functions
firebase deploy --project mathgen--app --config live-assistant/firebase.json --only functions:cer-ainstein-live
```

The rules tool reads and tests the current shared rules before publishing. It
only adds the two CER names to the existing Live server-only collection list,
fails if that exact existing protection is absent, and refuses publication if
the active rules changed during validation. Omit `--apply` to validate only.
Use `--read` after deployment to verify that no change is still needed.

Deploy both `cerAinsteinLive` and `cerAinsteinLiveCleanup`. Merging GitHub Pages
does not deploy these functions. The `cer-ainstein-live` codebase is separate
from CER Rapid Add, Ans Key, Study Buddy and Maths. The two CER lease and quota
collections must be excluded from the legacy shared Firestore catch-all before
enabling voice; apply the narrowly scoped rules migration included here. It
preserves all other collection permissions and changes no Storage rules.
The existing project secret `OPENAI_API_KEY` is bound only to
these server functions and never sent to the browser.

## Access and cost controls

- Every start and stop verifies a non-revoked Firebase ID token and App Check
  for CER's registered web app. Anonymous accounts are refused. Authorization
  matches CER Rapid Add: a signed `admin: true` custom claim, or a verified email
  in CER's existing administrator allowlist. A browser role, user profile,
  employee account or unverified allowlisted email grants no access.
- No saved worksheet is required; the administrator can start from the home
  screen. The endpoint accepts only start/stop and validated audio connection
  data, never client-selected models or system instructions.
- Each administrator gets one active session, up to 10 minutes, and six starts
  per Singapore calendar day. Global ceilings are two concurrent sessions and
  twelve starts per day. Failed starts count toward the allowance. This budget
  applies to the voice connection; bounded app specialists use the existing AI
  routes and their own per-request limits.
- `cerAinsteinLiveSessions` and `cerAinsteinLiveLimits` are server-only bookkeeping
  collections, with explicit exclusions from shared client rules. They hold ownership, session IDs,
  lease times and counts. No audio, transcript, question-bank content or SDP is
  saved in them. The provider session requests `store: false`.
- The cleanup function runs every minute to close expired or abandoned calls,
  with normal scheduler/retry delay. A failed provider close retains its lease
  for retry. Browser closure alone is not the cost-control boundary.
- All application work is delegated to the client assistant. Voice stays quiet
  while it works, and only the returned result can support a claim that an action
  completed. Question text and screen content cannot grant app permissions.

## Protocol and verification

Send JSON POSTs to
`https://us-central1-mathgen--app.cloudfunctions.net/cerAinsteinLive` with
`Authorization: Bearer <Firebase ID token>` and `X-Firebase-AppCheck`:

- Start: `{ "action": "start", "sdp": "<WebRTC offer>" }` returns `sessionId`,
  answer `sdp`, `expiresAt` and `maxDurationSeconds`.
- Stop: `{ "action": "stop", "sessionId": "<opaque ID>" }` returns
  `{ "stopped": true }`. Another administrator's session is never closed.

The browser uses `oai-events` and the Live events `session.delegation.created`,
`session.thinking.append`, `session.commentary.append`, and `session.close`.
This is the Live JSON protocol, not the older Realtime SDP API.

The tests exercise authentication, quotas, concurrent reservation, failed-start
recovery, stop ownership, server cleanup, and provider protocol without paid
calls. After deployment, validate a short administrator conversation, cancellation
during connection, microphone shutdown, and a refused student/employee request.
Automated mocks do not establish that a live microphone conversation passed.


## 🎙 The Polymath's voice (`polymathLive`, v1.448.0)

The same codebase serves the student-facing voice on the answer-key QR page
(`polymath.html`). It is deployed on every merge to `main` that touches
`live-assistant/**` by `.github/workflows/deploy-live-assistant.yml`, using the
existing `FIREBASE_SERVICE_ACCOUNT` secret; the shared rules tool runs there
read-only and never publishes.

- Endpoint: `https://us-central1-mathgen--app.cloudfunctions.net/polymathLive`,
  the same start/stop protocol as Ainstein. Allowed origins:
  `https://polymathlc.github.io`, `https://www.polymathlc.com.sg`,
  `https://polymathlc.com.sg` (and localhost for tests).
- Accounts: an **anonymous** Firebase account (a phone that only scanned the
  code) or a **Google** account (a Study Buddy student). Every request still
  needs a non-revoked ID token and App Check for the family web app.
- Limits (`POLYMATH_LIMITS`): one call per account, up to 15 minutes; 12 starts a
  Singapore day signed in, 4 anonymous; centre-wide 10 at once and 300 a day.
  A lock older than the call length plus a minute is released, so a crashed
  phone is never locked out for the day.
- Bookkeeping reuses `cerAinsteinLiveSessions` / `cerAinsteinLiveLimits` with a
  `polymath-` key prefix and its own `_polymath` centre-wide document, so no new
  rules are needed and `cerAinsteinLiveCleanup` sweeps both kinds of lease.
- Instructions are fixed on the server ("You are The Polymath…"): delegate every
  academic request to the page, stay silent while waiting, never reveal the key,
  never name the company or model. Nothing is stored; the provider session asks
  for `store: false`.
