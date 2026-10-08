# CER Science Learning Portal

## OpenAI Decisions migration

Import review calls `https://api.openai.com/v1/decisions` with `gpt-6-luna` and the shared server-side `OPENAI_API_KEY`. The administrator callable is `cerDecisionsReview`, with Decisions review fields and `cerDecisionsLimits` counters. No separate review-provider account or key is needed. Review remains advisory: visual AI checking always runs.

Saved imports and question history are upgraded when read: the shared migration helper converts former review fields to Decisions fields while preserving the recorded review. Old field names appear only in this data conversion; they do not select another provider. Existing Decisions values take precedence.

## Faster traffic-light checks

The browser checks up to six questions at once across the traffic lights, Check Questions and import reads. It loads up to four pictures together and shares simultaneous reads of the same question revision. Completed checks are not cached by image URL, and every attached picture still requires its own explicit visual audit. Existing valid saved verdicts are reused by Check all.

Screenshot imports start the visual read alongside the advisory Decisions review and join both sets of findings before repair. The PDF worker overlaps Decisions with four concurrent Storage reads, preserving attachment order and reusing unchanged originals within its repair recheck. Model choices, visual resolution, full report validation and repair limits are unchanged. The speedup depends on image and provider latency; it does not skip checks.

Deploy `functions:cer-rapid-import` to activate the backend change. Merging static pages alone does not switch a previously deployed function. Automated tests mock provider calls; live API access and latency are not established by those tests.
