// Polymath Online's rules (online/portal-core.js): who sees which class,
// what is released, the next two, reordering and the invitation email.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../online/portal-core.js');
const course = (over = {}) => ({ id: 'k', level: 'P5', subject: 'math', worksheetIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], currentIndex: -1, releasedThrough: -1, ...over });

function plainList(value) { return JSON.parse(JSON.stringify(value)); }

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

test('every portal email is sent as admin@polymathlc.com.sg, whoever invited', () => {
  const message = Core.inviteEmail({ role: 'student', level: 'P6', subjects: ['math'], email: 's@example.com' }, 'https://x/?invite=1', Core.SENDER_NAME);
  const mail = Core.portalMail('s@example.com', message, { inviteId: '1', sentBy: 'elsielcr@gmail.com' });
  assert.equal(mail.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.equal(mail.replyTo, 'admin@polymathlc.com.sg');
  assert.deepEqual(plainList(mail.to), ['s@example.com']);
  assert.equal(mail.polymathOnline.sender, 'admin@polymathlc.com.sg');
  assert.equal(mail.polymathOnline.sentBy, 'elsielcr@gmail.com');
  assert.match(message.text, /^Hello,\n\nPolymath Learning Centre has invited you/);
  assert.ok(!/Mr Chung|elsie/i.test(message.text + message.html));
});

test('emails are checked and normalised', () => {
  assert.equal(Core.isEmail('a@b.co'), true);
  assert.equal(Core.isEmail('nope'), false);
  assert.equal(Core.normalizeEmail('  Ethan.T@Gmail.com '), 'ethan.t@gmail.com');
  assert.equal(Core.initials('Ethan Tan'), 'ET');
  assert.equal(Core.initials('', 'mei@x.com'), 'M');
});


test('timeline: worksheets in teaching order, with their Ans Key edit date and recorded lessons', () => {
  const course = { worksheetIds: ['a', 'b', 'c', 'd', 'e', 'f'], currentIndex: 2, releasedThrough: 4 };
  const docs = {
    a: { name: 'WS A', updatedAt: { seconds: 1760256300, nanoseconds: 0 }, pageCount: 2 },
    b: { name: 'WS B', updatedAt: { toMillis: () => 1760342700000 } },
    c: { name: 'WS C', createdAt: { seconds: 1760000000 }, annotations: '' }
  };
  const recordings = { c: Core.lessonRecordings(JSON.stringify([{ id: 'r', type: 'video', url: 'u', ts: 5, lessonRecording: { version: 1, duration: 90000 } }])) };
  const items = plainList(Core.timelineItems(course, docs, recordings));
  assert.deepEqual(items.map((i) => i.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(items.map((i) => i.state), ['released', 'released', 'current', 'next', 'next']);
  assert.equal(items[0].edited, 1760256300000);
  assert.equal(items[1].edited, 1760342700000);
  assert.equal(items[2].edited, 1760000000000, 'falls back to when it was uploaded');
  assert.equal(items[3].edited, 0);
  assert.equal(items[3].loading, true);
  assert.equal(items[3].name, 'Worksheet 4');
  assert.equal(items[0].pages, 2);
  assert.equal(items[0].marked, false);
  assert.equal(Core.timelineItems(course, { a: { annotations: '[{"id":"p","type":"pen"}]' } })[0].marked, true);
  assert.equal(Core.timelineItems(course, { a: { annotationsPath: 'pdf-annotator/a.annotations.json' } })[0].marked, true);
  assert.deepEqual(items[2].recordings.map((r) => [r.id, r.duration]), [['r', 90]]);
});

test('timeline: recorded lessons are only Ans Key lesson recordings, newest first', () => {
  const list = [
    { id: 'pen', type: 'pen' },
    { id: 'yt', type: 'video', url: 'https://youtu.be/x' },
    { id: 'a', type: 'video', url: 'u1', ts: 10, lessonRecording: { version: 1, duration: 724000, title: 'Q5', video: true } },
    { id: 'b', type: 'video', url: 'u2', ts: 20, lessonRecording: { version: 1, duration: 61000 } },
    { id: '', type: 'video', url: 'u3', ts: 30, lessonRecording: { version: 1 } }
  ];
  const recs = plainList(Core.lessonRecordings(JSON.stringify(list)));
  assert.deepEqual(recs.map((r) => r.id), ['b', 'a']);
  assert.equal(recs[1].title, 'Q5');
  assert.equal(recs[1].video, true);
  assert.equal(recs[0].title, 'Lesson recording');
  assert.equal(Core.formatDuration(recs[1].duration), '12:04');
  assert.equal(Core.formatDuration(3729), '1:02:09');
  assert.deepEqual(plainList(Core.lessonRecordings('not json')), []);
  assert.deepEqual(plainList(Core.lessonRecordings(null)), []);
});

test('timeline: dates read like a person wrote them', () => {
  const ms = new Date(2026, 9, 12, 16, 5).getTime();
  assert.equal(Core.formatDay(ms, new Date(2026, 11, 1).getTime()), 'Mon 12 Oct');
  assert.equal(Core.formatDay(ms, new Date(2027, 0, 5).getTime()), 'Mon 12 Oct 2026');
  assert.equal(Core.formatClock(ms), '4:05 pm');
  assert.equal(Core.formatClock(new Date(2026, 0, 1, 0, 9).getTime()), '12:09 am');
  assert.equal(Core.formatDay(0), '');
  assert.equal(Core.toMillis('2026-10-12T08:05:00Z'), Date.UTC(2026, 9, 12, 8, 5));
  assert.equal(Core.toMillis({ _seconds: 2 }), 2000);
  assert.equal(Core.toMillis(undefined), 0);
});

test('Ans Key links: view, replay a lesson, print the answers, nothing unexpected', () => {
  assert.equal(Core.anskeyLink('../anskey/', 'w 1'), '../anskey/?ws=w%201');
  assert.equal(Core.anskeyLink('../anskey/', 'w1', 'play', 'rec-1'), '../anskey/?ws=w1&do=play&rec=rec-1');
  assert.equal(Core.anskeyLink('../anskey/', 'w1', 'play'), '../anskey/?ws=w1&do=play');
  assert.equal(Core.anskeyLink('../anskey/', 'w1', 'print-answers', 'ignored'), '../anskey/?ws=w1&do=print-answers');
  assert.equal(Core.anskeyLink('../anskey/', 'w1', 'delete'), '../anskey/?ws=w1');
});

test('a re-render only puts back what someone is typing, never a file picker', () => {
  for (const [tag, type] of [['INPUT', 'text'], ['INPUT', ''], ['INPUT', 'email'], ['INPUT', 'number'], ['TEXTAREA', ''], ['SELECT', 'select-one']]) {
    assert.equal(Core.keepsTyping(tag, type), true, tag + ' ' + type);
  }
  for (const [tag, type] of [['INPUT', 'file'], ['INPUT', 'checkbox'], ['INPUT', 'radio'], ['INPUT', 'button'], ['BUTTON', ''], ['DIV', '']]) {
    assert.equal(Core.keepsTyping(tag, type), false, tag + ' ' + type);
  }
});

test('a batch of uploads reads as one line and one bar', () => {
  assert.deepEqual(Core.uploadSummary([]), { total: 0, added: 0, failed: 0, pct: 0, label: '' });
  const going = Core.uploadSummary([{ state: 'added', pct: 100 }, { state: 'uploading', pct: 50 }, { state: 'waiting', pct: 0 }, { state: 'waiting', pct: 0 }]);
  assert.equal(going.label, 'Uploading 2 of 4…');
  assert.equal(going.pct, 38);
  assert.equal(Core.uploadSummary([{ state: 'added' }, { state: 'added' }]).label, 'All 2 uploaded');
  assert.equal(Core.uploadSummary([{ state: 'added' }]).label, 'Uploaded');
  const mixed = Core.uploadSummary([{ state: 'added' }, { state: 'failed: storage/unauthorized' }]);
  assert.equal(mixed.label, '1 of 2 uploaded, 1 failed');
  assert.equal(mixed.pct, 100);
  assert.equal(Core.uploadStateLabel('waiting'), 'queued');
  assert.equal(Core.uploadStateLabel('added'), '✓ added');
  assert.equal(Core.uploadStateLabel('failed: x'), 'failed: x');
});
