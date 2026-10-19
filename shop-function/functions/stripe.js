'use strict';

// A small Stripe client for the two calls the shop needs, over the REST API with
// fetch and no SDK, plus webhook signature checking. Stripe takes form-encoded
// bodies with nested keys (line_items[0][price_data][currency]=sgd), which
// formEncode builds from a plain object.
const { createHmac, timingSafeEqual } = require('node:crypto');

const API = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_SECONDS = 300;

class StripeError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

function formEncode(value, prefix = '', out = []) {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => formEncode(item, prefix + '[' + index + ']', out));
  } else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) formEncode(item, prefix ? prefix + '[' + key + ']' : key, out);
  } else {
    out.push(encodeURIComponent(prefix) + '=' + encodeURIComponent(String(value)));
  }
  return out;
}
const encodeBody = value => formEncode(value).join('&');

function createStripe({ secretKey, fetchImpl = globalThis.fetch } = {}) {
  async function call(method, path, body, idempotencyKey) {
    if (!secretKey) throw new StripeError(503, 'stripe-not-configured');
    const headers = { Authorization: 'Bearer ' + secretKey, 'Stripe-Version': '2024-06-20' };
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let response;
    try {
      response = await fetchImpl(API + path, { method, headers, body: body ? encodeBody(body) : undefined });
    } catch {
      throw new StripeError(502, 'stripe-unreachable');
    }
    let json = null;
    try { json = await response.json(); } catch { /* an empty or broken body is handled below */ }
    if (!response.ok || !json) {
      // Stripe's own message can name the request's contents, so only its type and
      // code travel further, never the message.
      const error = json && json.error ? json.error : {};
      throw new StripeError(502, 'stripe-error', [error.type, error.code].filter(Boolean).join(':') || 'http-' + response.status);
    }
    return json;
  }
  return {
    createCheckoutSession: (params, idempotencyKey) => call('POST', '/checkout/sessions', params, idempotencyKey),
    retrieveCheckoutSession: id => call('GET', '/checkout/sessions/' + encodeURIComponent(id))
  };
}

// Stripe signs "<timestamp>.<raw body>" with the endpoint's whsec_ secret and sends
// "t=<timestamp>,v1=<hex>[,v1=<hex>...]" in the Stripe-Signature header. Any one
// v1 matching is enough (Stripe sends two while a secret is being rolled).
function verifyWebhook(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new StripeError(503, 'webhook-not-configured');
  if (!rawBody || typeof header !== 'string') throw new StripeError(400, 'signature-missing');
  const parts = header.split(',').map(part => part.trim().split('='));
  const timestamp = Number((parts.find(([key]) => key === 't') || [])[1]);
  const signatures = parts.filter(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/.test(value || '')).map(([, value]) => value);
  if (!Number.isFinite(timestamp) || !signatures.length) throw new StripeError(400, 'signature-malformed');
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) throw new StripeError(400, 'signature-too-old');
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(body).digest();
  const matches = signatures.some(signature => {
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matches) throw new StripeError(400, 'signature-mismatch');
  let event;
  try { event = JSON.parse(body.toString('utf8')); } catch { throw new StripeError(400, 'event-not-json'); }
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') throw new StripeError(400, 'event-malformed');
  return event;
}

// Only for tests: builds a header the way Stripe does.
function signWebhook(rawBody, secret, timestamp) {
  return 't=' + timestamp + ',v1=' + createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex');
}

module.exports = { createStripe, verifyWebhook, signWebhook, formEncode, encodeBody, StripeError, SIGNATURE_TOLERANCE_SECONDS };
