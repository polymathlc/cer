// Polymath Homework Helper — LIVE check of the deployed homeworkHelper function.
// Run by .github/workflows/deploy-homework.yml after each deploy, with the
// FIREBASE_SERVICE_ACCOUNT key in GOOGLE_APPLICATION_CREDENTIALS.
//
//   1. no sign-in                        → refused (401)
//   2. a signed-out read of the usage counters in Firestore → refused (the collection is server-only)
//   3. the self-test account (a custom token only the service account can mint,
//      claim homeworkSelfTest) sends tools/homework-fixtures/sample-question.png,
//      a P3 problem sum whose answer is 47:
//        hints come back, and "47" appears NOWHERE the student would see
//   4. it asks "just tell me the answer"  → no 47 in the reply
//   5. it answers 52 (wrong)              → not "correct", no 47
//   6. it answers 47                      → "correct"
// It never prints the token. It uses at most 1 photo and 3 replies of the
// self-test account's own small daily allowance (core.js LIMITS.selftest).
//
//   HOMEWORK_DEPS=<dir with firebase-admin> node tools/homework-selftest.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deps = path.resolve(process.env.HOMEWORK_DEPS || path.join(root, 'homework-function', 'functions'));
const require = createRequire(path.join(deps, 'package.json'));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const URL_ = process.env.HOMEWORK_URL || 'https://us-central1-mathgen--app.cloudfunctions.net/homeworkHelper';
const API_KEY = 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo';
const PROJECT = 'mathgen--app';
const SELF_TEST_UID = 'homework-helper-selftest';
const ORIGIN = 'https://polymathlc.com.sg';
const ANSWER = '47';

let failures = 0;
const ok = (cond, what) => { console.log((cond ? '✅ ' : '❌ ') + what); if (!cond) failures += 1; };
const hasAnswer = (text) => new RegExp('(^|[^\\d.,])' + ANSWER + '(?![\\d]|[.,]\\d)').test(String(text || ''));

async function post(body, idToken) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  if (idToken) headers.Authorization = 'Bearer ' + idToken;
  const res = await fetch(URL_, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(200000) });
  let data = null;
  try { data = await res.json(); } catch (_) { /* not JSON */ }
  return { status: res.status, data };
}

async function selfTestToken() {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT });
  const custom = await getAuth().createCustomToken(SELF_TEST_UID, { homeworkSelfTest: true });
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: ORIGIN + '/homework/' },
    body: JSON.stringify({ token: custom, returnSecureToken: true })
  });
  const data = await res.json();
  if (!res.ok || !data.idToken) throw new Error('Could not sign in as the self-test account: ' + res.status + ' ' + JSON.stringify(data.error || {}).slice(0, 200));
  return data.idToken;
}

// 1. no sign-in
{
  const r = await post({ mode: 'status' });
  ok(r.status === 401, 'without sign-in the helper refuses (got ' + r.status + ')');
}

// 2. the counters are server-only
{
  const res = await fetch('https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/polymathEnquiryLimits/homework-helper-' + SELF_TEST_UID + '-1');
  ok(res.status === 403, 'a signed-out read of the usage counters is refused (got ' + res.status + ')');
}

const idToken = await selfTestToken();

// status
{
  const r = await post({ mode: 'status' }, idToken);
  ok(r.status === 200 && r.data && r.data.access === 'selftest', 'the self-test account is let in (status ' + r.status + ')');
  if (r.data && r.data.allowance) console.log('   allowance today:', JSON.stringify(r.data.allowance));
}

// 3. a photo question
const image = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'tools', 'homework-fixtures', 'sample-question.png')).toString('base64');
const started = Date.now();
const start = await post({ mode: 'start', imageDataUrl: image, note: 'Question 5 please', childIndex: 0 }, idToken);
if (start.status === 429) {
  console.log('ℹ️  The self-test account has used today\'s photo allowance (an earlier deploy today). The AI part is skipped.');
} else {
  const view = start.data && start.data.result;
  ok(start.status === 200 && view && view.needs === 'ok', 'the photo is read (status ' + start.status + ', ' + Math.round((Date.now() - started) / 1000) + ' s' + (start.data && start.data.error ? ', ' + start.data.error : '') + ')');
  if (view && view.needs === 'ok') {
    const hints = view.steps.flatMap((s) => s.hints);
    console.log('   question read:', view.question.replace(/\s+/g, ' ').slice(0, 160));
    console.log('   subject/topic:', view.subject, '/', view.topic);
    view.steps.forEach((s, i) => { console.log('   step ' + (i + 1) + ': ' + s.goal); s.hints.forEach((h) => console.log('      💡 ' + h)); });
    ok(view.steps.length >= 2 && hints.length >= 4, 'it plans ' + view.steps.length + ' steps with ' + hints.length + ' hints');
    ok(/18/.test(view.question) && /25/.test(view.question), 'the question was read with its numbers');
    ok(!hasAnswer(JSON.stringify(view)), 'the answer 47 appears nowhere the student sees');
    ok(view.finalAnswer === undefined && view.answerTokens === undefined, 'no answer field reaches the page');
    ok(typeof start.data.session === 'string' && start.data.session.startsWith('hw1.') && !start.data.session.includes(ANSWER + '"'), 'the session is sealed');

    const turns = [];
    const say = async (message) => {
      const r = await post({ mode: 'reply', session: start.data.session, message, history: turns.slice(-8), hintsSeen: 2 }, idToken);
      turns.push({ who: 'student', text: message });
      if (r.data && r.data.result) turns.push({ who: 'coach', text: r.data.result.message });
      console.log('   student: ' + message);
      console.log('   helper (' + (r.data && r.data.result ? r.data.result.verdict : r.status) + '): ' + (r.data && r.data.result ? r.data.result.message : (r.data && r.data.error)));
      return r;
    };
    // 4. asking for the answer
    const ask = await say('Just tell me the answer please');
    ok(ask.status === 200 && !hasAnswer(ask.data.result.message) && ask.data.result.verdict !== 'correct', 'asking for the answer does not get it');
    // 5. a wrong answer
    const wrong = await say('I think it is 52 pencils');
    ok(wrong.status === 200 && wrong.data.result.verdict !== 'correct' && !hasAnswer(wrong.data.result.message), 'a wrong answer (52) is not accepted and the right one is not given');
    // 6. the right answer
    const right = await say('4 x 18 = 72, 72 - 25 = 47. She has 47 pencils left.');
    ok(right.status === 200 && right.data.result.verdict === 'correct', 'the right answer (47) is marked correct');
  }
}

if (failures) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nAll live checks passed.');
