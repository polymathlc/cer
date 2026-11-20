/* =====================================================================
   POLYMATH HOMEWORK HELPER — the page's pure helpers (v1.0.0)
   ---------------------------------------------------------------------
   No DOM and no network here, so tools/homework-tests.mjs can test it:
   the allowance sentence, shrinking a photo, the one-hint-at-a-time
   progress through the steps, the short conversation the server gets
   back, and the friendly words for every refusal.
   ===================================================================== */

export const MAX_PHOTO_SIDE = 1600;
export const PHOTO_QUALITY = 0.85;
export const HISTORY_TURNS = 8;

/** "12 photo questions left today" */
export function allowanceLine(allowance) {
  if (!allowance || typeof allowance.photosLeft !== 'number') return '';
  const left = allowance.photosLeft;
  if (left <= 0) return 'No photo questions left today. It resets at midnight.';
  return left + ' photo question' + (left === 1 ? '' : 's') + ' left today';
}

/** The size a photo is drawn at so its longest side is at most `max`. */
export function fitSize(width, height, max = MAX_PHOTO_SIDE) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/* ---------------- hints, one at a time ---------------- */

export function initialProgress(steps) {
  const n = Array.isArray(steps) ? steps.length : 0;
  return { step: 0, shown: new Array(n).fill(0), done: new Array(n).fill(false) };
}

/** Show the next hint of step `index` (never more than it has). */
export function revealHint(progress, steps, index) {
  const step = steps && steps[index];
  if (!step) return progress;
  const shown = progress.shown.slice();
  shown[index] = Math.min(step.hints.length, (shown[index] || 0) + 1);
  return { ...progress, shown };
}

/** Mark step `index` as done and move on to the next one. */
export function finishStep(progress, steps, index) {
  if (!steps || !steps[index]) return progress;
  const done = progress.done.slice();
  done[index] = true;
  const next = Math.min(steps.length - 1, index + 1);
  return { ...progress, done, step: Math.max(progress.step, next) };
}

export function hintsSeen(progress) {
  return (progress && progress.shown || []).reduce((sum, n) => sum + (n || 0), 0);
}

export function allStepsDone(progress) {
  return !!progress && progress.done.length > 0 && progress.done.every(Boolean);
}

/* ---------------- the conversation ---------------- */

/** The last few turns, in the shape the server accepts. */
export function historyForServer(turns) {
  return (Array.isArray(turns) ? turns : []).slice(-HISTORY_TURNS).map((t) => ({ who: t.who === 'student' ? 'student' : 'coach', text: String(t.text || '') }));
}

export const VERDICT_LABELS = Object.freeze({
  correct: { icon: '🎉', label: 'You got it!' },
  'on-track': { icon: '👍', label: 'On the right track' },
  'not-yet': { icon: '🔍', label: 'Not yet, look again' },
  question: { icon: '💡', label: 'Good question' },
  'off-topic': { icon: '🙂', label: 'Back to the question' },
});

/* ---------------- friendly errors ---------------- */

const CODE_WORDS = {
  'signed-out': 'Please sign in again, then try once more.',
  guest: 'Please sign in with your own Polymath account.',
  'not-enrolled': 'The Homework Helper is for enrolled Polymath students. Ask a parent to fill in the form at polymathlc.com.sg/student.',
  pending: 'Your account is waiting for approval from Polymath. The helper opens as soon as you are approved.',
  paused: 'Your Polymath access is paused, so the helper is closed for now. Please contact the centre.',
  'bad-session': 'This question has expired. Please send the photo again.',
};

export function friendlyError(error) {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.code && CODE_WORDS[error.code]) return CODE_WORDS[error.code];
  if (typeof error.error === 'string' && error.error) return error.error;
  const message = String(error.message || '');
  if (/failed to fetch|network|load failed|offline/i.test(message)) return 'No internet connection. Check your Wi-Fi and try again.';
  return 'Something went wrong. Please try again.';
}

/* ---------------- recent questions (kept on this device) ---------------- */

export const RECENT_KEY = 'polymath-homework-recent-v1';
export const RECENT_MAX = 8;

/** Add or replace a question in the recent list (newest first). */
export function rememberRecent(list, item) {
  const rest = (Array.isArray(list) ? list : []).filter((x) => x && x.id !== item.id);
  return [item].concat(rest).slice(0, RECENT_MAX);
}

/** Drop expired questions (the server refuses a session older than three days). */
export function liveRecent(list, nowMs = Date.now()) {
  return (Array.isArray(list) ? list : []).filter((x) => x && x.session && x.savedAtMs && nowMs - x.savedAtMs < 3 * 24 * 60 * 60 * 1000 - 60000);
}

export function shortQuestion(text, max = 90) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
