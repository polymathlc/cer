import assert from 'node:assert/strict';
import { createStudentQuestionHistory } from '../student-question-history.js';

// An optimistic transaction emulator: reads remember document versions and a
// conflicting commit re-runs the callback. This exercises competing tabs using
// separate ledger instances; it does not merely serialize their API calls.
const clone = value => value === undefined ? undefined : structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function firestore() {
  const data = new Map(), versions = new Map(), listeners = new Set();
  const db = {}, stats = { reads: 0, attempts: 0, commits: 0, batches: [], retries: 0 };
  const control = { cached: false, getError: null, getGate: null, transactionError: null, failAttempt: 0, beforeCommit: null };
  const document = (path, row = data.get(path)) => ({ exists: () => row !== undefined, data: () => clone(row) });
  const snapshot = (ref, fromCache = control.cached) => ({ metadata: { fromCache }, forEach(fn) {
    for (const [key, row] of data) if (key.startsWith(ref + '/') && !key.slice(ref.length + 1).includes('/')) fn(document(key, row));
  } });
  const emit = ref => { for (const l of listeners) if (l.ref === ref) l.next(snapshot(ref)); };
  const api = {
    db, doc: (ref, key) => ref + '/' + key,
    collection: (database, ...parts) => { assert.equal(database, db); return parts.join('/'); },
    async getDocs(ref) { stats.reads++; const gate = control.getGate; if (gate) await gate.promise; if (control.getError) throw control.getError; return snapshot(ref); },
    onSnapshot(ref, next, error) { const l = { ref, next, error }; listeners.add(l); return () => listeners.delete(l); },
    async runTransaction(database, callback) {
      assert.equal(database, db);
      for (let retry = 0; retry < 20; retry++) {
        stats.attempts++; const reads = new Map(), writes = new Map();
        const result = await callback({ async get(ref) {
          assert.equal(writes.size, 0, 'Transactions must complete all reads before any write');
          const row = clone(data.get(ref)); reads.set(ref, versions.get(ref) || 0); return document(ref, row);
        }, set(ref, row) { writes.set(ref, clone(row)); } });
        if (control.beforeCommit) await control.beforeCommit({ reads, writes });
        if (control.transactionError) throw control.transactionError;
        if (control.failAttempt === stats.attempts) throw Error('Interrupted transaction');
        if ([...reads].some(([ref, version]) => (versions.get(ref) || 0) !== version)) { stats.retries++; continue; }
        if (writes.size) {
          for (const [ref, row] of writes) { data.set(ref, row); versions.set(ref, (versions.get(ref) || 0) + 1); }
          stats.commits++; stats.batches.push(writes.size);
          for (const ref of new Set([...writes.keys()].map(key => key.slice(0, key.lastIndexOf('/'))))) emit(ref);
        }
        return result;
      }
      throw Error('Too much contention');
    },
  };
  return { api, data, control, stats, listeners, emit, error(error) { for (const l of [...listeners]) l.error(error); } };
}
function ledger(store, subject = 'math') {
  const errors = [];
  const api = createStudentQuestionHistory({ ...store.api, subject, onError: e => errors.push(e.message) });
  return Object.assign(api, { errors });
}
const identity = { uid: 'student-a', profile: '' };
const entry = (id, contentKey = 'content-' + id, at = 1000) => ({ id, contentKey, at });
function overlapFirstTwoCommits(store) {
  const gate = deferred(); let arrivals = 0;
  store.control.beforeCommit = async () => {
    if (arrivals >= 2) return;
    arrivals++; if (arrivals === 2) gate.resolve(); await gate.promise;
  };
}
const cases = [];
const test = (name, run) => cases.push({ name, run });

test('Claims persist across instances and exclude both renamed content and edited IDs', async () => {
  const s = firestore(), a = ledger(s); await a.open(identity);
  assert.equal(await a.claimMany([entry('one')]), true); a.close();
  const b = ledger(s); await b.open(identity);
  assert.equal(b.has('one'), true); assert.equal(b.has('different-id', 'content-one'), true);
  assert.equal(await b.claimMany([entry('one', 'edited-content')]), false);
  assert.equal(await b.claimMany([entry('renamed', 'content-one')]), false);
  assert.equal(s.data.size, 2); assert.equal(b.snapshot().seen.one, 1000);
});

test('Two devices claiming the same question have exactly one winner', async () => {
  const s = firestore(), a = ledger(s), b = ledger(s); await Promise.all([a.open(identity), b.open(identity)]);
  overlapFirstTwoCommits(s);
  const winners = await Promise.all([a.claimMany([entry('same')]), b.claimMany([entry('same')])]);
  assert.equal(winners.filter(Boolean).length, 1); assert.equal(s.data.size, 2);
  assert.ok(s.stats.retries >= 1, 'The loser must observe a retried read, not overwrite the winner');
  assert.ok(a.has('same') && b.has('same'));
});

