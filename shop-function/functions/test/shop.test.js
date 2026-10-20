'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createService, validateCheckout, priceCheckout, sessionParams, buildCheckout, newOrderCode, validCode,
  ShopError, LIMITS, SOURCE, ORDER_CODE_CHARS } = require('../service');
const { createRepository } = require('../repository');
const { createStripe, verifyWebhook, signWebhook, encodeBody, StripeError } = require('../stripe');
const { receiptMail, mailId, SENDER_EMAIL } = require('../receipt');

const NOW = Date.UTC(2026, 9, 19, 9);
const WEBHOOK_SECRET = 'whsec_test_secret';
const ORIGIN = 'https://polymathlc.com.sg';

// An in-memory Firestore with just the calls the repository makes.
function database(seed = {}) {
  const rows = new Map(Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]));
  const ref = path => ({
    path, id: path.split('/').at(-1),
    async get() { return snapshot(this); },
    async update(data) { if (!rows.has(path)) throw new Error('No document'); rows.set(path, Object.assign({}, rows.get(path), data)); }
  });
  const snapshot = reference => ({ exists: rows.has(reference.path), data: () => structuredClone(rows.get(reference.path)), ref: reference, id: reference.id });
  let pending = Promise.resolve();
  const db = {
    rows,
    collection(name) { return {
      doc: id => ref(name + '/' + id),
      where(field, op, value) { assert.equal(op, '<='); return { limit(count) { return { async get() {
        const docs = [...rows.keys()].filter(path => path.startsWith(name + '/') && path.split('/').length === 2
          && rows.get(path)[field] <= value).slice(0, count).map(path => snapshot(ref(path)));
        return { empty: docs.length === 0, docs };
      } }; } }; }
    }; },
    async getAll(...references) { return references.map(snapshot); },
    runTransaction(action) {
      const run = pending.then(async () => {
        const writes = [];
        let wrote = false;
        const read = reference => { if (wrote) throw new Error('Read after write in a transaction'); return snapshot(reference); };
        const result = await action({
          get: async reference => read(reference),
          getAll: async (...references) => references.map(read),
          set: (reference, data) => { wrote = true; writes.push(['set', reference, data]); },
          create: (reference, data) => { wrote = true; writes.push(['create', reference, data]); },
          update: (reference, data) => { wrote = true; writes.push(['update', reference, data]); }
        });
        for (const [type, reference] of writes) {
          if (type === 'create' && rows.has(reference.path)) throw new Error('Already exists');
          if (type === 'update' && !rows.has(reference.path)) throw new Error('No document');
        }
        for (const [type, reference, data] of writes)
          rows.set(reference.path, type === 'update' ? Object.assign({}, rows.get(reference.path), data) : structuredClone(data));
        return result;
      });
      pending = run.catch(() => {});
      return run;
    },
    batch() { const deletions = []; return {
      delete: reference => deletions.push(reference.path), commit: async () => deletions.forEach(path => rows.delete(path))
    }; }
  };
  return db;
}
const repositoryFor = db => createRepository(db, { fromMillis: value => value });

// A Stripe that remembers the sessions it made and can be told one was paid.
function fakeStripe() {
  const sessions = new Map(), calls = [];
  let counter = 0;
  return {
    sessions, calls,
    async createCheckoutSession(params, idempotencyKey) {
      calls.push({ params, idempotencyKey });
      const id = 'cs_test_' + String(++counter).padStart(10, '0');
      const amount = params.line_items.reduce((sum, line) => sum + line.price_data.unit_amount * line.quantity, 0);
      const session = { id, url: 'https://checkout.stripe.com/c/pay/' + id, status: 'open', payment_status: 'unpaid',
        client_reference_id: params.client_reference_id, metadata: params.metadata, amount_total: amount, currency: 'sgd', payment_intent: null };
      sessions.set(id, session);
      return session;
    },
    async retrieveCheckoutSession(id) {
      if (!sessions.has(id)) throw new StripeError(502, 'stripe-error', 'invalid_request_error:resource_missing');
      return structuredClone(sessions.get(id));
    },
    pay(id) { Object.assign(sessions.get(id), { status: 'complete', payment_status: 'paid', payment_intent: 'pi_test_' + id.slice(-6) }); }
  };
}

