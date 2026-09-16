// Bound helpers whose existing providers cannot cancel an in-flight request.
// Their late results are consumed but can never hold or resume a cancelled turn.
export async function awaitAinsteinVoice(operation, signal, milliseconds = 45000) {
  const cancelled = () => new DOMException('Conversation ended.', 'AbortError');
  if (signal?.aborted) throw cancelled();
  let timer, rejectAbort;
  const interrupted = new Promise((_, reject) => {
    rejectAbort = () => reject(cancelled());
    signal?.addEventListener('abort', rejectAbort, { once: true });
    timer = setTimeout(() => reject(new DOMException('The answer took too long. Please try again.', 'TimeoutError')), milliseconds);
  });
  try {
    const result = await Promise.race([Promise.resolve().then(() => {
      if (signal?.aborted) throw cancelled();
      return operation();
    }), interrupted]);
    if (signal?.aborted) throw cancelled();
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', rejectAbort);
  }
}

// Live client delegation transport, shared protocol with the Tutor/Ans Key apps.
var AinsteinLiveBridge = (function () {
  'use strict';
  var ENDPOINT = 'https://us-central1-mathgen--app.cloudfunctions.net/cerAinsteinLive';
  var MAX_MS = 10 * 60 * 1000;
  function aborted() { var error = new Error('Live assistance ended.'); error.name = 'AbortError'; return error; }
  function connect(opts) {
    opts = opts || {};
    var pc = null, channel = null, sessionId = null, headers = null;
    var active = true, started = false, startedEvent = false, remoteInstalled = false;
    var finalMessage = 'Live assistance ended.';
    var startupTimer, expiryTimer, lostTimer, closeTimer, contextTimer, cancelIce;
    var lastContext = '';
    var control = new AbortController(), closingPromise = null;
    var fragments = [], chars = 0, sequence = 0, seen = new Set(), working = false, pending = null, taskControl = null;
    var completedRequest = '', completedResult = '';
    var activeRequest = '', aliases = [], activeSpeechOffset = null;
    var resolveReady, rejectReady;
    var ready = new Promise(function (resolve, reject) { resolveReady = resolve; rejectReady = reject; });
    var session = { close: close, get closed() { return !active; } };
    function notify(message, phase) {
      try { if (typeof opts.onStatus === 'function') opts.onStatus(message, phase || (started ? 'live' : 'connecting')); } catch (error) {}
    }
    function current() { return active && !control.signal.aborted; }
    function guard() { if (!current()) throw aborted(); }
    function send(event) {
      if (!channel || channel.readyState !== 'open') return false;
      try {
        // Live permits 500 tokens per append. A conservative UTF-8 byte budget
        // also bounds byte-level tokens for non-English text without a tokenizer.
        // Repeated result appends continue the same delegation (Live guide).
        if (/^session\.(thinking|commentary)\.append$/.test(event.type) && typeof event.content === 'string') {
          var rest = event.content.slice(0, 6000);
          while (rest) {
            var size = 0, end = 0;
            for (var point of rest) {
              var code = point.codePointAt(0);
              var bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
              if (size + bytes > 480) break;
              size += bytes; end += point.length;
            }
            if (end < rest.length) {
              var prefix = rest.slice(0, end);
              var boundary = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('. '), prefix.lastIndexOf(' '));
              if (boundary >= end / 2) end = boundary + 1;
            }
            channel.send(JSON.stringify(Object.assign({}, event, { content: rest.slice(0, end) })));
            rest = rest.slice(end);
          }
        } else channel.send(JSON.stringify(event));
        return true;
      } catch (error) { return false; }
    }
    function updateContext() {
      if (!current() || !started || typeof opts.getContext !== 'function') return;
      try {
        var content = opts.getContext();
        if (typeof content === 'string' && content && content !== lastContext &&
            send({ type: 'session.thinking.append', delegation_id: null, content: content })) lastContext = content;
      } catch (error) { /* A page changing is retried on the next update. */ }
    }
    function watchContext() {
      updateContext();
      if (current() && typeof opts.getContext === 'function') contextTimer = setTimeout(watchContext, 1000);
    }
    async function request(body, authHeaders, keepalive) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 30000);
      try {
        // Keep creation observable after cancellation so a late paid session
        // can still be closed by its ID. The server also cleans disconnected calls.
        var response = await fetch(ENDPOINT, { method: 'POST', headers: authHeaders,
          body: JSON.stringify(body), signal: controller.signal, keepalive: !!keepalive });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) {
          var messages = {
            401: 'Please sign in again to use live assistance.',
            403: 'Voice assistance is available to administrators only.',
            404: 'Live assistance needs its Firebase setup. Please try again later.',
            409: 'A live session is already open. End it before starting another.',
            429: 'The live session allowance has been reached. Please try again later.',
            503: 'Live assistance is unavailable. Please try again later.'
          };
          throw new Error(messages[response.status] || 'Live assistance could not connect. Please try again.');
        }
        return data;
      } finally { clearTimeout(timer); }
    }
    function closeRemote(id, authHeaders) {
      if (!id || !authHeaders) return Promise.resolve(false);
      return request({ action: 'stop', sessionId: id }, authHeaders, true)
        .then(function (data) { return data.stopped === true; }).catch(function () { return false; });
    }
    function close() {
      if (closingPromise) return closingPromise;
      var resolveClosed;
      closingPromise = new Promise(function (resolve) { resolveClosed = resolve; });
      active = false;
      control.abort();
      if (taskControl) taskControl.abort();
      if (opts.signal) opts.signal.removeEventListener('abort', externalAbort);
      clearTimeout(startupTimer); clearTimeout(expiryTimer); clearTimeout(lostTimer); clearTimeout(contextTimer);
      if (cancelIce) cancelIce();
      rejectReady(aborted());
      pending = null;
      // Detach audio immediately. The controller stops its owned microphone tracks.
      if (pc) pc.getSenders().forEach(function (sender) {
        try { var detached = sender.replaceTrack(null); if (detached && detached.catch) detached.catch(function () {}); } catch (error) {}
      });
      var released = false;
      function release() {
        if (released) return;
        released = true; clearTimeout(closeTimer);
        if (channel) { channel.onmessage = channel.onclose = null; try { channel.close(); } catch (error) {} }
        if (pc) { pc.ontrack = pc.onconnectionstatechange = null; try { pc.close(); } catch (error) {} }
        pc = channel = null; fragments = []; seen.clear();
        notify(finalMessage, 'closed'); resolveClosed();
      }
      if (channel && channel.readyState === 'open') {
        channel.onmessage = function (message) {
          try { if (JSON.parse(message.data).type === 'session.closed') release(); } catch (error) {}
        };
        channel.onclose = release;
        closeTimer = setTimeout(release, 3000);
        if (!send({ type: 'session.close' })) release();
      } else release();
      closeRemote(sessionId, headers).then(function (confirmed) { if (confirmed) release(); });
      return closingPromise;
    }
    function fail(error) {
      if (!active) return;
      rejectReady(error);
      finalMessage = error && error.message || 'Live assistance could not connect.';
      notify(finalMessage, 'error');
      close();
    }
    function externalAbort() { close(); }
    function conversation() {
      var rows = [];
      fragments.forEach(function (part) {
        var last = rows[rows.length - 1];
        if (last && last.role === part.role) last.text += part.text;
        else rows.push({ role: part.role, text: part.text });
      });
      return rows.slice(-24);
    }
    function transcript(event) {
      if (typeof event.delta !== 'string' || !event.delta) return;
      var delta = event.delta.slice(0, 4000);
      var role = event.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
      var start = Number.isFinite(event.start_ms) ? event.start_ms : 0;
      var end = Number.isFinite(event.end_ms) ? event.end_ms : start;
      // Late fragments/corrections from the original utterance must not cancel
      // it. offset_ms is the provider's audio timestamp at delegation creation.
      // Newer speech invalidates work immediately, before another delegation.
      if (role === 'user' && taskControl && !taskControl.signal.aborted &&
          activeSpeechOffset !== null && Number.isFinite(event.start_ms) && start > activeSpeechOffset) {
        taskControl.abort();
      }
      fragments.push({ role: role, text: delta, start: start, end: end, order: sequence++ }); chars += delta.length;
      fragments.sort(function (a, b) { return a.start - b.start || a.order - b.order; });
      while (fragments.length > 1000 || chars > 24000) chars -= fragments.shift().text.length;
      var rows = conversation(), row = rows[rows.length - 1];
      try { if (typeof opts.onTranscript === 'function') opts.onTranscript({ role: role,
        text: row && row.role === role ? row.text : delta, delta: delta, start: start, end: end }); } catch (error) {}
    }
    async function runDelegation(id, queued, speechOffset) {
      if (!current() || !started || (!queued && seen.has(id))) return;
      if (!queued) { seen.add(id); if (seen.size > 1000) seen.delete(seen.values().next().value); }
      var requestKey = JSON.stringify(fragments.filter(function (part) { return part.role === 'user'; })
        .map(function (part) { return [part.start, part.end, part.text]; }).slice(-64));
      if (working) {
        if (requestKey !== '[]' && requestKey === activeRequest && !taskControl.signal.aborted) { if (aliases.length < 20) aliases.push(id); return; }
        // New instructions invalidate the old plan before it can act in the app.
        if (taskControl) taskControl.abort();
        if (pending) send({ type: 'session.thinking.append', delegation_id: pending.id,
          content: 'The teacher added a newer question. Wait for its result.' });
        pending = { id: id, speechOffset: speechOffset }; return;
      }
      if (requestKey !== '[]' && requestKey === completedRequest) {
        send({ type: 'session.commentary.append', delegation_id: id, content: completedResult });
        return;
      }
      working = true;
      activeRequest = requestKey; aliases = [];
      activeSpeechOffset = Number.isFinite(speechOffset) && speechOffset >= 0 ? speechOffset : null;
      taskControl = new AbortController();
      var task = taskControl;
      updateContext();
      notify('Thinking…');
      try {
        var out = typeof opts.delegate === 'function'
          ? await opts.delegate({ id: id, transcript: conversation(), signal: task.signal }) : '';
        if (!current()) return;
        if (pending || task.signal.aborted) {
          send({ type: 'session.thinking.append', delegation_id: id,
            content: 'The teacher updated the question. Wait for the latest result.' });
          return;
        }
        completedRequest = requestKey;
        completedResult = String(out || '').trim().slice(0, 6000) || 'I could not complete that request. Please ask again.';
        aliases.forEach(function (alias) { send({ type: 'session.thinking.append', delegation_id: alias,
          content: 'This is the same user request. Use the completed result sent for delegation ' + id + '; do not repeat the action or reply.' }); });
        if (!send({ type: 'session.commentary.append', delegation_id: id, content: completedResult })) {
          fail(new Error('The live audio connection was lost. You can continue using the app.'));
        }
      } catch (error) {
        if (current()) send({ type: pending || task.signal.aborted ? 'session.thinking.append' : 'session.commentary.append',
          delegation_id: id, content: 'I could not complete that request. Please ask again.' });
      } finally {
        if (taskControl === task) taskControl = null;
        activeRequest = ''; aliases = []; activeSpeechOffset = null;
        working = false;
        if (current()) {
          var next = pending; pending = null;
          if (next) runDelegation(next.id, true, next.speechOffset);
          else notify('Listening. Ask the AI when you need help.');
        }
      }
    }
    function maybeReady() {
      if (!current() || started || !startedEvent || !remoteInstalled || !sessionId) return;
      started = true; clearTimeout(startupTimer);
      watchContext();
      notify('Listening. Ask the AI when you need help.');
      resolveReady(session);
    }
    function eventReceived(message) {
      if (!current()) return;
      var event;
      try { if (typeof message.data !== 'string' || message.data.length > 65536) return; event = JSON.parse(message.data); } catch (error) { return; }
      if (!event || typeof event !== 'object') return;
      if (event.type === 'session.started') { startedEvent = true; maybeReady(); }
      else if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') transcript(event);
      else if (event.type === 'session.delegation.created') {
        var item = event.delegation;
        if (item && item.target === 'client' && typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(item.id)) runDelegation(item.id, false, event.offset_ms);
      } else if (event.type === 'session.closed') close();
      else if (event.type === 'error') {
        if (!started) fail(new Error('Live assistance could not start. Please try again later.'));
        else notify('The AI could not complete that response. Please try asking again.');
      }
    }
    function waitIce() {
      if (pc.iceGatheringState === 'complete') return Promise.resolve();
      return new Promise(function (resolve, reject) {
        var peer = pc, settled = false;
        var timer = setTimeout(function () { finish(new Error('The audio connection timed out. Please try again.')); }, 10000);
        function finish(error) {
          if (settled) return; settled = true;
          clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); cancelIce = null;
          error ? reject(error) : resolve();
        }
        function changed() { if (peer.iceGatheringState === 'complete') finish(); }
        cancelIce = function () { finish(aborted()); };
        peer.addEventListener('icegatheringstatechange', changed);
      });
    }
    async function setup() {
      guard();
      if (!opts.stream || !opts.stream.getAudioTracks().some(function (track) { return track.readyState !== 'ended'; })) throw new Error('Start your microphone before using live assistance.');
      if (!opts.user || typeof opts.user.getIdToken !== 'function' || !opts.appCheckToken) throw new Error('Sign in and allow app verification before using live assistance.');
      if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser cannot connect live audio. Please try again later.');
      notify('Connecting live assistance…');
      var tokens = await Promise.all([opts.user.getIdToken(),
        typeof opts.appCheckToken === 'function' ? opts.appCheckToken() : opts.appCheckToken]);
      guard();
      if (typeof tokens[0] !== 'string' || !tokens[0] || typeof tokens[1] !== 'string' || !tokens[1]) throw new Error('App verification is still loading. Please try again.');
      headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[0], 'X-Firebase-AppCheck': tokens[1] };
      pc = new RTCPeerConnection();
      pc.ontrack = function (event) {
        if (!current()) return;
        try { if (typeof opts.onRemoteStream === 'function') opts.onRemoteStream(event.streams[0] || new MediaStream([event.track])); } catch (error) {}
      };
      opts.stream.getAudioTracks().forEach(function (track) { pc.addTrack(track, opts.stream); });
      channel = pc.createDataChannel('oai-events');
      channel.onmessage = eventReceived;
      channel.onclose = function () { if (current()) fail(new Error('The live audio connection ended. You can continue using the app.')); };
      pc.onconnectionstatechange = function () {
        if (!current()) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fail(new Error('The live audio connection was lost. You can continue using the app.'));
        else if (pc.connectionState === 'disconnected' && !lostTimer) {
          notify('Live audio interrupted. Reconnecting…');
          lostTimer = setTimeout(function () { fail(new Error('The live audio connection was lost. You can continue using the app.')); }, 8000);
        } else if (pc.connectionState === 'connected') { clearTimeout(lostTimer); lostTimer = null; }
      };
      var offer = await pc.createOffer(); guard();
      await pc.setLocalDescription(offer); guard();
      await waitIce(); guard();
      var answer = await request({ action: 'start', sdp: pc.localDescription.sdp }, headers);
      var validId = typeof answer.sessionId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(answer.sessionId);
      if (!current()) { if (validId) closeRemote(answer.sessionId, headers); return; }
      if (validId) sessionId = answer.sessionId;
      if (!validId || typeof answer.sdp !== 'string' || answer.sdp.length > 64000 || !/^v=0\r?\n/.test(answer.sdp)) throw new Error('Live assistance returned an incomplete audio connection.');
      var remaining = Number.isFinite(answer.expiresAt) ? Math.max(0, Math.min(MAX_MS, answer.expiresAt - Date.now())) : MAX_MS;
      expiryTimer = setTimeout(function () { finalMessage = 'The 10-minute live session ended. Your microphone is off.'; notify(finalMessage, 'ended'); close(); }, remaining);
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp }); guard();
      remoteInstalled = true; maybeReady();
    }
    if (opts.signal) opts.signal.addEventListener('abort', externalAbort, { once: true });
    startupTimer = setTimeout(function () { fail(new Error('Live assistance timed out. Please try again later.')); }, 60000);
    if (opts.signal && opts.signal.aborted) close();
    else setup().catch(fail);
    return ready;
  }
  return { connect: connect };
})();

