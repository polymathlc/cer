'use strict';
// Firestore (Admin SDK) side of the exam countdown revision packs (revision.js).
//
//   trialSettings/revisionPacks                 { seededAt }  the starter packs were made
//   trialSettings/revisionPacks/packs/{id}      a pack: title, exam, price, topics
//   trialSettings/revisionPacks/orders/{code}   an order: buyer, status, access code
//   trialSettings/revisionPacks/access/{code}   access code → order code
//
// trialSettings/** is closed to every browser by the /trial rules, so none of this
// needs a Firestore rule of its own. Everything that must happen once (an order
// being paid, its access code, its emails) is one transaction, so a webhook and
// the buyer's own return from Stripe can never issue two codes or two emails.
const { ShopError } = require('./service');
const { MAIL_COLLECTION } = require('./receipt');
const { REVISION_ROOT, PACKS, ORDERS, ACCESS, COURSES, SHEETS, MINDMAPS } = require('./revision');

const LIMIT_COLLECTION = 'shop_checkout_limits';
const SETTINGS_DOC = ['shop_settings', 'config'];
// Only what a pack needs: worksheet documents also carry the teacher's whole
// annotation history, which can be megabytes.
const SHEET_FIELDS = ['name', 'storagePath', 'pageCount', 'hidden', 'answerKeys', 'videoPlaylist'];
const CODE_ATTEMPTS = 6;

