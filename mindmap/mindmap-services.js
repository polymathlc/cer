/* =====================================================================
   POLYMATH MIND MAP — services (v1.0.0)
   ---------------------------------------------------------------------
   Firebase (the shared mathgen--app project, modular SDK 11.10.0 — the
   same module URLs the cer app imports, so the access gate finds the same
   sign-in), and every AI call the page makes:

     TEXT     aiText()     ChatGPT through the shared `askOpenAi` callable
                           (the server's OPENAI_API_KEY; any signed-in account,
                           with its own daily allowance), and Gemini through
                           Firebase AI Logic (gemini-3.8-flash). The order is
                           chosen per job: the voice builder leads with Gemini
                           (it is the fastest), app building leads with ChatGPT.
     PICTURES aiImage()    ChatGPT Images 2.6 through `openAiImage`, then the
                           Gemini image models, exactly the cer app's order.
     SPEECH   transcribe() a recording → text, through Gemini (for browsers
                           without live speech recognition).

   No key lives in this file: the Firebase web config is public, Gemini is
   protected by App Check, and the OpenAI key never leaves the server.
   ===================================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, signOut as fbSignOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, deleteDoc, collection, query, where, limit as qLimit
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js';
import { getAI, getGenerativeModel, GoogleAIBackend, ResponseModality } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-ai.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo',
  authDomain: 'mathgen--app.firebaseapp.com',
  projectId: 'mathgen--app',
  storageBucket: 'mathgen--app.firebasestorage.app',
  messagingSenderId: '165654161198',
  appId: '1:165654161198:web:16c8bd60eb3a2aa7edbcbf',
  measurementId: 'G-0MWZFG211D'
};
// App Check (reCAPTCHA v3) — the same site key as every Polymath app.
const RECAPTCHA_SITE_KEY = '6Le98gwtAAAAAAzkjJTZXFM5D8tpjx_P4rtRuhuH';
// The cer app's text model and the floor of its thinking scale (3.8 Flash rejects "minimal").
export const AI_MODEL = 'gemini-3.8-flash';
const AI_THINK_MIN = 'low';
// Image models, tried in order (cer app.js AI_IMAGE_MODELS).
export const AI_IMAGE_MODELS = ['gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'];
// The light ChatGPT tier any account may name (cheaper than the default).
export const OPENAI_LIGHT_MODEL = 'gpt-6-luna';
// Keep equal to ACCESS_ADMINS in ../student/access-gate.js.
export const ACCESS_ADMINS = ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg'];
export const STAFF_EMAILS = ACCESS_ADMINS.concat(['elsielcr@gmail.com', 'abigail.yew@stanfordmanpower.com', 'pkeertana21@gmail.com']);
// The cer app's ADMIN_EMAILS: whose `users/{uid}/questions` make up the bank.
export const BANK_ADMIN_EMAILS = ['chungzhikai@gmail.com', 'abigail.yew@stanfordmanpower.com'];
// Centre usernames sign in as username@this domain (the same mapping as /student and the Science app).
export const STUDENT_USERNAME_DOMAIN = 'students.sciencequest.app';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
const functions = getFunctions(app, 'us-central1');

try {
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
} catch (e) { console.warn('[mindmap] App Check could not start', e); }

let geminiModel = null;
let geminiImageModels = [];
try {
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  geminiModel = getGenerativeModel(ai, { model: AI_MODEL });
  geminiImageModels = AI_IMAGE_MODELS.map(model => getGenerativeModel(ai, {
    model, generationConfig: { responseModalities: [ResponseModality.TEXT, ResponseModality.IMAGE] }
  }));
} catch (e) { console.warn('[mindmap] Firebase AI could not start', e); }

export const fb = { doc, getDoc, getDocs, setDoc, deleteDoc, collection, query, where, qLimit, storageRef, uploadString, getDownloadURL };

/* ------------------------------------------------------------------ */
/*  Sign-in                                                             */
/* ------------------------------------------------------------------ */
export function watchUser(fn) { return onAuthStateChanged(auth, fn); }
export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    // A blocked pop-up (common on phones and in installed apps) → the redirect flow.
    if (e && /popup-blocked|operation-not-supported/.test(e.code || '')) {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}
