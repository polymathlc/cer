// Server-only text, vision and reasoning routing. Figure generation has its
// own image model and does not pass through this JSON-only route.
export const RAPID_AI_ORDER = Object.freeze(['openai', 'gemini', 'kimi']);
// Three reading attempts, a 120-second redraw and another three verification
// attempts fit inside the 540-second figure task even during provider outages.
export const RAPID_AI_TIMEOUT_MS = 60000;

export function rapidAiOrder(preferred) {
  const selected = Array.isArray(preferred) ? preferred.filter(engine => RAPID_AI_ORDER.includes(engine)) : [];
  return [...new Set([...selected, ...RAPID_AI_ORDER])];
}

function completeJson(result, provider) {
  if (result?.candidates?.[0]?.finishReason !== 'STOP' || typeof result.text !== 'string' || !result.text.trim()) {
    throw new Error(provider + ' response was incomplete.');
  }
  const value = JSON.parse(result.text);
  if (!value || typeof value !== 'object') throw new Error(provider + ' did not return a JSON object.');
  return result;
}

export function createRapidAiRouter({openaiKey, openaiModel, getKimiKey, kimiModel, generateGemini, fetchImpl = (...args) => fetch(...args)}) {
  return async (prompt, images = [], job = {}, validate) => {
    let lastError;
    for (const engine of rapidAiOrder(job.engineOrder)) {
      try {
        let result;
        if (engine === 'gemini') {
          result = await generateGemini(prompt, images, RAPID_AI_TIMEOUT_MS);
        } else {
          const credential = engine === 'openai' ? openaiKey() : await getKimiKey();
          if (typeof credential !== 'string' || !credential.trim()) throw new Error(engine + ' backup is not configured.');
          const content = [{type:'text', text:prompt}, ...images.map(data => ({type:'image_url', image_url:{url:'data:image/jpeg;base64,' + data}}))];
          const options = engine === 'openai'
            ? {model:openaiModel(), max_completion_tokens:24000, reasoning_effort:'medium'}
            : {model:kimiModel(), max_completion_tokens:24000, reasoning_effort:'high'};
          const response = await fetchImpl(engine === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.moonshot.ai/v1/chat/completions', {
            method:'POST', headers:{Authorization:'Bearer ' + credential, 'Content-Type':'application/json'},
            signal:AbortSignal.timeout(RAPID_AI_TIMEOUT_MS), body:JSON.stringify({...options, response_format:{type:'json_object'}, messages:[{role:'user', content}]})
          });
          if (!response.ok) throw new Error(engine + ' request failed (' + response.status + ').');
          const choice = (await response.json()).choices?.[0];
          result = {text:choice?.message?.content, candidates:[{finishReason:choice?.finish_reason === 'stop' ? 'STOP' : choice?.finish_reason}]};
        }
        completeJson(result, engine);
        // A syntactically complete reply can still omit required question
        // blocks. Let the caller's shape check trigger the next provider too.
        if (validate) validate(result);
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('No online AI engine available.');
  };
}

// Kimi reuses the project's existing shared secret without making a missing
// optional backup a Firebase deployment prerequisite. ADC and provider keys
// remain on the server. Cache successful reads, and briefly back off a missing
// secret/permission instead of repeatedly calling Secret Manager per figure.
export function createOptionalKimiKeyReader({projectId, getAccessToken, fetchImpl = (...args) => fetch(...args), envKey = () => process.env.MOONSHOT_API_KEY, now = Date.now}) {
  let cached = '', retryAfter = 0, pending;
  return async () => {
    const configured = envKey();
    if (typeof configured === 'string' && configured.trim()) return configured.trim();
    if (cached) return cached;
    if (now() < retryAfter) return '';
    if (!pending) pending = (async () => {
      try {
        const token = await getAccessToken();
        if (!token?.access_token) throw new Error('No server identity for the optional backup.');
        const response = await fetchImpl('https://secretmanager.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/secrets/MOONSHOT_API_KEY/versions/latest:access', {
          headers:{Authorization:'Bearer ' + token.access_token}, signal:AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error('Optional backup secret is unavailable (' + response.status + ').');
        const payload = (await response.json()).payload;
        if (typeof payload?.data !== 'string') throw new Error('Optional backup secret is empty.');
        cached = Buffer.from(payload.data, 'base64').toString('utf8').trim();
        if (!cached) throw new Error('Optional backup secret is empty.');
        return cached;
      } catch {
        retryAfter = now() + 60000;
        return '';
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  };
}
