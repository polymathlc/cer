# Ai-nstein admin assistant and Rapid Add duplicates — v1.399.0

Administrators see a small animated voice button beside Ai-nstein. Open it and
choose **Start talking** to grant microphone access. Try “Open Rapid Add”,
“Find P6 questions about forces”, “Prepare a worksheet from these results”,
“Show question two”, or “Save this worksheet”. These actions also work in the
administrator's Ai-nstein text chat. Drafts open separately so existing editing
work is preserved. Saving requires a request to save.

The assistant reads the current visible page and ordinary visible input values,
and uses the app's existing teaching notes for academic answers. It shows
**Thinking…** while its helpers work and speaks only the result. Bank searches
use actual records, two bounded specialist queries and a relevance review.
Unverified fallback matches are labelled as keyword candidates. Each app task
has a four-call budget and a 45-second deadline.

Voice is hidden for students, employees, signed-out users and practice-as
sessions. The server independently verifies administrator identity and App
Check. A session lasts at most ten minutes; leaving the tab, ending it, losing
the microphone, switching accounts or two minutes without activity closes it.
Server limits and deployment instructions are in [live-assistant/README.md](live-assistant/README.md).

In **Rapid Add → Delete duplicate questions**, choose a minimum similarity
from 50% to 100% (default 90%). Scan all vetting questions or just the current
Rapid Add session. Review the proposed extra copies beside the questions kept,
then confirm **Delete**. The published bank supplies originals for comparison
and is never deleted by this tool. One keeper always remains; questions with
different numbers, answers, options, important polarity words or diagram
references are kept for manual review regardless of percentage. Similarity is
conservative text overlap, not an AI certainty score. Short or unsupported
question structures are also kept for manual review.

Deletion re-reads both records in a transaction, so changed, approved, removed,
or no-longer-matching questions are skipped. Saved worksheets are not rewritten.
The percentage and scope can be changed before previewing again.

## Verification

The new workflow checks the action engine, Live transport, backend identity and
quotas, duplicate matching and transaction guards, and teaching-note grounding.
Browser fixtures exercise desktop/mobile controls, permission failures, account
changes, interruption, delayed connections and bulk-delete previews without
paid AI requests or real question deletion. A real microphone conversation
still requires a signed-in administrator on the deployed app.
