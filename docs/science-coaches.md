# Science Sidekicks — v1.378.1

Eight original animated SVG animal coaches appear beside marked student answers:

| Coach | Animal | Skill |
| --- | --- | --- |
| Comparison Casey | Chameleon | Compare both things using the same feature |
| Specific Sherry | Fox | Name the exact object, change or observation |
| Evidence Ellen | Elephant | Support a claim with a relevant observation or result |
| Keyword Kai | Parrot | Use the required science terminology accurately |
| Concept Cora | Owl | Revisit a specific scientific misconception |
| Reasoning Ravi | Red panda | Explain the causal link between evidence and claim |
| Careful Cleo | Tortoise | Check a flagged unit, label, number or instruction |
| Complete Cody | Beaver | Finish a part or choose a small revision |

Each mascot has an animal silhouette, paws or wings and a role-specific science
prop. Species labels appear below the active portrait and in the team roster.

The coaches use the existing mark and feedback. The three existing AI marking
prompts may supply up to three optional `coachIssues` entries per answer. Old
responses still work through conservative feedback matching. Marks, rewards,
answer keys and student records are unchanged; there is no additional AI call.
Missing or failed marking responses never produce a diagnosis. Full-credit
answers do not receive corrective coaching. A wrong answer with no specific
feedback receives a neutral next-step suggestion, not an invented misconception.

Integration covers individual and whole-question open/CER answers, MCQs,
fill-in-the-blanks and annotated diagrams across the shared student question
surfaces. Author previews and revealing an answer without marking do not trigger
coaches. Request, question, account and render checks reject stale feedback.
Starting another check or resetting the question removes its old coaching.

Cards pop in without moving focus, contain keyboard-accessible tip buttons,
can be dismissed and reopened, and offer a lazy-loaded eight-character roster.
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
