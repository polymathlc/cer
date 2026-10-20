// After a deploy of the polymath-shop codebase: prove the LIVE card-payment
// endpoints answer the pages that serve /products, refuse a page that does not,
// and that the Stripe webhook refuses an unsigned call.
//
// It never creates a checkout (that would open a real Stripe session) and never
// sends a signed event: only CORS preflights, and one unsigned POST the webhook
// must turn away.
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { ORIGINS } = require('../shop-function/functions/service.js');

export const BASE = 'https://us-central1-mathgen--app.cloudfunctions.net/';
export const CHECKOUT_ENDPOINT = BASE + 'createShopCheckout';
export const STATUS_ENDPOINT = BASE + 'shopCheckoutStatus';
export const WEBHOOK_ENDPOINT = BASE + 'stripeShopWebhook';
export const RECEIPT_ENDPOINT = BASE + 'sendShopReceipt';
export const REFUSED_PROBE = 'https://shop-smoke.invalid';
export const SMOKE_ATTEMPTS = 6;
export const SMOKE_WAIT_MS = 10000;

async function preflight(endpoint, origin, fetchImpl) {
  const response = await fetchImpl(endpoint, { method: 'OPTIONS', redirect: 'manual',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  return { status: response.status, allowOrigin: response.headers.get('access-control-allow-origin') || '',
    allowHeaders: (response.headers.get('access-control-allow-headers') || '').toLowerCase() };
}

export async function smokeProblems({ webhookExpected = true, fetchImpl = globalThis.fetch } = {}) {
  const problems = [];
  for (const endpoint of [CHECKOUT_ENDPOINT, STATUS_ENDPOINT, RECEIPT_ENDPOINT]) {
    const name = endpoint.slice(BASE.length);
    for (const origin of ORIGINS) {
      try {
        const seen = await preflight(endpoint, origin, fetchImpl);
        if (seen.status !== 204) problems.push(`${name} from ${origin}: expected 204 to the preflight, got ${seen.status}.`);
        if (seen.allowOrigin !== origin) problems.push(`${name} from ${origin}: no matching Access-Control-Allow-Origin, so the page could not reach it.`);
        else if (endpoint === RECEIPT_ENDPOINT && !seen.allowHeaders.includes('authorization'))
          problems.push(`${name} from ${origin}: the admin's sign-in header is not allowed, so receipts could not be sent.`);
      } catch (error) { problems.push(`${name} from ${origin}: the preflight did not complete (${error?.message || error}).`); }
    }
    try {
      const refused = await preflight(endpoint, REFUSED_PROBE, fetchImpl);
      if (refused.status !== 403 || refused.allowOrigin) problems.push(`${name}: an unlisted origin was not refused (got ${refused.status}).`);
    } catch (error) { problems.push(`${name}: the unlisted-origin preflight did not complete (${error?.message || error}).`); }
  }
  try {
    const response = await fetchImpl(WEBHOOK_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"smoke"}' });
    const want = webhookExpected ? 400 : 503;
    if (response.status !== want) problems.push(`stripeShopWebhook: an unsigned call got ${response.status}; expected ${want}.`);
  } catch (error) { problems.push(`stripeShopWebhook: the call did not complete (${error?.message || error}).`); }
  return problems;
}

export async function smokeCheck({ attempts = SMOKE_ATTEMPTS, waitMs = SMOKE_WAIT_MS,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log, ...options } = {}) {
  let problems = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    problems = await smokeProblems(options);
    if (!problems.length) return { ok: true, attempt, problems };
    if (attempt < attempts) {
      log(`Attempt ${attempt} of ${attempts}: ${problems.length} problem(s); checking again in ${Math.round(waitMs / 1000)}s.`);
      await sleep(waitMs);
    }
  }
  return { ok: false, attempt: attempts, problems };
}

export function summaryText(result) {
  if (result.ok) return '### ✅ Card payments for /products are live\n\nThe checkout, status and receipt endpoints answer '
    + ORIGINS.map(origin => '`' + origin + '`').join(', ') + ', refuse an unlisted origin, and the webhook turns away unsigned calls. '
    + 'No checkout was created.\n\nStripe webhook URL: `' + WEBHOOK_ENDPOINT + '`\n';
  return '### ❌ The live card-payment service did not answer as expected\n\n' + result.problems.map(problem => '- ' + problem).join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await smokeCheck({ webhookExpected: process.env.SHOP_WEBHOOK_CONFIGURED !== 'false' });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryText(result));
  if (result.ok) console.log('The live card-payment endpoints answer as expected.');
  else {
    for (const problem of result.problems) console.log('::error::' + problem);
    process.exit(1);
  }
}
