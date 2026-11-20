'use strict';

// Chung GPT for the Free Question of the Day: the one door to the AI, used by the
// dailyQuestion function (marking a child's typed answer) and by the prepare run in
// GitHub Actions (reading worksheets, cleaning crops, the independent check).
//
// Chung GPT in Ans Key is window.askGemini: ChatGPT on the centre's OpenAI key first
// (GPT-6.1 Sol by default), then Gemini. On the server there is no browser and no
// Firebase AI, so this is the first route of that chain on the server's key, the
// existing Firebase secret OPENAI_API_KEY (the one the homework helper, Rapid add's
// Decisions and the visualiser already use): the same engine, the same model.
//
// It never logs a prompt or an answer: the repository and its Actions logs are public.
const DEFAULT_MODEL = 'gpt-6.1-sol';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const REASONING = /^(gpt-[5-9]|o[1-9])/;

class AiError extends Error {
  constructor(code, message, status = 0) { super(message || code); this.code = code; this.status = status; }
}

// Pulls one JSON object out of a reply, with or without a ``` fence round it.
function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  throw new AiError('unreadable', 'the reply could not be read');
}

// createChungGpt({ apiKey, model, fetchImpl }) → ask(prompt, { system, images, json, effort, maxTokens, timeoutMs })
// images: [{ mimeType, data }] with base64 data (no data: prefix).
function createChungGpt({ apiKey, model = DEFAULT_MODEL, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const keyOf = typeof apiKey === 'function' ? apiKey : () => apiKey;
  const usage = { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, ms: 0 };

  async function ask(prompt, { system = '', images = [], json = false, effort = 'low', maxTokens = 4000, timeoutMs = 60000, detail = 'high' } = {}) {
    const key = String(keyOf() || '').trim();
    if (!key) throw new AiError('not-configured', 'Chung GPT has no key');
    const content = [{ type: 'text', text: String(prompt) }];
    for (const img of images || []) {
      if (!img || !img.data) continue;
      content.push({ type: 'image_url', image_url: { url: 'data:' + (img.mimeType || 'image/jpeg') + ';base64,' + img.data, detail } });
    }
    let sys = String(system || '');
    // json_object mode is refused unless the word "json" appears somewhere.
    if (json && !/json/i.test(sys + ' ' + prompt)) sys += (sys ? '\n' : '') + 'Reply with JSON only.';
    const messages = [];
    if (sys) messages.push({ role: 'system', content: sys });
    messages.push({ role: 'user', content });
    const body = { model, messages, max_completion_tokens: Math.max(256, maxTokens) };
    if (json) body.response_format = { type: 'json_object' };
    if (REASONING.test(model)) body.reasoning_effort = effort === 'none' || effort === 'minimal' ? 'low' : effort;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    usage.calls++;
    try {
      let res;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify(body)
        });
      } catch (error) {
        throw new AiError(error && error.name === 'AbortError' ? 'timeout' : 'unreachable', 'Chung GPT could not be reached');
      }
      if (!res.ok) {
        let detailText = '';
        try { const j = await res.json(); detailText = j && j.error ? String(j.error.message || '') : ''; } catch { /* not JSON */ }
        // A model that will not take the reasoning setting still answers without it.
        if (res.status === 400 && body.reasoning_effort && /reasoning|unsupported|unknown parameter/i.test(detailText)) {
          delete body.reasoning_effort;
          const again = await fetchImpl(ENDPOINT, { method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
          if (again.ok) return read(await again.json());
        }
        throw new AiError(res.status === 429 ? 'busy' : res.status === 401 ? 'bad-key' : 'refused', 'Chung GPT said ' + res.status, res.status);
      }
      return read(await res.json());
    } catch (error) {
      usage.failures++;
      throw error instanceof AiError ? error : new AiError('failed', String(error && error.message || error));
    } finally {
      clearTimeout(timer);
      usage.ms += now() - started;
    }
    function read(data) {
      const choice = data && data.choices && data.choices[0];
      const text = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
      if (data && data.usage) {
        usage.inputTokens += Number(data.usage.prompt_tokens) || 0;
        usage.outputTokens += Number(data.usage.completion_tokens) || 0;
      }
      if (!text.trim()) throw new AiError(choice && choice.finish_reason === 'length' ? 'too-long' : 'empty', 'Chung GPT sent back no answer');
      return json ? parseJson(text) : text.trim();
    }
  }
  return { ask, usage, model };
}

module.exports = { createChungGpt, parseJson, AiError, DEFAULT_MODEL, ENDPOINT };
