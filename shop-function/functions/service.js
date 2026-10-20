'use strict';

// Card payments for polymathlc.com.sg/products, through Stripe Checkout.
//
//   createShopCheckout   the page posts the cart and the parent's details; this
//                        prices every line again from shop_products (never from
//                        the browser), adds the flat delivery fee from
//                        shop_settings/config, saves the checkout under a new
//                        6-character order code and answers with Stripe's
//                        hosted payment page to send the parent to.
//   shopCheckoutStatus   the page calls this when Stripe sends the parent back;
//                        if Stripe says the session is paid, it records the order
//                        right away, so the parent sees "paid" even before the
//                        webhook lands (and even if the webhook is not set up).
//   stripeShopWebhook    Stripe calls this when a payment completes; the signature
//                        is checked against STRIPE_WEBHOOK_SECRET first.
//   sendShopReceipt      the admin page calls this (with the admin's Firebase
//                        sign-in) to email a paid order's receipt: a PayNow order's
//                        when it is marked paid, or any paid order's again.
//
// A card order's receipt is emailed by finalize() itself (see receipt.js), from
// Polymath Learning Centre <admin@polymathlc.com.sg>.
//
// Both paths end in the same idempotent repository.finalize(), which writes the
// shop_orders/{code} order as paid and takes the stock out exactly the way the
// admin's "Mark paid" button does (unlimited stock untouched, never below zero,
// stockApplied:true), so whichever of them comes first wins and the other is a
// no-op.
const { createHash, randomInt } = require('node:crypto');
const { StripeError, verifyWebhook } = require('./stripe');

// The same pages that may post enquiries: the public site and its github.io copy.
const ORIGINS = Object.freeze(['https://polymathlc.com.sg', 'https://www.polymathlc.com.sg', 'https://polymathlc.github.io']);
// Where the shop page is served on those origins. Stripe sends the parent back here.
const RETURN_PATH = /^\/(?:cer\/)?products\/(?:index\.html)?$/;
const CURRENCY = 'sgd';
const SOURCE = 'polymath-shop';
const ORDER_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LIMITS = Object.freeze({
  bodyBytes: 16384, lines: 50, qtyPerLine: 99,
  perIpHour: 20, globalDay: 400,
  // Stripe refuses SGD charges under $0.50, and the shop has no business above this.
  minimumCents: 50, maximumCents: 1000000
});
const HOUR = 3600000, DAY = 86400000;
// A Checkout Session must live at least 30 minutes; an hour gives a parent time to
// find their card without leaving a stale price payable for long.
const SESSION_MS = 60 * 60000;
// Unpaid checkouts are kept a week so a late webhook still finds them, then swept.
const CHECKOUT_RETENTION_MS = 7 * DAY;
const CHECKOUT_COLLECTION = 'shop_checkouts';
const LIMIT_COLLECTION = 'shop_checkout_limits';
const ORDER_COLLECTION = 'shop_orders';
const PRODUCT_COLLECTION = 'shop_products';
const SETTINGS_DOC = ['shop_settings', 'config'];
const PAID_EVENTS = Object.freeze(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
// Only this Google account may send receipts; it is the products page's ADMIN_EMAIL.
const ADMIN_EMAIL = 'chungzhikai@gmail.com';
// Pressing "Email receipt" twice by accident sends one email.
const RECEIPT_GAP_MS = 60000;
const hash = value => createHash('sha256').update(value).digest('hex');

class ShopError extends Error {
  constructor(status, code, detail) { super(code); this.status = status; this.code = code; this.detail = detail; }
}
function fail(code = 'invalid-checkout') { throw new ShopError(400, code); }
function text(value, max, min = 0) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail();
  const result = value.replace(/\r\n?/g, '\n').trim();
  if (result.length < min || result.length > max) fail();
  return result;
}
function oneLine(value, max, min = 0) {
  const result = text(value, max, min);
  if (/\n/.test(result)) fail();
  return result;
}
// The page's own buildRef('PLC', code): the PayNow and card orders read the same.
const referenceFor = code => 'PLC ' + code;
function newOrderCode(random = randomInt) {
  let code = '';
  for (let i = 0; i < 6; i++) code += ORDER_CODE_CHARS[random(ORDER_CODE_CHARS.length)];
  return code;
}
function validCode(value) {
  return typeof value === 'string' && value.length === 6 && [...value].every(ch => ORDER_CODE_CHARS.includes(ch));
}
// Firestore prices are dollars as numbers (old schedule/ docs may hold strings).
function toCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100);
}
const dollars = cents => Math.round(cents) / 100;
function unlimited(quantity) { return quantity === null || quantity === undefined || quantity === ''; }

