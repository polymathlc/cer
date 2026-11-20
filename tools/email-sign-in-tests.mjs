// ✉️ Email sign-in (student/email-sign-in.js) and the verification step of the
// access gate (student/access-gate.js v1.2.0): the logic, without a browser.
//   node --test tools/email-sign-in-tests.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(root, 'student', 'email-sign-in.js'), 'utf8');
const GATE_SOURCE = fs.readFileSync(path.join(root, 'student', 'access-gate.js'), 'utf8');

function load(source, name) {
  const sandbox = { console, setTimeout() {}, clearTimeout() {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: name });
  return sandbox;
}
const E = load(SOURCE, 'email-sign-in.js').PolymathEmailSignIn;
const core = E.core;
const gateCore = load(GATE_SOURCE, 'access-gate.js').PolymathAccess.core;

const pw = (extra = {}) => ({ uid: 'u1', email: 'parent@example.com', emailVerified: false, isAnonymous: false, providerData: [{ providerId: 'password' }], ...extra });

test('version and exports', () => {
  assert.equal(E.version, '1.0.0');
  for (const name of ['isEmail', 'needsVerification', 'passwordProblem', 'validate', 'friendlyError', 'returnUrl', 'sdkVersionsFrom', 'looksLikeGoogleSignIn', 'maySendAgain'])
    assert.equal(typeof core[name], 'function', name);
});

test('who must confirm their email: only a new-style email-and-password account that is not confirmed', () => {
  assert.equal(core.needsVerification(pw()), true);
  assert.equal(core.needsVerification(pw({ emailVerified: true })), false, 'already confirmed');
  assert.equal(core.needsVerification(pw({ providerData: [{ providerId: 'google.com' }], emailVerified: true })), false, 'Google');
  assert.equal(core.needsVerification(pw({ providerData: [{ providerId: 'google.com' }, { providerId: 'password' }], emailVerified: true })), false, 'Google + a password');
  assert.equal(core.needsVerification(pw({ email: 'weiming@students.sciencequest.app' })), false, 'centre username');
  assert.equal(core.needsVerification(pw({ email: 'WeiMing.r2@Students.ScienceQuest.app' })), false, 'centre username after a teacher reset');
  assert.equal(core.needsVerification(pw({ isAnonymous: true })), false, 'guest');
  assert.equal(core.needsVerification(pw({ providerData: [] })), false, 'unknown kind of account is never locked out');
  assert.equal(core.needsVerification(null), false);
  assert.equal(core.needsVerification(pw({ email: '' })), false);
});

test('the gate and the dialog agree on who must confirm (same rule in both files)', () => {
  const cases = [pw(), pw({ emailVerified: true }), pw({ email: 'kid@students.sciencequest.app' }), pw({ isAnonymous: true }), pw({ providerData: [] }),
    pw({ providerData: [{ providerId: 'google.com' }], emailVerified: true }), pw({ providerData: [{ providerId: 'google.com' }], emailVerified: false }), null];
  for (const user of cases) assert.equal(gateCore.needsVerification(user), core.needsVerification(user), JSON.stringify(user));
});

test('the gate asks to confirm only BEFORE the first request: nobody who already has a record is ever asked', () => {
  assert.equal(gateCore.mustVerifyFirst(pw(), null), true);
  assert.equal(gateCore.mustVerifyFirst(pw(), { status: 'approved' }), false, 'approved before today');
  assert.equal(gateCore.mustVerifyFirst(pw(), { status: 'pending' }), false, 'already waiting');
  assert.equal(gateCore.mustVerifyFirst(pw(), { status: 'revoked' }), false);
  assert.equal(gateCore.mustVerifyFirst(pw({ emailVerified: true }), null), false);
});

test('the gate puts "Confirm your email" before the enrolment form, blocks the app on it, and loads the email dialog', () => {
  assert.ok(GATE_SOURCE.includes("if (status === 'none' && mustVerifyFirst(user, record)) { setPhase('verify'); return startVerify(mine); }"));
  assert.ok(GATE_SOURCE.indexOf("mustVerifyFirst(user, record)") < GATE_SOURCE.indexOf("if (status === 'none') { if (!draft)"));
  assert.match(GATE_SOURCE, /var BLOCKING = \{[^}]*verify: true[^}]*\}/);
  assert.ok(GATE_SOURCE.includes("var EMAIL_SIGN_IN = 'email-sign-in.js?v=" + E.version + "'"), 'the gate loads this version');
  assert.ok(GATE_SOURCE.includes("loadEmailSignIn(script);"));
  assert.ok(GATE_SOURCE.includes("'polymath-verify-sent-v1:'") && SOURCE.includes("'polymath-verify-sent-v1:'"), 'one remembered "sent at" for both, so one email');
});

