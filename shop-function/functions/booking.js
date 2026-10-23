'use strict';

// Card payments for trial lessons and enrolments on polymathlc.com.sg/schedule,
// through the same Stripe account, keys and webhook as the /products shop.
//
//   createScheduleCheckout   the booking form posts the class (slot id), trial or
//                            enrol, how the child attends and the parent's details.
//                            The price is worked out HERE from schedule_config/main,
//                            exactly as the page's trialPriceFor()/monthlyFeeFor()
//                            do, never taken from the browser. The checkout is
//                            saved under a fresh 6-character booking code and the
//                            answer is Stripe's hosted payment page.
//   scheduleCheckoutStatus   the page calls this when Stripe sends the parent back;
//                            once Stripe says the session is paid, the booking is
//                            recorded straight away.
//   stripeShopWebhook        (service.js) hands a paid session whose metadata says
//                            source 'polymath-schedule' to handlePaidSession here,
//                            so a parent who closes the tab after paying is still
//                            booked. No new Stripe webhook is needed.
//
// Both paths end in the same idempotent repository.finalizeBooking(), which writes
// schedule_bookings/{code} in the shape the page's PayNow booking uses (so the
// admin's list works unchanged), with payment:'card', and emails the centre and
// the parent in the same transaction, so each email goes out exactly once.
const { ShopError, LIMITS, CURRENCY, ORIGINS, SESSION_MS, CHECKOUT_RETENTION_MS, newOrderCode, validCode,
  paymentFromSession, toCents } = require('./service');
const { StripeError } = require('./stripe');

const BOOKING_SOURCE = 'polymath-schedule';
const BOOKING_COLLECTION = 'schedule_bookings';
const SCHEDULE_DOC = ['schedule_config', 'main'];
// Where the schedule page is served on the allowed origins. Stripe sends the parent back here.
const SCHEDULE_RETURN_PATH = /^\/(?:cer\/)?schedule\/(?:index\.html)?$/;
const HOUR = 3600000, DAY = 86400000;
// Bookings share the shop's per-IP and daily checkout limits, under their own names.
const BOOKING_LIMITS = Object.freeze({ perIpHour: 10, globalDay: 200 });

// ─── The timetable, as the page has it (schedule/index.html "Fixed weekly timetable") ───
const WEEKDAY_TIMES = ['3:00pm – 4:45pm', '5:00pm – 6:45pm', '7:00pm – 8:45pm'];
const SATURDAY_TIMES = ['9:00am – 10:45am', '11:00am – 12:45pm', '1:00pm – 2:45pm'];
const DAY_NAMES = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' };
const SLOT_ID = /^(MON|TUE|WED|THU|FRI|SAT)-([123])$/;
const LEVEL_NAMES = Object.freeze(['Primary 3', 'Primary 4', 'Primary 5', 'Primary 6']);
const KINDS = Object.freeze(['trial', 'enrol']);
const MODES = Object.freeze(['Physical', 'Online']);

function slotLabel(id) {
  const match = SLOT_ID.exec(id);
  if (!match) return id;
  const times = match[1] === 'SAT' ? SATURDAY_TIMES : WEEKDAY_TIMES;
  return DAY_NAMES[match[1]] + ' ' + times[Number(match[2]) - 1];
}

// ─── Prices: a line-for-line copy of the page's, so the card and PayNow agree ───
// A fee left blank means "not set". Dollars, rounded to cents.
function feeNum(value) { const n = parseFloat(value); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; }
const isMaster = slot => !!slot && slot.type === 'master';
const slotMode = slot => (isMaster(slot) ? 'Physical' : slot.mode);
function slotModes(slot) {
  const mode = slot ? slotMode(slot) : '';
  return mode === 'Both' ? ['Physical', 'Online'] : [mode === 'Online' ? 'Online' : 'Physical'];
}
function trialPriceFor(config, slot, mode) {
  const physical = Number(config.trialPrice) || 0;
  if (isMaster(slot)) return feeNum(config.masterTrialPrice) || physical;
  if ((mode || slotModes(slot)[0]) === 'Online') return feeNum(config.trialPriceOnline) || physical;
  return physical;
}
function monthlyFeeFor(config, slot, mode) {
  const own = key => (slot ? feeNum(slot[key]) : 0);
  if (isMaster(slot)) return own('fee') || feeNum(config.masterMonthlyFee);
  const physical = own('fee') || feeNum(config.monthlyFee);
  if ((mode || slotModes(slot)[0]) === 'Online') return own('feeOnline') || feeNum(config.monthlyFeeOnline) || physical;
  return physical;
}
const enrolModes = (config, slot) => slotModes(slot).filter(mode => monthlyFeeFor(config, slot, mode) > 0);

