# Public class enquiries

This isolated `polymath-enquiry` Firebase codebase accepts public parent enquiries
from `https://polymathlc.github.io`. It does not require portal sign-in.

Endpoint: `https://us-central1-mathgen--app.cloudfunctions.net/submitPolymathEnquiry`

POST JSON fields: `submissionId` (UUID), `parentName`, `email`, `phone`,
`childLevel` (`P3`, `P4`, `P5`, `P6`, `S1`), `subjects` (`science`, `math`), and
optional `message`. Science covers every listed level; Mathematics covers P4–P6.
Only HTTP success with `{ "accepted": true }` means the request was queued.
Keep the UUID when retrying the same submission after a network error.

The existing Firebase `firestore-send-email` extension sends the server-composed
plain-text email to the centre's two fixed, server-configured recipient addresses.
The parent's supplied email is used as the reply-to address. Neither recipients,
sender, subject, HTML, attachments nor provider settings can be supplied by clients.
Acceptance confirms a durable queue write, not arrival in an inbox.

## Controls and data retention

- JSON only, 8 KB request ceiling, strict field/type/length/level validation,
  fixed production origin, and no permissive localhost production exception.
- A Firestore transaction admits at most 5 enquiries/IP/hour, 3/email/day and
  100 total/day. Quota keys contain hashes, never raw IPs or email addresses.
  Origins are a browser control; the quotas also apply to non-browser callers.
- UUID idempotency and payload fingerprints prevent duplicate email during
  retries; reusing an ID with changed content is rejected.
- `polymathEnquiryRequests` stores only a fingerprint and timestamps.
  `polymathEnquiryLimits` stores counters and expiry timestamps. Only
  `mail/polymath-enquiry-<uuid>` contains the contact information and message.
- Daily cleanup deletes enquiry emails and request records after seven days
  (normally within eight days), and expired quota records. Mail already sent to
  the centre's inboxes follows the centre's own email retention practices.
- The server rules migration protects both bookkeeping collections, enquiry
  mail documents and descendants. It also refuses client-wide `mail` listing
  that could expose enquiry content; existing non-enquiry mail documents keep
  their direct-document permissions. Admin SDK mail delivery is unaffected.
- Request data and provider error text are never application-logged. No email
  is sent to the parent, and no confirmation address can be used as a relay.

## Tests and deployment

Use the existing authorized Firebase CLI account for `mathgen--app`, Node 22,
and never print CLI credential/configuration values.
Set `POLYMATH_ENQUIRY_RECIPIENTS` to the two authorized comma-separated recipient
addresses in the ignored `functions/.env.mathgen--app` deployment file. Do not
commit recipient addresses or copy them into browser code. Missing or invalid
server recipient configuration prevents the function from starting.

```sh
npm ci --prefix enquiry-function/functions
npm test --prefix enquiry-function/functions
node --test tools/enquiry-rules-tests.mjs
node tools/enquiry-rules.mjs --firebase-tools /path/to/firebase-tools
node tools/enquiry-rules.mjs --firebase-tools /path/to/firebase-tools --apply
firebase deploy --project mathgen--app --config enquiry-function/firebase.json --only functions:polymath-enquiry --non-interactive
node tools/enquiry-rules.mjs --firebase-tools /path/to/firebase-tools --read
```

Both `submitPolymathEnquiry` and `cleanupPolymathEnquiries` must be deployed.
The rules migration reads and tests the current production rules, refuses
unrecognized rules, checks for concurrent edits and changes only its own
protected paths. Never deploy an app-local replacement for shared rules.
GitHub Pages deployment does not deploy this backend.

Production smoke checks can exercise OPTIONS and invalid requests without
queuing mail. A real delivery test contacts both recipients and should be
explicitly labelled and authorized; inspect only its delivery metadata.
