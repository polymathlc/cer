# CER Science Learning Portal

## Topic summary sheets (v1.428.0)

Open Summary Sheets under Papers & Worksheets to collect questions by topic,
or start with questions selected in the bank or worksheet builder. Add topic
questions or choose questions manually. Prepare AI summaries suggests a short
question, a suggested answer and guidance on how to answer for each card;
use or discard each suggestion after reviewing it. Every original question
image stays on its card. You can also edit the card text by hand, add more
questions and arrange the cards before saving.

Save a sheet and reopen it from its saved list. These edits belong to the
summary sheet; the original questions stay unchanged. Present shows a clean
view for the class, and Print / Save PDF prints two columns of cards on A4.
Only authors can create and manage sheets; the class view is presented from
the teacher's session.

Validation: `node tools/summary-sheet-core-tests.mjs`,
`node tools/summary-sheet-integration-tests.mjs` and
`node tools/summary-sheet-browser.mjs`. AI and storage are mocked in these tests.

## Approved question regeneration (v1.427.2)

Open a question in the editor, or use its Regenerate new copy button while
editing a worksheet. Enter an optional command or leave it blank for the AI to
propose a fresh variation of the same concept and difficulty. Duplicate & prepare
plan first saves a new question in the bank from the question's current editor
contents, then runs the traffic-light checker on that copy. It proposes exact
wording, answer, explanation and diagram changes for review. Existing diagrams
serve as image references; crop findings use the preserved source pixels.

Approve regeneration plan applies and saves only the reviewed actions to the
new bank question, then runs the traffic-light checker again. No additional Save
is needed. The source question, its unsaved edits and its worksheet memberships
stay unchanged. Failed or cancelled plans leave the saved copy available;
changes made to the copy while a plan is running stop that plan from replacing
them. Remaining findings need a separate approved repair plan. Undo restores
the copy's previous contents when it has not changed since regeneration.

Validation: `node tools/question-regeneration-tests.mjs` and
`node tools/question-regeneration-browser.mjs`, alongside the question-repair
workflow. Browser tests mock AI and storage; live provider responses are not
exercised by these tests.

## ⚡ Light jobs on GPT-6 Luna (v1.427.0)

Six small jobs now ask ChatGPT for **`gpt-6-luna`**, the cheapest GPT-6 tier ($0.10 / $0.50 per million tokens), instead of the full model: 🏷 tag suggestions, 🎯 topic re-filing, 🎯 objective suggestions, ✨ Improve, ✂️ Shorten and ✍️ AI complete. Each is classification or a short rewrite whose result the app already checks or the author reviews before saving. They lead with ChatGPT whatever the main engine is, and Gemini and Kimi stay behind it.

Marking, reading pages into questions, the checkers, the answer-key cross-check and every explanation stay on the main model. The AI Engine dialog lists the light jobs and their order separately. Students' devices reach Luna through the shared `askOpenAi` function, which allows `gpt-6-luna` for every signed-in user once the matching Maths functions deploy has run; until then the server answers those jobs on GPT-6.1 Sol as before.

## OpenAI Decisions migration

Import review calls `https://api.openai.com/v1/decisions` with `gpt-6-luna` and the shared server-side `OPENAI_API_KEY`. The administrator callable is `cerDecisionsReview`, with Decisions review fields and `cerDecisionsLimits` counters. No separate review-provider account or key is needed. Review remains advisory: visual AI checking always runs.

Saved imports and question history are upgraded when read: the shared migration helper converts former review fields to Decisions fields while preserving the recorded review. Old field names appear only in this data conversion; they do not select another provider. Existing Decisions values take precedence.

## Faster traffic-light checks

The browser checks up to six questions at once across the traffic lights, Check Questions and import reads. It loads up to four pictures together and shares simultaneous reads of the same question revision. Completed checks are not cached by image URL, and every attached picture still requires its own explicit visual audit. Existing valid saved verdicts are reused by Check all.

Screenshot imports start the visual read alongside the advisory Decisions review and join both sets of findings before repair. The PDF worker overlaps Decisions with four concurrent Storage reads, preserving attachment order and reusing unchanged originals within its repair recheck. Model choices, visual resolution, full report validation and repair limits are unchanged. The speedup depends on image and provider latency; it does not skip checks.

Deploy `functions:cer-rapid-import` to activate the backend change. Merging static pages alone does not switch a previously deployed function. Automated tests mock provider calls; live API access and latency are not established by those tests.

## Faster Rapid Add

PDF files upload two indexed chunks at once, and the worker reads four chunks together before reconstructing the exact original bytes. Browser imports prepare three independent crops together and enhance/upload two figures at once, with shared limits across simultaneous pages. Questions on the same page reuse one untouched source upload. Missing explanations are written alongside figure preparation; the full visual check waits for both.

The worker prepares three questions on a page together, sharing a three-crop limit and four Storage writes. Each enhancement task starts up to two figures from the same question together, verifies both against their originals and checkpoints both outcomes before advancing. Page boundaries, ordered continuation assembly, repair limits, fidelity checks and full visual audits remain in place. Models, thinking budgets and image resolution are unchanged.
