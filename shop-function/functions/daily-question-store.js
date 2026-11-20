'use strict';
// Firestore (Admin SDK) side of the Free Question of the Day (daily-question.js).
//
//   trialSettings/dailyQuestion                    settings: mode 'on' | 'paused', dailyCap
//   trialSettings/dailyQuestion/days/{day}         v2: { picks: { math: { P3: id, … }, science: {…} }, items: { id: question } }
//                                                  (before v2: { math, science } bank ids)
//   trialSettings/dailyQuestion/subscribers/{id}   one parent: email, subjects, level, daily/weekly, status, token
//   trialSettings/dailyQuestion/runs/{day}         what the morning sender did that day (counts only)
//   trialSettings/dailyQuestion/pool/{id}          a question made from Ans Key or the CER bank: ready | used | skipped | rejected
//   trialSettings/dailyQuestion/images/{id}        one picture of a pool question (base64 JPEG)
//   trialSettings/dailyQuestion/meta/queue         the ready questions in the order they will be used, per subject and level
//   trialSettings/dailyQuestion/meta/sources       which worksheet pages and bank questions have been read
//   trialSettings/dailyQuestion/prepareRuns/{id}   what each night's prepare run did (counts only)
//
// trialSettings/** is closed to every browser by the /trial Firestore rules, so none
// of this needs a rule of its own. The emails go through the `mail` collection and
// the Trigger Email extension, like every other Polymath email.
const {
  ROOT, SUBSCRIBERS, DAYS, RUNS, MAIL_COLLECTION, LIMIT_COLLECTION, QotdError, pickForDay, defaultPick, SUBJECTS, pool
} = require('./daily-question-core');
const { POOL, IMAGES, META, QUEUE_DOC, SOURCES_DOC, PREPARE_RUNS, LEVELS, readQueue, isMcqDay } = pool;

// How far down a queue the pinning looks for a question still marked ready (far
// enough to find one of the day's kind among the other kind).
const QUEUE_LOOKAHEAD = 10;
// The fields of a pool question that travel into the day it is shown on.
const DAY_FIELDS = ['id', 'kind', 'source', 'subject', 'level', 'topic', 'q', 'images', 'options', 'answerIndex', 'answerType', 'answer', 'accepted', 'model', 'steps', 'idea', 'keywords', 'marks'];

// Which waiting question a slot takes on `day`: on a multiple-choice day (every
// third day) the first ready multiple-choice question, else the first ready open
// one; on the other days the other way round. Questions past the look-ahead stay
// for another day; ones no longer ready are dropped from the queue.
// Returns { chosen, keep, changed }.
function chooseFromLine(day, subject, level, line, found) {
  const order = isMcqDay(day) ? ['mcq', 'open'] : ['open', 'mcq'];
  const ready = [];
  const keep = [];
  let changed = false;
  for (const id of line) {
    const snap = found.get(subject + '|' + level + '|' + id);
    if (!snap) { keep.push(id); continue; }
    const item = snap.exists ? snap.data() : null;
    if (item && item.status === 'ready' && item.subject === subject && item.level === level) { ready.push(Object.assign({ id }, item)); keep.push(id); }
    else changed = true;
  }
  let chosen = null;
  for (const kind of order) { chosen = ready.find(item => (item.kind || 'open') === kind) || null; if (chosen) break; }
  if (chosen) { keep.splice(keep.indexOf(chosen.id), 1); changed = true; }
  return { chosen, keep, changed };
}
const forDay = item => Object.fromEntries(DAY_FIELDS.filter(k => item[k] !== undefined).map(k => [k, item[k]]));

// Does any slot of the day hold a bank question (one not from the pool)?
function hasBankSlot(pick) {
  if (!pick || !pick.picks) return false;
  for (const subject of SUBJECTS) for (const level of LEVELS) {
    const id = pick.picks[subject] && pick.picks[subject][level];
    if (id && !(pick.items && pick.items[id])) return true;
  }
  return false;
}

