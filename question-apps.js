/* Shared, dependency-free question-app rendering. QR generation uses the local MIT library. */
(function (root) {
  'use strict';
  const VIEWER_URL = 'https://polymathlc.github.io/cer/question-app.html';
  const STORAGE_BUCKET = 'mathgen--app.firebasestorage.app';
  const MAX_PAYLOAD_BYTES = 600000;
  const ID_RE = /^[a-f0-9]{64}$/;
  const TOKEN_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  }
  function normalizeTokenLimit(value) {
    const number = Number(value);
    return value === '' || value == null || !Number.isFinite(number) ? 4096 : Math.max(1024, Math.min(32000, Math.floor(number)));
  }
  function normalizeHeight(value) {
    const number = Number(value);
    return value === '' || value == null || !Number.isFinite(number) ? 560 : Math.max(240, Math.min(900, Math.floor(number)));
  }
  function sandboxDocument(html) {
    // The trusted head is parsed before all author-supplied content, including a
    // complete HTML document. A later CSP can tighten, but cannot relax this one.
    return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + escapeHtml(CSP) + '"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + String(html || '') + '</body></html>';
  }
  function frame(block) {
    block = block || {};
    return '<iframe class="question-app-frame" title="' + escapeHtml(block.title || 'Explore this question') + '" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" style="display:block;width:100%;height:' + normalizeHeight(block.height) + 'px;border:1px solid #d8e2ef;border-radius:12px;background:white" srcdoc="' + escapeHtml(sandboxDocument(block.html)) + '"></iframe>';
  }
  function contentHash(html) {
    // This is only a synchronous stale-publication guard, never authorization.
    // Storage object names use a separate SHA-256 digest in the editor.
    const source = String(html || '');
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return 'v1-' + source.length + '-' + (hash >>> 0).toString(16).padStart(8, '0');
  }
  function sourceHash(block) {
    block = block || {};
    return contentHash(JSON.stringify({html:String(block.html || ''), title:String(block.title || 'Explore this question').slice(0, 120), height:normalizeHeight(block.height)}));
  }
  function parseShareHash(hash) {
    const parameters = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    if (Array.from(parameters.keys()).length !== 2 || parameters.getAll('id').length !== 1 || parameters.getAll('token').length !== 1) return null;
    const id = parameters.get('id'), token = parameters.get('token');
    return ID_RE.test(id || '') && TOKEN_RE.test(token || '') ? {id, token} : null;
  }
  function viewerUrl(id, token) {
    if (!ID_RE.test(String(id || '')) || !TOKEN_RE.test(String(token || ''))) return '';
    return VIEWER_URL + '#id=' + id + '&token=' + token;
  }
  function validViewerUrl(value) {
    try {
      const url = new URL(value);
      if (url.origin + url.pathname !== VIEWER_URL || url.search || url.username || url.password) return '';
      const data = parseShareHash(url.hash);
      return data ? viewerUrl(data.id, data.token) : '';
    } catch (_) { return ''; }
  }
  function storageUrlFromHash(hash) {
    const data = parseShareHash(hash);
    return data ? 'https://firebasestorage.googleapis.com/v0/b/' + STORAGE_BUCKET + '/o/' + encodeURIComponent('cer-images/question-app-' + data.id + '.json') + '?alt=media&token=' + data.token : '';
  }
  function publishedUrl(block) {
    return block && String(block.html || '').trim() && block.appSourceHash === sourceHash(block) ? validViewerUrl(block.appUrl) : '';
  }
  function printBlock(block) {
    if (!block || !String(block.html || '').trim()) return '';
    const url = publishedUrl(block);
    const title = escapeHtml(block && block.title || 'Explore this question');
    const style = 'break-inside:avoid;page-break-inside:avoid;display:flex;align-items:center;gap:14px;border:1px solid #cbd5e1;border-radius:8px;padding:10px;margin:10px 0;color:#17283e;background:white';
    if (!url) return '<div class="question-app-print question-app-unpublished" style="' + style + '"><div><strong>' + title + '</strong><div style="font-size:11px;margin-top:4px">Publish app in question editor before printing a QR code.</div></div></div>';
    let svg = '';
    if (typeof root.qrcode === 'function') {
      const qr = root.qrcode(0, 'M');
      qr.addData(url, 'Byte');
      qr.make();
      // A four-module quiet zone and a vector image survive worksheet/PDF scaling.
      svg = qr.createSvgTag({cellSize:2, margin:8, scalable:true}).replace('<svg ', '<svg role="img" aria-label="Scan to explore this question" width="128" height="128" style="width:128px;height:128px;min-width:128px;flex:none" ');
    }
    return '<div class="question-app-print" style="' + style + '">' + svg + '<div><strong>' + title + '</strong><div style="font-size:11px;margin:4px 0">After finishing the question, scan to explore the app.</div><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#124d96;text-decoration:underline">Explore this question</a>' + (svg ? '' : '<div style="font-size:10px">QR code unavailable. Open the link in the digital worksheet.</div>') + '</div></div>';
  }
  const api = {VIEWER_URL, STORAGE_BUCKET, MAX_PAYLOAD_BYTES, escapeHtml, normalizeTokenLimit, normalizeHeight, sandboxDocument, frame, contentHash, sourceHash, viewerUrl, validViewerUrl, parseShareHash, storageUrlFromHash, publishedUrl, printBlock};
  root.QuestionApps = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
