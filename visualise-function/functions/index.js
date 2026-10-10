// Firebase Cloud Function: visualiseAi
//
// POST {imageDataUrl, note, mode?} ->
//   mode 'visualiser' (default): {ok:true, result:{name, questionText, answers, hint, code}}
//   mode 'webapp' (Snap & Play): {ok:true, result:{title, questionText, answers, hint, html}}
// POST {mode:'tweak', html, instruction, questionText?, answers?} -> same shape as webapp
// POST {mode:'enhance', imageDataUrl} -> {ok:true, result:{imageDataUrl}}
//   redraws a cropped question figure as clean black-and-white line work
//   (the same prompt cer's Rapid add uses), via the OpenAI image edit API.
// Optional `model` is honoured only when it is on MODEL_ALLOWLIST (prompt.js).
// The OpenAI key lives only in the Firebase secret OPENAI_API_KEY
// (firebase functions:secrets:set OPENAI_API_KEY). It is never sent to the browser.

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import {
  DEFAULT_MODEL, buildChatBody, cleanVisualiserReply,
  buildWebappChatBody, cleanWebappReply,
  buildTweakChatBody, pickModel, WEBAPP_MAX_HTML_CHARS, TWEAK_MAX_INSTRUCTION_CHARS,
  BW_ENHANCE_PROMPT,
} from './prompt.js';

const openaiKey = defineSecret('OPENAI_API_KEY');
const openaiModel = defineString('VISUALISE_OPENAI_MODEL', { default: DEFAULT_MODEL });

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_IMAGE_EDIT_URL = 'https://api.openai.com/v1/images/edits';
// The 2.5 image family reads the reference at high fidelity by itself and
// REFUSES input_fidelity, so it is never sent; no size either (the default
// keeps the figure's own shape).
const IMAGE_MODEL = 'gpt-image-2.5-flare';
const OPENAI_IMAGE_TIMEOUT_MS = 150000;
const OPENAI_TIMEOUT_MS = 100000;
const OPENAI_WEBAPP_TIMEOUT_MS = 170000;
   // a whole web app is a much longer reply
const MODES = {
  visualiser: { build: buildChatBody, clean: cleanVisualiserReply, timeoutMs: OPENAI_TIMEOUT_MS },
  webapp: { build: buildWebappChatBody, clean: cleanWebappReply, timeoutMs: OPENAI_WEBAPP_TIMEOUT_MS },
  // tweak: rewrite an existing app from a parent's typed instruction (no screenshot).
  tweak: { build: buildTweakChatBody, clean: cleanWebappReply, timeoutMs: OPENAI_WEBAPP_TIMEOUT_MS, noImage: true },
  // enhance: redraw a cropped diagram in black and white (image in, image out).
  enhance: { enhance: true, timeoutMs: OPENAI_IMAGE_TIMEOUT_MS },
};
// The stronger model thinks for longer; give it more time before giving up.
const SLOW_MODEL_EXTRA_MS = 100000;
const MAX_IMAGE_CHARS = 7 * 1024 * 1024;   // ~5 MB of base64 image data
const MAX_NOTE_CHARS = 2000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;    // whole JSON body, checked before parsing is trusted
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;

const ALLOWED_ORIGINS = [
  'https://polymathlc.github.io',
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

function originAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some((o) => (typeof o === 'string' ? o === origin : o.test(origin)));
}

// Small per-instance rate limit: enough to stop an accidental loop, not a
// substitute for App Check. maxInstances caps total spend as well.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  return list.length > RATE_MAX;
}

function fail(res, status, error, extra) {
  res.status(status).json({ ok: false, error, ...(extra || {}) });
}

