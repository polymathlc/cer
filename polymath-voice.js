/* =====================================================================
   🎙 THE POLYMATH, OUT LOUD — the voice and the crystal (v1.448.0)
   ---------------------------------------------------------------------
   The QR page's microphone. Three parts, in this order:

   ① `PolymathLiveBridge` — the live voice transport. It is Ainstein's and
     Study Buddy's bridge (the same Live JSON protocol over WebRTC, the same
     client delegation, the same "a newer question cancels the old one" and
     the same chunking of results), pointed at The Polymath's own endpoint
     and worded for a student. The voice model never teaches: every academic
     request arrives here as a delegation, the page's tutor engine answers it
     with the question and the key in front of it, and the answer is handed
     back to be spoken.

   ② `crystalSvg` — The Polymath's face: a cut gem in the centre's teal and
     magenta, drawn once as SVG (no network, nothing to load), and moved by
     a handful of CSS variables the controller writes every frame.

   ③ `createPolymathVoice` — owns the microphone, the call, the speaker and
     the crystal. ONE persistent card node, which the page moves into
     whichever screen it draws, so a call survives a re-render, a new
     question and the back button.

   WHAT REACTS TO WHAT. `--pm-level` is how loud the crystal is right now:
   the tutor's own voice while it speaks (an analyser on the incoming
   audio), the student's microphone while they talk, and a gentle breath
   otherwise. A browser that will not let an incoming WebRTC stream be
   analysed (some iPads) still sees the crystal pulse, from the words of
   the reply arriving (`spokeAt`). The PHASE — listening, thinking,
   speaking — is a class, so each state has its own colour and motion.

   EVERY WAY OUT STOPS THE MICROPHONE: End, the page hidden, pagehide, a
   new paper, two quiet minutes, the call's own length, a lost connection
   and a refused start. A microphone left on in a child's pocket is the one
   failure here nobody would ever see.
   ===================================================================== */
import {
  TUTOR_NAME, TUTOR_LIVE_ENDPOINT, TUTOR_LIVE_MAX_SECONDS, TUTOR_VOICE_IDLE_MS, voiceMaxSeconds, voiceClock
} from './polymath-tutor-core.mjs?v=2';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ID_RE = /^[A-Za-z0-9_-]{1,256}$/;

