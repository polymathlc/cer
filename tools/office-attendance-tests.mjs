// Tests for attendance (office/attendance-core.mjs) and how an absence shows in
// the WhatsApp lesson updates and the weekly parent reports.
// Run: node --test tools/office-attendance-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as A from '../office/attendance-core.mjs';
import * as L from '../office/lesson-updates-core.mjs';
import * as W from '../office/weekly-report-core.mjs';
import * as F from './weekly-report-fixtures.mjs';

const require = createRequire(import.meta.url);
const clock = require('../online/lesson-clock.js');
const SG = 8 * 3600 * 1000;
const sg = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - SG;

// Thursday 19 Nov 2026, THU-2 is 5:00pm – 6:45pm.
const DAY = '2026-11-19';
const START = sg(2026, 11, 19, 17, 0);
const lesson = { start: START, end: START + 105 * 60000, release: START + 120 * 60000 };
function day(extra) {
  return A.normalizeAttendDay(Object.assign({
    kind: 'attendance-day', day: DAY,
    live: { 'THU-2': { epoch: 9, slot: 'THU-2', label: 'Thu 5:00pm · P5 Maths', start: lesson.start, end: lesson.end, release: lesson.release,
      startedAt: START - 5 * 60000, dueAt: START + 10 * 60000, checkedAt: START + 11 * 60000,
      expected: { famA_kid1: 'Ethan Tan', famB_kid3: 'Ryan Lim', famC_kid4: 'Zoe Goh' }, joined: { famA_kid1: START + 2 * 60000 } } },
    alerts: { 'THU-2__famB_kid3': { late: { at: START + 11 * 60000, to: ['lim@example.com'], id: 'm1' } } }
  }, extra || {}));
}

test('the day\'s record is cleaned: bad slots, ids and marks are dropped', () => {
  const d = A.normalizeAttendDay({
    live: { 'THU-2': { expected: { famA_kid1: 'Ethan', 'bad id': 'x' }, joined: { famA_kid1: 5, famB_kid3: 'x' } }, 'nope': {} },
    marks: { 'THU-2__famA_kid1': { s: 'here', by: 'office' }, 'THU-2__famB_kid3': { s: 'maybe' }, 'junk': { s: 'here' } },
    alerts: { 'THU-2__famA_kid1': { late: { at: 7, to: ['a@b.co'] } }, 'THU-2__famB_kid3': {} },
    wa: { 'THU-2__famA_kid1': { at: 9, by: 'me' } }
  });
  assert.deepEqual(Object.keys(d.live), ['THU-2']);
  assert.deepEqual(d.live['THU-2'].expected, { famA_kid1: 'Ethan' });
  assert.deepEqual(d.live['THU-2'].joined, { famA_kid1: 5 });
  assert.deepEqual(Object.keys(d.marks), ['THU-2__famA_kid1']);
  assert.deepEqual(Object.keys(d.alerts), ['THU-2__famA_kid1']);
  assert.equal(d.wa['THU-2__famA_kid1'].at, 9);
  assert.deepEqual(A.splitKey('THU-2__famA_kid1'), { slotId: 'THU-2', rosterId: 'famA_kid1' });
  assert.equal(A.splitKey('THU-2famA'), null);
  assert.equal(A.attendDocId(DAY), 'attend-2026-11-19');
  const byDay = A.attendanceByDay([{ id: 'attend-2026-11-19', kind: 'attendance-day' }, { id: 'weekly-x', kind: 'weekly-report' }]);
  assert.deepEqual(Object.keys(byDay), ['2026-11-19']);
});

