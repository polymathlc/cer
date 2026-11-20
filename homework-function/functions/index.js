// Firebase Cloud Function: homeworkHelper  (Polymath Homework Helper v1.0.0)
//
// The page polymathlc.com.sg/homework (cer homework/) sends a photo of ONE
// homework question; the AI coaches the student with step-by-step hints and
// never hands over the final answer. Only enrolled students (studentAccess
// status "approved", the same approval as every Polymath app) and the centre's
// staff may use it, each with a daily allowance.
//
//   Authorization: Bearer <Firebase ID token>   (always)
//   POST {mode:'status'}                         → {ok, access, children, allowance}
//   POST {mode:'start', imageDataUrl, note?, childIndex?, level?}
//        → {ok, result:{needs, message, subject, topic, question, encouragement, steps:[{goal, hints[]}], checkIn},
//           session, allowance}
//   POST {mode:'reply', session, message, history?, hintsSeen?}
//        → {ok, result:{verdict, message, step}, allowance}
//
// The final answer only ever lives inside `session`, sealed with AES-256-GCM
// under a key derived from the server secret, so the browser cannot read it,
// and the answer guard (core.js) blanks it out of every hint and reply.
//
// The OpenAI key is the existing Firebase secret OPENAI_API_KEY (the same one
// visualiseAi uses); it never leaves the server. Usage counters live in the
// server-only collection polymathEnquiryLimits (see core.js USAGE_COLLECTION).
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  VERSION, HelperError, REFUSALS, ORIGINS, DEV_ORIGIN, originAllowed, accessDecision, bearerToken, parseRequest,
  MAX_BODY_BYTES, DEFAULT_MODEL, buildStartBody, buildReplyBody, cleanStartReply, cleanReply,
  studentView, sealSession, openSession, sessionPayload, guardReply,
  singaporeDay, USAGE_COLLECTION, usageDocId, allowanceView, takeUse, giveBack, cleanLevel,
} from './core.js';

initializeApp();
const db = getFirestore();

const openaiKey = defineSecret('OPENAI_API_KEY');
const openaiModel = defineString('HOMEWORK_OPENAI_MODEL', { default: DEFAULT_MODEL });

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const START_TIMEOUT_MS = 150000;
const REPLY_TIMEOUT_MS = 90000;

function send(res, status, body) {
  res.status(status).json(body);
}
function fail(res, err) {
  const status = err instanceof HelperError ? err.status : (err && err.status) || 500;
  const body = { ok: false, error: (err && err.message) || 'Something went wrong. Please try again.', code: (err && err.code) || 'error' };
  if (err && err.extra) Object.assign(body, err.extra);
  send(res, status, body);
}

async function callOpenAI(body, timeoutMs) {
  const key = openaiKey.value();
  if (!key) throw new HelperError(500, 'no-key', 'The Homework Helper is not set up yet. Please tell the centre.');
  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const timedOut = cause && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    throw new HelperError(timedOut ? 504 : 502, 'ai-unreachable', timedOut ? 'The helper took too long to think. Please try again.' : 'The helper could not be reached. Please try again.');
  }
  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) { /* not JSON */ }
  if (!response.ok) {
    logger.warn('OpenAI error', { status: response.status, upstream: (data && data.error && data.error.message) || raw.slice(0, 300) });
    throw new HelperError(response.status === 429 ? 503 : 502, 'ai-error', response.status === 429
      ? 'The helper is very busy right now. Please try again in a minute.'
      : 'The helper could not answer just now. Please try again.');
  }
  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (!content) {
    throw new HelperError(502, 'ai-empty', choice && choice.message && choice.message.refusal
      ? 'The helper could not help with that photo. Please send a photo of a school question.'
      : 'The helper could not answer just now. Please try again.');
  }
  return content;
}

async function loadAccess(token) {
  let record = null;
  if (!(token.homeworkSelfTest === true)) {
    const snap = await db.collection('studentAccess').doc(token.uid).get();
    record = snap.exists ? snap.data() : null;
  }
  return accessDecision(token, record);
}

function usageRef(uid, day) {
  return db.collection(USAGE_COLLECTION).doc(usageDocId(uid, day));
}

async function readUsage(uid, day) {
  const snap = await usageRef(uid, day).get();
  return snap.exists ? snap.data() : {};
}

/** Count one use before the AI call (so two tabs cannot both slip past the limit). */
async function reserve(uid, kind, what) {
  const day = singaporeDay();
  const ref = usageRef(uid, day);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = takeUse(kind, snap.exists ? snap.data() : {}, what);
    tx.set(ref, { ...next, uid, day, app: 'homework-helper', kind, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { day, usage: next };
  });
}

async function refund(uid, day, what) {
  const ref = usageRef(uid, day);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      tx.set(ref, giveBack(snap.exists ? snap.data() : {}, what), { merge: true });
    });
  } catch (e) {
    logger.warn('homeworkHelper refund failed', { message: e.message });
  }
}

