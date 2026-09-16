'use strict';

const { LiveError } = require('./live-service');

// Live has its own JSON session protocol. Do not replace it with Realtime's
// multipart SDP endpoint or Location/call_id response handling.
// https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
function createProvider({ apiKey, fetchImpl = fetch, connect, closeTimeoutMs = 12000 }) {
  function key() {
    const value = apiKey();
    if (!value) throw new LiveError(503, 'live_not_configured', 'Live assistance is not ready yet. You can still use Ainstein by typing.');
    return value;
  }

  async function create(sdp, session) {
    const response = await fetchImpl('https://api.openai.com/v1/live/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, transport: { type: 'webrtc', sdp } }),
      signal: AbortSignal.timeout(25000)
    });
    // Never return or log upstream errors, which can include key/project data.
    if (!response.ok) {
      if (response.status === 429) throw new LiveError(429, 'live_busy', 'Live assistance is busy. Please try again shortly.');
      throw new Error('Live session creation failed.');
    }
    const payload = await response.json();
    const sessionId = payload?.session?.id;
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(sessionId)) throw new Error('Invalid live session identifier.');
    if (payload?.transport?.type !== 'webrtc' || typeof payload.transport.sdp !== 'string' || !payload.transport.sdp.startsWith('v=0')) {
      // We know this ID, so close a malformed response instead of leaking a call.
      const error = new Error('Invalid live answer.');
      error.sessionId = sessionId;
      throw error;
    }
    return { sessionId, sdp: payload.transport.sdp };
  }

  // REST hangup is described for SIP. Sideband session.close is explicitly
  // documented for WebRTC, and lets us confirm finalization server-side.
  // https://developers.openai.com/api/docs/guides/voice-server-controls?api=live
  function close(sessionId) {
    const token = key();
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      const timer = setTimeout(() => finish(new Error('Live close timed out.')), closeTimeoutMs);
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (socket) { socket.removeAllListeners(); socket.on('error', () => {}); socket.terminate(); }
        error ? reject(error) : resolve();
      }
      try {
        socket = connect(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`, {
          headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: closeTimeoutMs,
          maxPayload: 1024 * 1024
        });
        socket.on('open', () => {
          try { socket.send(JSON.stringify({ type: 'session.close' })); }
          catch { finish(new Error('Live close failed.')); }
        });
        socket.on('message', data => {
          let event;
          try { event = JSON.parse(data.toString()); } catch { return; }
          if (event.type === 'session.closed') finish();
          else if (event.type === 'error') finish(new Error('Live close was rejected.'));
          // Audio/transcripts reflected to sideband are deliberately discarded.
        });
        socket.on('unexpected-response', (_request, response) => {
          response.resume();
          // An already-finalized session is absent; stop remains idempotent.
          finish([404, 410].includes(response.statusCode) ? null : new Error('Live close failed.'));
        });
        socket.on('error', () => finish(new Error('Live close failed.')));
        socket.on('close', () => finish(new Error('Live close was not confirmed.')));
      } catch { finish(new Error('Live close failed.')); }
    });
  }

  return { create, close };
}

module.exports = { createProvider };
