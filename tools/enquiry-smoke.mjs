// After a deploy of the polymath-enquiry codebase: prove the LIVE endpoint answers
// every page that serves enquiry.html, and still refuses a page that does not.
//
// It only ever sends CORS preflights (OPTIONS). A POST would queue a real enquiry
// email to the centre's two inboxes, so this file never makes one; the harness
// in tools/enquiry-deploy-tests.mjs fails if it ever does.
//
// Why a preflight is the right probe: the form broke on polymathlc.com.sg because
// the server refused that origin's preflight with a 403 and no CORS headers. The
// browser hides that from the page, so the form only ever saw a failed fetch().
// A preflight from each origin is exactly the request that failed.
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ENQUIRY_ENDPOINT } from '../enquiry-core.mjs';

const require = createRequire(import.meta.url);
// The origin list is read from the service itself, never written out again here,
// so the check cannot drift from what was deployed.
const { ORIGINS } = require('../enquiry-function/functions/service.js');

// A syntactically valid origin that no page will ever be served from (.invalid is
// reserved, RFC 2606). The live service must refuse it without CORS headers.
export const REFUSED_PROBE = 'https://enquiry-smoke.invalid';
export const SMOKE_ATTEMPTS = 6;
export const SMOKE_WAIT_MS = 10000;

export async function preflight(endpoint, origin, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(endpoint, {
    method: 'OPTIONS',
    redirect: 'manual',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
  });
  const header = name => response.headers.get(name) || '';
  return {
    status: response.status,
    allowOrigin: header('access-control-allow-origin'),
    allowMethods: header('access-control-allow-methods'),
    allowHeaders: header('access-control-allow-headers')
  };
}

// Everything wrong with one round of preflights, in words a person can act on.
// An empty list means the live service answers exactly as the source says it should.
export async function smokeProblems({ endpoint = ENQUIRY_ENDPOINT, origins = ORIGINS, fetchImpl = globalThis.fetch } = {}) {
  const problems = [];
  for (const origin of origins) {
    let seen;
    try { seen = await preflight(endpoint, origin, fetchImpl); }
    catch (error) { problems.push(`${origin}: the preflight did not complete (${error?.message || error}).`); continue; }
    if (seen.status !== 204) problems.push(`${origin}: expected 204 to the preflight, got ${seen.status}.`);
    if (seen.allowOrigin !== origin)
      problems.push(`${origin}: Access-Control-Allow-Origin was "${seen.allowOrigin || '(none)'}", so a browser on this page would block the form.`);
    if (!/\bPOST\b/i.test(seen.allowMethods)) problems.push(`${origin}: POST is not in Access-Control-Allow-Methods.`);
    if (!/\bcontent-type\b/i.test(seen.allowHeaders)) problems.push(`${origin}: Content-Type is not in Access-Control-Allow-Headers.`);
  }
  try {
    const refused = await preflight(endpoint, REFUSED_PROBE, fetchImpl);
    if (refused.status !== 403) problems.push(`An unlisted origin was answered ${refused.status}; it must be refused with 403.`);
    if (refused.allowOrigin) problems.push(`An unlisted origin was given Access-Control-Allow-Origin "${refused.allowOrigin}".`);
  } catch (error) {
    problems.push(`The unlisted-origin preflight did not complete (${error?.message || error}).`);
  }
  return problems;
}

// A new revision can take a few seconds to start taking traffic after the deploy
// command returns, so a failing round is retried before it is believed.
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

// What the job summary says, so the answer to "is the form working?" is on the run's
// own page rather than in the middle of a log.
export function summaryText(result, origins = ORIGINS) {
  if (result.ok) return `### ✅ The enquiry form's server is live\n\nIt accepts ${origins.map(origin => '`' + origin + '`').join(', ')} `
    + 'and refuses an unlisted origin. No email was sent: this check only sends CORS preflights.\n';
  return '### ❌ The live enquiry service did not answer as expected\n\n' + result.problems.map(problem => '- ' + problem).join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await smokeCheck();
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryText(result));
  if (result.ok) {
    console.log(`The live enquiry service accepts ${ORIGINS.join(', ')} and refuses an unlisted origin.`);
  } else {
    for (const problem of result.problems) console.log('::error::' + problem);
    process.exit(1);
  }
}
