// Polymath Homework Helper — the pure logic of the homeworkHelper function (v1.0.0).
//
// Everything here is plain JavaScript with no Firebase and no network, so
// tools/homework-tests.mjs can test it directly:
//   • who may use the helper (approved students, staff, the deploy self-test)
//   • the daily allowance per account (Singapore days)
//   • the prompts that make the AI coach with hints and NEVER hand over the answer
//   • cleaning the AI's JSON, and the answer guard that blanks the final answer
//     out of anything the student sees, even if the AI slips
//   • the sealed "session" token: the question, the secret answer and the hints
//     travel between the page and the server encrypted (AES-256-GCM), so the
//     server can check a student's answer later without storing anything and
//     without the answer ever reaching the browser in readable form.
import crypto from 'node:crypto';

export const VERSION = '1.0.0';

// Keep equal to ACCESS_ADMINS / STAFF in ../../student/access-gate.js.
export const ACCESS_ADMINS = Object.freeze(['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg']);
export const STAFF_EMAILS = Object.freeze(ACCESS_ADMINS.concat(['elsielcr@gmail.com', 'abigail.yew@stanfordmanpower.com', 'pkeertana21@gmail.com']));

// The deploy workflow's live check signs in as this account with a custom
// token only the service account can mint (claim homeworkSelfTest: true).
export const SELF_TEST_UID = 'homework-helper-selftest';

export const ORIGINS = Object.freeze([
  'https://polymathlc.com.sg',
  'https://www.polymathlc.com.sg',
  'https://polymathlc.github.io',
]);
export const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
export function originAllowed(origin) {
  const o = String(origin || '');
  return ORIGINS.includes(o) || DEV_ORIGIN.test(o);
}

// Each account's AI uses per Singapore day. A new photo question is the
// expensive one (the AI reads a picture); a reply is a short text turn.
export const LIMITS = Object.freeze({
  student: { photos: 15, replies: 60 },
  staff: { photos: 40, replies: 150 },
  selftest: { photos: 4, replies: 10 },
});

export const MAX_IMAGE_CHARS = 6 * 1024 * 1024;     // ~4.5 MB of base64 picture
export const MAX_BODY_BYTES = 7 * 1024 * 1024;
export const MAX_NOTE_CHARS = 600;
export const MAX_MESSAGE_CHARS = 1200;
export const MAX_HISTORY_TURNS = 8;
export const MAX_HISTORY_CHARS = 900;
export const MAX_SESSION_CHARS = 24000;
export const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;   // a question stays open for three days
export const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;

export const SUBJECTS = Object.freeze(['math', 'science', 'english', 'chinese', 'other']);
export const LEVELS = Object.freeze(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'S1', 'S2', 'S3', 'S4', 'S5', 'Other']);
export const VERDICTS = Object.freeze(['correct', 'on-track', 'not-yet', 'question', 'off-topic']);
export const NEEDS = Object.freeze(['ok', 'unclear-photo', 'pick-one', 'not-homework']);

/** Errors the function turns into an HTTP status and a friendly sentence. */
export class HelperError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}

/* ------------------------------------------------------------------ */
/*  Who may use it                                                      */
/* ------------------------------------------------------------------ */

const clip = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

/** Children of an approved studentAccess record, cleaned for the page. */
export function childrenOf(record) {
  const list = Array.isArray(record && record.children) ? record.children : [];
  return list.slice(0, 8).map((child) => ({
    name: clip(child && child.name, 60) || 'Student',
    level: LEVELS.includes(child && child.level) ? child.level : 'Other',
    subjects: child && child.subjects === 'both' ? ['math', 'science']
      : child && (child.subjects === 'math' || child.subjects === 'science') ? [child.subjects] : [],
  }));
}

/**
 * Decide from the verified ID token (decoded) and the account's studentAccess
 * record whether this account may use the helper.
 * Returns { allowed, kind: 'student'|'staff'|'selftest', reason, children }.
 */