/* ---------- ① the transport ---------- */
export const PolymathLiveBridge = (function () {
  function aborted() { const error = new Error('The call ended.'); error.name = 'AbortError'; return error; }
  const MESSAGES = {
    401: 'Reload the page, then try talking again.',
    403: 'The page could not be verified. Reload it and try again.',
    404: 'The Polymath\'s voice is not switched on yet. You can still type to it.',
    409: 'A voice call is already open on this phone. End it first.',
    429: 'The Polymath is busy talking to lots of students. Type your question, or try again in a minute.',
    503: 'The Polymath\'s voice is unavailable just now. You can still type to it.'
  };
  function connect(opts) {
    opts = opts || {};
    const endpoint = opts.endpoint || TUTOR_LIVE_ENDPOINT;
    const fetchImpl = opts.fetch || fetch;
    let pc = null, channel = null, sessionId = null, headers = null;
    let active = true, started = false, startedEvent = false, remoteInstalled = false;
    let finalMessage = 'The call ended.';
    let startupTimer, expiryTimer, lostTimer, closeTimer, contextTimer, cancelIce;
    let lastContext = '';
    const control = new AbortController();
    let closingPromise = null;
    let fragments = [], chars = 0, sequence = 0;
    const seen = new Set();
    let working = false, pending = null, taskControl = null;
    let completedRequest = '', completedResult = '';
    let activeRequest = '', aliases = [], activeSpeechOffset = null;
    let resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    ready.catch(() => {});
    const session = { close, get closed() { return !active; }, get maxSeconds() { return session._max || TUTOR_LIVE_MAX_SECONDS; } };
    function notify(message, phase) {
      try { if (typeof opts.onStatus === 'function') opts.onStatus(message, phase || (started ? 'live' : 'connecting')); } catch (e) { /* the page's problem */ }
    }
    function current() { return active && !control.signal.aborted; }
    function guard() { if (!current()) throw aborted(); }
    // Live permits ~500 tokens per append; a conservative UTF-8 byte budget
    // bounds it without a tokenizer. Repeated appends continue one delegation.
    function send(event) {
      if (!channel || channel.readyState !== 'open') return false;
      try {
        if (/^session\.(thinking|commentary)\.append$/.test(event.type) && typeof event.content === 'string') {
          let rest = event.content.slice(0, 6000);
          while (rest) {
            let size = 0, end = 0;
            for (const point of rest) {
              const code = point.codePointAt(0);
              const bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
              if (size + bytes > 480) break;
              size += bytes; end += point.length;
            }
            if (end < rest.length) {
              const prefix = rest.slice(0, end);
              const boundary = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('. '), prefix.lastIndexOf(' '));
              if (boundary >= end / 2) end = boundary + 1;
            }
            channel.send(JSON.stringify(Object.assign({}, event, { content: rest.slice(0, end) })));
            rest = rest.slice(end);
          }
        } else channel.send(JSON.stringify(event));
        return true;
      } catch (e) { return false; }
    }
    // What is on the screen, told to the voice whenever it changes.
    function updateContext() {
      if (!current() || !started || typeof opts.getContext !== 'function') return;
      try {
        const content = opts.getContext();
        if (typeof content === 'string' && content && content !== lastContext &&
            send({ type: 'session.thinking.append', delegation_id: null, content })) lastContext = content;
      } catch (e) { /* retried on the next tick */ }
    }
    function watchContext() {
      updateContext();
      if (current() && typeof opts.getContext === 'function') contextTimer = setTimeout(watchContext, 1000);
    }
    async function request(body, authHeaders, keepalive) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        // Creation stays observable after a cancel so a late paid call can be
        // closed by its id; the server sweeps abandoned calls as well.
        const response = await fetchImpl(endpoint, { method: 'POST', headers: authHeaders, body: JSON.stringify(body), signal: controller.signal, keepalive: !!keepalive });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          // The server's own reason is the answer; the status map is the fallback.
          const said = data && data.error && typeof data.error.message === 'string' ? data.error.message.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
          throw new Error(said || MESSAGES[response.status] || 'The Polymath\'s voice could not connect. Please try again.');
        }
        return data;
      } finally { clearTimeout(timer); }
    }
    function closeRemote(id, authHeaders) {
      if (!id || !authHeaders) return Promise.resolve(false);
      return request({ action: 'stop', sessionId: id }, authHeaders, true).then(data => data.stopped === true).catch(() => false);
    }
    function close() {
      if (closingPromise) return closingPromise;
      let resolveClosed;
      closingPromise = new Promise(resolve => { resolveClosed = resolve; });
      active = false;
      control.abort();
      if (taskControl) taskControl.abort();
      if (opts.signal) opts.signal.removeEventListener('abort', externalAbort);
      clearTimeout(startupTimer); clearTimeout(expiryTimer); clearTimeout(lostTimer); clearTimeout(contextTimer);
      if (cancelIce) cancelIce();
      rejectReady(aborted());
      pending = null;
      if (pc) pc.getSenders().forEach(sender => {
        try { const detached = sender.replaceTrack(null); if (detached && detached.catch) detached.catch(() => {}); } catch (e) { /* closing anyway */ }
      });
      let released = false;
      function release() {
        if (released) return;
        released = true; clearTimeout(closeTimer);
        if (channel) { channel.onmessage = channel.onclose = null; try { channel.close(); } catch (e) { /* gone */ } }
        if (pc) { pc.ontrack = pc.onconnectionstatechange = null; try { pc.close(); } catch (e) { /* gone */ } }
        pc = channel = null; fragments = []; seen.clear();
        notify(finalMessage, 'closed'); resolveClosed();
      }
      if (channel && channel.readyState === 'open') {
        channel.onmessage = message => { try { if (JSON.parse(message.data).type === 'session.closed') release(); } catch (e) { /* not ours */ } };
        channel.onclose = release;
        closeTimer = setTimeout(release, 3000);
        if (!send({ type: 'session.close' })) release();
      } else release();
      closeRemote(sessionId, headers).then(confirmed => { if (confirmed) release(); });
      return closingPromise;
    }
    function fail(error) {
      if (!active) return;
      rejectReady(error);
      finalMessage = (error && error.message) || 'The Polymath\'s voice could not connect.';
      notify(finalMessage, 'error');
      close();
    }
    function externalAbort() { close(); }
    function conversation() {
      const rows = [];
      fragments.forEach(part => {
        const last = rows[rows.length - 1];
        if (last && last.role === part.role) last.text += part.text;
        else rows.push({ role: part.role, text: part.text });
      });
      return rows.slice(-24);
    }
    function transcript(event) {
      if (typeof event.delta !== 'string' || !event.delta) return;
      const delta = event.delta.slice(0, 4000);
      const role = event.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
      const start = Number.isFinite(event.start_ms) ? event.start_ms : 0;
      const end = Number.isFinite(event.end_ms) ? event.end_ms : start;
      // Newer speech from the student invalidates the work in progress.
      if (role === 'user' && taskControl && !taskControl.signal.aborted &&
          activeSpeechOffset !== null && Number.isFinite(event.start_ms) && start > activeSpeechOffset) taskControl.abort();
      fragments.push({ role, text: delta, start, end, order: sequence++ }); chars += delta.length;
      fragments.sort((a, b) => a.start - b.start || a.order - b.order);
      while (fragments.length > 1000 || chars > 24000) chars -= fragments.shift().text.length;
      const rows = conversation(), row = rows[rows.length - 1];
      try { if (typeof opts.onTranscript === 'function') opts.onTranscript({ role, text: row && row.role === role ? row.text : delta, delta }); } catch (e) { /* the page's problem */ }
    }
    async function runDelegation(id, queued, speechOffset) {
      if (!current() || !started || (!queued && seen.has(id))) return;
      if (!queued) { seen.add(id); if (seen.size > 1000) seen.delete(seen.values().next().value); }
      const requestKey = JSON.stringify(fragments.filter(p => p.role === 'user').map(p => [p.start, p.end, p.text]).slice(-64));
      if (working) {
        if (requestKey !== '[]' && requestKey === activeRequest && !taskControl.signal.aborted) { if (aliases.length < 20) aliases.push(id); return; }
        if (taskControl) taskControl.abort();
        if (pending) send({ type: 'session.thinking.append', delegation_id: pending.id, content: 'The student asked something newer. Wait for its result.' });
        pending = { id, speechOffset }; return;
      }
      if (requestKey !== '[]' && requestKey === completedRequest) {
        send({ type: 'session.commentary.append', delegation_id: id, content: completedResult });
        return;
      }
      working = true;
      activeRequest = requestKey; aliases = [];
      activeSpeechOffset = Number.isFinite(speechOffset) && speechOffset >= 0 ? speechOffset : null;
      taskControl = new AbortController();
      const task = taskControl;
      updateContext();
      notify('Thinking…', 'thinking');
      try {
        const out = typeof opts.delegate === 'function' ? await opts.delegate({ id, transcript: conversation(), signal: task.signal }) : '';
        if (!current()) return;
        if (pending || task.signal.aborted) {
          send({ type: 'session.thinking.append', delegation_id: id, content: 'The student changed the question. Wait for the latest result.' });
          return;
        }
        completedRequest = requestKey;
        completedResult = String(out || '').trim().slice(0, 6000) || 'I could not check that just now. Please ask me again.';
        aliases.forEach(alias => send({ type: 'session.thinking.append', delegation_id: alias,
          content: 'This is the same request. Use the result sent for delegation ' + id + '; do not repeat it.' }));
        if (!send({ type: 'session.commentary.append', delegation_id: id, content: completedResult })) {
          fail(new Error('The voice connection was lost. You can keep going by typing.'));
        }
      } catch (e) {
        if (current()) send({ type: pending || task.signal.aborted ? 'session.thinking.append' : 'session.commentary.append',
          delegation_id: id, content: 'I could not check that just now. Please ask me again.' });
      } finally {
        if (taskControl === task) taskControl = null;
        activeRequest = ''; aliases = []; activeSpeechOffset = null;
        working = false;
        if (current()) {
          const next = pending; pending = null;
          if (next) runDelegation(next.id, true, next.speechOffset);
          else notify('Listening…', 'live');
        }
      }
    }
    function maybeReady() {
      if (!current() || started || !startedEvent || !remoteInstalled || !sessionId) return;
      started = true; clearTimeout(startupTimer);
      watchContext();
      notify('Listening…', 'live');
      resolveReady(session);
    }
    function eventReceived(message) {
      if (!current()) return;
      let event;
      try { if (typeof message.data !== 'string' || message.data.length > 65536) return; event = JSON.parse(message.data); } catch (e) { return; }
      if (!event || typeof event !== 'object') return;
      if (event.type === 'session.started') { startedEvent = true; maybeReady(); }
      else if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') transcript(event);
      else if (event.type === 'session.delegation.created') {
        const item = event.delegation;
        if (item && item.target === 'client' && typeof item.id === 'string' && ID_RE.test(item.id)) runDelegation(item.id, false, event.offset_ms);
      } else if (event.type === 'session.closed') close();
      else if (event.type === 'error') {
        if (!started) fail(new Error('The Polymath\'s voice could not start. Please try again later.'));
        else notify('I missed that. Please say it again.', 'live');
      }
    }
    function waitIce() {
      if (pc.iceGatheringState === 'complete') return Promise.resolve();
      return new Promise((resolve, reject) => {
        const peer = pc;
        let settled = false;
        const timer = setTimeout(() => finish(new Error('The voice connection timed out. Please try again.')), 10000);
        function finish(error) {
          if (settled) return; settled = true;
          clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); cancelIce = null;
          if (error) reject(error); else resolve();
        }
        function changed() { if (peer.iceGatheringState === 'complete') finish(); }
        cancelIce = () => finish(aborted());
        peer.addEventListener('icegatheringstatechange', changed);
      });
    }
    async function setup() {
      guard();
      if (!opts.stream || !opts.stream.getAudioTracks().some(track => track.readyState !== 'ended')) throw new Error('Allow the microphone to talk to ' + TUTOR_NAME + '.');
      if (!opts.user || typeof opts.user.getIdToken !== 'function' || !opts.appCheckToken) throw new Error('The page is still getting ready. Try again in a moment.');
      const Peer = opts.RTCPeerConnection || (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null);
      if (!Peer) throw new Error('This browser cannot do voice calls. You can still type to ' + TUTOR_NAME + '.');
      notify('Connecting…', 'connecting');
      const tokens = await Promise.all([opts.user.getIdToken(), typeof opts.appCheckToken === 'function' ? opts.appCheckToken() : opts.appCheckToken]);
      guard();
      if (typeof tokens[0] !== 'string' || !tokens[0] || typeof tokens[1] !== 'string' || !tokens[1]) throw new Error('The page is still getting ready. Try again in a moment.');
      headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[0], 'X-Firebase-AppCheck': tokens[1] };
      pc = new Peer();
      pc.ontrack = event => {
        if (!current()) return;
        try { if (typeof opts.onRemoteStream === 'function') opts.onRemoteStream((event.streams && event.streams[0]) || new MediaStream([event.track])); } catch (e) { /* the page's problem */ }
      };
      opts.stream.getAudioTracks().forEach(track => pc.addTrack(track, opts.stream));
      channel = pc.createDataChannel('oai-events');
      channel.onmessage = eventReceived;
      channel.onclose = () => { if (current()) fail(new Error('The voice call ended. You can keep going by typing.')); };
      pc.onconnectionstatechange = () => {
        if (!current()) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fail(new Error('The voice connection was lost. You can keep going by typing.'));
        else if (pc.connectionState === 'disconnected' && !lostTimer) {
          notify('The connection wobbled. Reconnecting…', 'connecting');
          lostTimer = setTimeout(() => fail(new Error('The voice connection was lost. You can keep going by typing.')), 8000);
        } else if (pc.connectionState === 'connected') { clearTimeout(lostTimer); lostTimer = null; }
      };
      const offer = await pc.createOffer(); guard();
      await pc.setLocalDescription(offer); guard();
      await waitIce(); guard();
      const answer = await request({ action: 'start', sdp: pc.localDescription.sdp }, headers);
      const validId = typeof answer.sessionId === 'string' && ID_RE.test(answer.sessionId);
      if (!current()) { if (validId) closeRemote(answer.sessionId, headers); return; }
      if (validId) sessionId = answer.sessionId;
      if (!validId || typeof answer.sdp !== 'string' || answer.sdp.length > 64000 || !/^v=0\r?\n/.test(answer.sdp)) throw new Error('The voice call came back incomplete. Please try again.');
      const max = voiceMaxSeconds(answer);
      session._max = max;
      const remaining = Number.isFinite(answer.expiresAt) ? Math.max(0, Math.min(max * 1000, answer.expiresAt - Date.now())) : max * 1000;
      expiryTimer = setTimeout(() => {
        finalMessage = 'That call has reached its ' + Math.round(max / 60) + ' minutes. Tap the crystal to start another.';
        notify(finalMessage, 'ended'); close();
      }, remaining);
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp }); guard();
      remoteInstalled = true; maybeReady();
    }
    if (opts.signal) opts.signal.addEventListener('abort', externalAbort, { once: true });
    startupTimer = setTimeout(() => fail(new Error('The voice call took too long to start. Please try again.')), 60000);
    if (opts.signal && opts.signal.aborted) close();
    else setup().catch(fail);
    return ready;
  }
  return { connect };
})();

