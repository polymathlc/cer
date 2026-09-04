// Regression tests for ⏳ SCHEDULED RELEASE — a question that is IN the bank
// and not yet due.  Run with:  node tools/scheduled-release-tests.mjs
//
// ⚡ Rapid add can file a whole batch with a release date on it: the questions
// go into Vetting as they always did, are approved into the bank as they always
// were, and are simply not SERVED to anybody until that morning. Every way that
// goes wrong is silent, and each one lands on a class:
//
//  • A POOL THAT FORGETS THE GATE serves a question weeks early, on a screen
//    that looks perfectly right, with nothing anywhere to say it happened. That
//    is what the CENSUS at the bottom of this file exists for — it fails on the
//    NEXT pool somebody adds without the gate, not on the last one.
//  • A GATE THAT IS TOO EAGER is worse in the other direction: a value that is
//    not a day key, or a date that has already come round, must leave the
//    question behaving exactly as an unscheduled one. A question withheld from
//    every mode for ever by a field nobody can read is the silent disappearance
//    this app spends most of its guards preventing.
//  • THE DAY IS SINGAPORE'S. Read it off the device and a paper is out a day
//    early on half the class's phones and a day late on the rest.
//  • A BATCH READ LATE is a batch filed wrong. A forty-page paper takes minutes
//    to render with the pad open the whole time, so the date has to be captured
//    when the file is QUEUED — the same rule the batch level already follows.
//  • A SCHEDULE NOBODY CAN SEE is a schedule nobody can undo. The badge has to
//    be on every management surface, and the date has to survive an edit.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from.slice(0, 46) + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

let fails = 0, ran = 0;
function ok(name, cond, extra) {
  ran++;
  if (cond) return;
  fails++;
  console.error('FAIL: ' + name + (extra ? '\n      ' + extra : ''));
}

/* ------------------------------------------------------------------ *
 * The REAL blocks, run as themselves.                                 *
 * ------------------------------------------------------------------ */
const core = cut(
  '// ---- Scheduled release — a question that is IN the bank and not yet due -----',
  'function getQuestionsForLevel(',
  'core release block');
const pad = cut(
  '// ---- 📅 The RELEASE DATE this batch is scheduled for ----------------------',
  'function openRapidAdd() {',
  'rapid release block');

const store = {};
const shim = `
  const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toasts = [];
  const showToast = (m, k) => toasts.push([m, k]);
  const sessionStorage = {
    getItem: k => (k in __store ? __store[k] : null),
    setItem: (k, v) => { __store[k] = String(v); },
  };
  const document = { getElementById: () => null };
  // 🔒 The lock is the ONE helper here that asks who is looking. The harness
  // drives it directly, so both audiences can be tested from one build.
  let __author = false;
  const _canAuthor = () => __author;
`;
const api = new Function('__store', shim + core + pad + `
  return { RELEASE_TZ, RELEASE_DAY_RE, releaseDayKey, releaseToday, releaseDayFromNow,
           qReleaseOn, qScheduled, qReleased, qReleaseLabel, qReleaseDaysAway, qReleaseWhen,
           qReleaseChipHtml, RAPID_RELEASE_KEY, rapidRelease, setRapidRelease,
           _rapidApplyRelease, toasts,
           qLockedFrom, qLockSplit, qLockSoonest, qLockNote,
           setAuthor: v => { __author = !!v; } };
`)(store);

