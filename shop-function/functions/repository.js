'use strict';
const { ShopError, CHECKOUT_COLLECTION, LIMIT_COLLECTION, ORDER_COLLECTION, PRODUCT_COLLECTION, SETTINGS_DOC,
  unlimited } = require('./service');

const CODE_ATTEMPTS = 6;

function createRepository(db, Timestamp) {
  const timestamp = ms => Timestamp.fromMillis(ms);
  const checkouts = db.collection(CHECKOUT_COLLECTION);
  const orders = db.collection(ORDER_COLLECTION);
  const productsRef = db.collection(PRODUCT_COLLECTION);

  return {
    async loadCatalogue(productIds) {
      const refs = productIds.map(id => productsRef.doc(id));
      const settingsRef = db.collection(SETTINGS_DOC[0]).doc(SETTINGS_DOC[1]);
      const snapshots = await db.getAll(...refs, settingsRef);
      const settingsSnapshot = snapshots.pop();
      const products = new Map();
      snapshots.forEach((snapshot, index) => products.set(productIds[index], snapshot.exists ? snapshot.data() : null));
      return { products, settings: settingsSnapshot.exists ? settingsSnapshot.data() || {} : {} };
    },

    // Saves the priced checkout under a fresh order code that is used by neither a
    // checkout nor an order (PayNow orders take their codes in the browser), and
    // counts it against the per-IP and daily limits, all in one transaction.
    async reserveCheckout(build, generate) {
      for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
        const code = generate();
        const submission = build(code);
        const checkoutRef = checkouts.doc(code), orderRef = orders.doc(code);
        const quotaRefs = submission.quotas.map(quota => db.collection(LIMIT_COLLECTION).doc(quota.id));
        const reserved = await db.runTransaction(async transaction => {
          const [checkoutSnapshot, orderSnapshot, ...quotas] = await transaction.getAll(checkoutRef, orderRef, ...quotaRefs);
          if (checkoutSnapshot.exists || orderSnapshot.exists) return false;
          const counts = quotas.map(snapshot => snapshot.exists ? Number(snapshot.data().count) || 0 : 0);
          if (counts.some((count, index) => count >= submission.quotas[index].maximum))
            throw new ShopError(429, 'too-many-checkouts');
          submission.quotas.forEach((quota, index) => transaction.set(quotaRefs[index], {
            count: counts[index] + 1, expiresAt: timestamp(quota.expiresAt)
          }));
          const record = submission.record;
          transaction.create(checkoutRef, Object.assign({}, record, {
            createdAt: timestamp(record.createdAt), sessionExpiresAt: timestamp(record.sessionExpiresAt),
            deleteAt: timestamp(record.deleteAt)
          }));
          return true;
        });
        if (reserved) return { code, record: submission.record };
      }
      throw new Error('Could not find a free order code');
    },

    async attachSession(code, sessionId) {
      await checkouts.doc(code).update({ sessionId });
    },

    async getCheckout(code) {
      const snapshot = await checkouts.doc(code).get();
      return snapshot.exists ? snapshot.data() : null;
    },

    async getOrder(code) {
      const snapshot = await orders.doc(code).get();
      return snapshot.exists ? snapshot.data() : null;
    },

    // Turns a paid checkout into a paid order, once. Stock comes out exactly the
    // way the admin page's setOrderStatus(code, 'paid') takes it: per product, the
    // quantities of all its lines added up; unlimited stock (quantity null) is left
    // alone; a count never goes below zero. stockApplied:true then lets "Cancel
    // order" on the admin page put it back. A line that found less stock than it
    // needed is listed in stockShort so the admin can see the oversell.
    async finalize(code, payment, now) {
      const checkoutRef = checkouts.doc(code), orderRef = orders.doc(code);
      return db.runTransaction(async transaction => {
        const [checkoutSnapshot, orderSnapshot] = await transaction.getAll(checkoutRef, orderRef);
        if (!checkoutSnapshot.exists) return { missing: true };
        if (orderSnapshot.exists) return { already: true, order: orderSnapshot.data() };
        const checkout = checkoutSnapshot.data();
        const want = new Map();
        for (const item of checkout.items || [])
          if (item.productId) want.set(item.productId, (want.get(item.productId) || 0) + (Number(item.qty) || 0));
        const ids = [...want.keys()];
        const productSnapshots = ids.length ? await transaction.getAll(...ids.map(id => productsRef.doc(id))) : [];
        const at = timestamp(now);
        const stockShort = [];
        productSnapshots.forEach((snapshot, index) => {
          if (!snapshot.exists) return;
          const current = snapshot.data().quantity;
          if (unlimited(current)) return;
          const have = Math.floor(Number(current) || 0), need = want.get(ids[index]);
          if (have < need) stockShort.push({ productId: ids[index], wanted: need, had: Math.max(0, have) });
          transaction.update(productsRef.doc(ids[index]), { quantity: Math.max(0, have - need), updatedAt: at });
        });
        const checks = [];
        if (checkout.sessionId && payment.sessionId !== checkout.sessionId) checks.push('session-mismatch');
        if (payment.amountTotal !== checkout.totalCents || payment.currency !== checkout.currency) checks.push('amount-mismatch');
        const order = {
          code, reference: checkout.reference, status: 'paid',
          items: checkout.items, total: checkout.total, subtotal: checkout.subtotal, deliveryFee: checkout.deliveryFee || 0,
          customer: checkout.customer, fulfilment: checkout.fulfilment, address: checkout.address || '', note: checkout.note || '',
          receiptUrl: '', receiptPath: '',
          pageVersion: checkout.pageVersion || '',
          payment: 'card',
          stripeSessionId: payment.sessionId, stripePaymentIntent: payment.paymentIntent,
          amountPaid: Math.round(payment.amountTotal) / 100, currency: payment.currency,
          paymentChecks: checks, stockShort,
          stockApplied: true,
          createdAt: checkout.createdAt || at, paidAt: at, updatedAt: at
        };
        transaction.create(orderRef, order);
        transaction.update(checkoutRef, { status: 'paid', paidAt: at });
        return { order };
      });
    },

    async cleanup(now, maxPages = 20) {
      let removedCheckouts = 0, removedLimits = 0;
      for (const [collection, field] of [[CHECKOUT_COLLECTION, 'deleteAt'], [LIMIT_COLLECTION, 'expiresAt']]) {
        for (let page = 0; page < maxPages; page++) {
          const snapshot = await db.collection(collection).where(field, '<=', timestamp(now)).limit(200).get();
          if (snapshot.empty) break;
          const batch = db.batch();
          for (const row of snapshot.docs) batch.delete(row.ref);
          await batch.commit();
          if (collection === CHECKOUT_COLLECTION) removedCheckouts += snapshot.docs.length;
          else removedLimits += snapshot.docs.length;
        }
      }
      return { removedCheckouts, removedLimits };
    }
  };
}
module.exports = { createRepository };
