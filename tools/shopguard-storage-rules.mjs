// Narrow migration of the CURRENT shared Storage rules for Shop Guard's video
// clips and alert pictures (shopguard/ in mathgen--app.firebasestorage.app).
// The shared Storage rules are open, so without this anybody holding the public
// web config could list and download the shop's CCTV footage. This patch closes
// exactly that folder and nothing else:
//
//   • one block, right above the catch-all, lets ONLY the shop owner's verified
//     Google account read, list, upload and delete under shopguard/ — uploads
//     up to 60 MB and only video, image or plain-text files;
//   • one predicate on the catch-all's allow statements skips shopguard/, so no
//     other statement can grant anything there.
//
// It reuses the /cs Storage tool's machinery (tools/cs-storage-rules.mjs): it
// records how today's rules answer every other folder, tries a few spellings of
// the predicate in a dry run, and only uses one that answers everything else
// exactly as before AND closes shopguard/. Nothing is published unless asked
// (--apply), and never over rules that changed while it was testing.
//
//   node tools/shopguard-storage-rules.mjs --firebase-tools <dir> --read     installed? outline
//   node tools/shopguard-storage-rules.mjs --firebase-tools <dir>            dry run, change nothing
//   node tools/shopguard-storage-rules.mjs --firebase-tools <dir> --apply    dry run, then publish
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { locateCatchAll, patchCatchAll, describeStorageRules } from './cs-storage-rules.mjs';

