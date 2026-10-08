# Durable Rapid Add PDF imports

This is a separate Firebase Functions **codebase**, for `polymathlc/cer` only.
It uses the existing `mathgen--app` Firebase project, Auth, Storage, Gemini
and OpenAI secrets and `users/{admin uid}/vetting/{question id}` format. It does not deploy
or replace the Maths functions, Firestore rules, or Storage rules.

## Deployment (required once before closing tabs is supported)

Website-only merges do **not** deploy Firebase functions. Merges that change
`rapid-import/` trigger the automatic worker deployment described below. The website checks
`rapidImportStatus` and enables online mode only when it answers successfully.
Until then, the multi-file picker and browser importer work, with an explicit
keep-the-tab-open notice. Do not advertise background processing as live until
the deployment and the live acceptance check below pass.

### Automatic redeployment from GitHub

The **Deploy Rapid Add worker** workflow runs on reviewed `main` changes under
`rapid-import/`, and can also be run on demand. It uses the existing
`FIREBASE_SERVICE_ACCOUNT` repository secret to deploy only `cer-rapid-import`.
It tests the worker first and verifies both the status and Decisions review
callables' sign-in requirements afterwards. Shared Firestore/Storage rules and
Maths functions are not deployed.
The isolated deployment uses `--force` to remove retired functions from this
codebase when callable names change. These probes do not call an AI provider;
Decisions availability still needs an authenticated live review.
If the existing `MOONSHOT_API_KEY` secret is visible, it grants only that secret's
accessor role to the two discovered worker execution identities. Missing backup
credentials or permission do not prevent the OpenAI/Gemini deployment. The
workflow reports whether optional backup access could be established.

### Guided Google Cloud Shell setup

