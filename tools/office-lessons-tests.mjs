// Tests for the parent WhatsApp lesson updates (office/lesson-updates-core.mjs).
// Offline, on the same small centre as the weekly reports.
//   node --test tools/office-lessons-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../office/lesson-updates-core.mjs';
import * as C from '../office/office-core.mjs';
import * as W from '../office/weekly-report-core.mjs';
import { clock, sg, schedule, families, courses, docNames, progressBook } from './weekly-report-fixtures.mjs';

const SAT = '2026-11-21';                 // Saturday: P5 Science, 9:00am (SAT-1)
const live = () => W.liveRowsByRoster([progressBook]);
const roster = () => C.slotRoster(families, schedule);
const ctx = (extra) => Object.assign({
  day: SAT, now: sg(2026, 11, 21, 11, 30), schedule, roster: roster(), families, courses, docNames,
  live: live(), clock, lu: L.normalizeLu({}), dayDoc: L.normalizeDay({})
}, extra || {});

/* ─── 1. Days ─── */
test('days are Singapore days, with friendly labels', () => {
  assert.equal(L.sgToday(sg(2026, 11, 21, 0, 30)), '2026-11-21', 'just after midnight in Singapore is already the new day');
  assert.equal(L.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(L.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(L.weekdayName(SAT), 'Saturday');
  assert.equal(L.weekdayName('2026-11-22'), 'Sunday');
  assert.equal(L.dayLabel(SAT, sg(2026, 11, 21, 10)), 'Today, Sat 21 Nov');
  assert.equal(L.dayLabel('2026-11-20', sg(2026, 11, 21, 10)), 'Yesterday, Fri 20 Nov');
  assert.equal(L.dayLabel('2026-11-22', sg(2026, 11, 21, 10)), 'Tomorrow, Sun 22 Nov');
  assert.equal(L.dayLabel('2026-11-18', sg(2026, 11, 21, 10)), 'Wed 18 Nov');
});

test('a slot\'s lesson on a day comes from the lesson clock', () => {
  const l = L.lessonOf('SAT-1', SAT, clock);
  assert.equal(l.start, sg(2026, 11, 21, 9));
  assert.equal(l.end, sg(2026, 11, 21, 10, 45));
  assert.equal(l.release, sg(2026, 11, 21, 11));
  assert.equal(L.lessonOf('SAT-1', '2026-11-20', clock), null, 'not on a Friday');
  assert.equal(L.lessonOf('WED-2', '2026-11-18', clock).start, sg(2026, 11, 18, 17));
  assert.equal(L.lessonState(l, sg(2026, 11, 21, 8)), 'upcoming');
  assert.equal(L.lessonState(l, sg(2026, 11, 21, 9, 30)), 'live');
  assert.equal(L.lessonState(l, sg(2026, 11, 21, 10, 50)), 'ending');
  assert.equal(L.lessonState(l, sg(2026, 11, 21, 11)), 'over');
  assert.equal(L.lessonState(null, 1), 'none');
});

test('the classes of a day are those with current students, in lesson-time order', () => {
  assert.deepEqual(L.classesOn(SAT, schedule, roster()), ['SAT-1']);
  assert.deepEqual(L.classesOn('2026-11-18', schedule, roster()), ['WED-2']);
  assert.deepEqual(L.classesOn('2026-11-22', schedule, roster()), [], 'no lessons on Sunday');
  assert.deepEqual(L.classesOn('2026-11-19', schedule, roster()), [], 'nothing on Thursday');
  const many = new Map([['MON-3', [{}]], ['MON-1', [{}]], ['MON-2', []], ['TUE-1', [{}]]]);
  assert.deepEqual(L.classesOn('2026-11-16', schedule, many), ['MON-1', 'MON-3'], 'an empty class is left out');
});

/* ─── 2. What was covered ─── */
test('the worksheet covered in a lesson, before and after it ends', () => {
  const c1 = courses[0];   // place 2 (Plant Transport) until the 21 Nov lesson released
  const l = L.lessonOf('SAT-1', SAT, clock);
  // During the lesson: the class is on Plant Transport.
  let ws = L.lessonWorksheets(c1, l, clock, sg(2026, 11, 21, 9, 30), docNames);
  assert.equal(ws.covered.name, 'Plant Transport');
  assert.equal(ws.next.name, 'Human Circulatory System');
  // After the release the class moved on, but the lesson still covered Plant Transport.
  ws = L.lessonWorksheets(c1, l, clock, sg(2026, 11, 21, 11, 30), docNames);
  assert.equal(ws.covered.name, 'Plant Transport');
  assert.equal(ws.next.name, 'Human Circulatory System');
  // A week later, after another lesson: still the same for that day.
  ws = L.lessonWorksheets(c1, l, clock, sg(2026, 11, 28, 12), docNames);
  assert.equal(ws.covered.name, 'Plant Transport');
  // The next Saturday's lesson covered the next one.
  const l2 = L.lessonOf('SAT-1', '2026-11-28', clock);
  ws = L.lessonWorksheets(c1, l2, clock, sg(2026, 11, 28, 12), docNames);
  assert.equal(ws.covered.name, 'Human Circulatory System');
  assert.equal(ws.next.name, 'Electrical Systems');
});

test('Finished pressed during the lesson does not shift what was covered', () => {
  const l = L.lessonOf('SAT-1', SAT, clock);
  const finished = Object.assign({}, courses[0], { currentIndex: 3, clockAt: sg(2026, 11, 21, 10, 40), finishedAt: sg(2026, 11, 21, 10, 40) });
  assert.equal(L.lessonWorksheets(finished, l, clock, sg(2026, 11, 21, 10, 50), docNames).covered.name, 'Plant Transport');
  assert.equal(L.lessonWorksheets(finished, l, clock, sg(2026, 11, 21, 12), docNames).covered.name, 'Plant Transport');
});

test('a class that has not started, or has no list, covers nothing', () => {
  const l = L.lessonOf('TUE-3', '2026-11-17', clock);
  assert.deepEqual(L.lessonWorksheets(courses[2], l, clock, sg(2026, 11, 17, 21), docNames), { covered: null, next: null, started: false });
  assert.equal(L.lessonWorksheets(null, l, clock, 1).covered, null);
  assert.equal(L.lessonWorksheets(Object.assign({}, courses[0], { worksheetIds: [] }), l, clock, 1).covered, null);
  // A worksheet without a name reads as its number.
  const l1 = L.lessonOf('SAT-1', SAT, clock);
  assert.equal(L.lessonWorksheets(courses[0], l1, clock, sg(2026, 11, 21, 9, 30), {}).covered.name, 'Worksheet 3');
});

/* ─── 3. How the child did ─── */
test('the live-lesson row of the lesson is found by its time', () => {
  const rows = live()['famA_kid1'];
  const sat = L.lessonOf('SAT-1', SAT, clock);
  assert.equal(L.liveRowFor(rows, sat).e, 1800);
  const wed = L.lessonOf('WED-2', '2026-11-18', clock);
  assert.equal(L.liveRowFor(rows, wed).e, 1801);
  assert.equal(L.liveRowFor(rows, L.lessonOf('SAT-1', '2026-11-28', clock)), null);
  assert.equal(L.liveRowFor([], sat), null);
  assert.equal(L.liveRowFor(rows, null), null);
  // Two rows in the same lesson (a reconnect): the one marked most wins.
  const two = [{ e: 1, d: sg(2026, 11, 21, 9, 1), q: 3, a: 1, r: 1, h: 0, k: 1, f: 50 }, { e: 2, d: sg(2026, 11, 21, 9, 40), q: 8, a: 7, r: 6, h: 0, k: 7, f: 90 }];
  assert.equal(L.liveRowFor(two, sat).e, 2);
});

test('how the child did, in words', () => {
  const r = { q: 8, a: 7, r: 3, h: 1, k: 7, f: 72 };
  assert.equal(L.performanceText(r), 'answered 7 of 8 questions; 3 of the 7 marked were right and 1 partly right (50%). ' + L.praiseFor(50));
  assert.equal(L.performanceText(r, { focus: true }), 'answered 7 of 8 questions; 3 of the 7 marked were right and 1 partly right (50%), focus 72%. ' + L.praiseFor(50));
  assert.equal(L.performanceText({ q: 8, a: 8, r: 8, h: 0, k: 8, f: -1 }), 'answered 8 of 8 questions; 8 of the 8 marked were right (100%). Excellent work! 🌟');
  assert.equal(L.performanceText({ q: 1, a: 1, r: 1, h: 0, k: 1, f: -1 }), 'answered 1 of 1 question; 1 of the 1 marked was right (100%). Excellent work! 🌟');
  assert.equal(L.performanceText({ q: 5, a: 4, r: 0, h: 0, k: 0, f: -1 }), 'answered 4 of 5 questions.', 'nothing marked: no score and no praise');
  assert.equal(L.performanceText({ q: 0, a: 0, r: 0, h: 0, k: 0, f: 80 }), 'took part in the live lesson.');
  assert.equal(L.performanceText(null), '');
  assert.equal(L.praiseFor(95), 'Excellent work! 🌟');
  assert.equal(L.praiseFor(85), 'Very good! 👏');
  assert.equal(L.praiseFor(65), 'Good effort 👍');
  assert.match(L.praiseFor(20), /need more practice/);
  assert.equal(L.praiseFor(null), '');
});

/* ─── 4. The message ─── */
test('one family, one class: the whole message', () => {
  const day = L.dayClasses(ctx());
  assert.equal(day.length, 1);
  const cl = day[0];
  assert.equal(cl.title, 'P5 Science');
  assert.equal(cl.state, 'over');
  assert.equal(cl.online, true);
  assert.deepEqual(cl.families.map(f => f.parentName), ['Mr Lim', 'Mrs Tan'], 'the withdrawn family is not in the class');
  const lim = cl.families[0];
  assert.equal(lim.phone, '6591234567');
  assert.equal(lim.hasLive, true);
  assert.equal(lim.text, [
    'Hi Mr Lim, here is Ryan\'s lesson update from Polymath Learning Centre 😊',
    '',
    '📚 *P5 Science* · Sat 21 Nov, 9:00am',
    '✏️ Today: Plant Transport',
    '⭐ How Ryan did: answered 8 of 8 questions; 8 of the 8 marked were right (100%). Excellent work! 🌟',
    '📝 Homework: ' + L.DEFAULT_HOMEWORK,
    '⏭ Next lesson (Sat 28 Nov): Human Circulatory System',
    '🔑 The answer key and lesson video are on Polymath Online: https://polymathlc.com.sg/online/',
    '',
    L.DEFAULT_SIGNOFF
  ].join('\n'));
  assert.deepEqual(cl.counts, { families: 2, ready: 1, sent: 0, noPhone: 1, optedOut: 0, noLive: 0 });
});

test('before the answer key opens, the message says when', () => {
  const cl = L.dayClasses(ctx({ now: sg(2026, 11, 21, 10, 50) }))[0];
  assert.equal(cl.state, 'ending');
  assert.match(cl.families[0].text, /on Polymath Online from 11:00am: https/);
});

test('siblings in one class are one message', () => {
  const fam = { id: 'famS', parentName: 'Mdm Wong', whatsapp: '8123 4567', status: 'active', students: [
    { id: 'a', name: 'Amy Wong', level: 'P5', status: 'active', classes: [{ slotId: 'SAT-1', mode: 'Physical' }] },
    { id: 'b', name: 'Ben Wong', level: 'P5', status: 'active', classes: [{ slotId: 'SAT-1', mode: 'Online' }] }] };
  const fams = families.concat([fam]);
  const book = { students: { 'r:famS_a': { rows: [{ e: 9, d: sg(2026, 11, 21, 9, 2), q: 4, a: 4, r: 4, h: 0, k: 4, f: 90 }] } } };
  const cl = L.dayClasses(ctx({ families: fams, roster: C.slotRoster(fams, schedule), live: W.liveRowsByRoster([progressBook, book]) }))[0];
  const w = cl.families.find(f => f.familyId === 'famS');
  assert.equal(w.children.length, 2);
  assert.equal(w.phone, '6581234567');
  assert.match(w.text, /^Hi Mdm Wong, here is Amy and Ben's lesson update/);
  assert.match(w.text, /⭐ How they did:\n• Amy answered 4 of 4 questions; 4 of the 4 marked were right \(100%\)\. Excellent work! 🌟\n📝/);
  assert.doesNotMatch(w.text, /• Ben/, 'no line for a child with no record');
  assert.equal(w.hasLive, true);
});

test('no live record: no "How … did" line, and the class counts it', () => {
  const cl = L.dayClasses(ctx({ live: {} }))[0];
  assert.ok(cl.families.every(f => !/How /.test(f.text)));
  assert.equal(cl.counts.noLive, 2);
  // The progress book could not be read at all: the same, nothing breaks.
  assert.ok(L.dayClasses(ctx({ live: null }))[0].families.every(f => !f.hasLive));
});

test('the class\'s own homework and note, and the settings, shape every message', () => {
  const dayDoc = L.normalizeDay({ notes: { 'SAT-1': { homework: 'Workbook p. 12–14', note: 'Test next Saturday!' } } });
  let cl = L.dayClasses(ctx({ dayDoc }))[0];
  assert.equal(cl.homeworkIsDefault, false);
  assert.match(cl.families[0].text, /📝 Homework: Workbook p\. 12–14\n/);
  assert.match(cl.families[0].text, /\n\nTest next Saturday!\n\nAny questions/);
  // An empty homework line for the class: no homework line at all.
  cl = L.dayClasses(ctx({ dayDoc: L.normalizeDay({ notes: { 'SAT-1': { homework: '' } } }) }))[0];
  assert.doesNotMatch(cl.families[0].text, /Homework/);
  // Settings: no score, no next lesson, no link, a new last line.
  const lu = L.normalizeLu({ showScore: false, showNext: false, showLink: false, signoff: 'See you next week!', homeworkDefault: '' });
  cl = L.dayClasses(ctx({ lu }))[0];
  const t = cl.families[0].text;
  assert.doesNotMatch(t, /How Ryan did|Next lesson|Polymath Online|Homework/);
  assert.match(t, /See you next week!$/);
  // Focus on.
  cl = L.dayClasses(ctx({ lu: L.normalizeLu({ showFocus: true }) }))[0];
  assert.match(cl.families[0].text, /\(100%\), focus 99%\./);
});

test('sent, edited and taken off the list', () => {
  const key = L.sendKey('SAT-1', 'famB');
  assert.equal(key, 'SAT-1__famB');
  const dayDoc = L.normalizeDay({ sent: { [key]: { at: sg(2026, 11, 21, 11, 5), by: 'chungzhikai@gmail.com' } }, edits: { [L.sendKey('SAT-1', 'famA')]: 'My own words' } });
  let cl = L.dayClasses(ctx({ dayDoc }))[0];
  const lim = cl.families.find(f => f.familyId === 'famB');
  const tan = cl.families.find(f => f.familyId === 'famA');
  assert.equal(lim.sent.at, sg(2026, 11, 21, 11, 5));
  assert.equal(tan.text, 'My own words');
  assert.equal(tan.edited, true);
  assert.match(tan.autoText, /^Hi Mrs Tan/);
  assert.deepEqual(cl.counts, { families: 2, ready: 0, sent: 1, noPhone: 1, optedOut: 0, noLive: 0 });
  assert.deepEqual(L.queueOf([cl]), []);
  cl = L.dayClasses(ctx({ lu: L.normalizeLu({ optOut: { famB: true } }) }))[0];
  assert.equal(cl.families.find(f => f.familyId === 'famB').optedOut, true);
  assert.deepEqual(L.queueOf([cl]), [], 'a family off the list is not queued');
  assert.equal(cl.counts.optedOut, 1);
});

test('the queue holds every family with a number not yet sent', () => {
  const cl = L.dayClasses(ctx())[0];
  assert.deepEqual(L.queueOf([cl]), [{ slotId: 'SAT-1', key: 'SAT-1__famB' }]);
  assert.deepEqual(L.queueOf([cl], 'WED-2'), []);
  assert.deepEqual(L.dayTotals([cl]), { classes: 1, families: 2, ready: 1, sent: 0, noPhone: 1 });
});

test('the WhatsApp link: WhatsApp Web on a computer, the app on a phone', () => {
  const t = 'Hi Mr Lim 😊\n*P5*';
  assert.equal(L.chatLink('91234567', t, true), 'https://web.whatsapp.com/send?phone=6591234567&text=' + encodeURIComponent(t));
  assert.equal(L.chatLink('6591234567', t, false), 'https://wa.me/6591234567?text=' + encodeURIComponent(t));
});

/* ─── 5. Stored data is read defensively ─── */
test('settings and day records are cleaned on read', () => {
  assert.deepEqual(L.normalizeLu(null), Object.assign({}, L.DEFAULT_LU, { optOut: {} }));
  const lu = L.normalizeLu({ showScore: 'yes', showFocus: true, optOut: { ok: true, 'bad id!': true, no: false }, homeworkDefault: '  x  ', signoff: 5 });
  assert.equal(lu.showScore, true);
  assert.equal(lu.showFocus, true);
  assert.deepEqual(lu.optOut, { ok: true });
  assert.equal(lu.homeworkDefault, 'x');
  assert.equal(lu.signoff, L.DEFAULT_SIGNOFF);
  assert.equal(L.familyOptedOut(lu, 'ok'), true);
  const d = L.normalizeDay({ sent: { a: { at: { seconds: 100 } }, b: { at: 0 }, c: 'x' }, edits: { a: '  hi ', b: '   ', c: 3 }, notes: { 'MON-1': { note: 'n' } } });
  assert.deepEqual(Object.keys(d.sent), ['a']);
  assert.equal(d.sent.a.at, 100000);
  assert.deepEqual(d.edits, { a: 'hi' });
  assert.deepEqual(d.notes['MON-1'], { homework: null, note: 'n' });
  assert.equal(L.dayDocId('2026-11-21'), 'lessonupd-2026-11-21');
  assert.equal(L.dayDocId('../x'), 'lessonupd-invalid');
  assert.equal(L.greetingName(''), 'there');
  assert.equal(L.greetingName('Parent'), 'there');
});

test('a very long message is cut to what WhatsApp links carry well', () => {
  const t = L.lessonMessage({ parentName: 'A', children: [{ first: 'B' }], classTitle: 'P5 Maths', when: 'Mon', homework: 'x'.repeat(5000), note: 'y'.repeat(5000), signoff: 'z' });
  assert.ok(t.length <= L.MESSAGE_MAX);
});