export function accessDecision(token, record) {
  if (!token || !token.uid) return { allowed: false, kind: 'none', reason: 'signed-out', children: [] };
  const provider = token.firebase && token.firebase.sign_in_provider;
  if (provider === 'anonymous') return { allowed: false, kind: 'none', reason: 'guest', children: [] };
  if (token.homeworkSelfTest === true && token.uid === SELF_TEST_UID) {
    return { allowed: true, kind: 'selftest', reason: 'self-test', children: [{ name: 'Self test', level: 'P4', subjects: ['math'] }] };
  }
  const email = String(token.email || '').toLowerCase();
  if (email && token.email_verified === true && STAFF_EMAILS.includes(email)) {
    return { allowed: true, kind: 'staff', reason: 'staff', children: [] };
  }
  if (!record) return { allowed: false, kind: 'student', reason: 'not-enrolled', children: [] };
  const status = String(record.status || '');
  if (status === 'approved') return { allowed: true, kind: 'student', reason: 'approved', children: childrenOf(record) };
  if (status === 'pending') return { allowed: false, kind: 'student', reason: 'pending', children: [] };
  if (status === 'revoked') return { allowed: false, kind: 'student', reason: 'paused', children: [] };
  return { allowed: false, kind: 'student', reason: 'not-enrolled', children: [] };
}

export const REFUSALS = Object.freeze({
  'signed-out': 'Please sign in with your Polymath account first.',
  guest: 'Please sign in with your own Polymath account to use the Homework Helper.',
  'not-enrolled': 'The Homework Helper is for enrolled Polymath students. Ask a parent to fill in the enrolment form at polymathlc.com.sg/student.',
  pending: 'Your account is waiting for approval from Polymath. The Homework Helper opens as soon as you are approved.',
  paused: 'Your Polymath access is paused, so the Homework Helper is closed for now. Please contact the centre.',
});

/* ------------------------------------------------------------------ */
/*  Daily allowance                                                     */
/* ------------------------------------------------------------------ */

