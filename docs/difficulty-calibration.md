# Difficulty calibration

How "difficulty" is defined in this app, and the validation run behind the
thresholds.

## The definition

A question's difficulty is **the percentage of simulated average-P6 attempts
that earn the mark**. Low percentage = hard. It is stored on the question as
`q.calib` and is what every difficulty-aware feature reads.

```js
q.calib = {
  pct: 38,            // % of attempts that earned the mark  ← this is "difficulty"
  band: 'hard',       // derived from pct, see the table below
  attempts: 100,      // marks counted (pupils × attempts × answerable items)
  students: 5,        // simulated pupils that completed
  perStudent: [40, 35, 30, 50, 35],
  itemCount: 1,       // answerable items in the question
  runsEach: 20,       // attempts per pupil
  at: '2026-07-26T…',
}
```

| pct | band |
|---:|---|
| 85–100 | very easy |
| 70–84 | easy |
| 50–69 | medium |
| 30–49 | hard |
| 0–29 | very hard |

## How a question is measured

`CALIB_STUDENTS` (5) simulated pupils each attempt the question
`CALIB_ATTEMPTS` (20) times — 100 attempts per answerable item.

1. Each pupil gets a different persona (careful / rusher / memoriser /
   inconsistent / weak English) so five runs aren't five copies of one pupil.
2. They see the question **exactly as a student sees it, never the answer key**,
   and they are told to let themselves be tricked — a tempting distractor or a
   two-step inference is supposed to catch them. That is the signal.
3. **MCQ answers are marked locally** against the real key. No model in the
   marking loop, so it cannot mark itself generously.
4. **Written answers are marked in a second pass** that does see the key, as a
   teacher would: the science idea must be there; spelling and childish phrasing
   don't lose the mark.
5. Multi-part questions are broken into items (each MCQ block, each written
   part); the percentage is over all items and all attempts.

If nothing usable comes back, the run **fails loudly** rather than recording a
made-up number.

## Where it is used

- **Question Bank** — a badge on every card (`🎯 38% · hard`), a difficulty
  filter, a 🎯 button per question, and a bulk "Measure difficulty" button that
  runs over whatever the filters currently show.
- **Ai-nstein worksheets** — "give me the highest difficulty questions on heat"
  sorts by measured percentage. Unmeasured questions sort **last**, never first:
  an unmeasured question is not evidence of being hard. The worksheet card says
  how many of its questions are actually backed by a measurement.

Deliberately **not** wired into `rpgQuestionDifficulty`, which prices gold/XP.
Repricing every reward in the game off this data is a separate decision.

## Validation run (2026-07-26)

Five sub-agents role-played average-ability P6 pupils on a 10-question fixture
(7 MCQ, 3 open-ended) built to contain known PSLE traps. Each did all 10
questions 20 times: **1000 graded answers**. MCQs were marked exactly; the
written rubric is in `grade.cjs` alongside the run.

```
pct  n    band        type  question                                     per-student
 38% 100  hard        mcq   Matter — equal mass, one floats one sinks     A:40 B:35 C:30 D:50 E:35
 51% 100  medium      open  Matter — droplets outside a cold glass        A:45 B:50 C:55 D:70 E:35
 54% 100  medium      mcq   Light — ball closer to torch, shadow size     A:55 B:50 C:45 D:60 E:60
 64% 100  medium      open  Plant reproduction — no insects, fewer fruits A:65 B:55 C:55 D:85 E:60
 66% 100  medium      mcq   Electricity — series bulb removed            A:70 B:60 C:65 D:65 E:70
 67% 100  medium      mcq   Energy — torch bulb (light AND heat)         A:60 B:65 C:70 D:75 E:65
 67% 100  medium      open  Heat — towel-wrapped cup stays hotter        A:70 B:60 C:70 D:80 E:55
 78% 100  easy        mcq   Heat — ball no longer fits ring             A:75 B:80 C:75 D:80 E:80
 88% 100  very easy   mcq   Adaptations — cactus spines                 A:85 B:90 C:90 D:90 E:85
 93% 100  very easy   mcq   Plants — what a plant needs to make food    A:95 B:95 C:95 D:90 E:90
```

**What it shows.** The ordering is the one a teacher would predict: plain recall
at the top (93%), the two-step density inference at the bottom (38%), and the
classic shadow-size trap in the middle (54%) rather than near 100% — the
simulated pupils really do fall for traps. Per-pupil spread is ±10–15 points, so
5 × 20 is a stable enough sample to band on; a single 20-attempt run would not
be.

**Caveats, honestly.**

- In this fixture the correct MCQ option happened to be option 1 every time — a
  flaw in the fixture, not the method. The wrong answers were spread across
  options 2/3/4 (on the density question most pupils chose 3), so the signal is
  real, but the fixture would not detect a position bias. Real bank questions
  have their keys in varied positions and are marked against the real key, so
  the shipped path is not affected.
- The written rubric here is keyword-based. In the app, written answers are
  marked by the AI marking pass, which is more forgiving of phrasing.
- These are simulated pupils, not your pupils. Treat the percentage as a
  well-ordered *estimate* of relative difficulty. Real attempt data
  (`questionAttempts`) is the ground truth to reconcile against once there is
  enough of it per question.
