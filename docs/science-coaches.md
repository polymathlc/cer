# Science Sidekicks — v1.379.0

Nine original animated SVG animal coaches appear beside marked student answers:

| Coach | Animal | Skill |
| --- | --- | --- |
| Comparison Casey | Chameleon | Compare both things using the same feature |
| Context Connie | Meerkat | Use a relevant question detail or diagram label and explain its scientific significance |
| Specific Sherry | Fox | Name the exact object, change or observation |
| Evidence Ellen | Elephant | Support a claim with a relevant observation or result |
| Keyword Kai | Parrot | Use the required science terminology accurately |
| Concept Cora | Owl | Revisit a specific scientific misconception |
| Reasoning Ravi | Red panda | Explain the causal link between evidence and claim |
| Careful Cleo | Tortoise | Check a flagged unit, label, number or instruction |
| Complete Cody | Beaver | Finish a part or choose a small revision |

Each mascot has an animal silhouette, paws or wings and a role-specific science
prop. Species labels appear below the active portrait and in the team roster.

Context Connie supports answers that omit or fail to apply the actual question
scenario, diagram features or labels. Her feedback names the relevant clue and
the missing link to the science idea. For example, when a question shows a
dull-green fruit among green leaves, its colour blends into the background,
making it harder to see; its scent helps animals find it. This is a conditional
example, not a fact to insert into unrelated questions or an instruction to
assume green leaves when the source does not provide them. A correct general
science answer is not penalised merely for omitting an unnecessary diagram
reference. Comparison, evidence, reasoning and detail checks retain their own
roles; Connie targets applying the particular question's clues.

The coaches use the existing mark and feedback. The three existing AI marking
prompts may supply up to three optional `coachIssues` entries per answer. Old
responses still work through conservative feedback matching. Scoring rules,
rewards, answer keys and result storage are preserved; there is no additional AI call.
Missing or failed marking responses never produce a diagnosis. Full-credit
answers do not receive corrective coaching. A wrong answer with no specific
feedback receives a neutral next-step suggestion, not an invented misconception.

The grading request includes the student-facing question text, parts, table
data, image captions and source diagrams. Typed answers use the image-capable
route when question pictures are available; handwritten answers keep their
response photo alongside the source pictures. Attachment roles distinguish the
student response, source question and any marking reference. Hidden answer or
explanation blocks are not treated as source clues. Image loading is bounded
and unavailable pictures are explicitly described as unseen, so feedback must
not invent their visual details.

Integration covers individual and whole-question open/CER answers, MCQs,
fill-in-the-blanks and annotated diagrams across the shared student question
surfaces. Author previews and revealing an answer without marking do not trigger
coaches. Request, question, account and render checks reject stale feedback.
Starting another check or resetting the question removes its old coaching.

Cards pop in without moving focus, contain keyboard-accessible tip buttons,
can be dismissed and reopened, and offer a lazy-loaded nine-character roster.
Motion stops after a few cycles and can be paused. Reduced-motion preferences
are respected. The only stored preference is the device's motion toggle in
localStorage. Coaches are hidden when printing.

The art is in `science-coach-art.js`, feedback selection in
`science-coach-core.js`, DOM behavior in `science-coaches.js`, and scoped styles
in `index.html`. All illustration geometry is bundled; no image service, icon
font or animation library is loaded for this feature.

Run `node --test tools/science-coach-core-tests.mjs tools/science-coach-integration-tests.mjs`.
Browser checks use Playwright 1.62.1: install it and its Chromium browser, then
run `node tools/science-coach-browser-tests.mjs`. Set `COACH_SCREENSHOTS` to an
output directory to save desktop, mobile and roster previews. The dedicated
workflow also runs the existing marking regression suites.