getRedirectResult(auth).catch(e => console.warn('[mindmap] redirect sign-in', e));

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
  const list = loginCandidates(loginId);
  let last = null;
  for (const email of list) {
    try { return await signInWithEmailAndPassword(auth, email, password); }
    catch (e) {
      last = e;
      // Only a "no such user / wrong pair" may move on to the next reset suffix.
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
    'auth/popup-closed-by-user': 'The sign-in window was closed before it finished.',
    'auth/unauthorized-domain': 'This address is not allowed to sign in yet. Please use polymathlc.com.sg/mindmap.'
  };
  return map[code] || (e && e.message) || 'Sign-in failed. Please try again.';
}
/**
 * v1.2.0 — who may publish a map to every student ("Mr Chung's Maps"): the three access admins
 * (Mr Chung's own account, admin@ and support@), with a verified email.
 */
export const PUBLISHER_EMAILS = ACCESS_ADMINS.slice();
export function isPublisherEmail(user) {
  return !!(user && user.email && user.emailVerified && PUBLISHER_EMAILS.includes(String(user.email).toLowerCase()));
}
export function isPublisherAddress(email) {
  return PUBLISHER_EMAILS.includes(String(email || '').toLowerCase());
}
export function isStaffEmail(user) {
  return !!(user && user.email && user.emailVerified && STAFF_EMAILS.includes(String(user.email).toLowerCase()));
}

/* ------------------------------------------------------------------ */
/*  AI: text                                                            */
/* ------------------------------------------------------------------ */
const down = new Map();          // route → time it may be tried again
const DOWN_MS = 4 * 60 * 1000;
const why = new Map();
function isDown(route) { return (down.get(route) || 0) > Date.now(); }
function markDown(route, error) { down.set(route, Date.now() + DOWN_MS); why.set(route, String(error && error.message || error || '')); }
function markUp(route) { down.delete(route); why.delete(route); }
/** A refusal about THIS request (bad input) should not close the route for everybody's next request. */
function routeFault(e) {
  const code = String(e && (e.code || e.status) || '');
  return !/invalid-argument|INVALID_ARGUMENT/.test(code + ' ' + (e && e.message || ''));
}

async function geminiText(prompt, { system = '', json = false, maxTokens = 2048, temperature = 0.4, signal } = {}) {
  if (!geminiModel) throw new Error('Gemini is not available on this page.');
  const generationConfig = { maxOutputTokens: maxTokens, temperature, thinkingConfig: { thinkingLevel: AI_THINK_MIN } };
  if (json) generationConfig.responseMimeType = 'application/json';
  const text = (system ? system + '\n\n' : '') + prompt;
  const res = await geminiModel.generateContent({ contents: [{ role: 'user', parts: [{ text }] }], generationConfig }, signal ? { signal } : undefined);
  const out = (res && res.response && res.response.text ? res.response.text() : '') || '';
  if (!out.trim()) throw new Error('Gemini sent back an empty answer.');
  return out.trim();
}

async function openAiText(prompt, { system = '', json = false, maxTokens = 2048, light = false, effort = 'low' } = {}) {
  const call = httpsCallable(functions, 'askOpenAi', { timeout: 240000 });
  const body = { prompt: String(prompt), json: !!json, maxOutputTokens: maxTokens, reasoningEffort: effort };
  if (system) body.system = system;
  if (light) body.model = OPENAI_LIGHT_MODEL;
  const res = await call(body);
  const text = res && res.data && res.data.text;
  if (typeof text !== 'string' || !text.trim()) throw new Error('ChatGPT sent back an empty answer.');
  return text.trim();
}

/**
 * Ask the AI. `order` is the routes to try: 'gemini', 'openai', 'openai-light'.
 * Returns { text, route }.
 */
export async function aiText(prompt, opts = {}) {
  const order = (opts.order || ['gemini', 'openai']).slice();
  // A route that refused a moment ago goes to the back of the queue, not out of it.
  order.sort((a, b) => (isDown(a) ? 1 : 0) - (isDown(b) ? 1 : 0));
  let first = null;
  for (const route of order) {
    try {
      let text;
      if (route === 'gemini') text = await geminiText(prompt, opts);
      else if (route === 'openai') text = await openAiText(prompt, opts);
      else if (route === 'openai-light') text = await openAiText(prompt, { ...opts, light: true });
      else continue;
      markUp(route);
      return { text, route };
    } catch (e) {
      console.warn('[mindmap] AI route ' + route + ' refused', e);
      if (routeFault(e)) markDown(route, e);
      if (!first) first = e;
    }
  }
  throw friendlyAiError(first);
}