/* ---------- ② the crystal ---------- */
let crystalSeq = 0;
// The gem, facet by facet. Its geometry is fixed; everything that moves is a
// CSS variable on the wrapper, so the drawing is made once per page.
export function crystalSvg(doc) {
  const d = doc || document;
  const make = (tag, attrs, children) => {
    const node = d.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(k => node.setAttribute(k, String(attrs[k])));
    (children || []).forEach(c => node.appendChild(c));
    return node;
  };
  const uid = 'pmx' + (++crystalSeq);
  const stop = (offset, color, opacity) => make('stop', { offset, 'stop-color': color, 'stop-opacity': opacity == null ? 1 : opacity });
  const defs = make('defs', {}, [
    make('linearGradient', { id: uid + 'a', x1: '0', y1: '0', x2: '1', y2: '1' }, [stop('0', '#E9FFFB'), stop('0.45', '#5FD4C9'), stop('1', '#0E7C86')]),
    make('linearGradient', { id: uid + 'b', x1: '1', y1: '0', x2: '0', y2: '1' }, [stop('0', '#FFE6F4'), stop('0.5', '#E25FAE'), stop('1', '#7A1E63')]),
    make('linearGradient', { id: uid + 'c', x1: '0', y1: '0', x2: '0', y2: '1' }, [stop('0', '#FFFFFF'), stop('0.6', '#B9EDF4'), stop('1', '#4BA9D6')]),
    make('linearGradient', { id: uid + 'd', x1: '0', y1: '1', x2: '1', y2: '0' }, [stop('0', '#3A2C8C'), stop('0.55', '#7C6CE0'), stop('1', '#D6CCFF')]),
    make('radialGradient', { id: uid + 'glow', cx: '0.5', cy: '0.5', r: '0.5' }, [stop('0', '#FFFFFF', 0.95), stop('0.35', '#9BE8F0', 0.55), stop('0.7', '#C46BD8', 0.18), stop('1', '#C46BD8', 0)]),
    make('radialGradient', { id: uid + 'core', cx: '0.5', cy: '0.45', r: '0.5' }, [stop('0', '#FFFFFF', 1), stop('0.5', '#FFFFFF', 0.25), stop('1', '#FFFFFF', 0)]),
    make('filter', { id: uid + 'blur', x: '-50%', y: '-50%', width: '200%', height: '200%' }, [make('feGaussianBlur', { stdDeviation: '6' })])
  ]);
  // Crown (top), girdle and pavilion (the long point below), as facets.
  const F = (points, fill, cls) => make('polygon', { points, fill: 'url(#' + uid + fill + ')', class: 'pm-facet ' + (cls || '') });
  const facets = make('g', { class: 'pm-gem' }, [
    F('60,62 100,40 100,74 74,80', 'c', 'pm-f1'),
    F('100,40 140,62 126,80 100,74', 'a', 'pm-f2'),
    F('40,82 60,62 74,80 58,96', 'd', 'pm-f3'),
    F('140,62 160,82 142,96 126,80', 'b', 'pm-f4'),
    F('74,80 100,74 126,80 100,98', 'c', 'pm-f5'),
    F('58,96 74,80 100,98 82,108', 'a', 'pm-f6'),
    F('126,80 142,96 118,108 100,98', 'd', 'pm-f7'),
    F('40,82 58,96 82,108 100,206', 'd', 'pm-f8'),
    F('82,108 100,98 118,108 100,206', 'c', 'pm-f9'),
    F('118,108 142,96 160,82 100,206', 'b', 'pm-f10'),
    F('58,96 82,108 100,206', 'a', 'pm-f11'),
    F('142,96 118,108 100,206', 'a', 'pm-f12')
  ]);
  const edges = make('g', { class: 'pm-edges', fill: 'none', stroke: '#FFFFFF', 'stroke-opacity': '0.55', 'stroke-width': '0.9', 'stroke-linejoin': 'round' }, [
    make('polyline', { points: '40,82 60,62 100,40 140,62 160,82 100,206 40,82' }),
    make('polyline', { points: '40,82 58,96 82,108 100,98 118,108 142,96 160,82' }),
    make('polyline', { points: '60,62 74,80 100,74 126,80 140,62' }),
    make('polyline', { points: '74,80 58,96' }), make('polyline', { points: '126,80 142,96' }),
    make('polyline', { points: '100,74 100,98' }), make('polyline', { points: '82,108 100,206 118,108' })
  ]);
  const sparkle = (x, y, s, cls) => make('path', { d: `M${x} ${y - s} L${x + s * 0.28} ${y - s * 0.28} L${x + s} ${y} L${x + s * 0.28} ${y + s * 0.28} L${x} ${y + s} L${x - s * 0.28} ${y + s * 0.28} L${x - s} ${y} L${x - s * 0.28} ${y - s * 0.28} Z`, fill: '#FFFFFF', class: 'pm-spark ' + cls });
  const root = make('svg', { viewBox: '0 0 200 240', class: 'pm-crystal-svg', 'aria-hidden': 'true', focusable: 'false' }, [
    defs,
    make('ellipse', { cx: '100', cy: '226', rx: '46', ry: '7', class: 'pm-shadow', fill: '#0D3C61', 'fill-opacity': '0.16' }),
    make('circle', { cx: '100', cy: '112', r: '92', class: 'pm-halo', fill: 'url(#' + uid + 'glow)', filter: 'url(#' + uid + 'blur)' }),
    make('g', { class: 'pm-rays' }, [0, 45, 90, 135].map(a => make('rect', { x: '98.5', y: '8', width: '3', height: '208', rx: '1.5', fill: '#FFFFFF', 'fill-opacity': '0.22', transform: 'rotate(' + a + ' 100 112)' }))),
    make('g', { class: 'pm-float' }, [
      make('g', { class: 'pm-ring' }, [make('ellipse', { cx: '100', cy: '112', rx: '86', ry: '20', fill: 'none', stroke: '#9BE8F0', 'stroke-width': '1.4', 'stroke-dasharray': '3 9', 'stroke-opacity': '0.8' })]),
      facets, edges,
      make('ellipse', { cx: '100', cy: '96', rx: '28', ry: '20', class: 'pm-core', fill: 'url(#' + uid + 'core)' }),
      make('polygon', { points: '66,66 98,48 98,60 76,72', class: 'pm-gloss', fill: '#FFFFFF', 'fill-opacity': '0.55' }),
      sparkle(146, 54, 9, 'pm-s1'), sparkle(52, 120, 6, 'pm-s2'), sparkle(150, 150, 5, 'pm-s3'), sparkle(100, 30, 5, 'pm-s4')
    ])
  ]);
  return root;
}

