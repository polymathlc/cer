'use strict';

// MR CHUNG'S MAPS LIBRARY — the monthly subscription behind polymathlc.com.sg/maps.
//
// Mr Chung publishes mind maps from /mindmap (📌, fields published / publishedAtMs on
// mindmaps/{id}). This service lets people OUTSIDE the centre pay a small monthly
// subscription to open them, while the centre's own people keep them free:
//
//   staff        the access admins and teachers (verified Google email)   free
//   student      an account approved at polymathlc.com.sg/student/#admin  free
//                (studentAccess/{uid}.status == 'approved', the gate's record)
//   subscriber   a live Stripe subscription made for this Firebase account  paid
//   none         everybody else: sees the catalogue (titles and topics) and
//                the Subscribe button, never a map's contents
//
// ONE endpoint, mapsLibrary, with an "action" in the JSON body:
//   catalogue  (no sign-in)  titles, topic names and counts of every published map + the price
//   status                   who you are to the library, and your subscription
//   subscribe                a Stripe Checkout page for the monthly subscription
//   confirm                  called when Stripe sends the subscriber back: records it at once
//   open                     one published map, in full, for an account with access
//   cancel / resume          stop (or undo stopping) at the end of the paid month
//   manage                   Stripe's own page to change the card (needs the portal set up)
//   admin                    (access admins) every subscriber, from Stripe
//   admin-price              (access admins) change the monthly price for NEW subscribers
//
// WHY STRIPE DECIDES, NOT FIRESTORE. The shared Firestore catch-all is open to every
// browser, so a document a browser could write can never be the proof of payment.
// mapSubscribers/{uid} only remembers WHICH Stripe subscription to look at; the
// subscription itself is fetched from Stripe and must carry this account's uid in its
// metadata (written by this server when it made the checkout), and must be active.
// So a cancelled subscription, or one whose renewal payment failed (past_due, unpaid),
// closes the library by itself, with no webhook event needed. The document holds no
// names or emails, only Stripe ids and the status, for the same reason.
//
// THE PRICE lives in Stripe as a recurring Price with the lookup key below, so the
// admin can change it from /maps/#admin with no deploy (existing subscribers keep the
// price they joined at, which is how Stripe works). Until the admin sets one, new
// subscribers pay MAPS_DEFAULT_PRICE_CENTS, given inline to Checkout.
const { createHash } = require('node:crypto');
const { ShopError, ORIGINS } = require('./service');
const { StripeError } = require('./stripe');

const MAPS_SOURCE = 'polymath-maps';
const MAPS_LOOKUP_KEY = 'polymath-maps-monthly';
// S$9.90 a month until the admin sets another price at polymathlc.com.sg/maps/#admin.
const MAPS_DEFAULT_PRICE_CENTS = 990;
const MAPS_CURRENCY = 'sgd';
const MAPS_PRODUCT_NAME = "Mr Chung's Maps library";
const MAPS_PRICE_LIMITS = Object.freeze({ minimumCents: 100, maximumCents: 20000 });
const SUBSCRIBER_COLLECTION = 'mapSubscribers';
const MINDMAP_COLLECTION = 'mindmaps';
const STUDENT_ACCESS_COLLECTION = 'studentAccess';
// Keep equal to ACCESS_ADMINS / STAFF in student/access-gate.js and mindmap/mindmap-services.js.
const MAPS_ADMINS = Object.freeze(['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg']);
const MAPS_STAFF = Object.freeze(MAPS_ADMINS.concat(['elsielcr@gmail.com', 'abigail.yew@stanfordmanpower.com', 'pkeertana21@gmail.com']));
// Only maps owned by a publisher show in the library (the same rule /mindmap uses).
const MAPS_PUBLISHERS = MAPS_ADMINS;
// Where the library page is served on the shop's origins. Stripe sends people back here.
const MAPS_RETURN_PATH = /^\/(?:cer\/)?maps\/(?:index\.html)?$/;
const OPEN_STATUSES = Object.freeze(['active', 'trialing']);
const MAPS_ACTIONS = Object.freeze(['catalogue', 'status', 'subscribe', 'confirm', 'open', 'cancel', 'resume', 'manage', 'admin', 'admin-price']);
const SUBSCRIPTION_CACHE_MS = 2 * 60000;
const CATALOGUE_CACHE_MS = 60000;
const PRICE_CACHE_MS = 5 * 60000;
const TEASER_TOPICS = 8;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const lower = value => String(value == null ? '' : value).trim().toLowerCase();
const fail = (code = 'invalid-request') => { throw new ShopError(400, code); };
const dollarsLabel = cents => 'S$' + (Math.round(cents) / 100).toFixed(2);