async function callOpenAI({ imageDataUrl, note, mode, model, html, instruction, questionText, answers }) {
  const spec = MODES[mode] || MODES.visualiser;
  const key = openaiKey.value();
  if (!key) {
    const err = new Error('The server has no OpenAI key configured.');
    err.status = 500;
    throw err;
  }
  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(spec.timeoutMs + (model === 'gpt-6.1-sol' ? SLOW_MODEL_EXTRA_MS : 0)),
      body: JSON.stringify(spec.build({ imageDataUrl, note, model, html, instruction, questionText, answers })),
    });
  } catch (cause) {
    const timedOut = cause && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    const err = new Error(timedOut ? 'OpenAI took too long to answer. Please try again.' : 'Could not reach OpenAI.');
    err.status = timedOut ? 504 : 502;
    throw err;
  }

  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) { /* non-JSON error page */ }

  if (!response.ok) {
    const upstream = (data && data.error && data.error.message) || raw.slice(0, 300);
    logger.warn('OpenAI error', { status: response.status, upstream });
    const err = new Error(
      response.status === 401 ? 'The server OpenAI key was rejected (401). Ask the admin to reset the secret.'
        : response.status === 429 ? 'OpenAI is rate limited or out of credit (429). Please wait a minute and try again.'
          : response.status === 400 ? 'OpenAI could not read this request (400): ' + upstream
            : 'OpenAI error ' + response.status + '.'
    );
    err.status = response.status === 429 ? 429 : response.status === 400 ? 400 : 502;
    throw err;
  }

  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (!content) {
    const err = new Error(choice && choice.finish_reason === 'length'
      ? 'The AI ran out of room before finishing. Try a simpler or cropped screenshot.'
      : choice && choice.message && choice.message.refusal ? 'The AI declined: ' + choice.message.refusal
        : 'The AI returned an empty reply.');
    err.status = 502;
    throw err;
  }
  try {
    return spec.clean(content);
  } catch (cause) {
    const err = new Error(cause.message || 'The AI reply could not be used.');
    err.status = 502;
    throw err;
  }
}

function upstreamError(response, data, raw) {
  const upstream = (data && data.error && data.error.message) || String(raw || '').slice(0, 300);
  logger.warn('OpenAI error', { status: response.status, upstream });
  const err = new Error(
    response.status === 401 ? 'The server OpenAI key was rejected (401). Ask the admin to reset the secret.'
      : response.status === 429 ? 'OpenAI is rate limited or out of credit (429). Please wait a minute and try again.'
        : response.status === 400 ? 'OpenAI could not read this request (400): ' + upstream
          : 'OpenAI error ' + response.status + '.'
  );
  err.status = response.status === 429 ? 429 : response.status === 400 ? 400 : 502;
  return err;
}

async function callOpenAIEnhance({ imageDataUrl }) {
  const key = openaiKey.value();
  if (!key) {
    const err = new Error('The server has no OpenAI key configured.');
    err.status = 500;
    throw err;
  }
  const m = /^data:(image\/(png|jpe?g|webp|gif));base64,([\s\S]+)$/.exec(imageDataUrl);
  if (!m) {
    const err = new Error('The picture must be a PNG, JPEG, WebP or GIF data URL.');
    err.status = 400;
    throw err;
  }
  const mime = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const bytes = Buffer.from(m[3].replace(/\s+/g, ''), 'base64');
  const form = new FormData();
  form.append('model', IMAGE_MODEL);
  form.append('prompt', BW_ENHANCE_PROMPT);
  form.append('image', new Blob([bytes], { type: mime }), 'figure.' + ext);

  let response;
  try {
    response = await fetch(OPENAI_IMAGE_EDIT_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(OPENAI_IMAGE_TIMEOUT_MS),
      body: form,
    });
  } catch (cause) {
    const timedOut = cause && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    const err = new Error(timedOut ? 'The image model took too long. Please try again.' : 'Could not reach OpenAI.');
    err.status = timedOut ? 504 : 502;
    throw err;
  }
  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) { /* non-JSON error page */ }
  if (!response.ok) throw upstreamError(response, data, raw);
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) {
    const err = new Error('The image model returned no picture.');
    err.status = 502;
    throw err;
  }
  return { imageDataUrl: 'data:image/png;base64,' + b64 };
}