test('email addresses', () => {
  for (const ok of ['a.b@example.com', 'tan_siew.ling+kids@gmail.com', 'x@y.co', 'PARENT@HOTMAIL.SG']) assert.equal(core.isEmail(ok), true, ok);
  for (const bad of ['', 'a@b', 'a b@c.com', 'a@b.c', '@x.com', 'a@x.com,', 'a<@x.com', 'x'.repeat(200) + '@x.com']) assert.equal(core.isEmail(bad), false, bad);
  assert.equal(core.isUsernameEmail('kid@students.sciencequest.app'), true);
  assert.equal(core.isUsernameEmail('kid@gmail.com'), false);
});

test('passwords: at least 8 characters, no edge spaces, both typed the same', () => {
  assert.equal(core.passwordProblem(''), 'Choose a password.');
  assert.match(core.passwordProblem('short'), /at least 8/);
  assert.match(core.passwordProblem(' padded123 '), /space/);
  assert.match(core.passwordProblem('x'.repeat(129)), /too long/);
  assert.match(core.passwordProblem('Polymath2026', 'Polymath2025'), /not the same/);
  assert.equal(core.passwordProblem('Polymath2026', 'Polymath2026'), '');
});

test('the three forms name every mistake in plain words', () => {
  let r = core.validate('create', { name: '', email: 'bad', password: 'short', confirm: 'short' });
  assert.equal(r.ok, false);
  assert.equal(Object.keys(r.errors).sort().join(), 'email,name,password');
  r = core.validate('create', { name: 'Mdm Tan', email: 'tan@example.com', password: 'Polymath2026', confirm: 'Polymath2027' });
  assert.equal(Object.keys(r.errors).join(), 'confirm');
  r = core.validate('create', { name: 'Mdm Tan', email: 'tan@example.com', password: 'Polymath2026', confirm: 'Polymath2026' });
  assert.equal(r.ok, true);
  assert.equal(Object.keys(core.validate('signin', { email: 'tan@example.com', password: '' }).errors).join(), 'password');
  assert.equal(core.validate('reset', { email: 'tan@example.com' }).ok, true);
  assert.match(core.validate('reset', { email: 'kid@students.sciencequest.app' }).errors.email, /centre username/);
});

test('Firebase errors become plain words with the right next step', () => {
  const f = code => core.friendlyError({ code: 'auth/' + code });
  assert.equal(f('email-already-in-use').offer, 'reset', 'one account per email: offer a password for the SAME account');
  assert.match(f('email-already-in-use').message, /already has a Polymath account/);
  for (const code of ['invalid-credential', 'wrong-password', 'invalid-login-credentials']) {
    assert.equal(f(code).offer, 'reset');
    assert.match(f(code).message, /Google/);
  }
  assert.equal(f('user-not-found').offer, 'create');
  assert.match(f('too-many-requests').message, /wait a few minutes/);
  assert.match(f('network-request-failed').message, /internet/);
  assert.match(f('operation-not-allowed').message, /not switched on/);
  assert.match(core.friendlyError({ code: 'auth/something-new' }).message, /something-new/);
  assert.match(core.friendlyError(null).message, /WhatsApp/);
});