function returnBase(value) {
  let url;
  try { url = new URL(oneLine(value, 300, 1)); } catch (error) { if (error instanceof ShopError) throw error; fail(); }
  if (!ORIGINS.includes(url.origin) || !RETURN_PATH.test(url.pathname)) fail('return-url-not-allowed');
  return url.origin + url.pathname;
}

function validateCheckout(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  const keys = new Set(['items', 'customer', 'fulfilment', 'address', 'note', 'returnUrl', 'pageVersion']);
  if (Object.keys(body).some(key => !keys.has(key))) fail();
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > LIMITS.lines) fail('cart-empty');
  // The same product on two lines is merged, as the page's cart would do.
  const wanted = new Map();
  for (const item of body.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail();
    const productId = oneLine(item.productId, 128, 1);
    if (productId.includes('/') || productId === '.' || productId === '..' || /^__.*__$/.test(productId)) fail();
    const qty = item.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.qtyPerLine) fail();
    wanted.set(productId, Math.min(LIMITS.qtyPerLine, (wanted.get(productId) || 0) + qty));
  }
  const customer = body.customer;
  if (!customer || typeof customer !== 'object' || Array.isArray(customer)) fail();
  if (Object.keys(customer).some(key => !['name', 'phone', 'email'].includes(key))) fail();
  const name = oneLine(customer.name, 80, 1);
  const phone = oneLine(customer.phone, 20, 1);
  const digits = phone.replace(/\D/g, '');
  if (!/^\+?[0-9 ()-]+$/.test(phone) || digits.length < 8 || digits.length > 15) fail('invalid-phone');
  // Required: Stripe emails the card receipt to it.
  const email = oneLine(customer.email, 120).toLowerCase();
  if (!email || !/^[^\s@<>(),;:\\"]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(email)) fail('invalid-email');
  const fulfilment = body.fulfilment === undefined ? 'collect' : body.fulfilment;
  if (!['collect', 'delivery'].includes(fulfilment)) fail();
  const address = fulfilment === 'delivery' ? text(body.address, 300, 1) : '';
  const note = oneLine(body.note, 300);
  const pageVersion = oneLine(body.pageVersion, 20);
  return {
    items: [...wanted].map(([productId, qty]) => ({ productId, qty })),
    customer: { name, phone, email }, fulfilment, address, note, pageVersion,
    returnBase: returnBase(body.returnUrl)
  };
}

// Prices the cart from the products as they are in Firestore now. Anything the
// parent can no longer buy (removed, hidden, sold out, fewer left than asked for,
// no valid price) is reported back by product id, so the page can refresh the cart
// and say which line changed instead of charging for something we cannot send.
function priceCheckout(request, products, settings) {
  const problems = [];
  const lines = request.items.map(({ productId, qty }) => {
    const product = products.get(productId);
    if (!product || product.active === false) { problems.push({ productId, reason: 'unavailable' }); return null; }
    const unitCents = toCents(product.price);
    if (unitCents === null || unitCents <= 0) { problems.push({ productId, reason: 'unavailable' }); return null; }
    if (!unlimited(product.quantity)) {
      const left = Math.max(0, Math.floor(Number(product.quantity) || 0));
      if (left < qty) { problems.push({ productId, reason: left ? 'not-enough-stock' : 'sold-out', left }); return null; }
    }
    return {
      productId, qty, unitCents, lineCents: unitCents * qty,
      sku: typeof product.sku === 'string' ? product.sku.slice(0, 60) : '',
      name: (typeof product.name === 'string' && product.name.trim() ? product.name.trim() : 'Polymath product').slice(0, 200),
      image: Array.isArray(product.images) && product.images[0] && typeof product.images[0].url === 'string'
        && /^https:\/\//.test(product.images[0].url) && product.images[0].url.length <= 2000 ? product.images[0].url : ''
    };
  });
  if (problems.length) throw new ShopError(409, 'cart-changed', problems);
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  const feeCents = request.fulfilment === 'delivery' ? Math.max(0, toCents(settings && settings.deliveryFee) || 0) : 0;
  const totalCents = subtotalCents + feeCents;
  if (totalCents < LIMITS.minimumCents) throw new ShopError(400, 'total-too-small');
  if (totalCents > LIMITS.maximumCents) throw new ShopError(400, 'total-too-large');
  return { lines, subtotalCents, feeCents, totalCents };
}

// The order exactly as the page writes a PayNow order, so the admin's list, search,
// WhatsApp text and status buttons all work on it unchanged.
function orderItems(priced) {
  return priced.lines.map(line => ({ productId: line.productId, sku: line.sku, name: line.name,
    price: dollars(line.unitCents), qty: line.qty, lineTotal: dollars(line.lineCents) }));
}

function buildCheckout(request, priced, code, ip, now) {
  const hour = Math.floor(now / HOUR), day = Math.floor(now / DAY);
  return {
    code, now,
    quotas: [
      { id: 'ip-' + hash(ip) + '-' + hour, maximum: LIMITS.perIpHour, expiresAt: (hour + 1) * HOUR + DAY },
      { id: 'global-' + day, maximum: LIMITS.globalDay, expiresAt: (day + 2) * DAY }
    ],
    record: {
      code, reference: referenceFor(code), status: 'open', source: SOURCE,
      items: orderItems(priced), subtotal: dollars(priced.subtotalCents), deliveryFee: dollars(priced.feeCents),
      total: dollars(priced.totalCents), totalCents: priced.totalCents, currency: CURRENCY,
      customer: request.customer, fulfilment: request.fulfilment, address: request.address, note: request.note,
      pageVersion: request.pageVersion, returnBase: request.returnBase,
      createdAt: now, sessionExpiresAt: now + SESSION_MS, deleteAt: now + CHECKOUT_RETENTION_MS
    }
  };
}

function sessionParams(record, priced) {
  const lineItems = priced.lines.map(line => ({
    quantity: line.qty,
    price_data: {
      currency: CURRENCY, unit_amount: line.unitCents,
      product_data: Object.assign({ name: line.name },
        line.sku ? { description: 'SKU ' + line.sku } : {},
        line.image ? { images: [line.image] } : {})
    }
  }));
  if (priced.feeCents > 0) lineItems.push({ quantity: 1, price_data: { currency: CURRENCY, unit_amount: priced.feeCents,
    product_data: { name: 'Delivery fee (flat)' } } });
  const metadata = { source: SOURCE, order_code: record.code, reference: record.reference };
  const back = record.returnBase + '?order=' + record.code;
  return {
    mode: 'payment',
    payment_method_types: ['card'],
    submit_type: 'pay',
    client_reference_id: record.code,
    customer_email: record.customer.email || undefined,
    line_items: lineItems,
    metadata,
    payment_intent_data: { description: 'Polymath order ' + record.code + ' (' + record.reference + ')', metadata },
    // Stripe swaps {CHECKOUT_SESSION_ID} for the real id when it sends the parent back.
    success_url: back + '&session={CHECKOUT_SESSION_ID}',
    cancel_url: back + '&cancelled=1',
    expires_at: Math.floor(record.sessionExpiresAt / 1000)
  };
}

// What the page may show the parent about their own order once it is paid. The
// session id they hold is the proof it is theirs, so their own details come back
// (the page needs them for the WhatsApp message), but nothing about anyone else.
function publicOrder(order) {
  return {
    code: order.code, reference: order.reference, status: order.status, payment: 'card',
    items: order.items, subtotal: order.subtotal, deliveryFee: order.deliveryFee, total: order.total,
    customer: order.customer, fulfilment: order.fulfilment, address: order.address, note: order.note
  };
}

function paymentFromSession(session) {
  return {
    sessionId: session.id,
    paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent
      : session.payment_intent && session.payment_intent.id ? session.payment_intent.id : '',
    amountTotal: Number(session.amount_total) || 0,
    currency: String(session.currency || '').toLowerCase()
  };
}
const sessionIsPaid = session => session && session.payment_status === 'paid'
  && (session.status === 'complete' || session.status === undefined);
const sessionIsOurs = session => session && session.metadata && session.metadata.source === SOURCE;
const sessionCode = session => session && (session.client_reference_id || (session.metadata && session.metadata.order_code));

// Old checkouts and rate-limit counters are swept from inside createShopCheckout,
// at most once an hour per instance and a few pages at a time, rather than by a
// scheduled function: the deploy account may not manage Cloud Scheduler jobs.
const SWEEP_EVERY_MS = HOUR;
const SWEEP_PAGES = 2;

// The Firebase ID token from "Authorization: Bearer …", checked by verifyIdToken
// (firebase-admin in production). Anyone but the signed-in admin is refused.
async function adminFrom(req, verifyIdToken) {
  const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(req.get('authorization') || '');
  if (!match) throw new ShopError(401, 'sign-in-required');
  let claims;
  try { claims = await verifyIdToken(match[1]); } catch { throw new ShopError(401, 'sign-in-required'); }
  if (!claims || claims.email !== ADMIN_EMAIL || claims.email_verified !== true) throw new ShopError(403, 'admin-only');
  return claims.email;
}

function createService({ repository, stripe, webhookSecret, verifyIdToken = async () => { throw new Error('no auth'); },
  now = Date.now, random = randomInt, report = () => {} }) {
  let lastSweep = -Infinity;
  async function sweep() {
    const at = now();
    if (at - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = at;
    // Never lets a cleanup problem cost a parent their checkout.
    try { await repository.cleanup(at, SWEEP_PAGES); } catch { report('shop-sweep-failed'); }
  }
  function cors(req, res) {
    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Origin');
    const origin = req.get('origin');
    if (!ORIGINS.includes(origin)) { res.status(403).json({ ok: false, error: 'origin-not-allowed' }); return false; }
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return false; }
    if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method-not-allowed' }); return false; }
    if (!/^application\/json(?:\s*;|$)/i.test(req.get('content-type') || '')) {
      res.status(415).json({ ok: false, error: 'json-required' }); return false;
    }
    const size = req.rawBody ? req.rawBody.length : Buffer.byteLength(JSON.stringify(req.body ?? null));
    if (size > LIMITS.bodyBytes) { res.status(413).json({ ok: false, error: 'checkout-too-large' }); return false; }
    return true;
  }
  function answerError(res, error, fallback) {
    if (error instanceof ShopError) {
      if (error.status === 429) res.set('Retry-After', error.code === 'receipt-just-sent' ? '60' : '3600');
      return res.status(error.status).json(Object.assign({ ok: false, error: error.code }, error.detail ? { problems: error.detail } : {}));
    }
    if (error instanceof StripeError) {
      report(error.code + (error.message && error.message !== error.code ? ' ' + error.message : ''));
      return res.status(error.status === 503 ? 503 : 502).json({ ok: false, error: error.code === 'stripe-not-configured' ? 'card-payments-off' : 'stripe-unavailable' });
    }
    // Do not log carts, names, phone numbers or provider errors.
    report(fallback);
    return res.status(503).json({ ok: false, error: 'temporarily-unavailable' });
  }

  async function createCheckout(req, res) {
    if (!cors(req, res)) return;
    try {
      const request = validateCheckout(req.body);
      const { products, settings } = await repository.loadCatalogue(request.items.map(item => item.productId));
      // The admin's "Hide card payment" switch on the products page.
      if (settings && settings.cardPayments === false) throw new ShopError(503, 'card-payments-off');
      const priced = priceCheckout(request, products, settings);
      const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
      const at = now();
      const { code, record } = await repository.reserveCheckout(
        attemptCode => buildCheckout(request, priced, attemptCode, ip, at), () => newOrderCode(random));
      // The order code doubles as the idempotency key: a retried call never makes a
      // second session for the same checkout.
      const session = await stripe.createCheckoutSession(sessionParams(record, priced), 'polymath-shop-' + code);
      if (!session || typeof session.url !== 'string' || typeof session.id !== 'string') throw new StripeError(502, 'stripe-error', 'no-session-url');
      await repository.attachSession(code, session.id);
      await sweep();
      return res.status(201).json({ ok: true, code, reference: record.reference, total: record.total, url: session.url });
    } catch (error) {
      return answerError(res, error, 'shop-checkout-failed');
    }
  }

  async function finalizeFromSession(code, session) {
    return repository.finalize(code, paymentFromSession(session), now());
  }

  async function checkoutStatus(req, res) {
    if (!cors(req, res)) return;
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
      if (Object.keys(body).some(key => !['code', 'sessionId'].includes(key))) fail();
      const code = body.code, sessionId = body.sessionId;
      if (!validCode(code) || typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]{8,250}$/.test(sessionId)) fail();
      const checkout = await repository.getCheckout(code);
      // An unknown code and a wrong session look the same, so codes cannot be probed.
      if (!checkout || checkout.sessionId !== sessionId) throw new ShopError(404, 'checkout-not-found');
      const existing = await repository.getOrder(code);
      if (existing && existing.payment === 'card') return res.status(200).json({ ok: true, paid: true, order: publicOrder(existing) });
      const session = await stripe.retrieveCheckoutSession(sessionId);
      if (!sessionIsOurs(session) || sessionCode(session) !== code) throw new ShopError(404, 'checkout-not-found');
      if (!sessionIsPaid(session)) return res.status(200).json({ ok: true, paid: false, state: String(session.status || 'open') });
      const result = await finalizeFromSession(code, session);
      return res.status(200).json({ ok: true, paid: true, order: publicOrder(result.order) });
    } catch (error) {
      return answerError(res, error, 'shop-status-failed');
    }
  }

  async function webhook(req, res) {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ received: false });
    let event;
    try {
      event = verifyWebhook(req.rawBody, req.get('stripe-signature'), webhookSecret, Math.floor(now() / 1000));
    } catch (error) {
      if (error instanceof StripeError && error.status === 503) { report('stripe-webhook-secret-missing'); return res.status(503).json({ received: false }); }
      report('stripe-webhook-rejected ' + (error.code || 'unknown'));
      return res.status(400).json({ received: false, error: error.code || 'bad-signature' });
    }
    // Everything below answers 200 unless storage fails, so Stripe stops retrying
    // events that are not ours or not for a payment.
    if (!PAID_EVENTS.includes(event.type)) return res.status(200).json({ received: true, ignored: 'event-type' });
    const session = event.data && event.data.object;
    if (!sessionIsOurs(session)) return res.status(200).json({ received: true, ignored: 'not-shop' });
    if (!sessionIsPaid(session)) return res.status(200).json({ received: true, ignored: 'not-paid' });
    const code = sessionCode(session);
    if (!validCode(code)) return res.status(200).json({ received: true, ignored: 'no-order-code' });
    try {
      const result = await finalizeFromSession(code, session);
      if (result.missing) { report('stripe-webhook-unknown-checkout'); return res.status(200).json({ received: true, ignored: 'unknown-checkout' }); }
      return res.status(200).json({ received: true, code, already: !!result.already });
    } catch (error) {
      report('stripe-webhook-storage-failed');
      return res.status(500).json({ received: false });
    }
  }

  async function sendReceipt(req, res) {
    if (!cors(req, res)) return;
    try {
      await adminFrom(req, verifyIdToken);
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'code')) fail();
      // PayNow codes are made by the page with the same alphabet; older ones may differ
      // slightly, so any short document id of letters and digits is accepted.
      if (typeof body.code !== 'string' || !/^[A-Z0-9]{4,12}$/.test(body.code)) fail();
      const sent = await repository.sendReceipt(body.code, now(), RECEIPT_GAP_MS);
      return res.status(200).json({ ok: true, sentTo: sent.to, count: sent.count, resend: sent.resend });
    } catch (error) {
      return answerError(res, error, 'shop-receipt-failed');
    }
  }

  return { createCheckout, checkoutStatus, webhook, sendReceipt, cleanup: () => repository.cleanup(now()), sweep };
}

module.exports = {
  ORIGINS, RETURN_PATH, ADMIN_EMAIL, RECEIPT_GAP_MS, SWEEP_EVERY_MS, SWEEP_PAGES, CURRENCY, SOURCE, LIMITS, SESSION_MS, CHECKOUT_RETENTION_MS, ORDER_CODE_CHARS, PAID_EVENTS,
  CHECKOUT_COLLECTION, LIMIT_COLLECTION, ORDER_COLLECTION, PRODUCT_COLLECTION, SETTINGS_DOC,
  ShopError, validateCheckout, priceCheckout, buildCheckout, sessionParams, publicOrder, paymentFromSession,
  newOrderCode, validCode, referenceFor, toCents, unlimited, createService
};
