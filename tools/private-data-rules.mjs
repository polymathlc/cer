// 🔒 Close the private collections to signed-out browsers — a narrow migration
// of the CURRENT shared Firestore rules of mathgen--app.
//
// WHY. The shared catch-all is OPEN (read and write) to the whole internet for
// every collection no app has claimed. On 2026-11-18 a plain unauthenticated
// REST call could read every answer a student had ever saved (with their name
// and email), every login, every teacher/student message, prize claims, the
// rosters and every account's private `users/{uid}/…` subtree — and could
// write or delete them too.
//
// WHAT IT DOES. Like the Office, Shop Guard, /cs and trial tools it never
// replaces the shared rules: it inserts one block and adds one predicate to the
// existing catch-all, so every app keeps exactly the permissions it has today
// with ONE exception — a request with no Firebase sign-in at all is refused the
// collections in SIGNED_OUT_LOCKED_COLLECTIONS (and all but create on the
// SIGNED_OUT_CREATE_ONLY_COLLECTIONS). A signed-in account (Google,
// email, or an anonymous Firebase sign-in) keeps every permission it had, so
// the CER portal, Study Buddy, Ans Key, Math, Mindmap, Scan and the rest — all
// of which sign in before they read these — are unaffected. Cloud Functions
// use the Admin SDK and never see rules.
//
//   node tools/private-data-rules.mjs --firebase-tools <dir> --read   is it installed?
//   node tools/private-data-rules.mjs --firebase-tools <dir>          test only, change nothing
//   node tools/private-data-rules.mjs --firebase-tools <dir> --apply  test, then publish
//   node tools/private-data-rules.mjs --firebase-tools <dir> --undo   test, then take it out again
//   node tools/private-data-rules.mjs --setup                         write the CI key file
//   node tools/private-data-rules.mjs --probe                         is a stranger refused? (no key needed)
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { trialPreservedTests, trialRuleTests } from './trial-rules.mjs';
import { csRuleTests } from './cs-rules.mjs';
import { enquiryRuleTests } from './enquiry-rules.mjs';
import { onlineRuleTests, describeRules, setupCredentials } from './online-rules.mjs';
import { accessRuleTests } from './student-access-rules.mjs';
import {
  SIGNED_OUT_LOCK_MARKER, SIGNED_OUT_LOCK_MARKER_V1, SIGNED_OUT_LOCK_FUNCTION,
  SIGNED_OUT_LOCKED_COLLECTIONS, SIGNED_OUT_CREATE_ONLY_COLLECTIONS, V1_LOCKED,
  withSignedOutLock, hasSignedOutLock, signedOutLockVersion
} from './signed-out-lock-core.mjs';