test('Different IDs with identical content also contend across devices', async () => {
  const s = firestore(), a = ledger(s), b = ledger(s); await Promise.all([a.open(identity), b.open(identity)]);
  overlapFirstTwoCommits(s);
  const winners = await Promise.all([a.claimMany([entry('left', 'identical')]), b.claimMany([entry('right', 'identical')])]);
  assert.equal(winners.filter(Boolean).length, 1); assert.equal(s.data.size, 2);
  assert.ok(a.has('anything', 'identical') && b.has('anything', 'identical'));
});

test('Overlapping rounds commit all-or-nothing and leave losing fresh questions available', async () => {
  const s = firestore(), a = ledger(s), b = ledger(s); await Promise.all([a.open(identity), b.open(identity)]);
  overlapFirstTwoCommits(s);
  const rounds = [[entry('a'), entry('shared')], [entry('b'), entry('shared')]];
  const outcomes = await Promise.all([a.claimMany(rounds[0]), b.claimMany(rounds[1])]);
  assert.equal(outcomes.filter(Boolean).length, 1); assert.equal(s.data.size, 4);
  const losingId = outcomes[0] ? 'b' : 'a'; assert.equal(await a.claimMany([entry(losingId)]), true);
});

test('Duplicate IDs, duplicate content, and missing IDs in a batch fail without a partial claim', async () => {
  const s = firestore(), a = ledger(s); await a.open(identity);
  for (const rows of [[entry('a'), entry('a', 'different')], [entry('a', 'same'), entry('b', 'same')], [entry('a'), entry('', 'b')]]) {
    assert.equal(await a.claimMany(rows), false); assert.equal(s.data.size, 0);
  }
  assert.equal(await a.claimMany([entry('a'), entry('b')]), true);
});

test('Failed initial reads can be retried for the same account without refreshing', async () => {
  const s = firestore(), a = ledger(s); s.control.getError = Error('Offline');
  await assert.rejects(a.open(identity), /Offline/); assert.equal(a.isReady(identity), false);
  s.control.getError = null; assert.equal(await a.open(identity), true); assert.equal(s.stats.reads, 2);
  assert.equal(await a.claimMany([entry('recovered')]), true);
});

test('Cached history fails closed and reconnect performs a fresh server read', async () => {
  const s = firestore(), a = ledger(s); s.control.cached = true;
  await assert.rejects(a.open(identity), /Connect to the internet/);
  await assert.rejects(a.claimMany([entry('blocked')]), /still syncing/); assert.equal(s.data.size, 0);
  s.control.cached = false; assert.equal(await a.open(identity), true); assert.equal(s.stats.reads, 2);
});

test('Listener errors suspend exposure and reconnect recreates the subscription', async () => {
  const s = firestore(), a = ledger(s); await a.open(identity); await a.claimMany([entry('kept')]);
  s.error(Error('Listener unavailable')); assert.equal(a.isReady(), false);
  await assert.rejects(a.claimMany([entry('blocked')]), /still syncing/);
  assert.equal(await a.open(identity), true); assert.equal(s.listeners.size, 1); assert.ok(a.has('kept'));
});

test('Interrupted migration retries its union without overwriting earlier timestamps', async () => {
  const s = firestore(), a = ledger(s); const rows = Array.from({ length: 260 }, (_, i) => entry('old-' + i, 'body-' + i, 100 + i));
  s.control.failAttempt = 2; await assert.rejects(a.open(identity, rows), /Interrupted/);
  assert.equal(a.isReady(), false); assert.equal(s.data.size, 200);
  const committed = structuredClone([...s.data]); s.control.failAttempt = 0;
  assert.equal(await a.open(identity, rows.map(row => ({ ...row, at: 999999 }))), true);
  assert.equal(s.data.size, 520); for (const [key, row] of committed) assert.deepEqual(s.data.get(key), row);
  assert.equal(Object.keys(a.snapshot().seen).length, 260);
});

test('Permanent union exceeds old local caps and is not truncated on re-open', async () => {
  const s = firestore(), a = ledger(s), rows = Array.from({ length: 3005 }, (_, i) => entry('history-' + i, 'body-' + i, 1 + i));
  assert.equal(await a.open(identity, rows), true); assert.equal(s.data.size, 6010);
  assert.ok(s.stats.batches.every(n => n <= 200)); assert.equal(Object.keys(a.snapshot().seen).length, 3005);
  a.close(); const b = ledger(s); assert.equal(await b.open(identity, [entry('extra')]), true);
  assert.ok(b.has('history-0') && b.has('history-3004') && b.has('extra'));
  assert.equal(Object.keys(b.snapshot().seen).length, 3006);
});

test('Repeated migrations merge new identities and preserve cloud markers unchanged', async () => {
  const s = firestore(), a = ledger(s); await a.open(identity, [entry('old', 'old-body', 17)]);
  const original = structuredClone([...s.data]);
  await a.open(identity, [entry('old', 'old-body', 99), entry('new', 'new-body', 22)]);
  for (const [key, row] of original) assert.deepEqual(s.data.get(key), row);
  assert.equal(a.snapshot().seen.old, 17); assert.equal(a.snapshot().seen.new, 22); assert.equal(s.data.size, 4);
});