// The slot as the page reads it (getSlot): missing fields take the page's defaults.
function readSlot(config, id) {
  const slots = config && config.slots && typeof config.slots === 'object' ? config.slots : {};
  return Object.assign({ level: '', subject: '', mode: 'Both', status: 'closed', note: '', type: 'regular', fee: '', feeOnline: '' }, slots[id] || {});
}

// ─── Validation ───
function fail(code = 'invalid-booking') { throw new ShopError(400, code); }
function oneLine(value, max, min = 0) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) fail();
  const result = value.trim();
  if (result.length < min || result.length > max) fail();
  return result;
}
// The page's normalizeSgMobile + isValidSgMobile: 8 digits starting 8 or 9, a +65 allowed.
function sgMobile(value) {
  const digits = oneLine(value, 24, 1).replace(/\D/g, '');
  const local = digits.length === 10 && digits.startsWith('65') ? digits.slice(2) : digits;
  if (!/^[89]\d{7}$/.test(local)) fail('invalid-whatsapp');
  return local;
}
function returnBase(value) {
  let url;
  try { url = new URL(oneLine(value, 300, 1)); } catch (error) { if (error instanceof ShopError) throw error; fail(); }
  if (!ORIGINS.includes(url.origin) || !SCHEDULE_RETURN_PATH.test(url.pathname)) fail('return-url-not-allowed');
  return url.origin + url.pathname;
}
// The earliest trial date the page worked out (its holiday list lives there). It
// only ever reaches the emails as words, so a day key a few weeks either side of
// today is accepted and anything else is quietly dropped.
function earliestKey(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const at = Date.parse(value + 'T00:00:00+08:00');
  if (!Number.isFinite(at) || at < now - 2 * DAY || at > now + 70 * DAY) return '';
  return value;
}

