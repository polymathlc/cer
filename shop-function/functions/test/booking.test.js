'use strict';
// Card payments for trial lessons and enrolments on /schedule (booking.js),
// through the shared repository, Stripe client and webhook.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createService, createHttp, hash, ShopError, ORDER_CODE_CHARS } = require('../service');
const { createBookingService, validateBooking, priceBooking, bookingSessionParams, buildBookingCheckout, slotLabel,
  trialPriceFor, monthlyFeeFor, readSlot, BOOKING_SOURCE, BOOKING_LIMITS } = require('../booking');
const { adminBookingMail, parentBookingMail, bookingMailId, fmtDayKey, NOTIFICATION_EMAILS } = require('../booking-mail');
const { signWebhook } = require('../stripe');
const { SENDER_EMAIL } = require('../receipt');
const { database, repositoryFor, fakeStripe } = require('./fakes');

const NOW = Date.UTC(2026, 9, 23, 2);   // Friday 23 Oct 2026, 10am in Singapore
const WEBHOOK_SECRET = 'whsec_test_secret';
const ORIGIN = 'https://polymathlc.com.sg';

// The live schedule's shape: regular classes in one or both modes, a Master Class,
// a full class and a closed one, with Online prices that differ from Physical.
const CONFIG = {
  trialPrice: 50, trialPriceOnline: 40, monthlyFee: 240, monthlyFeeOnline: '200',
  masterTrialPrice: '80', masterMonthlyFee: 400,
  slots: {
    'MON-3': { level: 'P6', subject: 'Science', mode: 'Both', status: 'open', type: 'regular' },
    'FRI-1': { level: 'P5', subject: 'Science', mode: 'Both', status: 'open', type: 'regular', fee: '260', feeOnline: '' },
    'SAT-1': { level: 'P6', subject: 'Science', mode: 'Online', status: 'open', type: 'regular' },
    'WED-1': { level: 'P6', subject: 'Math', mode: 'Physical', status: 'open', type: 'regular' },
    'THU-3': { level: 'P5', subject: 'Science', mode: 'Physical', status: 'open', type: 'master', fee: '450' },
    'TUE-3': { level: 'P4', subject: 'Science', mode: 'Online', status: 'full', type: 'regular' },
    'MON-1': { level: 'P4', subject: 'Math', mode: 'Both', status: 'closed', type: 'regular' },
    'FRI-3': { level: '', subject: '', mode: 'Both', status: 'open', type: 'regular' }
  }
};
const seed = (overrides = {}) => ({
  'schedule_config/main': structuredClone(CONFIG),
  'shop_settings/config': { deliveryFee: 4.5 },
  ...overrides
});
const form = (overrides = {}) => ({
  slot: 'MON-3', kind: 'trial', mode: 'Online',
  parentName: 'Test Parent', childName: 'Ava Tan', childLevel2027: 'Primary 6',
  email: 'Parent@Example.test', whatsapp: '+65 9123 4567', earliestKey: '2026-10-29',
  returnUrl: ORIGIN + '/schedule/', pageVersion: 'v1.6.0',
  ...overrides
});

function harness(seedRows = seed()) {
  const db = database(seedRows), stripe = fakeStripe(), logs = [];
  let clock = NOW;
  const random = max => Math.floor(Math.random() * max);
  const report = code => logs.push(code);
  const repository = repositoryFor(db);
  const bookings = createBookingService({ repository, stripe, http: createHttp(report), hashIp: hash, now: () => clock, random, report });
  const shop = createService({ repository, stripe, webhookSecret: WEBHOOK_SECRET, now: () => clock, random, report,
    paidSessionHandlers: { [BOOKING_SOURCE]: bookings.handlePaidSession } });
  async function call(handler, body, overrides = {}) {
    const headers = { origin: ORIGIN, 'content-type': 'application/json', ...overrides.headers };
    const req = { method: 'POST', body, ip: '192.0.2.10', ...overrides, get: name => headers[name.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; },
      send(value) { this.body = value; return this; } };
    await handler(req, res);
    return res;
  }
  function webhookCall(event) {
    const raw = JSON.stringify(event);
    return call(shop.webhook, JSON.parse(raw), { rawBody: Buffer.from(raw),
      headers: { 'stripe-signature': signWebhook(raw, WEBHOOK_SECRET, Math.floor(clock / 1000)), 'content-type': 'application/json' } });
  }
  return { db, stripe, logs, bookings, shop, call, webhookCall,
    create: (body = form(), overrides) => call(bookings.createCheckout, body, overrides),
    status: (body, overrides) => call(bookings.checkoutStatus, body, overrides),
    advance: ms => { clock += ms; } };
}
const completed = session => ({ id: 'evt_test', type: 'checkout.session.completed', data: { object: session } });
const mailsFor = (db, code) => [...db.rows.keys()].filter(path => path.startsWith('mail/') && path.includes(code));