test('one child at one lesson: joined, absent, not joined yet, a hand mark wins, and "not taken"', () => {
  const att = day();
  const at = (rosterId, now, extra) => A.childAttendance(Object.assign({ att, slotId: 'THU-2', rosterId, lesson, now }, extra || {}));
  assert.equal(at('famA_kid1', START + 20 * 60000).s, 'here');
  assert.equal(at('famA_kid1', START + 20 * 60000).joinedAt, START + 2 * 60000);
  assert.equal(at('famB_kid3', START + 5 * 60000).s, 'waiting', 'the check is due at 5:10');
  const early = A.childAttendance({ att: A.normalizeAttendDay({ live: { 'THU-2': Object.assign({}, att.live['THU-2'], { dueAt: START + 10 * 60000 }) } }), slotId: 'THU-2', rosterId: 'famB_kid3', lesson, now: START + 5 * 60000 });
  assert.equal(early.s, 'waiting');
  const late = at('famB_kid3', START + 30 * 60000);
  assert.equal(late.s, 'missing');
  assert.equal(late.lateAlert, START + 11 * 60000);
  assert.equal(at('famB_kid3', lesson.end + 1).s, 'absent', 'the lesson is over');
  assert.equal(at('famB_kid3', lesson.end + 1).how, 'live');
  assert.equal(at('famZ_kid9', lesson.end + 1).s, 'unknown', 'a child the class did not expect is not blamed');
  // A live-lesson row is proof enough.
  assert.equal(at('famC_kid4', lesson.end + 1, { row: { d: START } }).s, 'here');
  // Hand marks win both ways.
  const marked = A.normalizeAttendDay(Object.assign({}, att, { live: { 'THU-2': att.live['THU-2'] }, marks: { 'THU-2__famB_kid3': { s: 'here' }, 'THU-2__famA_kid1': { s: 'absent' } } }));
  assert.equal(A.childAttendance({ att: marked, slotId: 'THU-2', rosterId: 'famB_kid3', lesson, now: lesson.end + 1 }).s, 'here');
  assert.equal(A.childAttendance({ att: marked, slotId: 'THU-2', rosterId: 'famA_kid1', lesson, now: lesson.end + 1 }).s, 'absent');
  // No live class and no mark: nothing is said.
  assert.equal(A.childAttendance({ att: null, slotId: 'THU-2', rosterId: 'famA_kid1', lesson, now: lesson.end + 1 }).s, 'unknown');
  assert.equal(A.childAttendance({ att: null, slotId: 'THU-2', rosterId: 'famA_kid1', lesson, now: START - 1 }).s, 'upcoming');
  assert.equal(A.isAbsent({ s: 'missing' }), true);
  assert.equal(A.isAbsent({ s: 'unknown' }), false);
  // Late joiners are flagged.
  const lateJoin = A.normalizeAttendDay({ live: { 'THU-2': Object.assign({}, att.live['THU-2'], { joined: { famA_kid1: START + 25 * 60000 } }) } });
  assert.equal(A.childAttendance({ att: lateJoin, slotId: 'THU-2', rosterId: 'famA_kid1', lesson, now: lesson.end }).late, true);
});

