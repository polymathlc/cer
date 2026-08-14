# Gemini AI starter kit (Firebase AI Logic) — for new Polymath apps

Copy-paste snippets for wiring a new single-file HTML app to the SAME Gemini
stack used by `index.html` and `bar-model.html`.

**Important:** there is no secret Gemini API key. The apps call Gemini through
**Firebase AI Logic** on the shared Polymath Firebase project `mathgen--app`.
Everything below is *public* client config — safe to ship in HTML. Quota abuse
is prevented by **App Check (reCAPTCHA v3)**, enforced in the Firebase console.

---

## 1. Keys / config (public)

```js
// Shared Polymath Firebase project — same across all apps
const firebaseConfig = {
  apiKey: "AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo",   // public Firebase web API key (NOT a secret)
  authDomain: "mathgen--app.firebaseapp.com",
  projectId: "mathgen--app",
  storageBucket: "mathgen--app.firebasestorage.app",
  messagingSenderId: "165654161198",
  appId: "1:165654161198:web:16c8bd60eb3a2aa7edbcbf",
  measurementId: "G-0MWZFG211D"
};

// App Check (reCAPTCHA v3) site key — registered for polymathlc.github.io (+ localhost)
const RECAPTCHA_SITE_KEY = "6Le98gwtAAAAAAzkjJTZXFM5D8tpjx_P4rtRuhuH";

// Model used app-wide (text + vision)
const AI_MODEL = "gemini-3.7-flash";
// The floor of the thinking scale — 3.7 Flash rejects the "minimal" level
// 3.6 took, with a 400, so "low" is the cheapest level it will accept.
const AI_THINK_MIN = "low";
```

If the new app is hosted on a NEW domain (not `polymathlc.github.io`), add that
domain in Firebase Console → Build → App Check → reCAPTCHA v3 settings, or AI
calls will be rejected once enforcement is on.

---

## 2. Boilerplate — Firebase init + App Check + Gemini model

Put this in a `<script type="module">`:

```html
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-ai.js";

const firebaseConfig = { /* …from section 1… */ };
const RECAPTCHA_SITE_KEY = "6Le98gwtAAAAAAzkjJTZXFM5D8tpjx_P4rtRuhuH";
const AI_MODEL = "gemini-3.7-flash";
// The floor of the thinking scale — 3.7 Flash rejects the "minimal" level
// 3.6 took, with a 400, so "low" is the cheapest level it will accept.
const AI_THINK_MIN = "low";

const app = initializeApp(firebaseConfig);

// App Check protects the shared Gemini quota. If enforcement is disabled in
// the console, AI still works without a valid token.
if (RECAPTCHA_SITE_KEY && !RECAPTCHA_SITE_KEY.startsWith("PASTE_")) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  } catch (e) { console.warn("App Check init failed:", e); }
}

let geminiModel = null;
try {
  geminiModel = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), { model: AI_MODEL });
} catch (e) { console.warn("Firebase AI init failed (AI disabled):", e); }
const aiReady = () => !!geminiModel;
</script>
```

---

## 3. Text call — `askGemini`

`thinkingLevel: "low"` keeps Gemini "thinking" to a minimum so the whole token
budget goes to the answer (faster + cheaper for short tasks). Gemini 3.x rejects
the older numeric `thinkingBudget` with 400 INVALID_ARGUMENT.

**On 3.7 Flash the valid levels are `"low"`, `"medium"` (the default) and
`"high"`.** The `"minimal"` level 3.6 accepted was dropped and now comes back
400 — so keep the floor in one constant (`AI_THINK_MIN`) rather than writing the
string at each call site, and a future model change is one edit rather than a
hunt through the file. Use the floor for short/fast tasks; bump to `"high"` only
for genuinely hard reasoning. `json: true` switches on strict-JSON response mode.

```js
async function askGemini(prompt, { maxOutputTokens = 512, temperature = 0.3, json = false } = {}) {
  if (!geminiModel) throw new Error("AI is not configured yet");
  const generationConfig = { maxOutputTokens, temperature, thinkingConfig: { thinkingLevel: AI_THINK_MIN } };
  if (json) generationConfig.responseMimeType = "application/json";
  const res = await geminiModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig
  });
  return (res.response.text() || "").trim();
}
```

