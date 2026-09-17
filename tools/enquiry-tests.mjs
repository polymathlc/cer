import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleSubjects,
  validateEnquiry,
  createSubmissionTracker,
  sendEnquiry
} from '../enquiry-core.mjs';

const fixture = (overrides = {}) => ({
  parentName: 'QA Parent',
  email: 'qa@example.test',
  phone: '+65 8123 4567',
  childLevel: 'P4',
  subjects: ['science'],
  message: 'Please share the class details.',
  ...overrides
});

function assertFieldError(overrides, field) {
  const result = validateEnquiry(fixture(overrides));
  assert.equal(result.valid, false);
  assert.ok(result.errors && typeof result.errors === 'object');
  assert.ok(Object.hasOwn(result.errors, field), `Expected an error for ${field}.`);
  assert.ok(result.errors[field]);
  return result;
}

test('subject eligibility follows the supported levels', () => {
  for (const level of ['P3', 'S1']) assert.deepEqual(eligibleSubjects(level), ['science']);
  for (const level of ['P4', 'P5', 'P6']) assert.deepEqual(eligibleSubjects(level), ['science', 'math']);
  for (const level of ['', 'P2', 'S2', 'p4', null, undefined, 4, {}, []]) {
    assert.deepEqual(eligibleSubjects(level), []);
  }
});

test('validation returns only normalized enquiry fields', () => {
  const result = validateEnquiry(fixture({
    parentName: '  QA Parent  ',
    email: '  QA@EXAMPLE.TEST  ',
    phone: ' +65 (8123)-45.67 ',
    subjects: ['math', 'science', 'math', 'science'],
    message: '  Please share the class details.  ',
    submissionId: 'untrusted-id',
    unexpected: 'discard this'
  }));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.data, {
    parentName: 'QA Parent',
    email: 'qa@example.test',
    phone: '+6581234567',
    childLevel: 'P4',
    subjects: ['science', 'math'],
    message: 'Please share the class details.'
  });
});

test('name and message are optional and normalize to empty strings', () => {
  const input = fixture();
  delete input.parentName;
  delete input.message;
  const result = validateEnquiry(input);
  assert.equal(result.valid, true);
  assert.equal(result.data.parentName, '');
  assert.equal(result.data.message, '');
});

test('validation does not mutate the supplied enquiry', () => {
  const input = fixture({ subjects: ['math', 'science', 'math'] });
  const before = structuredClone(input);
  validateEnquiry(input);
  assert.deepEqual(input, before);
});

test('required fields have separate, actionable errors', () => {
  const result = validateEnquiry({});
  assert.equal(result.valid, false);
  for (const field of ['email', 'phone', 'childLevel', 'subjects']) {
    assert.ok(Object.hasOwn(result.errors, field), `Expected an error for ${field}.`);
    assert.ok(result.errors[field]);
  }
});

test('email rejects missing or malformed addresses', () => {
  for (const email of ['', '   ', 'qa', 'qa@', '@example.test', 'qa@example', 'qa @example.test', 'qa@example .test', 'qa@@example.test', 'qa\n@example.test']) {
    assertFieldError({ email }, 'email');
  }
  assert.equal(validateEnquiry(fixture({ email: 'qa+enquiry@example.test' })).valid, true);
});

test('email accepts 254 characters and rejects 255', () => {
  const address = length => `${'q'.repeat(64)}@${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(length)}.test`;
  assert.equal(address(56).length, 254);
  assert.equal(validateEnquiry(fixture({ email: address(56) })).valid, true);
  assertFieldError({ email: address(57) }, 'email');
});

test('phone accepts local and international formatting with 8 to 15 digits', () => {
  for (const [phone, normalized] of [
    ['81234567', '81234567'],
    ['(8123) 45-67', '81234567'],
    ['+65 8123.4567', '+6581234567'],
    ['123456789012345', '123456789012345'],
    ['+123456789012345', '+123456789012345']
  ]) {
    const result = validateEnquiry(fixture({ phone }));
    assert.equal(result.valid, true, phone);
    assert.equal(result.data.phone, normalized);
  }
});

