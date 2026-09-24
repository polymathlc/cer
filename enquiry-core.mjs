// Shared form rules: Science P3–S1; Mathematics P4–P6. No child identifiers.
export const SUBJECT_LEVELS = Object.freeze({
  science: Object.freeze(['P3', 'P4', 'P5', 'P6', 'S1']),
  math: Object.freeze(['P4', 'P5', 'P6'])
});
export const ENQUIRY_ENDPOINT = 'https://us-central1-mathgen--app.cloudfunctions.net/submitPolymathEnquiry';

export function eligibleSubjects(level) {
  return Object.keys(SUBJECT_LEVELS).filter(subject => SUBJECT_LEVELS[subject].includes(level));
}

export function validateEnquiry(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const text = key => typeof value[key] === 'string' ? value[key].trim() : '';
  const rawPhone = typeof value.phone === 'string' ? value.phone : '';
  const selected = Array.isArray(value.subjects) ? value.subjects : [];
  const data = {
    parentName: text('parentName'), email: text('email').toLowerCase(),
    phone: rawPhone.trim().replace(/[ ().-]/g, ''), childLevel: text('childLevel'),
    subjects: ['science', 'math'].filter(subject => selected.includes(subject)),
    message: text('message')
  };
  const errors = {};
  if (!data.email || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'Enter a valid email address so we can reply.';
  if (!/^\+?\d{8,15}$/.test(data.phone) || /[\r\n\t]/.test(rawPhone)) errors.phone = 'Enter a phone number with 8–15 digits. You can include a country code, such as +65.';
  const allowed = eligibleSubjects(data.childLevel);
  if (!allowed.length) errors.childLevel = 'Choose your child’s current level.';
  if (!selected.length) errors.subjects = 'Choose at least one subject you are interested in.';
  else if (selected.some(subject => !allowed.includes(subject))) errors.subjects = 'Choose a subject available for your child’s level. Mathematics is offered from Primary 4 to Primary 6.';
  if (data.parentName.length > 100) errors.parentName = 'Keep your name to 100 characters or fewer.';
  if (data.message.length > 2000) errors.message = 'Keep your message to 2,000 characters or fewer.';
  return { valid: Object.keys(errors).length === 0, errors, data };
}

function fingerprint(data) {
  const normalized = validateEnquiry(data).data;
  return JSON.stringify(normalized);
}

// Keep the same key for uncertain retries, even if the visitor temporarily
// edits the form then returns to the original details. No contact data is
// written to browser storage. An accepted enquiry can be sent afresh later.
export function createSubmissionTracker(makeId = () => globalThis.crypto.randomUUID()) {
  const attempts = new Map();
  return {
    forPayload(data) {
      const key = fingerprint(data);
      if (!attempts.has(key)) attempts.set(key, makeId());
      return attempts.get(key);
    },
    accepted(data) { attempts.delete(fingerprint(data)); }
  };
}

function submissionError(kind) {
  const error = new Error(kind);
  error.kind = kind;
  return error;
}

// The centre's own published direct line — the same WhatsApp link the home page's
// About Us offers. It is shown beside a failure the parent may not be able to retry
// past, never instead of the server's confirmation.
export const DIRECT_CONTACT = Object.freeze({
  lead: 'If this keeps happening, you can also reach us directly on',
  label: 'WhatsApp +65 9022 3314',
  href: 'https://wa.me/6590223314'
});

// What the parent is told for each failure kind. Only `offline` may mention their
// connection: a server that refuses the page's origin, is down, or is blocked on
// the way looks exactly like a dead connection to fetch(), and telling a parent
// with working internet to check it sends them looking in the wrong place.
const FAILURES = Object.freeze({
  'rate-limit': { contact: true, text: 'We’re receiving several enquiries right now. Please wait a little, then try again. Your details are still here.' },
  unavailable: { contact: true, text: 'We couldn’t send your enquiry right now. Please try again in a little while. Your details are still here.' },
  validation: { contact: false, text: 'We couldn’t accept those details. Please check your email, contact number, child’s level, and subjects, then try again.' },
  timeout: { contact: true, text: 'We haven’t received confirmation yet. Your enquiry may have reached us. Please try again using the same details; we’ll use the same enquiry reference to avoid sending it twice.' },
  offline: { contact: false, text: 'Your device seems to be offline, so your enquiry wasn’t sent. Check your internet connection, then try again. Your details are still here, and retrying will use the same enquiry reference.' },
  network: { contact: true, text: 'We couldn’t reach our enquiry service just now, so your enquiry hasn’t been confirmed. Please try again in a moment. Your details are still here, and retrying will use the same enquiry reference.' },
  unknown: { contact: true, text: 'We couldn’t confirm that your enquiry was received. Please try again. Your details are still here, and retrying will use the same enquiry reference.' }
});

export function failureMessage(kind) {
  return FAILURES[typeof kind === 'string' && Object.hasOwn(FAILURES, kind) ? kind : 'unknown'];
}

// Only an explicit false is offline: navigator.onLine can report true without a
// working network, but never false with one.
function browserOnline() {
  return globalThis.navigator?.onLine !== false;
}

export async function sendEnquiry(payload, { fetchImpl = globalThis.fetch, timeoutMs = 15000, endpoint = ENQUIRY_ENDPOINT, isOnline = browserOnline } = {}) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(submissionError('timeout')); }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetchImpl(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal, credentials: 'omit'
    });
    if (response.status === 429) throw submissionError('rate-limit');
    if (response.status >= 500) throw submissionError('unavailable');
    if (response.status === 400 || response.status === 422) throw submissionError('validation');
    if (!response.ok) throw submissionError('unknown');
    let result;
    try { result = await response.json(); } catch { throw submissionError('unknown'); }
    if (result?.accepted !== true) throw submissionError('unknown');
    return result;
  })();
  try { return await Promise.race([request, deadline]); }
  catch (error) {
    if (error?.kind) throw error;
    if (controller.signal.aborted) throw submissionError('timeout');
    let offline = false;
    try { offline = isOnline() === false; } catch { /* unknown counts as online */ }
    throw submissionError(offline ? 'offline' : 'network');
  } finally { clearTimeout(timer); }
}