test('Accounts, child profiles and subjects have separate permanent namespaces', async () => {
  const s = firestore(), a = ledger(s); const people = [{ uid: 'parent', profile: 'child-a' }, { uid: 'parent', profile: 'child-b' }, { uid: 'other', profile: 'child-a' }];
  for (const person of people) { await a.open(person); assert.equal(a.has('same'), false); assert.equal(await a.claimMany([entry('same')]), true); }
  const science = ledger(s, 'science'); await science.open(people[0]); assert.equal(await science.claimMany([entry('same')]), true);
  await a.open(people[0]); assert.equal(await a.claimMany([entry('same')]), false); assert.equal(s.data.size, 8);
});

test('An old opening cannot replace a newly selected account or child', async () => {
  const s = firestore(), a = ledger(s), gate = deferred(); s.control.getGate = gate;
  const first = a.open({ uid: 'parent', profile: 'first' }, [entry('only-first')]);
  while (s.stats.reads < 1) await new Promise(resolve => setImmediate(resolve));
  s.control.getGate = null; assert.equal(await a.open({ uid: 'parent', profile: 'second' }), true);
  gate.resolve(); assert.equal(await first, false);
  assert.equal(a.isReady({ uid: 'parent', profile: 'second' }), true); assert.equal(a.has('only-first'), false); assert.equal(s.listeners.size, 1);
});

test('An in-flight claim cannot expose a result or history to a switched child', async () => {
  const s = firestore(), a = ledger(s), gate = deferred(), entered = deferred();
  await a.open({ uid: 'parent', profile: 'first' });
  s.control.beforeCommit = async () => { entered.resolve(); await gate.promise; };
  const claim = a.claimMany([entry('first-only')]); await entered.promise;
  s.control.beforeCommit = null; await a.open({ uid: 'parent', profile: 'second' }); gate.resolve();
  assert.equal(await claim, false); assert.equal(a.has('first-only'), false);
  assert.equal(a.isReady({ uid: 'parent', profile: 'second' }), true);
  assert.equal(await a.claimMany([entry('first-only')]), true);
});

test('Ambiguous committed responses never cause the same question to be reissued', async () => {
  const s = firestore(), api = { ...s.api }, realTransaction = api.runTransaction; let loseResponse = true;
  api.runTransaction = async (...args) => { const result = await realTransaction(...args); if (loseResponse) { loseResponse = false; throw Error('Response lost'); } return result; };
  const a = createStudentQuestionHistory({ ...api, subject: 'math' }); await a.open(identity);
  await assert.rejects(a.claimMany([entry('maybe-shown')]), /Response lost/);
  assert.equal(a.isReady(), false);
  await assert.rejects(a.claimMany([entry('maybe-shown')]), /still syncing/);
  assert.equal(await a.open(identity), true);
  assert.equal(await a.claimMany([entry('maybe-shown')]), false); assert.equal(s.data.size, 2);
});

test('Failed writes suspend further claims until a successful reconnect', async () => {
  const s = firestore(), a = ledger(s); await a.open(identity);
  s.control.transactionError = Error('Network unavailable');
  await assert.rejects(a.claimMany([entry('not-committed')]), /Network unavailable/);
  assert.equal(a.isReady(), false); assert.equal(s.data.size, 0);
  const attempts = s.stats.attempts;
  await assert.rejects(a.claimMany([entry('another')]), /still syncing/);
  assert.equal(s.stats.attempts, attempts, 'Suspended claims must not keep attempting cloud writes');
  s.control.transactionError = null; assert.equal(await a.open(identity), true);
  assert.equal(await a.claimMany([entry('not-committed')]), true);
});

test('Live synchronization learns another device claim and close clears only local state', async () => {
  const s = firestore(), a = ledger(s), b = ledger(s); await Promise.all([a.open(identity), b.open(identity)]);
  await b.claimMany([entry('remote')]); assert.ok(a.has('remote')); assert.ok(a.has('renamed', 'content-remote'));
  a.close(); assert.equal(a.isReady(), false); assert.deepEqual(a.snapshot(), { seen: {}, contentKeys: [] }); assert.equal(s.data.size, 2);
  assert.equal(await a.open({ uid: '../invalid' }), false); assert.equal(s.data.size, 2);
});

test('Oversized requests fail without writing and empty content still blocks the question ID', async () => {
  const s = firestore(), a = ledger(s); await a.open(identity);
  await assert.rejects(a.claimMany(Array.from({ length: 201 }, (_, i) => entry('q-' + i))), /at most 200/);
  await assert.rejects(a.claimMany([entry('x'.repeat(1501))]), /Invalid question-history/);
  await assert.rejects(a.claimMany([entry('a', 'x'.repeat(257))]), /Invalid question-history/);
  assert.equal(s.data.size, 0); assert.equal(await a.claimMany([entry('id-only', '')]), true);
  assert.equal(await a.claimMany([entry('id-only', 'later-content')]), false);
});

let failed = 0;
for (const { name, run } of cases) {
  try { await run(); console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name); console.error(error); }
}
console.log(`${cases.length - failed}/${cases.length} permanent question-history tests passed`);
if (failed) process.exitCode = 1;