function createRevisionStore(db, Timestamp, { bucket = null } = {}) {
  const timestamp = ms => Timestamp.fromMillis(ms);
  const root = () => db.collection(REVISION_ROOT[0]).doc(REVISION_ROOT[1]);
  const packs = () => root().collection(PACKS);
  const orders = () => root().collection(ORDERS);
  const access = () => root().collection(ACCESS);
  const mail = () => db.collection(MAIL_COLLECTION);
  const limits = () => db.collection(LIMIT_COLLECTION);
  const all = async collection => (await collection.get()).docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
  const countOf = snapshot => (snapshot.exists ? Number(snapshot.data().count) || 0 : 0);

  return {
    async getRoot() { const s = await root().get(); return s.exists ? s.data() : null; },
    // Writes the starter packs once; a second caller at the same moment finds
    // seededAt already set and writes nothing.
    async seed(list, at) {
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(root());
        if (snapshot.exists && snapshot.data().seededAt) return false;
        const refs = list.map(pack => packs().doc(pack.id));
        const existing = refs.length ? await transaction.getAll(...refs) : [];
        transaction.set(root(), { seededAt: at, starterPacks: list.map(p => p.id) }, { merge: true });
        list.forEach((pack, index) => { if (!existing[index].exists) transaction.set(refs[index], Object.assign({}, pack, { updatedAt: at, updatedBy: 'starter' })); });
        return true;
      });
    },
    async listPacks() { return all(packs()); },
    async getPack(id) { const s = await packs().doc(id).get(); return s.exists ? s.data() : null; },
    async savePack(id, data) { await packs().doc(id).set(data); },
    async deletePack(id) { await packs().doc(id).delete(); },

    async loadCourses() { return all(db.collection(COURSES)); },
    async loadSheets(ids) {
      const unique = [...new Set((ids || []).filter(Boolean))];
      if (!unique.length) return {};
      const out = {};
      for (let i = 0; i < unique.length; i += 100) {
        const chunk = unique.slice(i, i + 100);
        const snapshots = await db.getAll(...chunk.map(id => db.collection(SHEETS).doc(id)), { fieldMask: SHEET_FIELDS });
        snapshots.forEach((snapshot, index) => { if (snapshot.exists) out[chunk[index]] = snapshot.data(); });
      }
      return out;
    },
    // Mr Chung's Maps: the titles only (a map can be close to a megabyte).
    async listPublishedMaps() {
      const snapshot = await db.collection(MINDMAPS).where('published', '==', true).select('title', 'nodeCount', 'publishedAtMs').get();
      return snapshot.docs.map(doc => ({ id: doc.id, title: String(doc.data().title || 'Mind map').slice(0, 120),
        nodeCount: Number(doc.data().nodeCount) || 0, publishedAtMs: Number(doc.data().publishedAtMs) || 0 }))
        .sort((a, b) => b.publishedAtMs - a.publishedAtMs);
    },
    async loadMaps(ids) {
      const unique = [...new Set((ids || []).filter(Boolean))];
      if (!unique.length) return {};
      const snapshots = await db.getAll(...unique.map(id => db.collection(MINDMAPS).doc(id)),
        { fieldMask: ['title', 'rootId', 'nodes', 'published'] });
      const out = {};
      snapshots.forEach((snapshot, index) => { if (snapshot.exists) out[unique[index]] = snapshot.data(); });
      return out;
    },
    async loadShopSettings() { const s = await db.collection(SETTINGS_DOC[0]).doc(SETTINGS_DOC[1]).get(); return s.exists ? s.data() : null; },

    // Counts one attempt against each quota; refuses (429) once any is full.
    async countAttempts(quotas, errorCode) {
      const refs = quotas.map(quota => limits().doc(quota.id));
      await db.runTransaction(async transaction => {
        const snapshots = await transaction.getAll(...refs);
        const counts = snapshots.map(countOf);
        if (counts.some((count, index) => count >= quotas[index].maximum)) throw new ShopError(429, errorCode);
        quotas.forEach((quota, index) => transaction.set(refs[index], { count: counts[index] + 1, expiresAt: timestamp(quota.expiresAt) }));
      });
    },

    // A new order under a fresh 6-character code, with an optional email to the
    // centre (a PayNow order to look out for) in the same transaction.
    async createOrder(build, generate, buildMail) {
      for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
        const code = generate();
        const record = build(code);
        const made = await db.runTransaction(async transaction => {
          const ref = orders().doc(code);
          if ((await transaction.get(ref)).exists) return false;
          transaction.create(ref, record);
          const message = buildMail ? buildMail(record) : null;
          if (message) transaction.set(mail().doc('polymath-revision-' + code + '-new'), message);
          return true;
        });
        if (made) return record;
      }
      throw new ShopError(503, 'temporarily-unavailable');
    },
    async getOrder(code) { const s = await orders().doc(code).get(); return s.exists ? Object.assign({ code }, s.data()) : null; },
    async updateOrder(code, patch) { await orders().doc(code).update(patch); },
    async listOrders() { return all(orders()).then(list => list.map(o => Object.assign({ code: o.id }, o))); },
    async orderForAccess(code) {
      const s = await access().doc(code).get();
      if (!s.exists) return null;
      const orderCode = s.data().orderCode;
      return typeof orderCode === 'string' ? this.getOrder(orderCode) : null;
    },
    async noteOpen(code, at) {
      await db.runTransaction(async transaction => {
        const ref = orders().doc(code);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        transaction.update(ref, { opens: (Number(snapshot.data().opens) || 0) + 1, lastOpenedAt: at, firstOpenedAt: snapshot.data().firstOpenedAt || at });
      });
    },

    // Paid: the access code, when it lasts until, and the emails, all at once.
    // A second call (the webhook after the buyer's return, a double tap) is a no-op.
    async markPaid(code, { at, by, payment, newCode, endsAt, buildMails, mailId }) {
      return db.runTransaction(async transaction => {
        const ref = orders().doc(code);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return { missing: true };
        const order = Object.assign({ code }, snapshot.data());
        if (order.status === 'paid') return { already: true, order };
        const packSnapshot = await transaction.get(packs().doc(order.packId));
        let accessCode = '';
        for (let attempt = 0; attempt < CODE_ATTEMPTS && !accessCode; attempt++) {
          const candidate = newCode();
          if (!(await transaction.get(access().doc(candidate))).exists) accessCode = candidate;
        }
        if (!accessCode) throw new ShopError(503, 'temporarily-unavailable');
        const patch = { status: 'paid', paidAt: at, paidBy: by, accessCode, accessEndsAt: endsAt(order, packSnapshot.exists ? packSnapshot.data() : null) };
        if (payment) {
          patch.stripe = { sessionId: payment.sessionId, paymentIntent: payment.paymentIntent, amountTotal: payment.amountTotal, currency: payment.currency };
          if (payment.amountTotal !== order.totalCents || (payment.currency && payment.currency !== order.currency))
            patch.amountCheck = 'Stripe charged ' + payment.amountTotal + ' ' + payment.currency + ', expected ' + order.totalCents + ' ' + order.currency;
        }
        const paid = Object.assign({}, order, patch);
        const messages = buildMails(paid);
        const buyerMail = messages.length && messages[0].to && messages[0].to[0] === (order.buyer && order.buyer.email);
        if (buyerMail) { patch.mailCount = 1; patch.mailSentAt = at; }
        transaction.create(access().doc(accessCode), { orderCode: code, createdAt: at });
        transaction.update(ref, patch);
        messages.forEach((message, index) => transaction.set(mail().doc(index === 0 && buyerMail ? mailId(paid, 1) : mailId(paid, 'admin')), message));
        return { order: Object.assign(paid, patch) };
      });
    },
    async resend(code, { at, gap, build, mailId }) {
      return db.runTransaction(async transaction => {
        const ref = orders().doc(code);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new ShopError(404, 'order-not-found');
        const order = Object.assign({ code }, snapshot.data());
        if (order.mailSentAt && at - Number(order.mailSentAt) < gap) throw new ShopError(429, 'receipt-just-sent');
        const message = build(order);
        if (!message) throw new ShopError(409, 'no-email');
        const count = (Number(order.mailCount) || 0) + 1;
        transaction.set(mail().doc(mailId(order, count)), message);
        transaction.update(ref, { mailCount: count, mailSentAt: at });
        return { order: Object.assign(order, { mailCount: count, mailSentAt: at }), to: message.to[0] };
      });
    },

    // A worksheet or answer key PDF, from the project's Storage bucket.
    async openPdf(path) {
      if (!bucket || typeof path !== 'string' || !/^[\w./-]+\.pdf$/i.test(path) || path.includes('..')) return null;
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [metadata] = await file.getMetadata();
      return { stream: file.createReadStream(), size: Number(metadata.size) || 0 };
    }
  };
}

module.exports = { createRevisionStore, SHEET_FIELDS };
