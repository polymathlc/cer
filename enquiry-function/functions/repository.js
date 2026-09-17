'use strict';
const { EnquiryError, REQUEST_COLLECTION, LIMIT_COLLECTION, MAIL_PREFIX } = require('./service');

function createRepository(db, Timestamp) {
  const timestamp = ms => Timestamp.fromMillis(ms);
  return {
    async reserve(submission) {
      const request = db.collection(REQUEST_COLLECTION).doc(submission.id);
      const mail = db.collection('mail').doc(MAIL_PREFIX + submission.id);
      const quotaRefs = submission.quotas.map(quota => db.collection(LIMIT_COLLECTION).doc(quota.id));
      return db.runTransaction(async transaction => {
        const existing = await transaction.get(request);
        if (existing.exists) {
          if (existing.data().fingerprint !== submission.fingerprint)
            throw new EnquiryError(409, 'submission-id-reused');
          return { duplicate: true };
        }
        const quotas = await transaction.getAll(...quotaRefs);
        if (quotas.some((snapshot, index) => (snapshot.exists ? Number(snapshot.data().count) || 0 : 0)
            >= submission.quotas[index].maximum)) throw new EnquiryError(429, 'too-many-enquiries');
        submission.quotas.forEach((quota, index) => transaction.set(quotaRefs[index], {
          count: (quotas[index].exists ? Number(quotas[index].data().count) || 0 : 0) + 1,
          expiresAt: timestamp(quota.expiresAt)
        }));
        transaction.create(request, { fingerprint: submission.fingerprint,
          createdAt: timestamp(submission.now), expiresAt: timestamp(submission.expiresAt) });
        transaction.create(mail, submission.mail);
        return { duplicate: false };
      });
    },
    async cleanup(now) {
      let removedRequests = 0, removedLimits = 0;
      // 100/day is the global admission limit; these bounds cover long outages
      // without unbounded invocations. The next daily run handles any remainder.
      for (const collection of [REQUEST_COLLECTION, LIMIT_COLLECTION]) {
        for (let page = 0; page < 20; page++) {
          const snapshot = await db.collection(collection).where('expiresAt', '<=', timestamp(now)).limit(100).get();
          if (snapshot.empty) break;
          const batch = db.batch();
          for (const row of snapshot.docs) {
            batch.delete(row.ref);
            if (collection === REQUEST_COLLECTION) {
              batch.delete(db.collection('mail').doc(MAIL_PREFIX + row.id));
              removedRequests++;
            } else removedLimits++;
          }
          await batch.commit();
        }
      }
      return { removedRequests, removedLimits };
    }
  };
}
module.exports = { createRepository };