/** The Singapore calendar day (UTC+8, no daylight saving) as YYYYMMDD. */
export function singaporeDay(nowMs = Date.now()) {
  const d = new Date(nowMs + 8 * 60 * 60 * 1000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/**
 * Where the counter lives. polymathEnquiryLimits is already a server-only
 * collection in the live Firestore rules (block polymath-enquiry-server-only-v1:
 * no browser may read or write it), so a student cannot reset their own count
 * and no rules change is needed.
 */
export const USAGE_COLLECTION = 'polymathEnquiryLimits';
export function usageDocId(uid, day) {
  const safe = String(uid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
  return 'homework-helper-' + safe + '-' + day;
}

export function limitsFor(kind) {
  return LIMITS[kind] || LIMITS.student;
}

/** The allowance the page shows: how many of each are left today. */
export function allowanceView(kind, usage) {
  const limit = limitsFor(kind);
  const photos = Math.max(0, Number(usage && usage.photos) || 0);
  const replies = Math.max(0, Number(usage && usage.replies) || 0);
  return {
    photosLeft: Math.max(0, limit.photos - photos),
    repliesLeft: Math.max(0, limit.replies - replies),
    photosLimit: limit.photos,
    repliesLimit: limit.replies,
  };
}

/**
 * Take one use of `what` ('photos' | 'replies') from the stored usage.
 * Returns the new usage, or throws a 429 HelperError when the day's allowance is used up.
 */
export function takeUse(kind, usage, what, nowMs = Date.now()) {
  const limit = limitsFor(kind);
  const next = {
    photos: Math.max(0, Number(usage && usage.photos) || 0),
    replies: Math.max(0, Number(usage && usage.replies) || 0),
  };
  if (!(what in next)) throw new Error('Unknown use ' + what);
  if (next[what] >= limit[what]) {
    throw new HelperError(429, 'daily-limit', what === 'photos'
      ? 'You have used today\'s ' + limit.photos + ' photo questions. The Homework Helper resets at midnight. You can still ask about the questions you already sent.'
      : 'You have used today\'s ' + limit.replies + ' replies. The Homework Helper resets at midnight, or bring the question to your next lesson.');
  }
  next[what] += 1;
  next.updatedAtMs = nowMs;
  return next;
}

/** Give a use back when the AI failed, so a failure never costs the student. */
export function giveBack(usage, what) {
  const next = { photos: Number(usage && usage.photos) || 0, replies: Number(usage && usage.replies) || 0 };
  next[what] = Math.max(0, next[what] - 1);
  return next;
}

/* ------------------------------------------------------------------ */
/*  Request checks                                                      */
/* ------------------------------------------------------------------ */

export function bearerToken(header) {
  const m = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(String(header || '').trim());
  return m ? m[1] : '';
}

export function cleanLevel(level) {
  return LEVELS.includes(level) ? level : '';
}

/** Validate and tidy a request body. Throws HelperError 400/413. */
export function parseRequest(body) {
  if (!body || typeof body !== 'object') throw new HelperError(400, 'bad-body', 'Send a JSON body.');
  const mode = String(body.mode || '');
  if (mode === 'status') return { mode };
  if (mode === 'start') {
    const imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl.trim() : '';
    if (!imageDataUrl) throw new HelperError(400, 'no-photo', 'Take or choose a photo of the question first.');
    if (imageDataUrl.length > MAX_IMAGE_CHARS) throw new HelperError(413, 'photo-too-big', 'That photo is too large. Try again a little further away, or crop it.');
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(imageDataUrl) || !IMAGE_DATA_URL.test(imageDataUrl.slice(0, 80))) {
      throw new HelperError(400, 'not-a-photo', 'That file is not a photo. Please use a JPG or PNG picture.');
    }
    return {
      mode,
      imageDataUrl,
      note: clip(body.note, MAX_NOTE_CHARS),
      childIndex: Number.isInteger(body.childIndex) && body.childIndex >= 0 && body.childIndex < 8 ? body.childIndex : 0,
      level: cleanLevel(body.level),
    };
  }
  if (mode === 'reply') {
    const session = typeof body.session === 'string' ? body.session.trim() : '';
    if (!session || session.length > MAX_SESSION_CHARS) throw new HelperError(400, 'no-session', 'Start with a photo of the question first.');
    const message = String(body.message == null ? '' : body.message).trim().slice(0, MAX_MESSAGE_CHARS);
    if (!message) throw new HelperError(400, 'no-message', 'Type your working, your answer or your question first.');
    const history = (Array.isArray(body.history) ? body.history : []).slice(-MAX_HISTORY_TURNS)
      .map((turn) => ({
        who: turn && turn.who === 'student' ? 'student' : 'coach',
        text: String(turn && turn.text || '').trim().slice(0, MAX_HISTORY_CHARS),
      }))
      .filter((turn) => turn.text);
    const hintsSeen = Math.max(0, Math.min(40, Number.parseInt(body.hintsSeen, 10) || 0));
    return { mode, session, message, history, hintsSeen };
  }
  throw new HelperError(400, 'bad-mode', 'Unknown request.');
}

/* ------------------------------------------------------------------ */
/*  The prompts                                                         */
/* ------------------------------------------------------------------ */

export const DEFAULT_MODEL = 'gpt-6-luna';

const LEVEL_WORDS = {
  P1: 'Primary 1 (age 7)', P2: 'Primary 2 (age 8)', P3: 'Primary 3 (age 9)', P4: 'Primary 4 (age 10)',
  P5: 'Primary 5 (age 11)', P6: 'Primary 6 (age 12, PSLE year)', S1: 'Secondary 1 (age 13)', S2: 'Secondary 2 (age 14)',
  S3: 'Secondary 3 (age 15)', S4: 'Secondary 4 (age 16, O-level year)', S5: 'Secondary 5 (age 17)',
};
export function levelWords(level) {
  return LEVEL_WORDS[level] || 'a Singapore primary or secondary school student';
}

export const START_SYSTEM = `You are the Polymath Homework Helper, a warm and patient tutor at Polymath Learning Centre in Singapore.
A student has sent a photo of ONE homework question they are stuck on. Your job is to coach them to solve it THEMSELVES.

THE ONE RULE THAT MATTERS MOST
- Never give the final answer. Never write the final number, the final word, the correct option, or the result of the last calculation, anywhere a student can see it.
- Never write out a full worked solution or a full model answer.
- Each hint moves the student ONE small step forward and then hands the thinking back to them, usually with a question.
- The last hint of the last step must still stop BEFORE the answer: it tells them what to do, not what they will get.

HOW TO COACH (Singapore syllabus, MOE style)
- Use the methods Singapore schools teach at the student's level: model drawing (bar models), units and parts, before-and-after, guess and check, working backwards, listing; for Science the CER habit (Claim, Evidence, Reasoning) and the exact keywords markers look for.
- Never use algebra with letters for Primary students unless the question itself does.
- Plain, short, friendly sentences a child can read. British spelling. No more than about 35 words in one hint.
- Use the numbers and names from the question, so every hint feels about THEIR question.
- For a Science open-ended question, guide them to the concept and the keywords to use, but let them write the sentence.
- For English or Chinese, explain the rule or what to look for; do not give the corrected sentence or the chosen option.

WHAT TO RETURN: one JSON object, nothing else:
{
  "needs": "ok" | "unclear-photo" | "pick-one" | "not-homework",
  "message": "only when needs is not ok: one kind sentence telling the student what to do (retake the photo, say which question number, etc.)",
  "subject": "math" | "science" | "english" | "chinese" | "other",
  "topic": "short topic name, e.g. Fractions of a set, Heat and temperature",
  "question": "the question exactly as printed, word for word, with every number and unit (and the options for MCQ). If there are diagrams, describe them briefly in [square brackets].",
  "encouragement": "one short, warm opening sentence for the student",
  "steps": [
    {
      "goal": "what the student works out in this step, as a short instruction WITHOUT its result, e.g. Find how many sweets Ali has at first",
      "hints": ["a gentle nudge", "a clearer nudge", "a very specific nudge that still leaves the working to them"]
    }
  ],
  "checkIn": "one question that invites the student to try the first step and type what they get",
  "finalAnswer": "the correct final answer with units (SECRET: the server keeps this and never shows it to the student)",
  "answerTokens": ["the short pieces that would give the answer away if shown: the final number(s) as written, the final word(s), the option number or letter; for open-ended Science give the 2 to 4 key phrases of the model answer"]
}
- 2 to 5 steps, each with 2 or 3 hints, gentle first.
- If the photo shows several questions and the student's note does not say which, use needs "pick-one" and in "message" list the question numbers you can see.
- If the photo cannot be read, use needs "unclear-photo".
- If it is not a school question at all, use needs "not-homework".
- When needs is not "ok", "steps" may be empty and "finalAnswer" may be "".`;

export function startUserText({ level, note, childName }) {
  const lines = [
    'The student is in ' + levelWords(level) + '.',
    childName ? 'Their name is ' + clip(childName, 40).split(' ')[0] + '.' : '',
    note ? 'The student wrote: "' + clip(note, MAX_NOTE_CHARS) + '" (follow it if it says which question, or what they have tried).' : 'The student did not write a note.',
    'Read the photo, work out the answer privately, then return the JSON object. Remember: hints only, never the answer.',
  ];
  return lines.filter(Boolean).join('\n');
}

export function buildStartBody({ imageDataUrl, level, note, childName, model }) {
  return {
    model: model || DEFAULT_MODEL,
    response_format: { type: 'json_object' },
    max_completion_tokens: 12000,
    messages: [
      { role: 'system', content: START_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: startUserText({ level, note, childName }) },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
        ],
      },
    ],
  };
}

