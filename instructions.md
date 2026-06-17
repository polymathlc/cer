# Auto Research Engineer — Instructions

> **Owner: the human.** This file is edited ONLY by the human. The AI reads it
> and obeys it. (Karpathy-style "program → train → prepare" optimization loop.)

## The goal, in plain English
Make **`science-worksheet.html`** (the Science Worksheet Creator app) **as small
as possible in bytes without breaking it.** A smaller single-file app loads
faster for users and ships faster. "Is it good?" becomes one honest number:
**total file size in bytes — lower is better.**

## The three-file system
1. **Instructions** — this file. Human-owned. The AI never edits it.
2. **Asset** — `science-worksheet.html`. The **ONLY** file the AI may change.
3. **Scoring** — `score.py`. The locked measuring stick. The AI may READ and RUN
   it to score, but **NEVER edits it** and **never redefines "better."**

## The metric (see `score.py` for the exact, authoritative definition)
- Score of a **valid** variation = its size in **bytes**. Lower wins.
- A variation is **invalid** (can never win) unless ALL gates pass:
  1. **JS syntax** — every inline `<script>` passes `node --check`.
  2. **HTML shape** — required structural tags present; `<script>`/`<style>`
     tags balanced.
  3. **Functional fingerprint** — every required token (load-bearing functions,
     UI controls, the title) still present. This is the human's definition of
     "still works." Shrink freely, but these must survive.

## The rules
- Change **only** the asset. Never touch `score.py` or this file.
- **Never game the score**: no deleting features, no stubbing out gated tokens,
  no editing the scoring definition. Win only by genuinely shrinking the file
  (whitespace/comment removal, CSS de-duplication, dead-code removal, shorter
  equivalent constructs) while every gate stays green.
- Each round = **ONE hypothesis, ONE change.** Score it. Keep if it beats the
  baseline; revert if it doesn't (natural selection).
- Always keep a working, valid asset. If a change is invalid → revert.

## The loop (run in ~5-minute rounds, overnight, indefinitely)
1. Record current baseline asset + its score.
2. Form ONE hypothesis; make ONE change to the asset.
3. Score the variation with `score.py` ONLY.
4. New score beats baseline (smaller **and** valid) → keep; it's the new
   baseline. Otherwise → revert and try a different change.
5. Repeat. Log every round in `results.md`.

## Stop condition
Run indefinitely overnight until the human says stop, **or** until no
byte-reducing change has succeeded for many consecutive rounds (diminishing
returns — report and pause). The human may set a target size here at any time.

**Target size (optional, human sets):** _none yet — minimize as far as possible._
