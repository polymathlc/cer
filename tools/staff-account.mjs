// Is Polymath's EMPLOYEE account (Keertana) set up as an employee — able to add
// questions in the learning portals, never an admin, never a student?
//
// Zhi Kai, 14 Nov 2026: "This should be an employee account. Check if it can access
// the question adding for the learning portals. Make sure it's an employee account
// and not admin."
//
// What decides it, app by app (every one of them is on the shared mathgen--app project):
//   Science (cer app.js), English, Chinese  EMPLOYEE_EMAILS in the app → the employee menu
//                                            (Create, Bank, Vetting, …), authoring into the
//                                            teacher's bank; Firestore rules decide the write.
//   Math (polymathlc/math)                  EMPLOYEE_EMAILS in index.html, and the rules
//                                            trust only the `employee: true` claim, which the
//                                            grantEmployeeRole function gives ONLY to an
//                                            account whose email is VERIFIED.
//   /student gate (student/access-gate.js)  staff are never asked — again only when the
//                                            email is verified. An unverified sign-in was
//                                            asked to enrol, and that is how the employee
//                                            came to be listed as a P3 "student".
//
//   node tools/staff-account.mjs            read only: prints what the account can do now
//   node tools/staff-account.mjs --fix      marks the address verified, sets the employee
//                                            claim (and takes any admin claim off), removes
//                                            the student request and the Online row that the
//                                            approval made for it; then prints the check again
//
// Needs GOOGLE_APPLICATION_CREDENTIALS and STAFF_DEPS=<dir with node_modules/firebase-admin>.
// The Actions log of this repository is public: it prints yes/no answers and counts only —
// never the uid, the address or any question text.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'mathgen--app';
// Keep equal to EMPLOYEE_EMAILS in app.js (Science), and in the Math, English and
// Chinese apps (a test checks the one in this repository).
export const EMPLOYEE_EMAILS = ['pkeertana21@gmail.com'];
// Keep equal to ADMIN_EMAILS in app.js: an employee must never be on it.
export const ADMIN_EMAILS = ['chungzhikai@gmail.com', 'abigail.yew@stanfordmanpower.com'];

// The question bank of each learning portal, under the teacher's uid. An employee
// authors straight into it (create a question, or send one to vetting).
export const BANKS = [
  { app: 'Science', questions: 'questions', vetting: 'vetting' },
  { app: 'Math', questions: 'mathQuestions', vetting: 'mathVetting' },
  { app: 'English', questions: 'questionsEn', vetting: 'vettingEn' },
  { app: 'Chinese', questions: 'questionsZh', vetting: 'vettingZh' }
];
const BANK_OWNER = 'staff-check-bank-owner';
const PROBE_UID = 'staff-check-employee';
const PROBE_QUESTION = { id: 'staff-check', question: 'probe', topic: 'probe', createdAt: 1, updatedAt: 1 };

/** The token a signed-in employee carries (a probe uid, never the real one). */
export function employeeToken({ email, verified, employee, admin }) {
  const token = { sub: PROBE_UID, email, email_verified: verified === true };
  if (employee) token.employee = true;
  if (admin) token.admin = true;
  return token;
}

/**
 * One Rules API test case per bank collection: may this token CREATE a question in
 * the teacher's bank? Every config pointer (config/admin, config/mathAdmin,
 * enConfig/admin, zhConfig/admin) is mocked to name BANK_OWNER, as it does live.
 */
export function bankCases(token) {
  const mocks = [
    { function: 'get', args: [{ anyValue: {} }], result: { value: { data: { uid: BANK_OWNER, email: ADMIN_EMAILS[0] } } } },
    { function: 'exists', args: [{ anyValue: {} }], result: { value: true } }
  ];
  const out = [];
  for (const bank of BANKS)
    for (const kind of ['questions', 'vetting'])
      out.push({
        app: bank.app, kind,
        test: {
          expectation: 'ALLOW',
          request: {
            path: `/databases/(default)/documents/users/${BANK_OWNER}/${bank[kind]}/staff-check`,
            method: 'create',
            auth: { uid: PROBE_UID, token },
            resource: { data: PROBE_QUESTION }
          },
          functionMocks: mocks
        }
      });
  return out;
}