export const PROJECT = 'mathgen--app';
export const BUCKET = 'mathgen--app.firebasestorage.app';
// Keep equal to ALLOWED_EMAILS in shopguard/index.html and SHOPGUARD_OWNERS in
// tools/shopguard-rules.mjs (a test checks).
export const SHOPGUARD_OWNERS = ['chungzhikai@gmail.com'];
export const MARKER = 'polymath-shopguard-storage-v1';
export const MAX_BYTES = 60 * 1024 * 1024;
const list = a => JSON.stringify(a).replace(/"/g, "'").replace(/,/g, ', ');

const OWNER_CHECK = [
  `request.auth != null`,
  `    && request.auth.token.email_verified == true`,
  `    && request.auth.token.email.lower() in ${list(SHOPGUARD_OWNERS)}`
];

export const SHOPGUARD_STORAGE_BLOCK = (indent) => [
  `// BEGIN ${MARKER}`,
  `// polymathlc.com.sg/shopguard: the shop camera's video clips and alert`,
  `// pictures. Only the shop owner reads, lists, uploads or deletes them.`,
  `// The catch-all skips this folder.`,
  `match /shopguard/{shopGuardPath=**} {`,
  `  allow read, delete: if ${OWNER_CHECK[0]}`,
  `  ${OWNER_CHECK[1]}`,
  `  ${OWNER_CHECK[2]};`,
  `  allow create, update: if ${OWNER_CHECK[0]}`,
  `  ${OWNER_CHECK[1]}`,
  `  ${OWNER_CHECK[2]}`,
  `      && request.resource.size <= ${MAX_BYTES}`,
  `      && request.resource.contentType.matches('^(video|image|text)/.*$');`,
  `}`,
  `// END ${MARKER}`,
  ``
].map(line => (line ? indent + line : line)).join('\n') + '\n';

// The predicate's spelling depends on what the catch-all's wildcard binds to.
export function predicateCandidates(variable) {
  const v = variable;
  return [
    `!string(${v}).matches('^/?shopguard/.*')`,
    `!(${v}.matches('^/?shopguard/.*'))`,
    `!(${v}[0] == 'shopguard')`
  ];
}

function count(source, pattern) { return (source.match(pattern) || []).length; }

export function isInstalled(source) {
  const n = count(source, new RegExp('BEGIN ' + MARKER, 'g'));
  if (n > 1) throw new Error('Ambiguous existing Shop Guard Storage protection.');
  if (n === 0 && /match\s+\/shopguard\//.test(source))
    throw new Error('A partial Shop Guard Storage rule is already there; review the Storage rules first.');
  return n === 1;
}

/** Build one candidate source with a given predicate. */
export function buildCandidate(source, predicate) {
  const where = locateCatchAll(source);
  const patched = patchCatchAll(where.block, predicate);
  return source.slice(0, where.start) + SHOPGUARD_STORAGE_BLOCK(where.indent) + patched + source.slice(where.end);
}

/* ================= Probes ================= */
const OWNER_EMAIL = SHOPGUARD_OWNERS[0];
const USERS = {
  stranger: null,
  signedIn: { uid: 'sg-st-user', token: { sub: 'sg-st-user', email: 'parent@example.com', email_verified: true } },
  officeAdmin: { uid: 'sg-st-office', token: { sub: 'sg-st-office', email: 'admin@polymathlc.com.sg', email_verified: true } },
  owner: { uid: 'sg-st-owner', token: { sub: 'sg-st-owner', email: OWNER_EMAIL, email_verified: true } },
  ownerCaps: { uid: 'sg-st-owner-caps', token: { sub: 'sg-st-owner-caps', email: OWNER_EMAIL.toUpperCase(), email_verified: true } },
  unverifiedOwner: { uid: 'sg-st-unv', token: { sub: 'sg-st-unv', email: OWNER_EMAIL, email_verified: false } }
};
const OTHER_PATHS = ['shop-orders/probe/receipt.jpg', 'shop-products/probe/1.jpg', 'cer-images/probe.png',
  'scan-mistakes/probe/a.jpg', 'tutor-worksheets/probe.pdf', 'pdf-annotator/probe.pdf', 'mathImages/probe.png',
  'cs-previews/probe/a-0.jpg', 'cs-files/probe1234/Notes.pdf', 'shopguardx/probe/a.jpg', 'other/shopguard/a.jpg',
  'shop-guard/probe.mp4', 'top-level.txt', 'a/b/c/d/e.png', 'users/probe/avatar.png'];

function contentTypeFor(path) {
  if (path.endsWith('.pdf')) return 'application/pdf';
  if (path.endsWith('.mp4')) return 'video/mp4';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.txt')) return 'text/plain';
  if (path.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

export function storageCase(path, method, who, expectation, { size = 1000, contentType } = {}) {
  const object = { name: path, bucket: BUCKET, size, contentType: contentType || contentTypeFor(path), metadata: {} };
  const request = { path: '/b/' + BUCKET + '/o/' + path, method, auth: USERS[who] };
  if (method === 'create' || method === 'update') request.resource = object;
  const test = { expectation, request };
  if (method !== 'create') test.resource = object;
  return test;
}

/** Everything that must keep answering exactly as it does today. */
export function preservationProbes() {
  const out = [];
  for (const path of OTHER_PATHS)
    for (const method of ['get', 'list', 'create', 'update', 'delete'])
      for (const who of ['stranger', 'signedIn', 'owner'])
        out.push({ key: path + '|' + method + '|' + who, make: e => storageCase(path, method, who, e) });
  return out;
}

export const SHOPGUARD_FILES = [
  'shopguard/cc-collectibles/video/counter_cam/2026-11-03/1793713914708.mp4',
  'shopguard/cc-collectibles/video/counter_cam/2026-11-03/1793713929719.webm',
  'shopguard/cc-collectibles/alerts/2026-11-03/2026-11-03_1793713924660_counter_cam_0.jpg',
  'shopguard/cc-collectibles/diagnostics/test-1793713930000.txt'
];

/** What the shopguard/ folder must answer after the patch. */
export function shopGuardStorageExpectations() {
  const cases = [];
  const owners = ['owner', 'ownerCaps'], others = ['stranger', 'signedIn', 'officeAdmin', 'unverifiedOwner'];
  for (const file of SHOPGUARD_FILES) {
    for (const who of others)
      for (const method of ['get', 'list', 'create', 'update', 'delete']) cases.push(storageCase(file, method, who, 'DENY'));
    for (const who of owners)
      for (const method of ['get', 'list', 'create', 'update', 'delete']) cases.push(storageCase(file, method, who, 'ALLOW'));
  }
  const clip = SHOPGUARD_FILES[0];
  // Too big, or not a video / picture / text file: refused even for the owner.
  cases.push(storageCase(clip, 'create', 'owner', 'DENY', { size: MAX_BYTES + 1 }));
  cases.push(storageCase(clip, 'create', 'owner', 'ALLOW', { size: MAX_BYTES }));
  cases.push(storageCase('shopguard/cc-collectibles/video/x.exe', 'create', 'owner', 'DENY', { contentType: 'application/octet-stream' }));
  cases.push(storageCase('shopguard/cc-collectibles/x.html', 'create', 'owner', 'DENY', { contentType: 'application/x-html' }));
  // Folder listings: the owner only.
  for (const who of others) cases.push(storageCase('shopguard', 'list', who, 'DENY'), storageCase('shopguard/cc-collectibles/video', 'list', who, 'DENY'));
  for (const who of owners) cases.push(storageCase('shopguard/cc-collectibles/video', 'list', who, 'ALLOW'));
  return cases;
}

async function runTests(request, source, cases) {
  const results = [];
  let issues = [];
  for (let offset = 0; offset < cases.length; offset += 100) {
    const batch = cases.slice(offset, offset + 100);
    const r = await request(`projects/${PROJECT}:test`, { method: 'POST', body: { source, testSuite: { testCases: batch } } });
    issues = issues.concat((r.issues || []).filter(i => i.severity === 'ERROR'));
    (r.testResults || []).forEach(t => results.push(t.state === 'SUCCESS'));
    if ((r.testResults || []).length !== batch.length) throw new Error('The Rules API answered ' + (r.testResults || []).length + ' of ' + batch.length + ' cases.');
  }
  return { results, issues };
}

export async function publishShopGuardStorageRules({ request, deploy = false, readOnly = false }) {
  if (deploy && readOnly) throw new Error('Read and apply modes are exclusive.');
  const releasePath = `projects/${PROJECT}/releases/firebase.storage/${BUCKET}`;
  const previous = await request(releasePath);
  const valid = name => typeof name === 'string' && name.startsWith(`projects/${PROJECT}/rulesets/`) && !name.slice(`projects/${PROJECT}/rulesets/`.length).includes('/');
  if (!valid(previous.rulesetName)) throw new Error('Unexpected current Storage ruleset.');
  const production = await request(previous.rulesetName), files = production.source?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Unexpected Storage rules files.');
  const original = files[0].content;
  const outline = describeStorageRules(original);
  if (isInstalled(original)) {
    // Installed already: just confirm it still holds.
    const { results } = await runTests(request, production.source, shopGuardStorageExpectations());
    const holds = results.every(Boolean);
    if (!holds) throw new Error('The installed Shop Guard Storage protection no longer holds; review the Storage rules.');
    return { mode: readOnly ? 'read' : (deploy ? 'apply' : 'test'), installed: true, changeNeeded: false, holds, outline };
  }
  locateCatchAll(original);
  if (readOnly) return { mode: 'read', installed: false, changeNeeded: true, outline };

  // 1. How do today's rules answer everything else?
  const probes = preservationProbes();
  const today = await runTests(request, production.source, probes.map(p => p.make('ALLOW')));
  const recorded = probes.map((p, i) => p.make(today.results[i] ? 'ALLOW' : 'DENY'));
  const allowedToday = today.results.filter(Boolean).length;

  // 2. The first candidate that keeps all of it and closes shopguard/.
  const where = locateCatchAll(original);
  const tried = [];
  let chosen = null;
  for (const predicate of predicateCandidates(where.variable)) {
    const content = buildCandidate(original, predicate);
    const source = { files: [{ ...files[0], content }] };
    let verdict;
    try {
      const keep = await runTests(request, source, recorded);
      const own = await runTests(request, source, shopGuardStorageExpectations());
      const kept = keep.results.filter(Boolean).length, closed = own.results.filter(Boolean).length;
      verdict = { predicate, kept: kept + '/' + recorded.length, shopGuardCases: closed + '/' + own.results.length, compileErrors: keep.issues.length + own.issues.length };
      if (!verdict.compileErrors && kept === recorded.length && closed === own.results.length) { chosen = { predicate, content, source }; tried.push(verdict); break; }
    } catch (error) {
      verdict = { predicate, error: String(error.message).slice(0, 200) };
    }
    tried.push(verdict);
  }
  const base = { installed: false, changeNeeded: true, probes: recorded.length, allowedToday, tried, outline };
  if (!chosen) throw new Error('No candidate kept every other app\'s Storage access while closing shopguard/; nothing changed. ' + JSON.stringify(base));
  const sourceSha256 = createHash('sha256').update(chosen.content).digest('hex');
  if (!deploy) return { mode: 'test', ...base, predicate: chosen.predicate, sourceSha256 };

  const candidate = await request(`projects/${PROJECT}/rulesets`, { method: 'POST', body: { source: chosen.source } });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime)
    throw new Error('Storage rules changed during validation; retry against current rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Cannot verify the published Shop Guard Storage protection.');
  return { mode: 'apply', changed: true, ...base, predicate: chosen.predicate, previousRuleset: previous.rulesetName, ruleset: candidate.name, sourceSha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  const index = flags.indexOf('--firebase-tools');
  const cliRoot = index >= 0 ? flags.splice(index, 2)[1] : null;
  if (!cliRoot || cliRoot.startsWith('--') || flags.length > 1 || flags.some(flag => !['--read', '--apply'].includes(flag)))
    throw new Error('Use --firebase-tools <installed-package-directory>, optionally --read or --apply.');
  const require = createRequire(import.meta.url), cli = name => require(resolve(cliRoot, 'lib', name));
  const { Command } = cli('command'), { requireAuth } = cli('requireAuth'), { logger } = cli('logger'), { Client } = cli('apiv2');
  logger.silent = true;
  const command = new Command('shopguard:storage-rules').before(requireAuth).action(async () => {
    const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
    const request = async (path, options = {}) => {
      try { return (await client.request({ method: options.method || 'GET', path, ...(options.body ? { body: options.body } : {}),
        skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } })).body; }
      catch (error) { throw new Error('Rules API failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ') on ' + (options.method || 'GET') + ' ' + path.replace(/rulesets\/[\w-]+/, 'rulesets/…') + ': ' + String(error.context?.body?.error?.message || error.message || '').slice(0, 400)); }
    };
    console.log(JSON.stringify(await publishShopGuardStorageRules({ request, deploy: flags.includes('--apply'), readOnly: flags.includes('--read') }), null, 2));
  });
  await command.runner()({ project: PROJECT, projectId: PROJECT, projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
}
