// Checks tools/shop-deploy-setup.mjs and tools/shop-smoke.mjs without a network:
//   node tools/shop-deploy-tests.mjs
import assert from 'node:assert/strict';
import { readStripeKey, readWebhookSecret, envFileText, prepare, STRIPE_ACCOUNT, ENV_FILE } from './shop-deploy-setup.mjs';
import { smokeProblems, CHECKOUT_ENDPOINT, STATUS_ENDPOINT, WEBHOOK_ENDPOINT, RECEIPT_ENDPOINT, REFUSED_PROBE } from './shop-smoke.mjs';
import { SetupError } from './enquiry-deploy-setup.mjs';

const LIVE = 'sk_live_' + 'A1b2C3d4E5'.repeat(4);
const HOOK = 'whsec_' + 'Z9y8X7w6V5'.repeat(3);
const SA = JSON.stringify({ type: 'service_account', project_id: 'mathgen--app', client_email: 'deploy@mathgen--app.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' });
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('ok - ' + name); }

await check('Stripe keys are recognised and mix-ups are named', () => {
  assert.equal(readStripeKey('  ' + LIVE + '\n'), LIVE);
  assert.equal(readStripeKey(''), null);
  assert.throws(() => readStripeKey('pk_live_abcdefghijkl'), /publishable/);
  assert.throws(() => readStripeKey(HOOK), /STRIPE_WEBHOOK_SECRET/);
  assert.throws(() => readStripeKey('sk_live_abc"def'), SetupError);
  assert.equal(readWebhookSecret(HOOK), HOOK);
  assert.equal(readWebhookSecret(undefined), null);
  assert.throws(() => readWebhookSecret(LIVE), /whsec_/);
  assert.equal(envFileText({ secretKey: LIVE, webhookSecret: HOOK }), `STRIPE_SECRET_KEY="${LIVE}"\nSTRIPE_WEBHOOK_SECRET="${HOOK}"\n`);
});

function runner(extra) {
  const files = new Map(), appended = new Map();
  const env = { RUNNER_TEMP: '/tmp/runner', GITHUB_ENV: '/tmp/env', GITHUB_OUTPUT: '/tmp/out', FIREBASE_SERVICE_ACCOUNT: SA, ...extra };
  return { files, appended, options: { env, root: '/repo', write: (path, text) => files.set(path, text),
    append: (path, text) => appended.set(path, (appended.get(path) || '') + text) } };
}
const account = id => async () => ({ ok: true, status: 200, json: async () => ({ id }) });

await check('with no Stripe key nothing is written and the deploy is skipped', async () => {
  const r = runner({});
  const result = await prepare({ ...r.options, fetchImpl: account(STRIPE_ACCOUNT) });
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['STRIPE_SECRET_KEY']);
  assert.equal(r.files.size, 0);
  assert.equal(r.appended.get('/tmp/out'), 'ready=false\n');
});

await check('a key from the Polymath account is written for the deploy', async () => {
  const r = runner({ STRIPE_SECRET_KEY: LIVE, STRIPE_WEBHOOK_SECRET: HOOK });
  const result = await prepare({ ...r.options, fetchImpl: account(STRIPE_ACCOUNT) });
  assert.equal(result.ready, true);
  assert.equal(result.mode, 'live');
  assert.deepEqual(result.notes, []);
  assert.equal(r.files.get('/repo/' + ENV_FILE), envFileText({ secretKey: LIVE, webhookSecret: HOOK }));
  assert.match(r.appended.get('/tmp/out'), /ready=true\nwebhook=true/);
  for (const [, text] of r.appended) assert.ok(!text.includes(LIVE) && !text.includes(HOOK), 'no secret leaves the env file');
});

await check('a key from another Stripe account, or a rolled key, is refused', async () => {
  await assert.rejects(prepare({ ...runner({ STRIPE_SECRET_KEY: LIVE }).options, fetchImpl: account('acct_someoneelse') }), /different Stripe account/);
  await assert.rejects(prepare({ ...runner({ STRIPE_SECRET_KEY: LIVE }).options, fetchImpl: async () => ({ ok: false, status: 401 }) }), /refused/);
});

await check('a test key or a missing webhook secret deploys with a warning', async () => {
  const r = runner({ STRIPE_SECRET_KEY: LIVE.replace('_live_', '_test_') });
  const result = await prepare({ ...r.options, fetchImpl: account(STRIPE_ACCOUNT) });
  assert.equal(result.ready, true);
  assert.equal(result.notes.length, 2);
  assert.match(r.appended.get('/tmp/out'), /webhook=false/);
});

function liveService({ webhookStatus = 400, breakOrigin = '', noAuthHeader = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init.method]);
    const origin = init.headers.Origin;
    if (url === WEBHOOK_ENDPOINT) { assert.equal(init.method, 'POST'); assert.ok(!init.headers['Stripe-Signature']); return { status: webhookStatus, headers: new Headers() }; }
    assert.equal(init.method, 'OPTIONS', 'the smoke test never posts a checkout');
    if (origin === REFUSED_PROBE || origin === breakOrigin) return { status: 403, headers: new Headers() };
    return { status: 204, headers: new Headers({ 'access-control-allow-origin': origin,
      'access-control-allow-headers': noAuthHeader ? 'Content-Type' : 'Content-Type, Authorization' }) };
  };
  return { calls, fetchImpl };
}

await check('the smoke test passes a healthy service and only sends preflights', async () => {
  const live = liveService();
  assert.deepEqual(await smokeProblems({ fetchImpl: live.fetchImpl }), []);
  assert.ok([CHECKOUT_ENDPOINT, STATUS_ENDPOINT, RECEIPT_ENDPOINT].every(endpoint => live.calls.some(([url]) => url === endpoint)));
  assert.deepEqual(await smokeProblems({ webhookExpected: false, fetchImpl: liveService({ webhookStatus: 503 }).fetchImpl }), []);
});

await check('the smoke test names an origin the service refuses', async () => {
  const problems = await smokeProblems({ fetchImpl: liveService({ breakOrigin: 'https://polymathlc.com.sg' }).fetchImpl });
  assert.ok(problems.length >= 2 && problems.every(problem => problem.includes('polymathlc.com.sg')));
});

await check('the smoke test notices a receipt endpoint that refuses the sign-in header', async () => {
  const problems = await smokeProblems({ fetchImpl: liveService({ noAuthHeader: true }).fetchImpl });
  assert.ok(problems.length === 3 && problems.every(problem => problem.startsWith('sendShopReceipt') && problem.includes('sign-in')));
});

await check('the deploy names every exported function, and only those', async () => {
  const { readFileSync } = await import('node:fs');
  const root = new URL('..', import.meta.url);
  const exported = [...readFileSync(new URL('shop-function/functions/index.js', root), 'utf8').matchAll(/^exports\.(\w+)\s*=/gm)].map(m => m[1]).sort();
  const only = readFileSync(new URL('.github/workflows/deploy-shop.yml', root), 'utf8').match(/--only "([^"]+)"/);
  assert.ok(only, 'the deploy step passes --only with a quoted list');
  const named = only[1].split(',').map(name => name.replace(/^functions:polymath-shop:/, '')).sort();
  assert.deepEqual(named, exported);
});

console.log(`# pass ${passed}`);
