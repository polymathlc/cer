# CER Science Learning Portal

## OpenAI Decisions migration

The import review now calls `https://api.openai.com/v1/decisions` with `gpt-6-luna` and the shared server-side `OPENAI_API_KEY`. No Jev account or key is needed. Existing function names, saved fields and rate-limit collections retain their legacy names for compatibility. Import review remains advisory and visual AI checking still runs.

Deploy `functions:cer-rapid-import` to activate the backend change. Merging static pages alone does not switch a previously deployed function. Automated tests mock provider calls; live API access and latency are not established by those tests.

