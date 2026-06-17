# Auto Research Engineer — Results Log

**Asset:** `science-worksheet.html`  ·  **Metric:** total bytes (lower is better)  ·  **Scoring:** `score.py` (locked)

| Round | Hypothesis / Change | Bytes before | Bytes after | Δ bytes | Valid? | Kept / Reverted |
|------:|---------------------|-------------:|------------:|--------:|:------:|:----------------|
| 0 | **Baseline** — untouched file, all gates green | — | 440,715 | — | ✅ | baseline |
| 1a | Terser `compress` (toplevel=false) on the JS module | 440,715 | 357,997 | −82,718 | ❌ | **reverted** — fingerprint lost 11 functions (compress inlined/dropped them). Gate caught it. |
| 1 | Terser **comment + whitespace strip only** on JS module (no compress, no mangle — zero semantic change, all identifiers/strings/templates preserved) | 440,715 | 353,933 | **−86,782** | ✅ | **kept** |
| 2 | `clean-css -O1` minify on the `<style>` blocks (preserves selector/string semantics) | 353,933 | 331,535 | **−22,398** | ✅ | **kept** |
| 3 | Strip HTML comments **outside** `<script>`/`<style>` only (protects template literals & `white-space:pre`) | 331,535 | 330,884 | **−651** | ✅ | **kept** |
| — | **Added runtime gate**: headless-Chromium smoke test (load, 0 new JS errors, all key IDs present, DOM not collapsed). Baseline `domLen`=261,756, stable across 3 runs. Now every "keep" must pass `score.py` **and** this. | — | — | — | — | gate added |
| 4 | Terser **mangle** (all names except 17 reserved fingerprint fns), no compress | 330,884 | 288,542 | −42,342 | ✅ score | **reverted** — runtime gate: 0 JS errors but DOM rendered −16% (261,756→219,414). App references fn names by string; UI silently dropped. |
| 5 | Terser **mangle vars only** (`keep_fnames`) | 330,884 | 305,431 | −25,453 | ✅ score | **reverted** — runtime gate: DOM −9.7% (→236,303). Even variable mangling breaks string-based references. |

---

## Summary
- **Starting bytes:** 440,715
- **Current best:** **330,884**
- **Total saved:** **109,831 bytes (−24.9%)**
- **Rounds run:** 3 kept, 3 reverted
- **Status:** at safe minimum for available transforms. Mangling provably breaks the app (silent UI loss caught only by the runtime gate), so the ~25–42 KB it offers is unreachable safely.

### What worked & why
The file was already whitespace-clean (no trailing spaces/CRLF/blank-line runs), so cheap wins were gone. The real mass was **JS (76.6%)** and **CSS (20.5%)**. The biggest safe win came from the *least* aggressive transform — pure comment/whitespace stripping — because anything that renames or drops identifiers breaks `onclick` handlers / cross-script globals and trips the fingerprint gate (see Round 1a).

### Next levers (higher risk — paused pending a browser)
- **JS identifier mangling** could save another ~50–80 KB, but this single-file app reaches functions via inline `onclick` and global scope, which a minifier can't see. The byte gates can't catch a runtime break here. **Recommended only with a headless browser to verify behavior** — at which point the metric could also upgrade to real load-time-ms.

### Reproducing the tooling (ephemeral container — not committed)
`npm install terser clean-css-cli`  (kept out of the repo via `.gitignore`).
