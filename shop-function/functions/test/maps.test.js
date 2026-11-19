'use strict';
// Mr Chung's Maps library subscription (maps.js), against an in-memory store and a
// fake Stripe. No network, no real charge.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttp, createService } = require('../service');
const { StripeError, signWebhook } = require('../stripe');
const {
  createMapsService, MAPS_SOURCE, MAPS_DEFAULT_PRICE_CENTS, MAPS_LOOKUP_KEY, publicSubscription, teaserOf, subscribeSessionParams, bestSubscription
} = require('../maps');

const ORIGIN = 'https://polymathlc.com.sg';
const RETURN = ORIGIN + '/maps/';
const NOW = Date.UTC(2026, 10, 19, 4, 0, 0);

function mapDoc(over = {}) {
  return Object.assign({
    title: 'Heat and temperature', published: true, publishedAtMs: NOW - 1000, ownerEmail: 'chungzhikai@gmail.com', ownerUid: 'teacher',
    rootId: 'r1',
    nodes: [
      { id: 'r1', type: 'topic', parentId: '', text: 'Heat' },
      { id: 'a', type: 'topic', parentId: 'r1', text: 'Conductors' },
      { id: 'b', type: 'topic', parentId: 'r1', text: 'Insulators' },
      { id: 'n', type: 'note', parentId: 'a', text: 'Note', note: 'Metals conduct heat well.' },
      { id: 'q', type: 'question', parentId: 'b', question: { title: 'Q1', blocks: [] } }
    ],
    links: []
  }, over);
}

function store(seed = {}) {
  const rows = {
    subscribers: new Map(Object.entries(seed.subscribers || {})),
    access: new Map(Object.entries(seed.access || {})),
    maps: new Map(Object.entries(seed.maps || { m1: mapDoc(), m2: mapDoc({ title: 'Student map', ownerEmail: 'kid@example.com' }), m3: mapDoc({ title: 'Draft', published: false }) }))
  };
  return {
    rows,
    async getSubscriber(uid) { return rows.subscribers.has(uid) ? structuredClone(rows.subscribers.get(uid)) : null; },
    async saveSubscriber(uid, data) { rows.subscribers.set(uid, structuredClone(data)); },
    async getStudentAccess(uid) { return rows.access.get(uid) || null; },
    async listPublished() { return [...rows.maps].filter(([, d]) => d.published === true).map(([id, data]) => ({ id, data })); },
    async getMap(id) { return rows.maps.get(id) || null; }
  };
}

function subscription(over = {}) {
  return Object.assign({
    id: 'sub_ABC123456', status: 'active', customer: 'cus_ABC123', cancel_at_period_end: false, created: 1000,
    current_period_end: Math.floor(NOW / 1000) + 86400 * 20, metadata: { source: MAPS_SOURCE, uid: 'outsider1' },
    items: { data: [{ price: { unit_amount: 990, currency: 'sgd' } }] }
  }, over);
}

function stripe({ subs = {}, search = [], prices = [], configured = true } = {}) {
  const calls = [];
  const all = new Map(Object.entries(subs));
  const guard = () => { if (!configured) throw new StripeError(503, 'stripe-not-configured'); };
  return {
    calls, all,
    async createCheckoutSession(params, key) { guard(); calls.push(['checkout', params, key]); return { id: 'cs_test_12345678', url: 'https://checkout.stripe.com/c/pay/cs_test_12345678' }; },
    async retrieveCheckoutSession(id) { guard(); calls.push(['session', id]); return this.sessions && this.sessions[id]; },
    async retrieveSubscription(id) { guard(); calls.push(['sub', id]); if (!all.has(id)) throw new StripeError(502, 'stripe-error', 'invalid_request_error:resource_missing'); return structuredClone(all.get(id)); },
    async updateSubscription(id, params) { guard(); calls.push(['update', id, params]); const s = Object.assign(all.get(id), params); return structuredClone(s); },
    async searchSubscriptions(query) { guard(); calls.push(['search', query]); return { data: search.map(s => structuredClone(s)) }; },
    async listSubscriptions(params) { guard(); calls.push(['list', params]); return { data: [...all.values()].map(s => Object.assign(structuredClone(s), { customer: { id: s.customer, email: 'parent@example.com', name: 'A Parent' } })), has_more: false }; },
    async listPrices(params) { guard(); calls.push(['prices', params]); return { data: prices.filter(p => p.active !== false) }; },
    async createPrice(params, key) { guard(); calls.push(['createPrice', params, key]); const p = { id: 'price_new' + prices.length, active: true, unit_amount: params.unit_amount, currency: params.currency, recurring: params.recurring, product: params.product || 'prod_new' }; prices.forEach(x => { x.lookup = false; }); prices.unshift(p); return p; },
    async updatePrice(id, params) { guard(); calls.push(['updatePrice', id, params]); const p = prices.find(x => x.id === id); if (p) Object.assign(p, params); return p; },
    async createBillingPortalSession(params) { guard(); calls.push(['portal', params]); if (this.noPortal) throw new StripeError(502, 'stripe-error'); return { url: 'https://billing.stripe.com/p/session/x' }; }
  };
}