/* ---------- ③ the controller ---------- */
const PHASE_TEXT = {
  idle: 'Tap the crystal and talk to ' + TUTOR_NAME,
  connecting: 'Waking up…',
  listening: 'Listening — ask me anything about this question',
  thinking: 'Thinking…',
  speaking: TUTOR_NAME + ' is talking',
  error: ''
};

export function createPolymathVoice(options) {
  const o = options || {};
  const doc = o.document || document;
  const win = o.window || window;
  const bridge = o.bridge || PolymathLiveBridge;
  const media = o.mediaDevices || (win.navigator && win.navigator.mediaDevices);
  const el = (tag, attrs, children) => {
    const node = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    });
    (children || []).forEach(c => { if (c) node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return node;
  };

  const crystal = el('button', { type: 'button', class: 'pm-crystal', 'aria-label': 'Talk to ' + TUTOR_NAME, title: 'Talk to ' + TUTOR_NAME }, [crystalSvg(doc)]);
  const statusText = el('span', { class: 'pm-status-text', text: PHASE_TEXT.idle });
  const clock = el('span', { class: 'pm-clock', hidden: true });
  const status = el('p', { class: 'pm-status', role: 'status', 'aria-live': 'polite' }, [statusText, clock]);
  const startBtn = el('button', { type: 'button', class: 'pt-btn pt-primary pm-start' }, ['🎙 Talk to ' + TUTOR_NAME]);
  const stopBtn = el('button', { type: 'button', class: 'pt-btn pm-stop', hidden: true }, ['End the call']);
  const muteBtn = el('button', { type: 'button', class: 'pt-btn pm-mute', hidden: true, 'aria-pressed': 'false' }, ['🔇 Mute me']);
  const playBtn = el('button', { type: 'button', class: 'pt-btn pm-play', hidden: true }, ['🔊 Tap to hear ' + TUTOR_NAME]);
  const log = el('div', { class: 'pm-log', 'aria-label': 'What you and ' + TUTOR_NAME + ' said', hidden: true });
  const note = el('p', { class: 'pt-muted pm-note', text: 'Uses your microphone while the call is on. Nothing you say is recorded or saved. Leaving the page ends the call.' });
  const node = el('section', { class: 'pt-card pm-voice', 'data-phase': 'idle', 'aria-label': 'Talk to ' + TUTOR_NAME }, [
    el('div', { class: 'pm-stage' }, [crystal]),
    el('div', { class: 'pm-panel' }, [
      el('h2', { text: '🎙 Talk it through' }), status,
      el('div', { class: 'pm-actions' }, [startBtn, stopBtn, muteBtn, playBtn]), log, note
    ])
  ]);
  const audio = o.audio || doc.createElement('audio');
  audio.autoplay = true;
  try { audio.setAttribute('playsinline', ''); } catch (e) { /* a test stand-in */ }

  let phase = 'idle', generation = 0, controller = null, session = null, stream = null;
  let audioCtx = null, micAnalyser = null, outAnalyser = null, buf = null;
  let level = 0, spokeAt = 0, lastActivity = 0, startedAt = 0, maxSeconds = TUTOR_LIVE_MAX_SECONDS;
  let frame = null, ticker = null, muted = false, lastRole = '', destroyed = false;
  const listeners = [];

  function setPhase(next, message) {
    phase = next;
    node.dataset.phase = next;
    statusText.textContent = message != null && message !== '' ? message : (PHASE_TEXT[next] || '');
    const running = !!controller;
    startBtn.hidden = running; stopBtn.hidden = !running; muteBtn.hidden = !running || next === 'connecting';
    clock.hidden = !running || !startedAt;
    if (running && startedAt) clock.textContent = ' · ' + voiceClock(Math.max(0, maxSeconds - Math.floor((Date.now() - startedAt) / 1000))) + ' left';
    crystal.setAttribute('aria-label', running ? 'End the call with ' + TUTOR_NAME : 'Talk to ' + TUTOR_NAME);
    crystal.setAttribute('aria-pressed', running ? 'true' : 'false');
    if (typeof o.onPhase === 'function') { try { o.onPhase(next); } catch (e) { /* the page's problem */ } }
    loop();
  }

  /* The level the crystal shows: the loudest of what is happening, eased. */
  function rms(analyser) {
    if (!analyser) return 0;
    if (!buf || buf.length !== analyser.fftSize) buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
  }
  function tick(t) {
    frame = null;
    if (destroyed) return;
    const now = Date.now();
    const out = rms(outAnalyser);
    const mic = muted ? 0 : rms(micAnalyser);
    // Words arriving are proof of speech even where the stream cannot be analysed.
    const words = now - spokeAt < 700 ? 0.35 + 0.25 * Math.abs(Math.sin(t / 90)) : 0;
    const talking = Math.max(out, words);
    if (controller && phase !== 'connecting' && phase !== 'thinking') {
      if (talking > 0.12 && phase !== 'speaking') setPhase('speaking');
      else if (talking <= 0.06 && phase === 'speaking' && now - spokeAt > 900) setPhase('listening');
    }
    const breath = 0.08 + 0.05 * Math.sin(t / 900);
    const target = phase === 'speaking' ? Math.max(talking, 0.25) : phase === 'listening' ? Math.max(mic, breath) : phase === 'thinking' ? 0.3 + 0.15 * Math.sin(t / 160) : breath;
    level += (target - level) * (target > level ? 0.35 : 0.12);
    node.style.setProperty('--pm-level', level.toFixed(3));
    node.style.setProperty('--pm-mic', mic.toFixed(3));
    if (controller && startedAt) {
      const left = Math.max(0, maxSeconds - Math.floor((now - startedAt) / 1000));
      clock.textContent = ' · ' + voiceClock(left) + ' left';
    }
    loop();
  }
  function reduced() { try { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function loop() {
    if (frame != null || destroyed || !node.isConnected) return;
    if (reduced() && !controller) { node.style.setProperty('--pm-level', '0.1'); return; }
    frame = (win.requestAnimationFrame || (fn => setTimeout(() => fn(Date.now()), 33)))(tick);
  }

  function context() {
    if (audioCtx) return audioCtx;
    const Ctx = win.AudioContext || win.webkitAudioContext;
    if (!Ctx) return null;
    try { audioCtx = new Ctx(); } catch (e) { audioCtx = null; }
    return audioCtx;
  }
  // An analyser that only LISTENS: never connected to the speakers, so it
  // cannot double the voice or feed the microphone back into the call.
  function analyse(s) {
    const ctx = context();
    if (!ctx || !s) return null;
    try {
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(a);
      return a;
    } catch (e) { return null; }
  }
  function stopTracks(s) { if (s) s.getTracks().forEach(track => { try { track.stop(); } catch (e) { /* gone */ } }); }
  function addTranscript(row) {
    lastActivity = Date.now();
    if (row.role !== 'user') spokeAt = Date.now();
    log.hidden = false;
    let line = log.lastElementChild;
    if (!line || lastRole !== row.role) {
      line = el('div', { class: 'pm-line pm-' + (row.role === 'user' ? 'you' : 'tutor') }, [el('b', { text: row.role === 'user' ? 'You' : TUTOR_NAME }), el('span')]);
      log.appendChild(line); lastRole = row.role;
      while (log.childElementCount > 14) log.firstElementChild.remove();
    }
    line.lastElementChild.textContent = String(row.text || '').slice(-1200);
    log.scrollTop = log.scrollHeight;
  }

  function stop(message) {
    generation++;
    const closing = session; session = null;
    const old = controller; controller = null;
    if (old) old.abort();
    listeners.splice(0).forEach(([track, fn]) => { try { track.removeEventListener('ended', fn); } catch (e) { /* gone */ } });
    stopTracks(stream); stream = null;
    micAnalyser = outAnalyser = null;
    if (audioCtx) { try { audioCtx.close(); } catch (e) { /* gone */ } audioCtx = null; }
    if (ticker) win.clearInterval(ticker); ticker = null;
    try { audio.pause(); audio.srcObject = null; } catch (e) { /* a test stand-in */ }
    playBtn.hidden = true; muted = false; muteBtn.setAttribute('aria-pressed', 'false'); muteBtn.textContent = '🔇 Mute me';
    startedAt = 0;
    if (closing) Promise.resolve(closing.close()).catch(() => {});
    setPhase(message ? 'error' : 'idle', message || '');
  }

  async function start() {
    if (controller || destroyed) return;
    if (typeof o.allowed === 'function' && !o.allowed()) return;
    if (!media || !media.getUserMedia || !(o.RTCPeerConnection || win.RTCPeerConnection)) {
      setPhase('error', 'This browser cannot do voice calls. You can still type to ' + TUTOR_NAME + '.');
      return;
    }
    const mine = ++generation, abort = new AbortController();
    controller = abort;
    log.replaceChildren(); log.hidden = true; lastRole = '';
    const current = () => mine === generation && !abort.signal.aborted && !destroyed;
    setPhase('connecting');
    lastActivity = Date.now();
    // Made inside the tap, which is what lets Safari play the reply at all.
    context();
    try { const p = audio.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* nothing to play yet */ }
    ticker = win.setInterval(() => {
      if (!current()) return;
      if (phase !== 'thinking' && phase !== 'speaking' && Date.now() - lastActivity > TUTOR_VOICE_IDLE_MS) stop('I switched the microphone off after two quiet minutes. Tap the crystal to talk again.');
    }, 1000);
    try {
      const user = o.getUser ? await o.getUser() : null;
      if (!current()) return;
      const acquired = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!current()) { stopTracks(acquired); return; }
      stream = acquired;
      micAnalyser = analyse(acquired);
      acquired.getAudioTracks().forEach(track => {
        const ended = () => { if (current()) stop('The microphone was disconnected, so the call ended.'); };
        track.addEventListener('ended', ended, { once: true });
        listeners.push([track, ended]);
      });
      const connected = await bridge.connect({
        stream, user, signal: abort.signal, endpoint: o.endpoint, RTCPeerConnection: o.RTCPeerConnection, fetch: o.fetch,
        appCheckToken: o.getAppCheckToken,
        getContext: () => current() && typeof o.getContext === 'function' ? o.getContext() || '' : '',
        delegate: async task => {
          if (!current()) throw new DOMException('Call ended', 'AbortError');
          lastActivity = Date.now();
          const result = await o.delegate(task);
          if (!current() || task.signal.aborted) throw new DOMException('Call ended', 'AbortError');
          lastActivity = Date.now();
          return result;
        },
        onTranscript: row => { if (current()) addTranscript(row); },
        onStatus: (message, state) => {
          if (!current()) return;
          if (state === 'closed' || state === 'ended' || state === 'error') { stop(state === 'closed' ? '' : message); return; }
          if (state === 'thinking') setPhase('thinking');
          else if (state === 'live') setPhase(phase === 'speaking' ? 'speaking' : 'listening', /Listening/.test(message) ? '' : message);
          else setPhase('connecting', message);
        },
        onRemoteStream: remote => {
          if (!current()) return;
          audio.srcObject = remote;
          outAnalyser = analyse(remote);
          Promise.resolve(audio.play()).catch(() => { if (current()) { playBtn.hidden = false; statusText.textContent = 'Tap “Hear ' + TUTOR_NAME + '” to switch the sound on.'; } });
        }
      });
      if (!current()) { await connected.close(); return; }
      session = connected;
      maxSeconds = connected.maxSeconds || TUTOR_LIVE_MAX_SECONDS;
      startedAt = Date.now();
      setPhase('listening');
    } catch (error) {
      if (!current()) return;
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      stop(denied ? 'The microphone is blocked. Allow it for this page in your browser settings, then tap the crystal again.'
        : (error && error.message) || 'Could not start the call. Please try again.');
    }
  }

  function toggleMute() {
    if (!stream) return;
    muted = !muted;
    stream.getAudioTracks().forEach(track => { track.enabled = !muted; });
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.textContent = muted ? '🎙 Unmute me' : '🔇 Mute me';
    if (muted) statusText.textContent = 'You are muted. ' + TUTOR_NAME + ' cannot hear you.';
  }

  crystal.addEventListener('click', () => { if (controller) stop(); else start(); });
  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', () => stop());
  muteBtn.addEventListener('click', toggleMute);
  playBtn.addEventListener('click', () => {
    Promise.resolve(audio.play()).then(() => { playBtn.hidden = true; setPhase(phase); }).catch(() => { statusText.textContent = 'The sound is blocked by this browser.'; });
  });
  const hide = () => { if (doc.hidden && controller) stop('The call ended when you left the page. Tap the crystal to talk again.'); };
  const leave = () => { if (controller) stop(); };
  doc.addEventListener('visibilitychange', hide);
  win.addEventListener('pagehide', leave);

  return {
    node,
    start, stop,
    get phase() { return phase; },
    get active() { return !!controller; },
    // The page moved the card into a new screen: keep the crystal moving.
    attached() { loop(); },
    destroy() {
      stop(); destroyed = true;
      doc.removeEventListener('visibilitychange', hide);
      win.removeEventListener('pagehide', leave);
      if (frame != null && win.cancelAnimationFrame) win.cancelAnimationFrame(frame);
      node.remove();
    }
  };
}
