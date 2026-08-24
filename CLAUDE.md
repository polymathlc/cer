# CLAUDE.md

Guidance for Claude when working in this repo.

## Apps
- `index.html` + `app.js` — **"Science Learning Portal"** (the product name shown in the sidebar, the `<title>` and the footer; it was "Keywords Learning Portal" until v1.181.0). "Science Quest" is NOT the portal — it is the RPG/dungeon game layer inside it, and the name used in the login / password-reset / prize emails. Keep the two distinct. The CER science-quiz app: admin question authoring (block editor, AI build-from-screenshot, image crop/touch-up, vetting → bank) + student practice + an RPG/dungeon game layer. **The markup and CSS live in `index.html`; ALL of the application JavaScript lives in `app.js`**, loaded as `<script type="module" src="app.js">`. They ship together — `index.html` is useless without `app.js` next to it, so deploy the directory, never the single file.
  - Functions referenced from inline `onclick`/`on*` handlers MUST be assigned to `window` near the bottom of `app.js` (search `window.navigateTo =`), because the module has its own scope.
  - `const` declared mid-module is in its temporal dead zone earlier in the file — only read such values at call time, not at module-eval time.
  - **Keep the page fast — these are load-bearing, do not undo them:**
    - Fonts are ONE non-blocking request (`media="print" onload="this.media='all'"`). Adding another render-blocking `<link rel="stylesheet">` to Google Fonts puts first paint back at the mercy of the school's network. Crimson Pro is deliberately `media="print"` — it is only used by the printed worksheet cover.
    - There is NO icon font. The seven landing-page icons are inline SVG inside `.material-symbols-outlined` spans. Do not reintroduce Material Symbols: the variable webfont is 1.1 MB.
    - Tailwind is PREBUILT and inlined (search `Tailwind, prebuilt`). Do not put the `cdn.tailwindcss.com` Play CDN back — it ships a CSS compiler to the student's phone. Regenerate via `docs/tailwind/` instead.
    - `<link rel="modulepreload" href="app.js">` in the head is what starts the app download early. Keep it, and keep it pointing at the right filename.
  - **Printed / PDF worksheet answer boxes** are sized from the MODEL ANSWER by `printAnswerLines(block, text)`: `PRINT_ANSWER_LINES` (2) is the floor for an ordinary answer, a one-number / ≤4-word answer (`PRINT_SHORT_CHARS`) gets 1 line, and longer answers scale at `PRINT_LINE_CHARS` (52) characters a ruled line with a `PRINT_HAND_ALLOWANCE` (×1.15) for handwriting, capped at `PRINT_LINES_MAX`. Each Claim / Evidence / Reasoning box is sized from ITS OWN field, so a one-line claim can sit beside a five-line reasoning. The answer block's "Printed lines" field (`block.printLines`, edited via `printLinesFieldHtml` / `setPrintLines`) overrides the estimate; blank means Auto. The box `min-height` in the print CSS is one line + padding (32pt) — do not raise it, or a one-line answer gets propped open again. Both print paths — `doPrintWorksheetOpen` and the saved-worksheet builder — must stay in step.
  - **Touch up & label — the transform session** (`_annotXform*`) is ONE session shared by Resize (F), Rotate (R) and Skew (K): the selected pixels are lifted onto their own layer (the hole behind them painted white), and nothing is committed until Apply, so 30° and back to 0° leaves the pixels as sharp as they started. The transform is **scale → skew → rotate**, and `_annotXformMapper` and `_annotXformDrawInto` must apply it in that same order or the handles drift off the picture they are drawn on. Resize (v1.247.0) drags the eight handles round the box: the corner OPPOSITE the one being dragged is the anchor, so the maths runs in the **M-frame** (`_annotXformMFrame` — rotation and slant undone, scaling still applied), where the new factor is just `(pointer − anchor) / handle-span`, and the layer offset is then whatever puts the anchor back. That is what keeps it exact on an object that is already turned. Two rules hold it together: only the axes a handle actually DRIVES get a vote when "keep shape" is on (an edge handle's other axis sits at 1× and would out-vote the drag), and `_annotXformRecentre` puts the pivot back in the middle of the box after every resize or move — without it, a turn afterwards swings the object round a point off to one side. A pointer arrives in CANVAS coordinates and the transform lives in the pre-offset frame, so anything comparing the two goes through `_annotXformUnoffset` or a grown canvas breaks the hit test.
  - **Annotation answers** — an annotation pad (an image with `annotate !== false`, or a `workingSpace` with `annotate`) carries its own answer on the block: `answerImg` is a screenshot of the diagram WITH the correct annotations on it, `answerKey` is the same in words. The answer to "draw and label this" is a picture, so the screenshot is the primary form and `annotAnsWriteKey` generates the words from it. All three consumers read the BLOCK, not the question: `annotShowAnswer(sel, pid)` shows that pad's own answer under that pad, `annotAiCheck` sends the screenshot as a SECOND picture so the AI compares two diagrams instead of a diagram against a sentence, and `_pushAnnotAnswerKey` puts it on the printed key — called once per block in both print loops, because pads live across the `image`, `workingSpace` and `default` branches.
  - **On-screen picture width** is capped by `IMG_AUTO_MAX_PCT` (70%) inside `imgSizeStyle` — the ONE function every rendered picture goes through (block editor, student practice, worksheet preview, both print paths, the game quizzes). It is a `max-width` CAP, never a `width`: setting `width:70%` would stretch a small inset UP to 70% of the column, which is the opposite of making pictures smaller. A picture the author sized by hand (`block.scale`) keeps that size — the +/− control exists to override the default.
  - **Printed picture heights** — `.print-question-page img` caps at **92mm**, with `print-img-sm` (60mm) / `print-img-lg` (140mm) / `print-img-full` (170mm) chosen per picture by the image block's "Print size" control (`block.printImg`, rendered by `imgPrintClass` / `imgPrintAttr`). A question whose SINGLE picture is paired with ≤3-character MCQ options is upgraded to Large automatically (`imgQuestionNeedsBig`) — that picture holds the options. Do NOT go back to one flat 170mm cap: a question with a diagram and a chart then cannot fit a sheet.
  - **The print planner must MEASURE, never assume.** `_printPlanIn` lays every page out in a print-CSS iframe; when a page needs fit-to-page shrinking it goes through `_printVerifiedZoom`, which re-measures with the zoom actually applied and steps down until the page really fits, falling back to a flowing (`print-page-tall`) page at the zoom floor. The page box is a fixed height with `overflow: visible`, so any un-verified overestimate paints over the NEXT sheet instead of reflowing. Five things keep the measurement honest — none of them is optional (all five were broken at once in v1.237.0, and the symptom was two questions printed on top of each other):
    - **Pictures must reserve their box before they load.** An `<img>` that has not decoded occupies ~22px, not the ~350px it prints at, and the planner's iframe RE-FETCHES every picture — so on a slow link its readiness net expires and a page of diagrams is measured as a page of text. `_printLearnImgDims` / `_printStampImgDims` (backed by `_printImgNatural`) stamp `width`/`height` onto every printed `<img>` so Chrome reserves the right box from the aspect ratio alone. If anything is still unsized when the planner starts, `_printPlanPages` refuses to plan and takes `_printFlowFallback`, which is denser but can never overlap. **Never emit a printed `<img>` without dimensions.**
    - **`usable` must reserve the page number.** `measurePage` assembles content + footer; `.print-page-number` is stamped on AFTER planning, so `usable = PRINT_PAGE_PX − numH − PRINT_FIT_SAFETY`. It used to be `PRINT_PAGE_PX − PRINT_FIT_SAFETY`, and `PRINT_FIT_SAFETY` (16px) is smaller than the number's own line (~22.7px) — every page packed to the bar printed ~7px past the box. `budget` derives from the same ceiling (`contentSpace − PRINT_PAGE_RESERVE`), so the packer and the verifier cannot drift apart; `_classifyPrintChunks` takes `usable` as a parameter for the same reason.
    - **A page promoted to tall must promote its CHUNKS too.** `.print-page-tall` opens the page box; every `.print-question-chunk` still carries `break-inside: avoid`. A chunk that cannot break on an over-sheet page does not flow, it overflows — so `_printPlanIn` writes `cls.tallFlags[idx]` and adds `.print-chunk-tall` for the whole group, because `cls.tallFlags` is what `doScaleAndPrint` re-reads.
    - **The measuring iframe must get the real fonts.** Both font `<link>`s in `index.html` are `media="print"`; the iframe is a SCREEN medium, so copying them verbatim measures every stem in fallback metrics while the printer uses DM Sans (wider → more lines → ~100px+ per page of unbudgeted growth). `_printFontLinksHtml` forces `media="all"` on the COPIES. Use it — never copy `link.outerHTML` directly.
    - **No box may be taller than a sheet.** `PRINT_LINES_MANUAL_MAX` (24) caps the author's "Printed lines" override and `_wsBlockLines` / `WS_BLOCK_LINES_MAX` (30) cap the raw pixel heights `openLines` / `workingSpace` write. An unbreakable box bigger than the paper jumps a whole sheet and still does not fit. The tall pages release their inner boxes in CSS (`.print-chunk-tall`/`.print-page-tall` → `.print-open-answer-box`, `.print-open-cer-box`, `.print-cer-section`, `.print-ak-question`).
  - **`.print-text-block img` must not set `max-height`.** Every printed picture is wrapped in a `.print-text-block`, and that selector has the SAME specificity (0,1,1) as the `.print-question-page img` 92mm cap while sitting later in the file. A `max-height` there wins, which puts the one flat 170mm cap back on every Auto picture, makes `print-img-lg` (140mm) *smaller* than Auto and makes `print-img-full` a no-op. The ladder must read 60 / 92 / 140 / 170mm — check it if you touch either rule.
  - **Fill-in-the-blank must print BLANK.** `renderImportedBlockStudent`'s `fillblank` branch is `_fbReadonlyHtml`, a REVIEW rendering that puts each answer inside its slot — so a print path that falls through to it hands the class a worksheet with the answers already filled in. Both print builders carry an explicit `case 'fillblank'` that uses `_fbPrintHtml` (empty rules, width scaled to the answer) and pushes `_fbAnswerKeyText` onto the key instead. Do not delete either case.
  - **EVERY question gets an answer on the printed key** (`_pushBlockAnswerKey` / `_qFallbackKeySection` / `_akQuestionSections`, v1.284.0). Most answers live in an `answer` / `plainanswer` box and were always keyed; the rest do not, and were silently dropped — an **MCQ**'s correct option, an **`answerLine`**'s answer, a 🔑 **`answerKey`** block. A key that omits a question prints perfectly and looks tidy, so the teacher only finds out in front of the class.
    - **`answerKeyExtras` gates EXPLANATIONS ONLY.** It used to gate the MCQ answer and the `answerKey` block too, and only the two past-paper call sites pass it — so every ordinary worksheet printed a key listing its handful of open-ended questions and nothing else, which is exactly the bug. An answer is never optional; an explanation is teaching commentary and stays behind the flag.
    - **`_pushBlockAnswerKey(sections, block, part)` is the ONE pusher both print paths call** — `doPrintWorksheetOpen` and `buildWorksheetHtml` had drifted apart (path A keyed MCQs, path B did not), and a shared function is the only thing that stops that happening again. Adding an answer-bearing block type means adding a case there, not in two switches.
    - **A question with nothing still gets a ROW.** No answer-bearing block at all → the explanation stands in (`_qFallbackKeySection`, labelled *Explanation*, never alongside a real answer); still nothing → the row says "No answer recorded for this question", because a gap in the numbering reads as a printing fault. The placeholder is substituted at RENDER time (`_akQuestionSections`) and is deliberately **not** what `hasAny` counts — a bank with no model answers must still print no key sheet at all, rather than a page of placeholders. That guard predates this and must stay.
    - Run **`node tools/answer-key-tests.mjs`** after touching any of it.
  - **📚 Teaching Notes are SHARED with the Ans Key annotator** (`polymathlc/anskey`, `index.html`). Both apps read and write `users/{adminUid}/teachingNotes/{id}` — one notebook, so notes uploaded on either side ground the AI on both. Keep the field names compatible, and ship a change to the shape in both repos together. `topics` is **this** app's syllabus list (`currentTopics()`), matched by exact string in `_notesMarkingBlock` / `_notesAnswerBlock`; Ans Key therefore writes it EMPTY (its notes read as general notes here, which is what a note from another app should be) and keeps its own free wording in `noteTopics` / `subjects` / `levels`. Renaming `keywords`, `markingStandards` or `keyFacts` here silently ungrounds the other app — nothing throws, the digests just come back empty. **`guidance` — the hand-typed standing instruction — is read here too since v1.309.0**; see **📌 The standing instruction** below. The **Scan app** (`polymathlc/scan`) is the third reader of the same notebook.
  - **Roles are admin / employee / student.** `EMPLOYEE_EMAILS` (v1.235.0) names accounts hired to WRITE QUESTIONS: they get exactly the pages in `EMPLOYEE_PAGES` (create, bank, vetting, worksheet, myworksheets) and nothing else. **Three** rules keep it default-deny: `configureSidebarForRole('employee')` hides EVERY `.nav-item` and shows back only those pages, `navigateTo` rewrites any other page to `create` — hiding nav items alone would leave a bookmark or a deep link walking straight in — and **`_navAllowed(page)` guards every LATE nav show**. That third one is not optional: `rpgApplyVisibility` runs when the hero doc resolves, seconds AFTER the sidebar was locked down, and it turns `.rpg-el` (Character, Leaderboard, Adventure, Arcade, the Hide-game toggle) back on and calls `tcgApplyNavVisibility` / `fpsApplyNavVisibility`, which do the same for Realm of Embers and Science Strike. Until v1.240.0 the whole game menu reappeared for an employee a second after login. Anything that switches a nav item on after sign-in must ask `_navAllowed` (or `!_isEmployee()`) first, and the two game release banners (`fpsShowAnnounce`, `tcgAnnounceVisible`) do too. Gate authoring on **`_canAuthor()`** (admin OR employee), never by widening `_isAdmin()`, which keeps its old meaning everywhere else. An employee has **no bank of their own**: `_bankOwnerUid()` points `_qCol`/`_vCol`/`_qOwner`/`_vOwner` at the teacher's subtree, so `_resolveBankOwner()` must run (and `adminUid` be set) before anything reads or writes. Employees must never write `config/admin` — that pointer is what students resolve the bank from. **The account itself** is made in the admin's create-account dialog, which has a Student / Employee toggle (`csSetRole`, v1.240.0): an employee must be created with their REAL email (a synthetic `username@students…` address could never match `EMPLOYEE_EMAILS`), and the dialog refuses an address that is not already on that list rather than quietly handing out a student account. The `role` written to `userProfiles` is descriptive only — the live role is always decided at sign-in from `ADMIN_EMAILS` / `EMPLOYEE_EMAILS`. Firebase Auth rejects passwords under 6 characters, so that floor is not the app's to relax.
  - **The Exam Paper builder** (`ep*` in `app.js`, `.ep-*` CSS + `#page-exampaper` in `index.html`, v1.241.0) takes a whole paper the way a teacher actually has one: question screenshots added ONE AT A TIME, the marking scheme added SEPARATELY, and the paper's own answers slotted into the built questions by **question number**. Available to anyone `_canAuthor()`.
    - It is deliberately its own page and its own state. `handleBulkAiFile` (the bulk PDF import) streams a whole file straight into Vetting with no key step and nothing to check first; the block editor builds one question by hand. Neither can slot an answer key in — do not merge the three.
    - **Nothing is written until Send.** The whole paper sits in `_epShots` / `_epKeyShots` in memory, so a mis-read screenshot can be removed and re-added before anything reaches the bank. `_epCommit` is the only writer, and it goes through `saveQuestion` / `saveVettingQuestion` like every other authoring path — so a running work session logs the questions automatically.
    - **Screenshots are read as a RUN, never one question per screenshot** (v1.242.0). `_epRunBuild` sends them `EP_BATCH` (4) at a time as multiple images in ONE `askGeminiVision` call, and the model decides where each question starts and ends — so a question spread over three screenshots comes out as one question, and a screenshot holding three questions comes out as three. A question straddling a batch boundary is stitched back by the same `continuation` entry the bulk PDF import uses across a page break. Because of that, reading is always a read of the WHOLE set (`_epQuestions` is replaced, not appended to) — there is no honest way to re-read "only the new screenshots" and still get the boundaries right, so adding or removing one sets `_epDirty` and the page asks for a re-read rather than pretending the old questions still line up.
    - Reading reuses the proven pipeline rather than forking it: `askGeminiVision` → `_parseAIJson` → `buildQuestionFromAi` → `_epCropInto` → `_tagDuplicate`. `_epCropInto` groups image blocks by the **`"page"`** index the model puts on each one (the same field and 1-based convention `_aiBuildQuestionPrompt` / `_autoFillDiagramsFromBoxes` already use for a multi-screenshot question) and crops each group from its own screenshot; an unnamed or out-of-range `page` falls back to the first screenshot of the batch, and a screenshot whose rectangles all fail gets attached whole so the figure is never silently lost.
    - **The paper's question number never reaches the question** (`_epStripNumbering`, v1.241.1). 44(a) is stored as a question with no 44 anywhere and an OFFICIAL part (a): the number is dropped from the title and from the opening text block, and the part letter is lifted into `block.part` by `qPartDetect` — the same detector the Question Doctor uses, so a marker wrapped in `<strong>` is removed from the markup instead of being sliced out of the middle of a tag. Only TEXT blocks may open a part (`QPART_OPENER_TYPES`), a block holding 2+ markers is refused exactly as the Doctor refuses it, and when the wording carries no marker at all the letter is taken from the number instead (`_epPartFromNumber`). `_epNum` keeps the full "44a" — it is the answer-key link and nothing else. Two guards are load-bearing: `EP_LEAD_NUM_RE` ends in `(?!\d)` or "2.5 kg of ice was heated" opens with what looks like question 2 and the question starts "5 kg"; and a bare leading number needs a `.`/`)` after it (or a part marker behind it) before it counts as numbering, so "50 ml of water was added" survives. A title left empty by the strip falls back to the question's opening words, never to a row of identical "Untitled question" entries.
    - **The link between a question and its answer is `_epNumKey(number)`**, which collapses `Q12 (b)`, `12b` and `12(B)` to the same key — a paper and its marking scheme almost never number a question the same way twice. The question prompt is told the number is what the key will be matched on; the key prompt is told the same. Every unmatched question is flagged in the ③ Match table with a per-row `<select>` so the admin can link it by hand (`epSetMatch`).
    - **A question with parts is matched PART BY PART** (v1.244.0), because the paper numbers ONE question 44 while the marking scheme answers 44(a), 44(b), 44(c) on three separate lines — one row per question could never fill it in, which is why an OEQ's parts used to come out with nothing but the model's placeholder in them. `_epNumParts` splits a number into base + letter, `_epPartLetters` reads the parts off the blocks (`qBlockOpensPart`, so it is the same model the rest of the app uses), and `_epAnswerForPart` looks for `base+letter` — falling back to the roman sub-parts printed under it (`44(b)(i)`, `44(b)(ii)`), which `_epMergeAnswers` folds into one labelled answer rather than dropping. `_epApplyAnswer(q, a, part)` then places that answer **inside that part's own run of blocks** (`_epPartSpan` / `_epPlacePartAnswer`): it replaces the part's answer box, or inserts one at the end of the part when the model wrote none — never on top of the next part's. A question that matches NO per-part row still falls back to a whole-question row, which is how a question with no parts has always been matched. Three things keep it honest: `_epSlot` counts a question matched on only SOME of its parts as **partial** and both the ③ table and the Send dialog say so (the unmatched parts silently keep the model's placeholder); the ③ table gives a part its OWN `<select>` (`epSetMatch(qid, number, part)`), since one picker could only ever link one of three parts; and the single explanation block is rebuilt from `q._epEx` per part by `_epRebuildExplanation`, keeping the model's whole-question explanation while any part is still without an official note.
    - **Parts have to be RECOGNISED before they can be matched**, so two things feed them: `_epSplitPartBlocks` splits a text block that holds several markers ("(a) …&lt;br&gt;(b) …") into one block per part — the Question Doctor refuses that case because it is rewriting vetted questions, but here the model wrote the block seconds ago from a screenshot that plainly had parts. It only ever splits when `<br>` is the only markup (`EP_ONLY_BR_RE` — the cut is a source offset, and slicing through a `<p>` would leave it unbalanced), when the letters are **lowercase and consecutive** (an uppercase `(A) (B) (C)` run is an options list), and **never inside a question with an `mcq` block** (those lettered lines are its statements). On the key side, `_epKeyNumber` gives a bare `(a)` row back the last full number seen (`_epKeyBase`), because a marking scheme very often prints "44" once with its parts listed underneath.
    - **Every part gets its OWN explanation** (v1.245.0), because an explanation is read as explaining the question directly above it. The build prompt asks for one explanation block per part, placed after that part's answer; `qPlacePartExplanation` puts the key's note for a part inside that part (never merged with another part's, and a part the key says nothing about keeps the model's note); and `qScopeExplanations` repairs the case the model gets wrong. Both are shared with every other authoring path — see **Question parts** above.
    - The part machinery itself is NOT the exam builder's own: `_epStripNumbering` only adds what is specific to a paper (dropping the printed number, and the number-derived part fallback) on top of `qSplitPartBlocks` / `qLiftPartMarkers` / `qScopeExplanations`, and the `_ep*` part helpers are one-line views of the shared `qPartSpan` / `qPartFind` / `qPlacePartExplanation` that take a whole question instead of a block list. Order matters: the number comes off the wording FIRST, because a marker hiding behind it ("45 (a) Name the process") cannot be lifted until it does.
    - The AI writes a placeholder answer for every question (some numbers never appear on a key), and the official answer **replaces** it: `_epPlaceAnswerBlock` keeps the answer at its original index, `_epDropBlanks` clears the blanks that belonged to the old wording (they are word positions, so keeping them blanks the wrong words), and the key's explanation beats the model's. No prompt asks for `[[keywords]]` any more — a keyword is a teaching decision made by a person on the 🔑 panel (see **🔑 Keywords in a model answer** below), so `q.blanks` and `_epDropBlanks` are now housekeeping for an artefact nothing reads. `_epOptionIndex` accepts an MCQ answer printed as a number, a letter, or the option's own wording.
  - **Mark Paper** (`mp*` in `app.js`, `.mp-*` CSS + `#page-markpaper` in `index.html`, v1.248.0) is the exam paper builder read backwards: `_ep*` takes a BLANK paper into the bank, this takes the same paper back once a student has WRITTEN on it. Scan every page, and the AI finds each question, transcribes the handwriting, marks the lot, and hands back the four things a teacher gives back — the **answer key**, the **student's own answer**, **feedback on everything they got wrong**, and a **report over the whole script**. Gated on `_canAuthor()`; the nav item is `admin-only` and `markpaper` is deliberately NOT on `EMPLOYEE_PAGES` (an employee is hired to write questions, not to mark a class), so the render gate is the one that would need nothing changing if that were ever revisited.
    - **It is not Snap & Mark, and the two must not be merged.** Snap & Mark is the STUDENT's tool: one photo, one question, matched against a question that must already be **in the bank**, and it goes quiet the moment the question is not there. A marked script is the opposite case — thirty questions the bank has never seen over ten pages, and every one of them has to come back with a mark. So the questions here are read off the paper itself.
    - **The answer key has three sources, best first, and every row says which it used**: 🔑 the paper's own marking scheme (scanned separately into ② and matched by number through `_epNumKey`, so "Q12 (b)", "12b" and "12(B)" are one key), 📚 a question in the bank that is plainly the same question (`_mpBankMatch` — the cheap `_snapTokens`/`_snapSim` overlap, NOT an AI call, with `MP_BANK_MIN_SIM` deliberately high at 0.62 because a wrong bank match marks the student against the wrong question entirely), then 🤖 the model's own answer. `_mpApplyMark` never lets the AI answer overwrite a key that came from the paper or the bank. The badge is not decoration — a teacher checking a mark has to know whether the key came off the paper or was written by the AI.
    - **Reading and marking are separate passes on purpose.** `_mpReadScript` sends `MP_READ_BATCH` (3) pages as multiple images in ONE `askGeminiVision` call and reads pages as a RUN — a question running from the foot of one page to the top of the next is stitched back by the same `continuation` mechanism `_epRunBuild` uses across a batch boundary — and it is told to transcribe, never to mark. `_mpMarkAll` then marks from the transcription in text-only `askGemini` calls of `MP_MARK_BATCH` (6), which is why marking a thirty-question paper is not thirty vision calls. **A lettered part is its own item** (`8(a)` and `8(b)` are two entries), because that is how a marking scheme numbers them and how they are marked.
    - **Nothing is written anywhere** — not the bank, not vetting, not Firestore. A marked script is a child's work; it lives in memory and leaves through `mpPrintReport` / `mpCopyReport`. Do not add a save path without deciding first whose data it is.
    - Guards that keep a mark honest: `_mpMarks` defaults an unmarked question to 1 (MCQ) / 2 (written) and rejects an absurd count; `awarded` is clamped to `[0, marks]` and a `correct` verdict always earns FULL marks whatever the model returned; a blank answer can never be marked correct; a batch whose AI call FAILED is rendered `unmarked` with a note rather than a silent zero, which a teacher would read as "the student got this wrong"; and `mpSetVerdict` lets the teacher change any mark (the total follows) because AI marking of handwriting is very good and still not perfect. Changing the pages clears the marks (`_mpClearMarks`) — a stale mark is worse than no mark.
  - **⚡ Rapid add works on a PHONE** (`_rapidTouch` / `rapidZoneClick` / `rapidPickFiles` / `_rapidPrepFile` in `app.js`, `.rapid-desk` / `.rapid-touch` CSS in `index.html`, v1.290.0). The pad was a paste target and nothing else, so on a phone it was **a box that could not be filled**: no Ctrl/⌘+V, nothing on the clipboard to paste, nothing to drag. The camera and the gallery are the way in there.
    - **`(pointer: coarse)` is the whole gate** — the CSS classes and the JS predicate ask the same question. On a mouse the pad is the box it always was (same wording, same paste, same drop), and a touchscreen laptop driven by a trackpad reports a FINE pointer, so it keeps the paste pad too.
    - **Both routes end at `startRapidJob`**, the ONE queue entry point, so a photo is read, cropped and filed exactly as a pasted screenshot is. Do not give the phone its own pipeline.
    - **The picker's `value` is cleared BEFORE the files are queued.** An `<input type=file>` still holding last time's file fires no `change` for the same photo picked twice, so the second tap does nothing at all — a button that looks like it works and does not.
    - **An oversized photo is SHRUNK, not refused** (`_rapidPrepFile`). A 12 MP camera photo is several times the 18 MB guard, so the guard alone refused the phone route for being the phone route. It only touches an image over `RAPID_SHRINK_OVER` (4 MB) — a pasted screenshot never reaches that and comes through byte-for-byte — and it re-encodes as **JPEG, never PNG**, or a photograph comes out bigger than it went in. The size check runs AFTER the shrink, and a failure there files the same red card a failed read does (`_failRapidJob`, which `processRapidJob`'s own catch now calls too): a screenshot that vanished silently reads as one that worked.
  - **✅ Check Questions** (`cq*` in `app.js`, `.cq-*` CSS + `#page-checkq` in `index.html`, v1.288.0) serves the questions added MOST RECENTLY back to an author, one at a time, for a second pair of eyes. Available to anyone `_canAuthor()` — it is on `EMPLOYEE_PAGES`, because checking each other's questions is exactly the job an employee is hired for.
    - **It is not the Question Doctor and the two must not be merged.** The Doctor is a whole-bank audit an admin runs occasionally and reads as a LIST of problems; this is a QUEUE worked through a question at a time, newest first, which never stops offering the next one. Marking one ✓ drops it out for good, so the page always knows what nobody has read yet.
    - **The headline check is the reason the page exists**: a question whose TABLE OR DIAGRAM already sets out the four choices, with the options underneath repeating in words what the picture has already said. Those options should read just **(1) (2) (3) (4)** and let the picture do the work — `cqNumberOptions` writes exactly what the block editor's ＃ button (`mcqNumberOptions`) writes, so a question fixed from here and one fixed by hand come out identical.
    - **Two layers find it, and neither can do the job alone.** Structurally it is decidable only when the choices are in a **`table` block** — the table labels its rows 1..n (`_cqTableLabelsChoices`, the strongest signal and no wording match needed), or ≥80% of an option's content words are already printed in the cells. The same question with a **picture** is invisible to any text check, so the AI pass attaches the diagrams (`_cqMedia` → `askGeminiVision`) and is asked about them FIRST. **Do not "optimise" that pass down to `askGemini`** — without the images the check cannot be made at all.
    - **The one-tap fix must never be a guess.** `_cqMcqFixable` gates it on a real option list that is not already numbered, and the AI's `fix:"numberOptions"` is dropped unless that passes — the button blanks the wording of all four options, so offering it on a question whose choices are NOT in the picture destroys the question while looking tidy. The picture-only case therefore raises a **low-severity nudge with no fix button**, and that nudge stands down the moment the AI has answered.
    - **`q.checked` lives on the QUESTION, not per user**, so two employees never read the same question twice, and it is written with a **quiet** save: reading a question is housekeeping, not a question authored, and must not land in anybody's work-session log. It is deliberately absent from `EDITOR_OWNED_QUESTION_FIELDS` so `carryOverQuestionMeta` keeps it across an edit. The ✓ advance is optimistic and rolls back if the write fails; ↩ Undo clears it again.
    - The nav badge counts only the unchecked questions inside `CQ_RECENT_DAYS`, because a bank of several thousand older ones would show a number nobody could ever clear. The QUEUE still tops up past the window (`CQ_MIN_QUEUE`) rather than sitting empty while nothing has ever been read.
    - Run **`node tools/check-questions-tests.mjs`** after touching any of it.
  - **Work sessions** (`wk*` in `app.js`, `.wk-*` CSS + `#wkBar` + `#page-worksession` in `index.html`, v1.239.0) are how an author's hours and output are tracked: they press **Start session** on the ⏱️ Work Sessions page, and every question saved while the clock runs is logged with its title, topic, category, destination (bank / vetting) and time. Available to anyone `_canAuthor()` — the employee runs the clock, the admin reads everyone's.
    - **The clock is two timestamps, never a counter.** `_wkElapsed` = `(endedAt || pausedAt || now) − startedAt − pausedMs`, so a minimised tab, a throttled `setInterval`, a sleeping laptop or a closed browser cost nothing: the 1-second tick only REPAINTS a value derived from the wall clock. Do not "fix" it by accumulating ticks — that is the exact bug this shape exists to prevent. The running session is mirrored to `localStorage` (keyed by uid) on every change, and `wkInit()` picks it back up on the next sign-in.
    - `lastSeen` is a 60-second heartbeat meaning *the tab was demonstrably open at this moment*, and it is what an abandoned session gets closed at: on resume, a session past `WK_MAX_MS` (12h) of elapsed OR of idle is filed at its last heartbeat, not at whenever it was reopened. Hours when nobody was at the keyboard are not hours worked.
    - **Questions are logged from `saveQuestion` / `saveVettingQuestion`** — the two functions every committed question goes through — so no authoring path (block editor, build-from-screenshot, rapid add, auto-vet, edit-to-bank) can be forgotten. Two things keep the count honest and must stay: `opts.quiet` writes are excluded (the usage backfill, auto-tagging, the part converter are housekeeping, not authoring), and `_wkSuppress` guards the automatic paths (`checkAndReleaseScheduledQuestions`, `loadSampleData`). **Both flags are read at CALL time into a local `wkLog`, before the `await`** — a job that fires saves off without awaiting them would otherwise have dropped its guard by the time they resolve. Entries dedupe by question id (`n` counts re-saves), and `uniq` keeps counting past the `WK_ITEMS_MAX` (500) list cap so the headline number never disagrees with the work done.
    - Filed to **`workSessions/{uid}_{startedAt}`** (shared, so the admin can list everyone's) with **`users/{uid}/workSessions/{id}`** as the fallback if that collection is not open in the Firestore rules — a denied write must never stop the clock or lose the log. `wkLoadHistory` reads both, plus each `EMPLOYEE_EMAILS` author's own subtree when an admin is looking. If you add the shared collection to the rules, an author needs create/update on their own docs and the admin needs read on all of them.
    - **One session covers ALL the author's windows, and every write MERGES** (v1.243.0). Each tab holds its own copy and each `setDoc`s the WHOLE session doc, so a plain overwrite meant the tab that saved last erased every question the other tabs had logged — work really done, gone from the log. `_wkStoreLocal` is therefore read-merge-write against localStorage, `_wkAdoptRemote` (fired by the `storage` event) folds another tab's copy in rather than fighting it, and `_wkFinish` files the UNION. `_wkMerge` must stay **idempotent** — the tabs echo the same state at each other: items union by question id, `savesByTab` counts per tab (a single `saves` total summed across tabs grows forever), `pauseSetAt` decides whose pause/resume is current, and any `endedAt` wins. `uniq` is DERIVED from the merged list under the item cap, never incremented, or a question logged in two windows counts twice. `_wkQueueSave` reads `_wkSession` when the timer FIRES, never a captured copy: a queued write holding the pre-merge object would file the session again without the other tab's questions.
  - **Concurrent tabs** (`xt*` in `app.js`, v1.243.0) — authoring runs in several windows at once (Rapid add in one, the exam paper builder in another, the block editor in a third) and none of them may lose a question. Every question is its own document so the WRITES never collide; what needed fixing was everything around them.
    - `xtInit()` opens a **BroadcastChannel** (`sq_tabs`), falling back to a `localStorage` key where it does not exist, and is bound at sign-in just before `wkInit()`. Messages are **hints, never data**: a tab is told an id changed and re-reads that document from Firestore, so two tabs can never talk each other into a state the database does not have.
    - `_xtTabId()` is the tab's identity and lives in **`sessionStorage`** — per-tab, and kept across a reload. That is exactly the primitive the exam paper draft needs (a refresh finds its own paper; the window beside it keeps its own), so don't move it to localStorage.
    - `saveQuestion` / `saveVettingQuestion` / `deleteQuestionDoc` / `deleteVettingDoc` call `_xtAnnounceQuestion`, and `_xtFlushQuestions` folds the change into the other windows' `questionBank` / `vettingList`, refreshes the counts and repaints the list only if that page is showing. It **debounces (500 ms) and batches** — an exam paper commit fires one message per question and would otherwise be forty round trips and forty repaints. It **reads first and applies after**, because `questionBank` / `vettingList` are re-assigned wholesale elsewhere and an index taken before an `await` can point into an array that no longer exists. A read that FAILS changes nothing — a network blip must never delete a question. `quiet` writes are deliberately silent (the usage backfill and auto-tagger walk the whole bank).
    - `_xtGuardUnload` is a `beforeunload` warning while `_inflightOps > 0`, a Rapid add job is still reading, or the exam paper builder is mid-AI-call. That is the ONE way an added question really is lost: the document never leaves the tab.
    - **The exam paper draft is mirrored to IndexedDB** (`_epDraft*`, store `sqDrafts/exampapers`) so an unsent paper survives a reload or a crash — nothing is written to the bank until Send, which is the point of the page and also the risk. Three records per draft, and the split is why opening the page is cheap: `epmeta:` (a few numbers — all the recovery banner needs, so a scan never pulls another window's 90 MB of screenshots into memory), `epwork:` (paper name, questions, answers — text, rewritten on every change) and `epshot:` (the screenshots, rewritten ONLY when `_epShotsSig()` changes). Keyed by **tab**, never by user, so two windows each building a paper cannot claim each other's work. `_epDraftSave()` hangs off `epRender()` — every mutation on that page ends in a render, so it is the one hook that cannot be forgotten. A draft left by a window that is GONE is offered back on the page (`_epDraftScan` pings the channel; every window still open answers, and whatever does not answer is recoverable) rather than claimed silently. Keys carry the uid explicitly for the pruner: a shared machine can hold another account's draft under the same tab id.
  - **The whole-paper editor** (`ppPeRowHtml` / `ppPeFillPreviews`) renders each question through **`buildOpenBody`**, the same renderer every student surface uses, so the preview cannot drift from what a student is served; it is made inert with CSS (`.pp-pe-preview`), not by forking the renderer. Each row needs its OWN container selector (`#ppPePrev_<k>`) because buildOpenBody keys its answer stores by selector — the same selector twice silently clobbers the first question's model answers. `ppPeSet` deliberately never re-renders (caret preservation), so anything a row's HEADER repeats must be patched in place there; and `_ppPePrevCache` exists because `ppPeRender()` replaces the whole body on every renumber/sort/bulk stamp, which would otherwise rebuild forty question previews.
  - **A saved worksheet's questions can be changed after the fact** (`wse*` in `app.js`, `.wse-*` CSS + `#wsEditOverlay` in `index.html`, v1.249.0). A saved worksheet is nothing but an ORDERED list of bank ids (`ws.questionIds`), so the editor edits that list — what is on the sheet on the left (remove ✕, reorder ▲▼), the bank to draw from on the right (＋ Add, filtered by level / topic / type / search). Everything else about the sheet is derived from that list, so the print layout, the cover, the practice queue and the preview all follow for free.
    - It **never touches the question bank** — it only adds and removes references. Editing the question ITSELF is the quick-edit drawer (`wsQuickEdit`), which does write to the bank and says so. Keep the two apart.
    - **Every change persists as it is made** (`_wsPersistWorksheet` — a list of ids is a tiny write, and an edit the teacher believes is saved and is not is far worse than a chatty connection). `_wseCommit` is the one place that fans a change out: persist → redraw the editor → redraw the My Worksheets card's count → re-render the live A4 preview if that is the sheet on show.
    - Three entry points, ONE removal path (`wseRemoveFrom(wsId, qid)`, which takes the worksheet by id rather than reading the open editor, because the preview's own ✕ removes with the editor closed): the ✎ Questions button on the My Worksheets card, the same button in the preview bar (`wseOpenFromPreview`, shown only when `_wsPreviewSaved`), and the per-question `✕ remove` tool inside the preview. Removing must also drop the id from `wsManualBreaks` / `wsMergeUp` — those overrides are keyed by question id, so a break left behind would sit on whatever came after it.
    - A worksheet doc lives under its OWNER's uid — a student's Ai-nstein worksheet is their own document — so anyone may edit their own, but `_wseBank()` caps a student's pickable bank with `qWithinStudentLevel`, the same rule every practice mode applies. An id whose question has since been DELETED from the bank gets its own row saying so rather than being silently dropped, which is the only place that stale entry is visible at all.
  - **Question parts — (a) (b) (c)** live on `block.part` (v1.234.0). A block carrying a part OPENS it and every block after it INHERITS until the next opener, so a text block asking (b) and the answer box under it are both part (b) without the answer box saying so. Read it with `qPartMap(blocks)` / `qBlockOpensPart(b)` / `qHasParts(blocks)` — never write a second walker.
    - **`block.part === QPART_NONE` (`'-'`) files a block under NO part** (v1.245.0) — it is how a note about the WHOLE question sits among the parts without lying about what it explains. It unfiles **that block only** and deliberately does NOT close the part (unlike a legacy `part` BLOCK), so an explanation in the middle of a question cannot detach every answer box printed after it. `qPartUnfiled(b)` is the predicate; the explanation block's header chip is a switch (`toggleBlockPartScope`) because only the author knows which of the two a given note is.
    - **An explanation explains the question printed directly above it**, and that is enforced for EVERY authoring path, not just one (v1.246.0):
      - **`qApplyAiParts(blocks)` runs inside `buildBlocksFromAi`** — the one function every AI authoring path goes through (Build from screenshot, Rapid add, the bulk PDF import, Regenerate copy, the exam paper builder) — so no path can be forgotten. Three steps in this order: `qSplitPartBlocks` (a text block holding "(a) …&lt;br&gt;(b) …" becomes one block per part), `qLiftPartMarkers` (a single leading marker moves off the text into `block.part`), `qScopeExplanations` (an explanation written for the whole question is split per part, or filed under none). The guards are what keep it safe: splitting needs `<br>` to be the only markup (`QPART_ONLY_BR_RE` — the cut is a source offset), lowercase consecutive letters, and no `mcq` block in the question; lifting inside an MCQ is allowed only on the question's FIRST text block, because every other lettered line down an MCQ is an option or a statement.
      - **The AI buttons write for ONE part.** `aiGenerateBlockExplanation` and `aiGenerateBlockAnswer` both scope their prompt to the part the box sits in — the shared stem plus that part, marked `>>>` by `_aiPartScopeLine`, with the other parts passed as labelled background they are told not to write. The explanation button used to send the whole question, which is how a note under (a) ended up explaining (b) and (c).
      - **Every build prompt carries `_partsPromptRules()`** — one marker per text block, an answer block per part, and one explanation per part placed after that part's answer. Keep the four prompts pointing at that one fragment (`_aiBuildQuestionPrompt`, `_bulkPagePrompt`, `_regenPrompt`, `_epQuestionPrompt`) rather than restating the rules, or they drift. `_serializeQuestionForRegen` tags each block with its part so a regenerated copy keeps them.
      - **`qPartUnfileLoneExplanation`** marks the single explanation of a question that is only LATER split into parts (`autoNumberParts`, `qPartApplyScan`) as a whole-question note, because it was written before the parts existed. The marker renders **beside** the question (`_qpTextHtml`, a flex row — `block.content` is authored HTML that usually opens with a `<p>`, so a prepended inline span would break to its own line anyway) and is **never repeated above the answer box**: it reaches the AI marker through `_openSection`'s trailing `part` argument, which feeds `items[].label` without drawing a chip. **There is also a legacy `type: 'part'` BLOCK** (imported from the worksheet creator, with `.label`/`.content`); `qBlockOpensPart` folds it into the same model, so `b.type === 'part'` and `b.part` are different things and read almost identically in review. The part label reaches the AI marker through `items[].label` in `_openSection` (that string becomes `Part: [(b) Claim]` in the prompt), and through `_partPromptText` / `_questionContext`, which **re-insert the marker** — it used to be characters inside the stem text and reached the model for free. `_openSection` escapes its label because it is now author-influenced.
    - Migration: **Question Doctor → 🔡 Question parts** (`qPartScanQuestion` / `qPartScanBank` / `qPartApplyScan`) converts typed "a)" markers into real parts, preview-first. `qPartDetect` matches a single letter **a–h** at the very start, parenthesised or not, closed by `)` or `.`, followed by whitespace. It stops at `h` on purpose (`i` collided with the roman-numeral sub-part `(i)`, which PSLE pairs with `(a)`/`(b)`), and a bare `X.` must be LOWERCASE (`E. coli` is prose, not part (e)). **`QPART_ASSIGN` is a separate, longer alphabet** for what the editor may ASSIGN (it only skips `i`) — detection has to be conservative about unvetted text, but an admin numbering by hand is not guessing. `autoNumberParts` must never write an EMPTY part: `qPartMap` inherits forward, so an unlabelled opener is filed under the PREVIOUS part and two answers end up sharing one heading — the very bug parts exist to prevent. It stops at the end of the alphabet and says so instead — and removes it from the ORIGINAL html (markers are often wrapped in `<strong>`, so a plain-text offset would cut through the markup). It refuses: a block holding 2+ markers, questions with no open-answer block, questions yielding fewer than 2 parts, and anything already using parts. `qPartWalkPlain`'s newline set must stay in step with `escapeHtmlKeepLines` (headings and table rows included) or a two-marker block collapses to one line and slips past that guard. **Apply re-resolves each question by id and checks the block still holds the scanned text**, then saves a COPY and only commits to `questionBank` on success — the preview survives navigation, so between scan and apply a question can be edited (a fresh object replaces the bank entry) or deleted, and writing the captured object back would undo the edit or resurrect the document. Don't loosen any of this without re-running the detection tests. `qPartAutoConvertInBackground` runs the same approved conversions automatically, once per load, four seconds after sign-in — the Doctor panel is for reviewing and for the cases the scan refuses, not a button anyone should have to remember.
  - **🎯 Learning objectives are filed from BOTH ends** (`lo*` in `app.js`, the 🎯 Learning Objectives page + the question editor's own field, v1.287.0). The objective list is the admin's own document (`users/{adminUid}/settings/learningObjectives`), seeded from `SYLLABUS_LO_TOPICS` — the Learning Outcomes of the MOE Primary Science Syllabus 2023 — and editable from then on. There are two ways into it and they are one system:
    - From the **objective's** end (the 🎯 page): open an objective and pick questions for it (`loOpenPicker`) or let `loAiFind` read the bank and suggest them. That writes `loData.map[loId] = [questionId]`.
    - From the **question's** end (the editor's 🎯 field, ported from the math app): **＋ Add objectives** opens `qLoPickOverlay` and **✨ Suggest** (`loSuggestForEditor` → `loSuggestLos`) reads the question and proposes objectives. That writes **`q.los`** on the question itself.
    - **`loQuestions(id)` reads both and dedupes**, which is what makes them one system rather than two: file a question from either end and it appears at the other. Anything that asks "what is already in this objective" must go through it — `_loCandidates` does, or the ＋ Add and 🤖 AI find pickers would offer a question that is already there. `loDetachQuestion` clears **both** ends for the same reason; leaving one puts the question straight back on the next render.
    - **Nothing is written until the question is saved.** The picker ticks into `_loPickerSel`, Apply commits it to `editorLos`, and `collectQuestionData()` puts `los` on the question — so a wrong guess from ✨ Suggest costs one glance. `los` is in `EDITOR_OWNED_QUESTION_FIELDS`, or `carryOverQuestionMeta` would restore an objective the author had just removed.
    - **`var editorLos`, not `let`** — the block sits near the END of the module and `navigateTo('create')`'s reset can reach `loEditorSet` before it is evaluated; a `let` would be in its temporal dead zone and take the whole app down. `loEditorSet`'s load call is wrapped for the same reason.
    - **`qLos(q)` drops an unknown objective at READ time, and only once the list has LOADED.** The list is a document, so a question opened before it arrives would otherwise come back from the editor stripped of every objective it had — and be saved that way. `_loOrderIds` keeps an unrecognised id at the end for the same reason rather than filtering it out. Run **`node tools/objective-tag-tests.mjs`** after touching any of it: every failure here is silent — the filing is simply gone, and nothing throws.
    - The chips and picker CSS are `.qlo-*` / `.qlop-*` and live **globally in `index.html`**, because the field is on the create page and `loStyles()` only ships with the 🎯 page. They are deliberately not `.lo-chip` / `.lo-pick-row`, which already mean a filter chip and a question row on that page.
  - **Leaderboard prizes** all live in `app.js`: `rpgPrizeBadge` / `rpgRowClass` / `rpgBoardNote` render them and `rpgCheckPrizeClaim` drives the month-end claim prompt. To run a game board for a month with NO prize, add that month key to `RPG_NO_PRIZE_MONTHS` (e.g. `{ td: ["2026-08"], spire: ["2026-08"] }`) — the board still ranks, but the badge, the row highlight and the claim prompt are all suppressed. The 🔥 Embers tab (`rpgBoardTab === "tcg"`) ranks by **questions answered correctly inside the games** (`rpgRowGameQ`, off the published `games` block) and pays the **top 6**. It ranked on `tcg.power` until v1.233.0; power is bought with 🪙 points, so the board could be climbed without answering anything — do not rank any board on a currency-derived stat. Keep it in sync with the board inside the TCG page (`tcgRenderBoard`, which no longer requires a published team of 5) and with the prize banner copy in `index.html`.
  - **The admin winners table** (Usage → 🎁 Prize claims, `_computePrizeWinners` / `renderPrizeClaims`) is where prizes actually get awarded, so EVERY board that pays a voucher must be listed there — questions, Defenders, Raiders, Spire, Strike, Ember Siege, Ember Legends, 🔥 Realm of Embers (top 6 by game questions answered correctly) and 🎴 Ember Duel (top 3 by duel questions × accuracy²). It reads whichever month the chips select (`setPrizeMonth`: last month, or the month in progress so a prize can be awarded on the 31st), pulling `month`/`monthLabel` or the rolled-over `last`/`lastKey` as needed, and skips any board in `RPG_NO_PRIZE_MONTHS` for that month. Adding a prize board without adding it here means a winner nobody can see.
  - **Ember Legends** (`elg*` in `app.js`, `.elg-*` CSS in `index.html`) is the arena-survival mode inside Realm of Embers: the student plays AS one of their cards (`elgHeroStats` reads `tcgOwnStats`, so both progression tracks count), and the horde is drawn from the other cards. **All card art and FX frames go through `elgKeyed`** — a canvas pass that flood-fills the baked backdrop (including the chequerboard on the FX frames) in from the border to real transparency and caches the cut-out (border-connected removal, so a pale core inside the art survives; unkeyable scenes resolve null); sprites start in the rounded `.boxed` frame (which crops the raw backdrop), step out of it only once their cut-out is in place, and then stand free with drop-shadow glows on the SPAN (so emoji-fallback sprites glow too — keep status filters off the `img`); shots animate the element's `fly` frames with an orb stand-in until keying finishes, and impacts play the `hit` frames (`elgImpactFx`). Never blit a raw frame. Question HTML comes out of the bank with its own dark-on-white colours, so `.elg-quiz-q *` force-overrides colour and background — keep that or the stem goes invisible on the dark panel; `_tcgBankQuestions` carries each question's explanation block into `ex` (entity-decoded via `_htmlPlainText`, since consumers escapeHtml it again) — shown after answering here and in the trainer; the Siege deliberately does not show it (its quiz auto-advances too fast to read one). Skill trees belong to the **role** (`ELG_TREES`, keyed by `ELG_ROLE_BY_KIND` off the card's battle-skill kind), never to the individual card — add a node to a tree, not to a monster. Each tree is a radial WHEEL of 60 nodes over 6 rings (20 hand-written notables + 40 generated smalls from `ELG_SMALLS`/`ELG_SMALL_TIERS`) ending in two capstones; skills LEVEL — `r.tree[id]` is a number, capped by `elgNodeMax` (actives 3, one-of-a-kind mechanics 1, everything else 5; `elgPassives` multiplies `fx` by level, `elgCast` scales +30% power / −8% cd per level). Layout is `elgTreeLayout` (polar percent coords on a square map, links in an SVG 0-100 viewBox), reading/buying happens in the `elgRenderNodeInfo` panel (`elgTreeSel`). Unlocking is by **dependency links** (`ELG_REQS`: every non-T1 node names the node it grows from, one tier down — `elgNodeReachable` gates buys and `elgDrawTreeLinks` draws the SVG connectors); a new node MUST get an `ELG_REQS` entry or it is free-floating. An `act` node becomes a button on the skill bar (hotkeys 1–9 in bar order, T toggles the tree) and its `kind` must be handled in `elgCast` (nova/beam/storm/heal/shield/frost/zone/volley/dash/buff/orbit/aura/summon/chain), an `fx` node is a passive summed by `elgPassives`. 7★ heroes get a run-defining passive from `ELG_LEGEND_PASSIVES`. Beta-gated on `tcgConfig.legendsReleased` (`elgReleased` / `elgSetReleased`) — **released by default**: only an explicit `legendsReleased: false` hides it from students; while it is in beta the ⚔️ Legends board tab and its prize line stay hidden. Scores publish through the ordinary game-score path (`gameScores.legend` → `rpgGameBoardData("legend")`), and the board pays the **top 5** (`rpgGameTopN`).
  - **Card sets and the National Day expansion** (`TCG_GEN2` / `TCG_SETS`, v1.251.0). The dex is built by flattening `TCG_GEN1` (151 monsters, `c001`–`c151`) and THEN `TCG_GEN2` (50 humans, `c152`–`c201`). **Ids are positional and live in every student's save** (`s.cards`, `merges`, `levels`, `team`, and the `tcgArt` overrides) — a new set must be APPENDED and gen 1 flattened first, or every collection in the school silently re-points at different cards. The National Day set is the **Lionheart Legion**: entirely human — warrior, paladin, wizard, sorceress, mage, warlock, necromancer — so its rows carry `class` and `sex` (and an optional per-card art note), and each card gets `human: true`. That flag is what switches `tcgCardArtPrompt` to `_tcgHumanArtPrompt` (draw a PERSON, with `TCG_CLASS_LOOK` per class) and re-words `tcgAvatarPrompt` ("keep the face, hair, armour, robes identical" instead of "keep the species and horns"). The human prompt's COMPOSITION / HARD RULES lines are deliberately **identical** to the monster prompt and its STYLE line says out loud that the card belongs to an existing painted set — a model given "fantasy warrior" with no other steer drifts into a different rendering style card by card, and the expansion has to sit in the same binder. Nothing else about art generation is new: the Card Art tab already walks `TCG_CARDS`, so every new card gets its 🃏 card-art and ⚔️ battle-avatar slots with paste / drop / upload / ✨ AI, and the avatar is still drawn FROM the card art.
  - **Nothing that stands on nothing may keep a background** (v1.254.0) — battle avatars, element projectile frames and booster-pack frames. The rule is now enforced at the point of GENERATION rather than by guessing afterwards, because guessing is what hollowed a pack out: the model was asked for "empty", painted a near-black plate, and the cutter could not tell that plate from the pack's own dark navy panel (21 colour units apart, inside a tolerance of 30) — so the moment the packet was torn open the fill walked in through the tear and ate the interior. **`tools/bg-cut-tests.mjs` and `tools/chroma-key-tests.mjs` reproduce every case below against the real functions — run them after touching any of this.**
    - **The chroma screen is the primary path.** An image model has no alpha channel: it MUST put a value in every pixel, so "leave it empty" is not an instruction it can follow and it invents a backdrop from context. `_screenRules(subject, screen, harder)` instead briefs ONE flat, named, fully saturated wall (`TCG_SCREENS`), and `_screenKeyOut` keys exactly that hue. That is a fact about COLOUR, not connectivity — so screen showing through a tear keys for the same reason the corners do, and a dark panel inside the pack never keys at all, wherever it sits. **The screen is chosen per subject** so it cannot occur in the art: `TCG_SCREEN_BY_ELEMENT` (magenta, green for the violet/pink elements, blue for the green ones) and `tcgScreenForSet` (the National Day set is red-and-white heraldry, so green).
    - **A WIDE effect needs a different ring test** (v1.277.0). The border-ring precondition below assumes a subject that stands clear of the edges. A duel zone wall does the opposite — it fills the frame left to right by design — so only the top edge is left on the screen, the whole-ring test refused at ~50%, and the frames were saved with a band of magenta still across the top. A slot marked `wide` (threaded from `DUEL_FX_SHAPES[].wide` through `_tcgGenClean`) relaxes the ring to `TCG_SCREEN_RING_WIDE` **but must still show one WHOLE edge** at `TCG_SCREEN_EDGE_MIN` — that is what keeps it evidence of a wall rather than a licence to key anything containing the hue. The wide prompts also now ask for a clean band across the top, so there is always an edge to prove it by.
    - **✏️ Touch up is the SAME editor as the question adder's** (`tcgTouchUpSlot` → `_annotOpenSrc`, v1.278.0). `openAnnotTool` was split: `_annotOpenSrc(srcPromise, target, title)` opens the editor on any picture, and `target` says where **Apply** writes it back — `{ blockId }` for a question's image block or `{ artSlot }` for a Realm of Embers slot. Every slot with a picture gets the button, card art included, so erase / paint / fill / clone / history / select / lasso / wand / move / resize / rotate / skew / straighten / line / text / AI content-aware fill all work on game art with **no second editor** existing to drift out of step with the first. Add a destination by adding a branch in `applyAnnotTool`, never by forking the tool.
      - An art slot is saved with **`{ cleaned: true }`** — the admin has just spent time on this picture in an editor, so `_tcgArtStore`'s automatic background cutter must not run behind them and second-guess it. 🧼 Remove background is on the same slot for when they do want it.
      - **Erasing CUTS rather than paints white** when the editor was opened on an art slot (`_annot.eraseTo`, v1.279.0), and the ⬜/▨ button in the toolbar flips it. A scanned question is paper, so rubbing a word out means painting it white; a sprite stands on nothing, so erasing must mean erasing. **Four things follow the setting** — the erase brush (`_annotPaintCompose`, which switches the canvas to `destination-out`), the paint bucket, the hole the Move tool leaves (`_annotSelLift`), and the corners a whole-picture rotate opens up. Miss one and a sprite comes back boxed in white.
      - **`_annotPaintCompose` sets the composite mode for a WHOLE stroke** — the drag continues in `pointermove` against the same context — and `_annotUp` puts it back. `_annotSetTool` resets it too: a canvas stranded in `destination-out` erases everything drawn afterwards.
      - **Delete cuts the selection to transparent** (`annotSelDelete`, the Delete/Backspace key and the 🧽 button). With the 🪄 wand's Alt+click, which selects a colour across the WHOLE picture, that is the one-step "remove every pixel of this colour" the art slots need. A polygon selection is cut with a real clip so the edge is anti-aliased; a wand mask is cleared pixel by pixel.
      - The save path is **PNG end to end** and must stay that way: `toDataURL('image/png')` → `_scaleDownDataUrl` (which re-encodes as PNG, or returns the original untouched when it is already small enough) → `uploadImageDataUrl`, which takes the extension from the data URL's own mime type. Any JPEG step anywhere in that chain flattens the alpha to black.
      - **The brush cursor is a RING at the real size of the mark** (`ANNOT_RING_TOOLS` / `_annotUpdateBrushRing` / `_annotTrackPointer` / `_annotBrushFlash`, v1.285.0). A brush whose size you can only read as a number on a slider is a brush you are guessing with — "12 px" at 40% zoom is a quarter of the mark "12 px" makes at 400% — so erase, paint, clone, history and line draw their footprint under the pointer at the current zoom, and the system cursor is hidden under it. The tools that take no size (fill, wand, select, lasso, move, the transforms, text) show no ring: a circle round a paint bucket would be a lie, and `_annotUpdateBrushRing` only ever touches `canvas.style.cursor` for a tool that IS in `ANNOT_RING_TOOLS`, or it would fight the resize handles' own cursors. The ring lives in the STAGE like the clone-source pin, never on the canvas (which is scaled and panned underneath it), and `_annotUpdateTransform` redraws it because the size on screen is `size × displayScale`. Under `ANNOT_RING_TINY` screen px it draws a crosshair instead — a 3px circle is a blob. `_annotSyncControls` is the ONE place every route to the size lands (slider, wheel, `[` / `]`), so the "12 px" badge flashes from there; with the pointer away it previews in the middle of the view, because a size change that only moves a number on a slider is the thing this fixes. **`math`'s `index.html` carries the same editor — keep the two in step.**
      - **A picture can be PASTED straight in** (`_annotPasteHandler` / `_annotPasteImage` / `annotPasteFromClipboard`, v1.286.0). Ctrl+V — or the 📋 button, for the browsers that will let a page read the clipboard — drops whatever is on it onto the canvas, scaled to **fit inside** what it is landing on (`ANNOT_PASTE_FIT`, 90%, never blown up past its own pixels), and opens the transform box on it with **Resize already the tool in hand**, so the eight handles are live from the first moment: drag a corner to size it, drag the middle to move it, then ✓ Apply. That is the PowerPoint gesture, which is the one everybody already has in their fingers.
        - It is its **own transform scope, `paste`** — not a selection lift. The pixels do not come off the canvas, so `base` is the picture untouched and Cancel (or Esc, or the history step taken on arrival) leaves no trace of it.
        - **`_annotXformIsIdentity` must return false for a paste.** A picture dropped at 100% and 0° is otherwise read as "nothing to do", and both ✓ Apply and the settle-on-tool-switch in `_annotSetTool` would silently throw it away. That is the one bug this scope can produce, and it looks exactly like the paste never happened.
        - The layer keeps the pasted picture at its **own** resolution (capped by `ANNOT_PASTE_MAX_PX`) and the fit is carried by the transform's `sx`/`sy` — so dragging a handle back OUT resamples from the full bitmap instead of magnifying an already-shrunken one.
        - The handler is bound in **capture** (`_annotBindZoomListeners`) and unbound with the editor, because the exam paper builder, Mark Paper and the contenteditable guard all listen for `paste` on the page underneath the overlay. A label being typed keeps its own paste — pasting words into a text box is the other honest meaning of Ctrl+V in here.
      - The canvas keeps its **alpha**, so an already-cut sprite is edited transparent; `#annotCanvas` wears a grey check so the empty parts are visible. That is the EDITOR's backdrop, not something painted into a picture — unrelated to the chequerboard an image model paints, which is still banned in prompts.
    - **🧼 Remove background is the manual override** (`tcgCleanSlotBg` / `_tcgPlateColour` / `_tcgKeyPlate`, v1.277.0) — a button on every slot that stands on nothing, plus one per duel-FX run. The automatic key REFUSES rather than risk holing the artwork, and a refusal means the frame is saved with its plate still in; the admin can see the colour that sticks out, so they get to say so. It finds whatever flat colour the border is actually made of (any colour, not just the three named screens) and removes exactly that: still a colour test, never a flood fill, so it cannot walk into the artwork through a gap. Evidence of a plate mirrors the keyer — `TCG_PLATE_RING_MIN` of the whole border **or** `TCG_PLATE_EDGE_MIN` of one edge. It refuses when the result would keep less than `TCG_BG_KEEP_MIN` of the artwork, which is the one failure a background remover can produce that looks tidy and has destroyed the picture.
    - **Do NOT ask a model for a transparent background.** The request comes up every time someone sees a coloured plate, and it makes things worse — an image model has no alpha channel, so "transparent" is painted rather than honoured, as a chequerboard or a flat plate. `TCG_BANNED_PROMPT_RE` flags the words. The chroma screen exists precisely because it is the only instruction a model CAN follow; when a plate survives, fix the KEY (above) or press 🧼, never the prompt.
    - **An enclosed patch of screen colour is a HOLE or it is PAINT, and the test is GEOMETRY** (v1.280.0). The strict guard used to count every screen pixel not connected to the border as "the model painted the key colour onto the subject" and refuse the whole key. A **ring** — a brooch, a torc, an ankh's eye, a lens in a bezel, a shield dome, a rune circle — has real wall showing through a hole that never touches the border, so it was refused and the picture shipped with a solid disc of screen colour in it. That is the Iron Pin bug.
      - Colour cannot separate the two: a flat patch painted in the wall's colour *is* the wall's colour, and an absolute RGB comparison against the border also breaks on a vignetted wall, which is the commonest way a model misses "flat". So each enclosed region is **measured**: `shell` (the thinnest crossing of subject material between the region and the real background, from a chamfer distance transform) against `rad` (the region's own inscribed radius). A ring is **mostly hole** — `shell <= rad * TCG_HOLE_SHELL_MAX`. Paint is a patch deep inside a mass and fails by a wide margin.
      - The `dn` mean/spread vetoes (`TCG_HOLE_DN_MIN` / `TCG_HOLE_DN_SD_MAX`) are the SECOND line, not the first: a real painted gem is faceted and specular so its spread gives it away, but a synthetically flat one would not — and `dn` is brightness-normalised, so both stats survive a vignette. `TCG_SCREEN_HOLE_MAX` keeps its value and now budgets **paint only**.
      - Two harness cases pin the rule from both sides: a ring's interior must key, and the same patch inside a THICK body must still be refused. Known limit, unchanged: a flat gem painted in exactly the wall colour inside a thin bezel is the same pixels as a ring and cannot be told apart — the defences there are the per-element screen routing and the prompt.
    - **`_bgLeftover` only ever inspects the border ring and the corners**, so it is structurally incapable of seeing a plate in the MIDDLE of a frame — a disc walled in behind a ring sailed past it and was saved. `_tcgGenClean` now also asks **`_screenStillThere(url, screen)`**, which is a whole-frame question with no false positives: the subject is briefed never to contain the screen colour, so any of it left anywhere is background that was not removed.
    - **Only the plate keyer can reach a colour walled in behind the artwork.** Every other cleaner here (`_stripImageBackground`, `_tcgForceClean`, `_recleanStoredArt`'s first two steps) is seeded from the frame edge and cannot get inside a closed ring. So `_tcgKeyPlate` gained `_tcgEnclosedPlateColour` — the largest connected block of one flat colour that is **walled in**: every pixel surrounded by paint, never touching the frame edge or transparency. That predicate is what makes it safe, because the subject *always* meets the transparency cut away around it and so can never be mistaken for a plate, however big or flat. `_tcgPlateColour` also stopped counting transparent border pixels in its denominator, which had made its thresholds unreachable on exactly the already-cut frames the 🧼 button is for. The 🧽 repair sweep runs the plate keyer too, so art already saved dirty is fixed without redrawing it.
    - **Three preconditions gate the key, and they are why it is safe**: enough of the frame is the screen colour; the BORDER RING is ≥90% screen (containing the hue is not the same as being shot against it); and for a strict slot no more than `TCG_SCREEN_HOLE_MAX` of the frame is screen colour ENCLOSED inside the subject (the model painting the key colour into the art). Any of them failing falls back to the cautious knock-out — never to a hole. Known limit: key colour on the subject's OUTER edge is contiguous with the wall and no colour test can separate it; the routing table and the prompt are the defence there.
    - **Store the keyed frame, chain the SCREEN one.** A model cannot read alpha — hand it the keyed PNG and the canvas flattens it to solid black, so it is shown a sprite on a black plate and told that is the background. `_tcgGenClean` returns `{ url, ref }` and every run stores `url` and chains `ref`; a frame reloaded from storage goes through `_tcgRefOnScreen` → `_screenBack`, which composites it back onto its wall. The prompt asserts the reference is on the screen, so it must actually BE on the screen — `_screened()` exists to keep that true on the fallback paths too.
    - **The knock-out is still there for legacy and pasted art, and it is what got the guards.** `_BG_STEP_TOL`: a pixel is background only if it is ALSO a small STEP from the pixel the fill arrived from — backdrops are smooth, the edge of a subject is not. Emptiness must not conduct: only pixels that were ALREADY empty when the call started pass freely, and stepping out of emptiness into paint has to land within `_BG_SEED_TOL` of the plate itself. `_cutHoleArea` throws the whole pass away if it took painted pixels that are not reachable from the frame edge, and `_tcgForceClean` rejects a forced cut that costs more than `TCG_BG_KEEP_MIN` of the painted pixels. Nothing checked the SUBJECT survived before v1.254.0 — a hollowed sprite is the cleanest possible result to a background detector.
    - **The chequerboard cutter is the other way a sprite gets deleted**, and it runs first with none of the fill's guards. Three fixes: a chequerboard is a BACKGROUND, so `_checkerOnBorder` requires the pattern to be on the frame edge (scale armour and a woven inner panel are not); `_nearNeutral` measures saturation rather than an absolute spread (a dark navy is not "near enough to grey"); and cutting needs positive evidence of alternation — the old "isolated speck, bias to cutting it" clause deleted an already-cut sprite on the second pass, because every probe landed on transparency. `sq` is capped at a twelfth of the short side.
    - **Every picture goes through the cutter more than once** (generate, store, display, repair), so the already-a-cut-out early-out runs FIRST, before the chequer stage, and `_tcgArtStore` takes `{ cleaned: true }` from the generate paths. Card art and `set:` banners are never cut at all.
    - **`_bgLeftover(url, strict)` is the background check.** `strict` means "this sprite must stand clear of the edges": a still-opaque border ring or a filled CORNER is a backdrop whatever colour it is, which is what catches gradient and vignette plates. It is on for avatars and pack frames, and off for the FX `blast` phase and pack frames 5–6, whose brief is to fill the frame.
    - **Never say "transparent", "chequerboard" or "alpha channel" in a prompt** — a model paints the word rather than honouring it. `TCG_BANNED_PROMPT_RE` logs it in `tcgGenArtImage` if one creeps back, which is how two of them survived in animation step descriptions. And never ask the ENGINE for transparency while briefing a screen: `background:'transparent'` on gpt-image-1 knocks out interior regions of the subject that match the background — the same bug from the other direction.
  - **The rip stage must never borrow `.tcg-pack-<tier>`** (v1.253.2). Those classes carry the shop CARD's border and its `0 0 0 1px` box-shadow ring, so using them on the overlay just to pick up `--halo` drew a rectangle around the pack. The stage uses `.tcg-rip-<tier>`, which sets `--halo` and nothing else.
  - **The pack-opening face is the ART and the RARITY** (v1.253.1) — `tcgCardHtml(card, {reveal:true})` adds `.reveal`, which squares the art off (`aspect-ratio: 1/1`), grows the star pips, spells the rarity out (`TCG_RARITY` / `tcgRarityHtml`, coloured per tier) and shrinks the stats to a footnote. The skill text, both level tracks and the affinity triangle are **not rendered at all** on that face — every one of them is still on the Collection card, which is where a student reads them at leisure. **There is no confetti on a pack**, on the tear-open burst or on a 7★ flip: paper falling over a legendary cheapens it. `tcgConfetti` survives for winning an arena battle, which is earned.
  - **A set is BILLED, not just listed** (v1.253.0). Each entry in `TCG_SETS` carries a `series` line, a `title`, a `sub` and an `art` direction: the original dex is **Primal Dominion**, and the National Day expansion — entirely human — is the **Lionheart Legion · Rise of Humanity**. The Packs tab opens with one banner per set (`tcgSetPickHtml` → `.tcg-setpick`): the set's own artwork behind, the series line over the title, and the set's **7★ legends** (`tcgSetHeroes`) lined up along the bottom with their card art in them, so a student can see what they are chasing before they spend a point. Every pack card repeats the chosen set (`.tcg-pack-from`) because that is the moment the points actually go.
    - **The set NAME is never drawn by the AI.** `tcgSetArtPrompt` asks for a clean picture and the name is set in **Cinzel** over it (`.tcg-setpick-title`, gradient-filled) — an image model asked for lettering returns gibberish, and gibberish across the top of the Packs tab is worse than no artwork. Cinzel is already in the ONE font request; do not add another for a set name.
    - The artwork lives in the ordinary art slot `set:<key>` — paste / drop / upload / ✨ AI on the Card Art tab like every other slot — and is drawn **from the set's own 7★ card art**: `_tcgSetRefSheet` composites those cards into one line-up because `tcgGenArtImage` takes a SINGLE reference picture, which is what keeps the legends on the banner the same characters as the cards. No 7★ art yet → no sheet, and the model works from the words alone. `set:` slots get the biggest `maxSide` (768) in `_tcgArtStore` and are NOT background-stripped — a banner keeps its painted scene.
  - **Booster packs are SET-SCOPED, and each one tears open on screen** (`tcgPackSet` / `TCG_PACK_STEPS` / `tcgShowReveal`, v1.252.0). The Packs tab carries a set chooser, and `_tcgRollCard(odds, setKey)` pulls only from that set — that is what lets a student chase the National Day cards instead of hoping. An empty pool falls back to the whole dex rather than returning `undefined` and killing the open. Note the side effect: scoping the pool makes a given set's 7★ easier to land on a 7★ roll (2 of 2 rather than 2 of 5), so retune `odds` rather than the pool if that ever needs pulling back.
    - **The opening animation is 7 frames per set × tier** (`pk:<set>:<tier>:<n>`, 2 × 3 × 7 = 42 slots), authored on the Card Art tab exactly like the element FX: every frame is drawn **FROM the one before it** (`_tcgPackRunFrames`), because seven independently-drawn pictures of a packet are seven different packets. `tcgPackFramePrompt` therefore says outright that the pack must not move, resize or be redesigned between frames, and carries the same anti-chequerboard paragraph the FX and avatar prompts do.
    - **A pack stands on NOTHING** (v1.252.1) — just its own `--halo` glow — so pack frames join the battle avatars and the element FX in `_tcgArtStore`'s background knock-out (`_stripImageBackground`), and `_tcgGenPackClean` mirrors `_tcgGenFxClean` exactly: cut the backdrop out BEFORE the picture is chained onward (the next frame is drawn *from* it, so a plate left in is copied through the whole tear) and check the result with `_bgLeftover`, redrawing once with a blunter prompt rather than saving a dirty frame. Frames drawn before that existed are repaired in place by the shared 🧽 **Clean painted backgrounds** sweep (`tcgRepairArtBackgrounds`, now covering `pk:` too, and falling back to `_urlToDataUrlRobust` when the Storage fetch taints the canvas) — the button sits in both the FX and the pack panel and is found by class, not id. Until someone presses it the two STUDENT surfaces cut the plate out for display only (`_tcgPackImgHtml` + `tcgKeyPackImgs` → `_tcgPackDisplayClean`, which runs the SAME cleaner the generator does — two cleaners disagreeing is how a plate ends up on screen that the admin panel swears is gone); the admin's Card Art thumbnails are deliberately left RAW, because that panel is where the plate has to be visible or nobody would know to press the button.
    - **A partial run never plays.** `tcgPackAnimReady` requires all 7; anything less and `tcgShowReveal` falls straight through to `_tcgShowRevealCards`, which is the old behaviour. Half a tear looks broken, and this is what keeps the feature safe to ship before any art exists.
    - The tier **halo** (bronze / silver / gold) is one CSS custom property, `--halo`, set on `.tcg-pack-<tier>` and painted by a `::before` ring *behind* the art — so a generated PNG gets the same halo the inline SVG placeholder does, and the rip overlay reuses the same variable.
  - **👁 What a monster does in THIS game** (`tcgPeekOpen` / `tcgPeekHtml` / `tcgEyeHtml`, `.tcg-peek*` / `.tcg-eye` CSS, v1.273.0). One monster means four different things: Crystal Aegis is a shield in the Battle Arena, a 🛡️ Wall that blocks a lane in Ember Siege, a Warden's skill tree in Ember Legends and Divine Shield in a duel. Printing all four wherever a card appears is how a student learns to ignore the text, so **every picker shows exactly ONE — the one that fires in the game they are standing in**: `arena` → the printed arena skill, the arena stat block and the affinity matchups; `siege` → the lane behaviour (`emsBehaviour`/`emsRole`, never the arena skill, because the Siege *translates* it) plus the summon's cost / HP / attack / recharge; `legends` → the role whose skill tree the points go into, the hero's own body, and the 7★ passive. Adding a mode is a row in `TCG_PEEK_MODES` plus a branch in `tcgPeekHtml`.
    - **The pack reveal is the ONE place that shows all four at once** (`tcgAllModesHtml` / `tcgRevealDetail`, `.tcg-reveal-side` CSS, v1.283.0). A picker answers "what does this do in the game I am standing in"; a pack answers "what have I just won", and the honest answer to that is every mode. Hovering a flipped card fills the panel beside the cards — which is what the reveal's empty right-hand side was for — with the arena skill and stat block, the duel ability and its 4/4, the Siege lane behaviour, and the Legends tree, plus the artifact's effect at its current level.
      - `_tcgModeBodyHtml(card, mode)` is the shared body builder both surfaces call, so the two can never disagree; `tcgPeekHtml` is head + ONE body and `tcgAllModesHtml` is head + all of them. Adding a mode is a row in `TCG_ALL_MODES` on top of the `TCG_PEEK_MODES` entry.
      - **The panel is its own SCROLL REGION, and that is the fix for both of the bugs it shipped with** (v1.283.2). `.tcg-reveal-inner` is a column — the title is fixed and the two columns under it scroll independently — because when the whole overlay was one scroller, reading down the panel scrolled the CARDS, which dragged the cursor across a different card, which replaced what was being read. Two guards close the rest: any wheel/scroll/touchmove inside the overlay freezes the hover swap for `TCG_REVEAL_SCROLL_HOLD`, and **clicking a flipped card HOLDS the panel on it** (`_tcgRevealPin`) until it is clicked again. `overscroll-behavior: contain` stops a wheel running off the end of the panel from carrying on into the cards.
      - **A face-down card shows nothing.** The flip is the moment, and printing the answer beside an unflipped card gives it away — `tcgRevealDetail` returns the empty state until `.flipped` is on.
    - It opens on a **click of the 👁, never on hover**. These pickers are used on school phones mid-battle — the Siege deck tile is 54px and its only previous description was a browser `title` tooltip, which touch can never reach.
    - The 👁 goes **outside** the tile on the Siege and Legends pickers (`.ems-card-wrap` / `.elg-pick-wrap`): both tiles are `<button>`s and a button may not contain a button. On a full `tcgCardHtml` card it goes inside (the root is a div) via `opts.eye`, and it must `stopPropagation` — the card's own click adds or drops the monster from the team.
  - **🌋 Ember Siege — NO question is timed** (`EMS_MANA_CORRECT`, v1.272.0). The ⚡ Generate mana panel used to carry a draining speed bar worth up to `EMS_MANA_SPEED` of extra mana, so a student who read a long stem properly earned less than one who guessed at it — the opposite of what this app is for, and the same mistake the rushed-answer guard exists to prevent. There is now **one flat rate** (`EMS_MANA_CORRECT`, the full rate the untimed wave round already paid) in the wave round and mid-battle alike; `EMS_FAST_MS` / `EMS_MANA_BASE` / `EMS_MANA_SPEED` and `emsQuizSpeedTick` are gone. Do not reintroduce a clock on the question: the mode keeps its pressure from the **horde**, which walks on the gate while the panel is open, so thinking still costs ground on the field — it just no longer costs mana. `ms` is still measured and still passed to `rpgAwardGameQuestion`, because that is the rushed-answer guard and it is a different thing entirely.
  - **Adding a skill `kind` touches FIVE places** and `tcgStats` **throws** if you miss one: `TCG_SKILLS` (the skill), `TCG_ROLE_MODS[kind]` (the stat spread — this is the one that throws), the arena resolver's if/else chain in `_tcgAct`, `ELG_ROLE_BY_KIND` (Ember Legends' skill tree) and `EMS_SKILL_FX[kind]` (Ember Siege). The Siege entry must reuse an **existing lane `mode`** — the mode is what the siege engine actually implements, so a new kind gets its own label and tuning without new lane behaviour. The National Day 7★ pair added `slay` (Dragonfall Execution — one blow, ignores DEF, plus `exec` × the target's MAX HP dealt straight to hp and never lethal on its own) and `frostreign` (Winter's Crown — hits the whole enemy team and stuns all of it).
  - **The game's full name is the "Realm of Embers Trading Card Game"** (v1.256.0) — the page header, the release banner and post, the release/beta confirms and toasts, the admin banner and the How to Play title all spell it out. "Realm of Embers" alone is still right where space is tight (the nav item, the guide's prose, the theme class); "Realm of Embers TCG" is not used in any user-facing string any more. **`tcgCreditsHtml()`** is the colophon that closes BOTH the 📜 Lore tab and the 📘 How to Play tab — the two places a student is reading rather than playing — crediting **Polymath Learning Centre** as the organisation that built the realm and **Mr Chung** as its Game Master. The names live in `TCG_CREDITS`, so a rebrand is one edit; the seal wears the realm's logo when one has been drawn.
  - **Ember Duel** (`duel*` / `DUEL_*` in `app.js`, `.duel-*` CSS in `index.html`, v1.262.0) is the Hearthstone-style card duel inside Realm of Embers: two heroes on `DUEL_HERO_HP` (30), a mana crystal a turn to `DUEL_MANA_CAP`, minions summoned onto a board of `DUEL_BOARD_MAX`, spells, and an attack made by **dragging** one of your cards onto one of theirs. Three things carry the design:
    - **A card keeps its arena skill and GAINS a duel ability**, generated from the same `TCG_SKILLS[...].kind` that skill already uses (`DUEL_ABILITIES` → `duelAbility(card)`). Nothing is written per card, so all 201 have one and a future set needs nothing added. **`duelAbility` must keep its `|| DUEL_ABILITIES.strike` fallback** — a new skill kind added to `TCG_SKILLS` without a row here would otherwise be a crash on the play path (the same trap as `TCG_ROLE_MODS`, which throws).
    - **Two legends must not do the same job.** Aeonyx's `chrono` was a bare "freeze every enemy minion", which made the keeper of the Ember a strictly WORSE Ariselle — she freezes the board too, *and* deals damage, *and* brings Taunt (v1.265.0). They now read as different cards: **Ariselle is the WALL** (Taunt, freeze, chip), **Aeonyx is the TURN ITSELF** (freeze, bigger damage, and `me.mana = me.cap` — nothing else in the realm gives a student their mana back, which is what "time runs back" has to mean). Check a new signature against the others before shipping it: a 7★ that is a subset of another 7★ is a bug, not a balance choice.
    - **Rarity IS power, and `card.stars` is the only knob.** Each row's `v(stars)` turns the star rating into the ability's numbers, and `duelCardStats` prices the card at `stars + 1` mana. Retune the `v` functions, never individual cards. `DUEL_ATK_MAX` / `DUEL_HP_MAX` cap a fully trained 7★ — keep the caps; the divisors are the tuning knob.
    - **It is DEFAULT-CLOSED**, and that is the one thing not to copy from Ember Legends: `duelReleased()` uses `tcgReleased`'s `!!` shape, NOT `elgReleased`'s `!== false`. `_tcgConfig` is null until the config load resolves, so `!!` fails CLOSED and a student never gets a flash of a mode still being play-tested. The admin's **🚀 Launch to students** button on the Game Modes card is the only way it turns on.
    - **The effect queue is load-bearing.** `duelRender()` replaces the whole shell's `innerHTML`, so an animation started while the rules are still resolving is destroyed the instant the board repaints — which is exactly what happened to the attack animation first time round. `duelFx` / `duelFxHero` / `duelAttackFx` therefore only QUEUE (`r.fxq`); `duelRender()` flushes them against the DOM it has just painted. For the same reason `duelKill` marks a minion `dead` (rules) **and** `dying` (still drawn), and `duelReap` sweeps it 480 ms later — **every rules query filters `!m.dead`, only the renderer shows `dying`**.
    - The drag is built on **pointer events**, not HTML5 drag-and-drop, because `dragstart` never fires on touch and this is aimed at school phones; `duelHitTest` compares live rectangles rather than using `elementFromPoint` (the dragged card sits under the pointer and would swallow every hit). There is always a **tap-select → tap-target** fallback, which is also how spells choose a target.
    - **A card RANKS UP every `DUEL_RANK_EVERY` (10) training levels** (v1.264.0) — one upgrade each, nine in a card's life, and this is the only way levels reach the duel. Elsewhere a level is a smooth 1.5%; in a duel a card is 4/3 for 2 mana and a number that reads the same after fifty questions has rewarded nobody, so the levels are spent in STEPS instead. `duelCardStats` therefore takes its base at **Lv1 with merge levels** (the ⟡ track still counts) and adds `duelRankUp` — never both, or the smooth curve and the steps double-count and the caps swallow both.
      - **`DUEL_RANK_TRACKS` says WHAT each step gives and `DUEL_RANK_GAIN` says HOW MUCH**, both per star tier, and together they are the "more dramatic for the rarer ones" requirement: a 1★ collects +1s and finishes near 6/6 for 1 mana; a 7★ gains +3/+3 a step, **two** mana discounts and **three** ability boosts, going from 10/8 @8 to **16/14 @6** with roughly double the battlecry. Retune those two tables, never `DUEL_ATK_MAX`/`DUEL_HP_MAX`, which are only a safety net now.
      - `duelNextUpgrade` is what the builder shows ("Lv40: 💧 −1 mana cost") — a student should always know what they are working towards. A mana discount can never take a card below **half** its rarity price, or a trained 7★ would cost what a 1★ does.
      - `duelAbility(card, level)` takes the level so the `pow` steps land on the ability text as well as the maths — pass the level at every call site, and read a board minion's own `m.ab` rather than resolving a fresh unranked one. `duelRefreshBoard` applies a rank crossed MID-duel as a **delta** against what the card was worth when summoned, so it never wipes a War Cry buff or heals damage already taken.
    - **🎇 Every skill has its own animation** (`DUEL_FX_SHAPES` / `DUEL_FX_BY_KIND` / `duelZoneFx` / `duelFxForKind`, slot `dfx:<shape>:<element|any>:<n>`, `.duel-zonefx` CSS, v1.275.0). A duel is fought on **zones**, not lanes: a battlecry that hits "ALL enemy minions" happens across the whole opposing row at once, which is the wrong shape entirely for the element FX above (those animate a projectile crossing a lane). So the duel has its own authored set on the Card Art tab.
      - **Two axes, and the split is what keeps the set finite.** The two ELEMENTAL shapes (`sweep`, `strike`) are drawn once per element — a fire wall and a frost wall are different pictures, and that is the whole point. The other eight are drawn **once for everybody**, because healing light is golden whatever the monster is made of. That is ~108 slots instead of ~360.
      - **`DUEL_FX_BY_KIND` must cover every skill kind** — the 15 in `DUEL_ABILITIES`, the 9 spell kinds and the 5 hero-power kinds. A kind missing from it simply gets no animation, which is deliberate: unlike `TCG_ROLE_MODS` this can never be a crash. Each row also says what it plays OVER (`foe` / `mine` / `target` / `self` / `hero`).
      - **The dispatch for a minion lives in `duelCommitPlay`, NOT in `duelResolveBattlecry`** — that function returns early for a PASSIVE ability, so dispatching there meant Divine Shield, Poisonous, Lifesteal and Rush never animated at all. A kind with no row falls back to the arrival rune, so every summon shows something.
      - **The effect must be LONG enough to look at** (v1.276.0). The first pass held every frame for 110ms, which put a four-frame wall of fire on screen for under half a second — the art was gone before anyone could see what it was. Three numbers set the pace and nothing else knows about them: `DUEL_ZONEFX_MS` (base hold), `DUEL_ZONEFX_PEAK` (the brightest frame — always the 2nd, the one every prompt describes as "brightest of the three/four" — is held 2.4× longer, which is what makes an effect read as a MOMENT rather than a flicker) and `DUEL_ZONEFX_FADE`. A shape's own `pace` scales it: the board-wide wall runs slowest (~2.2s) and the arrival rune fastest (~1.0s), because that one fires on nearly every summon. The CSS fallbacks are driven off the SAME computed duration via `--zfx-dur`, so the pace of the mode does not change on the day a shape's art lands.
      - **The layer lives in `#duelOverlay`, not in the board.** `duelRender()` replaces the whole shell's innerHTML on every action, so an effect parented to a board row or a card is destroyed the moment anything else happens — survivable at 440ms and fatal at 1.6s. It is `position: fixed` over the host's rect, the same reason the screen shake rides the overlay. Because of that an effect can no longer be truncated, which is why `duelAiWait` only holds the rival for `DUEL_AI_FX_WAIT_MAX` (1500ms) rather than the full duration: the wait exists so effects are seen one at a time, not so the board freezes until the last ember fades.
      - **A partial run never plays** (the pack-frame rule): `duelFxFrames` returns null unless every frame of that shape exists, and everything falls back to a CSS effect tinted from the element's own palette. That is what makes the feature safe to ship before any art exists, and it lets each shape upgrade on its own as its frames land.
      - Frames chain (each drawn from the one before), stand on nothing (`dfx:` is in `_tcgArtStore`'s knock-out list and `_tcgBgFreeIds`), and each shape declares its own `strict` — the wide curtains fill the frame by design, so checking them strictly would condemn their own outer glow, exactly like the FX `blast` phase.
      - A spell has no element, so `DUEL_SPELL_ELEMENT` lends it one, and each hero carries `el` for the same reason. `tools/duel-hero-tests.mjs` pins that every hero power both resolves **and** animates.
    - **🔍 Hover any card to read it in full** (`duelPeek*`, `.duel-peek*` CSS, v1.271.0). A board minion is a thumbnail and a hand card is 122px, so the ability text is clipped. Hovering anything carrying **`data-peek`** — hand, board, or either column of the deck builder — opens the whole card beside it: the art at size, both numbers, the duel ability in full, and the training / merge / rank lines. It shows **only what a duel uses** (v1.273.0): the card's ARENA skill, its arena stat block and its affinity triangle were all removed, because the duel ability is *generated* from the arena skill but never fires it, the duel's numbers are its own 4/4, and `duelHurtMinion` ignores element entirely — four numbers a student cannot act on, printed beside the two they can. See **👁 What a monster does in THIS game** below for where they went. Three things keep it out of the way: it is **`pointer-events: none`** (it is placed right beside a card the student is about to DRAG), it is bound **once on the document** rather than on the shell (`duelRender` replaces the shell's innerHTML on every action), and `duelRender` / `duelRenderBuilder` **hide it** because the element it was pinned to is about to be destroyed. A board minion peeks from its LIVE state (damage taken, War Cry attack, the keywords it is actually carrying); everything else peeks from the card. Touch has no hover, so a **long press** (`DUEL_PEEK_HOLD_MS`) is the peek there, and it swallows the click it would otherwise have turned into — a student holding a card still is reading it, not playing it.
    - **⚔️ attack and 🛡️ defence carry icons everywhere in the duel** (`duelAtkHtml` / `duelDefHtml`, v1.271.0) — hand, board, builder rows and the peek. They are inline SVG stroked in **`currentColor`**, not emoji: emoji render differently on every phone, and `currentColor` is what lets the shield turn red with `.duel-hp.hurt` instead of needing a second icon. The collection card's own stat pills already had the sword and shield (`TCG_STAT_SVG`) and are untouched.
    - **The rival brings a DECK, and one of them hard-counters a swarm** (`DUEL_RIVAL_PLANS` / `duelPlanFor` / `duelRivalDeck` / `duelAiWorthPlaying`, v1.271.0). A rival that shuffles a random forty has no plan, and a student who floods the board with cheap minions beats it every time — which is the report this answers. There are three archetypes: **Mixed Company** (the old behaviour), **🌋 Ashfall Legion** (board clears — the counter to going wide) and **🛡️ Bulwark Order** (taunts and healing).
      - **Both halves are load-bearing and neither works alone.** The deck supplies the clears (`plan.score` prefers `DUEL_AOE_ABILITIES` cards and the sweep spells); `duelAiWorthPlaying` makes the AI **hold** them until they are worth casting — two enemy minions, or one it kills. A sweeper cast into an empty board counters nothing, which is exactly how the rival used to be beaten by simply playing more minions than it could answer. Only cards whose value depends on the board are ever held; a plain minion is always played, and a rival with an **empty board** releases a minion anyway (never a spell) rather than holding a perfect hand while it loses.
      - **The counter is biased, not random**: `duelPlanFor` re-weights on `duelDeckIsSwarm(duelDeckFor(s))` — half or more of the student's monsters costing ≤ `DUEL_SWARM_COST`. It shows up against a swarm deck far more often and still turns up occasionally against everyone, and a swarm player still meets the other decks. Keep both directions true if you retune the weights; the harness pins them.
      - It is **announced** — named on the rival's side of the board (`.duel-hero-plan`) and in the opening log line. A student who loses to a board clear and is never told one was coming learns nothing.
      - `duelRivalDeck` widens the star band by **exactly one star** when the band holds fewer than `DUEL_PLAN_MIN_PREF` of the plan's own cards (every Taunt in the dex is 4★, so a 2★ collection's band has none). A plan with no preferences never widens, so an ordinary rival stays inside the student's band.
      - Run **`node tools/duel-rival-tests.mjs`** after touching any of it.
    - **🏆 The Ember Duel board** (`rpgRowDuel` / `rpgRowDuelScore`, tab `duel`, v1.282.0) pays its **top 3** a $10 voucher, ranked on **duel questions × accuracy²** — the All-Time board's rule, through the same `rpgScienceScore`, so accuracy counts twice and the board cannot be climbed by rattling through questions. **Winning duels is worth nothing on it**, which is what keeps the mode free to play: the questions are the rate limit, exactly as `rpgAwardGameQuestion` is the only faucet.
      - The counters are `rpgState.duelQ` / `duelCorrect`, incremented by `duelNoteQuestion` in `duelAnswer` — the one place a duel question is answered — and counted **whether or not `rpgAwardGameQuestion` paid for it**, because the board ranks on questions done, not points earned.
      - Adding a prize board means touching all four places or bans and prizes leak: the tab's `rpgBoardMetric` / `rpgBoardValueHtml` / `rpgPrizeBadge` / `rpgRowClass` / `rpgBoardNote`, a `PRIZE_CATEGORY_TAB` entry, a `push()` in `_computePrizeWinners`, and the label in the winners table. The duel is also in the `embers` **ban scope**, since it is part of Realm of Embers.
      - The tab is **hidden until the mode is released** (`duelAccessAllowed`), the same way Legends' is — no advertising a prize nobody can play for — and `rpgBoardTab` falls back to `month` if it was selected when the mode closed.
    - **Students choose a HERO** (`DUEL_HEROES` / `duelHero*` / `duelUsePower` in `app.js`, `.duel-heropick*` / `.duel-power` CSS in `index.html`, v1.270.0) — the student is somebody in the duel, not just a life total. A hero wears its own portrait on the board and brings a **hero power**: `DUEL_POWER_COST` (2) mana, **once a turn, all duel long**, never in the deck and never running out. That is what makes two students with the same forty cards play differently.
      - **The five shipped heroes are the BASIC set and are deliberately WEAK** — one damage, two armour, one +1/+1, one freeze, one card for a life. They are the floor the game is balanced on, they are free to everybody from the first duel, and **`tier: 'basic'` is what leaves room for the LEGENDARY heroes of the next expansion**: a legendary hero is a row with `tier: 'legend'`, a bigger `v` and whatever unlock rule goes in `duelHeroesFor(s)` — the one place availability is decided, so the chooser, the save and the rival picker all obey it without being told three times. The harness pins `v ≤ 2` on the basics for exactly that reason.
      - **A power's `kind` must be handled in `duelResolvePower`** — the same trap `DUEL_ABILITIES` and `TCG_ROLE_MODS` carry, except that this one fails SILENTLY: an unhandled kind is a button that costs two mana and does nothing. `tools/duel-hero-tests.mjs` fires every hero's power and fails if the board did not change.
      - **A power with a `need` reuses the SPELL targeter wholesale** (`DUEL_TARGETED`'s vocabulary): it arms `r.pending` with `power: true` and the same `duelTap` branch resolves it, so a targeted hero power costs no new interaction code. `duelCanUsePower` asks the same three questions `duelCanPlay` does — enough mana, not already spent, something legal to aim at.
      - **The default is the SAFEST hero, not the first row.** `DUEL_HERO_DEFAULT` is the Warden, and `duelHeroId` falls back to it for a student who has never chosen AND for a hero id that has since been retired. Her power is **armour**, which is the point: `duelHurtHero` spends armour before life, so it never overheals, never expires, can be laid down before the blow instead of after, and — unlike every other power — cannot be mis-aimed or pressed into an empty board. `s.duel.hero` is left **null** until a real choice is made, so `duelHeroChosen` can tell "picked the safe one" from "never looked" and say so; the duel plays the same either way.
      - Portraits are the ordinary art pipeline under **`hero:<id>`** — paste / drop / upload / ✨ AI on the Card Art tab plus a draw-all batch (`tcgHeroArtPrompt` / `_tcgGenHeroArt` / `tcgHeroArtAdminHtml`). A hero **stands on nothing**, so `hero:` is in `_tcgArtStore`'s knock-out list, `_tcgStrictBg` and `_tcgBgFreeIds`, and each row names its own chroma `screen` — a colour that hero cannot be wearing. Same no-lettering rule as every other slot.
      - The rival gets a hero too (`duelRivalHero` — a basic one at random, never the student's own) and spends it in `duelAiTurn` **after** its hand, because a card on the board beats two armour.
    - **Students build their own deck** (`duelOpenBuilder` / `duelDraft*`, v1.263.0), Hearthstone's rules and for Hearthstone's reasons: exactly `DUEL_DECK_SIZE` (**40** since v1.266.0) cards, at most `DUEL_COPIES_MAX` (2) of any monster and only **one** of a 7★ legend (`duelMaxCopies`). The limits are the one place a collection turns into a decision. The deck is saved on `tcgState().duel.deck` and **filtered inside `tcgHydrateState` against both the dex and what is still owned**, exactly as `team` is — a sold or merged-away card can never poison a saved deck. `duelDeckFor(s)` returns the saved deck only if `duelDeckProblem` says it is still legal, and auto-builds otherwise, so a student who has never opened the builder still gets a playable duel. **`duelBuildDeck` must obey the same copy limits** — it did not at first, and "✨ Suggest a deck" produced a deck the builder then refused to save.
      - **`DUEL_COPIES_SPELL` (4) is what makes the deck size REACHABLE, and it is not a balance knob.** Spells are the free basic set — everybody has all `DUEL_SPELLS.length` (12) of them whatever they own — so a student holding N different monsters can build at most `2N + 12 × DUEL_COPIES_SPELL` cards. At two copies of a spell that ceiling is `2N + 24`, which means anyone under **eight** distinct cards could not legally fill forty and the builder would refuse every deck they made, while `duelDeckFor` quietly dealt them a short one. Four puts the ceiling at `2N + 48` — over the line from the very first pack. **Raising `DUEL_DECK_SIZE` again means re-checking that arithmetic**, and the tiny-collection cases (1 / 2 / 3 / 8 owned) in the duel harness are exactly that check.
      - The auto-builder and the rival both size their spell count from `DUEL_AUTO_SPELLS` (a quarter of the deck) rather than a hard-coded 5 or 6, so the deck's *shape* survives a change to the size instead of turning into forty monsters and no answers.
      - **Five deck SLOTS** (`DUEL_DECKS_MAX`, `duelDecks` / `duelActiveIndex` / `duelActiveDeck` / `_duelStoreDecks`, v1.267.0). `tcgState().duel.decks` is an array of `{ name, cards }` and `duel.active` says which one is played; the builder edits one slot at a time (`duelDraft.slot`) and every surface reads the ACTIVE deck, never `duel.deck`. One deck was enough while every duel was the same fight — it is not, now that rank, element and the rival's own average rarity pull a deck three ways, and rebuilding forty cards to try an idea is a chore rather than a decision.
        - **`duel.deck` still exists and is written on every save** as a mirror of the active slot. It is never read once `decks` exists; it is there so that rolling the app back to a build from before slots finds a student's deck where it used to be instead of an empty builder. `_duelHydrateDecks` migrates it into slot 1 when `decks` is absent — and because `tcgHydrateState` is a WHITELIST, both fields have to stay in that literal or they are deleted on the next load.
        - Saving a slot also makes it active (a student who has just built a deck expects to duel with it), `duelDraftDirty` compares as a MULTISET so a re-sorted list of the same forty cards is not "unsaved changes", and `duelDeckPickHtml` puts a one-tap switcher on the Game Modes card — but only once there are two playable decks, since one deck needs no picker.
      - **A deck that is no longer legal is not thrown away.** `duelDraftSeed(s)` opens the builder on every pick that still stands — dropping only unowned cards and copies over the limit — so a student whose 20-card deck predates the change fills in twenty more rather than starting again. `duelDeckFor` still auto-builds for PLAY, since a duel cannot be dealt from a short deck.
    - **A duel pays nothing for winning** — `rpgAwardGameQuestion` inside `duelAnswer` is the only faucet, one question a turn, exactly like the Ghost Arena rule. It costs no game credit, so questions are the rate limit.
    - **Sound and the screen shake are sized by the DAMAGE** (`duelSfx*` / `duelQuake` in `app.js`, `.duel-quake-1…4` CSS in `index.html`, v1.268.0). `DUEL_HIT_TIERS` is the whole "the bigger the blow, the more dramatic" rule in one table: four tiers by damage (≤2 / ≤5 / ≤9 / 10+), each louder, deeper, longer and shaking harder than the one below. `DUEL_HEAL_TIERS` is the same idea for healing — a chord that opens upward rather than anything percussive. **Retune the tables, never the call sites**, and keep the ladder monotonic; `tools/duel-sfx-tests.mjs` pins exactly that, because nobody hears a regression in a number.
      - **`DUEL_CUES` is everything that is not a blow** (v1.269.0) — drawing a card, summoning, casting, freeze / ward / buff / rank-up, the turn chime, the science question, winning and losing. They are **deliberately quieter than the lightest impact**, and that is not a taste call: a draw happens every single turn and an impact does not, so anything routine at fighting volume is what makes a student mute the whole mode. The harness pins it. Repeats of one cue in a single moment are staggered by `gap` (three opening draws are a riffle, not one click) and dropped past `defer`. Only the STUDENT's draws are heard — the rival's hand is face down, so a sound for it is noise carrying no information.
      - **A freeze that also CHIPS is both** — `duelHurtMinion` tags that damage `freeze`, not `dmg`, so the flush has to feed it to the impact as well or Ariselle's board-wide hit lands in silence and never shakes anything.
      - **Adding a cue is a row in `DUEL_CUES` plus a synth kind in `DUEL_SYNTHS`.** The five kinds are `hit` (noise crack + falling body + sub), `chord` (partials opening upward — healing, a ward, a rank-up, a won duel), `swish` (band-passed noise sweeping — anything that MOVES rather than lands; up reads as setting off, down as arriving), `tone` (one voice gliding) and `slay`. A tier naming a kind that is not there falls to `hit` rather than going silent, because a missing sound is far harder to notice than a wrong one.
      - **Two layers, and the second is why the mode is never silent.** `assets/sfx/duel/manifest.json` names a file (or a full URL) per cue — real recorded effects from a free sound library, fetched ONCE per page. If it is not deployed, or a file fails to decode, that cue falls through to the **WebAudio synth** and is never asked for again. The synth is the shipped default and adds not one byte, which matters as much here as the load-bearing font/Tailwind rules above: the alternative is nineteen MP3s over a school network. `assets/sfx/duel/README.md` names the licences that are safe to use and what each cue should sound like.
      - **Damage and healing hang off the effect QUEUE, not the rules.** `duelSfxFlush(q, lunged)` is called from `duelFlushFx`, so every path — attacks, spells, battlecries, the AI's whole turn — gets sound and shake for free, in step with the animation it belongs to. (The `DUEL_CUES` one-shots are the exception and play where the event happens — a draw has no queue entry to ride.) It plays **one beat per flush, sized by the loudest thing in it**: a battlecry hitting five minions is one big blow, not five overlapping ones that clip. A flush containing a lunge delays its impact by `DUEL_HIT_DELAY` so the blow lands as the attacker arrives, and a hit on the student's OWN hero is tiered as 2 damage more than it is — it is the one that can end the duel.
      - The shake rides `#duelOverlay`, not the shell, so the backdrop moves with the board and a shake started mid-turn survives `duelRender()` replacing the shell's innerHTML. **Muting is not the same as reducing motion**: the 🔊 switch (`duelToggleSfx`, remembered in `localStorage` under `sq_duel_sfx`) silences the audio and leaves the shake, while `prefers-reduced-motion` kills the shake outright — it is the one effect that moves the whole screen, so it is removed rather than sped up.
  - **Announcing a new SET** (`#tcgExpAnnounce` + `TCG_NEWS_VERSION` / `tcgExpAnnounceVisible` / `_commTcgExpansionPost`, v1.259.0) is a different piece of news from the game's RELEASE, and needs its own dismissal key: the release banner is keyed to `releasedAt`, so a student who dismissed it never meets it again — right for "the game exists", useless for "there is a new set in the packs". **Bump `TCG_NEWS_VERSION` and the whole roster meets the new announcement once**, on their next visit. Three banners now share the one fixed slot at the top of the screen, newest first — expansion → release → Science Strike — and each asks the ones above it whether the slot is free (`tcgAnnounceVisible` returns false while the expansion banner is up; `fpsShowAnnounce` checks both). The same news is pinned to the community feed with nothing to dismiss. All of it is gated on `tcgReleased()`, so **nothing shows to students while the game is in beta**.
  - **🔱 Artifacts LEVEL from repeat copies** (`TCG_ARTI_*` / `tcgArtiPow` / `tcgArtiAbsorb`, v1.281.0) — a spare artifact used to be dead weight, the count going up and nothing else. It now mirrors the card merge track exactly: `s.artiLevels[id]` is 1–99, a repeat is worth `tcgArtiGain(stars)` levels (the merge table, so a 7★ myth is 8 a copy), and `tcgHydrateState` seeds it from the copies already owned so nobody's collection is wasted. It is a **whitelist**, so `artiLevels` has to stay in that literal.
    - **`pow` means four different things and only one of them simply scales.** `tcgArtiPow(art, level)` is the single door: a percentage grows by `TCG_ARTI_STEP` per level under a per-kind `TCG_ARTI_CAP`; `ward` is an immunity and does not scale at all; **`battery` is a COUNTDOWN** (`skillThresh`, lower is better) so levelling pushes it DOWN to a floor of 1, and scaling it the ordinary way would have made the artifact worse the more copies a student fed it; and `ember` grows only the part of its multiplier **above ×2**, because ×2 is what everybody gets and only the excess is the artifact's own. `tools/artifact-level-tests.mjs` pins each of those, and that every plain artifact climbs at every single level without more than roughly doubling.
    - **The level is passed INTO `_tcgApplyArtifact`, never read from the save inside it** — that same function equips the OPPONENT's artifact onto their team, so reading the local student's level would hand it to them. The board publishes `tcg.artiLvl` beside `tcg.artifact`; a payload from before this existed carries none and falls back to Lv1, which is exactly what those artifacts were worth when it was written.
    - `tcgArtiBlurb(art, level)` substitutes the current numbers into the artifact's own sentence rather than rewriting it, so the 🔱 chooser, the reveal card and the battle badge all show what the artifact does **now**.
  - **Artifact artwork** (`arti:<id>`, `tcgArtifactArtPrompt` / `TCG_ARTI_TIER` / `TCG_ARTI_LOOK`, v1.258.0) — the 30 artifacts had no pictures at all, so a 7★ Wyrmheart Ruby looked exactly as special as a 1★ Iron Pin. They now use the same slot machinery as everything else (paste / drop / upload / ✨ AI on the Card Art tab, plus a draw-all batch), and the picture shows on the pack **reveal card** and in the **🔱 Artifacts chooser** — but never on a LOCKED one, because the art is part of the reward.
    - **How epic the art is comes from the STAR RATING, and `TCG_ARTI_TIER` is the only thing that scales.** 1★ is a plain worn trinket with no glow at all; 7★ is a world-shaping myth with reality cracking around it. The whole set is looked at side by side, so the ladder has to be legible without reading a word — keep the tiers far apart and never let a low tier borrow a high tier's language.
    - `TCG_ARTI_LOOK` says what each object physically IS, because the rows carry only a name, an emoji and what the artifact DOES — none of which tells an image model what to draw ("Sun Chip" could be anything). An artifact **stands on nothing** (it sits on a card), so `arti:` is in `_tcgArtStore`'s knock-out list, `_tcgStrictBg` and `_tcgBgFreeIds`, and it is drawn through `_tcgGenClean` with the strict check on a chroma screen picked per artifact (`TCG_ARTI_SCREEN` — green for the red/pink/fiery ones, blue for the green ones, magenta otherwise).
  - **The realm's LOGO** (`TCG_LOGO_SLOT` = `logo:realm`, `tcgLogoPrompt` / `tcgApplyLogo`, v1.255.0) is one elegant medieval crest built around a **living ember** — drawn on the Card Art tab like everything else, and worn on the **page header** (`#tcgLogoMark`) and the **sidebar door** (`#navTcgIco`), both of which fall back to the 🃏 emoji until one exists. It is not a set banner: a banner sells what is in the packet, the logo is the realm's signature and has to read at 22px. Two rules follow from that and are shared with the rest of the art stack rather than restated — it **stands on nothing** (`logo:` is in `_tcgArtStore`'s knock-out list, `_tcgStrictBg` and `_tcgBgFreeIds`, and it is generated through `_tcgGenClean` with the STRICT check, because it sits over the galaxy), and it carries **no lettering** (an image model asked for a name returns gibberish; "Realm of Embers" is set in Cinzel beside the mark).
  - **The Chronicle of Embers — the lore** (`TCG_LORE_SAGAS` / `tcgLore*` in `app.js`, `.tcg-lore-*` / `.lore-book*` CSS + `#tcgLoreBook` in `index.html`, v1.254.0) is the 📜 Lore tab: an illustrated **picture book** of the realm, read one page at a time in a full-screen reader (← → turn, Esc closes). Free to read for everyone; only an admin can draw the pictures.
    - **It is built to GROW.** A card set gets a BOOK (a saga) and a book is only a list of chapters, so shipping an expansion means **appending one entry to `TCG_LORE_SAGAS`** — the tab, the reader, the page numbering, the Card Art slots and the guide's page count all follow. A set with no book yet is billed on the tab as *being written* (`TCG_LORE_NEXT` + the `tcgLoreSagaFor` sweep) rather than going unmentioned, and the last page of the newest book is deliberately an open door.
    - **A book does not have to belong to a set.** Book Three (*The Dragon Accord*, v1.257.0 — the war and the alliances between the elder gods of the original dex and the Lionheart Legion) carries **`set: null`**, because its whole subject is the two sets meeting. That is what keeps `tcgLoreSagaFor` honest: it only matches a saga that actually claims a set, so a crossover book and an expansion book sit side by side without either being mistaken for the other's story, and the "waiting for their chapter" sweep still reports correctly. Every **7★, 6★ and 5★ card in the dex now has at least one page** — check that again after adding a set.
    - **Lore text is escaped, so it is PLAIN text.** No markdown: `*emphasis*` renders as literal asterisks on the page. Use the wording, or quotation marks for a spoken line. `<b>` is only available in the tab's own copy (`tcgLoreHtml`), never inside a chapter's `text`.
    - **The cast is the TOP of the dex, on purpose** — the 7★ legends carry the spine, the 6★ elders carry the chapters, the 5★ cards fill them out — so anything rare a student pulls has a page they can go and read. A chapter names its cast **by card NAME, not id** (`tcgLoreCards` resolves through a name index): the ids are positional and a chapter should read as prose in the source. An unknown name is dropped with a `console.warn`, never thrown — a typo in a story must not take the tab down.
    - **The illustration is drawn FROM the starring cards' own card art** (`_tcgLoreRefSheet` → the shared `_tcgRefSheet(cards)`, which `_tcgSetRefSheet` also uses), so the hero of a page is unmistakably the card in the student's collection. Slot `lore:<sagaKey>:<chapterId>` in the ordinary art store — paste / drop / upload / ✨ AI, listed on the Card Art tab by `tcgLoreArtAdminHtml` — plus a "draw all missing" batch on the tab itself. A lore plate is a SCENE, so it keeps its background (no `_stripImageBackground`) and gets the big `maxSide` (768) alongside `set:`.
    - `tcgLoreArtPrompt` asks for a **children's picture-book illustration** — painterly, 16:9, and with the same absolute no-lettering rule the set banner has, because an image model asked for a title returns gibberish. The page title is set in Cinzel over it in the app.
  - **The realm has its own THEME** (`body.realm-embers`, v1.254.0). Opening Realm of Embers swaps the portal's white theme for gold-on-galaxy across the whole screen, sidebar included; leaving puts it back. `navigateTo` toggles ONE class and everything else is CSS — which is what makes the swap instant and impossible to leave half-applied.
    - The mechanism is the **design tokens**, not a forked component set: redefining `--surface` / `--border` / `--text` / `--primary` inside `#page-tcg` re-skins every `.tcg-*` surface that was already using them, and only the few rules that hardcode a colour (the page header, the active tab, `.btn-primary`'s white label) are named explicitly. Keep it that way — a themed copy of a component is a component that will drift.
    - The galaxy and its starfield are `body.realm-embers::before` / `::after`, both `position: fixed` and `pointer-events: none`, so they never scroll, reflow or swallow a click; `.main-content` takes `z-index: 1` to sit over them. Both honour `prefers-reduced-motion`.
    - **The nav item is the DOOR**, so it deliberately does not look like the other nav items: gold border, galaxy-blue slab, and a tiling starfield (`#navTcg::before`, `background-size` per layer — a handful of gradients make a FIELD rather than seven lonely dots) that brightens and drifts on hover. For a **student** the whole wrap is moved to sit directly under 🏛️ Community by `_tcgPlaceNavItem()`, where they will actually find it; for an admin it stays among the game tools. `#navTcgHome` is the empty anchor it is put back to if the role changes (an admin previewing as a student and back).
  - **Realm of Embers rulebook** — the 📘 How to Play tab (`tcgGuideHtml`) is meant to document EVERY mechanic. It reads its numbers out of the game's own constants (`TCG_PACKS`, `TCG_SKILLS`, `TCG_AFFINITY`, `TCG_ARTIFACTS`, `TCG_LVL_STEP`, `TCG_MERGE_GAIN`, `GAME_Q_POINTS*`, `EMS_*`) instead of hard-coding them, so tuning a pack or a skill updates the guide too — keep it that way, and add a section whenever you add a mechanic.
- **Science Quest generated avatar art (v1.312.0) is an ADMIN BETA, not released.** `RPG_ART_BETA_RELEASED` must stay `false` until the owner accepts the complete set. While false, `rpgArtBetaEnabled()` returns false for students and defaults on only for admins; the hero page gives admins a session-only old/new comparison switch and an unlock-all control for the 143-item test catalogue. The latter affects only that admin hero save and does not grant student inventory.
  - Bundled assets live under `assets/science-quest/avatar-v2/`: two neutral base characters plus one transparent WebP for every weapon, shield, armour, helmet, accessory and pet. `asset-manifest.json` is the source-of-truth coverage list and `tools/rpg-avatar-art-tests.mjs` pins all 145 assets, the beta gate and shared renderer wiring.
  - `rpgAvatarSvg` is the one paper-doll compositor used by the profile, question battles, Dungeon, leaderboards and arena ghosts. Generated characters MUST remain a base layer inside this SVG; do not restore the old early return from `rpgCharacterArtUrl`, because it hides every equipped item. Layer order is back accessory → character → armour → helmet → front accessory → pet → shield/animated weapon.
  - Admin `_rpgArt` uploads always win over bundled beta art. `rpgItemImageUrl` / `rpgCharacterArtUrl` then fall back to the bundle only when the beta is enabled; otherwise the existing drawn SVG art remains the student-safe fallback. Leaderboard rows publish `gender` with `equipment`, and remote avatar calls must pass that gender so a rival is not rendered as the viewer.
- `mistakes.html` — **"Try again"**, the worksheet a student's own mistakes come back as. Standalone,
  like `bar-model.html` and `fps.html`: it does NOT load `app.js` and it is not a page inside the
  portal. The Scan app (`polymathlc/scan`) keeps every question a student got wrong on a photographed
  paper, and when they choose some it writes ONE document to **`scanPapers/{id}`** and emails a link
  to this page.
  - **It lives here because this repo already owns the two things it needs** — the printed-worksheet
    look, and an image model that can clean a photographed figure up. That app keeps the
    photographs, so it does the cropping; this does the rendering and the clean-up.
  - **IT MUST NEVER DISTURB THIS APP, and that is the whole reason it is a separate file.** It reads
    and writes exactly two things: the `scanPapers` document named in `?p=`, and pictures under
    **`scan-mistakes/`** in Storage. It never touches the question bank, the vetting list, the
    teaching notes, a hero, a leaderboard or a student's progress — a scanned question must not
    appear anywhere in this app's own content. The Scan app's collections are namespaced away from
    this one's (`scanMistakes`, never `mistakes`, which is THIS app's own log under the same uid),
    and this page keeps that contract from the other side.
  - **BEST OF THREE TIERS, and `tierOf(it)` is the ONE place a question's is decided** (scan
    v1.18.0, this file v1.3.0): the question **set out again in blocks**, then the **whole-question
    crop**, then the flat transcription. The Scan app now reads the printed question off the
    photograph into ordered blocks — the wording as text with an `image` block wherever a figure
    belongs, each figure cropped from the page — the way this app's own ⚡ Rapid add builds a
    question, so it comes back TYPESET with the paper's own diagrams still in it: sharp at any size,
    and readable on a phone in a way a photograph of 9pt print never is.
    - **The blocks are RE-VALIDATED here, never trusted from the document** (`questionBlocks`). The
      paper is written by another app, in another repository, at whatever version it happened to
      be, and a block that will not draw is a thing to find out now rather than on the printed
      page. A build with **no wording in it** is refused outright — a question made of pictures
      asking nothing is worse than the two tiers under it.
    - **A built question prints its MCQ options as usual**, because the Scan app deliberately
      leaves them out of the blocks: it already holds them, and a second copy inside the wording is
      the choices offered twice. It also gets the FULL working box — a typeset question brings none
      of the paper's own ruled space with it, which is exactly why the whole-question crop gets the
      short one.
    - **A block figure that will not load takes itself off the page** (`__blkFailed`), the opposite
      of `__figFailed` below: the wording is typeset above and below it and still does the asking.
    - **`pictureSlots` decides WHICH pictures are cleaned, and it asks `tierOf` too.** A question
      shown in blocks never shows its whole-question crop, so cleaning that crop would be an image
      call, a Storage write and a student's data spent on something nobody will ever see. The
      renderer and the cleaner reading the same function is what stops the page cleaning one
      picture and printing another. The storage key for a crop is unchanged, so a paper cleaned
      before blocks existed finds its pictures rather than paying for them twice.
    - **The note under the buttons is built from the tiers really used.** One sheet can hold all
      three at once, and "these are cut out of your photographs" printed over a page of typeset
      questions is the kind of small untruth that makes a student stop reading the note at all.
  - **THE PICTURE IS USUALLY THE QUESTION ITSELF** (scan v1.17.0, this file v1.2.0). A question
    rebuilt from a transcription is only as good as the OCR, and a maths or science question is its
    LAYOUT as much as its words. So the Scan app now crops the WHOLE printed question — number,
    wording, options, figure, answer space — out of the student's own photograph, and that is what
    is printed to answer on. `shot` says which of the two a picture is (`'question'` or `'figure'`)
    and it is never guessed: printed the wrong way round, a question picture has its wording typed
    out above it as well — the question asked twice — and a figure has no wording at all, which is
    a diagram with nothing asking anything. **A paper made before that flag existed holds figures**,
    which is what it defaults to, and those render exactly as they always did.
  - **A whole-question picture prints NO wording of its own**, so `__figFailed` is not optional:
    a Storage URL that has expired or a phone with no signal would otherwise leave a numbered
    question with nothing under it at all. The transcription is still on the item and steps forward
    when the picture will not load.
  - **TWO VERSIONS, and the WORDING IS THE SAME IN BOTH.** Only the picture differs: *cleaned up*
    (the default — redrawn in black and white with the student's own pencil rubbed out, so the
    question is blank again) or *the original photograph*. Nothing printed is ever reworded: the
    answers and the key are the transcription the Scan app made and the teacher already marked
    against, so an image model never gets to rewrite a number in a question — only to redraw it.
  - **`cleanPrompt(kind)` is ONE body and two subjects.** A figure was cut from inside the page and
    has no outside to tidy; a whole question is a rectangle off a photograph taken on a desk, so its
    edges can hold a thumb, a shadow, the corner of the next question. `CLEAN_EDGES` is that extra
    paragraph, and it says **WHITE** rather than "remove" — a model told to remove something removes
    it and then draws something else in its place.
  - **`CLEAN_PROMPT` pulls in two directions on purpose**: remove every handwritten mark, and change
    nothing that was printed. It says so in both directions, and it says that a mark it cannot
    classify is KEPT. A model that quietly redrew a printed axis value would be worse than a grey
    photograph.
  - **The clean-up is LAZY and cached.** It runs on first view, one figure at a time (these are big
    calls on a student's phone), and the result is written back onto the paper so every later visit
    — the teacher's included — is instant. A Storage refusal is not a failure of the clean-up: the
    picture is already in hand and is shown; it is simply made again next time.
  - **Every failure shows the ORIGINAL and says so.** No image model in the project, a model that
    refuses, a fetch that fails — a blank space where a diagram should be is a question nobody can
    answer.
  - **The link alone is not enough.** It is a child's marked work, so opening it requires signing in
    and only the owner or an admin can read it; a paper expires (a year) and the page refuses to
    render an expired one.
  - **The printed sheet says to PHOTOGRAPH IT BACK IN** (`.shHow`, and it prints). That is how the
    Scan app's mistake book empties itself — a question got right twice in a row leaves it — and the
    loop only closes if the student knows to close it. The instruction is on the paper rather than
    on the screen because the paper is what they have in front of them when they finish.
  - Version badge (`APP_VERSION` in the module) is hard-coded — bump on every change to this file.
- `science-worksheet.html`, `math-worksheet.html`, `math.html` — worksheet builder apps.
- `fps.html` — "Science Strike" roguelite first-person shooter: pure-canvas open-world FPS — infinite procedural Minecraft-style overworld (blocky grass, dashed road grid, solid trees/rocks, mountain ridges, sun/clouds), infinite scaling enemy waves (Warden boss every 5th), rotating minimap radar with rim-clamped enemy blips, CS-style expanding crosshair + recoil + vertical aim with small ×2 headshot crit zones, 3 classes (Soldier/Sniper/Engineer) each with a 100-node 10-tier prerequisite skill tree (I key, pauses the run, purchases apply instantly; F class actives: Bullet Time/Snare Trap/Auto-Turret), grenades on Q (frag/fire/ice/shock/shrapnel), 12 weapon archetypes (3 scoped ARs + DMR + 4.5× sniper rail with right-click ADS zoom, crossbow, laser beam, plasma) drawn by one drawGunModel() for both the first-person viewmodel and full ground-drop models, real travelling bullets with tracer trails (only tree trunks block shots), 25 enemy types (5 hand-drawn + 20 procedural body-plan variants) each with a per-type headshot crit box, cores banked+saved instantly on earn, Borderlands-style rarity loot drops (Common→Mythic, elemental effects, Mythic specials), and a science MCQ from the shared bank every 15s — correct streaks raise loot luck, milestones guarantee minimum rarities. Shares index.html's Firebase project, Google sign-in, App Check and question bank (`users/{adminUid}/questions`). Leaderboard (ranked by correct answers, top-3 $10 voucher): fps.html PUBLISHES ONLY — it has no board UI of its own. Stats live in a `fps` field on the SAME `scienceGameLeaderboard/{uid}` doc the RPG publishes — index.html's `rpgPublishLeaderboard` MUST keep `{ merge: true }` or it wipes the fps stats (and fps.html's `fpsPublish` likewise). The board renders only inside index.html's Leaderboard page as the "🔫 Strike" tab (`rpgBoardTab === "fps"`, all-time correct answers, `rpgPrizeBadge`/`rpgRowClass` give top 3 the $10 voucher badge); fps.html's menu just links to `index.html#leaderboard`. Release: FULLY RELEASED — no beta gate, no `fpsConfig` flag, no locked screen; every signed-in user gets in and `navFps` shows for everyone (`fpsApplyNavVisibility` still respects the RPG "Hide game" toggle). Release announcement banner in index.html (`#fpsAnnounce`, dismissible via localStorage) plus a built-in pinned community-feed post (`_commFpsAnnouncePost`). Version badge in fps.html (`#versionBadge`) is admin-only and hard-coded — bump on every change to this file.
- `bar-model.html` — "Bar Model Studio" PSLE maths app: students get a generated (or typed/dictated/photographed) word problem, draw a bar model on an SVG canvas, and submit it for AI marking. Uses the SAME AI marking stack as `index.html`: Firebase AI Logic on the shared `mathgen--app` project, App Check (reCAPTCHA v3), `gemini-3.7-flash` with `thinkingConfig: { thinkingLevel: AI_THINK_MIN }` + JSON response mode, and the tolerant `_parseAIJson`/`_repairAIJson` parser (keep these in sync with `app.js`). Optional admin-only ChatGPT engine (key in localStorage) falls back to Gemini on failure. Its version badge (`#versionBadge`, admin-only) is hard-coded in the HTML — bump it on every change to this file.
- `pdf-annotator.html` — PDF annotator + keyword-revision app. Admin opens a PDF, writes on it (pen/highlight/text/shapes/arrows), marks keywords inside text boxes with the key tool, and saves it to `pdfAnnotator/{id}` (+ the PDF itself in Storage under `pdf-annotator/`). Students open a saved worksheet, switch on Revise mode and type the keywords from memory. Saved worksheets carry a `slot` (the class they were taught to) alongside `level` and `wsDate`.
  - **There is NO reward system in this repo.** Awarding marks lives in the Ans Key app (`polymathlc/anskey` → `index.html`), which shares this same `pdfAnnotator` collection. Do not add a Reward button, a students/awards/bosses write, or any other marks path here — it was deliberately moved out in v1.5.0.
  - `wsMeta.slot` is the only thing left of that link: the free-form class string ("P5 Science — Wednesday 5pm–6.45pm") that the Ans Key Reward window pins a worksheet to. Nothing here edits it; `performSave` just writes back whatever was loaded so the pin survives a save made from this app.
  - Version badge (`#versionTag`, `APP_VERSION`) is hard-coded — bump on every change to this file.

## The subject switcher — four apps, one student (v1.291.0)

`SUBJECT_APPS` / `subject*` (in `app.js`, search `THE SUBJECT SWITCHER`), plus
`#subjectSwitch` and the `.subject-*` CSS in `index.html`. A pill in the
**top-right of every page** naming the subject you are in; click it and the
other three are one tap away.

Polymath teaches four subjects through four separate apps, and they share a
Firebase project and a sign-in and **nothing else** — four banks, four sets of
progress, four topic lists. A student taught three of them had one bookmark per
subject on a school Chromebook, and the subject they never bookmarked is the
one they stopped using.

- **It is a LINK, not a router.** Four `<a href>`s and no JS navigation: each
  app stays reachable at its own URL exactly as before, nothing here redirects
  or gates anything, and middle-click / open-in-new-tab behave the way a
  student expects — which a `location.href =` handler would quietly break.
- **The URLs are RELATIVE (`../cer/`), and that is load-bearing.** The four are
  GitHub Pages project sites — `polymathlc.github.io/{math,english,chinese,cer}`
  — so they are sibling folders on one host, and a relative hop resolves there,
  on a local checkout with the four repos side by side, and on a custom domain
  later, without this file ever naming a host. An absolute
  `https://polymathlc.github.io/…` works perfectly until the centre moves to a
  domain of its own and then sends every student back to the old one.
- **Science lives at `../cer/`** — the repo name, not the subject name. The
  label and the folder differ on purpose; `../science/` is a 404 for the whole
  school at once and reads as a link somebody forgot to finish.
- **`SUBJECT_KEY` says which of the four THIS app is**, and it is the ONE line
  that differs between the repos — everything else in the block is identical in
  all four, so a fix copies straight across. `subjectCurrent()` falls back to
  the first entry, so a `SUBJECT_KEY` naming nothing does not throw: it labels
  this app "Math" and offers a link back to the app you are already in.
- **The menu is built from `SUBJECT_APPS`**, never written out in `index.html`,
  so a subject added to that list appears by editing one line per app.
- **The current subject is shown and marked, never dropped.** A menu that
  silently omits where you already are leaves a student unable to tell which
  app they are looking at. It is a `<div>` rather than an `<a>` — a link back to
  the page you are on reloads the app and loses whatever was half-typed.
- **It is turned on from `configureSidebarForRole`**, the one function every
  signed-in path (admin, employee, student) already goes through, rather than
  from three call sites that could drift. It is hidden until then, or it floats
  over the login card belonging to nobody.
- **`z-index: 150` sits in a deliberate gap**: above the sidebar (100) and every
  sticky `.page-header` (50) so it is always reachable, and below every modal
  (`.confirm-overlay` and friends start at 200) so a dialog covers it rather
  than being covered by it.
- **`.page-header` gives up its right-hand corner** (`padding-right`), because
  that is where every page keeps its action buttons and the switcher floats
  over them. It is fixed to the viewport rather than dropped into a header
  because this app has no global top bar at all — forty-odd pages carry their
  own `.page-header`, and a page added next month would be the one that quietly
  had no switcher on it.
- The CSS is written against the design tokens and nothing else, so the **same
  block is used in all four apps** and each paints it in its own palette. A
  themed copy per app is a copy that drifts.
- Run **`node tools/subject-level-tests.mjs`** after touching any of it.

### 📚 The level a BATCH is filed at (v1.291.0)

`rapidLevel` / `setRapidLevel` / `_rapidApplyLevel` / `_rapidLevelOptions`, and
the `#rapidLevelWrap` picker above the pad. An author working through a pile of
screenshots is nearly always working through ONE year's paper, and the AI was
choosing the topic — and therefore the level — one screenshot at a time with no
idea which paper it came from. Saying "these are all P5" once is both less work
and more accurate than correcting forty questions in vetting afterwards.

- **A LEVEL IS NOT A FIELD ON A QUESTION HERE**, and that is the whole design.
  It is read off the TOPIC (`getTopicLevel`), and every surface that cares — the
  bank filter, the student-level gate, the topic grid — reads it that way. So
  stamping `q.level` would write a field nothing in this app looks at, and the
  question would still be served at whatever level its topic belongs to.
  Choosing a level instead **narrows the topics the AI may pick from** to that
  level's, and the level follows from the topic exactly as it always has.
- **`_aiBuildQuestionPrompt` takes the level as a third argument** and blank —
  every other caller, including 🤖 Build from screenshot — leaves the prompt
  byte-for-byte what it was: the whole topic list, chosen from freely.
- **A level whose topics have all been removed falls back to the full list.**
  An empty "choose from EXACTLY this list" leaves the model nothing to choose
  from and it invents a topic instead.
- **`_rapidApplyLevel` is the guard for a reply that ignored the list**, and it
  is what makes the promise true. An off-level or unknown topic is snapped into
  the level and the question is marked **`topicConfidence: 'low'`** — an
  existing signal that already draws the "⚠ check topic" badge in vetting. The
  author asked for a level and gets it; the one thing that had to be guessed —
  WHICH topic within it — is flagged for the glance it deserves.
- **A RETIRED topic is never a snap target.** Cell Systems has left the
  syllabus and `qInSyllabus` keeps it out of every practice mode and every
  game, so filing a brand-new question into it would write one no student can
  ever be served — worse than an off-level topic and just as invisible. It is
  filtered inside `_rapidApplyLevel` rather than out of `currentTopicsByLevel`,
  because the authoring dropdown must still offer it for the PSLE papers that
  use it.
- **A SECONDARY topic counts too.** `qLevelNum` takes the MAX over both, so a
  `topic2` from a higher level puts the question above the level the author
  chose while the primary topic looks perfectly right.
- **The level is captured in `startRapidJob`, synchronously, as the file is
  queued** — never read inside the job. `_rapidPrepFile` re-encodes a phone
  photo, which takes real time, and the pad stays open the whole while: an
  author who queues a P3 paper and switches the picker for the next one must
  not have the first paper land at P4 because its prep finished second. It is
  carried on the job (and shown on its vetting card) and applied to **every**
  question the page held — a page of five is five questions at that level.
- **It lives in `sessionStorage`**, which is the honest lifetime: a batch is one
  sitting, so it survives a reload mid-pile and is back to "Any level" in a new
  tab or tomorrow. A level that persisted for a week would be the one an author
  set last Tuesday and never noticed again, filing a P3 paper as P5.
- **The options are generated from `TOPIC_LEVELS`**, never typed into
  `index.html`: a level added to the topics and missing from the picker is a
  level nobody can file at.
- The chosen level is **named back in the toast and the status line**. Filing at
  a level and never confirming it is how a whole pile ends up at the wrong one.
- Run **`node tools/subject-level-tests.mjs`** after touching any of it.


### The label is drawn from the BLOCK, so it must not also be in the TEXT (v1.293.1)

`qStripOwnPartMarker` / `qPartBodyHtml` / `_qPartOwnMarker` (in `app.js`, search
`THE LABEL IS DRAWN FROM THE BLOCK`).

A block that opens part (a) already wears its label — the chip in the editor,
the tag beside the question on screen, the marker in the margin on paper. When
the SAME marker is also typed at the front of its content the question reads
**"(a) (a) 文中形容…"** on every surface at once.

- **It came in from the AI paths.** The model is asked to letter the
  sub-questions and answers by BOTH stamping `"part":"a"` and writing "(a)"
  into the wording — and `qLiftPartMarkers`, whose whole job is to move a typed
  marker into the field, opened with `if (qBlockOpensPart(b)) return;`. The one
  case it could not fix was the one case that needed fixing.
- **It is handled at BOTH ends, and both are needed.**
  `qStripOwnPartMarker` takes it out of the BLOCK (from `qLiftPartMarkers`, from
  `setBlockPart` when an author labels one by hand, and on `editQuestion` so a
  question tidies itself the moment somebody opens it), and **`qPartBodyHtml`
  takes it out at RENDER** — the bank is already full of questions written the
  other way and nobody will open them one at a time. The render side never
  touches the block, so an author still sees exactly what is stored.
- **The marker must name the block's OWN part.** A block labelled (b) whose
  text opens "(a)" is two people disagreeing about which question this is, and
  that is for a human to look at — not something to tidy away silently.
- **`_qPartOwnMarkerRe` accepts FULL-WIDTH brackets and `QPART_MARKER_RE`
  deliberately does not.** That regex has to find a part in text nobody has
  labelled, where being wrong files a question under the wrong letter; here the
  block already says it is part (a), so a leading `（a）` can only be the same
  label twice. It also drops the `(?=\s|$)` guard **for the bracketed forms
  only**: a 华文 paper writes `（a）文中形容……` with the character hard against
  the bracket, so demanding whitespace there matched none of them. The two BARE
  forms keep it, or `a.` would eat the front of any sentence opening with a
  lone letter.
- **Two markers in one box is refused**, the same guard the Doctor's scan and
  `autoNumberParts` use: that is several parts written into one box, or an
  options list, and neither is fixed by removing the first.
- A **NUMBERED** part is left alone — detection is letters only, on purpose.
- `qPartDetect` now takes an optional regex; its default is byte-for-byte
  `QPART_MARKER_RE`, so nothing else about detection moved.
- Run **`node tools/part-marker-tests.mjs`** after touching any of it.

## Clearing the vetting list — deleting several at once (v1.292.0)

`_vetSelected` / `_vetVisibleQuestions` / `_vetDeleteMany` (in `app.js`, search
`DELETING SEVERAL VETTING QUESTIONS AT ONCE`), plus the tick box on every
vetting card, the `#vetBulkBar` above the grid and **🗑 Delete all** beside
✨ AI Auto-Vet All.

The vetting list is where a whole BAD BATCH lands — forty screenshots off the
wrong paper, an import run twice, a set the model made a mess of. Clearing that
one card at a time is forty confirm dialogs, which is why it gets left instead,
and a vetting list nobody clears is one nobody reads either.

- **"All" means every card the author can SEE.** `_vetVisibleQuestions` is the
  ONE place that set is worked out — filtered by the search box, newest first —
  and the cards, the tick-all box, 🗑 Delete selected and 🗑 Delete all all read
  it. Deleting questions hidden behind a filter is the one outcome nobody could
  have predicted from the button they pressed, so the confirm **says which of
  the two it is doing** and how many are being spared.
- **The deletes are AWAITED, one document at a time** (`deleteVettingDocAwait`,
  the awaited twin of the fire-and-forget `deleteVettingDoc`). A batch has to be
  able to report that four of forty would not go, and a question leaves
  `vettingList` only once its document really went — the same order every other
  move in this app uses. A list that has dropped a question the database still
  holds looks perfectly right until the next sign-in.
- **The selection is PRUNED on every render** (`_vetPruneSelection`). A ticked
  question approved into the bank, edited away or auto-vetted out is not a thing
  to delete; doing it in the renderer rather than in each of those paths is what
  covers a path added later. "3 selected" outliving the cards it counted is how
  the wrong question gets deleted.
- **The ticks live in a `Set` of ids, never as a flag on the question.** Those
  objects are replaced wholesale by re-reads and cross-tab syncs, which would
  silently drop the tick.
- **`.vet-pick` must set `appearance: auto`** — Tailwind's preflight sets it to
  `none`, which leaves an invisible white square exactly where the control the
  author is looking for should be. The usual trap.
- A ticked card's outline **outranks** the duplicate / just-added one while it is
  ticked and gives it back when unticked: both are inline styles, so one has to
  win outright rather than being layered.
- **This delete is FINAL — it does not go through the 🗑 bin.** It is the same
  `deleteVettingDoc` the single card's 🗑 has always used, and the confirm says
  so in as many words. A vetting draft that should be kept is approved into the
  bank, where deleting *is* a move to the bin.
- Run **`node tools/vetting-bulk-delete-tests.mjs`** after touching any of it.

## "You may already have this one" — the duplicate warning (v1.293.0)

`findDuplicateCandidate` / `checkEditorDuplicate` / `dupWatchKick` /
`_dupGateSave` (in `app.js`, search `THE DUPLICATE WATCH`), plus the
`#dupWarnBanner` at the top of the question editor and the 🟡 badge on a
vetting card.

The matcher itself is old: a token-overlap (Jaccard) score over the title, the
body and the MCQ options, past `DUP_MIN_SCORE` (0.7). What was missing was
everywhere it was not being asked.

- **It used to be raised from ONE place — straight after 🤖 Build from
  screenshot.** So a question TYPED into the block editor, pasted, built by the
  passage builder, or opened and reworked was checked against nothing at all,
  and the only duplicate warning in the app was a badge on a Rapid add card.
  The bank fills up with the same question twice and nothing anywhere says so.
- **The banner is LIVE.** `dupWatchKick` re-checks as the author works, so the
  warning is on screen while there is still something to do about it. The
  listener is **ONE delegated pair on `#page-create`**, for the reason the 拼音
  IME's is: this app builds the editor's DOM continuously, so anything bound
  per element covers the fields that existed when it ran and silently misses
  every one made afterwards. **`renderBlocks` kicks it too** — a builder writing
  blocks programmatically fires no `input` event at all.
- **The SAVE asks as well, and that is the backstop.** A banner sits at the top
  of a long editor and the Save button is at the bottom, so `_dupGateSave` is on
  all three editor saves — ✅ Add to vetting, 💾 Save, and Save straight to the
  bank. It is a **PROMPT, never a block**: only the author can tell a real
  duplicate from two questions that merely share a stem, so "Save anyway" is
  always there.
- **The gate is a PASS-THROUGH, never a second write path.** Each save function
  keeps its body in a `*Confirmed` twin, so answering "Save anyway" ends at the
  same door — and therefore the same ordering guarantees — as before.
  `tools/question-persistence-tests.mjs` pins that.
- **The VETTING LIST is searched as well as the bank**, and the result says
  which (`_dupWhereLabel`). The commonest duplicate of all is the same
  screenshot read twice in one sitting, and BOTH copies are then in vetting,
  where a bank-only search sees neither — nothing was flagged, and the pair was
  approved into the bank one after the other.
- **`_dupStillThere` is the ONE place a suspected twin is checked for existence**,
  and it reads both lists. The vetting card used to ask `questionBank` alone, so
  a twin that is itself still in vetting made the badge vanish.
- **The banner's 👁 button ASKS before it leaves** (`dupOpenOriginal`). The
  banner is on screen while the author is mid-compose, so loading the twin
  replaces the draft they are looking at; hovering the same button previews a
  BANK twin without leaving at all, which is the answer most of the time. The
  vetting card's copy of the button needs no guard — nothing is being typed
  there — which is what the third argument to `_dupSeeOriginalBtn` selects.
- **The hover preview is attached only for a BANK twin.** `ppBankHoverHtml`
  reads `questionBank` and nothing else, so a vetting original would open an
  empty card that reads as a broken preview.
- Run **`node tools/duplicate-warning-tests.mjs`** after touching any of it.

### ⇄ Side by side — the comparison the warning was missing (vv1.295.0)

`dupCompare` / `_dupFindQuestion` / `_dupCompareSide` / `_dupDiffHtml`
(search `SIDE BY SIDE`), plus the `#dupCompareOverlay` in `index.html`.

The banner said *"this looks 90% like Sharing a Sum of Money"* and offered
exactly ONE button: **open** that question. Which replaces the draft — so the
only way to answer the question the banner asks (*are these two the same?*) was
to throw away the thing being compared, go and look, and then build it again
from memory. Nobody does that, so the warning got clicked past, which makes it
a warning that costs attention and buys nothing.

The two questions now go up **next to each other**: what is being written on the
left, what is already filed on the right.

- **Both sides go through the SAME renderer** — `renderQuestionBodyPreviewHtml`,
  split out of `renderQuestionPreviewHtml` so it takes the question OBJECT
  rather than an id, because the left-hand column is a draft that has never been
  saved and has no id to look up. A second renderer written for this view would
  be free to drift, and a comparison whose two halves are drawn by different
  code can flatter one of them.
- **Nothing is written and nothing is replaced by opening it.** It is a read.
  The one destructive action — loading the original into the editor — lives in
  the overlay's foot, still behind `dupOpenOriginal`'s confirm, and is now
  reached only by somebody who has actually seen what they are about to lose. It
  is **hidden** when the left-hand side is a saved question (a vetting card),
  because there is no draft to lose there.
- **`mineId` names the LEFT-hand question.** A vetting card passes its own id;
  the editor banner passes nothing, and the draft is read from
  `_dupEditorQuestion()`. That third argument to `_dupSeeOriginalBtn` used to be
  a boolean `guard` — same position, different meaning, so check both call sites
  if you change it.
- **It says what differs IN WORDS** (`_dupDiffHtml`, through the matcher's own
  `_dupTokenSet`). Two near-identical questions are near-identical to LOOK at,
  which is the whole problem: the eye slides straight over the one changed
  number. The words appearing on one side only are the fastest honest answer to
  "so what did they change?", and a diff computed on any other footing would
  contradict the percentage printed above it. When both lists are empty it says
  *word for word the same*, which is the strongest thing it can tell an author.
- Run **`node tools/duplicate-warning-tests.mjs`** after touching any of it —
  the direction of the difference strip is the silent one: reversed, the two
  lists read perfectly and tell the author the opposite of the truth.

## 🔍 Answer key cross-check — TWO engines at once (v1.296.0)

`akc*` (search `ANSWER KEY CROSS-CHECK`), plus `#akcOverlay`, the `#akcBankBar`
on the Question Bank and 🔍 Check answer keys on a 📄 My Worksheets card.
**Ported from `polymathlc/math`, which carries the same block — keep the two in
step**; what genuinely differs here is the question SHAPE and the agreement
test, and both are called out below.

✅ Check Questions serves a question back to a HUMAN for a second pair of eyes.
This asks **two models** — ChatGPT (`gpt-5.6-sol` by default) and Gemini
(`AI_MODEL`) — to answer every question from scratch **simultaneously**, and
reports their two answers beside the teacher's own key, with a recommendation.
Gated on `_canAuthor()`.

- **The two calls are `Promise.all`ed and neither model is shown the other's
  answer.** That independence is the only reason an agreement between them
  means anything — chain them and the second is just agreeing with the first.
- **`skipOpenAi: true` on the Gemini call is load-bearing**, and it is why
  `askGeminiVision` / `askGemini` grew that option at all. They route through
  ChatGPT whenever the sidebar's engine toggle says so, so without it both
  columns are the same model twice: they would then agree constantly and the
  report would read as a clean bill of health.
- **Both engines get the identical prompt**, built once per question. A
  comparison between two models asked different questions compares the
  questions.
- **It READS ONLY — no path here writes a question.** Every row ends in a
  recommendation. A model that is confidently wrong must not be able to
  overwrite a teacher's key; ✎ Edit opens the question in the editor instead.
- **The key is read through the SHARED printed-key pushers.** `akcKeySections`
  calls `_pushBlockAnswerKey` / `_pushAnswerKeySection` — the same two the
  printed answer key uses — so what is checked is exactly what the teacher
  prints and marks from. A second answer reader written for this feature would
  be free to drift, and a cross-check comparing against the wrong half of a
  question is worse than no cross-check. An MCQ is a **block** here
  (`correctId` against `options[].id`), which is the main shape difference from
  the Maths app's copy.
- **`akcCompare` is PLAIN CODE, never a third AI call.** The same two answers
  must always produce the same advice. Its statuses: `agree` (green), `guide`
  (answer right, model answer flagged), `split`, `no-key`, `single`,
  `key-wrong` and `split-none` (both red), `failed`.
- **`compare.tone` is the ONLY thing that colours, tallies and sorts a row.**
  One status can carry two colours — a lone engine agreeing with the key is
  amber, a lone engine contradicting it is red — so a lookup table keyed on
  `status` would be a second opinion about the first.
- **A science answer is usually a SENTENCE, so agreement is decided in three
  different ways and the split between them is the whole safety story.**
  - An **MCQ** is compared by option NUMBER, never by the words.
  - A **number** is settled on its numbers and then its units through
    `AKC_UNIT_CANON`: "24" and "24 g" agree (one side left the unit off),
    "24 g" and "24 kg" do not. The text test is never allowed to rescue a
    numeric disagreement — "the mass is 24 g" and "the mass is 42 g" share
    every content word.
  - A **worded** answer against the KEY is settled by the engine's **own
    `statedAnswerVerdict`**, because that is a semantic judgement no token
    count can make: "a good conductor" and "a good insulator" are one word
    apart and opposite, while "the water evaporated" and "the liquid turned to
    vapour" share no words and are the same answer. `unsure` falls through to
    the words.
  - Engine against ENGINE has no verdict to read (neither saw the other), so it
    uses `akcTextOverlap` — **JACCARD, shared over the UNION, never an overlap
    coefficient**. Over the shorter side, conductor/insulator scores 0.67 and
    reads as agreement; over the union it is 0.50 and does not.
- **The bank's window is a filter ON TOP of what the bank is showing**, so the
  count on the button is the set the eye can see — `_akcSyncBankBar` runs from
  `renderQuestionBank`, which is every keystroke in the filters. An undated
  question can only ever appear under "any time".
- **Which rows are expanded is state (`_akc.open`), not a class on a div** —
  the report re-renders on every result that lands, so a panel opened mid-run
  would snap shut under the teacher reading it.
- Guards: `AKC_PAR` questions in flight, `AKC_MAX` per run, a confirm over
  `AKC_CONFIRM_OVER`, ⏹ Stop honoured between questions, and closing the
  overlay stops the run rather than leaving model calls billing away behind it.
- The handlers are bound **lazily** (`akcBindOnce`), because the block sits
  above the point where `$` is declared and must not touch the DOM at
  module-evaluation time — the usual temporal-dead-zone trap.
- Run **`node tools/answer-key-check-tests.mjs`** after touching any of it.

## One ChatGPT key for all four portals (v1.296.0)

`AI_ENGINE_STORE` (search `ONE KEY, ALL FOUR PORTALS`).

The four apps are sibling folders on ONE GitHub Pages origin
(`polymathlc.github.io/{math,english,chinese,cer}`), so they have always shared
a localStorage — they were simply writing **different slots** in it, which meant
the same key had to be pasted once per subject.

- **It is not a convenience.** 🔍 Answer key cross-check needs ChatGPT and
  Gemini BOTH live to be worth running, so an app missing the key runs it with
  one column and reports "no second opinion" forever — which looks exactly like
  a working feature.
- **The four slot names are `sq_ai_engine` / `sq_openai_key` /
  `sq_openai_model` / `sq_openai_image_model` in ALL FOUR apps.** They are this
  app's original names because this is where the key already was; Maths
  migrated onto them and copies its old `mq_` values across **only into an
  empty slot**, so a stale key cannot sign the other three apps out. Do not
  rename them to something subject-neutral without migrating all four at once.
- **The key is NEVER in the repo.** These are public, static sites served to
  every student's browser, so a key committed here is a key handed to the whole
  school. It lives in the admin's own browser; both harnesses fail on an
  `sk-`-shaped string in the source.
- Run **`node tools/answer-key-check-tests.mjs`** after touching any of it.

## 📌 The standing instruction — a note the teacher types, not uploads (v1.309.0)

`_notesGuidanceBlock` / `openQuickNote` / `quickNoteSave` / `NOTES_GUIDE_CHARS` (in `app.js`,
search `STANDING INSTRUCTIONS`), plus the `#quickNoteOverlay` in `index.html`, the ✍️ **Add a
note** button at the top of the 🎯 Teaching Notes page and the **General guidance** field in the
note editor. **Ported from the Ans Key annotator (`polymathlc/anskey`), which shares this very
collection — keep the two in step.**

Uploading a PDF and waiting for the AI to read it is the right shape for a set of notes and the
wrong shape for one sentence. Most of what a teacher wants the AI to do is one sentence — *always
name the process*, *units on every numerical answer*, *never accept "it dries up"* — and there was
nowhere to put it. So it went unsaid, and every question, answer and mark was written without it.

- **It is a HOUSE RULE, so it is deliberately NOT filtered by topic.** Every other field here is
  narrowed to the notes matching the question in front of us, which is what keeps a marking call
  cheap; a rule that only applied to the matching notes would not be a house rule. `guidance` is
  read across the WHOLE notebook and **leads** each digest — read after the extracted keywords it
  would be competing with them, read first it is the rule they are applied under.
- **It reaches all three digests** — `_notesMarkingBlock`, `_notesGenBlock`, `_notesAnswerBlock` —
  so it is obeyed when a question is built, when a model answer is written, when something is
  explained **and when a student is marked**. It is the only field that reaches marking as well as
  answering.
- **Guidance ALONE is worth a block.** All three digests used to bail out the moment there were no
  keywords, standards or facts to report, so a teacher who had typed a house rule and uploaded no
  documents at all would have been ignored entirely.
- **Nothing is sent to the AI when one is saved.** What is typed is written to Firestore verbatim,
  as a note with no topics — so it applies to everything — and with the extracted fields empty. It
  is live on the next question, with no analysis step to wait for.
- **The digests are the ONLY thing that changed.** No other AI function in this app was touched:
  the three digest builders are the notes system's own, every call site is exactly where it was,
  and no prompt outside this section was edited.
- **One notebook, three apps.** `guidance` is Ans Key's field name and the Scan app writes it too,
  so a rule typed in any of the three is obeyed in all three from the next question onwards. The
  card says which app a note came from (`source`), because "I never wrote that" about a note
  written on an iPad in another app is a genuinely confusing five minutes.
- A hand-typed rule and an uploaded document are **listed apart** on the page rather than mixed
  into one pile: they are read very differently — one is obeyed word for word, the other is a
  source of keywords.
- **A rule can be typed on a scanned ANSWER CARD, and it lands here** (scan v1.5.0, this app
  v1.317.0). When the Scan app's answer is not good enough the teacher corrects it there and says
  what should have happened in the same breath; that is written as an ordinary note in this
  collection — `guidance` for the rule (so it reaches every digest here, marking included),
  `keyFacts` for the corrected answer with its question above it (so it reaches an ANSWER and never
  the marker, which is the standing rule), and **`sourceQuestion` for the question it was written
  against**. `sourceQuestion` is for the READER and never for a prompt: the card shows it under
  *Written against*, because a rule the teacher can no longer place is a rule they delete — and the
  whole question in every prompt would drown the rule it was written to carry.
- Run **`node tools/teaching-notes-tests.mjs`** after touching any of it.

## 🔄 The notebook is LIVE, and it is shared (v1.310.0)

`loadTeachingNotes` / `_notesApplySnap` / `_notesDetach` / `stopTeachingNotes` /
`_notesLiveRepaint` / `_noteSuitsThisApp` / `_notesFor` (in `app.js`, search
`The notebook is LIVE`). **The collection `users/{adminUid}/teachingNotes` is written by three
apps** — this one, the Ans Key annotator (`polymathlc/anskey`) and the Scan app
(`polymathlc/scan`). Two things stopped a note written in either of the others from ever reaching
this app's prompts, and both were silent.

- **It was read ONCE at sign-in.** A `getDocs` meant this tab held whatever the notebook said when
  the teacher signed in and never looked again: a note typed on the iPad mid-lesson reached the app
  it was typed in and NO other, so the same question was marked against two different notebooks
  depending on which tab it was marked in. It is now an `onSnapshot`. Three rules hold that
  together, and each is a way it could go quietly wrong: **`_notesDetach` releases anyone waiting
  on the first snapshot** (a waiter holding a promise whose listener has just been unsubscribed is
  never answered, and `renderNotesPage` awaits it — the page would say "Loading your teaching
  notes…" for the rest of the session); the listener **comes down on sign-out**, or one account's
  notes go on grounding the next person to sign in on the device; and **`_notesLiveRepaint` yields
  to whatever is being typed**, because `notesRenderBody` rebuilds the whole page and a snapshot
  arriving mid-sentence would empty the upload comment box.
- **A general note only applied when nothing else did.** The other two apps write `topics` EMPTY on
  purpose — it is this app's syllabus list and they have never heard of it — so every note they
  write arrives here untagged. The digests treated untagged notes as a FALLBACK
  (`if (!rel.length) rel = untagged`), so the moment the teacher had one note of their own tagged
  "Heat", the entire shared notebook was dropped from marking a Heat question. **`_notesFor(topic)`
  is now the ONE place that is decided**: topic-matched notes first (so they win the character
  caps), general notes always after them.
- **…but a MATHS note is still not welcome.** The notebook is shared with an app that teaches both
  subjects, and a maths marking standard in a science prompt is worse than no note at all.
  **`_noteSuitsThisApp` is the ONE place that is decided** — a note naming no subject is for
  everything (which is what every note uploaded here looks like), one naming maths and not science
  is dropped, guidance included — so it cannot leak through whichever digest forgot to ask.
  **A dropped note is still LISTED on the Teaching Notes page and says it is dropped**, because a
  note sitting in the list reads as a note being followed.
- Run **`node tools/teaching-notes-tests.mjs`** after touching any of it.

## Versioning convention — applies to EVERY change (do this every time)
1. **Bump the version.** In `index.html`, update `const APP_VERSION = 'vX.Y.Z'` (search `APP_VERSION`). Patch bump for fixes/small tweaks, minor bump for new features.
2. **Keep it visible.** The version renders in the sidebar footer for admins only (`#appVersionBadge`, class `admin-only`). This is how the user confirms the latest build is actually deployed.
3. **Report it.** When summarising an update in chat, always state the new version number (e.g., "Shipped in **v1.0.3**").

The whole point: the user checks the version shown in the app's sidebar against the number reported in chat to know whether the upload/deploy went through. (The user wants this as a standing feature for all their projects — mirror this section into other repos' CLAUDE.md / their global memory.)

## Design convention — breathing space (applies to EVERY UI you build/touch)
- Give elements room to breathe: generous, consistent padding inside cards/banners, clear vertical spacing between title → description → meta → buttons, and comfortable line-height. Never cram content edge-to-edge or stack lines tightly.
- Cards/banners are rounded rectangles constrained to a sensible max-width (not full page width) and centered — not a dense, full-bleed block.
- When the user says something is "too big/thick/messy", the fix is usually *more* whitespace and a tighter width, not shrinking fonts until it's cramped.
- Keep spacing scale consistent across the whole app so every surface feels like the same design system.
- (The user wants this as a standing design principle for ALL their projects — mirror this section into other repos' CLAUDE.md / their global memory.)

## 📊 The Student Usage Tracker (v1.297.0)

`USAGE_MODES` / `usageMode` / `_sut` / `sutRender` / `sutVisible` / `sutByMode` /
`sutExportCsv` (in `app.js`, search `THE STUDENT USAGE TRACKER`), plus the
`#studentDetailOverlay` and the `.sut-*` CSS in `index.html`. Opened by clicking
a student anywhere on the Usage page. **The same block is in all four portals —
keep them in step**; only the collection constant and the mode table differ.

Every question one student has completed, the result they got, and the **mode**
they did it in. The attempt log was always being written; what was missing was a
way to READ it. The old drill-in listed the rows and nothing else, so a teacher
looking at four hundred attempts could not answer either of the two questions
they actually have — *what has this child been doing?* and *how are they getting
on in it?* A list that can only be scrolled is a list nobody reads.

- **`USAGE_MODES` is the ONE place a raw mode string becomes words.** The log
  stores `tcg-siege`, `quickpractice-open`, `snapmark-open` — internal names, not
  English. The chip, the breakdown, the filter dropdown and the CSV all read that
  map, so they cannot drift apart. A mode with **no entry still shows**, as its
  own raw string in the `other` group, rather than being dropped or folded into
  "Unknown": an unlabelled mode is a missing label, but a question dropped out of
  the log because nobody wrote a label for its mode is a **missing question**,
  and two unlabelled modes merged into one row is a breakdown that lies.
- **The breakdown BY MODE is the headline, not the log.** "43 in Quick Practice
  at 71%, 210 in Ember Siege at 88%" is what a teacher opened this for; the
  row-by-row log is the evidence underneath it. Practice modes sort ahead of
  games, so the schoolwork is read first even when a game has more attempts.
- **It renders from state.** `_sut` holds the attempts and the filters and
  `sutRender()` paints the whole overlay from them, so changing a filter never
  re-reads Firestore — sweeping through the modes is instant and costs nothing.
  `closeStudentDetail` clears `_sut.uid`, which is also what makes a reply from
  a superseded load harmless.
- **`sutVisible()` is the ONE place the window is decided**, and the count, the
  table, the breakdown and the CSV all read it. A CSV holding more rows than the
  table it came from is a teacher sending a parent a report of work in a mode
  they had filtered away.
- **The verdict threshold is the app-wide ≥0.95** that `progressOnMarked` and
  `lgNoteWin` already use, and `sutCredit` is FRACTIONAL — a half-marks open
  answer is **part right**, its own verdict, never rounded into a pass or a fail.
- **The title and topic are resolved from the BANK at read time**
  (`sutQuestionMeta`), not trusted from the attempt: the games log no title at
  all, and an edited question would otherwise wear its old title in the log
  forever. A question **deleted since** is marked *removed from the bank* and
  keeps its row — the work was still done.
- It is **READ-ONLY**. Nothing in the block writes anything anywhere.
- Run **`node tools/usage-tracker-tests.mjs`** after touching any of it.

### 📖 What they wrote, and the teacher's own mark (v1.323.0)

`_attemptAnswers` / `SUT_ANS_CHARS` / `SUT_ANS_PARTS` (beside `_setPartResult`),
and `sutOverrideOf` / `sutAnswerRowsHtml` / `sutOverrideHtml` / `sutToggleRow` /
`sutSaveOverride` / `sutClearOverride` in the tracker. Click any row in the log.

The tracker could say a child got **2 out of 3** and could never say what they
put. So every mark was unarguable: a teacher who thought the AI had it wrong had
nothing to look at, and a child saying *"but I wrote the right thing"* could not
be checked. An attempt stored a score and an `answerHash` — a 32-bit
fingerprint, one-way, and there only to stop the same answer being re-submitted
for the monthly tally.

- **`_openPartResults` already held it.** It is what the running score, the
  per-part feedback and the revision flashcards are all built from, so nothing
  new is computed at marking time — `_attemptAnswers` reads it out and writes it
  down. All THREE marked writers carry it (the whole-question mark, the per-part
  finalisation and the annotation path); they had to be changed together, and a
  fourth added later must be too.
- **The label is DERIVED FROM THE KEY**, never passed in. `_setPartResult` has
  six call sites across three marking paths, and a seventh argument threaded
  through all of them is six chances to forget one — a part logged with no name
  reads on the panel as an answer to a question nobody can identify.
- **Both caps matter.** An attempt is a document, a document dies at 1 MB, and a
  child pasting an essay into one blank must not be able to make their own
  attempt unwritable: a lost attempt is a lost mark.
- **The panel has THREE states and telling them apart is the whole job**: an
  attempt from before this shipped says the wording cannot be recovered; a GAME
  says it logs whether the answer was right and never what it was; everything
  else shows every part. An empty panel with no explanation reads as a broken
  feature, and a teacher who reads it that way stops opening it.
- **The answer is ESCAPED.** It is text a child typed, rendered into the
  teacher's page.

**The override is the TEACHER'S RECORD, not the student's points.** It changes
what this dashboard, its averages, its filters and its export say — which is what
a teacher marks and reports from. It deliberately does not reach back into XP,
gold or leaderboard standing: those were awarded on the student's own device at
the time, an admin **cannot write another account's hero doc at all** (that is
what the broadcast-marker pattern exists for), and minting points weeks later
would leave two boards disagreeing with nothing to say which is right. The panel
says so in as many words rather than leaving it to be assumed.

- **`sutCredit` is the ONE place the override is honoured**, so the row, the
  result filter, the by-mode breakdown, the summary cards and the CSV all follow
  from one line. A second reading of `override` elsewhere is how a row shows
  *Correct* while the average still counts it wrong.
- **A score that will not parse is NOT an override** (`sutOverrideOf`). A stray
  field must never silently rewrite a mark, and a row reading "overridden" with
  the AI's number under it is worse than one nobody touched.
- **The doc id must survive the read.** `showStudentDetail` keeps `d.id` now —
  a row that has forgotten which document it came from cannot be corrected.
- **Which rows are expanded is state (`_sut.open`), not a class on a `<tr>`** —
  the table is rebuilt on every filter change and after every override, so a
  panel opened by hand would snap shut under the teacher reading it. It is
  cleared on every fresh open, or rows left expanded from the LAST student would
  open different questions under the same ids.
- **A denied write is NAMED**: "this account is not allowed to update the
  attempt log" is a one-line rules fix, and *AI error* would send the teacher
  anywhere but the console.

⚠️ **`questionAttempts` is readable by any signed-in account** in the sibling
app's rules, and this app's rules live only in the Firebase console. These rows
now carry a child's own words, so that read rule is worth tightening to
`allow read: if isAdmin() || resource.data.uid == request.auth.uid;` — which
still serves both readers (the admin's unfiltered sweep, and a student's own
`where('uid','==',uid)` query for My Report).

- Run **`node tools/usage-tracker-tests.mjs`** after touching any of it.

### Every mode must actually log (v1.297.0)

The tracker is only as good as the weakest game: a mode that pays points and
writes no attempt is a mode whose questions the teacher cannot see at all, and
nothing on any screen says so.

- **`logGameAttempt(q, correct, mode, ms)` is the ONE door.** Three
  near-identical copies had already been written (the trainer, the duel, the
  Siege) and a fourth was simply missed — **Ember Legends called
  `rpgAwardGameQuestion` and logged nothing**, so a student could answer two
  hundred questions inside it and the tracker showed none of them. Adding a game
  is a call here plus a row in `USAGE_MODES`, never a fourth copy.
- **A mode arriving from an EMBEDDED GAME is checked, not trusted.**
  `_sdRecordAttempt` used to map anything unrecognised to `defenders`, so
  **Science Spire's questions were filed under a game the student never opened**.
  `SD_GAME_MODES` is the list; an unknown mode still falls back rather than
  writing a mode nothing can label.
- It is fire-and-forget, and the local rotation stamp comes FIRST: a failed log
  must never interrupt a game mid-answer, and a question answered offline must
  still stop being re-served.

## 🛟 Art safety & recovery — the art map is ONE document (v1.300.0)

`TCG_ART_BACKUP_DOC` / `tcgArtBackupSync` / `tcgArtRestoreBackup` /
`tcgArtExport` / `tcgArtImport` / `_tcgArtWriteMany` / `tcgArtRescue*` /
`_tcgArtLoadFailed` (search `ART SAFETY & RECOVERY`), plus the `#tcgArtSafety`
panel at the top of the Card Art tab and the `.tcg-safety-*` / `.tcg-rescue-*`
CSS in `index.html`.

Every picture in Realm of Embers — card art, `:av` battle avatars, `fx:` and
`dfx:` frames, `pk:` pack frames, `arti:`, `hero:`, `logo:`, `set:`, `lore:` —
is **one key in one Firestore document's `overrides` map**. Hundreds of hours of
generated artwork, and a single map deciding what the game shows.

**That map was lost once.** The Maths app (`polymathlc/math`) carries a port of
this game with the card ids deliberately kept identical (`c001`, `<id>:av`), it
was writing **this very document**, and its ♻️ Reset ALL art did
`setDoc(..., { overrides: {} })` — a whole-document overwrite. One press, both
games blank. That app has its own document (`novaArt`) and a surgical reset now,
so it cannot happen from that direction again; this section is what makes the
map survivable whatever happens next.

- **THE PICTURES ARE NOT THE MAP**, and that is the whole reason recovery is
  possible at all. Uploads are content-addressed into `cer-images/`, nothing
  here has ever deleted one, and the Maths app writes to `mathImages/`. The
  artwork outlives any accident to the index.
- **The backup MUST NEVER SHRINK.** A wipe presents as an empty map, so a
  backup that mirrored the live map would faithfully copy the wipe over the last
  good copy — turning the safety net into a second way to lose everything, at
  the exact moment it is needed. `tcgArtBackupSync` writes only when the live
  map holds **at least as many** pictures as the backup already does. Going
  backwards is always the ↩️ button, never something that happens by itself.
- **A failed read is NOT an empty store.** `_tcgArtLoadFailed` is what keeps
  "the network hiccuped" from reading as "your artwork is gone" — and the
  natural response to the latter is to redraw everything. It suppresses the
  backup (backing up an unreadable map writes "0 pictures" under a name that
  says the collection is safe) and the panel says so in as many words.
- **Restore, import and rescue are ADDITIVE, all three.** They exist to fill
  gaps, so every one of them writes only into slots that are **empty**. A
  recovery tool that overwrites work is the fault this section answers.
- **`_tcgArtWriteMany` is the ONE writer they share** — merged and chunked,
  never a whole-document overwrite.
- **🚑 Rescue matches on WHAT THE PICTURE SHOWS, not where it sits** (v1.301.0).
  The first version laid every run onto the whole dex in order, and it was wrong
  in the most misleading way possible: art is generated a SET at a time, so the
  National Day run got filed onto monster slots — human knights and sorceresses
  proposed for a tiger, a turtle and a polar bear, each captioned with a name
  that had nothing to do with the picture. **A nudge of one cannot cross a gap
  of a hundred**, so two things were added and both are needed.
  - **The SCOPE** says which family of slots a run belongs to (each set, or the
    whole dex). It narrows the target sequence *and* the AI's candidate list,
    which is why it earns its place twice: a National Day sorceress can never be
    offered a monster's slot. The worked example in the prompt uses an id **from
    that scope** — hard-coding `c001` was itself a suggestion to answer outside
    the list.
  - **🔍 Identify with AI** shows each picture to `askGeminiVision` with the
    scope's cards as candidates. Every card is a named character with an element
    and a creature behind it, so the model can say which it is and the admin can
    check it against the thumbnail beside it.
  - **The ALPHA CHANNEL decides card art from battle avatar**, never the model:
    card art keeps its painted scene and an avatar is background-stripped on the
    way into storage, so this is a fact about the file rather than a judgement.
  - **An identification always beats a position, and `identRan` is what keeps a
    guess from creeping back.** Once the pictures have been looked at, the
    positional proposal is dead — a picture the model could not name is left
    **unassigned** rather than filed under a guess, and one whose card is
    already in place is marked *✓ already in place* rather than reading as a
    failure. Nudging deliberately clears the identification, because a nudge
    means "match by position again"; without that the buttons would appear to
    do nothing.
  - Duplicates keep the **more confident** picture, an invented card id is
    dropped, and a slot that already holds art is never proposed.
- **The positional fallback is still there**, and it works because of what
  survives a wipe: the ORDER. `tcgGenerateAllArt` walks `TCG_CARDS` drawing each
  monster's card art and then its battle avatar, strictly one at a time, so a
  generation run lands in the bucket in exactly that sequence — and laying a run
  back onto that sequence reconstructs the map. It is a **proposal, never an
  automatic write**: card art is self-identifying (201 named monsters), so every
  picture is shown with the slot it is about to be filed into and nothing is
  saved until the admin says so. ◀▶ Nudge fixes a whole-run offset; ✂ stray
  takes one bad upload out of the sequence and pulls everything **below** it
  back into line, which is the correction that matches the actual fault.
- **A denied `listAll` is named precisely.** Listing needs `list` permission on
  the folder in the Storage rules, which is a *different* permission from
  reading a file by its download URL — so that one failure says so rather than
  reporting an empty bucket, which would read as "your pictures are gone too".
- 💾 Export is the off-platform copy, and it is the only one that survives the
  Firebase project itself going wrong: a backup document lives in the same
  project as the thing it protects.
- Run **`node tools/art-safety-tests.mjs`** after touching any of it.

## 🖼 The bundled Realm of Embers art — 659 pictures that ship with the app (v1.311.0)

`TCG_ART_ROOT` / `tcgBundledArtPath` / `tcgBundledArt` / **`tcgSlotArt`** /
`tcgSlotHasArt` / `tcgBundledSlotIds` / `tcgUseBundledRealmArt` (in `app.js`,
search `THE BUNDLED REALM OF EMBERS ART`), plus everything under
`assets/realm-of-embers/` and `tools/key-realm-sprites.mjs`.

A complete art pass for the realm now lives **in the repository** — 201 card
scenes, 201 battle avatars, 30 artifact objects, 180 elemental effect frames,
42 pack-tearing frames and 5 hero portraits. Before this the game had 201
monsters and 30 artifacts drawn as **emoji** unless an admin sat and generated
every picture by hand, one slot at a time.

- **It is a FALLBACK, not an import, and that is the whole design.**
  `tcgSlotArt(slot)` returns the admin's override if there is one and the
  bundled picture otherwise. Nothing is uploaded to Storage and nothing is
  written to `users/{uid}/settings/tcgArt` — so `_tcgArt` stays exactly what it
  was: the record of **what somebody has changed**, which is the only question
  the backup, the rescue proposal and the safety panel's counts can usefully
  answer. Copying 659 pictures into that map instead would have doubled the
  thing that has already been lost once (see **🛟 Art safety & recovery**) in
  order to store something git already holds.
- **`tcgSlotArt` is the ONE reader**, and `tcgSlotHasArt` is the ONE has-check.
  Every surface that puts a Realm picture on the screen goes through them —
  `tcgArtUrl` / `tcgAvatarUrl`, `tcgFxHas`, `tcgPackHas` / `tcgPackFramesFor`,
  `tcgHeroArtUrl`, `tcgArtifactArtUrl`, the Siege's frame preload, the pack on
  the shop card, the set banner's line-up of legends. A reader left on `_tcgArt`
  is a surface where the bundled layer silently does not exist, and the symptom
  is one screen in the game still showing emoji.
- **THE PATHS ARE DERIVED, NOT LISTED.** A card's file is its id plus the slug
  of its own NAME, an artifact is its id plus the slug of its name, an effect
  frame is its element and phase, and a pack frame is its set and tier — so a
  card or a set added to the dex needs nothing typed out here twice. The price
  is a rename: change a card's name and its picture is
  looked for under the new slug, is not there, and the card quietly falls back
  to its emoji. **That failure is silent in the app and loud in CI** —
  `tools/bundled-art-tests.mjs` walks all 659 slots against both the shipped
  slot map and the files on disk.
- **The sprites are keyed at BUILD time** (`tools/key-realm-sprites.mjs`). Most
  of the original sprite pass was drawn against a flat chroma wall; the
  app keys that wall out on the way
  through `_tcgArtStore`, and bundled art is served straight off the origin and
  never passes that door. The tool runs the app's own `_screenKeyOut` — extracted
  out of `app.js` the way `tools/chroma-key-tests.mjs` extracts it, never a
  second copy — against a canvas shim backed by `sharp`, and it is idempotent:
  a sprite already standing on nothing carries no wall and is left alone.
  - **Its one deliberate difference is that it keys with `strict` OFF**, and the
    reason is written out in the tool's header: these monsters defeat the
    enclosed-hole geometry test wholesale (a coiled serpent, a dragon's wing
    gaps and a ring of fire are all real wall seen through a real opening whose
    surrounding material is thicker than the opening is wide), and the fallback
    knock-out cannot reach an enclosed region at all, so refusing would have
    shipped those coils full of magenta. What makes the looser cut safe there
    and **not** at runtime is that it is a build step: the cut is pure colour,
    every result is verified (nothing the wall did not touch was removed, none
    of the wall is left anywhere, the sprite still has a body), a contact sheet
    is written for a person to look at, and the sources are in git.
  - **A wall is OPAQUE, and counting an empty pixel as evidence of one is the
    trap.** An already-cut sprite has a fully transparent border, which reads as
    a perfect ring of *every* colour at once — and the loser of that argument is
    whichever hue the artwork happens to contain. A blue dragon would have had
    its own blue keyed out on the second run. `detectScreen` therefore ignores
    transparency entirely.
- **Pack crop lines are removed from the files, not hidden with CSS.**
  `tools/clean-realm-pack-borders.mjs` clears the outer three-pixel crop edge
  on all 42 frames and removes only nearly-full-width bright source-sheet bands
  near the top. `--check` is the regression test; it also prevents a future
  sprite-sheet extraction from putting the thin white line back into the rip.
- **🔥 Use the bundled artwork** (`tcgUseBundledRealmArt`, on the Card Art tab's
  safety panel) is what is left of the old uploader: it **removes the overrides**
  on those 659 slots so the shipped picture underneath shows. Nothing goes blank
  — every slot it clears is a slot the app ships a picture for — and the backup
  still holds what was removed, because `tcgArtBackupSync` refuses to shrink, so
  ↩️ Restore puts it back. Like every other write here it is a chunked MERGE with
  `deleteField()`, never a whole-document set.
- **"Missing" now means NOTHING IS SHOWING**, for the generator's counts
  (`_tcgArtMissing`, `tcgGenerateAllArt('missing')`, `_tcgHeroMissing`,
  `tcgFxPhaseDone`, `tcgPackAnimReady`). Counting overrides would have put
  "402 pictures for 201 monsters" on a button beside 201 monsters the students
  can plainly see, and pressing it would spend hundreds of image calls redrawing
  artwork that is already there. Replacing the bundled set is ↻ **Redraw every
  monster**, which says so.
  - **The rescue and backup counts deliberately did NOT change.** They answer
    "what has an admin drawn that is now missing from the map", and an admin's
    own artwork is still lost even when a bundled picture is standing in front
    of the gap. The safety panel's alarm is the one that had to learn the
    difference: it now counts only backed-up slots that nothing at all is
    showing, or clearing an override would raise "art has gone missing" about
    art the admin had just chosen to stop using.
- Run **`node tools/bundled-art-tests.mjs`** after touching any of it.

## ✂️ What counts as INK, and the sentence above the figure (v1.324.0)

`_inkThreshold` / `INK_RATIO` / `_expandRectToWhitespace` / `_trimEdgeTextLines` /
`MAXRUN_FRAC` / `RUNS_MIN` / `RULE_FRAC` / `RULE_GROUPS` (in `app.js`, search
`WHAT COUNTS AS INK`). **`polymathlc/english`, `polymathlc/chinese` and
`polymathlc/math` carry the same block byte-for-byte — ship a change to all
four together**; `polymathlc/scan` carries the same statistic under its own
names (`_mbInkLevel`, `_mbTrimTextRows`).

Both pixel passes asked *"is this pixel darker than 190?"*, and on a SCREENSHOT
— white at 255 — that is exactly right. **⚡ Rapid add has taken camera
photographs since v1.290.0**, and a photograph of the same worksheet is grey:
the paper measures 180–200, the light slopes across the sheet, and 190 reads the
whole page as ink. Both passes then find one band covering everything and do
nothing at all — on every photograph, with nothing on screen to say they have
stopped working, and the crop quietly back to being whatever rectangle the model
happened to draw.

- **So the line is MEASURED.** `_inkThreshold` takes the paper's own white as
  the **98th percentile** of the luma over the rectangle being worked on, and
  ink is `INK_RATIO` of that or darker. The top 2% is given away deliberately:
  one specular highlight off a glossy sheet is 255 and is not what the page is
  made of, so the maximum would put the line highest on exactly the photographs
  that need it lowest. It is measured **locally**, over the crop rather than the
  sheet, which is also what makes it survive a shadow gradient across the page.
  On a clean screenshot it lands within a few levels of the old 190, so nothing
  about the screenshot path changes; a region it cannot read falls back to
  `INK_DEFAULT`, which IS the old 190.
- **A band is prose on FIVE counts now, and the last two are what stop a table
  or a graph being eaten a row at a time.** `MAXRUN_FRAC`: every scanline
  through print crosses letters, so the longest unbroken run of ink in a line is
  a few pixels — while an axis, a table border, a leader line or the top of a
  rectangle lays a run right across the band. **Density alone cannot see that**:
  a hairline rule across a wide crop is a fraction of a percent of its row's
  pixels, so the old "not solid" test passed it happily and the top came off the
  table. `RUNS_MIN`: a line of print breaks into dozens of separate runs, a
  stroke or a blob into one or two.
- **A FRAMED TABLE is not trimmed at all.** `RULE_GROUPS` full-width rules in
  one crop is a ruled table, whose every row is short, wide and full of letters —
  prose on every count that reads a row on its own, and trimmed row by row it
  comes back as its own bottom two thirds, which is the one wrong crop that
  looks completely convincing. **Four rules and not three**: an ordinary boxed
  diagram is a rule top, a rule bottom and a divider across the middle, and at
  three this would stand down on half the figures it was written to clean.
- **A RUN OF CONSECUTIVE LINES goes together.** Two lines of a question sit a few
  pixels apart, far less than the clear band that separates the wording from the
  figure — so insisting on clear paper after the FIRST line finds none, stops,
  and leaves both lines on the picture. The cut is remembered only where a run
  reached real whitespace, so a band with nothing but figure after it is still
  never touched.
- **AND THEN THE BLANK PAPER ITSELF.** Whatever survives, the edges are pulled in
  to the first and last row with any ink in it. It is the one move here that
  cannot be wrong — it removes measured empty paper and nothing else — and it is
  what `_expandRectToWhitespace` structurally cannot do, because that one only
  ever grows.
- **`_aiRefineCrop` is unchanged and still runs on top.** These passes are free,
  instant and deterministic; the AI pass costs a call per figure and catches what
  pixels cannot. Neither replaces the other.

### 🔢 Picture answer options are ONE picture

`_rectangleRules()` said, flatly, to EXCLUDE the answer options from every
rectangle — right when the options are words, and the reason a question whose
four choices are little DRAWINGS came out of Rapid add with its choices missing
altogether. The rule now has two cases, and the picture case asks for **ONE
rectangle round all four together** with their (1) (2) (3) (4) labels. Four
separate rectangles would lose the row they were printed in, come out at four
different sizes, and stop reading as a set of choices — a student answering
"(3)" cannot see which one (3) was. It needs nothing downstream: it is one more
ordinary `image` block, so `_autoFillDiagramsFromBoxes` crops it like any other.
`polymathlc/scan` sends the same thing as a block wearing `role: 'options'`,
because its viewer prints a word list underneath and has to know to stop.

## 🧻 Clean paper — the faint diagonal weave on a printed diagram (v1.299.0)

`PAPER_*` / `_paperWhitePoint` / `_paperCleanPixels` / `_paperCleanDataUrl` /
`generateCleanEnhancedImage` (in `app.js`, search `CLEAN PAPER`), plus
`annotCleanPaper` and its 🧻 button in the Touch up toolbar.

**Where the stripes come from.** Nothing in this app draws them — there is no
diagonal pattern in the print CSS, no watermark step, and nothing striped
behind a transparent PNG. They are baked into the picture's own pixels, and
they get there on the way IN: a question's diagram is passed through an image
MODEL (`_BW_ENHANCE_PROMPT` — *"clean this scan up into a sharp black-and-white
line diagram"*), and an image model has no notion of a flat, uniform white. It
PAINTS the background like everything else, and its decoder leaves a faint
regular weave — most often a diagonal hatch a few units off white. The prompt
already forbids textures in as many words and the model still does it, because
this is not the model choosing to add a texture: it is how the picture is
reconstructed. **A prompt cannot fix it, which is why the fix is pixels.**

It is invisible on screen at 300px and obvious on paper, which is why it turns
up as a printing complaint: a laser printer has to halftone that near-white, so
a 4-unit weave becomes a visible stripe across the whole figure.

- **`_paperCleanPixels(px, w, h)` is the pass**: measure the paper's white point
  and snap everything within `PAPER_TEX_DEPTH` of it to pure white. That is the
  white-point clamp a scanner driver does, and it takes out the weave, a grey
  scan background and a faint printed watermark alike — all three are the same
  thing, near-white low-chroma pixels that are not the drawing. No AI: the same
  picture must always come out the same way.
- **The white point is the 98th PERCENTILE, never the maximum.** One blown-out
  speck is 255 whatever the page really is, and on a grey scan that difference
  is the whole pass.
- **Three guards, and a refusal writes NOTHING.** The background has to be
  bright (`PAPER_WHITE_MIN`), it has to be most of the picture (`PAPER_BG_MIN`),
  and there has to be line work to protect (`PAPER_INK_MIN`). A photograph of an
  experiment has bright areas and no line work, and flattening its highlights
  into a plate is exactly the quiet damage the game-art cutters are so careful
  about. Half-cleaning a picture is worse than leaving it alone, so the whole
  pass is all-or-nothing.
- **A pale wash of real COLOUR is part of the drawing** (`PAPER_TEX_CHROMA`) —
  the blue of water in a beaker is bright and nothing like grey, and whitening
  it deletes half of what the question is about. A deliberate grey shading sits
  well below `PAPER_TEX_DEPTH` and is kept for the same reason.
- **A hole stays a hole.** Transparent pixels are skipped and are left out of
  the white-point measurement entirely, or a cut-out sprite comes back boxed.
- **`generateCleanEnhancedImage` is the ONE door every diagram re-render goes
  through** — the three `_BW_ENHANCE_PROMPT` sites (rapid add / the crop flow /
  the whole-screenshot backup) and the ✨ Enhance / 🎨 Colourise button. A picture
  cleaned on one authoring path and not on another is exactly the drift the
  shared print helpers exist to prevent. It never throws: a picture that could
  not be cleaned is handed back as it arrived.
- **The two annot AI patches are deliberately NOT cleaned.** `annotSelAiFill`
  and `annotAiRegen` return a patch that has to disappear into the picture
  around it — `ANNOT_AI_KEEP` asks the model to MATCH the grain of a scan rather
  than clean it up — so whitening its background would leave a bright rectangle
  on a grey page.
- **🧻 Clean paper is the manual twin, for pictures already in the bank.** Those
  were re-rendered before the cleaner existed and carry the weave in their
  stored pixels; nobody is going to reopen a thousand of them, but the one being
  touched up anyway is a tap away. One history step, so ↶ Undo puts it back.
  Every refusal is NAMED in the toast — "nothing happened" on a button is the
  one outcome nobody can act on.
- PNG in, PNG out. A JPEG step here would put its own texture back and flatten
  any transparency to black.
- Run **`node tools/paper-clean-tests.mjs`** after touching any of it.

## 🔘 A printed MCQ has somewhere to write the answer (v1.298.0)

`_printMcqBlockHtml` / `_printMcqAnswerBoxHtml` (in `app.js`, search `A printed
MCQ needs somewhere to WRITE THE ANSWER`), plus the `.print-mcq-answer*` rules
inside `index.html`'s `@media print` block.

On screen an MCQ is answered by tapping an option, so nothing has to be written
down — and the printed sheet inherited exactly that: four options, a radio
circle beside each, and no answer box anywhere on the page. A student writes
their choice in the margin, thirty students write it in thirty different
places, and the teacher marking the pile has nowhere to look. Every past paper
this app READS prints the bracket; the worksheets it printed did not.

- **`_printMcqBlockHtml(block, part)` is the ONE place a printed MCQ is built**,
  and BOTH print paths call it through an explicit `case 'mcq'` —
  `doPrintWorksheetOpen` and `buildWorksheetHtml`. Those two switches had
  already drifted apart once over the answer KEY (path A keyed MCQs, path B did
  not), and a shared function is the only thing that stops the same thing
  happening to the sheet itself. The drift is silent: the box appears on a
  worksheet printed from the bank and not on the same worksheet printed from
  📄 My Worksheets.
- **Taking the MCQ out of the `default` branch takes it away from
  `_pushBlockAnswerKey`**, which is called there. Both new cases push it
  explicitly, or a mostly-MCQ paper goes back to printing a key that silently
  skips most of its questions — which is the exact bug v1.284.0 fixed.
- **An MCQ with NO options gets no box.** There is nothing to choose, so there
  is nothing to write: a box there is a mark the student can never earn, and an
  empty bracket under a blank question reads as a printing fault. Same rule as
  `syStudentHtml` refusing a block with nothing given.
- **The part letter is printed ON the box** (*Answer (b):*), from the same
  `qPartOf` map the rest of the page reads, so the label on the box and the
  label on the key cannot disagree. A question with parts prints three of these
  down one sheet, and three identical unlabelled boxes is exactly the confusion
  parts exist to prevent.
- **`renderImportedBlockStudent` is untouched.** It is shared with practice, and
  a bracket rendered there would put an empty box under every MCQ a student
  answers by tapping.
- The box is **one line and right-aligned**, and that is deliberate: a tall
  bordered box on this sheet already means an open-ended writing box
  (`.print-open-answer-box`), and a printed MCQ must not look like it wants a
  sentence. It carries `break-inside: avoid` so it is never stranded at the top
  of the next sheet away from the options it belongs to.
- The extra height is measured, not assumed — it goes through the print planner
  like everything else (see **The print planner must MEASURE**), so the
  two-compact-MCQs-per-page packing re-plans around it for free.
- Run **`node tools/print-mcq-box-tests.mjs`** after touching any of it.

## The clone stamp shows what it is about to stamp (vv1.294.0)

`_annotClonePeekSrc` / `_annotUpdateClonePeek` / `ANNOT_PEEK_MIN` and the
`#annotClonePeek` canvas inside `#annotBrushRing` (search `The clone stamp's
live preview`).

The source pin says where the copy comes FROM and the brush ring says how big
the mark will be. Neither says what the mark will BE, so lining a stamp up
meant clicking and then looking at what landed — and undoing it when it was
half a letter out. **The ring is now filled with the patch that would be
stamped this instant**: a lens on the source, carried under the pointer, at the
same zoom as everything else.

- **It lives INSIDE the ring**, so it is positioned, sized and hidden by exactly
  the code that already does all three for the ring. `_annotUpdateBrushRing` is
  still the ONE place either of them moves.
- **The source point is different before and during a stroke, and getting that
  backwards is the silent failure.** Before the first dab there is no offset, so
  starting the drag here is what would put the source POINT under the pointer —
  the preview is centred on `cloneSrc`. Mid-stroke the offset was locked in at
  pointer-down, so it is `(pointer in image px) − cloneOff`, which drifts away
  from the mark at the speed of the hand if it is computed the other way round.
- **`_annot.ptr` is in STAGE coordinates and the source is in IMAGE pixels**, so
  zoom and pan come off first. Read it raw and the preview is right only at 100%
  with no panning — which is how the editor opens, and therefore how anyone
  would check it by hand.
- **Mid-stroke it reads `cloneSnap`, not the live canvas** — the stamp reads the
  frozen snapshot, so dragging back over ground already covered would otherwise
  preview the copy instead of the source, and the two diverge exactly where it
  matters.
- The backing store is the brush in **image** pixels, so the preview is
  pixel-for-pixel what the dab puts down however far the view is zoomed; under
  `ANNOT_PEEK_MIN` (14) screen px there is nothing to see in the ring and it is
  not drawn. The ring goes white-on-black while it is previewing — a black
  hairline over arbitrary artwork is the one thing that disappears.
- Run **`node tools/clone-preview-tests.mjs`** after touching any of it.

## ✨ Regenerate — say what you want and the AI redraws it (vv1.294.0)

`annotAiRegen` / `_annotAiBarInit` / `_annotAiSyncScope` / `_annotSelBox` /
`ANNOT_AI_KEEP` (search `REGENERATE`), plus the `#annotAiBar` under the
selection bar in the Touch up editor.

AI content-aware fill answers exactly ONE question — *take this out* — with a
prompt nobody can change. Everything else an author actually wants of a picture
("rub out the pencil marks", "make the arrow red", "redraw this beaker
cleanly", "put the missing axis label back") had **no door at all**. This is
that door: a line to type in, and the same image model behind it.

- **TWO SCOPES, and the difference between them is the whole safety story.**
  With an area SELECTED only that area may change: the model is shown the
  picture with the area **RINGED rather than blanked** — "make the arrow red"
  needs the arrow still visible, which is exactly what content-aware fill's
  magenta blanking destroys — and the reply is composited back through
  `_annotWithSelClip`, so a model that quietly rewrote the whole page cannot
  touch one pixel outside the selection. With NOTHING selected the whole picture
  is redrawn, which is the honest reading of "no area chosen".
- **The bar NAMES the scope it is about to use** (`_annotAiSyncScope`, kicked
  from `_annotSelSyncBar`), because those two are very different things to press
  a button on.
- **The magenta marker is drawn just OUTSIDE the selection**, so it never covers
  the content the instruction is about — and anything of it that survives into
  the reply is outside the clip and therefore cannot be composited back.
- **It is ONE history step either way**, so ↶ Undo puts the original back. That
  is what makes an experimental prompt cheap enough to actually experiment with.
- The whole-picture branch **clears the canvas and draws**, never a `'copy'`
  composite: a canvas stranded in a composite mode erases everything drawn
  afterwards (the same trap `_annotResetCompose` exists for).
- `_annotAiBarInit` runs on every open, so **last picture's instruction is never
  left sitting in the box** one Enter away from being run on this one.

## ✍️ AI complete — carry the paragraph on from where you stopped (v1.302.0)

`completeBtnHtml` / `_aicTrimEcho` / `_aicJoin` / `_aicUnquote` / `_aicAppendInto`
(search `✍️ AI COMPLETE`), plus the ✍️ **AI complete** button beside ✨ Improve
and ✂️ Shorten on every prose box in the question editor. **All four portals
carry the same block — keep them in step**; only the subject line of the prompt
differs.

An author half way through writing a passage, a model answer or an explanation
had two AI buttons and both of them *rewrote what was there*. Neither is any
use to somebody who has stopped mid-sentence and wants the rest — so the thing
they actually wanted, they typed themselves.

- **It only ever ADDS, and that guarantee is STRUCTURAL rather than something
  the prompt asks for.** ✨ Improve and ✂️ Shorten hand their reply to a setter
  that REPLACES the whole box; `_aicAppendInto` appends, and the existing markup
  is never re-serialised. So nothing the model returns can change a word that is
  already there — and the author's own bold, underline and pasted pictures
  survive, which a plain-text round trip would flatten.
- **`_aicTrimEcho` is the net, because the model restates before it continues.**
  Asked to carry on, it very often repeats the last sentence first, and now and
  then the WHOLE paragraph. Appended verbatim that puts the author's opening in
  the box twice, which reads exactly like the button having mangled it. Whatever
  of the existing text the reply opens with is cut — matched on
  whitespace-folded, lower-cased text so a reply that reflows the spacing is
  still caught, and **longest tail first**, or a shorter match leaves the rest of
  the repeat behind.
- **The other direction is the one that eats the work.** A trim firing on a
  coincidental few characters throws the real continuation away, so
  `AIC_ECHO_MIN` (10) is the floor below which an overlap is treated as
  coincidence. Both directions are silent and the app works either way.
- **`_aicJoin` never welds a space between two CJK characters.** 中文 and 华文 are
  written without them, so a space there is a space in the middle of a word;
  latin either side needs one, and a trailing space the author typed is not
  doubled. It is in all four portals, not just the Chinese one — a 华文 name or
  a quoted phrase turns up in any of them.
- **execCommand is what makes it cheap to try**: it keeps the browser's own undo
  stack, so ONE Ctrl+Z takes the whole completion back off again. The caret is
  moved to the END of the box first — appending at the caret (which is what
  🎤 Dictate does) would drop a completion into the middle of a sentence.
- **An empty box is refused.** Writing from nothing is a generated question,
  which is a different job and a different button; this one carries on from what
  is there.
- **The model is told to finish ASKING a question, never to answer it** — a stem
  the author is still writing must not come back with its own answer appended.
- **It shares `.improve-btn` for its looks, so ✨ Improve's handler needs a
  guard.** Improve is the one that runs on the bare class; without
  `contains('complete-btn') return` one press runs BOTH, and Improve rewrites the
  box — the exact damage this button promises never to do, delivered by the
  button itself. ✂️ Shorten has carried the same guard from the start.
- Run **`node tools/ai-complete-tests.mjs`** after touching any of it.

## 🔎 Why not this one — the ⓘ on a marked MCQ's wrong options (v1.303.0)

`wny*` (in `app.js`, search `WHY NOT THIS ONE`), plus `_mcqPaintResult`, the
`.wny-*` / `#wnyPop` CSS in `index.html`, and the ⓘ **Why the other options are
wrong** switch on all four print surfaces — the worksheet builder, the 📄 My
Worksheets card, the 🖨 print picker and the past-papers toolbar.

Being told **✗ incorrect, the answer is 2** teaches nothing. On an MCQ-only
question it is *all* a student is told — `_genAndShowExplanation` writes an
A.I. Explanation only when the question has an OPEN part — so a whole paper of
multiple choice ends at a red border and a green one. Now every option they did
not get right grows an ⓘ, and it says why *that* one is wrong against the
evidence actually printed in the question: *"There are only 2 populations of
producer — arrowhead and water lily — so 3 is wrong."*

- **IT IS A VISION CALL, and that is not an optimisation waiting to happen.** A
  science distractor is almost always wrong because of what a food web, a
  circuit, a table or a graph SHOWS. "Only 2 producers" cannot be said from the
  wording alone, and a reason that does not point at the evidence is the "this
  is incorrect" the student already had. `_cqMedia` attaches the diagrams and
  `_cqRepr` spells the tables out — both borrowed from ✅ Check Questions rather
  than forked, and for the same reason that page's AI pass may not be
  downgraded to `askGemini` either.
- **It arms only AFTER marking, from `_mcqPaintResult`.** That painter is new:
  all three marking paths — whole-question marking, the local per-part mark and
  the AI per-part mark — carried their own copy of the colouring loop, which is
  exactly how the ⓘ would have ended up on two surfaces out of three and
  mysteriously missing on the third. Armed a moment earlier it is an **answer
  key**: the badges go on the WRONG options, so before marking they would point
  straight at the right one. `resetOpenAnswersIn` disarms for the same reason —
  a reset question that kept them is an open-book retry.
- **The badge is on the wrong options only.** The right one is already painted
  green with the answer beside it; an ⓘ there would be a second way of saying
  the same thing, on the one option that needs no defending.
- **ONE call covers the WHOLE option list.** The model has to see the four
  together to say why this one beats that one, and the student reads two or
  three in a row.
- **A reason is placed against an option by the option's OWN number** and
  nothing else (`_wnyNormItems`, through the shared `_normMcqChoice`, so "(2)",
  "2." and "B" all land on option 2). This is the one failure the feature
  produces silently: a reason shown under the wrong option reads perfectly and
  teaches a child something untrue about a question they have just got wrong.
  Positional order is the fallback and **only** when the model numbered nothing
  at all and returned exactly one entry per option.
- **`_wnyUsable` refuses a question with no correct option ticked.** "Why is
  this one wrong" has no answer when nothing is recorded as right, and a badge
  that cannot keep its promise is worse than no badge. That gap is an authoring
  fault, and ✅ Check Questions is where it gets found.
- **`_wnyOpts` is the ONE normaliser, and it is what keeps the two surfaces
  honest.** The marking store carries `.letter`/`.correct` per option; a raw
  block carries `options[]` plus a separate `correctId`. Both go through it, so
  the prompt — and therefore the cache key — is the same string either way: a
  student's hover and a teacher's printed key are the same sentences, and the
  print does not re-bill what the hover already paid for.

### …and the same reasons on the printed key

- **`wnyPrepare` is the pre-pass**, run BEFORE the sheet is built: the notes
  have to be in hand when the answer key is assembled, and the planner measures
  the finished page, so a note arriving afterwards would not be counted in the
  page it has to fit on.
- **It is OFF by default and says what it costs** — one AI call per
  multiple-choice question, `WNY_PRINT_PAR` at a time, on the progress bar the
  print already owns. They are cached by prompt, so re-printing the same paper
  in the same sitting is free.
- **Nothing is written anywhere.** The notes live in memory and in
  `sessionStorage`; no path here touches the bank. A question whose call fails
  simply prints without its notes — a printed key quietly carrying a WRONG
  reason would be far worse than one carrying none.
- **`_pushBlockAnswerKey(sections, block, part, why)` is where the rows are
  built**, threaded through that ONE pusher rather than added to each print
  path's own switch. Those two switches had already drifted over the MCQ answer
  itself once (v1.284.0); a key that carries the reasons from one print button
  and not the other is that same fault wearing a new hat.
- **The correct option is never listed among the reasons it is not the answer**,
  and the section is only ever pushed BESIDE a real answer — these are teaching
  notes, and offering them where the key cannot even name the answer would be
  the wrong way up.
- **The live A4 preview shows the notes it ALREADY has and never fires a call**
  (`_wnyCachedNotes`). It is redrawn on every page-break click, and one AI call
  per MCQ on each of those is not a preview, it is a bill. The divergence from
  the printed sheet is confined to the answer key's own pages at the back: the
  breaks the teacher is arranging are on the QUESTION chunks, and these notes
  never touch one.
- **`WNY_SWITCHES` names the checkbox for each surface and an unknown surface
  returns false.** A default that fell through to another page's checkbox would
  honour a switch the teacher set somewhere else, on a print they started from
  here, with nothing on the screen able to explain it. The past-papers toolbar
  is rebuilt on every data change, so its box carries its own state across the
  re-render or a tick set a moment ago is silently undone.
- Run **`node tools/why-not-tests.mjs`** after touching any of it.

## 🖼 Auto diagram — the answer key drawn, not just written (v1.304.0)

`akd*` (search `AUTO DIAGRAM`), plus the `.akd-*` CSS in `index.html`, the bar
on the question's 📝 **Answer-key explanation & picture** panel and the same bar
inside every 🔑 `answerKey` block.

An answer key says what the answer IS. A diagram says why — the beaker with the
arrows on it, the four stages labelled, the circuit with the break marked. A
teacher draws one on the whiteboard every lesson and it never reaches the
printed key, because drawing it properly takes half an hour.

🖼 **Auto diagram** reads the question AND its answer and draws one, into the
answer-key picture slot that already exists — so it prints on the key, beside
the answer, with no other plumbing.

- **THE LABELS ARE THE PART TO CHECK, and the app says so out loud.** An image
  model draws a beaker perfectly and then letters it "watr vapuor" — the same
  weakness `TCG_BANNED_PROMPT_RE` exists for elsewhere in this file. That is not
  a reason to skip the labels (an unlabelled science diagram explains nothing);
  it is the reason ✏️ **Touch up** sits on the same row, and why every toast
  that finishes a generation says to check them.
- **It is drawn for PAPER.** The key is printed and photocopied, so
  `AKD_PRINT_RULES` — the ONE place the style is stated, shared by the first
  draw and every regeneration — asks for black line-work on plain white, one
  idea, few large elements, colour only where it carries meaning, and labels of
  1–3 words. No title in the picture: that is the thing that always comes out
  as gibberish.
- **`generateImageDataUrlGemini` takes exactly ONE reference picture**, so which
  one it is decides what the button does. Drawing fresh passes the QUESTION's
  own figure, so the answer diagram shows the apparatus the student was looking
  at rather than a stock drawing of a different one — and the prompt has to say
  in as many words that it is *not* the thing to hand back, or the model returns
  it unchanged. 🔄 **Regenerate** passes the CURRENT diagram instead, so "make
  the arrows red" edits that picture. Two buttons, because they are two
  different intentions and one would always be the wrong one.
- **The instructions box outranks the rest of the prompt**, is clipped to
  `AKD_NOTE_MAX`, and is REMEMBERED — on the block for a 🔑 block
  (`block.diagramNote`), and on the question for the panel
  (`q.answerKeyDiagramNote`, which therefore has to be in
  `EDITOR_OWNED_QUESTION_FIELDS` or `carryOverQuestionMeta` restores a note the
  author just cleared).
- **`_akdMake` is the ONE generator** both surfaces call. Two would be two
  prompts to improve and two to keep in step.
- **The result goes through `_paperCleanDataUrl`**, the same pass an enhanced
  scan takes: an image model has no flat white, so it leaves the faint weave
  that prints as a grey wash. It returns `{ url, report }`, not a bare url, and
  a refusal hands the picture back untouched.
- **Drawing over a picture that is already there asks first; regenerating does
  not** — 🔄 *is* the redraw the confirm would be offering.
- **Nothing is written until the question is saved.** The diagram is uploaded to
  Storage (it must be, to have a URL) and the URL goes into the editor's own
  field, exactly where 🖼 Upload answer-key image puts one.
- Run **`node tools/auto-diagram-tests.mjs`** after touching any of it.

## 🎨 Photo Editor — the touch-up tool on its own (v1.304.0)

`pe*` / `annotDownloadPng` (search `PHOTO EDITOR`), plus `#page-photoedit`, its
`admin-only` nav item and the `.pe-*` CSS. Admin only.

The touch-up editor already does erase, paint, fill, clone, history brush,
select / lasso / wand, move, resize, rotate, skew, straighten, line, text,
paste-in, AI content-aware fill and ✨ Regenerate. Everywhere else it is reached
THROUGH something and writes back to that thing. This page is the same editor
with nothing behind it: bring a picture in, edit it, take a PNG away.

- **It is the SAME editor, not a copy.** `_annotOpenSrc` already takes a
  `target` saying where ✓ Apply writes back to; this adds one more kind
  (`standalone`) and one branch in `applyAnnotTool`. A second editor would be a
  second editor to fix every bug in — and it is what the CER app's ✏️ Touch up
  rule has said since v1.278.0: add a destination by adding a branch, never by
  forking the tool.
- **Admin-only in TWO places.** The nav item carries `admin-only`, `photoedit`
  is not on `EMPLOYEE_PAGES`, and `navigateTo` sends anyone else away. Hiding a
  nav item is not a lock.
- **Three ways in, one door.** Paste, drop and the file picker all end at
  `_peOpen`. The picker's `value` is cleared BEFORE the read, or the same
  picture chosen twice fires no `change` and the second attempt does nothing.
- **The page's paste stands down while the editor is open**, because in there
  Ctrl+V means something else and equally wanted: it drops a picture ONTO the
  one being edited.
- **⬇️ Download PNG is on EVERY target**, not just this page — a diagram worth
  keeping outside the app is one click, and it never leaves the editor. PNG end
  to end, so anything cut out to transparent stays transparent.
- **A picture scaled down on the way in SAYS SO.** The canvas is capped
  (`ANNOT_MAX_PX`, and `ANNOT_MAX_PX_STANDALONE` here) because ten full-frame
  undo snapshots sit behind it. A downloaded file quietly smaller than what went
  in is the one thing a picture editor must never do without saying so.
- **Erasing CUTS here** (`eraseTo`), as it does on a game art slot: a scanned
  question is paper, and a picture on its way to a PNG is not.
- **Nothing is uploaded and nothing is saved.** ✓ Done *is* the download, and
  that branch returns before any upload the other targets do.
- Run **`node tools/auto-diagram-tests.mjs`** after touching any of it.

## ⏳ Still loading — the bar on a question whose pictures have not arrived (v1.305.0)

`imgWait*` / `_imgWait*` / `IMG_WAIT_*` (in `app.js`, search `STILL LOADING`),
plus the `.imgwait-*` CSS in `index.html`. Emitted at the top of every question
body by `buildOpenBody`.

A question is text and pictures, and the text lands first. On a slow school
connection a diagram can take twenty seconds, and until it does the student is
looking at a question with a gap where the thing they need is meant to be —
with nothing on screen saying the gap is temporary. They answer around it, give
up on the question, or reload and start the wait again. All three are the app's
fault, not theirs.

- **The bar is HONEST.** The fill is `loaded / total`, counted from the real
  `<img>` elements — never a timer pretending to be progress. What a timer *can*
  say is that something is still happening, so the TRACK carries a moving stripe
  while anything is outstanding: it never looks frozen at 0 of 1 and it never
  claims progress it has not made. Keep those two separate if you touch it.
- **`buildOpenBody` is the ONE hook**, because it is the one renderer every
  practice surface goes through — practice, quick practice, topical, the student
  view, the worksheet preview, Snap & Mark, Ai-nstein's quiz. Ten call sites,
  one bar. `_scheduleImgWait` mirrors `_scheduleAnnotInit` exactly (rAF plus an
  80ms fallback), because the body has to be in the DOM before its pictures can
  be found.
- **It only appears when there is a wait.** `IMG_WAIT_GRACE` is a beat before it
  is drawn at all — a cached picture is there in 20ms, and flashing a loading
  bar on every question is worse than the problem it fixes.
- **An ERROR is an END, and `_imgWaitDone` checks that flag FIRST.**
  `handleImgError` replaces a picture that failed twice with a "could not be
  loaded" box, and the detached element it leaves behind can sit at
  `complete === false` for ever. A bar waiting on that is exactly the frozen bar
  this exists to prevent. The `load` listener is deliberately NOT `{once:true}`:
  `handleImgError` retries once with a cache-buster, so a load can follow an
  error and clear the flag again.
- **`data:` pictures and an `<img>` with no `src` are never waited on** — the
  first is already here, the second is a placeholder, and both would wait for
  ever.
- **Past `IMG_WAIT_SLOW` the wording changes and a Retry appears**, which
  re-requests only the pictures still out, cache-busted (the same move
  `handleImgError` makes on a failure) and restarts the clock.
- **One watcher per surface**, keyed by container selector exactly as
  `_openItemsStore` is, and `resetOpenAnswersIn` stops it — a re-render would
  otherwise leave a second watcher counting the same pictures.
- `role="status" aria-live="polite"`, and both animations are dropped under
  `prefers-reduced-motion`.
- Run **`node tools/auto-diagram-tests.mjs`** after touching any of it.

### 🖼 What the auto diagram IS — and what it is not (v1.305.0)

It is an **optional teaching picture for the answer key**. It explains the
answer; it is not part of the question, and it never asks a student to draw or
upload anything. A question students annotate is `q.annotation` — a separate
flag with its own pads, its own `answerImg` model answer and its own AI check.
Nothing in `akd*` touches either.

- **The one place it reaches a student is `showExplanation`**, the ONE builder
  of the post-marking cards, so it appears beside ✅ Model answer and only once
  the question has been marked. Shown any earlier it would be the answer,
  printed above the question. `_qAnswerDiagrams(q)` is the ONE reader — the
  question's own `answerKeyImage` plus every 🔑 `answerKey` block's `url`,
  deduped — and it is called from that card and nowhere else.
- A 🔑 `answerKey` block still renders as **nothing** inside the question
  (`renderImportedBlockStudent` returns `''`). That is what keeps the words of
  an answer key out of the question while the picture is revealed afterwards.
- The editor says all of this in as many words, because the panel sits directly
  under the ✍️ Annotation question checkbox and the two are easy to confuse.

## 🎯 The siege squad — three per role, chosen before the gate opens (v1.308.0)

`EMS_SQUAD_PER_ROLE` / `emsSquadClean` / `emsSquadDefault` / `emsSquadSaved` /
`emsSquadStore` / `emsOpenSquad` / `emsLaunch` (search `CHOOSING A SQUAD`), plus
the `.ems-pick-*` CSS in `index.html` and `siege.squad` on the save.

A collection past 150 monsters turned the deck column into a scroll: six
shelves, forty tiles on some of them, and a wave walking on the gate while the
student hunts for the healer they meant to summon. Shelving by role was the
first half of that fix; this is the second — **a run is fought with a SQUAD
chosen before it starts**, at most three from each role, so the deck is a dozen
tiles that all fit without scrolling.

- **It is a FILTER on the deck and nothing else.** Every monster is still owned,
  still levels, still fights in the Arena, the Dungeon, a duel and Legends. What
  the squad decides is which of them are on the bench for this siege.
- **The cap is PER ROLE, never a flat total.** "Three of each" is a line-up a
  student can reason about; a flat eighteen is the same hunt with a shorter
  list, and it lets somebody field eighteen attackers and no healer — which is
  the mess this exists to end, wearing a tidier heading.
- **`emsSquadClean` is the ONE place the cap and the ownership test are
  applied**, and every read goes through it: the saved squad, the pick screen's
  ⚔️ Start, and the run itself. A card merged away, sold, or carried in from
  another account's save drops out rather than sitting on the bench as a tile
  that costs mana and summons nothing.
- **A squad is never EMPTY.** The deck column is the only way to summon
  anything, so an empty one is a game that renders perfectly and cannot be
  played. `emsSquadDefault` fields the best three of every role (by
  `tcgCardPower`, so BOTH progression tracks count), `emsSquadSaved` falls back
  to it, and `emsRenderDeck` falls back to it again.
- **The squad is REMEMBERED** on `siege.squad`, so a student who has settled on
  a line-up is not made to re-pick it every run. `tcgHydrateState` is a
  **WHITELIST**, so that field has to stay in its `siege` literal or it is
  dropped on the next load — and it validates OWNERSHIP only: the per-role cap
  is applied on the way out, because the `EMS_*` constants sit far below the
  hydrator and reading one from up there is the temporal-dead-zone trap this
  file documents elsewhere.
- **The pick screen is its own overlay, shown BEFORE the battlefield exists.**
  The field, the FX preload and the wave timer all start on ⚔️ Start
  (`emsLaunch`, which is the old `emsOpen` body), so nothing is running behind a
  student who is still choosing.
- **A full role REFUSES a fourth rather than swapping one out.** Which of the
  three to drop is the student's decision, and a silent replacement takes a
  monster off the bench they never asked to lose.
- It reuses the deck column's own tiles (`.ems-role` / `.ems-role-grid` /
  `.ems-card`) rather than forking a second set, so a monster looks the same
  being chosen as it does being summoned — and it carries the same 👁, which is
  how a student reads what a monster does in the Siege before committing to it.
- ↻ **Play again** keeps the squad (it is the same fight); 🎴 **Change squad** on
  the result card goes back to the picker, because a siege that just fell is
  exactly when a student knows what they wanted instead.
- **`polymathlc/math` carries the same block** for 🌋 Orbital Siege — keep the
  two in step.
- Run **`node tools/siege-squad-tests.mjs`** after touching any of it.

## 🗑 Deleting a question from ✅ Check Questions (v1.308.0)

`cqDelete` / `cqUndo` / `_cqDeleted` (search `🗑 Delete the question on show`),
plus the `.cq-del` rule in `index.html`.

The queue served a bad question back and offered ✓, ✏️ and ⏭ — so the only way
to get rid of one was to leave the page, find it in the bank, and delete it
there. In practice it got skipped instead, and came back round on the next pass.

- **It ASKS first, and that is the one place this button differs from the same
  button in the English and Chinese portals.** Those move a question to a bin
  that holds it for a week; **this app has no bin** — `deleteQuestionDoc` is the
  same permanent delete the bank card and the Question Doctor use. So the safety
  net here is the confirm plus a WHOLE deep copy of the question kept in memory,
  and the dialog says exactly that rather than promising a week that does not
  exist.
- **↩ Undo covers the deletion, newest first**, and it SAYS which of the two it
  is about to undo — "↩ Undo" over a deletion the author has forgotten about is
  how the wrong thing gets put back. A restored question comes back
  **unchecked**, and the queue is put back on it rather than leaving it to
  surface again whenever the queue is next rebuilt.
- The copy is taken **before** anything is removed and it is a DEEP one: the
  entry in `questionBank` is the only object holding that question.
- Run **`node tools/check-questions-tests.mjs`** after touching the page.

## 🩷 The pink wall — keying a screen off art nobody generated here (v1.307.0)

`_tcgScreenCut` / `_tcgTryScreens` / `_screenSubjectKept` / `_tcgCutBackdrop` and
the display layer `_tcgLiveIndex` / `_tcgLiveClean` / `_tcgLiveImg` /
`tcgKeyArtImgs` / `_tcgLiveWatch` / `tcgLiveRefresh` (search `THE PINK WALL`),
plus `TCG_SCREEN_EDGES_MIN` / `TCG_SCREEN_RING_SEEN_MIN` /
`TCG_SCREEN_SUBJECT_MIN` in the chroma keyer.

`_tcgGenClean` keys the chroma screen because it KNOWS which one it briefed. A
picture arriving ANY other way — pasted, dropped, uploaded, or installed from
the bundled asset set — carries no such note, and got the flood-fill knock-out
and nothing else. The knock-out is deliberately cautious and hands back what it
cannot cut safely, so **201 battle avatars and 5 hero portraits went into the
game standing on a bright magenta, green or blue studio wall**, on every game
surface, for every student.

- **`_tcgSlotStandsOnNothing` is now the ONE list**, read by `_tcgArtStore`,
  `_tcgBgFreeIds`, the 🧼 button and the display index. It was written out three
  times, each copy free to drift from the others.
- **`_tcgCutBackdrop` is the ONE cut** a picture from outside the generator
  gets: chroma FIRST, then the flood fill. Chroma is a fact about COLOUR, so it
  reaches a wall seen through a gap between a monster's legs for the same reason
  it reaches the corners, and it can never walk into the artwork through a join.
- **`_recleanStoredArt` tries it first too**, so one press of 🧽 makes it
  permanent for art already in the map. **Generated art never comes here** —
  `_tcgGenClean` has a redraw available and keeps the strict key, unchanged.

### Three rules had to change, and each was a real picture failing

- **`TCG_SCREEN_EDGES_MIN` (3) — a figure STANDING on the bottom of its frame.**
  A hero portrait is a person from the knees up: top and both sides are 100%
  screen and the bottom edge is boots, so the whole-ring test landed near 80%
  and refused all five. Three WHOLE clean edges is stronger evidence of a studio
  wall than the ring test it stands in for, not weaker — a picture that merely
  CONTAINS the hue cannot have three complete frame edges of it. **Two is not
  three**: a subject wedged into a corner leaves two clean edges and is not a
  wall, and the harness pins that.
- **`TCG_SCREEN_RING_SEEN_MIN` — an empty border pixel is not evidence.** It
  used to count as PROOF of a wall, so a picture that is ALREADY a clean cut-out
  had a "100% screen" border by definition: any sprite with enough of a screen
  hue in its own paint then passed every precondition and was keyed. That is how
  an already-transparent blue dragon came back full of holes. `_tcgPlateColour`
  carries the same correction, and for the same reason.
- **`TCG_SCREEN_SUBJECT_MIN` (0.72) — the guard the hue keyer never had, and the
  one that matters most.** `_screenDn` asks "is this pixel that HUE", so a
  **violet monster shot on a MAGENTA wall scores as wall and is eaten alive**.
  The bundled set is full of them: every psychic, shadow and cosmic card was shot
  on magenta although `tcgScreenForElement` routes exactly those elements to a
  GREEN screen for this reason. A half-dissolved sprite is far worse than a
  visible wall, because nothing on screen says it happened.
  - `_screenSubjectKept` measures it against the WALL — screen colour reachable
    from the frame edge — not against the whole picture, so the number means the
    same thing on a sprite standing in a 70% wall and on one that fills its
    frame.
  - 0.72 is read off the 206 bundled pictures: an undamaged broad-hue cut leaves
    73-100% of the subject and everything below about 70% is visibly eaten.
    **Refusing that broad cut is the right answer.** The committed build keyer
    can then sample the screen's actual border RGB and keep the largest connected
    subject; the live/runtime keyer still refuses because it has neither a
    reviewable contact sheet nor git as a reversible source of truth.
  - **The same guard is what `tools/key-realm-sprites.mjs` was missing**, and
    the build tool had already shipped four hollowed sprites into the repo
    before it got one. See its house rule below.
  - The flood-fill knock-out cannot rescue those sprites (correctly — a violet
    body is a small colour step from a magenta wall). The build-only sampled-RGB
    fallback can: it follows soft spill only from the border, removes exact
    plate RGB inside gaps, and keeps the main connected painted component.

### Two passes, and which one a picture takes is the whole safety story

Pass 1 is the **strict** key, untouched: enclosed screen colour is read as the
model having painted the wall's colour ONTO the subject, and the key is refused.
Pass 2 runs the SAME key with that guard off, and **only ever on a picture pass
1 has already refused** — one that was otherwise going to keep its wall.

Pass 2 exists because the strict reading is wrong for a lot of real artwork: a
fire ring, a water curl, a coiled serpent and a pair of wings all enclose real
wall that never reaches the border, and the tighter the subject glows the less
that trapped wall looks flat (measured: mean screen-ness 0.83–0.93 and a spread
of 0.10–0.13, where clean wall is 0.99 and 0.00). **No threshold separates that
from a gem painted in the wall's colour** — a limit this file has documented
since v1.280.0, and a parameter sweep over the real set confirmed it: even at
settings loose enough to break the adversarial cases, a third still refused. So
pass 2 does not try to. It weighs the two outcomes, which are not symmetrical: a
refusal costs a magenta square behind a sprite everywhere, for everyone, until
somebody presses a button they do not know exists; a wrong key costs a hole in
ONE sprite, which the admin can see and can undo with ✏️ Touch up or by
uploading the picture again. Both passes are still verified by the two checks
with no false positives — the wall really is gone (`_screenStillThere`) and the
subject really did survive (`_screenSubjectKept`).

### …and the art already in the map, with nobody pressing anything

`_tcgArtStore` only cuts what it SAVES, so everything already filed keeps
whatever backdrop it was stored with. The display layer cuts those out **FOR
DISPLAY ONLY**, everywhere a student can see one. It writes nothing anywhere.

- **`_tcgLiveWatch` is THE ONE HOOK.** Forty-odd surfaces render Realm of Embers
  art — the arena, the duel board and its hand, the Siege field, the Legends
  picker, the artifact chooser, the hero picker, the peek panel, the pack
  reveal, the page header — and every one writes a plain `<img src>`. Tagging
  each call site is how a surface added next month becomes the one that quietly
  still shows the wall, so the DOM itself is watched: one MutationObserver,
  bound once, covering every picture the app will ever paint. Setting `img.src`
  from inside the callback re-enters it once with a url no longer in the index,
  so there is no loop.
- **It is keyed by the SLOT, through `_tcgLiveIndex`** — and a url serving BOTH
  a stands-on-nothing slot and a scene slot is dropped rather than cut, because
  `tcgArtUrl` falls back to the avatar and `tcgAvatarUrl` falls back to the card
  art, so one picture can legitimately be doing both jobs and cutting it would
  strip the painted scene off a card face.
- **Already keyed once this session → swapped inside the observer's own
  microtask**, before paint, so it is never seen wearing its wall. First sighting
  → hidden while it is cut, and NEVER left hidden: an unkeyable picture, a
  tainted canvas, a stalled decode and a thrown error all end with the picture
  shown exactly as it arrived (`TCG_LIVE_WAIT_MS`).
- **The admin's Card Art thumbnails are deliberately LEFT RAW** (`.ga-prev`) —
  that panel is where a wall has to be visible, or nobody would know it is there.
- The booster-pack overlay keeps `tcgKeyPackImgs` because the rip animation may
  not start until every frame is up, but it goes through the SAME cache and
  claims its frames with the same `dataset.rkey` flag, so the two never fight.
- The cache is capped (`TCG_LIVE_CACHE_MAX`) — these are full data URLs, and a
  session that browsed the whole dex would otherwise hold tens of megabytes.
- Run **`node tools/pink-screen-tests.mjs`** after touching any of it.

## 🔑 Keywords in a model answer, and 🔲 Fill-in-the-Blanks practice (v1.312.0)

`kw*` / `_kw*` / `qKw*` / `qKeyword*` / `qpFib*` (in `app.js`, search `KEYWORDS IN A
MODEL ANSWER`), plus the `.kw-*` CSS in `index.html`, the 🔑 **Assign keywords**
button beside 🤖 AI answer on every answer block, and the **Mode** dropdown on
Quick Practice.

An open-ended answer is a sentence, and what a student actually has to RECALL is
a handful of words inside it: *vapour*, *stomata*, *evaporate*. Marking those
words turns ONE model answer into three things — a key that prints them
**<u>bold and underlined</u>**, a recall drill that punches them out, and the
same ordinary question everywhere else.

- **NOTHING IS ASSIGNED BY DEFAULT, and that is the whole design.** A keyword
  is a teaching decision — which word is the one worth recalling — so it is made
  by a PERSON, on purpose, one question at a time. No AI path writes one, no
  import writes one, and **a question nobody has marked simply has no
  fill-in-the-blanks version of itself**: it is not offered in the mode, its
  answer key prints exactly as it always did, and nothing anywhere says it is
  missing anything, because it is not.
  - The first cut of this (v1.311.0) got it wrong, and the mistake is worth
    keeping written down. `_markedToBlanks` had long been turning the
    `[[double bracket]]` marks the AI prompts asked for into a `q.blanks` map
    that **nothing ever read**, so reading it back looked like a free head
    start and was in fact the whole bank silently acquiring keywords the
    teacher never chose. The prompts no longer ask for the brackets at all
    (`_aiBuildQuestionPrompt`, `_bulkPagePrompt`, `_regenPrompt`,
    `_epQuestionPrompt` and the exam-paper KEY prompt each say plain prose
    instead); `_markedToBlanks` stays, purely as the guard that strips a stray
    pair back out of an answer, since a bracket printed in the middle of a
    model answer is a bug on its own.
- **`q.answerKeywords` is the store** — keyed `<blockId>` for a plain answer box
  and `<blockId>_claim` / `_evidence` / `_reasoning` for a CER block, each
  holding `{ wordIndex: true }`. It is deliberately its OWN field rather than a
  flag on `q.blanks`: "did a person choose these words" then has exactly one
  answer, with no history to reason about and no legacy data sitting in the
  same map meaning something else. `q.blanks` is untouched and unread — it is
  not deleted either, because nothing is gained by destroying it.
- **THE INDEX IS A WORD COUNT, so anything that reads it must count words the
  way `_markedToBlanks` writes them.** `_kwParse` is the ONE walker, and the two
  things it must keep doing are the two ways the count silently drifts: an HTML
  tag is not a word (a `<b>` added mid-answer would otherwise shift every
  keyword after it along by one) and `&nbsp;` is a space rather than the word
  "nbsp". It returns each word with its offset in BOTH the plain text and the
  HTML source — the plain one for the blanks a student fills in, the source one
  for the bolding, which has to leave the author's own formatting alone.
- **TWO WAYS TO READ THEM, and the split is deliberate.** PRACTICE blanks the
  marked INDEX and nothing else — blanking every occurrence of "water" in a
  three-sentence answer is a wall of empty boxes, not a drill. The ANSWER KEY
  bolds the WORD wherever it appears in that answer: a key is read rather than
  answered, so a keyword bold in one sentence and plain in the next reads as a
  mistake — and it is the only rule that can work there at all, because the
  ✅ Model answer card a student sees is often the AI's own wording, which has no
  word indices to line up against. `KW_MIN_BOLD` keeps the automatic bolding off
  two-letter filler; the author can still blank one by hand.
- **`qKeyFieldHtml` (HTML in, HTML out) and `qKeyPlainHtml` (plain in, HTML out)
  are the two doors**, and every answer key goes through one of them: BOTH print
  paths (`doPrintWorksheetOpen` and `buildWorksheetHtml` — the two that had
  already drifted over the MCQ answer once), and all three student-facing
  reveals (`showExplanation`'s ✅ Model answer card, the whole-question mark's
  per-part line, the per-part mark's). A field with no keywords is handed back
  **byte for byte**, so nothing about an unmarked question changes.
- **🔲 Fill-in-the-blanks is a FLAG ON `markCfg`, not a second renderer**
  (`markCfg.fillBlanks` → `_kwFibBlockHtml` inside `buildOpenBody`). `buildOpenBody`
  is the ONE body every practice surface renders through, so the mode reaches all
  of them for free and the two can never drift into showing different questions.
- **It reuses `_fbStore` / `fbCheck` — the 🔲 Fill-in-the-Blanks BLOCK's own
  marking** — so exact match comes first and then the AI accepts synonyms,
  plurals and spelling slips. A student typing "water vapor" must be marked the
  same way whichever of the two they met it in, and a second marker is a second
  marker to keep in step.
- **A block with no keywords falls back to its ordinary typing box** (the
  renderer returns **null**, never an empty string — an empty string would take
  the answer box away and put nothing in its place, which renders perfectly and
  cannot be answered). A question with none anywhere is never SERVED in the mode
  at all: `qHasKeywords` gates `buildQpQueue`, `qpAvailableTopics` and
  `launchWorksheetPractice`, because a question with nothing blanked out is an
  ordinary question wearing the mode's banner.
- **One selector covers all three surfaces the user asked for**, because they
  are one queue: Quick Practice has the **Mode** dropdown, and a CUSTOM
  worksheet (bank picks → 🔲 Fill in the blanks) and a SAVED worksheet
  (📄 My Worksheets → 🔲 Fill blanks) both go through `launchWorksheetPractice`,
  which loads the queue into Quick Practice and runs it. `qpSetMode` is the ONE
  switch and the dropdown is its DISPLAY, never the other way round — a
  worksheet started in the mode has to leave the page agreeing with it.
- The mode is a plain global, deliberately not saved: it is a choice about THIS
  sitting, and a student who filled in blanks last Tuesday should meet ordinary
  practice on Wednesday rather than be handed the answers again.
- **🔑 Assign keywords borrows `.improve-btn` for its looks, so ✨ Improve needs
  a `kw-btn` guard** — the usual trap in this file (✂️ Shorten and ✍️ AI complete
  carry the same one). Without it one press also runs the button that REWRITES
  the box. The panel's own *Clear all* / *Done* carry `kw-btn` for the same
  reason.
- **The 🔑 panel is the ONLY writer there is.** Nothing is written until the
  question is SAVED: the panel edits `editorKeywords`, which
  `collectQuestionData` carries onto the question as `answerKeywords` — a field
  in `EDITOR_OWNED_QUESTION_FIELDS`, or `carryOverQuestionMeta` would restore a
  keyword the author had just removed. `kwSyncPanel` is called from
  `saveBlockContent` rather than by re-rendering the block, because the answer
  boxes are contenteditable and a re-render would put the caret back at the top
  on every keystroke; `kwForgetBlock` clears all of a deleted block's keys,
  since a CER block leaves three behind if only its bare id is cleared.
- Run **`node tools/keyword-blank-tests.mjs`** after touching any of it.

## ✏️ The answer key, edited from the preview (v1.313.0)

`ake*` / `akx*` (in `app.js`, search `THE ANSWER KEY, EDITED FROM THE PREVIEW`),
plus `#akeOverlay` and the `.ake-*` CSS in `index.html`, the ✏️ **edit answer**
button on every row of the printed answer key in the A4 preview, and the
💡 **Explanations on the answer key** switch on all three printing surfaces.

The answer key is the one page of a worksheet a teacher READS rather than prints
and forgets — it is what they mark thirty scripts from. So the preview is exactly
where a wrong answer or a missing explanation gets noticed, and noticing it was
as far as anyone could get: the fix meant leaving the sheet, finding the question
in the bank, opening the full editor, and finding the way back.

- **It edits the SAME BLOCKS the key is built from.** `_akeRows(blocks)` walks
  the question's own blocks and offers exactly the fields `_pushBlockAnswerKey` /
  `_pushAnswerKeySection` read — a `plainanswer`'s content, a CER block's three
  fields, an `answerLine`'s answer, a 🔑 `answerKey` block's text, an MCQ's
  correct option. So anything printed on the key can be edited here, and
  anything editable here really is what prints. A second list of "the answer
  fields" would be free to drift from the pushers, and the symptom is a key row
  nobody can fix — or an edit that saves and changes nothing on paper.
- **`_wsPreviewPack` hangs the button on each `.print-ak-question` AFTER
  planning**, exactly as the per-question ⬆ / ⤓ / ✏️ / ✕ tools are hung, and
  `.wspv-tools` is absolutely positioned — so nothing it adds changes a measured
  height and the preview still shows the pagination that will print. For the
  same reason `.print-ak-question` gets **only** `position: relative` in
  `WS_PREVIEW_CSS`: the planner measures those pages in that very document, so a
  rule touching their WIDTH would show a page count the PDF does not reproduce.
  The row carries `data-qid` from BOTH print builders, kept in step.
- **Nothing is written until Save.** The drawer edits a deep copy, like the
  ✏️ edit question drawer; Cancel and ✕ leave the bank untouched. Save writes
  through `saveQuestion`, so a running work session logs it, and every other
  worksheet, quest and game using that question follows.
- **An added explanation is filed under a part EXPLICITLY** (`_akeNewExplanation`).
  `qPartMap` inherits forward, so an explanation appended to a question with
  parts and no `part` of its own silently reads as explaining the LAST part —
  the exact fault `QPART_NONE` exists for. A new one is created as a
  whole-question note (`part: QPART_NONE`) and the drawer offers a picker to
  attach it to one part instead; on a question with no parts there is nothing to
  choose and no picker is drawn. The rule is its own function purely so the
  harness can pin it without a DOM.
- **A question with NO answer at all is offered a 🔑 `answerKey` block**, not a
  `plainanswer`. That block prints on the key and renders as nothing inside the
  question, so the "No answer recorded for this question" row can be fixed
  without adding a writing box to the student's sheet.

### 💡 Explanations on the answer key

- **`answerKeyExtras` still gates explanations only** — an answer is never
  optional, an explanation is teaching commentary — but until now only the two
  past-paper call sites ever turned it on, so a teacher who wrote an explanation
  on an ordinary worksheet question had nowhere it could be printed. It is a
  checkbox now: `AKX_SWITCHES` / `akxPrintOn(where)`, the same shape as
  `WNY_SWITCHES` and for the same reason — an unknown surface returns false
  rather than falling through to another page's checkbox, which would honour a
  switch set somewhere else with nothing on screen able to explain it.
- **All three print surfaces carry it** (`wsIncludeExpl`, `mwIncludeExpl`,
  `printIncludeExpl`), and `doPrintWorksheetOpen`'s `case 'explanation'` now
  reads the same switch instead of dropping explanations outright — those two
  paths had already drifted over the MCQ answer once, and a key that carries the
  explanations from one print button and not the other is that fault wearing a
  new hat.
- **The preview's own 💡 toggle is a VIEW of that checkbox, never a second
  state** (`akeSetExplPrint` / `akeSyncExplToggle`). The preview overlay covers
  the printing options behind it, and this is the switch a teacher wants the
  moment they have just written an explanation — but two switches meaning the
  same thing is how a sheet prints without the explanations they watched appear
  on screen.
- **An explanation reaching the key carries its PART** (`part: qPartNormalize(bPart)`).
  It used to be pushed unlabelled, which was harmless while nothing could file
  one per part and is not any more.
- Run **`node tools/answer-key-edit-tests.mjs`** after touching any of it.

## [2] — how many marks a question is worth (v1.314.0)

`QMARKS_*` / `qMarksOf` / `qMarksLabel` / `qStripTailMarks` / `qMarksAppendHtml`
/ `qMarksPickerHtml` / `setBlockMarks` / `commitBlockMarks` (in `app.js`, search
`HOW MANY MARKS A QUESTION IS WORTH`), plus the `.qmarks-*` / `.q-marks` CSS in
`index.html` and the **Marks** box beside the Part picker in a text block's
header.

An exam paper prints the marks at the end of the question they belong to —
*Explain why the bulb lit up when the iron ball was at point A.* **[2]** — and
until now the only way to get one onto a sheet was to type the brackets into
the wording by hand.

- **It is a FIELD on the block (`block.marks`), never characters in the
  wording** — the same design as `block.part` beside it, and for the same
  reasons: the number can be read by something later, the author sets it in one
  place instead of remembering a convention, and it cannot end up stranded in
  the middle of a sentence after an edit.
- **`qPartBodyHtml` is the ONE place it is drawn**, which is what makes it
  appear everywhere at once — student practice, the worksheet preview, both
  print paths, the A.I. marking context — with no surface able to be the one
  that forgot. The block is never written to: an author sees exactly what they
  typed in the editor box.
- **It is inserted INSIDE the last closing tag, not appended to the string.**
  `block.content` is authored HTML that nearly always ends `…point A.</p>`, so
  gluing the marker onto the end would put the marks on a line of their own —
  on every question at once. `QMARKS_TAIL_POS_RE` finds the point where nothing
  but closing tags and whitespace is left, which is where the full stop is.
- **The label is drawn from the block, so it must not ALSO be in the text.**
  `qPartBodyHtml` strips a trailing marks marker whenever the field is set,
  exactly as it strips a part marker that only repeats the block's own label —
  and an imported past-paper question very often arrives with "[2]" already
  transcribed into its wording. Unlike a part letter there is nothing to
  disagree about (a bracketed number at the end of a question can only be its
  marks, and there is exactly one marks field), so ANY trailing bracket goes
  and the field wins. A bracket anywhere else — `[see Diagram 1]`, a reference
  mid-sentence — is prose and is never touched.
- **A block with no marks renders BYTE FOR BYTE what it always did.** That is
  the overwhelming majority of the bank, and the guard the harness leads with.
- The control is only on `QPART_OPENER_TYPES` blocks — the ones that ASK
  something. An answer box is not a question and has no marks of its own.
- **`commitBlockMarks` re-renders only when it really changed the wording**, and
  says so in a toast. Typing into the box repaints the chip in place
  (`_qMarksSyncChip`): rebuilding the block card while the author is typing in
  it takes the caret with it, and words vanishing out of a question box with no
  explanation is more alarming than the tidy-up is worth.
- On paper the span is stripped by `escapeHtmlKeepLines` and the plain `[2]`
  survives, which is the exam convention and exactly what a paper shows.
- Run **`node tools/question-marks-tests.mjs`** after touching any of it.

## ↩️ Back to the preview you came from (v1.325.0)

`_wsPreviewSnapshot` / `_wsQeReopenPreview` / `wsQuickEditOpenFull` /
`_afterEditNavigate` / `_syncBackToPapersBtn` / `_wsQeReturn` (search
`GOING BACK TO THE PREVIEW YOU CAME FROM`).

Every preview carries ✏️ **edit question**, and the drawer's **Full editor**
button leaves for the real editor. Saving used to drop the teacher on the
Question Bank — so fixing one question on a PSLE paper meant walking back
through **📄 Past Papers → the year or the concept → 👁 Preview**, every single
time. That is how a wrong answer noticed on a sheet ends up not being fixed at
all.

- **THREE things can be behind that button, and the third is why this is a
  SNAPSHOT rather than an id**: the worksheet BUILDER's preview (driven by the
  tick boxes on the page behind it), a SAVED worksheet (a stored list of ids),
  and a **PSLE PAST PAPER** — which is neither. A paper has no stored list to
  reopen it from, only the arguments it was previewed with, so those are what
  is kept. That is the same reason `_wsPreviewPaper` is its own slot beside
  `_wsPreviewSaved` rather than being squeezed into it.
- **THE SNAPSHOT IS TAKEN BEFORE THE OVERLAY CLOSES.**
  `closeWorksheetPreview()` clears both preview slots, so one taken after it is
  always null — and the return silently stops working while everything else
  about the edit behaves perfectly. It is stored AFTER `editQuestion`, which
  resets it.
- **`editQuestion` clears it**, beside `_editReturnPage` and `_ppReturnFocus`.
  Without that one line an edit started anywhere else would bounce to whatever
  preview was last left set — a sheet the teacher has never opened, which is
  the one way "return to where you were" can be worse than not returning.
- **`_wsQeReturn` lives at the TOP, with the other return state, not beside the
  drawer that sets it.** `_syncBackToPapersBtn` reads it and is reached from
  `setEditMode(false)` inside `navigateTo` — which runs during module
  evaluation. Declared a thousand lines lower it would be in its temporal dead
  zone there and take the whole app down on load: the same trap `var editorLos`
  carries.
- **The SNAPSHOT decides where to go back to, never the destination page.** A
  paper preview returns to `papers`, and so does the Past Papers assign panel's
  own edit (`editQuestionFromPapers`) — which has no preview to reopen. For the
  same reason the **← Back** button asks the snapshot first: a button promising
  the page while delivering the preview is a button nobody trusts twice.
- **A paper is rebuilt from its ARGUMENTS and its questions re-resolved** by
  `ppPreview`, so the sheet shows the edit that was just saved rather than the
  copy it was previewed with. It reopens **`quiet`**: the skipped-questions
  toast is news the first time and noise on every return, and that flag is the
  only thing `ppPreview` gained.
- **The reopen is deferred a beat**, so the page it is landing on has rendered
  underneath the overlay, and the snapshot is **spent on use** so it cannot
  fire twice.
- Run **`node tools/preview-return-tests.mjs`** after touching any of it.

## 📄 The answer key is PAGINATED, and previewable from the past papers (v1.315.0)

`_packAkRows` / `_akPageTitle` / `_printAkPageEl` / `_printPlanAkPages` (in
`app.js`, search `the ANSWER KEY, paginated`), `_wsPreviewPaper` / `ppPreview` /
`_ppPrintQuestions` (search `ppPreview`), and the `.ak-expl` rules in
`index.html`'s `@media print` block.

- **The key used to be ONE pre-built page.** `_printPlanIn` measured it whole:
  too tall to shrink readably and it was marked `tall` and left to flow. On
  screen that is a single sheet several pages long with the rows running off
  the bottom of it, and in the PDF a page box that is a fixed height with
  visible overflow. A twenty-three-question key is the ORDINARY case. Its rows
  are packed into sheets now, the way the question chunks already were:
  `_packAkRows` proposes, and every candidate sheet is then assembled and
  measured for real — the measure-never-assume rule the rest of the planner
  follows.
- **The heading is reprinted on every sheet, so it comes out of EVERY sheet's
  budget** — charged once, sheet two onwards is over the bar by a heading.
  Sheet two says *(continued)*: a teacher flipping over needs to know it is not
  a second key.
- **`_printAkPageEl` is the ONE builder both consumers call.**
  `doScaleAndPrint` and `_wsPreviewPack` assemble the sheets separately; if
  either stops calling it, the preview paginates differently from the PDF and
  the teacher checks a layout they will not get.
- **`_printPlanAkPages` hands the rows back in INDEX order.** Measuring moves
  them about, and the live preview plans against the very DOM it then rebuilds
  from — a re-query in shuffled order gives sheet one the rows of sheet three,
  every answer under the wrong question number, with nothing anywhere saying so.
- **`akPlans[i]` is an ARRAY of sheets now**, not one `{zoom,tall,h}`. Both
  readers were changed with it.

### 👁 Preview a past paper

- **`_wsPreviewPaper` is the preview's third context**, beside the builder's and
  a saved worksheet's. A past paper is not a saved worksheet — there is no
  stored list of ids to edit — so it gets its own slot rather than being
  squeezed into that one; `_wsPreviewCtx` grows a `paper` branch and the
  ✎ Questions button and the 💡 toggle are hidden for it.
- **A paper always prints its explanations** (it is a marking scheme), so the
  context carries `akExtras: true` and `akeExplPrintOn()` reads the CONTEXT
  rather than `AKX_SWITCHES` — asking the checkbox table about a surface that
  has no checkbox would tell the drawer the opposite of the truth.
- **`_ppPrintQuestions` is the ONE list builder** the preview and the print
  share, and `printFromPreview` hands `ppDoPrint` back the very arguments the
  preview was opened with. A preview assembled its own way is a preview of a
  different paper.
- Each of the three print entry points (`ppPrintConcept`, `ppPrintYear`,
  `ppPrintSelected`) takes a `go` argument and dispatches to `ppPreview` or
  `ppDoPrint`, so the two can never collect different questions.

### The explanation is set apart from the answer

`_akSectionsHtml` tags an explanation section `ak-expl` from its `kind`, never
from its label text — the label is one literal today and would be a silent
match on any wording tomorrow. The print CSS gives it a clear gap and a
hairline above: run on directly underneath, the answer and the explanation read
as one block of text, and the answer is what a teacher marks from at a glance.

Run **`node tools/answer-key-pagination-tests.mjs`** after touching any of it.

## (b)(i) — roman sub-parts (v1.316.0)

`QPART_ROMANS` / `qSubNormalize` / `qPartKey` / `qPartLetterOf` / `qPartSubOf` /
`qPartKeyIn` / `qBlockOpensSub` / `qBlockOpensKey` / `setBlockSubPart` (in
`app.js`, search `ROMAN SUB-PARTS`), plus the second select in a text block's
header and `.qpart-sub` in `index.html`.

A PSLE part very often splits again into (i) and (ii), and the app had no way
to say so: both sub-answers inherited the same letter, so the printed answer key
gave ONE "(b)" heading with two answers run together under it and the A.I.
marker was handed both sub-questions as a single item.

- **It is a SECOND FIELD, `block.subPart`, not a wider alphabet on `part`.**
  That is what lets a sub-part INHERIT its letter: a block carrying only
  `subPart: 'ii'` belongs to whatever letter is current, so renaming (b) to (c)
  carries its sub-parts along. Storing `"b.ii"` on the block would freeze the
  letter at the moment it was typed.
- **`qPartMap` hands back a part KEY, not a bare letter** — `'b'`, `'b.i'`, and
  `'.i'` for a question numbered (i) (ii) with no letters at all. The `.` can
  never occur inside either half, so the key always comes back apart
  (`qPartLetterOf` / `qPartSubOf`). Everything that RENDERS goes through
  `qPartLabel`, which turns a key into `(b)(i)`; everything that COMPARES
  compares keys, so (b)(i) and (b)(ii) are properly different questions
  everywhere at once — the answer key's headings, `_openSection`'s
  `items[].label`, `_partPromptText`, `_aiPartScopeLine` and `_questionContext`.
- **`qBlockOpensPart` still returns a bare LETTER**, through the new strict
  `qPartLetterNormalize`. The exam paper builder, `autoNumberParts`, the
  Question Doctor's scan and `qScopeExplanations` are all letter-scoped, and
  handing any of them `'b.i'` makes it silently match nothing.
- **A LETTER covers its own sub-parts** (`qPartKeyIn`): `qPartSpan(blocks,'b')`
  and `qPartFind` still find everything in (b)(i) and (b)(ii), or the marking
  scheme's answer for part (b) would land nowhere. `qPlacePartExplanation` also
  stamps `part: letter` on the note it inserts — a part ending on (b)(ii) would
  otherwise have the whole part's explanation inherit that key and read as
  explaining only the second sub-question.
- **A NEW letter starts fresh.** `(c)` takes only the sub-part its own block
  declares; without that, everything under (c) would be filed as (c)(ii).
- **DETECTION IS STILL LETTERS ONLY.** `QPART_LETTERS` stops at `h` precisely
  because `i` collides with the roman `(i)`, and nothing here changes that: a
  sub-part is set by hand on the block, never guessed out of unvetted text. No
  AI prompt writes `subPart`.
- **The label is drawn from the block, so a roman must not ALSO be in the
  text.** `_qSubOwnMarker` / `_qOwnMarkersOff` extend the v1.293.1 rule: the
  letter marker comes off first, then a roman that names this block's OWN
  sub-part, so "(b)(ii) placing all three beakers" loses both. A roman that is
  NOT this block's own is left for a human — two people disagreeing about which
  question this is.
- **`qBlockOpensKey(b, map)` is what a block prints beside ITSELF.** A block
  that opens only a roman would otherwise show nothing at all, on screen and on
  paper: `qBlockOpensPart` is a letter and this block has none of its own.
- **The whole part vocabulary lives together, immediately after
  `qPartNormalize`.** Four harnesses cut that window out of `app.js`; a helper
  declared anywhere else is a `ReferenceError` in all of them.
- Run **`node tools/sub-part-tests.mjs`** after touching any of it.

## 📷 A question that came off a photograph (v1.318.0)

`_vetIsScanned` / `SCANNED_SOURCE` (search `A QUESTION THAT CAME OFF A PHOTOGRAPH`), plus
the purple outline and the **📷 From the Scan app** badge on a vetting card.

The Scan app (`polymathlc/scan`) reads a worksheet or an exam paper on a phone.
The teacher can now send any question it read straight into **this app's
vetting list** — `users/{adminUid}/vetting` — and it arrives as an
ordinary pending question with one extra field.

- **`source: "scan"` is the whole contract between two repositories that
  cannot see each other**, and it fails silently in both directions. Rename
  the value on either side and the card still arrives, still renders and still
  approves; it simply stops being purple and stops saying where it came from,
  with nothing anywhere to say so. **Ship a change to the word in all five
  repos together** (`scan`, `cer`, `math`, `english`, `chinese`).
- **It has to be LOUD, because a scanned question is not like a typed one.** It
  was read by a model from a picture of somebody's worksheet: the wording may
  be half a line short, **the diagram is not there at all**, and the topic
  is left blank on purpose (it belongs to the syllabus list that app has
  never seen), so it arrives flagged `topicConfidence: 'low'` and wears the
  existing ⚠ check topic badge.
  A card that looked like every other draft would be approved at the same speed
  as one somebody typed and checked, and reach the bank with a figure missing.
- **`_vetIsScanned` is the ONE predicate**, and the outline and the badge both read
  it. Two tests would drift into a card that is purple with no badge (which
  reads as a styling bug) or badged with no outline (which is the warning made
  invisible).
- **Three outlines compete for one border, so they are RANKED rather than
  layered (`restBorder`): a possible duplicate is the thing to look at first,
  then where the question came from, then merely that it is new — and a card
  ticked for deletion outranks all three. They are all inline styles, so one
  has to win outright.**
- **It lands in VETTING and nowhere else.** The Scan app writes one document
  into this app's vetting collection and touches nothing else — not the bank,
  not a student's progress, not the notebook. Approving it is the ordinary
  approve, and from then on it is an ordinary question.
- **The child's work never travels.** The Scan app marks what the student wrote
  on the paper; none of that is in the document. A bank question is the
  QUESTION, its options, its answer and why.
- Run **`node tools/scanned-question-tests.mjs`** after touching any of it.

## ⚙️ Choosing the AI engine — three routes, and the key is on the SERVER

`AI_DOWN_MS` / `_aiDown` / `_aiWhy` / `aiEngineOrder` / `askOpenAiServer` /
`askChatGpt` / `_aiRun` / `_aiAsk` / `askGeminiDirect` / `aiRouteReport` /
`renderAiEngineStatus` / `aiEngineChoicePreview` (in `app.js`, search
`THREE ROUTES`), plus `#aiEngineStatus` in the AI Engine chooser. **All the
portals carry this same block — keep them in step.**

All the apps answer through Gemini on the shared `mathgen--app` project, so
when that project's billing cap is hit they **all die at once and
identically** — `[429] Your billing account has exceeded its monthly spending
cap`, on every call, on every device, until the month turns over.

- **THE ORDER IS THE DESIGN**: Gemini, then **ChatGPT on the SERVER**, then
  ChatGPT on a key pasted into this browser. The chooser reverses it. That is
  what choosing an engine now means: **which is tried FIRST, never which is
  available.**
- **The failover used to go ONE WAY, which is why it never helped.** The old
  code fell from ChatGPT to Gemini and never the other way — so the failure
  that actually happens, a capped Gemini, had nothing behind it at all.
- **THE SERVER ROUTE IS WHAT MAKES THE CHOICE REAL.** `askOpenAiServer` calls
  the `askOpenAi` Cloud Function in `polymathlc/math/functions`, which holds
  the key as a Firebase secret and enforces the sign-in, the model, the size
  caps and a daily quota. Before it existed, choosing ChatGPT needed a key
  pasted into every device separately — so it worked on the teacher's laptop
  and **no student's phone**, which is the half of the school that matters. A
  key cannot be shipped in `app.js` instead: this is a public static site
  served to every student's browser.
  - **It needs one deploy**: `firebase functions:secrets:set OPENAI_API_KEY`
    and a functions deploy in the Maths repo. Until then the call returns
    `failed-precondition` and the chooser says **in those words** that the
    server key is not switched on yet — a deploy step and a rejected key are
    different problems, and an app that reported both as *AI error* would send
    the teacher looking in the wrong place.
- **A key in `localStorage` is the THIRD route, not the first.** It is what
  keeps ChatGPT working before the function is deployed, or if it ever stops
  answering, and it is still shared with the other portals. The chooser says
  so rather than presenting it as the fix, and **no longer refuses to save a
  ChatGPT choice without one**.
- **`openai` is ALWAYS in the order.** Whether the function is deployed is not
  something a page can know without asking; one refused call marks it down for
  `AI_DOWN_MS` rather than being paid for again on every page of a bulk
  import. `__aiReady()` is therefore simply `true` — an app that asked "is
  Gemini up" would refuse every AI button on a capped project that can in fact
  answer.
- **A refused route goes to the BACK of the list, never off it**: a cap is
  lifted eventually, and refusing on a stale note is worse than spending one
  call finding out. A success clears the mark.
- **When every route refuses, the FIRST error is thrown.** It names the real
  problem; the last is usually "no key on this device".
- **`askGeminiDirect` is the raw Gemini call, written once.** Both doors used
  to carry their own copy of it, and both carried their own copy of the
  one-way ChatGPT fallback too.
- **The chooser SAYS what is actually happening** (`renderAiEngineStatus`),
  because an app quietly running on its second route looks exactly like one
  running on its first, and an app with nothing behind its first looks like
  both. It reports only what it knows: the routes in the order they will be
  tried, and what each said the last time it refused.
  `aiEngineChoicePreview` shows the order a radio would produce **without
  committing it** — a preview that saved would make Cancel a lie.
- Run **`node tools/ai-routes-tests.mjs`** after touching any of it.

### The engine choice belongs to the CENTRE, not to a browser

`aiPreferredEngine` / `aiEngineLoadShared` / `aiEngineSetShared` /
`_aiSharedEngine` / `AI_SHARED_TTL`, and the `aiEngineConfig` callable in
`polymathlc/math/functions`.

A device-local engine choice was the bug wearing a feature's clothes: the
teacher switched to ChatGPT on their own laptop, watched it work, and **every
student stayed on the capped Gemini** — with the screen on the machine they
set it on looking exactly as it should. So the admin sets it once and every
signed-in device follows until they set it back.

- **It is a CALLABLE, not a Firestore document the clients read.** The shared
  `firestore.rules` in the Maths repo does not contain the Science app's own
  rules — it carries a placeholder telling you to paste them in from the
  console first — so **any** rules deploy from there is a manual assembly job
  with the whole project's access as the blast radius. A new world-readable
  document would need exactly that. The function writes through the Admin SDK,
  which bypasses rules, so the shared setting costs no rules change at all:
  the deploy that switches ChatGPT on switches this on with it.
- **Reading is open to any signed-in user; WRITING is the admin's alone**, and
  it is checked in the function — the dialog's own gate is not a lock.
- **`_aiSharedEngine` is null until the callable answers**, and the device
  preference stands in until then. A project where the function has never been
  deployed behaves exactly as it always did, rather than waiting on a call
  that is never coming.
- **A write that FAILED is reported.** A teacher told nothing would believe
  the whole centre had moved. The message names the missing deploy when that
  is what it is.
- **The page says WHOSE setting is in force** — centre-wide, or this device's
  own because the shared one could not be read.

### Where the shared setting lives — and why it is not a new document

`_aiCfgRef` / `aiEngineWatchShared` / `aiEngineStopShared` (v1.321.0). The
engine is a **field on this app's own admin-pointer document** — the one every
signed-in device already reads to find out whose question bank to load, and
that only the admin can write.

- **So it needs NO rules change and NO deploy.** Both the read and the write
  are paths this app has exercised in production since it shipped. A brand-new
  document would have been tidier and would have needed a rules deploy — from
  a file that does not even contain this app's own rules — so tidier was not
  worth it.
- **The write is a MERGE, always**, and so is the admin sign-in write that
  puts `uid`/`email` on the same document. A plain set on either would take
  the other's field off: the bank pointer, or the engine setting the teacher
  set that morning. The sign-in one was a plain set until v1.321.0, and it
  would have wiped the toggle every day.
- **It is a LIVE listener, not a poll**, so a device with the app open follows
  the teacher within seconds. That is what app-wide has to mean.
- **It comes down on sign-out**, or one account's engine setting goes on
  governing the next person to sign in on the device — the same rule the
  teaching-notes listener carries.
- **An unset field means Gemini**, the default every app already had, so a
  centre that never touches this is unaffected.
- **The `aiEngineConfig` callable is kept as the FALLBACK** for the case where
  the direct read or write is ever denied: it goes through the Admin SDK,
  which bypasses rules.

### When nothing answers, say what everything said

`AI_ROUTE_LABEL` and the tail of `_aiAsk`. The first error is kept as `cause`,
but the message names **every** route: `Gemini: … · ChatGPT (server key): …`.

Reporting only the first hides the rest. A card reading *"Gemini: your billing
account has exceeded its monthly spending cap"* and nothing else sends the
teacher to the Google console — when what actually needs doing is deploying
the ChatGPT function. That is a real hour lost, and it is exactly what
happened.

- **`skipOpenAi: true` still means Gemini and nothing else**, and it is still
  load-bearing: it is what forces the Gemini column of 🔍 Answer key
  cross-check to really be Gemini. Without it both columns can be the same
  model and the report reads as a clean bill of health. The ChatGPT column now
  goes through `askChatGpt`, so the second opinion exists on a device with no
  key of its own — which is the whole reason that report is worth running, and
  `akcEngines` therefore offers it whether or not a key is saved.

### 🌙 Kimi — the THIRD engine, and why two was not enough

`AI_ENGINES` / `_aiRoutesFor` / `askKimiDirect` / `askKimiServer` / `askKimi` /
`kimiListModels` / `_kimiModelNote` / `KIMI_DEFAULT_MODEL` (in `app.js`, search
`KIMI (Moonshot AI)`), plus the third radio, the model box and the key box in
the AI Engine dialog. **All the portals carry the same block — keep them in
step.**

Gemini and ChatGPT are two suppliers on two bills, so "whichever will answer"
has never been more than one deep. The morning the Firebase project is capped
**and** the OpenAI account is out of credit is a morning that happens, and it
used to leave every app in the family dead at once. Kimi is a third company,
a third account and a third cap.

- **An ENGINE is one or two ROUTES, and that shape is now the whole order.**
  `AI_ENGINES` is the three a teacher chooses between; `_aiRoutesFor` turns
  each into the routes it actually has — the server's key, and behind it a key
  pasted into this browser. The chosen engine's routes go first and **the other
  two stay behind them**, which is what makes a capped supplier survivable
  rather than fatal. An engine name nobody recognises still yields every route
  rather than an empty list: a stale word in the shared setting would otherwise
  take the AI off every device at once.
- **`askChatGpt` had to stop meaning "not Gemini".** It was
  `filter(e => e !== 'gemini')`, which was right with two engines and is
  silently wrong with three — 🔍 Answer key cross-check asks for a **named**
  second opinion, so a ChatGPT column quietly answered by Kimi is two engines
  agreeing in the report and one engine agreeing with itself in fact. Both
  `askChatGpt` and `askKimi` are filtered to their OWN routes now.
- **A PDF is REFUSED BY NAME, never dropped.** A PDF is an OpenAI `file` part
  and Moonshot has no such part, so `askKimiDirect` throws rather than sending
  a request without its pages — which would come back fluent and about nothing
  at all. The loop then falls to a route that can read it, which is the whole
  point of the loop.
- **THE MODEL IS A FIELD, NOT A CONSTANT**, and this is the failure mode to
  design for: Moonshot renames its flagship with every release (`kimi-k2-…`,
  `kimi-k3-…`), so an id hard-coded on the day this shipped is a 404 on every
  call a few months later — and a 404 on every call reads as "Kimi is broken"
  rather than "the id is a release out of date". 🔄 **Load models**
  (`kimiListModels`) asks the account itself, and **`_kimiModelNote` says it in
  words** in the chooser's status panel. `KIMI_DEFAULT_MODEL` is only what an
  admin who has never opened the box gets.
- **The server route is what makes the choice real**, exactly as it is for
  ChatGPT: `askKimi` is a callable in `polymathlc/math/functions` holding
  `MOONSHOT_API_KEY` as a Firebase secret, so a student's phone uses it with
  nothing set up on it. **It needs one deploy** —
  `firebase functions:secrets:set MOONSHOT_API_KEY` and a functions deploy —
  and until then it returns `failed-precondition` and the chooser says *the
  server key is not switched on yet* rather than *AI error*.
  - It is the ONE callable in that file that takes the **model** from the
    client, because a teacher cannot redeploy a Cloud Function to follow
    Moonshot's renames. `KIMI_MODEL_RE` is what keeps that from becoming "a
    client naming an expensive model on the centre's bill": it can only ever
    be a Moonshot id, and anything else falls back to the server's own.
  - Its throttle counts on **its own fields** (`kimiDay` / `kimiCount` /
    `lastKimiAt`). Sharing ChatGPT's would mean a capped ChatGPT day silently
    closing Kimi too — on exactly the day Kimi is the one engine still
    answering.
- **The key is NEVER in the repo.** These are public static sites served to
  every student's browser. The harness fails on an `sk-`-shaped string in the
  source, and that check now covers every engine's key rather than OpenAI's.
- Run **`node tools/ai-routes-tests.mjs`** after touching any of it.


## The printed part label reserves its OWN width (v1.324.1)

`PRINT_PART_PAD_MIN` / `PRINT_PART_PAD_PER_CH` / `PRINT_PART_PAD_GAP` /
`PRINT_PART_PAD_MAX` / `printPartPadPt` / `printPartBlockHtml` (in `app.js`,
search `THE PRINTED PART LABEL RESERVES ITS OWN WIDTH`), plus the
`.print-text-block.print-has-part .print-part-label` rule in `index.html`.

A block that OPENS a part hangs its label in the margin, and the label is
positioned **out of the flow** — so the block has to RESERVE the room with
`padding-left`. That reserve was a flat **26pt**, which is exactly the room
`(a)` needs and nothing like the room `(b)(iii)` — a roman sub-part — needs. A wider label printed
**straight over the first words of its own question**, on every surface that
uses the print CSS at once: both print builders and the live A4 preview.

- **The reserve is MEASURED FROM THE LABEL**, and `printPartBlockHtml` is the
  ONE place a printed part label and the block carrying it are built. It
  writes the same number into both — the padding the text starts at, and the
  width of the label's own box — so **they can never disagree**. Two
  expressions computing that width separately is exactly how they drift back
  apart, and the symptom is a label sitting on top of a sentence on paper,
  which nobody sees until a class is in front of it.
- **`(a)` is unchanged, byte for byte.** `PRINT_PART_PAD_MIN` IS the old 26pt,
  so the overwhelming majority of the bank prints exactly as it always did —
  and the print planner, which measures the finished page, re-plans around the
  wider blocks for free.
- **`PRINT_PART_PAD_MAX` bounds it.** A label allowed to grow without limit
  would eat the column rather than the question; past the cap it wraps inside
  its own box instead, which is what `overflow-wrap` in the CSS is for.
- **`box-sizing: border-box` on the label is load-bearing.** Its width is the
  same number as the block's padding, so without it the padding-right would
  push the label's box past where the text begins and put the overlap back.
- **`min-height: 17.6pt` on the block stays.** The label is out of the flow, so
  a block that carries a part and no text of its own measured zero tall — the
  marker painted over whatever came next and contributed nothing to the
  planner's chunk height.

## ✏️ Editing mode — the whole worksheet, condensed, in one scroll (v1.326.0)

`em*` (in `app.js`, search `EDITING MODE`), plus `#emOverlay` and the `.em-*`
CSS in `index.html`, the ✏️ **Editing mode** button in the A4 preview bar, the
✏️ **Edit questions** button on a 📄 My Worksheets card and ✏️ **Edit all** beside
👁 Preview on every 📄 Past Papers year and concept.

👁 Preview shows the sheet as it will PRINT and fixes one question at a time;
✎ Questions edits which questions are ON the sheet. Neither is any use to
somebody who has just read a whole paper through and wants to correct a wrong
option here, a missing part letter there, an answer that reads badly on question
14 — because the way to do that was to open the full block editor once per
question, and the full block editor spends most of its height on things that are
not the question: a paste pad, a URL box, a print size and its paragraph of
explanation, a toolbar, an answer-key panel.

Editing mode is that same editor with the furniture folded away. **Every question
on the sheet is loaded at once**, one after another; each block is a thin strip —
the content, and a vertical rail of tiny icons down its left edge carrying every
control. Scroll from the first question to the last, fix what you find, press
💾 **Save all changes** once. Gated on `_canAuthor()`.

- **IT IS THE SAME EDITOR, NOT A SECOND ONE.** `#blocksList` is **MOVED** into
  the overlay — the very node the create page uses — so `renderBlocks()`, every
  inline `onclick`, every `data-` handler and every `blocks.find(...)` lookup
  work byte-for-byte as they always did, and a block type added next month is
  condensed without being told about. A second block editor written for this
  view would be a second editor to fix every bug in, and it would drift from the
  first the week after it shipped. `_em.home` is where it came from and it is put
  back there on close; `_em.prev` is the create page's own editor state, handed
  back untouched.
- **THE GLOBAL `blocks` HOLDS EVERY QUESTION AT ONCE**, so a walk of the whole
  array is a walk of the whole paper. `_em.owner` says which question each block
  belongs to and **`emScope(blockId)` is the ONE place that is resolved** —
  outside editing mode it hands back `blocks` itself, unchanged. Anything that
  reads the question AROUND a block goes through it: **`qPartMap` above all**,
  which inherits FORWARD, so without it part (c) of question 3 is inherited by
  every block of question 4 and the answer key files them under it. The four
  readers are `qPartPickerHtml`, `aiGenerateBlockAnswer`,
  `aiGenerateBlockExplanation` and `_widgetQuestionContext`; a fifth added later
  needs the same treatment, and the symptom of forgetting is an AI answer that is
  fluent, confident and about a different question.
- **…and the same for the TITLE and TOPIC an AI call is grounded on.**
  `emTitleFor` / `emTopicFor` read the OWNING question; the create page's own
  `#questionTitle` and `#topicSelect` still hold whatever was open there, and
  reading them grounds the call on a question that is not even on screen.
- **A BLOCK ID IS UNIQUE ACROSS THE WHOLE SHEET.** Two questions duplicated from
  each other carry the same block ids, and every handler in this editor finds its
  block BY ID — so a collision is typing into question 7 and watching question 2
  change. A repeat is re-keyed on the way in, and its **keyword and blank entries
  are carried across with it** or they are left pointing at an id nothing uses.
- **A QUESTION MAY NEVER BE EMPTIED.** `qPartMap` and the owner map are both
  positional, so a question with no blocks left has nowhere to draw its heading
  and nothing to own a newly inserted block. `emMayRemove` refuses the last one
  and the toast says to take the question off the sheet with ✎ Questions instead.
- **A NEW BLOCK JOINS THE QUESTION ABOVE IT** (`emAdoptOwners`), which is where
  the insert bar that made it was drawn — falling back to the one below when it
  is the very first block on the sheet. Duplicating a block gives it a fresh id
  and no owner, and it adopts the same way.
- **NOTHING IS WRITTEN UNTIL SAVE, AND ONLY WHAT CHANGED IS WRITTEN.** Every
  question is deep-copied in and compared against the signature taken the moment
  the sheet finished rendering, so a paper of forty questions where two were
  touched is two writes. The baseline is taken **AFTER** the first render and its
  `syncEditorDomToBlocks()`, or the browser's own re-serialising of the markup
  reports every question as changed on the very first save. It writes through
  `saveQuestion`, mutating the bank question in place like `akeSave` — so every
  field the editor does not own is preserved without `carryOverQuestionMeta`.
- **THE RAIL IS THE SAME BUTTONS, MOVED.** A hoisted control is the original DOM
  node with its handler intact, never a copy that calls the same function — which
  is how the two come to disagree. It is safe because the action buttons are
  driven by `data-` attributes and delegated listeners (`.improve-btn`,
  `data-enhance`, `data-crop-open`, `data-annot-open`), so their position in the
  card means nothing. **What cannot be moved is named**: a `.mic-btn` with no
  `data-mic-block` finds the box it dictates into by walking up to
  `[data-mic-wrap]`, so lifting it onto the rail lifts it away from that box.
- **`EM_PRIMARY` says which half of a block STAYS.** Everything else folds into
  `.em-extras` — hidden, never removed, and the ⚙ on the rail brings the whole
  ordinary editor straight back. **A block type that is not in that table is left
  exactly as it is**: `mcq`, `table`, `fillblank` and the widget builder are
  controls the whole way down, so there is no "content" half to keep and hiding
  the rest would hide the question. That default is what makes the feature safe
  to extend.
- **The 🖼 picture tools arrive a frame LATE.** `renderImgEnhanceBar` fills its
  bar after `renderBlocks` has returned, so ✂️ Crop, ✏️ Touch up and ✨ Enhance are
  lifted onto the rail by their own hook (`emCondenseEnhanceBar`) — and an
  enhanced picture, whose single preview is replaced by a side-by-side
  comparison living in the folded half, **opens the block** rather than showing
  no picture at all.
- **`body.em-editing` lifts every dialog editing mode can OPEN.** The touch-up
  editor, the crop tool, the answer-key cross-check and the confirm cards are all
  `.overlay` (z-index 300) — *below* this overlay (440) — so pressing ✏️ Touch up
  would open an editor nobody can see. The class raises them for exactly as long
  as editing mode is up, and never otherwise.
- 👁 Preview, ✏️ Edit and 🖨 Print on the past-papers page all go through
  **`_ppGo(go)`** and take the identical `(items, missing, title, opts)`, so the
  three collect their questions with exactly the same code — an edit assembled
  its own way is an edit of a different paper.
- Run **`node tools/editing-mode-tests.mjs`** after touching any of it.

## House rules
- After touching **✏️ editing mode** (`emScope`, `emOwnerQuestion`,
  `emTitleFor`/`emTopicFor`, `emAdoptOwners`, `emSigOf`, `emChangedEntries`,
  `emKwFor`/`emBlanksFor`, `emMayRemove`, `emCondenseCard`, `emIconify`,
  `emHoistInto`, `EM_PRIMARY`, `_ppGo`, or `renderBlocks`'s `emAfterRender`
  hook), run `node tools/editing-mode-tests.mjs`. Editing mode puts EVERY
  question of a sheet into the one block editor at once, which is what makes it
  useful and also what makes every failure here silent — the editor still
  renders, still types and still saves, and is quietly working on the wrong
  question. `emScope` handing back the whole array makes `qPartMap` inherit part
  (c) of question 3 into every block of question 4 and sends the 🤖 AI answer
  button the entire paper as one question; a block id repeated across two
  questions is typing into question 7 and watching question 2 change; a
  signature that reports everything as changed turns one edit into forty writes
  and one that reports nothing turns Save into a button that does nothing; and a
  question allowed to empty itself has nowhere to draw its heading and nothing
  to own the next block inserted into it. The one failure that DOES show is the
  rail: a button lifted out of its `[data-mic-wrap]` dictates into nothing.
- After touching **↩️ back to the preview you came from** (`_wsPreviewSnapshot`,
  `_wsQeReopenPreview`, `wsQuickEditOpenFull`, `_wsQeReturn`,
  `_afterEditNavigate`, `_syncBackToPapersBtn`, or `ppPreview`'s `quiet`), run
  `node tools/preview-return-tests.mjs`. Every failure is silent — the question
  saves, the toast says so, and the teacher simply ends up somewhere they did
  not ask to be. A snapshot taken after `closeWorksheetPreview()` is always
  null, so the return quietly stops working while the edit itself behaves
  perfectly; a snapshot `editQuestion` forgets to clear sends a later,
  unrelated edit to a sheet nobody opened; and reopening on the DESTINATION
  rather than the snapshot's kind confuses the paper preview with the Past
  Papers page, which both land on `papers`.
- After touching **the printed part label** (`PRINT_PART_PAD_*`,
  `printPartPadPt`, `printPartBlockHtml`, or the
  `.print-text-block.print-has-part` rules), print a question with parts and
  LOOK at the page. Both directions are silent and nothing throws: too little
  reserve and the marker prints on top of the first words of its own question,
  too much and the label eats the column the question is set in. And the two
  numbers — the block's `padding-left` and the label's `width` — must keep
  coming from the one call, or they drift apart and the overlap comes back on
  whichever surface was not looked at.
- After touching **the AI routes** (`aiEngineOrder`, `askOpenAiServer`,
  `askChatGpt`, `_aiRun`, `_aiAsk`, `askGeminiDirect`, `AI_DOWN_MS`, `_aiWhy`,
  `aiRouteReport`, `renderAiEngineStatus`, `aiEngineChoicePreview`, or
  `askGemini` / `askGeminiVision`'s wrappers) — **or the `askOpenAi` function
  in `polymathlc/math/functions`, which is the other half of it** — run
  `node tools/ai-routes-tests.mjs`. Every failure is silent and the app looks
  exactly as it did the morning the spending cap was hit. The server route
  dropping out of the order is the whole feature reverting: a key in
  localStorage rescues the teacher's laptop and no student's phone, so it
  looks healthy to the one person who would notice and to nobody else. A
  one-way fallback leaves the failure that actually happens with nothing
  behind it. A "down" note that never clears makes the second route
  permanent, and one that takes a route OFF the list leaves the app dead once
  the cap has been lifted. And the second error reported instead of the first
  tells the teacher "no key on this device" about a paper that hit a billing
  cap. And `askChatGpt` filtered to "not Gemini" rather than to ChatGPT's own
  routes puts Kimi in the cross-check's ChatGPT column, which reads as two
  engines agreeing and is one engine agreeing with itself.
- After touching **📷 a question that came off a photograph** (`SCANNED_SOURCE`,
  `_vetIsScanned`, `SCANNED_CARD_BORDER`, `SCANNED_CARD_BADGE`, or the
  `restBorder` ranking in `renderVettingList`), run
  `node tools/scanned-question-tests.mjs`. One word — `source: 'scan'` — is the
  whole contract with `polymathlc/scan`, and every way it goes wrong is silent:
  rename the value and the card still arrives, still renders and still approves,
  it simply stops being purple and stops saying it came off a photograph. A
  scanned question has no diagram and no topic, so a card that looks like every
  other draft is approved at the same speed as one somebody typed and checked —
  and reaches the bank with the figure missing. The ranking is the other half:
  purple must beat "just added" and lose to the red of a card ticked for
  deletion, or the author cannot see what they are about to delete.
- After touching **(b)(i) roman sub-parts** (`QPART_ROMANS`, `qSubNormalize`,
  `qPartKey`, `qPartLetterOf`, `qPartSubOf`, `qPartKeyIn`, `qPartNormalize`,
  `qPartLabel`, `qPartMap`, `qBlockOpensSub`, `qBlockOpensKey`,
  `_qSubOwnMarker`, `setBlockSubPart`), run `node tools/sub-part-tests.mjs`
  **and** `node tools/part-marker-tests.mjs`. Every failure is silent: a
  sub-part that stops inheriting its letter leaves a renumbered question
  pointing at the old one; a new letter that inherits the last sub-part files
  everything under (c) as (c)(ii); `qBlockOpensPart` returning a KEY makes the
  exam paper builder, autoNumberParts and the Doctor match nothing at all; and
  a letter that stops covering its own sub-parts drops the marking scheme's
  answer for part (b) on the floor.
- After touching **the paginated answer key or the past-paper preview**
  (`_packAkRows`, `_akPageTitle`, `_printAkPageEl`, `_printPlanAkPages`,
  `plan.akPlans`, `_wsPreviewPaper`, `ppPreview`, `_ppPrintQuestions`, or
  `_akSectionsHtml`'s `kind`), run
  `node tools/answer-key-pagination-tests.mjs`. The key is the page a teacher
  marks from and every failure lands on paper: charge the heading to one sheet
  instead of all of them and sheet two prints over the bar; drop the row-order
  restore and the live preview rebuilds from a shuffled DOM, putting every
  answer under the wrong question number; let either consumer stop calling
  `_printAkPageEl` and the preview paginates differently from the PDF, so the
  teacher checks a layout they will not get.
- After touching **[2] question marks** (`qMarksOf`, `qMarksLabel`,
  `qStripTailMarks`, `qMarksAppendHtml`, `QMARKS_TAIL_RE`,
  `QMARKS_TAIL_POS_RE`, `qPartBodyHtml`, `qMarksPickerHtml`, `setBlockMarks`,
  `commitBlockMarks`), run `node tools/question-marks-tests.mjs`. Every failure
  is silent and lands on a printed sheet in front of a class: a marker appended
  to the END of the string instead of inside the last tag puts the marks on a
  line of their own on every question at once; a marker left in the wording as
  well as in the field prints "… at point A. [2] [2]"; a strip that reaches
  past the end of the wording deletes "[see Diagram 1]" out of the middle of a
  question; and a block with NO marks that does not render byte for byte what
  it always did changes the whole bank at once.
- After touching **✏️ the answer key edited from the preview** (`_akeRows`,
  `_akeHasAnswer`, `_akeNewExplanation`, `_akeKey` / `_akeSplitKey`,
  `_akeSyncFromDom`, `akeSave`, `AKX_SWITCHES` / `akxPrintOn`, or either print
  path's `case 'explanation'`), run `node tools/answer-key-edit-tests.mjs`.
  This is the page a teacher marks thirty scripts from, so every failure is met
  in front of a class and none of them throws. A field the KEY prints and the
  drawer does not offer is a wrong answer nobody can fix from the place they
  noticed it; a field the drawer offers and the key does not print is worse — it
  is edited, saved, and the sheet comes off the printer unchanged. An
  explanation added with no part on a question that HAS parts silently reads as
  explaining the last one. And the box key split on the FIRST separator instead
  of the last writes an imported block's answer onto a field that does not
  exist, so the edit simply vanishes on save.
- After touching **🔑 keywords / 🔲 fill-in-the-blanks** (`_kwParse`, `kwIndices`,
  `qKwIndices`, `qKeywordWords`, `qHasKeywords`, `kwBoldPlain`, `kwBoldHtml`,
  `qKeyFieldHtml`, `qKeyPlainHtml`, `kwBlankFieldHtml`, `kwPreviewFieldHtml`,
  `_kwFibBlockHtml`, `qpSetMode`, `editorKeywords`, or `_markedToBlanks`), run
  `node tools/keyword-blank-tests.mjs`. Every failure is silent and the app goes
  on working. **Reading `q.blanks` as keywords** is the one that has already
  happened: it hands every AI-built question in the bank a set of words the
  teacher never chose and a practice mode they never asked for, and it looks
  from the inside like the feature working unusually well. A word count that
  drifts by ONE slides every keyword along its sentence — the mode then blanks
  "the" and the printed key underlines "of", and nothing anywhere says so.
  Splicing the bolding front to back instead of back to front prints mangled
  markup in the middle of a teacher's answer key. And a blank renderer that
  returns an empty string rather than null takes the answer box off the question
  and puts nothing in its place: a question that renders perfectly and cannot be
  answered.
- After touching **the teaching-notes digests or the live notebook** (`_notesGuidanceBlock`,
  `_notesMarkingBlock`, `_notesGenBlock`, `_notesAnswerBlock`, `_notesFor`, `_noteSuitsThisApp`,
  `loadTeachingNotes`, `_notesDetach`, `stopTeachingNotes`, `NOTES_GUIDE_CHARS`, `quickNoteSave`,
  `_noteSourceLabel`, `notesCardHtml`), run
  `node tools/teaching-notes-tests.mjs`. Every failure here is silent: a digest that comes back
  without the teacher's standing instruction is an ungrounded prompt, so the AI still builds the
  question, still writes the answer and still marks the student — in its own voice instead of
  theirs, with nothing anywhere saying so. Two of them are worse than that. Filtering `guidance` by
  topic looks perfectly reasonable and quietly makes a HOUSE RULE apply to some questions and not
  others; and a digest that bails out before the guidance when there are no keywords to report
  ignores a teacher who has typed a rule and uploaded nothing else at all. The notebook is shared
  with `polymathlc/anskey` and `polymathlc/scan`, so a field that stops being read here goes on
  being written there — the version of this bug that is invisible from both sides. The harness also
  pins the two rules that make the sharing real: a general note applying ALONGSIDE the topic match
  rather than only when nothing matched (which is how every note those apps write arrives), and a
  maths-only note staying out of a science prompt whatever else it carries.
- After touching **the siege squad** (`EMS_SQUAD_PER_ROLE`, `emsSquadClean`,
  `emsSquadDefault`, `emsSquadSaved`, `emsSquadStore`, `emsRenderDeck`'s squad
  read, or the `squad` field in `tcgHydrateState`'s `siege` literal), run
  `node tools/siege-squad-tests.mjs`. Every failure is silent and lands on a
  student mid-game: lose the per-role cap and a squad is eighteen attackers and
  no healer, lose the ownership test and a merged-away monster sits on the bench
  costing mana and summoning nothing, and lose either the deck read or the save
  field and the pick screen is decoration — the choice is made, confirmed, and
  then ignored by the battlefield or forgotten by the next run. An EMPTY squad
  is the worst of them: the deck column is the only way to summon anything, so
  the game renders perfectly and cannot be played.
- After touching **🩷 the pink wall** (`_tcgScreenCut`, `_tcgTryScreens`,
  `_screenSubjectKept`, `_tcgCutBackdrop`, `_tcgSlotStandsOnNothing`,
  `_tcgLiveIndex`, `_tcgLiveClean`, `_tcgLiveImg`, `_tcgLiveWatch`,
  `tcgKeyArtImgs`, `TCG_SCREEN_EDGES_MIN`, `TCG_SCREEN_RING_SEEN_MIN`,
  `TCG_SCREEN_SUBJECT_MIN`), run `node tools/pink-screen-tests.mjs` **and**
  `node tools/chroma-key-tests.mjs`. Every failure here is silent and lands on
  every game surface at once: too timid and 206 avatars and portraits stand on
  a bright magenta wall in front of the whole school; too eager and a violet
  monster shot on a magenta screen is dissolved instead, which nothing on
  screen reports and which no test but `_screenSubjectKept` can see. The
  two-clean-edges refusal and the already-a-cut-out refusal are the boundaries
  that keep the relaxed ring rule from becoming a licence, and the display
  index dropping a url that serves BOTH an avatar slot and a card-art slot is
  what stops a card face having its painted scene cut off it.
- After touching **the bundled Realm of Embers art** (`tcgBundledArtPath`,
  `tcgBundledArt`, `tcgSlotArt`, `tcgSlotHasArt`, `tcgBundledSlotIds`,
  `TCG_BUNDLED_HEROES`, `TCG_BUNDLED_FX_DIR`, `_tcgSlug`), or after renaming a
  card, moving a file under `assets/realm-of-embers/` or adding a set, run
  `node tools/bundled-art-tests.mjs`. Every failure here is silent in the app
  and expensive: a derived path that misses is an `<img>` that 404s and a
  monster that falls back to its emoji — no error, nothing in the console a
  student could report, and the game looking unfinished for everybody at once.
  The harness also pins the half nothing else can: that an **override still
  wins**. The bundled layer is a floor, never a ceiling, and a resolver that
  got that backwards would make every picture an admin has ever drawn
  invisible while the game carried on looking perfectly fine.
- After touching **`tools/key-realm-sprites.mjs`**, re-run it (`--check` first)
  and look at `assets/realm-of-embers/previews/keyed-sprites-qa.png` before
  committing. It rewrites 206 sprites in place, both directions are quiet, and
  the checkerboard is what makes them visible: key too little and a monster
  walks onto the battlefield in a magenta box; key too much and a hole is
  punched clean through it. And a detector that counts transparency as evidence
  of a wall turns the tool into one that eats the artwork on its SECOND run —
  which is the run nobody watches.
  - **Its first run hollowed out four sprites and called all four a success**
    (v1.307.0): the dream moth, the owl sage, the mindrender and the psywhisker
    are VIOLET monsters shot on a MAGENTA wall, so `_screenDn` scored their
    bodies as wall. Nothing it checked could see it — the "lost" test counts
    only pixels the wall never touched (their bodies were screenish, so they
    were not counted), and the "is the wall gone" test was satisfied *because*
    the monster went with it. It now also runs the app's own
    `_screenSubjectKept`. The 32 same-hue battle avatars then take a build-only
    sampled-RGB fallback: the real border colour is keyed, detached plate
    fragments are discarded, and the largest connected character is retained.
    Its looser 35% survival floor applies only after the 72% broad-key guard has
    failed and is paired with the ordinary minimum-area and leftover-screen
    checks. A refusal remains non-destructive and leaves the source untouched.
- After touching **⏳ Still loading** (`imgWaitBarHtml`, `imgWaitStart`,
  `_imgWaitPaint`, `_imgWaitDone`, `_imgWaitImages`, `imgWaitRetry`,
  `imgWaitStop`, `_scheduleImgWait`, `IMG_WAIT_*`) or **`_qAnswerDiagrams`**,
  run `node tools/auto-diagram-tests.mjs`. A loading bar is only worth having
  while it is honest, and every way it goes wrong is worse than not having it:
  a fill driven by elapsed time is a bar that lies about how far it has got; a
  bar that never appears leaves the gap unexplained, which is the original
  problem; and a bar that never LEAVES — because a failed picture is still
  being waited on, or a re-render left a second watcher behind — tells a
  student a question is still coming when it has already arrived. On the other
  side, `_qAnswerDiagrams` reaching anywhere but the post-marking card prints
  the answer above the question.
- After touching **🖼 Auto diagram** or the **🎨 Photo Editor** (`_akdPrompt`,
  `AKD_PRINT_RULES`, `_akdAnswerText`, `_akdMake`, `akdRunQuestion`,
  `akdRunBlock`, `_peOpen`, `pePickFiles`, `_pePaste`, `peDownloadName`,
  `annotDownloadPng`, `applyAnnotTool`'s target branches, or `_annotOpenSrc`'s
  target/cap handling), run `node tools/auto-diagram-tests.mjs`. Both features
  hang off ONE editor and ONE picture slot, and every way they go wrong is
  quiet: a fresh draw that stops asking destroys a scan that may be the only
  copy of it; a prompt that stops asking for flat black-on-white line-work
  returns a shaded render that looks fine on screen and is unreadable at 60mm
  in grey; the two reference pictures swapped makes 🔄 Regenerate start from
  scratch every time, which reads as the instructions being ignored; a target
  with no branch in `applyAnnotTool` writes an answer-key diagram into a
  question's picture instead; and a Photo Editor that is not admin-gated in
  `navigateTo` is a page a hidden nav item does not actually close.
- After touching **🔎 Why not this one** (`_wnyOpts`, `_wnyUsable`,
  `_wnyNormItems`, `_wnyKeyRows`, `_wnyPrintJobs`, `wnyArm`, `wnyPrepare`,
  `_mcqPaintResult`, or `_pushBlockAnswerKey`'s `why` argument), run
  `node tools/why-not-tests.mjs`. This one tells a child something about a
  question they have just got wrong and prints it on the sheet a teacher marks
  from, so every failure states something untrue, confidently, on a page that
  looks perfectly right: a reason lined up against the wrong option reads
  exactly as well as it does against the right one and teaches the opposite of
  the truth; the correct option appearing among "why the other options are
  wrong" is the key contradicting itself two lines below the answer it just
  gave; the badge armed before marking points straight at the answer, since it
  only ever goes on the WRONG options; and `_wnyOpts` drifting apart for a
  block and a marking-store entry silently splits one generator into two, so
  the student reads one sentence, the teacher marks from another, and every
  print re-bills the AI.
- After touching **🛟 art safety & recovery** (`tcgArtBackupSync`,
  `tcgArtRestoreBackup`, `tcgArtExport`, `tcgArtImport`, `_tcgArtWriteMany`,
  `_tcgRescueSlotSequence`, `_tcgRescueRelay`, `tcgArtRescueApply`,
  `_tcgArtLoadFailed`), run `node tools/art-safety-tests.mjs`. This protects the
  one document that decides what every picture in the game is, and it has
  already been lost once. Every failure here is silent and each turns a safety
  net into a hazard: a backup that mirrors a wipe destroys the last good copy at
  the exact moment it is needed, a failed read mistaken for an empty store
  invites a redraw of artwork that was never gone, a restore or a rescue that
  overwrites rather than fills gaps destroys the work it was run to save, and a
  rescue proposal laid on out of step files every picture under the wrong
  monster while looking exactly like a successful recovery.
- After touching **the Student Usage Tracker** (`USAGE_MODES`, `usageMode`,
  `sutCredit`, `sutVerdict`, `sutQuestionMeta`, `sutVisible`, `sutByMode`,
  `sutExportCsv`, `sutOverrideOf`, `sutAnswerRowsHtml`, `sutOverrideHtml`,
  `sutSaveOverride`, `_attemptAnswers`) or **`logGameAttempt` / `SD_GAME_MODES`**, run
  `node tools/usage-tracker-tests.mjs`. Every failure here is silent and a
  teacher acts on it: a mode that falls out of the log is a child's work made
  invisible, a verdict threshold that drifts from the app-wide 0.95 makes the
  tracker and the progress counters disagree about the same answer with nothing
  to say which is lying, and an export that reads a different window from the
  table it came from sends a parent a report of work in a mode the teacher had
  filtered away. The answer panel is the only place a teacher can check the
  AI's marking, so a part shown against the wrong label, the expected answer
  printed as the student's, or an empty panel with no explanation each turn
  "read what they wrote" into something nobody trusts twice — and an override
  honoured in the row but not in the average is the dashboard quietly
  disagreeing with itself on the one row somebody looked at closely.
- After touching **the crop's pixel passes** (`_inkThreshold`, `INK_RATIO`,
  `_expandRectToWhitespace`, `_trimEdgeTextLines`, `MAXRUN_FRAC`, `RUNS_MIN`,
  `RULE_FRAC`, `RULE_GROUPS`) or **`_rectangleRules()`**, check a crop of a
  photographed page as well as of a screenshot. Every failure here is silent and
  the question is still built: a fixed ink level is right on a screenshot and
  reads a whole PHOTOGRAPH as ink, so both passes find one band and stand down on
  every phone picture ⚡ Rapid add takes — the crop back to whatever rectangle the
  model drew, with nothing on screen to say so. In the other direction a trimmer
  that cannot see a long stroke takes the top row off a table, the axis labels off
  a graph and the caption off the picture it names, and all three look like a
  perfectly successful crop. The same block is in `polymathlc/english`,
  `polymathlc/chinese` and `polymathlc/math` — ship a change to all four together.
- After touching **🧻 Clean paper** (`PAPER_*`, `_paperWhitePoint`,
  `_paperCleanPixels`, `_paperCleanDataUrl`, `generateCleanEnhancedImage`,
  `annotCleanPaper`), run `node tools/paper-clean-tests.mjs`. Both directions
  are silent and both are found in front of a class: too timid and every
  diagram keeps the weave an image model's decoder left on it, which is
  invisible on screen and prints as a striped grey wash; too greedy and the
  pass reaches past the background into the drawing, flattening a pale blue
  water fill, a grey shading or a photograph's highlights to blank white — and
  the picture still looks perfectly clean, so the damage is only visible
  against an original nobody kept.
- After touching **the printed MCQ answer box** (`_printMcqBlockHtml`,
  `_printMcqAnswerBoxHtml`, either print path's `case 'mcq'`, the
  `.print-mcq-answer*` print CSS), run `node tools/print-mcq-box-tests.mjs`.
  Every failure here is found in front of a class rather than at a keyboard,
  and the worst of them is silent: the two print paths drifting apart, so the
  box prints from one button and not from the other. Taking the MCQ out of the
  `default` branch also takes it away from `_pushBlockAnswerKey`, which the
  harness pins — a key that drops every MCQ prints perfectly and looks tidy.
- After touching **✍️ AI complete** (`completeBtnHtml`, `_aicTrimEcho`,
  `_aicJoin`, `_aicUnquote`, `_aicWords`, `_aicAppendInto`, `_aicPrompt`, or
  ✨ Improve's `complete-btn` guard), run `node tools/ai-complete-tests.mjs`.
  Every failure is silent and lands in the middle of writing somebody was part
  way through: trim too eagerly and the real continuation is thrown away or
  starts halfway through a word, too timidly and the author's own opening is in
  the box twice, and lose ✨ Improve's guard and one press of ✍️ AI complete also
  runs the button that REWRITES the box.
- After touching **the clone stamp's live preview** (`_annotClonePeekSrc`,
  `_annotUpdateClonePeek`, `ANNOT_PEEK_MIN`, `_annotUpdateBrushRing`), run
  `node tools/clone-preview-tests.mjs`. A preview that does not appear is
  obvious the first time anyone picks the tool; a preview centred on the WRONG
  source point looks exactly like a working one and aims every stamp a little
  way off — which is worse than the pin-and-guess it replaced.
- After editing `app.js`, validate it: `cp app.js /tmp/c.mjs && node --check /tmp/c.mjs` (the `.mjs` copy makes Node parse it as a module, so `import` at the top is accepted).
- **The Gemini model is `AI_MODEL` and its thinking floor is `AI_THINK_MIN`, and the two move TOGETHER** (v1.289.0). Every model has its own thinking scale and a level it does not know is a **400 INVALID_ARGUMENT on every single AI call in the app** — not a degraded answer, no answer at all. `gemini-3.7-flash` takes `low` / `medium` / `high` and **dropped the `"minimal"` that 3.6 accepted**, exactly as 3.x had already dropped 2.x's numeric `thinkingBudget`. So the floor is a named constant used at every call site rather than a string typed out in six places, and swapping the model means checking its scale first. The same pair lives in `fractions.html`, `math.html`, `video-review.html` and `bar-model.html` — each has its own copy, so a model change is five files, and `polymathlc/english`, `polymathlc/anskey` and `polymathlc/math` carry the same stack again.
- After touching **the subject switcher** (`SUBJECT_APPS`, `SUBJECT_KEY`,
  `subject*`) or **⚡ Rapid add's batch level** (`rapidLevel`, `setRapidLevel`,
  `_rapidApplyLevel`, `_rapidLevelOptions`, `_aiBuildQuestionPrompt`'s
  `levelHint`), run `node tools/subject-level-tests.mjs`. A url pointing at the
  wrong folder does not error, it loads the WRONG subject's app, and
  `../science/` is a 404 for the whole school (the folder is `cer`). An
  absolute url is the same failure delayed until the centre moves domain. And
  the batch level has no field to check itself against — a level is read off
  the TOPIC here, so if the narrowing stops working the picker still says
  "filed at P5", the toast still says "at P5", and forty questions land
  wherever the AI's topic put them.
- After touching **Ember Duel's sound or screen shake** (`DUEL_HIT_TIERS`, `DUEL_HEAL_TIERS`, `DUEL_CUES`, `DUEL_SYNTHS`, `duelSfxFlush`, `duelSfxPlay`, `duelSfxCue`, `duelQuake`), run `node tools/duel-sfx-tests.mjs`. It loads the REAL sound section out of `app.js` against a Web Audio shim and pins the ladder (every tier louder / deeper / longer / shaking harder than the one below), the one-beat-per-flush rule, the lunge delay, the routine cues staying under the blows, the draw riffle and its defer cap, and the mute switch.
- After touching **Ember Duel's heroes** (`DUEL_HEROES`, `duelResolvePower`, `duelCanUsePower`, `duelHurtHero`'s armour rule, `duelHeroId`), run `node tools/duel-hero-tests.mjs`. It loads the REAL hero table, armour rule and power resolver out of `app.js` and pins the things that break silently: the default being the safest hero, a retired hero id falling back rather than crashing, armour being spent before life, the two-mana once-a-turn rule, and **every** hero power `kind` actually doing something.
- After touching **Ember Duel's rival decks or the AI's card timing** (`DUEL_RIVAL_PLANS`, `duelPlanFor`, `duelDeckIsSwarm`, `duelRivalDeck`, `_duelFill`, `duelAiWorthPlaying`), run `node tools/duel-rival-tests.mjs`. It loads the REAL rival-deck section and worth-test out of `app.js` and runs them over a synthetic dex, pinning both halves of the swarm counter: the sweeper deck really holding board clears, the AI really holding them until two minions are on the table, the counter being likelier against a swarm **and** still not the only deck a swarm player meets, and the deck staying legal (40 cards, copy limits, one star past the band at most).
- After touching **the vetting list's bulk delete** (`_vetSelected`,
  `_vetVisibleQuestions`, `_vetDeleteMany`, `_vetPruneSelection`,
  `deleteVettingDocAwait`), run `node tools/vetting-bulk-delete-tests.mjs`. One
  press can clear the whole vetting list, and both ways it can go wrong are
  silent: 🗑 Delete all reading `vettingList` instead of the VISIBLE set
  destroys the questions the author had filtered away and never saw, and a
  question dropped from the list on a delete the database refused leaves a page
  that looks tidy and a question that is back at the next sign-in.
- After touching **the duplicate warning** (`findDuplicateCandidate`,
  `_dupTokenSet`, `DUP_MIN_SCORE`, `_dupStillThere`, `checkEditorDuplicate`,
  `dupWatchKick`, `_dupGateSave`), run `node tools/duplicate-warning-tests.mjs`.
  It fails silently in both directions and the app works perfectly either way:
  too tight and it never fires (a question re-read off the same paper is never
  worded byte-for-byte the same), too loose and it fires on every save, which
  makes it a warning nobody reads and lets the real duplicate through behind
  it. The harness also pins that the VETTING list is searched — the commonest
  duplicate of all is the same screenshot read twice in one sitting, and both
  copies are then in vetting where a bank-only search sees neither.
- After touching **the doubled part marker** (`qStripOwnPartMarker`,
  `qPartBodyHtml`, `_qPartOwnMarker`, `_qPartOwnMarkerRe`, `qLiftPartMarkers`),
  run `node tools/part-marker-tests.mjs`. Both directions are silent: too timid
  and every AI-built sub-question prints its letter twice ("(a) (a) What is
  X?"), too eager and it eats the front of the question — "(see Diagram 1) What
  is X?" opens with a bracket and is prose, and a block labelled (b) whose text
  opens "(a)" is a disagreement somebody should see rather than have tidied
  away.
- After touching **the answer key cross-check** (`akcCompare`,
  `akcAnswersAgree`, `akcAgreesWithKey`, `akcTextOverlap`, `akcKeySections`,
  `akcAskEngine`, `akcPrompt`, `akcRecentQuestions`) **or the shared
  `AI_ENGINE_STORE` slot names**, run `node tools/answer-key-check-tests.mjs`.
  Every failure here looks like a working report: a loose agreement test turns
  the whole run green and certifies wrong keys, a reversed comparison tells the
  teacher to change a correct one, a Gemini call that quietly went through
  ChatGPT is two columns of the same model agreeing with itself, and a slot
  name that drifts from the other three portals leaves the key unreadable here
  — which reports as "only one engine is available" and never as a fault.
- After touching **✅ Check Questions' detectors** (`_cqTableLabelsChoices`, `_cqOptsAreBareNumbers`, `_cqMcqFixable`, `_cqLocalFindings`, `_cqTableRows`), run `node tools/check-questions-tests.mjs`. Both directions fail silently: too loose and the page tells an employee to blank the options of a question whose choices are NOT in the table — one tap and the wording of all four is gone, with the ＃ button looking like it did the right thing; too tight and the one problem the page exists to catch is never flagged.
- After touching **🎯 learning-objective tagging** (`qLos`, `_loOrderIds`, `loQuestions`, `loDetachQuestion`, `_loCandidates`), run `node tools/objective-tag-tests.mjs`. Every failure mode here is silent — a tag dropped because the objective list had not loaded, a tag lost because the list no longer knows that id, a filed question that simply does not appear under its objective — and none of them throws.
- After touching **the printed ANSWER KEY** (`_pushBlockAnswerKey`, `_pushAnswerKeySection`, `_pushAnnotAnswerKey`, `_qFallbackKeySection`, `_akQuestionSections`, `_akSectionsHtml`, or either print path's answer-key branch), run `node tools/answer-key-tests.mjs`. A key that drops a question prints perfectly and looks tidy — there is no error anywhere — so the omission is only found in front of the class.
- After touching **🔱 artifact levels** (`TCG_ARTI_*`, `tcgArtiPow`, `tcgArtiBlurb`, `tcgArtiAbsorb`), run `node tools/artifact-level-tests.mjs`. Each artifact's `pow` means something different — a percentage, a countdown, a damage multiplier, a boolean — so a single scaling rule is wrong for three of the four, and getting one backwards makes an artifact WEAKER the more copies a student feeds it without throwing anything.
- After touching **anything in the game-art background removal** (`_stripImageBackground`, the chequerboard detector, `_bgLeftover`, `_screenKeyOut`, `elgKeyed`), run `node tools/bg-cut-tests.mjs && node tools/chroma-key-tests.mjs`. They load the REAL functions out of `app.js` and run them over synthetic sprites, and every case in them is a bug that actually shipped — a pack hollowed out through its own tear, a shadow monster whose plate could not be removed, scale armour deleted by the chequer cutter. Add the case before the fix.
- Do NOT change enemy base `gold`/`xp` (the `RPG_ENEMIES` map step) — they are shared by the dungeon AND the per-question battle strip. Tune dungeon-only rewards via `ADV_XP_SCALE` / `ADV_GOLD_SCALE` and the floor-clear bonus instead.
- **🪙 "points" (`rpgState.gold`) must never be earnable from a repeatable button.** Points buy booster packs, so any source that pays without a gate is a farm that beats answering questions. Every faucet must be behind one of: answering a question (`rpgAwardGameQuestion`, which has the rushed-answer and wrong-run guards), a game credit (`_spendCredit` — 1 per 5 questions answered), or a once-per-day/week claim. Ghost Arena **duels pay nothing** (v1.229.0) precisely because they cost no credit and can be re-fought forever; do not put a reward back on `advArenaEnd`, and do not add a daily quest that a free button can complete. Admin/preview grants (`sim-gold`, `tcgAdminGold`) must check the role in the HANDLER, not just hide the button, and `LEGENDS_GOLD_DELTA` only accepts a POSITIVE delta from a real game iframe (`_isEmbeddedGameWindow`).
- **⚡ The energy bar** (`rpgNoteEnergy` / `_energyState` / `rpgState.energy`, v1.250.0) pays a **free 💠 Gold Pack every `ENERGY_PER_PACK` (50) correct answers** — a pack is real currency, so it obeys the faucet rule above. It fills from exactly two places, both of which have already decided the answer earns something: `rpgOnMarked` (a marked practice question at `credit >= 0.95`) and `rpgAwardGameQuestion` **after** its rushed / wrong-run guards. Do not add a third caller that isn't a marked answer. The pack is banked UNOPENED as `energy.pending` and claimed on the Realm of Embers Packs tab (`tcgOpenFreePack` → `_tcgEnergyHtml`), because the reveal ceremony must not fire on top of the question the student is mid-way through. `_tcgOpenPack(p)` is the shared open path — a bought pack is `tcgBuyPack` (charge, then call it) and a free pack is the same thing minus the charge; anything that opens a pack goes through it or the merge-absorb / publish / reveal steps drift.
- **Science Strike costs a game credit like every other game** (v1.250.0). It cannot spend one itself — fps.html must NEVER write the hero doc — so it READS `users/{uid}/settings/scienceRpg` for the balance (`loadGameCredits`, mirroring `_creditsToday`'s day-rollover and `DAILY_CREDITS` + `star.raids` allowance), gates `startRun` on it, and banks each run started into **`fps.pendingRuns`** with `increment()` on the leaderboard doc it does own. `rpgClaimStrikePoints` settles all three pending fields on index.html's next load — `pendingPoints` → the wallet, `pendingRuns` → today's credit balance (floored at 0, never negative), `pendingCorrect` → the ⚡ bar — decrementing each by exactly what it took so anything banked in between survives. The credit is banked at run START, not at death, or closing the tab mid-run dodges the charge. A FAILED balance read falls open to 99: index.html settles the runs regardless, and locking a student out of a game they have credits for because of a network blip is the worse failure.
- **The All-Time board ranks on `q × acc²`** (v1.261.0) — **every question ever done, multiplied by accuracy counted twice**. `rpgScienceScore` is three lines and the whole formula is one of them; keep it that way, because this board has been re-based under students twice and a ranking nobody can check is a ranking nobody trusts.
  - **`q` is ALL questions, each counting once**: marked practice questions (`stats.marked`) plus questions answered inside the games (`stats.gameQ`). There is deliberately no hidden weighting — an earlier version counted a game MCQ as half, which is defensible and is not what "all questions done" means. `acc` is correct ÷ q, using the FRACTIONAL credit (`stats.creditSum`) for practice so partial marks on a CER answer count for what they were worth.
  - **`creditSum` is YOUNGER than `marked`, and that asymmetry has already put a student on the board at 8% right** (v1.266.1). `stats.marked` / `stats.correct` go back to the start of the hero; `creditSum` and the game counters only began in v1.231.0, so reading `creditSum` as the whole-history total marks every practice question answered before that date as WRONG — a student with 2,497 questions and roughly three in four right ranked 16th of his own ability. Three things now hold the line, and the invariant behind all of them is that **`correct` is a valid LOWER BOUND on `creditSum`**: every question in the binary count scored ≥ 0.95, and part-right answers only add on top, so an honestly accumulated `creditSum` can never sit below `0.95 × correct`. `rpgHydrate` seeds `creditSum` from `correct` once when it is below that line (the `cap99Fix` pattern), `rpgMyScoreParts` takes the **higher** of the two, and `rpgRowScoreParts` takes the higher of the payload's `correct` and the row's own `audit` counters — that last one is what re-ranks rows already published by a broken build, instead of leaving a student on 8% until they next happen to open the app. Any future counter added beside an older one needs the same treatment.
  - **Squaring accuracy is what stops the board being won on volume**, and that failure actually shipped once: with accuracy applied only once, 900 questions at 35% beat 400 at 88%. Under `acc²` it is 110 against 310, the right way round. **Re-check exactly that pair if you retune `SCORE_ACC_WEIGHT`.**
  - **`rpgRowScore` RECOMPUTES from the row's parts** (`rpgRowScoreParts`) instead of trusting the `v` the publisher wrote, so retuning the formula re-ranks the whole board on the next render rather than leaving students who haven't opened the app ranked under the old rule. Three sources in order: a current payload (`score.f >= 2`), the raw `audit` counters every build publishes, then a v1.231.0 payload. `SCORE_PAYLOAD_FORMAT` must be bumped whenever the parts change MEANING — v1.231.0's `q` was work-weighted, and reading it as a plain question count would be wrong.
  - **Pace is still measured and published** (`rpgState.pace`, shown in the admin's 🕵️ Activity & points view) but does **not** rank anything. Ranking history: XP → Science Score (v1.231.0) → XP (v1.260.0, reverted after students found their standing rewritten overnight) → this. The lesson from that revert is not about the formula: **a leaderboard is a promise, so announce a change before it lands.** The Grand-prizes line on the Leaderboard page states the current rule in one sentence — keep it in step with the code.
- **Leaderboard bans** (`_getBoardBans` / `adminSetBoardBan`, `users/{adminUid}/settings/boardBans`) are **scoped** (`BOARD_BAN_SCOPES`: `all`, or `embers` = the Embers/Siege/Legends family) and applied at RENDER, per tab, via `rpgBoardBanned(uid, tab)` — the main board's list filter, `tcgRenderBoard` and `_computePrizeWinners` (through `PRIZE_CATEGORY_TAB`) all call the same predicate. A new board must call it too, and a new prize category needs a `PRIZE_CATEGORY_TAB` entry, or bans leak. `rpgFetchLeaderboard` deliberately does NOT filter; it just populates the ban map. An unknown scope fails closed (treated as `all`).
- **Usage → 🕵️ Activity & points** (`renderActivityAudit`) joins the shared activity collections with the `audit` block `rpgPublishLeaderboard` puts on each row (wallet, duel record, packs, counters) — a teacher cannot read a student's hero doc, so anything the audit view needs must be added to that `audit` block first. `AUDIT_FLAGS` are prompts to look, not verdicts; keep the raw numbers beside every flag.
- Retroactive point corrections use the **broadcast-marker pattern**: the admin cannot write student hero docs (`users/{uid}/settings/scienceRpg`), so they write one marker under `users/{adminUid}/settings/…` and every student's client applies it to itself once, keyed by an ack field on `rpgState` (see `creditReset`/`_creditsToday` and `duelClawback`/`rpgApplyDuelClawback`). `heroOps`/`rpgApplyHeroOp` is the same thing addressed to ONE student by uid (`adminHeroOp`) — that is how the merge-level reset works. Students must be able to read that settings path in the Firestore rules. Note that resetting TCG merge levels means writing `merges[id] = 1` explicitly for every owned card: `tcgHydrateState` rebuilds a MISSING entry from the student's spare copies, so deleting them hands every merge straight back.
- **Retired topics — Cell Systems** (`QRETIRED_TOPIC_RE` / `qRetiredTopic` / `qInSyllabus`, v1.274.0) belong in exactly ONE place: the 📄 PSLE / past papers segment, where a paper is reproduced whole and a missing question would only confuse the student reading it. **Everywhere else they must not appear at all** — every practice mode, every game, Snap & Mark, the worksheet creator, the saved-worksheet editor, the custom-quiz builder, the print picker and the scheduled-release picker all go through `qInSyllabus`. Two exceptions are deliberate: the **Question Bank page** still lists them (marked 🚫) because it is the admin's management surface and a question nobody can find is one nobody can fix or delete, and the **exam paper builder** is authoring, not serving.
  - It is a **topic** rule, not the per-question `notInSyllabus` flag, so it cannot be defeated by an admin forgetting to tick a box on one question out of forty — and it reads **both** topic fields (`topic` and `topic2`).
  - It fails silently in BOTH directions — too loose serves a retired question to a child, too tight makes a live topic vanish from the whole app with no error anywhere — so run **`node tools/syllabus-tests.mjs`** after touching it. It pins every spelling of the retired topic, the secondary-topic field, and every live topic in `topicsByLevel` staying live (including the ones that merely mention cells: "the cell is the basic unit of life" is P5 Reproduction and very much in the syllabus).
  - Adding another retired topic is one alternation in `QRETIRED_TOPIC_RE` plus a case in the harness. **`fps.html` carries its own copy of the test** (it reads the bank directly) — keep the two in step.
- **Terms of access** (`agreementRequire` / `AGREEMENT_VERSION`, `#agreementOverlay`): every student accepts before the portal is usable — enrolled, or not enrolled with a parent/guardian agreeing to the monthly fee — plus the disclaimer that Polymath may change any aspect including points and rewards at any time. **Bump `AGREEMENT_VERSION` to re-prompt the whole roster**; the stored acceptance on `userProfiles/{uid}.agreement` is compared against it. Awaited in the student branch of the auth flow before `famShowLoginPopup()`, skipped for admins and for an admin acting as a student (`_practiceAs`). A failed profile READ re-asks (never let someone through on an error); a failed WRITE lets them through and re-asks next time (never trap a student who agreed). The chosen route shows on the Usage roster and in the audit CSV — the "not enrolled" one is a billing commitment.
- Two CSS traps in `index.html`, both of which have already cost a rebuild:
  - **`.confirm-dialog` is declared LATE** and sets `max-width: 400px`, `padding` and `text-align: center`. A new dialog variant that only adds a second class earlier in the file silently loses all three. Use `.confirm-dialog.your-variant` (both classes) for anything that clashes.
  - **Tailwind's preflight sets `appearance: none` on form controls**, so a bare `<input type="radio">`/`checkbox` renders as an invisible white box. Set `appearance: auto` (plus `-webkit-`) on any you add, or draw your own.
  - **A `<button>` does not inherit `color`** the way a div does — it falls back to the browser's own button text, which is near-black. Any card-shaped button (`.tcg-arti` was the one that bit, v1.258.0) must set `color: var(--text)` itself, or its unstyled child text is invisible the moment the surface goes dark. The children that happened to set a colour of their own looked fine, which is what made it hard to spot.
- `.rpg-tabs` must keep `flex-wrap: wrap` and `.rpg-tab` its `flex: 0 0 auto; white-space: nowrap`. Without them eleven leaderboard tabs get squeezed until each label breaks over three lines, the pill goes square, `border-radius: 999px` renders it as a circle, and the emoji on the first line sits outside the curve.
- Commit messages and pushed artifacts must not contain the model identifier.