export const PROJECT = 'mathgen--app';
export { SIGNED_OUT_LOCKED_COLLECTIONS, SIGNED_OUT_CREATE_ONLY_COLLECTIONS };
const list = a => JSON.stringify(a).replace(/"/g, "'").replace(/,/g, ', ');

// v1, exactly as it was published on 2026-11-18. Kept byte for byte so the
// tool can recognise it and upgrade it in place (or undo it).
export const LOCK_RULE_V1 = `    // BEGIN ${SIGNED_OUT_LOCK_MARKER_V1}
    // Private data — every account's own subtree, the rosters, and the CER
    // portal's answers, logins, messages, claims and boards. A browser with
    // no Firebase sign-in at all may not read or write them; a signed-in
    // account (including an anonymous sign-in) keeps exactly what the
    // catch-all below already gave it. Installed by tools/private-data-rules.mjs.
    function ${SIGNED_OUT_LOCK_FUNCTION}() {
      return request.auth == null
        && request.path[3] in ${list(V1_LOCKED)};
    }
    // END ${SIGNED_OUT_LOCK_MARKER_V1}

`;

export const LOCK_RULE = `    // BEGIN ${SIGNED_OUT_LOCK_MARKER}
    // Private data — every account's own subtree, the rosters, the CER
    // portal's answers, logins, messages, claims and boards, Rewards, Study
    // Buddy and Scan work. A browser with no Firebase sign-in at all may not
    // read or write them. Public forms (bookings, holiday registrations) may
    // still CREATE a document signed out, but never read, list, change or
    // delete one. A signed-in account (including an anonymous sign-in) keeps
    // exactly what the catch-all below already gave it.
    // Installed by tools/private-data-rules.mjs.
    function ${SIGNED_OUT_LOCK_FUNCTION}() {
      return request.auth == null
        && (request.path[3] in ${list(SIGNED_OUT_LOCKED_COLLECTIONS)}
          || (request.method != 'create'
            && request.path[3] in ${list(SIGNED_OUT_CREATE_ONLY_COLLECTIONS)}));
    }
    // END ${SIGNED_OUT_LOCK_MARKER}

`;

// The same catch-all shape every other narrow patch recognises. Only
// " && !isSignedOutPrivatePath()" is added to its end, so their regexes keep
// matching and any of them can still be installed after this one.
const CATCH_ALL = /allow read, write: if !isPermanentStudentHistoryPath\(\) && !isLiveServerPath\(\)((?: && !\w+\(\))*);/g;
const CATCH_ALL_MATCH = /^([ \t]*)match\s+\/\{\w+=\*\*\}\s*\{/m;
const PREDICATE = ` && !${SIGNED_OUT_LOCK_FUNCTION}()`;
const FN_RE = new RegExp(`function ${SIGNED_OUT_LOCK_FUNCTION}`, 'g');
const CALL_RE = new RegExp(`${SIGNED_OUT_LOCK_FUNCTION}\\(\\)`, 'g');
const anyMarker = source => source.includes(SIGNED_OUT_LOCK_MARKER) || source.includes(SIGNED_OUT_LOCK_MARKER_V1)
  || source.includes(SIGNED_OUT_LOCK_FUNCTION);

function count(source, pattern) { return (source.match(pattern) || []).length; }

function recognise(source) {
  if (typeof source !== 'string' || !source.includes('service cloud.firestore {')
      || count(source, /match\s+\/databases\/\{\w+\}\/documents\s*\{/g) !== 1
      || count(source, /match\s+\/\{\w+=\*\*\}/g) !== 1)
    throw new Error('Unrecognized current shared rules; no rules changed.');
  const lines = source.match(CATCH_ALL) || [];
  if (lines.length !== 1)
    throw new Error('Expected one shared catch-all line; review changed rules first.');
  return lines[0];
}

/** Which lock block is installed, exactly: LOCK_RULE, LOCK_RULE_V1 or null. */
function installedBlock(source, line) {
  const installed = line.includes(PREDICATE + ';') || line.includes(PREDICATE + ' &&');
  if (!installed) return null;
  const version = signedOutLockVersion(source);
  const block = version === 2 ? LOCK_RULE : version === 1 ? LOCK_RULE_V1 : null;
  const marker = version === 2 ? SIGNED_OUT_LOCK_MARKER : SIGNED_OUT_LOCK_MARKER_V1;
  if (!block || !source.includes(block) || count(source, new RegExp('BEGIN ' + marker, 'g')) !== 1
      || (version === 2 && source.includes(SIGNED_OUT_LOCK_MARKER_V1))
      || count(source, FN_RE) !== 1 || count(source, CALL_RE) !== 2)
    throw new Error('Ambiguous existing signed-out lock; review changed rules first.');
  return block;
}

/** Add the lock (or upgrade v1 to v2 in place). Idempotent; refuses anything it does not recognise. */
export function addPrivateDataRules(source) {
  const line = recognise(source);
  const block = installedBlock(source, line);
  if (block === LOCK_RULE) return source;
  if (block === LOCK_RULE_V1) {
    const updated = source.replace(LOCK_RULE_V1, () => LOCK_RULE);
    if (updated.replace(LOCK_RULE, () => LOCK_RULE_V1) !== source || signedOutLockVersion(updated) !== 2)
      throw new Error('Unrelated rules would change.');
    recognise(updated);
    return updated;
  }
  if (anyMarker(source))
    throw new Error('A partial signed-out lock is already there; review changed rules first.');
  const updated = source.replace(CATCH_ALL_MATCH, whole => LOCK_RULE + whole)
    .replace(CATCH_ALL, l => l.slice(0, -1) + PREDICATE + ';');
  if (updated.replace(LOCK_RULE, '').replace(PREDICATE, '') !== source)
    throw new Error('Unrelated rules would change.');
  return updated;
}

/** Take the lock (either version) out again, exactly. Idempotent. */
export function removePrivateDataRules(source) {
  const line = recognise(source);
  const block = installedBlock(source, line);
  if (!block) {
    if (anyMarker(source))
      throw new Error('A partial signed-out lock is there; review changed rules first.');
    return source;
  }
  const updated = source.replace(block, '').replace(CATCH_ALL, l => l.replace(PREDICATE, ''));
  // Exactly the block and the one predicate came out, nothing else.
  if (anyMarker(updated) || source.length - updated.length !== block.length + PREDICATE.length)
    throw new Error('Unrelated rules would change.');
  recognise(updated);
  return updated;
}

/* ================= Permission tests (run by the Rules API) ================= */
const TOKENS = {
  'lock-test-student': { email: 'student@example.com', email_verified: true, firebase: { sign_in_provider: 'password' } },
  'lock-test-admin': { email: 'chungzhikai@gmail.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } },
  'lock-test-anonymous': { firebase: { sign_in_provider: 'anonymous' } }
};
export const SIGNED_IN = Object.keys(TOKENS);

export function lockCase(path, method, expectation, uid = null, { data = { test: true } } = {}) {
  const test = { expectation, request: {
    path: '/databases/(default)/documents/' + path, method,
    auth: uid ? { uid, token: { sub: uid, ...(TOKENS[uid] || {}) } } : null,
    ...(['create', 'update'].includes(method) ? { resource: { data } } : {})
  } };
  if (method !== 'create') test.resource = { data };
  return test;
}

// One document, one nested document and the list for every locked collection.
// `users` gets the real subtrees the apps use, because that is where most of
// the private data sits.
const USER_PATHS = ['users/probe', 'users/probe/settings/profile', 'users/probe/teachingNotes/note',
  'users/probe/questions/q1', 'users/probe/mistakes/m1', 'users/probe/worksheets/w1', 'users/probe/flashcards/f1'];
export function lockedPaths(collections = SIGNED_OUT_LOCKED_COLLECTIONS) {
  const docs = [], lists = [];
  for (const root of collections) {
    if (root === 'users') docs.push(...USER_PATHS);
    else docs.push(root + '/probe', root + '/probe/nested/child');
    lists.push(root, root + '/probe/nested');
  }
  if (collections.includes('users')) lists.push('users/probe/settings', 'users/probe/questions');
  return { docs, lists };
}

/**
 * Signed out: refused everything on a locked collection, and everything but
 * create on a create-only one. Signed in (any provider): still allowed.
 * version 1 tests the v1 list only (to check rules that still carry v1).
 */
export function lockRuleTests(version = 2) {
  const cases = [];
  const data = { name: 'Probe', email: 'probe@example.com', uid: 'probe' };
  const add = (collections, signedOut) => {
    const { docs, lists } = lockedPaths(collections);
    for (const path of docs) {
      for (const method of ['get', 'create', 'update', 'delete']) {
        cases.push(lockCase(path, method, signedOut(method), null, { data }));
        for (const uid of SIGNED_IN) cases.push(lockCase(path, method, 'ALLOW', uid, { data }));
      }
    }
    for (const path of lists) {
      cases.push(lockCase(path, 'list', 'DENY'));
      for (const uid of SIGNED_IN) cases.push(lockCase(path, 'list', 'ALLOW', uid));
    }
  };
  add(version === 1 ? V1_LOCKED : SIGNED_OUT_LOCKED_COLLECTIONS, () => 'DENY');
  if (version >= 2) add(SIGNED_OUT_CREATE_ONLY_COLLECTIONS, method => method === 'create' ? 'ALLOW' : 'DENY');
  return cases;
}

// Paths that must stay exactly as open as the catch-all leaves them, signed
// out: the public schedule / trial / diagnostic pages read schedule_config,
// and look-alike names next to the locked ones prove the predicate is exact
// (a prefix or a near-miss is never caught by it).
export const STILL_OPEN = ['schedule_config/main', 'usersArchive/probe', 'user/probe', 'questionAttemptsX/probe',
  'messagesArchive/probe', 'communityPosts/probe', 'userProfilesOld/probe', 'scienceQuestions/probe', 'pdfAnnotator/probe',
  'studentsArchive/probe', 'schedule_bookingsX/probe', 'claimsOld/probe', 'scanPapersX/probe',
  'rewardsConfig/probe'];

/** Everything else keeps its current permissions, including every other installed protection. */
export function lockPreservedTests(source) {
  const cases = [...trialPreservedTests(source)];
  if (source.includes('polymath-trial-v1')) cases.push(...trialRuleTests());
  if (source.includes('polymath-cs-server-only-v1')) cases.push(...csRuleTests());
  if (source.includes('polymath-enquiry-server-only-v1')) cases.push(...enquiryRuleTests());
  if (source.includes('polymath-online-v1')) cases.push(...onlineRuleTests());
  if (source.includes('polymath-student-access-v1')) cases.push(...accessRuleTests());
  for (const path of STILL_OPEN)
    for (const method of ['get', 'create', 'update', 'delete']) cases.push(lockCase(path, method, 'ALLOW'));
  return withSignedOutLock(source, cases);
}

/** De-duplicate by request + expectation (the preserved sets overlap). */
export function uniqueCases(cases) {
  const seen = new Set();
  return cases.filter(c => {
    const key = JSON.stringify([c.expectation, c.request.path, c.request.method, c.request.auth?.uid || null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function validate(request, source, tests) {
  for (let offset = 0; offset < tests.length; offset += 100) {
    const batch = tests.slice(offset, offset + 100);
    const result = await request(`projects/${PROJECT}:test`, { method: 'POST', body: { source, testSuite: { testCases: batch } } });
    const failed = (result.testResults || []).flatMap((test, index) => test.state === 'SUCCESS' ? [] : [offset + index]);
    if (result.testResults?.length !== batch.length || failed.length || (result.issues || []).some(issue => issue.severity === 'ERROR'))
      throw new Error('Rules tests failed; active rules unchanged: ' + JSON.stringify({ failed: failed.length, expected: batch.length, received: result.testResults?.length || 0,
        cases: failed.slice(0, 10).map(index => ({ path: tests[index].request.path, method: tests[index].request.method,
          expected: tests[index].expectation, uid: tests[index].request.auth?.uid || null })),
        issues: (result.issues || []).filter(issue => issue.severity === 'ERROR').map(issue => ({ description: issue.description, sourcePosition: issue.sourcePosition })) }));
  }
}

/**
 * mode: 'read' | 'test' | 'apply' | 'undo'. Every mode except 'read' runs the
 * full permission suite through the Rules API first; nothing is published
 * unless every case passes, and never over rules that changed meanwhile.
 */
export async function publishPrivateDataRules({ request, mode = 'test' }) {
  if (!['read', 'test', 'apply', 'undo'].includes(mode)) throw new Error('Unknown mode ' + mode);
  const releasePath = `projects/${PROJECT}/releases/cloud.firestore`;
  const previous = await request(releasePath);
  const valid = name => typeof name === 'string' && name.startsWith(`projects/${PROJECT}/rulesets/`) && !name.slice(`projects/${PROJECT}/rulesets/`.length).includes('/');
  if (!valid(previous.rulesetName)) throw new Error('Unexpected current ruleset.');
  const production = await request(previous.rulesetName), files = production.source?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Unexpected current rules files.');
  const original = files[0].content;
  let content;
  try { content = mode === 'undo' ? removePrivateDataRules(original) : addPrivateDataRules(original); }
  catch (error) { error.message += ' Current rules outline: ' + JSON.stringify(describeRules(original)); throw error; }
  const changed = original !== content;
  const sourceSha256 = createHash('sha256').update(content).digest('hex');
  const installed = hasSignedOutLock(original);
  const installedVersion = signedOutLockVersion(original);
  if (mode === 'read') return { mode, installed, installedVersion, changeNeeded: changed, ruleset: previous.rulesetName, sourceSha256 };

  const source = { files: [{ ...files[0], content }] };
  // Today's expectations must already hold on today's rules, so a surprise in
  // the live rules stops here instead of being "fixed" by us.
  const before = uniqueCases(installed
    ? [...lockPreservedTests(original), ...lockRuleTests(installedVersion)]
    : lockPreservedTests(original));
  if (changed) await validate(request, production.source, before);
  const after = uniqueCases(mode === 'undo'
    ? lockPreservedTests(content)
    : [...lockPreservedTests(content), ...lockRuleTests()]);
  await validate(request, source, after);
  const publish = (mode === 'apply' || mode === 'undo') && changed;
  if (!publish) return { mode, installed, changed: false, changeNeeded: changed, validated: after.length, ruleset: previous.rulesetName, sourceSha256 };

  const candidate = await request(`projects/${PROJECT}/rulesets`, { method: 'POST', body: { source } });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime)
    throw new Error('Active rules changed during validation; retry against current rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Cannot verify the published rules.');
  return { mode, installed: mode === 'apply', changed: true, validated: after.length, previousRuleset: previous.rulesetName, ruleset: candidate.name, sourceSha256 };
}

/* ================= The outside view: is a stranger refused? ================= */
// The Rules API proves the rules; this proves what the internet sees. It makes
// plain, key-less REST reads of a few locked collections with no sign-in at
// all, exactly as anybody could. Read only; nothing is written. Rules take up
// to a minute to reach every server, so it retries for a while.
export const PROBE_COLLECTIONS = ['questionAttempts', 'loginEvents', 'messages', 'users', 'userProfiles', 'students', 'schedule_bookings'];

export async function probeStranger({ fetchImpl = fetch, attempts = 12, waitMs = 10000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/`;
  let last = {};
  for (let i = 0; i < attempts; i++) {
    last = {};
    for (const name of PROBE_COLLECTIONS) {
      // No field mask: Firestore answers 400 to a mask it cannot parse, which
      // would hide the 403 this is looking for.
      const response = await fetchImpl(base + name + '?pageSize=1');
      last[name] = response.status;
    }
    if (Object.values(last).every(status => status === 403)) return { refused: true, statuses: last, attempts: i + 1 };
    if (i < attempts - 1) await sleep(waitMs);
  }
  return { refused: false, statuses: last, attempts };
}

export { setupCredentials };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (flags.length === 1 && flags[0] === '--setup') {
    setupCredentials();
    console.log('Service-account key ready (not shown).');
  } else if (flags.length === 1 && flags[0] === '--probe') {
    console.log(JSON.stringify(await probeStranger(), null, 2));
  } else {
    const index = flags.indexOf('--firebase-tools');
    const cliRoot = index >= 0 ? flags.splice(index, 2)[1] : null;
    const modes = { '--read': 'read', '--apply': 'apply', '--undo': 'undo' };
    if (!cliRoot || cliRoot.startsWith('--') || flags.length > 1 || flags.some(flag => !modes[flag]))
      throw new Error('Use --firebase-tools <installed-package-directory>, optionally --read, --apply or --undo; or --setup; or --probe.');
    const mode = flags.length ? modes[flags[0]] : 'test';
    const require = createRequire(import.meta.url), cli = name => require(resolve(cliRoot, 'lib', name));
    const { Command } = cli('command'), { requireAuth } = cli('requireAuth'), { logger } = cli('logger'), { Client } = cli('apiv2');
    logger.silent = true;
    const command = new Command('private-data:rules').before(requireAuth).action(async () => {
      const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
      const request = async (path, options = {}) => {
        try { return (await client.request({ method: options.method || 'GET', path, ...(options.body ? { body: options.body } : {}),
          skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } })).body; }
        catch (error) { throw new Error('Rules API failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ') on ' + (options.method || 'GET') + ' ' + path.replace(/rulesets\/[\w-]+/, 'rulesets/…') + ': ' + String(error.context?.body?.error?.message || error.message || '').slice(0, 400)); }
      };
      console.log(JSON.stringify(await publishPrivateDataRules({ request, mode }), null, 2));
    });
    await command.runner()({ project: PROJECT, projectId: PROJECT, projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
  }
}
