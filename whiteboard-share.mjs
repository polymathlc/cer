import { whiteboardPublicSnapshot, normalizeWhiteboard } from './whiteboard-core.mjs?v=1.429.0';

export const WHITEBOARD_BUCKET = 'mathgen--app.firebasestorage.app';
export const WHITEBOARD_VIEWER = 'https://polymathlc.github.io/cer/whiteboard.html';
const DIGEST = /^[a-f0-9]{64}$/;
const TOKEN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const WHITEBOARD_SHARE_BYTES = 750000;

// The public viewer has no portal runtime, so apply the same image-host
// conversion used by the bank before asking the browser for a diagram.
export function whiteboardImageUrl(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.hostname === 'dropbox.com' || url.hostname.endsWith('.dropbox.com')) {
      url.hostname = 'dl.dropboxusercontent.com'; url.searchParams.delete('dl'); return url.href;
    }
    if (url.hostname === 'drive.google.com') {
      const id = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || url.searchParams.get('id');
      if (id) return 'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(id);
    }
  } catch (_) {}
  return value;
}

export function whiteboardShareParameters(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if ([...params.keys()].length !== 2 || params.getAll('id').length !== 1 || params.getAll('token').length !== 1) return null;
  const id = params.get('id'), token = params.get('token');
  return DIGEST.test(id || '') && TOKEN.test(token || '') ? { id, token } : null;
}
export function whiteboardViewerUrl(id, token) {
  return DIGEST.test(String(id || '')) && TOKEN.test(String(token || '')) ? WHITEBOARD_VIEWER + '#id=' + id + '&token=' + token : '';
}
export function validWhiteboardUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin + url.pathname !== WHITEBOARD_VIEWER || url.search || url.username || url.password) return '';
    const parameters = whiteboardShareParameters(url.hash);
    return parameters ? whiteboardViewerUrl(parameters.id, parameters.token) : '';
  } catch (_) { return ''; }
}
export function whiteboardStorageUrl(hash) {
  const parameters = whiteboardShareParameters(hash);
  return parameters ? 'https://firebasestorage.googleapis.com/v0/b/' + WHITEBOARD_BUCKET + '/o/' + encodeURIComponent('cer-images/whiteboard-' + parameters.id + '.json') + '?alt=media&token=' + parameters.token : '';
}
export function whiteboardSnapshotBytes(board) {
  const bytes = new TextEncoder().encode(JSON.stringify(whiteboardPublicSnapshot(board)));
  if (bytes.length > WHITEBOARD_SHARE_BYTES) throw new Error('This whiteboard is too large to share. Put some questions or apps on a second whiteboard.');
  return bytes;
}
export async function whiteboardDigest(bytes) {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}
export async function readWhiteboardBytes(response) {
  if (Number(response.headers.get('Content-Length')) > WHITEBOARD_SHARE_BYTES) throw new Error('This whiteboard is too large to open.');
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > WHITEBOARD_SHARE_BYTES) throw new Error('This whiteboard is too large to open.');
    return bytes;
  }
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.length;
    if (length > WHITEBOARD_SHARE_BYTES) { await reader.cancel(); throw new Error('This whiteboard is too large to open.'); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function loadPublishedWhiteboard(value, fetcher = globalThis.fetch) {
  const link = validWhiteboardUrl(value);
  if (!link) throw new Error('This whiteboard link is incomplete. Ask your teacher for its share link.');
  const hash = new URL(link).hash, controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(whiteboardStorageUrl(hash), { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok) throw new Error('This whiteboard is unavailable. Ask your teacher to share it again.');
    const bytes = await readWhiteboardBytes(response);
    if (await whiteboardDigest(bytes) !== whiteboardShareParameters(hash).id) throw new Error('This whiteboard does not match its published link. Ask your teacher to share it again.');
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    const board = normalizeWhiteboard(raw);
    if (!board) throw new Error('This link does not contain a whiteboard.');
    // Whitelist again on read. No private answer fields or metadata are consumed.
    return whiteboardPublicSnapshot(board);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The whiteboard took too long to load. Refresh to try again.');
    if (error instanceof SyntaxError) throw new Error('This whiteboard could not be read. Ask your teacher to share it again.');
    throw error;
  } finally { clearTimeout(timeout); }
}
