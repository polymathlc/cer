// Prepares a GitHub Actions runner to deploy the polymath-shop codebase (card
// payments for /products), from repository secrets and nothing else. Used by
// .github/workflows/deploy-shop.yml.
//
//   FIREBASE_SERVICE_ACCOUNT  the same deploy key the enquiry service uses
//   STRIPE_SECRET_KEY         the secret API key (sk_live_… or sk_test_…, or a
//                             restricted rk_… key allowed to write Checkout
//                             Sessions) of the Polymath Stripe account
//   STRIPE_WEBHOOK_SECRET     the signing secret (whsec_…) of the webhook endpoint
//                             added in the Stripe dashboard; optional, see below
//
// The keys go into shop-function/functions/.env.mathgen--app, the ignored file the
// Firebase CLI turns into the functions' environment at deploy time.
//
// Missing FIREBASE_SERVICE_ACCOUNT or STRIPE_SECRET_KEY is not a failure: card
// payments simply have not been switched on yet, so the job says what to add and
// skips the deploy (ready=false), and the page keeps offering PayNow only. A
// missing webhook secret still deploys: payments are then recorded when the parent
// returns from Stripe, but not if they close the tab first, so the summary warns.
//
// NOTHING here ever prints a secret value, or part of one.
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readServiceAccount, SetupError, PROJECT } from './enquiry-deploy-setup.mjs';

export { PROJECT };
export const ENV_FILE = `shop-function/functions/.env.${PROJECT}`;
// The Polymath Stripe account, as given by the centre. A key from any other account
// would take the parents' money somewhere else, so it is refused.
export const STRIPE_ACCOUNT = 'acct_1USg162dM5Vps1NT';
const SECRETS_PAGE = 'Settings → Secrets and variables → Actions → New repository secret';

export function readStripeKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) return null;
  if (/^pk_/.test(key))
    throw new SetupError('The STRIPE_SECRET_KEY secret holds a publishable key (pk_…). Use the SECRET key from Stripe → Developers → API keys (it starts with sk_live_).');
  if (/^whsec_/.test(key))
    throw new SetupError('The STRIPE_SECRET_KEY secret holds a webhook signing secret (whsec_…). That belongs in STRIPE_WEBHOOK_SECRET; STRIPE_SECRET_KEY takes the sk_live_… key.');
  if (!/^(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,250}$/.test(key))
    throw new SetupError('The STRIPE_SECRET_KEY secret is not a Stripe secret key. Copy it again from Stripe → Developers → API keys; it starts with sk_live_.');
  return key;
}

export function readWebhookSecret(value) {
  const secret = typeof value === 'string' ? value.trim() : '';
  if (!secret) return null;
  if (!/^whsec_[A-Za-z0-9+/=]{10,250}$/.test(secret))
    throw new SetupError('The STRIPE_WEBHOOK_SECRET secret is not a webhook signing secret. In Stripe → Developers → Webhooks, open the endpoint and reveal its Signing secret (it starts with whsec_).');
  return secret;
}

export const keyMode = key => (/_live_/.test(key) ? 'live' : 'test');

// Asks Stripe which account the key belongs to. A restricted key may not be allowed
// to read the account; that is reported as "unknown", never as a failure.
export async function keyAccount(key, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl('https://api.stripe.com/v1/account', { headers: { Authorization: 'Bearer ' + key } });
    if (response.status === 401) return { valid: false };
    if (!response.ok) return { valid: true, account: null };
    const body = await response.json();
    return { valid: true, account: body && typeof body.id === 'string' ? body.id : null };
  } catch {
    return { valid: true, account: null, unreachable: true };
  }
}

// Both values are [A-Za-z0-9_+/=] only (checked above), so quoting cannot be broken.
export function envFileText({ secretKey, webhookSecret }) {
  return `STRIPE_SECRET_KEY="${secretKey}"\n` + (webhookSecret ? `STRIPE_WEBHOOK_SECRET="${webhookSecret}"\n` : '');
}