function validateBooking(body, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  const keys = new Set(['slot', 'kind', 'mode', 'parentName', 'childName', 'childLevel2027', 'email', 'whatsapp',
    'earliestKey', 'returnUrl', 'pageVersion']);
  if (Object.keys(body).some(key => !keys.has(key))) fail();
  const slot = oneLine(body.slot, 8, 1);
  if (!SLOT_ID.test(slot)) fail('unknown-class');
  const kind = body.kind === undefined ? 'trial' : body.kind;
  if (!KINDS.includes(kind)) fail();
  if (!MODES.includes(body.mode)) fail();
  const parentName = oneLine(body.parentName, 80, 1);
  const childName = oneLine(body.childName, 80, 1);
  const childLevel2027 = oneLine(body.childLevel2027, 20, 1);
  if (!LEVEL_NAMES.includes(childLevel2027)) fail();
  const email = oneLine(body.email, 120, 1).toLowerCase();
  if (!/^[^\s@<>(),;:\\"]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(email)) fail('invalid-email');
  return {
    slot, kind, mode: body.mode, parentName, childName, childLevel2027, email,
    whatsapp: sgMobile(body.whatsapp),
    earliestKey: kind === 'trial' ? earliestKey(body.earliestKey, now) : '',
    pageVersion: oneLine(body.pageVersion, 20),
    returnBase: returnBase(body.returnUrl)
  };
}

// Prices the booking from the schedule as it is in Firestore now. A class that
// has closed, filled up, changed mode or lost its fee since the page loaded is
// refused with a code the page turns into words.
function priceBooking(request, config) {
  const slot = readSlot(config, request.slot);
  if (slot.status === 'full') throw new ShopError(409, 'class-full');
  if (slot.status !== 'open' || !slot.level || !slot.subject) throw new ShopError(409, 'class-unavailable');
  const mode = isMaster(slot) ? 'Physical' : request.mode;
  const allowed = request.kind === 'enrol' ? enrolModes(config, slot) : slotModes(slot);
  if (!allowed.includes(mode)) throw new ShopError(409, request.kind === 'enrol' ? 'enrol-unavailable' : 'mode-unavailable');
  const amount = request.kind === 'enrol' ? monthlyFeeFor(config, slot, mode) : trialPriceFor(config, slot, mode);
  const amountCents = toCents(amount);
  if (amountCents === null || amountCents < LIMITS.minimumCents) throw new ShopError(409, 'price-not-set');
  if (amountCents > LIMITS.maximumCents) throw new ShopError(400, 'total-too-large');
  const master = isMaster(slot);
  return {
    slot, mode, master, amountCents, amount: amountCents / 100,
    monthlyFee: monthlyFeeFor(config, slot, mode) || null,
    label: slotLabel(request.slot)
  };
}

// The PayNow reference the page builds (bookingRef), with the booking code in
// place of the parent's name, so the admin sees the same kind of reference.
function referenceFor(request, priced, code) {
  const kind = request.kind === 'enrol' ? 'ENROL' : priced.master ? 'MASTER' : 'TRIAL';
  return (kind + ' ' + request.slot.replace('-', '') + ' ' + code).slice(0, 25);
}

// What a parent is paying for, in words, for Stripe's page and the bank statement.
function itemName(request, priced) {
  const what = request.kind === 'enrol'
    ? (priced.master ? 'Master Class enrolment, first month' : 'Enrolment, first month')
    : (priced.master ? 'Master Class trial lesson' : 'Trial lesson');
  return what + ': ' + priced.slot.level.replace('P', 'Primary ') + ' ' + priced.slot.subject;
}
const itemDescription = (request, priced) => priced.label + ' · ' + priced.mode + ' · for ' + request.childName;

// The booking exactly as the page writes a PayNow one (submitBooking), plus the card fields.
function bookingFields(request, priced, reference) {
  return {
    slot: request.slot, slotLabel: priced.label,
    classLevel: priced.slot.level, subject: priced.slot.subject, slotMode: slotMode(priced.slot), mode: priced.mode,
    classType: priced.master ? 'master' : 'regular',
    kind: request.kind,
    monthlyFee: priced.monthlyFee,
    parentName: request.parentName, childName: request.childName, childLevel2027: request.childLevel2027,
    email: request.email, whatsapp: request.whatsapp,
    price: priced.amount,
    paymentRef: reference,
    receiptURL: '', receiptFilename: ''
  };
}

function buildBookingCheckout(request, priced, code, ip, now, hashIp) {
  const hour = Math.floor(now / HOUR), day = Math.floor(now / DAY);
  const reference = referenceFor(request, priced, code);
  return {
    code, now,
    quotas: [
      { id: 'booking-ip-' + hashIp(ip) + '-' + hour, maximum: BOOKING_LIMITS.perIpHour, expiresAt: (hour + 1) * HOUR + DAY },
      { id: 'booking-global-' + day, maximum: BOOKING_LIMITS.globalDay, expiresAt: (day + 2) * DAY }
    ],
    record: {
      code, kind: 'booking', reference, status: 'open', source: BOOKING_SOURCE,
      booking: bookingFields(request, priced, reference),
      itemName: itemName(request, priced), itemDescription: itemDescription(request, priced),
      earliestKey: request.earliestKey,
      total: priced.amount, totalCents: priced.amountCents, currency: CURRENCY,
      pageVersion: request.pageVersion, returnBase: request.returnBase,
      createdAt: now, sessionExpiresAt: now + SESSION_MS, deleteAt: now + CHECKOUT_RETENTION_MS
    }
  };
}

function bookingSessionParams(record) {
  const metadata = { source: BOOKING_SOURCE, booking_code: record.code, reference: record.reference, slot: record.booking.slot };
  const back = record.returnBase + '?booking=' + record.code;
  return {
    mode: 'payment',
    payment_method_types: ['card'],
    submit_type: record.booking.kind === 'enrol' ? 'pay' : 'book',
    client_reference_id: record.code,
    customer_email: record.booking.email,
    line_items: [{ quantity: 1, price_data: { currency: CURRENCY, unit_amount: record.totalCents,
      product_data: { name: record.itemName, description: record.itemDescription } } }],
    metadata,
    payment_intent_data: { description: 'Polymath ' + record.booking.kind + ' ' + record.code + ' (' + record.reference + ')', metadata },
    // Stripe swaps {CHECKOUT_SESSION_ID} for the real id when it sends the parent back.
    success_url: back + '&session={CHECKOUT_SESSION_ID}',
    cancel_url: back + '&cancelled=1',
    expires_at: Math.floor(record.sessionExpiresAt / 1000)
  };
}

// What the page may show the parent about their own booking once it is paid.
// Holding the session id is the proof the booking is theirs.
function publicBooking(booking, code, earliest) {
  return {
    code, kind: booking.kind, classType: booking.classType, slot: booking.slot, slotLabel: booking.slotLabel,
    classLevel: booking.classLevel, subject: booking.subject, mode: booking.mode,
    parentName: booking.parentName, childName: booking.childName, price: booking.price,
    monthlyFee: booking.monthlyFee || null, paymentRef: booking.paymentRef, payment: 'card',
    earliestKey: earliest || ''
  };
}

const sessionIsPaid = session => session && session.payment_status === 'paid'
  && (session.status === 'complete' || session.status === undefined);
const sessionIsBooking = session => !!(session && session.metadata && session.metadata.source === BOOKING_SOURCE);
const sessionCode = session => session && (session.client_reference_id || (session.metadata && session.metadata.booking_code));

function createBookingService({ repository, stripe, http, hashIp, now = Date.now, random, report = () => {} }) {
  async function createCheckout(req, res) {
    if (!http.cors(req, res)) return;
    try {
      const at = now();
      const request = validateBooking(req.body, at);
      const { config, settings } = await repository.loadSchedule();
      // The admin's "Hide card payment" switch on the products page covers bookings too.
      if (settings && settings.cardPayments === false) throw new ShopError(503, 'card-payments-off');
      const priced = priceBooking(request, config || {});
      const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
      const { code, record } = await repository.reserveCheckout(
        attemptCode => buildBookingCheckout(request, priced, attemptCode, ip, at, hashIp),
        () => newOrderCode(random), BOOKING_COLLECTION);
      // The booking code doubles as the idempotency key: a retried call never makes
      // a second session for the same booking.
      const session = await stripe.createCheckoutSession(bookingSessionParams(record), 'polymath-schedule-' + code);
      if (!session || typeof session.url !== 'string' || typeof session.id !== 'string') throw new StripeError(502, 'stripe-error', 'no-session-url');
      await repository.attachSession(code, session.id);
      return res.status(201).json({ ok: true, code, reference: record.reference, total: record.total, url: session.url });
    } catch (error) {
      return http.answerError(res, error, 'schedule-checkout-failed');
    }
  }

  const finalize = (code, session) => repository.finalizeBooking(code, paymentFromSession(session), now());

  async function checkoutStatus(req, res) {
    if (!http.cors(req, res)) return;
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
      if (Object.keys(body).some(key => !['code', 'sessionId'].includes(key))) fail();
      const code = body.code, sessionId = body.sessionId;
      if (!validCode(code) || typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]{8,250}$/.test(sessionId)) fail();
      const checkout = await repository.getCheckout(code);
      // An unknown code and a wrong session look the same, so codes cannot be probed.
      if (!checkout || checkout.kind !== 'booking' || checkout.sessionId !== sessionId) throw new ShopError(404, 'booking-not-found');
      const existing = await repository.getBooking(code);
      if (existing && existing.payment === 'card')
        return res.status(200).json({ ok: true, paid: true, booking: publicBooking(existing, code, checkout.earliestKey) });
      const session = await stripe.retrieveCheckoutSession(sessionId);
      if (!sessionIsBooking(session) || sessionCode(session) !== code) throw new ShopError(404, 'booking-not-found');
      if (!sessionIsPaid(session)) return res.status(200).json({ ok: true, paid: false, state: String(session.status || 'open') });
      const result = await finalize(code, session);
      return res.status(200).json({ ok: true, paid: true, booking: publicBooking(result.booking, code, checkout.earliestKey) });
    } catch (error) {
      return http.answerError(res, error, 'schedule-status-failed');
    }
  }

  // Called by the shared Stripe webhook for a paid session marked as a booking.
  async function handlePaidSession(session) {
    const code = sessionCode(session);
    if (!validCode(code)) return { ignored: 'no-booking-code' };
    const result = await finalize(code, session);
    if (result.missing) { report('stripe-webhook-unknown-booking'); return { ignored: 'unknown-booking' }; }
    return { code, already: !!result.already };
  }

  return { createCheckout, checkoutStatus, handlePaidSession };
}

module.exports = {
  BOOKING_SOURCE, BOOKING_COLLECTION, SCHEDULE_DOC, SCHEDULE_RETURN_PATH, BOOKING_LIMITS, LEVEL_NAMES,
  slotLabel, feeNum, isMaster, slotModes, trialPriceFor, monthlyFeeFor, enrolModes, readSlot,
  validateBooking, priceBooking, referenceFor, buildBookingCheckout, bookingSessionParams, publicBooking,
  sessionIsBooking, createBookingService
};