---

## 4. Vision call — `askGeminiVision` (prompt + inline image)

Temperature 0.2 (marking should be consistent, not creative); JSON mode on by
default. Pass base64 image data WITHOUT the `data:` prefix.

```js
async function askGeminiVision(promptText, imageBase64, mimeType, options) {
  if (!geminiModel) throw new Error("AI is not configured yet");
  options = options || {};
  const parts = [{ text: promptText }];
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: mimeType || "image/png", data: imageBase64 } });
  }
  const generationConfig = {
    maxOutputTokens: options.maxOutputTokens || 1200,
    temperature: 0.2,
    thinkingConfig: { thinkingLevel: AI_THINK_MIN }
  };
  if (options.json !== false) generationConfig.responseMimeType = "application/json";
  const result = await geminiModel.generateContent({
    contents: [{ role: "user", parts: parts }],
    generationConfig
  });
  return (result.response.text() || "").trim();
}
```

---

## 5. Tolerant JSON parser — `_parseAIJson` / `_repairAIJson`

ALWAYS parse model JSON through this (never bare `JSON.parse`). It strips code
fences, finds the first `{`/`[`, and repairs truncated/malformed output:
escapes unescaped inner quotes and raw newlines, closes an unterminated
string, drops a dangling half-written key, balances open brackets, and drops
trailing commas. Keep this in sync with `index.html`.

```js
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
  s = String(s || '');
  let out = '', inString = false, escaped = false;
  const closers = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') {
        // Only a real close-quote if what follows continues the JSON
        // structure; otherwise it's an unescaped quote INSIDE the string
        // (e.g. feedback text quoting the word "friction") — escape it.
        let j = i + 1;
        while (j < s.length && ' \t\r\n'.includes(s[j])) j++;
        const nxt = j < s.length ? s[j] : '';
        let close = false;
        if (!nxt || ':}]'.includes(nxt)) close = true;
        else if (nxt === ',') {
          // A real close is followed by the NEXT element after the comma —
          // a quoted key/value, number, object/array or literal. Prose
          // (like: "no", so the toy…) is not, so the quote is internal.
          let k = j + 1;
          while (k < s.length && ' \t\r\n'.includes(s[k])) k++;
          close = k >= s.length || '"{[}]-0123456789'.includes(s[k]) ||
                  /^(true|false|null)\b/.test(s.slice(k, k + 6));
        }
        if (close) { out += ch; inString = false; } else out += '\\"';
        continue;
      }
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
  // A response cut off in the middle of a KEY (e.g. …,"feedb or …,"feedback":)
  // leaves a dangling key that no amount of bracket-closing fixes — drop it.
  out = out.replace(/([{,]\s*)"(?:[^"\\]|\\.)*"\s*:?\s*$/, '$1').replace(/,\s*$/, '');
  while (closers.length) out += closers.pop();
  return out.replace(/,\s*([}\]])/g, '$1');
}
```

Typical usage:

```js
const raw = await askGemini(prompt, { maxOutputTokens: 800, json: true });
const data = _parseAIJson(raw); // object or array, throws with a clear message on failure
```

---

## 6. Optional extras (copy only if the new app needs them)

- **Admin Google sign-in** (Firebase Auth popup + `onAuthStateChanged` bridge to
  a non-module script): see `bar-model.html` ~line 1860.
- **Admin-only ChatGPT engine with Gemini fallback** (OpenAI key in
  localStorage, falls back to `askGeminiVision` on any failure): see
  `bar-model.html` `askOpenAiVision` ~line 4100 and the engine picker ~line 4068.
- **Image generation ("Nano Banana")**: `index.html` ~line 7868 —
  `AI_IMAGE_MODELS = ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"]`
  with `responseModalities: [TEXT, IMAGE]`.
- **Session request cache** (`_aiHash`, djb2 hash of the prompt): `index.html`
  ~line 7965.

## House rules for any new app

- Add an admin-only version badge and bump it on every change (see CLAUDE.md).
- Validate module JS with `node --check` after edits.
- Keep the parser and call shapes in sync with `index.html`.
