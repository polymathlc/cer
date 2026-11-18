// 🔒 The signed-out lock — the shared constants (no imports, no I/O).
//
// tools/private-data-rules.mjs adds ONE predicate to the shared Firestore
// catch-all of mathgen--app so that a browser that is NOT signed in can no
// longer touch the collections below. A signed-in account (including an
// anonymous Firebase sign-in) keeps exactly the access it has today, so no app
// that signs in first loses anything.
//
// Two kinds of lock:
//   LOCKED       signed out: no read, no write at all.
//   CREATE_ONLY  signed out: may still CREATE a document (a parent's booking or
//                registration from a public form) but may not read, list,
//                change or delete any — so nobody can read other parents'
//                names and numbers back out.
//
// Versions. v1 (2026-11-18) locked V1_LOCKED only. v2 adds more collections
// and the create-only kind; the tool upgrades a v1 block in place.
//
// Every other rules tool in tools/ asserts that some of these paths are open to
// a signed-out visitor ("the catch-all leaves them as it found them"). Once the
// lock is installed that expectation is wrong, so each of those tools passes its
// preserved cases through `withSignedOutLock(source, cases)`: when the live
// rules already carry the lock, a signed-out ALLOW the lock refuses becomes a
// DENY. Nothing else about their cases changes.

export const SIGNED_OUT_LOCK_MARKER = 'polymath-signed-out-lock-v2';
export const SIGNED_OUT_LOCK_MARKER_V1 = 'polymath-signed-out-lock-v1';
export const SIGNED_OUT_LOCK_FUNCTION = 'isSignedOutPrivatePath';

// v1: every account's subtree, the rosters and the CER portal's own data.
export const V1_LOCKED = Object.freeze([
  'users',                   // every account's private subtree
  'userProfiles',            // roster: names, levels, emails
  'studentProfiles',         // roster
  'questionAttempts',        // every answer, with the student's name and email
  'loginEvents',             // who signed in, when
  'messages',                // teacher <-> student messages
  'community',               // community posts
  'prizeClaims',             // prize claims with the student's details
  'workSessions',            // staff work timers
  'flaggedQuestions',        // students' question reports
  'cerLeaderboard',          // the CER leaderboard
  'scienceGameLeaderboard',  // game saves, wallets and launch counts
  'encounterQuests'          // community quests
]);

// Every app that uses these signs in before it reads (checked across cer,
// website, math, anskey, tutor, rewards, monsters, scan, mathgame,
// science-cer-tool on 2026-11-19).
export const SIGNED_OUT_LOCKED_COLLECTIONS = Object.freeze([
  ...V1_LOCKED,
  // Polymath Rewards (rewards/, monsters/, Ans Key's reward wheel).
  'students', 'awards', 'claims', 'rewards', 'bosses', 'purchases', 'shopItems', 'testPapers',
  // Study Buddy's worksheets (with each child's written work).
  'tutorWorksheets',
  // The Scan app's papers — a child's own marked work.
  'scanPapers',
  // The Math app's board.
  'gameLeaderboard',
  // The old CER question tool's banks (answers included).
  'vetting_questions', 'custom_questions'
]);

// Public forms write these signed out; nobody signed out may read them back.
// The page owner (the admin) reads them after signing in.
export const SIGNED_OUT_CREATE_ONLY_COLLECTIONS = Object.freeze([
  'schedule_bookings',        // /schedule and /diagnostic bookings
  'june2026_registrations',   // the June holiday programme form
  'sep2026_registrations'     // the September holiday programme form
]);

const DOCUMENTS = '/databases/(default)/documents/';

/** The top-level collection a Rules API test case is about, or ''. */
export function topCollectionOf(testCase) {
  const path = testCase?.request?.path;
  if (typeof path !== 'string' || !path.startsWith(DOCUMENTS)) return '';
  return path.slice(DOCUMENTS.length).split('/')[0] || '';
}

/** Which version of the lock these rules carry: 2, 1 or 0. */
export function signedOutLockVersion(source) {
  if (typeof source !== 'string') return 0;
  if (source.includes('BEGIN ' + SIGNED_OUT_LOCK_MARKER)) return 2;
  if (source.includes('BEGIN ' + SIGNED_OUT_LOCK_MARKER_V1)) return 1;
  return 0;
}
export function hasSignedOutLock(source) { return signedOutLockVersion(source) > 0; }

/** Does the installed lock (of this version) refuse this signed-out request? */
export function signedOutRefuses(version, collection, method) {
  if (version === 1) return V1_LOCKED.includes(collection);
  if (version >= 2) return SIGNED_OUT_LOCKED_COLLECTIONS.includes(collection)
    || (SIGNED_OUT_CREATE_ONLY_COLLECTIONS.includes(collection) && method !== 'create');
  return false;
}

/**
 * Other rules tools' "everything else keeps its permissions" cases, corrected
 * for the lock: once it is installed, a signed-out visitor is refused what the
 * lock refuses. Cases are copied, never mutated.
 */
export function withSignedOutLock(source, cases) {
  const version = signedOutLockVersion(source);
  if (!version) return cases;
  return cases.map(testCase => {
    if (testCase?.expectation !== 'ALLOW' || testCase.request?.auth) return testCase;
    if (!signedOutRefuses(version, topCollectionOf(testCase), testCase.request?.method)) return testCase;
    return { ...testCase, expectation: 'DENY' };
  });
}
