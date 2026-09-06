#!/usr/bin/env bash
# Run from Google Cloud Shell. All cloud operations target this existing project.
set -Eeuo pipefail
trap 'echo "Rapid Add setup stopped at line $LINENO. Deployment is not verified; resolve the error above and run this command again." >&2' ERR

readonly RAPID_PROJECT='mathgen--app'
readonly RAPID_REGION='us-central1'
readonly RAPID_FIREBASE_VERSION='15.29.0'
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

rapid_runtime=''
rapid_probe=''
rapid_cleanup() {
  if [[ -n "$rapid_probe" ]]; then rm -f -- "$rapid_probe"; fi
  if [[ -n "$rapid_runtime" ]]; then rm -rf -- "$rapid_runtime"; fi
}
trap rapid_cleanup EXIT

fail() { echo "$*" >&2; exit 1; }
for rapid_command in gcloud npm node python3 curl; do
  command -v "$rapid_command" >/dev/null || fail "Missing $rapid_command. Run this script in Google Cloud Shell."
done

echo "Checking Google access to $RAPID_PROJECT..."
rapid_account=$(gcloud auth list --filter=status:ACTIVE --format='value(account)')
if [[ -z "$rapid_account" ]]; then
  fail 'Sign in within Cloud Shell: gcloud auth login --update-adc, then run this script again. Do not send credentials to chat.'
fi
gcloud projects describe "$RAPID_PROJECT" --format='value(projectId)' >/dev/null
rapid_billing=$(gcloud billing projects describe "$RAPID_PROJECT" --format='value(billingEnabled)')
[[ "${rapid_billing,,}" == true ]] || fail 'Billing must already be enabled for mathgen--app. No billing account has been changed.'
for rapid_secret in GEMINI_API_KEY OPENAI_API_KEY; do
  # Metadata only: never download or print either API key.
  rapid_state=$(gcloud secrets versions describe latest --secret="$rapid_secret" --project="$RAPID_PROJECT" --format='value(state)')
  [[ "$rapid_state" == ENABLED ]] || fail "$rapid_secret needs an enabled latest version in Secret Manager."
done

# Select Node in this process. Re-executing through npm can preserve an older
# Node in Cloud Shell and restart setup indefinitely without reaching deployment.
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != 22 ]]; then
  echo 'Preparing a temporary Node 22 runtime...'
  rapid_runtime=$(mktemp -d)
  npm install --prefix "$rapid_runtime" --no-save --package-lock=false --no-audit --no-fund node@22
  rapid_node_dir="$rapid_runtime/node_modules/node/bin"
  [[ -x "$rapid_node_dir/node" ]] || fail 'Node 22 installation did not provide an executable. Resolve the installation error and rerun setup.'
  export PATH="$rapid_node_dir:$PATH"
  hash -r
  [[ "$(node -p 'process.versions.node.split(".")[0]')" == 22 ]] || fail 'Could not activate Node 22. Setup stopped without restarting; check your Node installation before retrying.'
fi
rapid_firebase() { npx --yes "firebase-tools@$RAPID_FIREBASE_VERSION" "$@"; }
if ! rapid_firebase functions:list --project "$RAPID_PROJECT" --json >/dev/null; then
  fail "Firebase access failed. If the error requests login, run: npx --yes firebase-tools@$RAPID_FIREBASE_VERSION login --no-localhost, then rerun setup."
fi

echo 'Installing and checking the Rapid Add worker...'
npm ci --prefix functions
npm test --prefix functions

echo 'Deploying the isolated cer-rapid-import codebase...'
gcloud services enable cloudtasks.googleapis.com --project="$RAPID_PROJECT"
rapid_firebase deploy --project "$RAPID_PROJECT" --config "$PWD/firebase.json" --only functions:cer-rapid-import --non-interactive

rapid_functions=(rapidImportStatus rapidImportBegin rapidImportChunk rapidImportFinish rapidImportRetry rapidImportDispatch rapidImportPage)
for rapid_function in "${rapid_functions[@]}"; do
  rapid_state=$(gcloud functions describe "$rapid_function" --gen2 --region="$RAPID_REGION" --project="$RAPID_PROJECT" --format='value(state)')
  [[ "$rapid_state" == ACTIVE ]] || fail "$rapid_function is not ACTIVE ($rapid_state)."
done

# Discover the actual enqueuing identity; never guess an App Engine/default account.
rapid_dispatcher=$(gcloud functions describe rapidImportDispatch --gen2 --region="$RAPID_REGION" --project="$RAPID_PROJECT" --format='value(serviceConfig.serviceAccountEmail)')
[[ "$rapid_dispatcher" == *@*.gserviceaccount.com ]] || fail 'Cannot determine the dispatcher service account.'
rapid_service=$(gcloud functions describe rapidImportPage --gen2 --region="$RAPID_REGION" --project="$RAPID_PROJECT" --format='value(serviceConfig.service)')
[[ "$rapid_service" == projects/"$RAPID_PROJECT"/locations/"$RAPID_REGION"/services/* ]] || fail 'Unexpected worker service; no IAM changes made.'
rapid_service=${rapid_service##*/}

# These bindings affect only this queue, its caller identity and its worker.
# Existing Firestore/Storage access and secret bindings remain managed by the project/Firebase.
gcloud tasks queues add-iam-policy-binding rapidImportPage --location="$RAPID_REGION" --project="$RAPID_PROJECT" --member="serviceAccount:$rapid_dispatcher" --role=roles/cloudtasks.enqueuer --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$rapid_dispatcher" --project="$RAPID_PROJECT" --member="serviceAccount:$rapid_dispatcher" --role=roles/iam.serviceAccountUser --quiet >/dev/null
gcloud run services add-iam-policy-binding "$rapid_service" --region="$RAPID_REGION" --project="$RAPID_PROJECT" --member="serviceAccount:$rapid_dispatcher" --role=roles/run.invoker --quiet >/dev/null

rapid_queue_state=$(gcloud tasks queues describe rapidImportPage --location="$RAPID_REGION" --project="$RAPID_PROJECT" --format='value(state)')
[[ "$rapid_queue_state" == RUNNING ]] || fail "The Rapid Add queue is $rapid_queue_state. Check why it was paused before resuming it."

# Read-only check of the deployed callable's authentication gate. No PDFs/jobs created.
rapid_probe=$(mktemp)
rapid_http=$(curl --silent --show-error --max-time 60 --output "$rapid_probe" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data '{"data":{}}' \
  "https://$RAPID_REGION-$RAPID_PROJECT.cloudfunctions.net/rapidImportStatus")
[[ "$rapid_http" == 401 ]] || fail "The status endpoint returned HTTP $rapid_http; expected the admin sign-in requirement (401)."
python3 - "$rapid_probe" <<'PY'
import json, sys
with open(sys.argv[1]) as response:
    status = json.load(response).get('error', {}).get('status')
if status != 'UNAUTHENTICATED':
    raise SystemExit('Status endpoint did not return the expected Firebase authentication response.')
PY

echo 'Deployment checks passed: seven active functions, running queue, scoped task permissions and an authenticated status endpoint.'
echo 'Now sign in to https://polymathlc.github.io/cer/ and perform the two-PDF acceptance check in rapid-import/README.md.'
echo 'Background PDF processing is not end-to-end verified until that check passes.'