export const REPLY_SYSTEM = `You are the Polymath Homework Helper, a warm and patient tutor at Polymath Learning Centre in Singapore.
You are in the middle of coaching a student through ONE homework question. You can see the question, its correct answer (SECRET), the steps and hints already planned, the conversation so far, and the student's new message.

THE ONE RULE THAT MATTERS MOST
- Never reveal the final answer, the correct option or the result of the last calculation, unless the student has ALREADY written that correct answer themselves.
- If the student asks you to just tell them the answer, say kindly that you will not, because working it out is how they learn, and give them the next small hint instead.
- Never write a full worked solution or a full model answer.

HOW TO REPLY
- Read what the student wrote. Decide:
  "correct"   their final answer is right (allow equivalent forms, e.g. 0.5 and 1/2, missing units if the number is right; for open-ended Science, the key idea and keywords are there). Praise the THINKING, say in one or two sentences why it works, and remind them of units or keywords if they missed them.
  "on-track"  their working so far is right but not finished. Say which part is right and nudge them to the next step.
  "not-yet"   something is wrong. Point to WHERE it goes wrong (which step, which number) with a question that helps them see it. Do not give the corrected value of the final answer.
  "question"  they asked something (what a word means, why a step works). Answer it simply, then hand the thinking back.
  "off-topic" the message is not about this question. Gently bring them back.
- At most about 70 words. Plain, short, friendly sentences for the student's level. British spelling. Use Singapore methods (bar models, units, CER for Science).
- Use the question's own numbers and names.

Return one JSON object, nothing else:
{ "verdict": "correct" | "on-track" | "not-yet" | "question" | "off-topic", "message": "what you say to the student", "step": the number (1-based) of the step the student is on now }`;

