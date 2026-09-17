'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { validateEnquiry, buildSubmission, createService, recipientConfiguration, EnquiryError, RETENTION_MS,
  REQUEST_COLLECTION, LIMIT_COLLECTION, MAIL_PREFIX } = require('../service');
const { createRepository } = require('../repository');

const RECIPIENTS = recipientConfiguration('centre-one@example.test,centre-two@example.test');
const submissionFor = (enquiry, ip, now) => buildSubmission(enquiry, ip, now, RECIPIENTS);
const NOW = Date.UTC(2026, 8, 18, 9);
const sample = () => ({ submissionId: randomUUID(), parentName: 'Test Parent', email: 'parent@example.test',
  phone: '+65 9123 4567', childLevel: 'P4', subjects: ['science', 'math'], message: 'Please share the schedule.' });

function database() {
  const rows = new Map();
  const ref = path => ({ path, id: path.split('/').at(-1) });
  const snapshot = reference => ({ exists: rows.has(reference.path), data: () => rows.get(reference.path), ...reference, ref: reference });
  let pending = Promise.resolve();
  const db = {
    rows,
    collection(name) { return {
      doc: id => ref(name + '/' + id),
      where(field, op, value) { assert.equal(op, '<='); return { limit(count) { return { async get() {
        const docs = [...rows.keys()].filter(path => path.startsWith(name + '/') && rows.get(path)[field] <= value)
          .slice(0, count).map(path => snapshot(ref(path)));
        return { empty: docs.length === 0, docs };
      } }; } }; }
    }; },
    runTransaction(action) {
      const run = pending.then(async () => {
        const writes = [];
        const result = await action({
          get: async reference => snapshot(reference), getAll: async (...references) => references.map(snapshot),
          set: (reference, data) => writes.push(['set', reference, data]),
          create: (reference, data) => writes.push(['create', reference, data])
        });
        for (const [type, reference] of writes) if (type === 'create' && rows.has(reference.path)) throw new Error('Already exists');
        for (const [, reference, data] of writes) rows.set(reference.path, data);
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
function requestHarness(repository) {
  const logs = [], service = createService({ repository, recipients: RECIPIENTS, now: () => NOW, report: code => logs.push(code) });
  return { logs, async request(body = sample(), overrides = {}) {
    const headers = { origin: 'https://polymathlc.github.io', 'content-type': 'application/json', ...overrides.headers };
    const req = { method: 'POST', body, ip: '192.0.2.1', ...overrides, get: name => headers[name.toLowerCase()] };
    const response = { headers: {}, statusCode: 200, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
      send(body) { this.body = body; return this; } };
    await service.handler(req, response); return response;
  } };
}

test('server recipients are required, fixed to two addresses and immutable', () => {
  for (const value of [undefined, '', 'one@example.test', 'one@example.test,one@example.test',
    'one@example.test,two@example.test,three@example.test', 'one@example.test,two@example.test\r\nBcc: bad@example.test'])
    assert.throws(() => recipientConfiguration(value));
  assert.equal(RECIPIENTS.length, 2);
  assert.equal(Object.isFrozen(RECIPIENTS), true);
});

test('science accepts exactly P3 through S1; maths only P4-P6', () => {
  for (const level of ['P3', 'P4', 'P5', 'P6', 'S1'])
    assert.equal(validateEnquiry({ ...sample(), childLevel: level, subjects: ['science'] }).childLevel, level);
  for (const level of ['P4', 'P5', 'P6'])
    assert.deepEqual(validateEnquiry({ ...sample(), childLevel: level, subjects: ['math'] }).subjects, ['math']);
  for (const level of ['P3', 'S1', 'P2', 'S2', 'p4'])
    assert.throws(() => validateEnquiry({ ...sample(), childLevel: level, subjects: ['math'] }), EnquiryError);
});
test('rejects header injection, arbitrary recipients, invalid subjects and oversized content', () => {
  for (const patch of [
    { email: 'parent@example.test\r\nBcc: attacker@example.test' }, { phone: 'not-a-number' },
    { subjects: [] }, { subjects: ['science', 'science'] }, { subjects: ['english'] },
    { to: ['attacker@example.test'] }, { parentName: 'x'.repeat(101) }, { message: 'a'.repeat(2001) },
    { submissionId: '../../mail' }, { email: 'parent@localhost' }, { message: { html: '<b>x</b>' } }
  ]) assert.throws(() => validateEnquiry({ ...sample(), ...patch }), EnquiryError);
});
test('parent name is optional and one-character names are accepted', async () => {
  for (const parentName of [undefined, '', ' ', 'X']) {
    const input = validateEnquiry({ ...sample(), parentName });
    assert.equal(input.parentName, parentName?.trim() || '');
    const db = database(), h = requestHarness(repositoryFor(db));
    assert.equal((await h.request(input)).statusCode, 202);
    if (!input.parentName)
      assert.match(submissionFor(input, '192.0.2.1', NOW).mail.message.text, /Parent: \(Not provided\)/);
  }
});

test('mail is server-addressed plaintext, with safe reply-to and no client headers', () => {
  const input = validateEnquiry({ ...sample(), message: '<img src=x onerror=alert(1)>' });
  const submission = submissionFor(input, '192.0.2.1', NOW);
  assert.deepEqual(submission.mail.to, RECIPIENTS);
  assert.equal(submission.mail.replyTo, input.email);
  assert.equal(submission.mail.message.html, undefined);
  assert.match(submission.mail.message.text, /<img src=x onerror=alert\(1\)>/);
  assert.ok(submission.quotas.every(quota => !quota.id.includes(input.email) && !quota.id.includes('192.0.2.1')));
});
test('transaction is idempotent under duplicate concurrent sends; conflicting reuse fails', async () => {
  const db = database(), repository = repositoryFor(db), input = sample();
  const submission = submissionFor(validateEnquiry(input), '192.0.2.1', NOW);
  const results = await Promise.all(Array.from({ length: 8 }, () => repository.reserve(submission)));
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  assert.equal([...db.rows.keys()].filter(key => key.startsWith('mail/')).length, 1);
  assert.ok([...db.rows.entries()].filter(([key]) => key.startsWith(LIMIT_COLLECTION + '/')).every(([,value]) => value.count === 1));
  await assert.rejects(repository.reserve(submissionFor(validateEnquiry({ ...input, phone: '+65 9876 5432' }), '192.0.2.1', NOW)),
    error => error.status === 409);
  const ledger = db.rows.get(REQUEST_COLLECTION + '/' + input.submissionId);
  assert.deepEqual(Object.keys(ledger).sort(), ['createdAt', 'expiresAt', 'fingerprint']);
});
test('email, IP and global quotas enforce independent limits with atomic failure', async () => {
  for (const scenario of ['email', 'ip', 'global']) {
    const db = database(), repository = repositoryFor(db);
    const count = scenario === 'email' ? 3 : scenario === 'ip' ? 5 : 100;
    for (let index = 0; index < count; index++) {
      const input = sample();
      if (scenario !== 'email') input.email = 'parent' + index + '@example.test';
      const ip = scenario === 'ip' ? '192.0.2.1' : '192.0.2.' + index;
      await repository.reserve(submissionFor(validateEnquiry(input), ip, NOW));
    }
    const extra = sample();
    if (scenario !== 'email') extra.email = 'extra@example.test';
    const before = db.rows.size;
    await assert.rejects(repository.reserve(submissionFor(validateEnquiry(extra), scenario === 'ip' ? '192.0.2.1' : '192.0.2.250', NOW)),
      error => error.status === 429);
    assert.equal(db.rows.size, before);
  }
});
test('expired enquiry and its email are deleted; unrelated mail and recent data remain', async () => {
  const db = database(), repository = repositoryFor(db), old = sample(), current = sample();
  await repository.reserve(submissionFor(validateEnquiry(old), '192.0.2.1', NOW));
  await repository.reserve(submissionFor(validateEnquiry(current), '192.0.2.2', NOW + RETENTION_MS));
  db.rows.set('mail/unrelated-email', { message: { text: 'Preserve' } });
  await repository.cleanup(NOW + RETENTION_MS + 1000);
  assert.equal(db.rows.has(REQUEST_COLLECTION + '/' + old.submissionId), false);
  assert.equal(db.rows.has('mail/' + MAIL_PREFIX + old.submissionId), false);
  assert.equal(db.rows.has('mail/' + MAIL_PREFIX + current.submissionId), true);
  assert.equal(db.rows.has('mail/unrelated-email'), true);
});
test('public HTTP boundary accepts only allowed JSON POSTs and handles CORS preflight without writes', async () => {
  const db = database(), h = requestHarness(repositoryFor(db));
  assert.equal((await h.request(sample(), { method: 'OPTIONS' })).statusCode, 204);
  assert.equal(db.rows.size, 0);
  assert.equal((await h.request(sample(), { headers: { origin: 'https://attacker.example' } })).statusCode, 403);
  assert.equal((await h.request(sample(), { headers: { origin: undefined } })).statusCode, 403);
  assert.equal((await h.request(sample(), { method: 'GET' })).statusCode, 405);
  assert.equal((await h.request(sample(), { headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  assert.equal((await h.request(sample(), { rawBody: Buffer.alloc(8193) })).statusCode, 413);
  const input = sample();
  const first = await h.request(input), retry = await h.request(input);
  assert.equal(first.statusCode, 202); assert.equal(retry.statusCode, 200);
  assert.deepEqual(first.body, { accepted: true, submissionId: input.submissionId });
  assert.equal(first.headers['Access-Control-Allow-Origin'], 'https://polymathlc.github.io');
});
test('storage failure never reports success or logs parent data', async () => {
  const h = requestHarness({ reserve: async () => { throw new Error('sensitive provider text'); } });
  const response = await h.request();
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.accepted, false);
  assert.deepEqual(h.logs, ['enquiry-storage-failed']);
});