test('phone rejects short, long, alphabetic, multiline, or misplaced-plus input', () => {
  for (const phone of ['', '1234567', '+1234567', '1234567890123456', '+1234567890123456', '8123abcd', '+65 8123 4567 ext 1', '8123\n4567', '8123\r4567', '\n81234567', '81234567\n', '++6581234567', '+65+81234567', '65+81234567']) {
    assertFieldError({ phone }, 'phone');
  }
});

test('child level must be one of the supported levels', () => {
  for (const childLevel of ['', 'P2', 'S2', 'p4', 'Primary 4', 4, null]) {
    assertFieldError({ childLevel }, 'childLevel');
  }
});

test('science is accepted for every supported level', () => {
  for (const childLevel of ['P3', 'P4', 'P5', 'P6', 'S1']) {
    assert.equal(validateEnquiry(fixture({ childLevel, subjects: ['science'] })).valid, true);
  }
});

test('math is accepted only for P4 through P6', () => {
  for (const childLevel of ['P4', 'P5', 'P6']) {
    assert.equal(validateEnquiry(fixture({ childLevel, subjects: ['math'] })).valid, true);
    assert.equal(validateEnquiry(fixture({ childLevel, subjects: ['science', 'math'] })).valid, true);
  }
  for (const childLevel of ['P3', 'S1']) {
    assertFieldError({ childLevel, subjects: ['math'] }, 'subjects');
    assertFieldError({ childLevel, subjects: ['science', 'math'] }, 'subjects');
  }
});

test('subject selection rejects empty, unknown, or malformed values', () => {
  for (const subjects of [[], ['english'], ['science', 'english'], ['Science'], 'science', null, [null], [42], [{}]]) {
    assertFieldError({ subjects }, 'subjects');
  }
});

test('optional text limits accept the boundary and reject one character over', () => {
  for (const [field, limit] of [['parentName', 100], ['message', 2000]]) {
    assert.equal(validateEnquiry(fixture({ [field]: 'a'.repeat(limit) })).valid, true);
    assertFieldError({ [field]: 'a'.repeat(limit + 1) }, field);
  }
});

test('unexpected input types do not throw', () => {
  for (const input of [null, undefined, false, 42, 'enquiry', [], Symbol('input'), 1n]) {
    assert.doesNotThrow(() => validateEnquiry(input));
  }
  for (const field of ['parentName', 'email', 'phone', 'childLevel', 'message']) {
    for (const value of [null, undefined, 42, false, {}, [], Symbol('field'), 1n]) {
      assert.doesNotThrow(() => validateEnquiry(fixture({ [field]: value })), field);
    }
  }
});

test('message markup remains literal text', () => {
  const message = '<script>globalThis.enquiryTest = true</script> <b>Questions & answers</b>';
  const result = validateEnquiry(fixture({ message }));
  assert.equal(result.valid, true);
  assert.equal(result.data.message, message);
  assert.equal(globalThis.enquiryTest, undefined);
});

function trackerFixture() {
  let count = 0;
  return createSubmissionTracker(() => `test-enquiry-${++count}`);
}

test('a normalized payload retains its submission ID across uncertain retries', () => {
  const tracker = trackerFixture();
  const data = validateEnquiry(fixture()).data;
  const id = tracker.forPayload(data);
  assert.equal(id, 'test-enquiry-1');
  assert.equal(tracker.forPayload(data), id);
  assert.equal(tracker.forPayload(structuredClone(data)), id);
});

test('changed payloads get distinct IDs and reverting reuses the original ID', () => {
  const tracker = trackerFixture();
  const first = validateEnquiry(fixture()).data;
  const changed = validateEnquiry(fixture({ message: 'A different enquiry.' })).data;
  const firstId = tracker.forPayload(first);
  const changedId = tracker.forPayload(changed);
  assert.notEqual(firstId, changedId);
  assert.equal(tracker.forPayload(first), firstId);
  assert.equal(tracker.forPayload(changed), changedId);
});

