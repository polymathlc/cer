// 💲 AI COST CORE — what one AI call cost, worked out from the usage the API
// reported and the price of the model that really answered.
//
// Pure: no DOM, no Firebase, no storage. app.js feeds it one usage record per
// call (`💲 AI COST METER` there) and the 🚨 Red light fixer shows the running
// total. tools/ai-cost-tests.mjs holds every rule below in place.
//
//  • THE MODEL THAT ANSWERED IS THE MODEL THAT IS PRICED. A call asked of
//    ChatGPT that fell through to Gemini is billed by Google at Gemini's rate,
//    so every record carries the route and the model id of the reply.
//  • REPORTED TOKENS WIN; AN ESTIMATE SAYS SO. The browser-key routes and
//    Gemini return their real token counts. The two server callables
//    (`askOpenAi`, `askKimi` in polymathlc/math) return only the text today,
//    so their calls are estimated from the characters sent and received and
//    the total is shown with a "≈". The day a callable starts returning
//    `usage`, it is read and the estimate stops, with nothing to change here.
//  • REASONING IS OUTPUT. OpenAI counts reasoning inside completion_tokens;
//    Gemini reports thoughtsTokenCount separately and bills it as output.
//  • A PRICE NOBODY KNOWS IS NOT ZERO. An unlisted model is priced at its
//    family's default and flagged `assumed`, so a total can never look cheap
//    because a new model id slipped past the table.
//  • PRICES ARE DATA. Every number below is a default the admin can change in
//    the price dialog; the overrides are merged over these, never replace them.

export const AI_PRICES_AS_OF = '2026-10-21';

// USD per million tokens. `perImage` is the fallback for a picture whose
// tokens were not reported. Image models price input text, input images and
// output images separately.
export const AI_DEFAULT_PRICES = {
  'gpt-6.1-sol':        { label: 'GPT-6.1 Sol',            in: 2.00, out: 10.00 },
  'gpt-6-luna':         { label: 'GPT-6 Luna',             in: 0.10, out: 0.50 },
  'gpt-6-astra':        { label: 'GPT-6 Astra',            in: 2.00, out: 10.00, assumed: true },
  'gemini-3.8-flash':   { label: 'Gemini 3.8 Flash',       in: 0.75, out: 3.75 },
  'kimi-k3':            { label: 'Kimi K3',                in: 3.00, out: 15.00 },
  'gpt-image-2.5':      { label: 'ChatGPT Images 2.5',     in: 6.25, imgIn: 10.00, out: 37.50, perImage: 0.067 },
  'gemini-image':       { label: 'Gemini image model',     in: 0.30, out: 30.00, perImage: 0.039, assumed: true },
};

// Which table row a model id belongs to. Longest-first prefixes, so a dated
// snapshot (gpt-6.1-sol-2026-09-01) or a size variant lands on its family.
const FAMILY_RULES = [
  [/^gpt-image-2\.5/i, 'gpt-image-2.5'],
  [/^gpt-image/i, 'gpt-image-2.5'],
  [/^gemini-.*image/i, 'gemini-image'],
  [/^gpt-6\.1-sol/i, 'gpt-6.1-sol'],
  [/^gpt-6-luna/i, 'gpt-6-luna'],
  [/^gpt-6-astra/i, 'gpt-6-astra'],
  [/^gemini-3\.8-flash/i, 'gemini-3.8-flash'],
  [/^kimi-k3/i, 'kimi-k3'],
];
// The family default for an id the table has never seen.
const ROUTE_DEFAULT = {
  gemini: 'gemini-3.8-flash', openai: 'gpt-6.1-sol', openaiKey: 'gpt-6.1-sol',
  kimi: 'kimi-k3', kimiKey: 'kimi-k3',
  imgServer: 'gpt-image-2.5', imgKey: 'gpt-image-2.5', imgGemini: 'gemini-image',
};