/* ─── Prices: the page's own rules ─── */

test('trial and monthly prices follow the page: per mode, Master Class, and a slot\'s own fee first', () => {
  const slot = id => readSlot(CONFIG, id);
  assert.equal(trialPriceFor(CONFIG, slot('MON-3'), 'Physical'), 50);
  assert.equal(trialPriceFor(CONFIG, slot('MON-3'), 'Online'), 40);
  assert.equal(trialPriceFor(CONFIG, slot('THU-3'), 'Physical'), 80, 'the Master Class has its own trial price');
  assert.equal(monthlyFeeFor(CONFIG, slot('MON-3'), 'Physical'), 240);
  assert.equal(monthlyFeeFor(CONFIG, slot('MON-3'), 'Online'), 200);
  assert.equal(monthlyFeeFor(CONFIG, slot('FRI-1'), 'Physical'), 260, 'a slot\'s own fee wins');
  assert.equal(monthlyFeeFor(CONFIG, slot('FRI-1'), 'Online'), 200, 'a blank slot Online fee falls back to the Online default');
  assert.equal(monthlyFeeFor(CONFIG, slot('THU-3'), 'Physical'), 450);
  const blankOnline = { trialPrice: 30, monthlyFee: 240 };
  assert.equal(trialPriceFor(blankOnline, slot('MON-3'), 'Online'), 30, 'a blank Online trial price falls back to Physical');
  assert.equal(monthlyFeeFor(blankOnline, slot('MON-3'), 'Online'), 240);
  assert.equal(slotLabel('SAT-2'), 'Saturday 11:00am – 12:45pm');
  assert.equal(slotLabel('WED-3'), 'Wednesday 7:00pm – 8:45pm');
});

test('the server prices the booking from Firestore, whatever the page sent', () => {
  const trial = priceBooking(validateBooking(form(), NOW), CONFIG);
  assert.equal(trial.amountCents, 4000);
  assert.equal(trial.mode, 'Online');
  assert.equal(trial.monthlyFee, 200);
  const enrol = priceBooking(validateBooking(form({ slot: 'FRI-1', kind: 'enrol', mode: 'Physical', childLevel2027: 'Primary 5' }), NOW), CONFIG);
  assert.equal(enrol.amountCents, 26000);
  const master = priceBooking(validateBooking(form({ slot: 'THU-3', mode: 'Online' }), NOW), CONFIG);
  assert.equal(master.mode, 'Physical', 'a Master Class is physical whatever the form says');
  assert.equal(master.amountCents, 8000);
  assert.equal(master.master, true);
});

