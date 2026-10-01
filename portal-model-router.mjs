// Authenticated text/vision calls for the standalone learning pages.
// The public lesson remains usable when server AI is unavailable.
export function createPortalModelRouter({call, gemini}) {
  return async function ask(prompt, media = [], opts = {}) {
    const {maxOutputTokens = 1024, json = true, reasoningEffort = 'low', temperature = 0.2} = opts;
    const payload = {prompt, media, maxOutputTokens, json, reasoningEffort, model: 'gpt-6.1-sol'};
    let firstError;
    for (const engine of ['openai', 'gemini', 'kimi']) {
      try {
        let text;
        if (engine === 'gemini') {
          const model = gemini();
          if (!model) throw new Error('Gemini backup is unavailable.');
          const config = {maxOutputTokens, temperature, thinkingConfig: {thinkingLevel: ['high','xhigh','max'].includes(reasoningEffort) ? 'high' : reasoningEffort === 'medium' ? 'medium' : 'low'}};
          if (json) config.responseMimeType = 'application/json';
          const result = await model.generateContent({contents: [{role: 'user', parts: [{text: prompt}, ...media.map(m => ({inlineData: {mimeType: m.mimeType, data: m.data}}))]}], generationConfig: config});
          if (result.response?.candidates?.some(c => c.finishReason === 'MAX_TOKENS')) throw new Error('Gemini response was incomplete.');
          text = result.response.text();
        } else {
          text = await call(engine === 'openai' ? 'askOpenAi' : 'askKimi', engine === 'openai' ? payload : {...payload, model: 'kimi-k3'});
        }
        if (typeof text !== 'string' || !text.trim()) throw new Error('The AI returned no answer.');
        return text.trim();
      } catch (error) { firstError ||= error; }
    }
    throw firstError || new Error('AI is unavailable right now.');
  };
}
