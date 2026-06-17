#!/usr/bin/env python3
# =============================================================================
#  SCORING FILE  —  Auto Research Engineer  (LOCKED)
# -----------------------------------------------------------------------------
#  This file is the OBJECTIVE MEASURING STICK. It is owned by the human.
#
#  The Auto Research Engineer (the AI) MAY READ AND RUN this file to score a
#  variation, but MUST NEVER EDIT IT. Changing the definition of "better" —
#  the byte count, the gates, or the fingerprint — is moving the goalposts and
#  is forbidden. If the scoring needs to change, the HUMAN changes it.
#
#  WHAT WE OPTIMIZE
#    Asset:  science-worksheet.html  (the ONLY file the AI may change)
#    Metric: total file size in BYTES.  LOWER IS BETTER.
#
#  THE NUMBER
#    A valid variation's score == its size in bytes (an integer).
#    Smaller beats larger. That is the entire game.
#
#  GATES (anti-cheat — you cannot win by deleting the app)
#    A variation is INVALID (score = None, never "wins") unless ALL pass:
#      1. JS SYNTAX  — every inline <script> block parses with `node --check`
#                      (the type="module" block is checked in module mode).
#      2. HTML SHAPE — required structural tags present and <script>/<style>
#                      open/close tags are balanced.
#      3. FINGERPRINT — every token in REQUIRED_TOKENS is still present.
#                       This is the human-owned definition of "still works":
#                       the load-bearing functions, controls, and title that
#                       make this a Science Worksheet Creator. Shrink the file
#                       however you like, but these must survive.
#
#  USAGE
#    python3 score.py [path-to-html]      # default: science-worksheet.html
#    -> prints one JSON line:
#       {"valid": true, "score": 440715, "bytes": 440715, "gate_failures": []}
#    Exit code 0 = valid, 1 = invalid. Read the JSON either way.
# =============================================================================

import json
import os
import re
import subprocess
import sys
import tempfile

ASSET = "science-worksheet.html"

# --- The functional fingerprint -------------------------------------------
# Bare identifiers / strings that MUST appear somewhere in the file. Bare
# substrings are used on purpose so that legitimate minification (whitespace,
# comments, quote-style changes) does NOT trip the gate — only DELETING or
# RENAMING a load-bearing piece of the app does.
REQUIRED_TOKENS = [
    # identity
    "Science Worksheet Creator",
    # core build / export / print pipeline
    "buildPrintableHtml",
    "buildStandaloneHtml",
    "buildCoverHtml",
    "buildContentsHtml",
    "buildAnswerKeyEditor",
    # authoring: elements & questions
    "addElement",
    "addQuestion",
    "addQuestionToBank",
    "addWorksheetToBank",
    "buildMcqEditor",
    "buildImageEditor",
    "buildVideoEditor",
    "buildTablePreview",
    "buildTextEditor",
    "attachRichText",
    "applyFractions",
    "autoSaveLocal",
    # key UI controls (DOM ids)
    "exportPdfBtn",
    "exportHtmlBtn",
    "addQuestionBtn",
    "draftSidebar",
    "coverControls",
    "activityLog",
    "csPrintBtn",
    "designViewBtn",
    "filterConcept",
    "clearDraftBtn",
]

# Structural tags that must exist for the document to still be a real page.
REQUIRED_STRUCTURE = [
    "<!DOCTYPE html>",
    "<html",
    "</html>",
    "<head",
    "</head>",
    "<body",
    "</body>",
]


def extract_scripts(html):
    """Return list of (is_module, body) for inline <script> blocks with code."""
    scripts = []
    for m in re.finditer(r"<script\b([^>]*)>(.*?)</script>", html,
                          re.DOTALL | re.IGNORECASE):
        attrs, body = m.group(1), m.group(2)
        if "src=" in attrs.lower():          # external script, no inline body
            continue
        if not body.strip():                 # empty block
            continue
        is_module = bool(re.search(r'type\s*=\s*["\']module["\']', attrs,
                                   re.IGNORECASE))
        scripts.append((is_module, body))
    return scripts


def check_js_syntax(html):
    """True + [] if every inline script passes node --check, else False + errs."""
    failures = []
    scripts = extract_scripts(html)
    for i, (is_module, body) in enumerate(scripts):
        suffix = ".mjs" if is_module else ".js"
        with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False) as f:
            f.write(body)
            tmp = f.name
        try:
            r = subprocess.run(["node", "--check", tmp],
                               capture_output=True, text=True)
            if r.returncode != 0:
                mode = "module" if is_module else "script"
                msg = (r.stderr.strip().splitlines() or ["unknown"])[-1]
                failures.append(f"js syntax (block {i}, {mode} mode): {msg}")
        finally:
            os.unlink(tmp)
    return (len(failures) == 0), failures


def check_structure(html):
    failures = []
    for tag in REQUIRED_STRUCTURE:
        if tag.lower() not in html.lower():
            failures.append(f"missing structural tag: {tag}")
    # Count opens vs closers. The build*Html functions emit whole HTML
    # documents (with their own <script>) inside JS template strings, where
    # the closer is escaped as <\/script> so it doesn't end the real block.
    # Count both literal and escaped closers so generated content balances;
    # an orphaned/dropped tag still trips this.
    n_script_open = len(re.findall(r"<script\b", html, re.IGNORECASE))
    n_script_close = len(re.findall(r"<\\?/script>", html, re.IGNORECASE))
    if n_script_open != n_script_close:
        failures.append(
            f"unbalanced script tags: {n_script_open} open / {n_script_close} close")
    n_style_open = len(re.findall(r"<style\b", html, re.IGNORECASE))
    n_style_close = len(re.findall(r"<\\?/style>", html, re.IGNORECASE))
    if n_style_open != n_style_close:
        failures.append(
            f"unbalanced style tags: {n_style_open} open / {n_style_close} close")
    return (len(failures) == 0), failures


def check_fingerprint(html):
    missing = [t for t in REQUIRED_TOKENS if t not in html]
    return (len(missing) == 0), [f"fingerprint missing: {t}" for t in missing]


def score(path):
    if not os.path.exists(path):
        return {"valid": False, "score": None, "bytes": None,
                "gate_failures": [f"file not found: {path}"]}
    with open(path, "rb") as f:
        raw = f.read()
    n_bytes = len(raw)
    html = raw.decode("utf-8", errors="replace")

    failures = []
    for ok, errs in (check_structure(html),
                     check_fingerprint(html),
                     check_js_syntax(html)):
        if not ok:
            failures.extend(errs)

    valid = len(failures) == 0
    return {
        "valid": valid,
        "score": (n_bytes if valid else None),
        "bytes": n_bytes,
        "gate_failures": failures,
    }


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else ASSET
    result = score(target)
    print(json.dumps(result))
    sys.exit(0 if result["valid"] else 1)