export function buildReplyBody({ session, history, message, hintsSeen, model }) {
  const steps = (session.steps || []).map((step, i) => (i + 1) + '. ' + step.goal + '\n   hints: ' + step.hints.join(' | ')).join('\n');
  const convo = (history || []).map((turn) => (turn.who === 'student' ? 'Student: ' : 'Coach: ') + turn.text).join('\n');
  const text = [
    'Student level: ' + levelWords(session.level) + '.',
    'Subject: ' + session.subject + (session.topic ? ' (' + session.topic + ')' : '') + '.',
    'The question:\n' + session.question,
    'SECRET correct answer (do not reveal): ' + session.finalAnswer,
    'Planned steps and hints:\n' + (steps || '(none)'),
    'The student has opened ' + hintsSeen + ' hint(s) so far.',
    convo ? 'Conversation so far:\n' + convo : 'No conversation yet.',
    'The student\'s new message:\n"' + message + '"',
    'Return the JSON object.',
  ].join('\n\n');
  return {
    model: model || DEFAULT_MODEL,
    response_format: { type: 'json_object' },
    max_completion_tokens: 6000,
    messages: [
      { role: 'system', content: REPLY_SYSTEM },
      { role: 'user', content: text },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Reading the AI's reply                                              */
/* ------------------------------------------------------------------ */

export function parseJsonLoose(text) {
  let s = String(text == null ? '' : text).trim();
  const fenced = s.match(/^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenced) s = fenced[1].trim();
  try { return JSON.parse(s); } catch (_) { /* fall through */ }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch (_) { /* fall through */ }
  }
  throw new Error('The AI reply was not readable. Please try again.');
}

const textOf = (value, max) => String(value == null ? '' : value).replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

/** Clean the AI's first reply into the shape the server works with (answer still inside). */
export function cleanStartReply(raw) {
  const data = typeof raw === 'string' ? parseJsonLoose(raw) : raw;
  if (!data || typeof data !== 'object') throw new Error('The AI reply was empty.');
  const needs = NEEDS.includes(data.needs) ? data.needs : 'ok';
  const steps = (Array.isArray(data.steps) ? data.steps : []).slice(0, 6).map((step) => ({
    goal: textOf(step && step.goal, 220),
    hints: (Array.isArray(step && step.hints) ? step.hints : []).slice(0, 4).map((h) => textOf(h, 400)).filter(Boolean),
  })).filter((step) => step.goal && step.hints.length);
  const out = {
    needs,
    message: textOf(data.message, 400),
    subject: SUBJECTS.includes(data.subject) ? data.subject : 'other',
    topic: textOf(data.topic, 80),
    question: textOf(data.question, 3000),
    encouragement: textOf(data.encouragement, 240),
    steps,
    checkIn: textOf(data.checkIn, 300),
    finalAnswer: textOf(data.finalAnswer, 600),
    answerTokens: (Array.isArray(data.answerTokens) ? data.answerTokens : []).slice(0, 8).map((t) => textOf(t, 120)).filter(Boolean),
  };
  if (needs === 'ok' && (!out.steps.length || !out.question)) {
    out.needs = 'unclear-photo';
    out.message = out.message || 'I could not quite read that question. Please take the photo again, closer and in good light.';
  }
  if (out.needs !== 'ok' && !out.message) {
    out.message = out.needs === 'pick-one' ? 'I can see more than one question. Type which question number you need help with, then send the photo again.'
      : out.needs === 'not-homework' ? 'That does not look like a homework question. Take a photo of the question you are stuck on.'
        : 'I could not quite read that question. Please take the photo again, closer and in good light.';
  }
  return out;
}

export function cleanReply(raw) {
  const data = typeof raw === 'string' ? parseJsonLoose(raw) : raw;
  const message = textOf(data && data.message, 900);
  if (!message) throw new Error('The AI reply was empty.');
  const step = Number.parseInt(data && data.step, 10);
  return {
    verdict: VERDICTS.includes(data && data.verdict) ? data.verdict : 'question',
    message,
    step: Number.isFinite(step) && step > 0 ? Math.min(step, 6) : 0,
  };
}

/* ------------------------------------------------------------------ */
/*  The answer guard                                                    */
/* ------------------------------------------------------------------ */

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMMON_WORDS = new Set(['the', 'and', 'yes', 'no', 'true', 'false', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'it']);

/** Turn "$12.50" / "12 pens" / "(3)" / "Option B" into the bare pieces worth hiding. */
export function guardPieces(finalAnswer, answerTokens, question) {
  const pieces = new Set();
  const add = (s) => {
    const t = String(s || '').trim();
    if (!t) return;
    // Every number in the token (with its decimals / fraction / thousands separators).
    for (const m of t.matchAll(/\d+(?:[.,]\d+)*(?:\s*\/\s*\d+)?/g)) pieces.add(m[0].replace(/\s+/g, ''));
    const words = t.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (words && !/^\d/.test(words) && words.length >= 4 && words.split(' ').length <= 6 && !COMMON_WORDS.has(words.toLowerCase())) pieces.add(words.toLowerCase());
  };
  (answerTokens || []).forEach(add);
  add(finalAnswer);
  const q = ' ' + String(question || '').toLowerCase() + ' ';
  // A piece already printed in the question is given information, not the answer: never hide it.
  return [...pieces].filter((piece) => {
    if (/^\d/.test(piece)) return !new RegExp('(^|[^\\d.,/])' + escapeRegExp(piece) + '(?![\\d]|[.,/]\\d)').test(q);
    return !q.includes(piece);
  });
}

/** Replace every hidden piece in `text` with "?". Returns { text, hits }. */
export function guardText(text, pieces) {
  let out = String(text || '');
  let hits = 0;
  for (const piece of pieces || []) {
    let re;
    if (/^\d/.test(piece)) {
      const flexible = escapeRegExp(piece).replace(/\\\/|\//g, '\\s*\\/\\s*');
      re = new RegExp('(^|[^\\d.,/])' + flexible + '(?![\\d]|[.,/]\\d)', 'g');
      out = out.replace(re, (m, lead) => { hits += 1; return lead + '?'; });
    } else {
      re = new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRegExp(piece) + '(?![\\p{L}\\p{N}])', 'giu');
      out = out.replace(re, (m, lead) => { hits += 1; return lead + '…'; });
    }
  }
  return { text: out, hits };
}

/** Did the student already write the answer themselves? Then saying it back is fine. */
export function studentWroteAnswer(message, pieces) {
  if (!pieces || !pieces.length) return false;
  const numeric = pieces.filter((p) => /^\d/.test(p));
  const target = numeric.length ? numeric : pieces;
  return target.every((piece) => guardText(message, [piece]).hits > 0);
}

/** The part of a cleaned first reply the student may see (the answer is gone, hints guarded). */
export function studentView(clean) {
  const pieces = guardPieces(clean.finalAnswer, clean.answerTokens, clean.question);
  let guarded = 0;
  const guard = (s) => { const g = guardText(s, pieces); guarded += g.hits; return g.text; };
  const view = {
    needs: clean.needs,
    message: clean.message,
    subject: clean.subject,
    topic: clean.topic,
    question: clean.question,
    encouragement: guard(clean.encouragement),
    steps: clean.steps.map((step) => ({ goal: guard(step.goal), hints: step.hints.map(guard) })),
    checkIn: guard(clean.checkIn),
  };
  return { view, guarded };
}

/* ------------------------------------------------------------------ */
/*  The sealed session                                                  */
/* ------------------------------------------------------------------ */

function sessionKey(secret) {
  if (!secret) throw new Error('No session secret.');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret)), Buffer.from('polymath-homework-helper'), Buffer.from('session-v1'), 32));
}