test('the way back from the emails: only Polymath addresses, never the link codes', () => {
  const loc = href => { const u = new URL(href); return { protocol: u.protocol, hostname: u.hostname, pathname: u.pathname, search: u.search }; };
  assert.equal(core.returnUrl(loc('https://polymathlc.com.sg/student/')), 'https://polymathlc.com.sg/student/');
  assert.equal(core.returnUrl(loc('https://polymathlc.github.io/anskey/?live')), 'https://polymathlc.github.io/anskey/?live');
  assert.equal(core.returnUrl(loc('https://polymathlc.com.sg/online/?mode=verifyEmail&oobCode=abc')), 'https://polymathlc.com.sg/online/');
  assert.equal(core.returnUrl(loc('https://evil.example.com/')), null);
  assert.equal(core.returnUrl(loc('http://polymathlc.com.sg/')), null);
  assert.equal(core.returnUrl(null), null);
  assert.equal(gateCore.verifyReturnUrl(loc('https://polymathlc.com.sg/math.html?x=1')), 'https://polymathlc.com.sg/math.html');
  assert.equal(gateCore.verifyReturnUrl(loc('https://example.org/')), null);
  assert.equal(core.isReturnUrlProblem({ code: 'auth/unauthorized-continue-uri' }), true);
  assert.equal(core.isReturnUrlProblem({ code: 'auth/invalid-continue-uri' }), true);
  assert.equal(core.isReturnUrlProblem({ code: 'auth/too-many-requests' }), false);
});

test('the modular SDK version comes from the page itself', () => {
  // (JSON: the arrays come from the script's own sandbox)
  assert.equal(JSON.stringify(core.sdkVersionsFrom([
    'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js', 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js', 'https://example.com/x.js', null])), '["11.10.0","10.13.0"]');
  assert.equal(JSON.stringify(core.sdkVersionsFrom([])), '[]');
});

test('which buttons are Google sign-in buttons', () => {
  for (const yes of ['Sign in with Google', 'Continue with Google', 'Continue with Google (Student)', 'Sign up with Google (Student)',
    'Sign in with Google to start', 'Sign in  Sign in with Google', 'Log in with Google', 'Login with Google'])
    assert.equal(core.looksLikeGoogleSignIn(yes), true, yes);
  for (const no of ['Sign out', 'Sign out of Google', 'Open in Google Drive', 'Google Classroom', 'Search', 'Sign in', 'Use Google Translate'])
    assert.equal(core.looksLikeGoogleSignIn(no), false, no);
});

test('one verification email a minute at most', () => {
  assert.equal(core.maySendAgain(0, 1000), true);
  assert.equal(core.maySendAgain(1000, 30000), false);
  assert.equal(core.maySendAgain(1000, 62000), true);
});

test('every customer app gets the button through the gate, and pages with their own email form opt out', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const OFF = '<meta name="polymath-email-sign-in" content="off">';
  assert.ok(read('index.html').includes(OFF), 'the Science app has its own email form');
  assert.ok(read('math.html').includes(OFF), 'the Math page has its own email form');
  assert.ok(read('math.html').includes("PolymathEmailSignIn.open('reset'"), 'and gets "Forgot your password?"');
  for (const file of ['maps/index.html', 'math-worksheet.html', 'science-worksheet.html', 'pdf-annotator.html'])
    assert.ok(/<script defer src="(\.\.\/)?student\/email-sign-in\.js\?v=1\.0\.0"><\/script>/.test(read(file)), file + ' loads it directly (no gate there)');
  for (const file of ['student/index.html', 'online/index.html', 'mindmap/index.html', 'homework/index.html', 'notebook/index.html', 'mistakes.html'])
    assert.ok(read(file).includes('access-gate.js?v=1.2.0'), file + ' carries the gate (which brings the button)');
});

test('Firebase settings: only what is missing is changed, and the existing domains are kept', async () => {
  const { plan, DOMAINS, TEMPLATES, SENDER_NAME, REPLY_TO } = await import('./email-sign-in-config.mjs');
  const off = plan({ authorizedDomains: ['localhost', 'mathgen--app.firebaseapp.com'] });
  assert.deepEqual(off.map(s => s.what), ['email-provider', 'authorised-domains', 'template:verifyEmailTemplate', 'template:resetPasswordTemplate']);
  const domains = off.find(s => s.what === 'authorised-domains').body.authorizedDomains;
  assert.deepEqual(domains, ['localhost', 'mathgen--app.firebaseapp.com', ...DOMAINS], 'nothing removed');
  const done = {
    signIn: { email: { enabled: true, passwordRequired: true } },
    authorizedDomains: ['localhost', ...DOMAINS],
    notification: { sendEmail: Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, { senderDisplayName: SENDER_NAME, subject: t.subject, replyTo: REPLY_TO, body: t.body }])) }
  };
  assert.deepEqual(plan(done), [], 'already right: no change at all');
  for (const t of Object.values(TEMPLATES)) { assert.ok(t.body.includes('%LINK%')); assert.ok(t.body.includes('%EMAIL%')); }
});
