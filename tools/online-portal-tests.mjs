// Polymath Online's rules (online/portal-core.js): who sees which class,
// what is released, the next two, reordering and the invitation email.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

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

test('on worksheet 3, worksheets 1 to 6 are out (3 ahead) and 4, 5 are next', () => {
  assert.equal(Core.RELEASE_AHEAD, 3);
  const update = Core.progressUpdate(course(), 2);
  assert.deepEqual(update, { currentIndex: 2, currentDocId: 'c', releasedThrough: 5 });
  const c = course(update);
  assert.deepEqual(Core.releasedWorksheets(c).map((w) => w.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(Core.nextWorksheets(c).map((w) => w.id), ['d', 'e']);
  assert.equal(Core.worksheetState(c, 2), 'current');
  assert.equal(Core.worksheetState(c, 3), 'next');
  assert.equal(Core.worksheetState(c, 5), 'released');
  assert.equal(Core.worksheetState(c, 6), 'locked');
  assert.equal(Core.lockedCount(c), 4);
});

test('always 3 ahead: a class whose stored release lags behind still has the next 3 out', () => {
  // Worksheet 2 is current but only 1 and 2 were ever stored as released
  // (the two after were added to the list later): the next 3 are out anyway.
  const c = course({ worksheetIds: ['a', 'b', 'c', 'd'], currentIndex: 1, releasedThrough: 1 });
  assert.equal(Core.releasedThrough(c), 3);
  assert.deepEqual(Core.releasedWorksheets(c).map((w) => w.id), ['a', 'b', 'c', 'd']);
  assert.equal(Core.lockedCount(c), 0);
  // Worksheets added to the end later come out as soon as they are within 3.
  const longer = course({ worksheetIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], currentIndex: 1, releasedThrough: 1 });
  assert.deepEqual(Core.releasedWorksheets(longer).map((w) => w.id), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(Core.lockedCount(longer), 2);
  // Released further by hand stays released; a class not started yet waits.
  assert.equal(Core.releasedThrough(course({ currentIndex: 1, releasedThrough: 8 })), 8);
  assert.equal(Core.releasedThrough(course({ currentIndex: -1, releasedThrough: -1 })), -1);
  assert.equal(Core.releasedThrough(course({ currentIndex: 9, releasedThrough: 2 })), 9, 'never past the end of the list');
});

test('progress never goes backwards, except when an admin forces the position — and releases stay out', () => {
  const c = course({ currentIndex: 4, releasedThrough: 9 });
  assert.deepEqual(Core.progressUpdate(c, 1), { currentIndex: 4, currentDocId: 'e', releasedThrough: 9 });
  assert.deepEqual(Core.progressUpdate(c, 1, { force: true }), { currentIndex: 1, currentDocId: 'b', releasedThrough: 9 });
  assert.equal(Core.progressUpdate(c, 10), null);
  assert.equal(Core.progressUpdate(c, -1), null);
});

test('the next two never name a worksheet that is not released', () => {
  const c = course({ worksheetIds: ['a', 'b', 'c', 'd'], currentIndex: 2, releasedThrough: 3 });
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
  const course = { worksheetIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], currentIndex: 2, releasedThrough: 4 };
  const docs = {
    a: { name: 'WS A', updatedAt: { seconds: 1760256300, nanoseconds: 0 }, pageCount: 2 },
    b: { name: 'WS B', updatedAt: { toMillis: () => 1760342700000 } },
    c: { name: 'WS C', createdAt: { seconds: 1760000000 }, annotations: '' }
  };
  const recordings = { c: Core.lessonRecordings(JSON.stringify([{ id: 'r', type: 'video', url: 'u', ts: 5, lessonRecording: { version: 1, duration: 90000 } }])) };
  const items = plainList(Core.timelineItems(course, docs, recordings));
  assert.deepEqual(items.map((i) => i.id), ['a', 'b', 'c', 'd', 'e', 'f'], 'on worksheet 3, up to 3 ahead (6) is out');
  assert.deepEqual(items.map((i) => i.state), ['released', 'released', 'current', 'next', 'next', 'released']);
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

/* ---- 📌 Current worksheet / Next worksheet: what Ans Key shows (portal v1.4.0) ---- */
test('Ans Key shows worksheet 1 as current and 2 as next before the first lesson', () => {
  const c = course();
  assert.equal(Core.ansKeyAt(c), 0);
  assert.equal(Core.ansKeyState(c, 0), 'current');
  assert.equal(Core.ansKeyState(c, 1), 'next');
  assert.equal(Core.ansKeyState(c, 2), 'queued');
  assert.equal(Core.ansKeyAt(course({ worksheetIds: [] })), -1, 'an empty class has nothing to show');
});

test('on worksheet 3: 1 and 2 are done, 3 is current, 4 is next, the rest are queued', () => {
  const c = course({ currentIndex: 2, releasedThrough: 7 });
  assert.deepEqual(c.worksheetIds.map((_, i) => Core.ansKeyState(c, i)),
    ['done', 'done', 'current', 'next', 'queued', 'queued', 'queued', 'queued', 'queued', 'queued']);
  assert.equal(Core.ansKeyState(c, 10), '');
  assert.equal(Core.ansKeyState(c, -1), '');
  assert.equal(Core.ansKeyAt(course({ worksheetIds: ['a', 'b'], currentIndex: 6 })), 1, 'a shortened list keeps a real place');
});

test('Finished moves the class one step and releases like opening the next sheet', () => {
  const c = course({ currentIndex: 2, releasedThrough: 7 });
  assert.deepEqual(Core.finishUpdate(c), { currentIndex: 3, currentDocId: 'd', releasedThrough: 7, lastFinishedIndex: 2, lastFinishedDocId: 'c' });
  const fresh = course();
  assert.deepEqual(Core.finishUpdate(fresh), { currentIndex: 1, currentDocId: 'b', releasedThrough: 4, lastFinishedIndex: 0, lastFinishedDocId: 'a' },
    'finishing worksheet 1 before the class opened anything');
  assert.equal(Core.finishUpdate(course({ currentIndex: 9, releasedThrough: 9 })), null, 'nothing after the last one');
  assert.equal(Core.finishUpdate(course({ worksheetIds: [] })), null);
  const after = course(Core.finishUpdate(c));
  assert.equal(Core.ansKeyState(after, 3), 'current', 'the old Next is now Current');
  assert.equal(Core.ansKeyState(after, 4), 'next', 'and the one after it is loaded as Next');
  assert.equal(Core.ansKeyState(after, 2), 'done');
});

test('the labels stay with their worksheets when the list is reordered', () => {
  const c = course({ currentIndex: 2, releasedThrough: 7 });
  const moved = Core.moveItem(c.worksheetIds, 2, 0);
  const after = course(Object.assign({ worksheetIds: moved }, Core.remapProgress(c, moved)));
  assert.equal(after.worksheetIds[Core.ansKeyAt(after)], 'c', 'the class is still on the same worksheet');
  assert.equal(Core.ansKeyState(after, 1), 'next');
});

test('a duplicated class keeps level and subject, drops the time, and starts from nothing', () => {
  const copy = Core.duplicateCourseData(course({ id: 'orig', day: 'Thursday', slot: 0, title: 'P5 Mathematics · Thursday 3:00pm', currentIndex: 4, releasedThrough: 9 }), 'zk@example.com');
  assert.deepEqual(plainList(copy), { title: 'P5 Mathematics', level: 'P5', subject: 'math', day: '', slot: null,
    worksheetIds: [], currentIndex: -1, releasedThrough: -1, copiedFrom: 'orig', createdBy: 'zk@example.com' });
});

test('a copied worksheet keeps its answer key but not the lesson recordings', () => {
  const json = JSON.stringify([{ id: 'a', type: 'pen' }, { id: 'r', type: 'video', lessonRecording: { version: 1 } }, { id: 't', type: 'text', text: 'Ans: 42' }]);
  const out = Core.stripLessonRecordings(json);
  assert.deepEqual(JSON.parse(out.json).map((a) => a.id), ['a', 't']);
  assert.equal(out.removed, 1);
  assert.equal(Core.stripLessonRecordings('not json').json, '[]');
  assert.equal(Core.stripLessonRecordings('').json, '[]');
  const ws = Core.worksheetCopy({ name: 'WS 3', level: 'P5', subject: 'math', wsDay: 'Monday', wsSlot: 1, hidden: true, storagePath: 'pdf-annotator/old.pdf',
    starPages: [2], pageCount: 4, ownerUid: 'u1', ownerEmail: 't@x', share: { mode: 'edit' }, onlineCourseId: 'old', annotations: '[]' },
  { id: 'new', storageDir: 'pdf-annotator', courseId: 'k2', seq: 2, fromId: 'old', by: 'a@x' });
  assert.equal(ws.storagePath, 'pdf-annotator/new.pdf', 'its own PDF, never the original\'s');
  assert.equal(ws.wsDay, ''); assert.equal(ws.wsSlot, null); assert.equal(ws.hidden, false);
  assert.equal(ws.onlineCourseId, 'k2'); assert.equal(ws.onlineSeq, 2); assert.equal(ws.onlineCopiedFrom, 'old');
  assert.equal(ws.share, undefined, 'share links are not copied');
  assert.equal(ws.annotations, undefined, 'the answer key is filled in by the portal after stripping');
  assert.deepEqual(plainList(ws.starPages), [2]);
});

test('🔁 a replaced PDF keeps its path and is told apart by pdfVersion', () => {
  assert.equal(Core.pdfCacheKey({ storagePath: 'pdf-annotator/a.pdf' }), 'pdf-annotator/a.pdf', 'never replaced: as before');
  assert.equal(Core.pdfCacheKey({ storagePath: 'pdf-annotator/a.pdf', pdfVersion: 17 }), 'pdf-annotator/a.pdf#v17');
  assert.equal(Core.pdfCacheKey({}), '');
  assert.equal(Core.pdfCacheKey(null), '');
  const u = Core.replacementUpdate({ version: 1762150000000, fileName: 'WS 3 fixed.pdf', by: 'a@x', pageCount: 5 });
  assert.deepEqual(plainList(u), { pdfVersion: 1762150000000, pdfFileName: 'WS 3 fixed.pdf', pdfReplacedBy: 'a@x', pageCount: 5 });
  assert.equal(u.storagePath, undefined, 'the path is never changed (Ans Key writes it back on every save)');
  assert.equal(u.annotations, undefined, 'the answer key is never touched');
  assert.equal(Core.replacementUpdate({ version: 1, pageCount: null }).pageCount, undefined, 'an unknown page count leaves the old one');
});

test('🔁 the copies made by Duplicate class are found, wherever the replace starts', () => {
  const docs = {
    orig: { storagePath: 'p/orig.pdf', onlineCourseId: 'thu' },
    c1: { storagePath: 'p/c1.pdf', onlineCourseId: 'sat', onlineCopiedFrom: 'orig' },
    c2: { storagePath: 'p/c2.pdf', onlineCourseId: 'sun', onlineCopiedFrom: 'orig' },
    cc: { storagePath: 'p/cc.pdf', onlineCourseId: 'wed', onlineCopiedFrom: 'c1' },
    other: { storagePath: 'p/other.pdf', onlineCourseId: 'thu' },
    lost: { missing: true }
  };
  assert.equal(Core.copyRoot('cc', docs), 'orig');
  assert.deepEqual(plainList(Core.copyFamily('orig', docs)), ['orig', 'c1', 'c2', 'cc']);
  assert.deepEqual(plainList(Core.copyFamily('cc', docs)).sort(), ['c1', 'c2', 'cc', 'orig']);
  assert.equal(Core.copyFamily('cc', docs)[0], 'cc', 'the one being replaced comes first');
  assert.deepEqual(plainList(Core.copyFamily('other', docs)), ['other'], 'an unrelated worksheet has no copies');
  // The original deleted: its copies still belong together.
  const orphan = { a: { storagePath: 'p/a.pdf', onlineCopiedFrom: 'gone' }, b: { storagePath: 'p/b.pdf', onlineCopiedFrom: 'gone' }, gone: { missing: true } };
  assert.deepEqual(plainList(Core.copyFamily('a', orphan)), ['a', 'b']);
  // A loop never hangs.
  const loop = { x: { storagePath: 'x', onlineCopiedFrom: 'y' }, y: { storagePath: 'y', onlineCopiedFrom: 'x' } };
  assert.ok(Core.copyFamily('x', loop).length === 2);
  const courses = { sat: { id: 'sat', title: 'P5 Maths · Saturday', worksheetIds: ['z', 'c1'] } };
  const targets = Core.copyTargets('orig', docs, courses);
  assert.equal(targets.length, 3);
  assert.equal(targets.find((t) => t.id === 'c1').where, 'P5 Maths · Saturday · worksheet 2');
  assert.equal(targets.find((t) => t.id === 'c2').where, 'A class no longer listed');
});

test('🔁 the Replace window warns when the page count changes, and sums up', () => {
  assert.equal(Core.pageChangeNote(4, 4), '');
  assert.equal(Core.pageChangeNote(0, 4), '', 'nothing known: nothing said');
  assert.equal(Core.pageChangeNote(4, null), '');
  assert.match(Core.pageChangeNote(5, 3), /new PDF has 3 pages and the old one 5 pages\. Answers written on page 4 to 5 will have no page/);
  assert.match(Core.pageChangeNote(5, 4), /on page 5 will have/);
  assert.match(Core.pageChangeNote(3, 4), /same page numbers/);
  assert.equal(Core.replaceSummary(['a'], []), 'Worksheet PDF replaced. Answer keys are kept.');
  assert.equal(Core.replaceSummary(['a', 'b', 'c'], []), 'PDF replaced in 3 worksheets. Answer keys are kept.');
  assert.equal(Core.replaceSummary(['a'], ['Saturday: offline']), 'Worksheet PDF replaced. 1 could not be replaced. Saturday: offline');
  assert.equal(Core.replaceSummary([], ['This class: offline']), 'The PDF could not be replaced. This class: offline');
});

/* ---- 🎬📅 v1.7.0: the worksheet's video page is Ans Key's videos.html, the QR code's own ---- */
const VP_HASH = 'vp1-812-9a3b4c5d';
const VP_TOKEN = '7e1d0a3c-1b2c-4d5e-8f90-000000000001';

test('the video page link carries the same packed code as the printed QR code', async () => {
  const vp = Core.videoPlaylistOf({ videoPlaylist: { hash: VP_HASH, token: VP_TOKEN, n: 3, at: 1794474000000 } });
  assert.deepEqual(vp, { hash: VP_HASH, token: VP_TOKEN, n: 3, at: 1794474000000 });
  const code = Core.videoPackCode(VP_HASH, VP_TOKEN);
  assert.match(code, /^[A-Za-z0-9_-]{31}$/);
  assert.equal(Core.videoPageLink('../anskey/', vp), '../anskey/videos.html?' + code);
  assert.equal(Core.videoPageLink('../anskey', vp, '2026-11-12'), '../anskey/videos.html?' + code + '#day-2026-11-12');
  assert.equal(Core.videoPageLink('../anskey/', vp, 'tomorrow'), '../anskey/videos.html?' + code, 'a bad day is left off');
  // A token that cannot be packed is spelled out, as Ans Key does.
  assert.equal(Core.videoPageLink('../anskey/', { hash: VP_HASH, token: 'abcdefghijklmnopqrst' }), '../anskey/videos.html?p=' + VP_HASH + '&t=abcdefghijklmnopqrst');
  // Anything else is no page at all.
  assert.equal(Core.videoPlaylistOf({ videoPlaylist: { hash: 'living-1', token: VP_TOKEN } }), null);
  assert.equal(Core.videoPlaylistOf({ videoPlaylist: { hash: VP_HASH, token: 'x"><script>' } }), null);
  assert.equal(Core.videoPlaylistOf({}), null);
  assert.equal(Core.videoPageLink('../anskey/', null), '');
  // Byte for byte Ans Key's packCode, when anskey is checked out beside this repo.
  const fs = await import('node:fs');
  for (const dir of ['../../anskey/video-playlist.js', '../../polymathlc/anskey/video-playlist.js']) {
    const file = new URL(dir, import.meta.url);
    if (!fs.existsSync(file)) continue;
    const VP = require(file.pathname).pure;
    for (const [h, t] of [[VP_HASH, VP_TOKEN], ['vp1-1-0', '00000000-0000-0000-0000-000000000000'], ['vp1-9999999-ffffffff', 'ffffffff-ffff-ffff-ffff-ffffffffffff']]) {
      assert.equal(Core.videoPackCode(h, t), VP.packCode(h, t));
      assert.deepEqual(VP.unpackCode(Core.videoPackCode(h, t)), { hash: h, token: t });
      assert.equal('https://polymathlc.com.sg/anskey/' + Core.videoPageLink('', { hash: h, token: t }), VP.viewerUrl('https://polymathlc.com.sg/anskey/', h, t));
    }
    // Both read a lesson's day the same way.
    const at = Date.UTC(2026, 10, 12, 9, 30);
    assert.equal(Core.lessonDayKey(at), VP.dayKey(at));
    break;
  }
});

test('a filed list is used only while it holds every lesson', () => {
  const at = Date.UTC(2026, 10, 12, 9);
  const recs = [{ id: 'a', at: at - 86400000 }, { id: 'b', at: at }];
  assert.equal(Core.videoPlaylistCurrent({ n: 2, at: at + 5000 }, recs), true);
  assert.equal(Core.videoPlaylistCurrent({ n: 5, at: at + 5000 }, recs), true, 'YouTube clips count as videos too');
  assert.equal(Core.videoPlaylistCurrent({ n: 1, at: at + 5000 }, recs), false, 'fewer videos than lessons');
  assert.equal(Core.videoPlaylistCurrent({ n: 3, at: at - 60000 }, recs), false, 'filed before the newest lesson');
  assert.equal(Core.videoPlaylistCurrent({ n: 3, at: 0 }, recs), true, 'an older filing with no time still counts');
  assert.equal(Core.videoPlaylistCurrent({ n: 0, at: at }, []), false);
  assert.equal(Core.videoPlaylistCurrent(null, recs), false);
});

test('the recorded lessons are grouped by the day of the class, first lesson first', () => {
  const day = (d, h) => new Date(2026, 10, d, h, 0).getTime();
  const days = Core.recordingDays([
    { id: 'n2', at: day(12, 18), duration: 600 },
    { id: 'o', at: day(5, 17), duration: 2460 },
    { id: 'n1', at: day(12, 17), duration: 60 },
    { id: 'old', at: 0, duration: 30 }
  ], day(13, 9));
  assert.deepEqual(days.map((d) => d.key), ['2026-11-05', '2026-11-12']);
  assert.deepEqual(days.map((d) => d.label), ['Thu 5 Nov', 'Thu 12 Nov']);
  assert.deepEqual(days.map((d) => d.count), [1, 2]);
  assert.deepEqual(days[1].ids, ['n2', 'n1']);
  assert.equal(days[1].seconds, 660);
  assert.equal(days[1].at, day(12, 17));
  assert.deepEqual(Core.recordingDays([]), []);
  // The timeline hands both to the page.
  const course = { worksheetIds: ['w1'], currentIndex: 0, releasedThrough: 0 };
  const items = Core.timelineItems(course, { w1: { name: 'WS', videoPlaylist: { hash: VP_HASH, token: VP_TOKEN, n: 1, at: day(12, 19) } } },
    { w1: [{ id: 'n1', at: day(12, 17), duration: 60 }] });
  assert.equal(items[0].playlist.hash, VP_HASH);
  assert.equal(items[0].days.length, 1);
});

test('polymathlc.com.sg/student decides: each approved child adds its own level and subjects', () => {
  const classes = [
    course({ id: 'm5', level: 'P5', subject: 'math' }), course({ id: 's5', level: 'P5', subject: 'science' }),
    course({ id: 'm6', level: 'P6', subject: 'math' }), course({ id: 's6', level: 'P6', subject: 'science' }),
    course({ id: 's3', level: 'P3', subject: 'science' })
  ];
  const record = { status: 'approved', children: [
    { name: 'Ann', level: 'P6', subjects: 'math' }, { name: 'Ben', level: 'P5', subjects: 'both' },
    { name: 'Cat', level: 'P3', subjects: 'both' }, { name: 'Dan', level: 'S1', subjects: 'both' }
  ] };
  assert.deepEqual(plainList(Core.accessFromStudentAccess(record)), [
    { level: 'P6', subjects: ['math'] }, { level: 'P5', subjects: ['math', 'science'] }, { level: 'P3', subjects: ['science'] }
  ]);
  const member = Core.memberFromStudentAccess(record, { level: 'P6', subjects: ['science'], revoked: true, name: 'Old name' }, { uid: 'u1', email: 'a@b.co' });
  assert.deepEqual(Core.coursesForMember(classes, member).map((c) => c.id), ['m5', 's5', 'm6', 's3'].sort((a, b) => Core.compareCourses(classes.find(c => c.id === a), classes.find(c => c.id === b))));
  assert.ok(!Core.memberSees(member, classes[3]), 'P6 Science from the old invitation is gone');
  assert.equal(member.revoked, undefined, 'the approval wins over an old removal');
  assert.equal(member.name, 'Old name');
  assert.equal(member.source, 'student-access');
  assert.equal(member.uid, 'u1');
});

test('/student approval: no Online level → no classes; statuses read like the gate', () => {
  const member = Core.memberFromStudentAccess({ children: [{ name: 'Dan', level: 'S2', subjects: 'math' }] }, null, { uid: 'u2' });
  assert.deepEqual(plainList(member.access), []);
  assert.equal(member.level, '');
  assert.equal(member.name, 'Dan');
  assert.ok(!Core.memberSees(member, course({ level: 'P5', subject: 'math' })));
  assert.equal(Core.studentAccessStatus(null), 'none');
  assert.equal(Core.studentAccessStatus({ status: 'approved' }), 'approved');
  assert.equal(Core.studentAccessStatus({ status: 'revoked' }), 'revoked');
  assert.equal(Core.studentAccessStatus({ status: 'odd' }), 'pending');
  assert.deepEqual(plainList(Core.studentAccessLevels({ children: [{ level: 'P5' }, { level: 'S1' }, { level: 'P5' }] })), ['P5', 'S1']);
  // An older member row (no `access`) still sees its one level and subjects.
  assert.deepEqual(plainList(Core.accessPairs({ level: 'P5', subjects: 'both' })), [{ level: 'P5', subjects: ['math', 'science'] }]);
});

/* ---------------------------------------------------------------------
   📄 v1.9.0 — the answer key of every class day, filed by Ans Key as a PDF.
   --------------------------------------------------------------------- */
test('answer keys: only real Storage key links, newest class day first', () => {
  const T1 = '11111111-2222-4333-8444-555555555555';
  const url = (day, token = T1, name = 'pdf-annotator/lesson-key-ws1-' + day + '.pdf') =>
    'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' + encodeURIComponent(name) + '?alt=media&token=' + token;
  const keys = Core.answerKeysOf({ answerKeys: {
    '2026-11-06': { url: url('2026-11-06'), at: 5, pages: 4, videos: 2 },
    '2026-11-13': { url: url('2026-11-13'), at: { seconds: 9 }, pages: '3' },
    '2026-02-30': { url: url('2026-02-30') },
    '2026-11-01': { url: 'https://evil.example/key.pdf' },
    '2026-11-02': { url: url('2026-11-02', 'nope') },
    '2026-11-03': { url: url('2026-11-03', T1, 'pdf-annotator/videos-x.json') },
    '2026-11-04': { url: url('2026-11-04').replace('https:', 'http:') },
    '2026-11-05': null
  } });
  assert.deepEqual(keys.map((k) => k.key), ['2026-11-13', '2026-11-06']);
  assert.equal(keys[0].at, 9000);
  assert.equal(keys[0].pages, 3);
  assert.equal(keys[1].videos, 2);
  assert.match(keys[0].label, /13 Nov/);
  assert.deepEqual(Core.answerKeysOf({}), []);
  assert.deepEqual(Core.answerKeysOf({ answerKeys: [1] }), []);
  assert.equal(Core.answerKeyUrlOk('javascript:alert(1)'), false);
});

test('class days: videos and answer keys side by side, newest day first', () => {
  const days = [{ key: '2026-11-06', count: 1 }, { key: '2026-11-13', count: 2 }, { key: 'bad' }];
  const keys = [{ key: '2026-11-13', url: 'k13' }, { key: '2026-11-20', url: 'k20' }];
  const out = Core.classDays(days, keys);
  assert.deepEqual(out.map((d) => d.key), ['2026-11-20', '2026-11-13', '2026-11-06']);
  assert.equal(out[0].video, null);
  assert.equal(out[0].answerKey.url, 'k20');
  assert.equal(out[1].video.count, 2);
  assert.equal(out[1].answerKey.url, 'k13');
  assert.equal(out[2].answerKey, null);
  assert.deepEqual(Core.classDays(null, null), []);
});

test('timeline items carry the answer keys and the class days', () => {
  const T1 = '11111111-2222-4333-8444-555555555555';
  const u = 'https://firebasestorage.googleapis.com/v0/b/b/o/' + encodeURIComponent('pdf-annotator/lesson-key-w1-2026-11-13.pdf') + '?alt=media&token=' + T1;
  const course = { worksheetIds: ['w1'], currentIndex: 0, releasedThrough: 0 };
  const [item] = Core.timelineItems(course, { w1: { name: 'WS', answerKeys: { '2026-11-13': { url: u, pages: 2 } } } }, {});
  assert.equal(item.answerKeys.length, 1);
  assert.equal(item.classDays.length, 1);
  assert.equal(item.classDays[0].answerKey.url, u);
});

test('the portal never sends a student to the Ans Key app for an answer key', () => {
  const portal = fs.readFileSync(new URL('../online/portal.js', import.meta.url), 'utf8');
  const tl = portal.slice(portal.indexOf('function timelineHtml('), portal.indexOf('/* ---- Ans Key inside the portal ----'));
  assert.ok(!/data-action="answer-key"|data-action="print-key"/.test(tl));
  assert.match(tl, /latestKey\.url/);
  assert.ok(!/answerKeyUrl\(ids\[cur\]\)/.test(portal));
  const v = (portal.match(/var APP_VERSION = 'v(\d+)\.(\d+)\.\d+'/) || []).slice(1).map(Number);
  assert.ok(v[0] > 1 || (v[0] === 1 && v[1] >= 9), 'answer key PDFs arrived in v1.9.0');
});

/* ---- 📂 Browse Ans Key app (portal v1.10.0) ---- */
const KEY_URL = (id, day) => 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
  encodeURIComponent('pdf-annotator/lesson-key-' + id + '-' + day + '.pdf') + '?alt=media&token=0b5e4a5c-1f6c-4c1e-9a7e-2c1d3e4f5a6b';
const pen = (id) => ({ id, type: 'pen', page: 1, points: [[1, 2], [3, 4]] });
const lesson = (id, url) => ({ id, type: 'video', url: url || 'https://a/' + id + '.m4a', ts: 1700000000000, lessonRecording: { version: 1, duration: 60000 } });

test('the library says what a worksheet carries: answers, videos, key PDFs and its class', () => {
  const d = { storagePath: 'pdf-annotator/x.pdf', annotations: JSON.stringify([pen('p1'), pen('p2'), lesson('v1')]), pageCount: 4,
    answerKeys: { '2026-11-03': { url: KEY_URL('x', '2026-11-03'), pages: 4 }, 'nope': { url: 'https://evil/x' } }, onlineCourseId: 'k9' };
  assert.deepEqual(Core.libraryInfo(d), { answers: true, big: false, videos: 1, keys: 1, inClass: 'k9', pages: 4, hidden: false, hasPdf: true });
  const blank = Core.libraryInfo({ storagePath: 'p.pdf', annotations: '' });
  assert.equal(blank.answers, false);
  assert.equal(blank.videos, 0);
  const onlyVideo = Core.libraryInfo({ storagePath: 'p.pdf', annotations: JSON.stringify([lesson('v1'), lesson('v2')]) });
  assert.equal(onlyVideo.answers, false, 'a recorded lesson is not an answer key');
  assert.equal(onlyVideo.videos, 2);
  const big = Core.libraryInfo({ storagePath: 'p.pdf', annotationsPath: 'pdf-annotator/p.annotations.json',
    videoPlaylist: { hash: 'vp1-120-abcd', token: '0b5e4a5c-1f6c-4c1e-9a7e-2c1d3e4f5a6b', n: 3 } });
  assert.equal(big.answers, true, 'a big answer key in Storage counts as written on');
  assert.equal(big.videos, 3, 'its videos are read off the filed video page');
});

test('browsing: the class level and subject by default, everything when asked, and every search word', () => {
  const c = course({ level: 'P5', subject: 'math' });
  const doc = { name: 'Fractions of a set', level: 'P5', subject: 'math', wsDay: 'Monday', wsDate: '2026-10-05', storagePath: 'a.pdf' };
  assert.equal(Core.libraryMatches(doc, c, 'class', ''), true);
  assert.equal(Core.libraryMatches({ ...doc, subject: 'both' }, c, 'class', ''), true);
  assert.equal(Core.libraryMatches({ ...doc, level: 'P6' }, c, 'class', ''), false);
  assert.equal(Core.libraryMatches({ ...doc, level: 'P6' }, c, 'all', ''), true);
  assert.equal(Core.libraryMatches({ ...doc, subject: 'science' }, c, 'class', ''), false);
  assert.equal(Core.libraryMatches(doc, c, 'class', 'set fractions'), true, 'any order');
  assert.equal(Core.libraryMatches(doc, c, 'class', 'monday 2026-10'), true, 'day and date');
  assert.equal(Core.libraryMatches(doc, c, 'class', 'ratio'), false);
  assert.equal(Core.libraryMatches({ ...doc, storagePath: '' }, c, 'all', ''), false, 'no PDF, nothing to add');
});

test('the library is newest lesson first, then by name', () => {
  const list = [
    { id: 'a', data: { name: 'Worksheet 10', wsDate: '2026-10-05' } },
    { id: 'b', data: { name: 'Worksheet 2', wsDate: '2026-10-05' } },
    { id: 'c', data: { name: 'Newest', wsDate: '2026-11-02' } },
    { id: 'd', data: { name: 'No date' } }
  ];
  assert.deepEqual(Core.libraryOrder(list).map((x) => x.id), ['c', 'b', 'a', 'd']);
});

test('a worksheet joins as it is only when it is in no class and everything it carries is wanted', () => {
  const both = { answers: true, videos: true };
  const written = { storagePath: 'a.pdf', annotations: JSON.stringify([pen('p'), lesson('v')]) };
  assert.equal(Core.libraryNeedsCopy(written, both, 'k1'), false);
  assert.equal(Core.libraryNeedsCopy(written, { answers: true, videos: false }, 'k1'), true, 'leaving its videos behind means a copy');
  assert.equal(Core.libraryNeedsCopy(written, { answers: false, videos: true }, 'k1'), true, 'leaving its answers behind means a copy');
  assert.equal(Core.libraryNeedsCopy({ ...written, onlineCourseId: 'other' }, both, 'k1'), true, 'another class keeps its own');
  assert.equal(Core.libraryNeedsCopy({ storagePath: 'a.pdf', annotations: '' }, { answers: false, videos: false }, 'k1'), false, 'a blank one has nothing to lose');
});

test('future worksheets go at the end and the class stays where it is', () => {
  const c = course({ worksheetIds: ['a', 'b', 'c', 'd'], currentIndex: 1, releasedThrough: 3 });
  const plan = Core.placeWorksheets(c, ['x', 'y', 'a'], 'future');
  assert.deepEqual(plan.worksheetIds, ['a', 'b', 'c', 'd', 'x', 'y'], 'one already in the class is not added twice');
  assert.equal(plan.currentIndex, 1);
  assert.equal(plan.currentDocId, 'b');
  assert.equal(plan.releasedThrough, 3);
  assert.equal(plan.added, 2);
  assert.equal(Core.ansKeyState(course(plan), 4), 'queued');
});

test('previous worksheets go before the current one, done and released, and the class stays on its worksheet', () => {
  const c = course({ worksheetIds: ['a', 'b', 'c', 'd', 'e'], currentIndex: 2, releasedThrough: 4 });
  const plan = Core.placeWorksheets(c, ['p1', 'p2'], 'previous');
  assert.deepEqual(plan.worksheetIds, ['a', 'b', 'p1', 'p2', 'c', 'd', 'e']);
  assert.equal(plan.currentIndex, 4);
  assert.equal(plan.currentDocId, 'c', 'still on the same worksheet');
  assert.equal(plan.releasedThrough, 6, 'what was out is still out');
  const after = course(plan);
  assert.equal(Core.ansKeyState(after, 2), 'done');
  assert.equal(Core.ansKeyState(after, 3), 'done');
  assert.equal(Core.worksheetState(after, 3), 'released', 'students have them');
});

test('previous worksheets on a class not started: at the start, and the class is on the first one after them', () => {
  const c = course({ worksheetIds: ['a', 'b', 'c'], currentIndex: -1, releasedThrough: -1 });
  const plan = Core.placeWorksheets(c, ['p1', 'p2'], 'previous');
  assert.deepEqual(plan.worksheetIds, ['p1', 'p2', 'a', 'b', 'c']);
  assert.equal(plan.currentIndex, 2);
  assert.equal(plan.currentDocId, 'a');
  assert.equal(plan.releasedThrough, 1, 'the two previous ones are out; the rest wait for their lessons');
  const after = course(plan);
  assert.equal(Core.ansKeyState(after, 0), 'done');
  assert.equal(Core.ansKeyState(after, 2), 'current');
  assert.equal(Core.ansKeyState(after, 3), 'next');
  const empty = Core.placeWorksheets(course({ worksheetIds: [] }), ['p1', 'p2'], 'previous');
  assert.deepEqual(empty.worksheetIds, ['p1', 'p2']);
  assert.equal(empty.currentIndex, 1, 'an empty class is on the last of them');
  assert.equal(empty.releasedThrough, 1);
  const released = Core.placeWorksheets(course({ worksheetIds: ['a', 'b', 'c'], currentIndex: -1, releasedThrough: 1 }), ['p'], 'previous');
  assert.equal(released.releasedThrough, 2, 'released ahead of the first lesson stays released, shifted');
});

test('the answer key replaces, the videos add, and nothing is doubled', () => {
  const target = JSON.stringify([pen('old'), lesson('t1')]);
  const source = JSON.stringify([pen('s1'), pen('s2'), lesson('s-v1'), lesson('t1'), { id: 'yt', type: 'video', url: 'https://youtu.be/x' }]);
  const both = Core.mergeAnnotations(target, source, { answers: true, videos: true });
  const ids = JSON.parse(both.json).map((a) => a.id);
  assert.deepEqual(ids, ['s1', 's2', 'yt', 't1', 's-v1'], 'the source writing (a plain video link is writing too), the target lesson, then the new one');
  assert.equal(both.answers, 3);
  assert.equal(both.videos, 1, 'a lesson already on the target is not added again');
  assert.equal(both.replacedAnswers, 1);
  const videosOnly = JSON.parse(Core.mergeAnnotations(target, source, { answers: false, videos: true }).json).map((a) => a.id);
  assert.deepEqual(videosOnly, ['old', 't1', 's-v1'], 'its own answers stay');
  const answersOnly = JSON.parse(Core.mergeAnnotations(target, source, { answers: true, videos: false }).json).map((a) => a.id);
  assert.deepEqual(answersOnly, ['s1', 's2', 'yt', 't1'], 'its own lessons stay');
  const sameFile = Core.mergeAnnotations(JSON.stringify([lesson('a', 'https://a/same.m4a')]), JSON.stringify([lesson('b', 'https://a/same.m4a')]), { videos: true });
  assert.equal(sameFile.videos, 0, 'the same recording under another id is the same lesson');
  assert.equal(Core.mergeAnnotations('not json', '[]', { answers: true }).json, '[]');
});

test('a copy takes only what was asked for', () => {
  const source = JSON.stringify([pen('s1'), lesson('v1')]);
  assert.deepEqual(JSON.parse(Core.pickAnnotations(source, { answers: true, videos: true }).json).map((a) => a.id), ['s1', 'v1']);
  assert.deepEqual(JSON.parse(Core.pickAnnotations(source, { answers: true }).json).map((a) => a.id), ['s1']);
  assert.deepEqual(JSON.parse(Core.pickAnnotations(source, { videos: true }).json).map((a) => a.id), ['v1']);
  assert.equal(Core.pickAnnotations(source, {}).json, '[]', 'neither: a clean worksheet');
});

test('answer key PDFs: the worksheet keeps its own days, takes the others, and only real ones', () => {
  const tgt = { answerKeys: { '2026-11-03': { url: KEY_URL('t', '2026-11-03'), pages: 2 } } };
  const src = { answerKeys: {
    '2026-11-03': { url: KEY_URL('s', '2026-11-03'), pages: 9 },
    '2026-10-27': { url: KEY_URL('s', '2026-10-27'), pages: 3 },
    '2026-10-20': { url: 'https://evil.example/key.pdf' },
    'someday': { url: KEY_URL('s', '2026-10-13') }
  } };
  const out = Core.mergeAnswerKeyMaps(tgt, src);
  assert.deepEqual(Object.keys(out).sort(), ['2026-10-27', '2026-11-03']);
  assert.equal(out['2026-11-03'].pages, 2, 'its own day wins');
  assert.deepEqual(Core.mergeAnswerKeyMaps(null, null), {});
});

test('what a pick brings, in words', () => {
  const info = { answers: true, keys: 2, videos: 3 };
  assert.equal(Core.libraryBringLabel(info, { answers: true, videos: true }), 'answer key · 2 answer key PDFs · 3 videos');
  assert.equal(Core.libraryBringLabel(info, { videos: true }), '3 videos');
  assert.equal(Core.libraryBringLabel({ answers: false, keys: 0, videos: 0 }, { answers: true, videos: true }), 'the worksheet only');
});

/* ---------------- 🎬 The lesson video player (watch-core.js, portal v1.11.0) ---------------- */
const W = require('../online/watch-core.js');
const MEDIA = (name) => 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' + encodeURIComponent('pdf-annotator/' + name) + '?alt=media&token=t';
const lessonAnn = (id, ts, extra = {}, rec = {}) => ({ id, type: 'video', page: 1, url: MEDIA('lesson-' + id + '.webm'), ts, lessonRecording: { version: 1, duration: 600000, manifestUrl: MEDIA('lesson-' + id + '.json'), ...rec }, ...extra });

test('watch: every lesson on the worksheet, oldest first, with a name for each class day and part', () => {
  const mon2 = Date.UTC(2026, 10, 2, 11, 30), mon9 = Date.UTC(2026, 10, 9, 11, 30);
  const list = W.lessonsOf(JSON.stringify([
    { id: 'pen1', type: 'pen', page: 1, points: [] },
    lessonAnn('b', mon9, {}, { video: true, screen: true }),
    lessonAnn('a2', mon2 + 3600000, {}, { video: true, title: 'Q5' }),
    lessonAnn('a1', mon2),
    lessonAnn('old', 0),
    lessonAnn('evil', mon2, { url: 'https://evil.example/x.webm' }),
    lessonAnn('a1', mon2 + 1)
  ]));
  assert.deepEqual(list.map((l) => l.id), ['a1', 'a2', 'b', 'old'], 'chronological; undated last; foreign media and repeats left out');
  assert.deepEqual(list.map((l) => l.kind), ['voice', 'camera', 'screen', 'voice']);
  assert.equal(list[0].dayParts, 2);
  assert.match(list[0].name, /part 1 of 2$/);
  assert.match(list[1].name, /^Q5 · .* · part 2 of 2$/);
  assert.equal(list[2].dayParts, 1);
  assert.equal(list[3].name.startsWith('Lesson 4'), true);
  assert.equal(W.totalSeconds(list), 2400);
  assert.equal(W.startIndex(list, {}), 0);
  assert.equal(W.startIndex(list, { day: list[2].day }), 2, 'a class day starts at its first lesson');
  assert.equal(W.startIndex(list, { rec: 'a2', day: list[2].day }), 1, 'a named lesson wins');
  assert.equal(W.startIndex([], {}), -1);
  assert.equal(W.nextIndex(list, 3), -1);
  assert.equal(W.prevIndex(list, 0), -1);
});

test('watch: only our own bucket\'s pdf-annotator files are ever played or read', () => {
  assert.equal(W.storageUrlOk(MEDIA('lesson-x.webm')), true);
  assert.equal(W.storageUrlOk('https://firebasestorage.googleapis.com/v0/b/mathgen--app.appspot.com/o/pdf-annotator%2Flesson-x.webm'), true);
  assert.equal(W.storageUrlOk('https://firebasestorage.googleapis.com/v0/b/other-app/o/pdf-annotator%2Fx'), false);
  assert.equal(W.storageUrlOk('https://firebasestorage.googleapis.com/v0/b/mathgen--app.appspot.com/o/secret%2Fx'), false);
  assert.equal(W.storageUrlOk('https://firebasestorage.googleapis.com/v0/b/mathgen--app.appspot.com/o/pdf-annotator%2F..%2Fx'), false);
  assert.equal(W.storageUrlOk('http://firebasestorage.googleapis.com/v0/b/mathgen--app.appspot.com/o/pdf-annotator%2Fx'), false);
  assert.equal(W.storageUrlOk('javascript:alert(1)'), false);
  const l = W.lessonFrom(lessonAnn('z', 1, {}, { manifestUrl: 'https://evil.example/m.json', captionsUrl: MEDIA('lesson-z-captions.json') }));
  assert.equal(l.manifestUrl, '', 'a foreign manifest is not read');
  assert.equal(l.captionsUrl, MEDIA('lesson-z-captions.json'));
});

test('watch: question marks come from the lesson steps, one per change of question', () => {
  const steps = [
    { t: 0, label: 'Start', page: 1 },
    { t: 1000, label: 'Q1', page: 1 },
    { t: 5000, label: 'Q1', page: 1 },
    { t: 60000, label: 'Q2', page: 1 },
    { t: 61000, label: 'Q3', page: 1 },      // flicked past…
    { t: 62000, label: 'Q2', page: 1 },      // …and straight back
    { t: 120000, label: 'Page 2', page: 2 },
    { t: 180000, label: 'Question 4', page: 2 },
    { t: 9e9, label: 'Q9' },
    { t: -1, label: 'Q8' },
    null, { t: 'x', label: 'Q7' }
  ];
  const q = W.questionMarks(steps, 600000);
  assert.deepEqual(q.map((m) => [m.t, m.label, m.page]), [[1000, 'Q1', 1], [60000, 'Q2', 1], [180000, 'Q4', 2]]);
  assert.equal(W.questionNumber('Q12 part b'), 12);
  assert.equal(W.questionNumber('Page 2'), 0);
  assert.deepEqual(W.questionMarks(null, 1), []);
});

test('watch: page marks follow the recorded view, and pages scrolled past are not marks', () => {
  const timeline = {
    duration: 300000,
    initial: { annotations: [], view: { page: 1, x: 0, y: 0, zoom: 1 } },
    events: [
      { t: 1000, type: 'view', view: { page: 1, x: 0, y: 200, zoom: 1 } },
      { t: 90000, type: 'view', view: { page: 2, x: 0, y: 0, zoom: 1 } },
      { t: 91000, type: 'view', view: { page: 3, x: 0, y: 0, zoom: 1 } },   // scrolled past
      { t: 92000, type: 'view', view: { page: 4, x: 0, y: 0, zoom: 1 } },
      { t: 200000, type: 'view', view: { page: 2, x: 0, y: 0, zoom: 1 } },
      { t: 201000, type: 'upsert', annotation: { id: 'a', type: 'pen', page: 2, points: [], color: '#000', width: 2 } }
    ]
  };
  const pages = W.pageMarks(timeline, 300000);
  assert.deepEqual(pages.map((p) => [p.t, p.page, p.until]), [[0, 1, 92000], [92000, 4, 200000], [200000, 2, 300000]]);
  assert.equal(W.pageAt(pages, 150000), 4);
  assert.equal(W.pageAt(pages, 0), 1);
  // An old lesson with no view at all: the steps know their pages.
  const fromSteps = W.pageMarks({ duration: 100000, events: [] }, 100000, [{ t: 0, label: 'Q1', page: 1 }, { t: 50000, label: 'Q4', page: 3 }]);
  assert.deepEqual(fromSteps.map((p) => [p.t, p.page]), [[0, 1], [50000, 3]]);
  assert.deepEqual(W.pageMarks(null, 0), []);
});

test('watch: the chapters list every question with its page, and pages turned to before any question', () => {
  const manifest = {
    timeline: {
      duration: 400000,
      initial: { annotations: [], view: { page: 1, x: 0, y: 0, zoom: 1 } },
      events: [{ t: 100000, type: 'view', view: { page: 2, x: 0, y: 0, zoom: 1 } }, { t: 300000, type: 'view', view: { page: 3, x: 0, y: 0, zoom: 1 } }]
    },
    steps: [{ t: 0, label: 'Start', page: 1 }, { t: 2000, label: 'Q1', page: 1 }, { t: 103000, label: 'Q2', page: 2 }, { t: 150000, label: 'Q3', page: 2 }]
  };
  const m = W.marksOf(manifest, 400000);
  assert.deepEqual(m.chapters.map((c) => c.label + '@' + c.t), ['Q1@2000', 'Q2@103000', 'Q3@150000', 'Page 3@300000']);
  assert.equal(m.chapters.find((c) => c.label === 'Q3').page, 2);
  assert.equal(W.nowText(m, 160000), 'Q3 · page 2');
  assert.equal(W.nowText(m, 310000), 'page 3', 'a new page with no question on it yet');
  assert.equal(W.nowText(m, 500), 'page 1');
  assert.equal(W.chapterAt(m.chapters, 104000), 1);
  assert.equal(W.chapterAt(m.chapters, 0), -1);
  assert.deepEqual(plainList(W.marksOf(null, 0)), plainList(W.emptyMarks()));
  assert.equal(W.percentAt(200000, 400000), 50);
  assert.equal(W.percentAt(5, 0), 0);
  assert.deepEqual(W.labelled([{ t: 0 }, { t: 1000 }, { t: 200000 }], 400000, 600, 30), [true, false, true], 'labels that would overlap keep only their tick');
});

test('watch: the writing replays to any moment, forwards and back, skipping what it cannot use', () => {
  const r = W.createReplay({
    duration: 10000,
    initial: { annotations: [{ id: 'base', type: 'pen', page: 1, points: [{ x: 1, y: 1 }], color: '#000', width: 2 }], view: { page: 1, x: 0, y: 50, zoom: 1 } },
    events: [
      { t: 1000, type: 'upsert', annotation: { id: 's1', type: 'pen', page: 1, points: [{ x: 0, y: 0 }], color: '#f00', width: 2 } },
      { t: 2000, type: 'append', id: 's1', from: 1, points: [{ x: 5, y: 5 }, { x: 6, y: 6 }] },
      { t: 2500, type: 'append', id: 'missing', from: 0, points: [{ x: 1, y: 1 }] },
      { t: 3000, type: 'view', view: { page: 2, x: 0, y: 300, zoom: 1 } },
      { t: 4000, type: 'remove', id: 'base' },
      { t: 5000, type: 'upsert', annotation: { id: 'v', type: 'video', page: 1 } },
      { t: 6000, type: 'bogus' }
    ]
  });
  assert.equal(r.stateAt(500).annotations.length, 1);
  assert.equal(r.stateAt(2100).annotations.find((a) => a.id === 's1').points.length, 3);
  assert.equal(r.stateAt(3500).view.page, 2);
  assert.deepEqual(r.stateAt(9000).annotations.map((a) => a.id), ['s1'], 'removed and undrawable ones are gone');
  const back = r.stateAt(1500);
  assert.deepEqual(back.annotations.map((a) => a.id), ['base', 's1'], 'going back starts again');
  assert.equal(back.annotations.find((a) => a.id === 's1').points.length, 1);
  assert.equal(back.view.page, 1);
  assert.deepEqual(W.onPage(r.stateAt(9000).annotations, 2), []);
  assert.equal(W.safeColor('#1A73E8'), '#1A73E8');
  assert.equal(W.safeColor('url(javascript:x)'), '#1A1A1A');
  assert.equal(W.createReplay(null).stateAt(5).view.page, 1, 'nothing to replay is still a page');
});

test('watch: the link, the query and the remembered spot', () => {
  assert.equal(Core.watchLink('ws1', { day: '2026-11-09', course: 'k1' }), 'watch.html?ws=ws1&day=2026-11-09&c=k1');
  assert.equal(Core.watchLink('ws1', { day: 'nope', course: 'x"y' }), 'watch.html?ws=ws1');
  assert.equal(Core.watchLink('bad id'), '');
  for (const [id, o] of [['ws1', {}], ['ws1', { day: '2026-11-09' }], ['w-2', { rec: 'r1', t: 75.6, course: 'k9' }]]) {
    assert.equal(Core.watchLink(id, o), W.watchLink(id, o), 'the portal and the player build the same link');
  }
  assert.deepEqual(plainList(W.readQuery('?ws=ws1&day=2026-11-09&rec=r1&t=90&c=k1')), { ws: 'ws1', day: '2026-11-09', rec: 'r1', t: 90, course: 'k1', src: '' });
  assert.deepEqual(plainList(W.readQuery('?ws=<x>&day=9&rec=a b&t=-4')), { ws: '', day: '', rec: '', t: 0, course: '', src: '' });
  const lessons = W.lessonsOf([lessonAnn('a', 1e12), lessonAnn('b', 1e12 + 5)]);
  assert.deepEqual(plainList(W.readSpot(JSON.stringify({ rec: 'b', t: 120 }), lessons)), { rec: 'b', index: 1, t: 120 });
  assert.equal(W.readSpot(JSON.stringify({ rec: 'b', t: 595 }), lessons).t, 0, 'nearly finished: from the top');
  assert.equal(W.readSpot('{bad', lessons), null);
  assert.equal(W.readSpot(JSON.stringify({ rec: 'gone', t: 3 }), lessons), null);
  assert.equal(W.spotKey('ws1'), 'polymath.watch.ws1');
});

test('watch: a worksheet plays for a class it is released to, and nowhere else', () => {
  const k = course({ id: 'k5', worksheetIds: ['a', 'b', 'c'], releasedThrough: 1 });
  assert.equal(W.releasedTo([k], 'b').length, 1);
  assert.equal(W.releasedTo([k], 'c').length, 0, 'not released yet');
  assert.equal(W.releasedTo([k], 'zz').length, 0);
  assert.equal(W.placeText(W.releasedTo([k], 'b')[0]), 'Worksheet 2 of 3');
  // Always 3 ahead (v1.12.0): on worksheet 2, worksheets up to 5 play even
  // when the stored release lags behind; 6 waits.
  const on2 = course({ id: 'k6', worksheetIds: ['a', 'b', 'c', 'd', 'e', 'f'], currentIndex: 1, releasedThrough: 1 });
  assert.deepEqual(['c', 'd', 'e', 'f'].map((id) => W.releasedTo([on2], id).length), [1, 1, 1, 0]);
  const segs = W.strip([{ durationMs: 1000 }, { durationMs: 3000 }], [0, 0]);
  assert.deepEqual(segs.map((s) => s.width), [25, 75]);
  assert.match(W.captionsVtt({ cues: [{ t: 'Hello', s: 0, e: 1200 }, { t: 'x', s: 5, e: 2 }] }), /^WEBVTT\n\n00:00:00\.000 --> 00:00:01\.200\nHello/);
  assert.equal(W.formatTime(3725), '1:02:05');
  assert.equal(W.formatTime(65), '1:05');
});

test('watch: the timeline never opens Ans Key for a video, and the player page is wired', () => {
  const portal = fs.readFileSync(new URL('../online/portal.js', import.meta.url), 'utf8');
  assert.equal(/openAnskey\([^)]*'play'/.test(portal), false, 'no lesson replays in the Ans Key app');
  assert.match(portal, /Core\.watchLink\(/);
  const html = fs.readFileSync(new URL('../online/watch.html', import.meta.url), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex">/);
  for (const src of ['portal-core.js', 'watch-core.js', 'watch.js']) assert.match(html, new RegExp('<script src="' + src.replace('.', '\\.') + '\\?v='));
  const js = fs.readFileSync(new URL('../online/watch.js', import.meta.url), 'utf8');
  for (const id of [...js.matchAll(/\$\('([A-Za-z]+)'\)/g)].map((m) => m[1]).filter((id) => !js.includes('id="' + id + '"'))) {
    assert.match(html, new RegExp('id="' + id + '"'), 'watch.html has #' + id);
  }
});

/* ---------------- 🗄 Archive for students (portal v1.13.0) ---------------- */
const dayMs = (key, hour = 15) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, hour).getTime(); };
const archKey = (id, day) => 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
  encodeURIComponent('pdf-annotator/lesson-key-' + id + '-' + day + '.pdf') + '?alt=media&token=0b5e4a5c-1f6c-4c1e-9a7e-2c1d3e4f5a6b';

test('archive: an archived worksheet leaves every student list but keeps the class where it is', () => {
  const base = course({ currentIndex: 2, releasedThrough: 5 });
  const c = { ...base, archivedWorksheets: ['b', 'd'] };
  // The class position, the release and the Ans Key queue are untouched.
  assert.equal(Core.currentIndex(c), 2);
  assert.equal(Core.releasedThrough(c), Core.releasedThrough(base));
  assert.equal(Core.ansKeyState(c, 3), 'next');
  assert.deepEqual(Core.finishUpdate(c), Core.finishUpdate(base));
  // Students do not see b or d; the others keep their own numbers.
  assert.deepEqual(Core.releasedWorksheets(c).map((w) => [w.id, w.seq]), [['a', 0], ['c', 2], ['e', 4], ['f', 5]]);
  assert.deepEqual(Core.nextWorksheets(c).map((w) => w.id), ['e']);
  assert.deepEqual(Core.timelineItems(c, {}, {}).map((it) => it.id), ['a', 'c', 'e', 'f']);
  // An archived worksheet will not "appear later": it is not counted as locked.
  const later = { ...base, archivedWorksheets: ['h'] };
  assert.equal(Core.lockedCount(base), 4);
  assert.equal(Core.lockedCount(later), 3);
  // Worksheets / Answer keys / Videos tabs are built from the same items.
  const rows = Core.worksheetRows(c, Core.timelineItems(c, {}, {}));
  assert.deepEqual(rows.now.map((r) => r.id), ['c', 'e', 'f']);
  assert.deepEqual(rows.earlier.map((r) => r.id), ['a']);
});

test('archive: one class day hides that day\'s videos and answer key, and nothing else', () => {
  const c = course({ currentIndex: 0, releasedThrough: 3, archivedDays: ['a|2026-11-09'] });
  const docs = { a: { name: 'Fractions', answerKeys: {
    '2026-11-09': { url: archKey('a', '2026-11-09'), at: 1, pages: 2 },
    '2026-11-16': { url: archKey('a', '2026-11-16'), at: 2, pages: 3 }
  } } };
  const recordings = { a: [
    { id: 'r3', at: dayMs('2026-11-16'), duration: 600 },
    { id: 'r2', at: dayMs('2026-11-09', 16), duration: 300 },
    { id: 'r1', at: dayMs('2026-11-09'), duration: 300 }
  ] };
  const [it] = Core.timelineItems(c, docs, recordings);
  assert.deepEqual(it.recordings.map((r) => r.id), ['r3']);
  assert.deepEqual(it.answerKeys.map((k) => k.key), ['2026-11-16']);
  assert.deepEqual(it.classDays.map((d) => d.key), ['2026-11-16']);
  assert.deepEqual(it.days.map((d) => d.key), ['2026-11-16']);
  assert.equal(it.archivedDays, 1);
  assert.deepEqual(Core.answerKeyRows(c, [it])[0].earlier, []);
  assert.equal(Core.videoRows(c, [it])[0].count, 1);
  // Another class with the same worksheet is not affected.
  const other = { ...c, id: 'k2', archivedDays: [] };
  assert.equal(Core.timelineItems(other, docs, recordings)[0].recordings.length, 3);
  // Garbage in the list is ignored, never thrown on.
  const messy = { ...c, archivedDays: ['a|2026-11-09', 'nope', 42, 'a|bad', '|2026-11-09', 'a|2026-11-09'], archivedWorksheets: [null, 'x y', 7] };
  assert.deepEqual(Core.archivedDayList(messy), [{ id: 'a', key: '2026-11-09' }]);
  assert.deepEqual(Core.archivedWorksheetIds(messy), []);
});

test('archive: the update to write, and restoring puts it back exactly', () => {
  const c = course({ currentIndex: 1, releasedThrough: 4 });
  const a1 = Core.archiveUpdate(c, 'worksheet', 'b', '', true);
  assert.deepEqual(plainList(a1), { field: 'archivedWorksheets', value: ['b'] });
  const c1 = { ...c, archivedWorksheets: a1.value };
  assert.equal(Core.archiveUpdate(c1, 'worksheet', 'b', '', true), null, 'already archived');
  assert.equal(Core.archiveUpdate(c, 'worksheet', 'zz', '', true), null, 'not in this class');
  assert.equal(Core.archiveUpdate(c, 'worksheet', 'b', '', false), null, 'nothing to restore');
  const r1 = Core.archiveUpdate(c1, 'worksheet', 'b', '', false);
  assert.deepEqual(plainList(r1), { field: 'archivedWorksheets', value: [] });
  assert.deepEqual(Core.releasedWorksheets({ ...c1, archivedWorksheets: r1.value }), Core.releasedWorksheets(c));

  const d1 = Core.archiveUpdate(c, 'day', 'a', '2026-11-09', true);
  assert.deepEqual(plainList(d1), { field: 'archivedDays', value: ['a|2026-11-09'] });
  assert.equal(Core.archiveUpdate(c, 'day', 'a', '9 Nov', true), null, 'a real day key only');
  const c2 = { ...c, archivedDays: d1.value };
  assert.ok(Core.isDayArchived(c2, 'a', '2026-11-09'));
  assert.ok(!Core.isDayArchived(c2, 'b', '2026-11-09'));
  assert.deepEqual(plainList(Core.archiveUpdate(c2, 'day', 'a', '2026-11-09', false)), { field: 'archivedDays', value: [] });
  // A worksheet that has since left the class can still be restored.
  const gone = { ...c, worksheetIds: ['a'], archivedWorksheets: ['b'] };
  assert.deepEqual(plainList(Core.archiveUpdate(gone, 'worksheet', 'b', '', false)), { field: 'archivedWorksheets', value: [] });
});

test('archive: the admin\'s Archived list names each item', () => {
  const c = course({ currentIndex: 1, releasedThrough: 4, archivedWorksheets: ['c', 'gone'], archivedDays: ['a|2026-11-02', 'b|2026-11-09'] });
  const a = Core.archivedItems(c, { c: { name: 'Speed' }, b: { name: 'Ratio' } }, dayMs('2026-11-15'));
  assert.equal(a.count, 4);
  assert.deepEqual(a.worksheets.map((w) => [w.id, w.name, w.inClass, w.released]), [['c', 'Speed', true, true], ['gone', 'A worksheet no longer in this class', false, false]]);
  assert.deepEqual(a.days.map((d) => [d.id, d.key, d.label, d.name]), [['b', '2026-11-09', 'Mon 9 Nov', 'Ratio'], ['a', '2026-11-02', 'Mon 2 Nov', 'Worksheet 1']]);
  assert.equal(Core.archivedCount(c), 4);
});

test('archive: the video page hides archived worksheets and class days the same way', () => {
  const W2 = require('../online/watch-core.js');
  const c = { id: 'k', worksheetIds: ['a', 'b'], currentIndex: 0, releasedThrough: 1, archivedWorksheets: ['b'], archivedDays: ['a|2026-11-09', 'b|2026-11-16'] };
  const free = { id: 'k2', worksheetIds: ['b'], currentIndex: 0, releasedThrough: 0 };
  assert.deepEqual(W2.releasedTo([c], 'a').map((f) => f.course.id), ['k']);
  assert.deepEqual(W2.releasedTo([c], 'b'), []);
  assert.deepEqual(W2.releasedTo([c, free], 'b').map((f) => f.course.id), ['k2']);
  assert.deepEqual(W2.archivedDaysIn(c, 'a'), ['2026-11-09']);
  assert.deepEqual(W2.archivedDaysIn(free, 'b'), []);
  const url = (n) => 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' + encodeURIComponent('pdf-annotator/lesson-' + n + '.webm') + '?alt=media&token=x';
  const ann = [
    { id: 'v1', type: 'video', url: url('v1'), ts: dayMs('2026-11-09'), lessonRecording: { version: 1, duration: 60000, video: true } },
    { id: 'v2', type: 'video', url: url('v2'), ts: dayMs('2026-11-16'), lessonRecording: { version: 1, duration: 60000, video: true } }
  ];
  const all = W2.lessonsOf(JSON.stringify(ann));
  const shown = W2.lessonsOf(JSON.stringify(ann), W2.archivedDaysIn(c, 'a'));
  assert.equal(all.length, 2);
  assert.deepEqual(shown.map((l) => [l.id, l.index]), [['v2', 0]]);
  // Core and the video page read the same list.
  assert.deepEqual(W2.archivedDaysIn(c, 'a'), Core.archivedDaysOf(c, 'a'));
});

test('archive: the page wires Archive and Restore, and the class card key skips archived days', () => {
  const portal = fs.readFileSync(new URL('../online/portal.js', import.meta.url), 'utf8');
  assert.match(portal, /case 'archive-item': setArchived\(el, true\)/);
  assert.match(portal, /case 'restore-item': setArchived\(el, false\)/);
  assert.match(portal, /Core\.archiveUpdate\(live, kind, id, day, archive\)/);
  assert.match(portal, /Core\.visibleAnswerKeys\(course, ids\[cur\]/);
  assert.ok(!/Core\.answerKeysOf\(state\.docs\[ids\[cur\]\]\)/.test(portal), 'the class card key must not bypass the archive');
  const watch = fs.readFileSync(new URL('../online/watch.js', import.meta.url), 'utf8');
  assert.match(watch, /var openFor = !admin && state\.found \? state\.found\.course : null;/);
  assert.match(watch, /W\.lessonsOf\(annotations, openFor \? W\.archivedDaysIn\(openFor, query\.ws\) : \[\],/);
});

/* ---------------- ⏰ The lesson clock (lesson-clock.js, portal v1.15.0) ----------------
   Zhi Kai, 16 Nov 2026: the answer key and videos of a lesson come out right
   after the lesson, at the end of the lesson timing (5pm for 3 to 4:45pm),
   and the class's Current and Next worksheets move on by themselves. */
const Clock = require('../online/lesson-clock.js');
const sg = (s) => Date.parse(s + '+08:00');

test('clock: a lesson is over at the next lesson time, in Singapore time', () => {
  const mon = Clock.lessonOn('Monday', 0, '2026-11-16');
  assert.equal(mon.start, sg('2026-11-16T15:00:00'));
  assert.equal(mon.end, sg('2026-11-16T16:45:00'));
  assert.equal(mon.release, sg('2026-11-16T17:00:00'), '3 to 4:45pm is out at 5pm');
  assert.equal(Clock.lessonOn('Saturday', 0, '2026-11-14').release, sg('2026-11-14T11:00:00'), '9 to 10:45am is out at 11am');
  assert.equal(Clock.lessonOn('Saturday', 2, '2026-11-14').release, sg('2026-11-14T15:00:00'));
  assert.equal(Clock.lessonOn('Monday', 2, '2026-11-16').release, sg('2026-11-16T21:00:00'));
  assert.equal(Clock.lessonOn('Monday', 0, '2026-11-17'), null, 'not on the class day');
  assert.equal(Clock.lessonOn('Monday', 5, '2026-11-16'), null);
  assert.equal(Clock.nextRelease('Saturday', 0, sg('2026-11-16T21:27:00')), sg('2026-11-21T11:00:00'));
  assert.equal(Clock.sgDayKey(Date.parse('2026-11-15T17:30:00Z')), '2026-11-16', 'past midnight in Singapore');
});

test('clock: the class moves one worksheet on for each lesson that is over', () => {
  const sat = { id: 's', day: 'Saturday', slot: 0, worksheetIds: ['a', 'b', 'c', 'd', 'e', 'f'], currentIndex: 1, releasedThrough: 4,
    progressAt: sg('2026-11-07T09:20:00') };
  // The screenshot's case: last moved during the 7 Nov lesson, nobody pressed Finished since.
  const now = Clock.courseNow(sat, sg('2026-11-16T21:27:00'));
  assert.equal(now.currentIndex, 3, 'over on 7 Nov and on 14 Nov: two worksheets on');
  assert.equal(now.currentDocId, 'd');
  assert.equal(now.autoMoved, 2);
  assert.equal(Clock.courseNow(now, sg('2026-11-16T21:27:00')), now, 'counting again moves nothing');
  // During the lesson nothing moves; at 11am exactly it does.
  const during = { ...sat, progressAt: sg('2026-11-14T09:05:00') };
  assert.equal(Clock.courseNow(during, sg('2026-11-14T10:59:59')), during);
  assert.equal(Clock.courseNow(during, sg('2026-11-14T11:00:00')).currentIndex, 2);
  // Moved by hand after the lesson: that place holds until the next lesson is over.
  const after = { ...sat, progressAt: sg('2026-11-14T12:00:00') };
  assert.equal(Clock.courseNow(after, sg('2026-11-21T10:00:00')), after);
  assert.equal(Clock.courseNow(after, sg('2026-11-21T11:00:00')).currentIndex, 2);
  // clockAt (every writer since v1.15.0) counts as the place being written.
  assert.equal(Clock.courseNow({ ...sat, clockAt: sg('2026-11-14T11:30:00') }, sg('2026-11-16T12:00:00')).currentIndex, 1);
});

test('clock: Finished during a lesson is that lesson\'s move; manual Next goes first; the end of the list stays', () => {
  const base = { day: 'Monday', slot: 1, worksheetIds: ['a', 'b', 'c', 'd'], currentIndex: 2 };
  const fin = { ...base, progressAt: sg('2026-11-16T18:30:00'), finishedAt: sg('2026-11-16T18:30:00') };
  assert.equal(Clock.courseNow(fin, sg('2026-11-16T19:30:00')), fin, 'Finished at 6:30 in the 5pm lesson: no second move at 7pm');
  assert.equal(Clock.courseNow(fin, sg('2026-11-23T19:00:00')).currentIndex, 3, 'the next week moves it again');
  const manual = { ...base, currentIndex: 0, nextIndex: 2, progressAt: sg('2026-11-10T12:00:00') };
  const m = Clock.courseNow(manual, sg('2026-11-16T19:00:00'));
  assert.equal(m.currentIndex, 2, 'the Next set by hand becomes current');
  assert.equal(m.nextIndex, undefined, 'and is used up');
  const last = { ...base, currentIndex: 3, progressAt: sg('2026-11-02T12:00:00') };
  assert.equal(Clock.courseNow(last, sg('2026-11-16T19:00:00')), last, 'the last worksheet stays current');
  const capped = Clock.courseNow({ ...base, currentIndex: 1, progressAt: sg('2026-10-01T12:00:00') }, sg('2026-11-16T19:00:00'));
  assert.equal(capped.currentIndex, 3, 'many weeks later it stops at the last one');
});

test('clock: classes that do not move by themselves', () => {
  const at = sg('2026-11-16T21:00:00');
  const c = { day: 'Saturday', slot: 0, worksheetIds: ['a', 'b', 'c'], currentIndex: 0, progressAt: sg('2026-11-01T12:00:00') };
  assert.equal(Clock.courseNow({ ...c, currentIndex: -1 }, at).currentIndex, -1, 'not started: waits for the teacher');
  assert.equal(Clock.courseNow({ ...c, archived: true }, at).currentIndex, 0);
  assert.equal(Clock.courseNow({ ...c, day: '' }, at).currentIndex, 0, 'no lesson day');
  assert.equal(Clock.courseNow({ ...c, slot: null }, at).currentIndex, 0, 'no lesson time');
  assert.equal(Clock.courseNow({ ...c, progressAt: null }, at).currentIndex, 0, 'never placed: no time to count from');
  // Firestore Timestamps are read too.
  assert.equal(Clock.courseNow({ ...c, progressAt: { toMillis: () => sg('2026-11-01T12:00:00') } }, at).currentIndex, 2);
});

test('clock: a class day\'s answer key and videos reach students at the end of the lesson', () => {
  const mon3 = { day: 'Monday', slot: 0 };
  assert.equal(Clock.dayOpen(mon3, '2026-11-16', sg('2026-11-16T16:59:00')), false);
  assert.equal(Clock.dayOpen(mon3, '2026-11-16', sg('2026-11-16T17:00:00')), true, '5pm for 3 to 4:45pm');
  assert.equal(Clock.dayOpen(mon3, '2026-11-09', sg('2026-11-16T15:30:00')), true, 'last week\'s is out');
  assert.equal(Clock.dayOpen({ day: '', slot: null }, '2026-11-16', sg('2026-11-16T15:30:00')), true, 'no lesson time: out at once');
  assert.equal(Clock.recordingOpen(mon3, sg('2026-11-16T15:40:00'), sg('2026-11-16T16:00:00')), false, 'recorded in the lesson, lesson not over');
  assert.equal(Clock.recordingOpen(mon3, sg('2026-11-16T15:40:00'), sg('2026-11-16T17:00:00')), true);
  assert.equal(Clock.recordingOpen(mon3, sg('2026-11-16T18:10:00'), sg('2026-11-16T18:11:00')), true, 'recorded after the lesson: out at once');
});

test('clock: Polymath Online uses it for the timeline, and the trial service has the same file', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const k = course({ day: 'Monday', slot: 0, worksheetIds: ids, currentIndex: 1, progressAt: sg('2026-11-09T15:30:00') });
  const now = Core.courseNow(k, sg('2026-11-16T17:00:00'));
  assert.equal(Core.currentIndex(now), 3, 'over on 9 Nov and 16 Nov');
  assert.equal(Core.releasedThrough(now), 5, 'released 3 ahead of where it is now');
  assert.deepEqual(['current', 'next', 'queued'].map((s, i) => Core.ansKeyState(now, 3 + i)), ['current', 'next', 'queued']);
  const doc = { answerKeys: {
    '2026-11-16': { url: 'https://firebasestorage.googleapis.com/v0/b/x/o/pdf-annotator%2Flesson-key-c-2026-11-16.pdf?alt=media&token=12345678-1234-1234-1234-123456789abc' },
    '2026-11-09': { url: 'https://firebasestorage.googleapis.com/v0/b/x/o/pdf-annotator%2Flesson-key-c-2026-11-09.pdf?alt=media&token=12345678-1234-1234-1234-123456789abc' }
  } };
  assert.deepEqual(Core.visibleAnswerKeys(k, 'c', doc, sg('2026-11-16T16:30:00')).map(x => x.key), ['2026-11-09']);
  assert.deepEqual(Core.visibleAnswerKeys(k, 'c', doc, sg('2026-11-16T17:00:00')).map(x => x.key), ['2026-11-16', '2026-11-09']);
  assert.deepEqual(Core.visibleAnswerKeys(k, 'c', doc, sg('2026-11-16T16:30:00'), { all: true }).length, 2, 'the admin sees all');
  const recs = [{ id: 'r1', at: sg('2026-11-16T15:20:00') }, { id: 'r0', at: sg('2026-11-09T15:20:00') }];
  assert.deepEqual(Core.visibleRecordings(k, 'c', recs, sg('2026-11-16T16:00:00')).map(r => r.id), ['r0']);
  assert.deepEqual(Core.visibleRecordings(k, 'c', recs, sg('2026-11-16T17:01:00')).map(r => r.id), ['r1', 'r0']);
  assert.equal(fs.readFileSync(new URL('../shop-function/functions/lesson-clock.js', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../online/lesson-clock.js', import.meta.url), 'utf8'), 'the trial service\'s copy is the same file');
  const page = fs.readFileSync(new URL('../online/index.html', import.meta.url), 'utf8');
  assert.ok(page.indexOf('lesson-clock.js') > 0 && page.indexOf('lesson-clock.js') < page.indexOf('portal-core.js?v'), 'the clock loads before the core');
  const portal = fs.readFileSync(new URL('../online/portal.js', import.meta.url), 'utf8');
  assert.match(portal, /state\.rawCourses = next;\s*applyClock\(\);/);
  assert.match(portal, /clockAt: FieldValue\.serverTimestamp\(\)/);
});

test('📅 v1.16.0: the day band names the class day in big letters, in its own colour', () => {
  const mon = Core.dayBand({ level: 'P6', subject: 'science', day: 'Monday', slot: 2 });
  assert.equal(mon.key, 'mon');
  assert.equal(mon.dayUpper, 'MONDAY');
  assert.equal(mon.time, Core.slotLabel('Monday', 2));
  assert.equal(mon.className, 'P6 Science', 'the automatic title loses its day and time: the badge shows those');
  assert.equal(mon.sentence, 'Monday class · ' + Core.slotLabel('Monday', 2));
  const sat = Core.dayBand({ level: 'P5', subject: 'math', day: 'Saturday', slot: 0, title: 'P5 Maths Booster' });
  assert.equal(sat.key, 'sat');
  assert.equal(sat.className, 'P5 Maths Booster', 'an admin\'s own title is kept as typed');
  const keys = Core.DAYS.map((day) => Core.dayBand({ level: 'P4', subject: 'math', day, slot: 0 }).key);
  assert.equal(new Set(keys).size, 7, 'every day has its own colour');
  const none = Core.dayBand({ level: 'P3', subject: 'math' });
  assert.equal(none.key, 'none');
  assert.equal(none.day, '');
  assert.equal(none.sentence, 'No class day set yet');
  assert.equal(Core.dayBand(null).className, 'Your class');
  const page = fs.readFileSync(new URL('../online/index.html', import.meta.url), 'utf8');
  for (const key of [...keys, 'none']) assert.match(page, new RegExp('--day-' + key + ':'), 'a colour for ' + key);
  assert.match(page, /\.day-band \{[^}]*position: sticky/, 'the band sticks while its segment scrolls');
  const portal = fs.readFileSync(new URL('../online/portal.js', import.meta.url), 'utf8');
  assert.match(portal, /function stClassHead\(course\) \{\s*return dayBandHtml\(course\);/, 'every tab opens a class with the band, even with one class');
  assert.match(portal, /class="card class-card[^\n]*\n\s*dayBandHtml\(course\)/, 'the Timeline card opens with the band too');
});

test('🧮🧪 v1.18.0: the day band shows the subject as pictures, so same-day classes tell apart', () => {
  const maths = Core.dayBand({ level: 'P6', subject: 'math', day: 'Monday', slot: 1 });
  const sci = Core.dayBand({ level: 'P6', subject: 'science', day: 'Monday', slot: 2 });
  assert.equal(maths.key, sci.key, 'same day, same colour');
  assert.equal(maths.subjectKey, 'math');
  assert.equal(maths.subjectWord, 'MATHS');
  assert.equal(sci.subjectKey, 'science');
  assert.equal(sci.subjectWord, 'SCIENCE');
  assert.equal(Core.subjectArt('Mathematics').key, 'math', 'loose spellings still count');
  assert.equal(Core.subjectArt('both').key, 'both');
  assert.equal(Core.subjectArt('').key, 'general', 'no subject: plain study pictures, never a wrong subject');
  assert.equal(Core.subjectArt('english').key, 'general');
  assert.equal(Core.subjectArt('english').word, 'ENGLISH');
  assert.equal(Core.dayBand(null).subjectKey, 'general');
  const portal = fs.readFileSync(new URL('../online/portal.js', import.meta.url), 'utf8');
  for (const key of ['math', 'science', 'both', 'general']) assert.match(portal, new RegExp('\\n    ' + key + ': \\{ badge: '), 'pictures for ' + key);
  assert.match(portal, /subjectPatternSvg\(band\.subjectKey\)/, 'the band carries the pattern');
  assert.match(portal, /day-subject-medal/, 'and the subject medallion');
  assert.match(portal, /day-subject-tag/, 'and the MATHS / SCIENCE tag');
  const page = fs.readFileSync(new URL('../online/index.html', import.meta.url), 'utf8');
  assert.match(page, /\.day-band\.subject-math \{ --subject-ink: var\(--math-ink\); \}/);
  assert.match(page, /\.day-band\.subject-science \{ --subject-ink: var\(--science-ink\); \}/);
  assert.match(page, /\.day-band \{[^}]*position: sticky/, 'still sticks under the tabs');
});

/* ---------------- 🔗 v1.17.0: one class's answer keys and videos for another ---------------- */
{
  const TOKEN = '0b5e4a5c-1f6c-4c1e-9a7e-2c1d3e4f5a6b';
  const keyUrl = (id, day) => 'https://firebasestorage.googleapis.com/v0/b/b/o/' +
    encodeURIComponent('pdf-annotator/lesson-key-' + id + '-' + day + '.pdf') + '?alt=media&token=' + TOKEN;
  const SG = (iso) => Date.parse(iso + '+08:00');
  // Monday 7pm P6 Science has the lessons; Tuesday 5pm and Saturday 9am do the same worksheets.
  const mon = { id: 'mon', level: 'P6', subject: 'science', day: 'Monday', slot: 2, worksheetIds: ['m1', 'm2', 'm3'], currentIndex: 2, releasedThrough: 2 };
  const tue = { id: 'tue', level: 'P6', subject: 'science', day: 'Tuesday', slot: 1, worksheetIds: ['t1', 't2', 't3'], currentIndex: 1, releasedThrough: 2, shareFrom: 'mon' };
  const sat = { id: 'sat', level: 'P6', subject: 'science', day: 'Saturday', slot: 0, worksheetIds: ['s0', 's2'], currentIndex: 1, releasedThrough: 1 };
  const courses = { mon, tue, sat };
  const docs = {
    m1: { name: 'P5 Science November WS 1 - Revision', storagePath: 'x', answerKeys: { '2026-11-09': { url: keyUrl('m1', '2026-11-09'), pages: 4 } } },
    m2: { name: 'P5 Science November Worksheet 2 - Revision', storagePath: 'x', answerKeys: { '2026-11-16': { url: keyUrl('m2', '2026-11-16'), pages: 4 } } },
    m3: { name: 'P6 Science Worksheet 3', storagePath: 'x' },
    t1: { name: 'P5 Science November WS 1 - Revision', storagePath: 'x', onlineCopiedFrom: 'm1' },
    t2: { name: 'p5 science november ws 2 – revision', storagePath: 'x' },
    t3: { name: 'Something else', storagePath: 'x' },
    s0: { name: 'Saturday only', storagePath: 'x' },
    s2: { name: 'P5 Science November Worksheet 2 - Revision', storagePath: 'x' }
  };
  const rec = (id, iso) => ({ id, title: 'Lesson', at: SG(iso), duration: 3000, video: true, page: 1 });
  const recordings = {
    m1: [rec('r1', '2026-11-09T19:30:00'), rec('r0', '2026-11-02T19:30:00')],
    m2: [rec('r2', '2026-11-16T19:30:00')]
  };
  const LATER = SG('2026-11-20T12:00:00');

  test('🔗 shared: a worksheet is matched by copy, then by name; a pin or "keep own" wins', () => {
    assert.equal(Core.shareMatch(tue, 't1', mon, docs), 'm1', 'a copy of the same original');
    assert.equal(Core.shareMatch(tue, 't2', mon, docs), 'm2', 'the same name, whatever the case, dash or "Worksheet"/"WS"');
    assert.equal(Core.shareMatch(tue, 't3', mon, docs), '', 'no match: nothing is shared');
    assert.equal(Core.shareNameKey('P5 Science November Worksheet 2 - Revision'), Core.shareNameKey('p5 science november ws 2 – revision'));
    const src = Core.shareSourceOf(tue, 't2', courses, docs);
    assert.equal(src.course.id, 'mon'); assert.equal(src.ws, 'm2'); assert.equal(src.mode, 'fill'); assert.equal(src.pinned, false);
    assert.equal(Core.shareSourceOf(mon, 'm1', courses, docs), null, 'a class that shares from nobody');
    const pinned = { ...tue, sharedKeys: { t3: { course: 'sat', ws: 's2' }, t1: { own: true } } };
    assert.equal(Core.shareSourceOf(pinned, 't3', courses, docs).ws, 's2', 'set by hand to any class');
    assert.equal(Core.shareSourceOf(pinned, 't3', courses, docs).mode, 'replace');
    assert.equal(Core.shareSourceOf(pinned, 't1', courses, docs), null, 'keep own');
    assert.equal(Core.shareSourceOf({ ...tue, shareFrom: 'gone' }, 't1', courses, docs), null, 'a class that no longer exists');
    assert.equal(Core.shareSourceOf({ ...tue, shareFrom: 'tue' }, 't1', courses, docs), null, 'never from itself');
    assert.deepEqual(Core.shareSourceIds(pinned, courses, docs), ['m1', 'm2', 'm3', 's2']);
  });

  test('🔗 shared: students see them only after their own class finished the worksheet', () => {
    const items = Core.timelineItems(tue, docs, recordings, { courses, now: LATER });
    const t1 = items.find((i) => i.id === 't1'), t2 = items.find((i) => i.id === 't2'), t3 = items.find((i) => i.id === 't3');
    assert.equal(t1.recordings.length, 2, 'worksheet 1 is done in Tuesday: Monday\'s two videos');
    assert.equal(t1.answerKeys.length, 1);
    assert.equal(t1.shared.courseId, 'mon'); assert.equal(t1.shared.videos, true); assert.equal(t1.shared.keys, true);
    assert.equal(t2.recordings.length, 0, 'Tuesday is on worksheet 2: not yet');
    assert.equal(t2.answerKeys.length, 0);
    assert.equal(t2.shared.waiting, true);
    assert.equal(t3.shared, null);
    const admin = Core.timelineItems(tue, docs, recordings, { courses, now: LATER, all: true });
    assert.equal(admin.find((i) => i.id === 't2').recordings.length, 1, 'admins see them at once');
    // Once Tuesday's lesson on worksheet 2 is over (the class moves on), they are out.
    const moved = Core.timelineItems({ ...tue, currentIndex: 2 }, docs, recordings, { courses, now: LATER });
    assert.equal(moved.find((i) => i.id === 't2').recordings.length, 1);
    // Not before the lesson they were recorded in was over in Monday's class.
    const early = Core.timelineItems({ ...tue, currentIndex: 2 }, docs, recordings, { courses, now: SG('2026-11-16T20:00:00') });
    assert.equal(early.find((i) => i.id === 't2').recordings.length, 0, 'Monday 7pm lesson still on at 8pm');
    assert.equal(early.find((i) => i.id === 't2').answerKeys.length, 0);
    const not = Core.timelineItems({ ...tue, currentIndex: -1, releasedThrough: 2 }, docs, recordings, { courses, now: LATER });
    assert.ok(not.every((i) => !i.recordings.length), 'a class that has not started sees none');
  });

  test('🔗 shared: own lessons first, unless "Always"; the class\'s own archive still hides', () => {
    const own = { ...recordings, t1: [rec('own', '2026-11-10T17:30:00')] };
    let it = Core.timelineItems(tue, docs, own, { courses, now: LATER }).find((i) => i.id === 't1');
    assert.deepEqual(it.recordings.map((r) => r.id), ['own'], 'fill: its own video stays');
    assert.equal(it.answerKeys.length, 1, '...and the missing answer key comes from Monday');
    assert.equal(it.shared.videos, false); assert.equal(it.shared.keys, true);
    it = Core.timelineItems({ ...tue, shareMode: 'replace' }, docs, own, { courses, now: LATER }).find((i) => i.id === 't1');
    assert.deepEqual(it.recordings.map((r) => r.id), ['r1', 'r0'], 'replace: Monday\'s instead');
    const dayKey = Core.lessonDayKey(SG('2026-11-09T19:30:00'));
    it = Core.timelineItems({ ...tue, archivedDays: ['t1|' + dayKey] }, docs, recordings, { courses, now: LATER }).find((i) => i.id === 't1');
    assert.deepEqual(it.recordings.map((r) => r.id), ['r0'], 'a class day archived here hides that shared day');
    const archived = Core.timelineItems({ ...tue, archivedWorksheets: ['t1'] }, docs, recordings, { courses, now: LATER });
    assert.ok(!archived.find((i) => i.id === 't1'), 'an archived worksheet stays hidden');
    // The rows the tabs draw carry where the videos come from.
    const items = Core.timelineItems(tue, docs, recordings, { courses, now: LATER });
    const vrow = Core.videoRows(tue, items).find((r) => r.id === 't1');
    assert.equal(vrow.shared.ws, 'm1');
    assert.equal(Core.answerKeyRows(tue, items).find((r) => r.id === 't1').shared.courseId, 'mon');
    assert.equal(Core.watchLink('t1', { course: 'tue', src: 'm1' }), 'watch.html?ws=t1&c=tue&src=m1');
    assert.equal(Core.watchLink('t1', { course: 'tue', src: 'm1' }), W.watchLink('t1', { course: 'tue', src: 'm1' }));
    assert.equal(Core.watchLink('t1', { src: 't1' }), 'watch.html?ws=t1', 'never itself');
    assert.equal(W.readQuery('?ws=t1&c=tue&src=m1').src, 'm1');
    assert.equal(W.readQuery('?ws=t1&src=a b').src, '');
  });

  test('🔗 shared: the admin\'s writes, the rows, missing worksheets and the video page check', () => {
    assert.deepEqual(Core.shareUpdate(mon, { kind: 'follow', from: 'tue' }), { shareFrom: 'tue', shareMode: 'fill' });
    assert.equal(Core.shareUpdate(tue, { kind: 'follow', from: 'mon' }), null, 'already');
    assert.deepEqual(Core.shareUpdate(tue, { kind: 'follow', from: '' }), { shareFrom: '', shareMode: 'fill' }, 'stop sharing');
    assert.equal(Core.shareUpdate(tue, { kind: 'follow', from: 'tue' }), null, 'not itself');
    assert.deepEqual(Core.shareUpdate(tue, { kind: 'mode', mode: 'replace' }), { shareMode: 'replace' });
    assert.equal(Core.shareUpdate(tue, { kind: 'mode', mode: 'nonsense' }), null);
    assert.deepEqual(Core.shareUpdate(tue, { kind: 'pin', ws: 't3', from: { course: 'sat', ws: 's2' } }), { sharedKeys: { t3: { course: 'sat', ws: 's2' } } });
    assert.equal(Core.shareUpdate(tue, { kind: 'pin', ws: 'zz', from: { course: 'sat', ws: 's2' } }), null, 'only a worksheet of this class');
    const withPin = { ...tue, sharedKeys: { t3: { course: 'sat', ws: 's2' } } };
    assert.deepEqual(Core.shareUpdate(withPin, { kind: 'own', ws: 't1' }), { sharedKeys: { t3: { course: 'sat', ws: 's2' }, t1: { own: true } } });
    assert.deepEqual(Core.shareUpdate(withPin, { kind: 'clear', ws: 't3' }), { sharedKeys: {} });
    assert.equal(Core.shareUpdate(withPin, { kind: 'clear', ws: 't1' }), null, 'nothing to clear');
    const rows = Core.shareRows(tue, courses, docs, recordings);
    assert.deepEqual(rows.map((r) => r.uses), ['shared', 'shared', 'own']);
    assert.equal(rows[0].open, true); assert.equal(rows[1].open, false);
    assert.equal(rows[0].sourceVideos, 2); assert.equal(rows[0].source.seq, 0);
    assert.deepEqual(Core.shareMissing({ ...sat, shareFrom: 'mon' }, courses, docs), ['m1', 'm3'], 'Saturday lacks worksheets 1 and 3');
    assert.deepEqual(Core.shareChoices(tue, courses).map((c) => c.id).sort(), ['mon', 'sat']);
    assert.equal(Core.shareAllows(tue, 't1', 'm1', courses).id, 'mon');
    assert.equal(Core.shareAllows(tue, 't1', 's2', courses), null, 'not where it shares from');
    assert.equal(Core.shareAllows({ ...tue, sharedKeys: { t1: { own: true } } }, 't1', 'm1', courses), null);
    assert.equal(Core.shareAllows(withPin, 't3', 's2', courses).id, 'sat');
    assert.equal(Core.sharedOpen(tue, 0), true); assert.equal(Core.sharedOpen(tue, 1), false);
    const watch = fs.readFileSync(new URL('../online/watch.js', import.meta.url), 'utf8');
    assert.match(watch, /Core\.shareAllows\(state\.found\.course, query\.ws, query\.src/, 'the video page checks the class shares it');
    assert.match(watch, /Core\.sharedOpen\(openFor, seq\) && Core\.recordingOpen\(sharedFrom, at\)/);
    const portal = fs.readFileSync(new URL('../online/portal.js', import.meta.url), 'utf8');
    assert.ok(!/Core\.timelineItems\(course, state\.docs, state\.recordings\)/.test(portal), 'every tab passes the classes, for sharing');
  });
}

test('⭐ v1.19.0: a student ticks "my class" (one maths, one science); it goes first and the rest go quiet', () => {
  const sciMon = { id: 'sci-mon', level: 'P6', subject: 'science', day: 'Monday', slot: 3 };
  const sciTue = { id: 'sci-tue', level: 'P6', subject: 'science', day: 'Tuesday', slot: 2 };
  const sciSat = { id: 'sci-sat', level: 'P6', subject: 'science', day: 'Saturday', slot: 0 };
  const mathMon = { id: 'math-mon', level: 'P6', subject: 'math', day: 'Monday', slot: 2 };
  const both = { id: 'both', level: 'P6', subject: 'both', day: 'Friday', slot: 2 };
  const courses = [mathMon, sciMon, sciTue, sciSat, both];
  assert.equal(Core.myClassSubject(sciMon), 'science');
  assert.equal(Core.myClassSubject(mathMon), 'math');
  assert.equal(Core.myClassSubject({ subject: 'Mathematics' }), 'math', 'subjects matched loosely, like the band');
  assert.equal(Core.myClassSubject(both), '', 'a class of both subjects has no tick box');
  assert.equal(Core.myClassSubject({ subject: 'english' }), '');
  // Nothing ticked: the order is the usual one and nothing is quiet.
  const plain = Core.myClassOrder(courses, {});
  assert.deepEqual(plain.list.map((c) => c.id), courses.map((c) => c.id));
  assert.equal(plain.mine, 0);
  // Tick Tuesday science: it goes first.
  let picks = Core.toggleMyClass({}, sciTue);
  assert.deepEqual(picks, { science: 'sci-tue' });
  assert.equal(Core.isMyClass(picks, sciTue), true);
  assert.equal(Core.isMyClass(picks, sciMon), false);
  let order = Core.myClassOrder(courses, picks);
  assert.deepEqual(order.list.map((c) => c.id), ['sci-tue', 'math-mon', 'sci-mon', 'sci-sat', 'both']);
  assert.equal(order.mine, 1); assert.equal(order.others, 4);
  // Tick Saturday science: the tick MOVES (only one science class).
  picks = Core.toggleMyClass(picks, sciSat);
  assert.deepEqual(picks, { science: 'sci-sat' });
  // Tick a maths class too: both ticked classes lead, in the usual order (maths first).
  picks = Core.toggleMyClass(picks, mathMon);
  assert.deepEqual(picks, { science: 'sci-sat', math: 'math-mon' });
  order = Core.myClassOrder(courses, picks);
  assert.deepEqual(order.list.map((c) => c.id), ['math-mon', 'sci-sat', 'sci-mon', 'sci-tue', 'both']);
  assert.equal(order.mine, 2);
  // Ticking a ticked class again unticks it.
  picks = Core.toggleMyClass(picks, sciSat);
  assert.deepEqual(picks, { math: 'math-mon' });
  assert.equal(Core.toggleMyClass(picks, both), null, 'no tick for a class of both subjects');
  assert.equal(Core.toggleMyClass(picks, { subject: 'math' }), null, 'no tick without a class id');
  // Cleaning: wrong subject, missing classes and junk are dropped.
  assert.deepEqual(Core.cleanMyClasses({ math: 'sci-mon', science: 'sci-tue', english: 'x' }, courses), { science: 'sci-tue' });
  assert.deepEqual(Core.cleanMyClasses({ science: 'gone' }, courses), {});
  assert.deepEqual(Core.cleanMyClasses('nonsense', courses), {});
  assert.deepEqual(Core.cleanMyClasses({ math: 5 }, null), {});
  // A pick for a class that has gone ticks nothing, so nothing goes quiet.
  assert.equal(Core.myClassOrder(courses, { science: 'gone' }).mine, 0);
  // Words on the box.
  assert.equal(Core.myClassLabel({}, sciMon).on, false);
  assert.match(Core.myClassLabel({}, sciMon).aria, /my science class/);
  assert.equal(Core.myClassLabel({ science: 'sci-mon' }, sciMon).text, 'My class');
  // The page: a box in every band, the order on every tab, saved per student.
  const portal = fs.readFileSync(new URL('../online/portal.js', import.meta.url), 'utf8');
  assert.match(portal, /myClassBoxHtml\(course\) \+\s*'<\/header>'/, 'the tick box sits in the day band');
  assert.match(portal, /Core\.myClassOrder\(courses, myPicks\(\)\)/, 'every tab lists ticked classes first');
  assert.match(portal, /onlineMyClasses: picks/, 'saved in the student profile, for every device');
  assert.match(portal, /state\.previewMyClasses = picks/, 'an admin preview never saves');
  for (const kind of ['Worksheets', 'Answer keys', 'Videos']) {
    assert.ok(portal.includes('class="card st-card\' + myCardClass(course) + \'" aria-label="' + kind), kind + ' tab marks mine / other');
  }
  const page = fs.readFileSync(new URL('../online/index.html', import.meta.url), 'utf8');
  assert.match(page, /\.is-other-class \{[^}]*saturate/, 'other classes lose their colour');
  assert.match(page, /\.my-class-box \{[^}]*min-height: 48px/, 'a big box to tap on a phone');
});

test('🔍 v1.20.0: Maths and Science buttons show one subject in every tab, offered only with both subjects', () => {
  const mathMon = { id: 'math-mon', level: 'P6', subject: 'math', day: 'Monday', slot: 2 };
  const sciMon = { id: 'sci-mon', level: 'P6', subject: 'science', day: 'Monday', slot: 3 };
  const sciTue = { id: 'sci-tue', level: 'P6', subject: 'Science', day: 'Tuesday', slot: 2 };
  const both = { id: 'both', level: 'P6', subject: 'both', day: 'Friday', slot: 2 };
  const english = { id: 'eng', level: 'P6', subject: 'english', day: 'Sunday', slot: 0 };
  const courses = [mathMon, sciMon, sciTue, both, english];
  assert.deepEqual(Core.SUBJECT_FILTERS.map((f) => f[0]), ['math', 'science']);
  assert.deepEqual(Core.subjectFilterKeys(both), ['math', 'science'], 'a class of both shows under either button');
  assert.deepEqual(Core.subjectFilterKeys(english), [], 'another subject only shows with no button on');
  // Counts and whether to offer the buttons.
  const counts = Core.subjectFilterCounts(courses);
  assert.equal(counts.math, 2); assert.equal(counts.science, 3); assert.equal(counts.all, 5);
  assert.equal(counts.offered, true);
  assert.equal(Core.subjectFilterCounts([sciMon, sciTue]).offered, false, 'only science: nothing to filter');
  assert.equal(Core.subjectFilterCounts([mathMon]).offered, false);
  assert.equal(Core.subjectFilterCounts([both]).offered, false, 'one class of both: both buttons would show the same');
  assert.equal(Core.subjectFilterCounts([]).offered, false);
  assert.equal(Core.subjectFilterCounts([mathMon, sciMon]).offered, true);
  // Filtering keeps the usual order.
  assert.deepEqual(Core.filterBySubject(courses, 'math').map((c) => c.id), ['math-mon', 'both']);
  assert.deepEqual(Core.filterBySubject(courses, 'science').map((c) => c.id), ['sci-mon', 'sci-tue', 'both']);
  assert.deepEqual(Core.filterBySubject(courses, '').map((c) => c.id), courses.map((c) => c.id));
  assert.deepEqual(Core.filterBySubject(courses, 'junk').length, 5);
  // A stored value is kept only when it means something for these classes.
  assert.equal(Core.cleanSubjectFilter('maths', courses), 'math');
  assert.equal(Core.cleanSubjectFilter('science', courses), 'science');
  assert.equal(Core.cleanSubjectFilter('science', [mathMon]), '', 'no science class: show everything');
  assert.equal(Core.cleanSubjectFilter('math', [sciMon, sciTue]), '');
  assert.equal(Core.cleanSubjectFilter('<b>', courses), '');
  assert.equal(Core.cleanSubjectFilter('science', null), 'science');
  // Tapping: light one, switch to the other, tap the lit one to show all.
  assert.equal(Core.toggleSubjectFilter('', 'math'), 'math');
  assert.equal(Core.toggleSubjectFilter('math', 'science'), 'science');
  assert.equal(Core.toggleSubjectFilter('science', 'science'), '');
  assert.equal(Core.toggleSubjectFilter('math', 'all'), '');
  // Works with "my class": the order is worked out inside the filtered list.
  const order = Core.myClassOrder(Core.filterBySubject(courses, 'science'), { science: 'sci-tue', math: 'math-mon' });
  assert.deepEqual(order.list.map((c) => c.id), ['sci-tue', 'sci-mon', 'both']);
  assert.equal(order.mine, 1);
  // The page: buttons above the tabs, the filter feeds every tab, kept on this device.
  const portal = fs.readFileSync(new URL('../online/portal.js', import.meta.url), 'utf8');
  assert.match(portal, /subjectFilterHtml\(allCourses, subjectFilter\);\s*html \+= studentTabsHtml\(courses\)/, 'buttons sit just above the tabs');
  assert.match(portal, /courses = Core\.filterBySubject\(allCourses, subjectFilter\);[\s\S]{0,200}Core\.myClassOrder\(courses, myPicks\(\)\)/, 'filter first, then my class order');
  assert.match(portal, /case 'subject-filter': setSubjectFilter/);
  assert.match(portal, /localStorage\.setItem\(subjectFilterStoreKey\(\), value\)/);
  const page = fs.readFileSync(new URL('../online/index.html', import.meta.url), 'utf8');
  assert.match(page, /\.subject-filter-btn \{[^}]*min-height: 68px/, 'big buttons');
  assert.match(page, /\.subject-filter-btn\.is-on \{[^}]*background: var\(--sf-ink\)/, 'the lit button is solid');
});

test('🗂 v1.21.0: admin classes read their day and time from the saved session, or from a hand-typed name', () => {
  assert.deepEqual(
    [Core.parseClockText('9 a.m.'), Core.parseClockText('3:00pm'), Core.parseClockText('11.30 AM'), Core.parseClockText('12pm'), Core.parseClockText('no time')],
    [540, 900, 690, 720, -1]);
  assert.equal(Core.clockLabel(540), '9:00am');
  assert.equal(Core.clockLabel(1140), '7:00pm');
  const saved = Core.classWhen({ level: 'P6', subject: 'math', day: 'Monday', slot: 1 });
  assert.equal(saved.day, 'Monday'); assert.equal(saved.time, '5:00pm'); assert.equal(saved.fromName, false); assert.equal(saved.known, true);
  const typed = Core.classWhen({ level: 'P6', subject: 'science', title: 'P6 Science Saturday 9 a.m.' });
  assert.equal(typed.day, 'Saturday'); assert.equal(typed.time, '9:00am'); assert.equal(typed.fromName, true);
  assert.equal(Core.classWhen({ level: 'P5', subject: 'math', title: 'Holiday revision' }).known, false);
  assert.equal(Core.classShortName({ level: 'P6', subject: 'science', title: 'P6 Science Saturday 9 a.m.' }), 'P6 Science');
  assert.equal(Core.classShortName({ level: 'P6', subject: 'science', day: 'Monday', slot: 2, title: 'P6 Science · Monday 7:00pm' }), 'P6 Science');
  assert.equal(Core.classLevel({ title: 'P4 Science Thu' }), 'P4');
  assert.equal(Core.cleanAdminClassView('timetable'), 'timetable');
  assert.equal(Core.cleanAdminClassView('nonsense'), 'level');
});

test('🗂 v1.21.0: admin classes group by level or by subject, in day-and-time order, and filter', () => {
  const list = [
    { id: 'p6s-sat', level: 'P6', subject: 'science', title: 'P6 Science Saturday 9 a.m.' },
    { id: 'p6s-tue', level: 'P6', subject: 'science', day: 'Tuesday', slot: 1 },
    { id: 'p6m-mon', level: 'P6', subject: 'math', day: 'Monday', slot: 1 },
    { id: 'p6s-mon', level: 'P6', subject: 'science', day: 'Monday', slot: 2 },
    { id: 'p4s-sat', level: 'P4', subject: 'science', day: 'Saturday', slot: 1 },
    { id: 'p4s-thu', level: 'P4', subject: 'science', day: 'Thursday', slot: 0 },
    { id: 'p5s-old', level: 'P5', subject: 'science', day: 'Friday', slot: 0, archived: true },
    { id: 'p5s-fri', level: 'P5', subject: 'science', day: 'Friday', slot: 0 }
  ];
  const byLevel = Core.groupAdminClasses(list, 'level');
  assert.deepEqual(byLevel.map((g) => g.label), ['Primary 4', 'Primary 5', 'Primary 6']);
  assert.deepEqual(byLevel[2].courses.map((c) => c.id), ['p6m-mon', 'p6s-mon', 'p6s-tue', 'p6s-sat']);
  assert.deepEqual(byLevel[1].courses.map((c) => c.id), ['p5s-fri', 'p5s-old'], 'archived classes go last');
  assert.equal(byLevel[2].sub, '4 classes · 1 Maths · 3 Science');
  const bySubject = Core.groupAdminClasses(list, 'subject');
  assert.deepEqual(bySubject.map((g) => g.label), ['Mathematics', 'Science']);
  assert.deepEqual(bySubject[1].courses.map((c) => c.id), ['p4s-thu', 'p4s-sat', 'p5s-fri', 'p6s-mon', 'p6s-tue', 'p6s-sat', 'p5s-old']);
  assert.equal(bySubject[1].sub, '7 classes · P4, P5, P6 · 1 archived');
  assert.deepEqual(Core.filterAdminClasses(list, { level: 'P6', subject: 'science' }).map((c) => c.id).sort(), ['p6s-mon', 'p6s-sat', 'p6s-tue']);
  assert.deepEqual(Core.filterAdminClasses(list, { level: 'P9', subject: 'art' }).length, list.length, 'unknown filters show everything');
  const facets = Core.adminClassFacets(list);
  assert.deepEqual(facets.levels.map((l) => l.value + ':' + l.count), ['P4:2', 'P5:2', 'P6:4']);
  assert.deepEqual(facets.subjects.map((s) => s.value + ':' + s.count), ['math:1', 'science:7']);
});

test('🗂 v1.21.0: the admin timetable puts each class in its day and time, and keeps unplaced ones aside', () => {
  const list = [
    { id: 'a', level: 'P6', subject: 'science', title: 'P6 Science Saturday 9 a.m.' },
    { id: 'b', level: 'P6', subject: 'math', day: 'Monday', slot: 1 },
    { id: 'c', level: 'P5', subject: 'science', day: 'Monday', slot: 1 },
    { id: 'd', level: 'P4', subject: 'science', day: 'Thursday', slot: 0 },
    { id: 'e', level: 'P5', subject: 'math', title: 'Holiday revision' }
  ];
  const tt = Core.adminTimetable(list);
  assert.deepEqual(tt.days.map((d) => d.day), ['Monday', 'Thursday', 'Saturday']);
  assert.deepEqual(tt.times.map((t) => t.label), ['9:00am', '3:00pm', '5:00pm']);
  assert.deepEqual(tt.cell(0, 1020).map((c) => c.id), ['c', 'b'], 'two classes at once: lower level first');
  assert.deepEqual(tt.cell(5, 540).map((c) => c.id), ['a']);
  assert.deepEqual(tt.cell(3, 540), []);
  assert.equal(tt.usual(5, 540), true);
  assert.equal(tt.usual(5, 900), false, 'no 3pm session on a Saturday');
  assert.equal(tt.usual(0, 900), true);
  assert.deepEqual(tt.unplaced.map((c) => c.id), ['e']);
  assert.equal(tt.count, 4);
});