[Open Rapid Add setup in Google Cloud Shell](https://shell.cloud.google.com/?cloudshell_git_repo=https://github.com/polymathlc/cer.git&cloudshell_git_branch=main&cloudshell_tutorial=rapid-import/cloud-shell-tutorial.md&show=terminal)

Sign in with the Google account that manages `mathgen--app`, authorise the
shell if asked, and run from the cloned repository:

```sh
bash rapid-import/deploy-cloud-shell.sh
```

For this non-Google repository, Cloud Shell may open without credentials. In
that case the script asks you to run `gcloud auth login --update-adc` there.
Never paste credentials or API keys into chat. If Firebase separately reports
missing login, the script gives its standard browser sign-in command.

The helper checks project access, existing billing and enabled secret versions
(metadata only). It uses Node 22 and Firebase CLI 15.29.0, runs worker tests,
deploys only `cer-rapid-import`, and discovers the deployed dispatcher identity.
When the current Node version is not 22, it installs Node 22 into a temporary
directory and selects it for this run. It does not restart itself or change
the global Node installation, and removes the temporary runtime on exit.
If an older setup repeatedly prints `Checking Google access`, press Ctrl+C,
run `git pull --ff-only origin main` from the cloned repository, and rerun setup.
It grants enqueue permission on the Rapid Add queue, service-account-user on
that identity itself, and Cloud Run invoker on the Rapid Add worker service.
It does not grant project-wide IAM roles, change billing, replace live rules,
or create service-account keys. Existing Firestore/Storage permissions and AI
provider access still need to pass the live acceptance check below.

Success requires all nine functions to be ACTIVE, the queue to be RUNNING,
and unauthenticated status and Decisions review probes to return Firebase's
UNAUTHENTICATED error.
These deployment checks do not submit PDFs or establish end-to-end processing.
Keep the setup terminal open until it finishes; then run the live check below.

### Manual deployment

From an authorised Firebase/Google Cloud terminal with Node 22:

```sh
git clone https://github.com/polymathlc/cer.git
cd cer
npm ci --prefix rapid-import/functions
npx firebase-tools deploy --project mathgen--app --config rapid-import/firebase.json --only functions:cer-rapid-import --force
```

Use the existing `GEMINI_API_KEY` and `OPENAI_API_KEY` Secret Manager secrets
(OpenAI also supplies typed review decisions). No separate review key is required.
If either secret has not been set, provision the missing named secret with
`firebase functions:secrets:set GEMINI_API_KEY --project mathgen--app` or
`firebase functions:secrets:set OPENAI_API_KEY --project mathgen--app`; never put
a provider key in frontend code. The default
OpenAI worker model is `gpt-6.1-sol` (`RAPID_IMPORT_OPENAI_MODEL`) for reading,
vision and reasoning, with `gemini-2.5-flash` (`RAPID_IMPORT_MODEL`) and then
`kimi-k3` (`RAPID_IMPORT_KIMI_MODEL`) as backups. Explicit queued authoring
choices are honoured, and missing backups are appended for existing jobs too.
Empty, truncated, malformed JSON and incomplete question lists trigger the
next provider. Figure generation keeps its dedicated image model; figure
classification and fidelity checks use the same reading/vision order.
Each reading provider has a 60-second deadline, leaving time for failover,
figure generation and verification within the existing task deadline.

Kimi optionally reuses the existing project `MOONSHOT_API_KEY` secret. It is
read lazily with the worker's server identity only if failover reaches Kimi;
it is never returned to the browser. The worker's execution identity needs
`roles/secretmanager.secretAccessor` on that secret. A missing secret or missing
access skips Kimi safely, without blocking deployment or normal OpenAI/Gemini
processing. A server-only `MOONSHOT_API_KEY` environment value is also supported.
The automatic deployment applies model and routing changes to durable jobs when
`rapid-import/` changes are merged. Website-only merges do not update the worker.

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
- Each PDF uploads two 3 MiB chunks concurrently (40 MiB/file maximum). Files are queued
  immediately and receive individual progress. Keep the tab open until each
  file is acknowledged as stored online. Selecting an interrupted file again
  resumes its import ID in the same browser; chunks are create-only/idempotent.
  Progress counts acknowledged bytes, and finalisation waits for every started
  chunk. The worker reads four chunks at a time in their original index order.
- Once finalised, the durable Firestore change enqueues work independently of
  the browser. One task reads a page, and separate tasks check/publish each
  complete question, keeping large papers within per-task runtime limits.
- The worker sees the current page, previous page and held question. It handles
  repeated numbers marked continued, later diagrams, split stems, and lettered
  parts. It holds the final question privately until its boundary is known.
  Unmatched/contradictory continuations are flagged rather than silently joined.
- Every question retains links to all its source pages under its vetting card.
  Each figure is cropped from the correct page using the browser crop's pixel
  protections: expand clipped edges to whitespace, remove separated prose,
  and trim blank margins while preserving diagram labels and table borders.
  Invalid, blank or whole-page selections retain the source page in the same
  image block and mark the question as needing cropping; later figures keep
  their own positions. The original PDF appearance is kept for restoration;
  the displayed redraw must pass the fidelity checks described below.
  These protections apply to pages processed after the worker is deployed;
  previously saved questions and existing checkpoints are not rewritten.
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
python3 tools/rapid-deploy-tests.py
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


## OpenAI Decisions review

`cerDecisionsReview` (callable, administrators only) and the worker's own gate ask
OpenAI Decisions (`gpt-6-luna`) — also used by Ans Key for voice commands — yes/no
questions about measured facts: is each figure crop complete and clean, is the
wording readable, do parts/options/answers hang together. The pure logic is
`decisions-review-core.js`, **byte-identical** to `../decisions-review-core.mjs`
(`tools/decisions-review-tests.mjs` fails if they differ).

* **A no — or a defect the code finds itself (clipped, blank, whole-page,
  refused crop) — sends the item to the AI.** A crop is re-cut by the AI, told
  what was wrong, up to twice, and Decisions is asked again; a question goes to the
  existing check-and-repair loop with Decisions' reasons attached. A crop that still
  fails is kept and flagged as a Crop finding on the vetting card.
* **Decisions is advisory**: a confident clean yes still gets the visual AI read,
  and its agreement is recorded for comparison with the checked result.
  The worker prepares images alongside this review, with up to four Storage
  downloads at once. It keeps every source/display label and audit target in
  order, and reads a repeated path only once within the question's check and
  repair recheck. A repaired picture at a new path is downloaded again.
* **Decisions unavailable changes nothing**: every question is AI-checked as before.
* Only measurements and short excerpts are sent; nothing is stored beyond
  per-admin counters (`cerDecisionsLimits`). The shared `OPENAI_API_KEY` is a
  Firebase secret.

Saved review history and queued jobs are upgraded with the shared
`migrateDecisionsReviewState` helper. It converts `jevFigures`, `jevShadow`,
`autoCheck.jev`, the old `autoCheck.state` value `jev`, and old review finding
markers to Decisions fields and markers. An old skipped-read state becomes a
green historical result with its review flag preserved; new visual checks still
run. Queued job preferences are also converted. Existing Decisions values win,
and question blocks and source data are untouched. These old strings are used
only to read saved data, never to call another provider. Browser records persist
the converted metadata on their next ordinary save; loading alone does not
rewrite records. New per-admin Decisions counters start with bounded allowances;
historical counters are left untouched.

The browser copies the former `sq_jev_gate` preference to `sq_decisions_gate`
once, preserving an existing new preference. It removes the old preference only
after the copy succeeds and keeps honoring the saved choice if storage fails.

Deploying `cer-rapid-import` deploys `cerDecisionsReview` with it and removes
retired callables in this isolated codebase. It needs no separate review setup.
An authenticated review must succeed before provider availability is verified.

## Automatic figure preparation and checked repairs

New `rapidImportBegin` jobs always enable automatic checks and figure enhancement.
`autoCheck:false` from an older client cannot disable the new-job check. Existing
already-queued jobs retain their saved settings. Upload acknowledgement remains
`rapidImportFinish` returning `queued:true`; the upload must finish before closing
the page. Processing after that acknowledgement does not need a browser.

The extraction saves the original PDF page and the untouched figure crop. Image
blocks retain `originalCropUrl` permanently, plus `preColourUrl` for CER's existing
restore control. `cropSource.url` is the original page, while `cropSource.imageUrl`
tracks the currently displayed image. `figureKind` is `diagram`, `table`,
`flowchart` or `graph`. Diagrams use colour by default; tables, flowcharts and
graphs always use monochrome, straight rules and legible typeset labels.

A durable `enhance` task starts up to two figures from the same question together,
verifies each generated output against its original crop, writes an immutable
checkpoint after both settle, and atomically advances the outbox. Both start
immediately and keep their existing provider/fidelity budgets inside the
540-second task. Its starting `figureIndex` participates in delivery fencing and task
identity. Repeated deliveries cannot replace a later checkpoint or duplicate a
published question. An unavailable service, changed label or failed crop keeps
the original and records an enhancement finding rather than dropping the question.
`RAPID_IMPORT_IMAGE_MODEL` defaults to `gemini-3.1-flash-image`, using the
existing `GEMINI_API_KEY` secret; no new API key is required.

Page preparation overlaps three independent questions while sharing a maximum
of three crop/refine/recut chains and four Storage writes. Every figure's retries
remain sequential and bounded; results retain their source question and image
order. Source-page preservation runs alongside crop preparation. Started work
settles before failure handling, checkpointing or PDF/canvas destruction.

Browser imports likewise share limits of three crop chains and two enhancement/
upload chains across simultaneous pages. They retain the same first eligible
enhancement budget, every original and whole-page fallback. Questions from one
page share its untouched upload, and missing explanations are written alongside
figure preparation. The final visual check waits for both stages. Provider models,
thinking/token budgets, image resolution and quality checks are unchanged.

The checker reads both the original pages and the actual displayed figures.
Every displayed figure must have an explicit complete visual audit in the reply;
missing, duplicate or unread-target audits fail the check rather than granting a
clean stamp. Annotation and answer-key images participate in that same audit.
It suggests corrections for findings, automatically applies bounded answer,
explanation and correct-option changes, then checks once more. Source wording,
question IDs, figures, marks and unrelated fields are not model-editable. The
best verified result wins; a worse or unavailable recheck restores the earlier
answer. `autoCheck.repairs` records only corrections retained in the saved result.
Failures remain `error`, unresolved defects remain amber/red, and every question
still reaches Vetting. AI checks reduce review work but do not establish an
error-free question bank or approve questions into the bank.

## Shared Add / CER figure controls

Both websites read the same `users/{authenticated admin uid}/vetting` documents.
`rapidImportStatus.capabilities` advertises `imageEditing`, `automaticChecks` and
`automaticEnhancement` only after this backend is deployed. Gate the corresponding
UI on those flags, not merely on the presence of an older import endpoint.

The admin-only `rapidVettingImage` callable in `us-central1` accepts either:

```js
// Regenerate from the preserved crop, or restore that exact original.
{questionId, blockId, mode: 'colour' /* 'bw' | 'original' */, expectedUrl}
// Resize using CER's existing block.scale ratio (not a percentage).
{questionId, blockId, scale: 0.7, expectedUrl, expectedScale: null}
```

Use a 540-second callable timeout for generation. Success returns
`{question, changed:true}` after the shared question is saved. The server derives
the owner from Auth, accepts only the owner's imported Storage images, and never
fetches arbitrary URLs. It rejects stale image URLs/scales and compares the full
question again in the saving transaction, so a concurrent teacher edit is never
overwritten. `aborted` means refresh the question before retrying. Generation
failure leaves the saved question unchanged. Tables/flowcharts/graphs stay black
and white even when a client requests colour. Regenerated/restored images receive
a fresh automatic check; resizing keeps the scientific content and existing
verdict intact.

Additional backend regressions cover image provenance and owner isolation,
monochrome enforcement, inaccurate generation rejection, concurrent teacher
edits, enhancement replay fencing, continuation figure findings, and retaining
the best answer after automatic repair. These use real canvas pixels with mocked
Firebase and model services; perform the live acceptance test after deployment.