const seed = () => ({
  'shop_products/book': { name: 'P5 Science Notes', sku: 'SCI-P5', price: 18.5, quantity: 10, active: true,
    images: [{ url: 'https://firebasestorage.googleapis.com/v0/b/x/o/book.jpg', path: 'shop-products/book/1.jpg' }] },
  'shop_products/pack': { name: 'Revision Pack', sku: 'REV-1', price: '12', quantity: null, active: true },
  'shop_products/last': { name: 'Last Copy', sku: 'LAST', price: 5, quantity: 1, active: true },
  'shop_products/hidden': { name: 'Hidden', price: 5, quantity: 3, active: false },
  'shop_products/free': { name: 'Free', price: 0, quantity: null },
  'shop_settings/config': { deliveryFee: 4.5 }
});
const cart = (overrides = {}) => ({
  items: [{ productId: 'book', qty: 2 }, { productId: 'pack', qty: 1 }],
  customer: { name: 'Test Parent', phone: '9123 4567', email: 'Parent@Example.test' },
  fulfilment: 'collect', address: '', note: 'For Ava, P5', returnUrl: ORIGIN + '/products/', pageVersion: 'v1.3.0',
  ...overrides
});

function harness(seedRows = seed(), options = {}) {
  const db = database(seedRows), stripe = fakeStripe(), logs = [];
  let clock = NOW;
  const codes = options.codes ? [...options.codes] : null;
  let n = 0;
  const random = codes
    ? max => { const code = codes[0]; const ch = code[n++]; if (n === 6) { codes.shift(); n = 0; } return ORDER_CODE_CHARS.indexOf(ch) % max; }
    : max => Math.floor(Math.random() * max);
  // Signed-in Firebase users by ID token, as getAuth().verifyIdToken would read them.
  const users = {
    'admin-token-0123456789': { email: 'chungzhikai@gmail.com', email_verified: true },
    'other-token-0123456789': { email: 'someone@example.test', email_verified: true },
    'unverified-token-01234': { email: 'chungzhikai@gmail.com', email_verified: false }
  };
  const verifyIdToken = async token => { if (!users[token]) throw new Error('bad token'); return users[token]; };
  const service = createService({ repository: repositoryFor(db), stripe, webhookSecret: WEBHOOK_SECRET, verifyIdToken,
    now: () => clock, random, report: code => logs.push(code) });
  async function call(handler, body, overrides = {}) {
    const headers = { origin: ORIGIN, 'content-type': 'application/json', ...overrides.headers };
    const req = { method: 'POST', body, ip: '192.0.2.10', ...overrides, get: name => headers[name.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; },
      send(value) { this.body = value; return this; } };
    await handler(req, res);
    return res;
  }
  function webhookCall(event, { secret = WEBHOOK_SECRET, at = Math.floor(clock / 1000), tamper = false } = {}) {
    const raw = JSON.stringify(event);
    const signature = signWebhook(raw, secret, at);
    const body = tamper ? raw.replace('"paid"', '"unpaid"') : raw;
    return call(service.webhook, JSON.parse(body), { rawBody: Buffer.from(body), headers: { 'stripe-signature': signature, 'content-type': 'application/json' } });
  }
  return { db, stripe, logs, service, call, webhookCall,
    create: (body = cart(), overrides) => call(service.createCheckout, body, overrides),
    status: (body, overrides) => call(service.checkoutStatus, body, overrides),
    receipt: (code, token = 'admin-token-0123456789') => call(service.sendReceipt, { code },
      token ? { headers: { authorization: 'Bearer ' + token } } : {}),
    advance: ms => { clock += ms; } };
}
const completed = session => ({ id: 'evt_test', type: 'checkout.session.completed', data: { object: session } });

/* ─── Validation and pricing ─── */

test('validation accepts a normal cart and merges repeated products', () => {
  const request = validateCheckout(cart({ items: [{ productId: 'book', qty: 1 }, { productId: 'book', qty: 2 }] }));
  assert.deepEqual(request.items, [{ productId: 'book', qty: 3 }]);
  assert.equal(request.customer.email, 'parent@example.test');
  assert.equal(request.returnBase, ORIGIN + '/products/');
  assert.equal(validateCheckout(cart({ returnUrl: 'https://polymathlc.github.io/cer/products/index.html?x=1#y' })).returnBase,
    'https://polymathlc.github.io/cer/products/index.html');
});

test('validation refuses bad carts, people and return pages', () => {
  const bad = [
    null, [], cart({ extra: 1 }), cart({ items: [] }), cart({ items: [{ productId: 'book', qty: 0 }] }),
    cart({ items: [{ productId: 'book', qty: 1.5 }] }), cart({ items: [{ productId: 'book', qty: 100 }] }),
    cart({ items: [{ productId: 'a/b', qty: 1 }] }), cart({ items: [{ productId: '__x__', qty: 1 }] }),
    cart({ items: Array.from({ length: LIMITS.lines + 1 }, (_, i) => ({ productId: 'p' + i, qty: 1 })) }),
    cart({ customer: { name: '', phone: '91234567' } }), cart({ customer: { name: 'A', phone: '123' } }),
    cart({ customer: { name: 'A', phone: '91234567', email: 'nope' } }),
    cart({ customer: { name: 'A', phone: '91234567', email: '' } }), cart({ customer: { name: 'A', phone: '91234567' } }),
    cart({ customer: { name: 'A\nBcc: x', phone: '91234567' } }),
    cart({ customer: { name: 'A', phone: '91234567', role: 'admin' } }),
    cart({ fulfilment: 'teleport' }), cart({ fulfilment: 'delivery', address: '' }),
    cart({ returnUrl: 'https://evil.example/products/' }), cart({ returnUrl: ORIGIN + '/elsewhere/' }),
    cart({ returnUrl: 'javascript:alert(1)' }), cart({ returnUrl: 'http://polymathlc.com.sg/products/' })
  ];
  for (const body of bad) assert.throws(() => validateCheckout(body), ShopError, JSON.stringify(body));
});