export async function prepare({ env = process.env, root = process.cwd(), write = writeFileSync, append = appendFileSync,
  fetchImpl = globalThis.fetch } = {}) {
  if (!env.RUNNER_TEMP || !env.GITHUB_ENV || !env.GITHUB_OUTPUT)
    throw new SetupError('This only runs inside GitHub Actions (RUNNER_TEMP, GITHUB_ENV and GITHUB_OUTPUT are not set).');
  const secretKey = readStripeKey(env.STRIPE_SECRET_KEY);
  const webhookSecret = readWebhookSecret(env.STRIPE_WEBHOOK_SECRET);
  const notes = [];
  if (!secretKey || !String(env.FIREBASE_SERVICE_ACCOUNT || '').trim()) {
    const missing = [!String(env.FIREBASE_SERVICE_ACCOUNT || '').trim() && 'FIREBASE_SERVICE_ACCOUNT', !secretKey && 'STRIPE_SECRET_KEY'].filter(Boolean);
    append(env.GITHUB_OUTPUT, 'ready=false\n');
    return { ready: false, missing, notes: [`Card payments are not switched on yet: add the ${missing.join(' and ')} secret${missing.length > 1 ? 's' : ''} (${SECRETS_PAGE}), then run this workflow again.`] };
  }
  const key = readServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const owner = await keyAccount(secretKey, fetchImpl);
  if (!owner.valid) throw new SetupError('Stripe refused the STRIPE_SECRET_KEY secret (401). It may have been rolled; copy the current secret key from Stripe → Developers → API keys.');
  if (owner.account && owner.account !== STRIPE_ACCOUNT)
    throw new SetupError(`The STRIPE_SECRET_KEY secret belongs to a different Stripe account, not the Polymath one (${STRIPE_ACCOUNT}). Sign in to the right account and copy its secret key.`);
  if (!owner.account) notes.push(`Could not confirm the key belongs to ${STRIPE_ACCOUNT}${owner.unreachable ? ' (Stripe was unreachable)' : ' (the key may not read the account)'}.`);
  if (keyMode(secretKey) === 'test') notes.push('STRIPE_SECRET_KEY is a TEST key: parents cannot really pay until it is replaced with the sk_live_ key.');
  if (!webhookSecret) notes.push('STRIPE_WEBHOOK_SECRET is not set: a payment is recorded when the parent returns from Stripe, but not if they close the tab first. Add the webhook in Stripe and this secret to close that gap.');
  const keyFile = resolve(env.RUNNER_TEMP, 'firebase-sa.json');
  write(keyFile, JSON.stringify(key), { mode: 0o600 });
  write(resolve(root, ENV_FILE), envFileText({ secretKey, webhookSecret }), { mode: 0o600 });
  append(env.GITHUB_ENV, `GOOGLE_APPLICATION_CREDENTIALS=${keyFile}\n`);
  append(env.GITHUB_OUTPUT, 'ready=true\n' + `webhook=${webhookSecret ? 'true' : 'false'}\n`);
  return { ready: true, keyFile, envFile: ENV_FILE, sameProject: key.project_id === PROJECT, mode: keyMode(secretKey), webhook: !!webhookSecret, notes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const result = await prepare({ root });
    for (const note of result.notes) console.log('::warning::' + note);
    if (process.env.GITHUB_STEP_SUMMARY && result.notes.length)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.notes.map(note => '- ' + note).join('\n') + '\n');
    if (result.ready) {
      if (!result.sameProject)
        console.log(`::warning::The service-account key belongs to another Google Cloud project. That works only if it has been granted deploy access to ${PROJECT}.`);
      console.log(`Credentials and the Stripe ${result.mode} key are ready (values not shown).`);
    } else {
      console.log('Nothing deployed: card payments are not switched on yet.');
    }
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    console.log('::error::' + error.message);
    process.exit(1);
  }
}
