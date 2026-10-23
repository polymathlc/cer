'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { LiveError } = require('./live-service');

// These collections are server-only. The CER rules migration excludes them
// from the shared project's legacy catch-all; Admin SDK bypasses client rules.
const SESSION_COLLECTION = 'cerAinsteinLiveSessions';
const LIMIT_COLLECTION = 'cerAinsteinLiveLimits';
function userKey(uid) { return createHash('sha256').update(uid).digest('hex'); }
function dayKey(now) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }

/* 🧠 ONE PAIR OF COLLECTIONS, TWO VOICES (v1.448.0). The Polymath's public
   QR tutor files its leases and counts in the SAME two server-only
   collections as Ainstein, so the shared rules need no new names — under its
   own key prefix and its own global document, so neither voice's allowance
   can spend the other's. Every lease carries the global document it counts
   against (`globalId`), which is what lets ONE sweeper close either kind.

   `stale` is The Polymath's and is off for Ainstein, byte for byte as it was:
   a phone that scanned a QR code and closed the tab mid-call must not hold a
   lock that refuses that phone for ever. With it on, an account lock or a
   concurrency slot older than one whole session plus a minute is let go
   (Study Buddy's v1.32.0 / v1.33.0 rule), and slots are written as the
   moment they were taken rather than `true`. */
function createRepository(db, options = {}) {
  const prefix = typeof options.prefix === 'string' ? options.prefix : '';
  const globalId = typeof options.globalId === 'string' && options.globalId ? options.globalId : '_global';
  const stale = options.stale === true;
  const sessions = db.collection(SESSION_COLLECTION);
  const limits = db.collection(LIMIT_COLLECTION);
  const globalRef = limits.doc(globalId);
  const ownerKeyOf = uid => prefix + userKey(uid);
  const capOn = n => Number.isFinite(n) && n >= 1;
  function startsAllowed(policy, user) {
    // A policy may set a different daily allowance by sign-in kind.
    if (user && user.anonymous && Number.isFinite(policy.anonymousStartsPerDay)) return policy.anonymousStartsPerDay;
    return policy.startsPerDay;
  }

  async function reserve(uid, now, policy, user) {
    const id = randomUUID();
    const ownerKey = ownerKeyOf(uid);
    const ownerRef = limits.doc(ownerKey);
    const day = dayKey(now);
    const words = policy.messages || {};
    const lease = {
      id, uid, ownerKey, sessionId: null,
      createdAt: now, expiresAt: now + policy.durationSeconds * 1000,
      cleanupAt: now + 60000
    };
    // Only a namespaced repository writes the field, so an Ainstein lease is
    // the exact document it always was.
    if (globalId !== '_global') lease.globalId = globalId;
    const staleBefore = now - (policy.durationSeconds * 1000 + 60000);
    await db.runTransaction(async tx => {
      const [owner, global] = await Promise.all([tx.get(ownerRef), tx.get(globalRef)]);
      const ownerData = owner.data() || {};
      const globalData = global.data() || {};
      const lockHeld = ownerData.currentLease && !(stale && !(Number(ownerData.leaseAt) > staleBefore));
      if (lockHeld) throw new LiveError(409, 'session_already_active', words.active || 'A live session is already open on this account. End it before starting another.');
      const starts = ownerData.day === day ? Number(ownerData.starts || 0) : 0;
      const allowed = startsAllowed(policy, user);
      if ((stale ? capOn(allowed) : true) && starts >= allowed) throw new LiveError(429, 'daily_limit', words.daily || 'You have used today\'s live sessions. You can still use Ainstein by typing.');
      const active = { ...(globalData.active || {}) };
      if (stale) Object.keys(active).forEach(key => { if (!(Number(active[key]) > staleBefore)) delete active[key]; });
      const globalStarts = globalData.day === day ? Number(globalData.starts || 0) : 0;
      const tooMany = stale ? capOn(policy.concurrent) && Object.keys(active).length >= policy.concurrent : Object.keys(active).length >= policy.concurrent;
      const spent = stale ? capOn(policy.globalStartsPerDay) && globalStarts >= policy.globalStartsPerDay : globalStarts >= policy.globalStartsPerDay;
      if (tooMany) throw new LiveError(429, 'live_busy', words.busy || 'Live assistance is busy or has reached today\'s allowance. Use Ainstein by typing and try again later.');
      if (spent) throw new LiveError(429, 'live_busy', words.spent || words.busy || 'Live assistance is busy or has reached today\'s allowance. Use Ainstein by typing and try again later.');
      active[id] = stale ? now : true;
      tx.set(ownerRef, stale ? { day, starts: starts + 1, currentLease: id, leaseAt: now } : { day, starts: starts + 1, currentLease: id });
      tx.set(globalRef, { day, starts: globalStarts + 1, active });
      tx.set(sessions.doc(id), lease);
    });
    return lease;
  }

  async function activate(lease, sessionId) {
    await db.runTransaction(async tx => {
      const ref = sessions.doc(lease.id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Live reservation expired.');
      tx.update(ref, { sessionId, cleanupAt: lease.expiresAt });
    });
  }

  async function recover(lease) {
    // Keep the provider ID discoverable if activation failed after the paid
    // call was created. Do not postpone the expiry of the original lease.
    await sessions.doc(lease.id).set({ ...lease, cleanupAt: Date.now() });
  }

  async function release(lease) {
    await db.runTransaction(async tx => {
      const ownerRef = limits.doc(lease.ownerKey);
      const sessionRef = sessions.doc(lease.id);
      // A lease names the global document it counted against, so whichever
      // voice's sweeper finds it frees the right slot.
      const leaseGlobal = limits.doc(typeof lease.globalId === 'string' && lease.globalId ? lease.globalId : '_global');
      const [owner, global, current] = await Promise.all([tx.get(ownerRef), tx.get(leaseGlobal), tx.get(sessionRef)]);
      // A sweeper may have read a pending reservation just before creation
      // finished. Never delete its newly activated, still-paid session.
      if (!lease.sessionId && current.data()?.sessionId) return;
      const ownerData = owner.data() || {};
      const globalData = global.data() || {};
      const active = { ...(globalData.active || {}) };
      delete active[lease.id];
      // A delayed stop for an old call must never unlock a newer session.
      if (ownerData.currentLease === lease.id) tx.set(ownerRef, { ...ownerData, currentLease: null });
      if (global.exists) tx.set(leaseGlobal, { ...globalData, active });
      tx.delete(sessionRef);
    });
  }

  async function find(uid, sessionId) {
    const owner = await limits.doc(ownerKeyOf(uid)).get();
    const id = owner.data()?.currentLease;
    if (!id) return null;
    const snap = await sessions.doc(id).get();
    const lease = snap.data();
    return lease?.uid === uid && lease.sessionId === sessionId ? lease : null;
  }

  async function expired(now) {
    const snap = await sessions.where('cleanupAt', '<=', now).limit(40).get();
    return snap.docs.map(doc => doc.data());
  }

  return { reserve, activate, recover, release, find, expired };
}

module.exports = { createRepository, dayKey, userKey, SESSION_COLLECTION, LIMIT_COLLECTION };