/** The Rules API answers → { Science: { questions: true, vetting: false }, ... }. */
export function bankResults(cases, results) {
  const out = {};
  cases.forEach((c, i) => {
    const r = (results || [])[i] || {};
    (out[c.app] = out[c.app] || {})[c.kind] = r.state === 'SUCCESS';
  });
  return out;
}

/** What the account is, from its Auth record and the documents about it (no names). */
export function accountFacts({ user, access, online, workSessions = 0, mathWorkSessions = 0 }) {
  const claims = (user && user.customClaims) || {};
  const email = String(user && user.email || '').toLowerCase();
  return {
    accountExists: !!user,
    onEmployeeList: EMPLOYEE_EMAILS.includes(email),
    onAdminList: ADMIN_EMAILS.includes(email),
    emailVerified: !!(user && user.emailVerified),
    signIn: ((user && user.providerData) || []).map(p => p.providerId).sort(),
    disabled: !!(user && user.disabled),
    employeeClaim: claims.employee === true,
    adminClaim: claims.admin === true,
    studentRequest: access ? String(access.status || 'pending') : 'none',
    studentRequestFromApp: access ? String(access.app || '') : '',
    onlineRow: online ? (online.source === 'student-access' ? 'made by the student approval' : 'other') : 'none',
    onlineRowRole: online ? String(online.role || '') : '',
    scienceWorkSessions: workSessions,
    mathWorkSessions
  };
}

/** What --fix will change (pure, so it is tested offline). */
export function fixPlan(facts, online) {
  const plan = [];
  if (!facts.accountExists) return ['nothing: the account does not exist yet'];
  if (facts.onAdminList) throw new Error('The employee address is on the admin list; refusing to touch it.');
  if (!facts.emailVerified) plan.push('mark the email address verified');
  if (!facts.employeeClaim || facts.adminClaim) plan.push('set the employee claim' + (facts.adminClaim ? ' and take the admin claim off' : ''));
  if (facts.studentRequest !== 'none') plan.push('remove the student request');
  if (online && online.source === 'student-access' && (online.role || 'student') === 'student') plan.push('remove the Online row the student approval made');
  return plan;
}

