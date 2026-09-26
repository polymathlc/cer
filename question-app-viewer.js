(function () {
  'use strict';
  const apps = window.QuestionApps;
  const status = document.getElementById('app-status');
  const content = document.getElementById('app-content');
  async function readLimited(response) {
    const limit = apps.MAX_PAYLOAD_BYTES;
    if (Number(response.headers.get('Content-Length')) > limit) throw new Error('This app is too large to open. Ask your teacher to publish a smaller app.');
    if (!response.body || typeof response.body.getReader !== 'function') {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > limit) throw new Error('This app is too large to open.');
      return new Uint8Array(buffer);
    }
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('This app is too large to open.'); }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }
  async function load() {
    let timeout;
    try {
      const url = apps.storageUrlFromHash(window.location.hash);
      if (!url) throw new Error('This app link is incomplete. Scan the QR code on your worksheet again, or ask your teacher for a new link.');
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, {credentials:'omit', redirect:'error', referrerPolicy:'no-referrer', signal:controller.signal});
      if (!response.ok) throw new Error('This app is unavailable. Ask your teacher to publish it again.');
      const bytes = await readLimited(response);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const sha256 = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
      if (sha256 !== apps.parseShareHash(window.location.hash).id) throw new Error('This app has changed since the worksheet was published. Ask your teacher for a new link.');
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      if (!payload || typeof payload !== 'object' || typeof payload.html !== 'string' || !payload.html.trim()) throw new Error('This app has no activity yet. Ask your teacher to check it.');
      // Only these display fields are consumed. No auth SDK, private question
      // bank, API keys, answer records, or arbitrary destination URLs are used.
      const title = typeof payload.title === 'string' ? payload.title.slice(0, 160) : 'Explore this question';
      document.getElementById('app-title').textContent = title || 'Explore this question';
      document.title = (title || 'Explore this question') + ' · Polymath';
      content.innerHTML = apps.frame({title, html:payload.html, height:payload.height});
      status.hidden = true;
    } catch (error) {
      status.classList.add('error');
      status.textContent = error && error.name === 'AbortError' ? 'The app took too long to load. Refresh to try again.' : error instanceof SyntaxError ? 'This app could not be read. Ask your teacher to publish it again.' : error.message || 'The app could not load. Check your connection and refresh to try again.';
    } finally { clearTimeout(timeout); }
  }
  load();
})();