test('prices come from Firestore, never from the browser, and the fee only applies to delivery', () => {
  const products = new Map(Object.entries(seed()).filter(([k]) => k.startsWith('shop_products/')).map(([k, v]) => [k.split('/')[1], v]));
  const collect = priceCheckout(validateCheckout(cart()), products, { deliveryFee: 4.5 });
  assert.equal(collect.subtotalCents, 2 * 1850 + 1200);
  assert.equal(collect.feeCents, 0);
  const delivery = priceCheckout(validateCheckout(cart({ fulfilment: 'delivery', address: '1 Road' })), products, { deliveryFee: 4.5 });
  assert.equal(delivery.feeCents, 450);
  assert.equal(delivery.totalCents, 4900 + 450);
  const odd = priceCheckout(validateCheckout(cart({ items: [{ productId: 'odd', qty: 3 }] })), new Map([['odd', { name: 'Odd', price: 1.1 }]]), {});
  assert.equal(odd.totalCents, 330, 'cents are exact where floating dollars are not');
});

test('a cart that changed underneath is refused with the lines that changed', () => {
  const products = new Map(Object.entries(seed()).filter(([k]) => k.startsWith('shop_products/')).map(([k, v]) => [k.split('/')[1], v]));
  const body = validateCheckout(cart({ items: [{ productId: 'last', qty: 2 }, { productId: 'hidden', qty: 1 },
    { productId: 'gone', qty: 1 }, { productId: 'free', qty: 1 }, { productId: 'book', qty: 1 }] }));
  try { priceCheckout(body, products, {}); assert.fail('should refuse'); }
  catch (error) {
    assert.equal(error.code, 'cart-changed');
    assert.deepEqual(error.detail.map(p => p.productId + ':' + p.reason),
      ['last:not-enough-stock', 'hidden:unavailable', 'gone:unavailable', 'free:unavailable']);
  }
  const soldOut = new Map([['x', { name: 'X', price: 3, quantity: 0 }]]);
  assert.throws(() => priceCheckout(validateCheckout(cart({ items: [{ productId: 'x', qty: 1 }] })), soldOut, {}),
    error => error.detail[0].reason === 'sold-out');
});

test('Stripe minimum and maximum amounts are enforced before Stripe sees them', () => {
  const tiny = new Map([['t', { name: 'Tiny', price: 0.2 }]]);
  assert.throws(() => priceCheckout(validateCheckout(cart({ items: [{ productId: 't', qty: 2 }] })), tiny, {}), /total-too-small/);
  const huge = new Map([['h', { name: 'Huge', price: 9999 }]]);
  assert.throws(() => priceCheckout(validateCheckout(cart({ items: [{ productId: 'h', qty: 99 }] })), huge, {}), /total-too-large/);
});

test('order codes use the page alphabet and six characters', () => {
  for (let i = 0; i < 200; i++) assert.ok(validCode(newOrderCode()));
  assert.equal(validCode('ABC12O'), false, 'O and 1 are not in the alphabet');
  assert.equal(validCode('ABCDE'), false);
});

