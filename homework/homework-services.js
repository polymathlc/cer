/* =====================================================================
   POLYMATH HOMEWORK HELPER — services (v1.0.0)
   ---------------------------------------------------------------------
   Sign-in (the shared mathgen--app project, modular SDK 11.10.0 — the same
   module URLs every Polymath app imports, so the access gate finds the same
   sign-in) and the three calls to the homeworkHelper function:

     status()           who am I, my children's levels, today's allowance
     start(photo, …)    a photo of ONE question → steps and hints (no answer)
     reply(session, …)  the student's working / answer / question → coaching

   No key lives here: the server verifies the student's ID token, checks the
   approval in studentAccess, counts the day's allowance and keeps the
   OpenAI key to itself. tools/homework-browser.mjs swaps this file for
   tools/homework-fixtures/stub-services.js.
   ===================================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, signOut as fbSignOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo',
  authDomain: 'mathgen--app.firebaseapp.com',
  projectId: 'mathgen--app',
  storageBucket: 'mathgen--app.firebasestorage.app',
  messagingSenderId: '165654161198',
  appId: '1:165654161198:web:16c8bd60eb3a2aa7edbcbf',
  measurementId: 'G-0MWZFG211D'
};
export const HELPER_URL = 'https://us-central1-mathgen--app.cloudfunctions.net/homeworkHelper';
// Centre usernames sign in as username@this domain (the same mapping as /student and the Science app).
export const STUDENT_USERNAME_DOMAIN = 'students.sciencequest.app';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export function watchUser(fn) { return onAuthStateChanged(auth, fn); }

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    if (e && /popup-blocked|operation-not-supported/.test(e.code || '')) return signInWithRedirect(auth, provider);
    throw e;
  }
}
getRedirectResult(auth).catch(e => console.warn('[homework] redirect sign-in', e));

export function loginCandidates(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s.includes('@')) return [s];
  const u = s.toLowerCase();
  const out = [u + '@' + STUDENT_USERNAME_DOMAIN];
  for (let n = 2; n <= 9; n++) out.push(u + '.r' + n + '@' + STUDENT_USERNAME_DOMAIN);
  return out;
}

export async function signInUsername(loginId, password) {
  let last = null;
  for (const email of loginCandidates(loginId)) {
    try { return await signInWithEmailAndPassword(auth, email, password); }
    catch (e) {
      last = e;
      if (!/user-not-found|invalid-credential|invalid-login-credentials|wrong-password/.test(e.code || '')) break;
    }
  }
  throw last || new Error('Please type your username and password.');
}

export function signOut() { return fbSignOut(auth); }

export function friendlyAuthError(e) {
  const code = (e && e.code) || '';
  const map = {
    'auth/user-not-found': 'No account with that username or email.',
    'auth/wrong-password': 'That username or password is not right. Please try again.',
    'auth/invalid-credential': 'That username or password is not right. Please try again.',
    'auth/invalid-login-credentials': 'That username or password is not right. Please try again.',
    'auth/invalid-email': 'Please type a username or a full email address.',
    'auth/too-many-requests': 'Too many tries. Please wait a minute and try again.',
    'auth/network-request-failed': 'No connection. Check your internet and try again.',
    'auth/popup-closed-by-user': 'The sign-in window was closed before it finished.'
  };
  return map[code] || (e && e.message) || 'Sign-in failed. Please try again.';
}

/** POST to the helper with the student's ID token. Resolves the JSON body; rejects with {status, code, error}. */
async function callHelper(body, { timeoutMs = 170000 } = {}) {
  const user = auth.currentUser;
  if (!user) throw { status: 401, code: 'signed-out', error: 'Please sign in first.' };
  const idToken = await user.getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(HELPER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    throw e && e.name === 'AbortError' ? { status: 504, code: 'timeout', error: 'The helper took too long. Please try again.' } : e;
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await response.json(); } catch (_) { /* not JSON */ }
  if (!response.ok || !data || data.ok !== true) {
    throw { status: response.status, code: (data && data.code) || 'error', error: (data && data.error) || 'The helper could not answer just now. Please try again.' };
  }
  return data;
}

export function status() { return callHelper({ mode: 'status' }, { timeoutMs: 30000 }); }
export function start({ imageDataUrl, note, childIndex, level }) {
  return callHelper({ mode: 'start', imageDataUrl, note: note || '', childIndex: childIndex || 0, level: level || '' });
}
export function reply({ session, message, history, hintsSeen }) {
  return callHelper({ mode: 'reply', session, message, history: history || [], hintsSeen: hintsSeen || 0 }, { timeoutMs: 120000 });
}
