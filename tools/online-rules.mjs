// Narrow migration of the CURRENT shared Firestore rules for Polymath Online
// (online/). It never replaces the shared rules: it inserts one block of
// Polymath Online rules and adds one predicate to the existing catch-all, so
// every other app keeps exactly the permissions it has today.
//
// What it protects (everything else is untouched):
//   onlineCourses   any signed-in account may read; only the three admins write
//   onlineInvites   a link holder may read their invitation and accept it for
//                   themselves; an account may find invitations to its own email;
//                   only the admins create, list, change or delete them
//   onlineMembers   a member reads their own row, creates it only from an
//                   invitation they accepted (same level, role and subjects), and
//                   afterwards can only touch lastSeenAt/photoURL; admins do the rest
//   onlineSettings  admins only
//   mail/polymath-online-*  only the admins can queue an invitation email
//
// Worksheet PDFs and pdfAnnotator documents stay as they are: Ans Key share
// links and the other Polymath apps read them.
//
//   node tools/online-rules.mjs --firebase-tools <dir> --read   is it installed?
//   node tools/online-rules.mjs --firebase-tools <dir>          test only, change nothing
//   node tools/online-rules.mjs --firebase-tools <dir> --apply  test, then publish
//   node tools/online-rules.mjs --setup                         write the CI key file
import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preservedRuleTests, liveRuleTests } from './cer-live-server-rules.mjs';
import { enquiryRuleTests } from './enquiry-rules.mjs';

export const PROJECT = 'mathgen--app';
export const ONLINE_ADMINS = ['chungzhikai@gmail.com', 'elsielcr@gmail.com', 'admin@polymathlc.com.sg'];
export const ONLINE_COLLECTIONS = ['onlineCourses', 'onlineInvites', 'onlineMembers', 'onlineSettings'];

export const ONLINE_RULE = `    // BEGIN polymath-online-v1
    // Polymath Online (polymathlc.com.sg/online): classes, invitations, members
    // and invitation emails. The catch-all below skips these paths.
    function isPolymathOnlinePath() {
      return request.path[3] in ${JSON.stringify(ONLINE_COLLECTIONS).replace(/"/g, "'").replace(/,/g, ', ')}
        || (request.path[3] == 'mail'
          && request.path != /databases/$(request.path[1])/documents/mail
          && request.path[4].matches('^polymath-online-.*$'));
    }
    function onlineEmail() {
      return request.auth.token.get('email', '').lower();
    }
    function isOnlineAdmin() {
      return request.auth != null
        && request.auth.token.get('email_verified', false) == true
        && onlineEmail() in ${JSON.stringify(ONLINE_ADMINS).replace(/"/g, "'").replace(/,/g, ', ')};
    }
    // An invitee accepting their own invitation: only the joining fields change,
    // to themselves, from a pending invitation or one they already accepted.
    function onlineAcceptsInvite() {
      return request.auth != null
        && request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['status', 'joinedUid', 'joinedEmail', 'joinedAt'])
        && request.resource.data.status == 'joined'
        && request.resource.data.joinedUid == request.auth.uid
        && (resource.data.get('status', 'pending') == 'pending'
          || (resource.data.status == 'joined'
            && (resource.data.get('joinedUid', '') == request.auth.uid
              || resource.data.get('joinedEmail', '').lower() == onlineEmail())));
    }
    // A member row written while joining must copy the accepted invitation.
    function onlineJoins(uid) {
      let data = request.resource.data;
      let invite = getAfter(/databases/$(request.path[1])/documents/onlineInvites/$(data.inviteId)).data;
      return request.auth != null && request.auth.uid == uid
        && data.inviteId is string
        && invite.status == 'joined' && invite.joinedUid == uid
        && data.level == invite.level
        && data.role == (invite.get('role', 'student') == 'parent' ? 'parent' : 'student')
        && data.subjects is list && data.subjects.size() > 0
        && data.subjects.hasOnly(invite.subjects)
        && (request.method == 'create'
          ? !data.keys().hasAny(['revoked', 'revokedAt'])
          : !data.diff(resource.data).affectedKeys().hasAny(['revoked', 'revokedAt']));
    }
    // A member opening the portal again only refreshes these two fields.
    function onlineTouches(uid) {
      return request.auth != null && request.auth.uid == uid && request.method == 'update'
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['lastSeenAt', 'photoURL']);
    }
    match /onlineCourses/{courseId} {
      allow read: if request.auth != null;
      allow write: if isOnlineAdmin();
    }
    match /onlineInvites/{inviteId} {
      allow get: if request.auth != null;
      allow list: if isOnlineAdmin()
        || (request.auth != null && resource.data.emailLower == onlineEmail());
      allow create, delete: if isOnlineAdmin();
      allow update: if isOnlineAdmin() || onlineAcceptsInvite();
    }
    match /onlineMembers/{uid} {
      allow get: if isOnlineAdmin() || (request.auth != null && request.auth.uid == uid);
      allow list, delete: if isOnlineAdmin();
      allow create, update: if isOnlineAdmin() || onlineJoins(uid) || onlineTouches(uid);
    }
    match /onlineSettings/{settingsId} {
      allow read, write: if isOnlineAdmin();
    }
    match /mail/{mailId} {
      allow create: if mailId.matches('^polymath-online-.*$') && isOnlineAdmin();
    }
    // END polymath-online-v1

`;

