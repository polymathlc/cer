// Cloud Functions for polymathlc.com.sg/cs — the gated download page.
// Codebase `polymath-cs`, deployed ONLY by .github/workflows/deploy-cs.yml.
//
//   csListFiles  callable, public    the page's text, the consent wording and the
//                                    downloadable files (never their storage paths)
//   csUnlock     callable, public    name + email + WhatsApp + consent → a lead,
//                                    and a 24-hour download link for one file
//   csDownload   HTTP GET, public    spends one use of a link and STREAMS the file
//   csAdmin      callable, admin     files, booklet pages, page text and leads
//
// Contact details are written only here, through the Admin SDK, into
// server-only collections. Nothing in this codebase prints a visitor's name,
// email or number to the logs.
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createService, clientIp, downloadErrorPage, ServiceError } from './service.js';

export const BUCKET = 'mathgen--app.firebasestorage.app';
// The pages that serve the form. A page on any other origin gets no CORS
// headers, which a browser reports as a bare network failure — so moving the
// site means adding the new origin HERE and redeploying (the enquiry form
// broke exactly that way on the custom domain).
export const ORIGINS = [
  'https://polymathlc.com.sg',
  'https://www.polymathlc.com.sg',
  'https://polymathlc.github.io',
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
];

initializeApp();
const service = createService({
  db: getFirestore(),
  bucket: getStorage().bucket(BUCKET),
  log: (event, fields) => logger.info('cs ' + event, fields)
});

// No `concurrency`: with a fractional CPU (256 MiB) Cloud Run refuses anything but 1,
// and the deploy would fail rather than run slower.
const base = { region: 'us-central1', cors: ORIGINS, memory: '256MiB' };

function asHttpsError(error) {
  if (error instanceof HttpsError) return error;
  if (error instanceof ServiceError) return new HttpsError(error.code, error.message, error.details);
  logger.error('cs unexpected failure', { message: String(error && error.message || error).slice(0, 300) });
  return new HttpsError('internal', 'Something went wrong on our side. Please try again in a minute.');
}

export const csListFiles = onCall({ ...base, timeoutSeconds: 30, maxInstances: 10 }, async () => {
  try { return await service.listFiles(); }
  catch (error) { throw asHttpsError(error); }
});

export const csUnlock = onCall({ ...base, timeoutSeconds: 30, maxInstances: 10 }, async request => {
  try {
    return await service.unlock(request.data, {
      ip: clientIp(request.rawRequest),
      userAgent: String((request.rawRequest && request.rawRequest.headers && request.rawRequest.headers['user-agent']) || '')
    });
  } catch (error) { throw asHttpsError(error); }
});

export const csAdmin = onCall({ ...base, timeoutSeconds: 300, maxInstances: 3, memory: '512MiB' }, async request => {
  try { return await service.admin(request.data, request.auth || null); }
  catch (error) { throw asHttpsError(error); }
});

function allowedOrigin(origin) {
  if (!origin) return '';
  return ORIGINS.some(o => (typeof o === 'string' ? o === origin : o.test(origin))) ? origin : '';
}

export const csDownload = onRequest({ region: 'us-central1', memory: '256MiB', timeoutSeconds: 540,
  maxInstances: 10, cors: false }, async (req, res) => {
  // The admin page fetches a stored PDF back to redraw its booklet pages, so
  // the listed origins may read the response. Everyone else just downloads.
  const origin = allowedOrigin(req.get('origin'));
  if (origin) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') {
    if (origin) { res.set('Access-Control-Allow-Methods', 'GET, HEAD'); res.set('Access-Control-Max-Age', '3600'); }
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).set('Allow', 'GET, HEAD').end(); return; }
  let opened;
  try {
    opened = await service.openDownload(String(req.query.k || ''), { method: req.method });
  } catch (error) {
    const status = (error && error.details && error.details.status) || 500;
    if (!(error instanceof ServiceError)) logger.error('cs download failure', { message: String(error && error.message || error).slice(0, 300) });
    res.status(status)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Cache-Control', 'no-store')
      .set('X-Content-Type-Options', 'nosniff')
      .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
      .send(downloadErrorPage(status, error instanceof ServiceError ? error.message : 'Something went wrong. Please try again.'));
    return;
  }
  res.status(200);
  for (const [name, value] of Object.entries(opened.headers)) res.set(name, value);
  // Small files carry their length (a progress bar for the visitor). Large
  // ones are STREAMED in chunks, which Cloud Run's 32 MiB cap does not cover.
  if (opened.size && opened.size < 24 * 1024 * 1024) res.set('Content-Length', String(opened.size));
  if (req.method === 'HEAD') { res.end(); return; }
  await new Promise(resolve => {
    const stream = opened.object.createReadStream();
    stream.on('error', error => {
      logger.error('cs stream failure', { message: String(error && error.message || error).slice(0, 300) });
      if (!res.headersSent) res.status(500).set('Content-Type', 'text/plain').send('The file could not be read. Please try again.');
      else res.destroy(error);
      resolve();
    });
    res.on('close', resolve);
    res.on('finish', resolve);
    stream.pipe(res);
  });
});
