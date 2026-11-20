// Test stand-in for homework/homework-services.js (tools/homework-browser.mjs): no Firebase, no network.
// window.__hw = { refuse: 'pending' | '', twoChildren: bool, staff: bool } is set by the test before the page loads.
const cfg = window.__hw || {};
const listeners = [];
let user = cfg.signedOut ? null : { uid: 'kid1', displayName: 'Ann Tan', email: 'ann@example.com' };
export const HELPER_URL = 'https://us-central1-mathgen--app.cloudfunctions.net/homeworkHelper';
window.__hwCalls = [];
export function watchUser(fn) { listeners.push(fn); setTimeout(() => fn(user), 10); return () => {}; }
export async function signInGoogle() { user = { uid: 'kid1', displayName: 'Ann Tan', email: 'ann@example.com' }; listeners.forEach(fn => fn(user)); }
export async function signInUsername() { return signInGoogle(); }
export async function signOut() { user = null; listeners.forEach(fn => fn(user)); }
export function friendlyAuthError(e) { return (e && e.message) || 'Sign-in failed.'; }
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let allowance = { photosLeft: 15, repliesLeft: 60, photosLimit: 15, repliesLimit: 60 };

export async function status() {
  window.__hwCalls.push({ mode: 'status' });
  await wait(20);
  if (cfg.refuse) throw { status: 403, code: cfg.refuse, error: 'refused' };
  return {
    ok: true, access: cfg.staff ? 'staff' : 'student',
    children: cfg.staff ? [] : cfg.twoChildren ? [{ name: 'Ann Tan', level: 'P3' }, { name: 'Ben Tan', level: 'P5' }] : [{ name: 'Ann Tan', level: 'P3' }],
    allowance
  };
}
export async function start(body) {
  window.__hwCalls.push({ mode: 'start', childIndex: body.childIndex, note: body.note, photo: body.imageDataUrl.slice(0, 23), length: body.imageDataUrl.length });
  await wait(cfg.slow ? 1500 : 300);
  allowance = { ...allowance, photosLeft: allowance.photosLeft - 1 };
  return {
    ok: true, session: 'hw1.stub', level: 'P3', allowance,
    result: {
      needs: 'ok', subject: 'math', topic: 'Multiplication and subtraction',
      question: '5. Mrs Lim bought 4 boxes of pencils. Each box had 18 pencils. She gave away 25 pencils. How many pencils did she have left?',
      encouragement: 'Nice one, Ann! This is a two-step problem sum, and you can do it.',
      checkIn: 'How many pencils did Mrs Lim buy altogether? Type what you get.',
      steps: [
        { goal: 'Find how many pencils Mrs Lim bought altogether', hints: ['There are 4 boxes and each box has the same number of pencils. Which operation do you use for equal groups?', 'Draw 4 equal bars, each one 18. What is 4 groups of 18?', 'Work out 4 × 18. Try 4 × 10 and 4 × 8 first, then add them.'] },
        { goal: 'Find how many pencils are left after she gives some away', hints: ['She gave 25 pencils away. Does the total go up or down?', 'Take 25 away from your answer in step 1.'] }
      ]
    }
  };
}
export async function reply(body) {
  window.__hwCalls.push({ mode: 'reply', message: body.message, history: body.history.length, hintsSeen: body.hintsSeen });
  await wait(250);
  allowance = { ...allowance, repliesLeft: allowance.repliesLeft - 1 };
  const m = body.message;
  let result;
  if (/47/.test(m)) result = { verdict: 'correct', message: 'Yes! 72 − 25 = 47, so she has 47 pencils left. You found the total first, then took away what she gave. Well done!', step: 2 };
  else if (/72/.test(m)) result = { verdict: 'on-track', message: 'Great, 4 × 18 = 72 is right! Now step 2: she gave 25 away. What do you do with the 72?', step: 2 };
  else if (/tell me/i.test(m)) result = { verdict: 'question', message: 'I will not tell you the answer, because working it out is how you learn! Look at step 1: what is 4 groups of 18?', step: 1 };
  else result = { verdict: 'not-yet', message: 'Not yet. Check step 1 again: is it 4 + 18 or 4 × 18? Each box has 18 pencils.', step: 1 };
  return { ok: true, result, allowance };
}
