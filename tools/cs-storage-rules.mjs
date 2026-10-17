// Narrow migration of the CURRENT shared Storage rules for the /cs download
// gate. The gated files live in Storage under cs-files/, and the shared
// Storage rules are open: anybody can read or LIST that folder straight from
// the Firebase web config and walk round the form. This patch closes exactly
// that folder and nothing else:
//
//   • one block, right above the catch-all, lets ONLY the verified admin
//     upload (create/update) a file into cs-files/{fileId}/{fileName} from
//     the /cs page — up to 100 MB;
//   • one predicate on the catch-all's allow conditions skips cs-files/, so
//     no other statement can grant a read, list, write or delete there.
//
// The server (cs-function) reads, streams and deletes those files through the
// Admin SDK, which Storage rules never apply to. The booklet pages in
// cs-previews/ are untouched (they are public on purpose).
//
// HOW IT STAYS SAFE without knowing the live rules in advance:
//   1. It asks the Rules API how today's rules answer a broad set of probes
//      (other apps' folders, the bucket root, deep paths; get/list/create/
//      update/delete; signed out, signed in, the admin) and RECORDS each
//      answer.
//   2. It builds candidate patches (the catch-all's wildcard can be a string
//      or a path depending on the rules, so a few spellings of the predicate
//      are tried) and runs, for each, the recorded answers as expectations
//      plus the /cs expectations. The first candidate that keeps every other
//      answer identical AND closes cs-files/ is the one used.
//   3. Nothing is published unless asked (--apply), and never over rules that
//      changed while it was testing.
//
//   node tools/cs-storage-rules.mjs --firebase-tools <dir> --read     installed? outline
//   node tools/cs-storage-rules.mjs --firebase-tools <dir>            dry run, change nothing
//   node tools/cs-storage-rules.mjs --firebase-tools <dir> --apply    dry run, then publish
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'mathgen--app';
export const BUCKET = 'mathgen--app.firebasestorage.app';
export const ADMIN_EMAIL = 'chungzhikai@gmail.com';
export const MARKER = 'polymath-cs-storage-v1';
const MAX_BYTES = 100 * 1024 * 1024;

export const CS_STORAGE_BLOCK = (indent) => [
  `// BEGIN ${MARKER}`,
  `// polymathlc.com.sg/cs: the gated files. Only the admin uploads them, from`,
  `// the /cs page; nobody reads, lists or deletes them directly — the cs-function`,
  `// server streams them once a visitor has agreed. The catch-all skips this folder.`,
  `match /cs-files/{csFileId}/{csFileName} {`,
  `  allow create, update: if request.auth != null`,
  `    && request.auth.token.email_verified == true`,
  `    && request.auth.token.email == '${ADMIN_EMAIL}'`,
  `    && request.resource.size <= ${MAX_BYTES};`,
  `}`,
  `// END ${MARKER}`,
  ``
].map(line => (line ? indent + line : line)).join('\n') + '\n';

// The predicate's spelling depends on what the catch-all's wildcard binds to.
export function predicateCandidates(variable) {
  const v = variable;
  return [
    `!string(${v}).matches('^/?cs-files/.*')`,
    `!(${v}.matches('^/?cs-files/.*'))`,
    `!(${v}[0] == 'cs-files')`
  ];
}

function count(source, pattern) { return (source.match(pattern) || []).length; }

