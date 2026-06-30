// =====================================================================
// AI module — Firebase AI Logic + Gemini (extracted for reuse)
// =====================================================================
// Drop this file into your project and `import` the helpers you need:
//   import { askGemini, askGeminiVision, askGeminiCached, imageAiReady, geminiImageModels } from './ai-credentials.js';
//
// Requires the Firebase web SDK (loaded here from gstatic CDN — same
// version as the source app, 11.10.0). No bundler needed; this works as a
// native ES module in the browser.
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
// App Check (protects the Gemini quota from abuse) + Firebase AI Logic (free-tier Gemini)
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js";
import { getAI, getGenerativeModel, GoogleAIBackend, ResponseModality } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-ai.js";

// ---------------------------------------------------------------------
// CREDENTIALS — Firebase web config.
// NOTE: a Firebase web `apiKey` is NOT a secret — it identifies the
// project, not authorizes access. Real protection comes from App Check
// (below) + your Firestore/Storage security rules. It is meant to ship
// in client code.
//
// To point this at YOUR OWN Firebase project instead, replace the whole
// config block + the reCAPTCHA site key with the values from
// Firebase Console > Project settings, and enable Build > AI Logic.
// ---------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo",
  authDomain: "mathgen--app.firebaseapp.com",
  projectId: "mathgen--app",
  storageBucket: "mathgen--app.firebasestorage.app",
  messagingSenderId: "165654161198",
  appId: "1:165654161198:web:16c8bd60eb3a2aa7edbcbf",
  measurementId: "G-0MWZFG211D"
};

// reCAPTCHA v3 *site key* for App Check. Register your domain(s) in
// Firebase Console > Build > App Check. Until a real key is set, App
// Check stays off and AI still works while enforcement is disabled.
const RECAPTCHA_SITE_KEY = "6Le98gwtAAAAAAzkjJTZXFM5D8tpjx_P4rtRuhuH";

// Models
const AI_MODEL = "gemini-3.5-flash"; // text/vision model
// Image generation / editing models ("Nano Banana"). Tried in order; the
// first that returns an image wins.
const AI_IMAGE_MODELS = ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"];

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
const app = initializeApp(firebaseConfig);

if (RECAPTCHA_SITE_KEY && !RECAPTCHA_SITE_KEY.startsWith("PASTE_")) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  } catch (e) {
    console.warn("App Check init failed:", e);
  }
}

let geminiModel = null;
let _aiInstance = null;
let geminiImageModels = [];
try {
  _aiInstance = getAI(app, { backend: new GoogleAIBackend() });
  geminiModel = getGenerativeModel(_aiInstance, { model: AI_MODEL });
} catch (e) {
  console.warn("Firebase AI init failed (Ask AI / AI marking disabled):", e);
}
try {
  if (_aiInstance) geminiImageModels = AI_IMAGE_MODELS.map(model => getGenerativeModel(_aiInstance, {
    model,
    generationConfig: { responseModalities: [ResponseModality.TEXT, ResponseModality.IMAGE] }
  }));
} catch (e) { console.warn("Firebase image AI init failed:", e); }

const aiReady = () => !!geminiModel;
const imageAiReady = () => geminiImageModels.length > 0;

// ---------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------
// Single swap-point for all text model calls. Returns trimmed text.
// thinkingBudget:0 disables Gemini "thinking" so the whole token budget
// goes to the actual answer (faster + cheaper for short tasks).
async function askGemini(prompt, { maxOutputTokens = 512, temperature = 0.3, json = false } = {}) {
  if (!geminiModel) throw new Error("AI is not configured yet");
  const generationConfig = { maxOutputTokens, temperature, thinkingConfig: { thinkingBudget: 0 } };
  if (json) generationConfig.responseMimeType = "application/json";
  const res = await geminiModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig
  });
  return (res.response.text() || "").trim();
}

// Multimodal call: a text prompt plus inline image/PDF parts.
// media: [{ mimeType, data }]  where data is base64 (no data: prefix).
async function askGeminiVision(prompt, media, { maxOutputTokens = 2048, json = false } = {}) {
  if (!geminiModel) throw new Error('AI is not configured yet');
  const parts = [{ text: prompt }];
  (media || []).forEach(m => parts.push({ inlineData: { mimeType: m.mimeType, data: m.data } }));
  const generationConfig = { maxOutputTokens, temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } };
  if (json) generationConfig.responseMimeType = 'application/json';
  const res = await geminiModel.generateContent({ contents: [{ role: 'user', parts }], generationConfig });
  return (res.response.text() || '').trim();
}

// ---------------------------------------------------------------------
// Helpers: tolerant JSON parse + session cache
// ---------------------------------------------------------------------
// Tolerant JSON parse for model output (strips code fences, finds the array/object).
function _parseAIJson(raw) {
  let s = (raw || '').trim();
  if (!s) throw new Error('empty AI response — please try again');
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.search(/[\[{]/);
  if (start > 0) s = s.slice(start);
  try { return JSON.parse(s); }
  catch (firstErr) {
    try { return JSON.parse(_repairAIJson(s)); }
    catch (_) { throw firstErr; }
  }
}
// Best-effort repair for slightly-malformed or TRUNCATED model JSON.
function _repairAIJson(s) {
  let out = '', inString = false, escaped = false;
  const closers = [];
  for (const ch of String(s || '')) {
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch; continue;
    }
    if (ch === '"') { out += ch; inString = true; continue; }
    if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if ((ch === '}' || ch === ']') && closers[closers.length - 1] === ch) closers.pop();
    out += ch;
  }
  if (inString) out += '"';
  while (closers.length) out += closers.pop();
  return out.replace(/,\s*([}\]])/g, '$1');
}

// Cache identical requests for the session so repeats are free/instant.
function _aiHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return "ai:" + (h >>> 0).toString(36);
}
async function askGeminiCached(prompt, opts) {
  const key = _aiHash(prompt);
  try { const c = sessionStorage.getItem(key); if (c !== null) return c; } catch (e) {}
  const out = await askGemini(prompt, opts);
  try { sessionStorage.setItem(key, out); } catch (e) {}
  return out;
}

export {
  app,
  geminiModel,
  geminiImageModels,
  aiReady,
  imageAiReady,
  askGemini,
  askGeminiVision,
  askGeminiCached,
  _parseAIJson,
  AI_MODEL,
  AI_IMAGE_MODELS,
};
