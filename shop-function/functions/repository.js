'use strict';
const { ShopError, CHECKOUT_COLLECTION, LIMIT_COLLECTION, ORDER_COLLECTION, PRODUCT_COLLECTION, SETTINGS_DOC,
  unlimited } = require('./service');
const { MAIL_COLLECTION, mailId, receiptMail } = require('./receipt');
const { BOOKING_COLLECTION, SCHEDULE_DOC } = require('./booking');
const { bookingMailId, adminBookingMail, parentBookingMail } = require('./booking-mail');

const CODE_ATTEMPTS = 6;

function createRepository(db, Timestamp) {
  const timestamp = ms => Timestamp.fromMillis(ms);
  const checkouts = db.collection(CHECKOUT_COLLECTION);
  const orders = db.collection(ORDER_COLLECTION);
  const productsRef = db.collection(PRODUCT_COLLECTION);
  const mail = db.collection(MAIL_COLLECTION);
  const bookings = db.collection(BOOKING_COLLECTION);

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

    // The timetable and its prices as parents see them, and the shop's card switch.
    async loadSchedule() {
      const [scheduleSnapshot, settingsSnapshot] = await db.getAll(
        db.collection(SCHEDULE_DOC[0]).doc(SCHEDULE_DOC[1]), db.collection(SETTINGS_DOC[0]).doc(SETTINGS_DOC[1]));
      return {
        config: scheduleSnapshot.exists ? scheduleSnapshot.data() || {} : {},
        settings: settingsSnapshot.exists ? settingsSnapshot.data() || {} : {}
      };
    },

    // Saves the priced checkout under a fresh code that is used by neither a
    // checkout nor the document it will become (a shop order, or a schedule booking
    // when `target` is schedule_bookings; PayNow orders take their codes in the
    // browser), and counts it against the per-IP and daily limits, all in one
    // transaction.
    async reserveCheckout(build, generate, target = ORDER_COLLECTION) {
      for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
        const code = generate();
        const submission = build(code);
        const checkoutRef = checkouts.doc(code), orderRef = db.collection(target).doc(code);
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

    async getBooking(code) {
      const snapshot = await bookings.doc(code).get();
      return snapshot.exists ? snapshot.data() : null;
    },

    // Turns a paid schedule checkout into schedule_bookings/{code}, once, in the
    // shape the page's PayNow booking has, so the admin's bookings list shows it
    // unchanged. It stays 'pending' until the admin confirms the date, as a PayNow
    // booking does, but is marked payment:'card' with the Stripe ids, so there is
    // no screenshot to check. The centre's and the parent's emails are written in
    // the same transaction, so they go out exactly once however many times Stripe
    // or the page call in; a leftover mail document never blocks the booking.
    async finalizeBooking(code, payment, now) {
      const checkoutRef = checkouts.doc(code), bookingRef = bookings.doc(code);
      const adminMailRef = mail.doc(bookingMailId(code, 'admin')), parentMailRef = mail.doc(bookingMailId(code, 'parent'));
      return db.runTransaction(async transaction => {
        const [checkoutSnapshot, bookingSnapshot, adminMailSnapshot, parentMailSnapshot] =
          await transaction.getAll(checkoutRef, bookingRef, adminMailRef, parentMailRef);
        if (!checkoutSnapshot.exists) return { missing: true };
        if (bookingSnapshot.exists) return { already: true, booking: bookingSnapshot.data() };
        const checkout = checkoutSnapshot.data();
        if (checkout.kind !== 'booking' || !checkout.booking) return { missing: true };
        const at = timestamp(now);
        const checks = [];
        if (checkout.sessionId && payment.sessionId !== checkout.sessionId) checks.push('session-mismatch');
        if (payment.amountTotal !== checkout.totalCents || payment.currency !== checkout.currency) checks.push('amount-mismatch');
        const booking = Object.assign({}, checkout.booking, {
          status: 'pending',
          payment: 'card', paid: true,
          stripeSessionId: payment.sessionId, stripePaymentIntent: payment.paymentIntent,
          amountPaid: Math.round(payment.amountTotal) / 100, currency: payment.currency,
          paymentChecks: checks,
          pageVersion: checkout.pageVersion || '',
          createdAt: checkout.createdAt || at, paidAt: at
        });
        const details = { code, earliestKey: checkout.earliestKey || '', stripeSessionId: payment.sessionId, paymentChecks: checks, now };
        if (!adminMailSnapshot.exists) transaction.create(adminMailRef, adminBookingMail(booking, details));
        const parentMail = parentMailSnapshot.exists ? null : parentBookingMail(booking, details);
        if (parentMail) {
          booking.confirmationSentAt = at;
          booking.confirmationSentTo = parentMail.to[0];
          transaction.create(parentMailRef, parentMail);
        }
        transaction.create(bookingRef, booking);
        transaction.update(checkoutRef, { status: 'paid', paidAt: at });
        return { booking };
      });
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
        const firstMailRef = mail.doc(mailId(code, 1));
        const [checkoutSnapshot, orderSnapshot, mailSnapshot] = await transaction.getAll(checkoutRef, orderRef, firstMailRef);
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
        // The buyer's receipt goes out with the order, in the same transaction, so
        // it is sent exactly once however many times Stripe or the page call in.
        // A leftover mail document under the same id (an order deleted and its code
        // reused) must never block recording a payment: the admin can resend instead.
        const receipt = mailSnapshot.exists ? null : receiptMail(Object.assign({}, order, { paidAt: now }), { now });
        if (receipt) {
          Object.assign(order, { receiptCount: 1, receiptSentAt: at, receiptSentTo: receipt.to[0] });
          transaction.create(firstMailRef, receipt);
        }
        transaction.create(orderRef, order);
        transaction.update(checkoutRef, { status: 'paid', paidAt: at });
        return { order };
      });
    },

    // The admin's receipt email for a paid order: the first one for a PayNow order
    // when it is marked paid, or a resend of any paid order's receipt. Each send is
    // a new numbered mail document; the order keeps the count and when it was last
    // sent, so the same button pressed twice in a row sends one email, not two.
    async sendReceipt(code, now, minGapMs) {
      const orderRef = orders.doc(code);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists) throw new ShopError(404, 'order-not-found');
        const order = snapshot.data();
        const count = Math.max(0, Math.floor(Number(order.receiptCount) || 0));
        let mailRef = mail.doc(mailId(code, count + 1));
        if ((await transaction.get(mailRef)).exists) mailRef = mail.doc(mailId(code, count + 1) + '-' + now);
        if (!['paid', 'collected'].includes(order.status)) throw new ShopError(409, 'order-not-paid');
        const last = order.receiptSentAt && typeof order.receiptSentAt.toMillis === 'function' ? order.receiptSentAt.toMillis()
          : typeof order.receiptSentAt === 'number' ? order.receiptSentAt : null;
        if (last !== null && now - last < minGapMs) throw new ShopError(429, 'receipt-just-sent');
        const receipt = receiptMail(Object.assign({ code }, order), { now, resend: count > 0 });
        if (!receipt) throw new ShopError(409, 'no-email');
        const at = timestamp(now);
        transaction.create(mailRef, receipt);
        transaction.update(orderRef, { receiptCount: count + 1, receiptSentAt: at, receiptSentTo: receipt.to[0] });
        return { to: receipt.to[0], count: count + 1, resend: count > 0 };
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
