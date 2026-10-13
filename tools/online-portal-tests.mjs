// Polymath Online's rules (online/portal-core.js): who sees which class,
// what is released, the next two, reordering and the invitation email.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../online/portal-core.js');
const course = (over = {}) => ({ id: 'k', level: 'P5', subject: 'math', worksheetIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], currentIndex: -1, releasedThrough: -1, ...over });

test('nothing is released until the class starts or an admin releases it', () => {
  const c = course();
  assert.deepEqual(Core.releasedWorksheets(c), []);
  assert.deepEqual(Core.nextWorksheets(c), []);
  assert.equal(Core.lockedCount(c), 10);
});

test('on worksheet 3, worksheets 1 to 8 are out and 4, 5 are next', () => {
  const update = Core.progressUpdate(course(), 2);
  assert.deepEqual(update, { currentIndex: 2, currentDocId: 'c', releasedThrough: 7 });
  const c = course(update);
  assert.deepEqual(Core.releasedWorksheets(c).map((w) => w.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  assert.deepEqual(Core.nextWorksheets(c).map((w) => w.id), ['d', 'e']);
  assert.equal(Core.worksheetState(c, 2), 'current');
  assert.equal(Core.worksheetState(c, 3), 'next');
  assert.equal(Core.worksheetState(c, 5), 'released');
  assert.equal(Core.worksheetState(c, 8), 'locked');
  assert.equal(Core.lockedCount(c), 2);
});

test('progress never goes backwards, except when an admin forces the position — and releases stay out', () => {
  const c = course({ currentIndex: 4, releasedThrough: 9 });
  assert.deepEqual(Core.progressUpdate(c, 1), { currentIndex: 4, currentDocId: 'e', releasedThrough: 9 });
  assert.deepEqual(Core.progressUpdate(c, 1, { force: true }), { currentIndex: 1, currentDocId: 'b', releasedThrough: 9 });
  assert.equal(Core.progressUpdate(c, 10), null);
  assert.equal(Core.progressUpdate(c, -1), null);
});

test('the next two never name a worksheet that is not released', () => {
  const c = course({ currentIndex: 2, releasedThrough: 3 });
  assert.deepEqual(Core.nextWorksheets(c).map((w) => w.id), ['d']);
  const end = course({ currentIndex: 9, releasedThrough: 9 });
  assert.deepEqual(Core.nextWorksheets(end), []);
});

test('a member sees only their level and subjects; P3 is Science only', () => {
  const classes = [course({ id: 'm5' }), course({ id: 's5', subject: 'science' }), course({ id: 'm6', level: 'P6' }), course({ id: 'old', archived: true })];
  assert.deepEqual(Core.coursesForMember(classes, { level: 'P5', subjects: ['science'] }).map((c) => c.id), ['s5']);
  assert.deepEqual(Core.coursesForMember(classes, { level: 'P5', subjects: ['math', 'science'] }).map((c) => c.id), ['m5', 's5']);
  assert.deepEqual(Core.coursesForMember(classes, { level: 'P5', subjects: 'both' }).map((c) => c.id), ['m5', 's5']);
  assert.deepEqual(Core.coursesForMember(classes, { level: 'P6', subjects: ['science'] }).map((c) => c.id), []);
  assert.deepEqual(Core.coursesForMember(classes, null), []);
  assert.deepEqual(Core.cleanSubjects('P3', ['math', 'science']), ['science']);
  assert.equal(Core.profileSubjectFor(['math', 'science']), 'both');
  assert.equal(Core.profileSubjectFor(['science']), 'science');
});

test('a reorder keeps the class on the same worksheet and the same number released', () => {
  const c = course({ currentIndex: 2, releasedThrough: 7 });
  const moved = Core.moveItem(c.worksheetIds, 2, 0);
  assert.deepEqual(moved.slice(0, 3), ['c', 'a', 'b']);
  assert.deepEqual(Core.remapProgress(c, moved), { currentIndex: 0, currentDocId: 'c', releasedThrough: 7 });
  const removed = c.worksheetIds.filter((id) => id !== 'c');
  assert.deepEqual(Core.remapProgress(c, removed), { currentIndex: -1, currentDocId: null, releasedThrough: 7 });
  const shorter = ['a', 'b', 'c'];
  assert.deepEqual(Core.remapProgress(c, shorter), { currentIndex: 2, currentDocId: 'c', releasedThrough: 2 });
});

test('files are added in the order a person numbers them', () => {
  const names = ['Worksheet 10.pdf', 'Worksheet 2.pdf', 'worksheet 1.pdf', 'Worksheet 2a.pdf'];
  assert.deepEqual(names.sort(Core.naturalCompare), ['worksheet 1.pdf', 'Worksheet 2.pdf', 'Worksheet 2a.pdf', 'Worksheet 10.pdf']);
  assert.equal(Core.worksheetNameFromFile('P5_Fractions_3.PDF'), 'P5 Fractions 3');
});

test('class names and sessions match Ans Key\'s three sessions a day', () => {
  assert.equal(Core.autoCourseTitle('P5', 'math', 'Monday', 1), 'P5 Mathematics · Monday 5:00pm');
  assert.equal(Core.autoCourseTitle('P4', 'science', 'Saturday', 0), 'P4 Science · Saturday 9:00am');
  assert.equal(Core.autoCourseTitle('P6', 'science', '', null), 'P6 Science');
});

test('the invitation email carries the link and escapes what people typed', () => {
  const link = Core.inviteLink('https://polymathlc.com.sg/online/', 'abc 123');
  assert.equal(link, 'https://polymathlc.com.sg/online/?invite=abc%20123');
  const mail = Core.inviteEmail({ name: '<b>Ethan</b>', role: 'parent', level: 'P5', subjects: ['math', 'science'], email: 'p@example.com' }, link, 'Mr Chung');
  assert.match(mail.text, /Join here: https:\/\/polymathlc\.com\.sg\/online\/\?invite=abc%20123/);
  assert.match(mail.text, /your child's P5 Mathematics and Science worksheets/);
  assert.ok(mail.html.includes('&lt;b&gt;Ethan&lt;/b&gt;') && !mail.html.includes('<b>Ethan</b>'));
  assert.ok(Core.mailtoLink({ email: 'p@example.com', level: 'P5', subjects: ['math'] }, link).startsWith('mailto:p%40example.com?subject='));
});

test('emails are checked and normalised', () => {
  assert.equal(Core.isEmail('a@b.co'), true);
  assert.equal(Core.isEmail('nope'), false);
  assert.equal(Core.normalizeEmail('  Ethan.T@Gmail.com '), 'ethan.t@gmail.com');
  assert.equal(Core.initials('Ethan Tan'), 'ET');
  assert.equal(Core.initials('', 'mei@x.com'), 'M');
});
