# Student question feeding — v1.392.0

Science uses the same school-level, mastery and repetition safeguards as Math
v1.79.0 (Math PR #195), adapted to Science's question blocks and family accounts.
The banks, students' subject history, answer marking and rewards remain separate.

## Selection

Automatic practice first checks the student's current school level. Science
retains the lower of the active child's declared level and the teacher's cap;
secondary access still requires the teacher's assignment. Missing or invalid
levels cannot silently become P6. A question's highest explicit level, primary
and secondary topic levels, and attached learning-objective levels determine its
school ceiling. Unknown secondary topic metadata is held for review.

Difficulty is matched to recent evidence for the same skill, with one latest
observation per question family. Lifetime best scores, repeated attempts and
success in an unrelated topic cannot promote a student. The estimate starts
conservatively and applies an upper and lower difficulty bound. Existing
well-sampled question usage can cautiously inform difficulty without another
database scan or AI request; a low success rate does not imply a faulty question.

Automatic feeds prioritize suitable current-grade questions before earlier-year
revision, including every game. Numeric proximity from a legacy game rating cannot
promote a P3 question ahead of P6 work. Explicit easy/basic/foundation labels take
precedence over those ratings, and successful easy revision cannot lower the
student's starting target. Difficulty bounds still apply within the current grade.

When current-grade work is exhausted, fresh adjacent-grade work is considered.
At least three distinct, recent, relevant near-grade weak results are required
before an adjacent scaffold can compete with current-grade work or revision two
years below is admitted. Automatic feeding never drops three school years; a
teacher's deliberate worksheet revision remains available. A depleted pool never
overrides quality, school ceilings or repeat spacing. Game preview accounts with
a chosen school level use the same policy; preview without one asks for a level.

Games and automatic quests randomize the full eligible pool before choosing the
requested number of questions. After quality, grade, mastery and spacing checks,
questions in the same grade-priority tier and within 50 fit points of the best
remaining candidate form a shuffle group. A Fisher–Yates shuffle gives each
question family one place in that group's lottery, then randomizes its eligible
variants. Numerous copies of a question do not give its family extra chances.
The next request makes a fresh draw; neither bank order nor a fixed small prefix
determines every student's set. Earlier-grade and less suitable groups remain
behind the preferred group. Shuffling adds no AI call or database scan.
Ordinary practice retains its learning order; explicit worksheets retain their
selected order even if a caller requests randomization. Choice text and authored
answer positions are not changed.

Practice and games share permanent account history for each family learner.
Showing or reserving a question records it before automatic delivery, including
abandoned games and skipped questions. Reloading, restarting a game, switching
modes, waiting for an old review date or using another device never resets this
history. Exact visible copies under different IDs are excluded as well; private
answer corrections cannot turn an old question into a fresh one. Truly new
numerical variants retain the separate fifteen-minute family spacing rule.
A depleted suitable pool stops instead of cycling or falling back to samples.

The portal and standalone Science Strike wait for account history before
automatic feeding. Existing per-child served caches and completed attempts are
merged into that history. Unrelated accounts and siblings remain isolated.
Explicitly chosen worksheets and review actions remain available for deliberate
revision; automatic feeds never silently switch into revision.
The mistake bank tracks the distinct corrective task as well as exposure to its
original question. It can teach a new mistake lesson on familiar work without
repeating that same lesson on the next session. Family name edits preserve the
learner's history identity and previous names used by older attempt records.

When a teacher uses Practice As Student, its preview history belongs to the
signed-in teacher and a separate profile for that learner. Preview delivery
does not directly reserve the student's permanent history. Existing grading
and attempt recording are unchanged; work recorded for a student still counts
when that student's previous attempts are migrated.

Explicit worksheet revision retains eligible question order and can include
harder work within the school ceiling, with notices for suspect content. It
cannot bypass that ceiling or known structural failures. The existing explicit
past-paper exception for retired topics does not open them to automatic feeds.

## Quality without AI cost

The checker uses local rules for Science's actual rich text, inline and block
diagrams, tables, MCQ choices, fill-in-the-blanks and answer workspaces. Empty or
malformed content, broken diagram signals, contradictory choices, truncation,
unfinished placeholders, current existing importer findings and unresolved
reports hold questions out of automatic feeding. Suspect questions are also
excluded from mastery evidence so they cannot penalize a student's skill estimate.

These checks and Smart practice selection use no AI calls or model tokens.
Optional AI authoring and answer marking keep their existing separate behavior.
Deterministic checks identify warning signs; they cannot prove every scientific
question or supplied answer correct.

Public quality summaries contain generic reason codes and a projection of
visible question content. Private answers, correct-option identifiers and report
text are excluded. Current question edits invalidate stale reports/checks.

## Coverage and verification

The policy covers ordinary, quick, topical, adaptive, direct and worksheet
practice, portal quizzes, the five embedded Science games and Science Strike.
Embedded games request fresh selections from their parent; Science Strike uses
the same modules directly. Each rechecks school level and student identity.
Games that mark one choice accept only a single MCQ task; worksheets with
additional written or annotation parts stay in full practice, where each part
can be marked before contributing a complete result.

Run the science-feed policy and standalone suites and the science-feeding
integration/browser suites. Existing school-level, retired-syllabus, release,
marking, coaches, worksheet and import checks must continue to pass.
