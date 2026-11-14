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
  assert.deepEqual(Core.finishUpdate(c), { currentIndex: 3, currentDocId: 'd', releasedThrough: 8, lastFinishedIndex: 2, lastFinishedDocId: 'c' });
  const fresh = course();
  assert.deepEqual(Core.finishUpdate(fresh), { currentIndex: 1, currentDocId: 'b', releasedThrough: 6, lastFinishedIndex: 0, lastFinishedDocId: 'a' },
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