export const AI_ROUTE_NAMES = {
  gemini: 'Gemini', openai: 'ChatGPT (server key)', openaiKey: 'ChatGPT (key in this browser)',
  kimi: 'Kimi (server key)', kimiKey: 'Kimi (key in this browser)',
  imgServer: 'ChatGPT Images (server key)', imgKey: 'ChatGPT Images (key in this browser)', imgGemini: 'Gemini image model',
};

// A rough token count for text we only have as characters. Four characters a
// token is the published rule of thumb for English, and these prompts are
// English plus JSON.
export const CHARS_PER_TOKEN = 4;
// One picture sent at `detail: high` — the routes always send high. A
// 1024×1024 picture is four 512 tiles plus the base: 4 × 170 + 85 = 765, and
// a tall exam figure tiles to more, so the estimate leans a little high.
export const EST_TOKENS_PER_IMAGE = 1100;
// A reasoning model thinks before it writes. At the `low` effort these routes
// ask for, the thinking is typically about as long as the reply again.
export const EST_REASONING_FACTOR = 1;

function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }

export function priceKeyFor(model, route) {
  const id = String(model || '').trim();
  for (const [re, key] of FAMILY_RULES) if (re.test(id)) return { key, known: true };
  const fallback = ROUTE_DEFAULT[route] || (/image/i.test(id) ? 'gpt-image-2.5' : /gemini/i.test(id) ? 'gemini-3.8-flash' : /kimi|moonshot/i.test(id) ? 'kimi-k3' : 'gpt-6.1-sol');
  return { key: fallback, known: false };
}

// The defaults with the admin's overrides laid over them, field by field.
// Anything that is not a non-negative number is ignored, so a typo in the
// dialog cannot turn a price into NaN and the total into nothing.
export function mergePrices(overrides) {
  const out = {};
  for (const [key, row] of Object.entries(AI_DEFAULT_PRICES)) out[key] = { ...row };
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  for (const [key, row] of Object.entries(o)) {
    if (!out[key] || !row || typeof row !== 'object') continue;
    for (const field of ['in', 'out', 'imgIn', 'perImage']) {
      if (row[field] === '' || row[field] == null) continue;
      const n = Number(row[field]);
      if (Number.isFinite(n) && n >= 0) { out[key][field] = n; out[key].edited = true; }
    }
  }
  return out;
}

export function priceFor(model, route, prices) {
  const table = prices || AI_DEFAULT_PRICES;
  const { key, known } = priceKeyFor(model, route);
  const row = table[key] || AI_DEFAULT_PRICES[key];
  return { key, row, assumed: !known || !!row.assumed };
}

// Turns what an API said into one shape:
// { inTok, imgInTok, outTok, images, reported }
// `kind` is 'openai' (chat completions — OpenAI and Moonshot share it),
// 'gemini' (usageMetadata), or 'openaiImage' (the Images API's usage).
export function normalizeUsage(kind, raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (kind === 'gemini') {
    const inTok = num(raw.promptTokenCount);
    const outTok = num(raw.candidatesTokenCount) + num(raw.thoughtsTokenCount);
    if (!inTok && !outTok) return null;
    return { inTok, imgInTok: 0, outTok, images: 0, reported: true };
  }
  if (kind === 'openaiImage') {
    const d = raw.input_tokens_details || {};
    const imgIn = num(d.image_tokens);
    const textIn = d.text_tokens != null ? num(d.text_tokens) : Math.max(0, num(raw.input_tokens) - imgIn);
    const outTok = num(raw.output_tokens);
    if (!textIn && !imgIn && !outTok) return null;
    return { inTok: textIn, imgInTok: imgIn, outTok, images: 1, reported: true };
  }
  // Chat completions. Older shapes said input_tokens / output_tokens.
  const inTok = num(raw.prompt_tokens != null ? raw.prompt_tokens : raw.input_tokens);
  const outTok = num(raw.completion_tokens != null ? raw.completion_tokens : raw.output_tokens);
  if (!inTok && !outTok) return null;
  return { inTok, imgInTok: 0, outTok, images: 0, reported: true };
}