function createDailyQuestionStore(db, Timestamp) {
  const root = () => db.collection(ROOT[0]).doc(ROOT[1]);
  const subscribers = () => root().collection(SUBSCRIBERS);
  const days = () => root().collection(DAYS);
  const runs = () => root().collection(RUNS);
  const poolCol = () => root().collection(POOL);
  const images = () => root().collection(IMAGES);
  const meta = () => root().collection(META);
  const prepareRuns = () => root().collection(PREPARE_RUNS);
  const mail = () => db.collection(MAIL_COLLECTION);
  const limits = () => db.collection(LIMIT_COLLECTION);
  const countOf = snapshot => (snapshot.exists ? Number(snapshot.data().count) || 0 : 0);
  const timestamp = ms => (Timestamp ? Timestamp.fromMillis(ms) : new Date(ms));

  // Pins the day: each subject and level takes a waiting question (chooseFromLine),
  // a level with none takes the bank's question. With `upgrade`, an existing day
  // keeps every slot it has from the pool and only fills its bank slots.
  async function fill(day, at, upgrade) {
    const ref = days().doc(day);
    return db.runTransaction(async transaction => {
      const again = await transaction.get(ref);
      if (again.exists && !upgrade) return pickForDay(day, again.data());
      const queueRef = meta().doc(QUEUE_DOC), runRef = runs().doc(day);
      const [queueSnap, runSnap] = await transaction.getAll(queueRef, runRef);
      const base = again.exists ? pickForDay(day, again.data()) : null;
      if (upgrade && (!base || runSnap.exists || !hasBankSlot(base))) {
        // The morning emails went out with this day: it never changes again.
        if (base && runSnap.exists && !again.data().settledAt) transaction.set(ref, { settledAt: at }, { merge: true });
        return base;
      }
      const queue = readQueue(queueSnap.exists ? queueSnap.data() : null);
      const pick = base ? { v: 2, picks: JSON.parse(JSON.stringify(base.picks)), items: Object.assign({}, base.items) } : defaultPick(day);
      const open = [];
      for (const subject of SUBJECTS) for (const level of LEVELS) {
        if (base && pick.picks[subject][level] && pick.items[pick.picks[subject][level]]) continue;   // already from the pool
        if (queue[subject][level].length) open.push({ subject, level });
      }
      const looks = [];
      for (const { subject, level } of open) for (const id of queue[subject][level].slice(0, QUEUE_LOOKAHEAD)) looks.push({ subject, level, id });
      const snaps = looks.length ? await transaction.getAll(...looks.map(l => poolCol().doc(l.id))) : [];
      const found = new Map(looks.map((l, i) => [l.subject + '|' + l.level + '|' + l.id, snaps[i]]));
      const used = [];
      let changed = false;
      for (const { subject, level } of open) {
        const result = chooseFromLine(day, subject, level, queue[subject][level], found);
        if (result.chosen) {
          pick.picks[subject][level] = result.chosen.id;
          pick.items[result.chosen.id] = forDay(result.chosen);
          used.push(result.chosen.id);
        }
        if (result.changed) { queue[subject][level] = result.keep; changed = true; }
      }
      if (!base) transaction.create(ref, Object.assign({}, pick, { createdAt: at }));
      else if (used.length) transaction.set(ref, Object.assign({}, pick, { createdAt: again.data().createdAt || at, upgradedAt: at }));
      for (const id of used) transaction.update(poolCol().doc(id), { status: 'used', usedOn: day, usedAt: at });
      if (changed) transaction.set(queueRef, Object.assign({}, queue, { updatedAt: at }));
      return pickForDay(day, pick);
    });
  }

  return {
    async getSettings() { const s = await root().get(); return s.exists ? s.data() : {}; },
    async saveSettings(patch) { await root().set(patch, { merge: true }); },

    // The day's questions, written the first time anyone asks for them, so they never
    // change. Each subject and level takes the first READY question in its queue; a
    // level with none waiting takes the bank's question for that level.
    async ensureDay(day, at) {
      const ref = days().doc(day);
      const snapshot = await ref.get();
      if (snapshot.exists) {
        const current = pickForDay(day, snapshot.data());
        // A day that had to fall back to the built-in bank takes waiting questions as
        // soon as there are some, until its morning emails have gone out (after that
        // the day never changes, so the emails and tomorrow's answer always match).
        if (!hasBankSlot(current) || snapshot.data().settledAt) return current;
        return fill(day, at, true);
      }
      return fill(day, at, false);
    },
    // Past days: the stored questions, else the bank's (a day nobody asked for).
    async getDays(list) {
      const unique = [...new Set(list)];
      if (!unique.length) return {};
      const snapshots = await db.getAll(...unique.map(day => days().doc(day)));
      const out = {};
      snapshots.forEach((snapshot, index) => { out[unique[index]] = pickForDay(unique[index], snapshot.exists ? snapshot.data() : null); });
      return out;
    },
    // Only a day that has been pinned (for pictures: a day nobody asked for has none).
    async getStoredDay(day) {
      const s = await days().doc(day).get();
      return s.exists ? pickForDay(day, s.data()) : null;
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

    // An approved /student family with this parent email: its children, or null.
    // The enrolment is the source of truth for an enrolled child's level.
    async findFamily(email) {
      const address = String(email || '').trim().toLowerCase();
      if (!address) return null;
      try {
        const snapshot = await db.collection('studentAccess').where('parentEmail', '==', address).limit(5).get();
        const approved = snapshot.docs.map(d => d.data()).filter(d => d && d.status === 'approved');
        if (!approved.length) return null;
        return [].concat(...approved.map(d => (Array.isArray(d.children) ? d.children : [])));
      } catch { return null; }
    },
    // Every approved family, by parent email, for the morning sender (one read).
    async listFamilies() {
      const out = new Map();
      try {
        const snapshot = await db.collection('studentAccess').where('status', '==', 'approved').get();
        for (const doc of snapshot.docs) {
          const d = doc.data() || {};
          const emails = [d.parentEmail, d.email, d.accountEmail].map(e => String(e || '').trim().toLowerCase()).filter(Boolean);
          for (const e of emails) out.set(e, (out.get(e) || []).concat(Array.isArray(d.children) ? d.children : []));
        }
      } catch { /* no families: every subscriber keeps the level they chose */ }
      return out;
    },

    // ─── The pool (questions made from Ans Key and the CER bank) ───
    async getQueue() { const s = await meta().doc(QUEUE_DOC).get(); return readQueue(s.exists ? s.data() : null); },
    async saveQueue(queue, at) { await meta().doc(QUEUE_DOC).set(Object.assign({}, readQueue(queue), { updatedAt: at })); },
    async getPoolItems(ids) {
      const unique = [...new Set(ids)].filter(Boolean);
      if (!unique.length) return {};
      const snaps = await db.getAll(...unique.map(id => poolCol().doc(id)));
      const out = {};
      snaps.forEach((s, i) => { if (s.exists) out[unique[i]] = Object.assign({ id: unique[i] }, s.data()); });
      return out;
    },
    async getPoolItem(id) { const s = await poolCol().doc(id).get(); return s.exists ? Object.assign({ id }, s.data()) : null; },
    async listPool(status, count = 50) {
      const snapshot = await poolCol().where('status', '==', status).limit(count).get();
      return snapshot.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
    },
    // Saves what a prepare run made: each question, and each of its pictures in a
    // document of its own (a picture can be up to ~0.7 MB of base64).
    async savePoolItem(item, pictures = []) {
      for (const p of pictures) await images().doc(p.id).set({ data: p.data, mime: p.mime || 'image/jpeg', w: p.w, h: p.h, itemId: item.id });
      await poolCol().doc(item.id).set(item);
    },
    async getImage(id) { const s = await images().doc(id).get(); return s.exists ? s.data() : null; },
    // Admin: take a waiting question out (it will never be used), or put it back at
    // the end of its queue.
    async setPoolStatus(id, status, at, who) {
      return db.runTransaction(async transaction => {
        const ref = poolCol().doc(id), queueRef = meta().doc(QUEUE_DOC);
        const [snap, queueSnap] = await transaction.getAll(ref, queueRef);
        if (!snap.exists) throw new QotdError(404, 'not-found');
        const item = snap.data();
        const queue = readQueue(queueSnap.exists ? queueSnap.data() : null);
        if (!SUBJECTS.includes(item.subject) || !LEVELS.includes(item.level)) throw new QotdError(409, 'not-queued');
        const line = queue[item.subject][item.level].filter(x => x !== id);
        if (status === 'skipped') {
          if (item.status !== 'ready') throw new QotdError(409, 'not-ready');
          transaction.update(ref, { status: 'skipped', skippedAt: at, skippedBy: who });
        } else if (status === 'ready') {
          if (item.status !== 'skipped') throw new QotdError(409, 'not-skipped');
          transaction.update(ref, { status: 'ready', restoredAt: at, restoredBy: who });
          line.push(id);
        } else throw new QotdError(400, 'invalid-request');
        queue[item.subject][item.level] = line;
        transaction.set(queueRef, Object.assign({}, queue, { updatedAt: at }));
        return Object.assign({ id }, item, { status });
      });
    },
    async getSources() { const s = await meta().doc(SOURCES_DOC).get(); return s.exists ? s.data() : {}; },
    async saveSources(data) { await meta().doc(SOURCES_DOC).set(data, { merge: true }); },
    async savePrepareRun(id, data) { await prepareRuns().doc(id).set(data, { merge: true }); },
    async listPrepareRuns(count = 10) {
      const snapshot = await prepareRuns().orderBy('startedAt', 'desc').limit(count).get();
      return snapshot.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
    },

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

module.exports = { createDailyQuestionStore, QUEUE_LOOKAHEAD, forDay, chooseFromLine, hasBankSlot };