const TOKENS = {
  'outsider-token-xxxxxxxxxxxxxxxx': { uid: 'outsider1', email: 'parent@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } },
  'student-token-xxxxxxxxxxxxxxxxx': { uid: 'student1', email: 'kid@students.sciencequest.app', email_verified: false, firebase: { sign_in_provider: 'password' } },
  'teacher-token-xxxxxxxxxxxxxxxxx': { uid: 'teacher', email: 'chungzhikai@gmail.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } },
  'guest-token-xxxxxxxxxxxxxxxxxxx': { uid: 'guest1', firebase: { sign_in_provider: 'anonymous' } }
};

function setup({ seed, stripeOptions, now = () => NOW } = {}) {
  const s = store(seed);
  const st = stripe(stripeOptions);
  const reports = [];
  const maps = createMapsService({ store: s, stripe: st, http: createHttp(code => reports.push(code)), now, report: code => reports.push(code),
    verifyIdToken: async token => { if (!TOKENS[token]) throw new Error('bad token'); return TOKENS[token]; } });
  async function call(body, token, origin = ORIGIN) {
    const headers = { origin, 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    const req = { method: 'POST', body, ip: '1.2.3.4', get: name => headers[name.toLowerCase()] };
    const res = { statusCode: 0, json: null, headers: {}, set(k, v) { this.headers[k] = v; return this; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.json = value; return this; }, send() { return this; } };
    // `json` is both the method and, after the call, the answer.
    const answer = {}; res.json = function (value) { answer.body = value; return this; };
    await maps.mapsLibrary(req, res);
    return { status: res.statusCode, body: answer.body };
  }
  return { store: s, stripe: st, maps, call, reports };
}

const OUT = 'outsider-token-xxxxxxxxxxxxxxxx', STUDENT = 'student-token-xxxxxxxxxxxxxxxxx', TEACHER = 'teacher-token-xxxxxxxxxxxxxxxxx', GUEST = 'guest-token-xxxxxxxxxxxxxxxxxxx';

test('the catalogue needs no sign-in and shows only titles and topics of Mr Chung\'s published maps', async () => {
  const { call } = setup();
  const { status, body } = await call({ action: 'catalogue' });
  assert.equal(status, 200);
  assert.deepEqual(body.maps.map(m => m.id), ['m1']);
  assert.deepEqual(body.maps[0].topics, ['Conductors', 'Insulators']);
  assert.equal(body.maps[0].counts.questions, 1);
  assert.ok(!JSON.stringify(body).includes('Metals conduct'), 'no note text leaks into the teaser');
  assert.equal(body.price.cents, MAPS_DEFAULT_PRICE_CENTS);
  assert.equal(body.price.label, 'S$9.90 / month');
});

test('an outsider sees "none" and cannot open a map', async () => {
  const { call } = setup();
  assert.equal((await call({ action: 'status' }, OUT)).body.access, 'none');
  const open = await call({ action: 'open', mapId: 'm1' }, OUT);
  assert.equal(open.status, 402);
  assert.equal(open.body.error, 'subscription-required');
});

test('approved students and staff open maps free; anonymous guests and signed-out calls are refused', async () => {
  const { call } = setup({ seed: { access: { student1: { status: 'approved' } } } });
  const student = await call({ action: 'open', mapId: 'm1' }, STUDENT);
  assert.equal(student.status, 200);
  assert.equal(student.body.access, 'student');
  assert.equal(student.body.map.nodes.length, 5);
  assert.equal(student.body.map.ownerUid, undefined);
  assert.equal((await call({ action: 'open', mapId: 'm1' }, TEACHER)).body.access, 'staff');
  assert.equal((await call({ action: 'status' }, GUEST)).status, 401);
  assert.equal((await call({ action: 'status' })).status, 401);
  assert.equal((await call({ action: 'subscribe', returnUrl: RETURN }, STUDENT)).body.error, 'free-for-you');
});

test('a pending (not yet approved) student is treated like an outsider', async () => {
  const { call } = setup({ seed: { access: { student1: { status: 'pending' } } } });
  assert.equal((await call({ action: 'status' }, STUDENT)).body.access, 'none');
});

test('subscribe opens a monthly Stripe Checkout stamped with the account uid', async () => {
  const { call, stripe: st } = setup();
  const { status, body } = await call({ action: 'subscribe', returnUrl: RETURN + '?x=1' }, OUT);
  assert.equal(status, 200);
  assert.match(body.url, /^https:\/\/checkout\.stripe\.com\//);
  const [, params, key] = st.calls.find(c => c[0] === 'checkout');
  assert.equal(params.mode, 'subscription');
  assert.deepEqual(params.metadata, { source: MAPS_SOURCE, uid: 'outsider1' });
  assert.deepEqual(params.subscription_data.metadata, { source: MAPS_SOURCE, uid: 'outsider1' });
  assert.equal(params.line_items[0].price_data.unit_amount, 990);
  assert.deepEqual(params.line_items[0].price_data.recurring, { interval: 'month' });
  assert.equal(params.customer_email, 'parent@example.com');
  assert.equal(params.success_url, RETURN + '?subscribed=1&session={CHECKOUT_SESSION_ID}');
  assert.match(key, /^polymath-maps-[0-9a-f]{32}-\d+$/);
});

test('subscribe refuses a return address off the site', async () => {
  const { call } = setup();
  assert.equal((await call({ action: 'subscribe', returnUrl: 'https://evil.example/maps/' }, OUT)).body.error, 'return-url-not-allowed');
  assert.equal((await call({ action: 'subscribe', returnUrl: ORIGIN + '/products/' }, OUT)).body.error, 'return-url-not-allowed');
});

test('the admin\'s Stripe price is used once it exists', async () => {
  const { call, stripe: st } = setup({ stripeOptions: { prices: [{ id: 'price_1', active: true, unit_amount: 1500, currency: 'sgd', recurring: { interval: 'month' }, product: 'prod_1' }] } });
  assert.equal((await call({ action: 'catalogue' })).body.price.label, 'S$15.00 / month');
  await call({ action: 'subscribe', returnUrl: RETURN }, OUT);
  const [, params] = st.calls.find(c => c[0] === 'checkout');
  assert.deepEqual(params.line_items, [{ price: 'price_1', quantity: 1 }]);
  assert.deepEqual(st.calls.find(c => c[0] === 'prices')[1].lookup_keys, [MAPS_LOOKUP_KEY]);
});

test('coming back from Stripe records the subscription and opens the library', async () => {
  const sub = subscription();
  const t = setup({ stripeOptions: { subs: { [sub.id]: sub } } });
  t.stripe.sessions = { cs_test_12345678: { id: 'cs_test_12345678', status: 'complete', subscription: sub.id, metadata: { source: MAPS_SOURCE, uid: 'outsider1' } } };
  const { body } = await t.call({ action: 'confirm', sessionId: 'cs_test_12345678' }, OUT);
  assert.equal(body.access, 'subscriber');
  assert.equal(body.subscription.status, 'active');
  assert.equal(t.store.rows.subscribers.get('outsider1').subscriptionId, sub.id);
  assert.ok(!JSON.stringify(t.store.rows.subscribers.get('outsider1')).includes('@'), 'no email is kept in Firestore');
  assert.equal((await t.call({ action: 'open', mapId: 'm1' }, OUT)).status, 200);
  assert.equal((await t.call({ action: 'open', mapId: 'm2' }, OUT)).status, 404, 'a student\'s map is never in the library');
  assert.equal((await t.call({ action: 'open', mapId: 'm3' }, OUT)).status, 404, 'an unpublished map is never in the library');
});

test('another account\'s checkout session is refused', async () => {
  const t = setup();
  t.stripe.sessions = { cs_test_12345678: { id: 'cs_test_12345678', status: 'complete', subscription: 'sub_X', metadata: { source: MAPS_SOURCE, uid: 'someoneelse' } } };
  assert.equal((await t.call({ action: 'confirm', sessionId: 'cs_test_12345678' }, OUT)).status, 404);
});

test('a forged Firestore record pointing at someone else\'s subscription grants nothing', async () => {
  const theirs = subscription({ id: 'sub_THEIRS1234', metadata: { source: MAPS_SOURCE, uid: 'victim' } });
  const t = setup({ seed: { subscribers: { outsider1: { subscriptionId: 'sub_THEIRS1234', status: 'active' } } }, stripeOptions: { subs: { sub_THEIRS1234: theirs } } });
  assert.equal((await t.call({ action: 'status' }, OUT)).body.access, 'none');
  assert.equal((await t.call({ action: 'open', mapId: 'm1' }, OUT)).status, 402);
});

test('a lost record is found again through Stripe search', async () => {
  const sub = subscription();
  const t = setup({ stripeOptions: { subs: { [sub.id]: sub }, search: [sub] } });
  assert.equal((await t.call({ action: 'status' }, OUT)).body.access, 'subscriber');
  assert.equal(t.store.rows.subscribers.get('outsider1').subscriptionId, sub.id);
  assert.match(t.stripe.calls.find(c => c[0] === 'search')[1], /metadata\['uid'\]:'outsider1'/);
});

test('a failed renewal (past_due) or a cancelled subscription closes the library', async () => {
  for (const status of ['past_due', 'unpaid', 'canceled', 'incomplete_expired']) {
    const sub = subscription({ status });
    const t = setup({ seed: { subscribers: { outsider1: { subscriptionId: sub.id } } }, stripeOptions: { subs: { [sub.id]: sub } } });
    const { body } = await t.call({ action: 'status' }, OUT);
    assert.equal(body.access, 'none', status);
    assert.equal(body.subscription.status, status);
    assert.equal((await t.call({ action: 'open', mapId: 'm1' }, OUT)).status, 402, status);
  }
});

test('cancel stops at the end of the paid month, and resume undoes it', async () => {
  const sub = subscription();
  const t = setup({ seed: { subscribers: { outsider1: { subscriptionId: sub.id } } }, stripeOptions: { subs: { [sub.id]: sub } } });
  const cancelled = await t.call({ action: 'cancel' }, OUT);
  assert.equal(cancelled.body.access, 'subscriber', 'still open until the month ends');
  assert.equal(cancelled.body.subscription.cancelAtPeriodEnd, true);
  assert.deepEqual(t.stripe.calls.find(c => c[0] === 'update').slice(1), [sub.id, { cancel_at_period_end: true }]);
  const resumed = await t.call({ action: 'resume' }, OUT);
  assert.equal(resumed.body.subscription.cancelAtPeriodEnd, false);
  assert.equal((await setup().call({ action: 'cancel' }, OUT)).body.error, 'no-subscription');
});

test('an active subscriber cannot subscribe twice', async () => {
  const sub = subscription();
  const t = setup({ seed: { subscribers: { outsider1: { subscriptionId: sub.id } } }, stripeOptions: { subs: { [sub.id]: sub } } });
  assert.equal((await t.call({ action: 'subscribe', returnUrl: RETURN }, OUT)).body.error, 'already-subscribed');
});

test('resubscribing after a cancellation reuses the Stripe customer', async () => {
  const sub = subscription({ status: 'canceled' });
  const t = setup({ seed: { subscribers: { outsider1: { subscriptionId: sub.id } } }, stripeOptions: { subs: { [sub.id]: sub } } });
  await t.call({ action: 'subscribe', returnUrl: RETURN }, OUT);
  const [, params] = t.stripe.calls.find(c => c[0] === 'checkout');
  assert.equal(params.customer, 'cus_ABC123');
  assert.equal(params.customer_email, undefined);
});

test('manage opens Stripe\'s card page, or says the portal is not set up', async () => {
  const sub = subscription();
  const t = setup({ seed: { subscribers: { outsider1: { subscriptionId: sub.id } } }, stripeOptions: { subs: { [sub.id]: sub } } });
  assert.match((await t.call({ action: 'manage', returnUrl: RETURN }, OUT)).body.url, /billing\.stripe\.com/);
  t.stripe.noPortal = true;
  assert.equal((await t.call({ action: 'manage', returnUrl: RETURN }, OUT)).body.error, 'portal-unavailable');
});

test('only the access admins see subscribers and change the price', async () => {
  const sub = subscription();
  const prices = [];
  const t = setup({ stripeOptions: { subs: { [sub.id]: sub, sub_other123: subscription({ id: 'sub_other123', metadata: { source: 'other' } }) }, prices } });
  assert.equal((await t.call({ action: 'admin' }, OUT)).status, 403);
  const list = await t.call({ action: 'admin' }, TEACHER);
  assert.equal(list.body.subscribers.length, 1);
  assert.equal(list.body.subscribers[0].email, 'parent@example.com');
  assert.equal(list.body.priceFromStripe, false);
  assert.equal((await t.call({ action: 'admin-price', cents: 20 }, TEACHER)).body.error, 'invalid-price');
  assert.equal((await t.call({ action: 'admin-price', cents: 1200 }, OUT)).status, 403);
  const changed = await t.call({ action: 'admin-price', cents: 1200 }, TEACHER);
  assert.equal(changed.body.price.label, 'S$12.00 / month');
  const [, params] = t.stripe.calls.find(c => c[0] === 'createPrice');
  assert.equal(params.lookup_key, MAPS_LOOKUP_KEY);
  assert.equal(params.transfer_lookup_key, true);
  assert.deepEqual(params.recurring, { interval: 'month' });
  // A second change keeps the same Stripe product and archives the old price.
  const again = await t.call({ action: 'admin-price', cents: 1500 }, TEACHER);
  assert.equal(again.body.price.label, 'S$15.00 / month');
  assert.equal(t.stripe.calls.filter(c => c[0] === 'createPrice')[1][1].product, 'prod_new');
  assert.ok(t.stripe.calls.some(c => c[0] === 'updatePrice' && c[2].active === false));
});

test('without a Stripe key the catalogue still answers with the default price', async () => {
  const t = setup({ stripeOptions: { configured: false } });
  const { status, body } = await t.call({ action: 'catalogue' });
  assert.equal(status, 200);
  assert.equal(body.price.cents, MAPS_DEFAULT_PRICE_CENTS);
  assert.equal((await t.call({ action: 'subscribe', returnUrl: RETURN }, OUT)).body.error, 'card-payments-off');
});

test('unknown actions, extra fields and foreign origins are refused', async () => {
  const t = setup();
  assert.equal((await t.call({ action: 'delete-everything' }, OUT)).body.error, 'unknown-action');
  assert.equal((await t.call({ action: 'status', admin: true }, OUT)).status, 400);
  assert.equal((await t.call({ action: 'catalogue' }, null, 'https://evil.example')).status, 403);
});

test('the shared Stripe webhook records a paid subscription checkout', async () => {
  const sub = subscription();
  const t = setup({ stripeOptions: { subs: { [sub.id]: sub } } });
  const service = createService({ repository: {}, stripe: t.stripe, webhookSecret: 'whsec_test', now: () => NOW,
    paidSessionHandlers: { [MAPS_SOURCE]: t.maps.handlePaidSession } });
  const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: {
    id: 'cs_test_12345678', status: 'complete', payment_status: 'paid', mode: 'subscription', subscription: sub.id,
    metadata: { source: MAPS_SOURCE, uid: 'outsider1' } } } });
  const headers = { 'stripe-signature': signWebhook(event, 'whsec_test', Math.floor(NOW / 1000)) };
  const out = {};
  const res = { set() { return this; }, status(code) { out.status = code; return this; }, json(value) { out.body = value; return this; } };
  await service.webhook({ method: 'POST', rawBody: Buffer.from(event), get: name => headers[name.toLowerCase()] }, res);
  assert.equal(out.status, 200);
  assert.equal(out.body.maps, true);
  assert.equal(t.store.rows.subscribers.get('outsider1').status, 'active');
});

test('helpers: teaser, public subscription and the best of several', () => {
  const teaser = teaserOf('m1', mapDoc());
  assert.equal(teaser.counts.items, 5);
  assert.equal(publicSubscription(subscription({ cancel_at_period_end: true })).cancelAtPeriodEnd, true);
  assert.equal(publicSubscription(null), null);
  const best = bestSubscription([subscription({ id: 'sub_old', status: 'canceled', created: 5 }), subscription({ id: 'sub_live', status: 'active', created: 1 })]);
  assert.equal(best.id, 'sub_live');
  const params = subscribeSessionParams({ uid: 'u', email: '', customerId: '', price: { id: '', cents: 990 }, base: RETURN });
  assert.equal(params.customer_email, undefined);
});