test('a class that is full, closed, empty, in another mode or without a price is refused', () => {
  const codeOf = (body, config = CONFIG) => { try { priceBooking(validateBooking(body, NOW), config); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(codeOf(form({ slot: 'TUE-3' })), 'class-full');
  assert.equal(codeOf(form({ slot: 'MON-1' })), 'class-unavailable');
  assert.equal(codeOf(form({ slot: 'FRI-3' })), 'class-unavailable');
  assert.equal(codeOf(form({ slot: 'SAT-3' })), 'class-unavailable', 'a slot that does not exist');
  assert.equal(codeOf(form({ slot: 'WED-1', mode: 'Online' })), 'mode-unavailable');
  assert.equal(codeOf(form({ slot: 'SAT-1', mode: 'Physical' })), 'mode-unavailable');
  assert.equal(codeOf(form(), { slots: CONFIG.slots }), 'price-not-set', 'no trial price set at all');
  assert.equal(codeOf(form({ kind: 'enrol' }), { trialPrice: 50, slots: CONFIG.slots }), 'enrol-unavailable');
  assert.equal(codeOf(form({ slot: 'SAT-1', mode: 'Online' })), 'ok');
});

test('validation refuses bad forms and return pages', () => {
  const bad = [null, [], form({ extra: 1 }), form({ slot: 'SUN-1' }), form({ slot: 'MON-4' }), form({ slot: '../x' }),
    form({ kind: 'free' }), form({ mode: 'Both' }), form({ parentName: '' }), form({ childName: 'A'.repeat(81) }),
    form({ childLevel2027: 'Primary 7' }), form({ email: 'nope' }), form({ email: 'a@b.c\nBcc: x@y.z' }),
    form({ whatsapp: '6123 4567' }), form({ whatsapp: '12345' }), form({ parentName: 'A\nB' }),
    form({ returnUrl: 'https://evil.example/schedule/' }), form({ returnUrl: ORIGIN + '/products/' }),
    form({ returnUrl: 'http://polymathlc.com.sg/schedule/' })];
  for (const body of bad) assert.throws(() => validateBooking(body, NOW), ShopError, JSON.stringify(body));
  const ok = validateBooking(form(), NOW);
  assert.equal(ok.whatsapp, '91234567');
  assert.equal(ok.email, 'parent@example.test');
  assert.equal(ok.earliestKey, '2026-10-29');
  assert.equal(validateBooking(form({ returnUrl: 'https://polymathlc.github.io/cer/schedule/index.html?x=1' }), NOW).returnBase,
    'https://polymathlc.github.io/cer/schedule/index.html');
  assert.equal(validateBooking(form({ earliestKey: '2031-01-01' }), NOW).earliestKey, '', 'a far-off date is dropped, not trusted');
  assert.equal(validateBooking(form({ earliestKey: 'soon' }), NOW).earliestKey, '');
  assert.equal(validateBooking(form({ kind: 'enrol' }), NOW).earliestKey, '', 'an enrolment has no trial date');
});

test('the Stripe session is one card line in SGD, marked as a schedule booking, back to /schedule', () => {
  const request = validateBooking(form(), NOW);
  const priced = priceBooking(request, CONFIG);
  const { record } = buildBookingCheckout(request, priced, 'ABC234', '192.0.2.10', NOW, hash);
  const params = bookingSessionParams(record);
  assert.equal(params.mode, 'payment');
  assert.deepEqual(params.payment_method_types, ['card']);
  assert.equal(params.customer_email, 'parent@example.test');
  assert.equal(params.line_items.length, 1);
  assert.equal(params.line_items[0].price_data.currency, 'sgd');
  assert.equal(params.line_items[0].price_data.unit_amount, 4000);
  assert.equal(params.line_items[0].price_data.product_data.name, 'Trial lesson: Primary 6 Science');
  assert.match(params.line_items[0].price_data.product_data.description, /Monday 7:00pm – 8:45pm · Online · for Ava Tan/);
  assert.equal(params.metadata.source, BOOKING_SOURCE);
  assert.equal(params.metadata.booking_code, 'ABC234');
  assert.equal(params.client_reference_id, 'ABC234');
  assert.equal(params.success_url, ORIGIN + '/schedule/?booking=ABC234&session={CHECKOUT_SESSION_ID}');
  assert.equal(params.cancel_url, ORIGIN + '/schedule/?booking=ABC234&cancelled=1');
  assert.equal(record.reference, 'TRIAL MON3 ABC234');
  assert.equal(record.booking.price, 40);
  assert.equal(record.booking.receiptURL, '');
});

/* ─── The endpoints ─── */

test('creating a booking checkout saves it, makes one Stripe session and returns its page', async () => {
  const h = harness();
  const res = await h.create();
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.match(res.body.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(res.body.total, 40);
  const code = res.body.code;
  assert.ok([...code].every(ch => ORDER_CODE_CHARS.includes(ch)) && code.length === 6);
  const saved = h.db.rows.get('shop_checkouts/' + code);
  assert.equal(saved.kind, 'booking');
  assert.equal(saved.totalCents, 4000);
  assert.equal(saved.sessionId, h.stripe.calls.length && [...h.stripe.sessions.keys()][0]);
  assert.equal(h.stripe.calls.length, 1);
  assert.equal(h.stripe.calls[0].idempotencyKey, 'polymath-schedule-' + code);
  assert.equal(h.db.rows.has('schedule_bookings/' + code), false, 'no booking until it is paid');
});

test('the schedule\'s current price is charged, not the one the page loaded', async () => {
  const h = harness();
  const rows = h.db.rows.get('schedule_config/main');
  rows.trialPriceOnline = 45;
  h.db.rows.set('schedule_config/main', rows);
  const res = await h.create();
  assert.equal(res.body.total, 45);
  assert.equal(h.stripe.calls[0].params.line_items[0].price_data.unit_amount, 4500);
});

test('a full class is refused with 409 and Stripe is never called', async () => {
  const h = harness();
  const res = await h.create(form({ slot: 'TUE-3' }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'class-full');
  assert.equal(h.stripe.calls.length, 0);
});

test('with card payment switched off on the products page, bookings cannot pay by card either', async () => {
  const h = harness(seed({ 'shop_settings/config': { cardPayments: false } }));
  const res = await h.create();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'card-payments-off');
  assert.equal(h.stripe.calls.length, 0);
});

test('CORS: other origins are refused and the preflight is answered', async () => {
  const h = harness();
  const refused = await h.create(form(), { headers: { origin: 'https://evil.example' } });
  assert.equal(refused.statusCode, 403);
  const preflight = await h.create(undefined, { method: 'OPTIONS' });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], ORIGIN);
});

test('one address may start ' + BOOKING_LIMITS.perIpHour + ' booking checkouts an hour', async () => {
  const h = harness();
  for (let i = 0; i < BOOKING_LIMITS.perIpHour; i++) assert.equal((await h.create()).statusCode, 201);
  const blocked = await h.create();
  assert.equal(blocked.statusCode, 429);
  h.advance(3600000);
  assert.equal((await h.create()).statusCode, 201);
});

test('status: unpaid, then paid, records the booking once and emails the centre and the parent once', async () => {
  const h = harness();
  const { body: { code } } = await h.create();
  const sessionId = [...h.stripe.sessions.keys()][0];
  const unpaid = await h.status({ code, sessionId });
  assert.deepEqual(unpaid.body, { ok: true, paid: false, state: 'open' });
  h.stripe.pay(sessionId);
  const paid = await h.status({ code, sessionId });
  assert.equal(paid.body.paid, true);
  assert.equal(paid.body.booking.code, code);
  assert.equal(paid.body.booking.price, 40);
  assert.equal(paid.body.booking.earliestKey, '2026-10-29');
  assert.equal(paid.body.booking.payment, 'card');
  const booking = h.db.rows.get('schedule_bookings/' + code);
  assert.equal(booking.status, 'pending', 'the admin still confirms the date');
  assert.equal(booking.payment, 'card');
  assert.equal(booking.paid, true);
  assert.equal(booking.kind, 'trial');
  assert.equal(booking.slot, 'MON-3');
  assert.equal(booking.slotLabel, 'Monday 7:00pm – 8:45pm');
  assert.equal(booking.mode, 'Online');
  assert.equal(booking.whatsapp, '91234567');
  assert.equal(booking.amountPaid, 40);
  assert.deepEqual(booking.paymentChecks, []);
  assert.equal(booking.confirmationSentTo, 'parent@example.test');
  assert.equal(h.db.rows.get('shop_checkouts/' + code).status, 'paid');
  // Asking again, or the webhook arriving late, changes nothing and sends nothing more.
  await h.status({ code, sessionId });
  const session = h.stripe.sessions.get(sessionId);
  const late = await h.webhookCall(completed(session));
  assert.equal(late.statusCode, 200);
  assert.equal(late.body.already, true);
  assert.deepEqual(mailsFor(h.db, code).sort(), ['mail/' + bookingMailId(code, 'admin'), 'mail/' + bookingMailId(code, 'parent')].sort());
  const admin = h.db.rows.get('mail/' + bookingMailId(code, 'admin'));
  assert.deepEqual(admin.to, NOTIFICATION_EMAILS);
  assert.match(admin.message.subject, /^New Trial Booking \(card paid\): Ava Tan — Monday 7:00pm – 8:45pm \(Science\)$/);
  const parent = h.db.rows.get('mail/' + bookingMailId(code, 'parent'));
  assert.deepEqual(parent.to, ['parent@example.test']);
  assert.equal(parent.replyTo, SENDER_EMAIL);
  assert.match(parent.message.text, /card payment of \$40\.00/);
  assert.match(parent.message.text, /earliest possible trial date for this class is Thursday 29 October 2026/);
});

test('status: a wrong session, a shop order code or an unknown code reads as not found', async () => {
  const h = harness();
  const { body: { code } } = await h.create();
  assert.equal((await h.status({ code, sessionId: 'cs_test_wrong00000' })).statusCode, 404);
  assert.equal((await h.status({ code: 'ZZZZZZ', sessionId: [...h.stripe.sessions.keys()][0] })).statusCode, 404);
  h.db.rows.set('shop_checkouts/SHPQ22', { code: 'SHPQ22', sessionId: 'cs_test_shop000000', status: 'open' });
  assert.equal((await h.status({ code: 'SHPQ22', sessionId: 'cs_test_shop000000' })).statusCode, 404, 'a shop checkout is not a booking');
  assert.equal((await h.status({ code, sessionId: 'not-a-session' })).statusCode, 400);
});

test('webhook: a paid booking session becomes a booking without the parent coming back', async () => {
  const h = harness();
  const { body: { code } } = await h.create(form({ slot: 'FRI-1', kind: 'enrol', mode: 'Physical', childLevel2027: 'Primary 5' }));
  const sessionId = [...h.stripe.sessions.keys()][0];
  h.stripe.pay(sessionId);
  const res = await h.webhookCall(completed(h.stripe.sessions.get(sessionId)));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.received, true);
  assert.equal(res.body.code, code);
  const booking = h.db.rows.get('schedule_bookings/' + code);
  assert.equal(booking.kind, 'enrol');
  assert.equal(booking.price, 260);
  assert.equal(booking.paymentRef, 'ENROL FRI1 ' + code);
  assert.equal(h.db.rows.has('shop_orders/' + code), false, 'never a shop order');
  const parent = h.db.rows.get('mail/' + bookingMailId(code, 'parent'));
  assert.match(parent.message.subject, /^Enrolment confirmed — Friday 3:00pm – 4:45pm \(paid \$260\.00\)$/);
  assert.match(parent.message.text, /admin staff will contact you to collect the monthly fees/);
  assert.doesNotMatch(parent.message.text, /trial date/i);
});