function returnBase(value) {
  let url;
  try { url = new URL(String(value || '').slice(0, 300)); } catch { fail('return-url-not-allowed'); }
  if (!ORIGINS.includes(url.origin) || !MAPS_RETURN_PATH.test(url.pathname)) fail('return-url-not-allowed');
  return url.origin + url.pathname;
}

// Everything the page may see about a subscription (no card, no customer details).
function publicSubscription(sub) {
  if (!sub) return null;
  const item = sub.items && Array.isArray(sub.items.data) ? sub.items.data[0] : null;
  const price = item && item.price ? item.price : (sub.plan || null);
  const periodEnd = Number(sub.current_period_end || (item && item.current_period_end)) || 0;
  return {
    status: String(sub.status || ''),
    open: OPEN_STATUSES.includes(sub.status),
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    currentPeriodEnd: periodEnd ? periodEnd * 1000 : 0,
    amountCents: price && Number.isFinite(Number(price.unit_amount)) ? Number(price.unit_amount) : null,
    currency: price && price.currency ? String(price.currency) : MAPS_CURRENCY
  };
}

// A subscription is this account's only if this server made it for this uid.
const subscriptionIsFor = (sub, uid) => !!(sub && typeof sub.id === 'string' && sub.metadata
  && sub.metadata.source === MAPS_SOURCE && sub.metadata.uid === uid);
const customerIdOf = sub => !sub ? '' : typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id) || '';

// The order a search's results are trusted in: a live one first, then the newest.
function bestSubscription(list) {
  const rank = sub => (OPEN_STATUSES.includes(sub.status) ? 2 : sub.status === 'past_due' ? 1 : 0);
  return list.slice().sort((a, b) => rank(b) - rank(a) || (Number(b.created) || 0) - (Number(a.created) || 0))[0] || null;
}

// What a non-subscriber may see of a published map: its title, its first branches and
// how much is in it, never a note, question, picture or app.
function teaserOf(id, raw) {
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rootId = typeof raw.rootId === 'string' ? raw.rootId : ((nodes.find(n => n && !n.parentId) || {}).id || '');
  const count = type => nodes.filter(n => n && (n.type || 'topic') === type).length;
  return {
    id,
    title: String(raw.title || 'Untitled').slice(0, 120),
    publishedAtMs: Number(raw.publishedAtMs) || 0,
    updatedAtMs: Number(raw.updatedAtMs) || Date.parse(raw.updatedAt || '') || 0,
    topics: nodes.filter(n => n && n.parentId === rootId && (n.type || 'topic') === 'topic' && String(n.text || '').trim())
      .slice(0, TEASER_TOPICS).map(n => String(n.text).replace(/\s+/g, ' ').trim().slice(0, 60)),
    counts: { items: nodes.length, topics: count('topic'), notes: count('note'), questions: count('question'), pictures: count('image'), apps: count('code') }
  };
}
const isLibraryMap = raw => !!(raw && raw.published === true && MAPS_PUBLISHERS.includes(lower(raw.ownerEmail)));

// The map as the library viewer draws it: no owner ids, no private fields.
function libraryMap(id, raw) {
  return {
    id, title: String(raw.title || 'Untitled').slice(0, 120),
    rootId: raw.rootId || '', nodes: Array.isArray(raw.nodes) ? raw.nodes : [], links: Array.isArray(raw.links) ? raw.links : [],
    view: raw.view && typeof raw.view === 'object' ? raw.view : { x: 0, y: 0, zoom: 1 },
    ownerName: 'Mr Chung', publishedAtMs: Number(raw.publishedAtMs) || 0,
    updatedAt: String(raw.updatedAt || ''), createdAt: String(raw.createdAt || '')
  };
}

