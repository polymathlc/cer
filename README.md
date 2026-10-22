# CER Science Learning Portal

## 🎮 Quest frame: worksheets as a Wheel Quest level (v1.444.0)

Tick **🎮 Quest frame** and a printed worksheet becomes a level of Wheel Quest,
the pixel RPG the class plays on the name wheel. The tick is in the worksheet
builder's Extras, in My Worksheets' printing options, and beside **Print /
Export PDF** in the Maths and Science worksheet creators.

- **Only the teacher's account sees it.** Students, employee accounts,
  "Practise as" and signed-out pages never see the tick box and can never
  print a framed sheet. Every print path also checks the account again, so a
  hidden box is not the only thing stopping them.
- **It starts unticked every time and is never remembered.** A worksheet is
  framed only when you tick the box before you print it. Reloading the page or
  changing account (including handing the device to a student) clears it.

- **A brick rampart round every sheet**, in one of ten worlds picked from the
  worksheet's topic: Heat is Ember Caldera, food chains are Mistmire Marsh,
  circuits are Gearspark Works, fractions are the Inkwell Library, and so on.
  Its corner towers hold the world's runes and its side sockets hold loot.
- **Page 1 opens the quest**: a gold banner with the logo, the title and the
  world, the boss with **one heart per question** for the student to colour
  in, and a hero card with Name, Class and Date and the four Wheel Quest heroes
  to circle.
- **Every question number is a loot gem.** In the portal its colour is the
  question's marks: 1 mark common grey, 2 uncommon green, 3 rare blue, 4 epic
  purple, 5 legendary gold.
- **The creators print one Quest page per question**, with an XP trail and a
  companion cheer in the footer and a treasure chest (score, three stars, a
  seal for the teacher) on the last page. A question too tall for its page
  prints the old way rather than being cut off.

In the portal the rampart sits in each sheet's existing margins, so the page
plan, the page numbers and the answer key are exactly what they were; the
answer key itself stays plain. Everything prints with background graphics
switched off. The art is Wheel Quest's own heroes, enemies, runes and loot
(print-sized copies in `assets/quest-frames/`), Study Buddy's companions and
this site's logo and subject icons. Run `node --test tools/quest-frames-tests.mjs`
and `node tools/quest-frames-browser-check.mjs`.

## Interactive textbook: Reproduction (v1.443.0)

Open **Syllabus & Papers → Interactive textbook → Reproduction** for a
Primary 5 learning app based on the supplied reproduction textbook. Students
explore the concepts through interactive activities, then answer quick checks
with explanations. Completed sections are saved on the current device and
shown on the textbook topic list.

The lesson is served from `interactive-textbook/reproduction/` and follows the
same standalone, offline-friendly structure as Water and Heat. Run
`node tools/interactive-textbook-browser.mjs` and
`node tools/interactive-textbook-reproduction-browser.mjs` for the textbook browser checks.

## 🚨 Red Light Fixer and the 💲 AI cost meter (v1.440.0)

**Questions → Red Light Fixer** (admin only) checks every question you own for a
🔴 traffic light, lists only the reds, and fixes them round by round:

1. **🚦 Launch checker** reads every question in scope (question bank, vetting
   list, or both; optionally one topic) and lists the reds, worst first.
2. **🔧 Fix** gives each ticked red the same repair plan the 🚦 panel offers,
   applies it, saves it and checks the question again. Anything that comes back
   🟡 or 🟢 drops off the list.
3. **🔧 Fix further — round 2, 3…** runs another round on the reds that are left,
   one press per round.

A **💲 Spent** bar stays at the top the whole time: the running cost of every AI
call this tab makes during the run, worked out from the tokens each API reported
and the price of the model that actually answered. Calls through the two server
routes, which do not report tokens yet, are estimated from the text and marked
with "≈". **⏹ Stop** ends a run between questions, and **Stop at** stops it by
itself at a budget. **⚙ Prices** shows and edits the rate for every model
(published rates as of 21 October 2026), and can show costs in S$.

Keeping it cheap without checking any worse:
- A verdict that stands is never paid for twice, and it is now **saved on the
  question**, so the next launch only pays for questions added or edited since.