test('webhook: an unpaid booking session and an unknown booking are acknowledged and ignored', async () => {
  const h = harness();
  await h.create();
  const session = [...h.stripe.sessions.values()][0];
  const unpaid = await h.webhookCall(completed(session));
  assert.deepEqual(unpaid.body, { received: true, ignored: 'not-paid' });
  const stranger = Object.assign({}, session, { payment_status: 'paid', status: 'complete', client_reference_id: 'QQQQQQ',
    metadata: { source: BOOKING_SOURCE, booking_code: 'QQQQQQ' } });
  const unknown = await h.webhookCall(completed(stranger));
  assert.equal(unknown.statusCode, 200);
  assert.equal(unknown.body.ignored, 'unknown-booking');
});

test('webhook: an amount that does not match the booking is recorded but flagged for the centre', async () => {
  const h = harness();
  const { body: { code } } = await h.create();
  const sessionId = [...h.stripe.sessions.keys()][0];
  h.stripe.pay(sessionId);
  const session = Object.assign({}, h.stripe.sessions.get(sessionId), { amount_total: 100 });
  await h.webhookCall(completed(session));
  const booking = h.db.rows.get('schedule_bookings/' + code);
  assert.deepEqual(booking.paymentChecks, ['amount-mismatch']);
  assert.match(h.db.rows.get('mail/' + bookingMailId(code, 'admin')).message.text, /Please check this payment in Stripe: amount-mismatch/);
});

