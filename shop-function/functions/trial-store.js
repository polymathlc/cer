'use strict';
// Firestore (Admin SDK) side of the /trial page (trial.js). Every write that
// must happen once (a booking and its emails, a one-time code being used up, a
// reminder) is done in a single transaction, so double taps, retries and two
// scheduled runs can never send or use anything twice.
const { ShopError } = require('./service');
const { MAIL_COLLECTION } = require('./receipt');
const { SCHEDULE_DOC } = require('./booking');
const { TRIAL_SETTINGS_DOC, TRIAL_BOOKINGS, TRIAL_LINKS, TRIAL_CODES, COURSES, SHEETS, LIMIT_COLLECTION,
  accessCodeState, linkState, showAccessCode } = require('./trial');

const CODE_ATTEMPTS = 6;
const SHEET_FIELDS = ['name', 'storagePath', 'pageCount', 'hidden'];

function createTrialStore(db, Timestamp, { bucket = null } = {}) {
  const timestamp = ms => Timestamp.fromMillis(ms);
  const settingsRef = () => db.collection(TRIAL_SETTINGS_DOC[0]).doc(TRIAL_SETTINGS_DOC[1]);
  const bookings = () => db.collection(TRIAL_BOOKINGS);
  const links = () => db.collection(TRIAL_LINKS);
  const codes = () => db.collection(TRIAL_CODES);
  const mail = () => db.collection(MAIL_COLLECTION);
  const limits = () => db.collection(LIMIT_COLLECTION);
  const all = async collection => (await collection.get()).docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
  const countOf = snapshot => snapshot.exists ? Number(snapshot.data().count) || 0 : 0;

  return {
    async loadContext() {
      const [schedule, settings] = await db.getAll(db.collection(SCHEDULE_DOC[0]).doc(SCHEDULE_DOC[1]), settingsRef());
      return { config: schedule.exists ? schedule.data() || {} : {}, settings: settings.exists ? settings.data() || {} : {} };
    },
    async loadCourses() { return all(db.collection(COURSES)); },
    // Only the few fields the page needs: worksheet documents also carry the
    // teacher's whole annotation history, which can be megabytes.
    async loadSheets(ids) {
      const unique = [...new Set((ids || []).filter(Boolean))];
      if (!unique.length) return {};
      const snapshots = await db.getAll(...unique.map(id => db.collection(SHEETS).doc(id)), { fieldMask: SHEET_FIELDS });
      const out = {};
      snapshots.forEach((snapshot, index) => { if (snapshot.exists) out[unique[index]] = snapshot.data(); });
      return out;
    },

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

    // Whether a one-time code can open the page. With `record`, an active
    // code also notes when it was entered, so the admins see every use.
    async checkAccessCode(code, now, record) {
      const ref = codes().doc(code);
      if (!record) {
        const snapshot = await ref.get();
        return accessCodeState(snapshot.exists ? snapshot.data() : null, now);
      }
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const data = snapshot.exists ? snapshot.data() : null;
        const state = accessCodeState(data, now);
        if (state === 'active') transaction.update(ref, { checks: (Number(data.checks) || 0) + 1,
          firstCheckedAtMs: data.firstCheckedAtMs || now, lastCheckedAtMs: now });
        return state;
      });
    },

    // Writes trialBookings/{code} with its emails and uses up the one-time
    // code, all at once. The same student booked again for the same lesson
    // gets the first booking back and nothing is written, sent or used up.
    async reserveBooking(build, generate) {
      for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
        const code = generate();
        const submission = build(code);
        const bookingRef = bookings().doc(code);
        const duplicateRef = limits().doc(submission.duplicate.id);
        const accessRef = submission.accessCode ? codes().doc(submission.accessCode) : null;
        const quotaRefs = submission.quotas.map(quota => limits().doc(quota.id));
        const result = await db.runTransaction(async transaction => {
          const reads = [duplicateRef, bookingRef, ...quotaRefs];
          if (accessRef) reads.push(accessRef);
          const [duplicateSnapshot, bookingSnapshot, ...rest] = await transaction.getAll(...reads);
          const accessSnapshot = accessRef ? rest.pop() : null;
          const quotas = rest;
          if (duplicateSnapshot.exists) {
            const first = duplicateSnapshot.data();
            const firstSnapshot = first && first.code ? await transaction.get(bookings().doc(first.code)) : null;
            if (firstSnapshot && firstSnapshot.exists) return { already: true, booking: firstSnapshot.data() };
          }
          if (bookingSnapshot.exists) return null;
          if (accessRef) {
            const state = accessCodeState(accessSnapshot.exists ? accessSnapshot.data() : null, submission.now);
            if (state !== 'active') throw new ShopError(403, 'code-' + state);
          }
          const counts = quotas.map(countOf);
          if (counts.some((count, index) => count >= submission.quotas[index].maximum)) throw new ShopError(429, 'too-many-bookings');
          submission.quotas.forEach((quota, index) => transaction.set(quotaRefs[index], { count: counts[index] + 1, expiresAt: timestamp(quota.expiresAt) }));
          const booking = Object.assign({}, submission.booking, { createdAt: timestamp(submission.now) });
          for (const item of submission.mails(booking)) {
            if (!item.mail) continue;
            transaction.create(mail().doc(item.id), item.mail);
            if (item.confirmation) { booking.confirmationSentAtMs = submission.now; booking.confirmationSentTo = item.mail.to[0]; }
          }
          if (accessRef) transaction.update(accessRef, { usedAtMs: submission.now, usedFor: code,
            usedSummary: [booking.studentName, booking.classLevel + ' ' + booking.classSubject, booking.sessionLabel].join(' · ') });
          transaction.set(duplicateRef, { code, expiresAt: timestamp(submission.duplicate.expiresAt) });
          transaction.create(bookingRef, booking);
          return { booking };
        });
        if (result) return result;
      }
      throw new Error('Could not find a free booking code');
    },

    // Someone opened a class link and gave their email and WhatsApp. The same
    // email on the same link is one visit (its count goes up), not a new one.
    async openLink(token, now, build, generate) {
      const linkRef = links().doc(token);
      for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
        const code = generate();
        const result = await db.runTransaction(async transaction => {
          const linkSnapshot = await transaction.get(linkRef);
          const link = linkSnapshot.exists ? linkSnapshot.data() : null;
          const state = linkState(link, now);
          if (state !== 'active') return { state };
          const submission = build(link, code);
          const duplicateRef = limits().doc(submission.duplicateId);
          const [duplicateSnapshot, visitSnapshot] = await transaction.getAll(duplicateRef, bookings().doc(code));
          if (duplicateSnapshot.exists && duplicateSnapshot.data().code) {
            const firstRef = bookings().doc(duplicateSnapshot.data().code);
            const firstSnapshot = await transaction.get(firstRef);
            if (firstSnapshot.exists) {
              const first = firstSnapshot.data();
              const updated = Object.assign({}, first, { opens: (Number(first.opens) || 0) + 1, lastOpenedAtMs: now,
                whatsapp: submission.visit.whatsapp || first.whatsapp, studentName: submission.visit.studentName || first.studentName });
              transaction.update(firstRef, { opens: updated.opens, lastOpenedAtMs: now, whatsapp: updated.whatsapp, studentName: updated.studentName });
              transaction.update(linkRef, { opens: (Number(link.opens) || 0) + 1, lastOpenedAtMs: now });
              return { state, already: true, link, visit: updated };
            }
          }
          if (visitSnapshot.exists) return null;
          const visit = Object.assign({}, submission.visit, { createdAt: timestamp(now) });
          transaction.set(duplicateRef, { code, expiresAt: timestamp(Math.max(now, Number(link.expiresAtMs) || now) + 86400000) });
          transaction.create(bookings().doc(code), visit);
          transaction.update(linkRef, { opens: (Number(link.opens) || 0) + 1, people: (Number(link.people) || 0) + 1, lastOpenedAtMs: now });
          return { state, link, visit };
        });
        if (result) return result;
      }
      throw new Error('Could not find a free visit code');
    },

    async getBooking(code) { const s = await bookings().doc(code).get(); return s.exists ? s.data() : null; },
    async getLink(token) {
      if (typeof token !== 'string' || !token) return null;
      const s = await links().doc(token).get(); return s.exists ? s.data() : null;
    },
    async createLink(link) { await links().doc(link.token).create(link); },
    async updateLink(token, patch) {
      const ref = links().doc(token);
      if (!(await ref.get()).exists) return false;
      await ref.update(patch); return true;
    },
    async listBookings() { return all(bookings()); },
    async listLinks() { return all(links()); },
    async listAccessCodes() { return all(codes()); },
    async createAccessCodes(count, generate, build) {
      const made = [];
      for (let i = 0; i < count; i++) {
        for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
          const code = generate();
          const record = build(code);
          const created = await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(codes().doc(code));
            if (snapshot.exists) return false;
            transaction.create(codes().doc(code), record);
            return true;
          });
          if (created) { made.push(record); break; }
          if (attempt === CODE_ATTEMPTS - 1) throw new Error('Could not find a free access code (' + showAccessCode(code) + ')');
        }
      }
      return made;
    },
    async updateAccessCode(code, patch) {
      const ref = codes().doc(code);
      if (!(await ref.get()).exists) return false;
      await ref.update(patch); return true;
    },
    // Replaces the settings' top-level fields given, keeping the rest (so a
    // Zoom link cleared on the page is really removed, not merged back).
    async saveSettings(patch) {
      const ref = settingsRef();
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        transaction.set(ref, Object.assign({}, snapshot.exists ? snapshot.data() : {}, patch));
      });
    },
    async updateBooking(code, patch) {
      const ref = bookings().doc(code);
      if (!(await ref.get()).exists) return false;
      await ref.update(patch); return true;
    },
    async deleteBooking(code) {
      const ref = bookings().doc(code);
      if (!(await ref.get()).exists) return false;
      await ref.delete(); return true;
    },

    // The afternoon-before reminder (or an admin's "Send reminder now"), once:
    // the booking's reminderSentAtMs and the email are written together.
    async sendReminder(code, buildMail, mailId, now, { force = false, by = 'schedule' } = {}) {
      const ref = bookings().doc(code);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return { sent: false, reason: 'booking-not-found' };
        const booking = snapshot.data();
        if (booking.status === 'cancelled') return { sent: false, reason: 'booking-cancelled' };
        if (booking.reminderSentAtMs && !force) return { sent: false, reason: 'already-sent' };
        if (booking.reminderSentAtMs && now - booking.reminderSentAtMs < 60000) return { sent: false, reason: 'reminder-just-sent' };
        const message = buildMail(booking);
        if (!message) return { sent: false, reason: 'no-email' };
        transaction.create(mail().doc(mailId), message);
        transaction.update(ref, { reminderSentAtMs: now, reminderSentTo: message.to[0], reminderSentBy: by,
          reminderCount: (Number(booking.reminderCount) || 0) + 1 });
        return { sent: true, to: message.to[0] };
      });
    },

    // The worksheet PDF, from the project's Storage bucket.
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

module.exports = { createTrialStore, SHEET_FIELDS };