function subscribeSessionParams({ uid, email, customerId, price, base }) {
  const metadata = { source: MAPS_SOURCE, uid };
  const lineItem = price.id ? { price: price.id, quantity: 1 } : {
    quantity: 1,
    price_data: { currency: MAPS_CURRENCY, unit_amount: price.cents, recurring: { interval: 'month' },
      product_data: { name: MAPS_PRODUCT_NAME } }
  };
  return Object.assign({
    mode: 'subscription',
    payment_method_types: ['card'],
    client_reference_id: uid,
    line_items: [lineItem],
    allow_promotion_codes: true,
    metadata,
    subscription_data: { metadata, description: MAPS_PRODUCT_NAME + ' (monthly)' },
    // Stripe swaps {CHECKOUT_SESSION_ID} for the real id when it sends the subscriber back.
    success_url: base + '?subscribed=1&session={CHECKOUT_SESSION_ID}',
    cancel_url: base + '?cancelled=1'
  }, customerId ? { customer: customerId } : email ? { customer_email: email } : {});
}

// Firestore, through the Admin SDK (rules do not apply to it).
function createMapsStore(db, Timestamp) {
  return {
    async getSubscriber(uid) {
      const snap = await db.collection(SUBSCRIBER_COLLECTION).doc(uid).get();
      return snap.exists ? snap.data() : null;
    },
    async saveSubscriber(uid, data) {
      await db.collection(SUBSCRIBER_COLLECTION).doc(uid).set(Object.assign({}, data, { updatedAt: Timestamp ? Timestamp.now() : new Date() }));
    },
    async getStudentAccess(uid) {
      const snap = await db.collection(STUDENT_ACCESS_COLLECTION).doc(uid).get();
      return snap.exists ? snap.data() : null;
    },
    async listPublished() {
      const snap = await db.collection(MINDMAP_COLLECTION).where('published', '==', true).get();
      return snap.docs.map(d => ({ id: d.id, data: d.data() }));
    },
    async getMap(id) {
      const snap = await db.collection(MINDMAP_COLLECTION).doc(id).get();
      return snap.exists ? snap.data() : null;
    }
  };
}

