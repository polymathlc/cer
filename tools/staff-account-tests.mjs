// Offline tests for tools/staff-account.mjs.   node --test tools/staff-account-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EMPLOYEE_EMAILS, ADMIN_EMAILS, BANKS, employeeToken, bankCases, bankResults, accountFacts, fixPlan, reportLines } from './staff-account.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const APP = readFileSync(root + 'app.js', 'utf8');
const listIn = (src, name) => JSON.parse(src.match(new RegExp('const ' + name + " = (\\[[^\\]]*\\])"))[1].replace(/'/g, '"'));

test('the lists match the Science app, and the employee is never an admin', () => {
  assert.deepEqual(listIn(APP, 'EMPLOYEE_EMAILS'), EMPLOYEE_EMAILS);
  assert.deepEqual(listIn(APP, 'ADMIN_EMAILS'), ADMIN_EMAILS);
  for (const email of EMPLOYEE_EMAILS) assert.ok(!ADMIN_EMAILS.includes(email), email);
});

test('one create case per bank and kind, in the teacher\'s bank, with the config pointers mocked', () => {
  const cases = bankCases(employeeToken({ email: 'pkeertana21@gmail.com', verified: true, employee: true }));
  assert.equal(cases.length, BANKS.length * 2);
  assert.deepEqual(BANKS.map(b => b.app), ['Science', 'Math', 'English', 'Chinese']);
  for (const c of cases) {
    assert.equal(c.test.request.method, 'create');
    assert.match(c.test.request.path, /^\/databases\/\(default\)\/documents\/users\/staff-check-bank-owner\/\w+\/staff-check$/);
    assert.equal(c.test.request.auth.token.employee, true);
    assert.ok(!('admin' in c.test.request.auth.token), 'never an admin token');
    assert.equal(c.test.functionMocks.length, 2);
  }
  assert.ok(cases.some(c => c.test.request.path.includes('/mathQuestions/')));
  assert.ok(cases.some(c => c.test.request.path.includes('/vettingZh/')));
  const results = cases.map((c, i) => ({ state: i % 2 ? 'FAILURE' : 'SUCCESS' }));
  assert.deepEqual(bankResults(cases, results).Science, { questions: true, vetting: false });
});

test('the unverified token carries no employee claim and is not verified', () => {
  const t = employeeToken({ email: 'pkeertana21@gmail.com', verified: false, employee: false });
  assert.equal(t.email_verified, false);
  assert.ok(!('employee' in t));
});

const USER = { uid: 'u', email: 'pkeertana21@gmail.com', emailVerified: false, providerData: [{ providerId: 'password' }], customClaims: {} };

test('facts and the fix plan: an unverified employee with a student request and an Online row from the approval', () => {
  const access = { status: 'approved', app: 'english' };
  const online = { source: 'student-access', role: 'student' };
  const facts = accountFacts({ user: USER, access, online, workSessions: 3 });
  assert.equal(facts.onEmployeeList, true);
  assert.equal(facts.onAdminList, false);
  assert.equal(facts.emailVerified, false);
  assert.deepEqual(facts.signIn, ['password']);
  assert.equal(facts.studentRequest, 'approved');
  assert.equal(facts.onlineRow, 'made by the student approval');
  assert.deepEqual(fixPlan(facts, online), ['mark the email address verified', 'set the employee claim', 'remove the student request', 'remove the Online row the student approval made']);
  const lines = reportLines(facts, { Today: { Science: { questions: true, vetting: true }, Math: { questions: false, vetting: false } } });
  assert.ok(lines.every(l => !l.includes('pkeertana') && !l.includes('@')), 'no address in the public log');
  assert.ok(lines.some(l => /Math add question no/.test(l)));
});

test('the fix never touches an Online row someone else made, never makes an admin, and refuses an admin address', () => {
  const ok = accountFacts({ user: { ...USER, emailVerified: true, customClaims: { employee: true } }, access: null, online: { source: 'invite', role: 'teacher' } });
  assert.deepEqual(fixPlan(ok, { source: 'invite', role: 'teacher' }), []);
  const stale = accountFacts({ user: { ...USER, emailVerified: true, customClaims: { employee: true, admin: true } } });
  assert.deepEqual(fixPlan(stale, null), ['set the employee claim and take the admin claim off']);
  const adminFacts = accountFacts({ user: { ...USER, email: 'chungzhikai@gmail.com' } });
  assert.throws(() => fixPlan(adminFacts, null), /admin list/);
  assert.deepEqual(fixPlan(accountFacts({ user: null }), null), ['nothing: the account does not exist yet']);
});