export function reportLines(facts, banks) {
  const yes = v => (v ? 'yes' : 'no');
  const lines = [
    `Account exists: ${yes(facts.accountExists)}; signs in with: ${facts.signIn.join(', ') || 'none'}; disabled: ${yes(facts.disabled)}.`,
    `On the employee list: ${yes(facts.onEmployeeList)}; on the admin list: ${yes(facts.onAdminList)}.`,
    `Email verified: ${yes(facts.emailVerified)}; employee claim: ${yes(facts.employeeClaim)}; admin claim: ${yes(facts.adminClaim)}.`,
    `Student request: ${facts.studentRequest}${facts.studentRequestFromApp ? ' (sent from ' + facts.studentRequestFromApp + ')' : ''}; Online row: ${facts.onlineRow}${facts.onlineRowRole ? ' (role ' + facts.onlineRowRole + ')' : ''}.`,
    `Work sessions logged: Science ${facts.scienceWorkSessions}, Math ${facts.mathWorkSessions}.`
  ];
  for (const [label, result] of Object.entries(banks || {}))
    lines.push(`${label}: ` + Object.entries(result).map(([app, r]) => `${app} add question ${yes(r.questions)}, send to vetting ${yes(r.vetting)}`).join('; ') + '.');
  return lines;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (flags.some(f => f !== '--fix')) throw new Error('Use no flag (read only) or --fix.');
  const deps = process.env.STAFF_DEPS;
  if (!deps) throw new Error('Set STAFF_DEPS to a folder with node_modules/firebase-admin.');
  const require = createRequire(join(deps, 'package.json'));
  const admin = require('firebase-admin');
  const credential = admin.credential.applicationDefault();
  admin.initializeApp({ credential, projectId: PROJECT });
  const auth = admin.auth(), db = admin.firestore();

  const rules = async (path, body) => {
    const { access_token: token } = await credential.getAccessToken();
    const res = await fetch('https://firebaserules.googleapis.com/v1/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Rules API HTTP ' + res.status + ': ' + String(json.error && json.error.message || '').slice(0, 200));
    return json;
  };
  let liveSource = null;
  const liveRules = async () => {
    if (liveSource) return liveSource;
    const release = await rules(`projects/${PROJECT}/releases/cloud.firestore`);
    liveSource = (await rules(release.rulesetName)).source;
    return liveSource;
  };
  const probe = async token => {
    const cases = bankCases(token);
    const result = await rules(`projects/${PROJECT}:test`, { source: await liveRules(), testSuite: { testCases: cases.map(c => c.test) } });
    return bankResults(cases, result.testResults);
  };

  const look = async () => {
    const email = EMPLOYEE_EMAILS[0];
    const user = await auth.getUserByEmail(email).catch(error => { if (error.code === 'auth/user-not-found') return null; throw error; });
    const uid = user && user.uid;
    const accessSnap = uid ? await db.collection('studentAccess').doc(uid).get() : null;
    const onlineSnap = uid ? await db.collection('onlineMembers').doc(uid).get() : null;
    const count = async (collection) => {
      if (!uid) return 0;
      try { return (await db.collection(collection).where('uid', '==', uid).count().get()).data().count; }
      catch { return -1; }
    };
    const access = accessSnap && accessSnap.exists ? accessSnap.data() : null;
    const online = onlineSnap && onlineSnap.exists ? onlineSnap.data() : null;
    const facts = accountFacts({ user, access, online, workSessions: await count('workSessions'), mathWorkSessions: await count('mathWorkSessions') });
    return { user, uid, access, online, facts };
  };

  const show = async (title, state) => {
    const { facts, user } = state;
    const now = employeeToken({ email: EMPLOYEE_EMAILS[0], verified: facts.emailVerified, employee: facts.employeeClaim, admin: facts.adminClaim });
    const banks = { 'Today (as the account signs in now)': await probe(now) };
    if (!(facts.emailVerified && facts.employeeClaim && !facts.adminClaim))
      banks['As an employee (verified, employee claim, no admin)'] = await probe(employeeToken({ email: EMPLOYEE_EMAILS[0], verified: true, employee: true }));
    banks['As a student (for comparison)'] = await probe({ sub: PROBE_UID, email: 'student@example.com', email_verified: true });
    console.log('### ' + title);
    for (const line of reportLines(facts, banks)) console.log('- ' + line);
    return user;
  };

  let state = await look();
  await show('Employee account: before', state);
  if (flags.includes('--fix')) {
    const plan = fixPlan(state.facts, state.online);
    console.log('### Fix: ' + (plan.length ? plan.join('; ') : 'nothing to change'));
    if (state.uid && plan.length) {
      if (!state.facts.emailVerified) await auth.updateUser(state.uid, { emailVerified: true });
      if (!state.facts.employeeClaim || state.facts.adminClaim) {
        // setCustomUserClaims replaces the whole set: carry the others, as grantEmployeeRole does.
        const claims = Object.assign({}, state.user.customClaims || {});
        delete claims.admin;
        claims.employee = true;
        await auth.setCustomUserClaims(state.uid, claims);
      }
      if (state.access) await db.collection('studentAccess').doc(state.uid).delete();
      if (state.online && state.online.source === 'student-access' && (state.online.role || 'student') === 'student')
        await db.collection('onlineMembers').doc(state.uid).delete();
      state = await look();
      await show('Employee account: after the fix', state);
    }
  }
}
