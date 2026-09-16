'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { LiveError } = require('./live-service');

// These collections are server-only. The CER rules migration excludes them
// from the shared project's legacy catch-all; Admin SDK bypasses client rules.
const SESSION_COLLECTION = 'cerAinsteinLiveSessions';
const LIMIT_COLLECTION = 'cerAinsteinLiveLimits';
function userKey(uid) { return createHash('sha256').update(uid).digest('hex'); }
function dayKey(now) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }

function createRepository(db) {
  const sessions = db.collection(SESSION_COLLECTION);
  const limits = db.collection(LIMIT_COLLECTION);
  const globalRef = limits.doc('_global');

  async function reserve(uid, now, policy) {
    const id = randomUUID();
    const ownerKey = userKey(uid);
    const ownerRef = limits.doc(ownerKey);
    const day = dayKey(now);
    const lease = {
      id, uid, ownerKey, sessionId: null,
      createdAt: now, expiresAt: now + policy.durationSeconds * 1000,
      cleanupAt: now + 60000
    };
    await db.runTransaction(async tx => {
      const [owner, global] = await Promise.all([tx.get(ownerRef), tx.get(globalRef)]);
      const ownerData = owner.data() || {};
      const globalData = global.data() || {};
      if (ownerData.currentLease) throw new LiveError(409, 'session_already_active', 'A live session is already open on this account. End it before starting another.');
      const starts = ownerData.day === day ? Number(ownerData.starts || 0) : 0;
      if (starts >= policy.startsPerDay) throw new LiveError(429, 'daily_limit', 'You have used today\'s live sessions. You can still use Ainstein by typing.');
      const active = { ...(globalData.active || {}) };
      const globalStarts = globalData.day === day ? Number(globalData.starts || 0) : 0;
      if (Object.keys(active).length >= policy.concurrent || globalStarts >= policy.globalStartsPerDay) {
        throw new LiveError(429, 'live_busy', 'Live assistance is busy or has reached today\'s allowance. Use Ainstein by typing and try again later.');
      }
      active[id] = true;
      tx.set(ownerRef, { day, starts: starts + 1, currentLease: id });
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
      const [owner, global, current] = await Promise.all([tx.get(ownerRef), tx.get(globalRef), tx.get(sessionRef)]);
      // A sweeper may have read a pending reservation just before creation
      // finished. Never delete its newly activated, still-paid session.
      if (!lease.sessionId && current.data()?.sessionId) return;
      const ownerData = owner.data() || {};
      const globalData = global.data() || {};
      const active = { ...(globalData.active || {}) };
      delete active[lease.id];
      // A delayed stop for an old call must never unlock a newer session.
      if (ownerData.currentLease === lease.id) tx.set(ownerRef, { ...ownerData, currentLease: null });
      if (global.exists) tx.set(globalRef, { ...globalData, active });
      tx.delete(sessionRef);
    });
  }

  async function find(uid, sessionId) {
    const owner = await limits.doc(userKey(uid)).get();
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