/** Where the catch-all is, what its wildcard is called, and its block's extent. */
export function locateCatchAll(source) {
  if (typeof source !== 'string' || !/service\s+firebase\.storage\s*\{/.test(source))
    throw new Error('Unrecognized Storage rules; no rules changed.');
  if (count(source, /match\s+\/b\/\{\w+\}\/o\s*\{/g) !== 1)
    throw new Error('Expected one /b/{bucket}/o block; review the Storage rules first.');
  const re = /^([ \t]*)match\s+\/\{(\w+)=\*\*\}\s*\{/gm;
  const all = [...source.matchAll(re)];
  if (all.length !== 1) throw new Error('Expected exactly one recursive catch-all in the Storage rules; found ' + all.length + '.');
  const m = all[0];
  const start = m.index;
  let depth = 0, end = -1;
  for (let i = source.indexOf('{', start + m[0].length - 1); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  if (end < 0) throw new Error('Unbalanced catch-all block.');
  return { start, end, indent: m[1], variable: m[2], block: source.slice(start, end) };
}

/** Add the predicate to every allow statement in the catch-all block. */
export function patchCatchAll(block, predicate) {
  let changed = 0;
  const out = block.replace(/allow\s+([a-z, ]+?)\s*(?::\s*if\s+([^;]+?))?\s*;/g, (whole, methods, cond) => {
    changed++;
    return cond === undefined
      ? `allow ${methods.trim()}: if ${predicate};`
      : `allow ${methods.trim()}: if (${cond.trim()}) && ${predicate};`;
  });
  if (!changed) throw new Error('The catch-all has no allow statement to narrow.');
  return out;
}

export function isInstalled(source) {
  const n = count(source, new RegExp('BEGIN ' + MARKER, 'g'));
  if (n > 1) throw new Error('Ambiguous existing /cs Storage protection.');
  return n === 1;
}

/** Build one candidate source with a given predicate. */
export function buildCandidate(source, predicate) {
  const where = locateCatchAll(source);
  const patched = patchCatchAll(where.block, predicate);
  return source.slice(0, where.start) + CS_STORAGE_BLOCK(where.indent) + patched + source.slice(where.end);
}

/* ================= Probes ================= */
const USERS = {
  stranger: null,
  signedIn: { uid: 'cs-st-user', token: { sub: 'cs-st-user', email: 'parent@example.com', email_verified: true } },
  admin: { uid: 'cs-st-admin', token: { sub: 'cs-st-admin', email: ADMIN_EMAIL, email_verified: true } },
  unverifiedAdmin: { uid: 'cs-st-unv', token: { sub: 'cs-st-unv', email: ADMIN_EMAIL, email_verified: false } }
};
const OTHER_PATHS = ['shop-orders/probe/receipt.jpg', 'shop-products/probe/1.jpg', 'cer-images/probe.png',
  'scan-mistakes/probe/a.jpg', 'tutor-worksheets/probe.pdf', 'pdf-annotator/probe.pdf', 'mathImages/probe.png',
  'cs-previews/probe/a-0.jpg', 'cs-filesx/probe/a.pdf', 'other/cs-files/a.pdf', 'top-level.txt', 'a/b/c/d/e.png',
  'users/probe/avatar.png'];

function storageCase(path, method, who, expectation, size = 1000) {
  const object = { name: path, bucket: BUCKET, size, contentType: path.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', metadata: {} };
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
      for (const who of ['stranger', 'signedIn', 'admin'])
        out.push({ key: path + '|' + method + '|' + who, make: e => storageCase(path, method, who, e) });
  return out;
}

/** What the /cs folder must answer after the patch. */
export function csExpectations() {
  const file = 'cs-files/probe1234/Notes.pdf';
  const cases = [];
  for (const who of ['stranger', 'signedIn', 'admin', 'unverifiedAdmin'])
    for (const method of ['get', 'list', 'delete']) cases.push(storageCase(file, method, who, 'DENY'));
  for (const who of ['stranger', 'signedIn', 'unverifiedAdmin'])
    for (const method of ['create', 'update']) cases.push(storageCase(file, method, who, 'DENY'));
  cases.push(storageCase(file, 'create', 'admin', 'ALLOW'), storageCase(file, 'update', 'admin', 'ALLOW'));
  cases.push(storageCase(file, 'create', 'admin', 'DENY', MAX_BYTES + 1));
  // Deeper paths (the server's own .parts folder) are never the browser's.
  cases.push(storageCase('cs-files/probe1234/.parts/x-0001', 'create', 'admin', 'DENY'),
    storageCase('cs-files/probe1234/.parts/x-0001', 'get', 'stranger', 'DENY'),
    storageCase('cs-files', 'list', 'stranger', 'DENY'));
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

export async function publishCsStorageRules({ request, deploy = false, readOnly = false }) {
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
    const { results } = await runTests(request, production.source, csExpectations());
    return { mode: readOnly ? 'read' : (deploy ? 'apply' : 'test'), installed: true, changeNeeded: false, holds: results.every(Boolean), outline };
  }
  locateCatchAll(original);
  if (readOnly) return { mode: 'read', installed: false, changeNeeded: true, outline };

  // 1. How do today's rules answer everything else?
  const probes = preservationProbes();
  const today = await runTests(request, production.source, probes.map(p => p.make('ALLOW')));
  const recorded = probes.map((p, i) => p.make(today.results[i] ? 'ALLOW' : 'DENY'));
  const allowedToday = today.results.filter(Boolean).length;

  // 2. The first candidate that keeps all of it and closes cs-files/.
  const where = locateCatchAll(original);
  const tried = [];
  let chosen = null;
  for (const predicate of predicateCandidates(where.variable)) {
    const content = buildCandidate(original, predicate);
    const source = { files: [{ ...files[0], content }] };
    let verdict;
    try {
      const keep = await runTests(request, source, recorded);
      const cs = await runTests(request, source, csExpectations());
      const kept = keep.results.filter(Boolean).length, closed = cs.results.filter(Boolean).length;
      verdict = { predicate, kept: kept + '/' + recorded.length, csCases: closed + '/' + cs.results.length, compileErrors: keep.issues.length + cs.issues.length };
      if (!verdict.compileErrors && kept === recorded.length && closed === cs.results.length) { chosen = { predicate, content, source }; tried.push(verdict); break; }
    } catch (error) {
      verdict = { predicate, error: String(error.message).slice(0, 200) };
    }
    tried.push(verdict);
  }
  const base = { installed: false, changeNeeded: true, probes: recorded.length, allowedToday, tried, outline };
  if (!chosen) throw new Error('No candidate kept every other app\'s Storage access while closing cs-files/; nothing changed. ' + JSON.stringify(base));
  const sourceSha256 = createHash('sha256').update(chosen.content).digest('hex');
  if (!deploy) return { mode: 'test', ...base, predicate: chosen.predicate, sourceSha256 };

  const candidate = await request(`projects/${PROJECT}/rulesets`, { method: 'POST', body: { source: chosen.source } });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime)
    throw new Error('Storage rules changed during validation; retry against current rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Cannot verify the published /cs Storage protection.');
  return { mode: 'apply', changed: true, ...base, predicate: chosen.predicate, previousRuleset: previous.rulesetName, ruleset: candidate.name, sourceSha256 };
}

/** A redacted outline of the Storage rules for the CI log: structure, no string values. */
export function describeStorageRules(source) {
  if (typeof source !== 'string') return { type: typeof source };
  const lines = source.split('\n').map(l => l.trim())
    .filter(l => /^(match|allow|function|service|rules_version|\/\/ (BEGIN|END))/.test(l))
    .map(l => l.replace(/'[^']*'|"[^"]*"/g, "'…'").slice(0, 160));
  return { length: source.length, lines: lines.slice(0, 60), truncated: lines.length > 60 };
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
  const command = new Command('cs:storage-rules').before(requireAuth).action(async () => {
    const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
    const request = async (path, options = {}) => {
      try { return (await client.request({ method: options.method || 'GET', path, ...(options.body ? { body: options.body } : {}),
        skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } })).body; }
      catch (error) { throw new Error('Rules API failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ') on ' + (options.method || 'GET') + ' ' + path.replace(/rulesets\/[\w-]+/, 'rulesets/…') + ': ' + String(error.context?.body?.error?.message || error.message || '').slice(0, 400)); }
    };
    console.log(JSON.stringify(await publishCsStorageRules({ request, deploy: flags.includes('--apply'), readOnly: flags.includes('--read') }), null, 2));
  });
  await command.runner()({ project: PROJECT, projectId: PROJECT, projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
}
