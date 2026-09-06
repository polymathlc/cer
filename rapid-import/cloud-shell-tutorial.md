# Activate online Rapid Add

## Sign in to Google

Use the Google account that manages the existing **mathgen--app** Firebase project.
Authorise Cloud Shell if Google asks. An Open in Cloud Shell link for this
repository can start a temporary shell without credentials; if setup reports
no active account, run `gcloud auth login --update-adc` in that shell and follow
Google's sign-in instructions. Credentials stay in Google's shell.

## Run setup

From the cloned `cer` repository, run:

```bash
bash rapid-import/deploy-cloud-shell.sh
```

The script checks access, billing and existing AI secret metadata; selects
Node 22; runs the worker tests; and deploys the `cer-rapid-import` codebase.
It grants the deployed dispatcher permission to enqueue on the Rapid Add queue,
act as its own task identity, and invoke the Rapid Add worker. It checks all
seven functions, the queue and the status endpoint before reporting success.
No API key is printed, and no service-account key is created.

Keep this setup terminal open until the command finishes. If it stops, resolve
the displayed error and rerun the same command. You can send the error text
back to chat, with credentials excluded.

## Verify two PDFs

Open [the Science Learning Portal](https://polymathlc.github.io/cer/) and sign
in as administrator. Reload if it was already open.

1. In Rapid Add, select two small PDFs. Include one question spread over two pages.
2. Wait until **both PDFs are acknowledged as stored online** before closing the portal.
3. Close the portal/browser, wait, then reopen it and inspect online progress.
4. Confirm completion in Vetting, with each continued question grouped together
   and all its source-page links present.

Deployment checks do not prove AI availability or complete import behaviour.
Only rely on closing the portal after the live test passes. Questions still
enter Vetting for your normal approval.