/** Encrypt what the server needs later (including the answer) into one opaque string. */
export function sealSession(payload, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'hw1.' + Buffer.concat([iv, tag, body]).toString('base64url');
}

/** Open a sealed session for THIS account. Throws HelperError 400 when it is not valid. */
export function openSession(sealed, secret, uid, nowMs = Date.now()) {
  const bad = () => new HelperError(400, 'bad-session', 'This question has expired. Please send the photo again.');
  if (typeof sealed !== 'string' || !sealed.startsWith('hw1.')) throw bad();
  let payload;
  try {
    const raw = Buffer.from(sealed.slice(4), 'base64url');
    if (raw.length < 29) throw new Error('short');
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    payload = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
  } catch (_) {
    throw bad();
  }
  if (!payload || payload.uid !== uid || !(payload.exp > nowMs)) throw bad();
  return payload;
}

export function sessionPayload(clean, { uid, level, nowMs = Date.now() }) {
  return {
    v: 1,
    uid,
    level: level || '',
    subject: clean.subject,
    topic: clean.topic,
    question: clean.question,
    finalAnswer: clean.finalAnswer,
    answerTokens: clean.answerTokens,
    steps: clean.steps,
    exp: nowMs + SESSION_TTL_MS,
  };
}

/** Guard a coaching reply: hide the answer unless the student already wrote it and got it right. */
export function guardReply(reply, session, studentMessage) {
  const pieces = guardPieces(session.finalAnswer, session.answerTokens, session.question);
  if (reply.verdict === 'correct' && studentWroteAnswer(studentMessage, pieces)) return { reply, guarded: 0 };
  // The AI may only say "correct" when the student's own words carry the answer.
  const verdict = reply.verdict === 'correct' && pieces.some((p) => /^\d/.test(p)) ? 'on-track' : reply.verdict;
  const g = guardText(reply.message, pieces);
  return { reply: { ...reply, verdict, message: g.text }, guarded: g.hits };
}