export { AinsteinLiveBridge };

/** Owns the microphone, playback and the admin-only satellite control. */
export function mountAinsteinLive(options) {
  const doc = options.document || document, win = options.window || window;
  const bridge = options.bridge || AinsteinLiveBridge;
  const media = options.mediaDevices || navigator.mediaDevices;
  const style = doc.createElement('style');
  style.textContent = `
    #ainsteinLiveButton{position:fixed;z-index:893;width:36px;height:36px;border:2px solid #fff;border-radius:50%;display:grid;place-items:center;padding:7px;cursor:pointer;color:#d7fbff;background:radial-gradient(circle at 35% 25%,#287a8a,#063d49 68%);box-shadow:0 2px 10px #123b4355;touch-action:manipulation;isolation:isolate}
    #ainsteinLiveButton::before{content:'';position:absolute;inset:-4px;border-radius:50%;border:1px solid #35bdd4;opacity:.45;animation:ainsteinLiveOrbit 4s ease-in-out infinite;pointer-events:none}
    #ainsteinLiveButton svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
    #ainsteinLiveButton[data-phase=live]{background:#087d6a} #ainsteinLiveButton[data-phase=thinking]{background:#6752a1}
    #ainsteinLiveButton[data-phase=thinking]::before{animation:ainsteinLiveOrbit .8s ease-in-out infinite}
    #ainsteinLiveButton:focus-visible{outline:3px solid #0aafcb;outline-offset:5px}
    #ainsteinLivePanel{position:fixed;z-index:894;box-sizing:border-box;width:320px;max-width:calc(100vw - 20px);max-height:calc(100dvh - 24px);overflow:auto;background:#fff;color:#183d40;border:1px solid #c7e0df;border-radius:18px;box-shadow:0 12px 40px #15383f33;padding:16px;font-family:inherit;font-size:13px}
    #ainsteinLivePanel header{display:flex;align-items:center;gap:9px;margin-bottom:10px} #ainsteinLivePanel strong{font-size:16px;flex:1}
    #ainsteinLivePanel p{margin:8px 0;line-height:1.5} #ainsteinLivePanel .al-note{color:#657b7b;font-size:12px}
    #ainsteinLiveStatus{display:flex;align-items:center;gap:9px;padding:10px 0;font-weight:600}
    .al-waves{display:flex;align-items:center;gap:3px;height:22px;color:#0b8577} .al-waves i{display:block;background:currentColor;width:3px;height:7px;border-radius:3px}
    #ainsteinLivePanel[data-phase=live] .al-waves i{animation:ainsteinLiveWave 1.1s ease-in-out infinite} .al-waves i:nth-child(2){animation-delay:.2s!important}.al-waves i:nth-child(3){animation-delay:.4s!important}
    #ainsteinLivePanel[data-phase=thinking] .al-waves{color:#6752a1;animation:ainsteinLiveOrbit 1.2s ease-in-out infinite}
    #ainsteinLivePanel button{font:inherit;cursor:pointer;border-radius:9px;border:1px solid #bfd7d2;background:#fff;color:#154f48;padding:9px 12px} #ainsteinLivePanel button:disabled{opacity:.5;cursor:default}
    #ainsteinLivePanel .al-close{border:0;padding:4px 8px;font-size:19px} #ainsteinLivePanel .al-primary{background:#096e5b;color:white;border-color:#096e5b}
    #ainsteinLivePanel .al-actions{display:flex;gap:8px;margin-top:12px} #ainsteinLivePanel .al-actions button{flex:1}
    #ainsteinLiveLog{max-height:180px;overflow:auto;overscroll-behavior:contain;white-space:pre-wrap;line-height:1.5;font-size:12px} #ainsteinLiveLog div{margin:6px 0;padding:6px 8px;background:#f2f7f6;border-radius:8px}
    #ainsteinLiveButton[hidden],#ainsteinLivePanel[hidden],#ainsteinLivePanel button[hidden]{display:none!important}
    @keyframes ainsteinLiveOrbit{50%{transform:scale(1.10);opacity:.7}} @keyframes ainsteinLiveWave{50%{height:20px}}
    @media(pointer:coarse){#ainsteinLiveButton{width:42px;height:42px}}
    @media(prefers-reduced-motion:reduce){#ainsteinLiveButton::before,.al-waves,.al-waves i{animation:none!important}}
    @media print{#ainsteinLiveButton,#ainsteinLivePanel{display:none!important}}
  `;
  doc.head.appendChild(style);
  const button = doc.createElement('button');
  button.id = 'ainsteinLiveButton'; button.type = 'button'; button.hidden = true;
  button.title = 'Talk to Ai-nstein — admin voice assistant';
  button.setAttribute('aria-label', 'Open Ai-nstein voice assistant');
  button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'ainsteinLivePanel');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-dasharray="11 3"/><path d="M7 10v4m3-7v10m4-10v10m3-7v4"/></svg>';
  const panel = doc.createElement('section'); panel.id = 'ainsteinLivePanel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Ai-nstein voice assistant');
  panel.innerHTML = '<header><strong>Ai-nstein Live</strong><button class="al-close" aria-label="Close voice assistant">×</button></header>' +
    '<p id="ainsteinLiveIntro">Talk to prepare a worksheet, find questions or open Rapid Add.</p>' +
    '<div id="ainsteinLiveStatus" role="status"><span class="al-waves" aria-hidden="true"><i></i><i></i><i></i></span><span id="ainsteinLiveStatusText">Ready when you are</span></div>' +
    '<p class="al-note">Admin only · Up to 10 minutes. Starting shares your microphone and current app context with the AI. Leaving the tab ends the call.</p>' +
    '<div id="ainsteinLiveLog" aria-label="Voice transcript"></div>' +
    '<div class="al-actions"><button class="al-primary" id="ainsteinLiveStart">Start talking</button><button id="ainsteinLiveStop" hidden>End conversation</button><button id="ainsteinLivePlay" hidden>Hear Ai-nstein</button></div>';
  doc.body.append(button, panel);
  const find = id => panel.querySelector('#' + id);
  const statusText = find('ainsteinLiveStatusText'), startButton = find('ainsteinLiveStart');
  const stopButton = find('ainsteinLiveStop'), playButton = find('ainsteinLivePlay'), log = find('ainsteinLiveLog');
  const audio = options.audio || doc.createElement('audio');
  audio.autoplay = true; audio.setAttribute?.('playsinline', '');
  let phase = 'idle', generation = 0, controller = null, session = null, stream = null, identity = '';
  let microphoneListeners = [];
  let ticker = null, placementFrame = null, lastActivity = 0, opened = false, disposed = false, lastRole = '';
  const allowed = () => !disposed && options.isAdmin() === true;
  const identityNow = () => String(options.getIdentity() || '');
  function setStatus(message, nextPhase = phase) {
    phase = nextPhase; statusText.textContent = message;
    button.dataset.phase = panel.dataset.phase = phase;
    const running = !!controller;
    startButton.hidden = running; stopButton.hidden = !running;
    button.setAttribute('aria-label', running ? 'Show active Ai-nstein voice conversation' : 'Open Ai-nstein voice assistant');
  }
  function place() {
    const anchor = doc.getElementById('ainsteinBubble');
    if (!anchor || button.hidden) return;
    const r = anchor.getBoundingClientRect(), size = button.offsetWidth || 36;
    const v = win.visualViewport, vx = v?.offsetLeft || 0, vy = v?.offsetTop || 0;
    const vw = v?.width || win.innerWidth, vh = v?.height || win.innerHeight;
    const x = Math.max(vx + 6, Math.min(r.right - size + 5, vx + vw - size - 6));
    const y = Math.max(vy + 6, Math.min(r.top - 7, vy + vh - size - 6));
    button.style.left = x + 'px'; button.style.top = y + 'px';
    if (!opened) return;
    panel.style.maxHeight = Math.max(90, vh - 24) + 'px';
    const pw = panel.offsetWidth || 320, ph = panel.offsetHeight || 300;
    const top = y > vy + ph + 12 ? y - ph - 12 : Math.min(y + size + 12, vy + vh - ph - 12);
    panel.style.left = Math.max(vx + 10, Math.min(x + size - pw, vx + vw - pw - 10)) + 'px';
    panel.style.top = Math.max(vy + 12, top) + 'px';
  }
  function follow() {
    placementFrame = null;
    if (disposed || button.hidden) return;
    place(); placementFrame = win.requestAnimationFrame(follow);
  }
  function setOpen(value) {
    opened = value && allowed(); panel.hidden = !opened;
    button.setAttribute('aria-expanded', String(opened)); place();
  }
  function stopTracks(value) { value?.getTracks().forEach(track => { try { track.stop(); } catch (_) {} }); }
  function stop(message = 'Conversation ended. Microphone off.') {
    generation++; const closing = session; session = null;
    const old = controller; controller = null; old?.abort();
    microphoneListeners.forEach(([track, handler]) => track.removeEventListener?.('ended', handler));
    microphoneListeners = [];
    stopTracks(stream); stream = null;
    if (ticker) win.clearInterval(ticker); ticker = null;
    try { audio.pause(); audio.srcObject = null; } catch (_) {}
    playButton.hidden = true;
    if (closing) Promise.resolve(closing.close()).catch(() => {});
    setStatus(message, 'idle');
  }
  function refresh() {
    if (!allowed() || (controller && identity !== identityNow())) {
      stop(); setOpen(false);
    }
    const anchor = doc.getElementById('ainsteinBubble');
    button.hidden = !allowed() || !anchor || !anchor.classList.contains('show');
    if (!button.hidden && placementFrame == null) follow();
  }
  function addTranscript(row) {
    lastActivity = Date.now();
    let line = log.lastElementChild;
    if (!line || lastRole !== row.role) {
      line = doc.createElement('div'); log.appendChild(line); lastRole = row.role;
      while (log.childElementCount > 12) log.firstElementChild.remove();
    }
    line.textContent = (row.role === 'user' ? 'You: ' : 'Ai-nstein: ') + String(row.text || '').slice(-4000);
    log.scrollTop = log.scrollHeight;
  }
  async function start() {
    if (!allowed() || controller) return;
    if (!media?.getUserMedia || !win.RTCPeerConnection) { setStatus('Live voice needs a browser with microphone and WebRTC support.', 'error'); return; }
    options.beforeStart?.();
    setOpen(true); log.replaceChildren(); lastRole = '';
    const mine = ++generation, abort = new AbortController(); controller = abort; identity = identityNow();
    const user = options.getUser();
    const current = () => mine === generation && allowed() && !abort.signal.aborted && identity === identityNow();
    setStatus('Connecting…', 'connecting'); lastActivity = Date.now();
    ticker = win.setInterval(() => {
      if (!current()) { stop(); refresh(); }
      else if (Date.now() - lastActivity > 120000) stop('Stopped after two quiet minutes. Microphone off.');
    }, 1000);
    try {
      const acquired = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!current()) { stopTracks(acquired); return; }
      stream = acquired;
      acquired.getAudioTracks().forEach(track => {
        const ended = () => { if (current()) stop('Microphone disconnected. Conversation ended.'); };
        track.addEventListener?.('ended', ended, { once: true });
        microphoneListeners.push([track, ended]);
      });
      const connected = await bridge.connect({ stream, user, signal: abort.signal,
        appCheckToken: options.getAppCheckToken,
        getContext: () => current() ? options.getContext?.() || '' : '',
        delegate: async task => {
          if (!current()) throw new DOMException('Conversation ended', 'AbortError');
          lastActivity = Date.now();
          const result = await options.delegate(task);
          if (!current() || task.signal.aborted) throw new DOMException('Conversation ended', 'AbortError');
          lastActivity = Date.now(); return result;
        },
        onTranscript: row => { if (current()) addTranscript(row); },
        onStatus: (message, state) => {
          if (!current()) return;
          if (state === 'closed' || state === 'ended' || state === 'error') { stop(message); return; }
          setStatus(message.includes('Thinking') ? 'Thinking…' : state === 'live' ? 'Listening…' : message,
            message.includes('Thinking') ? 'thinking' : state === 'live' ? 'live' : 'connecting');
        },
        onRemoteStream: remote => {
          if (!current()) return;
          audio.srcObject = remote;
          Promise.resolve(audio.play()).catch(() => { if (current()) { playButton.hidden = false; setStatus('Tap Hear Ai-nstein to allow audio.'); } });
        }
      });
      if (!current()) { await connected.close(); return; }
      session = connected;
    } catch (error) {
      if (!current()) return;
      const denied = error?.name === 'NotAllowedError';
      stop(denied ? 'Microphone access was declined. Allow it in your browser to talk.' : error?.message || 'Could not connect. Please try again.');
    }
  }
  button.addEventListener('click', () => { refresh(); setOpen(!opened); if (opened && !controller) startButton.focus(); });
  startButton.addEventListener('click', start);
  stopButton.addEventListener('click', () => stop());
  playButton.addEventListener('click', () => { Promise.resolve(audio.play()).then(() => { playButton.hidden = true; }).catch(() => setStatus('Audio is blocked by your browser.')); });
  panel.querySelector('.al-close').addEventListener('click', () => { stop(); setOpen(false); button.focus(); });
  const hide = () => { if (doc.hidden) stop('Conversation ended when you left the tab. Microphone off.'); };
  const leave = () => stop();
  const key = event => { if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopImmediatePropagation(); stop(); setOpen(false); button.focus(); } };
  doc.addEventListener('visibilitychange', hide); win.addEventListener('pagehide', leave); doc.addEventListener('keydown', key, true);
  win.addEventListener('resize', place); win.visualViewport?.addEventListener('resize', place);
  const observer = new win.MutationObserver(refresh);
  const anchor = doc.getElementById('ainsteinBubble');
  if (anchor) observer.observe(anchor, { attributes: true, attributeFilter: ['class', 'style'] });
  refresh();
  return { start, stop, refresh, place, get phase() { return phase; }, get active() { return !!controller; },
    destroy() { stop(); disposed = true; observer.disconnect(); if (placementFrame != null) win.cancelAnimationFrame(placementFrame);
      doc.removeEventListener('visibilitychange', hide); win.removeEventListener('pagehide', leave); doc.removeEventListener('keydown', key, true);
      win.removeEventListener('resize', place); win.visualViewport?.removeEventListener('resize', place); button.remove(); panel.remove(); style.remove(); }
  };
}