export const visualiseAi = onRequest(
  {
    region: 'us-central1',
    secrets: [openaiKey],
    cors: ALLOWED_ORIGINS,
    timeoutSeconds: 300,
    memory: '256MiB',
    maxInstances: 3,
    concurrency: 20,
    invoker: 'public',
  },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { fail(res, 405, 'Use POST.'); return; }

    const origin = req.get('origin') || '';
    if (!originAllowed(origin)) { fail(res, 403, 'This origin is not allowed.'); return; }

    // Google's front end appends the real client address last; earlier entries are client-supplied.
    const ip = String(req.get('x-forwarded-for') || req.ip || 'unknown').split(',').pop().trim() || 'unknown';
    if (rateLimited(ip)) { fail(res, 429, 'Too many requests. Please wait a few minutes.'); return; }

    const declared = Number(req.get('content-length') || 0);
    const rawSize = req.rawBody ? req.rawBody.length : declared;
    if (declared > MAX_BODY_BYTES || rawSize > MAX_BODY_BYTES) { fail(res, 413, 'The request is too large. Crop or shrink the screenshot and try again.'); return; }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
    if (!body || typeof body !== 'object') { fail(res, 400, 'Send a JSON body {imageDataUrl, note}.'); return; }

    const imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl.trim() : '';
    const note = typeof body.note === 'string' ? body.note.slice(0, MAX_NOTE_CHARS) : '';
    const mode = body.mode == null || body.mode === '' ? 'visualiser' : String(body.mode);
    if (!Object.prototype.hasOwnProperty.call(MODES, mode)) { fail(res, 400, 'Unknown mode "' + mode.slice(0, 20) + '".'); return; }
    const spec = MODES[mode];
    const model = pickModel(body.model, openaiModel.value());
    let html = '';
    let instruction = '';
    let questionText = '';
    let answers = [];
    if (spec.noImage) {
      html = typeof body.html === 'string' ? body.html : '';
      instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, TWEAK_MAX_INSTRUCTION_CHARS) : '';
      questionText = typeof body.questionText === 'string' ? body.questionText.slice(0, 4000) : '';
      answers = Array.isArray(body.answers) ? body.answers.slice(0, 12).map((a) => String(a).slice(0, 80)) : [];
      if (!instruction) { fail(res, 400, 'Type what you want changed first.'); return; }
      if (!html.trim()) { fail(res, 400, 'There is no app to change yet.'); return; }
      if (html.length > WEBAPP_MAX_HTML_CHARS) { fail(res, 413, 'This app is too large to change.'); return; }
    } else {
    if (!imageDataUrl) { fail(res, 400, 'Add a screenshot of the question first.'); return; }
    if (imageDataUrl.length > MAX_IMAGE_CHARS) { fail(res, 413, 'The screenshot is too large. Crop or shrink it and try again.'); return; }
    if (!IMAGE_DATA_URL.test(imageDataUrl.slice(0, 64)) || !/^data:image\/[a-z]+;base64,/.test(imageDataUrl)) {
      fail(res, 400, 'The screenshot must be a PNG, JPEG, WebP or GIF data URL.');
      return;
    }
    }

    const started = Date.now();
    try {
      const result = spec.enhance
        ? await callOpenAIEnhance({ imageDataUrl })
        : await callOpenAI({ imageDataUrl, note, mode, model, html, instruction, questionText, answers });
      logger.info('visualiseAi ok', { mode, model: spec.enhance ? IMAGE_MODEL : model, ms: Date.now() - started, codeChars: (result.code || result.html || result.imageDataUrl || '').length });
      res.status(200).json({ ok: true, result });
    } catch (err) {
      logger.error('visualiseAi failed', { mode, model, ms: Date.now() - started, message: err.message });
      fail(res, err.status || 500, err.message || 'Something went wrong.');
    }
  }
);
