// 🔒 The signed-out lock — the shared constants (no imports, no I/O).
//
// tools/private-data-rules.mjs adds ONE predicate to the shared Firestore
// catch-all of mathgen--app so that a browser that is NOT signed in can no
// longer read or write the collections below. A signed-in account (including
// an anonymous Firebase sign-in) keeps exactly the access it has today, so no
// app that signs in first loses anything.
//
// Every other rules tool in tools/ asserts that some of these paths are open to
// a signed-out visitor ("the catch-all leaves them as it found them"). Once the
// lock is installed that expectation is wrong, so each of those tools passes its
// preserved cases through `withSignedOutLock(source, cases)`: when the live
// rules already carry the lock, a signed-out ALLOW on a locked collection
// becomes a DENY. Nothing else about their cases changes.

export const SIGNED_OUT_LOCK_MARKER = 'polymath-signed-out-lock-v1';
export const SIGNED_OUT_LOCK_FUNCTION = 'isSignedOutPrivatePath';

// Top-level collections a signed-out browser may no longer touch. Every one of
// them holds a child's or a parent's data, and every app that uses them signs
// in before it reads (checked across the cer, website, math, anskey, tutor,
// mindmap, scan, english, chinese, mathgame, wsgen and Add repositories).
export const SIGNED_OUT_LOCKED_COLLECTIONS = Object.freeze([
  // Every account's private subtree: settings, teaching notes, question banks,
  // vetting, worksheets, mistakes, flashcards, question history and so on.
  'users',
  // Rosters: names, levels, emails.
  'userProfiles',
  'studentProfiles',
  // The CER portal's own logs and boards.
  'questionAttempts',        // every answer, with the student's name and email
  'loginEvents',             // who signed in, when, from where
  'messages',                // teacher <-> student messages
  'community',               // community posts
  'prizeClaims',             // prize claims with the student's details
  'workSessions',            // staff work timers
  'flaggedQuestions',        // students' question reports
  'cerLeaderboard',          // the CER leaderboard
  'scienceGameLeaderboard',  // game saves, wallets and launch counts
  'encounterQuests'          // community quests
]);

const DOCUMENTS = '/databases/(default)/documents/';

/** The top-level collection a Rules API test case is about, or ''. */
export function topCollectionOf(testCase) {
  const path = testCase?.request?.path;
  if (typeof path !== 'string' || !path.startsWith(DOCUMENTS)) return '';
  return path.slice(DOCUMENTS.length).split('/')[0] || '';
}

/** Is the lock already in these rules? */
export function hasSignedOutLock(source) {
  return typeof source === 'string' && source.includes('BEGIN ' + SIGNED_OUT_LOCK_MARKER);
}

/**
 * Other rules tools' "everything else keeps its permissions" cases, corrected
 * for the lock: once it is installed, a signed-out visitor is refused the
 * locked collections. Cases are copied, never mutated.
 */
export function withSignedOutLock(source, cases) {
  if (!hasSignedOutLock(source)) return cases;
  return cases.map(testCase => {
    if (testCase?.expectation !== 'ALLOW' || testCase.request?.auth) return testCase;
    if (!SIGNED_OUT_LOCKED_COLLECTIONS.includes(topCollectionOf(testCase))) return testCase;
    return { ...testCase, expectation: 'DENY' };
  });
}