// What a call probably used when the API did not say.
export function estimateUsage({ promptChars = 0, images = 0, outChars = 0, reasoning = false } = {}) {
  const inTok = Math.ceil(num(promptChars) / CHARS_PER_TOKEN) + Math.round(num(images)) * EST_TOKENS_PER_IMAGE;
  const visible = Math.ceil(num(outChars) / CHARS_PER_TOKEN);
  const outTok = visible + (reasoning ? Math.ceil(visible * EST_REASONING_FACTOR) : 0);
  return { inTok, imgInTok: 0, outTok, images: 0, reported: false };
}

// USD for one record: { route, model, kind:'text'|'image', usage }.
export function costOf(rec, prices) {
  if (!rec) return { usd: 0, assumed: false, estimated: false, key: '' };
  const { key, row, assumed } = priceFor(rec.model, rec.route, prices);
  const u = rec.usage || {};
  let usd = 0;
  if (rec.kind === 'image') {
    const tokens = num(u.inTok) + num(u.imgInTok) + num(u.outTok);
    if (u.reported && tokens) {
      usd = num(u.inTok) * num(row.in) / 1e6 + num(u.imgInTok) * num(row.imgIn != null ? row.imgIn : row.in) / 1e6 + num(u.outTok) * num(row.out) / 1e6;
    } else {
      usd = Math.max(1, Math.round(num(u.images) || 1)) * num(row.perImage);
    }
  } else {
    usd = num(u.inTok) * num(row.in) / 1e6 + num(u.imgInTok) * num(row.imgIn != null ? row.imgIn : row.in) / 1e6 + num(u.outTok) * num(row.out) / 1e6;
  }
  return { usd, assumed, estimated: !u.reported, key };
}

// A running tally. `add` returns the record's cost so a caller can file it
// under a phase of its own (check / fix / recheck).
export function createTally() {
  return {
    usd: 0, calls: 0, estimatedCalls: 0, assumedCalls: 0, inTok: 0, outTok: 0, images: 0,
    byModel: {}, byPhase: {},
  };
}
export function tallyAdd(t, rec, prices, phase) {
  const c = costOf(rec, prices);
  const u = rec.usage || {};
  t.usd += c.usd;
  t.calls++;
  if (c.estimated) t.estimatedCalls++;
  if (c.assumed) t.assumedCalls++;
  t.inTok += num(u.inTok) + num(u.imgInTok);
  t.outTok += num(u.outTok);
  if (rec.kind === 'image') t.images += Math.max(1, Math.round(num(u.images) || 1));
  const m = t.byModel[c.key] || (t.byModel[c.key] = { usd: 0, calls: 0, estimated: 0 });
  m.usd += c.usd; m.calls++; if (c.estimated) m.estimated++;
  const p = phase || 'other';
  const ph = t.byPhase[p] || (t.byPhase[p] = { usd: 0, calls: 0 });
  ph.usd += c.usd; ph.calls++;
  return c;
}

// Money for people. Small totals keep enough places to move visibly with each
// call — a meter stuck on "$0.00" through the first hundred checks is a meter
// nobody trusts.
export function formatMoney(usd, { currency = 'USD', rate = 1 } = {}) {
  const v = num(usd) * (currency === 'USD' ? 1 : num(rate) || 1);
  const sym = currency === 'SGD' ? 'S$' : '$';
  const places = v === 0 ? 2 : v < 0.1 ? 4 : v < 10 ? 3 : 2;
  return sym + v.toFixed(places);
}

// What checking N more questions will probably cost, from what checks have
// actually cost in this browser. With no history, a typical check is priced:
// a ~3,500-token prompt with one picture and a ~600-token JSON reply on the
// model the checker leads with.
export function estimateCheckCost(n, avgUsd, model, route, prices) {
  const count = Math.max(0, Math.round(num(n)));
  if (!count) return 0;
  if (num(avgUsd)) return count * num(avgUsd);
  const typical = estimateUsage({ promptChars: 14000, images: 1, outChars: 2400, reasoning: /^(gpt-[5-9]|o[1-9]|kimi-k3)/i.test(String(model || '')) });
  return count * costOf({ kind: 'text', model, route, usage: typical }, prices).usd;
}
