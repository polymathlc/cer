// Narrow migration of the CURRENT shared Firestore rules for the student access
// approvals (student/access-gate.js and the admin dashboard at
// polymathlc.com.sg/student/#admin). It never replaces the shared rules: it
// inserts one block of rules and adds one predicate to the existing catch-all,
// so every other app keeps exactly the permissions it has today.
//
// WHY THE GATE WAITS FOR THIS. The shared catch-all is
// `allow read, write: if !A() && !B() …` — OPEN to the whole internet for any
// collection it does not name. Without this block every parent's name and email
// in `studentAccess` would be readable by anybody, and any student could write
// "approved" on their own record. The gate checks this itself (a signed-out read
// of studentAccess must be refused) and stays switched off until it is.
//
// What it protects (everything else is untouched):
//   studentAccess/{uid}      one record per signed-in account     the account may GET its
//                            (parent, children, levels,           own record and send its own
//                            subjects, status)                    form, always as "pending";
//                                                                  only the access admins may
//                                                                  list, approve, revoke,
//                                                                  edit or delete
//   mail/polymath-access-*   "new access request" email to the    the account may queue up
//                            centre                               to nine, to the centre only;
//                                                                  only the admins read them
//
//   node tools/student-access-rules.mjs --firebase-tools <dir> --read   is it installed?
//   node tools/student-access-rules.mjs --firebase-tools <dir>          test only, change nothing
//   node tools/student-access-rules.mjs --firebase-tools <dir> --apply  test, then publish
//   node tools/student-access-rules.mjs --setup                         write the CI key file
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preservedRuleTests, liveRuleTests } from './cer-live-server-rules.mjs';
import { enquiryRuleTests } from './enquiry-rules.mjs';
import { onlineRuleTests, describeRules, setupCredentials, ONLINE_RULE } from './online-rules.mjs';
import { csRuleTests } from './cs-rules.mjs';
import { officeRuleTests, OFFICE_RULE } from './office-rules.mjs';

export const PROJECT = 'mathgen--app';
// Keep equal to ACCESS_ADMINS in student/access-gate.js (a test checks).
// These three are also the only accounts that can open the admin dashboard.
export const ACCESS_ADMINS = ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg'];
// Admin lists an installed block may still carry. A block written for one of
// these (and otherwise identical) is upgraded in place to ACCESS_ADMINS.
export const ACCESS_PREVIOUS_ADMINS = [];
export const ACCESS_COLLECTION = 'studentAccess';
export const ACCESS_MAIL_PREFIX = 'polymath-access-';
// The one email a student's form may queue: to the centre, from the centre.
// Keep equal to ACCESS_MAIL in student/access-gate.js (a test checks).
export const ACCESS_MAIL = {
  to: ['admin@polymathlc.com.sg'],
  cc: ['support@polymathlc.com.sg'],
  from: 'Polymath Learning Centre <admin@polymathlc.com.sg>'
};
// Every field a student's own form carries — no more, no fewer.
export const FORM_FIELDS = ['uid', 'email', 'status', 'enrolled', 'parentName', 'parentEmail',
  'childCount', 'children', 'submittedAt', 'app', 'submissions'];