export function friendlyAiError(e) {
  const msg = String(e && e.message || e || '');
  const code = String(e && e.code || '');
  let text = 'The AI could not answer just now. Please try again in a moment.';
  if (/resource-exhausted|quota|429|daily/i.test(code + msg)) text = 'You have used today\'s AI allowance on this account. It resets tomorrow.';
  else if (/unauthenticated/i.test(code)) text = 'Please sign in again to use the AI.';
  else if (/app.?check|attestation/i.test(msg)) text = 'The page could not be verified. Reload it and try again.';
  else if (/network|failed to fetch|offline/i.test(msg)) text = 'No connection. Check your internet and try again.';
  else if (/safety|blocked|policy/i.test(msg)) text = 'The AI would not make that. Try describing it differently.';
  const err = new Error(text);
  err.cause = e;
  return err;
}

export function aiRouteReport() {
  return ['gemini', 'openai', 'openai-light', 'imgServer', 'imgGemini'].map(r => ({ route: r, down: isDown(r), why: why.get(r) || '' }));
}

/* ------------------------------------------------------------------ */
/*  AI: pictures                                                        */
/* ------------------------------------------------------------------ */
function extractInlineImage(result) {
  const cands = result && result.response && result.response.candidates || [];
  for (const c of cands) for (const p of (c.content && c.content.parts) || []) {
    if (p.inlineData && p.inlineData.data) return p.inlineData;
  }
  return null;
}
async function geminiImage(prompt) {
  if (!geminiImageModels.length) throw new Error('No Gemini image model is available.');
  let last = null;
  for (let i = 0; i < geminiImageModels.length; i++) {
    try {
      const result = await geminiImageModels[i].generateContent([prompt]);
      const img = extractInlineImage(result);
      if (img) return { dataUrl: 'data:' + (img.mimeType || 'image/png') + ';base64,' + img.data, model: AI_IMAGE_MODELS[i] };
      throw new Error('The image model did not return a picture.');
    } catch (e) { last = e; }
  }
  throw last || new Error('Gemini could not draw that.');
}
async function openAiImage(prompt, { size = '1024x1024', quality = 'medium', transparent = false } = {}) {
  const call = httpsCallable(functions, 'openAiImage', { timeout: 240000 });
  const res = await call({ prompt: String(prompt), images: [], size, quality, background: transparent ? 'transparent' : 'auto', outputFormat: 'png' });
  const d = res && res.data;
  if (!d || typeof d.b64 !== 'string' || !d.b64) throw new Error('The picture service returned no picture.');
  return { dataUrl: 'data:' + (d.mimeType || 'image/png') + ';base64,' + d.b64, model: d.model || 'ChatGPT Images' };
}
/** Draw a picture → { dataUrl, model }. ChatGPT Images first, Gemini behind it. */
export async function aiImage(prompt, opts = {}) {
  const order = ['imgServer', 'imgGemini'].sort((a, b) => (isDown(a) ? 1 : 0) - (isDown(b) ? 1 : 0));
  let first = null;
  for (const route of order) {
    try {
      const out = route === 'imgServer' ? await openAiImage(prompt, opts) : await geminiImage(prompt);
      markUp(route);
      return out;
    } catch (e) {
      console.warn('[mindmap] image route ' + route + ' refused', e);
      if (routeFault(e)) markDown(route, e);
      if (!first) first = e;
    }
  }
  throw friendlyAiError(first);
}

/* ------------------------------------------------------------------ */
/*  Speech → text (Gemini), for browsers with no live recognition        */
/* ------------------------------------------------------------------ */
export async function transcribe(base64, mimeType) {
  if (!geminiModel) throw new Error('Speech-to-text is not available on this page.');
  const res = await geminiModel.generateContent({
    contents: [{ role: 'user', parts: [
      { text: 'Transcribe this recording exactly, in English (Singapore). It is a student or teacher giving instructions to a mind-mapping app. Reply with the words only, no quotes or notes. If nothing was said, reply with nothing.' },
      { inlineData: { mimeType: mimeType || 'audio/webm', data: base64 } }
    ] }],
    generationConfig: { maxOutputTokens: 800, temperature: 0, thinkingConfig: { thinkingLevel: AI_THINK_MIN } }
  });
  return ((res && res.response && res.response.text ? res.response.text() : '') || '').trim();
}

/* ------------------------------------------------------------------ */
/*  Pictures in Storage                                                 */
/* ------------------------------------------------------------------ */
/** Upload a data URL → https download URL. Throws when Storage refuses. */
export async function uploadDataUrl(path, dataUrl) {
  const ref = storageRef(storage, path);
  await uploadString(ref, dataUrl, 'data_url');
  return getDownloadURL(ref);
}