test('webhook: a storage failure on a booking answers 500 so Stripe retries', async () => {
  const h = harness();
  const { body: { code } } = await h.create();
  const sessionId = [...h.stripe.sessions.keys()][0];
  h.stripe.pay(sessionId);
  const original = h.db.runTransaction;
  h.db.runTransaction = () => Promise.reject(new Error('unavailable'));
  const res = await h.webhookCall(completed(h.stripe.sessions.get(sessionId)));
  h.db.runTransaction = original;
  assert.equal(res.statusCode, 500);
  assert.ok(h.logs.some(line => line.startsWith('stripe-webhook-storage-failed')));
  assert.equal(h.db.rows.has('schedule_bookings/' + code), false);
});

test('shop orders still go through the same webhook untouched', async () => {
  const h = harness(seed({ 'shop_products/book': { name: 'Notes', price: 10, quantity: null, active: true } }));
  const shopRes = await h.call(h.shop.createCheckout, {
    items: [{ productId: 'book', qty: 1 }], customer: { name: 'P', phone: '91234567', email: 'p@example.test' },
    fulfilment: 'collect', address: '', note: '', returnUrl: ORIGIN + '/products/', pageVersion: 'v1.4.0' });
  assert.equal(shopRes.statusCode, 201);
  const sessionId = [...h.stripe.sessions.keys()][0];
  h.stripe.pay(sessionId);
  const res = await h.webhookCall(completed(h.stripe.sessions.get(sessionId)));
  assert.equal(res.statusCode, 200);
  assert.equal(h.db.rows.get('shop_orders/' + shopRes.body.code).status, 'paid');
});

