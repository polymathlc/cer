// Jev on the server: the provider call, the input guard and the allowance.
// The API key is a Firebase secret bound to the functions that use it and is
// never sent to a browser. Jev returns typed decisions, never prose.
import { JEV_ENDPOINT, JEV_BODY_LIMIT, buildReviewRequest, readReview } from './jev-review-core.js';

export class JevUnavailable extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// The browser sends measured FACTS. They are still untrusted input: bounded in
// depth, width and length, and only ever forwarded as data for Jev to read.
export function clipDeep(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return value.slice(0, 1500);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value;
  if (depth >= 5) return null;
  if (Array.isArray(value)) return value.slice(0, 24).map(v => clipDeep(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) {
      if (/^[A-Za-z0-9_]{1,40}$/.test(k)) out[k] = clipDeep(v, depth + 1);
    }
    return out;
  }
  return null;
}

export function cleanInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new JevUnavailable('invalid', 'Invalid review request.');
  const scope = ['figures', 'question', 'all'].includes(input.scope) ? input.scope : 'all';
  const question = input.question === undefined && scope === 'figures' ? undefined : clipDeep(input.question);
  if (scope !== 'figures' && (!question || typeof question !== 'object' || Array.isArray(question))) throw new JevUnavailable('invalid', 'Invalid review request.');
  const figures = Array.isArray(input.figures) ? input.figures.slice(0, 8).map(f => clipDeep(f)) : [];
  if (figures.some(f => !f || typeof f !== 'object' || Array.isArray(f))) throw new JevUnavailable('invalid', 'Invalid review request.');
  if (scope !== 'question' && !figures.length && scope === 'figures') throw new JevUnavailable('invalid', 'Nothing to review.');
  return { question, figures, scope };
}

export async function jevReview(input, { apiKey, fetchImpl = fetch, timeoutMs = 9000 }) {
  const key = typeof apiKey === 'function' ? apiKey() : apiKey;
  if (typeof key !== 'string' || !key.trim()) throw new JevUnavailable('not_configured', 'Jev is not configured yet.');
  const body = buildReviewRequest(cleanInput(input));
  const text = JSON.stringify(body);
  if (text.length > JEV_BODY_LIMIT) throw new JevUnavailable('invalid', 'The review request is too large.');
  let response;
  try {
    response = await fetchImpl(JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: text, signal: AbortSignal.timeout(timeoutMs)
    });
  } catch { throw new JevUnavailable('unavailable', 'Jev could not be reached.'); }
  // Upstream error bodies can contain secrets: never read or return them.
  if (!response.ok) {
    if (response.status === 429 || response.status === 529) throw new JevUnavailable('busy', 'Jev is busy.');
    throw new JevUnavailable('unavailable', 'Jev could not check this.');
  }
  try { return readReview(await response.json(), body); }
  catch { throw new JevUnavailable('invalid_response', 'Jev returned an unreadable answer.'); }
}

export const JEV_LIMITS = Object.freeze({ perMinute: 90, perDay: 4000 });

// Counters only. No question content is ever persisted.
export async function jevAllow(db, uid, now = Date.now()) {
  const ref = db.collection('cerJevLimits').doc(uid);
  const minute = Math.floor(now / 60000);
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  let allowed = true;
  await db.runTransaction(async tx => {
    const v = (await tx.get(ref)).data() || {};
    const minuteCount = v.minute === minute ? Number(v.minuteCount || 0) : 0;
    const dayCount = v.day === day ? Number(v.dayCount || 0) : 0;
    if (minuteCount >= JEV_LIMITS.perMinute || dayCount >= JEV_LIMITS.perDay) { allowed = false; return; }
    tx.set(ref, { minute, minuteCount: minuteCount + 1, day, dayCount: dayCount + 1 });
  });
  return allowed;
}