function createMapsService({ store, stripe, http, verifyIdToken, now = Date.now, report = () => {} }) {
  const { cors, answerError } = http;
  const subCache = new Map();          // uid → { at, sub }
  let catalogueCache = null;           // { at, maps }
  let priceCache = null;               // { at, price }

  async function claimsFrom(req, required = true) {
    const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(req.get('authorization') || '');
    if (!match) { if (required) throw new ShopError(401, 'sign-in-required'); return null; }
    let claims;
    try { claims = await verifyIdToken(match[1]); } catch { throw new ShopError(401, 'sign-in-required'); }
    const provider = claims && claims.firebase && claims.firebase.sign_in_provider;
    if (!claims || !UID_RE.test(String(claims.uid || '')) || provider === 'anonymous') throw new ShopError(401, 'sign-in-required');
    return {
      uid: claims.uid,
      email: claims.email_verified === true ? lower(claims.email) : '',
      anyEmail: lower(claims.email)
    };
  }
  const isAdmin = who => !!(who && who.email && MAPS_ADMINS.includes(who.email));

  /** The monthly price new subscribers pay: Stripe's price with our lookup key, or the default. */
  async function currentPrice(fresh = false) {
    if (!fresh && priceCache && now() - priceCache.at < PRICE_CACHE_MS) return priceCache.price;
    let price = { id: '', cents: MAPS_DEFAULT_PRICE_CENTS, currency: MAPS_CURRENCY, fromStripe: false, productId: '' };
    try {
      const list = await stripe.listPrices({ lookup_keys: [MAPS_LOOKUP_KEY], active: true, limit: 1 });
      const found = list && Array.isArray(list.data) ? list.data[0] : null;
      if (found && found.recurring && found.recurring.interval === 'month' && found.currency === MAPS_CURRENCY
          && Number.isInteger(found.unit_amount) && found.unit_amount >= 50)
        price = { id: found.id, cents: found.unit_amount, currency: found.currency, fromStripe: true,
          productId: typeof found.product === 'string' ? found.product : (found.product && found.product.id) || '' };
    } catch (error) {
      // Stripe not reachable or not configured: the default still prices the page.
      if (!(error instanceof StripeError && error.code === 'stripe-not-configured')) report('maps-price-lookup-failed');
    }
    priceCache = { at: now(), price };
    return price;
  }
  const publicPrice = price => ({ cents: price.cents, currency: price.currency, label: dollarsLabel(price.cents) + ' / month' });

  /** This account's subscription, as Stripe has it now (verified to be theirs), or null. */
  async function subscriptionFor(uid, fresh = false) {
    const cached = subCache.get(uid);
    if (!fresh && cached && now() - cached.at < SUBSCRIPTION_CACHE_MS) return cached.sub;
    let sub = null;
    const record = await store.getSubscriber(uid);
    const id = record && typeof record.subscriptionId === 'string' && /^sub_[A-Za-z0-9]{6,250}$/.test(record.subscriptionId) ? record.subscriptionId : '';
    if (id) {
      try {
        const got = await stripe.retrieveSubscription(id);
        if (subscriptionIsFor(got, uid)) sub = got;
      } catch (error) {
        if (!(error instanceof StripeError)) throw error;
        if (error.code === 'stripe-not-configured') throw error;
      }
    }
    // The record was never written (the webhook and the return page both failed), or
    // a browser changed it: find the subscription in Stripe by the uid this server
    // stamped on it. Search can lag a minute behind, so it is only the fallback.
    if (!sub || !OPEN_STATUSES.includes(sub.status)) {
      try {
        const found = await stripe.searchSubscriptions(`metadata['uid']:'${uid}' AND metadata['source']:'${MAPS_SOURCE}'`);
        const mine = (found && Array.isArray(found.data) ? found.data : []).filter(item => subscriptionIsFor(item, uid));
        const best = bestSubscription(sub ? mine.concat([sub]) : mine);
        if (best) sub = best;
      } catch (error) {
        if (!(error instanceof StripeError)) throw error;
        report('maps-subscription-search-failed');
      }
    }
    if (sub && (!record || record.subscriptionId !== sub.id || record.status !== sub.status
        || record.cancelAtPeriodEnd !== (sub.cancel_at_period_end === true))) {
      await remember(uid, sub).catch(() => report('maps-subscriber-save-failed'));
    }
    subCache.set(uid, { at: now(), sub });
    return sub;
  }

  async function remember(uid, sub) {
    const view = publicSubscription(sub);
    await store.saveSubscriber(uid, {
      uid, source: MAPS_SOURCE, subscriptionId: sub.id, customerId: customerIdOf(sub),
      status: view.status, cancelAtPeriodEnd: view.cancelAtPeriodEnd, currentPeriodEnd: view.currentPeriodEnd
    });
    subCache.set(uid, { at: now(), sub });
  }

  /** staff | student | subscriber | none, with the subscription when there is one. */
  async function accessFor(who, { fresh = false } = {}) {
    if (who.email && MAPS_STAFF.includes(who.email)) return { access: 'staff', subscription: null };
    const record = await store.getStudentAccess(who.uid);
    if (record && lower(record.status) === 'approved') return { access: 'student', subscription: null };
    const sub = await subscriptionFor(who.uid, fresh);
    if (sub && OPEN_STATUSES.includes(sub.status)) return { access: 'subscriber', subscription: sub };
    return { access: 'none', subscription: sub };
  }
  const hasAccess = state => state.access !== 'none';

  async function catalogue() {
    if (catalogueCache && now() - catalogueCache.at < CATALOGUE_CACHE_MS) return catalogueCache.maps;
    const list = await store.listPublished();
    const maps = list.filter(item => isLibraryMap(item.data)).map(item => teaserOf(item.id, item.data))
      .sort((a, b) => (b.publishedAtMs || b.updatedAtMs) - (a.publishedAtMs || a.updatedAtMs));
    catalogueCache = { at: now(), maps };
    return maps;
  }

  async function statusAnswer(who, state) {
    return {
      ok: true, access: state.access, admin: isAdmin(who),
      subscription: publicSubscription(state.subscription),
      price: publicPrice(await currentPrice())
    };
  }

  const handlers = {
    async catalogue(req) {
      const [maps, price] = await Promise.all([catalogue(), currentPrice()]);
      return { ok: true, maps, price: publicPrice(price) };
    },

    async status(req, body) {
      const who = await claimsFrom(req);
      return statusAnswer(who, await accessFor(who, { fresh: body.fresh === true }));
    },

    async subscribe(req, body) {
      const who = await claimsFrom(req);
      const base = returnBase(body.returnUrl);
      const state = await accessFor(who, { fresh: true });
      if (state.access === 'staff' || state.access === 'student') throw new ShopError(409, 'free-for-you');
      if (state.access === 'subscriber') throw new ShopError(409, 'already-subscribed');
      const price = await currentPrice();
      // A customer is reused only from a subscription Stripe confirmed is this account's.
      const params = subscribeSessionParams({ uid: who.uid, email: who.anyEmail, customerId: customerIdOf(state.subscription), price, base });
      // Tapping twice in the same ten minutes opens the same checkout, never two.
      const key = 'polymath-maps-' + createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 32) + '-' + Math.floor(now() / 600000);
      const session = await stripe.createCheckoutSession(params, key);
      if (!session || typeof session.url !== 'string') throw new StripeError(502, 'stripe-error', 'no-session-url');
      return { ok: true, url: session.url };
    },

    async confirm(req, body) {
      const who = await claimsFrom(req);
      const sessionId = body.sessionId;
      if (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]{8,250}$/.test(sessionId)) fail();
      const session = await stripe.retrieveCheckoutSession(sessionId);
      // Another account's checkout looks exactly like an unknown one.
      if (!session || !session.metadata || session.metadata.source !== MAPS_SOURCE || session.metadata.uid !== who.uid)
        throw new ShopError(404, 'checkout-not-found');
      const subId = typeof session.subscription === 'string' ? session.subscription : (session.subscription && session.subscription.id) || '';
      if (session.status === 'complete' && subId) {
        const sub = await stripe.retrieveSubscription(subId);
        if (subscriptionIsFor(sub, who.uid)) await remember(who.uid, sub);
      }
      return statusAnswer(who, await accessFor(who));
    },

    async open(req, body) {
      const who = await claimsFrom(req);
      if (typeof body.mapId !== 'string' || !MAP_ID_RE.test(body.mapId)) fail();
      const state = await accessFor(who);
      if (!hasAccess(state)) throw new ShopError(402, 'subscription-required');
      const raw = await store.getMap(body.mapId);
      if (!isLibraryMap(raw)) throw new ShopError(404, 'map-not-found');
      return { ok: true, access: state.access, map: libraryMap(body.mapId, raw) };
    },

    async cancel(req) { return setCancel(req, true); },
    async resume(req) { return setCancel(req, false); },

    async manage(req, body) {
      const who = await claimsFrom(req);
      const base = returnBase(body.returnUrl);
      const sub = await subscriptionFor(who.uid, true);
      if (!sub) throw new ShopError(404, 'no-subscription');
      try {
        const portal = await stripe.createBillingPortalSession({ customer: customerIdOf(sub), return_url: base });
        if (!portal || typeof portal.url !== 'string') throw new Error('no url');
        return { ok: true, url: portal.url };
      } catch (error) {
        // The customer portal has to be switched on once in the Stripe dashboard.
        report('maps-portal-unavailable');
        throw new ShopError(503, 'portal-unavailable');
      }
    },

    async admin(req) {
      const who = await claimsFrom(req);
      if (!isAdmin(who)) throw new ShopError(403, 'admin-only');
      const subscribers = [];
      let startingAfter = '';
      for (let page = 0; page < 10; page++) {
        const list = await stripe.listSubscriptions(Object.assign({ status: 'all', limit: 100, expand: ['data.customer'] },
          startingAfter ? { starting_after: startingAfter } : {}));
        const data = list && Array.isArray(list.data) ? list.data : [];
        for (const sub of data) {
          if (!sub || !sub.metadata || sub.metadata.source !== MAPS_SOURCE) continue;
          const customer = sub.customer && typeof sub.customer === 'object' ? sub.customer : {};
          subscribers.push(Object.assign({ email: String(customer.email || ''), name: String(customer.name || ''),
            createdAt: (Number(sub.created) || 0) * 1000 }, publicSubscription(sub)));
        }
        if (!list || !list.has_more || !data.length) break;
        startingAfter = data[data.length - 1].id;
      }
      const price = await currentPrice(true);
      return {
        ok: true, subscribers, price: publicPrice(price), priceFromStripe: price.fromStripe,
        defaultPrice: publicPrice({ cents: MAPS_DEFAULT_PRICE_CENTS, currency: MAPS_CURRENCY }),
        limits: MAPS_PRICE_LIMITS
      };
    },

    async 'admin-price'(req, body) {
      const who = await claimsFrom(req);
      if (!isAdmin(who)) throw new ShopError(403, 'admin-only');
      const cents = body.cents;
      if (!Number.isInteger(cents) || cents < MAPS_PRICE_LIMITS.minimumCents || cents > MAPS_PRICE_LIMITS.maximumCents) fail('invalid-price');
      const current = await currentPrice(true);
      if (current.fromStripe && current.cents === cents) return { ok: true, price: publicPrice(current), changed: false };
      const created = await stripe.createPrice(Object.assign({
        currency: MAPS_CURRENCY, unit_amount: cents, recurring: { interval: 'month' },
        lookup_key: MAPS_LOOKUP_KEY, transfer_lookup_key: true, nickname: 'Monthly ' + dollarsLabel(cents)
      }, current.productId ? { product: current.productId } : { product_data: { name: MAPS_PRODUCT_NAME } }),
      'polymath-maps-price-' + cents + '-' + Math.floor(now() / 60000));
      // The old price stops being offered; subscribers already on it keep paying it.
      if (current.id && created && created.id !== current.id) {
        try { await stripe.updatePrice(current.id, { active: false }); } catch { report('maps-old-price-not-archived'); }
      }
      priceCache = null;
      const price = await currentPrice(true);
      return { ok: true, price: publicPrice(price), changed: true };
    }
  };

  async function setCancel(req, cancel) {
    const who = await claimsFrom(req);
    const sub = await subscriptionFor(who.uid, true);
    if (!sub || !OPEN_STATUSES.includes(sub.status)) throw new ShopError(404, 'no-subscription');
    const updated = await stripe.updateSubscription(sub.id, { cancel_at_period_end: cancel });
    if (subscriptionIsFor(updated, who.uid)) await remember(who.uid, updated);
    return statusAnswer(who, await accessFor(who));
  }

  async function mapsLibrary(req, res) {
    if (!cors(req, res)) return;
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
      const action = body.action;
      if (typeof action !== 'string' || !MAPS_ACTIONS.includes(action)) fail('unknown-action');
      const allowed = new Set(['action', 'returnUrl', 'sessionId', 'mapId', 'cents', 'fresh', 'pageVersion']);
      if (Object.keys(body).some(key => !allowed.has(key))) fail();
      const answer = await handlers[action](req, body);
      return res.status(200).json(answer);
    } catch (error) {
      return answerError(res, error, 'maps-library-failed');
    }
  }

  /**
   * The shared webhook hands paid checkouts with metadata.source 'polymath-maps' here
   * (checkout.session.completed, which the live endpoint already listens for).
   */
  async function handlePaidSession(session) {
    const uid = session && session.metadata ? session.metadata.uid : '';
    if (!UID_RE.test(String(uid || ''))) return { ignored: 'no-uid' };
    const subId = typeof session.subscription === 'string' ? session.subscription : (session.subscription && session.subscription.id) || '';
    if (!subId) return { ignored: 'no-subscription' };
    const sub = await stripe.retrieveSubscription(subId);
    if (!subscriptionIsFor(sub, uid)) return { ignored: 'not-ours' };
    await remember(uid, sub);
    return { maps: true, status: sub.status };
  }

  return { mapsLibrary, handlePaidSession, accessFor, subscriptionFor, currentPrice, catalogue };
}

module.exports = {
  MAPS_SOURCE, MAPS_LOOKUP_KEY, MAPS_DEFAULT_PRICE_CENTS, MAPS_CURRENCY, MAPS_PRODUCT_NAME, MAPS_PRICE_LIMITS,
  MAPS_ADMINS, MAPS_STAFF, MAPS_PUBLISHERS, MAPS_RETURN_PATH, MAPS_ACTIONS, OPEN_STATUSES, SUBSCRIBER_COLLECTION,
  publicSubscription, subscriptionIsFor, bestSubscription, teaserOf, isLibraryMap, libraryMap, subscribeSessionParams,
  createMapsStore, createMapsService
};