test('words for parents and for the office', () => {
  assert.equal(A.absentLine('Ethan'), 'Ethan was absent from today\'s lesson.');
  assert.equal(A.absentLine('Ethan and Chloe', true), 'Ethan and Chloe were absent from today\'s lesson.');
  assert.match(A.catchUpLine('Ratio 2', '7:00pm'), /^📚 To catch up: work through "Ratio 2" and check it with the answer key and lesson video on Polymath Online \(from 7:00pm\): https:\/\/polymathlc\.com\.sg\/online\/$/);
  const msg = A.notJoinedMessage({ parentName: 'Mrs Tan', children: ['Ethan'], classTitle: 'P5 Maths', startText: '5:00pm' });
  assert.match(msg, /^Hi Mrs Tan, Ethan has not joined today's P5 Maths lesson yet \(it started at 5:00pm\)\./);
  assert.match(msg, /Join here: https:\/\/polymathlc\.com\.sg\/live\//);
  assert.match(A.notJoinedMessage({ parentName: 'Parent', children: ['Ethan', 'Chloe'], classTitle: 'P5 Maths', startText: '5:00pm' }), /^Hi there, Ethan and Chloe have not joined/);
  const ck = t => W.clockText(t);
  assert.equal(A.statusWords({ s: 'here', how: 'live', joinedAt: START + 25 * 60000, late: true }, ck), 'Joined 5:25pm (late)');
  assert.equal(A.statusWords({ s: 'absent', how: 'mark' }, ck), 'Absent (marked by hand)');
  assert.equal(A.statusWords({ s: 'missing', lateAlert: START + 10 * 60000 }, ck), 'Not joined yet · parent emailed 5:10pm');
  assert.equal(A.statusWords({ s: 'unknown' }, ck), 'Attendance not taken (no live class)');
});

test('💬 lesson update: an absent child is said to be absent, with the catch-up, never "how they did"', () => {
  const base = { parentName: 'Mrs Tan', classTitle: 'P5 Maths', when: 'Thu 19 Nov, 5:00pm', covered: { name: 'Ratio 2' }, next: { name: 'Ratio 3' }, nextDate: 'Thu 27 Nov',
    homework: 'Finish Q1-10', online: true, releaseText: '7:00pm', showNext: true, showLink: true, signoff: 'Thanks!' };
  const one = L.lessonMessage(Object.assign({}, base, { children: [{ first: 'Ethan', perf: '', absent: true }] }));
  assert.match(one, /⚠️ Ethan was absent from today's lesson\./);
  assert.match(one, /✏️ The class covered: Ratio 2/);
  assert.match(one, /📚 To catch up: work through "Ratio 2"/);
  assert.doesNotMatch(one, /How Ethan did/);
  assert.doesNotMatch(one, /🔑 The answer key/, 'the catch-up line replaces it');
  const two = L.lessonMessage(Object.assign({}, base, { children: [{ first: 'Ethan', perf: 'answered 5 of 5 questions.' }, { first: 'Chloe', perf: '', absent: true }] }));
  assert.match(two, /⭐ How they did:\n• Ethan answered 5 of 5 questions\.\n• Chloe was absent today/);
  assert.match(two, /📚 To catch up/);
  const here = L.lessonMessage(Object.assign({}, base, { children: [{ first: 'Ethan', perf: 'answered 5 of 5 questions.' }] }));
  assert.match(here, /⭐ How Ethan did: answered 5 of 5/);
  assert.match(here, /🔑 The answer key and lesson video/);
  assert.doesNotMatch(here, /absent/);
});

test('💬 a whole day: the record decides who is absent, and the office sees the class\'s attendance', () => {
  const schedule = { slots: { 'THU-2': { level: 'P5', subject: 'Math', mode: 'Both', status: 'open' } } };
  const families = [
    { id: 'famA', parentName: 'Mrs Tan', whatsapp: '91234567', status: 'active', students: [{ id: 'kid1', name: 'Ethan Tan', level: 'P5', status: 'active', classes: [{ slotId: 'THU-2' }] }] },
    { id: 'famB', parentName: 'Mr Lim', whatsapp: '98765432', status: 'active', students: [{ id: 'kid3', name: 'Ryan Lim', level: 'P5', status: 'active', classes: [{ slotId: 'THU-2' }] }] }
  ];
  const roster = new Map([['THU-2', [
    { familyId: 'famA', studentId: 'kid1', name: 'Ethan Tan', level: 'P5', status: 'active', parentName: 'Mrs Tan', whatsapp: '91234567' },
    { familyId: 'famB', studentId: 'kid3', name: 'Ryan Lim', level: 'P5', status: 'active', parentName: 'Mr Lim', whatsapp: '98765432' }
  ]]]);
  const courses = [{ id: 'cm', level: 'P5', subject: 'math', day: 'Thursday', slot: 1, worksheetIds: ['m1', 'm2', 'm3'], currentIndex: 1, clockAt: sg(2026, 11, 12, 19, 0) }];
  const ctx = { day: DAY, schedule, roster, families, courses, docNames: { m1: 'Ratio 1', m2: 'Ratio 2', m3: 'Ratio 3' },
    live: { famA_kid1: [{ e: 9, d: START - 4 * 60000, q: 5, a: 5, r: 4, h: 0, k: 5, s: 30, f: 90, m: 100, l: '' }] }, clock, lu: L.normalizeLu({}), dayDoc: L.normalizeDay({}), att: day() };
  // During the lesson, 30 minutes in: Ryan has not joined, so his parent can get the one-tap WhatsApp.
  const during = L.dayClasses(Object.assign({}, ctx, { now: START + 30 * 60000 }))[0];
  const ryan = during.families.find(f => f.familyId === 'famB');
  assert.equal(ryan.missing, 1);
  assert.match(ryan.notJoined, /^Hi Mr Lim, Ryan has not joined today's P5 Maths lesson yet \(it started at 5:00pm\)/);
  assert.equal(during.attendance.here, 1);
  assert.equal(during.attendance.missing, 1);
  // After the lesson: Ryan's message says he was absent; Ethan's says how he did.
  const after = L.dayClasses(Object.assign({}, ctx, { now: lesson.release + 60000 }))[0];
  const r2 = after.families.find(f => f.familyId === 'famB');
  const e2 = after.families.find(f => f.familyId === 'famA');
  assert.equal(r2.absent, 1);
  assert.equal(r2.notJoined, '');
  assert.match(r2.text, /⚠️ Ryan was absent from today's lesson\./);
  assert.match(r2.text, /📚 To catch up: work through "Ratio 2"/);
  assert.doesNotMatch(r2.text, /How Ryan did/);
  assert.equal(r2.hasLive, true, 'no "no live-lesson record" warning for an absent child');
  assert.match(e2.text, /⭐ How Ethan did: answered 5 of 5 questions/);
  assert.equal(after.attendance.absent, 1);
  // The office marks Ryan here (he was on Zoom): the message no longer says absent.
  const fixed = Object.assign({}, ctx, { now: lesson.release + 60000, att: A.normalizeAttendDay({ live: { 'THU-2': day().live['THU-2'] }, marks: { 'THU-2__famB_kid3': { s: 'here', by: 'office' } } }) });
  const r3 = L.dayClasses(fixed)[0].families.find(f => f.familyId === 'famB');
  assert.doesNotMatch(r3.text, /absent/);
  // No attendance record at all: the messages are exactly as before.
  const none = L.dayClasses(Object.assign({}, ctx, { now: lesson.release + 60000, att: null }))[0];
  assert.doesNotMatch(none.families.find(f => f.familyId === 'famB').text, /absent/);
  assert.equal(none.attendance.live, false);
  assert.equal(none.attendance.absent, 0);
});

test('📈 weekly report: a missed lesson is shown as absent, its worksheet is never ticked, and catching up comes first', () => {
  // Ethan (famA_kid1) missed Wednesday 18 Nov's P5 Maths (WED-2), by the office's hand mark.
  const attendance = W.attendanceDocs([
    { id: 'attend-2026-11-18', kind: 'attendance-day', marks: { 'WED-2__famA_kid1': { s: 'absent', by: 'office' } } },
    { id: 'attend-2026-11-21', kind: 'attendance-day', live: { 'SAT-1': { start: sg(2026, 11, 21, 9, 0), end: sg(2026, 11, 21, 10, 45), release: sg(2026, 11, 21, 11, 0),
      dueAt: sg(2026, 11, 21, 9, 10), checkedAt: sg(2026, 11, 21, 9, 12), final: true, expected: { famA_kid1: 'Ethan Tan', famB_kid3: 'Ryan Lim' }, joined: { famA_kid1: sg(2026, 11, 21, 9, 1), famB_kid3: sg(2026, 11, 21, 9, 5) } } } },
    { id: 'weeklyfam-x', kind: 'weekly-family' }
  ]);
  assert.deepEqual(Object.keys(attendance).sort(), ['2026-11-18', '2026-11-21']);
  const win = W.weekWindow(W.weekKeyFor(F.SUNDAY_6PM), F.SUNDAY_6PM);
  assert.ok(W.weekAttendanceIds(win).includes('attend-2026-11-18'));
  // WED-2's course is at worksheet 1 (index 0) with clockAt 17 Nov: give it one lesson to have taught.
  const courses = F.courses.map(c => (c.id === 'c2' ? Object.assign({}, c, { currentIndex: 1, clockAt: sg(2026, 11, 11, 19, 0) }) : c));
  const live = W.liveRowsByRoster([F.progressBook]);
  const fam = F.families[0];
  const ctx = { schedule: F.schedule, courses, docNames: F.docNames, live, practice: {}, tags: null, clock, win, now: F.SUNDAY_6PM, attendance };
  const ch = W.childReport(fam, fam.students[0], ctx);
  assert.equal(ch.attendance.missed, 1);
  assert.equal(ch.attendance.taken, 2);
  assert.equal(ch.attendance.attended, 1);
  assert.equal(ch.missed[0].title.includes('Math') || ch.missed[0].title.includes('Maths'), true);
  assert.match(W.attendanceWords(ch), /^Attended 1 of 2 lessons this week · Absent: Wed 18 Nov \(P5 Maths\)$/);
  const maths = ch.classes.find(c => c.slotId === 'WED-2');
  assert.equal(maths.taught.length, 1);
  assert.equal(maths.taught[0].missed, true);
  assert.match(ch.next[0], /^Catch up on the P5 Maths lesson \(“Ratio 1”\) missed on Wed 18 Nov/);
  const html = W.childSectionHtml(ch);
  assert.match(html, /❌ <b>Attendance:<\/b> Attended 1 of 2 lessons this week · Absent: Wed 18 Nov \(P5 Maths\)/);
  assert.match(html, /✗ Ratio 1<\/span> <span[^>]*>\(Wed 18 Nov · absent — catch up on Polymath Online\)/);
  assert.doesNotMatch(html, /✓ Ratio 1/);
  const text = W.childSectionText(ch);
  assert.match(text, /Attendance: Attended 1 of 2 lessons this week · Absent: Wed 18 Nov \(P5 Maths\)/);
  assert.match(text, /✗ Ratio 1 \(Wed 18 Nov, absent — catch up on Polymath Online\)/);
  // A child whose only news is an absence still gets a report that says so.
  const chloe = W.childReport(fam, fam.students[1], Object.assign({}, ctx, { attendance: W.attendanceDocs([{ id: 'attend-2026-11-17', kind: 'attendance-day', marks: { 'TUE-3__famA_kid2': { s: 'absent' } } }]) }));
  assert.equal(chloe.active, true);
  assert.match(W.attendanceWords(chloe), /Absent: Tue 17 Nov/);
  // Without any record the report is as before (no attendance line).
  const plain = W.childReport(fam, fam.students[0], Object.assign({}, ctx, { attendance: {} }));
  assert.equal(W.attendanceWords(plain), 'Attended 2 of 2 lessons this week', 'both lessons have a live-lesson row');
  const ryan = W.childReport(F.families[1], F.families[1].students[0], Object.assign({}, ctx, { attendance: {}, live: {} }));
  assert.equal(W.attendanceWords(ryan), '', 'nothing taken, nothing said');
  assert.equal(plain.classes.find(c => c.slotId === 'WED-2').taught[0].missed, undefined);
});