test('acknowledgement releases only the accepted payload ID', () => {
  const tracker = trackerFixture();
  const accepted = validateEnquiry(fixture()).data;
  const uncertain = validateEnquiry(fixture({ subjects: ['math'] })).data;
  const acceptedId = tracker.forPayload(accepted);
  const uncertainId = tracker.forPayload(uncertain);
  tracker.accepted(structuredClone(accepted));
  assert.equal(tracker.forPayload(uncertain), uncertainId);
  const newId = tracker.forPayload(accepted);
  assert.notEqual(newId, acceptedId);
  assert.notEqual(newId, uncertainId);
  assert.equal(tracker.forPayload(accepted), newId);
});

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

const transportPayload = () => ({ ...validateEnquiry(fixture()).data, submissionId: 'test-request-id' });

test('transport posts the JSON payload with an abort signal and returns acceptance', async () => {
  const payload = transportPayload();
  const accepted = { accepted: true, submissionId: payload.submissionId };
  let calls = 0;
  const result = await sendEnquiry(payload, {
    endpoint: 'https://enquiries.example.test/submit',
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://enquiries.example.test/submit');
      assert.equal(options.method, 'POST');
      assert.equal(new Headers(options.headers).get('content-type'), 'application/json');
      assert.deepEqual(JSON.parse(options.body), payload);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, false);
      return response(200, accepted);
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, accepted);
});

for (const [status, kind] of [[400, 'validation'], [422, 'validation'], [429, 'rate-limit'], [500, 'unavailable'], [503, 'unavailable'], [401, 'unknown']]) {
  test(`transport preserves ${kind} error for HTTP ${status}`, async () => {
    await assert.rejects(
      sendEnquiry(transportPayload(), { fetchImpl: async () => response(status, { accepted: false }) }),
      error => error instanceof Error && error.kind === kind
    );
  });
}

test('transport preserves network failures as uncertain network errors', async () => {
  await assert.rejects(
    sendEnquiry(transportPayload(), { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
    error => error instanceof Error && error.kind === 'network'
  );
});

test('HTTP failure classification survives a non-JSON error page', async () => {
  for (const [status, kind] of [[503, 'unavailable'], [429, 'rate-limit'], [400, 'validation']]) {
    await assert.rejects(
      sendEnquiry(transportPayload(), {
        fetchImpl: async () => ({ ok: false, status, json: async () => { throw new SyntaxError('HTML error page'); } })
      }),
      error => error instanceof Error && error.kind === kind
    );
  }
});

test('transport requires both a successful status and explicit true acceptance', async () => {
  for (const body of [{ accepted: false }, {}, { accepted: 'true' }, null]) {
    await assert.rejects(
      sendEnquiry(transportPayload(), { fetchImpl: async () => response(200, body) }),
      error => error instanceof Error && error.kind === 'unknown'
    );
  }
  await assert.rejects(
    sendEnquiry(transportPayload(), { fetchImpl: async () => response(503, { accepted: true }) }),
    error => error instanceof Error && error.kind === 'unavailable'
  );
});

test('transport treats malformed successful response JSON as unknown', async () => {
  await assert.rejects(
    sendEnquiry(transportPayload(), {
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Invalid JSON'); } })
    }),
    error => error instanceof Error && error.kind === 'unknown'
  );
});

test('transport times out, aborts the request, and reports an uncertain timeout', { timeout: 1000 }, async () => {
  let signal;
  await assert.rejects(
    sendEnquiry(transportPayload(), {
      timeoutMs: 10,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        signal = options.signal;
        signal.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    }),
    error => error instanceof Error && error.kind === 'timeout'
  );
  assert.equal(signal.aborted, true);
});