/* ─── The emails ─── */

test('the emails escape what the parent typed and leave out what is not there', () => {
  const booking = { kind: 'trial', classType: 'master', slot: 'THU-3', slotLabel: 'Thursday 7:00pm – 8:45pm', classLevel: 'P5',
    subject: 'Science', mode: 'Physical', parentName: '<b>Mum</b>', childName: 'Ava & Co', childLevel2027: 'Primary 5',
    email: 'mum@example.test', whatsapp: '91234567', price: 80, monthlyFee: 450, paymentRef: 'MASTER THU3 ABC234' };
  const parent = parentBookingMail(booking, { code: 'ABC234', earliestKey: '', now: NOW });
  assert.doesNotMatch(parent.message.html, /<b>Mum<\/b>/);
  assert.match(parent.message.html, /&lt;b&gt;Mum&lt;\/b&gt;/);
  assert.match(parent.message.html, /Ava &amp; Co/);
  assert.doesNotMatch(parent.message.text, /earliest possible trial date/, 'no date is promised when none was worked out');
  assert.match(parent.message.subject, /^Trial class booked — Thursday 7:00pm – 8:45pm \(paid \$80\.00\)$/);
  const admin = adminBookingMail(booking, { code: 'ABC234' });
  assert.match(admin.message.subject, /^New MASTER CLASS Trial \(card paid\)/);
  assert.equal(admin.replyTo, 'mum@example.test', 'the centre can reply straight to the parent');
  assert.equal(parentBookingMail(Object.assign({}, booking, { email: 'nope' }), { code: 'ABC234' }), null);
  assert.equal(fmtDayKey('2026-10-29'), 'Thursday 29 October 2026');
  assert.equal(fmtDayKey('soon'), '');
});