test('the session asks Stripe for a card payment in SGD with the order code everywhere', () => {
  const products = new Map([['book', seed()['shop_products/book']]]);
  const request = validateCheckout(cart({ items: [{ productId: 'book', qty: 2 }], fulfilment: 'delivery', address: '1 Road' }));
  const priced = priceCheckout(request, products, { deliveryFee: 4.5 });
  const { record } = buildCheckout(request, priced, 'ABCDEF', '192.0.2.1', NOW);
  const params = sessionParams(record, priced);
  assert.deepEqual(params.payment_method_types, ['card']);
  assert.equal(params.client_reference_id, 'ABCDEF');
  assert.equal(params.metadata.source, SOURCE);
  assert.equal(params.metadata.reference, 'PLC ABCDEF');
  assert.equal(params.line_items.length, 2);
  assert.deepEqual(params.line_items[0], { quantity: 2, price_data: { currency: 'sgd', unit_amount: 1850,
    product_data: { name: 'P5 Science Notes', description: 'SKU SCI-P5', images: ['https://firebasestorage.googleapis.com/v0/b/x/o/book.jpg'] } } });
  assert.equal(params.line_items[1].price_data.unit_amount, 450);
  assert.equal(params.success_url, ORIGIN + '/products/?order=ABCDEF&session={CHECKOUT_SESSION_ID}');
  assert.equal(params.cancel_url, ORIGIN + '/products/?order=ABCDEF&cancelled=1');
  assert.equal(params.expires_at, Math.floor((NOW + 3600000) / 1000));
  assert.equal(params.customer_email, 'parent@example.test');
  const encoded = encodeBody(params);
  assert.match(encoded, /line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1850/);
  assert.match(encoded, /success_url=https%3A%2F%2Fpolymathlc\.com\.sg%2Fproducts%2F%3Forder%3DABCDEF%26session%3D%7BCHECKOUT_SESSION_ID%7D/);
  assert.doesNotMatch(encodeBody(sessionParams({ ...record, customer: { ...record.customer, email: '' } }, priced)), /customer_email/);
});

/* ─── The HTTP endpoints ─── */