const TODAY = '2026-06-15';
const day = n => {
  const d = new Date(Date.parse(TODAY + 'T00:00:00+08:00') + n * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
};

/* ---------------- The day key is SINGAPORE's ---------------- */
ok('the timezone is Singapore', api.RELEASE_TZ === 'Asia/Singapore');
ok('a day key is YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(api.releaseToday()));
ok('half past midnight in Singapore on the 1st is the 1st',
   api.releaseDayKey(new Date('2026-01-01T00:30:00+08:00')) === '2026-01-01');
ok('half past eleven on the 31st is still the 31st',
   api.releaseDayKey(new Date('2025-12-31T23:30:00+08:00')) === '2025-12-31');
ok('11pm UTC on the 31st is already the 1st in Singapore',
   api.releaseDayKey(new Date('2025-12-31T23:00:00Z')) === '2026-01-01',
   'a day read off the device puts a paper out early for half the class');
ok('tomorrow is one day on', api.releaseDayFromNow(1) > api.releaseToday());
ok('today from the helper matches today', api.releaseDayFromNow(0) === api.releaseToday());

/* ---------------- ONE reader, and it is strict ---------------- */
ok('a day key is read back', api.qReleaseOn({ releaseOn: '2026-06-20' }) === '2026-06-20');
ok('no field at all is no schedule', api.qReleaseOn({}) === '');
ok('nothing at all is no schedule', api.qReleaseOn(null) === '' && api.qReleaseOn(undefined) === '');
ok('an ISO TIMESTAMP is not a day key', api.qReleaseOn({ releaseOn: '2026-06-20T00:00:00Z' }) === '',
   'it would compare wrong against a day key on every render');
ok('a Date object is not a day key', api.qReleaseOn({ releaseOn: new Date() }) === '');
ok('a number is not a day key', api.qReleaseOn({ releaseOn: 20260620 }) === '');
ok('a half-written date is not a day key', api.qReleaseOn({ releaseOn: '2026-6-2' }) === '');
ok('an empty string is not a day key', api.qReleaseOn({ releaseOn: '' }) === '');

/* ---------------- Scheduled vs released ---------------- */
ok('a date in the future is scheduled', api.qScheduled({ releaseOn: day(1) }, TODAY) === true);
ok('…and is therefore NOT released', api.qReleased({ releaseOn: day(1) }, TODAY) === false);
ok('TODAY is released, not scheduled', api.qScheduled({ releaseOn: TODAY }, TODAY) === false,
   'a question released today is a question with no schedule left');
ok('a date that has passed is released', api.qReleased({ releaseOn: day(-40) }, TODAY) === true);
ok('an unscheduled question is released', api.qReleased({ title: 'x' }, TODAY) === true);
ok('nothing at all is released', api.qReleased(null, TODAY) === true);
// THE FAIL-OPEN RULE. Both directions are silent; this is the one that leaves
// a question visible and badge-less rather than invisible for ever.
ok('an unreadable value is served, never withheld',
   api.qReleased({ releaseOn: 'next term' }, TODAY) === true &&
   api.qReleased({ releaseOn: new Date() }, TODAY) === true,
   'a question withheld by a value nobody can read never comes back');

/* ---------------- The words a person reads ---------------- */
ok('a label names the day', /\b2027\b/.test(api.qReleaseLabel('2027-01-12')));
ok('a label of a non-date is empty', api.qReleaseLabel('soon') === '' && api.qReleaseLabel('') === '');
ok('the label does not slip a day west of Singapore',
   /12/.test(api.qReleaseLabel('2027-01-12')) && !/11/.test(api.qReleaseLabel('2027-01-12')));
ok('one day away reads "tomorrow"', api.qReleaseWhen(day(1), TODAY) === 'tomorrow');
ok('twelve days away says so', api.qReleaseWhen(day(12), TODAY) === 'in 12 days');
ok('today reads "today"', api.qReleaseWhen(TODAY, TODAY) === 'today');
ok('days away is a whole number of days', api.qReleaseDaysAway(day(9), TODAY) === 9);

/* ---------------- The badge ---------------- */
// The chip reads TODAY for itself, so it is asked about a day that is
// really in the future rather than one relative to the fixture.
const chip = api.qReleaseChipHtml({ releaseOn: api.releaseDayFromNow(3) });
ok('a scheduled question wears a chip', /⏳/.test(chip) && /Releases/.test(chip));
ok('the chip says WHY it is not being served', /no student/i.test(chip));
ok('the chip says where to undo it', /Scheduled Questions/.test(chip));
ok('a released question wears none', api.qReleaseChipHtml({ releaseOn: '2001-01-01' }) === '');
ok('an unscheduled question wears none', api.qReleaseChipHtml({}) === '');
ok('the chip escapes what it prints', !/<script/i.test(api.qReleaseChipHtml({ releaseOn: '<script>' })));

/* ---------------- The pad remembers a batch, not a fortnight ---------------- */
ok('the pad stores under its own key', api.RAPID_RELEASE_KEY === 'sqRapidRelease');
api.setRapidRelease(api.releaseDayFromNow(4));
ok('a future date is kept', api.rapidRelease() === api.releaseDayFromNow(4));
api.setRapidRelease('');
ok('clearing it releases immediately', api.rapidRelease() === '');
api.setRapidRelease('2019-01-01');
ok('a date in the past is refused', api.rapidRelease() === '',
   'a pad left open overnight would stamp yesterday onto the morning batch');
ok('…and the author is told rather than left guessing', api.toasts.some(t => /after today/i.test(t[0])));
api.setRapidRelease('rubbish');
ok('a value that is not a date is refused', api.rapidRelease() === '');
store[api.RAPID_RELEASE_KEY] = '2019-05-05';   // a stale batch, read back next morning
ok('a stored date that has come round reads as none', api.rapidRelease() === '');

/* ---------------- The ONE writer ---------------- */
const stamp = (iso, today) => { const q = { id: 'q' }; api._rapidApplyRelease(q, iso); return q.releaseOn; };
ok('a future day key is stamped', stamp(api.releaseDayFromNow(5)) === api.releaseDayFromNow(5));
ok('no date writes NO field', stamp('') === undefined && stamp(null) === undefined && stamp(undefined) === undefined,
   'an unscheduled batch must leave the question byte-for-byte what it was');
ok('today writes no field', stamp(api.releaseToday()) === undefined);
ok('a date in the past writes no field', stamp('2001-01-01') === undefined,
   'the bank would fill with stale badges pointing at last year');
ok('a value that is not a day key writes no field', stamp('next term') === undefined && stamp(20260101) === undefined);
ok('it never throws on a missing question', api._rapidApplyRelease(null, '2030-01-01') === null);

/* ------------------------------------------------------------------ *
 * The plumbing, read as text: the batch is captured ONCE and carried. *
 * ------------------------------------------------------------------ */
const door = cut('function rapidAddFiles(files, how) {', 'function _rapidQueuePdf(', 'rapidAddFiles');
ok('the ONE DOOR reads the release date synchronously', /const release = rapidRelease\(\);/.test(door));
ok('…and hands it to every job it starts',
   (door.match(/startRapidJob\(file, level, \{ release \}\)/g) || []).length === 2,
   'a route that does not pass it re-reads the pad minutes later');
ok('the queue tells the author a date is on the batch', /Released|released/.test(door));

const startJob = cut('function startRapidJob(file, level, opts) {', 'async function processRapidJob', 'startRapidJob');
ok('startRapidJob captures the date on the same footing as the level',
   /const rel = \(o\.release === undefined \|\| o\.release === null\) \? rapidRelease\(\) : o\.release;/.test(startJob),
   'a caller that passes none must still behave exactly as it always did');
ok('the job card carries it', /release: rel,/.test(startJob));
ok('it is handed ON to the job rather than re-read there',
   /processRapidJob\(jobId, f, lv, Object\.assign\(\{\}, o, \{ release: rel \}\)\)/.test(startJob));
ok('a PDF carries the date into the PDF queue',
   /_rapidQueuePdf\(file,[\s\S]{0,200}o\.release === undefined \|\| o\.release === null \? rapidRelease\(\) : o\.release\)/.test(startJob));

const expand = cut('async function _rapidExpandPdf(file, level, release) {', 'function startRapidJob(', '_rapidExpandPdf');
ok('every page of a PDF is queued with the batch date', /^\s*release,$/m.test(expand),
   'a forty-page paper takes minutes, and the picker is live the whole time');

const queue = cut('function _rapidQueuePdf(', 'async function _rapidExpandPdf', '_rapidQueuePdf');
ok('the PDF queue stores the date', /_rapidPdfQueue\.push\(\{ file, level, release \}\)/.test(queue));
ok('…and the pump forwards it', /_rapidExpandPdf\(next\.file, next\.level, next\.release\)/.test(queue));

const job = cut('async function processRapidJob(jobId, file, batchLevel, opts) {', 'function _failRapidJob(', 'processRapidJob');
ok('EVERY question the page held is stamped', /_rapidApplyRelease\(q, o\.release\);/.test(job),
   'a page of five is five questions held to the same morning, not one');
ok('the stamp happens beside the level, inside the per-question loop',
   job.indexOf('_rapidApplyLevel(q, batchLevel);') < job.indexOf('_rapidApplyRelease(q, o.release);') &&
   job.indexOf('_rapidApplyRelease(q, o.release);') < job.indexOf('vettingList.unshift(q);'));

/* ---------------- It survives an edit ---------------- */
const owned = cut('const EDITOR_OWNED_QUESTION_FIELDS = new Set([', ']);', 'EDITOR_OWNED_QUESTION_FIELDS');
ok("'releaseOn' is NOT an editor-owned field", !/releaseOn/.test(owned),
   'the editor has no control for it, so carryOverQuestionMeta is what keeps a scheduled question scheduled across an edit');

/* ---------------- The badge is on every management surface ---------------- */
const vet = cut('function renderVettingList() {', '\nfunction _vetFocusScroll', 'renderVettingList');
ok('the vetting card shows the schedule', /qReleaseChipHtml\(q\)/.test(vet),
   'an approved batch whose cards said nothing is a schedule nobody knew they had set');
const bank = cut('  container.innerHTML = filtered.map(q => {', 'function bankTileHtml(q) {', 'bank list card');
ok('the bank list card shows it', /qReleaseChipHtml\(q\)/.test(bank));
const tile = cut('function bankTileHtml(q) {', '// ── Rest on a tile to read the question', 'bankTileHtml');
ok('the bank grid tile shows it', /qReleaseChipHtml\(q\)/.test(tile));
const wsq = cut('function renderWsQuestions() {', '\nfunction onWsCardClick', 'renderWsQuestions');
ok('the worksheet builder shows it', /qReleaseChipHtml\(q\)/.test(wsq),
   'this is where a teacher picks questions for Monday — an unbadged one goes on the sheet');

/* ---------------- Undoing it ---------------- */
const undo = cut('async function _bankSetRelease(id, iso) {', 'async function bankReleaseNow', '_bankSetRelease');
ok('a release-date change is a QUIET write', /saveQuestion\(q, \{ quiet: true \}\)/.test(undo),
   'moving a date is housekeeping, not a question authored, and must not land in a work-session log');
ok('a write that did not land is rolled back',
   /if \(!ok\) \{[\s\S]{0,160}return false;/.test(undo),
   'a page that has released a question the database still holds back looks right until the next sign-in');
ok('it looks in the vetting list too', /vettingList\.find/.test(undo),
   'a batch is very often still in vetting when the teacher comes looking');
const rows = cut('function _bankScheduledRows() {', 'function renderBankScheduled', '_bankScheduledRows');
ok('the page lists both lists', /take\(questionBank, 'bank'\);/.test(rows) && /take\(vettingList, 'vetting'\);/.test(rows));
ok('soonest first', /localeCompare/.test(rows));

/* ------------------------------------------------------------------ *
 * 🔒 THE LOCKED ROW — a scheduled question on a worksheet.            *
 *                                                                     *
 * An admin builds next term's sheet TODAY; a student handed that same *
 * sheet must not read the question before its date. Both halves fail  *
 * silently and in opposite directions:                                *
 *                                                                     *
 *  • The lock not applying serves next term's paper this week, on a   *
 *    sheet that prints and practises perfectly.                       *
 *  • The lock applying to the AUTHOR takes the question off the very  *
 *    surface it was scheduled to be built on, which reads as a save   *
 *    that failed.                                                     *
 *  • And a question SILENTLY dropped leaves a numbered sheet with a   *
 *    hole in it — which is what the note exists to prevent.           *
 * ------------------------------------------------------------------ */
{
  const shut = { id: 'a', releaseOn: api.releaseDayFromNow(3) };
  const shutLater = { id: 'b', releaseOn: api.releaseDayFromNow(30) };
  const open1 = { id: 'c' };
  const open2 = { id: 'd', releaseOn: api.releaseDayFromNow(-5) };

  api.setAuthor(true);
  ok('an AUTHOR is never locked out of a scheduled question',
     api.qLockedFrom(shut) === false,
     'the worksheet builder is the surface next term\'s sheet is built on');
  ok('an author\'s split keeps every question',
     api.qLockSplit([shut, open1, shutLater]).ready.length === 3 &&
     api.qLockSplit([shut, open1, shutLater]).locked.length === 0);

  api.setAuthor(false);
  ok('a STUDENT is locked out of a scheduled question', api.qLockedFrom(shut) === true);
  ok('…and never out of an ordinary one',
     api.qLockedFrom(open1) === false && api.qLockedFrom(open2) === false);
  ok('an unreadable date does not lock a student out',
     api.qLockedFrom({ releaseOn: new Date() }) === false,
     'the fail-OPEN rule has to hold here too, or a bad value hides a question for ever');

  const sp = api.qLockSplit([open1, shut, open2, shutLater]);
  ok('the split keeps the sheet\'s own ORDER in the ready half',
     sp.ready.map(q => q.id).join('') === 'cd');
  ok('…and every locked one is accounted for, never dropped',
     sp.locked.map(q => q.id).join('') === 'ab',
     'a question that is neither served nor reported is a hole in the numbering');
  ok('a hole in the list is skipped rather than thrown on',
     api.qLockSplit([open1, null, undefined, shut]).ready.length === 1);
  ok('nothing at all splits into nothing', api.qLockSplit(null).ready.length === 0);

  ok('the SOONEST date is the one named',
     api.qLockSoonest([shutLater, shut]) === shut.releaseOn,
     'naming the last of them sends a student away for a month when half opens on Monday');
  ok('nothing locked names no date', api.qLockSoonest([open1]) === '');

  const note = api.qLockNote([shut, shutLater]);
  ok('the note counts them', /2 questions/.test(note));
  ok('the note names WHEN, not just that something is missing',
     note.indexOf(api.qReleaseLabel(shut.releaseOn)) > 0,
     'a student told a question is missing and not told when it comes back has half the truth');
  ok('one locked question is not called "1 questions"',
     /1 question on this worksheet is/.test(api.qLockNote([shut])));
  ok('nothing locked says nothing at all', api.qLockNote([]) === '' && api.qLockNote(null) === '');
  api.setAuthor(false);
}

/* ---- …and the surfaces that have to ask it ---- */
{
  const resolver = cut('function _wsResolve(ws) {', 'function _wseCommit(', 'ws resolver');
  ok('the saved-worksheet resolver applies the lock',
     /qLockSplit\(/.test(resolver),
     'the preview, the print and the practice queue all read this one function');
  ok('_wsSavedQuestions serves the READY half',
     /function _wsSavedQuestions\(ws\) \{ return _wsResolve\(ws\)\.ready; \}/.test(resolver));
  ok('_wsLockedQuestions is its companion, never the deleted ones',
     /function _wsLockedQuestions\(ws\) \{ return _wsResolve\(ws\)\.locked; \}/.test(resolver));

  const empty = cut('function _wsEmptyMsg(ws) {', '\n}', 'empty message');
  ok('a wholly-locked sheet is not reported as deleted questions',
     /_wsLockedQuestions/.test(empty) && /qLockNote/.test(empty),
     '"no longer in the bank" sends somebody to rebuild a sheet that is perfectly fine and early');

  const launch = cut('function launchWorksheetPractice(questions, mode) {', '\n  // Shuffle', 'launch');
  ok('the ONE practice door splits the queue', /qLockSplit\(questions/.test(launch),
     'the builder\'s selection, a past paper and Ai-nstein all come through here');
  ok('…and SAYS what it is holding back', /qLockNote\(/.test(launch));
  ok('…and refuses rather than starting an empty session',
     /if \(!_lock\.ready\.length\)/.test(launch));
  ok('the mode is not switched on a refused launch',
     launch.indexOf('_lock.ready.length') < launch.indexOf('qpSetMode('),
     'a launch that never happens must not leave Quick Practice in fill-in-the-blanks');

  ok('the saved worksheet hands the WHOLE sheet to that one door',
     /launchWorksheetPractice\(r\.ready\.concat\(r\.locked\), mode\)/.test(src),
     'passing only the ready half means the lock is never reported');
  ok('the ✎ Questions editor keeps a locked row rather than hiding it',
     /wse-row-locked/.test(src) && /🔒 Not open yet/.test(src));
  ok('the My Worksheets card counts them', /not open yet<\/span>/.test(src));
  ok('printing a saved sheet says what it left off', /printing the other/.test(src));
}

/* ------------------------------------------------------------------ *
 * CENSUS — the test that fails on the NEXT pool, not the last one.    *
 *                                                                     *
 * `qWithinStudentLevel` is the gate every student-facing pool already  *
 * asks. A pool that caps by level and does NOT ask `qReleased` is a    *
 * pool that serves a scheduled question early, and nothing on any      *
 * screen would say so — so it fails here instead.                      *
 * ------------------------------------------------------------------ */
// Extra pools that reach a student without asking the level gate — named by
// hand because there is nothing in their shape to find them by.
const STUDENT_POOLS = ['getQuestionsForLevel', 'tpRenderTopics', 'commRenderQuestPicker'];
// A function that caps by level and legitimately needs no release check, with
// a written reason. A stale name fails too: that is how a renamed function
// slips back through.
const NO_RELEASE_GATE_BY_DESIGN = {};

{
  // NOTE: no block-comment stripping. `accept="image/*"` inside a template
  // literal opens a `/*` that a naive stripper runs with for forty thousand
  // lines, and the function this census is about disappears into it. Lines are
  // read as they are, with a line comment trimmed off each and whole-comment
  // lines skipped — which is what keeps prose mentioning `qReleased` from
  // passing a pool that never calls it.
  const lines = src.split('\n');
  const code = lines.map(l => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
    return l.replace(/(^|[^:"'`\\])\/\/.*$/, (m, a) => a);
  });
  const starts = [];
  lines.forEach((l, i) => {
    const m = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.exec(l);
    if (m) starts.push({ i, name: m[1] });
  });
  starts.push({ i: lines.length, name: '<eof>' });

  const offenders = [], seen = new Set(), covered = new Set();
  for (let k = 0; k < starts.length - 1; k++) {
    const { i: a, name } = starts[k];
    const body = code.slice(a, starts[k + 1].i).join('\n');
    const caps = /\bqWithinStudentLevel\b/.test(body);
    const listed = STUDENT_POOLS.indexOf(name) >= 0;
    if (!caps && !listed) continue;
    if (name === 'qWithinStudentLevel' || name === 'qReleased' || name === 'qScheduled') continue;
    if (listed) covered.add(name);
    if (/\bqReleased\b/.test(body)) continue;
    seen.add(name);
    if (!NO_RELEASE_GATE_BY_DESIGN[name]) offenders.push(name + ' (app.js:' + (a + 1) + ')');
  }
  ok('CENSUS: every pool that caps by level also asks qReleased',
     !offenders.length,
     'these serve students and would serve a scheduled question early — add `qReleased(q)`\n' +
     '           beside the level check, or a written reason to NO_RELEASE_GATE_BY_DESIGN in this file:\n             ' +
     offenders.join('\n             '));
  ok('CENSUS: every hand-named student pool still exists',
     STUDENT_POOLS.every(n => covered.has(n)),
     'renamed or gone: ' + STUDENT_POOLS.filter(n => !covered.has(n)).join(', '));
  const stale = Object.keys(NO_RELEASE_GATE_BY_DESIGN).filter(n => !seen.has(n));
  ok('CENSUS: no stale exemption', !stale.length,
     'these now ask the gate (or are gone) — drop them before the name is reused: ' + stale.join(', '));

  // The census can only speak for the pools it can SEE. If it ever stops
  // finding a crowd of them, it has silently stopped testing anything.
  const capping = starts.filter((s2, k) =>
    k < starts.length - 1 && /\bqWithinStudentLevel\b/.test(code.slice(s2.i, starts[k + 1].i).join('\n'))).length;
  ok('CENSUS: it can still see the pools it is about', capping >= 12,
     'only ' + capping + ' functions cap by level — the parse has broken, so this census is passing on nothing');
}

/* ---------------- The two schedules must not be confused ---------------- */
ok('the old scheduler still holds a COPY out of the bank',
   /collection\(db, 'users', currentUser\.uid, 'scheduledQuestions'\)/.test(src),
   'the two systems are deliberately different — one withholds the document, one withholds the serving');
ok('this one writes no collection of its own', !/scheduledReleases|releaseQueue/.test(src));

console.log((fails ? '✗ ' : '✓ ') + (ran - fails) + '/' + ran + ' scheduled-release checks passed');
process.exit(fails ? 1 : 0);