export const homeworkHelper = onRequest(
  {
    region: 'us-central1',
    secrets: [openaiKey],
    cors: [...ORIGINS, DEV_ORIGIN],
    timeoutSeconds: 180,
    memory: '512MiB',
    maxInstances: 5,
    concurrency: 20,
    invoker: 'public',
  },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method === 'GET') { send(res, 200, { ok: true, service: 'homeworkHelper', version: VERSION }); return; }
    if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'Use POST.' }); return; }
    const origin = req.get('origin') || '';
    // Browsers always send Origin on a cross-site POST; scripts (the deploy self-test) may leave it out.
    if (origin && !originAllowed(origin)) { send(res, 403, { ok: false, error: 'This page is not allowed to use the helper.' }); return; }

    const declared = Number(req.get('content-length') || 0);
    const rawSize = req.rawBody ? req.rawBody.length : declared;
    if (declared > MAX_BODY_BYTES || rawSize > MAX_BODY_BYTES) {
      fail(res, new HelperError(413, 'too-big', 'That photo is too large. Try again a little further away.'));
      return;
    }

    const started = Date.now();
    let uid = '';
    let reserved = null;
    let what = '';
    try {
      const idToken = bearerToken(req.get('authorization'));
      if (!idToken) throw new HelperError(401, 'signed-out', REFUSALS['signed-out']);
      let token;
      try { token = await getAuth().verifyIdToken(idToken); } catch (_) {
        throw new HelperError(401, 'signed-out', 'Your sign-in has expired. Please reload the page and sign in again.');
      }
      uid = token.uid;

      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
      const request = parseRequest(body);

      const access = await loadAccess(token);
      if (!access.allowed) {
        throw new HelperError(403, access.reason, REFUSALS[access.reason] || REFUSALS['not-enrolled'], { access: access.reason });
      }

      if (request.mode === 'status') {
        const usage = await readUsage(uid, singaporeDay());
        send(res, 200, {
          ok: true, version: VERSION, access: access.kind,
          children: access.children.map(({ name, level }) => ({ name, level })),
          allowance: allowanceView(access.kind, usage),
        });
        return;
      }

      const model = openaiModel.value() || DEFAULT_MODEL;

      if (request.mode === 'start') {
        const child = access.children[request.childIndex] || access.children[0] || null;
        // A student's level comes from their approval; staff (no children) may pick one to test with.
        const level = child ? child.level : (cleanLevel(request.level) || 'P5');
        what = 'photos';
        reserved = await reserve(uid, access.kind, what);
        const content = await callOpenAI(buildStartBody({
          imageDataUrl: request.imageDataUrl, level, note: request.note, childName: child && child.name, model,
        }), START_TIMEOUT_MS);
        let clean;
        try { clean = cleanStartReply(content); } catch (e) { throw new HelperError(502, 'ai-unreadable', 'The helper got muddled. Please try again.'); }
        const { view, guarded } = studentView(clean);
        let session = '';
        if (clean.needs === 'ok') {
          session = sealSession(sessionPayload(clean, { uid, level }), openaiKey.value());
        } else {
          // Nothing to coach yet (blurry photo, several questions): it does not count.
          await refund(uid, reserved.day, what);
          reserved.usage = { ...reserved.usage, photos: Math.max(0, reserved.usage.photos - 1) };
        }
        logger.info('homeworkHelper start', { kind: access.kind, level, needs: clean.needs, subject: clean.subject, steps: clean.steps.length, guarded, ms: Date.now() - started });
        send(res, 200, { ok: true, result: view, session, level, allowance: allowanceView(access.kind, reserved.usage) });
        return;
      }

      if (request.mode === 'reply') {
        const session = openSession(request.session, openaiKey.value(), uid);
        what = 'replies';
        reserved = await reserve(uid, access.kind, what);
        const content = await callOpenAI(buildReplyBody({
          session, history: request.history, message: request.message, hintsSeen: request.hintsSeen, model,
        }), REPLY_TIMEOUT_MS);
        let reply;
        try { reply = cleanReply(content); } catch (e) { throw new HelperError(502, 'ai-unreadable', 'The helper got muddled. Please try again.'); }
        const guardedReply = guardReply(reply, session, request.message);
        logger.info('homeworkHelper reply', { kind: access.kind, verdict: guardedReply.reply.verdict, guarded: guardedReply.guarded, ms: Date.now() - started });
        send(res, 200, { ok: true, result: guardedReply.reply, allowance: allowanceView(access.kind, reserved.usage) });
        return;
      }
      throw new HelperError(400, 'bad-mode', 'Unknown request.');
    } catch (err) {
      if (reserved && what && !(err instanceof HelperError && err.code === 'daily-limit')) await refund(uid, reserved.day, what);
      if (!(err instanceof HelperError) || err.status >= 500) logger.error('homeworkHelper failed', { message: err && err.message, ms: Date.now() - started });
      fail(res, err);
    }
  }
);
