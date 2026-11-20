'use strict';
// Firestore (Admin SDK) side of the Free Question of the Day (daily-question.js).
//
//   trialSettings/dailyQuestion                    settings: mode 'on' | 'paused', dailyCap
//   trialSettings/dailyQuestion/days/{day}         { math, science } question ids shown that day
//   trialSettings/dailyQuestion/subscribers/{id}   one parent: email, subjects, daily/weekly, status, token
//   trialSettings/dailyQuestion/runs/{day}         what the morning sender did that day (counts only)
//
// trialSettings/** is closed to every browser by the /trial Firestore rules, so none
// of this needs a rule of its own. The emails go through the `mail` collection and
// the Trigger Email extension, like every other Polymath email.
const {
  ROOT, SUBSCRIBERS, DAYS, RUNS, MAIL_COLLECTION, LIMIT_COLLECTION, QotdError, pickForDay
} = require('./daily-question-core');

function createDailyQuestionStore(db, Timestamp) {
  const root = () => db.collection(ROOT[0]).doc(ROOT[1]);
  const subscribers = () => root().collection(SUBSCRIBERS);
  const days = () => root().collection(DAYS);
  const runs = () => root().collection(RUNS);
  const mail = () => db.collection(MAIL_COLLECTION);
  const limits = () => db.collection(LIMIT_COLLECTION);
  const countOf = snapshot => (snapshot.exists ? Number(snapshot.data().count) || 0 : 0);
  const timestamp = ms => (Timestamp ? Timestamp.fromMillis(ms) : new Date(ms));

  return {
    async getSettings() { const s = await root().get(); return s.exists ? s.data() : {}; },
    async saveSettings(patch) { await root().set(patch, { merge: true }); },

    // The day's pair, written the first time anyone asks for it, so it never changes.
    async ensureDay(day, at) {
      const ref = days().doc(day);
      const snapshot = await ref.get();
      if (snapshot.exists) return pickForDay(day, snapshot.data());
      return db.runTransaction(async transaction => {
        const again = await transaction.get(ref);
        if (again.exists) return pickForDay(day, again.data());
        const pick = pickForDay(day, null);
        transaction.create(ref, Object.assign({}, pick, { createdAt: at }));
        return pick;
      });
    },
    // Past days: the stored pair, else the default (a day nobody asked for).
    async getDays(list) {
      const unique = [...new Set(list)];
      if (!unique.length) return {};
      const snapshots = await db.getAll(...unique.map(day => days().doc(day)));
      const out = {};
      snapshots.forEach((snapshot, index) => { out[unique[index]] = pickForDay(unique[index], snapshot.exists ? snapshot.data() : null); });
      return out;
    },

    // Counts one attempt against each quota; refuses (429) once any is full.
    async countAttempts(quotas, errorCode) {
      const refs = quotas.map(quota => limits().doc(quota.id));
      await db.runTransaction(async transaction => {
        const snapshots = await transaction.getAll(...refs);
        const counts = snapshots.map(countOf);
        if (counts.some((count, index) => count >= quotas[index].maximum)) throw new QotdError(429, errorCode);
        quotas.forEach((quota, index) => transaction.set(refs[index], { count: counts[index] + 1, expiresAt: timestamp(quota.expiresAt) }));
      });
    },

    // A sign-up: reads the subscriber, lets `plan` decide, and writes the record and
    // its email together, so a double tap can never send two confirmations.
    async subscribe(id, plan, buildMail) {
      return db.runTransaction(async transaction => {
        const ref = subscribers().doc(id);
        const snapshot = await transaction.get(ref);
        const existing = snapshot.exists ? Object.assign({ id }, snapshot.data()) : null;
        const decision = plan(existing);
        if (decision.record) transaction.set(ref, decision.record, { merge: true });
        if (decision.mail) {
          const saved = Object.assign({ id }, existing || {}, decision.record || {});
          const message = buildMail(decision.mail, saved);
          if (message) transaction.set(mail().doc(decision.mailId(saved)), message);
        }
        return decision;
      });
    },

    async getSubscriber(id) {
      const s = await subscribers().doc(id).get();
      return s.exists ? Object.assign({ id }, s.data()) : null;
    },
    // Changes one subscriber in a transaction. `change(current)` returns
    // { patch, mails: [[id, doc]] } or throws; nothing is written for a null patch.
    async change(id, change) {
      return db.runTransaction(async transaction => {
        const ref = subscribers().doc(id);
        const snapshot = await transaction.get(ref);
        const current = snapshot.exists ? Object.assign({ id }, snapshot.data()) : null;
        const result = change(current) || {};
        if (result.patch) transaction.update(ref, result.patch);
        for (const [mailId, message] of result.mails || []) transaction.set(mail().doc(mailId), message);
        return Object.assign({}, current || {}, result.patch || {});
      });
    },
    async listSubscribers() {
      const snapshot = await subscribers().get();
      return snapshot.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
    },
    async deleteSubscriber(id) { await subscribers().doc(id).delete(); },

    async addMail(id, message) { await mail().doc(id).set(message); },

    // ─── For the morning sender (tools/daily-question-send.mjs) ───
    // An email under an id that can only ever be written once: a second run on the
    // same day (the backup schedule, a manual run) finds it and sends nothing.
    async createMailOnce(id, message) {
      try { await mail().doc(id).create(message); return true; }
      catch (error) {
        if (error && (error.code === 6 || error.code === 'already-exists' || /already exists/i.test(String(error.message)))) return false;
        throw error;
      }
    },
    async patchSubscriber(id, patch) { await subscribers().doc(id).update(patch); },
    async getRun(day) { const s = await runs().doc(day).get(); return s.exists ? s.data() : null; },
    async saveRun(day, data) { await runs().doc(day).set(Object.assign({ day }, data), { merge: true }); },
    async listRuns(count = 14) {
      const snapshot = await runs().orderBy('day', 'desc').limit(count).get();
      return snapshot.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
    }
  };
}

module.exports = { createDailyQuestionStore };
