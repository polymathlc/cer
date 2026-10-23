'use strict';
// The in-memory Firestore and Stripe the booking tests run against: the same
// stand-ins shop.test.js defines, so both suites exercise the real repository.
const assert = require('node:assert/strict');
const { createRepository } = require('../repository');
const { StripeError } = require('../stripe');

// An in-memory Firestore with just the calls the repository makes.
function database(seed = {}) {
  const rows = new Map(Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]));
  const ref = path => ({
    path, id: path.split('/').at(-1),
    async get() { return snapshot(this); },
    async update(data) { if (!rows.has(path)) throw new Error('No document'); rows.set(path, Object.assign({}, rows.get(path), data)); }
  });
  const snapshot = reference => ({ exists: rows.has(reference.path), data: () => structuredClone(rows.get(reference.path)), ref: reference, id: reference.id });
  let pending = Promise.resolve();
  const db = {
    rows,
    collection(name) { return {
      doc: id => ref(name + '/' + id),
      where(field, op, value) { assert.equal(op, '<='); return { limit(count) { return { async get() {
        const docs = [...rows.keys()].filter(path => path.startsWith(name + '/') && path.split('/').length === 2
          && rows.get(path)[field] <= value).slice(0, count).map(path => snapshot(ref(path)));
        return { empty: docs.length === 0, docs };
      } }; } }; }
    }; },
    async getAll(...references) { return references.map(snapshot); },
    runTransaction(action) {
      const run = pending.then(async () => {
        const writes = [];
        let wrote = false;
        const read = reference => { if (wrote) throw new Error('Read after write in a transaction'); return snapshot(reference); };
        const result = await action({
          get: async reference => read(reference),
          getAll: async (...references) => references.map(read),
          set: (reference, data) => { wrote = true; writes.push(['set', reference, data]); },
          create: (reference, data) => { wrote = true; writes.push(['create', reference, data]); },
          update: (reference, data) => { wrote = true; writes.push(['update', reference, data]); }
        });
        for (const [type, reference] of writes) {
          if (type === 'create' && rows.has(reference.path)) throw new Error('Already exists');
          if (type === 'update' && !rows.has(reference.path)) throw new Error('No document');
        }
        for (const [type, reference, data] of writes)
          rows.set(reference.path, type === 'update' ? Object.assign({}, rows.get(reference.path), data) : structuredClone(data));
        return result;
      });
      pending = run.catch(() => {});
      return run;
    },
    batch() { const deletions = []; return {
      delete: reference => deletions.push(reference.path), commit: async () => deletions.forEach(path => rows.delete(path))
    }; }
  };
  return db;
}
const repositoryFor = db => createRepository(db, { fromMillis: value => value });

// A Stripe that remembers the sessions it made and can be told one was paid.
function fakeStripe() {
  const sessions = new Map(), calls = [];
  let counter = 0;
  return {
    sessions, calls,
    async createCheckoutSession(params, idempotencyKey) {
      calls.push({ params, idempotencyKey });
      const id = 'cs_test_' + String(++counter).padStart(10, '0');
      const amount = params.line_items.reduce((sum, line) => sum + line.price_data.unit_amount * line.quantity, 0);
      const session = { id, url: 'https://checkout.stripe.com/c/pay/' + id, status: 'open', payment_status: 'unpaid',
        client_reference_id: params.client_reference_id, metadata: params.metadata, amount_total: amount, currency: 'sgd', payment_intent: null };
      sessions.set(id, session);
      return session;
    },
    async retrieveCheckoutSession(id) {
      if (!sessions.has(id)) throw new StripeError(502, 'stripe-error', 'invalid_request_error:resource_missing');
      return structuredClone(sessions.get(id));
    },
    pay(id) { Object.assign(sessions.get(id), { status: 'complete', payment_status: 'paid', payment_intent: 'pi_test_' + id.slice(-6) }); }
  };
}


module.exports = { database, repositoryFor, fakeStripe };