export const MAX_CHILDREN = 8;
const list = a => JSON.stringify(a).replace(/"/g, "'").replace(/,/g, ', ');

export function accessRuleFor(admins) {
  return `    // BEGIN polymath-student-access-v1
    // Student access approvals (polymathlc.com.sg/student): one record per
    // signed-in account. The account may read its own record and send its own
    // enrolment form, always as "pending"; only the access admins may list,
    // approve, revoke, edit or delete. The catch-all below skips these paths.
    function isPolymathStudentAccessPath() {
      return request.path[3] == '${ACCESS_COLLECTION}'
        || (request.path[3] == 'mail'
          && request.path != /databases/$(request.path[1])/documents/mail
          && request.path[4].matches('^${ACCESS_MAIL_PREFIX}.*$'));
    }
    function isStudentAccessAdmin() {
      return request.auth != null
        && request.auth.token.get('email_verified', false) == true
        && request.auth.token.get('email', '').lower() in ${list(admins)};
    }
    function isOwnStudentAccessForm(uid) {
      return request.auth != null && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(${list(FORM_FIELDS)})
        && request.resource.data.keys().hasAll(${list(FORM_FIELDS)})
        && request.resource.data.uid == uid
        && request.resource.data.status == 'pending'
        && request.resource.data.enrolled == true
        && request.resource.data.email is string && request.resource.data.email.size() <= 200
        && request.resource.data.parentName is string
        && request.resource.data.parentName.size() >= 2 && request.resource.data.parentName.size() <= 120
        && request.resource.data.parentEmail is string && request.resource.data.parentEmail.size() <= 200
        && request.resource.data.parentEmail.matches('^[^@ ]+@[^@ ]+[.][^@ ]+$')
        && request.resource.data.childCount is number
        && request.resource.data.childCount >= 1 && request.resource.data.childCount <= ${MAX_CHILDREN}
        && request.resource.data.children is list
        && request.resource.data.children.size() == request.resource.data.childCount
        && request.resource.data.submittedAt != null
        && request.resource.data.app is string && request.resource.data.app.size() <= 40
        && request.resource.data.submissions is number
        && request.resource.data.submissions >= 1 && request.resource.data.submissions <= 50;
    }
    match /${ACCESS_COLLECTION}/{uid} {
      allow get: if request.auth != null && (request.auth.uid == uid || isStudentAccessAdmin());
      allow list, delete: if isStudentAccessAdmin();
      allow create: if isStudentAccessAdmin() || isOwnStudentAccessForm(uid);
      allow update: if isStudentAccessAdmin()
        || (resource.data.get('status', '') in ['pending', 'revoked'] && isOwnStudentAccessForm(uid));
    }
    // The "new access request" email: only to the centre, from the centre,
    // plain text, at most nine per account; never read back by the student.
    match /mail/{mailId} {
      allow create: if request.auth != null
        && mailId.matches('^${ACCESS_MAIL_PREFIX}' + request.auth.uid + '-[1-9]$')
        && request.resource.data.keys().hasOnly(['to', 'cc', 'from', 'replyTo', 'message'])
        && request.resource.data.to == ${list(ACCESS_MAIL.to)}
        && request.resource.data.cc == ${list(ACCESS_MAIL.cc)}
        && request.resource.data.from == '${ACCESS_MAIL.from}'
        && request.resource.data.replyTo is string && request.resource.data.replyTo.size() <= 200
        && request.resource.data.message.keys().hasOnly(['subject', 'text'])
        && request.resource.data.message.subject is string && request.resource.data.message.subject.size() <= 200
        && request.resource.data.message.text is string && request.resource.data.message.text.size() <= 6000;
      allow get: if mailId.matches('^${ACCESS_MAIL_PREFIX}.*$') && isStudentAccessAdmin();
    }
    // END polymath-student-access-v1

`;
}
export const ACCESS_RULE = accessRuleFor(ACCESS_ADMINS);

// The shared catch-all is one `allow read, write: if !A() && !B() …;` line.
// Other apps append their own `&& !isXPath()` predicates, so any number of them
// is accepted; only " && !isPolymathStudentAccessPath()" is added to the end.
// The block goes right above the catch-all's `match /{document=**}`.
const CATCH_ALL = /allow read, write: if !isPermanentStudentHistoryPath\(\) && !isLiveServerPath\(\)((?: && !\w+\(\))*);/g;
const CATCH_ALL_MATCH = /^([ \t]*)match\s+\/\{\w+=\*\*\}\s*\{/m;
export const PREDICATE = ' && !isPolymathStudentAccessPath()';

function count(source, pattern) { return (source.match(pattern) || []).length; }

export function addStudentAccessRules(source) {
  if (typeof source !== 'string' || !source.includes('service cloud.firestore {')
      || count(source, /match\s+\/databases\/\{\w+\}\/documents\s*\{/g) !== 1
      || count(source, /match\s+\/\{\w+=\*\*\}/g) !== 1
      || !source.includes("'cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'"))
    throw new Error('Unrecognized current shared rules; no rules changed.');
  const lines = source.match(CATCH_ALL) || [];
  if (lines.length !== 1)
    throw new Error('Expected one shared catch-all line; review changed rules first.');
  const installed = lines[0].includes(PREDICATE + ';') || lines[0].includes(PREDICATE + ' &&');
  const wellFormed = s => count(s, /BEGIN polymath-student-access-v1/g) === 1
    && count(s, /function isPolymathStudentAccessPath/g) === 1 && count(s, /isPolymathStudentAccessPath\(\)/g) === 2;
  if (installed && !source.includes(ACCESS_RULE)) {
    // An older admin list: swap the one block, nothing else.
    const prev = ACCESS_PREVIOUS_ADMINS.map(accessRuleFor).find(rule => source.includes(rule));
    if (prev && wellFormed(source)) {
      const upgraded = source.replace(prev, () => ACCESS_RULE);
      if (upgraded.replace(ACCESS_RULE, () => prev) !== source) throw new Error('Unrelated rules would change.');
      return upgraded;
    }
  }
  if (installed) {
    if (!source.includes(ACCESS_RULE) || !wellFormed(source))
      throw new Error('Ambiguous existing student access protection.');
    return source;
  }
  if (source.includes('polymath-student-access-v1') || source.includes('isPolymathStudentAccessPath')
      || /function\s+isStudentAccessAdmin\b/.test(source) || /match\s+\/studentAccess\//.test(source))
    throw new Error('A partial student access protection is already there; review changed rules first.');
  const updated = source.replace(CATCH_ALL_MATCH, whole => ACCESS_RULE + whole)
    .replace(CATCH_ALL, line => line.slice(0, -1) + PREDICATE + ';');
  if (updated.replace(ACCESS_RULE, '').replace(PREDICATE + ';', ';') !== source)
    throw new Error('Unrelated rules would change.');
  return updated;
}

/* ================= Permission tests (run by the Rules API) ================= */
const STUDENT = 'access-test-student', OTHER = 'access-test-other', ADMIN = 'access-test-admin';
const TOKENS = {
  [STUDENT]: { email: 'student@example.com', email_verified: true },
  [OTHER]: { email: 'other@example.com', email_verified: true },
  'access-test-email-account': { email: 'tan.student@polymath.example', email_verified: false },
  [ADMIN]: { email: 'chungzhikai@gmail.com', email_verified: true },
  'access-test-admin-caps': { email: 'Admin@PolymathLC.com.sg', email_verified: true },
  'access-test-admin-support': { email: 'support@polymathlc.com.sg', email_verified: true },
  'access-test-office-only': { email: 'elsielcr@gmail.com', email_verified: true },
  'access-test-unverified': { email: 'chungzhikai@gmail.com', email_verified: false },
  'access-test-anon-provider': {}
};
const ADMINS = [ADMIN, 'access-test-admin-caps', 'access-test-admin-support'];
const NOT_ADMINS = [null, STUDENT, OTHER, 'access-test-office-only', 'access-test-unverified', 'access-test-anon-provider'];

export function accessCase(path, method, expectation, uid = null, { data = { test: true }, existing } = {}) {
  const before = existing === undefined ? data : existing;
  const test = { expectation, request: {
    path: '/databases/(default)/documents/' + path, method,
    auth: uid ? { uid, token: { sub: uid, ...(TOKENS[uid] || {}) } } : null,
    ...(['create', 'update'].includes(method) ? { resource: { data } } : {})
  } };
  if (method !== 'create' && before !== null) test.resource = { data: before };
  return test;
}

export function sampleForm(uid, overrides = {}) {
  return {
    uid, email: (TOKENS[uid] && TOKENS[uid].email) || '', status: 'pending', enrolled: true,
    parentName: 'Probe Parent', parentEmail: 'parent@example.com', childCount: 2,
    children: [{ name: 'Probe Child One', level: 'P5', subjects: 'both' }, { name: 'Probe Child Two', level: 'P3', subjects: 'math' }],
    submittedAt: '2026-11-13T10:00:00.000Z', app: 'student', submissions: 1, ...overrides
  };
}
export function sampleMail(overrides = {}) {
  return { to: [...ACCESS_MAIL.to], cc: [...ACCESS_MAIL.cc], from: ACCESS_MAIL.from, replyTo: 'parent@example.com',
    message: { subject: 'New student access request', text: 'Probe Parent asks for access.' }, ...overrides };
}

export function accessRuleTests() {
  const cases = [];
  const own = 'studentAccess/' + STUDENT;
  const form = sampleForm(STUDENT);
  const approved = { ...form, status: 'approved', decidedBy: 'chungzhikai@gmail.com' };
  const revoked = { ...form, status: 'revoked', decidedBy: 'chungzhikai@gmail.com' };

  // The student: reads only their own record, sends only their own pending form.
  cases.push(accessCase(own, 'get', 'ALLOW', STUDENT));
  cases.push(accessCase(own, 'create', 'ALLOW', STUDENT, { data: form }));
  cases.push(accessCase(own, 'update', 'ALLOW', STUDENT, { data: { ...form, submissions: 2 }, existing: form }));
  cases.push(accessCase(own, 'update', 'ALLOW', STUDENT, { data: { ...form, submissions: 2 }, existing: revoked }));  // a paused account may ask again
  cases.push(accessCase(own, 'update', 'DENY', STUDENT, { data: { ...form, submissions: 2 }, existing: approved }));
  for (const bad of [
    { status: 'approved' }, { status: 'staff' }, { enrolled: false }, { uid: OTHER }, { childCount: 0 },
    { childCount: 9, children: Array.from({ length: 9 }, () => ({ name: 'x', level: 'P1', subjects: 'math' })) },
    { childCount: 3 }, { parentName: 'X' }, { parentEmail: 'not an email' }, { submissions: 0 }
  ]) cases.push(accessCase(own, 'create', 'DENY', STUDENT, { data: { ...form, ...bad } }));
  cases.push(accessCase(own, 'create', 'DENY', STUDENT, { data: { ...form, role: 'staff' } }));  // no admin-only field
  cases.push(accessCase(own, 'create', 'DENY', STUDENT, { data: { ...form, decidedBy: 'me' } }));
  const { app, ...missing } = form;
  cases.push(accessCase(own, 'create', 'DENY', STUDENT, { data: missing }));  // every form field is there
  for (const method of ['list', 'delete']) cases.push(accessCase(own, method, 'DENY', STUDENT));
  cases.push(accessCase('studentAccess', 'list', 'DENY', STUDENT));
  // An email/password account (never verified) sends its own form too.
  const emailAccount = 'access-test-email-account';
  cases.push(accessCase('studentAccess/' + emailAccount, 'create', 'ALLOW', emailAccount, { data: sampleForm(emailAccount) }));

  // Somebody else's record: never.
  for (const uid of [null, OTHER, 'access-test-office-only', 'access-test-unverified', 'access-test-anon-provider'])
    for (const method of ['get', 'list', 'create', 'update', 'delete'])
      cases.push(accessCase(own, method, 'DENY', uid, { data: form }));
  cases.push(accessCase(own, 'create', 'DENY', OTHER, { data: sampleForm(OTHER, { uid: STUDENT }) }));
  // Nested paths are never open.
  for (const uid of [STUDENT, ADMIN]) cases.push(accessCase(own + '/nested/child', 'get', 'DENY', uid));

  // The three admins do everything — approve, revoke, edit, list, delete.
  for (const uid of ADMINS) {
    for (const method of ['get', 'list', 'create', 'update', 'delete'])
      cases.push(accessCase(own, method, 'ALLOW', uid, { data: approved, existing: form }));
    cases.push(accessCase('studentAccess', 'list', 'ALLOW', uid));
  }
  for (const uid of NOT_ADMINS) cases.push(accessCase('studentAccess', 'list', 'DENY', uid));

  // The "new access request" email.
  const mail = 'mail/' + ACCESS_MAIL_PREFIX + STUDENT + '-1';
  cases.push(accessCase(mail, 'create', 'ALLOW', STUDENT, { data: sampleMail() }));
  cases.push(accessCase('mail/' + ACCESS_MAIL_PREFIX + STUDENT + '-9', 'create', 'ALLOW', STUDENT, { data: sampleMail() }));
  for (const [path, data] of [
    ['mail/' + ACCESS_MAIL_PREFIX + OTHER + '-1', sampleMail()],
    ['mail/' + ACCESS_MAIL_PREFIX + STUDENT + '-10', sampleMail()],
    ['mail/' + ACCESS_MAIL_PREFIX + STUDENT, sampleMail()],
    [mail, sampleMail({ to: ['someone@example.com'] })],
    [mail, sampleMail({ to: ['admin@polymathlc.com.sg', 'someone@example.com'] })],
    [mail, sampleMail({ cc: [] })],
    [mail, sampleMail({ from: 'Someone <someone@example.com>' })],
    [mail, sampleMail({ bcc: ['someone@example.com'] })],
    [mail, sampleMail({ message: { subject: 'x', html: '<a href="x">x</a>' } })]
  ]) cases.push(accessCase(path, 'create', 'DENY', STUDENT, { data }));
  cases.push(accessCase(mail, 'create', 'DENY', null, { data: sampleMail() }));
  for (const method of ['get', 'update', 'delete']) cases.push(accessCase(mail, method, 'DENY', STUDENT, { data: sampleMail() }));
  for (const uid of ADMINS) cases.push(accessCase(mail, 'get', 'ALLOW', uid, { data: sampleMail() }));
  for (const uid of ADMINS) for (const method of ['update', 'delete']) cases.push(accessCase(mail, method, 'DENY', uid, { data: sampleMail() }));
  return cases;
}

// Everything around the student access block keeps its current permissions.
export function accessPreservedTests(source) {
  const open = ['studentProfiles/probe', 'pdfAnnotator/probe', 'mail/unrelated-existing-mail',
    'studentAccessArchive/probe', 'access/probe', 'users/probe/studentAccess/item',
    'mail/not-polymath-access-x', 'mailbox/polymath-access-x', 'schedule_config/main', 'shop_orders/probe'];
  const cases = [...preservedRuleTests(source), ...liveRuleTests(),
    ...open.flatMap(path => ['get', 'create', 'update', 'delete'].map(method => accessCase(path, method, 'ALLOW')))];
  // Other apps' narrow protections, if they are installed, must still hold.
  if (source.includes('polymath-enquiry-server-only-v1')) cases.push(...enquiryRuleTests());
  else cases.push(accessCase('mail', 'list', 'ALLOW'));
  // Online's and Office's own cases expect THEIR current admin lists; a block still
  // carrying an older list (its own workflow not re-run yet) is left to that workflow.
  if (source.includes(ONLINE_RULE)) cases.push(...onlineRuleTests());
  if (source.includes('polymath-cs-server-only-v1')) cases.push(...csRuleTests());
  if (source.includes(OFFICE_RULE)) cases.push(...officeRuleTests());
  return cases;
}

async function validate(request, project, source, tests) {
  for (let offset = 0; offset < tests.length; offset += 100) {
    const batch = tests.slice(offset, offset + 100);
    const result = await request(`projects/${project}:test`, { method: 'POST', body: { source, testSuite: { testCases: batch } } });
    const failed = (result.testResults || []).flatMap((test, index) => test.state === 'SUCCESS' ? [] : [offset + index]);
    if (result.testResults?.length !== batch.length || failed.length || (result.issues || []).some(issue => issue.severity === 'ERROR'))
      throw new Error('Rules tests failed; active rules unchanged: ' + JSON.stringify({ failed: failed.length, expected: batch.length, received: result.testResults?.length || 0,
        cases: failed.slice(0, 10).map(index => ({ path: tests[index].request.path, method: tests[index].request.method,
          expected: tests[index].expectation, uid: tests[index].request.auth?.uid || null })),
        issues: (result.issues || []).filter(issue => issue.severity === 'ERROR').map(issue => ({ description: issue.description, sourcePosition: issue.sourcePosition })) }));
  }
}

export async function publishStudentAccessRules({ request, deploy = false, readOnly = false }) {
  if (deploy && readOnly) throw new Error('Read and apply modes are exclusive.');
  const releasePath = `projects/${PROJECT}/releases/cloud.firestore`;
  const previous = await request(releasePath);
  const valid = name => typeof name === 'string' && name.startsWith(`projects/${PROJECT}/rulesets/`) && !name.slice(`projects/${PROJECT}/rulesets/`.length).includes('/');
  if (!valid(previous.rulesetName)) throw new Error('Unexpected current ruleset.');
  const production = await request(previous.rulesetName), files = production.source?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Unexpected current rules files.');
  const original = files[0].content;
  let content;
  try { content = addStudentAccessRules(original); }
  catch (error) { error.message += ' Current rules outline: ' + JSON.stringify(describeRules(original)); throw error; }
  const changed = original !== content;
  const sourceSha256 = createHash('sha256').update(content).digest('hex');
  if (readOnly) return { mode: 'read', changeNeeded: changed, ruleset: previous.rulesetName, sourceSha256 };
  const source = { files: [{ ...files[0], content }] }, preserved = accessPreservedTests(original);
  // The preserved expectations must already hold on today's rules, so a surprise
  // in the live rules stops here instead of being "fixed" by us.
  if (changed) await validate(request, PROJECT, production.source, preserved);
  const tests = [...preserved, ...accessRuleTests()];
  await validate(request, PROJECT, source, tests);
  if (!deploy || !changed) return { mode: deploy ? 'apply' : 'test', changed: false, changeNeeded: changed, validated: tests.length, ruleset: previous.rulesetName, sourceSha256 };
  const candidate = await request(`projects/${PROJECT}/rulesets`, { method: 'POST', body: { source } });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime)
    throw new Error('Active rules changed during validation; retry against current rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Cannot verify published student access protection.');
  return { mode: 'apply', changed: true, validated: tests.length, previousRuleset: previous.rulesetName, ruleset: candidate.name, sourceSha256 };
}

export { setupCredentials };

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
    const command = new Command('student-access:rules').before(requireAuth).action(async () => {
      const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
      const request = async (path, options = {}) => {
        try { return (await client.request({ method: options.method || 'GET', path, ...(options.body ? { body: options.body } : {}),
          skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } })).body; }
        catch (error) { throw new Error('Rules API failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ') on ' + (options.method || 'GET') + ' ' + path.replace(/rulesets\/[\w-]+/, 'rulesets/…') + ': ' + String(error.context?.body?.error?.message || error.message || '').slice(0, 400)); }
      };
      console.log(JSON.stringify(await publishStudentAccessRules({ request, deploy: flags.includes('--apply'), readOnly: flags.includes('--read') }), null, 2));
    });
    await command.runner()({ project: PROJECT, projectId: PROJECT, projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
  }
}
