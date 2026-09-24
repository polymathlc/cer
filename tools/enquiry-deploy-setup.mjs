// Prepares a GitHub Actions runner to deploy the polymath-enquiry codebase, from the
// two repository secrets and nothing else. Used by .github/workflows/deploy-enquiry.yml.
//
//   FIREBASE_SERVICE_ACCOUNT     the JSON key of a service account allowed to deploy
//                                Cloud Functions to mathgen--app (raw JSON, or base64)
//   POLYMATH_ENQUIRY_RECIPIENTS  the centre's two inboxes, comma-separated
//
// It writes the key to a private file under RUNNER_TEMP (pointed at by
// GOOGLE_APPLICATION_CREDENTIALS, which the Firebase CLI reads), and writes the
// recipients to enquiry-function/functions/.env.mathgen--app, the ignored file the
// Firebase CLI turns into the function's environment at deploy time. The recipients
// are checked with the service's OWN recipientConfiguration, so a value the function
// would refuse to start with is refused here, before anything is deployed.
//
// NOTHING here ever prints a secret value, or part of one: the logs of a public
// repository are public. A failure says which secret is wrong and how to fix it.
import { appendFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { recipientConfiguration } = require('../enquiry-function/functions/service.js');

export const PROJECT = 'mathgen--app';
export const ENV_FILE = `enquiry-function/functions/.env.${PROJECT}`;
const SECRETS_PAGE = 'Settings → Secrets and variables → Actions → New repository secret';

export class SetupError extends Error {}

// A key pasted with a stray newline or saved as base64 is still the same key.
export function readServiceAccount(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new SetupError(`The FIREBASE_SERVICE_ACCOUNT secret is missing. Add the JSON key of a service account that can deploy Cloud Functions to ${PROJECT} (${SECRETS_PAGE}).`);
  let key = null;
  for (const text of [raw, Buffer.from(raw, 'base64').toString('utf8')]) {
    try { key = JSON.parse(text); break; } catch { /* try the next reading */ }
  }
  if (!key || typeof key !== 'object' || Array.isArray(key))
    throw new SetupError('The FIREBASE_SERVICE_ACCOUNT secret is not a JSON key. Paste the whole downloaded .json file, from the first { to the last }.');
  if (key.type !== 'service_account' || typeof key.client_email !== 'string' || typeof key.private_key !== 'string'
      || !key.private_key.includes('PRIVATE KEY'))
    throw new SetupError('The FIREBASE_SERVICE_ACCOUNT secret is JSON but not a service-account key. Create one under IAM & Admin → Service Accounts → Keys → Add key → JSON.');
  return key;
}

export function readRecipients(value) {
  if (typeof value !== 'string' || !value.trim())
    throw new SetupError(`The POLYMATH_ENQUIRY_RECIPIENTS secret is missing. Add the centre's two inboxes, comma-separated (${SECRETS_PAGE}).`);
  try { return recipientConfiguration(value); }
  catch { throw new SetupError('The POLYMATH_ENQUIRY_RECIPIENTS secret must be exactly two different email addresses separated by a comma, like first@example.com,second@example.com.'); }
}

// The Firebase CLI's .env parser ends an unquoted value at "#", which an email
// address may contain, so the value is written double-quoted. recipientConfiguration
// has already refused quotes, backslashes and control characters, so there is
// nothing inside the quotes that the parser could read as an escape.
export function envFileText(recipients) {
  return `POLYMATH_ENQUIRY_RECIPIENTS="${recipients.join(',')}"\n`;
}

export function prepare({ env = process.env, root = process.cwd(), write = writeFileSync, append = appendFileSync } = {}) {
  const key = readServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const recipients = readRecipients(env.POLYMATH_ENQUIRY_RECIPIENTS);
  if (!env.RUNNER_TEMP || !env.GITHUB_ENV)
    throw new SetupError('This only runs inside GitHub Actions (RUNNER_TEMP and GITHUB_ENV are not set).');
  const keyFile = join(env.RUNNER_TEMP, 'firebase-sa.json');
  write(keyFile, JSON.stringify(key), { mode: 0o600 });
  write(resolve(root, ENV_FILE), envFileText(recipients), { mode: 0o600 });
  append(env.GITHUB_ENV, `GOOGLE_APPLICATION_CREDENTIALS=${keyFile}\n`);
  return { keyFile, envFile: ENV_FILE, sameProject: key.project_id === PROJECT };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const result = prepare({ root });
    if (!result.sameProject)
      console.log(`::warning::The service-account key belongs to another Google Cloud project. That works only if it has been granted deploy access to ${PROJECT}.`);
    console.log('Credentials and the two recipients are ready (values not shown).');
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    console.log('::error::' + error.message);
    process.exit(1);
  }
}
