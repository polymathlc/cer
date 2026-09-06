# Durable Rapid Add PDF imports — v1.360.0

This is a separate Firebase Functions **codebase**, for `polymathlc/cer` only.
It uses the existing `mathgen--app` Firebase project, Auth, Storage, Gemini
and OpenAI secrets and `users/{admin uid}/vetting/{question id}` format. It does not deploy
or replace the Maths functions, Firestore rules, or Storage rules.

## Deployment (required once before closing tabs is supported)

Merging the website does **not** deploy Firebase functions. The website checks
`rapidImportStatus` and enables online mode only when it answers successfully.
Until then, the multi-file picker and browser importer work, with an explicit
keep-the-tab-open notice. Do not advertise background processing as live until
the deployment and the live acceptance check below pass.

From an authorised Firebase/Google Cloud terminal with Node 22:

```sh
git clone https://github.com/polymathlc/cer.git
cd cer
npm ci --prefix rapid-import/functions
npx firebase-tools deploy --project mathgen--app --config rapid-import/firebase.json --only functions:cer-rapid-import
```

Use the existing `GEMINI_API_KEY` and `OPENAI_API_KEY` Secret Manager secrets. If either secret has not
been set, provision it with `firebase functions:secrets:set GEMINI_API_KEY
--project mathgen--app`; never put a provider key in frontend code. The default
OpenAI worker model is `gpt-6-astra` (`RAPID_IMPORT_OPENAI_MODEL`), with
`gemini-2.5-flash` (`RAPID_IMPORT_MODEL`) as backup. The queued authoring order
is honoured for OpenAI/Gemini; Kimi is not included in this isolated worker.

The project needs billing enabled and the Cloud Tasks API. On first deployment,
Firebase provisions the task queue. The executing service identity needs
Storage object access, Firestore access, secret access and Cloud Tasks enqueue
permission, plus permission to invoke the task function and act as its task
service identity. Follow the Firebase task-queue IAM instructions for the
actual service identity used by this project (do not assume an old App Engine
identity on newer projects): https://firebase.google.com/docs/functions/task-functions

`cerRapidImports` and `cer-rapid/` originals/checkpoints/chunks are private,
server-owned data. Client access is through authenticated callables only;
existing rules must not grant clients writes to these paths. Public bearer
URLs are created only for the question's page/figure images, matching the
portal's existing image delivery. Do not deploy the Maths repo's incomplete
rules over the project's live rules.

## Behaviour

- An admin can choose/drop/paste multiple PDFs. The picker is visible on desktop
  and mobile. Images continue through the existing screenshot engine.
- Each PDF uploads in 3 MiB chunks (40 MiB/file maximum). All uploads are queued
  immediately and receive individual progress. Keep the tab open until each
  file is acknowledged as stored online. Selecting an interrupted file again
  resumes its import ID in the same browser; chunks are create-only/idempotent.
- Once finalised, the durable Firestore change enqueues work independently of
  the browser. One task reads a page, and separate tasks check/publish each
  complete question, keeping large papers within per-task runtime limits.
- The worker sees the current page, previous page and held question. It handles
  repeated numbers marked continued, later diagrams, split stems, and lettered
  parts. It holds the final question privately until its boundary is known.
  Unmatched/contradictory continuations are flagged rather than silently joined.
- Every question retains links to all its source pages under its vetting card.
  Each figure is cropped from the correct page, falling back to the page if its
  rectangle is invalid. Figures preserve the PDF's original appearance; they
  do not use the screenshot engine's optional generative B&W enhancement.
- The authoring engine order, reading prompt, teaching-note grounding, level/topics, release date and
  auto-check preference are captured when queued. Checks operate on the whole
  assembled question with its source pages; up to three answer repairs are
  attempted. The best checked version survives, and errors never appear green.
- Question publication and job progress commit atomically. Stable question IDs,
  phase/cursor guards, and a retry generation prevent duplicate publication and
  late workers from resurrecting approved/deleted questions.
- Failed tasks retry five times. The job retains its error and checkpoint;
  “Retry remaining pages” continues from that checkpoint. Jobs with no progress
  for an hour also expose retry, including workers terminated at the timeout.
- PDFs over 60 pages are rejected as a whole with an explicit error, never
  truncated. Original PDFs, chunks and checkpoints are retained for recovery;
  no automatic deletion or retention policy is enabled by this change.
- Online mode is admin-only and writes to that admin's bank. Employees retain
  browser mode; no new employee privilege or cross-owner write is introduced.
- Questions still go to **Vetting**, preserving the existing approval workflow.

## Verification

```sh
node --check app.js
node tools/rapid-cloud-tests.mjs
node tools/rapid-pdf-tests.mjs
node tools/question-merge-tests.mjs
npm test --prefix rapid-import/functions
```

Tests include real PDF.js/canvas rendering, three-page continuation with all
figures, a second independent question, truncated AI output, atomic publication,
replayed delivery, retry-generation fencing, incomplete uploads, and permission
boundaries. Firebase/AI are mocked in integration tests: this does not establish
that deployment IAM, provider availability or production rules are correct.

Live acceptance after deployment: sign in as admin, select two small PDFs
(one containing a question across pages), wait for both upload acknowledgements,
close the entire browser, and confirm server progress/completion in logs.
Reopen the portal and verify the questions, part order and source-page links.
Then retry a deliberately failed import and confirm no duplicate questions.