// The shared catch-all is one `allow read, write: if !A() && !B() …;` line.
// Other apps append their own `&& !isXPath()` predicates, so any number of
// them is accepted; only " && !isPolymathOnlinePath()" is added to the end.
// The block goes right above the catch-all's `match /{document=**}`.
const CATCH_ALL = /allow read, write: if !isPermanentStudentHistoryPath\(\) && !isLiveServerPath\(\)((?: && !\w+\(\))*);/g;
const CATCH_ALL_MATCH = /^([ \t]*)match\s+\/\{\w+=\*\*\}\s*\{/m;
const PREDICATE = ' && !isPolymathOnlinePath()';

function count(source, pattern) { return (source.match(pattern) || []).length; }

// A redacted outline of the rules for the CI log when the patch refuses them:
// which markers exist and the catch-all block with string literals hidden.
export function describeRules(source) {
  if (typeof source !== 'string') return { type: typeof source };
  const at = source.search(CATCH_ALL_MATCH);
  let block = '';
  if (at >= 0) {
    let depth = 0, i = source.indexOf('{', at);
    for (let j = i; j < source.length; j++) {
      if (source[j] === '{') depth++;
      if (source[j] === '}' && --depth === 0) { block = source.slice(at, j + 1); break; }
    }
  }
  return {
    length: source.length,
    markers: source.match(/BEGIN [\w-]+/g) || [],
    documentsMatches: count(source, /match\s+\/databases\/\{\w+\}\/documents\s*\{/g),
    catchAllMatches: count(source, /match\s+\/\{\w+=\*\*\}/g),
    catchAllLines: count(source, CATCH_ALL),
    catchAll: block.replace(/'[^']*'|"[^"]*"/g, "'…'")
  };
}

export function addOnlineRules(source) {
  if (typeof source !== 'string' || !source.includes('service cloud.firestore {')
      || count(source, /match\s+\/databases\/\{\w+\}\/documents\s*\{/g) !== 1
      || count(source, /match\s+\/\{\w+=\*\*\}/g) !== 1
      || !source.includes("'cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'"))
    throw new Error('Unrecognized current shared rules; no rules changed.');
  const lines = source.match(CATCH_ALL) || [];
  if (lines.length !== 1)
    throw new Error('Expected one shared catch-all line; review changed rules first.');
  const installed = lines[0].includes(PREDICATE + ';') || lines[0].includes(PREDICATE + ' &&');
  if (installed) {
    if (!source.includes(ONLINE_RULE) || count(source, /BEGIN polymath-online-v1/g) !== 1
        || count(source, /function isPolymathOnlinePath/g) !== 1 || count(source, /isPolymathOnlinePath\(\)/g) !== 2)
      throw new Error('Ambiguous existing Polymath Online protection.');
    return source;
  }
  if (source.includes('polymath-online-v1') || source.includes('isPolymathOnlinePath')
      || /function\s+(isOnlineAdmin|onlineEmail|onlineAcceptsInvite|onlineJoins|onlineTouches)\b/.test(source))
    throw new Error('A partial Polymath Online protection is already there; review changed rules first.');
  const updated = source.replace(CATCH_ALL_MATCH, whole => ONLINE_RULE + whole)
    .replace(CATCH_ALL, line => line.slice(0, -1) + PREDICATE + ';');
  if (updated.replace(ONLINE_RULE, '').replace(PREDICATE + ';', ';') !== source)
    throw new Error('Unrelated rules would change.');
  return updated;
}

/* ================= Permission tests (run by the Rules API) ================= */
const STUDENT = 'online-test-student', OTHER = 'online-test-other', ADMIN = 'online-test-admin';
const TOKENS = {
  [STUDENT]: { email: 'student@example.com', email_verified: true },
  [OTHER]: { email: 'other@example.com', email_verified: true },
  [ADMIN]: { email: 'chungzhikai@gmail.com', email_verified: true },
  'online-test-admin-caps': { email: 'Admin@PolymathLC.com.sg', email_verified: true },
  'online-test-unverified': { email: 'elsielcr@gmail.com', email_verified: false },
  'online-test-anon-provider': {}
};

export function onlineCase(path, method, expectation, uid = null, { data = { test: true }, existing, mocks } = {}) {
  const before = existing === undefined ? data : existing;
  const test = { expectation, request: {
    path: '/databases/(default)/documents/' + path, method,
    auth: uid ? { uid, token: { sub: uid, ...(TOKENS[uid] || {}) } } : null,
    ...(['create', 'update'].includes(method) ? { resource: { data } } : {})
  } };
  if (method !== 'create' && before !== null) test.resource = { data: before };
  if (mocks) test.functionMocks = mocks;
  return test;
}
// getAfter() of the invitation inside the joining batch.
function inviteAfter(invite) {
  return [{ function: 'getAfter', args: [{ anyValue: {} }], result: { value: { data: invite } } }];
}

const PENDING = { email: 'student@example.com', emailLower: 'student@example.com', level: 'P5',
  subjects: ['math', 'science'], role: 'student', status: 'pending' };
const JOINED = { ...PENDING, status: 'joined', joinedUid: STUDENT, joinedEmail: 'student@example.com', joinedAt: 1 };
const MEMBER = { uid: STUDENT, email: 'student@example.com', emailLower: 'student@example.com', name: 'Test',
  role: 'student', level: 'P5', subjects: ['math', 'science'], inviteId: 'invite-1', joinedAt: 1, lastSeenAt: 1 };

export function onlineRuleTests() {
  const cases = [];
  const all = ['get', 'list', 'create', 'update', 'delete'];
  // Nobody signed out touches any of it.
  const paths = ['onlineCourses/course-1', 'onlineInvites/invite-1', 'onlineMembers/' + STUDENT,
    'onlineSettings/main', 'mail/polymath-online-invite-1-2'];
  for (const path of paths)
    for (const method of all) cases.push(onlineCase(path, method, 'DENY', null, { data: path.startsWith('onlineInvites') ? PENDING : { test: true } }));
  // A signed-in session with no email (anonymous or a phone number) is nobody's admin.
  const noEmail = 'online-test-anon-provider';
  for (const method of ['create', 'update', 'delete']) cases.push(onlineCase('onlineCourses/course-1', method, 'DENY', noEmail));
  for (const method of ['list', 'create', 'update', 'delete']) cases.push(onlineCase('onlineInvites/invite-1', method, 'DENY', noEmail, { data: PENDING }));
  for (const path of paths.slice(2))
    for (const method of all) cases.push(onlineCase(path, method, 'DENY', noEmail));
  // Classes: read by any signed-in account, written by admins only.
  for (const uid of [STUDENT, OTHER]) {
    cases.push(onlineCase('onlineCourses/course-1', 'get', 'ALLOW', uid), onlineCase('onlineCourses/course-1', 'list', 'ALLOW', uid));
    for (const method of ['create', 'update', 'delete']) cases.push(onlineCase('onlineCourses/course-1', method, 'DENY', uid));
  }
  for (const uid of [ADMIN, 'online-test-admin-caps'])
    for (const method of all) cases.push(onlineCase('onlineCourses/course-1', method, 'ALLOW', uid));
  for (const method of ['create', 'update', 'delete']) cases.push(onlineCase('onlineCourses/course-1', method, 'DENY', 'online-test-unverified'));
  cases.push(onlineCase('onlineCourses/course-1/nested/child', 'get', 'DENY', ADMIN));

  // Invitations.
  cases.push(
    onlineCase('onlineInvites/invite-1', 'get', 'ALLOW', OTHER, { data: PENDING }),
    onlineCase('onlineInvites/invite-1', 'list', 'ALLOW', STUDENT, { data: PENDING }),
    onlineCase('onlineInvites/invite-1', 'list', 'DENY', OTHER, { data: PENDING }),
    onlineCase('onlineInvites/invite-1', 'list', 'ALLOW', ADMIN, { data: PENDING }),
    onlineCase('onlineInvites/invite-1', 'create', 'DENY', STUDENT, { data: PENDING }),
    onlineCase('onlineInvites/invite-1', 'create', 'ALLOW', ADMIN, { data: PENDING }),
    onlineCase('onlineInvites/invite-1', 'delete', 'DENY', STUDENT, { data: PENDING }),
    onlineCase('onlineInvites/invite-1', 'delete', 'ALLOW', ADMIN, { data: PENDING }),
    onlineCase('onlineInvites/invite-1', 'update', 'ALLOW', ADMIN, { data: { ...PENDING, status: 'revoked' }, existing: PENDING }),
    // Accepting: pending → joined by themselves (any account holding the link).
    onlineCase('onlineInvites/invite-1', 'update', 'ALLOW', STUDENT, { data: JOINED, existing: PENDING }),
    onlineCase('onlineInvites/invite-1', 'update', 'ALLOW', OTHER, { data: { ...JOINED, joinedUid: OTHER, joinedEmail: 'other@example.com' }, existing: PENDING }),
    onlineCase('onlineInvites/invite-1', 'update', 'ALLOW', STUDENT, { data: { ...JOINED, joinedAt: 2 }, existing: JOINED }),
    // …but never for someone else, never a revoked or already-used one, and never other fields.
    onlineCase('onlineInvites/invite-1', 'update', 'DENY', STUDENT, { data: { ...JOINED, joinedUid: OTHER }, existing: PENDING }),
    onlineCase('onlineInvites/invite-1', 'update', 'DENY', STUDENT, { data: JOINED, existing: { ...PENDING, status: 'revoked' } }),
    onlineCase('onlineInvites/invite-1', 'update', 'DENY', OTHER, { data: { ...JOINED, joinedUid: OTHER, joinedEmail: 'other@example.com' }, existing: JOINED }),
    onlineCase('onlineInvites/invite-1', 'update', 'DENY', STUDENT, { data: { ...JOINED, level: 'P6' }, existing: PENDING }),
    onlineCase('onlineInvites/invite-1', 'update', 'DENY', STUDENT, { data: { ...JOINED, subjects: ['math', 'science', 'english'] }, existing: PENDING }),
    onlineCase('onlineInvites/invite-1', 'update', 'DENY', STUDENT, { data: { ...PENDING, status: 'pending', joinedUid: STUDENT }, existing: PENDING })
  );

  // Members.
  const path = 'onlineMembers/' + STUDENT;
  cases.push(
    onlineCase(path, 'get', 'ALLOW', STUDENT, { data: MEMBER }),
    onlineCase(path, 'get', 'DENY', OTHER, { data: MEMBER }),
    onlineCase(path, 'get', 'ALLOW', ADMIN, { data: MEMBER }),
    onlineCase(path, 'list', 'DENY', STUDENT, { data: MEMBER }),
    onlineCase(path, 'list', 'ALLOW', ADMIN, { data: MEMBER }),
    onlineCase(path, 'delete', 'DENY', STUDENT, { data: MEMBER }),
    onlineCase(path, 'delete', 'ALLOW', ADMIN, { data: MEMBER }),
    onlineCase(path, 'update', 'ALLOW', ADMIN, { data: { ...MEMBER, level: 'P6', revoked: true }, existing: MEMBER }),
    // Joining copies the accepted invitation exactly.
    onlineCase(path, 'create', 'ALLOW', STUDENT, { data: MEMBER, mocks: inviteAfter(JOINED) }),
    onlineCase(path, 'create', 'ALLOW', STUDENT, { data: { ...MEMBER, subjects: ['math'] }, mocks: inviteAfter(JOINED) }),
    onlineCase(path, 'update', 'ALLOW', STUDENT, { data: { ...MEMBER, inviteId: 'invite-2' }, existing: MEMBER, mocks: inviteAfter(JOINED) }),
    onlineCase(path, 'create', 'DENY', STUDENT, { data: { ...MEMBER, level: 'P6' }, mocks: inviteAfter(JOINED) }),
    onlineCase(path, 'create', 'DENY', STUDENT, { data: { ...MEMBER, subjects: ['math', 'science', 'english'] }, mocks: inviteAfter(JOINED) }),
    onlineCase(path, 'create', 'DENY', STUDENT, { data: { ...MEMBER, subjects: [] }, mocks: inviteAfter(JOINED) }),
    onlineCase(path, 'create', 'DENY', STUDENT, { data: { ...MEMBER, role: 'parent' }, mocks: inviteAfter(JOINED) }),
    onlineCase(path, 'create', 'DENY', STUDENT, { data: MEMBER, mocks: inviteAfter(PENDING) }),
    onlineCase(path, 'create', 'DENY', STUDENT, { data: MEMBER, mocks: inviteAfter({ ...JOINED, joinedUid: OTHER }) }),
    onlineCase(path, 'create', 'DENY', OTHER, { data: MEMBER, mocks: inviteAfter({ ...JOINED, joinedUid: OTHER }) }),
    onlineCase(path, 'update', 'DENY', STUDENT, { data: { ...MEMBER, revoked: false }, existing: { ...MEMBER, revoked: true }, mocks: inviteAfter(JOINED) }),
    // Coming back only refreshes lastSeenAt and photoURL.
    onlineCase(path, 'update', 'ALLOW', STUDENT, { data: { ...MEMBER, lastSeenAt: 2, photoURL: 'https://example.com/me.png' }, existing: MEMBER, mocks: inviteAfter(PENDING) }),
    onlineCase(path, 'update', 'DENY', STUDENT, { data: { ...MEMBER, level: 'P6' }, existing: MEMBER, mocks: inviteAfter(PENDING) }),
    onlineCase(path, 'update', 'DENY', OTHER, { data: { ...MEMBER, lastSeenAt: 2 }, existing: MEMBER, mocks: inviteAfter(PENDING) })
  );

  // Settings and invitation emails.
  for (const method of all) {
    cases.push(onlineCase('onlineSettings/main', method, 'DENY', STUDENT), onlineCase('onlineSettings/main', method, 'ALLOW', ADMIN));
    cases.push(onlineCase('mail/polymath-online-invite-1-2', method, method === 'create' ? 'ALLOW' : 'DENY', ADMIN));
    cases.push(onlineCase('mail/polymath-online-invite-1-2', method, 'DENY', STUDENT));
  }
  return cases;
}

// Everything around Polymath Online keeps its current permissions.
export function onlinePreservedTests(source) {
  const open = ['studentProfiles/probe', 'pdfAnnotator/probe', 'mail/unrelated-existing-mail',
    'onlineCoursesArchive/probe', 'users/probe/onlineCourses/item', 'users/probe/onlineMembers/item',
    'mail/not-polymath-online-x', 'mailbox/polymath-online-x'];
  const cases = [...preservedRuleTests(source), ...liveRuleTests(),
    ...open.flatMap(path => ['get', 'create', 'update', 'delete'].map(method => onlineCase(path, method, 'ALLOW'))),
  ];
  // With the enquiry protection the whole mail collection is already unlistable.
  if (source.includes('polymath-enquiry-server-only-v1')) cases.push(...enquiryRuleTests());
  else cases.push(onlineCase('mail', 'list', 'ALLOW'));
  return cases;
}

async function validate(request, project, source, tests) {
  for (let offset = 0; offset < tests.length; offset += 100) {
    const batch = tests.slice(offset, offset + 100);
    const result = await request(`projects/${project}:test`, { method: 'POST', body: { source, testSuite: { testCases: batch } } });
    const failed = (result.testResults || []).flatMap((test, index) => test.state === 'SUCCESS' ? [] : [offset + index]);
    if (result.testResults?.length !== batch.length || failed.length || (result.issues || []).some(issue => issue.severity === 'ERROR'))
      throw new Error('Rules tests failed; active rules unchanged: ' + JSON.stringify({ failed, expected: batch.length, received: result.testResults?.length || 0,
        cases: failed.slice(0, 10).map(index => ({ path: tests[index].request.path, method: tests[index].request.method,
          expected: tests[index].expectation, uid: tests[index].request.auth?.uid || null })),
        issues: (result.issues || []).filter(issue => issue.severity === 'ERROR').map(issue => ({ description: issue.description, sourcePosition: issue.sourcePosition })) }));
  }
}

export async function publishOnlineRules({ request, deploy = false, readOnly = false }) {
  if (deploy && readOnly) throw new Error('Read and apply modes are exclusive.');
  const releasePath = `projects/${PROJECT}/releases/cloud.firestore`;
  const previous = await request(releasePath);
  const valid = name => typeof name === 'string' && name.startsWith(`projects/${PROJECT}/rulesets/`) && !name.slice(`projects/${PROJECT}/rulesets/`.length).includes('/');
  if (!valid(previous.rulesetName)) throw new Error('Unexpected current ruleset.');
  const production = await request(previous.rulesetName), files = production.source?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Unexpected current rules files.');
  const original = files[0].content;
  let content;
  try { content = addOnlineRules(original); }
  catch (error) { error.message += ' Current rules outline: ' + JSON.stringify(describeRules(original)); throw error; }
  const changed = original !== content;
  const sourceSha256 = createHash('sha256').update(content).digest('hex');
  if (readOnly) return { mode: 'read', changeNeeded: changed, ruleset: previous.rulesetName, sourceSha256 };
  const source = { files: [{ ...files[0], content }] }, preserved = onlinePreservedTests(original);
  // The preserved expectations must already hold on today's rules, so a
  // surprise in the live rules stops here instead of being "fixed" by us.
  if (changed) await validate(request, PROJECT, production.source, preserved);
  const tests = [...preserved, ...onlineRuleTests()];
  await validate(request, PROJECT, source, tests);
  if (!deploy || !changed) return { mode: deploy ? 'apply' : 'test', changed: false, changeNeeded: changed, validated: tests.length, ruleset: previous.rulesetName, sourceSha256 };
  const candidate = await request(`projects/${PROJECT}/rulesets`, { method: 'POST', body: { source } });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime)
    throw new Error('Active rules changed during validation; retry against current rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Cannot verify published Polymath Online protection.');
  return { mode: 'apply', changed: true, validated: tests.length, previousRuleset: previous.rulesetName, ruleset: candidate.name, sourceSha256 };
}

// GitHub Actions: write the FIREBASE_SERVICE_ACCOUNT key (raw JSON or base64)
// to a private file for the Firebase CLI. Never prints any part of it.
export function setupCredentials({ env = process.env, write = writeFileSync, append = appendFileSync } = {}) {
  const raw = typeof env.FIREBASE_SERVICE_ACCOUNT === 'string' ? env.FIREBASE_SERVICE_ACCOUNT.trim() : '';
  if (!raw) throw new Error('The FIREBASE_SERVICE_ACCOUNT secret is missing.');
  let key = null;
  for (const text of [raw, Buffer.from(raw, 'base64').toString('utf8')]) {
    try { key = JSON.parse(text); break; } catch { /* try the next reading */ }
  }
  if (!key || typeof key !== 'object' || Array.isArray(key) || !key.client_email || !key.private_key)
    throw new Error('The FIREBASE_SERVICE_ACCOUNT secret is not a service-account JSON key.');
  if (!env.RUNNER_TEMP || !env.GITHUB_ENV) throw new Error('This only runs inside GitHub Actions.');
  const keyFile = join(env.RUNNER_TEMP, 'firebase-sa.json');
  write(keyFile, JSON.stringify(key), { mode: 0o600 });
  append(env.GITHUB_ENV, `GOOGLE_APPLICATION_CREDENTIALS=${keyFile}\n`);
  // The account's address is not a secret; it says whose IAM roles apply.
  console.log('Using service account ' + key.client_email);
  return keyFile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (flags.length === 1 && flags[0] === '--setup') {
    setupCredentials();
    console.log('Service-account key ready (not shown).');
  } else {
    const index = flags.indexOf('--firebase-tools');
    const cliRoot = index >= 0 ? flags.splice(index, 2)[1] : null;
    if (!cliRoot || cliRoot.startsWith('--') || flags.length > 1 || flags.some(flag => !['--read', '--apply'].includes(flag)))
      throw new Error('Use --firebase-tools <installed-package-directory>, optionally --read or --apply; or --setup.');
    const require = createRequire(import.meta.url), cli = name => require(resolve(cliRoot, 'lib', name));
    const { Command } = cli('command'), { requireAuth } = cli('requireAuth'), { logger } = cli('logger'), { Client } = cli('apiv2');
    logger.silent = true;
    const command = new Command('online:rules').before(requireAuth).action(async () => {
      const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
      const request = async (path, options = {}) => {
        try { return (await client.request({ method: options.method || 'GET', path, ...(options.body ? { body: options.body } : {}),
          skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } })).body; }
        catch (error) { throw new Error('Rules API failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ') on ' + (options.method || 'GET') + ' ' + path.replace(/rulesets\/[\w-]+/, 'rulesets/…') + ': ' + String(error.context?.body?.error?.message || error.message || '').slice(0, 400)); }
      };
      console.log(JSON.stringify(await publishOnlineRules({ request, deploy: flags.includes('--apply'), readOnly: flags.includes('--read') }), null, 2));
    });
    await command.runner()({ project: PROJECT, projectId: PROJECT, projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
  }
}