- A question the free instant checks already find red (no correct option, a
  blank model answer…) is listed without an AI call.
- Only reds are fixed, and **allow new pictures** can be switched off to skip
  diagram redraws (about US$0.07 each).
- A red with no safe automatic fix in two rounds is unticked, so it stops costing.

Keeping live questions safe: before a question is changed, the question as it was
is saved to `users/{owner}/questionRepairs`. If that copy cannot be saved, the
question is left alone. **↩ Undo** (per question, per round, or from **🕘 Fix
history**) puts it back, but only while the question is still exactly as the fix
left it. A question open in the editor or its 🚦 panel is skipped.

## Editable worksheet covers (v1.438.0)

Worksheet covers use the **Big M** design: the Polymath logo top left with a
level pill and a subject pill top right, the faceted Polymath M in pastel teal
and pink across the top-right corner, a small heading above a large left-aligned
title with a magenta bar and an optional line underneath, a rounded
Name / Class / Date / Score card, and a footer with the centre name, a note and
polymathlc.com.sg. Faint pixel icons and pastel bubbles and polygons are
sprinkled in the margins and the white space between those blocks, never on the
words or the card. Long titles step down in size so the title block keeps its
room.

Use **Edit cover** in the worksheet builder, saved worksheets or print preview
to review the cover before exporting. Every word is editable in the preview or
the form, including the level pill (which starts from the sheet's questions) and
the four field labels. The icon arrangement (sprinkled, edges only or light),
icon size, icon visibility, texture intensity and the strength of the M corner
are adjustable. Saved worksheets keep their cover settings; covers saved before
this design keep their words, size and arrangement but take the new faint
backdrop. Past papers, learning-objective sheets and Study Buddy exports use the
same cover; Custom Paper keeps its editable exam metadata and separate Booklet
A/B instructions.

The math and science worksheet creators show editable covers directly in their
preview and Design view. Their cover controls also save the field labels and
artwork choices. Math covers contain mathematical symbols; science covers use
atoms, test tubes, flasks, microscopes, DNA and seedlings. Transparent generated
pixel artwork uses pastel colours from the Polymath logo and prints even with
browser **Background graphics** turned off.

Run `node tools/cover-core-tests.mjs`, `node tools/cover-app-tests.mjs`,
`node tools/cover-editor-tests.mjs`, `node tools/cover-browser-tests.mjs` and
`node tools/cover-layout-browser-tests.mjs`. Generated assets and their prompts
are recorded in `assets/worksheet-covers/README-v2.md`.

## Polymath Online, the student portal (online/, v1.2.0)

**polymathlc.com.sg/online** is where students and parents find their class's
worksheets and answer keys. It is published by the website sync, like every
other page here.

- **Admins** sign in with Google and see the admin view: chungzhikai@gmail.com,
  elsielcr@gmail.com and admin@polymathlc.com.sg. Admins create a class (level,
  subject, day and session) and upload its whole list of PDFs once. The files
  go in name order, so Worksheet 2 comes before Worksheet 10. Drop or pick as many
  PDFs as you like: three upload at a time under one progress line (v1.2.0,
  which also fixed uploads that stuck at "waiting"). You can also add
  worksheets already in Ans Key, and reorder, rename or remove them. Each PDF
  becomes an ordinary Ans Key worksheet, ready for its answer key.
- **Releases follow the lessons.** When the teacher opens worksheet *n* of a
  class in Ans Key, the class moves to *n* and everything up to *n* + 5 is
  released, so worksheet 3 releases up to 8. An admin can also set the class
  position or the release by hand.
- **Invitations.** Type one or more emails and choose student or parent, level
  and subjects. An invitation email goes out through the project's Trigger
  Email extension (the `mail` collection), with **Copy link** as a fallback.
  Every portal email is sent as **Polymath Learning Centre
  <admin@polymathlc.com.sg>**, with replies going to that address, whichever
  admin sent the invitation (`PolymathOnlineCore.portalMail`).
  The person joins with any Google account, and their Ans Key profile (level
  and subject) is filled in for them.
- **Students and parents** see every class of their level and subjects. Each
  class shows a **vertical timeline** of its released worksheets in teaching
  order. The worksheet the class is on is highlighted as the *Current
  worksheet*. Each worksheet shows the date it was last edited in Ans Key, or
  the date it was uploaded if nothing has been written on it yet. Each one
  also has **View** and **Print** buttons for the worksheet and for its
  answer key. Worksheets with recorded lessons have a **▶ Video** button,
  and the replay opens inside the portal. The answer key, its printing and
  the replays all open Ans Key in a window over the portal, using
  `../anskey/?ws=<id>&do=play|print-answers` (Ans Key v1.132.0 or later).
  The timeline updates live as the teacher writes and records. The next two
  worksheets keep their Download and Print tiles. A worksheet that has not
  been released is counted, not named.
- **Security rules.** `tools/online-rules.mjs` adds a Polymath Online block to
  the shared Firestore rules and touches nothing else. Signed-out visitors
  see nothing. Only the three admins (verified Google emails) can write
  classes, invitations, members, settings and invitation emails. A member
  can read only their own row. A member can create that row only from an
  invitation they accepted, with its level, role and subjects. After that
  they can only refresh `lastSeenAt` and `photoURL`. Worksheet PDFs stay
  readable for Ans Key share links. **Actions → Polymath Online rules → Run
  workflow** tests every permission against the live rules, and with
  *apply* ticked it publishes the change.

## Infinite whiteboards (v1.429.0)

Open **Whiteboards** under Papers & Worksheets. Name a board, select questions
from the bank, then drag their headers to arrange them. Drag the background to
pan; use the zoom buttons, arrow keys and **Fit all questions** to navigate.
Save as many named boards as you need and reopen them from the library. Bank
question cards also have an **Add to whiteboard** button.

Each question has **AI / paste helper app**. Give the AI optional directions
or paste a complete HTML app with inline CSS and JavaScript. Preview it, then
choose **Use reviewed app**. Apps run in the existing isolated question-app
sandbox. Generated apps use your teaching notes and the recorded answer. The
output token limit is adjustable; incomplete responses keep the previous app.
For pasted code, choose **Preview pasted app**, then **Use pasted app**.

**Create share link** publishes the current question layout and approved apps.
Anyone with the link can explore it, write answers saved on their browser and
export a worksheet PDF. Original marking keys and account metadata are excluded
from shared snapshots. Reviewed helper apps may include worked answers, so check
their preview before sharing. Shared links keep the published version; publishing
an update makes a new link and does not revoke old links.

The teacher can select P3, P4, P5, P6 or S1 and **Send to selected levels**. Matching
students see the board under Whiteboards with a sidebar count. Receipt follows
the currently selected family learner's effective school level. Send again after
editing a board to update its assignment. Deleting a saved board removes its
class assignment; previously shared links still work.

Students can attempt one question or **Practice all questions**, using CER's
existing marking, history, release and level gates. **Worksheet PDF** exports the
questions with answer spaces through Print → Save as PDF. If a source question
changes, remove it and add it again before practising, printing, generating or
sharing so the question shown matches the one being answered.

Validation: `node --test tools/whiteboard-core-tests.mjs`,
`node --test tools/whiteboard-integration-tests.mjs`, and
`node tools/whiteboard-browser.mjs`. Tests use local fixtures and mocked AI and
storage; they do not publish student work or make paid model requests.

## Topic summary sheets (v1.428.1)

Open Summary Sheets under Papers & Worksheets to collect questions by topic,
or start with questions selected in the bank or worksheet builder. Add topic
questions or choose questions manually. Prepare AI summaries suggests a short
question, a suggested answer and guidance on how to answer for each card;
use or discard each suggestion after reviewing it. Every original question
image stays on its card. You can also edit the card text by hand, add more
questions and arrange the cards before saving.

Edit Very short question, then use AI prepare answer beside Summarized suggested
answer to prepare an answer for that current wording using the topic's teaching
notes. Review the prepared answer before using it and saving the sheet.

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