test('CORS: other origins are refused and the preflight is answered', async () => {
  const h = harness();
  assert.equal((await h.create(cart(), { headers: { origin: 'https://evil.example' } })).statusCode, 403);
  const pre = await h.create(undefined, { method: 'OPTIONS' });
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers['Access-Control-Allow-Origin'], ORIGIN);
  assert.equal((await h.create(cart(), { method: 'GET' })).statusCode, 405);
  assert.equal((await h.create(cart(), { headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  assert.equal(h.stripe.calls.length, 0);
});

test('creating a checkout saves it, makes one Stripe session and returns its page', async () => {
  const h = harness(seed(), { codes: ['ABCDEF'] });
  const res = await h.create(cart({ fulfilment: 'delivery', address: '1 Science Park Road' }));
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.code, 'ABCDEF');
  assert.equal(res.body.reference, 'PLC ABCDEF');
  assert.equal(res.body.total, 53.5);
  assert.match(res.body.url, /^https:\/\/checkout\.stripe\.com\//);
  const saved = h.db.rows.get('shop_checkouts/ABCDEF');
  assert.equal(saved.status, 'open');
  assert.equal(saved.totalCents, 5350);
  assert.equal(saved.sessionId, h.stripe.calls.length && [...h.stripe.sessions.keys()][0]);
  assert.equal(h.stripe.calls[0].idempotencyKey, 'polymath-shop-ABCDEF');
  assert.equal(h.db.rows.has('shop_orders/ABCDEF'), false, 'no order exists until it is paid');
});

test('a code already used by a PayNow order or another checkout is skipped', async () => {
  const rows = { ...seed(), 'shop_orders/AAAAAA': { code: 'AAAAAA' }, 'shop_checkouts/BBBBBB': { code: 'BBBBBB' } };
  const h = harness(rows, { codes: ['AAAAAA', 'BBBBBB', 'CCCCCC'] });
  const res = await h.create();
  assert.equal(res.body.code, 'CCCCCC');
});

test('the cart is refused with 409 when stock ran out, and Stripe is never called', async () => {
  const h = harness();
  const res = await h.create(cart({ items: [{ productId: 'last', qty: 2 }] }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'cart-changed');
  assert.deepEqual(res.body.problems, [{ productId: 'last', reason: 'not-enough-stock', left: 1 }]);
  assert.equal(h.stripe.calls.length, 0);
});

test('one address may start 20 checkouts an hour', async () => {
  const h = harness();
  for (let i = 0; i < LIMITS.perIpHour; i++) assert.equal((await h.create()).statusCode, 201);
  const blocked = await h.create();
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers['Retry-After'], '3600');
  h.advance(3600000);
  assert.equal((await h.create()).statusCode, 201);
});

test('with no Stripe key the page is told card payments are off', async () => {
  const db = database(seed()), logs = [];
  const service = createService({ repository: repositoryFor(db), stripe: createStripe({ secretKey: '' }), webhookSecret: '',
    now: () => NOW, report: code => logs.push(code) });
  const headers = { origin: ORIGIN, 'content-type': 'application/json' };
  const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await service.createCheckout({ method: 'POST', body: cart(), ip: '192.0.2.1', get: n => headers[n.toLowerCase()] }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'card-payments-off');
});

test('status: unpaid, then paid, records the order once with the stock taken', async () => {
  const h = harness(seed(), { codes: ['PQRSTU'] });
  const created = await h.create(cart({ items: [{ productId: 'book', qty: 3 }, { productId: 'pack', qty: 2 }, { productId: 'book', qty: 1 }] }));
  const sessionId = h.db.rows.get('shop_checkouts/PQRSTU').sessionId;
  const before = await h.status({ code: 'PQRSTU', sessionId });
  assert.deepEqual(before.body, { ok: true, paid: false, state: 'open' });
  h.stripe.pay(sessionId);
  const after = await h.status({ code: 'PQRSTU', sessionId });
  assert.equal(after.body.paid, true);
  assert.equal(after.body.order.reference, 'PLC PQRSTU');
  assert.equal(after.body.order.total, created.body.total);
  const order = h.db.rows.get('shop_orders/PQRSTU');
  assert.equal(order.status, 'paid');
  assert.equal(order.payment, 'card');
  assert.equal(order.stockApplied, true);
  assert.deepEqual(order.paymentChecks, []);
  assert.deepEqual(order.stockShort, []);
  assert.equal(h.db.rows.get('shop_products/book').quantity, 6, 'both book lines (3 + 1) came out of 10');
  assert.equal(h.db.rows.get('shop_products/pack').quantity, null, 'unlimited stock is untouched');
  assert.equal(h.db.rows.get('shop_checkouts/PQRSTU').status, 'paid');
  await h.status({ code: 'PQRSTU', sessionId });
  assert.equal(h.db.rows.get('shop_products/book').quantity, 6, 'asking again never takes stock twice');
});

test('status: a wrong session or unknown code reads as not found', async () => {
  const h = harness(seed(), { codes: ['VWXYZ2'] });
  await h.create();
  assert.equal((await h.status({ code: 'VWXYZ2', sessionId: 'cs_test_9999999999' })).statusCode, 404);
  assert.equal((await h.status({ code: 'ZZZZZZ', sessionId: 'cs_test_0000000001' })).statusCode, 404);
  assert.equal((await h.status({ code: 'bad', sessionId: 'cs_test_0000000001' })).statusCode, 400);
  assert.equal((await h.status({ code: 'VWXYZ2', sessionId: 'pi_123' })).statusCode, 400);
});

/* ─── The webhook ─── */

test('webhook signatures are checked: wrong secret, tampered body, stale time and missing header are refused', async () => {
  const h = harness();
  const event = completed({ id: 'cs_x', metadata: { source: SOURCE }, payment_status: 'paid', status: 'complete', client_reference_id: 'ABCDEF' });
  assert.equal((await h.webhookCall(event, { secret: 'whsec_other' })).statusCode, 400);
  assert.equal((await h.webhookCall(event, { tamper: true })).statusCode, 400);
  assert.equal((await h.webhookCall(event, { at: Math.floor(NOW / 1000) - 301 })).statusCode, 400);
  const res = await h.call(h.service.webhook, event, { rawBody: Buffer.from(JSON.stringify(event)), headers: {} });
  assert.equal(res.statusCode, 400);
  assert.ok(h.logs.every(line => line.startsWith('stripe-webhook-rejected')));
});

test('verifyWebhook accepts any one of several v1 signatures', () => {
  const raw = JSON.stringify({ type: 'ping' });
  const good = signWebhook(raw, WEBHOOK_SECRET, 1000).split(',')[1];
  const header = 't=1000,v1=' + 'a'.repeat(64) + ',' + good;
  assert.equal(verifyWebhook(raw, header, WEBHOOK_SECRET, 1000).type, 'ping');
  assert.throws(() => verifyWebhook(raw, header, '', 1000), error => error.status === 503);
});

test('webhook: a paid session becomes a paid order, and a repeat delivery changes nothing', async () => {
  const h = harness(seed(), { codes: ['HJKMNP'] });
  await h.create(cart({ fulfilment: 'delivery', address: '1 Road', items: [{ productId: 'last', qty: 1 }] }));
  const sessionId = h.db.rows.get('shop_checkouts/HJKMNP').sessionId;
  h.stripe.pay(sessionId);
  const session = await h.stripe.retrieveCheckoutSession(sessionId);
  const first = await h.webhookCall(completed(session));
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.code, 'HJKMNP');
  const order = h.db.rows.get('shop_orders/HJKMNP');
  assert.equal(order.status, 'paid');
  assert.equal(order.total, 9.5);
  assert.equal(order.deliveryFee, 4.5);
  assert.equal(order.amountPaid, 9.5);
  assert.equal(order.fulfilment, 'delivery');
  assert.equal(order.address, '1 Road');
  assert.equal(h.db.rows.get('shop_products/last').quantity, 0);
  const again = await h.webhookCall(completed(session));
  assert.equal(again.body.already, true);
  assert.equal(h.db.rows.get('shop_products/last').quantity, 0);
  const viaStatus = await h.status({ code: 'HJKMNP', sessionId });
  assert.equal(viaStatus.body.paid, true);
});

test('webhook: stock that ran out meanwhile never goes below zero and is flagged', async () => {
  const h = harness(seed(), { codes: ['QRSTUV'] });
  await h.create(cart({ items: [{ productId: 'last', qty: 1 }] }));
  h.db.rows.get('shop_products/last').quantity = 0;   // a PayNow order took it first
  const sessionId = h.db.rows.get('shop_checkouts/QRSTUV').sessionId;
  h.stripe.pay(sessionId);
  await h.webhookCall(completed(await h.stripe.retrieveCheckoutSession(sessionId)));
  assert.equal(h.db.rows.get('shop_products/last').quantity, 0);
  assert.deepEqual(h.db.rows.get('shop_orders/QRSTUV').stockShort, [{ productId: 'last', wanted: 1, had: 0 }]);
});

test('webhook: an amount that does not match the checkout is recorded but flagged', async () => {
  const h = harness(seed(), { codes: ['WXYZ23'] });
  await h.create();
  const sessionId = h.db.rows.get('shop_checkouts/WXYZ23').sessionId;
  h.stripe.pay(sessionId);
  const session = await h.stripe.retrieveCheckoutSession(sessionId);
  session.amount_total -= 100;
  await h.webhookCall(completed(session));
  assert.deepEqual(h.db.rows.get('shop_orders/WXYZ23').paymentChecks, ['amount-mismatch']);
});

test('webhook: other events, other Stripe sales, unpaid sessions and unknown codes are acknowledged and ignored', async () => {
  const h = harness();
  const ours = { id: 'cs_y', metadata: { source: SOURCE }, payment_status: 'paid', status: 'complete', client_reference_id: 'ABCDEF', amount_total: 100, currency: 'sgd' };
  assert.equal((await h.webhookCall({ type: 'charge.refunded', data: { object: {} } })).body.ignored, 'event-type');
  assert.equal((await h.webhookCall(completed({ ...ours, metadata: { source: 'other-shop' } }))).body.ignored, 'not-shop');
  assert.equal((await h.webhookCall(completed({ ...ours, payment_status: 'unpaid' }))).body.ignored, 'not-paid');
  assert.equal((await h.webhookCall(completed({ ...ours, client_reference_id: 'nope' }))).body.ignored, 'no-order-code');
  assert.equal((await h.webhookCall(completed(ours))).body.ignored, 'unknown-checkout');
  assert.equal([...h.db.rows.keys()].some(key => key.startsWith('shop_orders/')), false);
});

test('webhook: a storage failure answers 500 so Stripe retries', async () => {
  const h = harness(seed(), { codes: ['MNPQRS'] });
  await h.create();
  const sessionId = h.db.rows.get('shop_checkouts/MNPQRS').sessionId;
  h.stripe.pay(sessionId);
  const session = await h.stripe.retrieveCheckoutSession(sessionId);
  h.db.runTransaction = async () => { throw new Error('unavailable'); };
  const res = await h.webhookCall(completed(session));
  assert.equal(res.statusCode, 500);
  assert.deepEqual(h.logs, ['stripe-webhook-storage-failed']);
});

test('cleanup removes old checkouts and expired limits, and leaves orders alone', async () => {
  const h = harness(seed(), { codes: ['ABCDEF'] });
  await h.create();
  const sessionId = h.db.rows.get('shop_checkouts/ABCDEF').sessionId;
  h.stripe.pay(sessionId);
  await h.status({ code: 'ABCDEF', sessionId });
  h.advance(8 * 86400000);
  const result = await h.service.cleanup();
  assert.equal(result.removedCheckouts, 1);
  assert.ok(result.removedLimits >= 2);
  assert.equal(h.db.rows.has('shop_orders/ABCDEF'), true);
});

test('a checkout sweeps old checkouts at most once an hour, and a sweep failure never blocks it', async () => {
  const h = harness();
  const calls = [];
  h.db.rows.set('shop_checkouts/OLDONE', { code: 'OLDONE', deleteAt: NOW - 1 });
  h.db.rows.set('shop_checkout_limits/old', { count: 1, expiresAt: NOW - 1 });
  assert.equal((await h.create()).statusCode, 201);
  assert.equal(h.db.rows.has('shop_checkouts/OLDONE'), false);
  assert.equal(h.db.rows.has('shop_checkout_limits/old'), false);
  h.db.rows.set('shop_checkouts/OLDTWO', { code: 'OLDTWO', deleteAt: NOW - 1 });
  h.advance(60000);
  assert.equal((await h.create()).statusCode, 201);
  assert.equal(h.db.rows.has('shop_checkouts/OLDTWO'), true, 'not swept again within the hour');
  h.advance(3600000);
  const where = h.db.collection;
  h.db.collection = name => { const c = where(name); c.where = () => { calls.push(name); throw new Error('index missing'); }; return c; };
  assert.equal((await h.create()).statusCode, 201, 'a failed sweep still returns the checkout');
  assert.ok(calls.length >= 1);
  assert.ok(h.logs.includes('shop-sweep-failed'));
});

test('with card payment switched off by the admin, no checkout or Stripe session is made', async () => {
  const h = harness({ ...seed(), 'shop_settings/config': { deliveryFee: 4.5, cardPayments: false } });
  const res = await h.create();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'card-payments-off');
  assert.equal(h.stripe.calls.length, 0);
  assert.equal([...h.db.rows.keys()].some(key => key.startsWith('shop_checkouts/')), false);
});

/* ─── The Stripe client ─── */

test('the Stripe client sends form bodies with the key and idempotency key, and hides Stripe messages', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('/checkout/sessions')) return { ok: true, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/x' }) };
    return { ok: false, status: 404, json: async () => ({ error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such session: parent@example.test' } }) };
  };
  const stripe = createStripe({ secretKey: 'sk_test_abc', fetchImpl });
  await stripe.createCheckoutSession({ mode: 'payment', line_items: [{ quantity: 1 }] }, 'polymath-shop-ABCDEF');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer sk_test_abc');
  assert.equal(seen[0].init.headers['Idempotency-Key'], 'polymath-shop-ABCDEF');
  assert.equal(seen[0].init.body, 'mode=payment&line_items%5B0%5D%5Bquantity%5D=1');
  await assert.rejects(stripe.retrieveCheckoutSession('cs_test_missing'), error =>
    error.code === 'stripe-error' && error.message === 'invalid_request_error:resource_missing' && !/parent@/.test(error.message));
  const down = createStripe({ secretKey: 'sk_test_abc', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(down.retrieveCheckoutSession('cs_1'), error => error.code === 'stripe-unreachable');
});

/* ─── Receipts ─── */

const mailRows = db => [...db.rows.keys()].filter(path => path.startsWith('mail/')).sort();
const payNowOrder = (overrides = {}) => ({
  code: 'PAYN0W', reference: 'PLC PAYN0W', status: 'paid', payment: undefined,
  items: [{ productId: 'book', sku: 'SCI-P5', name: 'P5 Science Notes', price: 18.5, qty: 2, lineTotal: 37 }],
  subtotal: 37, deliveryFee: 0, total: 37,
  customer: { name: 'Pay Now Parent', phone: '8123 4567', email: 'paynow@example.test' },
  fulfilment: 'collect', address: '', note: '', paidAt: NOW - 1000, ...overrides
});

test('a card payment emails one receipt from the centre, however many times it is confirmed', async () => {
  const h = harness(seed(), { codes: ['QRSTUV'] });
  await h.create(cart({ fulfilment: 'delivery', address: '1 Road' }));
  const sessionId = h.db.rows.get('shop_checkouts/QRSTUV').sessionId;
  h.stripe.pay(sessionId);
  await h.status({ code: 'QRSTUV', sessionId });
  await h.webhookCall(completed(await h.stripe.retrieveCheckoutSession(sessionId)));
  await h.status({ code: 'QRSTUV', sessionId });
  assert.deepEqual(mailRows(h.db), ['mail/' + mailId('QRSTUV', 1)]);
  const mail = h.db.rows.get('mail/' + mailId('QRSTUV', 1));
  assert.deepEqual(mail.to, ['parent@example.test']);
  assert.equal(mail.from, 'Polymath Learning Centre <' + SENDER_EMAIL + '>');
  assert.equal(mail.replyTo, 'admin@polymathlc.com.sg');
  assert.match(mail.message.subject, /QRSTUV/);
  assert.match(mail.message.text, /card payment of \$53\.50/);
  assert.match(mail.message.text, /Delivery fee {2}\$4\.50/);
  assert.match(mail.message.text, /We will deliver to: 1 Road/);
  assert.match(mail.message.html, /PLC QRSTUV/);
  const order = h.db.rows.get('shop_orders/QRSTUV');
  assert.equal(order.receiptCount, 1);
  assert.equal(order.receiptSentTo, 'parent@example.test');
});

test('a leftover mail document never stops a card payment from being recorded', async () => {
  const rows = Object.assign(seed(), { ['mail/' + mailId('RSTUVW', 1)]: { to: ['old@example.test'] } });
  const h = harness(rows, { codes: ['RSTUVW'] });
  await h.create();
  const sessionId = h.db.rows.get('shop_checkouts/RSTUVW').sessionId;
  h.stripe.pay(sessionId);
  assert.equal((await h.status({ code: 'RSTUVW', sessionId })).body.paid, true);
  assert.equal(h.db.rows.get('shop_orders/RSTUVW').status, 'paid');
  assert.equal(h.db.rows.get('shop_orders/RSTUVW').receiptCount, undefined);
  assert.deepEqual(h.db.rows.get('mail/' + mailId('RSTUVW', 1)).to, ['old@example.test'], 'the old document is left alone');
});

test('the receipt escapes what the buyer typed and leaves out what is not there', () => {
  const mail = receiptMail(payNowOrder({ customer: { name: '<b>Eve</b>', phone: '', email: 'eve@example.test' }, note: 'a & <script>' }), { now: NOW });
  assert.ok(!mail.message.html.includes('<b>Eve</b>') && mail.message.html.includes('&lt;b&gt;Eve&lt;/b&gt;'));
  assert.ok(!mail.message.html.includes('<script>') && mail.message.html.includes('a &amp; &lt;script&gt;'));
  assert.match(mail.message.text, /PayNow payment of \$37\.00/);
  assert.match(mail.message.text, /collect your order at Polymath Learning Centre\. We will WhatsApp you when/);
  assert.ok(!/Delivery fee/.test(mail.message.text), 'no fee line on a collected order');
  assert.match(mail.message.text, /UEN T16LL2365E/);
  assert.equal(receiptMail(payNowOrder({ customer: { name: 'No Email', phone: '1', email: '' } })), null);
  assert.equal(receiptMail(payNowOrder({ customer: { name: 'Bad', phone: '1', email: 'not an email' } })), null);
});

test('only the signed-in admin may send a receipt', async () => {
  const h = harness(Object.assign(seed(), { 'shop_orders/PAYN0W': payNowOrder() }));
  assert.equal((await h.receipt('PAYN0W', null)).statusCode, 401);
  assert.equal((await h.receipt('PAYN0W', 'forged-token-0123456789')).statusCode, 401);
  assert.equal((await h.receipt('PAYN0W', 'other-token-0123456789')).statusCode, 403);
  assert.equal((await h.receipt('PAYN0W', 'unverified-token-01234')).statusCode, 403);
  assert.deepEqual(mailRows(h.db), []);
  const preflight = await h.call(h.service.sendReceipt, null, { method: 'OPTIONS' });
  assert.equal(preflight.statusCode, 204);
  assert.match(preflight.headers['Access-Control-Allow-Headers'], /Authorization/);
});

test('marking a PayNow order paid emails its receipt; a resend waits a minute and says "again"', async () => {
  const h = harness(Object.assign(seed(), { 'shop_orders/PAYN0W': payNowOrder() }));
  const first = await h.receipt('PAYN0W');
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, { ok: true, sentTo: 'paynow@example.test', count: 1, resend: false });
  const mail = h.db.rows.get('mail/' + mailId('PAYN0W', 1));
  assert.match(mail.message.text, /PayNow payment of \$37\.00/);
  assert.ok(!/again/.test(mail.message.text));
  const tooSoon = await h.receipt('PAYN0W');
  assert.equal(tooSoon.statusCode, 429);
  assert.equal(tooSoon.body.error, 'receipt-just-sent');
  assert.equal(tooSoon.headers['Retry-After'], '60');
  h.advance(61000);
  const again = await h.receipt('PAYN0W');
  assert.equal(again.body.count, 2);
  assert.equal(again.body.resend, true);
  assert.match(h.db.rows.get('mail/' + mailId('PAYN0W', 2)).message.text, /Here is your receipt again/);
  assert.equal(h.db.rows.get('shop_orders/PAYN0W').receiptCount, 2);
});

test('receipts are refused for unpaid, unknown and email-less orders, and never overwrite a mail document', async () => {
  const h = harness(Object.assign(seed(), {
    'shop_orders/PENDNG': payNowOrder({ code: 'PENDNG', status: 'pending' }),
    'shop_orders/NOMAIL': payNowOrder({ code: 'NOMAIL', customer: { name: 'Old Order', phone: '81234567' } }),
    'shop_orders/TAKEN1': payNowOrder({ code: 'TAKEN1', status: 'collected' }),
    ['mail/' + mailId('TAKEN1', 1)]: { to: ['old@example.test'] }
  }));
  assert.equal((await h.receipt('PENDNG')).body.error, 'order-not-paid');
  assert.equal((await h.receipt('NOMAIL')).body.error, 'no-email');
  assert.equal((await h.receipt('ZZZZZZ')).statusCode, 404);
  assert.equal((await h.receipt('bad code')).statusCode, 400);
  const taken = await h.receipt('TAKEN1');
  assert.equal(taken.statusCode, 200);
  assert.deepEqual(h.db.rows.get('mail/' + mailId('TAKEN1', 1)).to, ['old@example.test']);
  assert.ok(mailRows(h.db).some(path => path.startsWith('mail/' + mailId('TAKEN1', 1) + '-')));
});
